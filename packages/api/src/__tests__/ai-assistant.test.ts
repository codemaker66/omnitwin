import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../db/schema.js";
import type { Env } from "../env.js";
import { aiAssistantRoutes } from "../routes/ai-assistant.js";
import type { AIGenerationAdapter, AIGenerationInput } from "../services/ai-assistant.js";
import { buildAIDraftInstructions, contextKeyWords, generateAIDraft, isWithheldContextKey, scrubDraftContext } from "../services/ai-assistant.js";
import { AIDraftNotProducedError } from "../services/anthropic-draft-adapter.js";
import { scrubContactDetails } from "../services/proposal-message-draft.js";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
process.env["AI_ASSISTANT_ENABLED"] = "false";
delete process.env["AI_ASSISTANT_PROVIDER"];
delete process.env["AI_ASSISTANT_MODEL"];
delete process.env["AI_ASSISTANT_BASE_URL"];
delete process.env["AI_ASSISTANT_API_KEY"];

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const USER_ID = "00000000-0000-4000-8000-000000005001";
const VENUE_ID = "00000000-0000-4000-8000-000000005002";

function staffToken(): string {
  return JSON.stringify({
    id: USER_ID,
    email: "staff@test.com",
    role: "staff",
    venueId: VENUE_ID,
  });
}

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("AI assistant routes", () => {
  it("requires auth for AI status", async () => {
    const res = await server.inject({ method: "GET", url: "/ai/status" });
    expect(res.statusCode).toBe(401);
  });

  it("reports disabled state without exposing secret environment values", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/ai/status",
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: {
        configured: false,
        provider: null,
        model: null,
      },
    });
    expect(res.body).not.toContain("AI_ASSISTANT_API_KEY");
  });

  it("fails closed when draft generation is not configured", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/ai/drafts",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: {
        useCase: "truth_mode_explanation",
        context: { targetId: "demo", guestCount: 90 },
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "AI_ASSISTANT_DISABLED" });
  });

  it("registers requested route paths without unsafe output actions", async () => {
    const [indexSource, routeSource] = await Promise.all([
      readFile(resolve("src/index.ts"), "utf-8"),
      readFile(resolve("src/routes/ai-assistant.ts"), "utf-8"),
    ]);
    expect(indexSource).toContain('prefix: "/ai"');
    expect(routeSource).toContain('"/status"');
    expect(routeSource).toContain('"/drafts"');
    expect(routeSource).not.toMatch(/sendToClient|autoApprove|approveAutomatically/iu);
  });
});

describe("AI assistant draft generation", () => {
  it("runs mocked AI output through claim guard and human review metadata", async () => {
    const adapter: AIGenerationAdapter = {
      status: {
        configured: true,
        provider: "mock",
        model: "mock-draft",
        disabledReason: null,
      },
      generateText() {
        return Promise.resolve("This proposal draft is certified safe and legally compliant.");
      },
    };
    const draft = await generateAIDraft(
      adapter,
      {
        useCase: "proposal_draft",
        context: { proposalId: "demo-proposal" },
      },
      { venueId: VENUE_ID, userId: USER_ID },
      new Date("2026-06-12T12:30:00.000Z"),
    );

    expect(draft.body).toContain("requires human review");
    expect(draft.body).toContain("not legally certified");
    expect(draft.blockedUnsafeClaims).toEqual(["certified safe", "legally compliant"]);
    expect(draft.humanReviewRequired).toBe(true);
    expect(draft.provenance).toBe("ai_generated");
    expect(draft.evidenceStatus).toBe("unverified");
    expect(draft.sendState).toBe("draft_only");
  });
});

// ---------------------------------------------------------------------------
// Release audit ai-1 (27 October 2026): a general draft's context is built by
// the screen, so the server takes contact details, names and ids out of it
// before any provider reads it. The enquiry summary sent the enquirer's name,
// email address and message word for word.
// ---------------------------------------------------------------------------

describe("what a general draft may send a provider (ai-1)", () => {
  const WORDS = "Jane Doe, jane@example.com, call me on 07700 900123; my father is a wheelchair user and two guests are coeliac";

  async function capturing(): Promise<{ readonly app: FastifyInstance; readonly seen: AIGenerationInput[] }> {
    const seen: AIGenerationInput[] = [];
    const adapter: AIGenerationAdapter = {
      status: { configured: true, provider: "capture", model: "capture-model", disabledReason: null },
      generateText(input) {
        seen.push(input);
        return Promise.resolve("A dinner for about ninety guests.");
      },
    };
    const app = Fastify();
    await app.register(aiAssistantRoutes, { env: {} as Env, db: drizzle.mock({ schema }), adapter, prefix: "/ai" });
    await app.ready();
    return { app, seen };
  }

  const asStaff = { authorization: `Bearer ${staffToken()}` };

  it.each([
    ["enquiry_summary", "POST /enquiries/:id/summary-draft"],
    ["proposal_draft", "POST /proposals/:id/message-draft"],
  ])("refuses a %s, which is built on the server from the venue's own record, asking the provider nothing", async (useCase, route) => {
    const { app, seen } = await capturing();
    try {
      const res = await app.inject({
        method: "POST", url: "/ai/drafts", headers: asStaff,
        payload: { useCase, context: { enquiryId: "8d6c1a52-0000-4000-8000-000000000001", name: "Jane Doe", email: "jane@example.com", message: WORDS } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: `This draft is built from the venue's own record by ${route}`, code: "DRAFT_HAS_ITS_OWN_ROUTE" });
      expect(seen).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("drops contact, person and id keys at any depth and scrubs every string and the tone before the provider reads them", async () => {
    const { app, seen } = await capturing();
    try {
      const res = await app.inject({
        method: "POST", url: "/ai/drafts", headers: asStaff,
        payload: {
          useCase: "beo_supplier_instruction_draft",
          requestedTone: "Plain, for Jane at jane@example.com or 07700 900123",
          context: {
            handoffPackId: "8d6c1a52-0000-4000-8000-000000000001",
            guestEmail: "jane@example.com",
            organiser: { displayName: "Jane Doe" },
            clientName: "Jane Doe",
            summary: WORDS,
            pickList: [{ name: "Round table 5ft", quantity: 12 }],
            room: { name: "Grand Hall" },
            supplierInstructions: ["Ring the florist on 0141 552 1234 after six"],
          },
        },
      });
      expect(res.statusCode).toBe(200);
      const [input] = seen;
      if (input === undefined) throw new Error("expected the provider to be asked");
      expect(input.context).toEqual({
        summary: "Jane Doe, (email address), call me on (phone number); my father is a wheelchair user and two guests are coeliac",
        pickList: [{ name: "Round table 5ft", quantity: 12 }],
        room: { name: "Grand Hall" },
        supplierInstructions: ["Ring the florist on (phone number) after six"],
      });
      for (const sent of [JSON.stringify(input.context), input.prompt, input.instructions]) {
        expect(sent).not.toMatch(/jane@example\.com|07700|900123|0141 552 1234|8d6c1a52|displayName|clientName/u);
      }
      expect(input.instructions).toContain("Tone: Plain, for Jane at (email address) or (phone number).");
    } finally {
      await app.close();
    }
  });

  it("refuses a context too large to send, before anything reads it", async () => {
    const { app, seen } = await capturing();
    try {
      const res = await app.inject({
        method: "POST", url: "/ai/drafts", headers: asStaff,
        payload: { useCase: "truth_mode_explanation", context: { note: "x".repeat(16_001) } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(seen).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // Release review, 27 October 2026: the email pattern was tried at every
  // letter of a run with no space, so 40,000 such letters took two seconds
  // and the time grew with the square. Anchored at a word's start, it is one try.
  it("scrubs long runs of text with no space in time that grows with the text, not its square", () => {
    const started = performance.now();
    for (const text of ["x".repeat(200_000), `a@${"b".repeat(200_000)}`, "a.".repeat(100_000), "1-".repeat(100_000)]) {
      scrubContactDetails(text);
    }
    // Unanchored, the first alone took well over a minute.
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("reads a key word by word: contact details, a person and ids go, a room's or an item's name stays", () => {
    expect(contextKeyWords("guestFullName")).toEqual(["guest", "full", "name"]);
    expect(contextKeyWords("handoff_pack_id")).toEqual(["handoff", "pack", "id"]);
    expect(contextKeyWords("COVIDNote")).toEqual(["covid", "note"]);
    for (const key of ["email", "guestEmail", "contact_email", "e-mail", "phone", "guestPhone", "tel", "contactNumber", "mobile", "mobileNumber",
      "address", "venueAddress", "postcode", "instagram", "guest", "client", "organiser", "contact", "bookerName", "displayName", "guestFullName",
      "firstName", "clientName", "id", "enquiryId", "enquiry-id", "handoffPackId", "targetId", "venue_id", "ids", "bookingIds", "uuid", "ref", "reference"]) {
      expect(isWithheldContextKey(key), key).toBe(true);
    }
    for (const key of ["paid", "valid", "COVID", "PAID", "name", "roomName", "itemName", "pickList", "pickListItems", "mobileBar", "microphones",
      "eventType", "estimatedGuests", "message", "selectedTarget", "summary", "humanReviewRequired", "supplierInstructions"]) {
      expect(isWithheldContextKey(key), key).toBe(false);
    }
    expect(scrubDraftContext({ count: 3, flag: true, none: null, list: [1, "a@b.co"] })).toEqual({ count: 3, flag: true, none: null, list: [1, "(email address)"] });
  });
});

// ---------------------------------------------------------------------------
// Plan 19, L6: a draft never states a price, availability or capacity. The
// rules say so, and every draft is checked after the model wrote it.
// ---------------------------------------------------------------------------

describe("what a draft may not say (L6)", () => {
  function answering(text: string): AIGenerationAdapter {
    return {
      status: { configured: true, provider: "mock", model: "mock-draft", disabledReason: null },
      generateText() {
        return Promise.resolve(text);
      },
    };
  }
  const ATTRIBUTION = { venueId: VENUE_ID, userId: USER_ID };

  it.each(["proposal_draft", "enquiry_summary", "beo_supplier_instruction_draft", "truth_mode_explanation"] as const)(
    "tells the model, for %s, that only the team confirms a price, availability or capacity",
    (useCase) => {
      const rules = buildAIDraftInstructions({ useCase, context: {} });
      expect(rules).toContain("Never state a price, a cost, a fee, a deposit, a discount or any amount of money");
      expect(rules).toContain("never say whether a date, a time or a room is available, free, held, booked or confirmed");
      expect(rules).toContain("never say how many people a room seats, holds or can take, or that it is big enough");
      expect(rules).toContain("say the events team will confirm it");
    },
  );

  it("takes out each sentence that states one, says which kinds, and keeps the rest", async () => {
    const draft = await generateAIDraft(answering([
      "Dear Elaine,",
      "",
      "Thank you for thinking of the Grand Hall. Good news: 17 September 2027 is free! The hall seats up to 200 and dinner is £65 per head.",
      "",
      "The team will confirm the figures with you.",
      "",
      "The Events Team",
    ].join("\n")), { useCase: "proposal_draft", context: { clientName: "Elaine" } }, ATTRIBUTION, new Date("2026-10-27T12:00:00.000Z"));
    expect(draft.body).toBe("Dear Elaine,\n\nThank you for thinking of the Grand Hall.\n\nThe team will confirm the figures with you.\n\nThe Events Team");
    expect(draft.withheldCommitments).toEqual(["price", "availability", "capacity"]);
    expect(draft.body).not.toMatch(/£|free|seats/u);
  });

  it("records nothing withheld from a draft that states none", async () => {
    const draft = await generateAIDraft(answering("Dear Elaine, thank you for your enquiry about your 150 guests."),
      { useCase: "proposal_draft", context: {} }, ATTRIBUTION);
    expect(draft.withheldCommitments).toEqual([]);
    expect(draft.body).toBe("Dear Elaine, thank you for your enquiry about your 150 guests.");
  });

  it("gives no draft when every sentence states one", async () => {
    await expect(generateAIDraft(answering("The date is free. The room seats 200. It costs £900."),
      { useCase: "enquiry_summary", context: {} }, ATTRIBUTION)).rejects.toBeInstanceOf(AIDraftNotProducedError);
  });
});

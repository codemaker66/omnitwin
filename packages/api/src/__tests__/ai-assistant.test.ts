import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../db/schema.js";
import type { Env } from "../env.js";
import { aiAssistantRoutes } from "../routes/ai-assistant.js";
import type { AIGenerationAdapter, AIGenerationInput } from "../services/ai-assistant.js";
import { generateAIDraft, isWithheldContextKey, scrubDraftContext } from "../services/ai-assistant.js";

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
        useCase: "enquiry_summary",
        context: { enquiryId: "demo", guestCount: 90 },
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
  const ENQUIRY_WORDS = "Jane Doe, jane@example.com, call me on 07700 900123; my father is a wheelchair user and two guests are coeliac";

  async function capturing(): Promise<{ readonly app: FastifyInstance; readonly seen: AIGenerationInput[] }> {
    const seen: AIGenerationInput[] = [];
    const adapter: AIGenerationAdapter = {
      status: { configured: true, provider: "capture", model: "capture-model", disabledReason: null },
      generateText(input) {
        seen.push(input);
        return Promise.resolve("A dinner enquiry for about ninety guests.");
      },
    };
    const app = Fastify();
    await app.register(aiAssistantRoutes, { env: {} as Env, db: drizzle.mock({ schema }), adapter, prefix: "/ai" });
    await app.ready();
    return { app, seen };
  }

  it("drafts an enquiry summary with no email, phone, name or id reaching the provider", async () => {
    const { app, seen } = await capturing();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/ai/drafts",
        headers: { authorization: `Bearer ${staffToken()}` },
        payload: {
          useCase: "enquiry_summary",
          context: {
            enquiryId: "8d6c1a52-0000-4000-8000-000000000001",
            name: "Jane Doe",
            email: "jane@example.com",
            guestPhone: "07700 900123",
            eventType: "dinner",
            estimatedGuests: 90,
            message: ENQUIRY_WORDS,
            details: { contact_email: "jane@example.com", notes: ["Ring 0141 552 1234 after six"] },
            currentStatus: "submitted",
          },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(seen).toHaveLength(1);
      const [input] = seen;
      if (input === undefined) throw new Error("expected the provider to be asked");
      expect(Object.keys(input.context).sort()).toEqual(["currentStatus", "details", "estimatedGuests", "eventType", "message"]);
      expect(input.context).toEqual({
        eventType: "dinner",
        estimatedGuests: 90,
        message: "Jane Doe, (email address), call me on (phone number); my father is a wheelchair user and two guests are coeliac",
        details: { notes: ["Ring (phone number) after six"] },
        currentStatus: "submitted",
      });
      for (const sent of [JSON.stringify(input.context), input.prompt, input.instructions]) {
        expect(sent).not.toMatch(/jane@example\.com|07700|900123|0141 552 1234|enquiryId|8d6c1a52/u);
      }
      expect(input.prompt).toContain("(email address)");
      expect(input.prompt).toContain("(phone number)");
      // The draft's own record of its context is what was sent.
      expect(res.json<{ data: { body: string } }>().data.body).toBe("A dinner enquiry for about ninety guests.");
    } finally {
      await app.close();
    }
  });

  it("holds every general draft to the same rule, not only the enquiry summary", async () => {
    const { app, seen } = await capturing();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/ai/drafts",
        headers: { authorization: `Bearer ${staffToken()}` },
        payload: {
          useCase: "beo_supplier_instruction_draft",
          context: { handoffPackId: "pack-1", summary: "Florist on 07700 900123", supplierInstructions: ["Email flowers@example.com by noon"] },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(seen[0]?.context).toEqual({ summary: "Florist on (phone number)", supplierInstructions: ["Email (email address) by noon"] });
    } finally {
      await app.close();
    }
  });

  it("withholds contact, name and id keys, and keeps words that only end in id", () => {
    for (const key of ["email", "guestEmail", "contact_email", "e-mail", "phone", "guestPhone", "mobile", "telephone", "address",
      "postcode", "name", "guestName", "clientName", "full_name", "id", "enquiryId", "handoffPackId", "targetId", "venue_id", "ids", "bookingIds"]) {
      expect(isWithheldContextKey(key), key).toBe(true);
    }
    for (const key of ["paid", "valid", "eventType", "estimatedGuests", "message", "selectedTarget", "roomName", "summary", "humanReviewRequired"]) {
      expect(isWithheldContextKey(key), key).toBe(false);
    }
    expect(scrubDraftContext({ count: 3, flag: true, none: null, list: [1, "a@b.co"] })).toEqual({ count: 3, flag: true, none: null, list: [1, "(email address)"] });
  });
});

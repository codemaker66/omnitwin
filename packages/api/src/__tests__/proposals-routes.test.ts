import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION } from "@omnitwin/types";
import {
  canTransitionProposal,
  canTransitionQuote,
  getAvailableProposalTransitions,
  isStructuralProposalTransition,
  isStructuralQuoteTransition,
  proposalRolePolicyKeys,
  quoteRolePolicyKeys,
} from "../state-machines/proposal.js";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_A = "00000000-0000-4000-8000-00000000000a";
const VENUE_B = "00000000-0000-4000-8000-00000000000b";
const PROPOSAL_ID = "00000000-0000-4000-8000-000000000010";
const QUOTE_ID = "00000000-0000-4000-8000-000000000011";

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const adminToken = (): string => signToken({
  id: "00000000-0000-4000-8000-000000000099",
  email: "admin@test.com",
  role: "admin",
  venueId: VENUE_A,
});

const staffAToken = (): string => signToken({
  id: "00000000-0000-4000-8000-000000000098",
  email: "staff-a@test.com",
  role: "staff",
  venueId: VENUE_A,
});

const staffBToken = (): string => signToken({
  id: "00000000-0000-4000-8000-000000000097",
  email: "staff-b@test.com",
  role: "staff",
  venueId: VENUE_B,
});

const plannerToken = (): string => signToken({
  id: "00000000-0000-4000-8000-000000000096",
  email: "planner@test.com",
  role: "planner",
  venueId: null,
});

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

// ---------------------------------------------------------------------------
// State machine — pure unit tests
// ---------------------------------------------------------------------------

describe("proposal state machine role policy", () => {
  it("staff drive the sales lifecycle; clients cannot send", () => {
    expect(canTransitionProposal("draft", "sent", "staff")).toBe(true);
    expect(canTransitionProposal("draft", "sent", "planner")).toBe(false);
    expect(canTransitionProposal("draft", "sent", "client")).toBe(false);
    expect(canTransitionProposal("draft", "sent", "hallkeeper")).toBe(false);
  });

  it("clients may accept, decline, or request changes on a sent proposal", () => {
    for (const role of ["client", "planner", "staff"]) {
      expect(canTransitionProposal("sent", "accepted", role)).toBe(true);
      expect(canTransitionProposal("sent", "declined", role)).toBe(true);
      expect(canTransitionProposal("sent", "changes_requested", role)).toBe(true);
    }
    expect(canTransitionProposal("sent", "expired", "client")).toBe(false);
    expect(canTransitionProposal("sent", "withdrawn", "planner")).toBe(false);
  });

  it("admin can perform any transition (house override)", () => {
    expect(canTransitionProposal("draft", "accepted", "admin")).toBe(true);
    expect(canTransitionProposal("archived", "draft", "admin")).toBe(true);
  });

  it("unknown transitions are rejected for non-admin roles", () => {
    expect(canTransitionProposal("draft", "accepted", "staff")).toBe(false);
    expect(canTransitionProposal("accepted", "declined", "staff")).toBe(false);
  });

  it("every role-policy key is a structurally legal transition (drift guard)", () => {
    for (const key of proposalRolePolicyKeys()) {
      const [from, to] = key.split("→");
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      if (from !== undefined && to !== undefined) {
        expect(
          isStructuralProposalTransition(
            from as Parameters<typeof isStructuralProposalTransition>[0],
            to as Parameters<typeof isStructuralProposalTransition>[1],
          ),
        ).toBe(true);
      }
    }
    for (const key of quoteRolePolicyKeys()) {
      const [from, to] = key.split("→");
      if (from !== undefined && to !== undefined) {
        expect(
          isStructuralQuoteTransition(
            from as Parameters<typeof isStructuralQuoteTransition>[0],
            to as Parameters<typeof isStructuralQuoteTransition>[1],
          ),
        ).toBe(true);
      }
    }
  });

  it("getAvailableProposalTransitions reflects the role policy", () => {
    expect(getAvailableProposalTransitions("draft", "staff")).toEqual(["sent", "withdrawn"]);
    expect(getAvailableProposalTransitions("sent", "client")).toEqual([
      "accepted",
      "declined",
      "changes_requested",
    ]);
    expect(getAvailableProposalTransitions("draft", "hallkeeper")).toEqual([]);
  });

  it("quote machine: staff issue/supersede, clients accept/decline", () => {
    expect(canTransitionQuote("draft", "issued", "staff")).toBe(true);
    expect(canTransitionQuote("draft", "issued", "client")).toBe(false);
    expect(canTransitionQuote("issued", "accepted", "client")).toBe(true);
    expect(canTransitionQuote("issued", "superseded", "client")).toBe(false);
    expect(canTransitionQuote("accepted", "issued", "staff")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Routes — auth, validation, and venue scoping (pre-database behaviour)
// ---------------------------------------------------------------------------

describe("proposal routes", () => {
  it("returns 401 without auth", async () => {
    for (const [method, url] of [
      ["GET", "/proposals"],
      ["POST", "/proposals"],
      ["GET", `/proposals/${PROPOSAL_ID}`],
      ["POST", `/proposals/${PROPOSAL_ID}/transition`],
    ] as const) {
      const res = await server.inject({ method, url, payload: method === "POST" ? {} : undefined });
      expect(res.statusCode).toBe(401);
    }
  });

  it("rejects an invalid create payload", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/proposals",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { venueId: VENUE_A },
    });
    expect(res.statusCode).toBe(400);
  });

  it("venue-scopes creation: staff of another venue are forbidden", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/proposals",
      headers: { authorization: `Bearer ${staffBToken()}` },
      payload: { venueId: VENUE_A, title: "Cross-venue proposal" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("forbids planner/client roles from creating proposals", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/proposals",
      headers: { authorization: `Bearer ${plannerToken()}` },
      payload: { venueId: VENUE_A, title: "Planner proposal" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts a valid staff create for their own venue before hitting the database", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/proposals",
      headers: { authorization: `Bearer ${staffAToken()}` },
      payload: { venueId: VENUE_A, title: "Summer wedding proposal" },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("rejects an unknown transition status at the validation boundary", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/proposals/${PROPOSAL_ID}/transition`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "approved" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("claim guard rejects unsupported certainty wording in version payloads", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/proposals/${PROPOSAL_ID}/versions`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
        title: "Gala dinner",
        clientMessage: "This room layout is fire approved for 300 guests.",
        configurationId: null,
        layoutRevision: null,
        capacityNote: null,
        quote: null,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a SAFE version payload shape before hitting the database", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/proposals/${PROPOSAL_ID}/versions`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
        title: "Gala dinner",
        clientMessage: "Planning-grade draft — human review required before final numbers.",
        configurationId: null,
        layoutRevision: null,
        capacityNote: null,
        quote: null,
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe("quote routes", () => {
  it("returns 401 without auth", async () => {
    for (const [method, url] of [
      ["GET", "/quotes"],
      ["POST", "/quotes"],
      ["GET", `/quotes/${QUOTE_ID}`],
    ] as const) {
      const res = await server.inject({ method, url, payload: method === "POST" ? {} : undefined });
      expect(res.statusCode).toBe(401);
    }
  });

  it("rejects fractional minor-unit amounts and empty line items", async () => {
    const fractional = await server.inject({
      method: "POST",
      url: "/quotes",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        venueId: VENUE_A,
        name: "Bad quote",
        lineItems: [{ description: "Hire", quantity: 1, unitAmountMinor: 12.5 }],
      },
    });
    expect(fractional.statusCode).toBe(400);

    const empty = await server.inject({
      method: "POST",
      url: "/quotes",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { venueId: VENUE_A, name: "Empty quote", lineItems: [] },
    });
    expect(empty.statusCode).toBe(400);
  });

  it("venue-scopes creation: staff of another venue are forbidden", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/quotes",
      headers: { authorization: `Bearer ${staffBToken()}` },
      payload: {
        venueId: VENUE_A,
        name: "Cross-venue quote",
        lineItems: [{ description: "Hire", quantity: 1, unitAmountMinor: 1000 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts a valid create payload before hitting the database", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/quotes",
      headers: { authorization: `Bearer ${staffAToken()}` },
      payload: {
        venueId: VENUE_A,
        name: "Wedding quote",
        lineItems: [
          { description: "Grand Hall hire", quantity: 1, unitAmountMinor: 250000 },
          { description: "Round table", quantity: 12, unitAmountMinor: 1250 },
        ],
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("rejects supersededByQuoteId outside a superseded transition", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/quotes/${QUOTE_ID}/transition`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "issued", supersededByQuoteId: QUOTE_ID },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("public proposal share route", () => {
  it("rejects malformed share codes at the validation boundary", async () => {
    const res = await server.inject({ method: "GET", url: "/public/proposals/ab" });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a well-formed share code without auth before hitting the database", async () => {
    const res = await server.inject({ method: "GET", url: "/public/proposals/abcdef" });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("rejects unknown respond actions at the validation boundary", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/public/proposals/abcdef/respond",
      payload: { action: "approve" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid client response shape without auth before hitting the database", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/public/proposals/abcdef/respond",
      payload: { action: "request_changes", note: "Could we seat 130 instead?" },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Staff comment thread (T-427 phase 6)
// ---------------------------------------------------------------------------

describe("proposal comment routes", () => {
  it("requires auth to read or post staff comments", async () => {
    const get = await server.inject({ method: "GET", url: `/proposals/${PROPOSAL_ID}/comments` });
    expect(get.statusCode).toBe(401);
    const post = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL_ID}/comments`, payload: { body: "Hi" } });
    expect(post.statusCode).toBe(401);
  });

  it("rejects an empty reply body at the validation boundary", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/proposals/${PROPOSAL_ID}/comments`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { body: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("claim-guards staff replies - unsupported certainty wording is rejected", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/proposals/${PROPOSAL_ID}/comments`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { body: "Yes, the Grand Hall is fire approved for 300 guests." },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a SAFE staff reply shape before hitting the database", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/proposals/${PROPOSAL_ID}/comments`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { body: "Happy to move the bar - I'll send an updated version shortly." },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("authenticates the comments read before hitting the database", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/proposals/${PROPOSAL_ID}/comments`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Source-grep guards — money discipline and share-code provenance
// ---------------------------------------------------------------------------

describe("proposal/quote source guards", () => {
  it("quotes route computes totals with the exact money engine, never floats", async () => {
    const source = await readFile(resolve("src/routes/quotes.ts"), "utf-8");
    expect(source).toContain("multiplyMinor");
    expect(source).toContain("sumMinor");
    expect(source).not.toContain("parseFloat");
    expect(source).not.toContain("toFixed");
  });

  it("proposals route mints share codes via the house generator and hashes payloads", async () => {
    const source = await readFile(resolve("src/routes/proposals.ts"), "utf-8");
    expect(source).toContain("generateUniqueShortCode");
    expect(source).toContain("proposalVersionPayloadDigest");
    expect(source).toContain("canTransitionProposal");
    expect(source).toContain("proposalStatusHistory");
  });

  it("staff comment route reuses the claim-guarded comment-body schema", async () => {
    const source = await readFile(resolve("src/routes/proposals.ts"), "utf-8");
    expect(source).toContain("CreateProposalCommentSchema.shape.body");
    expect(source).toContain("proposalComments");
  });
});

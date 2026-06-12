import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_A = "00000000-0000-4000-8000-00000000000a";
const VENUE_B = "00000000-0000-4000-8000-00000000000b";
const ENQUIRY_ID = "00000000-0000-4000-8000-000000000010";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000011";
const PROPOSAL_ID = "00000000-0000-4000-8000-000000000012";
const QUOTE_ID = "00000000-0000-4000-8000-000000000013";
const SHARE_TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEF1234567890_-";

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

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

describe("commercial CRM and opportunity routes", () => {
  it("requires auth for staff commercial surfaces", async () => {
    for (const [method, url] of [
      ["GET", "/crm/pipeline"],
      ["POST", `/crm/from-enquiry/${ENQUIRY_ID}`],
      ["GET", "/opportunities"],
      ["POST", "/opportunities"],
      ["GET", `/opportunities/${OPPORTUNITY_ID}`],
      ["PATCH", `/opportunities/${OPPORTUNITY_ID}`],
      ["POST", `/opportunities/${OPPORTUNITY_ID}/activities`],
      ["POST", `/opportunities/${OPPORTUNITY_ID}/tasks`],
      ["PATCH", `/opportunities/${OPPORTUNITY_ID}/tasks/${QUOTE_ID}`],
    ] as const) {
      const res = await server.inject({ method, url, payload: method !== "GET" ? {} : undefined });
      expect(res.statusCode).toBe(401);
    }
  });

  it("rejects planner access to the pipeline", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/crm/pipeline",
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("venue-scopes opportunity creation", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/opportunities",
      headers: { authorization: `Bearer ${staffBToken()}` },
      payload: { venueId: VENUE_A, title: "Cross-venue opportunity" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("validates opportunity create and activity/task payloads before database work", async () => {
    const invalidOpportunity = await server.inject({
      method: "POST",
      url: "/opportunities",
      headers: { authorization: `Bearer ${staffAToken()}` },
      payload: { venueId: VENUE_A },
    });
    expect(invalidOpportunity.statusCode).toBe(400);

    const validOpportunity = await server.inject({
      method: "POST",
      url: "/opportunities",
      headers: { authorization: `Bearer ${staffAToken()}` },
      payload: {
        venueId: VENUE_A,
        title: "Grand Hall wedding",
        estimatedValueMinor: 450000,
        nextAction: "Prepare proposal draft with planning-grade assumptions.",
      },
    });
    expect(validOpportunity.statusCode).not.toBe(400);
    expect(validOpportunity.statusCode).not.toBe(401);
    expect(validOpportunity.statusCode).not.toBe(403);

    const unsafeActivity = await server.inject({
      method: "POST",
      url: `/opportunities/${OPPORTUNITY_ID}/activities`,
      headers: { authorization: `Bearer ${staffAToken()}` },
      payload: { type: "note", body: "This says fire approved." },
    });
    expect(unsafeActivity.statusCode).toBe(400);

    const validTask = await server.inject({
      method: "POST",
      url: `/opportunities/${OPPORTUNITY_ID}/tasks`,
      headers: { authorization: `Bearer ${staffAToken()}` },
      payload: { title: "Call client", dueAt: "2026-06-13T12:00:00.000Z" },
    });
    expect(validTask.statusCode).not.toBe(400);
    expect(validTask.statusCode).not.toBe(401);
  });
});

describe("proposal-share and quote extension routes", () => {
  it("requires staff auth before generating a proposal share token", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/proposals/${PROPOSAL_ID}/share-token`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates token share routes without auth", async () => {
    const malformed = await server.inject({ method: "GET", url: "/proposal-share/bad" });
    expect(malformed.statusCode).toBe(400);

    const wellFormed = await server.inject({ method: "GET", url: `/proposal-share/${SHARE_TOKEN}` });
    expect(wellFormed.statusCode).not.toBe(400);
    expect(wellFormed.statusCode).not.toBe(401);
  });

  it("claim-guards client comments and approval notes", async () => {
    const unsafeComment = await server.inject({
      method: "POST",
      url: `/proposal-share/${SHARE_TOKEN}/comment`,
      payload: { body: "Please call this certified safe.", kind: "request_changes" },
    });
    expect(unsafeComment.statusCode).toBe(400);

    const unsafeApproval = await server.inject({
      method: "POST",
      url: `/proposal-share/${SHARE_TOKEN}/approve`,
      payload: { body: "Approved because it is legally compliant." },
    });
    expect(unsafeApproval.statusCode).toBe(400);
  });

  it("validates quote line item append and exact-money input", async () => {
    const noAuth = await server.inject({
      method: "POST",
      url: `/quotes/${QUOTE_ID}/line-items`,
      payload: { description: "Hire", quantity: 1, unitAmountMinor: 1000 },
    });
    expect(noAuth.statusCode).toBe(401);

    const fractional = await server.inject({
      method: "POST",
      url: `/quotes/${QUOTE_ID}/line-items`,
      headers: { authorization: `Bearer ${staffAToken()}` },
      payload: { description: "Hire", quantity: 1, unitAmountMinor: 12.5 },
    });
    expect(fractional.statusCode).toBe(400);

    const valid = await server.inject({
      method: "POST",
      url: `/quotes/${QUOTE_ID}/line-items`,
      headers: { authorization: `Bearer ${staffAToken()}` },
      payload: { description: "Room hire", quantity: 2, unitAmountMinor: 1000 },
    });
    expect(valid.statusCode).not.toBe(400);
    expect(valid.statusCode).not.toBe(401);
  });
});

describe("commercial route source guards", () => {
  it("proposal share tokens are hashed before persistence", async () => {
    const source = await readFile(resolve("src/routes/proposals.ts"), "utf-8");
    expect(source).toContain("hashShareToken");
    expect(source).toContain("tokenHash");
    expect(source).toContain("randomBytes");
    expect(source).not.toContain("token: proposalShareTokens");
  });

  it("quote line append recomputes totals with the exact money engine", async () => {
    const source = await readFile(resolve("src/routes/quotes.ts"), "utf-8");
    expect(source).toContain("POST /quotes/:id/line-items");
    expect(source).toContain("multiplyMinor");
    expect(source).toContain("sumMinor");
  });
});

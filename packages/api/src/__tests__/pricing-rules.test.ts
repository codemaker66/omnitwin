import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Pricing rule route tests
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const VENUE_ID = "00000000-0000-0000-0000-000000000001";
const RULE_ID = "00000000-0000-0000-0000-000000000050";
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: VENUE_ID });
const staffToken = (): string => signToken({ id: "u2", email: "staff@test.com", role: "staff", venueId: VENUE_ID });
const clientToken = (): string => signToken({ id: "u3", email: "client@test.com", role: "client", venueId: null });
const otherStaff = (): string => signToken({ id: "u4", email: "other@test.com", role: "staff", venueId: "00000000-0000-0000-0000-999999999999" });

const validRule = {
  name: "Grand Hall Hire",
  type: "flat_rate" as const,
  amount: 1500,
};

describe("GET /venues/:venueId/pricing", () => {
  it("is public (no auth required)", async () => {
    const res = await server.inject({ method: "GET", url: `/venues/${VENUE_ID}/pricing` });
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 for invalid venue UUID", async () => {
    const res = await server.inject({ method: "GET", url: "/venues/bad/pricing" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /venues/:venueId/pricing", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "POST", url: `/venues/${VENUE_ID}/pricing`, payload: validRule });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for client role", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/pricing`,
      headers: { authorization: `Bearer ${clientToken()}` }, payload: validRule,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for staff of different venue", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/pricing`,
      headers: { authorization: `Bearer ${otherStaff()}` }, payload: validRule,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for missing name", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/pricing`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { type: "flat_rate", amount: 100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid type", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/pricing`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Test", type: "invalid_type", amount: 100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes validation for admin (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/pricing`,
      headers: { authorization: `Bearer ${adminToken()}` }, payload: validRule,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("passes validation for venue staff (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/pricing`,
      headers: { authorization: `Bearer ${staffToken()}` }, payload: validRule,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(403);
  });

  it("accepts tiered pricing with tiers array", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/pricing`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        name: "Tiered",
        type: "tiered",
        amount: 0,
        tiers: [{ upTo: 50, amount: 500 }, { upTo: 100, amount: 800 }],
      },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("accepts day-of-week and seasonal modifiers", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/pricing`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        ...validRule,
        dayOfWeekModifiers: { saturday: 1.25, sunday: 1.5 },
        seasonalModifiers: { december: 1.3 },
      },
    });
    expect(res.statusCode).not.toBe(400);
  });
});

describe("DELETE /venues/:venueId/pricing/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "DELETE", url: `/venues/${VENUE_ID}/pricing/${RULE_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for client", async () => {
    const res = await server.inject({
      method: "DELETE", url: `/venues/${VENUE_ID}/pricing/${RULE_ID}`,
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

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
const roleToken = (role: string): string => signToken({ id: `u-${role}`, email: `${role}@test.com`, role, venueId: VENUE_ID });

const validRule = {
  name: "Grand Hall Hire",
  type: "flat_rate" as const,
  amount: 1500,
};

describe("GET /venues/:venueId/pricing", () => {
  // Prices are the venue's commercial team's (Blake, 17 October 2026); the
  // full gate is in pricing-rules-read-guard.test.ts.
  it("asks who you are", async () => {
    const res = await server.inject({ method: "GET", url: `/venues/${VENUE_ID}/pricing` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid venue UUID", async () => {
    const res = await server.inject({
      method: "GET", url: "/venues/bad/pricing", headers: { authorization: `Bearer ${staffToken()}` },
    });
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

  it("passes the gate for a venue manager (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/pricing`,
      headers: { authorization: `Bearer ${roleToken("manager")}` }, payload: validRule,
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

describe("POST /venues/:venueId/pricing/:id/restore", () => {
  const url = `/venues/${VENUE_ID}/pricing/${RULE_ID}/restore`;

  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a client and for another venue's staff", async () => {
    for (const token of [clientToken(), otherStaff()]) {
      const res = await server.inject({
        method: "POST", url, headers: { authorization: `Bearer ${token}` }, payload: {},
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("returns 400 for an invalid rule id or body", async () => {
    const badId = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/pricing/not-a-uuid/restore`,
      headers: { authorization: `Bearer ${adminToken()}` }, payload: {},
    });
    expect(badId.statusCode).toBe(400);
    const badBody = await server.inject({
      method: "POST", url, headers: { authorization: `Bearer ${adminToken()}` }, payload: { isActive: "yes" },
    });
    expect(badBody.statusCode).toBe(400);
  });
});

describe("who may set a price (PRICING_WRITE_ROLES)", () => {
  const writes = [
    { method: "POST" as const, url: `/venues/${VENUE_ID}/pricing`, payload: validRule },
    { method: "PATCH" as const, url: `/venues/${VENUE_ID}/pricing/${RULE_ID}`, payload: { amount: 1750 } },
    { method: "DELETE" as const, url: `/venues/${VENUE_ID}/pricing/${RULE_ID}`, payload: undefined },
    { method: "POST" as const, url: `/venues/${VENUE_ID}/pricing/${RULE_ID}/restore`, payload: {} },
  ];

  it.each(["staff", "sales", "hallkeeper", "planner", "caterer"])("refuses every price write to %s at the venue", async (role) => {
    for (const write of writes) {
      const res = await server.inject({
        method: write.method, url: write.url,
        headers: { authorization: `Bearer ${roleToken(role)}` },
        ...(write.payload === undefined ? {} : { payload: write.payload }),
      });
      expect(res.statusCode, `${role} ${write.method} ${write.url}`).toBe(403);
      // The refusal says who can make the change, as a way forward.
      expect(res.json<{ error: string; code: string }>()).toEqual({
        error: "Prices are set by an administrator or a manager at the venue. Ask them to make this change.",
        code: "FORBIDDEN",
      });
    }
  });

  it("lets an admin and a manager past the gate for every write (the mock database then fails)", async () => {
    for (const role of ["admin", "manager"]) {
      for (const write of writes) {
        const res = await server.inject({
          method: write.method, url: write.url,
          headers: { authorization: `Bearer ${roleToken(role)}` },
          ...(write.payload === undefined ? {} : { payload: write.payload }),
        });
        expect(res.statusCode, `${role} ${write.method} ${write.url}`).not.toBe(403);
        expect(res.statusCode).not.toBe(401);
      }
    }
  });

  it("lets the commercial team read prices it cannot set, and no one signed out", async () => {
    for (const role of ["staff", "sales"]) {
      const res = await server.inject({
        method: "GET", url: `/venues/${VENUE_ID}/pricing`, headers: { authorization: `Bearer ${roleToken(role)}` },
      });
      expect(res.statusCode, role).not.toBe(401);
      expect(res.statusCode, role).not.toBe(403);
    }
    const signedOut = await server.inject({ method: "GET", url: `/venues/${VENUE_ID}/pricing` });
    expect(signedOut.statusCode).toBe(401);
  });
});

describe("GET /venues/:venueId/pricing/:id/history", () => {
  const url = `/venues/${VENUE_ID}/pricing/${RULE_ID}/history`;

  it("needs a signed-in member of the venue's administration", async () => {
    expect((await server.inject({ method: "GET", url })).statusCode).toBe(401);
    for (const token of [clientToken(), otherStaff(), roleToken("sales"), roleToken("hallkeeper")]) {
      const res = await server.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(403);
    }
  });

  it("returns 400 for a rule id that is not a uuid", async () => {
    const res = await server.inject({
      method: "GET", url: `/venues/${VENUE_ID}/pricing/not-a-uuid/history`,
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("pricing rule windows (0089)", () => {
  const post = (payload: Record<string, unknown>) => server.inject({
    method: "POST", url: `/venues/${VENUE_ID}/pricing`,
    headers: { authorization: `Bearer ${adminToken()}` }, payload: { ...validRule, ...payload },
  });

  it("refuses a window with one side only", async () => {
    const res = await post({ appliesFrom: "09:00" });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("both, or neither");
    const other = await post({ appliesUntil: "13:00" });
    expect(other.statusCode).toBe(400);
  });

  it("refuses a time that is not HH:MM on a 24-hour clock", async () => {
    for (const bad of ["9:00", "24:00", "13:60", "1pm", "09:00:00"]) {
      const res = await post({ appliesFrom: bad, appliesUntil: "13:00" });
      expect(res.statusCode, bad).toBe(400);
    }
  });

  it("accepts both sides, and both null, as far as validation goes", async () => {
    // The mock database answers nothing, so a valid body gets past validation
    // and fails later: anything but 400 is a pass here.
    expect((await post({ appliesFrom: "19:00", appliesUntil: "00:30" })).statusCode).not.toBe(400);
    expect((await post({ appliesFrom: null, appliesUntil: null })).statusCode).not.toBe(400);
  });
});

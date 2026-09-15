import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Role vocabulary — route gates (goal 18 §2 line 25, §6 decisions 6a and 6b)
//
// Every route whose gate this lane changes is checked three ways: 401 with no
// identity, 403 for a role that must not reach it (including across venues),
// and 400 for malformed input. Where a role IS allowed the handler runs on to
// the database, which this suite does not provide — so the allowed case
// asserts "not 401/403" the way spaces.test.ts already does. That is an
// authorisation claim, not a persistence claim.
//
// The decisions under test:
//   6a  caterer, sales and manager join the vocabulary.
//   6b  hallkeepers lose edit on venue, spaces and pricing, and never see
//       prices; they keep inventory read and room-state write.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

const VENUE_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_VENUE_ID = "00000000-0000-0000-0000-000000000002";

function token(role: string, venueId: string | null = VENUE_ID): string {
  return JSON.stringify({ id: `u-${role}`, email: `${role}@test.com`, role, venueId });
}

function auth(role: string, venueId: string | null = VENUE_ID): { authorization: string } {
  return { authorization: `Bearer ${token(role, venueId)}` };
}

/** The authorisation claim: the gate let this identity through. */
function expectAllowedThrough(statusCode: number): void {
  expect(statusCode).not.toBe(401);
  expect(statusCode).not.toBe(403);
}

// ---------------------------------------------------------------------------
// Spaces — venue administration (POST /venues/:venueId/spaces)
// ---------------------------------------------------------------------------

describe("POST /venues/:venueId/spaces — venue administration", () => {
  const validBody = {
    name: "Test Hall",
    slug: "test-hall",
    heightM: 4,
    floorPlanOutline: [{ x: -5, y: -4 }, { x: 5, y: -4 }, { x: 5, y: 4 }, { x: -5, y: 4 }],
  };

  const url = `/venues/${VENUE_ID}/spaces`;

  it("returns 401 without an identity", async () => {
    const res = await server.inject({ method: "POST", url, payload: validBody });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for a malformed body", async () => {
    const res = await server.inject({ method: "POST", url, headers: auth("admin"), payload: { name: "Test" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a hallkeeper at this venue (decision 6b)", async () => {
    const res = await server.inject({ method: "POST", url, headers: auth("hallkeeper"), payload: validBody });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for a caterer and for a sales identity at this venue", async () => {
    for (const role of ["caterer", "sales"]) {
      const res = await server.inject({ method: "POST", url, headers: auth(role), payload: validBody });
      expect(res.statusCode).toBe(403);
    }
  });

  it("returns 403 across venues for every administering role", async () => {
    for (const role of ["admin", "manager", "staff"]) {
      const res = await server.inject({
        method: "POST", url, headers: auth(role, OTHER_VENUE_ID), payload: validBody,
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("lets a manager at this venue through the gate", async () => {
    const res = await server.inject({ method: "POST", url, headers: auth("manager"), payload: validBody });
    expectAllowedThrough(res.statusCode);
  });
});

// ---------------------------------------------------------------------------
// Pricing rules — venue administration, and hallkeepers never see prices
// ---------------------------------------------------------------------------

describe("POST /venues/:venueId/pricing — venue administration", () => {
  const validBody = { name: "Evening hire", type: "flat_rate", amount: 1200, currency: "GBP" };
  const url = `/venues/${VENUE_ID}/pricing`;

  it("returns 401 without an identity", async () => {
    const res = await server.inject({ method: "POST", url, payload: validBody });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for a malformed body from an administering identity", async () => {
    const res = await server.inject({
      method: "POST", url, headers: auth("admin"), payload: { name: "", type: "not_a_pricing_type" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a hallkeeper at this venue (decision 6b)", async () => {
    const res = await server.inject({ method: "POST", url, headers: auth("hallkeeper"), payload: validBody });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 across venues", async () => {
    const res = await server.inject({
      method: "POST", url, headers: auth("manager", OTHER_VENUE_ID), payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets a manager at this venue through the gate", async () => {
    const res = await server.inject({ method: "POST", url, headers: auth("manager"), payload: validBody });
    expectAllowedThrough(res.statusCode);
  });
});

// ---------------------------------------------------------------------------
// Integrations — venue administration; planner removed, venue admin added
// ---------------------------------------------------------------------------

describe("POST /integrations — venue administration", () => {
  const validBody = { venueId: VENUE_ID, provider: "calendar", label: "Room calendar" };

  it("returns 401 without an identity", async () => {
    const res = await server.inject({ method: "POST", url: "/integrations", payload: validBody });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for a malformed body", async () => {
    const res = await server.inject({
      method: "POST", url: "/integrations", headers: auth("admin"),
      payload: { venueId: "not-a-uuid", provider: "calendar", label: "Room calendar" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a planner at this venue", async () => {
    const res = await server.inject({
      method: "POST", url: "/integrations", headers: auth("planner"), payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for a hallkeeper and a caterer at this venue", async () => {
    for (const role of ["hallkeeper", "caterer"]) {
      const res = await server.inject({
        method: "POST", url: "/integrations", headers: auth(role), payload: validBody,
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("returns 403 across venues", async () => {
    const res = await server.inject({
      method: "POST", url: "/integrations", headers: auth("admin", OTHER_VENUE_ID), payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets this venue's own admin through the gate", async () => {
    const res = await server.inject({
      method: "POST", url: "/integrations", headers: auth("admin"), payload: validBody,
    });
    expectAllowedThrough(res.statusCode);
  });
});

// ---------------------------------------------------------------------------
// Revenue analytics — the commercial surface; hallkeepers never see prices
// ---------------------------------------------------------------------------

describe("GET /analytics/pipeline-summary — commercial surface", () => {
  const url = "/analytics/pipeline-summary";

  it("returns 401 without an identity", async () => {
    const res = await server.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for a malformed venueId query", async () => {
    const res = await server.inject({ method: "GET", url: `${url}?venueId=not-a-uuid`, headers: auth("admin") });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a hallkeeper — prices are not a hallkeeper surface (decision 6b)", async () => {
    const res = await server.inject({ method: "GET", url, headers: auth("hallkeeper") });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for a planner, a client and a caterer", async () => {
    for (const role of ["planner", "client", "caterer"]) {
      const res = await server.inject({ method: "GET", url, headers: auth(role) });
      expect(res.statusCode).toBe(403);
    }
  });

  it("returns 403 when the requested venue is not the identity's venue", async () => {
    const res = await server.inject({ method: "GET", url: `${url}?venueId=${OTHER_VENUE_ID}`, headers: auth("sales") });
    expect(res.statusCode).toBe(403);
  });

  it("lets sales and manager at this venue through the gate", async () => {
    for (const role of ["sales", "manager"]) {
      const res = await server.inject({ method: "GET", url, headers: auth(role) });
      expectAllowedThrough(res.statusCode);
    }
  });
});

// ---------------------------------------------------------------------------
// Proposals and quotes — the commercial surface
// ---------------------------------------------------------------------------

describe("POST /proposals — commercial surface", () => {
  const validBody = { venueId: VENUE_ID, title: "Winter dinner" };

  it("returns 401 without an identity", async () => {
    const res = await server.inject({ method: "POST", url: "/proposals", payload: validBody });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for a malformed body", async () => {
    const res = await server.inject({
      method: "POST", url: "/proposals", headers: auth("admin"), payload: { venueId: VENUE_ID, title: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for planner, hallkeeper, client and caterer", async () => {
    for (const role of ["planner", "hallkeeper", "client", "caterer"]) {
      const res = await server.inject({
        method: "POST", url: "/proposals", headers: auth(role), payload: validBody,
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("returns 403 across venues", async () => {
    const res = await server.inject({
      method: "POST", url: "/proposals", headers: auth("sales", OTHER_VENUE_ID), payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets sales and manager at this venue through the gate", async () => {
    for (const role of ["sales", "manager"]) {
      const res = await server.inject({
        method: "POST", url: "/proposals", headers: auth(role), payload: validBody,
      });
      expectAllowedThrough(res.statusCode);
    }
  });
});

describe("POST /quotes — commercial surface", () => {
  const validBody = {
    venueId: VENUE_ID,
    name: "Winter dinner quote",
    lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 120000 }],
  };

  it("returns 401 without an identity", async () => {
    const res = await server.inject({ method: "POST", url: "/quotes", payload: validBody });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when the line items are missing", async () => {
    const res = await server.inject({
      method: "POST", url: "/quotes", headers: auth("admin"),
      payload: { venueId: VENUE_ID, name: "Winter dinner quote", lineItems: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for planner, hallkeeper and caterer", async () => {
    for (const role of ["planner", "hallkeeper", "caterer"]) {
      const res = await server.inject({ method: "POST", url: "/quotes", headers: auth(role), payload: validBody });
      expect(res.statusCode).toBe(403);
    }
  });

  it("returns 403 across venues", async () => {
    const res = await server.inject({
      method: "POST", url: "/quotes", headers: auth("manager", OTHER_VENUE_ID), payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets sales and manager at this venue through the gate", async () => {
    for (const role of ["sales", "manager"]) {
      const res = await server.inject({ method: "POST", url: "/quotes", headers: auth(role), payload: validBody });
      expectAllowedThrough(res.statusCode);
    }
  });
});

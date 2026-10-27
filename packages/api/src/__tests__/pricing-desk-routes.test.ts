import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { pricingDeskRoutes } from "../routes/pricing-desk.js";
import { pricingRuleRoutes } from "../routes/pricing-rules.js";

// ---------------------------------------------------------------------------
// Who may open the Pricing desk, read its suggestions and dismiss one.
//
// Every refusal here must happen before the database is touched, so the
// refused server is given a database that fails the test on any use. The
// admitted server is given one that answers every read with nothing, so an
// admitted request ends in the venue's 404, not a refusal.
// ---------------------------------------------------------------------------

const VENUE = "44444444-4444-4444-8444-444444444444";
const OTHER_VENUE = "44444444-4444-4444-8444-444444444999";
const RULE = "55555555-5555-4555-8555-555555555501";
const KEY = `${RULE}:2027-06-12:raise`;

function token(role: string, venueId: string | null = VENUE, platformRole = "none"): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id: `u-${role}`, email: `${role}@example.test`, role, platformRole, venueId })}` };
}

/** A database that refuses to be used at all. */
function untouchable(): Database {
  const fail = (): never => { throw new Error("The database was touched before the gate refused"); };
  return new Proxy({}, { get: fail }) as Database;
}

/** A database whose every read finds nothing. */
function empty(): Database {
  const chain: object = new Proxy(function chained() { /* a query builder */ }, {
    get(_target, property) {
      if (property === "then") return (resolve: (rows: unknown[]) => void) => { resolve([]); };
      return () => chain;
    },
    apply: () => chain,
  });
  return chain as Database;
}

async function serverWith(db: Database): Promise<FastifyInstance> {
  const server = Fastify();
  await server.register(pricingDeskRoutes, { db, prefix: "/venues/:venueId/pricing-desk" });
  await server.register(pricingRuleRoutes, { db, prefix: "/venues/:venueId/pricing" });
  await server.ready();
  return server;
}

let refusing: FastifyInstance;
let admitting: FastifyInstance;

beforeAll(async () => {
  refusing = await serverWith(untouchable());
  admitting = await serverWith(empty());
});
afterAll(async () => {
  await refusing.close();
  await admitting.close();
});

const DESK = `/venues/${VENUE}/pricing-desk`;
const REFUSAL = "Prices are set by an administrator or a manager at the venue. Ask them to make this change.";

describe("the price list", () => {
  it("asks who you are", async () => {
    expect((await refusing.inject({ method: "GET", url: DESK })).statusCode).toBe(401);
  });

  it("is the venue's commercial team's: sales and staff read it", async () => {
    for (const role of ["admin", "manager", "staff", "sales"]) {
      const res = await admitting.inject({ method: "GET", url: DESK, headers: token(role) });
      expect(res.statusCode, role).toBe(404);
    }
  });

  it("is not shown to the hallkeeper, a planner, a client or a caterer", async () => {
    for (const role of ["hallkeeper", "planner", "client", "caterer"]) {
      const res = await refusing.inject({ method: "GET", url: DESK, headers: token(role) });
      expect(res.statusCode, role).toBe(403);
    }
  });

  it("is never another venue's", async () => {
    const res = await refusing.inject({ method: "GET", url: DESK, headers: token("manager", OTHER_VENUE) });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a malformed venue", async () => {
    const res = await refusing.inject({ method: "GET", url: "/venues/not-a-venue/pricing-desk", headers: token("admin") });
    expect(res.statusCode).toBe(400);
  });
});

describe("suggestions", () => {
  it("are for the people who set prices", async () => {
    for (const role of ["admin", "manager"]) {
      const res = await admitting.inject({ method: "GET", url: `${DESK}/advice`, headers: token(role) });
      expect(res.statusCode, role).toBe(404);
    }
  });

  it("are refused to everyone else, with who to ask", async () => {
    for (const role of ["staff", "sales", "hallkeeper", "planner", "client"]) {
      const res = await refusing.inject({ method: "GET", url: `${DESK}/advice`, headers: token(role) });
      expect(res.statusCode, role).toBe(403);
      expect(res.json<{ error: string }>().error).toBe(REFUSAL);
    }
  });

  it("are never another venue's, even for its manager", async () => {
    const res = await refusing.inject({ method: "GET", url: `${DESK}/advice`, headers: token("manager", OTHER_VENUE) });
    expect(res.statusCode).toBe(403);
  });

  it("let a platform administrator read any venue's", async () => {
    const res = await admitting.inject({ method: "GET", url: `${DESK}/advice`, headers: token("admin", null, "admin") });
    expect(res.statusCode).toBe(404);
  });

  it("refuse a horizon outside a week to two years", async () => {
    for (const days of ["3", "800", "soon"]) {
      const res = await admitting.inject({ method: "GET", url: `${DESK}/advice?days=${days}`, headers: token("admin") });
      expect(res.statusCode, days).toBe(400);
    }
    const unknown = await admitting.inject({ method: "GET", url: `${DESK}/advice?apply=true`, headers: token("admin") });
    expect(unknown.statusCode).toBe(400);
  });
});

describe("dismissing a suggestion", () => {
  it("is refused to anyone who does not set prices, before anything is read", async () => {
    for (const role of ["staff", "sales", "hallkeeper"]) {
      const res = await refusing.inject({ method: "POST", url: `${DESK}/advice/dismissals`, headers: token(role), payload: { key: KEY } });
      expect(res.statusCode, role).toBe(403);
      const back = await refusing.inject({ method: "DELETE", url: `${DESK}/advice/dismissals/${KEY}`, headers: token(role) });
      expect(back.statusCode, role).toBe(403);
    }
  });

  it("takes only a suggestion's key", async () => {
    for (const payload of [{}, { key: "everything" }, { key: KEY, apply: true }]) {
      const res = await admitting.inject({ method: "POST", url: `${DESK}/advice/dismissals`, headers: token("manager"), payload });
      expect(res.statusCode).toBe(400);
    }
    const res = await admitting.inject({ method: "DELETE", url: `${DESK}/advice/dismissals/not-a-key`, headers: token("manager") });
    expect(res.statusCode).toBe(400);
  });

  it("finds no suggestion for a rate that is not this venue's", async () => {
    const res = await admitting.inject({ method: "POST", url: `${DESK}/advice/dismissals`, headers: token("manager"), payload: { key: KEY } });
    expect(res.statusCode).toBe(404);
  });
});

describe("saving a rate from a suggestion", () => {
  it("refuses dates that do not exist or run backwards", async () => {
    const base = { name: "Grand Hall — Evening, 12 Jun", type: "flat_rate", amount: 3150 };
    for (const dates of [{ validFrom: "2027-02-30" }, { validFrom: "2027-06-13", validTo: "2027-06-12" }]) {
      const res = await admitting.inject({ method: "POST", url: `/venues/${VENUE}/pricing`, headers: token("manager"), payload: { ...base, ...dates } });
      expect(res.statusCode, JSON.stringify(dates)).toBe(400);
    }
  });

  it("keeps a suggestion's key only when it names one of this venue's rates", async () => {
    const res = await admitting.inject({
      method: "POST", url: `/venues/${VENUE}/pricing`, headers: token("manager"),
      payload: { name: "Grand Hall — Evening, 12 Jun", type: "flat_rate", amount: 3150, adviceKey: KEY },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("That suggestion is not one of this venue's");
  });

  it("is still refused to staff, as every price write is", async () => {
    const res = await refusing.inject({
      method: "POST", url: `/venues/${VENUE}/pricing`, headers: token("staff"),
      payload: { name: "Grand Hall — Evening, 12 Jun", type: "flat_rate", amount: 3150, adviceKey: KEY },
    });
    expect(res.statusCode).toBe(403);
  });
});

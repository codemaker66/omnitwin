import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { pricingRules, spaces, venues } from "../db/schema.js";
import { pricingRuleRoutes } from "../routes/pricing-rules.js";

// ---------------------------------------------------------------------------
// Who may read a price (Blake, 17 October 2026): pricing suggestions are
// advice, never automatic and never exposed; a visitor is asked for an
// enquiry and never shown a price. A dated rate saved from a suggestion is an
// active rule like any other, so the list, the single rule and the estimate
// are the venue's commercial team's alone (canManageCommercial: admin,
// manager, staff, sales; a platform admin too).
//
// Refusals run against a database that fails the test on any use, so each
// one is decided before a lookup and says nothing about what exists. The
// leak check runs against a database that WOULD hand over the dated rule, so
// a missing gate shows up as the rule in the body.
// ---------------------------------------------------------------------------

const VENUE = "61616161-6161-4161-8161-616161616161";
const OTHER_VENUE = "61616161-6161-4161-8161-616161616999";
const HALL = "62626262-6262-4262-8262-626262626201";
const DATED_RULE = "63636363-6363-4363-8363-636363636301";
const STANDING_RULE = "63636363-6363-4363-8363-636363636302";

/** The Saturday a suggestion raised, and the one after it. */
const RAISED_DATE = "2027-06-12";
const NEXT_SATURDAY = "2027-06-19";
const RAISED_NAME = "Grand Hall — Evening, Saturday 12 June 2027";

function rule(id: string, name: string, amount: string, dates: { readonly validFrom: string | null; readonly validTo: string | null }): Record<string, unknown> {
  return {
    id, venueId: VENUE, spaceId: HALL, name, type: "flat_rate", amount, currency: "GBP",
    minHours: null, minGuests: null, tiers: null, dayOfWeekModifiers: null, seasonalModifiers: null,
    validFrom: dates.validFrom, validTo: dates.validTo, isActive: true, appliesFrom: "19:00", appliesUntil: "00:30",
    deletedAt: null, createdAt: "2026-10-17T09:00:00.000Z", updatedAt: "2026-10-17T09:00:00.000Z",
  };
}

/** Accepted from an add_dated suggestion: active, one date, a raised amount. */
const DATED = rule(DATED_RULE, RAISED_NAME, "3150.00", { validFrom: RAISED_DATE, validTo: RAISED_DATE });
const STANDING = rule(STANDING_RULE, "Grand Hall — Evening", "2800.00", { validFrom: null, validTo: null });

function token(role: string, venueId: string | null = VENUE, platformRole = "none"): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id: `u-${role}`, email: `${role}@example.test`, role, platformRole, venueId })}` };
}

/** A database that refuses to be used at all. */
function untouchable(): Database {
  const fail = (): never => { throw new Error("The database was touched before the gate refused"); };
  return new Proxy({}, { get: fail }) as Database;
}

/** A query builder that answers `rows` however it is chained. */
function answering(rows: readonly unknown[]): object {
  const chain: object = new Proxy(function chained() { /* a query builder */ }, {
    get(_target, property) {
      if (property === "then") return (resolve: (found: readonly unknown[]) => void) => { resolve(rows); };
      return () => chain;
    },
    apply: () => chain,
  });
  return chain;
}

/** A database holding one live venue, its hall, and its two evening rates. */
function stocked(): Database {
  const byTable = new Map<object, readonly unknown[]>([
    [venues, [{ id: VENUE }]],
    [spaces, [{ id: HALL }]],
    [pricingRules, [DATED, STANDING]],
  ]);
  const from = (table: object): object => answering(byTable.get(table) ?? []);
  return new Proxy({}, {
    get(_target, property) {
      if (property === "select") return () => ({ from });
      throw new Error(`A price read only selects; it touched ${String(property)}`);
    },
  }) as Database;
}

/** A database whose every read finds nothing. */
function empty(): Database {
  return answering([]) as Database;
}

async function serverWith(db: Database): Promise<FastifyInstance> {
  const server = Fastify();
  await server.register(pricingRuleRoutes, { db, prefix: "/venues/:venueId/pricing" });
  await server.ready();
  return server;
}

let refusing: FastifyInstance;
let stockedServer: FastifyInstance;
let emptyServer: FastifyInstance;

beforeAll(async () => {
  refusing = await serverWith(untouchable());
  stockedServer = await serverWith(stocked());
  emptyServer = await serverWith(empty());
});
afterAll(async () => {
  await refusing.close();
  await stockedServer.close();
  await emptyServer.close();
});

const LIST = `/venues/${VENUE}/pricing`;
const SINGLE = `/venues/${VENUE}/pricing/${DATED_RULE}`;
const ESTIMATE = `/venues/${VENUE}/pricing/estimate`;
const estimateFor = (eventDate: string): Record<string, unknown> => ({
  spaceId: HALL, eventDate, startTime: "19:00", endTime: "23:00", guestCount: 120,
});
const REFUSAL = { error: "The price list is kept by the venue's own team.", code: "FORBIDDEN" };

type Read = "list" | "single" | "estimate";
const READS: readonly Read[] = ["list", "single", "estimate"];

function read(server: FastifyInstance, which: Read, headers?: { authorization: string }): Promise<LightMyRequestResponse> {
  const auth = headers === undefined ? {} : { headers };
  if (which === "list") return server.inject({ method: "GET", url: LIST, ...auth });
  if (which === "single") return server.inject({ method: "GET", url: SINGLE, ...auth });
  return server.inject({ method: "POST", url: ESTIMATE, payload: estimateFor(RAISED_DATE), ...auth });
}

/** Everyone outside the venue's commercial team. */
const OUTSIDERS: readonly { readonly who: string; readonly headers: { authorization: string } }[] = [
  { who: "a signed-in client", headers: token("client", null) },
  { who: "a planner", headers: token("planner", null) },
  { who: "a client whose account names the venue", headers: token("client") },
  { who: "the venue's hallkeeper (decision 6b)", headers: token("hallkeeper") },
  { who: "the venue's caterer", headers: token("caterer") },
  { who: "another venue's staff", headers: token("staff", OTHER_VENUE) },
  { who: "another venue's manager", headers: token("manager", OTHER_VENUE) },
  { who: "another venue's sales", headers: token("sales", OTHER_VENUE) },
];

describe("reading a price signed out", () => {
  it.each(READS)("the %s asks who you are", async (which) => {
    const res = await read(refusing, which);
    expect(res.statusCode).toBe(401);
  });
});

describe("reading a price from outside the venue's commercial team", () => {
  for (const outsider of OUTSIDERS) {
    it.each(READS)(`refuses ${outsider.who} the %s, before any lookup`, async (which) => {
      const res = await read(refusing, which, outsider.headers);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(REFUSAL);
    });
  }

  it("never lets a dated rate's price reach anyone outside the team, even when the database would give it", async () => {
    const callers: readonly ({ authorization: string } | undefined)[] = [undefined, ...OUTSIDERS.map((outsider) => outsider.headers)];
    for (const headers of callers) {
      for (const which of READS) {
        const res = await read(stockedServer, which, headers);
        const label = `${headers?.authorization ?? "signed out"} ${which}`;
        expect([401, 403], label).toContain(res.statusCode);
        // Only the refusal: no rule, amount, date or name.
        expect(Object.keys(res.json<Record<string, unknown>>()).sort(), label).toEqual(["code", "error"]);
        for (const secret of [DATED_RULE, RAISED_DATE, "3150", RAISED_NAME, "validFrom", "amount", "total"]) {
          expect(res.body, `${label} leaked ${secret}`).not.toContain(secret);
        }
      }
    }
  });
});

describe("reading a price inside the venue's commercial team", () => {
  it.each(["admin", "manager", "staff", "sales"])("%s at the venue reads the list, the dated rate included", async (role) => {
    const res = await read(stockedServer, "list", token(role));
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    const listed = res.json<{ data: { id: string; amount: string; validFrom: string | null; validTo: string | null; isActive: boolean }[] }>().data;
    expect(listed.find((found) => found.id === DATED_RULE)).toMatchObject({
      amount: "3150.00", validFrom: RAISED_DATE, validTo: RAISED_DATE, isActive: true,
    });
  });

  it.each(["staff", "sales"])("%s at the venue reads the dated rule and is charged it on its date", async (role) => {
    const single = await read(stockedServer, "single", token(role));
    expect(single.statusCode).toBe(200);
    expect(single.headers["cache-control"]).toBe("private, no-store");
    expect(single.json<{ data: { validFrom: string | null } }>().data.validFrom).toBe(RAISED_DATE);

    const raised = await stockedServer.inject({ method: "POST", url: ESTIMATE, headers: token(role), payload: estimateFor(RAISED_DATE) });
    expect(raised.statusCode).toBe(200);
    expect(raised.headers["cache-control"]).toBe("private, no-store");
    expect(raised.json<{ data: { total: number } }>().data.total).toBe(3150);
    const everyday = await stockedServer.inject({ method: "POST", url: ESTIMATE, headers: token(role), payload: estimateFor(NEXT_SATURDAY) });
    expect(everyday.json<{ data: { total: number } }>().data.total).toBe(2800);
  });

  it("lets a platform admin read every venue's prices", async () => {
    const platformAdmin = token("client", null, "admin");
    for (const which of READS) {
      const res = await read(stockedServer, which, platformAdmin);
      expect(res.statusCode, which).toBe(200);
    }
  });

  it("still answers a missing venue with 404 once the caller may read", async () => {
    for (const which of READS) {
      const res = await read(emptyServer, which, token("sales"));
      expect(res.statusCode, which).toBe(404);
      expect(res.json<{ code: string }>().code).toBe("NOT_FOUND");
    }
  });

  it("checks the request's shape only for those it may answer", async () => {
    const badVenue = await refusing.inject({ method: "GET", url: "/venues/not-a-uuid/pricing", headers: token("sales") });
    expect(badVenue.statusCode).toBe(400);
    const badBody = await emptyServer.inject({ method: "POST", url: ESTIMATE, headers: token("sales"), payload: { spaceId: HALL } });
    expect(badBody.statusCode).toBe(400);
    const outsiderBadBody = await refusing.inject({ method: "POST", url: ESTIMATE, headers: token("client", null), payload: { spaceId: HALL } });
    expect(outsiderBadBody.statusCode).toBe(403);
  });
});

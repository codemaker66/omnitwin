import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";

// ---------------------------------------------------------------------------
// The People Book's door (T-665), with no database: every /people route asks
// for a sign-in, refuses every role outside the venue's commercial team before
// reading anything, lets sales in, and refuses a malformed id or body before
// the database is touched.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_A = "00000000-0000-4000-8000-00000000000a";
const ID = "00000000-0000-4000-8000-000000000020";
const ID2 = "00000000-0000-4000-8000-000000000021";

const ROUTES = [
  ["POST", "/people"], ["GET", `/people/${ID}`], ["PATCH", `/people/${ID}`],
  ["POST", `/people/${ID}/contact-points`], ["DELETE", `/people/${ID}/contact-points/${ID2}`],
  ["PUT", `/people/${ID}/memberships`], ["GET", `/people/${ID}/duplicates`],
  ["POST", `/people/${ID}/kept-apart`], ["DELETE", `/people/${ID}/kept-apart/${ID2}`],
  ["POST", "/people/organisations"], ["GET", `/people/organisations/${ID}`], ["PATCH", `/people/organisations/${ID}`],
  ["GET", "/people/search?q=murray"],
] as const; // Tasks 11 and 12 append theirs

type Method = typeof ROUTES[number][0];

function bearer(role: string, venueId: string | null): { authorization: string } {
  return {
    authorization: `Bearer ${JSON.stringify({
      id: "00000000-0000-4000-8000-000000000101",
      email: `${role}-a@example.test`,
      role,
      venueId,
    })}`,
  };
}

function request(method: Method, url: string, headers?: { authorization: string }, payload?: object): InjectOptions {
  return { method, url, ...(headers === undefined ? {} : { headers }), ...(method === "GET" ? {} : { payload: payload ?? {} }) };
}

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("the People Book's door", () => {
  it("asks every people route for a sign-in", async () => {
    for (const [method, url] of ROUTES) {
      const res = await server.inject(request(method, url));
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("refuses the book to every role outside the commercial team, before reading anything", async () => {
    const refused = [
      bearer("hallkeeper", VENUE_A),
      bearer("planner", VENUE_A),
      bearer("client", VENUE_A),
      bearer("caterer", VENUE_A),
      bearer("staff", null),
    ];
    for (const headers of refused) {
      for (const [method, url] of ROUTES) {
        const res = await server.inject(request(method, url, headers, { junk: true }));
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(res.json()).toMatchObject({ code: "FORBIDDEN" });
      }
    }
  });

  it("lets sales through the door", async () => {
    for (const [method, url] of ROUTES) {
      const res = await server.inject(request(method, url, bearer("sales", VENUE_A)));
      expect(res.statusCode, `${method} ${url}`).not.toBe(401);
      expect(res.statusCode, `${method} ${url}`).not.toBe(403);
    }
  }, 60_000);

  it("refuses a malformed id or body before the database", async () => {
    const staff = bearer("staff", VENUE_A);
    const cases: readonly [Method, string, object?][] = [
      ["GET", "/people/not-a-uuid"],
      ["PATCH", "/people/not-a-uuid", { jobTitle: "Chair" }],
      ["DELETE", `/people/${ID}/contact-points/not-a-uuid`],
      ["DELETE", `/people/${ID}/kept-apart/not-a-uuid`],
      ["POST", "/people", { venueId: VENUE_A }],
      ["POST", `/people/${ID}/contact-points`, { kind: "phone", value: "123" }],
      ["PUT", `/people/${ID}/memberships`, {
        memberships: [{ organisationId: ID, isPrimary: true }, { organisationId: ID2, isPrimary: true }],
      }],
      ["POST", `/people/${ID}/kept-apart`, { otherPersonId: "x" }],
      ["GET", "/people/organisations/not-a-uuid"],
      ["PATCH", "/people/organisations/not-a-uuid", { website: "medsoc.example.test" }],
      ["PATCH", `/people/organisations/${ID}`, {}],
      ["POST", "/people/organisations", { venueId: VENUE_A, name: "Murray household" }],
      ["GET", "/people/search?q=m"],
      ["GET", "/people/search"],
      ["GET", `/people/search?q=${"m".repeat(201)}`],
    ];
    for (const [method, url, payload] of cases) {
      const res = await server.inject(request(method, url, staff, payload));
      expect(res.statusCode, `${method} ${url}`).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });
});

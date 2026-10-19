import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// The competitor watch's routes as the server mounts them: nothing answers
// without sign-in, and nobody outside the venue's price-setters reaches the
// watch. No database is reached on these paths; the behaviour behind them is
// proven on PostgreSQL in competitor-watch-postgres.test.ts.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

const VENUE = "81818181-8181-4181-8181-818181818181";
const OTHER_VENUE = "81818181-8181-4181-8181-818181818999";
const COMPETITOR = "82828282-8282-4282-8282-828282828282";
const CAPTURE = "83838383-8383-4383-8383-838383838383";
const BASE = `/venues/${VENUE}/competitor-watch`;

let server: FastifyInstance;
beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function as(role: string, venueId: string | null = VENUE): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id: "84848484-8484-4484-8484-848484848484", email: `${role}@example.test`, role, venueId })}` };
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const WATCH_ROUTES: readonly (readonly [Method, string])[] = [
  ["GET", BASE],
  ["GET", `${BASE}/context?year=2027`],
  ["POST", BASE],
  ["POST", `${BASE}/suggested`],
  ["PATCH", `${BASE}/${COMPETITOR}`],
  ["DELETE", `${BASE}/${COMPETITOR}`],
  ["POST", `${BASE}/${COMPETITOR}/reviewed`],
  ["PUT", `${BASE}/${COMPETITOR}/page-check`],
  ["DELETE", `${BASE}/${COMPETITOR}/page-check`],
  ["POST", `${BASE}/${COMPETITOR}/page-change/dismissal`],
  ["POST", `${BASE}/${COMPETITOR}/captures`],
  ["POST", `${BASE}/${COMPETITOR}/captures/${CAPTURE}/source-gone`],
  ["POST", `${BASE}/page-checks`],
];

function payloadFor(method: Method): Record<string, never> | undefined {
  return method === "GET" || method === "DELETE" ? undefined : {};
}

describe("the competitor watch routes", () => {
  it("answer nothing without sign-in", async () => {
    const all: (readonly [Method, string])[] = [...WATCH_ROUTES, ["GET", `${BASE}/names`], ["POST", "/admin/competitor-watch/page-checks"]];
    for (const [method, url] of all) {
      const res = await server.inject({ method, url, payload: payloadFor(method) });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("refuse everyone but the venue's own price-setters, naming them", async () => {
    for (const role of ["staff", "sales", "hallkeeper", "client", "planner"]) {
      for (const [method, url] of WATCH_ROUTES) {
        const res = await server.inject({ method, url, headers: as(role), payload: payloadFor(method) });
        expect(res.statusCode, `${role} ${method} ${url}`).toBe(403);
        expect(res.json<{ error: string }>().error).toContain("kept by an administrator or a manager");
      }
    }
    for (const [method, url] of WATCH_ROUTES) {
      const res = await server.inject({ method, url, headers: as("manager", OTHER_VENUE), payload: payloadFor(method) });
      expect(res.statusCode, `another venue's manager: ${method} ${url}`).toBe(403);
    }
  });

  it("let only the commercial team read the set's names", async () => {
    for (const role of ["hallkeeper", "client", "planner"]) {
      expect((await server.inject({ method: "GET", url: `${BASE}/names`, headers: as(role) })).statusCode, role).toBe(403);
    }
    expect((await server.inject({ method: "GET", url: `${BASE}/names`, headers: as("sales", OTHER_VENUE) })).statusCode).toBe(403);
  });

  it("keep the unattended pass for a platform administrator or its token", async () => {
    const res = await server.inject({ method: "POST", url: "/admin/competitor-watch/page-checks", headers: as("admin") });
    expect(res.statusCode).toBe(403);
  });

  it("refuse a malformed venue, competitor or year before anything is read", async () => {
    expect((await server.inject({ method: "GET", url: "/venues/not-a-venue/competitor-watch", headers: as("manager") })).statusCode).toBe(400);
    expect((await server.inject({ method: "POST", url: `${BASE}/not-a-competitor/reviewed`, headers: as("manager") })).statusCode).toBe(400);
    expect((await server.inject({ method: "GET", url: `${BASE}/context?year=next`, headers: as("manager") })).statusCode).toBe(400);
    expect((await server.inject({ method: "POST", url: BASE, headers: as("manager"), payload: { name: "X", tier: "primary" } })).statusCode).toBe(400);
  });
});

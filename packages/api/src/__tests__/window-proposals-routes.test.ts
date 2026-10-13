import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// Goal 19 S6 — the propose door: who may knock and which shapes are refused
// before any database work. The link proof, the hygiene defaults, the replay
// and the decided window live in window-proposals-postgres.test.ts against a
// disposable cluster.

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-0000000a6001";
const EVENT_ID = "00000000-0000-4000-8000-0000000a6002";
const SPACE_ID = "00000000-0000-4000-8000-0000000a6003";
const KEY = "00000000-0000-4000-8000-0000000a6004";
const OTHER_KEY = "00000000-0000-4000-8000-0000000a6005";

function token(role: string, venueId: string | null = VENUE_ID): string {
  return JSON.stringify({
    id: "00000000-0000-4000-8000-0000000a6010", email: "s6@test.invalid", name: "Slice Six", role, venueId,
  });
}
function auth(role: string, venueId: string | null = VENUE_ID): Record<string, string> {
  return { authorization: `Bearer ${token(role, venueId)}` };
}
const window = { spaceId: SPACE_ID, startsAt: "2030-05-10T18:00:00.000Z", endsAt: "2030-05-10T23:00:00.000Z", idempotencyKey: KEY };

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("the propose door — PUT /events/:eventId/proposed-window", () => {
  it("asks for an identity first", async () => {
    const res = await server.inject({ method: "PUT", url: `/events/${EVENT_ID}/proposed-window`, payload: window });
    expect(res.statusCode).toBe(401);
  });

  it("refuses the roles that never propose before any database work", async () => {
    for (const role of ["hallkeeper", "manager", "sales", "caterer"]) {
      const res = await server.inject({
        method: "PUT", url: `/events/${EVENT_ID}/proposed-window`, headers: auth(role), payload: window,
      });
      expect(res.statusCode, role).toBe(403);
    }
  });

  it("refuses a body that names what the client may not set, and a window that ends before it starts", async () => {
    const rank = await server.inject({
      method: "PUT", url: `/events/${EVENT_ID}/proposed-window`, headers: auth("client", null),
      payload: { ...window, rank: 1 },
    });
    expect(rank.statusCode).toBe(400);
    const kind = await server.inject({
      method: "PUT", url: `/events/${EVENT_ID}/proposed-window`, headers: auth("client", null),
      payload: { ...window, kind: "ink" },
    });
    expect(kind.statusCode).toBe(400);
    const backwards = await server.inject({
      method: "PUT", url: `/events/${EVENT_ID}/proposed-window`, headers: auth("client", null),
      payload: { ...window, endsAt: "2030-05-10T17:00:00.000Z" },
    });
    expect(backwards.statusCode).toBe(400);
  });

  it("refuses a header key that disagrees with the body's", async () => {
    const res = await server.inject({
      method: "PUT", url: `/events/${EVENT_ID}/proposed-window`,
      headers: { ...auth("client", null), "idempotency-key": OTHER_KEY }, payload: window,
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses an event id that is not a uuid", async () => {
    const res = await server.inject({
      method: "PUT", url: "/events/not-an-event/proposed-window", headers: auth("client", null), payload: window,
    });
    expect(res.statusCode).toBe(400);
  });
});

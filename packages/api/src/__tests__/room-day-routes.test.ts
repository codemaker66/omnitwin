import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// Goal 19 S6 — the client's room-day door: GET /events/:eventId/room-day.
// What a client may see of a room's day before proposing a time: anonymous
// spans, never who booked. Who may knock and which shapes are refused before
// any database work live here; the projection's content on real rows lives
// in room-day-postgres.test.ts.

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;
const VENUE_ID = "00000000-0000-4000-8000-0000000a7001";
const EVENT_ID = "00000000-0000-4000-8000-0000000a7002";
const SPACE_ID = "00000000-0000-4000-8000-0000000a7003";

function auth(role: string, venueId: string | null = VENUE_ID): Record<string, string> {
  return { authorization: `Bearer ${JSON.stringify({ id: "00000000-0000-4000-8000-0000000a7010", email: "s6@test.invalid", name: "Slice Six", role, venueId })}` };
}

// Building the server loads every route; on a loaded machine that can pass
// the 10 s default, which is not a verdict on the door.
beforeAll(async () => { server = await buildServer(); }, 60_000);
afterAll(async () => { await server.close(); }, 60_000);

describe("the room-day door — GET /events/:eventId/room-day", () => {
  it("asks for an identity first", async () => {
    const res = await server.inject({ method: "GET", url: `/events/${EVENT_ID}/room-day?spaceId=${SPACE_ID}&day=2030-05-10` });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a caterer and a day or room it cannot read, before any database work", async () => {
    expect((await server.inject({ method: "GET", url: `/events/${EVENT_ID}/room-day?spaceId=${SPACE_ID}&day=2030-05-10`, headers: auth("caterer") })).statusCode).toBe(403);
    expect((await server.inject({ method: "GET", url: `/events/${EVENT_ID}/room-day?spaceId=${SPACE_ID}&day=10-05-2030`, headers: auth("client", null) })).statusCode).toBe(400);
    expect((await server.inject({ method: "GET", url: `/events/${EVENT_ID}/room-day?spaceId=not-a-room&day=2030-05-10`, headers: auth("client", null) })).statusCode).toBe(400);
    expect((await server.inject({ method: "GET", url: `/events/${EVENT_ID}/room-day?day=2030-05-10`, headers: auth("client", null) })).statusCode).toBe(400);
  });
});

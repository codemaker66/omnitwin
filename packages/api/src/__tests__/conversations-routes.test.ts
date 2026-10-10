import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// Goal 19 S1 — the conversation routes' door: who may knock and which shapes
// are refused before any database work. Tenancy against loaded rows, the
// audience on real threads, replayed keys and a revoked event link live in
// conversations-postgres.test.ts against a disposable cluster.

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-0000000a9001";
const BOOKING_ID = "00000000-0000-4000-8000-0000000a9002";
const THREAD_ID = "00000000-0000-4000-8000-0000000a9003";
const EVENT_ID = "00000000-0000-4000-8000-0000000a9004";
const KEY = "00000000-0000-4000-8000-0000000a9005";

function token(role: string, venueId: string | null = VENUE_ID): string {
  return JSON.stringify({
    id: "00000000-0000-4000-8000-0000000a9010", email: "s1@test.invalid", name: "Slice One", role, venueId,
  });
}

function auth(role = "staff", venueId: string | null = VENUE_ID): Record<string, string> {
  return { authorization: `Bearer ${token(role, venueId)}` };
}

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("conversations — the door", () => {
  it("refuses an unsigned thread open, list, read, send and receipt", async () => {
    const calls = [
      server.inject({ method: "POST", url: `/venues/${VENUE_ID}/threads`, payload: { audience: "staff-private", subject: "booking", bookingId: BOOKING_ID } }),
      server.inject({ method: "GET", url: `/venues/${VENUE_ID}/threads?bookingId=${BOOKING_ID}` }),
      server.inject({ method: "GET", url: `/threads/${THREAD_ID}/messages` }),
      server.inject({ method: "POST", url: `/threads/${THREAD_ID}/messages`, payload: { body: "hello", idempotencyKey: KEY } }),
      server.inject({ method: "POST", url: `/messages/${THREAD_ID}/receipt`, payload: { mark: "read" } }),
      server.inject({ method: "GET", url: `/events/${EVENT_ID}/conversation` }),
      server.inject({ method: "POST", url: `/events/${EVENT_ID}/requests`, payload: { bookingId: BOOKING_ID, kind: "chairs", quantity: 10, urgency: "soon", idempotencyKey: KEY } }),
    ];
    for (const res of await Promise.all(calls)) expect(res.statusCode).toBe(401);
  });

  it("turns away another venue's staff before any database work", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/threads`, headers: auth("staff", "00000000-0000-4000-8000-0000000a99ff"),
      payload: { audience: "staff-private", subject: "booking", bookingId: BOOKING_ID },
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a client who tries to open a venue thread, and a caterer anywhere", async () => {
    const client = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/threads`, headers: auth("client", null),
      payload: { audience: "client-facing", subject: "booking", bookingId: BOOKING_ID },
    });
    expect(client.statusCode).toBe(403);
    const caterer = await server.inject({
      method: "GET", url: `/venues/${VENUE_ID}/threads?bookingId=${BOOKING_ID}`, headers: auth("caterer"),
    });
    expect(caterer.statusCode).toBe(403);
  });

  it("refuses a hallkeeper opening a client-facing thread by hand", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/threads`, headers: auth("hallkeeper"),
      payload: { audience: "client-facing", subject: "booking", bookingId: BOOKING_ID },
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a malformed thread, message and receipt at the door", async () => {
    const thread = await server.inject({
      method: "POST", url: `/venues/${VENUE_ID}/threads`, headers: auth(),
      payload: { audience: "everyone", subject: "booking", bookingId: BOOKING_ID },
    });
    expect(thread.statusCode).toBe(400);
    const message = await server.inject({
      method: "POST", url: `/threads/${THREAD_ID}/messages`, headers: auth(),
      payload: { body: "x".repeat(2001), idempotencyKey: KEY },
    });
    expect(message.statusCode).toBe(400);
    const receipt = await server.inject({
      method: "POST", url: `/messages/${THREAD_ID}/receipt`, headers: auth(), payload: { mark: "delivered" },
    });
    expect(receipt.statusCode).toBe(400);
  });

  it("refuses a message that tries to carry a time or stock change", async () => {
    const res = await server.inject({
      method: "POST", url: `/threads/${THREAD_ID}/messages`, headers: auth(),
      payload: { body: "Make it 7pm and twelve more chairs", idempotencyKey: KEY, startsAt: "2026-10-10T19:00:00Z", quantity: 12 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a disagreement between the body key and the Idempotency-Key header", async () => {
    const res = await server.inject({
      method: "POST", url: `/threads/${THREAD_ID}/messages`, headers: { ...auth(), "idempotency-key": "00000000-0000-4000-8000-0000000a9006" },
      payload: { body: "hello", idempotencyKey: KEY },
    });
    expect(res.statusCode).toBe(400);
  });

  it("has no route that changes a thread's audience", async () => {
    const patch = await server.inject({
      method: "PATCH", url: `/threads/${THREAD_ID}`, headers: auth("admin"), payload: { audience: "client-facing" },
    });
    expect(patch.statusCode).toBe(404);
    const put = await server.inject({
      method: "PUT", url: `/threads/${THREAD_ID}`, headers: auth("admin"), payload: { audience: "client-facing" },
    });
    expect(put.statusCode).toBe(404);
  });

  it("refuses a client request that names a room or an audience", async () => {
    const res = await server.inject({
      method: "POST", url: `/events/${EVENT_ID}/requests`, headers: auth("client", null),
      payload: { roomId: BOOKING_ID, bookingId: BOOKING_ID, kind: "chairs", urgency: "soon", idempotencyKey: KEY },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a hallkeeper raising a request as if a client", async () => {
    const res = await server.inject({
      method: "POST", url: `/events/${EVENT_ID}/requests`, headers: auth("hallkeeper"),
      payload: { bookingId: BOOKING_ID, kind: "chairs", urgency: "soon", idempotencyKey: KEY },
    });
    expect(res.statusCode).toBe(403);
  });
});

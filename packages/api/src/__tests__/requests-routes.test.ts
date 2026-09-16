import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// The wire-level gates that hold BEFORE any database work: who may knock, and
// what shapes are refused at the door. The gates that need real rows — venue
// tenancy against a loaded row, audience immutability, the idempotency replay
// — live in requests-postgres.test.ts against a disposable cluster.

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-000000009001";
const ROOM_ID = "00000000-0000-4000-8000-000000009002";
const REQUEST_ID = "00000000-0000-4000-8000-000000009003";
const KEY = "00000000-0000-4000-8000-000000009004";
const OTHER_KEY = "00000000-0000-4000-8000-000000009005";

function token(role: string, venueId: string | null = VENUE_ID): string {
  return JSON.stringify({
    id: "00000000-0000-4000-8000-000000009010",
    email: "lane9@test.invalid",
    name: "Lane Nine",
    role,
    venueId,
  });
}

function auth(role = "hallkeeper", venueId: string | null = VENUE_ID): Record<string, string> {
  return { authorization: `Bearer ${token(role, venueId)}` };
}

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("requests API — the door", () => {
  it("refuses an unsigned request to make one", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/requests`,
      payload: { roomId: ROOM_ID, kind: "refreshments", urgency: "now", idempotencyKey: KEY },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses an unsigned read of the venue's requests", async () => {
    const res = await server.inject({ method: "GET", url: `/venues/${VENUE_ID}/requests` });
    expect(res.statusCode).toBe(401);
  });

  it("refuses an unsigned move", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/requests/${REQUEST_ID}`,
      payload: { to: "acknowledged" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("turns away a signed-in person from another venue before any database work", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/requests`,
      headers: auth("hallkeeper", "00000000-0000-4000-8000-0000000099ff"),
      payload: { roomId: ROOM_ID, kind: "refreshments", urgency: "now", idempotencyKey: KEY },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ readonly code: string }>().code).toBe("FORBIDDEN");
  });

  it("turns away a client, who is not on the staff floor", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/requests`,
      headers: auth("client"),
      payload: { roomId: ROOM_ID, kind: "refreshments", urgency: "now", idempotencyKey: KEY },
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a kind the product does not have", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/requests`,
      headers: auth(),
      payload: { roomId: ROOM_ID, kind: "fireworks", urgency: "now", idempotencyKey: KEY },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ readonly code: string }>().code).toBe("VALIDATION_ERROR");
  });

  it("refuses an urgency the product does not have", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/requests`,
      headers: auth(),
      payload: { roomId: ROOM_ID, kind: "refreshments", urgency: "immediately", idempotencyKey: KEY },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a press with no idempotency key at all", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/requests`,
      headers: auth(),
      payload: { roomId: ROOM_ID, kind: "refreshments", urgency: "now" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a body that tries to choose its own audience", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/requests`,
      headers: auth(),
      payload: {
        roomId: ROOM_ID,
        kind: "refreshments",
        urgency: "now",
        idempotencyKey: KEY,
        audienceRoles: ["admin"],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ readonly code: string }>().code).toBe("VALIDATION_ERROR");
  });

  it("refuses a body and header that disagree about the idempotency key", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/requests`,
      headers: { ...auth(), "idempotency-key": OTHER_KEY },
      payload: { roomId: ROOM_ID, kind: "refreshments", urgency: "now", idempotencyKey: KEY },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses an idempotency key that is not a uuid", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/requests`,
      headers: { ...auth(), "idempotency-key": "tablet-press-1" },
      payload: { roomId: ROOM_ID, kind: "refreshments", urgency: "now" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a resolution with no outcome", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/requests/${REQUEST_ID}`,
      headers: auth(),
      payload: { to: "resolved" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a step that is not on the ladder", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/requests/${REQUEST_ID}`,
      headers: auth(),
      payload: { to: "sent" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a list query it does not understand", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/venues/${VENUE_ID}/requests?status=everything`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a request id that is not a uuid", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/requests/not-a-uuid",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("lets nobody but a venue administrator run the escalation pass", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/requests/escalation-pass`,
      headers: auth("hallkeeper"),
    });
    expect(res.statusCode).toBe(403);
  });
});

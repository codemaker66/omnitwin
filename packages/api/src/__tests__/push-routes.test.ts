import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// Goal 19 S7: the door for push subscriptions, before any database work. The
// rows themselves are proven in push-postgres.test.ts.

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
delete process.env["VAPID_PUBLIC_KEY"];
delete process.env["VAPID_PRIVATE_KEY"];
delete process.env["VAPID_SUBJECT"];

const { buildServer } = await import("../index.js");

let server: FastifyInstance;
const VENUE_ID = "00000000-0000-4000-8000-000000009101";

function auth(role = "hallkeeper", venueId: string | null = VENUE_ID): Record<string, string> {
  return { authorization: `Bearer ${JSON.stringify({ id: "00000000-0000-4000-8000-000000009110", email: "push@test.invalid", name: "Push Tester", role, venueId })}` };
}

const subscription = {
  venueId: VENUE_ID,
  endpoint: "https://push.example.test/send/abc",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
  deviceKind: "phone",
};

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("push subscriptions — the door", () => {
  it("refuses an unsigned subscribe, read or unsubscribe", async () => {
    expect((await server.inject({ method: "POST", url: "/push/subscriptions", payload: subscription })).statusCode).toBe(401);
    expect((await server.inject({ method: "GET", url: "/push/vapid-public-key" })).statusCode).toBe(401);
    expect((await server.inject({ method: "GET", url: "/push/subscriptions/mine" })).statusCode).toBe(401);
    expect((await server.inject({ method: "DELETE", url: `/push/subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}` })).statusCode).toBe(401);
  });

  it("says push is off, plainly, while the keys are unset", async () => {
    const res = await server.inject({ method: "GET", url: "/push/vapid-public-key", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: null });
  });

  it("refuses a client, another venue's floor, and a malformed subscription before any database work", async () => {
    const client = await server.inject({ method: "POST", url: "/push/subscriptions", headers: auth("client", null), payload: subscription });
    expect(client.statusCode).toBe(403);
    const elsewhere = await server.inject({ method: "POST", url: "/push/subscriptions", headers: auth("hallkeeper", "00000000-0000-4000-8000-0000000099ff"), payload: subscription });
    expect(elsewhere.statusCode).toBe(403);
    for (const bad of [
      { ...subscription, endpoint: "http://push.example.test/plain" },
      { ...subscription, deviceKind: "tablet" },
      { ...subscription, keys: { p256dh: "k" } },
      { ...subscription, extra: true },
    ]) {
      const res = await server.inject({ method: "POST", url: "/push/subscriptions", headers: auth(), payload: bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    const unsub = await server.inject({ method: "DELETE", url: "/push/subscriptions?endpoint=not%20a%20url", headers: auth() });
    expect(unsub.statusCode).toBe(400);
  });
});

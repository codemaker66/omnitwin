import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type InjectOptions } from "fastify";
import { createDb } from "../db/client.js";
import { inventoryReservationsRoutes } from "../routes/inventory-reservations.js";

process.env["CLERK_SECRET_KEY"] = "sk_test_inventory_decision_route_fixture";
const venueId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const base = `/venues/${venueId}/inventory`;
const window = { startsAt: "2031-09-06T08:00:00Z", endsAt: "2031-09-06T23:00:00Z" };
const command = { commandId: otherId, eventId: otherId, spaceId: otherId, window,
  expectedSourceDigest: "a".repeat(64), expectedAssessmentDigest: "b".repeat(64), reason: "Confirmed", occupiedWindowConfirmed: true };
const requests: InjectOptions[] = [
  { method: "GET", url: `${base}/assessment?from=${window.startsAt}&to=${window.endsAt}` },
  { method: "POST", url: `${base}/reservations/approve`, payload: command },
  { method: "POST", url: `${base}/reservations/revoke`, payload: {} },
  { method: "GET", url: `${base}/reservations/${otherId}/${otherId}/history` },
  { method: "POST", url: `${base}/remedies/prepare`, payload: {} },
  { method: "POST", url: `${base}/remedies/${otherId}/approve`, payload: {} },
  { method: "GET", url: `${base}/remedies/${otherId}` },
];
function headers(role = "admin", scopedVenue: string | null = venueId, platformRole = "none") {
  return { authorization: `Bearer ${JSON.stringify({ id: otherId, email: "inventory@example.test", role, venueId: scopedVenue, platformRole })}` };
}
let server: FastifyInstance;
beforeAll(async () => {
  server = Fastify();
  await server.register(inventoryReservationsRoutes, { db: createDb("postgresql://mock:mock@localhost/mock"), prefix: "/venues" });
});
afterAll(async () => { await server.close(); });
describe("inventory decision authority and command validation", () => {
  it("requires valid authentication on every endpoint", async () => {
    for (const request of requests) {
      expect((await server.inject(request)).statusCode).toBe(401);
      expect((await server.inject({ ...request, headers: { authorization: "Bearer invalid" } })).statusCode).toBe(401);
    }
  });
  it.each(["staff", "hallkeeper", "client", "planner"])("denies %s across all decisions and readers", async (role) => {
    for (const request of requests) expect((await server.inject({ ...request, headers: headers(role) })).statusCode).toBe(403);
  });
  it("rejects cross-venue and platform-only permission before database access", async () => {
    for (const auth of [headers("admin", otherId), headers("admin", null, "admin"), headers("client", venueId, "admin")]) {
      for (const request of requests) expect((await server.inject({ ...request, headers: auth })).statusCode).toBe(403);
    }
  });
  it("rejects invalid observations, authority injection and unconfirmed occupancy", async () => {
    for (const patch of [{ occupiedWindowConfirmed: false }, { actorUserId: otherId }, { reason: " " },
      { window: { startsAt: window.startsAt, endsAt: "2032-09-06T23:00:00Z" } }]) {
      expect((await server.inject({ method: "POST", url: `${base}/reservations/approve`, headers: headers(), payload: { ...command, ...patch } })).statusCode).toBe(400);
    }
    expect((await server.inject({ method: "GET", url: `${base}/assessment?from=${window.startsAt}&to=${window.startsAt}`, headers: headers() })).statusCode).toBe(400);
    expect((await server.inject({ method: "GET", url: `${base}/remedies/bad-id`, headers: headers() })).statusCode).toBe(400);
  });
});

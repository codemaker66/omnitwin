import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
process.env["CLERK_SECRET_KEY"] = "sk_test_inventory_route_fixture";
const { buildServer } = await import("../index.js");
const venueId = "00000000-0000-4000-8000-000000000001";
const assetId = "00000000-0000-4000-8000-000000000002";
const base = `/venues/${venueId}/inventory`;
let server: FastifyInstance;

function headers(role = "admin", scopedVenue: string | null = venueId, platformRole = "none") {
  return { authorization: `Bearer ${JSON.stringify({ id: "00000000-0000-4000-8000-000000000003",
    email: "inventory@example.test", role, venueId: scopedVenue, platformRole })}` };
}

const input = { commandId: "00000000-0000-4000-8000-000000000004", expectedRevision: null,
  ownedQuantity: 200, damagedQuantity: 20, unavailableQuantity: 0, hires: [], storageLocation: "East store",
  status: "active", reason: "Physical count" };

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("venue inventory HTTP authority and validation", () => {
  it("requires authentication on list, adjustment and history", async () => {
    for (const request of [{ method: "GET" as const, url: base },
      { method: "POST" as const, url: `${base}/${assetId}/adjustments`, payload: input },
      { method: "GET" as const, url: `${base}/${assetId}/history` }]) {
      expect((await server.inject(request)).statusCode).toBe(401);
      expect((await server.inject({ ...request, headers: { authorization: "Bearer invalid" } })).statusCode).toBe(401);
    }
  });

  it.each(["staff", "hallkeeper", "planner", "client"])("denies %s on every surface", async (role) => {
    expect((await server.inject({ method: "GET", url: base, headers: headers(role) })).statusCode).toBe(403);
    expect((await server.inject({ method: "POST", url: `${base}/${assetId}/adjustments`, headers: headers(role), payload: input })).statusCode).toBe(403);
    expect((await server.inject({ method: "GET", url: `${base}/${assetId}/history`, headers: headers(role) })).statusCode).toBe(403);
  });

  it("denies cross-venue admins and platform-only authority before querying data", async () => {
    for (const auth of [headers("admin", assetId), headers("admin", null, "admin"), headers("client", venueId, "admin")]) {
      expect((await server.inject({ method: "GET", url: base, headers: auth })).statusCode).toBe(403);
      expect((await server.inject({ method: "POST", url: `${base}/${assetId}/adjustments`, headers: auth, payload: input })).statusCode).toBe(403);
    }
  });

  it.each([{ ownedQuantity: -1 }, { ownedQuantity: 1.5 }, { ownedQuantity: Number.MAX_SAFE_INTEGER + 1 },
    { unavailableQuantity: 181 }, { reason: " " }, { actorUserId: assetId }, { expectedRevision: -1 },
    { hires: [{ id: assetId, quantity: 10, startsAt: "2026-09-05T12:00:00Z", endsAt: "2026-09-05T11:00:00Z" }] }])(
    "rejects invalid or authority-injecting input %j", async (change) => {
      const response = await server.inject({ method: "POST", url: `${base}/${assetId}/adjustments`,
        headers: headers(), payload: { ...input, ...change } });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe("VALIDATION_ERROR");
    });

  it("rejects malformed paths and history pagination", async () => {
    expect((await server.inject({ method: "GET", url: "/venues/not-a-uuid/inventory", headers: headers() })).statusCode).toBe(400);
    expect((await server.inject({ method: "GET", url: `${base}/${assetId}/history?limit=101`, headers: headers() })).statusCode).toBe(400);
    expect((await server.inject({ method: "GET", url: `${base}?unknown=1`, headers: headers() })).statusCode).toBe(400);
  });
});

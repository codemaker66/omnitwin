import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// Mock env vars before importing buildServer (same pattern as health.test.ts)
process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

// ---------------------------------------------------------------------------
// GET /assets — public furniture catalogue
//
// Read-only, no auth. Every editor page hits this on startup to verify
// the local catalogue against the DB. Tests pin:
//   - Route is mounted (no 404)
//   - Anonymous callers are allowed (no 401)
// The mock DB will eventually 500 on the actual SELECT, but the route
// wiring contract is what matters — auth and mounting.
// ---------------------------------------------------------------------------

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("GET /assets", () => {
  it("is publicly reachable (no 404, no 401)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/assets",
    });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).not.toBe(401);
  });

  it("is mounted at the exact /assets path (no trailing slash issue)", async () => {
    // Fastify routes must resolve both with and without trailing slash
    // depending on config; we assert the canonical `/assets` responds.
    const res = await server.inject({ method: "GET", url: "/assets" });
    expect(res.statusCode).not.toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /assets/versions — register a runtime AssetVersion (admin only).
//
// The mock DB can't service a successful insert, so these pin the layers that
// run BEFORE the DB: authentication, admin authorization, and Zod validation
// (fixture-marker rejection, splat-extension and sha256 shape). The 201
// success path is exercised against a real DB in integration, not here.
// ---------------------------------------------------------------------------

const signToken = (payload: { id: string; email: string; role: string; venueId: string | null }): string =>
  JSON.stringify(payload);
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: "v1" });
const plannerToken = (): string => signToken({ id: "u2", email: "planner@test.com", role: "planner", venueId: "v1" });

const VENUE_ID = "00000000-0000-0000-0000-000000000001";
const SHA = "a".repeat(64);
const validVersionBody = {
  venueId: VENUE_ID,
  source: "runpod",
  r2Key: "private/venues/trades-hall/runtime/grand-hall/scene.spz",
  sha256: SHA,
  captureDate: "2026-06-01",
};

describe("POST /assets/versions", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "POST", url: "/assets/versions", payload: validVersionBody });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/assets/versions",
      headers: { authorization: `Bearer ${plannerToken()}` },
      payload: validVersionBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a fixture/demo asset key with 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/assets/versions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validVersionBody, r2Key: "dev/splat-fixture/scene.spz" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-splat extension with 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/assets/versions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validVersionBody, r2Key: "private/venues/trades-hall/scene.png" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a malformed sha256 with 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/assets/versions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validVersionBody, sha256: "not-a-hash" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /assets/runtime-packages/latest — public read for the runtime.
// Mounted + anonymous-reachable (the actual SELECT 500s on the mock DB, same
// contract as GET /assets).
// ---------------------------------------------------------------------------

describe("GET /assets/runtime-packages/latest", () => {
  it("is publicly reachable (no 404, no 401)", async () => {
    const res = await server.inject({ method: "GET", url: "/assets/runtime-packages/latest" });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).not.toBe(401);
  });
});

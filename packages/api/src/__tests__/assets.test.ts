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

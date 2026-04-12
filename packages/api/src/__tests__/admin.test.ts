import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Admin route tests — punch list #30 (missing route tests)
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;
beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: "v1" });
const hallkeeperToken = (): string => signToken({ id: "u2", email: "hk@test.com", role: "hallkeeper", venueId: "v1" });
const clientToken = (): string => signToken({ id: "u3", email: "client@test.com", role: "client", venueId: null });

// ---------------------------------------------------------------------------
// POST /admin/cleanup
// ---------------------------------------------------------------------------

describe("POST /admin/cleanup", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "POST", url: "/admin/cleanup" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for client role", async () => {
    const res = await server.inject({
      method: "POST", url: "/admin/cleanup",
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for hallkeeper role (admin-only)", async () => {
    const res = await server.inject({
      method: "POST", url: "/admin/cleanup",
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("passes auth for admin (fails at DB layer, not auth)", async () => {
    const res = await server.inject({
      method: "POST", url: "/admin/cleanup",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    // Admin should pass auth — any non-401/403 means the auth gates worked.
    // The mock DB will cause a 500, which is expected.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

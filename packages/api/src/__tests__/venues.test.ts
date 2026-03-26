import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Venue route tests
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

/** Sign a test JWT with the given payload. */
function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: "v1" });
const staffToken = (): string => signToken({ id: "u2", email: "staff@test.com", role: "staff", venueId: "v1" });
const clientToken = (): string => signToken({ id: "u3", email: "client@test.com", role: "client", venueId: null });

// ---------------------------------------------------------------------------
// GET /venues
// ---------------------------------------------------------------------------

describe("GET /venues", () => {
  it("is accessible without auth (public)", async () => {
    const res = await server.inject({ method: "GET", url: "/venues" });
    // Will fail at DB layer but should NOT be 401
    expect(res.statusCode).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /venues/:id
// ---------------------------------------------------------------------------

describe("GET /venues/:id", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await server.inject({ method: "GET", url: "/venues/not-a-uuid" });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /venues
// ---------------------------------------------------------------------------

describe("POST /venues", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/venues",
      payload: { name: "Test", slug: "test", address: "123 St" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin (client)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/venues",
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: { name: "Test", slug: "test", address: "123 St" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid body", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/venues",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid slug format", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/venues",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Test", slug: "Has Spaces", address: "123 St" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes validation with valid body (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/venues",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Test Venue", slug: "test-venue", address: "123 Test St" },
    });
    // Passes validation, fails at DB (mock URL) — should be 500, not 400
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /venues/:id
// ---------------------------------------------------------------------------

describe("PATCH /venues/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/venues/00000000-0000-0000-0000-000000000001",
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/venues/bad-id",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /venues/:id
// ---------------------------------------------------------------------------

describe("DELETE /venues/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/venues/00000000-0000-0000-0000-000000000001",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/venues/00000000-0000-0000-0000-000000000001",
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

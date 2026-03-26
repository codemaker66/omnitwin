import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Configuration route tests
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

const VENUE_ID = "00000000-0000-0000-0000-000000000001";
const SPACE_ID = "00000000-0000-0000-0000-000000000010";
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: VENUE_ID });
const clientToken = (): string => signToken({ id: "u3", email: "client@test.com", role: "client", venueId: null });

// ---------------------------------------------------------------------------
// GET /configurations
// ---------------------------------------------------------------------------

describe("GET /configurations", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/configurations" });
    expect(res.statusCode).toBe(401);
  });

  it("accepts auth and attempts DB query", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/configurations",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    // Should not be 401/403 — will be 500 (mock DB)
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /configurations/:id
// ---------------------------------------------------------------------------

describe("GET /configurations/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/configurations/00000000-0000-0000-0000-000000000001",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/configurations/bad-id",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /configurations
// ---------------------------------------------------------------------------

describe("POST /configurations", () => {
  const validBody = {
    spaceId: SPACE_ID,
    venueId: VENUE_ID,
    name: "Wedding Layout",
    layoutStyle: "ceremony",
  };

  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/configurations",
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for missing name", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/configurations",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { spaceId: SPACE_ID, venueId: VENUE_ID, layoutStyle: "ceremony" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid layoutStyle", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/configurations",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validBody, layoutStyle: "invalid-style" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes validation for authenticated user (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/configurations",
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: validBody,
    });
    // Client can create configs — passes auth and validation
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("validates all 8 layout styles", async () => {
    const styles = ["ceremony", "dinnerRounds", "dinnerBanquet", "theatre", "boardroom", "cabaret", "cocktail", "custom"];
    for (const style of styles) {
      const res = await server.inject({
        method: "POST",
        url: "/configurations",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { ...validBody, layoutStyle: style },
      });
      expect(res.statusCode).not.toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH /configurations/:id
// ---------------------------------------------------------------------------

describe("PATCH /configurations/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/configurations/00000000-0000-0000-0000-000000000001",
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid state value", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/configurations/00000000-0000-0000-0000-000000000001",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { state: "archived" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts valid state transition (draft/published)", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/configurations/00000000-0000-0000-0000-000000000001",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { state: "published" },
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /configurations/:id
// ---------------------------------------------------------------------------

describe("DELETE /configurations/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/configurations/00000000-0000-0000-0000-000000000001",
    });
    expect(res.statusCode).toBe(401);
  });
});

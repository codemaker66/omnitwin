import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Space route tests
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return server.jwt.sign(payload, { expiresIn: "15m" });
}

const VENUE_ID = "00000000-0000-0000-0000-000000000001";
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: VENUE_ID });
const staffForVenue = (): string => signToken({ id: "u2", email: "staff@test.com", role: "staff", venueId: VENUE_ID });
const staffOtherVenue = (): string => signToken({ id: "u3", email: "other@test.com", role: "staff", venueId: "00000000-0000-0000-0000-999999999999" });
const clientToken = (): string => signToken({ id: "u4", email: "client@test.com", role: "client", venueId: null });

// ---------------------------------------------------------------------------
// GET /venues/:venueId/spaces
// ---------------------------------------------------------------------------

describe("GET /venues/:venueId/spaces", () => {
  it("is accessible without auth (public)", async () => {
    const res = await server.inject({ method: "GET", url: `/venues/${VENUE_ID}/spaces` });
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 for invalid venue UUID", async () => {
    const res = await server.inject({ method: "GET", url: "/venues/not-uuid/spaces" });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /venues/:venueId/spaces
// ---------------------------------------------------------------------------

describe("POST /venues/:venueId/spaces", () => {
  const validBody = {
    name: "Test Hall",
    slug: "test-hall",
    widthM: 10,
    lengthM: 8,
    heightM: 4,
    floorPlanOutline: [{ x: -5, y: -4 }, { x: 5, y: -4 }, { x: 5, y: 4 }, { x: -5, y: 4 }],
  };

  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/spaces`,
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for client role", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/spaces`,
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for staff of different venue", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/spaces`,
      headers: { authorization: `Bearer ${staffOtherVenue()}` },
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for missing required fields", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/spaces`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for floor plan with < 3 points", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/spaces`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validBody, floorPlanOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes validation for admin (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/spaces`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: validBody,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("passes validation for venue staff (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/spaces`,
      headers: { authorization: `Bearer ${staffForVenue()}` },
      payload: validBody,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /venues/:venueId/spaces/:id
// ---------------------------------------------------------------------------

describe("DELETE /venues/:venueId/spaces/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: `/venues/${VENUE_ID}/spaces/00000000-0000-0000-0000-000000000002`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for client role", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: `/venues/${VENUE_ID}/spaces/00000000-0000-0000-0000-000000000002`,
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

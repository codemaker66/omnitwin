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
  return JSON.stringify(payload);
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
  // Polygon-only body: post-Prompt-5, requests must provide EITHER a polygon
  // OR widthM+lengthM, never both. Polygon is the source of truth, so the
  // canonical path is polygon-only.
  const validBody = {
    name: "Test Hall",
    slug: "test-hall",
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

  // ---------------------------------------------------------------------------
  // Polygon is the sole shape input on the request side (Prompts 5 + 7).
  // widthM/lengthM no longer appear on the request schemas — Zod strips them
  // silently, so the behaviour when a legacy client sends them is "as if they
  // weren't there". The regression we guard against is the server generating
  // or accepting any shape that isn't the posted polygon.
  // ---------------------------------------------------------------------------

  it("400 when POST body omits floorPlanOutline (polygon is required on create)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/spaces`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "No Shape", slug: "no-shape", heightM: 4 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when POST polygon has fewer than 3 points", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/spaces`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        name: "Two-Point",
        slug: "two-point",
        heightM: 4,
        floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("legacy widthM/lengthM in the POST body are silently ignored; polygon drives the write", async () => {
    // The schema no longer declares widthM/lengthM, so Zod strips them. A
    // body that also carries a valid polygon passes validation and goes
    // through to the DB (which fails under the mock URL — non-400 status
    // means we cleared validation).
    const res = await server.inject({
      method: "POST",
      url: `/venues/${VENUE_ID}/spaces`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        name: "Legacy Extra",
        slug: "legacy-extra",
        heightM: 4,
        widthM: 99,    // silently dropped by Zod
        lengthM: 77,   // silently dropped by Zod
        floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }],
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /venues/:venueId/spaces/:id — polygon-only shape edits
// ---------------------------------------------------------------------------

describe("PATCH /venues/:venueId/spaces/:id (polygon shape)", () => {
  const SPACE_ID = "00000000-0000-0000-0000-000000000042";

  it("400 when PATCH polygon has fewer than 3 points", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/venues/${VENUE_ID}/spaces/${SPACE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes validation for polygon-only PATCH", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/venues/${VENUE_ID}/spaces/${SPACE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        floorPlanOutline: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 9 }, { x: 0, y: 9 }],
      },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("legacy widthM/lengthM PATCH is silently ignored (treated as metadata-only)", async () => {
    // widthM/lengthM are no longer on the schema; Zod strips them, and
    // without a polygon in the body there is no shape change. This is
    // equivalent to a metadata-only PATCH — validation passes.
    const res = await server.inject({
      method: "PATCH",
      url: `/venues/${VENUE_ID}/spaces/${SPACE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { widthM: 12, lengthM: 9 },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("passes validation for metadata-only PATCH (no shape change)", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/venues/${VENUE_ID}/spaces/${SPACE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).not.toBe(400);
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

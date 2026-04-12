import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Reference photo route tests — punch list #30 (missing route tests)
//
// These endpoints manage photos attached to reference loadouts. All four
// are auth-gated and venue-scoped via verifyLoadoutAccess(). The mock DB
// will cause DB operations to fail, but the tests verify auth gates,
// parameter validation, and body validation — the layers that run BEFORE
// the DB is touched.
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

const LOADOUT_ID = "00000000-0000-0000-0000-000000000010";
const PHOTO_ID = "00000000-0000-0000-0000-000000000020";
const FILE_ID = "00000000-0000-0000-0000-000000000030";
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: "v1" });

// ---------------------------------------------------------------------------
// POST /loadouts/:loadoutId/photos — add photo
// ---------------------------------------------------------------------------

describe("POST /loadouts/:loadoutId/photos", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST", url: `/loadouts/${LOADOUT_ID}/photos`,
      payload: { fileId: FILE_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid loadout ID", async () => {
    const res = await server.inject({
      method: "POST", url: "/loadouts/bad-id/photos",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fileId: FILE_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing fileId", async () => {
    const res = await server.inject({
      method: "POST", url: `/loadouts/${LOADOUT_ID}/photos`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for non-UUID fileId", async () => {
    const res = await server.inject({
      method: "POST", url: `/loadouts/${LOADOUT_ID}/photos`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fileId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes auth + validation with valid payload (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST", url: `/loadouts/${LOADOUT_ID}/photos`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fileId: FILE_ID, caption: "Test photo", sortOrder: 0 },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });

  it("accepts null caption", async () => {
    const res = await server.inject({
      method: "POST", url: `/loadouts/${LOADOUT_ID}/photos`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fileId: FILE_ID, caption: null },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("rejects caption exceeding 500 characters", async () => {
    const res = await server.inject({
      method: "POST", url: `/loadouts/${LOADOUT_ID}/photos`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fileId: FILE_ID, caption: "x".repeat(501) },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /loadouts/:loadoutId/photos/:id — update photo
// ---------------------------------------------------------------------------

describe("PATCH /loadouts/:loadoutId/photos/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "PATCH", url: `/loadouts/${LOADOUT_ID}/photos/${PHOTO_ID}`,
      payload: { caption: "Updated" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid loadout ID", async () => {
    const res = await server.inject({
      method: "PATCH", url: `/loadouts/bad-id/photos/${PHOTO_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { caption: "Updated" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid photo ID", async () => {
    const res = await server.inject({
      method: "PATCH", url: `/loadouts/${LOADOUT_ID}/photos/bad-id`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { caption: "Updated" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes auth + validation with valid payload (fails at DB)", async () => {
    const res = await server.inject({
      method: "PATCH", url: `/loadouts/${LOADOUT_ID}/photos/${PHOTO_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { caption: "Updated", sortOrder: 5 },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /loadouts/:loadoutId/photos/:id — delete photo
// ---------------------------------------------------------------------------

describe("DELETE /loadouts/:loadoutId/photos/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "DELETE", url: `/loadouts/${LOADOUT_ID}/photos/${PHOTO_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid loadout ID", async () => {
    const res = await server.inject({
      method: "DELETE", url: `/loadouts/bad-id/photos/${PHOTO_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid photo ID", async () => {
    const res = await server.inject({
      method: "DELETE", url: `/loadouts/${LOADOUT_ID}/photos/bad-id`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes auth + validation (fails at DB)", async () => {
    const res = await server.inject({
      method: "DELETE", url: `/loadouts/${LOADOUT_ID}/photos/${PHOTO_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /loadouts/:loadoutId/photos/reorder — reorder photos
// ---------------------------------------------------------------------------

describe("POST /loadouts/:loadoutId/photos/reorder", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST", url: `/loadouts/${LOADOUT_ID}/photos/reorder`,
      payload: { photoIds: [PHOTO_ID] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid loadout ID", async () => {
    const res = await server.inject({
      method: "POST", url: "/loadouts/bad-id/photos/reorder",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { photoIds: [PHOTO_ID] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for empty photoIds array", async () => {
    const res = await server.inject({
      method: "POST", url: `/loadouts/${LOADOUT_ID}/photos/reorder`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { photoIds: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for non-UUID in photoIds", async () => {
    const res = await server.inject({
      method: "POST", url: `/loadouts/${LOADOUT_ID}/photos/reorder`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { photoIds: ["not-a-uuid"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes auth + validation with valid payload (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST", url: `/loadouts/${LOADOUT_ID}/photos/reorder`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { photoIds: [PHOTO_ID] },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

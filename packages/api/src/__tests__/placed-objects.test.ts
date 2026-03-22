import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Placed object route tests
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

const CONFIG_ID = "00000000-0000-0000-0000-000000000001";
const ASSET_ID = "00000000-0000-0000-0000-000000000020";
const OBJ_ID = "00000000-0000-0000-0000-000000000030";
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: "v1" });

// ---------------------------------------------------------------------------
// GET /configurations/:configId/objects
// ---------------------------------------------------------------------------

describe("GET /configurations/:configId/objects", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/configurations/${CONFIG_ID}/objects`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid config UUID", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/configurations/bad-id/objects",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /configurations/:configId/objects
// ---------------------------------------------------------------------------

describe("POST /configurations/:configId/objects", () => {
  const validBody = {
    assetDefinitionId: ASSET_ID,
    positionX: 1.5,
    positionY: 0,
    positionZ: -3.2,
  };

  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/objects`,
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for missing position fields", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/objects`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { assetDefinitionId: ASSET_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid assetDefinitionId", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/objects`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...validBody, assetDefinitionId: "not-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes validation with all fields (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/objects`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        ...validBody,
        rotationY: 1.5708,
        scale: 1.5,
        sortOrder: 3,
        metadata: { note: "test" },
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("accepts default rotation/scale values", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/objects`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: validBody,
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /configurations/:configId/objects/:id
// ---------------------------------------------------------------------------

describe("PATCH /configurations/:configId/objects/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/configurations/${CONFIG_ID}/objects/${OBJ_ID}`,
      payload: { positionX: 5.0 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid object UUID", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/configurations/${CONFIG_ID}/objects/bad-id`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { positionX: 5.0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates numeric transform fields", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/configurations/${CONFIG_ID}/objects/${OBJ_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { scale: -1 },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /configurations/:configId/objects/:id
// ---------------------------------------------------------------------------

describe("DELETE /configurations/:configId/objects/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: `/configurations/${CONFIG_ID}/objects/${OBJ_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /configurations/:configId/objects/batch
// ---------------------------------------------------------------------------

describe("POST /configurations/:configId/objects/batch", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/objects/batch`,
      payload: { objects: [{ assetDefinitionId: ASSET_ID, positionX: 0, positionY: 0, positionZ: 0 }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for empty objects array", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/objects/batch`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { objects: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing body", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/objects/batch`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes validation with valid batch (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${CONFIG_ID}/objects/batch`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        objects: [
          { assetDefinitionId: ASSET_ID, positionX: 0, positionY: 0, positionZ: 0 },
          { assetDefinitionId: ASSET_ID, positionX: 2, positionY: 0, positionZ: 2, rotationY: 1.57 },
          { id: OBJ_ID, assetDefinitionId: ASSET_ID, positionX: 4, positionY: 0, positionZ: 4 },
        ],
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });
});

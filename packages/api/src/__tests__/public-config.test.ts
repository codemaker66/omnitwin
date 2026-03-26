import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;
beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const SPACE_ID = "00000000-0000-0000-0000-000000000010";
const CONFIG_ID = "00000000-0000-0000-0000-000000000050";
const ASSET_ID = "00000000-0000-0000-0000-000000000020";
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: "v1" });

// ---------------------------------------------------------------------------
// POST /public/configurations — create anonymous preview
// ---------------------------------------------------------------------------

describe("POST /public/configurations", () => {
  it("does not require auth", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations",
      payload: { spaceId: SPACE_ID },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 for missing spaceId", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid spaceId", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations",
      payload: { spaceId: "not-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts optional name", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations",
      payload: { spaceId: SPACE_ID, name: "My Layout" },
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /public/configurations/:configId/objects/batch
// ---------------------------------------------------------------------------

describe("POST /public/configurations/:configId/objects/batch", () => {
  it("does not require auth", async () => {
    const res = await server.inject({
      method: "POST", url: `/public/configurations/${CONFIG_ID}/objects/batch`,
      payload: { objects: [{ assetDefinitionId: ASSET_ID, positionX: 0, positionY: 0, positionZ: 0 }] },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 for empty objects array", async () => {
    const res = await server.inject({
      method: "POST", url: `/public/configurations/${CONFIG_ID}/objects/batch`,
      payload: { objects: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid config ID", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations/bad-id/objects/batch",
      payload: { objects: [{ assetDefinitionId: ASSET_ID, positionX: 0, positionY: 0, positionZ: 0 }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /public/configurations/:configId
// ---------------------------------------------------------------------------

describe("GET /public/configurations/:configId", () => {
  it("does not require auth", async () => {
    const res = await server.inject({
      method: "GET", url: `/public/configurations/${CONFIG_ID}`,
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 for invalid ID", async () => {
    const res = await server.inject({
      method: "GET", url: "/public/configurations/bad-id",
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /configurations/:configId/claim — authenticated claim
// ---------------------------------------------------------------------------

describe("POST /configurations/:configId/claim", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST", url: `/configurations/${CONFIG_ID}/claim`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("passes auth with valid token (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST", url: `/configurations/${CONFIG_ID}/claim`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });

  it("returns 400 for invalid config ID", async () => {
    const res = await server.inject({
      method: "POST", url: "/configurations/bad-id/claim",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

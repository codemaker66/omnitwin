import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Upload route tests - mock DB; local R2 env may allow presign generation
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
// Authorized uploads may return 503 when R2 is not configured, or 500 when a
// local .env provides R2 config and the mock DB insert is reached. These route
// tests assert validation/authorization gates; helper tests pin key policy.

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: "v1" });
const staffToken = (venueId: string | null = CTX_ID): string =>
  signToken({ id: "u2", email: "staff@test.com", role: "staff", venueId });
const clientToken = (): string =>
  signToken({ id: "u3", email: "client@test.com", role: "client", venueId: null });

const CTX_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_CTX_ID = "00000000-0000-0000-0000-000000000002";

const basePayload = {
  filename: "photo.jpg",
  contentType: "image/jpeg",
  contentLengthBytes: 1024,
  context: "venue",
  contextId: CTX_ID,
} as const;

// ---------------------------------------------------------------------------
// POST /uploads/presigned
// ---------------------------------------------------------------------------

describe("POST /uploads/presigned", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      payload: basePayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for missing filename", async () => {
    const { filename: _filename, ...payload } = basePayload;
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing content length", async () => {
    const { contentLengthBytes: _contentLengthBytes, ...payload } = basePayload;
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid content type", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...basePayload, filename: "virus.exe", contentType: "application/octet-stream" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for mismatched extension and content type", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...basePayload, filename: "photo.png", contentType: "image/jpeg" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for oversized images", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...basePayload, contentLengthBytes: 10 * 1024 * 1024 + 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid context", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...basePayload, context: "unknown" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid contextId (not UUID)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...basePayload, contextId: "bad" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when a private venue context requests public visibility", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...basePayload, visibility: "public" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when public_marketing is not explicitly public", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...basePayload, context: "public_marketing", visibility: "private" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when staff upload to a venue they do not manage", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${staffToken(OTHER_CTX_ID)}` },
      payload: basePayload,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when a client tries to upload a global asset", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: { ...basePayload, filename: "photo.webp", contentType: "image/webp", context: "asset" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts authorized venue image/jpeg past validation and authorization gates", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: basePayload,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("accepts admin-only asset image/webp past validation and authorization gates", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...basePayload, filename: "photo.webp", contentType: "image/webp", context: "asset" },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("accepts application/pdf under the larger document size limit", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: {
        ...basePayload,
        filename: "doc.pdf",
        contentType: "application/pdf",
        contentLengthBytes: 24 * 1024 * 1024,
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /uploads/:context/:contextId
// ---------------------------------------------------------------------------

describe("GET /uploads/:context/:contextId", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/uploads/venue/${CTX_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid context", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/uploads/bad-context/${CTX_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid contextId", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/uploads/venue/not-uuid",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for unauthorized venue listing", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/uploads/venue/${CTX_ID}`,
      headers: { authorization: `Bearer ${staffToken(OTHER_CTX_ID)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("passes access validation for valid venue params (fails later at DB)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/uploads/venue/${CTX_ID}`,
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

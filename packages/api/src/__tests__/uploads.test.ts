import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Upload route tests — S3 client not called (mock DB, no R2 env vars)
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
// R2 vars NOT set — uploads will return 503 "not configured"

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: "v1" });
const CTX_ID = "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// POST /uploads/presigned
// ---------------------------------------------------------------------------

describe("POST /uploads/presigned", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      payload: { filename: "photo.jpg", contentType: "image/jpeg", context: "venue", contextId: CTX_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for missing filename", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { contentType: "image/jpeg", context: "venue", contextId: CTX_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid content type", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { filename: "virus.exe", contentType: "application/octet-stream", context: "venue", contextId: CTX_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid context", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { filename: "photo.jpg", contentType: "image/jpeg", context: "unknown", contextId: CTX_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid contextId (not UUID)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { filename: "photo.jpg", contentType: "image/jpeg", context: "venue", contextId: "bad" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts image/jpeg", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { filename: "photo.jpg", contentType: "image/jpeg", context: "venue", contextId: CTX_ID },
    });
    // Validation passed — not 400. May be 503 (R2 not configured) or 500 (mock DB)
    expect(res.statusCode).not.toBe(400);
  });

  it("accepts image/png", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { filename: "photo.png", contentType: "image/png", context: "space", contextId: CTX_ID },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("accepts image/webp", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { filename: "photo.webp", contentType: "image/webp", context: "asset", contextId: CTX_ID },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("accepts application/pdf", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { filename: "doc.pdf", contentType: "application/pdf", context: "enquiry", contextId: CTX_ID },
    });
    expect(res.statusCode).not.toBe(400);
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

  it("passes validation for valid params (fails at DB)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/uploads/venue/${CTX_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });
});

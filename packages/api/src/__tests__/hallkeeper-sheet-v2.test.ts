import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../index.js";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Hallkeeper sheet route tests
//
// SECURITY: these endpoints expose PII (contact name, email, phone) and
// MUST be authenticated. The previous version was anonymous — these tests
// were inverted on 2026-04-10 as part of punch list #4.
// ---------------------------------------------------------------------------

const FAKE_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

function mockToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const adminAuth = { authorization: `Bearer ${mockToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: null })}` };

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
});

describe("GET /hallkeeper/:configId/sheet", () => {
  it("returns 401 without authentication", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/sheet`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid config ID (with auth)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/hallkeeper/not-a-uuid/sheet",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(400);
  });

  it("authenticated request reaches handler (passes auth gate)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/sheet`,
      headers: adminAuth,
    });
    // With mock DB the handler eventually 404s or 500s — what matters
    // is that auth (401) and validation (400) are both passed.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

describe("GET /hallkeeper/:configId/v2 — new phase/zone sheet", () => {
  it("returns 401 without authentication", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/v2`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid config ID (with auth)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/hallkeeper/not-a-uuid/v2",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(400);
  });

  it("authenticated request reaches the v2 handler (passes auth + validation)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/v2`,
      headers: adminAuth,
    });
    // Mock DB eventually 404s; what matters is the auth + validation
    // gates both pass so the v2 handler is actually reachable.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

describe("GET /hallkeeper/:configId/data", () => {
  it("returns 401 without authentication", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/data`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid config ID (with auth)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/hallkeeper/not-a-uuid/data",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts download query parameter (with auth)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/sheet?download=true`,
      headers: adminAuth,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });
});

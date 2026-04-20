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

describe("GET /hallkeeper/:configId/sheet — download query param", () => {
  it("accepts ?download=true (with auth)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/sheet?download=true`,
      headers: adminAuth,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });
});

describe("GET /hallkeeper/:configId/data — retired", () => {
  it("returns 404 (route removed when the PDF ported to v2)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/data`,
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Progress route — auth + validation gates
//
// Security fix (2026-04-17): both GET and PATCH previously had NO
// `canAccessResource` check. Any authenticated user could read or
// mutate another venue's checkbox state by guessing a config UUID.
// These tests pin the new gate's presence.
// ---------------------------------------------------------------------------

describe("GET /hallkeeper/:configId/progress — auth gate", () => {
  it("returns 401 without authentication", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/progress`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid config ID (with auth)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/hallkeeper/not-a-uuid/progress",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(400);
  });

  it("authenticated request with valid UUID passes auth + validation gates", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/progress`,
      headers: adminAuth,
    });
    // Mock DB resolves the ownership-probe to 404; what matters for
    // this test is that the auth (401) and UUID-validation (400)
    // gates both pass so the ownership probe itself runs.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

describe("PATCH /hallkeeper/:configId/progress — auth gate", () => {
  const validBody = { rowKey: "furniture|Centre|6ft Round Table|0" };

  it("returns 401 without authentication", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/progress`,
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid config ID (with auth)", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/hallkeeper/not-a-uuid/progress",
      headers: adminAuth,
      payload: validBody,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for empty rowKey (with auth)", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/progress`,
      headers: adminAuth,
      payload: { rowKey: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("authenticated request with valid body passes auth + validation gates", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/progress`,
      headers: adminAuth,
      payload: validBody,
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

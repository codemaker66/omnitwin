import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

// ---------------------------------------------------------------------------
// POST /configurations/:configId/claim — claim a public preview config
//
// Pins:
//   - 401 when unauthenticated (critical — claiming modifies ownership)
//   - 400 on malformed UUID
//   - authenticated + valid UUID reaches the handler (not 400, not 401)
// The actual claim transaction hits the mock DB and 5xxs; the auth gate
// is what matters to test here.
// ---------------------------------------------------------------------------

const FAKE_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

function adminToken(): string {
  return JSON.stringify({
    id: "u1",
    email: "admin@test.com",
    role: "admin",
    venueId: null,
  });
}

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("POST /configurations/:configId/claim", () => {
  it("returns 401 without authentication", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${FAKE_CONFIG_ID}/claim`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid config ID (with auth)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/configurations/not-a-uuid/claim",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("authenticated request with valid UUID passes auth + validation", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${FAKE_CONFIG_ID}/claim`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

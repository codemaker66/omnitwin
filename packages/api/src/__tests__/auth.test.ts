import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Auth middleware tests (Clerk-based)
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function mockToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

describe("Clerk auth middleware", () => {
  it("returns 401 when no Authorization header is sent", async () => {
    const res = await server.inject({ method: "GET", url: "/enquiries" });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.payload) as Record<string, unknown>;
    expect(body["code"]).toBe("UNAUTHORIZED");
  });

  it("returns 401 when Authorization header has no Bearer prefix", async () => {
    const res = await server.inject({
      method: "GET", url: "/enquiries",
      headers: { authorization: "Token something" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with invalid (non-JSON, non-Clerk) token", async () => {
    const res = await server.inject({
      method: "GET", url: "/enquiries",
      headers: { authorization: "Bearer invalid-garbage-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts mock JSON token in test mode", async () => {
    const token = mockToken({ id: "u1", email: "test@test.com", role: "admin", venueId: null });
    const res = await server.inject({
      method: "GET", url: "/enquiries",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Role-based authorization
// ---------------------------------------------------------------------------

describe("authorize middleware", () => {
  it("returns 403 when role is not in allowed set", async () => {
    const token = mockToken({ id: "u1", email: "test@test.com", role: "planner", venueId: null });
    const res = await server.inject({
      method: "GET", url: "/clients/search?q=test",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows admin access to admin-only endpoints", async () => {
    const token = mockToken({ id: "u1", email: "test@test.com", role: "admin", venueId: null });
    const res = await server.inject({
      method: "GET", url: "/clients/search?q=test",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("allows hallkeeper access to hallkeeper endpoints", async () => {
    const token = mockToken({ id: "u1", email: "test@test.com", role: "hallkeeper", venueId: "v1" });
    const res = await server.inject({
      method: "GET", url: "/clients/search?q=test",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Public endpoints (no auth)
// ---------------------------------------------------------------------------

describe("public endpoints require no auth", () => {
  it("GET /health is public", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("GET /venues is public", async () => {
    const res = await server.inject({ method: "GET", url: "/venues" });
    expect(res.statusCode).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------

describe("POST /webhooks/clerk", () => {
  it("responds 200 to user.created event", async () => {
    const res = await server.inject({
      method: "POST", url: "/webhooks/clerk",
      payload: {
        type: "user.created",
        data: {
          id: "clerk_test_123",
          email_addresses: [{ id: "ea_1", email_address: "newuser@test.com" }],
          primary_email_address_id: "ea_1",
          first_name: "Test",
          last_name: "User",
          phone_numbers: [],
          public_metadata: { role: "planner" },
        },
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("responds 200 to user.updated event", async () => {
    const res = await server.inject({
      method: "POST", url: "/webhooks/clerk",
      payload: {
        type: "user.updated",
        data: {
          id: "clerk_test_123",
          email_addresses: [{ id: "ea_1", email_address: "updated@test.com" }],
          primary_email_address_id: "ea_1",
          first_name: "Updated",
          last_name: "Name",
          phone_numbers: [{ phone_number: "+441234567890" }],
          public_metadata: {},
        },
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("responds 200 to user.deleted event", async () => {
    const res = await server.inject({
      method: "POST", url: "/webhooks/clerk",
      payload: {
        type: "user.deleted",
        data: {
          id: "clerk_test_123",
          email_addresses: [],
          primary_email_address_id: "",
          first_name: null,
          last_name: null,
          phone_numbers: [],
          public_metadata: {},
        },
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("responds 200 to unknown event type", async () => {
    const res = await server.inject({
      method: "POST", url: "/webhooks/clerk",
      payload: { type: "organization.created", data: {} },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

describe("webhook signature verification", () => {
  it("processes event without secret in dev mode (existing tests cover this)", async () => {
    // CLERK_WEBHOOK_SECRET is not set in test env — dev mode skips verification
    const res = await server.inject({
      method: "POST", url: "/webhooks/clerk",
      payload: { type: "unknown.event", data: {} },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 when secret is set but signature headers are missing", async () => {
    const original = process.env["CLERK_WEBHOOK_SECRET"];
    process.env["CLERK_WEBHOOK_SECRET"] = "whsec_testSecretForUnitTests123456";

    const freshServer = await buildServer();

    const res = await freshServer.inject({
      method: "POST", url: "/webhooks/clerk",
      payload: { type: "user.created", data: {} },
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.payload) as Record<string, unknown>;
    expect(body["code"]).toBe("UNAUTHORIZED");

    await freshServer.close();
    process.env["CLERK_WEBHOOK_SECRET"] = original;
  });

  it("returns 401 when signature is invalid", async () => {
    const original = process.env["CLERK_WEBHOOK_SECRET"];
    process.env["CLERK_WEBHOOK_SECRET"] = "whsec_testSecretForUnitTests123456";

    const freshServer = await buildServer();

    const res = await freshServer.inject({
      method: "POST", url: "/webhooks/clerk",
      headers: {
        "svix-id": "msg_fake",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,invalidSignatureData",
      },
      payload: { type: "user.created", data: {} },
    });
    expect(res.statusCode).toBe(401);

    await freshServer.close();
    process.env["CLERK_WEBHOOK_SECRET"] = original;
  });
});

// ---------------------------------------------------------------------------
// Old auth routes are removed
// ---------------------------------------------------------------------------

describe("old auth routes removed", () => {
  it("POST /auth/register returns 404", async () => {
    const res = await server.inject({ method: "POST", url: "/auth/register", payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it("POST /auth/login returns 404", async () => {
    const res = await server.inject({ method: "POST", url: "/auth/login", payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it("POST /auth/refresh returns 404", async () => {
    const res = await server.inject({ method: "POST", url: "/auth/refresh", payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

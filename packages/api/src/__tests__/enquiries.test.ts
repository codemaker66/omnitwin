import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Enquiry route tests
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

const VENUE_ID = "00000000-0000-0000-0000-000000000001";
const SPACE_ID = "00000000-0000-0000-0000-000000000010";
const CONFIG_ID = "00000000-0000-0000-0000-000000000020";
const ENQUIRY_ID = "00000000-0000-0000-0000-000000000030";
const clientToken = (): string => signToken({ id: "u1", email: "client@test.com", role: "client", venueId: null });
const adminToken = (): string => signToken({ id: "u3", email: "admin@test.com", role: "admin", venueId: VENUE_ID });

const validEnquiry = {
  configurationId: CONFIG_ID,
  venueId: VENUE_ID,
  spaceId: SPACE_ID,
  name: "Test Event",
  email: "planner@example.com",
  eventType: "Wedding",
  estimatedGuests: 120,
  message: "We'd like to book the Grand Hall.",
};

// ---------------------------------------------------------------------------
// GET /enquiries
// ---------------------------------------------------------------------------

describe("GET /enquiries", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/enquiries" });
    expect(res.statusCode).toBe(401);
  });

  it("accepts auth (client)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries",
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("accepts status filter query param", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries?status=draft",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("rejects invalid status filter", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries?status=invalid_state",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /enquiries/:id
// ---------------------------------------------------------------------------

describe("GET /enquiries/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: `/enquiries/${ENQUIRY_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries/bad-id",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /enquiries
// ---------------------------------------------------------------------------

describe("POST /enquiries", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/enquiries",
      payload: validEnquiry,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for missing required fields", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/enquiries",
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid email", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/enquiries",
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: { ...validEnquiry, email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid date format", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/enquiries",
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: { ...validEnquiry, preferredDate: "not-a-date" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes validation with valid body (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/enquiries",
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: validEnquiry,
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("accepts optional preferredDate", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/enquiries",
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: { ...validEnquiry, preferredDate: "2026-06-15" },
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /enquiries/:id
// ---------------------------------------------------------------------------

describe("PATCH /enquiries/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/enquiries/${ENQUIRY_ID}`,
      payload: { message: "Updated" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates update body", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/enquiries/${ENQUIRY_ID}`,
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: { email: "not-email" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /enquiries/:id/transition
// ---------------------------------------------------------------------------

describe("POST /enquiries/:id/transition", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${ENQUIRY_ID}/transition`,
      payload: { status: "submitted" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid status", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${ENQUIRY_ID}/transition`,
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: { status: "invalid_state" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing body", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${ENQUIRY_ID}/transition`,
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts valid status value (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${ENQUIRY_ID}/transition`,
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: { status: "submitted" },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("accepts optional note in transition", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${ENQUIRY_ID}/transition`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "approved", note: "Looks good!" },
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /enquiries/:id/history
// ---------------------------------------------------------------------------

describe("GET /enquiries/:id/history", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/enquiries/${ENQUIRY_ID}/history`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries/bad-id/history",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

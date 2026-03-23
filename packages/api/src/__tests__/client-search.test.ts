import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

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
const USER_ID = "00000000-0000-0000-0000-000000000090";
const LEAD_ID = "00000000-0000-0000-0000-000000000091";
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: VENUE_ID });
const hallkeeperToken = (): string => signToken({ id: "u2", email: "hk@test.com", role: "hallkeeper", venueId: VENUE_ID });
const plannerToken = (): string => signToken({ id: "u3", email: "planner@test.com", role: "planner", venueId: null });

// ---------------------------------------------------------------------------
// GET /clients/search
// ---------------------------------------------------------------------------

describe("GET /clients/search", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/clients/search?q=test" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for planner", async () => {
    const res = await server.inject({
      method: "GET", url: "/clients/search?q=test",
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for query too short", async () => {
    const res = await server.inject({
      method: "GET", url: "/clients/search?q=a",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes validation for admin (fails at DB)", async () => {
    const res = await server.inject({
      method: "GET", url: "/clients/search?q=candlelight",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("passes validation for hallkeeper (fails at DB)", async () => {
    const res = await server.inject({
      method: "GET", url: "/clients/search?q=test",
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("returns 400 for missing q param", async () => {
    const res = await server.inject({
      method: "GET", url: "/clients/search",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /clients/:userId/profile
// ---------------------------------------------------------------------------

describe("GET /clients/:userId/profile", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: `/clients/${USER_ID}/profile` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for planner", async () => {
    const res = await server.inject({
      method: "GET", url: `/clients/${USER_ID}/profile`,
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid userId", async () => {
    const res = await server.inject({
      method: "GET", url: "/clients/bad-id/profile",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /clients/leads/:leadId/profile
// ---------------------------------------------------------------------------

describe("GET /clients/leads/:leadId/profile", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: `/clients/leads/${LEAD_ID}/profile` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for planner", async () => {
    const res = await server.inject({
      method: "GET", url: `/clients/leads/${LEAD_ID}/profile`,
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /clients/recent
// ---------------------------------------------------------------------------

describe("GET /clients/recent", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/clients/recent" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for planner", async () => {
    const res = await server.inject({
      method: "GET", url: "/clients/recent",
      headers: { authorization: `Bearer ${plannerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("passes for admin (fails at DB)", async () => {
    const res = await server.inject({
      method: "GET", url: "/clients/recent",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/cleanup
// ---------------------------------------------------------------------------

describe("POST /admin/cleanup", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "POST", url: "/admin/cleanup" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for hallkeeper", async () => {
    const res = await server.inject({
      method: "POST", url: "/admin/cleanup",
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("passes for admin (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST", url: "/admin/cleanup",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

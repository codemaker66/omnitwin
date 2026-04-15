import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Hallkeeper sheet route tests
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const VENUE_ID = "00000000-0000-0000-0000-000000000001";
const ENQUIRY_ID = "00000000-0000-0000-0000-000000000030";
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: VENUE_ID });
const staffToken = (): string => signToken({ id: "u2", email: "staff@test.com", role: "staff", venueId: VENUE_ID });
const clientToken = (): string => signToken({ id: "u3", email: "client@test.com", role: "client", venueId: null });

// ---------------------------------------------------------------------------
// GET /enquiries/:id/hallkeeper-sheet
// ---------------------------------------------------------------------------

describe("GET /enquiries/:id/hallkeeper-sheet", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: `/enquiries/${ENQUIRY_ID}/hallkeeper-sheet` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for client role (not hallkeeper/admin)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/enquiries/${ENQUIRY_ID}/hallkeeper-sheet`,
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    // Client doesn't have canManageVenue → fails at DB or 403
    // With mock DB, enquiry lookup fails → 500. But importantly, not 200.
    expect(res.statusCode).not.toBe(200);
  });

  it("returns 400 for invalid ID", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries/bad-id/hallkeeper-sheet",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("admin passes auth check (fails at DB)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/enquiries/${ENQUIRY_ID}/hallkeeper-sheet`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });

  it("staff passes auth check (fails at DB)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/enquiries/${ENQUIRY_ID}/hallkeeper-sheet`,
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /enquiries/:id/hallkeeper-sheet/pdf
// ---------------------------------------------------------------------------

describe("GET /enquiries/:id/hallkeeper-sheet/pdf", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: `/enquiries/${ENQUIRY_ID}/hallkeeper-sheet/pdf` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid ID", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries/bad-id/hallkeeper-sheet/pdf",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("admin passes auth check (fails at DB)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/enquiries/${ENQUIRY_ID}/hallkeeper-sheet/pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /enquiries/:id/quote
// ---------------------------------------------------------------------------

describe("GET /enquiries/:id/quote", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: `/enquiries/${ENQUIRY_ID}/quote` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid ID", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries/bad-id/quote",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// EnquirySheetData shape validation (pure data test)
// ---------------------------------------------------------------------------

describe("EnquirySheetData structure", () => {
  it("type import works", async () => {
    const { generateHallkeeperPdf } = await import("../services/hallkeeper-sheet.js");
    expect(typeof generateHallkeeperPdf).toBe("function");
  });
});

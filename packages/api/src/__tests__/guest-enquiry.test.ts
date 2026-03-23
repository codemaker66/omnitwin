import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;
beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

const CONFIG_ID = "00000000-0000-0000-0000-000000000050";

// ---------------------------------------------------------------------------
// POST /public/enquiries — guest enquiry submission
// ---------------------------------------------------------------------------

describe("POST /public/enquiries", () => {
  it("does not require auth", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { configurationId: CONFIG_ID, email: "guest@example.com" },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 for missing email", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { configurationId: CONFIG_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid email", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { configurationId: CONFIG_ID, email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing configurationId", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { email: "guest@example.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid configurationId", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { configurationId: "not-uuid", email: "guest@example.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts full guest submission (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: {
        configurationId: CONFIG_ID,
        email: "candlelight@orchestra.com",
        phone: "+44 7700 900123",
        name: "Candlelight Orchestra",
        eventDate: "2026-06-15",
        eventType: "Concert",
        guestCount: 200,
        message: "We'd like to host a candlelit performance",
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("accepts email-only minimal submission (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { configurationId: CONFIG_ID, email: "minimal@example.com" },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("rejects invalid eventDate format", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { configurationId: CONFIG_ID, email: "guest@example.com", eventDate: "June 15" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects negative guestCount", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { configurationId: CONFIG_ID, email: "guest@example.com", guestCount: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects overly long message", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { configurationId: CONFIG_ID, email: "guest@example.com", message: "x".repeat(2001) },
    });
    expect(res.statusCode).toBe(400);
  });
});

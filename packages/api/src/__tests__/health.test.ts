import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Health check — Fastify inject test
// ---------------------------------------------------------------------------

// Mock env vars before importing buildServer
process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; version: string };
    expect(body.status).toBe("ok");
  });

  it("includes a version string", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });
    const body = JSON.parse(response.body) as { status: string; version: string };
    expect(typeof body.version).toBe("string");
  });
});

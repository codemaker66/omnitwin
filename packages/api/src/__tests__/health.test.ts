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

describe("GET /health/db", () => {
  it("returns 503 with DB_UNREACHABLE when the mock DB cannot be reached", async () => {
    // In the test harness the DATABASE_URL points at a non-existent
    // host, so the SELECT 1 probe fails. The route's own try/catch
    // maps that to a structured 503 instead of a generic 500 — ops
    // can alarm on 5xx from this endpoint specifically.
    const response = await server.inject({
      method: "GET",
      url: "/health/db",
    });
    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { status: string; code: string };
    expect(body.status).toBe("degraded");
    expect(body.code).toBe("DB_UNREACHABLE");
  });
});

// ---------------------------------------------------------------------------
// K8s-convention aliases — /health/live mirrors /health (process alive);
// /health/ready mirrors /health/db (dependency-check). Reviewers grep
// for both and expect the container to speak both dialects.
// ---------------------------------------------------------------------------

describe("GET /health/live (K8s liveness alias)", () => {
  it("returns 200 with the same shape as /health", async () => {
    const a = await server.inject({ method: "GET", url: "/health" });
    const b = await server.inject({ method: "GET", url: "/health/live" });
    expect(b.statusCode).toBe(200);
    expect(b.statusCode).toBe(a.statusCode);
    const ba = JSON.parse(a.body) as { status: string; version: string };
    const bb = JSON.parse(b.body) as { status: string; version: string };
    expect(bb.status).toBe(ba.status);
    expect(bb.version).toBe(ba.version);
  });
});

describe("GET /health/ready (K8s readiness alias)", () => {
  it("returns 503 with DB_UNREACHABLE when the DB probe fails — same as /health/db", async () => {
    const response = await server.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { status: string; code: string };
    expect(body.status).toBe("degraded");
    expect(body.code).toBe("DB_UNREACHABLE");
  });
});

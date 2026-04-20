import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../../index.js");

// ---------------------------------------------------------------------------
// Security headers + request-ID correlation — acquisition-grade basics
//
// Both middleware run on every request; these tests hit /health (the
// only unconditionally-200 route) and grep the response for the
// headers Apple + Jane Street reviewers will absolutely check.
// ---------------------------------------------------------------------------

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("security headers", () => {
  it("emits Content-Security-Policy on every response", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    const csp = res.headers["content-security-policy"];
    expect(typeof csp).toBe("string");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'none'");
  });

  it("emits X-Frame-Options: DENY", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("emits X-Content-Type-Options: nosniff", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("emits Strict-Transport-Security with a year-long max-age", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    const hsts = res.headers["strict-transport-security"];
    expect(typeof hsts).toBe("string");
    expect(hsts).toContain("max-age=31536000");
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).toContain("preload");
  });

  it("emits Referrer-Policy: strict-origin-when-cross-origin", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("emits Permissions-Policy with camera/microphone/geolocation disabled", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    const pp = res.headers["permissions-policy"];
    expect(typeof pp).toBe("string");
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("geolocation=()");
  });

  it("emits Cross-Origin-Opener-Policy: same-origin", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
  });
});

describe("request-id correlation", () => {
  it("echoes an X-Request-Id on every response", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    const id = res.headers["x-request-id"];
    expect(typeof id).toBe("string");
    expect(String(id).length).toBeGreaterThan(0);
  });

  it("accepts a caller-supplied X-Request-Id when it matches the ASCII pattern", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "caller-trace-1234" },
    });
    expect(res.headers["x-request-id"]).toBe("caller-trace-1234");
  });

  it("rejects a caller-supplied X-Request-Id that contains disallowed characters", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "bad trace with spaces" },
    });
    const id = res.headers["x-request-id"];
    // Server generated its own — it must match the UUID pattern.
    expect(id).not.toBe("bad trace with spaces");
    expect(typeof id).toBe("string");
    expect(String(id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a caller-supplied X-Request-Id that exceeds the length cap", async () => {
    const longId = "x".repeat(100);
    const res = await server.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": longId },
    });
    expect(res.headers["x-request-id"]).not.toBe(longId);
  });

  it("generates a fresh UUID when the caller does not supply one", async () => {
    const a = await server.inject({ method: "GET", url: "/health" });
    const b = await server.inject({ method: "GET", url: "/health" });
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });
});

describe("/metrics protection", () => {
  it("returns 404 when METRICS_TOKEN is unset (not discoverable)", async () => {
    // Test harness does not set METRICS_TOKEN → endpoint should 404
    // so a drive-by scan cannot tell the endpoint exists.
    const res = await server.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(404);
  });
});

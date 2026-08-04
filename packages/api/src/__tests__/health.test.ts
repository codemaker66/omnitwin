import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Health check — Fastify inject test
// ---------------------------------------------------------------------------

// Mock env vars before importing buildServer
process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
delete process.env["SENTRY_DSN"];
delete process.env["SENTRY_ENVIRONMENT"];
delete process.env["METRICS_TOKEN"];

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

// ---------------------------------------------------------------------------
// Build provenance — these assertions exist because the endpoint reported
// gitSha "dev" / version "0.0.0" in production for months while its own
// comment claimed CI injected them. Nothing asserted it, so nothing caught
// it, and deploys had to be verified by endpoint-behaviour flips instead.
// The image now stamps GIT_SHA / BUILD_TIMESTAMP / APP_VERSION via Dockerfile
// build args; these tests pin that the route actually surfaces them.
// ---------------------------------------------------------------------------

interface VersionBody {
  readonly version: string;
  readonly gitSha: string;
  readonly builtAt: string;
  readonly nodeEnv: string;
}

describe("GET /health/version (build provenance)", () => {
  const KEYS = ["GIT_SHA", "BUILD_TIMESTAMP", "APP_VERSION", "npm_package_version"] as const;
  const saved = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const key of KEYS) saved.set(key, process.env[key]);
  });

  afterAll(() => {
    for (const key of KEYS) {
      const previous = saved.get(key);
      if (previous === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = previous;
    }
  });

  it("surfaces the stamped image provenance when the build args are set", async () => {
    process.env["GIT_SHA"] = "abc1234";
    process.env["BUILD_TIMESTAMP"] = "2026-01-01T00:00:00Z";
    process.env["APP_VERSION"] = "1.2.3";

    const response = await server.inject({ method: "GET", url: "/health/version" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as VersionBody;
    expect(body.gitSha).toBe("abc1234");
    expect(body.builtAt).toBe("2026-01-01T00:00:00Z");
    expect(body.version).toBe("1.2.3");
  });

  it("falls back to dev placeholders when nothing is stamped, keeping the shape stable", async () => {
    for (const key of KEYS) Reflect.deleteProperty(process.env, key);

    const response = await server.inject({ method: "GET", url: "/health/version" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as VersionBody;
    expect(body.gitSha).toBe("dev");
    expect(body.builtAt).toBe("dev");
    expect(body.version).toBe("0.0.0");
    expect(typeof body.nodeEnv).toBe("string");
  });
});

describe("GET /health/observability", () => {
  it("reports missing optional observability env without exposing secrets", async () => {
    const response = await server.inject({ method: "GET", url: "/health/observability" });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as {
      status: string;
      sentry: { configured: boolean; status: string; environment: string; tracesSampleRate: number };
      metrics: { configured: boolean; status: string; endpoint: string };
      uptime: { status: string; probes: readonly string[] };
    };

    expect(body.status).toBe("ok");
    expect(body.sentry).toEqual({
      configured: false,
      status: "missing_env",
      environment: "test",
      tracesSampleRate: 0.1,
    });
    expect(body.metrics).toEqual({
      configured: false,
      status: "missing_env",
      endpoint: "/metrics",
    });
    expect(body.uptime.probes).toContain("/health/ready");
    expect(response.body).not.toContain("dsn");
    expect(response.body).not.toContain("token");
  });
});

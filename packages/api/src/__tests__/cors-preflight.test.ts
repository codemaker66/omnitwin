import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";

const { buildServer } = await import("../index.js");

const ORIGIN = "https://venviewer.com";
const PHASE_URL = "/event-phases/11111111-1111-4111-8111-111111111111";
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const env = {
  NODE_ENV: "production", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/cors_test",
  PORT: 3001, CORS_ORIGINS: `${ORIGIN}, https://preview.example.test`,
  EMAIL_FROM: "Venviewer <notifications@example.test>", VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE: "planner",
  SENTRY_TRACES_SAMPLE_RATE: 0, AI_ASSISTANT_ENABLED: "false",
} satisfies Env;

describe("production server CORS registration", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    // Exercise the real entry point in production mode, without credentials or
    // a database connection. Preflights and unauthenticated writes stop early.
    vi.stubEnv("NODE_ENV", "production");
    server = await buildServer(env);
  }, 30000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    vi.unstubAllEnvs();
  });

  it.each(METHODS)("permits an allowed browser origin to preflight %s", async (method) => {
    const response = await server.inject({
      method: "OPTIONS", url: PHASE_URL,
      headers: {
        origin: ORIGIN, "access-control-request-method": method,
        "access-control-request-headers": "authorization,content-type,idempotency-key",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(String(response.headers["access-control-allow-methods"]).split(/,\s*/u)).toContain(method);
    expect(response.headers["access-control-allow-headers"]).toBe("authorization,content-type,idempotency-key");
  });

  it("does not grant cross-origin access to an unlisted origin", async () => {
    const response = await server.inject({ method: "OPTIONS", url: PHASE_URL,
      headers: { origin: "https://untrusted.example.test", "access-control-request-method": "PATCH" } });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not advertise unsupported TRACE requests", async () => {
    const response = await server.inject({ method: "OPTIONS", url: PHASE_URL,
      headers: { origin: ORIGIN, "access-control-request-method": "TRACE" } });
    expect(String(response.headers["access-control-allow-methods"]).split(/,\s*/u)).not.toContain("TRACE");
  });

  it("keeps authentication on the actual PATCH while exposing existing response headers", async () => {
    const response = await server.inject({ method: "PATCH", url: PHASE_URL,
      headers: { origin: ORIGIN }, payload: { name: "Unauthenticated edit" } });
    expect(response.statusCode).toBe(401);
    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(String(response.headers["access-control-expose-headers"]).split(/,\s*/u))
      .toEqual(["x-content-sha256", "idempotency-replay"]);
  });
});

import type { FastifyInstance } from "fastify";
import { brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";

const { buildServer } = await import("../index.js");

const env = {
  NODE_ENV: "production", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/compression_test",
  PORT: 3001, CORS_ORIGINS: "https://venviewer.com",
  EMAIL_FROM: "Venviewer <notifications@example.test>", VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE: "planner",
  SENTRY_TRACES_SAMPLE_RATE: 0, AI_ASSISTANT_ENABLED: "false",
} satisfies Env;

// A layout-sized JSON body: repetitive keys, like placed objects.
const LAYOUT = {
  data: Array.from({ length: 200 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    assetDefinitionId: "round-table-6ft-white",
    positionX: index * 0.5, positionY: 0, positionZ: index * 0.25, rotationY: 0, scale: 1,
  })),
};
const BINARY = Buffer.alloc(64 * 1024, 7);

describe("production server response compression", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    // The real entry point in production mode, without a database. Probe
    // routes are added before ready so they receive the per-route hooks.
    vi.stubEnv("NODE_ENV", "production");
    server = await buildServer(env);
    server.get("/__compression-probe/layout", () => LAYOUT);
    server.get("/__compression-probe/small", () => ({ ok: true }));
    // Binary asset routes opt out with `compress: false`, like the real ones.
    server.get("/__compression-probe/binary", { compress: false }, (_request, reply) =>
      reply.header("content-type", "application/octet-stream").send(BINARY));
    server.get("/__compression-probe/binary-default", (_request, reply) =>
      reply.header("content-type", "application/octet-stream").send(BINARY));
    server.post("/__compression-probe/echo", (request) => ({ received: request.body }));
    await server.ready();
  }, 30000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    vi.unstubAllEnvs();
  });

  it("serves large JSON with brotli when the client accepts it", async () => {
    const response = await server.inject({ method: "GET", url: "/__compression-probe/layout",
      headers: { "accept-encoding": "gzip, deflate, br" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    expect(String(response.headers["vary"])).toMatch(/accept-encoding/i);
    const body = brotliDecompressSync(response.rawPayload);
    expect(JSON.parse(body.toString("utf8"))).toEqual(LAYOUT);
    expect(response.rawPayload.byteLength).toBeLessThan(body.byteLength / 4);
  });

  it("falls back to gzip and leaves identity clients uncompressed", async () => {
    const gzip = await server.inject({ method: "GET", url: "/__compression-probe/layout",
      headers: { "accept-encoding": "gzip" } });
    expect(gzip.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(gunzipSync(gzip.rawPayload).toString("utf8"))).toEqual(LAYOUT);

    const identity = await server.inject({ method: "GET", url: "/__compression-probe/layout" });
    expect(identity.headers["content-encoding"]).toBeUndefined();
    expect(identity.json()).toEqual(LAYOUT);
  });

  it("needs the per-route opt-out for binary bodies", async () => {
    // mime-db marks application/octet-stream compressible, so customTypes alone
    // cannot exclude it; binary routes must declare `compress: false`.
    const response = await server.inject({ method: "GET", url: "/__compression-probe/binary-default",
      headers: { "accept-encoding": "br" } });
    expect(response.headers["content-encoding"]).toBe("br");
  });

  it("leaves small JSON and opted-out binary assets untouched", async () => {
    const small = await server.inject({ method: "GET", url: "/__compression-probe/small",
      headers: { "accept-encoding": "br, gzip" } });
    expect(small.headers["content-encoding"]).toBeUndefined();
    expect(small.json()).toEqual({ ok: true });

    const binary = await server.inject({ method: "GET", url: "/__compression-probe/binary",
      headers: { "accept-encoding": "br, gzip" } });
    expect(binary.headers["content-encoding"]).toBeUndefined();
    expect(binary.rawPayload.equals(BINARY)).toBe(true);
  });

  it("does not accept compressed request bodies", async () => {
    const response = await server.inject({ method: "POST", url: "/__compression-probe/echo",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      payload: gzipSync(JSON.stringify({ planner: "layout" })) });
    expect(response.statusCode).toBe(400);
  });
});

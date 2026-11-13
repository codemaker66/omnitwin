import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DatabaseConnection } from "../db/client.js";
import { initSentry } from "../observability/sentry.js";
import { publicWebVitalsRoutes } from "../routes/public-web-vitals.js";

// ---------------------------------------------------------------------------
// API tracing leaves the page-speed reports out: a trace would carry the
// visitor's user agent, and the privacy page says nothing of the kind is kept
// (T-685; the release lead's S4, 13 November 2026). The real SDK is started
// as the API starts it (initSentry, every trace sampled) against a local
// stand-in for Sentry's ingest, as sentry-capture-path.test.ts does. Then the
// real route and a control route beside it are called over HTTP, so Fastify's
// and Node's own diagnostics channels drive the tracing as in production, and
// what the SDK named and what it sent are read back. No database: a report
// with Do Not Track is answered before anything is held.
// ---------------------------------------------------------------------------

/** The transaction names in one envelope (newline-delimited JSON: the
 *  envelope's header, then each item's header and payload). */
function transactionsIn(envelope: string): string[] {
  const lines = envelope.split("\n").filter((line) => line.trim() !== "");
  const names: string[] = [];
  for (let index = 1; index + 1 < lines.length; index += 2) {
    const header = JSON.parse(lines[index] ?? "{}") as { type?: unknown };
    if (header.type !== "transaction") continue;
    const payload = JSON.parse(lines[index + 1] ?? "{}") as { transaction?: unknown };
    if (typeof payload.transaction === "string") names.push(payload.transaction);
  }
  return names;
}

describe("API tracing of the page-speed reports (the real SDK, route and server)", () => {
  const savedSwitch = process.env["WEB_VITALS_COLLECTION"];
  const envelopes: string[] = [];
  /** Every transaction the SDK built, before its own filters ran. */
  const seen: string[] = [];
  let ingest: Server;
  let connection: DatabaseConnection;
  let server: FastifyInstance;
  let base = "";
  let flush: (timeout: number) => Promise<boolean>;

  beforeAll(async () => {
    ingest = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      request.on("end", () => {
        const body = Buffer.concat(chunks);
        envelopes.push((request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => { ingest.listen(0, "127.0.0.1", resolve); });
    const { port } = ingest.address() as AddressInfo;

    // The SDK's transport honours http_proxy; the stand-in ingest is local.
    vi.stubEnv("http_proxy", "");
    vi.stubEnv("HTTP_PROXY", "");
    process.env["WEB_VITALS_COLLECTION"] = "on";
    // As index.ts: Sentry before Fastify, so its instrumentation sees the server.
    await initSentry({ SENTRY_DSN: `http://public@127.0.0.1:${String(port)}/1`, NODE_ENV: "production", SENTRY_TRACES_SAMPLE_RATE: 1 });
    const Sentry = await import("@sentry/node");
    flush = Sentry.flush;
    Sentry.getClient()?.on("preprocessEvent", (event) => {
      if (event.type === "transaction" && event.transaction !== undefined) seen.push(event.transaction);
    });

    // Never connected: nothing here is held, so nothing reaches a database.
    connection = createDbConnection("postgresql://127.0.0.1:9/never_connected");
    server = Fastify();
    await server.register(publicWebVitalsRoutes, { prefix: "/public", db: connection.db });
    await server.register((control, _options, done) => {
      control.post("/control/:slug", (_request, reply) => reply.status(204).send());
      done();
    }, { prefix: "/public" });
    await server.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${String((server.server.address() as AddressInfo).port)}`;
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (savedSwitch === undefined) delete process.env["WEB_VITALS_COLLECTION"];
    else process.env["WEB_VITALS_COLLECTION"] = savedSwitch;
    await server?.close();
    await connection?.close();
    await new Promise<void>((resolve) => { ingest?.close(() => { resolve(); }); });
  });

  it("names the route's transaction by its pattern and sends it nowhere, while the route beside it is sent", async () => {
    const report = JSON.stringify({ v: 1, page: "/", device: "phone", metrics: [{ name: "TTFB", value: 310, rating: "good" }] });
    const vitals = await fetch(`${base}/public/web-vitals`, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8", dnt: "1" },
      body: report,
    });
    await vitals.arrayBuffer();
    expect(vitals.status).toBe(204);
    const control = await fetch(`${base}/public/control/abc123`, { method: "POST" });
    await control.arrayBuffer();
    expect(control.status).toBe(204);
    await vi.waitFor(async () => {
      await flush(2_000);
      expect(envelopes.flatMap(transactionsIn)).toContain("POST /public/control/:slug");
    }, { timeout: 10_000 });
    // Both requests were traced, each named by its route's pattern: the
    // instrumentation ran, so nothing below passes for want of a trace.
    expect(seen).toContain("POST /public/web-vitals");
    expect(seen).toContain("POST /public/control/:slug");
    // The SDK's own filter, given the API's options, kept the report's out.
    expect(envelopes.flatMap(transactionsIn).filter((name) => name.includes("web-vitals"))).toEqual([]);
  }, 30_000);
});

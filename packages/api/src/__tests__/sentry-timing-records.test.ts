import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initSentry } from "../observability/sentry.js";

// ---------------------------------------------------------------------------
// The API's timing records carry no browser details. Production samples one
// request in ten as a Sentry transaction whether or not anything failed, and
// the privacy page says such a record carries no address, identifier or
// browser details (Blake, 13 November 2026: "Strip browser details, say
// so"). The real SDK is started as the API starts it (initSentry, every
// request traced here) against a local stand-in for Sentry's ingest, as
// sentry-capture-path.test.ts and web-vitals-tracing.test.ts do. A request
// with a marked user agent and language is traced; the transaction as the SDK
// built it, just before the API's own scrubber, is read from the client's
// postprocessEvent hook (so the test cannot pass for want of the details),
// and what the SDK sent is read from the stand-in.
// ---------------------------------------------------------------------------

const MARKED_AGENT = "ProbeBrowser/9.9 (timing-record-marker-5ad1)";
const MARKED_LANGUAGE = "gd-GB";

interface SentTransaction {
  readonly transaction?: unknown;
  readonly request?: { readonly headers?: unknown };
}

/** The transactions in one envelope (newline-delimited JSON: the envelope's
 *  header, then each item's header and payload). */
function transactionsIn(envelope: string): SentTransaction[] {
  const lines = envelope.split("\n").filter((line) => line.trim() !== "");
  const found: SentTransaction[] = [];
  for (let index = 1; index + 1 < lines.length; index += 2) {
    const header = JSON.parse(lines[index] ?? "{}") as { type?: unknown };
    if (header.type === "transaction") found.push(JSON.parse(lines[index + 1] ?? "{}") as SentTransaction);
  }
  return found;
}

describe("the API's timing records (the real SDK and server)", () => {
  const envelopes: string[] = [];
  /** Each transaction as the SDK built it, before beforeSendTransaction ran. */
  const built: string[] = [];
  let ingest: Server;
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
    // As index.ts: Sentry before Fastify, so its instrumentation sees the server.
    await initSentry({ SENTRY_DSN: `http://public@127.0.0.1:${String(port)}/1`, NODE_ENV: "production", SENTRY_TRACES_SAMPLE_RATE: 1 });
    const Sentry = await import("@sentry/node");
    flush = Sentry.flush;
    // After the SDK's own processors (its request data among them), before
    // the API's beforeSendTransaction, which then changes the same object.
    Sentry.getClient()?.on("postprocessEvent", (event) => {
      if (event.type === "transaction") built.push(JSON.stringify(event));
    });

    server = Fastify();
    server.get("/venues/:id", (_request, reply) => reply.send({ id: "a-venue" }));
    await server.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${String((server.server.address() as AddressInfo).port)}`;
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server?.close();
    await new Promise<void>((resolve) => { ingest?.close(() => { resolve(); }); });
  });

  it("sends a sampled request's timing with no request header, no user agent and no language", async () => {
    const response = await fetch(`${base}/venues/0f0f0f0f-0000-4000-8000-000000000001`, {
      headers: { "user-agent": MARKED_AGENT, "accept-language": MARKED_LANGUAGE },
    });
    await response.arrayBuffer();
    expect(response.status).toBe(200);
    let sent: SentTransaction[] = [];
    await vi.waitFor(async () => {
      await flush(2_000);
      sent = envelopes.flatMap(transactionsIn).filter((event) => event.transaction === "GET /venues/:id");
      expect(sent).toHaveLength(1);
    }, { timeout: 10_000 });
    // The SDK did record the browser's details: without the scrubber they would be sent.
    expect(built.filter((event) => event.includes("timing-record-marker-5ad1"))).not.toEqual([]);
    // None of them was sent: no header, and neither marker anywhere in what reached the ingest.
    expect(sent[0]?.request?.headers).toBeUndefined();
    const everything = envelopes.join("\n");
    expect(everything).not.toContain("timing-record-marker-5ad1");
    expect(everything).not.toContain(MARKED_LANGUAGE);
  }, 30_000);
});

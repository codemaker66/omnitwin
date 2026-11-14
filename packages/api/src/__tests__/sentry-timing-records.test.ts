import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initSentry } from "../observability/sentry.js";

// ---------------------------------------------------------------------------
// The API's timing records carry no address, identifier or browser details.
// Production samples one request in ten as a Sentry transaction whether or
// not anything failed, and the privacy page says so (Blake, 13 November 2026:
// "Strip browser details, say so"). The real SDK is started as the API starts
// it (initSentry, every request traced here) against a local stand-in for
// Sentry's ingest, as sentry-capture-path.test.ts and
// web-vitals-tracing.test.ts do. A request with a marked user agent and
// language, and a record's code in its path, is traced, and its route calls
// out to a stand-in provider with an id in the URL. Each transaction as the
// SDK built it, just before the API's own scrubber, is read from the client's
// postprocessEvent hook (so the test cannot pass for want of the details),
// and what the SDK sent is read from the stand-in ingest. The tests' own
// requests carry no trace headers: the API's options send none
// (tracePropagationTargets), so they reach it as a browser's do.
// ---------------------------------------------------------------------------

const MARKED_AGENT = "ProbeBrowser/9.9 (timing-record-marker-5ad1)";
const MARKED_LANGUAGE = "gd-GB";
/** A record's code in the request's path, spelled only in letters: no rule
 *  for path segments could tell it from a word, so only the route's pattern
 *  takes it out. */
const CODE = "qwertyzx";
/** A provider's id in the URL of the call the route makes (as Clerk's users/<id>). */
const PROVIDER_ID = "user_2NNEqL2nrIRdJ194ndJqAHwEfxC";
/** An id in the URL of a call a route starts that ends after its reply. */
const LATE_ID = "late_9QwErTy2uIoP";
/** A caller's trace and its baggage, as another Sentry-instrumented service would send. */
const CALLER_TRACE_ID = "0123456789abcdef0123456789abcdef";
const CALLER_SPAN_ID = "0123456789abcdef";
const CALLER_TRACE = {
  "sentry-trace": `${CALLER_TRACE_ID}-${CALLER_SPAN_ID}-1`,
  baggage: `sentry-trace_id=${CALLER_TRACE_ID},sentry-sample_rand=0,sentry-sample_rate=1,sentry-sampled=true`,
};

interface SentTransaction {
  readonly transaction?: unknown;
  readonly request?: { readonly headers?: unknown; readonly url?: unknown };
  readonly contexts?: { readonly trace?: { readonly parent_span_id?: unknown } };
}

/** A transaction as the SDK built it, from the client's hook. */
interface BuiltTransaction {
  readonly transaction?: unknown;
  readonly trace?: { readonly trace_id?: unknown; readonly span_id?: unknown; readonly parent_span_id?: unknown };
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

const listen = (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => { resolve(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`); });
});

const close = (server: Server | undefined): Promise<void> => new Promise((resolve) => {
  if (server === undefined) resolve();
  else server.close(() => { resolve(); });
});

describe("the API's timing records (the real SDK and server)", () => {
  const envelopes: string[] = [];
  /** Each transaction as the SDK built it, before beforeSendTransaction ran. */
  const built: string[] = [];
  let ingest: Server | undefined;
  let provider: Server | undefined;
  let server: FastifyInstance | undefined;
  let base = "";
  let flush: (timeout: number) => Promise<boolean>;

  const builtWith = (text: string): BuiltTransaction[] =>
    built.filter((event) => event.includes(text)).map((event) => JSON.parse(event) as BuiltTransaction);

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
    const ingestBase = await listen(ingest);
    // A stand-in for a provider the routes call out to; slow for a late call,
    // so that call ends well after its route's reply.
    provider = createServer((request, response) => {
      request.resume();
      const answer = (): void => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      };
      if (request.url?.startsWith("/v1/late/") === true) setTimeout(answer, 500);
      else answer();
    });
    const providerBase = await listen(provider);

    // The SDK's transport honours http_proxy; the stand-ins are local.
    vi.stubEnv("http_proxy", "");
    vi.stubEnv("HTTP_PROXY", "");
    // As index.ts: Sentry before Fastify, so its instrumentation sees the server.
    await initSentry({ SENTRY_DSN: `${ingestBase.replace("http://", "http://public@")}/1`, NODE_ENV: "production", SENTRY_TRACES_SAMPLE_RATE: 1 });
    const Sentry = await import("@sentry/node");
    flush = Sentry.flush;
    // After the SDK's own processors (its request data among them), before
    // the API's beforeSendTransaction, which then works on the same object.
    // Only the plain parts are copied: the event still holds the SDK's scopes
    // then, and a hook that threw would drop the event.
    Sentry.getClient()?.on("postprocessEvent", (event) => {
      if (event.type !== "transaction") return;
      try {
        built.push(JSON.stringify({
          transaction: event.transaction,
          request: event.request,
          trace: event.contexts?.trace,
          spans: event.spans?.map((span) => ({ description: span.description, data: span.data })),
          breadcrumbs: event.breadcrumbs,
        }));
      } catch {
        built.push("{}");
      }
    });

    server = Fastify();
    server.get("/venues/:venueId", async () => {
      const call = await fetch(`${providerBase}/v1/users/${PROVIDER_ID}`);
      await call.arrayBuffer();
      return { id: "a-venue" };
    });
    server.get("/forced/:code", () => ({ ok: true }));
    server.get("/late/:code", (_request, reply) => {
      void reply.send({ ok: true });
      // Work the route started that ends after its reply, as a push or an email would.
      void fetch(`${providerBase}/v1/late/${LATE_ID}`).then((call) => call.arrayBuffer(), () => undefined);
    });
    await server.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${String((server.server.address() as AddressInfo).port)}`;
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server?.close();
    await close(provider);
    await close(ingest);
  });

  it("sends a sampled request's timing with no request header, user agent, language or record's id, nor its outgoing call's id", async () => {
    const response = await fetch(`${base}/venues/${CODE}`, {
      headers: { "user-agent": MARKED_AGENT, "accept-language": MARKED_LANGUAGE },
    });
    await response.arrayBuffer();
    expect(response.status).toBe(200);
    let sent: SentTransaction[] = [];
    await vi.waitFor(async () => {
      await flush(2_000);
      sent = envelopes.flatMap(transactionsIn).filter((event) => event.transaction === "GET /venues/:venueId");
      expect(sent).toHaveLength(1);
    }, { timeout: 10_000 });
    // The SDK did record all of it: without the scrubber it would be sent.
    // And the request came as a browser's does, with no trace of its own.
    const builtVenue = built.filter((event) => event.includes("\"GET /venues/:venueId\"")).join("\n");
    for (const marker of ["timing-record-marker-5ad1", MARKED_LANGUAGE, CODE, PROVIDER_ID]) expect(builtVenue).toContain(marker);
    expect(builtWith("\"GET /venues/:venueId\"").map((record) => record.trace?.parent_span_id)).toEqual([undefined]);
    // None of it was sent: no header, the route's pattern in place of the
    // path, and no marker or id anywhere in what reached the ingest.
    expect(sent[0]?.request?.headers).toBeUndefined();
    expect(sent[0]?.request?.url).toBe(`${base}/venues/:venueId`);
    const everything = envelopes.join("\n");
    for (const marker of ["timing-record-marker-5ad1", MARKED_LANGUAGE, CODE, PROVIDER_ID]) expect(everything).not.toContain(marker);
  }, 30_000);

  // #355's verifications (13 November 2026): a caller's baggage can set the
  // sampling draw (sample_rand), so a request that continues a caller's
  // trace is never sent as a timing record.
  it("sends no timing record of a request that continues a caller's trace", async () => {
    const response = await fetch(`${base}/forced/abcdef`, { headers: CALLER_TRACE });
    await response.arrayBuffer();
    expect(response.status).toBe(200);
    // Traced, and continuing the caller's trace: the SDK built its record...
    await vi.waitFor(() => {
      expect(builtWith("\"GET /forced/:code\"").map((record) => [record.trace?.trace_id, record.trace?.parent_span_id]))
        .toEqual([[CALLER_TRACE_ID, CALLER_SPAN_ID]]);
    }, { timeout: 10_000 });
    expect(await flush(5_000)).toBe(true);
    // ...and none was sent.
    expect(envelopes.flatMap(transactionsIn).filter((event) => event.transaction === "GET /forced/:code")).toEqual([]);
  }, 30_000);

  // The SDK sends the late part of a request already sent on its own, with a
  // parent span, the request's own URL and no route: never sent either. The
  // call's id proves nothing (the segment rules would replace it in a record
  // that was sent), so the test looks for the record itself, by its span id,
  // and for the request's own path, which no route would take out of it
  // (#355's last verification, 14 November 2026).
  it("sends no record of work a route started that ended after its reply", async () => {
    const response = await fetch(`${base}/late/abcdef`);
    await response.arrayBuffer();
    expect(response.status).toBe(200);
    let late: string[] = [];
    await vi.waitFor(() => {
      late = built.filter((event) => event.includes(LATE_ID)
        && typeof (JSON.parse(event) as BuiltTransaction).trace?.parent_span_id === "string");
      expect(late).not.toEqual([]);
    }, { timeout: 10_000 });
    // Not vacuous: the SDK built it with a span id of its own, and with the request's own path.
    const lateSpanIds = late.map((event) => (JSON.parse(event) as BuiltTransaction).trace?.span_id)
      .filter((spanId): spanId is string => typeof spanId === "string");
    expect(lateSpanIds).toHaveLength(late.length);
    for (const spanId of lateSpanIds) expect(spanId).toMatch(/^[\da-f]{16}$/u);
    expect(late.join("\n")).toContain("/late/abcdef");
    expect(await flush(5_000)).toBe(true);
    const everything = envelopes.join("\n");
    for (const spanId of lateSpanIds) expect(everything).not.toContain(spanId);
    expect(everything).not.toContain("/late/abcdef");
    expect(everything).not.toContain(LATE_ID);
    // No record that reached the ingest has a parent span, this file's others included.
    expect(envelopes.flatMap(transactionsIn).filter((event) => event.contexts?.trace?.parent_span_id !== undefined)
      .map((event) => event.transaction)).toEqual([]);
  }, 30_000);
});

import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import type * as SentryNode from "@sentry/node";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { initSentry } from "../observability/sentry.js";
import { EscalationScheduler } from "../services/escalation-scheduler.js";
import { installEscalationScheduler, pokeEscalationScheduler } from "../services/escalation-wake.js";

// ---------------------------------------------------------------------------
// The escalation sweep works for the whole venue, not for the request that
// woke it (T-764). A request raised or handed over pokes the scheduler from
// inside that request; whatever the poke starts (the plan's database reads,
// the timer it arms, and every pass and plan after that timer) runs in the
// async context it started in. Sentry keeps each request's scope in that
// context (@sentry/core 10.60 integrations/http/server-subscription.js: the
// request's URL and headers, the caller's address, a transaction name, and
// the trace), so a sweep run in a poker's context files its spans and any
// error under that request, hours later and on someone else's behalf.
//
// The real SDK is started as the API starts it (initSentry, every request
// traced) against a local stand-in for Sentry's ingest, as
// sentry-capture-path.test.ts does, and a real request over http pokes a
// real scheduler that keeps its own setTimeout. A plain AsyncLocalStorage
// store, set around the poke, stands for any other per-request context. The
// plan and the pass are stand-ins that record what they see (no database);
// the pass reports an error to Sentry, and what the SDK sent is read from
// the stand-in ingest.
// ---------------------------------------------------------------------------

/** A request's id in its path, so a record that names the request is found. */
const MARKER = "req_poker_4Kq9zW";
const RAISED_PATH = `/requests/${MARKER}/raise`;
/** A header no scrubber drops from an error event (sentry-capture-path.test.ts):
 *  where its value shows up, the poking request's headers went with it. */
const CONTROL_HEADER = "x-venviewer-control";
const CONTROL = "poker-6Wq1Zr";
/** What the stand-in context holds while the route pokes. */
const REQUEST_STORE = `request ${MARKER}`;
const PASS_ERROR = "escalation pass failed (T-764 probe)";

/** Stands for any per-request context beside Sentry's. */
const requestContext = new AsyncLocalStorage<string>();

/** What one stage saw of the context it ran in. */
interface Seen {
  readonly stage: "start" | "route" | "plan" | "pass";
  /** The stand-in's store. */
  readonly store: string | undefined;
  /** The request on Sentry's isolation scope: its URL and the marked header. */
  readonly url: string | undefined;
  readonly control: string | undefined;
  /** The trace of the active span, which a database or provider call's span would join. */
  readonly traceId: string | undefined;
}

interface SentEvent {
  readonly transaction?: string;
  readonly request?: { readonly url?: string; readonly headers?: Record<string, string> };
  readonly contexts?: { readonly trace?: { readonly trace_id?: string } };
  readonly exception?: { readonly values?: readonly { readonly value?: string }[] };
}

/** The error events in the envelopes received so far (newline-delimited
 *  JSON: the envelope's header, then each item's header and payload). */
function eventsIn(envelopes: readonly string[]): { event: SentEvent; raw: string }[] {
  const found: { event: SentEvent; raw: string }[] = [];
  for (const envelope of envelopes) {
    const lines = envelope.split("\n").filter((line) => line.trim() !== "");
    for (let index = 1; index + 1 < lines.length; index += 2) {
      const header = JSON.parse(lines[index] ?? "{}") as { type?: unknown };
      const payload = lines[index + 1] ?? "{}";
      if (header.type === "event") found.push({ event: JSON.parse(payload) as SentEvent, raw: payload });
    }
  }
  return found;
}

/** Waits until `ready` holds, checking every few milliseconds, or fails after `ms`. */
async function until(ready: () => boolean, what: string, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
}

describe("the escalation sweep keeps its own context (the real SDK and server)", () => {
  const envelopes: string[] = [];
  const seen: Seen[] = [];
  let Sentry: typeof SentryNode;
  let ingest: Server;
  let server: FastifyInstance;
  let scheduler: EscalationScheduler;
  let base = "";
  /** Set by the route: the next plan finds something due now. */
  let due = false;

  const look = (stage: Seen["stage"]): Seen => {
    const request = Sentry.getIsolationScope().getScopeData().sdkProcessingMetadata.normalizedRequest;
    return {
      stage,
      store: requestContext.getStore(),
      url: request?.url,
      control: request?.headers?.[CONTROL_HEADER],
      traceId: Sentry.getActiveSpan()?.spanContext().traceId,
    };
  };

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
    Sentry = await import("@sentry/node");

    // Built and started at start-up, outside any request, as diary-live.ts does.
    scheduler = new EscalationScheduler({
      db: {} as Database,
      onEscalated: () => undefined,
      plan: () => {
        seen.push(look(seen.length === 0 ? "start" : "plan"));
        const wake = due ? Date.now() : null;
        due = false;
        return Promise.resolve(wake);
      },
      run: () => {
        seen.push(look("pass"));
        Sentry.captureException(new Error(PASS_ERROR));
        return Promise.resolve([]);
      },
    });
    scheduler.start();
    installEscalationScheduler(scheduler);

    server = Fastify({ logger: false });
    // A request raised: the service pokes the scheduler once it is stored.
    server.post("/requests/:id/raise", () => {
      requestContext.run(REQUEST_STORE, () => {
        seen.push(look("route"));
        due = true;
        pokeEscalationScheduler();
      });
      return { raised: true };
    });
    await server.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${String((server.server.address() as AddressInfo).port)}`;

    // The visitor's call, in a scope of its own as a browser's is in its own
    // process: the SDK records this process's outgoing calls as breadcrumbs,
    // and this one would otherwise sit on the start-up scope the sweep uses.
    const response = await Sentry.withIsolationScope(() => fetch(`${base}${RAISED_PATH}`, { method: "POST", headers: { [CONTROL_HEADER]: CONTROL } }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    // The poke's plan, the pass its timer runs a beat later, and the plan after the pass.
    await until(() => seen.filter((entry) => entry.stage === "plan").length >= 2, "the plan after the pass");
    expect(await Sentry.flush(5_000)).toBe(true);
  }, 60_000);

  afterAll(async () => {
    scheduler?.stop();
    installEscalationScheduler(null);
    vi.unstubAllEnvs();
    await server?.close();
    await new Promise<void>((resolve) => { if (ingest === undefined) resolve(); else ingest.close(() => { resolve(); }); });
  });

  const route = (): Seen => {
    const found = seen.find((entry) => entry.stage === "route");
    if (found === undefined) throw new Error("the route never ran");
    return found;
  };

  it("sees the poking request's context in the route itself, so a leak would show", () => {
    expect(route()).toMatchObject({ store: REQUEST_STORE, control: CONTROL });
    expect(route().url).toContain(MARKER);
    expect(route().traceId).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("lends the poking request's context to neither the plan, the timer it arms nor the pass", () => {
    const afterPoke = seen.slice(seen.indexOf(route()) + 1);
    const none = { store: undefined, url: undefined, control: undefined };
    expect(afterPoke.map(({ stage, store, url, control }) => ({ stage, store, url, control }))).toEqual([
      { stage: "plan", ...none },
      { stage: "pass", ...none },
      { stage: "plan", ...none },
    ]);
    // No span the sweep starts (a database read, a provider's call) joins the request's trace.
    expect(afterPoke.filter((entry) => entry.traceId !== undefined && entry.traceId === route().traceId).map((entry) => entry.stage)).toEqual([]);
  });

  it("files an error from the pass under no request: not the poker's URL, headers, route or trace", () => {
    const sent = eventsIn(envelopes).filter(({ event }) => event.exception?.values?.[0]?.value === PASS_ERROR);
    expect(sent).toHaveLength(1);
    const [{ event, raw } = { event: {}, raw: "" }] = sent;
    expect({ request: event.request, transaction: event.transaction }).toEqual({ request: undefined, transaction: undefined });
    expect(event.contexts?.trace?.trace_id).not.toBe(route().traceId);
    expect(raw).not.toContain(MARKER);
    expect(raw).not.toContain(CONTROL);
  });
});

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
// Nor may one pass's records reach another's: outside a request, all work
// shares the start-up scope and its one trace, so each pass gets a scope and
// a trace of its own, as the SDK gives each request (#487's review).
//
// The real SDK is started as the API starts it (initSentry, every request
// traced) against a local stand-in for Sentry's ingest, as
// sentry-capture-path.test.ts does, and real requests over http poke a real
// scheduler that keeps its own setTimeout. A plain AsyncLocalStorage store,
// set around the poke, stands for any other per-request context. The plan
// and the pass are stand-ins that record what they see (no database); the
// first pass calls a stand-in provider (a push service), each pass reports an
// error to Sentry, and what the SDK sent is read from the stand-in ingest.
// ---------------------------------------------------------------------------

/** A request's id in its path, so a record that names the request is found. */
const MARKER = "req_poker_4Kq9zW";
/** The second poke's request. */
const SECOND_MARKER = "req_second_8Hn2pX";
/** A header no scrubber drops from an error event (sentry-capture-path.test.ts):
 *  where its value shows up, the poking request's headers went with it. */
const CONTROL_HEADER = "x-venviewer-control";
const CONTROL = "poker-6Wq1Zr";
/** What the stand-in context holds while the route pokes. */
const requestStore = (marker: string): string => `request ${marker}`;
const PASS_ERROR = "escalation pass failed (T-764 probe)";
const STARTUP_ERROR = "start-up error (T-764 probe)";
/** A subscriber's endpoint in the URL of the first pass's call to the push service. */
const PROVIDER_MARKER = "push-endpoint-first-pass-3Tr7";
/** What the first pass sets on its own scope: a tag, a user and a context. */
const PASS_TAG = "escalation.probe";
const PASS_USER = "pass-one-user-5Gh8";
/** The trace id in a `sentry-trace` value (`<trace>-<span>[-<sampled>]`). */
const traceIdOf = (sentryTrace: string | undefined): string | undefined => sentryTrace?.split("-")[0];

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
  readonly environment?: string;
  readonly tags?: Record<string, string>;
  readonly user?: { readonly id?: string };
  readonly request?: { readonly url?: string; readonly headers?: Record<string, string> };
  readonly contexts?: { readonly trace?: { readonly trace_id?: string }; readonly pass?: unknown };
  readonly exception?: { readonly values?: readonly { readonly value?: string }[] };
  readonly breadcrumbs?: readonly { readonly data?: { readonly url?: string } }[];
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

const listen = (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => { resolve(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`); });
});

const close = (server: Server | undefined): Promise<void> => new Promise((resolve) => {
  if (server === undefined) resolve();
  else server.close(() => { resolve(); });
});

describe("the escalation sweep keeps its own context (the real SDK and server)", () => {
  const envelopes: string[] = [];
  const seen: Seen[] = [];
  let Sentry: typeof SentryNode;
  let ingest: Server;
  let provider: Server;
  let server: FastifyInstance;
  let scheduler: EscalationScheduler;
  let base = "";
  let providerBase = "";
  /** Set by the route: the next plan finds something due now. */
  let due = false;
  let passes = 0;
  /** The trace each pass is on, as its outgoing calls would carry it. */
  const passTraces: (string | undefined)[] = [];

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
  const plans = (): number => seen.filter((entry) => entry.stage === "plan").length;

  /** The visitor's call, in a scope of its own as a browser's is in its own
   *  process: the SDK records this process's outgoing calls as breadcrumbs,
   *  and this one would otherwise sit on the start-up scope. */
  async function raise(marker: string): Promise<void> {
    const response = await Sentry.withIsolationScope(() => fetch(`${base}/requests/${marker}/raise`, { method: "POST", headers: { [CONTROL_HEADER]: CONTROL } }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  }

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
    provider = createServer((_request, response) => { response.writeHead(201); response.end(); });
    providerBase = await listen(provider);

    // The SDK's transport honours http_proxy; the stand-in ingest is local.
    vi.stubEnv("http_proxy", "");
    vi.stubEnv("HTTP_PROXY", "");
    // As index.ts: Sentry before Fastify, so its instrumentation sees the server.
    await initSentry({ SENTRY_DSN: `${ingestBase.replace("http://", "http://public@")}/1`, NODE_ENV: "production", SENTRY_TRACES_SAMPLE_RATE: 1 });
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
      run: async () => {
        seen.push(look("pass"));
        passes += 1;
        passTraces.push(traceIdOf(Sentry.getTraceData()["sentry-trace"]));
        if (passes === 1) {
          await (await fetch(`${providerBase}/push/${PROVIDER_MARKER}`, { method: "POST" })).arrayBuffer();
          Sentry.setTag(PASS_TAG, "first");
          Sentry.setUser({ id: PASS_USER });
          Sentry.setContext("pass", { first: true });
        }
        Sentry.captureException(new Error(`${PASS_ERROR} ${String(passes)}`));
        return [];
      },
    });
    scheduler.start();
    installEscalationScheduler(scheduler);
    // Start-up's own error, outside any request and outside the sweep.
    Sentry.captureException(new Error(STARTUP_ERROR));

    server = Fastify({ logger: false });
    // A request raised: the service pokes the scheduler once it is stored.
    server.post<{ Params: { id: string } }>("/requests/:id/raise", (request) => {
      requestContext.run(requestStore(request.params.id), () => {
        seen.push(look("route"));
        due = true;
        pokeEscalationScheduler();
      });
      return { raised: true };
    });
    await server.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${String((server.server.address() as AddressInfo).port)}`;

    // Each poke's plan, the pass its timer runs a beat later, and the plan after the pass.
    await raise(MARKER);
    await until(() => plans() >= 2, "the plan after the first pass");
    await raise(SECOND_MARKER);
    await until(() => plans() >= 4, "the plan after the second pass");
    expect(await Sentry.flush(5_000)).toBe(true);
  }, 60_000);

  afterAll(async () => {
    scheduler?.stop();
    installEscalationScheduler(null);
    vi.unstubAllEnvs();
    await server?.close();
    await close(provider);
    await close(ingest);
  });

  const route = (): Seen => {
    const found = seen.find((entry) => entry.stage === "route");
    if (found === undefined) throw new Error("the route never ran");
    return found;
  };
  const sentFor = (value: string): { event: SentEvent; raw: string } => {
    const sent = eventsIn(envelopes).filter(({ event }) => event.exception?.values?.[0]?.value === value);
    expect(sent, value).toHaveLength(1);
    return sent[0] ?? { event: {}, raw: "" };
  };
  const crumbsOf = (event: SentEvent): string[] => (event.breadcrumbs ?? []).map((crumb) => crumb.data?.url ?? "");

  it("sees the poking request's context in the route itself, so a leak would show", () => {
    expect(route()).toMatchObject({ store: requestStore(MARKER), control: CONTROL });
    expect(route().url).toContain(MARKER);
    expect(route().traceId).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("lends the poking request's context to neither the plan, the timer it arms nor the pass", () => {
    const afterPoke = seen.slice(seen.indexOf(route()) + 1).filter((entry) => entry.stage !== "route");
    const none = { store: undefined, url: undefined, control: undefined };
    expect(afterPoke.map(({ stage, store, url, control }) => ({ stage, store, url, control }))).toEqual([
      { stage: "plan", ...none },
      { stage: "pass", ...none },
      { stage: "plan", ...none },
      { stage: "plan", ...none },
      { stage: "pass", ...none },
      { stage: "plan", ...none },
    ]);
    // No span the sweep starts (a database read, a provider's call) joins a request's trace.
    const routeTraces = new Set(seen.filter((entry) => entry.stage === "route").map((entry) => entry.traceId));
    expect(afterPoke.filter((entry) => entry.traceId !== undefined && routeTraces.has(entry.traceId)).map((entry) => entry.stage)).toEqual([]);
  });

  it("files an error from a pass under no request: not the poker's URL, headers, route or trace", () => {
    for (const pass of [1, 2]) {
      const { event, raw } = sentFor(`${PASS_ERROR} ${String(pass)}`);
      expect({ request: event.request, transaction: event.transaction }).toEqual({ request: undefined, transaction: undefined });
      expect(event.contexts?.trace?.trace_id).not.toBe(route().traceId);
      for (const marker of [MARKER, SECOND_MARKER, CONTROL]) expect(raw).not.toContain(marker);
    }
  });

  it("gives each pass a scope and a trace of its own: nothing of one pass, or of start-up, reaches another's error", () => {
    const first = sentFor(`${PASS_ERROR} 1`).event;
    const second = sentFor(`${PASS_ERROR} 2`).event;
    const startUp = sentFor(STARTUP_ERROR).event;
    // Not vacuous: a pass's own call is on its own error.
    expect(crumbsOf(first).filter((url) => url.includes(PROVIDER_MARKER))).toHaveLength(1);
    expect(crumbsOf(second).filter((url) => url.includes(PROVIDER_MARKER))).toEqual([]);
    const traces = [first, second, startUp].map((event) => event.contexts?.trace?.trace_id);
    expect(traces.every((trace) => typeof trace === "string" && /^[0-9a-f]{32}$/u.test(trace))).toBe(true);
    expect(new Set(traces).size).toBe(3);
  });

  it("files an error from a pass on that pass's own trace, the one its calls carry", () => {
    expect(passTraces).toHaveLength(2);
    expect(passTraces.every((trace) => trace !== undefined && /^[0-9a-f]{32}$/u.test(trace))).toBe(true);
    expect([1, 2].map((pass) => sentFor(`${PASS_ERROR} ${String(pass)}`).event.contexts?.trace?.trace_id)).toEqual(passTraces);
  });

  it("forks each pass's scope from start-up's, not the pass before: what a pass sets stays on its own errors, the client's environment on all", () => {
    const set = (event: SentEvent): unknown => ({ tag: event.tags?.[PASS_TAG], user: event.user?.id, context: event.contexts?.pass });
    // Not vacuous: the first pass's own error carries what it set.
    expect(set(sentFor(`${PASS_ERROR} 1`).event)).toEqual({ tag: "first", user: PASS_USER, context: { first: true } });
    expect(set(sentFor(`${PASS_ERROR} 2`).event)).toEqual({ tag: undefined, user: undefined, context: undefined });
    expect([`${PASS_ERROR} 1`, `${PASS_ERROR} 2`, STARTUP_ERROR].map((value) => sentFor(value).event.environment)).toEqual(["production", "production", "production"]);
  });
});

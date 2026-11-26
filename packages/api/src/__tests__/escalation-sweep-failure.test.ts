import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { gunzipSync } from "node:zlib";
import type * as SentryNode from "@sentry/node";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { apiLoggerOptions } from "../observability/health-redaction.js";
import { initSentry } from "../observability/sentry.js";
import { EscalationScheduler } from "../services/escalation-scheduler.js";

// ---------------------------------------------------------------------------
// A failed escalation pass reaches Sentry (T-766). Before, it was only
// logged, so a sweep that kept failing stopped escalations with no alert.
// The real SDK is started as the API starts it, against a local stand-in for
// Sentry's ingest (as sentry-capture-path.test.ts does), with the API's own
// production logger. The pass throws as a database write that failed would
// (Drizzle's `Failed query: ... params: ...`, with its cause), and the
// parameters carry a guest's name, as a notification's title and body do.
// What the SDK sent and what the log wrote are read back.
// ---------------------------------------------------------------------------

const GUEST = "Jane Guest";
const FAILED_QUERY = `Failed query: insert into "notifications" ("title", "body") values ($1, $2)\nparams: Still waiting: 2 chairs,${GUEST} asked for this and nobody has picked it up yet.`;
const CAUSE = "duplicate key value violates unique constraint \"notifications_pkey\"";

interface SentEvent {
  readonly transaction?: string;
  readonly environment?: string;
  readonly tags?: Record<string, string>;
  readonly request?: unknown;
  readonly contexts?: { readonly trace?: { readonly trace_id?: string } };
  readonly exception?: { readonly values?: readonly { readonly value?: string }[] };
}

/** The error events in the envelopes received so far. */
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

describe("a failed escalation pass reaches Sentry (the real SDK)", () => {
  const envelopes: string[] = [];
  const logLines: string[] = [];
  let Sentry: typeof SentryNode;
  let ingest: Server;
  let logs: FastifyInstance;
  let scheduler: EscalationScheduler;
  let due = false;
  let plans = 0;
  /** The trace the failing pass was on, as its outgoing calls would carry it. */
  let passTrace: string | undefined;

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
    vi.stubEnv("http_proxy", "");
    vi.stubEnv("HTTP_PROXY", "");
    await initSentry({ SENTRY_DSN: `http://public@127.0.0.1:${String(port)}/1`, NODE_ENV: "production", SENTRY_TRACES_SAMPLE_RATE: 1 });
    Sentry = await import("@sentry/node");

    // The API's production logger, writing to a stream the test reads.
    const loggerOptions = apiLoggerOptions("production");
    if (loggerOptions === false) throw new Error("production logs");
    const stream = new Writable({ write(chunk: Buffer, _encoding, done) { logLines.push(chunk.toString("utf8")); done(); } });
    logs = Fastify({ logger: { ...loggerOptions, stream } });

    scheduler = new EscalationScheduler({
      db: {} as Database,
      logger: logs.log,
      onEscalated: () => undefined,
      plan: () => {
        plans += 1;
        const wake = due ? Date.now() : null;
        due = false;
        return Promise.resolve(wake);
      },
      run: () => {
        passTrace = Sentry.getTraceData()["sentry-trace"]?.split("-")[0];
        return Promise.reject(new Error(FAILED_QUERY, { cause: new Error(CAUSE) }));
      },
    });
    scheduler.start();
    due = true;
    scheduler.poke();
    const deadline = Date.now() + 5_000;
    while (plans < 3 && Date.now() < deadline) await new Promise((resolve) => { setTimeout(resolve, 10); });
    expect(plans).toBe(3);
    expect(await Sentry.flush(5_000)).toBe(true);
  }, 60_000);

  afterAll(async () => {
    scheduler?.stop();
    vi.unstubAllEnvs();
    await logs?.close();
    await new Promise<void>((resolve) => { if (ingest === undefined) resolve(); else ingest.close(() => { resolve(); }); });
  });

  const failure = (): { event: SentEvent; raw: string } => {
    const sent = eventsIn(envelopes).filter(({ event }) => event.exception?.values?.some((value) => value.value?.startsWith("Failed query: insert into") === true) === true);
    expect(sent).toHaveLength(1);
    return sent[0] ?? { event: {}, raw: "" };
  };

  it("sends the failure once, tagged with the sweep and the step, on the pass's own trace and under no request", () => {
    const { event } = failure();
    expect(event.tags).toMatchObject({ "background.task": "escalation-sweep", "escalation.stage": "pass" });
    expect({ request: event.request, transaction: event.transaction }).toEqual({ request: undefined, transaction: undefined });
    expect(passTrace).toMatch(/^[0-9a-f]{32}$/u);
    expect(event.contexts?.trace?.trace_id).toBe(passTrace);
    expect(event.environment).toBe("production");
  });

  it("sends the query and its cause, never its parameters: the guest's name stays out", () => {
    const { event, raw } = failure();
    const values = (event.exception?.values ?? []).map((value) => value.value ?? "");
    expect(values.some((value) => value.includes("params: [redacted]"))).toBe(true);
    expect(values).toContain(CAUSE);
    expect(raw).not.toContain(GUEST);
  });

  it("still logs every failure, with its step and the streak's count, and no parameters", () => {
    const line = logLines.find((entry) => entry.includes("request escalation sweep failed"));
    expect(line).toBeDefined();
    expect(JSON.parse(line ?? "{}")).toMatchObject({ stage: "pass", failures: 1 });
    expect(line).not.toContain(GUEST);
  });
});

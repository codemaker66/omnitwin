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
const GUEST_EMAIL = "jane.guest@example.com";
/** Two requests one wake fails on: one at its claim, one at its email. */
const CLAIM_FAILED = "0b0c2a5e-0000-4000-8000-00000000c1a1";
const EMAIL_FAILED = "0b0c2a5e-0000-4000-8000-00000000e3a1";
const FAILED_QUERY = `Failed query: insert into "notifications" ("title", "body") values ($1, $2)\nparams: Still waiting: 2 chairs,${GUEST} asked for this and nobody has picked it up yet.`;
/** PostgreSQL's own message for a value typed into the wrong field quotes the
 *  value (PostgreSQL 16.6, probed 27 Nov 2026); the scrubber keeps the enum's
 *  name and drops the value. */
const CAUSE = `invalid input value for enum request_state: "${GUEST_EMAIL}"`;
const SCRUBBED_CAUSE = "invalid input value for enum request_state: \"[redacted]\"";
/** The database's own error, as node-postgres raises one: its message quotes
 *  the value, and `detail`, `hint` and `where` can quote a row's. The SDK
 *  sends a cause's type and message only, through the API's scrubber; with
 *  extraErrorDataIntegration, which the API does not use, `detail` would be
 *  sent too (seen 26 Nov 2026). */
const databaseError = (): Error => Object.assign(new Error(CAUSE), {
  severity: "ERROR",
  code: "22P02",
  detail: `Key (email)=(${GUEST_EMAIL}) already exists.`,
  hint: `Choose an address other than ${GUEST_EMAIL}.`,
  where: `SQL statement for ${GUEST_EMAIL}`,
  schema: "public",
  table: "users",
  column: "email",
  constraint: "users_email_key",
});

interface SentEvent {
  readonly transaction?: string;
  readonly environment?: string;
  readonly tags?: Record<string, string>;
  readonly request?: unknown;
  readonly contexts?: { readonly trace?: { readonly trace_id?: string } };
  readonly exception?: { readonly values?: readonly { readonly value?: string }[] };
}

/** An event as JSON without the SDK's copy of the source lines around each
 *  stack frame (the ContextLines integration's pre_context, context_line and
 *  post_context). In production those lines are the API's own code; here they
 *  are this file's, which spells out the very values the test plants, so
 *  leaving them in would test this file's text, not what the error carried. */
function withoutSourceLines(event: unknown): string {
  return JSON.stringify(event, (key, value: unknown) => (key === "pre_context" || key === "context_line" || key === "post_context" ? undefined : value));
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
  /** The scheduler whose pass fails on two requests at once. */
  let partial: EscalationScheduler;
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
        return Promise.reject(new Error(FAILED_QUERY, { cause: databaseError() }));
      },
    });
    scheduler.start();
    due = true;
    scheduler.poke();
    const deadline = Date.now() + 5_000;
    while (plans < 3 && Date.now() < deadline) await new Promise((resolve) => { setTimeout(resolve, 10); });
    expect(plans).toBe(3);

    // A wake whose pass failed on two requests (T-768): one report, the
    // failures together, each quoting a guest as the database would.
    let partialPlans = 0;
    let partialDue = true;
    partial = new EscalationScheduler({
      db: {} as Database,
      logger: logs.log,
      onEscalated: () => undefined,
      plan: () => {
        partialPlans += 1;
        const wake = partialDue ? Date.now() : null;
        partialDue = false;
        return Promise.resolve(wake);
      },
      run: () => Promise.resolve({
        escalated: [],
        failed: [
          { requestId: CLAIM_FAILED, step: "claim" as const, error: new Error(`invalid input syntax for type uuid: "${GUEST_EMAIL}"`) },
          { requestId: EMAIL_FAILED, step: "email" as const, error: new Error(`Failed query: update "requests" set "escalation_emailed_at" = $1 where "id" = $2\nparams: ${GUEST},${GUEST_EMAIL}`) },
        ],
        emailed: [],
        passFailures: [],
      }),
    });
    partial.start();
    const partialDeadline = Date.now() + 5_000;
    while (partialPlans < 2 && Date.now() < partialDeadline) await new Promise((resolve) => { setTimeout(resolve, 10); });
    expect(partialPlans).toBe(2);
    expect(await Sentry.flush(5_000)).toBe(true);
  }, 60_000);

  afterAll(async () => {
    scheduler?.stop();
    partial?.stop();
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
    expect(values).toContain(SCRUBBED_CAUSE);
    expect(withoutSourceLines(JSON.parse(raw))).not.toContain(GUEST);
  });

  it("sends none of the value the database quoted: not in its message, nor in detail, hint or where", () => {
    const data = withoutSourceLines(JSON.parse(failure().raw));
    // Not vacuous: the cause itself is there, by its scrubbed message, with the enum's name.
    expect(data).toContain(SCRUBBED_CAUSE.replaceAll("\"", "\\\""));
    expect(data).not.toContain(GUEST_EMAIL);
    expect(data).not.toContain("Key (email)");
  });

  it("reports each request a wake failed on on its own, naming it, with its message through the scrubber and no guest's value (T-768, LN1 c)", () => {
    const named = (requestId: string): { event: SentEvent; raw: string }[] => eventsIn(envelopes).filter(({ event }) => event.tags?.["escalation.request"] === requestId);
    const claim = named(CLAIM_FAILED);
    const email = named(EMAIL_FAILED);
    expect([claim.length, email.length]).toEqual([1, 1]);
    expect(claim[0]?.event.tags).toMatchObject({ "background.task": "escalation-sweep", "escalation.stage": "claim" });
    expect(email[0]?.event.tags).toMatchObject({ "background.task": "escalation-sweep", "escalation.stage": "email" });
    expect(claim[0]?.event.exception?.values?.map((value) => value.value)).toEqual(["invalid input syntax for type uuid: \"[redacted]\""]);
    expect(email[0]?.event.exception?.values?.[0]?.value).toContain("params: [redacted]");
    // Each inner message travels in exactly one event (LD1).
    const carrying = (fragment: string): number => eventsIn(envelopes).filter(({ event }) => event.exception?.values?.some((value) => value.value?.includes(fragment) === true) === true).length;
    expect([carrying("invalid input syntax for type uuid"), carrying("escalation_emailed_at")]).toEqual([1, 1]);
    for (const { raw } of [...claim, ...email]) {
      const data = withoutSourceLines(JSON.parse(raw));
      expect(data).not.toContain(GUEST_EMAIL);
      expect(data).not.toContain(GUEST);
    }
  });

  it("still logs every failure, with its step and the streak's count, and no parameters", () => {
    const line = logLines.find((entry) => entry.includes("request escalation sweep failed"));
    expect(line).toBeDefined();
    expect(JSON.parse(line ?? "{}")).toMatchObject({ stage: "pass", failures: 1 });
    expect(line).not.toContain(GUEST);
  });
});

import type { FastifyInstance } from "fastify";
import { WEB_VITALS_REPORT_BYTES, WebVitalsReportSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  WEB_VITALS_ADDRESS_KEY_ROTATION_MS,
  WEB_VITALS_BATCH_EVERY_MS,
  WEB_VITALS_DAILY_REPORT_CEILING,
  createAddressKey,
  createDailyCeiling,
  createWebVitalsBatch,
  webVitalsCollectionEnabled,
  type AddressKey,
  type WebVitalsBatch,
} from "../services/web-vitals.js";

// ---------------------------------------------------------------------------
// POST /public/web-vitals — a sampled page load's field vitals (goal 07).
//
// No session: the visitor is anonymous and stays so. The body is a route
// pattern, a device class and up to four numbers, checked whole
// (WebVitalsReportSchema), so neither an address nor anything else about the
// visitor is kept, and the route writes no access line (which would carry the
// address). A browser sends it as text with fetch's keepalive, which needs no
// CORS preflight; JSON is read either way. Off (404) unless
// WEB_VITALS_COLLECTION=on. Anyone can post a number here, so the limiter
// bounds an address, a daily ceiling (this process's) bounds everyone
// together, and the p75 is read as a measure, never as a guarantee. The
// limiter keys an address by an HMAC under a secret replaced every ten
// minutes (createAddressKey), so it never holds the address itself, and API
// tracing leaves this route out (observability/sentry.ts).
//
// A report is not written when it arrives: its samples are held, each on its
// vital's step and without anything about who sent it, and written on the
// hour once their group (one vital of one page, device class and day) holds
// ten, in a shuffled batch (createWebVitalsBatch). Every report is sent at one
// size, so the host's log of its size says nothing of what it carries. On
// what a row and that log share, a row then narrows only to its group of ten
// or more, short of the residuals docs/engineering/web-vitals.md names.
// ---------------------------------------------------------------------------

/** A report is a few hundred bytes; anything far larger is not one. */
const REPORT_BODY_LIMIT_BYTES = 4_096;

function readBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

export interface PublicWebVitalsOptions {
  db: Database;
  dailyReportCeiling?: number;
  /** The limiter's key for an address; tests pass one to see it is used. */
  addressKey?: AddressKey;
  /** Where samples wait to be written; tests pass one to write on demand. */
  batch?: WebVitalsBatch;
  /** How often the held samples are written (hourly). */
  flushEveryMs?: number;
}

export async function publicWebVitalsRoutes(server: FastifyInstance, opts: PublicWebVitalsOptions): Promise<void> {
  const batch = opts.batch ?? createWebVitalsBatch(opts.db, {
    ceiling: createDailyCeiling(opts.dailyReportCeiling ?? WEB_VITALS_DAILY_REPORT_CEILING),
  });
  const addressKey = opts.addressKey ?? createAddressKey();
  // On a timer, not on the next request: a quiet hour must not keep the secret.
  const rotation = setInterval(addressKey.rotate, WEB_VITALS_ADDRESS_KEY_ROTATION_MS);
  rotation.unref();
  const write = async (closing: boolean): Promise<void> => {
    try {
      await batch.flush({ closing });
    } catch (error) {
      // Nothing of any visitor is in this line: the batch never holds one. The
      // error says which: the database refused the batch (dropped), the write
      // was unfinished at its bound (it may still be stored), the write before
      // was still unfinished, or a close had too little time left to write.
      server.log.error({ err: error }, "Web vitals: a batch write failed or was given up on");
    }
  };
  const writing = setInterval(() => { void write(false); }, opts.flushEveryMs ?? WEB_VITALS_BATCH_EVERY_MS);
  writing.unref();
  server.addHook("onClose", async () => {
    clearInterval(rotation);
    clearInterval(writing);
    await write(true);
  });

  // In this route's scope only, a JSON body arrives as its text, as a beacon's
  // does, so the route can measure what was sent before reading it.
  server.removeContentTypeParser("application/json");
  server.addContentTypeParser("application/json", { parseAs: "string" }, (_request, text, done) => {
    done(null, text);
  });

  server.post("/web-vitals", {
    bodyLimit: REPORT_BODY_LIMIT_BYTES,
    // No per-request access line: it would carry remoteAddress, and the
    // notice says the address is not kept with the measurement. Errors still
    // log (as POST /public/quiz-runs).
    logLevel: "warn",
    // A page load sends one report, and another for a vital first measured
    // after a hide; an office shares one address. Keyed without the address
    // itself (createAddressKey).
    config: { rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: (request) => addressKey.keyFor(request.ip) } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!webVitalsCollectionEnabled()) {
      return reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
    }
    // The page checks Global Privacy Control and Do Not Track before measuring;
    // a report that arrives with either header anyway (an extension, an older
    // page) is answered and nothing is kept, as the privacy page promises.
    if (request.headers["sec-gpc"] === "1" || request.headers["dnt"] === "1") {
      return reply.status(204).send();
    }
    // Every report is sent at one size (WEB_VITALS_REPORT_BYTES): the host's
    // request log records each request's size, which would otherwise follow
    // what the report carries. One of any other length is refused. The body
    // itself is measured, not its Content-Length, which a proxy may drop.
    const body: unknown = request.body;
    if (typeof body !== "string" || Buffer.byteLength(body) !== WEB_VITALS_REPORT_BYTES) {
      return reply.status(400).send({ error: "Not a web vitals report", code: "VALIDATION_ERROR" });
    }
    const parsed = WebVitalsReportSchema.safeParse(readBody(body));
    if (!parsed.success) {
      return reply.status(400).send({ error: "Not a web vitals report", code: "VALIDATION_ERROR" });
    }
    // Only the report itself is held: not the request, its address or agent.
    if (!batch.hold(parsed.data)) {
      return reply.status(429).send({ error: "Enough reports for today", code: "WEB_VITALS_DAILY_CEILING" });
    }
    return reply.status(204).send();
  });
}

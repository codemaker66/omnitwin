import type { FastifyInstance } from "fastify";
import { WebVitalsReportSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  WEB_VITALS_DAILY_REPORT_CEILING,
  createDailyCeiling,
  recordWebVitals,
  webVitalsCollectionEnabled,
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
// bounds an address, a daily ceiling bounds everyone together, and the p75 is
// read as a measure, never as a guarantee.
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

export async function publicWebVitalsRoutes(
  server: FastifyInstance,
  opts: { db: Database; dailyReportCeiling?: number },
): Promise<void> {
  const { db } = opts;
  const ceiling = createDailyCeiling(opts.dailyReportCeiling ?? WEB_VITALS_DAILY_REPORT_CEILING);

  server.post("/web-vitals", {
    bodyLimit: REPORT_BODY_LIMIT_BYTES,
    // No per-request access line: it would carry remoteAddress, and the
    // notice says the address is not kept with the measurement. Errors still
    // log (as POST /public/quiz-runs).
    logLevel: "warn",
    // A page load sends one report, and another if it is restored from the
    // back/forward cache; an office shares one address.
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!webVitalsCollectionEnabled()) {
      return reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
    }
    const parsed = WebVitalsReportSchema.safeParse(readBody(request.body));
    if (!parsed.success) {
      return reply.status(400).send({ error: "Not a web vitals report", code: "VALIDATION_ERROR" });
    }
    if (!ceiling.admit()) {
      return reply.status(429).send({ error: "Enough reports for today", code: "WEB_VITALS_DAILY_CEILING" });
    }
    await recordWebVitals(db, parsed.data);
    return reply.status(204).send();
  });
}

import type { FastifyInstance } from "fastify";
import { WebVitalsReportSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { recordWebVitals, webVitalsCollectionEnabled } from "../services/web-vitals.js";

// ---------------------------------------------------------------------------
// POST /public/web-vitals — a sampled page load's field vitals (goal 07).
//
// No session: the visitor is anonymous and stays so. The body is a route
// pattern, a device class and up to four numbers, checked whole
// (WebVitalsReportSchema), so neither an address nor anything else about the
// visitor is kept. A browser sends it with navigator.sendBeacon as text, which
// needs no CORS preflight; JSON is read either way. Off (404) unless
// WEB_VITALS_COLLECTION=on. Anyone can post a number here, so the limiter
// bounds it and the p75 is read as a measure, never as a guarantee.
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
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.post("/web-vitals", {
    bodyLimit: REPORT_BODY_LIMIT_BYTES,
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
    await recordWebVitals(db, parsed.data);
    return reply.status(204).send();
  });
}

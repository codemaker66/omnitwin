import type { FastifyServerOptions } from "fastify";
import { redactHealthFreeText, redactHealthFreeTextInString } from "@omnitwin/types";
import { errorLogSerializer, requestLogSerializer } from "./redact.js";

// ---------------------------------------------------------------------------
// Guests' allergy notes stay out of the server's logs and error reports
// (fix-first item 18).
//
// The free-text "other allergies" note travels in configuration metadata, in
// sheet snapshots and in request bodies. A database error can repeat a whole
// row or the query's parameters in its message, and a log line can carry a
// body. Rather than trust every call site, the redaction sits at the two
// boundaries everything leaves through:
//
//   - the logger's final write (pino's streamWrite hook): the finished JSON
//     line, whatever was logged and however it was nested, is scrubbed of the
//     note before it reaches stdout or a transport;
//   - Sentry's beforeSend: the whole event (exception messages, breadcrumbs,
//     contexts, extra) is scrubbed, after the request body and query string
//     are dropped as before.
//
// The counts per diet are not about anyone and are left alone.
// ---------------------------------------------------------------------------

/** Fastify's logger options object (pino's options; fastify does not export
 *  the pino type by name). */
type ApiLoggerConfig = Exclude<FastifyServerOptions["logger"], boolean | undefined>;

export const HEALTH_REDACTING_LOG_HOOKS: NonNullable<ApiLoggerConfig["hooks"]> = {
  streamWrite: redactHealthFreeTextInString,
};

/**
 * `req` replaces Fastify's default request serializer so the query string
 * (a client's name, email or phone on the search routes) never reaches the
 * log: the url is logged as "/people/search?[redacted]". `err` does the same
 * for errors: no query parameters in the message or stack, no pg
 * `detail`/`where`, down the cause chain (observability/redact.ts).
 */
export const API_LOG_SERIALIZERS = {
  req: requestLogSerializer,
  err: errorLogSerializer,
} as const;

export type ApiLoggerMode = "development" | "test" | "production";

/** The API's logger options: the same redaction in every mode that logs. */
export function apiLoggerOptions(mode: ApiLoggerMode): false | ApiLoggerConfig {
  if (mode === "test") return false;
  if (mode === "development") {
    return {
      level: "info",
      hooks: HEALTH_REDACTING_LOG_HOOKS,
      serializers: API_LOG_SERIALIZERS,
      transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
    };
  }
  return { level: "info", hooks: HEALTH_REDACTING_LOG_HOOKS, serializers: API_LOG_SERIALIZERS };
}

/** The minimum of a Sentry event this boundary touches. */
interface SentryEventLike {
  request?: {
    data?: unknown;
    query_string?: unknown;
    headers?: Record<string, string>;
  };
}

/**
 * Sentry's beforeSend for the API: drop the request body, query string and
 * credentials (as before), then scrub any allergy note left anywhere in the
 * event. The event is plain data, so the scrubbed copy has the same shape.
 */
export function scrubApiSentryEvent<T extends SentryEventLike>(event: T): T {
  if (event.request !== undefined) {
    event.request.data = undefined;
    event.request.query_string = undefined;
    if (event.request.headers !== undefined) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
    }
  }
  return redactHealthFreeText(event) as T;
}

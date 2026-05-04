import type { FastifyRequest } from "fastify";
import type { Env } from "../env.js";

// ---------------------------------------------------------------------------
// Sentry — error tracking + tracing for Fastify
//
// Design tenets:
//   1. ZERO production risk when SENTRY_DSN is unset. The SDK is not
//      even imported in that case — dev / CI / self-hosted installs
//      without Sentry stay behaviourally identical.
//   2. Init BEFORE Fastify routes register so the instrumentation
//      patches the HTTP layer before any handler runs.
//   3. Scrub PII — we never send `request.user.email` or planner
//      notes to Sentry. The beforeSend hook strips request bodies
//      and query/path params that might carry sensitive values.
// ---------------------------------------------------------------------------

/**
 * Initialise the Sentry Node SDK if SENTRY_DSN is configured.
 * Safe to call with `env.SENTRY_DSN === undefined` — no-op.
 *
 * Dynamic import keeps the cold-start cost off dev / CI boots.
 */
export async function initSentry(env: Env): Promise<void> {
  if (env.SENTRY_DSN === undefined) return;

  const Sentry = await import("@sentry/node");

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,

    // Redact anything that could carry PII before the event leaves
    // the process. Sentry's default `sendDefaultPii` is false but we
    // go further and actively scrub request bodies + headers, since
    // our routes include planner notes and email addresses.
    beforeSend(event) {
      if (event.request !== undefined) {
        event.request.data = undefined;
        event.request.query_string = undefined;
        if (event.request.headers !== undefined) {
          delete event.request.headers["authorization"];
          delete event.request.headers["cookie"];
        }
      }
      return event;
    },
  });
}

/**
 * Build the Sentry capture callback for `registerErrorNormalizer`. The
 * normaliser (see `middleware/error-normalizer.ts`) owns the Fastify
 * `setErrorHandler` and invokes this callback for every 5xx before
 * reshaping the response. Returning `undefined` when SENTRY_DSN is
 * unset makes the normaliser skip the side-channel entirely.
 *
 * Only 5xx + unstatused errors reach this callback — the normaliser
 * filters on status first, so client-side 4xx noise never reaches
 * Sentry.
 */
export async function buildSentryCapture(
  env: Env,
): Promise<((error: unknown, request: FastifyRequest) => void) | undefined> {
  if (env.SENTRY_DSN === undefined) return undefined;

  const Sentry = await import("@sentry/node");

  return (error, request): void => {
    Sentry.withScope((scope) => {
      scope.setTag("route.method", request.method);
      // routeOptions.url is the path TEMPLATE (e.g. "/configurations/:id")
      // — much better for Sentry grouping than the raw URL.
      const routeUrl: string = request.routeOptions.url ?? request.url;
      scope.setTag("route.url", routeUrl);
      scope.setContext("request", {
        id: request.id,
        ip: request.ip,
      });
      Sentry.captureException(error);
    });
  };
}

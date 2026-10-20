import type { FastifyRequest } from "fastify";
import type { NodeOptions } from "@sentry/node";
import type { Env } from "../env.js";
import { scrubApiSentryEvent } from "./health-redaction.js";
import { scrubBreadcrumb, scrubErrorEvent, scrubTransaction } from "./redact.js";

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
//      notes to Sentry. The beforeSend hook strips request bodies;
//      query strings are scrubbed everywhere (error events,
//      breadcrumbs, transactions and their spans), because the search
//      routes carry a name, email or phone in `?q=`.
// ---------------------------------------------------------------------------

/** The settings the Sentry options are built from. */
export type SentryOptionsEnv = Pick<Env, "SENTRY_DSN" | "SENTRY_ENVIRONMENT" | "NODE_ENV" | "SENTRY_TRACES_SAMPLE_RATE">;

/**
 * The options `initSentry` hands to `Sentry.init`. Pure, so a test can
 * assert the redaction hooks without initialising the SDK.
 *
 * Redact anything that could carry PII before the event leaves the
 * process. Sentry's default `sendDefaultPii` is false but we go further:
 *   - beforeSend: request bodies, credentials, query strings and the
 *     query parameters in exception values (`./redact.ts`), then any guest
 *     allergy note left in a message or breadcrumb (`./health-redaction.ts`);
 *   - beforeSendTransaction: the query in request urls and span attributes;
 *   - beforeBreadcrumb: the query in http breadcrumbs.
 */
export function buildSentryOptions(env: SentryOptionsEnv): NodeOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    beforeSend: (event) => scrubApiSentryEvent(scrubErrorEvent(event)),
    beforeSendTransaction: scrubTransaction,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

/**
 * Initialise the Sentry Node SDK if SENTRY_DSN is configured.
 * Safe to call with `env.SENTRY_DSN === undefined` — no-op.
 *
 * Dynamic import keeps the cold-start cost off dev / CI boots.
 */
export async function initSentry(env: Env): Promise<void> {
  if (env.SENTRY_DSN === undefined) return;

  const Sentry = await import("@sentry/node");

  Sentry.init(buildSentryOptions(env));
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

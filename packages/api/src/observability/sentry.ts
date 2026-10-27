import type { FastifyRequest } from "fastify";
import type { NodeOptions, fastifyIntegration } from "@sentry/node";
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
//   3. Scrub PII — we never send `request.user.email`, the caller's IP
//      address or planner notes to Sentry. The beforeSend hook strips
//      request bodies; query strings and capability tokens are scrubbed
//      everywhere (error events, breadcrumbs, transactions and their
//      spans), because the search routes carry a name, email or phone in
//      `?q=` and a share link's token opens what it shares.
//   4. One capture path: the error normaliser's 5xx hook. The SDK's own
//      Fastify integration keeps tracing and captures nothing.
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

/** One of the SDK's integrations (@sentry/core's type, which @sentry/node does not re-export). */
type Integration = ReturnType<typeof fastifyIntegration>;

/** The options the SDK's own Fastify integration is rebuilt with. */
export interface FastifyIntegrationOptions {
  readonly shouldHandleError: () => boolean;
}

/**
 * One capture path. With tracing on, the SDK's own Fastify integration also
 * captures what a route handler throws, judged before the error handler has
 * set the status (still 200 then): each 5xx a second time beside the
 * normaliser's hook (on 18 Oct 2026 the stored event was the integration's,
 * without the hook's route tags), and the errors that answer 400 or 404,
 * which the normaliser keeps out on purpose. The normaliser's 5xx hook
 * (`buildSentryCapture`) is the API's one capture path; the integration keeps
 * its tracing and captures nothing.
 */
export function withOneCapturePath(
  makeFastifyIntegration: (options: FastifyIntegrationOptions) => Integration,
): (defaults: Integration[]) => Integration[] {
  return (defaults) => defaults.map((integration) => (integration.name === "Fastify"
    ? makeFastifyIntegration({ shouldHandleError: () => false })
    : integration));
}

/**
 * Initialise the Sentry Node SDK if SENTRY_DSN is configured.
 * Safe to call with `env.SENTRY_DSN === undefined` — no-op.
 *
 * Dynamic import keeps the cold-start cost off dev / CI boots.
 */
export async function initSentry(env: SentryOptionsEnv): Promise<void> {
  if (env.SENTRY_DSN === undefined) return;

  const Sentry = await import("@sentry/node");

  Sentry.init({ ...buildSentryOptions(env), integrations: withOneCapturePath(Sentry.fastifyIntegration) });
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
  env: Pick<Env, "SENTRY_DSN">,
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
      // The request id joins the event to its log line. Never the caller's
      // IP address: it is personal data, and the id already finds the line.
      scope.setContext("request", {
        id: request.id,
      });
      Sentry.captureException(error);
    });
  };
}

import type { FastifyRequest } from "fastify";
import type { NodeOptions, fastifyIntegration } from "@sentry/node";
import type { Env } from "../env.js";
import { scrubApiSentryEvent } from "./health-redaction.js";
import { scrubBreadcrumb, scrubErrorEvent, scrubTransaction, type ScrubbableTransaction } from "./redact.js";

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
//      address or planner notes to Sentry. Request bodies are dropped from
//      error events and transactions; query strings, capability tokens and
//      the caller's address are scrubbed everywhere (error events,
//      breadcrumbs, transactions and their spans), because the search
//      routes carry a name, email or phone in `?q=` and a share link's
//      token opens what it shares.
//   4. One capture path: the error normaliser's 5xx hook. The SDK's own
//      Fastify integration keeps tracing and captures nothing.
// ---------------------------------------------------------------------------

/** The page-speed reports' route: API tracing leaves it out (buildSentryOptions). */
export const WEB_VITALS_TRANSACTION = "/public/web-vitals";

/** The settings the Sentry options are built from. */
export type SentryOptionsEnv = Pick<Env, "SENTRY_DSN" | "SENTRY_ENVIRONMENT" | "NODE_ENV" | "SENTRY_TRACES_SAMPLE_RATE">;

/**
 * Whether a timing record has a parent span, and so is not a request's own
 * whole record. Two kinds have one, and neither is sent:
 *   - a request that arrived carrying a trace (sentry-trace and baggage
 *     headers). The web app sends none, and this API sends them to no one
 *     (tracePropagationTargets), so only another caller does, and its baggage
 *     can set the sampling draw (sample_rand) to make every one of its
 *     requests a record; dropped, the rate alone decides which requests are
 *     timed, and the privacy page's "about one request in ten" holds;
 *   - the late part of a request already sent: work a route started that
 *     ended after its reply (a push, an email, a provider's call), which the
 *     SDK sends on its own with a parent. It has no route of its own, so its
 *     URLs would go through the segment rules alone (a push endpoint's token
 *     with a colon in it is not taken for an id).
 * (#355's verifications, 13 November 2026.)
 */
export function hasParentSpan(event: ScrubbableTransaction): boolean {
  return event.contexts?.trace?.parent_span_id !== undefined;
}

/**
 * The options `initSentry` hands to `Sentry.init`. Pure, so a test can
 * assert the redaction hooks without initialising the SDK.
 *
 * Redact anything that could carry PII before the event leaves the
 * process. Sentry's default `sendDefaultPii` is false but we go further:
 *   - beforeSend: request bodies, credentials, query strings and the
 *     query parameters in exception values (`./redact.ts`), then any guest
 *     allergy note left in a message or breadcrumb (`./health-redaction.ts`);
 *   - beforeSendTransaction: the timing records carry no address, identifier
 *     or browser details (`scrubTransaction`: no request header, breadcrumb,
 *     query, body or token, and no segment that looks like a record's id in
 *     any URL), as the privacy page says, and one with a parent span is not
 *     sent (`hasParentSpan`);
 *   - beforeBreadcrumb: the query in http breadcrumbs.
 */
export function buildSentryOptions(env: SentryOptionsEnv): NodeOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // No trace headers on any request this process makes (to Clerk, Stripe,
    // Resend, R2): the services need none, and the baggage would tell them
    // our trace ids and route names. The tests' own requests to the API, made
    // in this process, so carry none either, and are timed as a browser's are
    // (#355's verification, 13 November 2026).
    tracePropagationTargets: [],
    // A page-speed report is traced by no one: the privacy page says the
    // server keeps only the timings and logs nothing for them (T-685,
    // 12 November 2026); before #355 a trace also carried the visitor's user
    // agent. A string here matches any transaction whose name contains it; a
    // failure still reaches Sentry through the error normaliser's capture.
    ignoreTransactions: [WEB_VITALS_TRANSACTION],
    beforeSend: (event) => scrubApiSentryEvent(scrubErrorEvent(event)),
    beforeSendTransaction: (event) => (hasParentSpan(event) ? null : scrubTransaction(event)),
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
 * set the status (still 200 then). It captured each 5xx first, so the SDK
 * dropped the normaliser hook's capture of the same error and the stored
 * event lacked the hook's route tags (seen 18 Oct 2026); and it captured the
 * errors that answer 400 or 404, which the normaliser keeps out on purpose.
 * The normaliser's 5xx hook (`buildSentryCapture`) is the API's one capture
 * path; the integration keeps its tracing and captures nothing.
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

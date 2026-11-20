import type { FastifyRequest } from "fastify";
import type { NodeOptions, fastifyIntegration } from "@sentry/node";
import type { Env } from "../env.js";
import { scrubApiSentryEvent } from "./health-redaction.js";
import { requestUrlOf, scrubBreadcrumb, scrubErrorEvent, scrubTransaction, type ScrubbableTransaction } from "./redact.js";

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
 *   - the late part of a request already sent, which the SDK sends on its
 *     own with a parent: work a route started that ended after its reply (a
 *     push, an email, a provider's call), whose record repeats the request's
 *     own URL but not its route, so a code spelled only in letters there
 *     could not be told from a word and would be sent; and, where the caller
 *     went away before the route finished (an aborted or timed-out request,
 *     whose record the SDK sends when the connection closes), the route's own
 *     work, its database and provider calls included. That work keeps its
 *     route, but nothing in its record tells it from the late part of a
 *     request that continued a caller's trace, so it is not sent either: the
 *     request's own record still shows how long it took until the caller
 *     went away.
 * (#355's verifications, 13 and 14 November 2026.)
 */
export function hasParentSpan(event: ScrubbableTransaction): boolean {
  return event.contexts?.trace?.parent_span_id !== undefined;
}

/**
 * Whether a record is a request's own and has no route: its `http.route` is
 * missing or names no path, and it is the SDK's `http.server` record or any
 * other that carries a request's URL or path (`requestUrlOf`, redact.ts).
 * Fastify's not-found handler gives no route at all. The API's one catch-all
 * route, @fastify/cors's OPTIONS "*", is never timed: the SDK's sampler
 * refuses OPTIONS and HEAD requests. A GET whose path looks like a static
 * file, and a WebSocket upgrade, get no `http.server` span from the SDK, so
 * Fastify's own request span roots their records, with the path in
 * `url.path`. Requests no
 * route matched still get records: an unknown path's 429 from the limiter on
 * unmatched paths (index.ts), a malformed URL's 400. Their own path could go
 * only through the segment rules, which keep an email-shaped segment, a phone
 * number, a short booking number and much else, so none is sent; such a
 * request has almost no timing worth keeping. (An unknown path's 404 never
 * reaches here: the SDK drops records of 401 to 404 itself.) The one routed
 * kind found without a route goes too: a request Fastify answers 503 while
 * closing, before any hook runs, which Fastify logs. A record of work outside
 * any request carries no request URL and keeps the segment rules; the late
 * part of a request repeats its URL, but has a parent and is never sent
 * (`hasParentSpan`, judged first). (#355's review at
 * 33db2ba1, WX1, and the verification of its fix, 18 November 2026.)
 */
export function isUnroutedRequest(event: ScrubbableTransaction): boolean {
  const trace = event.contexts?.trace;
  // Sentry types a trace context's attribute bag as `{ [key: string]: any }`: read as unknown, then narrowed.
  const route: unknown = trace?.data?.["http.route"];
  if (typeof route === "string" && route.startsWith("/")) return false;
  return trace?.op === "http.server" || requestUrlOf(event) !== undefined;
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
 *     or browser details (`scrubTransaction`: no browser-supplied header
 *     beyond the host and content length, no user, tag, breadcrumb, query,
 *     body or token, and no segment that looks like a record's id in any
 *     URL), as the privacy page says; one with a parent span is not sent
 *     (`hasParentSpan`), nor is a request's record that no route matched
 *     (`isUnroutedRequest`);
 *   - beforeBreadcrumb: the query in http breadcrumbs.
 * Leave `dataCollection` unset: in @sentry/core 10.60 any key in it switches
 * its base to collect everything (the user's address, cookies, every body),
 * which the scrubbers would then have to undo (#355's review, WX3).
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
    beforeSendTransaction: (event) => (hasParentSpan(event) || isUnroutedRequest(event) ? null : scrubTransaction(event)),
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

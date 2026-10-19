import type { Breadcrumb, ErrorEvent, NodeOptions } from "@sentry/node";

// ---------------------------------------------------------------------------
// Redaction — keeps query strings out of request logs and error reports.
//
// `GET /people/search?q=` and `GET /clients/search?q=` carry a client's name,
// email or phone in the query string. Personal data stays out of logs and
// error tracking: ids and outcomes only. Three places would otherwise record
// the raw URL:
//
//   1. Fastify's request log line (pino's `req` serializer writes req.url).
//   2. Sentry error events (`event.request.url`) and http breadcrumbs.
//   3. Sentry transactions: `event.request.url`, plus span attributes the
//      OpenTelemetry HTTP instrumentation records (`url.full`, `http.url`,
//      `http.target`, `url.query`).
//
// Everything here is pure and has no runtime dependency on @sentry/node
// (type imports only), so it can be imported without initialising the SDK.
// ---------------------------------------------------------------------------

/** What replaces a query string, so a reader can tell one existed. */
export const REDACTED_QUERY_MARKER = "?[redacted]";

/**
 * Cut everything from the first `?` and leave a marker in its place.
 * Works for relative and absolute URLs; a fragment that followed the query
 * goes with it. A URL with no `?` is returned unchanged.
 */
export function withoutQuery(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  return `${url.slice(0, queryStart)}${REDACTED_QUERY_MARKER}`;
}

// --- Request log serializer -------------------------------------------------

/**
 * The parts of a Fastify request the log serializer reads. Declared
 * structurally so a plain object can stand in for a request in tests.
 */
export interface LoggableRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  readonly host?: string;
  readonly ip?: string;
  readonly socket?: { readonly remotePort?: number } | undefined;
}

// A type alias, not an interface: Fastify's `serializers.req` return type
// has a string index signature, which only an alias of an object type meets.
export type SerializedRequest = {
  readonly method: string;
  readonly url: string;
  readonly version: string | undefined;
  readonly host: string | undefined;
  readonly remoteAddress: string | undefined;
  readonly remotePort: number | undefined;
};

/** Node joins repeated headers with ", "; mirror that for the array typing. */
function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * Drop-in replacement for Fastify's default `req` log serializer
 * (fastify@5 lib/logger-pino.js `asReqValue`): the same six fields, with
 * only `url` changed so the query string never reaches the log.
 */
export function requestLogSerializer(request: LoggableRequest): SerializedRequest {
  return {
    method: request.method,
    url: withoutQuery(request.url),
    version: headerValue(request.headers?.["accept-version"]),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

// --- Sentry scrubbers -------------------------------------------------------

/**
 * `@sentry/node` does not re-export `TransactionEvent`, so take it from the
 * option it is the argument of.
 */
export type ScrubbableTransaction = Parameters<NonNullable<NodeOptions["beforeSendTransaction"]>>[0];

/** Span / trace attribute keys whose value is, or contains, a URL. */
const URL_ATTRIBUTE_KEYS: readonly string[] = ["url.full", "http.url", "http.target"];

/** Span / trace attribute keys that hold a bare query string. */
const QUERY_ATTRIBUTE_KEYS: readonly string[] = ["url.query", "http.query"];

function scrubAttributes(data: Record<string, unknown> | undefined): void {
  if (data === undefined) return;
  for (const key of QUERY_ATTRIBUTE_KEYS) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- attribute bags are open-ended records
    delete data[key];
  }
  for (const key of URL_ATTRIBUTE_KEYS) {
    const value = data[key];
    if (typeof value === "string") data[key] = withoutQuery(value);
  }
}

/**
 * `beforeSend`: strips request bodies, the query string, the authorization
 * and cookie headers, and the query from `request.url`.
 */
export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  if (event.request !== undefined) {
    event.request.data = undefined;
    event.request.query_string = undefined;
    if (event.request.url !== undefined) {
      event.request.url = withoutQuery(event.request.url);
    }
    if (event.request.headers !== undefined) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
    }
  }
  return event;
}

/** Breadcrumb categories the SDK uses for outgoing http calls. */
const HTTP_BREADCRUMB_CATEGORIES: readonly string[] = ["http", "fetch", "xhr"];

/**
 * `beforeBreadcrumb`: strips the query from an http breadcrumb's
 * `data.url` and from its `message` (the SDK writes "GET <url>").
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data: Record<string, unknown> | undefined = breadcrumb.data;
  if (data !== undefined) {
    const url = data["url"];
    if (typeof url === "string") data["url"] = withoutQuery(url);
  }
  const isHttp =
    breadcrumb.type === "http" ||
    (breadcrumb.category !== undefined && HTTP_BREADCRUMB_CATEGORIES.includes(breadcrumb.category));
  if (isHttp && breadcrumb.message !== undefined) {
    breadcrumb.message = withoutQuery(breadcrumb.message);
  }
  return breadcrumb;
}

/**
 * `beforeSendTransaction`: strips the query from `request.url`, removes
 * `request.query_string`, and cleans the URL-bearing attributes on every
 * span and on the trace context.
 */
export function scrubTransaction(event: ScrubbableTransaction): ScrubbableTransaction {
  if (event.request !== undefined) {
    if (event.request.url !== undefined) {
      event.request.url = withoutQuery(event.request.url);
    }
    delete event.request.query_string;
  }
  scrubAttributes(event.contexts?.trace?.data);
  for (const span of event.spans ?? []) {
    scrubAttributes(span.data);
  }
  return event;
}

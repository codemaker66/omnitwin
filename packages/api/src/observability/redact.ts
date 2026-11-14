import type { Breadcrumb, ErrorEvent, NodeOptions } from "@sentry/node";
import { templateCapabilityPaths, templateCapabilityPathsDeep } from "@omnitwin/types";
import { PLAN_CLAIM_SECRET_HEADER } from "../services/configuration-claim-secrets.js";

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
//   3. Sentry transactions: any string anywhere in one (the request's URL,
//      span attributes under any key, `url` and `url.full` among them, span
//      descriptions, the name). scrubTransaction walks them all, and also
//      replaces each record's id in them (the privacy page's "no identifier").
//
// The same three places, and anything else an event, breadcrumb or
// transaction quotes, also lose the segment after a capability path
// (/proposal-share/<token>, /public/configurations/<guest layout id> and the
// rest in @omnitwin/types capability-paths): whoever reads a log or an event
// could otherwise open the proposal, approve it or overwrite the layout.
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
 * only `url` changed so the query string and a capability path's token never
 * reach the log.
 */
export function requestLogSerializer(request: LoggableRequest): SerializedRequest {
  return {
    method: request.method,
    url: templateCapabilityPaths(withoutQuery(request.url)),
    version: headerValue(request.headers?.["accept-version"]),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

// --- Error values -----------------------------------------------------------
//
// drizzle-orm's DrizzleQueryError (0.45.2, errors.js) builds its message as
// `Failed query: <sql>\nparams: <values>`. The SQL holds placeholders; the
// values are emails, names and phones on People Book and enquiry writes. The
// pg error it wraps (`cause`) can quote the offending row in `detail`/`where`.

/** What replaces a query-parameters block, so a reader can tell one existed. */
export const REDACTED_PARAMS_MARKER = "params: [redacted]";

// From a `params:` line to the end of its block: the next stack frame
// ("    at ..."), a "caused by:" line, or the end of the text. Values can span
// several lines, so the block is not just the one line. Anchored to the start
// of a line so "route params: id" in prose is left alone.
const PARAMS_BLOCK = /(^|\n)params:[\s\S]*?(?=\n[ \t]+at |\ncaused by: |$)/g;

/**
 * Replace a query-parameters block with a marker and keep the rest, including
 * the SQL text. A message with no `params:` line is returned unchanged.
 */
export function scrubErrorMessage(message: string): string {
  return message.replace(PARAMS_BLOCK, `$1${REDACTED_PARAMS_MARKER}`);
}

/** Error properties that help diagnosis and carry schema names, never row values. */
const DIAGNOSTIC_ERROR_FIELDS: readonly string[] = [
  "code",
  "constraint",
  "table",
  "column",
  "schema",
  "routine",
  "severity",
  "statusCode",
];

/** Stops a pathological cause chain; real chains are two or three deep. */
const MAX_CAUSE_DEPTH = 8;

// A type alias, not an interface: Fastify's `serializers.err` return type
// has a string index signature, which only an alias of an object type meets.
export type SerializedError = {
  readonly type: string;
  readonly message: string;
  readonly stack: string;
  readonly [key: string]: unknown;
};

function isErrorLike(value: unknown): value is Readonly<Record<string, unknown>> & { readonly message: string } {
  return typeof value === "object" && value !== null && typeof (value as { message?: unknown }).message === "string";
}

function serialiseError(err: Readonly<Record<string, unknown>> & { readonly message: string }, seen: Set<object>, depth: number): SerializedError {
  seen.add(err);
  const constructorName = (err.constructor as { name?: unknown } | undefined)?.name;
  const name = err["name"];
  const out: Record<string, unknown> = {
    type:
      typeof constructorName === "string" && constructorName !== ""
        ? constructorName
        : typeof name === "string"
          ? name
          : "Error",
    message: scrubErrorMessage(err.message),
    stack: typeof err["stack"] === "string" ? scrubErrorMessage(err["stack"]) : "",
  };
  // An allowlist, not a denylist: `detail`, `where`, `hint`, `internalQuery`,
  // `query` and `params` can all quote row values, and so could a field a
  // later driver adds.
  for (const field of DIAGNOSTIC_ERROR_FIELDS) {
    const value = err[field];
    if (typeof value === "string" || typeof value === "number") out[field] = value;
  }
  const cause = err["cause"];
  if (isErrorLike(cause)) {
    if (!seen.has(cause) && depth < MAX_CAUSE_DEPTH) {
      out["cause"] = serialiseError(cause, seen, depth + 1);
    }
  } else if (typeof cause === "string") {
    out["cause"] = scrubErrorMessage(cause);
  }
  const errors = err["errors"];
  if (Array.isArray(errors) && depth < MAX_CAUSE_DEPTH) {
    out["aggregateErrors"] = errors
      .filter((inner): inner is Readonly<Record<string, unknown>> & { readonly message: string } => isErrorLike(inner) && !seen.has(inner))
      .map((inner) => serialiseError(inner, seen, depth + 1));
  }
  return out as SerializedError;
}

/**
 * Drop-in replacement for pino's standard `err` serializer
 * (pino-std-serializers@7 lib/err.js), for the API request log. Same
 * `type`, `message` and `stack`, but every message and stack goes through
 * `scrubErrorMessage`, the causes are serialised one level each (with the
 * same treatment) instead of being folded into the message, and only the
 * allow-listed diagnostic fields are copied. `detail`, `where`, `query`,
 * `params` and everything else are dropped.
 */
export function errorLogSerializer(err: unknown): SerializedError {
  if (isErrorLike(err)) return serialiseError(err, new Set(), 0);
  // A thrown string or object: log its text, scrubbed, never its fields.
  return {
    type: "NonError",
    message: scrubErrorMessage(typeof err === "string" ? err : Object.prototype.toString.call(err)),
    stack: "",
  };
}

// --- Sentry scrubbers -------------------------------------------------------

/**
 * `@sentry/node` does not re-export `TransactionEvent`, so take it from the
 * option it is the argument of.
 */
export type ScrubbableTransaction = Parameters<NonNullable<NodeOptions["beforeSendTransaction"]>>[0];

/** Span / trace attribute keys whose value is, or contains, a URL, whose
 *  query is cut first. The Fastify span writes the request url, query
 *  included, to `url.path`. A transaction's URLs under any key (the SDK's
 *  plain `url` among them) then go through scrubTransaction's walk. */
const URL_ATTRIBUTE_KEYS: readonly string[] = ["url.full", "http.url", "http.target", "url.path"];

/**
 * Headers that carry a credential, or something a reader of a report could
 * use as one:
 *   - `authorization`: the sign-in token, and the workflow and metrics tokens;
 *   - `cookie`: the sign-in provider's `__session` cookie, and any other;
 *   - the claim-secret header: a guest plan's claim secret, whose holder can
 *     claim the plan and read its notes;
 *   - `stripe-signature` (routes/stripe-webhook.ts) and `svix-signature`
 *     (routes/webhooks.ts): a webhook's signature, which with the body would
 *     replay the call; `webhook-signature` is the Standard Webhooks name for
 *     the same, read by no route today;
 *   - `mcp-session-id` (routes/public-mcp.ts, which also sends one back): its
 *     holder spends that session's budget;
 *   - `set-cookie`: a response header, listed so that its attribute is
 *     dropped should the API ever set a cookie.
 * A header that comes to carry a credential is added here, and every scrubber
 * drops it: from an event's and a transaction's request headers, and the
 * attributes the SDK writes for it on the request's span. A route reads its
 * headers from the live request, never from an event, so none of this
 * changes what a route sees.
 */
export const CREDENTIAL_REQUEST_HEADERS: readonly string[] = [
  "authorization", "cookie", PLAN_CLAIM_SECRET_HEADER,
  "stripe-signature", "svix-signature", "webhook-signature",
  "mcp-session-id", "set-cookie",
];

/** Request headers that carry a credential or the caller's address. */
const DROPPED_REQUEST_HEADERS: readonly string[] = [
  ...CREDENTIAL_REQUEST_HEADERS,
  "x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip", "true-client-ip",
];

/** The span attributes the SDK can write for a header (@sentry/core 10.60
 *  utils/request.js httpHeadersToSpanAttributes): `http.request.header.`, or
 *  `http.response.header.` for a response header, then the name in lower
 *  case with dashes as underscores. */
function headerAttributes(header: string): readonly string[] {
  const name = header.toLowerCase().replaceAll("-", "_");
  return [`http.request.header.${name}`, `http.response.header.${name}`];
}

/** The attributes of every dropped header. */
const DROPPED_HEADER_ATTRIBUTES: readonly string[] = DROPPED_REQUEST_HEADERS.flatMap(headerAttributes);

/**
 * Whether a span attribute belongs to a dropped header: the header's own
 * attribute, or one under it. The SDK writes a Cookie or Set-Cookie header
 * as one attribute per cookie, `http.request.header.cookie.<cookie name>`,
 * and masks a value only when the name is on its word list (`__session` is;
 * most names are not). It masks the sign-in token, the claim secret, the MCP
 * session id and the address headers only because their names contain
 * "auth", "secret", "session", "forwarded" or "-ip", and the webhook
 * signatures not at all. All are dropped here, in any casing, so none of it
 * rests on the SDK's word list.
 */
function isDroppedHeaderAttribute(key: string): boolean {
  const lower = key.toLowerCase();
  return DROPPED_HEADER_ATTRIBUTES.some((attribute) => lower === attribute || lower.startsWith(`${attribute}.`));
}

/** Span / trace attribute keys that hold a bare query string or fragment, or
 *  the caller's address: node-core records the first X-Forwarded-For entry
 *  (behind Railway, the visitor's IP) as `http.client_ip` whatever
 *  `sendDefaultPii` says. */
const DROPPED_ATTRIBUTE_KEYS: readonly string[] = [
  "url.query", "http.query", "url.fragment", "http.fragment",
  "http.client_ip", "client.address", "net.peer.ip", "network.peer.address", "net.sock.peer.addr",
];

/** The parts of an event's or a transaction's `request` that can hold a credential. */
export interface RequestCredentialFields {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}

/**
 * Removes the given headers from a `request`, however each is cased, and
 * always its `cookies`: the SDK's RequestData integration parses the Cookie
 * header into names and values there, on error events and transactions alike
 * (@sentry/core 10.60 integrations/requestdata.js), so dropping the header
 * alone would leave the sign-in provider's `__session` cookie in the event.
 */
function dropRequestCredentials(request: RequestCredentialFields, droppedHeaders: readonly string[]): void {
  delete request.cookies;
  const headers = request.headers;
  if (headers === undefined) return;
  for (const key of Object.keys(headers)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- header bags are open-ended records
    if (droppedHeaders.includes(key.toLowerCase())) delete headers[key];
  }
}

/** Removes every credential from a request: the credential headers, however
 *  each is cased, and the cookies the SDK parsed from the Cookie header. */
export function dropCredentials(request: RequestCredentialFields): void {
  dropRequestCredentials(request, CREDENTIAL_REQUEST_HEADERS);
}

function scrubAttributes(data: Record<string, unknown> | undefined): void {
  if (data === undefined) return;
  for (const key of Object.keys(data)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- attribute bags are open-ended records
    if (DROPPED_ATTRIBUTE_KEYS.includes(key) || isDroppedHeaderAttribute(key)) delete data[key];
  }
  for (const key of URL_ATTRIBUTE_KEYS) {
    const value = data[key];
    if (typeof value === "string") data[key] = withoutQuery(value);
  }
}

/**
 * `beforeSend`: strips request bodies, the query string, the cookies, the
 * credential and address headers, and the query from `request.url`; redacts
 * query parameters from every exception value (the error and its linked
 * causes).
 */
export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) {
      exception.value = scrubErrorMessage(exception.value);
    }
  }
  if (event.request !== undefined) {
    event.request.data = undefined;
    event.request.query_string = undefined;
    if (event.request.url !== undefined) {
      event.request.url = withoutQuery(event.request.url);
    }
    dropRequestCredentials(event.request, DROPPED_REQUEST_HEADERS);
  }
  return templateCapabilityPathsDeep(event);
}

/** Breadcrumb categories the SDK uses for outgoing http calls. */
const HTTP_BREADCRUMB_CATEGORIES: readonly string[] = ["http", "fetch", "xhr"];

/**
 * `beforeBreadcrumb`: strips the query from an http breadcrumb's
 * `data.url` and from its `message` (the SDK writes "GET <url>"), and
 * removes `data["http.query"]` and `data["http.fragment"]`, where
 * @sentry/node-core (10.60) puts an outgoing request's query and fragment
 * once it has cut them from the url.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data: Record<string, unknown> | undefined = breadcrumb.data;
  if (data !== undefined) {
    const url = data["url"];
    if (typeof url === "string") data["url"] = withoutQuery(url);
    delete data["http.query"];
    delete data["http.fragment"];
  }
  const isHttp =
    breadcrumb.type === "http" ||
    (breadcrumb.category !== undefined && HTTP_BREADCRUMB_CATEGORIES.includes(breadcrumb.category));
  if (isHttp && breadcrumb.message !== undefined) {
    breadcrumb.message = withoutQuery(breadcrumb.message);
  }
  return templateCapabilityPathsDeep(breadcrumb);
}

/**
 * Whether a span attribute describes the visitor's browser: any request
 * header's attribute (`http.request.header.<name>`, the user agent's and the
 * language's among them), and the user agent as the OpenTelemetry HTTP
 * instrumentation records it (`user_agent.original`, and `http.user_agent` in
 * its older conventions).
 */
function isBrowserDetailAttribute(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith("http.request.header.") || lower.startsWith("user_agent.") || lower === "http.user_agent";
}

function dropBrowserDetails(data: Record<string, unknown> | undefined): void {
  if (data === undefined) return;
  for (const key of Object.keys(data)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- attribute bags are open-ended records
    if (isBrowserDetailAttribute(key)) delete data[key];
  }
}

/** A URL or path, split into its origin (scheme and host, if any), its path,
 *  and the rest (a query or fragment, or the marker left for one). */
const URL_PARTS = /^([a-z][a-z\d+.-]*:\/\/[^/?#]*)?([^?#]*)([\s\S]*)$/iu;

/**
 * A path segment that names one record rather than a kind of thing: a UUID;
 * a token of six or more characters with a digit in it (a share code, a
 * provider's id such as Stripe's `cs_live_…`, a date); or one of twenty or
 * more letters, digits, dashes and underscores in both cases (an id such as
 * Clerk's `user_…`, digit or not). A route's own words ("venues",
 * "changes-since-last-handoff", "v1") and placeholders (":id") stay.
 */
const RECORD_SEGMENT = /^(?:[\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}|(?=[^/]*\d)[\w.~%-]{6,}|(?=[^/]*[A-Z])(?=[^/]*[a-z])[\w-]{20,})$/u;

/** Replaces each path segment that names one record with `:id`, keeping the
 *  origin, the route's words, and anything after the path. */
export function withoutIdentifiers(url: string): string {
  const parts = URL_PARTS.exec(url);
  if (parts === null) return url;
  const [, origin = "", path = "", rest = ""] = parts;
  return `${origin}${path.split("/").map((segment) => (RECORD_SEGMENT.test(segment) ? ":id" : segment)).join("/")}${rest}`;
}

/** The path of a URL or path, without its origin, query or fragment. */
function pathOf(url: string): string | undefined {
  return URL_PARTS.exec(withoutQuery(url))?.[2];
}

/** The URL or path with its path replaced by the route's pattern. */
function onRoute(url: string, route: string): string {
  const parts = URL_PARTS.exec(url);
  if (parts === null) return url;
  const [, origin = "", , rest = ""] = parts;
  return `${origin}${route}${rest}`;
}

/** A URL ("…://…") or a path (at the start or after a space, from "/") in text. */
const URL_TOKEN = /[a-z][a-z\d+.-]*:\/\/\S+|(?<=^|\s)\/\S*/giu;

/**
 * A copy of plain data with every URL and path in every string, at any depth
 * and under any key, put through `template`. Class instances (the SDK's
 * scopes in its processing metadata) are left as they are; cycles are safe;
 * the input is not changed (as templateCapabilityPathsDeep).
 */
function templateUrlsDeep<T>(value: T, template: (url: string) => string): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") return item.replace(URL_TOKEN, (url) => template(url));
    if (typeof item !== "object" || item === null) return item;
    const known = seen.get(item);
    if (known !== undefined) return known;
    if (Array.isArray(item)) {
      const copy: unknown[] = [];
      seen.set(item, copy);
      for (const child of item) copy.push(visit(child));
      return copy;
    }
    const proto: unknown = Object.getPrototypeOf(item);
    if (proto !== Object.prototype && proto !== null) return item;
    const copy: Record<string, unknown> = {};
    seen.set(item, copy);
    for (const [key, child] of Object.entries(item)) copy[key] = visit(child);
    return copy;
  };
  return visit(value) as T;
}

/**
 * `beforeSendTransaction`: removes `request.query_string`, the body, the
 * cookies, every request header and the breadcrumbs, drops the address,
 * credential and browser attributes from the trace context and every span,
 * and then puts every URL and path left anywhere in the record, whatever its
 * key, through one rule: the request's own path (a string whose path is the
 * request's, as `url`, `url.path` on Fastify's own span and the rest carry it)
 * on its route's pattern (`http.route`, as Fastify matched it), and every
 * other with its query and fragment cut and each segment that looks like a
 * record's id replaced. A record no route matched (a 404, a 503 while the
 * server drains, a malformed URL) has no pattern, so its own path goes
 * through those segment rules alone.
 * A transaction is the timing record the API sends for a sample of requests
 * whether or not anything failed, and the privacy page says it carries no
 * address, identifier or browser details (Blake, 13 November 2026: "Strip
 * browser details, say so"); its breadcrumbs, which hold the URLs of
 * outgoing calls, it does not need.
 */
export function scrubTransaction(event: ScrubbableTransaction): ScrubbableTransaction {
  const traceData = event.contexts?.trace?.data;
  const routeAttribute = traceData?.["http.route"];
  const route = typeof routeAttribute === "string" && routeAttribute.startsWith("/") ? routeAttribute : undefined;
  const requestUrl = [event.request?.url, traceData?.["url.full"], traceData?.["http.target"], traceData?.["url.path"]]
    .find((value): value is string => typeof value === "string");
  const requestPath = requestUrl === undefined ? undefined : pathOf(requestUrl);
  if (event.request !== undefined) {
    delete event.request.query_string;
    // The SDK keeps an incoming request's body on its transaction (the
    // http integration's maxIncomingRequestBodySize, "medium" by default):
    // an enquiry's name, email, phone and allergy note.
    event.request.data = undefined;
    dropRequestCredentials(event.request, DROPPED_REQUEST_HEADERS);
    delete event.request.headers;
  }
  delete event.breadcrumbs;
  for (const data of [traceData, ...(event.spans ?? []).map((span) => span.data)]) {
    scrubAttributes(data);
    dropBrowserDetails(data);
  }
  const template = (url: string): string => {
    // The query (its marker left) and any fragment go.
    const cut = withoutQuery(url).replace(/#[\s\S]*$/u, "");
    if (route !== undefined && requestPath !== undefined && pathOf(cut) === requestPath) return onRoute(cut, route);
    return withoutIdentifiers(cut);
  };
  return templateCapabilityPathsDeep(templateUrlsDeep(event, template));
}

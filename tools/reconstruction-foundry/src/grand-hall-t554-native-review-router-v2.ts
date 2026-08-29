import type { IncomingMessage, ServerResponse } from "node:http";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2,
  GrandHallT554NativeReviewHttpRequestSchemasV2,
} from "./grand-hall-t554-native-review-http-contract-v2.js";
import {
  bindGrandHallT554NativeReviewTileToHttpResponseV2,
  GrandHallT554NativeReviewHttpResponseAdapterErrorV2,
  type GrandHallT554NativeReviewHttpResponseDeliveryOutcomeV2,
  type GrandHallT554NativeReviewHttpResponseDeliveryLifecycleV2,
} from "./grand-hall-t554-native-review-http-response-adapter-v2.js";
import type {
  GrandHallT554NativeReviewOperatorMaskTileV2,
  GrandHallT554NativeReviewOperatorSessionV2,
  GrandHallT554NativeReviewOperatorSourceTileV2,
} from "./grand-hall-t554-native-review-operator-session-v2.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";
import type {
  LocalSessionRequestGate,
  LocalSessionTokenBroker,
} from "./local-session-http.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_ROUTER_V2 =
  "venviewer.grand-hall-t554-native-review-router.v2";
const FATAL_EVENT_SCHEMA =
  "venviewer.grand-hall-t554-native-review-router-fatal.v2";
const MAXIMUM_RAW_HEADER_PAIRS = 64;
const MAXIMUM_RAW_HEADER_BYTES = 16_384;
const MAXIMUM_JSON_BODY_BYTES = 256 * 1_024;
const LOOPBACK_HOST = "127.0.0.1";
const TILE_WIDTH_PX = 256;
const TILE_HEIGHT_PX = 256;
const TILE_PIXEL_COUNT = TILE_WIDTH_PX * TILE_HEIGHT_PX;
const SOURCE_TILE_BYTE_LENGTH = TILE_PIXEL_COUNT * 3;
const MASK_TILE_PLANE_BYTE_LENGTH = TILE_PIXEL_COUNT;
const REQUEST_BODY_TIMEOUT_MS = 15_000;
const RESPONSE_TERMINAL_TIMEOUT_MS = 15_000;

export const GRAND_HALL_T554_NATIVE_REVIEW_SECURITY_HEADERS_V2 = Object.freeze({
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate, private",
  "Content-Security-Policy": [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self'",
    "manifest-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "worker-src 'none'",
  ].join("; "),
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  Expires: "0",
  "Permissions-Policy": [
    "accelerometer=()",
    "ambient-light-sensor=()",
    "autoplay=()",
    "browsing-topics=()",
    "camera=()",
    "clipboard-read=()",
    "clipboard-write=()",
    "display-capture=()",
    "encrypted-media=()",
    "fullscreen=()",
    "geolocation=()",
    "gyroscope=()",
    "hid=()",
    "idle-detection=()",
    "local-fonts=()",
    "magnetometer=()",
    "microphone=()",
    "midi=()",
    "otp-credentials=()",
    "payment=()",
    "picture-in-picture=()",
    "publickey-credentials-get=()",
    "screen-wake-lock=()",
    "serial=()",
    "storage-access=()",
    "usb=()",
    "web-share=()",
    "window-management=()",
  ].join(", "),
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const);

export type GrandHallT554NativeReviewRouterHttpErrorCodeV2 =
  | "MALFORMED_REQUEST"
  | "AUTHENTICATION_REQUIRED"
  | "ORIGIN_FORBIDDEN"
  | "ROUTE_NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "STATE_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "CONTENT_TYPE_REQUIRED"
  | "OPERATION_REJECTED"
  | "MISDIRECTED_REQUEST"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

const HTTP_ERROR_STATUS: Readonly<
  Record<GrandHallT554NativeReviewRouterHttpErrorCodeV2, number>
> = Object.freeze({
  MALFORMED_REQUEST: 400,
  AUTHENTICATION_REQUIRED: 401,
  ORIGIN_FORBIDDEN: 403,
  ROUTE_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  STATE_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  CONTENT_TYPE_REQUIRED: 415,
  OPERATION_REJECTED: 422,
  MISDIRECTED_REQUEST: 421,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
});

class RouterHttpErrorV2 extends Error {
  constructor(readonly code: GrandHallT554NativeReviewRouterHttpErrorCodeV2) {
    super(code);
    this.name = "RouterHttpErrorV2";
  }
}

export interface GrandHallT554NativeReviewRouterFatalEventV2 {
  readonly schemaVersion: typeof FATAL_EVENT_SCHEMA;
  readonly code: "TILE_DELIVERY_COMMIT_FAILED" | "TILE_DELIVERY_DISCARD_FAILED";
}

export interface GrandHallT554NativeReviewStaticAssetsV2 {
  readonly documentHtml: Buffer;
  readonly stylesheetCss: Buffer;
  readonly applicationJavascript: Buffer;
}

export interface GrandHallT554NativeReviewRouterOptionsV2 {
  readonly operatorSession: GrandHallT554NativeReviewOperatorSessionV2;
  readonly tokenBroker: LocalSessionTokenBroker;
  readonly requestGate: LocalSessionRequestGate;
  readonly staticAssets: GrandHallT554NativeReviewStaticAssetsV2;
  readonly onFatal: (
    event: GrandHallT554NativeReviewRouterFatalEventV2,
  ) => Promise<void> | void;
}

export interface GrandHallT554NativeReviewRouterV2 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_ROUTER_V2;
  takeBootstrapFragmentForLaunch(): string | null;
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

interface RawHeaderView {
  readonly values: (name: string) => readonly string[];
}

interface ResponseTerminalObservation {
  readonly completion: Promise<void>;
  readonly detach: () => void;
}

interface RuntimeSchema<T> {
  safeParse(
    value: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

type Tile =
  | GrandHallT554NativeReviewOperatorSourceTileV2
  | GrandHallT554NativeReviewOperatorMaskTileV2;

function fail(code: GrandHallT554NativeReviewRouterHttpErrorCodeV2): never {
  throw new RouterHttpErrorV2(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry: unknown) => typeof entry === "string")
  );
}

function hasForbiddenHeaderValueCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      (codePoint < 0x20 && codePoint !== 0x09) ||
      codePoint === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

function hasExactRuntimeString(value: unknown, expected: string): boolean {
  return typeof value === "string" && value === expected;
}

function hasFunctions(
  value: unknown,
  names: readonly string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) && names.every((name) => typeof value[name] === "function")
  );
}

function assertFactoryOptions(
  options: GrandHallT554NativeReviewRouterOptionsV2,
): void {
  const untrusted: unknown = options;
  if (!isRecord(untrusted)) {
    throw new TypeError("Router options are required.");
  }
  if (
    !hasFunctions(untrusted.operatorSession, [
      "snapshot",
      "selectSource",
      "prepareSourceTile",
      "recordSourceCoverage",
      "recordExcludeDecision",
      "beginMaskWorkflow",
      "applyMaskEdit",
      "freezeMask",
      "prepareMaskTile",
      "recordMaskCoverage",
      "recordIncludeDecision",
      "recordHumanAttestation",
      "leaveSourcePending",
      "abandonActiveSource",
      "stop",
      "close",
    ])
  ) {
    throw new TypeError("An already-open operator session is required.");
  }
  if (
    !hasFunctions(untrusted.tokenBroker, [
      "exchangeBootstrapToken",
      "authorizeRequest",
      "destroy",
    ]) ||
    !("bootstrapFragment" in untrusted.tokenBroker)
  ) {
    throw new TypeError("A local-session token broker is required.");
  }
  if (!hasFunctions(untrusted.requestGate, ["enter"])) {
    throw new TypeError("A local-session request gate is required.");
  }
  if (
    !isRecord(untrusted.staticAssets) ||
    !Object.isFrozen(untrusted.staticAssets) ||
    !Buffer.isBuffer(untrusted.staticAssets.documentHtml) ||
    !Buffer.isBuffer(untrusted.staticAssets.stylesheetCss) ||
    !Buffer.isBuffer(untrusted.staticAssets.applicationJavascript) ||
    untrusted.staticAssets.documentHtml.byteLength === 0 ||
    untrusted.staticAssets.stylesheetCss.byteLength === 0 ||
    untrusted.staticAssets.applicationJavascript.byteLength === 0
  ) {
    throw new TypeError(
      "One frozen, nonempty static-asset byte set is required.",
    );
  }
  if (typeof untrusted.onFatal !== "function") {
    throw new TypeError("A fatal router hook is required.");
  }
}

function assertRawRequestTarget(target: string | undefined): string {
  if (
    target === undefined ||
    target.length === 0 ||
    target.length > 256 ||
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.includes("//") ||
    target.includes("%") ||
    target.includes("\\") ||
    target.includes("?") ||
    target.includes("#")
  ) {
    return fail("MALFORMED_REQUEST");
  }
  for (const character of target) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x21 || codePoint > 0x7e) {
      return fail("MALFORMED_REQUEST");
    }
  }
  if (
    target.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return fail("MALFORMED_REQUEST");
  }
  return target;
}

function rawHeaderView(request: IncomingMessage): RawHeaderView {
  const rawHeaders: unknown = request.rawHeaders;
  if (
    !isStringArray(rawHeaders) ||
    rawHeaders.length % 2 !== 0 ||
    rawHeaders.length / 2 > MAXIMUM_RAW_HEADER_PAIRS
  ) {
    return fail("MALFORMED_REQUEST");
  }
  const headers = new Map<string, string[]>();
  let byteCount = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (
      name === undefined ||
      value === undefined ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name) ||
      hasForbiddenHeaderValueCharacter(value)
    ) {
      return fail("MALFORMED_REQUEST");
    }
    byteCount +=
      Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8") + 4;
    if (byteCount > MAXIMUM_RAW_HEADER_BYTES) {
      return fail("MALFORMED_REQUEST");
    }
    const normalizedName = name.toLowerCase();
    const values = headers.get(normalizedName) ?? [];
    values.push(value);
    headers.set(normalizedName, values);
  }
  return {
    values: (name) => headers.get(name.toLowerCase()) ?? [],
  };
}

function exactlyOneHeader(
  headers: RawHeaderView,
  name: string,
  expected: string,
  code: GrandHallT554NativeReviewRouterHttpErrorCodeV2,
): void {
  const values = headers.values(name);
  if (values.length !== 1 || values[0] !== expected) return fail(code);
}

function assertNoForbiddenTransportHeaders(headers: RawHeaderView): void {
  if (
    headers.values("cookie").length !== 0 ||
    headers.values("expect").length !== 0 ||
    headers.values("upgrade").length !== 0 ||
    headers.values("sec-websocket-key").length !== 0 ||
    headers.values("sec-websocket-version").length !== 0 ||
    headers.values("access-control-request-method").length !== 0 ||
    headers.values("access-control-request-headers").length !== 0 ||
    headers.values("transfer-encoding").length !== 0 ||
    headers.values("te").length !== 0 ||
    headers.values("content-encoding").length !== 0 ||
    headers.values("trailer").length !== 0 ||
    headers.values("connection").some((value) =>
      value
        .split(",")
        .map((token) => token.trim().toLowerCase())
        .includes("upgrade"),
    )
  ) {
    return fail("MALFORMED_REQUEST");
  }
}

function assertLoopbackAndHost(
  request: IncomingMessage,
  headers: RawHeaderView,
): void {
  const localPort = request.socket.localPort;
  if (
    request.socket.localAddress !== LOOPBACK_HOST ||
    request.socket.remoteAddress !== LOOPBACK_HOST ||
    !Number.isInteger(localPort) ||
    localPort === undefined ||
    localPort < 1 ||
    localPort > 65_535
  ) {
    return fail("ORIGIN_FORBIDDEN");
  }
  exactlyOneHeader(
    headers,
    "host",
    `${LOOPBACK_HOST}:${String(localPort)}`,
    "MISDIRECTED_REQUEST",
  );
}

function assertApiProvenance(
  request: IncomingMessage,
  headers: RawHeaderView,
): void {
  const localPort = request.socket.localPort;
  if (localPort === undefined) return fail("ORIGIN_FORBIDDEN");
  exactlyOneHeader(
    headers,
    "origin",
    `http://${LOOPBACK_HOST}:${String(localPort)}`,
    "ORIGIN_FORBIDDEN",
  );
  exactlyOneHeader(
    headers,
    "sec-fetch-site",
    "same-origin",
    "ORIGIN_FORBIDDEN",
  );
  exactlyOneHeader(headers, "sec-fetch-mode", "cors", "ORIGIN_FORBIDDEN");
  exactlyOneHeader(headers, "sec-fetch-dest", "empty", "ORIGIN_FORBIDDEN");
}

function assertStaticRequestHeaders(headers: RawHeaderView): void {
  if (
    headers.values("authorization").length !== 0 ||
    headers.values("content-type").length !== 0 ||
    headers.values("content-length").length !== 0
  ) {
    return fail("MALFORMED_REQUEST");
  }
}

function declaredJsonBodyLength(headers: RawHeaderView): number {
  exactlyOneHeader(
    headers,
    "content-type",
    "application/json",
    "CONTENT_TYPE_REQUIRED",
  );
  const values = headers.values("content-length");
  if (values.length !== 1 || !/^(?:0|[1-9]\d*)$/u.test(values[0] ?? "")) {
    return fail("MALFORMED_REQUEST");
  }
  const length = Number(values[0]);
  if (length > MAXIMUM_JSON_BODY_BYTES) return fail("PAYLOAD_TOO_LARGE");
  if (!Number.isSafeInteger(length) || length < 2)
    return fail("MALFORMED_REQUEST");
  return length;
}

async function readStrictJsonObject(
  request: IncomingMessage,
  declaredLength: number,
): Promise<Record<string, unknown>> {
  const body = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      rejectOnce(new RouterHttpErrorV2("MALFORMED_REQUEST"));
      try {
        request.destroy();
      } catch {
        // The bounded request has already been rejected.
      }
    }, REQUEST_BODY_TIMEOUT_MS);
    timeout.unref();
    const detach = (): void => {
      clearTimeout(timeout);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("aborted", onAborted);
      request.removeListener("error", onError);
    };
    const rejectOnce = (error: RouterHttpErrorV2): void => {
      if (settled) return;
      settled = true;
      detach();
      request.resume();
      reject(error);
    };
    const onData = (chunk: Buffer | string): void => {
      if (settled) return;
      const bytes =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      byteLength += bytes.byteLength;
      if (byteLength > declaredLength || byteLength > MAXIMUM_JSON_BODY_BYTES) {
        rejectOnce(
          new RouterHttpErrorV2(
            byteLength > MAXIMUM_JSON_BODY_BYTES
              ? "PAYLOAD_TOO_LARGE"
              : "MALFORMED_REQUEST",
          ),
        );
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      detach();
      if (byteLength !== declaredLength) {
        reject(new RouterHttpErrorV2("MALFORMED_REQUEST"));
        return;
      }
      resolve(Buffer.concat(chunks, byteLength));
    };
    const onAborted = (): void => {
      rejectOnce(new RouterHttpErrorV2("MALFORMED_REQUEST"));
    };
    const onError = (): void => {
      rejectOnce(new RouterHttpErrorV2("MALFORMED_REQUEST"));
    };
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
  });
  let parsed: unknown;
  try {
    parsed = parseGrandHallT554StrictJson(body);
  } catch {
    return fail("MALFORMED_REQUEST");
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    return fail("MALFORMED_REQUEST");
  }
  return parsed;
}

async function parseRequestBody<T>(
  request: IncomingMessage,
  headers: RawHeaderView,
  schema: RuntimeSchema<T>,
): Promise<T> {
  const parsed = await readStrictJsonObject(
    request,
    declaredJsonBodyLength(headers),
  );
  const result = schema.safeParse(parsed);
  if (!result.success) return fail("MALFORMED_REQUEST");
  return result.data;
}

function responseCanStart(response: ServerResponse): boolean {
  return (
    !response.destroyed &&
    !response.headersSent &&
    !response.writableEnded &&
    !response.writableFinished
  );
}

function destroyResponseIfOpen(response: ServerResponse): void {
  if (response.destroyed) return;
  try {
    response.destroy();
  } catch {
    // The caller still owns the durable delivery/error outcome.
  }
}

function observeResponseTerminal(
  response: ServerResponse,
): ResponseTerminalObservation {
  let settled = false;
  let resolveCompletion: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const timeout = setTimeout(() => {
    try {
      response.destroy();
    } finally {
      onTerminal();
    }
  }, RESPONSE_TERMINAL_TIMEOUT_MS);
  timeout.unref();
  const detach = (): void => {
    clearTimeout(timeout);
    response.removeListener("finish", onTerminal);
    response.removeListener("close", onTerminal);
    response.removeListener("error", onTerminal);
  };
  function onTerminal(): void {
    if (settled) return;
    settled = true;
    detach();
    resolveCompletion?.();
  }
  response.once("finish", onTerminal);
  response.once("close", onTerminal);
  response.once("error", onTerminal);
  if (
    response.destroyed ||
    response.writableEnded ||
    response.writableFinished
  ) {
    onTerminal();
  }
  return { completion, detach };
}

function setSecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(
    GRAND_HALL_T554_NATIVE_REVIEW_SECURITY_HEADERS_V2,
  )) {
    response.setHeader(name, value);
  }
}

async function sendBytes(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  bytes: Buffer,
): Promise<void> {
  if (!responseCanStart(response)) return fail("INTERNAL_ERROR");
  const terminal = observeResponseTerminal(response);
  try {
    setSecurityHeaders(response);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", contentType);
    response.setHeader("Content-Length", bytes.byteLength);
    response.end(bytes);
  } catch {
    terminal.detach();
    try {
      response.destroy();
    } catch {
      // The fixed error path below remains the only caller-visible result.
    }
    return fail("INTERNAL_ERROR");
  }
  await terminal.completion;
}

async function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  } catch {
    return fail("INTERNAL_ERROR");
  }
  await sendBytes(
    response,
    statusCode,
    "application/json; charset=utf-8",
    bytes,
  );
}

function fixedHttpError(error: unknown): RouterHttpErrorV2 {
  if (error instanceof RouterHttpErrorV2) return error;
  if (isRecord(error) && typeof error.code === "string") {
    switch (error.code) {
      case "ARGUMENT_INVALID":
        return new RouterHttpErrorV2("MALFORMED_REQUEST");
      case "BROWSER_EPOCH_CONFLICT":
      case "WORKSPACE_REVISION_CONFLICT":
      case "RENDER_GENERATION_CONFLICT":
      case "MASK_REVISION_CONFLICT":
        return new RouterHttpErrorV2("STATE_CONFLICT");
      case "PHASE_INVALID":
      case "NO_ACTIVE_SOURCE":
      case "SOURCE_STALE":
      case "BINDING_STALE":
      case "SOURCE_COVERAGE_INCOMPLETE":
      case "MASK_COVERAGE_INCOMPLETE":
      case "MASK_REVISION_TAINTED":
      case "PENDING_TILE_DELIVERY":
      case "DELIVERY_ALREADY_RESOLVED":
        return new RouterHttpErrorV2("OPERATION_REJECTED");
      case "SESSION_CLOSED":
      case "SESSION_STOPPED":
      case "RECOVERY_REQUIRED":
        return new RouterHttpErrorV2("SERVICE_UNAVAILABLE");
    }
  }
  if (isRecord(error) && typeof error.statusCode === "number") {
    switch (error.statusCode) {
      case 401:
        return new RouterHttpErrorV2("AUTHENTICATION_REQUIRED");
      case 403:
        return new RouterHttpErrorV2("ORIGIN_FORBIDDEN");
      case 413:
        return new RouterHttpErrorV2("PAYLOAD_TOO_LARGE");
      case 415:
        return new RouterHttpErrorV2("CONTENT_TYPE_REQUIRED");
      case 421:
        return new RouterHttpErrorV2("MISDIRECTED_REQUEST");
      case 429:
        return new RouterHttpErrorV2("RATE_LIMITED");
      case 503:
        return new RouterHttpErrorV2("SERVICE_UNAVAILABLE");
    }
  }
  return new RouterHttpErrorV2("INTERNAL_ERROR");
}

function isStaticPath(path: string): boolean {
  return (
    path === GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.document ||
    path === GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.stylesheet ||
    path === GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.script
  );
}

function isApiPath(path: string): boolean {
  return Object.entries(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2).some(
    ([name, route]) =>
      name !== "document" &&
      name !== "stylesheet" &&
      name !== "script" &&
      route === path,
  );
}

class InjectedRouterV2 implements GrandHallT554NativeReviewRouterV2 {
  readonly schemaVersion = GRAND_HALL_T554_NATIVE_REVIEW_ROUTER_V2;
  readonly #operator: GrandHallT554NativeReviewOperatorSessionV2;
  readonly #broker: LocalSessionTokenBroker;
  readonly #gate: LocalSessionRequestGate;
  readonly #assets: GrandHallT554NativeReviewStaticAssetsV2;
  readonly #fatalHook: GrandHallT554NativeReviewRouterOptionsV2["onFatal"];
  readonly #activeResponses = new Set<ServerResponse>();
  readonly #activeRequests = new Set<IncomingMessage>();
  readonly #activeHandles = new Set<Promise<void>>();
  readonly #activeTileLifecycles = new Set<
    Promise<GrandHallT554NativeReviewHttpResponseDeliveryOutcomeV2>
  >();
  readonly #cleanupErrors: unknown[] = [];
  #bootstrapFragmentTaken = false;
  #closed = false;
  #brokerDestroyed = false;
  #operatorClosePromise: Promise<void> | null = null;
  #fatalPromise: Promise<void> | null = null;
  #fatalDrainPromise: Promise<void> | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(options: GrandHallT554NativeReviewRouterOptionsV2) {
    this.#operator = options.operatorSession;
    this.#broker = options.tokenBroker;
    this.#gate = options.requestGate;
    this.#assets = Object.freeze({
      documentHtml: Buffer.from(options.staticAssets.documentHtml),
      stylesheetCss: Buffer.from(options.staticAssets.stylesheetCss),
      applicationJavascript: Buffer.from(
        options.staticAssets.applicationJavascript,
      ),
    });
    this.#fatalHook = options.onFatal;
  }

  takeBootstrapFragmentForLaunch(): string | null {
    if (this.#closed || this.#bootstrapFragmentTaken) return null;
    this.#bootstrapFragmentTaken = true;
    return this.#broker.bootstrapFragment;
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (this.#closed) {
      await this.#sendFixedErrorIfPossible(
        response,
        new RouterHttpErrorV2("SERVICE_UNAVAILABLE"),
      );
      return;
    }
    let release: (() => void) | undefined;
    try {
      release = this.#gate.enter();
    } catch (error) {
      await this.#sendFixedErrorIfPossible(response, fixedHttpError(error));
      return;
    }
    const task = this.#handleEntered(request, response, release);
    this.#activeHandles.add(task);
    void task.then(
      () => this.#activeHandles.delete(task),
      () => this.#activeHandles.delete(task),
    );
    await task;
  }

  close(): Promise<void> {
    if (this.#closePromise !== null) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = this.#performClose();
    void this.#closePromise.catch(() => undefined);
    return this.#closePromise;
  }

  async #handleEntered(
    request: IncomingMessage,
    response: ServerResponse,
    release: () => void,
  ): Promise<void> {
    this.#activeRequests.add(request);
    this.#activeResponses.add(response);
    try {
      await this.#dispatch(request, response);
    } catch (error) {
      await this.#sendFixedErrorIfPossible(response, fixedHttpError(error));
    } finally {
      this.#activeRequests.delete(request);
      this.#activeResponses.delete(response);
      release();
    }
  }

  async #dispatch(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (this.#closed) return fail("SERVICE_UNAVAILABLE");
    const path = assertRawRequestTarget(request.url);
    const headers = rawHeaderView(request);
    assertNoForbiddenTransportHeaders(headers);
    assertLoopbackAndHost(request, headers);
    const method = request.method ?? "";
    if (["OPTIONS", "TRACE", "CONNECT"].includes(method)) {
      return fail("METHOD_NOT_ALLOWED");
    }
    if (isStaticPath(path)) {
      if (method !== "GET") return fail("METHOD_NOT_ALLOWED");
      assertStaticRequestHeaders(headers);
      await this.#serveStatic(path, response);
      return;
    }
    if (!isApiPath(path)) return fail("ROUTE_NOT_FOUND");
    if (method !== "POST") return fail("METHOD_NOT_ALLOWED");
    assertApiProvenance(request, headers);
    const bootstrap =
      path === GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.bootstrap;
    const authorization = headers.values("authorization");
    if (bootstrap) {
      if (authorization.length !== 0) return fail("MALFORMED_REQUEST");
    } else {
      if (authorization.length !== 1) {
        return fail("AUTHENTICATION_REQUIRED");
      }
      this.#broker.authorizeRequest(request);
    }
    await this.#dispatchApi(path, request, response, headers);
  }

  async #serveStatic(path: string, response: ServerResponse): Promise<void> {
    switch (path) {
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.document:
        await sendBytes(
          response,
          200,
          "text/html; charset=utf-8",
          this.#assets.documentHtml,
        );
        return;
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.stylesheet:
        await sendBytes(
          response,
          200,
          "text/css; charset=utf-8",
          this.#assets.stylesheetCss,
        );
        return;
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.script:
        await sendBytes(
          response,
          200,
          "text/javascript; charset=utf-8",
          this.#assets.applicationJavascript,
        );
    }
  }

  async #dispatchApi(
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
    headers: RawHeaderView,
  ): Promise<void> {
    switch (path) {
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.bootstrap: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.bootstrap,
        );
        const bearerToken = this.#broker.exchangeBootstrapToken(
          body.bootstrapToken,
        );
        await sendJson(response, 200, {
          schemaVersion:
            GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.bootstrap,
          bearerToken,
        });
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state: {
        await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.state,
        );
        await sendJson(response, 200, await this.#operator.snapshot());
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceSelect: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.sourceSelect,
        );
        await sendJson(
          response,
          200,
          await this.#operator.selectSource({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            expectedWorkspaceRevision: body.expectedWorkspaceRevision,
            inventoryIndex: body.inventoryIndex,
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.sourceTile,
        );
        const tile = await this.#operator.prepareSourceTile({
          expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
          renderGeneration: body.renderGeneration,
          column: body.column,
          row: body.row,
        });
        await this.#sendTile(request, response, tile);
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceCoverage: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.sourceCoverage,
        );
        await sendJson(
          response,
          200,
          await this.#operator.recordSourceCoverage({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            renderGeneration: body.renderGeneration,
            documentVisibilityState: body.documentVisibilityState,
            documentFocusState: body.documentFocusState,
            viewportCssWidth: body.viewportCssWidth,
            viewportCssHeight: body.viewportCssHeight,
            devicePixelRatio: body.devicePixelRatio,
            sourceToCssTransform: body.sourceToCssTransform,
            paintedTiles: body.paintedTiles,
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceExclude: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.sourceExclude,
        );
        await sendJson(
          response,
          200,
          await this.#operator.recordExcludeDecision({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            expectedWorkspaceRevision: body.expectedWorkspaceRevision,
            renderGeneration: body.renderGeneration,
            note: body.note,
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceLeavePending: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.sourceLeavePending,
        );
        await sendJson(
          response,
          200,
          await this.#operator.leaveSourcePending({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            expectedWorkspaceRevision: body.expectedWorkspaceRevision,
            renderGeneration: body.renderGeneration,
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskBegin: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.maskBegin,
        );
        await sendJson(
          response,
          200,
          await this.#operator.beginMaskWorkflow({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            expectedWorkspaceRevision: body.expectedWorkspaceRevision,
            renderGeneration: body.renderGeneration,
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskEdit: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.maskEdit,
        );
        await sendJson(
          response,
          200,
          await this.#operator.applyMaskEdit({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            expectedWorkspaceRevision: body.expectedWorkspaceRevision,
            renderGeneration: body.renderGeneration,
            edit: body.edit,
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskTile: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.maskTile,
        );
        const tile = await this.#operator.prepareMaskTile({
          expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
          renderGeneration: body.renderGeneration,
          column: body.column,
          row: body.row,
          expectedMaskPhase: "mask_edit",
        });
        await this.#sendTile(request, response, tile);
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskReviewTile: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.maskReviewTile,
        );
        const tile = await this.#operator.prepareMaskTile({
          expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
          renderGeneration: body.renderGeneration,
          column: body.column,
          row: body.row,
          expectedMaskPhase: "mask_review",
        });
        await this.#sendTile(request, response, tile);
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskFreeze: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.maskFreeze,
        );
        await sendJson(
          response,
          200,
          await this.#operator.freezeMask({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            expectedWorkspaceRevision: body.expectedWorkspaceRevision,
            renderGeneration: body.renderGeneration,
            expectedMaskRevision: body.expectedMaskRevision,
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskReviewCoverage: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.maskReviewCoverage,
        );
        await sendJson(
          response,
          200,
          await this.#operator.recordMaskCoverage({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            renderGeneration: body.renderGeneration,
            documentVisibilityState: body.documentVisibilityState,
            documentFocusState: body.documentFocusState,
            viewportCssWidth: body.viewportCssWidth,
            viewportCssHeight: body.viewportCssHeight,
            devicePixelRatio: body.devicePixelRatio,
            sourceToCssTransform: body.sourceToCssTransform,
            paintedTiles: body.paintedTiles,
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceInclude: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.sourceInclude,
        );
        await sendJson(
          response,
          200,
          await this.#operator.recordIncludeDecision({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            expectedWorkspaceRevision: body.expectedWorkspaceRevision,
            renderGeneration: body.renderGeneration,
            classification: body.classification,
            note: body.note,
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceAttest: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.sourceAttest,
        );
        await sendJson(
          response,
          200,
          await this.#operator.recordHumanAttestation({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            expectedWorkspaceRevision: body.expectedWorkspaceRevision,
            renderGeneration: body.renderGeneration,
            reviewerId: body.reviewerId,
            knowledgeBasis: body.knowledgeBasis,
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceAbandon: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.sourceAbandon,
        );
        await sendJson(
          response,
          200,
          await this.#operator.abandonActiveSource({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            expectedWorkspaceRevision: body.expectedWorkspaceRevision,
            renderGeneration: body.renderGeneration,
            reason: "operator_abandon",
          }),
        );
        return;
      }
      case GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sessionStop: {
        const body = await parseRequestBody(
          request,
          headers,
          GrandHallT554NativeReviewHttpRequestSchemasV2.sessionStop,
        );
        await sendJson(
          response,
          200,
          await this.#operator.stop({
            expectedBrowserEpochNumber: body.expectedBrowserEpochNumber,
            expectedWorkspaceRevision: body.expectedWorkspaceRevision,
          }),
        );
      }
    }
  }

  async #sendTile(
    request: IncomingMessage,
    response: ServerResponse,
    tile: Tile,
  ): Promise<void> {
    const lifecycle = bindGrandHallT554NativeReviewTileToHttpResponseV2({
      request,
      response,
      tile,
    });
    const tracked = this.#trackTileLifecycle(lifecycle);
    const responseTimeout = setTimeout(() => {
      try {
        response.destroy();
      } catch {
        // The explicit failed-send trigger below remains authoritative.
      } finally {
        lifecycle.discardAfterSynchronousSendFailure();
      }
    }, RESPONSE_TERMINAL_TIMEOUT_MS);
    responseTimeout.unref();
    if (
      request.destroyed ||
      response.destroyed ||
      response.headersSent ||
      response.writableEnded ||
      response.writableFinished
    ) {
      lifecycle.discardAfterSynchronousSendFailure();
      let outcome: GrandHallT554NativeReviewHttpResponseDeliveryOutcomeV2;
      try {
        outcome = await tracked;
      } finally {
        clearTimeout(responseTimeout);
      }
      if (outcome.status === "discarded") {
        destroyResponseIfOpen(response);
      }
      return;
    }
    if (this.#closed) {
      lifecycle.discardAfterSynchronousSendFailure();
      try {
        await tracked;
      } finally {
        clearTimeout(responseTimeout);
      }
      return fail("SERVICE_UNAVAILABLE");
    }
    const sourceValid =
      tile.widthPx === TILE_WIDTH_PX &&
      tile.heightPx === TILE_HEIGHT_PX &&
      tile.sourceRgb8.byteLength === SOURCE_TILE_BYTE_LENGTH;
    const maskTile =
      tile.renderMode === "source_rgb8_mask8_reason8" ? tile : null;
    const masksValid =
      maskTile === null ||
      (maskTile.mask8.byteLength === MASK_TILE_PLANE_BYTE_LENGTH &&
        maskTile.reason8.byteLength === MASK_TILE_PLANE_BYTE_LENGTH);
    const schemaValid =
      maskTile === null
        ? hasExactRuntimeString(
            tile.schemaVersion,
            GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.sourceTile,
          )
        : hasExactRuntimeString(
            maskTile.schemaVersion,
            GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.maskTile,
          );
    if (!sourceValid || !masksValid || !schemaValid) {
      lifecycle.discardAfterSynchronousSendFailure();
      try {
        await tracked;
      } finally {
        clearTimeout(responseTimeout);
      }
      return fail("INTERNAL_ERROR");
    }
    let synchronousSendFailed = false;
    try {
      setSecurityHeaders(response);
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("X-Venviewer-Schema-Version", tile.schemaVersion);
      response.setHeader("X-Venviewer-Render-Mode", tile.renderMode);
      response.setHeader("X-Venviewer-Tile-Width", String(tile.widthPx));
      response.setHeader("X-Venviewer-Tile-Height", String(tile.heightPx));
      if (maskTile === null) {
        response.setHeader("Content-Length", tile.sourceRgb8.byteLength);
        response.end(tile.sourceRgb8);
      } else {
        response.setHeader(
          "Content-Length",
          maskTile.sourceRgb8.byteLength +
            maskTile.mask8.byteLength +
            maskTile.reason8.byteLength,
        );
        response.write(maskTile.sourceRgb8);
        response.write(maskTile.mask8);
        response.end(maskTile.reason8);
      }
    } catch {
      synchronousSendFailed = true;
      lifecycle.discardAfterSynchronousSendFailure();
      try {
        response.destroy();
      } catch {
        // The terminal delivery callback remains authoritative.
      }
    }
    let outcome: GrandHallT554NativeReviewHttpResponseDeliveryOutcomeV2;
    try {
      outcome = await tracked;
    } finally {
      clearTimeout(responseTimeout);
    }
    if (outcome.status === "discarded") {
      destroyResponseIfOpen(response);
    }
    if (synchronousSendFailed) return fail("INTERNAL_ERROR");
  }

  #trackTileLifecycle(
    lifecycle: GrandHallT554NativeReviewHttpResponseDeliveryLifecycleV2,
  ): Promise<GrandHallT554NativeReviewHttpResponseDeliveryOutcomeV2> {
    const tracked =
      (async (): Promise<GrandHallT554NativeReviewHttpResponseDeliveryOutcomeV2> => {
        try {
          return await lifecycle.completion;
        } catch (error) {
          if (
            error instanceof
              GrandHallT554NativeReviewHttpResponseAdapterErrorV2 &&
            (error.code === "DELIVERY_COMMIT_FAILED" ||
              error.code === "DELIVERY_DISCARD_FAILED")
          ) {
            await this.#latchFatal(error.code);
          }
          throw error;
        }
      })();
    this.#activeTileLifecycles.add(tracked);
    void tracked.then(
      () => this.#activeTileLifecycles.delete(tracked),
      () => this.#activeTileLifecycles.delete(tracked),
    );
    void tracked.catch(() => undefined);
    return tracked;
  }

  async #latchFatal(
    code: "DELIVERY_COMMIT_FAILED" | "DELIVERY_DISCARD_FAILED",
  ): Promise<void> {
    if (this.#fatalPromise === null) {
      this.#closed = true;
      const event = Object.freeze({
        schemaVersion: FATAL_EVENT_SCHEMA,
        code:
          code === "DELIVERY_COMMIT_FAILED"
            ? ("TILE_DELIVERY_COMMIT_FAILED" as const)
            : ("TILE_DELIVERY_DISCARD_FAILED" as const),
      });
      // Schedule the hook after publishing the fatal latch. The hook is observed
      // but deliberately not awaited: it may call and await router.close(), and
      // awaiting it here would form a fatal-hook -> close -> fatal-latch cycle.
      this.#fatalPromise = Promise.resolve().then(() => {
        this.#destroyBroker();
        this.#forceActiveTransports();
        try {
          const hookResult = this.#fatalHook(event);
          void Promise.resolve(hookResult).catch((error: unknown) => {
            this.#cleanupErrors.push(error);
          });
        } catch (error) {
          this.#cleanupErrors.push(error);
        }
      });
      void this.#fatalPromise.catch(() => undefined);
      this.#fatalDrainPromise = (async (): Promise<void> => {
        await this.#fatalPromise;
        await this.#drainActiveWork();
        const closeResult = await Promise.allSettled([
          this.#closeOperatorOnce(),
        ]);
        for (const result of closeResult) {
          if (result.status === "rejected") {
            this.#cleanupErrors.push(result.reason);
          }
        }
      })();
      void this.#fatalDrainPromise.catch((error: unknown) => {
        this.#cleanupErrors.push(error);
      });
    }
    await this.#fatalPromise;
  }

  #destroyBroker(): void {
    if (this.#brokerDestroyed) return;
    this.#brokerDestroyed = true;
    try {
      this.#broker.destroy();
    } catch (error) {
      this.#cleanupErrors.push(error);
    }
  }

  #forceActiveTransports(): void {
    for (const request of this.#activeRequests) {
      try {
        request.destroy();
      } catch (error) {
        this.#cleanupErrors.push(error);
      }
    }
    for (const response of this.#activeResponses) {
      if (response.destroyed) continue;
      try {
        response.destroy();
      } catch (error) {
        this.#cleanupErrors.push(error);
      }
    }
  }

  #closeOperatorOnce(): Promise<void> {
    if (this.#operatorClosePromise === null) {
      this.#operatorClosePromise = Promise.resolve().then(() =>
        this.#operator.close(),
      );
      void this.#operatorClosePromise.catch(() => undefined);
    }
    return this.#operatorClosePromise;
  }

  async #sendFixedErrorIfPossible(
    response: ServerResponse,
    error: RouterHttpErrorV2,
  ): Promise<void> {
    if (!responseCanStart(response)) {
      if (!response.destroyed) {
        try {
          response.destroy();
        } catch {
          // No second response is attempted after a terminal send state.
        }
      }
      return;
    }
    try {
      await sendJson(response, HTTP_ERROR_STATUS[error.code], {
        schemaVersion:
          GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.error,
        error: error.code,
      });
    } catch {
      try {
        response.destroy();
      } catch {
        // The response is already unusable; raw failure detail stays local.
      }
    }
  }

  async #performClose(): Promise<void> {
    this.#destroyBroker();
    this.#forceActiveTransports();
    if (this.#fatalPromise !== null) await this.#fatalPromise;
    await this.#drainActiveWork();
    if (this.#fatalDrainPromise !== null) {
      await this.#fatalDrainPromise;
    } else {
      const closeResult = await Promise.allSettled([this.#closeOperatorOnce()]);
      for (const result of closeResult) {
        if (result.status === "rejected")
          this.#cleanupErrors.push(result.reason);
      }
    }
    if (this.#cleanupErrors.length > 0) {
      throw new AggregateError(
        [...this.#cleanupErrors],
        "Grand Hall native review router cleanup failed.",
      );
    }
  }

  async #drainActiveWork(): Promise<void> {
    for (;;) {
      const active = [...this.#activeTileLifecycles, ...this.#activeHandles];
      if (active.length === 0) break;
      const results = await Promise.allSettled(active);
      for (const result of results) {
        if (result.status === "rejected") {
          this.#cleanupErrors.push(result.reason);
        }
      }
    }
  }
}

export function createGrandHallT554NativeReviewRouterV2(
  options: GrandHallT554NativeReviewRouterOptionsV2,
): GrandHallT554NativeReviewRouterV2 {
  assertFactoryOptions(options);
  return Object.freeze(new InjectedRouterV2(options));
}

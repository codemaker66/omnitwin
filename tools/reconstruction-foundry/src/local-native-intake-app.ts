import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  LOCAL_NATIVE_INTAKE_APP_CSS,
  LOCAL_NATIVE_INTAKE_APP_HTML,
  LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT,
} from "./local-native-intake-assets.js";

export const LOCAL_NATIVE_INTAKE_HOST = "127.0.0.1";
export const LOCAL_NATIVE_INTAKE_DEFAULT_SESSION_TTL_MS = 4 * 60 * 60 * 1_000;
export const LOCAL_NATIVE_INTAKE_MAX_REQUEST_BODY_BYTES = 4 * 1_024;

const MINIMUM_SESSION_TTL_MS = 50;
const MAXIMUM_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const SESSION_EXPIRY_STOP_RETRY_INITIAL_DELAY_MS = 100;
const SESSION_EXPIRY_STOP_RETRY_MAX_DELAY_MS = 5_000;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const OPAQUE_BINDING_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;
const EVENT_SCHEMA_VERSION = "trusted-windows-native-source-basket-event.v1";
const START_CONFIRMATION = "inspect_and_keep_verified_copies";
const PUBLIC_BROWSER_FIELDS: ReadonlySet<string> = new Set([
  "accepted", "admitted", "authority", "basketPosition", "blockers", "busy", "byteCountDecimal",
  "canCancel", "canCancelImport", "canStart", "cancellationBoundary", "cancelledItems", "cancelledRoots", "captured",
  "checklist", "code", "codeCount", "codes", "collectionIndexSha256", "collectionIndexStored", "completedItems", "count",
  "conceptImagination", "copiedBytes", "copiedFileCount", "discoveredFiles", "durableOutcome",
  "detectedFamilies", "enhancedCaptured", "error", "eventToken", "excluded", "facts",
  "failure", "failureCode", "failedItems", "failedRoots", "families", "fileCount",
  "filesystemModel", "generatedCinematic", "inputType", "inspectedBytes", "inspectedFileCount",
  "items", "kind", "label", "labelSafety", "message", "mode", "nativeCustodyClaimed",
  "nextAction", "nextEvent", "outcome", "pendingReview", "phase", "planState", "progress", "readiness",
  "reportAvailable", "reportSha256", "revision", "schemaVersion", "selectedBytesDecimal",
  "selectedFileCount", "selectedRoots", "sessionRef", "sha256", "sources", "state", "status",
  "stopping", "storedBytes", "storedFiles", "storedRoots", "support", "totalBytes",
  "totalBytesDecimal", "totalItems", "totals", "truth", "view",
]);
const PUBLIC_SCHEMA_VERSIONS: ReadonlySet<string> = new Set([
  "omnitwin.foundry.local-native-intake-action-result.v0",
  "omnitwin.foundry.local-native-intake-report.v0",
  "omnitwin.foundry.local-native-intake-view.v0",
  "omnitwin.foundry.local-native-collection-analysis-report.v0",
  "omnitwin.foundry.local-native-collection-analysis-view.v0",
  EVENT_SCHEMA_VERSION,
]);
const GENERATED_PUBLIC_LABEL_PATTERN = /^(?:File|Folder) [1-9][0-9]*$/u;
const PRIVATE_BASENAME_TOKEN_PATTERN = /(?:^|[\s"'([{=,:;])(?:\.[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}|[^\\/\s"'()<>{}=,:;]{1,200}\.[\p{L}\p{N}][\p{L}\p{N}._-]{0,15})(?=$|[\s"',;:)\]}])/u;
const KNOWN_ROUTES = new Map<string, "GET" | "POST">([
  ["/", "GET"],
  ["/app.css", "GET"],
  ["/app.js", "GET"],
  ["/api/native-source-basket", "GET"],
  ["/api/native-source-basket/action", "POST"],
  ["/api/native-source-basket/cancel-active", "POST"],
  ["/api/native-source-basket/report", "POST"],
  ["/api/native-collection-analysis/start", "POST"],
  ["/api/native-collection-analysis/status", "POST"],
  ["/api/native-collection-analysis/cancel", "POST"],
  ["/api/native-collection-analysis/report", "POST"],
  ["/api/stop", "POST"],
]);

const RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "img-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export type LocalNativeIntakeAppPhase = "running" | "stopping" | "stopped";
export type LocalNativeIntakeAppStopReason =
  | "operator"
  | "programmatic"
  | "session_expired";

export interface LocalNativeIntakeActionEvent {
  readonly schemaVersion: typeof EVENT_SCHEMA_VERSION;
  readonly sessionRef: string;
  readonly revision: number;
  readonly eventToken: string;
  readonly action: "add_files" | "add_folder" | "add_dropped" | "cancel" | "start";
  readonly confirmation?: typeof START_CONFIRMATION;
}

/**
 * The browser server deliberately depends on this narrow process-owned seam.
 * Concrete helper paths and source paths never enter this interface from HTTP.
 */
export interface LocalNativeIntakeAppController {
  getView(): unknown;
  dispatch(event: LocalNativeIntakeActionEvent): Promise<unknown>;
  cancelActive(): Promise<unknown>;
  getReport(): unknown;
  close(): Promise<void>;
}

export interface LocalNativeCollectionAnalysisAppController {
  getView(): unknown;
  start(): unknown;
  cancel(): Promise<unknown>;
  getReport(): unknown;
  close(): Promise<void>;
}

export interface LocalNativeIntakeAppOptions {
  readonly controller: LocalNativeIntakeAppController;
  readonly analysisController?: LocalNativeCollectionAnalysisAppController;
  readonly port?: number;
  readonly host?: string;
  readonly sessionTtlMs?: number;
}

export interface LocalNativeIntakeAppClosed {
  readonly reason: LocalNativeIntakeAppStopReason;
}

export interface LocalNativeIntakeAppHandle {
  readonly host: typeof LOCAL_NATIVE_INTAKE_HOST;
  readonly port: number;
  readonly origin: string;
  readonly url: string;
  readonly closed: Promise<LocalNativeIntakeAppClosed>;
  readonly stop: () => Promise<void>;
  readonly getPhase: () => LocalNativeIntakeAppPhase;
}

type PlainJson = null | boolean | number | string | PlainJson[] | { [key: string]: PlainJson };

class LocalNativeIntakeHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "LocalNativeIntakeHttpError";
    this.statusCode = statusCode;
  }
}

class UnsafePublicValueError extends Error {
  constructor() {
    super("A process response was not safe to show in the browser.");
    this.name = "UnsafePublicValueError";
  }
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || (port !== 0 && (port < 1_024 || port > 65_535))) {
    throw new TypeError(
      "The local native-intake port must be between 1024 and 65535, or zero for an automatic port.",
    );
  }
}

function validateSessionTtl(sessionTtlMs: number): void {
  if (
    !Number.isSafeInteger(sessionTtlMs) ||
    sessionTtlMs < MINIMUM_SESSION_TTL_MS ||
    sessionTtlMs > MAXIMUM_SESSION_TTL_MS
  ) {
    throw new TypeError("The local native-intake session length is outside the supported range.");
  }
}

function constantTimeTokenMatch(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

function requireToken(url: URL, expectedToken: string): void {
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== "token" ||
    !constantTimeTokenMatch(entries[0]?.[1] ?? "", expectedToken)
  ) {
    throw new LocalNativeIntakeHttpError(401, "This local session link is missing or has expired.");
  }
}

function assertLoopbackSocket(request: IncomingMessage): void {
  if (
    request.socket.localAddress !== LOCAL_NATIVE_INTAKE_HOST ||
    request.socket.remoteAddress !== LOCAL_NATIVE_INTAKE_HOST
  ) {
    throw new LocalNativeIntakeHttpError(403, "This app accepts connections from this computer only.");
  }
}

function assertHostAndOrigin(
  request: IncomingMessage,
  expectedHost: string,
  expectedOrigin: string,
): void {
  if (request.headers.host !== expectedHost) {
    throw new LocalNativeIntakeHttpError(421, "The local app address is not valid for this session.");
  }
  if (request.headers.origin !== undefined && request.headers.origin !== expectedOrigin) {
    throw new LocalNativeIntakeHttpError(403, "Requests from another website are not accepted.");
  }
}

function requireSameOriginPost(request: IncomingMessage, expectedOrigin: string): void {
  if (request.headers.origin !== expectedOrigin) {
    throw new LocalNativeIntakeHttpError(403, "The request must come from this local app.");
  }
}

function setResponseHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) {
    response.setHeader(name, value);
  }
  response.setHeader("Connection", "close");
}

function sendBytes(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: Buffer,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  setResponseHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", body.byteLength);
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.end(body);
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  sendBytes(response, statusCode, contentType, Buffer.from(body, "utf8"), extraHeaders);
}

function forbiddenBrowserField(key: string): boolean {
  const normalized = key.replace(/[-_.]/gu, "").toLowerCase();
  return !PUBLIC_BROWSER_FIELDS.has(key) ||
    normalized === "path" ||
    normalized.endsWith("path") ||
    normalized.endsWith("paths") ||
    normalized.includes("filename") ||
    normalized.includes("canonicalabsolute") ||
    normalized.includes("resolvedabsolute") ||
    normalized.includes("helperconfig") ||
    normalized.includes("executablelocation");
}

function containsPrivateLocatorOrName(value: string, fieldName: string | null): boolean {
  if (fieldName === "schemaVersion") return !PUBLIC_SCHEMA_VERSIONS.has(value);
  if (fieldName === "label") return !GENERATED_PUBLIC_LABEL_PATTERN.test(value);
  return value.includes("\\") ||
    value.includes("/") ||
    PRIVATE_BASENAME_TOKEN_PATTERN.test(value);
}

function clonePathFreePlainJson(
  value: unknown,
  depth = 0,
  active = new WeakSet(),
  fieldName: string | null = null,
): PlainJson {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 256 * 1_024 || containsPrivateLocatorOrName(value, fieldName)) {
      throw new UnsafePublicValueError();
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new UnsafePublicValueError();
    return value;
  }
  if (typeof value !== "object" || depth > 24 || active.has(value)) {
    throw new UnsafePublicValueError();
  }
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    throw new UnsafePublicValueError();
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 1_000_000 || Reflect.ownKeys(value).length !== value.length + 1) {
        throw new UnsafePublicValueError();
      }
      return value.map((item) => clonePathFreePlainJson(item, depth + 1, active, fieldName));
    }
    const output: { [key: string]: PlainJson } = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || forbiddenBrowserField(key)) {
        throw new UnsafePublicValueError();
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        throw new UnsafePublicValueError();
      }
      output[key] = clonePathFreePlainJson(descriptor.value, depth + 1, active, key);
    }
    return output;
  } finally {
    active.delete(value);
  }
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const safeValue = clonePathFreePlainJson(value);
  sendText(
    response,
    statusCode,
    "application/json; charset=utf-8",
    `${JSON.stringify(safeValue)}\n`,
  );
}

function sendHttpError(response: ServerResponse, error: LocalNativeIntakeHttpError): void {
  sendJson(response, error.statusCode, { error: error.message });
}

async function readJsonObject(
  request: IncomingMessage,
  maximumBytes: number,
  requestName: string,
): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new LocalNativeIntakeHttpError(415, `${requestName} must use JSON.`);
  }
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new LocalNativeIntakeHttpError(400, "The request size is invalid.");
    }
    if (Number(contentLength) > maximumBytes) {
      request.resume();
      throw new LocalNativeIntakeHttpError(413, "The request is too large.");
    }
  }
  const body = await new Promise<Buffer>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let byteCount = 0;
    let settled = false;
    request.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      byteCount += bytes.byteLength;
      if (byteCount > maximumBytes) {
        settled = true;
        request.resume();
        rejectBody(new LocalNativeIntakeHttpError(413, "The request is too large."));
        return;
      }
      chunks.push(bytes);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks));
    });
    request.on("error", () => {
      if (settled) return;
      settled = true;
      rejectBody(new LocalNativeIntakeHttpError(400, "The request could not be read."));
    });
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new LocalNativeIntakeHttpError(400, `${requestName} is not valid JSON.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LocalNativeIntakeHttpError(400, `${requestName} must be one JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  requestName: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new LocalNativeIntakeHttpError(
      400,
      `${requestName} must contain exactly the fields shown by this local app.`,
    );
  }
}

function parseActionEvent(value: Record<string, unknown>): LocalNativeIntakeActionEvent {
  const action = value.action;
  const allowedActions: readonly LocalNativeIntakeActionEvent["action"][] = [
    "add_files",
    "add_folder",
    "add_dropped",
    "cancel",
    "start",
  ];
  if (typeof action !== "string" || !allowedActions.includes(action as LocalNativeIntakeActionEvent["action"])) {
    throw new LocalNativeIntakeHttpError(400, "The selection action is not valid.");
  }
  assertExactKeys(
    value,
    action === "start"
      ? ["schemaVersion", "sessionRef", "revision", "eventToken", "action", "confirmation"]
      : ["schemaVersion", "sessionRef", "revision", "eventToken", "action"],
    "The selection action",
  );
  if (
    value.schemaVersion !== EVENT_SCHEMA_VERSION ||
    typeof value.sessionRef !== "string" ||
    !OPAQUE_BINDING_PATTERN.test(value.sessionRef) ||
    typeof value.eventToken !== "string" ||
    !OPAQUE_BINDING_PATTERN.test(value.eventToken) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    Object.is(value.revision, -0) ||
    (action === "start" && value.confirmation !== START_CONFIRMATION)
  ) {
    throw new LocalNativeIntakeHttpError(400, "The selection action binding is not valid.");
  }
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    sessionRef: value.sessionRef,
    revision: value.revision,
    eventToken: value.eventToken,
    action: action as LocalNativeIntakeActionEvent["action"],
    ...(action === "start" ? { confirmation: START_CONFIRMATION } : {}),
  };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const onError = (error: Error): void => {
      rejectPort(error);
    };
    server.once("error", onError);
    server.once("listening", () => {
      server.off("error", onError);
      const address = server.address();
      if (
        address === null ||
        typeof address === "string" ||
        address.address !== LOCAL_NATIVE_INTAKE_HOST
      ) {
        rejectPort(new Error("The local native-intake app did not bind to the expected loopback address."));
        return;
      }
      resolvePort(address.port);
    });
    server.listen({ host: LOCAL_NATIVE_INTAKE_HOST, port, exclusive: true });
  });
}

export async function startLocalNativeIntakeApp(
  options: LocalNativeIntakeAppOptions,
): Promise<LocalNativeIntakeAppHandle> {
  const host = options.host ?? LOCAL_NATIVE_INTAKE_HOST;
  if (host !== LOCAL_NATIVE_INTAKE_HOST) {
    throw new TypeError("The local native-intake app can bind only to 127.0.0.1.");
  }
  const controllerCandidate: unknown = options.controller;
  if (
    controllerCandidate === null ||
    typeof controllerCandidate !== "object" ||
    !("getView" in controllerCandidate) ||
    typeof controllerCandidate.getView !== "function" ||
    !("dispatch" in controllerCandidate) ||
    typeof controllerCandidate.dispatch !== "function" ||
    !("cancelActive" in controllerCandidate) ||
    typeof controllerCandidate.cancelActive !== "function" ||
    !("getReport" in controllerCandidate) ||
    typeof controllerCandidate.getReport !== "function" ||
    !("close" in controllerCandidate) ||
    typeof controllerCandidate.close !== "function"
  ) {
    throw new TypeError("A complete process-owned local intake controller is required.");
  }
  const analysisControllerCandidate: unknown = options.analysisController;
  if (
    analysisControllerCandidate !== undefined &&
    (
      analysisControllerCandidate === null ||
      typeof analysisControllerCandidate !== "object" ||
      !("getView" in analysisControllerCandidate) ||
      typeof analysisControllerCandidate.getView !== "function" ||
      !("start" in analysisControllerCandidate) ||
      typeof analysisControllerCandidate.start !== "function" ||
      !("cancel" in analysisControllerCandidate) ||
      typeof analysisControllerCandidate.cancel !== "function" ||
      !("getReport" in analysisControllerCandidate) ||
      typeof analysisControllerCandidate.getReport !== "function" ||
      !("close" in analysisControllerCandidate) ||
      typeof analysisControllerCandidate.close !== "function"
    )
  ) {
    throw new TypeError("A complete process-owned collection analysis controller is required.");
  }
  const requestedPort = options.port ?? 0;
  const sessionTtlMs = options.sessionTtlMs ?? LOCAL_NATIVE_INTAKE_DEFAULT_SESSION_TTL_MS;
  validatePort(requestedPort);
  validateSessionTtl(sessionTtlMs);

  const sessionToken = randomBytes(32).toString("base64url");
  if (!SESSION_TOKEN_PATTERN.test(sessionToken)) {
    throw new Error("The local native-intake session token is invalid.");
  }

  let phase: LocalNativeIntakeAppPhase = "running";
  let boundPort = 0;
  let expectedHost = "";
  let origin = "";
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let sessionExpired = false;
  let expiryStopRetryDelayMs = SESSION_EXPIRY_STOP_RETRY_INITIAL_DELAY_MS;
  let controllerClosed = false;
  let analysisControllerClosed = false;
  type ActiveStop = {
    readonly id: symbol;
    readonly controllerReady: Promise<void>;
    readonly promise: Promise<void>;
  };
  let activeStop: ActiveStop | undefined;
  const pendingStopResponses = new Set<Promise<void>>();
  let resolveClosed: ((value: LocalNativeIntakeAppClosed) => void) | undefined;
  const closed = new Promise<LocalNativeIntakeAppClosed>((resolveValue) => {
    resolveClosed = resolveValue;
  });

  const server = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof LocalNativeIntakeHttpError) {
        sendHttpError(response, error);
        return;
      }
      sendJson(response, 500, {
        error: "The local action could not be completed. No original source was changed.",
      });
    });
  });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    assertLoopbackSocket(request);
    const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");
    const expectedMethod = KNOWN_ROUTES.get(url.pathname);
    if (expectedMethod === undefined) {
      throw new LocalNativeIntakeHttpError(404, "This local app route was not found.");
    }
    if (request.method !== expectedMethod) {
      response.setHeader("Allow", expectedMethod);
      sendJson(
        response,
        405,
        { error: "This local app route does not accept that method." },
      );
      return;
    }
    assertHostAndOrigin(request, expectedHost, origin);
    requireToken(url, sessionToken);
    if (phase !== "running" && url.pathname !== "/api/stop") {
      throw new LocalNativeIntakeHttpError(409, "This local session is stopping.");
    }
    if (expectedMethod === "POST") requireSameOriginPost(request, origin);

    if (url.pathname === "/") {
      const html = LOCAL_NATIVE_INTAKE_APP_HTML.replaceAll(
        "__SESSION_TOKEN__",
        encodeURIComponent(sessionToken),
      );
      sendText(response, 200, "text/html; charset=utf-8", html);
      return;
    }
    if (url.pathname === "/app.css") {
      sendText(response, 200, "text/css; charset=utf-8", LOCAL_NATIVE_INTAKE_APP_CSS);
      return;
    }
    if (url.pathname === "/app.js") {
      sendText(
        response,
        200,
        "text/javascript; charset=utf-8",
        LOCAL_NATIVE_INTAKE_APP_JAVASCRIPT,
      );
      return;
    }
    if (url.pathname === "/api/native-source-basket") {
      sendJson(response, 200, options.controller.getView());
      return;
    }

    const body = await readJsonObject(
      request,
      LOCAL_NATIVE_INTAKE_MAX_REQUEST_BODY_BYTES,
      "The local intake request",
    );
    if (url.pathname === "/api/native-source-basket/action") {
      const event = parseActionEvent(body);
      const result = await options.controller.dispatch(event);
      if (event.action === "start") {
        const publicResult = clonePathFreePlainJson(result);
        if (
          publicResult === null ||
          typeof publicResult !== "object" ||
          Array.isArray(publicResult) ||
          publicResult.view === null ||
          typeof publicResult.view !== "object" ||
          Array.isArray(publicResult.view)
        ) {
          throw new UnsafePublicValueError();
        }
        const accepted = publicResult.status === "started" &&
          publicResult.code === "IMPORT_STAGED" &&
          publicResult.view.phase === "importing" &&
          publicResult.view.durableOutcome === "in_progress";
        sendJson(response, accepted ? 202 : 200, { ...publicResult, accepted });
        return;
      }
      sendJson(response, 200, result);
      return;
    }
    assertExactKeys(body, [], "The local intake request");
    if (url.pathname.startsWith("/api/native-collection-analysis/")) {
      const analysis = options.analysisController;
      if (analysis === undefined) {
        throw new LocalNativeIntakeHttpError(
          409,
          "Collection inspection is not available in this local session.",
        );
      }
      if (url.pathname === "/api/native-collection-analysis/start") {
        const before = clonePathFreePlainJson(analysis.getView());
        if (
          before === null ||
          typeof before !== "object" ||
          Array.isArray(before) ||
          before.canStart !== true
        ) {
          throw new LocalNativeIntakeHttpError(
            409,
            "A verified durable collection is not ready for inspection.",
          );
        }
        sendJson(response, 202, analysis.start());
        return;
      }
      if (url.pathname === "/api/native-collection-analysis/status") {
        sendJson(response, 200, analysis.getView());
        return;
      }
      if (url.pathname === "/api/native-collection-analysis/cancel") {
        sendJson(response, 200, await analysis.cancel());
        return;
      }
      if (url.pathname === "/api/native-collection-analysis/report") {
        sendJson(response, 200, analysis.getReport());
        return;
      }
    }
    if (url.pathname === "/api/native-source-basket/cancel-active") {
      sendJson(response, 200, await options.controller.cancelActive());
      return;
    }
    if (url.pathname === "/api/native-source-basket/report") {
      sendJson(response, 200, await options.controller.getReport());
      return;
    }
    if (url.pathname === "/api/stop") {
      let resolveResponseSettled: (() => void) | undefined;
      const responseSettled = new Promise<void>((resolveSettled) => {
        resolveResponseSettled = resolveSettled;
      });
      let responseDidSettle = false;
      const settleResponse = (): void => {
        if (responseDidSettle) return;
        responseDidSettle = true;
        pendingStopResponses.delete(responseSettled);
        resolveResponseSettled?.();
      };
      pendingStopResponses.add(responseSettled);
      response.once("finish", settleResponse);
      response.once("close", settleResponse);
      response.once("error", settleResponse);
      const stop = beginStop("operator");
      try {
        await stop.controllerReady;
      } catch {
        sendJson(response, 503, {
          stopping: phase === "stopping",
          error: "The local helper did not confirm shutdown. Retry shutdown to confirm that the helper has stopped.",
        });
        return;
      }
      sendJson(response, 200, { stopping: true });
      return;
    }
    throw new LocalNativeIntakeHttpError(404, "This local app route was not found.");
  }

  async function waitForStopResponses(): Promise<void> {
    for (;;) {
      await new Promise<void>((resolveTurn) => {
        setImmediate(resolveTurn);
      });
      const pending = [...pendingStopResponses];
      if (pending.length === 0) return;
      await Promise.all(pending);
    }
  }

  function closeListeningServer(): Promise<void> {
    return new Promise((resolveClose, rejectClose) => {
      server.close((error?: Error) => {
        if (error !== undefined) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    });
  }

  function scheduleExpiredSessionStopRetry(): void {
    if (!sessionExpired || phase === "stopped" || expiryTimer !== undefined) return;
    const delayMs = expiryStopRetryDelayMs;
    expiryStopRetryDelayMs = Math.min(
      expiryStopRetryDelayMs * 2,
      SESSION_EXPIRY_STOP_RETRY_MAX_DELAY_MS,
    );
    expiryTimer = setTimeout(() => {
      expiryTimer = undefined;
      void beginStop("session_expired").promise.catch(() => undefined);
    }, delayMs);
    expiryTimer.unref();
  }

  function beginStop(reason: LocalNativeIntakeAppStopReason): ActiveStop {
    if (activeStop !== undefined) return activeStop;
    const attemptId = Symbol("local-native-intake-stop");
    let controllerReadySettled = false;
    let resolveControllerReady: (() => void) | undefined;
    let rejectControllerReady: ((error: unknown) => void) | undefined;
    const controllerReady = new Promise<void>((resolveReady, rejectReady) => {
      resolveControllerReady = resolveReady;
      rejectControllerReady = rejectReady;
    });
    const promise = (async (): Promise<void> => {
      if (phase === "stopped") {
        controllerReadySettled = true;
        resolveControllerReady?.();
        return;
      }
      phase = "stopping";
      try {
        if (!analysisControllerClosed && options.analysisController !== undefined) {
          await options.analysisController.close();
          analysisControllerClosed = true;
        }
        if (!controllerClosed) {
          await options.controller.close();
          controllerClosed = true;
        }
        controllerReadySettled = true;
        resolveControllerReady?.();
        if (expiryTimer !== undefined) clearTimeout(expiryTimer);
        expiryTimer = undefined;
        await waitForStopResponses();
        await closeListeningServer();
        phase = "stopped";
        resolveClosed?.({ reason: sessionExpired ? "session_expired" : reason });
        resolveClosed = undefined;
      } catch (error: unknown) {
        if (!controllerReadySettled) {
          controllerReadySettled = true;
          rejectControllerReady?.(error);
        }
        phase = sessionExpired || controllerClosed ? "stopping" : "running";
        scheduleExpiredSessionStopRetry();
        throw error instanceof Error
          ? error
          : new Error("The process-owned intake controller could not be closed.");
      } finally {
        if (phase !== "stopped") activeStop = undefined;
      }
    })();
    const attemptRecord: ActiveStop = { id: attemptId, controllerReady, promise };
    activeStop = attemptRecord;
    void controllerReady.catch(() => undefined);
    void promise.catch(() => undefined);
    return attemptRecord;
  }

  try {
    boundPort = await listen(server, requestedPort);
  } catch (error: unknown) {
    server.close();
    throw error;
  }
  expectedHost = `${LOCAL_NATIVE_INTAKE_HOST}:${String(boundPort)}`;
  origin = `http://${expectedHost}`;
  expiryTimer = setTimeout(() => {
    expiryTimer = undefined;
    sessionExpired = true;
    void beginStop("session_expired").promise.catch(() => undefined);
  }, sessionTtlMs);
  expiryTimer.unref();

  return {
    host: LOCAL_NATIVE_INTAKE_HOST,
    port: boundPort,
    origin,
    url: `${origin}/?token=${encodeURIComponent(sessionToken)}`,
    closed,
    stop: () => beginStop("programmatic").promise,
    getPhase: () => phase,
  };
}

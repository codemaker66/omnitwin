import { randomBytes, timingSafeEqual } from "node:crypto";
import type {
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";

import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const LOCAL_SESSION_HOST = "127.0.0.1";
export const LOCAL_SESSION_DEFAULT_TTL_MS = 4 * 60 * 60 * 1_000;
export const LOCAL_SESSION_MINIMUM_TTL_MS = 5 * 60 * 1_000;
export const LOCAL_SESSION_MAXIMUM_TTL_MS = 8 * 60 * 60 * 1_000;
export const LOCAL_SESSION_MAX_REQUEST_BODY_BYTES = 256 * 1_024;
export const LOCAL_SESSION_MAX_CONCURRENT_REQUESTS = 16;
export const LOCAL_SESSION_MAX_REQUESTS_PER_MINUTE = 4_096;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const AUTHORIZATION_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/u;

export const LOCAL_SESSION_SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate, private",
  "Content-Security-Policy": [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' blob:",
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
    "camera=()",
    "display-capture=()",
    "geolocation=()",
    "microphone=()",
    "payment=()",
    "usb=()",
  ].join(", "),
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const);

export class LocalSessionHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LocalSessionHttpError";
  }
}

function headerOccurrenceCount(request: IncomingMessage, name: string): number {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name.toLowerCase()) count += 1;
  }
  return count;
}

function constantTimeTokenMatch(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes);
}

export interface LocalSessionTokenBroker {
  readonly bootstrapFragment: string;
  readonly exchangeBootstrapToken: (candidate: string) => string;
  readonly authorizeRequest: (request: IncomingMessage) => void;
  readonly destroy: () => void;
}

export interface LocalSessionTokenBrokerOptions {
  readonly ttlMs?: number;
  readonly monotonicNowMs?: () => number;
}

/**
 * The bootstrap token is placed only in a URL fragment, exchanged once, then
 * discarded. The returned bearer is kept in browser memory only.
 */
export function createLocalSessionTokenBroker(
  options: LocalSessionTokenBrokerOptions = {},
): LocalSessionTokenBroker {
  const ttlMs = options.ttlMs ?? LOCAL_SESSION_DEFAULT_TTL_MS;
  validateLocalSessionTtl(ttlMs);
  const monotonicNowMs = options.monotonicNowMs ?? (() => performance.now());
  const createdAt = monotonicNowMs();
  if (!Number.isFinite(createdAt) || createdAt < 0) {
    throw new TypeError("Local-session expiry clock must start at a finite nonnegative value.");
  }
  const expiresAt = createdAt + ttlMs;
  let bootstrapToken: string | null = randomBytes(32).toString("base64url");
  let bearerToken: string | null = randomBytes(32).toString("base64url");
  if (
    !TOKEN_PATTERN.test(bootstrapToken) ||
    !TOKEN_PATTERN.test(bearerToken)
  ) {
    throw new Error("Local-session security token generation failed.");
  }
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  const destroy = (): void => {
    bootstrapToken = null;
    bearerToken = null;
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  };
  const assertAlive = (): void => {
    const now = monotonicNowMs();
    if (!Number.isFinite(now) || now < createdAt || now >= expiresAt) {
      destroy();
      throw new LocalSessionHttpError(401, "The local session has expired.");
    }
  };
  expiryTimer = setTimeout(destroy, ttlMs);
  expiryTimer.unref();
  return {
    get bootstrapFragment() {
      assertAlive();
      if (bootstrapToken === null) return "";
      return `#bootstrap=${bootstrapToken}`;
    },
    exchangeBootstrapToken: (candidate) => {
      assertAlive();
      if (
        bootstrapToken === null ||
        bearerToken === null ||
        !TOKEN_PATTERN.test(candidate) ||
        !constantTimeTokenMatch(candidate, bootstrapToken)
      ) {
        throw new LocalSessionHttpError(
          401,
          "The one-time local-session link is invalid or has already been used.",
        );
      }
      bootstrapToken = null;
      return bearerToken;
    },
    authorizeRequest: (request) => {
      assertAlive();
      if (
        bearerToken === null ||
        headerOccurrenceCount(request, "authorization") !== 1
      ) {
        throw new LocalSessionHttpError(
          401,
          "The local-session bearer is missing or expired.",
        );
      }
      const authorization = request.headers.authorization ?? "";
      const match = AUTHORIZATION_PATTERN.exec(authorization);
      if (
        match?.[1] === undefined ||
        !constantTimeTokenMatch(match[1], bearerToken)
      ) {
        throw new LocalSessionHttpError(
          401,
          "The local-session bearer is missing or expired.",
        );
      }
    },
    destroy,
  };
}

export function assertLocalSessionRequest(
  request: IncomingMessage,
  expectedHost: string,
  expectedOrigin: string,
  mutation: boolean,
): void {
  if (
    request.socket.localAddress !== LOCAL_SESSION_HOST ||
    request.socket.remoteAddress !== LOCAL_SESSION_HOST
  ) {
    throw new LocalSessionHttpError(
      403,
      "This operator tool accepts connections from this computer only.",
    );
  }
  if (
    headerOccurrenceCount(request, "host") !== 1 ||
    request.headers.host !== expectedHost
  ) {
    throw new LocalSessionHttpError(
      421,
      "The local-session Host header is invalid.",
    );
  }
  if (!mutation) return;
  if (
    headerOccurrenceCount(request, "origin") !== 1 ||
    request.headers.origin !== expectedOrigin
  ) {
    throw new LocalSessionHttpError(
      403,
      "This mutation did not originate from the active local session.",
    );
  }
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite !== undefined && fetchSite !== "same-origin") {
    throw new LocalSessionHttpError(
      403,
      "Cross-site mutation requests are not accepted.",
    );
  }
}

export function assertLocalSessionUrlHasNoQuery(url: URL): void {
  if ([...url.searchParams].length > 0 || url.username !== "" || url.password !== "") {
    throw new LocalSessionHttpError(
      400,
      "Local-session routes do not accept query credentials or options.",
    );
  }
}

export async function readLocalSessionStrictJsonObject(
  request: IncomingMessage,
  maximumBytes = LOCAL_SESSION_MAX_REQUEST_BODY_BYTES,
): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 2) {
    throw new TypeError("Strict JSON body limit must be a positive safe bound.");
  }
  if (headerOccurrenceCount(request, "content-type") !== 1) {
    throw new LocalSessionHttpError(415, "The request must declare one JSON content type.");
  }
  const contentType = request.headers["content-type"]
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new LocalSessionHttpError(415, "The request must use application/json.");
  }
  const contentLengthValues = request.rawHeaders.flatMap((value, index) =>
    index % 2 === 0 && value.toLowerCase() === "content-length"
      ? [request.rawHeaders[index + 1] ?? ""]
      : [],
  );
  if (contentLengthValues.length > 1) {
    throw new LocalSessionHttpError(400, "The request has duplicate length headers.");
  }
  const declaredLength = contentLengthValues[0];
  if (declaredLength !== undefined) {
    if (!/^\d+$/u.test(declaredLength)) {
      throw new LocalSessionHttpError(400, "The request size is invalid.");
    }
    if (Number(declaredLength) > maximumBytes) {
      request.resume();
      throw new LocalSessionHttpError(413, "The request body is too large.");
    }
  }

  const body = await new Promise<Buffer>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let byteCount = 0;
    let settled = false;
    const fail = (error: LocalSessionHttpError): void => {
      if (settled) return;
      settled = true;
      request.resume();
      rejectBody(error);
    };
    request.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      byteCount += bytes.byteLength;
      if (byteCount > maximumBytes) {
        fail(new LocalSessionHttpError(413, "The request body is too large."));
        return;
      }
      chunks.push(bytes);
    });
    request.once("aborted", () => {
      fail(new LocalSessionHttpError(400, "The request body was aborted."));
    });
    request.once("error", () => {
      fail(new LocalSessionHttpError(400, "The request body could not be read."));
    });
    request.once("end", () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks));
    });
  });
  if (declaredLength !== undefined && Number(declaredLength) !== body.byteLength) {
    throw new LocalSessionHttpError(400, "The request body length does not match its header.");
  }
  let parsed: unknown;
  try {
    parsed = parseGrandHallT554StrictJson(body);
  } catch (error) {
    throw new LocalSessionHttpError(400, "The request is not strict UTF-8 JSON.", error);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LocalSessionHttpError(400, "The request must be one JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function setLocalSessionSecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(LOCAL_SESSION_SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
}

export function sendLocalSessionBytes(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: Buffer,
): void {
  setLocalSessionSecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", body.byteLength);
  response.end(body);
}

export function sendLocalSessionText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
): void {
  sendLocalSessionBytes(
    response,
    statusCode,
    contentType,
    Buffer.from(body, "utf8"),
  );
}

export function sendLocalSessionJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  sendLocalSessionText(
    response,
    statusCode,
    "application/json; charset=utf-8",
    `${JSON.stringify(value)}\n`,
  );
}

export function sendLocalSessionError(
  response: ServerResponse,
  error: LocalSessionHttpError,
): void {
  sendLocalSessionJson(response, error.statusCode, { error: error.message });
}

export function configureLocalSessionServer(server: Server): void {
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 1_024;
  server.maxConnections = 32;
}

export function listenLocalSessionServer(server: Server, port: number): Promise<number> {
  if (!Number.isInteger(port) || (port !== 0 && (port < 1_024 || port > 65_535))) {
    throw new TypeError("Local-session port must be 0 or between 1024 and 65535.");
  }
  configureLocalSessionServer(server);
  return new Promise((resolvePort, rejectPort) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      rejectPort(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address() as AddressInfo | null;
      if (address === null || address.address !== LOCAL_SESSION_HOST) {
        rejectPort(new Error("Local-session server did not bind to exact IPv4 loopback."));
        return;
      }
      resolvePort(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: LOCAL_SESSION_HOST, port, exclusive: true });
  });
}

export interface LocalSessionRequestGateOptions {
  readonly maximumConcurrent?: number;
  readonly maximumPerMinute?: number;
  readonly monotonicNowMs?: () => number;
}

export class LocalSessionRequestGate {
  private readonly maximumConcurrent: number;
  private readonly maximumPerMinute: number;
  private readonly monotonicNowMs: () => number;
  private active = 0;
  private readonly arrivals: number[] = [];

  constructor(options: LocalSessionRequestGateOptions = {}) {
    this.maximumConcurrent = options.maximumConcurrent ??
      LOCAL_SESSION_MAX_CONCURRENT_REQUESTS;
    this.maximumPerMinute = options.maximumPerMinute ??
      LOCAL_SESSION_MAX_REQUESTS_PER_MINUTE;
    this.monotonicNowMs = options.monotonicNowMs ?? (() => performance.now());
    if (
      !Number.isSafeInteger(this.maximumConcurrent) ||
      this.maximumConcurrent < 1 ||
      !Number.isSafeInteger(this.maximumPerMinute) ||
      this.maximumPerMinute < 1
    ) {
      throw new TypeError("Local-session request limits must be positive safe integers.");
    }
  }

  enter(): () => void {
    const now = this.monotonicNowMs();
    if (!Number.isFinite(now) || now < 0) {
      throw new LocalSessionHttpError(503, "The request limiter clock is invalid.");
    }
    while ((this.arrivals[0] ?? Number.POSITIVE_INFINITY) <= now - 60_000) {
      this.arrivals.shift();
    }
    if (this.active >= this.maximumConcurrent) {
      throw new LocalSessionHttpError(429, "Too many local-session requests are active.");
    }
    if (this.arrivals.length >= this.maximumPerMinute) {
      throw new LocalSessionHttpError(429, "The local-session request rate is too high.");
    }
    this.arrivals.push(now);
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}

export function validateLocalSessionTtl(ttlMs: number): void {
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < LOCAL_SESSION_MINIMUM_TTL_MS ||
    ttlMs > LOCAL_SESSION_MAXIMUM_TTL_MS
  ) {
    throw new TypeError("Local-session TTL is outside the fixed safe range.");
  }
}

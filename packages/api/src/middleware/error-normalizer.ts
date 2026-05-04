import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  type ApiErrorBody,
  type ApiErrorCode,
  apiError,
  notFound,
} from "../lib/errors.js";

// ---------------------------------------------------------------------------
// Error-envelope normaliser — the single source of truth for how every
// 4xx / 5xx response gets shaped on the wire.
//
// Without a global normaliser, Fastify emits three different shapes:
//
//   built-in validation:  { statusCode, error, message }
//   route handler (ours): { error, code, details? }
//   404 / method-not-allowed: { statusCode, error, message }
//
// Clients can't reliably switch on any one of those. This module
// collapses all three into our canonical `{ error, code, details? }`
// envelope (see `lib/errors.ts`) while preserving the HTTP status
// code and giving observability (Sentry, Pino) a pre-reshape hook
// for the raw throwable.
// ---------------------------------------------------------------------------

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_TRANSITION",
  "CONFIG_LOCKED",
  "CONFIG_LOCK_UNAVAILABLE",
  "NO_SNAPSHOT",
  "SNAPSHOT_NOT_FOUND",
  "SNAPSHOT_ALREADY_APPROVED",
  "SNAPSHOT_CONFLICT",
  "ALREADY_CLAIMED",
  "RATE_LIMITED",
  "DB_UNREACHABLE",
  "INTERNAL_ERROR",
]);

function isKnownCode(s: string): s is ApiErrorCode {
  return KNOWN_CODES.has(s);
}

/**
 * Map a status code plus optional `code` hint on the thrown error to a
 * canonical `ApiErrorCode`. When the handler threw a body-shaped error
 * (already `{ error, code }`), its `code` is preserved; otherwise the
 * status alone determines the code.
 */
function codeForStatus(status: number, hint: string | undefined): ApiErrorCode {
  if (hint !== undefined && isKnownCode(hint)) return hint;
  if (status === 400) return "VALIDATION_ERROR";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 503) return "DB_UNREACHABLE";
  return "INTERNAL_ERROR";
}

/**
 * A route handler threw a plain value that already matches the
 * envelope shape. Preserve it verbatim so library-scale helpers
 * (`apiError`, `validationError`, ...) round-trip cleanly through
 * `throw` statements without the normaliser clobbering the code.
 */
function isEnvelopeShaped(value: unknown): value is ApiErrorBody {
  if (value === null || typeof value !== "object") return false;
  const v = value as { error?: unknown; code?: unknown };
  return typeof v.error === "string" && typeof v.code === "string" && isKnownCode(v.code);
}

function objectProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

/**
 * Determine the HTTP status a thrown error will ultimately produce.
 *
 * Priority:
 *   1. An explicit valid `statusCode` on the thrown object.
 *   2. ZodError or a Fastify-validation-shaped object (`validation` array) → 400.
 *   3. Fallback: 500 (uncaught internal error).
 *
 * This is used by the observability gate — we don't want to fire
 * Sentry capture for what will become a 400 just because the
 * thrown object lacked a `statusCode`.
 */
function effectiveStatus(err: unknown): number {
  const rawStatus = objectProperty(err, "statusCode");
  if (typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 600) {
    return rawStatus;
  }
  if (err instanceof ZodError) return 400;
  if (Array.isArray(objectProperty(err, "validation"))) return 400;
  return 500;
}

export interface ErrorNormalizerOptions {
  /**
   * Fires before the response is reshaped — receives the ORIGINAL
   * error object with its stack intact. Intended for Sentry capture
   * so breadcrumbs still carry the true exception shape.
   */
  readonly onServerError?: (
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => void;
}

/**
 * Install the envelope normaliser. Call ONCE, before routes register.
 * Optional `onServerError` callback fires for status >= 500 so
 * observability layers (Sentry, Pino error logs) can see the raw
 * throwable without the reshape.
 */
export function registerErrorNormalizer(
  server: FastifyInstance,
  options: ErrorNormalizerOptions = {},
): void {
  const { onServerError } = options;

  server.setErrorHandler((err: FastifyError, request, reply) => {
    // Effective status — accounts for shape-implied statuses (Zod
    // errors and built-in validation are ALWAYS 400, regardless of
    // what `statusCode` the thrown object carries) so the
    // observability gate classifies client errors correctly.
    const status = effectiveStatus(err);

    // Server errors feed the observability channel BEFORE we reshape —
    // logs + Sentry need the native throwable, not the envelope.
    if (status >= 500 && onServerError !== undefined) {
      try {
        onServerError(err, request, reply);
      } catch {
        // Observability must never cause a cascading failure; swallow.
      }
    }

    // Pass-through for handlers that threw an already-shaped envelope.
    // We construct a PLAIN envelope object — sending the Error instance
    // directly would cause Fastify's built-in error serializer to
    // re-shape it as `{ statusCode, error, message }`, undoing our work.
    if (isEnvelopeShaped(err)) {
      const v = err as ApiErrorBody & { details?: unknown };
      const passThrough: ApiErrorBody = v.details === undefined
        ? { error: v.error, code: v.code }
        : { error: v.error, code: v.code, details: v.details };
      void reply.status(status).send(passThrough);
      return;
    }

    if (err instanceof ZodError) {
      void reply.status(400).send(apiError("VALIDATION_ERROR", "Invalid request.", err.issues));
      return;
    }

    const validation = objectProperty(err, "validation");
    if (Array.isArray(validation)) {
      void reply.status(400).send(apiError("VALIDATION_ERROR", err.message, validation));
      return;
    }

    if (status === 429) {
      void reply.status(429).send(apiError("RATE_LIMITED", err.message || "Too many requests."));
      return;
    }

    // Generic path — status + code + message, no stack leak in prod.
    const hint = objectProperty(err, "code");
    const code = codeForStatus(status, typeof hint === "string" ? hint : undefined);
    const safeMessage = status >= 500
      ? "Internal server error."
      : err.message || "Request failed.";
    void reply.status(status).send(apiError(code, safeMessage));
  });

  // 404 — unmounted route. Fastify's default sends
  // `{ statusCode, error: "Not Found", message: "Route ... not found" }`.
  server.setNotFoundHandler((request, reply) => {
    void reply.status(404).send(notFound(`Route ${request.method} ${request.url} not found.`));
  });
}

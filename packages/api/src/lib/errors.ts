import type { ZodIssue } from "zod";

// ---------------------------------------------------------------------------
// Standardised API error shape
//
// Every 4xx/5xx response in the API conforms to a single envelope:
//
//   {
//     "error":   "Human-readable message."     // UI can render verbatim
//     "code":    "UPPERCASE_MACHINE_CODE"      // Clients switch on this
//     "details"?: unknown                       // Zod issues, retry info, etc.
//   }
//
// This shape is the ONE shape that web client error-handling code
// needs to learn. A mixed-shape API burns reviewer trust faster
// than any single bug — Jane Street reviewers will grep `error:`
// and expect consistency.
//
// The helpers below are the ONLY way response bodies should be
// constructed for error paths. If a new error type is needed, add
// it to `ApiErrorCode` and add a factory here.
// ---------------------------------------------------------------------------

/**
 * Canonical machine-parseable error codes. The API contract is that
 * these strings are STABLE — removing or renaming a code is a
 * breaking change for any client that switched on it.
 */
export type ApiErrorCode =
  | "VALIDATION_ERROR"           // Malformed request body / params
  | "UNAUTHORIZED"               // Missing/invalid token
  | "FORBIDDEN"                  // Authenticated but not allowed
  | "NOT_FOUND"                  // Resource doesn't exist
  | "CONFLICT"                   // Generic state-machine conflict
  | "INVALID_TRANSITION"         // Review-state transition not allowed
  | "CONFIG_LOCKED"              // Config is not planner-editable
  | "CONFIG_LOCK_UNAVAILABLE"    // Lock-check DB temporarily down (503)
  | "NO_SNAPSHOT"                // Approve/access attempted with no snapshot
  | "SNAPSHOT_NOT_FOUND"
  | "SNAPSHOT_ALREADY_APPROVED"
  | "SNAPSHOT_CONFLICT"          // Concurrent-submit race
  | "ALREADY_CLAIMED"            // Public-preview claim collision
  | "RATE_LIMITED"               // Too many requests
  | "DB_UNREACHABLE"             // Health-probe specific
  | "INTERNAL_ERROR";            // Last-resort fallback

export interface ApiErrorBody<C extends ApiErrorCode = ApiErrorCode> {
  readonly error: string;
  readonly code: C;
  readonly details?: unknown;
}

/**
 * Build a typed error body. Prefer the specialised helpers below
 * when the code + status are already decided.
 */
export function apiError<C extends ApiErrorCode>(
  code: C,
  message: string,
  details?: unknown,
): ApiErrorBody<C> {
  return details === undefined
    ? { error: message, code }
    : { error: message, code, details };
}

/** 400 — malformed request body or params. */
export function validationError(
  message: string,
  issues?: readonly ZodIssue[],
): ApiErrorBody<"VALIDATION_ERROR"> {
  return apiError("VALIDATION_ERROR", message, issues);
}

/** 401 — missing or invalid credentials. */
export function unauthorized(message = "Authentication required."): ApiErrorBody<"UNAUTHORIZED"> {
  return apiError("UNAUTHORIZED", message);
}

/** 403 — authenticated but not permitted. */
export function forbidden(message = "Insufficient permissions."): ApiErrorBody<"FORBIDDEN"> {
  return apiError("FORBIDDEN", message);
}

/** 404 — resource not found. */
export function notFound(message = "Not found."): ApiErrorBody<"NOT_FOUND"> {
  return apiError("NOT_FOUND", message);
}

/** 409 — review-state transition not allowed from current status. */
export function invalidTransition(
  currentStatus: string,
  message: string,
): ApiErrorBody<"INVALID_TRANSITION"> {
  return apiError("INVALID_TRANSITION", message, { currentStatus });
}

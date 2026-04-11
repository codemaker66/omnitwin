import type { ZodType } from "zod";
import { API_URL } from "../config/env.js";

// ---------------------------------------------------------------------------
// Typed API error
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, message: string, code: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Token retrieval — uses Clerk's getToken exposed via window global
//
// Exported because non-JSON endpoints (PDF download, file streams) bypass
// the typed `request<T>()` helper and need to attach the auth header
// themselves. They MUST go through this function — never read from
// localStorage directly. The legacy `omnitwin_access_token` localStorage
// key is dead and is always null for Clerk users; using it silently 401s.
// ---------------------------------------------------------------------------

export async function getAuthToken(): Promise<string | null> {
  const getToken = (window as unknown as Record<string, unknown>)["__clerk_getToken"] as
    (() => Promise<string | null>) | undefined;
  if (getToken === undefined) return null;
  try {
    return await getToken();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
//
// Punch list #8: every call site previously cast the response with `as T`,
// trusting whatever JSON the server sent. If the API contract drifted (a
// renamed field, a missing column, a string-where-a-number-was-expected),
// the app would crash deep in component code with no useful error.
//
// The fix: every call site can now pass a Zod schema. When a schema is
// present, the response is parsed and a `RESPONSE_VALIDATION_ERROR` is
// thrown if it doesn't match. When no schema is present, the legacy
// unsafe-cast path runs (with a dev-mode warning so we can track which
// modules still need migration). New code MUST use schemas.
// ---------------------------------------------------------------------------

interface RequestOptions {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly skipAuth?: boolean;
}

async function request<T>(opts: RequestOptions, schema?: ZodType<T>): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (opts.skipAuth !== true) {
    const token = await getAuthToken();
    if (token !== null) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const fetchOpts: RequestInit = {
    method: opts.method,
    headers,
  };

  if (opts.body !== undefined) {
    fetchOpts.body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${opts.path}`, fetchOpts);
  } catch (err) {
    throw new ApiError(0, "Network error — check your connection", "NETWORK_ERROR", err);
  }

  // 401 — Clerk handles session refresh automatically. Just report the error.
  if (res.status === 401 && opts.skipAuth !== true) {
    throw new ApiError(401, "Session expired — please sign in again", "UNAUTHORIZED");
  }

  // 204 No Content — only used by delete<void>(). Asserting to T here is
  // intentional and only safe when T is void/undefined; api.delete is the
  // single caller and is typed accordingly.
  if (res.status === 204) return undefined as T;

  const json = (await res.json()) as { data?: unknown; error?: string; code?: string; details?: unknown };

  if (!res.ok) {
    throw new ApiError(
      res.status,
      json.error ?? "Unknown error",
      json.code ?? "UNKNOWN",
      json.details,
    );
  }

  // CRUD endpoints use { data } envelope; some endpoints return raw JSON.
  const payload = json.data !== undefined ? json.data : json;

  if (schema !== undefined) {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new ApiError(
        0,
        `Server returned an unexpected response shape for ${opts.method} ${opts.path}`,
        "RESPONSE_VALIDATION_ERROR",
        result.error.issues,
      );
    }
    return result.data;
  }

  // Legacy unvalidated path — emits a warning in dev mode so migration
  // progress is visible. Production stays silent to avoid console spam.
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[api] ${opts.method} ${opts.path} called without a Zod schema — response is unvalidated`);
  }
  return payload as T;
}

// ---------------------------------------------------------------------------
// Typed convenience methods
//
// Each method takes an optional `schema` as the LAST argument. New code
// must pass a schema. Old call sites without one continue to work (with
// the dev-mode warning) until they are migrated.
// ---------------------------------------------------------------------------

export const api = {
  get: <T>(path: string, schema?: ZodType<T>): Promise<T> =>
    request<T>({ method: "GET", path }, schema),

  post: <T>(path: string, body?: unknown, skipAuth?: boolean, schema?: ZodType<T>): Promise<T> =>
    request<T>({ method: "POST", path, body, skipAuth }, schema),

  patch: <T>(path: string, body: unknown, schema?: ZodType<T>): Promise<T> =>
    request<T>({ method: "PATCH", path, body }, schema),

  delete: <T = void>(path: string): Promise<T> =>
    request<T>({ method: "DELETE", path }),
} as const;

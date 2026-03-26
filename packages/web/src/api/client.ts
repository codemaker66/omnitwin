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
// ---------------------------------------------------------------------------

async function getAuthToken(): Promise<string | null> {
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
// ---------------------------------------------------------------------------

interface RequestOptions {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly skipAuth?: boolean;
}

async function request<T>(opts: RequestOptions): Promise<T> {
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

  if (res.status === 204) return undefined as T;

  const json = (await res.json()) as { data?: T; error?: string; code?: string; details?: unknown };

  if (!res.ok) {
    throw new ApiError(
      res.status,
      json.error ?? "Unknown error",
      json.code ?? "UNKNOWN",
      json.details,
    );
  }

  // CRUD endpoints use { data } envelope
  return (json.data !== undefined ? json.data : json) as T;
}

// ---------------------------------------------------------------------------
// Typed convenience methods
// ---------------------------------------------------------------------------

export const api = {
  get: <T>(path: string): Promise<T> => request<T>({ method: "GET", path }),

  post: <T>(path: string, body?: unknown, skipAuth?: boolean): Promise<T> =>
    request<T>({ method: "POST", path, body, skipAuth }),

  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>({ method: "PATCH", path, body }),

  delete: <T = void>(path: string): Promise<T> => request<T>({ method: "DELETE", path }),
} as const;

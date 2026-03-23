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
// Token refresh mutex — prevents thundering herd of refresh calls
// ---------------------------------------------------------------------------

let refreshPromise: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  const stored = localStorage.getItem("omnitwin_refresh_token");
  if (stored === null) return false;

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: stored }),
    });

    if (!res.ok) return false;

    const body = (await res.json()) as {
      data: { accessToken: string; refreshToken: string };
    };
    localStorage.setItem("omnitwin_access_token", body.data.accessToken);
    localStorage.setItem("omnitwin_refresh_token", body.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

function refreshTokensOnce(): Promise<boolean> {
  if (refreshPromise !== null) return refreshPromise;
  refreshPromise = attemptRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
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
    const token = localStorage.getItem("omnitwin_access_token");
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

  // 401 — try refresh once, then retry
  if (res.status === 401 && opts.skipAuth !== true) {
    const refreshed = await refreshTokensOnce();
    if (refreshed) {
      // Retry with new token
      const newToken = localStorage.getItem("omnitwin_access_token");
      if (newToken !== null) {
        headers["Authorization"] = `Bearer ${newToken}`;
      }
      const retryRes = await fetch(`${API_URL}${opts.path}`, { ...fetchOpts, headers });
      if (retryRes.ok) {
        if (retryRes.status === 204) return undefined as T;
        const retryBody = (await retryRes.json()) as { data: T };
        return retryBody.data;
      }
    }
    // Refresh failed — clear auth
    localStorage.removeItem("omnitwin_access_token");
    localStorage.removeItem("omnitwin_refresh_token");
    localStorage.removeItem("omnitwin_user");
    window.location.href = "/login";
    throw new ApiError(401, "Session expired", "UNAUTHORIZED");
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

  return json.data as T;
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

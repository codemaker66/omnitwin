import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// API client tests — Clerk-based token retrieval
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Must import AFTER stubbing fetch
const { api, ApiError } = await import("../api/client.js");

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  // Clear Clerk getToken mock
  delete (window as unknown as Record<string, unknown>)["__clerk_getToken"];
});

describe("api.get", () => {
  it("attaches Authorization header when Clerk token available", async () => {
    (window as unknown as Record<string, unknown>)["__clerk_getToken"] = () => Promise.resolve("clerk-session-token");
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: 1 } }));

    await api.get("/test");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer clerk-session-token");
  });

  it("omits Authorization header when no Clerk session", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: 1 } }));

    await api.get("/test");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("omits Authorization header when getToken returns null", async () => {
    (window as unknown as Record<string, unknown>)["__clerk_getToken"] = () => Promise.resolve(null);
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: 1 } }));

    await api.get("/test");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("unwraps { data } envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { name: "Test" } }));

    const result = await api.get<{ name: string }>("/test");
    expect(result).toEqual({ name: "Test" });
  });
});

describe("error handling", () => {
  it("throws ApiError on 400", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Bad input", code: "VALIDATION_ERROR" }, 400));

    await expect(api.get("/test")).rejects.toThrow(ApiError);
    try {
      await api.get("/test");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as InstanceType<typeof ApiError>;
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toBe("Bad input");
      expect(apiErr.code).toBe("VALIDATION_ERROR");
    }
  });

  it("throws ApiError on 500", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Server error", code: "INTERNAL" }, 500));

    await expect(api.get("/test")).rejects.toThrow(ApiError);
  });

  it("throws ApiError on network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(api.get("/test")).rejects.toThrow(ApiError);
    try {
      await api.get("/test");
    } catch (err) {
      const apiErr = err as InstanceType<typeof ApiError>;
      expect(apiErr.status).toBe(0);
      expect(apiErr.code).toBe("NETWORK_ERROR");
    }
  });
});

describe("401 handling", () => {
  it("throws ApiError on 401 (Clerk handles session refresh)", async () => {
    (window as unknown as Record<string, unknown>)["__clerk_getToken"] = () => Promise.resolve("expired-token");
    fetchMock.mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401));

    await expect(api.get("/test")).rejects.toThrow(ApiError);
    try {
      await api.get("/test");
    } catch (err) {
      const apiErr = err as InstanceType<typeof ApiError>;
      expect(apiErr.status).toBe(401);
      expect(apiErr.code).toBe("UNAUTHORIZED");
    }
  });
});

describe("api.post", () => {
  it("sends JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { ok: true } }));

    await api.post("/test", { email: "a@b.com" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ email: "a@b.com" }));
  });

  it("supports skipAuth for public endpoints", async () => {
    (window as unknown as Record<string, unknown>)["__clerk_getToken"] = () => Promise.resolve("my-token");
    fetchMock.mockResolvedValue(jsonResponse({ data: { ok: true } }));

    await api.post("/public/test", { email: "a" }, true);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });
});

describe("api.delete", () => {
  it("handles 204 No Content", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, headers: new Headers() } as Response);

    const result = await api.delete("/test/1");
    expect(result).toBeUndefined();
  });
});

describe("graceful getToken errors", () => {
  it("continues without auth if getToken throws", async () => {
    (window as unknown as Record<string, unknown>)["__clerk_getToken"] = () => Promise.reject(new Error("Clerk error"));
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: 1 } }));

    const result = await api.get<{ id: number }>("/test");
    expect(result).toEqual({ id: 1 });
  });
});

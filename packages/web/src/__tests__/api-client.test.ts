import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// API client tests — Clerk-based token retrieval via auth-bridge module
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Must import AFTER stubbing fetch
const { api, ApiError } = await import("../api/client.js");
const { setTokenGetter, _resetTokenGetterForTests } = await import("../api/auth-bridge.js");

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
  // Reset auth-bridge module state between tests so leftover token
  // getters from prior tests don't bleed into the next case.
  _resetTokenGetterForTests();
});

describe("api.get", () => {
  it("attaches Authorization header when Clerk token available", async () => {
    setTokenGetter(() => Promise.resolve("clerk-session-token"));
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
    setTokenGetter(() => Promise.resolve(null));
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
    setTokenGetter(() => Promise.resolve("expired-token"));
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
    setTokenGetter(() => Promise.resolve("my-token"));
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
    setTokenGetter(() => Promise.reject(new Error("Clerk error")));
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: 1 } }));

    const result = await api.get<{ id: number }>("/test");
    expect(result).toEqual({ id: 1 });
  });
});

// ---------------------------------------------------------------------------
// Schema validation — punch list #8
//
// Every api.get/post/patch can now take a Zod schema. When present, the
// response is parsed and a RESPONSE_VALIDATION_ERROR is thrown if it
// doesn't match. When absent, the legacy unsafe-cast path runs (and
// emits a dev-mode console.warn so migration progress is visible).
//
// These tests pin the contract: valid responses parse, malformed
// responses throw with a clear error code, and the legacy path still
// works for unmigrated modules.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth bridge module — punch list #9
//
// Pins the contract that the API client uses the typed auth-bridge
// module, NOT a window-global mutation. Reads the actual source files
// and asserts no production code mutates window.__clerk_getToken.
// ---------------------------------------------------------------------------

describe("auth bridge — no window globals", () => {
  it("api/client.ts does not read from window.__clerk_getToken (only comments)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve("src/api/client.ts"),
      "utf-8",
    );
    // Strip comments before checking — comments can mention the legacy
    // pattern for context (they should, in fact, document what was removed).
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toContain("__clerk_getToken");
    expect(codeOnly).not.toMatch(/window\s+as\s+unknown/);
    // Positive: uses the typed bridge module
    expect(codeOnly).toContain("getTokenGetter");
  });

  it("ClerkAuthBridge does not mutate window (only comments)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve("src/components/auth/ClerkAuthBridge.tsx"),
      "utf-8",
    );
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toContain("__clerk_getToken");
    expect(codeOnly).not.toMatch(/window\s+as\s+unknown/);
    expect(codeOnly).toContain("setTokenGetter");
  });

  it("setTokenGetter / getTokenGetter round-trip", async () => {
    const { setTokenGetter, getTokenGetter, _resetTokenGetterForTests } = await import("../api/auth-bridge.js");
    _resetTokenGetterForTests();
    expect(getTokenGetter()).toBeNull();

    const fakeGetter = (): Promise<string | null> => Promise.resolve("token-123");
    setTokenGetter(fakeGetter);
    expect(getTokenGetter()).toBe(fakeGetter);

    setTokenGetter(null);
    expect(getTokenGetter()).toBeNull();
  });
});

describe("schema validation", () => {
  it("valid response parses through the schema and returns typed data", async () => {
    const { z } = await import("zod");
    const PetSchema = z.object({ name: z.string(), age: z.number() });

    fetchMock.mockResolvedValue(jsonResponse({ data: { name: "Rex", age: 5 } }));

    const result = await api.get("/pets/rex", PetSchema);
    // Type assertion: TypeScript should infer { name: string; age: number }
    expect(result.name).toBe("Rex");
    expect(result.age).toBe(5);
  });

  it("malformed response throws ApiError(RESPONSE_VALIDATION_ERROR)", async () => {
    const { z } = await import("zod");
    const PetSchema = z.object({ name: z.string(), age: z.number() });

    // Server returns age as a string instead of number — exactly the kind
    // of contract drift that previously crashed components silently.
    fetchMock.mockResolvedValue(jsonResponse({ data: { name: "Rex", age: "five" } }));

    await expect(api.get("/pets/rex", PetSchema)).rejects.toThrow(ApiError);
    try {
      await api.get("/pets/rex", PetSchema);
    } catch (err) {
      const apiErr = err as InstanceType<typeof ApiError>;
      expect(apiErr.code).toBe("RESPONSE_VALIDATION_ERROR");
      // The validation issues are surfaced for debugging
      expect(apiErr.details).toBeDefined();
      expect(Array.isArray(apiErr.details)).toBe(true);
    }
  });

  it("missing required field throws RESPONSE_VALIDATION_ERROR", async () => {
    const { z } = await import("zod");
    const PetSchema = z.object({ name: z.string(), age: z.number() });

    fetchMock.mockResolvedValue(jsonResponse({ data: { name: "Rex" } }));

    await expect(api.get("/pets/rex", PetSchema)).rejects.toThrow(ApiError);
    try {
      await api.get("/pets/rex", PetSchema);
    } catch (err) {
      const apiErr = err as InstanceType<typeof ApiError>;
      expect(apiErr.code).toBe("RESPONSE_VALIDATION_ERROR");
    }
  });

  it("array schemas validate every element", async () => {
    const { z } = await import("zod");
    const PetListSchema = z.array(z.object({ name: z.string() }));

    fetchMock.mockResolvedValue(jsonResponse({ data: [
      { name: "Rex" },
      { name: 42 }, // wrong type — should fail
    ] }));

    await expect(api.get("/pets", PetListSchema)).rejects.toThrow(ApiError);
  });

  it("legacy path without schema still works (back-compat)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { whatever: "shape" } }));

    // No schema passed — falls through to the unsafe cast path
    const result = await api.get<{ whatever: string }>("/legacy");
    expect(result).toEqual({ whatever: "shape" });
  });

  it("schema validates after the {data} envelope is unwrapped", async () => {
    const { z } = await import("zod");
    const PetSchema = z.object({ name: z.string() });

    // The data envelope is unwrapped first, then PetSchema validates
    // the inner shape (NOT the envelope itself)
    fetchMock.mockResolvedValue(jsonResponse({ data: { name: "Rex" } }));

    const result = await api.get("/pets/rex", PetSchema);
    expect(result).toEqual({ name: "Rex" });
  });

  it("schema works with raw JSON responses (no data envelope)", async () => {
    const { z } = await import("zod");
    const PetSchema = z.object({ name: z.string() });

    // Some endpoints return the body directly without a data wrapper
    fetchMock.mockResolvedValue(jsonResponse({ name: "Rex" }));

    const result = await api.get("/pets/rex", PetSchema);
    expect(result).toEqual({ name: "Rex" });
  });
});

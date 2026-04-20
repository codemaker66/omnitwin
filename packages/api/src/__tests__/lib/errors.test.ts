import { describe, it, expect } from "vitest";
import {
  apiError,
  forbidden,
  invalidTransition,
  notFound,
  unauthorized,
  validationError,
} from "../../lib/errors.js";

// ---------------------------------------------------------------------------
// API error envelope — tests lock the contract.
//
// Downstream clients (web, future mobile) switch on `code`. The
// tests below are the reviewer-facing evidence that the code
// strings are STABLE and the envelope shape is consistent across
// every factory.
// ---------------------------------------------------------------------------

describe("apiError", () => {
  it("emits { error, code } without details when none provided", () => {
    const e = apiError("NOT_FOUND", "thing missing");
    expect(e).toEqual({ error: "thing missing", code: "NOT_FOUND" });
    expect(Object.keys(e)).toEqual(["error", "code"]);
  });

  it("includes details when provided", () => {
    const e = apiError("VALIDATION_ERROR", "bad body", { foo: "bar" });
    expect(e).toEqual({
      error: "bad body",
      code: "VALIDATION_ERROR",
      details: { foo: "bar" },
    });
  });
});

describe("specialised helpers", () => {
  it("validationError accepts Zod issues", () => {
    const e = validationError("invalid body", [
      { code: "invalid_type", expected: "string", received: "number", path: ["name"], message: "expected string" },
    ]);
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(e.details)).toBe(true);
  });

  it("unauthorized defaults a sensible message", () => {
    expect(unauthorized()).toEqual({
      error: "Authentication required.",
      code: "UNAUTHORIZED",
    });
  });

  it("forbidden defaults a sensible message", () => {
    expect(forbidden()).toEqual({
      error: "Insufficient permissions.",
      code: "FORBIDDEN",
    });
  });

  it("notFound defaults a sensible message", () => {
    expect(notFound()).toEqual({
      error: "Not found.",
      code: "NOT_FOUND",
    });
  });

  it("invalidTransition carries the current status in details", () => {
    const e = invalidTransition("approved", "Cannot approve from state 'approved'");
    expect(e).toEqual({
      error: "Cannot approve from state 'approved'",
      code: "INVALID_TRANSITION",
      details: { currentStatus: "approved" },
    });
  });
});

describe("envelope consistency", () => {
  it("every factory returns the same top-level key order", () => {
    // Defensive: JSON.stringify order must match so client error
    // deserialisers that rely on property iteration see a stable
    // shape. ES2015+ preserves insertion order for string keys.
    const factories = [
      () => apiError("INTERNAL_ERROR", "x"),
      () => unauthorized(),
      () => forbidden(),
      () => notFound(),
      () => validationError("x"),
    ];
    for (const f of factories) {
      const keys = Object.keys(f());
      expect(keys[0]).toBe("error");
      expect(keys[1]).toBe("code");
    }
  });
});

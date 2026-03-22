import { describe, it, expect } from "vitest";
import { validateEnv, EnvSchema } from "../env.js";

// ---------------------------------------------------------------------------
// env.ts — Zod environment validation tests
// ---------------------------------------------------------------------------

describe("validateEnv", () => {
  it("accepts valid environment", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
      JWT_SECRET: "a-very-long-jwt-secret-that-is-at-least-32-chars",
      PORT: "3001",
    });
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@host/db");
    expect(env.JWT_SECRET).toBe("a-very-long-jwt-secret-that-is-at-least-32-chars");
    expect(env.PORT).toBe(3001);
  });

  it("uses default PORT when not provided", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
      JWT_SECRET: "a-very-long-jwt-secret-that-is-at-least-32-chars",
    });
    expect(env.PORT).toBe(3001);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => validateEnv({
      JWT_SECRET: "a-very-long-jwt-secret-that-is-at-least-32-chars",
    })).toThrow("DATABASE_URL");
  });

  it("throws when JWT_SECRET is missing", () => {
    expect(() => validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
    })).toThrow("JWT_SECRET");
  });

  it("throws when JWT_SECRET is too short", () => {
    expect(() => validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
      JWT_SECRET: "short",
    })).toThrow("at least 32");
  });

  it("throws when DATABASE_URL is empty string", () => {
    expect(() => validateEnv({
      DATABASE_URL: "",
      JWT_SECRET: "a-very-long-jwt-secret-that-is-at-least-32-chars",
    })).toThrow("DATABASE_URL");
  });

  it("coerces PORT from string to number", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
      JWT_SECRET: "a-very-long-jwt-secret-that-is-at-least-32-chars",
      PORT: "8080",
    });
    expect(env.PORT).toBe(8080);
  });
});

describe("EnvSchema", () => {
  it("is a valid Zod schema", () => {
    expect(typeof EnvSchema.safeParse).toBe("function");
  });
});

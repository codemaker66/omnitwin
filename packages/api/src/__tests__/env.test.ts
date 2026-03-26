import { describe, it, expect } from "vitest";
import { validateEnv, EnvSchema } from "../env.js";

// ---------------------------------------------------------------------------
// env.ts — Zod environment validation tests
// ---------------------------------------------------------------------------

describe("validateEnv", () => {
  it("accepts valid environment", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
      PORT: "3001",
    });
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@host/db");
    expect(env.PORT).toBe(3001);
  });

  it("uses default PORT when not provided", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
    });
    expect(env.PORT).toBe(3001);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => validateEnv({})).toThrow("DATABASE_URL");
  });

  it("throws when DATABASE_URL is empty string", () => {
    expect(() => validateEnv({
      DATABASE_URL: "",
    })).toThrow("DATABASE_URL");
  });

  it("coerces PORT from string to number", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
      PORT: "8080",
    });
    expect(env.PORT).toBe(8080);
  });

  it("accepts optional Clerk keys", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
      CLERK_PUBLISHABLE_KEY: "pk_test_abc",
      CLERK_SECRET_KEY: "sk_test_xyz",
    });
    expect(env.CLERK_PUBLISHABLE_KEY).toBe("pk_test_abc");
    expect(env.CLERK_SECRET_KEY).toBe("sk_test_xyz");
  });

  it("works without Clerk keys (keyless mode)", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
    });
    expect(env.CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
  });
});

describe("EnvSchema", () => {
  it("is a valid Zod schema", () => {
    expect(typeof EnvSchema.safeParse).toBe("function");
  });
});

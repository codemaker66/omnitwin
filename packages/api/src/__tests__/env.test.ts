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

// ---------------------------------------------------------------------------
// Production hard-fail — punch list #5
//
// In NODE_ENV=production, Clerk credentials become required. The previous
// behavior was a runtime warning at the webhook handler that silently
// fell through to accepting unsigned events. These tests pin the new
// startup-fail-fast contract.
// ---------------------------------------------------------------------------

describe("production environment validation", () => {
  const validProdBase = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pass@host/db",
    CLERK_SECRET_KEY: "sk_live_xyz",
    CLERK_WEBHOOK_SECRET: "whsec_abc",
    FRONTEND_URL: "https://app.omnitwin.com",
  };

  it("accepts a fully-configured production environment", () => {
    expect(() => validateEnv(validProdBase)).not.toThrow();
    const env = validateEnv(validProdBase);
    expect(env.NODE_ENV).toBe("production");
  });

  it("REJECTS production without CLERK_WEBHOOK_SECRET", () => {
    const { CLERK_WEBHOOK_SECRET: _, ...withoutWebhook } = validProdBase;
    expect(() => validateEnv(withoutWebhook)).toThrow("CLERK_WEBHOOK_SECRET");
  });

  it("REJECTS production with empty CLERK_WEBHOOK_SECRET", () => {
    expect(() => validateEnv({
      ...validProdBase,
      CLERK_WEBHOOK_SECRET: "",
    })).toThrow("CLERK_WEBHOOK_SECRET");
  });

  it("REJECTS production without CLERK_SECRET_KEY", () => {
    const { CLERK_SECRET_KEY: _, ...withoutSecret } = validProdBase;
    expect(() => validateEnv(withoutSecret)).toThrow("CLERK_SECRET_KEY");
  });

  it("REJECTS production with empty CLERK_SECRET_KEY", () => {
    expect(() => validateEnv({
      ...validProdBase,
      CLERK_SECRET_KEY: "",
    })).toThrow("CLERK_SECRET_KEY");
  });

  it("REJECTS production without FRONTEND_URL", () => {
    const { FRONTEND_URL: _, ...withoutFrontend } = validProdBase;
    expect(() => validateEnv(withoutFrontend)).toThrow("FRONTEND_URL");
  });

  it("REJECTS incomplete R2 config (some but not all fields)", () => {
    expect(() => validateEnv({
      ...validProdBase,
      R2_ACCOUNT_ID: "acct",
      R2_BUCKET_NAME: "bucket",
      // Missing R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY
    })).toThrow("R2 configuration is incomplete");
  });

  it("accepts R2 fully configured", () => {
    expect(() => validateEnv({
      ...validProdBase,
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "bucket",
      R2_PUBLIC_URL: "https://cdn.example.com",
    })).not.toThrow();
  });

  // F29: R2_PUBLIC_URL must be included in the cohesion check — previously
  // only 4 fields were checked, so R2_PUBLIC_URL could be missing and the
  // error would only appear at request time rather than startup.
  it("REJECTS R2 config missing R2_PUBLIC_URL (F29)", () => {
    expect(() => validateEnv({
      ...validProdBase,
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "bucket",
      // R2_PUBLIC_URL deliberately omitted
    })).toThrow("R2 configuration is incomplete");
  });

  it("REJECTS R2_PUBLIC_URL alone (partial R2 config)", () => {
    expect(() => validateEnv({
      ...validProdBase,
      R2_PUBLIC_URL: "https://cdn.example.com",
    })).toThrow("R2 configuration is incomplete");
  });

  it("error message names production explicitly (diligence marker)", () => {
    // Naming "production" in the error makes the failure mode obvious
    // to whoever sees the boot crash log.
    const { CLERK_WEBHOOK_SECRET: _, ...withoutWebhook } = validProdBase;
    try {
      validateEnv(withoutWebhook);
      expect.unreachable("validation should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      expect(msg).toContain("production");
    }
  });
});

describe("non-production environments are permissive", () => {
  it("development boots without Clerk credentials", () => {
    expect(() => validateEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:pass@host/db",
    })).not.toThrow();
  });

  it("test boots without Clerk credentials", () => {
    expect(() => validateEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@host/db",
    })).not.toThrow();
  });

  it("default NODE_ENV is development (no Clerk required)", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
    });
    expect(env.NODE_ENV).toBe("development");
  });
});

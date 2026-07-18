import { describe, it, expect } from "vitest";
import { validateEnv, EnvSchema } from "../env.js";

// ---------------------------------------------------------------------------
// env.ts — Zod environment validation tests
// ---------------------------------------------------------------------------

function withoutVitest<T>(fn: () => T): T {
  const original = process.env["VITEST"];
  delete process.env["VITEST"];
  try {
    return fn();
  } finally {
    if (original !== undefined) {
      process.env["VITEST"] = original;
    }
  }
}

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
    PUBLIC_API_ORIGIN: "https://api.omnitwin.com",
    RUNTIME_PROFILE_R2_ACCOUNT_ID: "runtime-account",
    RUNTIME_PROFILE_R2_ACCESS_KEY_ID: "runtime-access-key",
    RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY: "runtime-secret-key",
    RUNTIME_PROFILE_R2_PRIVATE_BUCKET: "runtime-profiles-private",
  };

  it("accepts a fully-configured production environment", () => {
    expect(() => {
      withoutVitest(() => validateEnv(validProdBase));
    }).not.toThrow();
    const env = withoutVitest(() => validateEnv(validProdBase));
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

  it("REJECTS production without a trusted PUBLIC_API_ORIGIN", () => {
    const { PUBLIC_API_ORIGIN: _, ...withoutPublicApiOrigin } = validProdBase;
    expect(() => withoutVitest(() => validateEnv(withoutPublicApiOrigin)))
      .toThrow("PUBLIC_API_ORIGIN");
  });

  it("REJECTS a public API origin with credentials, path, query, fragment, or HTTP", () => {
    for (const origin of [
      "http://api.omnitwin.com",
      "https://user:pass@api.omnitwin.com",
      "https://api.omnitwin.com/path",
      "https://api.omnitwin.com?tenant=wrong",
      "https://api.omnitwin.com#fragment",
    ]) {
      expect(() => withoutVitest(() => validateEnv({
        ...validProdBase,
        PUBLIC_API_ORIGIN: origin,
      }))).toThrow("clean HTTPS origin");
    }
  });

  it("REJECTS production without the private runtime-profile R2 connection", () => {
    const {
      RUNTIME_PROFILE_R2_ACCOUNT_ID: _account,
      RUNTIME_PROFILE_R2_ACCESS_KEY_ID: _accessKey,
      RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY: _secretKey,
      RUNTIME_PROFILE_R2_PRIVATE_BUCKET: _bucket,
      ...withoutRuntimeProfileR2
    } = validProdBase;

    expect(() => withoutVitest(() => validateEnv(withoutRuntimeProfileR2)))
      .toThrow("RUNTIME_PROFILE_R2_ACCOUNT_ID is required in production");
  });

  it("REJECTS partial runtime-profile R2 configuration", () => {
    expect(() => validateEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:pass@host/db",
      RUNTIME_PROFILE_R2_ACCOUNT_ID: "runtime-account",
      RUNTIME_PROFILE_R2_PRIVATE_BUCKET: "runtime-profiles-private",
    })).toThrow("Runtime-profile R2 configuration is incomplete");
  });

  it("accepts a complete private runtime-profile R2 connection without a public URL", () => {
    const env = withoutVitest(() => validateEnv(validProdBase));
    expect(env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET).toBe("runtime-profiles-private");
    expect(Object.keys(env)).not.toContain("RUNTIME_PROFILE_R2_PUBLIC_URL");
  });

  it("REJECTS a runtime-profile bucket shared with upload or Foundry storage", () => {
    for (const collision of [
      {
        R2_ACCOUNT_ID: "upload-account",
        R2_ACCESS_KEY_ID: "upload-key",
        R2_SECRET_ACCESS_KEY: "upload-secret",
        R2_BUCKET_NAME: "runtime-profiles-private",
        R2_PUBLIC_URL: "https://uploads.example.com",
      },
      {
        FOUNDRY_R2_ACCOUNT_ID: "foundry-account",
        FOUNDRY_R2_ACCESS_KEY_ID: "foundry-key",
        FOUNDRY_R2_SECRET_ACCESS_KEY: "foundry-secret",
        FOUNDRY_R2_CANDIDATE_BUCKET: "runtime-profiles-private",
        FOUNDRY_R2_RELEASE_BUCKET: "foundry-public-releases",
        FOUNDRY_R2_PUBLIC_URL: "https://releases.example.com",
      },
      {
        FOUNDRY_R2_ACCOUNT_ID: "foundry-account",
        FOUNDRY_R2_ACCESS_KEY_ID: "foundry-key",
        FOUNDRY_R2_SECRET_ACCESS_KEY: "foundry-secret",
        FOUNDRY_R2_CANDIDATE_BUCKET: "foundry-private-candidates",
        FOUNDRY_R2_RELEASE_BUCKET: "runtime-profiles-private",
        FOUNDRY_R2_PUBLIC_URL: "https://releases.example.com",
      },
    ]) {
      expect(() => withoutVitest(() => validateEnv({
        ...validProdBase,
        ...collision,
      }))).toThrow("dedicated private bucket distinct from the legacy upload and Foundry buckets");
    }
  });

  it("REJECTS production when VITEST is set", () => {
    const original = process.env["VITEST"];
    process.env["VITEST"] = "1";
    try {
      expect(() => validateEnv(validProdBase)).toThrow("VITEST");
    } finally {
      if (original === undefined) {
        delete process.env["VITEST"];
      } else {
        process.env["VITEST"] = original;
      }
    }
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
    expect(() => {
      withoutVitest(() => validateEnv({
        ...validProdBase,
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "key",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET_NAME: "bucket",
        R2_PUBLIC_URL: "https://cdn.example.com",
      }));
    }).not.toThrow();
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

  it("accepts a segregated Reconstruction Foundry bucket configuration", () => {
    const env = withoutVitest(() => validateEnv({
      ...validProdBase,
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "legacy-public-assets",
      R2_PUBLIC_URL: "https://assets.example.com",
      FOUNDRY_R2_ACCOUNT_ID: "acct",
      FOUNDRY_R2_ACCESS_KEY_ID: "foundry-key",
      FOUNDRY_R2_SECRET_ACCESS_KEY: "foundry-secret",
      FOUNDRY_R2_CANDIDATE_BUCKET: "foundry-private-candidates",
      FOUNDRY_R2_RELEASE_BUCKET: "foundry-public-releases",
      FOUNDRY_R2_PUBLIC_URL: "https://releases.example.com",
      FOUNDRY_ED25519_PUBLIC_KEYS_JSON: JSON.stringify({
        "release-key-2026": "MCowBQYDK2VwAyEAVuEDj0tOkhmzbGmKufpMNPvZh0Ak3oHtn8V0ywVmpJU=",
      }),
    }));
    expect(env.FOUNDRY_R2_CANDIDATE_BUCKET).toBe("foundry-private-candidates");
  });

  it("allows Foundry credentials to be isolated from the legacy upload credential", () => {
    expect(() => withoutVitest(() => validateEnv({
      ...validProdBase,
      FOUNDRY_R2_ACCOUNT_ID: "acct",
      FOUNDRY_R2_ACCESS_KEY_ID: "foundry-key",
      FOUNDRY_R2_SECRET_ACCESS_KEY: "foundry-secret",
      FOUNDRY_R2_CANDIDATE_BUCKET: "foundry-private-candidates",
      FOUNDRY_R2_RELEASE_BUCKET: "foundry-public-releases",
      FOUNDRY_R2_PUBLIC_URL: "https://releases.example.com",
    }))).not.toThrow();
  });

  it("REJECTS Foundry config without bucket segregation", () => {
    expect(() => withoutVitest(() => validateEnv({
      ...validProdBase,
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "public-assets",
      R2_PUBLIC_URL: "https://assets.example.com",
      FOUNDRY_R2_ACCOUNT_ID: "acct",
      FOUNDRY_R2_ACCESS_KEY_ID: "foundry-key",
      FOUNDRY_R2_SECRET_ACCESS_KEY: "foundry-secret",
      FOUNDRY_R2_CANDIDATE_BUCKET: "public-assets",
      FOUNDRY_R2_RELEASE_BUCKET: "foundry-public-releases",
      FOUNDRY_R2_PUBLIC_URL: "https://releases.example.com",
    }))).toThrow("dedicated private bucket");

    expect(() => withoutVitest(() => validateEnv({
      ...validProdBase,
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "legacy-public-assets",
      R2_PUBLIC_URL: "https://assets.example.com",
      FOUNDRY_R2_ACCOUNT_ID: "acct",
      FOUNDRY_R2_ACCESS_KEY_ID: "foundry-key",
      FOUNDRY_R2_SECRET_ACCESS_KEY: "foundry-secret",
      FOUNDRY_R2_CANDIDATE_BUCKET: "foundry-private-candidates",
      FOUNDRY_R2_RELEASE_BUCKET: "legacy-public-assets",
      FOUNDRY_R2_PUBLIC_URL: "https://releases.example.com",
    }))).toThrow("dedicated immutable public bucket");
  });

  it("REJECTS partial Foundry config and invalid verification key JSON", () => {
    expect(() => validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
      FOUNDRY_R2_CANDIDATE_BUCKET: "private-candidates",
    })).toThrow("Foundry R2 configuration is incomplete");

    expect(() => validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
      FOUNDRY_ED25519_PUBLIC_KEYS_JSON: "not-json",
    })).toThrow("must contain valid JSON");

    const canonicalSpki = Buffer.from(
      "MCowBQYDK2VwAyEAVuEDj0tOkhmzbGmKufpMNPvZh0Ak3oHtn8V0ywVmpJU=",
      "base64",
    );
    expect(() => validateEnv({
      DATABASE_URL: "postgresql://user:pass@host/db",
      FOUNDRY_ED25519_PUBLIC_KEYS_JSON: JSON.stringify({
        "release-key-2026": Buffer.concat([canonicalSpki, Buffer.from([0])]).toString("base64"),
      }),
    })).toThrow("canonical base64 Ed25519 SPKI DER");
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

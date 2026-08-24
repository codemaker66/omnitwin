import { describe, expect, it } from "vitest";
import {
  assertRequiredProductionEnv,
  getSentrySourceMapUploadConfig,
  resolveWebClerkPublishableKey,
} from "../lib/production-env.js";

const PRODUCTION_API_ORIGIN = "https://api.venviewer.com";
const STAGING_API_ORIGIN = "https://trades-hall-grand-hall-staging.up.railway.app";
const LIVE_CLERK_KEY = `pk_live_${"a".repeat(32)}`;
const STAGING_CLERK_FRONTEND_API = "venviewer-staging.clerk.accounts.dev";
const TEST_CLERK_KEY = `pk_test_${Buffer.from(`${STAGING_CLERK_FRONTEND_API}$`).toString("base64")}`;
const REVIEWED_SHA = "c".repeat(40);

function productionEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    VENVIEWER_WEB_LOCAL_BUILD_CONTEXT: "reviewed-local-only",
    VITE_API_URL: PRODUCTION_API_ORIGIN,
    VITE_CLERK_PUBLISHABLE_KEY: LIVE_CLERK_KEY,
    VITE_DEPLOYMENT_TIER: "production",
    ...overrides,
  };
}

function stagingEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    VENVIEWER_WEB_LOCAL_BUILD_CONTEXT: "reviewed-local-only",
    VENVIEWER_STAGING_EXPECTED_API_ORIGIN: STAGING_API_ORIGIN,
    VENVIEWER_STAGING_EXPECTED_CLERK_FRONTEND_API: STAGING_CLERK_FRONTEND_API,
    VITE_API_URL: STAGING_API_ORIGIN,
    VITE_CLERK_PUBLISHABLE_KEY: TEST_CLERK_KEY,
    VITE_DEPLOYMENT_TIER: "staging",
    ...overrides,
  };
}

function assertBuild(env: Record<string, string | undefined>): void {
  assertRequiredProductionEnv("production", env, "build");
}

describe("Vite deployment environment guard", () => {
  it("requires a clean API origin for every build", () => {
    expect(() => { assertBuild(productionEnv({ VITE_API_URL: undefined })); })
      .toThrow("VITE_API_URL is required");
    for (const invalidOrigin of [
      "http://api.venviewer.com",
      "https://user:password@api.venviewer.com",
      "https://api.venviewer.com/path",
      "https://api.venviewer.com?query=true",
      "https://api.venviewer.com/#fragment",
      "https://api.venviewer.com/",
      " https://api.venviewer.com",
    ]) {
      expect(() => { assertBuild(productionEnv({ VITE_API_URL: invalidOrigin })); })
        .toThrow("canonical HTTPS origin");
    }
  });

  it("pins production builds to the production API origin", () => {
    expect(() => { assertBuild(productionEnv()); }).not.toThrow();
    expect(() => { assertBuild(productionEnv({ VITE_API_URL: STAGING_API_ORIGIN })); })
      .toThrow(`VITE_API_URL=${PRODUCTION_API_ORIGIN}`);
  });

  it("pins staging builds to the independently entered Railway staging origin", () => {
    expect(() => { assertBuild(stagingEnv()); }).not.toThrow();
    expect(() => { assertBuild(stagingEnv({
      VENVIEWER_STAGING_EXPECTED_API_ORIGIN: "https://another-staging.up.railway.app",
    })); }).toThrow("dedicated Railway HTTPS domain");
    expect(() => { assertBuild(stagingEnv({
      VITE_API_URL: "https://example.com",
      VENVIEWER_STAGING_EXPECTED_API_ORIGIN: "https://example.com",
    })); }).toThrow("dedicated Railway HTTPS domain");
    expect(() => { assertBuild(stagingEnv({
      VITE_API_URL: PRODUCTION_API_ORIGIN,
      VENVIEWER_STAGING_EXPECTED_API_ORIGIN: PRODUCTION_API_ORIGIN,
    })); }).toThrow("dedicated Railway HTTPS domain");
  });

  it("requires an explicit local review context outside Vercel", () => {
    expect(() => { assertBuild(productionEnv({
      VENVIEWER_WEB_LOCAL_BUILD_CONTEXT: undefined,
    })); }).toThrow("VENVIEWER_WEB_LOCAL_BUILD_CONTEXT=reviewed-local-only");
    expect(() => { assertBuild(productionEnv({
      VENVIEWER_WEB_LOCAL_BUILD_CONTEXT: "unreviewed",
    })); }).toThrow("VENVIEWER_WEB_LOCAL_BUILD_CONTEXT=reviewed-local-only");
  });

  it("binds Grand Hall staging on Vercel to Preview, the dedicated branch, and a full Git SHA", () => {
    const vercelStaging = stagingEnv({
      VENVIEWER_WEB_LOCAL_BUILD_CONTEXT: undefined,
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_TARGET_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "codex/grand-hall-exact-runtime",
      VERCEL_GIT_COMMIT_SHA: REVIEWED_SHA,
      VENVIEWER_STAGING_REVIEWED_GIT_SHA: REVIEWED_SHA,
    });
    expect(() => { assertBuild(vercelStaging); }).not.toThrow();
    expect(() => { assertBuild({ ...vercelStaging, VERCEL_ENV: "production" }); })
      .toThrow("VERCEL_ENV=preview");
    expect(() => { assertBuild({ ...vercelStaging, VERCEL_TARGET_ENV: "production" }); })
      .toThrow("VERCEL_TARGET_ENV");
    expect(() => { assertBuild({ ...vercelStaging, VERCEL_GIT_COMMIT_REF: "main" }); })
      .toThrow("VERCEL_GIT_COMMIT_REF=codex/grand-hall-exact-runtime");
    expect(() => { assertBuild({ ...vercelStaging, VERCEL_GIT_COMMIT_SHA: "short" }); })
      .toThrow("exact 40-character Git commit SHA");
    expect(() => {
      assertBuild({
        ...vercelStaging,
        VENVIEWER_STAGING_REVIEWED_GIT_SHA: "d".repeat(40),
      });
    }).toThrow("exactly match VERCEL_GIT_COMMIT_SHA");
  });

  it("binds production on Vercel to the production environment", () => {
    const vercelProduction = productionEnv({
      VENVIEWER_WEB_LOCAL_BUILD_CONTEXT: undefined,
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_TARGET_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: REVIEWED_SHA,
    });
    expect(() => { assertBuild(vercelProduction); }).not.toThrow();
    expect(() => { assertBuild({ ...vercelProduction, VERCEL: "0" }); })
      .toThrow("VERCEL=1");
    expect(() => { assertBuild({ ...vercelProduction, VERCEL_ENV: "preview" }); })
      .toThrow("VERCEL_ENV=production");
    expect(() => { assertBuild({
      ...vercelProduction,
      VERCEL_GIT_COMMIT_REF: "codex/grand-hall-exact-runtime",
    }); }).toThrow("Production-tier Vercel builds must not use the dedicated staging branch");
    expect(() => { assertBuild({
      ...vercelProduction,
      VERCEL_GIT_COMMIT_REF: undefined,
    }); }).toThrow("nonempty Git branch metadata");
    expect(() => { assertBuild({
      ...vercelProduction,
      VERCEL_GIT_COMMIT_SHA: undefined,
    }); }).toThrow("exact 40-character Git commit SHA");
  });

  it("guards every Vite build mode and skips only the serve command", () => {
    expect(() => { assertRequiredProductionEnv("staging", {}, "build"); })
      .toThrow("VENVIEWER_WEB_LOCAL_BUILD_CONTEXT");
    expect(() => { assertRequiredProductionEnv("development", {}, "build"); })
      .toThrow("VENVIEWER_WEB_LOCAL_BUILD_CONTEXT");
    expect(() => { assertRequiredProductionEnv("development", {}, "serve"); })
      .not.toThrow();
  });

  it("rejects unknown deployment tiers", () => {
    expect(() => { assertBuild(productionEnv({ VITE_DEPLOYMENT_TIER: "preview" })); })
      .toThrow('must be either "production" or "staging"');
  });

  it("requires a non-placeholder tier-matching Clerk publishable key", () => {
    expect(() => { assertBuild(productionEnv({ VITE_CLERK_PUBLISHABLE_KEY: undefined })); })
      .toThrow("Clerk publishable key");
    expect(() => { assertBuild(productionEnv({ VITE_CLERK_PUBLISHABLE_KEY: TEST_CLERK_KEY })); })
      .toThrow("live Clerk publishable key");
    expect(() => { assertBuild(productionEnv({ VITE_CLERK_PUBLISHABLE_KEY: "pk_live_placeholder" })); })
      .toThrow("non-placeholder");
    expect(() => { assertBuild(stagingEnv({ VITE_CLERK_PUBLISHABLE_KEY: LIVE_CLERK_KEY })); })
      .toThrow("isolated Clerk test publishable key");
  });

  it("binds the staging Clerk key to the recorded isolated instance", () => {
    expect(() => {
      assertBuild(stagingEnv({
        VENVIEWER_STAGING_EXPECTED_CLERK_FRONTEND_API:
          "different-instance.clerk.accounts.dev",
      }));
    }).toThrow("isolated Clerk development Frontend API");
    expect(() => {
      assertBuild(stagingEnv({
        VENVIEWER_STAGING_EXPECTED_CLERK_FRONTEND_API: "clerk.venviewer.com",
      }));
    }).toThrow("isolated Clerk development Frontend API");
  });

  it("accepts public Clerk aliases and prefers the key matching the declared tier", () => {
    expect(() => { assertBuild(productionEnv({
      VITE_CLERK_PUBLISHABLE_KEY: undefined,
      CLERK_PUBLISHABLE_KEY: LIVE_CLERK_KEY,
    })); }).not.toThrow();
    expect(resolveWebClerkPublishableKey({
      VITE_DEPLOYMENT_TIER: "production",
      VITE_CLERK_PUBLISHABLE_KEY: TEST_CLERK_KEY,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: LIVE_CLERK_KEY,
    })).toBe(LIVE_CLERK_KEY);
    expect(resolveWebClerkPublishableKey({
      VITE_DEPLOYMENT_TIER: "staging",
      VITE_CLERK_PUBLISHABLE_KEY: LIVE_CLERK_KEY,
      CLERK_PUBLISHABLE_KEY: TEST_CLERK_KEY,
    })).toBe(TEST_CLERK_KEY);
  });

  it("forbids every telemetry variable in isolated Grand Hall staging", () => {
    for (const key of [
      "SENTRY_AUTH_TOKEN",
      "SENTRY_ORG",
      "SENTRY_PROJECT",
      "SENTRY_RELEASE",
      "VITE_SENTRY_DSN",
      "VITE_SENTRY_ENVIRONMENT",
      "VITE_SENTRY_RELEASE",
      "VITE_SENTRY_TRACES_SAMPLE_RATE",
      "VITE_POSTHOG_KEY",
      "VITE_POSTHOG_HOST",
    ]) {
      expect(() => { assertBuild(stagingEnv({ [key]: "" })); })
        .toThrow("forbids every Sentry/source-map/PostHog variable");
    }
  });

  it("keeps Sentry source-map upload disabled when upload credentials are absent", () => {
    expect(getSentrySourceMapUploadConfig({})).toBeNull();
  });

  it("rejects partial Sentry source-map upload credentials", () => {
    expect(() => { assertBuild(productionEnv({ SENTRY_AUTH_TOKEN: "sntrys_secret" })); })
      .toThrow("Sentry source-map upload requires SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT");
  });

  it("returns the source-map upload config when every upload credential is present", () => {
    expect(getSentrySourceMapUploadConfig({
      SENTRY_AUTH_TOKEN: " sntrys_secret ",
      SENTRY_ORG: " venviewer ",
      SENTRY_PROJECT: " web ",
      VITE_SENTRY_RELEASE: " abc123 ",
    })).toEqual({
      authToken: "sntrys_secret",
      org: "venviewer",
      project: "web",
      release: "abc123",
    });
  });
});

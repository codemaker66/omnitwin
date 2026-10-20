import { describe, expect, it } from "vitest";
import {
  assertRequiredProductionEnv,
  getSentrySourceMapUploadConfig,
  resolveWebClerkPublishableKey,
  PREVIEW_SPLAT_BASE_URL,
  resolveBuildSplatBaseUrl,
  resolveSentryRelease,
} from "../lib/production-env.js";

describe("Vite production environment guard", () => {
  it("requires Clerk publishable key for production builds", () => {
    expect(() => {
      assertRequiredProductionEnv("production", {});
    }).toThrow("Clerk publishable key");
  });

  it("allows production builds when a live Clerk publishable key is present", () => {
    expect(() => {
      assertRequiredProductionEnv("production", {
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_local",
      });
    }).not.toThrow();
  });

  it("allows production builds when the live Clerk publishable key uses the server-side public alias", () => {
    expect(() => {
      assertRequiredProductionEnv("production", {
        CLERK_PUBLISHABLE_KEY: "pk_live_local",
      });
    }).not.toThrow();
  });

  it("selects a live public-key alias over a stale Vite test key", () => {
    expect(resolveWebClerkPublishableKey({
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_stale",
      CLERK_PUBLISHABLE_KEY: "pk_live_current",
    })).toBe("pk_live_current");
  });

  it("rejects Clerk test keys in production builds", () => {
    expect(() => {
      assertRequiredProductionEnv("production", {
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_local",
      });
    }).toThrow("live Clerk publishable key");
  });

  it("does not require production-only env for development mode", () => {
    expect(() => {
      assertRequiredProductionEnv("development", {});
    }).not.toThrow();
  });

  it("keeps Sentry source-map upload disabled when upload credentials are absent", () => {
    expect(getSentrySourceMapUploadConfig({})).toBeNull();
  });

  it("rejects partial Sentry source-map upload credentials in production", () => {
    expect(() => {
      assertRequiredProductionEnv("production", {
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_local",
        SENTRY_AUTH_TOKEN: "sntrys_secret",
      });
    }).toThrow("Sentry source-map upload requires SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT");
  });

  it("returns the source-map upload config when every Sentry upload credential is present", () => {
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

  it("names the commit Vercel built when no explicit Sentry release is set", () => {
    expect(resolveSentryRelease({ VERCEL_GIT_COMMIT_SHA: " 48677b82 " })).toBe("48677b82");
  });

  it("lets an explicit Sentry release win over the Vercel commit", () => {
    expect(resolveSentryRelease({
      VITE_SENTRY_RELEASE: "web@1.2.3",
      SENTRY_RELEASE: "shared@1",
      VERCEL_GIT_COMMIT_SHA: "48677b82",
    })).toBe("web@1.2.3");
    expect(resolveSentryRelease({ SENTRY_RELEASE: " shared@1 ", VERCEL_GIT_COMMIT_SHA: "48677b82" }))
      .toBe("shared@1");
    expect(resolveSentryRelease({ VITE_SENTRY_RELEASE: "   ", VERCEL_GIT_COMMIT_SHA: "48677b82" }))
      .toBe("48677b82");
  });

  it("reports no release outside Vercel when none is set", () => {
    expect(resolveSentryRelease({})).toBeUndefined();
  });

  it("uploads source maps under the same release the browser reports", () => {
    expect(getSentrySourceMapUploadConfig({
      SENTRY_AUTH_TOKEN: "sntrys_secret",
      SENTRY_ORG: "venviewer",
      SENTRY_PROJECT: "venviewer-web",
      VERCEL_GIT_COMMIT_SHA: "48677b82",
    })?.release).toBe("48677b82");
  });
});

describe("where a build reads captured room assets (T-639)", () => {
  it("lets an explicit VITE_SPLAT_BASE_URL win everywhere", () => {
    expect(resolveBuildSplatBaseUrl({ VITE_SPLAT_BASE_URL: "https://cdn.example/splats", VERCEL_ENV: "preview" }))
      .toBe("https://cdn.example/splats");
    expect(resolveBuildSplatBaseUrl({ VITE_SPLAT_BASE_URL: "https://cdn.example/splats", VERCEL_ENV: "production" }))
      .toBe("https://cdn.example/splats");
  });

  it("sends preview deployments to the public R2 bucket, because /splats redirects under the hold", () => {
    expect(resolveBuildSplatBaseUrl({ VERCEL_ENV: "preview" })).toBe(PREVIEW_SPLAT_BASE_URL);
    expect(resolveBuildSplatBaseUrl({ VITE_SPLAT_BASE_URL: "   ", VERCEL_ENV: "preview" })).toBe(PREVIEW_SPLAT_BASE_URL);
  });

  it.each(["production", "development", "", undefined])("keeps a %s build on its own origin", (vercelEnv) => {
    expect(resolveBuildSplatBaseUrl({ VERCEL_ENV: vercelEnv })).toBe("");
  });
});

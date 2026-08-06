import { describe, expect, it } from "vitest";
import {
  assertRequiredProductionEnv,
  getSentrySourceMapUploadConfig,
  resolveWebApiOrigin,
  resolveWebClerkPublishableKey,
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
        VITE_API_URL: "https://api.venviewer.com",
      });
    }).not.toThrow();
  });

  it("allows production builds when the live Clerk publishable key uses the server-side public alias", () => {
    expect(() => {
      assertRequiredProductionEnv("production", {
        CLERK_PUBLISHABLE_KEY: "pk_live_local",
        VITE_API_URL: "https://api.venviewer.com",
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

  it("requires one clean HTTPS API origin for production builds", () => {
    expect(() => {
      assertRequiredProductionEnv("production", {
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_local",
      });
    }).toThrow("VITE_API_URL");

    for (const value of [
      "http://api.venviewer.com",
      "https://user:pass@api.venviewer.com",
      "https://api.venviewer.com/path",
      "https://api.venviewer.com?wrong=1",
      "https://api.venviewer.com#wrong",
    ]) {
      expect(resolveWebApiOrigin({ VITE_API_URL: value })).toBeUndefined();
    }
    expect(resolveWebApiOrigin({
      VITE_API_URL: " https://api.venviewer.com ",
    })).toBe("https://api.venviewer.com");
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
        VITE_API_URL: "https://api.venviewer.com",
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
});

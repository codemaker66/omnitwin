import { describe, expect, it } from "vitest";
import {
  assertRequiredProductionEnv,
  getSentrySourceMapUploadConfig,
} from "../lib/production-env.js";

describe("Vite production environment guard", () => {
  it("requires Clerk publishable key for production builds", () => {
    expect(() => {
      assertRequiredProductionEnv("production", {});
    }).toThrow("VITE_CLERK_PUBLISHABLE_KEY");
  });

  it("allows production builds when Clerk publishable key is present", () => {
    expect(() => {
      assertRequiredProductionEnv("production", {
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_local",
      });
    }).not.toThrow();
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
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_local",
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

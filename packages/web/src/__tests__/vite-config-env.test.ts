import { describe, expect, it } from "vitest";
import { assertRequiredProductionEnv } from "../lib/production-env.js";

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
});

import { describe, expect, it } from "vitest";
import {
  assertBootstrapSecret,
  parseBootstrapPlatformAdminArgs,
} from "../scripts/bootstrap-platform-admin.js";

describe("platform admin bootstrap CLI parsing", () => {
  it("parses and normalizes a valid bootstrap request", () => {
    const parsed = parseBootstrapPlatformAdminArgs([
      "--email",
      "  Blake@Venviewer.COM ",
      "--name",
      "Blake Faraway",
      "--secret",
      "x".repeat(32),
    ]);

    expect(parsed).toEqual({
      email: "blake@venviewer.com",
      name: "Blake Faraway",
      secret: "x".repeat(32),
    });
  });

  it("rejects missing required arguments and unknown flags", () => {
    expect(() => parseBootstrapPlatformAdminArgs(["--secret", "x".repeat(32)])).toThrow("--email is required");
    expect(() => parseBootstrapPlatformAdminArgs(["--email", "admin@venviewer.com"])).toThrow("--secret is required");
    expect(() => parseBootstrapPlatformAdminArgs(["--email", "admin@venviewer.com", "--secret"])).toThrow("--secret requires a value");
    expect(() => parseBootstrapPlatformAdminArgs(["--email", "admin@venviewer.com", "--secret", "x".repeat(32), "--role", "admin"]))
      .toThrow("Unknown argument: --role");
  });

  it("rejects invalid email and blank names", () => {
    expect(() => parseBootstrapPlatformAdminArgs(["--email", "not-an-email", "--secret", "x".repeat(32)]))
      .toThrow("--email must be a valid email address");
    expect(() => parseBootstrapPlatformAdminArgs(["--email", "admin@venviewer.com", "--name", "   ", "--secret", "x".repeat(32)]))
      .toThrow("--name must be 1-200 characters when provided");
  });
});

describe("platform admin bootstrap secret gate", () => {
  it("accepts the exact configured bootstrap secret", () => {
    expect(() => {
      assertBootstrapSecret("s".repeat(32), {
        VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_SECRET: "s".repeat(32),
      });
    }).not.toThrow();
  });

  it("rejects missing, weak, or mismatched bootstrap secrets", () => {
    expect(() => {
      assertBootstrapSecret("s".repeat(32), {});
    }).toThrow("must be set");
    expect(() => {
      assertBootstrapSecret("short", {
        VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_SECRET: "short",
      });
    }).toThrow("must be set");
    expect(() => {
      assertBootstrapSecret("not-the-secret", {
        VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_SECRET: "s".repeat(32),
      });
    }).toThrow("Bootstrap secret did not match");
  });
});

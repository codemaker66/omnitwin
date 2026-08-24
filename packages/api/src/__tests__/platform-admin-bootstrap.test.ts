import { describe, expect, it } from "vitest";
import {
  assertBootstrapDatabaseIsFresh,
  parseBootstrapPlatformAdminArgs,
  PLATFORM_ADMIN_BOOTSTRAP_EXPECTED_DATABASE_HOST_ENV,
  PLATFORM_ADMIN_BOOTSTRAP_FRESHNESS_LOCK_SQL,
  PLATFORM_ADMIN_BOOTSTRAP_STAGING_TARGET_ID,
  PLATFORM_ADMIN_BOOTSTRAP_TARGET_ID_ENV,
  resolveBootstrapStagingDatabaseUrl,
} from "../scripts/bootstrap-platform-admin.js";
import {
  GRAND_HALL_STAGING_DATABASE_NAME,
  GRAND_HALL_STAGING_DATABASE_ROLE,
} from "../lib/grand-hall-frontier-contract.js";

describe("platform admin bootstrap CLI parsing", () => {
  it("parses and normalizes a valid bootstrap request", () => {
    const parsed = parseBootstrapPlatformAdminArgs([
      "--email",
      "  Blake@Venviewer.COM ",
      "--name",
      "Blake Faraway",
    ]);

    expect(parsed).toEqual({
      email: "blake@venviewer.com",
      name: "Blake Faraway",
    });
  });

  it("rejects missing required arguments and unknown flags", () => {
    expect(() => parseBootstrapPlatformAdminArgs([])).toThrow("--email is required");
    expect(() => parseBootstrapPlatformAdminArgs(["--email", "admin@venviewer.com", "--role", "admin"]))
      .toThrow("Unknown argument");
  });

  it("rejects the legacy command-line secret before inspecting its value", () => {
    const commandLineSecret = "command-line-secret-that-must-not-leak";
    expect(() => parseBootstrapPlatformAdminArgs([
      "--email",
      "admin@venviewer.com",
      "--secret",
      commandLineSecret,
    ])).toThrow("Unknown argument");

    try {
      parseBootstrapPlatformAdminArgs(["--secret", commandLineSecret]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(commandLineSecret);
    }

    const inlineSecret = `--secret=${commandLineSecret}`;
    try {
      parseBootstrapPlatformAdminArgs([inlineSecret]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Unknown argument");
      expect(message).not.toContain(commandLineSecret);
    }
  });

  it("rejects positional and duplicate values without echoing them", () => {
    const positionalSecret = "positional-secret-that-must-not-leak";
    expect(() => parseBootstrapPlatformAdminArgs([
      "--email",
      "admin@venviewer.com",
      positionalSecret,
    ])).toThrow("Unexpected positional argument");
    expect(() => parseBootstrapPlatformAdminArgs([
      "--email",
      "first@venviewer.com",
      "--email",
      "second@venviewer.com",
    ])).toThrow("--email may be supplied only once");

    try {
      parseBootstrapPlatformAdminArgs(["--email", "admin@venviewer.com", positionalSecret]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(positionalSecret);
    }
  });

  it("rejects invalid email and blank names", () => {
    expect(() => parseBootstrapPlatformAdminArgs(["--email", "not-an-email"]))
      .toThrow("--email must be a valid email address");
    expect(() => parseBootstrapPlatformAdminArgs(["--email", "admin@venviewer.com", "--name", "   "]))
      .toThrow("--name must be 1-200 characters when provided");
  });
});

describe("platform admin bootstrap staging boundary", () => {
  const directHost = "ep-grand-hall.eu-west-2.aws.neon.tech";
  const databaseUrl =
    `postgresql://${GRAND_HALL_STAGING_DATABASE_ROLE}:private-password@${directHost}/${GRAND_HALL_STAGING_DATABASE_NAME}?sslmode=require`;
  const validEnv = {
    [PLATFORM_ADMIN_BOOTSTRAP_TARGET_ID_ENV]: PLATFORM_ADMIN_BOOTSTRAP_STAGING_TARGET_ID,
    [PLATFORM_ADMIN_BOOTSTRAP_EXPECTED_DATABASE_HOST_ENV]: directHost,
    DATABASE_URL: databaseUrl,
  };

  it("accepts only the explicitly bound direct Neon staging URL", () => {
    expect(resolveBootstrapStagingDatabaseUrl(validEnv)).toBe(databaseUrl);
    const channelBoundUrl = `${databaseUrl}&channel_binding=require`;
    expect(resolveBootstrapStagingDatabaseUrl({
      ...validEnv,
      DATABASE_URL: channelBoundUrl,
    })).toBe(channelBoundUrl);
  });

  it("rejects the wrong target, pooled hosts, host mismatch, and weak TLS binding without leaking the URL", () => {
    const privateUrl =
      "postgresql://production-user:production-password@ep-production.eu-west-2.aws.neon.tech/venviewer?sslmode=require";
    const invalidEnvironments = [
      { ...validEnv, [PLATFORM_ADMIN_BOOTSTRAP_TARGET_ID_ENV]: "production" },
      {
        ...validEnv,
        [PLATFORM_ADMIN_BOOTSTRAP_EXPECTED_DATABASE_HOST_ENV]:
          "ep-grand-hall-pooler.eu-west-2.aws.neon.tech",
      },
      { ...validEnv, DATABASE_URL: privateUrl },
      { ...validEnv, DATABASE_URL: databaseUrl.replace("sslmode=require", "sslmode=prefer") },
      { ...validEnv, DATABASE_URL: databaseUrl.replace(GRAND_HALL_STAGING_DATABASE_ROLE, "production_owner") },
      { ...validEnv, DATABASE_URL: databaseUrl.replace(`/${GRAND_HALL_STAGING_DATABASE_NAME}?`, "/production?") },
      { ...validEnv, DATABASE_URL: databaseUrl.replace(directHost, `${directHost}:6432`) },
      { ...validEnv, DATABASE_URL: `${databaseUrl}&host=ep-production.eu-west-2.aws.neon.tech` },
      { ...validEnv, DATABASE_URL: `${databaseUrl}&user=production-owner` },
      { ...validEnv, DATABASE_URL: `${databaseUrl}&sslmode=disable` },
      { ...validEnv, DATABASE_URL: `${databaseUrl}&channel_binding=disable` },
      { ...validEnv, DATABASE_URL: `${databaseUrl}&channel_binding=require&channel_binding=require` },
    ];
    for (const invalidEnv of invalidEnvironments) {
      expect(() => resolveBootstrapStagingDatabaseUrl(invalidEnv)).toThrow();
    }
    try {
      resolveBootstrapStagingDatabaseUrl({ ...validEnv, DATABASE_URL: privateUrl });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(privateUrl);
      expect(message).not.toContain("production-password");
    }
  });

  it("allows only an empty database or an idempotent exact-email retry", () => {
    const base = {
      requestedEmail: "admin@venviewer.com",
    } as const;
    expect(() => {
      assertBootstrapDatabaseIsFresh({
        ...base,
        existingUserEmails: [],
      });
    }).not.toThrow();
    expect(() => {
      assertBootstrapDatabaseIsFresh({
        ...base,
        existingUserEmails: ["ADMIN@VENVIEWER.COM"],
      });
    }).not.toThrow();

    for (const invalid of [
      { ...base, existingUserEmails: ["other@venviewer.com"] },
      { ...base, existingUserEmails: ["admin@venviewer.com", "other@venviewer.com"] },
    ]) {
      expect(() => {
        assertBootstrapDatabaseIsFresh(invalid);
      }).toThrow("fresh, unseeded");
    }
  });

  it("locks and checks every public application table inside the bootstrap transaction", () => {
    expect(PLATFORM_ADMIN_BOOTSTRAP_FRESHNESS_LOCK_SQL).toContain(
      `current_database() <> '${GRAND_HALL_STAGING_DATABASE_NAME}'`,
    );
    expect(PLATFORM_ADMIN_BOOTSTRAP_FRESHNESS_LOCK_SQL).toContain(
      `current_user <> '${GRAND_HALL_STAGING_DATABASE_ROLE}'`,
    );
    expect(PLATFORM_ADMIN_BOOTSTRAP_FRESHNESS_LOCK_SQL).toContain(
      "pg_advisory_xact_lock",
    );
    expect(PLATFORM_ADMIN_BOOTSTRAP_FRESHNESS_LOCK_SQL).toContain(
      "lock table %I.%I in share row exclusive mode",
    );
    expect(PLATFORM_ADMIN_BOOTSTRAP_FRESHNESS_LOCK_SQL).toContain(
      "schemaname = 'public' and tablename <> 'users'",
    );
    expect(PLATFORM_ADMIN_BOOTSTRAP_FRESHNESS_LOCK_SQL).toContain(
      "select exists (select 1 from %I.%I limit 1)",
    );
  });
});

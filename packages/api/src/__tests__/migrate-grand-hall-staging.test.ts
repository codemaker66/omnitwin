import { describe, expect, it, vi } from "vitest";
import {
  assertFreshGrandHallStagingMigrationProbe,
  createGrandHallStagingPoolErrorGuard,
  runGrandHallStagingMigration,
} from "../scripts/migrate-grand-hall-staging.js";
import {
  GRAND_HALL_STAGING_DATABASE_NAME,
  GRAND_HALL_STAGING_DATABASE_ROLE,
} from "../lib/grand-hall-frontier-contract.js";

describe("guarded Grand Hall staging migration", () => {
  it("converts an asynchronous pool error into a non-disclosing guarded failure", () => {
    const guard = createGrandHallStagingPoolErrorGuard();
    expect(() => {
      guard.assertClear();
    }).not.toThrow();
    guard.onError();
    expect(() => {
      guard.assertClear();
    }).toThrow("asynchronous failure");
  });

  it("validates the exact bound URL before invoking the migrator", async () => {
    const calls: string[] = [];
    const privateUrl = "postgresql://user:secret@staging.neon.tech/venviewer?sslmode=require";
    const resolveDatabaseUrl = vi.fn(() => {
      calls.push("validate");
      return privateUrl;
    });
    const migrateFreshDatabase = vi.fn((databaseUrl: string) => {
      calls.push("migrate");
      expect(databaseUrl).toBe(privateUrl);
      return Promise.resolve();
    });
    const assertReviewedCheckout = vi.fn(() => {
      calls.push("review");
      return Promise.resolve();
    });

    await expect(runGrandHallStagingMigration({
      env: {},
      dependencies: {
        assertReviewedCheckout,
        resolveDatabaseUrl,
        migrateFreshDatabase,
      },
    })).resolves.toEqual({
      targetId: "trades-hall-grand-hall-staging",
      databaseName: GRAND_HALL_STAGING_DATABASE_NAME,
      databaseRole: GRAND_HALL_STAGING_DATABASE_ROLE,
      startedFresh: true,
    });
    expect(calls).toEqual(["review", "validate", "migrate"]);
  });

  it("does not invoke the migrator when exact target validation fails", async () => {
    const privateUrl = "postgresql://user:secret@production.neon.tech/production?sslmode=disable";
    const migrateFreshDatabase = vi.fn();
    await expect(runGrandHallStagingMigration({
      env: {
        DATABASE_URL: privateUrl,
      },
      dependencies: {
        assertReviewedCheckout: () => Promise.resolve(),
        resolveDatabaseUrl: () => {
          throw new Error("safe target mismatch");
        },
        migrateFreshDatabase,
      },
    })).rejects.toThrow("safe target mismatch");
    expect(migrateFreshDatabase).not.toHaveBeenCalled();
  });

  it("opens no database path when reviewed checkout proof fails", async () => {
    const resolveDatabaseUrl = vi.fn();
    const migrateFreshDatabase = vi.fn();
    await expect(runGrandHallStagingMigration({
      env: {},
      dependencies: {
        assertReviewedCheckout: () => Promise.reject(
          new Error("exact reviewed clean Git checkout required"),
        ),
        resolveDatabaseUrl,
        migrateFreshDatabase,
      },
    })).rejects.toThrow("exact reviewed clean Git checkout");
    expect(resolveDatabaseUrl).not.toHaveBeenCalled();
    expect(migrateFreshDatabase).not.toHaveBeenCalled();
  });

  it("requires a fresh target and exact server-reported database name", () => {
    expect(() => {
      assertFreshGrandHallStagingMigrationProbe({
        databaseName: GRAND_HALL_STAGING_DATABASE_NAME,
        databaseRole: GRAND_HALL_STAGING_DATABASE_ROLE,
        publicTableCount: 0,
        migrationLedgerPresent: false,
      });
    }).not.toThrow();
    expect(() => {
      assertFreshGrandHallStagingMigrationProbe({
        databaseName: "production",
        databaseRole: GRAND_HALL_STAGING_DATABASE_ROLE,
        publicTableCount: 0,
        migrationLedgerPresent: false,
      });
    }).toThrow("does not match");
    expect(() => {
      assertFreshGrandHallStagingMigrationProbe({
        databaseName: GRAND_HALL_STAGING_DATABASE_NAME,
        databaseRole: GRAND_HALL_STAGING_DATABASE_ROLE,
        publicTableCount: 1,
        migrationLedgerPresent: false,
      });
    }).toThrow("zero public tables");
    expect(() => {
      assertFreshGrandHallStagingMigrationProbe({
        databaseName: GRAND_HALL_STAGING_DATABASE_NAME,
        databaseRole: GRAND_HALL_STAGING_DATABASE_ROLE,
        publicTableCount: 0,
        migrationLedgerPresent: true,
      });
    }).toThrow("zero public tables");

    expect(() => {
      assertFreshGrandHallStagingMigrationProbe({
        databaseName: GRAND_HALL_STAGING_DATABASE_NAME,
        databaseRole: "production_owner",
        publicTableCount: 0,
        migrationLedgerPresent: false,
      });
    }).toThrow("does not match");
  });
});

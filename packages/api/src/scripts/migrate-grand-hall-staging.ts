import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { resolveBootstrapStagingDatabaseUrl } from "./bootstrap-platform-admin.js";
import {
  GRAND_HALL_STAGING_DATABASE_NAME,
  GRAND_HALL_STAGING_DATABASE_ROLE,
  GRAND_HALL_STAGING_TARGET_ID,
} from "../lib/grand-hall-frontier-contract.js";
import { assertGrandHallReviewedCheckout } from "./grand-hall-reviewed-checkout.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface GrandHallStagingMigrationProbe {
  readonly databaseName: string;
  readonly databaseRole: string;
  readonly publicTableCount: number;
  readonly migrationLedgerPresent: boolean;
}

export interface GrandHallStagingMigrationResult {
  readonly targetId: typeof GRAND_HALL_STAGING_TARGET_ID;
  readonly databaseName: string;
  readonly databaseRole: string;
  readonly startedFresh: true;
}

export interface GrandHallStagingMigrationDependencies {
  readonly assertReviewedCheckout?: (
    env: Readonly<Record<string, string | undefined>>,
  ) => Promise<void>;
  readonly resolveDatabaseUrl?: typeof resolveBootstrapStagingDatabaseUrl;
  readonly migrateFreshDatabase?: (databaseUrl: string) => Promise<void>;
}

export interface GrandHallStagingPoolErrorGuard {
  readonly onError: () => void;
  readonly assertClear: () => void;
}

export function createGrandHallStagingPoolErrorGuard(): GrandHallStagingPoolErrorGuard {
  let failed = false;
  return {
    onError: () => {
      failed = true;
    },
    assertClear: () => {
      if (failed) {
        throw new Error("The staging database pool reported an asynchronous failure");
      }
    },
  };
}

export function assertFreshGrandHallStagingMigrationProbe(
  probe: GrandHallStagingMigrationProbe,
): void {
  if (
    probe.databaseName !== GRAND_HALL_STAGING_DATABASE_NAME ||
    probe.databaseRole !== GRAND_HALL_STAGING_DATABASE_ROLE
  ) {
    throw new Error("The connected database identity does not match the code-pinned staging target");
  }
  if (probe.publicTableCount !== 0 || probe.migrationLedgerPresent) {
    throw new Error(
      "Grand Hall staging migration requires a fresh database with zero public tables",
    );
  }
}

async function migrateFreshDatabase(
  databaseUrl: string,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const poolErrorGuard = createGrandHallStagingPoolErrorGuard();
  pool.on("error", poolErrorGuard.onError);
  try {
    poolErrorGuard.assertClear();
    await pool.query(`
      SELECT pg_advisory_lock(
        hashtextextended('venviewer:grand-hall-staging:fresh-migration', 0)
      )
    `);
    poolErrorGuard.assertClear();
    const result = await pool.query<{
      readonly database_name: string;
      readonly database_role: string;
      readonly public_table_count: string;
      readonly migration_ledger: string | null;
    }>(`
      SELECT
        current_database()::text AS database_name,
        current_user::text AS database_role,
        (
          SELECT count(*)::text
          FROM pg_catalog.pg_tables
          WHERE schemaname = 'public'
        ) AS public_table_count,
        to_regclass('drizzle.__drizzle_migrations')::text AS migration_ledger
    `);
    poolErrorGuard.assertClear();
    const row = result.rows[0];
    if (row === undefined || !/^\d+$/u.test(row.public_table_count)) {
      throw new Error("The staging database freshness probe returned an invalid result");
    }
    assertFreshGrandHallStagingMigrationProbe({
      databaseName: row.database_name,
      databaseRole: row.database_role,
      publicTableCount: Number(row.public_table_count),
      migrationLedgerPresent: row.migration_ledger !== null,
    });

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    poolErrorGuard.assertClear();
  } finally {
    await pool.end();
  }
  poolErrorGuard.assertClear();
}

export async function runGrandHallStagingMigration(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly dependencies?: GrandHallStagingMigrationDependencies;
}): Promise<GrandHallStagingMigrationResult> {
  const assertReviewedCheckout = input.dependencies?.assertReviewedCheckout ??
    ((env: Readonly<Record<string, string | undefined>>) =>
      assertGrandHallReviewedCheckout({
        env,
        scriptFilePath: fileURLToPath(import.meta.url),
      }));
  const resolveDatabaseUrl = input.dependencies?.resolveDatabaseUrl ??
    resolveBootstrapStagingDatabaseUrl;
  const applyMigrations = input.dependencies?.migrateFreshDatabase ?? migrateFreshDatabase;
  await assertReviewedCheckout(input.env);
  const databaseUrl = resolveDatabaseUrl(input.env);

  await applyMigrations(databaseUrl);
  return {
    targetId: GRAND_HALL_STAGING_TARGET_ID,
    databaseName: GRAND_HALL_STAGING_DATABASE_NAME,
    databaseRole: GRAND_HALL_STAGING_DATABASE_ROLE,
    startedFresh: true,
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry !== undefined &&
    pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectExecution()) {
  void (async () => {
    if (process.argv.slice(2).length !== 0) {
      throw new Error("This guarded migration command accepts no arguments");
    }
    return runGrandHallStagingMigration({ env: process.env });
  })().then((result) => {
    process.stdout.write(`${JSON.stringify({ status: "migrated", ...result })}\n`);
  }).catch(() => {
    process.stderr.write(
      "Grand Hall staging migration failed safely; no connection value was disclosed.\n",
    );
    process.exitCode = 1;
  });
}

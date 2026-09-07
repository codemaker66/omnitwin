import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { z } from "zod";

const apiRoot = resolve(import.meta.dirname, "../..");
const migrationsFolder = join(apiRoot, "drizzle");
export const PLATFORM_POSTGRES_TEST_FILES = [
  "src/__tests__/booking-mutations-postgres.test.ts",
  "src/__tests__/event-mutations-postgres.test.ts",
  "src/__tests__/db-client-local.test.ts",
  "src/__tests__/sheet-snapshot-retention-postgres.test.ts",
  "src/__tests__/quote-permissions-postgres.test.ts",
  "src/__tests__/proposal-permissions-postgres.test.ts",
] as const;

export function requirePlatformTestDatabaseUrl(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    throw new Error("VENVIEWER_PLATFORM_TEST_DATABASE_URL is required; this gate cannot skip PostgreSQL tests");
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid platform test database URL"); }
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55477"
    || url.pathname !== "/venviewer_platform_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Platform tests require their disposable 127.0.0.1:55477/venviewer_platform_test target without URL parameters");
  }
  return raw;
}

interface AppliedMigration { hash: string; created_at: string }

async function appliedMigrations(pool: Pool): Promise<AppliedMigration[]> {
  const exists = await pool.query<{ present: boolean }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
  );
  if (exists.rows[0]?.present !== true) {
    const tables = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'",
    );
    if (tables.rows[0]?.count !== 0) throw new Error("Non-empty fixture has no migration journal");
    return [];
  }
  return (await pool.query<AppliedMigration>(
    "SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id",
  )).rows;
}

function assertMigrationJournal(applied: readonly AppliedMigration[], expected: readonly MigrationMeta[], complete: boolean): void {
  if (applied.length > expected.length || (complete && applied.length !== expected.length)) {
    throw new Error("Applied migration count does not match the checkout journal");
  }
  for (const [index, row] of applied.entries()) {
    const migration = expected[index];
    if (migration === undefined || row.hash !== migration.hash || row.created_at !== String(migration.folderMillis)) {
      throw new Error(`Applied migration ${String(index)} differs from the checkout; refusing to test a drifting schema`);
    }
  }
}

async function qualifyMigrations(target: string) {
  const expected = readMigrationFiles({ migrationsFolder });
  if (expected.length === 0 || expected.some((entry, index) => !Number.isSafeInteger(entry.folderMillis)
    || entry.folderMillis <= 0 || (index > 0 && entry.folderMillis <= (expected[index - 1]?.folderMillis ?? 0)))) {
    throw new Error("Migration journal must be non-empty with increasing timestamps");
  }
  const pool = new Pool({ connectionString: target, max: 1, application_name: "platform-db-migration-gate",
    connectionTimeoutMillis: 10000, options: "-c statement_timeout=120000 -c lock_timeout=10000" });
  try {
    const identity = (await pool.query<{ database: string; address: string; port: number; pid: number; version: string }>(
      "SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port, pg_backend_pid() AS pid, version() AS version",
    )).rows[0];
    // Port-forwarded CI services report their container address and port 5432.
    // The guarded URL identifies the requested endpoint; retain both identities.
    if (identity?.database !== "venviewer_platform_test" || !identity.address
      || !Number.isInteger(identity.port) || identity.port <= 0 || identity.port > 65535
      || !Number.isInteger(identity.pid) || identity.pid <= 0) throw new Error("Unexpected platform database identity");
    const before = await appliedMigrations(pool);
    assertMigrationJournal(before, expected, false);
    const started = performance.now();
    await migrate(drizzle(pool), { migrationsFolder });
    const after = await appliedMigrations(pool);
    assertMigrationJournal(after, expected, true);
    await migrate(drizzle(pool), { migrationsFolder });
    const replay = await appliedMigrations(pool);
    assertMigrationJournal(replay, expected, true);
    if (JSON.stringify(after) !== JSON.stringify(replay)) throw new Error("Migration replay changed the applied journal");
    return { requestedEndpoint: { host: "127.0.0.1", port: 55477, database: "venviewer_platform_test" },
      server: identity, priorMigrationCount: before.length, migrationCount: after.length,
      replayMigrationCount: replay.length, elapsedMs: performance.now() - started, migrations: after };
  } finally {
    await pool.end();
  }
}

const ReportSchema = z.object({
  success: z.literal(true),
  numFailedTests: z.literal(0), numFailedTestSuites: z.literal(0),
  numPendingTests: z.literal(0), numPendingTestSuites: z.literal(0), numTodoTests: z.literal(0),
  numPassedTests: z.number().int().positive(), numTotalTests: z.number().int().positive(),
  testResults: z.array(z.object({ name: z.string(), status: z.literal("passed"),
    assertionResults: z.array(z.object({ status: z.literal("passed") })).min(1) })),
});

function normalizedPath(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

async function requireCompleteTestReport(reportPath: string) {
  const parsed = ReportSchema.safeParse(JSON.parse(await readFile(reportPath, "utf8")));
  if (!parsed.success) throw new Error("Platform PostgreSQL report contains failed, skipped, missing or invalid test results");
  const report = parsed.data;
  const expectedFiles = new Set(PLATFORM_POSTGRES_TEST_FILES.map(file => normalizedPath(join(apiRoot, file))));
  const actualFiles = new Set(report.testResults.map(result => normalizedPath(result.name)));
  const assertions = report.testResults.reduce((sum, file) => sum + file.assertionResults.length, 0);
  if (report.testResults.length !== expectedFiles.size || actualFiles.size !== expectedFiles.size
    || [...expectedFiles].some(file => !actualFiles.has(file))
    || report.numPassedTests !== report.numTotalTests || assertions !== report.numTotalTests) {
    throw new Error("Platform PostgreSQL gate did not execute every required file and test");
  }
  return { files: report.testResults.map(result => ({ path: result.name, passed: result.assertionResults.length })),
    passed: report.numPassedTests, skipped: 0 };
}

function runVitest(target: string, outputFile: string): Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }> {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  // No shell and no inherited generic database target. Tests get only their
  // separately validated target, regardless of the developer's ambient config.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "DATABASE_URL"));
  env["NODE_ENV"] = "test";
  env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"] = target;
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [cli, "run", ...PLATFORM_POSTGRES_TEST_FILES,
      "--reporter=default", "--reporter=json", `--outputFile=${outputFile}`], {
      cwd: apiRoot, env, shell: false, windowsHide: true, stdio: ["ignore", "inherit", "inherit"],
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 5 * 60 * 1000);
    const interrupt = () => { child.kill("SIGINT"); };
    const terminate = () => { child.kill("SIGTERM"); };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
    };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code, signal) => { cleanup(); resolveExit({ code, signal, timedOut }); });
  });
}

export async function runPlatformPostgresTests(): Promise<void> {
  // Reject missing or unsafe configuration before pool construction or DDL.
  const target = requirePlatformTestDatabaseUrl(process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"]);
  const outputDirectory = join(apiRoot, ".test-results/platform-db", `${String(Date.now())}-${randomUUID()}`);
  await mkdir(outputDirectory, { recursive: true });
  const receipt: Record<string, unknown> = { startedAt: new Date().toISOString(), status: "running", stage: "migration",
    requiredFiles: PLATFORM_POSTGRES_TEST_FILES };
  try {
    await Promise.all(PLATFORM_POSTGRES_TEST_FILES.map(file => access(join(apiRoot, file))));
    receipt["migration"] = await qualifyMigrations(target);
    await writeFile(join(outputDirectory, "migration.json"), `${JSON.stringify(receipt["migration"], null, 2)}\n`);
    receipt["stage"] = "tests";
    const reportPath = join(outputDirectory, "vitest.json");
    const execution = await runVitest(target, reportPath);
    receipt["execution"] = execution;
    if (execution.code !== 0 || execution.signal !== null || execution.timedOut) {
      throw new Error(`Platform Vitest run failed (exit ${String(execution.code)}, signal ${String(execution.signal)}, timeout ${String(execution.timedOut)})`);
    }
    receipt["tests"] = await requireCompleteTestReport(reportPath);
    receipt["status"] = "passed";
  } catch (error) {
    receipt["status"] = "failed";
    receipt["error"] = error instanceof Error ? { message: error.message,
      cause: error.cause instanceof Error ? error.cause.message : undefined } : { message: "Unknown gate failure" };
    throw error;
  } finally {
    receipt["completedAt"] = new Date().toISOString();
    await writeFile(join(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    // eslint-disable-next-line no-console -- operator-facing location of reproducible test evidence
    console.info(`Platform PostgreSQL receipt: ${join(outputDirectory, "receipt.json")}`);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void runPlatformPostgresTests().catch((error: unknown) => {
    // eslint-disable-next-line no-console -- deliberate failure output for the required CI command
    console.error(error instanceof Error ? error.message : "Platform PostgreSQL gate failed");
    process.exitCode = 1;
  });
}

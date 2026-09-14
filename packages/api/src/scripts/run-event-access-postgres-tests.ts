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
export const EVENT_ACCESS_POSTGRES_TEST_FILES = [
  "src/__tests__/client-event-schedule-postgres.test.ts",
  "src/__tests__/event-capability-coherence-postgres.test.ts",
] as const;

export function requireEventAccessTestDatabaseUrl(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    throw new Error("VENVIEWER_EVENT_ACCESS_TEST_DATABASE_URL is required; this gate cannot skip PostgreSQL tests");
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid event access test database URL"); }
  const local = url.username === "goal15" && url.port === "55481" && url.pathname === "/venviewer_goal15_access_test";
  const ci = url.username === "postgres" && url.port === "55477" && url.pathname === "/venviewer_event_access_test";
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || (!local && !ci) || url.search !== "" || url.hash !== "") {
    throw new Error("Event access tests require their dedicated disposable loopback database without URL parameters");
  }
  return raw;
}

interface AppliedMigration { hash: string; created_at: string }

export function assertEventAccessMigrationJournal(
  applied: readonly AppliedMigration[], expected: readonly Pick<MigrationMeta, "hash" | "folderMillis">[], complete: boolean,
): void {
  if (expected.length === 0 || applied.length > expected.length || (complete && applied.length !== expected.length)) {
    throw new Error("Applied migration count does not match the checkout journal");
  }
  for (const [index, row] of applied.entries()) {
    const migration = expected[index];
    if (migration === undefined || row.hash !== migration.hash || row.created_at !== String(migration.folderMillis)) {
      throw new Error(`Applied migration ${String(index)} differs from the checkout; refusing a drifting schema`);
    }
  }
}

async function appliedMigrations(pool: Pool): Promise<AppliedMigration[]> {
  const exists = await pool.query<{ present: boolean }>("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present");
  if (exists.rows[0]?.present !== true) {
    const tables = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'");
    if (tables.rows[0]?.count !== 0) throw new Error("Non-empty fixture has no migration journal");
    return [];
  }
  return (await pool.query<AppliedMigration>("SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id")).rows;
}

async function qualifyMigrations(target: string) {
  const url = new URL(target);
  const expected = readMigrationFiles({ migrationsFolder });
  if (expected.length === 0 || expected.some((entry, index) => !Number.isSafeInteger(entry.folderMillis)
    || entry.folderMillis <= 0 || (index > 0 && entry.folderMillis <= (expected[index - 1]?.folderMillis ?? 0)))) {
    throw new Error("Migration journal must be non-empty with increasing timestamps");
  }
  const pool = new Pool({ connectionString: target, max: 1, application_name: "event-access-db-migration-gate",
    connectionTimeoutMillis: 10000, options: "-c statement_timeout=120000 -c lock_timeout=10000" });
  try {
    const identity = (await pool.query<{ database: string; user: string; address: string; port: number; pid: number; version: string }>(
      "SELECT current_database() AS database, current_user AS user, host(inet_server_addr()) AS address, inet_server_port() AS port, pg_backend_pid() AS pid, version() AS version",
    )).rows[0];
    // A CI port mapping terminates at the container's 5432. Verify the requested
    // URL first and retain the server identity without assuming identical ports.
    if (identity?.database !== url.pathname.slice(1) || identity.user !== url.username || !identity.address
      || !Number.isInteger(identity.port) || identity.port <= 0 || identity.port > 65535
      || !Number.isInteger(identity.pid) || identity.pid <= 0) throw new Error("Unexpected event access database identity");
    const before = await appliedMigrations(pool);
    assertEventAccessMigrationJournal(before, expected, false);
    const started = performance.now();
    await migrate(drizzle(pool), { migrationsFolder });
    const after = await appliedMigrations(pool);
    assertEventAccessMigrationJournal(after, expected, true);
    await migrate(drizzle(pool), { migrationsFolder });
    const replay = await appliedMigrations(pool);
    assertEventAccessMigrationJournal(replay, expected, true);
    if (JSON.stringify(after) !== JSON.stringify(replay)) throw new Error("Migration replay changed the applied journal");
    return { requestedEndpoint: { host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: url.username },
      server: identity, priorMigrationCount: before.length, migrationCount: after.length, replayMigrationCount: replay.length,
      elapsedMs: performance.now() - started, migrations: after };
  } finally { await pool.end(); }
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

export function requireCompleteEventAccessReport(input: unknown) {
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) throw new Error("Event access PostgreSQL report contains failed, skipped, missing or invalid results");
  const report = parsed.data;
  const expectedFiles = new Set(EVENT_ACCESS_POSTGRES_TEST_FILES.map(file => normalizedPath(join(apiRoot, file))));
  const actualFiles = new Set(report.testResults.map(result => normalizedPath(result.name)));
  const assertions = report.testResults.reduce((sum, file) => sum + file.assertionResults.length, 0);
  if (report.testResults.length !== expectedFiles.size || actualFiles.size !== expectedFiles.size
    || [...expectedFiles].some(file => !actualFiles.has(file))
    || report.numPassedTests !== report.numTotalTests || assertions !== report.numTotalTests) {
    throw new Error("Event access gate did not execute every required file and test");
  }
  return { files: report.testResults.map(result => ({ path: result.name, passed: result.assertionResults.length })),
    passed: report.numPassedTests, skipped: 0 };
}

function runVitest(target: string, outputFile: string): Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }> {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  // No shell, dotenv, or ambient generic database URL. The selected suites
  // run serially against their separately validated database target.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "DATABASE_URL"));
  env["NODE_ENV"] = "test";
  env["VENVIEWER_EVENT_ACCESS_TEST_DATABASE_URL"] = target;
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [cli, "run", ...EVENT_ACCESS_POSTGRES_TEST_FILES, "--no-file-parallelism",
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
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", (code, signal) => { cleanup(); resolveExit({ code, signal, timedOut }); });
  });
}

export async function runEventAccessPostgresTests(): Promise<void> {
  // Missing/unsafe targets fail before constructing a pool or creating output.
  const target = requireEventAccessTestDatabaseUrl(process.env["VENVIEWER_EVENT_ACCESS_TEST_DATABASE_URL"]);
  const outputDirectory = join(apiRoot, ".test-results/event-access-db", `${String(Date.now())}-${randomUUID()}`);
  await mkdir(outputDirectory, { recursive: true });
  const receipt: Record<string, unknown> = { startedAt: new Date().toISOString(), status: "running", stage: "migration",
    requiredFiles: EVENT_ACCESS_POSTGRES_TEST_FILES };
  try {
    await Promise.all(EVENT_ACCESS_POSTGRES_TEST_FILES.map(file => access(join(apiRoot, file))));
    receipt["migration"] = await qualifyMigrations(target);
    await writeFile(join(outputDirectory, "migration.json"), `${JSON.stringify(receipt["migration"], null, 2)}\n`);
    receipt["stage"] = "tests";
    const reportPath = join(outputDirectory, "vitest.json");
    const execution = await runVitest(target, reportPath);
    receipt["execution"] = execution;
    if (execution.code !== 0 || execution.signal !== null || execution.timedOut) {
      throw new Error(`Event access Vitest failed (exit ${String(execution.code)}, signal ${String(execution.signal)}, timeout ${String(execution.timedOut)})`);
    }
    receipt["tests"] = requireCompleteEventAccessReport(JSON.parse(await readFile(reportPath, "utf8")));
    receipt["status"] = "passed";
  } catch (error) {
    receipt["status"] = "failed";
    receipt["error"] = error instanceof Error ? { message: error.message,
      cause: error.cause instanceof Error ? error.cause.message : undefined } : { message: "Unknown gate failure" };
    throw error;
  } finally {
    receipt["completedAt"] = new Date().toISOString();
    await writeFile(join(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    // eslint-disable-next-line no-console -- operator-facing evidence location
    console.info(`Event access PostgreSQL receipt: ${join(outputDirectory, "receipt.json")}`);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void runEventAccessPostgresTests().catch((error: unknown) => {
    // eslint-disable-next-line no-console -- required CI command failure
    console.error(error instanceof Error ? error.message : "Event access PostgreSQL gate failed");
    process.exitCode = 1;
  });
}

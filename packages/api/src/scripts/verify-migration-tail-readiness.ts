import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { link, open, readFile, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { z } from "zod";

const API_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATION_ROOT = resolve(API_ROOT, "drizzle");
const COORDINATE_LOCK_TABLES = [
  "placed_objects",
  "configuration_layout_revisions",
  "configuration_sheet_snapshots",
  "proposal_versions",
  "phase_layout_snapshots",
] as const;
const AFFECTED_EXISTING_TABLES = [
  ...COORDINATE_LOCK_TABLES,
  "event_scenarios",
  "event_phases",
  "events",
  "handoff_packs",
  "ops_tasks",
] as const;
const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  placed_objects: ["id", "position_x", "position_z"],
  configuration_layout_revisions: ["id"],
  configuration_sheet_snapshots: ["id"],
  proposal_versions: ["id"],
  phase_layout_snapshots: ["id"],
  event_scenarios: ["id", "event_id", "phase_id"],
  event_phases: ["id", "event_id"],
  events: ["id", "venue_id"],
  handoff_packs: ["id", "event_id"],
  ops_tasks: ["id", "handoff_pack_id"],
  venues: ["id"],
  users: ["id"],
  configurations: ["id"],
  spaces: ["id"],
};

const JournalSchema = z.object({
  entries: z.array(z.object({
    idx: z.number().int().nonnegative(),
    when: z.number().int().positive(),
    tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
  }).passthrough()),
}).passthrough();

interface LocalMigration {
  readonly tag: string;
  readonly when: number;
  readonly hash: string;
  readonly canonicalHash: string;
  readonly sql: string;
}

export interface AppliedMigrationMetadata {
  readonly hash: string;
  readonly createdAt: string;
}

export interface JournalComparison {
  readonly appliedCount: number;
  readonly localCount: number;
  readonly pendingCount: number | null;
  readonly pendingTags: readonly string[];
  readonly timestampPrefixMatches: boolean;
  readonly hashPrefixMatches: boolean;
  readonly hashMismatchTags: readonly string[];
  readonly prefixMatches: boolean;
  readonly firstMismatchIndex: number | null;
}

interface CatalogEvidence {
  readonly tableNames: ReadonlySet<string>;
  readonly columnNames: ReadonlySet<string>;
  readonly constraintNames: ReadonlySet<string>;
  readonly indexNames: ReadonlySet<string>;
  readonly appliedMigrations: readonly AppliedMigrationMetadata[];
  readonly affectedTableRows: Readonly<Record<string, string>>;
  readonly legacyPlacementRows: string;
  readonly missingCoordinateWriteTokenRows: string;
  readonly scenarioMismatchRows: string;
}

interface CatalogAssessment {
  readonly journal: JournalComparison;
  readonly targetTables: readonly string[];
  readonly targetConstraints: readonly string[];
  readonly targetIndexes: readonly string[];
  readonly missingTables: readonly string[];
  readonly missingColumns: readonly string[];
  readonly preexistingTargetTables: readonly string[];
  readonly catalogPreflightPassed: boolean;
}

interface CliOptions {
  readonly deployGate: boolean;
  readonly outPath: string | null;
}

class ReadinessError extends Error {}

export function parseCliOptions(args: readonly string[]): CliOptions {
  let deployGate = false;
  let outPath: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--deploy-gate") {
      deployGate = true;
    } else if (argument === "--out") {
      const candidate = args[index + 1];
      if (candidate === undefined || candidate.startsWith("--")) {
        throw new ReadinessError("--out requires a file path");
      }
      outPath = candidate;
      index += 1;
    } else {
      throw new ReadinessError(`Unknown argument: ${argument ?? ""}`);
    }
  }
  return { deployGate, outPath };
}

function requiredText(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  throw new ReadinessError(`Database did not return ${label} as text`);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function loadLocalMigrations(): Promise<LocalMigration[]> {
  const journalText = await readFile(resolve(MIGRATION_ROOT, "meta/_journal.json"), "utf8");
  const parsed: unknown = JSON.parse(journalText);
  const journal = JournalSchema.parse(parsed);
  return Promise.all(journal.entries.map(async (entry) => {
    const migrationSql = await readFile(resolve(MIGRATION_ROOT, `${entry.tag}.sql`), "utf8");
    return {
      tag: entry.tag,
      when: entry.when,
      hash: createHash("sha256").update(migrationSql).digest("hex"),
      canonicalHash: createHash("sha256").update(migrationSql.replace(/\r\n?/g, "\n")).digest("hex"),
      sql: migrationSql,
    };
  }));
}

export function compareMigrationJournals(
  local: readonly Pick<LocalMigration, "canonicalHash" | "hash" | "tag" | "when">[],
  applied: readonly AppliedMigrationMetadata[],
): JournalComparison {
  const firstTimestampMismatchIndex = applied.findIndex((remote, index) => {
    const expected = local[index];
    return expected === undefined
      || String(expected.when) !== remote.createdAt;
  });
  const timestampPrefixMatches = firstTimestampMismatchIndex === -1 && applied.length <= local.length;
  const hashMismatchTags = timestampPrefixMatches
    ? applied.flatMap((remote, index) => {
      const expected = local[index];
      return expected !== undefined
        && expected.hash !== remote.hash
        && expected.canonicalHash !== remote.hash
        ? [expected.tag]
        : [];
    })
    : [];
  const hashPrefixMatches = timestampPrefixMatches && hashMismatchTags.length === 0;
  return {
    appliedCount: applied.length,
    localCount: local.length,
    pendingCount: timestampPrefixMatches ? local.length - applied.length : null,
    pendingTags: timestampPrefixMatches ? local.slice(applied.length).map((entry) => entry.tag) : [],
    timestampPrefixMatches,
    hashPrefixMatches,
    hashMismatchTags,
    prefixMatches: hashPrefixMatches,
    firstMismatchIndex: hashPrefixMatches
      ? null
      : timestampPrefixMatches
        ? local.findIndex((entry) => hashMismatchTags.includes(entry.tag))
        : firstTimestampMismatchIndex === -1 ? local.length : firstTimestampMismatchIndex,
  };
}

function extractNamedObjects(migrations: readonly LocalMigration[], pattern: RegExp): string[] {
  return sortedUnique(migrations.flatMap((migration) => (
    [...migration.sql.matchAll(pattern)].map((match) => match[1] ?? "")
  )).filter((name) => name.length > 0));
}

function extractTargetTableNames(migrations: readonly LocalMigration[]): string[] {
  return extractNamedObjects(migrations, /CREATE TABLE(?: IF NOT EXISTS)? "([^"]+)"/g);
}

function extractTargetConstraintNames(migrations: readonly LocalMigration[]): string[] {
  const declared = extractNamedObjects(migrations, /CONSTRAINT "([^"]+)"/g);
  const guarded = extractNamedObjects(migrations, /conname\s*=\s*'([^']+)'/g);
  return sortedUnique([...declared, ...guarded]);
}

function extractTargetIndexNames(migrations: readonly LocalMigration[]): string[] {
  return extractNamedObjects(
    migrations,
    /CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? "([^"]+)"/g,
  );
}

function findMissingPrerequisites(catalog: CatalogEvidence): { tables: string[]; columns: string[] } {
  const missingTables = Object.keys(REQUIRED_COLUMNS).filter((table) => !catalog.tableNames.has(table));
  const missingColumns = Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) => (
    columns
      .filter((column) => !catalog.columnNames.has(`${table}.${column}`))
      .map((column) => `${table}.${column}`)
  ));
  return { tables: missingTables, columns: missingColumns };
}

function rowToNameSet(rows: readonly Record<string, unknown>[], key: string): ReadonlySet<string> {
  return new Set(rows.map((row) => requiredText(row[key], key)));
}

async function collectCatalogEvidence(databaseUrl: string): Promise<CatalogEvidence> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);

      const applied = await tx.execute(sql`
        SELECT hash, created_at::text AS created_at
        FROM drizzle.__drizzle_migrations
        ORDER BY created_at, id
      `);
      const catalog = await tx.execute(sql`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
      `);
      const constraints = await tx.execute(sql`
        SELECT conname FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
      `);
      const indexes = await tx.execute(sql`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
      `);
      return collectAffectedRowEvidence(tx, applied.rows, catalog.rows, constraints.rows, indexes.rows);
    });
  } finally {
    await pool.end();
  }
}

async function collectAffectedRowEvidence(
  tx: Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0],
  appliedRows: readonly Record<string, unknown>[],
  catalogRows: readonly Record<string, unknown>[],
  constraintRows: readonly Record<string, unknown>[],
  indexRows: readonly Record<string, unknown>[],
): Promise<CatalogEvidence> {
  const tableNames = new Set(catalogRows.map((row) => requiredText(row["table_name"], "table_name")));
  const columnNames = new Set(catalogRows.map((row) => (
    `${requiredText(row["table_name"], "table_name")}.${requiredText(row["column_name"], "column_name")}`
  )));
  const counts = await readAffectedTableCounts(tx);
  const placementCounts = await readPlacementImpactCounts(tx, columnNames, counts["placed_objects"] ?? "0");
  const mismatch = await tx.execute(sql`
    SELECT count(*)::text AS count
    FROM event_scenarios AS scenario
    INNER JOIN event_phases AS phase ON phase.id = scenario.phase_id
    WHERE scenario.event_id <> phase.event_id
  `);
  return {
    tableNames,
    columnNames,
    constraintNames: rowToNameSet(constraintRows, "conname"),
    indexNames: rowToNameSet(indexRows, "indexname"),
    appliedMigrations: appliedRows.map((row) => ({
      hash: requiredText(row["hash"], "hash"),
      createdAt: requiredText(row["created_at"], "created_at"),
    })),
    affectedTableRows: counts,
    legacyPlacementRows: placementCounts.legacy,
    missingCoordinateWriteTokenRows: placementCounts.missingToken,
    scenarioMismatchRows: requiredText(mismatch.rows[0]?.["count"], "scenario mismatch count"),
  };
}

async function readAffectedTableCounts(
  tx: Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0],
): Promise<Readonly<Record<string, string>>> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM placed_objects)::text AS placed_objects,
      (SELECT count(*) FROM configuration_layout_revisions)::text AS configuration_layout_revisions,
      (SELECT count(*) FROM configuration_sheet_snapshots)::text AS configuration_sheet_snapshots,
      (SELECT count(*) FROM proposal_versions)::text AS proposal_versions,
      (SELECT count(*) FROM phase_layout_snapshots)::text AS phase_layout_snapshots,
      (SELECT count(*) FROM event_scenarios)::text AS event_scenarios,
      (SELECT count(*) FROM event_phases)::text AS event_phases,
      (SELECT count(*) FROM events)::text AS events,
      (SELECT count(*) FROM handoff_packs)::text AS handoff_packs,
      (SELECT count(*) FROM ops_tasks)::text AS ops_tasks
  `);
  const row = result.rows[0];
  if (row === undefined) throw new ReadinessError("Database did not return affected-table counts");
  return Object.fromEntries(AFFECTED_EXISTING_TABLES.map((table) => [
    table,
    requiredText(row[table], `${table} count`),
  ]));
}

async function readPlacementImpactCounts(
  tx: Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0],
  columns: ReadonlySet<string>,
  totalRows: string,
): Promise<{ legacy: string; missingToken: string }> {
  const hasCoordinateSpace = columns.has("placed_objects.coordinate_space");
  const hasWriteToken = columns.has("placed_objects.coordinate_write_token");
  const legacyResult = hasCoordinateSpace
    ? await tx.execute(sql`SELECT count(*)::text AS count FROM placed_objects WHERE coordinate_space = 'legacy_render_v0'`)
    : null;
  const tokenResult = hasWriteToken
    ? await tx.execute(sql`SELECT count(*)::text AS count FROM placed_objects WHERE coordinate_write_token IS NULL`)
    : null;
  return {
    legacy: legacyResult === null
      ? totalRows
      : requiredText(legacyResult.rows[0]?.["count"], "legacy placement count"),
    missingToken: tokenResult === null
      ? totalRows
      : requiredText(tokenResult.rows[0]?.["count"], "missing coordinate token count"),
  };
}

function assessCatalog(local: readonly LocalMigration[], catalog: CatalogEvidence): CatalogAssessment {
  const journal = compareMigrationJournals(local, catalog.appliedMigrations);
  const pending = local.filter((migration) => journal.pendingTags.includes(migration.tag));
  const targetTables = extractTargetTableNames(pending);
  const targetConstraints = extractTargetConstraintNames(pending);
  const targetIndexes = extractTargetIndexNames(pending);
  const prerequisites = findMissingPrerequisites(catalog);
  const preexistingTargetTables = targetTables.filter((table) => catalog.tableNames.has(table));
  const catalogPreflightPassed = journal.timestampPrefixMatches
    && prerequisites.tables.length === 0
    && prerequisites.columns.length === 0
    && preexistingTargetTables.length === 0;
  return {
    journal,
    targetTables,
    targetConstraints,
    targetIndexes,
    missingTables: prerequisites.tables,
    missingColumns: prerequisites.columns,
    preexistingTargetTables,
    catalogPreflightPassed,
  };
}

function buildReport(
  local: readonly LocalMigration[],
  catalog: CatalogEvidence,
  assessment: CatalogAssessment,
): Record<string, unknown> {
  const coordinateMigration = local.find((migration) => migration.tag === "0044_placed_objects_render_to_real");
  const coordinateRewritePending = assessment.journal.pendingTags.includes("0044_placed_objects_render_to_real");
  return {
    generatedAt: new Date().toISOString(),
    mode: "read_only_catalog_preflight",
    databaseMutationAttempted: false,
    journal: assessment.journal,
    prerequisites: {
      tables: assessment.missingTables,
      columns: assessment.missingColumns,
      complete: assessment.missingTables.length + assessment.missingColumns.length === 0,
    },
    affectedRows: {
      existingTablesTouchedByPendingMigrations: catalog.affectedTableRows,
      coordinateMigrationLockTables: Object.fromEntries(COORDINATE_LOCK_TABLES.map((table) => [
        table,
        catalog.affectedTableRows[table] ?? "0",
      ])),
      placedObjectsRequiringLegacyCoordinateTransform: catalog.legacyPlacementRows,
      placedObjectsRequiringWriteTokenBackfill: catalog.missingCoordinateWriteTokenRows,
      eventScenariosWhoseMismatchedPhaseWouldBeCleared: catalog.scenarioMismatchRows,
    },
    pendingTargetObjects: {
      tables: assessment.targetTables,
      constraints: assessment.targetConstraints,
      indexes: assessment.targetIndexes,
      preexistingTables: assessment.preexistingTargetTables,
      constraintsAlreadyPresent: assessment.targetConstraints.filter((name) => catalog.constraintNames.has(name)),
      indexesAlreadyPresent: assessment.targetIndexes.filter((name) => catalog.indexNames.has(name)),
    },
    coordinateRewriteApproval: {
      required: coordinateRewritePending,
      environmentVariable: "APPROVED_MIGRATION_0044_SHA256",
      expectedSha256: coordinateRewritePending ? coordinateMigration?.canonicalHash ?? null : null,
    },
    gates: {
      catalogPreflightPassed: assessment.catalogPreflightPassed,
      historicalMigrationHashReviewRequired: !assessment.journal.hashPrefixMatches,
      coordinateRewriteAuthorityRequired: coordinateRewritePending,
      isolatedBranchMigrationExecutionVerified: false,
      productionMigrationExecutionAuthorized: false,
      safeToApplyProduction: false,
    },
  };
}

function deployGateFailure(
  local: readonly LocalMigration[],
  assessment: CatalogAssessment,
  approvedCoordinateMigrationHash: string | undefined,
): string | null {
  if (!assessment.catalogPreflightPassed) {
    return "Catalog preflight failed; refusing to run database migrations";
  }
  if (!assessment.journal.hashPrefixMatches) {
    return `Historical migration hash review required for: ${assessment.journal.hashMismatchTags.join(", ")}`;
  }
  const expected = local.find((migration) => migration.tag === "0044_placed_objects_render_to_real")?.canonicalHash;
  if (!coordinateMigrationApprovalSatisfied(
    assessment.journal.pendingTags,
    expected,
    approvedCoordinateMigrationHash,
  )) {
    return "Migration 0044 is pending; APPROVED_MIGRATION_0044_SHA256 must equal its exact SQL SHA-256";
  }
  return null;
}

export function coordinateMigrationApprovalSatisfied(
  pendingTags: readonly string[],
  expectedHash: string | undefined,
  approvedHash: string | undefined,
): boolean {
  if (!pendingTags.includes("0044_placed_objects_render_to_real")) return true;
  return expectedHash !== undefined && approvedHash === expectedHash;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error: unknown) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
  }
}

export async function writeReportAtomic(outPath: string, reportText: string): Promise<string> {
  const initCwd = process.env["INIT_CWD"]?.trim();
  const invocationRoot = initCwd !== undefined && initCwd.length > 0 ? initCwd : process.cwd();
  const destination = resolve(invocationRoot, outPath);
  const temporary = resolve(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(reportText, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, destination);
    } catch (error: unknown) {
      if (isNodeErrorCode(error, "EEXIST")) {
        throw new ReadinessError(`Output path already exists; refusing overwrite: ${destination}`);
      }
      throw error;
    }
    return destination;
  } finally {
    await removeTemporaryFile(temporary);
  }
}

async function emitReport(reportText: string, outPath: string | null): Promise<void> {
  if (outPath === null) {
    // eslint-disable-next-line no-console -- operator-facing, secret-free JSON evidence
    console.log(reportText);
    return;
  }
  const destination = await writeReportAtomic(outPath, `${reportText}\n`);
  // eslint-disable-next-line no-console -- operator-facing output location only
  console.log(JSON.stringify({ status: "written", path: destination }));
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new ReadinessError("DATABASE_URL is required for the read-only catalog preflight");
  }
  const local = await loadLocalMigrations();
  const catalog = await collectCatalogEvidence(databaseUrl);
  const assessment = assessCatalog(local, catalog);
  const reportText = JSON.stringify(buildReport(local, catalog, assessment), null, 2);
  await emitReport(reportText, options.outPath);
  if (options.deployGate) {
    const failure = deployGateFailure(local, assessment, process.env["APPROVED_MIGRATION_0044_SHA256"]);
    if (failure !== null) throw new ReadinessError(failure);
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    const reason = error instanceof ReadinessError
      ? error.message
      : "Read-only migration catalog preflight failed";
    // eslint-disable-next-line no-console -- deliberately redacted operator error
    console.error(JSON.stringify({ status: "failed", reason }));
    process.exitCode = 1;
  });
}

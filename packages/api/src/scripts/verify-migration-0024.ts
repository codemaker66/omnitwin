import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

// ---------------------------------------------------------------------------
// verify-migration-0024_runtime_assets (T-434)
//
// READ-ONLY verification that the five runtime-asset registry tables from
// 0024_runtime_assets.sql exist in the configured database with their named
// constraints and indexes. Prints catalog evidence only (names and counts) —
// never row data, never credentials. Registers nothing.
//
// Usage: `pnpm --filter @omnitwin/api tsx src/scripts/verify-migration-0024.ts`
// ---------------------------------------------------------------------------

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

const RUNTIME_TABLES = [
  "capture_sessions",
  "asset_versions",
  "room_manifests",
  "runtime_packages",
  "processing_jobs",
];

/** Renders a catalog scalar for display; non-scalars become "?". */
function displayScalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value.toString();
  return "?";
}

const lines: string[] = [];

const tablesResult = await db.execute(sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('capture_sessions', 'asset_versions', 'room_manifests', 'runtime_packages', 'processing_jobs')
  ORDER BY table_name
`);
const presentTables = tablesResult.rows.map((r) => String(r["table_name"]));
lines.push(`tables present (${String(presentTables.length)}/5): ${presentTables.join(", ")}`);

const journalResult = await db.execute(sql`
  SELECT count(*)::int AS applied, to_char(to_timestamp(max(created_at) / 1000.0), 'YYYY-MM-DD HH24:MI:SS UTC') AS latest
  FROM drizzle.__drizzle_migrations
`);
const journalRow = journalResult.rows[0];
lines.push(
  `drizzle journal: ${displayScalar(journalRow?.["applied"])} migrations applied, latest at ${displayScalar(journalRow?.["latest"])}`,
);

const constraintsResult = await db.execute(sql`
  SELECT conrelid::regclass::text AS tbl, conname, contype
  FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace
    AND conrelid::regclass::text IN ('capture_sessions', 'asset_versions', 'room_manifests', 'runtime_packages', 'processing_jobs')
  ORDER BY 1, 2
`);
for (const table of RUNTIME_TABLES) {
  const names = constraintsResult.rows
    .filter((r) => String(r["tbl"]) === table)
    .map((r) => `${String(r["conname"])}[${String(r["contype"])}]`);
  lines.push(`constraints ${table} (${String(names.length)}): ${names.join(" ")}`);
}

const indexResult = await db.execute(sql`
  SELECT tablename, indexname FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('capture_sessions', 'asset_versions', 'room_manifests', 'runtime_packages', 'processing_jobs')
  ORDER BY 1, 2
`);
lines.push(`indexes across the five tables: ${String(indexResult.rows.length)}`);

for (const table of RUNTIME_TABLES) {
  if (!presentTables.includes(table)) {
    lines.push(`row count ${table}: (table absent)`);
    continue;
  }
  const countResult = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`));
  lines.push(`row count ${table}: ${displayScalar(countResult.rows[0]?.["n"])}`);
}

// eslint-disable-next-line no-console -- CLI operator signal
console.log(lines.join("\n"));
process.exit(0);

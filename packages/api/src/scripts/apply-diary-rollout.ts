import "dotenv/config";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

// ---------------------------------------------------------------------------
// OWNER-RUN: apply the Diary migrations (0050 + 0051) to the target database.
// Slice 5, T-520. Runbook: docs/operations/diary-production-rollout-runbook.md
//
// SAFE BY DEFAULT — with no flags this is a DRY RUN: it connects, reports the
// target's exact migration state, and changes nothing. Applying requires
// --apply.
//
// Why not `drizzle-kit migrate`? Its cursor applies EVERYTHING in the journal
// newer than the newest ledger row — on production today that would also
// apply 0049 + 0052–0058 (the Foundry chain, owner-gated separately). This
// script applies EXACTLY 0050_diary_bookings and 0051_diary_enquiry_link,
// each in its own transaction, and records ledger rows byte-identical to
// what drizzle-orm's migrator writes (sha256 of the file, journal `when`).
//
// THE CURSOR CONSEQUENCE: drizzle's migrator compares only against the
// NEWEST ledger row (verified in drizzle-orm/pg-core/dialect.js). Recording
// 0050/0051 moves that cursor past 0049_reconstruction_foundry, so a later
// plain `drizzle-kit migrate` will silently skip 0049 forever. If 0049 is
// unapplied on the target, --apply additionally requires
// --accept-cursor-jump, and the Foundry owner must apply 0049 by hand.
//
// Usage (dry run, then apply):
//   pnpm --filter @omnitwin/api exec tsx src/scripts/apply-diary-rollout.ts
//   pnpm --filter @omnitwin/api exec tsx src/scripts/apply-diary-rollout.ts --apply
// ---------------------------------------------------------------------------

/* eslint-disable no-console -- CLI operator signal throughout */

const MIGRATION_TAGS = ["0050_diary_bookings", "0051_diary_enquiry_link"] as const;
const APPLY = process.argv.includes("--apply");
const ACCEPT_CURSOR_JUMP = process.argv.includes("--accept-cursor-jump");

interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

interface PlannedMigration {
  readonly tag: string;
  readonly when: number;
  readonly sqlText: string;
  readonly hash: string;
  applied: boolean;
}

function abort(message: string): never {
  console.error(`\nABORT: ${message}`);
  process.exit(1);
}

const env = validateEnv();
const targetUrl = new URL(env.DATABASE_URL);

const drizzleDir = fileURLToPath(new URL("../../drizzle/", import.meta.url));
const journal = JSON.parse(await readFile(`${drizzleDir}meta/_journal.json`, "utf-8")) as {
  entries: JournalEntry[];
};

const plan: PlannedMigration[] = [];
for (const tag of MIGRATION_TAGS) {
  const entry = journal.entries.find((candidate) => candidate.tag === tag);
  if (entry === undefined) abort(`journal has no entry for ${tag} — unexpected tree state.`);
  const sqlText = await readFile(`${drizzleDir}${tag}.sql`, "utf-8");
  plan.push({
    tag,
    when: entry.when,
    sqlText,
    hash: crypto.createHash("sha256").update(sqlText).digest("hex"),
    applied: false,
  });
}
const firstDiaryWhen = plan[0]?.when ?? 0;

const db = createDb(env.DATABASE_URL);

console.log("=== Diary rollout (T-520) — 0050 + 0051 ===");
console.log(`target host: ${targetUrl.hostname}  database: ${targetUrl.pathname.slice(1)}`);
console.log(`mode: ${APPLY ? "APPLY" : "DRY RUN (no changes will be made)"}\n`);

// --- 1. The ledger must exist (any drizzle-managed database has it) --------
const ledger = await db.execute(sql`
  SELECT 1 AS ok FROM information_schema.tables
  WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
`);
if (ledger.rows.length === 0) {
  abort(
    "drizzle.__drizzle_migrations does not exist — this database was never " +
      "migrated by drizzle. Wrong DATABASE_URL?",
  );
}

// --- 2. Ledger cursor state -------------------------------------------------
const newestRows = await db.execute(sql`
  SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1
`);
const newestWhen = newestRows.rows.length === 0 ? 0 : Number(newestRows.rows[0]?.["created_at"]);
const newestEntry = journal.entries.find((entry) => entry.when === newestWhen);
console.log(
  `ledger newest: ${newestEntry?.tag ?? `created_at=${String(newestWhen)} (not in this journal)`}`,
);

// Journal entries the cursor has not covered that are OLDER than 0050 — the
// ones a cursor jump would strand (0049 today).
const stranded = journal.entries.filter(
  (entry) => entry.when > newestWhen && entry.when < firstDiaryWhen,
);

// --- 3. Per-migration state --------------------------------------------------
let pendingCount = 0;
for (const migration of plan) {
  const row = await db.execute(sql`
    SELECT 1 AS ok FROM drizzle.__drizzle_migrations WHERE created_at = ${migration.when}
  `);
  migration.applied = row.rows.length > 0;
  console.log(
    `${migration.tag}: ${migration.applied ? "already applied (ledger row present)" : "PENDING"}`,
  );
  if (!migration.applied) pendingCount += 1;
}

// --- 4. Prerequisites 0050/0051 reference ------------------------------------
const PREREQUISITES = ["venues", "spaces", "users", "events", "event_phases", "enquiries"];
for (const table of PREREQUISITES) {
  const exists = await db.execute(sql`
    SELECT 1 AS ok FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}
  `);
  if (exists.rows.length === 0) abort(`prerequisite table "${table}" is missing on the target.`);
}
console.log(`prerequisites: ${PREREQUISITES.join(", ")} — all present`);

if (stranded.length > 0) {
  console.log(
    `\nCURSOR WARNING: ${stranded.map((entry) => entry.tag).join(", ")} unapplied and older ` +
      "than 0050 in the journal. After this rollout, plain `drizzle-kit migrate` will SKIP " +
      "them forever — their owner must apply them by hand (see the runbook).",
  );
}

if (pendingCount === 0) {
  console.log("\nNothing to do — both Diary migrations are already recorded on this target.");
  process.exit(0);
}

if (!APPLY) {
  console.log(`\nDRY RUN complete. ${String(pendingCount)} migration(s) would be applied.`);
  console.log("Re-run with --apply to proceed.");
  process.exit(0);
}

if (stranded.length > 0 && !ACCEPT_CURSOR_JUMP) {
  abort(
    `refusing to --apply while ${stranded.map((entry) => entry.tag).join(", ")} is/are ` +
      "unapplied. Re-run with --accept-cursor-jump once you have read the runbook's " +
      "cursor section.",
  );
}

// --- 5. Apply — one transaction per migration, ledger row included -----------
for (const migration of plan) {
  if (migration.applied) continue;
  console.log(`\napplying ${migration.tag} ...`);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(migration.sqlText));
      await tx.execute(sql`
        INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at")
        VALUES (${migration.hash}, ${migration.when})
      `);
    });
    console.log(`applied ${migration.tag} (ledger row recorded).`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    abort(`${migration.tag} failed and was rolled back: ${reason}`);
  }
}

// --- 6. Post-apply verification ----------------------------------------------
const constraint = await db.execute(sql`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conname = 'bookings_ink_no_overlap'
`);
if (constraint.rows.length === 0) abort("post-check failed: bookings_ink_no_overlap is missing.");
const enquiryColumn = await db.execute(sql`
  SELECT 1 AS ok FROM information_schema.columns
  WHERE table_name = 'bookings' AND column_name = 'enquiry_id'
`);
if (enquiryColumn.rows.length === 0) abort("post-check failed: bookings.enquiry_id is missing.");
const extension = await db.execute(sql`
  SELECT 1 AS ok FROM pg_extension WHERE extname = 'btree_gist'
`);
if (extension.rows.length === 0) abort("post-check failed: btree_gist extension is missing.");

console.log("\nPOST-CHECKS PASSED:");
console.log("  - btree_gist extension installed");
console.log(`  - ink exclusion constraint: ${String(constraint.rows[0]?.["def"]).slice(0, 80)}...`);
console.log("  - bookings.enquiry_id present");
console.log("\nDone. Next: the runbook's post-apply smoke checks.");
process.exit(0);

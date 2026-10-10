import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Migration readiness — the journal this image ships against the rows the
// database has recorded (T-653).
//
// Railway rebuilds the API on every master push and activates the new
// deployment as soon as `/health/ready` answers 2xx, while the Deploy workflow
// applies migrations only after master CI has passed, minutes later. On
// 9 October 2026 the new API therefore ran eleven minutes ahead of 0087.
// Refusing readiness while any bundled journal entry is unrecorded holds the
// switch until the migration lands; the previous container keeps serving.
//
// The journal is the same file drizzle-kit reads, two levels above this
// module in development (src/db) and in the image (dist/db) alike. A
// migration is "applied" when its journal timestamp appears as a
// `created_at` in drizzle.__drizzle_migrations, which is what the migrator
// writes; hashes are the deploy gate's business, not readiness's.
// ---------------------------------------------------------------------------

export const BUNDLED_JOURNAL_URL = new URL("../../drizzle/meta/_journal.json", import.meta.url);

const JournalSchema = z.object({
  entries: z.array(z.object({
    idx: z.number().int().nonnegative(),
    when: z.number().int().positive(),
    tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
  }).passthrough()),
}).passthrough();

export interface JournalEntry {
  readonly tag: string;
  readonly when: number;
}

export interface MigrationReadiness {
  /** Rows in drizzle.__drizzle_migrations, whether or not this image knows them. */
  readonly applied: number;
  /** Entries in the bundled journal. */
  readonly local: number;
  /** Bundled entries the database has not recorded, in journal order. */
  readonly pendingTags: readonly string[];
}

/** The slice of a Drizzle database (or transaction) readiness needs. */
export interface MigrationStore {
  execute(query: SQL): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

/** Reads and validates the journal the image ships; throws if it is missing
 *  or malformed, so a server that cannot know its migrations never claims
 *  readiness. */
export async function loadBundledJournal(url: URL = BUNDLED_JOURNAL_URL): Promise<readonly JournalEntry[]> {
  const text = await readFile(fileURLToPath(url), "utf8");
  const journal = JournalSchema.parse(JSON.parse(text));
  return journal.entries.map((entry) => ({ tag: entry.tag, when: entry.when }));
}

/** Bundled entries whose timestamp the database has not recorded. Applied
 *  rows the bundle does not know (an older image after a newer migration)
 *  are ignored: that image is not ahead of the database. */
export function pendingMigrations(
  journal: readonly JournalEntry[],
  appliedCreatedAt: readonly string[],
): readonly JournalEntry[] {
  const applied = new Set(appliedCreatedAt);
  return journal.filter((entry) => !applied.has(String(entry.when)));
}

const UNDEFINED_TABLE = "42P01";

function isUndefinedTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { readonly code: unknown }).code === UNDEFINED_TABLE;
}

/** Compares the bundled journal with drizzle.__drizzle_migrations. A database
 *  without that table has had no migration applied. Any other database error
 *  is the caller's to report. */
export async function readMigrationReadiness(
  store: MigrationStore,
  journal: readonly JournalEntry[],
): Promise<MigrationReadiness> {
  let appliedCreatedAt: string[];
  try {
    const result = await store.execute(sql`
      SELECT created_at::text AS created_at
      FROM drizzle.__drizzle_migrations
    `);
    appliedCreatedAt = result.rows.map((row) => String(row["created_at"]));
  } catch (error) {
    if (!isUndefinedTable(error)) throw error;
    appliedCreatedAt = [];
  }
  return {
    applied: appliedCreatedAt.length,
    local: journal.length,
    pendingTags: pendingMigrations(journal, appliedCreatedAt).map((entry) => entry.tag),
  };
}

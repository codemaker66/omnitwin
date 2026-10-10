import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { MIGRATIONS_FOLDER, migratePending } from "../scripts/migrate-before-deploy.js";

// The pre-deploy migrator on an isolated PostgreSQL: a database that has
// never been migrated reaches the whole journal in one run, a second run
// applies nothing and reports the same counts, and the ledger it keeps is
// the one drizzle-kit keeps (so the Deploy workflow's second pass finds the
// same rows). Needs a disposable cluster, as the other Postgres suites do:
// VENVIEWER_REQUESTS_TEST_DATABASE_URL names a database on it; this suite
// creates and drops its own database beside it.

const sourceUrl = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
const TEST_DATABASE = "venviewer_migrate_before_deploy_test";

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

describe.skipIf(sourceUrl === undefined)("migrate-before-deploy on isolated PostgreSQL", () => {
  const admin = sourceUrl === undefined ? null : withDatabase(sourceUrl, "postgres");
  const target = sourceUrl === undefined ? null : withDatabase(sourceUrl, TEST_DATABASE);

  beforeAll(async () => {
    if (admin === null) return;
    const pool = new Pool({ connectionString: admin });
    try {
      await pool.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`);
      await pool.query(`CREATE DATABASE ${TEST_DATABASE}`);
    } finally {
      await pool.end();
    }
  }, 60_000);

  afterAll(async () => {
    if (admin === null) return;
    const pool = new Pool({ connectionString: admin });
    try {
      await pool.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`);
    } finally {
      await pool.end();
    }
  }, 60_000);

  it("brings a fresh database to the whole journal, then applies nothing on a second run", async () => {
    if (target === null) throw new Error("no target database");
    const first = await migratePending(target);
    expect(first.appliedBefore).toBe(0);
    expect(first.local).toBeGreaterThan(85);
    expect(first.appliedAfter).toBe(first.local);

    const pool = new Pool({ connectionString: target });
    try {
      // The living timetable's tables (0087) are there, so the API code that
      // selects them never runs ahead of its schema.
      const tables = await pool.query("SELECT to_regclass('public.threads') AS threads, to_regclass('public.messages') AS messages");
      const row = tables.rows[0] as { readonly threads: string | null; readonly messages: string | null };
      expect(row.threads).toBe("threads");
      expect(row.messages).toBe("messages");
      // The ledger is drizzle-kit's: one row per journal entry, each stamped
      // with the entry's `when`, which the Deploy workflow's gate compares.
      const ledger = await pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations");
      expect((ledger.rows[0] as { readonly count: number }).count).toBe(first.local);
    } finally {
      await pool.end();
    }

    const second = await migratePending(target);
    expect(second).toEqual({ appliedBefore: first.local, appliedAfter: first.local, local: first.local });
  }, 300_000);

  it("reads the migrations from the API package's own drizzle folder", () => {
    expect(MIGRATIONS_FOLDER.replaceAll("\\", "/")).toMatch(/\/packages\/api\/drizzle$/u);
  });
});

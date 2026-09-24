import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { enquiries } from "../db/schema.js";
import {
  extractTargetConstraintNames,
  extractTargetIndexNames,
  extractTargetTableNames,
} from "../scripts/verify-migration-tail-readiness.js";

// ---------------------------------------------------------------------------
// Migration 0072 adds the two indexes behind newest-first enquiry lists and
// nothing else. EXPLAIN evidence (disposable PostgreSQL 16) is recorded in the
// migration; the platform PostgreSQL gate proves the planner can use them.
// This pins the migration to the Drizzle schema, replay safety and its slot.
// ---------------------------------------------------------------------------

const TAG = "0072_enquiry_list_order_indexes";

function indexColumns(table: PgTable, name: string): string[] | undefined {
  const index = getTableConfig(table).indexes.find((candidate) => candidate.config.name === name);
  return index?.config.columns.map((column) => ("name" in column ? column.name ?? "<unnamed>" : "<expression>"));
}

describe("migration 0072 enquiry list order indexes", () => {
  it("creates only the indexes the Drizzle schema declares, idempotently and non-destructively", async () => {
    const sql = await readFile(resolve("drizzle", `${TAG}.sql`), "utf8");
    const migrations = [{ sql }];
    expect(extractTargetTableNames(migrations)).toEqual([]);
    expect(extractTargetConstraintNames(migrations)).toEqual([]);
    expect(extractTargetIndexNames(migrations)).toEqual(["enquiries_venue_created_idx", "enquiries_venue_state_created_idx"]);
    expect(indexColumns(enquiries, "enquiries_venue_created_idx")).toEqual(["venue_id", "created_at", "id"]);
    expect(indexColumns(enquiries, "enquiries_venue_state_created_idx")).toEqual(["venue_id", "state", "created_at", "id"]);

    const statements = sql.replace(/--[^\n]*/g, "");
    expect(statements.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(2);
    // Drizzle runs pending migrations in one transaction, which CONCURRENTLY cannot join.
    expect(statements).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE|INSERT|TRUNCATE|CONCURRENTLY)\b/i);
  });

  it("follows 0071 in the journal with a later timestamp", async () => {
    const journal = z.object({
      entries: z.array(z.object({ idx: z.number(), when: z.number(), tag: z.string() })),
    }).parse(JSON.parse(await readFile(resolve("drizzle", "meta", "_journal.json"), "utf8")));
    const entry = journal.entries.find((candidate) => candidate.tag === TAG);
    const previous = journal.entries.find((candidate) => candidate.tag === "0071_configuration_foreign_key_indexes");
    expect(entry?.idx).toBe((previous?.idx ?? Number.NaN) + 1);
    expect(entry?.when).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
  });
});

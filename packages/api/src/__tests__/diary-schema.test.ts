import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type AnyPgColumn, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  bookings,
  bookingStatusHistory,
  eventPhases,
  events,
  spaces,
  turnaroundRules,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Diary Slice 1 schema contract (T-487; Canon §2; architecture doc §1).
//
// Pins the three new tables to migration 0050 column-for-column, the ink
// exclusion constraint (the hard floor of Canon §2.2), the additive events /
// event_phases extensions, and the tenant-integrity composite FKs.
// ---------------------------------------------------------------------------

const MIGRATION_TAG = "0050_diary_bookings";

function extractCreatedTableColumns(sql: string, tableName: string): string[] {
  const createPattern = new RegExp(
    `CREATE TABLE(?: IF NOT EXISTS)? "${tableName}" \\(([\\s\\S]*?)\\r?\\n\\);`,
  );
  const body = createPattern.exec(sql)?.[1];
  if (body === undefined) throw new Error(`Migration does not create table ${tableName}`);
  return [...body.matchAll(/^\s{2}"([^"]+)"\s/gm)].map((match) => match[1] ?? "");
}

function drizzleColumnNames(table: PgTable): string[] {
  const columns = Object.values(getTableColumns(table)) as AnyPgColumn[];
  return columns.map((column) => column.name);
}

function drizzleForeignKeyShape(
  table: PgTable,
  name: string,
): { readonly columns: readonly string[]; readonly foreignColumns: readonly string[] } {
  const key = getTableConfig(table).foreignKeys.find((candidate) => candidate.getName() === name);
  if (key === undefined) throw new Error(`Drizzle table is missing foreign key ${name}`);
  const reference = key.reference();
  return {
    columns: reference.columns.map((column) => column.name),
    foreignColumns: reference.foreignColumns.map((column) => column.name),
  };
}

async function readDiaryMigration(): Promise<string> {
  return readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");
}

describe("diary schema contract", () => {
  it("keeps migration 0050 table columns identical to the Drizzle diary schema", async () => {
    const sql = await readDiaryMigration();
    for (const table of [bookings, bookingStatusHistory, turnaroundRules]) {
      const tableName = getTableName(table);
      expect(extractCreatedTableColumns(sql, tableName), tableName).toEqual(
        drizzleColumnNames(table),
      );
    }
  });

  it("enforces the ink hard floor: btree_gist + partial exclusion constraint", async () => {
    const sql = await readDiaryMigration();
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
    const compact = sql.replace(/\s+/gu, " ");
    expect(compact).toContain(
      'ADD CONSTRAINT "bookings_ink_no_overlap" EXCLUDE USING gist ( "space_id" WITH =, tstzrange("starts_at", "ends_at", \'[)\') WITH && ) WHERE ("kind" = \'ink\' AND "status" = \'active\' AND "deleted_at" IS NULL)',
    );
  });

  it("guards booking row integrity with CHECK constraints", async () => {
    const sql = await readDiaryMigration();
    for (const constraint of [
      "bookings_time_valid",
      "bookings_kind_check",
      "bookings_status_check",
      "bookings_rank_positive",
      "bookings_rank_hold_only",
      "turnaround_rules_minutes_nonnegative",
    ]) {
      expect(sql).toContain(constraint);
    }
    const compact = sql.replace(/\s+/gu, " ");
    expect(compact).toContain('CONSTRAINT "bookings_time_valid" CHECK ("ends_at" > "starts_at")');
    expect(compact).toContain(
      'CONSTRAINT "bookings_rank_hold_only" CHECK ("rank" IS NULL OR "kind" = \'hold\')',
    );
  });

  it("pins tenant integrity with composite foreign keys (Mission Control pattern)", async () => {
    const sql = await readDiaryMigration();
    const compact = sql.replace(/\s+/gu, " ");
    expect(compact).toContain(
      'CONSTRAINT "bookings_event_venue_fk" FOREIGN KEY("event_id", "venue_id") REFERENCES "events"("id", "venue_id")',
    );
    expect(compact).toContain(
      'CONSTRAINT "bookings_space_venue_fk" FOREIGN KEY("space_id", "venue_id") REFERENCES "spaces"("id", "venue_id")',
    );
    expect(sql).toContain("spaces_id_venue_unique");

    expect(drizzleForeignKeyShape(bookings, "bookings_event_venue_fk")).toEqual({
      columns: ["event_id", "venue_id"],
      foreignColumns: ["id", "venue_id"],
    });
    expect(drizzleForeignKeyShape(bookings, "bookings_space_venue_fk")).toEqual({
      columns: ["space_id", "venue_id"],
      foreignColumns: ["id", "venue_id"],
    });
    const spacesUniques = getTableConfig(spaces).uniqueConstraints.map((u) => u.name);
    expect(spacesUniques).toContain("spaces_id_venue_unique");
  });

  it("extends events with CRM links and the headcount triple (Canon §2.4)", async () => {
    const sql = await readDiaryMigration();
    for (const column of [
      '"client_account_id"',
      '"opportunity_id"',
      '"headcount_guaranteed"',
      '"headcount_expected"',
      '"headcount_set_for"',
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    const eventCols = getTableColumns(events);
    expect(eventCols.clientAccountId.name).toBe("client_account_id");
    expect(eventCols.opportunityId.name).toBe("opportunity_id");
    expect(eventCols.headcountGuaranteed.name).toBe("headcount_guaranteed");
    expect(eventCols.headcountExpected.name).toBe("headcount_expected");
    expect(eventCols.headcountSetFor.name).toBe("headcount_set_for");
  });

  it("extends event_phases with the keystone space scope (Canon §2.3)", async () => {
    const sql = await readDiaryMigration();
    expect(sql).toContain('ALTER TABLE "event_phases"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "space_id"');
    expect(getTableColumns(eventPhases).spaceId.name).toBe("space_id");
  });

  it("is strictly additive — no destructive statements", async () => {
    const sql = await readDiaryMigration();
    expect(sql).not.toMatch(/\b(?:DROP|RENAME)\b/iu);
    expect(sql).not.toMatch(/\bTRUNCATE\s+(?:TABLE\s+)?"/iu);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/iu);
  });

  it("keeps booking status history on the house convention", () => {
    const cols = drizzleColumnNames(bookingStatusHistory);
    expect(cols).toEqual([
      "id",
      "booking_id",
      "from_state",
      "to_state",
      "changed_by",
      "note",
      "created_at",
    ]);
  });
});

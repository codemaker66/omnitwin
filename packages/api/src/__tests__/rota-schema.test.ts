import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type AnyPgColumn, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  ROTA_SHIFT_STATUSES,
  ROTA_SKILLS,
  STAFF_EMPLOYMENT_TYPES,
  STAFF_UNAVAILABILITY_REASONS,
} from "@omnitwin/types";
import { rotaShiftChanges, rotaShifts, staffMembers, staffUnavailability } from "../db/schema.js";

// ---------------------------------------------------------------------------
// The staff rota's schema contract (T-637 slice B, migration 0078).
//
// Pins the four tables to 0078 column for column (the diary contract's
// method), the rota vocabulary in @omnitwin/types to 0078's CHECK lists and
// schema.ts's DB-local types, and the composite keys that hold every person,
// event and room on a shift to the shift's venue.
// ---------------------------------------------------------------------------

const MIGRATION = "0078_staff_rota";
const TABLES = [staffMembers, rotaShifts, staffUnavailability, rotaShiftChanges] as const;

async function migration(): Promise<string> {
  return readFile(resolve("drizzle", `${MIGRATION}.sql`), "utf8");
}

function createdColumns(sql: string, tableName: string): string[] {
  const body = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? "${tableName}" \\(([\\s\\S]*?)\\r?\\n\\);`).exec(sql)?.[1];
  if (body === undefined) throw new Error(`Migration does not create table ${tableName}`);
  return [...body.matchAll(/^\s{2}"([^"]+)"\s/gm)].map((match) => match[1] ?? "");
}

function drizzleColumns(table: PgTable): string[] {
  return (Object.values(getTableColumns(table)) as AnyPgColumn[]).map((column) => column.name);
}

/** The quoted values of a CHECK's IN (...) or ARRAY[...] list. */
function checkList(sql: string, constraint: string): string[] {
  const start = sql.indexOf(`CONSTRAINT "${constraint}"`);
  if (start < 0) throw new Error(`Missing constraint ${constraint}`);
  const clause = sql.slice(start, sql.indexOf("\n", start));
  const list = /(?:IN \(|ARRAY\[)([^)\]]+)[)\]]/u.exec(clause)?.[1] ?? "";
  return [...list.matchAll(/'([^']+)'/gu)].map((match) => match[1] ?? "");
}

function foreignKey(table: PgTable, name: string): { columns: string[]; foreignColumns: string[] } {
  const key = getTableConfig(table).foreignKeys.find((candidate) => candidate.getName() === name);
  if (key === undefined) throw new Error(`Drizzle table is missing foreign key ${name}`);
  const reference = key.reference();
  return { columns: reference.columns.map((column) => column.name), foreignColumns: reference.foreignColumns.map((column) => column.name) };
}

describe("rota schema contract", () => {
  it("keeps each table's columns identical to migration 0078", async () => {
    const sql = await migration();
    for (const table of TABLES) {
      expect(drizzleColumns(table), getTableName(table)).toEqual(createdColumns(sql, getTableName(table)));
    }
  });

  it("keeps the shared vocabulary and the database's CHECK lists the same", async () => {
    const sql = await migration();
    expect(checkList(sql, "staff_members_skills")).toEqual([...ROTA_SKILLS]);
    expect(checkList(sql, "rota_shifts_role")).toEqual([...ROTA_SKILLS]);
    expect(checkList(sql, "staff_members_employment")).toEqual([...STAFF_EMPLOYMENT_TYPES]);
    expect(checkList(sql, "rota_shifts_status")).toEqual([...ROTA_SHIFT_STATUSES]);
    expect(checkList(sql, "staff_unavailability_reason")).toEqual([...STAFF_UNAVAILABILITY_REASONS]);
    // schema.ts states the same lists for its DB-local types.
    const schemaSource = await readFile(resolve("src", "db", "schema.ts"), "utf8");
    expect(schemaSource).toContain(`type RotaSkillColumn = ${ROTA_SKILLS.map((skill) => `"${skill}"`).join(" | ")};`);
    expect(schemaSource).toContain(`type StaffEmploymentTypeColumn = ${STAFF_EMPLOYMENT_TYPES.map((value) => `"${value}"`).join(" | ")};`);
    expect(schemaSource).toContain(`type RotaShiftStatusColumn = ${ROTA_SHIFT_STATUSES.map((value) => `"${value}"`).join(" | ")};`);
    expect(schemaSource).toContain(`type StaffUnavailabilityReasonColumn = ${STAFF_UNAVAILABILITY_REASONS.map((value) => `"${value}"`).join(" | ")};`);
  });

  it("holds every person, event and room on a shift to the shift's venue", async () => {
    expect(foreignKey(rotaShifts, "rota_shifts_staff_venue_fk")).toEqual({ columns: ["staff_member_id", "venue_id"], foreignColumns: ["id", "venue_id"] });
    expect(foreignKey(rotaShifts, "rota_shifts_event_venue_fk")).toEqual({ columns: ["event_id", "venue_id"], foreignColumns: ["id", "venue_id"] });
    expect(foreignKey(rotaShifts, "rota_shifts_space_venue_fk")).toEqual({ columns: ["space_id", "venue_id"], foreignColumns: ["id", "venue_id"] });
    expect(foreignKey(staffUnavailability, "staff_unavailability_staff_venue_fk")).toEqual({ columns: ["staff_member_id", "venue_id"], foreignColumns: ["id", "venue_id"] });
    expect(foreignKey(rotaShiftChanges, "rota_shift_changes_shift_venue_fk")).toEqual({ columns: ["shift_id", "venue_id"], foreignColumns: ["id", "venue_id"] });
    const compact = (await migration()).replace(/\s+/gu, " ");
    // Removing an event or room clears only that column, as 0050 does.
    expect(compact).toContain('REFERENCES "events"("id", "venue_id") ON DELETE SET NULL ("event_id")');
    expect(compact).toContain('REFERENCES "spaces"("id", "venue_id") ON DELETE SET NULL ("space_id")');
    // The keys it builds on are asserted before anything is created.
    const sql = await migration();
    expect(sql.indexOf("events_id_venue_unique")).toBeLessThan(sql.indexOf('CREATE TABLE "staff_members"'));
    expect(sql.indexOf("spaces_id_venue_unique")).toBeLessThan(sql.indexOf('CREATE TABLE "staff_members"'));
  });

  it("keeps the record of changes unaltered, and adds without touching existing tables", async () => {
    const sql = await migration();
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "rota_shift_changes"');
    expect(sql).not.toMatch(/\b(?:DROP|RENAME|TRUNCATE)\b/iu);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/iu);
    expect(sql).not.toMatch(/\bALTER TABLE\b/iu);
    const created = [...sql.matchAll(/CREATE TABLE "([a-z_]+)"/gu)].map((match) => match[1]);
    expect(created).toEqual(TABLES.map((table) => getTableName(table)));
  });
});

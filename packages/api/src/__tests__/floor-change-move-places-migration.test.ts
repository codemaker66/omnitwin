import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { eventPlanChanges } from "../db/schema.js";
import { migrationText, sqlWithoutComments } from "./migration-text.js";

// ---------------------------------------------------------------------------
// A Diary move keeps its places as data (PR #361's review): the migration adds
// exactly the columns, CHECK and partial index the Drizzle schema declares,
// all additive. Found through the journal by the stable half of its tag, so
// the release queue can renumber it without touching this test. The CHECK's
// behaviour is exercised on PostgreSQL in floor-changes-postgres.test.ts.
// ---------------------------------------------------------------------------

const MIGRATION = "_floor_change_move_places";

describe("migration floor_change_move_places", () => {
  it("adds the move columns the Drizzle schema declares, nullable and without defaults", async () => {
    const statements = sqlWithoutComments(await migrationText(MIGRATION));
    const added = [...statements.matchAll(/ADD COLUMN "([a-z_]+)" ([^,\n]+)/gu)];
    const declared = Object.values(getTableColumns(eventPlanChanges)).map((column) => column.name).filter((name) => name.startsWith("move_"));
    expect(added.map((match) => match[1])).toEqual(declared);
    expect(declared).toHaveLength(7);
    for (const match of added) expect(match[2] ?? "").not.toMatch(/\b(NOT NULL|DEFAULT|REFERENCES)\b/iu);
  });

  it("keeps the places together with the schema's CHECK and finds a booking's moves with its partial index", async () => {
    const statements = sqlWithoutComments(await migrationText(MIGRATION));
    const config = getTableConfig(eventPlanChanges);
    expect(config.checks.map((check) => check.name)).toContain("event_plan_changes_booking_move_places");
    expect(statements).toContain('ADD CONSTRAINT "event_plan_changes_booking_move_places" CHECK');
    const index = config.indexes.find((candidate) => candidate.config.name === "event_plan_changes_booking_move_idx");
    expect(index?.config.columns.map((column) => ("name" in column ? column.name : "<expression>"))).toEqual(["source_id", "created_at"]);
    expect(statements).toMatch(/CREATE INDEX "event_plan_changes_booking_move_idx" ON "event_plan_changes" \("source_id", "created_at"\)\s+WHERE "move_chain_id" IS NOT NULL;/u);
  });

  it("changes no row and waits a bounded time for its locks", async () => {
    const statements = sqlWithoutComments(await migrationText(MIGRATION));
    expect(statements).toContain("SET LOCAL lock_timeout = '5s';");
    expect(statements).not.toMatch(/\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE|RENAME|CONCURRENTLY)\b/iu);
  });
});

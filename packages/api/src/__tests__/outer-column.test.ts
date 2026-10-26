import { describe, expect, it } from "vitest";
import { sql, type SQLWrapper } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { referenceLoadouts } from "../db/schema.js";
import { outerColumn } from "../utils/outer-column.js";

// ---------------------------------------------------------------------------
// The SQL Drizzle writes for a correlated subquery in a single-table select.
// The behaviour on real rows is in reference-loadouts-postgres.test.ts and
// client-search-postgres.test.ts; this pins the text, without a database.
// ---------------------------------------------------------------------------

function photoCountSql(outer: SQLWrapper): string {
  return new QueryBuilder()
    .select({ photoCount: sql<number>`(SELECT count(*)::int FROM reference_photos WHERE loadout_id = ${outer})` })
    .from(referenceLoadouts)
    .toSQL().sql;
}

describe("outerColumn", () => {
  it("is needed: Drizzle writes a bare column in a single-table select without its table", () => {
    expect(photoCountSql(referenceLoadouts.id)).toContain('WHERE loadout_id = "id")');
  });

  it("names the outer table, so the subquery compares with the outer row", () => {
    expect(photoCountSql(outerColumn(referenceLoadouts.id))).toContain('WHERE loadout_id = "reference_loadouts"."id")');
  });
});

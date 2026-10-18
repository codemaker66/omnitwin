import { getTableName, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// The outer row's column, named so a subquery cannot mistake it for its own.
//
// In a select from one table, Drizzle writes a column that appears in the
// select list's own SQL as its bare name. PostgreSQL resolves a bare name
// against the subquery's own tables first, so
//
//   sql`(SELECT count(*) FROM placed_objects WHERE configuration_id = ${configurations.id})`
//
// rendered `configuration_id = "id"` and compared each placed object with
// itself: every layout read "0 pieces". Where the subquery joins two tables
// with an "id", the statement is refused instead, which is how every room's
// reference loadouts answered 500 (18 October 2026). The same SQL reads
// correctly once the select gains a join, so the defect comes and goes with
// the query's shape.
//
// `outerColumn(table.column)` always writes "table"."column". Use it for every
// reference from a hand-written subquery to the row outside it, and name the
// subquery's own tables with an alias.
// ---------------------------------------------------------------------------

export function outerColumn(column: AnyPgColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

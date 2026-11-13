import { getTableName, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// A column of the outer query, named with its table, for a correlated
// subquery in a select list.
//
// Drizzle writes every column in a single-table select's sql fields as a bare
// name, and inside a subquery a bare name binds to the subquery's own tables
// first. `loadout_id = "id"` under `FROM reference_photos` compares a photo
// with itself, and under a join of two tables with an "id" PostgreSQL refuses
// the whole query (Sentry VENVIEWER-API-1). Drizzle leaves this SQL alone.
// ---------------------------------------------------------------------------

/** `"table"."column"`: an outer row's column, referred to from inside a subquery. */
export function outerColumn(column: AnyPgColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

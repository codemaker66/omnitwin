**Read this when:** writing a subquery inside a drizzle `db.select({ … })` field, interpolating a table column into a `sql` template that is a select field, or reading a count that is always 0 or a `column reference "…" is ambiguous` error from a list route.

# drizzle strips table names from columns in a single-table select's `sql` fields

In a select with no joins, drizzle 0.45 rewrites every column that is a direct
chunk of a `sql` selection field to its bare name (`pg-core/dialect.js`,
`buildSelection`, the `isSingleTable` branch). So this

```ts
db.select({
  photoCount: sql<number>`(SELECT count(*)::int FROM reference_photos WHERE loadout_id = ${referenceLoadouts.id})`,
}).from(referenceLoadouts)
```

reaches PostgreSQL as `… WHERE loadout_id = "id"`. PostgreSQL binds a bare name
to the innermost table that has it:

- two inner tables have it: an error (`"id" is ambiguous`, Sentry VENVIEWER-API-1,
  the loadout list's 500 from 18 Oct 2026);
- one inner table has it: a silently wrong answer. The Clients desk read 0 layouts
  and 0 enquiries for every client, 0 pieces per layout, and counted a lead's
  enquiries by `enquiries.email` instead of the lead's email.

WHERE, ORDER BY and joined selects are not affected: drizzle qualifies columns
there. Columns nested inside another SQL object in the field are not stripped
either, only the field's top-level chunks.

## Do this instead

Build the subquery with drizzle, so the outer column sits inside a filter and
keeps `"table"."column"`:

```ts
photoCount: db.$count(referencePhotos, eq(referencePhotos.loadoutId, referenceLoadouts.id)),
coverFileKey: sql<string | null>`${db.select({ fileKey: files.fileKey })
  .from(referencePhotos).innerJoin(files, eq(files.id, referencePhotos.fileId))
  .where(eq(referencePhotos.loadoutId, referenceLoadouts.id))
  .orderBy(asc(referencePhotos.sortOrder)).limit(1)}`,
```

drizzle wraps an embedded select in parentheses itself. Prove a new one on real
PostgreSQL (`packages/api/src/__tests__/correlated-subqueries-postgres.test.ts`
is the pattern): a mock or `toSQL()` cannot show how PostgreSQL resolves the name.

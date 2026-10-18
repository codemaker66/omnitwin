**Read this when:** writing raw SQL inside a Drizzle `select({...})` that reads
another table for each row (a count, a name, an `EXISTS`).

# A bare column in a subquery belongs to the subquery

In a select from one table with no join, Drizzle writes a column that appears in
the select list's own SQL as its bare name. `${configurations.id}` becomes `"id"`,
not `"configurations"."id"`. PostgreSQL resolves a bare name against the
subquery's own tables first, and only then the row outside it:

```ts
// Rendered: (SELECT count(*) FROM placed_objects WHERE configuration_id = "id")
objectCount: sql`(SELECT count(*)::int FROM placed_objects WHERE configuration_id = ${configurations.id})`,
```

`"id"` is the placed object's own, so every layout counted 0 pieces. Where the
subquery joins two tables that both have the column, PostgreSQL refuses the
statement as ambiguous instead: every room's reference loadouts answered 500 in
production until 18 October 2026. Where the inner table happens not to have the
column, the outer one is found and the query works by luck. The same SQL reads
correctly as soon as the select gains a join, because Drizzle then qualifies
every column, so a refactor can break or mend it without touching the subquery.
Mocked route tests never run the SQL and cannot see any of this.

Name the outer row with `outerColumn()` from `packages/api/src/db/outer-column.ts`,
which always writes `"table"."column"`, and alias the subquery's own tables:

```ts
objectCount: sql`(SELECT count(*)::int FROM placed_objects po WHERE po.configuration_id = ${outerColumn(configurations.id)})`,
```

`outer-column-guard.test.ts` fails on a `sql` template that names its own table
(`FROM name`, `JOIN name`) and interpolates a schema column without
`outerColumn()`. It does not judge templates that interpolate the table itself
(`FROM ${proposals}`); those are correct only inside a select with a join, so
prefer the aliased form above for new code. Prove a new per-row subquery on real
PostgreSQL, as `correlated-subqueries-postgres.test.ts` does.

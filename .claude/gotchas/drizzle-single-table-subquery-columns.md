**Read this when:** writing raw SQL inside a Drizzle `select({...})` that reads
another table for each row (a count, a name, an `EXISTS`).

# A bare column in a subquery belongs to the subquery

In a select from one table with no join, Drizzle writes a column interpolated
straight into the select list's own SQL as its bare name. `${configurations.id}`
becomes `"id"`, not `"configurations"."id"`. (A column inside a nested `sql`
fragment, or in a WHERE clause, keeps its table.) PostgreSQL resolves a bare name
against the subquery's own tables first, and only then the row outside it:

```ts
// Rendered: (SELECT count(*) FROM placed_objects WHERE configuration_id = "id")
objectCount: sql`(SELECT count(*)::int FROM placed_objects WHERE configuration_id = ${configurations.id})`,
```

`"id"` is the placed object's own, so every layout counted 0 pieces. Where the
subquery joins two tables that both have the column, PostgreSQL refuses the
statement as ambiguous instead: found on 18 October 2026, when every room's
reference loadouts answered 500 in production. Where the inner table happens not
to have the column, the outer one is found and the query works by luck. The same
SQL reads correctly as soon as the select gains a join, because Drizzle then
qualifies every column, so a refactor can break or mend it without touching the
subquery. Mocked route tests never run the SQL and cannot see any of this.

Name the outer row with `outerColumn()` from `packages/api/src/utils/outer-column.ts`,
which always writes `"table"."column"`, and alias the subquery's own tables:

```ts
objectCount: sql`(SELECT count(*)::int FROM placed_objects po WHERE po.configuration_id = ${outerColumn(configurations.id)})`,
```

The alias matters even with `outerColumn()`: a subquery over the outer row's own
table, unaliased, takes `"configurations"."space_id"` for its own row and
compares each row with itself.

`outer-column-guard.test.ts` reads the API's source as TypeScript and judges
each `sql` template that names its own table. Where the template names it by
hand (`FROM name` or `JOIN name`, plain or quoted, in any case), it fails on a
schema column interpolated without `outerColumn()` (`table.column` or
`schema.table.column`), and on `outerColumn()` inside an unaliased table of the
same name. Where the template interpolates its own table (`FROM ${proposals}`),
it fails on a column of any other table interpolated without `outerColumn()`:
that form renders correctly only while Drizzle happens to qualify the column (a
select with a join, a WHERE clause), and the "0 pieces" bug comes back if a
join is removed. `selectDeskProposals` and the dietary retention job use
`outerColumn()` for that reason, though their SQL is unchanged by it. The guard
does not see a table imported under another name, or a column passed in as a
variable. Prove a new per-row subquery on real PostgreSQL, as
`correlated-subqueries-postgres.test.ts` does.

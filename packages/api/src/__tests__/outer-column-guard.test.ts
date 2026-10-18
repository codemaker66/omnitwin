import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// A hand-written subquery reaches the row outside it only through
// outerColumn() (db/outer-column.ts), and names its own table with an alias.
//
// Interpolated straight into a single-table select's own SQL, `${table.column}`
// is rendered without its table, and PostgreSQL gives the name to the
// subquery's own table first: every layout read "0 pieces" and every room's
// reference loadouts answered 500. An inner table with the outer one's name
// and no alias captures even outerColumn's "table"."column". The PostgreSQL
// suite proves the fixed queries (correlated-subqueries-postgres.test.ts);
// this keeps the shape from coming back. It reads the code as TypeScript, not
// as text, and judges each `sql` template that names a table by hand (FROM or
// JOIN a plain or quoted name, in any case). A template that interpolates the
// table itself (`FROM ${proposals}`) is the query builder's and is not judged.
// ---------------------------------------------------------------------------

const SRC = resolve(import.meta.dirname, "..");
const TABLES = new Map(Object.entries(schema).flatMap(([name, value]) => (is(value, PgTable) ? [[name, getTableName(value)] as const] : [])));
// A table named by hand, not a function call (`FROM now()`), and its alias.
// Interpolations are joined as NUL, so no name runs across one.
const NAMED = /\b(?:FROM|JOIN)\s+"?([a-z_][a-z0-9_]*)\b"?(?![\s"]*\()(?:\s+(?:AS\s+)?"?([a-z_][a-z0-9_]*)\b"?)?/giu;
const NOT_AN_ALIAS = new Set(["where", "join", "left", "right", "inner", "outer", "full", "cross", "natural", "lateral", "on", "using",
  "group", "order", "limit", "offset", "having", "window", "union", "intersect", "except", "for", "and", "or", "set", "returning"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** The schema table a `table.column` or `schema.table.column` names, if any. */
function columnTable(expression: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const owner = expression.expression;
  if (ts.isIdentifier(owner)) return TABLES.has(owner.text) ? owner.text : null;
  if (ts.isPropertyAccessExpression(owner) && ts.isIdentifier(owner.expression) && TABLES.has(owner.name.text)) return owner.name.text;
  return null;
}

function judge(fileName: string, text: string): string[] {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText().startsWith("sql") && ts.isTemplateExpression(node.template)) {
      const literal = [node.template.head.text, ...node.template.templateSpans.map((span) => span.literal.text)].join("\u0000");
      const named = [...literal.matchAll(NAMED)].map((match) => ({
        table: (match[1] ?? "").toLowerCase(),
        aliased: match[2] !== undefined && !NOT_AN_ALIAS.has(match[2].toLowerCase()),
      }));
      if (named.length > 0) {
        for (const span of node.template.templateSpans) {
          const at = `${fileName}:${String(file.getLineAndCharacterOfPosition(span.expression.getStart()).line + 1)}`;
          if (columnTable(span.expression) !== null) found.push(`${at} bare \${${span.expression.getText()}}`);
          const call = span.expression;
          if (ts.isCallExpression(call) && call.expression.getText() === "outerColumn" && call.arguments[0] !== undefined) {
            const table = columnTable(call.arguments[0]);
            const sqlName = table === null ? null : TABLES.get(table) ?? null;
            if (named.some((own) => own.table === sqlName && !own.aliased)) {
              found.push(`${at} ${call.getText()} inside an unaliased ${String(sqlName)}`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("subqueries name the outer row by its table", () => {
  it("finds the shapes that miscount or fail, and passes their fixes", () => {
    const cases: [string, string, number][] = [
      ["broken", "sql`(SELECT count(*) FROM reference_photos rp WHERE rp.loadout_id = ${referenceLoadouts.id})`", 1],
      ["lower case", "sql`(select count(*) from placed_objects where configuration_id = ${configurations.id})`", 1],
      ["quoted", "sql`(SELECT count(*) FROM \"placed_objects\" WHERE \"configuration_id\" = ${configurations.id})`", 1],
      ["through the schema", "sql`(SELECT count(*) FROM placed_objects po WHERE po.configuration_id = ${schema.configurations.id})`", 1],
      ["same table, no alias", "sql`(SELECT count(*) FROM configurations WHERE space_id = ${outerColumn(configurations.spaceId)})`", 1],
      ["fixed", "sql`(SELECT count(*) FROM reference_photos rp WHERE rp.loadout_id = ${outerColumn(referenceLoadouts.id)})`", 0],
      ["same table, aliased", "sql`(SELECT count(*) FROM configurations c WHERE c.space_id = ${outerColumn(configurations.spaceId)})`", 0],
      ["values only", "sql`EXISTS (SELECT 1 FROM enquiries e WHERE e.venue_id = ${venueId} AND e.user_id = ${params.data.userId})`", 0],
      ["a function's FROM", "sql`EXTRACT(EPOCH FROM now() - ${configurations.createdAt})`", 0],
      ["the builder's table", "sql`(SELECT 1 FROM ${placedObjects} WHERE ${placedObjects.configurationId} = ${configurations.id})`", 0],
    ];
    for (const [label, code, expected] of cases) {
      expect(judge(`${label}.ts`, `const x = ${code};`), label).toHaveLength(expected);
    }
  });

  it("holds across the API's source", () => {
    const found = sourceFiles(SRC).flatMap((path) => judge(relative(SRC, path), readFileSync(path, "utf8")));
    expect(found).toEqual([]);
  });
});

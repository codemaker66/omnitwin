import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// A hand-written subquery reaches the row outside it only through
// outerColumn() (db/outer-column.ts).
//
// Written bare, `${table.column}` inside a single-table select's own SQL is
// rendered without its table, and PostgreSQL gives the name to the
// subquery's own table first: every layout read "0 pieces" and every room's
// reference loadouts answered 500. The PostgreSQL suite proves the fixed
// queries (correlated-subqueries-postgres.test.ts); this keeps the shape
// from coming back. It reads the code as TypeScript, not as text: a `sql`
// template that names a table of its own (FROM or JOIN a plain name) may
// interpolate a schema column only through outerColumn().
// ---------------------------------------------------------------------------

const SRC = resolve(import.meta.dirname, "..");
const TABLES = new Set(Object.entries(schema).filter(([, value]) => is(value, PgTable)).map(([name]) => name));
// SQL keywords are written in capitals here and table names in lower case;
// an interpolated table (`FROM ${proposals}`) is the query builder's, not one
// named by hand.
const OWN_TABLE = /\b(?:FROM|JOIN)\s+[a-z_][a-z0-9_]*\b/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** `table.column`, where `table` is one of the schema's tables. */
function bareColumn(expression: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) return null;
  return TABLES.has(expression.expression.text) ? expression.getText() : null;
}

function bareOuterColumns(fileName: string, text: string): string[] {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText().startsWith("sql")
      && ts.isTemplateExpression(node.template)) {
      const literal = [node.template.head.text, ...node.template.templateSpans.map((span) => span.literal.text)].join("\u0000");
      if (OWN_TABLE.test(literal)) {
        for (const span of node.template.templateSpans) {
          const column = bareColumn(span.expression);
          if (column !== null) {
            const { line } = file.getLineAndCharacterOfPosition(span.expression.getStart());
            found.push(`${fileName}:${String(line + 1)} \${${column}}`);
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
  it("finds the shape that broke the loadouts list, and passes its fix", () => {
    const broken = "const x = sql`(SELECT count(*) FROM reference_photos rp WHERE rp.loadout_id = ${referenceLoadouts.id})`;";
    const fixed = "const x = sql`(SELECT count(*) FROM reference_photos rp WHERE rp.loadout_id = ${outerColumn(referenceLoadouts.id)})`;";
    const value = "const x = sql`EXISTS (SELECT 1 FROM enquiries e WHERE e.venue_id = ${venueId} AND e.user_id = ${params.data.userId})`;";
    expect(bareOuterColumns("broken.ts", broken)).toEqual(["broken.ts:1 ${referenceLoadouts.id}"]);
    expect(bareOuterColumns("fixed.ts", fixed)).toEqual([]);
    expect(bareOuterColumns("value.ts", value)).toEqual([]);
  });

  it("holds across the API's source", () => {
    const found = sourceFiles(SRC).flatMap((path) => bareOuterColumns(relative(SRC, path), readFileSync(path, "utf8")));
    expect(found).toEqual([]);
  });
});

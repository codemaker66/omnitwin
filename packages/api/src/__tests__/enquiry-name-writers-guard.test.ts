import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// The join of old records copies an enquiry's name onto the events it makes
// (their name and client name), and the 24-month pass and an edit compare
// those copies with the enquiry's name as it stands. So every write that can
// change an enquiry's name after it is made carries the copies with it
// (followEnquiryName, services/people-erasure.ts). Today that is the edit
// alone (writeEnquiryEdit, routes/enquiries.ts).
//
// This reads the production code as TypeScript, not as text, and the
// migrations as SQL text, and finds every write to the enquiries table:
//   - a Drizzle update builder on the table (named directly, through the
//     schema namespace, an import alias or a local alias), whose set() either
//     is an object literal with no spread, no computed key and no `name` key
//     (it cannot write the name) or sits in a function listed below that calls
//     followEnquiryName and is given one of that function's parameters, whose
//     name the function reads, no parameter of its own being called `name` (it
//     carries the copies, keyed off the changes it writes);
//   - an update builder on a table it cannot name, an insert into the table
//     that updates on conflict, SQL text that updates "enquiries" by name or
//     updates an interpolated table, and a call of sql.raw() with text it
//     cannot read: each must be listed below with what it is, or the check
//     fails;
//   - an UPDATE of enquiries in a migration that assigns its name.
// A write it finds and cannot place fails the check; so does a listed one
// that is no longer there.
// ---------------------------------------------------------------------------

const SRC = resolve(import.meta.dirname, "..");
const MIGRATIONS = resolve(import.meta.dirname, "../../drizzle");
const TABLES = new Map(Object.entries(schema).flatMap(([name, value]) => (is(value, PgTable) ? [[name, getTableName(value)] as const] : [])));
const ENQUIRIES = "enquiries";

/** Writes that may set the name, and carry the copies: the file, and the function they sit in (keysOffItsChanges). */
const CARRY_THE_COPIES = [{ file: "routes/enquiries.ts", within: "writeEnquiryEdit" }] as const;

/** SQL that updates a table given at run time: the function, and why it cannot be the enquiries table. */
const DYNAMIC_UPDATES = [
  { file: "services/people-erasure.ts", within: "reword", why: "its tables are the `table:` string literals of its callers, none of them enquiries" },
] as const;

/** Calls of sql.raw() with text the check cannot read, by file: how many, and what they are. */
const RAW_SQL = new Map<string, { readonly count: number; readonly why: string }>([
  ["scripts/apply-diary-rollout.ts", { count: 1, why: "runs migration files, read below as migrations" }],
  ["scripts/apply-migration-0009.ts", { count: 1, why: "runs a migration file, read below" }],
  ["scripts/apply-migration-0010.ts", { count: 1, why: "runs a migration file, read below" }],
  ["scripts/apply-migration-0012.ts", { count: 1, why: "runs a migration file, read below" }],
  ["scripts/apply-migration-0013.ts", { count: 1, why: "runs a migration file, read below" }],
  ["scripts/check-people-book.ts", { count: 2, why: "an alias and a column name, in WHERE clauses" }],
  ["scripts/verify-migration-0024.ts", { count: 1, why: "a count read of a named table" }],
  ["services/people-retention.ts", { count: 2, why: "an alias, in the WHERE clauses of the 24-month pass's reading" }],
  ["services/people-search.ts", { count: 1, why: "a table name of a literal union, in a WHERE clause" }],
  ["services/web-vitals.ts", { count: 1, why: "a SET LOCAL statement_timeout" }],
  ["utils/user-display-name.ts", { count: 1, why: "a number" }],
]);

/** Whether a template is SQL the code runs: tagged `sql`, or passed to query(), execute() or sql.raw(). */
function isSqlTemplate(node: ts.TemplateExpression): boolean {
  const parent = node.parent;
  if (ts.isTaggedTemplateExpression(parent)) return parent.tag.getText().startsWith("sql");
  if (!ts.isCallExpression(parent)) return false;
  const callee = parent.expression;
  return callee.getText() === "sql.raw" || (ts.isPropertyAccessExpression(callee) && ["query", "execute"].includes(callee.name.text));
}

/** SQL text that updates the enquiries table by name. */
const UPDATES_BY_NAME = /\bupdate\s+(?:only\s+)?"?enquiries"?(?![a-z0-9_])/iu;
/** SQL text that ends where an updated table is interpolated. */
const UPDATE_THEN_TABLE = /\bupdate\s+(?:only\s+)?"?$/iu;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly within: string;
  readonly what: string;
}

interface Judgement {
  /** Writes that cannot change an enquiry's name. */
  readonly cannotWriteName: readonly Finding[];
  /** Writes that may change it and carry the copies. */
  readonly carryTheCopies: readonly Finding[];
  /** Writes through a dynamic table, and calls of sql.raw() with unread text, that are listed. */
  readonly listed: readonly Finding[];
  /** Everything else: each fails the check. */
  readonly unplaced: readonly Finding[];
}

/** The name of the function a node sits in, or "(module)". */
function within(node: ts.Node): string {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name !== undefined) return at.name.getText();
    if (ts.isVariableDeclaration(at) && at.initializer !== undefined
      && (ts.isArrowFunction(at.initializer) || ts.isFunctionExpression(at.initializer))) return at.name.getText();
  }
  return "(module)";
}

/** The function declaration or arrow named `name` in the file, if any. */
function functionNamed(file: ts.SourceFile, name: string): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    else if (ts.isVariableDeclaration(node) && node.name.getText() === name && node.initializer !== undefined) found = node.initializer;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function calls(node: ts.Node, callee: string): boolean {
  let seen = false;
  const visit = (child: ts.Node): void => {
    if (seen) return;
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === callee) seen = true;
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return seen;
}

/** The whole call chain a call starts (`db.insert(t).values(v).onConflictDoUpdate(...)`). */
function chainOf(node: ts.Node): ts.Node {
  let top = node;
  while ((ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top)
    || (ts.isCallExpression(top.parent) && top.parent.expression === top)) top = top.parent;
  return top;
}

/** Whether a set() argument provably leaves the name alone: an object literal with only plain keys, none `name`. */
function leavesTheName(argument: ts.Expression | undefined): boolean {
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) return false;
  return argument.properties.every((property) => {
    if (!(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))) return false;
    const name = property.name;
    return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text !== "name";
  });
}

/**
 * Whether a listed function's write keys its lock and its copies off the
 * changes it writes: set() is given one of the function's parameters, the
 * function reads that parameter's `name`, and no parameter of its own is
 * called `name` (a name given beside the changes could differ from the one
 * written).
 */
function keysOffItsChanges(fn: ts.Node, setArgument: ts.Expression | undefined): boolean {
  if (!ts.isFunctionLike(fn) || setArgument === undefined || !ts.isIdentifier(setArgument)) return false;
  const changes = setArgument.text;
  const parameters = fn.parameters.map((parameter) => parameter.name.getText());
  if (!parameters.includes(changes) || parameters.includes("name")) return false;
  let reads = false;
  const visit = (node: ts.Node): void => {
    if (reads) return;
    const owner = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : undefined;
    const key = ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
    if (owner !== undefined && ts.isIdentifier(owner) && owner.text === changes && key === "name") reads = true;
    else ts.forEachChild(node, visit);
  };
  visit(fn);
  return reads;
}

/** Judges one source file; `file` is its path relative to src. */
function judge(file: string, text: string): Judgement {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const cannotWriteName: Finding[] = [];
  const carryTheCopies: Finding[] = [];
  const listed: Finding[] = [];
  const unplaced: Finding[] = [];
  const finding = (node: ts.Node, what: string): Finding => ({
    file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, within: within(node), what,
  });
  // Local names of schema tables: imports (aliased or not) and `const t = table`.
  const aliases = new Map<string, string>();
  const tableOf = (expression: ts.Expression): string | null => {
    if (ts.isIdentifier(expression)) return aliases.get(expression.text) ?? (TABLES.has(expression.text) ? expression.text : null);
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && TABLES.has(expression.name.text)) {
      return expression.name.text;
    }
    return null;
  };
  const collect = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node)) {
      const imported = (node.propertyName ?? node.name).text;
      if (TABLES.has(imported)) aliases.set(node.name.text, imported);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const table = tableOf(node.initializer);
      if (table !== null) aliases.set(node.name.text, table);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  let rawCount = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.arguments.length === 1) {
      const method = node.expression.name.text;
      const [argument] = node.arguments;
      const table = argument === undefined ? null : tableOf(argument);
      const chained = node.parent;
      if (method === "update" && ts.isPropertyAccessExpression(chained) && chained.name.text === "set") {
        const setCall = chained.parent;
        if (table === null) unplaced.push(finding(node, "an update builder on a table the check cannot name"));
        else if (table === ENQUIRIES) {
          const setArgument = ts.isCallExpression(setCall) ? setCall.arguments[0] : undefined;
          const place = finding(node, `update(${ENQUIRIES}).set(${setArgument?.getText().slice(0, 60) ?? ""})`);
          const carrier = CARRY_THE_COPIES.find((entry) => entry.file === file && entry.within === place.within);
          const fn = carrier === undefined ? undefined : functionNamed(source, carrier.within);
          if (leavesTheName(setArgument)) cannotWriteName.push(place);
          else if (fn !== undefined && calls(fn, "followEnquiryName") && keysOffItsChanges(fn, setArgument)) carryTheCopies.push(place);
          else unplaced.push(place);
        }
      }
      if (method === "insert" && table === ENQUIRIES && /\.onConflictDoUpdate\(/u.test(chainOf(node).getText())) {
        unplaced.push(finding(node, `insert(${ENQUIRIES}) ... onConflictDoUpdate`));
      }
      if (node.expression.getText() === "sql.raw" && argument !== undefined && !ts.isStringLiteralLike(argument)) {
        rawCount += 1;
        listed.push(finding(node, `sql.raw(${argument.getText().slice(0, 40)})`));
      }
    }
    if (ts.isStringLiteralLike(node) && UPDATES_BY_NAME.test(node.text)) unplaced.push(finding(node, "SQL text that updates enquiries"));
    if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      if (parts.some((part) => UPDATES_BY_NAME.test(part))) unplaced.push(finding(node, "SQL text that updates enquiries"));
      node.templateSpans.forEach((span, index) => {
        if (!isSqlTemplate(node) || !UPDATE_THEN_TABLE.test(parts[index] ?? "")) return;
        const table = tableOf(span.expression);
        const place = finding(span, `update \${${span.expression.getText().slice(0, 40)}}`);
        const dynamic = DYNAMIC_UPDATES.find((entry) => entry.file === file && entry.within === place.within);
        if (table !== null && table !== ENQUIRIES) cannotWriteName.push(place);
        else if (table === null && dynamic !== undefined) listed.push(place);
        else unplaced.push(place);
      });
    }
    // A dynamic writer may never be given the enquiries table by name.
    if (ts.isStringLiteral(node) && node.text === getTableName(schema.enquiries)) {
      const parent = node.parent;
      const asTable = ts.isPropertyAssignment(parent) && parent.name.getText() === "table";
      const asIdentifier = ts.isCallExpression(parent) && parent.expression.getText() === "sql.identifier";
      if (asTable || asIdentifier) unplaced.push(finding(node, "the enquiries table given by name to a dynamic writer"));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const expectedRaw = RAW_SQL.get(file)?.count ?? 0;
  if (rawCount !== expectedRaw) {
    unplaced.push({ file, line: 0, within: "(file)", what: `${String(rawCount)} calls of sql.raw() with unread text, ${String(expectedRaw)} listed` });
  }
  return { cannotWriteName, carryTheCopies, listed, unplaced };
}

/** The UPDATE statements of enquiries in a migration that assign its name. */
function migrationNameWrites(text: string): readonly string[] {
  const statements = [...text.matchAll(/\bupdate\s+(?:only\s+)?"?enquiries"?(?:\s+(?:as\s+)?"?[a-z_]+"?)?\s+set\b([\s\S]*?)(?:;|\bwhere\b|\bfrom\b)/giu)];
  return statements.flatMap((match) => (/(?:^|[\s,(])"?name"?\s*=/iu.test(match[1] ?? "") ? [match[0].slice(0, 80)] : []));
}

describe("every writer of an enquiry's name carries the join's copies of it", () => {
  const judged = sourceFiles(SRC).map((path) => judge(relative(SRC, path).split("\\").join("/"), readFileSync(path, "utf8")));
  const all = (pick: (judgement: Judgement) => readonly Finding[]): readonly Finding[] => judged.flatMap(pick);

  it("places every write to the enquiries table in the production code", () => {
    expect(all((judgement) => judgement.unplaced)).toEqual([]);
  });

  it("finds the edit, which carries the copies, and the writers that cannot write the name", () => {
    expect(all((judgement) => judgement.carryTheCopies).map((place) => `${place.file} ${place.within}`))
      .toEqual(CARRY_THE_COPIES.map((entry) => `${entry.file} ${entry.within}`));
    // The transition, the first reply, the bind's link, the People Book's link and its two merges.
    expect(all((judgement) => judgement.cannotWriteName).filter((place) => place.what.startsWith(`update(${ENQUIRIES})`)).length)
      .toBeGreaterThanOrEqual(6);
  });

  it("still finds each listed dynamic writer where it is listed", () => {
    const listed = all((judgement) => judgement.listed);
    for (const entry of DYNAMIC_UPDATES) {
      expect(listed.some((place) => place.file === entry.file && place.within === entry.within), `${entry.file} ${entry.within}`).toBe(true);
    }
    expect(new Set(listed.filter((place) => place.what.startsWith("sql.raw")).map((place) => place.file))).toEqual(new Set(RAW_SQL.keys()));
  });

  it("finds no migration that assigns an enquiry's name", () => {
    const writes = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))
      .flatMap((name) => migrationNameWrites(readFileSync(join(MIGRATIONS, name), "utf8")).map((statement) => `${name}: ${statement}`));
    expect(writes).toEqual([]);
  });

  it("fails on a writer of the name that does not carry the copies, in each form it reads", () => {
    const offending = [
      "export async function rename(db) { await db.update(enquiries).set({ name: 'x' }); }",
      "export async function rename(db, input) { await db.update(enquiries).set({ ...input }); }",
      "import { enquiries as asked } from '../db/schema.js';\nexport async function rename(db) { await db.update(asked).set({ name: 'x' }); }",
      "export async function rename(db) { const t = enquiries; await db.update(t).set({ name: 'x' }); }",
      "export async function rename(db) { await db.execute(sql`update \"enquiries\" set \"name\" = ${'x'}`); }",
      "export async function rename(db) { await db.execute(sql`update ${enquiries} set \"name\" = ${'x'}`); }",
      "export async function rename(db, t) { await db.update(t).set({ name: 'x' }); }",
      "export async function rename(pool, t) { await pool.query(`update ${t} set name = $1`, ['x']); }",
      "export async function rename(db) { await db.insert(enquiries).values({}).onConflictDoUpdate({ target: enquiries.id, set: { name: 'x' } }); }",
      "export async function rename(db) { await reword(db, { table: \"enquiries\", columns: { name: 200 } }); }",
      "export async function writeEnquiryEdit(db, changes) { await db.update(enquiries).set(changes); }",
      // The copies keyed off a name given beside the changes, which may not be the one written.
      "export async function writeEnquiryEdit(tx, id, changes, name) { const [held] = name === undefined ? [] : await tx.select().from(enquiries); "
        + "await tx.update(enquiries).set(changes); await followEnquiryName(tx, { from: held.name, to: name }); }",
      // A set() given something other than the changes the name is read from.
      "export async function writeEnquiryEdit(tx, id, changes) { const name = changes.name; "
        + "await tx.update(enquiries).set({ ...changes, name: 'x' }); await followEnquiryName(tx, { from: name, to: name }); }",
    ];
    for (const text of offending) {
      const file = text.includes("writeEnquiryEdit") ? "routes/enquiries.ts" : "services/elsewhere.ts";
      expect(judge(file, text).unplaced.length, text).toBeGreaterThan(0);
    }
    expect(migrationNameWrites("UPDATE \"enquiries\" SET \"name\" = btrim(\"name\") WHERE true;")).toHaveLength(1);
    expect(migrationNameWrites("UPDATE enquiries e SET contact_id = c.id, guest_name = NULL FROM contacts c;")).toEqual([]);
  });
});

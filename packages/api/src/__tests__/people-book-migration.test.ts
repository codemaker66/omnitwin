import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableName } from "drizzle-orm";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  CLIENT_ACCOUNT_KINDS,
  CONTACT_POINT_KINDS,
  CONTACT_POINT_LABELS,
  MERGE_KINDS,
  PHONE_DIGITS_MAX,
  PHONE_DIGITS_MIN,
  VENUE_ACCESS_ENQUIRY_TYPE,
  VENVIEWER_PRICING_ENQUIRY_TYPE,
} from "@omnitwin/types";
import { accountMemberships, clientAccounts, contactKeptApart, contactPoints, contacts, recordMerges } from "../db/schema.js";

// ---------------------------------------------------------------------------
// The People Book's migration without a database: its place in the journal,
// the vocabularies @omnitwin/types states, the lock limit and idempotent DDL,
// and the Drizzle schema naming the same rules. The backfill itself is proven
// on PostgreSQL in people-book-migration-postgres.test.ts.
// ---------------------------------------------------------------------------

const DRIZZLE = resolve(import.meta.dirname, "../../drizzle");
// Provisional: the merge slot confirms the final number. A rename changes
// these two constants, the SQL file name and the journal entry.
const TAG = "0096_people_book";
const PREVIOUS = "0093_forward_book_checks";

const quoted = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(", ");

/** The backfill's working tables: temporary, the file's own, gone when it ends. */
const WORKING_TABLES = ["people_0096_enquiries", "people_0096_holders", "people_0096_enquirers", "people_0096_last_contact"] as const;
/** The working tables a later statement joins, so each carries a key. */
const KEYED_WORKING_TABLES = ["people_0096_enquiries", "people_0096_holders", "people_0096_last_contact"] as const;

async function migration(): Promise<string> {
  return readFile(resolve(DRIZZLE, `${TAG}.sql`), "utf8");
}

/** The SQL with its comments taken out, whitespace folded. */
function code(source: string): string {
  return source.replace(/--[^\n]*/gu, " ").replace(/\s+/gu, " ");
}

describe(`migration ${TAG}`, () => {
  it(`is the journal's next entry, after ${PREVIOUS}`, async () => {
    const journal = JSON.parse(await readFile(resolve(DRIZZLE, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string; breakpoints: boolean }[];
    };
    const index = journal.entries.findIndex((entry) => entry.tag === TAG);
    const entry = journal.entries[index];
    const previous = journal.entries[index - 1];
    expect(index).toBeGreaterThan(0);
    expect(previous?.tag).toBe(PREVIOUS);
    expect(entry?.idx).toBe((previous?.idx ?? -2) + 1);
    expect(entry?.when).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    expect(entry?.breakpoints).toBe(true);
  });

  it("holds the vocabularies @omnitwin/types states", async () => {
    const sql = code(await migration());
    expect(sql).toContain(`CHECK ("kind" IN (${quoted(CONTACT_POINT_KINDS)}))`);
    expect(sql).toContain(`CHECK ("label" IN (${quoted(CONTACT_POINT_LABELS)}))`);
    expect(sql).toContain(`CHECK ("kind" IN (${quoted(CLIENT_ACCOUNT_KINDS)}))`);
    expect(sql).toContain(`CHECK ("kind" IN (${quoted(MERGE_KINDS)}))`);
  });

  it("leaves out the enquiries that are not the venue's clients, and keeps only phones the API would take", async () => {
    const sql = code(await migration());
    // The workspace gate's access request and Venviewer's own pricing lead.
    expect(sql).toContain(`'${VENUE_ACCESS_ENQUIRY_TYPE}'`);
    expect(sql).toContain(`'${VENVIEWER_PRICING_ENQUIRY_TYPE}'`);
    expect(sql).toContain(`NOT IN (${quoted([VENUE_ACCESS_ENQUIRY_TYPE, VENVIEWER_PRICING_ENQUIRY_TYPE])})`);
    // isUsablePhone's digit range.
    expect(sql).toContain(`BETWEEN ${String(PHONE_DIGITS_MIN)} AND ${String(PHONE_DIGITS_MAX)}`);
  });

  it("waits at most five seconds for a lock and creates every table idempotently", async () => {
    const sql = code(await migration());
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    // The limit is for this file alone; later files in the same run wait as the migrator allows.
    expect(sql.trim().endsWith("SET LOCAL lock_timeout TO DEFAULT;")).toBe(true);
    for (const table of ["contact_points", "account_memberships", "contact_kept_apart", "record_merges"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
    expect(sql).not.toMatch(/\bADD COLUMN (?!IF NOT EXISTS)/u);
    expect(sql).not.toMatch(/\bCREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/u);
  });

  it("removes nothing: no row, table or column goes, and every rule it drops it adds again", async () => {
    const sql = code(await migration());
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/iu);
    expect(sql).not.toMatch(/\bTRUNCATE\b/iu);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/iu);
    // Only the backfill's own temporary tables go, each when it is done with.
    const tables = [...sql.matchAll(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)/giu)].map((match) => match[1]);
    expect(new Set(tables)).toEqual(new Set(WORKING_TABLES.map((table) => `pg_temp."${table}"`)));
    for (const table of WORKING_TABLES) expect(sql).toContain(`DROP TABLE pg_temp."${table}";`);
    const dropped = [...sql.matchAll(/DROP CONSTRAINT IF EXISTS "([a-z_]+)"/gu)].map((match) => match[1]);
    expect(dropped.length).toBeGreaterThan(0);
    for (const name of dropped) expect(sql).toContain(`ADD CONSTRAINT "${String(name)}"`);
  });

  it("analyses only its own working tables, keyed, never a table that existed before it", async () => {
    const sql = code(await migration());
    // Analysing a table production already has would change its planner statistics mid-deploy.
    const analysed = [...sql.matchAll(/\bANALYZE\b\s*([^\s;]*)/giu)].map((match) => match[1]);
    expect(new Set(analysed)).toEqual(new Set(KEYED_WORKING_TABLES.map((table) => `pg_temp."${table}"`)));
    for (const table of WORKING_TABLES) expect(sql).toContain(`CREATE TEMP TABLE "${table}" AS`);
    for (const table of KEYED_WORKING_TABLES) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE pg_temp\\."${table}" ADD PRIMARY KEY \\([^)]+\\);`, "u"));
    }
  });
});

describe(`the Drizzle schema matches ${TAG}`, () => {
  const dialect = new PgDialect();
  const checkSql = (table: PgTable, name: string): string => {
    const found = getTableConfig(table).checks.find((check) => check.name === name);
    if (found === undefined) throw new Error(`no check ${name} on ${getTableName(table)}`);
    return dialect.sqlToQuery(found.value).sql;
  };

  it("states the same vocabularies as @omnitwin/types", () => {
    expect(checkSql(contactPoints, "contact_points_kind_check")).toContain(`IN (${quoted(CONTACT_POINT_KINDS)})`);
    expect(checkSql(contactPoints, "contact_points_label_check")).toContain(`IN (${quoted(CONTACT_POINT_LABELS)})`);
    expect(checkSql(clientAccounts, "client_accounts_kind_check")).toContain(`IN (${quoted(CLIENT_ACCOUNT_KINDS)})`);
    expect(checkSql(recordMerges, "record_merges_kind_check")).toContain(`IN (${quoted(MERGE_KINDS)})`);
  });

  it("keeps every point, membership and kept-apart mark in its person's venue, and goes with the person", () => {
    const composite = (table: PgTable) => getTableConfig(table).foreignKeys
      .filter((key) => key.reference().columns.length === 2)
      .map((key) => ({
        name: key.getName(),
        onDelete: key.onDelete,
        to: getTableName(key.reference().foreignTable),
        foreignColumns: key.reference().foreignColumns.map((column) => column.name),
      }));
    expect(composite(contactPoints)).toEqual([
      { name: "contact_points_contact_venue_fk", onDelete: "cascade", to: "contacts", foreignColumns: ["id", "venue_id"] },
    ]);
    expect(composite(accountMemberships)).toEqual([
      { name: "account_memberships_contact_venue_fk", onDelete: "cascade", to: "contacts", foreignColumns: ["id", "venue_id"] },
      { name: "account_memberships_account_venue_fk", onDelete: "cascade", to: "client_accounts", foreignColumns: ["id", "venue_id"] },
    ]);
    expect(composite(contactKeptApart)).toEqual([
      { name: "contact_kept_apart_low_venue_fk", onDelete: "cascade", to: "contacts", foreignColumns: ["id", "venue_id"] },
      { name: "contact_kept_apart_high_venue_fk", onDelete: "cascade", to: "contacts", foreignColumns: ["id", "venue_id"] },
    ]);
    expect(getTableConfig(contacts).uniqueConstraints.map((unique) => unique.getName())).toContain("contacts_id_venue_unique");
    expect(getTableConfig(clientAccounts).uniqueConstraints.map((unique) => unique.getName())).toContain("client_accounts_id_venue_unique");
  });
});

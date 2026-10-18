import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SQL, is } from "drizzle-orm";
import { PgDialect, getTableConfig, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import { Pool, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  VENUE_ACCESS_ENQUIRY_TYPE,
  VENVIEWER_PRICING_ENQUIRY_TYPE,
  isUsablePhone,
  normaliseEmail,
  normalisePhone,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// The People Book's migration on isolated PostgreSQL (T-665).
//
// The tables are built as the release before it defined them, the rows the
// commercial routes have written meet the migration exactly as it ships, in
// one transaction as the migrator runs it, and then: every contact has its
// email and phone as points, every converted enquiry and every enquirer has a
// person, nothing is guessed where two people share an email, seed fixtures
// are left alone, a second run changes nothing, and the previous API still
// writes.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("People Book migration tests require their explicit isolated loopback database");
  }
}

// Provisional: the merge slot confirms the final number (see people-book-migration.test.ts).
const TAG = "0096_people_book";

// Task 1's cases (packages/types/src/__tests__/people.test.ts), listed again:
// the SQL function must agree with normalisePhone on every one.
const PHONE_CASES = [
  ["07700 900123", "07700900123"], ["+44 7700 900123", "07700900123"], ["0044 7700 900123", "07700900123"],
  ["00 44 7700 900123", "07700900123"], ["+44 (0)141 496 0000", "01414960000"], ["+44 0141 496 0000", "01414960000"],
  ["(0141) 496-0000", "01414960000"], ["+1 (212) 555-0100", "+12125550100"], ["44 141 496 0000", "441414960000"],
  ["0141 496 0000 ext 12", "0141496000012"], ["+44", null], ["+", null], ["  ", null], ["", null],
] as const;

/** The columns the migration adds to tables that already exist. */
const ADDED: Readonly<Record<string, readonly string[]>> = {
  contacts: [
    "given_name", "family_name", "job_title", "postal_address", "notes", "owner_user_id", "last_contact_at",
    "source_system", "source_id", "merged_into_id", "erased_at",
  ],
  client_accounts: [
    "kind", "address", "website", "vat_number", "notes", "owner_user_id", "source_system", "source_id", "merged_into_id",
  ],
  enquiries: ["contact_id"],
};

/** The keys, rules and indexes the migration adds to tables that already exist. */
const ADDED_RULES: Readonly<Record<string, readonly string[]>> = {
  contacts: [
    "contacts_source_pair_check", "contacts_not_merged_into_self", "contacts_id_venue_unique",
    "contacts_venue_source_unique", "contacts_merged_into_idx", "contacts_owner_idx",
  ],
  client_accounts: [
    "client_accounts_source_pair_check", "client_accounts_not_merged_into_self", "client_accounts_id_venue_unique",
    "client_accounts_venue_source_unique", "client_accounts_merged_into_idx", "client_accounts_owner_idx",
    "client_accounts_kind_check",
  ],
  enquiries: ["enquiries_contact_idx"],
};

const NEW_TABLES: readonly PgTable[] = [schema.contactPoints, schema.accountMemberships, schema.contactKeptApart, schema.recordMerges];
const EXISTING_TABLES: readonly PgTable[] = [
  schema.venues, schema.users, schema.opportunities, schema.activities, schema.proposals, schema.guestLeads,
  schema.clientAccounts, schema.contacts, schema.enquiries,
];

const dialect = new PgDialect();

function literal(value: unknown): string {
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

/** A column's declared default as PostgreSQL's catalogue prints it. */
function declaredDefault(column: PgColumn): string | null {
  const value: unknown = column.default;
  if (value === undefined) return null;
  if (is(value, SQL)) return dialect.sqlToQuery(value).sql;
  if (typeof value === "string") return `${literal(value)}::${column.getSQLType().startsWith("varchar") ? "character varying" : "text"}`;
  return literal(value);
}

/** The table as the release before the migration defined it. */
function legacyTable(table: PgTable): string {
  const config = getTableConfig(table);
  const added = ADDED[config.name] ?? [];
  expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([...added]));
  const columns = config.columns.filter((column) => !added.includes(column.name)).map((column) => {
    if (column.name === "id") return `"id" ${column.getSQLType()} PRIMARY KEY DEFAULT gen_random_uuid()`;
    const value: unknown = column.default;
    const defaultSql = value === undefined ? "" : ` DEFAULT ${is(value, SQL) ? dialect.sqlToQuery(value).sql : literal(value)}`;
    // Before the migration a contact always had an email.
    const notNull = column.notNull || (config.name === "contacts" && column.name === "email");
    return `"${column.name}" ${column.getSQLType()}${defaultSql}${notNull ? " NOT NULL" : ""}`;
  });
  return `CREATE TABLE "${config.name}" (${columns.join(", ")})`;
}

interface ColumnShape {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultValue: string | null;
}

const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function declaredColumns(table: PgTable, names?: readonly string[]): ColumnShape[] {
  return getTableConfig(table).columns
    .filter((column) => names === undefined || names.includes(column.name))
    .map((column) => ({ name: column.name, type: column.getSQLType(), notNull: column.notNull, defaultValue: declaredDefault(column) }))
    .sort(byName);
}

function declaredRules(table: PgTable): string[] {
  const config = getTableConfig(table);
  return [
    ...config.checks.map((check) => check.name),
    ...config.uniqueConstraints.map((unique) => unique.getName()),
    ...config.indexes.map((index) => index.config.name),
    // The composite keys are the named ones; single-column references are inline.
    ...config.foreignKeys.filter((key) => key.reference().columns.length > 1).map((key) => key.getName()),
  ].filter((name): name is string => name !== undefined);
}

async function readMigration(): Promise<string> {
  return readFile(resolve(import.meta.dirname, "../../drizzle", `${TAG}.sql`), "utf8");
}

async function applyMigration(pool: Pool, migration: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type PointRow = { kind: string; value: string; display_value: string; label: string; is_primary: boolean };
type ContactRow = {
  id: string; venue_id: string; name: string; email: string | null; phone: string | null;
  source_enquiry_id: string | null; created_at: Date; last_contact_at: Date | null;
  deleted_at: Date | null; merged_into_id: string | null;
};

describe.skipIf(testUrl === undefined)(`migration ${TAG} on isolated PostgreSQL`, () => {
  const fixtureSchema = `people_book_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  const venueA = randomUUID();
  const venueB = randomUUID();
  const room = randomUUID();
  const euan = randomUUID();
  const ids = {
    e1: randomUUID(), e3: randomUUID(), e4: randomUUID(), e5: randomUUID(), e6: randomUUID(), e7: randomUUID(),
    e8: randomUUID(), e9: randomUUID(), e10: randomUUID(),
    // Not the venue's clients: an access request and a pricing lead from new
    // emails, an access request from Iain's email, and a signed-in draft.
    accessNew: randomUUID(), pricingNew: randomUUID(), accessIain: randomUUID(), draftNew: randomUUID(), draftIain: randomUUID(),
    acc1: randomUUID(), acc2: randomUUID(), acc3: randomUUID(), acc4: randomUUID(),
    c1: randomUUID(), c2: randomUUID(), c3: randomUUID(), c4: randomUUID(), c5: randomUUID(),
    d1: randomUUID(),
    // Fraser's only holder was deleted; the long address no column could hold.
    c6: randomUUID(), e11: randomUUID(), e12: randomUUID(),
  };
  const longAddress = `${"a".repeat(250)}@example.test`;
  /** Contacts whose phone the API would refuse, and one it would take. */
  const phones = [
    { id: randomUUID(), raw: "+44", kept: null, point: null },
    { id: randomUUID(), raw: "TBC", kept: null, point: null },
    { id: randomUUID(), raw: "12345", kept: null, point: null },
    { id: randomUUID(), raw: "07700 900123", kept: "07700 900123", point: "07700900123" },
  ] as const;
  const at = {
    e1: "2026-03-01T10:00:00.000Z", e3: "2026-03-10T10:00:00.000Z", e4: "2026-03-12T10:00:00.000Z",
    e5: "2026-03-20T10:00:00.000Z", e6: "2026-04-01T10:00:00.000Z", e7: "2026-05-01T10:00:00.000Z",
    e8: "2026-04-15T10:00:00.000Z", e9: "2026-06-01T10:00:00.000Z", e10: "2026-06-02T10:00:00.000Z",
    c1: "2026-03-01T11:00:00.000Z", d1: "2026-03-01T12:00:00.000Z", activity: "2026-03-02T09:00:00.000Z",
    proposalWritten: "2026-03-04T09:00:00.000Z", proposalSent: "2026-03-05T14:00:00.000Z",
    others: "2026-02-01T10:00:00.000Z", e11: "2026-07-01T10:00:00.000Z", e12: "2026-07-02T10:00:00.000Z",
  };
  let emailWasRequired = "";
  let migration = "";

  const query = async <T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await pool.query<T>(text, values)).rows;
  const one = async <T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T> => {
    const [row] = await query<T>(text, values);
    if (row === undefined) throw new Error(`No row for ${text}`);
    return row;
  };

  beforeAll(async () => {
    migration = await readMigration();
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 2, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of EXISTING_TABLES) await pool.query(legacyTable(table));
    emailWasRequired = (await one<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'contacts' AND column_name = 'email'",
      [fixtureSchema],
    )).is_nullable;

    await pool.query(
      `INSERT INTO venues (id, name, slug, address, created_at, updated_at) VALUES
        ($1, 'Fixture Hall A', 'fixture-hall-a', '1 Fixture Street', $3, $3),
        ($2, 'Fixture Hall B', 'fixture-hall-b', '2 Fixture Street', $3, $3)`,
      [venueA, venueB, at.others],
    );
    await pool.query(
      `INSERT INTO users (id, email, name, role, venue_id, created_at, updated_at)
       VALUES ($1, 'planner@example.test', 'Euan Stewart', 'planner', NULL, $2, $2)`,
      [euan, at.others],
    );

    const enquiry = async (id: string, venue: string, createdAt: string, fields: {
      guestName?: string; guestEmail?: string; guestPhone?: string; userId?: string; name: string; email: string; fixture?: string;
      state?: string; eventType?: string;
    }): Promise<void> => {
      await pool.query(
        `INSERT INTO enquiries (id, venue_id, space_id, user_id, guest_email, guest_phone, guest_name, state, name, email,
           event_type, created_at, updated_at, fixture_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13)`,
        [id, venue, room, fields.userId ?? null, fields.guestEmail ?? null, fields.guestPhone ?? null, fields.guestName ?? null,
          fields.state ?? "submitted", fields.name, fields.email, fields.eventType ?? null, createdAt, fields.fixture ?? null],
      );
    };
    const aileen = " Aileen.Murray@Example.TEST ";
    await enquiry(ids.e1, venueA, at.e1, { guestName: "Aileen Murray", guestEmail: aileen, guestPhone: "+44 7700 900123", name: "Aileen Murray", email: aileen });
    for (const [id, createdAt] of [[ids.e3, at.e3], [ids.e4, at.e4], [ids.e5, at.e5]] as const) {
      await enquiry(id, venueA, createdAt, { guestName: "Morag Shaw", guestEmail: "morag@example.test", name: "Morag Shaw", email: "morag@example.test" });
    }
    await enquiry(ids.e6, venueA, at.e6, { guestName: "Kirsty Lane", guestEmail: "Kirsty@Example.test", guestPhone: "0141 496 0001", name: "Kirsty Lane", email: "Kirsty@Example.test" });
    await enquiry(ids.e7, venueA, at.e7, { guestName: "Kirsty Lane-Brown", guestEmail: "kirsty@example.test ", name: "Kirsty Lane-Brown", email: "kirsty@example.test " });
    // Five digits: it normalises, but the API would refuse it as a phone.
    await enquiry(ids.e8, venueB, at.e8, { guestName: "K. Lane", guestEmail: "kirsty@example.test", guestPhone: "12345", name: "K. Lane", email: "kirsty@example.test" });
    await enquiry(ids.e9, venueA, at.e9, { userId: euan, name: "Euan Stewart", email: "planner@example.test" });
    await enquiry(ids.e10, venueA, at.e10, { guestName: "Seed Guest", guestEmail: "seed@example.test", name: "Seed Guest", email: "seed@example.test", fixture: "demo-seed" });
    await enquiry(ids.accessNew, venueA, at.e9, {
      guestName: "Rhona Access", guestEmail: "access@example.test", name: "Rhona Access", email: "access@example.test", eventType: VENUE_ACCESS_ENQUIRY_TYPE,
    });
    await enquiry(ids.pricingNew, venueA, at.e9, {
      guestName: "Leith Hall", guestEmail: "pricing@example.test", name: "Leith Hall", email: "pricing@example.test", eventType: VENVIEWER_PRICING_ENQUIRY_TYPE,
    });
    await enquiry(ids.accessIain, venueA, at.e9, {
      guestName: "Iain Robertson", guestEmail: "iain@example.test", name: "Iain Robertson", email: "iain@example.test", eventType: VENUE_ACCESS_ENQUIRY_TYPE,
    });
    await enquiry(ids.draftNew, venueA, at.e9, { userId: euan, name: "Draft Planner", email: "draft@example.test", state: "draft" });
    await enquiry(ids.draftIain, venueA, at.e9, { userId: euan, name: "Iain Robertson", email: "iain@example.test", state: "draft" });
    await enquiry(ids.e11, venueA, at.e11, { guestName: "Fraser Ross", guestEmail: "Fraser@Example.test", name: "Fraser Ross", email: "Fraser@Example.test" });
    // guest_email is unbounded text; the 255-character email column holds the short form.
    await enquiry(ids.e12, venueA, at.e12, { guestName: "Long Address", guestEmail: longAddress, name: "Long Address", email: "long.address@example.test" });
    // The guest lead the public route keeps for Kirsty, last written by venue B's form. It is not a person.
    await pool.query(
      `INSERT INTO guest_leads (email, phone, name, first_enquiry_id, created_at, updated_at)
       VALUES ('kirsty@example.test', '07700 900999', 'Overwritten By B', $1, $2, $2)`,
      [ids.e6, at.e6],
    );

    const account = async (id: string, name: string, primaryContact: string, sourceEnquiry: string | null): Promise<void> => {
      await pool.query(
        `INSERT INTO client_accounts (id, venue_id, name, account_type, primary_contact_id, source_enquiry_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'event_client', $4, $5, $6, $6)`,
        [id, venueA, name, primaryContact, sourceEnquiry, at.c1],
      );
    };
    await account(ids.acc1, "aileen murray ", ids.c1, ids.e1);
    await account(ids.acc2, "Glasgow Medical Society", ids.c2, null);
    await account(ids.acc3, "Morag Shaw", ids.c3, ids.e3);
    await account(ids.acc4, "Morag Shaw", ids.c4, ids.e4);

    const contact = async (id: string, fields: {
      name: string; email: string; phone?: string; account?: string; role?: string; sourceEnquiry?: string; createdAt: string;
    }): Promise<void> => {
      await pool.query(
        `INSERT INTO contacts (id, venue_id, client_account_id, name, email, phone, role_label, source_enquiry_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [id, venueA, fields.account ?? null, fields.name, fields.email, fields.phone ?? null, fields.role ?? null,
          fields.sourceEnquiry ?? null, fields.createdAt],
      );
    };
    await contact(ids.c1, { name: "Aileen Murray", email: aileen, phone: "+44 7700 900123", account: ids.acc1, role: "Primary event contact", sourceEnquiry: ids.e1, createdAt: at.c1 });
    await contact(ids.c2, { name: "Iain Robertson", email: "iain@example.test", account: ids.acc2, createdAt: at.others });
    await contact(ids.c3, { name: "Morag Shaw", email: "morag@example.test", account: ids.acc3, role: "Primary event contact", sourceEnquiry: ids.e3, createdAt: at.e3 });
    await contact(ids.c4, { name: "Morag Shaw", email: "morag@example.test", account: ids.acc4, role: "Primary event contact", sourceEnquiry: ids.e4, createdAt: at.e4 });
    await contact(ids.c5, { name: "Blank Email", email: "   ", createdAt: at.others });
    for (const [index, entry] of phones.entries()) {
      await contact(entry.id, { name: `Phone Case ${String(index)}`, email: `phone.case.${String(index)}@example.test`, phone: entry.raw, createdAt: at.others });
    }
    await contact(ids.c6, { name: "Fraser Ross", email: "fraser@example.test", createdAt: at.others });
    await pool.query("UPDATE contacts SET deleted_at = $2 WHERE id = $1", [ids.c6, at.others]);

    await pool.query(
      `INSERT INTO opportunities (id, venue_id, client_account_id, primary_contact_id, source_enquiry_id, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Wedding — Aileen Murray', $6, $6)`,
      [ids.d1, venueA, ids.acc1, ids.c1, ids.e1, at.d1],
    );
    await pool.query(
      "INSERT INTO activities (opportunity_id, type, body, created_at) VALUES ($1, 'note', 'Called about the Saloon.', $2)",
      [ids.d1, at.activity],
    );
    await pool.query(
      `INSERT INTO proposals (venue_id, opportunity_id, enquiry_id, title, status, current_version, sent_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'Murray wedding', 'sent', 1, $4, $5, $4)`,
      [venueA, ids.d1, ids.e1, at.proposalSent, at.proposalWritten],
    );

    // The migration exactly as it ships, in one transaction as the migrator runs it.
    await applyMigration(pool, migration);
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) {
      // Only the random schema created by this invocation is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  });

  const contactRow = async (id: string): Promise<ContactRow> => one<ContactRow>("SELECT * FROM contacts WHERE id = $1", [id]);
  const pointsOf = async (contactId: string): Promise<PointRow[]> => query<PointRow>(
    "SELECT kind, value, display_value, label, is_primary FROM contact_points WHERE contact_id = $1 ORDER BY kind, value",
    [contactId],
  );
  const contactOf = async (enquiryId: string): Promise<string | null> =>
    (await one<{ contact_id: string | null }>("SELECT contact_id FROM enquiries WHERE id = $1", [enquiryId])).contact_id;
  const holders = async (venueId: string, email: string): Promise<ContactRow[]> => query<ContactRow>(
    `SELECT c.* FROM contacts c JOIN contact_points p ON p.contact_id = c.id
      WHERE p.venue_id = $1 AND p.kind = 'email' AND p.value = $2 ORDER BY c.id`,
    [venueId, email],
  );

  async function storedColumns(table: string, names?: readonly string[]): Promise<ColumnShape[]> {
    const rows = await query<{ name: string; type: string; not_null: boolean; default_value: string | null }>(
      `SELECT column_name AS name,
              CASE WHEN data_type = 'character varying' THEN 'varchar(' || character_maximum_length || ')' ELSE data_type END AS type,
              is_nullable = 'NO' AS not_null, column_default AS default_value
         FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [fixtureSchema, table],
    );
    return rows
      .filter((row) => names === undefined || names.includes(row.name))
      .map((row) => ({ name: row.name, type: row.type, notNull: row.not_null, defaultValue: row.default_value }))
      .sort(byName);
  }

  async function storedRules(table: string): Promise<string[]> {
    const rows = await query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint WHERE conrelid = format('%I.%I', $1::text, $2::text)::regclass
       UNION SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
      [fixtureSchema, table],
    );
    return rows.map((row) => row.name).filter((name) => name !== `${table}_pkey` && !name.endsWith("_fkey")).sort();
  }

  it("makes email optional and adds the columns as the Drizzle schema declares them", async () => {
    expect(emailWasRequired).toBe("NO");
    const [email] = await storedColumns("contacts", ["email"]);
    expect(email).toEqual({ name: "email", type: "varchar(255)", notNull: false, defaultValue: null });
    expect(declaredColumns(schema.contacts, ["email"])).toEqual([email]);
    for (const table of [schema.contacts, schema.clientAccounts, schema.enquiries]) {
      const name = getTableConfig(table).name;
      const added = ADDED[name] ?? [];
      expect(await storedColumns(name, added)).toEqual(declaredColumns(table, added));
      // Nothing the schema declares is missing from the table, and nothing more is there.
      expect((await storedColumns(name)).map((column) => column.name)).toEqual(declaredColumns(table).map((column) => column.name));
    }
    for (const table of NEW_TABLES) {
      expect(await storedColumns(getTableConfig(table).name)).toEqual(declaredColumns(table));
    }
    expect(await storedColumns("client_accounts", ["kind"])).toEqual([
      { name: "kind", type: "varchar(20)", notNull: true, defaultValue: "'household'::character varying" },
    ]);
  });

  it("names every key, rule and index as the Drizzle schema does", async () => {
    for (const table of NEW_TABLES) {
      expect(await storedRules(getTableConfig(table).name)).toEqual(declaredRules(table).sort());
    }
    for (const table of [schema.contacts, schema.clientAccounts, schema.enquiries]) {
      const name = getTableConfig(table).name;
      const added = [...(ADDED_RULES[name] ?? [])].sort();
      expect(declaredRules(table)).toEqual(expect.arrayContaining(added));
      expect(await storedRules(name)).toEqual(added);
    }
  });

  it("gives each contact its email and phone as primary points, normalised, and trims the mirror", async () => {
    expect(await pointsOf(ids.c1)).toEqual([
      { kind: "email", value: "aileen.murray@example.test", display_value: "Aileen.Murray@Example.TEST", label: "other", is_primary: true },
      { kind: "phone", value: "07700900123", display_value: "+44 7700 900123", label: "other", is_primary: true },
    ]);
    expect(await contactRow(ids.c1)).toMatchObject({ email: "Aileen.Murray@Example.TEST", phone: "+44 7700 900123" });
    expect(await pointsOf(ids.c2)).toEqual([
      { kind: "email", value: "iain@example.test", display_value: "iain@example.test", label: "other", is_primary: true },
    ]);
    const venues = await query<{ venue_id: string }>("SELECT DISTINCT p.venue_id FROM contact_points p WHERE p.contact_id = ANY($1)", [[ids.c1, ids.c2]]);
    expect(venues).toEqual([{ venue_id: venueA }]);
  });

  it("turns a blank email into none and gives it no point", async () => {
    expect((await contactRow(ids.c5)).email).toBeNull();
    expect(await pointsOf(ids.c5)).toEqual([]);
  });

  it("keeps only a phone the API would take, as the mirror and as a point", async () => {
    for (const entry of phones) {
      expect((await contactRow(entry.id)).phone, entry.raw).toBe(entry.kept);
      const phonePoints = (await pointsOf(entry.id)).filter((point) => point.kind === "phone");
      expect(phonePoints, entry.raw).toEqual(entry.point === null ? [] : [
        { kind: "phone", value: entry.point, display_value: entry.raw, label: "other", is_primary: true },
      ]);
    }
    // What the person typed on their enquiry stays as they typed it.
    expect(await one("SELECT guest_phone FROM enquiries WHERE id = $1", [ids.e8])).toEqual({ guest_phone: "12345" });
  });

  it("leaves out the enquiries that are not the venue's clients: access requests, pricing leads and drafts", async () => {
    for (const id of [ids.accessNew, ids.pricingNew, ids.accessIain, ids.draftNew, ids.draftIain]) {
      expect(await contactOf(id)).toBeNull();
    }
    for (const email of ["access@example.test", "pricing@example.test", "draft@example.test"]) {
      expect(await holders(venueA, email), email).toEqual([]);
    }
    expect(await query("SELECT id FROM contacts WHERE name IN ('Rhona Access', 'Leith Hall', 'Draft Planner')")).toEqual([]);
    // Iain is one live person, but his access request and his unsent draft are not a client's enquiry.
    expect((await holders(venueA, "iain@example.test")).map((row) => row.id)).toEqual([ids.c2]);
  });

  it("makes each contact a member of its account, as its primary", async () => {
    const memberships = await query<{ venue_id: string; client_account_id: string; role_label: string | null; is_primary: boolean }>(
      "SELECT venue_id, client_account_id, role_label, is_primary FROM account_memberships WHERE contact_id = $1",
      [ids.c1],
    );
    expect(memberships).toEqual([{ venue_id: venueA, client_account_id: ids.acc1, role_label: "Primary event contact", is_primary: true }]);
    expect((await one<{ count: number }>("SELECT count(*)::int AS count FROM account_memberships WHERE contact_id = $1", [ids.c5])).count).toBe(0);
  });

  it("calls an account named after its contact a household, and the rest organisations", async () => {
    const kinds = await query<{ id: string; kind: string }>("SELECT id, kind FROM client_accounts WHERE id = ANY($1)", [[ids.acc1, ids.acc2]]);
    expect(Object.fromEntries(kinds.map((row) => [row.id, row.kind]))).toEqual({ [ids.acc1]: "household", [ids.acc2]: "organisation" });
  });

  it("links each converted enquiry to the contact made from it", async () => {
    expect(await contactOf(ids.e1)).toBe(ids.c1);
    expect(await contactOf(ids.e3)).toBe(ids.c3);
    expect(await contactOf(ids.e4)).toBe(ids.c4);
  });

  it("keeps today's duplicates apart and links nothing to an email two of them hold", async () => {
    for (const id of [ids.c3, ids.c4]) {
      expect(await contactRow(id)).toMatchObject({ deleted_at: null, merged_into_id: null });
    }
    expect((await holders(venueA, "morag@example.test")).map((row) => row.id)).toEqual([ids.c3, ids.c4].sort());
    expect(await contactOf(ids.e5)).toBeNull();
  });

  it("makes one person per venue for an enquirer who had none, from that venue's own enquiries", async () => {
    const [kirsty, ...othersAtA] = await holders(venueA, "kirsty@example.test");
    expect(othersAtA).toEqual([]);
    if (kirsty === undefined) throw new Error("no person for Kirsty at venue A");
    expect(kirsty).toMatchObject({
      venue_id: venueA, name: "Kirsty Lane-Brown", email: "kirsty@example.test", phone: "0141 496 0001", source_enquiry_id: ids.e6,
    });
    expect(kirsty.created_at.toISOString()).toBe(at.e6);
    expect(await pointsOf(kirsty.id)).toEqual([
      { kind: "email", value: "kirsty@example.test", display_value: "kirsty@example.test", label: "other", is_primary: true },
      { kind: "phone", value: "01414960001", display_value: "0141 496 0001", label: "other", is_primary: true },
    ]);
    expect(await contactOf(ids.e6)).toBe(kirsty.id);
    expect(await contactOf(ids.e7)).toBe(kirsty.id);

    const [atB, ...othersAtB] = await holders(venueB, "kirsty@example.test");
    expect(othersAtB).toEqual([]);
    if (atB === undefined) throw new Error("no person for Kirsty at venue B");
    expect(atB).toMatchObject({ venue_id: venueB, name: "K. Lane", email: "kirsty@example.test", phone: null, source_enquiry_id: ids.e8 });
    expect(await contactOf(ids.e8)).toBe(atB.id);

    expect(await query("SELECT id FROM contacts WHERE name = 'Overwritten By B' OR phone = '07700 900999'")).toEqual([]);
    expect(await query("SELECT id FROM contact_points WHERE kind = 'phone' AND value = '07700900999'")).toEqual([]);
  });

  it("makes a person for a signed-in enquirer", async () => {
    const [person, ...others] = await holders(venueA, "planner@example.test");
    expect(others).toEqual([]);
    if (person === undefined) throw new Error("no person for the signed-in enquirer");
    expect(person).toMatchObject({ name: "Euan Stewart", email: "planner@example.test", phone: null, source_enquiry_id: ids.e9 });
    expect(await contactOf(ids.e9)).toBe(person.id);
  });

  it("leaves seed fixtures alone", async () => {
    expect(await contactOf(ids.e10)).toBeNull();
    expect(await query("SELECT id FROM contact_points WHERE value = 'seed@example.test'")).toEqual([]);
    expect(await query("SELECT id FROM contacts WHERE name = 'Seed Guest'")).toEqual([]);
  });

  it("does not count a deleted person as holding an email: the enquirer gets a person of their own", async () => {
    const holdersOfFraser = await holders(venueA, "fraser@example.test");
    expect(holdersOfFraser.map((row) => row.id)).toContain(ids.c6);
    const [fraser, ...others] = holdersOfFraser.filter((row) => row.id !== ids.c6);
    expect(others).toEqual([]);
    if (fraser === undefined) throw new Error("no person for Fraser");
    expect(fraser).toMatchObject({ name: "Fraser Ross", email: "Fraser@Example.test", phone: null, source_enquiry_id: ids.e11, deleted_at: null });
    expect(fraser.created_at.toISOString()).toBe(at.e11);
    expect(fraser.last_contact_at?.toISOString()).toBe(at.e11);
    expect(await contactOf(ids.e11)).toBe(fraser.id);
    expect(await contactRow(ids.c6)).toMatchObject({ email: "fraser@example.test", last_contact_at: null });
    expect((await contactRow(ids.c6)).deleted_at).not.toBeNull();
  });

  it("leaves out an email longer than its column, rather than cut it short", async () => {
    expect(await contactOf(ids.e12)).toBeNull();
    expect(await query("SELECT id FROM contacts WHERE name = 'Long Address'")).toEqual([]);
    expect(await query("SELECT id FROM contact_points WHERE value LIKE 'aaaa%'")).toEqual([]);
  });

  it("leaves none of its working tables behind", async () => {
    expect(await query("SELECT relname FROM pg_class WHERE relpersistence = 't' AND relname LIKE 'people\\_0096\\_%'")).toEqual([]);
  });

  it("dates each person's last contact from their latest enquiry, deal, activity or proposal", async () => {
    expect((await contactRow(ids.c1)).last_contact_at?.toISOString()).toBe(at.proposalSent);
    const [kirsty] = await holders(venueA, "kirsty@example.test");
    expect(kirsty?.last_contact_at?.toISOString()).toBe(at.e7);
    // Nothing has happened with Iain yet.
    expect((await contactRow(ids.c2)).last_contact_at).toBeNull();
  });

  it("normalises in SQL exactly as @omnitwin/types does", async () => {
    const inputs: (string | null)[] = [...PHONE_CASES.map(([raw]) => raw), " Aileen.Murray@Example.TEST ", "\tkirsty@example.test\n", null];
    for (const input of inputs) {
      const row = await one<{ phone: string | null; email: string | null }>(
        "SELECT people_normalise_phone($1) AS phone, people_normalise_email($1) AS email",
        [input],
      );
      expect(row, JSON.stringify(input)).toEqual({ phone: normalisePhone(input), email: normaliseEmail(input) });
    }
    for (const [raw, expected] of PHONE_CASES) expect(normalisePhone(raw)).toBe(expected);
    // The live rule for a usable phone: it normalises, with 6 to 15 digits.
    for (const raw of [...PHONE_CASES.map(([input]) => input), "12345", "+44 7700 900123 456789", "call me"]) {
      const row = await one<{ usable: boolean }>("SELECT people_usable_phone($1) AS usable", [raw]);
      expect(row.usable, raw).toBe(isUsablePhone(raw));
    }
    expect(await one("SELECT people_usable_phone(NULL) AS usable")).toEqual({ usable: false });
  });

  it("changes nothing when run again", async () => {
    const tables = ["contacts", "contact_points", "account_memberships", "client_accounts", "enquiries"];
    const read = async (): Promise<Record<string, unknown>> => {
      const state: Record<string, unknown> = {};
      for (const table of tables) state[table] = await query(`SELECT * FROM "${table}" ORDER BY id`);
      state["rules"] = await query(
        `SELECT conrelid::regclass::text AS on_table, conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint WHERE connamespace = $1::text::regnamespace ORDER BY 1, 2`,
        [fixtureSchema],
      );
      state["indexes"] = await query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY 1, 2", [fixtureSchema]);
      return state;
    };
    const before = await read();
    await applyMigration(pool, migration);
    expect(await read()).toEqual(before);
  });

  it("lets the previous API keep writing, and holds the new rules", async () => {
    // The previous release, still serving in the pre-deploy window, writes neither kind nor any point.
    const enquiryId = randomUUID();
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, space_id, guest_email, guest_name, state, name, email)
       VALUES ($1, $2, $3, 'fiona@example.test', 'Fiona Kerr', 'submitted', 'Fiona Kerr', 'fiona@example.test')`,
      [enquiryId, venueA, room],
    );
    const account = await one<{ id: string; kind: string }>(
      "INSERT INTO client_accounts (venue_id, name, account_type, source_enquiry_id) VALUES ($1, 'Fiona Kerr', 'event_client', $2) RETURNING id, kind",
      [venueA, enquiryId],
    );
    expect(account.kind).toBe("household");
    await pool.query(
      `INSERT INTO contacts (venue_id, client_account_id, name, email, phone, role_label, source_enquiry_id)
       VALUES ($1, $2, 'Fiona Kerr', 'fiona@example.test', NULL, 'Primary event contact', $3)`,
      [venueA, account.id, enquiryId],
    );
    expect(await contactOf(enquiryId)).toBeNull();
    await pool.query("INSERT INTO contacts (venue_id, name, email) VALUES ($1, 'No Email Yet', NULL)", [venueA]);

    const point = (venueId: string, fields: { kind: string; value: string; label?: string; primary: boolean }) => pool.query(
      `INSERT INTO contact_points (venue_id, contact_id, kind, value, display_value, label, is_primary)
       VALUES ($1, $2, $3, $4, $4, $5, $6)`,
      [venueId, ids.c1, fields.kind, fields.value, fields.label ?? "other", fields.primary],
    );
    await expect(point(venueA, { kind: "email", value: "aileen@example.test", primary: true })).rejects.toMatchObject({ code: "23505" });
    await expect(point(venueB, { kind: "email", value: "aileen@example.test", primary: false })).rejects.toMatchObject({ code: "23503" });
    await expect(point(venueA, { kind: "phone", value: "01414960002", label: "fax", primary: false })).rejects.toMatchObject({ code: "23514" });
    await point(venueA, { kind: "email", value: "aileen@example.test", label: "work", primary: false });

    await expect(pool.query(
      "INSERT INTO record_merges (venue_id, kind, survivor_id, merged_id, snapshot, moves) VALUES ($1, 'person', $2, $2, '{}', '[]')",
      [venueA, ids.c3],
    )).rejects.toMatchObject({ code: "23514" });

    const [low, high] = [ids.c3, ids.c4].sort();
    const mark = (venueId: string, first: string | undefined, second: string | undefined) => pool.query<{ id: string }>(
      "INSERT INTO contact_kept_apart (venue_id, low_contact_id, high_contact_id) VALUES ($1, $2, $3) RETURNING id",
      [venueId, first, second],
    );
    await expect(mark(venueA, low, low)).rejects.toMatchObject({ code: "23514" });
    await expect(mark(venueA, high, low)).rejects.toMatchObject({ code: "23514" });
    // Before any live mark for the pair, so the venue key, not the pair key, refuses it.
    await expect(mark(venueB, low, high)).rejects.toMatchObject({ code: "23503" });
    const first = await mark(venueA, low, high);
    await expect(mark(venueA, low, high)).rejects.toMatchObject({ code: "23505" });
    await pool.query("UPDATE contact_kept_apart SET withdrawn_at = now() WHERE id = $1", [first.rows[0]?.id]);
    await mark(venueA, low, high);
    expect((await one<{ count: number }>("SELECT count(*)::int AS count FROM contact_kept_apart WHERE low_contact_id = $1", [low])).count).toBe(2);
  });
});

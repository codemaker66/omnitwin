import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { ClientAccountKind } from "@omnitwin/types";
import type { Database } from "../../db/client.js";
import * as schema from "../../db/schema.js";

// ---------------------------------------------------------------------------
// The People Book's shared fixture on the migrated disposable platform
// database (T-665). Tasks 5 to 12 open it.
//
// Each fixture makes its own two venues (slug = id), a real users row for
// every role a People Book test needs, and removes all of it on close, so
// files and runs never meet. People, their points and memberships and the
// marks that keep two apart are written by SQL, normalised by the
// migration's own functions, so a test sees the rows the live code reads.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

export const PLATFORM_TARGET = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (PLATFORM_TARGET !== undefined) {
  const parsed = new URL(PLATFORM_TARGET);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("People Book tests require the explicit disposable platform database");
  }
}

export const PEOPLE_FIXTURE_USERS = [
  "admin", "manager", "staff", "sales", "hallkeeper", "planner", "caterer", "otherStaff", "platformAdmin",
] as const;
export type PeopleFixtureUser = typeof PEOPLE_FIXTURE_USERS[number];

export interface AddPersonInput {
  readonly name: string;
  /** The fixture's venueId or otherVenueId; venueId when left out. */
  readonly venueId?: string;
  /** Written as typed; the first usable one is primary. */
  readonly emails?: readonly string[];
  /** Written as typed; only usable phones are kept, the first of them primary. */
  readonly phones?: readonly string[];
  /** Organisation ids at the person's venue; the first is the primary membership. */
  readonly organisations?: readonly string[];
}

export interface AddOrganisationInput {
  readonly name: string;
  readonly kind?: ClientAccountKind;
  readonly venueId?: string;
}

export interface PeopleFixture {
  readonly pool: Pool;
  readonly db: Database;
  readonly server: FastifyInstance;
  readonly venueId: string;
  readonly otherVenueId: string;
  /** Real users rows: otherStaff is staff at otherVenueId; platformAdmin has no venue. */
  readonly users: Readonly<Record<PeopleFixtureUser, string>>;
  /** The mock token for that user, as the authorization header the route tests send. */
  bearer(who: PeopleFixtureUser): { authorization: string };
  addPerson(input: AddPersonInput): Promise<string>;
  addOrganisation(input: AddOrganisationInput): Promise<string>;
  /** A mark at the fixture venue that a and b are two people, decided by users.staff. */
  keepApart(a: string, b: string, options?: { withdrawn?: boolean }): Promise<void>;
  close(): Promise<void>;
}

interface FixtureUserRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly platformRole: "none" | "admin";
  readonly venueId: string | null;
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function onlyId(rows: readonly { id: string }[], what: string): string {
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`The fixture wrote no ${what}`);
  return id;
}

export async function openPeopleFixture(
  register: (server: FastifyInstance, db: Database) => Promise<void>,
): Promise<PeopleFixture> {
  if (PLATFORM_TARGET === undefined) throw new Error("Explicit test database required");
  const pool = new Pool({
    connectionString: PLATFORM_TARGET, application_name: `people_fixture_${randomUUID()}`, max: 4,
    options: "-c statement_timeout=30000 -c lock_timeout=20000",
  });
  const venueId = randomUUID();
  const otherVenueId = randomUUID();
  const venues: readonly string[] = [venueId, otherVenueId];
  const server = Fastify();

  async function cleanUp(): Promise<void> {
    // Only this fixture's venues, children first: what the People Book's
    // routes write around a person, then the people. Tombstones point at
    // their survivors (ON DELETE RESTRICT), so the links go before the people.
    for (const statement of [
      "DELETE FROM record_merges WHERE venue_id = ANY($1::uuid[])",
      "DELETE FROM opportunities WHERE venue_id = ANY($1::uuid[])",
      "DELETE FROM enquiry_status_history WHERE enquiry_id IN (SELECT id FROM enquiries WHERE venue_id = ANY($1::uuid[]))",
      "DELETE FROM enquiries WHERE venue_id = ANY($1::uuid[])",
      "DELETE FROM contact_kept_apart WHERE venue_id = ANY($1::uuid[])",
      "UPDATE contacts SET merged_into_id = NULL, client_account_id = NULL WHERE venue_id = ANY($1::uuid[])",
      "UPDATE client_accounts SET merged_into_id = NULL, primary_contact_id = NULL WHERE venue_id = ANY($1::uuid[])",
      "DELETE FROM contacts WHERE venue_id = ANY($1::uuid[])",
      "DELETE FROM client_accounts WHERE venue_id = ANY($1::uuid[])",
      "DELETE FROM users WHERE venue_id = ANY($1::uuid[]) OR email LIKE $2",
      "DELETE FROM venues WHERE id = ANY($1::uuid[])",
    ]) {
      await pool.query(statement, statement.includes("$2") ? [venues, `%-${venueId}@example.test`] : [venues]);
    }
  }

  try {
    const database = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    if (database !== "venviewer_platform_test") throw new Error("The People Book fixture is on the wrong database");
    const db: Database = drizzle(pool, { schema });

    await pool.query(
      `INSERT INTO venues (id, name, slug, address) VALUES ($1::uuid, 'People Book venue', $1::text, 'Test only'),
        ($2::uuid, 'Another People Book venue', $2::text, 'Test only')`,
      [venueId, otherVenueId],
    );

    const users = {} as Record<PeopleFixtureUser, string>;
    const tokens = new Map<PeopleFixtureUser, FixtureUserRow>();
    for (const who of PEOPLE_FIXTURE_USERS) {
      const role = who === "otherStaff" ? "staff" : who === "platformAdmin" ? "admin" : who;
      const platformRole = who === "platformAdmin" ? "admin" : "none";
      const userVenue = who === "otherStaff" ? otherVenueId : who === "platformAdmin" ? null : venueId;
      const email = `${who.toLowerCase()}-${venueId}@example.test`;
      const name = `People Book ${who}`;
      const inserted = await pool.query<{ id: string }>(
        "INSERT INTO users (email, name, role, platform_role, venue_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [email, name, role, platformRole, userVenue],
      );
      const id = onlyId(inserted.rows, `${who} user`);
      users[who] = id;
      tokens.set(who, { id, email, name, role, platformRole, venueId: userVenue });
    }

    await register(server, db);
    await server.ready();

    function venueOf(requested: string | undefined): string {
      const chosen = requested ?? venueId;
      if (!venues.includes(chosen)) throw new Error("The People Book fixture writes only at its own venues");
      return chosen;
    }

    async function addPerson(input: AddPersonInput): Promise<string> {
      const at = venueOf(input.venueId);
      return inTransaction(pool, async (client) => {
        const id = onlyId((await client.query<{ id: string }>(
          "INSERT INTO contacts (venue_id, name) VALUES ($1, $2) RETURNING id", [at, input.name],
        )).rows, "person");
        // The first point of each kind that is written becomes the primary.
        for (const email of input.emails ?? []) {
          await client.query(
            `INSERT INTO contact_points (venue_id, contact_id, kind, value, display_value, is_primary)
             SELECT $1, $2, 'email', people_normalise_email($3), people_trim($3),
               NOT EXISTS (SELECT 1 FROM contact_points WHERE contact_id = $2 AND kind = 'email' AND is_primary)
             WHERE people_normalise_email($3) IS NOT NULL
             ON CONFLICT (contact_id, kind, value) DO NOTHING`,
            [at, id, email],
          );
        }
        for (const phone of input.phones ?? []) {
          await client.query(
            `INSERT INTO contact_points (venue_id, contact_id, kind, value, display_value, is_primary)
             SELECT $1, $2, 'phone', people_normalise_phone($3), people_trim($3),
               NOT EXISTS (SELECT 1 FROM contact_points WHERE contact_id = $2 AND kind = 'phone' AND is_primary)
             WHERE people_usable_phone($3)
             ON CONFLICT (contact_id, kind, value) DO NOTHING`,
            [at, id, phone],
          );
        }
        for (const [index, accountId] of (input.organisations ?? []).entries()) {
          await client.query(
            "INSERT INTO account_memberships (venue_id, contact_id, client_account_id, is_primary) VALUES ($1, $2, $3, $4)",
            [at, id, accountId, index === 0],
          );
        }
        // The mirrors equal the primaries, as refreshContactMirror writes them.
        await client.query(
          `UPDATE contacts SET
             email = (SELECT display_value FROM contact_points WHERE contact_id = $1 AND kind = 'email' AND is_primary),
             phone = (SELECT display_value FROM contact_points WHERE contact_id = $1 AND kind = 'phone' AND is_primary),
             client_account_id = (SELECT client_account_id FROM account_memberships WHERE contact_id = $1 AND is_primary)
           WHERE id = $1`,
          [id],
        );
        return id;
      });
    }

    async function addOrganisation(input: AddOrganisationInput): Promise<string> {
      const at = venueOf(input.venueId);
      return onlyId((await pool.query<{ id: string }>(
        "INSERT INTO client_accounts (venue_id, name, kind) VALUES ($1, $2, $3) RETURNING id",
        [at, input.name, input.kind ?? "household"],
      )).rows, "organisation");
    }

    async function keepApart(a: string, b: string, options: { withdrawn?: boolean } = {}): Promise<void> {
      await pool.query(
        `INSERT INTO contact_kept_apart (venue_id, low_contact_id, high_contact_id, decided_by, withdrawn_at, withdrawn_by)
         VALUES ($1, LEAST($2::uuid, $3::uuid), GREATEST($2::uuid, $3::uuid), $4,
           CASE WHEN $5::boolean THEN now() END, CASE WHEN $5::boolean THEN $4::uuid END)`,
        [venueId, a, b, users.staff, options.withdrawn === true],
      );
    }

    function bearer(who: PeopleFixtureUser): { authorization: string } {
      const user = tokens.get(who);
      if (user === undefined) throw new Error(`The People Book fixture has no ${who} user`);
      return { authorization: `Bearer ${JSON.stringify(user)}` };
    }

    let closed: Promise<void> | undefined;
    function close(): Promise<void> {
      closed ??= (async () => {
        try {
          await server.close();
          await cleanUp();
        } finally {
          await pool.end();
        }
      })();
      return closed;
    }

    return {
      pool, db, server, venueId, otherVenueId, users,
      bearer, addPerson, addOrganisation, keepApart, close,
    };
  } catch (error) {
    try {
      await server.close();
      await cleanUp();
    } finally {
      await pool.end();
    }
    throw error;
  }
}

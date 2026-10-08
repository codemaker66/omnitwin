import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRADES_HALL_VENUE_SLUG, siteAgreement } from "../lib/venue-site.js";

// ---------------------------------------------------------------------------
// Migration 0086 on isolated PostgreSQL (T-647).
//
// Venues gain a nullable latitude and longitude, both or neither and on the
// globe. Trades Hall gets the site agreed with T-639, and the stored value is
// checked against that site within 100 m. The fill touches no other venue
// and never overwrites a location already set. Running it again changes
// nothing, and a copy of the table elsewhere in the same database never
// stops its constraint being added.
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
    throw new Error("Venue location migration tests require their explicit isolated loopback database");
  }
}

async function applyMigration(pool: Pool): Promise<void> {
  const migration = await readFile(resolve("drizzle", "0086_venue_location.sql"), "utf8");
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

/** The venues table as the release before 0086 defines the columns used. */
async function venuesBefore(on: Pool): Promise<void> {
  await on.query(`CREATE TABLE venues (
    id uuid PRIMARY KEY,
    name varchar(200) NOT NULL,
    slug varchar(100) NOT NULL UNIQUE,
    timezone varchar(100) NOT NULL DEFAULT 'Europe/London'
  )`);
}

describe.skipIf(testUrl === undefined)("migration 0086 on isolated PostgreSQL", () => {
  const fixtureSchema = `venue_location_${randomUUID().replaceAll("-", "")}`;
  const elsewhereSchema = `${fixtureSchema}_elsewhere`;
  const tradesHall = randomUUID();
  const other = randomUUID();
  let pool: Pool;

  async function location(id: string): Promise<{ latitude: number | null; longitude: number | null }> {
    const { rows } = await pool.query<{ latitude: number | null; longitude: number | null }>(
      "SELECT latitude, longitude FROM venues WHERE id = $1",
      [id],
    );
    const row = rows[0];
    if (row === undefined) throw new Error("venue missing");
    return row;
  }

  async function refusal(latitude: string | null, longitude: string | null): Promise<string | null> {
    try {
      await pool.query("UPDATE venues SET latitude = $2::double precision, longitude = $3::double precision WHERE id = $1", [other, latitude, longitude]);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? "unknown";
    } finally {
      await pool.query("UPDATE venues SET latitude = NULL, longitude = NULL WHERE id = $1", [other]);
    }
  }

  beforeAll(async () => {
    const elsewhere = new Pool({ connectionString: testUrl, application_name: elsewhereSchema, max: 1, options: `-c search_path=${elsewhereSchema}` });
    try {
      await elsewhere.query(`CREATE SCHEMA "${elsewhereSchema}"`);
      await venuesBefore(elsewhere);
      await applyMigration(elsewhere);
    } finally {
      await elsewhere.end();
    }

    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 2, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    await venuesBefore(pool);
    await pool.query(
      "INSERT INTO venues (id, name, slug) VALUES ($1, 'Trades Hall', $2), ($3, 'Another venue', 'another-venue')",
      [tradesHall, TRADES_HALL_VENUE_SLUG, other],
    );
    await applyMigration(pool);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS "${elsewhereSchema}" CASCADE`);
    await pool.end();
  });

  it("adds nullable double-precision columns and the location check on this table", async () => {
    const { rows: columns } = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'venues' AND column_name IN ('latitude', 'longitude') ORDER BY column_name`,
      [fixtureSchema],
    );
    expect(columns).toEqual([
      { column_name: "latitude", data_type: "double precision", is_nullable: "YES" },
      { column_name: "longitude", data_type: "double precision", is_nullable: "YES" },
    ]);
    const { rows: constraints } = await pool.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND t.relname = 'venues' AND c.contype = 'c'`,
      [fixtureSchema],
    );
    expect(constraints.map((row) => row.conname)).toEqual(["venues_location_check"]);
  });

  it("stores the T-639 site for Trades Hall, within 100 m of it", async () => {
    const stored = await location(tradesHall);
    expect(stored).toEqual({ latitude: 55.8593, longitude: -4.2491 });
    const agreement = siteAgreement(stored);
    expect(agreement.agrees).toBe(true);
    expect(agreement.distanceM).toBeLessThanOrEqual(100);
  });

  it("leaves every other venue without a location", async () => {
    expect(await location(other)).toEqual({ latitude: null, longitude: null });
  });

  it("holds a location to both-or-neither on the globe", async () => {
    expect(await refusal("55.86", null)).toBe("23514");
    expect(await refusal(null, "-4.25")).toBe("23514");
    expect(await refusal("90.5", "-4.25")).toBe("23514");
    expect(await refusal("55.86", "-180.5")).toBe("23514");
    expect(await refusal("NaN", "-4.25")).toBe("23514");
    expect(await refusal("55.86", "Infinity")).toBe("23514");
    expect(await refusal("-90", "180")).toBeNull();
    expect(await refusal(null, null)).toBeNull();
  });

  it("changes nothing when run again, and never overwrites a location already set", async () => {
    await pool.query("UPDATE venues SET latitude = 55.8592, longitude = -4.2490 WHERE id = $1", [tradesHall]);
    await applyMigration(pool);
    expect(await location(tradesHall)).toEqual({ latitude: 55.8592, longitude: -4.2490 });
    expect(await location(other)).toEqual({ latitude: null, longitude: null });
    const { rows } = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = $1 AND c.conname = 'venues_location_check'`,
      [fixtureSchema],
    );
    expect(rows[0]?.count).toBe(1);
  });
});

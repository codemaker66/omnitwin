import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { cleanupPreviewConfigurations } from "../services/cleanup.js";

// ---------------------------------------------------------------------------
// The preview sweep judges inactivity, not age (release audit, batch C).
//
// It deleted any ownerless public draft created more than 72 hours ago, so a
// plan someone had worked on all week vanished on its fourth day. It now
// removes a draft only after 72 hours with no save: updated_at, which every
// save of the plan or its objects advances. An owned plan is never touched,
// and the DELETE re-checks ownership and inactivity, so a plan claimed or
// saved between the sweep's read and its delete survives.
//
// Real PostgreSQL in a private schema built from the Drizzle tables, on the
// explicit route test database; never DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Preview sweep tests require their explicit isolated loopback database");
  }
}

const NOW = new Date("2026-10-25T12:00:00.000Z");
const hoursBefore = (hours: number): Date => new Date(NOW.getTime() - hours * 3_600_000);

describe.skipIf(testUrl === undefined)("the preview sweep on isolated PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  const fixtureSchema = `preview_sweep_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.configurations, schema.configurationViewTokens, schema.placedObjects, schema.enquiries, schema.handoffPacks,
  ];
  const venueId = randomUUID();
  const spaceId = randomUUID();

  async function draft(input: {
    readonly createdHoursAgo: number;
    readonly savedHoursAgo: number;
    readonly owner?: string;
  }): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO configurations (id, space_id, venue_id, user_id, name, layout_style, is_public_preview, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Draft', 'custom', $5, $6, $7)`,
      [id, spaceId, venueId, input.owner ?? null, input.owner === undefined, hoursBefore(input.createdHoursAgo), hoursBefore(input.savedHoursAgo)],
    );
    return id;
  }

  async function remaining(): Promise<Set<string>> {
    return new Set((await pool.query<{ id: string }>("SELECT id FROM configurations")).rows.map((row) => row.id));
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    db = drizzle(pool, { schema });
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE configurations, configuration_view_tokens, placed_objects, enquiries, handoff_packs");
  });

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  });

  it("keeps a draft made days ago that was saved within the last 72 hours", async () => {
    const workedOn = await draft({ createdHoursAgo: 5 * 24, savedHoursAgo: 20 });
    expect(await cleanupPreviewConfigurations(db, NOW)).toBe(0);
    expect(await remaining()).toContain(workedOn);
  });

  it("removes a draft nobody has saved for more than 72 hours, with its pieces", async () => {
    const abandoned = await draft({ createdHoursAgo: 4 * 24, savedHoursAgo: 4 * 24 });
    const fresh = await draft({ createdHoursAgo: 1, savedHoursAgo: 1 });
    await pool.query(
      `INSERT INTO placed_objects (id, configuration_id, asset_definition_id, position_x, position_y, position_z, coordinate_write_token)
       VALUES ($1, $2, $3, 0, 0, 0, $4)`,
      [randomUUID(), abandoned, randomUUID(), randomUUID()],
    );
    expect(await cleanupPreviewConfigurations(db, NOW)).toBe(1);
    expect(await remaining()).toEqual(new Set([fresh]));
    expect((await pool.query("SELECT count(*)::int AS n FROM placed_objects")).rows[0]).toEqual({ n: 0 });
  });

  it("never touches an owned plan, however long it has been left", async () => {
    const owned = await draft({ createdHoursAgo: 60 * 24, savedHoursAgo: 60 * 24, owner: randomUUID() });
    expect(await cleanupPreviewConfigurations(db, NOW)).toBe(0);
    expect(await remaining()).toContain(owned);
  });

  it("still spares an untouched draft an enquiry was sent from", async () => {
    const enquired = await draft({ createdHoursAgo: 10 * 24, savedHoursAgo: 10 * 24 });
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, space_id, configuration_id, name, email, state) VALUES ($1, $2, $3, $4, 'Guest', 'guest@sweep.invalid', 'submitted')`,
      [randomUUID(), venueId, spaceId, enquired],
    );
    expect(await cleanupPreviewConfigurations(db, NOW)).toBe(0);
    expect(await remaining()).toContain(enquired);
  });
});

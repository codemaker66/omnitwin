import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { listVenueInventory } from "../services/venue-inventory.js";

const CHAIR_ID = "7f1fb7a2-5210-57b1-9108-11255c059520";
const GENERIC_CHAIR_ID = "4dfcae64-b6e3-54f8-817f-af041edab935";
const VENUE_ID = "a1111111-1111-4111-8111-111111111111";
const USER_ID = "a2222222-2222-4222-8222-222222222222";
const SPACE_ID = "a3333333-3333-4333-8333-333333333333";
const CONFIG_ID = "a4444444-4444-4444-8444-444444444444";
const migrationUrl = new URL("../../drizzle/0067_burgess_turini_chair.sql", import.meta.url);

// Only a deliberately selected disposable database; never read DATABASE_URL/.env.
const databaseUrl = process.env["VENVIEWER_TURINI_TEST_DATABASE_URL"];
if (databaseUrl !== undefined) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "127.0.0.1" || url.port !== "55567"
    || url.pathname !== "/venviewer_turini_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Turini migration tests require their explicit isolated loopback database");
  }
}

describe("Turini migration identity", () => {
  it("uses the UUID v5 derived from the canonical catalogue namespace", () => {
    const namespace = Buffer.from("43033bd617fd599eb3050bd60dec57f0", "hex");
    const digest = createHash("sha1").update(Buffer.concat([namespace, Buffer.from("burgess-turini-18-3")])).digest();
    digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
    digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
    const hex = digest.subarray(0, 16).toString("hex");
    expect([hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-"))
      .toBe(CHAIR_ID);
  });
});

describe.skipIf(databaseUrl === undefined)("Turini registration on isolated PostgreSQL", () => {
  let pool: Pool;
  let migration: string;
  const fixtureSchema = `turini_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    // Actual baseline asset/placement FKs and inventory migration, isolated by
    // schema. These tests qualify this additive row, not the entire schema tail.
    for (const file of ["0000_exotic_excalibur.sql", "0002_hesitant_purifiers.sql", "0065_venue_inventory.sql"]) {
      const source = await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8");
      await pool.query(source.replaceAll('"public".', `"${fixtureSchema}".`));
    }
    migration = await readFile(migrationUrl, "utf8");
    await pool.query(`INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Turini fixture', 'turini-fixture', 'Local fixture')`, [VENUE_ID]);
    await pool.query(`INSERT INTO users (id, email, password_hash, name, role, venue_id)
      VALUES ($1, 'turini@example.test', 'unused local fixture', 'Fixture', 'admin', $2)`, [USER_ID, VENUE_ID]);
    await pool.query(`INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline)
      VALUES ($1, $2, 'Fixture room', 'fixture-room', 10, 10, 3, '[]')`, [SPACE_ID, VENUE_ID]);
    await pool.query(`INSERT INTO configurations (id, space_id, venue_id, user_id, name, layout_style)
      VALUES ($1, $2, $3, $4, 'Turini save fixture', 'custom')`, [CONFIG_ID, SPACE_ID, VENUE_ID, USER_ID]);
    await pool.query(`INSERT INTO asset_definitions (id, name, category, width_m, depth_m, height_m, seat_count)
      VALUES ($1, 'Banquet Chair', 'chair', .45, .45, .9, 1)`, [GENERIC_CHAIR_ID]);
    await pool.query(`INSERT INTO venue_inventory_stock
      (venue_id, asset_definition_id, revision, owned_quantity, damaged_quantity, unavailable_quantity, hires, status, effective_at, updated_by)
      VALUES ($1, $2, 1, 17, 2, 0, '[]', 'active', now(), $3)`, [VENUE_ID, GENERIC_CHAIR_ID, USER_ID]);
  }, 30000);

  beforeEach(async () => {
    await pool.query("DELETE FROM placed_objects WHERE asset_definition_id = $1", [CHAIR_ID]);
    await pool.query("DELETE FROM asset_definitions WHERE id = $1", [CHAIR_ID]);
  });

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  });

  it("applies twice without changing existing catalogue or stock, and lists the new chair with unknown physical stock", async () => {
    const before = await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a WHERE id = $1", [GENERIC_CHAIR_ID]);
    const stockBefore = await pool.query("SELECT row_to_json(s) AS stock FROM venue_inventory_stock s");
    await pool.query(migration);
    const created = await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a WHERE id = $1", [CHAIR_ID]);
    await pool.query(migration);
    expect((await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a WHERE id = $1", [CHAIR_ID])).rows)
      .toEqual(created.rows);
    expect((await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a WHERE id = $1", [GENERIC_CHAIR_ID])).rows)
      .toEqual(before.rows);
    expect((await pool.query("SELECT row_to_json(s) AS stock FROM venue_inventory_stock s")).rows).toEqual(stockBefore.rows);
    const inventory = await listVenueInventory(drizzle(pool, { schema }),
      { userId: USER_ID, role: "admin", venueId: VENUE_ID }, VENUE_ID);
    expect(inventory.data.items.find((item) => item.catalogue.id === CHAIR_ID)).toEqual({
      catalogue: { id: CHAIR_ID, name: "Burgess Turini 18/3", category: "chair" }, stock: null,
    });
  });

  it("registers a valid saved-placement foreign key and retains its dimensions and transform", async () => {
    await expect(pool.query(`INSERT INTO placed_objects (configuration_id, asset_definition_id, position_x, position_y, position_z)
      VALUES ($1, $2, 1.25, 0, -2.5)`, [CONFIG_ID, CHAIR_ID])).rejects.toMatchObject({ code: "23503" });
    await pool.query(migration);
    await pool.query(`INSERT INTO placed_objects (configuration_id, asset_definition_id, position_x, position_y, position_z, rotation_y)
      VALUES ($1, $2, 1.25, 0, -2.5, .75)`, [CONFIG_ID, CHAIR_ID]);
    const saved = await pool.query(`SELECT p.asset_definition_id, p.position_x, p.position_y, p.position_z, p.rotation_y,
      a.width_m, a.depth_m, a.height_m, a.seat_count, a.mesh_url, a.thumbnail_url
      FROM placed_objects p JOIN asset_definitions a ON a.id = p.asset_definition_id WHERE p.configuration_id = $1`, [CONFIG_ID]);
    expect(saved.rows).toEqual([{
      asset_definition_id: CHAIR_ID, position_x: "1.250", position_y: "0.000", position_z: "-2.500", rotation_y: "0.75000",
      width_m: "0.420", depth_m: "0.580", height_m: "0.880", seat_count: 1,
      mesh_url: "/models/furniture/burgess-turini-18-3/v1/chair.glb",
      thumbnail_url: "/models/furniture/burgess-turini-18-3/v1/preview.webp",
    }]);
  });

  it("rejects an incompatible pre-existing identity without overwriting it", async () => {
    await pool.query(`INSERT INTO asset_definitions (id, name, category, width_m, depth_m, height_m)
      VALUES ($1, 'Existing different item', 'table', 1, 1, 1)`, [CHAIR_ID]);
    const before = await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a WHERE id = $1", [CHAIR_ID]);
    await expect(pool.query(migration)).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("BURGESS_TURINI_CATALOGUE_CONFLICT") });
    expect((await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a WHERE id = $1", [CHAIR_ID])).rows).toEqual(before.rows);
  });

  it("serializes competing identical registrations into a single catalogue row", async () => {
    await Promise.all([pool.query(migration), pool.query(migration)]);
    expect((await pool.query("SELECT count(*)::int AS count FROM asset_definitions WHERE id = $1", [CHAIR_ID])).rows).toEqual([{ count: 1 }]);
  });
});

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import * as schema from "../db/schema.js";
import { listVenueInventory } from "../services/venue-inventory.js";

const databaseUrl = process.env["VENVIEWER_TURINI_TEST_DATABASE_URL"];
if (databaseUrl !== undefined) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "127.0.0.1" || url.port !== "55567"
    || url.pathname !== "/venviewer_turini_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Furniture registration tests require their explicit isolated loopback database");
  }
}

// Frozen from release base 74348f9b, so current catalogue edits cannot silently
// redefine the historical database fixture's physical identities.
const legacy = z.array(z.object({
  id: z.string().uuid(), slug: z.string(), name: z.string(), category: z.string(),
  widthM: z.number(), depthM: z.number(), heightM: z.number(), seatCount: z.number().nullable(),
  collisionType: z.string(), meshUrl: z.string().nullable(), thumbnailUrl: z.string().nullable(),
}).strict()).parse(JSON.parse(readFileSync(new URL("./fixtures/furniture-catalogue-pre-batch.json", import.meta.url), "utf8")));
const UPGRADE_SLUGS = ["trestle-6ft", "poseur-table-black", "poseur-table-white", "platform", "bar-counter"];
// This suite qualifies migration 0068, not subsequent catalogue additions.
const BATCH_SLUGS = ["trestle-6ft-black", "trestle-6ft-white", "trestle-6ft-wooden", "round-table-6ft-black",
  "round-table-6ft-white", "cake-cutting-table", "ceremony-table", "checked-banquet-chair", "room-divider",
  "round-cafe-table-white", "square-cafe-table-white", "servery-unit"];
const additions = CANONICAL_ASSETS.filter((asset) => BATCH_SLUGS.includes(asset.slug));
const upgrades = CANONICAL_ASSETS.filter((asset) => UPGRADE_SLUGS.includes(asset.slug));
const venueId = "c1111111-1111-4111-8111-111111111111";
const userId = "c2222222-2222-4222-8222-222222222222";
const spaceId = "c3333333-3333-4333-8333-333333333333";
const configId = "c4444444-4444-4444-8444-444444444444";
const migrationUrl = new URL("../../drizzle/0068_furniture_model_batch.sql", import.meta.url);

describe("furniture batch identities", () => {
  it("retains the legacy catalogue and derives every additional UUID from the canonical namespace", () => {
    expect(legacy).toHaveLength(21);
    expect(upgrades).toHaveLength(5);
    expect(additions).toHaveLength(12);
    for (const original of legacy) {
      const { meshUrl, thumbnailUrl, ...identity } = original;
      const current = CANONICAL_ASSETS.find((asset) => asset.id === original.id);
      expect(current).toMatchObject(identity);
      if (!UPGRADE_SLUGS.includes(original.slug)) {
        expect(current?.meshUrl ?? null).toBe(meshUrl);
        expect(current?.thumbnailUrl ?? null).toBe(thumbnailUrl);
      }
    }
    for (const asset of additions) {
      const digest = createHash("sha1").update(Buffer.concat([
        Buffer.from("43033bd617fd599eb3050bd60dec57f0", "hex"), Buffer.from(asset.slug),
      ])).digest();
      digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
      digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
      const hex = digest.subarray(0, 16).toString("hex");
      expect([hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-")).toBe(asset.id);
    }
  });
});

describe.skipIf(databaseUrl === undefined)("furniture batch on isolated PostgreSQL", () => {
  let pool: Pool;
  let migration: string;
  let fixtureSchema: string;

  beforeEach(async () => {
    fixtureSchema = `furniture_${randomUUID().replaceAll("-", "")}`;
    pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const file of ["0000_exotic_excalibur.sql", "0002_hesitant_purifiers.sql", "0065_venue_inventory.sql"]) {
      const source = await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8");
      await pool.query(source.replaceAll('"public".', `"${fixtureSchema}".`));
    }
    migration = await readFile(migrationUrl, "utf8");
    for (const asset of legacy) {
      await pool.query(`INSERT INTO asset_definitions
        (id, name, category, width_m, depth_m, height_m, seat_count, collision_type, mesh_url, thumbnail_url, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '2026-01-01T00:00:00Z')`,
      [asset.id, asset.name, asset.category, asset.widthM, asset.depthM, asset.heightM, asset.seatCount, asset.collisionType,
        UPGRADE_SLUGS.includes(asset.slug) ? null : asset.meshUrl ?? null,
        UPGRADE_SLUGS.includes(asset.slug) ? null : asset.thumbnailUrl ?? null]);
    }
    await pool.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Furniture fixture', 'furniture-fixture', 'Local fixture')", [venueId]);
    await pool.query(`INSERT INTO users (id, email, password_hash, name, role, venue_id)
      VALUES ($1, 'furniture@example.test', 'unused local fixture', 'Fixture', 'admin', $2)`, [userId, venueId]);
    await pool.query(`INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline)
      VALUES ($1, $2, 'Fixture room', 'fixture-room', 10, 10, 3, '[]')`, [spaceId, venueId]);
    await pool.query(`INSERT INTO configurations (id, space_id, venue_id, user_id, name, layout_style)
      VALUES ($1, $2, $3, $4, 'Furniture save fixture', 'custom')`, [configId, spaceId, venueId, userId]);
    for (const asset of upgrades) {
      await pool.query(`INSERT INTO venue_inventory_stock
        (venue_id, asset_definition_id, revision, owned_quantity, damaged_quantity, unavailable_quantity, hires, status, effective_at, updated_by)
        VALUES ($1, $2, 3, 17, 2, 0, '[]', 'active', now(), $3)`, [venueId, asset.id, userId]);
      await pool.query(`INSERT INTO placed_objects (configuration_id, asset_definition_id, position_x, position_y, position_z, rotation_y)
        VALUES ($1, $2, 1.25, 0, -2.5, .75)`, [configId, asset.id]);
    }
  }, 30000);

  afterEach(async () => {
    if (pool !== undefined) {
      try { await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`); }
      finally { await pool.end(); }
    }
  });

  const snapshot = async () => ({
    assets: (await pool.query("SELECT to_jsonb(a) AS row FROM asset_definitions a ORDER BY id")).rows,
    stock: (await pool.query("SELECT to_jsonb(s) AS row FROM venue_inventory_stock s ORDER BY asset_definition_id")).rows,
    placements: (await pool.query("SELECT to_jsonb(p) AS row FROM placed_objects p ORDER BY id")).rows,
  });

  it("changes only the five presentation URL pairs, preserves stock and saved placements, and replays inertly", async () => {
    const before = await snapshot();
    await pool.query(migration);
    const after = await snapshot();
    expect(after.stock).toEqual(before.stock);
    expect(after.placements).toEqual(before.placements);
    expect(after.assets).toHaveLength(legacy.length + additions.length);
    for (const original of before.assets as { row: { id: string; [key: string]: unknown } }[]) {
      const upgrade = upgrades.find((asset) => asset.id === original.row.id);
      expect(after.assets).toContainEqual({ row: {
        ...original.row,
        ...(upgrade === undefined ? {} : { mesh_url: upgrade.meshUrl, thumbnail_url: upgrade.thumbnailUrl }),
      } });
    }
    await pool.query(migration);
    expect(await snapshot()).toEqual(after);
    const inventory = await listVenueInventory(drizzle(pool, { schema }), { userId, role: "admin", venueId }, venueId);
    for (const asset of additions) {
      expect(inventory.data.items.find((item) => item.catalogue.id === asset.id))
        .toEqual({ catalogue: { id: asset.id, name: asset.name, category: asset.category }, stock: null });
    }
  });

  it("supports saved placement foreign keys for every new variant", async () => {
    await pool.query(migration);
    for (const asset of additions) {
      await pool.query(`INSERT INTO placed_objects (configuration_id, asset_definition_id, position_x, position_y, position_z, rotation_y)
        VALUES ($1, $2, 2.125, 0, -1.375, 1.25)`, [configId, asset.id]);
    }
    const saved = await pool.query(`SELECT asset_definition_id, position_x, position_z, rotation_y FROM placed_objects
      WHERE asset_definition_id = ANY($1::uuid[]) ORDER BY asset_definition_id`, [additions.map((asset) => asset.id)]);
    expect(saved.rows).toEqual(additions.map((asset) => ({ asset_definition_id: asset.id, position_x: "2.125", position_z: "-1.375", rotation_y: "1.25000" }))
      .sort((a, b) => a.asset_definition_id.localeCompare(b.asset_definition_id)));
  });

  it.each(["mesh_url", "thumbnail_url", "width_m"])("rejects incompatible existing %s atomically", async (column) => {
    const target = upgrades.at(-1);
    if (target === undefined) throw new Error("Upgrade fixture missing");
    await pool.query(`UPDATE asset_definitions SET ${column} = $1 WHERE id = $2`, [column === "width_m" ? "3.333" : "/custom/venue-owned-file", target.id]);
    const before = await snapshot();
    await expect(pool.query(migration)).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("FURNITURE_BATCH_CATALOGUE_CONFLICT") });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects a conflicting new identity without replacing or partially registering assets", async () => {
    const target = additions.at(-1);
    if (target === undefined) throw new Error("Addition fixture missing");
    await pool.query(`INSERT INTO asset_definitions (id, name, category, width_m, depth_m, height_m)
      VALUES ($1, 'Unrelated existing identity', 'decor', 1, 1, 1)`, [target.id]);
    const before = await snapshot();
    await expect(pool.query(migration)).rejects.toMatchObject({ code: "23514" });
    expect(await snapshot()).toEqual(before);
  });

  it("serializes concurrent matching registration without duplicate assets or stock mutations", async () => {
    const before = await snapshot();
    await Promise.all([pool.query(migration), pool.query(migration)]);
    const after = await snapshot();
    expect(after.assets).toHaveLength(legacy.length + additions.length);
    expect(after.stock).toEqual(before.stock);
    expect(after.placements).toEqual(before.placements);
    await pool.query(migration);
    expect(await snapshot()).toEqual(after);
  });
});

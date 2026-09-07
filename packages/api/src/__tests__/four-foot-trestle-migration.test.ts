import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { listVenueInventory } from "../services/venue-inventory.js";

const variants = [
  { id: "b55671ff-925d-573f-bf11-359e15736557", slug: "trestle-4ft-black", name: "4ft Trestle Table (Black Cloth)" },
  { id: "166ead7c-6eba-5462-8380-519e9ba8e4bd", slug: "trestle-4ft-white", name: "4ft Trestle Table (White Cloth)" },
];
const baseTableId = "7b423ca2-9714-5cb2-919c-e938a5c39933";
const venueId = "d1111111-1111-4111-8111-111111111111";
const userId = "d2222222-2222-4222-8222-222222222222";
const spaceId = "d3333333-3333-4333-8333-333333333333";
const configId = "d4444444-4444-4444-8444-444444444444";
const databaseUrl = process.env["VENVIEWER_TURINI_TEST_DATABASE_URL"];
if (databaseUrl !== undefined) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "127.0.0.1" || url.port !== "55567"
    || url.pathname !== "/venviewer_turini_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Four-foot trestle tests require their explicit isolated loopback database");
  }
}

describe("four-foot trestle catalogue contract", () => {
  it.each(variants)("registers $slug with its deterministic identity and independent planning envelope", (variant) => {
    const digest = createHash("sha1").update(Buffer.concat([
      Buffer.from("43033bd617fd599eb3050bd60dec57f0", "hex"), Buffer.from(variant.slug),
    ])).digest();
    digest[6] = ((digest[6] ?? 0) & 15) | 80;
    digest[8] = ((digest[8] ?? 0) & 63) | 128;
    const hex = digest.subarray(0, 16).toString("hex");
    expect([hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-")).toBe(variant.id);
    expect(CANONICAL_ASSETS.find((asset) => asset.id === variant.id)).toMatchObject({
      ...variant, category: "table", widthM: 1.22, depthM: 0.76, heightM: 0.74,
      dimensionStatus: "approximate", seatCount: null, collisionType: "box", tableShape: "rectangular",
      meshUrl: `/models/furniture/${variant.slug}/v1/model.glb`,
      thumbnailUrl: `/models/furniture/${variant.slug}/v1/preview.webp`,
    });
    expect(variant.id).not.toBe(baseTableId);
  });
});

describe.skipIf(databaseUrl === undefined)("four-foot trestle registration on isolated PostgreSQL", () => {
  let pool: Pool;
  let migration: string;
  let fixtureSchema: string;

  beforeEach(async () => {
    fixtureSchema = `four_foot_${randomUUID().replaceAll("-", "")}`;
    pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const file of ["0000_exotic_excalibur.sql", "0002_hesitant_purifiers.sql", "0065_venue_inventory.sql"]) {
      const source = await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8");
      await pool.query(source.replaceAll('"public".', `"${fixtureSchema}".`));
    }
    migration = await readFile(new URL("../../drizzle/0069_four_foot_trestle_models.sql", import.meta.url), "utf8");
    for (const asset of CANONICAL_ASSETS.filter((item) => !variants.some((variant) => variant.id === item.id))) {
      await pool.query(`INSERT INTO asset_definitions
        (id, name, category, width_m, depth_m, height_m, seat_count, collision_type, mesh_url, thumbnail_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [asset.id, asset.name, asset.category,
        asset.widthM, asset.depthM, asset.heightM, asset.seatCount, asset.collisionType, asset.meshUrl ?? null, asset.thumbnailUrl ?? null]);
    }
    await pool.query("INSERT INTO venues (id,name,slug,address) VALUES ($1,'Trestle fixture','trestle-fixture','Local')", [venueId]);
    await pool.query(`INSERT INTO users (id,email,password_hash,name,role,venue_id)
      VALUES ($1,'trestle@example.test','unused','Fixture','admin',$2)`, [userId, venueId]);
    await pool.query(`INSERT INTO spaces (id,venue_id,name,slug,width_m,length_m,height_m,floor_plan_outline)
      VALUES ($1,$2,'Fixture room','fixture-room',10,10,3,'[]')`, [spaceId, venueId]);
    await pool.query(`INSERT INTO configurations (id,space_id,venue_id,user_id,name,layout_style)
      VALUES ($1,$2,$3,$4,'Trestle layout','custom')`, [configId, spaceId, venueId, userId]);
    await pool.query(`INSERT INTO venue_inventory_stock
      (venue_id,asset_definition_id,revision,owned_quantity,damaged_quantity,unavailable_quantity,hires,status,effective_at,updated_by)
      VALUES ($1,$2,3,17,2,0,'[]','active',now(),$3)`, [venueId, baseTableId, userId]);
    await pool.query(`INSERT INTO placed_objects (configuration_id,asset_definition_id,position_x,position_y,position_z,rotation_y)
      VALUES ($1,$2,1.25,0,-2.5,.75)`, [configId, baseTableId]);
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
    placed: (await pool.query("SELECT to_jsonb(p) AS row FROM placed_objects p ORDER BY id")).rows,
  });

  it("preserves all prior catalogue records, stock and placements, with unknown stock for both new variants and inert replay", async () => {
    const before = await snapshot();
    await pool.query(migration);
    const after = await snapshot();
    expect(after.assets).toHaveLength(before.assets.length + 2);
    expect(after.assets).toEqual(expect.arrayContaining(before.assets));
    expect(after.stock).toEqual(before.stock);
    expect(after.placed).toEqual(before.placed);
    await pool.query(migration);
    expect(await snapshot()).toEqual(after);
    const inventory = await listVenueInventory(drizzle(pool, { schema }), { userId, role: "admin", venueId }, venueId);
    for (const variant of variants) {
      expect(inventory.data.items.find((item) => item.catalogue.id === variant.id))
        .toEqual({ catalogue: { id: variant.id, name: variant.name, category: "table" }, stock: null });
    }
  });

  it("allows both variant foreign keys and preserves their saved transforms and dimensions", async () => {
    await pool.query(migration);
    for (const variant of variants) {
      await pool.query(`INSERT INTO placed_objects (configuration_id,asset_definition_id,position_x,position_y,position_z,rotation_y)
        VALUES ($1,$2,2.125,0,-1.375,1.25)`, [configId, variant.id]);
      expect((await pool.query(`SELECT a.width_m,a.depth_m,a.height_m,p.position_x,p.position_z,p.rotation_y
        FROM placed_objects p JOIN asset_definitions a ON a.id=p.asset_definition_id WHERE a.id=$1`, [variant.id])).rows)
        .toEqual([{ width_m: "1.220", depth_m: "0.760", height_m: "0.740", position_x: "2.125", position_z: "-1.375", rotation_y: "1.25000" }]);
    }
  });

  it.each(["name", "width_m", "mesh_url", "thumbnail_url"])("rejects an incompatible %s atomically", async (column) => {
    const variant = variants[0];
    if (variant === undefined) throw new Error("Variant fixture missing");
    await pool.query(`INSERT INTO asset_definitions
      (id,name,category,width_m,depth_m,height_m,seat_count,collision_type,mesh_url,thumbnail_url)
      VALUES ($1,$2,'table',1.22,.76,.74,NULL,'box',$3,$4)`, [variant.id, variant.name,
      `/models/furniture/${variant.slug}/v1/model.glb`, `/models/furniture/${variant.slug}/v1/preview.webp`]);
    await pool.query(`UPDATE asset_definitions SET ${column}=$1 WHERE id=$2`, [column === "width_m" ? "3.333" : "Existing custom value", variant.id]);
    const before = await snapshot();
    await expect(pool.query(migration)).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("FOUR_FOOT_TRESTLE_CATALOGUE_CONFLICT") });
    expect(await snapshot()).toEqual(before);
  });

  it("serializes concurrent identical registrations and then replays without changes", async () => {
    await Promise.all([pool.query(migration), pool.query(migration)]);
    const after = await snapshot();
    expect(after.assets).toHaveLength(CANONICAL_ASSETS.length);
    await pool.query(migration);
    expect(await snapshot()).toEqual(after);
  });
});

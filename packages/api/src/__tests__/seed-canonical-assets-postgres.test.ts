import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { seedCanonicalAssets } from "../db/seed-canonical-assets.js";

// Explicit owned loopback cluster only. Each invocation creates and drops its
// own randomly named database; the existing browser/test databases are untouched.
const databaseUrl = process.env["VENVIEWER_TURINI_TEST_DATABASE_URL"];
if (databaseUrl !== undefined) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "127.0.0.1" || url.port !== "55567"
    || url.pathname !== "/venviewer_turini_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Canonical seed tests require their explicit isolated loopback database");
  }
}

const CHAIR_ID = "7f1fb7a2-5210-57b1-9108-11255c059520";
const GENERIC_CHAIR_ID = "4dfcae64-b6e3-54f8-817f-af041edab935";
const TABLE_ID = "a1ef4d89-7786-5878-bee1-87b3fac28200";

describe.skipIf(databaseUrl === undefined)("canonical seed after the complete migration chain", () => {
  const databaseName = `venviewer_turini_seed_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let pool: Pool;
  let created = false;

  beforeAll(async () => {
    if (databaseUrl === undefined) throw new Error("Explicit local database URL required");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const target = new URL(databaseUrl);
    target.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: target.toString(), max: 4 });
    await migrate(drizzle(pool, { schema }), {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
  }, 60000);

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      try { if (created) await admin.query(`DROP DATABASE "${databaseName}"`); }
      finally { await admin.end(); }
    }
  });

  it("reuses the migrated Turini row and registers all missing assets through the normal seed helper", async () => {
    const before = await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a ORDER BY id");
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0]).toMatchObject({ asset: { id: CHAIR_ID } });
    const journal = await pool.query("SELECT count(*)::int AS count, max(created_at)::text AS latest FROM drizzle.__drizzle_migrations");
    expect(journal.rows).toEqual([{ count: 66, latest: "1788717900000" }]);

    // This is the previous supported seed operation: it fails after migration
    // 0067, proving the integration regression without executing the broad seed.
    await expect(pool.query(`INSERT INTO asset_definitions (id, name, category, width_m, depth_m, height_m)
      VALUES ($1, 'Burgess Turini 18/3', 'chair', .42, .58, .88)`, [CHAIR_ID]))
      .rejects.toMatchObject({ code: "23505" });

    const seeded = await seedCanonicalAssets(drizzle(pool, { schema }));
    expect(seeded.map((asset) => asset.id)).toEqual(CANONICAL_ASSETS.map((asset) => asset.id));
    expect((await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a WHERE id = $1", [CHAIR_ID])).rows)
      .toEqual(before.rows);
    const allBeforeReplay = await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a ORDER BY id");
    expect(await seedCanonicalAssets(drizzle(pool, { schema }))).toEqual(seeded);
    expect((await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a ORDER BY id")).rows).toEqual(allBeforeReplay.rows);
    expect((await pool.query("SELECT count(*)::int AS count FROM venue_inventory_stock")).rows).toEqual([{ count: 0 }]);
  });

  it.each([
    ["name", "Different chair", "Banquet Chair"],
    ["category", "table", "chair"],
    ["width_m", "0.500", "0.450"],
    ["depth_m", "0.500", "0.450"],
    ["height_m", "0.950", "0.900"],
    ["seat_count", "2", "1"],
    ["collision_type", "cylinder", "box"],
    ["mesh_url", "/models/different.glb", null],
    ["thumbnail_url", "/models/different.webp", null],
  ] as const)("rejects conflicting %s without overwriting the record or partially inserting missing assets", async (column, conflicting, original) => {
    // Only synthetic rows in this invocation's disposable database are changed.
    // The migrated Turini record is never deleted or updated.
    await pool.query("DELETE FROM asset_definitions WHERE id = $1", [TABLE_ID]);
    await pool.query(`UPDATE asset_definitions SET ${column} = $1 WHERE id = $2`, [conflicting, GENERIC_CHAIR_ID]);
    const conflictBefore = await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a WHERE id = $1", [GENERIC_CHAIR_ID]);
    try {
      await expect(seedCanonicalAssets(drizzle(pool, { schema }))).rejects.toThrow("CANONICAL_ASSET_CONFLICT");
      expect((await pool.query("SELECT row_to_json(a) AS asset FROM asset_definitions a WHERE id = $1", [GENERIC_CHAIR_ID])).rows)
        .toEqual(conflictBefore.rows);
      expect((await pool.query("SELECT id FROM asset_definitions WHERE id = $1", [TABLE_ID])).rows).toEqual([]);
    } finally {
      await pool.query(`UPDATE asset_definitions SET ${column} = $1 WHERE id = $2`, [original, GENERIC_CHAIR_ID]);
      await seedCanonicalAssets(drizzle(pool, { schema }));
    }
  });
});

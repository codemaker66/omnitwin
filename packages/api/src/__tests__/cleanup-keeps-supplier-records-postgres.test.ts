import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { cleanupPreviewConfigurations } from "../services/cleanup.js";

// ---------------------------------------------------------------------------
// What a supplier was told, and what they confirmed, outlives preview cleanup.
//
// handoff_packs cascade from their configuration, supplier passes from the
// handoff pack, and acknowledgements from the pass (schema.ts, migrations
// 0029 and 0038). The 72-hour preview cleanup is the one hard delete of
// configurations, so it must never take a configuration a handoff pack was
// compiled from. These tables carry the production foreign keys, so the
// first case shows the chain really does cascade.
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
    throw new Error("Cleanup record tests require their explicit isolated loopback database");
  }
}

const VENUE = "c3333333-3333-4333-8333-333333333333";
const OPERATIONAL = "c3333333-3333-4333-8333-3333333333c1";
const ABANDONED = "c3333333-3333-4333-8333-3333333333c2";
const HANDOFF = "c3333333-3333-4333-8333-3333333333d1";
const PACK = "c3333333-3333-4333-8333-3333333333e1";

describe.skipIf(testUrl === undefined)("preview cleanup keeps supplier records, on isolated PostgreSQL", () => {
  let pool: Pool;
  const fixtureSchema = `cleanup_supplier_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.configurations, schema.placedObjects, schema.enquiries, schema.handoffPacks,
    schema.supplierCoordinationPacks, schema.supplierAcknowledgements,
  ];

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 2, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at" || column.name === "compiled_at") defaultSql = " default now()";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    // The production chain, as the migrations hold it.
    await pool.query(`ALTER TABLE placed_objects ADD FOREIGN KEY (configuration_id) REFERENCES configurations(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE handoff_packs ADD FOREIGN KEY (config_id) REFERENCES configurations(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE supplier_coordination_packs ADD FOREIGN KEY (handoff_pack_id) REFERENCES handoff_packs(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE supplier_acknowledgements ADD FOREIGN KEY (pack_id) REFERENCES supplier_coordination_packs(id) ON DELETE CASCADE`);
  }, 120_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map((table) => `"${getTableConfig(table).name}"`).join(", ")} CASCADE`);
    const stale = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await pool.query(`INSERT INTO configurations (id, venue_id, is_public_preview, user_id, created_at) VALUES
      ($1, $3, true, NULL, $4), ($2, $3, true, NULL, $4)`, [OPERATIONAL, ABANDONED, VENUE, stale]);
    await pool.query(`INSERT INTO placed_objects (configuration_id) VALUES ($1), ($2)`, [OPERATIONAL, ABANDONED]);
    await pool.query(`INSERT INTO handoff_packs (id, config_id, snapshot_hash, version, status, source_label, summary)
      VALUES ($1, $2, $3, 1, 'compiled', 'Approved snapshot v1', 'Handoff')`, [HANDOFF, OPERATIONAL, "a".repeat(64)]);
    await pool.query(`INSERT INTO supplier_coordination_packs (id, venue_id, handoff_pack_id, title, status,
        source_snapshot_hash, source_digest, source_label, safe_status)
      VALUES ($1, $2, $3, 'Bloom & Co', 'acknowledged', $4, $4, 'Approved snapshot v1', 'supplier_safe_operations_handoff')`,
    [PACK, VENUE, HANDOFF, "b".repeat(64)]);
    await pool.query(`INSERT INTO supplier_acknowledgements (pack_id, status, acknowledged_by_name) VALUES ($1, 'acknowledged', 'Sam')`, [PACK]);
  });

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  });

  async function count(table: string): Promise<number> {
    const result = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
    return result.rows[0]?.n ?? 0;
  }

  it("cascades a supplier's acknowledgement away with its configuration, which is why cleanup must not delete it", async () => {
    await pool.query("DELETE FROM configurations WHERE id = $1", [OPERATIONAL]);
    expect(await count("supplier_acknowledgements")).toBe(0);
  });

  it("deletes an abandoned preview but keeps one a handoff pack was compiled from, with its pass and acknowledgement", async () => {
    const db = drizzle(pool, { schema });
    const removed = await cleanupPreviewConfigurations(db);

    expect(removed).toBe(1);
    const left = await pool.query<{ id: string }>("SELECT id FROM configurations ORDER BY id");
    expect(left.rows.map((row) => row.id)).toEqual([OPERATIONAL]);
    expect(await count("handoff_packs")).toBe(1);
    expect(await count("supplier_coordination_packs")).toBe(1);
    expect(await count("supplier_acknowledgements")).toBe(1);
    const placed = await pool.query<{ configuration_id: string }>("SELECT configuration_id FROM placed_objects");
    expect(placed.rows.map((row) => row.configuration_id)).toEqual([OPERATIONAL]);
  });
});

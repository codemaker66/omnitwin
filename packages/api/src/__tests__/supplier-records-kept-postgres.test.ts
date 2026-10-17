import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { cleanupPreviewConfigurations } from "../services/cleanup.js";

// ---------------------------------------------------------------------------
// What a supplier was told, and what they confirmed, is kept by the database.
//
// Migration 0092 (supplier_records_kept) makes a supplier pass RESTRICT the
// delete of its handoff pack, and an acknowledgement RESTRICT the delete of
// its pass. Handoff packs still cascade from their configuration and their
// snapshot, so every route into the chain is tried here against the whole
// migration set, as production holds it: each delete is refused, naming the
// key, and leaves every row where it was. PostgreSQL reports a RESTRICT key
// as SQLSTATE 23503 (foreign_key_violation), the same code as NO ACTION, so
// the catalogue check proves the action itself is RESTRICT.
// Preview cleanup, the one hard delete of configurations, keeps working
// around the records rather than failing on them.
//
// Opt-in, disposable loopback PostgreSQL only; never reads DATABASE_URL/.env:
//   VENVIEWER_SUPPLIER_RECORDS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/venviewer_supplier_records_test
// ---------------------------------------------------------------------------

const explicitUrl = process.env["VENVIEWER_SUPPLIER_RECORDS_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_supplier_records_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Supplier record tests require the explicit loopback venviewer_supplier_records_test database");
  }
}

describe("supplier records PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_supplier_records_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgres://postgres@127.0.0.1/venviewer_supplier_records_test",
    "postgresql://postgres@127.0.0.1/venviewer_supplier_records_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

const ACK_KEY = "supplier_acknowledgements_pack_id_fkey";
const PASS_KEY = "supplier_coordination_packs_handoff_pack_id_fkey";

interface Chain {
  readonly venueId: string;
  readonly configId: string;
  readonly snapshotId: string;
  readonly handoffId: string;
  readonly passId: string | null;
}

describe.skipIf(explicitUrl === undefined)("supplier records outlive every delete, on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (explicitUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(explicitUrl);
    pool = new Pool({ connectionString: explicitUrl, application_name: `supplier-records-${randomUUID().slice(0, 8)}`, max: 3 });
    const target = await pool.query<{ database: string }>("SELECT current_database() AS database");
    expect(target.rows[0]?.database).toBe("venviewer_supplier_records_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
  }, 300_000);

  afterAll(async () => { await pool?.end(); });

  /**
   * One venue, room and configuration; one snapshot and the handoff pack
   * compiled from it; optionally a pass with an item and a live link, and
   * optionally a reply on that pass.
   */
  async function chain(options: { pass: boolean; reply: boolean; preview?: boolean }): Promise<Chain> {
    const venueId = randomUUID(), userId = randomUUID(), roomId = randomUUID();
    const configId = randomUUID(), snapshotId = randomUUID(), handoffId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "Synthetic records venue", slug: venueId, address: "Test only" });
    await db.insert(schema.users).values({ id: userId, venueId, name: "Records staff", email: `${userId}@records.test`, role: "staff" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Grand Hall", slug: roomId,
      widthM: "21", lengthM: "10.5", heightM: "7",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }] });
    const stale = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await db.insert(schema.configurations).values(options.preview === true
      ? { id: configId, venueId, spaceId: roomId, userId: null, name: "Preview plan", layoutStyle: "custom",
          isPublicPreview: true, createdAt: stale }
      : { id: configId, venueId, spaceId: roomId, userId, name: "Dinner plan", layoutStyle: "custom" });
    await db.insert(schema.configurationSheetSnapshots).values({ id: snapshotId, configurationId: configId,
      version: 1, payload: { fixture: "supplier records" }, sourceHash: "a".repeat(64), createdBy: userId });
    await db.insert(schema.handoffPacks).values({ id: handoffId, configId, snapshotId, snapshotHash: "a".repeat(64),
      version: 1, status: "compiled", sourceLabel: "Approved plan v1", summary: "Handoff", createdBy: userId });
    if (!options.pass) return { venueId, configId, snapshotId, handoffId, passId: null };

    const passId = randomUUID();
    await db.insert(schema.supplierCoordinationPacks).values({ id: passId, venueId, handoffPackId: handoffId,
      title: "Bloom & Co", contactName: "Sam", status: options.reply ? "acknowledged" : "issued",
      sourceSnapshotHash: "a".repeat(64), sourceDigest: "b".repeat(64), sourceLabel: "Approved plan v1",
      createdBy: userId, issuedAt: new Date() });
    await db.insert(schema.supplierCoordinationPackItems).values({ packId: passId, kind: "load_in_window",
      title: "Load in", detail: "Rear lane, 14:00 to 15:30" });
    const [link] = await db.insert(schema.supplierCoordinationShareTokens).values({ packId: passId,
      tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), tokenPrefix: "fixture" }).returning();
    if (options.reply) {
      await db.insert(schema.supplierAcknowledgements).values({ packId: passId, shareTokenId: link?.id ?? null,
        status: "acknowledged", acknowledgedByName: "Sam", note: "All clear for 14:00" });
    }
    return { venueId, configId, snapshotId, handoffId, passId };
  }

  /** Every row the chain holds, by table. A refused delete must leave all of them. */
  async function rows(c: Chain): Promise<Record<string, number>> {
    const result = await pool.query<Record<string, number>>(`SELECT
        (SELECT count(*)::int FROM configurations WHERE id = $1) AS configurations,
        (SELECT count(*)::int FROM configuration_sheet_snapshots WHERE id = $2) AS snapshots,
        (SELECT count(*)::int FROM handoff_packs WHERE id = $3) AS handoff_packs,
        (SELECT count(*)::int FROM supplier_coordination_packs WHERE handoff_pack_id = $3) AS passes,
        (SELECT count(*)::int FROM supplier_coordination_pack_items i
           JOIN supplier_coordination_packs p ON p.id = i.pack_id WHERE p.handoff_pack_id = $3) AS items,
        (SELECT count(*)::int FROM supplier_coordination_share_tokens t
           JOIN supplier_coordination_packs p ON p.id = t.pack_id WHERE p.handoff_pack_id = $3) AS links,
        (SELECT count(*)::int FROM supplier_acknowledgements a
           JOIN supplier_coordination_packs p ON p.id = a.pack_id WHERE p.handoff_pack_id = $3) AS replies`,
    [c.configId, c.snapshotId, c.handoffId]);
    const row = result.rows[0];
    if (row === undefined) throw new Error("Count query returned no row");
    return row;
  }

  it("holds both keys as ON DELETE RESTRICT, one key per column, under their default names", async () => {
    const keys = await pool.query<{ table: string; column: string; name: string; on_delete: string }>(`
      SELECT c.conrelid::regclass::text AS table, a.attname AS column, c.conname AS name, c.confdeltype AS on_delete
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND ((c.conrelid = 'supplier_acknowledgements'::regclass AND a.attname = 'pack_id')
          OR (c.conrelid = 'supplier_coordination_packs'::regclass AND a.attname = 'handoff_pack_id'))
      ORDER BY 1`);
    expect(keys.rows).toEqual([
      { table: "supplier_acknowledgements", column: "pack_id", name: ACK_KEY, on_delete: "r" },
      { table: "supplier_coordination_packs", column: "handoff_pack_id", name: PASS_KEY, on_delete: "r" },
    ]);
  });

  it("refuses to delete a pass a supplier has replied to, and keeps the reply, items and link", async () => {
    const c = await chain({ pass: true, reply: true });
    const before = await rows(c);
    expect(before).toMatchObject({ passes: 1, items: 1, links: 1, replies: 1 });

    await expect(pool.query("DELETE FROM supplier_coordination_packs WHERE id = $1", [c.passId]))
      .rejects.toMatchObject({ code: "23503", constraint: ACK_KEY });
    expect(await rows(c)).toEqual(before);
  });

  it("refuses to delete the handoff pack a pass was issued from, before any reply too", async () => {
    for (const reply of [false, true]) {
      const c = await chain({ pass: true, reply });
      const before = await rows(c);
      await expect(pool.query("DELETE FROM handoff_packs WHERE id = $1", [c.handoffId]))
        .rejects.toMatchObject({ code: "23503", constraint: PASS_KEY });
      expect(await rows(c)).toEqual(before);
    }
  });

  it("refuses a configuration delete that would cascade through the handoff pack, leaving nothing half-done", async () => {
    const c = await chain({ pass: true, reply: true });
    const before = await rows(c);
    expect(before).toMatchObject({ configurations: 1, snapshots: 1, handoff_packs: 1 });

    await expect(pool.query("DELETE FROM configurations WHERE id = $1", [c.configId]))
      .rejects.toMatchObject({ code: "23503", constraint: PASS_KEY });
    expect(await rows(c)).toEqual(before);
  });

  it("refuses a snapshot delete that would cascade through the handoff pack", async () => {
    const c = await chain({ pass: true, reply: true });
    const before = await rows(c);
    await expect(pool.query("DELETE FROM configuration_sheet_snapshots WHERE id = $1", [c.snapshotId]))
      .rejects.toMatchObject({ code: "23503", constraint: PASS_KEY });
    expect(await rows(c)).toEqual(before);
  });

  it("refuses at once inside a transaction, not at commit, so nothing is erased in the meantime", async () => {
    const c = await chain({ pass: true, reply: true });
    const before = await rows(c);
    const client = await pool.connect();
    let refusal: unknown = null;
    try {
      await client.query("BEGIN");
      // A deferred check would let the cascade run until COMMIT; RESTRICT
      // refuses the statement itself, even when every key is set deferred.
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      try {
        await client.query("DELETE FROM handoff_packs WHERE id = $1", [c.handoffId]);
      } catch (error) {
        refusal = error;
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(refusal).toMatchObject({ code: "23503", constraint: PASS_KEY });
    expect(await rows(c)).toEqual(before);
  });

  it("still deletes a handoff pack no pass was issued from", async () => {
    const c = await chain({ pass: false, reply: false });
    await pool.query("DELETE FROM handoff_packs WHERE id = $1", [c.handoffId]);
    expect(await rows(c)).toMatchObject({ configurations: 1, snapshots: 1, handoff_packs: 0 });
  });

  it("lets preview cleanup remove an abandoned preview and keep one a pass was issued from", async () => {
    const abandoned = await chain({ pass: false, reply: false, preview: true });
    await pool.query("DELETE FROM handoff_packs WHERE id = $1", [abandoned.handoffId]);
    const operational = await chain({ pass: true, reply: true, preview: true });
    const before = await rows(operational);

    const removed = await cleanupPreviewConfigurations(db);

    expect(removed).toBeGreaterThanOrEqual(1);
    expect((await rows(abandoned)).configurations).toBe(0);
    expect(await rows(operational)).toEqual(before);
  });
});

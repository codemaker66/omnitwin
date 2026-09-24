import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { syncPlacedObjectBatch, type PlacedObjectBatchItem, type PlacedObjectRow } from "../lib/placed-object-batch.js";
import { placedObjectRoutes } from "../routes/placed-objects.js";
import { publicConfigRoutes } from "../routes/public-configs.js";

// Never load .env or fall back to DATABASE_URL: the migrated, disposable
// platform cluster only, so migration 0044's coordinate-write trigger is real.
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Placed-object batch tests require the explicit disposable platform database");
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// The per-object writes the set-based batch replaced, kept as the reference.
async function legacySync(tx: Transaction, configId: string, items: readonly PlacedObjectBatchItem[]): Promise<PlacedObjectRow[]> {
  const results: PlacedObjectRow[] = [];
  const toUpdate = items.filter((item) => item.id !== undefined);
  const toInsert = items.filter((item) => item.id === undefined);
  const batchIds = toUpdate.map((item) => item.id).filter((id): id is string => id !== undefined);
  if (batchIds.length > 0) {
    const existing = await tx.select({ id: schema.placedObjects.id }).from(schema.placedObjects)
      .where(eq(schema.placedObjects.configurationId, configId));
    const toDelete = existing.map((row) => row.id).filter((id) => !batchIds.includes(id));
    if (toDelete.length > 0) await tx.delete(schema.placedObjects).where(inArray(schema.placedObjects.id, toDelete));
  } else {
    await tx.delete(schema.placedObjects).where(eq(schema.placedObjects.configurationId, configId));
  }
  for (const item of toUpdate) {
    if (item.id === undefined) continue;
    const [updated] = await tx.update(schema.placedObjects).set({
      assetDefinitionId: item.assetDefinitionId,
      positionX: String(item.positionX), positionY: String(item.positionY), positionZ: String(item.positionZ),
      rotationX: String(item.rotationX), rotationY: String(item.rotationY), rotationZ: String(item.rotationZ),
      scale: String(item.scale), sortOrder: item.sortOrder, metadata: item.metadata ?? null,
      coordinateWriteToken: randomUUID(),
    }).where(and(eq(schema.placedObjects.id, item.id), eq(schema.placedObjects.configurationId, configId))).returning();
    if (updated !== undefined) results.push(updated);
  }
  if (toInsert.length > 0) {
    results.push(...await tx.insert(schema.placedObjects).values(toInsert.map((item) => ({
      configurationId: configId, assetDefinitionId: item.assetDefinitionId,
      positionX: String(item.positionX), positionY: String(item.positionY), positionZ: String(item.positionZ),
      rotationX: String(item.rotationX), rotationY: String(item.rotationY), rotationZ: String(item.rotationZ),
      scale: String(item.scale), sortOrder: item.sortOrder, metadata: item.metadata ?? null,
      coordinateWriteToken: randomUUID(),
    }))).returning());
  }
  return results;
}

/** Row content without identity: what two equivalent writes must agree on. */
function content(row: PlacedObjectRow) {
  const { id: _id, configurationId: _configurationId, coordinateWriteToken: _token, ...rest } = row;
  return rest;
}

describe.skipIf(target === undefined)("placed-object batch saves on migrated PostgreSQL", () => {
  const applicationName = `placed_object_batch_${randomUUID()}`;
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const statements: string[] = [];
  const venueId = randomUUID();
  const spaceId = randomUUID();
  const ownerId = randomUUID();
  const chairId = randomUUID();
  const tableId = randomUUID();

  function authHeaders(): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: ownerId, email: `${ownerId}@batch.invalid`,
      role: "planner", platformRole: "none", venueId: null })}` };
  }

  async function configuration(options: { guest?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.configurations).values({ id, spaceId, venueId, name: "TEST ONLY batch layout",
      layoutStyle: "banquet", userId: options.guest === true ? null : ownerId, isPublicPreview: options.guest === true });
    return id;
  }

  function item(index: number, overrides: Partial<PlacedObjectBatchItem> = {}): PlacedObjectBatchItem {
    return { assetDefinitionId: index % 2 === 0 ? chairId : tableId,
      positionX: 1 + (index % 17), positionY: 0, positionZ: 1 + Math.floor(index / 17),
      rotationX: 0, rotationY: 0.25 * index, rotationZ: 0, scale: 1, sortOrder: index,
      metadata: { label: `Seat ${String(index)}` }, ...overrides };
  }

  async function save(configId: string, revision: number, objects: readonly PlacedObjectBatchItem[], guest = false) {
    const response = await server.inject({ method: "POST",
      url: guest ? `/public/configurations/${configId}/objects/batch` : `/configurations/${configId}/objects/batch`,
      headers: guest ? {} : authHeaders(), payload: { expectedRevision: revision, objects } });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ data: { objects: PlacedObjectRow[]; revision: number } }>();
    return body.data;
  }

  async function stored(configId: string): Promise<PlacedObjectRow[]> {
    return db.select().from(schema.placedObjects).where(eq(schema.placedObjects.configurationId, configId))
      .orderBy(asc(schema.placedObjects.sortOrder), asc(schema.placedObjects.id));
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 4,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema, logger: { logQuery: (query) => { statements.push(query); } } });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY batch venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] });
    await db.insert(schema.users).values({ id: ownerId, name: "Batch owner", email: `${ownerId}@batch.invalid`, role: "planner" });
    await db.insert(schema.assetDefinitions).values([
      { id: chairId, name: "TEST ONLY chair", category: "chair", widthM: "0.5", depthM: "0.5", heightM: "0.9" },
      { id: tableId, name: "TEST ONLY table", category: "table", widthM: "1.8", depthM: "1.8", heightM: "0.75" },
    ]);
    server = Fastify();
    await server.register(placedObjectRoutes, { db, prefix: "/configurations/:configId/objects" });
    await server.register(publicConfigRoutes, { db, prefix: "/public" });
    await server.ready();
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("rewrites a layout in the same number of statements whatever its size", async () => {
    const counts: number[] = [];
    for (const size of [3, 150]) {
      const configId = await configuration();
      const first = await save(configId, 1, Array.from({ length: size }, (_, index) => item(index)));
      const moved = first.objects.map((row, index) => item(index, { id: row.id, positionX: 2.5 + (index % 15) }));
      statements.length = 0;
      const second = await save(configId, first.revision, moved);
      counts.push(statements.length);
      expect(second.objects.map((row) => row.id)).toEqual(first.objects.map((row) => row.id));
      expect((await stored(configId)).map((row) => row.positionX)).toEqual(moved.map((entry) => entry.positionX.toFixed(3)));
    }
    expect(counts[1]).toBe(counts[0]);
  });

  it("matches the per-object writes it replaced, row for row", async () => {
    const legacyConfig = await configuration();
    const batchConfig = await configuration();
    const foreignConfig = await configuration();
    const seed = Array.from({ length: 8 }, (_, index) => item(index));
    const [legacySeed, batchSeed, foreign] = await Promise.all([
      save(legacyConfig, 1, seed), save(batchConfig, 1, seed), save(foreignConfig, 1, [item(99)]),
    ]);
    const foreignRow = foreign.objects[0];
    if (foreignRow === undefined) throw new Error("Missing foreign fixture row");

    // Rounding at numeric(8,3)/(8,5)/(5,3), null metadata, an omitted row,
    // a repeated id (last entry wins), an id from another layout and inserts.
    const plan = (ids: readonly string[]): PlacedObjectBatchItem[] => [
      item(0, { id: ids[0], positionX: 3.14159, rotationY: 1.0000049, scale: 1.2345, metadata: null }),
      item(1, { id: ids[1], positionZ: 7.0005, sortOrder: 40 }),
      item(2, { id: ids[2], positionX: 4 }),
      item(2, { id: ids[2], positionX: 5.5, metadata: { label: "moved twice" } }),
      item(3, { id: foreignRow.id, positionX: 9 }),
      ...ids.slice(3, 7).map((id, offset) => item(offset + 4, { id })),
      item(20, { positionX: 12.25, metadata: null }),
      item(21, { positionZ: 1e-7 }),
    ];
    const legacyIds = legacySeed.objects.map((row) => row.id);
    const batchIds = batchSeed.objects.map((row) => row.id);
    const legacyResult = await db.transaction((tx) => legacySync(tx, legacyConfig, plan(legacyIds)));
    const batchResult = await db.transaction((tx) => syncPlacedObjectBatch(tx, batchConfig, plan(batchIds)));

    // Repeated ids: the old loop returned the intermediate write first; the
    // final stored state and every other returned row are identical.
    const withoutFirstRepeat = (rows: PlacedObjectRow[], repeatedId: string | undefined) =>
      rows.filter((row, index) => !(row.id === repeatedId && rows.findIndex((other) => other.id === repeatedId) === index));
    expect(withoutFirstRepeat(batchResult, batchIds[2]).map(content))
      .toEqual(withoutFirstRepeat(legacyResult, legacyIds[2]).map(content));
    expect(batchResult.map((row) => row.id)).toEqual([...batchIds.slice(0, 3), batchIds[2], ...batchIds.slice(3, 7),
      ...batchResult.slice(-2).map((row) => row.id)]);
    expect((await stored(batchConfig)).map(content)).toEqual((await stored(legacyConfig)).map(content));
    expect(await stored(batchConfig)).toHaveLength(9);
    expect((await stored(batchConfig)).find((row) => row.id === batchIds[0])).toMatchObject({
      positionX: "3.142", rotationY: "1.00000", scale: "1.235", metadata: null,
    });
    expect(await stored(foreignConfig)).toEqual([expect.objectContaining({ id: foreignRow.id, positionX: foreignRow.positionX })]);
  });

  it("gives every moved row a fresh write token under the real coordinate trigger", async () => {
    const configId = await configuration();
    const first = await save(configId, 1, [item(0), item(1)]);
    const before = new Map((await stored(configId)).map((row) => [row.id, row.coordinateWriteToken]));
    await save(configId, first.revision, first.objects.map((row, index) => item(index, { id: row.id, positionX: 8 + index })));
    for (const row of await stored(configId)) {
      expect(row.coordinateWriteToken).not.toBe(before.get(row.id));
    }
    // The guard itself is intact: a coordinate write without a new token fails.
    await expect(pool.query("UPDATE placed_objects SET position_x = position_x + 1 WHERE configuration_id = $1", [configId]))
      .rejects.toMatchObject({ code: "23514" });
  });

  it("saves guest preview batches through the same full-sync path", async () => {
    const configId = await configuration({ guest: true });
    const first = await save(configId, 1, [item(0), item(1), item(2)], true);
    const [keep, drop, move] = first.objects;
    if (keep === undefined || drop === undefined || move === undefined) throw new Error("Missing guest rows");
    const second = await save(configId, first.revision, [
      item(0, { id: keep.id }), item(2, { id: move.id, positionZ: 6.5 }), item(3),
    ], true);
    expect(second.revision).toBe(first.revision + 1);
    expect(second.objects.slice(0, 2).map((row) => row.id)).toEqual([keep.id, move.id]);
    const rows = await stored(configId);
    expect(rows.map((row) => row.id)).not.toContain(drop.id);
    expect(rows.find((row) => row.id === move.id)?.positionZ).toBe("6.500");
    expect(rows).toHaveLength(3);
    const revisions = await db.select().from(schema.configurationLayoutRevisions)
      .where(eq(schema.configurationLayoutRevisions.configurationId, configId));
    expect(revisions.map((revision) => revision.revision).sort()).toEqual([2, 3]);
  });
});

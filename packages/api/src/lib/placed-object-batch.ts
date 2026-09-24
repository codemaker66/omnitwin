import { randomUUID } from "node:crypto";
import { and, eq, getTableColumns, notInArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { placedObjects } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Full-sync layout batches (authenticated and guest planner saves).
//
// A save rewrites every object in the layout, so the rewrite is one set-based
// UPDATE instead of one statement per object: a 300-object autosave used to
// make ~300 sequential round trips while holding the configuration's revision
// lock. Each updated row still receives its own coordinate write token, which
// migration 0044's trigger requires for any X/Z change.
// ---------------------------------------------------------------------------

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type PlacedObjectRow = typeof placedObjects.$inferSelect;

/** One validated batch item, as both batch routes parse it. */
export interface PlacedObjectBatchItem {
  readonly id?: string | undefined;
  readonly assetDefinitionId: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  readonly scale: number;
  readonly sortOrder: number;
  readonly metadata?: Record<string, unknown> | null | undefined;
}

/**
 * Makes the configuration's placed objects exactly the batch: deletes objects
 * it omits, rewrites the listed ones (ids from other configurations are
 * ignored) and inserts the new ones. Returns the rewritten rows in batch
 * order followed by the inserted rows, as the per-object writes did. When an
 * id repeats, its last entry wins, as it did when each entry was written in
 * turn. Must run inside the caller's transaction.
 */
export async function syncPlacedObjectBatch(
  tx: Transaction,
  configurationId: string,
  items: readonly PlacedObjectBatchItem[],
): Promise<PlacedObjectRow[]> {
  const latestById = new Map<string, PlacedObjectBatchItem>();
  const toInsert: PlacedObjectBatchItem[] = [];
  for (const item of items) {
    if (item.id === undefined) toInsert.push(item);
    else latestById.set(item.id, item);
  }
  const batchIds = [...latestById.keys()];

  await tx.delete(placedObjects).where(batchIds.length > 0
    ? and(eq(placedObjects.configurationId, configurationId), notInArray(placedObjects.id, batchIds))
    : eq(placedObjects.configurationId, configurationId));

  const results: PlacedObjectRow[] = [];
  if (batchIds.length > 0) {
    // Values travel as one JSON parameter; numbers keep the exact text the
    // per-object writes sent, so numeric(p, s) rounding is unchanged.
    const rows = batchIds.map((id) => {
      const item = latestById.get(id);
      if (item === undefined) throw new Error("Batch id without an item");
      return {
        id,
        asset_definition_id: item.assetDefinitionId,
        position_x: String(item.positionX),
        position_y: String(item.positionY),
        position_z: String(item.positionZ),
        rotation_x: String(item.rotationX),
        rotation_y: String(item.rotationY),
        rotation_z: String(item.rotationZ),
        scale: String(item.scale),
        sort_order: item.sortOrder,
        metadata: item.metadata ?? null,
        coordinate_write_token: randomUUID(),
      };
    });
    const updated = await tx.update(placedObjects)
      .set({
        assetDefinitionId: sql`batch.asset_definition_id`,
        positionX: sql`batch.position_x`,
        positionY: sql`batch.position_y`,
        positionZ: sql`batch.position_z`,
        rotationX: sql`batch.rotation_x`,
        rotationY: sql`batch.rotation_y`,
        rotationZ: sql`batch.rotation_z`,
        scale: sql`batch.scale`,
        sortOrder: sql`batch.sort_order`,
        metadata: sql`batch.metadata`,
        coordinateWriteToken: sql`batch.coordinate_write_token`,
      })
      .from(sql`jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as batch(
        id uuid, asset_definition_id uuid,
        position_x numeric, position_y numeric, position_z numeric,
        rotation_x numeric, rotation_y numeric, rotation_z numeric,
        scale numeric, sort_order integer, metadata jsonb, coordinate_write_token uuid)`)
      .where(and(eq(placedObjects.id, sql`batch.id`), eq(placedObjects.configurationId, configurationId)))
      .returning(getTableColumns(placedObjects));

    const updatedById = new Map(updated.map((row) => [row.id, row]));
    for (const item of items) {
      if (item.id === undefined) continue;
      const row = updatedById.get(item.id);
      if (row !== undefined) results.push(row);
    }
  }

  if (toInsert.length > 0) {
    const inserted = await tx.insert(placedObjects)
      .values(toInsert.map((item) => ({
        configurationId,
        assetDefinitionId: item.assetDefinitionId,
        positionX: String(item.positionX),
        positionY: String(item.positionY),
        positionZ: String(item.positionZ),
        rotationX: String(item.rotationX),
        rotationY: String(item.rotationY),
        rotationZ: String(item.rotationZ),
        scale: String(item.scale),
        sortOrder: item.sortOrder,
        metadata: item.metadata ?? null,
        coordinateWriteToken: randomUUID(),
      })))
      .returning();
    results.push(...inserted);
  }

  return results;
}

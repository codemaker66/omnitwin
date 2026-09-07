import { CANONICAL_ASSETS } from "@omnitwin/types";
import { inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { assetDefinitions } from "./schema.js";

type AssetRow = typeof assetDefinitions.$inferSelect;

/** A migration may already have registered a canonical asset. Reuse that exact
 * identity, preserving its createdAt and every physical inventory reference.
 * A conflict aborts the whole registration instead of silently replacing data. */
export async function seedCanonicalAssets(db: Database): Promise<AssetRow[]> {
  return db.transaction(async (tx) => {
    await tx.insert(assetDefinitions).values(CANONICAL_ASSETS.map((asset) => ({
      id: asset.id, name: asset.name, category: asset.category,
      widthM: String(asset.widthM), depthM: String(asset.depthM), heightM: String(asset.heightM),
      seatCount: asset.seatCount, collisionType: asset.collisionType,
      meshUrl: asset.meshUrl ?? null, thumbnailUrl: asset.thumbnailUrl ?? null,
    }))).onConflictDoNothing({ target: assetDefinitions.id });

    const rows = await tx.select().from(assetDefinitions)
      .where(inArray(assetDefinitions.id, CANONICAL_ASSETS.map((asset) => asset.id)))
      .for("share");
    const byId = new Map(rows.map((row) => [row.id, row]));
    return CANONICAL_ASSETS.map((asset) => {
      const row = byId.get(asset.id);
      if (row === undefined || row.name !== asset.name || row.category !== asset.category
        || Number(row.widthM) !== asset.widthM || Number(row.depthM) !== asset.depthM
        || Number(row.heightM) !== asset.heightM || row.seatCount !== asset.seatCount
        || row.collisionType !== asset.collisionType || row.meshUrl !== (asset.meshUrl ?? null)
        || row.thumbnailUrl !== (asset.thumbnailUrl ?? null)) {
        throw new Error(`CANONICAL_ASSET_CONFLICT: ${asset.slug} (${asset.id}) does not match the existing catalogue record`);
      }
      return row;
    });
  });
}

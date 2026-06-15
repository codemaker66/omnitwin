import { eq } from "drizzle-orm";
import type { FloorPlanPoint, ProposalLayoutItem, ProposalLayoutSnapshot } from "@omnitwin/types";
import { MAX_PROPOSAL_LAYOUT_ITEMS } from "@omnitwin/types";
import { assetDefinitions, configurations, placedObjects, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Proposal layout snapshot builder (T-427 phase 7).
//
// Projects a configuration's placed objects + room outline into a client-safe
// top-down geometry: room dimensions in metres and furniture footprints
// positioned RELATIVE to the room origin (so no absolute floor-plan
// coordinates and, critically, no internal IDs leak to the client).
//
// Coordinate convention matches placement-validation.ts: placed-object
// positionX / positionZ and the space outline are the SAME metre floor-plan
// units (x horizontal, z depth). No render-scale conversion is involved.
// ---------------------------------------------------------------------------

export interface SnapshotPlacedObject {
  readonly positionX: number;
  readonly positionZ: number;
  readonly rotationY: number;
  readonly scale: number;
  readonly assetDefinitionId: string;
}

export interface SnapshotAssetDims {
  readonly widthM: number;
  readonly depthM: number;
  readonly category: string;
  readonly name: string;
}

function inferKind(category: string): ProposalLayoutItem["kind"] {
  if (category === "chair") return "chair";
  if (category === "table") return "table";
  if (category === "stage") return "stage";
  return "other";
}

function inferShape(category: string, name: string): ProposalLayoutItem["shape"] {
  // Only round tables read as circles; everything else is a rectangular
  // footprint. asset_definitions has no shape column, so round is inferred
  // from the catalogue name (e.g. "6ft Round Table").
  if (category === "table" && name.toLowerCase().includes("round")) return "round";
  return "rect";
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > max) return max;
  return value;
}

/**
 * Build a client-safe layout snapshot from a room outline + placed objects.
 * Pure and fully testable. Returns null when there's no usable room or no
 * renderable items (so the page simply omits the visual).
 */
export function buildProposalLayoutSnapshot(
  outline: readonly FloorPlanPoint[],
  objects: readonly SnapshotPlacedObject[],
  assetById: ReadonlyMap<string, SnapshotAssetDims>,
): ProposalLayoutSnapshot | null {
  if (outline.length < 3) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minZ) minZ = p.y;
    if (p.y > maxZ) maxZ = p.y;
  }
  const roomWidthM = maxX - minX;
  const roomLengthM = maxZ - minZ;
  if (!(roomWidthM > 0) || !(roomLengthM > 0)) return null;

  const items: ProposalLayoutItem[] = [];
  for (const object of objects) {
    const asset = assetById.get(object.assetDefinitionId);
    if (asset === undefined) continue;
    const scale = object.scale > 0 ? object.scale : 1;
    const widthM = asset.widthM * scale;
    const depthM = asset.depthM * scale;
    if (!(widthM > 0) || !(depthM > 0)) continue;

    items.push({
      shape: inferShape(asset.category, asset.name),
      kind: inferKind(asset.category),
      xM: clamp(object.positionX - minX, roomWidthM),
      zM: clamp(object.positionZ - minZ, roomLengthM),
      widthM,
      depthM,
      rotationDeg: (object.rotationY * 180) / Math.PI,
    });
    if (items.length >= MAX_PROPOSAL_LAYOUT_ITEMS) break;
  }
  if (items.length === 0) return null;

  return { roomWidthM, roomLengthM, items };
}

/**
 * Resolve a configuration's room + placed objects from the database and build
 * the snapshot. Returns null when the configuration has no space, no outline,
 * or no renderable objects — the version is still created without a visual.
 */
export async function resolveProposalLayoutSnapshot(
  db: Database,
  configurationId: string,
): Promise<ProposalLayoutSnapshot | null> {
  const [config] = await db.select({ spaceId: configurations.spaceId })
    .from(configurations)
    .where(eq(configurations.id, configurationId))
    .limit(1);
  if (config === undefined) return null;

  const [space] = await db.select({ outline: spaces.floorPlanOutline })
    .from(spaces)
    .where(eq(spaces.id, config.spaceId))
    .limit(1);
  if (space === undefined) return null;
  const outline = space.outline as readonly FloorPlanPoint[];

  const objects = await db.select({
    positionX: placedObjects.positionX,
    positionZ: placedObjects.positionZ,
    rotationY: placedObjects.rotationY,
    scale: placedObjects.scale,
    assetDefinitionId: placedObjects.assetDefinitionId,
  }).from(placedObjects)
    .where(eq(placedObjects.configurationId, configurationId))
    .orderBy(placedObjects.sortOrder);
  if (objects.length === 0) return null;

  const assetRows = await db.select({
    id: assetDefinitions.id,
    widthM: assetDefinitions.widthM,
    depthM: assetDefinitions.depthM,
    category: assetDefinitions.category,
    name: assetDefinitions.name,
  }).from(assetDefinitions);

  const assetById = new Map<string, SnapshotAssetDims>(
    assetRows.map((row) => [row.id, {
      widthM: Number(row.widthM),
      depthM: Number(row.depthM),
      category: row.category,
      name: row.name,
    }]),
  );

  return buildProposalLayoutSnapshot(
    outline,
    objects.map((o) => ({
      positionX: Number(o.positionX),
      positionZ: Number(o.positionZ),
      rotationY: Number(o.rotationY),
      scale: Number(o.scale),
      assetDefinitionId: o.assetDefinitionId,
    })),
    assetById,
  );
}

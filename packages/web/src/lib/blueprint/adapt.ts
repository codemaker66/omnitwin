import { CANONICAL_ASSETS, type CanonicalAsset } from "@omnitwin/types";
import type { EditorObject } from "../../stores/editor-store.js";
import type { Space } from "../../api/spaces.js";
import type {
  BlueprintItem,
  BlueprintScene,
  EventType,
  ItemKind,
  Point,
} from "./types.js";

// ---------------------------------------------------------------------------
// Editor-state → BlueprintScene adapter
//
// The 3D editor stores placed objects with full 3D transforms (x, y, z) on a
// centred room origin. The 2D blueprint view uses a top-down top-left origin
// with metres as its unit. This module is the bridge.
//
// Assumptions (explicit so they're easy to revisit):
//
//   1. 3D origin is the ROOM CENTRE at floor level. Y is vertical (up);
//      the blueprint only cares about the floor plane, so we project
//      (x, z) → blueprint (x, y).
//
//   2. The catalogue's `CANONICAL_ASSETS` array is the source of truth
//      for an asset's physical dimensions and shape. Placed-object
//      rotation around Y is honoured as the blueprint item's rotation.
//
//   3. Items whose shape can't be drawn on the blueprint (single chairs,
//      AV gear, decor, tablecloths) are FILTERED OUT — the blueprint is
//      the floor-plan, not the full render tree.
// ---------------------------------------------------------------------------

const ASSET_BY_ID = new Map<string, CanonicalAsset>(
  CANONICAL_ASSETS.map((a) => [a.id, a]),
);

/** Resolve a placed object to its canonical catalogue definition. */
export function assetForObject(o: EditorObject): CanonicalAsset | undefined {
  return ASSET_BY_ID.get(o.assetDefinitionId);
}

/**
 * Map a catalogue asset to a blueprint item kind. Returns `null` when
 * the asset has no meaningful 2D footprint (chairs, AV gear, cloths) so
 * callers can skip it.
 */
export function itemKindForAsset(asset: CanonicalAsset): ItemKind | null {
  const slug = asset.slug;
  if (slug.includes("bar")) return "bar";
  if (slug.includes("dancefloor") || slug.includes("parquet")) return "dancefloor";
  if (asset.category === "stage") return "stage";
  if (asset.category === "table") {
    if (asset.tableShape === "round") return "round-table";
    if (slug.startsWith("top-") || slug.includes("head-table")) return "top-table";
    return "long-table";
  }
  return null;
}

/**
 * Convert a single editor object into a blueprint item, given the
 * room dimensions for centre-to-corner origin translation. Returns
 * `null` for assets that don't belong on the floor plan.
 *
 * `chairsByGroupId` is an optional pre-computed lookup of chair points
 * indexed by their groupId. When supplied, round tables that share a
 * groupId with chairs receive the actual chair positions on the
 * `chairs` field — required so the 2D view reflects the 3D scene's
 * wall-clearance offsets rather than drawing a uniform algorithmic ring.
 */
export function editorObjectToBlueprintItem(
  o: EditorObject,
  room: { widthM: number; lengthM: number },
  chairsByGroupId?: ReadonlyMap<string, readonly Point[]>,
): BlueprintItem | null {
  const asset = assetForObject(o);
  if (asset === undefined) return null;
  const kind = itemKindForAsset(asset);
  if (kind === null) return null;

  // Translate centre-origin → corner-origin (blueprint convention).
  const cx = o.positionX + room.widthM / 2;
  const cy = o.positionZ + room.lengthM / 2;
  const rotationDeg = radToDeg(o.rotationY);

  if (kind === "round-table") {
    const diameterM = asset.widthM * o.scale;
    const chairs =
      chairsByGroupId !== undefined && o.groupId !== null
        ? chairsByGroupId.get(o.groupId)
        : undefined;
    return {
      id: o.id,
      kind: "round-table",
      shape: "round",
      center: { x: cx, y: cy },
      diameterM,
      seats: asset.seatCount ?? 0,
      linen: o.clothed ? "Ivory" : undefined,
      centrepiece: undefined,
      rotationDeg,
      chairs,
    };
  }

  // Rect-like items: blueprint stores top-left, so back off by half-extents.
  const widthM = asset.widthM * o.scale;
  const lengthM = asset.depthM * o.scale;
  const topLeft = { x: cx - widthM / 2, y: cy - lengthM / 2 };

  if (kind === "dancefloor") {
    return {
      id: o.id,
      kind: "dancefloor",
      shape: "dancefloor",
      topLeft,
      widthM,
      lengthM,
      rotationDeg,
    };
  }
  if (kind === "stage" || kind === "long-table" || kind === "top-table") {
    return {
      id: o.id,
      kind,
      shape: "rect",
      topLeft,
      widthM,
      lengthM,
      seats: asset.seatCount ?? undefined,
      linen: o.clothed ? "Ivory" : undefined,
      rotationDeg,
    };
  }
  // kind === "bar"
  return {
    id: o.id,
    kind: "bar",
    shape: "bar",
    topLeft,
    widthM,
    lengthM,
    rotationDeg,
  };
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function parseM(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/**
 * Top-level: read everything the blueprint view needs from the editor
 * state snapshot. The adapter is pure — no subscriptions, no effects.
 */
export interface AdaptInput {
  readonly space: Pick<Space, "name" | "widthM" | "lengthM"> | null;
  readonly objects: readonly EditorObject[];
  readonly lastSavedAt: Date | null;
  /** User-chosen event type; falls back to "wedding" when null. */
  readonly eventType?: EventType;
  /** User-entered guest count; falls back to 0 when null. */
  readonly guestCount?: number;
  /** Layout name to display in the chrome. */
  readonly layoutName?: string;
  /** Review status for the header chip. */
  readonly status?: "draft" | "submitted" | "approved";
}

export function adaptEditorStateToBlueprintScene(input: AdaptInput): BlueprintScene {
  const widthM = input.space !== null ? parseM(input.space.widthM) : 10;
  const lengthM = input.space !== null ? parseM(input.space.lengthM) : 10;
  const room = { widthM, lengthM };

  // Pre-pass: collect chair positions per groupId so each round table can
  // receive its actual chairs on the `chairs` field. Chairs are otherwise
  // filtered out of the blueprint (they have no first-class footprint),
  // but the visual ring drawn around a round table needs the real
  // positions to match what the 3D auto-arrange produced.
  const chairsByGroupId = new Map<string, Point[]>();
  for (const obj of input.objects) {
    const asset = ASSET_BY_ID.get(obj.assetDefinitionId);
    if (asset === undefined) continue;
    if (asset.category !== "chair") continue;
    if (obj.groupId === null) continue;
    const point: Point = {
      x: obj.positionX + room.widthM / 2,
      y: obj.positionZ + room.lengthM / 2,
    };
    const list = chairsByGroupId.get(obj.groupId) ?? [];
    list.push(point);
    chairsByGroupId.set(obj.groupId, list);
  }

  const items: BlueprintItem[] = [];
  for (const obj of input.objects) {
    const item = editorObjectToBlueprintItem(obj, room, chairsByGroupId);
    if (item !== null) items.push(item);
  }

  return {
    roomName: input.space?.name ?? "Untitled space",
    layoutName: input.layoutName ?? "Draft layout",
    status: input.status ?? "draft",
    eventType: input.eventType ?? "wedding",
    guestCount: input.guestCount ?? 0,
    room,
    items,
    lastSavedAtMs: input.lastSavedAt !== null ? input.lastSavedAt.getTime() : null,
  };
}

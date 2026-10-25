import { seatBaseSlug } from "@omnitwin/types";
import { toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { atVerdict, judgeGhost, refusalChip, type GhostObstacle, type GhostWorld } from "./ghost-truth.js";
import {
  computeRotatedFootprint,
  expandIdsToGroupMembers,
  generatePlacedId,
  nextTableLabels,
  type PlacedItem,
} from "./placement.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";

// ---------------------------------------------------------------------------
// Editing basics (card-dock spec §18, Q-11): duplicate, copy, paste, select all.
//
// Pure plans over placed pieces. Each returns the pieces to add and an old to
// new id map (so a caller can carry notes across), and the caller commits it
// as one undo step. Copies get new ids, new group and set ids and, at dining
// tables, the next table numbers. Where a copy lands is judged like any ghost:
// pushed clear by up to 0.15 m, or refused with the reason.
// ---------------------------------------------------------------------------

/** Ctrl D's gap: a copy sits one aisle from its original. */
export const DUPLICATE_GAP_M = 1.2;

/** A shift across the floor, render-space. */
export interface FloorOffset {
  readonly dx: number;
  readonly dz: number;
}

export interface EditOptions {
  /** Number the copies' dining tables "Table N" (the tableNumbers switch). */
  readonly numberTables?: boolean;
  readonly newId?: () => string;
}

export type EditPlan =
  | {
    readonly ok: true;
    readonly items: readonly PlacedItem[];
    /** Each copied piece's id, original to copy. */
    readonly idMap: ReadonlyMap<string, string>;
    /** Where the copies went, from the originals (for Ctrl D's repeat). */
    readonly offset: FloorOffset;
  }
  | {
    readonly ok: false;
    readonly obstacle: GhostObstacle | null;
    /** The refusal chip's words. */
    readonly reason: string;
  };

/** The pieces an edit acts on: scene furniture, not dressing rows. */
function pieces(items: readonly PlacedItem[]): readonly PlacedItem[] {
  return items.filter((piece) => isSceneFurniturePlacement(piece));
}

/** The selected pieces made whole: a table brings its chairs, a trestle its set. */
export function wholeSelection(selectedIds: ReadonlySet<string>, placedItems: readonly PlacedItem[]): readonly PlacedItem[] {
  const ids = expandIdsToGroupMembers(selectedIds, placedItems);
  return pieces(placedItems.filter((piece) => ids.has(piece.id)));
}

function isDiningTable(piece: PlacedItem): boolean {
  const item = getCatalogueItem(piece.catalogueItemId);
  return item !== undefined && isDiningTableItem(item);
}

/** The floor the pieces cover together: their rotated footprints' bounds, render-space. */
export function footprintBounds(items: readonly PlacedItem[]): { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number } | null {
  let bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  for (const piece of pieces(items)) {
    const item = getCatalogueItem(piece.catalogueItemId);
    if (item === undefined) continue;
    const { halfW, halfD } = computeRotatedFootprint(item, piece.rotationY, piece.scale);
    const next = { minX: piece.x - halfW, maxX: piece.x + halfW, minZ: piece.z - halfD, maxZ: piece.z + halfD };
    bounds = bounds === null ? next : {
      minX: Math.min(bounds.minX, next.minX),
      maxX: Math.max(bounds.maxX, next.maxX),
      minZ: Math.min(bounds.minZ, next.minZ),
      maxZ: Math.max(bounds.maxZ, next.maxZ),
    };
  }
  return bounds;
}

/**
 * Copies of these pieces shifted by an offset: new ids, a new group id for
 * each group and a new set id for each set, and (when numbering) the next
 * free table numbers at dining tables, lowest first.
 */
export function clonePieces(
  items: readonly PlacedItem[],
  offset: FloorOffset,
  placedItems: readonly PlacedItem[],
  options: EditOptions = {},
): { readonly items: readonly PlacedItem[]; readonly idMap: ReadonlyMap<string, string> } {
  const newId = options.newId ?? generatePlacedId;
  const source = pieces(items);
  const groups = new Map<string, string>();
  const sets = new Map<string, string>();
  const tables = options.numberTables === false ? 0 : source.filter(isDiningTable).length;
  const labels = [...nextTableLabels(placedItems, tables)];
  const idMap = new Map<string, string>();
  const copies = source.map((piece) => {
    const id = newId();
    idMap.set(piece.id, id);
    let groupId: string | null = null;
    if (piece.groupId !== null) {
      groupId = groups.get(piece.groupId) ?? newId();
      groups.set(piece.groupId, groupId);
    }
    let setId: string | undefined;
    if (piece.setId !== undefined) {
      setId = sets.get(piece.setId) ?? newId();
      sets.set(piece.setId, setId);
    }
    const label = tables > 0 && isDiningTable(piece) ? labels.shift() ?? piece.label : piece.label;
    const copy: PlacedItem = { ...piece, id, x: piece.x + offset.dx, z: piece.z + offset.dz, groupId, label };
    return setId === undefined ? copy : { ...copy, setId };
  });
  return { items: copies, idMap };
}

/**
 * Where Ctrl D tries to put a copy, in order: the last offset this session,
 * then one aisle (1.2 m) beyond the pieces' own footprint along the room's
 * long axis, both ways, then along its short axis.
 */
export function duplicateOffsets(
  selection: readonly PlacedItem[],
  room: { readonly width: number; readonly length: number },
  last: FloorOffset | null,
): readonly FloorOffset[] {
  const bounds = footprintBounds(selection);
  if (bounds === null) return last === null ? [] : [last];
  const gap = toRenderSpace(DUPLICATE_GAP_M);
  const alongX = bounds.maxX - bounds.minX + gap;
  const alongZ = bounds.maxZ - bounds.minZ + gap;
  const xs: readonly FloorOffset[] = [{ dx: alongX, dz: 0 }, { dx: -alongX, dz: 0 }];
  const zs: readonly FloorOffset[] = [{ dx: 0, dz: alongZ }, { dx: 0, dz: -alongZ }];
  const standard = room.width >= room.length ? [...xs, ...zs] : [...zs, ...xs];
  return last === null ? standard : [last, ...standard.filter((o) => o.dx !== last.dx || o.dz !== last.dz)];
}

/** Judges the shifted pieces where they would land; a push of up to 0.15 m is taken, as for any ghost. */
function landing(source: readonly PlacedItem[], offset: FloorOffset, world: GhostWorld): { readonly offset: FloorOffset; readonly obstacle: GhostObstacle | null } | { readonly offset: null; readonly obstacle: GhostObstacle | null } {
  const moved = source.map((piece) => ({ ...piece, x: piece.x + offset.dx, z: piece.z + offset.dz }));
  const verdict = judgeGhost(moved, world);
  if (verdict.state === "refused") return { offset: null, obstacle: verdict.obstacle };
  const landed = atVerdict(moved, verdict);
  const first = landed[0];
  const original = source[0];
  if (first === undefined || original === undefined) return { offset, obstacle: null };
  return { offset: { dx: first.x - original.x, dz: first.z - original.z }, obstacle: null };
}

function refused(obstacle: GhostObstacle | null): EditPlan {
  return { ok: false, obstacle, reason: refusalChip(obstacle) };
}

/** Ctrl D: the selection, made whole, copied one pitch away where it first fits; refused with the reason when none does. */
export function planDuplicate(
  selectedIds: ReadonlySet<string>,
  world: GhostWorld,
  last: FloorOffset | null,
  options: EditOptions = {},
): EditPlan {
  const source = wholeSelection(selectedIds, world.placedItems);
  if (source.length === 0) return refused(null);
  let firstRefusal: GhostObstacle | null = null;
  for (const offset of duplicateOffsets(source, world.room, last)) {
    const landed = landing(source, offset, world);
    if (landed.offset === null) {
      firstRefusal ??= landed.obstacle;
      continue;
    }
    const clone = clonePieces(source, landed.offset, world.placedItems, options);
    return { ok: true, items: clone.items, idMap: clone.idMap, offset: landed.offset };
  }
  return refused(firstRefusal);
}

/** What Ctrl C holds: the pieces as they were, and the centre a paste lands them about. */
export interface PlannerClipboard {
  readonly items: readonly PlacedItem[];
  readonly centreX: number;
  readonly centreZ: number;
}

/** Ctrl C: the selection made whole, with the centre of its footprint. Null when nothing is selected. */
export function copyPieces(selectedIds: ReadonlySet<string>, placedItems: readonly PlacedItem[]): PlannerClipboard | null {
  const source = wholeSelection(selectedIds, placedItems);
  const bounds = footprintBounds(source);
  if (source.length === 0 || bounds === null) return null;
  return { items: source, centreX: (bounds.minX + bounds.maxX) / 2, centreZ: (bounds.minZ + bounds.maxZ) / 2 };
}

/** Ctrl V: the clipboard's pieces centred on the pointer's floor point (render-space). */
export function planPaste(
  clipboard: PlannerClipboard,
  at: { readonly x: number; readonly z: number },
  world: GhostWorld,
  options: EditOptions = {},
): EditPlan {
  const asked = { dx: at.x - clipboard.centreX, dz: at.z - clipboard.centreZ };
  const landed = landing(clipboard.items, asked, world);
  if (landed.offset === null) return refused(landed.obstacle);
  const clone = clonePieces(clipboard.items, landed.offset, world.placedItems, options);
  return { ok: true, items: clone.items, idMap: clone.idMap, offset: landed.offset };
}

/** Ctrl A: every piece in the room. */
export function allPieceIds(placedItems: readonly PlacedItem[]): readonly string[] {
  return pieces(placedItems).map((piece) => piece.id);
}

/** A piece's kind for Ctrl Shift A: the same model, whatever its cloth (a white and a black round are both rounds). */
function kindOf(piece: PlacedItem): string {
  const item = getCatalogueItem(piece.catalogueItemId);
  return item === undefined ? piece.catalogueItemId : seatBaseSlug(item.slug);
}

/** Ctrl Shift A: every piece of the selected pieces' kinds. */
export function piecesOfKindIds(placedItems: readonly PlacedItem[], selectedIds: ReadonlySet<string>): readonly string[] {
  const all = pieces(placedItems);
  const kinds = new Set(all.filter((piece) => selectedIds.has(piece.id)).map(kindOf));
  return all.filter((piece) => kinds.has(kindOf(piece))).map((piece) => piece.id);
}

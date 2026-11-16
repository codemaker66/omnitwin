import { atVerdict, createGhostWorld, judgeGhost, obstacleAt, refusalChip, type GhostObstacle, type GhostWorld } from "./ghost-truth.js";
import type { PlacedItem } from "./placement.js";
import { footprintBounds, isDiningTable, standing, wholeSelection } from "./placement-edit.js";

// ---------------------------------------------------------------------------
// Line up and Move (spec §18, Q-18; law 11, Q-47): the selection's pieces
// moved where asked, whole groups and sets together, judged like any ghost.
// Each returns the moved pieces (same ids) for one undo step, or a refusal
// with its reason.
//
// Apart from the editing basics (lib/placement-edit.ts), which today's
// planner's keys use, because only the new chrome's caption and Replace
// (lib/replace.ts) call these so far: they load with it (T-671).
// ---------------------------------------------------------------------------

/**
 * Pieces split into what moves and changes as one: pieces sharing a set or a
 * group, and every piece they share one with in turn, so a set's chairs stay
 * with it whichever of its ids they carry.
 */
export function selectionUnits(selection: readonly PlacedItem[]): readonly (readonly PlacedItem[])[] {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    for (let next = parent.get(root); next !== undefined && next !== root; next = parent.get(root)) root = next;
    return root;
  };
  const join = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  for (const piece of selection) {
    if (piece.setId !== undefined) join(`piece:${piece.id}`, `set:${piece.setId}`);
    if (piece.groupId !== null) join(`piece:${piece.id}`, `group:${piece.groupId}`);
  }
  const byRoot = new Map<string, PlacedItem[]>();
  for (const piece of selection) {
    const root = find(`piece:${piece.id}`);
    const unit = byRoot.get(root);
    if (unit === undefined) byRoot.set(root, [piece]);
    else unit.push(piece);
  }
  return [...byRoot.values()];
}

export type MovePlan =
  | { readonly ok: true; readonly items: readonly PlacedItem[] }
  | { readonly ok: false; readonly obstacle: GhostObstacle | null; readonly reason: string };

function moveRefused(obstacle: GhostObstacle | null): MovePlan {
  return { ok: false, obstacle, reason: refusalChip(obstacle) };
}

function shifted(items: readonly PlacedItem[], dx: number, dz: number): readonly PlacedItem[] {
  return items.map((piece) => ({ ...piece, x: piece.x + dx, z: piece.z + dz }));
}

/** The selection made whole, split into what moves as one: each set, each group, each lone piece. */
function units(selectedIds: ReadonlySet<string>, placedItems: readonly PlacedItem[]): readonly (readonly PlacedItem[])[] {
  return selectionUnits(wholeSelection(selectedIds, placedItems));
}

/** Line up's refusal when there is nothing to line up against. */
export const LINE_UP_NEEDS_TWO = "Line up needs two or more";

/** Where a unit stands: its dining table's centre when it has one, else the centre of its footprint. */
function anchorOf(unit: readonly PlacedItem[]): { readonly x: number; readonly z: number } | null {
  const tables = unit.filter(isDiningTable);
  if (tables.length > 0) {
    return { x: tables.reduce((sum, t) => sum + t.x, 0) / tables.length, z: tables.reduce((sum, t) => sum + t.z, 0) / tables.length };
  }
  const bounds = footprintBounds(unit);
  return bounds === null ? null : { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
}

/**
 * Line up: the selected tables' centres onto one line along the axis they
 * spread along most (the best-fit straight line: the mean of their other
 * coordinate). Refused, with the reason, when any would then overlap.
 * Needs two or more groups or pieces.
 */
export function planLineUp(selectedIds: ReadonlySet<string>, world: GhostWorld): MovePlan {
  const moving = units(selectedIds, world.placedItems);
  const anchors = moving.map(anchorOf);
  if (moving.length < 2) return { ok: false, obstacle: null, reason: LINE_UP_NEEDS_TWO };
  if (anchors.some((anchor) => anchor === null)) return moveRefused(null);
  const points = anchors.filter((anchor): anchor is { readonly x: number; readonly z: number } => anchor !== null);
  const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
  const alongX = spread(points.map((p) => p.x)) >= spread(points.map((p) => p.z));
  const line = alongX
    ? points.reduce((sum, p) => sum + p.z, 0) / points.length
    : points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const lined = moving.map((unit, i) => {
    const anchor = points[i] ?? { x: 0, z: 0 };
    return alongX ? shifted(unit, 0, line - anchor.z) : shifted(unit, line - anchor.x, 0);
  });
  // Every piece at the height it would stand at on the line.
  const stood = new Map(standing(lined.flat(), world).map((piece) => [piece.id, piece]));
  const moved = lined.map((unit) => unit.map((piece) => stood.get(piece.id) ?? piece));

  // Judged against everything else, the other moved pieces included.
  const movingIds = new Set(moving.flat().map((piece) => piece.id));
  const others = world.placedItems.filter((piece) => !movingIds.has(piece.id));
  const after = createGhostWorld([...others, ...moved.flat()], world.room);
  for (const unit of moved) {
    const own = new Set(unit.map((piece) => piece.id));
    if (judgeGhost(unit, after, { excludeIds: own }).state !== "fits") return moveRefused(obstacleAt(unit, after, own));
  }
  return { ok: true, items: moved.flat() };
}

/**
 * Move, then tap the destination (law 11): the selection, made whole, with
 * its footprint's centre on the floor point tapped. Pushed clear by up to
 * 0.15 m like any ghost, or refused with the reason.
 */
export function planMove(selectedIds: ReadonlySet<string>, to: { readonly x: number; readonly z: number }, world: GhostWorld): MovePlan {
  const source = wholeSelection(selectedIds, world.placedItems);
  const bounds = footprintBounds(source);
  if (source.length === 0 || bounds === null) return moveRefused(null);
  const moved = standing(shifted(source, to.x - (bounds.minX + bounds.maxX) / 2, to.z - (bounds.minZ + bounds.maxZ) / 2), world);
  const verdict = judgeGhost(moved, world, { excludeIds: new Set(source.map((piece) => piece.id)) });
  if (verdict.state === "refused") return moveRefused(verdict.obstacle);
  // The push can carry a piece onto or off a surface: settled again where it leaves them.
  return { ok: true, items: standing(atVerdict(moved, verdict), world) };
}

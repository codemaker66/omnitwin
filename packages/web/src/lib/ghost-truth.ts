import type { SpaceDimensions } from "@omnitwin/types";
import { toRealWorld, toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem, type CatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import {
  createPlacementOverlapIndex,
  placementBody,
  type PlacedItem,
  type PlacementBody,
  type PlacementOverlapIndex,
} from "./placement.js";
import { isSceneFurniturePlacement, isTableDressingApplicatorSlug } from "./table-dressing.js";

// ---------------------------------------------------------------------------
// The ghost tells the truth before the drop (card-dock spec §7.2–7.5, law 10)
//
// Whatever is about to land is judged body by body (the table, each chair,
// each panel) against what the room already holds, by the planner's one
// overlap rule (placementBodiesOverlap) and its room bounds. Three verdicts:
//
//   fits     nothing in the way;
//   pushed   only in the way by 0.15 m or less: moved clear along the
//            shortest escape, and set down there;
//   refused  physically impossible: the deepest obstacle is named, with how
//            far into it the set would go.
//
// Once refused, the set must clear by 0.02 m before it fits again, so a
// sweep along an edge does not flicker. The commit takes the verdict's pose
// and is judged again, so a fast click cannot sneak an overlap in.
// Positions are render-space; every figure a person reads is in metres.
// ---------------------------------------------------------------------------

/** The forgiving push: overlaps this shallow are pushed clear, not refused. */
export const GHOST_PUSH_LIMIT_M = 0.15;

/** How far a refused ghost must clear before it fits again. */
export const GHOST_HYSTERESIS_M = 0.02;

/** How long a refusal must last before its chip shows, so a sweep across a table does not flash it. */
export const REFUSAL_CHIP_DELAY_MS = 80;

/** Clearance added to every escape, so a pushed set does not land touching to within rounding. */
const ESCAPE_EPSILON = 1e-6;

/** What a gesture judges against: built once when it starts (createPlacementOverlapIndex is O(n)). */
export interface GhostWorld {
  readonly placedItems: readonly PlacedItem[];
  readonly byId: ReadonlyMap<string, PlacedItem>;
  readonly index: PlacementOverlapIndex;
  /** The room, render-space, centred on the origin. */
  readonly room: SpaceDimensions;
}

export function createGhostWorld(placedItems: readonly PlacedItem[], room: SpaceDimensions): GhostWorld {
  return {
    placedItems,
    byId: new Map(placedItems.map((placed) => [placed.id, placed])),
    index: createPlacementOverlapIndex(placedItems),
    room,
  };
}

export type GhostState = "fits" | "pushed" | "refused";

export type GhostObstacleKind = "overlap" | "outside_room";

export interface GhostObstacle {
  readonly kind: GhostObstacleKind;
  /** The placed piece in the way; null for a wall. */
  readonly obstacleId: string | null;
  /** How the piece is named in copy: "Table 2's chairs", "the round", "the dance floor", "the wall". */
  readonly obstacleLabel: string;
  /** How far into it the set would go, in metres. */
  readonly depthM: number;
  /** A low piece the set would stand on rather than through (a dance floor, a stage). */
  readonly sitsOn: boolean;
}

export interface GhostVerdict {
  readonly state: GhostState;
  /** The push applied, render-space; zero unless pushed. */
  readonly dx: number;
  readonly dz: number;
  /** How far the set was pushed, in metres. */
  readonly pushedM: number;
  /** The deepest obstacle; set only when refused. */
  readonly obstacle: GhostObstacle | null;
  /** Every placed piece in the way, for its brick outline; set only when refused. */
  readonly blockingIds: readonly string[];
}

export interface GhostJudgeOptions {
  /** Placed pieces that are the ones moving (a lifted set), never in their own way. */
  readonly excludeIds?: ReadonlySet<string>;
  /** Last frame's verdict: refused asks for the hysteresis margin. */
  readonly previous?: GhostState;
}

interface GhostBody {
  readonly body: PlacementBody;
}

/** One way out of one violation: shift the whole set along an axis by a signed amount (render-space). */
interface Escape {
  readonly axis: "x" | "z";
  readonly amount: number;
}

interface Violation {
  readonly kind: GhostObstacleKind;
  readonly obstacleId: string | null;
  /** The shortest single escape, render-space. */
  readonly depth: number;
  /** The alternatives; a body wider than the room has none on that axis. */
  readonly escapes: readonly Escape[];
}

const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

function inflate(body: PlacementBody, margin: number): PlacementBody {
  return margin === 0 ? body : { ...body, halfW: body.halfW + margin, halfD: body.halfD + margin };
}

function shifted(body: PlacementBody, dx: number, dz: number): PlacementBody {
  return dx === 0 && dz === 0 ? body : { ...body, x: body.x + dx, z: body.z + dz };
}

/** The bodies of the pieces a ghost would set down; dressing rows and unknown pieces have none. */
function ghostBodies(stamp: readonly PlacedItem[], margin: number): readonly GhostBody[] {
  const bodies: GhostBody[] = [];
  for (const piece of stamp) {
    if (!isSceneFurniturePlacement(piece)) continue;
    const item = getCatalogueItem(piece.catalogueItemId);
    if (item === undefined || isTableDressingApplicatorSlug(item.slug)) continue;
    bodies.push({ body: inflate(placementBody(piece.x, piece.z, item, piece.rotationY, piece.y, piece.scale), margin) });
  }
  return bodies;
}

function signOf(delta: number): 1 | -1 {
  return delta < 0 ? -1 : 1;
}

/** How a body crosses the room's walls, axis by axis. */
function wallViolations(body: PlacementBody, room: SpaceDimensions, out: Violation[]): void {
  const axes: readonly { readonly axis: "x" | "z"; readonly centre: number; readonly half: number; readonly roomHalf: number }[] = [
    { axis: "x", centre: body.x, half: body.halfW, roomHalf: room.width / 2 },
    { axis: "z", centre: body.z, half: body.halfD, roomHalf: room.length / 2 },
  ];
  for (const { axis, centre, half, roomHalf } of axes) {
    const low = -roomHalf - (centre - half);
    const high = centre + half - roomHalf;
    if (low <= 0 && high <= 0) continue;
    const escapes: Escape[] = low > 0 && high > 0 ? [] : [{ axis, amount: low > 0 ? low : -high }];
    out.push({ kind: "outside_room", obstacleId: null, depth: Math.max(low, high), escapes });
  }
}

/** Every violation of every body, the set shifted by (dx, dz). */
function violationsAt(bodies: readonly GhostBody[], world: GhostWorld, excludeIds: ReadonlySet<string>, dx: number, dz: number): readonly Violation[] {
  const found: Violation[] = [];
  for (const { body: unshifted } of bodies) {
    const body = shifted(unshifted, dx, dz);
    wallViolations(body, world.room, found);
    for (const hit of world.index.overlapping(body, excludeIds)) {
      const other = hit.body;
      const padding = body.stage && other.stage ? -0.05 : 0;
      const gapX = body.x - other.x;
      const gapZ = body.z - other.z;
      const intoX = body.halfW + other.halfW + padding - Math.abs(gapX);
      const intoZ = body.halfD + other.halfD + padding - Math.abs(gapZ);
      found.push({
        kind: "overlap",
        obstacleId: hit.id,
        depth: Math.min(intoX, intoZ),
        escapes: [{ axis: "x", amount: signOf(gapX) * intoX }, { axis: "z", amount: signOf(gapZ) * intoZ }],
      });
    }
  }
  return found;
}

function isClear(bodies: readonly GhostBody[], world: GhostWorld, excludeIds: ReadonlySet<string>, dx: number, dz: number): boolean {
  for (const { body: unshifted } of bodies) {
    const body = shifted(unshifted, dx, dz);
    const halfW = world.room.width / 2;
    const halfL = world.room.length / 2;
    if (body.x - body.halfW < -halfW || body.x + body.halfW > halfW || body.z - body.halfD < -halfL || body.z + body.halfD > halfL) return false;
    if (world.index.overlapsAny(body, excludeIds)) return false;
  }
  return true;
}

function withEpsilon(amount: number): number {
  return amount === 0 ? 0 : amount + signOf(amount) * ESCAPE_EPSILON;
}

/** The shortest whole-set shifts that might clear every violation: each escape alone, and each x with each z. */
function escapeCandidates(violations: readonly Violation[], limit: number): readonly { readonly dx: number; readonly dz: number; readonly length: number }[] {
  const xs = new Set<number>();
  const zs = new Set<number>();
  for (const violation of violations) {
    for (const escape of violation.escapes) (escape.axis === "x" ? xs : zs).add(withEpsilon(escape.amount));
  }
  const candidates: { dx: number; dz: number; length: number }[] = [];
  const consider = (dx: number, dz: number): void => {
    const length = Math.hypot(dx, dz);
    if (length <= limit) candidates.push({ dx, dz, length });
  };
  for (const dx of xs) consider(dx, 0);
  for (const dz of zs) consider(0, dz);
  for (const dx of xs) for (const dz of zs) consider(dx, dz);
  return candidates.sort((a, b) => a.length - b.length);
}

// ---------------------------------------------------------------------------
// Naming what is in the way
// ---------------------------------------------------------------------------

/** What a piece is called when it has no label: "round", "trestle", "bar counter". */
function kindNoun(item: CatalogueItem): string {
  if (isDiningTableItem(item)) {
    if (item.slug.startsWith("round-table")) return "round";
    if (item.slug.startsWith("trestle")) return "trestle";
  }
  return item.name.toLowerCase();
}

function labelled(placed: PlacedItem): string | null {
  const label = placed.label?.trim() ?? "";
  return label === "" ? null : label;
}

/** The dining table a chair's group is set at, if it has one. */
function groupTable(placed: PlacedItem, world: GhostWorld): { readonly piece: PlacedItem; readonly item: CatalogueItem } | null {
  if (placed.groupId === null) return null;
  for (const other of world.placedItems) {
    if (other.groupId !== placed.groupId || other.id === placed.id) continue;
    const item = getCatalogueItem(other.catalogueItemId);
    if (item !== undefined && isDiningTableItem(item)) return { piece: other, item };
  }
  return null;
}

/** How copy names a placed piece in the way (spec §6: by its table number, else by its kind). */
export function obstacleName(placedId: string, world: GhostWorld): { readonly label: string; readonly sitsOn: boolean } {
  const placed = world.byId.get(placedId);
  const item = placed === undefined ? undefined : getCatalogueItem(placed.catalogueItemId);
  if (placed === undefined || item === undefined) return { label: "a piece", sitsOn: false };
  if (item.slug === "dancefloor-panel") return { label: "the dance floor", sitsOn: true };
  if (item.category === "stage") return { label: "the stage", sitsOn: true };
  if (item.category === "chair") {
    const table = groupTable(placed, world);
    if (table === null) return { label: "a chair", sitsOn: false };
    const tableName = labelled(table.piece);
    return { label: tableName === null ? `the ${kindNoun(table.item)}'s chairs` : `${tableName}'s chairs`, sitsOn: false };
  }
  return { label: labelled(placed) ?? `the ${kindNoun(item)}`, sitsOn: false };
}

function describeObstacle(violation: Violation, world: GhostWorld): GhostObstacle {
  const depthM = Math.max(0, toRealWorld(violation.depth));
  if (violation.kind === "outside_room" || violation.obstacleId === null) {
    return { kind: "outside_room", obstacleId: null, obstacleLabel: "the wall", depthM, sitsOn: false };
  }
  const name = obstacleName(violation.obstacleId, world);
  return { kind: "overlap", obstacleId: violation.obstacleId, obstacleLabel: name.label, depthM, sitsOn: name.sitsOn };
}

function deepest(violations: readonly Violation[]): Violation | undefined {
  let worst: Violation | undefined;
  for (const violation of violations) {
    if (worst === undefined || violation.depth > worst.depth) worst = violation;
  }
  return worst;
}

const FITS: GhostVerdict = { state: "fits", dx: 0, dz: 0, pushedM: 0, obstacle: null, blockingIds: [] };

/** How many of the shortest failed shifts the second round starts from. */
const SECOND_ROUND_SEEDS = 8;

function shiftKey(dx: number, dz: number): string {
  return `${dx.toFixed(9)},${dz.toFixed(9)}`;
}

/**
 * The shortest push of 0.15 m or less that clears the set, or null. A shift
 * can run into something the set did not touch where it stood (a diagonal
 * neighbour), so the shortest failed shifts are tried again with that new
 * obstacle's own escapes added: one bounded second round.
 */
function shortestPush(bodies: readonly GhostBody[], world: GhostWorld, excludeIds: ReadonlySet<string>, violations: readonly Violation[]): { readonly dx: number; readonly dz: number; readonly length: number } | null {
  const limit = toRenderSpace(GHOST_PUSH_LIMIT_M);
  const first = escapeCandidates(violations, limit);
  for (const candidate of first) {
    if (isClear(bodies, world, excludeIds, candidate.dx, candidate.dz)) return candidate;
  }
  const seen = new Set(first.map((candidate) => shiftKey(candidate.dx, candidate.dz)));
  const second: { dx: number; dz: number; length: number }[] = [];
  for (const seed of first.slice(0, SECOND_ROUND_SEEDS)) {
    for (const more of escapeCandidates(violationsAt(bodies, world, excludeIds, seed.dx, seed.dz), limit)) {
      const dx = seed.dx + more.dx;
      const dz = seed.dz + more.dz;
      const length = Math.hypot(dx, dz);
      const key = shiftKey(dx, dz);
      if (length > limit || seen.has(key)) continue;
      seen.add(key);
      second.push({ dx, dz, length });
    }
  }
  second.sort((a, b) => a.length - b.length);
  for (const candidate of second) {
    if (isClear(bodies, world, excludeIds, candidate.dx, candidate.dz)) return candidate;
  }
  return null;
}

/** A refusal naming the deepest of these violations, and every placed piece among them. */
function refusal(violations: readonly Violation[], world: GhostWorld, depthAllowance = 0): GhostVerdict {
  const worst = deepest(violations);
  const blockingIds = [...new Set(violations.flatMap((violation) => (violation.obstacleId === null ? [] : [violation.obstacleId])))];
  const named = worst === undefined ? undefined : { ...worst, depth: Math.max(0, worst.depth - depthAllowance) };
  return {
    state: "refused",
    dx: 0,
    dz: 0,
    pushedM: 0,
    obstacle: named === undefined ? null : describeObstacle(named, world),
    blockingIds,
  };
}

/** The verdict where the set stands, by its real bodies. */
function judgeAt(bodies: readonly GhostBody[], world: GhostWorld, excludeIds: ReadonlySet<string>): GhostVerdict {
  if (isClear(bodies, world, excludeIds, 0, 0)) return FITS;
  const violations = violationsAt(bodies, world, excludeIds, 0, 0);
  const push = shortestPush(bodies, world, excludeIds, violations);
  if (push !== null) return { state: "pushed", dx: push.dx, dz: push.dz, pushedM: toRealWorld(push.length), obstacle: null, blockingIds: [] };
  return refusal(violations, world);
}

/**
 * The verdict on setting `stamp` down where it stands. Each frame passes
 * last frame's state: once refused, a set comes back only when it clears
 * by 0.02 m, or when its push is 0.02 m inside the 0.15 m limit, so an edge
 * swept along does not flicker. The push itself is always the real one.
 */
export function judgeGhost(stamp: readonly PlacedItem[], world: GhostWorld, options: GhostJudgeOptions = {}): GhostVerdict {
  const excludeIds = options.excludeIds ?? NO_EXCLUSIONS;
  const bodies = ghostBodies(stamp, 0);
  if (bodies.length === 0) return FITS;
  const verdict = judgeAt(bodies, world, excludeIds);
  if (options.previous !== "refused" || verdict.state === "refused") return verdict;

  const margin = toRenderSpace(GHOST_HYSTERESIS_M);
  if (verdict.state === "pushed") {
    if (verdict.pushedM <= GHOST_PUSH_LIMIT_M - GHOST_HYSTERESIS_M) return verdict;
    return refusal(violationsAt(bodies, world, excludeIds, 0, 0), world);
  }
  const widened = ghostBodies(stamp, margin);
  if (isClear(widened, world, excludeIds, 0, 0)) return verdict;
  // Clear, but not yet by the margin: still refused, naming what it is beside.
  return refusal(violationsAt(widened, world, excludeIds, 0, 0), world, margin);
}

/** The pieces where the verdict sets them down: pushed clear, or where they stand. */
export function atVerdict(stamp: readonly PlacedItem[], verdict: GhostVerdict): readonly PlacedItem[] {
  if (verdict.dx === 0 && verdict.dz === 0) return stamp;
  return stamp.map((piece) => ({ ...piece, x: piece.x + verdict.dx, z: piece.z + verdict.dz }));
}

// ---------------------------------------------------------------------------
// The words (spec §16)
// ---------------------------------------------------------------------------

/** Metres to 0.1 m for a refusal, never "0.0 m". */
function refusalMetres(depthM: number): string {
  return `${Math.max(0.1, Math.round(depthM * 10) / 10).toFixed(1)} m`;
}

/** The tag's state word: "fits", "fits · moved 0.12 m" or "won't fit". */
export function ghostTagWords(verdict: GhostVerdict): string {
  if (verdict.state === "refused") return "won't fit";
  const moved = Math.round(verdict.pushedM * 100) / 100;
  return verdict.state === "pushed" && moved > 0 ? `fits · moved ${moved.toFixed(2)} m` : "fits";
}

/** The refusal chip: "Won't fit · would overlap Table 2's chairs by 0.5 m". */
export function refusalChip(obstacle: GhostObstacle | null): string {
  if (obstacle === null) return "Won't fit";
  if (obstacle.kind === "outside_room") return `Won't fit · ${refusalMetres(obstacle.depthM)} through the wall`;
  if (obstacle.sitsOn) return `Won't fit · would sit on ${obstacle.obstacleLabel}`;
  return `Won't fit · would overlap ${obstacle.obstacleLabel} by ${refusalMetres(obstacle.depthM)}`;
}

/** The chip's second line: what letting go does. */
export function refusalSubLine(fromCardDrag: boolean): string {
  return fromCardDrag ? "Let go and it goes back to the card" : "Move it clear to set it down";
}

/** Whether the refusal chip shows yet: only after REFUSAL_CHIP_DELAY_MS of continuous refusal. */
export function refusalChipVisible(refusedSinceMs: number | null, nowMs: number): boolean {
  return refusedSinceMs !== null && nowMs - refusedSinceMs >= REFUSAL_CHIP_DELAY_MS;
}

import {
  ChangeoverSchema,
  SETUP_PHASES,
  WITH_CHAIRS,
  ZONES,
  defaultPhaseForCategory,
  type Changeover,
  type ChangeoverFootprint,
  type ChangeoverItem,
  type ChangeoverPlan,
  type ChangeoverPlanGroup,
  type ChangeoverZoneCount,
  type HallkeeperFloorPlan,
  type HallkeeperSheetV2,
  type SetupPhase,
  type Zone,
} from "@omnitwin/types";
import { classifyZoneV2, type RoomDimensions } from "../services/spatial-classifier-v2.js";

// ---------------------------------------------------------------------------
// What moves at a changeover (pure): from the layout one booking leaves in a
// room to the layout the next booking needs there.
//
// Items are counted as the sheet's own store list counts them (sheetStoreList):
// every piece on the plan, the chairs set at tables included, by name and
// category, plus the dressing the manifest implies. The manifest alone would
// not do: it folds a table's chairs into the table's row ("6ft Round Table
// with 10 chairs"), so a dinner of 10-tops and one of 8-tops would share no
// item at all. A sheet frozen without a plan is counted from its rows, each
// table's chairs split back out; those chairs have no name of their own, so
// then the chairs on both sides are compared as chairs. With both plans, a
// piece is known by its catalogue entry and named as the next layout names
// it, so an entry renamed between the two is one item, not a strike and a
// re-set.
//
// Which parts of the room change is said only when both sides were placed
// the same way: with both plans, each piece where it stands, in one room
// size (the next layout's, which its own sheet's parts are named by). An
// approved sheet keeps the room's size as it was measured then, and a sheet
// frozen without a plan lists a table's chairs at the table and a laid floor
// at its middle, so a planless side's parts are not compared at all.
//
// Pieces on the two plans are paired by where they stand, never by id or
// table name: the two layouts belong to different events, and "Table 1" at
// the wedding is not "Table 1" at the dinner. A piece that already stands
// where the next layout needs one of its kind stays put; the rest of a kind
// pair nearest first, as moves; only a change in how many of a kind the room
// holds goes to or comes from store. The work one read does is bounded: past
// MAX_PAIRED_PIECES a side, or CARRY_CANDIDATES pairs weighed across the
// room, the plan is not paired at all and the counts stand alone.
// ---------------------------------------------------------------------------

/** A piece that moves less than this, and turns less than MOVE_TURN_RAD,
 *  is where the crew would put it anyway. */
export const MOVE_DISTANCE_M = 0.3;
const MOVE_TURN_RAD = (10 * Math.PI) / 180;
/** Kinds with no front: a trestle or a stage deck turned half round stands
 *  as it did, and a square one turned a quarter too. A chair, a lectern, a
 *  screen or a bar faces a way, so any turn of it is a move. */
const NO_FRONT = new Set(["table", "stage", "barrier"]);
const SQUARE_WITHIN_M = 0.01;
/** Above this many pieces on either plan, none are paired; the counts still
 *  stand. Twice what one planner save holds (500), so it bounds a read
 *  without touching any layout the planner saves: at the limit, the nearest
 *  search's worst case (every piece in one grid cell) is about 0.15 s. */
export const MAX_PAIRED_PIECES = 1_000;
/** The grid the nearest pieces are searched through. Pieces further apart
 *  still pair, last, as a carry across the room. */
const SEARCH_CELL_M = 8;
const NEAREST_FIRST = 8;
/** The most pairs weighed for carries across the room: every piece of a
 *  500-piece layout carried end to end (measured at about 0.2 s and 35 MB).
 *  Past it the plan is not paired. */
export const CARRY_CANDIDATES = 250_000;

const PHASE_ORDER = new Map<SetupPhase, number>(SETUP_PHASES.map((phase, index) => [phase, index]));
const ZONE_ORDER = new Map<Zone, number>(ZONES.map((zone, index) => [zone, index]));
const naturally = (a: string, b: string): number => a.localeCompare(b, "en-GB", { numeric: true, sensitivity: "base" });

type PlanObject = HallkeeperFloorPlan["objects"][number];

/** What a piece is called and filed under. */
interface Kind {
  readonly name: string;
  readonly category: string;
}

interface ItemTally extends Kind {
  phase: SetupPhase;
  isAccessory: boolean;
  total: number;
  readonly zones: Map<Zone, number>;
}

function itemKey(name: string, category: string): string {
  return `${category.trim().toLowerCase()}\u0000${name.trim().toLowerCase()}`;
}

/** Chairs compared as chairs, when a sheet without a plan cannot name them. */
const CHAIRS = "Chairs";
const CHAIR_CATEGORY = "chair";

/** A sheet frozen without a plan, whose tables carry their chairs unnamed. */
function hidesChairNames(sheet: HallkeeperSheetV2): boolean {
  if ((sheet.floorPlan ?? null) !== null) return false;
  return sheet.phases.some((phase) => phase.zones.some((zone) =>
    zone.rows.some((row) => !row.isAccessory && WITH_CHAIRS.test(row.name))));
}

/** How both layouts are read: the same way on both sides, or not compared. */
interface Reading {
  /** Chairs by their catalogue name; false when a sheet frozen without a
   *  plan hides them in its tables' rows, and every chair is then a chair. */
  readonly chairsByName: boolean;
  /** With both plans: each catalogue entry's name and category, as the next
   *  layout has it where both do. Null when either side has no plan. */
  readonly kinds: ReadonlyMap<string, Kind> | null;
  /** The one room size both sides' pieces are placed in parts of the room
   *  by. Null when their parts are not compared. */
  readonly frame: RoomDimensions | null;
}

function readingOf(before: HallkeeperSheetV2, after: HallkeeperSheetV2): Reading {
  const was = before.floorPlan ?? null;
  const now = after.floorPlan ?? null;
  if (was === null || now === null) {
    return { chairsByName: !hidesChairNames(before) && !hidesChairNames(after), kinds: null, frame: null };
  }
  const kinds = new Map<string, Kind>();
  for (const piece of [...was.objects, ...now.objects]) {
    kinds.set(piece.assetDefinitionId, { name: piece.name, category: piece.category });
  }
  const { widthM, lengthM } = after.space;
  const frame = widthM > 0 && lengthM > 0 ? { widthM, lengthM } : null;
  return { chairsByName: true, kinds, frame };
}

function kindOf(reading: Reading, piece: PlanObject): Kind {
  return reading.kinds?.get(piece.assetDefinitionId) ?? piece;
}

function tallyItems(sheet: HallkeeperSheetV2, reading: Reading): Map<string, ItemTally> {
  const items = new Map<string, ItemTally>();
  const add = (kind: Kind, phase: SetupPhase, zone: Zone | null, qty: number, isAccessory: boolean): void => {
    const name = !reading.chairsByName && !isAccessory && kind.category === CHAIR_CATEGORY ? CHAIRS : kind.name;
    const key = itemKey(name, kind.category);
    let tally = items.get(key);
    if (tally === undefined) {
      tally = { name, category: kind.category, phase, isAccessory, total: 0, zones: new Map() };
      items.set(key, tally);
    }
    if ((PHASE_ORDER.get(phase) ?? 0) < (PHASE_ORDER.get(tally.phase) ?? 0)) tally.phase = phase;
    if (!isAccessory) tally.isAccessory = false;
    tally.total += qty;
    if (zone !== null) tally.zones.set(zone, (tally.zones.get(zone) ?? 0) + qty);
  };

  const plan = sheet.floorPlan ?? null;
  // The phase each placed piece is set in, from the row that places it. A
  // chair folded into its table's row is set with the furniture.
  const phaseOf = new Map<string, SetupPhase>();
  for (const phase of sheet.phases) {
    for (const zone of phase.zones) {
      for (const row of zone.rows) {
        // Dressing is cleared and laid by each booking wherever its tables
        // stand, so it is placed in no part of the room.
        if (row.isAccessory) {
          add(row, phase.phase, null, row.qty, true);
          continue;
        }
        if (plan !== null) {
          for (const position of row.positions) phaseOf.set(position.objectId, phase.phase);
          continue;
        }
        const seated = WITH_CHAIRS.exec(row.name);
        const table = seated?.[1];
        const each = seated?.[2];
        if (table === undefined || each === undefined) {
          add(row, phase.phase, null, row.qty, false);
          continue;
        }
        add({ name: table, category: row.category }, phase.phase, null, row.qty, false);
        add({ name: CHAIRS, category: CHAIR_CATEGORY }, defaultPhaseForCategory(CHAIR_CATEGORY), null, row.qty * Number(each), false);
      }
    }
  }
  const frame = reading.frame;
  for (const piece of plan?.objects ?? []) {
    const kind = kindOf(reading, piece);
    add(kind, phaseOf.get(piece.objectId) ?? defaultPhaseForCategory(kind.category),
      frame === null ? null : classifyZoneV2(piece.x, piece.z, frame), 1, false);
  }
  return items;
}

function changeoverItems(before: HallkeeperSheetV2, after: HallkeeperSheetV2, reading: Reading): ChangeoverItem[] {
  const was = tallyItems(before, reading);
  const now = tallyItems(after, reading);
  const items: ChangeoverItem[] = [];
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const prior = was.get(key);
    const next = now.get(key);
    const shape = next ?? prior;
    if (shape === undefined) continue;
    const zones: ChangeoverZoneCount[] = [];
    for (const zone of new Set([...(prior?.zones.keys() ?? []), ...(next?.zones.keys() ?? [])])) {
      const zoneBefore = prior?.zones.get(zone) ?? 0;
      const zoneAfter = next?.zones.get(zone) ?? 0;
      if (zoneBefore !== zoneAfter) zones.push({ zone, before: zoneBefore, after: zoneAfter });
    }
    zones.sort((a, b) => (ZONE_ORDER.get(a.zone) ?? 0) - (ZONE_ORDER.get(b.zone) ?? 0));
    items.push({
      name: shape.name,
      category: shape.category,
      phase: next?.phase ?? shape.phase,
      isAccessory: shape.isAccessory,
      before: prior?.total ?? 0,
      after: next?.total ?? 0,
      zones,
    });
  }
  return items.sort((a, b) =>
    (PHASE_ORDER.get(a.phase) ?? 0) - (PHASE_ORDER.get(b.phase) ?? 0)
    || Number(a.isAccessory) - Number(b.isAccessory)
    || naturally(a.name, b.name));
}

/** How far a piece of this kind turns before it stands as it did. */
function turnPeriod(piece: PlanObject, kind: Kind): number {
  if (!NO_FRONT.has(kind.category)) return 2 * Math.PI;
  return Math.abs(piece.widthM - piece.depthM) < SQUARE_WITHIN_M ? Math.PI / 2 : Math.PI;
}

function turned(a: PlanObject, b: PlanObject, period: number): boolean {
  if (a.collisionType === "cylinder" && b.collisionType === "cylinder") return false;
  const delta = (((b.rotationY - a.rotationY) % period) + period) % period;
  return Math.min(delta, period - delta) > MOVE_TURN_RAD;
}

function distance(a: PlanObject, b: PlanObject): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

interface Candidate { readonly from: number; readonly to: number; readonly metres: number }

function takeClosest(candidates: Candidate[], pairs: Map<number, number>, taken: Set<number>): void {
  candidates.sort((a, b) => a.metres - b.metres || a.from - b.from || a.to - b.to);
  for (const candidate of candidates) {
    if (pairs.has(candidate.from) || taken.has(candidate.to)) continue;
    pairs.set(candidate.from, candidate.to);
    taken.add(candidate.to);
  }
}

/** Keeps the `limit` closest candidates seen so far, closest first (ties to the lower index). */
function keepNearest(near: Candidate[], candidate: Candidate, limit: number): void {
  const closer = (a: Candidate, b: Candidate): boolean => a.metres < b.metres || (a.metres === b.metres && a.to < b.to);
  const last = near[near.length - 1];
  if (near.length === limit && last !== undefined && !closer(candidate, last)) return;
  if (near.length === limit) near.pop();
  let at = near.length;
  for (let previous = near[at - 1]; previous !== undefined && closer(candidate, previous); previous = near[at - 1]) at -= 1;
  near.splice(at, 0, candidate);
}

/** Piece indices under each key, in order; a null key leaves a piece out. */
function indicesBy(pieces: readonly PlanObject[], keyOf: (piece: PlanObject, index: number) => string | null): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  pieces.forEach((piece, index) => {
    const key = keyOf(piece, index);
    if (key === null) return;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [index]);
    else list.push(index);
  });
  return groups;
}

/**
 * Pairs each piece the room holds with a piece the next layout needs, of the
 * same kind: first where one already stands (to the centimetre), then the
 * nearest few through a grid, then every piece of the kind still unpaired,
 * nearest first, as a carry across the room. Null when the carries would
 * weigh more than CARRY_CANDIDATES pairs.
 */
function pairPieces(before: readonly PlanObject[], after: readonly PlanObject[]): Map<number, number> | null {
  const pairs = new Map<number, number>();
  const taken = new Set<number>();

  const spot = (piece: PlanObject): string =>
    `${piece.assetDefinitionId}\u0000${String(Math.round(piece.x * 100))}\u0000${String(Math.round(piece.z * 100))}`;
  const afterBySpot = indicesBy(after, spot);
  const usedAtSpot = new Map<string, number>();
  before.forEach((piece, index) => {
    const key = spot(piece);
    const used = usedAtSpot.get(key) ?? 0;
    const free = afterBySpot.get(key)?.[used];
    if (free === undefined) return;
    usedAtSpot.set(key, used + 1);
    pairs.set(index, free);
    taken.add(free);
  });

  const cell = (value: number): number => Math.floor(value / SEARCH_CELL_M);
  const cellKey = (asset: string, x: number, z: number): string => `${asset}\u0000${String(x)}\u0000${String(z)}`;
  const grid = indicesBy(after, (piece, index) =>
    (taken.has(index) ? null : cellKey(piece.assetDefinitionId, cell(piece.x), cell(piece.z))));
  const nearest: Candidate[] = [];
  before.forEach((piece, index) => {
    if (pairs.has(index)) return;
    const near: Candidate[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const to of grid.get(cellKey(piece.assetDefinitionId, cell(piece.x) + dx, cell(piece.z) + dz)) ?? []) {
          const target = after[to];
          if (target !== undefined) keepNearest(near, { from: index, to, metres: distance(piece, target) }, NEAREST_FIRST);
        }
      }
    }
    nearest.push(...near);
  });
  takeClosest(nearest, pairs, taken);

  const freeBefore = indicesBy(before, (piece, index) => (pairs.has(index) ? null : piece.assetDefinitionId));
  const freeAfter = indicesBy(after, (piece, index) => (taken.has(index) ? null : piece.assetDefinitionId));
  let weighed = 0;
  for (const [asset, froms] of freeBefore) weighed += froms.length * (freeAfter.get(asset)?.length ?? 0);
  if (weighed > CARRY_CANDIDATES) return null;
  const carries: Candidate[] = [];
  for (const [asset, froms] of freeBefore) {
    for (const to of freeAfter.get(asset) ?? []) {
      const target = after[to];
      if (target === undefined) continue;
      for (const from of froms) {
        const piece = before[from];
        if (piece !== undefined) carries.push({ from, to, metres: distance(piece, target) });
      }
    }
  }
  takeClosest(carries, pairs, taken);
  return pairs;
}

function groupPieces(pieces: readonly PlanObject[], reading: Reading): ChangeoverPlanGroup[] {
  const groups = new Map<string, { name: string; category: string; count: number }>();
  for (const piece of pieces) {
    const kind = kindOf(reading, piece);
    const key = itemKey(kind.name, kind.category);
    const group = groups.get(key) ?? { name: kind.name, category: kind.category, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || naturally(a.name, b.name));
}

function changeoverPlan(
  before: HallkeeperSheetV2,
  after: HallkeeperSheetV2,
  reading: Reading,
): { readonly plan: ChangeoverPlan | null; readonly tooManyPieces: boolean } {
  const was = before.floorPlan ?? null;
  const now = after.floorPlan ?? null;
  if (was === null || now === null) return { plan: null, tooManyPieces: false };
  if (was.objects.length > MAX_PAIRED_PIECES || now.objects.length > MAX_PAIRED_PIECES) return { plan: null, tooManyPieces: true };
  const pairs = pairPieces(was.objects, now.objects);
  if (pairs === null) return { plan: null, tooManyPieces: true };
  const pairedAfter = new Set(pairs.values());
  const toStore = was.objects.filter((_, index) => !pairs.has(index));
  const fromStore = now.objects.filter((_, index) => !pairedAfter.has(index));
  const moved: PlanObject[] = [];
  let staysPut = 0;
  for (const [from, to] of pairs) {
    const prior = was.objects[from];
    const next = now.objects[to];
    if (prior === undefined || next === undefined) continue;
    if (distance(prior, next) > MOVE_DISTANCE_M || turned(prior, next, turnPeriod(next, kindOf(reading, next)))) moved.push(next);
    else staysPut += 1;
  }
  const footprint = (piece: PlanObject): ChangeoverFootprint => ({
    x: piece.x, z: piece.z, rotationY: piece.rotationY, scale: piece.scale,
    widthM: piece.widthM, depthM: piece.depthM, collisionType: piece.collisionType,
  });
  return {
    plan: {
      staysPut,
      moved: groupPieces(moved, reading),
      fromStore: groupPieces(fromStore, reading),
      toStore: groupPieces(toStore, reading),
      movedIds: moved.map((piece) => piece.objectId),
      fromStoreIds: fromStore.map((piece) => piece.objectId),
      toStoreFootprints: toStore.map(footprint),
    },
    tooManyPieces: false,
  };
}

export interface LayoutRef {
  readonly configId: string;
}

/** What moves when the room goes from the earlier booking's layout to the next one's. */
export function changeoverBetween(
  from: LayoutRef,
  to: LayoutRef,
  before: HallkeeperSheetV2,
  after: HallkeeperSheetV2,
): Changeover {
  const reading = readingOf(before, after);
  const { plan, tooManyPieces } = changeoverPlan(before, after, reading);
  return ChangeoverSchema.parse({
    from: { configId: from.configId, name: before.config.name.slice(0, 200), guests: before.config.guestCount, hasPlan: (before.floorPlan ?? null) !== null },
    to: { configId: to.configId, name: after.config.name.slice(0, 200), guests: after.config.guestCount, hasPlan: (after.floorPlan ?? null) !== null },
    items: changeoverItems(before, after, reading),
    zonesCompared: reading.frame !== null,
    plan,
    tooManyPieces,
  });
}

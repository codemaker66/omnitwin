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
import { classifyZoneV2 } from "../services/spatial-classifier-v2.js";

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
// then the chairs on both sides are compared as chairs.
//
// Pieces on the two plans are paired by where they stand, never by id or
// table name: the two layouts belong to different events, and "Table 1" at
// the wedding is not "Table 1" at the dinner. A piece that already stands
// where the next layout needs one of its kind stays put; the rest of a kind
// pair nearest first, as moves; only a change in how many of a kind the room
// holds goes to or comes from store.
// ---------------------------------------------------------------------------

/** A piece that moves less than this, and turns less than MOVE_TURN_RAD,
 *  is where the crew would put it anyway. */
export const MOVE_DISTANCE_M = 0.3;
const MOVE_TURN_RAD = (10 * Math.PI) / 180;
/** The grid the nearest pieces are searched through. Pieces further apart
 *  still pair, last, as a carry across the room. */
const SEARCH_CELL_M = 8;
const NEAREST_FIRST = 8;

const PHASE_ORDER = new Map<SetupPhase, number>(SETUP_PHASES.map((phase, index) => [phase, index]));
const ZONE_ORDER = new Map<Zone, number>(ZONES.map((zone, index) => [zone, index]));
const naturally = (a: string, b: string): number => a.localeCompare(b, "en-GB", { numeric: true, sensitivity: "base" });

interface ItemTally {
  readonly name: string;
  readonly category: string;
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

function tallyItems(sheet: HallkeeperSheetV2, chairsByName: boolean): Map<string, ItemTally> {
  const items = new Map<string, ItemTally>();
  const add = (rawName: string, category: string, phase: SetupPhase, zone: Zone, qty: number, isAccessory: boolean): void => {
    const name = !chairsByName && !isAccessory && category === CHAIR_CATEGORY ? CHAIRS : rawName;
    const key = itemKey(name, category);
    let tally = items.get(key);
    if (tally === undefined) {
      tally = { name, category, phase, isAccessory, total: 0, zones: new Map() };
      items.set(key, tally);
    }
    if ((PHASE_ORDER.get(phase) ?? 0) < (PHASE_ORDER.get(tally.phase) ?? 0)) tally.phase = phase;
    if (!isAccessory) tally.isAccessory = false;
    tally.total += qty;
    tally.zones.set(zone, (tally.zones.get(zone) ?? 0) + qty);
  };

  const plan = sheet.floorPlan ?? null;
  // The phase each placed piece is set in, from the row that places it. A
  // chair folded into its table's row is set with the furniture.
  const phaseOf = new Map<string, SetupPhase>();
  for (const phase of sheet.phases) {
    for (const zone of phase.zones) {
      for (const row of zone.rows) {
        if (row.isAccessory) {
          add(row.name, row.category, phase.phase, zone.zone, row.qty, true);
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
          add(row.name, row.category, phase.phase, zone.zone, row.qty, false);
          continue;
        }
        add(table, row.category, phase.phase, zone.zone, row.qty, false);
        add(CHAIRS, CHAIR_CATEGORY, defaultPhaseForCategory(CHAIR_CATEGORY), zone.zone, row.qty * Number(each), false);
      }
    }
  }
  for (const piece of plan?.objects ?? []) {
    add(piece.name, piece.category, phaseOf.get(piece.objectId) ?? defaultPhaseForCategory(piece.category),
      classifyZoneV2(piece.x, piece.z, sheet.space), 1, false);
  }
  return items;
}

function changeoverItems(before: HallkeeperSheetV2, after: HallkeeperSheetV2): ChangeoverItem[] {
  const chairsByName = !hidesChairNames(before) && !hidesChairNames(after);
  const was = tallyItems(before, chairsByName);
  const now = tallyItems(after, chairsByName);
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

type PlanObject = HallkeeperFloorPlan["objects"][number];

function turned(a: PlanObject, b: PlanObject): boolean {
  if (a.collisionType === "cylinder" && b.collisionType === "cylinder") return false;
  const full = 2 * Math.PI;
  const delta = Math.abs((((b.rotationY - a.rotationY) % full) + full) % full);
  return Math.min(delta, full - delta) > MOVE_TURN_RAD;
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

/**
 * Pairs each piece the room holds with a piece the next layout needs, of the
 * same kind: first where one already stands (to the centimetre), then the
 * nearest few through a grid, then every piece of the kind still unpaired,
 * nearest first, as a carry across the room.
 */
function pairPieces(before: readonly PlanObject[], after: readonly PlanObject[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const taken = new Set<number>();

  const spot = (piece: PlanObject): string =>
    `${piece.assetDefinitionId}\u0000${String(Math.round(piece.x * 100))}\u0000${String(Math.round(piece.z * 100))}`;
  const afterBySpot = new Map<string, number[]>();
  after.forEach((piece, index) => { afterBySpot.set(spot(piece), [...(afterBySpot.get(spot(piece)) ?? []), index]); });
  before.forEach((piece, index) => {
    const free = (afterBySpot.get(spot(piece)) ?? []).find((to) => !taken.has(to));
    if (free === undefined) return;
    pairs.set(index, free);
    taken.add(free);
  });

  const cell = (value: number): number => Math.floor(value / SEARCH_CELL_M);
  const grid = new Map<string, number[]>();
  after.forEach((piece, index) => {
    if (taken.has(index)) return;
    const key = `${piece.assetDefinitionId}\u0000${String(cell(piece.x))}\u0000${String(cell(piece.z))}`;
    grid.set(key, [...(grid.get(key) ?? []), index]);
  });
  const nearest: Candidate[] = [];
  before.forEach((piece, index) => {
    if (pairs.has(index)) return;
    const near: Candidate[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const to of grid.get(`${piece.assetDefinitionId}\u0000${String(cell(piece.x) + dx)}\u0000${String(cell(piece.z) + dz)}`) ?? []) {
          const target = after[to];
          if (target !== undefined) near.push({ from: index, to, metres: distance(piece, target) });
        }
      }
    }
    near.sort((a, b) => a.metres - b.metres || a.to - b.to);
    nearest.push(...near.slice(0, NEAREST_FIRST));
  });
  takeClosest(nearest, pairs, taken);

  const freeAfter = new Map<string, number[]>();
  after.forEach((piece, index) => {
    if (!taken.has(index)) freeAfter.set(piece.assetDefinitionId, [...(freeAfter.get(piece.assetDefinitionId) ?? []), index]);
  });
  const rest: Candidate[] = [];
  before.forEach((piece, index) => {
    if (pairs.has(index)) return;
    for (const to of freeAfter.get(piece.assetDefinitionId) ?? []) {
      const target = after[to];
      if (target !== undefined) rest.push({ from: index, to, metres: distance(piece, target) });
    }
  });
  takeClosest(rest, pairs, taken);
  return pairs;
}

function groupPieces(pieces: readonly PlanObject[]): ChangeoverPlanGroup[] {
  const groups = new Map<string, { name: string; category: string; count: number }>();
  for (const piece of pieces) {
    const key = itemKey(piece.name, piece.category);
    const group = groups.get(key) ?? { name: piece.name, category: piece.category, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || naturally(a.name, b.name));
}

function changeoverPlan(before: HallkeeperSheetV2, after: HallkeeperSheetV2): ChangeoverPlan | null {
  const was = before.floorPlan ?? null;
  const now = after.floorPlan ?? null;
  if (was === null || now === null) return null;
  const pairs = pairPieces(was.objects, now.objects);
  const pairedAfter = new Set(pairs.values());
  const toStore = was.objects.filter((_, index) => !pairs.has(index));
  const fromStore = now.objects.filter((_, index) => !pairedAfter.has(index));
  const moved: PlanObject[] = [];
  let staysPut = 0;
  for (const [from, to] of pairs) {
    const prior = was.objects[from];
    const next = now.objects[to];
    if (prior === undefined || next === undefined) continue;
    if (distance(prior, next) > MOVE_DISTANCE_M || turned(prior, next)) moved.push(next);
    else staysPut += 1;
  }
  const footprint = (piece: PlanObject): ChangeoverFootprint => ({
    x: piece.x, z: piece.z, rotationY: piece.rotationY, scale: piece.scale,
    widthM: piece.widthM, depthM: piece.depthM, collisionType: piece.collisionType,
  });
  return {
    staysPut,
    moved: groupPieces(moved),
    fromStore: groupPieces(fromStore),
    toStore: groupPieces(toStore),
    movedIds: moved.map((piece) => piece.objectId),
    fromStoreIds: fromStore.map((piece) => piece.objectId),
    toStoreFootprints: toStore.map(footprint),
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
  return ChangeoverSchema.parse({
    from: { configId: from.configId, name: before.config.name.slice(0, 200), guests: before.config.guestCount, hasPlan: (before.floorPlan ?? null) !== null },
    to: { configId: to.configId, name: after.config.name.slice(0, 200), guests: after.config.guestCount, hasPlan: (after.floorPlan ?? null) !== null },
    items: changeoverItems(before, after),
    plan: changeoverPlan(before, after),
  });
}

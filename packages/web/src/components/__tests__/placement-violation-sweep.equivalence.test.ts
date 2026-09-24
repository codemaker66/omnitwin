// ---------------------------------------------------------------------------
// Placement violation sweep — exact equivalence with the O(n²) sweep it replaced
//
// PlacedFurniture's full constraint sweep and table-setting counts used to scan
// every item once per item. They now build one O(n) index per layout: a
// uniform-grid broadphase for overlaps, one group map, one chair tally. The
// rules did not change, so no result may change either.
//
// The `reference*` functions below are verbatim copies of the code as it stood
// before the index (getPlacementViolations and its private height helpers,
// getGroupMemberIds, placementViolationIds, tableGroupedChairCount and the
// tableSettingCounts memo). Seeded random layouts — banquet rounds, theatre
// rows, tiled stages, touching and duplicated furniture, dangling groups,
// duplicate ids, legacy dressing rows, non-finite and far-away poses — run
// through both, and the results must be identical: same ids in the same order,
// same counts. Every seeded assertion names its seed; `seededLayout(seed)`
// rebuilds the failing layout. Hand-built edge cases close the file.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { SpaceDimensions } from "@omnitwin/types";
import {
  DIRECT_VIOLATION_SCAN_MAX_CANDIDATES,
  leanSweepCandidates,
  placementViolationIds,
} from "../PlacedFurniture.js";
import { CATALOGUE_ITEMS, getCatalogueItem } from "../../lib/catalogue.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { normalizeFurnitureScale } from "../../lib/furniture-scale.js";
import { isDiningTableItem } from "../../lib/furniture-semantics.js";
import {
  computeRotatedFootprint,
  createGroupMemberIdsLookup,
  createPlacementOverlapIndex,
  getPlacementViolations,
  hasPlacementViolation,
  isWithinRoomBounds,
} from "../../lib/placement.js";
import type { PlacedItem, PlacementViolation } from "../../lib/placement.js";
import {
  isSceneFurniturePlacement,
  isTableDressingApplicatorSlug,
  tableGroupedChairCounts,
} from "../../lib/table-dressing.js";
import { computeChairPositions } from "../../lib/table-group.js";
import { GRAND_HALL_RENDER_DIMENSIONS, toRenderSpace } from "../../constants/scale.js";

// ---------------------------------------------------------------------------
// Reference: the pre-index implementation, copied verbatim
// ---------------------------------------------------------------------------

function referenceScaledFurnitureHeight(
  item: Pick<CatalogueItem, "height">,
  scale?: number,
): number {
  return item.height * normalizeFurnitureScale(scale);
}

function referenceFurnitureVerticalInterval(
  item: Pick<CatalogueItem, "height">,
  y: number,
  scale?: number,
): { readonly bottom: number; readonly top: number } {
  return {
    bottom: y,
    top: y + referenceScaledFurnitureHeight(item, scale),
  };
}

function referenceGetPlacementViolations(
  x: number,
  z: number,
  item: CatalogueItem,
  rotationY: number,
  placedItems: readonly PlacedItem[],
  excludeIds: ReadonlySet<string>,
  y: number = 0,
  roomDims: SpaceDimensions = GRAND_HALL_RENDER_DIMENSIONS,
  scale?: number,
): readonly PlacementViolation[] {
  if (isTableDressingApplicatorSlug(item.slug)) return [];
  const violations: PlacementViolation[] = [];

  if (!isWithinRoomBounds(x, z, item, rotationY, roomDims, scale)) {
    violations.push({
      kind: "outside_room",
      message: "Furniture footprint crosses the room boundary",
    });
  }

  const { halfW: aHalfW, halfD: aHalfD } = computeRotatedFootprint(item, rotationY, scale);
  const { bottom: aBottom, top: aTop } = referenceFurnitureVerticalInterval(item, y, scale);

  for (const other of placedItems) {
    if (excludeIds.has(other.id)) continue;
    if (!isSceneFurniturePlacement(other)) continue;
    const otherItem = getCatalogueItem(other.catalogueItemId);
    if (otherItem === undefined) continue;

    const { bottom: bBottom, top: bTop } = referenceFurnitureVerticalInterval(
      otherItem,
      other.y,
      other.scale,
    );
    if (aBottom >= bTop - 0.001 || bBottom >= aTop - 0.001) continue;

    const effectivePadding = (item.category === "stage" && otherItem.category === "stage") ? -0.05 : 0;
    const { halfW: bHalfW, halfD: bHalfD } = computeRotatedFootprint(
      otherItem,
      other.rotationY,
      other.scale,
    );
    const overlapX = Math.abs(x - other.x) < (aHalfW + bHalfW + effectivePadding);
    const overlapZ = Math.abs(z - other.z) < (aHalfD + bHalfD + effectivePadding);

    if (overlapX && overlapZ) {
      violations.push({
        kind: "overlap",
        message: `Overlaps ${otherItem.name}`,
        itemId: other.id,
      });
    }
  }

  return violations;
}

function referenceGetGroupMemberIds(
  itemId: string,
  placedItems: readonly PlacedItem[],
): ReadonlySet<string> {
  const item = placedItems.find((p) => p.id === itemId);
  if (item === undefined) return new Set([itemId]);
  if (!isSceneFurniturePlacement(item)) return new Set();
  if (item.groupId === null) return new Set([itemId]);
  const ids = new Set<string>();
  for (const p of placedItems) {
    if (p.groupId === item.groupId && isSceneFurniturePlacement(p)) ids.add(p.id);
  }
  return ids;
}

function referencePlacementViolationIds(
  candidates: readonly PlacedItem[],
  allItems: readonly PlacedItem[],
  roomDims: SpaceDimensions,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const placed of candidates) {
    if (!isSceneFurniturePlacement(placed)) continue;
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;
    const excludeIds = referenceGetGroupMemberIds(placed.id, allItems);
    const violations = referenceGetPlacementViolations(
      placed.x,
      placed.z,
      item,
      placed.rotationY,
      allItems,
      excludeIds,
      placed.y,
      roomDims,
      placed.scale,
    );
    if (violations.length > 0) ids.add(placed.id);
  }
  return ids;
}

function referenceTableGroupedChairCount(
  placedItems: readonly PlacedItem[],
  table: PlacedItem,
): number | undefined {
  if (table.groupId === null) return undefined;
  let count = 0;
  for (const placed of placedItems) {
    if (placed.id === table.id) continue;
    if (placed.groupId !== table.groupId) continue;
    if (getCatalogueItem(placed.catalogueItemId)?.category === "chair") count += 1;
  }
  return count > 0 ? count : undefined;
}

/** The body of PlacedFurniture's former `tableSettingCounts` memo. */
function referenceTableSettingCounts(placedItems: readonly PlacedItem[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const placed of placedItems) {
    const count = referenceTableGroupedChairCount(placedItems, placed);
    if (count !== undefined) counts.set(placed.id, count);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Seeded layouts
// ---------------------------------------------------------------------------

type Rng = () => number;

/** mulberry32: small, fast, deterministic; plenty for layout fuzzing. */
function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, values: readonly T[]): T {
  const value = values[Math.floor(rng() * values.length)];
  if (value === undefined) throw new Error("pick from an empty list");
  return value;
}

function catalogueWhere(predicate: (item: CatalogueItem) => boolean): readonly CatalogueItem[] {
  const items = CATALOGUE_ITEMS.filter(predicate);
  if (items.length === 0) throw new Error("catalogue fixture pool is empty");
  return items;
}

const CHAIRS = catalogueWhere((item) => item.category === "chair");
const DINING_TABLES = catalogueWhere((item) => isDiningTableItem(item) && item.tableShape !== null);
const STAGE_DECKS = catalogueWhere((item) => item.category === "stage");
const APPLICATORS = catalogueWhere((item) => isTableDressingApplicatorSlug(item.slug));
const ON_STAGE = catalogueWhere((item) => item.category === "lectern" || item.category === "av" || item.category === "chair");

const RIGHT_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2, (3 * Math.PI) / 2, Math.PI / 4, 2 * Math.PI];

function randomRotation(rng: Rng): number {
  const roll = rng();
  if (roll < 0.5) return pick(rng, RIGHT_ANGLES);
  if (roll < 0.9) return rng() * 2 * Math.PI - Math.PI;
  if (roll < 0.98) return 1000 + rng() * 10;
  return pick(rng, [Number.NaN, Number.POSITIVE_INFINITY]);
}

function randomScale(rng: Rng): number | undefined {
  const roll = rng();
  if (roll < 0.6) return undefined;
  if (roll < 0.9) return pick(rng, [1, 0.5, 0.75, 1.25, 1.5, 2, 3]);
  // Normalised back to 1 (0, negative, NaN) or tiny.
  if (roll < 0.97) return pick(rng, [0, -2, Number.NaN, 1e-3]);
  // 50× spans more grid cells than the index holds; 1e200 overflows to an
  // infinite footprint. Both must fall back to the exhaustive comparison.
  return pick(rng, [50, 1e200]);
}

interface Pose {
  readonly x: number;
  readonly z: number;
  readonly rotationY?: number;
  readonly y?: number;
  readonly scale?: number;
  readonly groupId?: string | null;
}

interface SeededLayout {
  readonly seed: number;
  readonly items: readonly PlacedItem[];
  readonly room: SpaceDimensions;
}

function randomRoom(rng: Rng, size: number): SpaceDimensions {
  const roll = rng();
  if (roll < 0.45) {
    // Floor area per item from crowded to sparse, so many verdicts hinge on
    // a single neighbour rather than on a pile-up.
    const area = Math.max(4, size * pick(rng, [2, 4, 8, 16, 32]));
    const aspect = 1 + rng() * 1.5;
    const width = Math.sqrt(area * aspect);
    return { width, length: area / width, height: 6 };
  }
  if (roll < 0.65) return GRAND_HALL_RENDER_DIMENSIONS;
  if (roll < 0.75) return { width: 8, length: 6, height: 3 };
  if (roll < 0.9) return { width: 2 + rng() * 38, length: 2 + rng() * 28, height: 6 };
  if (roll < 0.94) return { width: 0.5, length: 0.5, height: 3 };
  // Nothing is ever out of bounds, so far-away and non-finite poses reach the
  // overlap rule instead of short-circuiting on the room check.
  return { width: Number.POSITIVE_INFINITY, length: Number.POSITIVE_INFINITY, height: 7 };
}

/** Layout sizes: 0–300, with the small sizes around the direct-scan threshold well represented. */
function randomSize(rng: Rng): number {
  return rng() < 0.1 ? Math.floor(rng() * 6) : Math.floor(rng() * 301);
}

function seededLayout(seed: number): SeededLayout {
  const rng = mulberry32(seed);
  const size = randomSize(rng);
  const room = randomRoom(rng, size);
  const items: PlacedItem[] = [];
  let serial = 0;
  let groupSerial = 0;

  const unboundedRoom = !Number.isFinite(room.width);
  // Far origins only mean something when the room admits them. 32768 m is
  // exactly one bucket-key period of the grid, so its cells alias origin's;
  // 3e9 m lies beyond the grid's ±2^30 cells, forcing exhaustive comparison.
  const origins: readonly (readonly [number, number])[] = unboundedRoom
    ? [[0, 0], [32768, 0], [1e6, -2.5e6], [5e8, 5e8], [3e9, -3e9]]
    : [[0, 0]];
  const halfW = unboundedRoom ? 12 : room.width / 2;
  const halfL = unboundedRoom ? 8 : room.length / 2;

  const nextId = (): string => {
    serial += 1;
    // Duplicate ids are not supposed to happen, but both sweeps must agree.
    if (items.length > 0 && rng() < 0.03) return pick(rng, items).id;
    return `s${String(seed)}-${String(serial)}`;
  };
  const nextGroup = (): string => {
    groupSerial += 1;
    return `g${String(seed)}-${String(groupSerial)}`;
  };
  const existingGroup = (): string | null => {
    const grouped = items.filter((item) => item.groupId !== null);
    return grouped.length > 0 ? pick(rng, grouped).groupId : null;
  };
  const coordinate = (half: number): number => {
    const value = (rng() * 2 - 1) * half * 1.1;
    if (rng() >= 0.3) return value;
    // Quantised coordinates put footprint edges on cell boundaries and make
    // neighbours touch exactly.
    const step = pick(rng, [0.25, 0.5, 1, 0.61, 0.915, 0.455]);
    return Math.round(value / step) * step;
  };
  const anchor = (): readonly [number, number] => {
    const [ox, oz] = pick(rng, origins);
    return [ox + coordinate(halfW), oz + coordinate(halfL)];
  };
  const push = (item: CatalogueItem | string, pose: Pose): PlacedItem => {
    const placed: PlacedItem = {
      id: nextId(),
      catalogueItemId: typeof item === "string" ? item : item.id,
      label: "",
      x: pose.x,
      y: pose.y ?? 0,
      z: pose.z,
      rotationY: pose.rotationY ?? 0,
      ...(pose.scale === undefined ? {} : { scale: pose.scale }),
      clothed: false,
      clothStyle: null,
      tableSetting: null,
      groupId: pose.groupId ?? null,
    };
    items.push(placed);
    return placed;
  };

  const tableGroup = (): void => {
    const table = pick(rng, DINING_TABLES);
    const chair = pick(rng, CHAIRS);
    const [tx, tz] = anchor();
    const rotationY = rng() < 0.7 ? pick(rng, RIGHT_ANGLES) : randomRotation(rng);
    const tableScale = rng() < 0.85 ? undefined : pick(rng, [0.75, 1.25, 1.5]);
    const groupId = rng() < 0.9 ? nextGroup() : null;
    const seats = computeChairPositions(tx, tz, table, rotationY, Math.floor(rng() * 14), tableScale, chair);
    // Groups with missing members: the table or some chairs may be absent.
    if (rng() > 0.1) push(table, { x: tx, z: tz, rotationY, scale: tableScale, groupId });
    for (const seat of seats) {
      if (rng() < 0.1) continue;
      const seatGroup = rng() < 0.05 ? nextGroup() : groupId;
      push(chair, { x: seat.x, z: seat.z, rotationY: seat.rotationY, groupId: seatGroup });
    }
  };

  const theatreRow = (): void => {
    const chair = pick(rng, CHAIRS);
    const [x0, z0] = anchor();
    const count = 2 + Math.floor(rng() * 18);
    const pitch = pick(rng, [toRenderSpace(chair.width), 0.3, 0.5, 0.55, 0.6, 0.62]);
    const alongZ = rng() < 0.3;
    const rotationY = alongZ ? Math.PI / 2 : pick(rng, [0, Math.PI]);
    const groupId = rng() < 0.3 ? nextGroup() : null;
    for (let seat = 0; seat < count; seat += 1) {
      const offset = seat * pitch;
      push(chair, {
        x: alongZ ? x0 : x0 + offset,
        z: alongZ ? z0 + offset : z0,
        rotationY,
        groupId,
      });
    }
  };

  const stageBlock = (): void => {
    const deck = pick(rng, STAGE_DECKS);
    const [x0, z0] = anchor();
    const cols = 1 + Math.floor(rng() * 4);
    const rows = 1 + Math.floor(rng() * 3);
    // Flush decks, decks overlapping within and beyond the stage tolerance,
    // and a hairline gap.
    const gap = pick(rng, [0, 0, -0.02, -0.06, 0.01]);
    const stepX = toRenderSpace(deck.width) + gap;
    const stepZ = toRenderSpace(deck.depth) + gap;
    const deckY = rng() < 0.15 ? deck.height : 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        push(deck, { x: x0 + col * stepX, z: z0 + row * stepZ, y: deckY });
      }
    }
    const onTop = Math.floor(rng() * 4);
    for (let index = 0; index < onTop; index += 1) {
      // Flush on the deck, inside the 1 mm tolerance, and sunk into it.
      const sink = pick(rng, [0, 0.0005, 0.001, 0.002, 0.2]);
      push(pick(rng, ON_STAGE), {
        x: x0 + rng() * cols * stepX,
        z: z0 + rng() * rows * stepZ,
        y: deckY + deck.height - sink,
        rotationY: randomRotation(rng),
      });
    }
  };

  const scatter = (): void => {
    const [x, z] = anchor();
    const y = rng() < 0.75 ? 0 : pick(rng, [0.05, 0.4, 0.76, rng() * 2, -0.5, 0.999]);
    push(pick(rng, CATALOGUE_ITEMS), { x, z, y, rotationY: randomRotation(rng), scale: randomScale(rng) });
  };

  const duplicate = (): void => {
    const source = items.length > 0 ? pick(rng, items) : null;
    if (source === null) return;
    // Same position; the same id (a duplicate row) or a fresh one; the same
    // group, no group or a new one.
    const id = rng() < 0.4 ? source.id : `${source.id}-copy-${String(items.length)}`;
    items.push({ ...source, id, groupId: pick(rng, [source.groupId, null, nextGroup()]) });
  };

  const touchingPair = (): void => {
    const sources = items.filter((placed) => (
      isSceneFurniturePlacement(placed) && getCatalogueItem(placed.catalogueItemId) !== undefined
    ));
    if (sources.length === 0) return;
    const source = pick(rng, sources);
    const sourceItem = getCatalogueItem(source.catalogueItemId);
    if (sourceItem === undefined) return;
    const item = pick(rng, CATALOGUE_ITEMS);
    const rotationY = rng() < 0.7 ? pick(rng, RIGHT_ANGLES) : randomRotation(rng);
    const a = computeRotatedFootprint(sourceItem, source.rotationY, source.scale);
    const b = computeRotatedFootprint(item, rotationY);
    // Exactly touching (strict < keeps it legal), a hair apart, a hair over.
    const nudge = pick(rng, [0, 0, 1e-12, -1e-12, 1e-9, -1e-9, -0.01]);
    const alongX = rng() < 0.5;
    const side = rng() < 0.5 ? 1 : -1;
    push(item, {
      x: alongX ? source.x + side * (a.halfW + b.halfW + nudge) : source.x + (rng() - 0.5) * a.halfW,
      z: alongX ? source.z + (rng() - 0.5) * a.halfD : source.z + side * (a.halfD + b.halfD + nudge),
      y: source.y,
      rotationY,
    });
  };

  const wallFlush = (): void => {
    const item = pick(rng, CATALOGUE_ITEMS);
    const rotationY = pick(rng, RIGHT_ANGLES);
    const scale = randomScale(rng);
    const { halfW: itemHalfW, halfD: itemHalfD } = computeRotatedFootprint(item, rotationY, scale);
    const nudge = pick(rng, [0, 0, 1e-12, -1e-12, 0.001]);
    const side = rng() < 0.5 ? 1 : -1;
    const [x, z] = anchor();
    if (rng() < 0.5) {
      push(item, { x: side * (halfW - itemHalfW + nudge), z, rotationY, scale });
    } else {
      push(item, { x, z: side * (halfL - itemHalfD + nudge), rotationY, scale });
    }
  };

  const legacyApplicatorRow = (): void => {
    const [x, z] = anchor();
    push(pick(rng, APPLICATORS), { x, z, groupId: rng() < 0.6 ? existingGroup() : null });
  };

  const pathological = (): void => {
    const [x, z] = anchor();
    const roll = rng();
    if (roll < 0.35) {
      push(pick(rng, CATALOGUE_ITEMS), {
        x: pick(rng, [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e300, x]),
        z: pick(rng, [Number.NaN, Number.NEGATIVE_INFINITY, -1e300, z]),
        y: pick(rng, [0, Number.NaN]),
        rotationY: randomRotation(rng),
      });
    } else if (roll < 0.7) {
      // An asset missing from today's catalogue, possibly grouped.
      push("missing-asset-definition", { x, z, groupId: existingGroup() });
    } else {
      // A slug instead of the UUID: getCatalogueItem resolves both.
      push(pick(rng, CATALOGUE_ITEMS).slug, { x, z, rotationY: randomRotation(rng), groupId: existingGroup() });
    }
  };

  const elements: readonly (readonly [number, () => void])[] = [
    [0.26, tableGroup],
    [0.1, theatreRow],
    [0.08, stageBlock],
    [0.2, scatter],
    [0.08, duplicate],
    [0.1, touchingPair],
    [0.06, wallFlush],
    [0.05, legacyApplicatorRow],
    [0.07, pathological],
  ];
  while (items.length < size) {
    let roll = rng();
    for (const [weight, element] of elements) {
      roll -= weight;
      if (roll < 0) {
        element();
        break;
      }
    }
  }
  items.length = Math.min(items.length, size);
  return { seed, items, room };
}

/** Candidate lists as PlacedFurniture passes them, and awkward ones it could. */
function candidateLists(layout: SeededLayout, rng: Rng): readonly (readonly PlacedItem[])[] {
  const { items } = layout;
  const selectionRate = pick(rng, [0.002, 0.01, 0.05, 0.3]);
  const selected = new Set(items.filter(() => rng() < selectionRate).map((placed) => placed.id));
  const moved = items.slice(0, 4).map((placed, index) => ({
    ...placed,
    id: index % 2 === 0 ? placed.id : `${placed.id}-not-in-layout`,
    x: placed.x + 0.3,
  }));
  const repeated = items.slice(0, 3);
  return [
    // The full sweep, exactly as the component calls it.
    items,
    // The lean path: the selection.
    leanSweepCandidates(items, selected, true),
    // Either side of the direct-scan / indexed switch.
    items.slice(0, DIRECT_VIOLATION_SCAN_MAX_CANDIDATES),
    items.slice(0, DIRECT_VIOLATION_SCAN_MAX_CANDIDATES + 1),
    items.filter(() => rng() < 0.5),
    // Rows absent from the layout, and repeated candidates.
    [...moved, ...repeated, ...repeated],
  ];
}

const CANDIDATE_LISTS_PER_LAYOUT = 6;
const RANDOM_LAYOUT_SEEDS: readonly number[] = Array.from({ length: 500 }, (_, index) => 1000 + index);
const LAYOUTS: readonly SeededLayout[] = RANDOM_LAYOUT_SEEDS.map(seededLayout);
// The O(n²) reference dominates the runtime; chunks keep each test far inside
// the suite timeout on a loaded machine.
const LAYOUT_CHUNK_SIZE = 50;
const LAYOUT_CHUNKS: readonly (readonly SeededLayout[])[] = Array.from(
  { length: Math.ceil(LAYOUTS.length / LAYOUT_CHUNK_SIZE) },
  (_, chunk) => LAYOUTS.slice(chunk * LAYOUT_CHUNK_SIZE, (chunk + 1) * LAYOUT_CHUNK_SIZE),
);

function ordered(ids: ReadonlySet<string>): readonly string[] {
  return [...ids];
}

describe("seeded layouts", () => {
  it("cover empty to 300-item layouts with both verdicts well represented", () => {
    const sizes = LAYOUTS.map((layout) => layout.items.length);
    expect(Math.min(...sizes)).toBe(0);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(295);
    let violating = 0;
    let clear = 0;
    for (const layout of LAYOUTS) {
      // The equivalence tests below prove these verdicts equal the reference's.
      const flagged = placementViolationIds(layout.items, layout.items, layout.room);
      // Verdicts are reported per id, so count distinct judged ids.
      const judged = new Set(layout.items.filter((placed) => (
        isSceneFurniturePlacement(placed) && getCatalogueItem(placed.catalogueItemId) !== undefined
      )).map((placed) => placed.id));
      violating += flagged.size;
      clear += judged.size - flagged.size;
    }
    // Guards against the property below passing vacuously.
    expect(violating).toBeGreaterThan(10_000);
    expect(clear).toBeGreaterThan(10_000);
  });
});

describe("placementViolationIds — equivalence with the O(n²) sweep", () => {
  for (const chunk of LAYOUT_CHUNKS) {
    const seeds = `${String(chunk[0]?.seed)}–${String(chunk[chunk.length - 1]?.seed)}`;
    it(`flags exactly the same ids, in the same order, for every candidate list of seeds ${seeds}`, () => {
      let comparisons = 0;
      for (const layout of chunk) {
        const rng = mulberry32(layout.seed ^ 0x5eed);
        for (const candidates of candidateLists(layout, rng)) {
          const actual = placementViolationIds(candidates, layout.items, layout.room);
          const expected = referencePlacementViolationIds(candidates, layout.items, layout.room);
          expect(ordered(actual), `seed ${String(layout.seed)}, ${String(candidates.length)} candidates`)
            .toEqual(ordered(expected));
          comparisons += 1;
        }
      }
      expect(comparisons).toBe(chunk.length * CANDIDATE_LISTS_PER_LAYOUT);
    });
  }

  it("judges arbitrary poses against a layout exactly as getPlacementViolations did", () => {
    for (const layout of LAYOUTS) {
      const rng = mulberry32(layout.seed ^ 0xbeef);
      const overlapIndex = createPlacementOverlapIndex(layout.items);
      const groupMemberIds = createGroupMemberIdsLookup(layout.items);
      for (let probe = 0; probe < 8; probe += 1) {
        const item = pick(rng, CATALOGUE_ITEMS);
        const neighbour = layout.items.length > 0 ? pick(rng, layout.items) : null;
        const x = neighbour !== null && rng() < 0.7 ? neighbour.x + (rng() - 0.5) * 2 : (rng() - 0.5) * 30;
        const z = neighbour !== null && rng() < 0.7 ? neighbour.z + (rng() - 0.5) * 2 : (rng() - 0.5) * 20;
        const rotationY = randomRotation(rng);
        const y = rng() < 0.7 ? 0 : rng() * 1.5;
        const scale = randomScale(rng);
        const excludeIds = neighbour !== null && rng() < 0.5
          ? groupMemberIds(neighbour.id)
          : new Set<string>();
        const context = `seed ${String(layout.seed)}, probe ${String(probe)}`;

        const expectedList = referenceGetPlacementViolations(
          x, z, item, rotationY, layout.items, excludeIds, y, layout.room, scale,
        );
        expect(
          getPlacementViolations(x, z, item, rotationY, layout.items, excludeIds, y, layout.room, scale),
          context,
        ).toEqual(expectedList);
        expect(
          hasPlacementViolation(x, z, item, rotationY, overlapIndex, excludeIds, y, layout.room, scale),
          context,
        ).toBe(expectedList.length > 0);

        // The defaulted trailing parameters (floor height, Grand Hall).
        const expectedDefaults = referenceGetPlacementViolations(
          x, z, item, rotationY, layout.items, excludeIds,
        );
        expect(
          getPlacementViolations(x, z, item, rotationY, layout.items, excludeIds),
          context,
        ).toEqual(expectedDefaults);
        expect(
          hasPlacementViolation(x, z, item, rotationY, overlapIndex, excludeIds),
          context,
        ).toBe(expectedDefaults.length > 0);
      }
    }
  });
});

describe("createGroupMemberIdsLookup — equivalence with getGroupMemberIds", () => {
  it("returns the same members in the same order for every id, including unknown ones", () => {
    for (const layout of LAYOUTS) {
      const lookup = createGroupMemberIdsLookup(layout.items);
      const ids = [...layout.items.map((placed) => placed.id), "unknown-id", `s${String(layout.seed)}-0`];
      for (const id of ids) {
        expect([...lookup(id)], `seed ${String(layout.seed)}, id ${id}`)
          .toEqual([...referenceGetGroupMemberIds(id, layout.items)]);
      }
    }
  });
});

describe("tableGroupedChairCounts — equivalence with the per-item count loop", () => {
  it("produces the same entries, values and insertion order for every seeded layout", () => {
    for (const layout of LAYOUTS) {
      expect([...tableGroupedChairCounts(layout.items)], `seed ${String(layout.seed)}`)
        .toEqual([...referenceTableSettingCounts(layout.items)]);
    }
  });
});

// ---------------------------------------------------------------------------
// Hand-built edge cases the random layouts reach only by chance
// ---------------------------------------------------------------------------

function bySlug(slug: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find((candidate) => candidate.slug === slug);
  if (item === undefined) throw new Error(`missing catalogue fixture ${slug}`);
  return item;
}

function row(id: string, item: CatalogueItem, x: number, z: number, extra: Partial<PlacedItem> = {}): PlacedItem {
  return {
    id,
    catalogueItemId: item.id,
    label: "",
    x,
    y: 0,
    z,
    rotationY: 0,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
    groupId: null,
    ...extra,
  };
}

function expectSameSweep(items: readonly PlacedItem[], room: SpaceDimensions = GRAND_HALL_RENDER_DIMENSIONS): ReadonlySet<string> {
  const actual = placementViolationIds(items, items, room);
  expect(ordered(actual)).toEqual(ordered(referencePlacementViolationIds(items, items, room)));
  return actual;
}

describe("placementViolationIds — edge cases", () => {
  const chair = bySlug("banquet-chair");
  const deck = bySlug("platform");
  const cloth = bySlug("white-table-cloth");
  const round = bySlug("round-table-6ft");

  it("keeps exactly touching footprints legal on and off grid-cell boundaries", () => {
    // A 0.5 m stand has a dyadic half-width (0.25), so these sums are exact
    // and the footprints touch with no rounding either way.
    const stand = bySlug("mic-stand");
    const width = toRenderSpace(stand.width);
    expect(width).toBe(0.5);
    for (const origin of [0, 0.25, 0.5, 0.75, -7.25]) {
      const items = [0, 1, 2, 3].map((index) => row(`m${String(index)}`, stand, origin + index * width, 0));
      expect(expectSameSweep(items).size).toBe(0);
      const squeezed = items.map((placed, index) => ({ ...placed, x: placed.x - index * 1e-9 }));
      expect(expectSameSweep(squeezed).size).toBe(4);
    }
  });

  it("finds an overlap with furniture far larger than the grid's per-item cell budget", () => {
    const hugeTable = row("huge", round, 0, 0, { scale: 50 });
    const farChair = row("far", chair, 40, -40);
    expect([...expectSameSweep([hugeTable, farChair], { width: 200, length: 200, height: 7 })])
      .toEqual(["huge", "far"]);
  });

  it("matches the reference for non-finite and far-away poses in an unbounded room", () => {
    const unbounded = { width: Number.POSITIVE_INFINITY, length: Number.POSITIVE_INFINITY, height: 7 };
    const items = [
      row("nan", chair, Number.NaN, 0),
      row("inf", chair, Number.POSITIVE_INFINITY, 0),
      row("inf-twin", chair, Number.POSITIVE_INFINITY, 0),
      row("far-a", chair, 1e12, -1e12),
      row("far-b", chair, 1e12 + 0.1, -1e12),
      row("infinite-footprint", round, 3, 3, { scale: 1e200 }),
      row("near", chair, 3.5, 3.5),
      row("nan-rotation", chair, 20, 20, { rotationY: Number.NaN }),
    ];
    expectSameSweep(items, unbounded);
  });

  it("treats cells one bucket-key period apart as distinct places", () => {
    const items = [row("here", chair, 0.2, 0.2), row("aliased", chair, 32768.2, 0.2)];
    expect(expectSameSweep(items, { width: 70000, length: 100, height: 7 }).size).toBe(0);
  });

  it("reproduces duplicate-id semantics, including a first row that is a dressing applicator", () => {
    const items = [
      row("dup", cloth, 5, 5),
      row("dup", chair, 0, 0),
      row("twin", chair, 0, 0, { groupId: "g" }),
      row("twin", chair, 0, 0, { groupId: "h" }),
    ];
    expectSameSweep(items);
  });

  it("excludes group members, and only group members, from each other", () => {
    const items = [
      row("table", round, 0, 0, { groupId: "ring" }),
      row("seat", chair, 0.9, 0, { groupId: "ring" }),
      row("stranger", chair, -0.9, 0),
      row("legacy-cloth", cloth, 0, 0, { groupId: "ring" }),
      row("orphan", chair, 6, 0, { groupId: "gone" }),
    ];
    expect([...expectSameSweep(items)]).toEqual(["table", "stranger"]);
  });

  it("lets stage decks share an edge but not overlap past the stage tolerance", () => {
    const width = toRenderSpace(deck.width);
    expect(expectSameSweep([row("a", deck, 0, 0), row("b", deck, width - 0.049, 0)]).size).toBe(0);
    expect(expectSameSweep([row("a", deck, 0, 0), row("b", deck, width - 0.051, 0)]).size).toBe(2);
  });
});

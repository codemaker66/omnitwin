import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItem } from "../catalogue.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import type { PlacedItem } from "../placement.js";
import {
  cardParamsFor,
  danceFloorGrid,
  pieceCardId,
  resizeDanceFloor,
  stampSetup,
  type CardId,
  type CardParams,
} from "../setup-cards.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import {
  createGroupMemberIdsLookup,
  createPlacementOverlapIndex,
  getGroupMemberIds,
  hasPlacementViolation,
} from "../placement.js";
import { tableGroupedChairCounts } from "../table-dressing.js";
import { rearrangeTableGroup, tableChairSide, tableGroupSeatCapacity } from "../table-group.js";

let next = 0;
function ids(): string {
  next += 1;
  return `id-${String(next)}`;
}

beforeEach(() => {
  next = 0;
});

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

function params(id: CardId, request: Parameters<typeof cardParamsFor>[1] = {}): CardParams {
  const found = cardParamsFor(id, request);
  if (found === null) throw new Error(`no params for ${id}`);
  return found;
}

function slugOf(piece: PlacedItem): string | undefined {
  return getCatalogueItem(piece.catalogueItemId)?.slug;
}

function chairs(pieces: readonly PlacedItem[]): readonly PlacedItem[] {
  return pieces.filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "chair");
}

describe("Round of N", () => {
  it("sets down the round and its ten chairs as one group", () => {
    const stamp = stampSetup(params("round"), { x: 2, z: -1 }, 0, ids);
    expect(stamp).toHaveLength(11);
    expect(slugOf(stamp[0] as PlacedItem)).toBe("round-table-6ft-white");
    expect(chairs(stamp)).toHaveLength(10);
    expect(new Set(stamp.map((piece) => piece.groupId)).size).toBe(1);
    expect(stamp[0]).toMatchObject({ x: 2, z: -1 });
  });

  it("previews exactly what it commits", () => {
    const preview = stampSetup(params("round", { seats: 12 }), { x: 0, z: 0 }, 0.4, ids);
    next = 0;
    expect(stampSetup(params("round", { seats: 12 }), { x: 0, z: 0 }, 0.4, ids)).toEqual(preview);
    expect(preview).toHaveLength(13);
  });
});

describe("Dance floor", () => {
  it("sets down 5 × 5 panels as one group with no table", () => {
    const stamp = stampSetup(params("dance-floor"), { x: 1, z: 3 }, 0, ids);
    expect(stamp).toHaveLength(25);
    expect(new Set(stamp.map((piece) => piece.groupId)).size).toBe(1);
    expect(stamp.every((piece) => slugOf(piece) === "dancefloor-panel")).toBe(true);
    const grid = danceFloorGrid(stamp);
    expect(grid).toMatchObject({ cols: 5, rows: 5, rotationY: 0 });
    expect(grid?.x).toBeCloseTo(1, 9);
    expect(grid?.z).toBeCloseTo(3, 9);
  });

  it("reads its grid back when turned", () => {
    const stamp = stampSetup(params("dance-floor", { cols: 6, rows: 4 }), { x: -2, z: 1 }, Math.PI / 6, ids);
    const grid = danceFloorGrid(stamp);
    expect(grid).toMatchObject({ cols: 6, rows: 4 });
    expect(grid?.x).toBeCloseTo(-2, 9);
    expect(grid?.z).toBeCloseTo(1, 9);
  });

  it("grows 5 × 5 to 6 × 5 by five panels, keeping every panel already down", () => {
    const stamp = stampSetup(params("dance-floor"), { x: 0, z: 0 }, 0, ids);
    const grown = resizeDanceFloor(stamp, 6, 5, { x: -1, z: 0 }, ids);
    if (grown === null) throw new Error("not a grid");
    expect(grown).toHaveLength(30);
    const before = new Map(stamp.map((piece) => [piece.id, piece]));
    const kept = grown.filter((piece) => before.has(piece.id));
    expect(kept).toHaveLength(25);
    for (const piece of kept) expect(piece).toEqual(before.get(piece.id));
    expect(new Set(grown.map((piece) => piece.groupId))).toEqual(new Set([stamp[0]?.groupId]));
    expect(danceFloorGrid(grown)).toMatchObject({ cols: 6, rows: 5 });
  });

  it("holds the anchored edge still", () => {
    const stamp = stampSetup(params("dance-floor"), { x: 0, z: 0 }, 0, ids);
    const minX = Math.min(...stamp.map((piece) => piece.x));
    const maxX = Math.max(...stamp.map((piece) => piece.x));
    const low = resizeDanceFloor(stamp, 7, 5, { x: -1, z: 0 }, ids) ?? [];
    const high = resizeDanceFloor(stamp, 7, 5, { x: 1, z: 0 }, ids) ?? [];
    expect(Math.min(...low.map((piece) => piece.x))).toBeCloseTo(minX, 9);
    expect(Math.max(...high.map((piece) => piece.x))).toBeCloseTo(maxX, 9);
  });

  it("shrinks using only panels already down", () => {
    const stamp = stampSetup(params("dance-floor"), { x: 0, z: 0 }, 0, ids);
    const shrunk = resizeDanceFloor(stamp, 4, 4, { x: 0, z: 0 }, ids) ?? [];
    expect(shrunk).toHaveLength(16);
    const before = new Set(stamp.map((piece) => piece.id));
    expect(shrunk.every((piece) => before.has(piece.id))).toBe(true);
  });

  it("stays within 2 to 12 panels a side", () => {
    const stamp = stampSetup(params("dance-floor"), { x: 0, z: 0 }, 0, ids);
    expect(danceFloorGrid(resizeDanceFloor(stamp, 40, 1, undefined, ids) ?? [])).toMatchObject({ cols: 12, rows: 2 });
  });

  it("refuses pieces that are not one whole grid", () => {
    const stamp = stampSetup(params("dance-floor"), { x: 0, z: 0 }, 0, ids);
    expect(danceFloorGrid(stamp.slice(1))).toBeNull();
    expect(resizeDanceFloor(stamp.slice(1), 6, 6, undefined, ids)).toBeNull();
  });
});

describe("groups without a table", () => {
  it("give a dance floor no chair counts", () => {
    expect(tableGroupedChairCounts(stampSetup(params("dance-floor"), { x: 0, z: 0 }, 0, ids)).size).toBe(0);
  });

  it("are left alone by the seat stepper, and leave a table next to them alone", () => {
    const floor = stampSetup(params("dance-floor"), { x: 6, z: 0 }, 0, ids);
    const round = stampSetup(params("round"), { x: 0, z: 0 }, 0, ids);
    const room = [...floor, ...round];
    const panel = floor[0];
    const table = round[0];
    if (panel === undefined || table === undefined) throw new Error("nothing stamped");
    expect(rearrangeTableGroup(panel.id, 10, room)).toEqual(room);
    const reseated = rearrangeTableGroup(table.id, 8, room);
    for (const piece of floor) expect(reseated).toContainEqual(piece);
    expect(chairs(reseated)).toHaveLength(8);
  });
});

describe("Top table and Long table", () => {
  it("set down one trestle until they are built as sets: three chairs on one side, or six around", () => {
    const top = stampSetup(params("top-table"), { x: 0, z: 0 }, 0, ids);
    expect(top).toHaveLength(4);
    const trestle = top[0] as PlacedItem;
    expect(chairs(top).every((chair) => chair.z > trestle.z)).toBe(true);
    expect(top.every((piece) => piece.setId === undefined)).toBe(true);
    expect(stampSetup(params("long-table"), { x: 0, z: 0 }, 0, ids)).toHaveLength(7);
  });

  it("run four trestles bound into one set, each with its own chairs' group", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    const top = stampSetup(params("top-table"), { x: 0, z: 0 }, 0, ids);
    expect(top).toHaveLength(16);
    expect(chairs(top)).toHaveLength(12);
    expect(new Set(top.map((piece) => piece.groupId)).size).toBe(4);
    expect(new Set(top.map((piece) => piece.setId)).size).toBe(1);
    expect(top[0]?.setId).toBeDefined();
    const long = stampSetup(params("long-table"), { x: 0, z: 0 }, Math.PI / 2, ids);
    expect(chairs(long)).toHaveLength(24);
  });

  it("is one body to the planner's own sweep, turned or not", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    for (const turn of [0, Math.PI / 12, Math.PI / 4, (3 * Math.PI) / 2]) {
      const run = stampSetup(params("top-table", { trestles: 4 }), { x: 0, z: 0 }, turn, ids);
      const index = createPlacementOverlapIndex(run);
      const members = createGroupMemberIdsLookup(run);
      for (const piece of run) {
        const item = getCatalogueItem(piece.catalogueItemId);
        if (item === undefined) throw new Error("unknown piece");
        expect(members(piece.id)).toEqual(getGroupMemberIds(piece.id, run));
        expect(hasPlacementViolation(piece.x, piece.z, item, piece.rotationY, index, members(piece.id), piece.y, GRAND_HALL_RENDER_DIMENSIONS, piece.scale)).toBe(false);
      }
    }
  });

  it("keeps a top table's chairs along its back when its seats change", () => {
    const top = stampSetup(params("top-table"), { x: 0, z: 0 }, Math.PI / 6, ids);
    const trestle = top[0] as PlacedItem;
    expect(tableChairSide(trestle, top)).toBe("back");
    expect(tableGroupSeatCapacity(trestle, top)).toBe(3);
    const reseated = rearrangeTableGroup(trestle.id, 2, top);
    expect(chairs(reseated)).toHaveLength(2);
    expect(tableChairSide(trestle, reseated)).toBe("back");
    const long = stampSetup(params("long-table"), { x: 0, z: 0 }, 0, ids);
    expect(tableChairSide(long[0] as PlacedItem, long)).toBe("around");
  });

  it("lays its trestles end to end along the run", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    const run = stampSetup(params("long-table", { trestles: 3 }), { x: 0, z: 0 }, 0, ids);
    const trestles = run.filter((piece) => slugOf(piece)?.startsWith("trestle") === true).map((piece) => piece.x).sort((a, b) => a - b);
    expect(trestles).toHaveLength(3);
    expect((trestles[1] ?? 0) - (trestles[0] ?? 0)).toBeCloseTo(1.83, 9);
    expect(trestles[1]).toBeCloseTo(0, 9);
  });
});

describe("piece cards", () => {
  it("set down one piece, or a dining table with its seats", () => {
    expect(stampSetup(params(pieceCardId("platform")), { x: 0, z: 0 }, 0, ids)).toEqual([
      expect.objectContaining({ groupId: null, x: 0, z: 0 }),
    ]);
    expect(stampSetup(params(pieceCardId("trestle-6ft")), { x: 0, z: 0 }, 0, ids)).toHaveLength(7);
  });
});

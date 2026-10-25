import { describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { createGhostWorld } from "../ghost-truth.js";
import {
  createPlacedItem,
  createPlacementOverlapIndex,
  expandIdsToGroupMembers,
  nextTableLabel,
  nextTableLabels,
  placementBody,
  tableLabelNumber,
  type PlacedItem,
} from "../placement.js";
import {
  DUPLICATE_GAP_M,
  allPieceIds,
  copyPieces,
  footprintBounds,
  piecesOfKindIds,
  planDuplicate,
  planPaste,
} from "../placement-edit.js";
import { cardParamsFor, stampSetup } from "../setup-cards.js";

let counter = 0;
function ids(): string {
  counter += 1;
  return `p-${String(counter)}`;
}

function slugId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`${slug} missing`);
  return item.id;
}

function round(x: number, z: number, label: string, colourway: "white" | "black" = "white"): readonly PlacedItem[] {
  const params = cardParamsFor("round", { colourway });
  if (params === null) throw new Error("no round");
  return stampSetup(params, { x, z }, 0, ids).map((piece, i) => (i === 0 ? { ...piece, label } : piece));
}

function table(group: readonly PlacedItem[]): PlacedItem {
  const first = group[0];
  if (first === undefined) throw new Error("empty group");
  return first;
}

describe("table numbers", () => {
  it("numbers three rounds 1 to 3, and gives a removed number back first", () => {
    expect(nextTableLabels([], 3)).toEqual(["Table 1", "Table 2", "Table 3"]);
    const room = [...round(0, 0, "Table 1"), ...round(4, 0, "Table 3")];
    expect(nextTableLabel(room)).toBe("Table 2");
  });

  it("reads only whole 'Table N' labels", () => {
    expect(tableLabelNumber(" Table 7 ")).toBe(7);
    for (const label of ["Top table", "Table 2a", "Table 0", "", undefined]) expect(tableLabelNumber(label)).toBeNull();
  });
});

describe("sets", () => {
  it("expand to every group bound into the set", () => {
    const a = { ...createPlacedItem("x", 0, 0, 0, "g1", 0, "a1"), setId: "s" };
    const b = { ...createPlacedItem("x", 1, 0, 0, "g1", 0, "a2"), setId: "s" };
    const c = { ...createPlacedItem("x", 2, 0, 0, "g2", 0, "b1"), setId: "s" };
    const d = createPlacedItem("x", 3, 0, 0, "g3", 0, "c1");
    expect([...expandIdsToGroupMembers(new Set(["a1"]), [a, b, c, d])].sort()).toEqual(["a1", "a2", "b1"]);
  });
});

describe("the overlap index", () => {
  it("lists what a body overlaps, outside the exclusions", () => {
    const lectern = getCatalogueItemBySlug("lectern");
    if (lectern === undefined) throw new Error("lectern missing");
    const placed = [createPlacedItem(lectern.id, 0, 0, 0, null, 0, "near"), createPlacedItem(lectern.id, 5, 0, 0, null, 0, "far")];
    const index = createPlacementOverlapIndex(placed);
    const body = placementBody(0.3, 0, lectern, 0, 0);
    expect(index.overlapping(body, new Set()).map((hit) => hit.id)).toEqual(["near"]);
    expect(index.overlapping(body, new Set(["near"]))).toEqual([]);
    expect(index.overlapsAny(body, new Set())).toBe(true);
  });
});

describe("Ctrl D", () => {
  it("duplicates a round of 10 one pitch away: 11 new ids, a new group and the next table number", () => {
    const original = round(0, 0, "Table 1");
    const dressed = original.map((piece, i) => (i === 0 ? { ...piece, tableSetting: "dinner" as const } : piece));
    const plan = planDuplicate(new Set([table(dressed).id]), createGhostWorld(dressed, GRAND_HALL_RENDER_DIMENSIONS), null, { newId: ids });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.items).toHaveLength(11);
    const before = new Set(dressed.map((piece) => piece.id));
    expect(plan.items.some((piece) => before.has(piece.id))).toBe(false);
    const groups = new Set(plan.items.map((piece) => piece.groupId));
    expect(groups.size).toBe(1);
    expect(groups.has(table(dressed).groupId)).toBe(false);
    const copyTable = plan.items.find((piece) => piece.catalogueItemId === table(dressed).catalogueItemId);
    expect(copyTable).toMatchObject({ label: "Table 2", tableSetting: "dinner" });
    expect(plan.idMap.get(table(dressed).id)).toBe(copyTable?.id);
    const bounds = footprintBounds(dressed);
    if (bounds === null) throw new Error("no footprint");
    expect(plan.offset.dz).toBe(0);
    expect(plan.offset.dx).toBeCloseTo(bounds.maxX - bounds.minX + DUPLICATE_GAP_M, 9);
  });

  it("repeats the last offset", () => {
    const first = round(0, 0, "Table 1");
    const plan = planDuplicate(new Set([table(first).id]), createGhostWorld(first, GRAND_HALL_RENDER_DIMENSIONS), null, { newId: ids });
    if (!plan.ok) throw new Error(plan.reason);
    const room = [...first, ...plan.items];
    const again = planDuplicate(new Set([table(plan.items).id]), createGhostWorld(room, GRAND_HALL_RENDER_DIMENSIONS), plan.offset, { newId: ids });
    if (!again.ok) throw new Error(again.reason);
    expect(again.offset.dx).toBeCloseTo(plan.offset.dx, 9);
    expect(again.offset.dz).toBeCloseTo(plan.offset.dz, 9);
    expect(table(again.items).label).toBe("Table 3");
  });

  it("is refused with the reason when no pitch fits", () => {
    const original = round(0, 0, "Table 1");
    const plan = planDuplicate(new Set([table(original).id]), createGhostWorld(original, { width: 4, length: 4, height: 3 }), null, { newId: ids });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/^Won't fit/u);
  });

  it("keeps the label as it is when tables are not numbered", () => {
    const original = round(0, 0, "Table 1");
    const plan = planDuplicate(new Set([table(original).id]), createGhostWorld(original, GRAND_HALL_RENDER_DIMENSIONS), null, { numberTables: false, newId: ids });
    if (!plan.ok) throw new Error(plan.reason);
    expect(table(plan.items).label).toBe("Table 1");
  });
});

describe("Ctrl C and Ctrl V", () => {
  it("pastes the whole round at the pointer", () => {
    const original = round(0, 0, "Table 1");
    const clipboard = copyPieces(new Set([table(original).id]), original);
    if (clipboard === null) throw new Error("nothing copied");
    expect(clipboard.items).toHaveLength(11);
    const plan = planPaste(clipboard, { x: 6, z: 1 }, createGhostWorld(original, GRAND_HALL_RENDER_DIMENSIONS), { newId: ids });
    if (!plan.ok) throw new Error(plan.reason);
    expect(table(plan.items).x).toBeCloseTo(6, 9);
    expect(table(plan.items).z).toBeCloseTo(1, 9);
    expect(table(plan.items).label).toBe("Table 2");
  });

  it("refuses a paste onto what is already there", () => {
    const original = round(0, 0, "Table 1");
    const clipboard = copyPieces(new Set([table(original).id]), original);
    if (clipboard === null) throw new Error("nothing copied");
    const plan = planPaste(clipboard, { x: 0.2, z: 0 }, createGhostWorld(original, GRAND_HALL_RENDER_DIMENSIONS), { newId: ids });
    expect(plan.ok).toBe(false);
  });

  it("copies nothing when nothing is selected", () => {
    expect(copyPieces(new Set(), round(0, 0, "Table 1"))).toBeNull();
  });
});

describe("Ctrl A and Ctrl Shift A", () => {
  it("selects every piece, leaving dressing rows out", () => {
    const room = [...round(0, 0, "Table 1"), createPlacedItem(slugId("white-table-cloth"), 0, 0, 0, null, 0, "cloth-row")];
    const all = allPieceIds(room);
    expect(all).toHaveLength(11);
    expect(all).not.toContain("cloth-row");
  });

  it("selects every piece of the selected kind, whatever its cloth", () => {
    const white = round(0, 0, "Table 1");
    const black = round(4, 0, "Table 2", "black");
    const lectern = createPlacedItem(slugId("lectern"), 8, 0, 0, null, 0, "lectern");
    const kind = piecesOfKindIds([...white, ...black, lectern], new Set([table(white).id]));
    expect([...kind].sort()).toEqual([table(white).id, table(black).id].sort());
  });
});

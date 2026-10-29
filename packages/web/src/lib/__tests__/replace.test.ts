import { afterEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { createGhostWorld } from "../ghost-truth.js";
import { footprintBounds } from "../placement-edit.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { planReplace } from "../replace.js";
import { cardParamsFor, pieceCardId, stampSetup, type CardId, type CardParams } from "../setup-cards.js";

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

let counter = 0;
function ids(): string {
  counter += 1;
  return `r-${String(counter)}`;
}

function params(card: CardId, request: Parameters<typeof cardParamsFor>[1] = {}): CardParams {
  const found = cardParamsFor(card, request);
  if (found === null) throw new Error(`no ${card}`);
  return found;
}

function round(x: number, z: number, label: string, colourway: "white" | "black" = "white"): readonly PlacedItem[] {
  return stampSetup(params("round", { colourway }), { x, z }, 0, ids).map((piece, i) => (i === 0 ? { ...piece, label } : piece));
}

function slugOf(piece: PlacedItem): string | undefined {
  return getCatalogueItem(piece.catalogueItemId)?.slug;
}

/** A 2 × 2 block of rounds whose rows span 7.5 m chair back to chair back, as the spec's example. */
function block(): readonly PlacedItem[] {
  const probe = footprintBounds(round(0, 0, "probe"));
  if (probe === null) throw new Error("no footprint");
  const half = (probe.maxX - probe.minX) / 2;
  const x = 3.75 - half;
  // Rows 3.6 m apart keep the block shallower (6.7 m) than it is long, so the runs go along X.
  return [...round(-x, -1.8, "Table 1"), ...round(x, -1.8, "Table 2"), ...round(-x, 1.8, "Table 3"), ...round(x, 1.8, "Table 4")];
}

function world(pieces: readonly PlacedItem[]): ReturnType<typeof createGhostWorld> {
  return createGhostWorld(pieces, GRAND_HALL_RENDER_DIMENSIONS);
}

function tableIds(pieces: readonly PlacedItem[]): Set<string> {
  return new Set(pieces.filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table").map((piece) => piece.id));
}

describe("rounds to long tables", () => {
  it("turns 4 rounds into 2 long tables of four trestles: 40 seats become 48, every note carried", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    const room = block();
    const tables = [...tableIds(room)];
    const result = planReplace(new Set(tables), params("long-table"), world(room), { newId: ids, hasNote: () => true });
    if (!result.ok) throw new Error(result.reason);
    const { plan } = result;
    expect(plan.seatsBefore).toBe(40);
    expect(plan.seatsAfter).toBe(48);
    expect(plan.removeIds.size).toBe(44);
    expect(plan.add.filter((piece) => slugOf(piece) === "trestle-6ft-white")).toHaveLength(8);
    expect(new Set(plan.add.map((piece) => piece.setId)).size).toBe(2);
    // Two runs along X, one on each row's line.
    const trestles = plan.add.filter((piece) => slugOf(piece) === "trestle-6ft-white");
    expect(new Set(trestles.map((piece) => piece.z.toFixed(6)))).toEqual(new Set([(-1.8).toFixed(6), (1.8).toFixed(6)]));
    expect(trestles.every((piece) => piece.rotationY === 0)).toBe(true);
    expect(plan.sentence).toBe("Replace 4 rounds with 2 long tables · 40 seats become 48 · cloth kept · notes move to the new tables");
    expect(plan.receipt).toBe("Replaced 4 rounds with 2 long tables");
    expect(plan.notes).toHaveLength(4);
    const newTables = tableIds(plan.add);
    for (const note of plan.notes) {
      expect(newTables.has(note.toId)).toBe(true);
      expect(note.prefix).toMatch(/^Table [1-4]: $/u);
    }
  });

  it("keeps the most common cloth, and says so when the cloths were mixed", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    const probe = footprintBounds(round(0, 0, "probe"));
    if (probe === null) throw new Error("no footprint");
    const width = probe.maxX - probe.minX;
    // Three rounds in one row, white first: two black of three must win over the first seen.
    const room = [...round(-width - 0.2, 0, "Table 1", "white"), ...round(0, 0, "Table 2", "black"), ...round(width + 0.2, 0, "Table 3", "black")];
    const result = planReplace(tableIds(room), params("long-table"), world(room), { newId: ids });
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.add.some((piece) => slugOf(piece) === "trestle-6ft-black")).toBe(true);
    expect(result.plan.add.some((piece) => slugOf(piece) === "trestle-6ft-white")).toBe(false);
    expect(result.plan.sentence).toContain("black cloths, the most common");
  });

  it("is refused, with the reason, when a run would overlap what stays", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    const lectern = getCatalogueItemBySlug("lectern");
    if (lectern === undefined) throw new Error("no lectern");
    const room = [...block(), createPlacedItem(lectern.id, 0, 1.8, 0, null, 0, "lectern")];
    const result = planReplace(tableIds(room), params("long-table"), world(room), { newId: ids });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/^Won't fit · would overlap the lectern by \d\.\d m$/u);
  });
});

describe("a table to another table", () => {
  it("swaps a round for a black-clothed one in place, keeping its id (so its note) and its chairs", () => {
    const room = round(0, 0, "Table 1");
    const table = room[0];
    if (table === undefined) throw new Error("no table");
    const result = planReplace(new Set([table.id]), params(pieceCardId("round-table-6ft-black")), world(room), { newId: ids, hasNote: () => true });
    if (!result.ok) throw new Error(result.reason);
    const swapped = result.plan.add.find((piece) => piece.id === table.id);
    expect(swapped && slugOf(swapped)).toBe("round-table-6ft-black");
    expect(swapped?.label).toBe("Table 1");
    expect(result.plan.removeIds.size).toBe(0);
    expect(result.plan.notes).toEqual([]);
    expect(result.plan.seatsAfter).toBe(10);
    expect(result.plan.sentence).toBe("Replace 1 round with 1 round · 10 seats become 10");
  });

  it("sets rounds of twelve where rounds of ten stood, each keeping its own cloth", () => {
    const room = [...round(-3, 0, "Table 1", "black"), ...round(3, 0, "Table 2")];
    const result = planReplace(tableIds(room), params("round", { seats: 12 }), world(room), { newId: ids });
    if (!result.ok) throw new Error(result.reason);
    const tables = result.plan.add.filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
    expect(tables.map(slugOf).sort()).toEqual(["round-table-6ft-black", "round-table-6ft-white"]);
    expect(result.plan.seatsAfter).toBe(24);
    expect(result.plan.sentence).toBe("Replace 2 rounds with 2 rounds · 20 seats become 24 · cloth kept");
  });
});

describe("a set as a table", () => {
  function set(card: "top-table" | "long-table", label: string): readonly PlacedItem[] {
    setPlannerFeaturesForTesting({ tableSets: true });
    return stampSetup(params(card, { trestles: 4 }), { x: 0, z: 0 }, 0, ids).map((piece, i) => (i === 0 ? { ...piece, label } : piece));
  }

  it("re-clothes every trestle of a Top table in place, each keeping its chairs on the back", () => {
    const top = set("top-table", "Top table");
    const result = planReplace(new Set([top[0]?.id ?? ""]), params(pieceCardId("trestle-6ft-black")), world(top), { newId: ids });
    if (!result.ok) throw new Error(result.reason);
    const trestles = result.plan.add.filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
    expect(trestles).toHaveLength(4);
    expect(trestles.every((piece) => slugOf(piece) === "trestle-6ft-black")).toBe(true);
    expect(result.plan.removeIds.size).toBe(0);
    expect(result.plan.add.map((piece) => piece.id).sort()).toEqual(top.map((piece) => piece.id).sort());
    expect(result.plan.sentence).toBe("Replace 1 table with 1 table · 12 seats become 12");
  });

  it("turns a Long table into one round at its centre, keeping its first trestle's name and moving the others' notes", () => {
    const long = set("long-table", "Table 9");
    const first = long[0];
    if (first === undefined) throw new Error("no trestle");
    const result = planReplace(new Set([first.id]), params("round"), world(long), { newId: ids, hasNote: () => true });
    if (!result.ok) throw new Error(result.reason);
    const tables = result.plan.add.filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ id: first.id, label: "Table 9", x: 0, z: 0 });
    expect(tables[0] === undefined ? undefined : slugOf(tables[0])).toBe("round-table-6ft-white");
    expect(result.plan.seatsBefore).toBe(24);
    expect(result.plan.seatsAfter).toBe(10);
    expect(result.plan.removeIds.size).toBe(long.length - 1);
    expect(result.plan.notes.map((note) => note.toId)).toEqual([first.id, first.id, first.id]);
  });
});

describe("the spec's limits", () => {
  it("sets a table of another footprint as one piece at the selection's centre, not in place", () => {
    const room = round(2, 1, "Table 1");
    const result = planReplace(new Set([room[0]?.id ?? ""]), params(pieceCardId("trestle-6ft-white")), world(room), { newId: ids });
    if (!result.ok) throw new Error(result.reason);
    const tables = result.plan.add.filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
    expect(tables.map(slugOf)).toEqual(["trestle-6ft-white"]);
    expect(result.plan.removeIds.has(room[0]?.id ?? "")).toBe(true);
    const bounds = footprintBounds(room);
    if (bounds === null) throw new Error("no footprint");
    expect(tables[0]?.x).toBeCloseTo((bounds.minX + bounds.maxX) / 2, 9);
  });

  it("names every new piece from the plan's own ids, so the preview is the commit", () => {
    const room = [...round(-3, 0, "Table 1"), ...round(3, 0, "Table 2")];
    const before = new Set(room.map((piece) => piece.id));
    const result = planReplace(tableIds(room), params("round", { seats: 12 }), world(room), { newId: ids });
    if (!result.ok) throw new Error(result.reason);
    const fresh = result.plan.add.filter((piece) => !before.has(piece.id));
    expect(fresh).toHaveLength(4);
    for (const piece of fresh) expect(piece.id).toMatch(/^r-\d+$/u);
  });

  it("asks the store first, and refuses with its words (B2)", () => {
    const room = [...round(-3, 0, "Table 1"), ...round(3, 0, "Table 2")];
    const chairsIn = (pieces: readonly PlacedItem[]): number => pieces.filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "chair").length;
    const store = (change: { readonly add: readonly PlacedItem[] }): string | null => (chairsIn(change.add) > 20 ? "Velvet Banquet Chair: 20 in store, this needs 24" : null);
    const twelves = planReplace(tableIds(room), params("round", { seats: 12 }), world(room), { newId: ids, store });
    expect(twelves).toEqual({ ok: false, obstacle: null, reason: "Velvet Banquet Chair: 20 in store, this needs 24" });
    expect(planReplace(tableIds(room), params("round", { seats: 8 }), world(room), { newId: ids, store }).ok).toBe(true);
  });
});

describe("chairs and anything else", () => {
  it("swaps lone chairs for another model in place", () => {
    const banquet = getCatalogueItemBySlug("banquet-chair");
    if (banquet === undefined) throw new Error("no chair");
    const room = [0, 1, 2].map((i) => createPlacedItem(banquet.id, i, 0, 0, null, 0, `chair-${String(i)}`));
    const result = planReplace(new Set(room.map((chair) => chair.id)), params(pieceCardId("chiavari-chair")), world(room), { newId: ids });
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.add.map((chair) => chair.id)).toEqual(["chair-0", "chair-1", "chair-2"]);
    expect(result.plan.add.every((chair) => slugOf(chair) === "chiavari-chair")).toBe(true);
    expect(result.plan.sentence).toBe("Replace 3 chairs with 3 chairs · 3 seats become 3");
  });

  it("sets one of the card at the selection's centre for anything else", () => {
    const lectern = getCatalogueItemBySlug("lectern");
    if (lectern === undefined) throw new Error("no lectern");
    const room = [createPlacedItem(lectern.id, 4, 1, 0, null, 0, "lectern")];
    const result = planReplace(new Set(["lectern"]), params(pieceCardId("bar-counter")), world(room), { newId: ids });
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.removeIds).toEqual(new Set(["lectern"]));
    expect(result.plan.add).toHaveLength(1);
    expect(result.plan.add[0]).toMatchObject({ x: 4, z: 1 });
  });
});

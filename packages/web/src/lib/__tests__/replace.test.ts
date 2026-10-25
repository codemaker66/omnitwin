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

  it("keeps the most common cloth", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    const probe = footprintBounds(round(0, 0, "probe"));
    if (probe === null) throw new Error("no footprint");
    const x = 3.75 - (probe.maxX - probe.minX) / 2;
    const room = [...round(-x, 0, "Table 1", "black"), ...round(x, 0, "Table 2", "black")];
    const result = planReplace(tableIds(room), params("long-table"), world(room), { newId: ids });
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.add.filter((piece) => slugOf(piece) === "trestle-6ft-black")).toHaveLength(4);
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

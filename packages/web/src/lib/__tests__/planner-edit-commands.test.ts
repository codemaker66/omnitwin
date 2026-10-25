// Line up, Move and Replace as commands (lib/planner-keymap.ts): the plan, every
// piece settled where it stands, set down as one write through placement-store
// applyEdit (so one undo step), the result selected; a refusal says why and
// changes nothing (card-dock spec §8.2, §18; Q-16, Q-18, law 11).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { resetPlacedIdCounter, settleOnSurfaces, type PlacedItem } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { duplicateSelection, lineUpSelection, moveSelectionTo, replaceSelection, resetEditingMemoryForTesting } from "../planner-keymap.js";
import { cardParamsFor, stampSetup, type CardId, type CardParams, type CardParamsRequest } from "../setup-cards.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";

function params(card: CardId, asked: CardParamsRequest = {}): CardParams {
  const found = cardParamsFor(card, asked);
  if (found === null) throw new Error(`no ${card}`);
  return found;
}

function placed(): readonly PlacedItem[] {
  return usePlacementStore.getState().placedItems;
}

function tables(): readonly PlacedItem[] {
  return placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
}

/** A Round of 10 set down at (x, z), settled on what is there. */
function placeRound(x: number, z: number): readonly string[] {
  return usePlacementStore.getState().placeSetup(settleOnSurfaces(stampSetup(params("round"), { x, z }, 0), placed()));
}

/** How many times placedItems is written while `act` runs: EditorBridge makes each write one undo step. */
function writesDuring(act: () => void): number {
  let writes = 0;
  const unsubscribe = usePlacementStore.subscribe((state, previous) => { if (state.placedItems !== previous.placedItems) writes += 1; });
  act();
  unsubscribe();
  return writes;
}

beforeEach(() => {
  resetPlacedIdCounter();
  resetEditingMemoryForTesting();
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  useSelectionStore.getState().clearSelection();
  usePlacementNoticeStore.getState().dismiss();
});

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

describe("Line up", () => {
  it("puts three rounds' centres on one line as one write, and selects them", () => {
    for (const [x, z] of [[-6, -0.6], [0, 0.4], [6, 0.2]] as const) placeRound(x, z);
    useSelectionStore.getState().selectMultiple(tables().map((table) => table.id));
    expect(writesDuring(() => { expect(lineUpSelection()).toBe(true); })).toBe(1);
    const zs = tables().map((table) => table.z);
    expect(zs[0]).toBeCloseTo(0, 9);
    expect(zs.every((z) => Math.abs(z - (zs[0] ?? 0)) < 1e-9)).toBe(true);
    expect(useSelectionStore.getState().selectedIds.size).toBe(33);
  });

  it("is refused for one table, with the reason, and changes nothing", () => {
    placeRound(0, 0);
    const before = placed();
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    expect(lineUpSelection()).toBe(false);
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Line up needs two or more");
  });
});

describe("Move", () => {
  it("moves a round off a dance floor whole, as one write, and its chairs come down to the floor", () => {
    usePlacementStore.getState().placeSetup(stampSetup(params("dance-floor"), { x: 0, z: 0 }, 0));
    const round = placeRound(0, 0);
    expect(placed().filter((piece) => round.includes(piece.id)).every((piece) => piece.y > 0)).toBe(true);
    useSelectionStore.getState().select(round[0] ?? "");
    expect(writesDuring(() => { expect(moveSelectionTo({ x: 6, z: 0 })).toBe(true); })).toBe(1);
    const moved = placed().filter((piece) => round.includes(piece.id));
    expect(moved).toHaveLength(11);
    expect(moved.every((piece) => piece.y === 0)).toBe(true);
    expect(tables().find((table) => round.includes(table.id))?.x).toBeCloseTo(6, 9);
    expect(useSelectionStore.getState().selectedIds).toEqual(new Set(round));
  });

  it("is refused onto another set, with the reason, and changes nothing", () => {
    placeRound(-5, 0);
    const second = placeRound(5, 0);
    const before = placed();
    useSelectionStore.getState().select(second[0] ?? "");
    expect(moveSelectionTo({ x: -5, z: 0.5 })).toBe(false);
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/^Won't fit/u);
  });
});

describe("Replace", () => {
  it("turns two rounds into one long table as one write, selects it, and hands back the plan", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    placeRound(-2.2, 0);
    placeRound(2.2, 0);
    const before = placed();
    useSelectionStore.getState().selectMultiple(tables().map((table) => table.id));
    let result: ReturnType<typeof replaceSelection> | null = null;
    expect(writesDuring(() => { result = replaceSelection(params("long-table")); })).toBe(1);
    const replaced = result as ReturnType<typeof replaceSelection> | null;
    if (replaced === null || !replaced.ok) throw new Error("refused");
    expect(placed().some((piece) => before.some((old) => old.id === piece.id))).toBe(false);
    expect(placed().every((piece) => replaced.plan.add.some((added) => added.id === piece.id))).toBe(true);
    expect(useSelectionStore.getState().selectedIds).toEqual(new Set(placed().map((piece) => piece.id)));
    expect(replaced.plan.receipt).toMatch(/^Replaced 2 rounds with/u);
  });

  it("is refused past the store's stock, with the store's words, and changes nothing (B2)", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    placeRound(-2.2, 0);
    placeRound(2.2, 0);
    const before = placed();
    useSelectionStore.getState().selectMultiple(tables().map((table) => table.id));
    const result = replaceSelection(params("long-table"), { store: () => "Trestle: 1 in store, this needs 2" });
    expect(result.ok).toBe(false);
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Trestle: 1 in store, this needs 2");
  });
});

describe("the copies Ctrl D sets down", () => {
  it("stand on a dance floor they land on", () => {
    setPlannerFeaturesForTesting({ editingKeys: true });
    const poseur = getCatalogueItemBySlug("poseur-table");
    if (poseur === undefined) throw new Error("no poseur");
    usePlacementStore.getState().placeSetup(stampSetup(params("dance-floor"), { x: 2, z: 0 }, 0));
    // Just off the floor's near edge (x −0.28), so one pitch (+x first) puts the copy wholly on it.
    usePlacementStore.getState().placeItem(poseur.id, -1, 0, 0);
    const original = placed().find((piece) => piece.catalogueItemId === poseur.id);
    expect(original?.y).toBe(0);
    useSelectionStore.getState().select(original?.id ?? "");
    expect(duplicateSelection()).toBe(true);
    const copy = placed().find((piece) => piece.catalogueItemId === poseur.id && piece.id !== original?.id);
    if (copy === undefined) throw new Error("no copy");
    // One pitch along the room's long axis lands it on the floor, and it stands on the floor.
    const floor = placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.slug === "dancefloor-panel");
    expect(copy.x).toBeGreaterThan(0);
    expect(copy.y).toBeGreaterThan(0);
    expect(copy.y).toBe(settleOnSurfaces([copy], floor)[0]?.y);
  });
});

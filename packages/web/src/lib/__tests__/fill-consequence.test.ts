import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import {
  FILL_AISLE_RULE,
  fillConsequence,
  fillConsequenceLine,
  fillOverActionLabel,
  fillOverReceipt,
  grandHallExits,
  planRoomFill,
  refillPieces,
  type RoomFill,
} from "../auto-fill.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { resetPlacedIdCounter, type PlacedItem } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { cardParamsFor, stampSetup, type CardId, type CardParamsRequest } from "../setup-cards.js";

// ---------------------------------------------------------------------------
// Fill over a laid floor says what it does to the rounds already there before
// it does it (planner-qol CR-E C-02): what moves, comes and goes, the notes
// that go with a round taken away, seats reset to the plan's, and sizes set
// back to the standard one (C-X6). Its button seats rather than places, and
// its receipt is one Undo.
// ---------------------------------------------------------------------------

const round = getCatalogueItemBySlug("round-table-6ft-white");

function stamp(card: CardId, x: number, z: number, asked: CardParamsRequest = {}): readonly PlacedItem[] {
  const params = cardParamsFor(card, asked);
  if (params === null) throw new Error(`no ${card}`);
  return stampSetup(params, { x, z }, 0);
}

/** `count` rounds of 10 named Table 1 onwards, in two rows along the hall. */
function rounds(count: number): PlacedItem[] {
  return Array.from({ length: count }, (_, i) => stamp("round", -9 + (i % 7) * 3, i < 7 ? -2.5 : 2.5)
    .map((piece, p) => (p === 0 ? { ...piece, label: `Table ${String(i + 1)}` } : piece))).flat();
}

function planFor(placed: readonly PlacedItem[], guests: number): RoomFill {
  if (round === undefined) throw new Error("no round");
  const fill = planRoomFill({ table: round, seatsPerTable: 10, guests, roomWidthM: 21, roomLengthM: 10.5, exits: grandHallExits(), rule: FILL_AISLE_RULE }, placed);
  if (fill === null) throw new Error("no fill");
  return fill;
}

const noNotes = (): boolean => false;

beforeEach(() => {
  resetPlacedIdCounter();
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  usePlacementNoticeStore.getState().dismiss();
});

afterEach(() => { setPlannerFeaturesForTesting(null); });

describe("what a fill over a laid floor says before it lays", () => {
  it("takes 14 rounds down to 8, naming the note that goes with a round taken away", () => {
    const placed = rounds(14);
    const fill = planFor(placed, 80);
    const table12 = placed.find((piece) => piece.label === "Table 12");
    const consequence = fillConsequence(placed, fill.refillIds, fill.plan, (id) => id === table12?.id);
    expect(consequence).toMatchObject({ moved: 8, added: 0, removedWithNotes: ["Table 12"], reseated: [], resized: [] });
    expect(consequence?.removed).toEqual(["Table 9", "Table 10", "Table 11", "Table 12", "Table 13", "Table 14"]);
    expect(consequence === null ? "" : fillConsequenceLine(consequence))
      .toBe("Moves 8 rounds and takes away 6. Table 12 has a note, which goes with it.");
  });

  it("takes 6 rounds up to 11, moving the six and adding five", () => {
    const placed = rounds(6);
    const fill = planFor(placed, 110);
    const consequence = fillConsequence(placed, fill.refillIds, fill.plan, noNotes);
    expect(consequence).toMatchObject({ moved: 6, added: 5, removed: [] });
    expect(consequence === null ? "" : fillConsequenceLine(consequence)).toBe("Moves 6 rounds and adds 5.");
  });

  it("says a round set for 12 is set for the plan's 10, rather than keeping its count", () => {
    const placed = [...rounds(3), ...stamp("round", 6, 0, { seats: 12 }).map((piece, p) => (p === 0 ? { ...piece, label: "Table 4" } : piece))];
    const fill = planFor(placed, 40);
    const consequence = fillConsequence(placed, fill.refillIds, fill.plan, noNotes);
    expect(consequence?.reseated).toEqual([{ name: "Table 4", had: 12 }]);
    expect(consequence === null ? "" : fillConsequenceLine(consequence))
      .toBe("Moves 4 rounds. Each round is set for 10: Table 4 had 12.");
  });

  it("sets a scaled round back to the standard size the spacing assumed, and says so (C-X6)", () => {
    const placed = rounds(2).map((piece) => (piece.label === "Table 2" ? { ...piece, scale: 1.2 } : piece));
    const fill = planFor(placed, 20);
    const consequence = fillConsequence(placed, fill.refillIds, fill.plan, noNotes);
    expect(consequence?.resized).toEqual(["Table 2"]);
    expect(consequence === null ? "" : fillConsequenceLine(consequence)).toBe("Moves 2 rounds. Table 2 goes back to the standard size.");
    const laid = refillPieces(placed, fill.refillIds, fill.plan);
    expect(laid.find((piece) => piece.label === "Table 2")?.scale).toBeUndefined();
  });

  it("counts only the rounds it sets anew: a dance floor kept where it is is not mentioned", () => {
    const floor = stamp("dance-floor", 0, 0, { cols: 4, rows: 4 });
    const placed = [...rounds(2), ...floor];
    const fill = planFor(placed, 20);
    for (const panel of floor) expect(fill.refillIds.has(panel.id)).toBe(false);
    expect(fillConsequence(placed, fill.refillIds, fill.plan, noNotes)).toMatchObject({ moved: 2, added: 0, removed: [] });
  });

  it("says nothing when no round of the fill's kind is on the floor", () => {
    const floor = stamp("dance-floor", 0, 0, { cols: 4, rows: 4 });
    const fill = planFor(floor, 20);
    expect(fillConsequence(floor, fill.refillIds, fill.plan, noNotes)).toBeNull();
  });
});

describe("Fill over a laid floor's button and receipt", () => {
  it("seats rather than places", () => {
    expect(fillOverActionLabel(planFor(rounds(6), 110).plan)).toBe("Seat 110 at 11 tables");
  });

  it("posts a receipt one Undo takes back", () => {
    if (round === undefined) throw new Error("no round");
    setPlannerFeaturesForTesting({ fillKeepOuts: true });
    usePlacementStore.setState({ placedItems: rounds(6) });
    const plan = usePlacementStore.getState().autoArrangeBanquet(round.id, 80, 10, grandHallExits());
    if (plan === null || plan.style !== "dinner-rounds") throw new Error("no plan");
    expect(usePlacementNoticeStore.getState().notice).toMatchObject({ text: fillOverReceipt(plan), undo: true });
    expect(fillOverReceipt(plan)).toBe("Laid out 8 tables");
  });
});

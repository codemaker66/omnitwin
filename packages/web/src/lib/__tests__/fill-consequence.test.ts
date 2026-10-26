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
  fillOverDoneLine,
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

  it("sets a scaled round, table and chairs, back to the standard size the spacing assumed, and says so (C-X6)", () => {
    const two = rounds(2);
    const table2 = two.find((piece) => piece.label === "Table 2");
    // The inspector scales a round as a whole: its table and its chairs.
    const placed = two.map((piece) => (piece.groupId === table2?.groupId ? { ...piece, scale: 1.2 } : piece));
    const fill = planFor(placed, 20);
    const consequence = fillConsequence(placed, fill.refillIds, fill.plan, noNotes);
    expect(consequence?.resized).toEqual(["Table 2"]);
    expect(consequence === null ? "" : fillConsequenceLine(consequence)).toBe("Moves 2 rounds. Table 2 goes back to the standard size.");
    const round2 = refillPieces(placed, fill.refillIds, fill.plan).filter((piece) => piece.groupId === table2?.groupId);
    expect(round2).toHaveLength(11);
    // Said outright, never left out: the editor bridge reads a missing scale as the piece's old one.
    for (const piece of round2) expect(piece.scale).toBe(1);
  });

  it("keeps a round where it stands when the same fill is asked for again, rather than saying it moves", () => {
    const placed = rounds(14);
    const first = planFor(placed, 80);
    const laid = [...placed.filter((piece) => !first.refillIds.has(piece.id)), ...refillPieces(placed, first.refillIds, first.plan)];
    const again = planFor(laid, 80);
    const consequence = fillConsequence(laid, again.refillIds, again.plan, noNotes);
    expect(consequence).toMatchObject({ moved: 0, kept: 8, added: 0, removed: [] });
    expect(consequence === null ? "" : fillConsequenceLine(consequence)).toBe("Keeps every round where it is.");
  });

  it("names the note on a chair of a round taken away", () => {
    const placed = rounds(14);
    const table12 = placed.find((piece) => piece.label === "Table 12");
    const chair = placed.find((piece) => piece.groupId === table12?.groupId && piece.id !== table12.id);
    const fill = planFor(placed, 80);
    const consequence = fillConsequence(placed, fill.refillIds, fill.plan, (id) => id === chair?.id);
    expect(consequence?.removedWithNotes).toEqual(["Table 12"]);
  });

  it("names a note on a chair a round set for fewer seats leaves behind", () => {
    const twelve = stamp("round", 6, 0, { seats: 12 }).map((piece, p) => (p === 0 ? { ...piece, label: "Table 4" } : piece));
    const placed = [...rounds(3), ...twelve];
    // A round keeps its first ten seats; the eleventh and twelfth go.
    const lastChair = twelve[twelve.length - 1];
    const fill = planFor(placed, 40);
    const consequence = fillConsequence(placed, fill.refillIds, fill.plan, (id) => id === lastChair?.id);
    expect(consequence?.chairNotesGoing).toEqual([{ name: "Table 4", notes: 1 }]);
    expect(consequence === null ? "" : fillConsequenceLine(consequence))
      .toBe("Moves 4 rounds. A chair taken from Table 4 has a note, which goes with it. Each round is set for 10: Table 4 had 12.");
  });

  it("counts unnamed rounds together rather than naming each \"a round\"", () => {
    const placed = [...stamp("round", -3, 0, { seats: 12 }), ...stamp("round", 3, 0, { seats: 12 })];
    const fill = planFor(placed, 20);
    const consequence = fillConsequence(placed, fill.refillIds, fill.plan, noNotes);
    expect(consequence === null ? "" : fillConsequenceLine(consequence)).toContain("Each round is set for 10: 2 unnamed rounds had 12.");
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

  it("tells the lens what it did once laid, not that it placed", () => {
    const placed = rounds(14);
    const fill = planFor(placed, 80);
    const consequence = fillConsequence(placed, fill.refillIds, fill.plan, noNotes);
    if (consequence === null) throw new Error("no consequence");
    expect(fillOverDoneLine(fill.plan, consequence)).toBe("Seated 80 at 8 tables: moved 8 rounds and took away 6.");
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

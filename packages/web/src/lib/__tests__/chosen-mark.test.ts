import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItem } from "../catalogue.js";
import { CHOSEN_MARK_MARGIN_M, chosenMarks, type ChosenMark } from "../chosen-mark.js";
import { placedFootprint } from "../keep-doors-clear.js";
import type { PlacedItem } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { cardParamsFor, pieceCardId, stampSetup, type CardId, type CardParamsRequest } from "../setup-cards.js";

const TURINI = "burgess-turini-18-3";

let sequence = 0;
const newId = (): string => {
  sequence += 1;
  return `piece-${String(sequence)}`;
};

function stamp(id: CardId, x: number, z: number, asked: CardParamsRequest = {}): readonly PlacedItem[] {
  const params = cardParamsFor(id, asked);
  if (params === null) throw new Error(`no card ${id}`);
  return stampSetup(params, { x, z }, 0, newId, TURINI);
}

function isRound(piece: PlacedItem): boolean {
  return getCatalogueItem(piece.catalogueItemId)?.tableShape === "round";
}

function only(marks: readonly ChosenMark[]): ChosenMark {
  const [mark] = marks;
  if (mark === undefined || marks.length !== 1) throw new Error(`expected one mark, got ${String(marks.length)}`);
  return mark;
}

/** Every corner of every piece lies inside the mark, and the mark hugs the farthest. */
function expectRound(mark: ChosenMark, pieces: readonly PlacedItem[]): void {
  if (mark.kind !== "ring") throw new Error("expected a ring");
  let farthest = 0;
  for (const piece of pieces) {
    const footprint = placedFootprint(piece);
    if (footprint === null) continue;
    const reach = Math.hypot(footprint.x - mark.x, footprint.z - mark.z) + Math.min(footprint.halfW, footprint.halfD);
    farthest = Math.max(farthest, reach);
    expect(reach).toBeLessThan(mark.radius);
  }
  expect(mark.radius - farthest).toBeLessThan(CHOSEN_MARK_MARGIN_M + 0.6);
}

beforeEach(() => {
  sequence = 0;
  setPlannerFeaturesForTesting({ tableSets: true, setupCards: true, seatsOnTheCard: true });
});
afterEach(() => { setPlannerFeaturesForTesting(null); });

describe("the mark round what is chosen", () => {
  it("marks nothing while nothing is chosen", () => {
    expect(chosenMarks(new Set(), stamp("round", 0, 0, { seats: 10 }))).toEqual([]);
  });

  it("rings a round table with its chairs about the table's own centre", () => {
    const pieces = stamp("round", 2, -1, { seats: 10 });
    const table = pieces.find(isRound);
    if (table === undefined) throw new Error("no round table in the set");
    const mark = only(chosenMarks(new Set([table.id]), pieces));
    expect(mark.kind).toBe("ring");
    expect(mark.x).toBeCloseTo(2, 6);
    expect(mark.z).toBeCloseTo(-1, 6);
    expectRound(mark, pieces);
    // The chairs stand inside the ring: it is wider than the table alone.
    const alone = placedFootprint(table);
    if (mark.kind === "ring" && alone !== null) expect(mark.radius).toBeGreaterThan(Math.max(alone.halfW, alone.halfD) + 0.3);
  });

  it("gives one mark to a set however many of its pieces are chosen, a chair alone included", () => {
    const pieces = stamp("round", 0, 0, { seats: 8 });
    const chair = pieces.find((piece) => !isRound(piece));
    if (chair === undefined) throw new Error("no chair in the set");
    const byChair = only(chosenMarks(new Set([chair.id]), pieces));
    const byAll = only(chosenMarks(new Set(pieces.map((piece) => piece.id)), pieces));
    expect(byAll).toEqual(byChair);
  });

  it("frames a straight piece squared to the room, a margin outside it", () => {
    const pieces = stamp(pieceCardId("platform"), -3, 2);
    const [stage] = pieces;
    if (stage === undefined) throw new Error("no stage");
    const mark = only(chosenMarks(new Set([stage.id]), pieces));
    const footprint = placedFootprint(stage);
    if (mark.kind !== "frame" || footprint === null) throw new Error("expected a frame");
    expect(mark.x).toBeCloseTo(footprint.x, 6);
    expect(mark.z).toBeCloseTo(footprint.z, 6);
    expect(mark.halfW).toBeCloseTo(footprint.halfW + CHOSEN_MARK_MARGIN_M, 6);
    expect(mark.halfD).toBeCloseTo(footprint.halfD + CHOSEN_MARK_MARGIN_M, 6);
  });

  it("frames a long table with its chairs as one", () => {
    const pieces = stamp("long-table", 0, 0);
    const first = pieces[0];
    if (first === undefined) throw new Error("no long table");
    const mark = only(chosenMarks(new Set([first.id]), pieces));
    if (mark.kind !== "frame") throw new Error("expected a frame");
    for (const piece of pieces) {
      const footprint = placedFootprint(piece);
      if (footprint === null) continue;
      expect(footprint.x - footprint.halfW).toBeGreaterThan(mark.x - mark.halfW);
      expect(footprint.x + footprint.halfW).toBeLessThan(mark.x + mark.halfW);
      expect(footprint.z - footprint.halfD).toBeGreaterThan(mark.z - mark.halfD);
      expect(footprint.z + footprint.halfD).toBeLessThan(mark.z + mark.halfD);
    }
  });

  it("marks each of two chosen sets, in the order they were chosen", () => {
    const near = stamp("round", -4, 0, { seats: 10 });
    const far = stamp("round", 4, 0, { seats: 10 });
    const nearTable = near.find(isRound);
    const farTable = far.find(isRound);
    if (nearTable === undefined || farTable === undefined) throw new Error("no tables");
    const marks = chosenMarks(new Set([farTable.id, nearTable.id]), [...near, ...far]);
    expect(marks.map((mark) => mark.x)).toEqual([4, -4]);
    expect(new Set(marks.map((mark) => mark.key)).size).toBe(2);
  });

  it("leaves a chosen piece that is no longer in the room unmarked", () => {
    expect(chosenMarks(new Set(["gone"]), stamp("round", 0, 0, { seats: 10 }))).toEqual([]);
  });
});

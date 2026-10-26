import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { TABLE_KIND, stopWords, walkKind, walkOrder, walkStep, walkStops, type WalkStop } from "../piece-walk.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import { cardMainItem, cardParamsFor, stampSetup } from "../setup-cards.js";

// ---------------------------------------------------------------------------
// Walking the room by keyboard (QoL B-X2): what a stop is, the order the
// walk takes, where a step lands and what is said.
// ---------------------------------------------------------------------------

let ids = 0;
function nextId(): string {
  ids += 1;
  return `p${String(ids)}`;
}

/** A Round of 10 at (x, z), its table named `label` ("" for none). */
function round(x: number, z: number, label = ""): readonly PlacedItem[] {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  const table = cardMainItem(params);
  return stampSetup(params, { x, z }, 0, nextId).map((piece) => (piece.catalogueItemId === table?.id ? { ...piece, label } : piece));
}

function lone(slug: string, x: number, z: number): PlacedItem {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no ${slug}`);
  return createPlacedItem(item.id, x, z, 0, null, 0, nextId());
}

function names(order: readonly WalkStop[]): readonly string[] {
  return order.map(stopWords);
}

describe("stops", () => {
  it("makes a table and its chairs one stop, named by the table, its number from its name", () => {
    const pieces = round(0, 0, "Table 4");
    const stops = walkStops(pieces);
    expect(stops).toHaveLength(1);
    const [stop] = stops;
    expect(stop?.kind).toBe(TABLE_KIND);
    expect(stop?.number).toBe(4);
    expect(stop?.pieces).toHaveLength(11);
    expect(pieces.find((piece) => piece.id === stop?.pieceId)?.label).toBe("Table 4");
    expect(stop === undefined ? "" : stopWords(stop)).toBe("Table 4, Round of 10, 10 seats");
  });

  it("makes a dance floor's panels one stop, said by its size, and a lone piece its own", () => {
    const floor = cardParamsFor("dance-floor");
    if (floor === null) throw new Error("no dance floor");
    const stops = walkStops([...stampSetup(floor, { x: 5, z: 5 }, 0, nextId), lone("lectern", -5, 0)]);
    expect(names(stops)).toEqual(["Dance floor, 4.6 m square", "Lectern"]);
  });
});

describe("order", () => {
  it("takes tables by number, then those without one row by row, front to back and left to right", () => {
    const stops = walkStops([
      ...round(9, 9, "Table 3"),
      ...round(-9, 6),
      ...round(0, -9, "Table 1"),
      ...round(6, 6.4),
      ...round(-3, -6),
    ]);
    expect(walkOrder(stops, TABLE_KIND).map((stop) => [stop.number, stop.x, stop.z])).toEqual([
      [1, 0, -9],
      [3, 9, 9],
      [null, -3, -6],
      // One row: within 0.9 m of each other front to back, so left to right.
      [null, -9, 6],
      [null, 6, 6.4],
    ]);
  });

  it("walks one kind, or every kind, row by row", () => {
    const stops = walkStops([...round(0, 0, "Table 1"), lone("lectern", 4, -4), lone("poseur-table", 4, 4), lone("poseur-table", -4, 4)]);
    expect(names(walkOrder(stops, null))).toEqual(["Lectern", "Table 1, Round of 10, 10 seats", "Poseur Table", "Poseur Table"]);
    expect(walkOrder(stops, "poseur-table").map((stop) => stop.x)).toEqual([-4, 4]);
  });

  it("walks the selected piece's kind, a chair's being its table's, and tables with nothing selected", () => {
    const table = round(0, 0, "Table 1");
    const poseur = lone("poseur-table", 4, 4);
    const stops = walkStops([...table, poseur]);
    const head = stops.find((stop) => stop.kind === TABLE_KIND)?.pieceId;
    const chair = table.find((piece) => piece.id !== head);
    expect(walkKind(stops, new Set([poseur.id]))).toBe("poseur-table");
    expect(walkKind(stops, new Set([chair?.id ?? ""]))).toBe(TABLE_KIND);
    expect(walkKind(stops, new Set())).toBe(TABLE_KIND);
  });
});

describe("a step", () => {
  const order = walkOrder(walkStops([...round(-6, 0, "Table 1"), ...round(0, 0, "Table 2"), ...round(6, 0, "Table 3")]), TABLE_KIND);
  const [one, two, three] = order;
  if (one === undefined || two === undefined || three === undefined) throw new Error("three tables");

  it("goes on from the selection, and wraps round at each end", () => {
    expect(walkStep(order, 1, new Set([one.pieceId]), null)).toBe(two);
    expect(walkStep(order, -1, new Set([two.pieceId]), null)).toBe(one);
    expect(walkStep(order, 1, new Set([three.pieceId]), null)).toBe(one);
    expect(walkStep(order, -1, new Set([one.pieceId]), null)).toBe(three);
  });

  it("starts at the first going on and the last going back, with nothing selected", () => {
    expect(walkStep(order, 1, new Set(), null)).toBe(one);
    expect(walkStep(order, -1, new Set(), null)).toBe(three);
    expect(walkStep([], 1, new Set(), null)).toBeNull();
  });

  it("goes on from where a stop it chose was removed, either way", () => {
    const cursor = { order: order.map((stop) => stop.pieceId), at: 1 };
    const without = order.filter((stop) => stop !== two);
    expect(walkStep(without, -1, new Set(), cursor)).toBe(one);
    expect(walkStep(without, 1, new Set(), cursor)).toBe(three);
    // Still standing (the selection was let go): the walk starts afresh.
    expect(walkStep(order, -1, new Set(), cursor)).toBe(three);
  });
});

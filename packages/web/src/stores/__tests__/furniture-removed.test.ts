import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removedLabel, subscribeFurnitureRemoved, usePlacementStore } from "../placement-store.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createPlacedItem, resetPlacedIdCounter } from "../../lib/placement.js";
import { createTableGroup } from "../../lib/table-group.js";

// ---------------------------------------------------------------------------
// Removals are announced, as placements are (planner-qol's craft backlog,
// item 10): the removed ids and what they were in a receipt's words, so the
// receipt host can say "Removed Table 3 and 10 chairs · Undo".
// ---------------------------------------------------------------------------

function id(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`No ${slug} in the catalogue`);
  return item.id;
}

const ROUND = id("round-table-6ft");

function tableThree(): ReturnType<typeof createTableGroup> {
  return createTableGroup(ROUND, 0, 0, 0, 10).map((piece) => (piece.catalogueItemId === ROUND ? { ...piece, label: "Table 3" } : piece));
}

let heard: { ids: readonly string[]; label: string }[] = [];
let stop: () => void = () => undefined;

beforeEach(() => {
  resetPlacedIdCounter();
  heard = [];
  stop = subscribeFurnitureRemoved((ids, label) => { heard.push({ ids, label }); });
});

afterEach(() => {
  stop();
  usePlacementStore.setState({ placedItems: [] });
});

describe("a removal is announced in a receipt's words", () => {
  it("names a removed table with its chairs: Table 3 and 10 chairs", () => {
    const group = tableThree();
    const table = group.find((piece) => piece.catalogueItemId === ROUND);
    usePlacementStore.setState({ placedItems: group });
    usePlacementStore.getState().removeItems(new Set([table?.id ?? ""]));
    expect(heard).toHaveLength(1);
    expect(heard[0]?.label).toBe("Table 3 and 10 chairs");
    expect([...(heard[0]?.ids ?? [])].sort()).toEqual(group.map((piece) => piece.id).sort());
  });

  it("names one removed chair", () => {
    const chair = createPlacedItem(id("burgess-turini-18-3"), 2, 2, 0);
    usePlacementStore.setState({ placedItems: [chair] });
    usePlacementStore.getState().removeItem(chair.id);
    expect(heard).toEqual([{ ids: [chair.id], label: "1 chair" }]);
  });

  it("says nothing when nothing was removed", () => {
    usePlacementStore.setState({ placedItems: [] });
    usePlacementStore.getState().removeItem("not-placed");
    usePlacementStore.getState().removeItems(new Set());
    expect(heard).toEqual([]);
  });
});

describe("removedLabel", () => {
  it("counts unnamed tables by their shape and the chairs with them", () => {
    const two = [...createTableGroup(ROUND, 0, 0, 0, 10), ...createTableGroup(ROUND, 4, 0, 0, 10)];
    expect(removedLabel(two)).toBe("2 round tables and 20 chairs");
  });

  it("names a lone piece by its own name, and counts pieces beside furniture", () => {
    const stage = getCatalogueItemBySlug("platform");
    if (stage === undefined) throw new Error("No platform in the catalogue");
    expect(removedLabel([createPlacedItem(stage.id, 0, 0, 0)])).toBe(stage.name);
    expect(removedLabel([...tableThree(), createPlacedItem(stage.id, 6, 0, 0)])).toBe("Table 3, 10 chairs and 1 other piece");
  });
});

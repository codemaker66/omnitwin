import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import { createTableGroup } from "../table-group.js";
import { referenceSceneEntries, referenceSceneSummary } from "../reference-scene-model.js";
import { floorCategoryLabel, floorNames, floorSummaryLine, inFloorNameOrder, withFloorNames } from "../floor-names.js";

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

function shortNames(items: readonly PlacedItem[]): readonly string[] {
  const names = floorNames(items);
  return items.map((item) => names.get(item.id)?.shortLabel ?? "");
}

describe("floorNames", () => {
  const round = catalogueId("round-table-6ft");

  it("numbers tables front to back, then left to right, from 1 and without zero padding", () => {
    const backLeft = createPlacedItem(round, -3, 5);
    const frontRight = createPlacedItem(round, 3, 0.3);
    const frontLeft = createPlacedItem(round, -3, 0);
    expect(shortNames([backLeft, frontRight, frontLeft])).toEqual(["Table 3", "Table 2", "Table 1"]);
  });

  it("gives the same names after a save re-mints the ids and the server returns another order", () => {
    const tables = [createPlacedItem(round, 0, 0), createPlacedItem(round, 4, 0), createPlacedItem(round, 0, 4)];
    const before = shortNames(tables);
    const remapped = [...tables].reverse().map((item, index) => ({ ...item, id: `0000-${String(index)}` }));
    expect(shortNames(remapped)).toEqual([...before].reverse());
  });

  it("keeps an authored name, skips the number it uses, and calls other kinds by their own name", () => {
    const named = { ...createPlacedItem(round, 0, 0), label: "Table 1" };
    const unnamed = createPlacedItem(round, 4, 0);
    const chair = createPlacedItem(catalogueId("banquet-chair"), 9, 9);
    const names = floorNames([named, unnamed, chair]);
    expect(names.get(named.id)).toEqual({ label: "Table 1", shortLabel: "Table 1" });
    expect(names.get(unnamed.id)?.shortLabel).toBe("Table 2");
    expect(names.get(chair.id)?.shortLabel).toBe("Chair 1");
    expect([...names.values()].some((name) => /\b0\d/u.test(name.label))).toBe(false);
  });

  it("keeps a table's number while it only moves, so a drag never swaps two names", () => {
    const a = createPlacedItem(round, 0, 0);
    const b = createPlacedItem(round, 4, 0);
    expect(shortNames([a, b])).toEqual(["Table 1", "Table 2"]);
    expect(shortNames([{ ...a, x: 8 }, b])).toEqual(["Table 1", "Table 2"]);
  });
});

describe("floor copy", () => {
  it("pluralises the footer and shows groups to staff only", () => {
    const entries = referenceSceneEntries(createTableGroup(catalogueId("round-table-6ft"), 0, 0, 0, 10));
    const summary = referenceSceneSummary(entries);
    expect(floorSummaryLine(summary, false)).toBe("1 table · 10 chairs");
    expect(floorSummaryLine(summary, true)).toBe("1 table · 10 chairs · 1 group");
    expect(floorSummaryLine({ objects: 0, tables: 0, chairs: 0, groups: 0 }, true)).toBe("0 tables · 0 chairs");
  });

  it("lists rows in name order with numbers counted as numbers", () => {
    const round = catalogueId("round-table-6ft");
    const items = Array.from({ length: 11 }, (_, index) => createPlacedItem(round, index * 3, 0));
    const rows = inFloorNameOrder(withFloorNames(referenceSceneEntries(items), floorNames(items)));
    expect(rows.map((row) => row.shortLabel).slice(0, 3)).toEqual(["Table 1", "Table 2", "Table 3"]);
    expect(rows.at(-1)?.shortLabel).toBe("Table 11");
  });

  it("names a kind in the venue's words", () => {
    expect(floorCategoryLabel("other")).toBe("Other pieces");
    expect(floorCategoryLabel("table")).toBe("Tables");
  });
});

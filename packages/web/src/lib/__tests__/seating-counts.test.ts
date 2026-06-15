import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { createPlacedItem } from "../placement.js";
import { seatingCountsFromPlacedItems } from "../seating-counts.js";

function placedBySlug(slug: string): ReturnType<typeof createPlacedItem> {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`fixture catalogue item missing: ${slug}`);
  return createPlacedItem(item.id, 0, 0, 0);
}

describe("seatingCountsFromPlacedItems", () => {
  it("returns zeroes for an empty layout", () => {
    expect(seatingCountsFromPlacedItems([])).toEqual({
      roundTables: 0,
      banquetTables: 0,
      chairs: 0,
    });
  });

  it("tallies round tables, banquet trestles, and chairs by catalogue category/shape", () => {
    const counts = seatingCountsFromPlacedItems([
      placedBySlug("round-table-6ft"),
      placedBySlug("round-table-6ft"),
      placedBySlug("trestle-6ft"),
      placedBySlug("banquet-chair"),
      placedBySlug("banquet-chair"),
      placedBySlug("banquet-chair"),
    ]);
    expect(counts).toEqual({ roundTables: 2, banquetTables: 1, chairs: 3 });
  });

  it("ignores non-seating objects (stage) and unknown catalogue ids", () => {
    const counts = seatingCountsFromPlacedItems([
      placedBySlug("platform"),
      createPlacedItem("totally-unknown-id", 1, 0, 1),
      placedBySlug("banquet-chair"),
    ]);
    expect(counts).toEqual({ roundTables: 0, banquetTables: 0, chairs: 1 });
  });
});

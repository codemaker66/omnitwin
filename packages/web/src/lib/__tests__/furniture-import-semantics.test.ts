import { afterEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { appliedTableLinenStyle, canApplyTableLinenToItem, effectiveTableLinenStyle, isDiningTableItem } from "../furniture-semantics.js";
import { createPlacedItem } from "../placement.js";
import { seatCapacity } from "../table-group.js";
import { usePlacementStore } from "../../stores/placement-store.js";

function catalogue(slug: string): NonNullable<ReturnType<typeof getCatalogueItemBySlug>> {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing import: ${slug}`);
  return item;
}

afterEach(() => { usePlacementStore.setState({ placedItems: [] }); });

describe("imported table semantics", () => {
  it.each([
    ["trestle-6ft-black", "black"], ["trestle-6ft-white", "white"],
    ["round-table-6ft-black", "black"], ["round-table-6ft-white", "white"],
    ["round-cafe-table-white", "white"], ["square-cafe-table-white", "white"],
    ["ceremony-table", "white"], ["cake-cutting-table", "included"],
  ] as const)("preserves %s included cloth through legacy state and dressing commands", (slug, style) => {
    const item = catalogue(slug);
    const placed = { ...createPlacedItem(item.id, 0, 0), clothed: true, clothStyle: "black" as const };
    expect(canApplyTableLinenToItem(item)).toBe(false);
    expect(appliedTableLinenStyle(item, placed)).toBeNull();
    expect(effectiveTableLinenStyle(item, placed)).toBe(style);
    usePlacementStore.setState({ placedItems: [placed] });
    usePlacementStore.getState().applyTableCloth(new Set([placed.id]), "white");
    usePlacementStore.getState().toggleCloth(placed.id);
    expect(usePlacementStore.getState().placedItems).toEqual([placed]);
  });

  it.each(["cake-cutting-table", "ceremony-table"])("does not turn %s into a dining group", (slug) => {
    const item = catalogue(slug);
    const placed = createPlacedItem(item.id, 0, 0);
    expect(isDiningTableItem(item)).toBe(false);
    expect(seatCapacity(item)).toBe(0);
    usePlacementStore.setState({ placedItems: [placed] });
    usePlacementStore.getState().applyTableSetting(new Set([placed.id]), "dinner");
    expect(usePlacementStore.getState().placedItems).toEqual([placed]);
  });

  it.each(["trestle-6ft", "trestle-6ft-wooden", "round-table-6ft", "poseur-table"])("keeps %s eligible for linen", (slug) => {
    expect(canApplyTableLinenToItem(catalogue(slug))).toBe(true);
  });

  it.each(["round-cafe-table-white", "square-cafe-table-white", "trestle-6ft-black", "round-table-6ft-white"])("retains dining support for %s", (slug) => {
    expect(isDiningTableItem(catalogue(slug))).toBe(true);
    expect(seatCapacity(catalogue(slug))).toBeGreaterThan(0);
  });
});

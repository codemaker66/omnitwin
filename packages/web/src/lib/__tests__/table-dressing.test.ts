import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import {
  selectedTableIds,
  tableClothStyleForCatalogueItem,
  tableDressingTargetIds,
  tableGroupedChairCount,
  tableSettingForCatalogueItem,
} from "../table-dressing.js";
import { createPlacedItem } from "../placement.js";

const blackClothId = getCatalogueItemBySlug("black-table-cloth")?.id ?? "missing-black-cloth";
const whiteClothId = getCatalogueItemBySlug("white-table-cloth")?.id ?? "missing-white-cloth";
const dinnerSettingId = getCatalogueItemBySlug("dinner-place-setting")?.id ?? "missing-dinner-setting";
const tableId = getCatalogueItemBySlug("round-table-6ft")?.id ?? "missing-round-table";
const chairId = getCatalogueItemBySlug("banquet-chair")?.id ?? "missing-chair";

describe("table dressing catalogue helpers", () => {
  it("resolves black and white cloth styles from UUIDs and slugs", () => {
    expect(tableClothStyleForCatalogueItem(blackClothId)).toBe("black");
    expect(tableClothStyleForCatalogueItem("black-table-cloth")).toBe("black");
    expect(tableClothStyleForCatalogueItem(whiteClothId)).toBe("white");
    expect(tableClothStyleForCatalogueItem("white-table-cloth")).toBe("white");
  });

  it("resolves dinner table settings without treating cloths as settings", () => {
    expect(tableSettingForCatalogueItem(dinnerSettingId)).toBe("dinner");
    expect(tableSettingForCatalogueItem("dinner-place-setting")).toBe("dinner");
    expect(tableSettingForCatalogueItem(blackClothId)).toBeNull();
  });
});

describe("table dressing target selection", () => {
  it("targets selected tables before the nearest hovered table", () => {
    const tableA = createPlacedItem(tableId, 0, 0);
    const tableB = createPlacedItem(tableId, 4, 0);
    const chair = createPlacedItem(chairId, 8, 0);
    const placed = [tableA, tableB, chair];

    expect(selectedTableIds(placed, new Set([tableA.id, chair.id]))).toEqual([tableA.id]);
    expect(tableDressingTargetIds(placed, new Set([tableA.id, chair.id]), tableB.id)).toEqual([tableA.id]);
  });

  it("falls back to the nearest table when no selected table exists", () => {
    const table = createPlacedItem(tableId, 0, 0);
    const chair = createPlacedItem(chairId, 4, 0);

    expect(tableDressingTargetIds([table, chair], new Set([chair.id]), table.id)).toEqual([table.id]);
    expect(tableDressingTargetIds([table, chair], new Set([chair.id]), null)).toEqual([]);
  });

  it("counts grouped chairs so dinner settings match the table ring", () => {
    const table = { ...createPlacedItem(tableId, 0, 0), groupId: "g-table" };
    const chairA = { ...createPlacedItem(chairId, 1, 0), groupId: "g-table" };
    const chairB = { ...createPlacedItem(chairId, -1, 0), groupId: "g-table" };
    const looseChair = createPlacedItem(chairId, 4, 0);

    expect(tableGroupedChairCount([table, chairA, chairB, looseChair], table)).toBe(2);
    expect(tableGroupedChairCount([looseChair], looseChair)).toBeUndefined();
  });
});

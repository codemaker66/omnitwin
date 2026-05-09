import { getCatalogueItem } from "./catalogue.js";
import type { PlacedItem, TableClothStyle, TableSettingStyle } from "./placement.js";

export const TABLE_CLOTH_COLORS: Record<TableClothStyle, string> = {
  black: "#11100d",
  white: "#f4efe6",
};

export function tableClothStyleForCatalogueItem(id: string | null): TableClothStyle | null {
  if (id === null) return null;
  const slug = getCatalogueItem(id)?.slug;
  if (slug === "black-table-cloth") return "black";
  if (slug === "white-table-cloth") return "white";
  return null;
}

export function tableSettingForCatalogueItem(id: string | null): TableSettingStyle | null {
  if (id === null) return null;
  return getCatalogueItem(id)?.slug === "dinner-place-setting" ? "dinner" : null;
}

export function isTableDressingCatalogueItem(id: string | null): boolean {
  return tableClothStyleForCatalogueItem(id) !== null || tableSettingForCatalogueItem(id) !== null;
}

export function selectedTableIds(
  placedItems: readonly PlacedItem[],
  selectedIds: ReadonlySet<string>,
): readonly string[] {
  const ids: string[] = [];
  for (const placed of placedItems) {
    if (!selectedIds.has(placed.id)) continue;
    if (getCatalogueItem(placed.catalogueItemId)?.category === "table") ids.push(placed.id);
  }
  return ids;
}

export function tableDressingTargetIds(
  placedItems: readonly PlacedItem[],
  selectedIds: ReadonlySet<string>,
  nearestTableId: string | null,
): readonly string[] {
  const selectedTables = selectedTableIds(placedItems, selectedIds);
  if (selectedTables.length > 0) return selectedTables;
  return nearestTableId === null ? [] : [nearestTableId];
}

export function tableGroupedChairCount(
  placedItems: readonly PlacedItem[],
  table: PlacedItem,
): number | undefined {
  if (table.groupId === null) return undefined;
  let count = 0;
  for (const placed of placedItems) {
    if (placed.id === table.id) continue;
    if (placed.groupId !== table.groupId) continue;
    if (getCatalogueItem(placed.catalogueItemId)?.category === "chair") count += 1;
  }
  return count > 0 ? count : undefined;
}

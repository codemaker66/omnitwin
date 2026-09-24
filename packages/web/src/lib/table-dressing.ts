import { getCatalogueItem } from "./catalogue.js";
import {
  canApplyTableLinenToItem,
  isDiningTableItem,
} from "./furniture-semantics.js";
import type { PlacedItem, TableClothStyle, TableSettingStyle } from "./placement.js";

export const TABLE_CLOTH_COLORS: Record<TableClothStyle, string> = {
  black: "#11100d",
  white: "#f4efe6",
};

const TABLE_DRESSING_APPLICATOR_SLUGS: ReadonlySet<string> = new Set([
  "black-table-cloth",
  "white-table-cloth",
  "dinner-place-setting",
]);

export function isTableDressingApplicatorSlug(slug: string): boolean {
  return TABLE_DRESSING_APPLICATOR_SLUGS.has(slug);
}

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

/**
 * True when a catalogue selection is a contextual table-dressing tool rather
 * than a standalone scene object. Accepts both canonical UUIDs and slugs via
 * `getCatalogueItem`, matching the rest of the placement boundary.
 */
export function isTableDressingApplicator(id: string | null): boolean {
  if (id === null) return false;
  const item = getCatalogueItem(id);
  return item !== undefined && isTableDressingApplicatorSlug(item.slug);
}

/**
 * True when a persisted placement represents physical scene furniture rather
 * than one of the contextual dressing actions. Legacy applicator rows remain
 * in save state; derived scene and operations consumers use this boundary to
 * ignore them without deleting user data.
 */
export function isSceneFurniturePlacement(
  placed: Pick<PlacedItem, "catalogueItemId">,
): boolean {
  return !isTableDressingApplicator(placed.catalogueItemId);
}

export function sceneFurniturePlacements<
  TPlaced extends Pick<PlacedItem, "catalogueItemId">,
>(placedItems: readonly TPlaced[]): readonly TPlaced[] {
  return placedItems.filter(isSceneFurniturePlacement);
}

/** Selected tables that can accept a scene-applied linen overlay. */
export function selectedTableIds(
  placedItems: readonly PlacedItem[],
  selectedIds: ReadonlySet<string>,
): readonly string[] {
  const ids: string[] = [];
  for (const placed of placedItems) {
    if (!selectedIds.has(placed.id)) continue;
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item !== undefined && canApplyTableLinenToItem(item)) ids.push(placed.id);
  }
  return ids;
}

export function selectedDiningTableIds(
  placedItems: readonly PlacedItem[],
  selectedIds: ReadonlySet<string>,
): readonly string[] {
  const ids: string[] = [];
  for (const placed of placedItems) {
    if (!selectedIds.has(placed.id)) continue;
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item !== undefined && isDiningTableItem(item)) ids.push(placed.id);
  }
  return ids;
}

export function tableDressingTargetIds(
  placedItems: readonly PlacedItem[],
  selectedIds: ReadonlySet<string>,
  nearestTableId: string | null,
  target: "linen" | "dinner" = "linen",
): readonly string[] {
  const selectedTables = target === "dinner"
    ? selectedDiningTableIds(placedItems, selectedIds)
    : selectedTableIds(placedItems, selectedIds);
  if (selectedTables.length > 0) return selectedTables;
  if (nearestTableId === null) return [];
  const nearest = placedItems.find((placed) => placed.id === nearestTableId);
  if (nearest === undefined) return [];
  const nearestItem = getCatalogueItem(nearest.catalogueItemId);
  if (nearestItem === undefined || nearestItem.category !== "table") return [];
  if (target === "dinner" && !isDiningTableItem(nearestItem)) return [];
  if (target === "linen" && !canApplyTableLinenToItem(nearestItem)) return [];
  return [nearestTableId];
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

interface GroupChairTally {
  total: number;
  /** Chair rows per id, so an item's count can exclude rows sharing its id. */
  readonly byId: Map<string, number>;
}

/**
 * tableGroupedChairCount for every placed item in one O(n) pass instead of
 * one O(n) scan per item. The map holds exactly the entries — same keys,
 * values and insertion order — that setting each defined count in
 * `placedItems` order would produce.
 */
export function tableGroupedChairCounts(
  placedItems: readonly PlacedItem[],
): ReadonlyMap<string, number> {
  const chairsByGroup = new Map<string, GroupChairTally>();
  for (const placed of placedItems) {
    if (placed.groupId === null) continue;
    if (getCatalogueItem(placed.catalogueItemId)?.category !== "chair") continue;
    let tally = chairsByGroup.get(placed.groupId);
    if (tally === undefined) {
      tally = { total: 0, byId: new Map() };
      chairsByGroup.set(placed.groupId, tally);
    }
    tally.total += 1;
    tally.byId.set(placed.id, (tally.byId.get(placed.id) ?? 0) + 1);
  }

  const counts = new Map<string, number>();
  for (const placed of placedItems) {
    if (placed.groupId === null) continue;
    const tally = chairsByGroup.get(placed.groupId);
    if (tally === undefined) continue;
    const count = tally.total - (tally.byId.get(placed.id) ?? 0);
    if (count > 0) counts.set(placed.id, count);
  }
  return counts;
}

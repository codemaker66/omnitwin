import { getCatalogueItem } from "./catalogue.js";
import {
  tableClothStyleForCatalogueItem,
  tableSettingForCatalogueItem,
} from "./table-dressing.js";

/**
 * True if the selected catalogue item is the table cloth.
 *
 * Catalogue IDs are deterministic UUIDs (introduced in d163801); literal
 * string-equals comparisons against the developer slug silently fail. This
 * helper resolves the UUID to its CatalogueItem and inspects the slug, so
 * cloth dispatch survives any future ID migration.
 */
export function isCloth(id: string | null): boolean {
  return tableClothStyleForCatalogueItem(id) !== null;
}

export function isTableSetting(id: string | null): boolean {
  return tableSettingForCatalogueItem(id) !== null;
}

/**
 * True if the selected catalogue item is one of the poseur tables.
 * Poseur tables skip the chair-count dialog because they have no chairs.
 * Same UUID-vs-slug rationale as `isCloth`.
 */
export function isPoseurTable(id: string | null): boolean {
  if (id === null) return false;
  return getCatalogueItem(id)?.slug.startsWith("poseur-table") ?? false;
}

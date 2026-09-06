import { getCatalogueItem, type CatalogueItem } from "./catalogue.js";
import { expandIdsToGroupMembers, type PlacedItem } from "./placement.js";
import { sceneFurniturePlacements } from "./table-dressing.js";

export interface ReferenceSceneEntry {
  readonly item: PlacedItem;
  readonly catalogue: CatalogueItem | undefined;
  readonly category: string;
  readonly label: string;
  readonly shortLabel: string;
}

export interface ReferenceSceneSummary {
  readonly objects: number;
  readonly tables: number;
  readonly chairs: number;
  readonly groups: number;
}

export function referenceSceneEntries(items: readonly PlacedItem[]): readonly ReferenceSceneEntry[] {
  const ordinals = new Map<string, number>();
  // Generated row labels must survive a server response arriving in a different
  // order. They are display ordinals; explicit authored labels remain intact.
  const ordered = [...sceneFurniturePlacements(items)].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return ordered.map((item) => {
    const catalogue = getCatalogueItem(item.catalogueItemId);
    const category = catalogue?.category ?? "other";
    const ordinal = (ordinals.get(category) ?? 0) + 1;
    ordinals.set(category, ordinal);
    const name = catalogue?.name ?? "Uncatalogued object";
    const authoredLabel = item.label?.trim() ?? "";
    const number = String(ordinal).padStart(2, "0");
    const shortName = category === "table" ? "Table" : category === "chair" ? "Chair" : name;
    return { item, catalogue, category, label: authoredLabel.length > 0 ? authoredLabel : `${name} ${number}`, shortLabel: authoredLabel.length > 0 ? authoredLabel : `${shortName} ${number}` };
  });
}

export function referenceSceneSummary(entries: readonly ReferenceSceneEntry[]): ReferenceSceneSummary {
  return {
    objects: entries.length,
    tables: entries.filter((entry) => entry.category === "table").length,
    chairs: entries.filter((entry) => entry.category === "chair").length,
    groups: new Set(entries.flatMap((entry) => entry.item.groupId === null ? [] : [entry.item.groupId])).size,
  };
}

export function referenceEntryMatches(entry: ReferenceSceneEntry, search: string): boolean {
  const query = search.trim().toLocaleLowerCase("en-GB");
  return query.length === 0 || `${entry.label} ${entry.category} ${entry.catalogue?.name ?? ""}`
    .toLocaleLowerCase("en-GB").includes(query);
}

export function referenceSelection(entries: readonly ReferenceSceneEntry[], ids: ReadonlySet<string>): {
  readonly primary: ReferenceSceneEntry | undefined;
  readonly members: readonly ReferenceSceneEntry[];
  readonly ids: ReadonlySet<string>;
} {
  const selected = entries.filter((entry) => ids.has(entry.item.id));
  const primary = selected.find((entry) => entry.category === "table") ?? selected[0];
  const expanded = expandIdsToGroupMembers(new Set(selected.map((entry) => entry.item.id)), entries.map((entry) => entry.item));
  return { primary, members: entries.filter((entry) => expanded.has(entry.item.id)), ids: expanded };
}

export function referenceCategoryLabel(category: string): string {
  const labels: Readonly<Record<string, string>> = {
    table: "Tables", chair: "Chairs", stage: "Staging", av: "AV", decor: "Decor", other: "Other objects",
  };
  return labels[category] ?? category.charAt(0).toUpperCase() + category.slice(1).replaceAll("-", " ");
}

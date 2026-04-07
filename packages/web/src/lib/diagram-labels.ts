// ---------------------------------------------------------------------------
// Diagram Labels — assigns alphanumeric codes to placed furniture
//
// Maps each PlacedItem to a code (T1, S1, AV1, L1, D1, CH) that matches
// between the floor plan diagram and the manifest table.
// Chairs are NOT individually labelled (too cluttered) — only tables,
// stages, AV, lecterns, and decor get labels.
// ---------------------------------------------------------------------------

import { getCatalogueItem } from "./catalogue.js";

/** A labelled item for the diagram overlay. */
export interface DiagramLabel {
  /** The placed item ID. */
  readonly id: string;
  /** Alphanumeric code (T1, S1, AV1, etc.). */
  readonly code: string;
  /** Position in render space [x, y, z]. */
  readonly position: readonly [number, number, number];
}

/** Category → code prefix mapping (must match manifest-generator.ts). */
const CATEGORY_PREFIX: Readonly<Record<string, string>> = {
  stage: "S",
  table: "T",
  av: "AV",
  lectern: "L",
  decor: "D",
  barrier: "D",
  lighting: "AV",
  other: "D",
};

/** Categories that should NOT get individual labels (too many items). */
const SKIP_LABEL_CATEGORIES = new Set(["chair"]);

/**
 * Generates diagram labels for all placed items.
 * Returns an array of labels with codes and positions.
 * Chairs are excluded — they're too numerous to label individually.
 */
export function generateDiagramLabels(
  placedItems: readonly { readonly id: string; readonly catalogueItemId: string; readonly x: number; readonly y: number; readonly z: number }[],
): readonly DiagramLabel[] {
  const counters: Record<string, number> = {};
  const labels: DiagramLabel[] = [];

  for (const item of placedItems) {
    const catItem = getCatalogueItem(item.catalogueItemId);
    if (catItem === undefined) continue;

    const category = catItem.category;
    if (SKIP_LABEL_CATEGORIES.has(category)) continue;

    const prefix = CATEGORY_PREFIX[category] ?? "D";
    const count = (counters[prefix] ?? 0) + 1;
    counters[prefix] = count;

    labels.push({
      id: item.id,
      code: `${prefix}${String(count)}`,
      position: [item.x, item.y + catItem.height + 0.2, item.z],
    });
  }

  return labels;
}

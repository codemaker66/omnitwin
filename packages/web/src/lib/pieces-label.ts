import { getCatalogueItem } from "./catalogue.js";
import { countLabel } from "./count-label.js";
import type { PlacedItem } from "./placement.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";

/**
 * Some pieces of furniture in a few words, as the planner says them wherever
 * it names more than one: the removal receipt ("Removed Table 3 and 10 chairs
 * · Undo") and the inspector's header for a selection. A lone named table by
 * its name and the rest counted ("Table 3 and 10 chairs", "2 round tables and
 * 20 chairs", "Table 3, 10 chairs and 1 other piece"), a lone piece by its own
 * name ("6ft Trestle Table"). Dressings and unknown pieces are not counted.
 */
export function piecesLabel(pieces: readonly PlacedItem[]): string {
  const tables: { readonly piece: PlacedItem; readonly round: boolean }[] = [];
  let chairs = 0;
  const others: string[] = [];
  for (const piece of pieces) {
    const item = isSceneFurniturePlacement(piece) ? getCatalogueItem(piece.catalogueItemId) : undefined;
    if (item === undefined) continue;
    if (item.category === "table") tables.push({ piece, round: item.tableShape === "round" });
    else if (item.category === "chair") chairs += 1;
    else others.push(item.name);
  }
  const parts: string[] = [];
  const named = tables.length === 1 ? tables[0]?.piece.label?.trim() : undefined;
  if (named !== undefined && named !== "") parts.push(named);
  else if (tables.length > 0) parts.push(countLabel(tables.length, tables.every((table) => table.round) ? "round table" : "table"));
  if (chairs > 0) parts.push(countLabel(chairs, "chair"));
  if (others.length === 1 && parts.length === 0) parts.push(others[0] ?? "");
  else if (others.length > 0) parts.push(countLabel(others.length, "other piece"));
  const last = parts.pop();
  return last === undefined ? "" : parts.length === 0 ? last : `${parts.join(", ")} and ${last}`;
}

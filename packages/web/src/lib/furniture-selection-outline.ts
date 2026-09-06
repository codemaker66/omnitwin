import { toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem, type CatalogueItem } from "./catalogue.js";
import { normalizeFurnitureScale } from "./furniture-scale.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";
import type { PlacedItem } from "./placement.js";

type Point = readonly [number, number];
export interface FurnitureSelectionOutline {
  readonly key: string;
  readonly itemIds: readonly string[];
  readonly position: readonly [number, number, number];
  /** Local XZ outline vertices, represented at the GPU's float32 precision. */
  readonly coordinateKey: string;
}

export const SELECTION_OUTLINE_BRASS = "#c9a85b";
const OUTLINE_LIFT = .02;
const ROUND_SEGMENTS = 64;

/** Selection decoration must never enter the planner's picking intersections. */
export function ignoreSelectionOutlineRaycast(): void { /* no picking surface */ }

function footprint(placed: PlacedItem, item: CatalogueItem, anchor: PlacedItem): Point[] {
  const scale = normalizeFurnitureScale(placed.scale);
  const halfWidth = toRenderSpace(item.width) * scale / 2;
  const halfDepth = toRenderSpace(item.depth) * scale / 2;
  const local: Point[] = item.tableShape === "round"
    ? Array.from({ length: ROUND_SEGMENTS }, (_, index) => {
      const angle = index / ROUND_SEGMENTS * Math.PI * 2;
      return [halfWidth * Math.cos(angle), halfDepth * Math.sin(angle)];
    })
    : [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]];
  const cos = Math.cos(placed.rotationY), sin = Math.sin(placed.rotationY);
  return local.map(([x, z]) => [
    placed.x - anchor.x + x * cos + z * sin,
    placed.z - anchor.z - x * sin + z * cos,
  ]);
}

function cross(origin: Point, a: Point, b: Point): number {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
}

/** Convex envelope of the selected catalogue footprints, with no clearance padding. */
function convexEnvelope(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (values: readonly Point[]) => {
    const result: Point[] = [];
    for (const point of values) {
      while (result.length >= 2) {
        const a = result[result.length - 2], b = result[result.length - 1];
        if (a === undefined || b === undefined || cross(a, b, point) > 0) break;
        result.pop();
      }
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** Fully selected table groups share an envelope; partial selection remains explicit. */
export function furnitureSelectionOutlines(
  items: readonly PlacedItem[], selectedIds: ReadonlySet<string>,
): readonly FurnitureSelectionOutline[] {
  const physical = items.filter(isSceneFurniturePlacement);
  const groups = new Map<string, PlacedItem[]>();
  for (const item of physical) {
    if (item.groupId === null) continue;
    const members = groups.get(item.groupId) ?? [];
    members.push(item);
    groups.set(item.groupId, members);
  }
  const consumed = new Set<string>();
  const outlines: FurnitureSelectionOutline[] = [];
  for (const placed of physical) {
    if (!selectedIds.has(placed.id) || consumed.has(placed.id)) continue;
    const grouped = placed.groupId === null ? undefined : groups.get(placed.groupId);
    const table = grouped?.find((member) => {
      const catalogue = getCatalogueItem(member.catalogueItemId);
      return catalogue !== undefined && isDiningTableItem(catalogue);
    });
    const complete = table !== undefined && grouped !== undefined && grouped.length > 1
      && grouped.every((member) => selectedIds.has(member.id) && getCatalogueItem(member.catalogueItemId) !== undefined);
    const members = complete ? grouped : [placed];
    const anchor = complete ? table : placed;
    const points = members.flatMap((member) => {
      const catalogue = getCatalogueItem(member.catalogueItemId);
      return catalogue === undefined ? [] : footprint(member, catalogue, anchor);
    });
    if (points.length < 3) continue;
    for (const member of members) consumed.add(member.id);
    const contour = complete ? convexEnvelope(points) : points;
    outlines.push({
      key: complete ? `group:${String(placed.groupId)}` : `item:${placed.id}`,
      itemIds: members.map(({ id }) => id),
      position: [anchor.x, Math.min(...members.map(({ y }) => y)) + OUTLINE_LIFT, anchor.z],
      // Stable across uniform translation; only shape changes rebuild the attribute.
      coordinateKey: contour.flatMap(([x, z]) => [Math.fround(x), 0, Math.fround(z)]).join(","),
    });
  }
  return outlines;
}

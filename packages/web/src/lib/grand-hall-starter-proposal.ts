import { GRAND_HALL_RENDER_DIMENSIONS, toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "./catalogue.js";
import {
  createPlacedItem,
  generatePlacedId,
  getPlacementViolations,
  type PlacedItem,
} from "./placement.js";
import { createTableGroup } from "./table-group.js";

// ---------------------------------------------------------------------------
// Grand Hall starter proposal
// ---------------------------------------------------------------------------
//
// This is a real editable starter layout for brand-new public planner drafts,
// not a rendered mockup. Every item is a normal PlacedItem and can be moved,
// grouped, dressed, labelled, saved, or deleted through the existing planner.

interface PointM {
  readonly x: number;
  readonly z: number;
}

const ROUND_TABLE_POINTS_M: readonly PointM[] = [
  { x: -7.3, z: -3.35 },
  { x: -7.3, z: 3.35 },
  { x: -2.45, z: -3.35 },
  { x: -2.45, z: 3.35 },
  { x: 2.4, z: -3.35 },
  { x: 2.4, z: 3.35 },
  { x: 7.15, z: -3.35 },
  { x: 7.15, z: 3.35 },
];

const BANQUET_TABLE_X_M: readonly number[] = [-6.55, -4.7, -2.85, -1, 0.85, 2.7, 4.55, 6.4];
const BANQUET_CHAIR_X_M: readonly number[] = [
  -7.25, -6.4, -5.55, -4.7, -3.85, -3, -2.15, -1.3, -0.45,
  0.4, 1.25, 2.1, 2.95, 3.8, 4.65, 5.5, 6.35, 7.2,
];

function dressTable(item: PlacedItem, clothStyle: "black" | "white" = "white"): PlacedItem {
  return {
    ...item,
    clothed: true,
    clothStyle,
    tableSetting: "dinner",
  };
}

function requiredCatalogueId(slug: string): string | null {
  return getCatalogueItemBySlug(slug)?.id ?? null;
}

function createRoundDiningCluster(
  tableId: string,
  xM: number,
  zM: number,
): readonly PlacedItem[] {
  const cluster = createTableGroup(tableId, toRenderSpace(xM), toRenderSpace(zM), 0, 10, 0);
  return cluster.map((item, index) => index === 0 ? dressTable(item, "white") : item);
}

function createBanquetRow(
  tableId: string,
  chairId: string,
): readonly PlacedItem[] {
  const groupId = generatePlacedId();
  const tables = BANQUET_TABLE_X_M.map((xM) =>
    dressTable(createPlacedItem(tableId, toRenderSpace(xM), 0, 0, groupId, 0), "white"),
  );

  const leftChairs = BANQUET_CHAIR_X_M.map((xM) =>
    createPlacedItem(chairId, toRenderSpace(xM), toRenderSpace(-0.86), Math.PI, groupId, 0),
  );
  const rightChairs = BANQUET_CHAIR_X_M.map((xM) =>
    createPlacedItem(chairId, toRenderSpace(xM), toRenderSpace(0.86), 0, groupId, 0),
  );

  return [...tables, ...leftChairs, ...rightChairs];
}

export function createGrandHallStarterProposal(): readonly PlacedItem[] {
  const roundTableId = requiredCatalogueId("round-table-6ft");
  const trestleTableId = requiredCatalogueId("trestle-6ft");
  const chairId = requiredCatalogueId("banquet-chair");

  if (roundTableId === null || trestleTableId === null || chairId === null) return [];

  return [
    ...createBanquetRow(trestleTableId, chairId),
    ...ROUND_TABLE_POINTS_M.flatMap((point) =>
      createRoundDiningCluster(roundTableId, point.x, point.z),
    ),
  ];
}

export function hasOnlyStarterSafeViolations(items: readonly PlacedItem[]): boolean {
  for (const item of items) {
    const catalogueItem = getCatalogueItem(item.catalogueItemId);
    if (catalogueItem === undefined) return false;
    const groupMembers = new Set(items.filter((other) => other.groupId !== null && other.groupId === item.groupId).map((other) => other.id));
    groupMembers.add(item.id);
    const violations = getPlacementViolations(
      item.x,
      item.z,
      catalogueItem,
      item.rotationY,
      items,
      groupMembers,
      item.y,
      GRAND_HALL_RENDER_DIMENSIONS,
    );
    if (violations.some((violation) => violation.kind === "outside_room")) return false;
  }
  return true;
}

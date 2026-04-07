// ---------------------------------------------------------------------------
// Manifest Generator — converts PlacedObject[] into a structured events sheet
//
// Produces a manifest grouped by SETUP SEQUENCE (not alphabetical):
// 1. Stage / Platforms
// 2. Tables (grouped by type, with chair counts)
// 3. AV Equipment
// 4. Lecterns
// 5. Decor / Misc
//
// Chair aggregation: "T1-T10: 8 chairs each = 80 chairs", not 80 rows.
// ---------------------------------------------------------------------------

import { classifyPosition, type RoomLayout } from "./spatial-classifier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A placed object with its asset info, as stored in the database. */
export interface ManifestObject {
  readonly id: string;
  readonly assetName: string;
  readonly assetCategory: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly rotationY: number;
  /** For tables: how many chairs are grouped with this table. */
  readonly chairCount: number;
  /** Group ID — items sharing a groupId are a table+chairs unit. */
  readonly groupId: string | null;
}

/** A row in the manifest table. */
export interface ManifestRow {
  /** Alphanumeric code (T1, S1, AV1, L1, D1). */
  readonly code: string;
  /** Human-readable item description. */
  readonly item: string;
  /** Quantity. */
  readonly qty: number;
  /** Human-readable position from spatial classifier. */
  readonly position: string;
  /** Optional notes. */
  readonly notes: string;
  /** Setup sequence group for ordering. */
  readonly setupGroup: SetupGroup;
}

/** Summary totals for the bottom row. */
export interface ManifestTotals {
  readonly entries: readonly { readonly item: string; readonly qty: number }[];
  readonly totalChairs: number;
}

/** Setup sequence groups — determines manifest ordering. */
export type SetupGroup =
  | "stage"
  | "table"
  | "av"
  | "lectern"
  | "decor";

/** Full generated manifest. */
export interface Manifest {
  readonly rows: readonly ManifestRow[];
  readonly totals: ManifestTotals;
}

// ---------------------------------------------------------------------------
// Category → setup group mapping
// ---------------------------------------------------------------------------

const CATEGORY_TO_GROUP: Readonly<Record<string, SetupGroup>> = {
  stage: "stage",
  table: "table",
  chair: "table", // chairs are aggregated into table rows
  av: "av",
  lectern: "lectern",
  decor: "decor",
  barrier: "decor",
  lighting: "av",
  other: "decor",
};

/** Setup group ordering (lower = set up first). */
const GROUP_ORDER: Readonly<Record<SetupGroup, number>> = {
  stage: 0,
  table: 1,
  av: 2,
  lectern: 3,
  decor: 4,
};

/** Code prefixes per setup group. */
const CODE_PREFIX: Readonly<Record<SetupGroup, string>> = {
  stage: "S",
  table: "T",
  av: "AV",
  lectern: "L",
  decor: "D",
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generates a manifest from placed objects.
 *
 * Chair aggregation:
 * - Chairs with a groupId matching a table are counted per-table
 * - Ungrouped chairs become standalone rows
 * - Tables show "6ft Round Table with 8 chairs" in the item column
 */
export function generateManifest(
  objects: readonly ManifestObject[],
  room: RoomLayout,
): Manifest {
  if (objects.length === 0) {
    return { rows: [], totals: { entries: [], totalChairs: 0 } };
  }

  // Separate tables, chairs, and everything else
  const tables: ManifestObject[] = [];
  const chairs: ManifestObject[] = [];
  const others: ManifestObject[] = [];

  for (const obj of objects) {
    if (obj.assetCategory === "table") {
      tables.push(obj);
    } else if (obj.assetCategory === "chair") {
      chairs.push(obj);
    } else {
      others.push(obj);
    }
  }

  // Build a map of groupId → chair count for chair aggregation
  const chairsByGroup = new Map<string, number>();
  const ungroupedChairCount = countAndGroupChairs(chairs, chairsByGroup);

  const rows: ManifestRow[] = [];
  const counters: Record<string, number> = {};

  // --- Stage / Platforms ---
  for (const obj of others.filter((o) => categoryGroup(o.assetCategory) === "stage")) {
    const code = nextCode(counters, "stage");
    const spatial = classifyPosition(obj.positionX, obj.positionZ, room);
    rows.push({
      code,
      item: obj.assetName,
      qty: 1,
      position: spatial.description,
      notes: "",
      setupGroup: "stage",
    });
  }

  // --- Tables (with aggregated chair counts) ---
  const tableGroups = groupTablesByType(tables, chairsByGroup, room);
  for (const tg of tableGroups) {
    const code = nextCode(counters, "table");
    rows.push({
      code,
      item: tg.item,
      qty: tg.qty,
      position: tg.position,
      notes: tg.notes,
      setupGroup: "table",
    });
  }

  // Chair summary row (aggregated)
  const totalChairs = sumChairs(chairs);
  if (totalChairs > 0) {
    const perTableSummary = buildChairSummary(tables, chairsByGroup);
    rows.push({
      code: "CH",
      item: "Chairs (total)",
      qty: totalChairs,
      position: "Distributed per table",
      notes: perTableSummary,
      setupGroup: "table",
    });
  }

  // Ungrouped chairs (not attached to any table)
  if (ungroupedChairCount > 0) {
    rows.push({
      code: nextCode(counters, "decor"),
      item: "Standalone chairs",
      qty: ungroupedChairCount,
      position: "Various positions",
      notes: "",
      setupGroup: "table",
    });
  }

  // --- AV Equipment ---
  for (const obj of others.filter((o) => categoryGroup(o.assetCategory) === "av")) {
    const code = nextCode(counters, "av");
    const spatial = classifyPosition(obj.positionX, obj.positionZ, room);
    rows.push({
      code,
      item: obj.assetName,
      qty: 1,
      position: spatial.description,
      notes: "",
      setupGroup: "av",
    });
  }

  // --- Lecterns ---
  for (const obj of others.filter((o) => categoryGroup(o.assetCategory) === "lectern")) {
    const code = nextCode(counters, "lectern");
    const spatial = classifyPosition(obj.positionX, obj.positionZ, room);
    rows.push({
      code,
      item: obj.assetName,
      qty: 1,
      position: spatial.description,
      notes: "",
      setupGroup: "lectern",
    });
  }

  // --- Decor / Misc ---
  for (const obj of others.filter((o) => categoryGroup(o.assetCategory) === "decor")) {
    const code = nextCode(counters, "decor");
    const spatial = classifyPosition(obj.positionX, obj.positionZ, room);
    rows.push({
      code,
      item: obj.assetName,
      qty: 1,
      position: spatial.description,
      notes: "",
      setupGroup: "decor",
    });
  }

  // Sort by setup sequence
  rows.sort((a, b) => GROUP_ORDER[a.setupGroup] - GROUP_ORDER[b.setupGroup]);

  // Build totals
  const totals = buildTotals(objects, totalChairs);

  return { rows, totals };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function categoryGroup(category: string): SetupGroup {
  return CATEGORY_TO_GROUP[category] ?? "decor";
}

function nextCode(counters: Record<string, number>, group: SetupGroup): string {
  const prefix = CODE_PREFIX[group];
  const current = counters[group] ?? 0;
  const next = current + 1;
  counters[group] = next;
  return `${prefix}${String(next)}`;
}

/**
 * Counts chairs per group and returns the count of ungrouped chairs.
 */
function countAndGroupChairs(
  chairs: readonly ManifestObject[],
  chairsByGroup: Map<string, number>,
): number {
  let ungrouped = 0;
  for (const chair of chairs) {
    if (chair.groupId !== null) {
      chairsByGroup.set(chair.groupId, (chairsByGroup.get(chair.groupId) ?? 0) + 1);
    } else {
      ungrouped += 1;
    }
  }
  return ungrouped;
}

function sumChairs(chairs: readonly ManifestObject[]): number {
  return chairs.length;
}

/**
 * Groups tables by type and generates manifest rows.
 * Each table gets its own row with chair count noted.
 */
function groupTablesByType(
  tables: readonly ManifestObject[],
  chairsByGroup: Map<string, number>,
  room: RoomLayout,
): readonly ManifestRow[] {
  const rows: ManifestRow[] = [];
  for (const table of tables) {
    const chairCount = table.groupId !== null ? (chairsByGroup.get(table.groupId) ?? 0) : 0;
    const spatial = classifyPosition(table.positionX, table.positionZ, room);
    const chairSuffix = chairCount > 0 ? ` with ${String(chairCount)} chairs` : "";
    rows.push({
      code: "", // assigned by caller
      item: `${table.assetName}${chairSuffix}`,
      qty: 1,
      position: spatial.description,
      notes: "",
      setupGroup: "table",
    });
  }
  return rows;
}

/**
 * Builds a human-readable chair summary string.
 * E.g., "8 per round table, 6 per trestle"
 */
function buildChairSummary(
  tables: readonly ManifestObject[],
  chairsByGroup: Map<string, number>,
): string {
  // Group by table type → average chairs per table
  const typeChairs = new Map<string, { total: number; count: number }>();
  for (const table of tables) {
    if (table.groupId === null) continue;
    const chairs = chairsByGroup.get(table.groupId) ?? 0;
    if (chairs === 0) continue;
    const entry = typeChairs.get(table.assetName) ?? { total: 0, count: 0 };
    entry.total += chairs;
    entry.count += 1;
    typeChairs.set(table.assetName, entry);
  }

  const parts: string[] = [];
  for (const [typeName, stats] of typeChairs) {
    const avg = Math.round(stats.total / stats.count);
    parts.push(`${String(avg)} per ${typeName}`);
  }
  return parts.length > 0 ? parts.join(", ") : "";
}

/**
 * Builds total counts summary.
 */
function buildTotals(
  objects: readonly ManifestObject[],
  totalChairs: number,
): ManifestTotals {
  // Count by category (excluding chairs — they're aggregated separately)
  const categoryCounts = new Map<string, { name: string; qty: number }>();
  for (const obj of objects) {
    if (obj.assetCategory === "chair") continue;
    const key = obj.assetName;
    const entry = categoryCounts.get(key) ?? { name: key, qty: 0 };
    entry.qty += 1;
    categoryCounts.set(key, entry);
  }

  const entries: { item: string; qty: number }[] = [];
  for (const [, val] of categoryCounts) {
    entries.push({ item: val.name, qty: val.qty });
  }

  return { entries, totalChairs };
}

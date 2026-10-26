import {
  defaultPhaseForCategory,
  SETUP_PHASES,
  type ManifestRowV2,
  type Phase,
  type PhaseZone,
  type RowPosition,
  type SetupPhase,
  type Zone,
} from "@omnitwin/types";
import { classifyZoneV2, zoneSortKey, type RoomDimensions } from "./spatial-classifier-v2.js";

// ---------------------------------------------------------------------------
// Manifest Generator V2 — produces the phase > zone > row hierarchy
//
// Accessory expansion is now driven by a map passed in from the caller
// (loaded from the asset_accessories DB table), NOT a static TypeScript
// lookup. The generator is pure — it has no DB dependency itself.
//
// The caller (hallkeeper-sheet-v2-data.ts) loads the map via one JOIN:
//   asset_accessories LEFT JOIN asset_definitions ON parent_asset_id
// and passes it in keyed by parent asset NAME.
// ---------------------------------------------------------------------------

export interface ManifestObjectV2 {
  readonly id: string;
  readonly assetName: string;
  readonly assetCategory: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly rotationY: number;
  readonly chairCount: number;
  readonly groupId: string | null;
  /**
   * Planner-authored note attached to this specific placement. When the
   * manifest generator aggregates placements into a row, all distinct
   * notes get concatenated into the row's `notes` string. Empty / null
   * = no note.
   */
  readonly notes?: string | null;
  /** The planner's name for this piece ("Table 4"), from metadata.displayLabel. */
  readonly displayLabel?: string | null;
  /** The catalogue footprint and the placement's scale, to size a laid floor. */
  readonly widthM?: number;
  readonly depthM?: number;
  readonly scale?: number;
}

/** One accessory rule, as loaded from the asset_accessories table. */
export interface AccessoryRule {
  readonly name: string;
  readonly category: string;
  readonly quantityPerParent: number;
  readonly phase: SetupPhase;
  readonly afterDepth: number;
}

/** Map from parent asset NAME to its accessory rules. */
export type AccessoryMap = ReadonlyMap<string, readonly AccessoryRule[]>;

interface WorkingRow {
  readonly phase: SetupPhase;
  readonly zone: Zone;
  readonly name: string;
  readonly category: string;
  readonly afterDepth: number;
  readonly isAccessory: boolean;
  qty: number;
  positions: RowPosition[];
  /** Distinct notes collected from the source placements. */
  notes: string[];
  /** The planner's names for the pieces ("Table 4"), and a laid floor's size. */
  labels: string[];
}

export function manifestKey(row: Pick<WorkingRow, "phase" | "zone" | "name" | "afterDepth">): string {
  return `${row.phase}|${row.zone}|${row.name}|${String(row.afterDepth)}`;
}

/**
 * Merge a note from a placement into a row's notes list. Deduplicates
 * exact matches — if five tables all have the same "VIP table" note, we
 * record it once, not five times. Empty / whitespace-only notes are
 * dropped.
 */
function mergeNote(row: WorkingRow, note: string | null | undefined): void {
  if (note === null || note === undefined) return;
  const trimmed = note.trim();
  if (trimmed.length === 0) return;
  if (row.notes.includes(trimmed)) return;
  row.notes.push(trimmed);
}

/**
 * Generate a v2 manifest from placed objects + DB-loaded accessory rules.
 */
export function generateManifestV2(
  objects: readonly ManifestObjectV2[],
  room: RoomDimensions,
  accessories: AccessoryMap,
): {
  phases: Phase[];
  totals: {
    entries: { name: string; category: string; qty: number }[];
    totalRows: number;
    totalItems: number;
  };
} {
  const bucket = new Map<string, WorkingRow>();
  const groups = groupMembers(objects);
  const seating = seatGroupedChairs(groups);
  const floors = laidFloors(groups);

  for (const obj of objects) {
    // A laid floor is one row of its panels, written below.
    if (obj.groupId !== null && floors.has(obj.groupId)) continue;

    const zone = classifyZoneV2(obj.positionX, obj.positionZ, room);
    if (obj.assetCategory === "chair") {
      // A chair seated at a table folds into that table's row. Any other
      // chair (ungrouped, or in a group with no table: a ceremony row someone
      // grouped) is listed as itself, so no chair ever leaves the sheet.
      if (seating.seatedChairs.has(obj.id)) {
        addAccessoriesForItem(bucket, obj, room, accessories);
        continue;
      }
      addRow(bucket, {
        phase: "furniture", zone, name: obj.assetName, category: "chair",
        afterDepth: 0, isAccessory: false, qty: 1, source: obj,
      });
      addAccessoriesForItem(bucket, obj, room, accessories);
      continue;
    }

    const chairCount = seating.chairsAtTable.get(obj.id) ?? 0;
    addRow(bucket, {
      phase: defaultPhaseForCategory(obj.assetCategory),
      zone,
      name: chairCount > 0 ? `${obj.assetName} with ${String(chairCount)} chairs` : obj.assetName,
      category: obj.assetCategory,
      afterDepth: 0,
      isAccessory: false,
      qty: 1,
      source: obj,
    });
    addAccessoriesForItem(bucket, obj, room, accessories);
  }

  // Each laid floor: its panels in one row at the floor's middle, with the
  // floor's size as the crew builds it.
  for (const panels of floors.values()) {
    const middle = {
      x: panels.reduce((sum, panel) => sum + panel.positionX, 0) / panels.length,
      z: panels.reduce((sum, panel) => sum + panel.positionZ, 0) / panels.length,
    };
    const zone = classifyZoneV2(middle.x, middle.z, room);
    const label = laidFloorLabel(panels);
    for (const panel of panels) {
      addRow(bucket, {
        phase: defaultPhaseForCategory(panel.assetCategory), zone, name: panel.assetName,
        category: panel.assetCategory, afterDepth: 0, isAccessory: false, qty: 1, source: panel, label,
      });
      addAccessoriesForItem(bucket, panel, room, accessories);
    }
  }

  return assemblePhases(bucket);
}

function groupMembers(objects: readonly ManifestObjectV2[]): Map<string, ManifestObjectV2[]> {
  const groups = new Map<string, ManifestObjectV2[]>();
  for (const obj of objects) {
    if (obj.groupId === null) continue;
    const members = groups.get(obj.groupId) ?? [];
    members.push(obj);
    groups.set(obj.groupId, members);
  }
  return groups;
}

/**
 * Where each grouped chair is set (release audit hallkeeper-ops-3): at the
 * nearest table in its group, so two tables grouped together each count only
 * their own chairs rather than all of them. A chair in a group with no table
 * is not seated, and is listed as itself. Ties go to the first table by id,
 * so the same layout always gives the same sheet.
 */
function seatGroupedChairs(groups: ReadonlyMap<string, readonly ManifestObjectV2[]>): {
  readonly chairsAtTable: ReadonlyMap<string, number>;
  readonly seatedChairs: ReadonlySet<string>;
} {
  const chairsAtTable = new Map<string, number>();
  const seatedChairs = new Set<string>();
  for (const members of groups.values()) {
    const tables = members.filter((member) => member.assetCategory === "table")
      .sort((a, b) => a.id.localeCompare(b.id));
    if (tables.length === 0) continue;
    for (const chair of members.filter((member) => member.assetCategory === "chair")) {
      let nearest = tables[0];
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const table of tables) {
        const distance = (table.positionX - chair.positionX) ** 2 + (table.positionZ - chair.positionZ) ** 2;
        if (distance < nearestDistance) {
          nearest = table;
          nearestDistance = distance;
        }
      }
      if (nearest === undefined) continue;
      chairsAtTable.set(nearest.id, (chairsAtTable.get(nearest.id) ?? 0) + 1);
      seatedChairs.add(chair.id);
    }
  }
  return { chairsAtTable, seatedChairs };
}

const DANCE_FLOOR_PANEL = /dance\s*floor\s*panel/iu;

/** Groups that are one laid floor: every member a dance-floor panel. */
function laidFloors(groups: ReadonlyMap<string, readonly ManifestObjectV2[]>): Map<string, readonly ManifestObjectV2[]> {
  const floors = new Map<string, readonly ManifestObjectV2[]>();
  for (const [groupId, members] of groups) {
    if (members.length > 0 && members.every((member) => DANCE_FLOOR_PANEL.test(member.assetName))) floors.set(groupId, members);
  }
  return floors;
}

const CENTIMETRES = 100;

/**
 * A laid floor as the crew builds it: "Laid as one floor, 6 × 4 panels,
 * 5.46 × 3.64 m" for a full rectangle of panels, "Laid as one floor" for any
 * other shape. Sizes come from the catalogue footprint and the placement's
 * scale; a quarter turn swaps a panel's width and depth.
 */
function laidFloorLabel(panels: readonly ManifestObjectV2[]): string {
  const cell = (panel: ManifestObjectV2): string => `${String(Math.round(panel.positionX * CENTIMETRES))}|${String(Math.round(panel.positionZ * CENTIMETRES))}`;
  const xs = new Set(panels.map((panel) => Math.round(panel.positionX * CENTIMETRES)));
  const zs = new Set(panels.map((panel) => Math.round(panel.positionZ * CENTIMETRES)));
  if (xs.size * zs.size !== panels.length || new Set(panels.map(cell)).size !== panels.length) return "Laid as one floor";
  const grid = `Laid as one floor, ${String(xs.size)} × ${String(zs.size)} panels`;
  const [first] = panels;
  if (first?.widthM === undefined || first.depthM === undefined) return grid;
  const quarterTurned = Math.abs(Math.sin(first.rotationY)) > 0.5;
  const scale = first.scale ?? 1;
  const alongX = (quarterTurned ? first.depthM : first.widthM) * scale;
  const alongZ = (quarterTurned ? first.widthM : first.depthM) * scale;
  return `${grid}, ${(alongX * xs.size).toFixed(2)} × ${(alongZ * zs.size).toFixed(2)} m`;
}

function addAccessoriesForItem(
  bucket: Map<string, WorkingRow>,
  obj: ManifestObjectV2,
  room: RoomDimensions,
  accessories: AccessoryMap,
): void {
  const rules = accessories.get(obj.assetName);
  if (rules === undefined) return;
  const zone = classifyZoneV2(obj.positionX, obj.positionZ, room);
  for (const acc of rules) {
    // Accessories inherit their parent's note so a "VIP table" tablecloth
    // shows the context too — but they do NOT inherit positions, which
    // would just duplicate markers on the diagram.
    addRow(bucket, {
      phase: acc.phase,
      zone,
      name: acc.name,
      category: acc.category,
      afterDepth: acc.afterDepth,
      isAccessory: true,
      qty: acc.quantityPerParent,
      source: obj,
      skipPosition: true,
    });
  }
}

interface AddRowArgs {
  phase: SetupPhase;
  zone: Zone;
  name: string;
  category: string;
  afterDepth: number;
  isAccessory: boolean;
  qty: number;
  /** The placed object that contributed this row — used for positions + notes. */
  source: ManifestObjectV2;
  /** If true, don't attach position (for accessories). */
  skipPosition?: boolean;
  /** Overrides the source's own name for the row's labels (a laid floor's size). */
  label?: string;
}

/** The label a row takes from one contributing placement. */
function labelOf(args: AddRowArgs): string | null {
  if (args.isAccessory) return null;
  const label = (args.label ?? args.source.displayLabel ?? "").trim();
  return label.length > 0 ? label : null;
}

function addRow(bucket: Map<string, WorkingRow>, args: AddRowArgs): void {
  const key = manifestKey(args);
  const existing = bucket.get(key);
  if (existing === undefined) {
    const row: WorkingRow = {
      phase: args.phase,
      zone: args.zone,
      name: args.name,
      category: args.category,
      afterDepth: args.afterDepth,
      isAccessory: args.isAccessory,
      qty: args.qty,
      positions: [],
      notes: [],
      labels: [],
    };
    if (args.skipPosition !== true) {
      row.positions.push({
        objectId: args.source.id,
        x: args.source.positionX,
        z: args.source.positionZ,
        rotationY: args.source.rotationY,
      });
    }
    mergeNote(row, args.source.notes);
    const label = labelOf(args);
    if (label !== null && !row.labels.includes(label)) row.labels.push(label);
    bucket.set(key, row);
  } else {
    existing.qty += args.qty;
    if (args.skipPosition !== true) {
      existing.positions.push({
        objectId: args.source.id,
        x: args.source.positionX,
        z: args.source.positionZ,
        rotationY: args.source.rotationY,
      });
    }
    mergeNote(existing, args.source.notes);
    const label = labelOf(args);
    if (label !== null && !existing.labels.includes(label)) existing.labels.push(label);
  }
}

function assemblePhases(bucket: Map<string, WorkingRow>): {
  phases: Phase[];
  totals: {
    entries: { name: string; category: string; qty: number }[];
    totalRows: number;
    totalItems: number;
  };
} {
  const byPhase = new Map<SetupPhase, Map<Zone, WorkingRow[]>>();
  for (const row of bucket.values()) {
    let zoneMap = byPhase.get(row.phase);
    if (zoneMap === undefined) {
      zoneMap = new Map();
      byPhase.set(row.phase, zoneMap);
    }
    let rows = zoneMap.get(row.zone);
    if (rows === undefined) {
      rows = [];
      zoneMap.set(row.zone, rows);
    }
    rows.push(row);
  }

  const phases: Phase[] = [];
  for (const phase of SETUP_PHASES) {
    const zoneMap = byPhase.get(phase);
    if (zoneMap === undefined) continue;
    const zones: PhaseZone[] = [];
    const sortedZones = [...zoneMap.entries()].sort(([a], [b]) => zoneSortKey(a) - zoneSortKey(b));
    for (const [zone, rows] of sortedZones) {
      rows.sort((a, b) => {
        if (a.afterDepth !== b.afterDepth) return a.afterDepth - b.afterDepth;
        return a.name.localeCompare(b.name);
      });
      zones.push({
        zone,
        rows: rows.map((r): ManifestRowV2 => ({
          key: manifestKey(r),
          name: r.name,
          category: r.category,
          qty: r.qty,
          afterDepth: r.afterDepth,
          isAccessory: r.isAccessory,
          notes: r.notes.join(" · "),
          positions: [...r.positions],
          ...(r.labels.length > 0 ? { labels: [...r.labels] } : {}),
        })),
      });
    }
    phases.push({ phase, zones });
  }

  const totalsMap = new Map<string, { name: string; category: string; qty: number }>();
  let totalRows = 0;
  let totalItems = 0;
  for (const row of bucket.values()) {
    totalRows += 1;
    totalItems += row.qty;
    const k = `${row.name}|${row.category}`;
    const existing = totalsMap.get(k);
    if (existing === undefined) {
      totalsMap.set(k, { name: row.name, category: row.category, qty: row.qty });
    } else {
      existing.qty += row.qty;
    }
  }

  return {
    phases,
    totals: {
      entries: [...totalsMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      totalRows,
      totalItems,
    },
  };
}

import {
  defaultPhaseForCategory,
  SETUP_PHASES,
  type ManifestRowV2,
  type Phase,
  type PhaseZone,
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
}

export function manifestKey(row: Pick<WorkingRow, "phase" | "zone" | "name" | "afterDepth">): string {
  return `${row.phase}|${row.zone}|${row.name}|${String(row.afterDepth)}`;
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

  const chairsByGroup = new Map<string, number>();
  for (const obj of objects) {
    if (obj.assetCategory === "chair" && obj.groupId !== null) {
      chairsByGroup.set(obj.groupId, (chairsByGroup.get(obj.groupId) ?? 0) + 1);
    }
  }

  for (const obj of objects) {
    if (obj.assetCategory === "chair" && obj.groupId !== null) {
      addAccessoriesForItem(bucket, obj, room, accessories);
      continue;
    }

    const zone = classifyZoneV2(obj.positionX, obj.positionZ, room);
    const parentPhase = defaultPhaseForCategory(obj.assetCategory);
    const chairCount = obj.groupId !== null ? (chairsByGroup.get(obj.groupId) ?? 0) : 0;
    const parentName = chairCount > 0
      ? `${obj.assetName} with ${String(chairCount)} chairs`
      : obj.assetName;

    addRow(bucket, {
      phase: parentPhase,
      zone,
      name: parentName,
      category: obj.assetCategory,
      afterDepth: 0,
      isAccessory: false,
      qty: 1,
    });

    // Expand parent's accessories from the DB-loaded map.
    addAccessoriesForItem(bucket, obj, room, accessories);
  }

  // Ungrouped chairs keep their own row + expand accessories.
  for (const obj of objects) {
    if (obj.assetCategory === "chair" && obj.groupId === null) {
      const zone = classifyZoneV2(obj.positionX, obj.positionZ, room);
      addRow(bucket, {
        phase: "furniture",
        zone,
        name: obj.assetName,
        category: "chair",
        afterDepth: 0,
        isAccessory: false,
        qty: 1,
      });
      addAccessoriesForItem(bucket, obj, room, accessories);
    }
  }

  return assemblePhases(bucket);
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
    addRow(bucket, {
      phase: acc.phase,
      zone,
      name: acc.name,
      category: acc.category,
      afterDepth: acc.afterDepth,
      isAccessory: true,
      qty: acc.quantityPerParent,
    });
  }
}

function addRow(bucket: Map<string, WorkingRow>, row: WorkingRow): void {
  const key = manifestKey(row);
  const existing = bucket.get(key);
  if (existing === undefined) {
    bucket.set(key, { ...row });
  } else {
    existing.qty += row.qty;
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
          notes: "",
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

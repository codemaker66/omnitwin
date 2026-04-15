import {
  accessoriesFor,
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
// Manifest Generator V2 — produces the phase ▸ zone ▸ row hierarchy
//
// The v2 generator takes the same placed-object input as v1 but emits
// the new shape. Each placed object contributes:
//   - ONE parent row in its natural (phase, zone)
//   - ZERO OR MORE accessory rows from the ACCESSORY_RULES lookup,
//     each in the accessory's declared phase and parented into the
//     SAME zone so the hallkeeper only has to walk the room once per
//     phase
//
// Chair aggregation: instead of a separate "CH" row like v1, chairs
// with a groupId are rolled into the parent table's row name
// ("6ft Round Table with 10 chairs") AND contribute a separate
// per-chair accessory expansion (10 sashes) that lands in the dress
// phase of the SAME zone. The hallkeeper sees one table row in
// furniture and one sash row in dress — no hunting.
//
// Keys are stable across re-saves (phase|zone|name|afterDepth), so
// localStorage checkbox state survives a config save round-trip.
// ---------------------------------------------------------------------------

export interface ManifestObjectV2 {
  readonly id: string;
  readonly assetName: string;
  readonly assetCategory: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly rotationY: number;
  /** For table placements: chairs grouped into this table via groupId. */
  readonly chairCount: number;
  /** Group ID — table + chairs share one. */
  readonly groupId: string | null;
}

interface WorkingRow {
  readonly phase: SetupPhase;
  readonly zone: Zone;
  readonly name: string;
  readonly category: string;
  readonly afterDepth: number;
  readonly isAccessory: boolean;
  qty: number;
}

/**
 * Build a stable manifest key. Same (phase, zone, name, depth) across
 * re-saves produces the same key, so checkbox state in localStorage
 * keyed on this string survives a config save.
 */
export function manifestKey(row: Pick<WorkingRow, "phase" | "zone" | "name" | "afterDepth">): string {
  return `${row.phase}|${row.zone}|${row.name}|${String(row.afterDepth)}`;
}

/**
 * Generate a v2 manifest. Returns phases in the fixed
 * structure → furniture → dress → technical → final order, each with
 * zones sorted by walk-order, each with rows sorted by depth then name.
 */
export function generateManifestV2(
  objects: readonly ManifestObjectV2[],
  room: RoomDimensions,
): {
  phases: Phase[];
  totals: {
    entries: { name: string; category: string; qty: number }[];
    totalRows: number;
    totalItems: number;
  };
} {
  // Accumulator keyed on the stable manifest key. Accessories from
  // multiple parents in the same zone collapse here (5 tables in
  // Centre zone → one "Ivory Tablecloth x5" row, not five rows).
  const bucket = new Map<string, WorkingRow>();

  // Tables with groupId get chair counts from placed chairs; we pre-scan
  // so the parent row says "with N chairs" and the per-chair sash
  // accessory multiplies correctly.
  const chairsByGroup = new Map<string, number>();
  for (const obj of objects) {
    if (obj.assetCategory === "chair" && obj.groupId !== null) {
      chairsByGroup.set(obj.groupId, (chairsByGroup.get(obj.groupId) ?? 0) + 1);
    }
  }

  for (const obj of objects) {
    // Chairs attached to a table are aggregated into the table's row;
    // we skip the individual chair rows (but their sashes still come
    // through via the Chiavari Chair accessory expansion below).
    if (obj.assetCategory === "chair" && obj.groupId !== null) {
      // Handled via chairsByGroup on the parent table; emit a per-chair
      // accessory row here so the sash quantity aggregates correctly.
      addAccessoriesForChair(bucket, obj, room);
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

    // Expand the parent's declared accessories (cloth/runner/candles/…).
    // Chair-derived accessories (sashes) come from each grouped chair
    // separately below — the table doesn't know what kind of chair is
    // attached to it, so the chair's own rules drive the expansion.
    for (const acc of accessoriesFor(obj.assetName)) {
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

  // Ungrouped chairs keep their own row + expand their own sash.
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
      addAccessoriesForChair(bucket, obj, room);
    }
  }

  return assemblePhases(bucket);
}

function addAccessoriesForChair(
  bucket: Map<string, WorkingRow>,
  chair: ManifestObjectV2,
  room: RoomDimensions,
): void {
  const zone = classifyZoneV2(chair.positionX, chair.positionZ, room);
  for (const acc of accessoriesFor(chair.assetName)) {
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
  // Group rows by phase, then by zone.
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

  // Assemble in SETUP_PHASES order. Empty phases are skipped — the
  // sheet shouldn't show a phase heading with zero rows under it.
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

  // Totals: one entry per distinct (name, category), sum across zones.
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

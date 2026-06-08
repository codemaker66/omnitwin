// ---------------------------------------------------------------------------
// auto-layout — banquet auto-arrangement engine (planning-grade).
//
// Generates an even grid of tables that fills a room while *provably*
// maintaining a target walkway between every neighbour. It is the generative
// counterpart to the analysis engines: `layout-capacity` answers "how many
// guests fit?" and `circulation` answers "can people walk between the tables?".
// This module answers "lay the tables out for me" — and by construction its
// output never trips the circulation checker (the aisle between axis-aligned
// neighbours is exactly the requested width; the auto-layout test feeds the
// result back through `computeCirculation` to prove it).
//
// Everything here works in METRES on a room-centred origin (the planner scene
// centres the room at 0,0). Multiply X/Z by RENDER_SCALE to land in the scene.
//
// SAFE LANGUAGE: a PLANNING-GRADE arrangement. The aisle width is an
// event-planning comfort target, NOT a legal egress route or fire-code width;
// human review is required before any layout reaches a client.
// ---------------------------------------------------------------------------

import { CIRCULATION_AISLE } from "./circulation.js";

/** An axis-aligned keep-out region (stage, dance floor, dome footprint), metres,
 *  room-centred. The generator places no table whose footprint overlaps it. */
export interface LayoutRect {
  readonly cx: number;
  readonly cz: number;
  readonly width: number;
  readonly depth: number;
}

/** One generated table placement, metres, room-centred. */
export interface BanquetTablePlacement {
  readonly xM: number;
  readonly zM: number;
  readonly rotationY: number;
}

export interface BanquetLayoutOptions {
  /** Interior room width (X) and length (Z), metres. */
  readonly roomWidthM: number;
  readonly roomLengthM: number;
  /** Table footprint, metres. For round tables width === depth === diameter. */
  readonly tableWidthM: number;
  readonly tableDepthM: number;
  /** Seats arranged per table — used to total planned guests. */
  readonly seatsPerTable: number;
  /** Target clear walkway between neighbouring tables, metres. Default: the
   *  comfortable two-way aisle from CIRCULATION_AISLE. */
  readonly aisleM?: number;
  /** Clear band kept between the outermost tables and the walls, metres. */
  readonly wallClearanceM?: number;
  /** Stop adding tables once planned seats reach this many guests. */
  readonly targetGuests?: number;
  /** Hard cap on table count regardless of room size / target. */
  readonly maxTables?: number;
  /** Regions no table may overlap (stage, dance floor, dome), metres room-centred. */
  readonly keepOuts?: readonly LayoutRect[];
}

export interface BanquetLayoutPlan {
  readonly tables: readonly BanquetTablePlacement[];
  readonly tableCount: number;
  readonly seatsPlanned: number;
  /** Grid dimensions the room can hold (before target/keep-out trimming). */
  readonly cols: number;
  readonly rows: number;
  /** The aisle and clearance actually applied (after defaulting), metres. */
  readonly aisleM: number;
  readonly wallClearanceM: number;
  /** Per-table grid cell footprint (table + one aisle), metres. */
  readonly cellWidthM: number;
  readonly cellDepthM: number;
  /** Usable interior after wall clearance, metres. */
  readonly usableWidthM: number;
  readonly usableDepthM: number;
  /** True when no `targetGuests` was set, or the plan reaches it. */
  readonly meetsTarget: boolean;
}

const DEFAULT_WALL_CLEARANCE_M = 0.9;

/** Axis-aligned overlap test between two centred rects (touching edges do not count). */
export function rectsOverlap(a: LayoutRect, b: LayoutRect): boolean {
  return (
    Math.abs(a.cx - b.cx) * 2 < a.width + b.width &&
    Math.abs(a.cz - b.cz) * 2 < a.depth + b.depth
  );
}

/**
 * How many tables fit along one axis given the usable span. `c` tables plus
 * `c - 1` aisles span `c·table + (c-1)·aisle = c·(table+aisle) − aisle`, which
 * must be ≤ usable, so `c ≤ (usable + aisle) / (table + aisle)`.
 */
function axisCount(usableM: number, tableM: number, aisleM: number): number {
  if (usableM < tableM || tableM <= 0) return 0;
  return Math.max(0, Math.floor((usableM + aisleM) / (tableM + aisleM)));
}

/** Centred coordinates for `count` items of `sizeM` stepped by `sizeM + aisleM`. */
function axisCenters(count: number, sizeM: number, aisleM: number): number[] {
  if (count <= 0) return [];
  const step = sizeM + aisleM;
  const span = count * sizeM + (count - 1) * aisleM;
  const start = -span / 2 + sizeM / 2;
  const centers: number[] = [];
  for (let i = 0; i < count; i += 1) centers.push(start + i * step);
  return centers;
}

/**
 * Plan a banquet table grid for a room. Deterministic and pure. Tables are
 * placed row by row outward from the centre column/row so a partial (target-
 * limited) fill stays visually balanced rather than bunching in a corner.
 */
export function planBanquetLayout(options: BanquetLayoutOptions): BanquetLayoutPlan {
  const aisleM = options.aisleM ?? CIRCULATION_AISLE.comfortableM;
  const wallClearanceM = options.wallClearanceM ?? DEFAULT_WALL_CLEARANCE_M;
  const seatsPerTable = Math.max(0, Math.floor(options.seatsPerTable));

  const usableWidthM = Math.max(0, options.roomWidthM - 2 * wallClearanceM);
  const usableDepthM = Math.max(0, options.roomLengthM - 2 * wallClearanceM);

  const cols = axisCount(usableWidthM, options.tableWidthM, aisleM);
  const rows = axisCount(usableDepthM, options.tableDepthM, aisleM);

  const cellWidthM = options.tableWidthM + aisleM;
  const cellDepthM = options.tableDepthM + aisleM;

  const base = {
    cols,
    rows,
    aisleM,
    wallClearanceM,
    cellWidthM,
    cellDepthM,
    usableWidthM,
    usableDepthM,
  } as const;

  if (cols === 0 || rows === 0 || seatsPerTable === 0) {
    return {
      ...base,
      tables: [],
      tableCount: 0,
      seatsPlanned: 0,
      meetsTarget: options.targetGuests === undefined || options.targetGuests <= 0,
    };
  }

  const xs = axisCenters(cols, options.tableWidthM, aisleM);
  const zs = axisCenters(rows, options.tableDepthM, aisleM);

  // How many tables we are allowed to place: room grid, capped by maxTables and
  // by the count needed to reach targetGuests.
  const gridCapacity = cols * rows;
  let limit = options.maxTables !== undefined
    ? Math.min(gridCapacity, Math.max(0, Math.floor(options.maxTables)))
    : gridCapacity;
  if (options.targetGuests !== undefined && options.targetGuests > 0) {
    const tablesForTarget = Math.ceil(options.targetGuests / seatsPerTable);
    limit = Math.min(limit, tablesForTarget);
  }

  // Visit rows/cols ordered by distance from the centre so partial fills stay
  // balanced. Stable: equal distances keep ascending index order.
  const rowOrder = centreOutOrder(rows);
  const colOrder = centreOutOrder(cols);
  const keepOuts = options.keepOuts ?? [];

  const tables: BanquetTablePlacement[] = [];
  outer: for (const r of rowOrder) {
    for (const c of colOrder) {
      if (tables.length >= limit) break outer;
      const xM = xs[c];
      const zM = zs[r];
      if (xM === undefined || zM === undefined) continue;
      const footprint: LayoutRect = { cx: xM, cz: zM, width: options.tableWidthM, depth: options.tableDepthM };
      if (keepOuts.some((k) => rectsOverlap(footprint, k))) continue;
      tables.push({ xM, zM, rotationY: 0 });
    }
  }

  // Re-sort placed tables into reading order (row-major, front-to-back) so the
  // returned list is stable and pleasant to iterate, independent of fill order.
  tables.sort((a, b) => (a.zM - b.zM) || (a.xM - b.xM));

  const seatsPlanned = tables.length * seatsPerTable;
  return {
    ...base,
    tables,
    tableCount: tables.length,
    seatsPlanned,
    meetsTarget:
      options.targetGuests === undefined || options.targetGuests <= 0
        ? true
        : seatsPlanned >= options.targetGuests,
  };
}

/** Indices 0..n-1 ordered by distance from the centre (centre first, then out). */
export function centreOutOrder(n: number): number[] {
  const center = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const da = Math.abs(a - center);
    const db = Math.abs(b - center);
    return da - db || a - b;
  });
}

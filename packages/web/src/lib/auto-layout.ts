// ---------------------------------------------------------------------------
// auto-layout — banquet auto-arrangement engine (planning-grade).
//
// Generates an even arrangement of tables that fills a room while *provably*
// maintaining a target walkway between every neighbour. It is the generative
// counterpart to the analysis engines: `layout-capacity` answers "how many
// guests fit?" and `circulation` answers "can people walk between the tables?".
// This module answers "lay the tables out for me" — and by construction its
// output never trips the circulation checker (the aisle between neighbours is
// at least the requested width; the auto-layout test feeds the result back
// through `computeCirculation` to prove it).
//
// Round table groups (the table and its chairs) are circles, and rounds are
// usually set in staggered rows: each row offset by half a step, so a table
// looks between the two in front of it. For a circle that packs more tables
// at the same clearance than a square grid, so for rounds the engine tries the
// straight grid and staggered rows in both directions, and uses the grid
// whenever it already holds the tables asked for (17 Oct 2026: a 220-guest
// banquet in the Grand Hall placed 8 tables; see placement-store).
//
// Each wall may keep its own band (a gangway along one wall, the planner's
// spacing along another), and a caller may refuse arrangements by a rule of
// its own (`accept`: every table within reach of a gangway): every candidate
// arrangement, each line count included, is offered to it.
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

/** How the tables are set: a straight grid, or rows (along X) or columns
 *  (along Z) each offset by half a step from the last. */
export type BanquetPattern = "grid" | "staggered-rows" | "staggered-columns";

/** The clear band kept between the outermost tables and each wall, metres:
 *  the low and high X walls, and the low and high Z walls. */
export interface WallClearances {
  readonly xMin: number;
  readonly xMax: number;
  readonly zMin: number;
  readonly zMax: number;
}

export interface BanquetLayoutOptions {
  /** Interior room width (X) and length (Z), metres. */
  readonly roomWidthM: number;
  readonly roomLengthM: number;
  /** Table footprint, metres. For round tables width === depth === diameter. */
  readonly tableWidthM: number;
  readonly tableDepthM: number;
  /**
   * The radius of a ROUND table group's footprint (the table and every chair
   * corner), metres. When set the group is a circle: neighbours keep `aisleM`
   * between circles, and staggered rows are tried as well as the grid.
   */
  readonly tableRadiusM?: number;
  /** Seats arranged per table — used to total planned guests. */
  readonly seatsPerTable: number;
  /** Target clear walkway between neighbouring tables, metres. Default: the
   *  comfortable two-way aisle from CIRCULATION_AISLE. */
  readonly aisleM?: number;
  /** Clear band kept between the outermost tables and the walls, metres: one
   *  figure for every wall, or one per wall. */
  readonly wallClearanceM?: number | WallClearances;
  /** Stop adding tables once planned seats reach this many guests. */
  readonly targetGuests?: number;
  /** Hard cap on table count regardless of room size / target. */
  readonly maxTables?: number;
  /** Regions no table may overlap (stage, dance floor, dome), metres room-centred. */
  readonly keepOuts?: readonly LayoutRect[];
  /** Whether a table may stand at its spot, asked of each one the keep-outs leave (a rule judged by its pieces, such as the doors'). */
  readonly admit?: (table: BanquetTablePlacement) => boolean;
  /** A rule of the caller's every arrangement must pass (after keep-outs), or it is not used. */
  readonly accept?: (tables: readonly BanquetTablePlacement[]) => boolean;
}

export interface BanquetLayoutPlan {
  readonly tables: readonly BanquetTablePlacement[];
  readonly tableCount: number;
  readonly seatsPlanned: number;
  /** Grid dimensions the room can hold (before target/keep-out trimming). */
  readonly cols: number;
  readonly rows: number;
  /** The aisle and clearance actually applied (after defaulting), metres;
   *  `wallClearanceM` is the narrowest of the walls' bands. */
  readonly aisleM: number;
  readonly wallClearanceM: number;
  readonly wallClearances: WallClearances;
  /** Per-table grid cell footprint (table + one aisle), metres. */
  readonly cellWidthM: number;
  readonly cellDepthM: number;
  /** Usable interior after wall clearance, metres. */
  readonly usableWidthM: number;
  readonly usableDepthM: number;
  /** True when no `targetGuests` was set, or the plan reaches it. */
  readonly meetsTarget: boolean;
  /** The arrangement the tables were set in. */
  readonly pattern: BanquetPattern;
  /** Tables the room holds at this spacing whatever the target (after keep-outs). */
  readonly capacityTables: number;
}

const DEFAULT_WALL_CLEARANCE_M = 0.9;

/** Floating-point slack for "fits exactly" comparisons, metres. */
const EPS = 1e-9;

/** Axis-aligned overlap test between two centred rects (touching edges do not count). */
export function rectsOverlap(a: LayoutRect, b: LayoutRect): boolean {
  return (
    Math.abs(a.cx - b.cx) * 2 < a.width + b.width &&
    Math.abs(a.cz - b.cz) * 2 < a.depth + b.depth
  );
}

function wallClearancesOf(clearance: number | WallClearances | undefined): WallClearances {
  if (typeof clearance === "object") return clearance;
  const band = clearance ?? DEFAULT_WALL_CLEARANCE_M;
  return { xMin: band, xMax: band, zMin: band, zMax: band };
}

/**
 * How many tables fit along one axis given the usable span. `c` tables plus
 * `c - 1` aisles span `c·table + (c-1)·aisle = c·(table+aisle) − aisle`, which
 * must be ≤ usable, so `c ≤ (usable + aisle) / (table + aisle)`.
 */
function axisCount(usableM: number, tableM: number, aisleM: number): number {
  if (usableM < tableM || tableM <= 0) return 0;
  return Math.max(0, Math.floor((usableM + aisleM) / (tableM + aisleM) + EPS));
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

/** Evenly spread `count` centres across `[-span/2, span/2]`. */
function spreadCenters(count: number, spanM: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const step = spanM / (count - 1);
  return Array.from({ length: count }, (_unused, i) => -spanM / 2 + i * step);
}

interface Point { readonly along: number; readonly across: number }

/**
 * Every staggered arrangement of circles whose centres must stay `d` apart,
 * in a box of centre spans `spanAlong` × `spanAcross`: lines run along
 * `along`, stacked across `across`, each line offset half a step from the
 * last. Two shapes are tried for every line count: alternating long and short
 * lines (k, k−1, …), and equal lines shifted by half a step (k, k, …). Lines
 * are spread to fill the span; a wider step only widens every gap, so
 * spreading keeps the clearance. In order of line count, alternating first.
 */
function staggerArrangements(spanAlong: number, spanAcross: number, d: number): Point[][] {
  if (spanAlong < -EPS || spanAcross <= EPS || d <= 0) return [];
  const along = Math.max(0, spanAlong);
  const found: Point[][] = [];
  // Lines two apart are 2q from each other, so q ≥ d/2.
  const maxLines = Math.floor((2 * spanAcross) / d + EPS) + 1;
  for (let lines = 2; lines <= maxLines; lines += 1) {
    const q = Math.min(spanAcross / (lines - 1), d);
    if (2 * q < d - EPS) continue;
    // Diagonal neighbours: (p/2)² + q² ≥ d².
    const pMin = Math.max(d, 2 * Math.sqrt(Math.max(0, d * d - q * q)));
    const acrossCentres = spreadCenters(lines, spanAcross);

    // Alternating: k on the long lines, k − 1 between them.
    const kLong = Math.floor(along / pMin + EPS) + 1;
    if (kLong >= 2) {
      const longCentres = spreadCenters(kLong, along);
      const step = along / (kLong - 1);
      const shortCentres = longCentres.slice(0, -1).map((value) => value + step / 2);
      const points: Point[] = [];
      acrossCentres.forEach((acrossM, index) => {
        for (const alongM of index % 2 === 0 ? longCentres : shortCentres) points.push({ along: alongM, across: acrossM });
      });
      found.push(points);
    }

    // Shifted: k on every line, alternate lines half a step along.
    const kEqual = Math.floor(along / pMin + 0.5 + EPS);
    if (kEqual >= 1) {
      const step = along / (kEqual - 0.5);
      const first = Array.from({ length: kEqual }, (_unused, i) => -along / 2 + i * step);
      const second = first.map((value) => value + step / 2);
      const points: Point[] = [];
      acrossCentres.forEach((acrossM, index) => {
        for (const alongM of index % 2 === 0 ? first : second) points.push({ along: alongM, across: acrossM });
      });
      found.push(points);
    }
  }
  return found;
}

/** The candidate holding the most tables (the first, on a tie). */
function most(candidates: readonly (readonly BanquetTablePlacement[])[]): readonly BanquetTablePlacement[] {
  let best: readonly BanquetTablePlacement[] = [];
  for (const candidate of candidates) if (candidate.length > best.length) best = candidate;
  return best;
}

/** Distance from the room centre, with a stable tie-break, so a partial fill
 *  is balanced about the middle of the room. */
function centreOutCompare(a: BanquetTablePlacement, b: BanquetTablePlacement): number {
  const da = Math.hypot(a.xM, a.zM);
  const db = Math.hypot(b.xM, b.zM);
  if (Math.abs(da - db) > 1e-6) return da - db;
  return (Math.abs(a.zM) - Math.abs(b.zM)) || (Math.abs(a.xM) - Math.abs(b.xM)) || (a.zM - b.zM) || (a.xM - b.xM);
}

/**
 * Plan a banquet table arrangement for a room. Deterministic and pure. A
 * partial (target-limited) fill takes the tables nearest the centre of the
 * room, so it stays visually balanced rather than bunching in a corner.
 */
export function planBanquetLayout(options: BanquetLayoutOptions): BanquetLayoutPlan {
  const aisleM = options.aisleM ?? CIRCULATION_AISLE.comfortableM;
  const walls = wallClearancesOf(options.wallClearanceM);
  const wallClearanceM = Math.min(walls.xMin, walls.xMax, walls.zMin, walls.zMax);
  const seatsPerTable = Math.max(0, Math.floor(options.seatsPerTable));
  const radiusM = options.tableRadiusM !== undefined && options.tableRadiusM > 0 ? options.tableRadiusM : null;

  // A round group is a circle; its square bounds stand in for it on the grid.
  const sizeX = radiusM === null ? options.tableWidthM : Math.max(options.tableWidthM, 2 * radiusM);
  const sizeZ = radiusM === null ? options.tableDepthM : Math.max(options.tableDepthM, 2 * radiusM);

  const usableWidthM = Math.max(0, options.roomWidthM - walls.xMin - walls.xMax);
  const usableDepthM = Math.max(0, options.roomLengthM - walls.zMin - walls.zMax);
  // The usable floor's centre: off the room's when the walls keep different bands.
  const offsetX = (walls.xMin - walls.xMax) / 2;
  const offsetZ = (walls.zMin - walls.zMax) / 2;

  const cols = axisCount(usableWidthM, sizeX, aisleM);
  const rows = axisCount(usableDepthM, sizeZ, aisleM);

  const cellWidthM = sizeX + aisleM;
  const cellDepthM = sizeZ + aisleM;

  const base = {
    cols,
    rows,
    aisleM,
    wallClearanceM,
    wallClearances: walls,
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
      pattern: "grid",
      capacityTables: 0,
    };
  }

  const keepOuts = options.keepOuts ?? [];
  const admit = options.admit;
  const clear = (t: BanquetTablePlacement): boolean => {
    const footprint: LayoutRect = { cx: t.xM, cz: t.zM, width: sizeX, depth: sizeZ };
    return !keepOuts.some((k) => rectsOverlap(footprint, k)) && (admit === undefined || admit(t));
  };
  const accept = options.accept;
  /** An arrangement as it would be placed: keep-outs cleared, or nothing if the caller refuses it. */
  const usable = (tables: readonly BanquetTablePlacement[]): readonly BanquetTablePlacement[] => {
    const kept = tables.filter(clear);
    return accept === undefined || accept(kept) ? kept : [];
  };

  // The full grid first; with fewer rows or columns after it, for a caller's rule to choose from.
  const gridOf = (colCount: number, rowCount: number): BanquetTablePlacement[] => {
    const xs = axisCenters(colCount, sizeX, aisleM);
    const zs = axisCenters(rowCount, sizeZ, aisleM);
    const placed: BanquetTablePlacement[] = [];
    for (const zM of zs) for (const xM of xs) placed.push({ xM: xM + offsetX, zM: zM + offsetZ, rotationY: 0 });
    return placed;
  };
  const gridCandidates = [gridOf(cols, rows)];
  if (accept !== undefined) {
    for (let r = rows - 1; r >= 1; r -= 1) gridCandidates.push(gridOf(cols, r));
    for (let c = cols - 1; c >= 1; c -= 1) gridCandidates.push(gridOf(c, rows));
  }
  const arrangements: { readonly pattern: BanquetPattern; readonly tables: readonly BanquetTablePlacement[] }[] = [
    { pattern: "grid", tables: most(gridCandidates.map(usable)) },
  ];
  if (radiusM !== null) {
    const d = 2 * radiusM + aisleM;
    const spanX = usableWidthM - 2 * radiusM;
    const spanZ = usableDepthM - 2 * radiusM;
    arrangements.push({
      pattern: "staggered-rows",
      tables: most(staggerArrangements(spanX, spanZ, d).map((points) => usable(
        points.map((p) => ({ xM: p.along + offsetX, zM: p.across + offsetZ, rotationY: 0 })),
      ))),
    });
    arrangements.push({
      pattern: "staggered-columns",
      tables: most(staggerArrangements(spanZ, spanX, d).map((points) => usable(
        points.map((p) => ({ xM: p.across + offsetX, zM: p.along + offsetZ, rotationY: 0 })),
      ))),
    });
  }

  // How many tables we are allowed to place: capped by maxTables and by the
  // count needed to reach targetGuests.
  let wanted = Number.POSITIVE_INFINITY;
  if (options.maxTables !== undefined) wanted = Math.max(0, Math.floor(options.maxTables));
  if (options.targetGuests !== undefined && options.targetGuests > 0) {
    wanted = Math.min(wanted, Math.ceil(options.targetGuests / seatsPerTable));
  }

  // The straight grid when it already holds what is wanted; otherwise the
  // arrangement that holds the most (the grid first on a tie).
  let chosen = arrangements[0] ?? { pattern: "grid" as const, tables: [] };
  let capacityTables = chosen.tables.length;
  for (const candidate of arrangements) {
    capacityTables = Math.max(capacityTables, candidate.tables.length);
    if (chosen.tables.length < wanted && candidate.tables.length > chosen.tables.length) chosen = candidate;
  }

  const limit = Math.min(chosen.tables.length, wanted);
  const tables = [...chosen.tables].sort(centreOutCompare).slice(0, limit);
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
    pattern: chosen.pattern,
    capacityTables,
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

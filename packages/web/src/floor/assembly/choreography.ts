// ---------------------------------------------------------------------------
// Grand Assembly choreography: from a saved layout to an ordered plan.
//
// The reveal is generated, never authored per layout (goal 03, S6):
//
//   1. a deterministic layout diff, here from an empty room to the saved
//      layout, so every piece is "arriving";
//   2. a choreography graph over the arriving pieces: the anchor (the top
//      table) first, the other tables in waves outward from it, each table's
//      chairs after their table, then the dressing (candles) after the last
//      chair has started.
//
// Times come from the graph, never from the frame clock. Small offsets come
// from a seeded hash of each piece's id, so the same layout and seed always
// give the same plan, whatever order the pieces were saved in.
// ---------------------------------------------------------------------------

import type { PlacedItem } from "../../lib/placement.js";

export type AssemblyDirection = "accio" | "procession" | "unfolding";
export const ASSEMBLY_DIRECTIONS: readonly AssemblyDirection[] = ["accio", "procession", "unfolding"];

export function isAssemblyDirection(value: string | null | undefined): value is AssemblyDirection {
  return value === "accio" || value === "procession" || value === "unfolding";
}

export type PieceRole = "table" | "chair" | "piece";

/** What the choreography needs to know about a catalogue piece. */
export interface PieceDescription {
  readonly role: PieceRole;
  /** Height of the piece as drawn (catalogue height times its scale), metres. */
  readonly height: number;
  /** Half its larger plan dimension, metres. */
  readonly radius: number;
}

/** Describes a placed item, or returns null for rows that are not drawn furniture. */
export type DescribePiece = (item: PlacedItem) => PieceDescription | null;

/** One arriving piece: its saved (true) transform and its place in the layout. */
export interface AssemblyPiece {
  readonly id: string;
  readonly role: PieceRole;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotationY: number;
  readonly scale: number;
  readonly height: number;
  readonly radius: number;
  /** A chair's table (same group), or null. */
  readonly tableId: string | null;
  /** A chair's place round its table, 0-based by angle; -1 for other pieces. */
  readonly seat: number;
  /** How many chairs its table has (for chairs and tables), else 0. */
  readonly seats: number;
}

export interface LayoutDiff {
  /** In the target, not the source. */
  readonly arriving: readonly AssemblyPiece[];
  /** In the source, not the target (ids). */
  readonly leaving: readonly string[];
  /** In both, with a different transform (ids). */
  readonly moving: readonly string[];
  /** In both, unchanged (ids). */
  readonly unchanged: readonly string[];
}

function sameTransform(a: PlacedItem, b: PlacedItem): boolean {
  return a.catalogueItemId === b.catalogueItemId && a.x === b.x && a.y === b.y && a.z === b.z
    && a.rotationY === b.rotationY && (a.scale ?? 1) === (b.scale ?? 1);
}

/**
 * The difference between two saved layouts, by id. Grand Assembly diffs the
 * empty room against the saved layout; Transformation Assembly (S7) will diff
 * two versions with the same function.
 */
export function diffLayouts(from: readonly PlacedItem[], to: readonly PlacedItem[], describe: DescribePiece): LayoutDiff {
  const before = new Map(from.map((item) => [item.id, item]));
  const drawn = to.filter((item) => describe(item) !== null);
  const tables = new Map<string, PlacedItem>();
  for (const item of drawn) {
    if (item.groupId !== null && describe(item)?.role === "table" && !tables.has(item.groupId)) tables.set(item.groupId, item);
  }
  // Chairs are numbered round their table by angle, from the window side (-z) anticlockwise in plan.
  const seatOf = new Map<string, { seat: number; seats: number; tableId: string }>();
  const chairsByTable = new Map<string, PlacedItem[]>();
  for (const item of drawn) {
    if (describe(item)?.role !== "chair" || item.groupId === null) continue;
    const table = tables.get(item.groupId);
    if (table === undefined) continue;
    const list = chairsByTable.get(table.id) ?? [];
    list.push(item);
    chairsByTable.set(table.id, list);
  }
  for (const [tableId, chairs] of chairsByTable) {
    const table = drawn.find((item) => item.id === tableId);
    if (table === undefined) continue;
    const angle = (chair: PlacedItem): number => {
      const raw = Math.atan2(chair.z - table.z, chair.x - table.x) + Math.PI / 2;
      return ((raw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    };
    const ordered = [...chairs].sort((a, b) => angle(a) - angle(b) || (a.id < b.id ? -1 : 1));
    ordered.forEach((chair, seat) => { seatOf.set(chair.id, { seat, seats: ordered.length, tableId }); });
  }
  const arriving: AssemblyPiece[] = [];
  const moving: string[] = [];
  const unchanged: string[] = [];
  for (const item of drawn) {
    const description = describe(item);
    if (description === null) continue;
    const previous = before.get(item.id);
    if (previous !== undefined) {
      (sameTransform(previous, item) ? unchanged : moving).push(item.id);
      continue;
    }
    const seat = seatOf.get(item.id);
    arriving.push({
      id: item.id,
      role: description.role,
      label: (item.label ?? "").trim(),
      x: item.x,
      y: item.y,
      z: item.z,
      rotationY: item.rotationY,
      scale: item.scale ?? 1,
      height: description.height,
      radius: description.radius,
      tableId: seat?.tableId ?? null,
      seat: seat?.seat ?? -1,
      seats: seat?.seats ?? (description.role === "table" ? (chairsByTable.get(item.id)?.length ?? 0) : 0),
    });
  }
  const target = new Set(to.map((item) => item.id));
  const leaving = from.filter((item) => !target.has(item.id)).map((item) => item.id);
  return { arriving, leaving, moving, unchanged };
}

// --- Seeded randomness ------------------------------------------------------

/** FNV-1a, 32 bits. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** One draw in [0, 1) for (seed, id, salt): independent of the order pieces are visited. */
export function pieceRandom(seed: number, id: string, salt: number): number {
  let state = (hashString(id) ^ Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca77)) >>> 0;
  // mulberry32, two rounds.
  for (let round = 0; round < 2; round++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    state = (t ^ (t >>> 14)) >>> 0;
  }
  return state / 4294967296;
}

// --- The graph ----------------------------------------------------------------

export type ChoreoBeat = "anchor" | "table" | "chair" | "piece";

export interface ChoreoNode {
  readonly pieceId: string;
  readonly beat: ChoreoBeat;
  /** Wave index outward from the anchor (0 for the anchor). */
  readonly wave: number;
  /** When the piece starts to move, seconds from the start of the reveal. */
  readonly start: number;
  /** The node this one waits on (a chair waits on its table), or null. */
  readonly after: string | null;
}

export interface ChoreographyGraph {
  readonly seed: number;
  readonly anchorId: string | null;
  /** Every arriving piece once, by start time (ties by id). */
  readonly nodes: readonly ChoreoNode[];
  readonly byPiece: ReadonlyMap<string, ChoreoNode>;
  /** Table ids by wave, nearest the anchor first. */
  readonly waves: readonly (readonly string[])[];
  /** When each table's candles start to light. */
  readonly dressing: ReadonlyMap<string, number>;
}

/** How a direction spaces its beats. Seconds and metres. */
export interface WaveTiming {
  /** The anchor's start. */
  readonly anchorStart: number;
  /** The first table after the anchor. */
  readonly firstWave: number;
  /** How fast the waves travel outward from the anchor, metres a second. */
  readonly waveSpeed: number;
  /** Ring width that makes one wave, metres. */
  readonly waveRing: number;
  /** Seeded scatter added to each table's start, ± seconds. */
  readonly jitter: number;
  /** A chair's first start after its table's. */
  readonly chairDelay: number;
  /** Between consecutive chairs of one table. */
  readonly chairStagger: number;
  /** The dressing's first start after the last chair's. */
  readonly dressingAfter: number;
  /** How fast the dressing ripples outward from the anchor, metres a second. */
  readonly dressingSpeed: number;
}

/**
 * A direction may order its tables itself (the Procession works door by door,
 * far side first, so no piece crosses one already placed): return each
 * table's start, or null to use the waves.
 */
export type TableSchedule = (tables: readonly AssemblyPiece[], anchor: AssemblyPiece | null, timing: WaveTiming) => ReadonlyMap<string, number> | null;

/** Chair order round a table, ascending: by default the seats nearest the anchor first, alternating either way. */
export type SeatOrder = (chair: AssemblyPiece, table: AssemblyPiece, anchor: AssemblyPiece | null) => number;

const TOP_TABLE_LABEL = /^(top table|head table|table 1)$/iu;

/** The anchor: the top table if one is named so, else the first table saved. */
export function chooseAnchor(pieces: readonly AssemblyPiece[]): AssemblyPiece | null {
  const tables = pieces.filter((piece) => piece.role === "table");
  return tables.find((piece) => TOP_TABLE_LABEL.test(piece.label)) ?? tables[0] ?? null;
}

export function angularDistance(a: number, b: number): number {
  const turn = Math.PI * 2;
  const d = (((a - b) % turn) + turn) % turn;
  return Math.min(d, turn - d);
}

/** Seats facing the anchor first, then outward round both sides. */
export const seatsFromAnchor: SeatOrder = (chair, table, anchor) => {
  const toward = anchor === null || anchor.id === table.id
    ? Math.atan2(1, 0)
    : Math.atan2(anchor.z - table.z, anchor.x - table.x);
  return angularDistance(Math.atan2(chair.z - table.z, chair.x - table.x), toward);
};

export interface GraphOptions {
  readonly timing: WaveTiming;
  readonly schedule?: TableSchedule;
  readonly seatOrder?: SeatOrder;
}

export function buildChoreography(pieces: readonly AssemblyPiece[], seed: number, options: GraphOptions): ChoreographyGraph {
  const { timing } = options;
  const seatOrder = options.seatOrder ?? seatsFromAnchor;
  const anchor = chooseAnchor(pieces);
  const tables = pieces.filter((piece) => piece.role === "table");
  const distance = (piece: AssemblyPiece): number => (anchor === null ? 0 : Math.hypot(piece.x - anchor.x, piece.z - anchor.z));
  const scheduled = options.schedule?.(tables, anchor, timing) ?? null;

  const tableStart = new Map<string, number>();
  const waveOf = new Map<string, number>();
  const ordered = [...tables].sort((a, b) => distance(a) - distance(b) || (a.id < b.id ? -1 : 1));
  for (const table of ordered) {
    const d = distance(table);
    const wave = table.id === anchor?.id ? 0 : 1 + Math.floor(d / timing.waveRing);
    waveOf.set(table.id, wave);
    const fromSchedule = scheduled?.get(table.id);
    if (fromSchedule !== undefined) {
      tableStart.set(table.id, fromSchedule);
    } else if (table.id === anchor?.id) {
      tableStart.set(table.id, timing.anchorStart);
    } else {
      const scatter = (pieceRandom(seed, table.id, 1) * 2 - 1) * timing.jitter;
      tableStart.set(table.id, Math.max(timing.anchorStart + 0.05, timing.firstWave + d / timing.waveSpeed + scatter));
    }
  }

  const nodes: ChoreoNode[] = [];
  for (const table of ordered) {
    nodes.push({
      pieceId: table.id,
      beat: table.id === anchor?.id ? "anchor" : "table",
      wave: waveOf.get(table.id) ?? 0,
      start: tableStart.get(table.id) ?? timing.anchorStart,
      after: table.id === anchor?.id || anchor === null ? null : anchor.id,
    });
  }

  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const chairsByTable = new Map<string, AssemblyPiece[]>();
  const loose: AssemblyPiece[] = [];
  for (const piece of pieces) {
    if (piece.role === "table") continue;
    if (piece.role === "chair" && piece.tableId !== null && byId.has(piece.tableId)) {
      const list = chairsByTable.get(piece.tableId) ?? [];
      list.push(piece);
      chairsByTable.set(piece.tableId, list);
    } else {
      loose.push(piece);
    }
  }
  let lastChair = 0;
  for (const [tableId, chairs] of chairsByTable) {
    const table = byId.get(tableId);
    if (table === undefined) continue;
    const start = tableStart.get(tableId) ?? 0;
    const sorted = [...chairs].sort((a, b) => seatOrder(a, table, anchor) - seatOrder(b, table, anchor) || a.seat - b.seat || (a.id < b.id ? -1 : 1));
    sorted.forEach((chair, index) => {
      const chairStart = start + timing.chairDelay + index * timing.chairStagger;
      lastChair = Math.max(lastChair, chairStart);
      nodes.push({ pieceId: chair.id, beat: "chair", wave: waveOf.get(tableId) ?? 0, start: chairStart, after: tableId });
    });
  }
  for (const piece of loose) {
    const scatter = pieceRandom(seed, piece.id, 2) * timing.jitter;
    const start = timing.firstWave + distance(piece) / timing.waveSpeed + scatter;
    lastChair = Math.max(lastChair, start);
    nodes.push({ pieceId: piece.id, beat: "piece", wave: 1 + Math.floor(distance(piece) / timing.waveRing), start, after: anchor?.id ?? null });
  }
  nodes.sort((a, b) => a.start - b.start || (a.pieceId < b.pieceId ? -1 : 1));

  const maxWave = Math.max(0, ...waveOf.values());
  const waves: string[][] = Array.from({ length: maxWave + 1 }, () => []);
  for (const table of ordered) waves[waveOf.get(table.id) ?? 0]?.push(table.id);

  const dressing = new Map<string, number>();
  const dressingStart = lastChair + timing.dressingAfter;
  for (const table of ordered) dressing.set(table.id, dressingStart + distance(table) / timing.dressingSpeed);

  return {
    seed,
    anchorId: anchor?.id ?? null,
    nodes,
    byPiece: new Map(nodes.map((node) => [node.pieceId, node])),
    waves,
    dressing,
  };
}

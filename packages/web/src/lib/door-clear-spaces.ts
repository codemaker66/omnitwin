import { HALL_OPENINGS, HALL_WALLS, wallPoint, type HallOpening, type HallWall } from "../components/grand-hall/hall-spec.js";
import type { LayoutRect } from "./auto-layout.js";

// ---------------------------------------------------------------------------
// Door clear spaces (Blake, 27 Oct 2026: "Keep them clear automatically
// (Recommended)").
//
// Each door keeps a clear space on the floor in front of it. Automatic
// layouts never use it, a piece set down in it slides back out to the nearest
// clear spot, and when that leaves fewer seats the planner says so. A room's
// spaces come from its survey: the Grand Hall's from hall-spec's openings and
// walls. A room whose doors are not recorded has none, and nothing may claim
// its doors were kept clear.
//
// Frame: metres, the planner's room-centred floor (x along the room's width,
// z along its length), which for the Grand Hall is hall-spec's own frame.
//
// This is planning help, worded as such ("Keep the fireplace door clear"),
// never a statement that a layout meets a building or fire standard.
// ---------------------------------------------------------------------------

/** How much floor each door keeps clear. */
export interface DoorClearSpaceFigure {
  /** From the wall face into the room, metres. */
  readonly depthM: number;
  /** Past each side of the clear opening, metres. */
  readonly sideM: number;
  /** Why these figures. */
  readonly basis: string;
}

/**
 * The figure every door keeps. The hall's own fire risk assessment, or the
 * venue's word for a door, replaces it.
 */
export const DOOR_CLEAR_SPACE: DoorClearSpaceFigure = {
  depthM: 1.5,
  sideM: 0.3,
  basis: "Planning figures: 1.5 m in front of the door, room for a wheelchair to turn or two people to pass on the threshold, and 0.3 m past each side, room to reach a leaf's edge. The Grand Hall's leaves all swing outward (hall-spec HALL_DOORS), so no swing is added.",
};

/** An axis-aligned rectangle on the floor, metres, room-centred. */
export interface FloorRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface DoorClearSpace {
  /** The opening's id in the room's survey, such as "door-main". */
  readonly id: string;
  /** The door as staff name it: "the main door". */
  readonly name: string;
  /** The floor kept clear. */
  readonly rect: FloorRect;
  /** The floor direction from the door into the room, a unit (x, z). */
  readonly inward: readonly [number, number];
}

const UNNAMED_DOOR = "the door";

/**
 * The clear space in front of each door among `openings`, from its wall's
 * frame: the door's width and `figure.sideM` either side, from the wall face
 * `figure.depthM` into the room. Windows keep none. A wall that is not
 * square to the room keeps the rectangle's bounds.
 */
export function doorClearSpaces(
  openings: readonly HallOpening[],
  walls: readonly HallWall[],
  names: Readonly<Record<string, string>>,
  figure: DoorClearSpaceFigure = DOOR_CLEAR_SPACE,
): readonly DoorClearSpace[] {
  return openings.filter((opening) => opening.kind === "door").map((opening) => {
    const wall = walls.find((candidate) => candidate.id === opening.wall);
    if (wall === undefined) throw new Error(`Door ${opening.id} is in the ${opening.wall} wall, which the survey does not have`);
    const half = opening.width / 2 + figure.sideM;
    const corners = [
      wallPoint(wall, opening.centre - half, 0),
      wallPoint(wall, opening.centre + half, 0),
      wallPoint(wall, opening.centre + half, 0, figure.depthM),
      wallPoint(wall, opening.centre - half, 0, figure.depthM),
    ];
    const xs = corners.map((corner) => corner[0]);
    const zs = corners.map((corner) => corner[2]);
    return {
      id: opening.id,
      name: names[opening.id] ?? UNNAMED_DOOR,
      rect: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
      inward: [wall.normal[0], wall.normal[2]],
    };
  });
}

/** The Grand Hall's doors as its staff name them. */
export const GRAND_HALL_DOOR_NAMES: Readonly<Record<string, string>> = {
  "door-end": "the end door",
  "door-main": "the main door",
  "door-fireplace": "the fireplace door",
  "door-fire-exit": "the fire exit",
};

/** The Grand Hall's four doors, from the survey (hall-spec). */
export const GRAND_HALL_DOOR_CLEAR_SPACES: readonly DoorClearSpace[] = doorClearSpaces(HALL_OPENINGS, HALL_WALLS, GRAND_HALL_DOOR_NAMES);

/** Rooms whose doors are recorded. A room joins by adding its survey's spaces here. */
const RECORDED_ROOMS: Readonly<Record<string, readonly DoorClearSpace[]>> = {
  "grand-hall": GRAND_HALL_DOOR_CLEAR_SPACES,
};

/** A room's door clear spaces, or null when its doors are not recorded. */
export function roomDoorClearSpaces(room: string | null): readonly DoorClearSpace[] | null {
  return room !== null && Object.hasOwn(RECORDED_ROOMS, room) ? RECORDED_ROOMS[room] ?? null : null;
}

/** The spaces as the layout engines' keep-outs. */
export function doorKeepOuts(spaces: readonly DoorClearSpace[]): readonly LayoutRect[] {
  return spaces.map(({ rect }) => ({
    cx: (rect.minX + rect.maxX) / 2,
    cz: (rect.minZ + rect.maxZ) / 2,
    width: rect.maxX - rect.minX,
    depth: rect.maxZ - rect.minZ,
  }));
}

// ---------------------------------------------------------------------------
// Pieces in the spaces
// ---------------------------------------------------------------------------

/**
 * A piece's footprint on the floor, metres: its centre and its rotated
 * half-extents, as the planner's own overlap rule reads them
 * (placement.ts computeRotatedFootprint).
 */
export interface Footprint {
  readonly x: number;
  readonly z: number;
  readonly halfW: number;
  readonly halfD: number;
}

/** Edges may meet: a footprint must reach this far in to stand in a space, metres. */
const TOUCH_M = 0.001;

function rectsOverlap(a: FloorRect, b: FloorRect): boolean {
  return a.maxX > b.minX + TOUCH_M && a.minX < b.maxX - TOUCH_M
    && a.maxZ > b.minZ + TOUCH_M && a.minZ < b.maxZ - TOUCH_M;
}

function footprintRect(footprint: Footprint, dx = 0, dz = 0): FloorRect {
  return {
    minX: footprint.x + dx - footprint.halfW,
    maxX: footprint.x + dx + footprint.halfW,
    minZ: footprint.z + dz - footprint.halfD,
    maxZ: footprint.z + dz + footprint.halfD,
  };
}

/** Whether a footprint stands in a clear space (meeting its edge does not count). */
export function footprintInSpace(footprint: Footprint, space: DoorClearSpace): boolean {
  return rectsOverlap(footprintRect(footprint), space.rect);
}

/** The spaces any of `footprints` stands in, in the room's order. */
export function spacesEntered(footprints: readonly Footprint[], spaces: readonly DoorClearSpace[]): readonly DoorClearSpace[] {
  return spaces.filter((space) => footprints.some((footprint) => footprintInSpace(footprint, space)));
}

/** The rectangle round several footprints. */
export function footprintBounds(footprints: readonly Footprint[]): FloorRect {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const footprint of footprints) {
    const rect = footprintRect(footprint);
    minX = Math.min(minX, rect.minX);
    maxX = Math.max(maxX, rect.maxX);
    minZ = Math.min(minZ, rect.minZ);
    maxZ = Math.max(maxZ, rect.maxZ);
  }
  return { minX, maxX, minZ, maxZ };
}

// ---------------------------------------------------------------------------
// The slide out
// ---------------------------------------------------------------------------

export interface DoorSlideInput {
  /** The pieces that move together: a table and its chairs, a selection. */
  readonly moving: readonly Footprint[];
  /** Everything else on the floor, avoided where a clear spot nearly as near allows. */
  readonly others: readonly Footprint[];
  readonly spaces: readonly DoorClearSpace[];
  /** The room's interior, metres, room-centred. */
  readonly roomWidthM: number;
  readonly roomLengthM: number;
  /** Move only in whole steps of this (the planner's grid when snapping), or null for any distance. */
  readonly stepM: number | null;
  /**
   * With `stepM`, the point that lands on a grid point (the piece the hand
   * holds), wherever a wall snap had left it. Without it, steps are counted
   * from where the pieces are.
   */
  readonly anchor?: { readonly x: number; readonly z: number };
  /**
   * "prefer" (a hand's drop): the nearest spot clear of the doors, or one clear
   * of the other furniture too if at most DOOR_SLIDE_DETOUR_M further.
   * "require" (moving a saved layout's pieces for it): only a spot clear of
   * both, at most `maxDistanceM` away.
   */
  readonly avoidOthers?: "prefer" | "require";
  readonly maxDistanceM?: number;
}

export type DoorSlide =
  /** Nothing moving stands in a clear space. */
  | { readonly kind: "clear" }
  /** Move everything by (dx, dz): the nearest spot clear of every door. */
  | { readonly kind: "slide"; readonly dx: number; readonly dz: number; readonly doors: readonly DoorClearSpace[] }
  /** No spot in the room clears the doors (the pieces are larger than the free floor). */
  | { readonly kind: "stuck"; readonly doors: readonly DoorClearSpace[] };

/**
 * How much further than the nearest clear spot a slide may go to avoid
 * setting the pieces down on other furniture, metres. Past this the door
 * comes first and the pieces land where the overlap shows.
 */
export const DOOR_SLIDE_DETOUR_M = 1;

/** Other furniture further than this from the moving pieces cannot matter to a slide, metres. */
const OTHERS_REACH_M = 6;

interface Offset { readonly dx: number; readonly dz: number; readonly distance: number }

function uniqueSorted(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * Every offset that can be the nearest clear one: each axis's values come
 * from the edges where a moving footprint just meets a space, another piece
 * or the room's walls, and no move at all. The nearest point outside a union
 * of rectangles lies on such a pair.
 */
function edgeOffsets(input: DoorSlideInput, others: readonly Footprint[], bounds: FloorRect): readonly Offset[] {
  const xs: number[] = [0, -input.roomWidthM / 2 - bounds.minX, input.roomWidthM / 2 - bounds.maxX];
  const zs: number[] = [0, -input.roomLengthM / 2 - bounds.minZ, input.roomLengthM / 2 - bounds.maxZ];
  for (const footprint of input.moving) {
    const own = footprintRect(footprint);
    for (const { rect } of input.spaces) {
      xs.push(rect.minX - own.maxX, rect.maxX - own.minX);
      zs.push(rect.minZ - own.maxZ, rect.maxZ - own.minZ);
    }
  }
  for (const other of others) {
    const rect = footprintRect(other);
    xs.push(rect.minX - bounds.maxX, rect.maxX - bounds.minX);
    zs.push(rect.minZ - bounds.maxZ, rect.maxZ - bounds.minZ);
  }
  const offsets: Offset[] = [];
  for (const dx of uniqueSorted(xs)) for (const dz of uniqueSorted(zs)) offsets.push({ dx, dz, distance: Math.hypot(dx, dz) });
  return offsets;
}

/** Every offset that puts the anchor on a grid point across the room's span. */
function stepOffsets(input: DoorSlideInput, stepM: number): readonly Offset[] {
  const reach = Math.ceil(Math.max(input.roomWidthM, input.roomLengthM) / stepM);
  const toGridX = input.anchor === undefined ? 0 : Math.round(input.anchor.x / stepM) * stepM - input.anchor.x;
  const toGridZ = input.anchor === undefined ? 0 : Math.round(input.anchor.z / stepM) * stepM - input.anchor.z;
  const offsets: Offset[] = [];
  for (let i = -reach; i <= reach; i += 1) {
    for (let j = -reach; j <= reach; j += 1) {
      const dx = toGridX + i * stepM;
      const dz = toGridZ + j * stepM;
      offsets.push({ dx, dz, distance: Math.hypot(dx, dz) });
    }
  }
  return offsets;
}

/**
 * Where pieces standing in a door's clear space go: the nearest spot that
 * clears every door and keeps them in the room, moving them all by one
 * offset so a table keeps its chairs. A spot that also clears the other
 * furniture wins if it is at most DOOR_SLIDE_DETOUR_M further; with
 * `avoidOthers: "require"` only such a spot will do. Ties go straight away
 * from the door first. Pure.
 */
export function slideClearOfDoors(input: DoorSlideInput): DoorSlide {
  const doors = spacesEntered(input.moving, input.spaces);
  if (doors.length === 0 || input.moving.length === 0) return { kind: "clear" };
  const bounds = footprintBounds(input.moving);
  const others = input.others.filter((other) => {
    const rect = footprintRect(other);
    return rect.maxX > bounds.minX - OTHERS_REACH_M && rect.minX < bounds.maxX + OTHERS_REACH_M
      && rect.maxZ > bounds.minZ - OTHERS_REACH_M && rect.minZ < bounds.maxZ + OTHERS_REACH_M;
  });
  const [inX, inZ] = doors[0]?.inward ?? [0, 0];
  const offsets = [...(input.stepM === null ? edgeOffsets(input, others, bounds) : stepOffsets(input, input.stepM))]
    .sort((a, b) => (a.distance - b.distance) || ((b.dx * inX + b.dz * inZ) - (a.dx * inX + a.dz * inZ)) || (a.dz - b.dz) || (a.dx - b.dx));

  const halfW = input.roomWidthM / 2 + 1e-9;
  const halfL = input.roomLengthM / 2 + 1e-9;
  const inRoom = (offset: Offset): boolean => bounds.minX + offset.dx >= -halfW && bounds.maxX + offset.dx <= halfW
    && bounds.minZ + offset.dz >= -halfL && bounds.maxZ + offset.dz <= halfL;
  const clearOfDoors = (offset: Offset): boolean => input.moving.every((footprint) => {
    const rect = footprintRect(footprint, offset.dx, offset.dz);
    return input.spaces.every((space) => !rectsOverlap(rect, space.rect));
  });
  const clearOfOthers = (offset: Offset): boolean => input.moving.every((footprint) => {
    const rect = footprintRect(footprint, offset.dx, offset.dz);
    return others.every((other) => !rectsOverlap(rect, footprintRect(other)));
  });

  const require = input.avoidOthers === "require";
  const maxDistance = input.maxDistanceM ?? Number.POSITIVE_INFINITY;
  let nearest: Offset | null = null;
  for (const offset of offsets) {
    if (offset.distance > maxDistance + 1e-9) break;
    if (!require && nearest !== null && offset.distance > nearest.distance + DOOR_SLIDE_DETOUR_M) break;
    if (!inRoom(offset) || !clearOfDoors(offset)) continue;
    nearest ??= offset;
    if (clearOfOthers(offset)) return { kind: "slide", dx: offset.dx, dz: offset.dz, doors };
  }
  return nearest === null || require ? { kind: "stuck", doors } : { kind: "slide", dx: nearest.dx, dz: nearest.dz, doors };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "the main door", "the main door and the fire exit", "the end door, the main door and the fire exit". */
export function doorNameList(doors: readonly DoorClearSpace[]): string {
  const names = doors.map((door) => door.name);
  const last = names.at(-1) ?? "";
  return names.length <= 1 ? last : `${names.slice(0, -1).join(", ")} and ${last}`;
}

/** The quiet line after a slide: "Kept the fireplace door clear." */
export function keptClearLine(doors: readonly DoorClearSpace[]): string {
  return `Kept ${doorNameList(doors)} clear.`;
}

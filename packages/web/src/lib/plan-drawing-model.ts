import type { SpaceDimensions } from "@omnitwin/types";
import { toRealWorld } from "../constants/scale.js";
import { HALL_OPENINGS, HALL_WALL_THICKNESS, hallWall, isWindow, wallPoint, type HallWallId } from "../components/grand-hall/hall-spec.js";
import { GRAND_HALL_WALL_NAMES, floorOutline, type RoomSide } from "./auto-fill.js";
import { CATALOGUE_CARDS } from "./card-defaults.js";
import { getCatalogueItem, type CatalogueItem } from "./catalogue.js";
import { isPassiveFreestandingAvFloorItem } from "./furniture-semantics.js";
import type { PlacedItem } from "./placement.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";

// ---------------------------------------------------------------------------
// Plan's Drawing (T-674; approved spec §6.3, §7.2): the layout drawn on paper,
// the register for what leaves the building. This module is the drawing's
// geometry and words, pure: the pieces as staff read them on a plan (each
// table with its chairs and its number, the dance floor, the stage), the
// hall's walls, doors, windows and fireplace by the names staff use, and the
// sums that fit the room into the space the chrome leaves.
//
// Space: metres, the planner's room-centred floor frame. x runs the length
// (the fireplace wall at x < 0), z the width (the window wall at z < 0). The
// drawing is set the way Plan's camera looks down on the room: x to the right,
// z down the page, so the window wall is at the top and Model and Drawing
// show the room the same way round. (The visitor's plan, lib/plan-view-drawing,
// also runs +z down the page.)
// ---------------------------------------------------------------------------

export interface DrawnPoint {
  readonly x: number;
  readonly z: number;
}

export type DrawnShape =
  | { readonly kind: "circle"; readonly centre: DrawnPoint; readonly radius: number }
  | { readonly kind: "polygon"; readonly points: readonly DrawnPoint[] };

/** What a piece is on a plan. */
export type DrawnRole = "table" | "chair" | "panel" | "stage" | "piece";

export interface DrawnPiece {
  readonly id: string;
  readonly role: DrawnRole;
  readonly shape: DrawnShape;
  readonly centre: DrawnPoint;
  /** A chair's back, drawn heavier: its edge farthest from its table. Null for anything else. */
  readonly back: readonly [DrawnPoint, DrawnPoint] | null;
}

/** A table with its chairs, a set, a dance floor or a lone piece: what is selected and moved as one. */
export interface DrawnUnit {
  readonly key: string;
  /** The piece the unit is named for: its table, or its first piece. */
  readonly mainId: string;
  readonly pieces: readonly DrawnPiece[];
  /** "Table 7" as written on the layout, a piece's name ("Dance floor", "Lectern"), or null. */
  readonly label: string | null;
  /** A number is the table's own; a name says what the piece is. */
  readonly labelKind: "number" | "name" | null;
  /** A second line under a name: the dance floor's size ("4.6 × 4.6 m"). */
  readonly detail: string | null;
  readonly labelAt: DrawnPoint;
  /** The unit's narrower extent, metres: the label only shows where it fits. */
  readonly span: number;
  readonly chairs: number;
  /** A floor or stage of several panels or decks: its outer edge, drawn heavier than the joints. */
  readonly outline: readonly DrawnPoint[] | null;
}

function cross(o: DrawnPoint, a: DrawnPoint, b: DrawnPoint): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

/** The convex hull of some points (Andrew's monotone chain), anticlockwise. */
export function convexHull(points: readonly DrawnPoint[]): readonly DrawnPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (sorted.length < 3) return sorted;
  const lower: DrawnPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] ?? point, lower[lower.length - 1] ?? point, point) <= 1e-12) lower.pop();
    lower.push(point);
  }
  const upper: DrawnPoint[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2] ?? point, upper[upper.length - 1] ?? point, point) <= 1e-12) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Anything av smaller than this across is set on a table, not stood on the floor. */
const TABLETOP_REACH_M = 0.4;

function roleOf(item: CatalogueItem): DrawnRole {
  if (item.slug === "dancefloor-panel") return "panel";
  if (item.category === "chair") return "chair";
  if (item.category === "table") return "table";
  if (item.category === "stage") return "stage";
  return "piece";
}

/**
 * Whether a piece belongs on a plan. Cloths and place settings are dressing,
 * not pieces; a laptop or a microphone set on a table is not drawn (a mic
 * stand, a screen or a television on the floor is).
 */
function drawable(placed: PlacedItem, item: CatalogueItem): boolean {
  if (!isSceneFurniturePlacement(placed) || item.category === "decor") return false;
  if (item.category !== "av" || isPassiveFreestandingAvFloorItem(item)) return true;
  return Math.max(item.width, item.depth) * (placed.scale ?? 1) >= TABLETOP_REACH_M;
}

function centreOf(points: readonly DrawnPoint[]): DrawnPoint {
  let x = 0;
  let z = 0;
  for (const point of points) {
    x += point.x;
    z += point.z;
  }
  return { x: x / Math.max(1, points.length), z: z / Math.max(1, points.length) };
}

function shapeOf(placed: PlacedItem, item: CatalogueItem): DrawnShape {
  if (item.tableShape === "round") {
    return { kind: "circle", centre: { x: toRealWorld(placed.x), z: toRealWorld(placed.z) }, radius: (item.width * (placed.scale ?? 1)) / 2 };
  }
  // The outline the aisles are measured between (lib/auto-fill floorOutline), so what is drawn is what is measured.
  return { kind: "polygon", points: floorOutline(placed, item) };
}

interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function boundsOf(shapes: readonly DrawnShape[]): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const shape of shapes) {
    const points = shape.kind === "circle"
      ? [{ x: shape.centre.x - shape.radius, z: shape.centre.z - shape.radius }, { x: shape.centre.x + shape.radius, z: shape.centre.z + shape.radius }]
      : shape.points;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
  }
  return { minX, maxX, minZ, maxZ };
}

/** A chair's back: of its outline's edges, the one whose middle lies farthest from its table. */
export function chairBack(points: readonly DrawnPoint[], table: DrawnPoint): readonly [DrawnPoint, DrawnPoint] | null {
  let best: readonly [DrawnPoint, DrawnPoint] | null = null;
  let reach = -Infinity;
  points.forEach((from, index) => {
    const to = points[(index + 1) % points.length];
    if (to === undefined) return;
    const distance = Math.hypot((from.x + to.x) / 2 - table.x, (from.z + to.z) / 2 - table.z);
    if (distance > reach) {
      reach = distance;
      best = [from, to];
    }
  });
  return best;
}

/** The catalogue card a piece belongs to names it ("Lectern", "Poseur"); otherwise the catalogue's own name. */
export function pieceName(item: CatalogueItem): string {
  if (item.slug === "dancefloor-panel") return "Dance floor";
  return CATALOGUE_CARDS.find((card) => card.variants.some((variant) => variant.slug === item.slug))?.name ?? item.name;
}

function tenths(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function nearest(points: readonly DrawnPoint[], to: DrawnPoint): DrawnPoint | null {
  let best: DrawnPoint | null = null;
  let distance = Infinity;
  for (const point of points) {
    const d = Math.hypot(point.x - to.x, point.z - to.z);
    if (d < distance) {
      distance = d;
      best = point;
    }
  }
  return best;
}

/** Stages and floors are drawn first, tables over them, chairs over their tables' edges. */
const ROLE_ORDER: Readonly<Record<DrawnRole, number>> = { stage: 0, panel: 1, piece: 2, table: 3, chair: 4 };

/**
 * The layout as a plan draws it: one unit per table with its chairs, set,
 * dance floor or lone piece (as the caption and the keymap count them), each
 * with its pieces' outlines and its words. A table carries its own number
 * from the layout ("Table 7", `metadata.displayLabel`); an unnumbered table
 * carries none, because the drawing never invents one.
 */
export function drawnUnits(placedItems: readonly PlacedItem[]): readonly DrawnUnit[] {
  const groups = new Map<string, { readonly placed: PlacedItem; readonly item: CatalogueItem }[]>();
  for (const placed of placedItems) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined || !drawable(placed, item)) continue;
    const key = placed.setId ?? placed.groupId ?? placed.id;
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [{ placed, item }]);
    else members.push({ placed, item });
  }

  const units: DrawnUnit[] = [];
  for (const [key, members] of groups) {
    const main = members.find((member) => member.item.category !== "chair") ?? members[0];
    if (main === undefined) continue;
    const tableCentres = members
      .filter((member) => roleOf(member.item) === "table")
      .map((member) => ({ x: toRealWorld(member.placed.x), z: toRealWorld(member.placed.z) }));
    const pieces = members.map(({ placed, item }): DrawnPiece => {
      const role = roleOf(item);
      const shape = shapeOf(placed, item);
      const centre = shape.kind === "circle" ? shape.centre : centreOf(shape.points);
      // A chair's own table is the nearest in its group (a run of trestles has one each side).
      const table = role === "chair" ? nearest(tableCentres, centre) : null;
      const back = table !== null && shape.kind === "polygon" ? chairBack(shape.points, table) : null;
      return { id: placed.id, role, shape, centre, back };
    }).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);

    const bounds = boundsOf(pieces.map((piece) => piece.shape));
    const span = Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    const mainRole = roleOf(main.item);
    const panels = pieces.filter((piece) => piece.role === "panel");
    const labelAt = panels.length > 0
      ? centreOf(panels.map((piece) => piece.centre))
      : pieces.find((piece) => piece.id === main.placed.id)?.centre ?? centreOf(pieces.map((piece) => piece.centre));
    const number = mainRole === "table" ? (main.placed.label ?? "").trim() : "";
    const label = mainRole === "table" ? (number === "" ? null : number) : mainRole === "chair" ? null : pieceName(main.item);
    const decks = pieces.filter((piece) => piece.role === "panel" || piece.role === "stage");
    const outline = decks.length >= 2
      ? convexHull(decks.flatMap((piece) => (piece.shape.kind === "polygon" ? piece.shape.points : [])))
      : null;
    units.push({
      key,
      mainId: main.placed.id,
      pieces,
      label,
      labelKind: label === null ? null : mainRole === "table" ? "number" : "name",
      detail: panels.length > 0 ? `${tenths(bounds.maxX - bounds.minX)} × ${tenths(bounds.maxZ - bounds.minZ)} m` : null,
      labelAt,
      span: Number.isFinite(span) ? span : 0,
      chairs: pieces.filter((piece) => piece.role === "chair").length,
      outline,
    });
  }
  // Stages and floors under everything; tables over them.
  const depth = (unit: DrawnUnit): number => (unit.pieces.some((piece) => piece.role === "stage" || piece.role === "panel") ? 0 : 1);
  return units.sort((a, b) => depth(a) - depth(b));
}

/** In words, for the drawing's accessible name: "8 tables, 80 chairs and a dance floor". */
export function drawingSummary(units: readonly DrawnUnit[]): string {
  const has = (unit: DrawnUnit, role: DrawnRole): boolean => unit.pieces.some((piece) => piece.role === role);
  const tables = units.filter((unit) => has(unit, "table")).length;
  const floors = units.filter((unit) => has(unit, "panel")).length;
  const stages = units.filter((unit) => has(unit, "stage") && !has(unit, "table")).length;
  const loneChairs = units.filter((unit) => unit.pieces.every((piece) => piece.role === "chair")).length;
  const others = units.length - tables - floors - stages - loneChairs;
  const chairs = units.reduce((sum, unit) => sum + unit.chairs, 0);
  const count = (n: number, one: string, many: string): string => (n === 1 ? one : `${String(n)} ${many}`);
  const parts: string[] = [];
  if (tables > 0) parts.push(count(tables, "1 table", "tables"));
  if (chairs > 0) parts.push(count(chairs, "1 chair", "chairs"));
  if (floors > 0) parts.push(count(floors, "a dance floor", "dance floors"));
  if (stages > 0) parts.push(count(stages, "a stage", "stages"));
  if (others > 0) parts.push(count(others, "1 other piece", "other pieces"));
  const last = parts.pop();
  if (last === undefined) return "nothing on the floor yet";
  return parts.length === 0 ? last : `${parts.join(", ")} and ${last}`;
}

// ---------------------------------------------------------------------------
// The room: its walls by name, their doors and windows, and the fireplace.
// ---------------------------------------------------------------------------

export interface DrawnOpening {
  readonly kind: "door" | "window";
  readonly side: RoomSide;
  /** The opening's two jambs on the room's face. */
  readonly from: DrawnPoint;
  readonly to: DrawnPoint;
  /** What staff call it ("Main door", "Fire exit"); windows go unnamed, the wall says them. */
  readonly name: string | null;
}

export interface DrawnWall {
  readonly side: RoomSide;
  /** "Window wall"; null for a room whose walls are not named. */
  readonly name: string | null;
  /** The wall's thickness as surveyed, metres, or the drawing's plain band where none was. */
  readonly thickness: number;
  /** Where along the wall its name sits (x for the long walls, z for the end walls). */
  readonly nameAt: number;
}

export interface DrawnFireplace {
  /** The chimneypiece standing proud of the fireplace wall. */
  readonly surround: readonly DrawnPoint[];
  /** The firebox set back into the wall. */
  readonly firebox: readonly DrawnPoint[];
  readonly labelAt: DrawnPoint;
}

export interface DrawnRoom {
  /** Along x. */
  readonly widthM: number;
  /** Along z. */
  readonly lengthM: number;
  readonly walls: readonly DrawnWall[];
  readonly openings: readonly DrawnOpening[];
  readonly fireplace: DrawnFireplace | null;
}

/** Where a room's walls are not surveyed, the drawing gives them a plain band this thick. */
export const PLAIN_WALL_M = 0.3;

const SIDES: readonly RoomSide[] = ["zMin", "zMax", "xMin", "xMax"];

const HALL_WALL_OF_SIDE: Readonly<Record<RoomSide, HallWallId>> = {
  xMin: "fireplace",
  xMax: "end",
  zMin: "window",
  zMax: "door",
};

/** The hall's doors by the names staff use (hall-doors.ts: the end door into the Saloon, the main door, the fireplace door, the fire exit). */
const DOOR_NAMES: Readonly<Record<string, string>> = {
  "door-end": "End door",
  "door-main": "Main door",
  "door-fireplace": "Fireplace door",
  "door-fire-exit": "Fire exit",
};

/**
 * The chimneypiece, measured for this drawing from the shipped wall relief
 * (public/rooms/grand-hall/survey-2026-07-11/walls-relief.bin, the 11 July
 * 2026 scan) along the fireplace wall, wall-local u, sampled every 0.1 m at
 * 0.1–1.8 m up: the surround stands 0.04–0.09 m proud from u 4.1 to 6.5; the
 * firebox is set 0.2–0.3 m back from u 4.9 to 5.7. Its centre, 5.33 m, is the
 * one hall-geometry.test.ts holds.
 */
export const GRAND_HALL_CHIMNEYPIECE = { from: 4.1, to: 6.5, proud: 0.09, fireboxFrom: 4.9, fireboxTo: 5.7, fireboxDepth: 0.3 } as const;

/** Sentence case for a name that leads a line: "the window wall" → "Window wall". */
function leading(name: string): string {
  const bare = name.replace(/^the /u, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/** A point on a wall's room face, `along` metres along the wall's own run (x for the long walls, z for the ends). */
function onFace(side: RoomSide, along: number, half: DrawnPoint): DrawnPoint {
  switch (side) {
    case "xMin": return { x: -half.x, z: along };
    case "xMax": return { x: half.x, z: along };
    case "zMin": return { x: along, z: -half.z };
    case "zMax": return { x: along, z: half.z };
  }
}

/** Where along its wall a point of the hall's frame falls. */
function alongWall(side: RoomSide, point: readonly [number, number, number]): number {
  return side === "xMin" || side === "xMax" ? point[2] : point[0];
}

/**
 * Where a wall's name sits along it: the middle of the wall when no door is
 * named on it, otherwise the middle of the longest stretch that no door's
 * name (`reach` either side of it) covers, so the two never overlap.
 */
export function freestNameSpot(length: number, taken: readonly number[], reach: number): number {
  if (taken.length === 0) return 0;
  const spans: { readonly from: number; readonly to: number }[] = [];
  let from = -length / 2;
  for (const at of [...taken].sort((a, b) => a - b)) {
    spans.push({ from, to: at - reach });
    from = at + reach;
  }
  spans.push({ from, to: length / 2 });
  const best = spans.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
  return (best.from + best.to) / 2;
}

/** How far either side of a door its name reaches along the wall, metres: room for "Fireplace door" at a working scale. */
const DOOR_NAME_REACH_M = 1.6;

/**
 * The room to draw. `room` is the planner's room in render space (the room
 * store's), which the aisles are measured against. In the Grand Hall the walls
 * carry their names and surveyed thickness, the doors and windows sit where
 * the survey put them, and the fireplace is drawn where the scan measured it;
 * any other room is a plain rectangle with unnamed walls.
 */
export function drawnRoom(room: SpaceDimensions, grandHall: boolean): DrawnRoom {
  const widthM = toRealWorld(room.width);
  const lengthM = toRealWorld(room.length);
  const half = { x: widthM / 2, z: lengthM / 2 };
  if (!grandHall) {
    return { widthM, lengthM, walls: SIDES.map((side) => ({ side, name: null, thickness: PLAIN_WALL_M, nameAt: 0 })), openings: [], fireplace: null };
  }

  const sideOf = (wall: HallWallId): RoomSide => SIDES.find((side) => HALL_WALL_OF_SIDE[side] === wall) ?? "zMin";
  const openings = HALL_OPENINGS.map((opening): DrawnOpening => {
    const side = sideOf(opening.wall);
    const wall = hallWall(opening.wall);
    const a = alongWall(side, wallPoint(wall, opening.centre - opening.width / 2, 0));
    const b = alongWall(side, wallPoint(wall, opening.centre + opening.width / 2, 0));
    return {
      kind: isWindow(opening) ? "window" : "door",
      side,
      from: onFace(side, Math.min(a, b), half),
      to: onFace(side, Math.max(a, b), half),
      name: isWindow(opening) ? null : DOOR_NAMES[opening.id] ?? null,
    };
  });

  const walls = SIDES.map((side): DrawnWall => {
    const across = side === "xMin" || side === "xMax";
    const taken = openings
      .filter((opening) => opening.side === side && opening.name !== null)
      .map((opening) => (across ? (opening.from.z + opening.to.z) / 2 : (opening.from.x + opening.to.x) / 2));
    return {
      side,
      name: leading(GRAND_HALL_WALL_NAMES[side]),
      thickness: HALL_WALL_THICKNESS[HALL_WALL_OF_SIDE[side]].thickness,
      nameAt: freestNameSpot(across ? lengthM : widthM, taken, DOOR_NAME_REACH_M),
    };
  });

  const fireplaceWall = hallWall("fireplace");
  const z = (u: number): number => wallPoint(fireplaceWall, u, 0)[2];
  const piece = GRAND_HALL_CHIMNEYPIECE;
  const face = -half.x;
  return {
    widthM,
    lengthM,
    walls,
    openings,
    fireplace: {
      surround: [
        { x: face, z: z(piece.from) }, { x: face + piece.proud, z: z(piece.from) },
        { x: face + piece.proud, z: z(piece.to) }, { x: face, z: z(piece.to) },
      ],
      firebox: [
        { x: face, z: z(piece.fireboxFrom) }, { x: face - piece.fireboxDepth, z: z(piece.fireboxFrom) },
        { x: face - piece.fireboxDepth, z: z(piece.fireboxTo) }, { x: face, z: z(piece.fireboxTo) },
      ],
      labelAt: { x: face + 0.5, z: z((piece.from + piece.to) / 2) },
    },
  };
}

// ---------------------------------------------------------------------------
// Fitting the drawing to the screen, zoom and the pointer.
// ---------------------------------------------------------------------------

/** Where the drawing may stand, in the stage's pixels. */
export interface DrawingArea {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** screen = origin + scale × floor point; scale is pixels per metre. */
export interface DrawingView {
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
}

/** The paper's own margin round the walls, pixels: room for the walls' names and the doors'. */
export const DRAWING_MARGIN_PX = 30;

/** What is drawn: the room and its walls' thickness. */
export function drawnExtent(room: DrawnRoom): Bounds {
  const thickness = (side: RoomSide): number => room.walls.find((wall) => wall.side === side)?.thickness ?? PLAIN_WALL_M;
  return {
    minX: -room.widthM / 2 - thickness("xMin"),
    maxX: room.widthM / 2 + thickness("xMax"),
    minZ: -room.lengthM / 2 - thickness("zMin"),
    maxZ: room.lengthM / 2 + thickness("zMax"),
  };
}

/** The view that sets the whole drawing in `area`, centred, as large as it will go. */
export function fitView(room: DrawnRoom, area: DrawingArea): DrawingView {
  const extent = drawnExtent(room);
  const width = Math.max(1, area.width - DRAWING_MARGIN_PX * 2);
  const height = Math.max(1, area.height - DRAWING_MARGIN_PX * 2);
  const scale = Math.max(0.01, Math.min(width / (extent.maxX - extent.minX), height / (extent.maxZ - extent.minZ)));
  return {
    scale,
    originX: area.left + area.width / 2 - ((extent.minX + extent.maxX) / 2) * scale,
    originY: area.top + area.height / 2 - ((extent.minZ + extent.maxZ) / 2) * scale,
  };
}

/** Of the places the drawing could stand, the one that draws it largest; null when none has room. */
export function bestArea(room: DrawnRoom, areas: readonly DrawingArea[]): DrawingArea | null {
  let best: DrawingArea | null = null;
  let scale = -Infinity;
  for (const area of areas) {
    if (area.width <= DRAWING_MARGIN_PX * 2 || area.height <= DRAWING_MARGIN_PX * 2) continue;
    const fitted = fitView(room, area).scale;
    if (fitted > scale + 1e-9) {
      scale = fitted;
      best = area;
    }
  }
  return best;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Where the drawing may stand: inside `free` (the stage less its gutters, the
 * dock and any side panel), clear of the slate, either under it or beside it.
 */
export function drawingAreas(free: Rect, slate: Rect | null, gap: number): readonly DrawingArea[] {
  const area = (rect: Rect): DrawingArea => ({ left: rect.left, top: rect.top, width: Math.max(0, rect.right - rect.left), height: Math.max(0, rect.bottom - rect.top) });
  if (slate === null || slate.bottom <= free.top || slate.right <= free.left || slate.left >= free.right) return [area(free)];
  return [
    area({ ...free, top: Math.max(free.top, slate.bottom + gap) }),
    area({ ...free, left: Math.max(free.left, slate.right + gap) }),
  ];
}

export function toScreen(view: DrawingView, point: DrawnPoint): { readonly x: number; readonly y: number } {
  return { x: view.originX + point.x * view.scale, y: view.originY + point.z * view.scale };
}

export function toFloor(view: DrawingView, x: number, y: number): DrawnPoint {
  return { x: (x - view.originX) / view.scale, z: (y - view.originY) / view.scale };
}

/** How far the drawing zooms in past its fit; it never zooms out beyond it. */
export const DRAWING_ZOOM = { min: 1, max: 4 } as const;

/** The view zoomed by `factor` about the screen point (x, y), held between the fit and four times it. */
export function zoomAbout(view: DrawingView, fit: DrawingView, factor: number, x: number, y: number): DrawingView {
  const scale = Math.min(fit.scale * DRAWING_ZOOM.max, Math.max(fit.scale * DRAWING_ZOOM.min, view.scale * factor));
  if (scale <= fit.scale * DRAWING_ZOOM.min + 1e-9) return fit;
  const floor = toFloor(view, x, y);
  return { scale, originX: x - floor.x * scale, originY: y - floor.z * scale };
}

/** The view moved by (dx, dy) pixels; at the fit there is nothing to move. */
export function panBy(view: DrawingView, fit: DrawingView, dx: number, dy: number): DrawingView {
  if (view.scale <= fit.scale + 1e-9) return fit;
  return { ...view, originX: view.originX + dx, originY: view.originY + dy };
}

/** The pieces whose middles lie in the box between two floor points: the area select, as the room's own takes them. */
export function piecesInBox(placedItems: readonly PlacedItem[], a: DrawnPoint, b: DrawnPoint): readonly string[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minZ = Math.min(a.z, b.z);
  const maxZ = Math.max(a.z, b.z);
  return placedItems
    .filter((placed) => {
      if (!isSceneFurniturePlacement(placed)) return false;
      const x = toRealWorld(placed.x);
      const z = toRealWorld(placed.z);
      return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
    })
    .map((placed) => placed.id);
}

/** Up the page is towards the window wall (−z), as Plan's camera has it, so the arrows nudge by the page. */
export const DRAWING_SCREEN_UP: DrawnPoint = { x: 0, z: -1 };

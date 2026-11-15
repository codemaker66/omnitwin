// The gangway review on a room's own floor (lib/auto-fill gangwayReview), held to the slow way
// (walls-the-slow-way.ts): every wall walked a millimetre at a time and measured to every piece of the
// unit, none of it the planner's geometry. Tables with their chairs, the cases the second review of
// audit editor-save-4 found, and a unit carried a centimetre at a time past the rooms' corners.
import type { GangwayReviewItem } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { roomGeometries } from "../../data/room-geometries.js";
import { gangwayReview } from "../auto-fill.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import { plannerRoomOf, type PlannerRoomDimensions } from "../room-floor.js";
import { createTableGroup } from "../table-group.js";
import {
  areaOf,
  insideWalls,
  onOrInside,
  straightWalls,
  unitToWall,
  wayKeepsToFloor,
  type NearestOnWall,
  type Shape,
  type Wall,
  type Walls,
} from "./walls-the-slow-way.js";

const SHAPED_ROOMS = ["Robert Adam Room", "Reception Room", "Saloon"] as const;

/** The guidance a gangway is held to, metres. */
const GUIDANCE = 1.1;
/** A millimetre: the slow way walks a wall a millimetre at a time. */
const MM = 0.001;

function piece(slug: string): CatalogueItem {
  const found = getCatalogueItemBySlug(slug);
  if (found === undefined) throw new Error(`no catalogue item ${slug}`);
  return found;
}

const ROUND = piece("round-table-6ft-white");
const TRESTLE = piece("trestle-6ft");

interface Room {
  readonly walls: Walls;
  /** The walls, each straight wall whole. */
  readonly straight: readonly Wall[];
  readonly dims: PlannerRoomDimensions;
}

function room(name: string): Room {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  return { walls: geometry.wallPolygon, straight: straightWalls(geometry.wallPolygon), dims: plannerRoomOf(geometry.wallPolygon, geometry.ceilingHeight) };
}

/** A placed piece as the slow way takes it: a round table a disc, anything else its box, from the catalogue's size and its turn. */
function shapeOf(placed: PlacedItem): Shape {
  const item = getCatalogueItem(placed.catalogueItemId);
  if (item === undefined) throw new Error("unknown piece");
  if (item.tableShape === "round") return { kind: "disc", x: placed.x, z: placed.z, radius: item.width / 2 };
  return { kind: "box", x: placed.x, z: placed.z, halfW: item.width / 2, halfD: item.depth / 2, turn: placed.rotationY };
}

/** Whether every piece stands inside the walls, none within a centimetre of one. */
function standsInside(shapes: readonly Shape[], walls: Walls, nearest: readonly NearestOnWall[]): boolean {
  for (const shape of shapes) {
    if (!insideWalls(walls, shape.x, shape.z)) return false;
    if (shape.kind === "disc") continue;
    const cos = Math.cos(shape.turn);
    const sin = Math.sin(shape.turn);
    for (const [lx, lz] of [[-shape.halfW, -shape.halfD], [shape.halfW, -shape.halfD], [shape.halfW, shape.halfD], [-shape.halfW, shape.halfD]] as const) {
      if (!insideWalls(walls, shape.x + lx * cos + lz * sin, shape.z - lx * sin + lz * cos)) return false;
    }
  }
  return Math.min(...nearest.map((one) => one.gap)) >= 0.01;
}

type Side = "xMin" | "xMax" | "zMin" | "zMax";

/** The side of the room an item's gangway runs along, from its id (`gangway:<side>:…`, @omnitwin/types gangway-review). */
function sideOf(item: GangwayReviewItem): Side {
  const side = /^gangway:(xMin|xMax|zMin|zMax):/u.exec(item.id)?.[1];
  if (side !== "xMin" && side !== "xMax" && side !== "zMin" && side !== "zMax") throw new Error(`no side in ${item.id}`);
  return side;
}

/** The floor an item is drawn on, corner by corner; none when it is not drawn as floor. */
function floorOf(item: GangwayReviewItem): Walls | null {
  return item.location.kind === "polygon" ? item.location.points.map((point) => [point.x, point.z] as const) : null;
}

/** The side of a unit a wall it squarely faces is on: the way from the wall to the unit runs square to the wall. */
function sideFacing(wall: Wall, towardX: number, towardZ: number): Side {
  const [ax, az, bx, bz] = wall;
  const length = Math.hypot(bx - ax, bz - az);
  const sense = (-(bz - az) * towardX + (bx - ax) * towardZ) >= 0 ? 1 : -1;
  const nx = (sense * -(bz - az)) / length;
  const nz = (sense * (bx - ax)) / length;
  if (Math.abs(nx) >= Math.abs(nz)) return nx > 0 ? "xMin" : "xMax";
  return nz > 0 ? "zMin" : "zMax";
}

/**
 * The one wall a floor is drawn along as a plain stretch: its first two corners on the wall, the other
 * two the guidance inside it. None when it is drawn otherwise, or its corners are on two walls at once.
 */
function stretchWall(floor: Walls, straight: readonly Wall[]): number | null {
  const [p0, p1, p2, p3] = floor;
  if (floor.length !== 4 || p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) return null;
  if (Math.abs(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) - GUIDANCE) > 1e-6 || Math.abs(Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) - GUIDANCE) > 1e-6) return null;
  const on = straight.flatMap((wall, i) => (onOrInside([[wall[0], wall[1]], [wall[2], wall[3]]], p0[0], p0[1], 1e-6) && onOrInside([[wall[0], wall[1]], [wall[2], wall[3]]], p1[0], p1[1], 1e-6) ? [i] : []));
  return on.length === 1 ? on[0] ?? null : null;
}

interface Judgement {
  readonly items: number;
  /** The furthest any item's width is from the slow way's gap to the wall it is drawn on, metres. */
  readonly worstM: number;
  readonly wrong: readonly string[];
}

/**
 * One unit's review held to the slow way. Null when the unit does not stand inside the walls, or its
 * narrowest gap is within two millimetres of the guidance itself, where a millimetre's walk cannot say.
 */
function judge(r: Room, unit: readonly PlacedItem[], at: string): Judgement | null {
  const shapes = unit.map(shapeOf);
  const nearest = r.straight.map((wall) => unitToWall(shapes, wall));
  if (!standsInside(shapes, r.walls, nearest)) return null;
  const narrowest = Math.min(...nearest.map((one) => one.gap));
  if (Math.abs(narrowest - GUIDANCE) < 2 * MM) return null;
  const review = gangwayReview(unit, r.dims, null);
  const wrong: string[] = [];
  if (narrowest >= GUIDANCE) {
    if (review.length > 0) wrong.push(`${at}: ${narrowest.toFixed(3)} m clear of every wall, yet listed at ${String(review[0]?.widthM.toFixed(3))} m`);
    return { items: review.length, worstM: 0, wrong };
  }
  // The narrowest gap is listed, and right.
  const listed = Math.min(...review.map((item) => item.widthM));
  if (!(Math.abs(listed - narrowest) <= MM)) wrong.push(`${at}: its narrowest gap is ${narrowest.toFixed(3)} m, the narrowest listed is ${listed.toFixed(3)} m`);
  if (new Set(review.map((item) => item.id)).size !== review.length) wrong.push(`${at}: two items share an id`);

  let worstM = 0;
  for (const item of review) {
    const said = `${at}: the ${sideOf(item)} item at ${item.widthM.toFixed(3)} m`;
    const floor = floorOf(item);
    if (floor === null) {
      wrong.push(`${said} is not drawn as floor`);
      continue;
    }
    if (areaOf(floor) < 1e-4) wrong.push(`${said} is drawn on no floor at all`);
    // Its width is the unit's gap to a wall it is drawn at, by a straight way from that place on the wall to the
    // piece that keeps to the floor: a gap measured through one of the Saloon's piers is no gap.
    let error = Number.POSITIVE_INFINITY;
    for (const one of nearest) {
      if (onOrInside(floor, one.x, one.z, MM) && wayKeepsToFloor(r.walls, one.x, one.z, one.pieceX, one.pieceZ, MM)) error = Math.min(error, Math.abs(one.gap - item.widthM));
    }
    if (error > MM) wrong.push(`${said} is the unit's gap to no wall where it is drawn`);
    else worstM = Math.max(worstM, error);
    // Drawn as one wall's stretch, its width is the unit's gap to that wall: the least from any of its pieces.
    const along = stretchWall(floor, r.straight);
    const toThatWall = along === null ? undefined : nearest[along]?.gap;
    if (toThatWall !== undefined && Math.abs(toThatWall - item.widthM) > MM) {
      wrong.push(`${said} is drawn on the wall ${JSON.stringify(r.straight[along ?? 0])}, and the unit stands ${toThatWall.toFixed(3)} m from that wall`);
    }
  }

  // Every wall the unit squarely faces under the guidance is said on the side it faces from, at no more than the gap, and drawn there.
  r.straight.forEach((wall, i) => {
    const one = nearest[i];
    if (one === undefined || one.gap >= GUIDANCE - 2 * MM || one.gap < MM) return;
    // Nearest at an end of the wall, the gap is to a corner, not across the wall's own gangway.
    if (Math.hypot(one.x - wall[0], one.z - wall[1]) < 0.01 || Math.hypot(one.x - wall[2], one.z - wall[3]) < 0.01) return;
    const towardX = (one.pieceX - one.x) / one.gap;
    const towardZ = (one.pieceZ - one.z) / one.gap;
    // From behind the wall (the Saloon's piers are 0.3 m thick), there is no way between them.
    if (!insideWalls(r.walls, one.x + towardX * MM, one.z + towardZ * MM)) return;
    const side = sideFacing(wall, towardX, towardZ);
    const item = review.find((candidate) => sideOf(candidate) === side);
    const where = `${at}: the wall ${JSON.stringify(wall)}, ${one.gap.toFixed(3)} m from the unit on its ${side} side,`;
    if (item === undefined) {
      wrong.push(`${where} is not listed`);
      return;
    }
    if (item.widthM > one.gap + MM) wrong.push(`${where} is listed at ${item.widthM.toFixed(3)} m`);
    const floor = floorOf(item);
    if (floor === null || !onOrInside(floor, one.x, one.z, MM)) wrong.push(`${where} is not where its item is drawn`);
  });
  return { items: review.length, worstM, wrong };
}

/** Every spot of a grid over the room's bounds. */
function gridOver(walls: Walls, step: number): readonly (readonly [number, number])[] {
  const xs = walls.map(([x]) => x);
  const zs = walls.map(([, z]) => z);
  const spots: (readonly [number, number])[] = [];
  for (let x = Math.min(...xs) + step / 3; x < Math.max(...xs); x += step) {
    for (let z = Math.min(...zs) + step / 3; z < Math.max(...zs); z += step) spots.push([x, z]);
  }
  return spots;
}

const UNITS: readonly (readonly [string, number, (x: number, z: number) => readonly PlacedItem[]])[] = [
  ["a round with its 10 chairs", 11, (x, z) => createTableGroup(ROUND.id, x, z, 0, 10)],
  ["a trestle with its 6 chairs", 7, (x, z) => createTableGroup(TRESTLE.id, x, z, 0, 6)],
  ["a trestle with its 6 chairs, turned 30°", 7, (x, z) => createTableGroup(TRESTLE.id, x, z, Math.PI / 6, 6)],
];

describe.each(SHAPED_ROOMS)("the gangway review of a table with its chairs in the %s", (name) => {
  it.each(UNITS)("says of %s what the slow way finds, wall by wall", (_what, pieces, make) => {
    const r = room(name);
    let units = 0;
    let items = 0;
    let worstM = 0;
    const wrong: string[] = [];
    for (const [x, z] of gridOver(r.walls, 0.43)) {
      const unit = make(x, z);
      expect(unit).toHaveLength(pieces);
      const judged = judge(r, unit, `(${x.toFixed(2)}, ${z.toFixed(2)})`);
      if (judged === null) continue;
      units += 1;
      items += judged.items;
      worstM = Math.max(worstM, judged.worstM);
      wrong.push(...judged.wrong);
    }
    expect(units).toBeGreaterThan(100);
    expect(items).toBeGreaterThan(100);
    expect({ wrong: wrong.length, first: wrong.slice(0, 3) }).toEqual({ wrong: 0, first: [] });
    expect(worstM).toBeLessThanOrEqual(MM);
  }, 240_000);
});

describe("the gangway review's found faults in the Robert Adam Room", () => {
  const r = room("Robert Adam Room");
  const gapTo = (unit: readonly PlacedItem[], wall: Wall): number => unitToWall(unit.map(shapeOf), wall).gap;
  const wallBetween = (ax: number, az: number, bx: number, bz: number): Wall => {
    const found = r.straight.find((wall) => Math.hypot(wall[0] - ax, wall[1] - az) < 1e-6 && Math.hypot(wall[2] - bx, wall[3] - bz) < 1e-6);
    if (found === undefined) throw new Error(`no wall from (${String(ax)}, ${String(az)}) to (${String(bx)}, ${String(bz)})`);
    return found;
  };

  it("says a round and its chairs at (−0.40, 1.97) stand 0.201 m from the upper section's south wall, once", () => {
    // The spot in the second review's sweep: a third of a 0.37 m step in from the room's corner, 14 steps across and 15 down.
    const unit = createTableGroup(ROUND.id, -5.7 + 0.37 / 3 + 0.37 * 14, -3.7 + 0.37 / 3 + 0.37 * 15, 0, 10);
    const south = wallBetween(5.7, 3.7, -0.1, 3.7);
    expect(gapTo(unit, south)).toBeCloseTo(0.201, 3);
    const review = gangwayReview(unit, r.dims, null);
    // One wall under the guidance, one item: no second item on that wall at a farther chair's 1.045 m.
    expect(review.map((item) => [sideOf(item), Number(item.widthM.toFixed(3))])).toEqual([["zMax", 0.201]]);
    expect(Math.abs((review[0]?.widthM ?? 0) - gapTo(unit, south))).toBeLessThanOrEqual(MM);
    expect(judge(r, unit, "the unit")?.wrong).toEqual([]);
  });

  it("says a trestle and its chairs at (−4.10, 3.82) stand 0.067 m from the curve's second stretch, not 0.573 m", () => {
    const unit = createTableGroup(TRESTLE.id, -4.1033, 3.8233, 0, 6);
    const first = wallBetween(-4.9, 4.9, -5.7, 4.2);
    const second = wallBetween(-4.6, 5.7, -4.9, 4.9);
    expect(gapTo(unit, first)).toBeCloseTo(0.041, 3);
    expect(gapTo(unit, second)).toBeCloseTo(0.067, 3);
    const review = gangwayReview(unit, r.dims, null);
    // The first stretch faces the unit from the south, the second from the west: each is said at the unit's own gap to it.
    expect(review.map((item) => [sideOf(item), Number(item.widthM.toFixed(3))])).toEqual([["zMax", 0.041], ["xMin", 0.067]]);
    expect(judge(r, unit, "the unit")?.wrong).toEqual([]);
  });

  it("lists no gangway at the joint in the straight west wall beside a round and its chairs at (−4.10, 2.34)", () => {
    const unit = createTableGroup(ROUND.id, -4.1033, 2.3433, 0, 10);
    // The west wall is drawn in two stretches that meet at (−5.7, 3.7); it is one wall, 0.062 m from the unit.
    expect(gapTo(unit, wallBetween(-5.7, 4.2, -5.7, -3.7))).toBeCloseTo(0.062, 3);
    const review = gangwayReview(unit, r.dims, null);
    for (const item of review) expect(areaOf(floorOf(item) ?? [])).toBeGreaterThan(0.01);
    // That wall, once: no second item 0.706 m from a chair to where its two stretches meet.
    expect(review.map((item) => [sideOf(item), Number(item.widthM.toFixed(3))])).toEqual([["xMin", 0.062]]);
    expect(judge(r, unit, "the unit")?.wrong).toEqual([]);
  });
});

describe("where the gangway review draws a pinch that runs past several walls", () => {
  it("draws a set of three trestles off the Saloon's east wall on every stretch of it they narrow, end to end of its 5.49 m, and not across the alcoves' mouths", () => {
    const r = room("Saloon");
    // End to end along the east wall's line, x = 5.95, half a metre off it: past a stretch of wall, an alcove's mouth, the pier, the other mouth and the far stretch.
    const x = 5.95 - 0.5 - TRESTLE.depth / 2;
    const run = [-TRESTLE.width, 0, TRESTLE.width].map((z): PlacedItem => ({ ...createPlacedItem(TRESTLE.id, x, z, Math.PI / 2), setId: "set-1" }));
    const review = gangwayReview(run, r.dims, null);
    const east = review.find((item) => sideOf(item) === "xMax");
    const floor = east === undefined ? null : floorOf(east);
    if (east === undefined || floor === null) throw new Error("the east wall's gangway is not listed");
    expect(east.widthM).toBeCloseTo(0.5, 6);
    expect(east.pieceIds).toHaveLength(3);
    const zs = floor.map(([, z]) => z);
    const xs = floor.map(([px]) => px);
    expect(Math.min(...zs)).toBeCloseTo(-1.5 * TRESTLE.width, 6);
    expect(Math.max(...zs)).toBeCloseTo(1.5 * TRESTLE.width, 6);
    expect(Math.min(...xs)).toBeCloseTo(5.95 - GUIDANCE, 6);
    // The floor it claims reaches the wall's line, x = 5.95, and no further. (Its outline's greatest x was 5.95 while the
    // location was the parts' hull, which claimed the mouths too. Between one part and the next the outline now follows
    // the alcove's own walls there and back, out to x = 6.55, and claims no floor there: so the floor is asked, not the outline.)
    // The three stretches the set narrows: the wall south of the first alcove from the set's end, the pier, and the wall north of the second.
    const stretch = 1.5 * TRESTLE.width - 1.95;
    expect(areaOf(floor)).toBeCloseTo((stretch + 0.3 + stretch) * GUIDANCE, 6);
    expect(insideWalls(floor, 5.4, -2.3)).toBe(true);
    expect(insideWalls(floor, 5.4, 0)).toBe(true);
    expect(insideWalls(floor, 5.4, 2.3)).toBe(true);
    // Not across the mouths, in front of them or inside the alcoves: there the wall is 0.6 m further back and the set is clear of it by the guidance.
    for (const z of [-1.05, 1.05]) {
      expect(insideWalls(floor, 5.4, z)).toBe(false);
      expect(insideWalls(floor, 5.9, z)).toBe(false);
      expect(insideWalls(floor, 6.25, z)).toBe(false);
    }
    expect(judge(r, run, "the set")?.wrong).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A stored decision is laid back over its item by id (@omnitwin/types
// withGangwayDecisions), so the id of one gap must not change as its unit is
// nudged. A unit carried a centimetre at a time: which sides it has an item on
// at each step, and how often that changes.
// ---------------------------------------------------------------------------

interface Walk {
  /** Each change of the sides listed, as "x.xx, z.zz: before -> after". */
  readonly changes: readonly string[];
  /** The furthest the narrowest width listed moved in one centimetre's step, metres. */
  readonly widestStepM: number;
}

function walk(r: Room, make: (x: number, z: number) => readonly PlacedItem[], from: readonly [number, number], to: readonly [number, number]): Walk {
  const steps = Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.01);
  const changes: string[] = [];
  let before: string | null = null;
  let narrowestBefore: number | null = null;
  let widestStepM = 0;
  for (let i = 0; i <= steps; i += 1) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const z = from[1] + ((to[1] - from[1]) * i) / steps;
    const review = gangwayReview(make(x, z), r.dims, null);
    const now = review.map((item) => sideOf(item)).sort().join("+");
    if (before !== null && now !== before) changes.push(`${x.toFixed(2)}, ${z.toFixed(2)}: ${before} -> ${now}`);
    before = now;
    const narrowest = review.length === 0 ? null : Math.min(...review.map((item) => item.widthM));
    if (narrowest !== null && narrowestBefore !== null) widestStepM = Math.max(widestStepM, Math.abs(narrowest - narrowestBefore));
    narrowestBefore = narrowest;
  }
  return { changes, widestStepM };
}

describe("the gangway review of a unit carried a centimetre at a time", () => {
  const loneRound = (x: number, z: number): readonly PlacedItem[] => [createPlacedItem(ROUND.id, x, z, 0, null, 0, "round-1")];
  const roundOfTen = (x: number, z: number): readonly PlacedItem[] => createTableGroup(ROUND.id, x, z, 0, 10);
  const trestleOfSix = (x: number, z: number): readonly PlacedItem[] => createTableGroup(TRESTLE.id, x, z, 0, 6);
  const sidesOnly = (passed: Walk): readonly string[] => passed.changes.map((change) => change.replace(/^.*: /u, ""));
  /** The narrowest gap listed moves no further than the centimetre the unit did. */
  const A_STEP = 0.01 + 1e-9;

  it("renames the gap to the Robert Adam Room's step corner (−0.1, 3.7) once as a round passes it at z = 2.6", () => {
    const passed = walk(room("Robert Adam Room"), loneRound, [-1.5, 2.6], [2.5, 2.6]);
    // East of the round until the way from the corner runs more north than west, at x = −1.2; from there south of it, and the wall south of it all the way along.
    expect(passed.changes).toEqual(["-1.19, 2.60: xMax -> zMax"]);
    expect(passed.widestStepM).toBeLessThanOrEqual(A_STEP);
  });

  it("renames the gap to the Reception Room's step corner (3.65, 1.0) once as a round passes it at z = −0.1", () => {
    const passed = walk(room("Reception Room"), loneRound, [2.2, -0.1], [3.8, -0.1]);
    // The corner's gap once; then the east wall comes within the guidance, a second gangway.
    expect(sidesOnly(passed)).toEqual(["xMax -> zMax", "zMax -> xMax+zMax"]);
    expect(passed.widestStepM).toBeLessThanOrEqual(A_STEP);
  });

  it("keeps one item all the way down the Robert Adam Room's curve at x = −3.3", () => {
    const passed = walk(room("Robert Adam Room"), loneRound, [-3.3, 4.4], [-3.3, 7.6]);
    // The curve is to the round's west throughout; the south wall comes within the guidance near the end.
    expect(sidesOnly(passed)).toEqual(["xMin -> xMin+zMax"]);
    expect(passed.widestStepM).toBeLessThanOrEqual(A_STEP);
  });

  it("changes what it lists past the Saloon's east alcoves and pier only as a wall or corner comes or goes, or a corner is passed", () => {
    const passed = walk(room("Saloon"), loneRound, [4.6, -1.6], [4.6, 1.6]);
    expect(sidesOnly(passed)).toEqual([
      // The pier's near corner, north of the round, comes to be east of it; the south wall passes out of the guidance.
      "xMax+zMax+zMin -> xMax+zMin",
      "xMax+zMin -> xMax",
      // The corner of the alcove's mouth behind the round comes to be south of it, then passes out of the guidance.
      "xMax -> xMax+zMin",
      "xMax+zMin -> xMax",
      // The same ahead of it, the other way about: the far alcove's mouth, then the north wall, then the pier's corner behind.
      "xMax -> xMax+zMax",
      "xMax+zMax -> xMax",
      "xMax -> xMax+zMax",
      "xMax+zMax -> xMax+zMax+zMin",
    ]);
    expect(passed.widestStepM).toBeLessThanOrEqual(A_STEP);
  });

  it("renames the step corner's gap once for a table with its chairs, whichever chair is nearest it", () => {
    // Each comes within the guidance of the corner to its east, and passes it once.
    expect(sidesOnly(walk(room("Robert Adam Room"), roundOfTen, [-2.4, 1.9], [2.5, 1.9]))).toEqual([" -> xMax", "xMax -> zMax"]);
    expect(sidesOnly(walk(room("Robert Adam Room"), trestleOfSix, [-2.4, 2.5], [2.5, 2.5]))).toEqual([" -> xMax", "xMax -> zMax"]);
  });

  it("keeps one item for a round with its chairs down the Robert Adam Room's curve at x = −2.75", () => {
    const passed = walk(room("Robert Adam Room"), roundOfTen, [-2.75, 5.4], [-2.75, 7.0]);
    expect(sidesOnly(passed)).toEqual(["xMin -> xMin+zMax"]);
    expect(passed.widestStepM).toBeLessThanOrEqual(A_STEP);
  });

  it("does not let the last bits of a sum choose the side of a corner a round is carried straight at", () => {
    // Along the step corner's own diagonal the round stops as far short of one wall as of the other at every step: the corner is east of it throughout.
    const passed = walk(room("Robert Adam Room"), loneRound, [-0.1 - 2.2, 3.7 - 2.2], [-0.1 - 0.75, 3.7 - 0.75]);
    expect(sidesOnly(passed)).toEqual([" -> xMax"]);
  });

  it("renames the step corner's gap once for a trestle turned 45°, whose long edge faces the corner flat on the slant", () => {
    const turned = (x: number, z: number): readonly PlacedItem[] => [createPlacedItem(TRESTLE.id, x, z, Math.PI / 4, null, 0, "trestle-1")];
    expect(sidesOnly(walk(room("Robert Adam Room"), turned, [-2.0, 2.7], [-0.9, 2.7]))).toEqual([" -> xMax", "xMax -> zMax"]);
  });

  /** The sides listed, state by state along a walk: a state that comes back is an item taken away and put back. */
  const statesOf = (passed: Walk): readonly string[] => {
    const [first] = passed.changes;
    return first === undefined ? [] : [first.replace(/^.*: /u, "").replace(/ -> .*$/u, ""), ...passed.changes.map((change) => change.replace(/^.* -> /u, ""))];
  };

  it("keeps a corner's gap on its side as a round with 8 chairs comes round the Reception Room's west shoulder to stand in front of it", () => {
    // Carried on the slant towards the corner (−3.65, 1.0): the corner's gap is south of the unit before a chair stands in front of the shoulder's wall, and after.
    const roundOfEight = (x: number, z: number): readonly PlacedItem[] => createTableGroup(ROUND.id, x, z, 0, 8);
    const heading = [Math.cos(2.6), Math.sin(2.6)] as const;
    const passed = walk(room("Reception Room"), roundOfEight, [-2.6776 - 0.2 * heading[0], -0.5476 - 0.2 * heading[1]], [-2.6776 + 0.07 * heading[0], -0.5476 + 0.07 * heading[1]]);
    const states = statesOf(passed);
    expect(new Set(states).size).toBe(states.length);
  });

  it("keeps a corner's gap on its side while a chair of a turned trestle stands in the mouth of a Saloon alcove", () => {
    // The chair comes within the guidance of the alcove's side wall 3.5 cm before it is carried clear of the alcove: the gap to the mouth's corner is not renamed for those 3.5 cm.
    const turned = (x: number, z: number): readonly PlacedItem[] => createTableGroup(TRESTLE.id, x, z, 1, 6);
    const heading = [Math.cos(5.313), Math.sin(5.313)] as const;
    const passed = walk(room("Saloon"), turned, [-4.906 - 0.12 * heading[0], -0.637 - 0.12 * heading[1]], [-4.906 + 0.08 * heading[0], -0.637 + 0.08 * heading[1]]);
    const states = statesOf(passed);
    expect(new Set(states).size).toBe(states.length);
  });
});

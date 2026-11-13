import { describe, expect, it } from "vitest";
import { planTheatreFill, type ChairSupply, type TheatreFillPlan, type TheatreFillSeat } from "../auto-fill.js";
import type { LayoutRect } from "../auto-layout.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import { computeRotatedFootprint } from "../placement.js";
import { roomFloorOf, type RoomFloor } from "../room-floor.js";
import { THEATRE_SPACING } from "../theatre-layout.js";
import { toRealWorld } from "../../constants/scale.js";
import { computeBoundingBox, roomGeometries } from "../../data/room-geometries.js";
import { footprintInsideWalls, onOrInside, type Walls } from "./walls-the-slow-way.js";

// ---------------------------------------------------------------------------
// The rear walkway on a room's own floor (#410 meets audit editor-save-4).
//
// Master keeps at least 1.2 m clear behind the last row of a theatre fill,
// from the back edge of its chairs to the back wall, behind whichever chair
// is set in that row (Blake, 12 Nov 2026: "Keep a rear walkway"). Master
// knows every room as a rectangle, so its back wall is one straight line and
// its last row is the plan's. On a room's own floor neither holds: the
// Saloon's back wall runs in and out of its alcoves, the Reception Room and
// the Robert Adam Room step in behind some seats and not others, and the
// walls, the doors, the guests asked for and the chairs in store decide
// which row is set last.
//
// The rule (planTheatreFill, setWithRearWalkway): every chair of the last
// row set has the walkway's depth of floor straight behind it, its own width
// wide, to the room's own walls. These tests measure that the slow way
// (walls-the-slow-way), with nothing of the planner's geometry.
// ---------------------------------------------------------------------------

const WALKWAY_M = THEATRE_SPACING.rearWalkwayM;
/** Nearer a wall than this, the slow way and the planner may differ by rounding alone (metres). */
const SLACK = 1e-6;
/** The slow way walks a millimetre at a time. */
const STEP = 0.001;

const SHAPED_ROOMS = ["Saloon", "Reception Room", "Robert Adam Room"] as const;
type ShapedRoom = (typeof SHAPED_ROOMS)[number];

/** The planner's chairs: the unasked chair, the wedding chair, and the Grand Hall's order after the first. */
const CHAIRS = ["burgess-turini-18-3", "chiavari-chair", "checked-banquet-chair", "gallery-chair-red-gold"] as const;

/**
 * A door in each room's walls by the last rows, kept clear as the planner keeps
 * the Grand Hall's (the opening and 0.3 m each side, 1.5 m deep from the wall
 * face). Only the Grand Hall's doors are recorded (door-clear-spaces); these
 * stand in for a room's own, so the walkway is held with doors kept clear too.
 */
const DOORS: Readonly<Record<ShapedRoom, LayoutRect>> = {
  // The east wall's north stretch, beside the last rows.
  "Saloon": { cx: 5.2, cz: 2.7, width: 1.5, depth: 1.5 },
  // The lower section's south wall, behind the last row.
  "Reception Room": { cx: -1.5, cz: 5.25, width: 1.5, depth: 1.5 },
  // The lower section's east wall, beside the last rows.
  "Robert Adam Room": { cx: -0.85, cz: 6.0, width: 1.5, depth: 1.5 },
};

interface Room {
  readonly walls: Walls;
  readonly widthM: number;
  readonly lengthM: number;
  readonly floor: RoomFloor;
}

/** A room as the planner fills it: the size of its bounds and its own floor. Render space is metres (RENDER_SCALE 1). */
function room(name: string): Room {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  const floor = roomFloorOf(geometry.wallPolygon);
  if (floor === undefined) throw new Error(`${name} has no floor of its own`);
  const box = computeBoundingBox(geometry.wallPolygon);
  return { walls: geometry.wallPolygon, widthM: box.width, lengthM: box.depth, floor };
}

function chairNamed(slug: string): CatalogueItem {
  const found = getCatalogueItemBySlug(slug);
  if (found === undefined) throw new Error(`no chair ${slug}`);
  return found;
}

/** How far a seat stands from the stage end: rows face −Z (turned 0) or −X (turned a quarter). */
function along(seat: TheatreFillSeat): number {
  return seat.rotationY === 0 ? seat.zM : seat.xM;
}

/** The seats of the last row set: the row farthest from the stage. */
function lastRowSet(plan: TheatreFillPlan): readonly TheatreFillSeat[] {
  const back = Math.max(...plan.seats.map(along));
  return plan.seats.filter((seat) => Math.abs(along(seat) - back) < 1e-9);
}

/** A seat's chair as set, metres, and which way is behind it: +Z for a chair turned 0, +X for one turned a quarter. */
function chairAt(seat: TheatreFillSeat): { readonly halfW: number; readonly halfD: number; readonly backX: number; readonly backZ: number } {
  const chair = getCatalogueItem(seat.chairItemId);
  if (chair === undefined) throw new Error(`no chair ${seat.chairItemId}`);
  const { halfW, halfD } = computeRotatedFootprint(chair, seat.rotationY);
  if (seat.rotationY === 0) return { halfW: toRealWorld(halfW), halfD: toRealWorld(halfD), backX: 0, backZ: 1 };
  if (seat.rotationY === Math.PI / 2) return { halfW: toRealWorld(halfW), halfD: toRealWorld(halfD), backX: 1, backZ: 0 };
  throw new Error(`a theatre seat turned ${String(seat.rotationY)}`);
}

/** Whether the walkway's depth of floor lies straight behind a seat's chair, its own width wide: the slow way. */
function walkwayClear(walls: Walls, seat: TheatreFillSeat): boolean {
  const { halfW, halfD, backX } = chairAt(seat);
  const half = WALKWAY_M / 2;
  return backX === 1
    ? footprintInsideWalls(walls, seat.xM + halfW + half, seat.zM, half, halfD, SLACK)
    : footprintInsideWalls(walls, seat.xM, seat.zM + halfD + half, halfW, half, SLACK);
}

/**
 * How far the floor runs straight back from a seat's chair before a wall,
 * metres: from every centimetre of the chair's back edge, walked a millimetre
 * at a time while each step is inside the walls or on one; the least of them,
 * looking no further than `reach`.
 */
function clearBehind(walls: Walls, seat: TheatreFillSeat, reach: number): number {
  const { halfW, halfD, backX, backZ } = chairAt(seat);
  const across = backX === 1 ? halfD : halfW;
  const edgeX = seat.xM + backX * halfW;
  const edgeZ = seat.zM + backZ * halfD;
  const points = Math.max(2, Math.ceil((2 * across) / 0.01));
  let least = reach;
  for (let i = 0; i <= points; i += 1) {
    const offset = -across + (2 * across * i) / points;
    const x = edgeX + backZ * offset;
    const z = edgeZ + backX * offset;
    let walked = 0;
    while (walked < least && onOrInside(walls, x + backX * (walked + STEP), z + backZ * (walked + STEP), SLACK)) walked += STEP;
    least = Math.min(least, walked);
  }
  return least;
}

/** Each chair of the last row set without the walkway behind it, with the floor it has (the slow way). */
function shortOfWalkway(walls: Walls, plan: TheatreFillPlan): readonly string[] {
  return lastRowSet(plan)
    .filter((seat) => !walkwayClear(walls, seat))
    .map((seat) => `${getCatalogueItem(seat.chairItemId)?.slug ?? seat.chairItemId} at (${seat.xM.toFixed(3)}, ${seat.zM.toFixed(3)}) has ${clearBehind(walls, seat, WALKWAY_M + 0.1).toFixed(3)} m behind it`);
}

/** The rows of a plan, front first: the seats at each distance from the stage. */
function rowSizes(plan: TheatreFillPlan): readonly number[] {
  const rows = new Map<string, number>();
  for (const seat of plan.seats) rows.set(along(seat).toFixed(6), (rows.get(along(seat).toFixed(6)) ?? 0) + 1);
  return [...rows.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([, count]) => count);
}

describe("what the walkway leaves on each room's own floor (the unasked chair, no limit to it)", () => {
  const turini = chairNamed("burgess-turini-18-3");

  it("sets the Saloon's last row before its alcoves only: four chairs with 1.41 m of floor behind, not eight with 0.81 m to the wall between", () => {
    const { walls, widthM, lengthM, floor } = room("Saloon");
    const plan = planTheatreFill(turini, 0, widthM, lengthM, { floor });
    if (plan === null) throw new Error("no theatre plan");
    // Rows face −X; the last row stands at x = 4.85, its chairs' backs at 5.14. The east wall is at 5.95 between
    // the alcoves and beyond them, 6.55 at the alcoves' backs (z 0.15 to 1.95 either side of the middle).
    const last = lastRowSet(plan);
    expect(last.map((seat) => seat.xM.toFixed(3))).toEqual(["4.850", "4.850", "4.850", "4.850"]);
    expect(last.map((seat) => seat.zM.toFixed(3)).sort()).toEqual(["-0.870", "-1.390", "0.870", "1.390"]);
    for (const seat of last) expect(clearBehind(walls, seat, 2)).toBeCloseTo(1.41, 3);
    expect([plan.rows, plan.chairs, plan.roomForSeats]).toEqual([11, 84, 84]);
    expect(rowSizes(plan)).toEqual([8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 4]);
  });

  it.each([
    ["Reception Room", 10, 100, 1.21],
    ["Robert Adam Room", 10, 115, 1.61],
  ] as const)("fills the %s as before: %i rows, %i chairs, at least %f m behind the last", (name, rows, chairs, least) => {
    const { walls, widthM, lengthM, floor } = room(name);
    const plan = planTheatreFill(turini, 0, widthM, lengthM, { floor });
    if (plan === null) throw new Error("no theatre plan");
    expect([plan.rows, plan.chairs, plan.roomForSeats]).toEqual([rows, chairs, chairs]);
    expect(Math.min(...lastRowSet(plan).map((seat) => clearBehind(walls, seat, 3)))).toBeCloseTo(least, 3);
  });

  it("seats 60 in the Reception Room past the step: the fifth row, last at first, sets none of its chairs with the step 0.71 m behind them", () => {
    const { walls, widthM, lengthM, floor } = room("Reception Room");
    const plan = planTheatreFill(turini, 60, widthM, lengthM, { floor });
    if (plan === null) throw new Error("no theatre plan");
    // Five rows of twelve would seat 60, but the fifth stands at z = 0 and its end chairs (x = ±3.625) back onto
    // the step at z = 1: 0.71 m. Without them it seats 58, so the sixth row, in the lower section, is set too.
    expect(rowSizes(plan)).toEqual([12, 12, 12, 12, 10, 8]);
    expect([plan.chairs, plan.meetsTarget]).toEqual([66, true]);
    expect(plan.seats.some((seat) => Math.abs(seat.xM) > 3.6 && seat.zM === 0)).toBe(false);
    expect(shortOfWalkway(walls, plan)).toEqual([]);
  });
});

describe.each(SHAPED_ROOMS)("the rear walkway in the %s", (name) => {
  const { walls, widthM, lengthM, floor } = room(name);

  describe.each([
    ["with no door kept clear", [] as readonly LayoutRect[]],
    ["with a door kept clear", [DOORS[name]] as readonly LayoutRect[]],
  ])("%s", (_doors, doorSpaces) => {
    it.each(CHAIRS)("lies behind every %s of the last row when the room is filled", (slug) => {
      const plan = planTheatreFill(chairNamed(slug), 0, widthM, lengthM, { floor, doorSpaces });
      if (plan === null) throw new Error("no theatre plan");
      expect(plan.doorsKeptClear).toBe(doorSpaces.length > 0);
      expect(shortOfWalkway(walls, plan)).toEqual([]);
    });

    it("lies behind the last row set for every number of guests, whichever row the floor makes the last", () => {
      const turini = chairNamed("burgess-turini-18-3");
      const full = planTheatreFill(turini, 0, widthM, lengthM, { floor, doorSpaces });
      if (full === null) throw new Error("no theatre plan");
      const wrong: string[] = [];
      for (let guests = 1; guests <= full.chairs + 1; guests += 1) {
        const plan = planTheatreFill(turini, guests, widthM, lengthM, { floor, doorSpaces });
        if (plan === null) {
          wrong.push(`${String(guests)} guests: no plan`);
          continue;
        }
        if (plan.meetsTarget !== guests <= full.chairs) wrong.push(`${String(guests)} guests: meetsTarget ${String(plan.meetsTarget)}`);
        for (const line of shortOfWalkway(walls, plan)) wrong.push(`${String(guests)} guests: ${line}`);
      }
      expect(wrong).toEqual([]);
    });

    it("lies behind whichever chair the hall's stock puts in the last row, and the planning ends", () => {
      const turini = chairNamed("burgess-turini-18-3");
      const checked = chairNamed("checked-banquet-chair");
      const full = planTheatreFill(turini, 0, widthM, lengthM, { floor, doorSpaces });
      if (full === null) throw new Error("no theatre plan");
      const wrong: string[] = [];
      let deeperChairLast = 0;
      let ranOut = 0;
      for (let pink = 0; pink <= full.chairs; pink += 1) {
        const supplies: readonly (readonly ChairSupply[])[] = [
          // The pink chairs run out and the deeper checked chair (0.62 m against 0.58 m) takes the rows behind.
          [{ item: turini, inStore: pink }, { item: checked, inStore: null }],
          // The pink chairs alone, which run out.
          [{ item: turini, inStore: pink }],
        ];
        for (const chairSupply of supplies) {
          const plan = planTheatreFill(turini, 0, widthM, lengthM, { floor, doorSpaces, chairSupply });
          if (plan === null) continue; // fewer pink chairs than the front row and none other
          for (const line of shortOfWalkway(walls, plan)) wrong.push(`${String(pink)} pink chairs of ${String(chairSupply.length)} kinds: ${line}`);
          if (lastRowSet(plan).every((seat) => seat.chairItemId === checked.id) && plan.seats.some((seat) => seat.chairItemId === turini.id)) deeperChairLast += 1;
          if (plan.chairsRanOut) ranOut += 1;
        }
      }
      expect(wrong).toEqual([]);
      // Both ways a fill re-plans or stops were met, not passed by.
      expect(deeperChairLast).toBeGreaterThan(0);
      expect(ranOut).toBeGreaterThan(0);
    });
  });
});

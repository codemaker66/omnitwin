import { describe, expect, it } from "vitest";
import { planAutoFill, planTheatreFill } from "../auto-fill.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { computeRotatedFootprint } from "../placement.js";
import { toRealWorld } from "../../constants/scale.js";
import { planTheatreLayout, THEATRE_SPACING } from "../theatre-layout.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES, doorKeepOuts } from "../door-clear-spaces.js";
import { HALL_LENGTH, HALL_WIDTH } from "../../components/grand-hall/hall-spec.js";
import { roomGeometries, computeBoundingBox } from "../../data/room-geometries.js";

// Auto-fill keeps a walkway of at least 1.2 m behind the last row, from the
// back edge of its chairs to the back wall (Blake, 12 November 2026: "Keep a
// rear walkway"). PR #391 moved the Grand Hall to its scanned 21.135 x 10.59 m,
// which fitted a 21st row and left 0.445 m.

const TURINI_DEPTH_M = 0.58;
const WALKWAY_M = THEATRE_SPACING.rearWalkwayM;

/**
 * Metres from the back edge of the last row's chairs to the back wall. A seat
 * that names its chair (a fill's) is measured with that chair's own depth;
 * `seatDepthM` stands for any seat that does not (a bare layout's). The least
 * over the row is returned.
 */
function clearBehindLastRow(
  seats: readonly { readonly xM: number; readonly zM: number; readonly chairItemId?: string }[],
  alongLength: boolean,
  roomDepthM: number,
  seatDepthM: number,
): number {
  const along = (seat: { readonly xM: number; readonly zM: number }): number => (alongLength ? seat.zM : seat.xM);
  const lastRowCentre = Math.max(...seats.map(along));
  const lastRow = seats.filter((seat) => Math.abs(along(seat) - lastRowCentre) < 1e-9);
  return Math.min(...lastRow.map((seat) => {
    const chair = seat.chairItemId === undefined ? undefined : getCatalogueItem(seat.chairItemId);
    const depthM = chair === undefined ? seatDepthM : 2 * toRealWorld(computeRotatedFootprint(chair, 0).halfD);
    return roomDepthM / 2 - (lastRowCentre + depthM / 2);
  }));
}

describe("theatre rear walkway", () => {
  it("is 1.2 m by default", () => {
    expect(WALKWAY_M).toBe(1.2);
  });

  it("fits 20 rows and 280 seats in the scanned Grand Hall, with 1.2 m behind the last row's chairs", () => {
    const plan = planTheatreLayout(HALL_LENGTH, HALL_WIDTH);
    expect([plan.rows, plan.seatCount]).toEqual([20, 280]);
    const clear = clearBehindLastRow(plan.seats, plan.alongLength, HALL_LENGTH, TURINI_DEPTH_M);
    expect(clear).toBeGreaterThanOrEqual(WALKWAY_M);
    // Row 20's chairs end 1.345 m short of the wall (a 21st would leave 0.445 m).
    expect(clear).toBeCloseTo(1.345, 6);
  });

  it("leaves the side clearance and the other spacing as they were", () => {
    expect(THEATRE_SPACING).toMatchObject({ seatPitchM: 0.52, rowPitchM: 0.9, aisleM: 1.1, stageDepthM: 2.4, wallClearanceM: 0.7 });
    const plan = planTheatreLayout(HALL_LENGTH, HALL_WIDTH);
    expect(plan.seatsPerRow).toBe(14);
    // Cross-axis (Z) edge of the outermost chair keeps the 0.7 m side band.
    const outerZ = Math.max(...plan.seats.map((seat) => Math.abs(seat.zM)));
    expect(HALL_WIDTH / 2 - outerZ).toBeGreaterThanOrEqual(THEATRE_SPACING.wallClearanceM);
  });

  it("keeps the old 21 x 10.5 m hall at 20 rows and 280 seats", () => {
    const plan = planTheatreLayout(21, 10.5);
    expect([plan.rows, plan.seatCount]).toEqual([20, 280]);
    expect(clearBehindLastRow(plan.seats, plan.alongLength, 21, TURINI_DEPTH_M)).toBeCloseTo(1.21, 5);
  });

  it("keeps a row whose walkway is exactly 1.2 m, and drops it a hair short", () => {
    // 2.4 m of stage + 19 row pitches of 0.9 m + half a chair (0.29 m) + 1.2 m of walkway = 20.99 m of depth.
    const exact = planTheatreLayout(20.99, 10);
    expect(exact.rows).toBe(20);
    expect(clearBehindLastRow(exact.seats, exact.alongLength, 20.99, TURINI_DEPTH_M)).toBeCloseTo(WALKWAY_M, 9);
    const short = planTheatreLayout(20.98, 10);
    expect(short.rows).toBe(19);
    expect(clearBehindLastRow(short.seats, short.alongLength, 20.98, TURINI_DEPTH_M)).toBeGreaterThanOrEqual(WALKWAY_M);
  });

  it("measures the walkway from the chair's back edge: a deeper chair costs a row sooner", () => {
    const deep = planTheatreLayout(20.99, 10, { seatDepthM: 0.62 });
    expect(deep.rows).toBe(19);
    const shallow = planTheatreLayout(20.99, 10, { seatDepthM: 0.41 });
    expect(shallow.rows).toBe(20);
  });

  it("takes the walkway as an option", () => {
    const wider = planTheatreLayout(HALL_LENGTH, HALL_WIDTH, { rearWalkwayM: 1.6 });
    expect(wider.rows).toBe(19);
    const old = planTheatreLayout(HALL_LENGTH, HALL_WIDTH, { rearWalkwayM: 0.7 - TURINI_DEPTH_M / 2 });
    expect([old.rows, old.seatCount]).toEqual([21, 294]);
  });
});

describe("theatre fill uses the real chair's depth", () => {
  it("leaves at least 1.2 m behind the last row in the scanned Grand Hall", () => {
    const fill = planAutoFill("theatre", 0, HALL_LENGTH, HALL_WIDTH);
    if (fill === null || fill.style !== "theatre") throw new Error("no theatre plan");
    expect([fill.rows, fill.chairs]).toEqual([20, 280]);
    const chair = getCatalogueItemBySlug("burgess-turini-18-3");
    if (chair === undefined) throw new Error("no Turini chair");
    const depth = 2 * toRealWorld(computeRotatedFootprint(chair, 0).halfD);
    expect(depth).toBeCloseTo(TURINI_DEPTH_M, 9);
    expect(clearBehindLastRow(fill.seats, false, HALL_LENGTH, depth)).toBeGreaterThanOrEqual(WALKWAY_M - 1e-9);
  });

  it("sets the event's shallower chair (Chiavari) in the same 20 rows", () => {
    const chiavari = planAutoFill("theatre", 0, HALL_LENGTH, HALL_WIDTH, "chiavari-chair");
    if (chiavari === null || chiavari.style !== "theatre") throw new Error("no theatre plan");
    expect(chiavari.rows).toBe(20);
  });

  it("still clears the doors on top of the new back limit", () => {
    const doors = doorKeepOuts(GRAND_HALL_DOOR_CLEAR_SPACES);
    const fill = planAutoFill("theatre", 0, HALL_LENGTH, HALL_WIDTH, undefined, { doorSpaces: doors });
    if (fill === null || fill.style !== "theatre") throw new Error("no theatre plan");
    expect(fill.doorsKeptClear).toBe(true);
    expect([fill.rows, fill.chairs, fill.roomForSeatsIgnoringDoors]).toEqual([20, 268, 280]);
    expect(clearBehindLastRow(fill.seats, false, HALL_LENGTH, TURINI_DEPTH_M)).toBeGreaterThanOrEqual(WALKWAY_M - 1e-9);
  });
});

describe("theatre fill holds the walkway behind whichever chair is in the last row", () => {
  const turini = getCatalogueItemBySlug("burgess-turini-18-3");
  const checked = getCatalogueItemBySlug("checked-banquet-chair");
  if (turini === undefined || checked === undefined) throw new Error("no chairs");
  const reception = roomGeometries["Reception Room"];
  if (reception === undefined) throw new Error("no Reception Room");
  const box = computeBoundingBox(reception.wallPolygon);

  it("plans again, one row shorter, when the pink chair's stock puts the deeper checked chair in the last row", () => {
    // 119 pink chairs seat 9 rows of 12; row 10 would be checked chairs (0.62 m) with 1.19 m behind them.
    const fill = planTheatreFill(turini, 0, box.width, box.depth, {
      chairSupply: [{ item: turini, inStore: 119 }, { item: checked, inStore: null }],
    });
    if (fill === null) throw new Error("no theatre plan");
    expect([fill.rows, fill.chairs, fill.roomForSeats]).toEqual([9, 108, 108]);
    expect(clearBehindLastRow(fill.seats, box.depth >= box.width, Math.max(box.width, box.depth), TURINI_DEPTH_M))
      .toBeGreaterThanOrEqual(WALKWAY_M - 1e-9);
  });

  it("keeps the 10th row while the pink chairs last", () => {
    const fill = planTheatreFill(turini, 0, box.width, box.depth, {
      chairSupply: [{ item: turini, inStore: 120 }, { item: checked, inStore: null }],
    });
    if (fill === null) throw new Error("no theatre plan");
    expect([fill.rows, fill.chairs]).toEqual([10, 120]);
    expect(clearBehindLastRow(fill.seats, box.depth >= box.width, Math.max(box.width, box.depth), TURINI_DEPTH_M))
      .toBeGreaterThanOrEqual(WALKWAY_M - 1e-9);
  });

  it("does the same with the doors kept clear", () => {
    // A door space in the centre aisle takes no seat, but puts the fill on the door-clear path.
    const fill = planTheatreFill(turini, 0, box.width, box.depth, {
      doorSpaces: [{ cx: 0, cz: 0, width: 0.5, depth: 0.5 }],
      chairSupply: [{ item: turini, inStore: 119 }, { item: checked, inStore: null }],
    });
    if (fill === null) throw new Error("no theatre plan");
    expect(fill.doorsKeptClear).toBe(true);
    expect([fill.rows, fill.chairs, fill.roomForSeats, fill.roomForSeatsIgnoringDoors]).toEqual([9, 108, 108, 108]);
    expect(clearBehindLastRow(fill.seats, box.depth >= box.width, Math.max(box.width, box.depth), TURINI_DEPTH_M))
      .toBeGreaterThanOrEqual(WALKWAY_M - 1e-9);
  });
});

describe("theatre fill in each Trades Hall room", () => {
  const expected: Readonly<Record<string, readonly [rows: number, seats: number]>> = {
    "Grand Hall": [20, 280],
    "Saloon": [11, 88],
    "Reception Room": [10, 120],
    "Robert Adam Room": [10, 160],
  };

  it.each(Object.entries(expected))("%s fills %s rows with the walkway behind", (name, [rows, seats]) => {
    const geometry = roomGeometries[name];
    if (geometry === undefined) throw new Error(`no geometry for ${name}`);
    const box = computeBoundingBox(geometry.wallPolygon);
    const fill = planAutoFill("theatre", 0, box.width, box.depth);
    if (fill === null || fill.style !== "theatre") throw new Error("no theatre plan");
    expect([fill.rows, fill.chairs]).toEqual([rows, seats]);
    const alongLength = box.depth >= box.width;
    const roomDepth = alongLength ? box.depth : box.width;
    expect(clearBehindLastRow(fill.seats, alongLength, roomDepth, TURINI_DEPTH_M)).toBeGreaterThanOrEqual(WALKWAY_M - 1e-9);
  });
});

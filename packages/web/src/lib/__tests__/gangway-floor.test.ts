// The floor a gangway pinch is drawn on (lib/auto-fill gangwayFloor): one polygon the shared schema takes, with
// real floor in it, whatever parts it is handed. The third review of audit editor-save-4 found a location of
// two points, which the API refuses, so the layout could not be submitted: two parts of no length, in line,
// drawn as their hull. So the parts here are the worst that could be handed over, and thousands made at random.
import { GangwayReviewSchema, type FloorPoint } from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { roomGeometries } from "../../data/room-geometries.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { gangwayFloor, gangwayReview, type FloorPart } from "../auto-fill.js";
import { floorOf, GUIDANCE, piece, room, setDown, sideOf } from "./gangway-against-walls.js";
import { areaOf, floorClaims, insideWalls, onOrInside, straightWalls, TOUCHING, windingOf, type Walls } from "./walls-the-slow-way.js";

/** The least floor a location may be drawn on, square metres: a centimetre of wall, the guidance deep. */
const REAL_FLOOR_M2 = 0.01;

function wallsOf(name: string): Walls {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  return geometry.wallPolygon;
}

const outlineOf = (walls: Walls): readonly FloorPoint[] => walls.map(([x, z]) => ({ x, z }));
const point = (x: number, z: number): FloorPoint => ({ x, z });
const drawnAs = (points: readonly FloorPoint[]): Walls => points.map(({ x, z }) => [x, z] as const);

/** Whether the shared schema takes a review item located on these points. */
function taken(points: readonly FloorPoint[]): boolean {
  return GangwayReviewSchema.safeParse({
    items: [{
      id: "gangway:xMin:piece-1+wall:xMin",
      widthM: 0,
      guidance: { thresholdM: 1.1, source: "a test" },
      gangway: "the wall",
      location: { kind: "polygon", points },
      pieceIds: ["piece-1"],
      sides: ["the wall", "a piece"],
      status: "open",
    }],
  }).success;
}

/** What every drawn floor must be, whatever it was made from. */
function expectRealFloor(points: readonly FloorPoint[]): void {
  expect(points.length).toBeGreaterThanOrEqual(3);
  expect(points.every(({ x, z }) => Number.isFinite(x) && Number.isFinite(z))).toBe(true);
  expect(areaOf(drawnAs(points))).toBeGreaterThanOrEqual(REAL_FLOOR_M2 - 1e-9);
  expect(taken(points)).toBe(true);
}

describe("the floor a pinch is drawn on, whatever its parts", () => {
  const saloon = wallsOf("Saloon");
  const saloonOutline = outlineOf(saloon);

  it("draws two stretches of no length, in line, as real floor at each: they were a location of two points", () => {
    // The third review's blocker, as it was handed over: the side walls of the Saloon's two west alcoves, each
    // touched only at its end on the wall line x = −5.95, each a stretch of no length there.
    const north: FloorPart = { floor: [point(-5.95, 0.15), point(-5.95, 0.15), point(-5.95, 1.25), point(-5.95, 1.25)], along: [point(-5.95, 0.15), point(-5.95, 0.15)] };
    const south: FloorPart = { floor: [point(-5.95, -1.95), point(-5.95, -1.95), point(-5.95, -0.85), point(-5.95, -0.85)], along: [point(-5.95, -1.95), point(-5.95, -1.95)] };
    const drawn = gangwayFloor([north, south], saloonOutline);
    expectRealFloor(drawn);
    // A mark on the floor at each place, none of it in the pier or beyond the walls, all of it within a step of the place.
    const floor = drawnAs(drawn);
    expect(floorClaims(saloon, straightWalls(saloon), floor, 0.25, 1e-6)).toMatchObject({ offTheFloor: 0, beyondReach: 0 });
    expect(insideWalls(floor, -5.9, 0.2)).toBe(true);
    expect(insideWalls(floor, -6.0, 0.25)).toBe(true);
    expect(insideWalls(floor, -6.0, 0.1)).toBe(false);
    expect(insideWalls(floor, -5.9, -1.9)).toBe(true);
    // And nothing between the two.
    expect(insideWalls(floor, -5.9, -0.9)).toBe(false);
  });

  it.each<readonly [string, FloorPart]>([
    ["no points", { floor: [], along: [point(-5.95, 0), point(-5.95, 0)] }],
    ["one point", { floor: [point(-5.95, 0)], along: [point(-5.95, 0), point(-5.95, 0)] }],
    ["two points", { floor: [point(-5.95, -0.1), point(-5.95, 0.1)], along: [point(-5.95, -0.1), point(-5.95, 0.1)] }],
    ["three points in line", { floor: [point(-5.95, -0.1), point(-5.95, 0), point(-5.95, 0.1)], along: [point(-5.95, -0.1), point(-5.95, 0.1)] }],
    ["a sliver a tenth of a millimetre wide", { floor: [point(-5.95, 0), point(-5.95, 0.0001), point(-4.85, 0.0001), point(-4.85, 0)], along: [point(-5.95, 0), point(-5.95, 0.0001)] }],
    ["floor wholly outside the room", { floor: [point(20, 20), point(21, 20), point(21, 21)], along: [point(20.5, 20), point(20.5, 20)] }],
    ["points that are no numbers", { floor: [point(Number.NaN, 1), point(2, Number.POSITIVE_INFINITY), point(3, 3)], along: [point(Number.NaN, Number.NaN), point(Number.NaN, Number.NaN)] }],
    ["a bow-tie, which winds round no floor on balance", { floor: [point(0, 0), point(1, 1), point(1, 0), point(0, 1)], along: [point(0, 0), point(1, 0)] }],
  ])("draws a part of %s as real floor the schema takes, alone and beside another", (_what, part) => {
    expectRealFloor(gangwayFloor([part], saloonOutline));
    expectRealFloor(gangwayFloor([part, part], saloonOutline));
    const pier: FloorPart = { floor: [point(-5.95, 0.15), point(-5.95, -0.15), point(-4.85, -0.15), point(-4.85, 0.15)], along: [point(-5.95, 0.15), point(-5.95, -0.15)] };
    expectRealFloor(gangwayFloor([pier, part], saloonOutline));
    expectRealFloor(gangwayFloor([part, pier, part], saloonOutline));
  });

  it("draws real floor from parts made at random, six thousand times", () => {
    // A small generator of its own, so the parts are the same each run.
    let state = 20261111;
    const random = (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const anywhere = (): FloorPoint => point(-8 + 16 * random(), -5 + 10 * random());
    /** A place on a wall of the room. */
    const onAWall = (walls: Walls): FloorPoint => {
      const i = Math.floor(random() * walls.length);
      const [ax, az] = walls[i] ?? [0, 0];
      const [bx, bz] = walls[(i + 1) % walls.length] ?? [0, 0];
      const along = random();
      return point(ax + (bx - ax) * along, az + (bz - az) * along);
    };
    const partOf = (walls: Walls): FloorPart => {
      const count = Math.floor(random() * 7);
      const kind = random();
      const first = random() < 0.5 ? onAWall(walls) : anywhere();
      // Points anywhere; or all one point; or all in one line; or a small shape about a place on a wall.
      const floor = Array.from({ length: count }, (_, k) => {
        if (kind < 0.4) return anywhere();
        if (kind < 0.55) return first;
        if (kind < 0.7) return point(first.x + k * 0.3, first.z + k * 0.3);
        return point(first.x + (random() - 0.5) * 2.2, first.z + (random() - 0.5) * 2.2);
      });
      return { floor, along: [random() < 0.7 ? first : anywhere(), random() < 0.7 ? first : onAWall(walls)] };
    };
    let drawn = 0;
    for (const name of ["Robert Adam Room", "Reception Room", "Saloon"]) {
      const walls = wallsOf(name);
      const outline = outlineOf(walls);
      for (let n = 0; n < 2000; n += 1) {
        const others = Array.from({ length: Math.floor(random() * 4) }, () => partOf(walls));
        expectRealFloor(gangwayFloor([partOf(walls), ...others], outline));
        drawn += 1;
      }
    }
    expect(drawn).toBe(6000);
  });

  it("cuts the gangway inside a wall short where another wall stands in front of it", () => {
    // The first stretch of the Robert Adam Room's curve, (−5.7, 8.2) to (−4.9, 7.5), faces south-east: 1.1 m square off
    // its west end is past the bottom wall at z = 8.7.
    const adam = wallsOf("Robert Adam Room");
    const length = Math.hypot(0.8, 0.7);
    const into = [0.7 / length, 0.8 / length] as const;
    const from = point(-5.7, 8.2);
    const to = point(-4.9, 7.5);
    const whole = [from, to, point(to.x + into[0] * 1.1, to.z + into[1] * 1.1), point(from.x + into[0] * 1.1, from.z + into[1] * 1.1)];
    expect(Math.max(...whole.map(({ z }) => z))).toBeGreaterThan(9);
    const drawn = gangwayFloor([{ floor: whole, along: [from, to] }], outlineOf(adam));
    expectRealFloor(drawn);
    expect(Math.max(...drawn.map(({ z }) => z))).toBeCloseTo(8.7, 9);
    expect(areaOf(drawnAs(drawn))).toBeLessThan(areaOf(drawnAs(whole)) - 0.05);
    expect(floorClaims(adam, straightWalls(adam), drawnAs(drawn), 1.1, 1e-6)).toMatchObject({ offTheFloor: 0, beyondReach: 0 });
  });

  it("leaves one part that lies wholly in the room exactly as it was handed over", () => {
    const stretch = [point(5.95, -3.0), point(5.95, -1.95), point(4.85, -1.95), point(4.85, -3.0)];
    expect(gangwayFloor([{ floor: stretch, along: [point(5.95, -3.0), point(5.95, -1.95)] }], saloonOutline)).toEqual(stretch);
  });
});

// Where two parts of a pinch share floor (a wall's stretch and a corner's triangle, or two stretches), the outline
// goes round each whole and so winds twice round the floor they share (fourth review of the branch, finding 3). It
// is to be filled by the nonzero rule, as gangwayFloor and the record say: all of it is the room's floor.
describe("the floor a pinch is drawn on where its parts overlap, filled by the nonzero rule", () => {
  afterEach(() => {
    useCatalogueStore.getState().clearSelection();
    usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled: true });
    useChairDialogStore.getState().clearDialog();
    useRoomDimensionsStore.getState().setDimensions(GRAND_HALL_RENDER_DIMENSIONS);
  });

  it("winds only round the room's floor within the guidance of its east walls for a chair turned 15° before the Saloon's east pier", () => {
    const r = room("Saloon");
    useRoomDimensionsStore.getState().setDimensions(r.dims);
    // Grid on, turned 15°: the click sets the banquet chair 2.4 mm off the east pier's face, x = 5.95, at z = 0.
    const set = setDown(piece("banquet-chair"), 0, 5.4768, 0.2973, Math.PI / 12, true);
    const [chair] = set ?? [];
    if (set === null || chair === undefined) throw new Error("nothing was set down");
    expect(chair.x).toBeCloseTo(5.674432, 6);
    expect(chair.z).toBeCloseTo(0, 9);
    const east = gangwayReview(set, r.dims, null).find((item) => sideOf(item) === "xMax");
    const floor = east === undefined ? null : floorOf(east);
    if (east === undefined || floor === null) throw new Error("the east gangway is not drawn as floor");
    const eastWalls = r.straight.filter((_, i) => r.sides[i] === "xMax");
    expect(floorClaims(r.walls, eastWalls, floor, GUIDANCE, TOUCHING)).toMatchObject({ offTheFloor: 0, beyondReach: 0 });
    // Every spot of a 200 by 200 grid over it that it winds round, once or more, is the room's floor.
    const xs = floor.map(([x]) => x);
    const zs = floor.map(([, z]) => z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const cell = ((maxX - minX) / 200) * ((maxZ - minZ) / 200);
    let wound = 0;
    let twice = 0;
    let off = 0;
    for (let i = 0; i < 200; i += 1) {
      for (let j = 0; j < 200; j += 1) {
        const x = minX + ((maxX - minX) * (i + 0.5)) / 200;
        const z = minZ + ((maxZ - minZ) * (j + 0.5)) / 200;
        const winding = windingOf(floor, x, z);
        if (winding === 0) continue;
        wound += 1;
        if (Math.abs(winding) >= 2) twice += 1;
        if (!onOrInside(r.walls, x, z, TOUCHING)) off += 1;
      }
    }
    expect(off).toBe(0);
    expect(wound * cell).toBeGreaterThan(0.6);
    // Here the gangway inside the north-east alcove's back wall and the triangle at the pier's front corner (5.95, 0.15)
    // both cover the floor before the alcove's mouth: some of it is wound round twice, and the outline's shoelace area is
    // more than the floor it covers. A union of the parts would end that; until then the nonzero rule draws it rightly.
    expect(twice * cell).toBeGreaterThan(0.01);
    expect(areaOf(floor)).toBeGreaterThan(wound * cell);
  });
});

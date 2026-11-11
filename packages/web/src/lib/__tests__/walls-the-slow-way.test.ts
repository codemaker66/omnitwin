// The slow way itself (walls-the-slow-way.ts), held to spots in the rooms worked out by hand from
// data/room-geometries: it is what the placement tests judge the planner by, so it is not taken on trust.
import { describe, expect, it } from "vitest";
import { roomGeometries } from "../../data/room-geometries.js";
import {
  areaOf,
  footprintInsideWalls,
  insideWalls,
  lengthAlongWall,
  nearestOnShape,
  onOrInside,
  rimToNearestWall,
  straightWalls,
  unitToPoint,
  unitToWall,
  unitToWallEveryStep,
  type Shape,
  type Walls,
} from "./walls-the-slow-way.js";

function wallsOf(name: string): Walls {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  return geometry.wallPolygon;
}

describe("the slow way round the Robert Adam Room", () => {
  const walls = wallsOf("Robert Adam Room");

  it.each([
    ["the middle of the upper section", 0, 0, true],
    ["the lower section", -2.85, 6.5, true],
    ["beside the lower section, east of its wall at x = −0.1", 3, 5, false],
    ["behind the curved west wall, which bows in to x = −4.5 at z = 6.2", -5.2, 6.2, false],
    ["the first door recess, x from −2.4 to −1.6 past the south wall", -2, 8.85, true],
    ["past the south wall between the two recesses", -2.85, 8.85, false],
    ["north of the north wall at z = −3.7", 0, -4.19, false],
  ])("knows %s", (_where, x, z, inside) => {
    expect(insideWalls(walls, x, z)).toBe(inside);
  });

  it("lets a chair's footprint stand a centimetre inside the north wall and not a centimetre through it", () => {
    expect(footprintInsideWalls(walls, 0, -3.7 + 0.29 + 0.01, 0.21, 0.29, 0)).toBe(true);
    expect(footprintInsideWalls(walls, 0, -3.7 + 0.29 - 0.01, 0.21, 0.29, 0)).toBe(false);
  });

  it("refuses a footprint astride the corner of the step, and takes one clear of it", () => {
    // The corner at (−0.1, 3.7): the upper section's floor to its north, the lower section's to its west, no floor to its south-east.
    expect(footprintInsideWalls(walls, -0.3, 3.5, 0.5, 0.5, 0)).toBe(false);
    expect(footprintInsideWalls(walls, -0.7, 3.5, 0.5, 0.5, 0)).toBe(true);
  });

  it("measures a round's rim to the nearest wall", () => {
    // 3.7 m to the north wall, less its 0.915 m radius.
    expect(rimToNearestWall(walls, 0, 0, 0.915)).toBeCloseTo(2.785, 6);
    // To the lower section's east wall at x = −0.1.
    expect(rimToNearestWall(walls, -1.515, 6.2, 0.915)).toBeCloseTo(0.5, 6);
    // To the curve's apex at (−4.5, 6.2).
    expect(rimToNearestWall(walls, -3.085, 6.2, 0.915)).toBeCloseTo(0.5, 6);
  });
});

describe("the slow way round the Saloon and the Reception Room", () => {
  it("knows an alcove from the pier between two", () => {
    const walls = wallsOf("Saloon");
    expect(insideWalls(walls, 6.25, -1.05)).toBe(true);
    expect(insideWalls(walls, 6.25, 0)).toBe(false);
  });

  it("refuses a footprint the pier passes through, though its centre and all four corners stand in the alcoves", () => {
    const walls = wallsOf("Saloon");
    // The pier is 0.3 m wide, z from −0.15 to 0.15, between alcoves that run out to x = 6.55.
    expect(footprintInsideWalls(walls, 6.2, 0.4, 0.2, 0.6, 0)).toBe(false);
    // Wholly in the alcove north of it.
    expect(footprintInsideWalls(walls, 6.2, 1.05, 0.2, 0.5, 0)).toBe(true);
  });

  it("knows the Reception Room's stepped-in corners", () => {
    const walls = wallsOf("Reception Room");
    expect(insideWalls(walls, 3.0, 3.0)).toBe(true);
    expect(insideWalls(walls, 4.3, 3.0)).toBe(false);
    expect(insideWalls(walls, 4.3, 0.5)).toBe(true);
  });
});

describe("a unit of furniture measured to one wall the slow way", () => {
  /** A 6 ft trestle: 1.83 m by 0.76 m. */
  const trestle = (x: number, z: number, turn: number): Shape => ({ kind: "box", x, z, halfW: 0.915, halfD: 0.38, turn });
  const round = (x: number, z: number): Shape => ({ kind: "disc", x, z, radius: 0.915 });

  it("takes two stretches of one straight wall as one wall, and no others", () => {
    // The Robert Adam Room's west wall is drawn in two stretches that meet at (−5.7, 3.7): 22 corners, 21 walls.
    const robertAdam = straightWalls(wallsOf("Robert Adam Room"));
    expect(robertAdam).toHaveLength(21);
    const west = robertAdam.find(([ax, , bx, bz]) => ax === -5.7 && bx === -5.7 && bz === -3.7);
    expect(west?.[1]).toBeCloseTo(4.2, 9);
    // The Saloon's wall between two alcoves is in line with the wall either side, but an alcove's mouth parts them.
    expect(straightWalls(wallsOf("Saloon"))).toHaveLength(20);
    expect(straightWalls(wallsOf("Reception Room"))).toHaveLength(8);
  });

  it("finds the point of a turned box nearest a point", () => {
    // Turned a quarter, the trestle runs along z: 0.38 m either side in x.
    const quarter = nearestOnShape(trestle(0, 0, Math.PI / 2), 1, 0.2);
    expect(quarter.gap).toBeCloseTo(0.62, 9);
    expect(quarter.x).toBeCloseTo(0.38, 9);
    expect(quarter.z).toBeCloseTo(0.2, 9);
    // Turned 30°, its long axis runs along (cos 30°, −sin 30°): half a metre past the middle of that end.
    const along = [Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)] as const;
    const past = nearestOnShape(trestle(0, 0, Math.PI / 6), along[0] * 1.415, along[1] * 1.415);
    expect(past.gap).toBeCloseTo(0.5, 9);
    expect(past.x).toBeCloseTo(along[0] * 0.915, 9);
    expect(past.z).toBeCloseTo(along[1] * 0.915, 9);
    // A point inside it is no way off.
    expect(nearestOnShape(trestle(0, 0, Math.PI / 6), 0.3, -0.1).gap).toBe(0);
  });

  it("finds the point of a disc nearest a point", () => {
    const near = nearestOnShape(round(0, 0), 2, 0);
    expect(near.gap).toBeCloseTo(1.085, 9);
    expect(near.x).toBeCloseTo(0.915, 9);
    expect(unitToPoint([round(0, 0), trestle(3, 0, 0)], 2, 0)).toBeCloseTo(0.085, 9);
  });

  it("measures a unit to a wall by its nearest piece, and says where on the wall", () => {
    // A round 0.5 m from the Robert Adam Room's lower east wall, x = −0.1 from z = 3.7 to z = 8.7; a trestle further off.
    const lowerEast = [-0.1, 3.7, -0.1, 8.7] as const;
    const beside = unitToWall([trestle(-3, 6.2, 0), round(-1.515, 6.2)], lowerEast);
    expect(beside.gap).toBeCloseTo(0.5, 6);
    expect(beside.x).toBeCloseTo(-0.1, 9);
    expect(beside.z).toBeCloseTo(6.2, 3);
    expect(beside.pieceX).toBeCloseTo(-0.6, 6);
    // A round north-west of the step's corner (−0.1, 3.7) is nearest the wall east of it at that corner: √(1.2² + 1.1²) less its radius.
    const step = [5.7, 3.7, -0.1, 3.7] as const;
    const corner = unitToWall([round(-1.3, 2.6)], step);
    expect(corner.gap).toBeCloseTo(Math.hypot(1.2, 1.1) - 0.915, 9);
    expect(corner.x).toBeCloseTo(-0.1, 9);
    expect(corner.z).toBeCloseTo(3.7, 9);
  });

  it("gives the same answer walking only where the nearest step can be as walking every step", () => {
    // A trestle with a chair either side and a round beside it, stood at spots near and far from the walls of each room.
    const unitAt = (x: number, z: number, turn: number): readonly Shape[] => [
      trestle(x, z, turn),
      { kind: "box", x: x + 0.67 * Math.sin(turn), z: z + 0.67 * Math.cos(turn), halfW: 0.21, halfD: 0.29, turn },
      { kind: "box", x: x - 0.67 * Math.sin(turn), z: z - 0.67 * Math.cos(turn), halfW: 0.21, halfD: 0.29, turn: turn + Math.PI },
      round(x + 1.9, z + 0.3),
    ];
    let compared = 0;
    for (const name of ["Robert Adam Room", "Reception Room", "Saloon"]) {
      const walls = straightWalls(wallsOf(name));
      for (const [x, z, turn] of [[-3.1, 0.4, 0], [-4.4, 4.6, 0.5], [2.2, 1.7, 1.1], [4.4, -0.2, Math.PI / 2], [-2.9, 5.8, 2.3]] as const) {
        for (const wall of walls) {
          expect(unitToWall(unitAt(x, z, turn), wall)).toEqual(unitToWallEveryStep(unitAt(x, z, turn), wall));
          compared += 1;
        }
      }
    }
    expect(compared).toBe(5 * (21 + 8 + 20));
  });

  it("reads a drawn floor: its size, what it covers and which wall it lies along", () => {
    // 1.1 m of gangway inside the lower east wall, from z = 5 to z = 7.
    const floor: Walls = [[-0.1, 5], [-0.1, 7], [-1.2, 7], [-1.2, 5]];
    expect(areaOf(floor)).toBeCloseTo(2.2, 9);
    expect(areaOf([[-0.1, 5], [-0.1, 5], [-1.2, 5], [-1.2, 5]])).toBe(0);
    expect(lengthAlongWall(floor, [-0.1, 3.7, -0.1, 8.7])).toBeCloseTo(2, 9);
    expect(lengthAlongWall(floor, [5.7, 3.7, -0.1, 3.7])).toBe(0);
    expect(onOrInside(floor, -0.1, 6, 0.001)).toBe(true);
    expect(onOrInside(floor, -0.6, 6, 0.001)).toBe(true);
    expect(onOrInside(floor, -0.1, 7.5, 0.001)).toBe(false);
  });
});

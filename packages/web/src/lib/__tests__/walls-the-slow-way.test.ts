// The slow way itself (walls-the-slow-way.ts), held to spots in the rooms worked out by hand from
// data/room-geometries: it is what the placement tests judge the planner by, so it is not taken on trust.
import { describe, expect, it } from "vitest";
import { roomGeometries } from "../../data/room-geometries.js";
import {
  areaOf,
  floorClaims,
  footprintInsideWalls,
  gapBetweenEnds,
  inOneLine,
  insideWalls,
  lengthAlongWall,
  liesAgainst,
  nearestBetweenEnds,
  nearestOnShape,
  onOrInside,
  reaches,
  rimToNearestWall,
  sideOfWall,
  squareIntoRoom,
  standsOnTheFloor,
  straightWalls,
  unitToPoint,
  unitToWall,
  unitToWallEveryStep,
  wayKeepsToFloor,
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

  it("knows a straight way that keeps to the floor from one through a pier or behind a wall", () => {
    const saloon = wallsOf("Saloon");
    // The east pier, z from −0.15 to 0.15, is solid from its face at x = 5.95 back to x = 6.55, where the alcoves either side end.
    expect(wayKeepsToFloor(saloon, 6.55, 0.15, 6.55, -0.15, 1e-6)).toBe(false);
    expect(wayKeepsToFloor(saloon, 6.3, -0.5, 6.3, 0.5, 1e-6)).toBe(false);
    // Along the pier's face, along an alcove's back wall, and through the room's corner at the alcove's mouth, it keeps to the floor.
    expect(wayKeepsToFloor(saloon, 5.95, 0.15, 5.95, -0.15, 1e-6)).toBe(true);
    expect(wayKeepsToFloor(saloon, 6.55, -1.95, 6.55, -0.15, 1e-6)).toBe(true);
    expect(wayKeepsToFloor(saloon, 6.25, -0.45, 5.65, 0.15, 1e-6)).toBe(true);
    // A way of no length.
    expect(wayKeepsToFloor(saloon, 6.55, 0.15, 6.55, 0.15, 1e-6)).toBe(true);
    // The Robert Adam Room's curve bows in to x = −4.5 at z = 6.2: x = −4.8 is the room's floor at both ends of the way and behind the curve between.
    const robertAdam = wallsOf("Robert Adam Room");
    expect(wayKeepsToFloor(robertAdam, -4.8, 8.0, -4.8, 4.4, 1e-6)).toBe(false);
    expect(wayKeepsToFloor(robertAdam, -4.0, 8.0, -4.0, 4.4, 1e-6)).toBe(true);
  });

  it("knows a piece wholly on the floor from one through a wall", () => {
    const saloon = wallsOf("Saloon");
    const box = (x: number, z: number, halfW: number, halfD: number, turn: number): Shape => ({ kind: "box", x, z, halfW, halfD, turn });
    // A banquet chair flush in the corner of the south-east alcove beside the pier: on the floor, touching two walls.
    expect(standsOnTheFloor(saloon, box(6.325, -0.375, 0.225, 0.225, 0))).toBe(true);
    // A trestle's chair whose back edge is 5 mm inside the west pier, z = −0.15, from x = −6.445 to −6.025.
    expect(standsOnTheFloor(saloon, box(-6.235, 0.145, 0.21, 0.29, 0))).toBe(false);
    // A chair astride the pier's front corner (5.95, −0.15): its corners in the room and the alcove, the wall's corner inside it.
    expect(standsOnTheFloor(saloon, box(5.95, -0.15, 0.2, 0.2, Math.PI / 4))).toBe(false);
    // A 6 ft round in the middle of the room, and one whose rim crosses the north wall, z = 3.45.
    expect(standsOnTheFloor(saloon, { kind: "disc", x: 0, z: 0, radius: 0.915 })).toBe(true);
    expect(standsOnTheFloor(saloon, { kind: "disc", x: 0, z: 2.95, radius: 0.915 })).toBe(false);
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

describe("a piece set against the walls, judged the slow way", () => {
  /** A 6 ft trestle: 1.83 m by 0.76 m. */
  const trestle = (x: number, z: number, turn: number): Shape => ({ kind: "box", x, z, halfW: 0.915, halfD: 0.38, turn });
  const round = (x: number, z: number): Shape => ({ kind: "disc", x, z, radius: 0.915 });
  const saloon = wallsOf("Saloon");
  const robertAdam = wallsOf("Robert Adam Room");
  // The pier between the Saloon's west alcoves, and the side wall of the alcove north of it, which ends at the pier's corner.
  const pier = [-5.95, 0.15, -5.95, -0.15] as const;
  const alcoveSide = [-6.55, 0.15, -5.95, 0.15] as const;

  it("knows which side of a unit each wall stands on", () => {
    // The pier faces east into the room: a unit in front of it has it to its west.
    expect(sideOfWall(saloon, pier)).toBe("xMin");
    expect(squareIntoRoom(saloon, pier)).toEqual([1, 0]);
    // The alcove's side wall faces north, into the alcove.
    expect(sideOfWall(saloon, alcoveSide)).toBe("zMin");
    // The Robert Adam Room: the upper section's south wall, the lower section's east wall, and the curve's first two stretches.
    expect(sideOfWall(robertAdam, [5.7, 3.7, -0.1, 3.7])).toBe("zMax");
    expect(sideOfWall(robertAdam, [-0.1, 3.7, -0.1, 8.7])).toBe("xMax");
    expect(sideOfWall(robertAdam, [-5.7, 8.2, -4.9, 7.5])).toBe("zMin");
    expect(sideOfWall(robertAdam, [-4.9, 7.5, -4.6, 6.7])).toBe("xMin");
  });

  it("knows two walls in one line from two that only run the same way", () => {
    // The pier is in line with the wall south of the alcove beside it: the alcove's mouth parts them.
    expect(inOneLine(saloon, pier, [-5.95, -1.95, -5.95, -3.45])).toBe(true);
    // The alcove's back wall runs the same way 0.6 m further back; the east wall's pier faces the other way.
    expect(inOneLine(saloon, pier, [-6.55, -0.15, -6.55, -1.95])).toBe(false);
    expect(inOneLine(saloon, pier, [5.95, -0.15, 5.95, 0.15])).toBe(false);
    // The Robert Adam Room's bottom wall either side of a door recess, and the recess's own back wall 0.3 m behind.
    expect(inOneLine(robertAdam, [-0.1, 8.7, -1.6, 8.7], [-2.4, 8.7, -3.3, 8.7])).toBe(true);
    expect(inOneLine(robertAdam, [-0.1, 8.7, -1.6, 8.7], [-1.6, 9, -2.4, 9])).toBe(false);
  });

  it("tells a piece lying against a wall from one that only reaches the wall's end", () => {
    // Turned a quarter and set against the pier: 0.3 m of its long side lies on the pier, and it crosses both alcoves' mouths.
    const againstPier = trestle(-5.95 + 0.38, 0, Math.PI / 2);
    expect(liesAgainst(againstPier, pier)).toBe(true);
    expect(gapBetweenEnds(againstPier, pier)).toBeLessThan(1e-12);
    // The first place it lies on the pier: a millimetre in from the pier's first end, (−5.95, 0.15).
    const first = nearestBetweenEnds(againstPier, pier);
    expect(first.x).toBeCloseTo(-5.95, 9);
    expect(first.z).toBeCloseTo(0.149, 4);
    // The alcove's side wall it touches at the corner (−5.95, 0.15) and nowhere else.
    expect(reaches(againstPier, -5.95, 0.15)).toBe(true);
    expect(liesAgainst(againstPier, alcoveSide)).toBe(false);
    expect(gapBetweenEnds(againstPier, alcoveSide)).toBeCloseTo(0.001, 6);
    // Half a millimetre off the pier it lies against nothing.
    expect(liesAgainst(trestle(-5.95 + 0.38 + 0.0005, 0, Math.PI / 2), pier)).toBe(false);
    expect(gapBetweenEnds(trestle(-5.95 + 0.38 + 0.0005, 0, Math.PI / 2), pier)).toBeCloseTo(0.0005, 9);
  });

  it("counts a touch as against a wall only past the wall's first and last millimetre", () => {
    // Against the Robert Adam Room's upper south wall, z = 3.7 from x = 5.7 to x = −0.1: its long side on the wall's line, ending 5 mm east of the step's corner, then half a millimetre.
    const south = [5.7, 3.7, -0.1, 3.7] as const;
    expect(liesAgainst(trestle(-0.1 + 0.005 - 0.915, 3.7 - 0.38, 0), south)).toBe(true);
    expect(liesAgainst(trestle(-0.1 + 0.0005 - 0.915, 3.7 - 0.38, 0), south)).toBe(false);
    // Either way it covers the corner itself.
    expect(reaches(trestle(-0.1 + 0.0005 - 0.915, 3.7 - 0.38, 0), -0.1, 3.7)).toBe(true);
  });

  it("finds a touch at one point between two steps of the walk, and a piece through the wall", () => {
    const north = [-5.7, -3.7, 5.7, -3.7] as const;
    // Turned 30°, the trestle's lowest corner stands 0.915 sin 30° + 0.38 cos 30° below its middle: set so that corner just touches the north wall, at an x no step of the walk lands on.
    const reach = 0.915 * Math.sin(Math.PI / 6) + 0.38 * Math.cos(Math.PI / 6);
    expect(liesAgainst(trestle(0.12345, -3.7 + reach, Math.PI / 6), north)).toBe(true);
    expect(liesAgainst(trestle(0.12345, -3.7 + reach + 0.0001, Math.PI / 6), north)).toBe(false);
    // A round touching the wall, and one a millimetre clear.
    expect(liesAgainst(round(1.00037, -3.7 + 0.915), north)).toBe(true);
    expect(liesAgainst(round(1.00037, -3.7 + 0.916), north)).toBe(false);
    // A trestle the wall passes through.
    expect(liesAgainst(trestle(2, -3.7, 0), north)).toBe(true);
    // One nowhere near.
    expect(gapBetweenEnds(trestle(0, 0, 0), north)).toBe(Number.POSITIVE_INFINITY);
  });

  it("asks a drawn floor what it claims", () => {
    const east = straightWalls(saloon).filter((wall) => sideOfWall(saloon, wall) === "xMax");
    // The gangway inside the Saloon's east wall south of the alcove, 1.1 m deep: all of it the room's floor, all within 1.1 m of an east wall.
    const stretch: Walls = [[5.95, -3.0], [5.95, -1.95], [4.85, -1.95], [4.85, -3.0]];
    expect(floorClaims(saloon, east, stretch, 1.1, 1e-6)).toMatchObject({ offTheFloor: 0, beyondReach: 0 });
    // Carried on across the alcove's mouth, where the wall is 0.6 m further back, it claims open floor more than 1.1 m from any east wall.
    const acrossMouth: Walls = [[5.95, -3.0], [5.95, -0.15], [4.85, -0.15], [4.85, -3.0]];
    const across = floorClaims(saloon, east, acrossMouth, 1.1, 1e-6);
    expect(across.offTheFloor).toBe(0);
    expect(across.beyondReach).toBeGreaterThan(10);
    // Carried on through the south wall, z = −3.45, it claims floor that is not the room's.
    const throughWall: Walls = [[5.95, -4.0], [5.95, -1.95], [4.85, -1.95], [4.85, -4.0]];
    expect(floorClaims(saloon, east, throughWall, 1.1, 1e-6).offTheFloor).toBeGreaterThan(20);
    // Two stretches drawn as one outline, joined round the alcove's walls there and back: the line between them claims nothing.
    const joined: Walls = [
      [5.95, -3.0], [4.85, -3.0], [4.85, -1.95], [5.95, -1.95],
      [6.55, -1.95], [6.55, -0.15], [5.95, -0.15],
      [4.85, -0.15], [4.85, 0.15], [5.95, 0.15],
      [5.95, -0.15], [6.55, -0.15], [6.55, -1.95], [5.95, -1.95],
    ];
    expect(areaOf(joined)).toBeCloseTo(1.05 * 1.1 + 0.3 * 1.1, 9);
    expect(floorClaims(saloon, east, joined, 1.1, 1e-6)).toMatchObject({ offTheFloor: 0, beyondReach: 0 });
  });
});

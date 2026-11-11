// The slow way itself (walls-the-slow-way.ts), held to spots in the rooms worked out by hand from
// data/room-geometries: it is what the placement tests judge the planner by, so it is not taken on trust.
import { describe, expect, it } from "vitest";
import { roomGeometries } from "../../data/room-geometries.js";
import { footprintInsideWalls, insideWalls, rimToNearestWall, type Walls } from "./walls-the-slow-way.js";

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

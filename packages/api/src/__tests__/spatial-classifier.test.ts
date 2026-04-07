import { describe, it, expect } from "vitest";
import {
  classifyZone,
  classifyPosition,
  computeNearestWall,
  computeNearestFeature,
  type RoomLayout,
  type ZoneName,
} from "../services/spatial-classifier.js";

// ---------------------------------------------------------------------------
// Grand Hall test room: 21m × 10.5m, origin at centre
// ---------------------------------------------------------------------------

const GRAND_HALL: RoomLayout = {
  widthM: 21,
  lengthM: 10.5,
  features: [
    { name: "entrance", x: 0, z: -5.25 },
    { name: "stage", x: 0, z: 4.5 },
  ],
};

const EMPTY_ROOM: RoomLayout = { widthM: 10, lengthM: 8, features: [] };

// ---------------------------------------------------------------------------
// classifyZone — 3×3 grid classification
// ---------------------------------------------------------------------------

describe("classifyZone", () => {
  const w = 21;
  const l = 10.5;

  it("object at exact centre → 'centre'", () => {
    expect(classifyZone(0, 0, w, l)).toBe("centre");
  });

  it("object at near-centre → 'centre'", () => {
    expect(classifyZone(0.5, 0.5, w, l)).toBe("centre");
  });

  it("object at front-left corner → 'front-left'", () => {
    expect(classifyZone(-9, -4.5, w, l)).toBe("front-left");
  });

  it("object at front-centre → 'front-centre'", () => {
    expect(classifyZone(0, -4.5, w, l)).toBe("front-centre");
  });

  it("object at front-right → 'front-right'", () => {
    expect(classifyZone(9, -4.5, w, l)).toBe("front-right");
  });

  it("object at back-left → 'back-left'", () => {
    expect(classifyZone(-9, 4.5, w, l)).toBe("back-left");
  });

  it("object at back-centre → 'back-centre'", () => {
    expect(classifyZone(0, 4.5, w, l)).toBe("back-centre");
  });

  it("object at back-right → 'back-right'", () => {
    expect(classifyZone(9, 4.5, w, l)).toBe("back-right");
  });

  it("object at centre-left → 'centre-left'", () => {
    expect(classifyZone(-9, 0, w, l)).toBe("centre-left");
  });

  it("object at centre-right → 'centre-right'", () => {
    expect(classifyZone(9, 0, w, l)).toBe("centre-right");
  });

  it("all 9 zones are reachable", () => {
    const zones = new Set<ZoneName>();
    const positions: readonly [number, number][] = [
      [-9, -4.5], [0, -4.5], [9, -4.5],
      [-9, 0], [0, 0], [9, 0],
      [-9, 4.5], [0, 4.5], [9, 4.5],
    ];
    for (const [x, z] of positions) {
      zones.add(classifyZone(x, z, w, l));
    }
    expect(zones.size).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// computeNearestWall
// ---------------------------------------------------------------------------

describe("computeNearestWall", () => {
  it("object at centre is equidistant to north/south walls in square room", () => {
    const result = computeNearestWall(0, 0, 10, 10);
    expect(result.distanceM).toBe(5);
  });

  it("object against north wall (front)", () => {
    const result = computeNearestWall(0, -4.9, 10, 10);
    expect(result.wall).toBe("north");
    expect(result.distanceM).toBeCloseTo(0.1, 1);
  });

  it("object against east wall (right)", () => {
    const result = computeNearestWall(4.8, 0, 10, 10);
    expect(result.wall).toBe("east");
    expect(result.distanceM).toBeCloseTo(0.2, 1);
  });

  it("object against south wall (back)", () => {
    const result = computeNearestWall(0, 4.9, 10, 10);
    expect(result.wall).toBe("south");
    expect(result.distanceM).toBeCloseTo(0.1, 1);
  });

  it("object against west wall (left)", () => {
    const result = computeNearestWall(-4.8, 0, 10, 10);
    expect(result.wall).toBe("west");
    expect(result.distanceM).toBeCloseTo(0.2, 1);
  });

  it("distance is never negative", () => {
    // Object outside room bounds
    const result = computeNearestWall(6, 0, 10, 10);
    expect(result.distanceM).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// computeNearestFeature
// ---------------------------------------------------------------------------

describe("computeNearestFeature", () => {
  it("returns null when no features defined", () => {
    expect(computeNearestFeature(0, 0, [])).toBeNull();
  });

  it("finds nearest of two features", () => {
    const features = [
      { name: "entrance", x: 0, z: -5 },
      { name: "stage", x: 0, z: 5 },
    ];
    // Object near the stage
    const result = computeNearestFeature(0, 4, features);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("stage");
    expect(result!.distanceM).toBeCloseTo(1, 1);
  });

  it("returns exact distance 0 when on top of a feature", () => {
    const features = [{ name: "entrance", x: 0, z: 0 }];
    const result = computeNearestFeature(0, 0, features);
    expect(result!.distanceM).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// classifyPosition — full description generation
// ---------------------------------------------------------------------------

describe("classifyPosition", () => {
  it("object at centre of room near stage", () => {
    const result = classifyPosition(0, 1, GRAND_HALL);
    expect(result.zone).toBe("centre");
    expect(result.description).toContain("Centre of room");
    expect(result.description).toContain("stage");
  });

  it("object against north wall includes 'against'", () => {
    const result = classifyPosition(0, -5.0, GRAND_HALL);
    expect(result.description).toContain("against north wall");
  });

  it("object in front-right zone", () => {
    const result = classifyPosition(8, -4, GRAND_HALL);
    expect(result.zone).toBe("front-right");
    expect(result.description).toContain("Front-right");
  });

  it("empty room (no features) uses wall distance", () => {
    const result = classifyPosition(0, 0, EMPTY_ROOM);
    expect(result.zone).toBe("centre");
    expect(result.description).toContain("Centre of room");
    expect(result.description).toMatch(/\d+\.\dm from/);
  });

  it("returns valid wall name", () => {
    const result = classifyPosition(4, 0, EMPTY_ROOM);
    expect(["north", "south", "east", "west"]).toContain(result.nearestWall);
  });

  it("nearestWallDistanceM is non-negative", () => {
    const result = classifyPosition(-100, 0, EMPTY_ROOM);
    expect(result.nearestWallDistanceM).toBeGreaterThanOrEqual(0);
  });
});

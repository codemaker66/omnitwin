import { describe, expect, it } from "vitest";
import type { TwinScanNode } from "@omnitwin/types";
import { pickTravelTarget, travelKeyToDirection } from "../travel.js";

// E57 frame: Z-up, positions in metres. e57PointToThree maps [x,y,z]→[x,z,−y],
// so an E57 +x offset stays three +x, and E57 −y becomes three +z (toward the
// default camera). The fixtures below are authored in E57 space.
function node(id: string, x: number, y: number, z = 1.5): TwinScanNode {
  return {
    id,
    index: Number(id.slice(5)),
    pose: { q: [1, 0, 0, 0], t: [x, y, z] },
    floor: 0,
    roomSlug: null,
  };
}

const nodes = new Map<string, TwinScanNode>([
  ["scan_001", node("scan_001", 3, 0)], // three: [3, 1.5, 0] → +x of origin
  ["scan_002", node("scan_002", -3, 0)], // three: [-3, 1.5, 0]
  ["scan_003", node("scan_003", 0, 3)], // three: [0, 1.5, -3]
  ["scan_004", node("scan_004", 7, 0)], // further down the same +x line
]);
const HERE: readonly [number, number, number] = [0, 1.5, 0];
const ALL = [...nodes.keys()];

describe("pickTravelTarget", () => {
  it("picks the neighbour in the pointed direction", () => {
    expect(pickTravelTarget(HERE, [1, 0, 0], ALL, nodes)).toBe("scan_001");
    expect(pickTravelTarget(HERE, [-1, 0, 0], ALL, nodes)).toBe("scan_002");
    expect(pickTravelTarget(HERE, [0, 0, -1], ALL, nodes)).toBe("scan_003");
  });

  it("prefers the next step over a farther node on the same line", () => {
    expect(pickTravelTarget(HERE, [1, 0, 0], ["scan_001", "scan_004"], nodes)).toBe(
      "scan_001",
    );
  });

  it("returns null when nothing lies inside the travel cone", () => {
    // Only +x neighbours offered; aiming three +z (E57 −y) misses them all.
    expect(pickTravelTarget(HERE, [0, 0, 1], ["scan_001", "scan_004"], nodes)).toBeNull();
  });

  it("damps the vertical component — aiming at the floor still walks forward", () => {
    // ~60° below horizontal toward +x: undamped this fails the 55° cone.
    const steep: readonly [number, number, number] = [0.5, -0.87, 0];
    expect(pickTravelTarget(HERE, steep, ALL, nodes)).toBe("scan_001");
  });

  it("ignores unknown ids and a zero direction", () => {
    expect(pickTravelTarget(HERE, [1, 0, 0], ["ghost"], nodes)).toBeNull();
    expect(pickTravelTarget(HERE, [0, 0, 0], ALL, nodes)).toBeNull();
  });
});

describe("travelKeyToDirection", () => {
  it("maps WASD and arrows; passes everything else through as null", () => {
    expect(travelKeyToDirection("w")).toEqual({ forward: 1, right: 0 });
    expect(travelKeyToDirection("W")).toEqual({ forward: 1, right: 0 });
    expect(travelKeyToDirection("ArrowUp")).toEqual({ forward: 1, right: 0 });
    expect(travelKeyToDirection("s")).toEqual({ forward: -1, right: 0 });
    expect(travelKeyToDirection("a")).toEqual({ forward: 0, right: -1 });
    expect(travelKeyToDirection("ArrowRight")).toEqual({ forward: 0, right: 1 });
    expect(travelKeyToDirection("q")).toBeNull();
    expect(travelKeyToDirection("Enter")).toBeNull();
  });
});

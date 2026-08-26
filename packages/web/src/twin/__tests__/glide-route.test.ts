import { describe, expect, it } from "vitest";
import type { TwinScanNode } from "@omnitwin/types";
import {
  appendToGlideRoute,
  buildGlideRoute,
  GLIDE_STOP_SNAP_M,
  positionAlongRoute,
  segmentAlongRoute,
  stopArcForRelease,
  tangentAlongRoute,
} from "../glide-route.js";

// -----------------------------------------------------------------------------
// glide-route — pure math for the continuous glide. Everything here runs with
// no renderer and no clock: routes are built from real manifest-shaped nodes,
// and every derived quantity (arc lengths, positions, tangents, stop targets)
// is asserted against hand-computed geometry.
//
// The node fixtures use the E57 frame the manifest carries (z-up); the route
// converts through e57PointToThree exactly as the stages do, so a route
// position can be handed straight to the camera dolly. An E57 point [x, y, z]
// lands in three space as [x, z, -y].
// -----------------------------------------------------------------------------

function node(id: string, t: readonly [number, number, number]): TwinScanNode {
  return {
    id,
    index: 0,
    pose: { q: [0, 0, 0, 1], t: [...t] },
    floor: 0,
    roomSlug: null,
  };
}

/** Three nodes in a right-angled corridor. In THREE space (after [x,z,-y]):
 *  a=(0,0,0) → b=(4,0,0) → c=(4,0,-3): a 4 m leg then a 3 m leg. */
const corridorNodes = new Map<string, TwinScanNode>([
  ["a", node("a", [0, 0, 0])],
  ["b", node("b", [4, 0, 0])],
  ["c", node("c", [4, 3, 0])],
]);

describe("buildGlideRoute", () => {
  it("computes cumulative arc lengths over the polyline", () => {
    const route = buildGlideRoute(["a", "b", "c"], corridorNodes);
    expect(route).not.toBeNull();
    expect(route?.nodeIds).toEqual(["a", "b", "c"]);
    expect(route?.cums).toEqual([0, 4, 7]);
    expect(route?.total).toBe(7);
  });

  it("returns null for fewer than two nodes", () => {
    expect(buildGlideRoute(["a"], corridorNodes)).toBeNull();
    expect(buildGlideRoute([], corridorNodes)).toBeNull();
  });

  it("returns null when any node id is unknown", () => {
    expect(buildGlideRoute(["a", "ghost"], corridorNodes)).toBeNull();
  });

  it("drops a zero-length step rather than emitting a degenerate segment", () => {
    const withDuplicate = new Map(corridorNodes);
    withDuplicate.set("a2", node("a2", [0, 0, 0]));
    const route = buildGlideRoute(["a", "a2", "b"], withDuplicate);
    expect(route?.nodeIds).toEqual(["a", "b"]);
    expect(route?.total).toBe(4);
  });
});

describe("segmentAlongRoute", () => {
  const route = buildGlideRoute(["a", "b", "c"], corridorNodes);
  if (route === null) {
    throw new Error("fixture route failed to build");
  }

  it("derives segment endpoints and fraction from distance", () => {
    expect(segmentAlongRoute(route, 1)).toEqual({
      index: 0,
      fromId: "a",
      toId: "b",
      frac: 0.25,
    });
    // 5 m in: 1 m into the second (3 m) leg.
    const second = segmentAlongRoute(route, 5);
    expect(second.fromId).toBe("b");
    expect(second.toId).toBe("c");
    expect(second.frac).toBeCloseTo(1 / 3, 10);
  });

  it("clamps below zero and beyond the total", () => {
    expect(segmentAlongRoute(route, -1).frac).toBe(0);
    const end = segmentAlongRoute(route, 99);
    expect(end.fromId).toBe("b");
    expect(end.toId).toBe("c");
    expect(end.frac).toBe(1);
  });

  it("lands the exact node boundary on the FOLLOWING segment's start", () => {
    // s = 4 is node b: the walk is standing on b about to travel toward c,
    // so the stages should present b as current with c arriving at frac 0.
    const at = segmentAlongRoute(route, 4);
    expect(at.fromId).toBe("b");
    expect(at.toId).toBe("c");
    expect(at.frac).toBe(0);
  });
});

describe("positionAlongRoute / tangentAlongRoute", () => {
  const route = buildGlideRoute(["a", "b", "c"], corridorNodes);
  if (route === null) {
    throw new Error("fixture route failed to build");
  }

  it("interpolates positions in three space", () => {
    expect(positionAlongRoute(route, 0)).toEqual([0, 0, 0]);
    expect(positionAlongRoute(route, 2)).toEqual([2, 0, 0]);
    // 1.5 m into the second leg, which runs toward -z in three space.
    expect(positionAlongRoute(route, 5.5)).toEqual([4, 0, -1.5]);
  });

  it("returns the horizontal unit tangent of the active segment", () => {
    expect(tangentAlongRoute(route, 2)).toEqual([1, 0]);
    const secondLeg = tangentAlongRoute(route, 6);
    expect(secondLeg[0]).toBeCloseTo(0, 10);
    expect(secondLeg[1]).toBeCloseTo(-1, 10);
  });
});

describe("stopArcForRelease", () => {
  const route = buildGlideRoute(["a", "b", "c"], corridorNodes);
  if (route === null) {
    throw new Error("fixture route failed to build");
  }

  it("carries forward to the node ahead — releasing never backtracks", () => {
    expect(stopArcForRelease(route, 1.2)).toBe(4);
    expect(stopArcForRelease(route, 4.5)).toBe(7);
  });

  it("stops in place when the release lands within the snap of a PASSED node", () => {
    expect(stopArcForRelease(route, 4 + GLIDE_STOP_SNAP_M / 2)).toBe(4);
  });

  it("never stops back on the origin — a tap always completes its first step", () => {
    expect(stopArcForRelease(route, 0.01)).toBe(4);
  });

  it("clamps to the route's final node", () => {
    expect(stopArcForRelease(route, 7)).toBe(7);
    expect(stopArcForRelease(route, 99)).toBe(7);
  });
});

describe("appendToGlideRoute", () => {
  const route = buildGlideRoute(["a", "b"], corridorNodes);
  if (route === null) {
    throw new Error("fixture route failed to build");
  }

  it("extends the polyline and the arc table in place of a rebuild", () => {
    const extended = appendToGlideRoute(route, "c", corridorNodes);
    expect(extended).not.toBeNull();
    expect(extended?.nodeIds).toEqual(["a", "b", "c"]);
    expect(extended?.cums).toEqual([0, 4, 7]);
    expect(extended?.total).toBe(7);
    // The original is untouched — callers hold it in refs across frames.
    expect(route.nodeIds).toEqual(["a", "b"]);
  });

  it("refuses unknown nodes, repeats of the tail, and zero-length steps", () => {
    expect(appendToGlideRoute(route, "ghost", corridorNodes)).toBeNull();
    expect(appendToGlideRoute(route, "b", corridorNodes)).toBeNull();
  });
});

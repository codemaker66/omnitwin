import { describe, expect, it } from "vitest";
import {
  checkAgainstPublished,
  sceneExtentForRoomFrame,
  sceneTransformForRoomFrame,
  withFloorOffset,
  Z_UP_TO_Y_UP_ROTATION_X,
} from "../align.js";
import type { RoomFrame } from "../obj-bounds.js";

/** A 12 x 7 x 5.4 m room whose capture origin sits well away from the room. */
function frame(overrides: Partial<RoomFrame> = {}): RoomFrame {
  return {
    min: [4, -20, 2],
    max: [16, -13, 7.4],
    center: [10, -16.5, 4.7],
    extent: [12, 7, 5.4],
    floorZ: 2,
    ceilingZ: 7.4,
    retainedFraction: 0.97,
    ...overrides,
  };
}

describe("sceneTransformForRoomFrame", () => {
  it("never scales, because captures and the scene are both metric", () => {
    expect(sceneTransformForRoomFrame(frame()).scale).toBe(1);
  });

  it("rotates Z-up into Y-up about X only", () => {
    expect(sceneTransformForRoomFrame(frame()).rotation).toEqual([Z_UP_TO_Y_UP_ROTATION_X, 0, 0]);
  });

  it("lands the room floor on the stage floor, not the room centre", () => {
    expect(sceneTransformForRoomFrame(frame()).position[1]).toBe(-2);
  });

  it("cancels the capture origin offset on both horizontal scene axes", () => {
    const position = sceneTransformForRoomFrame(frame()).position;
    expect(position[0]).toBe(-10);
    expect(position[2]).toBe(-16.5);
  });
});

describe("sceneExtentForRoomFrame", () => {
  it("reorders source XYZ into scene width/height/depth", () => {
    expect(sceneExtentForRoomFrame(frame())).toEqual([12, 5.4, 7]);
  });
});

describe("checkAgainstPublished", () => {
  it("agrees when the derived extent matches the published room", () => {
    const check = checkAgainstPublished(frame(), [12, 7, 5.4]);
    expect(check.verdict).toBe("agrees");
    expect(check.worstRelativeError).toBeLessThan(0.01);
  });

  it("agrees when width and depth are swapped, which is only a walk-in direction", () => {
    expect(checkAgainstPublished(frame(), [7, 12, 5.4]).verdict).toBe("agrees");
  });

  it("disagrees when the frame swallowed a corridor", () => {
    const check = checkAgainstPublished(frame({ extent: [40, 7, 5.4] }), [12, 7, 5.4]);
    expect(check.verdict).toBe("disagrees");
    expect(check.detail).toContain("before wiring this room");
  });

  it("disagrees on height alone, which a swapped horizontal pair cannot excuse", () => {
    expect(checkAgainstPublished(frame({ extent: [12, 7, 20] }), [12, 7, 5.4]).verdict).toBe("disagrees");
  });

  it("reports unpublished rather than inventing a pass", () => {
    const check = checkAgainstPublished(frame(), null);
    expect(check.verdict).toBe("unpublished");
    expect(check.worstRelativeError).toBeNull();
  });
});

describe("withFloorOffset", () => {
  // The mesh's lowest dense edge sat half a metre under the boards in five rooms
  // (2026-09-04), while the viewer draws the Gaussians, whose floor slab is what
  // a visitor stands on. The measured offset lifts the frame's floor to it.
  it("raises the floor and the frame's low edge by the measured offset, leaving the ceiling where the mesh saw it", () => {
    const lifted = withFloorOffset(frame(), 0.55);
    expect(lifted.floorZ).toBeCloseTo(2.55, 6);
    expect(lifted.min[2]).toBeCloseTo(2.55, 6);
    expect(lifted.ceilingZ).toBe(7.4);
    expect(lifted.max[2]).toBe(7.4);
    expect(lifted.extent[2]).toBeCloseTo(4.85, 6);
    expect(lifted.center[2]).toBeCloseTo((2.55 + 7.4) / 2, 6);
    expect(lifted.retainedFraction).toBe(0.97);
  });

  it("leaves the horizontal frame untouched", () => {
    const lifted = withFloorOffset(frame(), 0.55);
    expect(lifted.min[0]).toBe(4);
    expect(lifted.max[1]).toBe(-13);
    expect(lifted.center[0]).toBe(10);
  });

  it("lowers the placed room by exactly the offset, so the Gaussian floor slab lands on the stage floor", () => {
    const before = sceneTransformForRoomFrame(frame()).position[1];
    const after = sceneTransformForRoomFrame(withFloorOffset(frame(), 0.55)).position[1];
    expect(before - after).toBeCloseTo(0.55, 6);
  });

  it("is the identity at zero, so rooms whose Gaussian floor already matches the mesh are unchanged", () => {
    expect(withFloorOffset(frame(), 0)).toEqual(frame());
  });
});

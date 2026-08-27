import { describe, expect, it } from "vitest";
import {
  checkAgainstPublished,
  sceneExtentForRoomFrame,
  sceneTransformForRoomFrame,
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

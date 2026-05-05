import { describe, it, expect } from "vitest";
import {
  easeInOutCubic,
  lerpPosition,
  distance3D,
  computeTransitionDuration,
  generateBookmarkId,
  computeDefaultBookmarks,
  createCameraReferenceBookmark,
  resolveCameraEyeHeight,
  updateCameraReferenceHeight,
  advanceTransition,
  sampleTransition,
  SITTING_EYE_HEIGHT_M,
  STANDING_EYE_HEIGHT_M,
  MIN_CUSTOM_EYE_HEIGHT_M,
  MAX_CUSTOM_EYE_HEIGHT_M,
  MIN_TRANSITION_DURATION,
  MAX_TRANSITION_DURATION,
  REFERENCE_DISTANCE,
  type CameraTransition,
} from "../camera-animation.js";

// ---------------------------------------------------------------------------
// easeInOutCubic
// ---------------------------------------------------------------------------

describe("easeInOutCubic", () => {
  it("returns 0 at t=0", () => {
    expect(easeInOutCubic(0)).toBe(0);
  });

  it("returns 1 at t=1", () => {
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("returns 0.5 at t=0.5", () => {
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });

  it("clamps negative t to 0", () => {
    expect(easeInOutCubic(-0.5)).toBe(0);
  });

  it("clamps t > 1 to 1", () => {
    expect(easeInOutCubic(1.5)).toBe(1);
  });

  it("is monotonically increasing", () => {
    let prev = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-10);
      prev = v;
    }
  });

  it("ease-in phase: value at t=0.25 is less than 0.25 (slow start)", () => {
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
  });

  it("ease-out phase: value at t=0.75 is greater than 0.75 (slow finish)", () => {
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
  });

  it("is symmetric around t=0.5", () => {
    for (let t = 0; t <= 0.5; t += 0.05) {
      const low = easeInOutCubic(t);
      const high = easeInOutCubic(1 - t);
      expect(low + high).toBeCloseTo(1, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// lerpPosition
// ---------------------------------------------------------------------------

describe("lerpPosition", () => {
  const from: readonly [number, number, number] = [0, 0, 0];
  const to: readonly [number, number, number] = [10, 20, 30];

  it("returns from at t=0", () => {
    expect(lerpPosition(from, to, 0)).toEqual([0, 0, 0]);
  });

  it("returns to at t=1", () => {
    expect(lerpPosition(from, to, 1)).toEqual([10, 20, 30]);
  });

  it("returns midpoint at t=0.5", () => {
    expect(lerpPosition(from, to, 0.5)).toEqual([5, 10, 15]);
  });

  it("clamps t below 0 to from", () => {
    expect(lerpPosition(from, to, -1)).toEqual([0, 0, 0]);
  });

  it("clamps t above 1 to to", () => {
    expect(lerpPosition(from, to, 2)).toEqual([10, 20, 30]);
  });

  it("interpolates negative coordinates", () => {
    const a: readonly [number, number, number] = [-5, 0, 10];
    const b: readonly [number, number, number] = [5, 0, -10];
    const result = lerpPosition(a, b, 0.5);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0);
    expect(result[2]).toBeCloseTo(0);
  });

  it("returns from when from and to are identical", () => {
    const same: readonly [number, number, number] = [3, 4, 5];
    expect(lerpPosition(same, same, 0.5)).toEqual([3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// distance3D
// ---------------------------------------------------------------------------

describe("distance3D", () => {
  it("returns 0 for same point", () => {
    expect(distance3D([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it("returns correct distance along single axis", () => {
    expect(distance3D([0, 0, 0], [3, 0, 0])).toBe(3);
  });

  it("returns correct distance for 3-4-5 triangle variant", () => {
    // sqrt(3² + 4² + 0²) = 5
    expect(distance3D([0, 0, 0], [3, 4, 0])).toBe(5);
  });

  it("is symmetric", () => {
    const a: readonly [number, number, number] = [1, 2, 3];
    const b: readonly [number, number, number] = [4, 5, 6];
    expect(distance3D(a, b)).toBe(distance3D(b, a));
  });

  it("handles negative coordinates", () => {
    expect(distance3D([-5, 0, 0], [5, 0, 0])).toBe(10);
  });

  it("computes 3D diagonal correctly", () => {
    // sqrt(1² + 1² + 1²) = sqrt(3)
    expect(distance3D([0, 0, 0], [1, 1, 1])).toBeCloseTo(Math.sqrt(3));
  });
});

// ---------------------------------------------------------------------------
// computeTransitionDuration
// ---------------------------------------------------------------------------

describe("computeTransitionDuration", () => {
  const origin: readonly [number, number, number] = [0, 0, 0];

  it("returns MIN_TRANSITION_DURATION for zero distance", () => {
    expect(computeTransitionDuration(origin, origin, origin, origin)).toBe(MIN_TRANSITION_DURATION);
  });

  it("returns MIN_TRANSITION_DURATION for very small movement", () => {
    const near: readonly [number, number, number] = [0.005, 0, 0];
    expect(computeTransitionDuration(origin, near, origin, origin)).toBe(MIN_TRANSITION_DURATION);
  });

  it("scales duration with distance", () => {
    const near: readonly [number, number, number] = [5, 0, 0];
    const far: readonly [number, number, number] = [20, 0, 0];
    const dNear = computeTransitionDuration(origin, near, origin, origin);
    const dFar = computeTransitionDuration(origin, far, origin, origin);
    expect(dFar).toBeGreaterThan(dNear);
  });

  it("caps at MAX_TRANSITION_DURATION for very long distances", () => {
    const veryFar: readonly [number, number, number] = [100, 100, 100];
    const d = computeTransitionDuration(origin, veryFar, origin, origin);
    expect(d).toBeLessThanOrEqual(MAX_TRANSITION_DURATION);
  });

  it("considers target movement too", () => {
    // Position stays put but target moves far
    const farTarget: readonly [number, number, number] = [20, 0, 0];
    const d = computeTransitionDuration(origin, origin, origin, farTarget);
    expect(d).toBeGreaterThan(MIN_TRANSITION_DURATION);
  });

  it("uses the larger of position and target distance", () => {
    const posMove: readonly [number, number, number] = [5, 0, 0];
    const targetMove: readonly [number, number, number] = [15, 0, 0];
    // Target moves further, so duration should match target distance
    const dBoth = computeTransitionDuration(origin, posMove, origin, targetMove);
    const dTargetOnly = computeTransitionDuration(origin, origin, origin, targetMove);
    expect(dBoth).toBeCloseTo(dTargetOnly);
  });

  it("at REFERENCE_DISTANCE, returns MAX_TRANSITION_DURATION", () => {
    const refDist: readonly [number, number, number] = [REFERENCE_DISTANCE, 0, 0];
    const d = computeTransitionDuration(origin, refDist, origin, origin);
    expect(d).toBeCloseTo(MAX_TRANSITION_DURATION, 5);
  });

  it("result is always between MIN and MAX", () => {
    const positions: readonly (readonly [number, number, number])[] = [
      [0, 0, 0], [1, 0, 0], [5, 5, 5], [50, 50, 50],
    ];
    for (const from of positions) {
      for (const to of positions) {
        const d = computeTransitionDuration(from, to, origin, origin);
        expect(d).toBeGreaterThanOrEqual(MIN_TRANSITION_DURATION);
        expect(d).toBeLessThanOrEqual(MAX_TRANSITION_DURATION);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// generateBookmarkId
// ---------------------------------------------------------------------------

describe("generateBookmarkId", () => {
  it("produces string with counter suffix", () => {
    expect(generateBookmarkId(1)).toBe("bookmark-1");
    expect(generateBookmarkId(42)).toBe("bookmark-42");
  });

  it("different counters produce different IDs", () => {
    expect(generateBookmarkId(1)).not.toBe(generateBookmarkId(2));
  });
});

// ---------------------------------------------------------------------------
// computeDefaultBookmarks
// ---------------------------------------------------------------------------

describe("computeDefaultBookmarks", () => {
  const grandHall = { width: 21, length: 10.5, height: 7 };

  it("produces exactly 3 default bookmarks", () => {
    const bookmarks = computeDefaultBookmarks(grandHall);
    expect(bookmarks).toHaveLength(3);
  });

  it("bookmarks have the expected names", () => {
    const bookmarks = computeDefaultBookmarks(grandHall);
    const names = bookmarks.map((b) => b.name);
    expect(names).toEqual(["Entrance View", "Overhead View", "Stage View"]);
  });

  it("bookmarks have stable default IDs", () => {
    const bookmarks = computeDefaultBookmarks(grandHall);
    expect(bookmarks[0]?.id).toBe("default-entrance");
    expect(bookmarks[1]?.id).toBe("default-overhead");
    expect(bookmarks[2]?.id).toBe("default-stage");
  });

  it("entrance view is at eye level (1.7m)", () => {
    const bookmarks = computeDefaultBookmarks(grandHall);
    const entrance = bookmarks[0];
    expect(entrance?.position[1]).toBe(1.7);
  });

  it("overhead view is above the room", () => {
    const bookmarks = computeDefaultBookmarks(grandHall);
    const overhead = bookmarks[1];
    expect(overhead?.position[1]).toBeGreaterThan(grandHall.height);
  });

  it("overhead view looks down at floor center", () => {
    const bookmarks = computeDefaultBookmarks(grandHall);
    const overhead = bookmarks[1];
    expect(overhead?.target).toEqual([0, 0, 0]);
  });

  it("stage view is on the opposite side from entrance", () => {
    const bookmarks = computeDefaultBookmarks(grandHall);
    const entrance = bookmarks[0];
    const stage = bookmarks[2];
    // For a wide room (width > length), entrance is at +X, stage at -X
    expect(entrance?.position[0]).toBeGreaterThan(0);
    expect(stage?.position[0]).toBeLessThan(0);
  });

  it("is deterministic — same inputs give same output", () => {
    const a = computeDefaultBookmarks(grandHall);
    const b = computeDefaultBookmarks(grandHall);
    expect(a).toEqual(b);
  });

  it("adapts to room proportions — narrow room uses length axis", () => {
    // Room where length > width
    const narrowRoom = { width: 5, length: 20, height: 3 };
    const bookmarks = computeDefaultBookmarks(narrowRoom);
    const entrance = bookmarks[0];
    // Camera should be offset along Z (the longer axis), not X
    expect(Math.abs(entrance?.position[2] ?? 0)).toBeGreaterThan(
      Math.abs(entrance?.position[0] ?? 0),
    );
  });

  it("all positions have 3 components", () => {
    const bookmarks = computeDefaultBookmarks(grandHall);
    for (const b of bookmarks) {
      expect(b.position).toHaveLength(3);
      expect(b.target).toHaveLength(3);
    }
  });

  it("all coordinates are finite numbers", () => {
    const bookmarks = computeDefaultBookmarks(grandHall);
    for (const b of bookmarks) {
      for (const v of b.position) expect(Number.isFinite(v)).toBe(true);
      for (const v of b.target) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// advanceTransition
// ---------------------------------------------------------------------------

describe("advanceTransition", () => {
  const baseTransition: CameraTransition = {
    fromPosition: [0, 0, 0],
    fromTarget: [0, 0, 0],
    toPosition: [10, 0, 0],
    toTarget: [5, 0, 0],
    duration: 1.0,
    elapsed: 0,
  };

  it("advances elapsed by delta", () => {
    expect(advanceTransition(baseTransition, 0.1)).toBeCloseTo(0.1);
  });

  it("clamps to duration", () => {
    const late = { ...baseTransition, elapsed: 0.95 };
    expect(advanceTransition(late, 0.2)).toBe(1.0);
  });

  it("negative delta reduces elapsed (but callers never pass negative)", () => {
    const midway = { ...baseTransition, elapsed: 0.5 };
    // advanceTransition is a pure math helper — callers are responsible for positive delta
    expect(advanceTransition(midway, -0.1)).toBeCloseTo(0.4);
  });

  it("stays at duration when already complete", () => {
    const done = { ...baseTransition, elapsed: 1.0 };
    expect(advanceTransition(done, 0.1)).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// sampleTransition
// ---------------------------------------------------------------------------

describe("sampleTransition", () => {
  const transition: CameraTransition = {
    fromPosition: [0, 0, 0],
    fromTarget: [0, 0, 0],
    toPosition: [10, 0, 0],
    toTarget: [5, 0, 0],
    duration: 1.0,
    elapsed: 0,
  };

  it("at elapsed=0, returns from position/target", () => {
    const result = sampleTransition(transition);
    expect(result.position).toEqual([0, 0, 0]);
    expect(result.target).toEqual([0, 0, 0]);
    expect(result.done).toBe(false);
  });

  it("at elapsed=duration, returns to position/target and done=true", () => {
    const done = { ...transition, elapsed: 1.0 };
    const result = sampleTransition(done);
    expect(result.position).toEqual([10, 0, 0]);
    expect(result.target).toEqual([5, 0, 0]);
    expect(result.done).toBe(true);
  });

  it("at midpoint, position/target are at eased midpoint", () => {
    const mid = { ...transition, elapsed: 0.5 };
    const result = sampleTransition(mid);
    // easeInOutCubic(0.5) = 0.5, so midpoint is exact
    expect(result.position[0]).toBeCloseTo(5);
    expect(result.target[0]).toBeCloseTo(2.5);
  });

  it("applies easing — quarter point is less than linear quarter", () => {
    const quarter = { ...transition, elapsed: 0.25 };
    const result = sampleTransition(quarter);
    // easeInOutCubic(0.25) < 0.25 (ease-in phase)
    expect(result.position[0]).toBeLessThan(2.5);
  });

  it("handles zero-duration transition", () => {
    const instant = { ...transition, duration: 0, elapsed: 0 };
    const result = sampleTransition(instant);
    expect(result.position).toEqual([10, 0, 0]);
    expect(result.done).toBe(true);
  });

  it("interpolates all three axes", () => {
    const t: CameraTransition = {
      fromPosition: [0, 0, 0],
      fromTarget: [0, 0, 0],
      toPosition: [10, 20, 30],
      toTarget: [1, 2, 3],
      duration: 1.0,
      elapsed: 0.5,
    };
    const result = sampleTransition(t);
    expect(result.position[0]).toBeCloseTo(5);
    expect(result.position[1]).toBeCloseTo(10);
    expect(result.position[2]).toBeCloseTo(15);
    expect(result.target[0]).toBeCloseTo(0.5);
    expect(result.target[1]).toBeCloseTo(1);
    expect(result.target[2]).toBeCloseTo(1.5);
  });
});

// ---------------------------------------------------------------------------
// Camera reference POV bookmarks
// ---------------------------------------------------------------------------

describe("camera reference bookmarks", () => {
  it("resolves sitting and standing eye heights", () => {
    expect(resolveCameraEyeHeight("sitting")).toBe(SITTING_EYE_HEIGHT_M);
    expect(resolveCameraEyeHeight("standing")).toBe(STANDING_EYE_HEIGHT_M);
  });

  it("clamps custom eye height into the supported human range", () => {
    expect(resolveCameraEyeHeight("custom", 0.1)).toBe(MIN_CUSTOM_EYE_HEIGHT_M);
    expect(resolveCameraEyeHeight("custom", 5)).toBe(MAX_CUSTOM_EYE_HEIGHT_M);
    expect(resolveCameraEyeHeight("custom", 1.42)).toBe(1.42);
  });

  it("creates a furniture POV at the clicked object position and eye height", () => {
    const bookmark = createCameraReferenceBookmark({
      id: "pov-1",
      name: "Bride chair",
      source: "furniture",
      sourceLabel: "Banquet Chair",
      point: [3, -4],
      baseY: 0.4,
      yaw: Math.PI,
      heightMode: "sitting",
    });

    expect(bookmark.kind).toBe("reference");
    expect(bookmark.position).toEqual([3, 0.4 + SITTING_EYE_HEIGHT_M, -4]);
    expect(bookmark.reference?.sourceLabel).toBe("Banquet Chair");
    expect(bookmark.target[2]).toBeGreaterThan(bookmark.position[2]);
  });

  it("faces a floor-grid POV toward the room centre", () => {
    const bookmark = createCameraReferenceBookmark({
      id: "pov-floor",
      name: "Floor POV",
      source: "floor",
      sourceLabel: "Floor grid",
      point: [4, 0],
      yaw: null,
      heightMode: "standing",
    });

    expect(bookmark.position).toEqual([4, STANDING_EYE_HEIGHT_M, 0]);
    expect(bookmark.target[0]).toBeLessThan(bookmark.position[0]);
  });

  it("updates only the reference height and preserves source metadata", () => {
    const sitting = createCameraReferenceBookmark({
      id: "pov-1",
      name: "Bride chair",
      source: "furniture",
      sourceLabel: "Banquet Chair",
      point: [3, -4],
      yaw: 0,
      heightMode: "sitting",
    });
    const standing = updateCameraReferenceHeight(sitting, "standing");

    expect(standing.position[1]).toBe(STANDING_EYE_HEIGHT_M);
    expect(standing.reference?.source).toBe("furniture");
    expect(standing.reference?.sourceLabel).toBe("Banquet Chair");
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

describe("camera-animation constants", () => {
  it("MIN_TRANSITION_DURATION is positive", () => {
    expect(MIN_TRANSITION_DURATION).toBeGreaterThan(0);
  });

  it("MAX_TRANSITION_DURATION > MIN_TRANSITION_DURATION", () => {
    expect(MAX_TRANSITION_DURATION).toBeGreaterThan(MIN_TRANSITION_DURATION);
  });

  it("REFERENCE_DISTANCE is positive", () => {
    expect(REFERENCE_DISTANCE).toBeGreaterThan(0);
  });

  it("MAX_TRANSITION_DURATION is reasonable (< 5s)", () => {
    expect(MAX_TRANSITION_DURATION).toBeLessThan(5);
  });

  it("MIN_TRANSITION_DURATION is snappy (< 1s)", () => {
    expect(MIN_TRANSITION_DURATION).toBeLessThan(1);
  });
});

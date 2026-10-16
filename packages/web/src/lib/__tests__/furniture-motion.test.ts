import { beforeEach, describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import {
  activeFurnitureSettleCount,
  beginFurnitureSettle,
  carryFurniture,
  clearAllFurnitureSettles,
  clearFurnitureSettle,
  composeFurnitureMotion,
  dropInFurniture,
  furnitureMotionPose,
  furnitureSettleOffset,
  publishFurnitureSettleFrame,
  releaseFurniture,
  stepFurnitureSettles,
  subscribeFurnitureSettleFrames,
} from "../furniture-motion.js";

// ---------------------------------------------------------------------------
// The settle registry: store truth is written instantly, the visual offset
// decays through the gridSettle spring. These tests pin the contract the
// scene layer depends on — offsets converge to zero, settled channels prune
// themselves (so the demand loop can sleep), and interruption is instant.
// ---------------------------------------------------------------------------

function settleFully(maxFrames = 600): number {
  let frames = 0;
  while (activeFurnitureSettleCount() > 0 && frames < maxFrames) {
    stepFurnitureSettles(1 / 60);
    frames += 1;
  }
  return frames;
}

beforeEach(() => {
  clearAllFurnitureSettles();
});

describe("furniture settle springs", () => {
  it("decays an offset to zero and prunes the channel", () => {
    beginFurnitureSettle("a", 0.4, -0.25);
    expect(furnitureSettleOffset("a")).toEqual({ x: 0.4, z: -0.25 });

    const frames = settleFully();
    expect(frames).toBeLessThan(600); // converged, not capped
    expect(activeFurnitureSettleCount()).toBe(0);
    expect(furnitureSettleOffset("a")).toBeNull();
  });

  it("settles a grid-sized offset in under a second (stiff, decisive)", () => {
    beginFurnitureSettle("a", 0.25, 0);
    const frames = settleFully();
    expect(frames).toBeLessThan(60);
  });

  it("reports live ids each frame until they rest", () => {
    beginFurnitureSettle("a", 0.4, 0);
    beginFurnitureSettle("b", -0.3, 0.1);
    const live = stepFurnitureSettles(1 / 60);
    expect([...live].sort()).toEqual(["a", "b"]);
  });

  it("re-seeding an id accumulates the new offset instead of restarting", () => {
    beginFurnitureSettle("a", 0.2, 0);
    // Let it move part-way, then hand it a second settle (rapid re-drag).
    stepFurnitureSettles(1 / 60);
    const before = furnitureSettleOffset("a");
    expect(before).not.toBeNull();
    beginFurnitureSettle("a", 0.3, 0);
    const after = furnitureSettleOffset("a");
    expect(after).not.toBeNull();
    expect((after?.x ?? 0) - (before?.x ?? 0)).toBeCloseTo(0.3, 10);
    // And it still converges.
    settleFully();
    expect(activeFurnitureSettleCount()).toBe(0);
  });

  it("clearFurnitureSettle drops one channel, clearAll drops the rest", () => {
    beginFurnitureSettle("a", 0.2, 0);
    beginFurnitureSettle("b", 0.2, 0);
    clearFurnitureSettle("a");
    expect(furnitureSettleOffset("a")).toBeNull();
    expect(furnitureSettleOffset("b")).not.toBeNull();
    clearAllFurnitureSettles();
    expect(activeFurnitureSettleCount()).toBe(0);
  });

  it("a stalled-tab frame cannot explode the spring", () => {
    beginFurnitureSettle("a", 0.4, 0.4);
    stepFurnitureSettles(5); // five seconds handed in one frame
    const offset = furnitureSettleOffset("a");
    // Either settled and pruned, or still finite and small — never blown up.
    if (offset !== null) {
      expect(Math.abs(offset.x)).toBeLessThan(0.4);
      expect(Math.abs(offset.z)).toBeLessThan(0.4);
    }
    settleFully();
    expect(activeFurnitureSettleCount()).toBe(0);
  });

  it("empty registry steps are free and return no ids", () => {
    expect(stepFurnitureSettles(1 / 60)).toEqual([]);
  });

  it("publishes every applied frame, then one frame without offsets, then nothing", () => {
    const frames: (readonly string[])[] = [];
    const unsubscribe = subscribeFurnitureSettleFrames((live) => { frames.push(live); });
    try {
      publishFurnitureSettleFrame([]);
      expect(frames).toEqual([]);
      beginFurnitureSettle("a", 0.1, 0);
      let steps = 0;
      while (steps < 600) {
        const live = stepFurnitureSettles(1 / 60);
        publishFurnitureSettleFrame(live);
        steps += 1;
        if (live.length === 0) break;
      }
      expect(frames).toHaveLength(steps);
      expect(frames.slice(0, -1).every((live) => live.length === 1 && live[0] === "a")).toBe(true);
      expect(frames.at(-1)).toEqual([]);
      publishFurnitureSettleFrame([]);
      expect(frames).toHaveLength(steps);
    } finally {
      unsubscribe();
    }
    beginFurnitureSettle("b", 0.1, 0);
    publishFurnitureSettleFrame(stepFurnitureSettles(1 / 60));
    publishFurnitureSettleFrame([]);
    expect(frames.flat()).not.toContain("b");
  });
});

describe("the carry, the landing and the drop-in", () => {
  it("leans a carried piece back from the way it travels, never more than about 4°", () => {
    carryFurniture(["a"], 0.5, 0);
    for (let i = 0; i < 4; i++) stepFurnitureSettles(1 / 60);
    const gentle = furnitureMotionPose("a");
    expect(gentle?.leanX).toBeLessThan(0);
    for (let i = 0; i < 4; i++) { carryFurniture(["a"], 6, 6); stepFurnitureSettles(1 / 60); }
    for (let i = 0; i < 60; i++) { carryFurniture(["a"], 6, 6); stepFurnitureSettles(1 / 60); }
    const fast = furnitureMotionPose("a");
    expect(Math.hypot(fast?.leanX ?? 0, fast?.leanZ ?? 0)).toBeLessThan(0.0705);
    expect(Math.hypot(fast?.leanX ?? 0, fast?.leanZ ?? 0)).toBeGreaterThan(0.06);
  });

  it("stands a piece up again when the hand pauses", () => {
    carryFurniture(["a"], 2, 0);
    for (let i = 0; i < 20; i++) stepFurnitureSettles(1 / 60);
    for (let i = 0; i < 120; i++) stepFurnitureSettles(1 / 60);
    expect(Math.abs(furnitureMotionPose("a")?.leanX ?? 0)).toBeLessThan(0.004);
  });

  it("swings a released piece through upright, squashes it once, and comes to rest", () => {
    carryFurniture(["a"], 2, 0);
    for (let i = 0; i < 30; i++) { carryFurniture(["a"], 2, 0); stepFurnitureSettles(1 / 60); }
    releaseFurniture(["a"]);
    let lowestSquash = 0;
    let swungThrough = false;
    let frames = 0;
    while (activeFurnitureSettleCount() > 0 && frames < 300) {
      stepFurnitureSettles(1 / 60);
      const pose = furnitureMotionPose("a");
      if (pose !== null) {
        lowestSquash = Math.min(lowestSquash, pose.squash);
        if (pose.leanX > 0.002) swungThrough = true;
      }
      frames += 1;
    }
    expect(swungThrough).toBe(true);
    expect(lowestSquash).toBeLessThan(-0.025);
    expect(lowestSquash).toBeGreaterThan(-0.06);
    // At rest within about a second: the demand loop goes back to sleep.
    expect(frames).toBeLessThan(90);
  });

  it("brings a new piece down onto the floor without dipping through it", () => {
    dropInFurniture("a");
    let lowestLift = Infinity;
    let frames = 0;
    let previous = furnitureMotionPose("a")?.lift ?? 0;
    expect(previous).toBeGreaterThan(0.1);
    while (activeFurnitureSettleCount() > 0 && frames < 300) {
      stepFurnitureSettles(1 / 60);
      const lift = furnitureMotionPose("a")?.lift ?? 0;
      lowestLift = Math.min(lowestLift, lift);
      expect(lift).toBeLessThanOrEqual(previous + 1e-9);
      previous = lift;
      frames += 1;
    }
    expect(lowestLift).toBeGreaterThanOrEqual(0);
    expect(frames).toBeLessThan(120);
  });

  it("pivots on the piece's base: the base stays put, the top moves, the volume holds", () => {
    const pose = { x: 0.1, z: -0.2, lift: 0, squash: -0.04, leanX: 0.05, leanZ: 0 };
    const matrix = composeFurnitureMotion(pose, 3, 0, -2, new Matrix4());
    const base = new Vector3(3, 0, -2).applyMatrix4(matrix);
    expect(base.x).toBeCloseTo(3.1, 9);
    expect(base.y).toBeCloseTo(0, 9);
    expect(base.z).toBeCloseTo(-2.2, 9);
    const top = new Vector3(3, 1, -2).applyMatrix4(matrix);
    // Leaning toward +x by 0.05 rad, squashed 4 per cent.
    expect(top.x - 3.1).toBeCloseTo(Math.sin(0.05) * 0.96, 3);
    expect(top.y).toBeCloseTo(Math.cos(0.05) * 0.96, 3);
    expect(Math.abs(matrix.determinant() - 1)).toBeLessThan(0.002);
  });
});

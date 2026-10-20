import { beforeEach, describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import {
  CARRY_AT_REST,
  activeFurnitureSettleCount,
  beginFurnitureSettle,
  carryFurniture,
  clearAllFurnitureSettles,
  clearFurnitureSettle,
  composeFurnitureMotion,
  dropInFurniture,
  furnitureMotionPose,
  furnitureSettleOffset,
  measureCarry,
  publishFurnitureSettleFrame,
  releaseFurniture,
  stepFurnitureSettles,
  subscribeFurnitureSettleFrames,
  type FurnitureMotionPose,
} from "../furniture-motion.js";
import { SPRING_PRESETS, stepSpring, type SpringConfig } from "../springs.js";

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

/** One spring alone, stepped `steps` seconds at a time: what a channel should read. */
function springAfter(value: number, velocity: number, target: number, steps: readonly number[], config: SpringConfig): number {
  const state = { value, velocity };
  for (const step of steps) stepSpring(state, target, step, config);
  return state.value;
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
    stepFurnitureSettles(1 / 60);
    stepFurnitureSettles(5); // five seconds handed in one frame mid-motion
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

// Under frameloop="demand" the frame that wakes a sleeping loop reports the
// whole idle gap as its delta. A motion's first step must be one display
// frame, or most of it is spent before it is ever drawn.
describe("the first step after the frame loop slept", () => {
  const settle = SPRING_PRESETS.gridSettle;

  /** The pose after the waking frame, for a motion begun with nothing else moving. */
  function poseAfterWaking(begin: () => void, wakingDelta: number): FurnitureMotionPose | null {
    clearAllFurnitureSettles();
    stepFurnitureSettles(wakingDelta); // nothing moves: the loop goes to sleep
    begin();
    stepFurnitureSettles(wakingDelta);
    return furnitureMotionPose("a");
  }

  it.each([
    ["a drop-in", (): void => { dropInFurniture("a"); }],
    ["a release's set-down and swing", (): void => { releaseFurniture(["a"]); }],
    ["a carry from rest", (): void => { carryFurniture(["a"], 1, 0); }],
    ["a grid settle", (): void => { beginFurnitureSettle("a", 0.25, -0.1); }],
  ])("starts %s the same however long the loop slept", (_name, begin) => {
    const afterOneFrame = poseAfterWaking(begin, 1 / 60);
    expect(afterOneFrame).not.toBeNull();
    expect(poseAfterWaking(begin, 0.3)).toEqual(afterOneFrame);
    expect(poseAfterWaking(begin, 4)).toEqual(afterOneFrame);
  });

  it("brings a drop-in down from its full height on the waking frame, not most of the way", () => {
    dropInFurniture("a", 0.14);
    stepFurnitureSettles(3);
    const lift = furnitureMotionPose("a")?.lift ?? 0;
    expect(lift).toBeCloseTo(springAfter(0.14, 0, 0, [1 / 60], SPRING_PRESETS.furnitureDrop), 12);
    // A quarter-second first step would have left under a fifth of the drop.
    expect(lift).toBeGreaterThan(0.13);
  });

  it("then steps by the real frame delta, capped as a dropped frame", () => {
    beginFurnitureSettle("a", 0.4, 0);
    stepFurnitureSettles(4);
    expect(furnitureSettleOffset("a")?.x).toBeCloseTo(springAfter(0.4, 0, 0, [1 / 60], settle), 12);
    stepFurnitureSettles(0.05);
    expect(furnitureSettleOffset("a")?.x).toBeCloseTo(springAfter(0.4, 0, 0, [1 / 60, 0.05], settle), 12);
    stepFurnitureSettles(2);
    expect(furnitureSettleOffset("a")?.x).toBeCloseTo(springAfter(0.4, 0, 0, [1 / 60, 0.05, 0.1], settle), 12);
  });

  it("steps a motion begun while another moves by the real delta: the loop never slept", () => {
    beginFurnitureSettle("a", 0.4, 0);
    stepFurnitureSettles(1 / 60);
    beginFurnitureSettle("b", 0.4, 0);
    stepFurnitureSettles(0.03);
    expect(furnitureSettleOffset("b")?.x).toBeCloseTo(springAfter(0.4, 0, 0, [0.03], settle), 12);
  });

  it("treats the next motion as new once everything has come to rest or been cleared", () => {
    beginFurnitureSettle("a", 0.25, 0);
    settleFully();
    beginFurnitureSettle("a", 0.4, 0);
    stepFurnitureSettles(2);
    expect(furnitureSettleOffset("a")?.x).toBeCloseTo(springAfter(0.4, 0, 0, [1 / 60], settle), 12);
    clearAllFurnitureSettles();
    beginFurnitureSettle("a", 0.4, 0);
    stepFurnitureSettles(2);
    expect(furnitureSettleOffset("a")?.x).toBeCloseTo(springAfter(0.4, 0, 0, [1 / 60], settle), 12);
  });
});

describe("the carrying hand's speed", () => {
  it("only starts the clock on a drag's first move: its travel since the press is no speed", () => {
    expect(measureCarry(CARRY_AT_REST, 0.3, -0.2, 5_000)).toEqual({ at: 5_000, vx: 0, vz: 0, measured: false });
  });

  it("seeds the speed outright from the first timed move, then blends later ones in", () => {
    const first = measureCarry(CARRY_AT_REST, 0.3, -0.2, 5_000);
    const second = measureCarry(first, 0.02, -0.01, 5_016);
    expect(second.measured).toBe(true);
    expect(second.vx).toBeCloseTo(0.02 / 0.016, 9);
    expect(second.vz).toBeCloseTo(-0.01 / 0.016, 9);
    const third = measureCarry(second, 0, 0, 5_032);
    expect(third.vx).toBeCloseTo(second.vx * 0.65, 9);
    expect(third.vz).toBeCloseTo(second.vz * 0.65, 9);
  });

  it("reads a long gap between moves as a tenth of a second, and a burst as four milliseconds", () => {
    const first = measureCarry(CARRY_AT_REST, 0, 0, 5_000);
    expect(measureCarry(first, 0.05, 0, 9_000).vx).toBeCloseTo(0.5, 9);
    expect(measureCarry(first, 0.002, 0, 5_001).vx).toBeCloseTo(0.5, 9);
  });
});

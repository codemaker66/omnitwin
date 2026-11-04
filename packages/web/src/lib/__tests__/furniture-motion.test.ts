import { beforeEach, describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import {
  CARRY_AT_REST,
  DROP_HEIGHT,
  activeFurnitureSettleCount,
  beginFurnitureSettle,
  carryFurniture,
  clearAllFurnitureSettles,
  clearFurnitureSettle,
  composeFurnitureMotion,
  dropInFurniture,
  furnitureMotionPose,
  furnitureSettleOffset,
  landingDelays,
  massForCategory,
  measureCarry,
  publishFurnitureSettleFrame,
  releaseFurniture,
  setFurnitureMassResolver,
  stepFurnitureSettles,
  subscribeFurnitureSettleFrames,
  type FurnitureMotionPose,
  type LandingPiece,
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
  it("leans a carried piece back from the way it travels, never more than about 3°", () => {
    carryFurniture(["a"], 0.5, 0);
    for (let i = 0; i < 4; i++) stepFurnitureSettles(1 / 60);
    const gentle = furnitureMotionPose("a");
    expect(gentle?.leanX).toBeLessThan(0);
    for (let i = 0; i < 4; i++) { carryFurniture(["a"], 6, 6); stepFurnitureSettles(1 / 60); }
    for (let i = 0; i < 60; i++) { carryFurniture(["a"], 6, 6); stepFurnitureSettles(1 / 60); }
    const fast = furnitureMotionPose("a");
    expect(Math.hypot(fast?.leanX ?? 0, fast?.leanZ ?? 0)).toBeLessThan(0.0505);
    expect(Math.hypot(fast?.leanX ?? 0, fast?.leanZ ?? 0)).toBeGreaterThan(0.045);
  });

  it("stands a piece up again when the hand pauses", () => {
    carryFurniture(["a"], 2, 0);
    for (let i = 0; i < 20; i++) stepFurnitureSettles(1 / 60);
    for (let i = 0; i < 120; i++) stepFurnitureSettles(1 / 60);
    expect(Math.abs(furnitureMotionPose("a")?.leanX ?? 0)).toBeLessThan(0.004);
  });

  it("comes down and stands a released piece upright with one small swing, dips it once, and comes to rest", () => {
    carryFurniture(["a"], 2, 0);
    for (let i = 0; i < 30; i++) { carryFurniture(["a"], 2, 0); stepFurnitureSettles(1 / 60); }
    const leanAtRelease = furnitureMotionPose("a")?.leanX ?? 0;
    releaseFurniture(["a"]);
    let lowestSquash = 0;
    let mostSwing = 0;
    let lowestLift = Infinity;
    let frames = 0;
    while (activeFurnitureSettleCount() > 0 && frames < 300) {
      stepFurnitureSettles(1 / 60);
      const pose = furnitureMotionPose("a");
      if (pose !== null) {
        lowestSquash = Math.min(lowestSquash, pose.squash);
        mostSwing = Math.max(mostSwing, pose.leanX);
        lowestLift = Math.min(lowestLift, pose.lift);
      }
      frames += 1;
    }
    // Through upright by a few per cent of its lean at most: a swing, never a rocking.
    expect(leanAtRelease).toBeLessThan(-0.045);
    expect(mostSwing).toBeLessThan(-leanAtRelease * 0.08);
    // A throw at 2 m/s dips about one per cent as it takes its weight.
    expect(lowestSquash).toBeLessThan(-0.008);
    expect(lowestSquash).toBeGreaterThan(-0.013);
    expect(lowestLift).toBeGreaterThanOrEqual(0);
    // At rest within about 0.8 s (it rocked for 1.5 s): the demand loop goes back to sleep.
    expect(frames).toBeLessThan(50);
  });

  it("brings a new piece down onto the floor without dipping through it", () => {
    dropInFurniture("a");
    let lowestLift = Infinity;
    let frames = 0;
    let previous = furnitureMotionPose("a")?.lift ?? 0;
    expect(previous).toBeCloseTo(DROP_HEIGHT, 9);
    while (activeFurnitureSettleCount() > 0 && frames < 300) {
      stepFurnitureSettles(1 / 60);
      const lift = furnitureMotionPose("a")?.lift ?? 0;
      lowestLift = Math.min(lowestLift, lift);
      expect(lift).toBeLessThanOrEqual(previous + 1e-9);
      previous = lift;
      frames += 1;
    }
    expect(lowestLift).toBeGreaterThanOrEqual(0);
    expect(frames).toBeLessThan(40);
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
    ["a release's set-down and swing", (): void => { carryFurniture(["a"], 1, 0); releaseFurniture(["a"]); }],
    ["a carry from rest", (): void => { carryFurniture(["a"], 1, 0); }],
    ["a grid settle", (): void => { beginFurnitureSettle("a", 0.25, -0.1); }],
  ])("starts %s the same however long the loop slept", (_name, begin) => {
    const afterOneFrame = poseAfterWaking(begin, 1 / 60);
    expect(afterOneFrame).not.toBeNull();
    expect(poseAfterWaking(begin, 0.3)).toEqual(afterOneFrame);
    expect(poseAfterWaking(begin, 4)).toEqual(afterOneFrame);
  });

  it("brings a drop-in down from its full height on the waking frame, not all the way", () => {
    dropInFurniture("a");
    stepFurnitureSettles(3);
    const lift = furnitureMotionPose("a")?.lift ?? 0;
    // Aimed 3 cm below the floor, it stops at contact.
    expect(lift).toBeCloseTo(springAfter(DROP_HEIGHT, 0, -0.03, [1 / 60], SPRING_PRESETS.furnitureSetDown), 12);
    // A quarter-second first step would already have landed it.
    expect(lift).toBeGreaterThan(0.04);
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

// T-674 craft (Blake, 27 Oct 2026: "the most subtle of animations on placing or hovering an asset"): a piece is set
// down, not floated. The numbers are the craft audit's (craft/scene-feel.md SF-09, SF-12, SF-14, SF-15), measured
// here on the shipped integrator at 60 frames a second.
describe("set down, not floated", () => {
  /** Frames at 60 a second until `done`, or `limit`. */
  function framesUntil(done: () => boolean, limit = 300): number {
    let frames = 0;
    while (!done() && frames < limit) {
      stepFurnitureSettles(1 / 60);
      frames += 1;
    }
    return frames;
  }

  /** The deepest squash, the lowest lift and the frames to rest of whatever moves from here. */
  function playOut(id: string): { readonly squash: number; readonly lift: number; readonly frames: number } {
    let squash = 0;
    let lift = Infinity;
    const frames = framesUntil(() => {
      const pose = furnitureMotionPose(id);
      if (pose !== null) {
        squash = Math.min(squash, pose.squash);
        lift = Math.min(lift, pose.lift);
      }
      return activeFurnitureSettleCount() === 0;
    });
    return { squash, lift, frames };
  }

  it("sets a new piece down at speed within a tenth of a second, with one dip of about one per cent", () => {
    dropInFurniture("a");
    const touchdown = framesUntil(() => (furnitureMotionPose("a")?.lift ?? 0) === 0);
    expect(touchdown).toBeLessThanOrEqual(6);
    const after = playOut("a");
    expect(after.squash).toBeLessThan(-0.008);
    expect(after.squash).toBeGreaterThan(-0.014);
    // At rest within two thirds of a second of the click.
    expect(touchdown + after.frames).toBeLessThan(40);
  });

  it("lifts a carried piece into the hand within a fifth of a second, and sets it down when the hand rests", () => {
    for (let i = 0; i < 12; i++) { carryFurniture(["a"], 1, 0); stepFurnitureSettles(1 / 60); }
    expect(furnitureMotionPose("a")?.lift).toBeGreaterThan(0.027);
    expect(furnitureMotionPose("a")?.lift).toBeLessThan(0.0305);
    // The hand rests: a hesitation keeps it in hand, a held-still hand sets it down and the loop sleeps.
    for (let i = 0; i < 12; i++) stepFurnitureSettles(1 / 60);
    expect(furnitureMotionPose("a")?.lift).toBeGreaterThan(0.025);
    const after = playOut("a");
    expect(after.lift).toBeGreaterThanOrEqual(0);
    expect(after.frames).toBeLessThan(60);
  });

  it("dips a let-go piece only as hard as it was moving: none for a careful nudge, about one per cent for a throw", () => {
    for (let i = 0; i < 20; i++) { carryFurniture(["slow"], 0.05, 0); carryFurniture(["fast"], 3, 0); stepFurnitureSettles(1 / 60); }
    releaseFurniture(["slow", "fast"]);
    let slowest = 0;
    let fastest = 0;
    framesUntil(() => {
      slowest = Math.min(slowest, furnitureMotionPose("slow")?.squash ?? 0);
      fastest = Math.min(fastest, furnitureMotionPose("fast")?.squash ?? 0);
      return activeFurnitureSettleCount() === 0;
    });
    expect(slowest).toBeGreaterThan(-0.0005);
    expect(fastest).toBeLessThan(-0.008);
    expect(fastest).toBeGreaterThan(-0.013);
  });

  it("settles a snap onto the grid without a visible overshoot", () => {
    beginFurnitureSettle("a", 0.5, 0);
    let lowest = Infinity;
    const frames = framesUntil(() => {
      lowest = Math.min(lowest, furnitureSettleOffset("a")?.x ?? 0);
      return activeFurnitureSettleCount() === 0;
    });
    // Past the snap by under a millimetre (it was 2.2 cm), and done within half a second.
    expect(lowest).toBeGreaterThan(-0.001);
    expect(frames).toBeLessThan(32);
  });

  it("lets staging, the dance floor and AV neither lean nor dip, and a table lean barely", () => {
    const uninstall = setFurnitureMassResolver((id) => (id === "stage" ? "heavy" : id === "table" ? "table" : "light"));
    try {
      for (let i = 0; i < 30; i++) { carryFurniture(["stage", "table", "chair"], 4, 0); stepFurnitureSettles(1 / 60); }
      expect(furnitureMotionPose("stage")?.leanX).toBeCloseTo(0, 12);
      expect(furnitureMotionPose("stage")?.lift).toBeLessThan(0.0155);
      expect(Math.abs(furnitureMotionPose("table")?.leanX ?? 0)).toBeLessThan(0.0305);
      expect(Math.abs(furnitureMotionPose("chair")?.leanX ?? 0)).toBeGreaterThan(0.045);
      releaseFurniture(["stage", "table", "chair"]);
      let stageSquash = 0;
      framesUntil(() => {
        stageSquash = Math.min(stageSquash, furnitureMotionPose("stage")?.squash ?? 0);
        return activeFurnitureSettleCount() === 0;
      });
      expect(stageSquash).toBeCloseTo(0, 12);
      clearAllFurnitureSettles();
      dropInFurniture("stage");
      expect(playOut("stage").squash).toBeCloseTo(0, 12);
    } finally {
      uninstall();
    }
  });

  it("holds a waiting drop-in just above the floor for its turn, then sets it down", () => {
    dropInFurniture("a", DROP_HEIGHT, 0.1);
    for (let i = 0; i < 5; i++) stepFurnitureSettles(1 / 60);
    expect(furnitureMotionPose("a")?.lift).toBeCloseTo(DROP_HEIGHT, 9);
    const touchdown = framesUntil(() => (furnitureMotionPose("a")?.lift ?? 0) === 0);
    expect(touchdown).toBeLessThanOrEqual(8);
  });

  it("weighs a catalogue category: staging, AV and lighting are heavy; tables and lecterns barely lean", () => {
    expect(massForCategory("stage")).toBe("heavy");
    expect(massForCategory("av")).toBe("heavy");
    expect(massForCategory("lighting")).toBe("heavy");
    expect(massForCategory("table")).toBe("table");
    expect(massForCategory("lectern")).toBe("table");
    expect(massForCategory("chair")).toBe("light");
    expect(massForCategory(undefined)).toBe("light");
  });
});

describe("the order a set and a layout land in", () => {
  /** A round of ten at (x, z): its table, then chairs round it in a scrambled order. */
  function round(group: string, x: number, z: number): LandingPiece[] {
    const chairs = [3, 7, 0, 9, 5, 1, 8, 2, 6, 4].map((seat): LandingPiece => {
      const angle = (seat / 10) * Math.PI * 2;
      return { id: `${group}-chair-${String(seat)}`, x: x + Math.cos(angle) * 1.2, z: z + Math.sin(angle) * 1.2, groupId: group, isTable: false };
    });
    return [{ id: `${group}-table`, x, z, groupId: group, isTable: true }, ...chairs];
  }

  it("lands a set in order: its table at once, then its chairs round it, 12 ms apart", () => {
    const delays = landingDelays(round("t1", 4, -2));
    expect(delays.get("t1-table")).toBe(0);
    const chairs = [...delays.entries()].filter(([id]) => id.includes("chair")).sort((a, b) => a[1] - b[1]);
    expect(chairs.map(([, delay]) => delay)).toEqual(chairs.map((_, index) => (index + 1) * 0.012));
    // Round the ring: each next chair stands next to the one before.
    const seats = chairs.map(([id]) => Number(id.split("-").pop()));
    for (let i = 1; i < seats.length; i++) expect(((seats[i] ?? 0) - (seats[i - 1] ?? 0) + 10) % 10).toBe(1);
  });

  it("ripples a whole layout out from its middle: the outermost set starts 240 ms after the middle", () => {
    const pieces = [...round("middle", 0, 0), ...round("near", 3, 0), ...round("far", 6, 0), ...round("west", -6, 0)];
    const delays = landingDelays(pieces);
    const middle = delays.get("middle-table") ?? -1;
    const near = delays.get("near-table") ?? -1;
    const far = delays.get("far-table") ?? -1;
    expect(middle).toBeLessThan(near);
    expect(near).toBeLessThan(far);
    expect(Math.max(far, delays.get("west-table") ?? -1)).toBeCloseTo(0.24, 9);
    // Everything starts down within 240 ms plus one set's chairs.
    expect(Math.max(...delays.values())).toBeLessThanOrEqual(0.24 + 10 * 0.012 + 1e-9);
  });

  it("starts a single piece at once", () => {
    expect(landingDelays([{ id: "lectern", x: 2, z: 1, groupId: null, isTable: false }]).get("lectern")).toBe(0);
  });
});

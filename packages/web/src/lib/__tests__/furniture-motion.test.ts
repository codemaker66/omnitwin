import { beforeEach, describe, expect, it } from "vitest";
import {
  activeFurnitureSettleCount,
  beginFurnitureSettle,
  clearAllFurnitureSettles,
  clearFurnitureSettle,
  furnitureSettleOffset,
  stepFurnitureSettles,
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
});

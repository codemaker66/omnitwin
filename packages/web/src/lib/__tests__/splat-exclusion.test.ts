import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import { excludedBySlab, resampleExclusionMask, type SplatExclusion } from "../splat-exclusion.js";

// The mask covers the left half of a 4 × 2 grid; the matrix maps x∈[0,4] → u, z∈[0,2] → v, y → s.
const exclusion: SplatExclusion = {
  matrix: new Matrix4().set(0.25, 0, 0, 0, 0, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 0, 1),
  below: 0.15, above: 0.12,
  mask: { width: 4, height: 2, data: new Uint8Array([255, 255, 0, 0, 255, 255, 0, 0]) },
};

describe("floor-slab exclusion (T-639)", () => {
  it("hides floor-slab splats inside the outline", () => {
    expect(excludedBySlab(new Vector3(0.5, 0.05, 0.5), exclusion)).toBe(true);
    expect(excludedBySlab(new Vector3(0.5, -0.1, 1.5), exclusion)).toBe(true);
  });

  it("keeps splats above the band, below it, outside the outline or off the grid", () => {
    expect(excludedBySlab(new Vector3(0.5, 0.2, 0.5), exclusion)).toBe(false);
    expect(excludedBySlab(new Vector3(0.5, -0.2, 0.5), exclusion)).toBe(false);
    expect(excludedBySlab(new Vector3(3.5, 0.05, 0.5), exclusion)).toBe(false);
    expect(excludedBySlab(new Vector3(-1, 0.05, 0.5), exclusion)).toBe(false);
  });

  it("resamples a mask to the host's fixed grid by nearest neighbour", () => {
    const out = resampleExclusionMask(exclusion.mask, 8, 4);
    expect(Array.from(out.slice(0, 8))).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
    expect(out.length).toBe(32);
  });
});

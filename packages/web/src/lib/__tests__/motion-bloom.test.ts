// Bloom paused while the view moves on a phone (lib/motion-bloom.ts): cut at once when a hand
// lands or the camera moves, then back on the detent spring once the view is still.
import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { CameraPoseWatch, MotionBloom } from "../motion-bloom.js";

/** Draws still frames every `stepMs` from `from` until `until`, returning each frame's weight. */
function stillFrames(bloom: MotionBloom, from: number, until: number, stepMs = 16): number[] {
  const weights: number[] = [];
  for (let now = from; now <= until; now += stepMs) weights.push(bloom.frame(now, false));
  return weights;
}

describe("MotionBloom", () => {
  it("draws full bloom on a view that never moved, and asks for no frames", () => {
    const bloom = new MotionBloom();
    expect(bloom.frame(0, false)).toBe(1);
    expect(bloom.returning).toBe(false);
  });

  it("cuts bloom to nothing on the first frame drawn in motion", () => {
    const bloom = new MotionBloom();
    bloom.frame(0, false);
    expect(bloom.frame(16, true)).toBe(0);
    expect(bloom.returning).toBe(false);
    expect(bloom.frame(32, true)).toBe(0);
  });

  it("brings it back on the detent spring once the view is still: most of the way in 150 ms, home by 400 ms", () => {
    const bloom = new MotionBloom();
    bloom.frame(0, true);
    // The first still frame starts the return from nothing, however long the hand rested.
    expect(bloom.frame(5_000, false)).toBe(0);
    expect(bloom.returning).toBe(true);
    const weights = stillFrames(bloom, 5_016, 5_400);
    const at150 = weights[Math.round(150 / 16) - 1] ?? 0;
    expect(at150).toBeGreaterThan(0.85);
    expect(Math.max(...weights)).toBeLessThanOrEqual(1);
    for (let index = 1; index < weights.length; index++) expect(weights[index] ?? 0).toBeGreaterThanOrEqual(weights[index - 1] ?? 0);
    expect(weights.at(-1)).toBe(1);
    expect(bloom.returning).toBe(false);
  });

  it("cuts again if a hand lands while bloom is returning", () => {
    const bloom = new MotionBloom();
    bloom.frame(0, true);
    stillFrames(bloom, 16, 96);
    expect(bloom.frame(112, true)).toBe(0);
    expect(bloom.frame(128, false)).toBe(0);
    expect(bloom.returning).toBe(true);
  });
});

describe("CameraPoseWatch", () => {
  function camera(): PerspectiveCamera {
    const lens = new PerspectiveCamera(50, 1.5, 0.1, 200);
    lens.position.set(6.5, 2.67, 1.89);
    lens.lookAt(0, 0, 0);
    lens.updateProjectionMatrix();
    return lens;
  }

  it("reports no move on the first frame it sees, nor while the camera stays put", () => {
    const watch = new CameraPoseWatch();
    const lens = camera();
    expect(watch.changed(lens)).toBe(false);
    expect(watch.changed(lens)).toBe(false);
  });

  it("sees the camera travel, turn and zoom", () => {
    const watch = new CameraPoseWatch();
    const lens = camera();
    watch.changed(lens);
    lens.position.x += 0.01;
    expect(watch.changed(lens)).toBe(true);
    expect(watch.changed(lens)).toBe(false);
    lens.rotateY(0.002);
    expect(watch.changed(lens)).toBe(true);
    lens.zoom = 1.2;
    lens.updateProjectionMatrix();
    expect(watch.changed(lens)).toBe(true);
  });

  it("ignores a damped camera's last invisible creep", () => {
    const watch = new CameraPoseWatch();
    const lens = camera();
    watch.changed(lens);
    lens.position.x += 1e-9;
    expect(watch.changed(lens)).toBe(false);
  });
});

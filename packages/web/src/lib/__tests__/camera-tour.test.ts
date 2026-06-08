import { describe, it, expect } from "vitest";
import type { SpaceDimensions } from "@omnitwin/types";
import {
  buildShowcaseTour,
  buildTourFromPoses,
  advanceCameraTour,
  sampleCameraTour,
  type CameraPose,
  type CameraTour,
} from "../camera-tour.js";

// Grand Hall render dimensions (metres × 2 on X/Z; height in metres).
const DIMS: SpaceDimensions = { width: 42, length: 21, height: 7 };

function sampleAt(tour: CameraTour, elapsedSec: number): ReturnType<typeof sampleCameraTour> {
  return sampleCameraTour(advanceCameraTour(tour, elapsedSec));
}

describe("buildShowcaseTour", () => {
  it("produces a 4-pose, 3-leg cinematic path with positive duration", () => {
    const tour = buildShowcaseTour(DIMS);
    expect(tour.legs).toHaveLength(3);
    expect(tour.totalSec).toBeGreaterThan(0);
    expect(tour.elapsedSec).toBe(0);
  });

  it("opens high in the air and ends at guest eye level", () => {
    const tour = buildShowcaseTour(DIMS);
    const first = tour.legs[0];
    const last = tour.legs[tour.legs.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;
    // Aerial opener is well above head height; the finale settles near 1.7 m.
    expect(first.from.position[1]).toBeGreaterThan(10);
    expect(last.to.position[1]).toBeCloseTo(1.7, 5);
  });
});

describe("sampleCameraTour", () => {
  const tour = buildShowcaseTour(DIMS);
  const leg0 = tour.legs[0];
  const leg2 = tour.legs[2];

  it("starts exactly on the opening pose", () => {
    const sample = sampleAt(tour, 0);
    expect(sample.legIndex).toBe(0);
    expect(sample.done).toBe(false);
    if (leg0 === undefined) return;
    expect(sample.position).toEqual(leg0.from.position);
    expect(sample.target).toEqual(leg0.from.target);
  });

  it("eases to the midpoint of the first leg at half its duration", () => {
    if (leg0 === undefined) return;
    const sample = sampleAt(tour, leg0.durationSec * 0.5); // easeInOutCubic(0.5) === 0.5
    for (let axis = 0; axis < 3; axis += 1) {
      const mid = (leg0.from.position[axis]! + leg0.to.position[axis]!) / 2;
      expect(sample.position[axis]).toBeCloseTo(mid, 5);
    }
  });

  it("rests on the final pose during the closing hold (not yet done)", () => {
    if (leg2 === undefined) return;
    // 0.5 s into the final hold: past leg2's travel but before the tour ends.
    const holdMoment = tour.totalSec - leg2.holdSec + 0.5;
    const sample = sampleAt(tour, holdMoment);
    expect(sample.done).toBe(false);
    expect(sample.position).toEqual(leg2.to.position);
  });

  it("finishes exactly on the closing pose and reports done", () => {
    if (leg2 === undefined) return;
    const sample = sampleAt(tour, tour.totalSec);
    expect(sample.done).toBe(true);
    expect(sample.legIndex).toBe(2);
    expect(sample.position).toEqual(leg2.to.position);
  });

  it("advances legs monotonically as time passes", () => {
    let previous = 0;
    for (let t = 0; t <= tour.totalSec; t += 0.5) {
      const { legIndex } = sampleAt(tour, t);
      expect(legIndex).toBeGreaterThanOrEqual(previous);
      previous = legIndex;
    }
  });
});

describe("advanceCameraTour", () => {
  it("clamps elapsed time to the total duration", () => {
    const tour = buildShowcaseTour(DIMS);
    expect(advanceCameraTour(tour, tour.totalSec + 100).elapsedSec).toBe(tour.totalSec);
  });
  it("never runs the clock backwards on a negative delta", () => {
    const tour = advanceCameraTour(buildShowcaseTour(DIMS), 2);
    expect(advanceCameraTour(tour, -5).elapsedSec).toBe(2);
  });
});

describe("buildTourFromPoses", () => {
  const a: CameraPose = { position: [0, 10, 0], target: [0, 0, 0] };
  const b: CameraPose = { position: [5, 5, 5], target: [1, 1, 1] };

  it("returns an empty, already-done tour for fewer than two poses", () => {
    const tour = buildTourFromPoses([a]);
    expect(tour.legs).toHaveLength(0);
    expect(tour.totalSec).toBe(0);
    expect(sampleCameraTour(tour).done).toBe(true);
  });

  it("chains consecutive poses into legs and holds only on the last", () => {
    const tour = buildTourFromPoses([a, b, a], 2, 1);
    expect(tour.legs).toHaveLength(2);
    expect(tour.legs[0]?.holdSec).toBe(0);
    expect(tour.legs[1]?.holdSec).toBe(1);
    expect(tour.totalSec).toBe(2 + 2 + 1); // two 2s legs + 1s final hold
  });
});

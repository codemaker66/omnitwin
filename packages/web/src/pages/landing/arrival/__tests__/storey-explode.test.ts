import { describe, expect, it } from "vitest";
import {
  bucketForY, explodeOffsetY, storeyBoundaries, storeyFloors,
} from "../storey-explode.js";

const SAMPLES = [
  { floor: 0, yMeters: 1.4 }, { floor: 0, yMeters: 1.6 },
  { floor: 1, yMeters: 6.9 }, { floor: 1, yMeters: 7.1 },
  { floor: 2, yMeters: 12.5 },
];

describe("storey bucketing", () => {
  it("finds sorted unique floors", () => {
    expect(storeyFloors(SAMPLES)).toEqual([0, 1, 2]);
  });
  it("boundaries are midpoints of neighbouring mean heights", () => {
    expect(storeyBoundaries(SAMPLES)).toEqual([4.25, 9.75]);
  });
  it("buckets below, between, and above all boundaries", () => {
    const b = storeyBoundaries(SAMPLES);
    expect(bucketForY(0.2, b)).toBe(0);
    expect(bucketForY(5.0, b)).toBe(1);
    expect(bucketForY(30, b)).toBe(2);
  });
  it("offset scales with bucket and progress; ground floor never moves", () => {
    expect(explodeOffsetY(0, 1, 6)).toBe(0);
    expect(explodeOffsetY(2, 0.5, 6)).toBe(6);
    expect(explodeOffsetY(2, 1, 6)).toBe(12);
  });
  it("single-floor building yields no boundaries and bucket 0 for any y", () => {
    expect(storeyBoundaries([{ floor: 0, yMeters: 2 }])).toEqual([]);
    expect(bucketForY(99, [])).toBe(0);
  });

  // Edge cases
  it("empty samples array returns empty floors and boundaries", () => {
    expect(storeyFloors([])).toEqual([]);
    expect(storeyBoundaries([])).toEqual([]);
  });

  it("handles non-contiguous floor numbers", () => {
    const nonContiguous = [
      { floor: 0, yMeters: 1.0 },
      { floor: 2, yMeters: 7.0 },
    ];
    const floors = storeyFloors(nonContiguous);
    expect(floors).toEqual([0, 2]);
    const boundaries = storeyBoundaries(nonContiguous);
    // Mean of floor 0: 1.0, Mean of floor 2: 7.0, midpoint: 4.0
    expect(boundaries).toEqual([4.0]);
  });

  it("handles unsorted input samples", () => {
    const unsorted = [
      { floor: 2, yMeters: 12.5 },
      { floor: 0, yMeters: 1.4 },
      { floor: 1, yMeters: 7.1 },
      { floor: 0, yMeters: 1.6 },
      { floor: 1, yMeters: 6.9 },
    ];
    expect(storeyFloors(unsorted)).toEqual([0, 1, 2]);
    expect(storeyBoundaries(unsorted)).toEqual([4.25, 9.75]);
  });

  it("buckets with empty boundaries always returns 0", () => {
    expect(bucketForY(-100, [])).toBe(0);
    expect(bucketForY(0, [])).toBe(0);
    expect(bucketForY(1000, [])).toBe(0);
  });

  it("explode offset is zero for ground floor at any progress", () => {
    expect(explodeOffsetY(0, 0, 10)).toBe(0);
    expect(explodeOffsetY(0, 0.5, 10)).toBe(0);
    expect(explodeOffsetY(0, 1, 10)).toBe(0);
  });

  it("explode offset scales linearly with progress", () => {
    expect(explodeOffsetY(1, 0, 6)).toBe(0);
    expect(explodeOffsetY(1, 0.25, 6)).toBe(1.5);
    expect(explodeOffsetY(1, 0.5, 6)).toBe(3);
    expect(explodeOffsetY(1, 0.75, 6)).toBe(4.5);
    expect(explodeOffsetY(1, 1, 6)).toBe(6);
  });

  it("explode offset scales with separation distance", () => {
    expect(explodeOffsetY(2, 1, 3)).toBe(6);
    expect(explodeOffsetY(2, 1, 6)).toBe(12);
    expect(explodeOffsetY(2, 1, 12)).toBe(24);
  });
});

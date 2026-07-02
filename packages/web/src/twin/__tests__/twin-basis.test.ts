// packages/web/src/twin/__tests__/twin-basis.test.ts
import { describe, expect, it } from "vitest";
import { e57PointToThree, e57QuatToThree, scannerForward } from "../twin-basis.js";

// scan_000 from poses.json — the entrance scan; per the E57 pipeline docs its
// forward direction points into the Grand Hall and the scanner was level.
const Q0: readonly [number, number, number, number] =
  [0.7376939654350281, 0.014615842141211033, -0.011572370305657387, -0.6748778820037842];
const T0: readonly [number, number, number] =
  [0.004310831427574158, 0.008259806782007217, 1.4990558624267578];

describe("twin-basis", () => {
  it("converts E57 points to three space (Z-up → Y-up)", () => {
    expect(e57PointToThree([1, 2, 3])).toEqual([1, 3, -2]);
    expect(e57PointToThree(T0)[1]).toBeCloseTo(1.499, 3); // tripod height becomes Y
  });

  it("returns a unit quaternion in three [x,y,z,w] order", () => {
    const q3 = e57QuatToThree(Q0);
    expect(Math.hypot(q3[0], q3[1], q3[2], q3[3])).toBeCloseTo(1, 6);
  });

  it("scan_000 forward is horizontal (level tripod, not floor/ceiling)", () => {
    const f = scannerForward(Q0);
    expect(Math.hypot(f[0], f[1], f[2])).toBeCloseTo(1, 6);
    expect(Math.abs(f[1])).toBeLessThan(0.1); // near-horizontal in three space
  });

  it("identity pose forward maps scanner +X to three -Z", () => {
    const f = scannerForward([1, 0, 0, 0]);
    expect(f[0]).toBeCloseTo(0, 6);
    expect(f[1]).toBeCloseTo(0, 6);
    expect(f[2]).toBeCloseTo(-1, 6);
  });
});

// packages/web/src/twin/__tests__/twin-basis.test.ts
import { Quaternion, Vector3 } from "three"; // test-only: pins the mesh quat against three's own math
import { describe, expect, it } from "vitest";
import {
  E57_TO_THREE_QUAT,
  MESH_OFFSET_M,
  e57PointToThree,
  e57QuatToThree,
  scannerForward,
} from "../twin-basis.js";

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

describe("twin-basis — dollhouse mesh frame (Phase 2, Task 4)", () => {
  it("E57_TO_THREE_QUAT is the unit −90°-about-X rotation in [x,y,z,w] order", () => {
    expect(E57_TO_THREE_QUAT).toEqual([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    const [x, y, z, w] = E57_TO_THREE_QUAT;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 12);
  });

  it("rotating an E57 point by the quat agrees with e57PointToThree exactly", () => {
    const quat = new Quaternion(...E57_TO_THREE_QUAT);
    for (const point of [
      [1, 2, 3],
      T0,
      [-5.31, 13.3, -2.13], // real bundle extent corners (node t ranges)
      [19.47, -11.3, 1.72],
    ] as const) {
      const rotated = new Vector3(point[0], point[1], point[2]).applyQuaternion(quat);
      const expected = e57PointToThree(point);
      expect(rotated.x).toBeCloseTo(expected[0], 10);
      expect(rotated.y).toBeCloseTo(expected[1], 10);
      expect(rotated.z).toBeCloseTo(expected[2], 10);
    }
  });

  it("pins [1,2,3] → [1,3,−2] through both paths", () => {
    const rotated = new Vector3(1, 2, 3).applyQuaternion(new Quaternion(...E57_TO_THREE_QUAT));
    expect([rotated.x, rotated.y, rotated.z].map(Math.round)).toEqual([1, 3, -2]);
    expect(e57PointToThree([1, 2, 3])).toEqual([1, 3, -2]);
  });

  it("MESH_OFFSET_M starts at zero — the only permissible alignment fudge", () => {
    // Calibrated exclusively by the visual gate (twin-visual-check dollhouse
    // capture); component code must never edit it.
    expect(MESH_OFFSET_M).toEqual([0, 0, 0]);
  });
});

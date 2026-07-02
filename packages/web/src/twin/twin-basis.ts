// packages/web/src/twin/twin-basis.ts
import type { TwinFace } from "@omnitwin/types";

// -----------------------------------------------------------------------------
// twin-basis — the ONLY module allowed to know that the E57 capture frame
// (Z-up, +X scanner-forward, +Y scanner-left) differs from three.js
// (Y-up, -Z camera-forward). Every conversion is pinned by tests; the
// FACE_TO_CUBE table is the single calibration surface for tile orientation.
// Reference math: F:\...\E57\CLAUDE.md §4 and make_brush_dataset_v2.py.
// -----------------------------------------------------------------------------

type Vec3 = [number, number, number];
type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Basis matrix M (scanner→three): x₃=-y_s, y₃=z_s, z₃=-x_s (row-major). */
const M: Mat3 = [0, -1, 0, 0, 0, 1, -1, 0, 0];
/** Mᵀ (three→scanner). */
const MT: Mat3 = [0, 0, -1, -1, 0, 0, 0, 1, 0];

/** Row-major 3×3 product, unrolled: literal tuple indices keep the maths
 *  fully typed (Mat3 is a 9-tuple — no undefined, no casts, no loops). */
function matMul(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/** [w,x,y,z] quaternion → row-major 3×3 rotation matrix. */
function quatToMat(q: readonly [number, number, number, number]): Mat3 {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/** Row-major 3×3 rotation → [w,x,y,z] quaternion (Shepperd's method). */
function matToQuat(m: Mat3): [number, number, number, number] {
  const t = m[0] + m[4] + m[8];
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = s / 4;
    x = (m[7] - m[5]) / s;
    y = (m[2] - m[6]) / s;
    z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s;
    x = s / 4;
    y = (m[1] + m[3]) / s;
    z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s;
    x = (m[1] + m[3]) / s;
    y = s / 4;
    z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s;
    x = (m[2] + m[6]) / s;
    y = (m[5] + m[7]) / s;
    z = s / 4;
  }
  return [w, x, y, z];
}

/** E57 point (Z-up) → three point (Y-up). */
export function e57PointToThree(t: readonly [number, number, number]): Vec3 {
  return [t[0], t[2], -t[1]];
}

/**
 * E57 pose quaternion [w,x,y,z] (scanner→E57world) → three.js quaternion
 * [x,y,z,w] expressing the same physical rotation in the three basis.
 */
export function e57QuatToThree(
  q: readonly [number, number, number, number],
): [number, number, number, number] {
  const r3 = matMul(matMul(M, quatToMat(q)), MT);
  const [w, x, y, z] = matToQuat(r3);
  return [x, y, z, w];
}

/** World-frame (three) unit vector the scanner's +X (forward) points along. */
export function scannerForward(
  q: readonly [number, number, number, number],
): Vec3 {
  const r = quatToMat(q);
  // Scanner forward in E57 world = R · [1,0,0]ᵀ = first column of R.
  const fE57: Vec3 = [r[0], r[3], r[6]];
  // Re-express the DIRECTION in the three basis via M (scanner→three):
  // x₃=-y, y₃=z, z₃=-x — so identity forward (+X) lands on three -Z.
  // (e57PointToThree is the POINT map [x,z,-y]; using it here would send
  // identity forward to three +X, breaking the pinned -Z convention.)
  return [-fE57[1], fE57[2], -fE57[0]];
}

/**
 * Which WebGL cube face each scanner face fills, plus per-face flips and
 * clockwise quarter-turns applied when the face image is drawn to its canvas.
 * CALIBRATION TABLE — the visual step against scan_000 may correct flips or
 * rotateQuarters (or remap targets on a gross error); nothing else may.
 * Calibrated 2026-07-02 against scan_000/scan_001/scan_048 renders (horizon,
 * zenith and nadir rings at four headings each): front and up each need one
 * clockwise quarter-turn, back and down each need three (i.e. one CCW) — the
 * forge stores every face upright, and WebGL's per-face cube conventions
 * rotate the ±x and ±z faces in opposite directions. left/right sample
 * upright as forged. Symptoms when wrong: walls read sideways dead-ahead of
 * the scanner pose, and the coffered ceiling ends on a hard diagonal at the
 * zenith instead of flowing into all four walls.
 */
export const FACE_TO_CUBE: Record<
  TwinFace,
  {
    target: "px" | "nx" | "py" | "ny" | "pz" | "nz";
    flipX: boolean;
    flipY: boolean;
    rotateQuarters: 0 | 1 | 2 | 3;
  }
> = {
  front: { target: "px", flipX: false, flipY: false, rotateQuarters: 1 },
  back: { target: "nx", flipX: false, flipY: false, rotateQuarters: 3 },
  left: { target: "py", flipX: false, flipY: false, rotateQuarters: 0 },
  right: { target: "ny", flipX: false, flipY: false, rotateQuarters: 0 },
  up: { target: "pz", flipX: false, flipY: false, rotateQuarters: 1 },
  down: { target: "nz", flipX: false, flipY: false, rotateQuarters: 3 },
};

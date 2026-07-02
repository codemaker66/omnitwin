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

function matMul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9).fill(0) as unknown as Mat3;
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let s = 0;
      for (let k = 0; k < 3; k += 1) {
        s += (a[i * 3 + k] ?? 0) * (b[k * 3 + j] ?? 0);
      }
      r[i * 3 + j] = s;
    }
  }
  return r;
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
  const t = (m[0] ?? 0) + (m[4] ?? 0) + (m[8] ?? 0);
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = s / 4;
    x = ((m[7] ?? 0) - (m[5] ?? 0)) / s;
    y = ((m[2] ?? 0) - (m[6] ?? 0)) / s;
    z = ((m[3] ?? 0) - (m[1] ?? 0)) / s;
  } else if ((m[0] ?? 0) > (m[4] ?? 0) && (m[0] ?? 0) > (m[8] ?? 0)) {
    const s = Math.sqrt(1 + (m[0] ?? 0) - (m[4] ?? 0) - (m[8] ?? 0)) * 2;
    w = ((m[7] ?? 0) - (m[5] ?? 0)) / s;
    x = s / 4;
    y = ((m[1] ?? 0) + (m[3] ?? 0)) / s;
    z = ((m[2] ?? 0) + (m[6] ?? 0)) / s;
  } else if ((m[4] ?? 0) > (m[8] ?? 0)) {
    const s = Math.sqrt(1 + (m[4] ?? 0) - (m[0] ?? 0) - (m[8] ?? 0)) * 2;
    w = ((m[2] ?? 0) - (m[6] ?? 0)) / s;
    x = ((m[1] ?? 0) + (m[3] ?? 0)) / s;
    y = s / 4;
    z = ((m[5] ?? 0) + (m[7] ?? 0)) / s;
  } else {
    const s = Math.sqrt(1 + (m[8] ?? 0) - (m[0] ?? 0) - (m[4] ?? 0)) * 2;
    w = ((m[3] ?? 0) - (m[1] ?? 0)) / s;
    x = ((m[2] ?? 0) + (m[6] ?? 0)) / s;
    y = ((m[5] ?? 0) + (m[7] ?? 0)) / s;
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
  const fE57: Vec3 = [r[0] ?? 0, r[3] ?? 0, r[6] ?? 0];
  // Re-express the DIRECTION in the three basis via M (scanner→three):
  // x₃=-y, y₃=z, z₃=-x — so identity forward (+X) lands on three -Z.
  // (e57PointToThree is the POINT map [x,z,-y]; using it here would send
  // identity forward to three +X, breaking the pinned -Z convention.)
  return [-fE57[1], fE57[2], -fE57[0]];
}

/**
 * Which WebGL cube face each scanner face fills, plus per-face flips.
 * CALIBRATION TABLE — Task 7's visual step against scan_000 may correct
 * flips (or remap targets on a gross error); nothing else may.
 */
export const FACE_TO_CUBE: Record<
  TwinFace,
  { target: "px" | "nx" | "py" | "ny" | "pz" | "nz"; flipX: boolean; flipY: boolean }
> = {
  front: { target: "px", flipX: false, flipY: false },
  back: { target: "nx", flipX: false, flipY: false },
  left: { target: "py", flipX: false, flipY: false },
  right: { target: "ny", flipX: false, flipY: false },
  up: { target: "pz", flipX: false, flipY: false },
  down: { target: "nz", flipX: false, flipY: false },
};

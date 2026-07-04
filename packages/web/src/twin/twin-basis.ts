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
 * three direction → E57 world direction — the EXACT inverse of the point map
 * `e57PointToThree` ([x, z, −y]): x_e = x₃, y_e = −z₃, z_e = y₃. Pinned by a
 * round-trip test against `e57PointToThree`. The equirect fragment shader
 * (PanoStage) inlines this same mapping — the pinned test here is the
 * shader's proof too. This is deliberately the POINT map, not the scanner
 * direction map M: world-frame equirects must agree with node POSITIONS
 * (nav markers, minimap), which travel through `e57PointToThree`.
 */
export function threeDirToE57(d: readonly [number, number, number]): Vec3 {
  return [d[0], -d[2], d[1]];
}

/**
 * Equirect horizontal calibration — the ONLY calibration surface for
 * equirect bundles (FACE_TO_CUBE plays no part in them). The extractor
 * (tools/twin-forge/e57-scripts/extract_equirect.py) writes WORLD-frame
 * panos with column u = az/2π where az = atan2(y_e, x_e) (E57 world, +X
 * toward +Y); PanoStage samples u = sign·az/2π + offset with
 * RepeatWrapping absorbing the winding, v = ½ + asin(z_e)/π (flipY texture
 * ⇒ v=1 is the zenith row). Because the shader maps view DIRECTIONS to the
 * exact world directions the extractor assigned to each pixel, the derived
 * identity (no flip, zero offset) is the expected truth; these constants
 * exist so the visual gate can pin or correct that in ONE place.
 * Calibrated 2026-07-04 against scan_000 (raw pano composition), scan_039
 * (etched window text) and scan_145 (entrance signage).
 */
export const EQUIRECT_U_FLIP: boolean = false;
/** Additive azimuth offset in TURNS (1.0 = full revolution). */
export const EQUIRECT_U_OFFSET: number = 0;

/**
 * The E57-world → three-world rotation as a three.js quaternion ([x,y,z,w]):
 * −90° about X, so a mesh root carrying it agrees with `e57PointToThree` for
 * every point (pinned by test against three's own Quaternion math). The
 * dollhouse GLB shares the E57 Z-up frame with the scan poses (verified in
 * the Phase-2 plan: GLB z bounds are storey heights), so one quat on the mesh
 * root puts mesh and pose dots in the same three-space.
 */
export const E57_TO_THREE_QUAT: [number, number, number, number] = [
  -Math.SQRT1_2,
  0,
  0,
  Math.SQRT1_2,
];

/**
 * Mesh-root translation in three metres — the ONLY permissible alignment
 * fudge between the dollhouse mesh and the posed node dots. Calibrated
 * exclusively through the visual gate (twin-visual-check dollhouse capture);
 * never edited from component code. [0,0,0] = the frames agree as-is.
 */
export const MESH_OFFSET_M: [number, number, number] = [0, 0, 0];

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
 * Walls calibrated 2026-07-02 against scan_000/scan_001/scan_048 renders
 * (horizon rings at four headings each): front needs one clockwise
 * quarter-turn and back three (i.e. one CCW) — the forge stores every wall
 * face upright, and WebGL's per-face cube conventions transpose the ±x
 * faces in opposite directions. left/right sample upright as forged.
 *
 * Vertical faces recalibrated 2026-07-04 against scan_000/scan_039
 * (wall↔cap seam continuity plus doorway header/threshold azimuth
 * agreement): the photographic bundle names its cap tiles by the
 * v-flipped source convention — the "up" tile is the DOWNWARD view
 * (floorboards, doormat, tripod patch) and "down" is the UPWARD view
 * (dome, chandeliers) — so "up" fills nz (nadir) with a half-turn and
 * "down" fills pz (zenith) upright. Symptoms when wrong: walls read
 * sideways dead-ahead of the scanner pose, floorboards hang overhead
 * while the dome sits underfoot, or the coffered ceiling ends on a hard
 * diagonal at the zenith instead of flowing into all four walls.
 *
 * HANDEDNESS is deliberately NOT calibrated here: this table only ever
 * expresses per-face rotations, so a whole-world mirror (text reading
 * right-to-left everywhere) cannot be fixed by it face-by-face without
 * also re-slotting targets. The chirality compensation lives in ONE place —
 * PanoStage's fragment shader negates the scanner y (left/right) component
 * of the sampling direction to cancel WebGL's left-handed cube convention
 * (calibrated 2026-07-04 against scan_039's frieze text and scan_145's
 * entrance signage; scan_000 doorway composition pinned against the raw
 * pano). If text ever reads mirrored again, look there, not here.
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
  up: { target: "nz", flipX: false, flipY: false, rotateQuarters: 2 },
  down: { target: "pz", flipX: false, flipY: false, rotateQuarters: 0 },
};

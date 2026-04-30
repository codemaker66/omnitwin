// Coordinate-frame and Matrix4d helpers for runtime alignment work.
//
// Convention: T_BA maps points from frame A into frame B:
//   x_B = T_BA * x_A
//
// Matrices are stored in Three.js-compatible column-major order.

export const COORDINATE_FRAMES = [
  {
    name: "CVF",
    description: "Canonical Venue Frame: metres, Matterport/E57-derived, Z-up unless explicitly documented otherwise.",
  },
  {
    name: "ARF",
    description: "Asset Runtime Frame: per-asset local authoring frame.",
  },
  {
    name: "RRF",
    description: "Render Runtime Frame: Three.js/R3F render frame.",
  },
  {
    name: "G",
    description: "Gaussian splat local frame.",
  },
  {
    name: "M",
    description: "Structural mesh local frame.",
  },
  {
    name: "W",
    description: "Browser/runtime world frame.",
  },
  {
    name: "COLMAP_RDF",
    description: "COLMAP/OpenCV camera frame: +X right, +Y down, +Z forward.",
  },
  {
    name: "THREE_CAMERA",
    description: "Three.js camera local frame: +X right, +Y up, camera looks down -Z.",
  },
] as const;

export type CoordinateFrameName = (typeof COORDINATE_FRAMES)[number]["name"];
export type TransformName<TTarget extends string, TSource extends string> = `T_${TTarget}_${TSource}`;

export type TransformPoint3 = readonly [number, number, number];

export type TransformMatrix4d = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type RowMajorMatrix4d = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
];

export type TransformValidationFailure =
  | "non_finite"
  | "not_affine"
  | "degenerate_basis"
  | "non_orthogonal_basis"
  | "non_uniform_scale"
  | "mirrored_basis";

export type TransformValidationResult =
  | {
      readonly ok: true;
      readonly determinant: number;
      readonly scale: number;
    }
  | {
      readonly ok: false;
      readonly reason: TransformValidationFailure;
      readonly detail: string;
    };

export const TRANSFORM_MATRIX4D_LENGTH = 16;

export const IDENTITY_TRANSFORM_MATRIX4D: TransformMatrix4d = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export function transformName<TTarget extends CoordinateFrameName, TSource extends CoordinateFrameName>(
  targetFrame: TTarget,
  sourceFrame: TSource,
): TransformName<TTarget, TSource> {
  return `T_${targetFrame}_${sourceFrame}`;
}

export function matrix4d(values: readonly number[]): TransformMatrix4d {
  if (values.length !== TRANSFORM_MATRIX4D_LENGTH) {
    throw new Error(`Matrix4d must contain ${String(TRANSFORM_MATRIX4D_LENGTH)} values`);
  }

  const valueAt = (index: number): number => {
    const value = values[index];
    if (value === undefined) {
      throw new Error(`Matrix4d value at index ${String(index)} is missing`);
    }
    if (!Number.isFinite(value)) {
      throw new Error("Matrix4d values must be finite");
    }
    return value;
  };

  return [
    valueAt(0), valueAt(1), valueAt(2), valueAt(3),
    valueAt(4), valueAt(5), valueAt(6), valueAt(7),
    valueAt(8), valueAt(9), valueAt(10), valueAt(11),
    valueAt(12), valueAt(13), valueAt(14), valueAt(15),
  ];
}

export function matrix4dFromRowMajor(rows: RowMajorMatrix4d): TransformMatrix4d {
  return matrix4d([
    rows[0][0], rows[1][0], rows[2][0], rows[3][0],
    rows[0][1], rows[1][1], rows[2][1], rows[3][1],
    rows[0][2], rows[1][2], rows[2][2], rows[3][2],
    rows[0][3], rows[1][3], rows[2][3], rows[3][3],
  ]);
}

export function translationMatrix4d(x: number, y: number, z: number): TransformMatrix4d {
  return matrix4d([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

export function scaleMatrix4d(x: number, y: number, z: number): TransformMatrix4d {
  return matrix4d([
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ]);
}

export function uniformScaleMatrix4d(scale: number): TransformMatrix4d {
  return scaleMatrix4d(scale, scale, scale);
}

export function rotationXMatrix4d(radians: number): TransformMatrix4d {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return matrix4d([
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ]);
}

export function rotationZMatrix4d(radians: number): TransformMatrix4d {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return matrix4d([
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export const T_THREE_CAMERA_COLMAP_RDF: TransformMatrix4d = matrix4d([
  1, 0, 0, 0,
  0, -1, 0, 0,
  0, 0, -1, 0,
  0, 0, 0, 1,
]);

export function multiplyTransformMatrices(
  left: TransformMatrix4d,
  right: TransformMatrix4d,
): TransformMatrix4d {
  const out: number[] = [];
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) {
        value += matrixValue(left, k * 4 + row) * matrixValue(right, col * 4 + k);
      }
      out.push(value);
    }
  }
  return matrix4d(out);
}

export function transformPoint3(matrix: TransformMatrix4d, point: TransformPoint3): TransformPoint3 {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (Math.abs(w) < Number.EPSILON) {
    throw new Error("Cannot transform point with zero homogeneous w");
  }
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  ];
}

export function distance3(a: TransformPoint3, b: TransformPoint3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function validateSimilarityTransformMatrix4d(
  matrix: TransformMatrix4d,
  tolerance = 1e-9,
): TransformValidationResult {
  for (const value of matrix) {
    if (!Number.isFinite(value)) {
      return { ok: false, reason: "non_finite", detail: "Matrix contains a non-finite value" };
    }
  }

  if (
    Math.abs(matrix[3]) > tolerance ||
    Math.abs(matrix[7]) > tolerance ||
    Math.abs(matrix[11]) > tolerance ||
    Math.abs(matrix[15] - 1) > tolerance
  ) {
    return { ok: false, reason: "not_affine", detail: "Matrix last row must be [0, 0, 0, 1]" };
  }

  const xAxis: TransformPoint3 = [matrix[0], matrix[1], matrix[2]];
  const yAxis: TransformPoint3 = [matrix[4], matrix[5], matrix[6]];
  const zAxis: TransformPoint3 = [matrix[8], matrix[9], matrix[10]];
  const xLen = vectorLength3(xAxis);
  const yLen = vectorLength3(yAxis);
  const zLen = vectorLength3(zAxis);
  if (xLen <= tolerance || yLen <= tolerance || zLen <= tolerance) {
    return { ok: false, reason: "degenerate_basis", detail: "Matrix basis has a near-zero axis" };
  }

  const maxLen = Math.max(xLen, yLen, zLen);
  const minLen = Math.min(xLen, yLen, zLen);
  if (maxLen - minLen > tolerance * Math.max(1, maxLen)) {
    return {
      ok: false,
      reason: "non_uniform_scale",
      detail: "Matrix basis axes must have one uniform scale",
    };
  }

  if (
    Math.abs(dot3(xAxis, yAxis)) > tolerance * xLen * yLen ||
    Math.abs(dot3(xAxis, zAxis)) > tolerance * xLen * zLen ||
    Math.abs(dot3(yAxis, zAxis)) > tolerance * yLen * zLen
  ) {
    return {
      ok: false,
      reason: "non_orthogonal_basis",
      detail: "Matrix basis axes must be orthogonal",
    };
  }

  const determinant = dot3(cross3(xAxis, yAxis), zAxis);
  if (determinant <= tolerance) {
    return { ok: false, reason: "mirrored_basis", detail: "Matrix basis must preserve handedness" };
  }

  return { ok: true, determinant, scale: (xLen + yLen + zLen) / 3 };
}

export function assertSimilarityTransformMatrix4d(matrix: TransformMatrix4d, tolerance = 1e-9): void {
  const result = validateSimilarityTransformMatrix4d(matrix, tolerance);
  if (!result.ok) {
    throw new Error(`Invalid similarity transform: ${result.reason} (${result.detail})`);
  }
}

export function invertSimilarityTransformMatrix4d(matrix: TransformMatrix4d): TransformMatrix4d {
  const result = validateSimilarityTransformMatrix4d(matrix);
  if (!result.ok) {
    throw new Error(`Cannot invert invalid similarity transform: ${result.reason}`);
  }

  const invScaleSquared = 1 / (result.scale * result.scale);
  const out = matrix4d([
    matrix[0] * invScaleSquared,
    matrix[4] * invScaleSquared,
    matrix[8] * invScaleSquared,
    0,
    matrix[1] * invScaleSquared,
    matrix[5] * invScaleSquared,
    matrix[9] * invScaleSquared,
    0,
    matrix[2] * invScaleSquared,
    matrix[6] * invScaleSquared,
    matrix[10] * invScaleSquared,
    0,
    0,
    0,
    0,
    1,
  ]);

  const tx = matrix[12];
  const ty = matrix[13];
  const tz = matrix[14];
  const inverseTranslation: TransformPoint3 = [
    -(out[0] * tx + out[4] * ty + out[8] * tz),
    -(out[1] * tx + out[5] * ty + out[9] * tz),
    -(out[2] * tx + out[6] * ty + out[10] * tz),
  ];

  return matrix4d([
    out[0], out[1], out[2], 0,
    out[4], out[5], out[6], 0,
    out[8], out[9], out[10], 0,
    inverseTranslation[0], inverseTranslation[1], inverseTranslation[2], 1,
  ]);
}

function vectorLength3(v: TransformPoint3): number {
  return Math.sqrt(dot3(v, v));
}

function matrixValue(matrix: TransformMatrix4d, index: number): number {
  const value = matrix[index];
  if (value === undefined) {
    throw new Error(`Matrix4d value at index ${String(index)} is missing`);
  }
  return value;
}

function dot3(a: TransformPoint3, b: TransformPoint3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: TransformPoint3, b: TransformPoint3): TransformPoint3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

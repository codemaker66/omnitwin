import { describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM_MATRIX4D,
  T_THREE_CAMERA_COLMAP_RDF,
  assertSimilarityTransformMatrix4d,
  distance3,
  invertSimilarityTransformMatrix4d,
  matrix4dFromRowMajor,
  multiplyTransformMatrices,
  rotationXMatrix4d,
  rotationZMatrix4d,
  scaleMatrix4d,
  transformName,
  transformPoint3,
  translationMatrix4d,
  uniformScaleMatrix4d,
  validateSimilarityTransformMatrix4d,
  type TransformMatrix4d,
  type TransformPoint3,
} from "../coordinate-frame.js";

function expectPointCloseTo(actual: TransformPoint3, expected: TransformPoint3, digits = 10): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe("coordinate-frame transform convention", () => {
  it("uses T_BA naming for transforms that map A into B", () => {
    const name = transformName("CVF", "ARF");
    const T_CVF_ARF = translationMatrix4d(3, 4, 5);
    const pointArf: TransformPoint3 = [1, 2, 3];

    expect(name).toBe("T_CVF_ARF");
    expectPointCloseTo(transformPoint3(T_CVF_ARF, pointArf), [4, 6, 8]);
  });

  it("composes transforms in column-vector order: T_CA = T_CB * T_BA", () => {
    const T_BA = translationMatrix4d(2, 0, 0);
    const T_CB = rotationZMatrix4d(Math.PI / 2);
    const T_CA = multiplyTransformMatrices(T_CB, T_BA);

    expectPointCloseTo(transformPoint3(T_CA, [1, 0, 0]), [0, 3, 0]);
  });

  it("inverts a valid rigid transform", () => {
    const T_BA = multiplyTransformMatrices(
      translationMatrix4d(3, -2, 5),
      rotationZMatrix4d(Math.PI / 2),
    );
    const T_AB = invertSimilarityTransformMatrix4d(T_BA);
    const pointA: TransformPoint3 = [1.25, -0.5, 2];
    const pointB = transformPoint3(T_BA, pointA);

    expectPointCloseTo(transformPoint3(T_AB, pointB), pointA);
  });

  it("keeps known metric distances unchanged under rigid transforms", () => {
    const T_RRF_CVF = multiplyTransformMatrices(
      translationMatrix4d(-2, 1.5, 0.5),
      rotationZMatrix4d(Math.PI / 3),
    );
    const a: TransformPoint3 = [0, 0, 0];
    const b: TransformPoint3 = [3, 4, 0];

    expect(distance3(a, b)).toBeCloseTo(5);
    expect(distance3(transformPoint3(T_RRF_CVF, a), transformPoint3(T_RRF_CVF, b))).toBeCloseTo(5);
  });

  it("supports explicit uniform-scale similarity transforms", () => {
    const T_BA = multiplyTransformMatrices(
      translationMatrix4d(2, 0, 0),
      uniformScaleMatrix4d(2),
    );
    const T_AB = invertSimilarityTransformMatrix4d(T_BA);

    expectPointCloseTo(transformPoint3(T_BA, [1, 2, 3]), [4, 4, 6]);
    expectPointCloseTo(transformPoint3(T_AB, [4, 4, 6]), [1, 2, 3]);
  });
});

describe("COLMAP/OpenCV RDF to Three.js camera conversion fixture", () => {
  it("maps +Y down to +Y up and +Z forward to Three camera -Z", () => {
    const pointColmapRdf: TransformPoint3 = [1, 2, 3];
    const pointThreeCamera = transformPoint3(T_THREE_CAMERA_COLMAP_RDF, pointColmapRdf);

    expect(transformName("THREE_CAMERA", "COLMAP_RDF")).toBe("T_THREE_CAMERA_COLMAP_RDF");
    expectPointCloseTo(pointThreeCamera, [1, -2, -3]);
  });

  it("is a proper handedness-preserving basis change", () => {
    const result = validateSimilarityTransformMatrix4d(T_THREE_CAMERA_COLMAP_RDF);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected RDF to Three camera fixture to be a valid similarity transform");
    }
    expect(result.determinant).toBeCloseTo(1);
    expect(result.scale).toBeCloseTo(1);
  });
});

describe("Matrix4d storage hygiene", () => {
  it("converts row-major documentation examples into Three.js column-major storage", () => {
    /*
     * Three.js docs display matrices in row-major form, but Matrix4 elements
     * are stored column-major. A translation written from docs as the rows
     * below must land in indices 12, 13, 14 before transformPoint3 sees it.
     */
    const fromRows = matrix4dFromRowMajor([
      [1, 0, 0, 9],
      [0, 1, 0, 8],
      [0, 0, 1, 7],
      [0, 0, 0, 1],
    ]);

    expect(fromRows[12]).toBe(9);
    expect(fromRows[13]).toBe(8);
    expect(fromRows[14]).toBe(7);
    expectPointCloseTo(transformPoint3(fromRows, [1, 2, 3]), [10, 10, 10]);
  });

  it("rejects non-uniform parent-scale transforms instead of silently decomposing them", () => {
    const nonUniformParent = scaleMatrix4d(2, 1, 1);
    const result = validateSimilarityTransformMatrix4d(nonUniformParent);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected non-uniform scale to be rejected");
    }
    expect(result.reason).toBe("non_uniform_scale");
    expect(() => {
      assertSimilarityTransformMatrix4d(nonUniformParent);
    }).toThrow(/non_uniform_scale/);
  });

  it("rejects mirrored bases as invalid alignment transforms", () => {
    const mirrored = scaleMatrix4d(-1, 1, 1);
    const result = validateSimilarityTransformMatrix4d(mirrored);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected mirrored basis to be rejected");
    }
    expect(result.reason).toBe("mirrored_basis");
  });

  it("leaves identity as identity", () => {
    const identity: TransformMatrix4d = IDENTITY_TRANSFORM_MATRIX4D;

    expectPointCloseTo(transformPoint3(identity, [1, 2, 3]), [1, 2, 3]);
  });

  it("accepts the 180 degree X rotation used by the RDF fixture", () => {
    const rotation = rotationXMatrix4d(Math.PI);

    expectPointCloseTo(transformPoint3(rotation, [1, 2, 3]), [1, -2, -3]);
    expect(validateSimilarityTransformMatrix4d(rotation).ok).toBe(true);
  });
});

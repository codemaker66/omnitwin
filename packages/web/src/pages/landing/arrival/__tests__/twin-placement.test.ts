import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import { meshRootWorldMatrix } from "../../../../twin/dollhouse-peel.js";
import {
  TRADES_HALL_TWIN_PLACEMENT,
  twinPlacementMatrix,
  type TwinPlacement,
} from "../twin-placement.js";

// -----------------------------------------------------------------------------
// twin-placement — matrix math only (Arrival Task 7, Step 1). No React, no
// GPU: the twin basis (meshRootWorldMatrix, twin-basis.ts's single calibration
// surface) is the inner truth; twinPlacementMatrix is a pure OUTER transform
// wrapped around it (spec §3) — recalibrating the Arrival's placement (Task 8)
// must never require touching the peel system.
// -----------------------------------------------------------------------------

/**
 * Element-wise, tolerance-based matrix comparison. A raw `toEqual` on
 * `.elements` is too strict: composing a quaternion into a matrix and
 * multiplying through an identity-shaped rotation can legitimately flip a
 * zero-valued entry's sign bit (`-0` vs `+0`, confirmed empirically — the
 * magnitudes are bit-identical, only some zero entries' signs differ), which
 * `toEqual` treats as a mismatch even though `-0 === 0` for every purpose
 * that matters to a transform. `toBeCloseTo` per element keeps the check just
 * as strict at real precision while tolerating that artifact.
 */
function expectMatrixClose(actual: Matrix4, expected: Matrix4, precision = 10): void {
  expect(actual.elements).toHaveLength(expected.elements.length);
  for (const [index, expectedValue] of expected.elements.entries()) {
    const actualValue = actual.elements[index];
    if (actualValue === undefined) {
      throw new Error(`matrix element ${String(index)} missing`);
    }
    expect(actualValue).toBeCloseTo(expectedValue, precision);
  }
}

describe("twinPlacementMatrix", () => {
  it("returns exactly meshRootWorldMatrix() for the zero placement", () => {
    const zero: TwinPlacement = { positionM: [0, 0, 0], headingRad: 0 };
    const result = twinPlacementMatrix(zero);
    const expected = meshRootWorldMatrix();
    expectMatrixClose(result, expected);
  });

  it("is seeded at zero (Task 8 calibrates against the rendered tiles)", () => {
    expect(TRADES_HALL_TWIN_PLACEMENT).toEqual({ positionM: [0, 0, 0], headingRad: 0 });
  });

  it("shifts the position column by a pure translation, leaving the basis rotation untouched", () => {
    const translation: readonly [number, number, number] = [3, -1.5, 7];
    const basis = meshRootWorldMatrix();
    const result = twinPlacementMatrix({ positionM: translation, headingRad: 0 });

    const basisPosition = new Vector3().setFromMatrixPosition(basis);
    const resultPosition = new Vector3().setFromMatrixPosition(result);
    expect(resultPosition.x).toBeCloseTo(basisPosition.x + translation[0], 10);
    expect(resultPosition.y).toBeCloseTo(basisPosition.y + translation[1], 10);
    expect(resultPosition.z).toBeCloseTo(basisPosition.z + translation[2], 10);

    // Splice the RESULT's own position into a clone of the basis: if nothing
    // but the position column moved, this reproduces `result` exactly — i.e.
    // the rotation/scale block came through untouched.
    const expected = basis.clone().setPosition(resultPosition);
    expectMatrixClose(result, expected);
  });

  it("rotates so local +X maps to world -Z at headingRad = PI/2 (three.js yaw)", () => {
    const result = twinPlacementMatrix({ positionM: [0, 0, 0], headingRad: Math.PI / 2 });
    const localX = new Vector3(1, 0, 0).transformDirection(result);
    expect(localX.x).toBeCloseTo(0, 10);
    expect(localX.y).toBeCloseTo(0, 10);
    expect(localX.z).toBeCloseTo(-1, 10);
  });
});

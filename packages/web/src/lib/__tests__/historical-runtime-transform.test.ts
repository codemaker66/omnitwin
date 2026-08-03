import { describe, expect, it } from "vitest";
import type { PhaseLayoutRuntimeAvailableBinding, TransformArtifactV0 } from "@omnitwin/types";
import { resolveHistoricalRuntimeAssetToRrfTransform } from "../historical-runtime-transform.js";
import { historicalRuntimeBindingFixture } from "../../test-utils/historical-runtime-binding.js";

function transform(
  sourceFrame: TransformArtifactV0["sourceFrame"],
  targetFrame: TransformArtifactV0["targetFrame"],
  matrix: TransformArtifactV0["matrix"],
): TransformArtifactV0 {
  return {
    ...historicalRuntimeBindingFixture().transformArtifact,
    id: `${sourceFrame.toLowerCase()}-to-${targetFrame.toLowerCase()}`,
    sourceFrame,
    targetFrame,
    matrix,
  };
}

describe("resolveHistoricalRuntimeAssetToRrfTransform", () => {
  it("uses an exact asset-local to RRF column-major transform directly", () => {
    const matrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      4, 5, 6, 1,
    ];
    const binding = historicalRuntimeBindingFixture({
      transformArtifact: transform("ARF", "RRF", matrix),
    });
    expect(resolveHistoricalRuntimeAssetToRrfTransform(binding)).toEqual({ ok: true, matrix });
  });

  it("inverts the exact RRF to asset-local transform", () => {
    const binding = historicalRuntimeBindingFixture({
      transformArtifact: transform("RRF", "G", [
        2, 0, 0, 0,
        0, 2, 0, 0,
        0, 0, 2, 0,
        4, 0, 0, 1,
      ]),
    });
    const result = resolveHistoricalRuntimeAssetToRrfTransform(binding);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.from(result.matrix, (value) => Object.is(value, -0) ? 0 : value)).toEqual([
        0.5, 0, 0, 0,
        0, 0.5, 0, 0,
        0, 0, 0.5, 0,
        -2, 0, 0, 1,
      ]);
    }
  });

  it("fails closed when an inverse is singular or impossible", () => {
    const binding = historicalRuntimeBindingFixture();
    const malformed: PhaseLayoutRuntimeAvailableBinding = {
      ...binding,
      transformArtifact: {
        ...binding.transformArtifact,
        sourceFrame: "RRF",
        targetFrame: "ARF",
        matrix: [
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 1,
        ],
      },
    };
    expect(resolveHistoricalRuntimeAssetToRrfTransform(malformed)).toEqual({
      ok: false,
      message: "The frozen runtime transform could not be inverted safely.",
    });
  });

  it.each([
    ["ARF", "CVF"],
    ["CVF", "RRF"],
    ["W", "RRF"],
    ["M", "RRF"],
    ["THREE_CAMERA", "RRF"],
  ] as const)("does not invent the missing %s to %s chain", (sourceFrame, targetFrame) => {
    const binding = historicalRuntimeBindingFixture({
      transformArtifact: transform(sourceFrame, targetFrame, [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]),
    });
    expect(resolveHistoricalRuntimeAssetToRrfTransform(binding)).toEqual({
      ok: false,
      message: "The frozen runtime has no reviewed asset-local to render-frame transform.",
    });
  });
});

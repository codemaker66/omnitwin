import {
  invertSimilarityTransformMatrix4d,
  matrix4d,
  type PhaseLayoutRuntimeAvailableBinding,
  type TransformMatrix4d,
} from "@omnitwin/types";

const ASSET_LOCAL_FRAMES = new Set(["ARF", "G", "COLMAP_RDF"]);

export type HistoricalRuntimeTransformResolution =
  | { readonly ok: true; readonly matrix: TransformMatrix4d }
  | { readonly ok: false; readonly message: string };

/**
 * v1 has exactly one reviewed transform. Render only when it is a complete
 * asset-local -> RRF chain (or the exact invertible reverse); never infer a
 * missing CVF/W/planner transform from room geometry.
 */
export function resolveHistoricalRuntimeAssetToRrfTransform(
  binding: PhaseLayoutRuntimeAvailableBinding,
): HistoricalRuntimeTransformResolution {
  const artifact = binding.transformArtifact;
  const matrix = matrix4d(artifact.matrix);
  if (ASSET_LOCAL_FRAMES.has(artifact.sourceFrame) && artifact.targetFrame === "RRF") {
    return { ok: true, matrix };
  }
  if (artifact.sourceFrame === "RRF" && ASSET_LOCAL_FRAMES.has(artifact.targetFrame)) {
    try {
      return { ok: true, matrix: invertSimilarityTransformMatrix4d(matrix) };
    } catch {
      return {
        ok: false,
        message: "The frozen runtime transform could not be inverted safely.",
      };
    }
  }
  return {
    ok: false,
    message: "The frozen runtime has no reviewed asset-local to render-frame transform.",
  };
}

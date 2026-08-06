import type { SparkSplatRenderProfile } from "../../components/scene/SparkSplatLayer.js";
import captureBinding from "./reception-capture-binding-v1.json";

export interface ReceptionViewerProfile {
  readonly id: "reception-fixed-fine-review-v1";
  readonly canvasDpr: readonly [number, number];
  readonly expectedSplatMeshMatrixWorld: readonly number[];
  readonly canvas: {
    readonly antialias: false;
    readonly alpha: true;
    readonly premultipliedAlpha: true;
    readonly powerPreference: "high-performance";
    readonly outputColorSpace: "srgb";
    readonly toneMapping: "ACESFilmicToneMapping";
    readonly toneMappingExposure: 1;
  };
  readonly spark: SparkSplatRenderProfile;
}

/**
 * One controlled viewer contract for both audited Reception candidates.
 *
 * The numeric values explicitly pin the inspected Spark 2.0 baseline settings
 * that can affect this comparison. LoD is disabled because each candidate is already an externally
 * selected fixed fine frontier; generating or selecting another LoD here would
 * reintroduce the composition confound this review is designed to remove.
 * This profile makes the comparison reproducible. It is not, by itself, proof
 * that either source is visually better.
 */
export const RECEPTION_FIXED_FINE_REVIEW_PROFILE =
  captureBinding.viewerProfile as unknown as ReceptionViewerProfile;

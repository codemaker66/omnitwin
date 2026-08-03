import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CanonicalJsonValueSchema,
  stableCanonicalJson,
} from "@omnitwin/types";
import {
  isDirectHistoricalPresentationTransform,
  runtimePackageManifestDigest,
} from "../../services/phase-layout-runtime-admission.js";

describe("phase layout runtime admission", () => {
  it("accepts only one direct RRF↔asset-local transform in v1", () => {
    for (const pair of [
      { sourceFrame: "RRF", targetFrame: "ARF" },
      { sourceFrame: "G", targetFrame: "RRF" },
      { sourceFrame: "RRF", targetFrame: "COLMAP_RDF" },
    ]) {
      expect(isDirectHistoricalPresentationTransform(pair)).toBe(true);
    }
    for (const pair of [
      { sourceFrame: "CVF", targetFrame: "RRF" },
      { sourceFrame: "ARF", targetFrame: "G" },
      { sourceFrame: "THREE_CAMERA", targetFrame: "RRF" },
      { sourceFrame: "RRF", targetFrame: "W" },
    ]) {
      expect(isDirectHistoricalPresentationTransform(pair)).toBe(false);
    }
  });

  it("uses the Event Architect manifest digest convention without a domain prefix", () => {
    const manifest = {
      schemaVersion: "venviewer.runtime-package.v1" as const,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      packageType: "room-runtime" as const,
      assets: {
        primaryVisualAssetVersionId: null,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    };
    const expected = createHash("sha256")
      .update(stableCanonicalJson(CanonicalJsonValueSchema.parse(manifest)), "utf8")
      .digest("hex");
    expect(runtimePackageManifestDigest(manifest)).toBe(expected);
  });
});

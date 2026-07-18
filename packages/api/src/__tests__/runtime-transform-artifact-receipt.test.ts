import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalRuntimeTransformArtifactJson,
  runtimeTransformArtifactSha256,
} from "../lib/runtime-transform-artifact-receipt.js";

function transformArtifact(): Record<string, unknown> {
  return {
    id: "reception-room-reviewed-transform-v1",
    sourceFrame: "CVF",
    targetFrame: "RRF",
    units: "meters",
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    alignmentMethod: "visual_alignment",
    residualRmseM: null,
    landmarks: [],
    provenance: {
      state: "inferred",
      refs: [{
        refType: "artifact",
        ref: "docs/reception-room-transform-review.json",
        role: "review_evidence",
      }],
    },
    creator: {
      actorType: "tool",
      id: "runtime-transform-builder",
      displayName: "Runtime transform builder",
    },
    reviewer: {
      actorType: "human",
      id: "reviewer-1",
      displayName: "Review operator",
      role: "room_transform_reviewer",
    },
    date: "2026-07-16T12:00:00.000Z",
  };
}

describe("runtime transform artifact receipt", () => {
  it("hashes validated canonical JSON with recursively sorted object keys", () => {
    const artifact = transformArtifact();
    const reordered = {
      reviewer: artifact.reviewer,
      date: artifact.date,
      creator: artifact.creator,
      provenance: artifact.provenance,
      landmarks: artifact.landmarks,
      residualRmseM: artifact.residualRmseM,
      alignmentMethod: artifact.alignmentMethod,
      matrix: artifact.matrix,
      units: artifact.units,
      targetFrame: artifact.targetFrame,
      sourceFrame: artifact.sourceFrame,
      id: artifact.id,
    };

    const canonical = canonicalRuntimeTransformArtifactJson(artifact);
    expect(canonicalRuntimeTransformArtifactJson(reordered)).toBe(canonical);
    expect(runtimeTransformArtifactSha256(reordered)).toBe(
      createHash("sha256").update(canonical, "utf8").digest("hex"),
    );
    expect(runtimeTransformArtifactSha256(reordered)).toBe(
      runtimeTransformArtifactSha256(artifact),
    );
  });

  it("changes the receipt when exact transform content changes", () => {
    const artifact = transformArtifact();
    const changed = {
      ...artifact,
      creator: {
        ...(artifact.creator as Record<string, unknown>),
        displayName: "A different builder identity",
      },
    };

    expect(runtimeTransformArtifactSha256(changed)).not.toBe(
      runtimeTransformArtifactSha256(artifact),
    );
  });

  it("rejects content that is not a valid TransformArtifactV0", () => {
    expect(() => runtimeTransformArtifactSha256({
      ...transformArtifact(),
      reviewer: { actorType: "tool", id: "automated-reviewer", role: "reviewer" },
    })).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
  ReconstructionReviewEvidenceArtifactRegistrationInputSchema,
  ReconstructionSceneAuthorityMapV0Schema,
  computeReconstructionReviewEvidenceArtifactDigest,
  type ReconstructionSceneAuthorityMapV0,
} from "../reconstruction-review-evidence.js";
import { TransformArtifactV0Schema, type TransformArtifactV0 } from "../runtime-venue-manifest.js";

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function transform(): TransformArtifactV0 {
  return TransformArtifactV0Schema.parse({
    id: "trades-hall-transform-v1",
    sourceFrame: "ARF",
    targetFrame: "CVF",
    units: "meters",
    matrix: IDENTITY,
    alignmentMethod: "matterport_e57_extraction",
    residualRmseM: 0.01,
    landmarks: [],
    provenance: {
      state: "measured",
      refs: [{ refType: "control_network", ref: "controls/trades-hall-v1", role: "metric-control" }],
    },
    creator: { actorType: "pipeline", id: "twin-forge" },
    reviewer: { actorType: "human", id: "venue-reviewer", role: "reconstruction-reviewer" },
    date: "2026-07-11T08:00:00.000Z",
  });
}

function sceneMap(transformDigest: string): ReconstructionSceneAuthorityMapV0 {
  const releaseFile = { kind: "release_file" as const, ref: "mesh/dollhouse.glb" };
  return ReconstructionSceneAuthorityMapV0Schema.parse({
    schemaVersion: RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
    id: "trades-hall-authority-v1",
    venueSlug: "trades-hall",
    generatedAt: "2026-07-11T08:10:00.000Z",
    regions: [{
      id: "whole-venue",
      label: "Whole venue release",
      scope: { kind: "whole_venue" },
      authorities: {
        geometryAuthority: releaseFile,
        appearanceAuthority: { kind: "release_file", ref: "pano/scan_000/equirect_512.webp" },
        lightingAuthority: { kind: "none", ref: null },
        physicsAuthority: releaseFile,
        semanticAuthority: { kind: "semantic_graph", ref: "venue-graph/trades-hall" },
        interactionAuthority: releaseFile,
        exportAuthority: releaseFile,
      },
      truthStatus: "measured",
      confidenceTier: "layout_grade",
      provenanceRefs: [{ refType: "artifact", ref: "evidence/trades-hall", role: "release-source" }],
      reconstructionStrategy: "matterpak_original",
      transformArtifactRef: {
        artifactId: "trades-hall-transform-v1",
        artifactDigest: transformDigest,
      },
    }],
  });
}

describe("Reconstruction review evidence", () => {
  it("strictly validates D-024 transform and Scene Authority Map bodies", () => {
    const transformArtifact = transform();
    const transformDigest = computeReconstructionReviewEvidenceArtifactDigest(transformArtifact);
    const map = sceneMap(transformDigest);
    expect(map.regions[0]?.authorities.geometryAuthority).toEqual({
      kind: "release_file",
      ref: "mesh/dollhouse.glb",
    });
    expect(computeReconstructionReviewEvidenceArtifactDigest(map)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects a Scene Authority Map registered under a different venue", () => {
    const map = sceneMap(computeReconstructionReviewEvidenceArtifactDigest(transform()));
    const result = ReconstructionReviewEvidenceArtifactRegistrationInputSchema.safeParse({
      venueSlug: "another-hall",
      artifactKind: "scene_authority_map_v0",
      artifact: map,
      idempotencyKey: "scene-map:1",
    });
    expect(result.success).toBe(false);
  });

  it("hashes the exact strict artifact material", () => {
    const first = transform();
    const second = TransformArtifactV0Schema.parse({ ...first, residualRmseM: 0.02 });
    expect(computeReconstructionReviewEvidenceArtifactDigest(first)).not.toBe(
      computeReconstructionReviewEvidenceArtifactDigest(second),
    );
  });
});


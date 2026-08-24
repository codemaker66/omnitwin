import {
  computeFoundryRoomRealityPackageAssemblySha256,
  type FoundryRoomRealityPackageAssemblyPayloadV0,
  type FoundryRoomRealityPackageAssemblyResultV0,
} from "@omnitwin/reconstruction-foundry";
import {
  RECONSTRUCTION_QA_CHECK_KEYS,
  RECONSTRUCTION_QA_SCHEMA_VERSION,
  RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
  ReconstructionQaReportSchema,
  ReconstructionSceneAuthorityMapV0Schema,
  TransformArtifactV0Schema,
  computeReconstructionQaReportDigest,
  computeReconstructionReviewEvidenceArtifactDigest,
  type ReconstructionQaReport,
  type ReconstructionSceneAuthorityMapV0,
  type TransformArtifactV0,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import {
  LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS,
  LocalRoomRealityReviewError,
  compileLocalRoomRealityReviewDraftV0,
  compileLocalRoomRealityReviewSurfaceV0,
  verifyLocalRoomRealityReviewDraftV0,
  type LocalRoomRealityReviewDecisionInputV0,
  type LocalRoomRealityReviewDossierV0,
  type LocalRoomRealityReviewSurfaceV0,
} from "../local-room-reality-review.js";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const IDENTITY_MATRIX = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
] as const;

function candidate(): FoundryRoomRealityPackageAssemblyResultV0 {
  const payload: FoundryRoomRealityPackageAssemblyPayloadV0 = {
    schemaVersion: "omnitwin.foundry.room-reality-package-assembly.v0",
    status: "local_unverified_candidate",
    packageId: "grand-hall-room-reality-v0",
    projectId: "grand-hall-local-review",
    ingestManifestSha256: SHA_A,
    packageDraftSha256: SHA_B,
    referenceCatalogSha256: SHA_C,
    ingestLegalReviewState: "requires_review",
    referenceCatalogAuthority: "caller_supplied_unverified",
    exactMemberIdentities: "not_verified",
    movableObjectClassification: "not_verified",
    releaseEligibility: "blocked",
    releaseBlockers: [
      "EXACT_MEMBER_IDENTITIES_UNVERIFIED",
      "MOVABLE_OBJECT_CLASSIFICATION_UNVERIFIED",
      "REFERENCE_CATALOG_UNAUTHENTICATED",
      "RIGHTS_NOT_APPROVED",
    ],
    canonicalPackage: {
      schemaVersion: "omnitwin.foundry.canonical-venue-package.v0",
      id: "grand-hall-room-reality-v0",
      projectId: "grand-hall-local-review",
      venueFrameId: "grand-hall-cvf",
      ingestManifestSha256: SHA_A,
      rooms: [
        {
          id: "grand-hall",
          label: "Grand Hall",
          roomFrameId: "grand-hall-room-frame",
          venueTransformArtifactAssetId: "transform-room-to-cvf",
          sceneAuthorityMapAssetId: "scene-map-grand-hall",
          representations: [
            {
              id: "grand-hall-architecture",
              role: "architectural_mesh",
              assetId: "asset-architectural-mesh",
              format: "glb",
              coordinateFrameId: "grand-hall-room-frame",
              transformArtifactAssetId: "transform-mesh-to-room",
              qualityReportId: "qa-architecture",
              provenanceClass: "captured",
              lod: 0,
            },
            {
              id: "grand-hall-camera-spawns",
              role: "camera_spawn_points",
              assetId: "asset-camera-spawns",
              format: "json",
              coordinateFrameId: "grand-hall-room-frame",
              transformArtifactAssetId: null,
              qualityReportId: "qa-camera-spawns",
              provenanceClass: "captured",
              lod: 0,
            },
            {
              id: "grand-hall-connectivity",
              role: "room_connectivity",
              assetId: "asset-room-connectivity",
              format: "json",
              coordinateFrameId: "grand-hall-room-frame",
              transformArtifactAssetId: null,
              qualityReportId: "qa-connectivity",
              provenanceClass: "captured",
              lod: 0,
            },
            {
              id: "grand-hall-semantics",
              role: "semantic_graph",
              assetId: "asset-semantic-graph",
              format: "json",
              coordinateFrameId: "grand-hall-room-frame",
              transformArtifactAssetId: null,
              qualityReportId: "qa-semantics",
              provenanceClass: "captured",
              lod: 0,
            },
          ],
        },
      ],
      generatedRegions: [],
      packageQualityReportId: "qa-package",
      releaseManifestAssetId: null,
      createdAt: "2026-08-09T09:00:00.000Z",
    },
    unresolvedReferences: [],
    authority: "none",
    capabilities: {
      signing: "not_authorized",
      publication: "not_authorized",
      runtimeActivation: "not_authorized",
      exportAuthority: "not_authorized",
      runtimePackageRegistration: "not_authorized",
    },
  };
  return {
    ...payload,
    assemblySha256: computeFoundryRoomRealityPackageAssemblySha256(payload),
  };
}

function transform(
  id: string,
  sourceFrame: "ARF" | "CVF",
  targetFrame: "CVF" | "RRF",
): TransformArtifactV0 {
  return TransformArtifactV0Schema.parse({
    id,
    sourceFrame,
    targetFrame,
    units: "meters",
    matrix: IDENTITY_MATRIX,
    alignmentMethod: "matterport_e57_extraction",
    residualRmseM: 0.018,
    landmarks: [],
    provenance: {
      state: "measured",
      refs: [
        {
          refType: "control_network",
          ref: "review-fixtures/metric-control",
          role: "metric-control",
        },
      ],
    },
    creator: { actorType: "pipeline", id: "review-fixture-pipeline" },
    reviewer: {
      actorType: "human",
      id: "review-fixture-human",
      role: "reconstruction-reviewer",
    },
    date: "2026-08-09T09:15:00.000Z",
  });
}

function qaReport(): ReconstructionQaReport {
  const material = {
    schemaVersion:
      RECONSTRUCTION_QA_SCHEMA_VERSION as typeof RECONSTRUCTION_QA_SCHEMA_VERSION,
    releaseDigest: "d".repeat(64),
    sourceManifestSha256: "e".repeat(64),
    qaProfileVersion: "local-review-fixture.v1",
    qaProfileDigest: "f".repeat(64),
    outcome: "passed" as const,
    checks: RECONSTRUCTION_QA_CHECK_KEYS.map((checkKey) => ({
      checkKey,
      status: "passed" as const,
      messageKey: `foundry.qa.${checkKey}.passed`,
      evidence: [{ label: checkKey, sha256: "1".repeat(64) }],
    })),
  };
  return ReconstructionQaReportSchema.parse({
    ...material,
    reportDigest: computeReconstructionQaReportDigest(material),
  });
}

function sceneMap(
  linkedTransform: TransformArtifactV0,
): ReconstructionSceneAuthorityMapV0 {
  return ReconstructionSceneAuthorityMapV0Schema.parse({
    schemaVersion: RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
    id: "grand-hall-scene-map-fixture",
    venueSlug: "grand-hall",
    generatedAt: "2026-08-09T09:20:00.000Z",
    regions: [
      {
        id: "whole-room",
        label: "Whole room fixture region",
        scope: { kind: "whole_venue" },
        authorities: {
          geometryAuthority: {
            kind: "external_artifact",
            ref: "asset-architectural-mesh",
          },
          appearanceAuthority: { kind: "none", ref: null },
          lightingAuthority: { kind: "none", ref: null },
          physicsAuthority: {
            kind: "external_artifact",
            ref: "asset-architectural-mesh",
          },
          semanticAuthority: {
            kind: "semantic_graph",
            ref: "asset-semantic-graph",
          },
          interactionAuthority: {
            kind: "external_artifact",
            ref: "asset-architectural-mesh",
          },
          exportAuthority: { kind: "none", ref: null },
        },
        truthStatus: "measured",
        confidenceTier: "layout_grade",
        provenanceRefs: [
          {
            refType: "artifact",
            ref: "review-fixtures/scene-map-source",
            role: "source",
          },
        ],
        reconstructionStrategy: "e57_poisson",
        transformArtifactRef: {
          artifactId: linkedTransform.id,
          artifactDigest:
            computeReconstructionReviewEvidenceArtifactDigest(linkedTransform),
        },
      },
    ],
  });
}

function completeDossier(): LocalRoomRealityReviewDossierV0 {
  const roomTransform = transform("room-to-cvf-body", "ARF", "CVF");
  const meshTransform = transform("mesh-to-room-body", "CVF", "RRF");
  const report = qaReport();
  return {
    candidate: candidate(),
    evidence: {
      transforms: [
        { id: "transform-mesh-to-room", artifact: meshTransform },
        { id: "transform-room-to-cvf", artifact: roomTransform },
      ],
      sceneAuthorityMaps: [
        { id: "scene-map-grand-hall", artifact: sceneMap(roomTransform) },
      ],
      qualityReports: [
        "qa-architecture",
        "qa-camera-spawns",
        "qa-connectivity",
        "qa-package",
        "qa-semantics",
      ].map((id) => ({ id, artifact: report })),
    },
  };
}

function decisions(
  surface: LocalRoomRealityReviewSurfaceV0,
): LocalRoomRealityReviewDecisionInputV0[] {
  return surface.dimensions.map((dimension) => ({
    dimensionId: dimension.id,
    action: "record_unresolved",
    note: `Remain unresolved for ${dimension.label.toLowerCase()}.`,
  }));
}

describe("local Room Reality Package review boundary", () => {
  it("compiles a deterministic authority-none status surface without reading media", () => {
    const dossier = { candidate: candidate() };
    const first = compileLocalRoomRealityReviewSurfaceV0(dossier);
    const second = compileLocalRoomRealityReviewSurfaceV0(dossier);

    expect(second).toEqual(first);
    expect(first.authority).toBe("none");
    expect(first.inspectionBoundary).toEqual({
      realMediaRead: "not_performed",
      sourcePixelsCompared: "not_performed",
      geometryDecoded: "not_performed",
      exactMemberIdentities: "not_verified",
      referenceCatalogAuthority: "caller_supplied_unverified",
      correctionApplication: "disabled",
    });
    expect(first.dimensions.map((dimension) => dimension.id)).toEqual(
      LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS,
    );
    expect(
      first.dimensions.find((dimension) => dimension.id === "source_comparison")
        ?.observedStatus,
    ).toBe("not_performed");
    expect(
      first.dimensions.find((dimension) => dimension.id === "alignment")
        ?.observedStatus,
    ).toBe("reference_ids_only");
    expect(
      first.dimensions.find((dimension) => dimension.id === "privacy")
        ?.observedStatus,
    ).toBe("not_reviewed");
    expect(first.capabilities).toMatchObject({
      execution: "not_authorized",
      correctionApplication: "not_authorized",
      packageExport: "not_authorized",
      runtimeActivation: "not_authorized",
    });
    expect(first.reviewSurfaceSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("summarizes strict transform, Scene Authority, and QA bodies as untrusted contract evidence", () => {
    const surface = compileLocalRoomRealityReviewSurfaceV0(completeDossier());

    expect(surface.contractEvidence.transforms).toHaveLength(2);
    expect(surface.contractEvidence.transforms[0]).toMatchObject({
      units: "meters",
      residualRmseM: 0.018,
      trust: "strict_contract_body_untrusted_identity",
    });
    expect(surface.contractEvidence.sceneAuthorityMaps[0]).toMatchObject({
      regionCount: 1,
      exportAuthorityNoneCount: 1,
      trust: "strict_contract_body_untrusted_identity",
    });
    expect(
      surface.contractEvidence.sceneAuthorityMaps[0]?.transformLinks[0]?.state,
    ).toBe("matched_untrusted_body");
    expect(surface.contractEvidence.qualityReports).toHaveLength(5);
    expect(
      surface.dimensions.find((dimension) => dimension.id === "alignment")
        ?.observedStatus,
    ).toBe("contract_validated_untrusted");
    expect(
      surface.dimensions.find((dimension) => dimension.id === "completeness")
        ?.observedStatus,
    ).toBe("qa_reported_untrusted");
    expect(
      surface.dimensions.find((dimension) => dimension.id === "crop")
        ?.observedStatus,
    ).toBe("not_performed");
  });

  it("rejects malformed or irrelevant evidence instead of showing a partial false match", () => {
    const dossier = completeDossier();
    expect(() =>
      compileLocalRoomRealityReviewSurfaceV0({
        ...dossier,
        evidence: {
          ...dossier.evidence,
          transforms: [
            {
              id: "unreferenced-transform",
              artifact: dossier.evidence.transforms[0]?.artifact,
            },
          ],
        },
      }),
    ).toThrow(/does not reference/u);
    expect(() =>
      compileLocalRoomRealityReviewSurfaceV0({
        candidate: dossier.candidate,
        evidence: {
          transforms: [
            {
              id: "transform-room-to-cvf",
              artifact: { id: "not-a-transform" },
            },
          ],
        },
      }),
    ).toThrow(/strict existing contract/u);
  });

  it("records a canonical digest-bound draft without creating approval or correction authority", () => {
    const surface = compileLocalRoomRealityReviewSurfaceV0(completeDossier());
    const input = {
      reviewSurfaceSha256: surface.reviewSurfaceSha256,
      candidateAssemblySha256: surface.candidate.assemblySha256,
      reviewedAt: "2026-08-09T10:00:00.000Z",
      reviewedBy: "Local fixture reviewer",
      decisions: decisions(surface).reverse(),
    };
    const first = compileLocalRoomRealityReviewDraftV0(surface, input);
    const second = compileLocalRoomRealityReviewDraftV0(surface, {
      ...input,
      decisions: [...input.decisions].reverse(),
    });

    expect(second).toEqual(first);
    expect(first.decisions.map((decision) => decision.dimensionId)).toEqual(
      LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS,
    );
    expect(first.authority).toBe("none");
    expect(first.releaseEligibility).toBe("blocked");
    expect(first.capabilities.correctionApplication).toBe("not_authorized");
    expect(first.capabilities.packageExport).toBe("not_authorized");
    expect(first.disposition).toBe("remains_unverified");
    expect(verifyLocalRoomRealityReviewDraftV0(first, surface)).toEqual(first);
  });

  it("rejects stale, incomplete, invalid, and tampered draft material", () => {
    const surface = compileLocalRoomRealityReviewSurfaceV0(completeDossier());
    const validDecisions = decisions(surface);
    const base = {
      reviewSurfaceSha256: surface.reviewSurfaceSha256,
      candidateAssemblySha256: surface.candidate.assemblySha256,
      reviewedAt: "2026-08-09T10:00:00.000Z",
      reviewedBy: "Local fixture reviewer",
      decisions: validDecisions,
    };

    expect(() =>
      compileLocalRoomRealityReviewDraftV0(surface, {
        ...base,
        reviewSurfaceSha256: SHA_A,
      }),
    ).toThrow(/changed/u);
    expect(() =>
      compileLocalRoomRealityReviewDraftV0(surface, {
        ...base,
        decisions: validDecisions.slice(1),
      }),
    ).toThrow(/exactly one decision/u);
    expect(() =>
      compileLocalRoomRealityReviewDraftV0(surface, {
        ...base,
        decisions: validDecisions.map((decision) =>
          decision.dimensionId === "source_comparison"
            ? { ...decision, action: "request_privacy_redaction" }
            : decision,
        ),
      }),
    ).toThrow(/not allowed/u);

    const draft = compileLocalRoomRealityReviewDraftV0(surface, base);
    expect(() =>
      verifyLocalRoomRealityReviewDraftV0(
        {
          ...draft,
          reviewedBy: "Tampered reviewer",
        },
        surface,
      ),
    ).toThrow(LocalRoomRealityReviewError);
  });
});

import { describe, expect, it } from "vitest";
import {
  runtimeQaRecordAllowsPublicRoomVisual,
  type RuntimeQaRecordRow,
  type RuntimeTransformArtifactRow,
} from "../routes/assets.js";

const NOW = new Date("2026-06-16T00:00:00.000Z");
const RUNTIME_PACKAGE_ID = "10000000-0000-4000-8000-000000000004";
const SIGNED_TRANSFORM_ID = "reception-room-landmark-solve-v0";
const evidenceRef = {
  label: "Exposure review",
  ref: "docs/operations/reception-room-exposure-review.md",
};

function qaRecordRow(overrides: Partial<RuntimeQaRecordRow> = {}): RuntimeQaRecordRow {
  const record: RuntimeQaRecordRow["recordJson"] = {
    schemaVersion: "runtime-qa-record.v0",
    recordId: "reception-room-runtime-qa-2026-06-16",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackageId: RUNTIME_PACKAGE_ID,
    recordedAt: "2026-06-16T00:00:00.000Z",
    recordedBy: "runtime-qa-operator",
    assetEvidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    sourceBundle: {
      sourceLabel: "Reception Room reviewed runtime bundle",
      sourceBundleHash: "a".repeat(64),
      totalSourceFiles: 48,
      totalSourceBytes: 64_323_846,
      totalSplats: 3_491_322,
    },
    sparkLoad: {
      renderer: "@sparkjsdev/spark",
      route: "/dev/trades-hall-visual?venue=trades-hall&room=reception-room",
      loadStatus: "loaded",
      visualChunkCount: 7,
      excludedChunkCount: 1,
      loadedSplats: 3_491_322,
      evidenceRefs: [evidenceRef],
    },
    viewTransform: {
      posture: "signed_room_local_transform",
      position: [1.11, 2.57, 2.77],
      rotation: [-Math.PI / 2, 0, 0],
      scale: 0.63,
      signedTransformArtifactId: SIGNED_TRANSFORM_ID,
      note: "Signed room-local transform for reviewed runtime alignment.",
    },
    cameraProfile: {
      position: [0.2, 6.2, 13.4],
      target: [0, 0.9, -4.15],
      arrivalPosition: [0.25, 7.15, 14.1],
      arrivalTarget: [0, 1.2, -4],
      arrivalDurationMs: 1400,
      fov: 48,
      targetBounds: {
        min: [-5.8, 0.7, -9.2],
        max: [5.8, 2.35, 4.8],
      },
      cameraBounds: {
        min: [-6.8, 1.4, -11.8],
        max: [6.8, 7.4, 14.2],
      },
      note: "Bounded interior inspection camera for runtime QA only.",
    },
    checks: [
      {
        checkKey: "runtime_package_resolves",
        status: "passed",
        summary: "Runtime package resolves through the internal route.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "served_chunk_count",
        status: "passed",
        summary: "Served visual chunks are recorded.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "spark_payload_loads",
        status: "passed",
        summary: "Spark loads the served runtime payloads.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "camera_framing",
        status: "passed",
        summary: "The start view frames the reviewed room package.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "user_orbit_bounds",
        status: "passed",
        summary: "User orbit stays inside reviewed camera bounds.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "approximate_view_transform_documented",
        status: "passed",
        summary: "Previous approximate transform limitations are documented.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "signed_transform_artifact",
        status: "passed",
        summary: "Signed room-local transform artifact is recorded.",
        evidenceRefs: [{ label: "Transform artifact", ref: SIGNED_TRANSFORM_ID }],
      },
      {
        checkKey: "metric_scale_alignment",
        status: "passed",
        summary: "Metric scale alignment review is recorded.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "floor_wall_alignment",
        status: "passed",
        summary: "Floor and wall alignment review is recorded.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "lcc2_lod_graph",
        status: "passed",
        summary: "Runtime LOD or chunk strategy review is recorded.",
        evidenceRefs: [evidenceRef],
      },
      {
        checkKey: "public_exposure_review",
        status: "passed",
        summary: "Public exposure review is recorded.",
        evidenceRefs: [evidenceRef],
      },
    ],
    limitations: [
      "Public exposure is limited to reviewed visual preview copy.",
    ],
    publicExposure: {
      decision: "approved_public",
      reason: "Human review and signed transform evidence are recorded.",
      requiredBeforeApproval: ["No remaining approval blockers."],
    },
  };

  return {
    id: "10000000-0000-4000-8000-000000000008",
    runtimePackageId: RUNTIME_PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    recordId: record.recordId,
    recordJson: record,
    signedTransformArtifactId: SIGNED_TRANSFORM_ID,
    publicExposureDecision: record.publicExposure.decision,
    assetEvidenceStatus: record.assetEvidenceStatus,
    runtimeStatus: record.runtimeStatus,
    reviewedBy: "10000000-0000-4000-8000-000000000009",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function transformArtifactRow(overrides: Partial<RuntimeTransformArtifactRow> = {}): RuntimeTransformArtifactRow {
  const transformArtifact: RuntimeTransformArtifactRow["transformArtifact"] = {
    id: SIGNED_TRANSFORM_ID,
    sourceFrame: "COLMAP_RDF",
    targetFrame: "CVF",
    units: "meters",
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    alignmentMethod: "landmark_solve",
    residualRmseM: 0.012,
    landmarks: [
      {
        id: "corner-01",
        label: "Control corner 01",
        source: [0, 0, 0],
        target: [0, 0, 0],
        residualM: 0.01,
        provenanceRefs: [
          {
            refType: "landmark_set",
            ref: "docs/operations/reception-room-landmarks-v0.json",
            role: "source_landmarks",
          },
        ],
      },
    ],
    provenance: {
      state: "measured",
      refs: [
        {
          refType: "landmark_set",
          ref: "docs/operations/reception-room-landmarks-v0.json",
          role: "source_landmarks",
        },
      ],
    },
    creator: {
      actorType: "human",
      id: "ops/runtime-operator",
      displayName: "Runtime operator",
      role: "runtime_operator",
    },
    reviewer: {
      actorType: "human",
      id: "ops/runtime-reviewer",
      displayName: "Runtime reviewer",
      role: "runtime_reviewer",
    },
    date: "2026-06-16T00:00:00.000Z",
  };

  return {
    id: "10000000-0000-4000-8000-000000000010",
    runtimePackageId: RUNTIME_PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    transformArtifactId: SIGNED_TRANSFORM_ID,
    transformArtifact,
    reviewNote: "Route contract test only; not live Reception Room evidence.",
    registeredBy: "10000000-0000-4000-8000-000000000009",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("runtimeQaRecordAllowsPublicRoomVisual", () => {
  it("blocks public visuals when there is no persisted QA record", () => {
    expect(runtimeQaRecordAllowsPublicRoomVisual(null, transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(undefined, transformArtifactRow())).toBe(false);
  });

  it("allows public visuals only from an approved QA record with its registered transform artifact", () => {
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow(), transformArtifactRow())).toBe(true);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow(), null)).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow(), transformArtifactRow({
      transformArtifactId: "wrong-transform-artifact",
    }))).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      recordJson: {
        ...qaRecordRow().recordJson,
        publicExposure: {
          decision: "approved_internal_preview",
          reason: "Internal preview review is recorded.",
          requiredBeforeApproval: ["Public review remains required."],
        },
      },
      publicExposureDecision: "approved_internal_preview",
    }), transformArtifactRow())).toBe(false);
  });

  it("blocks public visuals when persisted QA row readiness columns drift from the signed record", () => {
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      signedTransformArtifactId: null,
    }), transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      signedTransformArtifactId: "wrong-transform-artifact",
    }), transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      publicExposureDecision: "blocked_internal_only",
    }), transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      assetEvidenceStatus: "unverified",
    }), transformArtifactRow())).toBe(false);
    expect(runtimeQaRecordAllowsPublicRoomVisual(qaRecordRow({
      runtimeStatus: "internal_ready",
    }), transformArtifactRow())).toBe(false);
  });
});

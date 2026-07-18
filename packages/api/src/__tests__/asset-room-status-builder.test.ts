import { describe, expect, it } from "vitest";
import {
  buildRoomAssetStatuses,
  type AssetVersionRow,
  type CaptureControlSourceRecordRow,
  type RuntimeQaRecordRow,
  type RuntimePackageRow,
  type RuntimeTransformArtifactRow,
} from "../routes/assets.js";

const NOW = new Date("2026-06-16T00:00:00.000Z");
const ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000001";
const RUNTIME_PACKAGE_ID = "10000000-0000-4000-8000-000000000004";
const OLD_RUNTIME_PACKAGE_ID = "10000000-0000-4000-8000-000000000005";
const CURRENT_RECEPTION_ROOM_RUNTIME_PACKAGE_ID = "71687e9e-c23d-4f51-b3dd-a6a82c97978d";
const TRANSFORM_ARTIFACT_ID = "reception-room-landmark-solve-v0";

function splatAsset(roomSlug: string): AssetVersionRow {
  return {
    id: ASSET_VERSION_ID,
    venueSlug: "trades-hall",
    roomSlug,
    captureSessionId: null,
    assetKind: "splat",
    sourceType: "xgrids",
    fileName: "0_1_0.sog",
    fileExt: ".sog",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/0_1_0.sog",
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256: "08c928b2556e2ba38cdf1777c806bb6b7ece249d5e7c442d20c0232ca703005c",
    sizeBytes: 9_845_814,
    evidenceStatus: "machine_checked",
    runtimeStatus: "usable",
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function runtimePackage(id: string, roomSlug: string): RuntimePackageRow {
  return {
    id,
    venueSlug: "trades-hall",
    roomSlug,
    revision: 1,
    identityKind: "legacy",
    contentDigest: null,
    primaryVisualAssetVersionId: ASSET_VERSION_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug,
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: ASSET_VERSION_ID,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function transformArtifact(runtimePackageId: string): RuntimeTransformArtifactRow {
  return {
    id: "10000000-0000-4000-8000-000000000006",
    runtimePackageId,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    transformArtifactId: TRANSFORM_ARTIFACT_ID,
    transformArtifact: {
      id: TRANSFORM_ARTIFACT_ID,
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
        id: "ops/blake",
        role: "runtime_operator",
      },
      reviewer: {
        actorType: "human",
        id: "ops/runtime-reviewer",
        role: "runtime_reviewer",
      },
      date: "2026-06-15T10:00:00.000Z",
    },
    reviewNote: "Builder contract test only.",
    registeredBy: "10000000-0000-4000-8000-000000000007",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function runtimeQaRecord(
  runtimePackageId: string,
  signedTransformArtifactId: string | null = null,
): RuntimeQaRecordRow {
  const checkKeys: readonly RuntimeQaRecordRow["recordJson"]["checks"][number]["checkKey"][] = [
    "runtime_package_resolves",
    "served_chunk_count",
    "spark_payload_loads",
    "camera_framing",
    "user_orbit_bounds",
    "approximate_view_transform_documented",
    "signed_transform_artifact",
    "metric_scale_alignment",
    "floor_wall_alignment",
    "lcc2_lod_graph",
    "public_exposure_review",
  ];

  const recordJson: RuntimeQaRecordRow["recordJson"] = {
    schemaVersion: "runtime-qa-record.v0",
    recordId: "reception-room-runtime-qa-2026-06-16",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackageId,
    recordedAt: "2026-06-16T00:00:00.000Z",
    recordedBy: "runtime-qa-operator",
    assetEvidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
    sourceBundle: {
      sourceLabel: "Reception Room QA bundle",
      sourceBundleHash: "1".repeat(64),
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
      evidenceRefs: [{ label: "Runtime QA", ref: "docs/operations/reception-room-runtime-qa-record-2026-06-15.md" }],
    },
    viewTransform: signedTransformArtifactId === null
      ? {
        posture: "approximate_view_transform",
        position: [1.11, 2.57, 2.77],
        rotation: [-Math.PI / 2, 0, 0],
        scale: 0.63,
        signedTransformArtifactId: null,
        note: "Approximate view transform for internal QA only.",
      }
      : {
        posture: "signed_room_local_transform",
        position: [1.11, 2.57, 2.77],
        rotation: [-Math.PI / 2, 0, 0],
        scale: 0.63,
        signedTransformArtifactId,
        note: "Signed room-local transform for reviewed runtime alignment.",
      },
    cameraProfile: {
      position: [0.2, 6.2, 13.4],
      target: [0, 0.9, -4.15],
      arrivalPosition: [0.25, 7.15, 14.1],
      arrivalTarget: [0, 1.2, -4],
      arrivalDurationMs: 1400,
      fov: 48,
      targetBounds: null,
      cameraBounds: null,
      note: "Bounded interior inspection camera for runtime QA only.",
    },
    checks: checkKeys.map((checkKey) => ({
      checkKey,
      status: checkKey === "signed_transform_artifact" && signedTransformArtifactId !== null ? "passed" : "requires_human_review",
      summary: "Runtime QA check remains under human review.",
      evidenceRefs: checkKey === "signed_transform_artifact" && signedTransformArtifactId !== null
        ? [{ label: "Transform artifact", ref: signedTransformArtifactId }]
        : [],
    })),
    limitations: ["Runtime QA is internal planning evidence only."],
    publicExposure: {
      decision: "blocked_internal_only",
      reason: "Public exposure remains blocked.",
      requiredBeforeApproval: ["Public exposure review remains required."],
    },
  };

  return {
    id: "10000000-0000-4000-8000-000000000008",
    runtimePackageId,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    recordId: recordJson.recordId,
    recordJson,
    signedTransformArtifactId,
    publicExposureDecision: "blocked_internal_only",
    assetEvidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
    reviewedBy: "10000000-0000-4000-8000-000000000007",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function captureControlSource(
  runtimePackageId: string | null,
  transformArtifactId: string | null = null,
): CaptureControlSourceRecordRow {
  const sourceId = "reception-room-manual-landmarks-v0";
  return {
    id: "10000000-0000-4000-8000-000000000009",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackageId,
    transformArtifactId,
    sourceId,
    sourceClass: "manual_landmarks",
    poseAuthorityLevel: "manual_landmark_control",
    qaStatus: "requires_human_review",
    sourceRecord: {
      sourceId,
      sourceClass: "manual_landmarks",
      poseAuthorityLevel: "manual_landmark_control",
      alignmentMethods: ["landmark_solve"],
      qaStatus: "requires_human_review",
      sourceRefs: [
        {
          refType: "landmark_set",
          ref: "docs/operations/reception-room-landmarks-v0.json",
          role: "source_landmarks",
        },
      ],
      transformArtifactRefs: transformArtifactId === null
        ? []
        : [
          {
            refType: "transform_artifact",
            ref: transformArtifactId,
            role: "signed_transform",
          },
        ],
      residualMetricRefs: [],
      staleWhen: ["landmark_set_changed", "runtime_package_changed"],
      reviewerRole: "runtime_reviewer",
      notes: "Candidate Reception Room landmark evidence for builder tests.",
    },
    reviewNote: "Builder contract test only.",
    registeredBy: "10000000-0000-4000-8000-000000000007",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function visualAlignmentCaptureControlSource(runtimePackageId: string): CaptureControlSourceRecordRow {
  const sourceId = "reception-room-approximate-view-transform-v0";
  return {
    id: "10000000-0000-4000-8000-000000000010",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackageId,
    transformArtifactId: null,
    sourceId,
    sourceClass: "artist_blender_alignment_refs",
    poseAuthorityLevel: "visual_alignment_only",
    qaStatus: "requires_human_review",
    sourceRecord: {
      sourceId,
      sourceClass: "artist_blender_alignment_refs",
      poseAuthorityLevel: "visual_alignment_only",
      alignmentMethods: ["visual_alignment"],
      qaStatus: "requires_human_review",
      sourceRefs: [
        {
          refType: "runtime_package",
          ref: runtimePackageId,
          role: "runtime_package",
        },
        {
          refType: "operator_note",
          ref: "docs/operations/reception-room-runtime-intake-2026-06-13.md",
          role: "approximate_view_transform",
        },
      ],
      transformArtifactRefs: [],
      residualMetricRefs: [],
      staleWhen: ["runtime_package_changed", "scene_authority_map_changed"],
      reviewerRole: "runtime_reviewer",
      notes: "Visual-only approximate view transform evidence for builder tests.",
    },
    reviewNote: "Builder contract test only.",
    registeredBy: "10000000-0000-4000-8000-000000000007",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function rejectedCaptureControlSource(runtimePackageId: string): CaptureControlSourceRecordRow {
  const source = captureControlSource(runtimePackageId);
  return {
    ...source,
    qaStatus: "rejected",
    sourceRecord: {
      ...source.sourceRecord,
      qaStatus: "rejected",
      staleWhen: [...source.sourceRecord.staleWhen, "source_pose_rejected"],
    },
  };
}

describe("buildRoomAssetStatuses", () => {
  it("marks rooms without transform artifacts as missing", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [runtimePackage(RUNTIME_PACKAGE_ID, "reception-room")],
      [],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.reviewedTransformStatus).toBe("missing");
    expect(room?.reviewedTransformArtifactCount).toBe(0);
    expect(room?.latestTransformArtifactId).toBeNull();
    expect(room?.reviewedTransformSafeCopy).toBe("no reviewed runtime transform registered");
    expect(room?.reviewedQaStatus).toBe("missing");
    expect(room?.latestQaRecordId).toBeNull();
    expect(room?.qaSignedTransformArtifactId).toBeNull();
    expect(room?.qaSignedTransformLinked).toBe(false);
    expect(room?.reviewedQaSafeCopy).toBe("no runtime QA record registered");
    expect(room?.captureControlStatus).toBe("missing");
    expect(room?.captureControlSourceCount).toBe(0);
    expect(room?.latestCaptureControlSourceRecordId).toBeNull();
    expect(room?.latestCaptureControlSourceId).toBeNull();
    expect(room?.latestCaptureControlSourceClass).toBeNull();
    expect(room?.latestCaptureControlPoseAuthorityLevel).toBeNull();
    expect(room?.latestCaptureControlAlignmentMethods).toEqual([]);
    expect(room?.latestCaptureControlStalenessTriggers).toEqual([]);
    expect(room?.latestCaptureControlActiveStalenessTriggers).toEqual([]);
    expect(room?.captureControlFreshnessStatus).toBe("missing");
    expect(room?.latestCaptureControlQaStatus).toBeNull();
    expect(room?.captureControlLinkedTransformArtifactId).toBeNull();
    expect(room?.captureControlTransformLinked).toBe(false);
    expect(room?.captureControlAuthoritySafeCopy).toBe("no capture-control authority recorded");
    expect(room?.captureControlStalenessSafeCopy).toBe("no capture-control staleness policy recorded");
    expect(room?.captureControlSafeCopy).toBe("no capture-control source registered");
    expect(room?.runtimeControlEvidenceChainStatus).toBe("not_recorded");
    expect(room?.runtimeControlEvidenceChainRef).toBeNull();
    expect(room?.runtimeControlEvidenceChainSafeCopy).toBe(
      "runtime-control evidence chain is not recorded for the latest runtime package",
    );
  });

  it("surfaces the checked-in Reception Room runtime-control chain for the current package only", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [runtimePackage(CURRENT_RECEPTION_ROOM_RUNTIME_PACKAGE_ID, "reception-room")],
      [],
      [],
      [visualAlignmentCaptureControlSource(CURRENT_RECEPTION_ROOM_RUNTIME_PACKAGE_ID)],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.runtimeControlEvidenceChainStatus).toBe("blocked_missing_coordinate_pair_intake");
    expect(room?.runtimeControlEvidenceChainRef).toBe(
      "docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json",
    );
    expect(room?.runtimeControlRequiredCoordinatePairCount).toBe(4);
    expect(room?.runtimeControlReviewedCoordinatePairCount).toBe(0);
    expect(room?.runtimeControlEvidenceChainSafeCopy).toBe(
      "runtime-control chain blocked because reviewed coordinate-pair intake is missing",
    );
    expect(room?.runtimeControlEvidenceChainNextAction).toBe(
      "Collect the four reviewed ARF to CVF landmark measurements",
    );
  });

  it("marks a room as registered when the latest runtime package has a transform artifact", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [runtimePackage(RUNTIME_PACKAGE_ID, "reception-room")],
      [transformArtifact(RUNTIME_PACKAGE_ID)],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.reviewedTransformStatus).toBe("registered");
    expect(room?.reviewedTransformArtifactCount).toBe(1);
    expect(room?.latestTransformArtifactId).toBe(TRANSFORM_ARTIFACT_ID);
    expect(room?.reviewedTransformSafeCopy).toBe("reviewed runtime transform artifact registered");
  });

  it("surfaces the latest runtime QA record for the current runtime package", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [runtimePackage(RUNTIME_PACKAGE_ID, "reception-room")],
      [transformArtifact(RUNTIME_PACKAGE_ID)],
      [runtimeQaRecord(RUNTIME_PACKAGE_ID, TRANSFORM_ARTIFACT_ID)],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.reviewedQaStatus).toBe("blocked_internal_only");
    expect(room?.latestQaRecordId).toBe("reception-room-runtime-qa-2026-06-16");
    expect(room?.qaSignedTransformArtifactId).toBe(TRANSFORM_ARTIFACT_ID);
    expect(room?.qaSignedTransformLinked).toBe(true);
    expect(room?.reviewedQaSafeCopy).toBe("runtime QA recorded; public exposure blocked");
  });

  it("surfaces capture-control sources linked to the current runtime transform", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [runtimePackage(RUNTIME_PACKAGE_ID, "reception-room")],
      [transformArtifact(RUNTIME_PACKAGE_ID)],
      [],
      [captureControlSource(RUNTIME_PACKAGE_ID, TRANSFORM_ARTIFACT_ID)],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.captureControlStatus).toBe("linked_to_transform");
    expect(room?.captureControlSourceCount).toBe(1);
    expect(room?.latestCaptureControlSourceRecordId).toBe("10000000-0000-4000-8000-000000000009");
    expect(room?.latestCaptureControlSourceId).toBe("reception-room-manual-landmarks-v0");
    expect(room?.latestCaptureControlSourceClass).toBe("manual_landmarks");
    expect(room?.latestCaptureControlPoseAuthorityLevel).toBe("manual_landmark_control");
    expect(room?.latestCaptureControlAlignmentMethods).toEqual(["landmark_solve"]);
    expect(room?.latestCaptureControlStalenessTriggers).toEqual(["landmark_set_changed", "runtime_package_changed"]);
    expect(room?.latestCaptureControlActiveStalenessTriggers).toEqual([]);
    expect(room?.captureControlFreshnessStatus).toBe("current_for_runtime_package");
    expect(room?.latestCaptureControlQaStatus).toBe("requires_human_review");
    expect(room?.captureControlLinkedTransformArtifactId).toBe(TRANSFORM_ARTIFACT_ID);
    expect(room?.captureControlTransformLinked).toBe(true);
    expect(room?.captureControlAuthoritySafeCopy).toBe(
      "manual landmark control source recorded; reviewer confirmation required",
    );
    expect(room?.captureControlStalenessSafeCopy).toBe(
      "capture-control source has 2 staleness triggers recorded",
    );
    expect(room?.captureControlSafeCopy).toBe("capture-control source linked to latest transform artifact");
  });

  it("surfaces visual-only capture-control authority without implying measurement control", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [runtimePackage(RUNTIME_PACKAGE_ID, "reception-room")],
      [],
      [],
      [visualAlignmentCaptureControlSource(RUNTIME_PACKAGE_ID)],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.captureControlStatus).toBe("source_registered");
    expect(room?.latestCaptureControlSourceRecordId).toBe("10000000-0000-4000-8000-000000000010");
    expect(room?.latestCaptureControlSourceId).toBe("reception-room-approximate-view-transform-v0");
    expect(room?.latestCaptureControlSourceClass).toBe("artist_blender_alignment_refs");
    expect(room?.latestCaptureControlPoseAuthorityLevel).toBe("visual_alignment_only");
    expect(room?.latestCaptureControlAlignmentMethods).toEqual(["visual_alignment"]);
    expect(room?.latestCaptureControlStalenessTriggers).toEqual([
      "runtime_package_changed",
      "scene_authority_map_changed",
    ]);
    expect(room?.latestCaptureControlActiveStalenessTriggers).toEqual([]);
    expect(room?.captureControlFreshnessStatus).toBe("current_for_runtime_package");
    expect(room?.captureControlTransformLinked).toBe(false);
    expect(room?.captureControlAuthoritySafeCopy).toBe(
      "visual-only alignment source recorded; not measurement control",
    );
    expect(room?.captureControlStalenessSafeCopy).toBe(
      "capture-control source has 2 staleness triggers recorded",
    );
    expect(room?.captureControlSafeCopy).toBe("capture-control source registered; signed transform still required");
  });

  it("surfaces pre-transform capture-control sources without claiming a transform link", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [runtimePackage(RUNTIME_PACKAGE_ID, "reception-room")],
      [],
      [],
      [captureControlSource(null)],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.captureControlStatus).toBe("source_registered");
    expect(room?.captureControlSourceCount).toBe(1);
    expect(room?.latestCaptureControlSourceRecordId).toBe("10000000-0000-4000-8000-000000000009");
    expect(room?.latestCaptureControlSourceClass).toBe("manual_landmarks");
    expect(room?.latestCaptureControlPoseAuthorityLevel).toBe("manual_landmark_control");
    expect(room?.latestCaptureControlStalenessTriggers).toEqual(["landmark_set_changed", "runtime_package_changed"]);
    expect(room?.latestCaptureControlActiveStalenessTriggers).toEqual([]);
    expect(room?.captureControlFreshnessStatus).toBe("not_checked");
    expect(room?.captureControlLinkedTransformArtifactId).toBeNull();
    expect(room?.captureControlTransformLinked).toBe(false);
    expect(room?.captureControlSafeCopy).toBe("capture-control source registered; signed transform still required");
  });

  it("marks rejected capture-control source poses as actively stale", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [runtimePackage(RUNTIME_PACKAGE_ID, "reception-room")],
      [],
      [],
      [rejectedCaptureControlSource(RUNTIME_PACKAGE_ID)],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.captureControlStatus).toBe("source_registered");
    expect(room?.latestCaptureControlQaStatus).toBe("rejected");
    expect(room?.latestCaptureControlActiveStalenessTriggers).toEqual(["source_pose_rejected"]);
    expect(room?.captureControlFreshnessStatus).toBe("stale_for_runtime_package");
    expect(room?.captureControlSafeCopy).toBe("capture-control source registered; stale evidence review required");
  });

  it("does not count transform artifacts attached to an older package as current", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [
        runtimePackage(RUNTIME_PACKAGE_ID, "reception-room"),
        runtimePackage(OLD_RUNTIME_PACKAGE_ID, "reception-room"),
      ],
      [transformArtifact(OLD_RUNTIME_PACKAGE_ID)],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.reviewedTransformStatus).toBe("missing");
    expect(room?.reviewedTransformArtifactCount).toBe(0);
    expect(room?.latestTransformArtifactId).toBeNull();
  });

  it("does not surface QA records attached to an older runtime package as current", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [
        runtimePackage(RUNTIME_PACKAGE_ID, "reception-room"),
        runtimePackage(OLD_RUNTIME_PACKAGE_ID, "reception-room"),
      ],
      [transformArtifact(RUNTIME_PACKAGE_ID)],
      [runtimeQaRecord(OLD_RUNTIME_PACKAGE_ID, TRANSFORM_ARTIFACT_ID)],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.reviewedQaStatus).toBe("missing");
    expect(room?.latestQaRecordId).toBeNull();
    expect(room?.qaSignedTransformArtifactId).toBeNull();
    expect(room?.qaSignedTransformLinked).toBe(false);
  });

  it("surfaces capture-control sources attached to an older runtime package as stale", () => {
    const statuses = buildRoomAssetStatuses(
      "trades-hall",
      [],
      [splatAsset("reception-room")],
      [
        runtimePackage(RUNTIME_PACKAGE_ID, "reception-room"),
        runtimePackage(OLD_RUNTIME_PACKAGE_ID, "reception-room"),
      ],
      [transformArtifact(RUNTIME_PACKAGE_ID)],
      [],
      [captureControlSource(OLD_RUNTIME_PACKAGE_ID, TRANSFORM_ARTIFACT_ID)],
    );

    const room = statuses.find((status) => status.roomSlug === "reception-room");
    expect(room?.captureControlStatus).toBe("source_registered");
    expect(room?.captureControlSourceCount).toBe(1);
    expect(room?.latestCaptureControlSourceRecordId).toBe("10000000-0000-4000-8000-000000000009");
    expect(room?.latestCaptureControlSourceId).toBe("reception-room-manual-landmarks-v0");
    expect(room?.latestCaptureControlSourceClass).toBe("manual_landmarks");
    expect(room?.latestCaptureControlPoseAuthorityLevel).toBe("manual_landmark_control");
    expect(room?.latestCaptureControlStalenessTriggers).toEqual(["landmark_set_changed", "runtime_package_changed"]);
    expect(room?.latestCaptureControlActiveStalenessTriggers).toEqual(["runtime_package_changed"]);
    expect(room?.captureControlFreshnessStatus).toBe("stale_for_runtime_package");
    expect(room?.captureControlTransformLinked).toBe(false);
    expect(room?.captureControlSafeCopy).toBe("capture-control source registered; stale evidence review required");
  });
});

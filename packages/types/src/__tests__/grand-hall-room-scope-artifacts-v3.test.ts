import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_CLOSED_BOUNDARY_V1,
  GRAND_HALL_EXACT_INTERFACE_COUNT,
  GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
  GRAND_HALL_MATTERPAK_ROOM_KEY,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_PORTAL_DECISIONS_V1,
  GRAND_HALL_SCOPE_REVIEW_PACK_V1,
  GrandHallClosedBoundaryV1MaterialSchema,
  GrandHallClosedBoundaryV1Schema,
  GrandHallInterfaceCandidateSchema,
  GrandHallPortalDecisionsV1MaterialSchema,
  GrandHallPortalDecisionsV1Schema,
  computeGrandHallClosedBoundaryV1Sha256,
  computeGrandHallInterfaceInventorySha256,
  computeGrandHallPortalDecisionsV1Sha256,
} from "../grand-hall-room-scope-artifacts.js";
import {
  GRAND_HALL_AGENT_OBSERVED_POSITIVE_SWEEP_NUMBERS,
  GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
  GRAND_HALL_NO_OBSERVED_PIXEL_PANORAMA_COUNT,
  GRAND_HALL_OBSERVED_POSITIVE_PANORAMA_COUNT,
  GRAND_HALL_SCOPE_REVIEW_PACK_V2,
  GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS,
  GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
  GRAND_HALL_T561_OBSERVATION_INPUT_V1,
  GRAND_HALL_T561_OBSERVATION_MANIFEST_V1,
  GRAND_HALL_T561_OBSERVATION_RECEIPT_V1,
  GrandHallPanoramaObservationInventoryV2Schema,
  GrandHallPanoramaSourceInventoryV3Schema,
  GrandHallScopeReviewPackMaterialV2Schema,
  GrandHallScopeReviewPackV2Schema,
  GrandHallT554ClosedVolumeReviewV1Schema,
  computeGrandHallPanoramaObservationInventoryV2Sha256,
  computeGrandHallPanoramaSourceInventoryV3Sha256,
  computeGrandHallScopeReviewPackV2Sha256,
  computeGrandHallT554ClosedVolumeReviewV1Sha256,
  type GrandHallPanoramaObservationBindingV2,
  type GrandHallPanoramaSourceInventoryV3,
  type GrandHallT554ClosedVolumeReviewV1,
} from "../grand-hall-room-scope-artifacts-v2.js";
import {
  GRAND_HALL_PANORAMA_MASK_SET_V3,
  GRAND_HALL_CLOSED_BOUNDARY_V2,
  GRAND_HALL_PORTAL_DECISIONS_V2,
  GRAND_HALL_REVIEWED_CLOSURE_PLANE_BINDING_V1,
  GRAND_HALL_ROOM_MEMBERSHIP_V4,
  GRAND_HALL_SCOPE_REVIEW_PACK_V3,
  GRAND_HALL_T554_HUMAN_DECISIONS_V3,
  GrandHallAcceptedScopeChainV3Schema,
  GrandHallCleanupArtifactInspectionV3Schema,
  GrandHallClosedBoundaryV2MaterialSchema,
  GrandHallClosedBoundaryV2Schema,
  GrandHallNativeReviewEvidenceSetV1Schema,
  GrandHallPanoramaMaskSetV3MaterialSchema,
  GrandHallPanoramaMaskSetV3Schema,
  GrandHallPortalDecisionsV2MaterialSchema,
  GrandHallPortalDecisionsV2Schema,
  GrandHallRoomMembershipV4MaterialSchema,
  GrandHallRoomMembershipV4Schema,
  GrandHallScopeReviewPackMaterialV3Schema,
  GrandHallScopeReviewPackV3Schema,
  GrandHallT554HumanDecisionsV3Schema,
  computeGrandHallNativeReviewEvidenceSetV1Sha256,
  computeGrandHallClosedBoundaryV2Sha256,
  computeGrandHallPanoramaMaskSetV3Sha256,
  computeGrandHallPortalDecisionsV2Sha256,
  computeGrandHallRoomMembershipV4Sha256,
  computeGrandHallScopeReviewPackV3Sha256,
  computeGrandHallT554HumanDecisionsV3Sha256,
  verifyGrandHallAcceptedScopeChainV3,
  type GrandHallAcceptedScopeChainV3,
  type GrandHallClosedBoundaryV2,
  type GrandHallPanoramaMaskSetV3,
  type GrandHallPortalDecisionsV2,
  type GrandHallRoomMembershipV4,
  type GrandHallScopeReviewPackV3,
  type GrandHallT554HumanDecisionsV3,
} from "../grand-hall-room-scope-artifacts-v3.js";

const PANORAMA_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const POSITIVE_SWEEPS = new Set<number>(
  GRAND_HALL_AGENT_OBSERVED_POSITIVE_SWEEP_NUMBERS,
);

function digest(seed: number): `sha256:${string}` {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

function panoramaSources(): GrandHallPanoramaSourceInventoryV3 {
  return GrandHallPanoramaSourceInventoryV3Schema.parse(
    GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS.map((sweepNumber, inventoryIndex) => ({
      inventoryIndex,
      sweepNumber,
      fileName: sweepNumber === 99
        ? "sweep_099pg.jpg"
        : sweepNumber === 145
        ? "sweep_145pg.jpg"
        : sweepNumber >= 148
        ? `sweep_0${String(sweepNumber)}jpg.jpg`
        : `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`,
      sha256: digest(1_000 + inventoryIndex),
      byteLength: 5_000_000 + inventoryIndex,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    })),
  );
}

function observationBindings(
  sources: GrandHallPanoramaSourceInventoryV3,
): readonly GrandHallPanoramaObservationBindingV2[] {
  return GrandHallPanoramaObservationInventoryV2Schema.parse(
    sources.map((source) => ({
      source,
      observation: POSITIVE_SWEEPS.has(source.sweepNumber)
        ? {
          state: "grand_hall_pixels_observed_human_pending",
          proposedDisposition: "include_with_binary_pixel_mask",
          maskAuthoringState: "required_not_authored",
        }
        : {
          state: "no_grand_hall_pixels_observed_human_pending",
          proposedDisposition: "exclude_whole_frame",
          maskAuthoringState: "not_required_if_human_confirms_exclusion",
        },
    })),
  );
}

function interfaceCandidates() {
  const specifications = [
    [0, 2, 10],
    [0, 3, 2],
    [0, 4, 15],
    [1, 10, 6],
    [1, 11, 6],
    [1, 12, 3],
    [1, 13, 72],
    [1, 14, 62],
  ] as const;
  return specifications.map(([group, submesh, sharedSourceVertexCount], index) =>
    GrandHallInterfaceCandidateSchema.parse({
      interfaceId: `matterpak-1-9-${String(group)}-${String(submesh)}`,
      grandHallRoomKey: GRAND_HALL_MATTERPAK_ROOM_KEY,
      adjacentSourceRoomKey:
        `matterpak:g${String(group).padStart(3, "0")}:s${String(submesh).padStart(3, "0")}`,
      sharedSourceVertexCount,
      sharedSourceVertexSetSha256: digest(2_000 + index),
      boundsMeters: {
        min: [index * 2, 0, 0] as [number, number, number],
        max: [index * 2 + 1, 2, 3] as [number, number, number],
      },
    })
  );
}

function reviewPack(): GrandHallScopeReviewPackV3 {
  const sources = panoramaSources();
  const bindings = observationBindings(sources);
  const interfaces = interfaceCandidates();
  const material = GrandHallScopeReviewPackMaterialV3Schema.parse({
    schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V3,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    createdAt: "2026-08-26T12:00:00.000Z",
    createdBy: "synthetic-t554-v3-contract-test",
    authority: "none",
    reviewState: "human_pending",
    runtimeAuthorized: false,
    trainingAuthorized: false,
    generatedContentAuthorized: false,
    productionTrust: null,
    sourceEvidence: {
      predecessorReviewPack: {
        schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V1,
        artifactSha256: digest(3_001),
        relationship: "immutable_predecessor_lineage_only",
      },
      t550PendingMembershipV1Sha256: digest(3_002),
      t551SourceEvidenceSha256: digest(3_003),
      t551SourceReceiptSha256: digest(3_004),
      xgridsSourceReceiptSha256: digest(3_005),
      matterPakE57SourceReceiptSha256: digest(3_006),
      panoramaDirectoryInventorySha256: digest(3_007),
      boundaryReviewManifestSha256: digest(3_008),
      interfaceTopologyAtlasManifestSha256: digest(3_009),
      panoramaReviewManifestSha256: digest(3_010),
      cleanupMarkerEvidenceSha256: digest(3_014),
      cleanupTargetInventorySha256: digest(3_015),
      t561AuthorityNoneObservation: {
        inputSchemaVersion: GRAND_HALL_T561_OBSERVATION_INPUT_V1,
        manifestSchemaVersion: GRAND_HALL_T561_OBSERVATION_MANIFEST_V1,
        receiptSchemaVersion: GRAND_HALL_T561_OBSERVATION_RECEIPT_V1,
        manifestSha256: digest(3_011),
        receiptSha256: digest(3_012),
        observationSetSha256: digest(3_013),
        sourceRecordCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
        absentSweepNumbersWithin1To149: [93],
        grandHallPixelsObservedCount: GRAND_HALL_OBSERVED_POSITIVE_PANORAMA_COUNT,
        noGrandHallPixelsObservedCount: GRAND_HALL_NO_OBSERVED_PIXEL_PANORAMA_COUNT,
        uncertainPossibleGrandHallPixelsCount: 0,
        authority: "none",
        reviewState: "agent_observation_complete_human_pending",
        inspection: {
          method: "agent_visual_review_of_exact_source_file",
          displayedWidthPx: 2_048,
          displayedHeightPx: 1_024,
          displayMayHaveBeenResampled: true,
          nativeResolutionHumanReviewCompleted: false,
          humanAcceptanceRecorded: false,
        },
      },
      legacy50By98PartitionUsed: false,
    },
    panoramaRecords: bindings.map((binding) => ({
      ...binding,
      observationBasis: "agent_visual_inspection_of_digest_bound_source_panorama",
      humanReviewState: "pending",
      authority: "none",
      trainingAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      publicEvidenceAuthorized: false,
    })),
    panoramaSourceInventorySha256: computeGrandHallPanoramaSourceInventoryV3Sha256(sources),
    panoramaObservationInventorySha256:
      computeGrandHallPanoramaObservationInventoryV2Sha256(bindings),
    observationSummary: {
      sourceRecordCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
      grandHallPixelsObservedHumanPendingCount:
        GRAND_HALL_OBSERVED_POSITIVE_PANORAMA_COUNT,
      noGrandHallPixelsObservedHumanPendingCount:
        GRAND_HALL_NO_OBSERVED_PIXEL_PANORAMA_COUNT,
      humanPendingCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    },
    interfaceCandidates: interfaces,
    interfaceInventorySha256: computeGrandHallInterfaceInventorySha256(interfaces),
    requiredHumanDecisions: [
      "accept_or_reject_room_membership",
      "resolve_every_interface",
      "accept_or_reject_closed_selection_volume",
      "resolve_all_148_panorama_sources",
      "accept_or_reject_every_included_panorama_mask",
    ],
  });
  return GrandHallScopeReviewPackV3Schema.parse({
    ...material,
    artifactSha256: computeGrandHallScopeReviewPackV3Sha256(material),
  });
}

const reviewer = {
  reviewerId: "synthetic-authorized-reviewer",
  reviewerRole: "venue_owner_or_authorized_domain_reviewer" as const,
  reviewedAt: "2026-08-26T13:00:00.000Z",
  knowledgeBasis: ["synthetic exact 148-source native review fixture"],
  agentDecisionAuthority: "none" as const,
};

const CLOSED_VOLUME_FOOTPRINT = [
  [0, 0],
  [4, 0],
  [4, 4],
  [2, 4],
  [2, 2],
  [0, 2],
] as const;

const MIRROR_GROUP_TARGET_IDS = [
  "matterpak-obj-group:mirror130_group000_sub002",
  "matterpak-obj-group:mirror131_group000_sub002",
  "matterpak-obj-group:mirror136_group000_sub002",
  "matterpak-obj-group:mirror142_group000_sub002",
  "matterpak-obj-group:mirror143_group000_sub002",
] as const;

const MIRROR_REVIEWED_FACE_RANGE_TARGET_IDS = [
  "matterpak-obj-face-range:350795-351410",
  "matterpak-obj-face-range:351411-351416",
  "matterpak-obj-face-range:370534-372656",
  "matterpak-obj-face-range:414174-414339",
  "matterpak-obj-face-range:414340-414355",
] as const;

function closedVolumeReview(
  pack: GrandHallScopeReviewPackV3,
): GrandHallT554ClosedVolumeReviewV1 {
  return GrandHallT554ClosedVolumeReviewV1Schema.parse({
    schemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewPackSha256: pack.artifactSha256,
    authority: "none",
    reviewState: "human_accepted",
    finalDecision: "ACCEPT",
    reviewer,
    sourceFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
    units: "meters",
    geometryRole: "non_rendered_selection_volume",
    construction: "extruded_simple_xy_polygon",
    footprintXY: CLOSED_VOLUME_FOOTPRINT,
    zMin: 0,
    zMax: 6,
    rendered: false,
    collisionGeometry: false,
    exportedAsArchitecture: false,
    generatedGeometryCreated: false,
    note: "Human accepted the exact non-rendered Grand Hall selection volume.",
  });
}

function maskName(inventoryIndex: number): string {
  return `masks/panorama-${String(inventoryIndex).padStart(3, "0")}.png`;
}

function acceptedPanoramaDecision(
  record: GrandHallScopeReviewPackV3["panoramaRecords"][number],
) {
  const humanOverrideToInclude = record.source.sweepNumber === 62;
  const humanOverrideToExclude = record.source.sweepNumber === 1;
  const include = humanOverrideToInclude ||
    (!humanOverrideToExclude &&
      record.observation.proposedDisposition === "include_with_binary_pixel_mask");
  const nativeReviewEvidenceSha256 = digest(10_000 + record.source.inventoryIndex);
  if (!include) {
    return {
      source: record.source,
      sourceObservation: record.observation,
      result: "EXCLUDE" as const,
      classification: "no_observed_grand_hall_pixels" as const,
      maskFileName: null,
      reviewedMaskBinding: null,
      maskReviewed: false,
      nativeResolutionHumanReviewCompleted: true,
      nativeReviewEvidenceSha256,
      maskReasonCodes: [],
      note: humanOverrideToExclude
        ? "Human native review overrode the positive authority-none hint."
        : "Human native review confirmed no Grand Hall pixels.",
    };
  }
  const fullyIncluded = record.source.sweepNumber === 2;
  return {
    source: record.source,
    sourceObservation: record.observation,
    result: "INCLUDE" as const,
    classification: humanOverrideToInclude || record.source.sweepNumber >= 148
      ? "grand_hall_portal_threshold" as const
      : "grand_hall_core" as const,
    maskFileName: maskName(record.source.inventoryIndex),
    reviewedMaskBinding: {
      sha256: digest(20_000 + record.source.inventoryIndex),
      byteLength: 1_000 + record.source.inventoryIndex,
      includedPixelCount: fullyIncluded ? PANORAMA_PIXEL_COUNT : PANORAMA_PIXEL_COUNT - 1,
      excludedPixelCount: fullyIncluded ? 0 : 1,
    },
    maskReviewed: true,
    nativeResolutionHumanReviewCompleted: true,
    nativeReviewEvidenceSha256,
    maskReasonCodes: fullyIncluded ? [] : ["unverified_or_unknown_pixels" as const],
    note: humanOverrideToInclude
      ? "Human native review overrode the negative authority-none hint and reviewed its mask."
      : "Human reviewed the exact native source and source-grid binary mask.",
  };
}

function humanDecisions(
  pack: GrandHallScopeReviewPackV3,
  volumeReview: GrandHallT554ClosedVolumeReviewV1 = closedVolumeReview(pack),
): GrandHallT554HumanDecisionsV3 {
  const panoramaDecisions = pack.panoramaRecords.map(acceptedPanoramaDecision);
  const nativeBindings = panoramaDecisions.map((decision) => ({
    source: decision.source,
    nativeReviewEvidenceSha256: decision.nativeReviewEvidenceSha256,
  }));
  const volumeDigest = computeGrandHallT554ClosedVolumeReviewV1Sha256(volumeReview);
  const interfaceDecisions = pack.interfaceCandidates.map((source, index) => {
    if (index === 0) {
      return {
        source,
        result: "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE" as const,
        reviewedClosurePlaneBinding: {
          schemaVersion: GRAND_HALL_REVIEWED_CLOSURE_PLANE_BINDING_V1,
          sourceFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
          units: "meters" as const,
          construction: "vertical_extrusion_of_directed_ccw_footprint_edge" as const,
          closedVolumeReviewSha256: volumeDigest,
          footprintEdgeIndex: 3,
          localGrandHallSide: "left_of_directed_ccw_edge" as const,
          canonicalPlaneOrientation:
            "outward_normal_grand_hall_local_side_non_positive" as const,
          interfaceTopologyAtlasManifestSha256:
            pack.sourceEvidence.interfaceTopologyAtlasManifestSha256,
          sharedSourceVertexSetSha256: source.sharedSourceVertexSetSha256,
        },
        note: "Human closed this interface on concave footprint edge 3.",
      };
    }
    if (index === 1) {
      return {
        source,
        result: "NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT" as const,
        reviewedClosurePlaneBinding: null,
        note: "Human identified a source-topology artifact rather than a portal.",
      };
    }
    return {
      source,
      result: "EXCLUDE_BEYOND_INTERFACE" as const,
      reviewedClosurePlaneBinding: null,
      note: "Human excluded all observations beyond this exact interface.",
    };
  });
  return GrandHallT554HumanDecisionsV3Schema.parse({
    schemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V3,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V3,
    reviewPackSha256: pack.artifactSha256,
    sourcePanoramaInventorySha256: pack.panoramaSourceInventorySha256,
    sourceObservationInventorySha256: pack.panoramaObservationInventorySha256,
    authority: "none",
    reviewState: "human_accepted",
    finalDecision: "ACCEPT",
    reviewer,
    nativeResolutionHumanReviewCompleted: true,
    nativeReviewEvidenceSetSha256:
      computeGrandHallNativeReviewEvidenceSetV1Sha256(nativeBindings),
    generatedFillPermitted: false,
    geometricCameraAuthority: "none",
    matterPakRoomDecision: {
      sourceRoomKey: GRAND_HALL_MATTERPAK_ROOM_KEY,
      sourceMembershipV1Sha256: pack.sourceEvidence.t550PendingMembershipV1Sha256,
      sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
      result: "ACCEPT_AS_GRAND_HALL",
      note: "Human accepted exact MatterPak room 9.",
    },
    cleanupArtifactInspections: [
      {
        artifactClass: "Window",
        sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
        cleanupMarkerEvidenceSha256: pack.sourceEvidence.cleanupMarkerEvidenceSha256,
        cleanupTargetInventorySha256: pack.sourceEvidence.cleanupTargetInventorySha256,
        localizationState: "source_faces_localized_by_reviewed_correspondence",
        reviewedTargetIds: ["matterpak-obj-face-range:120-189"],
        nativeSourceReviewCompleted: true,
        result: "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY",
        note: "Human accepted exact reviewed Window face correspondence without architectural authority.",
      },
      {
        artifactClass: "Mirror",
        sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
        cleanupMarkerEvidenceSha256: pack.sourceEvidence.cleanupMarkerEvidenceSha256,
        cleanupTargetInventorySha256: pack.sourceEvidence.cleanupTargetInventorySha256,
        localizationState: "source_faces_localized_by_reviewed_correspondence",
        reviewedTargetIds: MIRROR_REVIEWED_FACE_RANGE_TARGET_IDS,
        nativeSourceReviewCompleted: true,
        result: "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY",
        note: "Human accepted reviewed face correspondence for all five bound Mirror targets without architectural authority.",
      },
    ],
    closedSelectionVolumeDecision: {
      reviewSchemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
      reviewArtifactSha256: volumeDigest,
      result: "ACCEPT_NON_RENDERED_SELECTION_VOLUME",
      note: "Human accepted the digest-bound closed selection volume.",
    },
    panoramaDecisionCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    panoramaDecisions,
    interfaceDecisions,
    sourceInterfaceInventorySha256: pack.interfaceInventorySha256,
  });
}

function pendingHumanDecisions(
  pack: GrandHallScopeReviewPackV3,
): GrandHallT554HumanDecisionsV3 {
  return GrandHallT554HumanDecisionsV3Schema.parse({
    schemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V3,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V3,
    reviewPackSha256: pack.artifactSha256,
    sourcePanoramaInventorySha256: pack.panoramaSourceInventorySha256,
    sourceObservationInventorySha256: pack.panoramaObservationInventorySha256,
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    reviewer: null,
    nativeResolutionHumanReviewCompleted: false,
    nativeReviewEvidenceSetSha256: null,
    generatedFillPermitted: false,
    geometricCameraAuthority: "none",
    matterPakRoomDecision: {
      sourceRoomKey: GRAND_HALL_MATTERPAK_ROOM_KEY,
      sourceMembershipV1Sha256: pack.sourceEvidence.t550PendingMembershipV1Sha256,
      sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
      result: "UNSURE",
      note: null,
    },
    cleanupArtifactInspections: (["Window", "Mirror"] as const).map((artifactClass) => ({
      artifactClass,
      sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
      cleanupMarkerEvidenceSha256: pack.sourceEvidence.cleanupMarkerEvidenceSha256,
      cleanupTargetInventorySha256: pack.sourceEvidence.cleanupTargetInventorySha256,
      localizationState: null,
      reviewedTargetIds: [],
      nativeSourceReviewCompleted: false,
      result: "UNSURE",
      note: null,
    })),
    closedSelectionVolumeDecision: {
      reviewSchemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
      reviewArtifactSha256: null,
      result: "UNSURE",
      note: null,
    },
    panoramaDecisionCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    panoramaDecisions: pack.panoramaRecords.map((record) => ({
      source: record.source,
      sourceObservation: record.observation,
      result: "UNSURE",
      classification: null,
      maskFileName: null,
      reviewedMaskBinding: null,
      maskReviewed: false,
      nativeResolutionHumanReviewCompleted: false,
      nativeReviewEvidenceSha256: null,
      maskReasonCodes: [],
      note: null,
    })),
    interfaceDecisions: pack.interfaceCandidates.map((source) => ({
      source,
      result: "UNSURE",
      reviewedClosurePlaneBinding: null,
      note: null,
    })),
    sourceInterfaceInventorySha256: pack.interfaceInventorySha256,
  });
}

function roomMembership(
  pack: GrandHallScopeReviewPackV3,
  decisions: GrandHallT554HumanDecisionsV3,
): GrandHallRoomMembershipV4 {
  const humanDecisionsSha256 = computeGrandHallT554HumanDecisionsV3Sha256(decisions);
  const includedFrameCount = decisions.panoramaDecisions.filter(
    (decision) => decision.result === "INCLUDE",
  ).length;
  const nativeReviewEvidenceSetSha256 = decisions.nativeReviewEvidenceSetSha256;
  if (nativeReviewEvidenceSetSha256 === null) {
    throw new Error("accepted fixture lacks native evidence set");
  }
  const material = GrandHallRoomMembershipV4MaterialSchema.parse({
    schemaVersion: GRAND_HALL_ROOM_MEMBERSHIP_V4,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V3,
    reviewPackSha256: pack.artifactSha256,
    humanDecisionsSchemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V3,
    humanDecisionsSha256,
    nativeReviewEvidenceSetSha256,
    sourceMembershipV1Sha256: pack.sourceEvidence.t550PendingMembershipV1Sha256,
    sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
    sourcePanoramaInventorySha256: pack.panoramaSourceInventorySha256,
    sourceObservationInventorySha256: pack.panoramaObservationInventorySha256,
    geometricCameraAuthority: "none",
    matterPakRoomMembership: {
      includedRoomKeys: [GRAND_HALL_MATTERPAK_ROOM_KEY],
      neighbouringRoomGeometryIncluded: false,
      facadeGeometryIncluded: false,
    },
    panoramaRecordCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    includedFrameCount,
    wholeFrameExclusionCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT - includedFrameCount,
    panoramaRecords: decisions.panoramaDecisions.map((decision) => {
      if (decision.nativeReviewEvidenceSha256 === null) {
        throw new Error("accepted row lacks native evidence");
      }
      return {
        source: decision.source,
        decision: decision.result === "INCLUDE"
          ? {
            disposition: "include_with_binary_pixel_mask",
            classification: decision.classification === "grand_hall_core"
              ? "grand_hall_core"
              : "grand_hall_portal_threshold",
            maskRequired: true,
            generatedFillPermitted: false,
          }
          : {
            disposition: "exclude_whole_frame",
            classification: "no_observed_grand_hall_pixels",
            maskRequired: false,
            generatedFillPermitted: false,
          },
        decisionEvidenceSha256: humanDecisionsSha256,
        nativeReviewEvidenceSha256: decision.nativeReviewEvidenceSha256,
      };
    }),
    acceptedUnknownPixelDisposition: "transparent_or_unknown_never_filled",
    humanReview: { state: "human_accepted", ...reviewer },
  });
  return GrandHallRoomMembershipV4Schema.parse({
    ...material,
    artifactSha256: computeGrandHallRoomMembershipV4Sha256(material),
  });
}

function portalDecisions(
  pack: GrandHallScopeReviewPackV3,
  decisions: GrandHallT554HumanDecisionsV3,
): GrandHallPortalDecisionsV2 {
  const decisionsSha256 = computeGrandHallT554HumanDecisionsV3Sha256(decisions);
  const material = GrandHallPortalDecisionsV2MaterialSchema.parse({
    schemaVersion: GRAND_HALL_PORTAL_DECISIONS_V2,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V3,
    reviewPackSha256: pack.artifactSha256,
    humanDecisionsSchemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V3,
    humanDecisionsSha256: decisionsSha256,
    sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
    interfaceInventorySha256: pack.interfaceInventorySha256,
    interfaceCount: GRAND_HALL_EXACT_INTERFACE_COUNT,
    interfaceCandidates: pack.interfaceCandidates,
    decisions: decisions.interfaceDecisions.map((decision) => ({
      interfaceId: decision.source.interfaceId,
      resolution: decision.result === "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE"
        ? "close_at_reviewed_grand_hall_plane"
        : decision.result === "NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT"
        ? "not_a_portal_source_topology_artifact"
        : "exclude_beyond_interface",
      grandHallSideEvidenceSha256: decisionsSha256,
      decisionNote: decision.note,
      reviewedClosurePlaneBinding: decision.reviewedClosurePlaneBinding,
    })),
    allInterfacesResolved: true,
    humanReview: { state: "human_accepted", ...reviewer },
  });
  return GrandHallPortalDecisionsV2Schema.parse({
    ...material,
    artifactSha256: computeGrandHallPortalDecisionsV2Sha256(material),
  });
}

function closedBoundary(
  pack: GrandHallScopeReviewPackV3,
  membership: GrandHallRoomMembershipV4,
  portals: GrandHallPortalDecisionsV2,
  decisions: GrandHallT554HumanDecisionsV3,
): GrandHallClosedBoundaryV2 {
  const decisionsSha256 = computeGrandHallT554HumanDecisionsV3Sha256(decisions);
  const material = GrandHallClosedBoundaryV2MaterialSchema.parse({
    schemaVersion: GRAND_HALL_CLOSED_BOUNDARY_V2,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V3,
    reviewPackSha256: pack.artifactSha256,
    humanDecisionsSchemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V3,
    humanDecisionsSha256: decisionsSha256,
    roomMembershipArtifactSha256: membership.artifactSha256,
    portalDecisionSchemaVersion: GRAND_HALL_PORTAL_DECISIONS_V2,
    portalDecisionArtifactSha256: portals.artifactSha256,
    portalInterfaceInventorySha256: pack.interfaceInventorySha256,
    portalInterfaceIds: pack.interfaceCandidates.map((candidate) => candidate.interfaceId),
    sourceFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
    units: "meters",
    geometryRole: "non_rendered_selection_volume",
    construction: "extruded_simple_xy_polygon",
    nonConvex: true,
    footprintXY: CLOSED_VOLUME_FOOTPRINT,
    zMin: 0,
    zMax: 6,
    pointOnBoundaryPolicy: "include_as_inside",
    closedVolume: true,
    cameraMembershipOnly: false,
    rendered: false,
    collisionGeometry: false,
    exportedAsArchitecture: false,
    generatedGeometryCreated: false,
    semanticRefinements: decisions.interfaceDecisions.map((decision) => ({
      interfaceId: decision.source.interfaceId,
      operation: decision.result === "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE"
        ? "retain_grand_hall_side"
        : decision.result === "NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT"
        ? "remove_non_architectural_capture_artifact"
        : "exclude_beyond_interface",
      evidenceSha256: decisionsSha256,
      applied: true,
      generatedGeometryCreated: false,
      reviewedClosurePlaneBinding: decision.reviewedClosurePlaneBinding,
    })),
    humanReview: { state: "human_accepted", ...reviewer },
  });
  return GrandHallClosedBoundaryV2Schema.parse({
    ...material,
    artifactSha256: computeGrandHallClosedBoundaryV2Sha256(material),
  });
}

function panoramaMaskSet(
  pack: GrandHallScopeReviewPackV3,
  decisions: GrandHallT554HumanDecisionsV3,
  membership: GrandHallRoomMembershipV4,
  portalDecisionArtifactSha256: string,
): GrandHallPanoramaMaskSetV3 {
  const sourceRecords = decisions.panoramaDecisions.map((decision) => {
    if (decision.nativeReviewEvidenceSha256 === null) {
      throw new Error("accepted row lacks native evidence");
    }
    if (decision.result !== "INCLUDE" || decision.reviewedMaskBinding === null) {
      return {
        source: decision.source,
        disposition: "exclude_whole_frame" as const,
        mask: null,
        wholeFrameExclusionReason:
          "no_observed_grand_hall_pixels_human_confirmed" as const,
        nativeReviewEvidenceSha256: decision.nativeReviewEvidenceSha256,
      };
    }
    return {
      source: decision.source,
      disposition: "include_with_binary_pixel_mask" as const,
      mask: {
        fileName: decision.maskFileName,
        sha256: decision.reviewedMaskBinding.sha256,
        byteLength: decision.reviewedMaskBinding.byteLength,
        sourceJpgFileName: decision.source.fileName,
        sourceJpgSha256: decision.source.sha256,
        widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
        heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
        encoding: "png_grayscale8_binary_v1",
        coordinateSpace: "original_8192x4096_equirectangular_pixel_grid",
        bitDepth: 8,
        channelCount: 1,
        permittedPixelValues: [0, 255],
        includedValue: 0,
        excludedValue: 255,
        includedPixelCount: decision.reviewedMaskBinding.includedPixelCount,
        excludedPixelCount: decision.reviewedMaskBinding.excludedPixelCount,
        alphaChannelPresent: false,
        colourProfilePresent: false,
        exifOrientationPresent: false,
        resampled: false,
        reasonCodes: decision.maskReasonCodes,
      },
      wholeFrameExclusionReason: null,
      nativeReviewEvidenceSha256: decision.nativeReviewEvidenceSha256,
    };
  });
  const nativeReviewEvidenceSetSha256 = decisions.nativeReviewEvidenceSetSha256;
  if (nativeReviewEvidenceSetSha256 === null) {
    throw new Error("accepted fixture lacks native evidence set");
  }
  const material = GrandHallPanoramaMaskSetV3MaterialSchema.parse({
    schemaVersion: GRAND_HALL_PANORAMA_MASK_SET_V3,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V3,
    reviewPackSha256: pack.artifactSha256,
    membershipSchemaVersion: GRAND_HALL_ROOM_MEMBERSHIP_V4,
    membershipArtifactSha256: membership.artifactSha256,
    humanDecisionsSchemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V3,
    humanDecisionsSha256: membership.humanDecisionsSha256,
    nativeReviewEvidenceSetSha256,
    portalDecisionArtifactSha256,
    sourcePanoramaInventorySha256: pack.panoramaSourceInventorySha256,
    sourceObservationInventorySha256: pack.panoramaObservationInventorySha256,
    geometricCameraAuthority: "none",
    sourceRecordCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    maskCount: sourceRecords.filter(
      (record) => record.disposition === "include_with_binary_pixel_mask",
    ).length,
    wholeFrameExclusionCount: sourceRecords.filter(
      (record) => record.disposition === "exclude_whole_frame",
    ).length,
    sourceRecords,
    unknownPixelDisposition: "transparent_or_unknown_never_filled",
    generatedFillPermitted: false,
    humanReview: { state: "human_accepted", ...reviewer },
  });
  return GrandHallPanoramaMaskSetV3Schema.parse({
    ...material,
    artifactSha256: computeGrandHallPanoramaMaskSetV3Sha256(material),
  });
}

function acceptedChain(): GrandHallAcceptedScopeChainV3 {
  const pack = reviewPack();
  const volumeReview = closedVolumeReview(pack);
  const decisions = humanDecisions(pack, volumeReview);
  const membership = roomMembership(pack, decisions);
  const portals = portalDecisions(pack, decisions);
  const boundary = closedBoundary(pack, membership, portals, decisions);
  const masks = panoramaMaskSet(pack, decisions, membership, portals.artifactSha256);
  return verifyGrandHallAcceptedScopeChainV3({
    reviewPack: pack,
    humanDecisions: decisions,
    closedVolumeReview: volumeReview,
    membership,
    portalDecisions: portals,
    closedBoundary: boundary,
    maskSet: masks,
  });
}

function predecessorV2ReviewPack(pack: GrandHallScopeReviewPackV3) {
  const { artifactSha256, sourceEvidence, ...materialRest } = pack;
  void artifactSha256;
  const {
    cleanupMarkerEvidenceSha256,
    cleanupTargetInventorySha256,
    ...predecessorSourceEvidence
  } = sourceEvidence;
  void cleanupMarkerEvidenceSha256;
  void cleanupTargetInventorySha256;
  const material = GrandHallScopeReviewPackMaterialV2Schema.parse({
    ...materialRest,
    schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V2,
    sourceEvidence: predecessorSourceEvidence,
  });
  return GrandHallScopeReviewPackV2Schema.parse({
    ...material,
    artifactSha256: computeGrandHallScopeReviewPackV2Sha256(material),
  });
}

function predecessorV1Portal(portals: GrandHallPortalDecisionsV2) {
  const material = GrandHallPortalDecisionsV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_PORTAL_DECISIONS_V1,
    venueSlug: portals.venueSlug,
    roomSlug: portals.roomSlug,
    authority: portals.authority,
    productionTrust: portals.productionTrust,
    reviewPackSha256: portals.reviewPackSha256,
    sourceBoundaryEvidenceSha256: portals.sourceBoundaryEvidenceSha256,
    interfaceInventorySha256: portals.interfaceInventorySha256,
    interfaceCount: portals.interfaceCount,
    interfaceCandidates: portals.interfaceCandidates,
    decisions: portals.decisions.map((decision) => ({
      interfaceId: decision.interfaceId,
      resolution: decision.resolution,
      grandHallSideEvidenceSha256: decision.grandHallSideEvidenceSha256,
      decisionNote: decision.decisionNote,
    })),
    allInterfacesResolved: true,
    humanReview: portals.humanReview,
  });
  return GrandHallPortalDecisionsV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallPortalDecisionsV1Sha256(material),
  });
}

function predecessorV1Boundary(boundary: GrandHallClosedBoundaryV2) {
  const material = GrandHallClosedBoundaryV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_CLOSED_BOUNDARY_V1,
    venueSlug: boundary.venueSlug,
    roomSlug: boundary.roomSlug,
    authority: boundary.authority,
    productionTrust: boundary.productionTrust,
    reviewPackSha256: boundary.reviewPackSha256,
    roomMembershipArtifactSha256: boundary.roomMembershipArtifactSha256,
    portalDecisionArtifactSha256: boundary.portalDecisionArtifactSha256,
    portalInterfaceInventorySha256: boundary.portalInterfaceInventorySha256,
    portalInterfaceIds: boundary.portalInterfaceIds,
    sourceFrame: boundary.sourceFrame,
    units: boundary.units,
    geometryRole: boundary.geometryRole,
    construction: boundary.construction,
    nonConvex: boundary.nonConvex,
    footprintXY: boundary.footprintXY,
    zMin: boundary.zMin,
    zMax: boundary.zMax,
    pointOnBoundaryPolicy: boundary.pointOnBoundaryPolicy,
    closedVolume: boundary.closedVolume,
    cameraMembershipOnly: boundary.cameraMembershipOnly,
    rendered: boundary.rendered,
    collisionGeometry: boundary.collisionGeometry,
    exportedAsArchitecture: boundary.exportedAsArchitecture,
    generatedGeometryCreated: boundary.generatedGeometryCreated,
    semanticRefinements: boundary.semanticRefinements.map((refinement) => ({
      interfaceId: refinement.interfaceId,
      operation: refinement.operation,
      evidenceSha256: refinement.evidenceSha256,
      applied: refinement.applied,
      generatedGeometryCreated: refinement.generatedGeometryCreated,
    })),
    humanReview: boundary.humanReview,
  });
  return GrandHallClosedBoundaryV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallClosedBoundaryV1Sha256(material),
  });
}

describe("Grand Hall additive v3 review contract", () => {
  it("leaves v2 valid only under v2 and makes cleanup evidence part of the v3 digest", () => {
    const pack = reviewPack();
    const predecessor = predecessorV2ReviewPack(pack);

    expect(GrandHallScopeReviewPackV2Schema.safeParse(predecessor).success).toBe(true);
    expect(GrandHallScopeReviewPackV3Schema.safeParse(predecessor).success).toBe(false);
    expect(GrandHallScopeReviewPackV2Schema.safeParse(pack).success).toBe(false);
    expect(pack.sourceEvidence.t551SourceEvidenceSha256)
      .not.toBe(pack.sourceEvidence.boundaryReviewManifestSha256);
    expect(GrandHallScopeReviewPackV3Schema.safeParse({
      ...pack,
      sourceEvidence: {
        ...pack.sourceEvidence,
        cleanupMarkerEvidenceSha256: digest(99_001),
      },
    }).success).toBe(false);
  });

  it("keeps every pending panorama and interface fail-closed", () => {
    const pending = pendingHumanDecisions(reviewPack());
    expect(pending.nativeResolutionHumanReviewCompleted).toBe(false);
    expect(pending.nativeReviewEvidenceSetSha256).toBeNull();
    expect(pending.panoramaDecisions.every((decision) =>
      !decision.nativeResolutionHumanReviewCompleted &&
      decision.nativeReviewEvidenceSha256 === null
    )).toBe(true);
    expect(pending.interfaceDecisions.every((decision) =>
      decision.result === "UNSURE" && decision.reviewedClosurePlaneBinding === null
    )).toBe(true);
  });

  it("persists partial human progress without promoting the pending document", () => {
    const pending = pendingHumanDecisions(reviewPack());
    const partiallyReviewed = {
      ...pending,
      panoramaDecisions: pending.panoramaDecisions.map((decision, index) =>
        index === 0
          ? {
            ...decision,
            result: "EXCLUDE" as const,
            classification: "no_observed_grand_hall_pixels" as const,
            nativeResolutionHumanReviewCompleted: true,
            nativeReviewEvidenceSha256: digest(90_001),
            note: "Human native review excluded this source while the full review remains pending.",
          }
          : decision
      ),
      interfaceDecisions: pending.interfaceDecisions.map((decision, index) =>
        index === 0
          ? {
            ...decision,
            result: "EXCLUDE_BEYOND_INTERFACE" as const,
            note: "Human resolved this interface while the full review remains pending.",
          }
          : decision
      ),
    };

    const parsed = GrandHallT554HumanDecisionsV3Schema.parse(partiallyReviewed);
    expect(parsed.reviewState).toBe("human_pending");
    expect(parsed.nativeResolutionHumanReviewCompleted).toBe(false);
    expect(parsed.nativeReviewEvidenceSetSha256).toBeNull();
  });

  it("supports a reviewed rejection without requiring completion of all 148 rows", () => {
    const pending = pendingHumanDecisions(reviewPack());
    const rejected = {
      ...pending,
      reviewState: "human_rejected" as const,
      finalDecision: "REJECT" as const,
      reviewer,
    };

    expect(GrandHallT554HumanDecisionsV3Schema.safeParse(rejected).success).toBe(true);
    expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
      ...rejected,
      finalDecision: "ACCEPT",
    }).success).toBe(false);
    expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
      ...rejected,
      reviewer: null,
    }).success).toBe(false);
  });

  it("requires canonical UTC-millisecond timestamps for v3 reviewers", () => {
    const canonical = humanDecisions(reviewPack());
    expect(GrandHallT554HumanDecisionsV3Schema.safeParse(canonical).success).toBe(true);

    const offsetEquivalent = structuredClone(canonical);
    if (offsetEquivalent.reviewer === null) throw new Error("accepted fixture lacks reviewer");
    offsetEquivalent.reviewer.reviewedAt = "2026-08-26T14:00:00.000+01:00";
    expect(GrandHallT554HumanDecisionsV3Schema.safeParse(offsetEquivalent).success)
      .toBe(false);

    const missingMilliseconds = structuredClone(canonical);
    if (missingMilliseconds.reviewer === null) throw new Error("accepted fixture lacks reviewer");
    missingMilliseconds.reviewer.reviewedAt = "2026-08-26T13:00:00Z";
    expect(GrandHallT554HumanDecisionsV3Schema.safeParse(missingMilliseconds).success)
      .toBe(false);

    const excessivePrecision = structuredClone(canonical);
    if (excessivePrecision.reviewer === null) throw new Error("accepted fixture lacks reviewer");
    excessivePrecision.reviewer.reviewedAt = "2026-08-26T13:00:00.0000Z";
    expect(GrandHallT554HumanDecisionsV3Schema.safeParse(excessivePrecision).success)
      .toBe(false);
  });

  it("binds all 148 unique native receipts and permits both human hint overrides", () => {
    const pack = reviewPack();
    const decisions = humanDecisions(pack);
    expect(decisions.panoramaDecisions).toHaveLength(148);
    expect(new Set(decisions.panoramaDecisions.map(
      (decision) => decision.nativeReviewEvidenceSha256,
    )).size).toBe(148);
    expect(decisions.panoramaDecisions.find(
      (decision) => decision.source.sweepNumber === 1,
    )?.result).toBe("EXCLUDE");
    expect(decisions.panoramaDecisions.find(
      (decision) => decision.source.sweepNumber === 62,
    )?.result).toBe("INCLUDE");

    expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
      ...decisions,
      nativeReviewEvidenceSetSha256: digest(99_002),
    }).success).toBe(false);

    const firstEvidenceSha256 = decisions.panoramaDecisions[0]
      ?.nativeReviewEvidenceSha256;
    if (firstEvidenceSha256 === null || firstEvidenceSha256 === undefined) {
      throw new Error("accepted fixture lacks its first native-review receipt");
    }
    expect(GrandHallNativeReviewEvidenceSetV1Schema.safeParse(
      decisions.panoramaDecisions.map((decision) => ({
        source: decision.source,
        nativeReviewEvidenceSha256: firstEvidenceSha256,
      })),
    ).success).toBe(false);
  });

  it("rejects missing native evidence on both INCLUDE and EXCLUDE rows", () => {
    const decisions = humanDecisions(reviewPack());
    for (const result of ["INCLUDE", "EXCLUDE"] as const) {
      const index = decisions.panoramaDecisions.findIndex(
        (decision) => decision.result === result,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
        ...decisions,
        panoramaDecisions: decisions.panoramaDecisions.map((decision, rowIndex) =>
          rowIndex === index
            ? {
              ...decision,
              nativeResolutionHumanReviewCompleted: false,
              nativeReviewEvidenceSha256: null,
            }
            : decision
        ),
      }).success).toBe(false);
    }
  });

  it("binds human mask reasons exactly to whether reviewed pixels are excluded", () => {
    const decisions = humanDecisions(reviewPack());
    const partiallyExcludedIndex = decisions.panoramaDecisions.findIndex(
      (decision) =>
        decision.result === "INCLUDE" &&
        decision.reviewedMaskBinding !== null &&
        decision.reviewedMaskBinding.excludedPixelCount > 0,
    );
    const fullyIncludedIndex = decisions.panoramaDecisions.findIndex(
      (decision) =>
        decision.result === "INCLUDE" &&
        decision.reviewedMaskBinding !== null &&
        decision.reviewedMaskBinding.excludedPixelCount === 0,
    );
    expect(partiallyExcludedIndex).toBeGreaterThanOrEqual(0);
    expect(fullyIncludedIndex).toBeGreaterThanOrEqual(0);

    expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
      ...decisions,
      panoramaDecisions: decisions.panoramaDecisions.map((decision, index) =>
        index === partiallyExcludedIndex
          ? { ...decision, maskReasonCodes: [] }
          : decision
      ),
    }).success).toBe(false);
    expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
      ...decisions,
      panoramaDecisions: decisions.panoramaDecisions.map((decision, index) =>
        index === fullyIncludedIndex
          ? { ...decision, maskReasonCodes: ["unverified_or_unknown_pixels"] }
          : decision
      ),
    }).success).toBe(false);
  });

  it("accepts reviewed face correspondence but never literal-name-only cleanup evidence", () => {
    const decisions = humanDecisions(reviewPack());
    const faceLocalized = {
      ...decisions.cleanupArtifactInspections[0],
      localizationState: "source_faces_localized_by_reviewed_correspondence" as const,
      reviewedTargetIds: ["matterpak-obj-face-range:200-249"],
    };
    expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
      ...decisions,
      cleanupArtifactInspections: [
        faceLocalized,
        decisions.cleanupArtifactInspections[1],
      ],
    }).success).toBe(true);

    expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
      ...decisions,
      cleanupArtifactInspections: decisions.cleanupArtifactInspections.map(
        (inspection, index) => index === 0
          ? {
            ...inspection,
            localizationState:
              "metadata_inconclusive_no_explicit_source_locator" as const,
            reviewedTargetIds: [],
          }
          : inspection,
        ),
    }).success).toBe(false);

    const literalNameOnly = {
      ...decisions.cleanupArtifactInspections[1],
      localizationState:
        "literal_mirror_groups_localized_by_source_group_name_visual_effect_unverified" as const,
      reviewedTargetIds: MIRROR_GROUP_TARGET_IDS,
    };
    expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
      ...decisions,
      cleanupArtifactInspections: [
        decisions.cleanupArtifactInspections[0],
        literalNameOnly,
      ],
    }).success).toBe(false);

    const literalNameRejection = {
      ...literalNameOnly,
      nativeSourceReviewCompleted: false,
      result: "REJECT_SOURCE_SCOPE_HANDLING" as const,
      note: "Literal Mirror names locate source groups but do not verify their visual effect.",
    };
    expect(GrandHallCleanupArtifactInspectionV3Schema.safeParse(
      literalNameRejection,
    ).success).toBe(true);
    expect(GrandHallCleanupArtifactInspectionV3Schema.safeParse({
      ...literalNameRejection,
      reviewedTargetIds: [...MIRROR_GROUP_TARGET_IDS].reverse(),
    }).success).toBe(false);
    expect(GrandHallCleanupArtifactInspectionV3Schema.safeParse({
      ...literalNameRejection,
      localizationState: "explicit_source_groups_localized_outside_selected_room",
    }).success).toBe(false);
  });

  it("uses an exact discriminated closure binding", () => {
    const decisions = humanDecisions(reviewPack());
    const closeIndex = decisions.interfaceDecisions.findIndex(
      (decision) => decision.result === "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE",
    );
    const excludeIndex = decisions.interfaceDecisions.findIndex(
      (decision) => decision.result === "EXCLUDE_BEYOND_INTERFACE",
    );
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(excludeIndex).toBeGreaterThanOrEqual(0);
    const binding = decisions.interfaceDecisions[closeIndex]
      ?.reviewedClosurePlaneBinding;
    expect(binding).not.toBeNull();

    expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
      ...decisions,
      interfaceDecisions: decisions.interfaceDecisions.map((decision, index) =>
        index === closeIndex
          ? { ...decision, reviewedClosurePlaneBinding: null }
          : decision
      ),
    }).success).toBe(false);
    expect(GrandHallT554HumanDecisionsV3Schema.safeParse({
      ...decisions,
      interfaceDecisions: decisions.interfaceDecisions.map((decision, index) =>
        index === excludeIndex
          ? { ...decision, reviewedClosurePlaneBinding: binding }
          : decision
      ),
    }).success).toBe(false);
  });

  it("accepts a closure on a concave-notch edge without a global half-space claim", () => {
    const chain = acceptedChain();
    const close = chain.humanDecisions.interfaceDecisions.find(
      (decision) => decision.result === "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE",
    );
    expect(close?.reviewedClosurePlaneBinding.footprintEdgeIndex).toBe(3);
    expect(chain.closedVolumeReview.footprintXY[0]?.[0]).toBeLessThan(2);
    expect(GrandHallAcceptedScopeChainV3Schema.safeParse(chain).success).toBe(true);
  }, 15_000);

  it("rejects stale volume, atlas, shared-set, and out-of-range edge bindings", () => {
    const chain = acceptedChain();
    const closeIndex = chain.humanDecisions.interfaceDecisions.findIndex(
      (decision) => decision.result === "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE",
    );
    const mutations = [
      { closedVolumeReviewSha256: digest(99_010) },
      { interfaceTopologyAtlasManifestSha256: digest(99_011) },
      { sharedSourceVertexSetSha256: digest(99_012) },
      { footprintEdgeIndex: 100 },
    ] as const;
    for (const mutation of mutations) {
      const humanDecisions = {
        ...chain.humanDecisions,
        interfaceDecisions: chain.humanDecisions.interfaceDecisions.map(
          (decision, index) => index === closeIndex &&
              decision.result === "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE"
            ? {
              ...decision,
              reviewedClosurePlaneBinding: {
                ...decision.reviewedClosurePlaneBinding,
                ...mutation,
              },
            }
            : decision,
        ),
      };
      expect(GrandHallAcceptedScopeChainV3Schema.safeParse({
        ...chain,
        humanDecisions,
      }).success).toBe(false);
    }
  }, 15_000);

  it("requires portal v2 and closed-boundary v2 to preserve every closure binding", () => {
    const chain = acceptedChain();
    const legacyPortal = predecessorV1Portal(chain.portalDecisions);
    const legacyBoundary = predecessorV1Boundary(chain.closedBoundary);
    expect(GrandHallAcceptedScopeChainV3Schema.safeParse({
      ...chain,
      portalDecisions: legacyPortal,
    }).success).toBe(false);
    expect(GrandHallAcceptedScopeChainV3Schema.safeParse({
      ...chain,
      closedBoundary: legacyBoundary,
    }).success).toBe(false);

    const closeIndex = chain.portalDecisions.decisions.findIndex(
      (decision) => decision.resolution === "close_at_reviewed_grand_hall_plane",
    );
    expect(GrandHallPortalDecisionsV2Schema.safeParse({
      ...chain.portalDecisions,
      decisions: chain.portalDecisions.decisions.map((decision, index) =>
        index === closeIndex
          ? { ...decision, reviewedClosurePlaneBinding: null }
          : decision
      ),
    }).success).toBe(false);
    expect(GrandHallClosedBoundaryV2Schema.safeParse({
      ...chain.closedBoundary,
      semanticRefinements: chain.closedBoundary.semanticRefinements.map(
        (refinement, index) => index === closeIndex
          ? { ...refinement, reviewedClosurePlaneBinding: null }
          : refinement
      ),
    }).success).toBe(false);
  }, 15_000);

  it("cross-binds every membership and mask row to its native-review receipt", () => {
    const chain = acceptedChain();
    const {
      artifactSha256: originalMembershipSha256,
      ...membershipMaterial
    } = chain.membership;
    void originalMembershipSha256;
    const changedMembershipRecords = chain.membership.panoramaRecords.map((record, index) =>
      index === 0
        ? { ...record, nativeReviewEvidenceSha256: digest(99_020) }
        : record
    );
    expect(GrandHallRoomMembershipV4MaterialSchema.safeParse({
      ...membershipMaterial,
      panoramaRecords: changedMembershipRecords,
    }).success).toBe(false);
    const changedMembershipNativeSetSha256 =
      computeGrandHallNativeReviewEvidenceSetV1Sha256(
        changedMembershipRecords.map((record) => ({
          source: record.source,
          nativeReviewEvidenceSha256: record.nativeReviewEvidenceSha256,
        })),
      );
    const changedMembershipMaterial = GrandHallRoomMembershipV4MaterialSchema.parse({
      ...membershipMaterial,
      nativeReviewEvidenceSetSha256: changedMembershipNativeSetSha256,
      panoramaRecords: changedMembershipRecords,
    });
    const changedMembership = GrandHallRoomMembershipV4Schema.parse({
      ...changedMembershipMaterial,
      artifactSha256: computeGrandHallRoomMembershipV4Sha256(changedMembershipMaterial),
    });
    expect(GrandHallAcceptedScopeChainV3Schema.safeParse({
      ...chain,
      membership: changedMembership,
    }).success).toBe(false);

    const {
      artifactSha256: originalMaskSetSha256,
      ...maskSetMaterial
    } = chain.maskSet;
    void originalMaskSetSha256;
    const changedMaskRecords = chain.maskSet.sourceRecords.map((record, index) =>
      index === 0
        ? { ...record, nativeReviewEvidenceSha256: digest(99_021) }
        : record
    );
    expect(GrandHallPanoramaMaskSetV3MaterialSchema.safeParse({
      ...maskSetMaterial,
      sourceRecords: changedMaskRecords,
    }).success).toBe(false);
    const changedMaskNativeSetSha256 = computeGrandHallNativeReviewEvidenceSetV1Sha256(
      changedMaskRecords.map((record) => ({
        source: record.source,
        nativeReviewEvidenceSha256: record.nativeReviewEvidenceSha256,
      })),
    );
    const changedMaskMaterial = GrandHallPanoramaMaskSetV3MaterialSchema.parse({
      ...maskSetMaterial,
      nativeReviewEvidenceSetSha256: changedMaskNativeSetSha256,
      sourceRecords: changedMaskRecords,
    });
    const changedMaskSet = GrandHallPanoramaMaskSetV3Schema.parse({
      ...changedMaskMaterial,
      artifactSha256: computeGrandHallPanoramaMaskSetV3Sha256(changedMaskMaterial),
    });
    expect(GrandHallAcceptedScopeChainV3Schema.safeParse({
      ...chain,
      maskSet: changedMaskSet,
    }).success).toBe(false);
  }, 15_000);

  it("rejects reviewer drift and unknown fields in the accepted chain", () => {
    const chain = acceptedChain();
    const {
      artifactSha256: originalMembershipSha256,
      ...membershipMaterial
    } = chain.membership;
    void originalMembershipSha256;
    const reviewerDriftMaterial = GrandHallRoomMembershipV4MaterialSchema.parse({
      ...membershipMaterial,
      humanReview: {
        ...membershipMaterial.humanReview,
        reviewerId: "different-reviewer",
      },
    });
    const reviewerDriftMembership = GrandHallRoomMembershipV4Schema.parse({
      ...reviewerDriftMaterial,
      artifactSha256: computeGrandHallRoomMembershipV4Sha256(reviewerDriftMaterial),
    });
    expect(GrandHallAcceptedScopeChainV3Schema.safeParse({
      ...chain,
      membership: reviewerDriftMembership,
    }).success).toBe(false);
    expect(GrandHallAcceptedScopeChainV3Schema.safeParse({
      ...chain,
      inventedAuthority: true,
    }).success).toBe(false);
  }, 15_000);
});

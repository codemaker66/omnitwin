import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_CLOSED_BOUNDARY_V1,
  GRAND_HALL_EXACT_INTERFACE_COUNT,
  GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
  GRAND_HALL_MATTERPAK_ROOM_KEY,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_PORTAL_DECISIONS_V1,
  GRAND_HALL_REVIEW_PANORAMA_COUNT,
  GRAND_HALL_SCOPE_REVIEW_PACK_V1,
  GrandHallClosedBoundaryV1MaterialSchema,
  GrandHallClosedBoundaryV1Schema,
  GrandHallInterfaceCandidateSchema,
  GrandHallPanoramaSourceJpgIdentitySchema,
  GrandHallPortalDecisionsV1MaterialSchema,
  GrandHallPortalDecisionsV1Schema,
  computeGrandHallClosedBoundaryV1Sha256,
  computeGrandHallInterfaceInventorySha256,
  computeGrandHallPortalDecisionsV1Sha256,
  type GrandHallClosedBoundaryV1,
  type GrandHallPortalDecisionsV1,
} from "../grand-hall-room-scope-artifacts.js";
import {
  GRAND_HALL_AGENT_OBSERVED_POSITIVE_SWEEP_NUMBERS,
  GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
  GRAND_HALL_NO_OBSERVED_PIXEL_PANORAMA_COUNT,
  GRAND_HALL_OBSERVED_POSITIVE_PANORAMA_COUNT,
  GRAND_HALL_PANORAMA_MASK_SET_V2,
  GRAND_HALL_ROOM_MEMBERSHIP_V3,
  GRAND_HALL_SCOPE_REVIEW_PACK_V2,
  GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS,
  GRAND_HALL_T554_HUMAN_DECISIONS_V2,
  GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
  GRAND_HALL_T561_OBSERVATION_INPUT_V1,
  GRAND_HALL_T561_OBSERVATION_MANIFEST_V1,
  GRAND_HALL_T561_OBSERVATION_RECEIPT_V1,
  GrandHallAcceptedScopeChainV2Schema,
  GrandHallPanoramaMaskSetV2MaterialSchema,
  GrandHallPanoramaMaskSetV2Schema,
  GrandHallPanoramaObservationInventoryV2Schema,
  GrandHallPanoramaSourceJpgIdentityV2Schema,
  GrandHallPanoramaSourceInventoryV3Schema,
  GrandHallRoomMembershipV3MaterialSchema,
  GrandHallRoomMembershipV3Schema,
  GrandHallScopeReviewPackMaterialV2Schema,
  GrandHallScopeReviewPackV2Schema,
  GrandHallT554ClosedVolumeReviewV1Schema,
  GrandHallT554HumanDecisionsV2Schema,
  computeGrandHallPanoramaMaskSetV2Sha256,
  computeGrandHallPanoramaObservationInventoryV2Sha256,
  computeGrandHallPanoramaSourceInventoryV3Sha256,
  computeGrandHallRoomMembershipV3Sha256,
  computeGrandHallScopeReviewPackV2Sha256,
  computeGrandHallT554HumanDecisionsV2Sha256,
  computeGrandHallT554ClosedVolumeReviewV1Sha256,
  verifyGrandHallAcceptedScopeChainV2,
  type GrandHallAcceptedScopeChainV2,
  type GrandHallPanoramaObservationBindingV2,
  type GrandHallPanoramaSourceInventoryV3,
  type GrandHallRoomMembershipV3,
  type GrandHallScopeReviewPackV2,
  type GrandHallT554HumanDecisionsV2,
  type GrandHallT554ClosedVolumeReviewV1,
} from "../grand-hall-room-scope-artifacts-v2.js";

const PANORAMA_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const POSITIVE_SWEEPS = new Set<number>(
  GRAND_HALL_AGENT_OBSERVED_POSITIVE_SWEEP_NUMBERS,
);

function digest(seed: number): `sha256:${string}` {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

function materialOf<T extends { readonly artifactSha256: string }>(
  artifact: T,
): Omit<T, "artifactSha256"> {
  const { artifactSha256, ...material } = artifact;
  void artifactSha256;
  return material;
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

function reviewPack(): GrandHallScopeReviewPackV2 {
  const sources = panoramaSources();
  const bindings = observationBindings(sources);
  const interfaces = interfaceCandidates();
  const material = GrandHallScopeReviewPackMaterialV2Schema.parse({
    schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V2,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    createdAt: "2026-08-26T12:00:00.000Z",
    createdBy: "synthetic-t554-v2-contract-test",
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
  return GrandHallScopeReviewPackV2Schema.parse({
    ...material,
    artifactSha256: computeGrandHallScopeReviewPackV2Sha256(material),
  });
}

const reviewer = {
  reviewerId: "synthetic-authorized-reviewer",
  reviewerRole: "venue_owner_or_authorized_domain_reviewer" as const,
  reviewedAt: "2026-08-26T13:00:00.000Z",
  knowledgeBasis: ["synthetic exact 148-source contract fixture"],
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

function closedVolumeReview(
  pack: GrandHallScopeReviewPackV2,
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
  record: GrandHallScopeReviewPackV2["panoramaRecords"][number],
) {
  if (record.observation.proposedDisposition === "exclude_whole_frame") {
    return {
      source: record.source,
      sourceObservation: record.observation,
      result: "EXCLUDE" as const,
      classification: "no_observed_grand_hall_pixels" as const,
      maskFileName: null,
      reviewedMaskBinding: null,
      maskReviewed: false,
      maskReasonCodes: [],
      note: "Human confirmed that no Grand Hall pixels are present.",
    };
  }
  return {
    source: record.source,
    sourceObservation: record.observation,
    result: "INCLUDE" as const,
    classification: record.source.sweepNumber >= 148
      ? "grand_hall_portal_threshold" as const
      : "grand_hall_core" as const,
    maskFileName: maskName(record.source.inventoryIndex),
    reviewedMaskBinding: {
      sha256: digest(4_000 + record.source.inventoryIndex),
      byteLength: 1_000 + record.source.inventoryIndex,
      includedPixelCount: PANORAMA_PIXEL_COUNT - 1,
      excludedPixelCount: 1,
    },
    maskReviewed: true,
    maskReasonCodes: ["unverified_or_unknown_pixels" as const],
    note: "Human reviewed the exact source-grid binary mask.",
  };
}

function humanDecisions(
  pack: GrandHallScopeReviewPackV2,
  accepted: boolean,
  volumeReview: GrandHallT554ClosedVolumeReviewV1 = closedVolumeReview(pack),
): GrandHallT554HumanDecisionsV2 {
  return GrandHallT554HumanDecisionsV2Schema.parse({
    schemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V2,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V2,
    reviewPackSha256: pack.artifactSha256,
    sourcePanoramaInventorySha256: pack.panoramaSourceInventorySha256,
    sourceObservationInventorySha256: pack.panoramaObservationInventorySha256,
    authority: "none",
    reviewState: accepted ? "human_accepted" : "human_pending",
    finalDecision: accepted ? "ACCEPT" : "PENDING",
    reviewer: accepted ? reviewer : null,
    generatedFillPermitted: false,
    geometricCameraAuthority: "none",
    matterPakRoomDecision: {
      sourceRoomKey: GRAND_HALL_MATTERPAK_ROOM_KEY,
      sourceMembershipV1Sha256: pack.sourceEvidence.t550PendingMembershipV1Sha256,
      sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
      result: accepted ? "ACCEPT_AS_GRAND_HALL" : "UNSURE",
      note: accepted ? "Human accepted exact MatterPak room 9." : null,
    },
    cleanupArtifactInspections: (["Window", "Mirror"] as const).map((artifactClass) => ({
      artifactClass,
      sourceBoundaryEvidenceSha256: pack.sourceEvidence.t551SourceEvidenceSha256,
      result: accepted
        ? "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY"
        : "UNSURE",
      note: accepted ? "Human accepted source cleanup handling without architectural authority." : null,
    })),
    closedSelectionVolumeDecision: {
      reviewSchemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
      reviewArtifactSha256: accepted
        ? computeGrandHallT554ClosedVolumeReviewV1Sha256(volumeReview)
        : null,
      result: accepted ? "ACCEPT_NON_RENDERED_SELECTION_VOLUME" : "UNSURE",
      note: accepted ? "Human accepted the digest-bound closed selection volume." : null,
    },
    panoramaDecisionCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    panoramaDecisions: pack.panoramaRecords.map((record) => accepted
      ? acceptedPanoramaDecision(record)
      : {
        source: record.source,
        sourceObservation: record.observation,
        result: "UNSURE",
        classification: null,
        maskFileName: null,
        reviewedMaskBinding: null,
        maskReviewed: false,
        maskReasonCodes: [],
        note: null,
      }),
    interfaceDecisions: pack.interfaceCandidates.map((source) => ({
      source,
      result: accepted ? "EXCLUDE_BEYOND_INTERFACE" : "UNSURE",
      note: accepted ? "Human retained only the reviewed Grand Hall side." : null,
    })),
    sourceInterfaceInventorySha256: pack.interfaceInventorySha256,
  });
}

function correctedHumanDecisions(
  pack: GrandHallScopeReviewPackV2,
): GrandHallT554HumanDecisionsV2 {
  const accepted = humanDecisions(pack, true);
  const positiveIndex = accepted.panoramaDecisions.findIndex(
    (decision) => decision.source.sweepNumber === 1,
  );
  const negativeIndex = accepted.panoramaDecisions.findIndex(
    (decision) => decision.source.sweepNumber === 62,
  );
  const panoramaDecisions = accepted.panoramaDecisions.map((decision, index) => {
    if (index === positiveIndex) {
      return {
        ...decision,
        result: "EXCLUDE" as const,
        classification: "no_observed_grand_hall_pixels" as const,
        maskFileName: null,
        reviewedMaskBinding: null,
        maskReviewed: false,
        maskReasonCodes: [],
        note: "Human overrode the authority-none positive observation.",
      };
    }
    if (index === negativeIndex) {
      return {
        ...decision,
        result: "INCLUDE" as const,
        classification: "grand_hall_portal_threshold" as const,
        maskFileName: maskName(decision.source.inventoryIndex),
        reviewedMaskBinding: {
          sha256: digest(4_000 + decision.source.inventoryIndex),
          byteLength: 1_000 + decision.source.inventoryIndex,
          includedPixelCount: PANORAMA_PIXEL_COUNT - 1,
          excludedPixelCount: 1,
        },
        maskReviewed: true,
        maskReasonCodes: ["portal_beyond_grand_hall_plane" as const],
        note: "Human found portal-visible Grand Hall pixels and reviewed their mask.",
      };
    }
    return decision;
  });
  return GrandHallT554HumanDecisionsV2Schema.parse({ ...accepted, panoramaDecisions });
}

function roomMembership(
  pack: GrandHallScopeReviewPackV2,
  decisions: GrandHallT554HumanDecisionsV2,
): GrandHallRoomMembershipV3 {
  const humanDecisionsSha256 = computeGrandHallT554HumanDecisionsV2Sha256(decisions);
  const includedFrameCount = decisions.panoramaDecisions.filter(
    (decision) => decision.result === "INCLUDE",
  ).length;
  const material = GrandHallRoomMembershipV3MaterialSchema.parse({
    schemaVersion: GRAND_HALL_ROOM_MEMBERSHIP_V3,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V2,
    reviewPackSha256: pack.artifactSha256,
    humanDecisionsSchemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V2,
    humanDecisionsSha256,
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
    panoramaRecords: decisions.panoramaDecisions.map((decision) => ({
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
    })),
    acceptedUnknownPixelDisposition: "transparent_or_unknown_never_filled",
    humanReview: { state: "human_accepted", ...reviewer },
  });
  return GrandHallRoomMembershipV3Schema.parse({
    ...material,
    artifactSha256: computeGrandHallRoomMembershipV3Sha256(material),
  });
}

function portalDecisions(
  pack: GrandHallScopeReviewPackV2,
  decisions: GrandHallT554HumanDecisionsV2,
): GrandHallPortalDecisionsV1 {
  const decisionsSha256 = computeGrandHallT554HumanDecisionsV2Sha256(decisions);
  const material = GrandHallPortalDecisionsV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_PORTAL_DECISIONS_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSha256: pack.artifactSha256,
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
    })),
    allInterfacesResolved: true,
    humanReview: { state: "human_accepted", ...reviewer },
  });
  return GrandHallPortalDecisionsV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallPortalDecisionsV1Sha256(material),
  });
}

function closedBoundary(
  pack: GrandHallScopeReviewPackV2,
  membership: GrandHallRoomMembershipV3,
  portals: GrandHallPortalDecisionsV1,
  decisions: GrandHallT554HumanDecisionsV2,
): GrandHallClosedBoundaryV1 {
  const decisionsSha256 = computeGrandHallT554HumanDecisionsV2Sha256(decisions);
  const material = GrandHallClosedBoundaryV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_CLOSED_BOUNDARY_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSha256: pack.artifactSha256,
    roomMembershipArtifactSha256: membership.artifactSha256,
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
    })),
    humanReview: { state: "human_accepted", ...reviewer },
  });
  return GrandHallClosedBoundaryV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallClosedBoundaryV1Sha256(material),
  });
}

function panoramaMaskSet(
  pack: GrandHallScopeReviewPackV2,
  decisions: GrandHallT554HumanDecisionsV2,
  membership: GrandHallRoomMembershipV3,
  portalDecisionArtifactSha256: string = digest(5_001),
) {
  const sourceRecords = decisions.panoramaDecisions.map((decision) => {
    if (decision.result !== "INCLUDE" || decision.reviewedMaskBinding === null) {
      return {
        source: decision.source,
        disposition: "exclude_whole_frame" as const,
        mask: null,
        wholeFrameExclusionReason: "no_observed_grand_hall_pixels_human_confirmed" as const,
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
    };
  });
  const material = GrandHallPanoramaMaskSetV2MaterialSchema.parse({
    schemaVersion: GRAND_HALL_PANORAMA_MASK_SET_V2,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V2,
    reviewPackSha256: pack.artifactSha256,
    membershipSchemaVersion: GRAND_HALL_ROOM_MEMBERSHIP_V3,
    membershipArtifactSha256: membership.artifactSha256,
    humanDecisionsSchemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V2,
    humanDecisionsSha256: membership.humanDecisionsSha256,
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
  return GrandHallPanoramaMaskSetV2Schema.parse({
    ...material,
    artifactSha256: computeGrandHallPanoramaMaskSetV2Sha256(material),
  });
}

function acceptedChain(): GrandHallAcceptedScopeChainV2 {
  const pack = reviewPack();
  const volumeReview = closedVolumeReview(pack);
  const decisions = humanDecisions(pack, true, volumeReview);
  const membership = roomMembership(pack, decisions);
  const portals = portalDecisions(pack, decisions);
  const boundary = closedBoundary(pack, membership, portals, decisions);
  const masks = panoramaMaskSet(
    pack,
    decisions,
    membership,
    portals.artifactSha256,
  );
  return verifyGrandHallAcceptedScopeChainV2({
    reviewPack: pack,
    humanDecisions: decisions,
    closedVolumeReview: volumeReview,
    membership,
    portalDecisions: portals,
    closedBoundary: boundary,
    maskSet: masks,
  });
}

describe("Grand Hall unified 148-source v2 review contract", () => {
  it("preserves the legacy 50-source schema without changing its meaning", () => {
    expect(GRAND_HALL_REVIEW_PANORAMA_COUNT).toBe(50);
    expect(GrandHallPanoramaSourceJpgIdentitySchema.safeParse({
      sweepNumber: 51,
      fileName: "sweep_051jpg.jpg",
      sha256: digest(51),
      byteLength: 1,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    }).success).toBe(false);
  });

  it("binds all supplied identities and the exact authority-none 74/74 observations", () => {
    const pack = reviewPack();
    expect(pack.panoramaRecords).toHaveLength(148);
    expect(pack.panoramaRecords.some((record) => record.source.sweepNumber === 93)).toBe(false);
    expect(pack.panoramaRecords.filter((record) =>
      record.observation.state === "grand_hall_pixels_observed_human_pending"
    )).toHaveLength(74);
    expect(pack.panoramaRecords.filter((record) =>
      record.observation.state === "no_grand_hall_pixels_observed_human_pending"
    )).toHaveLength(74);
    expect(pack.sourceEvidence.predecessorReviewPack.schemaVersion)
      .toBe(GRAND_HALL_SCOPE_REVIEW_PACK_V1);
    expect(pack.sourceEvidence.legacy50By98PartitionUsed).toBe(false);
    expect(GrandHallScopeReviewPackV2Schema.safeParse(pack).success).toBe(true);
  });

  it("binds the exact T-561 authority-none evidence and its resampled inspection limits", () => {
    const pack = reviewPack();
    expect(pack.sourceEvidence.t561AuthorityNoneObservation).toMatchObject({
      inputSchemaVersion: GRAND_HALL_T561_OBSERVATION_INPUT_V1,
      manifestSchemaVersion: GRAND_HALL_T561_OBSERVATION_MANIFEST_V1,
      receiptSchemaVersion: GRAND_HALL_T561_OBSERVATION_RECEIPT_V1,
      sourceRecordCount: 148,
      grandHallPixelsObservedCount: 74,
      noGrandHallPixelsObservedCount: 74,
      uncertainPossibleGrandHallPixelsCount: 0,
      inspection: {
        displayedWidthPx: 2_048,
        displayedHeightPx: 1_024,
        displayMayHaveBeenResampled: true,
        nativeResolutionHumanReviewCompleted: false,
        humanAcceptanceRecorded: false,
      },
    });
    expect(GrandHallScopeReviewPackMaterialV2Schema.safeParse({
      ...materialOf(pack),
      sourceEvidence: {
        ...pack.sourceEvidence,
        t561AuthorityNoneObservation: {
          ...pack.sourceEvidence.t561AuthorityNoneObservation,
          inspection: {
            ...pack.sourceEvidence.t561AuthorityNoneObservation.inspection,
            nativeResolutionHumanReviewCompleted: true,
          },
        },
      },
    }).success).toBe(false);
    expect(GrandHallScopeReviewPackV2Schema.safeParse({
      ...pack,
      sourceEvidence: {
        ...pack.sourceEvidence,
        t561AuthorityNoneObservation: {
          ...pack.sourceEvidence.t561AuthorityNoneObservation,
          observationSetSha256: digest(77_001),
        },
      },
    }).success).toBe(false);
  });

  it("validates the filename-encoded sweep across every supplied naming variant", () => {
    const sources = panoramaSources();
    expect(sources.find((source) => source.sweepNumber === 99)?.fileName)
      .toBe("sweep_099pg.jpg");
    expect(sources.find((source) => source.sweepNumber === 145)?.fileName)
      .toBe("sweep_145pg.jpg");
    expect(sources.find((source) => source.sweepNumber === 148)?.fileName)
      .toBe("sweep_0148jpg.jpg");
    expect(sources.find((source) => source.sweepNumber === 149)?.fileName)
      .toBe("sweep_0149jpg.jpg");

    const first = sources[0];
    const sweepSixtyTwo = sources.find((source) => source.sweepNumber === 62);
    if (first === undefined || sweepSixtyTwo === undefined) throw new Error("missing fixture source");
    expect(GrandHallPanoramaSourceInventoryV3Schema.safeParse(
      sources.map((source) => {
        if (source.sweepNumber === 1) {
          return {
            ...source,
            fileName: sweepSixtyTwo.fileName,
            sha256: sweepSixtyTwo.sha256,
            byteLength: sweepSixtyTwo.byteLength,
          };
        }
        if (source.sweepNumber === 62) {
          return {
            ...source,
            fileName: first.fileName,
            sha256: first.sha256,
            byteLength: first.byteLength,
          };
        }
        return source;
      }),
    ).success).toBe(false);
  });

  it.each([
    "C:/escape.jpg",
    "//server/share/sweep_001jpg.jpg",
    "masks/CON.png",
    "masks/trailing-space .png",
    "masks/sweep-\u202e100.png",
    "masks\\sweep-001.png",
  ])("rejects unsafe or Windows-qualified file identity %s", (fileName) => {
    expect(GrandHallPanoramaSourceJpgIdentityV2Schema.safeParse({
      inventoryIndex: 0,
      sweepNumber: 1,
      fileName,
      sha256: digest(1),
      byteLength: 1,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    }).success).toBe(false);
  });

  it("rejects source reorder, an invented sweep 93, and observation-set drift", () => {
    const sources = panoramaSources();
    expect(GrandHallPanoramaSourceInventoryV3Schema.safeParse([
      sources[1],
      sources[0],
      ...sources.slice(2),
    ]).success).toBe(false);
    expect(GrandHallPanoramaSourceInventoryV3Schema.safeParse(
      sources.map((source, index) => index === 92 ? { ...source, sweepNumber: 93 } : source),
    ).success).toBe(false);

    const pack = reviewPack();
    expect(GrandHallScopeReviewPackMaterialV2Schema.safeParse(materialOf(pack)).success)
      .toBe(true);
    const driftedRecords = pack.panoramaRecords.map((record, index) => index === 0
      ? {
        ...record,
        observation: {
          state: "no_grand_hall_pixels_observed_human_pending",
          proposedDisposition: "exclude_whole_frame",
          maskAuthoringState: "not_required_if_human_confirms_exclusion",
        },
      }
      : record);
    expect(GrandHallScopeReviewPackMaterialV2Schema.safeParse({
      ...materialOf(pack),
      panoramaRecords: driftedRecords,
    }).success).toBe(false);
  });

  it("rejects a stale canonical digest", () => {
    const pack = reviewPack();
    expect(GrandHallScopeReviewPackV2Schema.safeParse({
      ...pack,
      artifactSha256: digest(99_999),
    }).success).toBe(false);
  });
});

describe("Grand Hall unified 148-source human decisions", () => {
  it("uses one fail-closed array and defaults every identity to UNSURE", () => {
    const decisions = humanDecisions(reviewPack(), false);
    expect(decisions.panoramaDecisions).toHaveLength(148);
    expect(decisions.panoramaDecisions.every((decision) => decision.result === "UNSURE"))
      .toBe(true);
    expect(decisions).not.toHaveProperty("nonCandidatePanoramaDecisions");
  });

  it("requires every accepted inclusion to bind a human-reviewed exact-grid mask", () => {
    const accepted = humanDecisions(reviewPack(), true);
    const firstIncludedIndex = accepted.panoramaDecisions.findIndex(
      (decision) => decision.result === "INCLUDE",
    );
    const withoutReviewedBinding = accepted.panoramaDecisions.map((decision, index) =>
      index === firstIncludedIndex
        ? { ...decision, reviewedMaskBinding: null, maskReviewed: false }
        : decision
    );
    expect(GrandHallT554HumanDecisionsV2Schema.safeParse({
      ...accepted,
      panoramaDecisions: withoutReviewedBinding,
    }).success).toBe(false);
    expect(GrandHallT554HumanDecisionsV2Schema.safeParse({
      ...accepted,
      panoramaDecisions: accepted.panoramaDecisions.map((decision, index) =>
        index === 0
          ? {
            ...decision,
            result: "UNSURE",
            classification: null,
            maskFileName: null,
            reviewedMaskBinding: null,
            maskReviewed: false,
            maskReasonCodes: [],
          }
          : decision
      ),
    }).success).toBe(false);
  });

  it("requires exact Window/Mirror coverage and one ordered decision per interface", () => {
    const accepted = humanDecisions(reviewPack(), true);
    expect(GrandHallT554HumanDecisionsV2Schema.safeParse({
      ...accepted,
      cleanupArtifactInspections: [
        accepted.cleanupArtifactInspections[0],
        accepted.cleanupArtifactInspections[0],
      ],
    }).success).toBe(false);
    expect(GrandHallT554HumanDecisionsV2Schema.safeParse({
      ...accepted,
      interfaceDecisions: Array.from(
        { length: GRAND_HALL_EXACT_INTERFACE_COUNT },
        () => accepted.interfaceDecisions[0],
      ),
      sourceInterfaceInventorySha256: computeGrandHallInterfaceInventorySha256(
        Array.from(
          { length: GRAND_HALL_EXACT_INTERFACE_COUNT },
          () => accepted.interfaceDecisions[0]!.source,
        ),
      ),
    }).success).toBe(false);
    const reordered = [
      accepted.interfaceDecisions[1],
      accepted.interfaceDecisions[0],
      ...accepted.interfaceDecisions.slice(2),
    ];
    expect(GrandHallT554HumanDecisionsV2Schema.safeParse({
      ...accepted,
      interfaceDecisions: reordered,
      sourceInterfaceInventorySha256: computeGrandHallInterfaceInventorySha256(
        reordered.map((decision) => decision!.source),
      ),
    }).success).toBe(false);
  });

  it("blocks acceptance without a digest-bound accepted closed-volume review", () => {
    const accepted = humanDecisions(reviewPack(), true);
    expect(GrandHallT554HumanDecisionsV2Schema.safeParse({
      ...accepted,
      closedSelectionVolumeDecision: {
        reviewSchemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
        reviewArtifactSha256: null,
        result: "UNSURE",
        note: null,
      },
    }).success).toBe(false);
  });

  it("rejects a drive-qualified reviewed mask path even when the PNG suffix is valid", () => {
    const accepted = humanDecisions(reviewPack(), true);
    const includedIndices = accepted.panoramaDecisions.flatMap((decision, index) =>
      decision.result === "INCLUDE" ? [index] : []
    );
    const includedIndex = includedIndices[0];
    const secondIncludedIndex = includedIndices[1];
    if (includedIndex === undefined || secondIncludedIndex === undefined) {
      throw new Error("missing included panorama decision fixtures");
    }
    expect(GrandHallT554HumanDecisionsV2Schema.safeParse({
      ...accepted,
      panoramaDecisions: accepted.panoramaDecisions.map((decision, index) => index === includedIndex
        ? { ...decision, maskFileName: "C:/escape.png" }
        : decision),
    }).success).toBe(false);
    expect(GrandHallT554HumanDecisionsV2Schema.safeParse({
      ...accepted,
      panoramaDecisions: accepted.panoramaDecisions.map((decision, index) => {
        if (index === includedIndex) return { ...decision, maskFileName: "masks/a.png" };
        if (index === secondIncludedIndex) return { ...decision, maskFileName: "masks/A.png" };
        return decision;
      }),
    }).success).toBe(false);
  });

  it("allows a human to correct either authority-none observation without moving identities", () => {
    const corrected = correctedHumanDecisions(reviewPack());
    const sweepOne = corrected.panoramaDecisions.find(
      (decision) => decision.source.sweepNumber === 1,
    );
    const sweepSixtyTwo = corrected.panoramaDecisions.find(
      (decision) => decision.source.sweepNumber === 62,
    );
    expect(sweepOne?.sourceObservation.state)
      .toBe("grand_hall_pixels_observed_human_pending");
    expect(sweepOne?.result).toBe("EXCLUDE");
    expect(sweepSixtyTwo?.sourceObservation.state)
      .toBe("no_grand_hall_pixels_observed_human_pending");
    expect(sweepSixtyTwo?.result).toBe("INCLUDE");
    expect(corrected.panoramaDecisions).toHaveLength(148);
  });
});

describe("Grand Hall 148-source accepted membership and mask successors", () => {
  it("seals one 148-record membership and mask partition without generated fill", () => {
    const pack = reviewPack();
    const decisions = humanDecisions(pack, true);
    const membership = roomMembership(pack, decisions);
    const masks = panoramaMaskSet(pack, decisions, membership);
    expect(GrandHallRoomMembershipV3MaterialSchema.safeParse(materialOf(membership)).success)
      .toBe(true);
    expect(GrandHallPanoramaMaskSetV2MaterialSchema.safeParse(materialOf(masks)).success)
      .toBe(true);

    expect(membership.schemaVersion).toBe(GRAND_HALL_ROOM_MEMBERSHIP_V3);
    expect(membership.panoramaRecords).toHaveLength(148);
    expect(membership.includedFrameCount).toBe(74);
    expect(membership.wholeFrameExclusionCount).toBe(74);
    expect(masks.schemaVersion).toBe(GRAND_HALL_PANORAMA_MASK_SET_V2);
    expect(masks.sourceRecords).toHaveLength(148);
    expect(masks.maskCount).toBe(74);
    expect(masks.wholeFrameExclusionCount).toBe(74);
    expect(masks.generatedFillPermitted).toBe(false);
  });

  it("rejects membership decision-evidence drift and mask/source identity drift", () => {
    const pack = reviewPack();
    const decisions = humanDecisions(pack, true);
    const membership = roomMembership(pack, decisions);
    const masks = panoramaMaskSet(pack, decisions, membership);
    expect(GrandHallRoomMembershipV3MaterialSchema.safeParse({
      ...materialOf(membership),
      panoramaRecords: membership.panoramaRecords.map((record, index) => index === 0
        ? { ...record, decisionEvidenceSha256: digest(88_001) }
        : record),
    }).success).toBe(false);

    const includedIndex = masks.sourceRecords.findIndex(
      (record) => record.disposition === "include_with_binary_pixel_mask",
    );
    expect(GrandHallPanoramaMaskSetV2MaterialSchema.safeParse({
      ...materialOf(masks),
      sourceRecords: masks.sourceRecords.map((record, index) =>
        index === includedIndex && record.disposition === "include_with_binary_pixel_mask"
          ? {
            ...record,
            mask: { ...record.mask, sourceJpgSha256: digest(88_002) },
          }
          : record
      ),
    }).success).toBe(false);
  });

  it("rejects unsafe V2 mask paths and case-insensitive Windows filename collisions", () => {
    const pack = reviewPack();
    const decisions = humanDecisions(pack, true);
    const membership = roomMembership(pack, decisions);
    const masks = panoramaMaskSet(pack, decisions, membership);
    const includedIndices = masks.sourceRecords.flatMap((record, index) =>
      record.disposition === "include_with_binary_pixel_mask" ? [index] : []
    );
    const firstIncluded = includedIndices[0];
    const secondIncluded = includedIndices[1];
    if (firstIncluded === undefined || secondIncluded === undefined) {
      throw new Error("missing included mask fixtures");
    }
    expect(GrandHallPanoramaMaskSetV2MaterialSchema.safeParse({
      ...materialOf(masks),
      sourceRecords: masks.sourceRecords.map((record, index) =>
        index === firstIncluded && record.disposition === "include_with_binary_pixel_mask"
          ? { ...record, mask: { ...record.mask, fileName: "C:/evil.png" } }
          : record
      ),
    }).success).toBe(false);

    expect(GrandHallPanoramaMaskSetV2MaterialSchema.safeParse({
      ...materialOf(masks),
      sourceRecords: masks.sourceRecords.map((record, index) => {
        if (record.disposition !== "include_with_binary_pixel_mask") return record;
        if (index === firstIncluded) {
          return { ...record, mask: { ...record.mask, fileName: "masks/collision.png" } };
        }
        if (index === secondIncluded) {
          return { ...record, mask: { ...record.mask, fileName: "masks/COLLISION.png" } };
        }
        return record;
      }),
    }).success).toBe(false);
  });

  it("retains the exact eight-interface requirement in the successor pack", () => {
    expect(GRAND_HALL_EXACT_INTERFACE_COUNT).toBe(8);
    expect(reviewPack().interfaceCandidates).toHaveLength(8);
  });
});

describe("Grand Hall combined accepted-scope v2 chain", () => {
  it("verifies the complete cycle-free review-to-boundary chain", () => {
    const chain = acceptedChain();
    expect(GrandHallAcceptedScopeChainV2Schema.safeParse(chain).success).toBe(true);
    expect(chain.closedVolumeReview.reviewState).toBe("human_accepted");
    expect(chain.closedBoundary.footprintXY).toEqual(chain.closedVolumeReview.footprintXY);
  });

  it("rejects a valid alternate interface inventory that does not equal the review pack", () => {
    const chain = acceptedChain();
    const interfaceDecisions = chain.humanDecisions.interfaceDecisions.map(
      (decision, index) => index === 0
        ? {
          ...decision,
          source: { ...decision.source, sharedSourceVertexSetSha256: digest(90_001) },
        }
        : decision,
    );
    const alternateDecisions = GrandHallT554HumanDecisionsV2Schema.parse({
      ...chain.humanDecisions,
      interfaceDecisions,
      sourceInterfaceInventorySha256: computeGrandHallInterfaceInventorySha256(
        interfaceDecisions.map((decision) => decision.source),
      ),
    });
    expect(GrandHallT554HumanDecisionsV2Schema.safeParse(alternateDecisions).success)
      .toBe(true);
    expect(GrandHallAcceptedScopeChainV2Schema.safeParse({
      ...chain,
      humanDecisions: alternateDecisions,
    }).success).toBe(false);
  });

  it("rejects a self-consistent membership artifact that contradicts human decisions", () => {
    const chain = acceptedChain();
    const first = chain.membership.panoramaRecords[0];
    if (first === undefined) throw new Error("missing membership fixture record");
    const membershipMaterial = GrandHallRoomMembershipV3MaterialSchema.parse({
      ...materialOf(chain.membership),
      includedFrameCount: chain.membership.includedFrameCount - 1,
      wholeFrameExclusionCount: chain.membership.wholeFrameExclusionCount + 1,
      panoramaRecords: chain.membership.panoramaRecords.map((record, index) => index === 0
        ? {
          ...record,
          decision: {
            disposition: "exclude_whole_frame",
            classification: "no_observed_grand_hall_pixels",
            maskRequired: false,
            generatedFillPermitted: false,
          },
        }
        : record),
    });
    const contradictoryMembership = GrandHallRoomMembershipV3Schema.parse({
      ...membershipMaterial,
      artifactSha256: computeGrandHallRoomMembershipV3Sha256(membershipMaterial),
    });
    const relinkedMaskMaterial = GrandHallPanoramaMaskSetV2MaterialSchema.parse({
      ...materialOf(chain.maskSet),
      membershipArtifactSha256: contradictoryMembership.artifactSha256,
    });
    const relinkedMask = GrandHallPanoramaMaskSetV2Schema.parse({
      ...relinkedMaskMaterial,
      artifactSha256: computeGrandHallPanoramaMaskSetV2Sha256(relinkedMaskMaterial),
    });
    expect(GrandHallRoomMembershipV3Schema.safeParse(contradictoryMembership).success)
      .toBe(true);
    expect(GrandHallAcceptedScopeChainV2Schema.safeParse({
      ...chain,
      membership: contradictoryMembership,
      maskSet: relinkedMask,
    }).success).toBe(false);
  });

  it("rejects a self-consistent mask artifact that contradicts reviewed mask evidence", () => {
    const chain = acceptedChain();
    const includedIndex = chain.maskSet.sourceRecords.findIndex(
      (record) => record.disposition === "include_with_binary_pixel_mask",
    );
    const maskMaterial = GrandHallPanoramaMaskSetV2MaterialSchema.parse({
      ...materialOf(chain.maskSet),
      sourceRecords: chain.maskSet.sourceRecords.map((record, index) =>
        index === includedIndex && record.disposition === "include_with_binary_pixel_mask"
          ? { ...record, mask: { ...record.mask, sha256: digest(91_001) } }
          : record
      ),
    });
    const contradictoryMask = GrandHallPanoramaMaskSetV2Schema.parse({
      ...maskMaterial,
      artifactSha256: computeGrandHallPanoramaMaskSetV2Sha256(maskMaterial),
    });
    expect(GrandHallPanoramaMaskSetV2Schema.safeParse(contradictoryMask).success).toBe(true);
    expect(GrandHallAcceptedScopeChainV2Schema.safeParse({
      ...chain,
      maskSet: contradictoryMask,
    }).success).toBe(false);
  });

  it("rejects portal or boundary artifacts that contradict accepted review evidence", () => {
    const chain = acceptedChain();
    const portalMaterial = GrandHallPortalDecisionsV1MaterialSchema.parse({
      ...materialOf(chain.portalDecisions),
      decisions: chain.portalDecisions.decisions.map((decision, index) => index === 0
        ? { ...decision, resolution: "close_at_reviewed_grand_hall_plane" }
        : decision),
    });
    const contradictoryPortals = GrandHallPortalDecisionsV1Schema.parse({
      ...portalMaterial,
      artifactSha256: computeGrandHallPortalDecisionsV1Sha256(portalMaterial),
    });
    expect(GrandHallAcceptedScopeChainV2Schema.safeParse({
      ...chain,
      portalDecisions: contradictoryPortals,
    }).success).toBe(false);

    const boundaryMaterial = GrandHallClosedBoundaryV1MaterialSchema.parse({
      ...materialOf(chain.closedBoundary),
      zMax: chain.closedBoundary.zMax + 1,
    });
    const contradictoryBoundary = GrandHallClosedBoundaryV1Schema.parse({
      ...boundaryMaterial,
      artifactSha256: computeGrandHallClosedBoundaryV1Sha256(boundaryMaterial),
    });
    expect(GrandHallAcceptedScopeChainV2Schema.safeParse({
      ...chain,
      closedBoundary: contradictoryBoundary,
    }).success).toBe(false);
  }, 15_000);
});

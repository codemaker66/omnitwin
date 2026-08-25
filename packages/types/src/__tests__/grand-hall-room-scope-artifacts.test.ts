import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_CLOSED_BOUNDARY_V1,
  GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
  GRAND_HALL_MATTERPAK_ROOM_KEY,
  GRAND_HALL_OUTPUT_INVENTORY_MASK_V1,
  GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_MASK_SET_V1,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_PORTAL_DECISIONS_V1,
  GRAND_HALL_ROOM_MEMBERSHIP_V2,
  GRAND_HALL_SCOPE_REVIEW_PACK_V1,
  GRAND_HALL_XGRIDS_SOURCE_FRAME,
  GRAND_HALL_XGRIDS_TO_MATTERPAK_E57_TRANSFORM_V1,
  GrandHallClosedBoundaryV1MaterialSchema,
  GrandHallClosedBoundaryV1Schema,
  GrandHallOutputInventoryMaskV1MaterialSchema,
  GrandHallOutputInventoryMaskV1Schema,
  GrandHallPanoramaMaskSetV1MaterialSchema,
  GrandHallPanoramaMaskSetV1Schema,
  GrandHallPanoramaDirectoryFileIdentitySchema,
  GrandHallPanoramaSourceJpgIdentitySchema,
  GrandHallInterfaceCandidateSchema,
  GrandHallPortalDecisionsV1MaterialSchema,
  GrandHallPortalDecisionsV1Schema,
  GrandHallReviewedTransformV1MaterialSchema,
  GrandHallReviewedTransformV1Schema,
  GrandHallRoomMembershipV2MaterialSchema,
  GrandHallRoomMembershipV2Schema,
  GrandHallScopeReviewPackMaterialV1Schema,
  GrandHallScopeReviewPackV1Schema,
  computeGrandHallClosedBoundaryV1Sha256,
  computeGrandHallInterfaceInventorySha256,
  computeGrandHallOutputInventoryMaskV1Sha256,
  computeGrandHallOutputSourceOrderingSha256,
  computeGrandHallPanoramaDirectoryInventorySha256,
  computeGrandHallPanoramaMaskSetV1Sha256,
  computeGrandHallPanoramaSourceInventorySha256,
  computeGrandHallPortalDecisionsV1Sha256,
  computeGrandHallReviewedTransformMatrixSha256,
  computeGrandHallReviewedTransformV1Sha256,
  computeGrandHallRoomMembershipV2Sha256,
  computeGrandHallScopeReviewPackV1Sha256,
} from "../grand-hall-room-scope-artifacts.js";

function receipt(seed: number): string {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

const humanReview = {
  state: "human_accepted" as const,
  reviewerId: "synthetic-authorized-reviewer",
  reviewerRole: "venue_owner_or_authorized_domain_reviewer" as const,
  reviewedAt: "2026-08-25T12:30:00.000Z",
  knowledgeBasis: ["synthetic exact source comparison"],
  agentDecisionAuthority: "none" as const,
};

function panoramaSources() {
  return Array.from({ length: 50 }, (_, scanIndex) =>
    GrandHallPanoramaSourceJpgIdentitySchema.parse({
    scanIndex,
    sweepNumber: scanIndex + 1,
    fileName: `sweep-${String(scanIndex + 1).padStart(3, "0")}.jpg`,
    sha256: receipt(scanIndex + 1),
    byteLength: 1_000 + scanIndex,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX as 8192,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX as 4096,
  }));
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
      adjacentSourceRoomKey: `matterpak:g${String(group).padStart(3, "0")}:s${String(submesh).padStart(3, "0")}`,
      sharedSourceVertexCount,
      sharedSourceVertexSetSha256: receipt(101 + index),
      boundsMeters: {
        min: [index * 2, 0, 0] as [number, number, number],
        max: [index * 2 + 1, 2, 3] as [number, number, number],
      },
    })
  );
}

function acceptedArtifacts() {
  const sources = panoramaSources();
  const interfaces = interfaceCandidates();
  const directoryFiles = [
    ...sources.map((source) => GrandHallPanoramaDirectoryFileIdentitySchema.parse({
      inventoryIndex: source.scanIndex,
      fileName: source.fileName,
      sha256: source.sha256,
      byteLength: source.byteLength,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
      t554Eligibility: "candidate_numeric_sweep_1_through_50",
      embeddedSweepNumber: source.sweepNumber,
      t554ReviewState: "human_pending",
      ineligibilityReason: null,
    })),
    ...Array.from(
      { length: GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT - sources.length },
      (_, offset) => {
        const inventoryIndex = sources.length + offset;
        return GrandHallPanoramaDirectoryFileIdentitySchema.parse({
          inventoryIndex,
          fileName: `other-sweep-${String(inventoryIndex + 1).padStart(3, "0")}.jpg`,
          sha256: receipt(inventoryIndex + 1),
          byteLength: 2_000 + inventoryIndex,
          widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
          heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
          t554Eligibility: "ineligible_unreviewed",
          embeddedSweepNumber: inventoryIndex + 1,
          t554ReviewState: "not_reviewed_in_t554",
          ineligibilityReason: "embedded_sweep_number_outside_1_through_50",
        });
      },
    ),
  ];
  const panoramaInventorySha256 = computeGrandHallPanoramaSourceInventorySha256(sources);
  const directoryInventorySha256 = computeGrandHallPanoramaDirectoryInventorySha256(
    directoryFiles,
  );
  const interfaceInventorySha256 = computeGrandHallInterfaceInventorySha256(interfaces);

  const reviewPackMaterial = GrandHallScopeReviewPackMaterialV1Schema.parse({
    schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V1 as typeof GRAND_HALL_SCOPE_REVIEW_PACK_V1,
    venueSlug: "trades-hall" as const,
    roomSlug: "grand-hall" as const,
    createdAt: "2026-08-25T12:00:00.000Z",
    createdBy: "synthetic-contract-test",
    authority: "none" as const,
    reviewState: "human_pending" as const,
    runtimeAuthorized: false as const,
    trainingAuthorized: false as const,
    generatedContentAuthorized: false as const,
    productionTrust: null,
    sourceEvidence: {
      t550PendingMembershipV1Sha256: receipt(110),
      t551SourceEvidenceSha256: receipt(111),
      t551SourceReceiptSha256: receipt(112),
      xgridsSourceReceiptSha256: receipt(113),
      matterPakE57SourceReceiptSha256: receipt(114),
      panoramaDirectoryInventorySha256: directoryInventorySha256,
      boundaryReviewManifestSha256: receipt(115),
      panoramaReviewManifestSha256: receipt(116),
    },
    panoramaDirectoryFiles: directoryFiles,
    candidatePanoramaSources: sources,
    panoramaSourceInventorySha256: panoramaInventorySha256,
    interfaceCandidates: interfaces,
    interfaceInventorySha256,
    proposalArtifacts: {
      roomMembership: {
        state: "source_candidate_present_human_pending",
        artifactSha256: receipt(110),
      },
      portalDecisions: {
        state: "not_authored_human_pending",
        artifactSha256: null,
      },
      closedSelectionVolume: {
        state: "not_authored_human_pending",
        artifactSha256: null,
      },
      panoramaMaskSet: {
        state: "not_authored_human_pending",
        artifactSha256: null,
      },
    },
    deferredArtifacts: {
      reviewedTransform: {
        state: "not_available_deferred_to_t557",
        proposalSha256: null,
        artifactSha256: null,
        humanDecisionRequested: false,
      },
      outputInventoryMask: {
        state: "not_available_deferred_to_t557",
        proposalSha256: null,
        artifactSha256: null,
        humanDecisionRequested: false,
      },
    },
    requiredHumanDecisions: [
      "accept_or_reject_room_membership",
      "resolve_every_interface",
      "accept_or_reject_closed_selection_volume",
      "accept_or_reject_every_panorama_mask",
    ] as const,
  });
  const reviewPack = GrandHallScopeReviewPackV1Schema.parse({
    ...reviewPackMaterial,
    artifactSha256: computeGrandHallScopeReviewPackV1Sha256(reviewPackMaterial),
  });

  const membershipMaterial = GrandHallRoomMembershipV2MaterialSchema.parse({
    schemaVersion: GRAND_HALL_ROOM_MEMBERSHIP_V2 as typeof GRAND_HALL_ROOM_MEMBERSHIP_V2,
    venueSlug: "trades-hall" as const,
    roomSlug: "grand-hall" as const,
    authority: "human_accepted" as const,
    productionTrust: null,
    reviewPackSha256: reviewPack.artifactSha256,
    sourceMembershipV1Sha256: receipt(110),
    sourceBoundaryEvidenceSha256: receipt(111),
    sourcePanoramaInventorySha256: panoramaInventorySha256,
    matterPakRoomMembership: {
      includedRoomKeys: [GRAND_HALL_MATTERPAK_ROOM_KEY] as const,
      neighbouringRoomGeometryIncluded: false as const,
      facadeGeometryIncluded: false as const,
    },
    cameraRecords: sources.map((source) => {
      if (source.scanIndex === 18 || source.scanIndex === 49) {
        return {
          source,
          decision: {
            disposition: "exclude_whole_frame" as const,
            classification: "adjacent_room_or_outside_grand_hall" as const,
            maskRequired: false as const,
            generatedFillPermitted: false as const,
          },
          decisionEvidenceSha256: receipt(200 + source.scanIndex),
        };
      }
      return {
        source,
        decision: {
          disposition: "include_with_binary_pixel_mask" as const,
          classification: source.scanIndex === 0 || source.scanIndex === 17 || source.scanIndex === 48
            ? "grand_hall_portal_threshold" as const
            : "grand_hall_core" as const,
          maskRequired: true as const,
          generatedFillPermitted: false as const,
        },
        decisionEvidenceSha256: receipt(200 + source.scanIndex),
      };
    }),
    acceptedUnknownPixelDisposition: "transparent_or_unknown_never_filled" as const,
    humanReview,
  });
  const membership = GrandHallRoomMembershipV2Schema.parse({
    ...membershipMaterial,
    artifactSha256: computeGrandHallRoomMembershipV2Sha256(membershipMaterial),
  });

  const portalMaterial = GrandHallPortalDecisionsV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_PORTAL_DECISIONS_V1 as typeof GRAND_HALL_PORTAL_DECISIONS_V1,
    venueSlug: "trades-hall" as const,
    roomSlug: "grand-hall" as const,
    authority: "human_accepted" as const,
    productionTrust: null,
    reviewPackSha256: reviewPack.artifactSha256,
    sourceBoundaryEvidenceSha256: receipt(111),
    interfaceInventorySha256,
    interfaceCount: interfaces.length,
    interfaceCandidates: interfaces,
    decisions: interfaces.map((candidate, index) => ({
      interfaceId: candidate.interfaceId,
      resolution: index === 0
        ? "close_at_reviewed_grand_hall_plane" as const
        : "exclude_beyond_interface" as const,
      grandHallSideEvidenceSha256: receipt(300 + index),
      decisionNote: `Synthetic resolution ${String(index)}`,
    })),
    allInterfacesResolved: true as const,
    humanReview,
  });
  const portal = GrandHallPortalDecisionsV1Schema.parse({
    ...portalMaterial,
    artifactSha256: computeGrandHallPortalDecisionsV1Sha256(portalMaterial),
  });

  const boundaryMaterial = GrandHallClosedBoundaryV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_CLOSED_BOUNDARY_V1 as typeof GRAND_HALL_CLOSED_BOUNDARY_V1,
    venueSlug: "trades-hall" as const,
    roomSlug: "grand-hall" as const,
    authority: "human_accepted" as const,
    productionTrust: null,
    reviewPackSha256: reviewPack.artifactSha256,
    roomMembershipArtifactSha256: membership.artifactSha256,
    portalDecisionArtifactSha256: portal.artifactSha256,
    portalInterfaceInventorySha256: interfaceInventorySha256,
    portalInterfaceIds: interfaces.map((candidate) => candidate.interfaceId),
    sourceFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME as typeof GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
    units: "meters" as const,
    geometryRole: "non_rendered_selection_volume" as const,
    construction: "extruded_simple_xy_polygon" as const,
    nonConvex: true as const,
    footprintXY: [[0, 0], [8, 0], [8, 5], [5, 5], [5, 3], [3, 3], [3, 5], [0, 5]],
    zMin: -0.25,
    zMax: 8,
    pointOnBoundaryPolicy: "include_as_inside" as const,
    closedVolume: true as const,
    cameraMembershipOnly: false as const,
    rendered: false as const,
    collisionGeometry: false as const,
    exportedAsArchitecture: false as const,
    generatedGeometryCreated: false as const,
    semanticRefinements: interfaces.map((candidate, index) => ({
      interfaceId: candidate.interfaceId,
      operation: index === 0
        ? "retain_grand_hall_side" as const
        : "exclude_beyond_interface" as const,
      evidenceSha256: receipt(320 + index),
      applied: true as const,
      generatedGeometryCreated: false as const,
    })),
    humanReview,
  });
  const boundary = GrandHallClosedBoundaryV1Schema.parse({
    ...boundaryMaterial,
    artifactSha256: computeGrandHallClosedBoundaryV1Sha256(boundaryMaterial),
  });

  const sourceRecords = sources.map((source) => {
    if (source.scanIndex === 18 || source.scanIndex === 49) {
      return {
        source,
        disposition: "exclude_whole_frame" as const,
        mask: null,
        wholeFrameExclusionReason: "adjacent_room_or_outside_grand_hall" as const,
      };
    }
    return {
      source,
      disposition: "include_with_binary_pixel_mask" as const,
      mask: {
        fileName: `mask-${String(source.scanIndex).padStart(3, "0")}.png`,
        sha256: receipt(400 + source.scanIndex),
        byteLength: 500 + source.scanIndex,
        sourceJpgFileName: source.fileName,
        sourceJpgSha256: source.sha256,
        widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
        heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
        encoding: "png_grayscale8_binary_v1" as const,
        coordinateSpace: "original_8192x4096_equirectangular_pixel_grid" as const,
        bitDepth: 8 as const,
        channelCount: 1 as const,
        permittedPixelValues: [0, 255] as const,
        includedValue: 0 as const,
        excludedValue: 255 as const,
        includedPixelCount: GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX - 1,
        excludedPixelCount: 1,
        alphaChannelPresent: false as const,
        colourProfilePresent: false as const,
        exifOrientationPresent: false as const,
        resampled: false as const,
        reasonCodes: ["unverified_or_unknown_pixels" as const],
      },
      wholeFrameExclusionReason: null,
    };
  });
  const panoramaMaskSetMaterial = GrandHallPanoramaMaskSetV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_PANORAMA_MASK_SET_V1 as typeof GRAND_HALL_PANORAMA_MASK_SET_V1,
    venueSlug: "trades-hall" as const,
    roomSlug: "grand-hall" as const,
    authority: "human_accepted" as const,
    productionTrust: null,
    reviewPackSha256: reviewPack.artifactSha256,
    membershipArtifactSha256: membership.artifactSha256,
    portalDecisionArtifactSha256: portal.artifactSha256,
    sourcePanoramaInventorySha256: panoramaInventorySha256,
    sourceRecordCount: 50 as const,
    maskCount: 48,
    wholeFrameExclusionCount: 2,
    sourceRecords,
    unknownPixelDisposition: "transparent_or_unknown_never_filled" as const,
    generatedFillPermitted: false as const,
    humanReview,
  });
  const panoramaMaskSet = GrandHallPanoramaMaskSetV1Schema.parse({
    ...panoramaMaskSetMaterial,
    artifactSha256: computeGrandHallPanoramaMaskSetV1Sha256(panoramaMaskSetMaterial),
  });

  const matrix = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ] as const;
  const landmarks = [
    { id: "landmark-a", point: [0, 0, 0] as const },
    { id: "landmark-b", point: [2, 0, 0] as const },
    { id: "landmark-c", point: [0, 3, 1] as const },
  ].map((item, index) => ({
    id: item.id,
    label: `Synthetic landmark ${String(index)}`,
    source: item.point,
    target: item.point,
    residualM: 0,
    provenanceRefs: [{
      refType: "artifact" as const,
      ref: receipt(600 + index),
      role: "measured-landmark",
    }],
  }));
  const transformMaterial = GrandHallReviewedTransformV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_XGRIDS_TO_MATTERPAK_E57_TRANSFORM_V1 as typeof GRAND_HALL_XGRIDS_TO_MATTERPAK_E57_TRANSFORM_V1,
    venueSlug: "trades-hall" as const,
    roomSlug: "grand-hall" as const,
    authority: "human_accepted" as const,
    productionTrust: null,
    scopeReviewPackSha256: reviewPack.artifactSha256,
    sourceXgridsReceiptSha256: receipt(113),
    sourceXgridsOutputInventorySha256: receipt(510),
    targetMatterPakE57ReceiptSha256: receipt(114),
    targetBoundaryEvidenceSha256: receipt(111),
    transformArtifact: {
      id: "grand-hall-xgrids-arf-to-cvf",
      sourceFrame: "ARF",
      targetFrame: "CVF",
      units: "meters",
      matrix: [...matrix],
      alignmentMethod: "landmark_solve",
      residualRmseM: 0,
      landmarks,
      provenance: {
        state: "measured",
        refs: [
          {
            refType: "artifact",
            ref: receipt(113),
            role: "source_xgrids_receipt",
          },
          {
            refType: "artifact",
            ref: receipt(510),
            role: "source_xgrids_output_inventory",
          },
          {
            refType: "artifact",
            ref: receipt(114),
            role: "target_matterpak_e57_receipt",
          },
          {
            refType: "artifact",
            ref: receipt(111),
            role: "target_boundary_evidence",
          },
        ],
      },
      creator: {
        actorType: "tool",
        id: "synthetic-transform-solver",
      },
      reviewer: {
        actorType: "human",
        id: humanReview.reviewerId,
        role: "venue-domain-reviewer",
      },
      date: humanReview.reviewedAt,
    },
    matrixSha256: computeGrandHallReviewedTransformMatrixSha256(matrix),
    independentOverlayReviewCompleted: true as const,
    humanReview,
  });
  const transform = GrandHallReviewedTransformV1Schema.parse({
    ...transformMaterial,
    artifactSha256: computeGrandHallReviewedTransformV1Sha256(transformMaterial),
  });

  const sourceMembers = [
    {
      memberIndex: 0,
      fileName: "creator-data/member-000.lcc",
      sha256: receipt(520),
      byteLength: 1_000,
      firstRecordIndex: 0,
      recordCount: 40,
    },
    {
      memberIndex: 1,
      fileName: "creator-data/member-001.lcc",
      sha256: receipt(521),
      byteLength: 2_000,
      firstRecordIndex: 40,
      recordCount: 60,
    },
  ];
  const outputMaskMaterial = GrandHallOutputInventoryMaskV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_OUTPUT_INVENTORY_MASK_V1 as typeof GRAND_HALL_OUTPUT_INVENTORY_MASK_V1,
    venueSlug: "trades-hall" as const,
    roomSlug: "grand-hall" as const,
    authority: "human_accepted" as const,
    productionTrust: null,
    scopeReviewPackSha256: reviewPack.artifactSha256,
    sourceFrame: GRAND_HALL_XGRIDS_SOURCE_FRAME as typeof GRAND_HALL_XGRIDS_SOURCE_FRAME,
    classificationFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME as typeof GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
    recordKind: "gaussian" as const,
    xgridsSourceReceiptSha256: receipt(113),
    xgridsOutputInventorySha256: receipt(510),
    sourceOrderingSha256: computeGrandHallOutputSourceOrderingSha256(
      GRAND_HALL_XGRIDS_SOURCE_FRAME,
      sourceMembers,
    ),
    transformArtifactSha256: transform.artifactSha256,
    closedBoundaryArtifactSha256: boundary.artifactSha256,
    sourceMembers,
    totalRecordCount: 100,
    includedRecordCount: 100,
    excludedRecordCount: 0,
    encoding: "ordered_source_record_membership_bitset_v1" as const,
    bitOrder: "least_significant_bit_first_within_each_byte" as const,
    includedBitValue: 1 as const,
    excludedBitValue: 0 as const,
    bitsetFileName: "grand-hall-output-membership.bin",
    bitsetSha256: receipt(530),
    bitsetByteLength: 13,
    trailingPaddingBitCount: 4,
    trailingPaddingBitsZero: true as const,
    humanReview,
  });
  const outputMask = GrandHallOutputInventoryMaskV1Schema.parse({
    ...outputMaskMaterial,
    artifactSha256: computeGrandHallOutputInventoryMaskV1Sha256(outputMaskMaterial),
  });

  return {
    reviewPack,
    membership,
    membershipMaterial,
    portal,
    portalMaterial,
    boundary,
    boundaryMaterial,
    panoramaMaskSet,
    panoramaMaskSetMaterial,
    transform,
    outputMask,
    outputMaskMaterial,
  };
}

describe("Grand Hall T-554 artifact contracts", () => {
  it("keeps the review pack authority-none and validates all synthetic accepted artifacts", () => {
    const artifacts = acceptedArtifacts();

    expect(artifacts.reviewPack).toMatchObject({
      authority: "none",
      reviewState: "human_pending",
      runtimeAuthorized: false,
      productionTrust: null,
      deferredArtifacts: {
        reviewedTransform: {
          state: "not_available_deferred_to_t557",
          proposalSha256: null,
          humanDecisionRequested: false,
        },
        outputInventoryMask: {
          state: "not_available_deferred_to_t557",
          proposalSha256: null,
          humanDecisionRequested: false,
        },
      },
    });
    expect(artifacts.reviewPack.panoramaDirectoryFiles).toHaveLength(148);
    expect(artifacts.reviewPack.panoramaDirectoryFiles.filter(
      (file) => file.t554Eligibility === "candidate_numeric_sweep_1_through_50",
    )).toHaveLength(50);
    expect(artifacts.reviewPack.panoramaDirectoryFiles.filter(
      (file) => file.t554Eligibility === "ineligible_unreviewed",
    )).toHaveLength(98);
    expect(GrandHallRoomMembershipV2Schema.safeParse(artifacts.membership).success).toBe(true);
    expect(GrandHallPortalDecisionsV1Schema.safeParse(artifacts.portal).success).toBe(true);
    expect(GrandHallClosedBoundaryV1Schema.safeParse(artifacts.boundary).success).toBe(true);
    expect(GrandHallPanoramaMaskSetV1Schema.safeParse(artifacts.panoramaMaskSet).success).toBe(true);
    expect(GrandHallReviewedTransformV1Schema.safeParse(artifacts.transform).success).toBe(true);
    expect(GrandHallOutputInventoryMaskV1Schema.safeParse(artifacts.outputMask).success).toBe(true);
  });

  it("rejects digest drift after an accepted decision changes", () => {
    const { membership } = acceptedArtifacts();

    expect(GrandHallRoomMembershipV2Schema.safeParse({
      ...membership,
      humanReview: { ...membership.humanReview, reviewerId: "substituted-reviewer" },
    }).success).toBe(false);
  });

  it("rejects an omitted interface and an unresolved portal decision", () => {
    const { portalMaterial } = acceptedArtifacts();

    expect(GrandHallPortalDecisionsV1MaterialSchema.safeParse({
      ...portalMaterial,
      decisions: portalMaterial.decisions.slice(0, 1),
    }).success).toBe(false);
    expect(GrandHallPortalDecisionsV1MaterialSchema.safeParse({
      ...portalMaterial,
      decisions: portalMaterial.decisions.map((decision, index) =>
        index === 0 ? { ...decision, resolution: "pending" } : decision),
    }).success).toBe(false);
  });

  it("rejects a self-intersecting footprint and zero-volume extrusion", () => {
    const { boundaryMaterial } = acceptedArtifacts();

    expect(GrandHallClosedBoundaryV1MaterialSchema.safeParse({
      ...boundaryMaterial,
      footprintXY: [[0, 0], [3, 3], [0, 4], [4, 0]],
    }).success).toBe(false);
    expect(GrandHallClosedBoundaryV1MaterialSchema.safeParse({
      ...boundaryMaterial,
      zMax: boundaryMaterial.zMin,
    }).success).toBe(false);
  });

  it("requires canonical CCW winding and exact portal-refinement IDs", () => {
    const { boundaryMaterial } = acceptedArtifacts();

    expect(GrandHallClosedBoundaryV1MaterialSchema.safeParse({
      ...boundaryMaterial,
      footprintXY: [...boundaryMaterial.footprintXY].reverse(),
    }).success).toBe(false);
    expect(GrandHallClosedBoundaryV1MaterialSchema.safeParse({
      ...boundaryMaterial,
      footprintXY: [[0, 0], [8, 0], [8, 5], [0, 5]],
    }).success).toBe(false);
    expect(GrandHallClosedBoundaryV1MaterialSchema.safeParse({
      ...boundaryMaterial,
      semanticRefinements: boundaryMaterial.semanticRefinements.slice(0, 1),
    }).success).toBe(false);
  });

  it("allows an all-zero reviewed mask without fabricating an exclusion reason", () => {
    const { panoramaMaskSetMaterial } = acceptedArtifacts();
    const mutatedRecords: Array<(typeof panoramaMaskSetMaterial.sourceRecords)[number]> =
      panoramaMaskSetMaterial.sourceRecords.map((record) => {
        if (record.disposition !== "include_with_binary_pixel_mask") return record;
        return {
          ...record,
          mask: {
            ...record.mask,
            includedPixelCount: GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX,
            excludedPixelCount: 0,
            reasonCodes: [],
          },
        };
      });

    expect(GrandHallPanoramaMaskSetV1MaterialSchema.safeParse({
      ...panoramaMaskSetMaterial,
      sourceRecords: mutatedRecords,
    }).success).toBe(true);
    const firstIncludedIndex = panoramaMaskSetMaterial.sourceRecords.findIndex(
      (record) => record.disposition === "include_with_binary_pixel_mask",
    );
    const inconsistentRecords = [...mutatedRecords];
    const firstIncluded = inconsistentRecords[firstIncludedIndex];
    if (firstIncluded?.disposition !== "include_with_binary_pixel_mask") {
      throw new Error("Expected an included synthetic panorama.");
    }
    inconsistentRecords[firstIncludedIndex] = {
      ...firstIncluded,
      mask: {
        ...firstIncluded.mask,
        reasonCodes: ["unverified_or_unknown_pixels"],
      },
    };
    expect(GrandHallPanoramaMaskSetV1MaterialSchema.safeParse({
      ...panoramaMaskSetMaterial,
      sourceRecords: inconsistentRecords,
    }).success).toBe(false);
  });

  it("allows human review to include all 50 source frames", () => {
    const { membershipMaterial, panoramaMaskSetMaterial } = acceptedArtifacts();
    const allIncludedMembership = membershipMaterial.cameraRecords.map((record) => ({
      ...record,
      decision: {
        disposition: "include_with_binary_pixel_mask" as const,
        classification: "grand_hall_core" as const,
        maskRequired: true as const,
        generatedFillPermitted: false as const,
      },
    }));
    const allIncludedMasks = panoramaMaskSetMaterial.sourceRecords.map((record, index) => {
      if (record.disposition === "include_with_binary_pixel_mask") return record;
      return {
        source: record.source,
        disposition: "include_with_binary_pixel_mask" as const,
        mask: {
          fileName: `masks/scan-${String(index).padStart(3, "0")}.png`,
          sha256: receipt(900 + index),
          byteLength: 1_000 + index,
          sourceJpgFileName: record.source.fileName,
          sourceJpgSha256: record.source.sha256,
          widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
          heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
          encoding: "png_grayscale8_binary_v1" as const,
          coordinateSpace: "original_8192x4096_equirectangular_pixel_grid" as const,
          bitDepth: 8 as const,
          channelCount: 1 as const,
          permittedPixelValues: [0, 255] as const,
          includedValue: 0 as const,
          excludedValue: 255 as const,
          includedPixelCount: GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX,
          excludedPixelCount: 0,
          alphaChannelPresent: false as const,
          colourProfilePresent: false as const,
          exifOrientationPresent: false as const,
          resampled: false as const,
          reasonCodes: [],
        },
        wholeFrameExclusionReason: null,
      };
    });

    expect(GrandHallRoomMembershipV2MaterialSchema.safeParse({
      ...membershipMaterial,
      cameraRecords: allIncludedMembership,
    }).success).toBe(true);
    expect(GrandHallPanoramaMaskSetV1MaterialSchema.safeParse({
      ...panoramaMaskSetMaterial,
      maskCount: 50,
      wholeFrameExclusionCount: 0,
      sourceRecords: allIncludedMasks,
    }).success).toBe(true);
  });

  it("rejects the wrong output source frame, source order, and transform binding", () => {
    const { outputMaskMaterial } = acceptedArtifacts();

    expect(GrandHallOutputInventoryMaskV1MaterialSchema.safeParse({
      ...outputMaskMaterial,
      sourceFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
    }).success).toBe(false);
    expect(GrandHallOutputInventoryMaskV1MaterialSchema.safeParse({
      ...outputMaskMaterial,
      sourceMembers: [...outputMaskMaterial.sourceMembers].reverse(),
    }).success).toBe(false);
    expect(GrandHallOutputInventoryMaskV1MaterialSchema.safeParse({
      ...outputMaskMaterial,
      transformArtifactSha256: "not-a-sha256-transform",
    }).success).toBe(false);
  });

  it("rejects generated or source-unbound reviewed transforms", () => {
    const { transform } = acceptedArtifacts();

    expect(GrandHallReviewedTransformV1Schema.safeParse({
      ...transform,
      transformArtifact: {
        ...transform.transformArtifact,
        provenance: {
          ...transform.transformArtifact.provenance,
          state: "generated",
        },
      },
    }).success).toBe(false);
    expect(GrandHallReviewedTransformV1Schema.safeParse({
      ...transform,
      transformArtifact: {
        ...transform.transformArtifact,
        provenance: {
          ...transform.transformArtifact.provenance,
          refs: transform.transformArtifact.provenance.refs.slice(1),
        },
      },
    }).success).toBe(false);
  });

  it("rejects coincident or collinear transform control geometry", () => {
    const { transform } = acceptedArtifacts();
    const { artifactSha256: _artifactSha256, ...material } = transform;
    const coincidentLandmarks = material.transformArtifact.landmarks.map((landmark) => ({
      ...landmark,
      source: [0, 0, 0] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
      residualM: 0,
    }));
    const collinearLandmarks = material.transformArtifact.landmarks.map((landmark, index) => ({
      ...landmark,
      source: [index, index, index] as [number, number, number],
      target: [index * 2, index * 2, index * 2] as [number, number, number],
      residualM: 0,
    }));

    expect(GrandHallReviewedTransformV1MaterialSchema.safeParse({
      ...material,
      transformArtifact: {
        ...material.transformArtifact,
        landmarks: coincidentLandmarks,
      },
    }).success).toBe(false);
    expect(GrandHallReviewedTransformV1MaterialSchema.safeParse({
      ...material,
      transformArtifact: {
        ...material.transformArtifact,
        landmarks: collinearLandmarks,
      },
    }).success).toBe(false);
  });
});

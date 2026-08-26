import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_PENDING_ROOM_MEMBERSHIP_V1_SHA256,
  GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES,
  GRAND_HALL_ROOM_ONLY_MAX_MEMBER_COUNT,
  GRAND_HALL_ROOM_ONLY_MAX_MEMBER_GAUSSIAN_COUNT,
  GRAND_HALL_ROOM_ONLY_MAX_TOTAL_BYTES,
  GRAND_HALL_ROOM_ONLY_MAX_TOTAL_GAUSSIAN_COUNT,
  GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema,
  GrandHallRoomOnlyRuntimeEvidenceV2Schema,
  GrandHallRoomOnlyVisualMemberV2Schema,
  computeGrandHallRoomOnlyRuntimeEvidenceV2Sha256,
  computeGrandHallRoomOnlyVisualMemberSetSha256,
  grandHallRoomOnlyEvidenceMatchesVisualMembers,
  type GrandHallRoomOnlyRuntimeEvidenceV2,
} from "../grand-hall-room-only-runtime-evidence.js";

const hash = (character: string): string => character.repeat(64);
const receipt = (character: string): string => `sha256:${hash(character)}`;
const LEGACY_FRONTIER_RECEIPT_SHA256 =
  "sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352";
const RAW_XGRIDS_PROJECT_RECEIPT_SHA256 =
  "sha256:dc2259089043ae4a1d95663f251d4bd94699124cd49baa3b8958a0d668389b8a";

function acceptedEvidence(): GrandHallRoomOnlyRuntimeEvidenceV2 {
  const members = [
    {
      fileName: "synthetic-room-only-0.sog",
      fileExt: ".sog" as const,
      sha256: hash("a"),
      sizeBytes: 1_024,
      gaussianCount: 41,
    },
    {
      fileName: "synthetic-room-only-1.sog",
      fileExt: ".sog" as const,
      sha256: hash("b"),
      sizeBytes: 2_048,
      gaussianCount: 59,
    },
  ];
  const material = GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.parse({
    schemaVersion: "venviewer.grand-hall-room-only-runtime-evidence.v2",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    createdAt: "2026-08-25T12:00:00.000Z",
    createdBy: "synthetic-test-fixture",
    productionTrust: null,
    sourceFrontierReceiptSha256: LEGACY_FRONTIER_RECEIPT_SHA256,
    acceptedScope: {
      membershipArtifact: {
        schemaVersion: "omnitwin.foundry.grand-hall-room-membership.v2",
        sha256: receipt("2"),
        byteLength: 101,
        state: "human_accepted",
        productionTrust: null,
        reviewPackSha256: receipt("8"),
        sourcePanoramaInventorySha256: receipt("9"),
        panoramaRecordCount: 50,
        geometricCameraAuthority: "none",
      },
      closedBoundaryArtifact: {
        schemaVersion: "venviewer.grand-hall-closed-room-boundary.v1",
        sha256: receipt("3"),
        byteLength: 102,
        state: "human_accepted_closed_volume",
        productionTrust: null,
        reviewPackSha256: receipt("8"),
        roomMembershipArtifactSha256: receipt("2"),
        portalDecisionArtifactSha256: receipt("4"),
        portalInterfaceInventorySha256: receipt("a"),
        sourceFrame: "CVF",
        geometryRole: "non_rendered_selection_volume",
        construction: "extruded_simple_xy_polygon",
        nonConvex: true,
        pointOnBoundaryPolicy: "include_as_inside",
        closedVolume: true,
        cameraMembershipOnly: false,
      },
      portalDecisionArtifact: {
        schemaVersion: "venviewer.grand-hall-portal-decision.v1",
        sha256: receipt("4"),
        byteLength: 103,
        state: "human_accepted_all_interfaces_resolved",
        productionTrust: null,
        reviewPackSha256: receipt("8"),
        interfaceInventorySha256: receipt("a"),
        interfaceCount: 8,
        allInterfacesResolved: true,
      },
      panoramaMaskSetArtifact: {
        schemaVersion: "venviewer.grand-hall-panorama-mask-set.v1",
        sha256: receipt("5"),
        byteLength: 104,
        state: "human_accepted_complete",
        productionTrust: null,
        reviewPackSha256: receipt("8"),
        membershipArtifactSha256: receipt("2"),
        portalDecisionArtifactSha256: receipt("4"),
        sourcePanoramaInventorySha256: receipt("9"),
        geometricCameraAuthority: "none",
        sourceRecordCount: 50,
        maskCount: 48,
        wholeFrameExclusionCount: 2,
        encoding: "png_grayscale8_binary_v1",
        coordinateSpace: "original_8192x4096_equirectangular_pixel_grid",
        excludedValue: 255,
      },
      reviewedTransformArtifact: {
        schemaVersion: "venviewer.grand-hall-xgrids-to-matterpak-e57-transform.v1",
        sha256: receipt("6"),
        byteLength: 105,
        state: "human_accepted_reviewed_transform",
        productionTrust: null,
        scopeReviewPackSha256: receipt("8"),
        transformArtifactId: "grand-hall-xgrids-arf-to-cvf",
        sourceFrame: "ARF",
        targetFrame: "CVF",
        alignmentMethod: "landmark_solve",
        sourceXgridsReceiptSha256: RAW_XGRIDS_PROJECT_RECEIPT_SHA256,
        sourceXgridsOutputInventorySha256: receipt("b"),
        targetMatterPakE57ReceiptSha256: receipt("c"),
        targetBoundaryEvidenceSha256: receipt("d"),
        matrixSha256: receipt("e"),
        landmarkCount: 3,
      },
      outputInventoryMaskArtifact: {
        schemaVersion: "venviewer.grand-hall-output-inventory-mask.v1",
        sha256: receipt("7"),
        byteLength: 106,
        state: "human_accepted_complete",
        productionTrust: null,
        scopeReviewPackSha256: receipt("8"),
        sourceFrame: "ARF",
        classificationFrame: "CVF",
        recordKind: "gaussian",
        xgridsSourceReceiptSha256: RAW_XGRIDS_PROJECT_RECEIPT_SHA256,
        xgridsOutputInventorySha256: receipt("b"),
        sourceOrderingSha256: receipt("f"),
        transformArtifactSha256: receipt("6"),
        closedBoundaryArtifactSha256: receipt("3"),
        totalRecordCount: 120,
        includedRecordCount: 100,
        excludedRecordCount: 20,
        encoding: "ordered_source_record_membership_bitset_v1",
        bitsetSha256: receipt("0"),
        bitsetByteLength: 15,
      },
    },
    humanReview: {
      state: "accepted",
      reviewerId: "synthetic-reviewer",
      reviewedAt: "2026-08-25T12:30:00.000Z",
    },
    runtimePolicy: {
      runtimeAuthorized: true,
      generatedFillPermitted: false,
      proceduralPixelReplacementPermitted: false,
      synthesizedPixelReplacementPermitted: false,
      panoStageNadirCrownPermitted: false,
      neighbouringRoomPixelsPermitted: false,
      facadeAssetsPermitted: false,
      maskedOrUnknownPixelDisposition: "remain_transparent_or_unknown_never_filled",
    },
    croppedVisual: {
      derivation: "accepted_closed_boundary_reviewed_transform_and_output_inventory_mask_applied_v2",
      memberSetSha256: computeGrandHallRoomOnlyVisualMemberSetSha256(members),
      memberCount: members.length,
      totalBytes: members.reduce((total, member) => total + member.sizeBytes, 0),
      totalGaussianCount: members.reduce(
        (total, member) => total + member.gaussianCount,
        0,
      ),
      members,
    },
  });
  return GrandHallRoomOnlyRuntimeEvidenceV2Schema.parse({
    ...material,
    evidenceSha256: computeGrandHallRoomOnlyRuntimeEvidenceV2Sha256(material),
  });
}

describe("Grand Hall room-only runtime evidence v2", () => {
  it("binds a synthetic accepted closed boundary, every portal, masks, and cropped output", () => {
    const evidence = acceptedEvidence();

    expect(evidence.acceptedScope.closedBoundaryArtifact).toMatchObject({
      state: "human_accepted_closed_volume",
      closedVolume: true,
      cameraMembershipOnly: false,
    });
    expect(evidence.acceptedScope.portalDecisionArtifact).toMatchObject({
      interfaceCount: 8,
      allInterfacesResolved: true,
    });
    expect(grandHallRoomOnlyEvidenceMatchesVisualMembers(
      evidence,
      evidence.croppedVisual.members,
    )).toBe(true);
  });

  it("preserves distinct legacy-frontier and raw-XGRIDS lineage identities", () => {
    const evidence = acceptedEvidence();

    expect(evidence.sourceFrontierReceiptSha256).toBe(LEGACY_FRONTIER_RECEIPT_SHA256);
    expect(evidence.acceptedScope.reviewedTransformArtifact.sourceXgridsReceiptSha256).toBe(
      RAW_XGRIDS_PROJECT_RECEIPT_SHA256,
    );
    expect(evidence.acceptedScope.outputInventoryMaskArtifact.xgridsSourceReceiptSha256).toBe(
      RAW_XGRIDS_PROJECT_RECEIPT_SHA256,
    );
    expect(evidence.sourceFrontierReceiptSha256).not.toBe(
      evidence.acceptedScope.reviewedTransformArtifact.sourceXgridsReceiptSha256,
    );
  });

  it("rejects only a real transform-to-output-mask XGRIDS receipt mismatch", () => {
    const evidence = acceptedEvidence();
    const { evidenceSha256: _evidenceSha256, ...material } = evidence;

    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse({
      ...material,
      acceptedScope: {
        ...material.acceptedScope,
        outputInventoryMaskArtifact: {
          ...material.acceptedScope.outputInventoryMaskArtifact,
          xgridsSourceReceiptSha256: receipt("f"),
        },
      },
    }).success).toBe(false);
  });

  it("does not upgrade the known human-pending v1 membership artifact", () => {
    const evidence = acceptedEvidence();
    const { evidenceSha256: _evidenceSha256, ...material } = evidence;

    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse({
      ...material,
      acceptedScope: {
        ...material.acceptedScope,
        membershipArtifact: {
          ...material.acceptedScope.membershipArtifact,
          sha256: GRAND_HALL_PENDING_ROOM_MEMBERSHIP_V1_SHA256,
        },
      },
    }).success).toBe(false);
  });

  it("rejects incomplete interface, panorama, and output-bitset summaries", () => {
    const evidence = acceptedEvidence();
    const { evidenceSha256: _evidenceSha256, ...material } = evidence;

    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse({
      ...material,
      acceptedScope: {
        ...material.acceptedScope,
        portalDecisionArtifact: {
          ...material.acceptedScope.portalDecisionArtifact,
          interfaceCount: 2,
        },
      },
    }).success).toBe(false);
    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse({
      ...material,
      acceptedScope: {
        ...material.acceptedScope,
        panoramaMaskSetArtifact: {
          ...material.acceptedScope.panoramaMaskSetArtifact,
          maskCount: 47,
        },
      },
    }).success).toBe(false);
    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse({
      ...material,
      acceptedScope: {
        ...material.acceptedScope,
        outputInventoryMaskArtifact: {
          ...material.acceptedScope.outputInventoryMaskArtifact,
          bitsetByteLength: material.acceptedScope.outputInventoryMaskArtifact.bitsetByteLength - 1,
        },
      },
    }).success).toBe(false);
  });

  it("rejects the old five-artifact summary-only acceptedScope shape", () => {
    const evidence = acceptedEvidence();
    const { evidenceSha256: _evidenceSha256, ...material } = evidence;
    const legacyScope = {
      membershipArtifact: {
        schemaVersion: "omnitwin.foundry.grand-hall-room-membership.v2",
        sha256: receipt("2"),
        byteLength: 101,
        state: "human_accepted",
      },
      closedBoundaryArtifact: {
        schemaVersion: "venviewer.grand-hall-closed-room-boundary.v1",
        sha256: receipt("3"),
        byteLength: 102,
        state: "human_accepted_closed_volume",
        closedVolume: true,
        cameraMembershipOnly: false,
      },
      portalDecisionArtifact: {
        schemaVersion: "venviewer.grand-hall-portal-decision.v1",
        sha256: receipt("4"),
        byteLength: 103,
        state: "human_accepted_all_interfaces_resolved",
        interfaceCount: 2,
        allInterfacesResolved: true,
      },
      panoramaMaskSetArtifact: {
        schemaVersion: "venviewer.grand-hall-panorama-mask-set.v1",
        sha256: receipt("5"),
        byteLength: 104,
        state: "human_accepted_complete",
        maskCount: 48,
        encoding: "png_grayscale8_binary_v1",
        coordinateSpace: "original_8192x4096_equirectangular_pixel_grid",
        excludedValue: 255,
      },
      pointMaskArtifact: {
        schemaVersion: "venviewer.grand-hall-point-mask.v1",
        sha256: receipt("6"),
        byteLength: 105,
        state: "human_accepted_complete",
        encoding: "source_point_membership_bitset_v1",
      },
    };

    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse({
      ...material,
      acceptedScope: legacyScope,
    }).success).toBe(false);
  });

  it.each([
    ["camera membership", { cameraMembershipOnly: true }],
    ["open boundary", { closedVolume: false }],
  ])("rejects %s as a closed-room substitute", (_label, boundaryMutation) => {
    const evidence = acceptedEvidence();
    expect(GrandHallRoomOnlyRuntimeEvidenceV2Schema.safeParse({
      ...evidence,
      acceptedScope: {
        ...evidence.acceptedScope,
        closedBoundaryArtifact: {
          ...evidence.acceptedScope.closedBoundaryArtifact,
          ...boundaryMutation,
        },
      },
    }).success).toBe(false);
  });

  it("rejects an unresolved portal, missing runtime authority, or generated fill", () => {
    const evidence = acceptedEvidence();
    const mutations: unknown[] = [
      {
        ...evidence,
        acceptedScope: {
          ...evidence.acceptedScope,
          portalDecisionArtifact: {
            ...evidence.acceptedScope.portalDecisionArtifact,
            allInterfacesResolved: false,
          },
        },
      },
      {
        ...evidence,
        runtimePolicy: { ...evidence.runtimePolicy, runtimeAuthorized: false },
      },
      {
        ...evidence,
        runtimePolicy: { ...evidence.runtimePolicy, generatedFillPermitted: true },
      },
    ];

    expect(mutations.every((value) =>
      !GrandHallRoomOnlyRuntimeEvidenceV2Schema.safeParse(value).success)).toBe(true);
  });

  it("rejects a valid-looking output mask bound to the wrong reviewed transform", () => {
    const evidence = acceptedEvidence();
    const { evidenceSha256: _evidenceSha256, ...material } = evidence;

    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse({
      ...material,
      acceptedScope: {
        ...material.acceptedScope,
        outputInventoryMaskArtifact: {
          ...material.acceptedScope.outputInventoryMaskArtifact,
          transformArtifactSha256: receipt("a"),
        },
      },
    }).success).toBe(false);
  });

  it("rejects a stale self-digest, reordered output, and substituted output bytes", () => {
    const evidence = acceptedEvidence();
    expect(GrandHallRoomOnlyRuntimeEvidenceV2Schema.safeParse({
      ...evidence,
      humanReview: { ...evidence.humanReview, reviewerId: "different-reviewer" },
    }).success).toBe(false);

    expect(grandHallRoomOnlyEvidenceMatchesVisualMembers(
      evidence,
      [...evidence.croppedVisual.members].reverse(),
    )).toBe(false);
    expect(grandHallRoomOnlyEvidenceMatchesVisualMembers(
      evidence,
      evidence.croppedVisual.members.map((member, index) =>
        index === 0 ? { ...member, sha256: hash("f") } : member),
    )).toBe(false);
  });

  it("uses the same 16 MiB per-member ceiling as authenticated preview transport", () => {
    const member = acceptedEvidence().croppedVisual.members[0];
    if (member === undefined) throw new Error("Expected a synthetic member.");
    expect(GrandHallRoomOnlyVisualMemberV2Schema.safeParse({
      ...member,
      sizeBytes: GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES,
    }).success).toBe(true);
    expect(GrandHallRoomOnlyVisualMemberV2Schema.safeParse({
      ...member,
      sizeBytes: GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES + 1,
    }).success).toBe(false);
  });

  it("bounds the complete atomic browser package while preserving 16 MiB chunking", () => {
    const evidence = acceptedEvidence();
    const { evidenceSha256: _evidenceSha256, ...baseMaterial } = evidence;
    const members = Array.from({ length: 9 }, (_, index) => ({
      fileName: `synthetic-oversize-${String(index)}.sog`,
      fileExt: ".sog" as const,
      sha256: hash(String(index)),
      sizeBytes: GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES,
      gaussianCount: index + 1,
    }));
    const totalBytes = members.reduce((total, member) => total + member.sizeBytes, 0);
    const withinLimitMembers = members.slice(0, 8);
    const withinLimitGaussianCount = withinLimitMembers.reduce(
      (total, member) => total + member.gaussianCount,
      0,
    );
    const withinLimitMaterial = {
      ...baseMaterial,
      acceptedScope: {
        ...baseMaterial.acceptedScope,
        outputInventoryMaskArtifact: {
          ...baseMaterial.acceptedScope.outputInventoryMaskArtifact,
          totalRecordCount: withinLimitGaussianCount + 20,
          includedRecordCount: withinLimitGaussianCount,
          excludedRecordCount: 20,
          bitsetByteLength: Math.ceil((withinLimitGaussianCount + 20) / 8),
        },
      },
      croppedVisual: {
        ...baseMaterial.croppedVisual,
        memberSetSha256: computeGrandHallRoomOnlyVisualMemberSetSha256(withinLimitMembers),
        memberCount: withinLimitMembers.length,
        totalBytes: withinLimitMembers.reduce(
          (total, member) => total + member.sizeBytes,
          0,
        ),
        totalGaussianCount: withinLimitGaussianCount,
        members: withinLimitMembers,
      },
    };

    expect(totalBytes).toBeGreaterThan(GRAND_HALL_ROOM_ONLY_MAX_TOTAL_BYTES);
    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse(
      withinLimitMaterial,
    ).success).toBe(true);
    expect(members.every((member) =>
      GrandHallRoomOnlyVisualMemberV2Schema.safeParse(member).success)).toBe(true);
    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse({
      ...baseMaterial,
      croppedVisual: {
        ...baseMaterial.croppedVisual,
        memberSetSha256: computeGrandHallRoomOnlyVisualMemberSetSha256(members),
        memberCount: members.length,
        totalBytes,
        totalGaussianCount: members.reduce(
          (total, member) => total + member.gaussianCount,
          0,
        ),
        members,
      },
    }).success).toBe(false);
  });

  it("bounds Gaussian allocation hints before SplatMesh construction", () => {
    const evidence = acceptedEvidence();
    const member = evidence.croppedVisual.members[0];
    if (member === undefined) throw new Error("Expected a synthetic member.");
    expect(GrandHallRoomOnlyVisualMemberV2Schema.safeParse({
      ...member,
      gaussianCount: GRAND_HALL_ROOM_ONLY_MAX_MEMBER_GAUSSIAN_COUNT,
    }).success).toBe(true);
    expect(GrandHallRoomOnlyVisualMemberV2Schema.safeParse({
      ...member,
      gaussianCount: GRAND_HALL_ROOM_ONLY_MAX_MEMBER_GAUSSIAN_COUNT + 1,
    }).success).toBe(false);

    const { evidenceSha256: _evidenceSha256, ...baseMaterial } = evidence;
    const members = Array.from({ length: 9 }, (_, index) => ({
      fileName: `synthetic-gaussian-oversize-${String(index)}.sog`,
      fileExt: ".sog" as const,
      sha256: index.toString(16).padStart(64, "0"),
      sizeBytes: 1,
      gaussianCount: GRAND_HALL_ROOM_ONLY_MAX_MEMBER_GAUSSIAN_COUNT,
    }));
    const totalGaussianCount = members.reduce(
      (total, next) => total + next.gaussianCount,
      0,
    );
    expect(totalGaussianCount).toBeGreaterThan(
      GRAND_HALL_ROOM_ONLY_MAX_TOTAL_GAUSSIAN_COUNT,
    );
    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse({
      ...baseMaterial,
      croppedVisual: {
        ...baseMaterial.croppedVisual,
        memberSetSha256: computeGrandHallRoomOnlyVisualMemberSetSha256(members),
        memberCount: members.length,
        totalBytes: members.length,
        totalGaussianCount,
        members,
      },
    }).success).toBe(false);
  });

  it("bounds member fan-out for the sequential authenticated loader", () => {
    const evidence = acceptedEvidence();
    const { evidenceSha256: _evidenceSha256, ...baseMaterial } = evidence;
    const members = Array.from(
      { length: GRAND_HALL_ROOM_ONLY_MAX_MEMBER_COUNT + 1 },
      (_, index) => ({
        fileName: `synthetic-member-fanout-${String(index)}.sog`,
        fileExt: ".sog" as const,
        sha256: index.toString(16).padStart(64, "0"),
        sizeBytes: 1,
        gaussianCount: 1,
      }),
    );
    expect(GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.safeParse({
      ...baseMaterial,
      croppedVisual: {
        ...baseMaterial.croppedVisual,
        memberSetSha256: hash("f"),
        memberCount: members.length,
        totalBytes: members.length,
        totalGaussianCount: members.length,
        members,
      },
    }).success).toBe(false);
  });
});

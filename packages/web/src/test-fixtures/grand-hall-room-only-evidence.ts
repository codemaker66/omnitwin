import {
  GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema,
  GrandHallRoomOnlyRuntimeEvidenceV2Schema,
  computeGrandHallRoomOnlyRuntimeEvidenceV2Sha256,
  computeGrandHallRoomOnlyVisualMemberSetSha256,
  type GrandHallRoomOnlyRuntimeEvidenceV2,
} from "@omnitwin/types";
import {
  GRAND_HALL_CAPTURED_SOURCE,
} from "../lib/grand-hall-captured-source.js";

const receipt = (character: string): string => `sha256:${character.repeat(64)}`;

/** Synthetic contract fixture only. It is not an accepted production artifact. */
export function syntheticGrandHallRoomOnlyEvidence(): GrandHallRoomOnlyRuntimeEvidenceV2 {
  const members = [
    {
      fileName: "synthetic-grand-hall-crop-000.sog",
      fileExt: ".sog" as const,
      sha256: "9affb482e27e74607cb1be571d8180640210db8415083dac3380512b6059a41f",
      sizeBytes: 39,
      gaussianCount: 101,
    },
    {
      fileName: "synthetic-grand-hall-crop-001.sog",
      fileExt: ".sog" as const,
      sha256: "67c1e202ff7423ccd1fd94458f8f8e7749dc91e9a339731b769fb8e5caaf2655",
      sizeBytes: 39,
      gaussianCount: 202,
    },
  ];
  const material = GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.parse({
    schemaVersion: "venviewer.grand-hall-room-only-runtime-evidence.v2",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    createdAt: "2026-08-25T12:00:00.000Z",
    createdBy: "synthetic-web-test-fixture",
    sourceFrontierReceiptSha256: GRAND_HALL_CAPTURED_SOURCE.frontierReceiptSha256,
    acceptedScope: {
      membershipArtifact: {
        schemaVersion: "omnitwin.foundry.grand-hall-room-membership.v2",
        sha256: receipt("1"),
        byteLength: 101,
        state: "human_accepted",
      },
      closedBoundaryArtifact: {
        schemaVersion: "venviewer.grand-hall-closed-room-boundary.v1",
        sha256: receipt("2"),
        byteLength: 102,
        state: "human_accepted_closed_volume",
        closedVolume: true,
        cameraMembershipOnly: false,
      },
      portalDecisionArtifact: {
        schemaVersion: "venviewer.grand-hall-portal-decision.v1",
        sha256: receipt("3"),
        byteLength: 103,
        state: "human_accepted_all_interfaces_resolved",
        interfaceCount: 2,
        allInterfacesResolved: true,
      },
      panoramaMaskSetArtifact: {
        schemaVersion: "venviewer.grand-hall-panorama-mask-set.v1",
        sha256: receipt("4"),
        byteLength: 104,
        state: "human_accepted_complete",
        maskCount: 48,
        encoding: "png_grayscale8_binary_v1",
        coordinateSpace: "original_8192x4096_equirectangular_pixel_grid",
        excludedValue: 255,
      },
      pointMaskArtifact: {
        schemaVersion: "venviewer.grand-hall-point-mask.v1",
        sha256: receipt("5"),
        byteLength: 105,
        state: "human_accepted_complete",
        encoding: "source_point_membership_bitset_v1",
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
      derivation: "accepted_closed_boundary_and_point_mask_applied_to_source_capture_v1",
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

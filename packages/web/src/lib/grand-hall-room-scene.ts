import {
  OWNER_CONFIRMED_AUTHORITY_STATEMENT,
  OWNER_CONFIRMED_SCOPE_STATEMENT,
  ROOM_SCENE_MANIFEST_V0_VERSION,
  RoomSceneManifestV0Schema,
  SOURCE_RIGHTS_SCOPES,
  type RoomSceneManifestV0,
} from "@omnitwin/types";
import {
  GRAND_HALL_CAPTURED_SOG_MEMBERS,
  GRAND_HALL_CAPTURED_SOURCE,
} from "./grand-hall-captured-source.js";
import {
  GRAND_HALL_NAVIGATION_PROFILE,
  GRAND_HALL_NAVIGATION_PROFILE_SHA256,
} from "./grand-hall-navigation-profile.js";

export const GRAND_HALL_ROOM_SCENE_MANIFEST_ID = "grand-hall-room-scene-v0";
export const GRAND_HALL_APPEARANCE_LAYER_ID = "grand-hall-captured-appearance";
export const GRAND_HALL_STRUCTURAL_PROXY_LAYER_ID = "grand-hall-pose-envelope";
export const GRAND_HALL_POSE_SOURCE_SHA256 =
  "sha256:7a020e5f1cc00029ce773d1f448804fa1b7f16355412b023320975122556418d";

/**
 * Adapts T-540's immutable runtime-package receipts into the thin RoomScene
 * compositor read model. This adds no delivery URL and grants no new spatial
 * authority: authenticated byte transport remains owned by the exact layer.
 */
export function createGrandHallRoomSceneManifest(
  runtimePackageId: string,
): RoomSceneManifestV0 {
  return RoomSceneManifestV0Schema.parse({
    schemaVersion: ROOM_SCENE_MANIFEST_V0_VERSION,
    manifestId: GRAND_HALL_ROOM_SCENE_MANIFEST_ID,
    venueSlug: GRAND_HALL_CAPTURED_SOURCE.venueSlug,
    roomSlug: GRAND_HALL_CAPTURED_SOURCE.roomSlug,
    runtimePackageId,
    createdAt: "2026-08-23T00:00:00.000Z",
    sourceRights: [
      {
        id: "grand-hall-xgrids-owner-confirmation-v1",
        sourceFamily: "xgrids-grand-hall-big-model-variations",
        authorityStatus: "confirmed_by_project_owner",
        authorityStatement: OWNER_CONFIRMED_AUTHORITY_STATEMENT,
        scope: [...SOURCE_RIGHTS_SCOPES],
        scopeStatement: OWNER_CONFIRMED_SCOPE_STATEMENT,
        additionalPermissions: ["redistribution", "third_party_dissemination"],
        evidenceLocation: "PROJECT_EVIDENCE_STORE/PENDING_ATTACHMENT",
        evidenceLocationStatus: "pending",
        unrelatedLicensesRequireSeparateReview: true,
      },
    ],
    qualityEvidence: [
      {
        id: "grand-hall-exact-frontier-receipt",
        status: "machine_checked",
        confidence: "appearance_only",
        evidenceRefs: [GRAND_HALL_CAPTURED_SOURCE.frontierReceiptSha256],
        limitations: [
          "Appearance evidence only; there is no reviewed Grand Hall room-local transform.",
          "The eleven members become visible only after exact atomic byte verification.",
        ],
      },
      {
        id: "grand-hall-source-envelope-diagnostic",
        status: "machine_checked",
        confidence: "unknown",
        evidenceRefs: [
          GRAND_HALL_CAPTURED_SOURCE.frontierReceiptSha256,
          GRAND_HALL_POSE_SOURCE_SHA256,
          GRAND_HALL_NAVIGATION_PROFILE.reconstructedMesh.sha256,
          GRAND_HALL_NAVIGATION_PROFILE_SHA256,
        ],
        limitations: [
          "The mixed-source frontier/pose/mesh diagnostic is not a room shell and is not collision authority.",
          "Human mode is an internal diagnostic constrained to captured-source extents; floor and portals remain unreviewed.",
        ],
      },
    ],
    visualAssetManifests: [
      {
        id: "grand-hall-exact-sog-frontier",
        truthClass: "CAPTURED",
        format: "sog",
        lineageRole: "runtime_derivative",
        parentArtifactRefs: [
          "Grand_Hall.lcc2",
          `manifest:${GRAND_HALL_CAPTURED_SOURCE.manifestSha256}`,
        ],
        sourceRightsId: "grand-hall-xgrids-owner-confirmation-v1",
        qualityEvidenceIds: ["grand-hall-exact-frontier-receipt"],
        members: GRAND_HALL_CAPTURED_SOG_MEMBERS.map((member, index) => ({
          id: `sog-member-${String(index).padStart(2, "0")}`,
          fileName: member.fileName,
          sha256: `sha256:${member.sha256}`,
          sizeBytes: member.sizeBytes,
          gaussianCount: member.gaussianCount,
        })),
        totalBytes: GRAND_HALL_CAPTURED_SOURCE.totalBytes,
        totalGaussianCount: GRAND_HALL_CAPTURED_SOURCE.gaussianCount,
      },
    ],
    transformArtifacts: [],
    reconstructionProviders: [],
    enhancementProviders: [],
    materialAttachments: [],
    lightingVariants: [],
    layerDescriptors: [
      {
        id: GRAND_HALL_APPEARANCE_LAYER_ID,
        kind: "Appearance",
        truthClass: "CAPTURED",
        source: {
          type: "visual_asset_set",
          visualAssetManifestId: "grand-hall-exact-sog-frontier",
        },
        authorities: ["appearance"],
        spatialRegistration: {
          type: "inspection_placement",
          bindingRef: "grand-hall-source-inspection-transform-v1",
        },
        qualityEvidenceIds: ["grand-hall-exact-frontier-receipt"],
        sourceRightsId: "grand-hall-xgrids-owner-confirmation-v1",
        intents: ["inspection", "dollhouse"],
        loadPolicy: "atomic",
        visibleByDefault: true,
      },
      {
        id: GRAND_HALL_STRUCTURAL_PROXY_LAYER_ID,
        kind: "StructuralProxy",
        truthClass: "RECONSTRUCTED",
        source: {
          type: "artifact",
          artifactRef: "grand-hall-navigation-profile/v0",
          sha256: GRAND_HALL_NAVIGATION_PROFILE_SHA256,
        },
        authorities: ["diagnostic_navigation"],
        spatialRegistration: {
          type: "inspection_placement",
          bindingRef: "grand-hall-source-inspection-transform-v1",
        },
        qualityEvidenceIds: ["grand-hall-source-envelope-diagnostic"],
        sourceRightsId: "grand-hall-xgrids-owner-confirmation-v1",
        intents: ["inspection", "human_diagnostic"],
        loadPolicy: "synchronous",
        visibleByDefault: false,
      },
    ],
  });
}

import {
  GrandHallRoomOnlyRuntimeEvidenceV2Schema,
  OWNER_CONFIRMED_AUTHORITY_STATEMENT,
  OWNER_CONFIRMED_SCOPE_STATEMENT,
  ROOM_SCENE_MANIFEST_V0_VERSION,
  RoomSceneManifestV0Schema,
  SOURCE_RIGHTS_SCOPES,
  type GrandHallRoomOnlyRuntimeEvidenceV2,
  type RoomSceneManifestV0,
} from "@omnitwin/types";
import {
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
  evidenceInput: GrandHallRoomOnlyRuntimeEvidenceV2,
): RoomSceneManifestV0 {
  const evidence = GrandHallRoomOnlyRuntimeEvidenceV2Schema.parse(evidenceInput);
  const acceptedEvidenceId = "grand-hall-room-only-runtime-evidence-v2";
  return RoomSceneManifestV0Schema.parse({
    schemaVersion: ROOM_SCENE_MANIFEST_V0_VERSION,
    manifestId: GRAND_HALL_ROOM_SCENE_MANIFEST_ID,
    venueSlug: GRAND_HALL_CAPTURED_SOURCE.venueSlug,
    roomSlug: GRAND_HALL_CAPTURED_SOURCE.roomSlug,
    runtimePackageId,
    createdAt: evidence.createdAt,
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
        id: acceptedEvidenceId,
        status: "human_reviewed",
        confidence: "appearance_only",
        evidenceRefs: [
          `sha256:${evidence.evidenceSha256}`,
          evidence.sourceFrontierReceiptSha256,
          evidence.acceptedScope.membershipArtifact.sha256,
          evidence.acceptedScope.closedBoundaryArtifact.sha256,
          evidence.acceptedScope.portalDecisionArtifact.sha256,
          evidence.acceptedScope.panoramaMaskSetArtifact.sha256,
          evidence.acceptedScope.reviewedTransformArtifact.sha256,
          evidence.acceptedScope.outputInventoryMaskArtifact.sha256,
        ],
        limitations: [
          "Appearance evidence only; the accepted cropped inventory grants no collision authority.",
          "Unknown and excluded regions remain transparent and are never procedurally filled.",
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
        id: "grand-hall-room-only-sog-crop-v2",
        truthClass: "CAPTURED",
        format: "sog",
        lineageRole: "runtime_derivative",
        parentArtifactRefs: [
          evidence.sourceFrontierReceiptSha256,
          evidence.acceptedScope.closedBoundaryArtifact.sha256,
          evidence.acceptedScope.portalDecisionArtifact.sha256,
          evidence.acceptedScope.panoramaMaskSetArtifact.sha256,
          evidence.acceptedScope.reviewedTransformArtifact.sha256,
          evidence.acceptedScope.outputInventoryMaskArtifact.sha256,
        ],
        sourceRightsId: "grand-hall-xgrids-owner-confirmation-v1",
        qualityEvidenceIds: [acceptedEvidenceId],
        members: evidence.croppedVisual.members.map((member, index) => ({
          id: `sog-member-${String(index).padStart(2, "0")}`,
          fileName: member.fileName,
          sha256: `sha256:${member.sha256}`,
          sizeBytes: member.sizeBytes,
          gaussianCount: member.gaussianCount,
        })),
        totalBytes: evidence.croppedVisual.totalBytes,
        totalGaussianCount: evidence.croppedVisual.totalGaussianCount,
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
          visualAssetManifestId: "grand-hall-room-only-sog-crop-v2",
        },
        authorities: ["appearance"],
        spatialRegistration: {
          type: "unregistered",
        },
        qualityEvidenceIds: [acceptedEvidenceId],
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
          type: "unregistered",
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

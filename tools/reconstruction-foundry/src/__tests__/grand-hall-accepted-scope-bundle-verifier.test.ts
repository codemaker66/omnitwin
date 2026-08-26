import { createHash } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CanonicalJsonValueSchema,
  GRAND_HALL_CLOSED_BOUNDARY_V1,
  GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
  GRAND_HALL_MATTERPAK_ROOM_KEY,
  GRAND_HALL_OUTPUT_INVENTORY_MASK_V1,
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
  GrandHallInterfaceCandidateSchema,
  GrandHallOutputInventoryMaskV1MaterialSchema,
  GrandHallOutputInventoryMaskV1Schema,
  GrandHallPanoramaMaskSetV1MaterialSchema,
  GrandHallPanoramaMaskSetV1Schema,
  GrandHallPanoramaE57SequenceHypothesisSchema,
  GrandHallPanoramaSourceJpgIdentitySchema,
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
  stableCanonicalJson,
  type GrandHallOutputInventoryMaskV1,
  type GrandHallPanoramaMaskSetV1,
} from "@omnitwin/types";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_ACCEPTED_SCOPE_BUNDLE_VERIFIER_VERSION,
  verifyGrandHallAcceptedScopeBundle,
  type GrandHallAcceptedScopeArtifactFiles,
  type VerifyGrandHallAcceptedScopeBundleOptions,
} from "../grand-hall-accepted-scope-bundle-verifier.js";
import {
  GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
  GRAND_HALL_T554_HUMAN_DECISIONS_V1,
  GrandHallT554ClosedVolumeReviewSchema,
  GrandHallT554HumanDecisionsSchema,
  computeGrandHallT554ClosedVolumeReviewSha256,
  computeGrandHallT554HumanDecisionsSha256,
} from "../grand-hall-t554-acceptance.js";

const PIXEL_COUNT = GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;

const ARTIFACT_FILES: GrandHallAcceptedScopeArtifactFiles = {
  publicationReceipt: "publication-receipt.json",
  scopeReviewPack: "artifacts/scope-review-pack.json",
  humanDecisions: "review/human-decisions.json",
  closedVolumeReview: "review/closed-selection-volume-review.json",
  roomMembership: "artifacts/room-membership.json",
  portalDecisions: "artifacts/portal-decisions.json",
  closedBoundary: "artifacts/closed-boundary.json",
  panoramaMaskSet: "artifacts/panorama-mask-set.json",
  reviewedTransform: "artifacts/reviewed-transform.json",
  outputInventoryMask: "artifacts/output-inventory-mask.json",
};

type DeepMutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? DeepMutable<Item>[]
    : T[Key] extends object
      ? DeepMutable<T[Key]>
      : T[Key];
};

interface AcceptedArtifacts {
  readonly scopeReviewPack: ReturnType<typeof GrandHallScopeReviewPackV1Schema.parse>;
  readonly humanDecisions: ReturnType<typeof GrandHallT554HumanDecisionsSchema.parse>;
  readonly closedVolumeReview: ReturnType<typeof GrandHallT554ClosedVolumeReviewSchema.parse>;
  readonly membership: ReturnType<typeof GrandHallRoomMembershipV2Schema.parse>;
  readonly portals: ReturnType<typeof GrandHallPortalDecisionsV1Schema.parse>;
  readonly boundary: ReturnType<typeof GrandHallClosedBoundaryV1Schema.parse>;
  readonly panoramaMasks: GrandHallPanoramaMaskSetV1;
  readonly transform: ReturnType<typeof GrandHallReviewedTransformV1Schema.parse>;
  readonly outputMask: GrandHallOutputInventoryMaskV1;
}

interface Fixture {
  readonly temporaryRoot: string;
  readonly bundleRoot: string;
  readonly panoramaRoot: string;
  readonly xgridsRoot: string;
  readonly outsideRoot: string;
  readonly options: VerifyGrandHallAcceptedScopeBundleOptions;
  readonly sourceJpeg: Buffer;
  readonly maskPng: Buffer;
  readonly bitset: Buffer;
  readonly sourceMemberBytes: readonly [Buffer, Buffer];
  readonly artifacts: AcceptedArtifacts;
}

function digest(value: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function syntheticDigest(seed: number): `sha256:${string}` {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

const humanReviewer = {
  reviewerId: "synthetic-authorized-reviewer",
  reviewerRole: "venue_owner_or_authorized_domain_reviewer" as const,
  reviewedAt: "2026-08-25T12:30:00.000Z",
  knowledgeBasis: ["synthetic exact source comparison"],
  agentDecisionAuthority: "none" as const,
};

const humanReview = {
  state: "human_accepted" as const,
  ...humanReviewer,
};

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
      sharedSourceVertexSetSha256: syntheticDigest(100 + index),
      boundsMeters: {
        min: [index * 2, 0, 0],
        max: [index * 2 + 1, 2, 3],
      },
    }),
  );
}

function createAcceptedArtifacts(input: {
  readonly sourceJpegSha256: string;
  readonly sourceJpegByteLength: number;
  readonly firstNonCandidateSourceJpegSha256?: string;
  readonly firstNonCandidateSourceJpegByteLength?: number;
  readonly maskSha256: string;
  readonly maskByteLength: number;
  readonly memberSha256s: readonly [string, string];
  readonly memberByteLengths: readonly [number, number];
  readonly bitsetSha256: string;
  readonly bitsetByteLength: number;
}): AcceptedArtifacts {
  const boundaryEvidenceSha256 = syntheticDigest(901);
  const xgridsSourceReceiptSha256 = syntheticDigest(902);
  const matterPakE57ReceiptSha256 = syntheticDigest(903);
  const xgridsOutputInventorySha256 = syntheticDigest(904);
  const pendingMembershipV1Sha256 = syntheticDigest(905);
  const sources = Array.from({ length: 50 }, (_, index) =>
    GrandHallPanoramaSourceJpgIdentitySchema.parse({
      sweepNumber: index + 1,
      fileName: `sweep-${String(index + 1).padStart(3, "0")}.jpg`,
      sha256: input.sourceJpegSha256,
      byteLength: input.sourceJpegByteLength,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    }),
  );
  const sequenceHypotheses = sources.map((source, index) =>
    GrandHallPanoramaE57SequenceHypothesisSchema.parse({
      sourceSweepNumber: source.sweepNumber,
      sourceJpgFileName: source.fileName,
      sourceJpgSha256: source.sha256,
      candidateScanIndex: index,
      state: "sequence_hypothesis_unverified",
      authority: "none",
      geometricCameraAuthority: "none",
      trainingAuthority: "none",
      reconstructionAuthority: "none",
      runtimeAuthority: "none",
    }),
  );
  const sourcePanoramaInventorySha256 = computeGrandHallPanoramaSourceInventorySha256(sources);
  const interfaces = interfaceCandidates();
  const interfaceInventorySha256 = computeGrandHallInterfaceInventorySha256(interfaces);
  const panoramaDirectoryFiles = [
    ...sources.map((source, inventoryIndex) => ({
      inventoryIndex,
      fileName: source.fileName,
      sha256: source.sha256,
      byteLength: source.byteLength,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
      t554Eligibility: "candidate_numeric_sweep_1_through_50" as const,
      embeddedSweepNumber: source.sweepNumber,
      t554ReviewState: "human_pending" as const,
      ineligibilityReason: null,
    })),
    ...Array.from({ length: 98 }, (_, offset) => ({
      inventoryIndex: offset + 50,
      fileName: `unreviewed-sweep-${String(offset + 51).padStart(3, "0")}.jpg`,
      sha256: offset === 0
        ? input.firstNonCandidateSourceJpegSha256 ?? input.sourceJpegSha256
        : input.sourceJpegSha256,
      byteLength: offset === 0
        ? input.firstNonCandidateSourceJpegByteLength ?? input.sourceJpegByteLength
        : input.sourceJpegByteLength,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      t554Eligibility: "ineligible_unreviewed" as const,
      embeddedSweepNumber: offset + 51,
      t554ReviewState: "not_reviewed_in_t554" as const,
      ineligibilityReason: "embedded_sweep_number_outside_1_through_50" as const,
    })),
  ];
  const reviewPackMaterial = GrandHallScopeReviewPackMaterialV1Schema.parse({
    schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    createdAt: "2026-08-25T12:00:00.000Z",
    createdBy: "synthetic T-554 review-pack fixture",
    authority: "none",
    reviewState: "human_pending",
    runtimeAuthorized: false,
    trainingAuthorized: false,
    generatedContentAuthorized: false,
    productionTrust: null,
    sourceEvidence: {
      t550PendingMembershipV1Sha256: pendingMembershipV1Sha256,
      t551SourceEvidenceSha256: boundaryEvidenceSha256,
      t551SourceReceiptSha256: matterPakE57ReceiptSha256,
      xgridsSourceReceiptSha256,
      matterPakE57SourceReceiptSha256: matterPakE57ReceiptSha256,
      panoramaDirectoryInventorySha256:
        computeGrandHallPanoramaDirectoryInventorySha256(panoramaDirectoryFiles),
      boundaryReviewManifestSha256: syntheticDigest(906),
      interfaceTopologyAtlasManifestSha256: syntheticDigest(908),
      panoramaReviewManifestSha256: syntheticDigest(907),
    },
    panoramaDirectoryFiles,
    candidatePanoramaSources: sources,
    panoramaSourceInventorySha256: sourcePanoramaInventorySha256,
    panoramaE57SequenceHypotheses: sequenceHypotheses,
    interfaceCandidates: interfaces,
    interfaceInventorySha256,
    proposalArtifacts: {
      roomMembership: {
        state: "source_candidate_present_human_pending",
        artifactSha256: pendingMembershipV1Sha256,
      },
      portalDecisions: { state: "not_authored_human_pending", artifactSha256: null },
      closedSelectionVolume: { state: "not_authored_human_pending", artifactSha256: null },
      panoramaMaskSet: { state: "not_authored_human_pending", artifactSha256: null },
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
    ],
  });
  const scopeReviewPack = GrandHallScopeReviewPackV1Schema.parse({
    ...reviewPackMaterial,
    artifactSha256: computeGrandHallScopeReviewPackV1Sha256(reviewPackMaterial),
  });
  const reviewPackSha256 = scopeReviewPack.artifactSha256;
  const humanDecisions = GrandHallT554HumanDecisionsSchema.parse({
    schemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewPackSha256,
    authority: "none",
    reviewState: "human_accepted",
    finalDecision: "ACCEPT",
    reviewer: humanReviewer,
    generatedFillPermitted: false,
    geometricCameraAuthority: "none",
    matterPakRoomDecision: {
      sourceRoomKey: GRAND_HALL_MATTERPAK_ROOM_KEY,
      sourceMembershipV1Sha256: pendingMembershipV1Sha256,
      sourceBoundaryEvidenceSha256: boundaryEvidenceSha256,
      result: "ACCEPT_AS_GRAND_HALL",
      note: "Synthetic room 9 review accepted only as Grand Hall source scope.",
    },
    cleanupArtifactInspections: ["Window", "Mirror"].map((artifactClass) => ({
      artifactClass,
      sourceBoundaryEvidenceSha256: boundaryEvidenceSha256,
      result: "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY",
      note: `Synthetic ${artifactClass} source-artifact inspection.`,
    })),
    panoramaDecisions: sources.map((source, index) => index === 0 ? {
      sweepNumber: source.sweepNumber,
      sourceJpgFileName: source.fileName,
      sourceJpgSha256: source.sha256,
      sourceJpgByteLength: source.byteLength,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
      result: "INCLUDE",
      classification: "grand_hall_portal_threshold",
      maskFileName: "masks/mask-000.png",
      reviewedMaskBinding: {
        sha256: input.maskSha256,
        byteLength: input.maskByteLength,
        includedPixelCount: PIXEL_COUNT - 1,
        excludedPixelCount: 1,
      },
      maskReviewed: true,
      maskReasonCodes: ["unverified_or_unknown_pixels"],
      note: "Synthetic exact binary mask review.",
    } : {
      sweepNumber: source.sweepNumber,
      sourceJpgFileName: source.fileName,
      sourceJpgSha256: source.sha256,
      sourceJpgByteLength: source.byteLength,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
      result: "EXCLUDE",
      classification: "adjacent_room_or_outside_grand_hall",
      maskFileName: null,
      reviewedMaskBinding: null,
      maskReviewed: false,
      maskReasonCodes: [],
      note: "Synthetic whole-frame exclusion.",
    }),
    nonCandidatePanoramaDecisions: panoramaDirectoryFiles.slice(50).map((source) => ({
      inventoryIndex: source.inventoryIndex,
      sourceJpgFileName: source.fileName,
      sourceJpgSha256: source.sha256,
      sourceJpgByteLength: source.byteLength,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
      embeddedSweepNumber: source.embeddedSweepNumber,
      result: "EXCLUDE_OUTSIDE_GRAND_HALL",
      note: "Synthetic reviewed non-candidate exclusion.",
    })),
    interfaceDecisions: interfaces.map((candidate, index) => ({
      ...candidate,
      result: index === 0
        ? "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE"
        : "EXCLUDE_BEYOND_INTERFACE",
      note: `Synthetic interface disposition ${String(index)}`,
    })),
  });
  const humanDecisionsSha256 = computeGrandHallT554HumanDecisionsSha256(humanDecisions);
  const closedFootprint = [
    [0, 0], [8, 0], [8, 5], [5, 5], [5, 3], [3, 3], [3, 5], [0, 5],
  ];
  const closedVolumeReview = GrandHallT554ClosedVolumeReviewSchema.parse({
    schemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewPackSha256,
    authority: "none",
    reviewState: "human_accepted",
    finalDecision: "ACCEPT",
    reviewer: humanReviewer,
    sourceFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
    units: "meters",
    geometryRole: "non_rendered_selection_volume",
    construction: "extruded_simple_xy_polygon",
    footprintXY: closedFootprint,
    zMin: -0.25,
    zMax: 8,
    rendered: false,
    collisionGeometry: false,
    exportedAsArchitecture: false,
    generatedGeometryCreated: false,
    note: "Synthetic human-reviewed non-convex Grand Hall selection volume.",
  });

  const membershipMaterial = GrandHallRoomMembershipV2MaterialSchema.parse({
    schemaVersion: GRAND_HALL_ROOM_MEMBERSHIP_V2,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSha256,
    sourceMembershipV1Sha256: pendingMembershipV1Sha256,
    sourceBoundaryEvidenceSha256: boundaryEvidenceSha256,
    sourcePanoramaInventorySha256,
    geometricCameraAuthority: "none",
    matterPakRoomMembership: {
      includedRoomKeys: [GRAND_HALL_MATTERPAK_ROOM_KEY],
      neighbouringRoomGeometryIncluded: false,
      facadeGeometryIncluded: false,
    },
    panoramaRecords: sources.map((source, index) => ({
      source,
      decision:
        index === 0
          ? {
              disposition: "include_with_binary_pixel_mask" as const,
              classification: "grand_hall_portal_threshold" as const,
              maskRequired: true as const,
              generatedFillPermitted: false as const,
            }
          : {
              disposition: "exclude_whole_frame" as const,
              classification: "adjacent_room_or_outside_grand_hall" as const,
              maskRequired: false as const,
              generatedFillPermitted: false as const,
            },
      decisionEvidenceSha256: humanDecisionsSha256,
    })),
    acceptedUnknownPixelDisposition: "transparent_or_unknown_never_filled",
    humanReview,
  });
  const membership = GrandHallRoomMembershipV2Schema.parse({
    ...membershipMaterial,
    artifactSha256: computeGrandHallRoomMembershipV2Sha256(membershipMaterial),
  });

  const portalMaterial = GrandHallPortalDecisionsV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_PORTAL_DECISIONS_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSha256,
    sourceBoundaryEvidenceSha256: boundaryEvidenceSha256,
    interfaceInventorySha256,
    interfaceCount: 8,
    interfaceCandidates: interfaces,
    decisions: interfaces.map((candidate, index) => ({
      interfaceId: candidate.interfaceId,
      resolution:
        index === 0
          ? ("close_at_reviewed_grand_hall_plane" as const)
          : ("exclude_beyond_interface" as const),
      grandHallSideEvidenceSha256: humanDecisionsSha256,
      decisionNote: `Synthetic interface disposition ${String(index)}`,
    })),
    allInterfacesResolved: true,
    humanReview,
  });
  const portals = GrandHallPortalDecisionsV1Schema.parse({
    ...portalMaterial,
    artifactSha256: computeGrandHallPortalDecisionsV1Sha256(portalMaterial),
  });

  const boundaryMaterial = GrandHallClosedBoundaryV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_CLOSED_BOUNDARY_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSha256,
    roomMembershipArtifactSha256: membership.artifactSha256,
    portalDecisionArtifactSha256: portals.artifactSha256,
    portalInterfaceInventorySha256: interfaceInventorySha256,
    portalInterfaceIds: interfaces.map((candidate) => candidate.interfaceId),
    sourceFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
    units: "meters",
    geometryRole: "non_rendered_selection_volume",
    construction: "extruded_simple_xy_polygon",
    nonConvex: true,
    footprintXY: closedFootprint,
    zMin: -0.25,
    zMax: 8,
    pointOnBoundaryPolicy: "include_as_inside",
    closedVolume: true,
    cameraMembershipOnly: false,
    rendered: false,
    collisionGeometry: false,
    exportedAsArchitecture: false,
    generatedGeometryCreated: false,
    semanticRefinements: interfaces.map((candidate, index) => ({
      interfaceId: candidate.interfaceId,
      operation:
        index === 0 ? ("retain_grand_hall_side" as const) : ("exclude_beyond_interface" as const),
      evidenceSha256: humanDecisionsSha256,
      applied: true,
      generatedGeometryCreated: false,
    })),
    humanReview,
  });
  const boundary = GrandHallClosedBoundaryV1Schema.parse({
    ...boundaryMaterial,
    artifactSha256: computeGrandHallClosedBoundaryV1Sha256(boundaryMaterial),
  });

  const panoramaMaskMaterial = GrandHallPanoramaMaskSetV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_PANORAMA_MASK_SET_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    reviewPackSha256,
    membershipArtifactSha256: membership.artifactSha256,
    portalDecisionArtifactSha256: portals.artifactSha256,
    sourcePanoramaInventorySha256,
    geometricCameraAuthority: "none",
    sourceRecordCount: 50,
    maskCount: 1,
    wholeFrameExclusionCount: 49,
    sourceRecords: sources.map((source, index) =>
      index === 0
        ? {
            source,
            disposition: "include_with_binary_pixel_mask" as const,
            mask: {
              fileName: "masks/mask-000.png",
              sha256: input.maskSha256,
              byteLength: input.maskByteLength,
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
              includedPixelCount: PIXEL_COUNT - 1,
              excludedPixelCount: 1,
              alphaChannelPresent: false as const,
              colourProfilePresent: false as const,
              exifOrientationPresent: false as const,
              resampled: false as const,
              reasonCodes: ["unverified_or_unknown_pixels" as const],
            },
            wholeFrameExclusionReason: null,
          }
        : {
            source,
            disposition: "exclude_whole_frame" as const,
            mask: null,
            wholeFrameExclusionReason: "adjacent_room_or_outside_grand_hall" as const,
          },
    ),
    unknownPixelDisposition: "transparent_or_unknown_never_filled",
    generatedFillPermitted: false,
    humanReview,
  });
  const panoramaMasks = GrandHallPanoramaMaskSetV1Schema.parse({
    ...panoramaMaskMaterial,
    artifactSha256: computeGrandHallPanoramaMaskSetV1Sha256(panoramaMaskMaterial),
  });

  const matrix = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const landmarks = [
    { id: "landmark-a", point: [0, 0, 0] as const },
    { id: "landmark-b", point: [2, 0, 0] as const },
    { id: "landmark-c", point: [0, 3, 1] as const },
  ].map((landmark, index) => ({
    id: landmark.id,
    label: `Synthetic landmark ${String(index)}`,
    source: landmark.point,
    target: landmark.point,
    residualM: 0,
    provenanceRefs: [{
      refType: "artifact" as const,
      ref: syntheticDigest(1_300 + index),
      role: "measured-landmark",
    }],
  }));
  const transformMaterial = GrandHallReviewedTransformV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_XGRIDS_TO_MATTERPAK_E57_TRANSFORM_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    scopeReviewPackSha256: reviewPackSha256,
    sourceXgridsReceiptSha256: xgridsSourceReceiptSha256,
    sourceXgridsOutputInventorySha256: xgridsOutputInventorySha256,
    targetMatterPakE57ReceiptSha256: matterPakE57ReceiptSha256,
    targetBoundaryEvidenceSha256: boundaryEvidenceSha256,
    transformArtifact: {
      id: "grand-hall-xgrids-arf-to-cvf",
      sourceFrame: "ARF",
      targetFrame: "CVF",
      units: "meters",
      matrix,
      alignmentMethod: "landmark_solve",
      residualRmseM: 0,
      landmarks,
      provenance: {
        state: "measured",
        refs: [
          {
            refType: "artifact",
            ref: xgridsSourceReceiptSha256,
            role: "source_xgrids_receipt",
          },
          {
            refType: "artifact",
            ref: xgridsOutputInventorySha256,
            role: "source_xgrids_output_inventory",
          },
          {
            refType: "artifact",
            ref: matterPakE57ReceiptSha256,
            role: "target_matterpak_e57_receipt",
          },
          {
            refType: "artifact",
            ref: boundaryEvidenceSha256,
            role: "target_boundary_evidence",
          },
        ],
      },
      creator: { actorType: "tool", id: "synthetic-transform-solver" },
      reviewer: {
        actorType: "human",
        id: humanReview.reviewerId,
        role: "venue-domain-reviewer",
      },
      date: humanReview.reviewedAt,
    },
    matrixSha256: computeGrandHallReviewedTransformMatrixSha256(matrix),
    independentOverlayReviewCompleted: true,
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
      sha256: input.memberSha256s[0],
      byteLength: input.memberByteLengths[0],
      firstRecordIndex: 0,
      recordCount: 4,
    },
    {
      memberIndex: 1,
      fileName: "creator-data/member-001.lcc",
      sha256: input.memberSha256s[1],
      byteLength: input.memberByteLengths[1],
      firstRecordIndex: 4,
      recordCount: 6,
    },
  ];
  const outputMaskMaterial = GrandHallOutputInventoryMaskV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_OUTPUT_INVENTORY_MASK_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "human_accepted",
    productionTrust: null,
    scopeReviewPackSha256: reviewPackSha256,
    sourceFrame: GRAND_HALL_XGRIDS_SOURCE_FRAME,
    classificationFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
    recordKind: "gaussian",
    xgridsSourceReceiptSha256,
    xgridsOutputInventorySha256,
    sourceOrderingSha256: computeGrandHallOutputSourceOrderingSha256(
      GRAND_HALL_XGRIDS_SOURCE_FRAME,
      sourceMembers,
    ),
    transformArtifactSha256: transform.artifactSha256,
    closedBoundaryArtifactSha256: boundary.artifactSha256,
    sourceMembers,
    totalRecordCount: 10,
    includedRecordCount: 5,
    excludedRecordCount: 5,
    encoding: "ordered_source_record_membership_bitset_v1",
    bitOrder: "least_significant_bit_first_within_each_byte",
    includedBitValue: 1,
    excludedBitValue: 0,
    bitsetFileName: "masks/output-membership.bin",
    bitsetSha256: input.bitsetSha256,
    bitsetByteLength: input.bitsetByteLength,
    trailingPaddingBitCount: 6,
    trailingPaddingBitsZero: true,
    humanReview,
  });
  const outputMask = GrandHallOutputInventoryMaskV1Schema.parse({
    ...outputMaskMaterial,
    artifactSha256: computeGrandHallOutputInventoryMaskV1Sha256(outputMaskMaterial),
  });
  return {
    scopeReviewPack,
    humanDecisions,
    closedVolumeReview,
    membership,
    portals,
    boundary,
    panoramaMasks,
    transform,
    outputMask,
  };
}

async function writeCanonical(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${stableCanonicalJson(CanonicalJsonValueSchema.parse(value))}\n`,
    "utf8",
  );
}

async function writeArtifacts(fixture: Fixture, artifacts: AcceptedArtifacts): Promise<void> {
  await Promise.all([
    writeCanonical(
      join(fixture.bundleRoot, ARTIFACT_FILES.scopeReviewPack),
      artifacts.scopeReviewPack,
    ),
    writeCanonical(
      join(fixture.bundleRoot, ARTIFACT_FILES.humanDecisions),
      artifacts.humanDecisions,
    ),
    writeCanonical(
      join(fixture.bundleRoot, ARTIFACT_FILES.closedVolumeReview),
      artifacts.closedVolumeReview,
    ),
    writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.roomMembership), artifacts.membership),
    writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.portalDecisions), artifacts.portals),
    writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.closedBoundary), artifacts.boundary),
    writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.panoramaMaskSet), artifacts.panoramaMasks),
    writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.reviewedTransform), artifacts.transform),
    writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.outputInventoryMask), artifacts.outputMask),
  ]);
}

function t554PayloadFileNames(artifacts: AcceptedArtifacts): readonly string[] {
  const maskFileNames = artifacts.panoramaMasks.sourceRecords.flatMap((record) =>
    record.disposition === "include_with_binary_pixel_mask" ? [record.mask.fileName] : [],
  );
  return [
    ARTIFACT_FILES.scopeReviewPack,
    ARTIFACT_FILES.humanDecisions,
    ARTIFACT_FILES.closedVolumeReview,
    ARTIFACT_FILES.roomMembership,
    ARTIFACT_FILES.portalDecisions,
    ARTIFACT_FILES.closedBoundary,
    ARTIFACT_FILES.panoramaMaskSet,
    ...maskFileNames,
  ].sort((left, right) => left.localeCompare(right));
}

async function buildPublicationReceipt(fixture: Fixture, artifacts: AcceptedArtifacts) {
  const files = await Promise.all(t554PayloadFileNames(artifacts).map(async (fileName) => {
    const bytes = await readFile(join(fixture.bundleRoot, fileName));
    return { fileName, sha256: digest(bytes), byteLength: bytes.byteLength };
  }));
  return {
    authority: "human_accepted" as const,
    reviewPackSha256: artifacts.scopeReviewPack.artifactSha256,
    humanDecisionsSha256: computeGrandHallT554HumanDecisionsSha256(artifacts.humanDecisions),
    closedVolumeReviewSha256: computeGrandHallT554ClosedVolumeReviewSha256(
      artifacts.closedVolumeReview,
    ),
    artifactSha256s: {
      roomMembership: artifacts.membership.artifactSha256,
      interfaceDecisions: artifacts.portals.artifactSha256,
      closedBoundary: artifacts.boundary.artifactSha256,
      panoramaMaskSet: artifacts.panoramaMasks.artifactSha256,
    },
    schemaVersion: "venviewer.grand-hall-t554-acceptance-publication.v1" as const,
    state: "complete" as const,
    productionTrust: null,
    runtimeAdmissionAuthorized: false as const,
    reconstructionAuthorized: false as const,
    files,
  };
}

async function writePublicationReceipt(
  fixture: Fixture,
  artifacts: AcceptedArtifacts,
): Promise<void> {
  await writeCanonical(
    join(fixture.bundleRoot, ARTIFACT_FILES.publicationReceipt),
    await buildPublicationReceipt(fixture, artifacts),
  );
}

async function restoreFixture(fixture: Fixture): Promise<void> {
  await Promise.all([
    rm(fixture.bundleRoot, { recursive: true, force: true }),
    rm(fixture.xgridsRoot, { recursive: true, force: true }),
    rm(fixture.outsideRoot, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(fixture.bundleRoot, { recursive: true }),
    mkdir(join(fixture.bundleRoot, "masks"), { recursive: true }),
    mkdir(join(fixture.xgridsRoot, "creator-data"), { recursive: true }),
    mkdir(fixture.outsideRoot, { recursive: true }),
  ]);
  await writeArtifacts(fixture, fixture.artifacts);
  await Promise.all([
    writeFile(join(fixture.bundleRoot, "masks/mask-000.png"), fixture.maskPng),
    writeFile(join(fixture.bundleRoot, "masks/output-membership.bin"), fixture.bitset),
    writeFile(
      join(fixture.xgridsRoot, "creator-data/member-000.lcc"),
      fixture.sourceMemberBytes[0],
    ),
    writeFile(
      join(fixture.xgridsRoot, "creator-data/member-001.lcc"),
      fixture.sourceMemberBytes[1],
    ),
    writeFile(join(fixture.panoramaRoot, "sweep-001.jpg"), fixture.sourceJpeg),
    writeFile(join(fixture.panoramaRoot, "unreviewed-sweep-051.jpg"), fixture.sourceJpeg),
    rm(join(fixture.panoramaRoot, "unexpected-panorama.jpg"), { force: true }),
  ]);
  await writePublicationReceipt(fixture, fixture.artifacts);
}

function sealPanoramaMasks(
  draft: DeepMutable<GrandHallPanoramaMaskSetV1>,
): GrandHallPanoramaMaskSetV1 {
  const { artifactSha256: _artifactSha256, ...candidate } = draft;
  const material = GrandHallPanoramaMaskSetV1MaterialSchema.parse(candidate);
  return GrandHallPanoramaMaskSetV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallPanoramaMaskSetV1Sha256(material),
  });
}

function sealMembership(
  draft: DeepMutable<AcceptedArtifacts["membership"]>,
): AcceptedArtifacts["membership"] {
  const { artifactSha256: _artifactSha256, ...candidate } = draft;
  const material = GrandHallRoomMembershipV2MaterialSchema.parse(candidate);
  return GrandHallRoomMembershipV2Schema.parse({
    ...material,
    artifactSha256: computeGrandHallRoomMembershipV2Sha256(material),
  });
}

function sealScopeReviewPack(
  draft: DeepMutable<AcceptedArtifacts["scopeReviewPack"]>,
): AcceptedArtifacts["scopeReviewPack"] {
  const { artifactSha256: _artifactSha256, ...candidate } = draft;
  const material = GrandHallScopeReviewPackMaterialV1Schema.parse(candidate);
  return GrandHallScopeReviewPackV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallScopeReviewPackV1Sha256(material),
  });
}

function sealPortals(
  draft: DeepMutable<AcceptedArtifacts["portals"]>,
): AcceptedArtifacts["portals"] {
  const { artifactSha256: _artifactSha256, ...candidate } = draft;
  const material = GrandHallPortalDecisionsV1MaterialSchema.parse(candidate);
  return GrandHallPortalDecisionsV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallPortalDecisionsV1Sha256(material),
  });
}

function sealBoundary(
  draft: DeepMutable<AcceptedArtifacts["boundary"]>,
): AcceptedArtifacts["boundary"] {
  const { artifactSha256: _artifactSha256, ...candidate } = draft;
  const material = GrandHallClosedBoundaryV1MaterialSchema.parse(candidate);
  return GrandHallClosedBoundaryV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallClosedBoundaryV1Sha256(material),
  });
}

function sealTransform(
  draft: DeepMutable<AcceptedArtifacts["transform"]>,
): AcceptedArtifacts["transform"] {
  const { artifactSha256: _artifactSha256, ...candidate } = draft;
  const material = GrandHallReviewedTransformV1MaterialSchema.parse(candidate);
  return GrandHallReviewedTransformV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallReviewedTransformV1Sha256(material),
  });
}

function sealOutputMask(
  draft: DeepMutable<GrandHallOutputInventoryMaskV1>,
): GrandHallOutputInventoryMaskV1 {
  const { artifactSha256: _artifactSha256, ...candidate } = draft;
  const material = GrandHallOutputInventoryMaskV1MaterialSchema.parse(candidate);
  return GrandHallOutputInventoryMaskV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallOutputInventoryMaskV1Sha256(material),
  });
}

async function writeArtifactsReboundToHumanDecisions(
  fixture: Fixture,
  humanDecisions: AcceptedArtifacts["humanDecisions"],
): Promise<void> {
  const decisionsSha256 = computeGrandHallT554HumanDecisionsSha256(humanDecisions);
  const membershipDraft = structuredClone(fixture.artifacts.membership) as DeepMutable<
    AcceptedArtifacts["membership"]
  >;
  membershipDraft.panoramaRecords.forEach((record) => {
    record.decisionEvidenceSha256 = decisionsSha256;
  });
  const membership = sealMembership(membershipDraft);
  const portalsDraft = structuredClone(fixture.artifacts.portals) as DeepMutable<
    AcceptedArtifacts["portals"]
  >;
  portalsDraft.decisions.forEach((decision) => {
    decision.grandHallSideEvidenceSha256 = decisionsSha256;
  });
  const portals = sealPortals(portalsDraft);
  const boundaryDraft = structuredClone(fixture.artifacts.boundary) as DeepMutable<
    AcceptedArtifacts["boundary"]
  >;
  boundaryDraft.roomMembershipArtifactSha256 = membership.artifactSha256;
  boundaryDraft.portalDecisionArtifactSha256 = portals.artifactSha256;
  boundaryDraft.semanticRefinements.forEach((refinement) => {
    refinement.evidenceSha256 = decisionsSha256;
  });
  const boundary = sealBoundary(boundaryDraft);
  const panoramaMasksDraft = structuredClone(fixture.artifacts.panoramaMasks) as DeepMutable<
    GrandHallPanoramaMaskSetV1
  >;
  panoramaMasksDraft.membershipArtifactSha256 = membership.artifactSha256;
  panoramaMasksDraft.portalDecisionArtifactSha256 = portals.artifactSha256;
  const panoramaMasks = sealPanoramaMasks(panoramaMasksDraft);
  const outputMaskDraft = structuredClone(fixture.artifacts.outputMask) as DeepMutable<
    GrandHallOutputInventoryMaskV1
  >;
  outputMaskDraft.closedBoundaryArtifactSha256 = boundary.artifactSha256;
  const outputMask = sealOutputMask(outputMaskDraft);
  await writeArtifacts(fixture, {
    ...fixture.artifacts,
    humanDecisions,
    membership,
    portals,
    boundary,
    panoramaMasks,
    outputMask,
  });
}

async function installMaskVariant(
  fixture: Fixture,
  bytes: Buffer,
  mutateMask?: (
    mask: DeepMutable<GrandHallPanoramaMaskSetV1>["sourceRecords"][number] extends infer _Record
      ? DeepMutable<GrandHallPanoramaMaskSetV1>["sourceRecords"][number]
      : never,
  ) => void,
): Promise<void> {
  const draft = structuredClone(fixture.artifacts.panoramaMasks) as DeepMutable<GrandHallPanoramaMaskSetV1>;
  const first = draft.sourceRecords[0];
  if (first === undefined || first.disposition !== "include_with_binary_pixel_mask") {
    throw new Error("Synthetic fixture lost its included panorama record");
  }
  first.mask.sha256 = digest(bytes);
  first.mask.byteLength = bytes.length;
  mutateMask?.(first);
  const sealed = sealPanoramaMasks(draft);
  await Promise.all([
    writeFile(join(fixture.bundleRoot, first.mask.fileName), bytes),
    writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.panoramaMaskSet), sealed),
  ]);
}

async function installBitsetVariant(
  fixture: Fixture,
  bytes: Buffer,
  mutate?: (draft: DeepMutable<GrandHallOutputInventoryMaskV1>) => void,
): Promise<void> {
  const draft = structuredClone(fixture.artifacts.outputMask) as DeepMutable<GrandHallOutputInventoryMaskV1>;
  draft.bitsetSha256 = digest(bytes);
  mutate?.(draft);
  const sealed = sealOutputMask(draft);
  await Promise.all([
    writeFile(join(fixture.bundleRoot, draft.bitsetFileName), bytes),
    writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.outputInventoryMask), sealed),
  ]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function insertPngTextChunk(bytes: Buffer): Buffer {
  const iendOffset = bytes.lastIndexOf(Buffer.from("IEND", "ascii")) - 4;
  if (iendOffset < 8) throw new Error("Synthetic PNG has no IEND chunk");
  const type = Buffer.from("tEXt", "ascii");
  const data = Buffer.from("review\0unexpected-metadata", "latin1");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  return Buffer.concat([bytes.subarray(0, iendOffset), chunk, bytes.subarray(iendOffset)]);
}

function stripPngToPixelChunks(bytes: Buffer): Buffer {
  const retained: Buffer[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error("Synthetic PNG chunk is truncated");
    if (type === "IHDR" || type === "IDAT" || type === "IEND") {
      retained.push(bytes.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }
  return Buffer.concat(retained);
}

async function createFixture(): Promise<Fixture> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "grand-hall-accepted-bundle-"));
  const bundleRoot = join(temporaryRoot, "bundle");
  const panoramaRoot = join(temporaryRoot, "panoramas");
  const xgridsRoot = join(temporaryRoot, "xgrids-output");
  const outsideRoot = join(temporaryRoot, "outside");
  await Promise.all([
    mkdir(bundleRoot, { recursive: true }),
    mkdir(panoramaRoot, { recursive: true }),
    mkdir(xgridsRoot, { recursive: true }),
    mkdir(outsideRoot, { recursive: true }),
  ]);

  const sourceJpeg = await sharp({
    create: {
      width: GRAND_HALL_PANORAMA_WIDTH_PX,
      height: GRAND_HALL_PANORAMA_HEIGHT_PX,
      channels: 3,
      background: { r: 24, g: 32, b: 40 },
    },
  }).jpeg({ quality: 80, chromaSubsampling: "4:4:4" }).toBuffer();
  const maskPixels = Buffer.alloc(PIXEL_COUNT, 0);
  maskPixels[PIXEL_COUNT - 1] = 255;
  const encodedMaskPng = await sharp(maskPixels, {
    raw: {
      width: GRAND_HALL_PANORAMA_WIDTH_PX,
      height: GRAND_HALL_PANORAMA_HEIGHT_PX,
      channels: 1,
    },
  }).toColourspace("b-w").png({ compressionLevel: 9, palette: false }).toBuffer();
  const maskPng = stripPngToPixelChunks(encodedMaskPng);
  const bitset = Buffer.from([0b00010111, 0b00000001]);
  const sourceMemberBytes = [
    Buffer.from([0x10, 0x11, 0x12, 0x13]),
    Buffer.from([0x20, 0x21, 0x22, 0x23, 0x24, 0x25]),
  ] as const;
  const artifacts = createAcceptedArtifacts({
    sourceJpegSha256: digest(sourceJpeg),
    sourceJpegByteLength: sourceJpeg.length,
    maskSha256: digest(maskPng),
    maskByteLength: maskPng.length,
    memberSha256s: [digest(sourceMemberBytes[0]), digest(sourceMemberBytes[1])],
    memberByteLengths: [sourceMemberBytes[0].length, sourceMemberBytes[1].length],
    bitsetSha256: digest(bitset),
    bitsetByteLength: bitset.length,
  });
  const fixture: Fixture = {
    temporaryRoot,
    bundleRoot,
    panoramaRoot,
    xgridsRoot,
    outsideRoot,
    options: {
      bundleRoot,
      panoramaSourceRoot: panoramaRoot,
      xgridsOutputRoot: xgridsRoot,
      artifactFiles: ARTIFACT_FILES,
      createXgridsSourceMemberInspector: () => {
        let observedByteCount = 0;
        return {
          update: (bytes, absoluteOffset) => {
            if (absoluteOffset !== observedByteCount) {
              throw new Error("Synthetic member chunks were not delivered in native file order");
            }
            observedByteCount += bytes.byteLength;
          },
          finish: () => ({
            recordKind: "gaussian" as const,
            recordCount: observedByteCount,
            recordOrder: "native_file_order" as const,
          }),
        };
      },
    },
    sourceJpeg,
    maskPng,
    bitset,
    sourceMemberBytes,
    artifacts,
  };
  await mkdir(join(panoramaRoot, "seed"), { recursive: true });
  const seedPath = join(panoramaRoot, "seed/source.jpg");
  await writeFile(seedPath, sourceJpeg);
  await Promise.all(
    artifacts.scopeReviewPack.panoramaDirectoryFiles.map(async (source) => {
      const path = join(panoramaRoot, source.fileName);
      await mkdir(dirname(path), { recursive: true });
      await copyFile(seedPath, path);
    }),
  );
  await rm(join(panoramaRoot, "seed"), { recursive: true, force: true });
  await restoreFixture(fixture);
  return fixture;
}

function optionsWithInspectorMutation(
  fixture: Fixture,
  triggerMemberIndex: number,
  mutate: () => Promise<void>,
): { readonly options: VerifyGrandHallAcceptedScopeBundleOptions; wasPerformed(): boolean } {
  let performed = false;
  return {
    options: {
      ...fixture.options,
      createXgridsSourceMemberInspector: (member) => {
        let observedByteCount = 0;
        return {
          update: async (bytes, absoluteOffset) => {
            if (absoluteOffset !== observedByteCount) {
              throw new Error("Synthetic member chunks were not delivered in native file order");
            }
            observedByteCount += bytes.byteLength;
            if (!performed && member.memberIndex === triggerMemberIndex) {
              performed = true;
              await mutate();
            }
          },
          finish: () => ({
            recordKind: "gaussian" as const,
            recordCount: observedByteCount,
            recordOrder: "native_file_order" as const,
          }),
        };
      },
    },
    wasPerformed: () => performed,
  };
}

async function removeFinalLf(path: string): Promise<void> {
  const bytes = await readFile(path);
  if (bytes[bytes.length - 1] !== 0x0a) throw new Error("Synthetic JSON lost its final LF");
  await writeFile(path, bytes.subarray(0, bytes.length - 1));
}

async function flipFinalByte(path: string): Promise<void> {
  const bytes = await readFile(path);
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
  await writeFile(path, bytes);
}

describe("Grand Hall accepted scope bundle verifier", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  }, 30_000);

  beforeEach(async () => {
    await restoreFixture(fixture);
  });

  afterAll(async () => {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  });

  it("verifies the complete byte-bound bundle without activating production trust", async () => {
    const result = await verifyGrandHallAcceptedScopeBundle(fixture.options);

    expect(result).toMatchObject({
      verifierVersion: GRAND_HALL_ACCEPTED_SCOPE_BUNDLE_VERIFIER_VERSION,
      integrityVerified: true,
      sourceRecordStructureVerified: true,
      productionTrustActivated: false,
      runtimeAdmissionAuthorized: false,
      semanticAccuracyReReviewed: false,
      humanDecisionsSha256: computeGrandHallT554HumanDecisionsSha256(
        fixture.artifacts.humanDecisions,
      ),
      closedVolumeReviewSha256: computeGrandHallT554ClosedVolumeReviewSha256(
        fixture.artifacts.closedVolumeReview,
      ),
      panoramaSourceCount: 148,
      panoramaMaskCount: 1,
      xgridsSourceMemberCount: 2,
      outputRecordCount: 10,
      includedRecordCount: 5,
      excludedRecordCount: 5,
      verifiedFileCount: 162,
    });
  });

  it("does not treat an authority-none panorama sequence hypothesis as a geometric transform", async () => {
    const scopeDraft = structuredClone(fixture.artifacts.scopeReviewPack) as DeepMutable<
      AcceptedArtifacts["scopeReviewPack"]
    >;
    scopeDraft.panoramaE57SequenceHypotheses =
      scopeDraft.panoramaE57SequenceHypotheses.map((hypothesis, index) => ({
        ...hypothesis,
        candidateScanIndex: index === 0 ? 148 : index - 1,
    }));
    const scopeReviewPack = sealScopeReviewPack(scopeDraft);
    const humanDecisionsDraft = structuredClone(
      fixture.artifacts.humanDecisions,
    ) as DeepMutable<AcceptedArtifacts["humanDecisions"]>;
    humanDecisionsDraft.reviewPackSha256 = scopeReviewPack.artifactSha256;
    const humanDecisions = GrandHallT554HumanDecisionsSchema.parse(humanDecisionsDraft);
    const humanDecisionsSha256 = computeGrandHallT554HumanDecisionsSha256(humanDecisions);
    const volumeDraft = structuredClone(
      fixture.artifacts.closedVolumeReview,
    ) as DeepMutable<AcceptedArtifacts["closedVolumeReview"]>;
    volumeDraft.reviewPackSha256 = scopeReviewPack.artifactSha256;
    const closedVolumeReview = GrandHallT554ClosedVolumeReviewSchema.parse(volumeDraft);

    const membershipDraft = structuredClone(fixture.artifacts.membership) as DeepMutable<
      AcceptedArtifacts["membership"]
    >;
    membershipDraft.reviewPackSha256 = scopeReviewPack.artifactSha256;
    membershipDraft.panoramaRecords.forEach((record) => {
      record.decisionEvidenceSha256 = humanDecisionsSha256;
    });
    const membership = sealMembership(membershipDraft);

    const portalsDraft = structuredClone(fixture.artifacts.portals) as DeepMutable<
      AcceptedArtifacts["portals"]
    >;
    portalsDraft.reviewPackSha256 = scopeReviewPack.artifactSha256;
    portalsDraft.decisions.forEach((decision) => {
      decision.grandHallSideEvidenceSha256 = humanDecisionsSha256;
    });
    const portals = sealPortals(portalsDraft);

    const boundaryDraft = structuredClone(fixture.artifacts.boundary) as DeepMutable<
      AcceptedArtifacts["boundary"]
    >;
    boundaryDraft.reviewPackSha256 = scopeReviewPack.artifactSha256;
    boundaryDraft.roomMembershipArtifactSha256 = membership.artifactSha256;
    boundaryDraft.portalDecisionArtifactSha256 = portals.artifactSha256;
    boundaryDraft.semanticRefinements.forEach((refinement) => {
      refinement.evidenceSha256 = humanDecisionsSha256;
    });
    const boundary = sealBoundary(boundaryDraft);

    const panoramaMasksDraft = structuredClone(fixture.artifacts.panoramaMasks) as DeepMutable<
      GrandHallPanoramaMaskSetV1
    >;
    panoramaMasksDraft.reviewPackSha256 = scopeReviewPack.artifactSha256;
    panoramaMasksDraft.membershipArtifactSha256 = membership.artifactSha256;
    panoramaMasksDraft.portalDecisionArtifactSha256 = portals.artifactSha256;
    const panoramaMasks = sealPanoramaMasks(panoramaMasksDraft);

    const transformDraft = structuredClone(fixture.artifacts.transform) as DeepMutable<
      AcceptedArtifacts["transform"]
    >;
    transformDraft.scopeReviewPackSha256 = scopeReviewPack.artifactSha256;
    const transform = sealTransform(transformDraft);

    const outputMaskDraft = structuredClone(fixture.artifacts.outputMask) as DeepMutable<
      GrandHallOutputInventoryMaskV1
    >;
    outputMaskDraft.scopeReviewPackSha256 = scopeReviewPack.artifactSha256;
    outputMaskDraft.transformArtifactSha256 = transform.artifactSha256;
    outputMaskDraft.closedBoundaryArtifactSha256 = boundary.artifactSha256;
    const outputMask = sealOutputMask(outputMaskDraft);
    const artifacts = {
      scopeReviewPack,
      humanDecisions,
      closedVolumeReview,
      membership,
      portals,
      boundary,
      panoramaMasks,
      transform,
      outputMask,
    };
    await writeArtifacts(fixture, artifacts);
    await writePublicationReceipt(fixture, artifacts);

    const result = await verifyGrandHallAcceptedScopeBundle(fixture.options);
    expect(result.integrityVerified).toBe(true);
    expect(transform.matrixSha256).toBe(fixture.artifacts.transform.matrixSha256);
    expect(transform.transformArtifact.matrix).toEqual(
      fixture.artifacts.transform.transformArtifact.matrix,
    );
  });

  it("rejects accepted artifacts whose claimed T-554 review pack is absent", async () => {
    await rm(join(fixture.bundleRoot, ARTIFACT_FILES.scopeReviewPack));

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "PATH_NON_REGULAR",
    });
  });

  it.each([
    ["human decisions", ARTIFACT_FILES.humanDecisions],
    ["closed-volume review", ARTIFACT_FILES.closedVolumeReview],
  ])("rejects a bundle whose preserved %s record is absent", async (_label, relativePath) => {
    await rm(join(fixture.bundleRoot, relativePath));

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "PATH_NON_REGULAR",
    });
  });

  it("rejects a bundle whose canonical publication receipt is absent", async () => {
    await rm(join(fixture.bundleRoot, ARTIFACT_FILES.publicationReceipt));

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "PATH_NON_REGULAR",
    });
  });

  it("rejects incomplete or authority-bearing publication receipt state", async () => {
    const receipt = await buildPublicationReceipt(fixture, fixture.artifacts);
    const variants: readonly unknown[] = [
      { ...receipt, state: "incomplete" },
      { ...receipt, authority: "none" },
      { ...receipt, productionTrust: "synthetic-trust-root" },
      { ...receipt, runtimeAdmissionAuthorized: true },
      { ...receipt, reconstructionAuthorized: true },
    ];
    for (const variant of variants) {
      await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.publicationReceipt), variant);
      await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
        code: "SCHEMA_INVALID",
      });
    }
  });

  it("rejects stale formal-review and accepted-artifact receipt digests", async () => {
    const receipt = await buildPublicationReceipt(fixture, fixture.artifacts);
    const variants: readonly unknown[] = [
      { ...receipt, humanDecisionsSha256: syntheticDigest(8_001) },
      {
        ...receipt,
        artifactSha256s: {
          ...receipt.artifactSha256s,
          roomMembership: syntheticDigest(8_002),
        },
      },
    ];
    for (const variant of variants) {
      await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.publicationReceipt), variant);
      await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
        code: "CROSS_BINDING_MISMATCH",
      });
    }
  });

  it("rejects a receipt that omits a required T-554 payload", async () => {
    const receipt = await buildPublicationReceipt(fixture, fixture.artifacts);
    await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.publicationReceipt), {
      ...receipt,
      files: receipt.files.slice(1),
    });

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "SOURCE_INVENTORY_DRIFT",
    });
  });

  it("binds the complete closed-volume review note through the receipt digest", async () => {
    const draft = structuredClone(fixture.artifacts.closedVolumeReview) as DeepMutable<
      AcceptedArtifacts["closedVolumeReview"]
    >;
    draft.note = "A changed human note that the geometric artifact itself does not contain.";
    const changed = GrandHallT554ClosedVolumeReviewSchema.parse(draft);
    await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.closedVolumeReview), changed);
    await writePublicationReceipt(fixture, fixture.artifacts);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "CROSS_BINDING_MISMATCH",
    });
  });

  it("rejects stale exact byte receipts even when canonical JSON semantics are unchanged", async () => {
    const path = join(fixture.bundleRoot, ARTIFACT_FILES.scopeReviewPack);
    const bytes = await readFile(path);
    if (bytes[bytes.length - 1] !== 0x0a) throw new Error("Synthetic JSON lost its final LF");
    await writeFile(path, bytes.subarray(0, bytes.length - 1));

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "FILE_SIZE_MISMATCH",
    });
  });

  it("rejects undeclared files in the exact accepted bundle inventory", async () => {
    await writeFile(join(fixture.bundleRoot, "undeclared-payload.bin"), "drift", "utf8");

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "SOURCE_INVENTORY_DRIFT",
    });
  });

  it("rejects duplicate keys in a formal T-554 review record", async () => {
    const path = join(fixture.bundleRoot, ARTIFACT_FILES.humanDecisions);
    const canonical = (await readFile(path)).toString("utf8");
    const duplicateKeyJson = canonical.replace(
      '"authority":"none"',
      '"authority":"none","authority":"none"',
    );
    if (duplicateKeyJson === canonical) {
      throw new Error("Synthetic duplicate-key mutation did not alter the review JSON");
    }
    await writeFile(path, duplicateKeyJson, "utf8");

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "JSON_INVALID",
    });
  });

  it("rejects a structurally valid formal review that is still human pending", async () => {
    const draft = structuredClone(fixture.artifacts.humanDecisions) as DeepMutable<
      AcceptedArtifacts["humanDecisions"]
    >;
    draft.reviewState = "human_pending";
    draft.finalDecision = "PENDING";
    draft.reviewer = null;
    const pending = GrandHallT554HumanDecisionsSchema.parse(draft);
    await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.humanDecisions), pending);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "CROSS_BINDING_MISMATCH",
    });
  });

  it("rejects preserved human decisions whose recomputed digest is not artifact-bound", async () => {
    const draft = structuredClone(fixture.artifacts.humanDecisions) as DeepMutable<
      AcceptedArtifacts["humanDecisions"]
    >;
    const firstDecision = draft.panoramaDecisions[0];
    if (firstDecision === undefined) throw new Error("Synthetic review lost panorama one");
    firstDecision.note = "Tampered after artifact publication.";
    const tampered = GrandHallT554HumanDecisionsSchema.parse(draft);
    await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.humanDecisions), tampered);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "CROSS_BINDING_MISMATCH",
    });
  });

  it("rejects coherently re-digested decisions when artifact reviewers do not match", async () => {
    const draft = structuredClone(fixture.artifacts.humanDecisions) as DeepMutable<
      AcceptedArtifacts["humanDecisions"]
    >;
    if (draft.reviewer === null) throw new Error("Synthetic review lost its reviewer");
    draft.reviewer.reviewerId = "different-authorized-reviewer";
    const tampered = GrandHallT554HumanDecisionsSchema.parse(draft);
    await writeArtifactsReboundToHumanDecisions(fixture, tampered);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "CROSS_BINDING_MISMATCH",
    });
  });

  it("rejects a preserved volume whose reviewed geometry differs from the boundary", async () => {
    const draft = structuredClone(fixture.artifacts.closedVolumeReview) as DeepMutable<
      AcceptedArtifacts["closedVolumeReview"]
    >;
    draft.zMax = 7.5;
    const tampered = GrandHallT554ClosedVolumeReviewSchema.parse(draft);
    await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.closedVolumeReview), tampered);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "CROSS_BINDING_MISMATCH",
    });
  });

  it("rejects a preserved volume reviewer who differs from the boundary reviewer", async () => {
    const draft = structuredClone(fixture.artifacts.closedVolumeReview) as DeepMutable<
      AcceptedArtifacts["closedVolumeReview"]
    >;
    if (draft.reviewer === null) throw new Error("Synthetic volume lost its reviewer");
    draft.reviewer.reviewerId = "different-volume-reviewer";
    const tampered = GrandHallT554ClosedVolumeReviewSchema.parse(draft);
    await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.closedVolumeReview), tampered);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "CROSS_BINDING_MISMATCH",
    });
  });

  it("rejects a mask artifact that differs from a coherently re-digested reviewed binding", async () => {
    const draft = structuredClone(fixture.artifacts.humanDecisions) as DeepMutable<
      AcceptedArtifacts["humanDecisions"]
    >;
    const binding = draft.panoramaDecisions[0]?.reviewedMaskBinding;
    if (binding === null || binding === undefined) {
      throw new Error("Synthetic review lost its exact mask binding");
    }
    binding.sha256 = syntheticDigest(9_997);
    const tampered = GrandHallT554HumanDecisionsSchema.parse(draft);
    await writeArtifactsReboundToHumanDecisions(fixture, tampered);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "CROSS_BINDING_MISMATCH",
    });
  });

  it("rejects coherently re-sealed XGRIDS lineage that contradicts the T-554 root", async () => {
    const driftedReceiptSha256 = syntheticDigest(9_998);
    const transformDraft = structuredClone(fixture.artifacts.transform) as DeepMutable<
      AcceptedArtifacts["transform"]
    >;
    transformDraft.sourceXgridsReceiptSha256 = driftedReceiptSha256;
    const sourceReceiptProvenance = transformDraft.transformArtifact.provenance.refs.find(
      (ref) => ref.role === "source_xgrids_receipt",
    );
    if (sourceReceiptProvenance === undefined) {
      throw new Error("Synthetic transform lost its XGRIDS source receipt provenance");
    }
    sourceReceiptProvenance.ref = driftedReceiptSha256;
    const transform = sealTransform(transformDraft);

    const outputDraft = structuredClone(fixture.artifacts.outputMask) as DeepMutable<
      GrandHallOutputInventoryMaskV1
    >;
    outputDraft.xgridsSourceReceiptSha256 = driftedReceiptSha256;
    outputDraft.transformArtifactSha256 = transform.artifactSha256;
    const outputMask = sealOutputMask(outputDraft);
    await Promise.all([
      writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.reviewedTransform), transform),
      writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.outputInventoryMask), outputMask),
    ]);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "CROSS_BINDING_MISMATCH",
    });
  });

  it("rejects canonical artifact tampering with a stale self-digest", async () => {
    const tampered = structuredClone(fixture.artifacts.membership) as DeepMutable<
      AcceptedArtifacts["membership"]
    >;
    tampered.humanReview.reviewerId = "tampered-reviewer";
    await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.roomMembership), tampered);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
    });
  });

  it("rejects a re-sealed artifact that breaks cross-artifact transform binding", async () => {
    const draft = structuredClone(fixture.artifacts.outputMask) as DeepMutable<
      GrandHallOutputInventoryMaskV1
    >;
    draft.transformArtifactSha256 = syntheticDigest(9_999);
    const sealed = sealOutputMask(draft);
    await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.outputInventoryMask), sealed);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "CROSS_BINDING_MISMATCH",
    });
  });

  it("rejects a re-sealed boundary operation that contradicts its portal resolution", async () => {
    const boundaryDraft = structuredClone(fixture.artifacts.boundary) as DeepMutable<
      AcceptedArtifacts["boundary"]
    >;
    const secondRefinement = boundaryDraft.semanticRefinements[1];
    if (secondRefinement === undefined) throw new Error("Synthetic boundary lost interface two");
    secondRefinement.operation = "remove_non_architectural_capture_artifact";
    const boundary = sealBoundary(boundaryDraft);
    const outputDraft = structuredClone(fixture.artifacts.outputMask) as DeepMutable<
      GrandHallOutputInventoryMaskV1
    >;
    outputDraft.closedBoundaryArtifactSha256 = boundary.artifactSha256;
    const outputMask = sealOutputMask(outputDraft);
    await Promise.all([
      writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.closedBoundary), boundary),
      writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.outputInventoryMask), outputMask),
    ]);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "CROSS_BINDING_MISMATCH",
    });
  });

  it("rejects malformed UTF-8 before schema or cross-binding evaluation", async () => {
    const draft = structuredClone(fixture.artifacts.membership) as DeepMutable<
      AcceptedArtifacts["membership"]
    >;
    draft.humanReview.reviewerId = "synthetic-reviewer-\ufffd\ufffd";
    const sealed = sealMembership(draft);
    const validBytes = Buffer.from(`${stableCanonicalJson(sealed)}\n`, "utf8");
    const replacementBytes = Buffer.from("\ufffd\ufffd", "utf8");
    const replacementOffset = validBytes.indexOf(replacementBytes);
    if (replacementOffset < 0) throw new Error("Synthetic UTF-8 marker was not serialized");
    const malformedBytes = Buffer.concat([
      validBytes.subarray(0, replacementOffset),
      Buffer.from([0xc0, 0xaf]),
      validBytes.subarray(replacementOffset + replacementBytes.length),
    ]);
    await writeFile(
      join(fixture.bundleRoot, ARTIFACT_FILES.roomMembership),
      malformedBytes,
    );

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "JSON_INVALID",
    });
  });

  it("rejects a UTF-8 byte-order mark on otherwise canonical artifact JSON", async () => {
    const canonical = await readFile(
      join(fixture.bundleRoot, ARTIFACT_FILES.roomMembership),
    );
    await writeFile(
      join(fixture.bundleRoot, ARTIFACT_FILES.roomMembership),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical]),
    );

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "JSON_NON_CANONICAL",
    });
  });

  it("rejects a mask encoded as RGB instead of one-channel grayscale8", async () => {
    const encoded = await sharp({
      create: {
        width: GRAND_HALL_PANORAMA_WIDTH_PX,
        height: GRAND_HALL_PANORAMA_HEIGHT_PX,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).png().toBuffer();
    const bytes = stripPngToPixelChunks(encoded);
    await installMaskVariant(fixture, bytes);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "MASK_PNG_INVALID",
    });
  });

  it("rejects a mask whose decoded dimensions do not match the original source grid", async () => {
    const encoded = await sharp(Buffer.from([0]), {
      raw: { width: 1, height: 1, channels: 1 },
    }).toColourspace("b-w").png().toBuffer();
    const bytes = stripPngToPixelChunks(encoded);
    await installMaskVariant(fixture, bytes);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "MASK_PNG_INVALID",
    });
  });

  it("rejects non-binary grayscale mask values", async () => {
    const encoded = await sharp(Buffer.alloc(PIXEL_COUNT, 1), {
      raw: {
        width: GRAND_HALL_PANORAMA_WIDTH_PX,
        height: GRAND_HALL_PANORAMA_HEIGHT_PX,
        channels: 1,
      },
    }).toColourspace("b-w").png({ compressionLevel: 9, palette: false }).toBuffer();
    const bytes = stripPngToPixelChunks(encoded);
    await installMaskVariant(fixture, bytes);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "MASK_PNG_INVALID",
    });
  });

  it("rejects mask pixel counts that do not match the fully decoded binary grid", async () => {
    await installMaskVariant(fixture, fixture.maskPng, (record) => {
      if (record.disposition !== "include_with_binary_pixel_mask") return;
      record.mask.includedPixelCount = PIXEL_COUNT;
      record.mask.excludedPixelCount = 0;
      record.mask.reasonCodes = [];
    });

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "MASK_PNG_INVALID",
    });
  });

  it("rejects metadata-bearing mask PNGs", async () => {
    await installMaskVariant(fixture, insertPngTextChunk(fixture.maskPng));

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "MASK_PNG_INVALID",
    });
  });

  it("rejects a short output membership bitset", async () => {
    await writeFile(join(fixture.bundleRoot, "masks/output-membership.bin"), Buffer.from([0x17]));

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "FILE_SIZE_MISMATCH",
    });
  });

  it("rejects nonzero high padding bits in the final LSB-first bitset byte", async () => {
    await installBitsetVariant(fixture, Buffer.from([0b00010111, 0b10000001]), (draft) => {
      draft.includedRecordCount = 6;
      draft.excludedRecordCount = 4;
    });

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "BITSET_INVALID",
    });
  });

  it("rejects a bitset whose popcount differs from accepted record counts", async () => {
    await installBitsetVariant(fixture, Buffer.from([0b00011111, 0b00000001]));

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "BITSET_INVALID",
    });
  });

  it("rejects stale source ordering after a member-order mutation", async () => {
    const draft = structuredClone(fixture.artifacts.outputMask) as DeepMutable<
      GrandHallOutputInventoryMaskV1
    >;
    draft.sourceMembers.reverse();
    await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.outputInventoryMask), draft);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
    });
  });

  it("rejects source-member byte drift", async () => {
    await writeFile(
      join(fixture.xgridsRoot, "creator-data/member-001.lcc"),
      Buffer.alloc(fixture.sourceMemberBytes[1].length, 0x61),
    );

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "FILE_DIGEST_MISMATCH",
    });
  });

  it("rejects a format inspector that cannot corroborate member record counts", async () => {
    await expect(
      verifyGrandHallAcceptedScopeBundle({
        ...fixture.options,
        createXgridsSourceMemberInspector: (member) => ({
          update: () => undefined,
          finish: () => ({
            recordKind: "gaussian",
            recordCount: member.recordCount + 1,
            recordOrder: "native_file_order",
          }),
        }),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_MEMBER_INVALID" });
  });

  it("rejects same-path member replacement during same-descriptor streamed inspection", async () => {
    let replacementPerformed = false;
    await expect(
      verifyGrandHallAcceptedScopeBundle({
        ...fixture.options,
        createXgridsSourceMemberInspector: (member) => {
          let observedByteCount = 0;
          return {
            update: async (bytes, absoluteOffset) => {
              if (absoluteOffset !== observedByteCount) {
                throw new Error("Synthetic member chunks were not delivered in native file order");
              }
              observedByteCount += bytes.byteLength;
              if (member.memberIndex !== 0 || replacementPerformed) return;
              replacementPerformed = true;
              const sourcePath = join(fixture.xgridsRoot, member.fileName);
              const displacedPath = join(fixture.outsideRoot, "displaced-member-000.lcc");
              await rename(sourcePath, displacedPath);
              await writeFile(sourcePath, Buffer.from(bytes));
            },
            finish: () => ({
              recordKind: "gaussian" as const,
              recordCount: observedByteCount,
              recordOrder: "native_file_order" as const,
            }),
          };
        },
      }),
    ).rejects.toMatchObject({ code: "PATH_IDENTITY_CHANGED" });
    expect(replacementPerformed).toBe(true);
  });

  it("rejects a publication receipt mutated during later XGRIDS inspection", async () => {
    const mutation = optionsWithInspectorMutation(fixture, 0, () =>
      removeFinalLf(join(fixture.bundleRoot, ARTIFACT_FILES.publicationReceipt)));

    await expect(verifyGrandHallAcceptedScopeBundle(mutation.options)).rejects.toMatchObject({
      code: "PATH_IDENTITY_CHANGED",
    });
    expect(mutation.wasPerformed()).toBe(true);
  });

  it.each([
    ["reviewed transform", ARTIFACT_FILES.reviewedTransform],
    ["output inventory mask", ARTIFACT_FILES.outputInventoryMask],
  ])("rejects the %s when mutated during later XGRIDS inspection", async (_label, fileName) => {
    const mutation = optionsWithInspectorMutation(fixture, 0, () =>
      removeFinalLf(join(fixture.bundleRoot, fileName)));

    await expect(verifyGrandHallAcceptedScopeBundle(mutation.options)).rejects.toMatchObject({
      code: "PATH_IDENTITY_CHANGED",
    });
    expect(mutation.wasPerformed()).toBe(true);
  });

  it("rejects a panorama mutated after its initial 148-file verification", async () => {
    const mutation = optionsWithInspectorMutation(fixture, 0, () =>
      flipFinalByte(join(fixture.panoramaRoot, "sweep-001.jpg")));

    await expect(verifyGrandHallAcceptedScopeBundle(mutation.options)).rejects.toMatchObject({
      code: "PATH_IDENTITY_CHANGED",
    });
    expect(mutation.wasPerformed()).toBe(true);
  });

  it("rejects an earlier XGRIDS member mutated while inspecting the next member", async () => {
    const mutation = optionsWithInspectorMutation(fixture, 1, () =>
      flipFinalByte(join(fixture.xgridsRoot, "creator-data/member-000.lcc")));

    await expect(verifyGrandHallAcceptedScopeBundle(mutation.options)).rejects.toMatchObject({
      code: "PATH_IDENTITY_CHANGED",
    });
    expect(mutation.wasPerformed()).toBe(true);
  });

  it("rejects the output bitset when mutated during later XGRIDS inspection", async () => {
    const mutation = optionsWithInspectorMutation(fixture, 0, () =>
      flipFinalByte(join(fixture.bundleRoot, "masks/output-membership.bin")));

    await expect(verifyGrandHallAcceptedScopeBundle(mutation.options)).rejects.toMatchObject({
      code: "PATH_IDENTITY_CHANGED",
    });
    expect(mutation.wasPerformed()).toBe(true);
  });

  it("rejects undeclared files in the dedicated XGRIDS source-member root", async () => {
    await writeFile(join(fixture.xgridsRoot, "creator-data/undeclared.lcc"), "drift", "utf8");

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "SOURCE_INVENTORY_DRIFT",
    });
  });

  it("rejects hard-linked evidence files", async () => {
    const maskPath = join(fixture.bundleRoot, "masks/mask-000.png");
    const outsideMask = join(fixture.outsideRoot, "hard-linked-mask.png");
    await rm(maskPath);
    await writeFile(outsideMask, fixture.maskPng);
    await link(outsideMask, maskPath);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "PATH_LINK",
    });
  });

  it("rejects a referenced symlink or directory reparse point", async () => {
    const outsideMask = join(fixture.outsideRoot, "mask.png");
    const linkedDirectory = join(fixture.bundleRoot, "linked-mask-directory");
    await writeFile(outsideMask, fixture.maskPng);
    await symlink(
      fixture.outsideRoot,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    const draft = structuredClone(fixture.artifacts.panoramaMasks) as DeepMutable<
      GrandHallPanoramaMaskSetV1
    >;
    const first = draft.sourceRecords[0];
    if (first === undefined || first.disposition !== "include_with_binary_pixel_mask") {
      throw new Error("Synthetic fixture lost its included panorama record");
    }
    first.mask.fileName = "linked-mask-directory/mask.png";
    const sealed = sealPanoramaMasks(draft);
    await writeCanonical(join(fixture.bundleRoot, ARTIFACT_FILES.panoramaMaskSet), sealed);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "PATH_LINK",
    });
  });

  it("rejects traversal before resolving an artifact path", async () => {
    await expect(
      verifyGrandHallAcceptedScopeBundle({
        ...fixture.options,
        artifactFiles: { ...ARTIFACT_FILES, roomMembership: "../room-membership.json" },
      }),
    ).rejects.toMatchObject({ code: "PATH_UNSAFE" });
  });

  it("requires the canonical root publication-receipt.json artifact path", async () => {
    await expect(
      verifyGrandHallAcceptedScopeBundle({
        ...fixture.options,
        artifactFiles: { ...ARTIFACT_FILES, publicationReceipt: "review/receipt.json" },
      }),
    ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
  });

  it("rejects source JPEG drift before mask verification", async () => {
    const sourcePath = join(fixture.panoramaRoot, "sweep-001.jpg");
    const sourceBytes = await readFile(sourcePath);
    sourceBytes[sourceBytes.length - 1] = (sourceBytes[sourceBytes.length - 1] ?? 0) ^ 1;
    await writeFile(sourcePath, sourceBytes);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "FILE_DIGEST_MISMATCH",
    });
  });

  it("rejects a missing non-candidate panorama from the exact 148-file root", async () => {
    await rm(join(fixture.panoramaRoot, "unreviewed-sweep-051.jpg"));

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "SOURCE_INVENTORY_DRIFT",
    });
  });

  it("rejects undeclared panorama files outside the review-pack inventory", async () => {
    await writeFile(join(fixture.panoramaRoot, "unexpected-panorama.jpg"), fixture.sourceJpeg);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "SOURCE_INVENTORY_DRIFT",
    });
  });

  it("hashes and rejects byte drift in a non-candidate panorama", async () => {
    const path = join(fixture.panoramaRoot, "unreviewed-sweep-051.jpg");
    const bytes = await readFile(path);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    await writeFile(path, bytes);

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "FILE_DIGEST_MISMATCH",
    });
  });

  it("fully decodes a non-candidate and rejects truncation when every identity is re-sealed", async () => {
    const truncatedJpeg = Buffer.from(
      fixture.sourceJpeg.subarray(0, Math.floor(fixture.sourceJpeg.length / 2)),
    );
    const artifacts = createAcceptedArtifacts({
      sourceJpegSha256: digest(fixture.sourceJpeg),
      sourceJpegByteLength: fixture.sourceJpeg.length,
      firstNonCandidateSourceJpegSha256: digest(truncatedJpeg),
      firstNonCandidateSourceJpegByteLength: truncatedJpeg.length,
      maskSha256: digest(fixture.maskPng),
      maskByteLength: fixture.maskPng.length,
      memberSha256s: [digest(fixture.sourceMemberBytes[0]), digest(fixture.sourceMemberBytes[1])],
      memberByteLengths: [
        fixture.sourceMemberBytes[0].length,
        fixture.sourceMemberBytes[1].length,
      ],
      bitsetSha256: digest(fixture.bitset),
      bitsetByteLength: fixture.bitset.length,
    });
    await writeArtifacts(fixture, artifacts);
    await writePublicationReceipt(fixture, artifacts);
    await writeFile(
      join(fixture.panoramaRoot, "unreviewed-sweep-051.jpg"),
      truncatedJpeg,
    );

    await expect(verifyGrandHallAcceptedScopeBundle(fixture.options)).rejects.toMatchObject({
      code: "SOURCE_JPEG_INVALID",
    });
  });
});

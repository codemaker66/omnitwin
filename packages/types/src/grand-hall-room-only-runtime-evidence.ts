import { z } from "zod";

import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  GRAND_HALL_CLOSED_BOUNDARY_V1,
  GRAND_HALL_EXACT_INTERFACE_COUNT,
  GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
  GRAND_HALL_OUTPUT_INVENTORY_MASK_V1,
  GRAND_HALL_PANORAMA_MASK_SET_V1,
  GRAND_HALL_PORTAL_DECISIONS_V1,
  GRAND_HALL_REVIEW_PANORAMA_COUNT,
  GRAND_HALL_ROOM_MEMBERSHIP_V2,
  GRAND_HALL_XGRIDS_SOURCE_FRAME,
  GRAND_HALL_XGRIDS_TO_MATTERPAK_E57_TRANSFORM_V1,
} from "./grand-hall-room-scope-artifacts.js";
import { RuntimeSha256Schema } from "./runtime-venue-manifest.js";

export const GRAND_HALL_ROOM_ONLY_RUNTIME_EVIDENCE_V2 =
  "venviewer.grand-hall-room-only-runtime-evidence.v2";
export const GRAND_HALL_ROOM_ONLY_RUNTIME_DECISION_ID =
  "grand-hall-room-only-sog-fine-v2";
export const GRAND_HALL_ROOM_ONLY_RUNTIME_LOD_SELECTION_POLICY =
  "accepted-room-only-members-exclude-unknown-v2";
/** Intake and authenticated preview both buffer one member; split larger SOG output. */
export const GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES = 16 * 1_024 * 1_024;
/** The source frontier has 11 members; 32 permits conservative re-chunking. */
export const GRAND_HALL_ROOM_ONLY_MAX_MEMBER_COUNT = 32;
/** Source members peak below 609k Gaussians; retain bounded decode headroom. */
export const GRAND_HALL_ROOM_ONLY_MAX_MEMBER_GAUSSIAN_COUNT = 1_000_000;
/** The complete source has 6,019,684 Gaussians; a crop must remain below this safety headroom. */
export const GRAND_HALL_ROOM_ONLY_MAX_TOTAL_GAUSSIAN_COUNT = 8_000_000;
/**
 * The browser's atomic exact loader retains every verified member until the
 * complete set is decoded. Keep the admitted package just above the roughly
 * 106 MB source frontier while preventing a manifest from authorising a
 * multi-gigabyte allocation. The accepted crop should be smaller than source.
 */
export const GRAND_HALL_ROOM_ONLY_MAX_TOTAL_BYTES = 128 * 1_024 * 1_024;

/**
 * The current reviewed-by-agent, human-pending membership artifact is useful
 * authoring evidence but grants no runtime authority. A v2 acceptance can
 * never relabel these exact pending bytes as an accepted decision.
 */
export const GRAND_HALL_PENDING_ROOM_MEMBERSHIP_V1_SHA256 =
  "sha256:e2822de20e28bbeeb7ca81c8aad96214852e39bdc206e3d378d37d80c2904c68";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const Sha256HexSchema = z.string().regex(SHA256_HEX);
const IsoInstantSchema = z.string().datetime({ offset: true });
const EvidenceByteLengthSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const GrandHallRoomOnlyVisualMemberV2Schema = z
  .object({
    fileName: z.string().trim().min(1).max(255).regex(/^[^/\\]+\.sog$/u),
    fileExt: z.literal(".sog"),
    sha256: Sha256HexSchema,
    sizeBytes: EvidenceByteLengthSchema.max(GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES),
    gaussianCount: z.number().int().positive()
      .max(GRAND_HALL_ROOM_ONLY_MAX_MEMBER_GAUSSIAN_COUNT),
  })
  .strict();

export type GrandHallRoomOnlyVisualMemberV2 = z.infer<
  typeof GrandHallRoomOnlyVisualMemberV2Schema
>;

export interface GrandHallRoomOnlyVisualMemberIdentity {
  readonly fileName: string;
  readonly fileExt: string;
  readonly sha256: string | null;
  readonly sizeBytes: number | null;
}

const AcceptedMembershipArtifactSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_ROOM_MEMBERSHIP_V2),
    sha256: RuntimeSha256Schema,
    byteLength: EvidenceByteLengthSchema,
    state: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSha256: RuntimeSha256Schema,
    sourcePanoramaInventorySha256: RuntimeSha256Schema,
    panoramaRecordCount: z.literal(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    geometricCameraAuthority: z.literal("none"),
  })
  .strict();

const AcceptedClosedBoundaryArtifactSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_CLOSED_BOUNDARY_V1),
    sha256: RuntimeSha256Schema,
    byteLength: EvidenceByteLengthSchema,
    state: z.literal("human_accepted_closed_volume"),
    productionTrust: z.null(),
    reviewPackSha256: RuntimeSha256Schema,
    roomMembershipArtifactSha256: RuntimeSha256Schema,
    portalDecisionArtifactSha256: RuntimeSha256Schema,
    portalInterfaceInventorySha256: RuntimeSha256Schema,
    sourceFrame: z.literal(GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME),
    geometryRole: z.literal("non_rendered_selection_volume"),
    construction: z.literal("extruded_simple_xy_polygon"),
    nonConvex: z.literal(true),
    pointOnBoundaryPolicy: z.literal("include_as_inside"),
    closedVolume: z.literal(true),
    cameraMembershipOnly: z.literal(false),
  })
  .strict();

const AcceptedPortalDecisionArtifactSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_PORTAL_DECISIONS_V1),
    sha256: RuntimeSha256Schema,
    byteLength: EvidenceByteLengthSchema,
    state: z.literal("human_accepted_all_interfaces_resolved"),
    productionTrust: z.null(),
    reviewPackSha256: RuntimeSha256Schema,
    interfaceInventorySha256: RuntimeSha256Schema,
    interfaceCount: z.literal(GRAND_HALL_EXACT_INTERFACE_COUNT),
    allInterfacesResolved: z.literal(true),
  })
  .strict();

const AcceptedPanoramaMaskSetArtifactSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_PANORAMA_MASK_SET_V1),
    sha256: RuntimeSha256Schema,
    byteLength: EvidenceByteLengthSchema,
    state: z.literal("human_accepted_complete"),
    productionTrust: z.null(),
    reviewPackSha256: RuntimeSha256Schema,
    membershipArtifactSha256: RuntimeSha256Schema,
    portalDecisionArtifactSha256: RuntimeSha256Schema,
    sourcePanoramaInventorySha256: RuntimeSha256Schema,
    geometricCameraAuthority: z.literal("none"),
    sourceRecordCount: z.literal(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    maskCount: z.number().int().positive(),
    wholeFrameExclusionCount: z.number().int().nonnegative(),
    encoding: z.literal("png_grayscale8_binary_v1"),
    coordinateSpace: z.literal("original_8192x4096_equirectangular_pixel_grid"),
    excludedValue: z.literal(255),
  })
  .strict();

const AcceptedReviewedTransformArtifactSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_XGRIDS_TO_MATTERPAK_E57_TRANSFORM_V1),
    sha256: RuntimeSha256Schema,
    byteLength: EvidenceByteLengthSchema,
    state: z.literal("human_accepted_reviewed_transform"),
    productionTrust: z.null(),
    scopeReviewPackSha256: RuntimeSha256Schema,
    transformArtifactId: z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/u),
    sourceFrame: z.literal(GRAND_HALL_XGRIDS_SOURCE_FRAME),
    targetFrame: z.literal(GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME),
    alignmentMethod: z.literal("landmark_solve"),
    sourceXgridsReceiptSha256: RuntimeSha256Schema,
    sourceXgridsOutputInventorySha256: RuntimeSha256Schema,
    targetMatterPakE57ReceiptSha256: RuntimeSha256Schema,
    targetBoundaryEvidenceSha256: RuntimeSha256Schema,
    matrixSha256: RuntimeSha256Schema,
    landmarkCount: z.number().int().min(3),
  })
  .strict();

const AcceptedOutputInventoryMaskArtifactSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_OUTPUT_INVENTORY_MASK_V1),
    sha256: RuntimeSha256Schema,
    byteLength: EvidenceByteLengthSchema,
    state: z.literal("human_accepted_complete"),
    productionTrust: z.null(),
    scopeReviewPackSha256: RuntimeSha256Schema,
    sourceFrame: z.literal(GRAND_HALL_XGRIDS_SOURCE_FRAME),
    classificationFrame: z.literal(GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME),
    recordKind: z.literal("gaussian"),
    xgridsSourceReceiptSha256: RuntimeSha256Schema,
    xgridsOutputInventorySha256: RuntimeSha256Schema,
    sourceOrderingSha256: RuntimeSha256Schema,
    transformArtifactSha256: RuntimeSha256Schema,
    closedBoundaryArtifactSha256: RuntimeSha256Schema,
    totalRecordCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    includedRecordCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    excludedRecordCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    encoding: z.literal("ordered_source_record_membership_bitset_v1"),
    bitsetSha256: RuntimeSha256Schema,
    bitsetByteLength: EvidenceByteLengthSchema,
  })
  .strict();

const GrandHallRoomOnlyRuntimeEvidenceMaterialV2ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_ROOM_ONLY_RUNTIME_EVIDENCE_V2),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    createdAt: IsoInstantSchema,
    createdBy: z.string().trim().min(1).max(160),
    productionTrust: z.null(),
    sourceFrontierReceiptSha256: RuntimeSha256Schema,
    acceptedScope: z
      .object({
        membershipArtifact: AcceptedMembershipArtifactSchema,
        closedBoundaryArtifact: AcceptedClosedBoundaryArtifactSchema,
        portalDecisionArtifact: AcceptedPortalDecisionArtifactSchema,
        panoramaMaskSetArtifact: AcceptedPanoramaMaskSetArtifactSchema,
        reviewedTransformArtifact: AcceptedReviewedTransformArtifactSchema,
        outputInventoryMaskArtifact: AcceptedOutputInventoryMaskArtifactSchema,
      })
      .strict(),
    humanReview: z
      .object({
        state: z.literal("accepted"),
        reviewerId: z.string().trim().min(1).max(160),
        reviewedAt: IsoInstantSchema,
      })
      .strict(),
    runtimePolicy: z
      .object({
        runtimeAuthorized: z.literal(true),
        generatedFillPermitted: z.literal(false),
        proceduralPixelReplacementPermitted: z.literal(false),
        synthesizedPixelReplacementPermitted: z.literal(false),
        panoStageNadirCrownPermitted: z.literal(false),
        neighbouringRoomPixelsPermitted: z.literal(false),
        facadeAssetsPermitted: z.literal(false),
        maskedOrUnknownPixelDisposition: z.literal(
          "remain_transparent_or_unknown_never_filled",
        ),
      })
      .strict(),
    croppedVisual: z
      .object({
        derivation: z.literal(
          "accepted_closed_boundary_reviewed_transform_and_output_inventory_mask_applied_v2",
        ),
        memberSetSha256: Sha256HexSchema,
        memberCount: z.number().int().positive()
          .max(GRAND_HALL_ROOM_ONLY_MAX_MEMBER_COUNT),
        totalBytes: EvidenceByteLengthSchema.max(GRAND_HALL_ROOM_ONLY_MAX_TOTAL_BYTES),
        totalGaussianCount: z.number().int().positive()
          .max(GRAND_HALL_ROOM_ONLY_MAX_TOTAL_GAUSSIAN_COUNT),
        members: z.array(GrandHallRoomOnlyVisualMemberV2Schema).min(1)
          .max(GRAND_HALL_ROOM_ONLY_MAX_MEMBER_COUNT),
      })
      .strict(),
  })
  .strict();

export type GrandHallRoomOnlyRuntimeEvidenceMaterialV2 = z.infer<
  typeof GrandHallRoomOnlyRuntimeEvidenceMaterialV2ObjectSchema
>;

function canonicalDigest(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`);
}

export function computeGrandHallRoomOnlyVisualMemberSetSha256(
  members: readonly GrandHallRoomOnlyVisualMemberV2[],
): string {
  const parsed = z.array(GrandHallRoomOnlyVisualMemberV2Schema).min(1)
    .max(GRAND_HALL_ROOM_ONLY_MAX_MEMBER_COUNT).parse(members);
  return canonicalDigest(`${GRAND_HALL_ROOM_ONLY_RUNTIME_EVIDENCE_V2}.visual-members`, parsed);
}

function refineMaterial(
  material: GrandHallRoomOnlyRuntimeEvidenceMaterialV2,
  ctx: z.RefinementCtx,
): void {
  if (
    material.acceptedScope.membershipArtifact.sha256 ===
    GRAND_HALL_PENDING_ROOM_MEMBERSHIP_V1_SHA256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acceptedScope", "membershipArtifact", "sha256"],
      message: "the human-pending v1 membership artifact cannot grant runtime authority",
    });
  }

  const scope = material.acceptedScope;
  const reviewPackDigests = [
    scope.membershipArtifact.reviewPackSha256,
    scope.closedBoundaryArtifact.reviewPackSha256,
    scope.portalDecisionArtifact.reviewPackSha256,
    scope.panoramaMaskSetArtifact.reviewPackSha256,
  ];
  if (new Set(reviewPackDigests).size !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acceptedScope"],
      message: "every T-554 scope artifact must derive from the same exact scope review pack",
    });
  }

  for (const [path, digest] of [
    [
      ["acceptedScope", "reviewedTransformArtifact", "scopeReviewPackSha256"],
      scope.reviewedTransformArtifact.scopeReviewPackSha256,
    ],
    [
      ["acceptedScope", "outputInventoryMaskArtifact", "scopeReviewPackSha256"],
      scope.outputInventoryMaskArtifact.scopeReviewPackSha256,
    ],
  ] as const) {
    if (digest !== scope.membershipArtifact.reviewPackSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path],
        message: "later T-557 evidence must bind the accepted T-554 scope without claiming it was reviewed there",
      });
    }
  }

  // sourceFrontierReceiptSha256 identifies the immutable legacy v1 SOG
  // package. The transform and output mask instead share the raw XGRIDS/LCC
  // project receipt, so only those two XGRIDS identities are cross-bound.
  const crossBindings: readonly [
    readonly (string | number)[],
    string,
    string,
    string,
  ][] = [
    [
      ["acceptedScope", "closedBoundaryArtifact", "roomMembershipArtifactSha256"],
      scope.closedBoundaryArtifact.roomMembershipArtifactSha256,
      scope.membershipArtifact.sha256,
      "closed boundary must bind the accepted room-membership artifact",
    ],
    [
      ["acceptedScope", "closedBoundaryArtifact", "portalDecisionArtifactSha256"],
      scope.closedBoundaryArtifact.portalDecisionArtifactSha256,
      scope.portalDecisionArtifact.sha256,
      "closed boundary must bind the complete accepted portal decisions",
    ],
    [
      ["acceptedScope", "closedBoundaryArtifact", "portalInterfaceInventorySha256"],
      scope.closedBoundaryArtifact.portalInterfaceInventorySha256,
      scope.portalDecisionArtifact.interfaceInventorySha256,
      "closed boundary refinements must bind the exact accepted portal interface inventory",
    ],
    [
      ["acceptedScope", "panoramaMaskSetArtifact", "membershipArtifactSha256"],
      scope.panoramaMaskSetArtifact.membershipArtifactSha256,
      scope.membershipArtifact.sha256,
      "panorama masks must bind the accepted room membership",
    ],
    [
      ["acceptedScope", "panoramaMaskSetArtifact", "portalDecisionArtifactSha256"],
      scope.panoramaMaskSetArtifact.portalDecisionArtifactSha256,
      scope.portalDecisionArtifact.sha256,
      "panorama masks must bind the complete accepted portal decisions",
    ],
    [
      ["acceptedScope", "panoramaMaskSetArtifact", "sourcePanoramaInventorySha256"],
      scope.panoramaMaskSetArtifact.sourcePanoramaInventorySha256,
      scope.membershipArtifact.sourcePanoramaInventorySha256,
      "membership and panorama masks must bind the same exact source JPG inventory",
    ],
    [
      ["acceptedScope", "outputInventoryMaskArtifact", "xgridsSourceReceiptSha256"],
      scope.outputInventoryMaskArtifact.xgridsSourceReceiptSha256,
      scope.reviewedTransformArtifact.sourceXgridsReceiptSha256,
      "output mask and reviewed transform must bind the same XGRIDS source receipt",
    ],
    [
      ["acceptedScope", "outputInventoryMaskArtifact", "xgridsOutputInventorySha256"],
      scope.outputInventoryMaskArtifact.xgridsOutputInventorySha256,
      scope.reviewedTransformArtifact.sourceXgridsOutputInventorySha256,
      "output mask and reviewed transform must bind the same exact XGRIDS output inventory",
    ],
    [
      ["acceptedScope", "outputInventoryMaskArtifact", "transformArtifactSha256"],
      scope.outputInventoryMaskArtifact.transformArtifactSha256,
      scope.reviewedTransformArtifact.sha256,
      "output mask must bind the exact accepted reviewed transform",
    ],
    [
      ["acceptedScope", "outputInventoryMaskArtifact", "closedBoundaryArtifactSha256"],
      scope.outputInventoryMaskArtifact.closedBoundaryArtifactSha256,
      scope.closedBoundaryArtifact.sha256,
      "output mask must bind the exact accepted closed boundary",
    ],
  ];
  for (const [path, actual, expected, message] of crossBindings) {
    if (actual !== expected) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
    }
  }

  if (
    scope.outputInventoryMaskArtifact.includedRecordCount +
      scope.outputInventoryMaskArtifact.excludedRecordCount !==
    scope.outputInventoryMaskArtifact.totalRecordCount
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acceptedScope", "outputInventoryMaskArtifact", "includedRecordCount"],
      message: "output mask summary counts must partition its exact XGRIDS inventory",
    });
  }

  if (
    scope.panoramaMaskSetArtifact.maskCount +
      scope.panoramaMaskSetArtifact.wholeFrameExclusionCount !==
    scope.panoramaMaskSetArtifact.sourceRecordCount
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acceptedScope", "panoramaMaskSetArtifact", "maskCount"],
      message: "panorama masks and whole-frame exclusions must partition all 50 reviewed source records",
    });
  }

  if (
    scope.outputInventoryMaskArtifact.bitsetByteLength !==
    Math.ceil(scope.outputInventoryMaskArtifact.totalRecordCount / 8)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acceptedScope", "outputInventoryMaskArtifact", "bitsetByteLength"],
      message: "output-mask bitset byte length must cover the complete exact output inventory",
    });
  }

  const parsedMembers = z.array(GrandHallRoomOnlyVisualMemberV2Schema).min(1)
    .max(GRAND_HALL_ROOM_ONLY_MAX_MEMBER_COUNT)
    .safeParse(material.croppedVisual.members);
  // The object schema already reports the member-level issue. Avoid throwing
  // from a refinement while evaluating deliberately invalid admission input.
  if (!parsedMembers.success) return;
  const members = parsedMembers.data;
  if (new Set(members.map((member) => member.fileName)).size !== members.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["croppedVisual", "members"],
      message: "cropped visual member filenames must be unique",
    });
  }
  if (new Set(members.map((member) => member.sha256)).size !== members.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["croppedVisual", "members"],
      message: "cropped visual member byte identities must be unique",
    });
  }

  const expectedMemberSetSha256 = computeGrandHallRoomOnlyVisualMemberSetSha256(members);
  const totalBytes = members.reduce((total, member) => total + member.sizeBytes, 0);
  const totalGaussianCount = members.reduce(
    (total, member) => total + member.gaussianCount,
    0,
  );
  if (scope.outputInventoryMaskArtifact.includedRecordCount !== totalGaussianCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acceptedScope", "outputInventoryMaskArtifact", "includedRecordCount"],
      message: "accepted output-mask included count must equal the exact cropped SOG Gaussian inventory",
    });
  }
  const checks: readonly [string, number | string, number | string, string][] = [
    ["memberSetSha256", material.croppedVisual.memberSetSha256, expectedMemberSetSha256,
      "cropped visual member-set digest must bind the exact ordered members"],
    ["memberCount", material.croppedVisual.memberCount, members.length,
      "cropped visual member count must match the exact member inventory"],
    ["totalBytes", material.croppedVisual.totalBytes, totalBytes,
      "cropped visual byte total must match the exact member inventory"],
    ["totalGaussianCount", material.croppedVisual.totalGaussianCount, totalGaussianCount,
      "cropped visual Gaussian total must match the exact member inventory"],
  ];
  for (const [field, actual, expected, message] of checks) {
    if (actual !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["croppedVisual", field],
        message,
      });
    }
  }

  const artifactDigests = Object.values(material.acceptedScope).map(
    (artifact) => artifact.sha256,
  );
  if (new Set(artifactDigests).size !== artifactDigests.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acceptedScope"],
      message: "each accepted scope artifact must have a distinct immutable identity",
    });
  }
}

export const GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema =
  GrandHallRoomOnlyRuntimeEvidenceMaterialV2ObjectSchema.superRefine(refineMaterial);

export function computeGrandHallRoomOnlyRuntimeEvidenceV2Sha256(
  material: GrandHallRoomOnlyRuntimeEvidenceMaterialV2,
): string {
  const parsed = GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.parse(material);
  return canonicalDigest(GRAND_HALL_ROOM_ONLY_RUNTIME_EVIDENCE_V2, parsed);
}

const GrandHallRoomOnlyRuntimeEvidenceV2ObjectSchema =
  GrandHallRoomOnlyRuntimeEvidenceMaterialV2ObjectSchema.extend({
    evidenceSha256: Sha256HexSchema,
  }).strict();

export const GrandHallRoomOnlyRuntimeEvidenceV2Schema =
  GrandHallRoomOnlyRuntimeEvidenceV2ObjectSchema.superRefine((evidence, ctx) => {
    refineMaterial(evidence, ctx);
    const { evidenceSha256, ...material } = evidence;
    const expected = canonicalDigest(GRAND_HALL_ROOM_ONLY_RUNTIME_EVIDENCE_V2, material);
    if (evidenceSha256 !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceSha256"],
        message: "room-only runtime evidence digest must bind the complete accepted material",
      });
    }
  });

export type GrandHallRoomOnlyRuntimeEvidenceV2 = z.infer<
  typeof GrandHallRoomOnlyRuntimeEvidenceV2Schema
>;

/**
 * Cross-binds accepted cropped-output evidence to the runtime package's
 * ordered visual receipts. Asset IDs and private storage identities remain in
 * the package receipt layer; this contract binds the immutable content bytes.
 */
export function grandHallRoomOnlyEvidenceMatchesVisualMembers(
  evidenceInput: unknown,
  visualMembers: readonly GrandHallRoomOnlyVisualMemberIdentity[],
): boolean {
  const evidence = GrandHallRoomOnlyRuntimeEvidenceV2Schema.safeParse(evidenceInput);
  if (!evidence.success) return false;
  const expected = evidence.data.croppedVisual.members;
  if (expected.length !== visualMembers.length) return false;
  return expected.every((member, index) => {
    const visual = visualMembers[index];
    return visual !== undefined
      && visual.fileName === member.fileName
      && visual.fileExt === member.fileExt
      && visual.sha256 === member.sha256
      && visual.sizeBytes === member.sizeBytes;
  });
}

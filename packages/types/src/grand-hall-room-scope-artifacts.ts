import { z } from "zod";

import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  RuntimeSha256Schema,
  TransformArtifactV0Schema,
} from "./runtime-venue-manifest.js";

export const GRAND_HALL_SCOPE_REVIEW_PACK_V1 =
  "venviewer.grand-hall-scope-review-pack.v1";
export const GRAND_HALL_ROOM_MEMBERSHIP_V2 =
  "omnitwin.foundry.grand-hall-room-membership.v2";
export const GRAND_HALL_PORTAL_DECISIONS_V1 =
  "venviewer.grand-hall-portal-decision.v1";
export const GRAND_HALL_CLOSED_BOUNDARY_V1 =
  "venviewer.grand-hall-closed-room-boundary.v1";
export const GRAND_HALL_PANORAMA_MASK_SET_V1 =
  "venviewer.grand-hall-panorama-mask-set.v1";
export const GRAND_HALL_XGRIDS_TO_MATTERPAK_E57_TRANSFORM_V1 =
  "venviewer.grand-hall-xgrids-to-matterpak-e57-transform.v1";
export const GRAND_HALL_OUTPUT_INVENTORY_MASK_V1 =
  "venviewer.grand-hall-output-inventory-mask.v1";
export const GRAND_HALL_PANORAMA_SOURCE_INVENTORY_V2 =
  "venviewer.grand-hall-panorama-source-inventory.v2";

export const GRAND_HALL_XGRIDS_SOURCE_FRAME =
  "ARF";
export const GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME =
  "CVF";
export const GRAND_HALL_MATTERPAK_ROOM_KEY = "matterpak:g001:s009";
export const GRAND_HALL_PANORAMA_WIDTH_PX = 8_192;
export const GRAND_HALL_PANORAMA_HEIGHT_PX = 4_096;
export const GRAND_HALL_REVIEW_PANORAMA_COUNT = 50;
export const GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT = 148;
export const GRAND_HALL_E57_SCAN_COUNT = 149;
export const GRAND_HALL_EXACT_INTERFACE_COUNT = 8;

const MAX_SAFE_COUNT = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const PositiveByteLengthSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const IsoInstantSchema = z.string().datetime({ offset: true });
const SafeIdSchema = z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const SafeRelativeFileSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !value.includes("\\") &&
      value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    "file identity must be a safe forward-slash relative path",
  );
const Vec2Schema = z.tuple([z.number().finite(), z.number().finite()]);
const Vec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

function canonicalDigest(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

const AcceptedHumanReviewSchema = z
  .object({
    state: z.literal("human_accepted"),
    reviewerId: z.string().trim().min(1).max(160),
    reviewerRole: z.literal("venue_owner_or_authorized_domain_reviewer"),
    reviewedAt: IsoInstantSchema,
    knowledgeBasis: z.array(z.string().trim().min(1).max(240)).min(1).max(32),
    agentDecisionAuthority: z.literal("none"),
  })
  .strict();

export const GrandHallPanoramaSourceJpgIdentitySchema = z
  .object({
    sweepNumber: z.number().int().min(1).max(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    fileName: SafeRelativeFileSchema.refine(
      (value) => /\.(?:jpg|jpeg)$/iu.test(value),
      "source panorama identity must name a JPEG file",
    ),
    sha256: RuntimeSha256Schema,
    byteLength: PositiveByteLengthSchema,
    widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
  })
  .strict();

export type GrandHallPanoramaSourceJpgIdentity = z.infer<
  typeof GrandHallPanoramaSourceJpgIdentitySchema
>;

function refineExactPanoramaSources(
  sources: readonly GrandHallPanoramaSourceJpgIdentity[],
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  sources.forEach((source, index) => {
    if (source.sweepNumber !== index + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: "Grand Hall panorama sources must be the exact ordered source sweeps 1..50",
      });
    }
  });
  if (new Set(sources.map((source) => source.fileName)).size !== sources.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path],
      message: "source panorama filenames must be unique",
    });
  }
}

export function computeGrandHallPanoramaSourceInventorySha256(
  sources: readonly GrandHallPanoramaSourceJpgIdentity[],
): string {
  const parsed = z.array(GrandHallPanoramaSourceJpgIdentitySchema)
    .length(GRAND_HALL_REVIEW_PANORAMA_COUNT)
    .parse(sources);
  return canonicalDigest(GRAND_HALL_PANORAMA_SOURCE_INVENTORY_V2, parsed);
}

/**
 * An authority-none diagnostic relationship between one source panorama and
 * one E57 scan index. This is deliberately separate from the JPEG identity:
 * sequence order is not geometric camera correspondence evidence.
 */
export const GrandHallPanoramaE57SequenceHypothesisSchema = z
  .object({
    sourceSweepNumber: z.number().int().min(1).max(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    sourceJpgFileName: SafeRelativeFileSchema.refine(
      (value) => /\.(?:jpg|jpeg)$/iu.test(value),
      "sequence hypothesis must name a source JPEG file",
    ),
    sourceJpgSha256: RuntimeSha256Schema,
    candidateScanIndex: z.number().int().min(0).max(GRAND_HALL_E57_SCAN_COUNT - 1),
    state: z.literal("sequence_hypothesis_unverified"),
    authority: z.literal("none"),
    geometricCameraAuthority: z.literal("none"),
    trainingAuthority: z.literal("none"),
    reconstructionAuthority: z.literal("none"),
    runtimeAuthority: z.literal("none"),
  })
  .strict();

export type GrandHallPanoramaE57SequenceHypothesis = z.infer<
  typeof GrandHallPanoramaE57SequenceHypothesisSchema
>;

function refinePanoramaE57SequenceHypotheses(
  hypotheses: readonly GrandHallPanoramaE57SequenceHypothesis[],
  sources: readonly GrandHallPanoramaSourceJpgIdentity[],
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  hypotheses.forEach((hypothesis, index) => {
    const source = sources[index];
    if (
      source === undefined ||
      hypothesis.sourceSweepNumber !== source.sweepNumber ||
      hypothesis.sourceJpgFileName !== source.fileName ||
      hypothesis.sourceJpgSha256 !== source.sha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: "each sequence hypothesis must bind the exact source panorama at the same sweep-ordered position",
      });
    }
  });
  if (new Set(hypotheses.map((hypothesis) => hypothesis.candidateScanIndex)).size !== hypotheses.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path],
      message: "diagnostic sequence hypotheses must contain one unique candidate scan index per source sweep",
    });
  }
}

const GrandHallPanoramaDirectoryFileBaseSchema = z
  .object({
    inventoryIndex: z.number().int().min(0).max(GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT - 1),
    fileName: SafeRelativeFileSchema.refine(
      (value) => /\.(?:jpg|jpeg)$/iu.test(value),
      "panorama directory inventory must bind a JPEG file",
    ),
    sha256: RuntimeSha256Schema,
    byteLength: PositiveByteLengthSchema,
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
  })
  .strict();

const GrandHallPanoramaDirectoryFileIdentityObjectSchema = z.discriminatedUnion(
  "t554Eligibility",
  [
    GrandHallPanoramaDirectoryFileBaseSchema.extend({
      t554Eligibility: z.literal("candidate_numeric_sweep_1_through_50"),
      embeddedSweepNumber: z.number().int().min(1).max(GRAND_HALL_REVIEW_PANORAMA_COUNT),
      t554ReviewState: z.literal("human_pending"),
      ineligibilityReason: z.null(),
    }).strict(),
    GrandHallPanoramaDirectoryFileBaseSchema.extend({
      t554Eligibility: z.literal("ineligible_unreviewed"),
      embeddedSweepNumber: z.number().int().positive().nullable(),
      t554ReviewState: z.literal("not_reviewed_in_t554"),
      ineligibilityReason: z.enum([
        "embedded_sweep_number_outside_1_through_50",
        "no_single_unambiguous_embedded_sweep_number",
      ]),
    }).strict(),
  ],
);

export const GrandHallPanoramaDirectoryFileIdentitySchema =
  GrandHallPanoramaDirectoryFileIdentityObjectSchema.superRefine((file, ctx) => {
    if (file.t554Eligibility !== "ineligible_unreviewed") return;
    if (
      file.ineligibilityReason === "embedded_sweep_number_outside_1_through_50" &&
      (file.embeddedSweepNumber === null ||
        file.embeddedSweepNumber <= GRAND_HALL_REVIEW_PANORAMA_COUNT)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["embeddedSweepNumber"],
        message: "out-of-range files must record an embedded sweep number greater than 50",
      });
    }
    if (
      file.ineligibilityReason === "no_single_unambiguous_embedded_sweep_number" &&
      file.embeddedSweepNumber !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["embeddedSweepNumber"],
        message: "ambiguous filenames cannot claim one exact embedded sweep number",
      });
    }
  });

export type GrandHallPanoramaDirectoryFileIdentity = z.infer<
  typeof GrandHallPanoramaDirectoryFileIdentitySchema
>;

export function computeGrandHallPanoramaDirectoryInventorySha256(
  files: readonly GrandHallPanoramaDirectoryFileIdentity[],
): string {
  const parsed = z.array(GrandHallPanoramaDirectoryFileIdentitySchema)
    .length(GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT)
    .parse(files);
  return canonicalDigest("venviewer.grand-hall-panorama-directory-inventory.v1", parsed);
}

const InterfaceBoundsSchema = z
  .object({ min: Vec3Schema, max: Vec3Schema })
  .strict()
  .superRefine((bounds, ctx) => {
    for (const axis of [0, 1, 2] as const) {
      if (bounds.min[axis] >= bounds.max[axis]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max", axis],
          message: "interface maximum must exceed its minimum on every axis",
        });
      }
    }
  });

export const GrandHallInterfaceCandidateSchema = z
  .object({
    interfaceId: SafeIdSchema,
    grandHallRoomKey: z.literal(GRAND_HALL_MATTERPAK_ROOM_KEY),
    adjacentSourceRoomKey: SafeIdSchema,
    sharedSourceVertexCount: z.number().int().positive(),
    sharedSourceVertexSetSha256: RuntimeSha256Schema,
    boundsMeters: InterfaceBoundsSchema,
  })
  .strict()
  .superRefine((candidate, ctx) => {
    if (candidate.adjacentSourceRoomKey === GRAND_HALL_MATTERPAK_ROOM_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adjacentSourceRoomKey"],
        message: "an interface must identify a distinct adjacent source room",
      });
    }
  });

export type GrandHallInterfaceCandidate = z.infer<
  typeof GrandHallInterfaceCandidateSchema
>;

function refineExactInterfaceInventory(
  candidates: readonly GrandHallInterfaceCandidate[],
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  if (new Set(candidates.map((candidate) => candidate.interfaceId)).size !== candidates.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path],
      message: "interface candidate identifiers must be unique",
    });
  }
  candidates.forEach((candidate, index) => {
    const previous = candidates[index - 1];
    if (previous !== undefined && previous.interfaceId.localeCompare(candidate.interfaceId) >= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, "interfaceId"],
        message: "the exact interface inventory must be strictly ordered by interfaceId",
      });
    }
  });
}

export function computeGrandHallInterfaceInventorySha256(
  candidates: readonly GrandHallInterfaceCandidate[],
): string {
  const parsed = z.array(GrandHallInterfaceCandidateSchema).min(1).max(64).parse(candidates);
  return canonicalDigest("venviewer.grand-hall-interface-inventory.v1", parsed);
}

const GrandHallScopeReviewPackMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V1),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    createdAt: IsoInstantSchema,
    createdBy: z.string().trim().min(1).max(160),
    authority: z.literal("none"),
    reviewState: z.literal("human_pending"),
    runtimeAuthorized: z.literal(false),
    trainingAuthorized: z.literal(false),
    generatedContentAuthorized: z.literal(false),
    productionTrust: z.null(),
    sourceEvidence: z
      .object({
        t550PendingMembershipV1Sha256: RuntimeSha256Schema,
        t551SourceEvidenceSha256: RuntimeSha256Schema,
        t551SourceReceiptSha256: RuntimeSha256Schema,
        xgridsSourceReceiptSha256: RuntimeSha256Schema,
        matterPakE57SourceReceiptSha256: RuntimeSha256Schema,
        panoramaDirectoryInventorySha256: RuntimeSha256Schema,
        boundaryReviewManifestSha256: RuntimeSha256Schema,
        interfaceTopologyAtlasManifestSha256: RuntimeSha256Schema,
        panoramaReviewManifestSha256: RuntimeSha256Schema,
      })
      .strict(),
    panoramaDirectoryFiles: z
      .array(GrandHallPanoramaDirectoryFileIdentitySchema)
      .length(GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT),
    candidatePanoramaSources: z
      .array(GrandHallPanoramaSourceJpgIdentitySchema)
      .length(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    panoramaSourceInventorySha256: RuntimeSha256Schema,
    panoramaE57SequenceHypotheses: z
      .array(GrandHallPanoramaE57SequenceHypothesisSchema)
      .length(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    interfaceCandidates: z.array(GrandHallInterfaceCandidateSchema)
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    interfaceInventorySha256: RuntimeSha256Schema,
    proposalArtifacts: z
      .object({
        roomMembership: z
          .object({
            state: z.literal("source_candidate_present_human_pending"),
            artifactSha256: RuntimeSha256Schema,
          })
          .strict(),
        portalDecisions: z
          .object({
            state: z.literal("not_authored_human_pending"),
            artifactSha256: z.null(),
          })
          .strict(),
        closedSelectionVolume: z
          .object({
            state: z.literal("not_authored_human_pending"),
            artifactSha256: z.null(),
          })
          .strict(),
        panoramaMaskSet: z
          .object({
            state: z.literal("not_authored_human_pending"),
            artifactSha256: z.null(),
          })
          .strict(),
      })
      .strict(),
    deferredArtifacts: z
      .object({
        reviewedTransform: z
          .object({
            state: z.literal("not_available_deferred_to_t557"),
            proposalSha256: z.null(),
            artifactSha256: z.null(),
            humanDecisionRequested: z.literal(false),
          })
          .strict(),
        outputInventoryMask: z
          .object({
            state: z.literal("not_available_deferred_to_t557"),
            proposalSha256: z.null(),
            artifactSha256: z.null(),
            humanDecisionRequested: z.literal(false),
          })
          .strict(),
      })
      .strict(),
    requiredHumanDecisions: z.tuple([
      z.literal("accept_or_reject_room_membership"),
      z.literal("resolve_every_interface"),
      z.literal("accept_or_reject_closed_selection_volume"),
      z.literal("accept_or_reject_every_panorama_mask"),
    ]),
  })
  .strict();

type GrandHallScopeReviewPackMaterialObject = z.infer<
  typeof GrandHallScopeReviewPackMaterialObjectSchema
>;

function refineReviewPack(
  material: GrandHallScopeReviewPackMaterialObject,
  ctx: z.RefinementCtx,
): void {
  const directoryFiles = material.panoramaDirectoryFiles;
  directoryFiles.forEach((file, index) => {
    if (file.inventoryIndex !== index) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["panoramaDirectoryFiles", index, "inventoryIndex"],
        message: "full panorama directory inventory must preserve exact zero-based ordering",
      });
    }
  });
  if (new Set(directoryFiles.map((file) => file.fileName)).size !== directoryFiles.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["panoramaDirectoryFiles"],
      message: "all 148 panorama directory filenames must be unique",
    });
  }
  const eligibleFiles = directoryFiles.filter(
    (file) => file.t554Eligibility === "candidate_numeric_sweep_1_through_50",
  );
  const ineligibleFiles = directoryFiles.filter(
    (file) => file.t554Eligibility === "ineligible_unreviewed",
  );
  if (
    eligibleFiles.length !== GRAND_HALL_REVIEW_PANORAMA_COUNT ||
    ineligibleFiles.length !==
      GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT - GRAND_HALL_REVIEW_PANORAMA_COUNT
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["panoramaDirectoryFiles"],
      message: "T-554 must expose exactly 50 numeric-sweep candidates and 98 explicitly ineligible unreviewed files",
    });
  }
  const orderedEligible = [...eligibleFiles].sort(
    (left, right) => left.embeddedSweepNumber - right.embeddedSweepNumber,
  );
  orderedEligible.forEach((file, index) => {
    const candidate = material.candidatePanoramaSources[index];
    if (
      file.embeddedSweepNumber !== index + 1 ||
      candidate === undefined ||
      candidate.sweepNumber !== file.embeddedSweepNumber ||
      candidate.fileName !== file.fileName ||
      candidate.sha256 !== file.sha256 ||
      candidate.byteLength !== file.byteLength ||
      candidate.widthPx !== file.widthPx ||
      candidate.heightPx !== file.heightPx
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidatePanoramaSources", index],
        message: "each T-554 candidate must exactly match numeric sweep 1..50 in the full 148-file inventory",
      });
    }
  });
  refineExactPanoramaSources(material.candidatePanoramaSources, ctx, ["candidatePanoramaSources"]);
  refinePanoramaE57SequenceHypotheses(
    material.panoramaE57SequenceHypotheses,
    material.candidatePanoramaSources,
    ctx,
    ["panoramaE57SequenceHypotheses"],
  );
  refineExactInterfaceInventory(material.interfaceCandidates, ctx, ["interfaceCandidates"]);
  if (
    material.sourceEvidence.panoramaDirectoryInventorySha256 !==
    computeGrandHallPanoramaDirectoryInventorySha256(material.panoramaDirectoryFiles)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceEvidence", "panoramaDirectoryInventorySha256"],
      message: "directory inventory digest must bind all 148 exact source file identities and T-554 eligibility states",
    });
  }
  if (
    material.panoramaSourceInventorySha256 !==
    computeGrandHallPanoramaSourceInventorySha256(material.candidatePanoramaSources)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["panoramaSourceInventorySha256"],
      message: "panorama inventory digest must bind the exact ordered source JPG identities",
    });
  }
  if (
    material.interfaceInventorySha256 !==
    computeGrandHallInterfaceInventorySha256(material.interfaceCandidates)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["interfaceInventorySha256"],
      message: "interface inventory digest must bind every exact interface candidate",
    });
  }
  if (
    material.proposalArtifacts.roomMembership.artifactSha256 !==
    material.sourceEvidence.t550PendingMembershipV1Sha256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["proposalArtifacts", "roomMembership", "artifactSha256"],
      message: "the only authored T-554 proposal must be the exact human-pending T-550 membership candidate",
    });
  }
}

export const GrandHallScopeReviewPackMaterialV1Schema =
  GrandHallScopeReviewPackMaterialObjectSchema.superRefine(refineReviewPack);
export type GrandHallScopeReviewPackMaterialV1 = z.infer<
  typeof GrandHallScopeReviewPackMaterialV1Schema
>;

export function computeGrandHallScopeReviewPackV1Sha256(
  material: GrandHallScopeReviewPackMaterialV1,
): string {
  const parsed = GrandHallScopeReviewPackMaterialV1Schema.parse(material);
  return canonicalDigest(GRAND_HALL_SCOPE_REVIEW_PACK_V1, parsed);
}

const GrandHallScopeReviewPackObjectSchema = GrandHallScopeReviewPackMaterialObjectSchema.extend({
  artifactSha256: RuntimeSha256Schema,
}).strict();

export const GrandHallScopeReviewPackV1Schema =
  GrandHallScopeReviewPackObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refineReviewPack(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_SCOPE_REVIEW_PACK_V1, material)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactSha256"],
        message: "review-pack digest must bind the complete authority-none descriptor",
      });
    }
  });
export type GrandHallScopeReviewPackV1 = z.infer<
  typeof GrandHallScopeReviewPackV1Schema
>;

const MembershipDecisionSchema = z.discriminatedUnion("disposition", [
  z
    .object({
      disposition: z.literal("include_with_binary_pixel_mask"),
      classification: z.enum(["grand_hall_core", "grand_hall_portal_threshold"]),
      maskRequired: z.literal(true),
      generatedFillPermitted: z.literal(false),
    })
    .strict(),
  z
    .object({
      disposition: z.literal("exclude_whole_frame"),
      classification: z.literal("adjacent_room_or_outside_grand_hall"),
      maskRequired: z.literal(false),
      generatedFillPermitted: z.literal(false),
    })
    .strict(),
]);

const MembershipPanoramaRecordSchema = z
  .object({
    source: GrandHallPanoramaSourceJpgIdentitySchema,
    decision: MembershipDecisionSchema,
    decisionEvidenceSha256: RuntimeSha256Schema,
  })
  .strict();

const GrandHallRoomMembershipMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_ROOM_MEMBERSHIP_V2),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSha256: RuntimeSha256Schema,
    sourceMembershipV1Sha256: RuntimeSha256Schema,
    sourceBoundaryEvidenceSha256: RuntimeSha256Schema,
    sourcePanoramaInventorySha256: RuntimeSha256Schema,
    geometricCameraAuthority: z.literal("none"),
    matterPakRoomMembership: z
      .object({
        includedRoomKeys: z.tuple([z.literal(GRAND_HALL_MATTERPAK_ROOM_KEY)]),
        neighbouringRoomGeometryIncluded: z.literal(false),
        facadeGeometryIncluded: z.literal(false),
      })
      .strict(),
    panoramaRecords: z.array(MembershipPanoramaRecordSchema).length(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    acceptedUnknownPixelDisposition: z.literal("transparent_or_unknown_never_filled"),
    humanReview: AcceptedHumanReviewSchema,
  })
  .strict();

type GrandHallRoomMembershipMaterialObject = z.infer<
  typeof GrandHallRoomMembershipMaterialObjectSchema
>;

function refineRoomMembership(
  material: GrandHallRoomMembershipMaterialObject,
  ctx: z.RefinementCtx,
): void {
  const sources = material.panoramaRecords.map((record) => record.source);
  refineExactPanoramaSources(sources, ctx, ["panoramaRecords"]);
  if (
    material.sourcePanoramaInventorySha256 !==
    computeGrandHallPanoramaSourceInventorySha256(sources)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourcePanoramaInventorySha256"],
      message: "accepted membership must bind the exact ordered source panorama inventory",
    });
  }
  if (!material.panoramaRecords.some((record) => record.decision.disposition === "include_with_binary_pixel_mask")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["panoramaRecords"],
      message: "accepted Grand Hall membership must retain at least one reviewed source frame",
    });
  }
}

export const GrandHallRoomMembershipV2MaterialSchema =
  GrandHallRoomMembershipMaterialObjectSchema.superRefine(refineRoomMembership);
export type GrandHallRoomMembershipV2Material = z.infer<
  typeof GrandHallRoomMembershipV2MaterialSchema
>;

export function computeGrandHallRoomMembershipV2Sha256(
  material: GrandHallRoomMembershipV2Material,
): string {
  const parsed = GrandHallRoomMembershipV2MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_ROOM_MEMBERSHIP_V2, parsed);
}

const GrandHallRoomMembershipObjectSchema = GrandHallRoomMembershipMaterialObjectSchema.extend({
  artifactSha256: RuntimeSha256Schema,
}).strict();

export const GrandHallRoomMembershipV2Schema =
  GrandHallRoomMembershipObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refineRoomMembership(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_ROOM_MEMBERSHIP_V2, material)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactSha256"],
      message: "membership digest must bind every accepted panorama and source-room decision",
      });
    }
  });
export type GrandHallRoomMembershipV2 = z.infer<
  typeof GrandHallRoomMembershipV2Schema
>;

const PortalResolutionSchema = z.enum([
  "close_at_reviewed_grand_hall_plane",
  "exclude_beyond_interface",
  "not_a_portal_source_topology_artifact",
]);

const PortalDecisionSchema = z
  .object({
    interfaceId: SafeIdSchema,
    resolution: PortalResolutionSchema,
    grandHallSideEvidenceSha256: RuntimeSha256Schema,
    decisionNote: z.string().trim().min(1).max(500),
  })
  .strict();

const GrandHallPortalDecisionsMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_PORTAL_DECISIONS_V1),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSha256: RuntimeSha256Schema,
    sourceBoundaryEvidenceSha256: RuntimeSha256Schema,
    interfaceInventorySha256: RuntimeSha256Schema,
    interfaceCount: z.literal(GRAND_HALL_EXACT_INTERFACE_COUNT),
    interfaceCandidates: z.array(GrandHallInterfaceCandidateSchema)
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    decisions: z.array(PortalDecisionSchema)
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    allInterfacesResolved: z.literal(true),
    humanReview: AcceptedHumanReviewSchema,
  })
  .strict();

type GrandHallPortalDecisionsMaterialObject = z.infer<
  typeof GrandHallPortalDecisionsMaterialObjectSchema
>;

function refinePortalDecisions(
  material: GrandHallPortalDecisionsMaterialObject,
  ctx: z.RefinementCtx,
): void {
  refineExactInterfaceInventory(material.interfaceCandidates, ctx, ["interfaceCandidates"]);
  if (material.interfaceCount !== material.interfaceCandidates.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["interfaceCount"],
      message: "interface count must match the complete exact candidate inventory",
    });
  }
  if (
    material.interfaceInventorySha256 !==
    computeGrandHallInterfaceInventorySha256(material.interfaceCandidates)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["interfaceInventorySha256"],
      message: "portal acceptance must bind the exact interface candidate inventory",
    });
  }
  if (material.decisions.length !== material.interfaceCandidates.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisions"],
      message: "accepted portal decisions must resolve every interface exactly once",
    });
  }
  material.interfaceCandidates.forEach((candidate, index) => {
    if (material.decisions[index]?.interfaceId !== candidate.interfaceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisions", index, "interfaceId"],
        message: "portal decisions must exactly match the ordered interface inventory",
      });
    }
  });
  if (new Set(material.decisions.map((decision) => decision.interfaceId)).size !== material.decisions.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisions"],
      message: "each interface must have exactly one final decision",
    });
  }
}

export const GrandHallPortalDecisionsV1MaterialSchema =
  GrandHallPortalDecisionsMaterialObjectSchema.superRefine(refinePortalDecisions);
export type GrandHallPortalDecisionsV1Material = z.infer<
  typeof GrandHallPortalDecisionsV1MaterialSchema
>;

export function computeGrandHallPortalDecisionsV1Sha256(
  material: GrandHallPortalDecisionsV1Material,
): string {
  const parsed = GrandHallPortalDecisionsV1MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_PORTAL_DECISIONS_V1, parsed);
}

const GrandHallPortalDecisionsObjectSchema = GrandHallPortalDecisionsMaterialObjectSchema.extend({
  artifactSha256: RuntimeSha256Schema,
}).strict();

export const GrandHallPortalDecisionsV1Schema =
  GrandHallPortalDecisionsObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refinePortalDecisions(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_PORTAL_DECISIONS_V1, material)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactSha256"],
        message: "portal-decision digest must bind the complete resolved interface inventory",
      });
    }
  });
export type GrandHallPortalDecisionsV1 = z.infer<
  typeof GrandHallPortalDecisionsV1Schema
>;

const BoundarySemanticRefinementSchema = z
  .object({
    interfaceId: SafeIdSchema,
    operation: z.enum([
      "exclude_beyond_interface",
      "retain_grand_hall_side",
      "remove_non_architectural_capture_artifact",
    ]),
    evidenceSha256: RuntimeSha256Schema,
    applied: z.literal(true),
    generatedGeometryCreated: z.literal(false),
  })
  .strict();

function cross2d(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(
  a: readonly [number, number],
  b: readonly [number, number],
  point: readonly [number, number],
): boolean {
  const epsilon = 1e-9;
  return Math.abs(cross2d(a, b, point)) <= epsilon &&
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon;
}

function segmentsIntersect(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): boolean {
  const epsilon = 1e-9;
  const abC = cross2d(a, b, c);
  const abD = cross2d(a, b, d);
  const cdA = cross2d(c, d, a);
  const cdB = cross2d(c, d, b);
  if (
    ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
    ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
  ) {
    return true;
  }
  return (Math.abs(abC) <= epsilon && pointOnSegment(a, b, c)) ||
    (Math.abs(abD) <= epsilon && pointOnSegment(a, b, d)) ||
    (Math.abs(cdA) <= epsilon && pointOnSegment(c, d, a)) ||
    (Math.abs(cdB) <= epsilon && pointOnSegment(c, d, b));
}

const GrandHallClosedBoundaryMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_CLOSED_BOUNDARY_V1),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSha256: RuntimeSha256Schema,
    roomMembershipArtifactSha256: RuntimeSha256Schema,
    portalDecisionArtifactSha256: RuntimeSha256Schema,
    portalInterfaceInventorySha256: RuntimeSha256Schema,
    portalInterfaceIds: z.array(SafeIdSchema)
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    sourceFrame: z.literal(GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME),
    units: z.literal("meters"),
    geometryRole: z.literal("non_rendered_selection_volume"),
    construction: z.literal("extruded_simple_xy_polygon"),
    nonConvex: z.literal(true),
    footprintXY: z.array(Vec2Schema).min(3).max(2_048),
    zMin: z.number().finite(),
    zMax: z.number().finite(),
    pointOnBoundaryPolicy: z.literal("include_as_inside"),
    closedVolume: z.literal(true),
    cameraMembershipOnly: z.literal(false),
    rendered: z.literal(false),
    collisionGeometry: z.literal(false),
    exportedAsArchitecture: z.literal(false),
    generatedGeometryCreated: z.literal(false),
    semanticRefinements: z.array(BoundarySemanticRefinementSchema)
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    humanReview: AcceptedHumanReviewSchema,
  })
  .strict();

type GrandHallClosedBoundaryMaterialObject = z.infer<
  typeof GrandHallClosedBoundaryMaterialObjectSchema
>;

function refineClosedBoundary(
  material: GrandHallClosedBoundaryMaterialObject,
  ctx: z.RefinementCtx,
): void {
  const points = material.footprintXY;
  const epsilon = 1e-9;
  if (material.zMax - material.zMin <= epsilon) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["zMax"],
      message: "closed selection volume must have a positive finite Z extent",
    });
  }
  const pointKeys = points.map((point) => `${String(point[0])},${String(point[1])}`);
  if (new Set(pointKeys).size !== points.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["footprintXY"],
      message: "simple XY footprint must not repeat vertices or repeat the first closing vertex",
    });
  }
  let twiceArea = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    if (next !== undefined) twiceArea += point[0] * next[1] - next[0] * point[1];
  });
  if (twiceArea <= epsilon) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["footprintXY"],
      message: "closed selection footprint must have positive area and canonical counter-clockwise winding",
    });
  }
  let hasReflexVertex = false;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    if (
      point !== undefined &&
      previous !== undefined &&
      next !== undefined &&
      cross2d(previous, point, next) < -epsilon
    ) {
      hasReflexVertex = true;
      break;
    }
  }
  if (!hasReflexVertex) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["footprintXY"],
      message: "Grand Hall selection volume must be non-convex and retain at least one reviewed reflex vertex",
    });
  }
  for (let first = 0; first < points.length; first += 1) {
    const firstStart = points[first];
    const firstEnd = points[(first + 1) % points.length];
    if (firstStart === undefined || firstEnd === undefined) continue;
    if (Math.hypot(firstEnd[0] - firstStart[0], firstEnd[1] - firstStart[1]) <= epsilon) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["footprintXY", first],
        message: "simple XY footprint cannot contain a zero-length edge",
      });
    }
    for (let second = first + 1; second < points.length; second += 1) {
      const adjacent = second === first + 1 || (first === 0 && second === points.length - 1);
      if (adjacent) continue;
      const secondStart = points[second];
      const secondEnd = points[(second + 1) % points.length];
      if (
        secondStart !== undefined &&
        secondEnd !== undefined &&
        segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["footprintXY"],
          message: "closed selection footprint must be a non-self-intersecting simple polygon",
        });
      }
    }
  }
  const refinementIds = material.semanticRefinements.map((refinement) => refinement.interfaceId);
  if (new Set(material.portalInterfaceIds).size !== material.portalInterfaceIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["portalInterfaceIds"],
      message: "accepted portal interface identifiers must be unique",
    });
  }
  material.portalInterfaceIds.forEach((interfaceId, index) => {
    const previous = material.portalInterfaceIds[index - 1];
    if (previous !== undefined && previous.localeCompare(interfaceId) >= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["portalInterfaceIds", index],
        message: "accepted portal interface identifiers must preserve canonical sorted inventory order",
      });
    }
  });
  if (
    refinementIds.length !== material.portalInterfaceIds.length ||
    refinementIds.some((interfaceId, index) => interfaceId !== material.portalInterfaceIds[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["semanticRefinements"],
      message: "boundary refinements must exactly match every accepted portal interface in canonical order",
    });
  }
}

export const GrandHallClosedBoundaryV1MaterialSchema =
  GrandHallClosedBoundaryMaterialObjectSchema.superRefine(refineClosedBoundary);
export type GrandHallClosedBoundaryV1Material = z.infer<
  typeof GrandHallClosedBoundaryV1MaterialSchema
>;

export function computeGrandHallClosedBoundaryV1Sha256(
  material: GrandHallClosedBoundaryV1Material,
): string {
  const parsed = GrandHallClosedBoundaryV1MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_CLOSED_BOUNDARY_V1, parsed);
}

const GrandHallClosedBoundaryObjectSchema = GrandHallClosedBoundaryMaterialObjectSchema.extend({
  artifactSha256: RuntimeSha256Schema,
}).strict();

export const GrandHallClosedBoundaryV1Schema =
  GrandHallClosedBoundaryObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refineClosedBoundary(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_CLOSED_BOUNDARY_V1, material)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactSha256"],
        message: "boundary digest must bind the exact closed non-rendered selection volume",
      });
    }
  });
export type GrandHallClosedBoundaryV1 = z.infer<
  typeof GrandHallClosedBoundaryV1Schema
>;

const PanoramaMaskReasonSchema = z.enum([
  "adjacent_room_pixels",
  "portal_beyond_grand_hall_plane",
  "facade_or_exterior_pixels",
  "capture_artifact_outside_verified_room",
  "unverified_or_unknown_pixels",
]);

export const GrandHallPanoramaMaskRecordSchema = z
  .object({
    fileName: SafeRelativeFileSchema.refine(
      (value) => /\.png$/iu.test(value),
      "panorama mask must name a PNG file",
    ),
    sha256: RuntimeSha256Schema,
    byteLength: PositiveByteLengthSchema,
    sourceJpgFileName: SafeRelativeFileSchema,
    sourceJpgSha256: RuntimeSha256Schema,
    widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
    encoding: z.literal("png_grayscale8_binary_v1"),
    coordinateSpace: z.literal("original_8192x4096_equirectangular_pixel_grid"),
    bitDepth: z.literal(8),
    channelCount: z.literal(1),
    permittedPixelValues: z.tuple([z.literal(0), z.literal(255)]),
    includedValue: z.literal(0),
    excludedValue: z.literal(255),
    includedPixelCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    excludedPixelCount: MAX_SAFE_COUNT,
    alphaChannelPresent: z.literal(false),
    colourProfilePresent: z.literal(false),
    exifOrientationPresent: z.literal(false),
    resampled: z.literal(false),
    reasonCodes: z.array(PanoramaMaskReasonSchema).max(5),
  })
  .strict()
  .superRefine((mask, ctx) => {
    if (
      mask.includedPixelCount + mask.excludedPixelCount !==
      GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["excludedPixelCount"],
        message: "binary mask pixel counts must cover the exact original panorama grid",
      });
    }
    if (new Set(mask.reasonCodes).size !== mask.reasonCodes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCodes"],
        message: "mask reason codes must be unique",
      });
    }
    if (
      (mask.excludedPixelCount === 0 && mask.reasonCodes.length !== 0) ||
      (mask.excludedPixelCount > 0 && mask.reasonCodes.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCodes"],
        message: "mask exclusion reasons must be empty exactly when no pixels are excluded",
      });
    }
  });

const PanoramaMaskSourceRecordSchema = z.discriminatedUnion("disposition", [
  z
    .object({
      source: GrandHallPanoramaSourceJpgIdentitySchema,
      disposition: z.literal("include_with_binary_pixel_mask"),
      mask: GrandHallPanoramaMaskRecordSchema,
      wholeFrameExclusionReason: z.null(),
    })
    .strict(),
  z
    .object({
      source: GrandHallPanoramaSourceJpgIdentitySchema,
      disposition: z.literal("exclude_whole_frame"),
      mask: z.null(),
      wholeFrameExclusionReason: z.literal("adjacent_room_or_outside_grand_hall"),
    })
    .strict(),
]);

const GrandHallPanoramaMaskSetMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_PANORAMA_MASK_SET_V1),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSha256: RuntimeSha256Schema,
    membershipArtifactSha256: RuntimeSha256Schema,
    portalDecisionArtifactSha256: RuntimeSha256Schema,
    sourcePanoramaInventorySha256: RuntimeSha256Schema,
    geometricCameraAuthority: z.literal("none"),
    sourceRecordCount: z.literal(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    maskCount: z.number().int().positive().max(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    wholeFrameExclusionCount: z.number().int().nonnegative().max(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    sourceRecords: z.array(PanoramaMaskSourceRecordSchema).length(GRAND_HALL_REVIEW_PANORAMA_COUNT),
    unknownPixelDisposition: z.literal("transparent_or_unknown_never_filled"),
    generatedFillPermitted: z.literal(false),
    humanReview: AcceptedHumanReviewSchema,
  })
  .strict();

type GrandHallPanoramaMaskSetMaterialObject = z.infer<
  typeof GrandHallPanoramaMaskSetMaterialObjectSchema
>;

function refinePanoramaMaskSet(
  material: GrandHallPanoramaMaskSetMaterialObject,
  ctx: z.RefinementCtx,
): void {
  const sources = material.sourceRecords.map((record) => record.source);
  refineExactPanoramaSources(sources, ctx, ["sourceRecords"]);
  if (
    material.sourcePanoramaInventorySha256 !==
    computeGrandHallPanoramaSourceInventorySha256(sources)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourcePanoramaInventorySha256"],
      message: "mask set must bind the exact ordered source JPG identities",
    });
  }
  const included = material.sourceRecords.filter(
    (record) => record.disposition === "include_with_binary_pixel_mask",
  );
  const excluded = material.sourceRecords.filter(
    (record) => record.disposition === "exclude_whole_frame",
  );
  if (material.maskCount !== included.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maskCount"],
      message: "mask count must match every included source JPG exactly",
    });
  }
  if (material.wholeFrameExclusionCount !== excluded.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["wholeFrameExclusionCount"],
      message: "whole-frame exclusion count must match the exact source dispositions",
    });
  }
  included.forEach((record, index) => {
    if (
      record.mask.sourceJpgFileName !== record.source.fileName ||
      record.mask.sourceJpgSha256 !== record.source.sha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceRecords", record.source.sweepNumber - 1, "mask"],
        message: `mask ${String(index)} must bind the exact source JPG filename and byte identity`,
      });
    }
  });
}

export const GrandHallPanoramaMaskSetV1MaterialSchema =
  GrandHallPanoramaMaskSetMaterialObjectSchema.superRefine(refinePanoramaMaskSet);
export type GrandHallPanoramaMaskSetV1Material = z.infer<
  typeof GrandHallPanoramaMaskSetV1MaterialSchema
>;

export function computeGrandHallPanoramaMaskSetV1Sha256(
  material: GrandHallPanoramaMaskSetV1Material,
): string {
  const parsed = GrandHallPanoramaMaskSetV1MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_PANORAMA_MASK_SET_V1, parsed);
}

const GrandHallPanoramaMaskSetObjectSchema = GrandHallPanoramaMaskSetMaterialObjectSchema.extend({
  artifactSha256: RuntimeSha256Schema,
}).strict();

export const GrandHallPanoramaMaskSetV1Schema =
  GrandHallPanoramaMaskSetObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refinePanoramaMaskSet(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_PANORAMA_MASK_SET_V1, material)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactSha256"],
        message: "panorama mask-set digest must bind every exact source JPG and exact mask record",
      });
    }
  });
export type GrandHallPanoramaMaskSetV1 = z.infer<
  typeof GrandHallPanoramaMaskSetV1Schema
>;

const Matrix4dSchema = z.tuple([
  z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(),
  z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(),
  z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(),
  z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(),
]);

export function computeGrandHallReviewedTransformMatrixSha256(
  matrix: readonly number[],
): string {
  const parsed = Matrix4dSchema.parse(matrix);
  return canonicalDigest("venviewer.grand-hall-reviewed-transform-matrix.v1", parsed);
}

const GrandHallReviewedTransformMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_XGRIDS_TO_MATTERPAK_E57_TRANSFORM_V1),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    scopeReviewPackSha256: RuntimeSha256Schema,
    sourceXgridsReceiptSha256: RuntimeSha256Schema,
    sourceXgridsOutputInventorySha256: RuntimeSha256Schema,
    targetMatterPakE57ReceiptSha256: RuntimeSha256Schema,
    targetBoundaryEvidenceSha256: RuntimeSha256Schema,
    transformArtifact: TransformArtifactV0Schema,
    matrixSha256: RuntimeSha256Schema,
    independentOverlayReviewCompleted: z.literal(true),
    humanReview: AcceptedHumanReviewSchema,
  })
  .strict();

type GrandHallReviewedTransformMaterialObject = z.infer<
  typeof GrandHallReviewedTransformMaterialObjectSchema
>;

function transformPoint(matrix: readonly number[], point: readonly [number, number, number]): [number, number, number] {
  const m0 = matrix[0] ?? Number.NaN;
  const m1 = matrix[1] ?? Number.NaN;
  const m2 = matrix[2] ?? Number.NaN;
  const m4 = matrix[4] ?? Number.NaN;
  const m5 = matrix[5] ?? Number.NaN;
  const m6 = matrix[6] ?? Number.NaN;
  const m8 = matrix[8] ?? Number.NaN;
  const m9 = matrix[9] ?? Number.NaN;
  const m10 = matrix[10] ?? Number.NaN;
  const m12 = matrix[12] ?? Number.NaN;
  const m13 = matrix[13] ?? Number.NaN;
  const m14 = matrix[14] ?? Number.NaN;
  return [
    m0 * point[0] + m4 * point[1] + m8 * point[2] + m12,
    m1 * point[0] + m5 * point[1] + m9 * point[2] + m13,
    m2 * point[0] + m6 * point[1] + m10 * point[2] + m14,
  ];
}

function hasNonCollinearControlTriple(
  points: readonly (readonly [number, number, number])[],
): boolean {
  const epsilon = 1e-9;
  for (let first = 0; first < points.length - 2; first += 1) {
    const a = points[first];
    if (a === undefined) continue;
    for (let second = first + 1; second < points.length - 1; second += 1) {
      const b = points[second];
      if (b === undefined) continue;
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
      for (let third = second + 1; third < points.length; third += 1) {
        const c = points[third];
        if (c === undefined) continue;
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
        const cross = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ] as const;
        const crossMagnitude = Math.hypot(...cross);
        const scale = Math.max(Math.hypot(...u) * Math.hypot(...v), 1);
        if (crossMagnitude > epsilon * scale) return true;
      }
    }
  }
  return false;
}

function refineReviewedTransform(
  material: GrandHallReviewedTransformMaterialObject,
  ctx: z.RefinementCtx,
): void {
  const transform = material.transformArtifact;
  const matrix = transform.matrix;
  if (
    transform.sourceFrame !== GRAND_HALL_XGRIDS_SOURCE_FRAME ||
    transform.targetFrame !== GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifact"],
      message: "reviewed XGRIDS placement must use the canonical typed ARF to CVF contract",
    });
  }
  if (transform.alignmentMethod !== "landmark_solve") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifact", "alignmentMethod"],
      message: "accepted Grand Hall ARF to CVF transform must be an evidence-backed landmark solve",
    });
  }
  if (transform.provenance.state === "generated") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifact", "provenance", "state"],
      message: "a generated transform cannot establish source-faithful Grand Hall placement",
    });
  }
  const requiredProvenance = [
    [material.sourceXgridsReceiptSha256, "source_xgrids_receipt"],
    [material.sourceXgridsOutputInventorySha256, "source_xgrids_output_inventory"],
    [material.targetMatterPakE57ReceiptSha256, "target_matterpak_e57_receipt"],
    [material.targetBoundaryEvidenceSha256, "target_boundary_evidence"],
  ] as const;
  for (const [digest, role] of requiredProvenance) {
    if (!transform.provenance.refs.some(
      (reference) =>
        reference.refType === "artifact" &&
        reference.ref === digest &&
        reference.role === role,
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transformArtifact", "provenance", "refs"],
        message: `reviewed transform provenance must bind ${role}`,
      });
    }
  }
  if (material.matrixSha256 !== computeGrandHallReviewedTransformMatrixSha256(matrix)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["matrixSha256"],
      message: "matrix digest must bind the exact 16 column-major transform values",
    });
  }
  if (transform.landmarks.length < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifact", "landmarks"],
      message: "accepted Grand Hall ARF to CVF transform requires at least three reviewed landmarks",
    });
  }
  if (!hasNonCollinearControlTriple(transform.landmarks.map((landmark) => landmark.source))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifact", "landmarks"],
      message: "accepted transform source controls must contain a non-collinear rank-sufficient triple",
    });
  }
  if (!hasNonCollinearControlTriple(transform.landmarks.map((landmark) => landmark.target))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifact", "landmarks"],
      message: "accepted transform target controls must contain a non-collinear rank-sufficient triple",
    });
  }
  if (new Set(transform.landmarks.map((landmark) => landmark.id)).size !== transform.landmarks.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifact", "landmarks"],
      message: "reviewed transform landmark identifiers must be unique",
    });
  }
  if (
    transform.reviewer.id !== material.humanReview.reviewerId ||
    transform.date !== material.humanReview.reviewedAt
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["humanReview"],
      message: "acceptance review must be the exact human reviewer and instant embedded in TransformArtifactV0",
    });
  }
  let squaredResidualTotal = 0;
  transform.landmarks.forEach((landmark, index) => {
    const transformed = transformPoint(matrix, landmark.source);
    const residual = Math.hypot(
      transformed[0] - landmark.target[0],
      transformed[1] - landmark.target[1],
      transformed[2] - landmark.target[2],
    );
    squaredResidualTotal += residual * residual;
    if (landmark.residualM === null || landmark.residualM === undefined ||
      Math.abs(residual - landmark.residualM) > 1e-6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transformArtifact", "landmarks", index, "residualM"],
        message: "landmark residual must match the recorded matrix and exact source/target coordinates",
      });
    }
    if (!landmark.provenanceRefs.some(
      (reference) => reference.refType === "artifact" && /^sha256:[a-f0-9]{64}$/u.test(reference.ref),
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transformArtifact", "landmarks", index, "provenanceRefs"],
        message: "each accepted transform landmark must bind immutable artifact evidence",
      });
    }
  });
  const expectedRmse = Math.sqrt(squaredResidualTotal / transform.landmarks.length);
  if (transform.residualRmseM === null || Math.abs(expectedRmse - transform.residualRmseM) > 1e-6) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifact", "residualRmseM"],
      message: "transform RMSE must match the exact reviewed landmark residuals",
    });
  }
}

export const GrandHallReviewedTransformV1MaterialSchema =
  GrandHallReviewedTransformMaterialObjectSchema.superRefine(refineReviewedTransform);
export type GrandHallReviewedTransformV1Material = z.infer<
  typeof GrandHallReviewedTransformV1MaterialSchema
>;

export function computeGrandHallReviewedTransformV1Sha256(
  material: GrandHallReviewedTransformV1Material,
): string {
  const parsed = GrandHallReviewedTransformV1MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_XGRIDS_TO_MATTERPAK_E57_TRANSFORM_V1, parsed);
}

const GrandHallReviewedTransformObjectSchema = GrandHallReviewedTransformMaterialObjectSchema.extend({
  artifactSha256: RuntimeSha256Schema,
}).strict();

export const GrandHallReviewedTransformV1Schema =
  GrandHallReviewedTransformObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refineReviewedTransform(material, ctx);
    if (
      artifactSha256 !==
      canonicalDigest(GRAND_HALL_XGRIDS_TO_MATTERPAK_E57_TRANSFORM_V1, material)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactSha256"],
        message: "transform digest must bind exact source/target lineage, matrix, landmarks, and review",
      });
    }
  });
export type GrandHallReviewedTransformV1 = z.infer<
  typeof GrandHallReviewedTransformV1Schema
>;

export const GrandHallOutputSourceMemberSchema = z
  .object({
    memberIndex: z.number().int().nonnegative().max(255),
    fileName: SafeRelativeFileSchema,
    sha256: RuntimeSha256Schema,
    byteLength: PositiveByteLengthSchema,
    firstRecordIndex: MAX_SAFE_COUNT,
    recordCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export type GrandHallOutputSourceMember = z.infer<
  typeof GrandHallOutputSourceMemberSchema
>;

export function computeGrandHallOutputSourceOrderingSha256(
  sourceFrame: typeof GRAND_HALL_XGRIDS_SOURCE_FRAME,
  members: readonly GrandHallOutputSourceMember[],
): string {
  const parsed = z.array(GrandHallOutputSourceMemberSchema).min(1).max(256).parse(members);
  return canonicalDigest("venviewer.grand-hall-output-source-ordering.v1", {
    sourceFrame,
    members: parsed,
  });
}

const GrandHallOutputInventoryMaskMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_OUTPUT_INVENTORY_MASK_V1),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    scopeReviewPackSha256: RuntimeSha256Schema,
    sourceFrame: z.literal(GRAND_HALL_XGRIDS_SOURCE_FRAME),
    classificationFrame: z.literal(GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME),
    recordKind: z.enum(["point", "gaussian"]),
    xgridsSourceReceiptSha256: RuntimeSha256Schema,
    xgridsOutputInventorySha256: RuntimeSha256Schema,
    sourceOrderingSha256: RuntimeSha256Schema,
    transformArtifactSha256: RuntimeSha256Schema,
    closedBoundaryArtifactSha256: RuntimeSha256Schema,
    sourceMembers: z.array(GrandHallOutputSourceMemberSchema).min(1).max(256),
    totalRecordCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    includedRecordCount: MAX_SAFE_COUNT,
    excludedRecordCount: MAX_SAFE_COUNT,
    encoding: z.literal("ordered_source_record_membership_bitset_v1"),
    bitOrder: z.literal("least_significant_bit_first_within_each_byte"),
    includedBitValue: z.literal(1),
    excludedBitValue: z.literal(0),
    bitsetFileName: SafeRelativeFileSchema.refine(
      (value) => /\.bin$/iu.test(value),
      "output inventory mask must name a binary bitset file",
    ),
    bitsetSha256: RuntimeSha256Schema,
    bitsetByteLength: PositiveByteLengthSchema,
    trailingPaddingBitCount: z.number().int().min(0).max(7),
    trailingPaddingBitsZero: z.literal(true),
    humanReview: AcceptedHumanReviewSchema,
  })
  .strict();

type GrandHallOutputInventoryMaskMaterialObject = z.infer<
  typeof GrandHallOutputInventoryMaskMaterialObjectSchema
>;

function refineOutputInventoryMask(
  material: GrandHallOutputInventoryMaskMaterialObject,
  ctx: z.RefinementCtx,
): void {
  let nextRecordIndex = 0;
  material.sourceMembers.forEach((member, index) => {
    if (member.memberIndex !== index) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceMembers", index, "memberIndex"],
        message: "source member inventory must preserve exact zero-based member ordering",
      });
    }
    if (member.firstRecordIndex !== nextRecordIndex) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceMembers", index, "firstRecordIndex"],
        message: "source record ranges must be contiguous in exact inventory order",
      });
    }
    nextRecordIndex += member.recordCount;
  });
  if (new Set(material.sourceMembers.map((member) => member.fileName)).size !== material.sourceMembers.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceMembers"],
      message: "source member filenames must be unique",
    });
  }
  if (material.totalRecordCount !== nextRecordIndex) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["totalRecordCount"],
      message: "total record count must equal the exact ordered source member inventory",
    });
  }
  if (material.includedRecordCount + material.excludedRecordCount !== material.totalRecordCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["includedRecordCount"],
      message: "included and excluded record counts must partition the complete source inventory",
    });
  }
  const expectedByteLength = Math.ceil(material.totalRecordCount / 8);
  if (material.bitsetByteLength !== expectedByteLength) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bitsetByteLength"],
      message: "bitset byte length must cover the exact source record count",
    });
  }
  const expectedPadding = expectedByteLength * 8 - material.totalRecordCount;
  if (material.trailingPaddingBitCount !== expectedPadding) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["trailingPaddingBitCount"],
      message: "trailing padding count must exactly match the final partial byte",
    });
  }
  if (
    material.sourceOrderingSha256 !==
    computeGrandHallOutputSourceOrderingSha256(material.sourceFrame, material.sourceMembers)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceOrderingSha256"],
      message: "source ordering digest must bind the exact frame, member order, offsets, and counts",
    });
  }
}

export const GrandHallOutputInventoryMaskV1MaterialSchema =
  GrandHallOutputInventoryMaskMaterialObjectSchema.superRefine(refineOutputInventoryMask);
export type GrandHallOutputInventoryMaskV1Material = z.infer<
  typeof GrandHallOutputInventoryMaskV1MaterialSchema
>;

export function computeGrandHallOutputInventoryMaskV1Sha256(
  material: GrandHallOutputInventoryMaskV1Material,
): string {
  const parsed = GrandHallOutputInventoryMaskV1MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_OUTPUT_INVENTORY_MASK_V1, parsed);
}

const GrandHallOutputInventoryMaskObjectSchema = GrandHallOutputInventoryMaskMaterialObjectSchema.extend({
  artifactSha256: RuntimeSha256Schema,
}).strict();

export const GrandHallOutputInventoryMaskV1Schema =
  GrandHallOutputInventoryMaskObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refineOutputInventoryMask(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_OUTPUT_INVENTORY_MASK_V1, material)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactSha256"],
        message: "output mask digest must bind the exact source ordering, frame, transform, and bitset",
      });
    }
  });
export type GrandHallOutputInventoryMaskV1 = z.infer<
  typeof GrandHallOutputInventoryMaskV1Schema
>;

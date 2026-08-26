import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  GRAND_HALL_CLOSED_BOUNDARY_V1,
  GRAND_HALL_EXACT_INTERFACE_COUNT,
  GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
  GRAND_HALL_MATTERPAK_ROOM_KEY,
  GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_MASK_SET_V1,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_PORTAL_DECISIONS_V1,
  GRAND_HALL_REVIEW_PANORAMA_COUNT,
  GRAND_HALL_ROOM_MEMBERSHIP_V2,
  GrandHallClosedBoundaryV1MaterialSchema,
  GrandHallClosedBoundaryV1Schema,
  GrandHallPanoramaMaskSetV1MaterialSchema,
  GrandHallPanoramaMaskSetV1Schema,
  GrandHallPortalDecisionsV1MaterialSchema,
  GrandHallPortalDecisionsV1Schema,
  GrandHallRoomMembershipV2MaterialSchema,
  GrandHallRoomMembershipV2Schema,
  GrandHallScopeReviewPackV1Schema,
  computeGrandHallClosedBoundaryV1Sha256,
  computeGrandHallPanoramaMaskSetV1Sha256,
  computeGrandHallPortalDecisionsV1Sha256,
  computeGrandHallRoomMembershipV2Sha256,
  stableCanonicalJson,
  type GrandHallClosedBoundaryV1,
  type GrandHallPanoramaMaskSetV1,
  type GrandHallPortalDecisionsV1,
  type GrandHallRoomMembershipV2,
  type GrandHallScopeReviewPackV1,
} from "@omnitwin/types";
import { z } from "zod";

import {
  GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME,
  verifyPersistedGrandHallT554RootReviewPack,
} from "./grand-hall-t554-review-pack.js";
import {
  GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
  GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
  validateGrandHallT554MaskPngBytes,
  validateGrandHallT554SourceJpegBytes,
} from "./grand-hall-t554-media-validation.js";
import { isSafeGrandHallT554RelativePath } from "./grand-hall-t554-path-safety.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_HUMAN_DECISIONS_V1 =
  "venviewer.grand-hall-t554-human-decisions.v1";
export const GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1 =
  "venviewer.grand-hall-t554-closed-volume-review.v1";

const HUMAN_DECISIONS_DIGEST_DOMAIN =
  "venviewer.grand-hall-t554-human-decisions-digest.v1";
const CLOSED_VOLUME_REVIEW_DIGEST_DOMAIN =
  "venviewer.grand-hall-t554-closed-volume-review-digest.v1";
const MAX_JSON_BYTES = 16 * 1_024 * 1_024;
const PANORAMA_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const SHA256_SCHEMA = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const SAFE_ID_SCHEMA = z.string().trim().min(1).max(160);
const NOTE_SCHEMA = z.string().trim().min(1).max(1_000);
const INTERFACE_NOTE_SCHEMA = z.string().trim().min(1).max(500);
const ISO_INSTANT_SCHEMA = z.string().datetime({ offset: true });
const TEMPLATE_OUTPUT_FILE_NAMES = [
  "closed-selection-volume.json",
  "human-decisions.json",
] as const;
const MASK_BINDING_OUTPUT_FILE_NAMES = ["human-decisions.json"] as const;
const ACCEPTED_OUTPUT_FILE_NAMES = [
  "closed-selection-volume.json",
  "interface-decisions.json",
  "panorama-mask-set.json",
  "room-membership.json",
] as const;
const PRESERVED_REVIEW_FILE_NAMES = [
  "review-pack.json",
  "review/human-decisions.json",
  "review/closed-selection-volume-review.json",
] as const;
const PUBLICATION_RECEIPT_FILE_NAME = "publication-receipt.json";
const STAGED_PUBLICATION_RECEIPT_FILE_NAME = "publication-receipt.pending";

const SAFE_RELATIVE_FILE_SCHEMA = z.string().trim().min(1).max(512).superRefine(
  (value, ctx) => {
    if (!isSafeGrandHallT554RelativePath(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "file must be a canonical traversal-free POSIX relative path",
      });
    }
  },
);

const HumanReviewerSchema = z.object({
  reviewerId: SAFE_ID_SCHEMA,
  reviewerRole: z.literal("venue_owner_or_authorized_domain_reviewer"),
  reviewedAt: ISO_INSTANT_SCHEMA,
  knowledgeBasis: z.array(z.string().trim().min(1).max(240)).min(1).max(32),
  agentDecisionAuthority: z.literal("none"),
}).strict();

const PanoramaClassificationSchema = z.enum([
  "grand_hall_core",
  "grand_hall_portal_threshold",
  "adjacent_room_or_outside_grand_hall",
]);

const PanoramaMaskReasonSchema = z.enum([
  "adjacent_room_pixels",
  "portal_beyond_grand_hall_plane",
  "facade_or_exterior_pixels",
  "capture_artifact_outside_verified_room",
  "unverified_or_unknown_pixels",
]);

const ReviewedMaskBindingSchema = z.object({
  sha256: SHA256_SCHEMA,
  byteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  includedPixelCount: z.number().int().positive().max(PANORAMA_PIXEL_COUNT),
  excludedPixelCount: z.number().int().nonnegative().max(PANORAMA_PIXEL_COUNT),
}).strict().superRefine((binding, ctx) => {
  if (binding.includedPixelCount + binding.excludedPixelCount !== PANORAMA_PIXEL_COUNT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["excludedPixelCount"],
      message: "reviewed mask counts must cover the exact source panorama grid",
    });
  }
});

const PanoramaDecisionObjectSchema = z.object({
  sweepNumber: z.number().int().min(1).max(GRAND_HALL_REVIEW_PANORAMA_COUNT),
  sourceJpgFileName: SAFE_RELATIVE_FILE_SCHEMA,
  sourceJpgSha256: SHA256_SCHEMA,
  sourceJpgByteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
  heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
  result: z.enum(["UNSURE", "INCLUDE", "EXCLUDE"]),
  classification: PanoramaClassificationSchema.nullable(),
  maskFileName: SAFE_RELATIVE_FILE_SCHEMA.refine(
    (value) => /\.png$/iu.test(value),
    "mask file must name a PNG",
  ).nullable(),
  reviewedMaskBinding: ReviewedMaskBindingSchema.nullable(),
  maskReviewed: z.boolean(),
  maskReasonCodes: z.array(PanoramaMaskReasonSchema).max(5),
  note: NOTE_SCHEMA.nullable(),
}).strict();

type PanoramaDecisionDocument = z.infer<typeof PanoramaDecisionObjectSchema>;

function panoramaDecisionShapeIsValid(decision: PanoramaDecisionDocument): boolean {
  if (decision.result === "UNSURE") {
    return decision.classification === null &&
      decision.maskFileName === null &&
      decision.reviewedMaskBinding === null &&
      !decision.maskReviewed &&
      decision.maskReasonCodes.length === 0;
  }
  if (decision.result === "INCLUDE") {
    return (
      decision.classification === "grand_hall_core" ||
      decision.classification === "grand_hall_portal_threshold"
    ) && decision.maskFileName !== null && decision.note !== null;
  }
  return decision.classification === "adjacent_room_or_outside_grand_hall" &&
    decision.maskFileName === null &&
    decision.reviewedMaskBinding === null &&
    !decision.maskReviewed &&
    decision.maskReasonCodes.length === 0 &&
    decision.note !== null;
}

function panoramaDecisionShapeMessage(decision: PanoramaDecisionDocument): string {
  if (decision.result === "UNSURE") {
    return "an UNSURE panorama must not contain an accepted classification or mask";
  }
  if (decision.result === "INCLUDE") {
    return "an included panorama requires a reviewed binary mask and Grand Hall classification";
  }
  return "a whole-frame exclusion must be reviewed as outside the Grand Hall and have no mask";
}

function refinePanoramaDecision(
  decision: PanoramaDecisionDocument,
  ctx: z.RefinementCtx,
): void {
  if (new Set(decision.maskReasonCodes).size !== decision.maskReasonCodes.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maskReasonCodes"],
      message: "mask reason codes must be unique",
    });
  }
  if (!panoramaDecisionShapeIsValid(decision)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: panoramaDecisionShapeMessage(decision),
    });
  }
}

const PanoramaDecisionSchema = PanoramaDecisionObjectSchema.superRefine(refinePanoramaDecision);

const InterfaceDecisionSchema = z.object({
  interfaceId: SAFE_ID_SCHEMA,
  grandHallRoomKey: z.literal(GRAND_HALL_MATTERPAK_ROOM_KEY),
  adjacentSourceRoomKey: SAFE_ID_SCHEMA,
  sharedSourceVertexCount: z.number().int().positive(),
  sharedSourceVertexSetSha256: SHA256_SCHEMA,
  boundsMeters: z.object({
    min: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    max: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  }).strict(),
  result: z.enum([
    "UNSURE",
    "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE",
    "EXCLUDE_BEYOND_INTERFACE",
    "NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT",
  ]),
  note: INTERFACE_NOTE_SCHEMA.nullable(),
}).strict().superRefine((decision, ctx) => {
  if (decision.result !== "UNSURE" && decision.note === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["note"],
      message: "a resolved interface requires a human decision note",
    });
  }
});

const MatterPakRoomDecisionSchema = z.object({
  sourceRoomKey: z.literal(GRAND_HALL_MATTERPAK_ROOM_KEY),
  sourceMembershipV1Sha256: SHA256_SCHEMA,
  sourceBoundaryEvidenceSha256: SHA256_SCHEMA,
  result: z.enum(["UNSURE", "ACCEPT_AS_GRAND_HALL", "REJECT_AS_GRAND_HALL"]),
  note: NOTE_SCHEMA.nullable(),
}).strict().superRefine((decision, ctx) => {
  if (decision.result !== "UNSURE" && decision.note === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["note"],
      message: "a resolved MatterPak room decision requires a human evidence note",
    });
  }
});

const CleanupArtifactInspectionSchema = z.object({
  artifactClass: z.enum(["Window", "Mirror"]),
  sourceBoundaryEvidenceSha256: SHA256_SCHEMA,
  result: z.enum([
    "UNSURE",
    "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY",
    "REJECT_SOURCE_SCOPE_HANDLING",
  ]),
  note: NOTE_SCHEMA.nullable(),
}).strict().superRefine((inspection, ctx) => {
  if (inspection.result !== "UNSURE" && inspection.note === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["note"],
      message: "a resolved cleanup-artifact inspection requires a human evidence note",
    });
  }
});

const NonCandidatePanoramaDecisionSchema = z.object({
  inventoryIndex: z.number().int().nonnegative()
    .max(GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT - 1),
  sourceJpgFileName: SAFE_RELATIVE_FILE_SCHEMA,
  sourceJpgSha256: SHA256_SCHEMA,
  sourceJpgByteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  embeddedSweepNumber: z.number().int().positive().nullable(),
  result: z.enum([
    "UNSURE",
    "EXCLUDE_OUTSIDE_GRAND_HALL",
    "GRAND_HALL_EVIDENCE_FOUND_REVIEW_SET_INCOMPLETE",
  ]),
  note: NOTE_SCHEMA.nullable(),
}).strict().superRefine((decision, ctx) => {
  if (decision.result !== "UNSURE" && decision.note === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["note"],
      message: "a resolved non-candidate panorama decision requires a human evidence note",
    });
  }
});

const HumanDecisionsObjectSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T554_HUMAN_DECISIONS_V1),
  venueSlug: z.literal("trades-hall"),
  roomSlug: z.literal("grand-hall"),
  reviewPackSha256: SHA256_SCHEMA,
  authority: z.literal("none"),
  reviewState: z.enum(["human_pending", "human_accepted", "human_rejected"]),
  finalDecision: z.enum(["PENDING", "ACCEPT", "REJECT"]),
  reviewer: HumanReviewerSchema.nullable(),
  generatedFillPermitted: z.literal(false),
  geometricCameraAuthority: z.literal("none"),
  matterPakRoomDecision: MatterPakRoomDecisionSchema,
  cleanupArtifactInspections: z.array(CleanupArtifactInspectionSchema).length(2),
  panoramaDecisions: z.array(PanoramaDecisionSchema).length(GRAND_HALL_REVIEW_PANORAMA_COUNT),
  nonCandidatePanoramaDecisions: z.array(NonCandidatePanoramaDecisionSchema)
    .length(GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT - GRAND_HALL_REVIEW_PANORAMA_COUNT),
  interfaceDecisions: z.array(InterfaceDecisionSchema).length(GRAND_HALL_EXACT_INTERFACE_COUNT),
}).strict();

type HumanDecisionsDocument = z.infer<typeof HumanDecisionsObjectSchema>;

function refineHumanDecisionLifecycle(
  document: HumanDecisionsDocument,
  ctx: z.RefinementCtx,
): void {
  const pending = document.reviewState === "human_pending";
  const accepted = document.reviewState === "human_accepted";
  const rejected = document.reviewState === "human_rejected";
  if (
    pending !== (document.finalDecision === "PENDING") ||
    accepted !== (document.finalDecision === "ACCEPT") ||
    rejected !== (document.finalDecision === "REJECT") ||
    pending !== (document.reviewer === null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "review state, final decision, and reviewer must describe one coherent lifecycle state",
    });
  }
}

function refineHumanPanoramaDecisions(
  document: HumanDecisionsDocument,
  ctx: z.RefinementCtx,
): void {
  const accepted = document.reviewState === "human_accepted";
  document.panoramaDecisions.forEach((decision, index) => {
    if (decision.sweepNumber !== index + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["panoramaDecisions", index, "sweepNumber"],
        message: "panorama decisions must preserve exact sweep order 1 through 50",
      });
    }
    if (accepted && decision.result === "UNSURE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["panoramaDecisions", index, "result"],
        message: "an accepted review cannot retain an UNSURE panorama",
      });
    }
  });
}

function refineAcceptedHumanDecisions(
  document: HumanDecisionsDocument,
  ctx: z.RefinementCtx,
): void {
  if (document.reviewState !== "human_accepted") return;
  if (document.matterPakRoomDecision.result !== "ACCEPT_AS_GRAND_HALL") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["matterPakRoomDecision", "result"],
      message: "accepted scope requires explicit human acceptance of exact MatterPak room 9",
    });
  }
  document.cleanupArtifactInspections.forEach((inspection, index) => {
    if (inspection.result !== "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cleanupArtifactInspections", index, "result"],
        message: "accepted scope requires explicit Window/Mirror source-artifact inspection",
      });
    }
  });
  document.nonCandidatePanoramaDecisions.forEach((decision, index) => {
    if (decision.result !== "EXCLUDE_OUTSIDE_GRAND_HALL") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nonCandidatePanoramaDecisions", index, "result"],
        message: "all 98 non-candidate panoramas require human exclusion before acceptance",
      });
    }
  });
}

function refineAcceptedMaskBindings(
  document: HumanDecisionsDocument,
  ctx: z.RefinementCtx,
): void {
  if (document.reviewState !== "human_accepted") return;
  document.panoramaDecisions.forEach((decision, index) => {
    if (decision.result === "INCLUDE" &&
      (!decision.maskReviewed || decision.reviewedMaskBinding === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["panoramaDecisions", index, "reviewedMaskBinding"],
        message: "an accepted included panorama must bind the exact mask bytes reviewed by the human",
      });
    }
  });
}

function refineHumanInterfaceDecisions(
  document: HumanDecisionsDocument,
  ctx: z.RefinementCtx,
): void {
  if (document.reviewState !== "human_accepted") return;
  document.interfaceDecisions.forEach((decision, index) => {
    if (decision.result === "UNSURE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interfaceDecisions", index, "result"],
        message: "an accepted review must resolve every exact interface",
      });
    }
  });
}

function refineHumanDecisions(document: HumanDecisionsDocument, ctx: z.RefinementCtx): void {
  refineHumanDecisionLifecycle(document, ctx);
  refineHumanPanoramaDecisions(document, ctx);
  refineHumanInterfaceDecisions(document, ctx);
  refineAcceptedHumanDecisions(document, ctx);
  refineAcceptedMaskBindings(document, ctx);
}

export const GrandHallT554HumanDecisionsSchema =
  HumanDecisionsObjectSchema.superRefine(refineHumanDecisions);

export type GrandHallT554HumanDecisions = z.infer<
  typeof GrandHallT554HumanDecisionsSchema
>;

const ClosedVolumeReviewObjectSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1),
  venueSlug: z.literal("trades-hall"),
  roomSlug: z.literal("grand-hall"),
  reviewPackSha256: SHA256_SCHEMA,
  authority: z.literal("none"),
  reviewState: z.enum(["human_pending", "human_accepted", "human_rejected"]),
  finalDecision: z.enum(["PENDING", "ACCEPT", "REJECT"]),
  reviewer: HumanReviewerSchema.nullable(),
  sourceFrame: z.literal(GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME),
  units: z.literal("meters"),
  geometryRole: z.literal("non_rendered_selection_volume"),
  construction: z.literal("extruded_simple_xy_polygon"),
  footprintXY: z.array(z.tuple([z.number().finite(), z.number().finite()])).max(2_048),
  zMin: z.number().finite().nullable(),
  zMax: z.number().finite().nullable(),
  rendered: z.literal(false),
  collisionGeometry: z.literal(false),
  exportedAsArchitecture: z.literal(false),
  generatedGeometryCreated: z.literal(false),
  note: NOTE_SCHEMA.nullable(),
}).strict();

export const GrandHallT554ClosedVolumeReviewSchema =
  ClosedVolumeReviewObjectSchema.superRefine((document, ctx) => {
    const pending = document.reviewState === "human_pending";
    const accepted = document.reviewState === "human_accepted";
    const rejected = document.reviewState === "human_rejected";
    if (
      pending !== (document.finalDecision === "PENDING") ||
      accepted !== (document.finalDecision === "ACCEPT") ||
      rejected !== (document.finalDecision === "REJECT") ||
      pending !== (document.reviewer === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "volume review state, final decision, and reviewer must be coherent",
      });
    }
    if (pending) {
      if (
        document.footprintXY.length !== 0 ||
        document.zMin !== null ||
        document.zMax !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "a pending volume template cannot contain authored geometry",
        });
      }
    } else if (accepted && (
      document.footprintXY.length < 3 ||
      document.zMin === null ||
      document.zMax === null ||
      document.note === null
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an accepted volume requires a reviewed footprint, Z extent, and note",
      });
    }
  });

export type GrandHallT554ClosedVolumeReview = z.infer<
  typeof GrandHallT554ClosedVolumeReviewSchema
>;

export interface GrandHallT554PanoramaSourceEvidence {
  readonly fileName: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly exactSourceGridDecoded: boolean;
}

export interface GrandHallT554PanoramaMaskEvidence {
  readonly fileName: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly includedPixelCount: number;
  readonly excludedPixelCount: number;
  readonly exactBinarySourceGridDecoded: boolean;
}

export interface GrandHallT554AcceptanceMediaEvidence {
  readonly sourceJpegs: ReadonlyMap<string, GrandHallT554PanoramaSourceEvidence>;
  readonly masks: ReadonlyMap<string, GrandHallT554PanoramaMaskEvidence>;
}

export interface GrandHallT554AcceptedScopeArtifacts {
  readonly roomMembership: GrandHallRoomMembershipV2;
  readonly interfaceDecisions: GrandHallPortalDecisionsV1;
  readonly closedBoundary: GrandHallClosedBoundaryV1;
  readonly panoramaMaskSet: GrandHallPanoramaMaskSetV1;
}

export interface GrandHallT554AcceptanceTemplates {
  readonly humanDecisions: GrandHallT554HumanDecisions;
  readonly closedVolume: GrandHallT554ClosedVolumeReview;
}

export type GrandHallT554AcceptanceErrorCode =
  | "ARGUMENT_INVALID"
  | "REVIEW_PACK_INVALID"
  | "DECISIONS_INVALID"
  | "SOURCE_IDENTITY_DRIFT"
  | "MASK_EVIDENCE_INVALID"
  | "VOLUME_INVALID"
  | "PATH_UNSAFE"
  | "FILE_INVALID"
  | "OUTPUT_EXISTS"
  | "OUTPUT_PUBLISH_FAILED";

export class GrandHallT554AcceptanceError extends Error {
  readonly code: GrandHallT554AcceptanceErrorCode;

  constructor(
    code: GrandHallT554AcceptanceErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554AcceptanceError";
    this.code = code;
  }
}

function digest(domain: string, value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(value as never)}`)
    .digest("hex")}`;
}

function parseOrAcceptanceError<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: GrandHallT554AcceptanceErrorCode,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new GrandHallT554AcceptanceError(
      code,
      `${label} failed strict validation: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
      result.error,
    );
  }
  return result.data;
}

function acceptedHumanReview(
  reviewer: NonNullable<GrandHallT554HumanDecisions["reviewer"]>,
) {
  return {
    state: "human_accepted" as const,
    reviewerId: reviewer.reviewerId,
    reviewerRole: reviewer.reviewerRole,
    reviewedAt: reviewer.reviewedAt,
    knowledgeBasis: reviewer.knowledgeBasis,
    agentDecisionAuthority: reviewer.agentDecisionAuthority,
  };
}

function pendingCandidatePanoramaDecisions(reviewPack: GrandHallScopeReviewPackV1) {
  return reviewPack.candidatePanoramaSources.map((source) => ({
    sweepNumber: source.sweepNumber,
    sourceJpgFileName: source.fileName,
    sourceJpgSha256: source.sha256,
    sourceJpgByteLength: source.byteLength,
    widthPx: source.widthPx,
    heightPx: source.heightPx,
    result: "UNSURE" as const,
    classification: null,
    maskFileName: null,
    reviewedMaskBinding: null,
    maskReviewed: false,
    maskReasonCodes: [],
    note: null,
  }));
}

function pendingNonCandidatePanoramaDecisions(reviewPack: GrandHallScopeReviewPackV1) {
  return reviewPack.panoramaDirectoryFiles
    .filter((source) => source.t554Eligibility === "ineligible_unreviewed")
    .map((source) => ({
      inventoryIndex: source.inventoryIndex,
      sourceJpgFileName: source.fileName,
      sourceJpgSha256: source.sha256,
      sourceJpgByteLength: source.byteLength,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
      embeddedSweepNumber: source.embeddedSweepNumber,
      result: "UNSURE" as const,
      note: null,
    }));
}

function buildPendingHumanDecisions(
  reviewPack: GrandHallScopeReviewPackV1,
): GrandHallT554HumanDecisions {
  return parseOrAcceptanceError(
    GrandHallT554HumanDecisionsSchema,
    {
      schemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V1,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      reviewPackSha256: reviewPack.artifactSha256,
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      reviewer: null,
      generatedFillPermitted: false,
      geometricCameraAuthority: "none",
      matterPakRoomDecision: {
        sourceRoomKey: GRAND_HALL_MATTERPAK_ROOM_KEY,
        sourceMembershipV1Sha256: reviewPack.sourceEvidence.t550PendingMembershipV1Sha256,
        sourceBoundaryEvidenceSha256: reviewPack.sourceEvidence.t551SourceEvidenceSha256,
        result: "UNSURE",
        note: null,
      },
      cleanupArtifactInspections: (["Window", "Mirror"] as const).map((artifactClass) => ({
        artifactClass,
        sourceBoundaryEvidenceSha256: reviewPack.sourceEvidence.t551SourceEvidenceSha256,
        result: "UNSURE",
        note: null,
      })),
      panoramaDecisions: pendingCandidatePanoramaDecisions(reviewPack),
      nonCandidatePanoramaDecisions: pendingNonCandidatePanoramaDecisions(reviewPack),
      interfaceDecisions: reviewPack.interfaceCandidates.map((candidate) => ({
        ...candidate,
        result: "UNSURE",
        note: null,
      })),
    },
    "DECISIONS_INVALID",
    "generated human-decision template",
  );
}

function buildPendingClosedVolume(
  reviewPack: GrandHallScopeReviewPackV1,
): GrandHallT554ClosedVolumeReview {
  return parseOrAcceptanceError(
    GrandHallT554ClosedVolumeReviewSchema,
    {
      schemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      reviewPackSha256: reviewPack.artifactSha256,
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      reviewer: null,
      sourceFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
      units: "meters",
      geometryRole: "non_rendered_selection_volume",
      construction: "extruded_simple_xy_polygon",
      footprintXY: [],
      zMin: null,
      zMax: null,
      rendered: false,
      collisionGeometry: false,
      exportedAsArchitecture: false,
      generatedGeometryCreated: false,
      note: null,
    },
    "VOLUME_INVALID",
    "generated closed-volume template",
  );
}

export function buildGrandHallT554AcceptanceTemplates(
  reviewPackInput: unknown,
): GrandHallT554AcceptanceTemplates {
  const reviewPack = parseOrAcceptanceError(
    GrandHallScopeReviewPackV1Schema,
    reviewPackInput,
    "REVIEW_PACK_INVALID",
    "T-554 review pack",
  );
  const humanDecisions = buildPendingHumanDecisions(reviewPack);
  const closedVolume = buildPendingClosedVolume(reviewPack);
  return Object.freeze({ humanDecisions, closedVolume });
}

export function computeGrandHallT554HumanDecisionsSha256(
  decisionsInput: unknown,
): `sha256:${string}` {
  const decisions = parseOrAcceptanceError(
    GrandHallT554HumanDecisionsSchema,
    decisionsInput,
    "DECISIONS_INVALID",
    "human decisions",
  );
  return digest(HUMAN_DECISIONS_DIGEST_DOMAIN, decisions);
}

export function computeGrandHallT554ClosedVolumeReviewSha256(
  volumeInput: unknown,
): `sha256:${string}` {
  const volume = parseOrAcceptanceError(
    GrandHallT554ClosedVolumeReviewSchema,
    volumeInput,
    "VOLUME_INVALID",
    "closed-volume review",
  );
  return digest(CLOSED_VOLUME_REVIEW_DIGEST_DOMAIN, volume);
}

function assertReviewDocumentBindings(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  volume: GrandHallT554ClosedVolumeReview,
): void {
  if (
    decisions.reviewPackSha256 !== reviewPack.artifactSha256 ||
    volume.reviewPackSha256 !== reviewPack.artifactSha256
  ) {
    throw new GrandHallT554AcceptanceError(
      "SOURCE_IDENTITY_DRIFT",
      "The human decisions and closed volume must bind the exact current T-554 review pack.",
    );
  }
}

function assertMatterPakAndCleanupBindings(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
): void {
  if (
    decisions.matterPakRoomDecision.sourceMembershipV1Sha256 !==
      reviewPack.sourceEvidence.t550PendingMembershipV1Sha256 ||
    decisions.matterPakRoomDecision.sourceBoundaryEvidenceSha256 !==
      reviewPack.sourceEvidence.t551SourceEvidenceSha256
  ) {
    throw new GrandHallT554AcceptanceError(
      "SOURCE_IDENTITY_DRIFT",
      "The MatterPak room decision does not bind exact room 9 and its source evidence.",
    );
  }
  const cleanupClasses = ["Window", "Mirror"] as const;
  decisions.cleanupArtifactInspections.forEach((inspection, index) => {
    if (
      inspection.artifactClass !== cleanupClasses[index] ||
      inspection.sourceBoundaryEvidenceSha256 !==
        reviewPack.sourceEvidence.t551SourceEvidenceSha256
    ) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `Cleanup inspection ${String(index)} does not bind the exact source-boundary evidence.`,
      );
    }
  });
}

function assertCandidatePanoramaBindings(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
): void {
  decisions.panoramaDecisions.forEach((decision, index) => {
    const source = reviewPack.candidatePanoramaSources[index];
    if (
      source === undefined ||
      decision.sweepNumber !== source.sweepNumber ||
      decision.sourceJpgFileName !== source.fileName ||
      decision.sourceJpgSha256 !== source.sha256 ||
      decision.sourceJpgByteLength !== source.byteLength
    ) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `Panorama decision ${String(index)} does not bind the exact review-pack source identity.`,
      );
    }
  });
}

function assertInterfaceBindings(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
): void {
  decisions.interfaceDecisions.forEach((decision, index) => {
    const candidate = reviewPack.interfaceCandidates[index];
    if (
      candidate === undefined ||
      stableCanonicalJson({
        interfaceId: decision.interfaceId,
        grandHallRoomKey: decision.grandHallRoomKey,
        adjacentSourceRoomKey: decision.adjacentSourceRoomKey,
        sharedSourceVertexCount: decision.sharedSourceVertexCount,
        sharedSourceVertexSetSha256: decision.sharedSourceVertexSetSha256,
        boundsMeters: decision.boundsMeters,
      } as never) !== stableCanonicalJson(candidate as never)
    ) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `Interface decision ${String(index)} does not bind the exact review-pack topology candidate.`,
      );
    }
  });
}

function assertNonCandidatePanoramaBindings(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
): void {
  const nonCandidates = reviewPack.panoramaDirectoryFiles.filter(
    (source) => source.t554Eligibility === "ineligible_unreviewed",
  );
  decisions.nonCandidatePanoramaDecisions.forEach((decision, index) => {
    const source = nonCandidates[index];
    if (
      source === undefined ||
      decision.inventoryIndex !== source.inventoryIndex ||
      decision.sourceJpgFileName !== source.fileName ||
      decision.sourceJpgSha256 !== source.sha256 ||
      decision.sourceJpgByteLength !== source.byteLength ||
      decision.widthPx !== source.widthPx ||
      decision.heightPx !== source.heightPx ||
      decision.embeddedSweepNumber !== source.embeddedSweepNumber
    ) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `Non-candidate panorama decision ${String(index)} does not bind the exact directory inventory.`,
      );
    }
  });
}

function assertExactReviewBindings(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  volume: GrandHallT554ClosedVolumeReview,
): void {
  assertReviewDocumentBindings(reviewPack, decisions, volume);
  assertMatterPakAndCleanupBindings(reviewPack, decisions);
  assertCandidatePanoramaBindings(reviewPack, decisions);
  assertInterfaceBindings(reviewPack, decisions);
  assertNonCandidatePanoramaBindings(reviewPack, decisions);
}

function assertExactSourceMediaEvidence(
  reviewPack: GrandHallScopeReviewPackV1,
  sourceJpegs: GrandHallT554AcceptanceMediaEvidence["sourceJpegs"],
): void {
  if (sourceJpegs.size !== reviewPack.panoramaDirectoryFiles.length) {
    throw new GrandHallT554AcceptanceError(
      "SOURCE_IDENTITY_DRIFT",
      "Decoded source-JPEG evidence must contain exactly all 148 supplied panorama sources.",
    );
  }
  reviewPack.panoramaDirectoryFiles.forEach((source) => {
    const evidence = sourceJpegs.get(source.fileName);
    if (
      evidence === undefined ||
      evidence.fileName !== source.fileName ||
      evidence.sha256 !== source.sha256 ||
      evidence.byteLength !== source.byteLength ||
      !evidence.exactSourceGridDecoded
    ) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `Source JPEG ${source.fileName} lacks exact full-grid decoded evidence.`,
      );
    }
  });
}

type IncludedPanoramaDecision = GrandHallT554HumanDecisions["panoramaDecisions"][number];
type ReviewedMaskBinding = NonNullable<IncludedPanoramaDecision["reviewedMaskBinding"]>;

interface DecodedMaskAndBinding {
  readonly mask: GrandHallT554PanoramaMaskEvidence;
  readonly reviewedBinding: ReviewedMaskBinding;
}

function requireDecodedMaskAndBinding(
  decision: IncludedPanoramaDecision,
  mediaEvidence: GrandHallT554AcceptanceMediaEvidence,
): DecodedMaskAndBinding {
  if (decision.maskFileName === null) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      `Included sweep ${String(decision.sweepNumber)} has no mask filename.`,
    );
  }
  const mask = mediaEvidence.masks.get(decision.maskFileName);
  const reviewedBinding = decision.reviewedMaskBinding;
  if (
    mask === undefined ||
    reviewedBinding === null ||
    mask.fileName !== decision.maskFileName ||
    !SHA256_SCHEMA.safeParse(mask.sha256).success ||
    !Number.isSafeInteger(mask.byteLength) ||
    mask.byteLength <= 0 ||
    !Number.isSafeInteger(mask.includedPixelCount) ||
    !Number.isSafeInteger(mask.excludedPixelCount) ||
    mask.includedPixelCount <= 0 ||
    mask.excludedPixelCount < 0 ||
    mask.includedPixelCount + mask.excludedPixelCount !== PANORAMA_PIXEL_COUNT ||
    !mask.exactBinarySourceGridDecoded
  ) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      `Mask ${decision.maskFileName} lacks exact binary source-grid evidence.`,
    );
  }
  return { mask, reviewedBinding };
}

function assertMaskMatchesHumanReview(
  mask: GrandHallT554PanoramaMaskEvidence,
  reviewedBinding: ReviewedMaskBinding,
): void {
  if (
    mask.sha256 !== reviewedBinding.sha256 ||
    mask.byteLength !== reviewedBinding.byteLength ||
    mask.includedPixelCount !== reviewedBinding.includedPixelCount ||
    mask.excludedPixelCount !== reviewedBinding.excludedPixelCount
  ) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      `Mask ${mask.fileName} differs from the exact bytes and counts reviewed by the human.`,
    );
  }
}

function assertMaskReasonCodes(
  decision: IncludedPanoramaDecision,
  mask: GrandHallT554PanoramaMaskEvidence,
): void {
  if (
    (mask.excludedPixelCount === 0 && decision.maskReasonCodes.length !== 0) ||
    (mask.excludedPixelCount > 0 && decision.maskReasonCodes.length === 0)
  ) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      `Mask reasons for ${mask.fileName} contradict its decoded pixel counts.`,
    );
  }
}

function assertExactMaskMediaEvidence(
  decisions: GrandHallT554HumanDecisions,
  mediaEvidence: GrandHallT554AcceptanceMediaEvidence,
): void {
  const included = decisions.panoramaDecisions.filter((decision) => decision.result === "INCLUDE");
  const maskNames = included.map((decision) => decision.maskFileName);
  if (
    maskNames.some((name) => name === null) ||
    new Set(maskNames).size !== maskNames.length ||
    mediaEvidence.masks.size !== included.length
  ) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      "Every included panorama must bind exactly one distinct decoded mask and no extra masks.",
    );
  }
  for (const decision of included) {
    const { mask, reviewedBinding } = requireDecodedMaskAndBinding(decision, mediaEvidence);
    assertMaskMatchesHumanReview(mask, reviewedBinding);
    assertMaskReasonCodes(decision, mask);
  }
}

function assertExactMediaEvidence(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  mediaEvidence: GrandHallT554AcceptanceMediaEvidence,
): void {
  assertExactSourceMediaEvidence(reviewPack, mediaEvidence.sourceJpegs);
  assertExactMaskMediaEvidence(decisions, mediaEvidence);
}

const INTERFACE_RESOLUTION = {
  CLOSE_AT_REVIEWED_GRAND_HALL_PLANE: "close_at_reviewed_grand_hall_plane",
  EXCLUDE_BEYOND_INTERFACE: "exclude_beyond_interface",
  NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT: "not_a_portal_source_topology_artifact",
} as const;

const BOUNDARY_OPERATION = {
  CLOSE_AT_REVIEWED_GRAND_HALL_PLANE: "retain_grand_hall_side",
  EXCLUDE_BEYOND_INTERFACE: "exclude_beyond_interface",
  NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT: "remove_non_architectural_capture_artifact",
} as const;

type AcceptedT554Reviewer = NonNullable<GrandHallT554HumanDecisions["reviewer"]>;

interface AcceptedT554Reviewers {
  readonly decisions: AcceptedT554Reviewer;
  readonly volume: AcceptedT554Reviewer;
}

function requireAcceptedT554Reviewers(
  decisions: GrandHallT554HumanDecisions,
  volume: GrandHallT554ClosedVolumeReview,
): AcceptedT554Reviewers {
  if (
    decisions.reviewState !== "human_accepted" ||
    decisions.finalDecision !== "ACCEPT" ||
    decisions.reviewer === null
  ) {
    throw new GrandHallT554AcceptanceError(
      "DECISIONS_INVALID",
      "Human decisions must be explicitly accepted by an authorized human reviewer.",
    );
  }
  if (
    volume.reviewState !== "human_accepted" ||
    volume.finalDecision !== "ACCEPT" ||
    volume.reviewer === null ||
    volume.zMin === null ||
    volume.zMax === null
  ) {
    throw new GrandHallT554AcceptanceError(
      "VOLUME_INVALID",
      "The invisible selection volume must be explicitly accepted by an authorized human reviewer.",
    );
  }
  return { decisions: decisions.reviewer, volume: volume.reviewer };
}

function buildRoomMembershipPanoramaRecords(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  decisionsSha256: string,
) {
  return decisions.panoramaDecisions.map((decision, index) => ({
    source: reviewPack.candidatePanoramaSources[index],
    decision: decision.result === "INCLUDE"
      ? {
        disposition: "include_with_binary_pixel_mask" as const,
        classification: decision.classification,
        maskRequired: true as const,
        generatedFillPermitted: false as const,
      }
      : {
        disposition: "exclude_whole_frame" as const,
        classification: "adjacent_room_or_outside_grand_hall" as const,
        maskRequired: false as const,
        generatedFillPermitted: false as const,
      },
    decisionEvidenceSha256: decisionsSha256,
  }));
}

function buildAcceptedRoomMembership(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  decisionsSha256: string,
  reviewer: AcceptedT554Reviewer,
): GrandHallRoomMembershipV2 {
  const material = parseOrAcceptanceError(
    GrandHallRoomMembershipV2MaterialSchema,
    {
      schemaVersion: GRAND_HALL_ROOM_MEMBERSHIP_V2,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      authority: "human_accepted",
      productionTrust: null,
      reviewPackSha256: reviewPack.artifactSha256,
      sourceMembershipV1Sha256: reviewPack.sourceEvidence.t550PendingMembershipV1Sha256,
      sourceBoundaryEvidenceSha256: reviewPack.sourceEvidence.t551SourceEvidenceSha256,
      sourcePanoramaInventorySha256: reviewPack.panoramaSourceInventorySha256,
      geometricCameraAuthority: "none",
      matterPakRoomMembership: {
        includedRoomKeys: [GRAND_HALL_MATTERPAK_ROOM_KEY],
        neighbouringRoomGeometryIncluded: false,
        facadeGeometryIncluded: false,
      },
      panoramaRecords: buildRoomMembershipPanoramaRecords(
        reviewPack,
        decisions,
        decisionsSha256,
      ),
      acceptedUnknownPixelDisposition: "transparent_or_unknown_never_filled",
      humanReview: acceptedHumanReview(reviewer),
    },
    "DECISIONS_INVALID",
    "accepted room membership",
  );
  return parseOrAcceptanceError(
    GrandHallRoomMembershipV2Schema,
    {
      ...material,
      artifactSha256: computeGrandHallRoomMembershipV2Sha256(material),
    },
    "DECISIONS_INVALID",
    "accepted room-membership artifact",
  );
}

function buildResolvedInterfaceDecisions(
  decisions: GrandHallT554HumanDecisions,
  decisionsSha256: string,
) {
  return decisions.interfaceDecisions.map((decision) => {
    if (decision.result === "UNSURE" || decision.note === null) {
      throw new GrandHallT554AcceptanceError(
        "DECISIONS_INVALID",
        `Interface ${decision.interfaceId} remains unresolved.`,
      );
    }
    return {
      interfaceId: decision.interfaceId,
      resolution: INTERFACE_RESOLUTION[decision.result],
      grandHallSideEvidenceSha256: decisionsSha256,
      decisionNote: decision.note,
    };
  });
}

function buildAcceptedInterfaceDecisions(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  decisionsSha256: string,
  reviewer: AcceptedT554Reviewer,
): GrandHallPortalDecisionsV1 {
  const material = parseOrAcceptanceError(
    GrandHallPortalDecisionsV1MaterialSchema,
    {
      schemaVersion: GRAND_HALL_PORTAL_DECISIONS_V1,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      authority: "human_accepted",
      productionTrust: null,
      reviewPackSha256: reviewPack.artifactSha256,
      sourceBoundaryEvidenceSha256: reviewPack.sourceEvidence.t551SourceEvidenceSha256,
      interfaceInventorySha256: reviewPack.interfaceInventorySha256,
      interfaceCount: GRAND_HALL_EXACT_INTERFACE_COUNT,
      interfaceCandidates: reviewPack.interfaceCandidates,
      decisions: buildResolvedInterfaceDecisions(decisions, decisionsSha256),
      allInterfacesResolved: true,
      humanReview: acceptedHumanReview(reviewer),
    },
    "DECISIONS_INVALID",
    "accepted interface decisions",
  );
  return parseOrAcceptanceError(
    GrandHallPortalDecisionsV1Schema,
    {
      ...material,
      artifactSha256: computeGrandHallPortalDecisionsV1Sha256(material),
    },
    "DECISIONS_INVALID",
    "accepted interface-decision artifact",
  );
}

function buildBoundarySemanticRefinements(
  decisions: GrandHallT554HumanDecisions,
  decisionsSha256: string,
) {
  return decisions.interfaceDecisions.map((decision) => {
    if (decision.result === "UNSURE") {
      throw new GrandHallT554AcceptanceError(
        "DECISIONS_INVALID",
        `Interface ${decision.interfaceId} remains unresolved.`,
      );
    }
    return {
      interfaceId: decision.interfaceId,
      operation: BOUNDARY_OPERATION[decision.result],
      evidenceSha256: decisionsSha256,
      applied: true as const,
      generatedGeometryCreated: false as const,
    };
  });
}

function finalizeAcceptedClosedBoundary(
  material: z.infer<typeof GrandHallClosedBoundaryV1MaterialSchema>,
): GrandHallClosedBoundaryV1 {
  return parseOrAcceptanceError(
    GrandHallClosedBoundaryV1Schema,
    {
      ...material,
      artifactSha256: computeGrandHallClosedBoundaryV1Sha256(material),
    },
    "VOLUME_INVALID",
    "accepted closed-boundary artifact",
  );
}

function buildAcceptedClosedBoundary(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  volume: GrandHallT554ClosedVolumeReview,
  decisionsSha256: string,
  roomMembership: GrandHallRoomMembershipV2,
  interfaceDecisions: GrandHallPortalDecisionsV1,
  reviewer: AcceptedT554Reviewer,
): GrandHallClosedBoundaryV1 {
  const material = parseOrAcceptanceError(
    GrandHallClosedBoundaryV1MaterialSchema,
    {
      schemaVersion: GRAND_HALL_CLOSED_BOUNDARY_V1,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      authority: "human_accepted",
      productionTrust: null,
      reviewPackSha256: reviewPack.artifactSha256,
      roomMembershipArtifactSha256: roomMembership.artifactSha256,
      portalDecisionArtifactSha256: interfaceDecisions.artifactSha256,
      portalInterfaceInventorySha256: reviewPack.interfaceInventorySha256,
      portalInterfaceIds: reviewPack.interfaceCandidates.map((candidate) => candidate.interfaceId),
      sourceFrame: volume.sourceFrame,
      units: volume.units,
      geometryRole: volume.geometryRole,
      construction: volume.construction,
      nonConvex: true,
      footprintXY: volume.footprintXY,
      zMin: volume.zMin,
      zMax: volume.zMax,
      pointOnBoundaryPolicy: "include_as_inside",
      closedVolume: true,
      cameraMembershipOnly: false,
      rendered: false,
      collisionGeometry: false,
      exportedAsArchitecture: false,
      generatedGeometryCreated: false,
      semanticRefinements: buildBoundarySemanticRefinements(decisions, decisionsSha256),
      humanReview: acceptedHumanReview(reviewer),
    },
    "VOLUME_INVALID",
    "accepted non-rendered closed selection volume",
  );
  return finalizeAcceptedClosedBoundary(material);
}

function buildIncludedPanoramaMask(
  source: GrandHallScopeReviewPackV1["candidatePanoramaSources"][number],
  decision: GrandHallT554HumanDecisions["panoramaDecisions"][number],
  mediaEvidence: GrandHallT554AcceptanceMediaEvidence,
) {
  if (decision.result !== "INCLUDE" || decision.maskFileName === null) {
    throw new GrandHallT554AcceptanceError(
      "DECISIONS_INVALID",
      `Sweep ${String(decision.sweepNumber)} remains unresolved.`,
    );
  }
  const mask = mediaEvidence.masks.get(decision.maskFileName);
  if (mask === undefined) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      `Mask ${decision.maskFileName} is absent.`,
    );
  }
  return {
    fileName: mask.fileName,
    sha256: mask.sha256,
    byteLength: mask.byteLength,
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
    includedPixelCount: mask.includedPixelCount,
    excludedPixelCount: mask.excludedPixelCount,
    alphaChannelPresent: false as const,
    colourProfilePresent: false as const,
    exifOrientationPresent: false as const,
    resampled: false as const,
    reasonCodes: decision.maskReasonCodes,
  };
}

function buildPanoramaMaskSourceRecords(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  mediaEvidence: GrandHallT554AcceptanceMediaEvidence,
) {
  return decisions.panoramaDecisions.map((decision, index) => {
    const source = reviewPack.candidatePanoramaSources[index];
    if (source === undefined) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `Review-pack source ${String(index)} is absent.`,
      );
    }
    if (decision.result === "EXCLUDE") {
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
      mask: buildIncludedPanoramaMask(source, decision, mediaEvidence),
      wholeFrameExclusionReason: null,
    };
  });
}

function buildAcceptedPanoramaMaskSet(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  mediaEvidence: GrandHallT554AcceptanceMediaEvidence,
  roomMembership: GrandHallRoomMembershipV2,
  interfaceDecisions: GrandHallPortalDecisionsV1,
  reviewer: AcceptedT554Reviewer,
): GrandHallPanoramaMaskSetV1 {
  const material = parseOrAcceptanceError(
    GrandHallPanoramaMaskSetV1MaterialSchema,
    {
      schemaVersion: GRAND_HALL_PANORAMA_MASK_SET_V1,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      authority: "human_accepted",
      productionTrust: null,
      reviewPackSha256: reviewPack.artifactSha256,
      membershipArtifactSha256: roomMembership.artifactSha256,
      portalDecisionArtifactSha256: interfaceDecisions.artifactSha256,
      sourcePanoramaInventorySha256: reviewPack.panoramaSourceInventorySha256,
      geometricCameraAuthority: "none",
      sourceRecordCount: GRAND_HALL_REVIEW_PANORAMA_COUNT,
      maskCount: decisions.panoramaDecisions.filter((decision) => decision.result === "INCLUDE").length,
      wholeFrameExclusionCount: decisions.panoramaDecisions.filter(
        (decision) => decision.result === "EXCLUDE",
      ).length,
      sourceRecords: buildPanoramaMaskSourceRecords(reviewPack, decisions, mediaEvidence),
      unknownPixelDisposition: "transparent_or_unknown_never_filled",
      generatedFillPermitted: false,
      humanReview: acceptedHumanReview(reviewer),
    },
    "MASK_EVIDENCE_INVALID",
    "accepted panorama mask set",
  );
  return parseOrAcceptanceError(
    GrandHallPanoramaMaskSetV1Schema,
    {
      ...material,
      artifactSha256: computeGrandHallPanoramaMaskSetV1Sha256(material),
    },
    "MASK_EVIDENCE_INVALID",
    "accepted panorama-mask-set artifact",
  );
}

interface ValidatedT554AcceptedBuildInput {
  readonly reviewPack: GrandHallScopeReviewPackV1;
  readonly decisions: GrandHallT554HumanDecisions;
  readonly volume: GrandHallT554ClosedVolumeReview;
  readonly reviewers: AcceptedT554Reviewers;
  readonly decisionsSha256: string;
}

function validateT554AcceptedBuildInput(input: {
  readonly reviewPack: unknown;
  readonly decisions: unknown;
  readonly closedVolume: unknown;
  readonly mediaEvidence: GrandHallT554AcceptanceMediaEvidence;
}): ValidatedT554AcceptedBuildInput {
  const reviewPack = parseOrAcceptanceError(
    GrandHallScopeReviewPackV1Schema,
    input.reviewPack,
    "REVIEW_PACK_INVALID",
    "T-554 review pack",
  );
  const decisions = parseOrAcceptanceError(
    GrandHallT554HumanDecisionsSchema,
    input.decisions,
    "DECISIONS_INVALID",
    "human decisions",
  );
  const volume = parseOrAcceptanceError(
    GrandHallT554ClosedVolumeReviewSchema,
    input.closedVolume,
    "VOLUME_INVALID",
    "closed selection volume",
  );
  const reviewers = requireAcceptedT554Reviewers(decisions, volume);
  assertExactReviewBindings(reviewPack, decisions, volume);
  assertExactMediaEvidence(reviewPack, decisions, input.mediaEvidence);
  return {
    reviewPack,
    decisions,
    volume,
    reviewers,
    decisionsSha256: computeGrandHallT554HumanDecisionsSha256(decisions),
  };
}

export function buildGrandHallT554AcceptedScopeArtifacts(input: {
  readonly reviewPack: unknown;
  readonly decisions: unknown;
  readonly closedVolume: unknown;
  readonly mediaEvidence: GrandHallT554AcceptanceMediaEvidence;
}): GrandHallT554AcceptedScopeArtifacts {
  const validated = validateT554AcceptedBuildInput(input);
  const roomMembership = buildAcceptedRoomMembership(
    validated.reviewPack,
    validated.decisions,
    validated.decisionsSha256,
    validated.reviewers.decisions,
  );
  const interfaceDecisions = buildAcceptedInterfaceDecisions(
    validated.reviewPack,
    validated.decisions,
    validated.decisionsSha256,
    validated.reviewers.decisions,
  );
  const closedBoundary = buildAcceptedClosedBoundary(
    validated.reviewPack,
    validated.decisions,
    validated.volume,
    validated.decisionsSha256,
    roomMembership,
    interfaceDecisions,
    validated.reviewers.volume,
  );
  const panoramaMaskSet = buildAcceptedPanoramaMaskSet(
    validated.reviewPack,
    validated.decisions,
    input.mediaEvidence,
    roomMembership,
    interfaceDecisions,
    validated.reviewers.decisions,
  );
  return Object.freeze({ roomMembership, interfaceDecisions, closedBoundary, panoramaMaskSet });
}

interface FileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly mode: bigint;
  readonly linkCount: bigint;
  readonly size: bigint;
  readonly modifiedNanoseconds: bigint;
  readonly changedNanoseconds: bigint;
}

function fileIdentity(stats: BigIntStats): FileIdentity {
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    linkCount: stats.nlink,
    size: stats.size,
    modifiedNanoseconds: stats.mtimeNs,
    changedNanoseconds: stats.ctimeNs,
  };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.linkCount === right.linkCount &&
    left.size === right.size &&
    left.modifiedNanoseconds === right.modifiedNanoseconds &&
    left.changedNanoseconds === right.changedNanoseconds;
}

function comparablePath(value: string): string {
  const normalized = resolve(value).replace(/^\\\\\?\\/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathWithin(root: string, candidate: string): boolean {
  const relationship = relative(root, candidate);
  return relationship === "" ||
    (!relationship.startsWith(`..${sep}`) && relationship !== ".." && !isAbsolute(relationship));
}

async function requireDirectDirectory(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new GrandHallT554AcceptanceError("PATH_UNSAFE", `${label} must be absolute.`);
  }
  const logical = resolve(path);
  let statsValue: BigIntStats;
  let canonical: string;
  try {
    statsValue = await lstat(logical, { bigint: true });
    canonical = await realpath(logical);
  } catch (error) {
    throw new GrandHallT554AcceptanceError("PATH_UNSAFE", `${label} is unavailable.`, error);
  }
  if (
    statsValue.isSymbolicLink() ||
    !statsValue.isDirectory() ||
    comparablePath(canonical) !== comparablePath(logical)
  ) {
    throw new GrandHallT554AcceptanceError(
      "PATH_UNSAFE",
      `${label} must be one direct non-link directory.`,
    );
  }
  return logical;
}

interface ExpectedDirectFileIdentity {
  readonly byteLength: number;
  readonly sha256: string;
}

interface DirectFileWitness {
  readonly logical: string;
  readonly canonical: string;
  readonly before: FileIdentity;
  readonly byteLength: number;
}

async function captureDirectFileWitness(
  path: string,
  maximumByteLength: number,
  label: string,
  expected?: ExpectedDirectFileIdentity,
): Promise<DirectFileWitness> {
  if (!isAbsolute(path)) {
    throw new GrandHallT554AcceptanceError("PATH_UNSAFE", `${label} path must be absolute.`);
  }
  const logical = resolve(path);
  let stats: BigIntStats;
  let canonical: string;
  try {
    stats = await lstat(logical, { bigint: true });
    canonical = await realpath(logical);
  } catch (error) {
    throw new GrandHallT554AcceptanceError("FILE_INVALID", `${label} is unavailable.`, error);
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1n ||
    comparablePath(canonical) !== comparablePath(logical)) {
    throw new GrandHallT554AcceptanceError(
      "PATH_UNSAFE",
      `${label} must be one direct non-linked regular file.`,
    );
  }
  const before = fileIdentity(stats);
  const byteLength = Number(before.size);
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 ||
    byteLength > maximumByteLength || expected?.byteLength !== undefined &&
    byteLength !== expected.byteLength) {
    throw new GrandHallT554AcceptanceError(
      "FILE_INVALID",
      `${label} byte length is outside its exact bounded contract.`,
    );
  }
  return { logical, canonical, before, byteLength };
}

async function assertDirectFileStableAfterRead(
  witness: DirectFileWitness,
  opened: FileIdentity,
  after: FileIdentity,
  bytes: Buffer,
  label: string,
): Promise<void> {
  const finalStats = await lstat(witness.logical, { bigint: true });
  const finalIdentity = fileIdentity(finalStats);
  if (
    bytes.byteLength !== witness.byteLength ||
    !sameFileIdentity(opened, after) ||
    !sameFileIdentity(after, finalIdentity) ||
    finalStats.isSymbolicLink() ||
    finalStats.nlink !== 1n ||
    comparablePath(await realpath(witness.logical)) !== comparablePath(witness.canonical)
  ) {
    throw new GrandHallT554AcceptanceError("FILE_INVALID", `${label} changed during read.`);
  }
}

async function readStableDirectFile(
  path: string,
  maximumByteLength: number,
  label: string,
  expected?: ExpectedDirectFileIdentity,
): Promise<{ readonly bytes: Buffer; readonly byteLength: number; readonly sha256: `sha256:${string}` }> {
  const witness = await captureDirectFileWitness(path, maximumByteLength, label, expected);
  const handle = await open(witness.canonical, "r");
  try {
    const opened = fileIdentity(await handle.stat({ bigint: true }));
    if (!sameFileIdentity(witness.before, opened)) {
      throw new GrandHallT554AcceptanceError("FILE_INVALID", `${label} changed before read.`);
    }
    const bytes = await handle.readFile();
    const after = fileIdentity(await handle.stat({ bigint: true }));
    await assertDirectFileStableAfterRead(witness, opened, after, bytes, label);
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
    if (expected !== undefined && sha256 !== expected.sha256) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `${label} SHA-256 differs from its immutable review identity.`,
      );
    }
    return { bytes, byteLength: witness.byteLength, sha256 };
  } finally {
    await handle.close();
  }
}

async function readStrictJson(path: string, label: string): Promise<unknown> {
  const file = await readStableDirectFile(path, MAX_JSON_BYTES, label);
  try {
    return parseGrandHallT554StrictJson(file.bytes);
  } catch (error) {
    throw new GrandHallT554AcceptanceError(
      "FILE_INVALID",
      `${label} must be strict UTF-8 JSON without a BOM.`,
      error,
    );
  }
}

async function loadVerifiedReviewPackDefault(
  reviewPackDirectory: string,
): Promise<GrandHallScopeReviewPackV1> {
  const verified = await verifyPersistedGrandHallT554RootReviewPack(reviewPackDirectory);
  const document = await readStrictJson(
    resolve(reviewPackDirectory, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME),
    "T-554 root review descriptor",
  );
  const reviewPack = parseOrAcceptanceError(
    GrandHallScopeReviewPackV1Schema,
    document,
    "REVIEW_PACK_INVALID",
    "T-554 root review descriptor",
  );
  if (reviewPack.artifactSha256 !== verified.artifactSha256) {
    throw new GrandHallT554AcceptanceError(
      "REVIEW_PACK_INVALID",
      "The review descriptor changed after exact regeneration verification.",
    );
  }
  return reviewPack;
}

async function inspectPanoramaSourcesDefault(
  panoramaSourceRoot: string,
  reviewPack: GrandHallScopeReviewPackV1,
): Promise<ReadonlyMap<string, GrandHallT554PanoramaSourceEvidence>> {
  const root = await requireDirectDirectory(panoramaSourceRoot, "panoramaSourceRoot");
  const evidence = new Map<string, GrandHallT554PanoramaSourceEvidence>();
  for (const source of reviewPack.panoramaDirectoryFiles) {
    if (!isSafeGrandHallT554RelativePath(source.fileName)) {
      throw new GrandHallT554AcceptanceError(
        "PATH_UNSAFE",
        `Review source ${source.fileName} is not a safe relative file.`,
      );
    }
    const path = resolve(root, ...source.fileName.split("/"));
    if (!pathWithin(root, path)) {
      throw new GrandHallT554AcceptanceError("PATH_UNSAFE", "A source JPEG escaped its root.");
    }
    const file = await readStableDirectFile(
      path,
      GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
      `source panorama ${source.fileName}`,
      { byteLength: source.byteLength, sha256: source.sha256 },
    );
    try {
      await validateGrandHallT554SourceJpegBytes(file.bytes);
    } catch (error) {
      throw new GrandHallT554AcceptanceError(
        "FILE_INVALID",
        `Source panorama ${source.fileName} failed exact 8,192 x 4,096 RGB decode.`,
        error,
      );
    }
    evidence.set(source.fileName, Object.freeze({
      fileName: source.fileName,
      sha256: file.sha256,
      byteLength: file.byteLength,
      exactSourceGridDecoded: true,
    }));
  }
  return evidence;
}

async function inventoryDirectFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory === ""
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      if (!isSafeGrandHallT554RelativePath(relativePath)) {
        throw new GrandHallT554AcceptanceError(
          "PATH_UNSAFE",
          `maskRoot contains unsafe entry ${relativePath}.`,
        );
      }
      const absolutePath = resolve(absoluteDirectory, entry.name);
      const entryStats = await lstat(absolutePath, { bigint: true });
      if (entry.isSymbolicLink() || entryStats.isSymbolicLink()) {
        throw new GrandHallT554AcceptanceError(
          "PATH_UNSAFE",
          `maskRoot contains linked entry ${relativePath}.`,
        );
      }
      if (entry.isDirectory() && entryStats.isDirectory()) {
        if (comparablePath(await realpath(absolutePath)) !== comparablePath(absolutePath)) {
          throw new GrandHallT554AcceptanceError(
            "PATH_UNSAFE",
            `maskRoot directory ${relativePath} resolves through an alias.`,
          );
        }
        await visit(absolutePath, relativePath);
      } else if (entry.isFile() && entryStats.isFile() && entryStats.nlink === 1n) {
        files.push(relativePath);
      } else {
        throw new GrandHallT554AcceptanceError(
          "PATH_UNSAFE",
          `maskRoot entry ${relativePath} is not a direct single-link file or directory.`,
        );
      }
    }
  };
  await visit(root, "");
  return files.sort((left, right) => left.localeCompare(right));
}

function expectedPanoramaMaskFileNames(
  decisions: GrandHallT554HumanDecisions,
): readonly string[] {
  const expected = decisions.panoramaDecisions.flatMap((decision) =>
    decision.result === "INCLUDE" && decision.maskFileName !== null
      ? [decision.maskFileName]
      : [],
  ).sort((left, right) => left.localeCompare(right));
  if (new Set(expected).size !== expected.length) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      "Included panoramas contain duplicate mask filenames.",
    );
  }
  return expected;
}

async function inspectExactPanoramaMask(
  root: string,
  fileName: string,
): Promise<GrandHallT554PanoramaMaskEvidence> {
  if (!isSafeGrandHallT554RelativePath(fileName)) {
    throw new GrandHallT554AcceptanceError("PATH_UNSAFE", `Mask ${fileName} has an unsafe path.`);
  }
  const path = resolve(root, ...fileName.split("/"));
  if (!pathWithin(root, path)) {
    throw new GrandHallT554AcceptanceError("PATH_UNSAFE", `Mask ${fileName} escaped maskRoot.`);
  }
  const file = await readStableDirectFile(
    path,
    GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
    `panorama mask ${fileName}`,
  );
  let counts: Awaited<ReturnType<typeof validateGrandHallT554MaskPngBytes>>;
  try {
    counts = await validateGrandHallT554MaskPngBytes(file.bytes);
  } catch (error) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      `Mask ${fileName} failed exact grayscale8 binary source-grid decode.`,
      error,
    );
  }
  return Object.freeze({
    fileName,
    sha256: file.sha256,
    byteLength: file.byteLength,
    includedPixelCount: counts.includedPixelCount,
    excludedPixelCount: counts.excludedPixelCount,
    exactBinarySourceGridDecoded: true,
  });
}

async function requireExactMaskInventory(
  root: string,
  expected: readonly string[],
): Promise<readonly string[]> {
  const inventoryBefore = await inventoryDirectFiles(root);
  if (stableCanonicalJson(inventoryBefore as never) !== stableCanonicalJson(expected as never)) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      "maskRoot must contain exactly the reviewed mask files and no unbound files.",
    );
  }
  return inventoryBefore;
}

async function assertMaskInventoryUnchanged(
  root: string,
  inventoryBefore: readonly string[],
): Promise<void> {
  const inventoryAfter = await inventoryDirectFiles(root);
  if (stableCanonicalJson(inventoryAfter as never) !== stableCanonicalJson(inventoryBefore as never)) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      "maskRoot changed during exact mask verification.",
    );
  }
}

async function inspectPanoramaMasksDefault(
  maskRoot: string,
  decisions: GrandHallT554HumanDecisions,
): Promise<ReadonlyMap<string, GrandHallT554PanoramaMaskEvidence>> {
  const root = await requireDirectDirectory(maskRoot, "maskRoot");
  const expected = expectedPanoramaMaskFileNames(decisions);
  const inventoryBefore = await requireExactMaskInventory(root, expected);
  const evidence = new Map<string, GrandHallT554PanoramaMaskEvidence>();
  for (const fileName of expected) {
    evidence.set(fileName, await inspectExactPanoramaMask(root, fileName));
  }
  await assertMaskInventoryUnchanged(root, inventoryBefore);
  return evidence;
}

interface PublicationPayload {
  readonly fileName: string;
  readonly bytes: Buffer;
}

interface PublicationFileReceipt {
  readonly fileName: string;
  readonly sha256: `sha256:${string}`;
  readonly byteLength: number;
}

function publicationReceipt(payload: PublicationPayload): PublicationFileReceipt {
  return {
    fileName: payload.fileName,
    sha256: `sha256:${createHash("sha256").update(payload.bytes).digest("hex")}`,
    byteLength: payload.bytes.byteLength,
  };
}

interface PublicationDirectoryIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly mode: bigint;
}

interface PublicationDirectoryWitness {
  readonly logicalPath: string;
  readonly canonicalPath: string;
  readonly identity: PublicationDirectoryIdentity;
}

interface PublicationContext {
  readonly parent: PublicationDirectoryWitness;
  readonly output: PublicationDirectoryWitness;
  readonly directories: Map<string, PublicationDirectoryWitness>;
}

interface PublicationInventory {
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

function publicationDirectoryIdentity(stats: BigIntStats): PublicationDirectoryIdentity {
  return { device: stats.dev, inode: stats.ino, mode: stats.mode };
}

function samePublicationDirectoryIdentity(
  left: PublicationDirectoryIdentity,
  right: PublicationDirectoryIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode && left.mode === right.mode;
}

async function capturePublicationDirectory(
  path: string,
  label: string,
): Promise<PublicationDirectoryWitness> {
  const logicalPath = resolve(path);
  let stats: BigIntStats;
  let canonicalPath: string;
  try {
    stats = await lstat(logicalPath, { bigint: true });
    canonicalPath = await realpath(logicalPath);
  } catch (error) {
    throw new GrandHallT554AcceptanceError("PATH_UNSAFE", `${label} is unavailable.`, error);
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    comparablePath(canonicalPath) !== comparablePath(logicalPath)
  ) {
    throw new GrandHallT554AcceptanceError(
      "PATH_UNSAFE",
      `${label} must be one direct non-link directory.`,
    );
  }
  return { logicalPath, canonicalPath, identity: publicationDirectoryIdentity(stats) };
}

async function assertPublicationDirectoryStable(
  witness: PublicationDirectoryWitness,
  label: string,
): Promise<void> {
  let stats: BigIntStats;
  let canonicalPath: string;
  try {
    stats = await lstat(witness.logicalPath, { bigint: true });
    canonicalPath = await realpath(witness.logicalPath);
  } catch (error) {
    throw new GrandHallT554AcceptanceError(
      "OUTPUT_PUBLISH_FAILED",
      `${label} disappeared during publication.`,
      error,
    );
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    !samePublicationDirectoryIdentity(witness.identity, publicationDirectoryIdentity(stats)) ||
    comparablePath(canonicalPath) !== comparablePath(witness.canonicalPath)
  ) {
    throw new GrandHallT554AcceptanceError(
      "OUTPUT_PUBLISH_FAILED",
      `${label} was replaced or redirected during publication.`,
    );
  }
}

async function reservePublicationContext(outputDirectory: string): Promise<PublicationContext> {
  if (!isAbsolute(outputDirectory)) {
    throw new GrandHallT554AcceptanceError("PATH_UNSAFE", "outputDirectory must be absolute.");
  }
  const output = resolve(outputDirectory);
  const parent = await capturePublicationDirectory(dirname(output), "outputDirectory parent");
  try {
    await mkdir(output, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new GrandHallT554AcceptanceError(
        "OUTPUT_EXISTS",
        "The output directory already exists; evidence publication never overwrites.",
        error,
      );
    }
    throw new GrandHallT554AcceptanceError(
      "OUTPUT_PUBLISH_FAILED",
      "Could not reserve the new no-replace output directory.",
      error,
    );
  }
  const context = {
    parent,
    output: await capturePublicationDirectory(output, "reserved outputDirectory"),
    directories: new Map<string, PublicationDirectoryWitness>(),
  };
  await assertPublicationDirectoryStable(parent, "outputDirectory parent");
  return context;
}

async function assertPublicationContextStable(context: PublicationContext): Promise<void> {
  await assertPublicationDirectoryStable(context.parent, "outputDirectory parent");
  await assertPublicationDirectoryStable(context.output, "reserved outputDirectory");
  for (const witness of context.directories.values()) {
    await assertPublicationDirectoryStable(witness, "publication subdirectory");
  }
}

async function ensurePublicationParentDirectories(
  context: PublicationContext,
  fileName: string,
): Promise<void> {
  const segments = fileName.split("/").slice(0, -1);
  let currentPath = context.output.logicalPath;
  for (const segment of segments) {
    currentPath = resolve(currentPath, segment);
    const key = comparablePath(currentPath);
    if (context.directories.has(key)) continue;
    await assertPublicationContextStable(context);
    try {
      await mkdir(currentPath, { recursive: false });
    } catch (error) {
      throw new GrandHallT554AcceptanceError(
        "OUTPUT_PUBLISH_FAILED",
        `Publication subdirectory ${segment} was pre-created or could not be reserved.`,
        error,
      );
    }
    const witness = await capturePublicationDirectory(currentPath, "publication subdirectory");
    if (!pathWithin(context.output.canonicalPath, witness.canonicalPath)) {
      throw new GrandHallT554AcceptanceError(
        "PATH_UNSAFE",
        "A publication subdirectory escaped the reserved output root.",
      );
    }
    context.directories.set(key, witness);
  }
}

function assertPublicationPaths(payloads: readonly PublicationPayload[]): void {
  const names = payloads.map((payload) => payload.fileName);
  if (
    names.some((name) => !isSafeGrandHallT554RelativePath(name)) ||
    new Set(names).size !== names.length ||
    names.includes(PUBLICATION_RECEIPT_FILE_NAME) ||
    names.includes(STAGED_PUBLICATION_RECEIPT_FILE_NAME)
  ) {
    throw new GrandHallT554AcceptanceError(
      "PATH_UNSAFE",
      "Publication filenames must be unique safe relative paths and cannot replace the receipt.",
    );
  }
  const ordered = [...names].sort((left, right) => left.localeCompare(right));
  ordered.forEach((name, index) => {
    const next = ordered[index + 1];
    if (next !== undefined && next.startsWith(`${name}/`)) {
      throw new GrandHallT554AcceptanceError(
        "PATH_UNSAFE",
        `Publication file ${name} conflicts with nested file ${next}.`,
      );
    }
  });
}

async function writePublicationFile(
  context: PublicationContext,
  payload: PublicationPayload,
): Promise<void> {
  const path = resolve(context.output.logicalPath, ...payload.fileName.split("/"));
  if (!pathWithin(context.output.logicalPath, path)) {
    throw new GrandHallT554AcceptanceError("PATH_UNSAFE", "A publication file escaped output.");
  }
  await ensurePublicationParentDirectories(context, payload.fileName);
  await assertPublicationContextStable(context);
  const handle = await open(path, "wx");
  let descriptorAfter: FileIdentity;
  try {
    await handle.writeFile(payload.bytes);
    await handle.sync();
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || stats.nlink !== 1n) {
      throw new GrandHallT554AcceptanceError(
        "OUTPUT_PUBLISH_FAILED",
        `Publication file ${payload.fileName} is not a direct single-link file.`,
      );
    }
    descriptorAfter = fileIdentity(stats);
  } finally {
    await handle.close();
  }
  const pathStats = await lstat(path, { bigint: true });
  if (
    pathStats.isSymbolicLink() ||
    pathStats.nlink !== 1n ||
    !sameFileIdentity(descriptorAfter, fileIdentity(pathStats)) ||
    comparablePath(await realpath(path)) !== comparablePath(path)
  ) {
    throw new GrandHallT554AcceptanceError(
      "OUTPUT_PUBLISH_FAILED",
      `Publication file ${payload.fileName} was redirected or replaced during write.`,
    );
  }
  await assertPublicationContextStable(context);
}

async function verifyPublicationPayload(
  context: PublicationContext,
  payload: PublicationPayload,
): Promise<void> {
  await assertPublicationContextStable(context);
  const expected = publicationReceipt(payload);
  const path = resolve(context.output.logicalPath, ...payload.fileName.split("/"));
  await readStableDirectFile(path, payload.bytes.byteLength, `published ${payload.fileName}`, {
    byteLength: expected.byteLength,
    sha256: expected.sha256,
  });
  await assertPublicationContextStable(context);
}

async function verifyPublicationPayloads(
  context: PublicationContext,
  payloads: readonly PublicationPayload[],
): Promise<void> {
  for (const payload of payloads) await verifyPublicationPayload(context, payload);
}

async function inventoryPublicationTree(
  context: PublicationContext,
  allowedHardLinkFiles: ReadonlySet<string> = new Set(),
): Promise<PublicationInventory> {
  const files: string[] = [];
  const directories: string[] = [];
  const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (!isSafeGrandHallT554RelativePath(relativePath)) {
        throw new GrandHallT554AcceptanceError("PATH_UNSAFE", `Unsafe output entry ${relativePath}.`);
      }
      const absolutePath = resolve(absoluteDirectory, entry.name);
      const stats = await lstat(absolutePath, { bigint: true });
      const canonicalPath = await realpath(absolutePath);
      if (stats.isSymbolicLink() || !pathWithin(context.output.canonicalPath, canonicalPath)) {
        throw new GrandHallT554AcceptanceError("PATH_UNSAFE", `Linked output entry ${relativePath}.`);
      }
      if (entry.isDirectory() && stats.isDirectory()) {
        directories.push(relativePath);
        await visit(absolutePath, relativePath);
      } else if (
        entry.isFile() &&
        stats.isFile() &&
        (stats.nlink === 1n || (stats.nlink === 2n && allowedHardLinkFiles.has(relativePath)))
      ) {
        files.push(relativePath);
      } else {
        throw new GrandHallT554AcceptanceError("PATH_UNSAFE", `Invalid output entry ${relativePath}.`);
      }
    }
  };
  await visit(context.output.logicalPath, "");
  return {
    files: files.sort((left, right) => left.localeCompare(right)),
    directories: directories.sort((left, right) => left.localeCompare(right)),
  };
}

function expectedPublicationDirectories(fileNames: readonly string[]): readonly string[] {
  const directories = new Set<string>();
  for (const fileName of fileNames) {
    const segments = fileName.split("/").slice(0, -1);
    for (let length = 1; length <= segments.length; length += 1) {
      directories.add(segments.slice(0, length).join("/"));
    }
  }
  return [...directories].sort((left, right) => left.localeCompare(right));
}

async function assertExactPublicationInventory(
  context: PublicationContext,
  expectedFileNames: readonly string[],
  allowedHardLinkFiles: ReadonlySet<string> = new Set(),
): Promise<void> {
  await assertPublicationContextStable(context);
  const actual = await inventoryPublicationTree(context, allowedHardLinkFiles);
  const expectedFiles = [...expectedFileNames].sort((left, right) => left.localeCompare(right));
  const expectedDirectories = expectedPublicationDirectories(expectedFiles);
  if (
    stableCanonicalJson(actual.files as never) !== stableCanonicalJson(expectedFiles as never) ||
    stableCanonicalJson(actual.directories as never) !==
      stableCanonicalJson(expectedDirectories as never)
  ) {
    throw new GrandHallT554AcceptanceError(
      "OUTPUT_PUBLISH_FAILED",
      "The reserved output inventory contains an uncommitted or missing entry.",
    );
  }
  await assertPublicationContextStable(context);
}

async function invalidatePublicationReceipt(context: PublicationContext): Promise<void> {
  const path = resolve(context.output.logicalPath, PUBLICATION_RECEIPT_FILE_NAME);
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const stats = await lstat(path, { bigint: true });
      if (stats.isSymbolicLink() || !stats.isFile()) throw error;
      handle = await open(path, "r+");
      await handle.truncate(0);
      await handle.sync();
    } catch (invalidationError) {
      throw new GrandHallT554AcceptanceError(
        "OUTPUT_PUBLISH_FAILED",
        "A failed publication receipt could not be made invalid.",
        new AggregateError([error, invalidationError]),
      );
    } finally {
      await handle?.close();
    }
  }
}

function buildPublicationReceiptPayload(
  material: Readonly<Record<string, unknown>>,
  receipts: readonly PublicationFileReceipt[],
): PublicationPayload {
  const bytes = Buffer.from(`${stableCanonicalJson({
    ...material,
    schemaVersion: "venviewer.grand-hall-t554-acceptance-publication.v1",
    state: "complete",
    productionTrust: null,
    runtimeAdmissionAuthorized: false,
    reconstructionAuthorized: false,
    files: receipts,
  } as never)}\n`, "utf8");
  return { fileName: PUBLICATION_RECEIPT_FILE_NAME, bytes };
}

function receiptLinkIdentityIsValid(staged: BigIntStats, published: BigIntStats): boolean {
  return !staged.isSymbolicLink() &&
    !published.isSymbolicLink() &&
    staged.isFile() &&
    published.isFile() &&
    staged.nlink === 2n &&
    published.nlink === 2n &&
    sameFileIdentity(fileIdentity(staged), fileIdentity(published));
}

async function assertPublicationReceiptLink(
  context: PublicationContext,
  receipt: PublicationPayload,
): Promise<void> {
  const stagedPath = resolve(context.output.logicalPath, STAGED_PUBLICATION_RECEIPT_FILE_NAME);
  const publishedPath = resolve(context.output.logicalPath, PUBLICATION_RECEIPT_FILE_NAME);
  await assertPublicationContextStable(context);
  const stagedStats = await lstat(stagedPath, { bigint: true });
  const publishedStats = await lstat(publishedPath, { bigint: true });
  if (
    !receiptLinkIdentityIsValid(stagedStats, publishedStats) ||
    comparablePath(await realpath(stagedPath)) !== comparablePath(stagedPath) ||
    comparablePath(await realpath(publishedPath)) !== comparablePath(publishedPath)
  ) {
    throw new GrandHallT554AcceptanceError(
      "OUTPUT_PUBLISH_FAILED",
      "The staged publication receipt was replaced or redirected before commit.",
    );
  }
  const handle = await open(publishedPath, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      !sameFileIdentity(fileIdentity(publishedStats), fileIdentity(opened)) ||
      !receiptLinkIdentityIsValid(opened, after) ||
      bytes.byteLength !== receipt.bytes.byteLength ||
      !bytes.equals(receipt.bytes)
    ) {
      throw new GrandHallT554AcceptanceError(
        "OUTPUT_PUBLISH_FAILED",
        "The staged publication receipt bytes changed before commit.",
      );
    }
  } finally {
    await handle.close();
  }
  await assertPublicationContextStable(context);
}

async function commitPublicationReceipt(
  context: PublicationContext,
  payloads: readonly PublicationPayload[],
  receipt: PublicationPayload,
): Promise<void> {
  const stagedReceipt = {
    fileName: STAGED_PUBLICATION_RECEIPT_FILE_NAME,
    bytes: receipt.bytes,
  };
  const stagedPath = resolve(context.output.logicalPath, stagedReceipt.fileName);
  const publishedPath = resolve(context.output.logicalPath, receipt.fileName);
  const receiptLinks = new Set([stagedReceipt.fileName, receipt.fileName]);
  try {
    await verifyPublicationPayloads(context, payloads);
    await assertExactPublicationInventory(context, payloads.map((payload) => payload.fileName));
    await writePublicationFile(context, stagedReceipt);
    await verifyPublicationPayload(context, stagedReceipt);
    await verifyPublicationPayloads(context, payloads);
    await assertExactPublicationInventory(
      context,
      [...payloads.map((payload) => payload.fileName), stagedReceipt.fileName],
    );
    await link(stagedPath, publishedPath);
    await assertPublicationReceiptLink(context, receipt);
    await verifyPublicationPayloads(context, payloads);
    await assertExactPublicationInventory(context, [
      ...payloads.map((payload) => payload.fileName),
      stagedReceipt.fileName,
      receipt.fileName,
    ], receiptLinks);
    await assertPublicationReceiptLink(context, receipt);
    await unlink(stagedPath);
  } catch (error) {
    await invalidatePublicationReceipt(context);
    throw error;
  }
}

function throwPublicationFailure(error: unknown, output: string): never {
  if (error instanceof GrandHallT554AcceptanceError) throw error;
  throw new GrandHallT554AcceptanceError(
    "OUTPUT_PUBLISH_FAILED",
    `T-554 publication is incomplete and grants no authority. Preserve and inspect ${output}.`,
    error,
  );
}

async function publishNoReplaceDirectory(
  outputDirectory: string,
  payloads: readonly PublicationPayload[],
  commitReceiptMaterial: Readonly<Record<string, unknown>> | null,
): Promise<readonly PublicationFileReceipt[]> {
  assertPublicationPaths(payloads);
  const orderedPayloads = [...payloads].sort((left, right) =>
    left.fileName.localeCompare(right.fileName));
  const receipts = orderedPayloads.map(publicationReceipt);
  const context = await reservePublicationContext(outputDirectory);
  try {
    for (const payload of orderedPayloads) await writePublicationFile(context, payload);
    await verifyPublicationPayloads(context, orderedPayloads);
    await assertExactPublicationInventory(
      context,
      orderedPayloads.map((payload) => payload.fileName),
    );
    if (commitReceiptMaterial !== null) {
      const receipt = buildPublicationReceiptPayload(commitReceiptMaterial, receipts);
      await commitPublicationReceipt(context, orderedPayloads, receipt);
    }
    return receipts;
  } catch (error) {
    if (commitReceiptMaterial !== null) await invalidatePublicationReceipt(context);
    return throwPublicationFailure(error, context.output.logicalPath);
  }
}

async function publishJsonDirectory(
  outputDirectory: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const payloads = Object.entries(files).map(([fileName, body]) => ({
    fileName,
    bytes: Buffer.from(body, "utf8"),
  }));
  await publishNoReplaceDirectory(outputDirectory, payloads, null);
}

function assertAcceptedArtifactDigestChain(artifacts: GrandHallT554AcceptedScopeArtifacts): void {
  const { roomMembership, interfaceDecisions, closedBoundary, panoramaMaskSet } = artifacts;
  const reviewPackDigests = new Set([
    roomMembership.reviewPackSha256,
    interfaceDecisions.reviewPackSha256,
    closedBoundary.reviewPackSha256,
    panoramaMaskSet.reviewPackSha256,
  ]);
  if (
    reviewPackDigests.size !== 1 ||
    closedBoundary.roomMembershipArtifactSha256 !== roomMembership.artifactSha256 ||
    panoramaMaskSet.membershipArtifactSha256 !== roomMembership.artifactSha256 ||
    closedBoundary.portalDecisionArtifactSha256 !== interfaceDecisions.artifactSha256 ||
    panoramaMaskSet.portalDecisionArtifactSha256 !== interfaceDecisions.artifactSha256 ||
    closedBoundary.portalInterfaceInventorySha256 !== interfaceDecisions.interfaceInventorySha256 ||
    panoramaMaskSet.sourcePanoramaInventorySha256 !==
      roomMembership.sourcePanoramaInventorySha256
  ) {
    throw new GrandHallT554AcceptanceError(
      "SOURCE_IDENTITY_DRIFT",
      "Accepted artifacts do not form one exact review-pack, membership, interface, and mask chain.",
    );
  }
}

function assertAcceptedInterfaceInventory(artifacts: GrandHallT554AcceptedScopeArtifacts): void {
  const { interfaceDecisions, closedBoundary } = artifacts;
  const expectedInterfaceIds = interfaceDecisions.interfaceCandidates.map(
    (candidate) => candidate.interfaceId,
  );
  if (
    stableCanonicalJson(closedBoundary.portalInterfaceIds as never) !==
      stableCanonicalJson(expectedInterfaceIds as never)
  ) {
    throw new GrandHallT554AcceptanceError(
      "SOURCE_IDENTITY_DRIFT",
      "Closed-boundary interface IDs differ from the accepted exact interface inventory.",
    );
  }
}

function assertAcceptedDecisionEvidence(artifacts: GrandHallT554AcceptedScopeArtifacts): void {
  const { roomMembership, interfaceDecisions, closedBoundary } = artifacts;
  const evidenceDigests = new Set([
    ...roomMembership.panoramaRecords.map((record) => record.decisionEvidenceSha256),
    ...interfaceDecisions.decisions.map((decision) => decision.grandHallSideEvidenceSha256),
    ...closedBoundary.semanticRefinements.map((refinement) => refinement.evidenceSha256),
  ]);
  if (evidenceDigests.size !== 1) {
    throw new GrandHallT554AcceptanceError(
      "SOURCE_IDENTITY_DRIFT",
      "Accepted membership, interface, and boundary records do not bind one human decision digest.",
    );
  }
}

function assertAcceptedPanoramaBindings(artifacts: GrandHallT554AcceptedScopeArtifacts): void {
  const { roomMembership, panoramaMaskSet } = artifacts;
  roomMembership.panoramaRecords.forEach((membershipRecord, index) => {
    const maskRecord = panoramaMaskSet.sourceRecords[index];
    if (
      maskRecord === undefined ||
      stableCanonicalJson(maskRecord.source as never) !==
        stableCanonicalJson(membershipRecord.source as never) ||
      maskRecord.disposition !== membershipRecord.decision.disposition
    ) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `Accepted panorama record ${String(index)} is not cross-bound.`,
      );
    }
  });
}

function assertAcceptedArtifactCrossBindings(
  artifacts: GrandHallT554AcceptedScopeArtifacts,
): void {
  assertAcceptedArtifactDigestChain(artifacts);
  assertAcceptedInterfaceInventory(artifacts);
  assertAcceptedDecisionEvidence(artifacts);
  assertAcceptedPanoramaBindings(artifacts);
}

function parseAcceptedArtifacts(
  artifacts: GrandHallT554AcceptedScopeArtifacts,
): GrandHallT554AcceptedScopeArtifacts {
  const parsed = {
    roomMembership: parseOrAcceptanceError(
      GrandHallRoomMembershipV2Schema,
      artifacts.roomMembership,
      "DECISIONS_INVALID",
      "room-membership artifact",
    ),
    interfaceDecisions: parseOrAcceptanceError(
      GrandHallPortalDecisionsV1Schema,
      artifacts.interfaceDecisions,
      "DECISIONS_INVALID",
      "interface-decision artifact",
    ),
    closedBoundary: parseOrAcceptanceError(
      GrandHallClosedBoundaryV1Schema,
      artifacts.closedBoundary,
      "VOLUME_INVALID",
      "closed-boundary artifact",
    ),
    panoramaMaskSet: parseOrAcceptanceError(
      GrandHallPanoramaMaskSetV1Schema,
      artifacts.panoramaMaskSet,
      "MASK_EVIDENCE_INVALID",
      "panorama-mask-set artifact",
    ),
  };
  assertAcceptedArtifactCrossBindings(parsed);
  return parsed;
}

function acceptedArtifactJsonPayloads(
  artifacts: GrandHallT554AcceptedScopeArtifacts,
): readonly PublicationPayload[] {
  const entries: readonly (readonly [string, unknown])[] = [
    ["closed-selection-volume.json", artifacts.closedBoundary],
    ["interface-decisions.json", artifacts.interfaceDecisions],
    ["panorama-mask-set.json", artifacts.panoramaMaskSet],
    ["room-membership.json", artifacts.roomMembership],
  ];
  return entries.map(([fileName, artifact]) => ({
    fileName,
    bytes: Buffer.from(`${stableCanonicalJson(artifact as never)}\n`, "utf8"),
  }));
}

export interface PublishGrandHallT554AcceptedScopeResult {
  readonly outputDirectory: string;
  readonly outputFileNames: typeof ACCEPTED_OUTPUT_FILE_NAMES;
  readonly publicationReceiptFileName: "publication-receipt.json";
  readonly preservedReviewFileNames: typeof PRESERVED_REVIEW_FILE_NAMES;
  readonly preservedMaskFileNames: readonly string[];
  readonly humanDecisionsSha256: string;
  readonly closedVolumeReviewSha256: string;
}

export interface PublishGrandHallT554AcceptedScopeBundleOptions {
  readonly reviewPack: GrandHallScopeReviewPackV1;
  readonly decisions: GrandHallT554HumanDecisions;
  readonly closedVolume: GrandHallT554ClosedVolumeReview;
  readonly maskRoot: string;
}

export type PublishGrandHallT554AcceptedScopeBundleResult =
  PublishGrandHallT554AcceptedScopeResult;

interface AcceptedBundleInputs {
  readonly artifacts: GrandHallT554AcceptedScopeArtifacts;
  readonly reviewPack: GrandHallScopeReviewPackV1;
  readonly decisions: GrandHallT554HumanDecisions;
  readonly volume: GrandHallT554ClosedVolumeReview;
}

function assertPublishedPanoramaDecisionMappings(
  artifacts: GrandHallT554AcceptedScopeArtifacts,
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
): void {
  decisions.panoramaDecisions.forEach((decision, index) => {
    const source = reviewPack.candidatePanoramaSources[index];
    const membership = artifacts.roomMembership.panoramaRecords[index];
    const maskRecord = artifacts.panoramaMaskSet.sourceRecords[index];
    if (
      source === undefined ||
      membership === undefined ||
      maskRecord === undefined ||
      stableCanonicalJson(membership.source as never) !== stableCanonicalJson(source as never) ||
      stableCanonicalJson(maskRecord.source as never) !== stableCanonicalJson(source as never)
    ) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `Published panorama ${String(index)} does not preserve its exact review-pack source.`,
      );
    }
    if (decision.result === "INCLUDE") {
      assertPublishedIncludedPanoramaDecision(decision, membership, maskRecord, index);
    } else if (
      membership.decision.disposition !== "exclude_whole_frame" ||
      maskRecord.disposition !== "exclude_whole_frame"
    ) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `Published panorama ${String(index)} differs from its reviewed whole-frame exclusion.`,
      );
    }
  });
}

function assertPublishedIncludedPanoramaDecision(
  decision: GrandHallT554HumanDecisions["panoramaDecisions"][number],
  membership: GrandHallRoomMembershipV2["panoramaRecords"][number],
  maskRecord: GrandHallPanoramaMaskSetV1["sourceRecords"][number],
  index: number,
): void {
  const binding = decision.reviewedMaskBinding;
  const mask = maskRecord.mask;
  if (
    binding === null ||
    decision.maskFileName === null ||
    membership.decision.disposition !== "include_with_binary_pixel_mask" ||
    membership.decision.classification !== decision.classification ||
    maskRecord.disposition !== "include_with_binary_pixel_mask" ||
    mask === null ||
    mask.fileName !== decision.maskFileName ||
    mask.sha256 !== binding.sha256 ||
    mask.byteLength !== binding.byteLength ||
    mask.includedPixelCount !== binding.includedPixelCount ||
    mask.excludedPixelCount !== binding.excludedPixelCount ||
    stableCanonicalJson(mask.reasonCodes as never) !==
      stableCanonicalJson(decision.maskReasonCodes as never)
  ) {
    throw new GrandHallT554AcceptanceError(
      "SOURCE_IDENTITY_DRIFT",
      `Published panorama ${String(index)} differs from its exact reviewed include/mask decision.`,
    );
  }
}

function assertPublishedInterfaceDecisionMappings(
  artifacts: GrandHallT554AcceptedScopeArtifacts,
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
): void {
  if (
    stableCanonicalJson(artifacts.interfaceDecisions.interfaceCandidates as never) !==
      stableCanonicalJson(reviewPack.interfaceCandidates as never)
  ) {
    throw new GrandHallT554AcceptanceError(
      "SOURCE_IDENTITY_DRIFT",
      "Published interface candidates differ from the exact review pack.",
    );
  }
  decisions.interfaceDecisions.forEach((decision, index) => {
    const accepted = artifacts.interfaceDecisions.decisions[index];
    const refinement = artifacts.closedBoundary.semanticRefinements[index];
    if (
      decision.result === "UNSURE" ||
      decision.note === null ||
      accepted?.interfaceId !== decision.interfaceId ||
      accepted.resolution !== INTERFACE_RESOLUTION[decision.result] ||
      accepted.decisionNote !== decision.note ||
      refinement?.interfaceId !== decision.interfaceId ||
      refinement.operation !== BOUNDARY_OPERATION[decision.result]
    ) {
      throw new GrandHallT554AcceptanceError(
        "SOURCE_IDENTITY_DRIFT",
        `Published interface ${decision.interfaceId} differs from its exact reviewed decision.`,
      );
    }
  });
}

function assertPublishedDecisionEvidenceBindings(
  artifacts: GrandHallT554AcceptedScopeArtifacts,
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  volume: GrandHallT554ClosedVolumeReview,
): void {
  const decisionsSha256 = computeGrandHallT554HumanDecisionsSha256(decisions);
  const decisionEvidence = new Set([
    ...artifacts.roomMembership.panoramaRecords.map((record) => record.decisionEvidenceSha256),
    ...artifacts.interfaceDecisions.decisions.map((decision) =>
      decision.grandHallSideEvidenceSha256),
    ...artifacts.closedBoundary.semanticRefinements.map((refinement) =>
      refinement.evidenceSha256),
  ]);
  if (
    decisionEvidence.size !== 1 ||
    !decisionEvidence.has(decisionsSha256) ||
    decisions.reviewPackSha256 !== reviewPack.artifactSha256 ||
    volume.reviewPackSha256 !== reviewPack.artifactSha256 ||
    artifacts.roomMembership.reviewPackSha256 !== reviewPack.artifactSha256
  ) {
    throw new GrandHallT554AcceptanceError(
      "SOURCE_IDENTITY_DRIFT",
      "Published artifacts do not bind the exact preserved review pack and human decisions.",
    );
  }
}

function assertPublishedReviewerAndVolumeBindings(
  artifacts: GrandHallT554AcceptedScopeArtifacts,
  decisions: GrandHallT554HumanDecisions,
  volume: GrandHallT554ClosedVolumeReview,
): void {
  if (decisions.reviewer === null || volume.reviewer === null) {
    throw new GrandHallT554AcceptanceError(
      "DECISIONS_INVALID",
      "Accepted review records must preserve their human reviewer identities.",
    );
  }
  const decisionReview = stableCanonicalJson(acceptedHumanReview(decisions.reviewer) as never);
  const volumeReview = stableCanonicalJson(acceptedHumanReview(volume.reviewer) as never);
  if (
    stableCanonicalJson(artifacts.roomMembership.humanReview as never) !== decisionReview ||
    stableCanonicalJson(artifacts.interfaceDecisions.humanReview as never) !== decisionReview ||
    stableCanonicalJson(artifacts.panoramaMaskSet.humanReview as never) !== decisionReview ||
    stableCanonicalJson(artifacts.closedBoundary.humanReview as never) !== volumeReview ||
    stableCanonicalJson(artifacts.closedBoundary.footprintXY as never) !==
      stableCanonicalJson(volume.footprintXY as never) ||
    artifacts.closedBoundary.zMin !== volume.zMin ||
    artifacts.closedBoundary.zMax !== volume.zMax
  ) {
    throw new GrandHallT554AcceptanceError(
      "SOURCE_IDENTITY_DRIFT",
      "Published artifacts do not carry the exact preserved human review identities and volume.",
    );
  }
}

function assertPublishedReviewBindings(
  artifacts: GrandHallT554AcceptedScopeArtifacts,
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  volume: GrandHallT554ClosedVolumeReview,
): void {
  requireAcceptedT554Reviewers(decisions, volume);
  assertExactReviewBindings(reviewPack, decisions, volume);
  assertPublishedPanoramaDecisionMappings(artifacts, reviewPack, decisions);
  assertPublishedInterfaceDecisionMappings(artifacts, reviewPack, decisions);
  assertPublishedDecisionEvidenceBindings(artifacts, reviewPack, decisions, volume);
  assertPublishedReviewerAndVolumeBindings(artifacts, decisions, volume);
}

async function exactMaskPayloads(
  maskRoot: string,
  maskSet: GrandHallPanoramaMaskSetV1,
): Promise<readonly PublicationPayload[]> {
  const root = await requireDirectDirectory(maskRoot, "maskRoot");
  const payloads: PublicationPayload[] = [];
  for (const record of maskSet.sourceRecords) {
    if (record.disposition !== "include_with_binary_pixel_mask") continue;
    const mask = record.mask;
    const path = resolve(root, ...mask.fileName.split("/"));
    if (!pathWithin(root, path)) {
      throw new GrandHallT554AcceptanceError("PATH_UNSAFE", `Mask ${mask.fileName} escaped maskRoot.`);
    }
    const file = await readStableDirectFile(
      path,
      GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
      `reviewed panorama mask ${mask.fileName}`,
      { byteLength: mask.byteLength, sha256: mask.sha256 },
    );
    let counts: Awaited<ReturnType<typeof validateGrandHallT554MaskPngBytes>>;
    try {
      counts = await validateGrandHallT554MaskPngBytes(file.bytes);
    } catch (error) {
      throw new GrandHallT554AcceptanceError(
        "MASK_EVIDENCE_INVALID",
        `Reviewed mask ${mask.fileName} failed exact grayscale8 binary source-grid decode during publication.`,
        error,
      );
    }
    if (
      counts.includedPixelCount !== mask.includedPixelCount ||
      counts.excludedPixelCount !== mask.excludedPixelCount
    ) {
      throw new GrandHallT554AcceptanceError(
        "MASK_EVIDENCE_INVALID",
        `Reviewed mask ${mask.fileName} decoded counts changed before publication.`,
      );
    }
    payloads.push({ fileName: mask.fileName, bytes: file.bytes });
  }
  return payloads;
}

function parseAcceptedBundleInputs(
  artifactsInput: GrandHallT554AcceptedScopeArtifacts,
  options: PublishGrandHallT554AcceptedScopeBundleOptions,
): AcceptedBundleInputs {
  const artifacts = parseAcceptedArtifacts(artifactsInput);
  const reviewPack = parseOrAcceptanceError(
    GrandHallScopeReviewPackV1Schema,
    options.reviewPack,
    "REVIEW_PACK_INVALID",
    "preserved review pack",
  );
  const decisions = parseOrAcceptanceError(
    GrandHallT554HumanDecisionsSchema,
    options.decisions,
    "DECISIONS_INVALID",
    "preserved human decisions",
  );
  const volume = parseOrAcceptanceError(
    GrandHallT554ClosedVolumeReviewSchema,
    options.closedVolume,
    "VOLUME_INVALID",
    "preserved closed-volume review",
  );
  assertPublishedReviewBindings(artifacts, reviewPack, decisions, volume);
  return { artifacts, reviewPack, decisions, volume };
}

function acceptedReviewPayloads(
  reviewPack: GrandHallScopeReviewPackV1,
  decisions: GrandHallT554HumanDecisions,
  volume: GrandHallT554ClosedVolumeReview,
): readonly PublicationPayload[] {
  return [
    {
      fileName: "review-pack.json",
      bytes: Buffer.from(`${stableCanonicalJson(reviewPack as never)}\n`, "utf8"),
    },
    {
      fileName: "review/human-decisions.json",
      bytes: Buffer.from(`${stableCanonicalJson(decisions as never)}\n`, "utf8"),
    },
    {
      fileName: "review/closed-selection-volume-review.json",
      bytes: Buffer.from(`${stableCanonicalJson(volume as never)}\n`, "utf8"),
    },
  ];
}

function acceptedBundleReceiptMaterial(inputs: AcceptedBundleInputs) {
  const { artifacts, reviewPack, decisions, volume } = inputs;
  return {
    authority: "human_accepted" as const,
    reviewPackSha256: reviewPack.artifactSha256,
    humanDecisionsSha256: computeGrandHallT554HumanDecisionsSha256(decisions),
    closedVolumeReviewSha256: computeGrandHallT554ClosedVolumeReviewSha256(volume),
    artifactSha256s: {
      roomMembership: artifacts.roomMembership.artifactSha256,
      interfaceDecisions: artifacts.interfaceDecisions.artifactSha256,
      closedBoundary: artifacts.closedBoundary.artifactSha256,
      panoramaMaskSet: artifacts.panoramaMaskSet.artifactSha256,
    },
  };
}

export async function publishGrandHallT554AcceptedScopeBundle(
  outputDirectory: string,
  artifactsInput: GrandHallT554AcceptedScopeArtifacts,
  options: PublishGrandHallT554AcceptedScopeBundleOptions,
): Promise<PublishGrandHallT554AcceptedScopeBundleResult> {
  const inputs = parseAcceptedBundleInputs(artifactsInput, options);
  const { artifacts, reviewPack, decisions, volume } = inputs;
  const maskPayloads = await exactMaskPayloads(options.maskRoot, artifacts.panoramaMaskSet);
  const reviewPayloads = acceptedReviewPayloads(reviewPack, decisions, volume);
  const receiptMaterial = acceptedBundleReceiptMaterial(inputs);
  await publishNoReplaceDirectory(
    outputDirectory,
    [...acceptedArtifactJsonPayloads(artifacts), ...reviewPayloads, ...maskPayloads],
    receiptMaterial,
  );
  return Object.freeze({
    outputDirectory: resolve(outputDirectory),
    outputFileNames: ACCEPTED_OUTPUT_FILE_NAMES,
    publicationReceiptFileName: "publication-receipt.json",
    preservedReviewFileNames: PRESERVED_REVIEW_FILE_NAMES,
    preservedMaskFileNames: maskPayloads.map((payload) => payload.fileName),
    humanDecisionsSha256: receiptMaterial.humanDecisionsSha256,
    closedVolumeReviewSha256: receiptMaterial.closedVolumeReviewSha256,
  });
}

export interface WriteGrandHallT554AcceptanceTemplatesOptions {
  readonly reviewPackDirectory: string;
  readonly outputDirectory: string;
}

export interface WriteGrandHallT554AcceptanceTemplatesResult {
  readonly outputDirectory: string;
  readonly reviewPackSha256: string;
  readonly outputFileNames: typeof TEMPLATE_OUTPUT_FILE_NAMES;
}

export async function writeGrandHallT554AcceptanceTemplates(
  options: WriteGrandHallT554AcceptanceTemplatesOptions,
): Promise<WriteGrandHallT554AcceptanceTemplatesResult> {
  const reviewPack = await loadVerifiedReviewPackDefault(options.reviewPackDirectory);
  const templates = buildGrandHallT554AcceptanceTemplates(reviewPack);
  assertOutputDisjoint(options.outputDirectory, [options.reviewPackDirectory]);
  await publishJsonDirectory(options.outputDirectory, {
    "closed-selection-volume.json": `${JSON.stringify(templates.closedVolume, null, 2)}\n`,
    "human-decisions.json": `${JSON.stringify(templates.humanDecisions, null, 2)}\n`,
  });
  return Object.freeze({
    outputDirectory: resolve(options.outputDirectory),
    reviewPackSha256: reviewPack.artifactSha256,
    outputFileNames: TEMPLATE_OUTPUT_FILE_NAMES,
  });
}

export interface BindGrandHallT554MaskEvidenceOptions {
  readonly decisionsPath: string;
  readonly maskRoot: string;
  readonly outputDirectory: string;
}

export interface BindGrandHallT554MaskEvidenceResult {
  readonly outputDirectory: string;
  readonly outputFileNames: typeof MASK_BINDING_OUTPUT_FILE_NAMES;
  readonly maskCount: number;
  readonly authority: "none";
  readonly reviewState: "human_pending";
  readonly finalDecision: "PENDING";
}

/**
 * Seals exact decoded mask evidence into a new pending review document.
 * This deliberately does not mark a mask as human-reviewed or issue authority.
 */
async function readPendingMaskDecisions(
  decisionsPath: string,
): Promise<GrandHallT554HumanDecisions> {
  return parseOrAcceptanceError(
    GrandHallT554HumanDecisionsSchema,
    await readStrictJson(decisionsPath, "pending T-554 human decisions"),
    "DECISIONS_INVALID",
    "pending T-554 human decisions",
  );
}

function assertPendingMaskBindingState(decisions: GrandHallT554HumanDecisions): void {
  if (
    decisions.reviewState !== "human_pending" ||
    decisions.finalDecision !== "PENDING" ||
    decisions.reviewer !== null
  ) {
    throw new GrandHallT554AcceptanceError(
      "DECISIONS_INVALID",
      "Mask evidence can be prepared only for a human-pending decision document.",
    );
  }
  const includedCount = decisions.panoramaDecisions.filter(
    (decision) => decision.result === "INCLUDE",
  ).length;
  if (includedCount === 0) {
    throw new GrandHallT554AcceptanceError(
      "DECISIONS_INVALID",
      "Resolve at least one panorama as INCLUDE before binding mask evidence.",
    );
  }
}

function bindMaskToPanoramaDecision(
  decision: GrandHallT554HumanDecisions["panoramaDecisions"][number],
  masks: ReadonlyMap<string, GrandHallT554PanoramaMaskEvidence>,
) {
  if (decision.result !== "INCLUDE" || decision.maskFileName === null) return decision;
  const mask = masks.get(decision.maskFileName);
  if (mask === undefined) {
    throw new GrandHallT554AcceptanceError(
      "MASK_EVIDENCE_INVALID",
      `No exact decoded mask evidence exists for ${decision.maskFileName}.`,
    );
  }
  return {
    ...decision,
    reviewedMaskBinding: {
      sha256: mask.sha256,
      byteLength: mask.byteLength,
      includedPixelCount: mask.includedPixelCount,
      excludedPixelCount: mask.excludedPixelCount,
    },
    maskReviewed: false,
  };
}

function buildMaskBoundPendingDecisions(
  decisions: GrandHallT554HumanDecisions,
  masks: ReadonlyMap<string, GrandHallT554PanoramaMaskEvidence>,
): GrandHallT554HumanDecisions {
  return parseOrAcceptanceError(
    GrandHallT554HumanDecisionsSchema,
    {
      ...decisions,
      panoramaDecisions: decisions.panoramaDecisions.map((decision) =>
        bindMaskToPanoramaDecision(decision, masks)
      ),
    },
    "DECISIONS_INVALID",
    "mask-bound pending T-554 human decisions",
  );
}

export async function bindGrandHallT554PendingMaskEvidence(
  options: BindGrandHallT554MaskEvidenceOptions,
): Promise<BindGrandHallT554MaskEvidenceResult> {
  assertOutputDisjoint(options.outputDirectory, [options.decisionsPath, options.maskRoot]);
  const decisions = await readPendingMaskDecisions(options.decisionsPath);
  assertPendingMaskBindingState(decisions);
  const masks = await inspectPanoramaMasksDefault(options.maskRoot, decisions);
  const boundDecisions = buildMaskBoundPendingDecisions(decisions, masks);
  await publishJsonDirectory(options.outputDirectory, {
    "human-decisions.json": `${JSON.stringify(boundDecisions, null, 2)}\n`,
  });
  return Object.freeze({
    outputDirectory: resolve(options.outputDirectory),
    outputFileNames: MASK_BINDING_OUTPUT_FILE_NAMES,
    maskCount: masks.size,
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
  });
}

export interface AcceptGrandHallT554ScopeOptions {
  readonly reviewPackDirectory: string;
  readonly panoramaSourceRoot: string;
  readonly decisionsPath: string;
  readonly closedVolumePath: string;
  readonly maskRoot: string;
  readonly outputDirectory: string;
}

export interface AcceptGrandHallT554ScopeResult extends PublishGrandHallT554AcceptedScopeResult {
  readonly authority: "human_accepted";
  readonly productionTrust: null;
  readonly runtimeAdmissionAuthorized: false;
  readonly reconstructionAuthorized: false;
  readonly reviewPackSha256: string;
  readonly humanDecisionsSha256: string;
  readonly closedVolumeReviewSha256: string;
  readonly roomMembershipSha256: string;
  readonly interfaceDecisionsSha256: string;
  readonly closedBoundarySha256: string;
  readonly panoramaMaskSetSha256: string;
  readonly panoramaSourceCount: number;
  readonly candidatePanoramaSourceCount: number;
  readonly panoramaMaskCount: number;
  readonly interfaceDecisionCount: number;
}

export interface GrandHallT554AcceptanceDependencies {
  readonly loadVerifiedReviewPack: (
    reviewPackDirectory: string,
  ) => Promise<GrandHallScopeReviewPackV1>;
  readonly readHumanDecisions: (path: string) => Promise<GrandHallT554HumanDecisions>;
  readonly readClosedVolumeReview: (path: string) => Promise<GrandHallT554ClosedVolumeReview>;
  readonly inspectPanoramaSources: (
    panoramaSourceRoot: string,
    reviewPack: GrandHallScopeReviewPackV1,
  ) => Promise<ReadonlyMap<string, GrandHallT554PanoramaSourceEvidence>>;
  readonly inspectPanoramaMasks: (
    maskRoot: string,
    decisions: GrandHallT554HumanDecisions,
  ) => Promise<ReadonlyMap<string, GrandHallT554PanoramaMaskEvidence>>;
  readonly publish: (
    outputDirectory: string,
    artifacts: GrandHallT554AcceptedScopeArtifacts,
    options: PublishGrandHallT554AcceptedScopeBundleOptions,
  ) => Promise<PublishGrandHallT554AcceptedScopeBundleResult>;
}

function assertOutputDisjoint(outputDirectory: string, inputPaths: readonly string[]): void {
  if (!isAbsolute(outputDirectory) || inputPaths.some((path) => !isAbsolute(path))) {
    throw new GrandHallT554AcceptanceError(
      "PATH_UNSAFE",
      "All evidence and output paths must be absolute.",
    );
  }
  const output = comparablePath(outputDirectory);
  for (const inputPath of inputPaths) {
    const input = comparablePath(inputPath);
    if (pathWithin(input, output) || pathWithin(output, input)) {
      throw new GrandHallT554AcceptanceError(
        "PATH_UNSAFE",
        "The immutable output directory must be disjoint from every input path and root.",
      );
    }
  }
}

const DEFAULT_ACCEPTANCE_DEPENDENCIES: GrandHallT554AcceptanceDependencies = {
  loadVerifiedReviewPack: loadVerifiedReviewPackDefault,
  readHumanDecisions: async (path) => parseOrAcceptanceError(
    GrandHallT554HumanDecisionsSchema,
    await readStrictJson(path, "T-554 human decisions"),
    "DECISIONS_INVALID",
    "T-554 human decisions",
  ),
  readClosedVolumeReview: async (path) => parseOrAcceptanceError(
    GrandHallT554ClosedVolumeReviewSchema,
    await readStrictJson(path, "T-554 closed-volume review"),
    "VOLUME_INVALID",
    "T-554 closed-volume review",
  ),
  inspectPanoramaSources: inspectPanoramaSourcesDefault,
  inspectPanoramaMasks: inspectPanoramaMasksDefault,
  publish: publishGrandHallT554AcceptedScopeBundle,
};

interface LoadedT554AcceptanceEvidence {
  readonly reviewPack: GrandHallScopeReviewPackV1;
  readonly decisions: GrandHallT554HumanDecisions;
  readonly closedVolume: GrandHallT554ClosedVolumeReview;
  readonly sourceJpegs: ReadonlyMap<string, GrandHallT554PanoramaSourceEvidence>;
  readonly masks: ReadonlyMap<string, GrandHallT554PanoramaMaskEvidence>;
}

function assertDefaultAcceptancePaths(options: AcceptGrandHallT554ScopeOptions): void {
  assertOutputDisjoint(options.outputDirectory, [
    options.reviewPackDirectory,
    options.panoramaSourceRoot,
    options.decisionsPath,
    options.closedVolumePath,
    options.maskRoot,
  ]);
}

function assertReviewPackRemainedStable(
  initial: GrandHallScopeReviewPackV1,
  final: GrandHallScopeReviewPackV1,
): void {
  if (stableCanonicalJson(final as never) !== stableCanonicalJson(initial as never)) {
    throw new GrandHallT554AcceptanceError(
      "REVIEW_PACK_INVALID",
      "The exact T-554 review pack changed during source and mask verification.",
    );
  }
}

async function loadT554AcceptanceEvidence(
  options: AcceptGrandHallT554ScopeOptions,
  dependencies: GrandHallT554AcceptanceDependencies,
): Promise<LoadedT554AcceptanceEvidence> {
  const initialReviewPack = await dependencies.loadVerifiedReviewPack(options.reviewPackDirectory);
  const decisions = await dependencies.readHumanDecisions(options.decisionsPath);
  const closedVolume = await dependencies.readClosedVolumeReview(options.closedVolumePath);
  const sourceJpegs = await dependencies.inspectPanoramaSources(
    options.panoramaSourceRoot,
    initialReviewPack,
  );
  const masks = await dependencies.inspectPanoramaMasks(options.maskRoot, decisions);
  const reviewPack = await dependencies.loadVerifiedReviewPack(options.reviewPackDirectory);
  assertReviewPackRemainedStable(initialReviewPack, reviewPack);
  return { reviewPack, decisions, closedVolume, sourceJpegs, masks };
}

function exactPublicationStringList(
  actual: unknown,
  expected: readonly string[],
): boolean {
  return Array.isArray(actual) &&
    actual.every((value) => typeof value === "string") &&
    stableCanonicalJson(actual as never) === stableCanonicalJson(expected as never);
}

function expectedPublishedMaskFileNames(
  artifacts: GrandHallT554AcceptedScopeArtifacts,
): readonly string[] {
  return artifacts.panoramaMaskSet.sourceRecords.flatMap((record) =>
    record.disposition === "include_with_binary_pixel_mask" ? [record.mask.fileName] : []
  );
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCompletePublishedScopeResult(
  published: unknown,
  requestedOutputDirectory: string,
  evidence: LoadedT554AcceptanceEvidence,
  artifacts: GrandHallT554AcceptedScopeArtifacts,
): asserts published is PublishGrandHallT554AcceptedScopeResult {
  const expectedDecisionsSha256 = computeGrandHallT554HumanDecisionsSha256(evidence.decisions);
  const expectedVolumeSha256 = computeGrandHallT554ClosedVolumeReviewSha256(evidence.closedVolume);
  const complete = isUnknownRecord(published) &&
    typeof published.outputDirectory === "string" &&
    comparablePath(published.outputDirectory) === comparablePath(requestedOutputDirectory) &&
    published.publicationReceiptFileName === PUBLICATION_RECEIPT_FILE_NAME &&
    exactPublicationStringList(published.outputFileNames, ACCEPTED_OUTPUT_FILE_NAMES) &&
    exactPublicationStringList(published.preservedReviewFileNames, PRESERVED_REVIEW_FILE_NAMES) &&
    exactPublicationStringList(
      published.preservedMaskFileNames,
      expectedPublishedMaskFileNames(artifacts),
    ) &&
    published.humanDecisionsSha256 === expectedDecisionsSha256 &&
    published.closedVolumeReviewSha256 === expectedVolumeSha256;
  if (!complete) {
    throw new GrandHallT554AcceptanceError(
      "OUTPUT_PUBLISH_FAILED",
      "Acceptance publisher did not return one complete receipt-bound preserved evidence bundle.",
    );
  }
}

function acceptedScopeResult(
  published: PublishGrandHallT554AcceptedScopeResult,
  evidence: LoadedT554AcceptanceEvidence,
  artifacts: GrandHallT554AcceptedScopeArtifacts,
): AcceptGrandHallT554ScopeResult {
  return Object.freeze({
    ...published,
    authority: "human_accepted",
    productionTrust: null,
    runtimeAdmissionAuthorized: false,
    reconstructionAuthorized: false,
    reviewPackSha256: evidence.reviewPack.artifactSha256,
    humanDecisionsSha256: computeGrandHallT554HumanDecisionsSha256(evidence.decisions),
    closedVolumeReviewSha256: computeGrandHallT554ClosedVolumeReviewSha256(evidence.closedVolume),
    roomMembershipSha256: artifacts.roomMembership.artifactSha256,
    interfaceDecisionsSha256: artifacts.interfaceDecisions.artifactSha256,
    closedBoundarySha256: artifacts.closedBoundary.artifactSha256,
    panoramaMaskSetSha256: artifacts.panoramaMaskSet.artifactSha256,
    panoramaSourceCount: evidence.reviewPack.panoramaDirectoryFiles.length,
    candidatePanoramaSourceCount: artifacts.roomMembership.panoramaRecords.length,
    panoramaMaskCount: artifacts.panoramaMaskSet.maskCount,
    interfaceDecisionCount: artifacts.interfaceDecisions.interfaceCount,
  });
}

export async function acceptGrandHallT554Scope(
  options: AcceptGrandHallT554ScopeOptions,
  dependencies?: GrandHallT554AcceptanceDependencies,
): Promise<AcceptGrandHallT554ScopeResult> {
  const deps = dependencies ?? DEFAULT_ACCEPTANCE_DEPENDENCIES;
  if (dependencies === undefined) assertDefaultAcceptancePaths(options);
  const evidence = await loadT554AcceptanceEvidence(options, deps);
  const artifacts = buildGrandHallT554AcceptedScopeArtifacts({
    reviewPack: evidence.reviewPack,
    decisions: evidence.decisions,
    closedVolume: evidence.closedVolume,
    mediaEvidence: { sourceJpegs: evidence.sourceJpegs, masks: evidence.masks },
  });
  const published = await deps.publish(options.outputDirectory, artifacts, {
    reviewPack: evidence.reviewPack,
    decisions: evidence.decisions,
    closedVolume: evidence.closedVolume,
    maskRoot: options.maskRoot,
  });
  assertCompletePublishedScopeResult(published, options.outputDirectory, evidence, artifacts);
  return acceptedScopeResult(published, evidence, artifacts);
}

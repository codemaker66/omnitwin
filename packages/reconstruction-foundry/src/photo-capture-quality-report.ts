import { FoundryRelativePathSchema, FoundryUtcInstantSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";

export const FOUNDRY_PHOTO_CAPTURE_QUALITY_REPORT_V0 =
  "omnitwin.foundry.photo-capture-quality-report.v0";
export const FOUNDRY_PHOTO_CAPTURE_QUALITY_REPORT_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_PHOTO_CAPTURE_QUALITY_REPORT_V0";
export const FOUNDRY_PHOTO_CAPTURE_QUALITY_ANALYSIS_PROFILE_V0 =
  "reception-photo-capture-quality-v0";

export const FOUNDRY_PHOTO_CAPTURE_QUALITY_LIMITATIONS = Object.freeze([
  "This authority-none report triages photographic capture quality; it does not reconstruct a room, recover missing detail, or prove a quality gain.",
  "Pixel thresholds are deterministic capture heuristics, not camera calibration, lens calibration, photogrammetric registration, or physical-accuracy evidence.",
  "Held-out photographs are decoded only to check their own capture integrity and possible split leakage; they are not used to build, tune, or select a model.",
  "Generated thumbnails are non-authoritative previews. The original source bytes remain the only source evidence.",
  "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.",
  "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.",
] as const);

export const FOUNDRY_RECEPTION_30_BUILD_SLOTS = Object.freeze([
  "RR-PILOT-MAP-A-01",
  "RR-PILOT-MAP-A-02",
  "RR-PILOT-MAP-A-03",
  "RR-PILOT-MAP-A-04",
  "RR-PILOT-MAP-A-05",
  "RR-PILOT-MAP-A-06",
  "RR-PILOT-MAP-A-07",
  "RR-PILOT-MAP-A-08",
  "RR-PILOT-MAP-A-09",
  "RR-PILOT-MAP-B-01",
  "RR-PILOT-MAP-B-02",
  "RR-PILOT-MAP-B-03",
  "RR-PILOT-MAP-B-04",
  "RR-PILOT-MAP-B-05",
  "RR-PILOT-MAP-B-06",
  "RR-PILOT-MAP-B-07",
  "RR-PILOT-MAP-B-08",
  "RR-PILOT-MAP-B-09",
] as const);

export const FOUNDRY_RECEPTION_30_HELDOUT_SLOTS = Object.freeze([
  "RR-PILOT-S01-A",
  "RR-PILOT-S01-B",
  "RR-PILOT-S02-A",
  "RR-PILOT-S02-B",
  "RR-PILOT-S03-A",
  "RR-PILOT-S03-B",
  "RR-PILOT-S04-A",
  "RR-PILOT-S04-B",
  "RR-PILOT-S05-A",
  "RR-PILOT-S05-B",
  "RR-PILOT-S06-A",
  "RR-PILOT-S06-B",
] as const);

export const FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0 = Object.freeze({
  minimumMegapixels: 8,
  reviewMegapixels: 12,
  retakeTenengrad: 0.000_35,
  reviewTenengrad: 0.001_2,
  reviewClippedFraction: 0.03,
  retakeClippedFraction: 0.12,
  retakeDarkMedian: 0.06,
  retakeBrightMedian: 0.94,
  reviewColourDistance: 0.16,
  nearDuplicateHammingMax: 5,
  analysisMaxDimensionPx: 512,
  thumbnailMaxWidthPx: 360,
  thumbnailMaxHeightPx: 240,
} as const);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const IMAGE_ID = /^photo-[a-f0-9]{24}$/u;
const DIFFERENCE_HASH = /^[a-f0-9]{16}$/u;
const PROTOCOL_SLOT = /^RR-PILOT-(?:MAP-[AB]-0[1-9]|S0[1-6]-[AB])$/u;

const Sha256Schema = z.string().regex(SHA256_HEX);
const UnitIntervalSchema = z.number().finite().min(0).max(1);
const SafeCountSchema = z.number().int().safe().nonnegative();
const SafePositiveCountSchema = z.number().int().safe().positive();
const ProtocolSlotSchema = z.string().regex(PROTOCOL_SLOT);

export const FoundryPhotoCaptureQualityRoleV0Schema = z.enum([
  "build",
  "heldout",
  "ignore",
]);
export type FoundryPhotoCaptureQualityRoleV0 = z.infer<
  typeof FoundryPhotoCaptureQualityRoleV0Schema
>;

export const FoundryPhotoCaptureQualityAssignmentV0Schema = z
  .object({
    path: FoundryRelativePathSchema,
    sha256: Sha256Schema,
    sizeBytes: SafeCountSchema,
    role: FoundryPhotoCaptureQualityRoleV0Schema,
    protocolSlot: ProtocolSlotSchema.nullable(),
  })
  .strict();
export type FoundryPhotoCaptureQualityAssignmentV0 = z.infer<
  typeof FoundryPhotoCaptureQualityAssignmentV0Schema
>;

export const FoundryPhotoCaptureQualityIssueCodeV0Schema = z.enum([
  "decode_failed",
  "resolution_too_low",
  "resolution_below_recommended",
  "possible_blur",
  "severe_blur",
  "shadow_clipping",
  "severe_shadow_clipping",
  "highlight_clipping",
  "severe_highlight_clipping",
  "extreme_underexposure",
  "extreme_overexposure",
  "colour_balance_outlier",
  "raw_counterpart_missing",
]);
export type FoundryPhotoCaptureQualityIssueCodeV0 = z.infer<
  typeof FoundryPhotoCaptureQualityIssueCodeV0Schema
>;

const PhotoIssueSchema = z
  .object({
    code: FoundryPhotoCaptureQualityIssueCodeV0Schema,
    severity: z.enum(["review", "retake"]),
    guidance: z.string().trim().min(1).max(500),
  })
  .strict();

const ThumbnailReceiptSchema = z
  .object({
    mediaType: z.literal("image/webp"),
    widthPx: SafePositiveCountSchema.max(4_096),
    heightPx: SafePositiveCountSchema.max(4_096),
    sizeBytes: SafePositiveCountSchema.max(20 * 1_024 * 1_024),
    sha256: Sha256Schema,
  })
  .strict();

const PixelMetricsSchema = z
  .object({
    sourceWidthPx: SafePositiveCountSchema.max(100_000),
    sourceHeightPx: SafePositiveCountSchema.max(100_000),
    sourceMegapixels: z.number().finite().positive().max(10_000),
    analysisWidthPx: SafePositiveCountSchema.max(
      FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.analysisMaxDimensionPx,
    ),
    analysisHeightPx: SafePositiveCountSchema.max(
      FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.analysisMaxDimensionPx,
    ),
    lumaMean: UnitIntervalSchema,
    lumaStandardDeviation: UnitIntervalSchema,
    lumaP05: UnitIntervalSchema,
    lumaP50: UnitIntervalSchema,
    lumaP95: UnitIntervalSchema,
    shadowClippedFraction: UnitIntervalSchema,
    highlightClippedFraction: UnitIntervalSchema,
    tenengrad: z.number().finite().nonnegative().max(64),
    meanRgb: z.tuple([UnitIntervalSchema, UnitIntervalSchema, UnitIntervalSchema]),
    differenceHash64: z.string().regex(DIFFERENCE_HASH),
  })
  .strict()
  .superRefine((metrics, ctx) => {
    if (metrics.lumaP05 > metrics.lumaP50 || metrics.lumaP50 > metrics.lumaP95) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lumaP50"],
        message: "luma percentiles must be monotonic",
      });
    }
  });

const RawCounterpartSchema = z
  .object({
    state: z.enum(["present_unreviewed", "missing"]),
    paths: z.array(FoundryRelativePathSchema).max(8),
  })
  .strict()
  .superRefine((counterpart, ctx) => {
    if (
      (counterpart.state === "missing" && counterpart.paths.length !== 0) ||
      (counterpart.state === "present_unreviewed" && counterpart.paths.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paths"],
        message: "raw-counterpart state must match its path evidence",
      });
    }
  });

const SuccessfulDecodeSchema = z
  .object({
    status: z.literal("decoded"),
    mediaType: z.enum(["image/jpeg", "image/png"]),
    metrics: PixelMetricsSchema,
    thumbnail: ThumbnailReceiptSchema,
  })
  .strict();

const FailedDecodeSchema = z
  .object({
    status: z.literal("decode_failed"),
    mediaType: z.enum(["image/jpeg", "image/png"]),
    failureCode: z.literal("unsupported_or_corrupt_pixel_payload"),
    metrics: z.null(),
    thumbnail: z.null(),
  })
  .strict();

export const FoundryPhotoCaptureQualityPhotoV0Schema = z
  .object({
    imageId: z.string().regex(IMAGE_ID),
    source: FoundryPhotoCaptureQualityAssignmentV0Schema.extend({
      role: z.enum(["build", "heldout"]),
    }).strict(),
    decode: z.discriminatedUnion("status", [
      SuccessfulDecodeSchema,
      FailedDecodeSchema,
    ]),
    rawCounterpart: RawCounterpartSchema,
    colourDistanceFromRoleMedian: UnitIntervalSchema.nullable(),
    issues: z.array(PhotoIssueSchema).max(16),
    verdict: z.enum(["pass", "review", "retake"]),
  })
  .strict()
  .superRefine((photo, ctx) => {
    const issueCodes = photo.issues.map((issue) => issue.code);
    if (new Set(issueCodes).size !== issueCodes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issues"],
        message: "photo issue codes must be unique",
      });
    }
    const expectedVerdict = photo.issues.some((issue) => issue.severity === "retake")
      ? "retake"
      : photo.issues.length > 0
        ? "review"
        : "pass";
    if (photo.verdict !== expectedVerdict) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verdict"],
        message: "photo verdict must match its most severe issue",
      });
    }
    if (
      photo.decode.status === "decode_failed" &&
      !photo.issues.some(
        (issue) => issue.code === "decode_failed" && issue.severity === "retake",
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issues"],
        message: "a decode failure must carry a retake issue",
      });
    }
  });
export type FoundryPhotoCaptureQualityPhotoV0 = z.infer<
  typeof FoundryPhotoCaptureQualityPhotoV0Schema
>;

const SimilarityFindingSchema = z
  .object({
    leftImageId: z.string().regex(IMAGE_ID),
    rightImageId: z.string().regex(IMAGE_ID),
    kind: z.enum([
      "within_role_near_duplicate",
      "cross_role_holdout_overlap_risk",
    ]),
    hammingDistance: z.number().int().min(0).max(64),
    guidance: z.string().trim().min(1).max(500),
  })
  .strict();

const ProtocolCoverageSchema = z
  .object({
    protocolId: z.literal("reception-30-photo-proof-v1"),
    expectedBuildCount: z.literal(18),
    expectedHeldoutCount: z.literal(12),
    matchedBuildCount: z.number().int().min(0).max(18),
    matchedHeldoutCount: z.number().int().min(0).max(12),
    missingBuildSlots: z.array(ProtocolSlotSchema).max(18),
    missingHeldoutSlots: z.array(ProtocolSlotSchema).max(12),
    duplicateSlots: z.array(ProtocolSlotSchema).max(30),
    misassignedSlots: z.array(ProtocolSlotSchema).max(30),
    unmatchedAssignedPaths: z.array(FoundryRelativePathSchema).max(500),
    rawCounterpartCount: z.number().int().min(0).max(500),
    candidateSessionNotePaths: z.array(FoundryRelativePathSchema).max(32),
    sessionNoteState: z.enum(["present_unreviewed", "missing"]),
    status: z.enum(["complete_unreviewed", "incomplete"]),
  })
  .strict();

const SummarySchema = z
  .object({
    assignedBuildCount: SafeCountSchema,
    assignedHeldoutCount: SafeCountSchema,
    ignoredCount: SafeCountSchema,
    decodedCount: SafeCountSchema,
    decodeFailureCount: SafeCountSchema,
    passCount: SafeCountSchema,
    reviewCount: SafeCountSchema,
    retakeCount: SafeCountSchema,
    similarityFindingCount: SafeCountSchema,
    heldoutPolicy: z.literal("excluded_from_build_tuning_and_selection"),
    readiness: z.enum([
      "capture_quality_ready",
      "review_required",
      "retake_required",
    ]),
  })
  .strict();

const AnalysisProfileSchema = z
  .object({
    id: z.literal(FOUNDRY_PHOTO_CAPTURE_QUALITY_ANALYSIS_PROFILE_V0),
    thresholds: z
      .object({
        minimumMegapixels: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.minimumMegapixels,
        ),
        reviewMegapixels: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.reviewMegapixels,
        ),
        retakeTenengrad: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.retakeTenengrad,
        ),
        reviewTenengrad: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.reviewTenengrad,
        ),
        reviewClippedFraction: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.reviewClippedFraction,
        ),
        retakeClippedFraction: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.retakeClippedFraction,
        ),
        retakeDarkMedian: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.retakeDarkMedian,
        ),
        retakeBrightMedian: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.retakeBrightMedian,
        ),
        reviewColourDistance: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.reviewColourDistance,
        ),
        nearDuplicateHammingMax: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.nearDuplicateHammingMax,
        ),
        analysisMaxDimensionPx: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.analysisMaxDimensionPx,
        ),
        thumbnailMaxWidthPx: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.thumbnailMaxWidthPx,
        ),
        thumbnailMaxHeightPx: z.literal(
          FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.thumbnailMaxHeightPx,
        ),
      })
      .strict(),
  })
  .strict();

const ReportPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PHOTO_CAPTURE_QUALITY_REPORT_V0),
    generatedAt: FoundryUtcInstantSchema,
    authority: z.literal("none"),
    resultType: z.literal("capture_quality_triage_not_reconstruction"),
    sourceReceiptSha256: Sha256Schema,
    analysisProfile: AnalysisProfileSchema,
    assignments: z
      .array(FoundryPhotoCaptureQualityAssignmentV0Schema)
      .min(1)
      .max(500),
    photos: z.array(FoundryPhotoCaptureQualityPhotoV0Schema).max(500),
    similarityFindings: z.array(SimilarityFindingSchema).max(4_000),
    protocolCoverage: ProtocolCoverageSchema,
    summary: SummarySchema,
    originalsModified: z.literal(false),
    externalRequests: z.literal(0),
    limitations: z.tuple([
      z.literal(FOUNDRY_PHOTO_CAPTURE_QUALITY_LIMITATIONS[0]),
      z.literal(FOUNDRY_PHOTO_CAPTURE_QUALITY_LIMITATIONS[1]),
      z.literal(FOUNDRY_PHOTO_CAPTURE_QUALITY_LIMITATIONS[2]),
      z.literal(FOUNDRY_PHOTO_CAPTURE_QUALITY_LIMITATIONS[3]),
      z.literal(FOUNDRY_PHOTO_CAPTURE_QUALITY_LIMITATIONS[4]),
      z.literal(FOUNDRY_PHOTO_CAPTURE_QUALITY_LIMITATIONS[5]),
    ]),
  })
  .strict();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

function expectedProtocolCoverage(
  assignments: readonly FoundryPhotoCaptureQualityAssignmentV0[],
  photos: readonly FoundryPhotoCaptureQualityPhotoV0[],
  candidateSessionNotePaths: readonly string[],
): z.infer<typeof ProtocolCoverageSchema> {
  const bySlot = new Map<string, FoundryPhotoCaptureQualityAssignmentV0[]>();
  for (const assignment of assignments) {
    if (assignment.role === "ignore" || assignment.protocolSlot === null) continue;
    const members = bySlot.get(assignment.protocolSlot) ?? [];
    members.push(assignment);
    bySlot.set(assignment.protocolSlot, members);
  }
  const missingBuildSlots = FOUNDRY_RECEPTION_30_BUILD_SLOTS.filter((slot) =>
    !(bySlot.get(slot) ?? []).some((assignment) => assignment.role === "build")
  );
  const missingHeldoutSlots = FOUNDRY_RECEPTION_30_HELDOUT_SLOTS.filter((slot) =>
    !(bySlot.get(slot) ?? []).some((assignment) => assignment.role === "heldout")
  );
  const duplicateSlots = [...bySlot.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([slot]) => slot)
    .sort(compareText);
  const buildSlotSet = new Set<string>(FOUNDRY_RECEPTION_30_BUILD_SLOTS);
  const heldoutSlotSet = new Set<string>(FOUNDRY_RECEPTION_30_HELDOUT_SLOTS);
  const misassignedSlots = [...bySlot.entries()]
    .filter(([slot, members]) => members.some((assignment) =>
      (buildSlotSet.has(slot) && assignment.role !== "build") ||
      (heldoutSlotSet.has(slot) && assignment.role !== "heldout")
    ))
    .map(([slot]) => slot)
    .sort(compareText);
  const unmatchedAssignedPaths = assignments
    .filter((assignment) => assignment.role !== "ignore" && assignment.protocolSlot === null)
    .map((assignment) => assignment.path)
    .sort(compareText);
  const rawCounterpartCount = photos.filter(
    (photo) => photo.rawCounterpart.state === "present_unreviewed",
  ).length;
  const sessionNoteState = candidateSessionNotePaths.length > 0
    ? "present_unreviewed"
    : "missing";
  const complete =
    missingBuildSlots.length === 0 &&
    missingHeldoutSlots.length === 0 &&
    duplicateSlots.length === 0 &&
    misassignedSlots.length === 0 &&
    unmatchedAssignedPaths.length === 0 &&
    assignments.filter((assignment) => assignment.role === "build").length === 18 &&
    assignments.filter((assignment) => assignment.role === "heldout").length === 12;
  return {
    protocolId: "reception-30-photo-proof-v1",
    expectedBuildCount: 18,
    expectedHeldoutCount: 12,
    matchedBuildCount: 18 - missingBuildSlots.length,
    matchedHeldoutCount: 12 - missingHeldoutSlots.length,
    missingBuildSlots,
    missingHeldoutSlots,
    duplicateSlots,
    misassignedSlots,
    unmatchedAssignedPaths,
    rawCounterpartCount,
    candidateSessionNotePaths: [...candidateSessionNotePaths].sort(compareText),
    sessionNoteState,
    status: complete ? "complete_unreviewed" : "incomplete",
  };
}

function expectedSummary(
  assignments: readonly FoundryPhotoCaptureQualityAssignmentV0[],
  photos: readonly FoundryPhotoCaptureQualityPhotoV0[],
  similarityFindings: readonly z.infer<typeof SimilarityFindingSchema>[],
  protocolCoverage: z.infer<typeof ProtocolCoverageSchema>,
): z.infer<typeof SummarySchema> {
  const retakeCount = photos.filter((photo) => photo.verdict === "retake").length;
  const reviewCount = photos.filter((photo) => photo.verdict === "review").length;
  return {
    assignedBuildCount: assignments.filter((assignment) => assignment.role === "build").length,
    assignedHeldoutCount: assignments.filter((assignment) => assignment.role === "heldout").length,
    ignoredCount: assignments.filter((assignment) => assignment.role === "ignore").length,
    decodedCount: photos.filter((photo) => photo.decode.status === "decoded").length,
    decodeFailureCount: photos.filter((photo) => photo.decode.status === "decode_failed").length,
    passCount: photos.filter((photo) => photo.verdict === "pass").length,
    reviewCount,
    retakeCount,
    similarityFindingCount: similarityFindings.length,
    heldoutPolicy: "excluded_from_build_tuning_and_selection",
    readiness: retakeCount > 0 || protocolCoverage.status === "incomplete"
      ? "retake_required"
      : reviewCount > 0 || similarityFindings.length > 0
        ? "review_required"
        : "capture_quality_ready",
  };
}

const ReportPayloadSchema = ReportPayloadObjectSchema.superRefine((report, ctx) => {
  const assignmentPaths = report.assignments.map((assignment) => assignment.path);
  if (new Set(assignmentPaths).size !== assignmentPaths.length) {
    addIssue(ctx, ["assignments"], "assignment paths must be unique");
  }
  const expectedPhotos = report.assignments.filter((assignment) => assignment.role !== "ignore");
  if (
    report.photos.length !== expectedPhotos.length ||
    report.photos.some((photo, index) => {
      const assignment = expectedPhotos[index];
      return assignment === undefined ||
        photo.source.path !== assignment.path ||
        photo.source.sha256 !== assignment.sha256 ||
        photo.source.sizeBytes !== assignment.sizeBytes ||
        photo.source.role !== assignment.role ||
        photo.source.protocolSlot !== assignment.protocolSlot;
    })
  ) {
    addIssue(
      ctx,
      ["photos"],
      "photos must exactly match non-ignored assignments in assignment order",
    );
  }
  const imageIds = report.photos.map((photo) => photo.imageId);
  if (new Set(imageIds).size !== imageIds.length) {
    addIssue(ctx, ["photos"], "photo image IDs must be unique");
  }
  const photoById = new Map(report.photos.map((photo) => [photo.imageId, photo] as const));
  const seenPairs = new Set<string>();
  for (const [index, finding] of report.similarityFindings.entries()) {
    const left = photoById.get(finding.leftImageId);
    const right = photoById.get(finding.rightImageId);
    if (left === undefined || right === undefined || left.imageId === right.imageId) {
      addIssue(ctx, ["similarityFindings", index], "similarity findings must reference two photos");
      continue;
    }
    const pairKey = [left.imageId, right.imageId].sort(compareText).join(":");
    if (seenPairs.has(pairKey)) {
      addIssue(ctx, ["similarityFindings", index], "similarity photo pairs must be unique");
    }
    seenPairs.add(pairKey);
    if (
      finding.hammingDistance >
      FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.nearDuplicateHammingMax
    ) {
      addIssue(ctx, ["similarityFindings", index, "hammingDistance"], "similarity finding exceeds the frozen threshold");
    }
    const crossesRoles = left.source.role !== right.source.role;
    if (
      (crossesRoles && finding.kind !== "cross_role_holdout_overlap_risk") ||
      (!crossesRoles && finding.kind !== "within_role_near_duplicate")
    ) {
      addIssue(ctx, ["similarityFindings", index, "kind"], "similarity kind must match the two assigned roles");
    }
  }
  const expectedCoverage = expectedProtocolCoverage(
    report.assignments,
    report.photos,
    report.protocolCoverage.candidateSessionNotePaths,
  );
  if (JSON.stringify(report.protocolCoverage) !== JSON.stringify(expectedCoverage)) {
    addIssue(ctx, ["protocolCoverage"], "protocol coverage must be derived from the exact assignments and photo evidence");
  }
  const summary = expectedSummary(
    report.assignments,
    report.photos,
    report.similarityFindings,
    expectedCoverage,
  );
  if (JSON.stringify(report.summary) !== JSON.stringify(summary)) {
    addIssue(ctx, ["summary"], "summary must be derived from the exact report evidence");
  }
});

export function computeFoundryPhotoCaptureQualityReportSha256(
  input: unknown,
): string {
  const payload = ReportPayloadSchema.parse(input);
  return domainSeparatedSha256(
    FOUNDRY_PHOTO_CAPTURE_QUALITY_REPORT_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

export const FoundryPhotoCaptureQualityReportV0Schema =
  ReportPayloadObjectSchema.extend({ reportSha256: Sha256Schema })
    .strict()
    .superRefine((report, ctx) => {
      const { reportSha256: _reportSha256, ...payload } = report;
      const parsed = ReportPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue(issue);
        return;
      }
      if (
        report.reportSha256 !==
        computeFoundryPhotoCaptureQualityReportSha256(parsed.data)
      ) {
        addIssue(
          ctx,
          ["reportSha256"],
          "photo capture-quality report digest does not match its payload",
        );
      }
    });

export type FoundryPhotoCaptureQualityReportV0 = z.infer<
  typeof FoundryPhotoCaptureQualityReportV0Schema
>;

export interface CompileFoundryPhotoCaptureQualityReportV0Input {
  readonly generatedAt: string;
  readonly sourceReceiptSha256: string;
  readonly assignments: readonly FoundryPhotoCaptureQualityAssignmentV0[];
  readonly photos: readonly FoundryPhotoCaptureQualityPhotoV0[];
  readonly similarityFindings: readonly z.input<typeof SimilarityFindingSchema>[];
  readonly candidateSessionNotePaths: readonly string[];
}

export function compileFoundryPhotoCaptureQualityReportV0(
  input: CompileFoundryPhotoCaptureQualityReportV0Input,
): FoundryPhotoCaptureQualityReportV0 {
  const assignments = z
    .array(FoundryPhotoCaptureQualityAssignmentV0Schema)
    .min(1)
    .max(500)
    .parse(input.assignments);
  const photos = z
    .array(FoundryPhotoCaptureQualityPhotoV0Schema)
    .max(500)
    .parse(input.photos);
  const similarityFindings = z
    .array(SimilarityFindingSchema)
    .max(4_000)
    .parse(input.similarityFindings);
  const candidateSessionNotePaths = z
    .array(FoundryRelativePathSchema)
    .max(32)
    .parse(input.candidateSessionNotePaths);
  const protocolCoverage = expectedProtocolCoverage(
    assignments,
    photos,
    candidateSessionNotePaths,
  );
  const summary = expectedSummary(
    assignments,
    photos,
    similarityFindings,
    protocolCoverage,
  );
  const payload = ReportPayloadSchema.parse({
    schemaVersion: FOUNDRY_PHOTO_CAPTURE_QUALITY_REPORT_V0,
    generatedAt: input.generatedAt,
    authority: "none",
    resultType: "capture_quality_triage_not_reconstruction",
    sourceReceiptSha256: input.sourceReceiptSha256,
    analysisProfile: {
      id: FOUNDRY_PHOTO_CAPTURE_QUALITY_ANALYSIS_PROFILE_V0,
      thresholds: { ...FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0 },
    },
    assignments,
    photos,
    similarityFindings,
    protocolCoverage,
    summary,
    originalsModified: false,
    externalRequests: 0,
    limitations: [...FOUNDRY_PHOTO_CAPTURE_QUALITY_LIMITATIONS],
  });
  return FoundryPhotoCaptureQualityReportV0Schema.parse({
    ...payload,
    reportSha256: computeFoundryPhotoCaptureQualityReportSha256(payload),
  });
}

export function verifyFoundryPhotoCaptureQualityReportV0(
  input: unknown,
): FoundryPhotoCaptureQualityReportV0 {
  return FoundryPhotoCaptureQualityReportV0Schema.parse(input);
}

export function serializeFoundryPhotoCaptureQualityReportV0(
  value: FoundryPhotoCaptureQualityReportV0,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryPhotoCaptureQualityReportV0Schema.parse(value)),
  );
}

import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT,
  FOUNDRY_POTREE_V2_POINT_PREVIEW_MARGIN,
  FOUNDRY_POTREE_V2_POINT_PREVIEW_MODES,
  FOUNDRY_POTREE_V2_POINT_PREVIEW_VIEW_IDS,
  FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH,
} from "./potree-v2-point-values.js";
import {
  FoundryUniversalIntakeReceiptSchema,
  type FoundryUniversalIntakeReceipt,
} from "./intake-receipt.js";
import {
  FoundryUniversalSourceFactsV8Schema,
  type FoundryUniversalSourceFactsV8,
} from "./source-facts-v8.js";
import { FOUNDRY_POTREE_V2_BUNDLE_DIGEST_DOMAIN } from "./source-facts-v7.js";

export const FOUNDRY_ROOM_ENVELOPE_REVIEW_V0 =
  "omnitwin.foundry.room-envelope-review.v0";
export const FOUNDRY_ROOM_ENVELOPE_REVIEW_DIGEST_DOMAIN_V0 =
  "OMNITWIN_FOUNDRY_ROOM_ENVELOPE_REVIEW_V0";
export const FOUNDRY_ROOM_ENVELOPE_REVIEW_MAPPING_PROFILE_V0 =
  "potree_v2_v8_intrinsic_pixel_to_decoder_coordinates_v0";
export const FOUNDRY_ROOM_ENVELOPE_REVIEW_MIN_INCLUDED_RECORDS_V0 = 512;
export const FOUNDRY_ROOM_ENVELOPE_REVIEW_MIN_POLYGON_AREA_V0 = 64;
export const FOUNDRY_ROOM_ENVELOPE_REVIEW_MAX_VERTICES_V0 = 64;

export const FOUNDRY_ROOM_ENVELOPE_REVIEW_LIMITATIONS_V0 = Object.freeze([
  "OPERATOR_SELECTION_DOES_NOT_ESTABLISH_UNITS_AXES_FRAME_CRS_ROOM_IDENTITY_OR_PHYSICAL_ACCURACY",
  "THE_POLYGON_IS_A_FIT_SEED_ONLY_AND_IS_NOT_VALIDATION_INDEPENDENT_CONTROL_OR_TRANSFORM_AUTHORITY",
  "PIXEL_TO_DECODER_INVERSION_USES_THE_FROZEN_V8_DIAGNOSTIC_RASTER_MAPPING_AND_DOES_NOT_ADD_SOURCE_PRECISION",
  "PURPOSE_SCOPED_RIGHTS_AND PRODUCER_LINEAGE_REMAIN_UNREVIEWED",
] as const);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const AxisSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const ViewIdSchema = z.enum(FOUNDRY_POTREE_V2_POINT_PREVIEW_VIEW_IDS);
const PreviewModeSchema = z.enum(FOUNDRY_POTREE_V2_POINT_PREVIEW_MODES);
const Vec2Schema = z.tuple([z.number().finite(), z.number().finite()]);
const Vec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const IntrinsicPixelSchema = z.tuple([
  z.number().int().min(0).max(FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH - 1),
  z.number().int().min(0).max(FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT - 1),
]);

const PreviewRequestRefSchema = z.object({
  viewId: ViewIdSchema,
  mode: PreviewModeSchema,
  sha256: z.string().regex(SHA256_HEX),
  pixelSha256: z.string().regex(SHA256_HEX),
}).strict();

/** Browser-safe operator input. Source paths and decoded facts are never accepted here. */
export const FoundryRoomEnvelopeReviewRequestV0Schema = z.object({
  receiptSha256: z.string().regex(SHA256_HEX),
  sourceFactsSha256: z.string().regex(SHA256_HEX),
  bundleSha256: z.string().regex(SHA256_HEX),
  horizontalViewId: ViewIdSchema,
  reviewedPreviews: z.array(PreviewRequestRefSchema).length(3),
  polygonIntrinsicPixels: z.array(IntrinsicPixelSchema)
    .min(3)
    .max(FOUNDRY_ROOM_ENVELOPE_REVIEW_MAX_VERTICES_V0),
  roomLabel: z.string().trim().min(1).max(160),
  reviewerLabel: z.string().trim().min(1).max(160),
  reviewedAt: z.string().datetime(),
  decision: z.enum(["accepted_as_fit_seed", "needs_revision"]),
  note: z.string().trim().max(1_000),
}).strict().superRefine((request, ctx) => {
  const expected = [...FOUNDRY_POTREE_V2_POINT_PREVIEW_VIEW_IDS];
  const actual = request.reviewedPreviews.map((preview) => preview.viewId);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reviewedPreviews"],
      message: "Reviewed previews must cover all three canonical views in canonical order",
    });
  }
  validateSimplePolygon(request.polygonIntrinsicPixels, ctx, [
    "polygonIntrinsicPixels",
  ]);
});
export type FoundryRoomEnvelopeReviewRequestV0 = z.infer<
  typeof FoundryRoomEnvelopeReviewRequestV0Schema
>;

const PreviewEvidenceSchema = z.object({
  viewId: ViewIdSchema,
  mode: PreviewModeSchema,
  fileName: z.string().min(1).max(160),
  sha256: z.string().regex(SHA256_HEX),
  pixelSha256: z.string().regex(SHA256_HEX),
  width: z.literal(FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH),
  height: z.literal(FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT),
  projectedAxes: z.tuple([AxisSchema, AxisSchema]),
  omittedAxis: AxisSchema,
}).strict();

const MemberEvidenceSchema = z.object({
  role: z.enum(["metadata", "hierarchy", "octree"]),
  relativePath: z.string().min(1).max(1_024),
  sizeBytes: z.number().int().safe().nonnegative(),
  sha256: z.string().regex(SHA256_HEX),
}).strict();

export const FoundryRoomEnvelopeMappingV0Schema = z.object({
  profile: z.literal(FOUNDRY_ROOM_ENVELOPE_REVIEW_MAPPING_PROFILE_V0),
  decodedMin: Vec3Schema,
  decodedMax: Vec3Schema,
  width: z.literal(FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH),
  height: z.literal(FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT),
  marginPixels: z.literal(FOUNDRY_POTREE_V2_POINT_PREVIEW_MARGIN),
  fitScale: z.number().finite().positive(),
  offsetX: z.number().finite().nonnegative(),
  offsetY: z.number().finite().nonnegative(),
  yAxisRule: z.literal("raw_y_floor_then_height_minus_one"),
}).strict();
export type FoundryRoomEnvelopeMappingV0 = z.infer<
  typeof FoundryRoomEnvelopeMappingV0Schema
>;

const BoundsSchema = z.object({ min: Vec3Schema, max: Vec3Schema }).strict();

const ArtifactBaseSchema = z.object({
  schemaVersion: z.literal(FOUNDRY_ROOM_ENVELOPE_REVIEW_V0),
  authority: z.literal("none"),
  source: z.object({
    receiptSha256: z.string().regex(SHA256_HEX),
    sourceFactsSha256: z.string().regex(SHA256_HEX),
    bundleRoot: z.string().max(4_096),
    bundleSha256: z.string().regex(SHA256_HEX),
    members: z.array(MemberEvidenceSchema).length(3),
    preview: PreviewEvidenceSchema,
  }).strict(),
  review: z.object({
    roomLabel: z.string().trim().min(1).max(160),
    reviewerLabel: z.string().trim().min(1).max(160),
    reviewedAt: z.string().datetime(),
    decision: z.enum(["accepted_as_fit_seed", "needs_revision"]),
    note: z.string().trim().max(1_000),
    reviewedPreviews: z.array(PreviewEvidenceSchema).length(3),
  }).strict(),
  selection: z.object({
    horizontalViewId: ViewIdSchema,
    projectedAxes: z.tuple([AxisSchema, AxisSchema]),
    omittedAxis: AxisSchema,
    polygonIntrinsicPixels: z.array(IntrinsicPixelSchema)
      .min(3)
      .max(FOUNDRY_ROOM_ENVELOPE_REVIEW_MAX_VERTICES_V0),
    polygonDecoderCoordinates: z.array(Vec2Schema)
      .min(3)
      .max(FOUNDRY_ROOM_ENVELOPE_REVIEW_MAX_VERTICES_V0),
    mapping: FoundryRoomEnvelopeMappingV0Schema,
    includedRecordCount: z.number().int().safe().nonnegative(),
    excludedRecordCount: z.number().int().safe().nonnegative(),
    includedDecodedBounds: BoundsSchema.nullable(),
  }).strict(),
  eligibility: z.enum([
    "eligible_for_fit_only_diagnostic",
    "not_eligible",
  ]),
  policy: z.object({
    fitOnlyDiagnostic: z.literal(true),
    validationInputsRead: z.literal(false),
    sourceBytesMutated: z.literal(false),
    networkUsed: z.literal(false),
  }).strict(),
  limitations: z.tuple([
    z.literal(FOUNDRY_ROOM_ENVELOPE_REVIEW_LIMITATIONS_V0[0]),
    z.literal(FOUNDRY_ROOM_ENVELOPE_REVIEW_LIMITATIONS_V0[1]),
    z.literal(FOUNDRY_ROOM_ENVELOPE_REVIEW_LIMITATIONS_V0[2]),
    z.literal(FOUNDRY_ROOM_ENVELOPE_REVIEW_LIMITATIONS_V0[3]),
  ]),
  reportSha256: z.string().regex(SHA256_HEX),
}).strict();

export type FoundryRoomEnvelopeReviewV0 = z.infer<
  typeof ArtifactBaseSchema
>;

function artifactDigest(
  artifact: Omit<FoundryRoomEnvelopeReviewV0, "reportSha256">,
): string {
  return domainSeparatedSha256(
    FOUNDRY_ROOM_ENVELOPE_REVIEW_DIGEST_DOMAIN_V0,
    toCanonicalJson(artifact),
  );
}

function approximatelyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-10;
}

function samePair(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === 2 && right.length === 2 &&
    approximatelyEqual(left[0] ?? NaN, right[0] ?? NaN) &&
    approximatelyEqual(left[1] ?? NaN, right[1] ?? NaN);
}

function validateArtifact(
  artifact: FoundryRoomEnvelopeReviewV0,
  ctx: z.RefinementCtx,
): void {
  const roles = artifact.source.members.map((member) => member.role);
  if (roles.join(",") !== "metadata,hierarchy,octree") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source", "members"],
      message: "Bundle members must retain canonical metadata, hierarchy, octree order",
    });
  }
  const leafByRole = {
    metadata: "metadata.json",
    hierarchy: "hierarchy.bin",
    octree: "octree.bin",
  } as const;
  const expectedMemberPaths = artifact.source.members.map((member) => {
    const leaf = leafByRole[member.role];
    return artifact.source.bundleRoot === ""
      ? leaf
      : `${artifact.source.bundleRoot}/${leaf}`;
  });
  const bundleRootUnsafe = artifact.source.bundleRoot.includes("\\") ||
    (
      artifact.source.bundleRoot !== "" &&
      artifact.source.bundleRoot.split("/").some(
        (part) => part === "." || part === ".." || part === "",
      )
    );
  if (
    bundleRootUnsafe ||
    artifact.source.members.some(
      (member, index) => member.relativePath !== expectedMemberPaths[index],
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source", "members"],
      message: "Bundle members must use the exact canonical paths below the declared bundle root",
    });
  }
  const expectedBundleSha256 = domainSeparatedSha256(
    FOUNDRY_POTREE_V2_BUNDLE_DIGEST_DOMAIN,
    toCanonicalJson({
      bundleRoot: artifact.source.bundleRoot,
      members: artifact.source.members.map((member) => ({
        role: member.role,
        path: member.relativePath,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
      })),
    }),
  );
  if (artifact.source.bundleSha256 !== expectedBundleSha256) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source", "bundleSha256"],
      message: "Bundle digest must match the exact canonical member identity set",
    });
  }
  const reviewedViewIds = artifact.review.reviewedPreviews.map(
    (preview) => preview.viewId,
  );
  if (
    JSON.stringify(reviewedViewIds) !==
      JSON.stringify(FOUNDRY_POTREE_V2_POINT_PREVIEW_VIEW_IDS)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["review", "reviewedPreviews"],
      message: "Review evidence must cover all three canonical projections",
    });
  }
  const canonicalViews = {
    position_0_1: { projectedAxes: [0, 1], omittedAxis: 2 },
    position_0_2: { projectedAxes: [0, 2], omittedAxis: 1 },
    position_1_2: { projectedAxes: [1, 2], omittedAxis: 0 },
  } as const;
  for (const [index, preview] of artifact.review.reviewedPreviews.entries()) {
    const expected = canonicalViews[preview.viewId];
    if (
      preview.projectedAxes[0] !== expected.projectedAxes[0] ||
      preview.projectedAxes[1] !== expected.projectedAxes[1] ||
      preview.omittedAxis !== expected.omittedAxis ||
      preview.fileName !==
        `potree-v2-${preview.viewId}-${preview.mode}.png`
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["review", "reviewedPreviews", index],
        message: "Preview projection and filename must match the frozen V8 view/mode registry",
      });
    }
  }
  const selectedPreview = artifact.review.reviewedPreviews.find(
    (preview) => preview.viewId === artifact.selection.horizontalViewId,
  );
  if (
    selectedPreview === undefined ||
    JSON.stringify(selectedPreview) !== JSON.stringify(artifact.source.preview) ||
    selectedPreview.projectedAxes[0] !== artifact.selection.projectedAxes[0] ||
    selectedPreview.projectedAxes[1] !== artifact.selection.projectedAxes[1] ||
    selectedPreview.omittedAxis !== artifact.selection.omittedAxis
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source", "preview"],
      message: "The selected horizontal preview and mapping axes must be one exact reviewed preview",
    });
  }
  validateSimplePolygon(artifact.selection.polygonIntrinsicPixels, ctx, [
    "selection",
    "polygonIntrinsicPixels",
  ]);
  const mapping = artifact.selection.mapping;
  const [axisX, axisY] = artifact.selection.projectedAxes;
  for (let axis = 0; axis < 3; axis += 1) {
    if ((mapping.decodedMin[axis] ?? 0) > (mapping.decodedMax[axis] ?? 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selection", "mapping"],
        message: "Observed decoder-coordinate minima must not exceed maxima",
      });
    }
  }
  const spanX = (mapping.decodedMax[axisX] ?? 0) -
    (mapping.decodedMin[axisX] ?? 0);
  const spanY = (mapping.decodedMax[axisY] ?? 0) -
    (mapping.decodedMin[axisY] ?? 0);
  const available = mapping.width - 2 * mapping.marginPixels;
  const candidates = [spanX, spanY]
    .filter((span) => span > 0)
    .map((span) => available / span);
  const expectedScale = candidates.length === 0 ? 1 : Math.min(...candidates);
  const expectedOffsetX = (mapping.width - spanX * expectedScale) / 2;
  const expectedOffsetY = (mapping.height - spanY * expectedScale) / 2;
  if (
    !approximatelyEqual(mapping.fitScale, expectedScale) ||
    !approximatelyEqual(mapping.offsetX, expectedOffsetX) ||
    !approximatelyEqual(mapping.offsetY, expectedOffsetY)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selection", "mapping"],
      message: "Mapping values must be derived from the frozen V8 observed-extrema fit",
    });
  }
  const expectedDecoder = artifact.selection.polygonIntrinsicPixels.map(
    ([x, y]) => intrinsicPixelToDecoder(mapping, [axisX, axisY], [x, y]),
  );
  if (
    expectedDecoder.length !==
      artifact.selection.polygonDecoderCoordinates.length ||
    expectedDecoder.some(
      (point, index) =>
        !samePair(
          point,
          artifact.selection.polygonDecoderCoordinates[index] ?? [],
        ),
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selection", "polygonDecoderCoordinates"],
      message: "Decoder-coordinate vertices must invert the exact intrinsic-pixel polygon",
    });
  }
  const recordCount =
    artifact.selection.includedRecordCount +
    artifact.selection.excludedRecordCount;
  if (!Number.isSafeInteger(recordCount) || recordCount < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selection"],
      message: "Included and excluded counts must describe one non-empty record set",
    });
  }
  if (
    (artifact.selection.includedRecordCount === 0) !==
      (artifact.selection.includedDecodedBounds === null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selection", "includedDecodedBounds"],
      message: "Included bounds must be present exactly when at least one point is selected",
    });
  }
  const includedBounds = artifact.selection.includedDecodedBounds;
  if (includedBounds !== null) {
    for (let axis = 0; axis < 3; axis += 1) {
      const lower = includedBounds.min[axis] ?? Infinity;
      const upper = includedBounds.max[axis] ?? -Infinity;
      const observedLower = mapping.decodedMin[axis] ?? Infinity;
      const observedUpper = mapping.decodedMax[axis] ?? -Infinity;
      if (
        lower > upper ||
        lower < observedLower - Math.max(1, Math.abs(observedLower)) * 1e-10 ||
        upper > observedUpper + Math.max(1, Math.abs(observedUpper)) * 1e-10
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selection", "includedDecodedBounds"],
          message: "Selected point bounds must be ordered and remain inside the observed decoder extrema",
        });
        break;
      }
    }
  }
  const expectedEligibility =
    artifact.review.decision === "accepted_as_fit_seed" &&
      artifact.selection.includedRecordCount >=
        FOUNDRY_ROOM_ENVELOPE_REVIEW_MIN_INCLUDED_RECORDS_V0
      ? "eligible_for_fit_only_diagnostic"
      : "not_eligible";
  if (artifact.eligibility !== expectedEligibility) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["eligibility"],
      message: "Eligibility must follow the explicit decision and minimum selected-point count",
    });
  }
  const { reportSha256: _reportSha256, ...payload } = artifact;
  if (artifact.reportSha256 !== artifactDigest(payload)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reportSha256"],
      message: "Review digest does not match the canonical artifact payload",
    });
  }
}

export const FoundryRoomEnvelopeReviewV0Schema: z.ZodType<
  FoundryRoomEnvelopeReviewV0
> = ArtifactBaseSchema.superRefine(validateArtifact);

export interface CompileFoundryRoomEnvelopeReviewV0Input {
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly sourceFacts: FoundryUniversalSourceFactsV8;
  readonly request: FoundryRoomEnvelopeReviewRequestV0;
  readonly includedRecordCount: number;
  readonly includedDecodedBounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  } | null;
}

function rounded(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function roundedVec3(
  value: readonly [number, number, number],
): [number, number, number] {
  return [rounded(value[0]), rounded(value[1]), rounded(value[2])];
}

export function intrinsicPixelToDecoder(
  mapping: FoundryRoomEnvelopeMappingV0,
  projectedAxes: readonly [0 | 1 | 2, 0 | 1 | 2],
  pixel: readonly [number, number],
): [number, number] {
  const [axisX, axisY] = projectedAxes;
  return [
    rounded(
      (mapping.decodedMin[axisX] ?? 0) +
        (pixel[0] - mapping.offsetX) / mapping.fitScale,
    ),
    rounded(
      (mapping.decodedMin[axisY] ?? 0) +
        (mapping.height - 1 - pixel[1] - mapping.offsetY) /
          mapping.fitScale,
    ),
  ];
}

export function computeFoundryRoomEnvelopeMappingV0(
  decodedMin: readonly [number, number, number],
  decodedMax: readonly [number, number, number],
  projectedAxes: readonly [0 | 1 | 2, 0 | 1 | 2],
): FoundryRoomEnvelopeMappingV0 {
  const [axisX, axisY] = projectedAxes;
  const spanX = decodedMax[axisX] - decodedMin[axisX];
  const spanY = decodedMax[axisY] - decodedMin[axisY];
  const available = FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH -
    2 * FOUNDRY_POTREE_V2_POINT_PREVIEW_MARGIN;
  const candidates = [spanX, spanY]
    .filter((span) => span > 0)
    .map((span) => available / span);
  const fitScale = candidates.length === 0 ? 1 : Math.min(...candidates);
  return FoundryRoomEnvelopeMappingV0Schema.parse({
    profile: FOUNDRY_ROOM_ENVELOPE_REVIEW_MAPPING_PROFILE_V0,
    decodedMin: roundedVec3(decodedMin),
    decodedMax: roundedVec3(decodedMax),
    width: FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH,
    height: FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT,
    marginPixels: FOUNDRY_POTREE_V2_POINT_PREVIEW_MARGIN,
    fitScale: rounded(fitScale),
    offsetX: rounded(
      (FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH - spanX * fitScale) / 2,
    ),
    offsetY: rounded(
      (FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT - spanY * fitScale) / 2,
    ),
    yAxisRule: "raw_y_floor_then_height_minus_one",
  });
}

export function decoderPointToIntrinsicPixel(
  mapping: FoundryRoomEnvelopeMappingV0,
  projectedAxes: readonly [0 | 1 | 2, 0 | 1 | 2],
  decoded: readonly [number, number, number],
): [number, number] {
  const [axisX, axisY] = projectedAxes;
  const x = Math.max(
    0,
    Math.min(
      mapping.width - 1,
      Math.floor(
        mapping.offsetX +
          (decoded[axisX] - mapping.decodedMin[axisX]) * mapping.fitScale,
      ),
    ),
  );
  const rawY = Math.floor(
    mapping.offsetY +
      (decoded[axisY] - mapping.decodedMin[axisY]) * mapping.fitScale,
  );
  return [
    x,
    Math.max(0, Math.min(mapping.height - 1, mapping.height - 1 - rawY)),
  ];
}

function previewEvidence(
  sourceFacts: FoundryUniversalSourceFactsV8,
  bundleSha256: string,
  requested: z.infer<typeof PreviewRequestRefSchema>,
): z.infer<typeof PreviewEvidenceSchema> {
  const bundle = sourceFacts.state === "available"
    ? sourceFacts.pointValueBundles.find(
      (candidate) => candidate.bundleSha256 === bundleSha256,
    )
    : undefined;
  if (bundle?.pointValues.state !== "established") {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_POINT_VALUES_NOT_ESTABLISHED",
      "The selected bundle does not have exact V8 point-value evidence.",
    );
  }
  const matches = bundle.pointValues.facts.previews.images.filter(
    (image) =>
      image.viewId === requested.viewId &&
      image.mode === requested.mode &&
      image.sha256 === requested.sha256 &&
      image.pixelSha256 === requested.pixelSha256,
  );
  if (matches.length !== 1) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_PREVIEW_BINDING_MISMATCH",
      "A reviewed preview does not match one exact immutable V8 image.",
    );
  }
  const image = matches[0];
  if (image === undefined) throw new Error("unreachable preview match");
  return PreviewEvidenceSchema.parse({
    viewId: image.viewId,
    mode: image.mode,
    fileName: image.fileName,
    sha256: image.sha256,
    pixelSha256: image.pixelSha256,
    width: image.width,
    height: image.height,
    projectedAxes: image.projectedAxes,
    omittedAxis: image.omittedAxis,
  });
}

export function compileFoundryRoomEnvelopeReviewV0(
  input: CompileFoundryRoomEnvelopeReviewV0Input,
): FoundryRoomEnvelopeReviewV0 {
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(input.receipt);
  const sourceFacts = FoundryUniversalSourceFactsV8Schema.parse(
    input.sourceFacts,
  );
  const request = FoundryRoomEnvelopeReviewRequestV0Schema.parse(input.request);
  if (
    request.receiptSha256 !== receipt.receiptSha256 ||
    sourceFacts.receiptSha256 !== receipt.receiptSha256 ||
    request.sourceFactsSha256 !== sourceFacts.factsSha256
  ) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_SOURCE_BINDING_MISMATCH",
      "The room review request does not bind the current receipt and V8 facts.",
    );
  }
  if (sourceFacts.state !== "available") {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_SOURCE_UNAVAILABLE",
      "Room-envelope review requires an available V8 point-value artifact.",
    );
  }
  const bundleOverlay = sourceFacts.pointValueBundles.find(
    (candidate) => candidate.bundleSha256 === request.bundleSha256,
  );
  const inheritedBundle = sourceFacts.inherited.state === "available"
    ? sourceFacts.inherited.potreeBundles.find(
      (candidate) => candidate.bundleSha256 === request.bundleSha256,
    )
    : undefined;
  if (
    bundleOverlay?.pointValues.state !== "established" ||
    inheritedBundle?.inspection.state !== "established" ||
    inheritedBundle.facts === null
  ) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_BUNDLE_NOT_ESTABLISHED",
      "The requested bundle is not one exact structurally established V8 bundle.",
    );
  }
  const reviewedPreviews = request.reviewedPreviews.map((preview) =>
    previewEvidence(sourceFacts, request.bundleSha256, preview)
  );
  const selectedPreview = reviewedPreviews.find(
    (preview) => preview.viewId === request.horizontalViewId,
  );
  if (selectedPreview === undefined) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_HORIZONTAL_VIEW_NOT_REVIEWED",
      "The selected horizontal plane is not one of the three reviewed previews.",
    );
  }
  const pointFacts = bundleOverlay.pointValues.facts;
  const [axisX, axisY] = selectedPreview.projectedAxes;
  const mapping = computeFoundryRoomEnvelopeMappingV0(
    pointFacts.position.decodedMin,
    pointFacts.position.decodedMax,
    [axisX, axisY],
  );
  const includedRecordCount = z.number().int().safe().nonnegative().parse(
    input.includedRecordCount,
  );
  if (includedRecordCount > pointFacts.recordCount) {
    throw new FoundryIntegrityError(
      "ROOM_ENVELOPE_INCLUDED_COUNT_INVALID",
      "The selected record count exceeds the exact decoded record count.",
    );
  }
  const payload: Omit<FoundryRoomEnvelopeReviewV0, "reportSha256"> = {
    schemaVersion: FOUNDRY_ROOM_ENVELOPE_REVIEW_V0,
    authority: "none",
    source: {
      receiptSha256: receipt.receiptSha256,
      sourceFactsSha256: sourceFacts.factsSha256,
      bundleRoot: inheritedBundle.bundleRoot,
      bundleSha256: inheritedBundle.bundleSha256,
      members: inheritedBundle.members.map((member) => ({
        role: member.role,
        relativePath: member.path,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
      })),
      preview: selectedPreview,
    },
    review: {
      roomLabel: request.roomLabel,
      reviewerLabel: request.reviewerLabel,
      reviewedAt: request.reviewedAt,
      decision: request.decision,
      note: request.note,
      reviewedPreviews,
    },
    selection: {
      horizontalViewId: request.horizontalViewId,
      projectedAxes: selectedPreview.projectedAxes,
      omittedAxis: selectedPreview.omittedAxis,
      polygonIntrinsicPixels: request.polygonIntrinsicPixels,
      polygonDecoderCoordinates: request.polygonIntrinsicPixels.map((pixel) =>
        intrinsicPixelToDecoder(mapping, [axisX, axisY], pixel)
      ),
      mapping,
      includedRecordCount,
      excludedRecordCount: pointFacts.recordCount - includedRecordCount,
      includedDecodedBounds: input.includedDecodedBounds === null
        ? null
        : {
            min: roundedVec3(input.includedDecodedBounds.min),
            max: roundedVec3(input.includedDecodedBounds.max),
          },
    },
    eligibility:
      request.decision === "accepted_as_fit_seed" &&
        includedRecordCount >=
          FOUNDRY_ROOM_ENVELOPE_REVIEW_MIN_INCLUDED_RECORDS_V0
        ? "eligible_for_fit_only_diagnostic"
        : "not_eligible",
    policy: {
      fitOnlyDiagnostic: true,
      validationInputsRead: false,
      sourceBytesMutated: false,
      networkUsed: false,
    },
    limitations: [
      FOUNDRY_ROOM_ENVELOPE_REVIEW_LIMITATIONS_V0[0],
      FOUNDRY_ROOM_ENVELOPE_REVIEW_LIMITATIONS_V0[1],
      FOUNDRY_ROOM_ENVELOPE_REVIEW_LIMITATIONS_V0[2],
      FOUNDRY_ROOM_ENVELOPE_REVIEW_LIMITATIONS_V0[3],
    ],
  };
  return FoundryRoomEnvelopeReviewV0Schema.parse({
    ...payload,
    reportSha256: artifactDigest(payload),
  });
}

export function serializeFoundryRoomEnvelopeReviewV0(
  artifact: FoundryRoomEnvelopeReviewV0,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryRoomEnvelopeReviewV0Schema.parse(artifact)),
  );
}

function orientation(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number {
  return (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(
  a: readonly [number, number],
  b: readonly [number, number],
  point: readonly [number, number],
): boolean {
  return orientation(a, b, point) === 0 &&
    point[0] >= Math.min(a[0], b[0]) &&
    point[0] <= Math.max(a[0], b[0]) &&
    point[1] >= Math.min(a[1], b[1]) &&
    point[1] <= Math.max(a[1], b[1]);
}

function segmentsIntersect(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  ) return true;
  return (abC === 0 && onSegment(a, b, c)) ||
    (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) ||
    (cdB === 0 && onSegment(c, d, b));
}

function polygonArea(vertices: readonly (readonly [number, number])[]): number {
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    if (current === undefined || next === undefined) continue;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea) / 2;
}

function validateSimplePolygon(
  vertices: readonly (readonly [number, number])[],
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (new Set(vertices.map(([x, y]) => `${String(x)},${String(y)}`)).size !==
    vertices.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "Polygon vertices must be unique",
    });
  }
  if (polygonArea(vertices) < FOUNDRY_ROOM_ENVELOPE_REVIEW_MIN_POLYGON_AREA_V0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "Polygon area is too small for a room-envelope fit seed",
    });
  }
  for (let left = 0; left < vertices.length; left += 1) {
    const leftNext = (left + 1) % vertices.length;
    const a = vertices[left];
    const b = vertices[leftNext];
    if (a === undefined || b === undefined) continue;
    for (let right = left + 1; right < vertices.length; right += 1) {
      const rightNext = (right + 1) % vertices.length;
      if (
        left === right || leftNext === right || rightNext === left ||
        (left === 0 && rightNext === 0)
      ) continue;
      const c = vertices[right];
      const d = vertices[rightNext];
      if (c !== undefined && d !== undefined && segmentsIntersect(a, b, c, d)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: "Polygon edges must not intersect",
        });
        return;
      }
    }
  }
}

export function intrinsicPixelInsidePolygon(
  point: readonly [number, number],
  vertices: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (
    let currentIndex = 0, previousIndex = vertices.length - 1;
    currentIndex < vertices.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = vertices[currentIndex];
    const previous = vertices[previousIndex];
    if (current === undefined || previous === undefined) continue;
    if (onSegment(previous, current, point)) return true;
    const crosses = (current[1] > point[1]) !== (previous[1] > point[1]);
    if (
      crosses &&
      point[0] <
        ((previous[0] - current[0]) * (point[1] - current[1])) /
          (previous[1] - current[1]) + current[0]
    ) inside = !inside;
  }
  return inside;
}

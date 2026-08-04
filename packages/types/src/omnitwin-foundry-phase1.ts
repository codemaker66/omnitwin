import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  FoundryRelativePathSchema,
  FoundryUtcInstantSchema,
} from "./omnitwin-foundry.js";
import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  RuntimeTransformMatrix4dSchema,
  RuntimeVec3Schema,
} from "./runtime-venue-manifest.js";

// Phase-one evidence contracts only. They neither read files nor confer review,
// runtime, publication, training, or compute authority.

export const FOUNDRY_PHASE1_PROBE_V0 = "omnitwin.foundry.phase1-probe.v0";
export const FOUNDRY_PHASE1_IDENTITY_REVIEW_V0 =
  "omnitwin.foundry.grand-hall-identity-review.v0";
export const FOUNDRY_PHASE1_E57_INSPECTION_V0 =
  "omnitwin.foundry.e57-inspection.v0";
export const FOUNDRY_PHASE1_COLMAP_INSPECTION_V0 =
  "omnitwin.foundry.colmap-inspection.v0";
export const FOUNDRY_PHASE1_RESIDUAL_REPORT_V0 =
  "omnitwin.foundry.similarity-residual-report.v0";
export const FOUNDRY_PHASE1_TRANSFORM_PROPOSAL_V0 =
  "omnitwin.foundry.transform-proposal.v0";
export const FOUNDRY_PHASE1_BUNDLE_V0 =
  "omnitwin.foundry.grand-hall-phase1-bundle.v0";

export const GRAND_HALL_IDENTITY_SWEEPS = [0, 10, 20, 40, 49] as const;
export const GRAND_HALL_CONFIRMED_IDENTITY_SWEEPS_B = [0, 10, 20, 40] as const;
export const GRAND_HALL_DIAGNOSTIC_REPRODUCTION_SWEEPS = Array.from(
  { length: 50 },
  (_, index) => index,
);
export const GRAND_HALL_PHASE1_CANDIDATE_SWEEPS = Array.from(
  { length: 49 },
  (_, index) => index,
);
export const GRAND_HALL_PHASE1_FROZEN_HOLDOUT_SWEEPS = [5, 15, 25, 35, 44] as const;
const HOLDOUT_SWEEP_SET = new Set<number>(GRAND_HALL_PHASE1_FROZEN_HOLDOUT_SWEEPS);
export const GRAND_HALL_PHASE1_FIT_SWEEPS = GRAND_HALL_PHASE1_CANDIDATE_SWEEPS.filter(
  (sweepIndex) => !HOLDOUT_SWEEP_SET.has(sweepIndex),
);
export const GRAND_HALL_CUBEFACES = [
  "front",
  "back",
  "left",
  "right",
  "up",
  "down",
] as const;

const DIGEST_DOMAIN = {
  identity: `${FOUNDRY_PHASE1_IDENTITY_REVIEW_V0}\n`,
  e57: `${FOUNDRY_PHASE1_E57_INSPECTION_V0}\n`,
  colmap: `${FOUNDRY_PHASE1_COLMAP_INSPECTION_V0}\n`,
  residual: `${FOUNDRY_PHASE1_RESIDUAL_REPORT_V0}\n`,
  proposal: `${FOUNDRY_PHASE1_TRANSFORM_PROPOSAL_V0}\n`,
} as const;
const NUMERIC_TOLERANCE = 1e-9;

function digestCanonical(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${sha256Hex(`${domain}${stableCanonicalJson(canonical)}`)}`;
}

function numbersEqual(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nearlyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= NUMERIC_TOLERANCE * scale;
}

function vectorsNearlyEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => {
    const other = right[index];
    return other !== undefined && nearlyEqual(value, other);
  });
}

function addIssue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

const IdentitySweepTupleSchema = z.tuple([
  z.literal(0),
  z.literal(10),
  z.literal(20),
  z.literal(40),
  z.literal(49),
]);
const ConfirmedIdentitySweepTupleSchema = z.tuple([
  z.literal(0),
  z.literal(10),
  z.literal(20),
  z.literal(40),
]);

export const FoundryPhase1CubefaceSchema = z.enum(GRAND_HALL_CUBEFACES);

export const FoundryPhase1FaceDigestSchema = z
  .object({
    sweepIndex: z.number().int().refine(
      (value) => GRAND_HALL_IDENTITY_SWEEPS.includes(value as never),
      "face sweep must be one of the five reviewed sweeps",
    ),
    face: FoundryPhase1CubefaceSchema,
    sha256: RuntimeSha256Schema,
    byteLength: z.number().int().safe().positive(),
  })
  .strict();
export type FoundryPhase1FaceDigest = z.infer<typeof FoundryPhase1FaceDigestSchema>;

function validateFaceDigestSet(
  faceDigests: readonly FoundryPhase1FaceDigest[],
  ctx: z.RefinementCtx,
  path: string,
): void {
  const expected = GRAND_HALL_IDENTITY_SWEEPS.flatMap((sweepIndex) =>
    GRAND_HALL_CUBEFACES.map((face) => `${String(sweepIndex)}:${face}`),
  );
  const actual = faceDigests.map((entry) => `${String(entry.sweepIndex)}:${entry.face}`);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    addIssue(
      ctx,
      [path],
      "face digests must contain the canonical six faces for sweeps 0, 10, 20, 40, and 49 exactly once",
    );
  }
}

export const FoundryPhase1IdentityDecisionBSchema = z
  .object({
    code: z.literal("B"),
    roomIdentityConfirmed: z.literal(true),
    confirmedIdentitySweepIndices: ConfirmedIdentitySweepTupleSchema,
    excludedSweeps: z.tuple([
      z
        .object({
          sweepIndex: z.literal(49),
          reason: z.literal("excluded_adjacent_space"),
        })
        .strict(),
    ]),
  })
  .strict();

const IdentityReviewMaterialFields = {
  schemaVersion: z.literal(FOUNDRY_PHASE1_IDENTITY_REVIEW_V0),
  reviewId: RuntimeManifestKeySchema,
  venueSlug: z.literal("trades-hall"),
  roomSlug: z.literal("grand-hall"),
  sourceE57Sha256: RuntimeSha256Schema,
  evidenceIndexSha256: RuntimeSha256Schema,
  reviewedSweepIndices: IdentitySweepTupleSchema,
  faceDigests: z.array(FoundryPhase1FaceDigestSchema).length(30),
  reviewer: z
    .object({
      actorType: z.literal("human"),
      reviewerId: z.string().trim().min(1).max(200),
      reviewerRole: z.literal("human_reviewer"),
      source: z.literal("codex_thread_reply"),
      response: z.literal("b"),
    })
    .strict(),
  reviewedAt: FoundryUtcInstantSchema,
  decision: FoundryPhase1IdentityDecisionBSchema,
} as const;

export const FoundryPhase1IdentityReviewMaterialV0Schema = z
  .object(IdentityReviewMaterialFields)
  .strict()
  .superRefine((review, ctx) => {
    validateFaceDigestSet(review.faceDigests, ctx, "faceDigests");
  });
export type FoundryPhase1IdentityReviewMaterialV0 = z.infer<
  typeof FoundryPhase1IdentityReviewMaterialV0Schema
>;

export function computeFoundryPhase1IdentityReviewSha256(
  review: FoundryPhase1IdentityReviewMaterialV0,
): string {
  return digestCanonical(DIGEST_DOMAIN.identity, FoundryPhase1IdentityReviewMaterialV0Schema.parse(review));
}

export const FoundryPhase1IdentityReviewV0Schema = z
  .object({
    ...IdentityReviewMaterialFields,
    reviewSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((review, ctx) => {
    validateFaceDigestSet(review.faceDigests, ctx, "faceDigests");
    const material: FoundryPhase1IdentityReviewMaterialV0 = {
      schemaVersion: review.schemaVersion,
      reviewId: review.reviewId,
      venueSlug: review.venueSlug,
      roomSlug: review.roomSlug,
      sourceE57Sha256: review.sourceE57Sha256,
      evidenceIndexSha256: review.evidenceIndexSha256,
      reviewedSweepIndices: review.reviewedSweepIndices,
      faceDigests: review.faceDigests,
      reviewer: review.reviewer,
      reviewedAt: review.reviewedAt,
      decision: review.decision,
    };
    if (review.reviewSha256 !== computeFoundryPhase1IdentityReviewSha256(material)) {
      addIssue(ctx, ["reviewSha256"], "reviewSha256 must bind the exact human review material");
    }
  });
export type FoundryPhase1IdentityReviewV0 = z.infer<
  typeof FoundryPhase1IdentityReviewV0Schema
>;

const CanonicalJsonObjectSchema = z.record(CanonicalJsonValueSchema);
export const FoundryPhase1ProbeEnvelopeV0Schema = z.union([
  z
    .object({
      schemaVersion: z.literal(FOUNDRY_PHASE1_PROBE_V0),
      mode: z.enum(["inspect-e57", "inspect-colmap", "align"]),
      status: z.literal("ok"),
      result: CanonicalJsonObjectSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(FOUNDRY_PHASE1_PROBE_V0),
      mode: z.string().trim().min(1).max(80),
      status: z.literal("error"),
      error: z
        .object({
          code: z.string().trim().min(1).max(120).regex(/^[A-Z0-9_]+$/u),
          message: z.string().trim().min(1).max(2_000),
        })
        .strict(),
    })
    .strict(),
]);
export type FoundryPhase1ProbeEnvelopeV0 = z.infer<
  typeof FoundryPhase1ProbeEnvelopeV0Schema
>;

const E57InspectionMaterialFields = {
  schemaVersion: z.literal(FOUNDRY_PHASE1_E57_INSPECTION_V0),
  inspectionId: RuntimeManifestKeySchema,
  identityReviewSha256: RuntimeSha256Schema,
  sourceE57Sha256: RuntimeSha256Schema,
  sourceByteLength: z.number().int().safe().positive(),
  probeOutputSha256: RuntimeSha256Schema,
  readMode: z.literal("read_only"),
  pointDataRead: z.literal(false),
  sourceMutationPermitted: z.literal(false),
  adapter: z
    .object({ name: z.string().trim().min(1).max(160), version: z.string().trim().min(1).max(80) })
    .strict(),
  coordinateConvention: z
    .object({
      frame: z.literal("e57_global"),
      units: z.literal("meters"),
      upAxis: z.literal("z"),
    })
    .strict(),
  scanCount: z.number().int().positive(),
  image2DCount: z.number().int().nonnegative(),
  pointRecordCount: z.number().int().safe().nonnegative(),
  reviewedSweepIndices: IdentitySweepTupleSchema,
  faceDigests: z.array(FoundryPhase1FaceDigestSchema).length(30),
  inspectedAt: FoundryUtcInstantSchema,
} as const;

export const FoundryPhase1E57InspectionMaterialV0Schema = z
  .object(E57InspectionMaterialFields)
  .strict()
  .superRefine((inspection, ctx) => {
    validateFaceDigestSet(inspection.faceDigests, ctx, "faceDigests");
  });
export type FoundryPhase1E57InspectionMaterialV0 = z.infer<
  typeof FoundryPhase1E57InspectionMaterialV0Schema
>;

export function computeFoundryPhase1E57InspectionSha256(
  inspection: FoundryPhase1E57InspectionMaterialV0,
): string {
  return digestCanonical(DIGEST_DOMAIN.e57, FoundryPhase1E57InspectionMaterialV0Schema.parse(inspection));
}

export const FoundryPhase1E57InspectionV0Schema = z
  .object({ ...E57InspectionMaterialFields, inspectionSha256: RuntimeSha256Schema })
  .strict()
  .superRefine((inspection, ctx) => {
    validateFaceDigestSet(inspection.faceDigests, ctx, "faceDigests");
    const material: FoundryPhase1E57InspectionMaterialV0 = {
      schemaVersion: inspection.schemaVersion,
      inspectionId: inspection.inspectionId,
      identityReviewSha256: inspection.identityReviewSha256,
      sourceE57Sha256: inspection.sourceE57Sha256,
      sourceByteLength: inspection.sourceByteLength,
      probeOutputSha256: inspection.probeOutputSha256,
      readMode: inspection.readMode,
      pointDataRead: inspection.pointDataRead,
      sourceMutationPermitted: inspection.sourceMutationPermitted,
      adapter: inspection.adapter,
      coordinateConvention: inspection.coordinateConvention,
      scanCount: inspection.scanCount,
      image2DCount: inspection.image2DCount,
      pointRecordCount: inspection.pointRecordCount,
      reviewedSweepIndices: inspection.reviewedSweepIndices,
      faceDigests: inspection.faceDigests,
      inspectedAt: inspection.inspectedAt,
    };
    if (inspection.inspectionSha256 !== computeFoundryPhase1E57InspectionSha256(material)) {
      addIssue(ctx, ["inspectionSha256"], "inspectionSha256 must bind the exact E57 inspection");
    }
  });
export type FoundryPhase1E57InspectionV0 = z.infer<
  typeof FoundryPhase1E57InspectionV0Schema
>;

export const FOUNDRY_PHASE1_COLMAP_SOURCE_ROLES = [
  "database",
  "cameras_bin",
  "images_bin",
  "points3d_bin",
  "frames_bin",
  "rigs_bin",
] as const;
export const FoundryPhase1ColmapSourceRoleSchema = z.enum(
  FOUNDRY_PHASE1_COLMAP_SOURCE_ROLES,
);
export const FOUNDRY_PHASE1_COLMAP_SOURCE_PATH_BY_ROLE = {
  database: "database.db",
  cameras_bin: "sparse/0/cameras.bin",
  images_bin: "sparse/0/images.bin",
  points3d_bin: "sparse/0/points3D.bin",
  frames_bin: "sparse/0/frames.bin",
  rigs_bin: "sparse/0/rigs.bin",
} as const satisfies Readonly<Record<
  z.infer<typeof FoundryPhase1ColmapSourceRoleSchema>,
  string
>>;
export const FoundryPhase1ColmapSourceFileSchema = z
  .object({
    role: FoundryPhase1ColmapSourceRoleSchema,
    relativePath: FoundryRelativePathSchema,
    sha256: RuntimeSha256Schema,
    byteLength: z.number().int().safe().positive(),
  })
  .strict()
  .superRefine((file, ctx) => {
    if (file.relativePath !== FOUNDRY_PHASE1_COLMAP_SOURCE_PATH_BY_ROLE[file.role]) {
      addIssue(
        ctx,
        ["relativePath"],
        "COLMAP source role must bind its exact canonical relative path",
      );
    }
  });
export type FoundryPhase1ColmapSourceFile = z.infer<
  typeof FoundryPhase1ColmapSourceFileSchema
>;

const ColmapInspectionMaterialFields = {
  schemaVersion: z.literal(FOUNDRY_PHASE1_COLMAP_INSPECTION_V0),
  inspectionId: RuntimeManifestKeySchema,
  identityReviewSha256: RuntimeSha256Schema,
  sourceFiles: z.array(FoundryPhase1ColmapSourceFileSchema).min(4).max(6),
  imageSetSha256: RuntimeSha256Schema,
  probeOutputSha256: RuntimeSha256Schema,
  readMode: z.literal("read_only"),
  sourceMutationPermitted: z.literal(false),
  binaryEncoding: z
    .object({ format: z.literal("COLMAP sparse binary"), endianness: z.literal("little") })
    .strict(),
  poseConvention: z
    .object({
      qvec: z.literal("hamilton_wxyz_world_to_camera"),
      cameraCenter: z.literal("center=-R^Tt"),
      sourceFrame: z.literal("colmap_world"),
    })
    .strict(),
  scanFilenamePattern: z.literal(
    "scan_<three-decimal-digit-sweep>_<front|back|left|right|up|down>.jpg",
  ),
  scanGrouping: z.literal("strict_filename_then_unweighted_per_sweep_center_mean"),
  databaseImageCount: z.number().int().nonnegative(),
  cameraCount: z.number().int().positive(),
  registeredImageCount: z.number().int().positive(),
  point3DCount: z.number().int().nonnegative(),
  cameraModels: z
    .array(
      z
        .object({
          cameraId: z.number().int().positive(),
          modelName: z.string().trim().min(1).max(80),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          parameters: z.array(z.number().finite()).min(1).max(32),
        })
        .strict(),
    )
    .min(1),
  registeredSweepIndices: z.array(z.number().int().nonnegative()).length(50),
  inspectedAt: FoundryUtcInstantSchema,
} as const;

function validateColmapInspection(
  inspection: {
    sourceFiles: readonly FoundryPhase1ColmapSourceFile[];
    cameraCount: number;
    cameraModels: readonly { cameraId: number }[];
    databaseImageCount: number;
    registeredImageCount: number;
    registeredSweepIndices: readonly number[];
  },
  ctx: z.RefinementCtx,
): void {
  const roles = inspection.sourceFiles.map((file) => file.role);
  const required = ["database", "cameras_bin", "images_bin", "points3d_bin"];
  if (new Set(roles).size !== roles.length || required.some((role) => !roles.includes(role as never))) {
    addIssue(ctx, ["sourceFiles"], "COLMAP sources must uniquely include database and sparse camera/image/point files");
  }
  if (inspection.cameraCount !== inspection.cameraModels.length) {
    addIssue(ctx, ["cameraCount"], "cameraCount must equal cameraModels length");
  }
  if (inspection.registeredImageCount > inspection.databaseImageCount) {
    addIssue(ctx, ["registeredImageCount"], "registered images cannot exceed database images");
  }
  if (!numbersEqual(inspection.registeredSweepIndices, GRAND_HALL_DIAGNOSTIC_REPRODUCTION_SWEEPS)) {
    addIssue(ctx, ["registeredSweepIndices"], "registered sweep groups must be the deterministic 0..49 diagnostic set");
  }
}

export const FoundryPhase1ColmapInspectionMaterialV0Schema = z
  .object(ColmapInspectionMaterialFields)
  .strict()
  .superRefine(validateColmapInspection);
export type FoundryPhase1ColmapInspectionMaterialV0 = z.infer<
  typeof FoundryPhase1ColmapInspectionMaterialV0Schema
>;

export function computeFoundryPhase1ColmapInspectionSha256(
  inspection: FoundryPhase1ColmapInspectionMaterialV0,
): string {
  return digestCanonical(DIGEST_DOMAIN.colmap, FoundryPhase1ColmapInspectionMaterialV0Schema.parse(inspection));
}

export const FoundryPhase1ColmapInspectionV0Schema = z
  .object({ ...ColmapInspectionMaterialFields, inspectionSha256: RuntimeSha256Schema })
  .strict()
  .superRefine((inspection, ctx) => {
    validateColmapInspection(inspection, ctx);
    const material: FoundryPhase1ColmapInspectionMaterialV0 = {
      schemaVersion: inspection.schemaVersion,
      inspectionId: inspection.inspectionId,
      identityReviewSha256: inspection.identityReviewSha256,
      sourceFiles: inspection.sourceFiles,
      imageSetSha256: inspection.imageSetSha256,
      probeOutputSha256: inspection.probeOutputSha256,
      readMode: inspection.readMode,
      sourceMutationPermitted: inspection.sourceMutationPermitted,
      binaryEncoding: inspection.binaryEncoding,
      poseConvention: inspection.poseConvention,
      scanFilenamePattern: inspection.scanFilenamePattern,
      scanGrouping: inspection.scanGrouping,
      databaseImageCount: inspection.databaseImageCount,
      cameraCount: inspection.cameraCount,
      registeredImageCount: inspection.registeredImageCount,
      point3DCount: inspection.point3DCount,
      cameraModels: inspection.cameraModels,
      registeredSweepIndices: inspection.registeredSweepIndices,
      inspectedAt: inspection.inspectedAt,
    };
    if (inspection.inspectionSha256 !== computeFoundryPhase1ColmapInspectionSha256(material)) {
      addIssue(ctx, ["inspectionSha256"], "inspectionSha256 must bind the exact COLMAP inspection");
    }
  });
export type FoundryPhase1ColmapInspectionV0 = z.infer<
  typeof FoundryPhase1ColmapInspectionV0Schema
>;

export const FoundryPhase1ColmapFaceCenterSchema = z
  .object({
    imageName: z.string().regex(/^scan_[0-9]{3}_(?:front|back|left|right|up|down)\.jpg$/u),
    face: FoundryPhase1CubefaceSchema,
    centerColmapWorld: RuntimeVec3Schema,
  })
  .strict();

export const FoundryPhase1SweepCorrespondenceV0Schema = z
  .object({
    correspondenceId: RuntimeManifestKeySchema,
    sweepIndex: z.number().int().min(0).max(49),
    colmapFaceCenters: z.array(FoundryPhase1ColmapFaceCenterSchema).min(1).max(6),
    colmapCenterMean: RuntimeVec3Schema,
    e57GlobalCenterM: RuntimeVec3Schema,
  })
  .strict()
  .superRefine((correspondence, ctx) => {
    const expectedId = `sweep-${String(correspondence.sweepIndex).padStart(3, "0")}`;
    if (correspondence.correspondenceId !== expectedId) {
      addIssue(ctx, ["correspondenceId"], "correspondence ID must be derived from its sweep index");
    }
    const faces = new Set<string>();
    const sum: [number, number, number] = [0, 0, 0];
    for (const [index, faceCenter] of correspondence.colmapFaceCenters.entries()) {
      const match = /^scan_([0-9]{3})_(front|back|left|right|up|down)\.jpg$/u.exec(faceCenter.imageName);
      if (
        match === null ||
        Number(match[1]) !== correspondence.sweepIndex ||
        match[2] !== faceCenter.face ||
        faces.has(faceCenter.face)
      ) {
        addIssue(ctx, ["colmapFaceCenters", index], "COLMAP face names must strictly group once under the declared sweep");
      }
      faces.add(faceCenter.face);
      for (const axis of [0, 1, 2] as const) {
        sum[axis] = sum[axis] + faceCenter.centerColmapWorld[axis];
      }
    }
    const mean = sum.map((value) => value / correspondence.colmapFaceCenters.length);
    if (!vectorsNearlyEqual(correspondence.colmapCenterMean, mean)) {
      addIssue(ctx, ["colmapCenterMean"], "COLMAP sweep center must be the unweighted mean of registered face centers");
    }
  });
export type FoundryPhase1SweepCorrespondenceV0 = z.infer<
  typeof FoundryPhase1SweepCorrespondenceV0Schema
>;

export const FoundryPhase1CorrespondenceResidualV0Schema = z
  .object({
    correspondenceId: RuntimeManifestKeySchema,
    sweepIndex: z.number().int().min(0).max(49),
    predictedE57GlobalM: RuntimeVec3Schema,
    residualVectorM: RuntimeVec3Schema,
    residualMeters: z.number().finite().nonnegative(),
  })
  .strict();
export type FoundryPhase1CorrespondenceResidualV0 = z.infer<
  typeof FoundryPhase1CorrespondenceResidualV0Schema
>;

export const FoundryPhase1ResidualMetricsV0Schema = z
  .object({
    count: z.number().int().positive(),
    meanMeters: z.number().finite().nonnegative(),
    medianMeters: z.number().finite().nonnegative(),
    rmseMeters: z.number().finite().nonnegative(),
    p95Meters: z.number().finite().nonnegative(),
    maxMeters: z.number().finite().nonnegative(),
  })
  .strict();
export type FoundryPhase1ResidualMetricsV0 = z.infer<
  typeof FoundryPhase1ResidualMetricsV0Schema
>;

function linearPercentile(sorted: readonly number[], percentile: number): number {
  const position = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

export function computeFoundryPhase1ResidualMetrics(
  records: readonly FoundryPhase1CorrespondenceResidualV0[],
): FoundryPhase1ResidualMetricsV0 {
  if (records.length === 0) throw new Error("residual metrics require at least one record");
  const values = records.map((record) => record.residualMeters).sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total + value, 0);
  const sumSquares = values.reduce((total, value) => total + value * value, 0);
  return {
    count: values.length,
    meanMeters: sum / values.length,
    medianMeters: linearPercentile(values, 0.5),
    rmseMeters: Math.sqrt(sumSquares / values.length),
    p95Meters: linearPercentile(values, 0.95),
    maxMeters: values.at(-1) ?? 0,
  };
}

const ResidualEvaluationSchema = z
  .object({
    records: z.array(FoundryPhase1CorrespondenceResidualV0Schema).min(1).max(50),
    metrics: FoundryPhase1ResidualMetricsV0Schema,
  })
  .strict()
  .superRefine((evaluation, ctx) => {
    const expected = computeFoundryPhase1ResidualMetrics(evaluation.records);
    for (const key of ["meanMeters", "medianMeters", "rmseMeters", "p95Meters", "maxMeters"] as const) {
      if (!nearlyEqual(evaluation.metrics[key], expected[key])) {
        addIssue(ctx, ["metrics", key], `${key} must be derived from per-correspondence residuals`);
      }
    }
    if (evaluation.metrics.count !== evaluation.records.length) {
      addIssue(ctx, ["metrics", "count"], "metric count must equal residual record count");
    }
  });

const SimilarityTransformSchema = z
  .object({
    matrixColumnMajor: RuntimeTransformMatrix4dSchema,
    scale: z.number().finite().positive(),
    rotationDeterminant: z.number().finite(),
  })
  .strict()
  .superRefine((transform, ctx) => {
    if (!nearlyEqual(transform.rotationDeterminant, 1)) {
      addIssue(ctx, ["rotationDeterminant"], "proper Umeyama rotation determinant must be +1");
    }
    const matrixScale = Math.hypot(
      transform.matrixColumnMajor[0] ?? 0,
      transform.matrixColumnMajor[1] ?? 0,
      transform.matrixColumnMajor[2] ?? 0,
    );
    if (!nearlyEqual(transform.scale, matrixScale)) {
      addIssue(ctx, ["scale"], "declared scale must equal the column-major similarity matrix scale");
    }
  });

const DocumentedDiagnosticSchema = z
  .object({
    scale: z.literal(1.7362602881),
    rmseMeters: z.literal(0.0106706),
    medianMeters: z.literal(0.0061596),
    p95Meters: z.literal(0.0164002),
    maxMeters: z.literal(0.0451409),
    classification: z.literal("prior_unreviewed_diagnostic"),
    roundingTolerances: z
      .object({
        scaleAbsolute: z.literal(5e-10),
        residualMetricAbsoluteMeters: z.literal(5e-8),
      })
      .strict(),
    reproductionStatus: z.literal("matched_within_rounding_tolerance"),
  })
  .strict();

const FullFitResultSchema = z
  .object({
    resultSet: z.literal("documented_full_fit_reproduction"),
    fitSweepIndices: z.array(z.number().int()).length(50),
    transform: SimilarityTransformSchema,
    evaluation: ResidualEvaluationSchema,
    documentedDiagnostic: DocumentedDiagnosticSchema,
  })
  .strict()
  .superRefine((result, ctx) => {
    const diagnostic = result.documentedDiagnostic;
    const matrixScale = Math.hypot(
      result.transform.matrixColumnMajor[0] ?? 0,
      result.transform.matrixColumnMajor[1] ?? 0,
      result.transform.matrixColumnMajor[2] ?? 0,
    );
    if (
      Math.abs(result.transform.scale - diagnostic.scale) >
      diagnostic.roundingTolerances.scaleAbsolute
    ) {
      addIssue(
        ctx,
        ["transform", "scale"],
        "full-fit scale must reproduce the documented diagnostic within rounding tolerance",
      );
    }
    if (
      Math.abs(matrixScale - diagnostic.scale) >
      diagnostic.roundingTolerances.scaleAbsolute
    ) {
      addIssue(
        ctx,
        ["transform", "matrixColumnMajor"],
        "full-fit matrix scale must reproduce the documented diagnostic within rounding tolerance",
      );
    }
    const recomputedMetrics = computeFoundryPhase1ResidualMetrics(result.evaluation.records);
    const metricComparisons = [
      ["rmseMeters", recomputedMetrics.rmseMeters, diagnostic.rmseMeters],
      ["medianMeters", recomputedMetrics.medianMeters, diagnostic.medianMeters],
      ["p95Meters", recomputedMetrics.p95Meters, diagnostic.p95Meters],
      ["maxMeters", recomputedMetrics.maxMeters, diagnostic.maxMeters],
    ] as const;
    for (const [key, actual, expected] of metricComparisons) {
      if (
        Math.abs(actual - expected) >
        diagnostic.roundingTolerances.residualMetricAbsoluteMeters
      ) {
        addIssue(
          ctx,
          ["evaluation", "metrics", key],
          `${key} must reproduce the documented diagnostic within rounding tolerance`,
        );
      }
    }
  });

const CandidateResultSchema = z
  .object({
    resultSet: z.literal("phase1_candidate_with_frozen_holdout"),
    candidateSweepIndices: z.array(z.number().int()).length(49),
    fitSweepIndices: z.array(z.number().int()).length(44),
    holdoutSweepIndices: z.array(z.number().int()).length(5),
    excludedSweeps: z.tuple([
      z
        .object({
          sweepIndex: z.literal(49),
          disposition: z.literal("excluded_adjacent_space"),
          use: z.literal("reproduction_only"),
        })
        .strict(),
    ]),
    transform: SimilarityTransformSchema,
    fitEvaluation: ResidualEvaluationSchema,
    holdoutEvaluation: ResidualEvaluationSchema,
    candidateEvaluation: ResidualEvaluationSchema,
  })
  .strict();

export const FoundryPhase1AlignmentConventionsV0Schema = z
  .object({
    e57Frame: z.literal("e57_global_metres_z_up"),
    e57Axes: z.literal("right_handed_xyz_z_up"),
    colmapPose: z.literal("qvec_hamilton_wxyz_world_to_camera"),
    colmapCameraAxes: z.literal("right_down_forward"),
    colmapWorldAxes: z.literal("arbitrary_right_handed_sfm_world"),
    colmapCameraCenter: z.literal("center=-R^Tt"),
    scanGrouping: z.literal("strict_scan_filename"),
    sweepAggregation: z.literal("unweighted_per_sweep_center_mean"),
    sweepWeighting: z.literal("one_equal_weight_per_sweep_not_per_image"),
    similarityMethod: z.literal("proper_isotropic_umeyama_det_plus_one"),
    reflectionPolicy: z.literal("forbidden_rotation_determinant_plus_one"),
    transformDirection: z.literal("colmap_world_to_e57_global"),
    matrixLayout: z.literal("4x4_column_major"),
    vectorConvention: z.literal("column_vector_target_equals_matrix_times_source"),
    residualUnits: z.literal("meters"),
    percentileMethod: z.literal("linear"),
    robustLoss: z.literal("none"),
    outlierRejection: z.literal("none"),
  })
  .strict();

export const FoundryPhase1AlignmentLimitationsV0Schema = z
  .object({
    geometricCloudOverlap: z.literal("not_computed"),
    independentSurveyedControl: z.literal("absent"),
    metricClassification: z.literal("internal_self_consistency_only"),
    sharedLineageRisk: z.literal("colmap_images_and_e57_centres_share_the_same_e57_export_lineage"),
    imagePixelTrainEvalSplit: z.literal("none_no_image_training_or_pixel_evaluation_performed"),
    identitySweepRole: z.literal("human_room_identity_review_inputs_not_alignment_evaluation_split"),
    runtimeOrPublicAuthority: z.literal("none_pending_independent_control_and_human_transform_review"),
  })
  .strict();

const ResidualReportMaterialFields = {
  schemaVersion: z.literal(FOUNDRY_PHASE1_RESIDUAL_REPORT_V0),
  reportId: RuntimeManifestKeySchema,
  identityReviewSha256: RuntimeSha256Schema,
  e57InspectionSha256: RuntimeSha256Schema,
  colmapInspectionSha256: RuntimeSha256Schema,
  sourceE57Sha256: RuntimeSha256Schema,
  colmapSourceFiles: z.array(FoundryPhase1ColmapSourceFileSchema).min(4).max(6),
  alignmentProbeOutputSha256: RuntimeSha256Schema,
  conventions: FoundryPhase1AlignmentConventionsV0Schema,
  limitations: FoundryPhase1AlignmentLimitationsV0Schema,
  correspondences: z.array(FoundryPhase1SweepCorrespondenceV0Schema).length(50),
  fullFit: FullFitResultSchema,
  phase1CandidateWithHoldout: CandidateResultSchema,
  generatedAt: FoundryUtcInstantSchema,
} as const;

function applyColumnMajor(matrix: readonly number[], point: readonly number[]): [number, number, number] {
  return [
    (matrix[0] ?? 0) * (point[0] ?? 0) + (matrix[4] ?? 0) * (point[1] ?? 0) + (matrix[8] ?? 0) * (point[2] ?? 0) + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * (point[0] ?? 0) + (matrix[5] ?? 0) * (point[1] ?? 0) + (matrix[9] ?? 0) * (point[2] ?? 0) + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * (point[0] ?? 0) + (matrix[6] ?? 0) * (point[1] ?? 0) + (matrix[10] ?? 0) * (point[2] ?? 0) + (matrix[14] ?? 0),
  ];
}

function validateEvaluation(
  label: string,
  evaluation: z.infer<typeof ResidualEvaluationSchema>,
  expectedSweeps: readonly number[],
  transform: z.infer<typeof SimilarityTransformSchema>,
  correspondences: ReadonlyMap<string, FoundryPhase1SweepCorrespondenceV0>,
  ctx: z.RefinementCtx,
): void {
  const sweeps = evaluation.records.map((record) => record.sweepIndex);
  if (!numbersEqual(sweeps, expectedSweeps)) {
    addIssue(ctx, [label, "records"], `${label} residual records must match the frozen ordered sweep partition`);
  }
  const seen = new Set<string>();
  for (const [index, record] of evaluation.records.entries()) {
    const correspondence = correspondences.get(record.correspondenceId);
    if (correspondence === undefined || correspondence.sweepIndex !== record.sweepIndex || seen.has(record.correspondenceId)) {
      addIssue(ctx, [label, "records", index], "residual must uniquely reference its matching correspondence");
      continue;
    }
    seen.add(record.correspondenceId);
    const predicted = applyColumnMajor(transform.matrixColumnMajor, correspondence.colmapCenterMean);
    const residualVector = predicted.map(
      (value, axis) => value - (correspondence.e57GlobalCenterM[axis] ?? 0),
    );
    const residualMeters = Math.hypot(...residualVector);
    if (!vectorsNearlyEqual(record.predictedE57GlobalM, predicted)) {
      addIssue(ctx, [label, "records", index, "predictedE57GlobalM"], "prediction must use the declared column-major transform");
    }
    if (!vectorsNearlyEqual(record.residualVectorM, residualVector)) {
      addIssue(ctx, [label, "records", index, "residualVectorM"], "residual vector must equal predicted minus E57 target");
    }
    if (!nearlyEqual(record.residualMeters, residualMeters)) {
      addIssue(ctx, [label, "records", index, "residualMeters"], "residual norm must match the declared vector");
    }
  }
}

function validateResidualReport(
  report: z.infer<z.ZodObject<typeof ResidualReportMaterialFields>>,
  ctx: z.RefinementCtx,
): void {
  const correspondenceSweeps = report.correspondences.map((entry) => entry.sweepIndex);
  if (!numbersEqual(correspondenceSweeps, GRAND_HALL_DIAGNOSTIC_REPRODUCTION_SWEEPS)) {
    addIssue(ctx, ["correspondences"], "correspondences must be the ordered diagnostic sweeps 0..49");
  }
  const byId = new Map(report.correspondences.map((entry) => [entry.correspondenceId, entry]));
  if (byId.size !== report.correspondences.length) {
    addIssue(ctx, ["correspondences"], "correspondence IDs must be unique");
  }
  if (!numbersEqual(report.fullFit.fitSweepIndices, GRAND_HALL_DIAGNOSTIC_REPRODUCTION_SWEEPS)) {
    addIssue(ctx, ["fullFit", "fitSweepIndices"], "full fit must reproduce sweeps 0..49");
  }
  const candidate = report.phase1CandidateWithHoldout;
  if (!numbersEqual(candidate.candidateSweepIndices, GRAND_HALL_PHASE1_CANDIDATE_SWEEPS)) {
    addIssue(ctx, ["phase1CandidateWithHoldout", "candidateSweepIndices"], "candidate sweeps must be 0..48");
  }
  if (!numbersEqual(candidate.fitSweepIndices, GRAND_HALL_PHASE1_FIT_SWEEPS)) {
    addIssue(ctx, ["phase1CandidateWithHoldout", "fitSweepIndices"], "candidate fit must contain the frozen 44-sweep partition");
  }
  if (!numbersEqual(candidate.holdoutSweepIndices, GRAND_HALL_PHASE1_FROZEN_HOLDOUT_SWEEPS)) {
    addIssue(ctx, ["phase1CandidateWithHoldout", "holdoutSweepIndices"], "candidate holdout must be [5,15,25,35,44]");
  }
  validateEvaluation("fullFit.evaluation", report.fullFit.evaluation, GRAND_HALL_DIAGNOSTIC_REPRODUCTION_SWEEPS, report.fullFit.transform, byId, ctx);
  validateEvaluation("phase1CandidateWithHoldout.fitEvaluation", candidate.fitEvaluation, GRAND_HALL_PHASE1_FIT_SWEEPS, candidate.transform, byId, ctx);
  validateEvaluation("phase1CandidateWithHoldout.holdoutEvaluation", candidate.holdoutEvaluation, GRAND_HALL_PHASE1_FROZEN_HOLDOUT_SWEEPS, candidate.transform, byId, ctx);
  validateEvaluation("phase1CandidateWithHoldout.candidateEvaluation", candidate.candidateEvaluation, GRAND_HALL_PHASE1_CANDIDATE_SWEEPS, candidate.transform, byId, ctx);
}

export const FoundryPhase1ResidualReportMaterialV0Schema = z
  .object(ResidualReportMaterialFields)
  .strict()
  .superRefine(validateResidualReport);
export type FoundryPhase1ResidualReportMaterialV0 = z.infer<
  typeof FoundryPhase1ResidualReportMaterialV0Schema
>;

export function computeFoundryPhase1ResidualReportSha256(
  report: FoundryPhase1ResidualReportMaterialV0,
): string {
  return digestCanonical(DIGEST_DOMAIN.residual, FoundryPhase1ResidualReportMaterialV0Schema.parse(report));
}

export const FoundryPhase1ResidualReportV0Schema = z
  .object({ ...ResidualReportMaterialFields, reportSha256: RuntimeSha256Schema })
  .strict()
  .superRefine((report, ctx) => {
    validateResidualReport(report, ctx);
    const material: FoundryPhase1ResidualReportMaterialV0 = {
      schemaVersion: report.schemaVersion,
      reportId: report.reportId,
      identityReviewSha256: report.identityReviewSha256,
      e57InspectionSha256: report.e57InspectionSha256,
      colmapInspectionSha256: report.colmapInspectionSha256,
      sourceE57Sha256: report.sourceE57Sha256,
      colmapSourceFiles: report.colmapSourceFiles,
      alignmentProbeOutputSha256: report.alignmentProbeOutputSha256,
      conventions: report.conventions,
      limitations: report.limitations,
      correspondences: report.correspondences,
      fullFit: report.fullFit,
      phase1CandidateWithHoldout: report.phase1CandidateWithHoldout,
      generatedAt: report.generatedAt,
    };
    if (report.reportSha256 !== computeFoundryPhase1ResidualReportSha256(material)) {
      addIssue(ctx, ["reportSha256"], "reportSha256 must bind the exact residual report");
    }
  });
export type FoundryPhase1ResidualReportV0 = z.infer<
  typeof FoundryPhase1ResidualReportV0Schema
>;

export const FoundryPhase1LicenceGateSchema = z
  .object({
    gate: z.enum([
      "matterport_internal_processing",
      "matterport_model_training",
      "xgrids_proprietary_payload",
      "public_release",
    ]),
    decision: z.enum(["unresolved", "cleared_for_read_only_phase1", "blocked_out_of_scope"]),
    evidenceSha256: RuntimeSha256Schema.nullable(),
    note: z.string().trim().min(1).max(500),
  })
  .strict();

const TransformProposalMaterialFields = {
  schemaVersion: z.literal(FOUNDRY_PHASE1_TRANSFORM_PROPOSAL_V0),
  proposalId: RuntimeManifestKeySchema,
  state: z.literal("proposed"),
  identityReviewSha256: RuntimeSha256Schema,
  ingestManifestSha256: RuntimeSha256Schema,
  e57InspectionSha256: RuntimeSha256Schema,
  colmapInspectionSha256: RuntimeSha256Schema,
  residualReportSha256: RuntimeSha256Schema,
  sourceE57Sha256: RuntimeSha256Schema,
  colmapSourceFiles: z.array(FoundryPhase1ColmapSourceFileSchema).min(4).max(6),
  sourceFrame: z.literal("COLMAP_WORLD"),
  targetFrame: z.literal("E57_GLOBAL"),
  units: z.literal("meters"),
  alignmentMethod: z.literal("proper_isotropic_umeyama"),
  conventions: FoundryPhase1AlignmentConventionsV0Schema,
  selectedResultSet: z.literal("phase1_candidate_with_frozen_holdout"),
  fitSweepIndices: z.array(z.number().int()).length(44),
  holdoutSweepIndices: z.array(z.number().int()).length(5),
  excludedSweeps: z.tuple([
    z
      .object({
        sweepIndex: z.literal(49),
        disposition: z.literal("excluded_adjacent_space"),
        use: z.literal("reproduction_only"),
      })
      .strict(),
  ]),
  matrix: RuntimeTransformMatrix4dSchema,
  scale: z.number().finite().positive(),
  residualMetrics: z
    .object({
      fit: FoundryPhase1ResidualMetricsV0Schema,
      holdout: FoundryPhase1ResidualMetricsV0Schema,
      candidate: FoundryPhase1ResidualMetricsV0Schema,
    })
    .strict(),
  licenceGates: z.array(FoundryPhase1LicenceGateSchema).length(4),
  reviewer: z.null(),
  reviewerAttestationSha256: z.null(),
  authority: z
    .object({ public: z.literal("none"), runtime: z.literal("none") })
    .strict(),
  proposedAt: FoundryUtcInstantSchema,
} as const;

function validateTransformProposal(
  proposal: z.infer<z.ZodObject<typeof TransformProposalMaterialFields>>,
  ctx: z.RefinementCtx,
): void {
  const matrixScale = Math.hypot(
    proposal.matrix[0] ?? 0,
    proposal.matrix[1] ?? 0,
    proposal.matrix[2] ?? 0,
  );
  if (!nearlyEqual(proposal.scale, matrixScale)) {
    addIssue(ctx, ["scale"], "proposal scale must equal its column-major similarity matrix scale");
  }
  if (!numbersEqual(proposal.fitSweepIndices, GRAND_HALL_PHASE1_FIT_SWEEPS)) {
    addIssue(ctx, ["fitSweepIndices"], "proposal must bind the frozen 44-sweep fit partition");
  }
  if (!numbersEqual(proposal.holdoutSweepIndices, GRAND_HALL_PHASE1_FROZEN_HOLDOUT_SWEEPS)) {
    addIssue(ctx, ["holdoutSweepIndices"], "proposal must bind the frozen five-sweep holdout");
  }
  const gates = proposal.licenceGates.map((gate) => gate.gate);
  const expectedGates = [
    "matterport_internal_processing",
    "matterport_model_training",
    "xgrids_proprietary_payload",
    "public_release",
  ];
  if (gates.some((gate, index) => gate !== expectedGates[index])) {
    addIssue(ctx, ["licenceGates"], "licence gates must use the complete canonical ordering");
  }
  for (const [index, gate] of proposal.licenceGates.entries()) {
    if (
      gate.gate !== "matterport_internal_processing" &&
      gate.decision !== "blocked_out_of_scope"
    ) {
      addIssue(ctx, ["licenceGates", index, "decision"], "training, proprietary payload, and publication remain blocked in phase one");
    }
  }
}

export const FoundryPhase1TransformProposalMaterialV0Schema = z
  .object(TransformProposalMaterialFields)
  .strict()
  .superRefine(validateTransformProposal);
export type FoundryPhase1TransformProposalMaterialV0 = z.infer<
  typeof FoundryPhase1TransformProposalMaterialV0Schema
>;

export function computeFoundryPhase1TransformProposalSha256(
  proposal: FoundryPhase1TransformProposalMaterialV0,
): string {
  return digestCanonical(DIGEST_DOMAIN.proposal, FoundryPhase1TransformProposalMaterialV0Schema.parse(proposal));
}

export const FoundryPhase1TransformProposalV0Schema = z
  .object({ ...TransformProposalMaterialFields, proposalSha256: RuntimeSha256Schema })
  .strict()
  .superRefine((proposal, ctx) => {
    validateTransformProposal(proposal, ctx);
    const material: FoundryPhase1TransformProposalMaterialV0 = {
      schemaVersion: proposal.schemaVersion,
      proposalId: proposal.proposalId,
      state: proposal.state,
      identityReviewSha256: proposal.identityReviewSha256,
      ingestManifestSha256: proposal.ingestManifestSha256,
      e57InspectionSha256: proposal.e57InspectionSha256,
      colmapInspectionSha256: proposal.colmapInspectionSha256,
      residualReportSha256: proposal.residualReportSha256,
      sourceE57Sha256: proposal.sourceE57Sha256,
      colmapSourceFiles: proposal.colmapSourceFiles,
      sourceFrame: proposal.sourceFrame,
      targetFrame: proposal.targetFrame,
      units: proposal.units,
      alignmentMethod: proposal.alignmentMethod,
      conventions: proposal.conventions,
      selectedResultSet: proposal.selectedResultSet,
      fitSweepIndices: proposal.fitSweepIndices,
      holdoutSweepIndices: proposal.holdoutSweepIndices,
      excludedSweeps: proposal.excludedSweeps,
      matrix: proposal.matrix,
      scale: proposal.scale,
      residualMetrics: proposal.residualMetrics,
      licenceGates: proposal.licenceGates,
      reviewer: proposal.reviewer,
      reviewerAttestationSha256: proposal.reviewerAttestationSha256,
      authority: proposal.authority,
      proposedAt: proposal.proposedAt,
    };
    if (proposal.proposalSha256 !== computeFoundryPhase1TransformProposalSha256(material)) {
      addIssue(ctx, ["proposalSha256"], "proposalSha256 must bind the exact transform proposal");
    }
  });
export type FoundryPhase1TransformProposalV0 = z.infer<
  typeof FoundryPhase1TransformProposalV0Schema
>;

function sameSourceFiles(
  left: readonly FoundryPhase1ColmapSourceFile[],
  right: readonly FoundryPhase1ColmapSourceFile[],
): boolean {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(left)) ===
    stableCanonicalJson(CanonicalJsonValueSchema.parse(right));
}

export const FoundryPhase1BundleV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PHASE1_BUNDLE_V0),
    ingestManifestSha256: RuntimeSha256Schema,
    identityReview: FoundryPhase1IdentityReviewV0Schema,
    e57Inspection: FoundryPhase1E57InspectionV0Schema,
    colmapInspection: FoundryPhase1ColmapInspectionV0Schema,
    residualReport: FoundryPhase1ResidualReportV0Schema,
    transformProposal: FoundryPhase1TransformProposalV0Schema,
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const reviewSha = bundle.identityReview.reviewSha256;
    if (
      bundle.e57Inspection.identityReviewSha256 !== reviewSha ||
      bundle.colmapInspection.identityReviewSha256 !== reviewSha ||
      bundle.residualReport.identityReviewSha256 !== reviewSha ||
      bundle.transformProposal.identityReviewSha256 !== reviewSha
    ) {
      addIssue(ctx, ["identityReview"], "every downstream artifact must bind the exact identity review digest");
    }
    if (bundle.identityReview.sourceE57Sha256 !== bundle.e57Inspection.sourceE57Sha256 ||
      bundle.e57Inspection.sourceE57Sha256 !== bundle.residualReport.sourceE57Sha256 ||
      bundle.residualReport.sourceE57Sha256 !== bundle.transformProposal.sourceE57Sha256) {
      addIssue(ctx, ["e57Inspection", "sourceE57Sha256"], "every artifact must bind the same E57 source digest");
    }
    const reviewFaces = stableCanonicalJson(CanonicalJsonValueSchema.parse(bundle.identityReview.faceDigests));
    const inspectionFaces = stableCanonicalJson(CanonicalJsonValueSchema.parse(bundle.e57Inspection.faceDigests));
    if (reviewFaces !== inspectionFaces) {
      addIssue(ctx, ["e57Inspection", "faceDigests"], "E57 inspection must bind the exact 30 reviewed face digests");
    }
    if (
      bundle.residualReport.e57InspectionSha256 !== bundle.e57Inspection.inspectionSha256 ||
      bundle.transformProposal.e57InspectionSha256 !== bundle.e57Inspection.inspectionSha256 ||
      bundle.residualReport.colmapInspectionSha256 !== bundle.colmapInspection.inspectionSha256 ||
      bundle.transformProposal.colmapInspectionSha256 !== bundle.colmapInspection.inspectionSha256
    ) {
      addIssue(ctx, ["residualReport"], "residual and proposal artifacts must bind both inspection digests");
    }
    if (!sameSourceFiles(bundle.colmapInspection.sourceFiles, bundle.residualReport.colmapSourceFiles) ||
      !sameSourceFiles(bundle.colmapInspection.sourceFiles, bundle.transformProposal.colmapSourceFiles)) {
      addIssue(ctx, ["colmapInspection", "sourceFiles"], "every artifact must bind the exact COLMAP source files");
    }
    const candidate = bundle.residualReport.phase1CandidateWithHoldout;
    if (
      bundle.transformProposal.residualReportSha256 !== bundle.residualReport.reportSha256 ||
      bundle.transformProposal.ingestManifestSha256 !== bundle.ingestManifestSha256 ||
      !vectorsNearlyEqual(bundle.transformProposal.matrix, candidate.transform.matrixColumnMajor) ||
      !nearlyEqual(bundle.transformProposal.scale, candidate.transform.scale)
    ) {
      addIssue(ctx, ["transformProposal"], "proposal must bind the manifest and exact candidate residual result");
    }
    const metrics = bundle.transformProposal.residualMetrics;
    const expectedMetrics = [
      [metrics.fit, candidate.fitEvaluation.metrics],
      [metrics.holdout, candidate.holdoutEvaluation.metrics],
      [metrics.candidate, candidate.candidateEvaluation.metrics],
    ] as const;
    if (expectedMetrics.some(([left, right]) =>
      stableCanonicalJson(CanonicalJsonValueSchema.parse(left)) !==
      stableCanonicalJson(CanonicalJsonValueSchema.parse(right)))) {
      addIssue(ctx, ["transformProposal", "residualMetrics"], "proposal metrics must exactly match the candidate report");
    }
  });
export type FoundryPhase1BundleV0 = z.infer<typeof FoundryPhase1BundleV0Schema>;

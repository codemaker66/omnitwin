import { RuntimeManifestKeySchema, RuntimeSha256Schema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS,
  FoundryE57GeometryCropArtifactV0Schema,
  type FoundryE57GeometryCropArtifactV0,
} from "./e57-geometry-worker.js";
import {
  FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
  FoundryMetricRegistrationProposalV0Schema,
  type FoundryMetricRegistrationProposalV0,
} from "./metric-registration-proposal.js";
import {
  FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES,
  FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS,
  FoundryE57PointClassificationMaskV0Schema,
  verifyFoundryE57PointClassificationMaskV0,
  type FoundryE57PointClassificationMaskV0,
} from "./e57-point-classification-mask.js";

/**
 * A bounded transformed point union for local comparison and later review.
 * It is deliberately not a mesh, mask, TransformArtifact, Scene Authority Map,
 * placement surface, package member, or runtime asset.
 */
export const FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_INPUT_V0 =
  "omnitwin.foundry.bounded-point-source-fusion-input.v0";
export const FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_V0 =
  "omnitwin.foundry.bounded-point-source-fusion.v0";
export const FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES = 8;
export const FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS = 250_000;
export const FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_ABS_METERS = 1_000_000_000;

const SOURCE_FRAME_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_CROP_METRIC_FRAME_BINDING_V0";
const SOURCE_POINT_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_CROP_METRIC_POINT_BINDING_V0";
const FUSION_INPUT_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_INPUT_V0";
const FUSION_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_V0";
const SOURCE_AXIS_CONVENTION =
  "foundry e57 root; right-handed xyz; z up; metres";
const E57_SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const RUNTIME_MANIFEST_KEY = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const BOUNDED_SHAPE_REJECTION = "omnitwin.foundry.bounded-shape-rejected";
const BoundedShapeRejectionSchema = z
  .literal(BOUNDED_SHAPE_REJECTION)
  .refine((_value): _value is never => false, {
    message: "a bounded fusion array limit was exceeded",
  });

const RELEASE_BLOCKERS = [
  "EXACT_MEMBER_IDENTITIES_UNVERIFIED",
  "HUMAN_FUSION_REVIEW_REQUIRED",
  "MOVABLE_OBJECT_CLASSIFICATION_UNVERIFIED",
  "PRIVACY_REVIEW_REQUIRED",
  "QA_APPROVAL_REQUIRED",
  "REVIEWED_TRANSFORM_ARTIFACT_REQUIRED",
  "SCENE_AUTHORITY_MAP_REQUIRED",
  "SOURCE_OVERLAP_NOT_COMPUTED",
] as const;
const CONDITIONAL_RELEASE_BLOCKERS = [
  "AUTHORED_POINT_CLASSIFICATION_REVIEW_REQUIRED",
  "EXACT_POINT_MASK_ARTIFACT_REQUIRED",
] as const;
const ReleaseBlockerSchema = z.enum([
  ...RELEASE_BLOCKERS,
  ...CONDITIONAL_RELEASE_BLOCKERS,
]);

type Vec3 = readonly [number, number, number];

const BoundedMetricCoordinateSchema = z
  .number()
  .finite()
  .min(-FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_ABS_METERS)
  .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_ABS_METERS);
const BoundedMetricVec3Schema = z.tuple([
  BoundedMetricCoordinateSchema,
  BoundedMetricCoordinateSchema,
  BoundedMetricCoordinateSchema,
]);
const BoundsSchema = z
  .object({
    minimum: BoundedMetricVec3Schema,
    maximum: BoundedMetricVec3Schema,
  })
  .strict()
  .superRefine((bounds, ctx) => {
    for (const axis of [0, 1, 2] as const) {
      if (bounds.minimum[axis] > bounds.maximum[axis]) {
        addIssue(
          ctx,
          ["minimum", axis],
          "bounds minimum cannot exceed maximum",
        );
      }
    }
  });

const MetricFrameBindingSchema = z
  .object({
    frameId: RuntimeManifestKeySchema,
    frameSha256: RuntimeSha256Schema,
    units: z.literal("meters"),
    handedness: z.literal("right"),
    upAxis: z.literal("z"),
    axisConvention: z.string().trim().min(1).max(240),
  })
  .strict();

export const FoundryMetricTargetBindingV0Schema = z
  .object({
    rootId: RuntimeManifestKeySchema,
    rootSha256: RuntimeSha256Schema,
    frame: MetricFrameBindingSchema,
  })
  .strict();
export type FoundryMetricTargetBindingV0 = z.infer<
  typeof FoundryMetricTargetBindingV0Schema
>;

export const FoundryE57CropMetricRegistrationSourceV0Schema = z
  .object({
    rootId: RuntimeManifestKeySchema,
    rootSha256: RuntimeSha256Schema,
    frame: MetricFrameBindingSchema.extend({
      axisConvention: z.literal(SOURCE_AXIS_CONVENTION),
    }).strict(),
  })
  .strict();
export type FoundryE57CropMetricRegistrationSourceV0 = z.infer<
  typeof FoundryE57CropMetricRegistrationSourceV0Schema
>;

export const FoundryE57CropMetricRegistrationPointV0Schema = z
  .object({
    pointId: RuntimeManifestKeySchema,
    evidenceSha256: RuntimeSha256Schema,
    coordinates: BoundedMetricVec3Schema,
  })
  .strict();
export type FoundryE57CropMetricRegistrationPointV0 = z.infer<
  typeof FoundryE57CropMetricRegistrationPointV0Schema
>;

const PointSelectorSchema = z
  .object({
    scanIndex: z.number().int().nonnegative(),
    sourcePointIndex: z.number().int().safe().nonnegative(),
  })
  .strict();

const FusionSourceInputSchema = z
  .object({
    artifact: FoundryE57GeometryCropArtifactV0Schema,
    registrationProposal: FoundryMetricRegistrationProposalV0Schema,
    pointClassificationMask:
      FoundryE57PointClassificationMaskV0Schema.optional(),
  })
  .strict();

const FoundryBoundedPointSourceFusionInputObjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_INPUT_V0),
    target: FoundryMetricTargetBindingV0Schema,
    sources: z
      .array(FusionSourceInputSchema)
      .min(2)
      .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES),
  })
  .strict();
export const FoundryBoundedPointSourceFusionInputV0Schema = z.preprocess(
  rejectOversizedFusionInput,
  z.union([
    FoundryBoundedPointSourceFusionInputObjectV0Schema,
    BoundedShapeRejectionSchema,
  ]),
);
export type FoundryBoundedPointSourceFusionInputV0 = z.infer<
  typeof FoundryBoundedPointSourceFusionInputV0Schema
>;

const FusionMatrixSchema = z
  .array(
    z
      .number()
      .finite()
      .min(-10_000_000_000_000_000_000)
      .max(10_000_000_000_000_000_000),
  )
  .length(16);

const FusionSourceLineageSchema = z
  .object({
    sourceOrder: z
      .number()
      .int()
      .nonnegative()
      .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES - 1),
    sourceId: RuntimeManifestKeySchema,
    artifactSha256: RuntimeSha256Schema,
    invocationSha256: RuntimeSha256Schema,
    finalCheckpointSha256: RuntimeSha256Schema,
    sourceAssetId: z.string().regex(E57_SOURCE_ID),
    sourceAssetSha256: RuntimeSha256Schema,
    sourceAssetRelativePath: z.string().min(1).max(4_096),
    sourceFactsArtifactSha256: RuntimeSha256Schema,
    readerDescriptionSha256: RuntimeSha256Schema,
    artifactPointCount: z
      .number()
      .int()
      .positive()
      .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS),
    fusedPointCount: z
      .number()
      .int()
      .positive()
      .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS),
    excludedPointCounts: z
      .object({
        capturedMovableVisual: z
          .number()
          .int()
          .nonnegative()
          .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS),
        privacy: z
          .number()
          .int()
          .nonnegative()
          .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS),
      })
      .strict(),
    artifactBoundsM: BoundsSchema,
    retainedSourceBoundsM: BoundsSchema,
    targetBoundsM: BoundsSchema,
    registration: z
      .object({
        proposalId: RuntimeManifestKeySchema,
        proposalSha256: RuntimeSha256Schema,
        registrationInputSha256: RuntimeSha256Schema,
        source: FoundryE57CropMetricRegistrationSourceV0Schema,
        target: FoundryMetricTargetBindingV0Schema,
        method: z.literal("proper_3d_similarity_horn_jacobi"),
        transformDirection: z.literal("source_to_target"),
        vectorConvention: z.literal(
          "column_vector_target_equals_matrix_times_source",
        ),
        matrixLayout: z.literal("4x4_column_major"),
        matrixColumnMajor: FusionMatrixSchema,
        fitCorrespondenceCount: z.number().int().min(4).max(4_095),
        heldOutCorrespondenceCount: z.number().int().min(1).max(4_092),
        fitRmseM: z.number().finite().nonnegative(),
        heldOutRmseM: z.number().finite().nonnegative(),
        controlPointBinding: z.literal(
          "every_source_control_matches_exact_crop_point_id_digest_and_coordinate",
        ),
        sourceOverlap: z.literal("not_computed"),
        reviewedTransformArtifact: z.literal("not_created"),
        authority: z.literal("none"),
      })
      .strict(),
    masking: z
      .object({
        status: z.enum([
          "not_performed",
          "exact_operator_draft_applied",
        ]),
        exactPointMaskArtifactSha256: RuntimeSha256Schema.nullable(),
        classificationAuthority: z.enum([
          "none",
          "caller_supplied_unverified",
        ]),
        reviewStatus: z.enum(["not_applicable", "not_reviewed"]),
        retainedContentClassification: z.literal(
          "unclassified_static_candidate",
        ),
        excludedPoints: z.literal("omitted_before_metric_transform"),
        authority: z.literal("none"),
      })
      .strict()
      .superRefine((masking, ctx) => {
        const applied = masking.status === "exact_operator_draft_applied";
        if (
          (applied &&
            (masking.exactPointMaskArtifactSha256 === null ||
              masking.classificationAuthority !==
                "caller_supplied_unverified" ||
              masking.reviewStatus !== "not_reviewed")) ||
          (!applied &&
            (masking.exactPointMaskArtifactSha256 !== null ||
              masking.classificationAuthority !== "none" ||
              masking.reviewStatus !== "not_applicable"))
        ) {
          addIssue(
            ctx,
            [],
            "source masking metadata must match exact mask application status",
          );
        }
      }),
    authority: z.literal("none"),
  })
  .strict()
  .superRefine((source, ctx) => {
    if (
      source.artifactPointCount !==
        source.fusedPointCount +
          source.excludedPointCounts.capturedMovableVisual +
          source.excludedPointCounts.privacy ||
      (source.masking.status === "not_performed" &&
        (source.excludedPointCounts.capturedMovableVisual !== 0 ||
          source.excludedPointCounts.privacy !== 0))
    ) {
      addIssue(
        ctx,
        ["excludedPointCounts"],
        "source point counts must form one complete exact crop partition",
      );
    }
  });

const FusionPointSchema = z
  .object({
    sourceOrder: z
      .number()
      .int()
      .nonnegative()
      .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES - 1),
    sourceId: RuntimeManifestKeySchema,
    sourcePointOrder: z
      .number()
      .int()
      .safe()
      .nonnegative()
      .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS - 1),
    scanIndex: z.number().int().nonnegative(),
    data3dGuid: z.string().min(1).max(512),
    sourcePointIndex: z.number().int().safe().nonnegative(),
    sourceCoordinatesM: BoundedMetricVec3Schema,
    targetCoordinatesM: BoundedMetricVec3Schema,
    classificationMaskPointId: RuntimeManifestKeySchema.nullable(),
    contentClassification: z.literal("unclassified_static_candidate"),
    authority: z.literal("none"),
  })
  .strict();

const FusionPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_V0),
    status: z.literal("local_unreviewed_fusion_candidate"),
    fusionInputSha256: RuntimeSha256Schema,
    target: FoundryMetricTargetBindingV0Schema,
    fusionMethod: z.literal(
      "transformed_stable_point_union_without_deduplication",
    ),
    stableOrdering: z.literal(
      "artifact_sha256_then_artifact_source_point_order",
    ),
    sources: z
      .array(FusionSourceLineageSchema)
      .min(2)
      .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES),
    points: z
      .array(FusionPointSchema)
      .min(2)
      .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS),
    pointCounts: z
      .object({
        sources: z
          .number()
          .int()
          .min(2)
          .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES),
        sourceCropPoints: z
          .number()
          .int()
          .positive()
          .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS),
        capturedMovableVisualExcluded: z
          .number()
          .int()
          .nonnegative()
          .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS),
        privacyExcluded: z
          .number()
          .int()
          .nonnegative()
          .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS),
        fused: z
          .number()
          .int()
          .positive()
          .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS),
      })
      .strict(),
    outputBoundsM: BoundsSchema,
    sourceOverlap: z
      .object({
        status: z.literal("not_computed"),
        deduplication: z.literal("not_performed"),
      })
      .strict(),
    masking: z
      .object({
        coverage: z.enum(["none", "some_sources", "all_sources"]),
        visualReviewDraftUse: z.literal("not_accepted_as_exact_point_mask"),
        sourceOrderedExactPointMaskArtifactSha256s: z
          .array(RuntimeSha256Schema)
          .max(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES),
        classificationAuthority: z.enum([
          "none",
          "caller_supplied_unverified",
        ]),
        retainedPointClassification: z.literal(
          "unclassified_static_candidate_non_authoritative",
        ),
        excludedPointDisposition: z.literal("omitted_from_fusion"),
        unmaskedSourceContent: z.enum([
          "possible_movable_or_privacy_content_retained",
          "none",
        ]),
        authority: z.literal("none"),
      })
      .strict(),
    packageCompatibility: z
      .object({
        roomRealityPackageAssembly: z.literal("not_created"),
        representationEligibility: z.literal("blocked"),
        exactMemberIdentities: z.literal("not_verified"),
        movableObjectClassification: z.literal("not_verified"),
      })
      .strict(),
    execution: z
      .object({
        mode: z.literal("pure_deterministic_in_memory_compile"),
        interruptionResume: z.literal("not_implemented"),
        checkpointBoundary: z.literal("none_authenticated_for_fusion"),
        recovery: z.literal("rerun_from_exact_inputs"),
      })
      .strict(),
    verificationBoundary: z
      .object({
        standaloneSchema: z.literal("payload_self_consistency_only"),
        exactArtifactAndProposalBinding: z.literal(
          "requires_recompile_from_exact_inputs",
        ),
        digestAuthentication: z.literal("not_provided"),
      })
      .strict(),
    releaseEligibility: z.literal("blocked"),
    releaseBlockers: z
      .array(ReleaseBlockerSchema)
      .min(RELEASE_BLOCKERS.length)
      .max(RELEASE_BLOCKERS.length + CONDITIONAL_RELEASE_BLOCKERS.length),
    authority: z
      .object({
        geometry: z.literal("none"),
        placement: z.literal("none"),
        measurement: z.literal("none"),
        collision: z.literal("none"),
        export: z.literal("none"),
        runtime: z.literal("none"),
      })
      .strict(),
    capabilities: z
      .object({
        signing: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        runtimeActivation: z.literal("not_authorized"),
        exportAuthority: z.literal("not_authorized"),
        runtimePackageRegistration: z.literal("not_authorized"),
        sceneAuthorityCreation: z.literal("not_authorized"),
        transformArtifactCreation: z.literal("not_authorized"),
        qaApproval: z.literal("not_authorized"),
      })
      .strict(),
  })
  .strict();

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return (
    stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right))
  );
}

function canonicalMetricNumber(value: number): number {
  if (
    !Number.isFinite(value) ||
    Math.abs(value) > FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_ABS_METERS
  ) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_COORDINATE_OUT_OF_RANGE",
      `Fusion coordinates must be finite and within +/-${String(FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_ABS_METERS)} metres.`,
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function canonicalMetricVector(input: Vec3): [number, number, number] {
  return [
    canonicalMetricNumber(input[0]),
    canonicalMetricNumber(input[1]),
    canonicalMetricNumber(input[2]),
  ];
}

function applyColumnMajorMatrix(
  matrix: readonly number[],
  point: Vec3,
): [number, number, number] {
  const x = point[0];
  const y = point[1];
  const zCoordinate = point[2];
  return canonicalMetricVector([
    (matrix[0] ?? Number.NaN) * x +
      (matrix[4] ?? Number.NaN) * y +
      (matrix[8] ?? Number.NaN) * zCoordinate +
      (matrix[12] ?? Number.NaN),
    (matrix[1] ?? Number.NaN) * x +
      (matrix[5] ?? Number.NaN) * y +
      (matrix[9] ?? Number.NaN) * zCoordinate +
      (matrix[13] ?? Number.NaN),
    (matrix[2] ?? Number.NaN) * x +
      (matrix[6] ?? Number.NaN) * y +
      (matrix[10] ?? Number.NaN) * zCoordinate +
      (matrix[14] ?? Number.NaN),
  ]);
}

function boundsForVectors(
  vectors: readonly Vec3[],
): z.infer<typeof BoundsSchema> {
  const first = vectors[0];
  if (first === undefined) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_EMPTY_SOURCE",
      "Every fused source must retain at least one exact crop point.",
    );
  }
  const minimum = [...first] as [number, number, number];
  const maximum = [...first] as [number, number, number];
  for (let index = 1; index < vectors.length; index += 1) {
    const point = vectors[index];
    if (point === undefined) continue;
    for (const axis of [0, 1, 2] as const) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
  }
  return { minimum, maximum };
}

function safelyApplyMatrix(
  matrix: readonly number[],
  point: Vec3,
): Vec3 | null {
  try {
    return applyColumnMajorMatrix(matrix, point);
  } catch (error: unknown) {
    if (
      error instanceof FoundryIntegrityError &&
      error.code === "POINT_SOURCE_FUSION_COORDINATE_OUT_OF_RANGE"
    ) {
      return null;
    }
    throw error;
  }
}

function validateSourceOrdering(
  sources: readonly z.infer<typeof FusionSourceLineageSchema>[],
  ctx: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  const artifacts = new Set<string>();
  for (const [index, source] of sources.entries()) {
    if (source.sourceOrder !== index) {
      addIssue(
        ctx,
        ["sources", index, "sourceOrder"],
        "source order must be contiguous",
      );
    }
    if (ids.has(source.sourceId) || artifacts.has(source.artifactSha256)) {
      addIssue(
        ctx,
        ["sources", index],
        "fusion source identities must be unique",
      );
    }
    ids.add(source.sourceId);
    artifacts.add(source.artifactSha256);
    const previous = sources[index - 1];
    if (
      previous !== undefined &&
      compareCanonicalStrings(previous.artifactSha256, source.artifactSha256) >=
        0
    ) {
      addIssue(
        ctx,
        ["sources", index],
        "sources must be strictly ordered by artifact digest",
      );
    }
  }
}

function validatePointOrderingAndTransforms(
  payload: z.infer<typeof FusionPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const counts = Array.from({ length: payload.sources.length }, () => 0);
  const sourceVectors = payload.sources.map(() => [] as Vec3[]);
  const targetVectors = payload.sources.map(() => [] as Vec3[]);
  let previousSourceOrder = -1;
  let previousSourcePointOrder = -1;
  for (const [index, point] of payload.points.entries()) {
    const source = payload.sources[point.sourceOrder];
    const fusedCount = counts[point.sourceOrder];
    if (
      source === undefined ||
      source.sourceId !== point.sourceId ||
      fusedCount === undefined ||
      point.sourceOrder < previousSourceOrder ||
      (point.sourceOrder === previousSourceOrder &&
        point.sourcePointOrder <= previousSourcePointOrder) ||
      point.sourcePointOrder >= source.artifactPointCount ||
      (source.masking.status === "not_performed" &&
        point.classificationMaskPointId !== null) ||
      (source.masking.status === "exact_operator_draft_applied" &&
        point.classificationMaskPointId === null)
    ) {
      addIssue(
        ctx,
        ["points", index],
        "points must follow exact source and source-point order",
      );
      continue;
    }
    const expectedTarget = safelyApplyMatrix(
      source.registration.matrixColumnMajor,
      point.sourceCoordinatesM,
    );
    if (
      expectedTarget === null ||
      !sameCanonical(expectedTarget, point.targetCoordinatesM)
    ) {
      addIssue(
        ctx,
        ["points", index, "targetCoordinatesM"],
        "target coordinate does not reproduce from the bound matrix",
      );
    }
    counts[point.sourceOrder] = fusedCount + 1;
    sourceVectors[point.sourceOrder]?.push(point.sourceCoordinatesM);
    targetVectors[point.sourceOrder]?.push(point.targetCoordinatesM);
    previousSourceOrder = point.sourceOrder;
    previousSourcePointOrder = point.sourcePointOrder;
  }
  validateSourcePointSummaries(
    payload,
    counts,
    sourceVectors,
    targetVectors,
    ctx,
  );
}

function validateSourcePointSummaries(
  payload: z.infer<typeof FusionPayloadObjectSchema>,
  counts: readonly number[],
  sourceVectors: readonly (readonly Vec3[])[],
  targetVectors: readonly (readonly Vec3[])[],
  ctx: z.RefinementCtx,
): void {
  for (const [index, source] of payload.sources.entries()) {
    const sourcePoints = sourceVectors[index] ?? [];
    const targetPoints = targetVectors[index] ?? [];
    if (
      counts[index] !== source.fusedPointCount ||
      sourcePoints.length === 0 ||
      !sameCanonical(
        boundsForVectors(sourcePoints),
        source.retainedSourceBoundsM,
      ) ||
      !sameCanonical(boundsForVectors(targetPoints), source.targetBoundsM)
    ) {
      addIssue(
        ctx,
        ["sources", index],
        "source point counts or bounds do not match fused points",
      );
    }
  }
}

function releaseBlockersForSources(
  sources: readonly z.infer<typeof FusionSourceLineageSchema>[],
): z.infer<typeof ReleaseBlockerSchema>[] {
  const blockers = new Set<z.infer<typeof ReleaseBlockerSchema>>(
    RELEASE_BLOCKERS,
  );
  const maskCount = sources.filter(
    (source) => source.masking.status === "exact_operator_draft_applied",
  ).length;
  if (maskCount > 0) {
    blockers.add("AUTHORED_POINT_CLASSIFICATION_REVIEW_REQUIRED");
  }
  if (maskCount < sources.length) {
    blockers.add("EXACT_POINT_MASK_ARTIFACT_REQUIRED");
  }
  return [...blockers].sort(compareCanonicalStrings);
}

function validateMaskingSummary(
  payload: z.infer<typeof FusionPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const maskDigests = payload.sources.flatMap((source) =>
    source.masking.exactPointMaskArtifactSha256 === null
      ? []
      : [source.masking.exactPointMaskArtifactSha256],
  );
  const maskCount = maskDigests.length;
  const expectedCoverage =
    maskCount === 0
      ? "none"
      : maskCount === payload.sources.length
        ? "all_sources"
        : "some_sources";
  if (
    payload.masking.coverage !== expectedCoverage ||
    !sameCanonical(
      payload.masking.sourceOrderedExactPointMaskArtifactSha256s,
      maskDigests,
    ) ||
    payload.masking.classificationAuthority !==
      (maskCount === 0 ? "none" : "caller_supplied_unverified") ||
    payload.masking.unmaskedSourceContent !==
      (maskCount === payload.sources.length
        ? "none"
        : "possible_movable_or_privacy_content_retained")
  ) {
    addIssue(
      ctx,
      ["masking"],
      "fusion mask coverage must reproduce from exact source mask lineage",
    );
  }
}

function validateFusionPayload(
  payload: z.infer<typeof FusionPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  validateSourceOrdering(payload.sources, ctx);
  const sourceCropPoints = payload.sources.reduce(
    (total, source) => total + source.artifactPointCount,
    0,
  );
  const capturedMovableVisualExcluded = payload.sources.reduce(
    (total, source) =>
      total + source.excludedPointCounts.capturedMovableVisual,
    0,
  );
  const privacyExcluded = payload.sources.reduce(
    (total, source) => total + source.excludedPointCounts.privacy,
    0,
  );
  if (
    payload.pointCounts.sources !== payload.sources.length ||
    payload.pointCounts.sourceCropPoints !== sourceCropPoints ||
    payload.pointCounts.capturedMovableVisualExcluded !==
      capturedMovableVisualExcluded ||
    payload.pointCounts.privacyExcluded !== privacyExcluded ||
    payload.pointCounts.fused !== payload.points.length ||
    payload.sources.reduce(
      (total, source) => total + source.fusedPointCount,
      0,
    ) !== payload.points.length ||
    sourceCropPoints !==
      payload.points.length +
        capturedMovableVisualExcluded +
        privacyExcluded
  ) {
    addIssue(ctx, ["pointCounts"], "fusion point counters do not balance");
  }
  validateMaskingSummary(payload, ctx);
  if (
    !sameCanonical(
      payload.releaseBlockers,
      releaseBlockersForSources(payload.sources),
    )
  ) {
    addIssue(
      ctx,
      ["releaseBlockers"],
      "release blockers must match exact mask coverage",
    );
  }
  validatePointOrderingAndTransforms(payload, ctx);
  if (
    payload.points.length > 0 &&
    !sameCanonical(
      boundsForVectors(payload.points.map((point) => point.targetCoordinatesM)),
      payload.outputBoundsM,
    )
  ) {
    addIssue(
      ctx,
      ["outputBoundsM"],
      "output bounds do not match fused target points",
    );
  }
}

export const FoundryBoundedPointSourceFusionPayloadV0Schema = z.preprocess(
  rejectOversizedFusionPayload,
  z.union([
    FusionPayloadObjectSchema.superRefine(validateFusionPayload),
    BoundedShapeRejectionSchema,
  ]),
);
export type FoundryBoundedPointSourceFusionPayloadV0 = z.infer<
  typeof FoundryBoundedPointSourceFusionPayloadV0Schema
>;

const FoundryBoundedPointSourceFusionResultObjectV0Schema =
  FusionPayloadObjectSchema.extend({
    fusionSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((result, ctx) => {
      const { fusionSha256, ...payload } = result;
      const parsed =
        FoundryBoundedPointSourceFusionPayloadV0Schema.safeParse(payload);
      if (!parsed.success) {
        addIssue(ctx, [], "fusion payload must remain internally reproducible");
      } else if (fusionSha256 !== fusionDigest(parsed.data)) {
        addIssue(
          ctx,
          ["fusionSha256"],
          "fusion digest does not bind the exact payload",
        );
      }
    });
export const FoundryBoundedPointSourceFusionV0Schema = z.preprocess(
  rejectOversizedFusionPayload,
  z.union([
    FoundryBoundedPointSourceFusionResultObjectV0Schema,
    BoundedShapeRejectionSchema,
  ]),
);
export type FoundryBoundedPointSourceFusionV0 = z.infer<
  typeof FoundryBoundedPointSourceFusionV0Schema
>;

function prefixedDigest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function sourceFrameDigest(artifact: FoundryE57GeometryCropArtifactV0): string {
  return prefixedDigest(SOURCE_FRAME_DIGEST_DOMAIN, {
    schemaVersion: "omnitwin.foundry.e57-crop-metric-frame-binding.v0",
    artifactSha256: artifact.artifactSha256,
    source: artifact.source,
    sourceFactsArtifactSha256: artifact.sourceFactsArtifactSha256,
    readerDescriptionSha256: artifact.readerDescription.descriptionSha256,
    coordinateContract: artifact.coordinateContract,
    crop: artifact.crop,
  });
}

function derivedSourceBinding(
  artifact: FoundryE57GeometryCropArtifactV0,
): FoundryE57CropMetricRegistrationSourceV0 {
  const artifactHex = artifact.artifactSha256.slice("sha256:".length);
  return FoundryE57CropMetricRegistrationSourceV0Schema.parse({
    rootId: `e57-crop-${artifactHex}`,
    rootSha256: artifact.artifactSha256,
    frame: {
      frameId: `e57-root-${artifactHex}`,
      frameSha256: sourceFrameDigest(artifact),
      units: "meters",
      handedness: "right",
      upAxis: "z",
      axisConvention: SOURCE_AXIS_CONVENTION,
    },
  });
}

export function deriveFoundryE57CropMetricRegistrationSourceV0(
  artifactInput: unknown,
): FoundryE57CropMetricRegistrationSourceV0 {
  const artifact = FoundryE57GeometryCropArtifactV0Schema.parse(artifactInput);
  return derivedSourceBinding(artifact);
}

function sourcePointKey(point: {
  readonly scanIndex: number;
  readonly sourcePointIndex: number;
}): string {
  return `${String(point.scanIndex)}:${String(point.sourcePointIndex)}`;
}

function derivedPointBinding(
  artifact: FoundryE57GeometryCropArtifactV0,
  source: FoundryE57CropMetricRegistrationSourceV0,
  point: FoundryE57GeometryCropArtifactV0["points"][number],
): FoundryE57CropMetricRegistrationPointV0 {
  const coordinates = canonicalMetricVector([point.xM, point.yM, point.zM]);
  const evidenceSha256 = prefixedDigest(SOURCE_POINT_DIGEST_DOMAIN, {
    schemaVersion: "omnitwin.foundry.e57-crop-metric-point-binding.v0",
    artifactSha256: artifact.artifactSha256,
    source,
    scanIndex: point.scanIndex,
    data3dGuid: point.data3dGuid,
    sourcePointIndex: point.sourcePointIndex,
    coordinatesM: coordinates,
  });
  return FoundryE57CropMetricRegistrationPointV0Schema.parse({
    pointId: `e57-point-${evidenceSha256.slice("sha256:".length)}`,
    evidenceSha256,
    coordinates,
  });
}

export function deriveFoundryE57CropMetricRegistrationPointsV0(
  artifactInput: unknown,
  selectorInput: unknown,
): FoundryE57CropMetricRegistrationPointV0[] {
  const artifact = FoundryE57GeometryCropArtifactV0Schema.parse(artifactInput);
  const selectors = z
    .array(PointSelectorSchema)
    .min(1)
    .max(4_096)
    .parse(selectorInput);
  if (new Set(selectors.map(sourcePointKey)).size !== selectors.length) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_POINT_SELECTOR_DUPLICATE",
      "Registration point selectors must be unique.",
    );
  }
  const points = new Map(
    artifact.points.map((point) => [sourcePointKey(point), point]),
  );
  const source = derivedSourceBinding(artifact);
  return selectors.map((selector) => {
    const point = points.get(sourcePointKey(selector));
    if (point === undefined) {
      throw new FoundryIntegrityError(
        "POINT_SOURCE_FUSION_POINT_SELECTOR_MISSING",
        "A registration point selector does not identify an exact retained crop point.",
      );
    }
    return derivedPointBinding(artifact, source, point);
  });
}

function fusionDigest(
  payload: FoundryBoundedPointSourceFusionPayloadV0,
): string {
  return prefixedDigest(FUSION_DIGEST_DOMAIN, payload);
}

export function computeFoundryBoundedPointSourceFusionSha256(
  payloadInput: unknown,
): string {
  const parsed =
    FoundryBoundedPointSourceFusionPayloadV0Schema.safeParse(payloadInput);
  if (!parsed.success) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_PAYLOAD_INVALID",
      "The fusion payload is invalid or internally inconsistent.",
      { cause: parsed.error },
    );
  }
  return fusionDigest(parsed.data);
}

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayMember(
  record: Record<string, unknown> | null,
  key: string,
): readonly unknown[] | null {
  if (record === null) return null;
  const value = record[key];
  return Array.isArray(value) ? value : null;
}

function arrayMemberExceeds(
  record: Record<string, unknown> | null,
  key: string,
  maximum: number,
): boolean {
  const value = arrayMember(record, key);
  return value !== null && value.length > maximum;
}

function arrayHasUnsafeSlots(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return true;
  }
  return false;
}

function hasExactOwnKeys(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

const E57_POINT_KEYS = new Set([
  "scanIndex",
  "data3dGuid",
  "sourcePointIndex",
  "xM",
  "yM",
  "zM",
]);

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function e57PointHasBoundedShape(value: unknown): boolean {
  const point = unknownRecord(value);
  return (
    point !== null &&
    hasExactOwnKeys(point, E57_POINT_KEYS) &&
    isNonnegativeSafeInteger(point.scanIndex) &&
    typeof point.data3dGuid === "string" &&
    point.data3dGuid.length >= 1 &&
    point.data3dGuid.length <= 512 &&
    isNonnegativeSafeInteger(point.sourcePointIndex) &&
    isFiniteNumber(point.xM) &&
    isFiniteNumber(point.yM) &&
    isFiniteNumber(point.zM)
  );
}

function metricVectorHasBoundedShape(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    !arrayHasUnsafeSlots(value) &&
    value.every(
      (coordinate) =>
        isFiniteNumber(coordinate) &&
        Math.abs(coordinate) <=
          FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_ABS_METERS,
    )
  );
}

const FUSION_POINT_KEYS = new Set([
  "sourceOrder",
  "sourceId",
  "sourcePointOrder",
  "scanIndex",
  "data3dGuid",
  "sourcePointIndex",
  "sourceCoordinatesM",
  "targetCoordinatesM",
  "classificationMaskPointId",
  "contentClassification",
  "authority",
]);

function fusionPointHasBoundedShape(value: unknown): boolean {
  const point = unknownRecord(value);
  return (
    point !== null &&
    hasExactOwnKeys(point, FUSION_POINT_KEYS) &&
    isNonnegativeSafeInteger(point.sourceOrder) &&
    point.sourceOrder < FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES &&
    typeof point.sourceId === "string" &&
    RUNTIME_MANIFEST_KEY.test(point.sourceId) &&
    isNonnegativeSafeInteger(point.sourcePointOrder) &&
    point.sourcePointOrder <
      FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS &&
    isNonnegativeSafeInteger(point.scanIndex) &&
    typeof point.data3dGuid === "string" &&
    point.data3dGuid.length >= 1 &&
    point.data3dGuid.length <= 512 &&
    isNonnegativeSafeInteger(point.sourcePointIndex) &&
    metricVectorHasBoundedShape(point.sourceCoordinatesM) &&
    metricVectorHasBoundedShape(point.targetCoordinatesM) &&
    (point.classificationMaskPointId === null ||
      (typeof point.classificationMaskPointId === "string" &&
        RUNTIME_MANIFEST_KEY.test(point.classificationMaskPointId))) &&
    point.contentClassification === "unclassified_static_candidate" &&
    point.authority === "none"
  );
}

function simpleArrayHasUnsafeShape(
  record: Record<string, unknown> | null,
  key: string,
  memberIsValid: (member: unknown) => boolean,
): boolean {
  const value = arrayMember(record, key);
  return (
    value !== null &&
    (arrayHasUnsafeSlots(value) || !value.every(memberIsValid))
  );
}

function registrationEvaluationExceedsBounds(value: unknown): boolean {
  const evaluation = unknownRecord(value);
  return (
    arrayMemberExceeds(
      evaluation,
      "correspondenceIds",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayMemberExceeds(
      evaluation,
      "records",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    )
  );
}

function registrationEvaluationHasUnsafeShape(value: unknown): boolean {
  const evaluation = unknownRecord(value);
  return (
    simpleArrayHasUnsafeShape(
      evaluation,
      "correspondenceIds",
      (member) => typeof member === "string",
    ) ||
    simpleArrayHasUnsafeShape(
      evaluation,
      "records",
      (member) => unknownRecord(member) !== null,
    )
  );
}

function registrationProposalExceedsBounds(value: unknown): boolean {
  const proposal = unknownRecord(value);
  const partitions = unknownRecord(proposal?.partitions);
  const solve = unknownRecord(proposal?.solve);
  return (
    arrayMemberExceeds(
      proposal,
      "correspondenceOrder",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayMemberExceeds(
      partitions,
      "fitCorrespondenceIds",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayMemberExceeds(
      partitions,
      "heldOutCorrespondenceIds",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayMemberExceeds(solve, "matrixColumnMajor", 16) ||
    registrationEvaluationExceedsBounds(proposal?.fitEvaluation) ||
    registrationEvaluationExceedsBounds(proposal?.heldOutEvaluation)
  );
}

function registrationProposalHasUnsafeShape(value: unknown): boolean {
  const proposal = unknownRecord(value);
  const partitions = unknownRecord(proposal?.partitions);
  const solve = unknownRecord(proposal?.solve);
  return (
    simpleArrayHasUnsafeShape(
      proposal,
      "correspondenceOrder",
      (member) => unknownRecord(member) !== null,
    ) ||
    simpleArrayHasUnsafeShape(
      partitions,
      "fitCorrespondenceIds",
      (member) => typeof member === "string",
    ) ||
    simpleArrayHasUnsafeShape(
      partitions,
      "heldOutCorrespondenceIds",
      (member) => typeof member === "string",
    ) ||
    simpleArrayHasUnsafeShape(solve, "matrixColumnMajor", isFiniteNumber) ||
    registrationEvaluationHasUnsafeShape(proposal?.fitEvaluation) ||
    registrationEvaluationHasUnsafeShape(proposal?.heldOutEvaluation)
  );
}

function e57ArtifactExceedsBounds(
  value: unknown,
  pointBudget: { total: number },
): boolean {
  const artifact = unknownRecord(value);
  const points = arrayMember(artifact, "points");
  if (points !== null) {
    pointBudget.total += points.length;
    if (
      pointBudget.total > FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS
    ) {
      return true;
    }
  }
  const description = unknownRecord(artifact?.readerDescription);
  const scans = arrayMember(description, "scans");
  if (scans !== null && scans.length > FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS) {
    return true;
  }
  if (scans !== null) {
    for (let index = 0; index < scans.length; index += 1) {
      if (arrayMemberExceeds(unknownRecord(scans[index]), "pointFields", 256)) {
        return true;
      }
    }
  }
  return false;
}

function e57ArtifactHasUnsafeShape(value: unknown): boolean {
  const artifact = unknownRecord(value);
  const points = arrayMember(artifact, "points");
  if (
    points !== null &&
    (arrayHasUnsafeSlots(points) || !points.every(e57PointHasBoundedShape))
  ) {
    return true;
  }
  const description = unknownRecord(artifact?.readerDescription);
  const scans = arrayMember(description, "scans");
  if (scans === null) return false;
  if (arrayHasUnsafeSlots(scans)) return true;
  for (let index = 0; index < scans.length; index += 1) {
    const scan = unknownRecord(scans[index]);
    if (
      scan === null ||
      simpleArrayHasUnsafeShape(
        scan,
        "pointFields",
        (member) => typeof member === "string",
      )
    ) {
      return true;
    }
  }
  return false;
}

interface PointClassificationMaskBudget {
  points: number;
  selectors: number;
}

function pointClassificationMaskExceedsBounds(
  value: unknown,
  budget: PointClassificationMaskBudget,
): boolean {
  const mask = unknownRecord(value);
  if (mask === null) return false;
  const points = arrayMember(mask, "points");
  if (points !== null) {
    if (
      points.length > FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS
    ) {
      return true;
    }
    budget.points += points.length;
    if (
      budget.points > FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS
    ) {
      return true;
    }
  }
  const rules = arrayMember(mask, "classificationRules");
  if (rules === null) return false;
  if (
    rules.length > FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES ||
    arrayHasUnsafeSlots(rules)
  ) {
    return true;
  }
  for (let index = 0; index < rules.length; index += 1) {
    const selection = unknownRecord(unknownRecord(rules[index])?.selection);
    const selectors = arrayMember(selection, "points");
    if (selectors === null) continue;
    if (
      selectors.length > FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS
    ) {
      return true;
    }
    budget.selectors += selectors.length;
    if (
      budget.selectors > FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS
    ) {
      return true;
    }
  }
  return false;
}

function fusionInputExceedsBounds(value: unknown): boolean {
  const input = unknownRecord(value);
  const sources = arrayMember(input, "sources");
  if (sources === null) return false;
  if (sources.length > FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES) {
    return true;
  }
  const pointBudget = { total: 0 };
  const maskBudget: PointClassificationMaskBudget = {
    points: 0,
    selectors: 0,
  };
  for (let index = 0; index < sources.length; index += 1) {
    const source = unknownRecord(sources[index]);
    if (
      e57ArtifactExceedsBounds(source?.artifact, pointBudget) ||
      registrationProposalExceedsBounds(source?.registrationProposal) ||
      pointClassificationMaskExceedsBounds(
        source?.pointClassificationMask,
        maskBudget,
      )
    ) {
      return true;
    }
  }
  return false;
}

function fusionInputHasUnsafeShape(value: unknown): boolean {
  const input = unknownRecord(value);
  const sources = arrayMember(input, "sources");
  if (sources === null) return false;
  if (arrayHasUnsafeSlots(sources)) return true;
  for (let index = 0; index < sources.length; index += 1) {
    const source = unknownRecord(sources[index]);
    if (
      source === null ||
      e57ArtifactHasUnsafeShape(source.artifact) ||
      registrationProposalHasUnsafeShape(source.registrationProposal)
    ) {
      return true;
    }
  }
  return false;
}

function fusionPayloadExceedsBounds(value: unknown): boolean {
  const payload = unknownRecord(value);
  const sources = arrayMember(payload, "sources");
  const points = arrayMember(payload, "points");
  const masking = unknownRecord(payload?.masking);
  if (
    (sources !== null &&
      sources.length > FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES) ||
    (points !== null &&
      points.length > FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_POINTS) ||
    arrayMemberExceeds(
      masking,
      "sourceOrderedExactPointMaskArtifactSha256s",
      FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_MAXIMUM_SOURCES,
    ) ||
    arrayMemberExceeds(
      payload,
      "releaseBlockers",
      RELEASE_BLOCKERS.length + CONDITIONAL_RELEASE_BLOCKERS.length,
    )
  ) {
    return true;
  }
  if (sources !== null) {
    for (let index = 0; index < sources.length; index += 1) {
      const source = unknownRecord(sources[index]);
      const registration = unknownRecord(source?.registration);
      if (arrayMemberExceeds(registration, "matrixColumnMajor", 16)) {
        return true;
      }
    }
  }
  return false;
}

function fusionPayloadHasUnsafeShape(value: unknown): boolean {
  const payload = unknownRecord(value);
  const sources = arrayMember(payload, "sources");
  const points = arrayMember(payload, "points");
  const masking = unknownRecord(payload?.masking);
  if (
    (sources !== null && arrayHasUnsafeSlots(sources)) ||
    (points !== null &&
      (arrayHasUnsafeSlots(points) ||
        !points.every(fusionPointHasBoundedShape))) ||
    simpleArrayHasUnsafeShape(
      masking,
      "sourceOrderedExactPointMaskArtifactSha256s",
      (member) => typeof member === "string",
    ) ||
    simpleArrayHasUnsafeShape(
      payload,
      "releaseBlockers",
      (member) => typeof member === "string",
    )
  ) {
    return true;
  }
  if (sources !== null) {
    for (let index = 0; index < sources.length; index += 1) {
      const source = unknownRecord(sources[index]);
      const registration = unknownRecord(source?.registration);
      if (
        source === null ||
        simpleArrayHasUnsafeShape(
          registration,
          "matrixColumnMajor",
          isFiniteNumber,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function rejectOversizedFusionInput(value: unknown): unknown {
  try {
    return fusionInputExceedsBounds(value) || fusionInputHasUnsafeShape(value)
      ? BOUNDED_SHAPE_REJECTION
      : value;
  } catch {
    return BOUNDED_SHAPE_REJECTION;
  }
}

function rejectOversizedFusionPayload(value: unknown): unknown {
  try {
    return fusionPayloadExceedsBounds(value) ||
      fusionPayloadHasUnsafeShape(value)
      ? BOUNDED_SHAPE_REJECTION
      : value;
  } catch {
    return BOUNDED_SHAPE_REJECTION;
  }
}

function preflightInputBounds(input: unknown): void {
  let exceeded = false;
  try {
    exceeded = fusionInputExceedsBounds(input);
  } catch {
    exceeded = true;
  }
  if (exceeded) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_LIMIT_EXCEEDED",
      "Fusion input exceeds a bounded source, crop point, classification-mask point/selector, scan, point-field, correspondence, evaluation, partition, or matrix array limit.",
    );
  }
}

function requireExactTarget(
  proposal: FoundryMetricRegistrationProposalV0,
  target: FoundryMetricTargetBindingV0,
): void {
  if (!sameCanonical(proposal.target, target)) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_TARGET_BINDING_MISMATCH",
      "Every registration proposal must bind the exact requested metric target root, digest, frame, units, handedness, axis, and convention.",
    );
  }
}

function requireExactSource(
  artifact: FoundryE57GeometryCropArtifactV0,
  proposal: FoundryMetricRegistrationProposalV0,
): FoundryE57CropMetricRegistrationSourceV0 {
  const expected = derivedSourceBinding(artifact);
  if (!sameCanonical(proposal.source, expected)) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_SOURCE_BINDING_MISMATCH",
      "The registration proposal source does not bind this exact crop artifact digest and derived E57-root frame.",
    );
  }
  return expected;
}

function proposalSourceRecords(
  proposal: FoundryMetricRegistrationProposalV0,
): readonly {
  readonly sourcePointId: string;
  readonly sourceEvidenceSha256: string;
  readonly sourceCoordinates: Vec3;
}[] {
  return [
    ...proposal.fitEvaluation.records,
    ...proposal.heldOutEvaluation.records,
  ];
}

function requireExactControlPoints(
  artifact: FoundryE57GeometryCropArtifactV0,
  source: FoundryE57CropMetricRegistrationSourceV0,
  proposal: FoundryMetricRegistrationProposalV0,
): void {
  const byPointId = new Map(
    artifact.points.map((point) => {
      const binding = derivedPointBinding(artifact, source, point);
      return [binding.pointId, binding] as const;
    }),
  );
  for (const record of proposalSourceRecords(proposal)) {
    const expected = byPointId.get(record.sourcePointId);
    if (
      expected === undefined ||
      expected.evidenceSha256 !== record.sourceEvidenceSha256 ||
      !sameCanonical(expected.coordinates, record.sourceCoordinates)
    ) {
      throw new FoundryIntegrityError(
        "POINT_SOURCE_FUSION_CONTROL_POINT_BINDING_MISMATCH",
        "Every registration source control must match an exact retained crop point ID, evidence digest, and metric coordinate.",
      );
    }
  }
}

interface OrderedFusionSource {
  readonly artifact: FoundryE57GeometryCropArtifactV0;
  readonly proposal: FoundryMetricRegistrationProposalV0;
  readonly source: FoundryE57CropMetricRegistrationSourceV0;
  readonly mask: FoundryE57PointClassificationMaskV0 | null;
}

function validateAndOrderSources(
  input: FoundryBoundedPointSourceFusionInputV0,
): OrderedFusionSource[] {
  const ordered = input.sources
    .map(({ artifact, registrationProposal, pointClassificationMask }) => ({
      artifact,
      proposal: registrationProposal,
      maskInput: pointClassificationMask,
    }))
    .sort((left, right) =>
      compareCanonicalStrings(
        left.artifact.artifactSha256,
        right.artifact.artifactSha256,
      ),
    );
  for (let index = 1; index < ordered.length; index += 1) {
    if (
      ordered[index - 1]?.artifact.artifactSha256 ===
      ordered[index]?.artifact.artifactSha256
    ) {
      throw new FoundryIntegrityError(
        "POINT_SOURCE_FUSION_DUPLICATE_ARTIFACT",
        "The same exact crop artifact cannot be fused more than once.",
      );
    }
  }
  return ordered.map(({ artifact, proposal, maskInput }) => {
    if (artifact.points.length === 0) {
      throw new FoundryIntegrityError(
        "POINT_SOURCE_FUSION_EMPTY_SOURCE",
        "Every fused crop artifact must retain at least one point.",
      );
    }
    requireExactTarget(proposal, input.target);
    const source = requireExactSource(artifact, proposal);
    requireExactControlPoints(artifact, source, proposal);
    let mask: FoundryE57PointClassificationMaskV0 | null = null;
    if (maskInput !== undefined) {
      try {
        mask = verifyFoundryE57PointClassificationMaskV0(maskInput, artifact);
      } catch (error: unknown) {
        throw new FoundryIntegrityError(
          "POINT_SOURCE_FUSION_MASK_BINDING_MISMATCH",
          "A point-classification mask must self-verify by exact recompilation against this crop artifact before fusion can consume it.",
          { cause: error },
        );
      }
      if (mask.classificationCounts.unclassifiedStaticCandidate === 0) {
        throw new FoundryIntegrityError(
          "POINT_SOURCE_FUSION_EMPTY_AFTER_EXCLUSIONS",
          "An exact point-classification mask excluded every retained crop point; an empty source cannot be fused successfully.",
        );
      }
      requireNoExcludedControlPoints(artifact, source, proposal, mask);
    }
    return { artifact, proposal, source, mask };
  });
}

function requireNoExcludedControlPoints(
  artifact: FoundryE57GeometryCropArtifactV0,
  source: FoundryE57CropMetricRegistrationSourceV0,
  proposal: FoundryMetricRegistrationProposalV0,
  mask: FoundryE57PointClassificationMaskV0,
): void {
  const excludedControlPointIds = new Set(
    mask.points.flatMap((classifiedPoint) => {
      if (classifiedPoint.classification === "unclassified_static_candidate") {
        return [];
      }
      const artifactPoint = artifact.points[classifiedPoint.pointOrder];
      if (artifactPoint === undefined) {
        throw new FoundryIntegrityError(
          "POINT_SOURCE_FUSION_MASK_BINDING_MISMATCH",
          "A verified mask point order no longer resolves against its exact crop artifact.",
        );
      }
      return [derivedPointBinding(artifact, source, artifactPoint).pointId];
    }),
  );
  if (
    proposalSourceRecords(proposal).some((record) =>
      excludedControlPointIds.has(record.sourcePointId),
    )
  ) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_EXCLUDED_CONTROL_POINT",
      "A registration control point is classified as captured movable or privacy-excluded; excluded content cannot control the metric transform.",
    );
  }
}

function normalizedFusionInputDigest(
  target: FoundryMetricTargetBindingV0,
  sources: readonly OrderedFusionSource[],
): string {
  return prefixedDigest(FUSION_INPUT_DIGEST_DOMAIN, {
    schemaVersion: FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_INPUT_V0,
    target,
    sources: sources.map(({ artifact, proposal, mask }) => ({
      artifactSha256: artifact.artifactSha256,
      registrationProposalSha256: proposal.proposalSha256,
      pointClassificationMaskSha256: mask?.maskSha256 ?? null,
    })),
  });
}

interface CompiledSource {
  readonly lineage: z.infer<typeof FusionSourceLineageSchema>;
  readonly points: z.infer<typeof FusionPointSchema>[];
}

function compileSource(
  ordered: OrderedFusionSource,
  sourceOrder: number,
): CompiledSource {
  const { artifact, proposal, source, mask } = ordered;
  const retainedPoints = artifact.points.flatMap((point, sourcePointOrder) => {
    const classifiedPoint = mask?.points[sourcePointOrder];
    if (
      classifiedPoint !== undefined &&
      classifiedPoint.classification !== "unclassified_static_candidate"
    ) {
      return [];
    }
    return [{ point, sourcePointOrder, classifiedPoint }];
  });
  if (retainedPoints.length === 0) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_EMPTY_AFTER_EXCLUSIONS",
      "An exact point-classification mask excluded every retained crop point; an empty source cannot be fused successfully.",
    );
  }
  const sourceCoordinates = retainedPoints.map(({ point }) =>
    canonicalMetricVector([point.xM, point.yM, point.zM]),
  );
  const targetCoordinates = sourceCoordinates.map((point) =>
    applyColumnMajorMatrix(proposal.solve.matrixColumnMajor, point),
  );
  const points = retainedPoints.map(
    ({ point, sourcePointOrder, classifiedPoint }, fusedPointOrder) => ({
    sourceOrder,
    sourceId: source.rootId,
    sourcePointOrder,
    scanIndex: point.scanIndex,
    data3dGuid: point.data3dGuid,
    sourcePointIndex: point.sourcePointIndex,
    sourceCoordinatesM: sourceCoordinates[fusedPointOrder] as [
      number,
      number,
      number,
    ],
    targetCoordinatesM: targetCoordinates[fusedPointOrder] as [
      number,
      number,
      number,
    ],
    classificationMaskPointId: classifiedPoint?.pointId ?? null,
    contentClassification: "unclassified_static_candidate" as const,
    authority: "none" as const,
    }),
  );
  const excludedPointCounts = {
    capturedMovableVisual:
      mask?.classificationCounts.capturedMovableVisualExcluded ?? 0,
    privacy: mask?.classificationCounts.privacyExcluded ?? 0,
  };
  const artifactBounds = artifact.outputBoundsM;
  if (artifactBounds === null) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_EMPTY_SOURCE",
      "Every non-empty fused crop artifact must carry exact source bounds.",
    );
  }
  const lineage = FusionSourceLineageSchema.parse({
    sourceOrder,
    sourceId: source.rootId,
    artifactSha256: artifact.artifactSha256,
    invocationSha256: artifact.invocationSha256,
    finalCheckpointSha256: artifact.finalCheckpointSha256,
    sourceAssetId: artifact.source.assetId,
    sourceAssetSha256: artifact.source.sha256,
    sourceAssetRelativePath: artifact.source.relativePath,
    sourceFactsArtifactSha256: artifact.sourceFactsArtifactSha256,
    readerDescriptionSha256: artifact.readerDescription.descriptionSha256,
    artifactPointCount: artifact.points.length,
    fusedPointCount: points.length,
    excludedPointCounts,
    artifactBoundsM: artifactBounds,
    retainedSourceBoundsM: boundsForVectors(sourceCoordinates),
    targetBoundsM: boundsForVectors(targetCoordinates),
    registration: {
      proposalId: proposal.proposalId,
      proposalSha256: proposal.proposalSha256,
      registrationInputSha256: proposal.registrationInputSha256,
      source,
      target: proposal.target,
      method: proposal.solve.method,
      transformDirection: proposal.solve.transformDirection,
      vectorConvention: proposal.solve.vectorConvention,
      matrixLayout: proposal.solve.matrixLayout,
      matrixColumnMajor: proposal.solve.matrixColumnMajor,
      fitCorrespondenceCount: proposal.fitEvaluation.records.length,
      heldOutCorrespondenceCount: proposal.heldOutEvaluation.records.length,
      fitRmseM: proposal.fitEvaluation.stats.rmseMeters,
      heldOutRmseM: proposal.heldOutEvaluation.stats.rmseMeters,
      controlPointBinding:
        "every_source_control_matches_exact_crop_point_id_digest_and_coordinate",
      sourceOverlap: "not_computed",
      reviewedTransformArtifact: "not_created",
      authority: "none",
    },
    masking: {
      status:
        mask === null ? "not_performed" : "exact_operator_draft_applied",
      exactPointMaskArtifactSha256: mask?.maskSha256 ?? null,
      classificationAuthority:
        mask === null ? "none" : "caller_supplied_unverified",
      reviewStatus: mask === null ? "not_applicable" : "not_reviewed",
      retainedContentClassification: "unclassified_static_candidate",
      excludedPoints: "omitted_before_metric_transform",
      authority: "none",
    },
    authority: "none",
  });
  return { lineage, points };
}

function assemblePayload(
  input: FoundryBoundedPointSourceFusionInputV0,
  ordered: readonly OrderedFusionSource[],
): FoundryBoundedPointSourceFusionPayloadV0 {
  const compiled = ordered.map(compileSource);
  const sources = compiled.map(({ lineage }) => lineage);
  const points = compiled.flatMap(({ points: sourcePoints }) => sourcePoints);
  const exactMaskDigests = sources.flatMap((source) =>
    source.masking.exactPointMaskArtifactSha256 === null
      ? []
      : [source.masking.exactPointMaskArtifactSha256],
  );
  const maskCoverage =
    exactMaskDigests.length === 0
      ? "none"
      : exactMaskDigests.length === sources.length
        ? "all_sources"
        : "some_sources";
  return FoundryBoundedPointSourceFusionPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_BOUNDED_POINT_SOURCE_FUSION_V0,
    status: "local_unreviewed_fusion_candidate",
    fusionInputSha256: normalizedFusionInputDigest(input.target, ordered),
    target: input.target,
    fusionMethod: "transformed_stable_point_union_without_deduplication",
    stableOrdering: "artifact_sha256_then_artifact_source_point_order",
    sources,
    points,
    pointCounts: {
      sources: sources.length,
      sourceCropPoints: sources.reduce(
        (total, source) => total + source.artifactPointCount,
        0,
      ),
      capturedMovableVisualExcluded: sources.reduce(
        (total, source) =>
          total + source.excludedPointCounts.capturedMovableVisual,
        0,
      ),
      privacyExcluded: sources.reduce(
        (total, source) => total + source.excludedPointCounts.privacy,
        0,
      ),
      fused: points.length,
    },
    outputBoundsM: boundsForVectors(
      points.map((point) => point.targetCoordinatesM),
    ),
    sourceOverlap: {
      status: "not_computed",
      deduplication: "not_performed",
    },
    masking: {
      coverage: maskCoverage,
      visualReviewDraftUse: "not_accepted_as_exact_point_mask",
      sourceOrderedExactPointMaskArtifactSha256s: exactMaskDigests,
      classificationAuthority:
        exactMaskDigests.length === 0
          ? "none"
          : "caller_supplied_unverified",
      retainedPointClassification:
        "unclassified_static_candidate_non_authoritative",
      excludedPointDisposition: "omitted_from_fusion",
      unmaskedSourceContent:
        exactMaskDigests.length === sources.length
          ? "none"
          : "possible_movable_or_privacy_content_retained",
      authority: "none",
    },
    packageCompatibility: {
      roomRealityPackageAssembly: "not_created",
      representationEligibility: "blocked",
      exactMemberIdentities: "not_verified",
      movableObjectClassification: "not_verified",
    },
    execution: {
      mode: "pure_deterministic_in_memory_compile",
      interruptionResume: "not_implemented",
      checkpointBoundary: "none_authenticated_for_fusion",
      recovery: "rerun_from_exact_inputs",
    },
    verificationBoundary: {
      standaloneSchema: "payload_self_consistency_only",
      exactArtifactAndProposalBinding: "requires_recompile_from_exact_inputs",
      digestAuthentication: "not_provided",
    },
    releaseEligibility: "blocked",
    releaseBlockers: releaseBlockersForSources(sources),
    authority: {
      geometry: "none",
      placement: "none",
      measurement: "none",
      collision: "none",
      export: "none",
      runtime: "none",
    },
    capabilities: {
      signing: "not_authorized",
      publication: "not_authorized",
      runtimeActivation: "not_authorized",
      exportAuthority: "not_authorized",
      runtimePackageRegistration: "not_authorized",
      sceneAuthorityCreation: "not_authorized",
      transformArtifactCreation: "not_authorized",
      qaApproval: "not_authorized",
    },
  });
}

export function compileFoundryBoundedPointSourceFusionV0(
  input: unknown,
): FoundryBoundedPointSourceFusionV0 {
  preflightInputBounds(input);
  const parsed = FoundryBoundedPointSourceFusionInputV0Schema.safeParse(input);
  if (!parsed.success) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_INPUT_INVALID",
      "Point-source fusion requires strict bounded crop artifacts, self-verifying registration proposals, and one exact right-handed Z-up metric target.",
      { cause: parsed.error },
    );
  }
  const ordered = validateAndOrderSources(parsed.data);
  const payload = assemblePayload(parsed.data, ordered);
  return FoundryBoundedPointSourceFusionV0Schema.parse({
    ...payload,
    fusionSha256: fusionDigest(payload),
  });
}

/** Recompiles every output byte from exact crop and registration inputs. */
export function verifyFoundryBoundedPointSourceFusionV0(
  resultInput: unknown,
  exactInput: unknown,
): FoundryBoundedPointSourceFusionV0 {
  const result = FoundryBoundedPointSourceFusionV0Schema.parse(resultInput);
  const expected = compileFoundryBoundedPointSourceFusionV0(exactInput);
  if (!sameCanonical(result, expected)) {
    throw new FoundryIntegrityError(
      "POINT_SOURCE_FUSION_RECOMPUTATION_MISMATCH",
      "The fusion result does not reproduce from the exact crop artifacts, registration proposals, and metric target binding.",
    );
  }
  return result;
}

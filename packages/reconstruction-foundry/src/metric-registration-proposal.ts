import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";

/**
 * A deterministic, local-only similarity-registration proposal. This is not a
 * reviewed TransformArtifactV0 and cannot confer measurement or runtime truth.
 */
export const FOUNDRY_METRIC_REGISTRATION_INPUT_V0 =
  "omnitwin.foundry.metric-registration-input.v0";
export const FOUNDRY_METRIC_REGISTRATION_PROPOSAL_V0 =
  "omnitwin.foundry.metric-registration-proposal.v0";
export const FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES = 4_096;
export const FOUNDRY_METRIC_REGISTRATION_MAX_ABS_COORDINATE = 1_000_000_000;
export const FOUNDRY_METRIC_REGISTRATION_MAX_ABS_OUTPUT_METERS = 10_000_000_000_000_000_000;

const INPUT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_METRIC_REGISTRATION_INPUT_V0";
const CORRESPONDENCE_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_METRIC_REGISTRATION_CORRESPONDENCE_V0";
const PROPOSAL_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_METRIC_REGISTRATION_PROPOSAL_V0";
const MIN_SECOND_EIGENVALUE_RATIO = 1e-8;
const FULL_RANK_EIGENVALUE_RATIO = 1e-8;
const MIN_RMS_RADIUS = 1e-9;
const MIN_STABLE_SCALE = 1e-9;
const MAX_STABLE_SCALE = 1e9;
const JACOBI_SWEEPS = 64;
const PRECISION_FLOOR_ULP_MULTIPLIER = 128;

type Vec3 = readonly [number, number, number];
type Matrix3Rows = readonly [Vec3, Vec3, Vec3];

const BoundedCoordinateSchema = z
  .number()
  .finite()
  .min(-FOUNDRY_METRIC_REGISTRATION_MAX_ABS_COORDINATE)
  .max(FOUNDRY_METRIC_REGISTRATION_MAX_ABS_COORDINATE);
const BoundedVec3Schema = z.tuple([
  BoundedCoordinateSchema,
  BoundedCoordinateSchema,
  BoundedCoordinateSchema,
]);
const BoundedOutputMeterSchema = z
  .number()
  .finite()
  .min(-FOUNDRY_METRIC_REGISTRATION_MAX_ABS_OUTPUT_METERS)
  .max(FOUNDRY_METRIC_REGISTRATION_MAX_ABS_OUTPUT_METERS);
const BoundedOutputDistanceSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(FOUNDRY_METRIC_REGISTRATION_MAX_ABS_OUTPUT_METERS);
const BoundedOutputVec3Schema = z.tuple([
  BoundedOutputMeterSchema,
  BoundedOutputMeterSchema,
  BoundedOutputMeterSchema,
]);
const FoundryMetricRegistrationMatrix4dSchema = z
  .array(BoundedOutputMeterSchema)
  .length(16)
  .superRefine((matrix, ctx) => {
    const affineTolerance = 1e-12;
    if (
      Math.abs(matrix[3] ?? Number.NaN) > affineTolerance ||
      Math.abs(matrix[7] ?? Number.NaN) > affineTolerance ||
      Math.abs(matrix[11] ?? Number.NaN) > affineTolerance ||
      Math.abs((matrix[15] ?? Number.NaN) - 1) > affineTolerance
    ) {
      addIssue(
        ctx,
        [],
        "registration matrix must be affine column-major with final row [0,0,0,1]",
      );
      return;
    }
    const xAxis: Vec3 = [matrix[0] ?? 0, matrix[1] ?? 0, matrix[2] ?? 0];
    const yAxis: Vec3 = [matrix[4] ?? 0, matrix[5] ?? 0, matrix[6] ?? 0];
    const zAxis: Vec3 = [matrix[8] ?? 0, matrix[9] ?? 0, matrix[10] ?? 0];
    const xLength = Math.hypot(...xAxis);
    const yLength = Math.hypot(...yAxis);
    const zLength = Math.hypot(...zAxis);
    const maxLength = Math.max(xLength, yLength, zLength);
    const minLength = Math.min(xLength, yLength, zLength);
    if (
      minLength <= MIN_STABLE_SCALE ||
      maxLength >= MAX_STABLE_SCALE ||
      maxLength - minLength > 1e-9 * maxLength ||
      Math.abs(dot(xAxis, yAxis)) > 1e-9 * xLength * yLength ||
      Math.abs(dot(xAxis, zAxis)) > 1e-9 * xLength * zLength ||
      Math.abs(dot(yAxis, zAxis)) > 1e-9 * yLength * zLength
    ) {
      addIssue(
        ctx,
        [],
        "registration matrix basis must be a stable uniform orthogonal scale",
      );
      return;
    }
    const normalizedDeterminant =
      determinant3([xAxis, yAxis, zAxis]) /
      (xLength * yLength * zLength);
    if (
      !Number.isFinite(normalizedDeterminant) ||
      normalizedDeterminant <= 0 ||
      Math.abs(normalizedDeterminant - 1) > 1e-8
    ) {
      addIssue(
        ctx,
        [],
        "registration matrix basis must preserve handedness with determinant +1 after scale normalization",
      );
    }
  });

const FoundryMetricRegistrationFrameBindingV0Schema = z
  .object({
    frameId: RuntimeManifestKeySchema,
    frameSha256: RuntimeSha256Schema,
    units: z.enum([
      "meters",
      "millimeters",
      "centimeters",
      "feet",
      "unitless",
    ]),
    handedness: z.literal("right"),
    upAxis: z.enum(["x", "y", "z"]),
    axisConvention: z.string().trim().min(1).max(240),
  })
  .strict();

const FoundryMetricRegistrationRootBindingV0Schema = z
  .object({
    rootId: RuntimeManifestKeySchema,
    rootSha256: RuntimeSha256Schema,
    frame: FoundryMetricRegistrationFrameBindingV0Schema,
  })
  .strict();

const FoundryMetricRegistrationPointV0Schema = z
  .object({
    pointId: RuntimeManifestKeySchema,
    evidenceSha256: RuntimeSha256Schema,
    coordinates: BoundedVec3Schema,
  })
  .strict();

export const FoundryMetricRegistrationCorrespondenceV0Schema = z
  .object({
    correspondenceId: RuntimeManifestKeySchema,
    source: FoundryMetricRegistrationPointV0Schema,
    target: FoundryMetricRegistrationPointV0Schema,
    lineageClassification: z.enum(["independent", "shared_lineage"]),
  })
  .strict();
export type FoundryMetricRegistrationCorrespondenceV0 = z.infer<
  typeof FoundryMetricRegistrationCorrespondenceV0Schema
>;

const FoundryMetricRegistrationPartitionsV0Schema = z
  .object({
    declaration: z.literal("fixed_before_solve"),
    fitCorrespondenceIds: z
      .array(RuntimeManifestKeySchema)
      .min(4)
      .max(FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES - 1),
    heldOutCorrespondenceIds: z
      .array(RuntimeManifestKeySchema)
      .min(1)
      .max(FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES - 4),
  })
  .strict();

const FoundryMetricRegistrationInputObjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_METRIC_REGISTRATION_INPUT_V0),
    proposalId: RuntimeManifestKeySchema,
    source: FoundryMetricRegistrationRootBindingV0Schema,
    target: FoundryMetricRegistrationRootBindingV0Schema.extend({
      frame: FoundryMetricRegistrationFrameBindingV0Schema.extend({
        units: z.literal("meters"),
      }).strict(),
    }).strict(),
    correspondences: z
      .array(FoundryMetricRegistrationCorrespondenceV0Schema)
      .min(5)
      .max(FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES),
    partitions: FoundryMetricRegistrationPartitionsV0Schema,
  })
  .strict();

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [...path],
    message,
  });
}

function validateRegistrationInputStructure(
  input: z.infer<typeof FoundryMetricRegistrationInputObjectV0Schema>,
  ctx: z.RefinementCtx,
): void {
  const correspondenceIds = input.correspondences.map(
    ({ correspondenceId }) => correspondenceId,
  );
  const sourcePointIds = input.correspondences.map(
    ({ source }) => source.pointId,
  );
  const targetPointIds = input.correspondences.map(
    ({ target }) => target.pointId,
  );
  for (const [path, values] of [
    ["correspondences", correspondenceIds],
    ["correspondences.source.pointId", sourcePointIds],
    ["correspondences.target.pointId", targetPointIds],
  ] as const) {
    if (new Set(values).size !== values.length) {
      addIssue(ctx, [path], `${path} values must be unique`);
    }
  }

  const fitIds = input.partitions.fitCorrespondenceIds;
  const heldOutIds = input.partitions.heldOutCorrespondenceIds;
  if (new Set(fitIds).size !== fitIds.length) {
    addIssue(ctx, ["partitions", "fitCorrespondenceIds"], "fit IDs must be unique");
  }
  if (new Set(heldOutIds).size !== heldOutIds.length) {
    addIssue(
      ctx,
      ["partitions", "heldOutCorrespondenceIds"],
      "held-out IDs must be unique",
    );
  }
  const partitionIds = [...fitIds, ...heldOutIds];
  if (
    new Set(partitionIds).size !== partitionIds.length ||
    partitionIds.length !== correspondenceIds.length ||
    correspondenceIds.some((id) => !partitionIds.includes(id))
  ) {
    addIssue(
      ctx,
      ["partitions"],
      "fit and held-out partitions must cover every correspondence exactly once",
    );
  }
}

export const FoundryMetricRegistrationInputV0Schema =
  FoundryMetricRegistrationInputObjectV0Schema.superRefine(
    validateRegistrationInputStructure,
  );
export type FoundryMetricRegistrationInputV0 = z.infer<
  typeof FoundryMetricRegistrationInputV0Schema
>;

const FoundryMetricRegistrationResidualStatsV0Schema = z
  .object({
    count: z
      .number()
      .int()
      .positive()
      .max(FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES),
    meanMeters: BoundedOutputDistanceSchema,
    medianMeters: BoundedOutputDistanceSchema,
    rmseMeters: BoundedOutputDistanceSchema,
    p95Meters: BoundedOutputDistanceSchema,
    maxMeters: BoundedOutputDistanceSchema,
  })
  .strict();

const FoundryMetricRegistrationResidualRecordV0Schema = z
  .object({
    correspondenceId: RuntimeManifestKeySchema,
    correspondenceSha256: RuntimeSha256Schema,
    sourcePointId: RuntimeManifestKeySchema,
    sourceEvidenceSha256: RuntimeSha256Schema,
    targetPointId: RuntimeManifestKeySchema,
    targetEvidenceSha256: RuntimeSha256Schema,
    lineageClassification: z.enum(["independent", "shared_lineage"]),
    sourceCoordinates: BoundedVec3Schema,
    targetCoordinatesM: BoundedVec3Schema,
    predictedTargetCoordinatesM: BoundedOutputVec3Schema,
    residualVectorM: BoundedOutputVec3Schema,
    residualMeters: BoundedOutputDistanceSchema,
  })
  .strict();

const FoundryMetricRegistrationEvaluationV0Schema = z
  .object({
    partition: z.enum(["fit", "held_out"]),
    correspondenceIds: z
      .array(RuntimeManifestKeySchema)
      .min(1)
      .max(FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES),
    lineageClassification: z.enum(["independent", "shared_lineage"]),
    records: z
      .array(FoundryMetricRegistrationResidualRecordV0Schema)
      .min(1)
      .max(FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES),
    stats: FoundryMetricRegistrationResidualStatsV0Schema,
  })
  .strict();

const FoundryMetricRegistrationPayloadObjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_METRIC_REGISTRATION_PROPOSAL_V0),
    status: z.literal("local_unverified_registration_proposal"),
    proposalId: RuntimeManifestKeySchema,
    registrationInputSha256: RuntimeSha256Schema,
    source: FoundryMetricRegistrationRootBindingV0Schema,
    target: FoundryMetricRegistrationRootBindingV0Schema.extend({
      frame: FoundryMetricRegistrationFrameBindingV0Schema.extend({
        units: z.literal("meters"),
      }).strict(),
    }).strict(),
    correspondenceOrder: z
      .array(
        z
          .object({
            correspondenceId: RuntimeManifestKeySchema,
            correspondenceSha256: RuntimeSha256Schema,
            sourcePointId: RuntimeManifestKeySchema,
            sourceEvidenceSha256: RuntimeSha256Schema,
            targetPointId: RuntimeManifestKeySchema,
            targetEvidenceSha256: RuntimeSha256Schema,
            lineageClassification: z.enum(["independent", "shared_lineage"]),
          })
          .strict(),
      )
      .min(5)
      .max(FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES),
    partitions: FoundryMetricRegistrationPartitionsV0Schema,
    solve: z
      .object({
        method: z.literal("proper_3d_similarity_horn_jacobi"),
        transformDirection: z.literal("source_to_target"),
        vectorConvention: z.literal("column_vector_target_equals_matrix_times_source"),
        matrixLayout: z.literal("4x4_column_major"),
        uniformScaleTargetMetersPerSourceUnit: z
          .number()
          .finite()
          .gt(MIN_STABLE_SCALE)
          .lt(MAX_STABLE_SCALE),
        rotationDeterminant: z.number().finite(),
        matrixColumnMajor: FoundryMetricRegistrationMatrix4dSchema,
      })
      .strict(),
    conditioning: z
      .object({
        classification: z.enum(["well_conditioned_planar", "well_conditioned_3d"]),
        sourceRmsRadius: z
          .number()
          .finite()
          .positive()
          .max(FOUNDRY_METRIC_REGISTRATION_MAX_ABS_OUTPUT_METERS),
        targetRmsRadiusM: z
          .number()
          .finite()
          .positive()
          .max(FOUNDRY_METRIC_REGISTRATION_MAX_ABS_OUTPUT_METERS),
        sourcePrecisionFloor: z
          .number()
          .finite()
          .positive()
          .max(FOUNDRY_METRIC_REGISTRATION_MAX_ABS_OUTPUT_METERS),
        targetPrecisionFloorM: z
          .number()
          .finite()
          .positive()
          .max(FOUNDRY_METRIC_REGISTRATION_MAX_ABS_OUTPUT_METERS),
        sourceRmsToPrecisionFloorRatio: z
          .number()
          .finite()
          .min(PRECISION_FLOOR_ULP_MULTIPLIER)
          .max(1e40),
        targetRmsToPrecisionFloorRatio: z
          .number()
          .finite()
          .min(PRECISION_FLOOR_ULP_MULTIPLIER)
          .max(1e40),
        sourceEigenvalueRatios: z.tuple([
          z.literal(1),
          z.number().finite().positive().max(1),
          z.number().finite().nonnegative().max(1),
        ]),
        targetEigenvalueRatios: z.tuple([
          z.literal(1),
          z.number().finite().positive().max(1),
          z.number().finite().nonnegative().max(1),
        ]),
        crossCovarianceSingularValueRatios: z.tuple([
          z.literal(1),
          z.number().finite().positive().max(1),
          z.number().finite().nonnegative().max(1),
        ]),
        crossCovarianceDeterminant: z
          .number()
          .finite()
          .min(-1e80)
          .max(1e80),
      })
      .strict(),
    fitEvaluation: FoundryMetricRegistrationEvaluationV0Schema.extend({
      partition: z.literal("fit"),
    }).strict(),
    heldOutEvaluation: FoundryMetricRegistrationEvaluationV0Schema.extend({
      partition: z.literal("held_out"),
    }).strict(),
    sourceOverlap: z
      .object({
        status: z.literal("not_computed"),
        overlapFraction: z.null(),
        evidenceSha256: z.null(),
      })
      .strict(),
    lineageInterpretation: z.literal(
      "declared_per_correspondence_not_independently_verified",
    ),
    reviewedTransformArtifact: z.literal("not_created"),
    authority: z
      .object({
        movableContent: z.literal("none"),
        measurement: z.literal("none"),
        export: z.literal("none"),
        runtime: z.literal("none"),
      })
      .strict(),
    releaseEligibility: z.literal("blocked"),
    releaseBlockers: z.tuple([
      z.literal("HUMAN_TRANSFORM_REVIEW_REQUIRED"),
      z.literal("MOVABLE_CONTENT_AUTHORITY_NONE"),
      z.literal("SOURCE_OVERLAP_NOT_COMPUTED"),
      z.literal("TRANSFORM_ARTIFACT_NOT_CREATED"),
    ]),
  })
  .strict();

type RegistrationProposalPayloadCandidate = z.infer<
  typeof FoundryMetricRegistrationPayloadObjectV0Schema
>;
type RegistrationEvaluationCandidate = z.infer<
  typeof FoundryMetricRegistrationEvaluationV0Schema
>;

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function vectorsNearlyEqual(left: Vec3, right: Vec3): boolean {
  return left.every((value, index) =>
    nearlyEqual(value, right[index] ?? Number.NaN),
  );
}

function applyColumnMajor(matrix: readonly number[], point: Vec3): [number, number, number] {
  return [
    (matrix[0] ?? 0) * point[0] +
      (matrix[4] ?? 0) * point[1] +
      (matrix[8] ?? 0) * point[2] +
      (matrix[12] ?? 0),
    (matrix[1] ?? 0) * point[0] +
      (matrix[5] ?? 0) * point[1] +
      (matrix[9] ?? 0) * point[2] +
      (matrix[13] ?? 0),
    (matrix[2] ?? 0) * point[0] +
      (matrix[6] ?? 0) * point[1] +
      (matrix[10] ?? 0) * point[2] +
      (matrix[14] ?? 0),
  ];
}

function validateProposalEvaluation(
  payload: RegistrationProposalPayloadCandidate,
  evaluation: RegistrationEvaluationCandidate,
  expectedIds: readonly string[],
  path: "fitEvaluation" | "heldOutEvaluation",
  bindings: ReadonlyMap<
    string,
    RegistrationProposalPayloadCandidate["correspondenceOrder"][number]
  >,
  ctx: z.RefinementCtx,
): void {
  const recordIds = evaluation.records.map(({ correspondenceId }) =>
    correspondenceId,
  );
  if (
    !arraysEqual(evaluation.correspondenceIds, expectedIds) ||
    !arraysEqual(recordIds, expectedIds)
  ) {
    addIssue(
      ctx,
      [path],
      `${path} records must preserve the exact declared partition order`,
    );
  }
  for (const [index, record] of evaluation.records.entries()) {
    const binding = bindings.get(record.correspondenceId);
    if (
      binding === undefined ||
      binding.correspondenceSha256 !== record.correspondenceSha256 ||
      binding.sourcePointId !== record.sourcePointId ||
      binding.sourceEvidenceSha256 !== record.sourceEvidenceSha256 ||
      binding.targetPointId !== record.targetPointId ||
      binding.targetEvidenceSha256 !== record.targetEvidenceSha256 ||
      binding.lineageClassification !== record.lineageClassification
    ) {
      addIssue(
        ctx,
        [path, "records", index],
        "residual record identity must match its exact ordered correspondence binding",
      );
      continue;
    }
    const reconstructedCorrespondence = {
      correspondenceId: record.correspondenceId,
      source: {
        pointId: record.sourcePointId,
        evidenceSha256: record.sourceEvidenceSha256,
        coordinates: record.sourceCoordinates,
      },
      target: {
        pointId: record.targetPointId,
        evidenceSha256: record.targetEvidenceSha256,
        coordinates: record.targetCoordinatesM,
      },
      lineageClassification: record.lineageClassification,
    };
    if (
      computeFoundryMetricRegistrationCorrespondenceSha256(
        reconstructedCorrespondence,
      ) !== record.correspondenceSha256
    ) {
      addIssue(
        ctx,
        [path, "records", index, "correspondenceSha256"],
        "correspondence digest must bind the exact identities and coordinates",
      );
    }
    const predicted = applyColumnMajor(
      payload.solve.matrixColumnMajor,
      record.sourceCoordinates,
    );
    const residual = vectorSubtract(predicted, record.targetCoordinatesM);
    const residualMeters = Math.hypot(...residual);
    if (!vectorsNearlyEqual(record.predictedTargetCoordinatesM, predicted)) {
      addIssue(
        ctx,
        [path, "records", index, "predictedTargetCoordinatesM"],
        "prediction must use the declared column-major transform",
      );
    }
    if (!vectorsNearlyEqual(record.residualVectorM, residual)) {
      addIssue(
        ctx,
        [path, "records", index, "residualVectorM"],
        "residual vector must equal predicted target minus exact target",
      );
    }
    if (!nearlyEqual(record.residualMeters, residualMeters)) {
      addIssue(
        ctx,
        [path, "records", index, "residualMeters"],
        "residual distance must equal the residual-vector norm",
      );
    }
  }
  const expectedStats = residualStats(evaluation.records);
  if (evaluation.stats.count !== expectedStats.count) {
    addIssue(ctx, [path, "stats", "count"], "residual count must match records");
  }
  for (const metric of [
    "meanMeters",
    "medianMeters",
    "rmseMeters",
    "p95Meters",
    "maxMeters",
  ] as const) {
    if (!nearlyEqual(evaluation.stats[metric], expectedStats[metric])) {
      addIssue(
        ctx,
        [path, "stats", metric],
        `${metric} must be derived from the exact residual records`,
      );
    }
  }
  const expectedLineage = evaluation.records.every(
    ({ lineageClassification }) => lineageClassification === "independent",
  )
    ? "independent"
    : "shared_lineage";
  if (evaluation.lineageClassification !== expectedLineage) {
    addIssue(
      ctx,
      [path, "lineageClassification"],
      "evaluation lineage must conservatively reflect every correspondence",
    );
  }
}

function validateProposalPayload(
  payload: RegistrationProposalPayloadCandidate,
  ctx: z.RefinementCtx,
): void {
  const evaluationNumbers = [
    ...payload.fitEvaluation.records.flatMap((record) => [
      ...record.predictedTargetCoordinatesM,
      ...record.residualVectorM,
      record.residualMeters,
    ]),
    ...payload.heldOutEvaluation.records.flatMap((record) => [
      ...record.predictedTargetCoordinatesM,
      ...record.residualVectorM,
      record.residualMeters,
    ]),
    ...Object.values(payload.fitEvaluation.stats),
    ...Object.values(payload.heldOutEvaluation.stats),
  ];
  if (
    payload.solve.uniformScaleTargetMetersPerSourceUnit <= MIN_STABLE_SCALE ||
    payload.solve.uniformScaleTargetMetersPerSourceUnit >= MAX_STABLE_SCALE ||
    payload.solve.matrixColumnMajor.some(
      (value) =>
        !Number.isFinite(value) ||
        Math.abs(value) > FOUNDRY_METRIC_REGISTRATION_MAX_ABS_OUTPUT_METERS,
    ) ||
    evaluationNumbers.some(
      (value) =>
        !Number.isFinite(value) ||
        Math.abs(value) > FOUNDRY_METRIC_REGISTRATION_MAX_ABS_OUTPUT_METERS,
    )
  ) {
    addIssue(
      ctx,
      ["solve"],
      "derived solve and evaluation values must remain within the bounded numerical envelope",
    );
    return;
  }
  const matrixScale = Math.hypot(
    payload.solve.matrixColumnMajor[0] ?? 0,
    payload.solve.matrixColumnMajor[1] ?? 0,
    payload.solve.matrixColumnMajor[2] ?? 0,
  );
  if (!nearlyEqual(matrixScale, payload.solve.uniformScaleTargetMetersPerSourceUnit)) {
    addIssue(ctx, ["solve", "matrixColumnMajor"], "matrix scale must match the declared uniform scale");
  }
  if (!nearlyEqual(payload.solve.rotationDeterminant, 1)) {
    addIssue(ctx, ["solve", "rotationDeterminant"], "proper rotation determinant must be +1");
  }
  const correspondenceIds = payload.correspondenceOrder.map(
    ({ correspondenceId }) => correspondenceId,
  );
  const bindings = new Map(
    payload.correspondenceOrder.map((binding) => [
      binding.correspondenceId,
      binding,
    ]),
  );
  if (bindings.size !== payload.correspondenceOrder.length) {
    addIssue(
      ctx,
      ["correspondenceOrder"],
      "ordered correspondence bindings must have unique IDs",
    );
  }
  const partitionIds = [
    ...payload.partitions.fitCorrespondenceIds,
    ...payload.partitions.heldOutCorrespondenceIds,
  ];
  if (
    new Set(partitionIds).size !== partitionIds.length ||
    partitionIds.length !== correspondenceIds.length ||
    correspondenceIds.some((id) => !partitionIds.includes(id))
  ) {
    addIssue(
      ctx,
      ["partitions"],
      "proposal partitions must cover every ordered correspondence exactly once",
    );
  }
  validateProposalEvaluation(
    payload,
    payload.fitEvaluation,
    payload.partitions.fitCorrespondenceIds,
    "fitEvaluation",
    bindings,
    ctx,
  );
  validateProposalEvaluation(
    payload,
    payload.heldOutEvaluation,
    payload.partitions.heldOutCorrespondenceIds,
    "heldOutEvaluation",
    bindings,
    ctx,
  );
  const recordById = new Map(
    [
      ...payload.fitEvaluation.records,
      ...payload.heldOutEvaluation.records,
    ].map((record) => [record.correspondenceId, record]),
  );
  const reconstructedCorrespondences = payload.correspondenceOrder.flatMap(
    (binding) => {
      const record = recordById.get(binding.correspondenceId);
      return record === undefined
        ? []
        : [
            {
              correspondenceId: binding.correspondenceId,
              source: {
                pointId: binding.sourcePointId,
                evidenceSha256: binding.sourceEvidenceSha256,
                coordinates: record.sourceCoordinates,
              },
              target: {
                pointId: binding.targetPointId,
                evidenceSha256: binding.targetEvidenceSha256,
                coordinates: record.targetCoordinatesM,
              },
              lineageClassification: binding.lineageClassification,
            },
          ];
    },
  );
  let reconstructedInput: FoundryMetricRegistrationInputV0 | null = null;
  if (reconstructedCorrespondences.length !== payload.correspondenceOrder.length) {
    addIssue(
      ctx,
      ["correspondenceOrder"],
      "every ordered correspondence must have exactly one residual record",
    );
  } else {
    const reconstructedInputResult = FoundryMetricRegistrationInputV0Schema.safeParse({
      schemaVersion: FOUNDRY_METRIC_REGISTRATION_INPUT_V0,
      proposalId: payload.proposalId,
      source: payload.source,
      target: payload.target,
      correspondences: reconstructedCorrespondences,
      partitions: payload.partitions,
    });
    if (
      !reconstructedInputResult.success ||
      computeFoundryMetricRegistrationInputSha256(reconstructedInputResult.data) !==
        payload.registrationInputSha256
    ) {
      addIssue(
        ctx,
        ["registrationInputSha256"],
        "input digest must bind the reconstructed exact roots, frames, correspondence order, coordinates, and partitions",
      );
    } else {
      reconstructedInput = reconstructedInputResult.data;
    }
  }
  const fitSourcePoints = payload.fitEvaluation.records.map(
    ({ sourceCoordinates }) => sourceCoordinates,
  );
  const fitTargetPoints = payload.fitEvaluation.records.map(
    ({ targetCoordinatesM }) => targetCoordinatesM,
  );
  try {
    const expectedConditioning = assertReflectionAndConditioning(
      fitSourcePoints,
      fitTargetPoints,
    );
    const expectedFit = fitProperSimilarity(
      fitSourcePoints,
      fitTargetPoints,
    );
    if (
      payload.solve.uniformScaleTargetMetersPerSourceUnit !==
        expectedFit.scale ||
      payload.solve.rotationDeterminant !== expectedFit.rotationDeterminant ||
      payload.solve.matrixColumnMajor.some(
        (value, index) => value !== expectedFit.matrixColumnMajor[index],
      )
    ) {
      addIssue(
        ctx,
        ["solve"],
        "solve must exactly reproduce the deterministic proper similarity optimum from the frozen fit records",
      );
    }
    const expectedClassification =
      expectedConditioning.sourceCondition.fullRank &&
      expectedConditioning.targetCondition.fullRank
        ? "well_conditioned_3d"
        : "well_conditioned_planar";
    const conditioningMatches =
      payload.conditioning.classification === expectedClassification &&
      payload.conditioning.sourceRmsRadius ===
        expectedConditioning.sourceCondition.rmsRadius &&
      payload.conditioning.targetRmsRadiusM ===
        expectedConditioning.targetCondition.rmsRadius &&
      payload.conditioning.sourcePrecisionFloor ===
        expectedConditioning.sourceCondition.precisionFloor &&
      payload.conditioning.targetPrecisionFloorM ===
        expectedConditioning.targetCondition.precisionFloor &&
      payload.conditioning.sourceRmsToPrecisionFloorRatio ===
        expectedConditioning.sourceCondition.rmsToPrecisionFloorRatio &&
      payload.conditioning.targetRmsToPrecisionFloorRatio ===
        expectedConditioning.targetCondition.rmsToPrecisionFloorRatio &&
      payload.conditioning.sourceEigenvalueRatios.every(
        (value, index) =>
          value ===
          expectedConditioning.sourceCondition.eigenvalueRatios[index],
      ) &&
      payload.conditioning.targetEigenvalueRatios.every(
        (value, index) =>
          value ===
          expectedConditioning.targetCondition.eigenvalueRatios[index],
      ) &&
      payload.conditioning.crossCovarianceSingularValueRatios.every(
        (value, index) =>
          value ===
          expectedConditioning.crossCovarianceSingularValueRatios[index],
      ) &&
      payload.conditioning.crossCovarianceDeterminant ===
        expectedConditioning.covarianceDeterminant;
    if (!conditioningMatches) {
      addIssue(
        ctx,
        ["conditioning"],
        "conditioning must be recomputed from the exact frozen fit correspondence coordinates",
      );
    }
    if (reconstructedInput !== null) {
      const correspondenceById = new Map(
        reconstructedInput.correspondences.map((correspondence) => [
          correspondence.correspondenceId,
          correspondence,
        ]),
      );
      const expectedFitEvaluation = compileEvaluation(
        "fit",
        reconstructedInput.partitions.fitCorrespondenceIds,
        correspondenceById,
        expectedFit,
      );
      const expectedHeldOutEvaluation = compileEvaluation(
        "held_out",
        reconstructedInput.partitions.heldOutCorrespondenceIds,
        correspondenceById,
        expectedFit,
      );
      if (
        stableCanonicalJson(toCanonicalJson(payload.fitEvaluation)) !==
          stableCanonicalJson(toCanonicalJson(expectedFitEvaluation)) ||
        stableCanonicalJson(toCanonicalJson(payload.heldOutEvaluation)) !==
          stableCanonicalJson(toCanonicalJson(expectedHeldOutEvaluation))
      ) {
        addIssue(
          ctx,
          ["fitEvaluation"],
          "fit and held-out evaluations must exactly reproduce from the frozen correspondences and deterministic solve",
        );
      }
    }
  } catch (error: unknown) {
    addIssue(
      ctx,
      ["solve"],
      error instanceof Error
        ? `embedded fit records cannot reproduce a valid solve: ${error.message}`
        : "embedded fit records cannot reproduce a valid solve",
    );
  }
}

export const FoundryMetricRegistrationProposalPayloadV0Schema =
  FoundryMetricRegistrationPayloadObjectV0Schema.superRefine(
    validateProposalPayload,
  );
export type FoundryMetricRegistrationProposalPayloadV0 = z.infer<
  typeof FoundryMetricRegistrationProposalPayloadV0Schema
>;

export const FoundryMetricRegistrationProposalV0Schema =
  FoundryMetricRegistrationPayloadObjectV0Schema.extend({
    proposalSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((proposal, ctx) => {
      const { proposalSha256: _proposalSha256, ...payload } = proposal;
      const parsed = FoundryMetricRegistrationProposalPayloadV0Schema.safeParse(payload);
      if (!parsed.success) {
        addIssue(
          ctx,
          [],
          "proposal payload must remain internally reproducible and self-consistent",
        );
      } else if (
        proposal.proposalSha256 !==
        computeFoundryMetricRegistrationProposalSha256(parsed.data)
      ) {
        addIssue(
          ctx,
          ["proposalSha256"],
          "proposal digest must bind the exact canonical proposal payload",
        );
      }
    });
export type FoundryMetricRegistrationProposalV0 = z.infer<
  typeof FoundryMetricRegistrationProposalV0Schema
>;

function prefixedDigest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

export function computeFoundryMetricRegistrationInputSha256(
  input: FoundryMetricRegistrationInputV0,
): string {
  return prefixedDigest(
    INPUT_DIGEST_DOMAIN,
    FoundryMetricRegistrationInputV0Schema.parse(input),
  );
}

export function computeFoundryMetricRegistrationCorrespondenceSha256(
  correspondence: FoundryMetricRegistrationCorrespondenceV0,
): string {
  return prefixedDigest(
    CORRESPONDENCE_DIGEST_DOMAIN,
    FoundryMetricRegistrationCorrespondenceV0Schema.parse(correspondence),
  );
}

export function computeFoundryMetricRegistrationProposalSha256(
  proposal: FoundryMetricRegistrationProposalPayloadV0,
): string {
  return prefixedDigest(
    PROPOSAL_DIGEST_DOMAIN,
    FoundryMetricRegistrationProposalPayloadV0Schema.parse(proposal),
  );
}

function nearlyEqual(left: number, right: number, tolerance = 1e-9): boolean {
  return Math.abs(left - right) <=
    tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_NUMERIC_FAILURE",
      `${label} is not finite.`,
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function vectorAdd(left: Vec3, right: Vec3): [number, number, number] {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function vectorSubtract(left: Vec3, right: Vec3): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function vectorScale(value: Vec3, scale: number): [number, number, number] {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function centroid(points: readonly Vec3[]): [number, number, number] {
  const sum = points.reduce<[number, number, number]>(
    (total, point) => vectorAdd(total, point),
    [0, 0, 0],
  );
  return vectorScale(sum, 1 / points.length);
}

function centered(points: readonly Vec3[], center: Vec3): Vec3[] {
  return points.map((point) => vectorSubtract(point, center));
}

function requiredMatrixRow(matrix: number[][], index: number): number[] {
  const row = matrix[index];
  if (row === undefined) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_MATRIX_ROW_MISSING",
      "An internal registration matrix row is missing.",
    );
  }
  return row;
}

function scatterMatrix(points: readonly (readonly number[])[]): number[][] {
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const point of points) {
    for (let row = 0; row < 3; row += 1) {
      for (let column = row; column < 3; column += 1) {
        const value = (point[row] ?? 0) * (point[column] ?? 0);
        const rowValues = requiredMatrixRow(matrix, row);
        rowValues[column] = (rowValues[column] ?? 0) + value;
        if (row !== column) {
          const columnValues = requiredMatrixRow(matrix, column);
          columnValues[row] = rowValues[column] ?? 0;
        }
      }
    }
  }
  return matrix;
}

function crossCovariance(
  source: readonly Vec3[],
  target: readonly Vec3[],
): number[][] {
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let index = 0; index < source.length; index += 1) {
    const sourcePoint = source[index];
    const targetPoint = target[index];
    if (sourcePoint === undefined || targetPoint === undefined) {
      throw new FoundryIntegrityError(
        "METRIC_REGISTRATION_INTERNAL_PAIR_MISMATCH",
        "A fit correspondence pair is missing.",
      );
    }
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const rowValues = requiredMatrixRow(matrix, row);
        rowValues[column] =
          (rowValues[column] ?? 0) +
          (sourcePoint[row] ?? 0) * (targetPoint[column] ?? 0);
      }
    }
  }
  return matrix;
}

interface SymmetricEigenResult {
  readonly values: readonly number[];
  readonly vectorsByColumn: readonly (readonly number[])[];
}

function symmetricEigenJacobi(input: readonly (readonly number[])[]): SymmetricEigenResult {
  const size = input.length;
  if (size < 2 || input.some((row) => row.length !== size)) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_EIGEN_INPUT_INVALID",
      "Symmetric eigensolve requires a square matrix.",
    );
  }
  const matrix = input.map((row) => [...row]);
  const vectors: number[][] = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => (row === column ? 1 : 0)),
  );
  for (let sweep = 0; sweep < JACOBI_SWEEPS; sweep += 1) {
    let changed = false;
    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        const app = matrix[p]?.[p] ?? 0;
        const aqq = matrix[q]?.[q] ?? 0;
        const apq = matrix[p]?.[q] ?? 0;
        const threshold =
          Number.EPSILON *
          32 *
          Math.max(Number.MIN_VALUE, Math.abs(app), Math.abs(aqq), Math.abs(apq));
        if (Math.abs(apq) <= threshold) continue;
        changed = true;
        const tau = (aqq - app) / (2 * apq);
        const tangent =
          tau === 0
            ? 1
            : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const cosine = 1 / Math.sqrt(1 + tangent * tangent);
        const sine = tangent * cosine;

        for (let k = 0; k < size; k += 1) {
          if (k === p || k === q) continue;
          const akp = matrix[k]?.[p] ?? 0;
          const akq = matrix[k]?.[q] ?? 0;
          const nextKp = cosine * akp - sine * akq;
          const nextKq = sine * akp + cosine * akq;
          const kRow = requiredMatrixRow(matrix, k);
          const pRow = requiredMatrixRow(matrix, p);
          const qRow = requiredMatrixRow(matrix, q);
          kRow[p] = nextKp;
          pRow[k] = nextKp;
          kRow[q] = nextKq;
          qRow[k] = nextKq;
        }
        const pRow = requiredMatrixRow(matrix, p);
        const qRow = requiredMatrixRow(matrix, q);
        pRow[p] = app - tangent * apq;
        qRow[q] = aqq + tangent * apq;
        pRow[q] = 0;
        qRow[p] = 0;

        for (let row = 0; row < size; row += 1) {
          const vrp = vectors[row]?.[p] ?? 0;
          const vrq = vectors[row]?.[q] ?? 0;
          const vectorRow = requiredMatrixRow(vectors, row);
          vectorRow[p] = cosine * vrp - sine * vrq;
          vectorRow[q] = sine * vrp + cosine * vrq;
        }
      }
    }
    if (!changed) break;
  }
  const values = Array.from({ length: size }, (_, index) =>
    finiteNumber(matrix[index]?.[index] ?? Number.NaN, "eigenvalue"),
  );
  return { values, vectorsByColumn: vectors };
}

function descendingScatterEigenvalues(
  points: readonly (readonly number[])[],
): [number, number, number] {
  const result = symmetricEigenJacobi(scatterMatrix(points));
  const values = [...result.values]
    .map((value) => (value < 0 && Math.abs(value) < 1e-10 ? 0 : value))
    .sort((left, right) => right - left);
  const first = values[0];
  const second = values[1];
  const third = values[2];
  if (first === undefined || second === undefined || third === undefined) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_EIGEN_FAILURE",
      "Fit scatter eigenvalues are incomplete.",
    );
  }
  return [first, second, third];
}

function determinant3(matrix: readonly (readonly number[])[]): number {
  const a = matrix[0]?.[0] ?? 0;
  const b = matrix[0]?.[1] ?? 0;
  const c = matrix[0]?.[2] ?? 0;
  const d = matrix[1]?.[0] ?? 0;
  const e = matrix[1]?.[1] ?? 0;
  const f = matrix[1]?.[2] ?? 0;
  const g = matrix[2]?.[0] ?? 0;
  const h = matrix[2]?.[1] ?? 0;
  const i = matrix[2]?.[2] ?? 0;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function rowGramMatrix(matrix: readonly (readonly number[])[]): number[][] {
  return Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) => {
      const rowValues = matrix[row] ?? [];
      const columnValues = matrix[column] ?? [];
      return (
        (rowValues[0] ?? 0) * (columnValues[0] ?? 0) +
        (rowValues[1] ?? 0) * (columnValues[1] ?? 0) +
        (rowValues[2] ?? 0) * (columnValues[2] ?? 0)
      );
    }),
  );
}

interface GeometryCondition {
  readonly rmsRadius: number;
  readonly precisionFloor: number;
  readonly rmsToPrecisionFloorRatio: number;
  readonly eigenvalueRatios: readonly [1, number, number];
  readonly fullRank: boolean;
}

function assessGeometry(
  centeredPoints: readonly Vec3[],
  rawPoints: readonly Vec3[],
  label: string,
): GeometryCondition {
  const eigenvalues = descendingScatterEigenvalues(centeredPoints);
  const largest = eigenvalues[0];
  if (!Number.isFinite(largest) || largest <= 0) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_DEGENERATE_POINTS",
      `${label} fit points have no measurable spread.`,
    );
  }
  const secondRatio = eigenvalues[1] / largest;
  const thirdRatio = Math.max(0, eigenvalues[2] / largest);
  const rmsRadius = Math.sqrt(
    eigenvalues.reduce((sum, value) => sum + Math.max(0, value), 0) /
      centeredPoints.length,
  );
  if (
    !Number.isFinite(rmsRadius) ||
    rmsRadius < MIN_RMS_RADIUS ||
    secondRatio < MIN_SECOND_EIGENVALUE_RATIO
  ) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_DEGENERATE_POINTS",
      `${label} fit points are coincident, collinear, or numerically ill-conditioned.`,
    );
  }
  const maxAbsoluteCoordinate = rawPoints.reduce(
    (maximum, point) =>
      Math.max(maximum, Math.abs(point[0]), Math.abs(point[1]), Math.abs(point[2])),
    1,
  );
  const precisionFloor = Number.EPSILON * maxAbsoluteCoordinate;
  const rmsToPrecisionFloorRatio = rmsRadius / precisionFloor;
  if (rmsToPrecisionFloorRatio < PRECISION_FLOOR_ULP_MULTIPLIER) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_PRECISION_UNSAFE",
      `${label} fit-point spread is too small relative to its absolute coordinate magnitude for a stable double-precision solve.`,
    );
  }
  return {
    rmsRadius,
    precisionFloor,
    rmsToPrecisionFloorRatio,
    eigenvalueRatios: [1, secondRatio, thirdRatio],
    fullRank: thirdRatio >= FULL_RANK_EIGENVALUE_RATIO,
  };
}

function assessCrossCovariance(
  covariance: readonly (readonly number[])[],
  requireFullRank: boolean,
): readonly [1, number, number] {
  const eigenvalues = descendingScatterEigenvalues(rowGramMatrix(covariance));
  const largest = eigenvalues[0];
  if (!Number.isFinite(largest) || largest <= 0) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_ROTATION_UNSTABLE",
      "Fit correspondences do not constrain a stable rotation.",
    );
  }
  const secondRatio = Math.sqrt(Math.max(0, eigenvalues[1] / largest));
  const thirdRatio = Math.sqrt(Math.max(0, eigenvalues[2] / largest));
  if (
    secondRatio < MIN_SECOND_EIGENVALUE_RATIO ||
    (requireFullRank && thirdRatio < FULL_RANK_EIGENVALUE_RATIO)
  ) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_ROTATION_UNSTABLE",
      "Fit cross-covariance is rank-deficient or numerically ill-conditioned for the declared geometry.",
    );
  }
  return [1, secondRatio, thirdRatio];
}

function quaternionMatrix(covariance: readonly (readonly number[])[]): number[][] {
  const sxx = covariance[0]?.[0] ?? 0;
  const sxy = covariance[0]?.[1] ?? 0;
  const sxz = covariance[0]?.[2] ?? 0;
  const syx = covariance[1]?.[0] ?? 0;
  const syy = covariance[1]?.[1] ?? 0;
  const syz = covariance[1]?.[2] ?? 0;
  const szx = covariance[2]?.[0] ?? 0;
  const szy = covariance[2]?.[1] ?? 0;
  const szz = covariance[2]?.[2] ?? 0;
  return [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
}

function maximalQuaternion(covariance: readonly (readonly number[])[]): [number, number, number, number] {
  const eigen = symmetricEigenJacobi(quaternionMatrix(covariance));
  let maximalIndex = 0;
  for (let index = 1; index < eigen.values.length; index += 1) {
    if ((eigen.values[index] ?? -Infinity) > (eigen.values[maximalIndex] ?? -Infinity)) {
      maximalIndex = index;
    }
  }
  const raw = eigen.vectorsByColumn.map((row) => row[maximalIndex] ?? 0);
  const norm = Math.hypot(...raw);
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_ROTATION_UNSTABLE",
      "The proper-rotation eigensolve did not produce a stable quaternion.",
    );
  }
  let quaternion = raw.map((value) => value / norm);
  const firstNonZero = quaternion.find((value) => Math.abs(value) > Number.EPSILON);
  if (firstNonZero !== undefined && firstNonZero < 0) {
    quaternion = quaternion.map((value) => -value);
  }
  return [
    quaternion[0] ?? 1,
    quaternion[1] ?? 0,
    quaternion[2] ?? 0,
    quaternion[3] ?? 0,
  ];
}

function rotationFromQuaternion(quaternion: readonly [number, number, number, number]): Matrix3Rows {
  const [w, x, y, z] = quaternion;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

function applyRotation(rotation: Matrix3Rows, point: Vec3): [number, number, number] {
  return [
    dot(rotation[0], point),
    dot(rotation[1], point),
    dot(rotation[2], point),
  ];
}

interface SimilarityFit {
  readonly scale: number;
  readonly rotation: Matrix3Rows;
  readonly translation: Vec3;
  readonly rotationDeterminant: number;
  readonly matrixColumnMajor: readonly number[];
  readonly apply: (point: Vec3) => [number, number, number];
}

function fitProperSimilarity(source: readonly Vec3[], target: readonly Vec3[]): SimilarityFit {
  const sourceCenter = centroid(source);
  const targetCenter = centroid(target);
  const sourceCentered = centered(source, sourceCenter);
  const targetCentered = centered(target, targetCenter);
  const covariance = crossCovariance(sourceCentered, targetCentered);
  const rotation = rotationFromQuaternion(maximalQuaternion(covariance));
  const rotationDeterminant = determinant3(rotation);
  if (!nearlyEqual(rotationDeterminant, 1, 1e-8)) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_ROTATION_NOT_PROPER",
      "The solved rotation does not preserve handedness.",
    );
  }
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < sourceCentered.length; index += 1) {
    const sourcePoint = sourceCentered[index];
    const targetPoint = targetCentered[index];
    if (sourcePoint === undefined || targetPoint === undefined) {
      throw new FoundryIntegrityError(
        "METRIC_REGISTRATION_INTERNAL_PAIR_MISMATCH",
        "A centered fit correspondence pair is missing.",
      );
    }
    numerator += dot(applyRotation(rotation, sourcePoint), targetPoint);
    denominator += dot(sourcePoint, sourcePoint);
  }
  const scale = finiteNumber(numerator / denominator, "uniform scale");
  if (scale <= MIN_STABLE_SCALE || scale >= MAX_STABLE_SCALE) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_SCALE_UNSTABLE",
      `Solved scale ${String(scale)} is non-positive or outside the stable local proposal range.`,
    );
  }
  const rotatedSourceCenter = applyRotation(rotation, sourceCenter);
  const translation = vectorSubtract(
    targetCenter,
    vectorScale(rotatedSourceCenter, scale),
  );
  const apply = (point: Vec3): [number, number, number] =>
    vectorAdd(vectorScale(applyRotation(rotation, point), scale), translation);
  const matrixColumnMajor = [
    scale * rotation[0][0],
    scale * rotation[1][0],
    scale * rotation[2][0],
    0,
    scale * rotation[0][1],
    scale * rotation[1][1],
    scale * rotation[2][1],
    0,
    scale * rotation[0][2],
    scale * rotation[1][2],
    scale * rotation[2][2],
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ].map((value) => finiteNumber(value, "similarity matrix member"));
  return {
    scale,
    rotation,
    translation,
    rotationDeterminant,
    matrixColumnMajor,
    apply,
  };
}

function linearPercentile(sorted: readonly number[], percentile: number): number {
  const position = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function residualStats(
  records: readonly { readonly residualMeters: number }[],
): z.infer<typeof FoundryMetricRegistrationResidualStatsV0Schema> {
  const values = records
    .map(({ residualMeters }) => residualMeters)
    .sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total + value, 0);
  const maxMeters = values.at(-1) ?? 0;
  const normalizedSumSquares =
    maxMeters === 0
      ? 0
      : values.reduce(
          (total, value) => total + (value / maxMeters) ** 2,
          0,
        );
  return {
    count: values.length,
    meanMeters: sum / values.length,
    medianMeters: linearPercentile(values, 0.5),
    rmseMeters:
      maxMeters * Math.sqrt(normalizedSumSquares / values.length),
    p95Meters: linearPercentile(values, 0.95),
    maxMeters,
  };
}

function compileResidualRecord(
  correspondence: FoundryMetricRegistrationCorrespondenceV0,
  fit: SimilarityFit,
) {
  const predicted = fit.apply(correspondence.source.coordinates);
  const residualVector = vectorSubtract(predicted, correspondence.target.coordinates);
  const residualMeters = Math.hypot(...residualVector);
  const result = FoundryMetricRegistrationResidualRecordV0Schema.safeParse({
    correspondenceId: correspondence.correspondenceId,
    correspondenceSha256:
      computeFoundryMetricRegistrationCorrespondenceSha256(correspondence),
    sourcePointId: correspondence.source.pointId,
    sourceEvidenceSha256: correspondence.source.evidenceSha256,
    targetPointId: correspondence.target.pointId,
    targetEvidenceSha256: correspondence.target.evidenceSha256,
    lineageClassification: correspondence.lineageClassification,
    sourceCoordinates: correspondence.source.coordinates,
    targetCoordinatesM: correspondence.target.coordinates,
    predictedTargetCoordinatesM: predicted,
    residualVectorM: residualVector,
    residualMeters,
  });
  if (!result.success) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_OUTPUT_INVALID",
      "A derived registration residual exceeded the bounded output contract.",
      { cause: result.error },
    );
  }
  return result.data;
}

function evaluationLineage(
  correspondences: readonly FoundryMetricRegistrationCorrespondenceV0[],
): "independent" | "shared_lineage" {
  return correspondences.every(
    ({ lineageClassification }) => lineageClassification === "independent",
  )
    ? "independent"
    : "shared_lineage";
}

function compileEvaluation(
  partition: "fit" | "held_out",
  ids: readonly string[],
  byId: ReadonlyMap<string, FoundryMetricRegistrationCorrespondenceV0>,
  fit: SimilarityFit,
) {
  const correspondences = ids.map((id) => {
    const correspondence = byId.get(id);
    if (correspondence === undefined) {
      throw new FoundryIntegrityError(
        "METRIC_REGISTRATION_PARTITION_SUBSTITUTION",
        `Partition correspondence ${id} is not present in the exact ordered input.`,
      );
    }
    return correspondence;
  });
  const records = correspondences.map((correspondence) =>
    compileResidualRecord(correspondence, fit),
  );
  const result = FoundryMetricRegistrationEvaluationV0Schema.safeParse({
    partition,
    correspondenceIds: [...ids],
    lineageClassification: evaluationLineage(correspondences),
    records,
    stats: residualStats(records),
  });
  if (!result.success) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_OUTPUT_INVALID",
      "A derived registration evaluation exceeded the bounded output contract.",
      { cause: result.error },
    );
  }
  return result.data;
}

function assertReflectionAndConditioning(
  sourcePoints: readonly Vec3[],
  targetPoints: readonly Vec3[],
) {
  const sourceCentered = centered(sourcePoints, centroid(sourcePoints));
  const targetCentered = centered(targetPoints, centroid(targetPoints));
  const sourceCondition = assessGeometry(
    sourceCentered,
    sourcePoints,
    "source",
  );
  const targetCondition = assessGeometry(
    targetCentered,
    targetPoints,
    "target",
  );
  if (sourceCondition.fullRank !== targetCondition.fullRank) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_DIMENSIONALITY_MISMATCH",
      "Source and target fit points do not have the same stable geometric rank.",
    );
  }
  const covariance = crossCovariance(sourceCentered, targetCentered);
  const covarianceDeterminant = finiteNumber(
    determinant3(covariance),
    "cross-covariance determinant",
  );
  const crossCovarianceSingularValueRatios = assessCrossCovariance(
    covariance,
    sourceCondition.fullRank,
  );
  if (sourceCondition.fullRank && covarianceDeterminant < 0) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_REFLECTION_FORBIDDEN",
      "The full-rank fit correspondence geometry requires a mirrored transform; only determinant +1 rotation is allowed.",
    );
  }
  return {
    sourceCondition,
    targetCondition,
    crossCovarianceSingularValueRatios,
    covarianceDeterminant,
  };
}

export function compileFoundryMetricRegistrationProposalV0(
  input: unknown,
): FoundryMetricRegistrationProposalV0 {
  const parsedInput = FoundryMetricRegistrationInputV0Schema.safeParse(input);
  if (!parsedInput.success) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_INPUT_INVALID",
      "Metric registration requires strict, bounded roots, frames, correspondences, and predeclared partitions.",
      { cause: parsedInput.error },
    );
  }
  const parsed = parsedInput.data;
  const byId = new Map(
    parsed.correspondences.map((correspondence) => [
      correspondence.correspondenceId,
      correspondence,
    ]),
  );
  const fitCorrespondences = parsed.partitions.fitCorrespondenceIds.map((id) => {
    const correspondence = byId.get(id);
    if (correspondence === undefined) {
      throw new FoundryIntegrityError(
        "METRIC_REGISTRATION_PARTITION_SUBSTITUTION",
        `Fit correspondence ${id} is missing.`,
      );
    }
    return correspondence;
  });
  const sourcePoints = fitCorrespondences.map(({ source }) => source.coordinates);
  const targetPoints = fitCorrespondences.map(({ target }) => target.coordinates);
  const conditioning = assertReflectionAndConditioning(
    sourcePoints,
    targetPoints,
  );
  const fit = fitProperSimilarity(sourcePoints, targetPoints);
  const fitEvaluation = compileEvaluation(
    "fit",
    parsed.partitions.fitCorrespondenceIds,
    byId,
    fit,
  );
  const heldOutEvaluation = compileEvaluation(
    "held_out",
    parsed.partitions.heldOutCorrespondenceIds,
    byId,
    fit,
  );
  const payloadResult = FoundryMetricRegistrationProposalPayloadV0Schema.safeParse({
    schemaVersion: FOUNDRY_METRIC_REGISTRATION_PROPOSAL_V0,
    status: "local_unverified_registration_proposal",
    proposalId: parsed.proposalId,
    registrationInputSha256:
      computeFoundryMetricRegistrationInputSha256(parsed),
    source: parsed.source,
    target: parsed.target,
    correspondenceOrder: parsed.correspondences.map((correspondence) => ({
      correspondenceId: correspondence.correspondenceId,
      correspondenceSha256:
        computeFoundryMetricRegistrationCorrespondenceSha256(correspondence),
      sourcePointId: correspondence.source.pointId,
      sourceEvidenceSha256: correspondence.source.evidenceSha256,
      targetPointId: correspondence.target.pointId,
      targetEvidenceSha256: correspondence.target.evidenceSha256,
      lineageClassification: correspondence.lineageClassification,
    })),
    partitions: parsed.partitions,
    solve: {
      method: "proper_3d_similarity_horn_jacobi",
      transformDirection: "source_to_target",
      vectorConvention: "column_vector_target_equals_matrix_times_source",
      matrixLayout: "4x4_column_major",
      uniformScaleTargetMetersPerSourceUnit: fit.scale,
      rotationDeterminant: fit.rotationDeterminant,
      matrixColumnMajor: fit.matrixColumnMajor,
    },
    conditioning: {
      classification:
        conditioning.sourceCondition.fullRank && conditioning.targetCondition.fullRank
          ? "well_conditioned_3d"
          : "well_conditioned_planar",
      sourceRmsRadius: conditioning.sourceCondition.rmsRadius,
      targetRmsRadiusM: conditioning.targetCondition.rmsRadius,
      sourcePrecisionFloor: conditioning.sourceCondition.precisionFloor,
      targetPrecisionFloorM: conditioning.targetCondition.precisionFloor,
      sourceRmsToPrecisionFloorRatio:
        conditioning.sourceCondition.rmsToPrecisionFloorRatio,
      targetRmsToPrecisionFloorRatio:
        conditioning.targetCondition.rmsToPrecisionFloorRatio,
      sourceEigenvalueRatios: conditioning.sourceCondition.eigenvalueRatios,
      targetEigenvalueRatios: conditioning.targetCondition.eigenvalueRatios,
      crossCovarianceSingularValueRatios:
        conditioning.crossCovarianceSingularValueRatios,
      crossCovarianceDeterminant: conditioning.covarianceDeterminant,
    },
    fitEvaluation,
    heldOutEvaluation,
    sourceOverlap: {
      status: "not_computed",
      overlapFraction: null,
      evidenceSha256: null,
    },
    lineageInterpretation:
      "declared_per_correspondence_not_independently_verified",
    reviewedTransformArtifact: "not_created",
    authority: {
      movableContent: "none",
      measurement: "none",
      export: "none",
      runtime: "none",
    },
    releaseEligibility: "blocked",
    releaseBlockers: [
      "HUMAN_TRANSFORM_REVIEW_REQUIRED",
      "MOVABLE_CONTENT_AUTHORITY_NONE",
      "SOURCE_OVERLAP_NOT_COMPUTED",
      "TRANSFORM_ARTIFACT_NOT_CREATED",
    ],
  });
  if (!payloadResult.success) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_OUTPUT_INVALID",
      "The deterministic registration solve could not form a bounded self-consistent proposal payload.",
      { cause: payloadResult.error },
    );
  }
  const payload = payloadResult.data;
  const proposalResult = FoundryMetricRegistrationProposalV0Schema.safeParse({
    ...payload,
    proposalSha256:
      computeFoundryMetricRegistrationProposalSha256(payload),
  });
  if (!proposalResult.success) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_OUTPUT_INVALID",
      "The deterministic registration proposal failed its self-verification contract.",
      { cause: proposalResult.error },
    );
  }
  return proposalResult.data;
}

/**
 * Recompiles every output byte from the exact input. A caller-resealed proposal
 * cannot substitute correspondences, partitions, roots, frames, or metrics.
 */
export function verifyFoundryMetricRegistrationProposalV0(
  proposalInput: unknown,
  exactInput: unknown,
): FoundryMetricRegistrationProposalV0 {
  const proposal = FoundryMetricRegistrationProposalV0Schema.parse(proposalInput);
  const expected = compileFoundryMetricRegistrationProposalV0(exactInput);
  if (
    stableCanonicalJson(toCanonicalJson(proposal)) !==
    stableCanonicalJson(toCanonicalJson(expected))
  ) {
    throw new FoundryIntegrityError(
      "METRIC_REGISTRATION_RECOMPUTATION_MISMATCH",
      "The registration proposal does not reproduce from the exact roots, frames, correspondences, and frozen partitions.",
    );
  }
  return proposal;
}

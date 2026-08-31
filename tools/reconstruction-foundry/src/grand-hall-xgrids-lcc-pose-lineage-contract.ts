import { z } from "zod";

export const GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_SCHEMA =
  "venviewer.grand-hall.xgrids-lcc-pose-lineage-authority-none.v1";
export const GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_STATE =
  "raw_to_processed_trajectory_lineage_candidate_metric_and_optical_authority_blocked";
export const GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_DOMAIN =
  "VENVIEWER.GRAND_HALL.XGRIDS_LCC.POSE_LINEAGE.AUTHORITY_NONE.V1";

const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const FiniteNumberSchema = z.number().finite();
const DecimalIntegerSchema = z.string().regex(/^(?:0|[1-9]\d*)$/u);
export const GrandHallPoseLineageRelativePathSchema = z.string().min(1).refine(
  (value) => {
    if (
      value.startsWith("/") || value.endsWith("/") || value.includes("\\") ||
      value.includes(":") || value.includes("\u0000")
    ) {
      return false;
    }
    return value.split("/").every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
  },
  "Relative evidence path must be a normalized, traversal-free POSIX path.",
);
const Vector3Schema = z.tuple([
  FiniteNumberSchema,
  FiniteNumberSchema,
  FiniteNumberSchema,
]);
const QuaternionSchema = z.tuple([
  FiniteNumberSchema,
  FiniteNumberSchema,
  FiniteNumberSchema,
  FiniteNumberSchema,
]);
const Matrix3Schema = z.tuple([
  Vector3Schema,
  Vector3Schema,
  Vector3Schema,
]);

export const GrandHallPoseLineageFileIdentitySchema = z.object({
  locator: z.string().min(1),
  byteLength: z.number().int().positive(),
  sha256: Sha256Schema,
}).strict();

export const GrandHallPoseLineageAuthorityGuardsSchema = z.object({
  authority: z.literal("none"),
  trajectoryLineageAccepted: z.literal(false),
  quaternionComponentOrderingAccepted: z.literal(false),
  cameraExtrinsicKnown: z.literal(false),
  poseDirectionKnown: z.literal(false),
  handednessKnown: z.literal(false),
  axisSemanticsKnown: z.literal(false),
  fovKnown: z.literal(false),
  intrinsicsKnown: z.literal(false),
  metricUnitsAccepted: z.literal(false),
  metricTransformAccepted: z.literal(false),
  e57ToXgridsTransformAccepted: z.literal(false),
  roomMembershipAccepted: z.literal(false),
  generatedContentUsed: z.literal(false),
  trainingPermitted: z.literal(false),
  reconstructionPermitted: z.literal(false),
  providerInputPermitted: z.literal(false),
  runtimePermitted: z.literal(false),
  stagingPermitted: z.literal(false),
  publicationPermitted: z.literal(false),
  productionTrustPermitted: z.literal(false),
}).strict();

const DistributionSchema = z.object({
  method: z.literal("sorted_nearest_rank_p95_population_mean"),
  count: z.number().int().positive(),
  minimum: FiniteNumberSchema.nonnegative(),
  median: FiniteNumberSchema.nonnegative(),
  mean: FiniteNumberSchema.nonnegative(),
  p95: FiniteNumberSchema.nonnegative(),
  maximum: FiniteNumberSchema.nonnegative(),
}).strict();

const SidecarIdentitySchema = z.object({
  packageName: z.string().regex(/^scans_BIG_MODEL_TH_GH_[1-9]$/u),
  relativePath: GrandHallPoseLineageRelativePathSchema,
  byteLength: z.number().int().positive(),
  sha256: Sha256Schema,
}).strict();

const PairSampleSchema = z.object({
  processedIndex: z.number().int().nonnegative(),
  rawIndex: z.number().int().nonnegative(),
  processedTimestampNanoseconds: DecimalIntegerSchema,
  rawTimestampNanoseconds: DecimalIntegerSchema,
  absoluteDeltaNanoseconds: z.number().int().nonnegative(),
}).strict();

const PermutationScoreSchema = z.object({
  rank: z.number().int().min(1).max(24),
  rawComponentOrderToProcessedTuple: z.string().regex(/^(?!.*(.).*\1)[xyzw]{4}$/u),
  signInvariantAngleDegrees: DistributionSchema,
  residualMicrodegreesSha256: Sha256Schema,
}).strict();

const ResidualSummarySchema = z.object({
  count: z.number().int().positive(),
  units: z.literal("unaccepted_source_coordinate_units"),
  rmse: FiniteNumberSchema.nonnegative(),
  median: FiniteNumberSchema.nonnegative(),
  p95: FiniteNumberSchema.nonnegative(),
  maximum: FiniteNumberSchema.nonnegative(),
  residualNanounitsSha256: Sha256Schema,
}).strict();

export const GrandHallXgridsLccPoseLineageMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_SCHEMA),
  state: z.literal(GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_STATE),
  authority: z.literal("none"),
  subject: z.object({
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    scope: z.literal("raw_xgrids_to_processed_lcc_pose_sidecar_lineage_diagnostic"),
  }).strict(),
  sourceBindings: z.object({
    rawSourcePolicy: z.object({
      locator: z.literal("XGRIDS_CAPTURE_ROOT"),
      policy: z.literal("GRAND_HALL_XGRIDS_SOURCE_POLICY_V1"),
      inventorySha256: Sha256Schema,
      fullTreeReverifiedByThisReceipt: z.literal(false),
    }).strict(),
    rawPosesCsv: GrandHallPoseLineageFileIdentitySchema.extend({
      locator: z.literal("XGRIDS_CAPTURE_ROOT/project_data/poses.csv"),
      rowCount: z.literal(42_850),
      columnCount: z.literal(8),
      timestampUnit: z.literal("seconds"),
      positionTupleSemantics: z.literal("unaccepted_raw_columns_1_2_3"),
      quaternionTupleSemantics: z.literal("unaccepted_raw_columns_4_5_6_7"),
    }).strict(),
    processedInventory: GrandHallPoseLineageFileIdentitySchema.extend({
      locator: z.literal("REPOSITORY/docs/operations/grand-hall-processed-big-inventory-v1.json"),
      schemaVersion: z.literal("venviewer.grand-hall.processed-big-inventory.v1"),
      inventoryId: z.literal("grand-hall-processed-big-inventory-2026-08-28-v1"),
      inventorySha256: Sha256Schema,
      manifestSha256: Sha256Schema,
    }).strict(),
    processedPoseSidecars: z.array(SidecarIdentitySchema).length(9),
    processedReportSidecars: z.array(SidecarIdentitySchema).length(9),
    sharedProcessedPoses: z.object({
      byteLength: z.number().int().positive(),
      sha256: Sha256Schema,
      poseCount: z.literal(21_417),
      fusionPoses: z.literal(null),
      rgbValues: z.literal("all_null"),
      allNineFilesByteIdentical: z.literal(true),
    }).strict(),
    sharedProcessedReport: z.object({
      byteLength: z.number().int().positive(),
      sha256: Sha256Schema,
      allNineFilesByteIdentical: z.literal(true),
    }).strict(),
  }).strict(),
  trajectoryPairing: z.object({
    method: z.literal("nearest_raw_timestamp_monotonic_tie_to_lower_index"),
    processedPoseCount: z.literal(21_417),
    rawPoseCount: z.literal(42_850),
    pairCount: z.literal(21_417),
    rawIndicesStrictlyIncreasing: z.literal(true),
    firstPair: PairSampleSchema,
    lastPair: PairSampleSchema,
    rawIndexIncrementHistogram: z.record(z.string().regex(/^[1-9]\d*$/u), z.number().int().positive()),
    absoluteTimestampDeltaNanoseconds: DistributionSchema,
    pairTableSha256: Sha256Schema,
  }).strict(),
  quaternionPermutationDiagnostic: z.object({
    method: z.literal("normalize_then_sign_invariant_geodesic_angle_all_24_component_permutations"),
    rawTupleSemanticsAccepted: z.literal(false),
    processedTupleSemanticsAccepted: z.literal(false),
    scores: z.array(PermutationScoreSchema).length(24),
    uniquelyBestCandidate: z.object({
      rawComponentOrderToProcessedTuple: z.literal("wxyz"),
      runnerUpRawComponentOrderToProcessedTuple: z.string().regex(/^(?!.*(.).*\1)[xyzw]{4}$/u),
      meanAngleMarginDegrees: FiniteNumberSchema.positive(),
      status: z.literal("candidate_component_ordering_only"),
    }).strict(),
  }).strict(),
  diagnosticSimilarityFit: z.object({
    method: z.literal("horn_similarity_raw_position_to_processed_translation"),
    split: z.object({
      method: z.literal("processed_index_modulo_5_equals_0_held_out"),
      fitCount: z.literal(17_133),
      heldOutCount: z.literal(4_284),
      splitPredeclaredBeforeFit: z.literal(true),
    }).strict(),
    scale: FiniteNumberSchema.positive(),
    rotation: Matrix3Schema,
    translation: Vector3Schema,
    rotationDeterminant: FiniteNumberSchema,
    fitResiduals: ResidualSummarySchema,
    heldOutResiduals: ResidualSummarySchema,
    interpretation: z.literal("diagnostic_alignment_only_residuals_forbid_metric_transform_promotion"),
  }).strict(),
  retainedRotationCandidate: z.object({
    processedPoseIndex: z.literal(19_890),
    processedTimestampNanoseconds: DecimalIntegerSchema,
    processedTranslation: Vector3Schema,
    processedRotationTuple: QuaternionSchema,
    pairedRawIndex: z.number().int().nonnegative(),
    pairedRawTimestampNanoseconds: DecimalIntegerSchema,
    pairedRawTupleReorderedByCandidateWxyz: QuaternionSchema,
    status: z.literal("trajectory_rotation_tuple_candidate_not_optical_camera_orientation"),
    fixedFovApplied: z.literal(false),
  }).strict(),
  contract: GrandHallPoseLineageAuthorityGuardsSchema,
  blockers: z.tuple([
    z.literal("raw_tuple_semantics_unverified"),
    z.literal("processed_tuple_semantics_unverified"),
    z.literal("body_to_camera_extrinsic_absent"),
    z.literal("pose_direction_unverified"),
    z.literal("handedness_and_axes_unverified"),
    z.literal("camera_intrinsics_and_fov_absent"),
    z.literal("metric_units_unaccepted"),
    z.literal("diagnostic_similarity_residuals_exceed_metric_use"),
    z.literal("e57_to_xgrids_transform_absent"),
    z.literal("grand_hall_room_scope_unaccepted"),
  ]),
}).strict();

export const GrandHallXgridsLccPoseLineageSchema =
  GrandHallXgridsLccPoseLineageMaterialSchema.extend({
    bundleSha256: Sha256Schema,
  }).strict();

export type GrandHallPoseLineageFileIdentity = z.infer<
  typeof GrandHallPoseLineageFileIdentitySchema
>;
export type GrandHallPoseLineageAuthorityGuards = z.infer<
  typeof GrandHallPoseLineageAuthorityGuardsSchema
>;
export type GrandHallXgridsLccPoseLineageMaterial = z.infer<
  typeof GrandHallXgridsLccPoseLineageMaterialSchema
>;
export type GrandHallXgridsLccPoseLineage = z.infer<
  typeof GrandHallXgridsLccPoseLineageSchema
>;

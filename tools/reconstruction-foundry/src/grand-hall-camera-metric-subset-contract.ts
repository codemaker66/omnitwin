import { z } from "zod";

export const GRAND_HALL_CAMERA_METRIC_SUBSET_SCHEMA =
  "venviewer.grand-hall.camera-metric-subset.v1";
export const GRAND_HALL_CAMERA_METRIC_SUBSET_STATE =
  "candidate_correspondence_metric_pose_available_orientation_blocked";
export const GRAND_HALL_CAMERA_METRIC_SUBSET_DOMAIN =
  "VENVIEWER.GRAND_HALL.CAMERA_METRIC_SUBSET.V1";

const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const BareSha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const GuidSchema = z.string().regex(/^[0-9a-f]{32}$/u);
const FiniteNumberSchema = z.number().finite();
const QuaternionSchema = z.tuple([
  FiniteNumberSchema,
  FiniteNumberSchema,
  FiniteNumberSchema,
  FiniteNumberSchema,
]);
const TranslationSchema = z.tuple([
  FiniteNumberSchema,
  FiniteNumberSchema,
  FiniteNumberSchema,
]);

export const GrandHallCameraMetricSourceIdentitySchema = z.object({
  locator: z.string().min(1),
  byteLength: z.number().int().positive(),
  sha256: Sha256Schema,
}).strict();

export const GrandHallCameraMetricAuthorityGuardsSchema = z.object({
  authority: z.literal("none"),
  correspondenceAccepted: z.literal(false),
  roomMembershipAccepted: z.literal(false),
  externalPanoramaPoseAccepted: z.literal(false),
  externalPanoramaOrientationAccepted: z.literal(false),
  e57CubefaceOrientationBasisAccepted: z.literal(false),
  e57ToObjTransformAccepted: z.literal(false),
  e57ToXgridsTransformAccepted: z.literal(false),
  grandHallPixelMaskAccepted: z.literal(false),
  trainingInputPermitted: z.literal(false),
  reconstructionInputPermitted: z.literal(false),
  providerInputPermitted: z.literal(false),
  runtimeInputPermitted: z.literal(false),
  stagingPermitted: z.literal(false),
  publicationPermitted: z.literal(false),
  productionTrustPermitted: z.literal(false),
  generatedContentUsed: z.literal(false),
}).strict();

export const GrandHallCameraMetricCubefaceSchema = z.object({
  faceIndex: z.number().int().min(0).max(5),
  imageIndex: z.number().int().nonnegative(),
  imageGuid: GuidSchema,
  imageName: z.string().min(1),
  relativePath: z.string().regex(/^images\/scan_\d{3}\/image2d_\d+_skybox_[0-5]\.jpg$/u),
  sha256: Sha256Schema,
  byteLength: z.number().int().positive(),
  mediaType: z.literal("image/jpeg"),
  widthPx: z.literal(4_096),
  heightPx: z.literal(4_096),
  decodedMode: z.literal("RGB"),
  representation: z.literal("pinholeRepresentation"),
  blob: z.literal("jpegImage"),
  focalLength: z.literal(0.5),
  pixelWidth: z.literal(0.000244140625),
  pixelHeight: z.literal(0.000244140625),
  principalPointX: z.literal(2_048),
  principalPointY: z.literal(2_048),
  associatedData3DGuid: GuidSchema,
  orientationBasis: z.null(),
  authority: z.literal("none"),
}).strict();

export const GrandHallCameraMetricRowSchema = z.object({
  state: z.literal(GRAND_HALL_CAMERA_METRIC_SUBSET_STATE),
  authority: z.literal("none"),
  externalPanorama: z.object({
    sweepNumber: z.number().int().min(41).max(48),
    relativePath: z.string().regex(/^sweep_0(?:4[1-8])jpg\.jpg$/u),
    sha256: Sha256Schema,
    cameraPosition: z.null(),
    cameraOrientation: z.null(),
    poseAuthority: z.literal("none"),
    orientationAuthority: z.literal("none"),
  }).strict(),
  candidateCorrespondence: z.object({
    state: z.literal("candidate_human_pending"),
    data3DGuid: GuidSchema,
    displayScanIndex: z.number().int().min(40).max(47),
    candidateRank: z.literal(1),
    matcherSupportedCandidate: z.literal(true),
    supportedCandidateCount: z.union([z.literal(1), z.literal(2)]),
    caveat: z.union([
      z.null(),
      z.literal("two_matcher_supported_candidates_human_review_required"),
    ]),
    humanReviewRequired: z.literal(true),
    authority: z.literal("none"),
  }).strict(),
  e57Scanner: z.object({
    scanIndex: z.number().int().min(40).max(47),
    data3DGuid: GuidSchema,
    coordinateFrame: z.literal("e57_local"),
    units: z.literal("metres"),
    rotationEncoding: z.literal("quaternion_wxyz"),
    translationM: TranslationSchema,
    rotationQuaternionWxyz: QuaternionSchema,
    sourceValueState: z.literal("exact_from_bound_e57_pose_document"),
    poseAuthority: z.literal("none"),
    orientationUseBlocked: z.literal(true),
  }).strict(),
  nativeCubefaces: z.array(GrandHallCameraMetricCubefaceSchema).length(6),
  guards: GrandHallCameraMetricAuthorityGuardsSchema,
}).strict();

export const GrandHallCameraMetricSubsetMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_CAMERA_METRIC_SUBSET_SCHEMA),
  state: z.literal(GRAND_HALL_CAMERA_METRIC_SUBSET_STATE),
  authority: z.literal("none"),
  subject: z.object({
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    scope: z.literal("candidate_camera_metric_subset"),
    includedExternalSweepNumbers: z.tuple([
      z.literal(41), z.literal(42), z.literal(43), z.literal(44),
      z.literal(45), z.literal(46), z.literal(47), z.literal(48),
    ]),
    excludedExternalSweepNumbers: z.tuple([z.literal(49)]),
    sweep49Included: z.literal(false),
  }).strict(),
  sourceBindings: z.object({
    candidateCrosswalk: GrandHallCameraMetricSourceIdentitySchema.extend({
      schemaVersion: z.literal("venviewer.panorama-e57-candidate-crosswalk-authority-none.v1"),
    }).strict(),
    e57Poses: GrandHallCameraMetricSourceIdentitySchema.extend({
      canonicalPoseSha256: Sha256Schema,
      canonicalizationMethod: z.literal("python_sort_keys_compact_separators_finite_float_repr_pose_schema_v1"),
      coordinateFrame: z.literal("e57_local"),
      units: z.literal("metres"),
      rotationEncoding: z.literal("quaternion_wxyz"),
    }).strict(),
    e57Image2dManifest: GrandHallCameraMetricSourceIdentitySchema.extend({
      schemaVersion: z.literal("venviewer.e57-image2d-evidence.v1"),
      e57Sha256: Sha256Schema,
      e57ByteLength: z.literal(20_518_437_888),
    }).strict(),
  }).strict(),
  contract: GrandHallCameraMetricAuthorityGuardsSchema,
  blockers: z.tuple([
    z.literal("native_grid_room_scope_review_incomplete"),
    z.literal("panorama_e57_correspondence_human_review_incomplete"),
    z.literal("external_panorama_orientation_unresolved"),
    z.literal("e57_cubeface_orientation_basis_unaccepted"),
    z.literal("grand_hall_pixel_masks_absent"),
    z.literal("room_selection_volume_unaccepted"),
    z.literal("e57_to_obj_transform_unreviewed"),
    z.literal("e57_to_xgrids_transform_absent"),
  ]),
  rows: z.array(GrandHallCameraMetricRowSchema).length(8),
  summary: z.object({
    rowCount: z.literal(8),
    externalPanoramaCount: z.literal(8),
    e57ScanCount: z.literal(8),
    nativeCubefaceCount: z.literal(48),
    orientationReadyRowCount: z.literal(0),
    trainingEligibleRowCount: z.literal(0),
    reconstructionEligibleRowCount: z.literal(0),
    runtimeEligibleRowCount: z.literal(0),
    acceptedRowCount: z.literal(0),
  }).strict(),
}).strict();

export const GrandHallCameraMetricSubsetSchema = GrandHallCameraMetricSubsetMaterialSchema.extend({
  bundleSha256: Sha256Schema,
}).strict();

export const GrandHallCameraMetricBareSha256Schema = BareSha256Schema;
export const GrandHallCameraMetricGuidSchema = GuidSchema;
export const GrandHallCameraMetricPoseSchema = z.object({
  rotation: QuaternionSchema,
  translation: TranslationSchema,
}).strict();

export type GrandHallCameraMetricSourceIdentity = z.infer<typeof GrandHallCameraMetricSourceIdentitySchema>;
export type GrandHallCameraMetricAuthorityGuards = z.infer<typeof GrandHallCameraMetricAuthorityGuardsSchema>;
export type GrandHallCameraMetricSubsetMaterial = z.infer<typeof GrandHallCameraMetricSubsetMaterialSchema>;
export type GrandHallCameraMetricSubset = z.infer<typeof GrandHallCameraMetricSubsetSchema>;

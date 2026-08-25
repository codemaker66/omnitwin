import { z } from "zod";

import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import { FoundryUtcInstantSchema } from "./omnitwin-foundry.js";
import { RuntimeSha256Schema } from "./runtime-venue-manifest.js";

export const FOUNDRY_GRAND_HALL_ROOM_MEMBERSHIP_V1 =
  "omnitwin.foundry.grand-hall-room-membership.v1";
export const FOUNDRY_GRAND_HALL_PANORAMA_CROSSWALK_EVIDENCE_V1 =
  "omnitwin.foundry.grand-hall-panorama-crosswalk-evidence.v1";

export const GRAND_HALL_VISUAL_CORE_SCAN_INDICES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
  34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
] as const;
export const GRAND_HALL_VISUAL_PORTAL_SCAN_INDICES = [0, 17, 48] as const;
export const GRAND_HALL_VISUAL_EXCLUDED_SCAN_INDICES = [18, 49] as const;
export const GRAND_HALL_REVIEWED_PANORAMA_CROSSWALK_SCAN_INDICES = [
  0, 17, 18, 47, 48, 49,
] as const;

const CORE_SCAN_INDICES = new Set<number>(GRAND_HALL_VISUAL_CORE_SCAN_INDICES);
const PORTAL_SCAN_INDICES = new Set<number>(GRAND_HALL_VISUAL_PORTAL_SCAN_INDICES);
const EXCLUDED_SCAN_INDICES = new Set<number>(GRAND_HALL_VISUAL_EXCLUDED_SCAN_INDICES);
const REVIEWED_CROSSWALK_SCAN_INDICES = new Set<number>(
  GRAND_HALL_REVIEWED_PANORAMA_CROSSWALK_SCAN_INDICES,
);

export const GrandHallVisualLocationInferenceSchema = z.enum([
  "visually_consistent_grand_hall_interior",
  "visually_mixed_portal_threshold",
  "visually_consistent_adjacent_space",
]);

export const GrandHallRoomMembershipAllowedUseSchema = z.enum([
  "mask_authoring_candidate_only",
  "portal_boundary_and_mask_authoring_evidence_only",
  "whole_frame_exclusion_and_boundary_evidence_only",
]);

export const GrandHallPanoramaCorrespondenceStateSchema = z.enum([
  "diagnostic_pair_agent_reviewed",
  "candidate_sequence_unverified",
]);

export const GrandHallPixelMaskStateSchema = z.enum([
  "required_not_authored",
  "not_applicable_whole_frame_excluded",
]);

const GrandHallEvidenceFileSchema = z
  .object({
    relativePath: z.string().trim().min(1).max(240),
    sha256: RuntimeSha256Schema,
    byteLength: z.number().int().positive(),
  })
  .strict();

const GrandHallPanoramaCrosswalkPairResultSchema = z
  .object({
    scanIndex: z.number().int().min(0).max(49),
    candidatePanoramaSweepNumber: z.number().int().min(1).max(50),
    previewSha256: RuntimeSha256Schema,
    candidatePanoramaSha256: RuntimeSha256Schema,
    candidateMatchRank: z.number().int().min(1).max(50),
    candidateMatchScore: z.number().finite().min(-1).max(1),
    bestCyclicShiftColumns: z.number().int().min(0).max(127),
    runnerUpScanIndex: z.number().int().min(0).max(49),
    runnerUpScore: z.number().finite().min(-1).max(1),
    candidateMinusRunnerUpScore: z.number().finite().min(-2).max(2),
    agentVisualDisposition: z.literal("candidate_pair_visually_consistent"),
    humanConfirmationRecorded: z.literal(false),
    e57ByteLineageEstablished: z.literal(false),
  })
  .strict();

const GrandHallPanoramaCrosswalkEvidenceMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_GRAND_HALL_PANORAMA_CROSSWALK_EVIDENCE_V1),
    createdAt: FoundryUtcInstantSchema,
    createdBy: z.string().trim().min(1).max(160),
    authority: z.literal("diagnostic_only"),
    inputScope: z.literal("exact_bound_preview_and_panorama_files_only"),
    method: z
      .object({
        implementationId: z.literal("codex-normalized-cyclic-correlation-v1"),
        pythonVersion: z.literal("3.13.6"),
        pillowVersion: z.literal("12.0.0"),
        numpyVersion: z.literal("2.4.2"),
        grayscaleMode: z.literal("Pillow-L"),
        resizedWidthPx: z.literal(128),
        resizedHeightPx: z.literal(64),
        resizeFilter: z.literal("LANCZOS"),
        numericType: z.literal("float64"),
        normalization: z.literal("per_image_zero_mean_population_standard_deviation"),
        cyclicHorizontalShiftCount: z.literal(128),
        score: z.literal("mean_normalized_pixel_product"),
        runnerPool: z.literal("scan_000_through_scan_049_preview_evidence"),
      })
      .strict(),
    pairResults: z.array(GrandHallPanoramaCrosswalkPairResultSchema).length(6),
  })
  .strict();

type GrandHallPanoramaCrosswalkEvidenceMaterialObject = z.infer<
  typeof GrandHallPanoramaCrosswalkEvidenceMaterialObjectSchema
>;

function refineCrosswalkEvidence(
  evidence: GrandHallPanoramaCrosswalkEvidenceMaterialObject,
  ctx: z.RefinementCtx,
): void {
  const indices = evidence.pairResults.map((result) => result.scanIndex);
  if (
    indices.some(
      (scanIndex, index) =>
        scanIndex !== GRAND_HALL_REVIEWED_PANORAMA_CROSSWALK_SCAN_INDICES[index],
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pairResults"],
      message: "crosswalk results must contain the exact ordered six reviewed boundary pairs",
    });
  }
  evidence.pairResults.forEach((result, index) => {
    if (result.candidatePanoramaSweepNumber !== result.scanIndex + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pairResults", index, "candidatePanoramaSweepNumber"],
        message: "reviewed pair must bind its explicit candidate sweep",
      });
    }
    const recordedDelta = result.candidateMatchScore - result.runnerUpScore;
    if (Math.abs(recordedDelta - result.candidateMinusRunnerUpScore) > 1e-9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pairResults", index, "candidateMinusRunnerUpScore"],
        message: "recorded crosswalk score delta is inconsistent",
      });
    }
  });
}

export const FoundryGrandHallPanoramaCrosswalkEvidenceV1MaterialSchema =
  GrandHallPanoramaCrosswalkEvidenceMaterialObjectSchema.superRefine(
    refineCrosswalkEvidence,
  );

export type FoundryGrandHallPanoramaCrosswalkEvidenceV1Material = z.infer<
  typeof FoundryGrandHallPanoramaCrosswalkEvidenceV1MaterialSchema
>;

function computeCanonicalDigest(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

export function computeFoundryGrandHallPanoramaCrosswalkEvidenceV1Sha256(
  material: FoundryGrandHallPanoramaCrosswalkEvidenceV1Material,
): string {
  const parsed = FoundryGrandHallPanoramaCrosswalkEvidenceV1MaterialSchema.parse(material);
  return computeCanonicalDigest(
    FOUNDRY_GRAND_HALL_PANORAMA_CROSSWALK_EVIDENCE_V1,
    parsed,
  );
}

const FoundryGrandHallPanoramaCrosswalkEvidenceV1ObjectSchema =
  GrandHallPanoramaCrosswalkEvidenceMaterialObjectSchema.extend({
    evidenceSha256: RuntimeSha256Schema,
  }).strict();

export const FoundryGrandHallPanoramaCrosswalkEvidenceV1Schema =
  FoundryGrandHallPanoramaCrosswalkEvidenceV1ObjectSchema.superRefine(
    (value, ctx) => {
      refineCrosswalkEvidence(value, ctx);
      const { evidenceSha256, ...material } = value;
      const actual = computeCanonicalDigest(
        FOUNDRY_GRAND_HALL_PANORAMA_CROSSWALK_EVIDENCE_V1,
        material,
      );
      if (evidenceSha256 !== actual) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidenceSha256"],
          message: "crosswalk evidence digest must match its canonical material",
        });
      }
    },
  );

const GrandHallRoomMembershipScanRecordSchema = z
  .object({
    scanIndex: z.number().int().min(0).max(49),
    candidatePanoramaSweepNumber: z.number().int().min(1).max(50),
    visualLocationInference: GrandHallVisualLocationInferenceSchema,
    inferenceBasis: z.literal("agent_visual_inspection_of_digest_bound_historical_preview"),
    inferenceConfidence: z.literal("provisional_human_review_required"),
    rationaleCode: z.enum([
      "view_visually_consistent_with_grand_hall_interior",
      "view_visually_spans_portal_or_threshold",
      "view_visually_consistent_with_adjacent_space",
    ]),
    allowedUse: GrandHallRoomMembershipAllowedUseSchema,
    roomBoundaryPoseTestState: z.literal("not_run_reviewed_boundary_absent"),
    panoramaCorrespondenceState: GrandHallPanoramaCorrespondenceStateSchema,
    fullFrameTrainingEligible: z.literal(false),
    pixelMaskState: GrandHallPixelMaskStateSchema,
    wholeFrameExclusionReason: z.literal("outside_room_camera_view").nullable(),
    previewEvidence: GrandHallEvidenceFileSchema,
    candidatePanoramaEvidence: GrandHallEvidenceFileSchema,
  })
  .strict();

const GrandHallRoomMembershipSourceBindingsSchema = z
  .object({
    e57: z
      .object({
        sourceLocator: z.literal("E57_SOURCE_ROOT/cloud_0.e57"),
        sha256: z.literal(
          "sha256:975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
        ),
        byteLength: z.literal(20_518_437_888),
        rootGuid: z.literal("424ff41f6e5d41969c635fcd61be9b3f"),
        scanCount: z.literal(149),
        embeddedPinholeImageCount: z.literal(894),
        scope: z.literal("whole_building_not_room_isolated"),
      })
      .strict(),
    matterpak: z
      .object({
        objSourceLocator: z.literal(
          "MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.obj",
        ),
        objSha256: z.literal(
          "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
        ),
        objByteLength: z.literal(38_381_816),
        mtlSourceLocator: z.literal(
          "MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.mtl",
        ),
        mtlSha256: z.literal(
          "sha256:8e43085c90e40e2e76b7e221038c13bd65f17893a3d097eb12ffea5445f85d7a",
        ),
        mtlByteLength: z.literal(20_879),
        rootGuid: z.literal("424ff41f6e5d41969c635fcd61be9b3f"),
        role: z.literal("room_boundary_reference_only"),
        scope: z.literal("whole_building_not_room_isolated"),
        lineageRelationship: z.literal("common_vendor_lineage_not_independent_control"),
      })
      .strict(),
    xgridsRawProject: z
      .object({
        captureLogRef: z.literal("state/capture_log.json"),
        captureLogSlug: z.literal("grand-hall"),
        captureLogCapturedAt: z.literal("2026-05-31T10:18:37"),
        captureLogSizeMeaning: z.literal("xbin_only_not_project_total"),
        projectLocator: z.literal("XGRIDS_CAPTURE_LOG_ROOT"),
        observedProjectFileCount: z.literal(12),
        observedProjectDirectoryCount: z.literal(4),
        observedProjectByteLength: z.literal(41_296_996_984),
        projectReceiptState: z.literal("required_not_generated"),
        roomMembershipState: z.literal("unclassified_pending_lcc_point_cloud_preview"),
        trainingEligible: z.literal(false),
        runtimeEligible: z.literal(false),
        exactRuntimeSubstitutionPermitted: z.literal(false),
        creatorDataState: z.literal("not_exported"),
        xbin: z
          .object({
            relativePath: z.literal("2026-05-31-101837.xbin"),
            sha256: z.literal(
              "sha256:42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0",
            ),
            byteLength: z.literal(41_095_196_672),
            containerSignature: z.literal("XBAG"),
          })
          .strict(),
        poses: z
          .object({
            relativePath: z.literal("project_data/poses.csv"),
            sha256: z.literal(
              "sha256:b86bc45d15b8b5a84d61160afe3e16e7659e195557a2b8c6567039bb74d83127",
            ),
            byteLength: z.literal(3_659_287),
            rowCount: z.literal(42_850),
            durationSeconds: z.literal(4_285.622582),
          })
          .strict(),
      })
      .strict(),
    panoramaAuditSet: z
      .object({
        sourceLocator: z.literal("MATTERPORT_PANORAMA_ROOT"),
        sourceFileCount: z.literal(148),
        auditedFileCount: z.literal(50),
        auditedByteLength: z.literal(349_099_744),
        provisionalMaskAuthoringCandidateCount: z.literal(48),
        wholeFrameExcludedCount: z.literal(2),
        widthPx: z.literal(8192),
        heightPx: z.literal(4096),
        projection: z.literal("equirectangular"),
        poseState: z.literal("absent_from_export"),
        candidateSequenceHypothesis: z.literal(
          "candidate_sweep_number_equals_e57_scan_index_plus_one",
        ),
        lineageState: z.literal("historical_correspondence_not_byte_lineage"),
        crosswalkEvidence: FoundryGrandHallPanoramaCrosswalkEvidenceV1Schema,
      })
      .strict(),
    previewEvidenceSet: z
      .object({
        sourceLocator: z.literal("E57_PREVIEW_EVIDENCE_ROOT"),
        fileCount: z.literal(50),
        byteLength: z.literal(1_589_997),
        derivationState: z.literal("historical_unverified"),
        authority: z.literal("diagnostic_only"),
      })
      .strict(),
    historicalPilotManifest: z
      .object({
        artifactRef: z.literal(
          "docs/operations/grand-hall-pilot-ingest-manifest-2026-07-19.json",
        ),
        canonicalSha256: z.literal(
          "sha256:63516c0b1c9583086108879659b771809c5bea4272c175c9dbb809a6c66bfd89",
        ),
        fileSha256: z.literal(
          "sha256:af47826e91d9cbbac0730019d3c2349ec5534fe4daafe9ac1975ebea4492a4c4",
        ),
        byteLength: z.literal(638_899),
        assetCount: z.literal(310),
        preservation: z.literal("immutable_do_not_rewrite"),
        relationship: z.literal("successor_evidence_does_not_modify_t507"),
        historicalCandidateScope: z.literal("authority_none_diagnostic_not_room_membership"),
      })
      .strict(),
  })
  .strict();

const GrandHallPanoramaMaskArtifactRequirementSchema = z
  .object({
    state: z.literal("required_not_authored"),
    appliesTo: z.literal("non_excluded_candidate_panoramas_only"),
    coordinateSpace: z.literal("original_8192x4096_equirectangular_pixel_grid"),
    maskPolarity: z.literal("stored_value_255_means_excluded"),
    horizontalSeamRule: z.literal("wraps_between_x_8191_and_x_0"),
    verticalRule: z.literal("clamped_y_0_through_y_4095"),
    encoding: z.literal("png_grayscale8_binary_v1"),
    mediaType: z.literal("image/png"),
    widthPx: z.literal(8192),
    heightPx: z.literal(4096),
    sampleLayout: z.literal("single_channel_grayscale_8bit"),
    permittedStoredValues: z.tuple([z.literal(0), z.literal(255)]),
    includedValue: z.literal(0),
    excludedValue: z.literal(255),
    alphaChannelPermitted: z.literal(false),
    colorProfilePermitted: z.literal(false),
    embeddedOrientationPermitted: z.literal(false),
    pixelOrigin: z.literal("top_left_x_increases_right_y_increases_down"),
    resamplingPermitted: z.literal(false),
    unionSemantics: z.literal(
      "pixel_excluded_if_any_reason_mask_stored_value_is_255",
    ),
    allowedReasonCodes: z.tuple([
      z.literal("outside_room_through_portal"),
      z.literal("nadir_capture_rig"),
      z.literal("nadir_blur_or_stitch_cap"),
      z.literal("zenith_blur_or_stitch_cap"),
      z.literal("operator_or_moving_person"),
      z.literal("stitching_seam"),
    ]),
  })
  .strict();

const GrandHallRoomMembershipScopeRulesSchema = z
  .object({
    visualLocationInferenceOnly: z.literal(true),
    geometricCameraCentreMembershipEstablished: z.literal(false),
    roomBoundaryArtifactState: z.literal("required_not_authored"),
    panoramaMaskArtifactRequirement: GrandHallPanoramaMaskArtifactRequirementSchema,
    pointMaskArtifactState: z.literal("required_not_authored"),
    numericScanSelectionSufficient: z.literal(false),
    axisAlignedCropSufficient: z.literal(false),
    generatedFillPermitted: z.literal(false),
    proceduralPixelReplacementPermitted: z.literal(false),
    synthesizedPixelReplacementPermitted: z.literal(false),
    panoStageNadirCrownPermitted: z.literal(false),
    maskedOrUnknownPixelDisposition: z.literal("remain_transparent_or_unknown_never_filled"),
    neighbouringRoomPixelsPermitted: z.literal(false),
    facadeAssetsPermitted: z.literal(false),
    trainingAuthorized: z.literal(false),
    runtimeAuthorized: z.literal(false),
    structuralAuthorityGranted: z.literal(false),
    collisionAuthorityGranted: z.literal(false),
    exportAuthorityGranted: z.literal(false),
    publicEvidenceAuthorized: z.literal(false),
  })
  .strict();

const GrandHallRoomMembershipMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_GRAND_HALL_ROOM_MEMBERSHIP_V1),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    createdAt: FoundryUtcInstantSchema,
    createdBy: z.string().trim().min(1).max(160),
    authority: z.literal("none"),
    reviewState: z.literal("agent_visual_audited_human_pending"),
    readMode: z.literal("read_only"),
    sourceMutationPermitted: z.literal(false),
    sourceBindings: GrandHallRoomMembershipSourceBindingsSchema,
    scopeRules: GrandHallRoomMembershipScopeRulesSchema,
    scanRecords: z.array(GrandHallRoomMembershipScanRecordSchema).length(50),
    humanReview: z
      .object({
        state: z.literal("pending"),
        reviewer: z.null(),
        reviewedAt: z.null(),
        acceptedMembershipSha256: z.null(),
      })
      .strict(),
  })
  .strict();

type GrandHallRoomMembershipMaterialObject = z.infer<
  typeof GrandHallRoomMembershipMaterialObjectSchema
>;

function expectedInference(scanIndex: number): z.infer<
  typeof GrandHallVisualLocationInferenceSchema
> | null {
  if (CORE_SCAN_INDICES.has(scanIndex)) return "visually_consistent_grand_hall_interior";
  if (PORTAL_SCAN_INDICES.has(scanIndex)) return "visually_mixed_portal_threshold";
  if (EXCLUDED_SCAN_INDICES.has(scanIndex)) return "visually_consistent_adjacent_space";
  return null;
}

function expectedAllowedUse(scanIndex: number): z.infer<
  typeof GrandHallRoomMembershipAllowedUseSchema
> | null {
  if (CORE_SCAN_INDICES.has(scanIndex)) return "mask_authoring_candidate_only";
  if (PORTAL_SCAN_INDICES.has(scanIndex)) {
    return "portal_boundary_and_mask_authoring_evidence_only";
  }
  if (EXCLUDED_SCAN_INDICES.has(scanIndex)) {
    return "whole_frame_exclusion_and_boundary_evidence_only";
  }
  return null;
}

function expectedRationale(scanIndex: number): z.infer<
  typeof GrandHallRoomMembershipScanRecordSchema
>["rationaleCode"] | null {
  if (CORE_SCAN_INDICES.has(scanIndex)) {
    return "view_visually_consistent_with_grand_hall_interior";
  }
  if (PORTAL_SCAN_INDICES.has(scanIndex)) return "view_visually_spans_portal_or_threshold";
  if (EXCLUDED_SCAN_INDICES.has(scanIndex)) {
    return "view_visually_consistent_with_adjacent_space";
  }
  return null;
}

function addRecordIssue(
  ctx: z.RefinementCtx,
  index: number,
  field: string,
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["scanRecords", index, field],
    message,
  });
}

function refineRecordClassification(
  record: z.infer<typeof GrandHallRoomMembershipScanRecordSchema>,
  index: number,
  ctx: z.RefinementCtx,
): void {
  if (record.scanIndex !== index) {
    addRecordIssue(ctx, index, "scanIndex", "scan records must be ordered exactly from 0 through 49");
  }
  if (record.visualLocationInference !== expectedInference(record.scanIndex)) {
    addRecordIssue(ctx, index, "visualLocationInference", "visual inference does not match the audited scan set");
  }
  if (record.allowedUse !== expectedAllowedUse(record.scanIndex)) {
    addRecordIssue(ctx, index, "allowedUse", "allowed use does not match the visual inference class");
  }
  if (record.rationaleCode !== expectedRationale(record.scanIndex)) {
    addRecordIssue(ctx, index, "rationaleCode", "rationale does not match the visual inference class");
  }
}

function refineRecordEligibility(
  record: z.infer<typeof GrandHallRoomMembershipScanRecordSchema>,
  index: number,
  ctx: z.RefinementCtx,
): void {
  const excluded = EXCLUDED_SCAN_INDICES.has(record.scanIndex);
  const expectedMaskState = excluded
    ? "not_applicable_whole_frame_excluded"
    : "required_not_authored";
  const expectedExclusionReason = excluded ? "outside_room_camera_view" : null;
  if (record.pixelMaskState !== expectedMaskState) {
    addRecordIssue(ctx, index, "pixelMaskState", "pixel-mask state does not match whole-frame eligibility");
  }
  if (record.wholeFrameExclusionReason !== expectedExclusionReason) {
    addRecordIssue(ctx, index, "wholeFrameExclusionReason", "whole-frame exclusion reason is inconsistent");
  }
}

function refineRecordEvidence(
  record: z.infer<typeof GrandHallRoomMembershipScanRecordSchema>,
  index: number,
  ctx: z.RefinementCtx,
): void {
  const expectedSweep = record.scanIndex + 1;
  const scanName = `scan_${String(record.scanIndex).padStart(3, "0")}_preview.jpg`;
  const panoramaName = `sweep_${String(expectedSweep).padStart(3, "0")}jpg.jpg`;
  if (record.candidatePanoramaSweepNumber !== expectedSweep) {
    addRecordIssue(ctx, index, "candidatePanoramaSweepNumber", "candidate sequence hypothesis is inconsistent");
  }
  if (record.previewEvidence.relativePath !== scanName) {
    addRecordIssue(ctx, index, "previewEvidence", "preview evidence filename must match the scan index");
  }
  if (record.candidatePanoramaEvidence.relativePath !== panoramaName) {
    addRecordIssue(ctx, index, "candidatePanoramaEvidence", "candidate panorama filename must match the candidate sequence");
  }
  const expectedState = REVIEWED_CROSSWALK_SCAN_INDICES.has(record.scanIndex)
    ? "diagnostic_pair_agent_reviewed"
    : "candidate_sequence_unverified";
  if (record.panoramaCorrespondenceState !== expectedState) {
    addRecordIssue(ctx, index, "panoramaCorrespondenceState", "panorama correspondence overstates or understates its evidence state");
  }
}

function refineCrosswalkBindings(
  material: GrandHallRoomMembershipMaterialObject,
  ctx: z.RefinementCtx,
): void {
  const pairResults = material.sourceBindings.panoramaAuditSet.crosswalkEvidence.pairResults;
  pairResults.forEach((pair, pairIndex) => {
    const record = material.scanRecords[pair.scanIndex];
    if (
      record === undefined ||
      pair.candidatePanoramaSweepNumber !== record.candidatePanoramaSweepNumber ||
      pair.previewSha256 !== record.previewEvidence.sha256 ||
      pair.candidatePanoramaSha256 !== record.candidatePanoramaEvidence.sha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceBindings", "panoramaAuditSet", "crosswalkEvidence", "pairResults", pairIndex],
        message: "crosswalk result must bind the exact scan-record evidence",
      });
    }
  });
}

function refineEvidenceTotals(
  material: GrandHallRoomMembershipMaterialObject,
  ctx: z.RefinementCtx,
): void {
  const previewBytes = material.scanRecords.reduce(
    (total, record) => total + record.previewEvidence.byteLength,
    0,
  );
  const panoramaBytes = material.scanRecords.reduce(
    (total, record) => total + record.candidatePanoramaEvidence.byteLength,
    0,
  );
  if (previewBytes !== material.sourceBindings.previewEvidenceSet.byteLength) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceBindings", "previewEvidenceSet", "byteLength"],
      message: "preview evidence byte total must equal the exact scan-record inventory",
    });
  }
  if (panoramaBytes !== material.sourceBindings.panoramaAuditSet.auditedByteLength) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceBindings", "panoramaAuditSet", "auditedByteLength"],
      message: "panorama audit byte total must equal the exact scan-record inventory",
    });
  }
}

function refineGrandHallRoomMembership(
  material: GrandHallRoomMembershipMaterialObject,
  ctx: z.RefinementCtx,
): void {
  const indices = material.scanRecords.map((record) => record.scanIndex);
  if (new Set(indices).size !== indices.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scanRecords"],
      message: "scan records must not contain duplicate indices",
    });
  }
  material.scanRecords.forEach((record, index) => {
    refineRecordClassification(record, index, ctx);
    refineRecordEligibility(record, index, ctx);
    refineRecordEvidence(record, index, ctx);
  });
  refineCrosswalkBindings(material, ctx);
  refineEvidenceTotals(material, ctx);
}

export const FoundryGrandHallRoomMembershipV1MaterialSchema =
  GrandHallRoomMembershipMaterialObjectSchema.superRefine(refineGrandHallRoomMembership);

export type FoundryGrandHallRoomMembershipV1Material = z.infer<
  typeof FoundryGrandHallRoomMembershipV1MaterialSchema
>;

export function computeFoundryGrandHallRoomMembershipV1Sha256(
  material: FoundryGrandHallRoomMembershipV1Material,
): string {
  const parsed = FoundryGrandHallRoomMembershipV1MaterialSchema.parse(material);
  return computeCanonicalDigest(FOUNDRY_GRAND_HALL_ROOM_MEMBERSHIP_V1, parsed);
}

const FoundryGrandHallRoomMembershipV1ObjectSchema =
  GrandHallRoomMembershipMaterialObjectSchema.extend({
    membershipSha256: RuntimeSha256Schema,
  }).strict();

export const FoundryGrandHallRoomMembershipV1Schema =
  FoundryGrandHallRoomMembershipV1ObjectSchema.superRefine((value, ctx) => {
    refineGrandHallRoomMembership(value, ctx);
    const { membershipSha256, ...material } = value;
    const actual = computeCanonicalDigest(FOUNDRY_GRAND_HALL_ROOM_MEMBERSHIP_V1, material);
    if (membershipSha256 !== actual) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["membershipSha256"],
        message: "membership digest must match the canonical authority-free material",
      });
    }
  });

export type FoundryGrandHallRoomMembershipV1 = z.infer<
  typeof FoundryGrandHallRoomMembershipV1Schema
>;

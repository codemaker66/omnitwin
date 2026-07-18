import { describe, expect, it } from "vitest";
import {
  FOUNDRY_PHASE1_BUNDLE_V0,
  FOUNDRY_PHASE1_COLMAP_INSPECTION_V0,
  FOUNDRY_PHASE1_E57_INSPECTION_V0,
  FOUNDRY_PHASE1_IDENTITY_REVIEW_V0,
  FOUNDRY_PHASE1_RESIDUAL_REPORT_V0,
  FOUNDRY_PHASE1_TRANSFORM_PROPOSAL_V0,
  GRAND_HALL_CUBEFACES,
  GRAND_HALL_DIAGNOSTIC_REPRODUCTION_SWEEPS,
  GRAND_HALL_IDENTITY_SWEEPS,
  GRAND_HALL_PHASE1_CANDIDATE_SWEEPS,
  GRAND_HALL_PHASE1_FIT_SWEEPS,
  GRAND_HALL_PHASE1_FROZEN_HOLDOUT_SWEEPS,
  FoundryPhase1BundleV0Schema,
  FoundryPhase1ColmapInspectionMaterialV0Schema,
  FoundryPhase1ColmapInspectionV0Schema,
  FoundryPhase1ColmapSourceFileSchema,
  FoundryPhase1E57InspectionMaterialV0Schema,
  FoundryPhase1E57InspectionV0Schema,
  FoundryPhase1IdentityReviewMaterialV0Schema,
  FoundryPhase1IdentityReviewV0Schema,
  FoundryPhase1ProbeEnvelopeV0Schema,
  FoundryPhase1ResidualReportMaterialV0Schema,
  FoundryPhase1ResidualReportV0Schema,
  FoundryPhase1TransformProposalMaterialV0Schema,
  FoundryPhase1TransformProposalV0Schema,
  computeFoundryPhase1ColmapInspectionSha256,
  computeFoundryPhase1E57InspectionSha256,
  computeFoundryPhase1IdentityReviewSha256,
  computeFoundryPhase1ResidualMetrics,
  computeFoundryPhase1ResidualReportSha256,
  computeFoundryPhase1TransformProposalSha256,
  type FoundryPhase1BundleV0,
  type FoundryPhase1CorrespondenceResidualV0,
  type FoundryPhase1ResidualReportMaterialV0,
} from "../omnitwin-foundry-phase1.js";
import { TransformArtifactV0Schema } from "../runtime-venue-manifest.js";

const NOW = "2026-07-12T15:00:00.000Z";
const DOCUMENTED_SCALE = 1.7362602881;
const MATRIX = [
  DOCUMENTED_SCALE, 0, 0, 0,
  0, DOCUMENTED_SCALE, 0, 0,
  0, 0, DOCUMENTED_SCALE, 0,
  10, 20, 30, 1,
] as const;
const DOCUMENTED_FULL_FIT_RESIDUALS = [
  0.04514087216232583, 0.0047265558490473866, 0.005218754582874112,
  0.00608297470263102, 0.009357367298765773, 0.009616513829081238,
  0.006018427618171383, 0.007873936514722178, 0.0069575004044031205,
  0.01107787683599286, 0.006757198092967354, 0.004890861237780889,
  0.005160997499038779, 0.016419077113049727, 0.004006188190065679,
  0.0034170000931957, 0.004788091172807906, 0.01531961960694082,
  0.024979767748254354, 0.00835276873078588, 0.0007705308867312078,
  0.0024899769918272792, 0.00711294601517265, 0.0032043176469621058,
  0.01039562079303809, 0.006180753781014235, 0.013374701813147281,
  0.007295307284095816, 0.0030291644681980927, 0.005608274138717337,
  0.008198013442727567, 0.005760627469651575, 0.004327536503478925,
  0.004580728192301543, 0.00681082264101229, 0.0010423084096229474,
  0.005110627646099463, 0.005986837399727784, 0.006138516597029778,
  0.008607113039728706, 0.008913075848582055, 0.012490716126213362,
  0.008337717753319446, 0.005183752105833374, 0.004004789382650943,
  0.005647845263249763, 0.005781654641955269, 0.00839332025583656,
  0.016377196189204593, 0.013216448340906076,
] as const;

function sha(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function predictedFor(source: readonly number[]): [number, number, number] {
  return [
    DOCUMENTED_SCALE * (source[0] ?? 0) + 10,
    DOCUMENTED_SCALE * (source[1] ?? 0) + 20,
    DOCUMENTED_SCALE * (source[2] ?? 0) + 30,
  ];
}

function targetFor(source: readonly number[], sweepIndex: number): [number, number, number] {
  const predicted = predictedFor(source);
  return [
    predicted[0] - (DOCUMENTED_FULL_FIT_RESIDUALS[sweepIndex] ?? 0),
    predicted[1],
    predicted[2],
  ];
}

function faceDigests() {
  return GRAND_HALL_IDENTITY_SWEEPS.flatMap((sweepIndex, sweepOffset) =>
    GRAND_HALL_CUBEFACES.map((face, faceOffset) => ({
      sweepIndex,
      face,
      sha256: sha(((sweepOffset * GRAND_HALL_CUBEFACES.length + faceOffset) % 10).toString()),
      byteLength: 1_000 + sweepOffset * 10 + faceOffset,
    })),
  );
}

function residualRecords(sweeps: readonly number[]): FoundryPhase1CorrespondenceResidualV0[] {
  return sweeps.map((sweepIndex) => {
    const source: [number, number, number] = [sweepIndex, sweepIndex % 7, (sweepIndex * sweepIndex) % 11];
    const residualMeters = DOCUMENTED_FULL_FIT_RESIDUALS[sweepIndex] ?? 0;
    return {
      correspondenceId: `sweep-${String(sweepIndex).padStart(3, "0")}`,
      sweepIndex,
      predictedE57GlobalM: predictedFor(source),
      residualVectorM: [residualMeters, 0, 0],
      residualMeters,
    };
  });
}

function evaluation(sweeps: readonly number[]) {
  const records = residualRecords(sweeps);
  return { records, metrics: computeFoundryPhase1ResidualMetrics(records) };
}

interface Fixture {
  readonly bundle: FoundryPhase1BundleV0;
  readonly reportMaterial: FoundryPhase1ResidualReportMaterialV0;
}

function fixture(): Fixture {
  const identityMaterial = FoundryPhase1IdentityReviewMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_IDENTITY_REVIEW_V0,
    reviewId: "grand-hall-human-review-b",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    sourceE57Sha256: sha("a"),
    evidenceIndexSha256: sha("b"),
    reviewedSweepIndices: [0, 10, 20, 40, 49],
    faceDigests: faceDigests(),
    reviewer: {
      actorType: "human",
      reviewerId: "codex-thread-user:019f55a6-a9c4-77c2-8beb-04859fb53ce7",
      reviewerRole: "human_reviewer",
      source: "codex_thread_reply",
      response: "b",
    },
    reviewedAt: NOW,
    decision: {
      code: "B",
      roomIdentityConfirmed: true,
      confirmedIdentitySweepIndices: [0, 10, 20, 40],
      excludedSweeps: [{ sweepIndex: 49, reason: "excluded_adjacent_space" }],
    },
  });
  const identityReview = FoundryPhase1IdentityReviewV0Schema.parse({
    ...identityMaterial,
    reviewSha256: computeFoundryPhase1IdentityReviewSha256(identityMaterial),
  });

  const e57Material = FoundryPhase1E57InspectionMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_E57_INSPECTION_V0,
    inspectionId: "grand-hall-e57-inspection",
    identityReviewSha256: identityReview.reviewSha256,
    sourceE57Sha256: identityReview.sourceE57Sha256,
    sourceByteLength: 20_518_437_888,
    probeOutputSha256: sha("c"),
    readMode: "read_only",
    pointDataRead: false,
    sourceMutationPermitted: false,
    adapter: { name: "pye57", version: "0.4.19" },
    coordinateConvention: { frame: "e57_global", units: "meters", upAxis: "z" },
    scanCount: 149,
    image2DCount: 894,
    pointRecordCount: 965_520_000,
    reviewedSweepIndices: [0, 10, 20, 40, 49],
    faceDigests: faceDigests(),
    inspectedAt: NOW,
  });
  const e57Inspection = FoundryPhase1E57InspectionV0Schema.parse({
    ...e57Material,
    inspectionSha256: computeFoundryPhase1E57InspectionSha256(e57Material),
  });

  const colmapFiles = [
    { role: "database", relativePath: "database.db", sha256: sha("d"), byteLength: 10 },
    { role: "cameras_bin", relativePath: "sparse/0/cameras.bin", sha256: sha("e"), byteLength: 11 },
    { role: "images_bin", relativePath: "sparse/0/images.bin", sha256: sha("f"), byteLength: 12 },
    { role: "points3d_bin", relativePath: "sparse/0/points3D.bin", sha256: sha("0"), byteLength: 13 },
  ];
  const colmapMaterial = FoundryPhase1ColmapInspectionMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_COLMAP_INSPECTION_V0,
    inspectionId: "grand-hall-colmap-inspection",
    identityReviewSha256: identityReview.reviewSha256,
    sourceFiles: colmapFiles,
    imageSetSha256: sha("1"),
    probeOutputSha256: sha("2"),
    readMode: "read_only",
    sourceMutationPermitted: false,
    binaryEncoding: { format: "COLMAP sparse binary", endianness: "little" },
    poseConvention: {
      qvec: "hamilton_wxyz_world_to_camera",
      cameraCenter: "center=-R^Tt",
      sourceFrame: "colmap_world",
    },
    scanFilenamePattern: "scan_<three-decimal-digit-sweep>_<front|back|left|right|up|down>.jpg",
    scanGrouping: "strict_filename_then_unweighted_per_sweep_center_mean",
    databaseImageCount: 300,
    cameraCount: 1,
    registeredImageCount: 231,
    point3DCount: 124_617,
    cameraModels: [{
      cameraId: 1,
      modelName: "PINHOLE",
      width: 1024,
      height: 1024,
      parameters: [512.4968878, 512.5059949, 512, 512],
    }],
    registeredSweepIndices: GRAND_HALL_DIAGNOSTIC_REPRODUCTION_SWEEPS,
    inspectedAt: NOW,
  });
  const colmapInspection = FoundryPhase1ColmapInspectionV0Schema.parse({
    ...colmapMaterial,
    inspectionSha256: computeFoundryPhase1ColmapInspectionSha256(colmapMaterial),
  });

  const correspondences = GRAND_HALL_DIAGNOSTIC_REPRODUCTION_SWEEPS.map((sweepIndex) => {
    const source: [number, number, number] = [sweepIndex, sweepIndex % 7, (sweepIndex * sweepIndex) % 11];
    return {
      correspondenceId: `sweep-${String(sweepIndex).padStart(3, "0")}`,
      sweepIndex,
      colmapFaceCenters: [
        {
          imageName: `scan_${String(sweepIndex).padStart(3, "0")}_front.jpg`,
          face: "front",
          centerColmapWorld: [source[0] - 0.5, source[1], source[2]],
        },
        {
          imageName: `scan_${String(sweepIndex).padStart(3, "0")}_back.jpg`,
          face: "back",
          centerColmapWorld: [source[0] + 0.5, source[1], source[2]],
        },
      ],
      colmapCenterMean: source,
      e57GlobalCenterM: targetFor(source, sweepIndex),
    };
  });
  const transform = {
    matrixColumnMajor: [...MATRIX],
    scale: DOCUMENTED_SCALE,
    rotationDeterminant: 1,
  };
  const reportMaterial = FoundryPhase1ResidualReportMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_RESIDUAL_REPORT_V0,
    reportId: "grand-hall-colmap-e57-residuals",
    identityReviewSha256: identityReview.reviewSha256,
    e57InspectionSha256: e57Inspection.inspectionSha256,
    colmapInspectionSha256: colmapInspection.inspectionSha256,
    sourceE57Sha256: identityReview.sourceE57Sha256,
    colmapSourceFiles: colmapFiles,
    alignmentProbeOutputSha256: sha("3"),
    conventions: {
      e57Frame: "e57_global_metres_z_up",
      e57Axes: "right_handed_xyz_z_up",
      colmapPose: "qvec_hamilton_wxyz_world_to_camera",
      colmapCameraAxes: "right_down_forward",
      colmapWorldAxes: "arbitrary_right_handed_sfm_world",
      colmapCameraCenter: "center=-R^Tt",
      scanGrouping: "strict_scan_filename",
      sweepAggregation: "unweighted_per_sweep_center_mean",
      sweepWeighting: "one_equal_weight_per_sweep_not_per_image",
      similarityMethod: "proper_isotropic_umeyama_det_plus_one",
      reflectionPolicy: "forbidden_rotation_determinant_plus_one",
      transformDirection: "colmap_world_to_e57_global",
      matrixLayout: "4x4_column_major",
      vectorConvention: "column_vector_target_equals_matrix_times_source",
      residualUnits: "meters",
      percentileMethod: "linear",
      robustLoss: "none",
      outlierRejection: "none",
    },
    limitations: {
      geometricCloudOverlap: "not_computed",
      independentSurveyedControl: "absent",
      metricClassification: "internal_self_consistency_only",
      sharedLineageRisk: "colmap_images_and_e57_centres_share_the_same_e57_export_lineage",
      imagePixelTrainEvalSplit: "none_no_image_training_or_pixel_evaluation_performed",
      identitySweepRole: "human_room_identity_review_inputs_not_alignment_evaluation_split",
      runtimeOrPublicAuthority: "none_pending_independent_control_and_human_transform_review",
    },
    correspondences,
    fullFit: {
      resultSet: "documented_full_fit_reproduction",
      fitSweepIndices: GRAND_HALL_DIAGNOSTIC_REPRODUCTION_SWEEPS,
      transform,
      evaluation: evaluation(GRAND_HALL_DIAGNOSTIC_REPRODUCTION_SWEEPS),
      documentedDiagnostic: {
        scale: 1.7362602881,
        rmseMeters: 0.0106706,
        medianMeters: 0.0061596,
        p95Meters: 0.0164002,
        maxMeters: 0.0451409,
        classification: "prior_unreviewed_diagnostic",
        roundingTolerances: {
          scaleAbsolute: 5e-10,
          residualMetricAbsoluteMeters: 5e-8,
        },
        reproductionStatus: "matched_within_rounding_tolerance",
      },
    },
    phase1CandidateWithHoldout: {
      resultSet: "phase1_candidate_with_frozen_holdout",
      candidateSweepIndices: GRAND_HALL_PHASE1_CANDIDATE_SWEEPS,
      fitSweepIndices: GRAND_HALL_PHASE1_FIT_SWEEPS,
      holdoutSweepIndices: GRAND_HALL_PHASE1_FROZEN_HOLDOUT_SWEEPS,
      excludedSweeps: [{
        sweepIndex: 49,
        disposition: "excluded_adjacent_space",
        use: "reproduction_only",
      }],
      transform,
      fitEvaluation: evaluation(GRAND_HALL_PHASE1_FIT_SWEEPS),
      holdoutEvaluation: evaluation(GRAND_HALL_PHASE1_FROZEN_HOLDOUT_SWEEPS),
      candidateEvaluation: evaluation(GRAND_HALL_PHASE1_CANDIDATE_SWEEPS),
    },
    generatedAt: NOW,
  });
  const residualReport = FoundryPhase1ResidualReportV0Schema.parse({
    ...reportMaterial,
    reportSha256: computeFoundryPhase1ResidualReportSha256(reportMaterial),
  });
  const candidate = residualReport.phase1CandidateWithHoldout;
  const proposalMaterial = FoundryPhase1TransformProposalMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_TRANSFORM_PROPOSAL_V0,
    proposalId: "grand-hall-colmap-to-e57-proposal",
    state: "proposed",
    identityReviewSha256: identityReview.reviewSha256,
    ingestManifestSha256: sha("4"),
    e57InspectionSha256: e57Inspection.inspectionSha256,
    colmapInspectionSha256: colmapInspection.inspectionSha256,
    residualReportSha256: residualReport.reportSha256,
    sourceE57Sha256: identityReview.sourceE57Sha256,
    colmapSourceFiles: colmapFiles,
    sourceFrame: "COLMAP_WORLD",
    targetFrame: "E57_GLOBAL",
    units: "meters",
    alignmentMethod: "proper_isotropic_umeyama",
    conventions: residualReport.conventions,
    selectedResultSet: "phase1_candidate_with_frozen_holdout",
    fitSweepIndices: GRAND_HALL_PHASE1_FIT_SWEEPS,
    holdoutSweepIndices: GRAND_HALL_PHASE1_FROZEN_HOLDOUT_SWEEPS,
    excludedSweeps: candidate.excludedSweeps,
    matrix: candidate.transform.matrixColumnMajor,
    scale: candidate.transform.scale,
    residualMetrics: {
      fit: candidate.fitEvaluation.metrics,
      holdout: candidate.holdoutEvaluation.metrics,
      candidate: candidate.candidateEvaluation.metrics,
    },
    licenceGates: [
      { gate: "matterport_internal_processing", decision: "unresolved", evidenceSha256: null, note: "Customer contract and current terms need legal review." },
      { gate: "matterport_model_training", decision: "blocked_out_of_scope", evidenceSha256: null, note: "No training is authorized in phase one." },
      { gate: "xgrids_proprietary_payload", decision: "blocked_out_of_scope", evidenceSha256: null, note: "No proprietary payload parsing or decryption." },
      { gate: "public_release", decision: "blocked_out_of_scope", evidenceSha256: null, note: "No publication authority is conferred." },
    ],
    reviewer: null,
    reviewerAttestationSha256: null,
    authority: { public: "none", runtime: "none" },
    proposedAt: NOW,
  });
  const transformProposal = FoundryPhase1TransformProposalV0Schema.parse({
    ...proposalMaterial,
    proposalSha256: computeFoundryPhase1TransformProposalSha256(proposalMaterial),
  });
  return {
    reportMaterial,
    bundle: FoundryPhase1BundleV0Schema.parse({
      schemaVersion: FOUNDRY_PHASE1_BUNDLE_V0,
      ingestManifestSha256: proposalMaterial.ingestManifestSha256,
      identityReview,
      e57Inspection,
      colmapInspection,
      residualReport,
      transformProposal,
    }),
  };
}

describe("OmniTwin Foundry phase-one contracts", () => {
  it("accepts an exact digest-bound decision-B phase-one bundle", () => {
    const { bundle } = fixture();
    expect(FoundryPhase1BundleV0Schema.parse(bundle)).toEqual(bundle);
    expect(bundle.identityReview.decision.excludedSweeps).toEqual([
      { sweepIndex: 49, reason: "excluded_adjacent_space" },
    ]);
  });

  it("rejects identity material drift under an unchanged review digest", () => {
    const review = clone(fixture().bundle.identityReview);
    review.evidenceIndexSha256 = sha("9");
    expect(FoundryPhase1IdentityReviewV0Schema.safeParse(review).success).toBe(false);
  });

  it("makes decision B confirm 0,10,20,40 and exclude only 49", () => {
    const review = clone(fixture().bundle.identityReview);
    expect(review.decision.confirmedIdentitySweepIndices).toEqual([0, 10, 20, 40]);
    const malformed = {
      ...review,
      decision: { ...review.decision, roomIdentityConfirmed: false },
    };
    expect(FoundryPhase1IdentityReviewV0Schema.safeParse(malformed).success).toBe(false);
  });

  it("binds every COLMAP source role to its exact canonical relative path", () => {
    const files = fixture().bundle.colmapInspection.sourceFiles;
    const database = files.find((file) => file.role === "database");
    const images = files.find((file) => file.role === "images_bin");
    if (database === undefined || images === undefined) {
      throw new Error("fixture must contain database and images source files");
    }
    expect(
      FoundryPhase1ColmapSourceFileSchema.safeParse({
        ...database,
        role: images.role,
      }).success,
    ).toBe(false);
    expect(
      FoundryPhase1ColmapSourceFileSchema.safeParse({
        ...images,
        relativePath: database.relativePath,
      }).success,
    ).toBe(false);
  });

  it("blocks downstream parsing when human review is missing or failed", () => {
    const bundle = fixture().bundle;
    const { identityReview: _identityReview, ...missingReview } = bundle;
    expect(FoundryPhase1BundleV0Schema.safeParse(missingReview).success).toBe(false);
    expect(
      FoundryPhase1BundleV0Schema.safeParse({
        ...bundle,
        identityReview: {
          ...bundle.identityReview,
          decision: { ...bundle.identityReview.decision, roomIdentityConfirmed: false },
        },
      }).success,
    ).toBe(false);
  });

  it("keeps the proposal structurally distinct from reviewed TransformArtifactV0", () => {
    const proposal = fixture().bundle.transformProposal;
    expect(proposal.state).toBe("proposed");
    expect(proposal.reviewer).toBeNull();
    expect(proposal.authority).toEqual({ public: "none", runtime: "none" });
    expect(TransformArtifactV0Schema.safeParse(proposal).success).toBe(false);
  });

  it("freezes disjoint candidate fit and holdout partitions and excludes 49", () => {
    const material = clone(fixture().reportMaterial);
    const candidate = material.phase1CandidateWithHoldout;
    expect(candidate.fitSweepIndices).toHaveLength(44);
    expect(candidate.holdoutSweepIndices).toEqual([5, 15, 25, 35, 44]);
    expect(candidate.candidateSweepIndices).not.toContain(49);
    candidate.fitSweepIndices[0] = 5;
    expect(FoundryPhase1ResidualReportMaterialV0Schema.safeParse(material).success).toBe(false);
  });

  it("binds metrics to per-correspondence residuals and rejects count drift", () => {
    const material = clone(fixture().reportMaterial);
    material.fullFit.evaluation.metrics.count = 49;
    expect(FoundryPhase1ResidualReportMaterialV0Schema.safeParse(material).success).toBe(false);
  });

  it("accepts the documented full-fit reproduction within explicit rounding tolerances", () => {
    const { fullFit } = fixture().reportMaterial;
    expect(fullFit.documentedDiagnostic).toMatchObject({
      reproductionStatus: "matched_within_rounding_tolerance",
      roundingTolerances: {
        scaleAbsolute: 5e-10,
        residualMetricAbsoluteMeters: 5e-8,
      },
    });
    expect(fullFit.transform.scale).toBeCloseTo(1.7362602881, 10);
    expect(fullFit.evaluation.metrics.rmseMeters).toBeCloseTo(0.0106706, 7);
  });

  it("rejects a full-fit reproduction outside the frozen scale or metric tolerance", () => {
    const scaleDrift = clone(fixture().reportMaterial);
    scaleDrift.fullFit.transform.scale += 1e-6;
    const scaleResult = FoundryPhase1ResidualReportMaterialV0Schema.safeParse(scaleDrift);
    expect(scaleResult.success).toBe(false);
    if (scaleResult.success) throw new Error("scale drift must fail");
    expect(scaleResult.error.issues.map((issue) => issue.message)).toContain(
      "full-fit scale must reproduce the documented diagnostic within rounding tolerance",
    );

    const metricDrift = clone(fixture().reportMaterial);
    for (const record of metricDrift.fullFit.evaluation.records) {
      record.residualMeters += 1e-6;
    }
    const metricResult = FoundryPhase1ResidualReportMaterialV0Schema.safeParse(metricDrift);
    expect(metricResult.success).toBe(false);
    if (metricResult.success) throw new Error("metric drift must fail");
    expect(metricResult.error.issues.map((issue) => issue.message)).toContain(
      "rmseMeters must reproduce the documented diagnostic within rounding tolerance",
    );
  });

  it("checks predictions using the declared 4x4 column-major matrix", () => {
    const { reportMaterial } = fixture();
    const first = reportMaterial.fullFit.evaluation.records[0];
    expect(first?.predictedE57GlobalM).toEqual([10, 20, 30]);
    const malformed = clone(reportMaterial);
    const malformedFirst = malformed.fullFit.evaluation.records[0];
    if (malformedFirst === undefined) throw new Error("fixture must contain a first residual");
    malformedFirst.predictedE57GlobalM = [0, 0, 0];
    expect(FoundryPhase1ResidualReportMaterialV0Schema.safeParse(malformed).success).toBe(false);
  });

  it("rejects non-finite coordinates and residual metrics", () => {
    const material = clone(fixture().reportMaterial);
    const first = material.correspondences[0];
    if (first === undefined) throw new Error("fixture must contain a first correspondence");
    first.colmapCenterMean[0] = Number.NaN;
    expect(FoundryPhase1ResidualReportMaterialV0Schema.safeParse(material).success).toBe(false);
  });

  it("enforces strict scan filename grouping and unweighted center means", () => {
    const material = clone(fixture().reportMaterial);
    const first = material.correspondences[0];
    if (first === undefined) throw new Error("fixture must contain a first correspondence");
    first.colmapFaceCenters[0] = {
      imageName: "scan_001_front.jpg",
      face: "front",
      centerColmapWorld: [-0.5, 0, 0],
    };
    expect(FoundryPhase1ResidualReportMaterialV0Schema.safeParse(material).success).toBe(false);
  });

  it("cross-binds inspection, source, report, and proposal digests", () => {
    const bundle = clone(fixture().bundle);
    bundle.transformProposal.identityReviewSha256 = sha("8");
    expect(FoundryPhase1BundleV0Schema.safeParse(bundle).success).toBe(false);
  });

  it("accepts finite probe envelopes for all three read-only modes and rejects NaN", () => {
    for (const mode of ["inspect-e57", "inspect-colmap", "align"] as const) {
      expect(FoundryPhase1ProbeEnvelopeV0Schema.safeParse({
        schemaVersion: "omnitwin.foundry.phase1-probe.v0",
        mode,
        status: "ok",
        result: { count: 1 },
      }).success).toBe(true);
    }
    expect(FoundryPhase1ProbeEnvelopeV0Schema.safeParse({
      schemaVersion: "omnitwin.foundry.phase1-probe.v0",
      mode: "align",
      status: "ok",
      result: { residual: Number.NaN },
    }).success).toBe(false);
  });
});

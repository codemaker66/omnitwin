import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  FOUNDRY_CANONICAL_VENUE_PACKAGE_V0,
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_JOB_SPEC_V0,
  FOUNDRY_QUALITY_CONTRACT_V0,
  FOUNDRY_QUALITY_REPORT_V0,
  FOUNDRY_RIGHTS_POLICY_DEFINITION_V0,
  FOUNDRY_INPUT_TYPES,
  FoundryCanonicalVenuePackageV0Schema,
  FoundryComputeApprovalSchema,
  FoundryExecutionConfirmationSchema,
  FoundryIngestManifestV0Schema,
  FoundryJobSpecV0Schema,
  FoundryProviderPlanSchema,
  FoundryQualityReportV0Schema,
  FoundryRightsApprovalSchema,
  FoundryRightsPolicyDefinitionV0Schema,
  computeFoundryIngestManifestSha256,
  computeFoundryJobApprovalSubjectSha256,
  computeFoundryJobSpecSha256,
  detectFoundryInputFile,
  decideFoundryJobDispatch,
  evaluateFoundryJobDispatch,
  validateFoundryCanonicalPackageReferences,
  validateFoundryJobRights,
  validateFoundryProviderPlan,
  validateFoundryQualityEvidence,
  validateFoundryTrustedRightsApproval,
} from "../omnitwin-foundry.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const DIGEST_A = `sha256:${SHA_A}`;
const DIGEST_B = `sha256:${SHA_B}`;
const NOW = "2026-07-12T10:00:00.000Z";

const GAUSSIAN_PLY_REQUIRED_PROPERTIES = [
  "x", "y", "z",
  "f_dc_0", "f_dc_1", "f_dc_2",
  "opacity",
  "scale_0", "scale_1", "scale_2",
  "rot_0", "rot_1", "rot_2", "rot_3",
] as const;

function gaussianPlyClassifierHeader(options: {
  readonly declaredType?: string;
  readonly separator?: string;
  readonly comments?: readonly string[];
  readonly propertyKeyword?: string;
  readonly includeEndHeader?: boolean;
} = {}): string {
  const separator = options.separator ?? " ";
  return [
    "ply",
    ["format", "binary_little_endian", "1.0"].join(separator),
    ...(options.comments ?? []),
    ["element", "vertex", "1"].join(separator),
    ...GAUSSIAN_PLY_REQUIRED_PROPERTIES.map((name) =>
      [options.propertyKeyword ?? "property", options.declaredType ?? "float", name]
        .join(separator)
    ),
    ...(options.includeEndHeader === false ? [] : ["end_header"]),
    "",
  ].join("\n");
}

function permittedRights() {
  return {
    basis: "customer_owned" as const,
    commercialUse: "allowed" as const,
    modelTrainingUse: "allowed" as const,
    redistribution: "allowed" as const,
    termsReviewedAt: NOW,
    termsReference: "https://rights.example/grand-hall",
    restrictions: [],
  };
}

function ingestManifest() {
  return {
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "grand-hall-pilot",
    createdAt: NOW,
    createdBy: "operator-1",
    sourceRoots: [
      {
        id: "e57-root",
        kind: "local_directory" as const,
        displayName: "Read-only source",
        locationRedacted: "E57_ASSET_ROOT",
        caseSensitivity: "insensitive" as const,
        readOnly: true as const,
      },
    ],
    coordinateFrames: [
      {
        id: "venue-control",
        kind: "venue_control" as const,
        units: "meters" as const,
        handedness: "right" as const,
        upAxis: "z" as const,
        authority: "measured" as const,
        provenanceAssetIds: ["e57-main"],
        crs: null,
      },
    ],
    transforms: [],
    assets: [
      {
        id: "e57-main",
        sourceRootId: "e57-root",
        relativePath: "cloud_0.e57",
        inputType: "matterport_e57" as const,
        mediaType: "model/e57",
        sizeBytes: 20_518_437_888,
        sha256: DIGEST_A,
        immutable: true as const,
        captureState: "official_export" as const,
        accessState: "official_export" as const,
        capturedAt: null,
        coordinateFrameId: "venue-control",
        calibrationAssetIds: [],
        parentAssetIds: [],
        rights: permittedRights(),
        provenanceClass: "captured" as const,
        evidenceKinds: [],
        inspection: {
          geometryValue: "high" as const,
          appearanceValue: "medium" as const,
          calibrationValue: "medium" as const,
          scaleValue: "high" as const,
          metadataKeys: ["data3D", "images2D"],
          decisiveNextTest: "Materialize five scans and verify poses, fields, and image links.",
        },
        notes: ["Registered scan positions; capture timestamps unavailable."],
      },
    ],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "approved" as const,
    sourceMutationPermitted: false as const,
  };
}

function jobSpec() {
  return {
    schemaVersion: FOUNDRY_JOB_SPEC_V0,
    id: "pilot-plan-1",
    projectId: "grand-hall-pilot",
    ingestManifestSha256: computeFoundryIngestManifestSha256(
      FoundryIngestManifestV0Schema.parse(ingestManifest()),
    ),
    executionIntent: "plan_only" as const,
    providerKind: "runpod" as const,
    providerAdapterId: "runpod-v0",
    stages: [
      {
        id: "inspect",
        kind: "inspect" as const,
        dependsOn: [],
        containerImage: `registry.example/foundry-inspect@sha256:${SHA_B}`,
        command: ["foundry", "inspect", "--manifest", "manifest.json"],
        inputAssetIds: ["e57-main"],
        outputNames: ["inspection-report"],
        rightsPurposes: ["commercial_internal_use" as const],
        cpuCores: 4,
        ramGiB: 16,
        gpuCount: 0,
        minimumGpuVramGiB: 0,
        scratchGiB: 100,
        networkAccess: "none" as const,
        checkpoint: "stage_boundary" as const,
        resumable: true,
      },
    ],
    objectStorageProfile: null,
    sourceMountMode: "read_only" as const,
    outputPrefix: "projects/grand-hall/jobs/pilot-plan-1",
    estimatedCostUsd: 5,
    budgetCapUsd: 10,
    killSwitchEnabled: true as const,
    computeApprovalId: null,
    createdAt: NOW,
  };
}

function executionConfirmation(
  job: Parameters<typeof computeFoundryJobApprovalSubjectSha256>[0],
  overrides: Record<string, unknown> = {},
) {
  return FoundryExecutionConfirmationSchema.parse({
    confirmationId: "confirmation-1",
    jobSubjectSha256: computeFoundryJobApprovalSubjectSha256(job),
    jobId: job.id,
    confirmedBy: "operator-1",
    confirmedAt: "2026-07-12T10:45:00.000Z",
    expiresAt: "2026-07-12T14:00:00.000Z",
    ...overrides,
  });
}

function rightsApproval(
  job: Parameters<typeof computeFoundryJobApprovalSubjectSha256>[0],
  overrides: Record<string, unknown> = {},
) {
  return FoundryRightsApprovalSchema.parse({
    jobSubjectSha256: computeFoundryJobApprovalSubjectSha256(job),
    ingestManifestSha256: job.ingestManifestSha256,
    policyVersion: "rights-policy-v0",
    policyDefinitionSha256: DIGEST_B,
    policyGeneration: 1,
    decision: "allowed",
    decidedBy: "rights-reviewer",
    decidedAt: "2026-07-12T10:40:00.000Z",
    expiresAt: "2026-07-12T14:00:00.000Z",
    ...overrides,
  });
}

function rightsPolicy(overrides: Record<string, unknown> = {}) {
  return FoundryRightsPolicyDefinitionV0Schema.parse({
    schemaVersion: FOUNDRY_RIGHTS_POLICY_DEFINITION_V0,
    policyVersion: "rights-policy-v0",
    policyDefinitionSha256: DIGEST_B,
    generation: 1,
    effectiveAt: "2026-07-12T10:00:00.000Z",
    revokedAt: null,
    maximumApprovalTtlSeconds: 12_000,
    ...overrides,
  });
}

function qualityReport() {
  return {
    schemaVersion: FOUNDRY_QUALITY_REPORT_V0,
    id: "quality-report-1",
    contract: {
      schemaVersion: FOUNDRY_QUALITY_CONTRACT_V0,
      id: "planning-contract-1",
      profile: "planning" as const,
      profileDefinitionId: "planning-profile-v0",
      profileDefinitionSha256: DIGEST_A,
      purpose: "Prove metric alignment and human fixed-view suitability for planning use.",
      requirements: [
        {
          id: "alignment-rmse",
          dimension: "geometry" as const,
          metric: "cloud_alignment_rmse",
          comparison: "lte" as const,
          threshold: 0.02,
          unit: "m",
          required: true,
          scope: "pilot room",
          evidenceRequired: ["residual_report"],
        },
        {
          id: "provenance-closure",
          dimension: "provenance" as const,
          metric: "unresolved_lineage_count",
          comparison: "eq" as const,
          threshold: 0,
          unit: "count",
          required: true,
          scope: "pilot room",
          evidenceRequired: ["provenance_report"],
        },
      ],
      requiredHumanReviews: ["fixed_view"],
      generatedContentPolicy: "separate_derivative_only" as const,
    },
    subjectAssetIds: ["measured-mesh"],
    measurements: [
      {
        requirementId: "alignment-rmse",
        value: 0.011,
        status: "passed" as const,
        evidenceAssetIds: ["alignment-report"],
        evidenceKinds: ["residual_report"],
        caveat: null,
      },
      {
        requirementId: "provenance-closure",
        value: 0,
        status: "passed" as const,
        evidenceAssetIds: ["provenance-report"],
        evidenceKinds: ["provenance_report"],
        caveat: null,
      },
    ],
    humanReviews: [
      {
        reviewKind: "fixed_view",
        reviewerId: "reviewer-1",
        reviewerAttestationAssetId: "reviewer-attestation",
        decision: "approved" as const,
        reviewedAt: NOW,
        evidenceAssetIds: ["fixed-view-sheet"],
        note: "The blinded fixed-view comparison passed with no unresolved structural defects.",
      },
    ],
    outcome: "passed" as const,
    evaluatedAt: NOW,
  };
}

describe("OmniTwin Foundry control-plane contracts", () => {
  it("keeps the portable ingest input-type enum exactly aligned with the TypeScript contract", () => {
    const PortableInputTypeEnumSchema = z
      .object({
        $defs: z.object({
          asset: z.object({
            properties: z.object({
              inputType: z.object({ enum: z.array(z.string()) }),
            }),
          }),
        }),
      });
    const portableSchema: unknown = JSON.parse(
      readFileSync(
        new URL(
          "../../../../docs/specs/omnitwin-universal-ingest-manifest-v0.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const portableInputTypes = PortableInputTypeEnumSchema.parse(portableSchema)
      .$defs.asset.properties.inputType.enum;
    expect(portableInputTypes).toEqual([...FOUNDRY_INPUT_TYPES]);
  });

  it("detects bounded signatures and keeps ambiguous imagery ambiguous", () => {
    expect(
      detectFoundryInputFile({
        relativePath: "cloud_0.e57",
        magicHex: "4153544d2d453537",
        boundedHeaderText: null,
      }),
    ).toMatchObject({
      status: "detected",
      candidates: [{ inputType: "generic_e57", confidence: "high" }],
    });
    expect(
      detectFoundryInputFile({
        relativePath: "point_cloud.ply",
        magicHex: "706c79",
        boundedHeaderText: gaussianPlyClassifierHeader(),
      }),
    ).toMatchObject({
      status: "detected",
      candidates: [{ inputType: "gaussian_ply", confidence: "high" }],
    });
    const image = detectFoundryInputFile({
      relativePath: "images/scan_000_front.jpg",
      magicHex: "ffd8ff",
      boundedHeaderText: null,
    });
    expect(image.status).toBe("ambiguous");
    expect(image.candidates.map((candidate) => candidate.inputType)).toEqual([
      "dslr_image",
      "generic_image",
      "matterport_panorama",
      "panorama_360",
      "phone_image",
    ]);
  });

  it("classifies Gaussian PLY from complete case-sensitive header grammar only", () => {
    const paddedFloat32 = detectFoundryInputFile({
      relativePath: "scene.ply",
      magicHex: "706c79",
      boundedHeaderText: gaussianPlyClassifierHeader({
        declaredType: "float32",
        separator: "\t",
        comments: Array.from(
          { length: 64 },
          (_, index) => `comment bounded classifier padding ${String(index)}`,
        ),
      }),
    });
    expect(paddedFloat32).toMatchObject({
      status: "detected",
      candidates: [{ inputType: "gaussian_ply", confidence: "high" }],
    });

    const commentOnly = detectFoundryInputFile({
      relativePath: "points.ply",
      magicHex: "706c79",
      boundedHeaderText: [
        "ply",
        "format binary_little_endian 1.0",
        "comment property float f_dc_0",
        "comment property float scale_0",
        "comment property float rot_0",
        "element vertex 1",
        "property float x",
        "property float y",
        "property float z",
        "end_header",
        "",
      ].join("\n"),
    });
    expect(commentOnly.candidates[0]?.inputType).toBe("ply_point_cloud");

    for (const boundedHeaderText of [
      gaussianPlyClassifierHeader({ declaredType: "FLOAT" }),
      gaussianPlyClassifierHeader({ propertyKeyword: "PROPERTY" }),
      gaussianPlyClassifierHeader().replace(
        "binary_little_endian",
        "BINARY_LITTLE_ENDIAN",
      ),
    ]) {
      expect(detectFoundryInputFile({
        relativePath: "uppercase.ply",
        magicHex: "706c79",
        boundedHeaderText,
      }).candidates[0]?.inputType).toBe("ply_point_cloud");
    }

    const incomplete = detectFoundryInputFile({
      relativePath: "bounded.ply",
      magicHex: "706c79",
      boundedHeaderText: gaussianPlyClassifierHeader({ includeEndHeader: false }),
    });
    expect(incomplete.candidates[0]?.inputType).toBe("ply_point_cloud");
    expect(incomplete.caveats).toEqual(expect.arrayContaining([
      expect.stringContaining("classification is inconclusive"),
    ]));
  });

  it("classifies XBAG without implying authorization to decode it", () => {
    const detected = detectFoundryInputFile({
      relativePath: "capture/project.xbin",
      magicHex: "5842414700020100",
      boundedHeaderText: null,
    });
    expect(detected).toMatchObject({
      status: "detected",
      candidates: [{ inputType: "xgrids_xbin", confidence: "high" }],
    });
    expect(detected.caveats).toContain(
      "Classification does not authorize proprietary payload decoding.",
    );
  });

  it("classifies COLMAP database and sparse-model inputs without treating them as generic evidence", () => {
    expect(
      detectFoundryInputFile({
        relativePath: "colmap_v2/database.db",
        magicHex: "53514c69746520666f726d6174203300",
        boundedHeaderText: null,
      }),
    ).toMatchObject({
      status: "detected",
      candidates: [{ inputType: "colmap_database", confidence: "high" }],
    });
    expect(
      detectFoundryInputFile({
        relativePath: "colmap_v2/sparse/0/images.bin",
        magicHex: "e700000000000000",
        boundedHeaderText: null,
      }),
    ).toMatchObject({
      status: "detected",
      candidates: [{ inputType: "colmap_sparse_model", confidence: "medium" }],
    });
  });

  it("accepts an immutable, rights-reviewed ingest manifest", () => {
    const parsed = FoundryIngestManifestV0Schema.parse(ingestManifest());
    expect(parsed.assets[0]?.inputType).toBe("matterport_e57");
    expect(parsed.sourceMutationPermitted).toBe(false);
  });

  it("rejects traversal, unresolved references, and false legal approval", () => {
    const base = ingestManifest();
    for (const relativePath of [
      "../cloud_0.e57",
      "nested/..",
      "nested//cloud.e57",
      " cloud.e57",
      "con.txt",
      "nested/cloud.e57.",
      "nested/cloud.e57:stream",
      "nested/\u202eevil.e57",
    ]) {
      expect(
        FoundryIngestManifestV0Schema.safeParse({
          ...base,
          assets: [{ ...base.assets[0]!, relativePath }],
        }).success,
      ).toBe(false);
    }
    expect(
      FoundryIngestManifestV0Schema.safeParse({
        ...base,
        assets: [{ ...base.assets[0]!, coordinateFrameId: "missing-frame" }],
      }).success,
    ).toBe(false);
    expect(
      FoundryIngestManifestV0Schema.safeParse({
        ...base,
        assets: [
          {
            ...base.assets[0]!,
            rights: { ...permittedRights(), modelTrainingUse: "prohibited" as const },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("reuses the reviewed column-major affine transform convention", () => {
    const base = ingestManifest();
    const roomFrame = {
      ...base.coordinateFrames[0]!,
      id: "grand-hall-local",
      kind: "room_local" as const,
      authority: "registered" as const,
    };
    const transform = {
      id: "venue-from-room",
      sourceFrameId: "grand-hall-local",
      targetFrameId: "venue-control",
      matrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        2, 3, 4, 1,
      ],
      operationKind: "affine_similarity" as const,
      state: "proposed" as const,
      transformArtifactAssetId: null,
      residualReportAssetId: null,
      projectionArtifactAssetId: null,
      reviewerAttestationAssetId: null,
      provenanceAssetIds: ["e57-main"],
    };
    expect(
      FoundryIngestManifestV0Schema.safeParse({
        ...base,
        coordinateFrames: [...base.coordinateFrames, roomFrame],
        transforms: [transform],
      }).success,
    ).toBe(true);
    expect(
      FoundryIngestManifestV0Schema.safeParse({
        ...base,
        coordinateFrames: [...base.coordinateFrames, roomFrame],
        transforms: [{ ...transform, matrix: [...transform.matrix.slice(0, 15), 2] }],
      }).success,
    ).toBe(false);
    const evidenceAsset = (
      id: string,
      evidenceKind:
        | "transform_artifact"
        | "residual_report"
        | "reviewer_attestation",
    ) => ({
      ...base.assets[0]!,
      id,
      relativePath: `evidence/${id}.json`,
      inputType: "evidence_record" as const,
      mediaType: "application/json",
      sizeBytes: 1_024,
      captureState: "reference" as const,
      coordinateFrameId: null,
      evidenceKinds: [evidenceKind],
    });
    const transformEvidence = evidenceAsset("transform-artifact", "transform_artifact");
    const residualEvidence = evidenceAsset("residual-report", "residual_report");
    const reviewerEvidence = evidenceAsset("reviewer-attestation", "reviewer_attestation");
    const reviewedTransform = {
      ...transform,
      state: "reviewed" as const,
      transformArtifactAssetId: transformEvidence.id,
      residualReportAssetId: residualEvidence.id,
      reviewerAttestationAssetId: reviewerEvidence.id,
    };
    expect(
      FoundryIngestManifestV0Schema.safeParse({
        ...base,
        coordinateFrames: [...base.coordinateFrames, roomFrame],
        assets: [...base.assets, transformEvidence, residualEvidence, reviewerEvidence],
        transforms: [reviewedTransform],
      }).success,
    ).toBe(true);
    expect(
      FoundryIngestManifestV0Schema.safeParse({
        ...base,
        coordinateFrames: [...base.coordinateFrames, roomFrame],
        assets: [
          ...base.assets,
          transformEvidence,
          { ...residualEvidence, evidenceKinds: ["other"] },
          reviewerEvidence,
        ],
        transforms: [reviewedTransform],
      }).success,
    ).toBe(false);
  });

  it("separates nonlinear CRS projection from affine alignment", () => {
    const base = ingestManifest();
    const geodeticFrame = {
      id: "wgs84-geodetic",
      kind: "geodetic" as const,
      units: "degrees" as const,
      handedness: "right" as const,
      upAxis: "z" as const,
      authority: "vendor_declared" as const,
      provenanceAssetIds: ["e57-main"],
      crs: {
        authority: "EPSG",
        code: "4326",
        axisOrder: "longitude_latitude" as const,
        horizontalDatum: "WGS 84",
        verticalDatum: null,
        coordinateEpoch: null,
      },
    };
    const projectedFrame = {
      ...geodeticFrame,
      id: "projected-grid",
      kind: "projected" as const,
      units: "meters" as const,
      authority: "registered" as const,
      crs: {
        authority: "EPSG",
        code: "27700",
        axisOrder: "easting_northing" as const,
        horizontalDatum: "OSGB36",
        verticalDatum: "ODN",
        coordinateEpoch: null,
      },
    };
    const projectionAsset = {
      ...base.assets[0]!,
      id: "projection-operation",
      relativePath: "evidence/projection-operation.json",
      inputType: "evidence_record" as const,
      mediaType: "application/json",
      sizeBytes: 2_048,
      captureState: "reference" as const,
      coordinateFrameId: null,
      evidenceKinds: ["projection_operation" as const],
    };
    const projection = {
      id: "project-wgs84-to-grid",
      sourceFrameId: geodeticFrame.id,
      targetFrameId: projectedFrame.id,
      operationKind: "crs_projection" as const,
      matrix: null,
      state: "proposed" as const,
      transformArtifactAssetId: null,
      residualReportAssetId: null,
      projectionArtifactAssetId: projectionAsset.id,
      reviewerAttestationAssetId: null,
      provenanceAssetIds: ["e57-main"],
    };
    const manifest = {
      ...base,
      coordinateFrames: [...base.coordinateFrames, geodeticFrame, projectedFrame],
      assets: [...base.assets, projectionAsset],
      transforms: [projection],
    };
    expect(FoundryIngestManifestV0Schema.safeParse(manifest).success).toBe(true);
    expect(
      FoundryIngestManifestV0Schema.safeParse({
        ...manifest,
        transforms: [
          {
            ...projection,
            operationKind: "affine_similarity",
            matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            projectionArtifactAssetId: null,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("permits a remote plan but refuses to dispatch it", () => {
    const plan = FoundryJobSpecV0Schema.parse(jobSpec());
    expect(plan.executionIntent).toBe("plan_only");
    expect(
      decideFoundryJobDispatch(plan, {
        now: new Date(NOW),
        trustedConfirmation: null,
        consumeExecutionConfirmation: () => true,
        trustedApproval: null,
        trustedRightsApproval: null,
        trustedRightsPolicy: null,
      }),
    ).toEqual({
      allowed: false,
      reason: "plan_only",
    });
  });

  it("requires live, provider-scoped approval for paid execution", () => {
    const base = jobSpec();
    expect(
      FoundryJobSpecV0Schema.safeParse({ ...base, executionIntent: "execute" }).success,
    ).toBe(false);

    const executionRequest = FoundryJobSpecV0Schema.parse({
      ...base,
      executionIntent: "execute",
      computeApprovalId: "approval-1",
    });
    const approval = FoundryComputeApprovalSchema.parse({
      approvalId: "approval-1",
      jobSubjectSha256: computeFoundryJobApprovalSubjectSha256(executionRequest),
      jobId: executionRequest.id,
      projectId: executionRequest.projectId,
      providerKind: executionRequest.providerKind,
      providerAdapterId: executionRequest.providerAdapterId,
      approvedBy: "budget-owner",
      approvedAt: "2026-07-12T10:30:00.000Z",
      expiresAt: "2026-07-12T12:00:00.000Z",
      maximumCostUsd: 20,
    });
    const confirmation = executionConfirmation(executionRequest);
    const pureEvaluation = evaluateFoundryJobDispatch(executionRequest, {
      now: new Date("2026-07-12T11:00:00.000Z"),
      trustedConfirmation: confirmation,
      trustedApproval: approval,
      trustedRightsApproval: rightsApproval(executionRequest),
      trustedRightsPolicy: rightsPolicy(),
    });
    expect(pureEvaluation.allowed).toBe(true);
    if (pureEvaluation.allowed) {
      expect(pureEvaluation.confirmation.confirmationId).toBe(confirmation.confirmationId);
      expect(pureEvaluation.job).toEqual(executionRequest);
      expect(pureEvaluation.computeApproval).toEqual(approval);
    }
    expect(
      decideFoundryJobDispatch(executionRequest, {
        now: new Date("2026-07-12T11:00:00.000Z"),
        trustedConfirmation: confirmation,
        consumeExecutionConfirmation: () => true,
        trustedApproval: approval,
        trustedRightsApproval: rightsApproval(executionRequest),
        trustedRightsPolicy: rightsPolicy(),
      }),
    ).toEqual({
      allowed: true,
    });
    expect(
      decideFoundryJobDispatch(executionRequest, {
        now: new Date("2026-07-12T13:00:00.000Z"),
        trustedConfirmation: confirmation,
        consumeExecutionConfirmation: () => true,
        trustedApproval: approval,
        trustedRightsApproval: rightsApproval(executionRequest),
        trustedRightsPolicy: rightsPolicy(),
      }),
    ).toEqual({
      allowed: false,
      reason: "approval_expired",
    });
    const changedBudgetRequest = FoundryJobSpecV0Schema.parse({
      ...executionRequest,
      budgetCapUsd: 11,
    });
    expect(
      decideFoundryJobDispatch(changedBudgetRequest, {
        now: new Date("2026-07-12T11:00:00.000Z"),
        trustedConfirmation: executionConfirmation(changedBudgetRequest),
        consumeExecutionConfirmation: () => true,
        trustedApproval: approval,
        trustedRightsApproval: rightsApproval(changedBudgetRequest),
        trustedRightsPolicy: rightsPolicy(),
      }),
    ).toEqual({ allowed: false, reason: "approval_subject_mismatch" });
    expect(
      decideFoundryJobDispatch(executionRequest, {
        now: new Date(Number.NaN),
        trustedConfirmation: confirmation,
        consumeExecutionConfirmation: () => true,
        trustedApproval: approval,
        trustedRightsApproval: rightsApproval(executionRequest),
        trustedRightsPolicy: rightsPolicy(),
      }),
    ).toEqual({ allowed: false, reason: "invalid_dispatch_time" });
  });

  it("quarantines legacy local dispatch until the durable trusted-worker gate", () => {
    const local = FoundryJobSpecV0Schema.parse({
      ...jobSpec(),
      executionIntent: "execute",
      providerKind: "local_cpu",
      providerAdapterId: "local-cpu-v0",
      estimatedCostUsd: 0,
      budgetCapUsd: 0,
    });
    const consumeExecutionConfirmation = vi.fn(() => true);
    const localContext = {
      now: new Date("2026-07-12T11:00:00.000Z"),
      trustedConfirmation: executionConfirmation(local),
      trustedApproval: null,
      trustedRightsApproval: rightsApproval(local),
      trustedRightsPolicy: rightsPolicy(),
    };
    expect(evaluateFoundryJobDispatch(local, localContext)).toEqual({
      allowed: false,
      reason: "local_execution_requires_durable_trusted_worker_profile",
    });
    expect(
      decideFoundryJobDispatch(local, {
        ...localContext,
        consumeExecutionConfirmation,
      }),
    ).toEqual({
      allowed: false,
      reason: "local_execution_requires_durable_trusted_worker_profile",
    });
    expect(consumeExecutionConfirmation).not.toHaveBeenCalled();
    expect(
      validateFoundryTrustedRightsApproval(
        local,
        rightsApproval(local),
        new Date("2026-07-12T11:00:00.000Z"),
        rightsPolicy(),
      ).allowed,
    ).toBe(true);
    expect(
      validateFoundryTrustedRightsApproval(
        local,
        { ...rightsApproval(local), ingestManifestSha256: DIGEST_A },
        new Date("2026-07-12T11:00:00.000Z"),
        rightsPolicy(),
      ),
    ).toEqual({ allowed: false, reason: "rights_approval_subject_mismatch" });
    expect(
      decideFoundryJobDispatch(
        { ...local, createdAt: "2026-07-12T12:00:00.000Z" },
        {
          now: new Date("2026-07-12T11:00:00.000Z"),
          trustedConfirmation: executionConfirmation(local),
          consumeExecutionConfirmation: () => true,
          trustedApproval: null,
          trustedRightsApproval: rightsApproval(local),
          trustedRightsPolicy: rightsPolicy(),
        },
      ),
    ).toEqual({ allowed: false, reason: "job_not_yet_valid" });
  });

  it("keeps D-016 model training off local execution providers", () => {
    const localTrainingPlan = {
      ...jobSpec(),
      providerKind: "local_cuda" as const,
      providerAdapterId: "local-cuda-v0",
      estimatedCostUsd: 0,
      budgetCapUsd: 0,
      stages: [
        {
          ...jobSpec().stages[0]!,
          kind: "appearance" as const,
          rightsPurposes: ["model_training" as const],
        },
      ],
    };

    expect(FoundryJobSpecV0Schema.safeParse(localTrainingPlan).success).toBe(true);
    const localTrainingExecution = {
      ...localTrainingPlan,
      executionIntent: "execute" as const,
    };
    expect(FoundryJobSpecV0Schema.safeParse(localTrainingExecution).success).toBe(false);
    expect(
      decideFoundryJobDispatch(localTrainingExecution, {
        now: new Date("2026-07-12T11:00:00.000Z"),
        trustedConfirmation: null,
        consumeExecutionConfirmation: () => true,
        trustedApproval: null,
        trustedRightsApproval: null,
        trustedRightsPolicy: null,
      }),
    ).toEqual({ allowed: false, reason: "invalid_job_spec" });
  });

  it("rejects cyclic stage plans", () => {
    const base = jobSpec();
    const inspect = { ...base.stages[0]!, dependsOn: ["qa"] };
    const qa = {
      ...base.stages[0]!,
      id: "qa",
      kind: "qa" as const,
      dependsOn: ["inspect"],
      outputNames: ["qa-report"],
    };
    expect(FoundryJobSpecV0Schema.safeParse({ ...base, stages: [inspect, qa] }).success).toBe(
      false,
    );
  });

  it("evaluates input rights for each declared stage purpose", () => {
    expect(validateFoundryJobRights(jobSpec(), ingestManifest())).toEqual({ allowed: true });
    const manifest = ingestManifest();
    const restrictedManifest = FoundryIngestManifestV0Schema.parse({
      ...manifest,
      legalReviewState: "requires_review",
      assets: [
        {
          ...manifest.assets[0]!,
          rights: {
            ...manifest.assets[0]!.rights,
            modelTrainingUse: "prohibited",
          },
        },
      ],
    });
    expect(
      validateFoundryJobRights(
        {
          ...jobSpec(),
          ingestManifestSha256: computeFoundryIngestManifestSha256(restrictedManifest),
          stages: [
            {
              ...jobSpec().stages[0]!,
              rightsPurposes: ["model_training"],
            },
          ],
        },
        restrictedManifest,
      ),
    ).toMatchObject({
      allowed: false,
      blockers: ["inspect:e57-main:model_training_not_allowed"],
    });
  });

  it("validates provider plans as data rather than trusting adapter output", () => {
    const job = FoundryJobSpecV0Schema.parse(jobSpec());
    const plan = {
      providerKind: "runpod",
      providerAdapterId: "runpod-v0",
      jobSpecSha256: computeFoundryJobSpecSha256(job),
      estimatedCostUsd: 5,
      stagePlans: [{ stageId: "inspect", executionReference: "plan:inspect" }],
    };
    expect(
      FoundryProviderPlanSchema.safeParse(plan).success,
    ).toBe(true);
    expect(validateFoundryProviderPlan(job, plan)).toEqual({ valid: true });
    expect(
      FoundryProviderPlanSchema.safeParse({
        ...plan,
        estimatedCostUsd: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
    expect(
      validateFoundryProviderPlan(job, { ...plan, providerAdapterId: "other-adapter" }),
    ).toEqual({ valid: false, reason: "provider_plan_subject_mismatch" });
  });

  it("binds a passed quality result to metrics, evidence, and human review", () => {
    expect(FoundryQualityReportV0Schema.safeParse(qualityReport()).success).toBe(true);
    const report = qualityReport();
    expect(
      FoundryQualityReportV0Schema.safeParse({ ...report, humanReviews: [] }).success,
    ).toBe(false);
    expect(
      FoundryQualityReportV0Schema.safeParse({
        ...report,
        measurements: [{ ...report.measurements[0]!, value: 0.2, status: "passed" }],
      }).success,
    ).toBe(false);
    expect(
      FoundryQualityReportV0Schema.safeParse({
        ...report,
        measurements: [
          {
            ...report.measurements[0]!,
            value: null,
            status: "not_measured",
            evidenceAssetIds: [],
            caveat: null,
          },
        ],
        outcome: "blocked",
      }).success,
    ).toBe(false);
    expect(
      validateFoundryQualityEvidence(report, {
        assets: [
          { id: "measured-mesh", provenanceClass: "captured", evidenceKinds: [] },
          {
            id: "alignment-report",
            provenanceClass: "captured",
            evidenceKinds: ["residual_report"],
          },
          {
            id: "provenance-report",
            provenanceClass: "captured",
            evidenceKinds: ["provenance_report"],
          },
          {
            id: "fixed-view-sheet",
            provenanceClass: "captured",
            evidenceKinds: ["fixed_view"],
          },
          {
            id: "reviewer-attestation",
            provenanceClass: "captured",
            evidenceKinds: ["reviewer_attestation"],
          },
        ],
        generatedRegionOutputAssetIds: [],
        profileDefinitions: [
          {
            profile: "planning",
            definitionId: "planning-profile-v0",
            definitionSha256: DIGEST_A,
          },
        ],
      }),
    ).toEqual({ valid: true });
    expect(
      validateFoundryQualityEvidence(report, {
        assets: [],
        generatedRegionOutputAssetIds: [],
        profileDefinitions: [],
      }),
    ).toMatchObject({ valid: false });
  });

  it("keeps generated derivatives out of metric-geometry roles", () => {
    const representation = {
      id: "measured-mesh",
      role: "measured_geometry" as const,
      assetId: "mesh-asset",
      format: "glb" as const,
      coordinateFrameId: "venue-control",
      transformArtifactAssetId: "transform-artifact",
      qualityReportId: "quality-report-1",
      provenanceClass: "captured" as const,
      lod: 0,
    };
    const cameraSpawns = {
      ...representation,
      id: "camera-spawns",
      role: "camera_spawn_points" as const,
      assetId: "camera-spawn-asset",
      format: "json" as const,
      transformArtifactAssetId: null,
    };
    const connectivity = {
      ...representation,
      id: "room-connectivity",
      role: "room_connectivity" as const,
      assetId: "room-connectivity-asset",
      format: "json" as const,
      transformArtifactAssetId: null,
    };
    const semanticGraph = {
      ...representation,
      id: "semantic-graph",
      role: "semantic_graph" as const,
      assetId: "semantic-graph-asset",
      format: "json" as const,
      transformArtifactAssetId: null,
    };
    const venuePackage = {
      schemaVersion: FOUNDRY_CANONICAL_VENUE_PACKAGE_V0,
      id: "venue-package-1",
      projectId: "grand-hall-pilot",
      venueFrameId: "venue-control",
      ingestManifestSha256: DIGEST_A,
      rooms: [
        {
          id: "grand-hall",
          label: "Grand Hall",
          roomFrameId: "grand-hall-local",
          venueTransformArtifactAssetId: "venue-transform-artifact",
          sceneAuthorityMapAssetId: "scene-authority-map",
          representations: [representation, semanticGraph, cameraSpawns, connectivity],
        },
      ],
      generatedRegions: [],
      packageQualityReportId: "quality-report-1",
      releaseManifestAssetId: null,
      createdAt: NOW,
    };
    expect(FoundryCanonicalVenuePackageV0Schema.safeParse(venuePackage).success).toBe(true);
    expect(
      FoundryCanonicalVenuePackageV0Schema.safeParse({
        ...venuePackage,
        rooms: [
          {
            ...venuePackage.rooms[0]!,
            representations: [
              { ...representation, provenanceClass: "generated_cinematic" as const },
              semanticGraph,
              cameraSpawns,
              connectivity,
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      validateFoundryCanonicalPackageReferences(venuePackage, {
        assets: [
          ...[
            "mesh-asset",
            "camera-spawn-asset",
            "room-connectivity-asset",
            "semantic-graph-asset",
          ].map((id) => ({ id, provenanceClass: "captured", evidenceKinds: [] })),
          {
            id: "transform-artifact",
            provenanceClass: "captured",
            evidenceKinds: ["transform_artifact"],
          },
          {
            id: "venue-transform-artifact",
            provenanceClass: "captured",
            evidenceKinds: ["transform_artifact"],
          },
          {
            id: "scene-authority-map",
            provenanceClass: "captured",
            evidenceKinds: ["scene_authority_map"],
          },
        ],
        coordinateFrameIds: ["venue-control", "grand-hall-local"],
        qualityReports: [
          {
            id: "quality-report-1",
            outcome: "passed",
            evidenceResolved: true,
            profileResolved: true,
          },
        ],
      }),
    ).toEqual({ valid: true });
    const relabeledCatalog = {
      assets: [
        ...[
          "mesh-asset",
          "camera-spawn-asset",
          "room-connectivity-asset",
          "semantic-graph-asset",
        ].map((id) => ({
          id,
          provenanceClass:
            id === "mesh-asset" ? "generated_cinematic" : "captured",
          evidenceKinds: [],
        })),
        {
          id: "transform-artifact",
          provenanceClass: "captured",
          evidenceKinds: ["transform_artifact"],
        },
        {
          id: "venue-transform-artifact",
          provenanceClass: "captured",
          evidenceKinds: ["transform_artifact"],
        },
        {
          id: "scene-authority-map",
          provenanceClass: "captured",
          evidenceKinds: ["scene_authority_map"],
        },
      ],
      coordinateFrameIds: ["venue-control", "grand-hall-local"],
      qualityReports: [
        {
          id: "quality-report-1",
          outcome: "passed",
          evidenceResolved: true,
          profileResolved: true,
        },
      ],
    };
    expect(validateFoundryCanonicalPackageReferences(venuePackage, relabeledCatalog)).toMatchObject(
      { valid: false },
    );
    expect(
      validateFoundryCanonicalPackageReferences(venuePackage, {
        assets: [],
        coordinateFrameIds: [],
        qualityReports: [],
      }),
    ).toMatchObject({ valid: false });
  });
});

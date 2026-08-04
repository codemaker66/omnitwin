import { describe, expect, it } from "vitest";

import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_JOB_SPEC_V0,
  FOUNDRY_QUALITY_CONTRACT_V0,
  FOUNDRY_QUALITY_REPORT_V0,
  FoundryIngestManifestV0Schema,
  computeFoundryIngestManifestSha256,
  validateFoundryJobRights,
  validateFoundryQualityEvidence,
} from "../omnitwin-foundry.js";

const NOW = "2026-07-12T10:30:00.000Z";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const SHA_C = "c".repeat(64);

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

function asset(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sourceRootId: "e57-root",
    relativePath: `${id}.bin`,
    inputType: "generic_e57" as const,
    mediaType: "application/octet-stream",
    sizeBytes: 1_024,
    sha256: DIGEST_A,
    immutable: true as const,
    captureState: "official_export" as const,
    accessState: "official_export" as const,
    capturedAt: null,
    coordinateFrameId: null,
    calibrationAssetIds: [],
    parentAssetIds: [],
    rights: permittedRights(),
    provenanceClass: "captured" as const,
    evidenceKinds: [],
    inspection: {
      geometryValue: "medium" as const,
      appearanceValue: "medium" as const,
      calibrationValue: "medium" as const,
      scaleValue: "medium" as const,
      metadataKeys: [],
      decisiveNextTest: "Inspect this asset against its declared source facts.",
    },
    notes: [],
    ...overrides,
  };
}

function derived(id: string, parents: string[], overrides: Record<string, unknown> = {}) {
  return asset(id, {
    captureState: "derived",
    accessState: "direct",
    parentAssetIds: parents,
    ...overrides,
  });
}

function edge(id: string, inputs: string[], output: string) {
  return {
    id,
    operationId: `op-${id}`,
    inputAssetIds: inputs,
    outputAssetId: output,
    operationVersion: "1.0.0",
    environmentDigest: DIGEST_B,
    createdAt: NOW,
  };
}

function generatedRegion(id: string, output: string, sources: string[], mask: string) {
  return {
    id,
    outputAssetId: output,
    sourceAssetIds: sources,
    maskAssetId: mask,
    provenanceClass: "generated_cinematic" as const,
    modelName: "fixer-v2",
    modelVersion: "2.0.0",
    checkpointSha256: DIGEST_B,
    promptOrConditionDigest: DIGEST_B,
    confidence: 0.7,
    exportRestrictions: ["internal_review_only"],
    truthModeDisclosure:
      "This region is model-generated cinema and never measured venue evidence.",
  };
}

function manifest(overrides: Record<string, unknown> = {}) {
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
    coordinateFrames: [],
    transforms: [],
    assets: [asset("e57-main")],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "approved" as const,
    sourceMutationPermitted: false as const,
    ...overrides,
  };
}

function launderingManifest(launderedClass: "captured" | "enhanced_captured") {
  return manifest({
    assets: [
      asset("e57-main"),
      derived("mask-1", ["e57-main"], {
        provenanceClass: "enhanced_captured",
        evidenceKinds: ["mask"],
      }),
      derived("gen-1", ["e57-main", "mask-1"], { provenanceClass: "generated_cinematic" }),
      derived("laundered", ["gen-1"], { provenanceClass: launderedClass }),
    ],
    provenanceEdges: [
      edge("edge-mask", ["e57-main"], "mask-1"),
      edge("edge-gen", ["e57-main", "mask-1"], "gen-1"),
      edge("edge-laundered", ["gen-1"], "laundered"),
    ],
    generatedRegions: [generatedRegion("region-1", "gen-1", ["e57-main"], "mask-1")],
  });
}

function stage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "inspect" as const,
    dependsOn: [],
    containerImage: `registry.example/foundry-worker@sha256:${SHA_C}`,
    command: ["foundry", "run", id],
    inputAssetIds: ["e57-main"],
    outputNames: [`${id}-output`],
    rightsPurposes: ["commercial_internal_use" as const],
    cpuCores: 4,
    ramGiB: 16,
    gpuCount: 0,
    minimumGpuVramGiB: 0,
    scratchGiB: 100,
    networkAccess: "none" as const,
    checkpoint: "stage_boundary" as const,
    resumable: true,
    ...overrides,
  };
}

function jobFor(manifestValue: unknown, stages: unknown[]) {
  return {
    schemaVersion: FOUNDRY_JOB_SPEC_V0,
    id: "pilot-plan-1",
    projectId: "grand-hall-pilot",
    ingestManifestSha256: computeFoundryIngestManifestSha256(
      FoundryIngestManifestV0Schema.parse(manifestValue),
    ),
    executionIntent: "plan_only" as const,
    providerKind: "runpod" as const,
    providerAdapterId: "runpod-v0",
    stages,
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

function evidenceCatalogAsset(
  id: string,
  provenanceClass: string,
  evidenceKinds: string[],
) {
  return { id, provenanceClass, evidenceKinds };
}

function qualityReport(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: FOUNDRY_QUALITY_REPORT_V0,
    id: "quality-report-1",
    contract: {
      schemaVersion: FOUNDRY_QUALITY_CONTRACT_V0,
      id: "planning-contract-1",
      profile: "planning" as const,
      profileDefinitionId: "planning-profile-v0",
      profileDefinitionSha256: DIGEST_A,
      purpose: "Prove metric alignment suitability for planning use of the pilot room.",
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
      generatedContentPolicy: "forbidden" as const,
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
    ...overrides,
  };
}

function evidenceCatalog(overrides: Record<string, unknown> = {}) {
  return {
    assets: [
      evidenceCatalogAsset("measured-mesh", "captured", []),
      evidenceCatalogAsset("alignment-report", "captured", ["residual_report"]),
      evidenceCatalogAsset("provenance-report", "captured", ["provenance_report"]),
      evidenceCatalogAsset("fixed-view-sheet", "captured", ["fixed_view"]),
      evidenceCatalogAsset("reviewer-attestation", "captured", ["reviewer_attestation"]),
    ],
    generatedRegionOutputAssetIds: [],
    profileDefinitions: [
      {
        profile: "planning",
        definitionId: "planning-profile-v0",
        definitionSha256: DIGEST_A,
      },
    ],
    ...overrides,
  };
}

describe("Truth-hardening: provenance-class monotonicity over lineage", () => {
  it("rejects a captured asset derived from generated parents", () => {
    const result = FoundryIngestManifestV0Schema.safeParse(launderingManifest("captured"));
    expect(result.success).toBe(false);
  });

  it("rejects an enhanced_captured asset derived from generated parents", () => {
    const result = FoundryIngestManifestV0Schema.safeParse(
      launderingManifest("enhanced_captured"),
    );
    expect(result.success).toBe(false);
  });

  it("rejects any non-concept asset derived from concept_imagination parents", () => {
    const result = FoundryIngestManifestV0Schema.safeParse(
      manifest({
        assets: [
          asset("e57-main"),
          derived("mask-1", ["e57-main"], {
        provenanceClass: "enhanced_captured",
        evidenceKinds: ["mask"],
      }),
          derived("concept-1", ["e57-main", "mask-1"], {
            provenanceClass: "concept_imagination",
          }),
          derived("relaunder", ["concept-1", "mask-1"], {
            provenanceClass: "generated_cinematic",
          }),
        ],
        provenanceEdges: [
          edge("edge-mask", ["e57-main"], "mask-1"),
          edge("edge-concept", ["e57-main", "mask-1"], "concept-1"),
          edge("edge-relaunder", ["concept-1", "mask-1"], "relaunder"),
        ],
        generatedRegions: [
          {
            ...generatedRegion("region-1", "concept-1", ["e57-main"], "mask-1"),
            provenanceClass: "concept_imagination" as const,
          },
          {
            ...generatedRegion("region-2", "relaunder", ["concept-1"], "mask-1"),
            provenanceClass: "generated_cinematic" as const,
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("keeps legitimate truth-degrading derivations valid", () => {
    const result = FoundryIngestManifestV0Schema.safeParse(
      manifest({
        assets: [
          asset("e57-main"),
          derived("reencoded", ["e57-main"], { provenanceClass: "captured" }),
          derived("denoised", ["reencoded"], { provenanceClass: "enhanced_captured" }),
          derived("mask-1", ["e57-main"], {
        provenanceClass: "enhanced_captured",
        evidenceKinds: ["mask"],
      }),
          derived("cinematic", ["denoised", "mask-1"], {
            provenanceClass: "generated_cinematic",
          }),
        ],
        provenanceEdges: [
          edge("edge-mask", ["e57-main"], "mask-1"),
          edge("edge-reencode", ["e57-main"], "reencoded"),
          edge("edge-denoise", ["reencoded"], "denoised"),
          edge("edge-cinema", ["denoised", "mask-1"], "cinematic"),
        ],
        generatedRegions: [
          generatedRegion("region-1", "cinematic", ["denoised"], "mask-1"),
        ],
      }),
    );
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });
});

describe("Truth-hardening: rights coverage of transitively consumed stage inputs", () => {
  const restrictedManifest = manifest({
    legalReviewState: "requires_review" as const,
    assets: [
      asset("e57-main"),
      asset("restricted-img", {
        rights: { ...permittedRights(), modelTrainingUse: "prohibited" as const },
      }),
    ],
  });

  it("blocks a downstream stage's rights purposes against upstream stage inputs", () => {
    const job = jobFor(restrictedManifest, [
      stage("harvest", { inputAssetIds: ["restricted-img"] }),
      stage("train", {
        kind: "appearance",
        dependsOn: ["harvest"],
        inputAssetIds: [],
        rightsPurposes: ["model_training"],
      }),
    ]);
    const decision = validateFoundryJobRights(job, restrictedManifest);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(
        decision.blockers.some(
          (blocker) =>
            blocker.includes("restricted-img") && blocker.includes("model_training"),
        ),
      ).toBe(true);
    }
  });

  it("keeps permitted transitive flows allowed", () => {
    const job = jobFor(restrictedManifest, [
      stage("harvest", { inputAssetIds: ["e57-main"] }),
      stage("train", {
        kind: "appearance",
        dependsOn: ["harvest"],
        inputAssetIds: [],
        rightsPurposes: ["model_training"],
      }),
    ]);
    expect(validateFoundryJobRights(job, restrictedManifest)).toEqual({ allowed: true });
  });

  it("blocks every job against a manifest whose legal review state is blocked", () => {
    const blockedManifest = manifest({ legalReviewState: "blocked" as const });
    const job = jobFor(blockedManifest, [stage("inspect")]);
    const decision = validateFoundryJobRights(job, blockedManifest);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.blockers).toContain("manifest_legal_review_blocked");
    }
  });
});

describe("Truth-hardening: generated content excluded from quality evidence", () => {
  it("refuses generated-class assets as measurement evidence under a forbidden policy", () => {
    const report = qualityReport();
    const catalog = evidenceCatalog({
      assets: [
        evidenceCatalogAsset("measured-mesh", "captured", []),
        evidenceCatalogAsset("alignment-report", "concept_imagination", ["residual_report"]),
        evidenceCatalogAsset("provenance-report", "captured", ["provenance_report"]),
        evidenceCatalogAsset("fixed-view-sheet", "captured", ["fixed_view"]),
        evidenceCatalogAsset("reviewer-attestation", "captured", ["reviewer_attestation"]),
      ],
    });
    const decision = validateFoundryQualityEvidence(report, catalog);
    expect(decision.valid).toBe(false);
  });

  it("refuses generated-class review evidence under a forbidden policy", () => {
    const report = qualityReport();
    const catalog = evidenceCatalog({
      assets: [
        evidenceCatalogAsset("measured-mesh", "captured", []),
        evidenceCatalogAsset("alignment-report", "captured", ["residual_report"]),
        evidenceCatalogAsset("provenance-report", "captured", ["provenance_report"]),
        evidenceCatalogAsset("fixed-view-sheet", "generated_cinematic", ["fixed_view"]),
        evidenceCatalogAsset("reviewer-attestation", "captured", ["reviewer_attestation"]),
      ],
    });
    const decision = validateFoundryQualityEvidence(report, catalog);
    expect(decision.valid).toBe(false);
  });

  it("refuses generated-class reviewer attestations under every policy", () => {
    const report = qualityReport({
      contract: {
        ...qualityReport().contract,
        generatedContentPolicy: "allowed_with_masks" as const,
      },
    });
    const catalog = evidenceCatalog({
      assets: [
        evidenceCatalogAsset("measured-mesh", "captured", []),
        evidenceCatalogAsset("alignment-report", "captured", ["residual_report"]),
        evidenceCatalogAsset("provenance-report", "captured", ["provenance_report"]),
        evidenceCatalogAsset("fixed-view-sheet", "captured", ["fixed_view"]),
        evidenceCatalogAsset("reviewer-attestation", "generated_cinematic", [
          "reviewer_attestation",
        ]),
      ],
    });
    const decision = validateFoundryQualityEvidence(report, catalog);
    expect(decision.valid).toBe(false);
  });

  it("keeps captured-evidence reports valid under a forbidden policy", () => {
    const decision = validateFoundryQualityEvidence(qualityReport(), evidenceCatalog());
    expect(decision).toEqual({ valid: true });
  });
});

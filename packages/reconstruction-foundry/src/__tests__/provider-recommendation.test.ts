import { describe, expect, it } from "vitest";
import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FoundryJobSpecV0Schema,
  FoundryIngestManifestV0Schema,
  computeFoundryIngestManifestSha256,
  computeFoundryJobSpecSha256,
  type FoundryIngestManifestV0,
} from "@omnitwin/types";
import {
  FOUNDRY_PLAN_ONLY_REQUEST_V0,
  FoundryPlanOnlyDossierPayloadSchema,
  FoundryPlanOnlyDossierV0Schema,
  FoundryPlanOnlyRequestV0Schema,
  compileFoundryPlanOnlyDossier,
  planDossierSha256,
  planRequestSha256,
  type FoundryPlanOnlyDossierV0,
  type FoundryPlanOnlyRequestV0,
} from "../plan-only.js";
import {
  FOUNDRY_PROVIDER_RECOMMENDATION_REQUEST_V0,
  FoundryProviderRecommendationRequestV0Schema,
  FoundryProviderRecommendationV0Schema,
  compileFoundryProviderRecommendationV0,
  computeFoundryPlanCandidateBindingSha256,
} from "../provider-recommendation.js";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";

const NOW = "2026-07-14T12:00:00.000Z";
const OBSERVED = "2026-07-14T11:00:00.000Z";
const EXPIRES = "2026-07-14T13:00:00.000Z";
const IMAGE = `registry.example/foundry-worker@sha256:${"b".repeat(64)}`;
const POLICY_SHA256 = `sha256:${"c".repeat(64)}`;

interface CostBreakdownFixture {
  readonly computeUsd: number;
  readonly storageUsd: number;
  readonly egressUsd: number;
  readonly imageAndModelPullUsd: number;
  readonly retryAllowanceUsd: number;
  readonly safetyMarginUsd: number;
}

interface PlanOptions {
  readonly awsCostUsd?: number;
  readonly runpodCostUsd?: number;
  readonly runpodMaximumInputBytes?: number;
  readonly runpodRamGiB?: number;
  readonly runpodVramGiB?: number;
  readonly localOnly?: boolean;
  readonly commercialUse?: "allowed" | "prohibited";
  readonly reverseRemoteRoutes?: boolean;
  readonly runpodCostBreakdown?: CostBreakdownFixture;
}

interface PlanBundle {
  readonly request: FoundryPlanOnlyRequestV0;
  readonly dossier: FoundryPlanOnlyDossierV0;
}

function manifest(
  commercialUse: "allowed" | "prohibited" = "allowed",
): FoundryIngestManifestV0 {
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "provider-recommendation-fixture",
    createdAt: "2026-07-14T10:00:00.000Z",
    createdBy: "operator-fixture",
    sourceRoots: [{
      id: "source-root",
      kind: "local_directory",
      displayName: "Read-only source",
      locationRedacted: "FOUNDRY_STAGE/[redacted]",
      caseSensitivity: "insensitive",
      readOnly: true,
    }],
    coordinateFrames: [],
    transforms: [],
    assets: [{
      id: "source-glb",
      sourceRootId: "source-root",
      relativePath: "source.glb",
      inputType: "glb_gltf",
      mediaType: "model/gltf-binary",
      sizeBytes: 1_024,
      sha256: `sha256:${"a".repeat(64)}`,
      immutable: true,
      captureState: "raw_capture",
      accessState: "direct",
      capturedAt: null,
      coordinateFrameId: null,
      calibrationAssetIds: [],
      parentAssetIds: [],
      rights: {
        basis: "customer_owned",
        commercialUse,
        modelTrainingUse: "prohibited",
        redistribution: "prohibited",
        termsReviewedAt: "2026-07-14T10:00:00.000Z",
        termsReference: "https://rights.example/provider-recommendation-fixture",
        restrictions: [],
      },
      provenanceClass: "captured",
      evidenceKinds: [],
      inspection: {
        geometryValue: "medium",
        appearanceValue: "none",
        calibrationValue: "unknown",
        scaleValue: "unknown",
        metadataKeys: [],
        decisiveNextTest: "Run a bounded static inspection.",
      },
      notes: [],
    }],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "requires_review",
    sourceMutationPermitted: false,
  });
}

function remoteRoute(
  providerKind: "aws" | "runpod",
  costUsd: number,
  capacity: { readonly ramGiB: number; readonly vramGiB: number; readonly inputBytes: number },
  costBreakdown?: CostBreakdownFixture,
): Record<string, unknown> {
  return {
    providerKind,
    providerAdapterId: `${providerKind}-fixture-v0`,
    objectStorageProfile: `${providerKind}-quarantine-fixture`,
    capacity: {
      cpuCores: 16,
      ramGiB: capacity.ramGiB,
      gpuCount: 1,
      perGpuVramGiB: capacity.vramGiB,
      scratchGiB: 500,
      maximumInputBytes: capacity.inputBytes,
    },
    estimateSnapshot: {
      currency: "USD",
      observedAt: "2026-07-14T10:30:00.000Z",
      expiresAt: "2026-07-14T12:30:00.000Z",
      sourceReference: `${providerKind}:operator-rate-snapshot`,
      breakdown: costBreakdown ?? {
        computeUsd: costUsd,
        storageUsd: 0,
        egressUsd: 0,
        imageAndModelPullUsd: 0,
        retryAllowanceUsd: 0,
        safetyMarginUsd: 0,
      },
      budgetCapUsd: 100,
    },
  };
}

function planBundle(options: PlanOptions = {}): PlanBundle {
  const sourceManifest = manifest(options.commercialUse);
  const localRoutes = options.localOnly === true
    ? [{
        providerKind: "local_cuda",
        providerAdapterId: "local-cuda-fixture-v0",
        capacity: {
          cpuCores: 16,
          ramGiB: 64,
          gpuCount: 1,
          perGpuVramGiB: 48,
          scratchGiB: 500,
          maximumInputBytes: 10_000,
        },
      }]
    : [];
  const remoteRoutes = options.localOnly === true
    ? []
    : [
        remoteRoute("aws", options.awsCostUsd ?? 5, {
          ramGiB: 64,
          vramGiB: 48,
          inputBytes: 10_000,
        }),
        remoteRoute("runpod", options.runpodCostUsd ?? 5, {
          ramGiB: options.runpodRamGiB ?? 64,
          vramGiB: options.runpodVramGiB ?? 48,
          inputBytes: options.runpodMaximumInputBytes ?? 10_000,
        }, options.runpodCostBreakdown),
      ];
  if (options.reverseRemoteRoutes === true) remoteRoutes.reverse();
  const rawRequest = {
    schemaVersion: FOUNDRY_PLAN_ONLY_REQUEST_V0,
    id: "normalize-plan-v0",
    projectId: sourceManifest.projectId,
    ingestManifestSha256: computeFoundryIngestManifestSha256(sourceManifest),
    createdAt: NOW,
    recipe: {
      id: "normalize-glb-v0",
      displayName: "Exact GLB normalization",
      stages: [{
        id: "normalize",
        kind: "geometry",
        dependsOn: [],
        containerImage: IMAGE,
        command: ["foundry", "normalize", "source.glb"],
        inputAssetIds: ["source-glb"],
        outputNames: ["normalized.glb"],
        rightsPurposes: ["commercial_internal_use"],
        cpuCores: 8,
        ramGiB: 16,
        gpuCount: 1,
        minimumGpuVramGiB: 24,
        scratchGiB: 100,
        networkAccess: "none",
        checkpoint: "none",
        resumable: false,
      }],
    },
    localRoutes,
    remoteRoutes,
  };
  const request = FoundryPlanOnlyRequestV0Schema.parse(rawRequest);
  return {
    request,
    dossier: compileFoundryPlanOnlyDossier(request, sourceManifest),
  };
}

function evidenceWindow(sourceReference: string): Record<string, unknown> {
  return {
    observedAt: OBSERVED,
    expiresAt: EXPIRES,
    sourceReference,
  };
}

function recommendationInput(
  bundle: PlanBundle,
  priority: readonly string[] = [
    "operator_preference",
    "estimated_cost",
    "expected_duration",
    "queue_wait",
  ],
): Record<string, unknown> {
  const routeEvidence = bundle.dossier.candidates.map((candidate) => {
    const isRunpod = candidate.providerKind === "runpod";
    return {
      providerKind: candidate.providerKind,
      providerAdapterId: candidate.providerAdapterId,
      planCandidateSha256: computeFoundryPlanCandidateBindingSha256(candidate),
      expectedDuration: {
        ...evidenceWindow(`${candidate.providerKind}:duration-model`),
        expectedDurationSeconds: isRunpod ? 100 : 200,
      },
      privacy: {
        ...evidenceWindow(`${candidate.providerKind}:privacy-review`),
        requirementId: "private-customer-capture-v0",
        requirementSha256: POLICY_SHA256,
        assessment: "compatible",
      },
      queue: {
        ...evidenceWindow(`${candidate.providerKind}:queue-snapshot`),
        availability: "available",
        expectedWaitSeconds: isRunpod ? 10 : 20,
      },
      requiredSoftware: {
        ...evidenceWindow(`${candidate.providerKind}:image-probe`),
        workerImages: [{ containerImage: IMAGE, assessment: "compatible" }],
      },
      estimatedCost: {
        ...evidenceWindow(`${candidate.providerKind}:cost-snapshot`),
        currency: "USD",
        estimatedCostMicrousd: candidate.estimatedCostUsd * 1_000_000,
      },
      operatorPreferenceRank: isRunpod ? 0 : 1,
    };
  });
  return {
    schemaVersion: FOUNDRY_PROVIDER_RECOMMENDATION_REQUEST_V0,
    id: "provider-recommendation-fixture-v0",
    evaluatedAt: NOW,
    planOnlyRequestSha256: planRequestSha256(bundle.request),
    planOnlyDossierSha256: bundle.dossier.dossierSha256,
    planOnlyRequest: bundle.request,
    planOnlyDossier: bundle.dossier,
    privacyRequirement: {
      id: "private-customer-capture-v0",
      policySha256: POLICY_SHA256,
    },
    softCriterionPriority: [...priority],
    routeEvidence,
  };
}

function evidenceRecords(input: Record<string, unknown>): Array<Record<string, unknown>> {
  return input.routeEvidence as Array<Record<string, unknown>>;
}

function evidenceFor(
  input: Record<string, unknown>,
  providerKind: "aws" | "local_cuda" | "runpod",
): Record<string, unknown> {
  const evidence = evidenceRecords(input).find((item) => item.providerKind === providerKind);
  if (evidence === undefined) throw new Error(`missing ${providerKind} evidence fixture`);
  return evidence;
}

function candidateRecordFor(
  input: Record<string, unknown>,
  providerKind: "aws" | "local_cuda" | "runpod",
): Record<string, unknown> {
  const dossier = input.planOnlyDossier as Record<string, unknown>;
  const candidates = dossier.candidates as Array<Record<string, unknown>>;
  const candidate = candidates.find((item) => item.providerKind === providerKind);
  if (candidate === undefined) throw new Error(`missing ${providerKind} candidate fixture`);
  return candidate;
}

function redigestPlanDossier(input: Record<string, unknown>): FoundryPlanOnlyDossierV0 {
  const dossier = input.planOnlyDossier as Record<string, unknown>;
  const candidates = dossier.candidates as Array<Record<string, unknown>>;
  for (const candidate of candidates) {
    if (candidate.jobSpec !== null) {
      const jobSpec = FoundryJobSpecV0Schema.parse(candidate.jobSpec);
      candidate.jobSpecSha256 = computeFoundryJobSpecSha256(jobSpec);
    }
  }
  const { dossierSha256: _oldDigest, ...payloadInput } = dossier;
  const payload = FoundryPlanOnlyDossierPayloadSchema.parse(payloadInput);
  dossier.dossierSha256 = planDossierSha256(payload);
  const parsed = FoundryPlanOnlyDossierV0Schema.parse(dossier);
  input.planOnlyDossier = parsed;
  input.planOnlyDossierSha256 = parsed.dossierSha256;
  for (const candidate of parsed.candidates) {
    const evidence = evidenceRecords(input).find(
      (item) =>
        item.providerKind === candidate.providerKind &&
        item.providerAdapterId === candidate.providerAdapterId,
    );
    if (evidence !== undefined) {
      evidence.planCandidateSha256 = computeFoundryPlanCandidateBindingSha256(candidate);
    }
  }
  return parsed;
}

function redigestRecommendation(
  recommendation: ReturnType<typeof compileFoundryProviderRecommendationV0>,
): unknown {
  const { recommendationSha256: _oldDigest, ...payload } = recommendation;
  return {
    ...payload,
    recommendationSha256: `sha256:${domainSeparatedSha256(
      "VENVIEWER_FOUNDRY_PROVIDER_RECOMMENDATION_V0",
      toCanonicalJson(payload),
    )}`,
  };
}

function recommendedProvider(input: Record<string, unknown>): string | null {
  const decision = compileFoundryProviderRecommendationV0(input).decision;
  return decision.status === "recommended" ? decision.providerKind : null;
}

describe("Foundry provider recommendation V0", () => {
  it("binds every candidate and accounts for all nine factors", () => {
    const recommendation = compileFoundryProviderRecommendationV0(
      recommendationInput(planBundle()),
    );

    expect(recommendation.decision).toMatchObject({
      status: "recommended",
      providerKind: "runpod",
    });
    expect(recommendation.candidateEvaluations).toHaveLength(2);
    for (const evaluation of recommendation.candidateEvaluations) {
      expect(Object.keys(evaluation.factors).sort()).toEqual([
        "estimatedCost",
        "expectedDuration",
        "gpuVram",
        "inputSize",
        "operatorPreference",
        "privacy",
        "queue",
        "ram",
        "requiredSoftware",
      ]);
      expect(evaluation.eligibility).toBe("eligible");
    }
  });

  it("changes the recommendation for input size, RAM, and GPU VRAM capacity", () => {
    expect(recommendedProvider(recommendationInput(planBundle()))).toBe("runpod");
    expect(recommendedProvider(recommendationInput(planBundle({
      runpodMaximumInputBytes: 512,
    })))).toBe("aws");
    expect(recommendedProvider(recommendationInput(planBundle({
      runpodRamGiB: 8,
    })))).toBe("aws");
    expect(recommendedProvider(recommendationInput(planBundle({
      runpodVramGiB: 16,
    })))).toBe("aws");
    const overPreciseRam = compileFoundryProviderRecommendationV0(
      recommendationInput(planBundle({ runpodRamGiB: 64.0000001 })),
    );
    expect(overPreciseRam.decision).toMatchObject({
      status: "recommended",
      providerKind: "aws",
    });
    expect(overPreciseRam.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    )?.hardBlockers).toContain("ram_not_exact_fixed_point");

    const overPreciseVram = compileFoundryProviderRecommendationV0(
      recommendationInput(planBundle({ runpodVramGiB: 48.0000001 })),
    );
    expect(overPreciseVram.decision).toMatchObject({
      status: "recommended",
      providerKind: "aws",
    });
    expect(overPreciseVram.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    )?.hardBlockers).toContain("gpu_vram_not_exact_fixed_point");
  });

  it("changes the recommendation for expected duration and fresh queue wait", () => {
    const durationInput = recommendationInput(planBundle(), [
      "expected_duration",
      "queue_wait",
      "estimated_cost",
      "operator_preference",
    ]);
    expect(recommendedProvider(durationInput)).toBe("runpod");
    const runpodDuration = evidenceFor(durationInput, "runpod").expectedDuration as
      Record<string, unknown>;
    runpodDuration.expectedDurationSeconds = 300;
    expect(recommendedProvider(durationInput)).toBe("aws");

    const queueInput = recommendationInput(planBundle(), [
      "queue_wait",
      "expected_duration",
      "estimated_cost",
      "operator_preference",
    ]);
    expect(recommendedProvider(queueInput)).toBe("runpod");
    const runpodQueue = evidenceFor(queueInput, "runpod").queue as Record<string, unknown>;
    runpodQueue.expectedWaitSeconds = 30;
    expect(recommendedProvider(queueInput)).toBe("aws");

    const unavailableQueueInput = recommendationInput(planBundle());
    const unavailableQueue = evidenceFor(unavailableQueueInput, "runpod").queue as
      Record<string, unknown>;
    unavailableQueue.availability = "unavailable";
    unavailableQueue.expectedWaitSeconds = null;
    expect(recommendedProvider(unavailableQueueInput)).toBe("aws");
  });

  it("changes the recommendation for privacy and exact worker-image compatibility", () => {
    const privacyInput = recommendationInput(planBundle());
    const runpodPrivacy = evidenceFor(privacyInput, "runpod").privacy as
      Record<string, unknown>;
    runpodPrivacy.assessment = "incompatible";
    expect(recommendedProvider(privacyInput)).toBe("aws");

    const wrongPolicyInput = recommendationInput(planBundle());
    const wrongPolicy = evidenceFor(wrongPolicyInput, "runpod").privacy as
      Record<string, unknown>;
    wrongPolicy.requirementSha256 = `sha256:${"d".repeat(64)}`;
    expect(recommendedProvider(wrongPolicyInput)).toBe("aws");

    const softwareInput = recommendationInput(planBundle());
    const runpodSoftware = evidenceFor(softwareInput, "runpod").requiredSoftware as
      Record<string, unknown>;
    runpodSoftware.workerImages = [{
      containerImage: IMAGE,
      assessment: "incompatible",
    }];
    expect(recommendedProvider(softwareInput)).toBe("aws");

    const wrongImageInput = recommendationInput(planBundle());
    const wrongImage = evidenceFor(wrongImageInput, "runpod").requiredSoftware as
      Record<string, unknown>;
    wrongImage.workerImages = [{
      containerImage: `registry.example/other@sha256:${"e".repeat(64)}`,
      assessment: "compatible",
    }];
    const wrongImageResult = compileFoundryProviderRecommendationV0(wrongImageInput);
    expect(wrongImageResult.decision).toMatchObject({
      status: "recommended",
      providerKind: "aws",
    });
    expect(wrongImageResult.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    )?.hardBlockers).toContain("software_image_set_mismatch");
  });

  it("changes the recommendation for fixed-point cost and operator preference", () => {
    const costPriority = [
      "estimated_cost",
      "expected_duration",
      "queue_wait",
      "operator_preference",
    ] as const;
    expect(recommendedProvider(recommendationInput(planBundle({
      awsCostUsd: 6,
      runpodCostUsd: 5,
    }), costPriority))).toBe("runpod");
    expect(recommendedProvider(recommendationInput(planBundle({
      awsCostUsd: 5,
      runpodCostUsd: 6,
    }), costPriority))).toBe("aws");

    const roundedCost = compileFoundryProviderRecommendationV0(
      recommendationInput(planBundle({
        awsCostUsd: 6,
        runpodCostBreakdown: {
          computeUsd: 1.0000004,
          storageUsd: 0.5,
          egressUsd: 0.5,
          imageAndModelPullUsd: 0.5,
          retryAllowanceUsd: 0.5,
          safetyMarginUsd: 2,
        },
      }), costPriority),
    );
    const roundedRunpod = roundedCost.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    );
    expect(roundedCost.decision).toMatchObject({
      status: "recommended",
      providerKind: "runpod",
    });
    expect(roundedRunpod?.factors.estimatedCost).toMatchObject({
      planEstimatedCostMicrousd: 5_000_000,
      evidenceEstimatedCostMicrousd: 5_000_000,
      status: "matches_plan",
    });

    const fractionalMicroUsd = recommendationInput(planBundle());
    const fractionalCost = evidenceFor(fractionalMicroUsd, "runpod").estimatedCost as
      Record<string, unknown>;
    fractionalCost.estimatedCostMicrousd = 5_000_000.5;
    expect(FoundryProviderRecommendationRequestV0Schema.safeParse(fractionalMicroUsd).success)
      .toBe(false);

    const preferenceInput = recommendationInput(planBundle());
    evidenceFor(preferenceInput, "runpod").operatorPreferenceRank = 2;
    expect(recommendedProvider(preferenceInput)).toBe("aws");
  });

  it("makes missing, stale, and contradictory evidence explicitly ineligible", () => {
    const missing = recommendationInput(planBundle());
    for (const evidence of evidenceRecords(missing)) evidence.estimatedCost = null;
    const missingResult = compileFoundryProviderRecommendationV0(missing);
    expect(missingResult.decision).toEqual({
      status: "no_recommendation",
      reason: "no_eligible_candidates",
      tiedPlanCandidateSha256s: [],
    });
    expect(missingResult.candidateEvaluations.every((evaluation) =>
      evaluation.hardBlockers.includes("missing_cost_evidence")
    )).toBe(true);

    const stale = recommendationInput(planBundle());
    for (const evidence of evidenceRecords(stale)) {
      const queue = evidence.queue as Record<string, unknown>;
      queue.expiresAt = "2026-07-14T11:30:00.000Z";
    }
    const staleResult = compileFoundryProviderRecommendationV0(stale);
    expect(staleResult.decision.status).toBe("no_recommendation");
    expect(staleResult.candidateEvaluations.every((evaluation) =>
      evaluation.hardBlockers.includes("queue_evidence_not_fresh")
    )).toBe(true);

    const contradictory = recommendationInput(planBundle());
    for (const evidence of evidenceRecords(contradictory)) {
      evidence.planCandidateSha256 = `sha256:${"f".repeat(64)}`;
      const cost = evidence.estimatedCost as Record<string, unknown>;
      cost.estimatedCostMicrousd = 99_000_000;
    }
    const contradictoryResult = compileFoundryProviderRecommendationV0(contradictory);
    expect(contradictoryResult.decision.status).toBe("no_recommendation");
    expect(contradictoryResult.candidateEvaluations.every((evaluation) =>
      evaluation.hardBlockers.includes("candidate_binding_mismatch") &&
      evaluation.hardBlockers.includes("estimated_cost_conflicts_with_plan")
    )).toBe(true);
  });

  it("treats observation and exclusive-expiry boundaries exactly", () => {
    const exactObservation = recommendationInput(planBundle());
    const runpodEvidence = evidenceFor(exactObservation, "runpod");
    for (const field of [
      "expectedDuration",
      "privacy",
      "queue",
      "requiredSoftware",
      "estimatedCost",
    ] as const) {
      const snapshot = runpodEvidence[field] as Record<string, unknown>;
      snapshot.observedAt = NOW;
      snapshot.expiresAt = "2026-07-14T12:00:00.001Z";
    }
    const exactObservationResult = compileFoundryProviderRecommendationV0(exactObservation);
    const exactObservationRunpod = exactObservationResult.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    );
    expect(exactObservationRunpod?.eligibility).toBe("eligible");
    expect(exactObservationRunpod?.factors.expectedDuration.freshness).toBe("fresh");

    const futureObservation = recommendationInput(planBundle());
    const futureQueue = evidenceFor(futureObservation, "runpod").queue as
      Record<string, unknown>;
    futureQueue.observedAt = "2026-07-14T12:00:00.001Z";
    const futureResult = compileFoundryProviderRecommendationV0(futureObservation);
    const futureRunpod = futureResult.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    );
    expect(futureRunpod?.factors.queue.freshness).toBe("observed_in_future");
    expect(futureRunpod?.hardBlockers).toContain("queue_evidence_not_fresh");

    const exactExpiry = recommendationInput(planBundle());
    const expiringCost = evidenceFor(exactExpiry, "runpod").estimatedCost as
      Record<string, unknown>;
    expiringCost.expiresAt = NOW;
    const expiryResult = compileFoundryProviderRecommendationV0(exactExpiry);
    const expiredRunpod = expiryResult.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    );
    expect(expiredRunpod?.factors.estimatedCost.freshness).toBe("expired");
    expect(expiredRunpod?.hardBlockers).toContain("cost_evidence_not_fresh");
  });

  it("hard-blocks explicit unknown privacy, queue, and software states", () => {
    const unknownPrivacy = recommendationInput(planBundle());
    const privacy = evidenceFor(unknownPrivacy, "runpod").privacy as Record<string, unknown>;
    privacy.assessment = "unknown";
    expect(compileFoundryProviderRecommendationV0(unknownPrivacy).candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    )?.hardBlockers).toContain("privacy_incompatible");

    const unknownQueue = recommendationInput(planBundle());
    const queue = evidenceFor(unknownQueue, "runpod").queue as Record<string, unknown>;
    queue.availability = "unknown";
    queue.expectedWaitSeconds = null;
    expect(compileFoundryProviderRecommendationV0(unknownQueue).candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    )?.hardBlockers).toContain("queue_not_available");

    const unknownSoftware = recommendationInput(planBundle());
    const software = evidenceFor(unknownSoftware, "runpod").requiredSoftware as
      Record<string, unknown>;
    software.workerImages = [{ containerImage: IMAGE, assessment: "unknown" }];
    expect(compileFoundryProviderRecommendationV0(unknownSoftware).candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    )?.hardBlockers).toContain("software_incompatible");
  });

  it("does not manufacture missing local duration, queue, or cost evidence", () => {
    const input = recommendationInput(planBundle({ localOnly: true }));
    const local = evidenceFor(input, "local_cuda");
    local.expectedDuration = null;
    local.queue = null;
    local.estimatedCost = null;

    const recommendation = compileFoundryProviderRecommendationV0(input);
    expect(recommendation.decision.status).toBe("no_recommendation");
    expect(recommendation.candidateEvaluations[0]?.hardBlockers).toEqual(
      expect.arrayContaining([
        "missing_cost_evidence",
        "missing_duration_evidence",
        "missing_queue_evidence",
      ]),
    );
    expect(recommendation.candidateEvaluations[0]?.factors.estimatedCost).toMatchObject({
      evidenceEstimatedCostMicrousd: null,
      status: "missing",
    });
  });

  it("never lets preference override PlanOnly rights or capacity blockers", () => {
    const capacityInput = recommendationInput(planBundle({ runpodRamGiB: 8 }));
    evidenceFor(capacityInput, "runpod").operatorPreferenceRank = 0;
    evidenceFor(capacityInput, "aws").operatorPreferenceRank = 1_000_000;
    expect(recommendedProvider(capacityInput)).toBe("aws");
    const runpod = compileFoundryProviderRecommendationV0(capacityInput)
      .candidateEvaluations.find((evaluation) => evaluation.providerKind === "runpod");
    expect(runpod?.hardBlockers).toContain("plan_only_candidate_blocked");

    const rightsInput = recommendationInput(planBundle({ commercialUse: "prohibited" }));
    const rightsResult = compileFoundryProviderRecommendationV0(rightsInput);
    expect(rightsResult.decision.status).toBe("no_recommendation");
    expect(rightsResult.candidateEvaluations.every((evaluation) =>
      evaluation.planOnlyGate.rightsBlockers.length > 0 &&
      evaluation.hardBlockers.includes("plan_only_candidate_blocked")
    )).toBe(true);
  });

  it("returns no recommendation for an exact tie instead of using route order", () => {
    const tiedInput = (reverseRemoteRoutes: boolean): Record<string, unknown> => {
      const input = recommendationInput(planBundle({ reverseRemoteRoutes }));
      const aws = evidenceFor(input, "aws");
      aws.operatorPreferenceRank = 0;
      const awsDuration = aws.expectedDuration as Record<string, unknown>;
      awsDuration.expectedDurationSeconds = 100;
      const awsQueue = aws.queue as Record<string, unknown>;
      awsQueue.expectedWaitSeconds = 10;
      return input;
    };

    const recommendation = compileFoundryProviderRecommendationV0(tiedInput(false));
    expect(recommendation.decision).toMatchObject({
      status: "no_recommendation",
      reason: "exact_tie",
    });
    if (recommendation.decision.status !== "no_recommendation") {
      throw new Error("expected an exact tie");
    }
    expect(recommendation.decision.tiedPlanCandidateSha256s).toHaveLength(2);
    expect(recommendation.decision.tiedPlanCandidateSha256s).toEqual(
      [...recommendation.decision.tiedPlanCandidateSha256s].sort(),
    );

    const reversed = compileFoundryProviderRecommendationV0(tiedInput(true));
    expect(reversed.decision).toEqual(recommendation.decision);
    expect(recommendedProvider(recommendationInput(planBundle({
      reverseRemoteRoutes: true,
    })))).toBe("runpod");
  });

  it("fails closed on missing route evidence and preserves one evaluation per candidate", () => {
    const input = recommendationInput(planBundle());
    input.routeEvidence = evidenceRecords(input).filter(
      (evidence) => evidence.providerKind === "aws",
    );

    const recommendation = compileFoundryProviderRecommendationV0(input);
    expect(recommendation.decision).toMatchObject({
      status: "recommended",
      providerKind: "aws",
    });
    expect(recommendation.candidateEvaluations).toHaveLength(2);
    const missing = recommendation.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    );
    expect(missing?.hardBlockers).toContain("missing_route_evidence");
  });

  it("rejects a self-consistent re-digested candidate-cost substitution", () => {
    const costPriority = [
      "estimated_cost",
      "expected_duration",
      "queue_wait",
      "operator_preference",
    ] as const;
    const input = recommendationInput(planBundle({
      awsCostUsd: 6,
      runpodCostUsd: 5,
    }), costPriority);
    expect(recommendedProvider(structuredClone(input))).toBe("runpod");

    const awsCandidate = candidateRecordFor(input, "aws");
    awsCandidate.estimatedCostUsd = 4;
    const awsJob = awsCandidate.jobSpec as Record<string, unknown>;
    awsJob.estimatedCostUsd = 4;
    const redigestedDossier = redigestPlanDossier(input);
    const redigestedAws = redigestedDossier.candidates.find(
      (candidate) => candidate.providerKind === "aws",
    );
    if (redigestedAws === undefined) throw new Error("missing re-digested AWS candidate");
    const awsEvidence = evidenceFor(input, "aws");
    const awsCost = awsEvidence.estimatedCost as Record<string, unknown>;
    awsCost.estimatedCostMicrousd = 4_000_000;

    expect(FoundryPlanOnlyDossierV0Schema.safeParse(input.planOnlyDossier).success).toBe(true);
    expect(awsEvidence.planCandidateSha256).toBe(
      computeFoundryPlanCandidateBindingSha256(redigestedAws),
    );
    expect(FoundryProviderRecommendationRequestV0Schema.safeParse(input).success).toBe(false);
    expect(() => compileFoundryProviderRecommendationV0(input)).toThrow(
      "Foundry provider recommendation request is invalid",
    );
  });

  it("cross-checks every recomputable candidate and JobSpec route field", () => {
    const substitutions: ReadonlyArray<{
      readonly name: string;
      readonly mutate: (
        candidate: Record<string, unknown>,
        job: Record<string, unknown>,
      ) => void;
    }> = [
      {
        name: "candidate and JobSpec cost",
        mutate: (candidate, job) => {
          candidate.estimatedCostUsd = 4;
          job.estimatedCostUsd = 4;
        },
      },
      {
        name: "candidate and JobSpec budget",
        mutate: (candidate, job) => {
          candidate.budgetCapUsd = 99;
          job.budgetCapUsd = 99;
        },
      },
      {
        name: "JobSpec route",
        mutate: (_candidate, job) => {
          job.providerAdapterId = "substituted-aws-adapter-v0";
        },
      },
      {
        name: "JobSpec stages",
        mutate: (_candidate, job) => {
          const stages = job.stages as Array<Record<string, unknown>>;
          if (stages[0] === undefined) throw new Error("missing JobSpec stage fixture");
          stages[0].command = ["foundry", "normalize", "substituted.glb"];
        },
      },
      {
        name: "JobSpec request identity",
        mutate: (_candidate, job) => {
          job.id = "substituted-plan-v0";
        },
      },
      {
        name: "JobSpec output prefix",
        mutate: (_candidate, job) => {
          job.outputPrefix = "projects/substituted/plans/output";
        },
      },
      {
        name: "JobSpec object-storage profile",
        mutate: (_candidate, job) => {
          job.objectStorageProfile = "substituted-storage-profile-v0";
        },
      },
    ];

    for (const substitution of substitutions) {
      const input = recommendationInput(planBundle());
      const candidate = candidateRecordFor(input, "aws");
      const job = candidate.jobSpec as Record<string, unknown>;
      substitution.mutate(candidate, job);
      redigestPlanDossier(input);
      expect({
        name: substitution.name,
        planOnlyDossierAccepted:
          FoundryPlanOnlyDossierV0Schema.safeParse(input.planOnlyDossier).success,
        recommendationRequestAccepted:
          FoundryProviderRecommendationRequestV0Schema.safeParse(input).success,
      }).toEqual({
        name: substitution.name,
        planOnlyDossierAccepted: true,
        recommendationRequestAccepted: false,
      });
    }
  });

  it("rejects tampered PlanOnly subjects, hashes, and derived recommendations", () => {
    const input = recommendationInput(planBundle());
    const wrongHash = structuredClone(input);
    wrongHash.planOnlyDossierSha256 = `sha256:${"0".repeat(64)}`;
    expect(() => compileFoundryProviderRecommendationV0(wrongHash)).toThrow(
      "Foundry provider recommendation request is invalid",
    );

    const tamperedDossier = structuredClone(input);
    const dossier = tamperedDossier.planOnlyDossier as Record<string, unknown>;
    const candidates = dossier.candidates as Array<Record<string, unknown>>;
    if (candidates[0] === undefined) throw new Error("missing candidate fixture");
    candidates[0].estimatedCostUsd = 99;
    expect(FoundryProviderRecommendationRequestV0Schema.safeParse(tamperedDossier).success)
      .toBe(false);

    const impossibleChronology = structuredClone(input);
    impossibleChronology.evaluatedAt = "2026-07-14T11:30:00.000Z";
    expect(FoundryProviderRecommendationRequestV0Schema.safeParse(impossibleChronology).success)
      .toBe(false);

    const recommendation = compileFoundryProviderRecommendationV0(input);
    if (recommendation.decision.status !== "recommended") {
      throw new Error("expected the baseline recommendation fixture to select one route");
    }
    const awsEvaluation = recommendation.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "aws",
    );
    if (awsEvaluation === undefined) throw new Error("missing AWS evaluation fixture");
    const { recommendationSha256: _originalSha256, ...payload } = recommendation;
    const substitutedPayload = {
      ...payload,
      decision: {
        status: "recommended",
        providerKind: "aws",
        providerAdapterId: "aws-fixture-v0",
        planCandidateSha256: awsEvaluation.planCandidateSha256,
        comparisonValues: recommendation.decision.comparisonValues,
      },
    };
    const substitutedSha256 = `sha256:${domainSeparatedSha256(
      "VENVIEWER_FOUNDRY_PROVIDER_RECOMMENDATION_V0",
      toCanonicalJson(substitutedPayload),
    )}`;
    expect(FoundryProviderRecommendationV0Schema.safeParse({
      ...substitutedPayload,
      recommendationSha256: substitutedSha256,
    }).success)
      .toBe(false);
  });

  it("rejects re-digested output factor and blocker substitutions", () => {
    const recommendation = compileFoundryProviderRecommendationV0(
      recommendationInput(planBundle()),
    );

    const factorSubstitution = structuredClone(recommendation);
    const factorRunpod = factorSubstitution.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    );
    if (factorRunpod === undefined) throw new Error("missing output factor fixture");
    factorRunpod.factors.expectedDuration.expectedDurationSeconds = 1;
    expect(FoundryProviderRecommendationV0Schema.safeParse(
      redigestRecommendation(factorSubstitution),
    ).success).toBe(false);

    const blockerSubstitution = structuredClone(recommendation);
    const blockerRunpod = blockerSubstitution.candidateEvaluations.find(
      (evaluation) => evaluation.providerKind === "runpod",
    );
    if (blockerRunpod === undefined) throw new Error("missing output blocker fixture");
    blockerRunpod.hardBlockers = ["queue_not_available"];
    expect(FoundryProviderRecommendationV0Schema.safeParse(
      redigestRecommendation(blockerSubstitution),
    ).success).toBe(false);
  });

  it("is canonically deterministic and exposes no authority-bearing capability", () => {
    const input = recommendationInput(planBundle());
    const first = compileFoundryProviderRecommendationV0(input);
    const second = compileFoundryProviderRecommendationV0(structuredClone(input));

    expect(second).toEqual(first);
    expect(first.authority).toBe("none");
    expect(first.capabilities).toEqual({
      recommendationOnly: true,
      executionAuthorized: false,
      dispatchEnabled: false,
      providerInvocationPermitted: false,
      networkAccessPermitted: false,
      objectStorageMutationPermitted: false,
      spendAuthorized: false,
      signingPermitted: false,
      publicationPermitted: false,
      promotionPermitted: false,
    });
    expect(FoundryProviderRecommendationV0Schema.parse(first)).toEqual(first);
  });

  it("uses closed schemas for preference and evidence", () => {
    const input = recommendationInput(planBundle());
    evidenceFor(input, "runpod").hiddenProviderToken = "forbidden";
    expect(FoundryProviderRecommendationRequestV0Schema.safeParse(input).success).toBe(false);

    const duplicatePriority = recommendationInput(planBundle());
    duplicatePriority.softCriterionPriority = [
      "estimated_cost",
      "estimated_cost",
      "queue_wait",
      "operator_preference",
    ];
    expect(FoundryProviderRecommendationRequestV0Schema.safeParse(duplicatePriority).success)
      .toBe(false);
  });
});

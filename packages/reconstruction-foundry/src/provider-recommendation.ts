import {
  FOUNDRY_JOB_SPEC_V0,
  FoundryJobSpecV0Schema,
  FoundryProviderKindSchema,
  FoundryUtcInstantSchema,
  type FoundryJobSpecV0,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FoundryPlanOnlyDossierV0Schema,
  FoundryPlanOnlyRequestV0Schema,
  planRequestSha256,
  type FoundryPlanOnlyDossierV0,
  type FoundryPlanOnlyRequestV0,
} from "./plan-only.js";

export const FOUNDRY_PROVIDER_RECOMMENDATION_REQUEST_V0 =
  "omnitwin.foundry.provider-recommendation-request.v0";
export const FOUNDRY_PROVIDER_RECOMMENDATION_V0 =
  "omnitwin.foundry.provider-recommendation.v0";

const REQUEST_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_PROVIDER_RECOMMENDATION_REQUEST_V0";
const RECOMMENDATION_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_PROVIDER_RECOMMENDATION_V0";
const PLAN_CANDIDATE_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_PROVIDER_RECOMMENDATION_PLAN_CANDIDATE_V0";
const SHA256_PREFIXED = /^sha256:[a-f0-9]{64}$/u;
const ROUTE_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const FIXED_POINT_DECIMAL_PLACES = 6;
const MAX_EVIDENCE_SECONDS = 31_536_000;

const SOFT_CRITERIA = [
  "estimated_cost",
  "expected_duration",
  "queue_wait",
  "operator_preference",
] as const;

const HARD_BLOCKERS = [
  "candidate_binding_mismatch",
  "cost_evidence_not_fresh",
  "duration_evidence_not_fresh",
  "estimated_cost_conflicts_with_plan",
  "gpu_vram_exceeds_capacity",
  "gpu_vram_not_exact_fixed_point",
  "input_size_exceeds_capacity",
  "missing_cost_evidence",
  "missing_duration_evidence",
  "missing_privacy_evidence",
  "missing_queue_evidence",
  "missing_route_evidence",
  "missing_software_evidence",
  "plan_cost_not_exact_fixed_point",
  "plan_only_candidate_blocked",
  "privacy_evidence_not_fresh",
  "privacy_incompatible",
  "privacy_policy_binding_mismatch",
  "queue_evidence_not_fresh",
  "queue_not_available",
  "ram_exceeds_capacity",
  "ram_not_exact_fixed_point",
  "software_evidence_not_fresh",
  "software_image_set_mismatch",
  "software_incompatible",
] as const;

const HardBlockerSchema = z.enum(HARD_BLOCKERS);
type HardBlocker = z.infer<typeof HardBlockerSchema>;

const evidenceWindowShape = {
  observedAt: FoundryUtcInstantSchema,
  expiresAt: FoundryUtcInstantSchema,
  sourceReference: z.string().trim().min(1).max(500),
} as const;

function validateEvidenceWindow(
  window: { readonly observedAt: string; readonly expiresAt: string },
  ctx: z.RefinementCtx,
): void {
  if (Date.parse(window.observedAt) >= Date.parse(window.expiresAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "evidence must expire after it was observed",
    });
  }
}

const ExpectedDurationEvidenceSchema = z
  .object({
    ...evidenceWindowShape,
    expectedDurationSeconds: z
      .number()
      .int()
      .positive()
      .max(MAX_EVIDENCE_SECONDS),
  })
  .strict()
  .superRefine(validateEvidenceWindow);

const PrivacyEvidenceSchema = z
  .object({
    ...evidenceWindowShape,
    requirementId: z.string().regex(ROUTE_ID),
    requirementSha256: z.string().regex(SHA256_PREFIXED),
    assessment: z.enum(["compatible", "incompatible", "unknown"]),
  })
  .strict()
  .superRefine(validateEvidenceWindow);

const QueueEvidenceSchema = z
  .object({
    ...evidenceWindowShape,
    availability: z.enum(["available", "unavailable", "unknown"]),
    expectedWaitSeconds: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_EVIDENCE_SECONDS)
      .nullable(),
  })
  .strict()
  .superRefine((queue, ctx) => {
    validateEvidenceWindow(queue, ctx);
    if (queue.availability === "available" !== (queue.expectedWaitSeconds !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedWaitSeconds"],
        message: "only an available queue may carry an expected wait",
      });
    }
  });

const WorkerImageAssessmentSchema = z
  .object({
    containerImage: z.string().trim().min(1).max(500),
    assessment: z.enum(["compatible", "incompatible", "unknown"]),
  })
  .strict();

const SoftwareEvidenceSchema = z
  .object({
    ...evidenceWindowShape,
    workerImages: z.array(WorkerImageAssessmentSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((software, ctx) => {
    validateEvidenceWindow(software, ctx);
    const images = software.workerImages.map((image) => image.containerImage);
    const sorted = [...images].sort();
    if (
      new Set(images).size !== images.length ||
      images.some((image, index) => image !== sorted[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workerImages"],
        message: "worker image assessments must be unique and sorted",
      });
    }
  });

const CostEvidenceSchema = z
  .object({
    ...evidenceWindowShape,
    currency: z.literal("USD"),
    estimatedCostMicrousd: z.number().int().safe().nonnegative(),
  })
  .strict()
  .superRefine(validateEvidenceWindow);

export const FoundryProviderRouteEvidenceV0Schema = z
  .object({
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: z.string().regex(ROUTE_ID),
    planCandidateSha256: z.string().regex(SHA256_PREFIXED),
    expectedDuration: ExpectedDurationEvidenceSchema.nullable(),
    privacy: PrivacyEvidenceSchema.nullable(),
    queue: QueueEvidenceSchema.nullable(),
    requiredSoftware: SoftwareEvidenceSchema.nullable(),
    estimatedCost: CostEvidenceSchema.nullable(),
    operatorPreferenceRank: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();
export type FoundryProviderRouteEvidenceV0 = z.infer<
  typeof FoundryProviderRouteEvidenceV0Schema
>;

const PrivacyRequirementSchema = z
  .object({
    id: z.string().regex(ROUTE_ID),
    policySha256: z.string().regex(SHA256_PREFIXED),
  })
  .strict();

const RecommendationRequestObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PROVIDER_RECOMMENDATION_REQUEST_V0),
    id: z.string().regex(ROUTE_ID),
    evaluatedAt: FoundryUtcInstantSchema,
    planOnlyRequestSha256: z.string().regex(SHA256_PREFIXED),
    planOnlyDossierSha256: z.string().regex(SHA256_PREFIXED),
    planOnlyRequest: FoundryPlanOnlyRequestV0Schema,
    planOnlyDossier: FoundryPlanOnlyDossierV0Schema,
    privacyRequirement: PrivacyRequirementSchema,
    softCriterionPriority: z.array(z.enum(SOFT_CRITERIA)).length(SOFT_CRITERIA.length),
    routeEvidence: z.array(FoundryProviderRouteEvidenceV0Schema).max(22),
  })
  .strict();

function routeKey(route: {
  readonly providerKind: string;
  readonly providerAdapterId: string;
}): string {
  return `${route.providerKind}:${route.providerAdapterId}`;
}

function validateCriterionPriority(
  request: z.infer<typeof RecommendationRequestObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const priority = request.softCriterionPriority;
  if (
    new Set(priority).size !== SOFT_CRITERIA.length ||
    SOFT_CRITERIA.some((criterion) => !priority.includes(criterion))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["softCriterionPriority"],
      message: "soft criterion priority must be an exact permutation",
    });
  }
}

function validatePlanBindings(
  request: z.infer<typeof RecommendationRequestObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  if (Date.parse(request.evaluatedAt) < Date.parse(request.planOnlyRequest.createdAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evaluatedAt"],
      message: "recommendation cannot predate its PlanOnly request",
    });
  }
  if (request.planOnlyRequestSha256 !== planRequestSha256(request.planOnlyRequest)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["planOnlyRequestSha256"],
      message: "recommendation request must bind the exact PlanOnly request",
    });
  }
  if (request.planOnlyDossierSha256 !== request.planOnlyDossier.dossierSha256) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["planOnlyDossierSha256"],
      message: "recommendation request must bind the exact PlanOnly dossier",
    });
  }
  if (
    request.planOnlyDossier.requestSha256 !== request.planOnlyRequestSha256 ||
    canonicalString(request.planOnlyDossier.request) !== canonicalString(request.planOnlyRequest)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["planOnlyDossier"],
      message: "PlanOnly request and dossier subjects must be identical",
    });
  }
  validateRequestDerivedCandidateBindings(request, ctx);
}

function validateRouteBindings(
  request: z.infer<typeof RecommendationRequestObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const requestRoutes = [
    ...request.planOnlyRequest.localRoutes,
    ...request.planOnlyRequest.remoteRoutes,
  ].map(routeKey).sort();
  const candidateRoutes = request.planOnlyDossier.candidates.map(routeKey);
  if (canonicalString(requestRoutes) !== canonicalString(candidateRoutes)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["planOnlyDossier", "candidates"],
      message: "PlanOnly routes and candidates must have an exact one-to-one binding",
    });
  }
  const evidenceRoutes = request.routeEvidence.map(routeKey);
  const sortedEvidenceRoutes = [...evidenceRoutes].sort();
  if (
    new Set(evidenceRoutes).size !== evidenceRoutes.length ||
    evidenceRoutes.some((route, index) => route !== sortedEvidenceRoutes[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["routeEvidence"],
      message: "route evidence must be unique and sorted",
    });
  }
  if (evidenceRoutes.some((route) => !candidateRoutes.includes(route))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["routeEvidence"],
      message: "route evidence cannot name a route absent from the PlanOnly dossier",
    });
  }
}

export const FoundryProviderRecommendationRequestV0Schema =
  RecommendationRequestObjectSchema.superRefine((request, ctx) => {
    validateCriterionPriority(request, ctx);
    validatePlanBindings(request, ctx);
    validateRouteBindings(request, ctx);
  });
export type FoundryProviderRecommendationRequestV0 = z.infer<
  typeof FoundryProviderRecommendationRequestV0Schema
>;

type PlanCandidate = FoundryPlanOnlyDossierV0["candidates"][number];
type PlanRoute =
  | FoundryPlanOnlyRequestV0["localRoutes"][number]
  | FoundryPlanOnlyRequestV0["remoteRoutes"][number];
type RemotePlanRoute = FoundryPlanOnlyRequestV0["remoteRoutes"][number];

interface ExpectedRouteContract {
  readonly estimatedCostUsd: number;
  readonly budgetCapUsd: number;
  readonly objectStorageProfile: string | null;
  readonly jobSpec: FoundryJobSpecV0 | null;
}

const FreshnessSchema = z.enum([
  "missing",
  "fresh",
  "observed_in_future",
  "expired",
]);

const CapacityFactorSchema = z
  .object({
    requiredMicroGiB: z.number().int().safe().nonnegative().nullable(),
    availableMicroGiB: z.number().int().safe().nonnegative().nullable(),
    status: z.enum(["within_capacity", "exceeds_capacity", "not_exact_fixed_point"]),
  })
  .strict();

const CandidateEvaluationSchema = z
  .object({
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: z.string().regex(ROUTE_ID),
    planCandidateSha256: z.string().regex(SHA256_PREFIXED),
    eligibility: z.enum(["eligible", "ineligible"]),
    hardBlockers: z.array(HardBlockerSchema).max(HARD_BLOCKERS.length),
    planOnlyGate: z
      .object({
        status: z.enum(["viable_plan_only", "blocked_plan_only"]),
        blockers: z.array(z.string().trim().min(1).max(500)).max(10_000),
        rightsBlockers: z.array(z.string().trim().min(1).max(500)).max(10_000),
      })
      .strict(),
    factors: z
      .object({
        inputSize: z
          .object({
            requiredBytes: z.number().int().safe().nonnegative(),
            maximumBytes: z.number().int().safe().nonnegative(),
            status: z.enum(["within_capacity", "exceeds_capacity"]),
          })
          .strict(),
        ram: CapacityFactorSchema,
        gpuVram: CapacityFactorSchema,
        expectedDuration: z
          .object({
            expectedDurationSeconds: z.number().int().positive().nullable(),
            freshness: FreshnessSchema,
          })
          .strict(),
        privacy: z
          .object({
            requirementId: z.string().regex(ROUTE_ID),
            requirementSha256: z.string().regex(SHA256_PREFIXED),
            assessment: z.enum(["compatible", "incompatible", "unknown"]).nullable(),
            freshness: FreshnessSchema,
          })
          .strict(),
        queue: z
          .object({
            availability: z.enum(["available", "unavailable", "unknown"]).nullable(),
            expectedWaitSeconds: z.number().int().nonnegative().nullable(),
            freshness: FreshnessSchema,
          })
          .strict(),
        requiredSoftware: z
          .object({
            requiredWorkerImages: z.array(z.string().trim().min(1).max(500)).min(1).max(1_000),
            assessedWorkerImages: z.array(WorkerImageAssessmentSchema).max(1_000),
            freshness: FreshnessSchema,
          })
          .strict(),
        estimatedCost: z
          .object({
            currency: z.literal("USD"),
            planEstimatedCostMicrousd: z.number().int().safe().nonnegative().nullable(),
            evidenceEstimatedCostMicrousd: z.number().int().safe().nonnegative().nullable(),
            freshness: FreshnessSchema,
            status: z.enum([
              "matches_plan",
              "missing",
              "conflicts_with_plan",
              "plan_not_exact_fixed_point",
            ]),
          })
          .strict(),
        operatorPreference: z
          .object({
            rank: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type FoundryProviderCandidateEvaluationV0 = z.infer<
  typeof CandidateEvaluationSchema
>;

const ComparisonValueSchema = z
  .object({
    criterion: z.enum(SOFT_CRITERIA),
    value: z.number().int().safe().nonnegative(),
  })
  .strict();

const RecommendationDecisionSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("recommended"),
      providerKind: FoundryProviderKindSchema,
      providerAdapterId: z.string().regex(ROUTE_ID),
      planCandidateSha256: z.string().regex(SHA256_PREFIXED),
      comparisonValues: z.array(ComparisonValueSchema).length(SOFT_CRITERIA.length),
    })
    .strict(),
  z
    .object({
      status: z.literal("no_recommendation"),
      reason: z.enum(["no_eligible_candidates", "exact_tie"]),
      tiedPlanCandidateSha256s: z.array(z.string().regex(SHA256_PREFIXED)).max(22),
    })
    .strict(),
]);

const CapabilitiesSchema = z
  .object({
    recommendationOnly: z.literal(true),
    executionAuthorized: z.literal(false),
    dispatchEnabled: z.literal(false),
    providerInvocationPermitted: z.literal(false),
    networkAccessPermitted: z.literal(false),
    objectStorageMutationPermitted: z.literal(false),
    spendAuthorized: z.literal(false),
    signingPermitted: z.literal(false),
    publicationPermitted: z.literal(false),
    promotionPermitted: z.literal(false),
  })
  .strict();

const RecommendationPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PROVIDER_RECOMMENDATION_V0),
    recommendationRequestSha256: z.string().regex(SHA256_PREFIXED),
    request: FoundryProviderRecommendationRequestV0Schema,
    planOnlyRequestSha256: z.string().regex(SHA256_PREFIXED),
    planOnlyDossierSha256: z.string().regex(SHA256_PREFIXED),
    candidateEvaluations: z.array(CandidateEvaluationSchema).min(1).max(22),
    decision: RecommendationDecisionSchema,
    authority: z.literal("none"),
    capabilities: CapabilitiesSchema,
  })
  .strict();

type RecommendationPayload = z.infer<typeof RecommendationPayloadObjectSchema>;
type SnapshotWindow = {
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly sourceReference: string;
};
type Freshness = z.infer<typeof FreshnessSchema>;

function canonicalString(value: unknown): string {
  return stableCanonicalJson(toCanonicalJson(value));
}

function prefixedDomainDigest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

export function computeFoundryPlanCandidateBindingSha256(candidate: PlanCandidate): string {
  return prefixedDomainDigest(PLAN_CANDIDATE_DIGEST_DOMAIN, candidate);
}

export function computeFoundryProviderRecommendationRequestSha256(
  request: FoundryProviderRecommendationRequestV0,
): string {
  const parsed = FoundryProviderRecommendationRequestV0Schema.parse(request);
  return prefixedDomainDigest(REQUEST_DIGEST_DOMAIN, parsed);
}

function evidenceFreshness(
  snapshot: SnapshotWindow | null,
  evaluatedAt: string,
): Freshness {
  if (snapshot === null) return "missing";
  const evaluationTime = Date.parse(evaluatedAt);
  if (Date.parse(snapshot.observedAt) > evaluationTime) return "observed_in_future";
  if (Date.parse(snapshot.expiresAt) <= evaluationTime) return "expired";
  return "fresh";
}

function exactScaledInteger(value: number): number | null {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(String(value));
  if (match === null) return null;
  const integerDigits = match[1] ?? "0";
  const fractionalDigits = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  const digits = BigInt(`${integerDigits}${fractionalDigits}`);
  const power = exponent - fractionalDigits.length + FIXED_POINT_DECIMAL_PLACES;
  let scaled: bigint;
  if (power >= 0) {
    scaled = digits * (10n ** BigInt(power));
  } else {
    const divisor = 10n ** BigInt(-power);
    if (digits % divisor !== 0n) return null;
    scaled = digits / divisor;
  }
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(scaled);
}

function maximumFixedPoint(values: readonly number[]): number | null {
  let maximum = 0;
  for (const value of values) {
    const scaled = exactScaledInteger(value);
    if (scaled === null) return null;
    if (scaled > maximum) maximum = scaled;
  }
  return maximum;
}

function isRemotePlanRoute(route: PlanRoute): route is RemotePlanRoute {
  return "estimateSnapshot" in route;
}

function roundedUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function requestDerivedRouteCostUsd(route: PlanRoute): number {
  if (!isRemotePlanRoute(route)) return 0;
  const breakdown = route.estimateSnapshot.breakdown;
  return roundedUsd(
    breakdown.computeUsd +
      breakdown.storageUsd +
      breakdown.egressUsd +
      breakdown.imageAndModelPullUsd +
      breakdown.retryAllowanceUsd +
      breakdown.safetyMarginUsd,
  );
}

function expectedRouteContract(
  request: FoundryPlanOnlyRequestV0,
  route: PlanRoute,
): ExpectedRouteContract {
  const estimatedCostUsd = requestDerivedRouteCostUsd(route);
  const budgetCapUsd = isRemotePlanRoute(route)
    ? route.estimateSnapshot.budgetCapUsd
    : 0;
  const objectStorageProfile = isRemotePlanRoute(route)
    ? route.objectStorageProfile
    : null;
  const jobResult = FoundryJobSpecV0Schema.safeParse({
    schemaVersion: FOUNDRY_JOB_SPEC_V0,
    id: request.id,
    projectId: request.projectId,
    ingestManifestSha256: request.ingestManifestSha256,
    executionIntent: "plan_only",
    providerKind: route.providerKind,
    providerAdapterId: route.providerAdapterId,
    stages: request.recipe.stages,
    objectStorageProfile,
    sourceMountMode: "read_only",
    outputPrefix:
      `projects/${request.projectId}/plans/${request.id}/${route.providerKind}-${route.providerAdapterId}`,
    estimatedCostUsd,
    budgetCapUsd,
    killSwitchEnabled: true,
    computeApprovalId: null,
    createdAt: request.createdAt,
  });
  return {
    estimatedCostUsd,
    budgetCapUsd,
    objectStorageProfile,
    jobSpec: jobResult.success ? jobResult.data : null,
  };
}

function validateRequestDerivedCandidateBindings(
  recommendationRequest: z.infer<typeof RecommendationRequestObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const request = recommendationRequest.planOnlyRequest;
  const routeById = new Map(
    [...request.localRoutes, ...request.remoteRoutes].map((route) => [routeKey(route), route] as const),
  );
  for (const [index, candidate] of recommendationRequest.planOnlyDossier.candidates.entries()) {
    const route = routeById.get(routeKey(candidate));
    if (route === undefined) continue;
    const expected = expectedRouteContract(request, route);
    if (candidate.estimatedCostUsd !== expected.estimatedCostUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["planOnlyDossier", "candidates", index, "estimatedCostUsd"],
        message: "candidate cost must equal the request-derived route cost",
      });
    }
    if (candidate.budgetCapUsd !== expected.budgetCapUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["planOnlyDossier", "candidates", index, "budgetCapUsd"],
        message: "candidate budget must equal the request-derived route budget",
      });
    }
    if (canonicalString(candidate.jobSpec) !== canonicalString(expected.jobSpec)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["planOnlyDossier", "candidates", index, "jobSpec"],
        message:
          "candidate JobSpec must exactly match the request-derived route, economics, stages, identity, output, and storage contract",
      });
    }
  }
}

function capacityFactor(
  requiredValues: readonly number[],
  availableValue: number,
): z.infer<typeof CapacityFactorSchema> {
  const requiredMicroGiB = maximumFixedPoint(requiredValues);
  const availableMicroGiB = exactScaledInteger(availableValue);
  if (requiredMicroGiB === null || availableMicroGiB === null) {
    return {
      requiredMicroGiB,
      availableMicroGiB,
      status: "not_exact_fixed_point",
    };
  }
  return {
    requiredMicroGiB,
    availableMicroGiB,
    status: requiredMicroGiB <= availableMicroGiB
      ? "within_capacity"
      : "exceeds_capacity",
  };
}

function routeForCandidate(
  request: FoundryPlanOnlyRequestV0,
  candidate: PlanCandidate,
): PlanRoute {
  const route = [...request.localRoutes, ...request.remoteRoutes].find(
    (item) => routeKey(item) === routeKey(candidate),
  );
  if (route === undefined) {
    throw new FoundryIntegrityError(
      "PROVIDER_RECOMMENDATION_ROUTE_BINDING_MISSING",
      "A PlanOnly candidate has no exact route binding.",
    );
  }
  return route;
}

function evidenceForCandidate(
  request: FoundryProviderRecommendationRequestV0,
  candidate: PlanCandidate,
): FoundryProviderRouteEvidenceV0 | null {
  return request.routeEvidence.find((evidence) => routeKey(evidence) === routeKey(candidate)) ?? null;
}

function fixedPointBlockers(
  ram: z.infer<typeof CapacityFactorSchema>,
  gpuVram: z.infer<typeof CapacityFactorSchema>,
): HardBlocker[] {
  const blockers: HardBlocker[] = [];
  if (ram.status === "not_exact_fixed_point") blockers.push("ram_not_exact_fixed_point");
  if (ram.status === "exceeds_capacity") blockers.push("ram_exceeds_capacity");
  if (gpuVram.status === "not_exact_fixed_point") {
    blockers.push("gpu_vram_not_exact_fixed_point");
  }
  if (gpuVram.status === "exceeds_capacity") blockers.push("gpu_vram_exceeds_capacity");
  return blockers;
}

function freshnessBlockers(
  evidence: FoundryProviderRouteEvidenceV0 | null,
  evaluatedAt: string,
): HardBlocker[] {
  const blockers: HardBlocker[] = [];
  const checks = [
    [evidence?.expectedDuration ?? null, "missing_duration_evidence", "duration_evidence_not_fresh"],
    [evidence?.privacy ?? null, "missing_privacy_evidence", "privacy_evidence_not_fresh"],
    [evidence?.queue ?? null, "missing_queue_evidence", "queue_evidence_not_fresh"],
    [evidence?.requiredSoftware ?? null, "missing_software_evidence", "software_evidence_not_fresh"],
    [evidence?.estimatedCost ?? null, "missing_cost_evidence", "cost_evidence_not_fresh"],
  ] as const;
  for (const [snapshot, missing, stale] of checks) {
    const freshness = evidenceFreshness(snapshot, evaluatedAt);
    if (freshness === "missing") blockers.push(missing);
    if (freshness === "expired" || freshness === "observed_in_future") blockers.push(stale);
  }
  return blockers;
}

function substantiveEvidenceBlockers(
  request: FoundryProviderRecommendationRequestV0,
  candidate: PlanCandidate,
  evidence: FoundryProviderRouteEvidenceV0 | null,
  requiredImages: readonly string[],
  planCostMicrousd: number | null,
): HardBlocker[] {
  if (evidence === null) return ["missing_route_evidence"];
  const blockers: HardBlocker[] = [];
  if (evidence.planCandidateSha256 !== computeFoundryPlanCandidateBindingSha256(candidate)) {
    blockers.push("candidate_binding_mismatch");
  }
  if (
    evidence.privacy !== null &&
    (
      evidence.privacy.requirementId !== request.privacyRequirement.id ||
      evidence.privacy.requirementSha256 !== request.privacyRequirement.policySha256
    )
  ) blockers.push("privacy_policy_binding_mismatch");
  if (evidence.privacy !== null && evidence.privacy.assessment !== "compatible") {
    blockers.push("privacy_incompatible");
  }
  if (evidence.queue !== null && evidence.queue.availability !== "available") {
    blockers.push("queue_not_available");
  }
  const assessedImages = evidence.requiredSoftware?.workerImages.map(
    (assessment) => assessment.containerImage,
  ) ?? [];
  if (canonicalString(assessedImages) !== canonicalString(requiredImages)) {
    blockers.push("software_image_set_mismatch");
  }
  if (
    evidence.requiredSoftware !== null &&
    evidence.requiredSoftware.workerImages.some(
      (assessment) => assessment.assessment !== "compatible",
    )
  ) blockers.push("software_incompatible");
  if (planCostMicrousd === null) blockers.push("plan_cost_not_exact_fixed_point");
  if (
    evidence.estimatedCost !== null &&
    planCostMicrousd !== null &&
    evidence.estimatedCost.estimatedCostMicrousd !== planCostMicrousd
  ) blockers.push("estimated_cost_conflicts_with_plan");
  return blockers;
}

function candidateHardBlockers(
  request: FoundryProviderRecommendationRequestV0,
  candidate: PlanCandidate,
  evidence: FoundryProviderRouteEvidenceV0 | null,
  ram: z.infer<typeof CapacityFactorSchema>,
  gpuVram: z.infer<typeof CapacityFactorSchema>,
  requiredImages: readonly string[],
  planCostMicrousd: number | null,
  maximumInputBytes: number,
): HardBlocker[] {
  const blockers = new Set<HardBlocker>();
  if (candidate.status !== "viable_plan_only") blockers.add("plan_only_candidate_blocked");
  if (candidate.inputBytes > maximumInputBytes) blockers.add("input_size_exceeds_capacity");
  for (const blocker of fixedPointBlockers(ram, gpuVram)) blockers.add(blocker);
  for (const blocker of freshnessBlockers(evidence, request.evaluatedAt)) blockers.add(blocker);
  for (const blocker of substantiveEvidenceBlockers(
    request,
    candidate,
    evidence,
    requiredImages,
    planCostMicrousd,
  )) blockers.add(blocker);
  return [...blockers].sort();
}

function costStatus(
  evidence: FoundryProviderRouteEvidenceV0 | null,
  planCostMicrousd: number | null,
): "matches_plan" | "missing" | "conflicts_with_plan" | "plan_not_exact_fixed_point" {
  if (planCostMicrousd === null) return "plan_not_exact_fixed_point";
  if (evidence?.estimatedCost === null || evidence === null) return "missing";
  return evidence.estimatedCost.estimatedCostMicrousd === planCostMicrousd
    ? "matches_plan"
    : "conflicts_with_plan";
}

function evaluateCandidate(
  request: FoundryProviderRecommendationRequestV0,
  candidate: PlanCandidate,
): FoundryProviderCandidateEvaluationV0 {
  const route = routeForCandidate(request.planOnlyRequest, candidate);
  const routeContract = expectedRouteContract(request.planOnlyRequest, route);
  const evidence = evidenceForCandidate(request, candidate);
  const stages = request.planOnlyRequest.recipe.stages;
  const requiredImages = [...new Set(stages.map((stage) => stage.containerImage))].sort();
  const ram = capacityFactor(stages.map((stage) => stage.ramGiB), route.capacity.ramGiB);
  const gpuVram = capacityFactor(
    stages.map((stage) => stage.minimumGpuVramGiB),
    route.capacity.perGpuVramGiB,
  );
  const planCostMicrousd = exactScaledInteger(routeContract.estimatedCostUsd);
  const hardBlockers = candidateHardBlockers(
    request,
    candidate,
    evidence,
    ram,
    gpuVram,
    requiredImages,
    planCostMicrousd,
    route.capacity.maximumInputBytes,
  );
  return CandidateEvaluationSchema.parse({
    providerKind: candidate.providerKind,
    providerAdapterId: candidate.providerAdapterId,
    planCandidateSha256: computeFoundryPlanCandidateBindingSha256(candidate),
    eligibility: hardBlockers.length === 0 ? "eligible" : "ineligible",
    hardBlockers,
    planOnlyGate: {
      status: candidate.status,
      blockers: candidate.blockers,
      rightsBlockers: candidate.blockers.filter((blocker) => blocker.startsWith("rights:")),
    },
    factors: {
      inputSize: {
        requiredBytes: candidate.inputBytes,
        maximumBytes: route.capacity.maximumInputBytes,
        status: candidate.inputBytes <= route.capacity.maximumInputBytes
          ? "within_capacity"
          : "exceeds_capacity",
      },
      ram,
      gpuVram,
      expectedDuration: {
        expectedDurationSeconds: evidence?.expectedDuration?.expectedDurationSeconds ?? null,
        freshness: evidenceFreshness(evidence?.expectedDuration ?? null, request.evaluatedAt),
      },
      privacy: {
        requirementId: request.privacyRequirement.id,
        requirementSha256: request.privacyRequirement.policySha256,
        assessment: evidence?.privacy?.assessment ?? null,
        freshness: evidenceFreshness(evidence?.privacy ?? null, request.evaluatedAt),
      },
      queue: {
        availability: evidence?.queue?.availability ?? null,
        expectedWaitSeconds: evidence?.queue?.expectedWaitSeconds ?? null,
        freshness: evidenceFreshness(evidence?.queue ?? null, request.evaluatedAt),
      },
      requiredSoftware: {
        requiredWorkerImages: requiredImages,
        assessedWorkerImages: evidence?.requiredSoftware?.workerImages ?? [],
        freshness: evidenceFreshness(evidence?.requiredSoftware ?? null, request.evaluatedAt),
      },
      estimatedCost: {
        currency: "USD",
        planEstimatedCostMicrousd: planCostMicrousd,
        evidenceEstimatedCostMicrousd:
          evidence?.estimatedCost?.estimatedCostMicrousd ?? null,
        freshness: evidenceFreshness(evidence?.estimatedCost ?? null, request.evaluatedAt),
        status: costStatus(evidence, planCostMicrousd),
      },
      operatorPreference: { rank: evidence?.operatorPreferenceRank ?? null },
    },
  });
}

function comparisonValues(
  request: FoundryProviderRecommendationRequestV0,
  evaluation: FoundryProviderCandidateEvaluationV0,
): z.infer<typeof ComparisonValueSchema>[] {
  const factors = evaluation.factors;
  const values: Record<(typeof SOFT_CRITERIA)[number], number | null> = {
    estimated_cost: factors.estimatedCost.evidenceEstimatedCostMicrousd,
    expected_duration: factors.expectedDuration.expectedDurationSeconds,
    queue_wait: factors.queue.expectedWaitSeconds,
    operator_preference: factors.operatorPreference.rank,
  };
  return request.softCriterionPriority.map((criterion) => {
    const value = values[criterion];
    if (value === null) {
      throw new FoundryIntegrityError(
        "PROVIDER_RECOMMENDATION_ELIGIBLE_FACTOR_MISSING",
        "An eligible recommendation candidate is missing a comparison factor.",
      );
    }
    return { criterion, value };
  });
}

function compareValues(
  left: readonly z.infer<typeof ComparisonValueSchema>[],
  right: readonly z.infer<typeof ComparisonValueSchema>[],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]?.value;
    const rightValue = right[index]?.value;
    if (leftValue === undefined || rightValue === undefined) continue;
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return 0;
}

function recommendationDecision(
  request: FoundryProviderRecommendationRequestV0,
  evaluations: readonly FoundryProviderCandidateEvaluationV0[],
): z.infer<typeof RecommendationDecisionSchema> {
  const eligible = evaluations
    .filter((evaluation) => evaluation.eligibility === "eligible")
    .map((evaluation) => ({
      evaluation,
      values: comparisonValues(request, evaluation),
    }));
  if (eligible.length === 0) {
    return {
      status: "no_recommendation",
      reason: "no_eligible_candidates",
      tiedPlanCandidateSha256s: [],
    };
  }
  let best = eligible[0];
  if (best === undefined) throw new Error("eligible candidate unexpectedly absent");
  for (const contender of eligible.slice(1)) {
    if (compareValues(contender.values, best.values) < 0) best = contender;
  }
  const ties = eligible.filter((contender) => compareValues(contender.values, best.values) === 0);
  if (ties.length > 1) {
    return {
      status: "no_recommendation",
      reason: "exact_tie",
      tiedPlanCandidateSha256s: ties
        .map((tie) => tie.evaluation.planCandidateSha256)
        .sort(),
    };
  }
  return {
    status: "recommended",
    providerKind: best.evaluation.providerKind,
    providerAdapterId: best.evaluation.providerAdapterId,
    planCandidateSha256: best.evaluation.planCandidateSha256,
    comparisonValues: best.values,
  };
}

function deriveRecommendation(
  request: FoundryProviderRecommendationRequestV0,
): Pick<RecommendationPayload, "candidateEvaluations" | "decision"> {
  const candidateEvaluations = request.planOnlyDossier.candidates.map(
    (candidate) => evaluateCandidate(request, candidate),
  );
  return {
    candidateEvaluations,
    decision: recommendationDecision(request, candidateEvaluations),
  };
}

function validateDerivedRecommendation(
  payload: RecommendationPayload,
  ctx: z.RefinementCtx,
): void {
  if (
    payload.recommendationRequestSha256 !==
      computeFoundryProviderRecommendationRequestSha256(payload.request)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recommendationRequestSha256"],
      message: "recommendation must bind its exact request",
    });
  }
  if (
    payload.planOnlyRequestSha256 !== payload.request.planOnlyRequestSha256 ||
    payload.planOnlyDossierSha256 !== payload.request.planOnlyDossierSha256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["planOnlyDossierSha256"],
      message: "recommendation must preserve both PlanOnly subject digests",
    });
  }
  const expected = deriveRecommendation(payload.request);
  const actual = {
    candidateEvaluations: payload.candidateEvaluations,
    decision: payload.decision,
  };
  if (canonicalString(expected) !== canonicalString(actual)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["candidateEvaluations"],
      message: "recommendation evaluation and decision must be deterministically derived",
    });
  }
}

export const FoundryProviderRecommendationPayloadV0Schema =
  RecommendationPayloadObjectSchema.superRefine(validateDerivedRecommendation);
export type FoundryProviderRecommendationPayloadV0 = z.infer<
  typeof FoundryProviderRecommendationPayloadV0Schema
>;

export function computeFoundryProviderRecommendationSha256(
  recommendation: FoundryProviderRecommendationPayloadV0,
): string {
  const parsed = FoundryProviderRecommendationPayloadV0Schema.parse(recommendation);
  return prefixedDomainDigest(RECOMMENDATION_DIGEST_DOMAIN, parsed);
}

export const FoundryProviderRecommendationV0Schema =
  RecommendationPayloadObjectSchema.extend({
    recommendationSha256: z.string().regex(SHA256_PREFIXED),
  })
    .strict()
    .superRefine((recommendation, ctx) => {
      const { recommendationSha256, ...payload } = recommendation;
      const payloadResult = FoundryProviderRecommendationPayloadV0Schema.safeParse(payload);
      if (!payloadResult.success) {
        for (const issue of payloadResult.error.issues) {
          ctx.addIssue({ ...issue, path: issue.path });
        }
        return;
      }
      if (
        recommendationSha256 !==
          computeFoundryProviderRecommendationSha256(payloadResult.data)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recommendationSha256"],
          message: "recommendation digest must match its canonical payload",
        });
      }
    });
export type FoundryProviderRecommendationV0 = z.infer<
  typeof FoundryProviderRecommendationV0Schema
>;

export function compileFoundryProviderRecommendationV0(
  input: unknown,
): FoundryProviderRecommendationV0 {
  const requestResult = FoundryProviderRecommendationRequestV0Schema.safeParse(input);
  if (!requestResult.success) {
    throw new FoundryIntegrityError(
      "PROVIDER_RECOMMENDATION_REQUEST_INVALID",
      "Foundry provider recommendation request is invalid.",
    );
  }
  const request = requestResult.data;
  const derived = deriveRecommendation(request);
  const payload = FoundryProviderRecommendationPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_RECOMMENDATION_V0,
    recommendationRequestSha256:
      computeFoundryProviderRecommendationRequestSha256(request),
    request,
    planOnlyRequestSha256: request.planOnlyRequestSha256,
    planOnlyDossierSha256: request.planOnlyDossierSha256,
    ...derived,
    authority: "none",
    capabilities: {
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
    },
  });
  return FoundryProviderRecommendationV0Schema.parse({
    ...payload,
    recommendationSha256: computeFoundryProviderRecommendationSha256(payload),
  });
}

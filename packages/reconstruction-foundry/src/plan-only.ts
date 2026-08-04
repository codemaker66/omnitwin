import {
  FoundryIngestManifestV0Schema,
  FoundryJobSpecV0Schema,
  FoundryJobStageSchema,
  FoundryProviderKindSchema,
  FoundryUtcInstantSchema,
  computeFoundryIngestManifestSha256,
  computeFoundryJobSpecSha256,
  validateFoundryJobRights,
  type FoundryIngestManifestV0,
  type FoundryJobSpecV0,
} from "@omnitwin/types";
import { z } from "zod";
import { domainSeparatedSha256, toCanonicalJson } from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_PLAN_ONLY_REQUEST_V0 = "omnitwin.foundry.plan-only-request.v0";
export const FOUNDRY_PLAN_ONLY_DOSSIER_V0 = "omnitwin.foundry.plan-only-dossier.v0";
const PLAN_REQUEST_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_PLAN_ONLY_REQUEST_V0";
const PLAN_DOSSIER_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_PLAN_ONLY_DOSSIER_V0";

const SHA256_PREFIXED = /^sha256:[a-f0-9]{64}$/u;
const REMOTE_PROVIDER_KINDS = [
  "runpod",
  "aws",
  "azure",
  "gcp",
  "self_hosted_cluster",
  "other",
] as const;

const FoundryPlanRecipeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u),
    displayName: z.string().trim().min(1).max(160),
    stages: z.array(FoundryJobStageSchema).min(1).max(1_000),
  })
  .strict();

const FoundryCapacitySchema = z
  .object({
    cpuCores: z.number().int().positive().max(1_024),
    ramGiB: z.number().positive().max(100_000),
    gpuCount: z.number().int().nonnegative().max(128),
    perGpuVramGiB: z.number().nonnegative().max(1_000),
    scratchGiB: z.number().positive().max(1_000_000),
    maximumInputBytes: z.number().int().safe().nonnegative(),
  })
  .strict();

const FoundryLocalRouteSchema = z
  .object({
    providerKind: z.enum(["local_cpu", "local_cuda"]),
    providerAdapterId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u),
    capacity: FoundryCapacitySchema,
  })
  .strict();

const FoundryCostBreakdownSchema = z
  .object({
    computeUsd: z.number().finite().nonnegative(),
    storageUsd: z.number().finite().nonnegative(),
    egressUsd: z.number().finite().nonnegative(),
    imageAndModelPullUsd: z.number().finite().nonnegative(),
    retryAllowanceUsd: z.number().finite().nonnegative(),
    safetyMarginUsd: z.number().finite().nonnegative(),
  })
  .strict();

const FoundryRemoteRouteSchema = z
  .object({
    providerKind: z.enum(REMOTE_PROVIDER_KINDS),
    providerAdapterId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u),
    objectStorageProfile: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u),
    capacity: FoundryCapacitySchema,
    estimateSnapshot: z
      .object({
        currency: z.literal("USD"),
        observedAt: FoundryUtcInstantSchema,
        expiresAt: FoundryUtcInstantSchema,
        sourceReference: z.string().trim().min(1).max(500),
        breakdown: FoundryCostBreakdownSchema,
        budgetCapUsd: z.number().finite().nonnegative(),
      })
      .strict()
      .superRefine((snapshot, ctx) => {
        if (Date.parse(snapshot.observedAt) >= Date.parse(snapshot.expiresAt)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["expiresAt"],
            message: "provider estimate must expire after it was observed",
          });
        }
      }),
  })
  .strict();

export const FoundryPlanOnlyRequestV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PLAN_ONLY_REQUEST_V0),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u),
    projectId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u),
    ingestManifestSha256: z.string().regex(SHA256_PREFIXED),
    createdAt: FoundryUtcInstantSchema,
    recipe: FoundryPlanRecipeSchema,
    localRoutes: z.array(FoundryLocalRouteSchema).max(2),
    remoteRoutes: z.array(FoundryRemoteRouteSchema).max(20),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.localRoutes.length + request.remoteRoutes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localRoutes"],
        message: "plan request requires at least one local or remote route",
      });
    }
    const routeIds = [...request.localRoutes, ...request.remoteRoutes].map(
      (route) => `${route.providerKind}:${route.providerAdapterId}`,
    );
    if (new Set(routeIds).size !== routeIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remoteRoutes"],
        message: "provider kind and adapter route pairs must be unique",
      });
    }
  });
export type FoundryPlanOnlyRequestV0 = z.infer<typeof FoundryPlanOnlyRequestV0Schema>;

const FoundryPlanCandidateSchema = z
  .object({
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u),
    status: z.enum(["viable_plan_only", "blocked_plan_only"]),
    inputBytes: z.number().int().safe().nonnegative(),
    estimatedCostUsd: z.number().finite().nonnegative(),
    budgetCapUsd: z.number().finite().nonnegative(),
    blockers: z.array(z.string().trim().min(1).max(500)).max(10_000),
    jobSpec: FoundryJobSpecV0Schema.nullable(),
    jobSpecSha256: z.string().regex(SHA256_PREFIXED).nullable(),
  })
  .strict()
  .superRefine((candidate, ctx) => {
    const sortedBlockers = [...candidate.blockers].sort(compareCanonicalStrings);
    if (
      new Set(candidate.blockers).size !== candidate.blockers.length ||
      candidate.blockers.some((blocker, index) => blocker !== sortedBlockers[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "route blockers must be unique and sorted",
      });
    }
    if (candidate.status === "viable_plan_only" && candidate.blockers.length !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "a viable route cannot carry blockers",
      });
    }
    if (candidate.status === "blocked_plan_only" && candidate.blockers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "a blocked route requires at least one blocker",
      });
    }
    if (candidate.jobSpec === null !== (candidate.jobSpecSha256 === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jobSpecSha256"],
        message: "job spec and its digest must either both be present or both be absent",
      });
    }
    if (
      candidate.jobSpec !== null &&
      (
        candidate.jobSpec.executionIntent !== "plan_only" ||
        candidate.jobSpec.computeApprovalId !== null ||
        computeFoundryJobSpecSha256(candidate.jobSpec) !== candidate.jobSpecSha256
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jobSpec"],
        message: "candidate must contain an exact non-dispatchable plan-only JobSpec",
      });
    }
  });

const DossierPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PLAN_ONLY_DOSSIER_V0),
    requestSha256: z.string().regex(SHA256_PREFIXED),
    request: FoundryPlanOnlyRequestV0Schema,
    ingestManifestSha256: z.string().regex(SHA256_PREFIXED),
    candidates: z.array(FoundryPlanCandidateSchema).min(1).max(22),
    authority: z.literal("none"),
    capabilities: z
      .object({
        jobPlanning: z.literal("completed_plan_only"),
        execution: z.literal("not_authorized"),
        modelTraining: z.literal("not_authorized"),
        objectStorageMutation: z.literal("not_authorized"),
        signing: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        promotion: z.literal("not_authorized"),
      })
      .strict(),
  })
  .strict();

function validateDossierPayload(
  dossier: z.infer<typeof DossierPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const routeIds = dossier.candidates.map(
    (candidate) => `${candidate.providerKind}:${candidate.providerAdapterId}`,
  );
  const sorted = [...routeIds].sort(compareCanonicalStrings);
  if (
    new Set(routeIds).size !== routeIds.length ||
    routeIds.some((route, index) => route !== sorted[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["candidates"],
      message: "plan candidates must have unique provider routes in sorted order",
    });
  }
  if (dossier.requestSha256 !== planRequestSha256(dossier.request)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requestSha256"],
      message: "plan dossier must bind its exact request",
    });
  }
  if (
    dossier.ingestManifestSha256 !== dossier.request.ingestManifestSha256 ||
    dossier.candidates.some(
      (candidate) =>
        candidate.jobSpec !== null &&
        candidate.jobSpec.ingestManifestSha256 !== dossier.ingestManifestSha256,
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ingestManifestSha256"],
      message: "every candidate must bind the reviewed ingest manifest",
    });
  }
}

export const FoundryPlanOnlyDossierPayloadSchema =
  DossierPayloadObjectSchema.superRefine(validateDossierPayload);
export type FoundryPlanOnlyDossierPayload = z.infer<
  typeof FoundryPlanOnlyDossierPayloadSchema
>;

export const FoundryPlanOnlyDossierV0Schema = DossierPayloadObjectSchema.extend({
  dossierSha256: z.string().regex(SHA256_PREFIXED),
})
  .strict()
  .superRefine((dossier, ctx) => {
    validateDossierPayload(dossier, ctx);
    const { dossierSha256: _dossierSha256, ...payload } = dossier;
    const parsedPayload = FoundryPlanOnlyDossierPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) return;
    if (dossier.dossierSha256 !== planDossierSha256(parsedPayload.data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dossierSha256"],
        message: "plan dossier digest must match its canonical payload",
      });
    }
  });
export type FoundryPlanOnlyDossierV0 = z.infer<typeof FoundryPlanOnlyDossierV0Schema>;

function prefixedDomainDigest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

export function planRequestSha256(request: FoundryPlanOnlyRequestV0): string {
  const parsed = FoundryPlanOnlyRequestV0Schema.parse(request);
  return prefixedDomainDigest(PLAN_REQUEST_DIGEST_DOMAIN, parsed);
}

export function planDossierSha256(dossier: FoundryPlanOnlyDossierPayload): string {
  const parsed = FoundryPlanOnlyDossierPayloadSchema.parse(dossier);
  return prefixedDomainDigest(PLAN_DOSSIER_DIGEST_DOMAIN, parsed);
}

function roundedUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function estimatedCost(route: z.infer<typeof FoundryRemoteRouteSchema>): number {
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

function capacityBlockers(
  stages: FoundryJobSpecV0["stages"],
  capacity: z.infer<typeof FoundryCapacitySchema>,
): string[] {
  const blockers = new Set<string>();
  for (const stage of stages) {
    if (stage.cpuCores > capacity.cpuCores) blockers.add(`${stage.id}:cpu_capacity_exceeded`);
    if (stage.ramGiB > capacity.ramGiB) blockers.add(`${stage.id}:ram_capacity_exceeded`);
    if (stage.gpuCount > capacity.gpuCount) blockers.add(`${stage.id}:gpu_count_exceeded`);
    if (stage.minimumGpuVramGiB > capacity.perGpuVramGiB) {
      blockers.add(`${stage.id}:gpu_vram_exceeded`);
    }
    if (stage.scratchGiB > capacity.scratchGiB) {
      blockers.add(`${stage.id}:scratch_capacity_exceeded`);
    }
  }
  return [...blockers];
}

function inputBytesFor(
  manifest: FoundryIngestManifestV0,
  stages: FoundryJobSpecV0["stages"],
): { readonly total: number; readonly missing: string[] } {
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset] as const));
  const ids = new Set(stages.flatMap((stage) => stage.inputAssetIds));
  let total = 0;
  const missing: string[] = [];
  for (const id of [...ids].sort(compareCanonicalStrings)) {
    const asset = assets.get(id);
    if (asset === undefined) {
      missing.push(id);
      continue;
    }
    total += asset.sizeBytes;
    if (!Number.isSafeInteger(total)) {
      throw new FoundryIntegrityError(
        "PLAN_INPUT_SIZE_OUT_OF_BOUNDS",
        "Plan input byte total cannot be represented safely.",
      );
    }
  }
  return { total, missing };
}

function planJob(
  request: FoundryPlanOnlyRequestV0,
  providerKind: FoundryJobSpecV0["providerKind"],
  providerAdapterId: string,
  objectStorageProfile: string | null,
  estimatedCostUsd: number,
  budgetCapUsd: number,
): ReturnType<typeof FoundryJobSpecV0Schema.safeParse> {
  return FoundryJobSpecV0Schema.safeParse({
    schemaVersion: "omnitwin.foundry.job-spec.v0",
    id: request.id,
    projectId: request.projectId,
    ingestManifestSha256: request.ingestManifestSha256,
    executionIntent: "plan_only",
    providerKind,
    providerAdapterId,
    stages: request.recipe.stages,
    objectStorageProfile,
    sourceMountMode: "read_only",
    outputPrefix: `projects/${request.projectId}/plans/${request.id}/${providerKind}-${providerAdapterId}`,
    estimatedCostUsd,
    budgetCapUsd,
    killSwitchEnabled: true,
    computeApprovalId: null,
    createdAt: request.createdAt,
  });
}

function candidateFor(
  request: FoundryPlanOnlyRequestV0,
  manifest: FoundryIngestManifestV0,
  route: z.infer<typeof FoundryLocalRouteSchema> | z.infer<typeof FoundryRemoteRouteSchema>,
): z.infer<typeof FoundryPlanCandidateSchema> {
  const remote = !["local_cpu", "local_cuda"].includes(route.providerKind);
  const estimate = remote
    ? estimatedCost(route as z.infer<typeof FoundryRemoteRouteSchema>)
    : 0;
  const budgetCap = remote
    ? (route as z.infer<typeof FoundryRemoteRouteSchema>).estimateSnapshot.budgetCapUsd
    : 0;
  const objectStorageProfile = remote
    ? (route as z.infer<typeof FoundryRemoteRouteSchema>).objectStorageProfile
    : null;
  const jobResult = planJob(
    request,
    route.providerKind,
    route.providerAdapterId,
    objectStorageProfile,
    estimate,
    budgetCap,
  );
  const blockers = new Set<string>();
  const inputs = inputBytesFor(manifest, request.recipe.stages);
  for (const id of inputs.missing) blockers.add(`missing_input_asset:${id}`);
  if (inputs.total > route.capacity.maximumInputBytes) blockers.add("input_bytes_exceed_route_limit");
  for (const blocker of capacityBlockers(request.recipe.stages, route.capacity)) {
    blockers.add(blocker);
  }
  if (
    route.providerKind === "local_cpu" &&
    request.recipe.stages.some((stage) => stage.gpuCount > 0)
  ) {
    blockers.add("local_cpu_cannot_run_gpu_stage");
  }
  if (
    !remote &&
    request.recipe.stages.some((stage) => stage.rightsPurposes.includes("model_training"))
  ) {
    blockers.add("d016_local_model_training_forbidden");
  }
  if (remote) {
    const snapshot = (route as z.infer<typeof FoundryRemoteRouteSchema>).estimateSnapshot;
    const createdAt = Date.parse(request.createdAt);
    if (Date.parse(snapshot.observedAt) > createdAt) blockers.add("estimate_snapshot_not_yet_valid");
    if (Date.parse(snapshot.expiresAt) <= createdAt) blockers.add("estimate_snapshot_expired");
    if (estimate > budgetCap) blockers.add("estimated_cost_exceeds_budget_cap");
  }
  if (!jobResult.success) blockers.add("job_spec_invalid");
  if (jobResult.success) {
    const rights = validateFoundryJobRights(jobResult.data, manifest);
    if (!rights.allowed) {
      for (const blocker of rights.blockers) blockers.add(`rights:${blocker}`);
    }
  }
  const orderedBlockers = [...blockers].sort(compareCanonicalStrings);
  const jobSpec = jobResult.success ? jobResult.data : null;
  return FoundryPlanCandidateSchema.parse({
    providerKind: route.providerKind,
    providerAdapterId: route.providerAdapterId,
    status: orderedBlockers.length === 0 ? "viable_plan_only" : "blocked_plan_only",
    inputBytes: inputs.total,
    estimatedCostUsd: estimate,
    budgetCapUsd: budgetCap,
    blockers: orderedBlockers,
    jobSpec,
    jobSpecSha256: jobSpec === null ? null : computeFoundryJobSpecSha256(jobSpec),
  });
}

export function compileFoundryPlanOnlyDossier(
  requestInput: unknown,
  manifestInput: unknown,
): FoundryPlanOnlyDossierV0 {
  const requestResult = FoundryPlanOnlyRequestV0Schema.safeParse(requestInput);
  if (!requestResult.success) {
    throw new FoundryIntegrityError(
      "PLAN_REQUEST_INVALID",
      "Foundry plan-only request is invalid.",
    );
  }
  const manifestResult = FoundryIngestManifestV0Schema.safeParse(manifestInput);
  if (!manifestResult.success) {
    throw new FoundryIntegrityError(
      "PLAN_MANIFEST_INVALID",
      "Foundry plan-only manifest is invalid.",
    );
  }
  const request = requestResult.data;
  const manifest = manifestResult.data;
  if (computeFoundryIngestManifestSha256(manifest) !== request.ingestManifestSha256) {
    throw new FoundryIntegrityError(
      "PLAN_MANIFEST_DIGEST_MISMATCH",
      "Plan request does not bind the supplied ingest manifest.",
    );
  }
  const recipeProbe = planJob(
    request,
    "local_cpu",
    "recipe-validation-v0",
    null,
    0,
    0,
  );
  if (!recipeProbe.success) {
    throw new FoundryIntegrityError(
      "PLAN_RECIPE_INVALID",
      "Plan recipe does not form a valid acyclic JobSpec stage graph.",
    );
  }
  const routes = [...request.localRoutes, ...request.remoteRoutes].sort((left, right) => {
    const leftId = `${left.providerKind}:${left.providerAdapterId}`;
    const rightId = `${right.providerKind}:${right.providerAdapterId}`;
    return compareCanonicalStrings(leftId, rightId);
  });
  const candidates = routes.map((route) => candidateFor(request, manifest, route));
  const payload = FoundryPlanOnlyDossierPayloadSchema.parse({
    schemaVersion: FOUNDRY_PLAN_ONLY_DOSSIER_V0,
    requestSha256: planRequestSha256(request),
    request,
    ingestManifestSha256: request.ingestManifestSha256,
    candidates,
    authority: "none",
    capabilities: {
      jobPlanning: "completed_plan_only",
      execution: "not_authorized",
      modelTraining: "not_authorized",
      objectStorageMutation: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    },
  });
  return FoundryPlanOnlyDossierV0Schema.parse({
    ...payload,
    dossierSha256: planDossierSha256(payload),
  });
}

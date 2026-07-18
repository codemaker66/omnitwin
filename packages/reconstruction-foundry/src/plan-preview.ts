import {
  FoundryIngestManifestV0Schema,
  FoundryIntakeAdmissionResultV0Schema,
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  computeFoundryIngestManifestSha256,
  computeFoundryTrustedWorkerProfileSha256,
  type FoundryIngestManifestV0,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_PIPELINE_WORKER_ROLES,
  FoundryPipelineWorkerBindingV0Schema,
  FoundryReconstructionRecipeOptionsV0Schema,
  FoundryReconstructionRecipeV0Schema,
  compileFoundryStageAssetRoutingV0,
  compileFoundryReconstructionRecipe,
  toFoundryPlanOnlyRecipe,
  type FoundryPipelineWorkerBindingV0,
  type FoundryPipelineWorkerRole,
  type FoundryReconstructionRecipeOptionsV0,
  type FoundryReconstructionRecipeV0,
} from "./pipeline-recipe.js";
import {
  FOUNDRY_PLAN_ONLY_REQUEST_V0,
  FoundryPlanOnlyDossierV0Schema,
  FoundryPlanOnlyRequestV0Schema,
  compileFoundryPlanOnlyDossier,
  type FoundryPlanOnlyDossierV0,
} from "./plan-only.js";

export const FOUNDRY_PLAN_PREVIEW_V0 = "omnitwin.foundry.plan-preview.v0";
const PLAN_PREVIEW_DIGEST_DOMAIN = "OMNITWIN_FOUNDRY_PLAN_PREVIEW_V0";

const REMOTE_PROVIDER_KINDS = [
  "runpod",
  "aws",
  "azure",
  "gcp",
  "self_hosted_cluster",
  "other",
] as const;

export const FoundryPlanPreviewCapacityV0Schema = z
  .object({
    cpuCores: z.number().int().positive().max(1_024),
    ramGiB: z.number().positive().max(100_000),
    gpuCount: z.number().int().nonnegative().max(128),
    perGpuVramGiB: z.number().nonnegative().max(1_000),
    scratchGiB: z.number().positive().max(1_000_000),
    maximumInputBytes: z.number().int().safe().nonnegative(),
  })
  .strict();

export const FoundryPlanPreviewLocalRouteV0Schema = z
  .object({
    providerKind: z.enum(["local_cpu", "local_cuda"]),
    providerAdapterId: RuntimeManifestKeySchema,
    capacity: FoundryPlanPreviewCapacityV0Schema.nullable(),
  })
  .strict();

export const FoundryPlanPreviewCostBreakdownV0Schema = z
  .object({
    computeUsd: z.number().finite().nonnegative(),
    storageUsd: z.number().finite().nonnegative(),
    egressUsd: z.number().finite().nonnegative(),
    imageAndModelPullUsd: z.number().finite().nonnegative(),
    retryAllowanceUsd: z.number().finite().nonnegative(),
    safetyMarginUsd: z.number().finite().nonnegative(),
  })
  .strict();

export const FoundryPlanPreviewEstimateSnapshotV0Schema = z
  .object({
    currency: z.literal("USD"),
    observedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
    sourceReference: z.string().trim().min(1).max(500),
    breakdown: FoundryPlanPreviewCostBreakdownV0Schema,
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
  });

export const FoundryPlanPreviewRemoteRouteV0Schema = z
  .object({
    providerKind: z.enum(REMOTE_PROVIDER_KINDS),
    providerAdapterId: RuntimeManifestKeySchema,
    objectStorageProfile: RuntimeManifestKeySchema,
    capacity: FoundryPlanPreviewCapacityV0Schema.nullable(),
    estimateSnapshot: FoundryPlanPreviewEstimateSnapshotV0Schema.nullable(),
  })
  .strict();

export const FoundryPlanPreviewInputV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    displayName: z.string().trim().min(1).max(160),
    createdAt: FoundryUtcInstantSchema,
    admissionResult: FoundryIntakeAdmissionResultV0Schema,
    manifest: FoundryIngestManifestV0Schema,
    options: FoundryReconstructionRecipeOptionsV0Schema,
    workerBindings: z.array(FoundryPipelineWorkerBindingV0Schema).max(1_000),
    localRoutes: z.array(FoundryPlanPreviewLocalRouteV0Schema).max(2),
    remoteRoutes: z.array(FoundryPlanPreviewRemoteRouteV0Schema).max(20),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.localRoutes.length + input.remoteRoutes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localRoutes"],
        message: "plan preview requires at least one local or cloud route",
      });
    }
    const routeIds = [...input.localRoutes, ...input.remoteRoutes].map(
      (route) => `${route.providerKind}:${route.providerAdapterId}`,
    );
    if (new Set(routeIds).size !== routeIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remoteRoutes"],
        message: "provider kind and adapter pairs must be unique",
      });
    }
    const roles = input.workerBindings.map((binding) => binding.role);
    if (new Set(roles).size !== roles.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workerBindings"],
        message: "trusted worker roles must be unique",
      });
    }
  });
export type FoundryPlanPreviewInputV0 = z.infer<
  typeof FoundryPlanPreviewInputV0Schema
>;

const PLAN_GATE_BLOCKER_CODES = [
  "proprietary_xgrids_xbin_decoder_not_verified",
  "source_asset_access_does_not_allow_processing",
  "trusted_worker_profile_not_active",
  "trusted_worker_binding_missing",
] as const;

const FoundryPlanGateBlockerSchema = z
  .object({
    code: z.enum(PLAN_GATE_BLOCKER_CODES),
    explanation: z.string().trim().min(1).max(2_000),
    nextAction: z.string().trim().min(1).max(2_000),
    affectedAssetIds: z.array(RuntimeManifestKeySchema).max(100_000),
    affectedWorkerRoles: z.array(z.enum(FOUNDRY_PIPELINE_WORKER_ROLES)).max(1_000),
  })
  .strict();

const FoundryPlanGateSchema = z
  .object({
    status: z.enum(["clear", "blocked"]),
    blockers: z.array(FoundryPlanGateBlockerSchema).max(20),
  })
  .strict()
  .superRefine((gate, ctx) => {
    if ((gate.status === "clear") !== (gate.blockers.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "a clear planning gate has no blockers; a blocked gate has at least one",
      });
    }
    const codes = gate.blockers.map((blocker) => blocker.code);
    const sorted = [...codes].sort(compareCanonicalStrings);
    if (
      new Set(codes).size !== codes.length ||
      codes.some((code, index) => code !== sorted[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "planning-gate blockers must be unique and sorted by code",
      });
    }
  });

const FoundryPlanPreviewRouteBlockerSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,499}$/u),
    explanation: z.string().trim().min(1).max(2_000),
  })
  .strict();

const FoundryPlanPreviewNoCostSchema = z
  .object({
    state: z.literal("not_supplied"),
    amountUsd: z.null(),
    budgetCapUsd: z.null(),
    sourceReference: z.null(),
    observedAt: z.null(),
    expiresAt: z.null(),
    breakdown: z.null(),
    explanation: z.literal(
      "No provider price was supplied for this-computer work. This preview does not call local computing free.",
    ),
  })
  .strict();

const FoundryPlanPreviewSuppliedCostSchema = z
  .object({
    state: z.literal("calculated_from_supplied_snapshot"),
    currency: z.literal("USD"),
    amountUsd: z.number().finite().nonnegative(),
    budgetCapUsd: z.number().finite().nonnegative(),
    sourceReference: z.string().trim().min(1).max(500),
    observedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
    breakdown: FoundryPlanPreviewCostBreakdownV0Schema,
    explanation: z.literal(
      "This total uses only the price snapshot supplied to the preview. The preview did not contact the provider, and this is not a final bill or quote.",
    ),
  })
  .strict();

const FoundryPlanPreviewMissingCloudCostSchema = z
  .object({
    state: z.literal("not_supplied"),
    currency: z.literal("USD"),
    amountUsd: z.null(),
    budgetCapUsd: z.null(),
    sourceReference: z.null(),
    observedAt: z.null(),
    expiresAt: z.null(),
    breakdown: z.null(),
    explanation: z.literal(
      "No trusted provider price snapshot was supplied. This route stays blocked, and the preview does not guess a price.",
    ),
  })
  .strict();

const FoundryPlanPreviewRouteBaseSchema = z
  .object({
    providerAdapterId: RuntimeManifestKeySchema,
    heading: z.string().trim().min(1).max(160),
    status: z.enum(["plan_available", "blocked"]),
    plainLanguageStatus: z.string().trim().min(1).max(2_000),
    inputBytes: z.number().int().safe().nonnegative(),
    capacity: FoundryPlanPreviewCapacityV0Schema.nullable(),
    blockers: z.array(FoundryPlanPreviewRouteBlockerSchema).max(10_000),
    jobSpecSha256: RuntimeSha256Schema.nullable(),
  })
  .strict();

const FoundryPlanPreviewLocalRouteResultSchema =
  FoundryPlanPreviewRouteBaseSchema.extend({
    location: z.literal("this_computer"),
    providerKind: z.enum(["local_cpu", "local_cuda"]),
    cost: FoundryPlanPreviewNoCostSchema,
  })
    .strict()
    .superRefine(validateRouteResult);

const FoundryPlanPreviewCloudRouteResultSchema =
  FoundryPlanPreviewRouteBaseSchema.extend({
    location: z.literal("cloud"),
    providerKind: z.enum(REMOTE_PROVIDER_KINDS),
    cost: z.union([
      FoundryPlanPreviewSuppliedCostSchema,
      FoundryPlanPreviewMissingCloudCostSchema,
    ]),
  })
    .strict()
    .superRefine(validateRouteResult);

function validateRouteResult(
  route: {
    readonly status: "plan_available" | "blocked";
    readonly blockers: readonly { readonly code: string }[];
    readonly jobSpecSha256: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  const codes = route.blockers.map((blocker) => blocker.code);
  const sorted = [...codes].sort(compareCanonicalStrings);
  if (
    new Set(codes).size !== codes.length ||
    codes.some((code, index) => code !== sorted[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["blockers"],
      message: "route blockers must be unique and sorted by code",
    });
  }
  if ((route.status === "plan_available") !== (route.blockers.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "an available plan has no blockers; a blocked plan has at least one",
    });
  }
  if (route.status === "plan_available" && route.jobSpecSha256 === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["jobSpecSha256"],
      message: "an available plan must bind its exact plan-only JobSpec",
    });
  }
}

const FoundryPlanPreviewTruthSeparationSchema = z
  .object({
    sourceAssetIds: z
      .object({
        captured: z.array(RuntimeManifestKeySchema).max(100_000),
        enhancedCaptured: z.array(RuntimeManifestKeySchema).max(100_000),
        generatedCinematic: z.array(RuntimeManifestKeySchema).max(100_000),
        conceptImagination: z.array(RuntimeManifestKeySchema).max(100_000),
      })
      .strict(),
    measuredCoordinateFrameIds: z.array(RuntimeManifestKeySchema).max(10_000),
    outputPlanningState: z.enum(["compiled", "not_compiled_planning_gate_blocked"]),
    outputStageIds: z
      .object({
        measuredEligibleCapturedDerivatives: z.array(RuntimeManifestKeySchema).max(1_000),
        capturedDerivatives: z.array(RuntimeManifestKeySchema).max(1_000),
        enhancedCapturedDerivatives: z.array(RuntimeManifestKeySchema).max(1_000),
        aiGeneratedDerivatives: z.array(RuntimeManifestKeySchema).max(1_000),
        mixedCandidates: z.array(RuntimeManifestKeySchema).max(1_000),
      })
      .strict(),
    rules: z
      .object({
        measured: z.literal(
          "Only captured-derived outputs explicitly marked as measured-eligible may be reviewed for measured geometry. This preview grants no measurement authority.",
        ),
        captured: z.literal(
          "Captured and enhanced-captured outputs remain separately labelled and distinct from AI-generated material.",
        ),
        generated: z.literal(
          "Enhanced-captured, AI-generated, and mixed outputs can never enter measured geometry and remain in isolated namespaces.",
        ),
      })
      .strict(),
  })
  .strict();

const FoundryPlanPreviewCompiledArtifactsSchema = z
  .object({
    state: z.literal("compiled"),
    reconstructionRecipe: FoundryReconstructionRecipeV0Schema,
    planOnlyDossier: FoundryPlanOnlyDossierV0Schema,
  })
  .strict();

const FoundryPlanPreviewWithheldArtifactsSchema = z
  .object({
    state: z.literal("withheld_planning_gate_blocked"),
    reconstructionRecipe: z.null(),
    planOnlyDossier: z.null(),
  })
  .strict();

const FoundryPlanPreviewRecipeOnlyArtifactsSchema = z
  .object({
    state: z.literal("recipe_compiled_routes_incomplete"),
    reconstructionRecipe: FoundryReconstructionRecipeV0Schema,
    planOnlyDossier: z.null(),
  })
  .strict();

const FoundryPlanPreviewArtifactsSchema = z.discriminatedUnion("state", [
  FoundryPlanPreviewCompiledArtifactsSchema,
  FoundryPlanPreviewRecipeOnlyArtifactsSchema,
  FoundryPlanPreviewWithheldArtifactsSchema,
]);

const FoundryPlanPreviewPayloadObjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PLAN_PREVIEW_V0),
    id: RuntimeManifestKeySchema,
    displayName: z.string().trim().min(1).max(160),
    createdAt: FoundryUtcInstantSchema,
    admissionResultSha256: RuntimeSha256Schema,
    ingestManifestSha256: RuntimeSha256Schema,
    options: FoundryReconstructionRecipeOptionsV0Schema,
    workerProfileSha256s: z.array(RuntimeSha256Schema).max(1_000),
    status: z.enum(["blocked_before_recipe", "plan_available", "all_routes_blocked"]),
    planningGate: FoundryPlanGateSchema,
    truthSeparation: FoundryPlanPreviewTruthSeparationSchema,
    routes: z
      .object({
        local: z.array(FoundryPlanPreviewLocalRouteResultSchema).max(2),
        cloud: z.array(FoundryPlanPreviewCloudRouteResultSchema).max(20),
      })
      .strict(),
    human: z
      .object({
        headline: z.string().trim().min(1).max(500),
        summary: z.string().trim().min(1).max(4_000),
        nextAction: z.string().trim().min(1).max(4_000),
      })
      .strict(),
    exactArtifacts: FoundryPlanPreviewArtifactsSchema,
    authority: z.literal("none"),
    capabilities: z
      .object({
        planning: z.literal("preview_only"),
        execution: z.literal("not_authorized"),
        processLaunch: z.literal("not_available"),
        networkAccess: z.literal("not_available"),
        providerSdk: z.literal("not_available"),
        credentialAccess: z.literal("not_available"),
        spend: z.literal("not_authorized"),
        sourceMutation: z.literal("not_authorized"),
        signing: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        promotion: z.literal("not_authorized"),
      })
      .strict(),
  })
  .strict();

type PreviewPayloadObject = z.infer<
  typeof FoundryPlanPreviewPayloadObjectV0Schema
>;

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right));
}

function validatePreviewPayload(
  preview: PreviewPayloadObject,
  ctx: z.RefinementCtx,
): void {
  const allRoutes = [...preview.routes.local, ...preview.routes.cloud];
  const routeIds = allRoutes.map(
    (route) => `${route.providerKind}:${route.providerAdapterId}`,
  );
  const localRouteIds = preview.routes.local.map(
    (route) => `${route.providerKind}:${route.providerAdapterId}`,
  );
  const cloudRouteIds = preview.routes.cloud.map(
    (route) => `${route.providerKind}:${route.providerAdapterId}`,
  );
  const sortedLocalRouteIds = [...localRouteIds].sort(compareCanonicalStrings);
  const sortedCloudRouteIds = [...cloudRouteIds].sort(compareCanonicalStrings);
  if (
    new Set(routeIds).size !== routeIds.length ||
    localRouteIds.some((id, index) => id !== sortedLocalRouteIds[index]) ||
    cloudRouteIds.some((id, index) => id !== sortedCloudRouteIds[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["routes"],
      message: "preview routes must be sorted by provider kind and adapter ID",
    });
  }
  const profileDigests = preview.workerProfileSha256s;
  const sortedProfileDigests = [...profileDigests].sort(compareCanonicalStrings);
  if (
    profileDigests.length !== new Set(profileDigests).size ||
    profileDigests.some(
      (digest, index) => digest !== sortedProfileDigests[index],
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["workerProfileSha256s"],
      message: "worker profile digests must be unique and sorted",
    });
  }
  const availableCount = allRoutes.filter(
    (route) => route.status === "plan_available",
  ).length;
  if (preview.planningGate.status === "blocked") {
    const outputStageIds = preview.truthSeparation.outputStageIds;
    if (
      outputStageIds.measuredEligibleCapturedDerivatives.length > 0 ||
      outputStageIds.capturedDerivatives.length > 0 ||
      outputStageIds.enhancedCapturedDerivatives.length > 0 ||
      outputStageIds.aiGeneratedDerivatives.length > 0 ||
      outputStageIds.mixedCandidates.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truthSeparation", "outputStageIds"],
        message: "a blocked preview cannot claim compiled output stages",
      });
    }
    if (
      preview.status !== "blocked_before_recipe" ||
      preview.exactArtifacts.state !== "withheld_planning_gate_blocked" ||
      preview.truthSeparation.outputPlanningState !==
        "not_compiled_planning_gate_blocked" ||
      availableCount !== 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["planningGate"],
        message: "a blocked planning gate must withhold artifacts and block every route",
      });
    }
    return;
  }
  if (
    preview.status === "blocked_before_recipe" ||
    preview.exactArtifacts.state === "withheld_planning_gate_blocked" ||
    preview.truthSeparation.outputPlanningState !== "compiled"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["exactArtifacts"],
      message: "a clear planning gate must bind the exact compiled artifacts",
    });
    return;
  }
  if (
    (preview.status === "plan_available") !== (availableCount > 0) ||
    (preview.status === "all_routes_blocked") !== (availableCount === 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "preview status must match route availability",
    });
  }
  const recipe = preview.exactArtifacts.reconstructionRecipe;
  const dossier = preview.exactArtifacts.planOnlyDossier;
  if (
    recipe.ingestManifestSha256 !== preview.ingestManifestSha256 ||
    !equalCanonical(recipe.options, preview.options)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["exactArtifacts"],
      message: "compiled artifacts must bind this preview's manifest, options, and recipe",
    });
  }
  const expectedOutputStages = truthOutputStageIds(recipe);
  if (
    !equalCanonical(
      expectedOutputStages,
      preview.truthSeparation.outputStageIds,
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["truthSeparation", "outputStageIds"],
      message: "truth-layer stage lists must match the exact recipe outputs",
    });
  }
  if (dossier === null) {
    if (
      availableCount !== 0 ||
      allRoutes.some(
        (route) => route.jobSpecSha256 !== null || route.blockers.length === 0,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exactArtifacts"],
        message: "a recipe-only preview requires every incomplete route to stay blocked",
      });
    }
    return;
  }
  if (
    dossier.ingestManifestSha256 !== preview.ingestManifestSha256 ||
    !equalCanonical(toFoundryPlanOnlyRecipe(recipe), dossier.request.recipe)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["exactArtifacts"],
      message: "the plan-only dossier must bind the exact compiled recipe",
    });
  }
  const candidateByRoute = new Map<string, FoundryPlanOnlyDossierV0["candidates"][number]>(
    dossier.candidates.map((candidate) => [
      `${candidate.providerKind}:${candidate.providerAdapterId}`,
      candidate,
    ] as const),
  );
  if (
    dossier.candidates.some((candidate) =>
      !routeIds.includes(`${candidate.providerKind}:${candidate.providerAdapterId}`)
    ) ||
    allRoutes.some((route) => {
      const candidate = candidateByRoute.get(
        `${route.providerKind}:${route.providerAdapterId}`,
      );
      if (candidate === undefined) {
        const blockerCodes = new Set(route.blockers.map((blocker) => blocker.code));
        return (
          route.status !== "blocked" ||
          route.jobSpecSha256 !== null ||
          (!blockerCodes.has("route_capacity_not_supplied") &&
            !blockerCodes.has("provider_estimate_not_supplied"))
        );
      }
      const blockerCodes = new Set(route.blockers.map((blocker) => blocker.code));
      return (
        candidate.inputBytes !== route.inputBytes ||
        candidate.jobSpecSha256 !== route.jobSpecSha256 ||
        candidate.blockers.some((blocker) => !blockerCodes.has(blocker)) ||
        (candidate.status === "blocked_plan_only" && route.status !== "blocked")
      );
    })
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["routes"],
      message: "route summaries must faithfully include every exact dossier candidate",
    });
  }
}

const FoundryPlanPreviewPayloadV0Schema =
  FoundryPlanPreviewPayloadObjectV0Schema.superRefine(validatePreviewPayload);
export type FoundryPlanPreviewPayloadV0 = z.infer<
  typeof FoundryPlanPreviewPayloadV0Schema
>;

export const FoundryPlanPreviewV0Schema =
  FoundryPlanPreviewPayloadObjectV0Schema.extend({
    previewSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((preview, ctx) => {
      validatePreviewPayload(preview, ctx);
      const { previewSha256: _previewSha256, ...payload } = preview;
      const parsed = FoundryPlanPreviewPayloadV0Schema.safeParse(payload);
      if (!parsed.success) return;
      if (preview.previewSha256 !== computeFoundryPlanPreviewSha256(parsed.data)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["previewSha256"],
          message: "plan preview digest must match its exact payload",
        });
      }
    });
export type FoundryPlanPreviewV0 = z.infer<
  typeof FoundryPlanPreviewV0Schema
>;

export function computeFoundryPlanPreviewSha256(
  preview: FoundryPlanPreviewPayloadV0,
): string {
  const parsed = FoundryPlanPreviewPayloadV0Schema.parse(preview);
  return `sha256:${domainSeparatedSha256(
    PLAN_PREVIEW_DIGEST_DOMAIN,
    toCanonicalJson(parsed),
  )}`;
}

function requiredWorkerRoles(
  manifest: FoundryIngestManifestV0,
  options: FoundryReconstructionRecipeOptionsV0,
): FoundryPipelineWorkerRole[] {
  return compileFoundryStageAssetRoutingV0(manifest, options).map((route) => route.role);
}

function planGateBlockers(
  manifest: FoundryIngestManifestV0,
  options: FoundryReconstructionRecipeOptionsV0,
  bindings: readonly FoundryPipelineWorkerBindingV0[],
  createdAt: string,
): z.infer<typeof FoundryPlanGateBlockerSchema>[] {
  const blockers: z.infer<typeof FoundryPlanGateBlockerSchema>[] = [];
  const xbinIds = sortedUnique(
    manifest.assets
      .filter((asset) => asset.inputType === "xgrids_xbin")
      .map((asset) => asset.id),
  );
  if (xbinIds.length > 0) {
    blockers.push({
      code: "proprietary_xgrids_xbin_decoder_not_verified",
      explanation:
        "The raw XGRIDS .xbin is proprietary, and this Foundry build has no independently verified decoder. It stays unchanged as evidence and cannot enter a reconstruction plan.",
      nextAction:
        "Keep the .xbin file, exclude it from this processing manifest, and admit a reviewed vendor export that the selected worker can read.",
      affectedAssetIds: xbinIds,
      affectedWorkerRoles: [],
    });
  }
  const inaccessibleIds = sortedUnique(
    manifest.assets
      .filter(
        (asset) =>
          asset.inputType !== "xgrids_xbin" &&
          ["metadata_only", "blocked_technical", "blocked_legal", "unknown"]
            .includes(asset.accessState),
      )
      .map((asset) => asset.id),
  );
  if (inaccessibleIds.length > 0) {
    blockers.push({
      code: "source_asset_access_does_not_allow_processing",
      explanation:
        "At least one admitted file is present only for reference, or is technically or legally blocked. A reconstruction step must not read it as working input.",
      nextAction:
        "Resolve the listed file's access review or exclude it from the processing manifest, then build the preview again.",
      affectedAssetIds: inaccessibleIds,
      affectedWorkerRoles: [],
    });
  }
  if (blockers.length === 0) {
    const required = requiredWorkerRoles(manifest, options);
    const bindingByRole = new Map(bindings.map((binding) => [binding.role, binding]));
    const missing = required.filter((role) => !bindingByRole.has(role));
    if (missing.length > 0) {
      blockers.push({
        code: "trusted_worker_binding_missing",
        explanation:
          "One or more reconstruction steps has no reviewed worker program attached, so an exact recipe cannot be created.",
        nextAction:
          "Add a pinned, reviewed worker binding for every listed step, then build the preview again.",
        affectedAssetIds: [],
        affectedWorkerRoles: missing,
      });
    }
    const at = Date.parse(createdAt);
    const inactive = required.filter((role) => {
      const profile = bindingByRole.get(role)?.profile;
      return profile !== undefined &&
        (Date.parse(profile.reviewedAt) > at || Date.parse(profile.expiresAt) <= at);
    });
    if (inactive.length > 0) {
      blockers.push({
        code: "trusted_worker_profile_not_active",
        explanation:
          "One or more reviewed worker profiles is not active at the preview time. An expired or not-yet-reviewed worker must not be called trusted.",
        nextAction:
          "Supply a current reviewed worker profile for every listed step, then build the preview again.",
        affectedAssetIds: [],
        affectedWorkerRoles: inactive,
      });
    }
  }
  return blockers.sort((left, right) =>
    compareCanonicalStrings(left.code, right.code)
  );
}

function totalInputBytes(manifest: FoundryIngestManifestV0): number {
  let total = 0;
  for (const asset of manifest.assets) {
    total += asset.sizeBytes;
    if (!Number.isSafeInteger(total)) {
      throw new FoundryIntegrityError(
        "PLAN_PREVIEW_INPUT_SIZE_OUT_OF_BOUNDS",
        "The admitted input byte total cannot be represented safely.",
      );
    }
  }
  return total;
}

function roundedUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function suppliedCost(
  snapshot: z.infer<typeof FoundryPlanPreviewEstimateSnapshotV0Schema>,
): z.infer<typeof FoundryPlanPreviewSuppliedCostSchema> {
  const breakdown = snapshot.breakdown;
  return {
    state: "calculated_from_supplied_snapshot",
    currency: "USD",
    amountUsd: roundedUsd(
      breakdown.computeUsd +
        breakdown.storageUsd +
        breakdown.egressUsd +
        breakdown.imageAndModelPullUsd +
        breakdown.retryAllowanceUsd +
        breakdown.safetyMarginUsd,
    ),
    budgetCapUsd: snapshot.budgetCapUsd,
    sourceReference: snapshot.sourceReference,
    observedAt: snapshot.observedAt,
    expiresAt: snapshot.expiresAt,
    breakdown,
    explanation:
      "This total uses only the price snapshot supplied to the preview. The preview did not contact the provider, and this is not a final bill or quote.",
  };
}

function missingCloudCost(): z.infer<typeof FoundryPlanPreviewMissingCloudCostSchema> {
  return {
    state: "not_supplied",
    currency: "USD",
    amountUsd: null,
    budgetCapUsd: null,
    sourceReference: null,
    observedAt: null,
    expiresAt: null,
    breakdown: null,
    explanation:
      "No trusted provider price snapshot was supplied. This route stays blocked, and the preview does not guess a price.",
  };
}

function noLocalCost(): z.infer<typeof FoundryPlanPreviewNoCostSchema> {
  return {
    state: "not_supplied",
    amountUsd: null,
    budgetCapUsd: null,
    sourceReference: null,
    observedAt: null,
    expiresAt: null,
    breakdown: null,
    explanation:
      "No provider price was supplied for this-computer work. This preview does not call local computing free.",
  };
}

function readableStage(value: string): string {
  return value.replaceAll("_", " ");
}

function explainRouteBlocker(code: string): string {
  if (code === "input_bytes_exceed_route_limit") {
    return "The admitted files are larger than this route's declared input limit.";
  }
  if (code === "route_capacity_not_supplied") {
    return "No trusted capacity record was supplied for this route, so the preview cannot decide whether the computer is large enough.";
  }
  if (code === "provider_estimate_not_supplied") {
    return "No trusted cloud price snapshot was supplied. The route stays blocked because the preview will not guess a price.";
  }
  if (code === "local_cpu_cannot_run_gpu_stage") {
    return "At least one step needs a GPU, but this-computer route offers CPU only.";
  }
  if (code === "d016_local_model_training_forbidden") {
    return "The current safety policy does not allow model training on a this-computer route.";
  }
  if (code === "estimate_snapshot_not_yet_valid") {
    return "The supplied cloud price snapshot starts after the preview time.";
  }
  if (code === "estimate_snapshot_expired") {
    return "The supplied cloud price snapshot had already expired at the preview time.";
  }
  if (code === "estimated_cost_exceeds_budget_cap") {
    return "The total from the supplied cloud price snapshot is above the supplied spending limit.";
  }
  if (code === "job_spec_invalid") {
    return "The exact plan-only job contract is invalid. Resolve the other listed planning problems before continuing.";
  }
  if (code.startsWith("missing_input_asset:")) {
    return `The recipe refers to an admitted file that is missing: ${code.slice("missing_input_asset:".length)}.`;
  }
  if (code.startsWith("worker_profile_not_cleared_for_local:")) {
    return `The reviewed worker for “${readableStage(code.slice("worker_profile_not_cleared_for_local:".length))}” is not cleared to run on this computer.`;
  }
  const capacity = /^([^:]+):(cpu_capacity_exceeded|ram_capacity_exceeded|gpu_count_exceeded|gpu_vram_exceeded|scratch_capacity_exceeded)$/u.exec(code);
  if (capacity !== null) {
    const stage = readableStage(capacity[1] ?? "this step");
    const reason = {
      cpu_capacity_exceeded: "more CPU cores",
      ram_capacity_exceeded: "more memory",
      gpu_count_exceeded: "more GPUs",
      gpu_vram_exceeded: "more GPU memory",
      scratch_capacity_exceeded: "more temporary disk space",
    }[capacity[2] ?? ""] ?? "more computing capacity";
    return `The “${stage}” step needs ${reason} than this route declares.`;
  }
  if (code.startsWith("rights:")) {
    const parts = code.split(":");
    const stage = readableStage(parts[1] ?? "unknown step");
    const asset = parts[2] ?? "unknown file";
    const reason = parts.slice(3).join(":").replaceAll("_", " ");
    return `The “${stage}” step cannot use file “${asset}” because its rights record says: ${reason}.`;
  }
  return `A planning rule blocks this route: “${code}”. It needs a dedicated explanation before a person should continue.`;
}

function dedupeRouteBlockers(
  blockers: readonly z.infer<typeof FoundryPlanPreviewRouteBlockerSchema>[],
): z.infer<typeof FoundryPlanPreviewRouteBlockerSchema>[] {
  const byCode = new Map<string, z.infer<typeof FoundryPlanPreviewRouteBlockerSchema>>();
  for (const blocker of blockers) byCode.set(blocker.code, blocker);
  return [...byCode.values()].sort((left, right) =>
    compareCanonicalStrings(left.code, right.code)
  );
}

function providerHeading(providerKind: string): string {
  const labels: Readonly<Record<string, string>> = {
    local_cpu: "This computer — CPU",
    local_cuda: "This computer — CUDA GPU",
    runpod: "Cloud — RunPod",
    aws: "Cloud — AWS",
    azure: "Cloud — Azure",
    gcp: "Cloud — Google Cloud",
    self_hosted_cluster: "Cloud — self-hosted cluster",
    other: "Cloud — other provider",
  };
  return labels[providerKind] ?? `Cloud — ${providerKind}`;
}

function routeStatusText(
  status: "plan_available" | "blocked",
  cloud: boolean,
): string {
  if (status === "blocked") {
    return "This route's plan is blocked. Nothing can run. Read the reasons below.";
  }
  return cloud
    ? "The admitted inputs fit this cloud route's supplied planning checks. This is still only a preview: it cannot upload files, spend money, or start work."
    : "The admitted inputs fit this-computer route's supplied planning checks. This is still only a preview: it cannot start reconstruction work or change a source file.";
}

function blockedRouteResults(
  input: FoundryPlanPreviewInputV0,
  gateBlockers: readonly z.infer<typeof FoundryPlanGateBlockerSchema>[],
): {
  readonly local: z.infer<typeof FoundryPlanPreviewLocalRouteResultSchema>[];
  readonly cloud: z.infer<typeof FoundryPlanPreviewCloudRouteResultSchema>[];
} {
  const inputBytes = totalInputBytes(input.manifest);
  const baseBlockers = gateBlockers.map((blocker) => ({
    code: blocker.code,
    explanation: blocker.explanation,
  }));
  const forCapacity = (
    capacity: z.infer<typeof FoundryPlanPreviewCapacityV0Schema> | null,
    missingEstimate: boolean,
  ) =>
    dedupeRouteBlockers([
      ...baseBlockers,
      ...(capacity === null
        ? [{
            code: "route_capacity_not_supplied",
            explanation: explainRouteBlocker("route_capacity_not_supplied"),
          }]
        : []),
      ...(capacity !== null && inputBytes > capacity.maximumInputBytes
        ? [{
            code: "input_bytes_exceed_route_limit",
            explanation: explainRouteBlocker("input_bytes_exceed_route_limit"),
          }]
        : []),
      ...(missingEstimate
        ? [{
            code: "provider_estimate_not_supplied",
            explanation: explainRouteBlocker("provider_estimate_not_supplied"),
          }]
        : []),
    ]);
  const local = input.localRoutes.map((route) => ({
    location: "this_computer" as const,
    providerKind: route.providerKind,
    providerAdapterId: route.providerAdapterId,
    heading: providerHeading(route.providerKind),
    status: "blocked" as const,
    plainLanguageStatus: routeStatusText("blocked", false),
    inputBytes,
    capacity: route.capacity,
    blockers: forCapacity(route.capacity, false),
    jobSpecSha256: null,
    cost: noLocalCost(),
  }));
  const cloud = input.remoteRoutes.map((route) => ({
    location: "cloud" as const,
    providerKind: route.providerKind,
    providerAdapterId: route.providerAdapterId,
    heading: providerHeading(route.providerKind),
    status: "blocked" as const,
    plainLanguageStatus: routeStatusText("blocked", true),
    inputBytes,
    capacity: route.capacity,
    blockers: forCapacity(route.capacity, route.estimateSnapshot === null),
    jobSpecSha256: null,
    cost: route.estimateSnapshot === null
      ? missingCloudCost()
      : suppliedCost(route.estimateSnapshot),
  }));
  return { local, cloud };
}

function compiledRouteResults(
  input: FoundryPlanPreviewInputV0,
  recipe: FoundryReconstructionRecipeV0,
  dossier: FoundryPlanOnlyDossierV0 | null,
): {
  readonly local: z.infer<typeof FoundryPlanPreviewLocalRouteResultSchema>[];
  readonly cloud: z.infer<typeof FoundryPlanPreviewCloudRouteResultSchema>[];
} {
  const candidateByRoute = new Map<string, FoundryPlanOnlyDossierV0["candidates"][number]>(
    (dossier?.candidates ?? []).map((candidate) => [
      `${candidate.providerKind}:${candidate.providerAdapterId}`,
      candidate,
    ] as const),
  );
  const bindingByRole = new Map(
    input.workerBindings.map((binding) => [binding.role, binding] as const),
  );
  const inputBytes = totalInputBytes(input.manifest);
  const localWorkerBlockers = requiredWorkerRoles(input.manifest, input.options)
    .filter((role) => bindingByRole.get(role)?.profile.localExecutionAllowed === false)
    .map((role) => {
      const code = `worker_profile_not_cleared_for_local:${role}`;
      return { code, explanation: explainRouteBlocker(code) };
    });
  const capacityBlockers = (
    capacity: z.infer<typeof FoundryPlanPreviewCapacityV0Schema>,
  ) => {
    const codes = new Set<string>();
    for (const stage of recipe.stages) {
      if (stage.cpuCores > capacity.cpuCores) codes.add(`${stage.id}:cpu_capacity_exceeded`);
      if (stage.ramGiB > capacity.ramGiB) codes.add(`${stage.id}:ram_capacity_exceeded`);
      if (stage.gpuCount > capacity.gpuCount) codes.add(`${stage.id}:gpu_count_exceeded`);
      if (stage.minimumGpuVramGiB > capacity.perGpuVramGiB) {
        codes.add(`${stage.id}:gpu_vram_exceeded`);
      }
      if (stage.scratchGiB > capacity.scratchGiB) {
        codes.add(`${stage.id}:scratch_capacity_exceeded`);
      }
    }
    if (inputBytes > capacity.maximumInputBytes) {
      codes.add("input_bytes_exceed_route_limit");
    }
    return [...codes].map((code) => ({ code, explanation: explainRouteBlocker(code) }));
  };
  const missingCandidateBlockers = (
    capacity: z.infer<typeof FoundryPlanPreviewCapacityV0Schema> | null,
    estimateMissing: boolean,
    localCpu: boolean,
  ) => dedupeRouteBlockers([
    ...(capacity === null
      ? [{
          code: "route_capacity_not_supplied",
          explanation: explainRouteBlocker("route_capacity_not_supplied"),
        }]
      : capacityBlockers(capacity)),
    ...(estimateMissing
      ? [{
          code: "provider_estimate_not_supplied",
          explanation: explainRouteBlocker("provider_estimate_not_supplied"),
        }]
      : []),
    ...(localCpu && recipe.stages.some((stage) => stage.gpuCount > 0)
      ? [{
          code: "local_cpu_cannot_run_gpu_stage",
          explanation: explainRouteBlocker("local_cpu_cannot_run_gpu_stage"),
        }]
      : []),
  ]);
  const local = input.localRoutes.map((route) => {
    const candidate = candidateByRoute.get(
      `${route.providerKind}:${route.providerAdapterId}`,
    );
    if (candidate === undefined && route.capacity !== null) {
      throw new FoundryIntegrityError(
        "PLAN_PREVIEW_ROUTE_MISSING",
        `The exact dossier omitted complete route ${route.providerKind}:${route.providerAdapterId}.`,
      );
    }
    const blockers = dedupeRouteBlockers([
      ...(candidate === undefined
        ? missingCandidateBlockers(
            route.capacity,
            false,
            route.providerKind === "local_cpu",
          )
        : candidate.blockers.map((code) => ({
            code,
            explanation: explainRouteBlocker(code),
          }))),
      ...localWorkerBlockers,
    ]);
    const status = blockers.length === 0 ? "plan_available" as const : "blocked" as const;
    return {
      location: "this_computer" as const,
      providerKind: route.providerKind,
      providerAdapterId: route.providerAdapterId,
      heading: providerHeading(route.providerKind),
      status,
      plainLanguageStatus: routeStatusText(status, false),
      inputBytes: candidate?.inputBytes ?? inputBytes,
      capacity: route.capacity,
      blockers,
      jobSpecSha256: candidate?.jobSpecSha256 ?? null,
      cost: noLocalCost(),
    };
  });
  const cloud = input.remoteRoutes.map((route) => {
    const candidate = candidateByRoute.get(
      `${route.providerKind}:${route.providerAdapterId}`,
    );
    const complete = route.capacity !== null && route.estimateSnapshot !== null;
    if (candidate === undefined && complete) {
      throw new FoundryIntegrityError(
        "PLAN_PREVIEW_ROUTE_MISSING",
        `The exact dossier omitted complete route ${route.providerKind}:${route.providerAdapterId}.`,
      );
    }
    const blockers = candidate === undefined
      ? missingCandidateBlockers(route.capacity, route.estimateSnapshot === null, false)
      : candidate.blockers.map((code) => ({
          code,
          explanation: explainRouteBlocker(code),
        }));
    const status = blockers.length === 0 ? "plan_available" as const : "blocked" as const;
    return {
      location: "cloud" as const,
      providerKind: route.providerKind,
      providerAdapterId: route.providerAdapterId,
      heading: providerHeading(route.providerKind),
      status,
      plainLanguageStatus: routeStatusText(status, true),
      inputBytes: candidate?.inputBytes ?? inputBytes,
      capacity: route.capacity,
      blockers,
      jobSpecSha256: candidate?.jobSpecSha256 ?? null,
      cost: route.estimateSnapshot === null
        ? missingCloudCost()
        : suppliedCost(route.estimateSnapshot),
    };
  });
  return { local, cloud };
}

function truthOutputStageIds(recipe: FoundryReconstructionRecipeV0): {
  readonly measuredEligibleCapturedDerivatives: string[];
  readonly capturedDerivatives: string[];
  readonly enhancedCapturedDerivatives: string[];
  readonly aiGeneratedDerivatives: string[];
  readonly mixedCandidates: string[];
} {
  return {
    measuredEligibleCapturedDerivatives: sortedUnique(
      recipe.outputs
        .filter(
          (output) =>
            output.derivativeClass === "captured_derived" &&
            output.mayEnterMeasuredGeometry,
        )
        .map((output) => output.stageId),
    ),
    capturedDerivatives: sortedUnique(
      recipe.outputs
        .filter((output) => output.derivativeClass === "captured_derived")
        .map((output) => output.stageId),
    ),
    enhancedCapturedDerivatives: sortedUnique(
      recipe.outputs
        .filter((output) => output.derivativeClass === "enhanced_captured_derived")
        .map((output) => output.stageId),
    ),
    aiGeneratedDerivatives: sortedUnique(
      recipe.outputs
        .filter((output) => output.derivativeClass === "ai_derived")
        .map((output) => output.stageId),
    ),
    mixedCandidates: sortedUnique(
      recipe.outputs
        .filter((output) => output.derivativeClass === "mixed_candidate")
        .map((output) => output.stageId),
    ),
  };
}

function truthSeparation(
  manifest: FoundryIngestManifestV0,
  recipe: FoundryReconstructionRecipeV0 | null,
): z.infer<typeof FoundryPlanPreviewTruthSeparationSchema> {
  const byClass = (provenanceClass: FoundryIngestManifestV0["assets"][number]["provenanceClass"]) =>
    sortedUnique(
      manifest.assets
        .filter((asset) => asset.provenanceClass === provenanceClass)
        .map((asset) => asset.id),
    );
  return {
    sourceAssetIds: {
      captured: byClass("captured"),
      enhancedCaptured: byClass("enhanced_captured"),
      generatedCinematic: byClass("generated_cinematic"),
      conceptImagination: byClass("concept_imagination"),
    },
    measuredCoordinateFrameIds: sortedUnique(
      manifest.coordinateFrames
        .filter((frame) => frame.authority === "measured")
        .map((frame) => frame.id),
    ),
    outputPlanningState: recipe === null
      ? "not_compiled_planning_gate_blocked"
      : "compiled",
    outputStageIds: recipe === null
      ? {
          measuredEligibleCapturedDerivatives: [],
          capturedDerivatives: [],
          enhancedCapturedDerivatives: [],
          aiGeneratedDerivatives: [],
          mixedCandidates: [],
        }
      : truthOutputStageIds(recipe),
    rules: {
      measured:
        "Only captured-derived outputs explicitly marked as measured-eligible may be reviewed for measured geometry. This preview grants no measurement authority.",
      captured:
        "Captured and enhanced-captured outputs remain separately labelled and distinct from AI-generated material.",
      generated:
        "Enhanced-captured, AI-generated, and mixed outputs can never enter measured geometry and remain in isolated namespaces.",
    },
  };
}

function sortedRoutes<T extends { readonly providerKind: string; readonly providerAdapterId: string }>(
  routes: readonly T[],
): T[] {
  return [...routes].sort((left, right) =>
    compareCanonicalStrings(
      `${left.providerKind}:${left.providerAdapterId}`,
      `${right.providerKind}:${right.providerAdapterId}`,
    )
  );
}

function blockedHumanCopy(
  blockers: readonly z.infer<typeof FoundryPlanGateBlockerSchema>[],
): PreviewPayloadObject["human"] {
  if (
    blockers.length === 1 &&
    blockers[0]?.code === "proprietary_xgrids_xbin_decoder_not_verified"
  ) {
    return {
      headline: "Planning stopped: the raw XGRIDS file stays blocked",
      summary:
        "No recipe or job plan was created. The proprietary .xbin remains unchanged as evidence, and both this-computer and cloud routes are blocked.",
      nextAction: blockers[0].nextAction,
    };
  }
  return {
    headline: "Planning stopped before a recipe was created",
    summary:
      "No reconstruction worker was started, no external service or provider was contacted, and no job plan was released. Resolve every planning-gate item shown below before trying again.",
    nextAction:
      "Resolve every listed planning-gate item, then build a new preview from the reviewed admission result and matching manifest.",
  };
}

function compiledHumanCopy(
  routes: PreviewPayloadObject["routes"],
  hasDossier: boolean,
): PreviewPayloadObject["human"] {
  const localAvailable = routes.local.filter(
    (route) => route.status === "plan_available",
  ).length;
  const cloudAvailable = routes.cloud.filter(
    (route) => route.status === "plan_available",
  ).length;
  if (!hasDossier) {
    return {
      headline: "The recipe is ready, but route facts are missing",
      summary:
        "The exact reconstruction recipe was created, but no local or cloud route had both a trusted capacity record and every required provider price snapshot. No job dossier was created, and nothing was started.",
      nextAction:
        "Supply the missing capacity or cloud price snapshot shown on each route, then build a new preview. Do not enter a guessed value.",
    };
  }
  if (localAvailable + cloudAvailable === 0) {
    return {
      headline: "The recipe is ready, but every computing route is blocked",
      summary:
        "The exact recipe and plan-only dossier were created for review. Nothing was started, uploaded, changed, or purchased. Read each route's reasons before continuing.",
      nextAction:
        "Fix the listed capacity, worker, rights, price-snapshot, or spending-limit problem, then build a new preview.",
    };
  }
  const available = [
    ...(localAvailable > 0
      ? [`${String(localAvailable)} this-computer route${localAvailable === 1 ? "" : "s"}`]
      : []),
    ...(cloudAvailable > 0
      ? [`${String(cloudAvailable)} cloud route${cloudAvailable === 1 ? "" : "s"}`]
      : []),
  ].join(" and ");
  return {
    headline: "A safe planning preview is ready",
    summary:
      `The exact recipe and plan-only dossier were created, and ${available} passed the supplied planning checks. Nothing was started, uploaded, changed, or purchased.`,
    nextAction:
      "Review the truth-layer labels and every route. Starting real work still requires separate rights, compute, cost, and execution approvals.",
  };
}

function capabilities(): PreviewPayloadObject["capabilities"] {
  return {
    planning: "preview_only",
    execution: "not_authorized",
    processLaunch: "not_available",
    networkAccess: "not_available",
    providerSdk: "not_available",
    credentialAccess: "not_available",
    spend: "not_authorized",
    sourceMutation: "not_authorized",
    signing: "not_authorized",
    publication: "not_authorized",
    promotion: "not_authorized",
  };
}

/**
 * Purely compiles a human-readable planning preview. This function has no
 * filesystem, process, network, provider-SDK, credential, spending, execution,
 * signing, publication, or promotion capability.
 */
export function compileFoundryPlanPreview(
  inputValue: unknown,
): FoundryPlanPreviewV0 {
  const inputResult = FoundryPlanPreviewInputV0Schema.safeParse(inputValue);
  if (!inputResult.success) {
    throw new FoundryIntegrityError(
      "PLAN_PREVIEW_INPUT_INVALID",
      "The plan preview input is invalid. Supply only the reviewed admission result, its exact manifest, explicit options, trusted workers, capacities, and price snapshots.",
    );
  }
  const input = inputResult.data;
  if (
    input.admissionResult.manifestSha256 !==
      computeFoundryIngestManifestSha256(input.manifest) ||
    !equalCanonical(input.admissionResult.manifest, input.manifest)
  ) {
    throw new FoundryIntegrityError(
      "PLAN_PREVIEW_ADMISSION_MANIFEST_MISMATCH",
      "The supplied manifest is not the exact manifest bound by the admission result.",
    );
  }
  const workerProfileSha256s = sortedUnique(
    input.workerBindings.map((binding) =>
      computeFoundryTrustedWorkerProfileSha256(binding.profile)
    ),
  );
  const gateBlockers = planGateBlockers(
    input.manifest,
    input.options,
    input.workerBindings,
    input.createdAt,
  );
  if (gateBlockers.length > 0) {
    const routes = blockedRouteResults(input, gateBlockers);
    const payload = FoundryPlanPreviewPayloadV0Schema.parse({
      schemaVersion: FOUNDRY_PLAN_PREVIEW_V0,
      id: input.id,
      displayName: input.displayName,
      createdAt: input.createdAt,
      admissionResultSha256: input.admissionResult.resultSha256,
      ingestManifestSha256: input.admissionResult.manifestSha256,
      options: input.options,
      workerProfileSha256s,
      status: "blocked_before_recipe",
      planningGate: { status: "blocked", blockers: gateBlockers },
      truthSeparation: truthSeparation(input.manifest, null),
      routes: {
        local: sortedRoutes(routes.local),
        cloud: sortedRoutes(routes.cloud),
      },
      human: blockedHumanCopy(gateBlockers),
      exactArtifacts: {
        state: "withheld_planning_gate_blocked",
        reconstructionRecipe: null,
        planOnlyDossier: null,
      },
      authority: "none",
      capabilities: capabilities(),
    });
    return FoundryPlanPreviewV0Schema.parse({
      ...payload,
      previewSha256: computeFoundryPlanPreviewSha256(payload),
    });
  }

  const recipe = compileFoundryReconstructionRecipe({
    id: input.id,
    displayName: input.displayName,
    createdAt: input.createdAt,
    manifest: input.manifest,
    options: input.options,
    workerBindings: input.workerBindings,
  });
  const localPlanRoutes = input.localRoutes.flatMap((route) =>
    route.capacity === null ? [] : [{ ...route, capacity: route.capacity }]
  );
  const remotePlanRoutes = input.remoteRoutes.flatMap((route) =>
    route.capacity === null || route.estimateSnapshot === null
      ? []
      : [{
          ...route,
          capacity: route.capacity,
          estimateSnapshot: route.estimateSnapshot,
        }]
  );
  const dossier = localPlanRoutes.length + remotePlanRoutes.length === 0
    ? null
    : compileFoundryPlanOnlyDossier(
        FoundryPlanOnlyRequestV0Schema.parse({
          schemaVersion: FOUNDRY_PLAN_ONLY_REQUEST_V0,
          id: input.id,
          projectId: input.manifest.projectId,
          ingestManifestSha256: input.admissionResult.manifestSha256,
          createdAt: input.createdAt,
          recipe: toFoundryPlanOnlyRecipe(recipe),
          localRoutes: localPlanRoutes,
          remoteRoutes: remotePlanRoutes,
        }),
        input.manifest,
      );
  const routeResults = compiledRouteResults(input, recipe, dossier);
  const routes = {
    local: sortedRoutes(routeResults.local),
    cloud: sortedRoutes(routeResults.cloud),
  };
  const anyAvailable = [...routes.local, ...routes.cloud].some(
    (route) => route.status === "plan_available",
  );
  const payload = FoundryPlanPreviewPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_PLAN_PREVIEW_V0,
    id: input.id,
    displayName: input.displayName,
    createdAt: input.createdAt,
    admissionResultSha256: input.admissionResult.resultSha256,
    ingestManifestSha256: input.admissionResult.manifestSha256,
    options: input.options,
    workerProfileSha256s,
    status: anyAvailable ? "plan_available" : "all_routes_blocked",
    planningGate: { status: "clear", blockers: [] },
    truthSeparation: truthSeparation(input.manifest, recipe),
    routes,
    human: compiledHumanCopy(routes, dossier !== null),
    exactArtifacts: dossier === null
      ? {
          state: "recipe_compiled_routes_incomplete",
          reconstructionRecipe: recipe,
          planOnlyDossier: null,
        }
      : {
          state: "compiled",
          reconstructionRecipe: recipe,
          planOnlyDossier: dossier,
        },
    authority: "none",
    capabilities: capabilities(),
  });
  return FoundryPlanPreviewV0Schema.parse({
    ...payload,
    previewSha256: computeFoundryPlanPreviewSha256(payload),
  });
}

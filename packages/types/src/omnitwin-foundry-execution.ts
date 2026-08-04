import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  FoundryCanonicalActorSchema,
  FoundryCommandArgumentSchema,
  FoundryIngestManifestV0Schema,
  FoundryJobSpecV0Schema,
  FoundryProviderKindSchema,
  FoundryRightsPurposeSchema,
  FoundryUtcInstantSchema,
  computeFoundryIngestManifestSha256,
  computeFoundryJobSpecSha256,
  foundryUsdNumberToMicroUsd,
} from "./omnitwin-foundry.js";
import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "./runtime-venue-manifest.js";

/**
 * Immutable, provider-neutral execution-control contracts. These schemas carry
 * no provider credentials, provider response bodies, process handles, or
 * authority to start work. A durable control plane must still consume a
 * confirmation atomically before dispatch.
 */
export const FOUNDRY_EXECUTION_POLICY_V0 =
  "omnitwin.foundry.execution-policy.v0";
export const FOUNDRY_PROVIDER_PLAN_EVIDENCE_V0 =
  "omnitwin.foundry.provider-plan-evidence.v0";
export const FOUNDRY_EXECUTION_ENVELOPE_V0 =
  "omnitwin.foundry.execution-envelope.v0";
export const FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0 =
  "omnitwin.foundry.execution-envelope-confirmation.v0";
export const FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0 =
  "omnitwin.foundry.execution-envelope-compute-approval.v0";
export const FOUNDRY_TRUSTED_WORKER_PROFILE_V0 =
  "omnitwin.foundry.trusted-worker-profile.v0";
export const FOUNDRY_PROVIDER_DEPLOYMENT_EVIDENCE_V0 =
  "omnitwin.foundry.provider-deployment-evidence.v0";

/** PostgreSQL signed BIGINT ceiling; values remain exact across JSON boundaries. */
export const FOUNDRY_MAX_MICRO_USD = "9223372036854775807";
const FOUNDRY_MAX_MICRO_USD_BIGINT = BigInt(FOUNDRY_MAX_MICRO_USD);
const CANONICAL_MICRO_USD = /^(?:0|[1-9][0-9]{0,18})$/u;
const PINNED_ADAPTER_VERSION = /^(?:(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?|git-[a-f0-9]{40}|sha256-[a-f0-9]{64})$/u;
const MAX_DURATION_SECONDS = 31_536_000;

export const FoundryMicroUsdSchema = z
  .string()
  .regex(
    CANONICAL_MICRO_USD,
    "micro-USD must be a canonical unsigned base-10 integer string",
  )
  .refine(
    (value) =>
      CANONICAL_MICRO_USD.test(value) &&
      BigInt(value) <= FOUNDRY_MAX_MICRO_USD_BIGINT,
    `micro-USD must not exceed ${FOUNDRY_MAX_MICRO_USD}`,
  );
export type FoundryMicroUsd = z.infer<typeof FoundryMicroUsdSchema>;

export const FoundryProviderAdapterVersionSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    PINNED_ADAPTER_VERSION,
    "provider adapter version must be exact SemVer, git-<commit>, or sha256-<digest>",
  );
export type FoundryProviderAdapterVersion = z.infer<
  typeof FoundryProviderAdapterVersionSchema
>;

const DurationSecondsSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_DURATION_SECONDS);

const CanonicalActorSchema = FoundryCanonicalActorSchema;

function microUsd(value: FoundryMicroUsd): bigint {
  return BigInt(value);
}

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [...path],
    message,
  });
}

function isStrictlyAsciiSorted(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) {
      return false;
    }
  }
  return true;
}

export const FoundryExecutionPolicyV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_EXECUTION_POLICY_V0),
    policyId: RuntimeManifestKeySchema,
    maximumAttempts: z.literal(1),
    deterministicRetryDelaySeconds: z.tuple([]),
    maximumWallClockSeconds: DurationSecondsSchema,
    orchestrationOverheadSeconds: z.number().int().nonnegative().max(86_400),
    workerSelfDeadlineSeconds: DurationSecondsSchema,
    providerMaximumExecutionTtlSeconds: DurationSecondsSchema,
    dispatchWindowTtlSeconds: DurationSecondsSchema,
    leaseTtlSeconds: DurationSecondsSchema,
    heartbeatIntervalSeconds: DurationSecondsSchema,
    observationIntervalSeconds: DurationSecondsSchema,
    checkpointIntervalSeconds: DurationSecondsSchema.nullable(),
    cancelGracePeriodSeconds: DurationSecondsSchema,
    terminationGracePeriodSeconds: DurationSecondsSchema,
    terminationConfirmationTimeoutSeconds: DurationSecondsSchema,
    pricingSnapshotMaximumAgeSeconds: DurationSecondsSchema,
    costObservationMaximumAgeSeconds: DurationSecondsSchema,
    executionConfirmationTtlSeconds: DurationSecondsSchema,
    computeApprovalTtlSeconds: DurationSecondsSchema,
    costWarningMicroUsd: FoundryMicroUsdSchema,
    costHardStopMicroUsd: FoundryMicroUsdSchema,
    terminationReserveMicroUsd: FoundryMicroUsdSchema,
    absoluteCostCapMicroUsd: FoundryMicroUsdSchema,
  })
  .strict()
  .superRefine((policy, ctx) => {
    const warning = microUsd(policy.costWarningMicroUsd);
    const hardStop = microUsd(policy.costHardStopMicroUsd);
    const terminationReserve = microUsd(policy.terminationReserveMicroUsd);
    const absoluteCap = microUsd(policy.absoluteCostCapMicroUsd);
    if (warning >= hardStop) {
      addIssue(
        ctx,
        ["costWarningMicroUsd"],
        "cost warning must be lower than the hard-stop threshold",
      );
    }
    if (hardStop + terminationReserve > absoluteCap) {
      addIssue(
        ctx,
        ["absoluteCostCapMicroUsd"],
        "hard stop plus termination reserve must not exceed the absolute cost cap",
      );
    }
    if (policy.leaseTtlSeconds > policy.maximumWallClockSeconds) {
      addIssue(ctx, ["leaseTtlSeconds"], "lease TTL must not exceed wall-clock limit");
    }
    if (policy.heartbeatIntervalSeconds >= policy.leaseTtlSeconds) {
      addIssue(
        ctx,
        ["heartbeatIntervalSeconds"],
        "heartbeat interval must be lower than lease TTL",
      );
    }
    if (policy.observationIntervalSeconds >= policy.leaseTtlSeconds) {
      addIssue(
        ctx,
        ["observationIntervalSeconds"],
        "observation interval must be lower than lease TTL",
      );
    }
    if (
      policy.observationIntervalSeconds > policy.costObservationMaximumAgeSeconds
    ) {
      addIssue(
        ctx,
        ["costObservationMaximumAgeSeconds"],
        "cost freshness window must cover at least one observation interval",
      );
    }
    if (
      policy.checkpointIntervalSeconds !== null &&
      policy.checkpointIntervalSeconds > policy.maximumWallClockSeconds
    ) {
      addIssue(
        ctx,
        ["checkpointIntervalSeconds"],
        "checkpoint interval must not exceed wall-clock limit",
      );
    }
    const workerDeadlineMinimum =
      policy.maximumWallClockSeconds +
      policy.cancelGracePeriodSeconds +
      policy.terminationGracePeriodSeconds;
    if (workerDeadlineMinimum > policy.workerSelfDeadlineSeconds) {
      addIssue(
        ctx,
        ["workerSelfDeadlineSeconds"],
        "worker self-deadline must cover wall clock, cancel grace, and termination grace",
      );
    }
    if (
      policy.workerSelfDeadlineSeconds +
        policy.terminationConfirmationTimeoutSeconds >
      policy.providerMaximumExecutionTtlSeconds
    ) {
      addIssue(
        ctx,
        ["providerMaximumExecutionTtlSeconds"],
        "provider execution TTL must cover the worker deadline and termination-confirmation timeout",
      );
    }
    if (
      policy.executionConfirmationTtlSeconds > policy.dispatchWindowTtlSeconds
    ) {
      addIssue(
        ctx,
        ["executionConfirmationTtlSeconds"],
        "confirmation TTL must not exceed the dispatch window TTL",
      );
    }
    if (policy.computeApprovalTtlSeconds > policy.dispatchWindowTtlSeconds) {
      addIssue(
        ctx,
        ["computeApprovalTtlSeconds"],
        "compute-approval TTL must not exceed the dispatch window TTL",
      );
    }
  });
export type FoundryExecutionPolicyV0 = z.infer<
  typeof FoundryExecutionPolicyV0Schema
>;

export const FOUNDRY_WORKER_OPERATION_CLASSES = [
  "read_only_inspection",
  "deterministic_transformation",
  "model_inference",
  "model_training",
  "redistribution_packaging",
  "public_release",
] as const;
export const FoundryWorkerOperationClassSchema = z.enum(
  FOUNDRY_WORKER_OPERATION_CLASSES,
);
export type FoundryWorkerOperationClass = z.infer<
  typeof FoundryWorkerOperationClassSchema
>;

const EXECUTION_CONTAINER_IMAGE =
  /^[a-z0-9][a-z0-9._/:@-]*@sha256:[a-f0-9]{64}$/u;

const REQUIRED_RIGHT_BY_OPERATION: Readonly<
  Record<FoundryWorkerOperationClass, z.infer<typeof FoundryRightsPurposeSchema>>
> = {
  read_only_inspection: "commercial_internal_use",
  deterministic_transformation: "commercial_internal_use",
  model_inference: "commercial_internal_use",
  model_training: "model_training",
  redistribution_packaging: "redistribution",
  public_release: "public_release",
};

export const FoundryTrustedWorkerProfileV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_TRUSTED_WORKER_PROFILE_V0),
    profileId: RuntimeManifestKeySchema,
    profileVersion: RuntimeManifestKeySchema,
    operationClass: FoundryWorkerOperationClassSchema,
    containerImage: z.string().max(512).regex(EXECUTION_CONTAINER_IMAGE),
    command: z.array(FoundryCommandArgumentSchema).min(1).max(1_000),
    networkAccess: z.enum(["none", "object_storage_only", "restricted"]),
    localExecutionAllowed: z.boolean(),
    reviewedBy: CanonicalActorSchema,
    reviewedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (Date.parse(profile.reviewedAt) >= Date.parse(profile.expiresAt)) {
      addIssue(ctx, ["expiresAt"], "worker profile must expire after review");
    }
    if (
      (profile.operationClass === "model_training" ||
        profile.operationClass === "public_release") &&
      profile.localExecutionAllowed
    ) {
      addIssue(
        ctx,
        ["localExecutionAllowed"],
        "model training and public release cannot be approved for local execution",
      );
    }
  });
export type FoundryTrustedWorkerProfileV0 = z.infer<
  typeof FoundryTrustedWorkerProfileV0Schema
>;

export const FoundryProviderCapacityClassV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    cpuCores: z.number().int().positive().max(1_024),
    ramGiB: z.number().int().positive().max(100_000),
    gpuCount: z.number().int().nonnegative().max(128),
    perGpuVramGiB: z.number().int().nonnegative().max(1_000),
    scratchGiB: z.number().int().positive().max(1_000_000),
  })
  .strict()
  .superRefine((capacity, ctx) => {
    if (capacity.gpuCount === 0 && capacity.perGpuVramGiB !== 0) {
      addIssue(ctx, ["perGpuVramGiB"], "CPU capacity cannot advertise GPU VRAM");
    }
  });
export type FoundryProviderCapacityClassV0 = z.infer<
  typeof FoundryProviderCapacityClassV0Schema
>;

export const FoundryProviderDeploymentEvidenceV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PROVIDER_DEPLOYMENT_EVIDENCE_V0),
    deploymentId: RuntimeManifestKeySchema,
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterVersion: FoundryProviderAdapterVersionSchema,
    providerAdapterArtifactSha256: RuntimeSha256Schema,
    accountProjectAlias: RuntimeManifestKeySchema,
    region: RuntimeManifestKeySchema,
    dataResidency: RuntimeManifestKeySchema,
    observedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
    capacityClasses: z.array(FoundryProviderCapacityClassV0Schema).min(1).max(1_000),
  })
  .strict()
  .superRefine((deployment, ctx) => {
    if (Date.parse(deployment.observedAt) >= Date.parse(deployment.expiresAt)) {
      addIssue(ctx, ["expiresAt"], "provider deployment must expire after observation");
    }
    const capacityIds = deployment.capacityClasses.map((capacity) => capacity.id);
    if (!isStrictlyAsciiSorted(capacityIds)) {
      addIssue(
        ctx,
        ["capacityClasses"],
        "provider capacity classes must be unique and sorted by canonical ID",
      );
    }
  });
export type FoundryProviderDeploymentEvidenceV0 = z.infer<
  typeof FoundryProviderDeploymentEvidenceV0Schema
>;

export const FoundryProviderStagePlanEvidenceSchema = z
  .object({
    stageId: RuntimeManifestKeySchema,
    capacityClass: RuntimeManifestKeySchema,
    workerProfileSha256: RuntimeSha256Schema,
    estimatedCostMicroUsd: FoundryMicroUsdSchema,
    maximumRuntimeSeconds: DurationSecondsSchema,
  })
  .strict();
export type FoundryProviderStagePlanEvidence = z.infer<
  typeof FoundryProviderStagePlanEvidenceSchema
>;

export const FoundryProviderPlanEvidenceV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PROVIDER_PLAN_EVIDENCE_V0),
    executionIntent: z.literal("execute"),
    authority: z.literal("none"),
    planId: RuntimeManifestKeySchema,
    jobId: RuntimeManifestKeySchema,
    jobSpecSha256: RuntimeSha256Schema,
    reviewedIngestManifestSha256: RuntimeSha256Schema,
    intakeAdmissionResultSha256: RuntimeSha256Schema,
    intakeStagingIndexSha256: RuntimeSha256Schema,
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterVersion: FoundryProviderAdapterVersionSchema,
    providerAdapterArtifactSha256: RuntimeSha256Schema,
    providerDeploymentSha256: RuntimeSha256Schema,
    pricingCurrency: z.literal("USD"),
    pricingBasis: z.enum(["fixed_quote", "metered_estimate"]),
    pricingSnapshotSha256: RuntimeSha256Schema,
    pricingSnapshotObservedAt: FoundryUtcInstantSchema,
    pricingSnapshotExpiresAt: FoundryUtcInstantSchema,
    plannedAt: FoundryUtcInstantSchema,
    estimatedCostMicroUsd: FoundryMicroUsdSchema,
    stages: z.array(FoundryProviderStagePlanEvidenceSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const observedAt = Date.parse(plan.pricingSnapshotObservedAt);
    const plannedAt = Date.parse(plan.plannedAt);
    const expiresAt = Date.parse(plan.pricingSnapshotExpiresAt);
    if (observedAt > plannedAt) {
      addIssue(
        ctx,
        ["pricingSnapshotObservedAt"],
        "pricing snapshot must be observed no later than planning",
      );
    }
    if (plannedAt >= expiresAt) {
      addIssue(
        ctx,
        ["pricingSnapshotExpiresAt"],
        "pricing snapshot must remain valid after planning",
      );
    }
    const stageIds = plan.stages.map((stage) => stage.stageId);
    if (!isStrictlyAsciiSorted(stageIds)) {
      addIssue(
        ctx,
        ["stages"],
        "provider stages must be unique and sorted by canonical stage ID",
      );
    }
    const stageTotal = plan.stages.reduce(
      (total, stage) => total + microUsd(stage.estimatedCostMicroUsd),
      0n,
    );
    if (stageTotal !== microUsd(plan.estimatedCostMicroUsd)) {
      addIssue(
        ctx,
        ["estimatedCostMicroUsd"],
        "provider-plan cost must equal the exact sum of stage estimates",
      );
    }
  });
export type FoundryProviderPlanEvidenceV0 = z.infer<
  typeof FoundryProviderPlanEvidenceV0Schema
>;

export const FoundryExecutionEnvelopeV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_EXECUTION_ENVELOPE_V0),
    executionIntent: z.literal("execute"),
    authority: z.literal("none"),
    envelopeId: RuntimeManifestKeySchema,
    jobId: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    jobSpecSha256: RuntimeSha256Schema,
    providerPlanSha256: RuntimeSha256Schema,
    reviewedIngestManifestSha256: RuntimeSha256Schema,
    intakeAdmissionResultSha256: RuntimeSha256Schema,
    intakeStagingIndexSha256: RuntimeSha256Schema,
    executionPolicySha256: RuntimeSha256Schema,
    computeApprovalId: RuntimeManifestKeySchema.nullable(),
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterVersion: FoundryProviderAdapterVersionSchema,
    providerAdapterArtifactSha256: RuntimeSha256Schema,
    providerDeploymentSha256: RuntimeSha256Schema,
    pricingCurrency: z.literal("USD"),
    pricingSnapshotSha256: RuntimeSha256Schema,
    pricingSnapshotExpiresAt: FoundryUtcInstantSchema,
    createdAt: FoundryUtcInstantSchema,
    dispatchDeadline: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((envelope, ctx) => {
    const createdAt = Date.parse(envelope.createdAt);
    const dispatchDeadline = Date.parse(envelope.dispatchDeadline);
    const pricingExpiresAt = Date.parse(envelope.pricingSnapshotExpiresAt);
    if (createdAt >= dispatchDeadline) {
      addIssue(
        ctx,
        ["dispatchDeadline"],
        "dispatch deadline must be later than envelope creation",
      );
    }
    if (dispatchDeadline > pricingExpiresAt) {
      addIssue(
        ctx,
        ["dispatchDeadline"],
        "dispatch deadline must not outlive the bound pricing snapshot",
      );
    }
    const local =
      envelope.providerKind === "local_cpu" ||
      envelope.providerKind === "local_cuda";
    if (local !== (envelope.computeApprovalId === null)) {
      addIssue(
        ctx,
        ["computeApprovalId"],
        "local envelopes forbid and remote envelopes require a compute-approval ID",
      );
    }
  });
export type FoundryExecutionEnvelopeV0 = z.infer<
  typeof FoundryExecutionEnvelopeV0Schema
>;

function domainSeparatedDigest(domain: string, input: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(input);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

export function computeFoundryExecutionPolicySha256(input: unknown): string {
  const policy = FoundryExecutionPolicyV0Schema.parse(input);
  return domainSeparatedDigest(FOUNDRY_EXECUTION_POLICY_V0, policy);
}

export function computeFoundryProviderPlanEvidenceSha256(input: unknown): string {
  const plan = FoundryProviderPlanEvidenceV0Schema.parse(input);
  return domainSeparatedDigest(FOUNDRY_PROVIDER_PLAN_EVIDENCE_V0, plan);
}

export function computeFoundryTrustedWorkerProfileSha256(input: unknown): string {
  const profile = FoundryTrustedWorkerProfileV0Schema.parse(input);
  return domainSeparatedDigest(FOUNDRY_TRUSTED_WORKER_PROFILE_V0, profile);
}

export function computeFoundryProviderDeploymentEvidenceSha256(
  input: unknown,
): string {
  const deployment = FoundryProviderDeploymentEvidenceV0Schema.parse(input);
  return domainSeparatedDigest(
    FOUNDRY_PROVIDER_DEPLOYMENT_EVIDENCE_V0,
    deployment,
  );
}

export function computeFoundryExecutionEnvelopeSha256(input: unknown): string {
  const envelope = FoundryExecutionEnvelopeV0Schema.parse(input);
  return domainSeparatedDigest(FOUNDRY_EXECUTION_ENVELOPE_V0, envelope);
}

export type FoundryExecutionEnvelopeBindingDecision =
  | { valid: true }
  | {
      valid: false;
      reason:
        | "invalid_execution_binding_input"
        | "job_not_executable"
        | "job_spec_digest_mismatch"
        | "job_spec_identity_mismatch"
        | "reviewed_ingest_manifest_digest_mismatch"
        | "execution_policy_digest_mismatch"
        | "provider_plan_digest_mismatch"
        | "provider_plan_subject_mismatch"
        | "provider_plan_stage_mismatch"
        | "worker_profile_subject_mismatch"
        | "worker_operation_rights_mismatch"
        | "local_worker_profile_forbidden"
        | "provider_binding_mismatch"
        | "provider_deployment_mismatch"
        | "provider_capacity_insufficient"
        | "pricing_binding_mismatch"
        | "provider_plan_predates_job"
        | "provider_plan_created_after_envelope"
        | "pricing_snapshot_too_old"
        | "dispatch_window_exceeds_policy"
        | "provider_stage_runtime_exceeds_policy"
        | "provider_critical_path_exceeds_policy"
        | "job_budget_not_exact_micro_usd"
        | "provider_plan_estimate_mismatch"
        | "provider_plan_exceeds_job_budget"
        | "execution_policy_exceeds_job_budget"
        | "estimated_cost_reaches_hard_stop";
    };

export interface FoundryExecutionEnvelopeBindingContext {
  readonly jobSpec: unknown;
  readonly ingestManifest: unknown;
  /** Must be derived by the durable service from the exact parsed admission result. */
  readonly intakeAdmissionResultSha256: unknown;
  /** Must be derived by the durable service from the exact parsed staging index. */
  readonly intakeStagingIndexSha256: unknown;
  readonly executionPolicy: unknown;
  readonly providerPlanEvidence: unknown;
  readonly trustedWorkerProfiles: readonly unknown[];
  readonly providerDeploymentEvidence: unknown;
}

/**
 * Resolves every duplicated envelope fact against its exact evidence object.
 * Callers must supply the exact trusted JobSpec and reviewed-manifest digest.
 */
export function validateFoundryExecutionEnvelopeBindings(
  envelopeInput: unknown,
  context: FoundryExecutionEnvelopeBindingContext,
): FoundryExecutionEnvelopeBindingDecision {
  const envelopeResult = FoundryExecutionEnvelopeV0Schema.safeParse(envelopeInput);
  const policyResult = FoundryExecutionPolicyV0Schema.safeParse(
    context.executionPolicy,
  );
  const planResult = FoundryProviderPlanEvidenceV0Schema.safeParse(
    context.providerPlanEvidence,
  );
  const jobResult = FoundryJobSpecV0Schema.safeParse(context.jobSpec);
  const manifestResult = FoundryIngestManifestV0Schema.safeParse(
    context.ingestManifest,
  );
  const intakeAdmissionResultSha256Result = RuntimeSha256Schema.safeParse(
    context.intakeAdmissionResultSha256,
  );
  const intakeStagingIndexSha256Result = RuntimeSha256Schema.safeParse(
    context.intakeStagingIndexSha256,
  );
  const deploymentResult = FoundryProviderDeploymentEvidenceV0Schema.safeParse(
    context.providerDeploymentEvidence,
  );
  const profileResults = context.trustedWorkerProfiles.map((profile) =>
    FoundryTrustedWorkerProfileV0Schema.safeParse(profile)
  );
  if (
    !envelopeResult.success ||
    !policyResult.success ||
    !planResult.success ||
    !jobResult.success ||
    !manifestResult.success ||
    !intakeAdmissionResultSha256Result.success ||
    !intakeStagingIndexSha256Result.success ||
    !deploymentResult.success ||
    profileResults.some((result) => !result.success)
  ) {
    return { valid: false, reason: "invalid_execution_binding_input" };
  }
  const envelope = envelopeResult.data;
  const policy = policyResult.data;
  const plan = planResult.data;
  const job = jobResult.data;
  const manifest = manifestResult.data;
  const deployment = deploymentResult.data;
  const profiles = profileResults.map((result) => {
    if (!result.success) throw new Error("unreachable worker-profile parse failure");
    return result.data;
  });
  if (job.executionIntent !== "execute") {
    return { valid: false, reason: "job_not_executable" };
  }
  if (envelope.jobSpecSha256 !== computeFoundryJobSpecSha256(job)) {
    return { valid: false, reason: "job_spec_digest_mismatch" };
  }
  if (
    envelope.jobId !== job.id ||
    envelope.projectId !== job.projectId ||
    envelope.providerKind !== job.providerKind ||
    envelope.providerAdapterId !== job.providerAdapterId ||
    envelope.computeApprovalId !== job.computeApprovalId
  ) {
    return { valid: false, reason: "job_spec_identity_mismatch" };
  }
  const manifestSha256 = computeFoundryIngestManifestSha256(manifest);
  if (
    manifest.projectId !== job.projectId ||
    envelope.reviewedIngestManifestSha256 !== manifestSha256 ||
    job.ingestManifestSha256 !== manifestSha256
  ) {
    return {
      valid: false,
      reason: "reviewed_ingest_manifest_digest_mismatch",
    };
  }
  if (
    envelope.executionPolicySha256 !==
    computeFoundryExecutionPolicySha256(policy)
  ) {
    return { valid: false, reason: "execution_policy_digest_mismatch" };
  }
  if (
    envelope.providerPlanSha256 !==
    computeFoundryProviderPlanEvidenceSha256(plan)
  ) {
    return { valid: false, reason: "provider_plan_digest_mismatch" };
  }
  if (
    plan.jobId !== envelope.jobId ||
    plan.jobSpecSha256 !== envelope.jobSpecSha256 ||
    plan.reviewedIngestManifestSha256 !==
      envelope.reviewedIngestManifestSha256 ||
    plan.intakeAdmissionResultSha256 !==
      envelope.intakeAdmissionResultSha256 ||
    plan.intakeStagingIndexSha256 !== envelope.intakeStagingIndexSha256 ||
    envelope.intakeAdmissionResultSha256 !==
      intakeAdmissionResultSha256Result.data ||
    envelope.intakeStagingIndexSha256 !== intakeStagingIndexSha256Result.data
  ) {
    return { valid: false, reason: "provider_plan_subject_mismatch" };
  }
  const expectedStageIds = new Set(job.stages.map((stage) => stage.id));
  if (
    plan.stages.length !== expectedStageIds.size ||
    plan.stages.some((stage) => !expectedStageIds.has(stage.stageId))
  ) {
    return { valid: false, reason: "provider_plan_stage_mismatch" };
  }
  if (
    plan.providerKind !== envelope.providerKind ||
    plan.providerAdapterId !== envelope.providerAdapterId ||
    plan.providerAdapterVersion !== envelope.providerAdapterVersion ||
    plan.providerAdapterArtifactSha256 !==
      envelope.providerAdapterArtifactSha256 ||
    plan.providerDeploymentSha256 !== envelope.providerDeploymentSha256
  ) {
    return { valid: false, reason: "provider_binding_mismatch" };
  }
  if (
    computeFoundryProviderDeploymentEvidenceSha256(deployment) !==
      envelope.providerDeploymentSha256 ||
    deployment.providerKind !== envelope.providerKind ||
    deployment.providerAdapterId !== envelope.providerAdapterId ||
    deployment.providerAdapterVersion !== envelope.providerAdapterVersion ||
    deployment.providerAdapterArtifactSha256 !==
      envelope.providerAdapterArtifactSha256
  ) {
    return { valid: false, reason: "provider_deployment_mismatch" };
  }
  if (
    plan.pricingSnapshotSha256 !== envelope.pricingSnapshotSha256 ||
    plan.pricingSnapshotExpiresAt !== envelope.pricingSnapshotExpiresAt
  ) {
    return { valid: false, reason: "pricing_binding_mismatch" };
  }
  const createdAt = Date.parse(envelope.createdAt);
  const jobCreatedAt = Date.parse(job.createdAt);
  const plannedAt = Date.parse(plan.plannedAt);
  if (createdAt < Date.parse(job.createdAt)) {
    return { valid: false, reason: "job_spec_identity_mismatch" };
  }
  if (plannedAt < jobCreatedAt) {
    return { valid: false, reason: "provider_plan_predates_job" };
  }
  if (plannedAt > createdAt) {
    return { valid: false, reason: "provider_plan_created_after_envelope" };
  }
  if (
    Date.parse(deployment.observedAt) > plannedAt ||
    Date.parse(deployment.expiresAt) < Date.parse(envelope.dispatchDeadline)
  ) {
    return { valid: false, reason: "provider_deployment_mismatch" };
  }
  if (
    createdAt - Date.parse(plan.pricingSnapshotObservedAt) >
    policy.pricingSnapshotMaximumAgeSeconds * 1_000
  ) {
    return { valid: false, reason: "pricing_snapshot_too_old" };
  }

  const profileBySha256 = new Map<string, FoundryTrustedWorkerProfileV0>();
  for (const profile of profiles) {
    const digest = computeFoundryTrustedWorkerProfileSha256(profile);
    if (profileBySha256.has(digest)) {
      return { valid: false, reason: "worker_profile_subject_mismatch" };
    }
    profileBySha256.set(digest, profile);
  }
  const capacityById = new Map(
    deployment.capacityClasses.map((capacity) => [capacity.id, capacity]),
  );
  const planStageById = new Map(
    plan.stages.map((stage) => [stage.stageId, stage]),
  );
  const local =
    envelope.providerKind === "local_cpu" ||
    envelope.providerKind === "local_cuda";
  for (const stage of job.stages) {
    const stagePlan = planStageById.get(stage.id);
    const profile = stagePlan === undefined
      ? undefined
      : profileBySha256.get(stagePlan.workerProfileSha256);
    if (
      stagePlan === undefined ||
      profile === undefined ||
      profile.containerImage !== stage.containerImage ||
      stableCanonicalJson(CanonicalJsonValueSchema.parse(profile.command)) !==
        stableCanonicalJson(CanonicalJsonValueSchema.parse(stage.command)) ||
      profile.networkAccess !== stage.networkAccess ||
      Date.parse(profile.reviewedAt) > plannedAt ||
      Date.parse(profile.expiresAt) < Date.parse(envelope.dispatchDeadline)
    ) {
      return { valid: false, reason: "worker_profile_subject_mismatch" };
    }
    const requiredRight = REQUIRED_RIGHT_BY_OPERATION[profile.operationClass];
    if (!stage.rightsPurposes.includes(requiredRight)) {
      return { valid: false, reason: "worker_operation_rights_mismatch" };
    }
    if (local && !profile.localExecutionAllowed) {
      return { valid: false, reason: "local_worker_profile_forbidden" };
    }
    const capacity = capacityById.get(stagePlan.capacityClass);
    if (
      capacity === undefined ||
      stage.cpuCores > capacity.cpuCores ||
      stage.ramGiB > capacity.ramGiB ||
      stage.gpuCount > capacity.gpuCount ||
      stage.minimumGpuVramGiB > capacity.perGpuVramGiB ||
      stage.scratchGiB > capacity.scratchGiB
    ) {
      return { valid: false, reason: "provider_capacity_insufficient" };
    }
  }
  const usedWorkerProfileSha256 = new Set(
    plan.stages.map((stage) => stage.workerProfileSha256),
  );
  if (
    usedWorkerProfileSha256.size !== profileBySha256.size ||
    [...profileBySha256.keys()].some(
      (digest) => !usedWorkerProfileSha256.has(digest),
    )
  ) {
    return { valid: false, reason: "worker_profile_subject_mismatch" };
  }

  const jobEstimateMicroUsd = foundryUsdNumberToMicroUsd(job.estimatedCostUsd);
  const jobBudgetMicroUsd = foundryUsdNumberToMicroUsd(job.budgetCapUsd);
  if (jobEstimateMicroUsd === null || jobBudgetMicroUsd === null) {
    return { valid: false, reason: "job_budget_not_exact_micro_usd" };
  }
  if (plan.estimatedCostMicroUsd !== jobEstimateMicroUsd) {
    return { valid: false, reason: "provider_plan_estimate_mismatch" };
  }
  if (microUsd(plan.estimatedCostMicroUsd) > BigInt(jobBudgetMicroUsd)) {
    return { valid: false, reason: "provider_plan_exceeds_job_budget" };
  }
  if (
    microUsd(policy.absoluteCostCapMicroUsd) > BigInt(jobBudgetMicroUsd) ||
    microUsd(policy.costHardStopMicroUsd) +
      microUsd(policy.terminationReserveMicroUsd) >
      BigInt(jobBudgetMicroUsd)
  ) {
    return { valid: false, reason: "execution_policy_exceeds_job_budget" };
  }

  const criticalPathByStage = new Map<string, number>();
  const criticalPath = (stageId: string): number => {
    const cached = criticalPathByStage.get(stageId);
    if (cached !== undefined) return cached;
    const stage = job.stages.find((candidate) => candidate.id === stageId);
    const stagePlan = planStageById.get(stageId);
    if (stage === undefined || stagePlan === undefined) return Number.POSITIVE_INFINITY;
    const dependencyMaximum = stage.dependsOn.reduce(
      (maximum, dependencyId) => Math.max(maximum, criticalPath(dependencyId)),
      0,
    );
    const result = dependencyMaximum + stagePlan.maximumRuntimeSeconds;
    criticalPathByStage.set(stageId, result);
    return result;
  };
  const maximumCriticalPathSeconds = job.stages.reduce(
    (maximum, stage) => Math.max(maximum, criticalPath(stage.id)),
    0,
  );
  if (
    maximumCriticalPathSeconds + policy.orchestrationOverheadSeconds >
    policy.maximumWallClockSeconds
  ) {
    return { valid: false, reason: "provider_critical_path_exceeds_policy" };
  }
  if (
    Date.parse(envelope.dispatchDeadline) - createdAt >
    policy.dispatchWindowTtlSeconds * 1_000
  ) {
    return { valid: false, reason: "dispatch_window_exceeds_policy" };
  }
  if (
    plan.stages.some(
      (stage) => stage.maximumRuntimeSeconds > policy.maximumWallClockSeconds,
    )
  ) {
    return {
      valid: false,
      reason: "provider_stage_runtime_exceeds_policy",
    };
  }
  if (
    microUsd(plan.estimatedCostMicroUsd) >=
    microUsd(policy.costHardStopMicroUsd)
  ) {
    return { valid: false, reason: "estimated_cost_reaches_hard_stop" };
  }
  return { valid: true };
}

export const FoundryExecutionEnvelopeConfirmationV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0),
    confirmationId: RuntimeManifestKeySchema,
    executionEnvelopeSha256: RuntimeSha256Schema,
    jobSpecSha256: RuntimeSha256Schema,
    jobId: RuntimeManifestKeySchema,
    confirmedBy: CanonicalActorSchema,
    confirmedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((confirmation, ctx) => {
    if (Date.parse(confirmation.confirmedAt) >= Date.parse(confirmation.expiresAt)) {
      addIssue(
        ctx,
        ["expiresAt"],
        "execution-envelope confirmation must expire after it is recorded",
      );
    }
  });
export type FoundryExecutionEnvelopeConfirmationV0 = z.infer<
  typeof FoundryExecutionEnvelopeConfirmationV0Schema
>;

export const FoundryExecutionEnvelopeComputeApprovalV0Schema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0,
    ),
    approvalId: RuntimeManifestKeySchema,
    executionEnvelopeSha256: RuntimeSha256Schema,
    jobSpecSha256: RuntimeSha256Schema,
    jobId: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterVersion: FoundryProviderAdapterVersionSchema,
    providerAdapterArtifactSha256: RuntimeSha256Schema,
    providerDeploymentSha256: RuntimeSha256Schema,
    maximumCostMicroUsd: FoundryMicroUsdSchema,
    approvedBy: CanonicalActorSchema,
    approvedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((approval, ctx) => {
    if (Date.parse(approval.approvedAt) >= Date.parse(approval.expiresAt)) {
      addIssue(
        ctx,
        ["expiresAt"],
        "execution-envelope compute approval must expire after it is granted",
      );
    }
  });
export type FoundryExecutionEnvelopeComputeApprovalV0 = z.infer<
  typeof FoundryExecutionEnvelopeComputeApprovalV0Schema
>;

export function computeFoundryExecutionEnvelopeConfirmationSha256(
  input: unknown,
): string {
  const confirmation = FoundryExecutionEnvelopeConfirmationV0Schema.parse(input);
  return domainSeparatedDigest(
    FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0,
    confirmation,
  );
}

export function computeFoundryExecutionEnvelopeComputeApprovalSha256(
  input: unknown,
): string {
  const approval = FoundryExecutionEnvelopeComputeApprovalV0Schema.parse(input);
  return domainSeparatedDigest(
    FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0,
    approval,
  );
}

export type FoundryExecutionAuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "invalid_execution_authorization_input"
        | "invalid_authorization_time"
        | "job_spec_subject_mismatch"
        | "dispatch_deadline_reached"
        | "pricing_snapshot_expired"
        | "execution_policy_subject_mismatch"
        | "operator_confirmation_subject_mismatch"
        | "operator_confirmation_outside_validity_window"
        | "operator_confirmation_ttl_exceeds_policy"
        | "compute_approval_required"
        | "local_execution_compute_approval_forbidden"
        | "compute_approval_subject_mismatch"
        | "compute_approval_outside_validity_window"
        | "compute_approval_ttl_exceeds_policy"
        | "compute_approval_below_absolute_cap"
        | "compute_approval_exceeds_job_budget";
    };

/**
 * Pure authorization preflight only. Success neither validates JobSpec/provider
 * evidence bindings nor consumes the confirmation; dispatch must require a
 * successful binding decision and atomic single-use consumption as well.
 */
export function validateFoundryExecutionAuthorizations(
  envelopeInput: unknown,
  jobInput: unknown,
  policyInput: unknown,
  confirmationInput: unknown,
  computeApprovalInput: unknown,
  now: Date,
): FoundryExecutionAuthorizationDecision {
  const envelopeResult = FoundryExecutionEnvelopeV0Schema.safeParse(envelopeInput);
  const jobResult = FoundryJobSpecV0Schema.safeParse(jobInput);
  const policyResult = FoundryExecutionPolicyV0Schema.safeParse(policyInput);
  const confirmationResult =
    FoundryExecutionEnvelopeConfirmationV0Schema.safeParse(confirmationInput);
  if (
    !envelopeResult.success ||
    !jobResult.success ||
    !policyResult.success ||
    !confirmationResult.success
  ) {
    return { allowed: false, reason: "invalid_execution_authorization_input" };
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    return { allowed: false, reason: "invalid_authorization_time" };
  }
  const envelope = envelopeResult.data;
  const job = jobResult.data;
  const policy = policyResult.data;
  const confirmation = confirmationResult.data;
  if (
    job.executionIntent !== "execute" ||
    computeFoundryJobSpecSha256(job) !== envelope.jobSpecSha256 ||
    job.id !== envelope.jobId ||
    job.projectId !== envelope.projectId ||
    job.providerKind !== envelope.providerKind ||
    job.providerAdapterId !== envelope.providerAdapterId ||
    job.computeApprovalId !== envelope.computeApprovalId
  ) {
    return { allowed: false, reason: "job_spec_subject_mismatch" };
  }
  if (
    envelope.executionPolicySha256 !==
    computeFoundryExecutionPolicySha256(policy)
  ) {
    return { allowed: false, reason: "execution_policy_subject_mismatch" };
  }
  if (nowMs >= Date.parse(envelope.dispatchDeadline)) {
    return { allowed: false, reason: "dispatch_deadline_reached" };
  }
  if (nowMs >= Date.parse(envelope.pricingSnapshotExpiresAt)) {
    return { allowed: false, reason: "pricing_snapshot_expired" };
  }
  const envelopeSha256 = computeFoundryExecutionEnvelopeSha256(envelope);
  if (
    confirmation.executionEnvelopeSha256 !== envelopeSha256 ||
    confirmation.jobSpecSha256 !== envelope.jobSpecSha256 ||
    confirmation.jobId !== envelope.jobId
  ) {
    return {
      allowed: false,
      reason: "operator_confirmation_subject_mismatch",
    };
  }
  const confirmedAt = Date.parse(confirmation.confirmedAt);
  const confirmationExpiresAt = Date.parse(confirmation.expiresAt);
  if (
    confirmedAt < Date.parse(envelope.createdAt) ||
    confirmedAt > nowMs ||
    confirmationExpiresAt <= nowMs ||
    confirmationExpiresAt > Date.parse(envelope.dispatchDeadline)
  ) {
    return {
      allowed: false,
      reason: "operator_confirmation_outside_validity_window",
    };
  }
  if (
    confirmationExpiresAt - confirmedAt >
    policy.executionConfirmationTtlSeconds * 1_000
  ) {
    return {
      allowed: false,
      reason: "operator_confirmation_ttl_exceeds_policy",
    };
  }
  const local =
    envelope.providerKind === "local_cpu" ||
    envelope.providerKind === "local_cuda";
  if (local) {
    if (job.computeApprovalId !== null || computeApprovalInput !== null) {
      return {
        allowed: false,
        reason: "local_execution_compute_approval_forbidden",
      };
    }
    return { allowed: true };
  }
  if (computeApprovalInput === null) {
    return { allowed: false, reason: "compute_approval_required" };
  }
  const approvalResult =
    FoundryExecutionEnvelopeComputeApprovalV0Schema.safeParse(
      computeApprovalInput,
    );
  if (!approvalResult.success) {
    return { allowed: false, reason: "invalid_execution_authorization_input" };
  }
  const approval = approvalResult.data;
  if (
    approval.executionEnvelopeSha256 !== envelopeSha256 ||
    approval.approvalId !== envelope.computeApprovalId ||
    approval.approvalId !== job.computeApprovalId ||
    approval.jobSpecSha256 !== envelope.jobSpecSha256 ||
    approval.jobId !== envelope.jobId ||
    approval.projectId !== envelope.projectId ||
    approval.providerKind !== envelope.providerKind ||
    approval.providerAdapterId !== envelope.providerAdapterId ||
    approval.providerAdapterVersion !== envelope.providerAdapterVersion ||
    approval.providerAdapterArtifactSha256 !==
      envelope.providerAdapterArtifactSha256 ||
    approval.providerDeploymentSha256 !== envelope.providerDeploymentSha256
  ) {
    return { allowed: false, reason: "compute_approval_subject_mismatch" };
  }
  const approvedAt = Date.parse(approval.approvedAt);
  const approvalExpiresAt = Date.parse(approval.expiresAt);
  if (
    approvedAt < Date.parse(envelope.createdAt) ||
    approvedAt > nowMs ||
    approvalExpiresAt <= nowMs ||
    approvalExpiresAt > Date.parse(envelope.dispatchDeadline)
  ) {
    return {
      allowed: false,
      reason: "compute_approval_outside_validity_window",
    };
  }
  if (
    approvalExpiresAt - approvedAt > policy.computeApprovalTtlSeconds * 1_000
  ) {
    return {
      allowed: false,
      reason: "compute_approval_ttl_exceeds_policy",
    };
  }
  if (
    microUsd(approval.maximumCostMicroUsd) <
    microUsd(policy.absoluteCostCapMicroUsd)
  ) {
    return {
      allowed: false,
      reason: "compute_approval_below_absolute_cap",
    };
  }
  const jobBudgetMicroUsd = foundryUsdNumberToMicroUsd(job.budgetCapUsd);
  if (
    jobBudgetMicroUsd === null ||
    microUsd(approval.maximumCostMicroUsd) > BigInt(jobBudgetMicroUsd)
  ) {
    return {
      allowed: false,
      reason: "compute_approval_exceeds_job_budget",
    };
  }
  return { allowed: true };
}

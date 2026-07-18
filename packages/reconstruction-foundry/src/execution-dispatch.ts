import {
  FoundryExecutionEnvelopeComputeApprovalV0Schema,
  FoundryExecutionEnvelopeConfirmationV0Schema,
  FoundryExecutionEnvelopeV0Schema,
  FoundryExecutionPolicyV0Schema,
  FoundryIngestManifestV0Schema,
  FoundryJobSpecV0Schema,
  FoundryProviderDeploymentEvidenceV0Schema,
  FoundryProviderPlanEvidenceV0Schema,
  FoundryProviderKindSchema,
  FoundryTrustedWorkerProfileV0Schema,
  FoundryUtcInstantSchema,
  RuntimeSha256Schema,
  computeFoundryExecutionEnvelopeSha256,
  computeFoundryExecutionEnvelopeComputeApprovalSha256,
  computeFoundryExecutionEnvelopeConfirmationSha256,
  computeFoundryExecutionPolicySha256,
  computeFoundryIngestManifestSha256,
  computeFoundryJobSpecSha256,
  computeFoundryProviderPlanEvidenceSha256,
  validateFoundryExecutionAuthorizations,
  validateFoundryExecutionEnvelopeBindings,
  type FoundryExecutionEnvelopeComputeApprovalV0,
  type FoundryExecutionEnvelopeConfirmationV0,
  type FoundryExecutionEnvelopeV0,
  type FoundryExecutionPolicyV0,
  type FoundryIngestManifestV0,
  type FoundryJobSpecV0,
  type FoundryProviderDeploymentEvidenceV0,
  type FoundryProviderKind,
  type FoundryProviderPlanEvidenceV0,
  type FoundryTrustedWorkerProfileV0,
} from "@omnitwin/types";
import { timingSafeEqual } from "node:crypto";
import { domainSeparatedSha256, toCanonicalJson, type CanonicalJson } from "./canonical-json.js";
import {
  FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
  FOUNDRY_EXECUTION_SUBJECT_V0,
  computeFoundryExecutionSubjectSha256,
  type FoundryExecutionSubjectV0,
} from "./execution-control.js";
import {
  createFoundryExecutionEvent,
  replayFoundryExecutionLedger,
  type FoundryExecutionLedgerEventV0,
} from "./execution-replay.js";
import { FoundryIntegrityError, asError } from "./errors.js";

export const FOUNDRY_PREPARED_EXECUTION_V0 = "omnitwin.foundry.prepared-execution.v0";
export const FOUNDRY_LOCAL_CUDA_ADAPTER_PLAN_V0 = "omnitwin.foundry.local-cuda-adapter-plan.v0";
export const FOUNDRY_RUNPOD_ADAPTER_PLAN_V0 = "omnitwin.foundry.runpod-adapter-plan.v0";

const PREPARED_EXECUTION_DIGEST_DOMAIN = "OMNITWIN_FOUNDRY_PREPARED_EXECUTION_V0";
const ADAPTER_PLAN_DIGEST_DOMAIN = "OMNITWIN_FOUNDRY_ADAPTER_PLAN_V0";
const INVOCATION_RECEIPT_DIGEST_DOMAIN = "OMNITWIN_FOUNDRY_INVOCATION_RECEIPT_V0";
const PINNED_CONTAINER_IMAGE = /^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?@sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const SAFE_PATH = /^\/[a-z0-9][a-z0-9._/-]{0,239}$/u;
const MICRO_USD_PER_USD = 1_000_000;

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, cause === undefined ? undefined : { cause });
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function digestsEqual(left: string, right: string): boolean {
  if (!RuntimeSha256Schema.safeParse(left).success || !RuntimeSha256Schema.safeParse(right).success) return false;
  return timingSafeEqual(Buffer.from(left.slice(7), "hex"), Buffer.from(right.slice(7), "hex"));
}

function optionalDigestsEqual(left: string | null, right: string | null): boolean {
  return left === null || right === null ? left === right : digestsEqual(left, right);
}

function assertUtc(value: string, label: string): void {
  if (!FoundryUtcInstantSchema.safeParse(value).success) {
    fail("INVALID_EXECUTION_DISPATCH_TIME", `${label} must be an exact UTC instant.`);
  }
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) fail("INVALID_EXECUTION_ADAPTER_CONFIG", `${label} is not a safe identifier.`);
}

function usdToMicroUsd(value: number, label: string): string {
  const scaled = value * MICRO_USD_PER_USD;
  if (!Number.isSafeInteger(scaled) || scaled < 0) {
    fail(
      "NON_CANONICAL_EXECUTION_COST",
      `${label} must be exactly representable as a non-negative whole number of micro-USD.`,
    );
  }
  return String(scaled);
}

function canonicalSortedUnique(values: readonly string[], label: string): readonly string[] {
  if (values.length === 0) fail("INVALID_EXECUTION_ADAPTER_CONFIG", `${label} must not be empty.`);
  const sorted = [...values].sort();
  if (new Set(values).size !== values.length || values.some((value, index) => value !== sorted[index])) {
    fail("INVALID_EXECUTION_ADAPTER_CONFIG", `${label} must be unique and sorted.`);
  }
  return sorted;
}

function assertPinnedAllowlistedImages(
  job: FoundryJobSpecV0,
  allowlist: readonly string[],
): void {
  canonicalSortedUnique(allowlist, "allowed container images");
  const allowed = new Set(allowlist);
  for (const stage of job.stages) {
    if (!PINNED_CONTAINER_IMAGE.test(stage.containerImage)) {
      fail(
        "UNPINNED_EXECUTION_IMAGE",
        `Stage ${stage.id} does not use a registry image pinned by SHA-256.`,
      );
    }
    if (!allowed.has(stage.containerImage)) {
      fail(
        "UNKNOWN_EXECUTION_IMAGE",
        `Stage ${stage.id} uses a container image that is not in the exact adapter allowlist.`,
      );
    }
  }
}

export interface FoundryExecutionDispatchEvidenceInput {
  readonly jobSpec: unknown;
  readonly ingestManifest: unknown;
  readonly intakeAdmissionResultSha256: unknown;
  readonly intakeStagingIndexSha256: unknown;
  readonly executionPolicy: unknown;
  readonly providerPlanEvidence: unknown;
  readonly trustedWorkerProfiles: readonly unknown[];
  readonly providerDeploymentEvidence: unknown;
  readonly executionEnvelope: unknown;
  readonly executionConfirmation: unknown;
  readonly computeApproval: unknown;
  /** Digest of the separate trusted rights decision; the decision remains outside provider requests. */
  readonly rightsApprovalSha256: unknown;
  readonly rightsPolicyEvidenceSha256: unknown;
  readonly rightsPolicyDefinitionSha256: unknown;
}

export interface FoundryExecutionDispatchEvidence {
  readonly jobSpec: FoundryJobSpecV0;
  readonly ingestManifest: FoundryIngestManifestV0;
  readonly reviewedIngestManifestSha256: string;
  readonly intakeAdmissionResultSha256: string;
  readonly intakeStagingIndexSha256: string;
  readonly executionPolicy: FoundryExecutionPolicyV0;
  readonly providerPlanEvidence: FoundryProviderPlanEvidenceV0;
  readonly trustedWorkerProfiles: readonly FoundryTrustedWorkerProfileV0[];
  readonly providerDeploymentEvidence: FoundryProviderDeploymentEvidenceV0;
  readonly executionEnvelope: FoundryExecutionEnvelopeV0;
  readonly executionConfirmation: FoundryExecutionEnvelopeConfirmationV0;
  readonly computeApproval: FoundryExecutionEnvelopeComputeApprovalV0 | null;
  readonly rightsApprovalSha256: string;
  readonly rightsPolicyEvidenceSha256: string;
  readonly rightsPolicyDefinitionSha256: string;
}

export interface FoundryAdapterPreparationContext extends FoundryExecutionDispatchEvidence {
  readonly executionEnvelopeSha256: string;
}

export interface FoundryProviderInvocationReceipt {
  readonly status: "accepted";
  readonly providerExecutionReferenceSha256: string;
  readonly acceptedAt: string;
}

export interface FoundryProviderInvocation {
  readonly dispatchId: string;
  readonly idempotencyKey: string;
  readonly preparedExecutionSha256: string;
  readonly adapterPlan: CanonicalJson;
}

/**
 * Provider boundary. `prepare` must be pure. `invoke` is the only method that
 * may call a process runner or remote client, and orchestration calls it only
 * after durable reservation and an immediate ledger replay.
 */
export interface FoundryExecutionProviderAdapter {
  readonly providerKind: FoundryProviderKind;
  readonly providerAdapterId: string;
  readonly providerAdapterVersion: string;
  prepare(context: FoundryAdapterPreparationContext): CanonicalJson;
  invoke(invocation: FoundryProviderInvocation): Promise<FoundryProviderInvocationReceipt>;
}

export interface FoundryPreparedExecutionV0 {
  readonly schemaVersion: typeof FOUNDRY_PREPARED_EXECUTION_V0;
  readonly authority: "none";
  readonly preparedId: string;
  readonly preparedAt: string;
  readonly dispatchDeadline: string;
  readonly providerKind: FoundryProviderKind;
  readonly providerAdapterId: string;
  readonly providerAdapterVersion: string;
  readonly jobSpecSha256: string;
  readonly reviewedIngestManifestSha256: string;
  readonly executionPolicySha256: string;
  readonly providerPlanSha256: string;
  readonly executionEnvelopeSha256: string;
  readonly executionConfirmationId: string;
  readonly executionConfirmationSha256: string;
  readonly computeApprovalId: string | null;
  readonly computeApprovalSha256: string | null;
  readonly rightsApprovalSha256: string;
  readonly rightsPolicyEvidenceSha256: string;
  readonly rightsPolicyDefinitionSha256: string;
  readonly executionSubjectSha256: string;
  readonly estimatedCostMicroUsd: string;
  readonly approvedMaximumCostMicroUsd: string | null;
  readonly adapterPlan: CanonicalJson;
  readonly adapterPlanSha256: string;
  readonly preparedExecutionSha256: string;
}

export type FoundryPreparedWriteResult = "created" | "existing" | "conflict";

export type FoundryDurableDispatchState = "reserved" | "invoking" | "succeeded" | "uncertain";

export interface FoundryDurableDispatchRecord {
  readonly dispatchId: string;
  readonly preparedExecutionSha256: string;
  readonly executionConfirmationId: string;
  readonly executionConfirmationSha256: string;
  readonly computeApprovalId: string | null;
  readonly computeApprovalSha256: string | null;
  readonly reservedCostMicroUsd: string;
  readonly executionSubjectSha256: string;
  readonly authorizationEventSha256: string;
  readonly state: FoundryDurableDispatchState;
  readonly receiptSha256: string | null;
}

export interface FoundryDispatchReservationInput {
  readonly dispatchId: string;
  readonly preparedId: string;
  readonly preparedExecutionSha256: string;
  readonly executionConfirmationId: string;
  readonly executionConfirmationSha256: string;
  readonly computeApprovalId: string | null;
  readonly computeApprovalSha256: string | null;
  readonly approvedMaximumCostMicroUsd: string | null;
  readonly reservedCostMicroUsd: string;
  readonly executionSubjectSha256: string;
  readonly expectedLedgerHeadSha256: string | null;
  readonly authorizationEvent: FoundryExecutionLedgerEventV0;
  readonly reservedAt: string;
}

export type FoundryDispatchReservationResult =
  | { readonly status: "acquired"; readonly record: FoundryDurableDispatchRecord }
  | { readonly status: "existing"; readonly record: FoundryDurableDispatchRecord };

/**
 * Production implementations must back these methods with durable storage.
 * `reserveDispatchAtomically` is one serializable transaction which must:
 *
 * 1. compare the exact prepared digest;
 * 2. compare-and-append the authorization event at the expected ledger head;
 * 3. consume the confirmation ID exactly once;
 * 4. reserve the remote approval ID and cost exactly once; and
 * 5. create one dispatch row, returning the existing row for the same dispatch.
 *
 * A conflict on any other dispatch must fail closed. Implementations must not
 * call a provider from inside the transaction.
 */
export interface FoundryExecutionDispatchStore {
  putPreparedExecution(record: FoundryPreparedExecutionV0): Promise<FoundryPreparedWriteResult>;
  getPreparedExecution(preparedId: string): Promise<FoundryPreparedExecutionV0 | null>;
  getDispatch(dispatchId: string): Promise<FoundryDurableDispatchRecord | null>;
  readExecutionLedger(executionSubjectSha256: string): Promise<readonly unknown[]>;
  reserveDispatchAtomically(input: FoundryDispatchReservationInput): Promise<FoundryDispatchReservationResult>;
  markInvocationStarted(input: {
    readonly dispatchId: string;
    readonly preparedExecutionSha256: string;
    readonly expectedLedgerHeadSha256: string;
    readonly startedAt: string;
  }): Promise<boolean>;
  markInvocationSucceeded(input: {
    readonly dispatchId: string;
    readonly preparedExecutionSha256: string;
    readonly receiptSha256: string;
    readonly completedAt: string;
  }): Promise<void>;
  markInvocationUncertain(input: {
    readonly dispatchId: string;
    readonly preparedExecutionSha256: string;
    readonly failureCode: string;
    readonly failedAt: string;
  }): Promise<void>;
}

function parseEvidence(
  input: FoundryExecutionDispatchEvidenceInput,
  now: Date,
): FoundryExecutionDispatchEvidence {
  const jobResult = FoundryJobSpecV0Schema.safeParse(input.jobSpec);
  const manifestResult = FoundryIngestManifestV0Schema.safeParse(input.ingestManifest);
  const intakeAdmissionResult = RuntimeSha256Schema.safeParse(input.intakeAdmissionResultSha256);
  const intakeStagingResult = RuntimeSha256Schema.safeParse(input.intakeStagingIndexSha256);
  const policyResult = FoundryExecutionPolicyV0Schema.safeParse(input.executionPolicy);
  const planResult = FoundryProviderPlanEvidenceV0Schema.safeParse(input.providerPlanEvidence);
  const workerProfileResults = input.trustedWorkerProfiles.map((profile) =>
    FoundryTrustedWorkerProfileV0Schema.safeParse(profile),
  );
  const deploymentResult = FoundryProviderDeploymentEvidenceV0Schema.safeParse(
    input.providerDeploymentEvidence,
  );
  const envelopeResult = FoundryExecutionEnvelopeV0Schema.safeParse(input.executionEnvelope);
  const confirmationResult = FoundryExecutionEnvelopeConfirmationV0Schema.safeParse(
    input.executionConfirmation,
  );
  const rightsResult = RuntimeSha256Schema.safeParse(input.rightsApprovalSha256);
  const rightsPolicyEvidenceResult = RuntimeSha256Schema.safeParse(
    input.rightsPolicyEvidenceSha256,
  );
  const rightsPolicyDefinitionResult = RuntimeSha256Schema.safeParse(
    input.rightsPolicyDefinitionSha256,
  );
  if (
    !jobResult.success ||
    !manifestResult.success ||
    !intakeAdmissionResult.success ||
    !intakeStagingResult.success ||
    !policyResult.success ||
    !planResult.success ||
    workerProfileResults.some((result) => !result.success) ||
    !deploymentResult.success ||
    !envelopeResult.success ||
    !confirmationResult.success ||
    !rightsResult.success ||
    !rightsPolicyEvidenceResult.success ||
    !rightsPolicyDefinitionResult.success
  ) {
    fail("INVALID_EXECUTION_DISPATCH_EVIDENCE", "Execution dispatch evidence is invalid or incomplete.");
  }
  const jobSpec = jobResult.data;
  const ingestManifest = manifestResult.data;
  const reviewedIngestManifestSha256 = computeFoundryIngestManifestSha256(ingestManifest);
  const executionPolicy = policyResult.data;
  const providerPlanEvidence = planResult.data;
  const trustedWorkerProfiles = workerProfileResults.map((result) => {
    if (!result.success) {
      fail("INVALID_EXECUTION_DISPATCH_EVIDENCE", "Trusted worker profile is invalid.");
    }
    return result.data;
  });
  const providerDeploymentEvidence = deploymentResult.data;
  const executionEnvelope = envelopeResult.data;
  const executionConfirmation = confirmationResult.data;
  const remote = !["local_cpu", "local_cuda"].includes(jobSpec.providerKind);
  const approvalResult = input.computeApproval === null
    ? null
    : FoundryExecutionEnvelopeComputeApprovalV0Schema.safeParse(input.computeApproval);
  if (approvalResult !== null && !approvalResult.success) {
    fail("INVALID_EXECUTION_DISPATCH_EVIDENCE", "Remote compute approval is malformed.");
  }
  const computeApproval = approvalResult?.data ?? null;

  const binding = validateFoundryExecutionEnvelopeBindings(executionEnvelope, {
    jobSpec,
    ingestManifest,
    intakeAdmissionResultSha256: intakeAdmissionResult.data,
    intakeStagingIndexSha256: intakeStagingResult.data,
    executionPolicy,
    providerPlanEvidence,
    trustedWorkerProfiles,
    providerDeploymentEvidence,
  });
  if (!binding.valid) {
    fail("EXECUTION_BINDING_REJECTED", `Execution evidence binding was rejected: ${binding.reason}.`);
  }
  const authorization = validateFoundryExecutionAuthorizations(
    executionEnvelope,
    jobSpec,
    executionPolicy,
    executionConfirmation,
    computeApproval,
    now,
  );
  if (!authorization.allowed) {
    fail("EXECUTION_AUTHORIZATION_REJECTED", `Execution authorization was rejected: ${authorization.reason}.`);
  }
  if (remote) {
    if (computeApproval === null || jobSpec.computeApprovalId !== computeApproval.approvalId) {
      fail(
        "EXECUTION_COMPUTE_APPROVAL_MISMATCH",
        "The executable JobSpec must reference this exact remote compute approval.",
      );
    }
  } else if (computeApproval !== null || jobSpec.computeApprovalId !== null) {
    fail("EXECUTION_LOCAL_APPROVAL_FORBIDDEN", "Local execution cannot carry a remote compute approval.");
  }

  const jobEstimate = usdToMicroUsd(jobSpec.estimatedCostUsd, "JobSpec estimated cost");
  const jobBudget = usdToMicroUsd(jobSpec.budgetCapUsd, "JobSpec budget cap");
  const planEstimate = providerPlanEvidence.estimatedCostMicroUsd;
  if (BigInt(jobEstimate) !== BigInt(planEstimate)) {
    fail("EXECUTION_COST_BINDING_MISMATCH", "JobSpec and provider plan estimates differ.");
  }
  if (BigInt(planEstimate) > BigInt(jobBudget)) {
    fail("EXECUTION_COST_CAP_EXCEEDED", "Provider estimate exceeds the JobSpec budget cap.");
  }
  if (
    computeApproval !== null &&
    BigInt(planEstimate) > BigInt(computeApproval.maximumCostMicroUsd)
  ) {
    fail("EXECUTION_COST_CAP_EXCEEDED", "Provider estimate exceeds the remote compute approval.");
  }
  return {
    jobSpec,
    ingestManifest,
    reviewedIngestManifestSha256,
    intakeAdmissionResultSha256: intakeAdmissionResult.data,
    intakeStagingIndexSha256: intakeStagingResult.data,
    executionPolicy,
    providerPlanEvidence,
    trustedWorkerProfiles,
    providerDeploymentEvidence,
    executionEnvelope,
    executionConfirmation,
    computeApproval,
    rightsApprovalSha256: rightsResult.data,
    rightsPolicyEvidenceSha256: rightsPolicyEvidenceResult.data,
    rightsPolicyDefinitionSha256: rightsPolicyDefinitionResult.data,
  };
}

function computeConfirmationSha256(confirmation: FoundryExecutionEnvelopeConfirmationV0): string {
  return computeFoundryExecutionEnvelopeConfirmationSha256(confirmation);
}

function computeApprovalSha256(approval: FoundryExecutionEnvelopeComputeApprovalV0 | null): string | null {
  return approval === null
    ? null
    : computeFoundryExecutionEnvelopeComputeApprovalSha256(approval);
}

function makeExecutionSubject(evidence: FoundryExecutionDispatchEvidence): FoundryExecutionSubjectV0 {
  const policy = evidence.executionPolicy;
  const executionEnvelopeSha256 = computeFoundryExecutionEnvelopeSha256(
    evidence.executionEnvelope,
  );
  const workerProfileSha256s = [
    ...new Set(
      evidence.providerPlanEvidence.stages.map((stage) => stage.workerProfileSha256),
    ),
  ].sort();
  return {
    schemaVersion: FOUNDRY_EXECUTION_SUBJECT_V0,
    subjectId: evidence.executionEnvelope.envelopeId,
    projectId: evidence.executionEnvelope.projectId,
    jobSpecSha256: computeFoundryJobSpecSha256(evidence.jobSpec),
    executionEnvelopeSha256,
    ingestManifestSha256: evidence.reviewedIngestManifestSha256,
    intakeAdmissionResultSha256: evidence.intakeAdmissionResultSha256,
    intakeStagingIndexSha256: evidence.intakeStagingIndexSha256,
    providerPlanSha256: computeFoundryProviderPlanEvidenceSha256(evidence.providerPlanEvidence),
    executionPolicySha256: computeFoundryExecutionPolicySha256(evidence.executionPolicy),
    executionConfirmationSha256: computeConfirmationSha256(evidence.executionConfirmation),
    rightsApprovalSha256: evidence.rightsApprovalSha256,
    rightsPolicyEvidenceSha256: evidence.rightsPolicyEvidenceSha256,
    rightsPolicyDefinitionSha256: evidence.rightsPolicyDefinitionSha256,
    computeApprovalSha256: computeApprovalSha256(evidence.computeApproval),
    providerKind: evidence.executionEnvelope.providerKind,
    providerAdapterId: evidence.executionEnvelope.providerAdapterId,
    providerAdapterVersion: evidence.executionEnvelope.providerAdapterVersion,
    providerAdapterArtifactSha256:
      evidence.executionEnvelope.providerAdapterArtifactSha256,
    providerDeploymentSha256: evidence.executionEnvelope.providerDeploymentSha256,
    workerProfileSha256s,
    pricingSnapshotSha256: evidence.executionEnvelope.pricingSnapshotSha256,
    pricingSnapshotExpiresAt: evidence.executionEnvelope.pricingSnapshotExpiresAt,
    createdAt: evidence.executionEnvelope.createdAt,
    dispatchDeadline: evidence.executionEnvelope.dispatchDeadline,
    maximumAttempts: FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
    budgetPolicy: {
      currency: "USD",
      costWarningMicroUsd: policy.costWarningMicroUsd,
      costHardStopMicroUsd: policy.costHardStopMicroUsd,
      terminationReserveMicroUsd: policy.terminationReserveMicroUsd,
      absoluteCostCapMicroUsd: policy.absoluteCostCapMicroUsd,
      costObservationMaximumAgeSeconds: policy.costObservationMaximumAgeSeconds,
    },
    checkpointContract: null,
  };
}

function assertAdapterBinding(
  adapter: FoundryExecutionProviderAdapter,
  evidence: FoundryExecutionDispatchEvidence,
): void {
  assertSafeId(adapter.providerAdapterId, "provider adapter ID");
  if (!FoundryProviderKindSchema.safeParse(adapter.providerKind).success) {
    fail("INVALID_EXECUTION_ADAPTER_CONFIG", "Provider adapter kind is invalid.");
  }
  const envelope = evidence.executionEnvelope;
  if (
    adapter.providerKind !== envelope.providerKind ||
    adapter.providerAdapterId !== envelope.providerAdapterId ||
    adapter.providerAdapterVersion !== envelope.providerAdapterVersion
  ) {
    fail("EXECUTION_ADAPTER_BINDING_MISMATCH", "The injected adapter does not match the exact envelope binding.");
  }
}

function preparedPayload(record: FoundryPreparedExecutionV0): Omit<FoundryPreparedExecutionV0, "preparedExecutionSha256"> {
  const { preparedExecutionSha256: _digest, ...payload } = record;
  return payload;
}

export function computeFoundryPreparedExecutionSha256(
  record: Omit<FoundryPreparedExecutionV0, "preparedExecutionSha256"> | FoundryPreparedExecutionV0,
): string {
  const value = "preparedExecutionSha256" in record ? preparedPayload(record) : record;
  return digest(PREPARED_EXECUTION_DIGEST_DOMAIN, value);
}

function buildPreparedExecution(
  input: FoundryExecutionDispatchEvidenceInput,
  adapter: FoundryExecutionProviderAdapter,
  preparedAt: Date,
): FoundryPreparedExecutionV0 {
  const preparedAtMs = preparedAt.getTime();
  if (!Number.isFinite(preparedAtMs)) fail("INVALID_EXECUTION_DISPATCH_TIME", "Preparation time is invalid.");
  const evidence = parseEvidence(input, preparedAt);
  assertAdapterBinding(adapter, evidence);
  const envelopeSha256 = computeFoundryExecutionEnvelopeSha256(evidence.executionEnvelope);
  const context: FoundryAdapterPreparationContext = {
    ...evidence,
    executionEnvelopeSha256: envelopeSha256,
  };
  const adapterPlan = toCanonicalJson(adapter.prepare(context));
  const executionSubject = makeExecutionSubject(evidence);
  const preparedId = `prepared-${envelopeSha256.slice(7, 39)}`;
  const payload: Omit<FoundryPreparedExecutionV0, "preparedExecutionSha256"> = {
    schemaVersion: FOUNDRY_PREPARED_EXECUTION_V0,
    authority: "none",
    preparedId,
    preparedAt: preparedAt.toISOString(),
    dispatchDeadline: evidence.executionEnvelope.dispatchDeadline,
    providerKind: evidence.executionEnvelope.providerKind,
    providerAdapterId: evidence.executionEnvelope.providerAdapterId,
    providerAdapterVersion: evidence.executionEnvelope.providerAdapterVersion,
    jobSpecSha256: computeFoundryJobSpecSha256(evidence.jobSpec),
    reviewedIngestManifestSha256: evidence.reviewedIngestManifestSha256,
    executionPolicySha256: computeFoundryExecutionPolicySha256(evidence.executionPolicy),
    providerPlanSha256: computeFoundryProviderPlanEvidenceSha256(evidence.providerPlanEvidence),
    executionEnvelopeSha256: envelopeSha256,
    executionConfirmationId: evidence.executionConfirmation.confirmationId,
    executionConfirmationSha256: computeConfirmationSha256(evidence.executionConfirmation),
    computeApprovalId: evidence.computeApproval?.approvalId ?? null,
    computeApprovalSha256: computeApprovalSha256(evidence.computeApproval),
    rightsApprovalSha256: evidence.rightsApprovalSha256,
    rightsPolicyEvidenceSha256: evidence.rightsPolicyEvidenceSha256,
    rightsPolicyDefinitionSha256: evidence.rightsPolicyDefinitionSha256,
    executionSubjectSha256: computeFoundryExecutionSubjectSha256(executionSubject),
    estimatedCostMicroUsd: evidence.providerPlanEvidence.estimatedCostMicroUsd,
    approvedMaximumCostMicroUsd: evidence.computeApproval?.maximumCostMicroUsd ?? null,
    adapterPlan,
    adapterPlanSha256: digest(ADAPTER_PLAN_DIGEST_DOMAIN, adapterPlan),
  };
  return { ...payload, preparedExecutionSha256: computeFoundryPreparedExecutionSha256(payload) };
}

export async function prepareFoundryExecutionDispatch(
  input: FoundryExecutionDispatchEvidenceInput,
  adapter: FoundryExecutionProviderAdapter,
  store: FoundryExecutionDispatchStore,
  preparedAt: Date,
): Promise<FoundryPreparedExecutionV0> {
  const prepared = buildPreparedExecution(input, adapter, preparedAt);
  const result = await store.putPreparedExecution(prepared);
  if (result === "conflict") {
    fail("PREPARED_EXECUTION_CONFLICT", "A different preparation already uses this immutable prepared ID.");
  }
  return prepared;
}

function uuidFromDigest(value: string): string {
  const hex = value.slice(7, 39).split("");
  hex[12] = "5";
  const variant = Number.parseInt(hex[16] ?? "0", 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function validateExistingDispatch(
  record: FoundryDurableDispatchRecord,
  prepared: FoundryPreparedExecutionV0,
  dispatchId: string,
): void {
  if (
    record.dispatchId !== dispatchId ||
    !digestsEqual(record.preparedExecutionSha256, prepared.preparedExecutionSha256) ||
    record.executionConfirmationId !== prepared.executionConfirmationId ||
    !digestsEqual(record.executionConfirmationSha256, prepared.executionConfirmationSha256) ||
    record.computeApprovalId !== prepared.computeApprovalId ||
    !optionalDigestsEqual(record.computeApprovalSha256, prepared.computeApprovalSha256) ||
    record.reservedCostMicroUsd !== prepared.estimatedCostMicroUsd ||
    !digestsEqual(record.executionSubjectSha256, prepared.executionSubjectSha256)
  ) {
    fail("DURABLE_DISPATCH_RECORD_MISMATCH", "Durable dispatch state does not match the exact prepared execution.");
  }
}

export type FoundryExecutionCommitResult =
  | {
      readonly status: "dispatched";
      readonly dispatchId: string;
      readonly receipt: FoundryProviderInvocationReceipt;
    }
  | {
      readonly status: "already_committed";
      readonly dispatchId: string;
      readonly durableState: FoundryDurableDispatchState;
      readonly receiptSha256: string | null;
    };

function assertReceipt(value: unknown): asserts value is FoundryProviderInvocationReceipt {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    value.status !== "accepted" ||
    !("providerExecutionReferenceSha256" in value) ||
    !RuntimeSha256Schema.safeParse(value.providerExecutionReferenceSha256).success ||
    !("acceptedAt" in value) ||
    !FoundryUtcInstantSchema.safeParse(value.acceptedAt).success
  ) {
    fail("INVALID_PROVIDER_INVOCATION_RECEIPT", "Provider adapter returned an invalid, non-auditable receipt.");
  }
}

/**
 * Commits one prepared dispatch. A valid retry returns durable state without
 * invoking again. An uncertain invocation is never retried automatically.
 */
export async function commitFoundryExecutionDispatch(
  preparedId: string,
  input: FoundryExecutionDispatchEvidenceInput,
  adapter: FoundryExecutionProviderAdapter,
  store: FoundryExecutionDispatchStore,
  committedAt: Date,
): Promise<FoundryExecutionCommitResult> {
  const committedAtMs = committedAt.getTime();
  if (!Number.isFinite(committedAtMs)) fail("INVALID_EXECUTION_DISPATCH_TIME", "Commit time is invalid.");
  const stored = await store.getPreparedExecution(preparedId);
  if (stored === null) fail("PREPARED_EXECUTION_NOT_FOUND", "The prepared execution does not exist.");
  if (!digestsEqual(computeFoundryPreparedExecutionSha256(stored), stored.preparedExecutionSha256)) {
    fail("PREPARED_EXECUTION_TAMPERED", "The stored prepared execution digest is invalid.");
  }
  assertUtc(stored.preparedAt, "stored preparation time");
  const rebuilt = buildPreparedExecution(input, adapter, new Date(stored.preparedAt));
  if (!digestsEqual(rebuilt.preparedExecutionSha256, stored.preparedExecutionSha256)) {
    fail("PREPARED_EXECUTION_STALE", "Current evidence or adapter preparation differs from the stored preparation.");
  }
  // Revalidate all expiry, approval, cost, evidence, and adapter bindings at the commit instant.
  const evidence = parseEvidence(input, committedAt);
  assertAdapterBinding(adapter, evidence);
  if (committedAtMs >= Date.parse(stored.dispatchDeadline)) {
    fail("EXECUTION_DISPATCH_DEADLINE_REACHED", "The prepared dispatch deadline has been reached.");
  }
  const executionSubject = makeExecutionSubject(evidence);
  const subjectSha256 = computeFoundryExecutionSubjectSha256(executionSubject);
  if (!digestsEqual(subjectSha256, stored.executionSubjectSha256)) {
    fail("EXECUTION_SUBJECT_MISMATCH", "Current execution subject differs from the prepared subject.");
  }

  const dispatchId = `dispatch-${stored.preparedExecutionSha256.slice(7, 39)}`;
  const priorDispatch = await store.getDispatch(dispatchId);
  if (priorDispatch !== null) {
    validateExistingDispatch(priorDispatch, stored, dispatchId);
    return {
      status: "already_committed",
      dispatchId,
      durableState: priorDispatch.state,
      receiptSha256: priorDispatch.receiptSha256,
    };
  }

  const beforeEvents = await store.readExecutionLedger(subjectSha256);
  const beforeReplay = replayFoundryExecutionLedger(executionSubject, beforeEvents);
  if (beforeReplay.state !== null || beforeReplay.headEventSha256 !== null) {
    fail("EXECUTION_REPLAY_DETECTED", "The immutable execution subject already has an attempt ledger.");
  }

  const attemptId = `attempt-${stored.preparedExecutionSha256.slice(7, 39)}`;
  const occurredAt = committedAt.toISOString();
  const authorizationEvent = createFoundryExecutionEvent(
    executionSubject,
    {
      attemptId,
      occurredAt,
      recordedAt: occurredAt,
      actorKind: "control_plane",
      actorKey: "dispatch-control-plane",
      idempotencyKey: `authorize-${stored.preparedExecutionSha256.slice(7, 39)}`,
      causationId: null,
      correlationId: uuidFromDigest(stored.preparedExecutionSha256),
      fenceToken: null,
      payload: { type: "attempt_authorized" },
    },
    null,
  );
  const reservation = await store.reserveDispatchAtomically({
    dispatchId,
    preparedId: stored.preparedId,
    preparedExecutionSha256: stored.preparedExecutionSha256,
    executionConfirmationId: stored.executionConfirmationId,
    executionConfirmationSha256: stored.executionConfirmationSha256,
    computeApprovalId: stored.computeApprovalId,
    computeApprovalSha256: stored.computeApprovalSha256,
    approvedMaximumCostMicroUsd: stored.approvedMaximumCostMicroUsd,
    reservedCostMicroUsd: stored.estimatedCostMicroUsd,
    executionSubjectSha256: stored.executionSubjectSha256,
    expectedLedgerHeadSha256: null,
    authorizationEvent,
    reservedAt: occurredAt,
  });
  validateExistingDispatch(reservation.record, stored, dispatchId);
  if (reservation.status === "existing") {
    return {
      status: "already_committed",
      dispatchId,
      durableState: reservation.record.state,
      receiptSha256: reservation.record.receiptSha256,
    };
  }

  // This second replay occurs after the atomic append and immediately before
  // the irreversible invocation transition. Any gap or foreign event blocks.
  const committedEvents = await store.readExecutionLedger(subjectSha256);
  const committedReplay = replayFoundryExecutionLedger(executionSubject, committedEvents);
  if (
    committedReplay.eventCount !== 1 ||
    committedReplay.state?.state !== "authorized" ||
    committedReplay.headEventSha256 !== authorizationEvent.eventSha256
  ) {
    fail("EXECUTION_LEDGER_COMMIT_MISMATCH", "The durable ledger does not contain the exact single authorization event.");
  }
  const invocationStarted = await store.markInvocationStarted({
    dispatchId,
    preparedExecutionSha256: stored.preparedExecutionSha256,
    expectedLedgerHeadSha256: authorizationEvent.eventSha256,
    startedAt: occurredAt,
  });
  if (!invocationStarted) {
    const currentDispatch = await store.getDispatch(dispatchId);
    if (currentDispatch === null) {
      fail("DURABLE_DISPATCH_RECORD_MISSING", "The durable dispatch disappeared before invocation.");
    }
    validateExistingDispatch(currentDispatch, stored, dispatchId);
    if (currentDispatch.state === "reserved") {
      fail(
        "DURABLE_INVOCATION_TRANSITION_REJECTED",
        "The durable store rejected invocation without recording another terminal or in-flight state.",
      );
    }
    return {
      status: "already_committed",
      dispatchId,
      durableState: currentDispatch.state,
      receiptSha256: currentDispatch.receiptSha256,
    };
  }

  try {
    const receipt = await adapter.invoke({
      dispatchId,
      idempotencyKey: dispatchId,
      preparedExecutionSha256: stored.preparedExecutionSha256,
      adapterPlan: stored.adapterPlan,
    });
    assertReceipt(receipt);
    const receiptSha256 = digest(INVOCATION_RECEIPT_DIGEST_DOMAIN, receipt);
    await store.markInvocationSucceeded({
      dispatchId,
      preparedExecutionSha256: stored.preparedExecutionSha256,
      receiptSha256,
      completedAt: receipt.acceptedAt,
    });
    return { status: "dispatched", dispatchId, receipt };
  } catch (error) {
    const failure = asError(error);
    try {
      await store.markInvocationUncertain({
        dispatchId,
        preparedExecutionSha256: stored.preparedExecutionSha256,
        failureCode: failure instanceof FoundryIntegrityError ? failure.code : "provider_invocation_failed",
        failedAt: new Date().toISOString(),
      });
    } catch {
      // The provider outcome is still uncertain. Never convert this into a retry.
    }
    fail(
      "PROVIDER_INVOCATION_OUTCOME_UNCERTAIN",
      "The provider invocation outcome is uncertain; automatic retry is forbidden and reconciliation is required.",
      failure,
    );
  }
}

export interface FoundryAdapterCapacity {
  readonly cpuCores: number;
  readonly ramGiB: number;
  readonly gpuCount: number;
  readonly perGpuVramGiB: number;
  readonly scratchGiB: number;
}

function assertCapacity(capacity: FoundryAdapterCapacity, label: string, requireGpu: boolean): void {
  const entries: readonly [string, number, boolean][] = [
    ["cpuCores", capacity.cpuCores, true],
    ["ramGiB", capacity.ramGiB, false],
    ["gpuCount", capacity.gpuCount, true],
    ["perGpuVramGiB", capacity.perGpuVramGiB, false],
    ["scratchGiB", capacity.scratchGiB, false],
  ];
  for (const [field, value, integer] of entries) {
    if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
      fail("INVALID_EXECUTION_ADAPTER_CONFIG", `${label}.${field} is invalid.`);
    }
  }
  if (capacity.cpuCores <= 0 || capacity.ramGiB <= 0 || capacity.scratchGiB <= 0) {
    fail("INVALID_EXECUTION_ADAPTER_CONFIG", `${label} must declare positive CPU, RAM, and scratch capacity.`);
  }
  if (requireGpu && (capacity.gpuCount <= 0 || capacity.perGpuVramGiB <= 0)) {
    fail("INVALID_EXECUTION_ADAPTER_CONFIG", `${label} must declare CUDA GPU capacity.`);
  }
}

function assertStageCapacity(
  stage: FoundryJobSpecV0["stages"][number],
  capacity: FoundryAdapterCapacity,
): void {
  if (
    stage.cpuCores > capacity.cpuCores ||
    stage.ramGiB > capacity.ramGiB ||
    stage.gpuCount > capacity.gpuCount ||
    stage.minimumGpuVramGiB > capacity.perGpuVramGiB ||
    stage.scratchGiB > capacity.scratchGiB
  ) {
    fail("EXECUTION_CAPACITY_EXCEEDED", `Stage ${stage.id} exceeds its declared adapter capacity.`);
  }
}

function stagePlanById(plan: FoundryProviderPlanEvidenceV0): ReadonlyMap<string, FoundryProviderPlanEvidenceV0["stages"][number]> {
  return new Map(plan.stages.map((stage) => [stage.stageId, stage] as const));
}

export interface LocalCudaProcessRunner {
  run(invocation: FoundryProviderInvocation): Promise<FoundryProviderInvocationReceipt>;
}

export interface LocalCudaAdapterConfig {
  readonly providerAdapterId: string;
  readonly providerAdapterVersion: string;
  readonly capacity: FoundryAdapterCapacity;
  readonly allowedCapacityClasses: readonly string[];
  readonly allowedContainerImages: readonly string[];
  readonly allowedNetworkAccess: readonly ("none" | "object_storage_only" | "restricted")[];
}

export class LocalCudaExecutionAdapter implements FoundryExecutionProviderAdapter {
  readonly providerKind = "local_cuda" as const;
  readonly providerAdapterId: string;
  readonly providerAdapterVersion: string;
  readonly #config: LocalCudaAdapterConfig;
  readonly #runner: LocalCudaProcessRunner;

  constructor(config: LocalCudaAdapterConfig, runner: LocalCudaProcessRunner) {
    assertSafeId(config.providerAdapterId, "local CUDA adapter ID");
    assertCapacity(config.capacity, "local CUDA capacity", true);
    canonicalSortedUnique(config.allowedCapacityClasses, "allowed local capacity classes");
    canonicalSortedUnique(config.allowedContainerImages, "allowed local container images");
    canonicalSortedUnique(config.allowedNetworkAccess, "allowed local network modes");
    this.providerAdapterId = config.providerAdapterId;
    this.providerAdapterVersion = config.providerAdapterVersion;
    this.#config = config;
    this.#runner = runner;
  }

  prepare(context: FoundryAdapterPreparationContext): CanonicalJson {
    if (context.jobSpec.providerKind !== "local_cuda") {
      fail("EXECUTION_ADAPTER_KIND_MISMATCH", "Local CUDA adapter requires a local_cuda JobSpec.");
    }
    assertPinnedAllowlistedImages(context.jobSpec, this.#config.allowedContainerImages);
    const capacityClasses = new Set(this.#config.allowedCapacityClasses);
    const networkModes = new Set(this.#config.allowedNetworkAccess);
    const planStages = stagePlanById(context.providerPlanEvidence);
    const stages = context.jobSpec.stages.map((stage) => {
      const stagePlan = planStages.get(stage.id);
      if (stagePlan === undefined || !capacityClasses.has(stagePlan.capacityClass)) {
        fail("UNKNOWN_EXECUTION_CAPACITY_CLASS", `Stage ${stage.id} uses an unapproved local capacity class.`);
      }
      if (!networkModes.has(stage.networkAccess)) {
        fail("EXECUTION_NETWORK_MODE_FORBIDDEN", `Stage ${stage.id} requests a forbidden network mode.`);
      }
      assertStageCapacity(stage, this.#config.capacity);
      return {
        id: stage.id,
        dependsOn: stage.dependsOn,
        containerImage: stage.containerImage,
        command: stage.command,
        networkAccess: stage.networkAccess,
        capacityClass: stagePlan.capacityClass,
        maximumRuntimeSeconds: stagePlan.maximumRuntimeSeconds,
      };
    });
    return toCanonicalJson({
      schemaVersion: FOUNDRY_LOCAL_CUDA_ADAPTER_PLAN_V0,
      authority: "none",
      providerKind: this.providerKind,
      providerAdapterId: this.providerAdapterId,
      providerAdapterVersion: this.providerAdapterVersion,
      executionEnvelopeSha256: context.executionEnvelopeSha256,
      jobSpecSha256: computeFoundryJobSpecSha256(context.jobSpec),
      sourceMountMode: "read_only",
      outputPrefix: context.jobSpec.outputPrefix,
      capacity: this.#config.capacity,
      stages,
    });
  }

  invoke(invocation: FoundryProviderInvocation): Promise<FoundryProviderInvocationReceipt> {
    return this.#runner.run(invocation);
  }
}

export interface RunPodHttpClient {
  submit(invocation: FoundryProviderInvocation): Promise<FoundryProviderInvocationReceipt>;
}

export interface RunPodAdapterConfig {
  readonly providerAdapterId: string;
  readonly providerAdapterVersion: string;
  readonly requestPath: string;
  readonly templateId: string;
  readonly capacityClasses: Readonly<Record<string, FoundryAdapterCapacity>>;
  readonly allowedContainerImages: readonly string[];
  readonly allowedNetworkAccess: readonly ("none" | "object_storage_only" | "restricted")[];
}

export class RunPodExecutionAdapter implements FoundryExecutionProviderAdapter {
  readonly providerKind = "runpod" as const;
  readonly providerAdapterId: string;
  readonly providerAdapterVersion: string;
  readonly #config: RunPodAdapterConfig;
  readonly #client: RunPodHttpClient;

  constructor(config: RunPodAdapterConfig, client: RunPodHttpClient) {
    assertSafeId(config.providerAdapterId, "RunPod adapter ID");
    assertSafeId(config.templateId, "RunPod template ID");
    if (!SAFE_PATH.test(config.requestPath) || config.requestPath.includes("..")) {
      fail("INVALID_EXECUTION_ADAPTER_CONFIG", "RunPod request path must be a fixed safe relative API path.");
    }
    const capacityClassIds = Object.keys(config.capacityClasses).sort();
    canonicalSortedUnique(capacityClassIds, "RunPod capacity classes");
    for (const id of capacityClassIds) {
      const capacity = config.capacityClasses[id];
      if (capacity === undefined) {
        fail("INVALID_EXECUTION_ADAPTER_CONFIG", `RunPod capacity ${id} is missing.`);
      }
      assertCapacity(capacity, `RunPod capacity ${id}`, false);
    }
    canonicalSortedUnique(config.allowedContainerImages, "allowed RunPod container images");
    canonicalSortedUnique(config.allowedNetworkAccess, "allowed RunPod network modes");
    this.providerAdapterId = config.providerAdapterId;
    this.providerAdapterVersion = config.providerAdapterVersion;
    this.#config = config;
    this.#client = client;
  }

  prepare(context: FoundryAdapterPreparationContext): CanonicalJson {
    if (context.jobSpec.providerKind !== "runpod" || context.computeApproval === null) {
      fail("EXECUTION_ADAPTER_KIND_MISMATCH", "RunPod adapter requires a runpod JobSpec and compute approval.");
    }
    if (context.jobSpec.objectStorageProfile === null) {
      fail("EXECUTION_OBJECT_STORAGE_REQUIRED", "RunPod execution requires a named object-storage profile.");
    }
    assertPinnedAllowlistedImages(context.jobSpec, this.#config.allowedContainerImages);
    const networkModes = new Set(this.#config.allowedNetworkAccess);
    const planStages = stagePlanById(context.providerPlanEvidence);
    const stages = context.jobSpec.stages.map((stage) => {
      const stagePlan = planStages.get(stage.id);
      const capacity = stagePlan === undefined ? undefined : this.#config.capacityClasses[stagePlan.capacityClass];
      if (stagePlan === undefined || capacity === undefined) {
        fail("UNKNOWN_EXECUTION_CAPACITY_CLASS", `Stage ${stage.id} uses an unknown RunPod capacity class.`);
      }
      if (!networkModes.has(stage.networkAccess)) {
        fail("EXECUTION_NETWORK_MODE_FORBIDDEN", `Stage ${stage.id} requests a forbidden network mode.`);
      }
      assertStageCapacity(stage, capacity);
      return {
        id: stage.id,
        dependsOn: stage.dependsOn,
        containerImage: stage.containerImage,
        command: stage.command,
        networkAccess: stage.networkAccess,
        capacityClass: stagePlan.capacityClass,
        maximumRuntimeSeconds: stagePlan.maximumRuntimeSeconds,
      };
    });
    const policy = context.executionPolicy;
    return toCanonicalJson({
      schemaVersion: FOUNDRY_RUNPOD_ADAPTER_PLAN_V0,
      authority: "none",
      providerKind: this.providerKind,
      providerAdapterId: this.providerAdapterId,
      providerAdapterVersion: this.providerAdapterVersion,
      deterministicRequest: {
        method: "POST",
        path: this.#config.requestPath,
        clientRequestId: `runpod-${context.executionEnvelopeSha256.slice(7, 39)}`,
        templateId: this.#config.templateId,
        projectId: context.jobSpec.projectId,
        jobId: context.jobSpec.id,
        executionEnvelopeSha256: context.executionEnvelopeSha256,
        objectStorageProfile: context.jobSpec.objectStorageProfile,
        sourceMountMode: "read_only",
        outputPrefix: context.jobSpec.outputPrefix,
        stages,
      },
      killBudgetPolicy: {
        currency: "USD",
        estimatedCostMicroUsd: context.providerPlanEvidence.estimatedCostMicroUsd,
        approvedMaximumCostMicroUsd: context.computeApproval.maximumCostMicroUsd,
        costWarningMicroUsd: policy.costWarningMicroUsd,
        costHardStopMicroUsd: policy.costHardStopMicroUsd,
        terminationReserveMicroUsd: policy.terminationReserveMicroUsd,
        absoluteCostCapMicroUsd: policy.absoluteCostCapMicroUsd,
        maximumWallClockSeconds: policy.maximumWallClockSeconds,
        workerSelfDeadlineSeconds: policy.workerSelfDeadlineSeconds,
        providerMaximumExecutionTtlSeconds: policy.providerMaximumExecutionTtlSeconds,
        observationIntervalSeconds: policy.observationIntervalSeconds,
        costObservationMaximumAgeSeconds: policy.costObservationMaximumAgeSeconds,
        terminationConfirmationTimeoutSeconds: policy.terminationConfirmationTimeoutSeconds,
        killSwitchRequired: true,
      },
    });
  }

  invoke(invocation: FoundryProviderInvocation): Promise<FoundryProviderInvocationReceipt> {
    return this.#client.submit(invocation);
  }
}

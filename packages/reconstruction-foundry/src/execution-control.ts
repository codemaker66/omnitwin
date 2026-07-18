import { FoundryIntegrityError } from "./errors.js";
import { domainSeparatedSha256, toCanonicalJson } from "./canonical-json.js";

export const FOUNDRY_EXECUTION_SUBJECT_V0 = "omnitwin.foundry.execution-subject.v0";
export const FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0 = 1;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MICRO_USD_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;
const MAX_MICRO_USD = 9_223_372_036_854_775_807n;
const PINNED_ADAPTER_VERSION_PATTERN = /^(?:(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?|git-[a-f0-9]{40}|sha256-[a-f0-9]{64})$/u;

export type ExecutionTerminalState =
  | "terminal_succeeded"
  | "terminal_failed"
  | "terminal_cancelled"
  | "terminal_killed"
  | "terminal_budget_exceeded"
  | "terminal_validation_failed"
  | "terminal_provider_lost";

export type ExecutionState =
  | "authorized"
  | "submit_pending"
  | "provider_unknown"
  | "queued"
  | "running"
  | "checkpointing"
  | "stop_pending"
  | "terminating"
  | "termination_unconfirmed"
  | "validating"
  | ExecutionTerminalState;

export type ProviderObservedState =
  | "queued"
  | "running"
  | "checkpointing"
  | "terminating"
  | "termination_unconfirmed"
  | "validating"
  | "terminal_succeeded"
  | "terminal_failed"
  | "terminal_cancelled"
  | "terminal_provider_lost";

export type StopReason =
  | "operator_requested"
  | "budget_hard_stop"
  | "meter_stale"
  | "kill_switch"
  | "checkpoint_incompatible"
  | "command_failure";

export type OutboxCommandKind =
  | "provider_submit"
  | "provider_reconcile"
  | "provider_poll"
  | "provider_checkpoint"
  | "provider_stop";

export type OutboxCommandStatus =
  | "pending"
  | "claimed"
  | "succeeded"
  | "failed"
  | "uncertain";

export interface FoundryExecutionBudgetPolicyV0 {
  readonly currency: "USD";
  readonly costWarningMicroUsd: string;
  readonly costHardStopMicroUsd: string;
  readonly terminationReserveMicroUsd: string;
  readonly absoluteCostCapMicroUsd: string;
  readonly costObservationMaximumAgeSeconds: number;
}

export interface FoundryCheckpointContractV0 {
  readonly format: string;
  readonly formatVersion: string;
  readonly stageId: string;
  readonly workerImageSha256: string;
  readonly recipeSha256: string;
  readonly stageGraphSha256: string;
  readonly ingestManifestSha256: string;
  readonly checkpointCommandSha256: string;
  readonly inputCompatibilitySha256: string;
}

export interface FoundryExecutionSubjectV0 {
  readonly schemaVersion: typeof FOUNDRY_EXECUTION_SUBJECT_V0;
  readonly subjectId: string;
  readonly projectId: string;
  readonly jobSpecSha256: string;
  readonly executionEnvelopeSha256: string;
  readonly ingestManifestSha256: string;
  readonly intakeAdmissionResultSha256: string;
  readonly intakeStagingIndexSha256: string;
  readonly providerPlanSha256: string;
  readonly executionPolicySha256: string;
  readonly executionConfirmationSha256: string;
  readonly rightsApprovalSha256: string;
  readonly rightsPolicyEvidenceSha256: string;
  readonly rightsPolicyDefinitionSha256: string;
  readonly computeApprovalSha256: string | null;
  readonly providerKind: string;
  readonly providerAdapterId: string;
  readonly providerAdapterVersion: string;
  readonly providerAdapterArtifactSha256: string;
  readonly providerDeploymentSha256: string;
  readonly workerProfileSha256s: readonly string[];
  readonly pricingSnapshotSha256: string;
  readonly pricingSnapshotExpiresAt: string;
  readonly createdAt: string;
  readonly dispatchDeadline: string;
  readonly maximumAttempts: typeof FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0;
  readonly budgetPolicy: FoundryExecutionBudgetPolicyV0;
  readonly checkpointContract: FoundryCheckpointContractV0 | null;
}

export interface FoundryCheckpointCandidateV0 extends FoundryCheckpointContractV0 {
  readonly subjectSha256: string;
  readonly attemptId: string;
  readonly checkpointSha256: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly ordinal: number;
  readonly complete: true;
  readonly verificationResult: "verified_compatible";
  readonly verifiedAt: string;
  readonly progressCursor: string;
  readonly producerProviderState: "inactive" | "terminal";
  readonly producerStateVerifiedAt: string;
}

export interface CheckpointCompatibilityResult {
  readonly compatible: boolean;
  readonly mismatches: readonly string[];
}

export interface FencingLease {
  readonly ownerId: string;
  readonly fenceToken: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface StopIntent {
  readonly requestedAt: string;
  readonly firstReason: StopReason;
  readonly reasons: readonly StopReason[];
}

export interface OutboxCommandRecord {
  readonly commandId: string;
  readonly kind: OutboxCommandKind;
  readonly status: OutboxCommandStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly claimedBy: string | null;
  readonly claimedFenceToken: string | null;
  readonly reconcilesCommandId: string | null;
  readonly resultCode: string | null;
  readonly reconciliationObservationId: string | null;
}

export interface CostObservationRecord {
  readonly observationId: string;
  readonly observedAt: string;
  readonly providerAccruedMicroUsd: string;
  readonly elapsedRateProjectionMicroUsd: string;
  readonly unbilledFixedMicroUsd: string;
  readonly unbilledStorageMicroUsd: string;
  readonly unbilledEgressMicroUsd: string;
  readonly conservativeExposureMicroUsd: string;
}

export interface ProviderObservationRecord {
  readonly observationId: string;
  readonly observedAt: string;
  readonly state: ProviderObservedState;
  readonly providerExecutionRefSha256: string;
}

export interface FoundryExecutionControlStateV0 {
  readonly subject: FoundryExecutionSubjectV0;
  readonly subjectSha256: string;
  readonly attemptId: string;
  readonly attemptNumber: 1;
  readonly state: ExecutionState;
  readonly sequence: number;
  readonly revision: number;
  readonly lastEventAt: string;
  readonly highestFenceToken: string;
  readonly activeLease: FencingLease | null;
  readonly stopIntent: StopIntent | null;
  readonly killSwitchEngagedAt: string | null;
  readonly providerExecutionRefSha256: string | null;
  readonly providerActiveSince: string | null;
  readonly outbox: readonly OutboxCommandRecord[];
  readonly costObservations: readonly CostObservationRecord[];
  readonly providerObservations: readonly ProviderObservationRecord[];
  readonly conservativeExposureMicroUsd: string;
  readonly lastMeterObservedAt: string | null;
  readonly costWarningTriggeredAt: string | null;
  readonly absoluteCostCapBreachedAt: string | null;
  readonly latestCompatibleCheckpoint: FoundryCheckpointCandidateV0 | null;
  readonly killSwitchScope: "global" | "project" | "subject" | "attempt" | null;
  readonly killSwitchScopeKey: string | null;
  readonly killSwitchGeneration: number | null;
}

interface FencedPayload {
  readonly ownerId: string;
  readonly fenceToken: string;
}

export type FoundryExecutionEventPayloadV0 =
  | { readonly type: "attempt_authorized" }
  | {
      readonly type: "lease_acquired";
      readonly ownerId: string;
      readonly fenceToken: string;
      readonly expiresAt: string;
    }
  | (FencedPayload & {
      readonly type: "lease_renewed";
      readonly expiresAt: string;
    })
  | (FencedPayload & { readonly type: "lease_released" })
  | (FencedPayload & {
      readonly type: "outbox_command_enqueued";
      readonly commandId: string;
      readonly commandKind: OutboxCommandKind;
      readonly reconcilesCommandId: string | null;
    })
  | (FencedPayload & {
      readonly type: "outbox_command_claimed";
      readonly commandId: string;
    })
  | (FencedPayload & {
      readonly type: "outbox_command_succeeded";
      readonly commandId: string;
      readonly resultCode: string;
    })
  | (FencedPayload & {
      readonly type: "outbox_command_failed";
      readonly commandId: string;
      readonly resultCode: string;
    })
  | (FencedPayload & {
      readonly type: "outbox_command_uncertain";
      readonly commandId: string;
      readonly resultCode: string;
    })
  | (FencedPayload & {
      readonly type: "provider_reconciled";
      readonly commandId: string;
      readonly observationId: string;
      readonly outcome: "not_found" | ProviderObservedState;
      readonly providerExecutionRefSha256: string | null;
    })
  | (FencedPayload & {
      readonly type: "provider_state_observed";
      readonly observationId: string;
      readonly observedAt: string;
      readonly providerState: ProviderObservedState;
      readonly providerExecutionRefSha256: string;
    })
  | (FencedPayload & {
      readonly type: "cost_observed";
      readonly observationId: string;
      readonly observedAt: string;
      readonly providerAccruedMicroUsd: string;
      readonly elapsedRateProjectionMicroUsd: string;
      readonly unbilledFixedMicroUsd: string;
      readonly unbilledStorageMicroUsd: string;
      readonly unbilledEgressMicroUsd: string;
    })
  | (FencedPayload & {
      readonly type: "control_tick";
      readonly checkedAt: string;
    })
  | {
      readonly type: "stop_requested";
      readonly reason: StopReason;
      readonly requestedBy: string;
    }
  | {
      readonly type: "kill_switch_engaged";
      readonly requestedBy: string;
      readonly reasonCode: string;
      readonly scope: "global" | "project" | "subject" | "attempt";
      readonly scopeKey: string;
      readonly generation: number;
    }
  | (FencedPayload & {
      readonly type: "checkpoint_observed";
      readonly checkpoint: FoundryCheckpointCandidateV0;
    })
  | (FencedPayload & {
      readonly type: "validation_completed";
      readonly outcome: "succeeded" | "failed";
      readonly resultCode: string;
    });

export interface ExecutionTransitionInput {
  readonly attemptId: string;
  readonly sequence: number;
  readonly revision: number;
  readonly occurredAt: string;
  readonly payload: FoundryExecutionEventPayloadV0;
}

export interface ExecutionControlView {
  readonly permittedCommandKinds: readonly OutboxCommandKind[];
  readonly unresolvedCommandIds: readonly string[];
  readonly submitBlocked: boolean;
  readonly stopRequired: boolean;
  readonly terminal: boolean;
}

function fail(code: string, message: string): never {
  throw new FoundryIntegrityError(code, message);
}

function assertId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) fail("INVALID_EXECUTION_ID", `${label} is not a bounded ASCII identifier.`);
}

function assertCode(value: string, label: string): void {
  if (!CODE_PATTERN.test(value)) fail("INVALID_EXECUTION_CODE", `${label} is not a bounded lowercase code.`);
}

function assertDigest(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) fail("INVALID_EXECUTION_DIGEST", `${label} must be a lowercase sha256 digest.`);
}

function assertUtc(value: string, label: string): number {
  if (!UTC_PATTERN.test(value)) fail("INVALID_EXECUTION_TIMESTAMP", `${label} must be canonical UTC with millisecond precision.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail("INVALID_EXECUTION_TIMESTAMP", `${label} is not a real canonical UTC timestamp.`);
  }
  return parsed;
}

function assertNonnegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("INVALID_EXECUTION_INTEGER", `${label} must be a non-negative safe integer.`);
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("INVALID_EXECUTION_INTEGER", `${label} must be a positive safe integer.`);
  }
}

function isLiteralTrue(value: unknown): boolean {
  return value === true;
}

function parseMicroUsd(value: string, label: string): bigint {
  if (!MICRO_USD_PATTERN.test(value)) {
    fail("INVALID_MICRO_USD", `${label} must be a canonical unsigned base-10 integer string.`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_MICRO_USD) {
    fail("INVALID_MICRO_USD", `${label} exceeds the PostgreSQL signed BIGINT ceiling.`);
  }
  return parsed;
}

function parseFenceToken(value: string, label: string): bigint {
  const parsed = parseMicroUsd(value, label);
  if (parsed <= 0n) fail("INVALID_EXECUTION_FENCE", `${label} must be greater than zero.`);
  return parsed;
}

function saturatingMicroUsdSum(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) {
    total += value;
    if (total >= MAX_MICRO_USD) return MAX_MICRO_USD;
  }
  return total;
}

function conservativeExposureForObservation(
  policy: FoundryExecutionBudgetPolicyV0,
  observation: Pick<
    CostObservationRecord,
    | "providerAccruedMicroUsd"
    | "elapsedRateProjectionMicroUsd"
    | "unbilledFixedMicroUsd"
    | "unbilledStorageMicroUsd"
    | "unbilledEgressMicroUsd"
  >,
): string {
  const accrued = parseMicroUsd(observation.providerAccruedMicroUsd, "providerAccruedMicroUsd");
  const elapsedProjection = parseMicroUsd(
    observation.elapsedRateProjectionMicroUsd,
    "elapsedRateProjectionMicroUsd",
  );
  const exposure = saturatingMicroUsdSum([
    accrued > elapsedProjection ? accrued : elapsedProjection,
    parseMicroUsd(observation.unbilledFixedMicroUsd, "unbilledFixedMicroUsd"),
    parseMicroUsd(observation.unbilledStorageMicroUsd, "unbilledStorageMicroUsd"),
    parseMicroUsd(observation.unbilledEgressMicroUsd, "unbilledEgressMicroUsd"),
    parseMicroUsd(policy.terminationReserveMicroUsd, "terminationReserveMicroUsd"),
  ]);
  return exposure.toString(10);
}

function copyCheckpointContract(contract: FoundryCheckpointContractV0): FoundryCheckpointContractV0 {
  return {
    format: contract.format,
    formatVersion: contract.formatVersion,
    stageId: contract.stageId,
    workerImageSha256: contract.workerImageSha256,
    recipeSha256: contract.recipeSha256,
    stageGraphSha256: contract.stageGraphSha256,
    ingestManifestSha256: contract.ingestManifestSha256,
    checkpointCommandSha256: contract.checkpointCommandSha256,
    inputCompatibilitySha256: contract.inputCompatibilitySha256,
  };
}

function copySubject(subject: FoundryExecutionSubjectV0): FoundryExecutionSubjectV0 {
  return {
    schemaVersion: subject.schemaVersion,
    subjectId: subject.subjectId,
    projectId: subject.projectId,
    jobSpecSha256: subject.jobSpecSha256,
    executionEnvelopeSha256: subject.executionEnvelopeSha256,
    ingestManifestSha256: subject.ingestManifestSha256,
    intakeAdmissionResultSha256: subject.intakeAdmissionResultSha256,
    intakeStagingIndexSha256: subject.intakeStagingIndexSha256,
    providerPlanSha256: subject.providerPlanSha256,
    executionPolicySha256: subject.executionPolicySha256,
    executionConfirmationSha256: subject.executionConfirmationSha256,
    rightsApprovalSha256: subject.rightsApprovalSha256,
    rightsPolicyEvidenceSha256: subject.rightsPolicyEvidenceSha256,
    rightsPolicyDefinitionSha256: subject.rightsPolicyDefinitionSha256,
    computeApprovalSha256: subject.computeApprovalSha256,
    providerKind: subject.providerKind,
    providerAdapterId: subject.providerAdapterId,
    providerAdapterVersion: subject.providerAdapterVersion,
    providerAdapterArtifactSha256: subject.providerAdapterArtifactSha256,
    providerDeploymentSha256: subject.providerDeploymentSha256,
    workerProfileSha256s: [...subject.workerProfileSha256s],
    pricingSnapshotSha256: subject.pricingSnapshotSha256,
    pricingSnapshotExpiresAt: subject.pricingSnapshotExpiresAt,
    createdAt: subject.createdAt,
    dispatchDeadline: subject.dispatchDeadline,
    maximumAttempts: subject.maximumAttempts,
    budgetPolicy: { ...subject.budgetPolicy },
    checkpointContract:
      subject.checkpointContract === null ? null : copyCheckpointContract(subject.checkpointContract),
  };
}

export function assertFoundryExecutionSubjectV0(
  subject: FoundryExecutionSubjectV0,
): void {
  if (String(subject.schemaVersion) !== FOUNDRY_EXECUTION_SUBJECT_V0) {
    fail("INVALID_EXECUTION_SUBJECT_VERSION", "Execution subject uses an unsupported schema version.");
  }
  assertId(subject.subjectId, "subjectId");
  assertId(subject.projectId, "projectId");
  assertId(subject.providerKind, "providerKind");
  assertId(subject.providerAdapterId, "providerAdapterId");
  assertDigest(subject.jobSpecSha256, "jobSpecSha256");
  assertDigest(subject.executionEnvelopeSha256, "executionEnvelopeSha256");
  assertDigest(subject.ingestManifestSha256, "ingestManifestSha256");
  assertDigest(subject.intakeAdmissionResultSha256, "intakeAdmissionResultSha256");
  assertDigest(subject.intakeStagingIndexSha256, "intakeStagingIndexSha256");
  assertDigest(subject.providerPlanSha256, "providerPlanSha256");
  assertDigest(subject.executionPolicySha256, "executionPolicySha256");
  assertDigest(subject.executionConfirmationSha256, "executionConfirmationSha256");
  assertDigest(subject.rightsApprovalSha256, "rightsApprovalSha256");
  assertDigest(subject.rightsPolicyEvidenceSha256, "rightsPolicyEvidenceSha256");
  assertDigest(subject.rightsPolicyDefinitionSha256, "rightsPolicyDefinitionSha256");
  const localProvider =
    subject.providerKind === "local_cpu" || subject.providerKind === "local_cuda";
  if (subject.computeApprovalSha256 === null) {
    if (!localProvider) {
      fail("COMPUTE_APPROVAL_REQUIRED", "Remote execution subjects require a compute approval digest.");
    }
  } else {
    assertDigest(subject.computeApprovalSha256, "computeApprovalSha256");
    if (localProvider) {
      fail("LOCAL_COMPUTE_APPROVAL_FORBIDDEN", "Local execution subjects cannot bind a remote compute approval.");
    }
  }
  assertDigest(subject.providerAdapterArtifactSha256, "providerAdapterArtifactSha256");
  assertDigest(subject.providerDeploymentSha256, "providerDeploymentSha256");
  if (
    subject.workerProfileSha256s.length === 0 ||
    subject.workerProfileSha256s.length > 1_000
  ) {
    fail("INVALID_WORKER_PROFILE_SET", "Execution subjects require one to 1,000 trusted worker-profile digests.");
  }
  for (let index = 0; index < subject.workerProfileSha256s.length; index += 1) {
    const digest = subject.workerProfileSha256s[index];
    if (digest === undefined) fail("INVALID_WORKER_PROFILE_SET", "Worker-profile digest is missing.");
    assertDigest(digest, "workerProfileSha256");
    const previousDigest = index > 0
      ? subject.workerProfileSha256s[index - 1]
      : undefined;
    if (previousDigest !== undefined && previousDigest >= digest) {
      fail("INVALID_WORKER_PROFILE_SET", "Worker-profile digests must be unique and sorted.");
    }
  }
  assertDigest(subject.pricingSnapshotSha256, "pricingSnapshotSha256");
  if (!PINNED_ADAPTER_VERSION_PATTERN.test(subject.providerAdapterVersion)) {
    fail("INVALID_PROVIDER_ADAPTER_VERSION", "providerAdapterVersion must be exact SemVer, git commit, or sha256 digest.");
  }
  const createdAt = assertUtc(subject.createdAt, "createdAt");
  const dispatchDeadline = assertUtc(subject.dispatchDeadline, "dispatchDeadline");
  const pricingSnapshotExpiresAt = assertUtc(subject.pricingSnapshotExpiresAt, "pricingSnapshotExpiresAt");
  if (dispatchDeadline <= createdAt || dispatchDeadline > pricingSnapshotExpiresAt) {
    fail("INVALID_EXECUTION_DISPATCH_WINDOW", "Dispatch deadline must follow creation and not outlive the pricing snapshot.");
  }
  if (Number(subject.maximumAttempts) !== FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0) {
    fail("EXECUTION_RETRIES_FORBIDDEN", "Execution V0 requires maximumAttempts to equal one.");
  }
  if (String(subject.budgetPolicy.currency) !== "USD") {
    fail("INVALID_EXECUTION_CURRENCY", "Execution V0 accounts for provider cost in USD microunits only.");
  }
  const warning = parseMicroUsd(subject.budgetPolicy.costWarningMicroUsd, "costWarningMicroUsd");
  const hardStop = parseMicroUsd(subject.budgetPolicy.costHardStopMicroUsd, "costHardStopMicroUsd");
  const terminationReserve = parseMicroUsd(
    subject.budgetPolicy.terminationReserveMicroUsd,
    "terminationReserveMicroUsd",
  );
  const absoluteCap = parseMicroUsd(subject.budgetPolicy.absoluteCostCapMicroUsd, "absoluteCostCapMicroUsd");
  assertPositiveSafeInteger(
    subject.budgetPolicy.costObservationMaximumAgeSeconds,
    "costObservationMaximumAgeSeconds",
  );
  if (warning >= hardStop) {
    fail("INVALID_EXECUTION_BUDGET", "The warning threshold must be lower than the hard-stop threshold.");
  }
  if (hardStop + terminationReserve > absoluteCap) {
    fail("INVALID_EXECUTION_BUDGET", "Hard stop plus termination reserve cannot exceed the absolute cost cap.");
  }
  if (subject.checkpointContract !== null) {
    assertId(subject.checkpointContract.format, "checkpoint format");
    assertId(subject.checkpointContract.formatVersion, "checkpoint formatVersion");
    assertId(subject.checkpointContract.stageId, "checkpoint stageId");
    assertDigest(subject.checkpointContract.workerImageSha256, "checkpoint workerImageSha256");
    assertDigest(subject.checkpointContract.recipeSha256, "checkpoint recipeSha256");
    assertDigest(subject.checkpointContract.stageGraphSha256, "checkpoint stageGraphSha256");
    assertDigest(subject.checkpointContract.ingestManifestSha256, "checkpoint ingestManifestSha256");
    assertDigest(subject.checkpointContract.checkpointCommandSha256, "checkpoint checkpointCommandSha256");
    assertDigest(subject.checkpointContract.inputCompatibilitySha256, "checkpoint inputCompatibilitySha256");
    if (subject.checkpointContract.ingestManifestSha256 !== subject.ingestManifestSha256) {
      fail("CHECKPOINT_SUBJECT_MISMATCH", "Checkpoint contract does not bind the execution ingest manifest.");
    }
  }
}

export function computeFoundryExecutionSubjectSha256(subject: FoundryExecutionSubjectV0): string {
  assertFoundryExecutionSubjectV0(subject);
  return `sha256:${domainSeparatedSha256("OMNITWIN_FOUNDRY_EXECUTION_SUBJECT_V0", toCanonicalJson(subject))}`;
}

export function isTerminalExecutionState(state: ExecutionState): state is ExecutionTerminalState {
  return state.startsWith("terminal_");
}

function checkpointFieldMismatches(
  contract: FoundryCheckpointContractV0,
  candidate: FoundryCheckpointCandidateV0,
): string[] {
  const mismatches: string[] = [];
  if (candidate.format !== contract.format) mismatches.push("format");
  if (candidate.formatVersion !== contract.formatVersion) mismatches.push("formatVersion");
  if (candidate.stageId !== contract.stageId) mismatches.push("stageId");
  if (candidate.workerImageSha256 !== contract.workerImageSha256) mismatches.push("workerImageSha256");
  if (candidate.recipeSha256 !== contract.recipeSha256) mismatches.push("recipeSha256");
  if (candidate.stageGraphSha256 !== contract.stageGraphSha256) mismatches.push("stageGraphSha256");
  if (candidate.ingestManifestSha256 !== contract.ingestManifestSha256) mismatches.push("ingestManifestSha256");
  if (candidate.checkpointCommandSha256 !== contract.checkpointCommandSha256) mismatches.push("checkpointCommandSha256");
  if (candidate.inputCompatibilitySha256 !== contract.inputCompatibilitySha256) mismatches.push("inputCompatibilitySha256");
  return mismatches;
}

export function validateFoundryCheckpointCompatibility(
  state: FoundryExecutionControlStateV0,
  checkpoint: FoundryCheckpointCandidateV0,
): CheckpointCompatibilityResult {
  const mismatches: string[] = [];
  const contract = state.subject.checkpointContract;
  if (contract === null) return { compatible: false, mismatches: ["checkpointing_disabled"] };
  assertDigest(checkpoint.subjectSha256, "checkpoint subjectSha256");
  assertId(checkpoint.attemptId, "checkpoint attemptId");
  assertDigest(checkpoint.checkpointSha256, "checkpoint checkpointSha256");
  assertNonnegativeSafeInteger(checkpoint.sizeBytes, "checkpoint sizeBytes");
  assertUtc(checkpoint.createdAt, "checkpoint createdAt");
  assertPositiveSafeInteger(checkpoint.ordinal, "checkpoint ordinal");
  assertId(checkpoint.progressCursor, "checkpoint progressCursor");
  const createdAt = assertUtc(checkpoint.createdAt, "checkpoint createdAt");
  const producerStateVerifiedAt = assertUtc(
    checkpoint.producerStateVerifiedAt,
    "checkpoint producerStateVerifiedAt",
  );
  const verifiedAt = assertUtc(checkpoint.verifiedAt, "checkpoint verifiedAt");
  if (!isLiteralTrue(checkpoint.complete)) mismatches.push("complete");
  if (String(checkpoint.verificationResult) !== "verified_compatible") mismatches.push("verificationResult");
  if (!["inactive", "terminal"].includes(String(checkpoint.producerProviderState))) {
    mismatches.push("producerProviderState");
  }
  if (producerStateVerifiedAt < createdAt || verifiedAt < producerStateVerifiedAt) {
    mismatches.push("verificationChronology");
  }
  if (
    state.latestCompatibleCheckpoint !== null &&
    checkpoint.ordinal <= state.latestCompatibleCheckpoint.ordinal
  ) {
    mismatches.push("ordinal");
  }
  if (!state.outbox.some((command) =>
    command.kind === "provider_checkpoint" && command.status === "succeeded"
  )) {
    mismatches.push("checkpointCommandNotSucceeded");
  }
  if (checkpoint.subjectSha256 !== state.subjectSha256) mismatches.push("subjectSha256");
  if (checkpoint.attemptId !== state.attemptId) mismatches.push("attemptId");
  mismatches.push(...checkpointFieldMismatches(contract, checkpoint));
  return { compatible: mismatches.length === 0, mismatches };
}

function requireActiveLease(
  state: FoundryExecutionControlStateV0,
  payload: FencedPayload,
  occurredAt: string,
): void {
  const lease = state.activeLease;
  if (lease === null) fail("EXECUTION_LEASE_REQUIRED", "A current fencing lease is required for this event.");
  if (payload.ownerId !== lease.ownerId || payload.fenceToken !== lease.fenceToken) {
    fail("STALE_EXECUTION_FENCE", "The execution write was made with a stale or foreign fencing token.");
  }
  if (assertUtc(occurredAt, "occurredAt") > assertUtc(lease.expiresAt, "lease expiresAt")) {
    fail("EXPIRED_EXECUTION_LEASE", "The execution write occurred after its fencing lease expired.");
  }
}

function findCommand(state: FoundryExecutionControlStateV0, commandId: string): OutboxCommandRecord {
  const command = state.outbox.find((candidate) => candidate.commandId === commandId);
  if (command === undefined) fail("UNKNOWN_OUTBOX_COMMAND", `Unknown outbox command ${commandId}.`);
  return command;
}

function replaceCommand(
  state: FoundryExecutionControlStateV0,
  replacement: OutboxCommandRecord,
): readonly OutboxCommandRecord[] {
  return state.outbox.map((command) =>
    command.commandId === replacement.commandId ? replacement : command,
  );
}

function unresolvedCommands(state: FoundryExecutionControlStateV0): readonly OutboxCommandRecord[] {
  return state.outbox.filter(
    (command) =>
      (command.status === "uncertain" ||
        (command.status === "claimed" && command.claimedFenceToken !== state.activeLease?.fenceToken)) &&
      command.reconciliationObservationId === null,
  );
}

function providerStateFromObservation(
  state: FoundryExecutionControlStateV0,
  observed: ProviderObservedState,
): ExecutionState {
  if (observed === "terminal_cancelled") return terminalFromStopIntent(state, "terminal_cancelled");
  if (observed === "terminal_succeeded") {
    if (state.stopIntent?.reasons.includes("kill_switch") === true) return "terminal_killed";
    if (state.stopIntent?.reasons.includes("budget_hard_stop") === true) return "terminal_budget_exceeded";
    return "validating";
  }
  if (observed === "terminal_failed" || observed === "terminal_provider_lost") return observed;
  if (state.stopIntent !== null && observed !== "terminating" && observed !== "termination_unconfirmed") {
    return "stop_pending";
  }
  return observed;
}

function terminalFromStopIntent(
  state: FoundryExecutionControlStateV0,
  fallback: ExecutionTerminalState,
): ExecutionTerminalState {
  if (state.stopIntent?.reasons.includes("kill_switch") === true) return "terminal_killed";
  if (state.stopIntent?.reasons.includes("budget_hard_stop") === true) return "terminal_budget_exceeded";
  if (state.stopIntent !== null) return "terminal_cancelled";
  return fallback;
}

function addStopIntent(
  state: FoundryExecutionControlStateV0,
  reason: StopReason,
  occurredAt: string,
): FoundryExecutionControlStateV0 {
  const existing = state.stopIntent;
  const stopIntent: StopIntent =
    existing === null
      ? { requestedAt: occurredAt, firstReason: reason, reasons: [reason] }
      : existing.reasons.includes(reason)
        ? existing
        : { ...existing, reasons: [...existing.reasons, reason] };
  let nextState: ExecutionState;
  if (state.state === "authorized" || state.state === "submit_pending") {
    nextState = reason === "kill_switch" ? "terminal_killed" : "terminal_cancelled";
  } else {
    nextState = "stop_pending";
  }
  return { ...state, stopIntent, state: nextState };
}

function assertProviderTransition(from: ExecutionState, to: ProviderObservedState): void {
  const allowed: Readonly<Record<string, readonly ProviderObservedState[]>> = {
    provider_unknown: [
      "queued", "running", "checkpointing", "terminating", "termination_unconfirmed",
      "validating", "terminal_succeeded", "terminal_failed", "terminal_cancelled", "terminal_provider_lost",
    ],
    queued: [
      "queued", "running", "checkpointing", "terminating", "termination_unconfirmed",
      "validating", "terminal_succeeded", "terminal_failed", "terminal_cancelled", "terminal_provider_lost",
    ],
    running: [
      "running", "checkpointing", "terminating", "termination_unconfirmed", "validating",
      "terminal_succeeded", "terminal_failed", "terminal_cancelled", "terminal_provider_lost",
    ],
    checkpointing: [
      "running", "checkpointing", "terminating", "termination_unconfirmed", "validating",
      "terminal_succeeded", "terminal_failed", "terminal_cancelled", "terminal_provider_lost",
    ],
    stop_pending: [
      "queued", "running", "checkpointing", "terminating", "termination_unconfirmed",
      "terminal_succeeded", "terminal_failed", "terminal_cancelled", "terminal_provider_lost",
    ],
    terminating: ["terminating", "termination_unconfirmed", "terminal_succeeded", "terminal_failed", "terminal_cancelled", "terminal_provider_lost"],
    termination_unconfirmed: ["terminating", "termination_unconfirmed", "terminal_succeeded", "terminal_failed", "terminal_cancelled", "terminal_provider_lost"],
    validating: ["validating", "terminal_failed", "terminal_provider_lost"],
  };
  if (allowed[from]?.includes(to) !== true) {
    fail("INVALID_PROVIDER_TRANSITION", `Provider state cannot transition execution from ${from} to ${to}.`);
  }
}

function commandKindAllowed(
  state: FoundryExecutionControlStateV0,
  kind: OutboxCommandKind,
  reconcilesCommandId: string | null,
): void {
  if (kind === "provider_submit") {
    if (state.state !== "authorized" || state.killSwitchEngagedAt !== null || state.stopIntent !== null) {
      fail("PROVIDER_SUBMIT_FORBIDDEN", "Provider submission is permitted only once from a live authorized state.");
    }
    if (state.outbox.some((command) => command.kind === "provider_submit")) {
      fail("EXECUTION_RETRIES_FORBIDDEN", "Execution V0 never creates a second provider submission command.");
    }
    if (reconcilesCommandId !== null) fail("INVALID_OUTBOX_RECONCILIATION", "Submit cannot reconcile another command.");
    return;
  }
  if (kind === "provider_reconcile") {
    if (state.state !== "provider_unknown" && state.state !== "termination_unconfirmed" && state.state !== "stop_pending") {
      fail("RECONCILIATION_NOT_REQUIRED", "Provider reconciliation is only valid for an unknown or unconfirmed execution.");
    }
    if (reconcilesCommandId === null) fail("RECONCILIATION_TARGET_REQUIRED", "A reconcile command must name its target command.");
    const target = findCommand(state, reconcilesCommandId);
    if (
      target.status !== "claimed" &&
      target.status !== "uncertain" &&
      !(target.kind === "provider_submit" && target.status === "succeeded")
    ) {
      fail("INVALID_RECONCILIATION_TARGET", "Only a potentially provider-visible command can be reconciled.");
    }
    if (target.reconciliationObservationId !== null) {
      fail("COMMAND_ALREADY_RECONCILED", "The target command has already been reconciled.");
    }
    if (state.outbox.some((command) =>
      command.kind === "provider_reconcile" &&
      command.reconcilesCommandId === reconcilesCommandId &&
      (command.status === "pending" || command.status === "claimed")
    )) {
      fail("RECONCILIATION_ALREADY_PENDING", "A reconciliation command is already active for the target.");
    }
    return;
  }
  if (reconcilesCommandId !== null) {
    fail("INVALID_OUTBOX_RECONCILIATION", "Only provider_reconcile may name a reconciliation target.");
  }
  if (unresolvedCommands(state).length > 0) {
    fail("RECONCILIATION_REQUIRED", "Uncertain provider effects must be reconciled before another provider command.");
  }
  if (kind === "provider_stop") {
    if (state.state !== "stop_pending" || state.providerExecutionRefSha256 === null) {
      fail("PROVIDER_STOP_NOT_READY", "Provider stop requires stop intent and a reconciled provider execution identity.");
    }
    return;
  }
  if (kind === "provider_checkpoint") {
    if (state.state !== "running" || state.subject.checkpointContract === null || state.stopIntent !== null) {
      fail("CHECKPOINT_COMMAND_FORBIDDEN", "Checkpoint requests require a running, checkpoint-enabled execution without stop intent.");
    }
    return;
  }
  if (!["queued", "running", "checkpointing", "terminating", "termination_unconfirmed", "validating"].includes(state.state)) {
    fail("PROVIDER_POLL_FORBIDDEN", "Provider poll is not valid in the current execution state.");
  }
}

function stateAfterCommandResult(
  state: FoundryExecutionControlStateV0,
  command: OutboxCommandRecord,
  status: "succeeded" | "failed" | "uncertain",
  occurredAt: string,
): FoundryExecutionControlStateV0 {
  if (status === "uncertain") {
    return {
      ...state,
      state: command.kind === "provider_stop" ? "termination_unconfirmed" : "provider_unknown",
    };
  }
  if (status === "succeeded") {
    if (command.kind === "provider_stop") return { ...state, state: "terminating" };
    if (command.kind === "provider_submit") return { ...state, state: "provider_unknown" };
    return state;
  }
  if (command.kind === "provider_submit") return { ...state, state: "terminal_failed" };
  if (command.kind === "provider_stop") return { ...state, state: "termination_unconfirmed" };
  if (command.kind === "provider_checkpoint") return addStopIntent(state, "command_failure", occurredAt);
  return { ...state, state: "provider_unknown" };
}

function ensureProviderReference(
  existing: string | null,
  candidate: string,
): string {
  assertDigest(candidate, "providerExecutionRefSha256");
  if (existing !== null && existing !== candidate) {
    fail("PROVIDER_IDENTITY_CHANGED", "Provider reconciliation attempted to replace the bound provider execution identity.");
  }
  return candidate;
}

function updateProviderObservation(
  state: FoundryExecutionControlStateV0,
  payload: Extract<FoundryExecutionEventPayloadV0, { readonly type: "provider_state_observed" }>,
): FoundryExecutionControlStateV0 {
  assertId(payload.observationId, "provider observationId");
  const observedAt = assertUtc(payload.observedAt, "provider observedAt");
  const existing = state.providerObservations.find((item) => item.observationId === payload.observationId);
  if (existing !== undefined) {
    if (
      existing.observedAt !== payload.observedAt ||
      existing.state !== payload.providerState ||
      existing.providerExecutionRefSha256 !== payload.providerExecutionRefSha256
    ) {
      fail("CONFLICTING_PROVIDER_OBSERVATION", "A provider observation ID was reused with different content.");
    }
    return state;
  }
  if (unresolvedCommands(state).length > 0) {
    fail("RECONCILIATION_REQUIRED", "Uncertain commands require an explicit reconciliation observation.");
  }
  const providerExecutionRefSha256 = ensureProviderReference(
    state.providerExecutionRefSha256,
    payload.providerExecutionRefSha256,
  );
  const latest = state.providerObservations.reduce<ProviderObservationRecord | null>(
    (current, item) =>
      current === null || assertUtc(item.observedAt, "provider observedAt") > assertUtc(current.observedAt, "provider observedAt")
        ? item
        : current,
    null,
  );
  const record: ProviderObservationRecord = {
    observationId: payload.observationId,
    observedAt: payload.observedAt,
    state: payload.providerState,
    providerExecutionRefSha256,
  };
  const observations = [...state.providerObservations, record];
  if (latest !== null && observedAt < assertUtc(latest.observedAt, "provider observedAt")) {
    return { ...state, providerExecutionRefSha256, providerObservations: observations };
  }
  if (latest !== null && observedAt === assertUtc(latest.observedAt, "provider observedAt") && latest.state !== payload.providerState) {
    fail("AMBIGUOUS_PROVIDER_OBSERVATION", "Different provider states cannot share the same observation timestamp.");
  }
  assertProviderTransition(state.state, payload.providerState);
  const nextState = providerStateFromObservation(state, payload.providerState);
  return {
    ...state,
    state: nextState,
    providerExecutionRefSha256,
    providerActiveSince:
      state.providerActiveSince ??
      (nextState === "queued" || nextState === "running" || nextState === "checkpointing" ? payload.observedAt : null),
    providerObservations: observations,
  };
}

function updateCostObservation(
  state: FoundryExecutionControlStateV0,
  payload: Extract<FoundryExecutionEventPayloadV0, { readonly type: "cost_observed" }>,
  occurredAt: string,
): FoundryExecutionControlStateV0 {
  if (!["provider_unknown", "queued", "running", "checkpointing", "stop_pending", "terminating", "termination_unconfirmed", "validating"].includes(state.state)) {
    fail("COST_OBSERVATION_NOT_ALLOWED", "Cost observations require a non-terminal provider-visible attempt.");
  }
  assertId(payload.observationId, "cost observationId");
  const observedAtMs = assertUtc(payload.observedAt, "cost observedAt");
  if (observedAtMs > assertUtc(occurredAt, "occurredAt")) {
    fail("FUTURE_COST_OBSERVATION", "Cost observation time cannot be later than its ledger event.");
  }
  const conservativeExposureMicroUsd = conservativeExposureForObservation(
    state.subject.budgetPolicy,
    payload,
  );
  const existing = state.costObservations.find((item) => item.observationId === payload.observationId);
  if (existing !== undefined) {
    if (
      existing.observedAt !== payload.observedAt ||
      existing.providerAccruedMicroUsd !== payload.providerAccruedMicroUsd ||
      existing.elapsedRateProjectionMicroUsd !== payload.elapsedRateProjectionMicroUsd ||
      existing.unbilledFixedMicroUsd !== payload.unbilledFixedMicroUsd ||
      existing.unbilledStorageMicroUsd !== payload.unbilledStorageMicroUsd ||
      existing.unbilledEgressMicroUsd !== payload.unbilledEgressMicroUsd
    ) {
      fail("CONFLICTING_COST_OBSERVATION", "A meter observation ID was reused with different content.");
    }
    return state;
  }
  const observation: CostObservationRecord = {
    observationId: payload.observationId,
    observedAt: payload.observedAt,
    providerAccruedMicroUsd: payload.providerAccruedMicroUsd,
    elapsedRateProjectionMicroUsd: payload.elapsedRateProjectionMicroUsd,
    unbilledFixedMicroUsd: payload.unbilledFixedMicroUsd,
    unbilledStorageMicroUsd: payload.unbilledStorageMicroUsd,
    unbilledEgressMicroUsd: payload.unbilledEgressMicroUsd,
    conservativeExposureMicroUsd,
  };
  const conservativeExposure = parseMicroUsd(conservativeExposureMicroUsd, "conservativeExposureMicroUsd");
  const priorConservativeExposure = parseMicroUsd(
    state.conservativeExposureMicroUsd,
    "state conservativeExposureMicroUsd",
  );
  const monotonicExposureMicroUsd = (
    conservativeExposure > priorConservativeExposure
      ? conservativeExposure
      : priorConservativeExposure
  ).toString(10);
  const lastMeterObservedAt =
    state.lastMeterObservedAt === null || observedAtMs > assertUtc(state.lastMeterObservedAt, "lastMeterObservedAt")
      ? payload.observedAt
      : state.lastMeterObservedAt;
  let next: FoundryExecutionControlStateV0 = {
    ...state,
    costObservations: [...state.costObservations, observation],
    conservativeExposureMicroUsd: monotonicExposureMicroUsd,
    lastMeterObservedAt,
    costWarningTriggeredAt:
      state.costWarningTriggeredAt ??
      (parseMicroUsd(monotonicExposureMicroUsd, "conservativeExposureMicroUsd") >=
      parseMicroUsd(state.subject.budgetPolicy.costWarningMicroUsd, "costWarningMicroUsd")
        ? occurredAt
        : null),
    absoluteCostCapBreachedAt:
      state.absoluteCostCapBreachedAt ??
      (parseMicroUsd(monotonicExposureMicroUsd, "conservativeExposureMicroUsd") >=
      parseMicroUsd(state.subject.budgetPolicy.absoluteCostCapMicroUsd, "absoluteCostCapMicroUsd")
        ? occurredAt
        : null),
  };
  if (
    parseMicroUsd(monotonicExposureMicroUsd, "conservativeExposureMicroUsd") >=
    parseMicroUsd(state.subject.budgetPolicy.costHardStopMicroUsd, "costHardStopMicroUsd")
  ) {
    next = addStopIntent(next, "budget_hard_stop", occurredAt);
  }
  return next;
}

function updateControlTick(
  state: FoundryExecutionControlStateV0,
  checkedAt: string,
): FoundryExecutionControlStateV0 {
  if (checkedAt !== state.lastEventAt) {
    fail("INVALID_CONTROL_TICK_TIME", "Control tick time must equal its deterministic ledger event time.");
  }
  if (!["provider_unknown", "queued", "running", "checkpointing", "stop_pending", "terminating", "termination_unconfirmed", "validating"].includes(state.state)) {
    return state;
  }
  const anchor = state.lastMeterObservedAt ?? state.providerActiveSince;
  if (anchor === null) return addStopIntent(state, "meter_stale", checkedAt);
  const ageMs = assertUtc(checkedAt, "checkedAt") - assertUtc(anchor, "meter anchor");
  if (ageMs < 0) fail("METER_TIME_IN_FUTURE", "The latest meter observation cannot be in the future.");
  if (ageMs > state.subject.budgetPolicy.costObservationMaximumAgeSeconds * 1_000) {
    return addStopIntent(state, "meter_stale", checkedAt);
  }
  return state;
}

function withEventMetadata(
  state: FoundryExecutionControlStateV0,
  input: ExecutionTransitionInput,
): FoundryExecutionControlStateV0 {
  return {
    ...state,
    sequence: input.sequence,
    revision: input.revision,
    lastEventAt: input.occurredAt,
  };
}

function assertTransitionMetadata(
  state: FoundryExecutionControlStateV0 | null,
  input: ExecutionTransitionInput,
): void {
  assertId(input.attemptId, "attemptId");
  assertPositiveSafeInteger(input.sequence, "sequence");
  assertPositiveSafeInteger(input.revision, "revision");
  const occurredAt = assertUtc(input.occurredAt, "occurredAt");
  if (state === null) {
    if (input.sequence !== 1 || input.revision !== 1) {
      fail("NON_CONTIGUOUS_EXECUTION_EVENT", "The first attempt event must use sequence and revision one.");
    }
    return;
  }
  if (input.attemptId !== state.attemptId) {
    fail("SECOND_EXECUTION_ATTEMPT_FORBIDDEN", "Execution V0 binds one immutable attempt ID.");
  }
  if (input.sequence !== state.sequence + 1 || input.revision !== state.revision + 1) {
    fail("NON_CONTIGUOUS_EXECUTION_EVENT", "Execution event sequence and revision must both advance by exactly one.");
  }
  if (occurredAt < assertUtc(state.lastEventAt, "lastEventAt")) {
    fail("EXECUTION_EVENT_TIME_REGRESSION", "Ledger event time cannot move backwards.");
  }
  if (isTerminalExecutionState(state.state)) {
    fail("TERMINAL_EXECUTION_IMMUTABLE", "Terminal execution attempts accept no further events.");
  }
}

function initialState(
  subject: FoundryExecutionSubjectV0,
  subjectSha256: string,
  input: ExecutionTransitionInput,
): FoundryExecutionControlStateV0 {
  if (input.payload.type !== "attempt_authorized") {
    fail("ATTEMPT_AUTHORIZATION_REQUIRED", "The first execution event must authorize the single V0 attempt.");
  }
  if (assertUtc(input.occurredAt, "occurredAt") < assertUtc(subject.createdAt, "subject createdAt")) {
    fail("ATTEMPT_AUTHORIZATION_PREDATES_SUBJECT", "Attempt authorization cannot predate its immutable subject.");
  }
  const initialExposure = subject.budgetPolicy.terminationReserveMicroUsd;
  const initialExposureValue = parseMicroUsd(initialExposure, "terminationReserveMicroUsd");
  const initialHardStop =
    initialExposureValue >= parseMicroUsd(subject.budgetPolicy.costHardStopMicroUsd, "costHardStopMicroUsd");
  return {
    subject: copySubject(subject),
    subjectSha256,
    attemptId: input.attemptId,
    attemptNumber: 1,
    state: initialHardStop ? "terminal_budget_exceeded" : "authorized",
    sequence: input.sequence,
    revision: input.revision,
    lastEventAt: input.occurredAt,
    highestFenceToken: "0",
    activeLease: null,
    stopIntent: initialHardStop
      ? {
          requestedAt: input.occurredAt,
          firstReason: "budget_hard_stop",
          reasons: ["budget_hard_stop"],
        }
      : null,
    killSwitchEngagedAt: null,
    killSwitchScope: null,
    killSwitchScopeKey: null,
    killSwitchGeneration: null,
    providerExecutionRefSha256: null,
    providerActiveSince: null,
    outbox: [],
    costObservations: [],
    providerObservations: [],
    conservativeExposureMicroUsd: initialExposure,
    lastMeterObservedAt: null,
    costWarningTriggeredAt:
      initialExposureValue >= parseMicroUsd(subject.budgetPolicy.costWarningMicroUsd, "costWarningMicroUsd")
        ? input.occurredAt
        : null,
    absoluteCostCapBreachedAt:
      initialExposureValue >= parseMicroUsd(subject.budgetPolicy.absoluteCostCapMicroUsd, "absoluteCostCapMicroUsd")
        ? input.occurredAt
        : null,
    latestCompatibleCheckpoint: null,
  };
}

export function reduceFoundryExecutionTransition(
  current: FoundryExecutionControlStateV0 | null,
  subject: FoundryExecutionSubjectV0,
  input: ExecutionTransitionInput,
): FoundryExecutionControlStateV0 {
  assertFoundryExecutionSubjectV0(subject);
  const subjectSha256 = computeFoundryExecutionSubjectSha256(subject);
  assertTransitionMetadata(current, input);
  if (current === null) return initialState(subject, subjectSha256, input);
  if (current.subjectSha256 !== subjectSha256) {
    fail("EXECUTION_SUBJECT_CHANGED", "The immutable execution subject changed during replay.");
  }
  if (input.payload.type === "attempt_authorized") {
    fail("SECOND_EXECUTION_ATTEMPT_FORBIDDEN", "Execution V0 cannot authorize another attempt.");
  }
  let state = withEventMetadata(current, input);
  const payload = input.payload;
  switch (payload.type) {
    case "lease_acquired": {
      assertId(payload.ownerId, "lease ownerId");
      const fenceToken = parseFenceToken(payload.fenceToken, "fenceToken");
      const occurredAt = assertUtc(input.occurredAt, "occurredAt");
      const expiresAt = assertUtc(payload.expiresAt, "lease expiresAt");
      if (expiresAt <= occurredAt) fail("INVALID_EXECUTION_LEASE", "A fencing lease must expire after acquisition.");
      if (fenceToken <= BigInt(state.highestFenceToken)) {
        fail("STALE_EXECUTION_FENCE", "A newly acquired fencing token must exceed every prior token.");
      }
      if (state.activeLease !== null && occurredAt <= assertUtc(state.activeLease.expiresAt, "lease expiresAt")) {
        fail("EXECUTION_LEASE_CONFLICT", "A second fencing lease cannot overlap the active lease.");
      }
      state = {
        ...state,
        highestFenceToken: payload.fenceToken,
        activeLease: {
          ownerId: payload.ownerId,
          fenceToken: payload.fenceToken,
          acquiredAt: input.occurredAt,
          expiresAt: payload.expiresAt,
        },
      };
      break;
    }
    case "lease_renewed": {
      requireActiveLease(state, payload, input.occurredAt);
      if (assertUtc(payload.expiresAt, "lease expiresAt") <= assertUtc(state.activeLease?.expiresAt ?? "", "lease expiresAt")) {
        fail("INVALID_EXECUTION_LEASE", "Lease renewal must extend the current expiry.");
      }
      state = { ...state, activeLease: { ...state.activeLease, expiresAt: payload.expiresAt } as FencingLease };
      break;
    }
    case "lease_released": {
      requireActiveLease(state, payload, input.occurredAt);
      state = { ...state, activeLease: null };
      break;
    }
    case "outbox_command_enqueued": {
      requireActiveLease(state, payload, input.occurredAt);
      assertId(payload.commandId, "commandId");
      if (state.outbox.some((command) => command.commandId === payload.commandId)) {
        fail("DUPLICATE_OUTBOX_COMMAND", "Outbox command IDs are immutable and unique per attempt.");
      }
      commandKindAllowed(state, payload.commandKind, payload.reconcilesCommandId);
      const command: OutboxCommandRecord = {
        commandId: payload.commandId,
        kind: payload.commandKind,
        status: "pending",
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
        claimedBy: null,
        claimedFenceToken: null,
        reconcilesCommandId: payload.reconcilesCommandId,
        resultCode: null,
        reconciliationObservationId: null,
      };
      state = {
        ...state,
        state:
          payload.commandKind === "provider_submit"
            ? "submit_pending"
            : payload.commandKind === "provider_checkpoint"
              ? "checkpointing"
              : state.state,
        outbox: [...state.outbox, command],
      };
      break;
    }
    case "outbox_command_claimed": {
      requireActiveLease(state, payload, input.occurredAt);
      const command = findCommand(state, payload.commandId);
      if (command.status !== "pending") fail("OUTBOX_COMMAND_NOT_PENDING", "Only a pending outbox command can be claimed.");
      if (command.kind === "provider_submit" && (state.killSwitchEngagedAt !== null || state.stopIntent !== null)) {
        fail("PROVIDER_SUBMIT_FORBIDDEN", "Kill or stop intent fences a pending provider submit before claim.");
      }
      const replacement: OutboxCommandRecord = {
        ...command,
        status: "claimed",
        updatedAt: input.occurredAt,
        claimedBy: payload.ownerId,
        claimedFenceToken: payload.fenceToken,
      };
      state = {
        ...state,
        state: command.kind === "provider_submit" ? "provider_unknown" : state.state,
        outbox: replaceCommand(state, replacement),
      };
      break;
    }
    case "outbox_command_succeeded":
    case "outbox_command_failed":
    case "outbox_command_uncertain": {
      requireActiveLease(state, payload, input.occurredAt);
      assertCode(payload.resultCode, "outbox resultCode");
      const command = findCommand(state, payload.commandId);
      if (command.status !== "claimed" || command.claimedFenceToken !== payload.fenceToken) {
        fail("OUTBOX_COMMAND_NOT_CLAIMED", "Only the currently fenced claimant can complete an outbox command.");
      }
      const status =
        payload.type === "outbox_command_succeeded"
          ? "succeeded"
          : payload.type === "outbox_command_failed"
            ? "failed"
            : "uncertain";
      const replacement: OutboxCommandRecord = {
        ...command,
        status,
        updatedAt: input.occurredAt,
        resultCode: payload.resultCode,
      };
      state = { ...state, outbox: replaceCommand(state, replacement) };
      state = stateAfterCommandResult(state, replacement, status, input.occurredAt);
      break;
    }
    case "provider_reconciled": {
      requireActiveLease(state, payload, input.occurredAt);
      assertId(payload.observationId, "reconciliation observationId");
      const command = findCommand(state, payload.commandId);
      if (
        command.status !== "claimed" && command.status !== "uncertain" &&
        !(command.kind === "provider_submit" && command.status === "succeeded")
      ) {
        fail("INVALID_RECONCILIATION_TARGET", "The reconciled command was not provider-uncertain.");
      }
      if (command.reconciliationObservationId !== null) fail("COMMAND_ALREADY_RECONCILED", "Command was already reconciled.");
      const replacement: OutboxCommandRecord = {
        ...command,
        reconciliationObservationId: payload.observationId,
        updatedAt: input.occurredAt,
      };
      state = { ...state, outbox: replaceCommand(state, replacement) };
      if (payload.outcome === "not_found") {
        if (payload.providerExecutionRefSha256 !== null) {
          fail("INVALID_RECONCILIATION_RESULT", "A not-found reconciliation cannot bind a provider execution identity.");
        }
        state = {
          ...state,
          state:
            command.kind === "provider_stop"
              ? terminalFromStopIntent(state, "terminal_cancelled")
              : command.kind === "provider_submit"
                ? "terminal_failed"
                : "terminal_provider_lost",
        };
        break;
      }
      if (payload.providerExecutionRefSha256 === null) {
        fail("PROVIDER_IDENTITY_REQUIRED", "A found provider execution must bind a redacted provider identity digest.");
      }
      const providerExecutionRefSha256 = ensureProviderReference(
        state.providerExecutionRefSha256,
        payload.providerExecutionRefSha256,
      );
      assertProviderTransition(state.state, payload.outcome);
      const nextState = providerStateFromObservation(state, payload.outcome);
      state = {
        ...state,
        state: nextState,
        providerExecutionRefSha256,
        providerActiveSince:
          state.providerActiveSince ??
          (nextState === "queued" || nextState === "running" || nextState === "checkpointing" ? input.occurredAt : null),
      };
      break;
    }
    case "provider_state_observed": {
      requireActiveLease(state, payload, input.occurredAt);
      if (assertUtc(payload.observedAt, "provider observedAt") > assertUtc(input.occurredAt, "occurredAt")) {
        fail("FUTURE_PROVIDER_OBSERVATION", "Provider observation time cannot be later than its ledger event.");
      }
      state = updateProviderObservation(state, payload);
      break;
    }
    case "cost_observed": {
      requireActiveLease(state, payload, input.occurredAt);
      state = updateCostObservation(state, payload, input.occurredAt);
      break;
    }
    case "control_tick": {
      requireActiveLease(state, payload, input.occurredAt);
      if (payload.checkedAt !== input.occurredAt) {
        fail("INVALID_CONTROL_TICK_TIME", "Control tick must be bound to its event timestamp.");
      }
      state = updateControlTick(state, payload.checkedAt);
      break;
    }
    case "stop_requested": {
      assertId(payload.requestedBy, "stop requestedBy");
      state = addStopIntent(state, payload.reason, input.occurredAt);
      break;
    }
    case "kill_switch_engaged": {
      assertId(payload.requestedBy, "kill requestedBy");
      assertCode(payload.reasonCode, "kill reasonCode");
      assertId(payload.scopeKey, "kill scopeKey");
      assertPositiveSafeInteger(payload.generation, "kill generation");
      const expectedScopeKey =
        payload.scope === "global"
          ? "global"
          : payload.scope === "project"
            ? state.subject.projectId
            : payload.scope === "subject"
              ? state.subject.subjectId
              : state.attemptId;
      if (payload.scopeKey !== expectedScopeKey) {
        fail("KILL_SCOPE_MISMATCH", "Kill switch scope does not apply to this immutable execution attempt.");
      }
      if (state.killSwitchEngagedAt !== null) fail("KILL_SWITCH_ALREADY_ENGAGED", "Kill switch engagement is irreversible.");
      state = {
        ...state,
        killSwitchEngagedAt: input.occurredAt,
        killSwitchScope: payload.scope,
        killSwitchScopeKey: payload.scopeKey,
        killSwitchGeneration: payload.generation,
      };
      state = addStopIntent(state, "kill_switch", input.occurredAt);
      break;
    }
    case "checkpoint_observed": {
      requireActiveLease(state, payload, input.occurredAt);
      if (state.state !== "checkpointing") fail("CHECKPOINT_NOT_EXPECTED", "Checkpoint evidence is only accepted while checkpointing.");
      const compatibility = validateFoundryCheckpointCompatibility(state, payload.checkpoint);
      if (!compatibility.compatible) {
        fail("CHECKPOINT_INCOMPATIBLE", `Checkpoint is incompatible: ${compatibility.mismatches.join(", ")}.`);
      }
      if (assertUtc(payload.checkpoint.verifiedAt, "checkpoint verifiedAt") > assertUtc(input.occurredAt, "occurredAt")) {
        fail("CHECKPOINT_VERIFICATION_IN_FUTURE", "Checkpoint verification cannot postdate its ledger event.");
      }
      state = { ...state, latestCompatibleCheckpoint: { ...payload.checkpoint } };
      break;
    }
    case "validation_completed": {
      requireActiveLease(state, payload, input.occurredAt);
      assertCode(payload.resultCode, "validation resultCode");
      if (state.state !== "validating") fail("VALIDATION_NOT_EXPECTED", "Validation can complete only from validating state.");
      state = {
        ...state,
        state:
          payload.outcome === "failed"
            ? "terminal_validation_failed"
            : terminalFromStopIntent(state, "terminal_succeeded"),
      };
      break;
    }
  }
  assertFoundryExecutionControlStateV0(state);
  return state;
}

export function deriveFoundryExecutionControlView(
  state: FoundryExecutionControlStateV0,
): ExecutionControlView {
  const terminal = isTerminalExecutionState(state.state);
  const unresolved = unresolvedCommands(state).map((command) => command.commandId);
  const permitted: OutboxCommandKind[] = [];
  if (!terminal && state.activeLease !== null) {
    const candidates: readonly OutboxCommandKind[] = [
      "provider_submit",
      "provider_reconcile",
      "provider_poll",
      "provider_checkpoint",
      "provider_stop",
    ];
    for (const kind of candidates) {
      try {
        const target = kind === "provider_reconcile" ? unresolved[0] ?? null : null;
        commandKindAllowed(state, kind, target);
        permitted.push(kind);
      } catch (error) {
        if (!(error instanceof FoundryIntegrityError)) throw error;
      }
    }
  }
  return {
    permittedCommandKinds: permitted,
    unresolvedCommandIds: unresolved,
    submitBlocked:
      terminal || state.state !== "authorized" || state.killSwitchEngagedAt !== null || state.stopIntent !== null,
    stopRequired: state.stopIntent !== null && !terminal,
    terminal,
  };
}

export function assertFoundryExecutionControlStateV0(
  state: FoundryExecutionControlStateV0,
): void {
  assertFoundryExecutionSubjectV0(state.subject);
  if (computeFoundryExecutionSubjectSha256(state.subject) !== state.subjectSha256) {
    fail("EXECUTION_SUBJECT_CHANGED", "State subject digest does not match its immutable subject.");
  }
  assertId(state.attemptId, "attemptId");
  if (Number(state.attemptNumber) !== 1) fail("EXECUTION_RETRIES_FORBIDDEN", "Execution V0 contains exactly one attempt.");
  assertPositiveSafeInteger(state.sequence, "sequence");
  assertPositiveSafeInteger(state.revision, "revision");
  if (state.sequence !== state.revision) {
    fail("EXECUTION_REVISION_DIVERGED", "Execution sequence and revision must remain contiguous and equal in V0.");
  }
  assertUtc(state.lastEventAt, "lastEventAt");
  if (!MICRO_USD_PATTERN.test(state.highestFenceToken) || BigInt(state.highestFenceToken) > MAX_MICRO_USD) {
    fail("INVALID_EXECUTION_FENCE", "highestFenceToken must be a canonical unsigned BIGINT string.");
  }
  const storedConservativeExposure = parseMicroUsd(
    state.conservativeExposureMicroUsd,
    "conservativeExposureMicroUsd",
  );
  if (state.activeLease !== null) {
    assertId(state.activeLease.ownerId, "lease ownerId");
    parseFenceToken(state.activeLease.fenceToken, "lease fenceToken");
    if (state.activeLease.fenceToken !== state.highestFenceToken) {
      fail("INVALID_EXECUTION_LEASE", "Active lease must use the highest fencing token.");
    }
    if (assertUtc(state.activeLease.expiresAt, "lease expiresAt") <= assertUtc(state.activeLease.acquiredAt, "lease acquiredAt")) {
      fail("INVALID_EXECUTION_LEASE", "Active lease expiry must follow acquisition.");
    }
  }
  if (state.providerExecutionRefSha256 !== null) assertDigest(state.providerExecutionRefSha256, "providerExecutionRefSha256");
  if (state.stopIntent !== null) {
    assertUtc(state.stopIntent.requestedAt, "stop requestedAt");
    if (state.stopIntent.reasons.length === 0 || state.stopIntent.reasons[0] !== state.stopIntent.firstReason) {
      fail("INVALID_STOP_INTENT", "Stop intent must preserve its first reason.");
    }
    if (new Set(state.stopIntent.reasons).size !== state.stopIntent.reasons.length) {
      fail("INVALID_STOP_INTENT", "Stop reasons must be unique and monotonic.");
    }
  }
  const commandIds = new Set<string>();
  for (const command of state.outbox) {
    assertId(command.commandId, "commandId");
    if (commandIds.has(command.commandId)) fail("DUPLICATE_OUTBOX_COMMAND", "Outbox command IDs must be unique.");
    commandIds.add(command.commandId);
    if (command.status === "pending" && (command.claimedBy !== null || command.claimedFenceToken !== null)) {
      fail("INVALID_OUTBOX_STATE", "A pending command cannot have claim ownership.");
    }
    if (command.status !== "pending" && (command.claimedBy === null || command.claimedFenceToken === null)) {
      fail("INVALID_OUTBOX_STATE", "A non-pending command must retain its immutable claim fence.");
    }
  }
  const costIds = new Set<string>();
  let recomputedConservativeExposure = parseMicroUsd(
    state.subject.budgetPolicy.terminationReserveMicroUsd,
    "terminationReserveMicroUsd",
  );
  for (const observation of state.costObservations) {
    if (costIds.has(observation.observationId)) fail("DUPLICATE_COST_OBSERVATION", "Stored cost observations must be unique.");
    costIds.add(observation.observationId);
    const observationExposure = parseMicroUsd(
      conservativeExposureForObservation(state.subject.budgetPolicy, observation),
      "observation conservativeExposureMicroUsd",
    );
    if (observation.conservativeExposureMicroUsd !== observationExposure.toString(10)) {
      fail("INVALID_COST_OBSERVATION", "Stored exposure does not match the conservative cost formula.");
    }
    if (observationExposure > recomputedConservativeExposure) {
      recomputedConservativeExposure = observationExposure;
    }
  }
  if (recomputedConservativeExposure !== storedConservativeExposure) {
    fail("COST_REGRESSION", "Conservative exposure must equal the monotonic maximum of every accepted meter observation.");
  }
  if (state.killSwitchEngagedAt !== null && state.stopIntent?.reasons.includes("kill_switch") !== true) {
    fail("KILL_SWITCH_DID_NOT_STOP", "Kill switch engagement must induce irreversible stop intent.");
  }
  if (
    state.killSwitchEngagedAt !== null &&
    (state.killSwitchScope === null || state.killSwitchScopeKey === null || state.killSwitchGeneration === null)
  ) {
    fail("INVALID_KILL_SWITCH_BINDING", "Kill switch state must retain its scope and generation binding.");
  }
}

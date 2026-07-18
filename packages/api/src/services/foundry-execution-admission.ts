import { createHash } from "node:crypto";
import {
  FoundryExecutionEnvelopeComputeApprovalV0Schema,
  FoundryExecutionEnvelopeConfirmationV0Schema,
  FoundryExecutionEnvelopeV0Schema,
  FoundryExecutionPolicyV0Schema,
  FoundryIngestManifestV0Schema,
  FoundryIntakeAdmissionResultV0Schema,
  FoundryJobSpecV0Schema,
  FoundryProviderDeploymentEvidenceV0Schema,
  FoundryProviderPlanEvidenceV0Schema,
  FoundryRightsApprovalSchema,
  FoundryRightsPolicyDefinitionV0Schema,
  FoundryTrustedWorkerProfileV0Schema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  computeFoundryExecutionEnvelopeComputeApprovalSha256,
  computeFoundryExecutionEnvelopeConfirmationSha256,
  computeFoundryExecutionEnvelopeSha256,
  computeFoundryExecutionPolicySha256,
  computeFoundryIngestManifestSha256,
  computeFoundryJobSpecSha256,
  computeFoundryProviderDeploymentEvidenceSha256,
  computeFoundryProviderPlanEvidenceSha256,
  computeFoundryTrustedWorkerProfileSha256,
  validateFoundryExecutionAuthorizations,
  validateFoundryExecutionEnvelopeBindings,
  validateFoundryJobRights,
  validateFoundryTrustedRightsApproval,
  type FoundryExecutionEnvelopeComputeApprovalV0,
  type FoundryExecutionEnvelopeConfirmationV0,
  type FoundryExecutionEnvelopeV0,
  type FoundryExecutionPolicyV0,
  type FoundryIngestManifestV0,
  type FoundryIntakeAdmissionResultV0,
  type FoundryJobSpecV0,
  type FoundryProviderDeploymentEvidenceV0,
  type FoundryProviderPlanEvidenceV0,
  type FoundryRightsApproval,
  type FoundryRightsPolicyDefinitionV0,
  type FoundryTrustedWorkerProfileV0,
} from "@omnitwin/types";
import {
  FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
  FOUNDRY_EXECUTION_SUBJECT_V0,
  FoundryIntakeStagingIndexV0Schema,
  computeFoundryExecutionSubjectSha256,
  stableCanonicalJson,
  toCanonicalJson,
  type FoundryExecutionSubjectV0,
  type FoundryIntakeStagingIndexV0,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

export const FOUNDRY_EXECUTION_ADMISSION_REQUEST_V0 =
  "omnitwin.foundry.execution-admission-request.v0";
export const FOUNDRY_EXECUTION_ADMISSION_STATE =
  "admitted_awaiting_executor";

export const FoundryExecutionAdmissionRequestV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_EXECUTION_ADMISSION_REQUEST_V0),
    jobId: RuntimeManifestKeySchema,
    executionEnvelopeId: RuntimeManifestKeySchema,
    rightsApprovalId: RuntimeManifestKeySchema,
    confirmationId: RuntimeManifestKeySchema,
    computeApprovalId: RuntimeManifestKeySchema.nullable(),
    idempotencyKey: RuntimeManifestKeySchema,
  })
  .strict();
export type FoundryExecutionAdmissionRequestV0 = z.infer<
  typeof FoundryExecutionAdmissionRequestV0Schema
>;

export interface FoundryStoredEvidence<T = unknown> {
  readonly sha256: string;
  readonly value: T;
}

export interface FoundryExecutionAdmissionEvidence {
  readonly jobId: string;
  readonly jobSpec: FoundryStoredEvidence;
  readonly ingestManifest: FoundryStoredEvidence;
  readonly intakeAdmissionResult: FoundryStoredEvidence;
  readonly intakeStagingIndex: FoundryStoredEvidence;
  readonly executionEnvelopeId: string;
  readonly executionEnvelope: FoundryStoredEvidence;
  readonly executionPolicy: FoundryStoredEvidence;
  readonly providerPlanEvidence: FoundryStoredEvidence;
  readonly providerDeploymentEvidence: FoundryStoredEvidence;
  readonly trustedWorkerProfiles: readonly FoundryStoredEvidence[];
  readonly rightsApprovalId: string;
  readonly rightsApproval: FoundryStoredEvidence;
  readonly activeRightsPolicy: FoundryStoredEvidence;
  readonly confirmationId: string;
  readonly confirmation: FoundryStoredEvidence;
  readonly computeApprovalId: string | null;
  readonly computeApproval: FoundryStoredEvidence | null;
}

export interface FoundryExecutionAdmissionInsert {
  readonly jobId: string;
  readonly executionEnvelopeId: string;
  readonly executionEnvelopeSha256: string;
  readonly executionSubject: FoundryExecutionSubjectV0;
  readonly executionSubjectSha256: string;
  readonly jobSpecSha256: string;
  readonly reviewedIngestManifestSha256: string;
  readonly intakeAdmissionResultSha256: string;
  readonly intakeStagingIndexSha256: string;
  readonly executionPolicySha256: string;
  readonly providerPlanSha256: string;
  readonly providerDeploymentSha256: string;
  readonly providerAdapterArtifactSha256: string;
  readonly trustedWorkerProfileSha256s: readonly string[];
  readonly rightsApprovalId: string;
  readonly rightsApprovalSha256: string;
  readonly rightsPolicyEvidenceSha256: string;
  readonly rightsPolicyDefinitionSha256: string;
  readonly confirmationId: string;
  readonly confirmationSha256: string;
  readonly computeApprovalId: string | null;
  readonly computeApprovalSha256: string | null;
  readonly providerKind: FoundryJobSpecV0["providerKind"];
  readonly providerAdapterId: string;
  readonly providerAdapterVersion: string;
  readonly dispatchDeadline: Date;
  readonly reservedCostMicroUsd: string;
  readonly state: typeof FOUNDRY_EXECUTION_ADMISSION_STATE;
  readonly admittedByUserId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
}

export interface FoundryAdmittedExecution {
  readonly executionId: string;
  readonly jobId: string;
  readonly executionEnvelopeId: string;
  readonly executionEnvelopeSha256: string;
  readonly state: typeof FOUNDRY_EXECUTION_ADMISSION_STATE;
  readonly admittedByUserId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly admittedAt: Date;
}

export interface LockedFoundryExecutionAdmissionStore {
  /** Exact replay lookup inside the same transaction and job lock. */
  findIdempotentAdmission(
    admittedByUserId: string,
    idempotencyKey: string,
  ): Promise<FoundryAdmittedExecution | null>;
  /** Advisory validation time sampled only after the admission lock is held. */
  currentDatabaseTime(): Promise<Date>;
  loadTrustedEvidence(
    request: FoundryExecutionAdmissionRequestV0,
  ): Promise<FoundryExecutionAdmissionEvidence | null>;
  /**
   * Must check every applicable global/provider/project/execution/attempt
   * scope while holding the same lock generation used by kill activation.
   */
  findActiveKillSwitch(
    evidence: FoundryExecutionAdmissionEvidence,
  ): Promise<{ readonly id: string; readonly generation: number } | null>;
  /**
   * Atomically inserts only the inert revision-zero execution and its immutable
   * execution_admitted genesis event. It must consume confirmationId through a
   * unique constraint. Attempt authorization, outbox insertion, and provider
   * contact are separate later operations and are forbidden here. The store
   * must resample the database clock for admittedAt inside the final insert;
   * the earlier validation time is never authoritative for persistence.
   */
  insertAdmission(
    input: FoundryExecutionAdmissionInsert,
  ): Promise<FoundryAdmittedExecution>;
}

export interface FoundryExecutionAdmissionStore {
  withAdmissionLock<T>(
    jobId: string,
    executionEnvelopeId: string,
    operation: (store: LockedFoundryExecutionAdmissionStore) => Promise<T>,
  ): Promise<T>;
}

export class FoundryExecutionAdmissionError extends Error {
  constructor(
    readonly code:
      | "INVALID_ADMISSION_REQUEST"
      | "IDEMPOTENCY_KEY_REUSED"
      | "TRUSTED_EVIDENCE_NOT_FOUND"
      | "TRUSTED_EVIDENCE_INTEGRITY_FAILURE"
      | "RIGHTS_APPROVAL_REJECTED"
      | "EXECUTION_BINDING_REJECTED"
      | "EXECUTION_AUTHORIZATION_REJECTED"
      | "KILL_SWITCH_ACTIVE",
    message: string,
  ) {
    super(message);
    this.name = "FoundryExecutionAdmissionError";
  }
}

function digestEvidence(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(toCanonicalJson(value))}`, "utf8")
    .digest("hex")}`;
}

export function computeFoundryRightsApprovalEvidenceSha256(
  input: unknown,
): string {
  const approval = FoundryRightsApprovalSchema.parse(input);
  return digestEvidence("omnitwin.foundry.rights-approval.v0", approval);
}

export function computeFoundryRightsPolicyEvidenceSha256(
  input: unknown,
): string {
  const policy = FoundryRightsPolicyDefinitionV0Schema.parse(input);
  return digestEvidence(policy.schemaVersion, policy);
}

export function computeFoundryExecutionConfirmationEvidenceSha256(
  input: unknown,
): string {
  return computeFoundryExecutionEnvelopeConfirmationSha256(input);
}

export function computeFoundryExecutionComputeApprovalEvidenceSha256(
  input: unknown,
): string {
  return computeFoundryExecutionEnvelopeComputeApprovalSha256(input);
}

export function computeFoundryExecutionAdmissionRequestSha256(
  input: FoundryExecutionAdmissionRequestV0,
): string {
  return digestEvidence(FOUNDRY_EXECUTION_ADMISSION_REQUEST_V0, input);
}

interface ParsedAdmissionEvidence {
  readonly jobSpec: FoundryJobSpecV0;
  readonly ingestManifest: FoundryIngestManifestV0;
  readonly intakeAdmissionResult: FoundryIntakeAdmissionResultV0;
  readonly intakeStagingIndex: FoundryIntakeStagingIndexV0;
  readonly executionEnvelope: FoundryExecutionEnvelopeV0;
  readonly executionPolicy: FoundryExecutionPolicyV0;
  readonly providerPlanEvidence: FoundryProviderPlanEvidenceV0;
  readonly providerDeploymentEvidence: FoundryProviderDeploymentEvidenceV0;
  readonly trustedWorkerProfiles: readonly FoundryTrustedWorkerProfileV0[];
  readonly rightsApproval: FoundryRightsApproval;
  readonly activeRightsPolicy: FoundryRightsPolicyDefinitionV0;
  readonly confirmation: FoundryExecutionEnvelopeConfirmationV0;
  readonly computeApproval: FoundryExecutionEnvelopeComputeApprovalV0 | null;
  readonly digests: {
    readonly jobSpec: string;
    readonly ingestManifest: string;
    readonly intakeAdmissionResult: string;
    readonly intakeStagingIndex: string;
    readonly executionEnvelope: string;
    readonly executionPolicy: string;
    readonly providerPlan: string;
    readonly providerDeployment: string;
    readonly trustedWorkerProfiles: readonly string[];
    readonly rightsApproval: string;
    readonly activeRightsPolicy: string;
    readonly confirmation: string;
    readonly computeApproval: string | null;
  };
}

function parseTrustedEvidence(
  evidence: FoundryExecutionAdmissionEvidence,
): ParsedAdmissionEvidence {
  const jobSpec = FoundryJobSpecV0Schema.parse(evidence.jobSpec.value);
  const ingestManifest = FoundryIngestManifestV0Schema.parse(
    evidence.ingestManifest.value,
  );
  const intakeAdmissionResult = FoundryIntakeAdmissionResultV0Schema.parse(
    evidence.intakeAdmissionResult.value,
  );
  const intakeStagingIndex = FoundryIntakeStagingIndexV0Schema.parse(
    evidence.intakeStagingIndex.value,
  );
  const executionEnvelope = FoundryExecutionEnvelopeV0Schema.parse(
    evidence.executionEnvelope.value,
  );
  const executionPolicy = FoundryExecutionPolicyV0Schema.parse(
    evidence.executionPolicy.value,
  );
  const providerPlanEvidence = FoundryProviderPlanEvidenceV0Schema.parse(
    evidence.providerPlanEvidence.value,
  );
  const providerDeploymentEvidence =
    FoundryProviderDeploymentEvidenceV0Schema.parse(
      evidence.providerDeploymentEvidence.value,
    );
  const trustedWorkerProfiles = evidence.trustedWorkerProfiles.map((profile) =>
    FoundryTrustedWorkerProfileV0Schema.parse(profile.value)
  );
  const rightsApproval = FoundryRightsApprovalSchema.parse(
    evidence.rightsApproval.value,
  );
  const activeRightsPolicy = FoundryRightsPolicyDefinitionV0Schema.parse(
    evidence.activeRightsPolicy.value,
  );
  const confirmation = FoundryExecutionEnvelopeConfirmationV0Schema.parse(
    evidence.confirmation.value,
  );
  const computeApproval = evidence.computeApproval === null
    ? null
    : FoundryExecutionEnvelopeComputeApprovalV0Schema.parse(
      evidence.computeApproval.value,
    );
  const workerProfilePairs = trustedWorkerProfiles.map((profile, index) => ({
    digest: computeFoundryTrustedWorkerProfileSha256(profile),
    persisted: evidence.trustedWorkerProfiles[index]?.sha256,
    profile,
  })).sort((left, right) => left.digest.localeCompare(right.digest));
  if (
    new Set(workerProfilePairs.map((pair) => pair.digest)).size !==
    workerProfilePairs.length
  ) {
    throw new FoundryExecutionAdmissionError(
      "TRUSTED_EVIDENCE_INTEGRITY_FAILURE",
      "Trusted worker-profile evidence contains duplicate identities.",
    );
  }
  const sortedTrustedWorkerProfiles = workerProfilePairs.map(
    (pair) => pair.profile,
  );
  const digests = {
    jobSpec: computeFoundryJobSpecSha256(jobSpec),
    ingestManifest: computeFoundryIngestManifestSha256(ingestManifest),
    intakeAdmissionResult: intakeAdmissionResult.resultSha256,
    intakeStagingIndex: `sha256:${intakeStagingIndex.stagingSha256}`,
    executionEnvelope: computeFoundryExecutionEnvelopeSha256(executionEnvelope),
    executionPolicy: computeFoundryExecutionPolicySha256(executionPolicy),
    providerPlan: computeFoundryProviderPlanEvidenceSha256(providerPlanEvidence),
    providerDeployment: computeFoundryProviderDeploymentEvidenceSha256(
      providerDeploymentEvidence,
    ),
    trustedWorkerProfiles: workerProfilePairs.map((pair) => pair.digest),
    rightsApproval: computeFoundryRightsApprovalEvidenceSha256(rightsApproval),
    activeRightsPolicy: computeFoundryRightsPolicyEvidenceSha256(
      activeRightsPolicy,
    ),
    confirmation: computeFoundryExecutionConfirmationEvidenceSha256(confirmation),
    computeApproval: computeApproval === null
      ? null
      : computeFoundryExecutionComputeApprovalEvidenceSha256(computeApproval),
  } as const;
  const persistedDigests = [
    evidence.jobSpec.sha256,
    evidence.ingestManifest.sha256,
    evidence.intakeAdmissionResult.sha256,
    evidence.intakeStagingIndex.sha256,
    evidence.executionEnvelope.sha256,
    evidence.executionPolicy.sha256,
    evidence.providerPlanEvidence.sha256,
    evidence.providerDeploymentEvidence.sha256,
    ...evidence.trustedWorkerProfiles.map((profile) => profile.sha256),
    evidence.rightsApproval.sha256,
    evidence.activeRightsPolicy.sha256,
    evidence.confirmation.sha256,
    ...(evidence.computeApproval === null ? [] : [evidence.computeApproval.sha256]),
  ];
  if (persistedDigests.some((value) => !RuntimeSha256Schema.safeParse(value).success)) {
    throw new FoundryExecutionAdmissionError(
      "TRUSTED_EVIDENCE_INTEGRITY_FAILURE",
      "Trusted execution evidence contains an invalid persisted digest.",
    );
  }
  if (
    evidence.jobSpec.sha256 !== digests.jobSpec ||
    evidence.ingestManifest.sha256 !== digests.ingestManifest ||
    evidence.intakeAdmissionResult.sha256 !== digests.intakeAdmissionResult ||
    evidence.intakeStagingIndex.sha256 !== digests.intakeStagingIndex ||
    evidence.executionEnvelope.sha256 !== digests.executionEnvelope ||
    evidence.executionPolicy.sha256 !== digests.executionPolicy ||
    evidence.providerPlanEvidence.sha256 !== digests.providerPlan ||
    evidence.providerDeploymentEvidence.sha256 !== digests.providerDeployment ||
    workerProfilePairs.some((pair) => pair.persisted !== pair.digest) ||
    evidence.rightsApproval.sha256 !== digests.rightsApproval ||
    evidence.activeRightsPolicy.sha256 !== digests.activeRightsPolicy ||
    evidence.confirmation.sha256 !== digests.confirmation ||
    evidence.computeApproval?.sha256 !== (digests.computeApproval ?? undefined)
  ) {
    throw new FoundryExecutionAdmissionError(
      "TRUSTED_EVIDENCE_INTEGRITY_FAILURE",
      "Trusted execution evidence no longer matches its persisted digest.",
    );
  }
  if (
    intakeAdmissionResult.manifestSha256 !== digests.ingestManifest ||
    stableCanonicalJson(toCanonicalJson(intakeAdmissionResult.manifest)) !==
      stableCanonicalJson(toCanonicalJson(ingestManifest)) ||
    intakeStagingIndex.manifestSha256 !== digests.ingestManifest ||
    intakeStagingIndex.resultSha256 !== digests.intakeAdmissionResult ||
    jobSpec.ingestManifestSha256 !== digests.ingestManifest
  ) {
    throw new FoundryExecutionAdmissionError(
      "TRUSTED_EVIDENCE_INTEGRITY_FAILURE",
      "Intake admission, staging, manifest, and JobSpec evidence do not bind one exact input set.",
    );
  }
  return {
    jobSpec,
    ingestManifest,
    intakeAdmissionResult,
    intakeStagingIndex,
    executionEnvelope,
    executionPolicy,
    providerPlanEvidence,
    providerDeploymentEvidence,
    trustedWorkerProfiles: sortedTrustedWorkerProfiles,
    rightsApproval,
    activeRightsPolicy,
    confirmation,
    computeApproval,
    digests,
  };
}

function assertRequestedEvidenceIds(
  request: FoundryExecutionAdmissionRequestV0,
  evidence: FoundryExecutionAdmissionEvidence,
  parsed: ParsedAdmissionEvidence,
): void {
  if (
    evidence.jobId !== request.jobId ||
    parsed.jobSpec.id !== request.jobId ||
    evidence.executionEnvelopeId !== request.executionEnvelopeId ||
    parsed.executionEnvelope.envelopeId !== request.executionEnvelopeId ||
    evidence.rightsApprovalId !== request.rightsApprovalId ||
    evidence.confirmationId !== request.confirmationId ||
    parsed.confirmation.confirmationId !== request.confirmationId ||
    evidence.computeApprovalId !== request.computeApprovalId ||
    parsed.computeApproval?.approvalId !== (request.computeApprovalId ?? undefined) ||
    parsed.jobSpec.computeApprovalId !== request.computeApprovalId ||
    parsed.executionEnvelope.computeApprovalId !== request.computeApprovalId ||
    (parsed.computeApproval === null) !== (request.computeApprovalId === null)
  ) {
    throw new FoundryExecutionAdmissionError(
      "TRUSTED_EVIDENCE_INTEGRITY_FAILURE",
      "Trusted execution evidence does not match the exact requested identities.",
    );
  }
}

function makeExecutionSubject(
  parsed: ParsedAdmissionEvidence,
): FoundryExecutionSubjectV0 {
  const policy = parsed.executionPolicy;
  return {
    schemaVersion: FOUNDRY_EXECUTION_SUBJECT_V0,
    subjectId: parsed.executionEnvelope.envelopeId,
    projectId: parsed.executionEnvelope.projectId,
    jobSpecSha256: parsed.digests.jobSpec,
    executionEnvelopeSha256: parsed.digests.executionEnvelope,
    ingestManifestSha256: parsed.digests.ingestManifest,
    intakeAdmissionResultSha256: parsed.digests.intakeAdmissionResult,
    intakeStagingIndexSha256: parsed.digests.intakeStagingIndex,
    providerPlanSha256: parsed.digests.providerPlan,
    executionPolicySha256: parsed.digests.executionPolicy,
    executionConfirmationSha256: parsed.digests.confirmation,
    rightsApprovalSha256: parsed.digests.rightsApproval,
    rightsPolicyEvidenceSha256: parsed.digests.activeRightsPolicy,
    rightsPolicyDefinitionSha256:
      parsed.activeRightsPolicy.policyDefinitionSha256,
    computeApprovalSha256: parsed.digests.computeApproval,
    providerKind: parsed.executionEnvelope.providerKind,
    providerAdapterId: parsed.executionEnvelope.providerAdapterId,
    providerAdapterVersion: parsed.executionEnvelope.providerAdapterVersion,
    providerAdapterArtifactSha256:
      parsed.executionEnvelope.providerAdapterArtifactSha256,
    providerDeploymentSha256: parsed.digests.providerDeployment,
    workerProfileSha256s: parsed.digests.trustedWorkerProfiles,
    pricingSnapshotSha256: parsed.executionEnvelope.pricingSnapshotSha256,
    pricingSnapshotExpiresAt:
      parsed.executionEnvelope.pricingSnapshotExpiresAt,
    createdAt: parsed.executionEnvelope.createdAt,
    dispatchDeadline: parsed.executionEnvelope.dispatchDeadline,
    maximumAttempts: FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
    budgetPolicy: {
      currency: "USD",
      costWarningMicroUsd: policy.costWarningMicroUsd,
      costHardStopMicroUsd: policy.costHardStopMicroUsd,
      terminationReserveMicroUsd: policy.terminationReserveMicroUsd,
      absoluteCostCapMicroUsd: policy.absoluteCostCapMicroUsd,
      costObservationMaximumAgeSeconds:
        policy.costObservationMaximumAgeSeconds,
    },
    checkpointContract: null,
  };
}

export async function admitFoundryExecution(
  store: FoundryExecutionAdmissionStore,
  requestInput: unknown,
  admittedByUserIdInput: unknown,
): Promise<FoundryAdmittedExecution> {
  const requestResult = FoundryExecutionAdmissionRequestV0Schema.safeParse(requestInput);
  const admittedByUserIdResult = z.string().uuid().safeParse(admittedByUserIdInput);
  if (!requestResult.success || !admittedByUserIdResult.success) {
    throw new FoundryExecutionAdmissionError(
      "INVALID_ADMISSION_REQUEST",
      "Execution admission request or actor identity is invalid.",
    );
  }
  const request = requestResult.data;
  const admittedByUserId = admittedByUserIdResult.data;
  const requestDigest = computeFoundryExecutionAdmissionRequestSha256(request);
  return store.withAdmissionLock(
    request.jobId,
    request.executionEnvelopeId,
    async (lockedStore) => {
      const idempotent = await lockedStore.findIdempotentAdmission(
        admittedByUserId,
        request.idempotencyKey,
      );
      if (idempotent !== null) {
        if (idempotent.requestDigest !== requestDigest) {
          throw new FoundryExecutionAdmissionError(
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key was already used for a different admission request.",
          );
        }
        return idempotent;
      }

      const now = await lockedStore.currentDatabaseTime();
      if (!Number.isFinite(now.getTime())) {
        throw new FoundryExecutionAdmissionError(
          "TRUSTED_EVIDENCE_INTEGRITY_FAILURE",
          "The database returned an invalid admission time.",
        );
      }
      const evidence = await lockedStore.loadTrustedEvidence(request);
      if (evidence === null) {
        throw new FoundryExecutionAdmissionError(
          "TRUSTED_EVIDENCE_NOT_FOUND",
          "One or more exact trusted execution records do not exist.",
        );
      }
      let parsed: ParsedAdmissionEvidence;
      try {
        parsed = parseTrustedEvidence(evidence);
      } catch (error: unknown) {
        if (error instanceof FoundryExecutionAdmissionError) throw error;
        throw new FoundryExecutionAdmissionError(
          "TRUSTED_EVIDENCE_INTEGRITY_FAILURE",
          `Trusted execution evidence failed strict validation: ${error instanceof Error ? error.message : "unknown validation error"}`,
        );
      }
      assertRequestedEvidenceIds(request, evidence, parsed);

      const manifestRightsDecision = validateFoundryJobRights(
        parsed.jobSpec,
        parsed.ingestManifest,
      );
      if (!manifestRightsDecision.allowed) {
        throw new FoundryExecutionAdmissionError(
          "RIGHTS_APPROVAL_REJECTED",
          `Manifest rights rejected: ${manifestRightsDecision.blockers.join(", ")}.`,
        );
      }
      const rightsDecision = validateFoundryTrustedRightsApproval(
        parsed.jobSpec,
        parsed.rightsApproval,
        now,
        parsed.activeRightsPolicy,
      );
      if (!rightsDecision.allowed) {
        throw new FoundryExecutionAdmissionError(
          "RIGHTS_APPROVAL_REJECTED",
          `Rights approval rejected: ${rightsDecision.reason}.`,
        );
      }
      const bindingDecision = validateFoundryExecutionEnvelopeBindings(
        parsed.executionEnvelope,
        {
          jobSpec: parsed.jobSpec,
          ingestManifest: parsed.ingestManifest,
          intakeAdmissionResultSha256: parsed.digests.intakeAdmissionResult,
          intakeStagingIndexSha256: parsed.digests.intakeStagingIndex,
          executionPolicy: parsed.executionPolicy,
          providerPlanEvidence: parsed.providerPlanEvidence,
          trustedWorkerProfiles: parsed.trustedWorkerProfiles,
          providerDeploymentEvidence: parsed.providerDeploymentEvidence,
        },
      );
      if (!bindingDecision.valid) {
        throw new FoundryExecutionAdmissionError(
          "EXECUTION_BINDING_REJECTED",
          `Execution envelope binding rejected: ${bindingDecision.reason}.`,
        );
      }
      const authorizationDecision = validateFoundryExecutionAuthorizations(
        parsed.executionEnvelope,
        parsed.jobSpec,
        parsed.executionPolicy,
        parsed.confirmation,
        parsed.computeApproval,
        now,
      );
      if (!authorizationDecision.allowed) {
        throw new FoundryExecutionAdmissionError(
          "EXECUTION_AUTHORIZATION_REJECTED",
          `Execution authorization rejected: ${authorizationDecision.reason}.`,
        );
      }
      const killSwitch = await lockedStore.findActiveKillSwitch(evidence);
      if (killSwitch !== null) {
        throw new FoundryExecutionAdmissionError(
          "KILL_SWITCH_ACTIVE",
          `Execution admission is blocked by kill switch ${killSwitch.id} generation ${String(killSwitch.generation)}.`,
        );
      }

      const executionSubject = makeExecutionSubject(parsed);
      const executionSubjectSha256 =
        computeFoundryExecutionSubjectSha256(executionSubject);

      return lockedStore.insertAdmission({
        jobId: parsed.jobSpec.id,
        executionEnvelopeId: parsed.executionEnvelope.envelopeId,
        executionEnvelopeSha256: parsed.digests.executionEnvelope,
        executionSubject,
        executionSubjectSha256,
        jobSpecSha256: parsed.digests.jobSpec,
        reviewedIngestManifestSha256: parsed.digests.ingestManifest,
        intakeAdmissionResultSha256: parsed.digests.intakeAdmissionResult,
        intakeStagingIndexSha256: parsed.digests.intakeStagingIndex,
        executionPolicySha256: parsed.digests.executionPolicy,
        providerPlanSha256: parsed.digests.providerPlan,
        providerDeploymentSha256: parsed.digests.providerDeployment,
        providerAdapterArtifactSha256:
          parsed.executionEnvelope.providerAdapterArtifactSha256,
        trustedWorkerProfileSha256s: parsed.digests.trustedWorkerProfiles,
        rightsApprovalId: evidence.rightsApprovalId,
        rightsApprovalSha256: parsed.digests.rightsApproval,
        rightsPolicyEvidenceSha256: parsed.digests.activeRightsPolicy,
        rightsPolicyDefinitionSha256:
          parsed.activeRightsPolicy.policyDefinitionSha256,
        confirmationId: parsed.confirmation.confirmationId,
        confirmationSha256: parsed.digests.confirmation,
        computeApprovalId: parsed.computeApproval?.approvalId ?? null,
        computeApprovalSha256: parsed.digests.computeApproval,
        providerKind: parsed.executionEnvelope.providerKind,
        providerAdapterId: parsed.executionEnvelope.providerAdapterId,
        providerAdapterVersion: parsed.executionEnvelope.providerAdapterVersion,
        dispatchDeadline: new Date(parsed.executionEnvelope.dispatchDeadline),
        reservedCostMicroUsd: parsed.executionPolicy.absoluteCostCapMicroUsd,
        state: FOUNDRY_EXECUTION_ADMISSION_STATE,
        admittedByUserId,
        idempotencyKey: request.idempotencyKey,
        requestDigest,
      });
    },
  );
}

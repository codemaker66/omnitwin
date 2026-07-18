import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  FoundryCanonicalActorSchema,
  FoundryIngestManifestV0Schema,
  FoundryInputAssetSchema,
  FoundryJobSpecV0Schema,
  FoundryUtcInstantSchema,
  computeFoundryIngestManifestSha256,
  computeFoundryJobApprovalSubjectSha256,
  validateFoundryJobRights,
} from "./omnitwin-foundry.js";
import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "./runtime-venue-manifest.js";

// This is a separate, additive rights-evidence contract. It deliberately does
// not alter FoundryIngestManifestV0 or FoundryJobSpecV0 semantics.
export const FOUNDRY_DERIVATIVE_RIGHTS_POLICY_V0 =
  "omnitwin.foundry.derivative-rights-policy.v0";
export const FOUNDRY_DERIVATIVE_RIGHTS_POLICY_REVOCATION_V0 =
  "omnitwin.foundry.derivative-rights-policy-revocation.v0";
export const FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0 =
  "omnitwin.foundry.derivative-rights-approval.v0";
export const FOUNDRY_DERIVATIVE_RIGHTS_RESTRICTION_V0 =
  "omnitwin.foundry.derivative-rights-restriction.v0";
export const FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0 =
  "normalize_mesh_glb/v0";
export const FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS =
  "lossless_internal_format_normalization";
export const FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0 = [
  "read_source",
  "create_internal_derivative",
] as const;
export const FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0 = [
  "model_training",
  "redistribution",
  "public_release",
] as const;
export const FOUNDRY_DERIVATIVE_RESTRICTION_DISPOSITIONS_V0 = [
  "not_applicable_to_operation",
  "satisfied",
  "superseded_by_permission",
] as const;

const MAXIMUM_APPROVAL_TTL_SECONDS = 31_536_000;
const DERIVATIVE_OPERATION_ID = /^[a-z][a-z0-9_]{0,79}\/v(?:0|[1-9][0-9]{0,8})$/u;
const DERIVATIVE_CLASS = /^[a-z][a-z0-9_]{0,119}$/u;

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

function sameOrderedStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function domainSeparatedDigest(domain: string, input: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(input);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

const FoundryDerivativeOperationIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(DERIVATIVE_OPERATION_ID);

const FoundryDerivativeClassSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(DERIVATIVE_CLASS);

export const FoundryDerivativeAuthorizedActionsV0Schema = z.tuple([
  z.literal(FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0[0]),
  z.literal(FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0[1]),
]);

export const FoundryDerivativeForbiddenDownstreamUsesV0Schema = z.tuple([
  z.literal(FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0[0]),
  z.literal(FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0[1]),
  z.literal(FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0[2]),
]);

export const FoundryDerivativeOperationBindingV0Schema = z
  .object({
    operationId: FoundryDerivativeOperationIdSchema,
    derivativeClass: FoundryDerivativeClassSchema,
  })
  .strict();
export type FoundryDerivativeOperationBindingV0 = z.infer<
  typeof FoundryDerivativeOperationBindingV0Schema
>;

export const FoundryDerivativeRightsPolicyOperationV0Schema = z
  .object({
    operationId: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0),
    derivativeClass: z.literal(
      FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
    ),
    requiredStageKind: z.literal("geometry"),
    requiredInputType: z.literal("glb_gltf"),
    requiredMediaType: z.literal("model/gltf-binary"),
    requiredFileExtension: z.literal(".glb"),
    requiredAssetCount: z.literal(1),
    requiredRightsPurposes: z.tuple([z.literal("commercial_internal_use")]),
    requiredCommand: z.tuple([
      z.literal("omnitwin-sealed-worker"),
      z.literal("normalize_mesh_glb"),
      z.literal("v0"),
    ]),
    requiredNetworkAccess: z.literal("none"),
    deterministic: z.literal(true),
  })
  .strict();
export type FoundryDerivativeRightsPolicyOperationV0 = z.infer<
  typeof FoundryDerivativeRightsPolicyOperationV0Schema
>;

/** Immutable policy definition. Registry lookup, not parsing or hashing, establishes trust. */
export const FoundryDerivativeRightsPolicyV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_DERIVATIVE_RIGHTS_POLICY_V0),
    policyVersion: RuntimeManifestKeySchema,
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    effectiveAt: FoundryUtcInstantSchema,
    maximumApprovalTtlSeconds: z
      .number()
      .int()
      .positive()
      .max(MAXIMUM_APPROVAL_TTL_SECONDS),
    requireNonUnknownRightsBasis: z.literal(true),
    requireHttpsTermsReference: z.literal(true),
    requireTermsReviewedAt: z.literal(true),
    authorizedActions: FoundryDerivativeAuthorizedActionsV0Schema,
    forbiddenDownstreamUses:
      FoundryDerivativeForbiddenDownstreamUsesV0Schema,
    operations: z.tuple([FoundryDerivativeRightsPolicyOperationV0Schema]),
  })
  .strict();
export type FoundryDerivativeRightsPolicyV0 = z.infer<
  typeof FoundryDerivativeRightsPolicyV0Schema
>;

/** Append-only revocation evidence. An absent record means no trusted revocation is recorded. */
export const FoundryDerivativeRightsPolicyRevocationV0Schema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_DERIVATIVE_RIGHTS_POLICY_REVOCATION_V0,
    ),
    revocationId: RuntimeManifestKeySchema,
    policyVersion: RuntimeManifestKeySchema,
    policyDefinitionSha256: RuntimeSha256Schema,
    policyGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    revokedAt: FoundryUtcInstantSchema,
    revokedBy: FoundryCanonicalActorSchema,
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type FoundryDerivativeRightsPolicyRevocationV0 = z.infer<
  typeof FoundryDerivativeRightsPolicyRevocationV0Schema
>;

/**
 * Caller-supplied registry state. Parsing validates shape only; the caller must
 * authenticate the registry and preserve the append-only revocation record.
 */
export const FoundryDerivativeRightsTrustedPolicyStateV0Schema = z
  .object({
    definition: FoundryDerivativeRightsPolicyV0Schema,
    revocation: FoundryDerivativeRightsPolicyRevocationV0Schema.nullable(),
  })
  .strict();
export type FoundryDerivativeRightsTrustedPolicyStateV0 = z.infer<
  typeof FoundryDerivativeRightsTrustedPolicyStateV0Schema
>;

/**
 * Claimant-bound artifact metadata. Its digest does not by itself prove that
 * the bytes exist, are in durable custody, are authentic, or match legal text.
 */
export const FoundryDerivativeTermsEvidenceArtifactV0Schema = z
  .object({
    artifactId: RuntimeManifestKeySchema,
    sha256: RuntimeSha256Schema,
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    mediaType: z.string().trim().min(1).max(160),
    capturedAt: FoundryUtcInstantSchema,
  })
  .strict();
export type FoundryDerivativeTermsEvidenceArtifactV0 = z.infer<
  typeof FoundryDerivativeTermsEvidenceArtifactV0Schema
>;

export const FoundryDerivativeRestrictionSubjectV0Schema = z
  .object({
    assetId: RuntimeManifestKeySchema,
    restrictionIndex: z.number().int().nonnegative().max(49),
    restrictionText: z.string().trim().min(1).max(500),
  })
  .strict();
export type FoundryDerivativeRestrictionSubjectV0 = z.infer<
  typeof FoundryDerivativeRestrictionSubjectV0Schema
>;

export const FoundryDerivativeRestrictionDispositionV0Schema = z
  .object({
    restrictionIndex: z.number().int().nonnegative().max(49),
    restrictionText: z.string().trim().min(1).max(500),
    restrictionSha256: RuntimeSha256Schema,
    disposition: z.enum(FOUNDRY_DERIVATIVE_RESTRICTION_DISPOSITIONS_V0),
    rationale: z.string().trim().min(1).max(2_000),
    supportingEvidenceSha256: RuntimeSha256Schema,
  })
  .strict();
export type FoundryDerivativeRestrictionDispositionV0 = z.infer<
  typeof FoundryDerivativeRestrictionDispositionV0Schema
>;

export const FoundryDerivativeAssetRightsEvidenceV0Schema = z
  .object({
    assetId: RuntimeManifestKeySchema,
    basis: z.enum([
      "customer_owned",
      "explicit_licence",
      "vendor_export_terms",
      "written_permission",
      "public_domain",
    ]),
    termsReference: z
      .string()
      .url()
      .refine(
        (value) => value.toLowerCase().startsWith("https://"),
        "terms reference must use HTTPS",
      ),
    reviewedAt: FoundryUtcInstantSchema,
    termsEvidenceArtifact: FoundryDerivativeTermsEvidenceArtifactV0Schema,
    restrictionsReviewed: z.literal(true),
    restrictionDispositions: z
      .array(FoundryDerivativeRestrictionDispositionV0Schema)
      .max(50),
  })
  .strict();
export type FoundryDerivativeAssetRightsEvidenceV0 = z.infer<
  typeof FoundryDerivativeAssetRightsEvidenceV0Schema
>;

/**
 * A decision for one exact JobSpec subject, manifest, stage, operation, and
 * canonical stage asset set. This remains evidence, not a dispatch capability.
 */
export const FoundryDerivativeRightsApprovalV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0),
    approvalId: RuntimeManifestKeySchema,
    policyVersion: RuntimeManifestKeySchema,
    policyDefinitionSha256: RuntimeSha256Schema,
    policyGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    jobSubjectSha256: RuntimeSha256Schema,
    ingestManifestSha256: RuntimeSha256Schema,
    stageId: RuntimeManifestKeySchema,
    operation: FoundryDerivativeOperationBindingV0Schema,
    authorizedActions: FoundryDerivativeAuthorizedActionsV0Schema,
    forbiddenDownstreamUses:
      FoundryDerivativeForbiddenDownstreamUsesV0Schema,
    assetIds: z.array(RuntimeManifestKeySchema).length(1),
    assetRightsEvidence: z
      .array(FoundryDerivativeAssetRightsEvidenceV0Schema)
      .length(1),
    assetSnapshots: z.array(FoundryInputAssetSchema).length(1),
    decision: z.literal("allowed"),
    decidedBy: FoundryCanonicalActorSchema,
    decidedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((approval, ctx) => {
    if (!isStrictlyAsciiSorted(approval.assetIds)) {
      addIssue(
        ctx,
        ["assetIds"],
        "derivative approval asset IDs must be unique and sorted by canonical asset ID",
      );
    }
    const evidenceAssetIds = approval.assetRightsEvidence.map(
      (evidence) => evidence.assetId,
    );
    if (
      !isStrictlyAsciiSorted(evidenceAssetIds) ||
      !sameOrderedStrings(approval.assetIds, evidenceAssetIds)
    ) {
      addIssue(
        ctx,
        ["assetRightsEvidence"],
        "rights evidence must contain the exact canonical approval asset IDs",
      );
    }
    const snapshotAssetIds = approval.assetSnapshots.map(
      (snapshot) => snapshot.id,
    );
    if (
      !isStrictlyAsciiSorted(snapshotAssetIds) ||
      !sameOrderedStrings(approval.assetIds, snapshotAssetIds)
    ) {
      addIssue(
        ctx,
        ["assetSnapshots"],
        "asset snapshots must contain the exact canonical approval asset IDs",
      );
    }
    const decidedAt = Date.parse(approval.decidedAt);
    if (decidedAt >= Date.parse(approval.expiresAt)) {
      addIssue(
        ctx,
        ["expiresAt"],
        "derivative-rights approval must expire after its decision",
      );
    }
    for (const [index, evidence] of approval.assetRightsEvidence.entries()) {
      const snapshot = approval.assetSnapshots[index];
      if (
        snapshot === undefined ||
        snapshot.id !== evidence.assetId ||
        snapshot.rights.basis !== evidence.basis ||
        snapshot.rights.termsReference !== evidence.termsReference ||
        snapshot.rights.termsReviewedAt !== evidence.reviewedAt
      ) {
        addIssue(
          ctx,
          ["assetSnapshots", index, "rights"],
          "full asset snapshot rights must exactly match the explicit evidence record",
        );
      }
      if (Date.parse(evidence.reviewedAt) > decidedAt) {
        addIssue(
          ctx,
          ["assetRightsEvidence", index, "reviewedAt"],
          "rights evidence must be reviewed no later than the approval decision",
        );
      }
      if (Date.parse(evidence.termsEvidenceArtifact.capturedAt) > Date.parse(evidence.reviewedAt)) {
        addIssue(
          ctx,
          ["assetRightsEvidence", index, "termsEvidenceArtifact", "capturedAt"],
          "terms evidence artifact must be captured no later than rights review",
        );
      }
      const restrictions = snapshot?.rights.restrictions ?? [];
      if (evidence.restrictionDispositions.length !== restrictions.length) {
        addIssue(
          ctx,
          ["assetRightsEvidence", index, "restrictionDispositions"],
          "rights evidence requires exactly one disposition for every ordered restriction",
        );
      }
      for (const [restrictionIndex, disposition] of evidence.restrictionDispositions.entries()) {
        const restrictionText = restrictions[restrictionIndex];
        if (
          restrictionText === undefined ||
          disposition.restrictionIndex !== restrictionIndex ||
          disposition.restrictionText !== restrictionText ||
          disposition.restrictionSha256 !==
            computeFoundryDerivativeRightsRestrictionSha256({
              assetId: evidence.assetId,
              restrictionIndex,
              restrictionText,
            })
        ) {
          addIssue(
            ctx,
            ["assetRightsEvidence", index, "restrictionDispositions", restrictionIndex],
            "restriction disposition must bind the exact ordered asset restriction",
          );
        }
        if (
          disposition.supportingEvidenceSha256 !==
          evidence.termsEvidenceArtifact.sha256
        ) {
          addIssue(
            ctx,
            [
              "assetRightsEvidence",
              index,
              "restrictionDispositions",
              restrictionIndex,
              "supportingEvidenceSha256",
            ],
            "restriction disposition must cite the bound terms evidence artifact",
          );
        }
      }
    }
  });
export type FoundryDerivativeRightsApprovalV0 = z.infer<
  typeof FoundryDerivativeRightsApprovalV0Schema
>;

export function computeFoundryDerivativeRightsPolicySha256(
  input: unknown,
): string {
  const policy = FoundryDerivativeRightsPolicyV0Schema.parse(input);
  return domainSeparatedDigest(FOUNDRY_DERIVATIVE_RIGHTS_POLICY_V0, policy);
}

export function computeFoundryDerivativeRightsPolicyRevocationSha256(
  input: unknown,
): string {
  const revocation = FoundryDerivativeRightsPolicyRevocationV0Schema.parse(input);
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_RIGHTS_POLICY_REVOCATION_V0,
    revocation,
  );
}

export function computeFoundryDerivativeRightsRestrictionSha256(
  input: unknown,
): string {
  const subject = FoundryDerivativeRestrictionSubjectV0Schema.parse(input);
  return domainSeparatedDigest(FOUNDRY_DERIVATIVE_RIGHTS_RESTRICTION_V0, subject);
}

export function computeFoundryDerivativeRightsApprovalSha256(
  input: unknown,
): string {
  const approval = FoundryDerivativeRightsApprovalV0Schema.parse(input);
  return domainSeparatedDigest(FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0, approval);
}

export type FoundryDerivativeRightsValidationReason =
  | "invalid_job_spec"
  | "invalid_ingest_manifest"
  | "invalid_derivative_rights_policy_state"
  | "invalid_derivative_rights_approval"
  | "invalid_validation_time"
  | "job_not_yet_valid"
  | "project_subject_mismatch"
  | "manifest_legal_review_blocked"
  | "ingest_manifest_subject_mismatch"
  | "job_subject_mismatch"
  | "derivative_rights_policy_inactive"
  | "derivative_rights_policy_revocation_subject_mismatch"
  | "derivative_rights_policy_revocation_predates_policy"
  | "derivative_rights_policy_subject_mismatch"
  | "approval_predates_job"
  | "approval_predates_policy"
  | "approval_not_yet_valid"
  | "approval_expired"
  | "approval_ttl_exceeds_policy"
  | "approval_outlives_policy"
  | "stage_not_found"
  | "operation_policy_mismatch"
  | "forbidden_downstream_use_in_job"
  | "stage_operation_mismatch"
  | "stage_asset_subject_mismatch"
  | "asset_rights_evidence_incomplete"
  | "asset_rights_evidence_mismatch"
  | "asset_record_snapshot_mismatch"
  | "static_job_rights_not_allowed";

export type FoundryDerivativeRightsValidationDecision =
  | {
      valid: true;
      policy: FoundryDerivativeRightsPolicyV0;
      policyRevocation: FoundryDerivativeRightsPolicyRevocationV0 | null;
      approval: FoundryDerivativeRightsApprovalV0;
    }
  | {
      valid: false;
      reason: FoundryDerivativeRightsValidationReason;
      blockers?: readonly string[];
    };

/**
 * Pure derivative-rights evidence preflight. Success proves structural,
 * subject, policy, time, operation, and evidence consistency only. It neither
 * authenticates the caller or registry, nor grants live execution authority,
 * consumes an approval, persists state, or replaces validateFoundryJobRights.
 */
export function validateFoundryDerivativeRightsApproval(
  jobInput: unknown,
  manifestInput: unknown,
  approvalInput: unknown,
  nowInput: Date,
  trustedPolicyStateInput: unknown,
): FoundryDerivativeRightsValidationDecision {
  const jobResult = FoundryJobSpecV0Schema.safeParse(jobInput);
  if (!jobResult.success) return { valid: false, reason: "invalid_job_spec" };
  const manifestResult = FoundryIngestManifestV0Schema.safeParse(manifestInput);
  if (!manifestResult.success) {
    return { valid: false, reason: "invalid_ingest_manifest" };
  }
  const policyStateResult = FoundryDerivativeRightsTrustedPolicyStateV0Schema.safeParse(
    trustedPolicyStateInput,
  );
  if (!policyStateResult.success) {
    return { valid: false, reason: "invalid_derivative_rights_policy_state" };
  }
  const approvalResult = FoundryDerivativeRightsApprovalV0Schema.safeParse(
    approvalInput,
  );
  if (!approvalResult.success) {
    return { valid: false, reason: "invalid_derivative_rights_approval" };
  }
  const now = nowInput.getTime();
  if (!Number.isFinite(now)) {
    return { valid: false, reason: "invalid_validation_time" };
  }

  const job = jobResult.data;
  const manifest = manifestResult.data;
  const policy = policyStateResult.data.definition;
  const policyRevocation = policyStateResult.data.revocation;
  const approval = approvalResult.data;
  if (Date.parse(job.createdAt) > now) {
    return { valid: false, reason: "job_not_yet_valid" };
  }
  if (job.projectId !== manifest.projectId) {
    return { valid: false, reason: "project_subject_mismatch" };
  }
  // A separate exact derivative approval may close not_reviewed/requires_review
  // for this operation only. A globally blocked manifest is never overridable.
  if (manifest.legalReviewState === "blocked") {
    return { valid: false, reason: "manifest_legal_review_blocked" };
  }

  const manifestSha256 = computeFoundryIngestManifestSha256(manifest);
  if (
    job.ingestManifestSha256 !== manifestSha256 ||
    approval.ingestManifestSha256 !== manifestSha256
  ) {
    return { valid: false, reason: "ingest_manifest_subject_mismatch" };
  }
  if (
    approval.jobSubjectSha256 !==
    computeFoundryJobApprovalSubjectSha256(job)
  ) {
    return { valid: false, reason: "job_subject_mismatch" };
  }

  const policyDefinitionSha256 = computeFoundryDerivativeRightsPolicySha256(policy);
  if (
    policyRevocation !== null &&
    (policyRevocation.policyVersion !== policy.policyVersion ||
      policyRevocation.policyDefinitionSha256 !== policyDefinitionSha256 ||
      policyRevocation.policyGeneration !== policy.generation)
  ) {
    return {
      valid: false,
      reason: "derivative_rights_policy_revocation_subject_mismatch",
    };
  }
  const policyEffectiveAt = Date.parse(policy.effectiveAt);
  const policyRevokedAt =
    policyRevocation === null ? null : Date.parse(policyRevocation.revokedAt);
  if (policyRevokedAt !== null && policyRevokedAt <= policyEffectiveAt) {
    return {
      valid: false,
      reason: "derivative_rights_policy_revocation_predates_policy",
    };
  }
  if (
    policyEffectiveAt > now ||
    (policyRevokedAt !== null && policyRevokedAt <= now)
  ) {
    return { valid: false, reason: "derivative_rights_policy_inactive" };
  }
  if (
    approval.policyVersion !== policy.policyVersion ||
    approval.policyDefinitionSha256 !== policyDefinitionSha256 ||
    approval.policyGeneration !== policy.generation
  ) {
    return {
      valid: false,
      reason: "derivative_rights_policy_subject_mismatch",
    };
  }

  const forbiddenDownstreamUses = new Set<string>(
    approval.forbiddenDownstreamUses,
  );
  const forbiddenUseBlockers = job.stages.flatMap((candidate) =>
    candidate.rightsPurposes
      .filter((purpose) => forbiddenDownstreamUses.has(purpose))
      .map((purpose) => `${candidate.id}:${purpose}`),
  );
  if (forbiddenUseBlockers.length > 0) {
    return {
      valid: false,
      reason: "forbidden_downstream_use_in_job",
      blockers: forbiddenUseBlockers.sort(),
    };
  }

  const decidedAt = Date.parse(approval.decidedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  if (decidedAt < Date.parse(job.createdAt)) {
    return { valid: false, reason: "approval_predates_job" };
  }
  if (decidedAt < policyEffectiveAt) {
    return { valid: false, reason: "approval_predates_policy" };
  }
  if (decidedAt > now) {
    return { valid: false, reason: "approval_not_yet_valid" };
  }
  if (expiresAt <= now) {
    return { valid: false, reason: "approval_expired" };
  }
  if (
    expiresAt - decidedAt >
    policy.maximumApprovalTtlSeconds * 1_000
  ) {
    return { valid: false, reason: "approval_ttl_exceeds_policy" };
  }
  if (policyRevokedAt !== null && expiresAt > policyRevokedAt) {
    return { valid: false, reason: "approval_outlives_policy" };
  }

  const stage = job.stages.find((candidate) => candidate.id === approval.stageId);
  if (stage === undefined) {
    return { valid: false, reason: "stage_not_found" };
  }
  const policyOperation = policy.operations.find(
    (candidate) =>
      candidate.operationId === approval.operation.operationId &&
      candidate.derivativeClass === approval.operation.derivativeClass,
  );
  if (policyOperation === undefined) {
    return { valid: false, reason: "operation_policy_mismatch" };
  }
  if (
    stage.kind !== policyOperation.requiredStageKind ||
    !sameOrderedStrings(stage.command, policyOperation.requiredCommand) ||
    stage.networkAccess !== policyOperation.requiredNetworkAccess ||
    !sameOrderedStrings(
      stage.rightsPurposes,
      policyOperation.requiredRightsPurposes,
    )
  ) {
    return { valid: false, reason: "stage_operation_mismatch" };
  }

  const expectedAssetIds = [...stage.inputAssetIds].sort();
  if (
    expectedAssetIds.length !== policyOperation.requiredAssetCount ||
    !sameOrderedStrings(approval.assetIds, expectedAssetIds)
  ) {
    return { valid: false, reason: "stage_asset_subject_mismatch" };
  }
  const assetById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const evidenceByAssetId = new Map(
    approval.assetRightsEvidence.map((evidence) => [evidence.assetId, evidence]),
  );
  const snapshotByAssetId = new Map(
    approval.assetSnapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  for (const assetId of approval.assetIds) {
    const asset = assetById.get(assetId);
    const evidence = evidenceByAssetId.get(assetId);
    const snapshot = snapshotByAssetId.get(assetId);
    if (asset === undefined || evidence === undefined || snapshot === undefined) {
      return { valid: false, reason: "stage_asset_subject_mismatch" };
    }
    if (
      asset.inputType !== policyOperation.requiredInputType ||
      asset.mediaType !== policyOperation.requiredMediaType ||
      !asset.relativePath
        .toLowerCase()
        .endsWith(policyOperation.requiredFileExtension)
    ) {
      return { valid: false, reason: "stage_operation_mismatch" };
    }
    if (
      asset.rights.basis === "unknown" ||
      asset.rights.termsReference === null ||
      asset.rights.termsReviewedAt === null
    ) {
      return { valid: false, reason: "asset_rights_evidence_incomplete" };
    }
    if (
      evidence.basis !== asset.rights.basis ||
      evidence.termsReference !== asset.rights.termsReference ||
      evidence.reviewedAt !== asset.rights.termsReviewedAt
    ) {
      return { valid: false, reason: "asset_rights_evidence_mismatch" };
    }
    if (
      stableCanonicalJson(CanonicalJsonValueSchema.parse(snapshot)) !==
      stableCanonicalJson(CanonicalJsonValueSchema.parse(asset))
    ) {
      return { valid: false, reason: "asset_record_snapshot_mismatch" };
    }
  }

  const staticRightsDecision = validateFoundryJobRights(job, manifest);
  if (!staticRightsDecision.allowed) {
    return {
      valid: false,
      reason: "static_job_rights_not_allowed",
      blockers: staticRightsDecision.blockers,
    };
  }
  return { valid: true, policy, policyRevocation, approval };
}

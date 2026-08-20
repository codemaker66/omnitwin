import { describe, expect, it } from "vitest";
import {
  HISTORICAL_RUNTIME_EXECUTION_ACTIVATION_PREDICATE_TYPE,
  HISTORICAL_RUNTIME_EXECUTION_ACTIVATION_SCHEMA_VERSION,
  HISTORICAL_RUNTIME_EXECUTION_KEY_POLICY_SCHEMA_VERSION,
  HistoricalRuntimeExecutionActivationPredicateSchema,
  HistoricalRuntimeExecutionKeyPolicySchema,
  HistoricalRuntimeExecutionSigningPayloadSchema,
  createHistoricalRuntimeExecutionStatement,
  createHistoricalRuntimeExecutionSigningPayload,
  historicalRuntimeExecutionKeyPolicyDigest,
  historicalRuntimeExecutionObjectReceiptDigest,
  phaseLayoutRuntimeCompositionDigest,
  type HistoricalRuntimeExecutionActivationPredicate,
  type HistoricalRuntimeExecutionKeyPolicy,
} from "../index.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);

function keyPolicy(): HistoricalRuntimeExecutionKeyPolicy {
  const unsigned = {
    schemaVersion: HISTORICAL_RUNTIME_EXECUTION_KEY_POLICY_SCHEMA_VERSION,
    policyId: "10000000-0000-4000-8000-000000000001",
    purpose: "historical_runtime_execution_activation" as const,
    algorithm: "ed25519" as const,
    keyId: "runtime-activation-2026-q3",
    publicKeyFingerprint: SHA_A,
    registeredBy: "10000000-0000-4000-8000-000000000002",
    registeredAt: "2026-08-20T09:00:00.000Z",
    effectiveAt: "2026-08-20T09:00:00.000Z",
    expiresAt: "2026-11-18T09:00:00.000Z",
  };
  return HistoricalRuntimeExecutionKeyPolicySchema.parse({
    ...unsigned,
    policyDigest: historicalRuntimeExecutionKeyPolicyDigest(unsigned),
  });
}

function predicate(): HistoricalRuntimeExecutionActivationPredicate {
  const visualAsset = {
    memberIndex: 0,
    assetVersionId: "20000000-0000-4000-8000-000000000001",
    fileName: "grand-hall.sog",
    fileExt: ".sog" as const,
    mimeType: "application/octet-stream",
    sha256: SHA_A,
    sizeBytes: 36,
    evidenceStatus: "human_reviewed" as const,
  };
  const receiptMaterial = {
    ...visualAsset,
    admissionId: "30000000-0000-4000-8000-000000000001",
    rightsEvidenceRowId: "30000000-0000-4000-8000-000000000002",
    rightsEvidenceDigest: SHA_B,
    rightsDecision: "approved" as const,
    rightsReviewedBy: "30000000-0000-4000-8000-000000000003",
    rightsReviewedAt: "2026-08-20T08:00:00.000Z",
    storageKeySha256: SHA_C,
    privateBucketSha256: SHA_D,
    storageVersion: "018f-runtime-object-version-1",
    storageEtag: "\"9f86d081884c7d659a2feaa0c55ad015\"",
  };
  const member = {
    ...receiptMaterial,
    objectReceiptDigest: historicalRuntimeExecutionObjectReceiptDigest(receiptMaterial),
  };
  const runtimePackageId = "40000000-0000-4000-8000-000000000001";
  const runtimePackageContentDigest = SHA_B;
  const transformArtifactDigest = SHA_C;
  const reviewedProfileId = "grand-hall-reviewed-v1";
  const compositionDigest = phaseLayoutRuntimeCompositionDigest({
    runtimePackageId,
    runtimePackageContentDigest,
    reviewedProfileId,
    transformArtifactDigest,
    visualAssets: [visualAsset],
  });
  const policy = keyPolicy();
  return HistoricalRuntimeExecutionActivationPredicateSchema.parse({
    schemaVersion: HISTORICAL_RUNTIME_EXECUTION_ACTIVATION_SCHEMA_VERSION,
    activationId: "50000000-0000-4000-8000-000000000001",
    eventId: "50000000-0000-4000-8000-000000000002",
    phaseId: "50000000-0000-4000-8000-000000000003",
    configurationId: "50000000-0000-4000-8000-000000000004",
    canonicalSnapshotId: "50000000-0000-4000-8000-000000000005",
    snapshotHash: SHA_D,
    proofDigest: SHA_A,
    tenantBoundary: "venue_id_v1",
    tenantId: "50000000-0000-4000-8000-000000000006",
    venueId: "50000000-0000-4000-8000-000000000006",
    venueSlug: "trades-hall",
    spaceId: "50000000-0000-4000-8000-000000000007",
    spaceSlug: "grand-hall",
    presentationAdmissionId: receiptMaterial.admissionId,
    presentationAdmissionDigest: SHA_C,
    presentationAdmissionReviewedBy: "50000000-0000-4000-8000-000000000008",
    presentationAdmissionReviewedAt: "2026-08-20T08:30:00.000Z",
    runtimePackageId,
    runtimePackageRevision: 2,
    runtimePackageContentDigest,
    runtimeManifestDigest: SHA_D,
    runtimePackageEvidenceStatus: "human_reviewed",
    runtimePackageStatus: "internal_ready",
    reviewedProfileId,
    reviewedProfileManifestFingerprint: SHA_A,
    rightsEvidenceDigest: SHA_B,
    sceneAuthorityMapDigest: SHA_C,
    runtimeQaRecordId: "60000000-0000-4000-8000-000000000001",
    runtimeQaRecordKey: "grand-hall-timeline-review-v1",
    runtimeQaRecordDigest: SHA_D,
    runtimeQaDecision: "approved_internal_preview",
    runtimeQaReviewedBy: "60000000-0000-4000-8000-000000000002",
    runtimeQaReviewedAt: "2026-08-20T08:10:00.000Z",
    transformArtifactRowId: "60000000-0000-4000-8000-000000000003",
    transformArtifactId: "grand-hall-arf-to-rrf-v1",
    transformArtifactDigest,
    compositionDigest,
    memberCount: 1,
    members: [member],
    keyPolicyId: policy.policyId,
    keyPolicyDigest: policy.policyDigest,
    keyId: policy.keyId,
    publicKeyFingerprint: policy.publicKeyFingerprint,
    requestedBy: "70000000-0000-4000-8000-000000000001",
    issuedAt: "2026-08-20T09:05:00.000Z",
    expiresAt: "2026-08-21T09:05:00.000Z",
    nonce: "70000000-0000-4000-8000-000000000002",
  });
}

describe("historical runtime execution activation contract", () => {
  it("binds a purpose-specific Ed25519 key policy to its exact server record", () => {
    const policy = keyPolicy();
    expect(policy.policyDigest).toBe(historicalRuntimeExecutionKeyPolicyDigest({
      schemaVersion: policy.schemaVersion,
      policyId: policy.policyId,
      purpose: policy.purpose,
      algorithm: policy.algorithm,
      keyId: policy.keyId,
      publicKeyFingerprint: policy.publicKeyFingerprint,
      registeredBy: policy.registeredBy,
      registeredAt: policy.registeredAt,
      effectiveAt: policy.effectiveAt,
      expiresAt: policy.expiresAt,
    }));
    expect(HistoricalRuntimeExecutionKeyPolicySchema.safeParse({
      ...policy,
      keyId: "different-key",
    }).success).toBe(false);
  });

  it("rejects expired-at-issue and non-contiguous member evidence", () => {
    const valid = predicate();
    expect(HistoricalRuntimeExecutionActivationPredicateSchema.safeParse({
      ...valid,
      expiresAt: valid.issuedAt,
    }).success).toBe(false);
    expect(HistoricalRuntimeExecutionActivationPredicateSchema.safeParse({
      ...valid,
      members: [{ ...valid.members[0], memberIndex: 1 }],
    }).success).toBe(false);
  });

  it("binds exact ordered storage version, ETag, size, and hash receipts", () => {
    const valid = predicate();
    expect(HistoricalRuntimeExecutionActivationPredicateSchema.safeParse(valid).success).toBe(true);
    expect(HistoricalRuntimeExecutionActivationPredicateSchema.safeParse({
      ...valid,
      members: [{ ...valid.members[0], storageVersion: "replacement-version" }],
    }).success).toBe(false);
    expect(HistoricalRuntimeExecutionActivationPredicateSchema.safeParse({
      ...valid,
      compositionDigest: SHA_A,
    }).success).toBe(false);
  });

  it("emits one exact in-toto statement and canonical DSSE payload", () => {
    const statement = createHistoricalRuntimeExecutionStatement(predicate());
    expect(statement.predicateType).toBe(
      HISTORICAL_RUNTIME_EXECUTION_ACTIVATION_PREDICATE_TYPE,
    );
    expect(statement.subject).toHaveLength(1);
    const payload = createHistoricalRuntimeExecutionSigningPayload(statement);
    expect(payload.payloadUtf8).toContain(statement.predicate.activationId);
    expect(payload.payloadSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(HistoricalRuntimeExecutionSigningPayloadSchema.safeParse({
      ...payload,
      payloadUtf8: `${payload.payloadUtf8} `,
    }).success).toBe(false);
  });
});

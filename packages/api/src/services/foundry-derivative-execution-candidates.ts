import {
  FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_REQUEST_V1,
  FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1Schema,
  FoundryDerivativeExecutionAuthorizationCandidateReservationRequestMaterialV1Schema,
  FoundryDerivativeExecutionAuthorizationCandidateV1Schema,
  FoundryDerivativeExecutionBindingSetV1Schema,
  FoundryDerivativeQuarantineOutputPolicyV1Schema,
  FoundryDerivativeRestrictionLineageSetV1Schema,
  FoundryDerivativeCandidateReservationReceiptV1Schema,
  FoundryDerivativeRightsCanonicalUuidV1Schema,
  FoundryDerivativeRightsRegistryAttestationRegistrationInputV1Schema,
  FoundryDerivativeRightsRegistryAttestationRegistrationRequestMaterialV1Schema,
  FoundryDerivativeRightsRegistryAttestationRevocationInputV1Schema,
  FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1Schema,
  FoundryDerivativeRightsRegistryAttestationRevocationV1Schema,
  FoundryDerivativeRightsRegistryAttestationV1Schema,
  RuntimeManifestKeySchema,
  computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256,
  computeFoundryDerivativeExecutionAuthorizationCandidateSha256,
  computeFoundryDerivativeExecutionBindingSetSha256,
  computeFoundryDerivativeQuarantineOutputPolicySha256,
  computeFoundryDerivativeRestrictionLineageSetSha256,
  computeFoundryDerivativeCandidateReservationReceiptSha256,
  computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256,
  computeFoundryDerivativeRightsRegistryAttestationRevocationRequestSha256,
  computeFoundryDerivativeRightsRegistryAttestationRevocationSha256,
  computeFoundryDerivativeRightsRegistryAttestationSha256,
  type FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1,
  type FoundryDerivativeExecutionAuthorizationCandidateV1,
  type FoundryDerivativeRightsRegistryAttestationRegistrationInputV1,
  type FoundryDerivativeRightsRegistryAttestationRevocationInputV1,
  type FoundryDerivativeRightsRegistryAttestationRevocationV1,
  type FoundryDerivativeRightsRegistryAttestationV1,
} from "@omnitwin/types";
import {
  computeFoundryExecutionSubjectSha256,
  type FoundryExecutionSubjectV0,
} from "@omnitwin/reconstruction-foundry";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import {
  foundryDerivativeExecutionAuthorizationCandidatesV1,
  foundryDerivativeRightsRegistryAttestationRevocationsV1,
  foundryDerivativeRightsRegistryAttestationsV1,
} from "../db/schema.js";
import {
  FoundryExecutionSubjectBindingV0Schema,
  type FoundryExecutionSubjectBindingV0,
} from "./foundry-provider-request-authorization.js";

type AttestationRow =
  typeof foundryDerivativeRightsRegistryAttestationsV1.$inferSelect;
type RevocationRow =
  typeof foundryDerivativeRightsRegistryAttestationRevocationsV1.$inferSelect;
type CandidateRow =
  typeof foundryDerivativeExecutionAuthorizationCandidatesV1.$inferSelect;

export interface FoundryDerivativeRegistryAttestationCommand extends FoundryDerivativeRightsRegistryAttestationRegistrationInputV1 {
  readonly idempotencyKey: string;
}

export interface FoundryDerivativeRegistryAttestationRevocationCommand extends FoundryDerivativeRightsRegistryAttestationRevocationInputV1 {
  readonly idempotencyKey: string;
}

export interface FoundryDerivativeExecutionCandidateReservationCommand extends FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1 {
  readonly baseExecutionSubject: FoundryExecutionSubjectBindingV0;
  readonly idempotencyKey: string;
}

export interface FoundryDerivativeExecutionCandidatesServiceApi {
  registerRegistryAttestation(
    input: FoundryDerivativeRegistryAttestationCommand,
    actorUserId: string,
  ): Promise<FoundryDerivativeRightsRegistryAttestationV1>;
  revokeRegistryAttestation(
    input: FoundryDerivativeRegistryAttestationRevocationCommand,
    actorUserId: string,
  ): Promise<FoundryDerivativeRightsRegistryAttestationRevocationV1>;
  reserveAuthorizationCandidate(
    input: FoundryDerivativeExecutionCandidateReservationCommand,
    actorUserId: string,
  ): Promise<FoundryDerivativeExecutionAuthorizationCandidateV1>;
}

export class FoundryDerivativeExecutionCandidateNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundryDerivativeExecutionCandidateNotFoundError";
  }
}

export class FoundryDerivativeExecutionCandidateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundryDerivativeExecutionCandidateConflictError";
  }
}

export class FoundryDerivativeExecutionCandidateIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundryDerivativeExecutionCandidateIntegrityError";
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

function rethrowDatabaseError(error: unknown, conflictMessage: string): never {
  if (
    error instanceof FoundryDerivativeExecutionCandidateNotFoundError ||
    error instanceof FoundryDerivativeExecutionCandidateConflictError ||
    error instanceof FoundryDerivativeExecutionCandidateIntegrityError
  ) {
    throw error;
  }
  if (error instanceof z.ZodError) {
    throw new FoundryDerivativeExecutionCandidateIntegrityError(
      "Stored derivative evidence failed canonical schema validation.",
    );
  }
  const code = postgresErrorCode(error);
  if (code === "23505") {
    throw new FoundryDerivativeExecutionCandidateConflictError(conflictMessage);
  }
  if (code === "23503" || code === "23514" || code === "42501") {
    throw new FoundryDerivativeExecutionCandidateIntegrityError(
      "PostgreSQL rejected derivative evidence that was no longer exact, current, or authorized for inert registration.",
    );
  }
  throw error;
}

function requireActorUserId(value: string): string {
  if (!FoundryDerivativeRightsCanonicalUuidV1Schema.safeParse(value).success) {
    throw new FoundryDerivativeExecutionCandidateIntegrityError(
      "Authenticated actor identity is invalid.",
    );
  }
  return value;
}

function requireIdempotencyKey(value: string): string {
  const parsed = RuntimeManifestKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new FoundryDerivativeExecutionCandidateIntegrityError(
      "Idempotency key is invalid.",
    );
  }
  return parsed.data;
}

function runtimeValueEquals(actual: unknown, expected: unknown): boolean {
  return actual === expected;
}

function computeBaseExecutionSubjectSha256(
  input: unknown,
): { readonly subject: FoundryExecutionSubjectBindingV0; readonly sha256: string } {
  try {
    const subject = FoundryExecutionSubjectBindingV0Schema.parse(input);
    const sha256 = computeFoundryExecutionSubjectSha256(
      subject as FoundryExecutionSubjectV0,
    );
    return { subject, sha256 };
  } catch (error: unknown) {
    if (error instanceof FoundryDerivativeExecutionCandidateIntegrityError) {
      throw error;
    }
    throw new FoundryDerivativeExecutionCandidateIntegrityError(
      "Base execution subject failed canonical or semantic validation.",
    );
  }
}

function parseFullAttestation(
  materialInput: unknown,
  digest: string,
): FoundryDerivativeRightsRegistryAttestationV1 {
  const attestation = FoundryDerivativeRightsRegistryAttestationV1Schema.parse({
    ...(materialInput as Record<string, unknown>),
    registryAttestationSha256: digest,
  });
  const { registryAttestationSha256: _digest, ...material } = attestation;
  if (
    computeFoundryDerivativeRightsRegistryAttestationSha256(material) !==
    attestation.registryAttestationSha256
  ) {
    throw new FoundryDerivativeExecutionCandidateIntegrityError(
      "Registry attestation digest does not reproduce its canonical material.",
    );
  }
  return attestation;
}

function serializeAttestation(row: AttestationRow): FoundryDerivativeRightsRegistryAttestationV1 {
  const request =
    FoundryDerivativeRightsRegistryAttestationRegistrationRequestMaterialV1Schema.parse(
      row.registrationRequestJson,
    );
  const attestation = parseFullAttestation(
    row.registryAttestationJson,
    row.registryAttestationSha256,
  );
  const approval = attestation.derivativeRightsApproval;
  const review = attestation.acceptedReviewReceipt;
  const custody = attestation.termsEvidenceCustodyReceipt;
  if (
    computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256(
      request,
    ) !== row.registrationRequestSha256 ||
    attestation.registrationRequestSha256 !== row.registrationRequestSha256 ||
    attestation.attestationId !== row.id ||
    attestation.attestedByUserId !== row.attestedByUserId ||
    attestation.attestedAt !== row.attestedAt.toISOString() ||
    !runtimeValueEquals(attestation.registryAuthority, row.registryAuthority) ||
    !runtimeValueEquals(attestation.executionEligible, row.executionEligible) ||
    approval.approvalId !== row.approvalId ||
    request.approvalId !== row.approvalId ||
    request.derivativeRightsApprovalSha256 !==
      row.derivativeRightsApprovalSha256 ||
    review.reviewId !== row.reviewId ||
    request.reviewId !== row.reviewId ||
    review.reviewReceiptSha256 !== row.reviewReceiptSha256 ||
    request.reviewReceiptSha256 !== row.reviewReceiptSha256 ||
    custody.custodyId !== row.termsCustodyId ||
    request.custodyId !== row.termsCustodyId ||
    custody.custodyReceiptSha256 !== row.termsCustodyReceiptSha256 ||
    request.custodyReceiptSha256 !== row.termsCustodyReceiptSha256 ||
    approval.policyVersion !== row.policyVersion ||
    approval.policyDefinitionSha256 !== row.policyDefinitionSha256 ||
    BigInt(approval.policyGeneration) !== row.policyGeneration ||
    approval.jobSubjectSha256 !== row.jobSubjectSha256 ||
    approval.ingestManifestSha256 !== row.ingestManifestSha256 ||
    approval.stageId !== row.stageId ||
    approval.operation.operationId !== row.operationId ||
    approval.operation.derivativeClass !== row.derivativeClass ||
    approval.assetIds[0] !== row.assetId ||
    approval.expiresAt !== row.approvalExpiresAt.toISOString() ||
    row.recordedAt.getTime() !== row.attestedAt.getTime()
  ) {
    throw new FoundryDerivativeExecutionCandidateIntegrityError(
      "Registry attestation row does not match its canonical request and evidence graph.",
    );
  }
  return attestation;
}

function serializeRevocation(
  row: RevocationRow,
): FoundryDerivativeRightsRegistryAttestationRevocationV1 {
  const request =
    FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1Schema.parse(
      row.revocationRequestJson,
    );
  const revocation =
    FoundryDerivativeRightsRegistryAttestationRevocationV1Schema.parse({
      ...row.attestationRevocationJson,
      attestationRevocationSha256: row.attestationRevocationSha256,
    });
  const { attestationRevocationSha256: _digest, ...material } = revocation;
  if (
    computeFoundryDerivativeRightsRegistryAttestationRevocationRequestSha256(
      request,
    ) !== row.revocationRequestSha256 ||
    computeFoundryDerivativeRightsRegistryAttestationRevocationSha256(material) !==
      row.attestationRevocationSha256 ||
    revocation.revocationRequestSha256 !== row.revocationRequestSha256 ||
    revocation.revocationId !== row.id ||
    revocation.attestationId !== row.attestationId ||
    request.attestationId !== row.attestationId ||
    revocation.registryAttestationSha256 !== row.registryAttestationSha256 ||
    request.registryAttestationSha256 !== row.registryAttestationSha256 ||
    revocation.reason !== row.reason ||
    request.reason !== row.reason ||
    revocation.revokedByUserId !== row.revokedByUserId ||
    revocation.revokedAt !== row.revokedAt.toISOString() ||
    !runtimeValueEquals(revocation.registryAuthority, row.registryAuthority) ||
    !runtimeValueEquals(revocation.executionEligible, row.executionEligible) ||
    row.recordedAt.getTime() !== row.revokedAt.getTime()
  ) {
    throw new FoundryDerivativeExecutionCandidateIntegrityError(
      "Registry attestation revocation row does not match its canonical request and subject.",
    );
  }
  const embedded = revocation.registryAttestation;
  const { registryAttestationSha256: _attestationDigest, ...attestationMaterial } =
    embedded;
  if (
    computeFoundryDerivativeRightsRegistryAttestationSha256(
      attestationMaterial,
    ) !== embedded.registryAttestationSha256
  ) {
    throw new FoundryDerivativeExecutionCandidateIntegrityError(
      "Revocation embeds an invalid registry attestation.",
    );
  }
  return revocation;
}

function serializeCandidate(
  row: CandidateRow,
): FoundryDerivativeExecutionAuthorizationCandidateV1 {
  const base = computeBaseExecutionSubjectSha256(row.baseExecutionSubjectJson);
  const request =
    FoundryDerivativeExecutionAuthorizationCandidateReservationRequestMaterialV1Schema.parse(
      row.reservationRequestJson,
    );
  const bindingSet = FoundryDerivativeExecutionBindingSetV1Schema.parse(
    row.bindingSetJson,
  );
  const restrictionLineageSet =
    FoundryDerivativeRestrictionLineageSetV1Schema.parse(
      row.restrictionLineageSetJson,
    );
  const outputPolicy = FoundryDerivativeQuarantineOutputPolicyV1Schema.parse(
    row.outputPolicyJson,
  );
  const reservationReceipt = FoundryDerivativeCandidateReservationReceiptV1Schema.parse({
    ...row.candidateReservationReceiptJson,
    reservationReceiptSha256: row.candidateReservationReceiptSha256,
  });
  const candidate = FoundryDerivativeExecutionAuthorizationCandidateV1Schema.parse(
    { ...row.candidateJson, candidateSha256: row.candidateSha256 },
  );
  const {
    reservationReceiptSha256: _reservationReceiptDigest,
    ...reservationReceiptMaterial
  } = reservationReceipt;
  const { candidateSha256: _candidateDigest, ...candidateMaterial } = candidate;
  const embeddedAttestation = candidate.registryAttestation;
  const {
    registryAttestationSha256: _registryAttestationDigest,
    ...attestationMaterial
  } = embeddedAttestation;
  if (
    base.sha256 !== row.baseExecutionSubjectSha256 ||
    computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256(
      request,
    ) !== row.reservationRequestSha256 ||
    computeFoundryDerivativeExecutionBindingSetSha256(bindingSet) !==
      row.bindingSetSha256 ||
    computeFoundryDerivativeRestrictionLineageSetSha256(
      restrictionLineageSet,
    ) !== row.restrictionLineageSetSha256 ||
    computeFoundryDerivativeQuarantineOutputPolicySha256(outputPolicy) !==
      row.outputPolicySha256 ||
    computeFoundryDerivativeCandidateReservationReceiptSha256(
      reservationReceiptMaterial,
    ) !== row.candidateReservationReceiptSha256 ||
    computeFoundryDerivativeRightsRegistryAttestationSha256(
      attestationMaterial,
    ) !== row.registryAttestationSha256 ||
    computeFoundryDerivativeExecutionAuthorizationCandidateSha256(
      candidateMaterial,
    ) !== row.candidateSha256 ||
    candidate.candidateId !== row.id ||
    candidate.reservationRequestSha256 !== row.reservationRequestSha256 ||
    candidate.baseExecutionSubjectSha256 !== row.baseExecutionSubjectSha256 ||
    candidate.projectId !== row.projectId ||
    candidate.jobId !== row.jobId ||
    candidate.jobSpecSha256 !== row.jobSpecSha256 ||
    candidate.executionEnvelopeSha256 !== row.executionEnvelopeSha256 ||
    candidate.ingestManifestSha256 !== row.ingestManifestSha256 ||
    candidate.jobSubjectSha256 !== row.jobSubjectSha256 ||
    candidate.registryAttestationSha256 !== row.registryAttestationSha256 ||
    candidate.bindingSetSha256 !== row.bindingSetSha256 ||
    candidate.restrictionLineageSetSha256 !== row.restrictionLineageSetSha256 ||
    candidate.outputPolicySha256 !== row.outputPolicySha256 ||
    candidate.candidateReservationReceiptSha256 !==
      row.candidateReservationReceiptSha256 ||
    candidate.candidateReservationReceipt.reservationId !== row.reservationId ||
    candidate.candidateReservationReceipt.reservedByUserId !== row.reservedByUserId ||
    candidate.candidateReservationReceipt.reservedAt !== row.assembledAt.toISOString() ||
    !runtimeValueEquals(candidate.outputDisposition, row.outputDisposition) ||
    !runtimeValueEquals(candidate.authority, row.authority) ||
    !runtimeValueEquals(candidate.executionEligible, row.executionEligible) ||
    !runtimeValueEquals(candidate.dispatchEnabled, row.dispatchEnabled) ||
    candidate.assembledAt !== row.assembledAt.toISOString() ||
    candidate.registryAttestation.derivativeRightsApproval.approvalId !==
      row.approvalId ||
    candidate.registryAttestation.acceptedReviewReceipt.reviewId !== row.reviewId ||
    candidate.bindingSet.bindings[0]?.workerProfileSha256 !==
      row.workerProfileSha256 ||
    !runtimeValueEquals(
      candidate.bindingSet.bindings[0]?.operationClass,
      row.operationClass,
    ) ||
    row.recordedAt.getTime() !== row.assembledAt.getTime()
  ) {
    throw new FoundryDerivativeExecutionCandidateIntegrityError(
      "Derivative candidate row does not reproduce its canonical subject, components, receipt, and inert authority state.",
    );
  }
  return candidate;
}

function assertSameAttestationRequest(
  row: AttestationRow,
  requestSha256: string,
): FoundryDerivativeRightsRegistryAttestationV1 {
  if (row.registrationRequestSha256 !== requestSha256) {
    throw new FoundryDerivativeExecutionCandidateConflictError(
      "The idempotency key was already used for a different registry attestation request.",
    );
  }
  return serializeAttestation(row);
}

function assertSameRevocationRequest(
  row: RevocationRow,
  requestSha256: string,
): FoundryDerivativeRightsRegistryAttestationRevocationV1 {
  if (row.revocationRequestSha256 !== requestSha256) {
    throw new FoundryDerivativeExecutionCandidateConflictError(
      "The idempotency key was already used for a different registry attestation revocation.",
    );
  }
  return serializeRevocation(row);
}

function assertSameCandidateRequest(
  row: CandidateRow,
  requestSha256: string,
): FoundryDerivativeExecutionAuthorizationCandidateV1 {
  if (row.reservationRequestSha256 !== requestSha256) {
    throw new FoundryDerivativeExecutionCandidateConflictError(
      "The idempotency key was already used for a different authority-none candidate reservation.",
    );
  }
  return serializeCandidate(row);
}

export class FoundryDerivativeExecutionCandidatesService implements FoundryDerivativeExecutionCandidatesServiceApi {
  constructor(private readonly db: Database) {}

  async registerRegistryAttestation(
    input: FoundryDerivativeRegistryAttestationCommand,
    actorUserIdInput: string,
  ): Promise<FoundryDerivativeRightsRegistryAttestationV1> {
    const registration =
      FoundryDerivativeRightsRegistryAttestationRegistrationInputV1Schema.parse({
        approvalId: input.approvalId,
        derivativeRightsApprovalSha256: input.derivativeRightsApprovalSha256,
        reviewId: input.reviewId,
        reviewReceiptSha256: input.reviewReceiptSha256,
        custodyId: input.custodyId,
        custodyReceiptSha256: input.custodyReceiptSha256,
      });
    const actorUserId = requireActorUserId(actorUserIdInput);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const request =
      FoundryDerivativeRightsRegistryAttestationRegistrationRequestMaterialV1Schema.parse(
        {
          schemaVersion:
            FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
          ...registration,
        },
      );
    const requestSha256 =
      computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256(
        request,
      );
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
          ${`foundry-derivative-registry-attestation-idempotency-v1\u001f${actorUserId}\u001f${idempotencyKey}`}, 0
        ))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
          ${`foundry-derivative-registry-attestation-approval-v1\u001f${registration.approvalId}`}, 0
        ))`);
        const [idempotent] = await tx
          .select()
          .from(foundryDerivativeRightsRegistryAttestationsV1)
          .where(
            and(
              eq(
                foundryDerivativeRightsRegistryAttestationsV1.attestedByUserId,
                actorUserId,
              ),
              eq(
                foundryDerivativeRightsRegistryAttestationsV1.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (idempotent !== undefined) {
          return assertSameAttestationRequest(idempotent, requestSha256);
        }
        await tx.execute(sql`
          INSERT INTO "foundry_derivative_rights_registry_attestations_v1" (
            "approval_id", "review_id", "terms_custody_id",
            "registration_request_sha256", "registration_request_json",
            "attested_by_user_id", "idempotency_key"
          ) VALUES (
            ${registration.approvalId}, ${registration.reviewId}::uuid,
            ${registration.custodyId}::uuid, ${requestSha256},
            ${JSON.stringify(request)}::jsonb, ${actorUserId}::uuid,
            ${idempotencyKey}
          )
        `);
        const [row] = await tx
          .select()
          .from(foundryDerivativeRightsRegistryAttestationsV1)
          .where(
            and(
              eq(
                foundryDerivativeRightsRegistryAttestationsV1.attestedByUserId,
                actorUserId,
              ),
              eq(
                foundryDerivativeRightsRegistryAttestationsV1.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (row === undefined) {
          throw new FoundryDerivativeExecutionCandidateIntegrityError(
            "Registry attestation was not persisted.",
          );
        }
        return serializeAttestation(row);
      });
    } catch (error: unknown) {
      rethrowDatabaseError(
        error,
        "The derivative approval, accepted review, or idempotency key was concurrently attested.",
      );
    }
  }

  async revokeRegistryAttestation(
    input: FoundryDerivativeRegistryAttestationRevocationCommand,
    actorUserIdInput: string,
  ): Promise<FoundryDerivativeRightsRegistryAttestationRevocationV1> {
    const revocation =
      FoundryDerivativeRightsRegistryAttestationRevocationInputV1Schema.parse({
        attestationId: input.attestationId,
        registryAttestationSha256: input.registryAttestationSha256,
        reason: input.reason,
      });
    const actorUserId = requireActorUserId(actorUserIdInput);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const request =
      FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1Schema.parse(
        {
          schemaVersion:
            FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_REQUEST_V1,
          ...revocation,
        },
      );
    const requestSha256 =
      computeFoundryDerivativeRightsRegistryAttestationRevocationRequestSha256(
        request,
      );
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
          ${`foundry-derivative-registry-revocation-idempotency-v1\u001f${actorUserId}\u001f${idempotencyKey}`}, 0
        ))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
          ${`foundry-derivative-registry-revocation-attestation-v1\u001f${revocation.attestationId}`}, 0
        ))`);
        const [idempotent] = await tx
          .select()
          .from(foundryDerivativeRightsRegistryAttestationRevocationsV1)
          .where(
            and(
              eq(
                foundryDerivativeRightsRegistryAttestationRevocationsV1.revokedByUserId,
                actorUserId,
              ),
              eq(
                foundryDerivativeRightsRegistryAttestationRevocationsV1.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (idempotent !== undefined) {
          return assertSameRevocationRequest(idempotent, requestSha256);
        }
        await tx.execute(sql`
          INSERT INTO "foundry_derivative_rights_registry_attestation_revocations_v1" (
            "attestation_id", "registry_attestation_sha256", "reason",
            "revocation_request_sha256", "revocation_request_json",
            "revoked_by_user_id", "idempotency_key"
          ) VALUES (
            ${revocation.attestationId}::uuid,
            ${revocation.registryAttestationSha256}, ${revocation.reason},
            ${requestSha256}, ${JSON.stringify(request)}::jsonb,
            ${actorUserId}::uuid, ${idempotencyKey}
          )
        `);
        const [row] = await tx
          .select()
          .from(foundryDerivativeRightsRegistryAttestationRevocationsV1)
          .where(
            and(
              eq(
                foundryDerivativeRightsRegistryAttestationRevocationsV1.revokedByUserId,
                actorUserId,
              ),
              eq(
                foundryDerivativeRightsRegistryAttestationRevocationsV1.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (row === undefined) {
          throw new FoundryDerivativeExecutionCandidateIntegrityError(
            "Registry attestation revocation was not persisted.",
          );
        }
        return serializeRevocation(row);
      });
    } catch (error: unknown) {
      rethrowDatabaseError(
        error,
        "The registry attestation or idempotency key was concurrently revoked.",
      );
    }
  }

  async reserveAuthorizationCandidate(
    input: FoundryDerivativeExecutionCandidateReservationCommand,
    actorUserIdInput: string,
  ): Promise<FoundryDerivativeExecutionAuthorizationCandidateV1> {
    const reservation =
      FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1Schema.parse(
        {
          baseExecutionSubjectSha256: input.baseExecutionSubjectSha256,
          projectId: input.projectId,
          jobId: input.jobId,
          jobSpecSha256: input.jobSpecSha256,
          executionEnvelopeSha256: input.executionEnvelopeSha256,
          ingestManifestSha256: input.ingestManifestSha256,
          jobSubjectSha256: input.jobSubjectSha256,
          registryAttestationSha256: input.registryAttestationSha256,
          bindingSetSha256: input.bindingSetSha256,
          restrictionLineageSetSha256: input.restrictionLineageSetSha256,
          outputPolicySha256: input.outputPolicySha256,
        },
      );
    const base = computeBaseExecutionSubjectSha256(input.baseExecutionSubject);
    if (base.sha256 !== reservation.baseExecutionSubjectSha256) {
      throw new FoundryDerivativeExecutionCandidateIntegrityError(
        "The base execution subject does not reproduce baseExecutionSubjectSha256.",
      );
    }
    const actorUserId = requireActorUserId(actorUserIdInput);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const request =
      FoundryDerivativeExecutionAuthorizationCandidateReservationRequestMaterialV1Schema.parse(
        {
          schemaVersion:
            FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
          ...reservation,
        },
      );
    const requestSha256 =
      computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256(
        request,
      );
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
          ${`foundry-derivative-candidate-idempotency-v1\u001f${actorUserId}\u001f${idempotencyKey}`}, 0
        ))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
          ${`foundry-derivative-candidate-subject-v1\u001f${base.sha256}`}, 0
        ))`);
        const [idempotent] = await tx
          .select()
          .from(foundryDerivativeExecutionAuthorizationCandidatesV1)
          .where(
            and(
              eq(
                foundryDerivativeExecutionAuthorizationCandidatesV1.reservedByUserId,
                actorUserId,
              ),
              eq(
                foundryDerivativeExecutionAuthorizationCandidatesV1.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (idempotent !== undefined) {
          return assertSameCandidateRequest(idempotent, requestSha256);
        }
        const [attestationRow] = await tx
          .select()
          .from(foundryDerivativeRightsRegistryAttestationsV1)
          .where(
            eq(
              foundryDerivativeRightsRegistryAttestationsV1.registryAttestationSha256,
              reservation.registryAttestationSha256,
            ),
          )
          .limit(1);
        if (attestationRow === undefined) {
          throw new FoundryDerivativeExecutionCandidateNotFoundError(
            "Exact registry attestation not found.",
          );
        }
        serializeAttestation(attestationRow);
        await tx.execute(sql`
          INSERT INTO "foundry_derivative_execution_authorization_candidates_v1" (
            "authority", "execution_eligible", "dispatch_enabled",
            "output_disposition", "approval_id",
            "derivative_rights_approval_sha256", "review_id",
            "review_receipt_sha256", "attestation_id",
            "registry_attestation_sha256", "base_execution_subject_sha256",
            "base_execution_subject_json", "job_id",
            "reservation_request_sha256", "reservation_request_json",
            "reserved_by_user_id", "idempotency_key"
          ) VALUES (
            'none', false, false, 'quarantine_only',
            ${attestationRow.approvalId},
            ${attestationRow.derivativeRightsApprovalSha256},
            ${attestationRow.reviewId}::uuid,
            ${attestationRow.reviewReceiptSha256}, ${attestationRow.id}::uuid,
            ${attestationRow.registryAttestationSha256}, ${base.sha256},
            ${JSON.stringify(base.subject)}::jsonb, ${reservation.jobId},
            ${requestSha256}, ${JSON.stringify(request)}::jsonb,
            ${actorUserId}::uuid, ${idempotencyKey}
          )
        `);
        const [row] = await tx
          .select()
          .from(foundryDerivativeExecutionAuthorizationCandidatesV1)
          .where(
            and(
              eq(
                foundryDerivativeExecutionAuthorizationCandidatesV1.reservedByUserId,
                actorUserId,
              ),
              eq(
                foundryDerivativeExecutionAuthorizationCandidatesV1.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (row === undefined) {
          throw new FoundryDerivativeExecutionCandidateIntegrityError(
            "Authority-none derivative candidate was not persisted.",
          );
        }
        return serializeCandidate(row);
      });
    } catch (error: unknown) {
      rethrowDatabaseError(
        error,
        "The accepted review, registry attestation, base subject, or idempotency key was concurrently reserved.",
      );
    }
  }
}

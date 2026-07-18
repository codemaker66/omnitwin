import { createHash } from "node:crypto";
import {
  FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_REGISTRATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_MAX_INLINE_BYTES_V1,
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_STORAGE_MODE_V1,
  FoundryDerivativeRightsCanonicalUuidV1Schema,
  FoundryDerivativeRightsRegistryAttestationReviewInputV1Schema,
  FoundryDerivativeRightsRegistryAttestationReviewReceiptV1Schema,
  FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1Schema,
  FoundryDerivativeTermsEvidenceCustodyReceiptV1Schema,
  FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1Schema,
  FoundryDerivativeTermsEvidenceCustodyRegistrationRequestMaterialV1Schema,
  computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256,
  computeFoundryDerivativeTermsEvidenceCustodyRegistrationRequestSha256,
  type FoundryDerivativeRightsRegistryAttestationReviewReceiptV1,
  type FoundryDerivativeRightsRegistryAttestationReviewInputV1,
  type FoundryDerivativeTermsEvidenceCustodyReceiptV1,
  type FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1,
} from "@omnitwin/types";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  foundryDerivativeRightsApprovals,
  foundryDerivativeRightsPolicyRevocations,
  foundryDerivativeRightsReviewsV1,
  foundryDerivativeTermsEvidenceCustodyV1,
} from "../db/schema.js";

export const MAX_FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_BYTES =
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_MAX_INLINE_BYTES_V1;

type CustodyRow = typeof foundryDerivativeTermsEvidenceCustodyV1.$inferSelect;
type ReviewRow = typeof foundryDerivativeRightsReviewsV1.$inferSelect;

export interface FoundryDerivativeRightsCustodyRegistrationCommand extends FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1 {
  readonly bytes: Uint8Array;
  readonly idempotencyKey: string;
}

export interface FoundryDerivativeRightsReviewCommand extends FoundryDerivativeRightsRegistryAttestationReviewInputV1 {
  readonly idempotencyKey: string;
}

export interface FoundryDerivativeRightsCustodiedBytes {
  readonly receipt: FoundryDerivativeTermsEvidenceCustodyReceiptV1;
  readonly bytes: Uint8Array;
}

export interface FoundryDerivativeRightsCustodyServiceApi {
  registerTermsEvidence(
    input: FoundryDerivativeRightsCustodyRegistrationCommand,
    actorUserId: string,
  ): Promise<FoundryDerivativeTermsEvidenceCustodyReceiptV1>;
  getTermsEvidence(
    custodyId: string,
  ): Promise<FoundryDerivativeRightsCustodiedBytes>;
  reviewForRegistryAttestation(
    input: FoundryDerivativeRightsReviewCommand,
    actorUserId: string,
  ): Promise<FoundryDerivativeRightsRegistryAttestationReviewReceiptV1>;
}

export class FoundryDerivativeRightsCustodyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundryDerivativeRightsCustodyNotFoundError";
  }
}

export class FoundryDerivativeRightsCustodyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundryDerivativeRightsCustodyConflictError";
  }
}

export class FoundryDerivativeRightsCustodyIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundryDerivativeRightsCustodyIntegrityError";
  }
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function runtimeValueEquals(actual: unknown, expected: unknown): boolean {
  return actual === expected;
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

function rethrowCustodyDatabaseError(
  error: unknown,
  uniqueConflictMessage: string,
): never {
  if (
    error instanceof FoundryDerivativeRightsCustodyNotFoundError ||
    error instanceof FoundryDerivativeRightsCustodyConflictError ||
    error instanceof FoundryDerivativeRightsCustodyIntegrityError
  ) {
    throw error;
  }
  const code = postgresErrorCode(error);
  if (code === "23505") {
    throw new FoundryDerivativeRightsCustodyConflictError(
      uniqueConflictMessage,
    );
  }
  if (code === "23503" || code === "23514" || code === "42501") {
    throw new FoundryDerivativeRightsCustodyIntegrityError(
      "PostgreSQL rejected derivative-rights custody state that was no longer current or exact.",
    );
  }
  throw error;
}

function requireActorUserId(value: string): string {
  if (!FoundryDerivativeRightsCanonicalUuidV1Schema.safeParse(value).success) {
    throw new FoundryDerivativeRightsCustodyIntegrityError(
      "Authenticated actor identity is invalid.",
    );
  }
  return value;
}

function requireIdempotencyKey(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(value)) {
    throw new FoundryDerivativeRightsCustodyIntegrityError(
      "Idempotency key is invalid.",
    );
  }
  return value;
}

function databaseRows(result: unknown): readonly Record<string, unknown>[] {
  if (
    typeof result !== "object" ||
    result === null ||
    !("rows" in result) ||
    !Array.isArray((result as { rows?: unknown }).rows)
  ) {
    throw new FoundryDerivativeRightsCustodyIntegrityError(
      "PostgreSQL returned an invalid result shape.",
    );
  }
  const rows = (result as { rows: unknown[] }).rows;
  if (
    !rows.every(
      (row) => typeof row === "object" && row !== null && !Array.isArray(row),
    )
  ) {
    throw new FoundryDerivativeRightsCustodyIntegrityError(
      "PostgreSQL returned a malformed row.",
    );
  }
  return rows as readonly Record<string, unknown>[];
}

function requireDatabaseTime(result: unknown): Date {
  const rows = databaseRows(result);
  if (rows.length !== 1) {
    throw new FoundryDerivativeRightsCustodyIntegrityError(
      "PostgreSQL did not return one custody timestamp.",
    );
  }
  const raw = rows[0]?.["recorded_at"];
  const value =
    raw instanceof Date
      ? new Date(raw.getTime())
      : typeof raw === "string"
        ? new Date(raw)
        : null;
  if (value === null || !Number.isFinite(value.getTime())) {
    throw new FoundryDerivativeRightsCustodyIntegrityError(
      "PostgreSQL returned an invalid custody timestamp.",
    );
  }
  return value;
}

function serializeCustody(
  row: CustodyRow,
): FoundryDerivativeTermsEvidenceCustodyReceiptV1 {
  const request =
    FoundryDerivativeTermsEvidenceCustodyRegistrationRequestMaterialV1Schema.parse(
      row.custodyRequestJson,
    );
  const receipt = FoundryDerivativeTermsEvidenceCustodyReceiptV1Schema.parse({
    ...row.custodyReceiptJson,
    custodyReceiptSha256: row.custodyReceiptSha256,
  });
  const contentSha256 = sha256(Buffer.from(row.evidenceBytes));
  if (
    computeFoundryDerivativeTermsEvidenceCustodyRegistrationRequestSha256(
      request,
    ) !== row.custodyRequestSha256 ||
    receipt.registrationRequestSha256 !== row.custodyRequestSha256 ||
    receipt.custodyId !== row.id ||
    receipt.artifactId !== row.artifactId ||
    receipt.mediaType !== row.mediaType ||
    receipt.contentSha256 !== row.sha256 ||
    receipt.sizeBytes !== row.sizeBytes ||
    receipt.registeredByUserId !== row.registeredByUserId ||
    receipt.capturedAt !== row.capturedAt.toISOString() ||
    receipt.verifiedAt !== row.recordedAt.toISOString() ||
    row.capturedAt.getTime() !== row.recordedAt.getTime() ||
    row.evidenceBytes.byteLength !== row.sizeBytes ||
    contentSha256 !== row.sha256 ||
    request.artifactId !== row.artifactId ||
    request.mediaType !== row.mediaType ||
    request.contentSha256 !== row.sha256 ||
    request.sizeBytes !== row.sizeBytes ||
    !runtimeValueEquals(row.storageMode, "postgres_inline_bytea_v1") ||
    !runtimeValueEquals(row.authority, "none") ||
    !runtimeValueEquals(row.executionEligible, false)
  ) {
    throw new FoundryDerivativeRightsCustodyIntegrityError(
      "Custodied terms-evidence row does not match its canonical request and receipt.",
    );
  }
  return receipt;
}

function serializeReview(
  row: ReviewRow,
): FoundryDerivativeRightsRegistryAttestationReviewReceiptV1 {
  const request =
    FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1Schema.parse(
      row.reviewRequestJson,
    );
  const receipt =
    FoundryDerivativeRightsRegistryAttestationReviewReceiptV1Schema.parse({
      ...row.reviewReceiptJson,
      reviewReceiptSha256: row.reviewReceiptSha256,
    });
  if (
    computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256(
      request,
    ) !== row.reviewRequestSha256 ||
    receipt.reviewRequestSha256 !== row.reviewRequestSha256 ||
    receipt.reviewId !== row.id ||
    receipt.approvalId !== row.approvalId ||
    receipt.derivativeRightsApprovalSha256 !==
      row.derivativeRightsApprovalSha256 ||
    receipt.custodyId !== row.termsCustodyId ||
    receipt.custodyReceiptSha256 !== row.termsCustodyReceiptSha256 ||
    receipt.decision !== row.decision ||
    receipt.rationale !== row.rationale ||
    receipt.reviewedByUserId !== row.reviewedByUserId ||
    receipt.reviewedAt !== row.reviewedAt.toISOString() ||
    row.reviewedAt.getTime() !== row.recordedAt.getTime() ||
    request.approvalId !== row.approvalId ||
    request.derivativeRightsApprovalSha256 !==
      row.derivativeRightsApprovalSha256 ||
    request.custodyId !== row.termsCustodyId ||
    request.custodyReceiptSha256 !== row.termsCustodyReceiptSha256 ||
    request.decision !== row.decision ||
    request.rationale !== row.rationale ||
    !runtimeValueEquals(row.authority, "none") ||
    !runtimeValueEquals(row.executionEligible, false)
  ) {
    throw new FoundryDerivativeRightsCustodyIntegrityError(
      "Derivative-rights review row does not match its canonical request and receipt.",
    );
  }
  return receipt;
}

function assertSameCustodyRequest(
  row: CustodyRow,
  requestSha256: string,
): FoundryDerivativeTermsEvidenceCustodyReceiptV1 {
  if (row.custodyRequestSha256 !== requestSha256) {
    throw new FoundryDerivativeRightsCustodyConflictError(
      "The idempotency key was already used for different evidence bytes or metadata.",
    );
  }
  return serializeCustody(row);
}

function assertSameReviewRequest(
  row: ReviewRow,
  requestSha256: string,
): FoundryDerivativeRightsRegistryAttestationReviewReceiptV1 {
  if (row.reviewRequestSha256 !== requestSha256) {
    throw new FoundryDerivativeRightsCustodyConflictError(
      "The idempotency key was already used for a different derivative-rights review.",
    );
  }
  return serializeReview(row);
}

export class FoundryDerivativeRightsCustodyService implements FoundryDerivativeRightsCustodyServiceApi {
  constructor(private readonly db: Database) {}

  async registerTermsEvidence(
    input: FoundryDerivativeRightsCustodyRegistrationCommand,
    actorUserIdInput: string,
  ): Promise<FoundryDerivativeTermsEvidenceCustodyReceiptV1> {
    const registration =
      FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1Schema.parse({
        artifactId: input.artifactId,
        mediaType: input.mediaType,
      });
    const actorUserId = requireActorUserId(actorUserIdInput);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const bytes = Buffer.from(input.bytes);
    if (
      bytes.byteLength < 1 ||
      bytes.byteLength > MAX_FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_BYTES
    ) {
      throw new FoundryDerivativeRightsCustodyIntegrityError(
        "Terms evidence must contain between 1 byte and 4 MiB.",
      );
    }
    const contentSha256 = sha256(bytes);
    const requestMaterial =
      FoundryDerivativeTermsEvidenceCustodyRegistrationRequestMaterialV1Schema.parse(
        {
          schemaVersion:
            FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_REGISTRATION_REQUEST_V1,
          artifactId: registration.artifactId,
          mediaType: registration.mediaType,
          contentSha256,
          sizeBytes: bytes.byteLength,
        },
      );
    const requestSha256 =
      computeFoundryDerivativeTermsEvidenceCustodyRegistrationRequestSha256(
        requestMaterial,
      );

    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`foundry-derivative-custody-idempotency-v1\u001f${actorUserId}\u001f${idempotencyKey}`}, 0
      ))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`foundry-derivative-custody-artifact-v1\u001f${registration.artifactId}`}, 0
      ))`);

        const [idempotent] = await tx
          .select()
          .from(foundryDerivativeTermsEvidenceCustodyV1)
          .where(
            and(
              eq(
                foundryDerivativeTermsEvidenceCustodyV1.registeredByUserId,
                actorUserId,
              ),
              eq(
                foundryDerivativeTermsEvidenceCustodyV1.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (idempotent !== undefined)
          return assertSameCustodyRequest(idempotent, requestSha256);

        const [existingArtifact] = await tx
          .select()
          .from(foundryDerivativeTermsEvidenceCustodyV1)
          .where(
            eq(
              foundryDerivativeTermsEvidenceCustodyV1.artifactId,
              registration.artifactId,
            ),
          )
          .limit(1);
        if (existingArtifact !== undefined) {
          throw new FoundryDerivativeRightsCustodyConflictError(
            "The evidence artifact ID is already registered and cannot be rebound.",
          );
        }

        await tx.execute(sql`
        INSERT INTO "foundry_derivative_terms_evidence_custody_v1" (
          "authority", "execution_eligible", "artifact_id", "sha256",
          "size_bytes", "media_type", "evidence_bytes", "storage_mode",
          "custody_request_sha256", "custody_request_json",
          "registered_by_user_id", "idempotency_key"
        ) VALUES (
          'none', false, ${requestMaterial.artifactId},
          ${requestMaterial.contentSha256}, ${requestMaterial.sizeBytes},
          ${requestMaterial.mediaType}, ${bytes},
          ${FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_STORAGE_MODE_V1},
          ${requestSha256}, ${JSON.stringify(requestMaterial)}::jsonb,
          ${actorUserId}::uuid, ${idempotencyKey}
        )
      `);
        const [row] = await tx
          .select()
          .from(foundryDerivativeTermsEvidenceCustodyV1)
          .where(
            and(
              eq(
                foundryDerivativeTermsEvidenceCustodyV1.registeredByUserId,
                actorUserId,
              ),
              eq(
                foundryDerivativeTermsEvidenceCustodyV1.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (row === undefined) {
          throw new FoundryDerivativeRightsCustodyIntegrityError(
            "Terms-evidence custody receipt was not persisted.",
          );
        }
        return serializeCustody(row);
      });
    } catch (error: unknown) {
      rethrowCustodyDatabaseError(
        error,
        "The evidence artifact or idempotency key was concurrently registered.",
      );
    }
  }

  async getTermsEvidence(
    custodyId: string,
  ): Promise<FoundryDerivativeRightsCustodiedBytes> {
    if (
      !FoundryDerivativeRightsCanonicalUuidV1Schema.safeParse(custodyId).success
    ) {
      throw new FoundryDerivativeRightsCustodyNotFoundError(
        "Terms-evidence custody record not found.",
      );
    }
    const [row] = await this.db
      .select()
      .from(foundryDerivativeTermsEvidenceCustodyV1)
      .where(eq(foundryDerivativeTermsEvidenceCustodyV1.id, custodyId))
      .limit(1);
    if (row === undefined) {
      throw new FoundryDerivativeRightsCustodyNotFoundError(
        "Terms-evidence custody record not found.",
      );
    }
    const bytes = Buffer.from(row.evidenceBytes);
    if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) {
      throw new FoundryDerivativeRightsCustodyIntegrityError(
        "Custodied terms-evidence bytes no longer match their immutable receipt.",
      );
    }
    const receipt = serializeCustody(row);
    if (
      receipt.contentSha256 !== row.sha256 ||
      receipt.sizeBytes !== row.sizeBytes ||
      receipt.artifactId !== row.artifactId
    ) {
      throw new FoundryDerivativeRightsCustodyIntegrityError(
        "Custodied terms-evidence metadata no longer matches its immutable receipt.",
      );
    }
    return { receipt, bytes };
  }

  async reviewForRegistryAttestation(
    input: FoundryDerivativeRightsReviewCommand,
    actorUserIdInput: string,
  ): Promise<FoundryDerivativeRightsRegistryAttestationReviewReceiptV1> {
    const reviewInput =
      FoundryDerivativeRightsRegistryAttestationReviewInputV1Schema.parse({
        approvalId: input.approvalId,
        custodyId: input.custodyId,
        custodyReceiptSha256: input.custodyReceiptSha256,
        decision: input.decision,
        rationale: input.rationale,
      });
    const actorUserId = requireActorUserId(actorUserIdInput);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);

    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`foundry-derivative-review-idempotency-v1\u001f${actorUserId}\u001f${idempotencyKey}`}, 0
      ))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`foundry-derivative-review-approval-v1\u001f${reviewInput.approvalId}`}, 0
      ))`);

        const [approval] = await tx
          .select()
          .from(foundryDerivativeRightsApprovals)
          .where(
            eq(
              foundryDerivativeRightsApprovals.approvalId,
              reviewInput.approvalId,
            ),
          )
          .limit(1);
        if (approval === undefined) {
          throw new FoundryDerivativeRightsCustodyNotFoundError(
            "Derivative-rights approval not found.",
          );
        }
        const requestMaterial =
          FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1Schema.parse(
            {
              schemaVersion:
                FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
              ...reviewInput,
              derivativeRightsApprovalSha256:
                approval.derivativeRightsApprovalSha256,
            },
          );
        const requestSha256 =
          computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256(
            requestMaterial,
          );

        const [idempotent] = await tx
          .select()
          .from(foundryDerivativeRightsReviewsV1)
          .where(
            and(
              eq(
                foundryDerivativeRightsReviewsV1.reviewedByUserId,
                actorUserId,
              ),
              eq(
                foundryDerivativeRightsReviewsV1.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (idempotent !== undefined) {
          return assertSameReviewRequest(idempotent, requestSha256);
        }

        const [existingReview] = await tx
          .select()
          .from(foundryDerivativeRightsReviewsV1)
          .where(
            eq(
              foundryDerivativeRightsReviewsV1.approvalId,
              requestMaterial.approvalId,
            ),
          )
          .limit(1);
        if (existingReview !== undefined) {
          throw new FoundryDerivativeRightsCustodyConflictError(
            "The derivative-rights approval already has an immutable review receipt.",
          );
        }
        const [custody] = await tx
          .select()
          .from(foundryDerivativeTermsEvidenceCustodyV1)
          .where(
            and(
              eq(
                foundryDerivativeTermsEvidenceCustodyV1.id,
                requestMaterial.custodyId,
              ),
              eq(
                foundryDerivativeTermsEvidenceCustodyV1.custodyReceiptSha256,
                requestMaterial.custodyReceiptSha256,
              ),
            ),
          )
          .limit(1);
        if (custody === undefined) {
          throw new FoundryDerivativeRightsCustodyNotFoundError(
            "Exact terms-evidence custody receipt not found.",
          );
        }
        if (
          custody.artifactId !== approval.termsEvidenceArtifactId ||
          custody.sha256 !== approval.termsEvidenceSha256 ||
          custody.sizeBytes !== Number(approval.termsEvidenceSizeBytes) ||
          custody.mediaType !== approval.termsEvidenceMediaType ||
          custody.capturedAt.getTime() !==
            approval.termsEvidenceCapturedAt.getTime()
        ) {
          throw new FoundryDerivativeRightsCustodyConflictError(
            "The custody receipt does not bind the exact terms-evidence metadata in the approval.",
          );
        }

        const reviewedAt = requireDatabaseTime(
          await tx.execute(sql`
        SELECT date_trunc('milliseconds', clock_timestamp()) AS "recorded_at"
      `),
        );
        if (
          requestMaterial.decision ===
          FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION
        ) {
          if (approval.expiresAt.getTime() <= reviewedAt.getTime()) {
            throw new FoundryDerivativeRightsCustodyConflictError(
              "An expired derivative-rights approval cannot be accepted for registry attestation.",
            );
          }
          const [effectiveRevocation] = await tx
            .select({ id: foundryDerivativeRightsPolicyRevocations.id })
            .from(foundryDerivativeRightsPolicyRevocations)
            .where(
              and(
                eq(
                  foundryDerivativeRightsPolicyRevocations.policyVersion,
                  approval.policyVersion,
                ),
                eq(
                  foundryDerivativeRightsPolicyRevocations.policyDefinitionSha256,
                  approval.policyDefinitionSha256,
                ),
                eq(
                  foundryDerivativeRightsPolicyRevocations.policyGeneration,
                  approval.policyGeneration,
                ),
                sql`${foundryDerivativeRightsPolicyRevocations.revokedAt} <= ${reviewedAt}`,
              ),
            )
            .limit(1);
          if (effectiveRevocation !== undefined) {
            throw new FoundryDerivativeRightsCustodyConflictError(
              "A revoked derivative-rights policy cannot be accepted for registry attestation.",
            );
          }
        }

        await tx.execute(sql`
        INSERT INTO "foundry_derivative_rights_reviews_v1" (
          "authority", "execution_eligible", "approval_id",
          "derivative_rights_approval_sha256", "terms_custody_id",
          "terms_custody_receipt_sha256", "decision", "rationale",
          "review_request_sha256", "review_request_json",
          "reviewed_by_user_id", "idempotency_key"
        ) VALUES (
          'none', false, ${requestMaterial.approvalId},
          ${requestMaterial.derivativeRightsApprovalSha256},
          ${requestMaterial.custodyId}::uuid,
          ${requestMaterial.custodyReceiptSha256}, ${requestMaterial.decision},
          ${requestMaterial.rationale}, ${requestSha256},
          ${JSON.stringify(requestMaterial)}::jsonb,
          ${actorUserId}::uuid, ${idempotencyKey}
        )
      `);
        const [row] = await tx
          .select()
          .from(foundryDerivativeRightsReviewsV1)
          .where(
            and(
              eq(
                foundryDerivativeRightsReviewsV1.reviewedByUserId,
                actorUserId,
              ),
              eq(
                foundryDerivativeRightsReviewsV1.idempotencyKey,
                idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (row === undefined) {
          throw new FoundryDerivativeRightsCustodyIntegrityError(
            "Derivative-rights review receipt was not persisted.",
          );
        }
        return serializeReview(row);
      });
    } catch (error: unknown) {
      rethrowCustodyDatabaseError(
        error,
        "The derivative-rights approval or idempotency key was concurrently reviewed.",
      );
    }
  }
}

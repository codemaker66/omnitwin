import { createHash } from "node:crypto";
import {
  FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_RECEIPT_V1,
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_REGISTRATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_STORAGE_MODE_V1,
  computeFoundryDerivativeRightsRegistryAttestationReviewReceiptSha256,
  computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256,
  computeFoundryDerivativeTermsEvidenceCustodyReceiptSha256,
  computeFoundryDerivativeTermsEvidenceCustodyRegistrationRequestSha256,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import type { Database } from "../../db/client.js";
import {
  foundryDerivativeRightsReviewsV1,
  foundryDerivativeTermsEvidenceCustodyV1,
} from "../../db/schema.js";
import {
  FoundryDerivativeRightsCustodyConflictError,
  FoundryDerivativeRightsCustodyIntegrityError,
  FoundryDerivativeRightsCustodyService,
} from "../../services/foundry-derivative-rights-custody.js";

const ACTOR_ID = "10000000-0000-4000-8000-000000000004";
const CUSTODY_ID = "10000000-0000-4000-8000-000000000005";
const REVIEW_ID = "10000000-0000-4000-8000-000000000006";
const ARTIFACT_ID = "terms-evidence-1";
const APPROVAL_ID = "approval-1";
const MEDIA_TYPE = "text/plain";
const CAPTURED_AT = new Date("2026-07-14T12:00:00.000Z");
const REVIEWED_AT = new Date("2026-07-14T12:01:00.000Z");
const EVIDENCE_BYTES = Buffer.from("Exact licence terms evidence.", "utf8");

type CustodyRow = typeof foundryDerivativeTermsEvidenceCustodyV1.$inferSelect;
type ReviewRow = typeof foundryDerivativeRightsReviewsV1.$inferSelect;

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function custodyFixture(bytes: Uint8Array = EVIDENCE_BYTES) {
  const evidenceBytes = Buffer.from(bytes);
  const contentSha256 = sha256(evidenceBytes);
  const requestMaterial = {
    schemaVersion:
      FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_REGISTRATION_REQUEST_V1,
    artifactId: ARTIFACT_ID,
    mediaType: MEDIA_TYPE,
    contentSha256,
    sizeBytes: evidenceBytes.byteLength,
  } as const;
  const registrationRequestSha256 =
    computeFoundryDerivativeTermsEvidenceCustodyRegistrationRequestSha256(
      requestMaterial,
    );
  const receiptMaterial = {
    schemaVersion: FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_RECEIPT_V1,
    custodyId: CUSTODY_ID,
    registrationRequestSha256,
    artifactId: ARTIFACT_ID,
    mediaType: MEDIA_TYPE,
    contentSha256,
    sizeBytes: evidenceBytes.byteLength,
    storageMode: FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_STORAGE_MODE_V1,
    capturedAt: CAPTURED_AT.toISOString(),
    registeredByUserId: ACTOR_ID,
    verifiedAt: CAPTURED_AT.toISOString(),
    authority: "none",
    executionEligible: false,
  } as const;
  const custodyReceiptSha256 =
    computeFoundryDerivativeTermsEvidenceCustodyReceiptSha256(receiptMaterial);
  const row: CustodyRow = {
    id: CUSTODY_ID,
    authority: "none",
    executionEligible: false,
    artifactId: ARTIFACT_ID,
    sha256: contentSha256,
    sizeBytes: evidenceBytes.byteLength,
    mediaType: MEDIA_TYPE,
    evidenceBytes,
    capturedAt: new Date(CAPTURED_AT),
    storageMode: FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_STORAGE_MODE_V1,
    custodyRequestSha256: registrationRequestSha256,
    custodyRequestJson: requestMaterial,
    custodyReceiptSha256,
    custodyReceiptJson: receiptMaterial,
    registeredByUserId: ACTOR_ID,
    idempotencyKey: "custody-1",
    recordedAt: new Date(CAPTURED_AT),
  };
  return {
    row,
    receipt: { ...receiptMaterial, custodyReceiptSha256 },
  };
}

function reviewFixture(custody: ReturnType<typeof custodyFixture>) {
  const derivativeRightsApprovalSha256 = sha256("approval-payload");
  const policyDefinitionSha256 = sha256("policy-definition");
  const rationale = "Exact evidence bytes and approval metadata reviewed.";
  const requestMaterial = {
    schemaVersion:
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
    approvalId: APPROVAL_ID,
    derivativeRightsApprovalSha256,
    custodyId: CUSTODY_ID,
    custodyReceiptSha256: custody.row.custodyReceiptSha256,
    decision: FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
    rationale,
  } as const;
  const reviewRequestSha256 =
    computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256(
      requestMaterial,
    );
  const receiptMaterial = {
    schemaVersion:
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
    reviewId: REVIEW_ID,
    reviewRequestSha256,
    approvalId: APPROVAL_ID,
    derivativeRightsApprovalSha256,
    custodyId: CUSTODY_ID,
    custodyReceiptSha256: custody.row.custodyReceiptSha256,
    decision: FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
    rationale,
    reviewedByUserId: ACTOR_ID,
    reviewedAt: REVIEWED_AT.toISOString(),
    authority: "none",
    executionEligible: false,
  } as const;
  const reviewReceiptSha256 =
    computeFoundryDerivativeRightsRegistryAttestationReviewReceiptSha256(
      receiptMaterial,
    );
  const row: ReviewRow = {
    id: REVIEW_ID,
    authority: "none",
    executionEligible: false,
    approvalId: APPROVAL_ID,
    derivativeRightsApprovalSha256,
    termsCustodyId: CUSTODY_ID,
    termsCustodyReceiptSha256: custody.row.custodyReceiptSha256,
    decision: FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
    rationale,
    reviewRequestSha256,
    reviewRequestJson: requestMaterial,
    reviewReceiptSha256,
    reviewReceiptJson: receiptMaterial,
    reviewedByUserId: ACTOR_ID,
    idempotencyKey: "review-1",
    reviewedAt: new Date(REVIEWED_AT),
    recordedAt: new Date(REVIEWED_AT),
  };
  const approval = {
    approvalId: APPROVAL_ID,
    derivativeRightsApprovalSha256,
    termsEvidenceArtifactId: custody.row.artifactId,
    termsEvidenceSha256: custody.row.sha256,
    termsEvidenceSizeBytes: BigInt(custody.row.sizeBytes),
    termsEvidenceMediaType: custody.row.mediaType,
    termsEvidenceCapturedAt: new Date(custody.row.capturedAt),
    policyVersion: "policy-v1",
    policyDefinitionSha256,
    policyGeneration: 1n,
    expiresAt: new Date("2026-07-15T00:00:00.000Z"),
  };
  return {
    approval,
    row,
    input: {
      approvalId: APPROVAL_ID,
      custodyId: CUSTODY_ID,
      custodyReceiptSha256: custody.row.custodyReceiptSha256,
      decision: FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
      rationale,
      idempotencyKey: "review-1",
    } as const,
    receipt: { ...receiptMaterial, reviewReceiptSha256 },
  };
}

interface FakeDatabaseState {
  readonly executeCalls: unknown[];
  selectCount: number;
}

interface FakeDatabase {
  select(projection?: unknown): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(limit: number): Promise<readonly unknown[]>;
      };
    };
  };
  execute(query: unknown): Promise<unknown>;
  transaction<T>(callback: (tx: FakeDatabase) => Promise<T>): Promise<T>;
}

function fakeDatabase(options: {
  readonly selectResults: readonly (readonly unknown[])[];
  readonly executeResults?: readonly unknown[];
}): { readonly db: Database; readonly state: FakeDatabaseState } {
  const state: FakeDatabaseState = { executeCalls: [], selectCount: 0 };
  let executeIndex = 0;
  const db: FakeDatabase = {
    select: (_projection?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_condition: unknown) => ({
          limit: (_limit: number) => {
            const result = options.selectResults[state.selectCount];
            state.selectCount += 1;
            if (result === undefined) {
              return Promise.reject(
                new Error("Unexpected fake database select."),
              );
            }
            return Promise.resolve(result);
          },
        }),
      }),
    }),
    execute: (query: unknown) => {
      state.executeCalls.push(query);
      const result = options.executeResults?.[executeIndex];
      executeIndex += 1;
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result ?? { rows: [] });
    },
    transaction: <T>(callback: (tx: FakeDatabase) => Promise<T>) =>
      callback(db),
  };
  return { db: db as never as Database, state };
}

function sqlBoundStrings(query: unknown): readonly string[] {
  if (
    typeof query !== "object" ||
    query === null ||
    !("queryChunks" in query)
  ) {
    return [];
  }
  const chunks = (query as { queryChunks?: unknown }).queryChunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.filter((chunk): chunk is string => typeof chunk === "string");
}

describe("FoundryDerivativeRightsCustodyService", () => {
  it("registers bytes against the canonical row populated by database triggers", async () => {
    const fixture = custodyFixture();
    const { db, state } = fakeDatabase({
      selectResults: [[], [], [fixture.row]],
    });
    const service = new FoundryDerivativeRightsCustodyService(db);

    const receipt = await service.registerTermsEvidence(
      {
        artifactId: ARTIFACT_ID,
        mediaType: MEDIA_TYPE,
        bytes: EVIDENCE_BYTES,
        idempotencyKey: "custody-1",
      },
      ACTOR_ID,
    );

    expect(receipt).toEqual(fixture.receipt);
    expect(receipt).toMatchObject({
      authority: "none",
      executionEligible: false,
    });
    expect(state.selectCount).toBe(3);
    expect(state.executeCalls).toHaveLength(3);
  });

  it("rejects reuse of an idempotency key when the exact bytes changed", async () => {
    const fixture = custodyFixture();
    const { db, state } = fakeDatabase({ selectResults: [[fixture.row]] });
    const service = new FoundryDerivativeRightsCustodyService(db);

    await expect(
      service.registerTermsEvidence(
        {
          artifactId: ARTIFACT_ID,
          mediaType: MEDIA_TYPE,
          bytes: Buffer.from("Changed licence terms evidence.", "utf8"),
          idempotencyKey: "custody-1",
        },
        ACTOR_ID,
      ),
    ).rejects.toBeInstanceOf(FoundryDerivativeRightsCustodyConflictError);
    expect(state.selectCount).toBe(1);
    expect(state.executeCalls).toHaveLength(2);
  });

  it("maps a concurrent PostgreSQL uniqueness race to a custody conflict", async () => {
    const uniqueViolation = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });
    const { db } = fakeDatabase({
      selectResults: [[], []],
      executeResults: [undefined, undefined, uniqueViolation],
    });
    const service = new FoundryDerivativeRightsCustodyService(db);

    await expect(
      service.registerTermsEvidence(
        {
          artifactId: ARTIFACT_ID,
          mediaType: MEDIA_TYPE,
          bytes: EVIDENCE_BYTES,
          idempotencyKey: "custody-1",
        },
        ACTOR_ID,
      ),
    ).rejects.toBeInstanceOf(FoundryDerivativeRightsCustodyConflictError);
  });

  it("returns only the exact custodied bytes and canonical receipt", async () => {
    const fixture = custodyFixture();
    const { db } = fakeDatabase({ selectResults: [[fixture.row]] });
    const service = new FoundryDerivativeRightsCustodyService(db);

    const result = await service.getTermsEvidence(CUSTODY_ID);

    expect(result.bytes).toEqual(EVIDENCE_BYTES);
    expect(result.receipt).toEqual(fixture.receipt);
  });

  it("rejects read-side byte corruption even when the stored size is unchanged", async () => {
    const fixture = custodyFixture();
    const corruptedBytes = Buffer.from(fixture.row.evidenceBytes);
    corruptedBytes[0] = corruptedBytes[0]! ^ 0xff;
    const corruptedRow: CustodyRow = {
      ...fixture.row,
      evidenceBytes: corruptedBytes,
    };
    const { db } = fakeDatabase({ selectResults: [[corruptedRow]] });
    const service = new FoundryDerivativeRightsCustodyService(db);

    await expect(service.getTermsEvidence(CUSTODY_ID)).rejects.toBeInstanceOf(
      FoundryDerivativeRightsCustodyIntegrityError,
    );
  });

  it("binds an accepted review to the stored approval digest and authenticated actor", async () => {
    const custody = custodyFixture();
    const review = reviewFixture(custody);
    const { db, state } = fakeDatabase({
      selectResults: [
        [review.approval],
        [],
        [],
        [custody.row],
        [],
        [review.row],
      ],
      executeResults: [
        undefined,
        undefined,
        { rows: [{ recorded_at: new Date(REVIEWED_AT) }] },
        undefined,
      ],
    });
    const service = new FoundryDerivativeRightsCustodyService(db);

    const receipt = await service.reviewForRegistryAttestation(
      review.input,
      ACTOR_ID,
    );

    expect(receipt).toEqual(review.receipt);
    expect(receipt.derivativeRightsApprovalSha256).toBe(
      review.approval.derivativeRightsApprovalSha256,
    );
    expect(receipt.reviewedByUserId).toBe(ACTOR_ID);
    expect(state.selectCount).toBe(6);
    expect(state.executeCalls).toHaveLength(4);
    expect(sqlBoundStrings(state.executeCalls[3])).toContain(
      review.approval.derivativeRightsApprovalSha256,
    );
    expect(sqlBoundStrings(state.executeCalls[3])).toContain(ACTOR_ID);
  });
});

import { describe, expect, it } from "vitest";
import {
  FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
  FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_MAX_BYTES_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_RECEIPT_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_REGISTRATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_STORAGE_MODE_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
  FoundryDerivativeRightsCustodyReceiptV1Schema,
  FoundryDerivativeRightsCustodyRegistrationInputV1Schema,
  FoundryDerivativeRightsCustodyRegistrationRequestMaterialV1Schema,
  FoundryDerivativeRightsCustodyRegistrationResultV1Schema,
  FoundryDerivativeRightsRegistryAttestationReviewInputV1Schema,
  FoundryDerivativeRightsRegistryAttestationReviewReceiptV1Schema,
  FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1Schema,
  FoundryDerivativeRightsRegistryAttestationReviewResultV1Schema,
  computeFoundryDerivativeRightsCustodyReceiptSha256,
  computeFoundryDerivativeRightsCustodyRegistrationRequestSha256,
  computeFoundryDerivativeRightsRegistryAttestationReviewReceiptSha256,
  computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256,
  type FoundryDerivativeRightsCustodyReceiptMaterialV1,
  type FoundryDerivativeRightsCustodyRegistrationRequestMaterialV1,
  type FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1,
  type FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1,
} from "../omnitwin-foundry-derivative-rights-custody.js";
import { FoundryDerivativeRightsApprovalV0Schema } from "../omnitwin-foundry-derivative-rights.js";

const NOW = "2026-07-14T09:30:00.000Z";
const REGISTERED_BY_USER_ID = "018f3e5a-6e3b-4d10-a4f1-001122334455";
const REVIEWED_BY_USER_ID = "018f3e5a-6e3b-4d10-a4f1-112233445566";

function sha(value: number): string {
  return `sha256:${value.toString(16).padStart(64, "0")}`;
}

function custodyRequestMaterial(): FoundryDerivativeRightsCustodyRegistrationRequestMaterialV1 {
  return {
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_REGISTRATION_REQUEST_V1,
    artifactId: "grand-hall-vendor-terms",
    mediaType: "application/pdf",
    contentSha256: sha(1),
    sizeBytes: 2048,
  };
}

function custodyReceiptMaterial(): FoundryDerivativeRightsCustodyReceiptMaterialV1 {
  const request = custodyRequestMaterial();
  return {
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_RECEIPT_V1,
    custodyId: "018f3e5a-6e3b-7d10-a4f1-001122334455",
    registrationRequestSha256:
      computeFoundryDerivativeRightsCustodyRegistrationRequestSha256(request),
    artifactId: request.artifactId,
    mediaType: request.mediaType,
    contentSha256: request.contentSha256,
    sizeBytes: request.sizeBytes,
    storageMode: FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_STORAGE_MODE_V1,
    capturedAt: NOW,
    registeredByUserId: REGISTERED_BY_USER_ID,
    verifiedAt: NOW,
    authority: "none",
    executionEligible: false,
  };
}

function custodyReceipt() {
  const material = custodyReceiptMaterial();
  return {
    ...material,
    custodyReceiptSha256:
      computeFoundryDerivativeRightsCustodyReceiptSha256(material),
  };
}

function reviewRequestMaterial(): FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1 {
  return {
    schemaVersion:
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
    approvalId: "grand-hall-glb-normalization-approval",
    derivativeRightsApprovalSha256: sha(2),
    custodyId: custodyReceiptMaterial().custodyId,
    custodyReceiptSha256: custodyReceipt().custodyReceiptSha256,
    decision: FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
    rationale:
      "The exact terms-evidence bytes match the immutable approval evidence metadata.",
  };
}

function reviewReceiptMaterial(): FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1 {
  const request = reviewRequestMaterial();
  return {
    ...request,
    schemaVersion:
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
    reviewId: "018f3e5a-6e3b-7d10-a4f1-112233445566",
    reviewRequestSha256:
      computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256(
        request,
      ),
    reviewedByUserId: REVIEWED_BY_USER_ID,
    reviewedAt: NOW,
    authority: "none",
    executionEligible: false,
  };
}

function reviewReceipt() {
  const material = reviewReceiptMaterial();
  return {
    ...material,
    reviewReceiptSha256:
      computeFoundryDerivativeRightsRegistryAttestationReviewReceiptSha256(
        material,
      ),
  };
}

describe("OmniTwin Foundry derivative-rights custody V1", () => {
  it("separates caller upload metadata from server-derived byte claims", () => {
    expect(
      FoundryDerivativeRightsCustodyRegistrationInputV1Schema.parse({
        artifactId: "grand-hall-vendor-terms",
        mediaType: "application/pdf",
      }),
    ).toEqual({
      artifactId: "grand-hall-vendor-terms",
      mediaType: "application/pdf",
    });

    for (const callerClaim of [
      { contentSha256: sha(1) },
      { sizeBytes: 2048 },
      { sha256: sha(1) },
    ]) {
      expect(
        FoundryDerivativeRightsCustodyRegistrationInputV1Schema.safeParse({
          artifactId: "grand-hall-vendor-terms",
          mediaType: "application/pdf",
          ...callerClaim,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts strict server-derived registration material and hashes it canonically", () => {
    const material = custodyRequestMaterial();
    expect(
      FoundryDerivativeRightsCustodyRegistrationRequestMaterialV1Schema.parse(
        material,
      ),
    ).toEqual(material);

    const reordered = {
      sizeBytes: material.sizeBytes,
      contentSha256: material.contentSha256,
      mediaType: material.mediaType,
      artifactId: material.artifactId,
      schemaVersion: material.schemaVersion,
    };
    expect(
      computeFoundryDerivativeRightsCustodyRegistrationRequestSha256(reordered),
    ).toBe(
      computeFoundryDerivativeRightsCustodyRegistrationRequestSha256(material),
    );
  });

  it("rejects malformed or unbounded registration material", () => {
    const material = custodyRequestMaterial();
    for (const candidate of [
      { ...material, artifactId: "Grand Hall" },
      { ...material, contentSha256: sha(1).toUpperCase() },
      { ...material, sizeBytes: 0 },
      { ...material, sizeBytes: 1.5 },
      {
        ...material,
        sizeBytes: FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_MAX_BYTES_V1 + 1,
      },
      { ...material, unexpectedAuthority: "execute" },
      { ...material, mediaType: " application/pdf" },
      { ...material, mediaType: "application/pdf\u0000" },
      { ...material, mediaType: "application/pdf\ud800" },
    ]) {
      expect(
        FoundryDerivativeRightsCustodyRegistrationRequestMaterialV1Schema.safeParse(
          candidate,
        ).success,
      ).toBe(false);
    }
  });

  it("accepts both byte boundaries and rejects caller-supplied review authority", () => {
    const material = custodyRequestMaterial();
    expect(
      FoundryDerivativeRightsCustodyRegistrationRequestMaterialV1Schema.safeParse(
        {
          ...material,
          sizeBytes: 1,
        },
      ).success,
    ).toBe(true);
    expect(
      FoundryDerivativeRightsCustodyRegistrationRequestMaterialV1Schema.safeParse(
        {
          ...material,
          sizeBytes: FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_MAX_BYTES_V1,
        },
      ).success,
    ).toBe(true);

    const publicInput = {
      approvalId: reviewRequestMaterial().approvalId,
      custodyId: reviewRequestMaterial().custodyId,
      custodyReceiptSha256: reviewRequestMaterial().custodyReceiptSha256,
      decision: "rejected" as const,
      rationale: "The evidence did not satisfy the registry review.",
    };
    expect(
      FoundryDerivativeRightsRegistryAttestationReviewInputV1Schema.safeParse(
        publicInput,
      ).success,
    ).toBe(true);
    for (const smuggled of [
      { reviewedByUserId: REVIEWED_BY_USER_ID },
      { reviewedAt: NOW },
      { derivativeRightsApprovalSha256: sha(2) },
      { authority: "none" },
      { executionEligible: false },
    ]) {
      expect(
        FoundryDerivativeRightsRegistryAttestationReviewInputV1Schema.safeParse(
          {
            ...publicInput,
            ...smuggled,
          },
        ).success,
      ).toBe(false);
    }
  });

  it("changes registration identity for every byte-material field", () => {
    const material = custodyRequestMaterial();
    const digest =
      computeFoundryDerivativeRightsCustodyRegistrationRequestSha256(material);
    for (const changed of [
      { ...material, artifactId: "other-terms" },
      { ...material, mediaType: "text/html" },
      { ...material, contentSha256: sha(3) },
      { ...material, sizeBytes: material.sizeBytes + 1 },
    ]) {
      expect(
        computeFoundryDerivativeRightsCustodyRegistrationRequestSha256(changed),
      ).not.toBe(digest);
    }
  });

  it("accepts a self-bound custody receipt that remains evidence-only", () => {
    const receipt = custodyReceipt();
    expect(
      FoundryDerivativeRightsCustodyReceiptV1Schema.parse(receipt),
    ).toEqual(receipt);
    expect(
      FoundryDerivativeRightsCustodyRegistrationResultV1Schema.parse(receipt),
    ).toEqual(receipt);
    expect(receipt).toMatchObject({
      authority: "none",
      executionEligible: false,
      storageMode: "postgres_inline_bytea_v1",
      registeredByUserId: REGISTERED_BY_USER_ID,
    });
  });

  it("rejects custody receipt replay, elevation, and digest substitution", () => {
    const receipt = custodyReceipt();
    for (const candidate of [
      { ...receipt, registrationRequestSha256: sha(90) },
      { ...receipt, custodyReceiptSha256: sha(91) },
      { ...receipt, custodyId: "different-custody" },
      { ...receipt, registeredByUserId: REGISTERED_BY_USER_ID.toUpperCase() },
      { ...receipt, authority: "execution" },
      { ...receipt, executionEligible: true },
      { ...receipt, storageMode: "external_object_store" },
      { ...receipt, capturedAt: "2026-07-14T09:30:00Z" },
      { ...receipt, capturedAt: "2026-07-14T09:30:00.001Z" },
      { ...receipt, executionApprovalId: "not-allowed" },
    ]) {
      expect(
        FoundryDerivativeRightsCustodyReceiptV1Schema.safeParse(candidate)
          .success,
      ).toBe(false);
    }
  });

  it("limits review decisions to registry-attestation acceptance or rejection", () => {
    const material = reviewRequestMaterial();
    expect(
      FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1Schema.parse(
        material,
      ).decision,
    ).toBe("accepted_for_registry_attestation");
    expect(
      FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1Schema.safeParse(
        { ...material, decision: "rejected" },
      ).success,
    ).toBe(true);

    for (const forbiddenDecision of [
      "approved",
      "allowed",
      "execution_approved",
      "accepted",
    ]) {
      expect(
        FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1Schema.safeParse(
          { ...material, decision: forbiddenDecision },
        ).success,
      ).toBe(false);
    }
  });

  it("binds review request identity to approval, custody, decision, and rationale", () => {
    const material = reviewRequestMaterial();
    const digest =
      computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256(
        material,
      );
    for (const changed of [
      { ...material, approvalId: "other-approval" },
      { ...material, custodyId: "018f3e5a-6e3b-7d10-a4f1-998877665544" },
      { ...material, derivativeRightsApprovalSha256: sha(97) },
      { ...material, custodyReceiptSha256: sha(92) },
      { ...material, decision: "rejected" as const },
      { ...material, rationale: `${material.rationale} Changed.` },
    ]) {
      expect(
        computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256(
          changed,
        ),
      ).not.toBe(digest);
    }
  });

  it("accepts a self-bound review receipt that is not execution authority", () => {
    const receipt = reviewReceipt();
    expect(
      FoundryDerivativeRightsRegistryAttestationReviewReceiptV1Schema.parse(
        receipt,
      ),
    ).toEqual(receipt);
    expect(
      FoundryDerivativeRightsRegistryAttestationReviewResultV1Schema.parse(
        receipt,
      ),
    ).toEqual(receipt);
    expect(receipt).toMatchObject({
      decision: "accepted_for_registry_attestation",
      derivativeRightsApprovalSha256: sha(2),
      authority: "none",
      executionEligible: false,
    });
    expect(
      FoundryDerivativeRightsApprovalV0Schema.safeParse(receipt).success,
    ).toBe(false);
  });

  it("rejects review receipt replay, approval swaps, and authority elevation", () => {
    const receipt = reviewReceipt();
    for (const candidate of [
      { ...receipt, reviewRequestSha256: sha(93) },
      { ...receipt, reviewReceiptSha256: sha(94) },
      { ...receipt, approvalId: "swapped-approval" },
      { ...receipt, derivativeRightsApprovalSha256: sha(95) },
      { ...receipt, custodyReceiptSha256: sha(96) },
      { ...receipt, reviewedByUserId: REVIEWED_BY_USER_ID.toUpperCase() },
      { ...receipt, reviewedAt: "2026-07-14T10:30:00+01:00" },
      { ...receipt, authority: "execution" },
      { ...receipt, executionEligible: true },
      { ...receipt, providerDispatchEligible: true },
    ]) {
      expect(
        FoundryDerivativeRightsRegistryAttestationReviewReceiptV1Schema.safeParse(
          candidate,
        ).success,
      ).toBe(false);
    }
  });

  it("domain-separates registration, custody, review request, and review receipt identities", () => {
    const digestVector = [
      computeFoundryDerivativeRightsCustodyRegistrationRequestSha256(
        custodyRequestMaterial(),
      ),
      computeFoundryDerivativeRightsCustodyReceiptSha256(
        custodyReceiptMaterial(),
      ),
      computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256(
        reviewRequestMaterial(),
      ),
      computeFoundryDerivativeRightsRegistryAttestationReviewReceiptSha256(
        reviewReceiptMaterial(),
      ),
    ];
    expect(digestVector).toEqual([
      "sha256:9a6477b46976a0d2e1b0c9391893a52ed7c41547b142246c6b2fc4e527c2172e",
      "sha256:101ab19851b295ce9cce5d027e77c727c3d855a164bc6e4b4c69cefb6632b6d2",
      "sha256:7e3493e1888754b291a1fa9bc6c9e8a6e7e8cb04656fd71ea1249398f497bb2f",
      "sha256:9763fc842ba7c4b0c7689895185623d25e0f3e7ad32ef70b3bba3003d40d33e6",
    ]);
    const digests = new Set(digestVector);
    expect(digests.size).toBe(4);
  });
});

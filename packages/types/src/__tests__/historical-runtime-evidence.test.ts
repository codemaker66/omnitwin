import { describe, expect, it } from "vitest";
import {
  HISTORICAL_RUNTIME_MAX_EVIDENCE_OBJECT_BYTES,
  HISTORICAL_RUNTIME_ROLE_ATTESTATION_PAYLOAD_TYPE,
  HistoricalRuntimeAuthoritySnapshotSchema,
  HistoricalRuntimeCaptureContentIdentityPredicateSchema,
  HistoricalRuntimeDerivationEvidenceSchema,
  HistoricalRuntimeExactObjectReceiptSchema,
  HistoricalRuntimeNormalizedContentIdentitySchema,
  HistoricalRuntimeProductionExactObjectReceiptSchema,
  HistoricalRuntimeProductionRoleAttestationSchema,
  HistoricalRuntimeProviderCapabilitySchema,
  PrepareHistoricalRuntimeCaptureContentSubjectSchema,
  HistoricalRuntimeReviewedProfileEvidenceSchema,
  HistoricalRuntimeReviewedProfileSubjectSchema,
  HistoricalRuntimeRoleAttestationSchema,
  HistoricalRuntimeRoleAttestationSubjectSchema,
  HistoricalRuntimeRoleEvidenceSchema,
  HistoricalRuntimeSceneAuthorityCoverageSchema,
  HistoricalRuntimeSceneAuthorityReceiptSchema,
  HistoricalRuntimeSceneAuthoritySubjectSchema,
  HistoricalRuntimeSourceReceiptSetSchema,
  createHistoricalRuntimeRoleAttestationSigningPayload,
  historicalRuntimeAuthoritySnapshotDigest,
  historicalRuntimeCaptureContentSubjectDigest,
  historicalRuntimeDerivationEvidenceDigest,
  historicalRuntimeDerivationMembersDigest,
  historicalRuntimeExactObjectReceiptDigest,
  historicalRuntimeProviderCapabilityDigest,
  historicalRuntimeReviewedProfileActorMapDigest,
  historicalRuntimeReviewedProfileEvidenceDigest,
  historicalRuntimeReviewedProfileMembersDigest,
  historicalRuntimeReviewedProfileSubjectDigest,
  historicalRuntimeRoleAttestationDigest,
  historicalRuntimeRoleAttestationSubjectDigest,
  historicalRuntimeSceneAuthorityCoverageDigest,
  historicalRuntimeSceneAuthorityReceiptDigest,
  historicalRuntimeSceneAuthoritySubjectDigest,
  historicalRuntimeSourceReceiptSetDigest,
} from "../historical-runtime-evidence.js";
import { sha256Hex } from "../canonical-layout-snapshot.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);
const VENUE_ID = "10000000-0000-4000-8000-000000000010";
const SPACE_ID = "10000000-0000-4000-8000-000000000011";
const ACTORS = Array.from(
  { length: 20 },
  (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

function exactReceipt(overrides: Record<string, unknown> = {}) {
  const object = {
    providerProfile: "local_fixture",
    providerKind: "local_fixture",
    providerAccountSha256: A,
    endpointAuthoritySha256: B,
    privateBucketSha256: C,
    storageKeySha256: D,
    versionKind: "local_fixture_version",
    storageVersion: "fixture-v1",
    immutabilityCapabilityReceiptId: "10000000-0000-4000-8000-000000000020",
    immutabilityCapabilityDigest: E,
    storageEtag: '"fixture-etag"',
    fileName: "cloud_0.e57",
    mimeType: "application/vnd.astm-e57",
    sha256: F,
    sizeBytes: 20_518_437_888,
    ...(overrides["object"] as Record<string, unknown> | undefined),
  };
  const anonymousAccessDenial = {
    schemaVersion: "historical-runtime-anonymous-access-denial.v1",
    requestMethod: "HEAD",
    providerProfile: object.providerProfile,
    providerKind: object.providerKind,
    providerAccountSha256: object.providerAccountSha256,
    endpointAuthoritySha256: object.endpointAuthoritySha256,
    privateBucketSha256: object.privateBucketSha256,
    storageKeySha256: object.storageKeySha256,
    versionKind: object.versionKind,
    storageVersion: object.storageVersion,
    immutabilityCapabilityReceiptId: object.immutabilityCapabilityReceiptId,
    immutabilityCapabilityDigest: object.immutabilityCapabilityDigest,
    authenticatedReadRequestDigest: D,
    requestDigest: A,
    responseDigest: B,
    statusCode: 403,
    denialClass: "access_forbidden",
    redirectCount: 0,
    probedBy: ACTORS[2],
    probedAt: "2026-08-20T09:31:00.000Z",
    expiresAt: "2026-08-21T09:31:00.000Z",
    ...(overrides["anonymousAccessDenial"] as Record<string, unknown> | undefined),
  };
  const material = {
    schemaVersion: "historical-runtime-exact-object-receipt.v1",
    receiptId: "10000000-0000-4000-8000-000000000001",
    object,
    custodianActorId: ACTORS[0],
    observedByActorId: ACTORS[1],
    authenticatedReadRequestDigest: D,
    authenticatedReadResponseDigest: E,
    readAt: "2026-08-20T09:30:00.000Z",
    anonymousAccessDenial,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) =>
      key !== "object" && key !== "anonymousAccessDenial")),
  };
  return {
    ...material,
    receiptDigest: historicalRuntimeExactObjectReceiptDigest(material),
  };
}

function sogReceipt() {
  return exactReceipt({
    object: {
      fileName: "room.sog",
      mimeType: "application/vnd.venviewer.sog",
      sizeBytes: 7,
    },
  });
}

function providerCapability(overrides: Record<string, unknown> = {}) {
  const material = {
    schemaVersion: "historical-runtime-provider-capability.v1",
    capabilityReceiptId: "10000000-0000-4000-8000-000000000080",
    providerProfile: "local_fixture",
    providerAccountSha256: A,
    endpointAuthoritySha256: B,
    privateBucketSha256: C,
    providerKind: "local_fixture",
    versionKind: "local_fixture_version",
    exactVersionReadSupported: true,
    overwritePreservesPriorVersion: true,
    anonymousProbeSupported: true,
    verificationMode: "local_fixture_exact_version",
    testObjectStorageKeySha256: D,
    initialWriteDigest: A,
    initialReadDigest: A,
    overwriteDigest: B,
    priorVersionRereadDigest: A,
    verifiedBy: ACTORS[0],
    verifiedAt: "2026-08-20T09:00:00.000Z",
    expiresAt: "2026-09-19T09:00:00.000Z",
    ...overrides,
  };
  return {
    ...material,
    capabilityDigest: historicalRuntimeProviderCapabilityDigest(material),
  };
}

function ownerAuthoritySnapshot(
  workspaceRole: "owner" | "admin" | "staff" = "owner",
  authenticationSource: "clerk_session" | "local_test_fixture" = "local_test_fixture",
) {
  const material = {
    authenticationSource,
    platformRole: "none",
    userRole: "staff",
    userVenueId: VENUE_ID,
    venueId: VENUE_ID,
    workspaceMembership: {
      state: "active",
      membershipId: "10000000-0000-4000-8000-000000000071",
      workspaceId: "10000000-0000-4000-8000-000000000072",
      workspaceRole,
      venueRole: "staff",
      membershipStatus: "active",
      membershipUpdatedAt: "2026-08-20T08:00:00.000Z",
      membershipVersionDigest: A,
    },
    snapshottedAt: "2026-08-20T09:00:00.000Z",
  } as const;
  return HistoricalRuntimeAuthoritySnapshotSchema.parse({
    ...material,
    authorityDigest: historicalRuntimeAuthoritySnapshotDigest(material),
  });
}

function ownerRoleAttestation(options: {
  readonly documentReceipt?: ReturnType<typeof exactReceipt>;
  readonly workspaceRole?: "owner" | "admin" | "staff";
  readonly authenticationSource?: "clerk_session" | "local_test_fixture";
  readonly keyId?: string;
  readonly verifiedAt?: string;
} = {}) {
  const subjectMaterial = {
    schemaVersion: "historical-runtime-role-attestation.v1",
    attestationId: "10000000-0000-4000-8000-000000000073",
    subjectId: "10000000-0000-4000-8000-000000000074",
    subjectKind: "capture_import",
    tenantBoundary: "venue_id_v1",
    tenantId: VENUE_ID,
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    role: "owner_authorizer",
    evidence: {
      schemaVersion: "historical-runtime-role-owner-authorization.v1",
      role: "owner_authorizer",
      decision: "approved",
      sourceReceiptSetDigest: A,
      authorizedOperations: [
        "store_private",
        "convert",
        "render",
        "generate_derivatives",
        "internal_planning",
        "customer_presentation",
      ],
      authorizationDocument: {
        documentReceipt: options.documentReceipt ?? exactReceipt(),
        scopeDigest: B,
      },
    },
    actorId: ACTORS[0],
    authoritySnapshot: ownerAuthoritySnapshot(
      options.workspaceRole,
      options.authenticationSource,
    ),
    keyPolicyId: "10000000-0000-4000-8000-000000000075",
    keyPolicyDigest: C,
    keyId: options.keyId ?? "fixture-key-1",
    signerPublicKeySha256: `sha256:${D}`,
    recordedAt: "2026-08-20T09:00:00.000Z",
    effectiveAt: "2026-08-20T09:00:00.000Z",
    expiresAt: "2026-08-21T09:00:00.000Z",
    nonce: "10000000-0000-4000-8000-000000000076",
  } as const;
  const subject = HistoricalRuntimeRoleAttestationSubjectSchema.parse({
    ...subjectMaterial,
    roleAttestationSubjectDigest:
      historicalRuntimeRoleAttestationSubjectDigest(subjectMaterial),
  });
  const statement = {
    authority: "venue_evidence",
    evidenceKind: "historical_runtime_role_attestation",
    schemaVersion: "historical-runtime-role-attestation-statement.v1",
    subjectName: `historical-runtime-role-attestation/${subject.attestationId}`,
    subjectDigest: subject.roleAttestationSubjectDigest,
    predicate: {
      attestationId: subject.attestationId,
      roleAttestationSubjectDigest: subject.roleAttestationSubjectDigest,
      subjectKind: subject.subjectKind,
      role: subject.role,
      actorId: subject.actorId,
      tenantId: subject.tenantId,
      venueId: subject.venueId,
      spaceId: subject.spaceId,
      keyPolicyId: subject.keyPolicyId,
      keyPolicyDigest: subject.keyPolicyDigest,
      keyId: subject.keyId,
      signerPublicKeySha256: subject.signerPublicKeySha256,
      issuedAt: subject.recordedAt,
      effectiveAt: subject.effectiveAt,
      expiresAt: subject.expiresAt,
      nonce: subject.nonce,
    },
  } as const;
  const { payloadUtf8, payloadSha256 } =
    createHistoricalRuntimeRoleAttestationSigningPayload(statement);
  const envelopeUtf8 = "{}";
  const rawEvidence = {
    payloadType: HISTORICAL_RUNTIME_ROLE_ATTESTATION_PAYLOAD_TYPE,
    payloadUtf8,
    envelopeUtf8,
    payloadSha256,
    receiptSha256: `sha256:${sha256Hex(
      `venviewer.historical-runtime-role-attestation.v1\n${payloadUtf8}`,
    )}`,
    envelopeSha256: `sha256:${sha256Hex(
      `venviewer.historical-runtime-role-attestation.v1.dsse-envelope\n${envelopeUtf8}`,
    )}`,
    signerPublicKeySha256: subject.signerPublicKeySha256,
    payloadByteLength: String(new TextEncoder().encode(payloadUtf8).byteLength),
    envelopeByteLength: String(new TextEncoder().encode(envelopeUtf8).byteLength),
    verifiedAt: options.verifiedAt ?? "2026-08-20T09:01:00.000Z",
  } as const;
  const material = { subject, statement, rawEvidence };
  return {
    ...material,
    attestationDigest: historicalRuntimeRoleAttestationDigest(material),
  };
}

function reviewedProfileSubjectMaterial(overrides: Record<string, unknown> = {}) {
  const members = [{
    memberIndex: 0,
    assetVersionId: "10000000-0000-4000-8000-000000000051",
    fileName: "room.sog",
    fileExt: ".sog",
    mimeType: "application/vnd.venviewer.sog",
    sha256: A,
    sizeBytes: 7,
    derivationOutputReceiptId: "10000000-0000-4000-8000-000000000052",
    derivationMemberReceiptDigest: B,
    runtimePackageMemberDigest: C,
    presentationAdmissionMemberDigest: D,
    rightsClearanceId: "10000000-0000-4000-8000-000000000053",
    rightsClearanceDigest: E,
    rightsReviewerActorId: ACTORS[7],
    sceneCoverageDigest: F,
    sceneAuthorityReference: "scene/node-1",
  }] as const;
  const actorMap = {
    captureCreatorActorId: ACTORS[0],
    sourceCustodianActorId: ACTORS[1],
    ownerAuthorizerActorId: ACTORS[9],
    privacyReviewerActorId: ACTORS[10],
    movableContentReviewerActorId: ACTORS[11],
    normalizerActorId: ACTORS[12],
    captureFinalReviewerActorId: ACTORS[13],
    derivativeProducerActorId: ACTORS[14],
    derivativeCustodianActorId: ACTORS[15],
    derivativeReviewerActorId: ACTORS[16],
    packageCustodianActorId: ACTORS[2],
    qaReviewerActorId: ACTORS[3],
    transformReviewerActorId: ACTORS[4],
    sceneReviewerActorId: ACTORS[5],
    admissionReviewerActorId: ACTORS[6],
    rightsReviewerActorIds: [ACTORS[7]],
    designatedFinalReviewerActorId: ACTORS[8],
  } as const;
  return {
    schemaVersion: "historical-runtime-reviewed-profile-subject.v1",
    reviewedProfileEvidenceId: "10000000-0000-4000-8000-000000000054",
    reviewedProfileId: "reviewed-profile-v1",
    reviewedProfileManifestFingerprint: A,
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    presentationAdmissionId: "10000000-0000-4000-8000-000000000055",
    presentationAdmissionDigest: B,
    presentationAdmissionReviewedBy: ACTORS[6],
    presentationAdmissionReviewedAt: "2026-08-20T09:00:00.000Z",
    admissionReviewerAttestationId: "10000000-0000-4000-8000-000000000056",
    admissionReviewerAttestationDigest: C,
    runtimePackageId: "10000000-0000-4000-8000-000000000057",
    runtimePackageRevision: 1,
    runtimePackageContentDigest: D,
    runtimeManifestDigest: E,
    captureRootId: "10000000-0000-4000-8000-000000000058",
    captureRootEvidenceDigest: F,
    captureClearanceId: "10000000-0000-4000-8000-000000000059",
    captureClearanceDigest: A,
    derivationId: "10000000-0000-4000-8000-000000000060",
    derivationEvidenceDigest: B,
    runtimeQaRecordId: "10000000-0000-4000-8000-000000000061",
    runtimeQaRecordKey: "qa-v1",
    runtimeQaRecordDigest: C,
    runtimeQaDecision: "approved_internal_preview",
    runtimeQaReviewedBy: ACTORS[3],
    runtimeQaReviewedAt: "2026-08-20T09:00:00.000Z",
    qaReviewerAttestationId: "10000000-0000-4000-8000-000000000062",
    qaReviewerAttestationDigest: D,
    transformReviewId: "10000000-0000-4000-8000-000000000063",
    transformReviewDigest: E,
    sceneValidationId: "10000000-0000-4000-8000-000000000064",
    sceneValidationDigest: F,
    packageCustodianAttestationId: "10000000-0000-4000-8000-000000000065",
    packageCustodianAttestationDigest: A,
    memberCount: 1,
    totalBytes: 7,
    members,
    membersDigest: historicalRuntimeReviewedProfileMembersDigest(members),
    actorMap,
    actorMapDigest: historicalRuntimeReviewedProfileActorMapDigest(actorMap),
    constituentExpiries: {
      captureClearanceExpiresAt: "2026-08-21T10:00:00.000Z",
      derivationReviewExpiresAt: "2026-08-21T10:00:00.000Z",
      runtimeQaAuthorityExpiresAt: "2026-08-21T10:00:00.000Z",
      transformReviewExpiresAt: "2026-08-21T10:00:00.000Z",
      sceneValidationExpiresAt: "2026-08-21T10:00:00.000Z",
      packageCustodianAttestationExpiresAt: "2026-08-21T10:00:00.000Z",
      admissionReviewerAttestationExpiresAt: "2026-08-21T10:00:00.000Z",
      rightsClearanceExpiresAt: ["2026-08-21T10:00:00.000Z"],
    },
    preparedAt: "2026-08-20T10:00:00.000Z",
    expiresAt: "2026-08-21T10:00:00.000Z",
    ...overrides,
  } as const;
}

function sceneCoverage(
  wholeVenueRegionIds: readonly string[] = ["region-1"],
  coveredRegionIds: readonly string[] = ["region-1"],
) {
  return {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    runtimePackageId: "10000000-0000-4000-8000-000000000041",
    runtimePackageContentDigest: A,
    runtimeManifestDigest: B,
    presentationAdmissionId: "10000000-0000-4000-8000-000000000042",
    presentationAdmissionDigest: C,
    transformReviewId: "10000000-0000-4000-8000-000000000043",
    transformReviewDigest: D,
    twinReleaseId: "10000000-0000-4000-8000-000000000044",
    twinReleaseManifestDigest: E,
    roomScopeBasisDigest: F,
    coverageDecision: "whole_room_and_all_runtime_members_covered",
    wholeVenueRegionIds,
    orderedMembers: [{
      memberIndex: 0,
      assetVersionId: "10000000-0000-4000-8000-000000000045",
      derivationMemberReceiptDigest: A,
      authorityReference: "scene/node-1",
      coveredRegionIds,
    }],
  } as const;
}

function validSceneSubject() {
  const coverage = sceneCoverage();
  const sceneObjectReceipt = exactReceipt({
    object: {
      fileName: "scene-authority.json",
      mimeType: "application/json",
      sizeBytes: 7,
    },
  });
  const material = {
    schemaVersion: "historical-runtime-scene-authority-subject.v1",
    sceneValidationId: "10000000-0000-4000-8000-000000000046",
    sceneArtifactRowId: "10000000-0000-4000-8000-000000000047",
    sceneArtifactId: "scene-authority-v1",
    sceneArtifactDigest: sceneObjectReceipt.object.sha256,
    sceneRegistryObjectSha256: sceneObjectReceipt.object.sha256,
    sceneRegistryObjectSizeBytes: sceneObjectReceipt.object.sizeBytes,
    sceneObjectReceipt,
    parsedMapDigest: sceneObjectReceipt.object.sha256,
    coverage,
    coverageDigest: historicalRuntimeSceneAuthorityCoverageDigest(coverage),
    validatedAt: "2026-08-20T10:00:00.000Z",
    presentationAdmissionReviewerAttestationId:
      "10000000-0000-4000-8000-000000000048",
    presentationAdmissionReviewerAttestationDigest: D,
    presentationAdmissionReviewerActorId: ACTORS[6],
    presentationAdmissionReviewerAttestationExpiresAt: "2026-08-22T10:00:00.000Z",
    transformReviewExpiresAt: "2026-08-22T10:00:00.000Z",
    twinReleaseAuthorityReceiptId: "10000000-0000-4000-8000-000000000049",
    twinReleaseAuthorityDigest: E,
    twinReleaseAuthorityExpiresAt: "2026-08-22T10:00:00.000Z",
    providerCapabilityReceiptId:
      sceneObjectReceipt.object.immutabilityCapabilityReceiptId,
    providerCapabilityDigest: sceneObjectReceipt.object.immutabilityCapabilityDigest,
    providerCapabilityExpiresAt: "2026-08-22T10:00:00.000Z",
    authorityExpiresAt: sceneObjectReceipt.anonymousAccessDenial.expiresAt,
  } as const;
  return HistoricalRuntimeSceneAuthoritySubjectSchema.parse({
    ...material,
    sceneValidationSubjectDigest: historicalRuntimeSceneAuthoritySubjectDigest(material),
  });
}

describe("historical runtime authenticated-import evidence", () => {
  it("accepts the exact 20.5 GB E57 size without allocating its bytes", () => {
    const receipt = HistoricalRuntimeExactObjectReceiptSchema.parse(exactReceipt());
    expect(receipt.object.sizeBytes).toBe(20_518_437_888);
  });

  it("makes every malformed nested receipt fail safeParse without throwing", () => {
    const valid = exactReceipt();
    const invalid = [
      { ...valid, object: { ...valid.object, sizeBytes: HISTORICAL_RUNTIME_MAX_EVIDENCE_OBJECT_BYTES + 1 } },
      { ...valid, anonymousAccessDenial: { ...valid.anonymousAccessDenial, expiresAt: "2026-08-21T09:31:01.000Z" } },
      { ...valid, anonymousAccessDenial: { ...valid.anonymousAccessDenial, providerAccountSha256: F } },
      { ...valid, object: { ...valid.object, providerKind: "r2_workers", versionKind: "s3_version_id" } },
    ];
    for (const value of invalid) {
      expect(() => HistoricalRuntimeExactObjectReceiptSchema.safeParse(value)).not.toThrow();
      expect(HistoricalRuntimeExactObjectReceiptSchema.safeParse(value).success).toBe(false);
    }
  });

  it("compares offset timestamps by epoch rather than lexicographically", () => {
    const receipt = exactReceipt({
      readAt: "2026-08-20T09:30:00.000Z",
      anonymousAccessDenial: {
        probedAt: "2026-08-20T10:00:00.000+01:00",
        expiresAt: "2026-08-20T11:00:00.000+01:00",
      },
    });
    expect(HistoricalRuntimeExactObjectReceiptSchema.safeParse(receipt).success).toBe(false);
  });

  it("keeps local-fixture receipts out of the production authority schema", () => {
    expect(HistoricalRuntimeExactObjectReceiptSchema.safeParse(exactReceipt()).success).toBe(true);
    expect(HistoricalRuntimeProductionExactObjectReceiptSchema.safeParse(exactReceipt()).success)
      .toBe(false);
  });

  it("accepts only a synthetic processed-package schema fixture with an authenticated unavailable-ancestor gap", () => {
    const memberReceipt = HistoricalRuntimeExactObjectReceiptSchema.parse(exactReceipt({
      object: {
        fileName: "synthetic-processed-package.zip",
        mimeType: "application/zip",
        sizeBytes: 1_024,
      },
    }));
    const material = {
      schemaVersion: "historical-runtime-source-receipt-set.v1",
      receiptSetId: "10000000-0000-4000-8000-000000000002",
      lineageStartKind: "processed_capture_package",
      ancestorState: "owner_attested_unavailable_ancestor",
      unavailableAncestorAttestationId: "10000000-0000-4000-8000-000000000003",
      unavailableAncestorAttestationDigest: A,
      rootComponentIndex: 0,
      members: [{
        componentIndex: 0,
        role: "processed_package_archive",
        relativePath: "synthetic-processed-package.zip",
        receipt: memberReceipt,
      }],
    } as const;
    expect(HistoricalRuntimeSourceReceiptSetSchema.parse({
      ...material,
      receiptSetDigest: historicalRuntimeSourceReceiptSetDigest(material),
    }).ancestorState).toBe("owner_attested_unavailable_ancestor");
  });

  it("rejects a processed root that points at supporting metadata or duplicates a receipt", () => {
    const receipt = exactReceipt({ object: { fileName: "inventory.json", mimeType: "application/json", sizeBytes: 10 } });
    const material = {
      schemaVersion: "historical-runtime-source-receipt-set.v1",
      receiptSetId: "10000000-0000-4000-8000-000000000002",
      lineageStartKind: "processed_capture_package",
      ancestorState: "owner_attested_unavailable_ancestor",
      unavailableAncestorAttestationId: "10000000-0000-4000-8000-000000000003",
      unavailableAncestorAttestationDigest: A,
      rootComponentIndex: 1,
      members: [
        { componentIndex: 0, role: "inventory_manifest", relativePath: "inventory.json", receipt },
        { componentIndex: 1, role: "supporting_capture_metadata", relativePath: "metadata.json", receipt },
      ],
    } as const;
    const result = HistoricalRuntimeSourceReceiptSetSchema.safeParse({
      ...material,
      receiptSetDigest: historicalRuntimeSourceReceiptSetDigest(material),
    });
    expect(result.success).toBe(false);
  });

  it("requires exact RGB8 stride and byte-length equations", () => {
    expect(HistoricalRuntimeNormalizedContentIdentitySchema.safeParse({
      normalizationProfileVersion: "historical-runtime-normalization-profile.v1",
      conformanceTestVectorSetDigest: C,
      normalizationSpec: "panorama-rgb8-srgb-top-left.v1",
      normalizedSha256: A,
      normalizedSizeBytes: 300,
      decoderName: "fixture-decoder",
      decoderVersion: "1.0.0",
      decoderBinarySha256: B,
      widthPixels: 100,
      heightPixels: 1,
      rowStrideBytes: 299,
      frameByteLength: 300,
      orientationRule: "apply-exif-1-to-8-then-top-left",
      colourRule: "embedded-icc-to-srgb-relative-colorimetric-or-assume-srgb",
      alphaRule: "reject-non-opaque-alpha",
    }).success).toBe(false);
  });

  it("requires the full owner-operation and privacy-review sets", () => {
    const document = { documentReceipt: exactReceipt(), scopeDigest: A };
    expect(HistoricalRuntimeRoleEvidenceSchema.safeParse({
      schemaVersion: "historical-runtime-role-owner-authorization.v1",
      role: "owner_authorizer",
      decision: "approved",
      sourceReceiptSetDigest: A,
      authorizedOperations: ["store_private"],
      authorizationDocument: document,
    }).success).toBe(false);
    expect(HistoricalRuntimeRoleEvidenceSchema.safeParse({
      schemaVersion: "historical-runtime-role-privacy-review.v1",
      role: "privacy_reviewer",
      decision: "approved",
      sourceReceiptSetDigest: A,
      reviewedCategories: ["faces"],
      reviewDocument: document,
    }).success).toBe(false);
  });

  it("rejects derivation metadata that disagrees with the exact output receipt", () => {
    const receipt = sogReceipt();
    const members = [{
      memberIndex: 0,
      assetVersionId: "10000000-0000-4000-8000-000000000031",
      fileName: "different.sog",
      fileExt: ".sog",
      mimeType: "application/octet-stream",
      sha256: A,
      sizeBytes: 6,
      outputReceipt: receipt,
    }];
    const material = {
      schemaVersion: "historical-runtime-derivation-evidence.v1",
      derivationId: "10000000-0000-4000-8000-000000000030",
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      captureRootId: "10000000-0000-4000-8000-000000000032",
      captureRootEvidenceDigest: A,
      inputNormalizedContentDigest: B,
      captureClearanceId: "10000000-0000-4000-8000-000000000033",
      captureClearanceDigest: C,
      conversionTool: "synthetic-tool",
      conversionVersion: "1.0.0",
      conversionBinarySha256: D,
      conversionCommandSha256: E,
      conversionParametersDigest: F,
      conversionEnvironmentDigest: A,
      producerAttestationId: "10000000-0000-4000-8000-000000000034",
      producerAttestationDigest: B,
      custodianAttestationId: "10000000-0000-4000-8000-000000000035",
      custodianAttestationDigest: C,
      reviewerAttestationId: "10000000-0000-4000-8000-000000000036",
      reviewerAttestationDigest: D,
      memberCount: 1,
      totalBytes: 6,
      members,
      membersDigest: historicalRuntimeDerivationMembersDigest(members),
      registeredAt: "2026-08-20T10:00:00.000Z",
    } as const;
    expect(HistoricalRuntimeDerivationEvidenceSchema.safeParse({
      ...material,
      derivationEvidenceDigest: historicalRuntimeDerivationEvidenceDigest(material),
    }).success).toBe(false);
  });

  it("rejects Scene registry and parsed-map identities that disagree with private bytes", () => {
    const coverage = {
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      runtimePackageId: "10000000-0000-4000-8000-000000000041",
      runtimePackageContentDigest: A,
      runtimeManifestDigest: B,
      presentationAdmissionId: "10000000-0000-4000-8000-000000000042",
      presentationAdmissionDigest: C,
      transformReviewId: "10000000-0000-4000-8000-000000000043",
      transformReviewDigest: D,
      twinReleaseId: "10000000-0000-4000-8000-000000000044",
      twinReleaseManifestDigest: E,
      roomScopeBasisDigest: F,
      coverageDecision: "whole_room_and_all_runtime_members_covered",
      wholeVenueRegionIds: ["region-1"],
      orderedMembers: [{
        memberIndex: 0,
        assetVersionId: "10000000-0000-4000-8000-000000000045",
        derivationMemberReceiptDigest: A,
        authorityReference: "scene/node-1",
        coveredRegionIds: ["region-1"],
      }],
    } as const;
    const sceneObjectReceipt = exactReceipt({
      object: { fileName: "scene-authority.json", mimeType: "application/json", sizeBytes: 7 },
    });
    const material = {
      schemaVersion: "historical-runtime-scene-authority-subject.v1",
      sceneValidationId: "10000000-0000-4000-8000-000000000046",
      sceneArtifactRowId: "10000000-0000-4000-8000-000000000047",
      sceneArtifactId: "scene-authority-v1",
      sceneArtifactDigest: A,
      sceneRegistryObjectSha256: B,
      sceneRegistryObjectSizeBytes: 7,
      sceneObjectReceipt,
      parsedMapDigest: C,
      coverage,
      coverageDigest: historicalRuntimeSceneAuthorityCoverageDigest(coverage),
      validatedAt: "2026-08-20T10:00:00.000Z",
      presentationAdmissionReviewerAttestationId:
        "10000000-0000-4000-8000-000000000048",
      presentationAdmissionReviewerAttestationDigest: D,
      presentationAdmissionReviewerActorId: ACTORS[6],
      presentationAdmissionReviewerAttestationExpiresAt: "2026-08-22T10:00:00.000Z",
      transformReviewExpiresAt: "2026-08-22T10:00:00.000Z",
      twinReleaseAuthorityReceiptId: "10000000-0000-4000-8000-000000000049",
      twinReleaseAuthorityDigest: E,
      twinReleaseAuthorityExpiresAt: "2026-08-22T10:00:00.000Z",
      providerCapabilityReceiptId:
        sceneObjectReceipt.object.immutabilityCapabilityReceiptId,
      providerCapabilityDigest: sceneObjectReceipt.object.immutabilityCapabilityDigest,
      providerCapabilityExpiresAt: "2026-08-22T10:00:00.000Z",
      authorityExpiresAt: sceneObjectReceipt.anonymousAccessDenial.expiresAt,
    } as const;
    expect(HistoricalRuntimeSceneAuthoritySubjectSchema.safeParse({
      ...material,
      sceneValidationSubjectDigest: historicalRuntimeSceneAuthoritySubjectDigest(material),
    }).success).toBe(false);
  });

  it("rejects fabricated reviewed-profile totals and requires an explicit separated role map", () => {
    const material = reviewedProfileSubjectMaterial({ totalBytes: 1 });
    expect(HistoricalRuntimeReviewedProfileSubjectSchema.safeParse({
      ...material,
      reviewedProfileSubjectDigest: historicalRuntimeReviewedProfileSubjectDigest(material),
    }).success).toBe(false);
  });

  it("rejects role/subject drift and unbounded local-fixture action authority", () => {
    const valid = ownerRoleAttestation();
    const invalidSubjectMaterial = {
      ...valid.subject,
      subjectKind: "scene_validation",
      authoritySnapshot: ownerAuthoritySnapshot("staff"),
      expiresAt: "9999-01-01T00:00:00.000Z",
    };
    const { roleAttestationSubjectDigest: _oldDigest, ...unsigned } = invalidSubjectMaterial;
    expect(HistoricalRuntimeRoleAttestationSubjectSchema.safeParse({
      ...unsigned,
      roleAttestationSubjectDigest: historicalRuntimeRoleAttestationSubjectDigest(unsigned),
    }).success).toBe(false);
  });

  it("requires a real overwrite and exact prior-version reread in provider capability evidence", () => {
    expect(HistoricalRuntimeProviderCapabilitySchema.safeParse(providerCapability()).success)
      .toBe(true);
    for (const invalid of [
      providerCapability({ initialReadDigest: B }),
      providerCapability({ priorVersionRereadDigest: B }),
      providerCapability({ overwriteDigest: A }),
      providerCapability({ verificationMode: "provider_native_version" }),
    ]) {
      expect(HistoricalRuntimeProviderCapabilitySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("rejects future authority snapshots, non-owner authorization, and verifier-invalid key IDs", () => {
    const valid = ownerRoleAttestation();
    expect(HistoricalRuntimeRoleAttestationSchema.safeParse(valid).success).toBe(true);

    const futureAuthorityMaterial = {
      authenticationSource: "local_test_fixture",
      platformRole: "none",
      userRole: "staff",
      userVenueId: VENUE_ID,
      venueId: VENUE_ID,
      workspaceMembership: {
        state: "active",
        membershipId: "10000000-0000-4000-8000-000000000071",
        workspaceId: "10000000-0000-4000-8000-000000000072",
        workspaceRole: "owner",
        venueRole: "staff",
        membershipStatus: "active",
        membershipUpdatedAt: "2026-08-20T08:00:00.000Z",
        membershipVersionDigest: A,
      },
      snapshottedAt: "2099-08-20T09:00:00.000Z",
    } as const;
    const futureAuthority = HistoricalRuntimeAuthoritySnapshotSchema.parse({
      ...futureAuthorityMaterial,
      authorityDigest: historicalRuntimeAuthoritySnapshotDigest(futureAuthorityMaterial),
    });
    const { roleAttestationSubjectDigest: _digest, ...subjectMaterial } = valid.subject;
    const futureSubjectMaterial = { ...subjectMaterial, authoritySnapshot: futureAuthority };
    expect(HistoricalRuntimeRoleAttestationSubjectSchema.safeParse({
      ...futureSubjectMaterial,
      roleAttestationSubjectDigest:
        historicalRuntimeRoleAttestationSubjectDigest(futureSubjectMaterial),
    }).success).toBe(false);

    expect(() => ownerRoleAttestation({ workspaceRole: "staff" })).toThrow();
    expect(HistoricalRuntimeRoleAttestationSubjectSchema.safeParse({
      ...valid.subject,
      keyId: "é",
    }).success).toBe(false);
  });

  it("requires Scene whole-room regions to equal the union of member coverage", () => {
    expect(HistoricalRuntimeSceneAuthorityCoverageSchema.safeParse(
      sceneCoverage(["room-a"], ["different-region"]),
    ).success).toBe(false);
  });

  it("orders Scene validation after the exact private read and denial probe", () => {
    const valid = validSceneSubject();
    const { sceneValidationSubjectDigest: _digest, ...material } = valid;
    const invalidMaterial = {
      ...material,
      validatedAt: "2026-08-20T09:00:00.000Z",
    };
    expect(HistoricalRuntimeSceneAuthoritySubjectSchema.safeParse({
      ...invalidMaterial,
      sceneValidationSubjectDigest:
        historicalRuntimeSceneAuthoritySubjectDigest(invalidMaterial),
    }).success).toBe(false);
  });

  it("rejects role verification and final profile review after their authority expires", () => {
    const validRole = ownerRoleAttestation();
    const invalidRoleMaterial = {
      subject: validRole.subject,
      statement: validRole.statement,
      rawEvidence: {
        ...validRole.rawEvidence,
        verifiedAt: validRole.subject.expiresAt,
      },
    };
    expect(HistoricalRuntimeRoleAttestationSchema.safeParse({
      ...invalidRoleMaterial,
      attestationDigest: historicalRuntimeRoleAttestationDigest(invalidRoleMaterial),
    }).success).toBe(false);

    const subjectMaterial = reviewedProfileSubjectMaterial();
    const subject = HistoricalRuntimeReviewedProfileSubjectSchema.parse({
      ...subjectMaterial,
      reviewedProfileSubjectDigest:
        historicalRuntimeReviewedProfileSubjectDigest(subjectMaterial),
    });
    const invalidProfileMaterial = {
      schemaVersion: "historical-runtime-reviewed-profile-evidence.v1",
      subject,
      reviewedProfileSubjectDigest: subject.reviewedProfileSubjectDigest,
      finalReviewerAttestationId: "10000000-0000-4000-8000-000000000066",
      finalReviewerAttestationDigest: B,
      finalReviewerActorId: ACTORS[8],
      finalReviewerAttestationExpiresAt: "2026-08-22T10:00:00.000Z",
      reviewedAt: "2026-08-21T11:00:00.000Z",
      expiresAt: subject.expiresAt,
    } as const;
    expect(HistoricalRuntimeReviewedProfileEvidenceSchema.safeParse({
      ...invalidProfileMaterial,
      reviewedProfileEvidenceDigest:
        historicalRuntimeReviewedProfileEvidenceDigest(invalidProfileMaterial),
    }).success).toBe(false);
  });

  it("bounds Scene authority and composes production role documents through production receipts", () => {
    const subject = validSceneSubject();
    const unboundedSceneMaterial = {
      schemaVersion: "historical-runtime-scene-authority-receipt.v1",
      subject,
      sceneValidationSubjectDigest: subject.sceneValidationSubjectDigest,
      reviewerAttestationId: "10000000-0000-4000-8000-000000000067",
      reviewerAttestationDigest: B,
      reviewerActorId: ACTORS[5],
      reviewerAttestationExpiresAt: "9999-01-01T00:00:00.000Z",
      reviewedAt: "2026-08-20T11:00:00.000Z",
      expiresAt: "9999-01-01T00:00:00.000Z",
    } as const;
    expect(HistoricalRuntimeSceneAuthorityReceiptSchema.safeParse({
      ...unboundedSceneMaterial,
      sceneValidationDigest:
        historicalRuntimeSceneAuthorityReceiptDigest(unboundedSceneMaterial),
    }).success).toBe(false);

    const r2WorkersDocument = exactReceipt({
      object: {
        providerProfile: "runtime_private",
        providerKind: "r2_workers",
        versionKind: "r2_object_version",
        storageVersion: "r2-object-v1",
      },
    });
    const productionCandidate = ownerRoleAttestation({
      documentReceipt: r2WorkersDocument,
      authenticationSource: "clerk_session",
    });
    expect(HistoricalRuntimeRoleAttestationSchema.safeParse(productionCandidate).success)
      .toBe(true);
    expect(HistoricalRuntimeProductionRoleAttestationSchema.safeParse(productionCandidate).success)
      .toBe(false);
  });

  it("bounds capture-content signing authority even when a caller bypasses the draft input", () => {
    const captureContentSubject = {
      schemaVersion: "historical-runtime-capture-content-subject.v1",
      captureRootId: "10000000-0000-4000-8000-000000000090",
      tenantBoundary: "venue_id_v1",
      tenantId: VENUE_ID,
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      sourceReceiptSetId: "10000000-0000-4000-8000-000000000091",
      sourceReceiptSetDigest: A,
      normalizedContentDigest: B,
      normalizedBy: ACTORS[0],
    } as const;
    const predicate = {
      schemaVersion: "historical-runtime-capture-content-identity.v1",
      captureContentSubject,
      captureContentSubjectDigest:
        historicalRuntimeCaptureContentSubjectDigest(captureContentSubject),
      keyPolicyId: "10000000-0000-4000-8000-000000000092",
      keyPolicyDigest: C,
      keyId: "fixture-key-1",
      signerPublicKeySha256: `sha256:${D}`,
      normalizerAttestationId: "10000000-0000-4000-8000-000000000093",
      normalizerAttestationDigest: E,
      issuedAt: "2026-08-20T10:00:00.000Z",
      expiresAt: "9999-01-01T00:00:00.000Z",
      nonce: "10000000-0000-4000-8000-000000000094",
    } as const;
    expect(HistoricalRuntimeCaptureContentIdentityPredicateSchema.safeParse(predicate).success)
      .toBe(false);
  });

  it("keeps every upstream evidence actor visible and independent from final review", () => {
    const valid = reviewedProfileSubjectMaterial();
    const actorMap = {
      ...valid.actorMap,
      derivativeProducerActorId: valid.actorMap.designatedFinalReviewerActorId,
    };
    const invalid = {
      ...valid,
      actorMap,
      actorMapDigest: historicalRuntimeReviewedProfileActorMapDigest(actorMap),
    };
    expect(HistoricalRuntimeReviewedProfileSubjectSchema.safeParse({
      ...invalid,
      reviewedProfileSubjectDigest: historicalRuntimeReviewedProfileSubjectDigest(invalid),
    }).success).toBe(false);
  });

  it("rejects a client account acting as a QA reviewer", () => {
    const valid = ownerRoleAttestation();
    const authorityMaterial = {
      authenticationSource: "local_test_fixture",
      platformRole: "none",
      userRole: "client",
      userVenueId: VENUE_ID,
      venueId: VENUE_ID,
      workspaceMembership: {
        state: "active",
        membershipId: "10000000-0000-4000-8000-000000000071",
        workspaceId: "10000000-0000-4000-8000-000000000072",
        workspaceRole: "owner",
        venueRole: "client",
        membershipStatus: "active",
        membershipUpdatedAt: "2026-08-20T08:00:00.000Z",
        membershipVersionDigest: A,
      },
      snapshottedAt: "2026-08-20T09:00:00.000Z",
    } as const;
    const authoritySnapshot = HistoricalRuntimeAuthoritySnapshotSchema.parse({
      ...authorityMaterial,
      authorityDigest: historicalRuntimeAuthoritySnapshotDigest(authorityMaterial),
    });
    const { roleAttestationSubjectDigest: _digest, ...base } = valid.subject;
    const material = {
      ...base,
      subjectKind: "reviewed_profile",
      role: "qa_reviewer",
      evidence: {
        schemaVersion: "historical-runtime-role-qa-review.v1",
        role: "qa_reviewer",
        decision: "approved_internal_preview",
        runtimeQaRecordId: "10000000-0000-4000-8000-000000000095",
        runtimeQaRecordDigest: A,
        reviewDocument: {
          documentReceipt: exactReceipt(),
          scopeDigest: B,
        },
      },
      authoritySnapshot,
    } as const;
    expect(HistoricalRuntimeRoleAttestationSubjectSchema.safeParse({
      ...material,
      roleAttestationSubjectDigest: historicalRuntimeRoleAttestationSubjectDigest(material),
    }).success).toBe(false);
  });

  it("does not confuse exact SOG bytes with an SPZ content identity", () => {
    expect(PrepareHistoricalRuntimeCaptureContentSubjectSchema.safeParse({
      captureRootId: "10000000-0000-4000-8000-000000000096",
      sourceReceiptSetId: "10000000-0000-4000-8000-000000000097",
      captureClass: "owner_authorized_existing_capture",
      lineageStartKind: "processed_capture_package",
      ancestorState: "owner_attested_unavailable_ancestor",
      rootComponentIndex: 0,
      sourceObjects: [{
        componentIndex: 0,
        role: "processed_package_member",
        providerProfile: "local_fixture",
        storageKey: "fixtures/room.sog",
        relativePath: "room.sog",
        fileName: "room.sog",
        mimeType: "application/vnd.venviewer.sog",
        expectedSha256: A,
        expectedSizeBytes: 7,
      }],
      normalizedContent: {
        normalizationProfileVersion: "historical-runtime-normalization-profile.v1",
        conformanceTestVectorSetDigest: B,
        normalizationSpec: "raw-bytes-exact.v1",
        normalizedSha256: A,
        normalizedSizeBytes: 7,
        decoderName: "exact-byte-identity",
        decoderVersion: "1.0.0",
        decoderBinarySha256: C,
        formatTag: "spz",
        exactBinaryReason: "no-approved-deterministic-decoder-use-exact-versioned-bytes",
      },
      normalizationPolicy: {
        detectedSourceFormat: "sog",
        requiredNormalizationSpec: "raw-bytes-exact.v1",
      },
      captureOperatorAttestationId: "10000000-0000-4000-8000-000000000098",
      sourceCustodianAttestationId: "10000000-0000-4000-8000-000000000099",
    }).success).toBe(false);
  });
});

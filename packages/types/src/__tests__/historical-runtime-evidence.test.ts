import { describe, expect, it } from "vitest";
import {
  HISTORICAL_RUNTIME_MAX_EVIDENCE_OBJECT_BYTES,
  HISTORICAL_RUNTIME_EXECUTION_V2_PAYLOAD_TYPE,
  HISTORICAL_RUNTIME_ROLE_ATTESTATION_PAYLOAD_TYPE,
  HistoricalRuntimeAuthoritySnapshotSchema,
  HistoricalRuntimeCaptureContentIdentityPredicateSchema,
  HistoricalRuntimeDerivationEvidenceSchema,
  HistoricalRuntimeExecutionV2ReceiptSchema,
  HistoricalRuntimeExecutionV2SubjectSchema,
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
  HistoricalRuntimeTwinReleaseAuthoritySchema,
  HistoricalRuntimeVerifiedTwinReleaseAuthoritySchema,
  createHistoricalRuntimeRoleAttestationSigningPayload,
  createHistoricalRuntimeExecutionV2SigningPayload,
  historicalRuntimeAuthoritySnapshotDigest,
  historicalRuntimeCaptureContentSubjectDigest,
  historicalRuntimeConversionRecipeDigest,
  historicalRuntimeDerivationEvidenceDigest,
  historicalRuntimeDerivationMembersDigest,
  historicalRuntimeExecutionV2PredicateDigest,
  historicalRuntimeExecutionV2ReceiptDigest,
  historicalRuntimeExecutionV2SubjectDigest,
  historicalRuntimeExactObjectReceiptDigest,
  historicalRuntimeObjectActorAuthorityDigest,
  historicalRuntimeProviderCapabilityDigest,
  historicalRuntimeReviewedProfileActorMapDigest,
  historicalRuntimeReviewedProfileEvidenceDigest,
  historicalRuntimeReviewedProfileMembersDigest,
  historicalRuntimeReviewedProfileSubjectDigest,
  historicalRuntimeRoleAttestationDigest,
  historicalRuntimeRoleAttestationSubjectDigest,
  historicalRuntimeRoomScopeBasisDigest,
  historicalRuntimeSceneAuthorityCoverageDigest,
  historicalRuntimeSceneAuthorityReceiptDigest,
  historicalRuntimeSceneAuthoritySubjectDigest,
  historicalRuntimeSourceReceiptSetDigest,
  historicalRuntimeTwinReleaseAuthorityDigest,
  historicalRuntimeTwinReleaseVerificationReceiptDigest,
  historicalRuntimeVerifiedTwinReleaseAuthorityDigest,
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

function objectActorAuthority(
  actorId: string,
  authorityRole: "object_custodian" | "object_observer" | "anonymous_denial_prober",
  snapshottedAt = "2026-08-20T09:31:00.000Z",
) {
  const material = {
    schemaVersion: "historical-runtime-object-actor-authority.v1",
    actorId,
    authorityRole,
    environmentId: "10000000-0000-4000-8000-000000000090",
    environmentMode: "test",
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    platformRole: "none",
    userRole: "staff",
    userVenueId: VENUE_ID,
    workspaceMembership: {
      state: "active",
      membershipId: `30000000-0000-4000-8000-${actorId.slice(-12)}`,
      workspaceId: "30000000-0000-4000-8000-000000000099",
      userId: actorId,
      workspaceRole: "staff",
      venueRole: "staff",
      membershipStatus: "active",
      membershipUpdatedAt: "2026-08-20T09:00:00.000Z",
      membershipVersionDigest: A,
    },
    snapshottedAt,
  } as const;
  return {
    ...material,
    authorityDigest: historicalRuntimeObjectActorAuthorityDigest(material),
  };
}

function exactReceipt(overrides: Record<string, unknown> = {}) {
  const denialOverrides =
    overrides["anonymousAccessDenial"] as Record<string, unknown> | undefined;
  const probedAt = typeof denialOverrides?.["probedAt"] === "string"
    ? denialOverrides["probedAt"]
    : "2026-08-20T09:31:00.000Z";
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
    schemaVersion: "historical-runtime-anonymous-access-denial.v2",
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
    safeRangeGet: {
      requestMethod: "GET",
      rangeHeader: "bytes=0-0",
      requestDigest: C,
      responseDigest: F,
      statusCode: 403,
      denialClass: "access_forbidden",
      redirectCount: 0,
    },
    probedBy: ACTORS[2],
    proberAuthority: objectActorAuthority(
      ACTORS[2]!,
      "anonymous_denial_prober",
      probedAt,
    ),
    probedAt,
    expiresAt: "2026-08-21T09:31:00.000Z",
    ...denialOverrides,
  };
  const material = {
    schemaVersion: "historical-runtime-exact-object-receipt.v2",
    receiptId: "10000000-0000-4000-8000-000000000001",
    object,
    custodianActorId: ACTORS[0],
    custodianAuthority: objectActorAuthority(ACTORS[0]!, "object_custodian", probedAt),
    observedByActorId: ACTORS[1],
    observedByAuthority: objectActorAuthority(ACTORS[1]!, "object_observer", probedAt),
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
    schemaVersion: "historical-runtime-provider-capability.v2",
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
    anonymousAccessProbeEquivalence: {
      headRequestMethod: "HEAD",
      headRequestDigest: C,
      headResponseDigest: D,
      headStatusCode: 403,
      headRedirectCount: 0,
      getRequestMethod: "GET",
      getRangeHeader: "bytes=0-0",
      getRequestDigest: E,
      getResponseDigest: F,
      getStatusCode: 403,
      getRedirectCount: 0,
      denialClass: "access_forbidden",
    },
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
    captureContentSubjectDigest: E,
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
  const roomScopeBasis = {
    schemaVersion: "historical-runtime-room-scope-basis.v1",
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    runtimePackageId: "10000000-0000-4000-8000-000000000041",
    runtimePackageContentDigest: A,
    runtimeManifestDigest: B,
    presentationAdmissionId: "10000000-0000-4000-8000-000000000042",
    presentationAdmissionDigest: C,
    derivationId: "10000000-0000-4000-8000-000000000066",
    derivationEvidenceDigest: F,
    transformReviewId: "10000000-0000-4000-8000-000000000043",
    transformReviewDigest: D,
    twinReleaseId: "10000000-0000-4000-8000-000000000044",
    twinReleaseManifestDigest: E,
    sceneArtifactRowId: "10000000-0000-4000-8000-000000000047",
    sceneArtifactDigest: F,
  } as const;
  return {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    runtimePackageId: "10000000-0000-4000-8000-000000000041",
    runtimePackageContentDigest: A,
    runtimeManifestDigest: B,
    presentationAdmissionId: "10000000-0000-4000-8000-000000000042",
    presentationAdmissionDigest: C,
    derivationId: "10000000-0000-4000-8000-000000000066",
    derivationEvidenceDigest: F,
    transformReviewId: "10000000-0000-4000-8000-000000000043",
    transformReviewDigest: D,
    twinReleaseId: "10000000-0000-4000-8000-000000000044",
    twinReleaseManifestDigest: E,
    roomScopeBasis,
    roomScopeBasisDigest: historicalRuntimeRoomScopeBasisDigest(roomScopeBasis),
    coverageDecision: "whole_room_and_all_runtime_members_covered",
    wholeVenueRegionIds,
    orderedMembers: [{
      memberIndex: 0,
      assetVersionId: "10000000-0000-4000-8000-000000000045",
      derivationOutputReceiptId: "10000000-0000-4000-8000-000000000067",
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
    derivationExpiresAt: "2026-08-22T10:00:00.000Z",
    transformReviewExpiresAt: "2026-08-22T10:00:00.000Z",
    twinReleaseAuthorityReceiptId: "10000000-0000-4000-8000-000000000049",
    twinReleaseAuthorityDigest: E,
    twinReleaseDigest: D,
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

  it("rejects stale reads and non-independent receipt actors", () => {
    const stale = exactReceipt({ readAt: "2026-08-20T09:25:59.999Z" });
    const duplicateActor = exactReceipt({ observedByActorId: ACTORS[0] });
    const base = exactReceipt();
    const mismatchedSafeGet = {
      ...base,
      anonymousAccessDenial: {
        ...base.anonymousAccessDenial,
        safeRangeGet: {
          requestMethod: "GET",
          rangeHeader: "bytes=0-0",
          requestDigest: A,
          responseDigest: F,
          statusCode: 404,
          denialClass: "concealed_existing_object",
          redirectCount: 0,
        },
      },
    };
    expect(HistoricalRuntimeExactObjectReceiptSchema.safeParse(stale).success).toBe(false);
    expect(HistoricalRuntimeExactObjectReceiptSchema.safeParse(duplicateActor).success)
      .toBe(false);
    expect(HistoricalRuntimeExactObjectReceiptSchema.safeParse(mismatchedSafeGet).success)
      .toBe(false);
  });

  it("requires equivalent anonymous HEAD and GET provider probes", () => {
    const mismatched = providerCapability({
      anonymousAccessProbeEquivalence: {
        headRequestMethod: "HEAD",
        headRequestDigest: C,
        headResponseDigest: D,
        headStatusCode: 403,
        headRedirectCount: 0,
        getRequestMethod: "GET",
        getRangeHeader: "bytes=0-0",
        getRequestDigest: E,
        getResponseDigest: F,
        getStatusCode: 404,
        getRedirectCount: 0,
        denialClass: "access_forbidden",
      },
    });
    const duplicateRequest = providerCapability({
      anonymousAccessProbeEquivalence: {
        ...providerCapability().anonymousAccessProbeEquivalence,
        getRequestDigest: C,
      },
    });
    expect(HistoricalRuntimeProviderCapabilitySchema.safeParse(mismatched).success)
      .toBe(false);
    expect(HistoricalRuntimeProviderCapabilitySchema.safeParse(duplicateRequest).success)
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

  it("requires a direct-camera bundle to have an exact private raw root", () => {
    const receipt = HistoricalRuntimeExactObjectReceiptSchema.parse(exactReceipt({
      object: {
        fileName: "direct-camera.raw",
        mimeType: "application/octet-stream",
        sizeBytes: 2_048,
      },
    }));
    const material = {
      schemaVersion: "historical-runtime-source-receipt-set.v1",
      receiptSetId: "10000000-0000-4000-8000-000000000004",
      lineageStartKind: "direct_camera_capture_bundle",
      ancestorState: "exact_private_receipt",
      unavailableAncestorAttestationId: null,
      unavailableAncestorAttestationDigest: null,
      rootComponentIndex: 0,
      members: [{
        componentIndex: 0,
        role: "raw_capture",
        relativePath: "direct-camera.raw",
        receipt,
      }],
    } as const;
    expect(HistoricalRuntimeSourceReceiptSetSchema.safeParse({
      ...material,
      receiptSetDigest: historicalRuntimeSourceReceiptSetDigest(material),
    }).success).toBe(true);

    const unavailable = {
      ...material,
      ancestorState: "owner_attested_unavailable_ancestor" as const,
      unavailableAncestorAttestationId: "10000000-0000-4000-8000-000000000005",
      unavailableAncestorAttestationDigest: A,
    };
    expect(HistoricalRuntimeSourceReceiptSetSchema.safeParse({
      ...unavailable,
      receiptSetDigest: historicalRuntimeSourceReceiptSetDigest(unavailable),
    }).success).toBe(false);
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
      conversionRecipeDigest: historicalRuntimeConversionRecipeDigest({
        conversionTool: "synthetic-tool",
        conversionVersion: "1.0.0",
        conversionBinarySha256: D,
        conversionCommandSha256: E,
        conversionParametersDigest: F,
        conversionEnvironmentDigest: A,
      }),
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
    const coverage = sceneCoverage();
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
      derivationExpiresAt: "2026-08-22T10:00:00.000Z",
      transformReviewExpiresAt: "2026-08-22T10:00:00.000Z",
      twinReleaseAuthorityReceiptId: "10000000-0000-4000-8000-000000000049",
      twinReleaseAuthorityDigest: E,
      twinReleaseDigest: D,
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

  it("does not relabel an owner-authorized import as a direct-camera lineage", () => {
    const base = {
      captureRootId: "10000000-0000-4000-8000-000000000096",
      sourceReceiptSetId: "10000000-0000-4000-8000-000000000097",
      captureClass: "owner_authorized_existing_capture",
      lineageStartKind: "direct_camera_capture_bundle",
      ancestorState: "exact_private_receipt",
      rootComponentIndex: 0,
      sourceObjects: [{
        componentIndex: 0,
        role: "raw_capture",
        providerProfile: "local_fixture",
        storageKey: "fixtures/direct-camera.raw",
        relativePath: "direct-camera.raw",
        fileName: "direct-camera.raw",
        mimeType: "application/octet-stream",
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
        formatTag: "sog",
        exactBinaryReason: "no-approved-deterministic-decoder-use-exact-versioned-bytes",
      },
      normalizationPolicy: {
        detectedSourceFormat: "sog",
        requiredNormalizationSpec: "raw-bytes-exact.v1",
      },
      captureOperatorAttestationId: "10000000-0000-4000-8000-000000000098",
      sourceCustodianAttestationId: "10000000-0000-4000-8000-000000000099",
    } as const;
    expect(PrepareHistoricalRuntimeCaptureContentSubjectSchema.safeParse(base).success)
      .toBe(false);
    expect(PrepareHistoricalRuntimeCaptureContentSubjectSchema.safeParse({
      ...base,
      captureClass: "venue_operator_direct_camera",
    }).success).toBe(true);
  });

  it("binds every legacy twin review leaf in the explicitly test-only wrapper", () => {
    const authoritySnapshotMaterial = {
      authenticationSource: "local_test_fixture",
      platformRole: "admin",
      userRole: "admin",
      userVenueId: null,
      venueId: VENUE_ID,
      workspaceMembership: {
        state: "not_applicable",
        reason: "platform_authority",
      },
      snapshottedAt: "2026-08-20T09:03:00.000Z",
    } as const;
    const authoritySnapshot = HistoricalRuntimeAuthoritySnapshotSchema.parse({
      ...authoritySnapshotMaterial,
      authorityDigest: historicalRuntimeAuthoritySnapshotDigest(
        authoritySnapshotMaterial,
      ),
    });
    const material = {
      schemaVersion: "historical-runtime-twin-release-authority.v1",
      authorityId: "10000000-0000-4000-8000-000000000114",
      sceneValidationId: "10000000-0000-4000-8000-000000000115",
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      releaseId: "10000000-0000-4000-8000-000000000116",
      releaseKind: "venue_twin_v1",
      releaseDigest: A,
      releaseManifestSha256: B,
      releaseCreatedBy: ACTORS[0],
      releaseCreatedAt: "2026-08-20T09:00:00.000Z",
      releaseReviewId: "10000000-0000-4000-8000-000000000117",
      releaseQaReportDigest: C,
      releaseReviewDigest: D,
      releaseReviewerActorId: ACTORS[1],
      releaseReviewerAuthority: "platform_admin",
      releaseReviewDecision: "approved",
      releaseTargetExposure: "expert_review",
      releaseReviewSequence: 1,
      releaseSupersedesReviewId: null,
      releaseReviewedAt: "2026-08-20T09:01:00.000Z",
      releaseAttestationId: "10000000-0000-4000-8000-000000000118",
      releaseAttestationEnvelopeSha256: E,
      releaseAttestationVerifiedBy: ACTORS[2],
      releaseAttestationVerifiedAt: "2026-08-20T09:02:00.000Z",
      authoritySnapshotId: "10000000-0000-4000-8000-000000000119",
      authoritySnapshot,
      approvedByActorId: ACTORS[3],
      approvedAt: "2026-08-20T09:04:00.000Z",
      expiresAt: "2026-09-19T09:04:00.000Z",
    } as const;
    const valid = {
      ...material,
      twinReleaseAuthorityDigest:
        historicalRuntimeTwinReleaseAuthorityDigest(material),
    };
    expect(HistoricalRuntimeTwinReleaseAuthoritySchema.safeParse(valid).success)
      .toBe(true);
    expect(HistoricalRuntimeTwinReleaseAuthoritySchema.safeParse({
      ...valid,
      releaseReviewDigest: F,
    }).success).toBe(false);
  });

  it("binds production twin authority to exact private DSSE bytes, current key, latest review, and an independent approval", () => {
    const releaseId = "10000000-0000-4000-8000-000000000120";
    const reviewId = "10000000-0000-4000-8000-000000000121";
    const keyId = "venviewer-twin-release-2026-q3";
    const statement = {
      _type: "https://in-toto.io/Statement/v1",
      subject: [{
        name: `reconstruction-release/trades-hall/${A}`,
        digest: { sha256: A },
      }],
      predicateType: "https://venviewer.com/attestations/reconstruction-release/v1",
      predicate: {
        schemaVersion: "venviewer.reconstruction-attestation-predicate.v1",
        venueSlug: "trades-hall",
        releaseKind: "venue_twin_v1",
        releaseId,
        releaseDigest: A,
        sourceManifestSha256: B,
        releaseManifestSha256: C,
        qaReportDigest: D,
        reviewId,
        reviewDigest: E,
        reviewedAt: "2026-08-20T09:01:00.000Z",
        reviewerUserId: ACTORS[1],
        decision: "approved",
        targetExposure: "public",
        visualEvidence: [{
          label: "Grand Hall overview",
          objectKey: "releases/trades-hall/grand-hall.png",
          sha256: F,
        }],
        transformArtifactRef: {
          artifactId: "grand-hall-transform",
          artifactDigest: B,
        },
        sceneAuthorityMapRef: {
          artifactId: "grand-hall-scene-map",
          artifactDigest: C,
        },
      },
    } as const;
    const payloadUtf8 = JSON.stringify(statement);
    const envelope = {
      payloadType: "application/vnd.in-toto+json",
      payload: Buffer.from(payloadUtf8, "utf8").toString("base64"),
      signatures: [{
        keyid: keyId,
        sig: Buffer.alloc(64, 1).toString("base64"),
      }],
    } as const;
    const envelopeUtf8 = JSON.stringify(envelope);
    const envelopeSha256 = sha256Hex(envelopeUtf8);
    const payloadSha256 = sha256Hex(payloadUtf8);
    const envelopeObjectReceipt = exactReceipt({
      object: {
        providerProfile: "runtime_private",
        providerKind: "s3",
        versionKind: "s3_version_id",
        storageVersion: "release-envelope-version-1",
        fileName: "release.dsse.json",
        mimeType: "application/vnd.dsse.envelope+json",
        sha256: envelopeSha256,
        sizeBytes: Buffer.byteLength(envelopeUtf8, "utf8"),
      },
    });
    const verificationReceiptMaterial = {
      schemaVersion: "historical-runtime-twin-release-verification-receipt.v1",
      verificationBoundary: "ed25519_dsse_verified_by_service_v1",
      verifiedByDatabasePrincipal: "omnitwin_historical_evidence_verifier",
      envelopeSha256,
      payloadSha256,
      signingKeyAuthorityId: "10000000-0000-4000-8000-000000000125",
      keyId,
      publicKeyFingerprint: F,
      verifiedAt: "2026-08-20T09:32:00.000Z",
    } as const;
    const verificationReceipt = {
      ...verificationReceiptMaterial,
      verificationReceiptDigest:
        historicalRuntimeTwinReleaseVerificationReceiptDigest(
          verificationReceiptMaterial,
        ),
    };
    const material = {
      schemaVersion: "historical-runtime-verified-twin-release-authority.v1",
      authorityId: "10000000-0000-4000-8000-000000000122",
      sceneValidationId: "10000000-0000-4000-8000-000000000123",
      venueId: VENUE_ID,
      venueSlug: "trades-hall",
      spaceId: SPACE_ID,
      spaceSlug: "grand-hall",
      releaseId,
      releaseKind: "venue_twin_v1",
      releaseDigest: A,
      sourceManifestSha256: B,
      releaseManifestSha256: C,
      releaseCreatedBy: ACTORS[0],
      releaseCreatedAt: "2026-08-20T09:00:00.000Z",
      releaseReviewId: reviewId,
      releaseQaReportDigest: D,
      releaseReviewDigest: E,
      releaseReviewerActorId: ACTORS[1],
      releaseReviewerAuthority: "platform_admin",
      releaseReviewDecision: "approved",
      releaseTargetExposure: "public",
      releaseReviewSequence: 1,
      releaseSupersedesReviewId: null,
      releaseReviewedAt: "2026-08-20T09:01:00.000Z",
      releaseAttestationId: "10000000-0000-4000-8000-000000000124",
      legacyAttestationEnvelopeSha256: envelopeSha256,
      legacyAttestationObjectKeySha256:
        envelopeObjectReceipt.object.storageKeySha256,
      legacyAttestationVerifiedBy: ACTORS[2],
      legacyAttestationVerifiedAt: "2026-08-20T09:02:00.000Z",
      envelopeObjectReceipt,
      envelope,
      envelopeUtf8,
      envelopeSha256,
      envelopeByteLength: String(Buffer.byteLength(envelopeUtf8, "utf8")),
      payloadType: "application/vnd.in-toto+json",
      payloadUtf8,
      payloadSha256,
      payloadByteLength: String(Buffer.byteLength(payloadUtf8, "utf8")),
      statement,
      signingKeyAuthorityId: verificationReceiptMaterial.signingKeyAuthorityId,
      keyPolicyId: "10000000-0000-4000-8000-000000000126",
      keyPurpose: "historical_runtime_twin_release_attestation",
      keyPolicyDigest: B,
      keyId,
      publicKeyFingerprint: F,
      keyExpiresAt: "2026-09-19T09:32:00.000Z",
      verificationReceipt,
      approvalAuthority: {
        actionAuthoritySnapshotId: "10000000-0000-4000-8000-000000000127",
        actionKind: "twin_release_authority_approval",
        actionId: "10000000-0000-4000-8000-000000000128",
        actionParametersDigest: C,
        actorId: ACTORS[3],
        authorityRole: "twin_release_approver",
        authorityDigest: D,
        snapshottedAt: "2026-08-20T09:31:30.000Z",
        expiresAt: "2026-08-20T09:36:30.000Z",
      },
      approvedAt: "2026-08-20T09:32:00.000Z",
      expiresAt: "2026-08-21T09:00:00.000Z",
    } as const;
    const valid = {
      ...material,
      twinReleaseAuthorityDigest:
        historicalRuntimeVerifiedTwinReleaseAuthorityDigest(material),
    };
    expect(
      HistoricalRuntimeVerifiedTwinReleaseAuthoritySchema.safeParse(valid).success,
    ).toBe(true);
    expect(HistoricalRuntimeVerifiedTwinReleaseAuthoritySchema.safeParse({
      ...valid,
      envelopeUtf8: `${envelopeUtf8} `,
    }).success).toBe(false);
    expect(HistoricalRuntimeVerifiedTwinReleaseAuthoritySchema.safeParse({
      ...valid,
      keyId: "unrelated-release-key",
    }).success).toBe(false);
    const wrongStorageMaterial = {
      ...material,
      legacyAttestationObjectKeySha256: A,
    };
    expect(HistoricalRuntimeVerifiedTwinReleaseAuthoritySchema.safeParse({
      ...wrongStorageMaterial,
      twinReleaseAuthorityDigest:
        historicalRuntimeVerifiedTwinReleaseAuthorityDigest(wrongStorageMaterial),
    }).success).toBe(false);
    const sameActorMaterial = {
      ...material,
      approvalAuthority: {
        ...material.approvalAuthority,
        actorId: material.releaseReviewerActorId,
      },
    };
    expect(HistoricalRuntimeVerifiedTwinReleaseAuthoritySchema.safeParse({
      ...sameActorMaterial,
      twinReleaseAuthorityDigest:
        historicalRuntimeVerifiedTwinReleaseAuthorityDigest(sameActorMaterial),
    }).success).toBe(false);
  });

  it("binds an execution V2 subject, reviewer, canonical statement, and raw DSSE receipt", () => {
    const subjectMaterial = {
      schemaVersion: "historical-runtime-execution-activation-subject.v2",
      activationId: "10000000-0000-4000-8000-000000000101",
      environmentId: "10000000-0000-4000-8000-000000000102",
      environmentMode: "test",
      environmentDigest: A,
      scopeEpochId: "10000000-0000-4000-8000-000000000103",
      eventId: "10000000-0000-4000-8000-000000000104",
      phaseId: "10000000-0000-4000-8000-000000000105",
      configurationId: "10000000-0000-4000-8000-000000000106",
      canonicalSnapshotId: "10000000-0000-4000-8000-000000000107",
      snapshotHash: B,
      proofDigest: C,
      tenantBoundary: "venue_id_v1",
      tenantId: VENUE_ID,
      venueId: VENUE_ID,
      venueSlug: "trades-hall",
      spaceId: SPACE_ID,
      spaceSlug: "grand-hall",
      reviewedProfileEvidenceId: "10000000-0000-4000-8000-000000000108",
      reviewedProfileSubjectDigest: D,
      reviewedProfileEvidenceDigest: E,
      reviewedProfileFinalReviewerActorId: ACTORS[17],
      reviewedProfileExpiresAt: "2026-08-20T12:00:00.000Z",
      requestedBy: ACTORS[18],
      requesterAuthority: {
        state: "active_workspace_membership",
        platformRole: "none",
        userRole: "staff",
        userVenueId: VENUE_ID,
        membershipId: "10000000-0000-4000-8000-000000000109",
        workspaceId: "10000000-0000-4000-8000-000000000110",
        workspaceRole: "staff",
        venueRole: "staff",
        membershipUpdatedAt: "2026-08-20T09:59:00.000Z",
      },
      requestedAt: "2026-08-20T10:00:00.000Z",
      expiresAt: "2026-08-20T11:00:00.000Z",
    } as const;
    const subject = HistoricalRuntimeExecutionV2SubjectSchema.parse({
      ...subjectMaterial,
      executionActivationSubjectDigest:
        historicalRuntimeExecutionV2SubjectDigest(subjectMaterial),
    });
    const predicate = {
      schemaVersion: "historical-runtime-execution-activation.v2",
      activationId: subject.activationId,
      executionActivationSubject: subject,
      executionActivationSubjectDigest: subject.executionActivationSubjectDigest,
      reviewedProfileEvidenceId: subject.reviewedProfileEvidenceId,
      reviewedProfileEvidenceDigest: subject.reviewedProfileEvidenceDigest,
      executionReviewerAttestationId:
        "10000000-0000-4000-8000-000000000111",
      executionReviewerAttestationDigest: F,
      executionReviewerActorId: ACTORS[19],
      keyPolicyId: "10000000-0000-4000-8000-000000000112",
      keyPolicyDigest: A,
      keyId: "execution-test-key",
      signerPublicKeySha256: `sha256:${B}`,
      issuedAt: "2026-08-20T10:05:00.000Z",
      expiresAt: subject.expiresAt,
      nonce: "10000000-0000-4000-8000-000000000113",
    } as const;
    const statement = {
      authority: "execution_authority",
      evidenceKind: "historical_runtime_execution_activation_v2",
      schemaVersion: "historical-runtime-execution-activation-statement.v2",
      subjectName: `historical-runtime-execution-activation/${subject.activationId}`,
      subjectDigest: historicalRuntimeExecutionV2PredicateDigest(predicate),
      predicate,
    } as const;
    const signingPayload = createHistoricalRuntimeExecutionV2SigningPayload(statement);
    const envelopeUtf8 = "{\"payload\":\"fixture\",\"payloadType\":\"" +
      HISTORICAL_RUNTIME_EXECUTION_V2_PAYLOAD_TYPE +
      "\",\"signatures\":[{\"keyid\":\"execution-test-key\",\"sig\":\"fixture\"}]}";
    const rawEvidence = {
      payloadType: HISTORICAL_RUNTIME_EXECUTION_V2_PAYLOAD_TYPE,
      payloadUtf8: signingPayload.payloadUtf8,
      envelopeUtf8,
      payloadSha256: signingPayload.payloadSha256,
      receiptSha256: `sha256:${sha256Hex(
        `venviewer.historical-runtime-execution-activation.v2\n${signingPayload.payloadUtf8}`,
      )}`,
      envelopeSha256: `sha256:${sha256Hex(
        `venviewer.historical-runtime-execution-activation.v2.dsse-envelope\n${envelopeUtf8}`,
      )}`,
      signerPublicKeySha256: predicate.signerPublicKeySha256,
      payloadByteLength: String(new TextEncoder().encode(signingPayload.payloadUtf8).byteLength),
      envelopeByteLength: String(new TextEncoder().encode(envelopeUtf8).byteLength),
      verifiedAt: "2026-08-20T10:06:00.000Z",
    } as const;
    const receiptMaterial = {
      schemaVersion: "historical-runtime-execution-activation-receipt.v2",
      activationId: subject.activationId,
      subject,
      executionActivationSubjectDigest: subject.executionActivationSubjectDigest,
      statement,
      predicateDigest: statement.subjectDigest,
      reviewedProfileEvidenceId: subject.reviewedProfileEvidenceId,
      reviewedProfileEvidenceDigest: subject.reviewedProfileEvidenceDigest,
      executionReviewerAttestationId: predicate.executionReviewerAttestationId,
      executionReviewerAttestationDigest: predicate.executionReviewerAttestationDigest,
      executionReviewerActorId: predicate.executionReviewerActorId,
      rawEvidence,
      issuedAt: predicate.issuedAt,
      verifiedAt: rawEvidence.verifiedAt,
      expiresAt: predicate.expiresAt,
    } as const;
    expect(HistoricalRuntimeExecutionV2ReceiptSchema.safeParse({
      ...receiptMaterial,
      activationDigest: historicalRuntimeExecutionV2ReceiptDigest(receiptMaterial),
    }).success).toBe(true);

    const clientAuthority = {
      ...subjectMaterial.requesterAuthority,
      workspaceRole: "client",
      venueRole: "client",
    } as const;
    const clientSubject = { ...subjectMaterial, requesterAuthority: clientAuthority };
    expect(HistoricalRuntimeExecutionV2SubjectSchema.safeParse({
      ...clientSubject,
      executionActivationSubjectDigest:
        historicalRuntimeExecutionV2SubjectDigest(clientSubject),
    }).success).toBe(false);
  });
});

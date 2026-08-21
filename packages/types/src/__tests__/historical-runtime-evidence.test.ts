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
  HistoricalRuntimeSceneMapVerificationHandleSchema,
  HistoricalRuntimeSceneMapParserReceiptSchema,
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
  historicalRuntimeSceneMapVerificationHandleDigest,
  historicalRuntimeSceneMapParserReceiptDigest,
  historicalRuntimeSceneMemberAuthorityReference,
  historicalRuntimeSceneAuthorityReceiptDigest,
  historicalRuntimeSceneAuthoritySubjectDigest,
  historicalRuntimeSourceReceiptSetDigest,
  historicalRuntimeTwinReleaseAuthorityDigest,
  historicalRuntimeTwinReleaseVerificationReceiptDigest,
  historicalRuntimeVerifiedTwinReleaseAuthorityDigest,
} from "../historical-runtime-evidence.js";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "../canonical-layout-snapshot.js";
import {
  RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
  ReconstructionReleaseManifestSchema,
  computeReconstructionReleaseDigest,
} from "../reconstruction-release.js";
import {
  RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
  ReconstructionSceneAuthorityMapV0Schema,
  computeReconstructionReviewEvidenceArtifactDigest,
  resolveReconstructionSceneAuthorityCoverage,
} from "../reconstruction-review-evidence.js";
import { TwinManifestSchema } from "../twin.js";
import {
  HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_DIGEST,
} from "../historical-runtime-scene-map-parser-policy.js";

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
  environmentMode: "production" | "test" = "test",
) {
  const material = {
    schemaVersion: "historical-runtime-object-actor-authority.v1",
    actorId,
    authorityRole,
    environmentId: "10000000-0000-4000-8000-000000000090",
    environmentMode,
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

function productionExactReceipt(input: {
  readonly receiptId: string;
  readonly capabilityReceiptId: string;
  readonly storageKeySha256: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}) {
  const probedAt = "2026-08-20T09:31:00.000Z";
  return exactReceipt({
    receiptId: input.receiptId,
    custodianAuthority: objectActorAuthority(
      ACTORS[0]!,
      "object_custodian",
      probedAt,
      "production",
    ),
    observedByAuthority: objectActorAuthority(
      ACTORS[1]!,
      "object_observer",
      probedAt,
      "production",
    ),
    anonymousAccessDenial: {
      probedAt,
      proberAuthority: objectActorAuthority(
        ACTORS[2]!,
        "anonymous_denial_prober",
        probedAt,
        "production",
      ),
    },
    object: {
      providerProfile: "runtime_private",
      providerKind: "s3",
      providerAccountSha256: A,
      endpointAuthoritySha256: B,
      privateBucketSha256: C,
      storageKeySha256: input.storageKeySha256,
      versionKind: "s3_version_id",
      storageVersion: `version-${input.receiptId.slice(-4)}`,
      immutabilityCapabilityReceiptId: input.capabilityReceiptId,
      immutabilityCapabilityDigest: E,
      storageEtag: `"etag-${input.receiptId.slice(-4)}"`,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
    },
  });
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

function validSceneMapVerificationReceipt() {
  const memberBase = {
    memberIndex: 0,
    assetVersionId: "10000000-0000-4000-8000-000000000045",
    derivationOutputReceiptId: "10000000-0000-4000-8000-000000000067",
    derivationMemberReceiptDigest: A,
    derivationMemberStorageKeySha256: B,
    derivationMemberReceiptExpiresAt: "2026-08-21T09:31:00.000Z",
    fileName: "grand-hall-layer-0.sog",
    fileExt: ".sog" as const,
    mimeType: "application/vnd.venviewer.sog",
    sha256: C,
    sizeBytes: 7,
    admissionRightsEvidenceRowId: "10000000-0000-4000-8000-000000000068",
    admissionRightsEvidenceDigest: D,
    admissionRightsDecision: "approved" as const,
    admissionRightsReviewedBy: ACTORS[7]!,
    admissionRightsReviewedAt: "2026-08-20T09:20:00.000Z",
  };
  const authorityReference = historicalRuntimeSceneMemberAuthorityReference({
    memberIndex: memberBase.memberIndex,
    assetVersionId: memberBase.assetVersionId,
    fileName: memberBase.fileName,
    fileExt: memberBase.fileExt,
    mimeType: memberBase.mimeType,
    sha256: memberBase.sha256,
    sizeBytes: memberBase.sizeBytes,
    storageKeySha256: memberBase.derivationMemberStorageKeySha256,
  });
  const orderedMembers = [{
    ...memberBase,
    authorityReference,
    coveredRegionIds: ["region-1"],
  }];
  const sourceTwinManifest = TwinManifestSchema.parse({
    schema: "twin/0",
    venueSlug: "trades-hall",
    name: "Trades Hall exact room source",
    capture: { kind: "matterport-e57", scanCount: 1 },
    tier: "planning-grade-5cm",
    upAxis: "z",
    units: "m",
    imagery: "equirect",
    faces: ["front", "back", "left", "right", "up", "down"],
    lods: [512, 4096, 8192],
    generatedAt: "2026-08-20T08:00:00.000Z",
    nodes: [{
      id: "scan_000",
      index: 0,
      pose: { q: [1, 0, 0, 0], t: [0, 0, 1.5] },
      floor: 0,
      roomSlug: "grand-hall",
    }],
    edges: [],
    entryNodeId: "scan_000",
  });
  const sourceTwinManifestUtf8 = `${JSON.stringify(sourceTwinManifest, null, 2)}\n`;
  const sourceTwinManifestSha256 = sha256Hex(sourceTwinManifestUtf8);
  const releaseFiles = [{
    path: "manifest.json",
    sha256: sourceTwinManifestSha256,
    sizeBytes: Buffer.byteLength(sourceTwinManifestUtf8, "utf8"),
    mimeType: "application/json",
    role: "manifest" as const,
  }, {
    path: "mesh/dollhouse.glb",
    sha256: D,
    sizeBytes: 8,
    mimeType: "model/gltf-binary",
    role: "geometry" as const,
  }];
  const releaseManifest = ReconstructionReleaseManifestSchema.parse({
    schemaVersion: RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
    releaseKind: "venue_twin_v1",
    venueSlug: "trades-hall",
    releaseDigest: computeReconstructionReleaseDigest(releaseFiles),
    sourceManifestSha256: sourceTwinManifestSha256,
    files: releaseFiles,
    fileCount: releaseFiles.length,
    totalBytes: releaseFiles.reduce((total, file) => total + file.sizeBytes, 0),
    generatedAt: "2026-08-20T08:10:00.000Z",
  });
  const releaseManifestUtf8 = `${JSON.stringify(releaseManifest, null, 2)}\n`;
  const releaseManifestSha256 = sha256Hex(releaseManifestUtf8);
  const transformArtifactId = "grand-hall-transform-v1";
  const transformArtifactDigest = E;
  const sceneMap = ReconstructionSceneAuthorityMapV0Schema.parse({
    schemaVersion: RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
    id: "scene-authority-v1",
    venueSlug: "trades-hall",
    generatedAt: "2026-08-20T08:15:00.000Z",
    regions: [{
      id: "region-1",
      label: "Grand Hall",
      scope: { kind: "twin_nodes", nodeIds: ["scan_000"] },
      authorities: {
        geometryAuthority: { kind: "release_file", ref: "mesh/dollhouse.glb" },
        appearanceAuthority: { kind: "runtime_layer", ref: authorityReference },
        lightingAuthority: { kind: "none", ref: null },
        physicsAuthority: { kind: "release_file", ref: "mesh/dollhouse.glb" },
        semanticAuthority: { kind: "release_file", ref: "manifest.json" },
        interactionAuthority: { kind: "release_file", ref: "mesh/dollhouse.glb" },
        exportAuthority: { kind: "release_file", ref: "mesh/dollhouse.glb" },
      },
      truthStatus: "measured",
      confidenceTier: "layout_grade",
      provenanceRefs: [{ refType: "artifact", ref: "evidence/grand-hall", role: "source" }],
      reconstructionStrategy: "matterpak_original",
      transformArtifactRef: {
        artifactId: transformArtifactId,
        artifactDigest: transformArtifactDigest,
      },
    }],
  });
  const sceneMapUtf8 = stableCanonicalJson(CanonicalJsonValueSchema.parse(sceneMap));
  const sceneMapSha256 = sha256Hex(sceneMapUtf8);
  const parsedMapDigest = computeReconstructionReviewEvidenceArtifactDigest(sceneMap);
  const sceneObjectReceipt = productionExactReceipt({
    receiptId: "10000000-0000-4000-8000-000000000071",
    capabilityReceiptId: "10000000-0000-4000-8000-000000000081",
    storageKeySha256: C,
    fileName: "scene-authority.json",
    mimeType: "application/json",
    sha256: sceneMapSha256,
    sizeBytes: Buffer.byteLength(sceneMapUtf8, "utf8"),
  });
  const releaseManifestObjectReceipt = productionExactReceipt({
    receiptId: "10000000-0000-4000-8000-000000000072",
    capabilityReceiptId: "10000000-0000-4000-8000-000000000082",
    storageKeySha256: D,
    fileName: "release-manifest.json",
    mimeType: "application/json",
    sha256: releaseManifestSha256,
    sizeBytes: Buffer.byteLength(releaseManifestUtf8, "utf8"),
  });
  const sourceTwinManifestObjectReceipt = productionExactReceipt({
    receiptId: "10000000-0000-4000-8000-000000000073",
    capabilityReceiptId: "10000000-0000-4000-8000-000000000083",
    storageKeySha256: F,
    fileName: "manifest.json",
    mimeType: "application/json",
    sha256: sourceTwinManifestSha256,
    sizeBytes: Buffer.byteLength(sourceTwinManifestUtf8, "utf8"),
  });
  const coverageProjection = resolveReconstructionSceneAuthorityCoverage({
    map: sceneMap,
    twin: sourceTwinManifest,
    release: releaseManifest,
    selectedTransform: {
      artifactId: transformArtifactId,
      artifactDigest: transformArtifactDigest,
    },
    spaceSlug: "grand-hall",
    rejectBoundsCvf: true,
    runtimeLayers: orderedMembers.map((member) => ({
      authorityReference: member.authorityReference,
    })),
  });
  const verifiedCoverageMaterial = {
    wholeRegionIds: coverageProjection.regionIds,
    expectedTwinNodeIds: coverageProjection.expectedTwinNodeIds,
    coveredTwinNodeIds: coverageProjection.coveredTwinNodeIds,
    orderedRegions: coverageProjection.orderedRegions.map((region) => ({
      regionIndex: String(region.regionIndex),
      regionId: region.regionId,
      coveredTwinNodeIds: region.coveredTwinNodeIds,
    })),
    referencedReleasePaths: coverageProjection.referencedReleasePaths,
    orderedMembers: orderedMembers.map((member) => ({
      memberIndex: String(member.memberIndex),
      assetVersionId: member.assetVersionId,
      derivationOutputReceiptId: member.derivationOutputReceiptId,
      derivationMemberReceiptDigest: member.derivationMemberReceiptDigest,
      derivationMemberStorageKeySha256: member.derivationMemberStorageKeySha256,
      authorityReference: member.authorityReference,
      coveredRegionIds: member.coveredRegionIds,
    })),
  };
  const expiresAt = "2026-08-21T09:31:00.000Z";
  const material = {
    schemaVersion: "historical-runtime-scene-map-parser-receipt.v1",
    verificationReceiptId: "10000000-0000-4000-8000-000000000069",
    sceneValidationId: "10000000-0000-4000-8000-000000000046",
    environmentId: "10000000-0000-4000-8000-000000000090",
    environmentMode: "production",
    environmentDigest: A,
    scopeEpochId: "10000000-0000-4000-8000-000000000091",
    scopeEpochExpiresAt: expiresAt,
    venueId: VENUE_ID,
    venueSlug: "trades-hall",
    spaceId: SPACE_ID,
    spaceSlug: "grand-hall",
    presentationAdmissionId: "10000000-0000-4000-8000-000000000042",
    presentationAdmissionDigest: C,
    presentationAdmissionReviewerAttestationId:
      "10000000-0000-4000-8000-000000000048",
    presentationAdmissionReviewerAttestationDigest: D,
    presentationAdmissionReviewerAttestationExpiresAt: expiresAt,
    runtimePackageId: "10000000-0000-4000-8000-000000000041",
    runtimePackageContentDigest: A,
    runtimeManifestDigest: B,
    admissionMemberCount: 1,
    derivationId: "10000000-0000-4000-8000-000000000066",
    derivationEvidenceDigest: F,
    derivationMembersDigest: E,
    derivationMemberCount: 1,
    derivationExpiresAt: expiresAt,
    transformReviewId: "10000000-0000-4000-8000-000000000043",
    transformReviewDigest: D,
    transformArtifactRowId: "10000000-0000-4000-8000-000000000070",
    transformArtifactId,
    transformArtifactDigest,
    signedTransformArtifactRef: { artifactId: transformArtifactId, artifactDigest: transformArtifactDigest },
    signedSceneAuthorityMapRef: { artifactId: sceneMap.id, artifactDigest: parsedMapDigest },
    transformReviewExpiresAt: expiresAt,
    twinReleaseAuthorityReceiptId: "10000000-0000-4000-8000-000000000049",
    twinReleaseAuthorityDigest: E,
    twinReleaseAuthorityExpiresAt: expiresAt,
    twinReleaseId: "10000000-0000-4000-8000-000000000044",
    twinReleaseDigest: releaseManifest.releaseDigest,
    twinReleaseManifestDigest: releaseManifestSha256,
    authenticatedTwinRelease: {
      payloadType: "application/vnd.in-toto+json",
      keyId: "fixture-ed25519-key",
      publicKeyFingerprint: A,
      envelopeSha256: B,
      envelopeByteLength: "512",
      payloadSha256: C,
      payloadByteLength: "384",
      statementSha256: C,
      predicateDigest: D,
    },
    sceneArtifactRowId: "10000000-0000-4000-8000-000000000047",
    sceneArtifactId: sceneMap.id,
    sceneArtifactDigest: parsedMapDigest,
    sceneObjectReceipt,
    sceneProviderCapabilityExpiresAt: expiresAt,
    sceneMap,
    sceneMapUtf8,
    sceneMapSha256,
    sceneMapByteLength: String(Buffer.byteLength(sceneMapUtf8, "utf8")),
    parsedMapDigest,
    releaseManifestObjectReceipt,
    releaseManifestProviderCapabilityExpiresAt: expiresAt,
    releaseManifest,
    releaseManifestUtf8,
    releaseManifestSha256,
    releaseManifestByteLength: String(Buffer.byteLength(releaseManifestUtf8, "utf8")),
    sourceTwinManifestReleaseObjectPath: "manifest.json",
    sourceTwinManifestObjectReceipt,
    sourceTwinManifestProviderCapabilityExpiresAt: expiresAt,
    sourceTwinManifest,
    sourceTwinManifestUtf8,
    sourceTwinManifestSha256,
    sourceTwinManifestByteLength: String(Buffer.byteLength(sourceTwinManifestUtf8, "utf8")),
    roomProjection: { ...coverageProjection.roomProjection, spaceSlug: "grand-hall" },
    wholeRegionIds: coverageProjection.regionIds,
    expectedTwinNodeIds: coverageProjection.expectedTwinNodeIds,
    coveredTwinNodeIds: coverageProjection.coveredTwinNodeIds,
    orderedRegions: coverageProjection.orderedRegions,
    referencedReleasePaths: coverageProjection.referencedReleasePaths,
    expandedRegionNodeReferenceCount: String(
      coverageProjection.expandedRegionNodeReferenceCount,
    ),
    normalizedProjectionByteLength: String(
      coverageProjection.normalizedProjectionByteLength,
    ),
    orderedMembers,
    verifiedCoverageDigest: sha256Hex(
      `venviewer.historical-runtime-verified-scene-map-coverage.v1\n${stableCanonicalJson(
        CanonicalJsonValueSchema.parse(verifiedCoverageMaterial),
      )}`,
    ),
    parserVersion: "venviewer.scene-map-private-byte-verifier.v1",
    parserPolicyDigest: HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_DIGEST,
    parserImplementationManifestDigest: A,
    verificationProfile: "production_runtime",
    parserRuntimeIdentityId: "10000000-0000-4000-8000-000000000092",
    parserRuntimeIdentityDigest: B,
    parserRuntimeIdentityEffectiveAt: "2026-08-20T09:44:00.000Z",
    parserRuntimeIdentityExpiresAt: expiresAt,
    parserRuntimeExecutableArtifactDigest: C,
    parserRuntimeDeploymentImageDigest: D,
    parserRuntimeVerifierCapabilityPrincipal:
      "omnitwin_historical_evidence_verifier",
    parserRuntimeSessionPrincipalSha256: E,
    verificationBoundary: "exact_private_scene_map_release_inventory_v1",
    verifiedByDatabasePrincipal: "omnitwin_historical_evidence_verifier",
    verifiedAt: "2026-08-20T09:45:00.000Z",
    expiresAt,
  } as const;
  const receipt = HistoricalRuntimeSceneMapParserReceiptSchema.parse({
    ...material,
    sceneMapVerificationReceiptDigest:
      historicalRuntimeSceneMapParserReceiptDigest(material),
  });
  const handleMaterial = {
    schemaVersion: "historical-runtime-scene-map-verification-handle.v1",
    sceneMapVerificationReceiptId:
      "10000000-0000-4000-8000-000000000093",
    parserReceiptId: receipt.verificationReceiptId,
    sceneValidationId: receipt.sceneValidationId,
    parserReceiptDigest: receipt.sceneMapVerificationReceiptDigest,
    verificationProfile: receipt.verificationProfile,
    parserPolicyDigest: receipt.parserPolicyDigest,
    parserImplementationManifestDigest:
      receipt.parserImplementationManifestDigest,
    parserRuntimeIdentityId: receipt.parserRuntimeIdentityId,
    parserRuntimeIdentityDigest: receipt.parserRuntimeIdentityDigest,
    parserRuntimeIdentityEffectiveAt:
      receipt.parserRuntimeIdentityEffectiveAt,
    parserRuntimeIdentityExpiresAt: receipt.parserRuntimeIdentityExpiresAt,
    parserRuntimeExecutableArtifactDigest:
      receipt.parserRuntimeExecutableArtifactDigest,
    parserRuntimeDeploymentImageDigest:
      receipt.parserRuntimeDeploymentImageDigest,
    parserRuntimeVerifierCapabilityPrincipal:
      receipt.parserRuntimeVerifierCapabilityPrincipal,
    parserRuntimeSessionPrincipalSha256:
      receipt.parserRuntimeSessionPrincipalSha256,
    presentationAdmissionId: receipt.presentationAdmissionId,
    presentationAdmissionReviewerAttestationId:
      receipt.presentationAdmissionReviewerAttestationId,
    presentationAdmissionReviewerAttestationDigest:
      receipt.presentationAdmissionReviewerAttestationDigest,
    presentationAdmissionReviewerAttestationExpiresAt:
      receipt.presentationAdmissionReviewerAttestationExpiresAt,
    derivationId: receipt.derivationId,
    derivationExpiresAt: receipt.derivationExpiresAt,
    transformReviewId: receipt.transformReviewId,
    transformReviewExpiresAt: receipt.transformReviewExpiresAt,
    twinReleaseAuthorityReceiptId: receipt.twinReleaseAuthorityReceiptId,
    twinReleaseAuthorityDigest: receipt.twinReleaseAuthorityDigest,
    twinReleaseAuthorityExpiresAt: receipt.twinReleaseAuthorityExpiresAt,
    twinReleaseDigest: receipt.twinReleaseDigest,
    sceneArtifactRowId: receipt.sceneArtifactRowId,
    sceneObjectReceiptId: receipt.sceneObjectReceipt.receiptId,
    sceneObjectReceiptDigest: receipt.sceneObjectReceipt.receiptDigest,
    sceneProviderCapabilityExpiresAt:
      receipt.sceneProviderCapabilityExpiresAt,
    acceptedAt: receipt.verifiedAt,
    expiresAt: receipt.expiresAt,
  } as const;
  const handle = HistoricalRuntimeSceneMapVerificationHandleSchema.parse({
    ...handleMaterial,
    sceneMapVerificationReceiptDigest:
      historicalRuntimeSceneMapVerificationHandleDigest(handleMaterial),
  });
  const roomScopeBasis = {
    schemaVersion: "historical-runtime-room-scope-basis.v1",
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    runtimePackageId: receipt.runtimePackageId,
    runtimePackageContentDigest: receipt.runtimePackageContentDigest,
    runtimeManifestDigest: receipt.runtimeManifestDigest,
    presentationAdmissionId: receipt.presentationAdmissionId,
    presentationAdmissionDigest: receipt.presentationAdmissionDigest,
    derivationId: receipt.derivationId,
    derivationEvidenceDigest: receipt.derivationEvidenceDigest,
    transformReviewId: receipt.transformReviewId,
    transformReviewDigest: receipt.transformReviewDigest,
    twinReleaseId: receipt.twinReleaseId,
    twinReleaseManifestDigest: receipt.twinReleaseManifestDigest,
    sceneArtifactRowId: receipt.sceneArtifactRowId,
    sceneArtifactDigest: receipt.sceneArtifactDigest,
  } as const;
  const coverage = {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    runtimePackageId: receipt.runtimePackageId,
    runtimePackageContentDigest: receipt.runtimePackageContentDigest,
    runtimeManifestDigest: receipt.runtimeManifestDigest,
    presentationAdmissionId: receipt.presentationAdmissionId,
    presentationAdmissionDigest: receipt.presentationAdmissionDigest,
    derivationId: receipt.derivationId,
    derivationEvidenceDigest: receipt.derivationEvidenceDigest,
    transformReviewId: receipt.transformReviewId,
    transformReviewDigest: receipt.transformReviewDigest,
    twinReleaseId: receipt.twinReleaseId,
    twinReleaseManifestDigest: receipt.twinReleaseManifestDigest,
    roomScopeBasis,
    roomScopeBasisDigest: historicalRuntimeRoomScopeBasisDigest(roomScopeBasis),
    coverageDecision: "whole_room_and_all_runtime_members_covered",
    wholeVenueRegionIds: receipt.wholeRegionIds,
    orderedMembers: receipt.orderedMembers.map((member) => ({
      memberIndex: member.memberIndex,
      assetVersionId: member.assetVersionId,
      derivationOutputReceiptId: member.derivationOutputReceiptId,
      derivationMemberReceiptDigest: member.derivationMemberReceiptDigest,
      authorityReference: member.authorityReference,
      coveredRegionIds: member.coveredRegionIds,
    })),
  } as const;
  return { receipt, handle, coverage };
}

function localSceneMapParserEvidence() {
  const production = validSceneMapVerificationReceipt();
  const toLocalReceipt = (
    receipt: typeof production.receipt.sceneObjectReceipt,
  ) => exactReceipt({
    receiptId: receipt.receiptId,
    object: {
      storageKeySha256: receipt.object.storageKeySha256,
      immutabilityCapabilityReceiptId:
        receipt.object.immutabilityCapabilityReceiptId,
      immutabilityCapabilityDigest:
        receipt.object.immutabilityCapabilityDigest,
      fileName: receipt.object.fileName,
      mimeType: receipt.object.mimeType,
      sha256: receipt.object.sha256,
      sizeBytes: receipt.object.sizeBytes,
    },
  });
  const {
    sceneMapVerificationReceiptDigest: _parserDigest,
    ...productionMaterial
  } = production.receipt;
  const localMaterial = {
    ...productionMaterial,
    environmentMode: "test",
    sceneObjectReceipt: toLocalReceipt(production.receipt.sceneObjectReceipt),
    releaseManifestObjectReceipt: toLocalReceipt(
      production.receipt.releaseManifestObjectReceipt,
    ),
    sourceTwinManifestObjectReceipt: toLocalReceipt(
      production.receipt.sourceTwinManifestObjectReceipt,
    ),
    verificationProfile: "local_test_fixture",
    parserRuntimeIdentityId: null,
    parserRuntimeIdentityDigest: null,
    parserRuntimeIdentityEffectiveAt: null,
    parserRuntimeIdentityExpiresAt: null,
    parserRuntimeExecutableArtifactDigest: null,
    parserRuntimeDeploymentImageDigest: null,
    parserRuntimeVerifierCapabilityPrincipal: null,
    parserRuntimeSessionPrincipalSha256: null,
  } as const;
  const receipt = HistoricalRuntimeSceneMapParserReceiptSchema.parse({
    ...localMaterial,
    sceneMapVerificationReceiptDigest:
      historicalRuntimeSceneMapParserReceiptDigest(localMaterial),
  });
  const handleMaterial = {
    schemaVersion: "historical-runtime-scene-map-verification-handle.v1",
    sceneMapVerificationReceiptId: production.handle.sceneMapVerificationReceiptId,
    parserReceiptId: receipt.verificationReceiptId,
    sceneValidationId: receipt.sceneValidationId,
    parserReceiptDigest: receipt.sceneMapVerificationReceiptDigest,
    verificationProfile: receipt.verificationProfile,
    parserPolicyDigest: receipt.parserPolicyDigest,
    parserImplementationManifestDigest:
      receipt.parserImplementationManifestDigest,
    parserRuntimeIdentityId: null,
    parserRuntimeIdentityDigest: null,
    parserRuntimeIdentityEffectiveAt: null,
    parserRuntimeIdentityExpiresAt: null,
    parserRuntimeExecutableArtifactDigest: null,
    parserRuntimeDeploymentImageDigest: null,
    parserRuntimeVerifierCapabilityPrincipal: null,
    parserRuntimeSessionPrincipalSha256: null,
    presentationAdmissionId: receipt.presentationAdmissionId,
    presentationAdmissionReviewerAttestationId:
      receipt.presentationAdmissionReviewerAttestationId,
    presentationAdmissionReviewerAttestationDigest:
      receipt.presentationAdmissionReviewerAttestationDigest,
    presentationAdmissionReviewerAttestationExpiresAt:
      receipt.presentationAdmissionReviewerAttestationExpiresAt,
    derivationId: receipt.derivationId,
    derivationExpiresAt: receipt.derivationExpiresAt,
    transformReviewId: receipt.transformReviewId,
    transformReviewExpiresAt: receipt.transformReviewExpiresAt,
    twinReleaseAuthorityReceiptId: receipt.twinReleaseAuthorityReceiptId,
    twinReleaseAuthorityDigest: receipt.twinReleaseAuthorityDigest,
    twinReleaseAuthorityExpiresAt: receipt.twinReleaseAuthorityExpiresAt,
    twinReleaseDigest: receipt.twinReleaseDigest,
    sceneArtifactRowId: receipt.sceneArtifactRowId,
    sceneObjectReceiptId: receipt.sceneObjectReceipt.receiptId,
    sceneObjectReceiptDigest: receipt.sceneObjectReceipt.receiptDigest,
    sceneProviderCapabilityExpiresAt:
      receipt.sceneProviderCapabilityExpiresAt,
    acceptedAt: receipt.verifiedAt,
    expiresAt: receipt.expiresAt,
  } as const;
  const handle = HistoricalRuntimeSceneMapVerificationHandleSchema.parse({
    ...handleMaterial,
    sceneMapVerificationReceiptDigest:
      historicalRuntimeSceneMapVerificationHandleDigest(handleMaterial),
  });
  return { receipt, handle, coverage: production.coverage };
}

function validSceneSubject(
  evidence = validSceneMapVerificationReceipt(),
) {
  const { receipt, handle, coverage } = evidence;
  const sceneObjectReceipt = receipt.sceneObjectReceipt;
  const material = {
    schemaVersion: "historical-runtime-scene-authority-subject.v1",
    sceneValidationId: "10000000-0000-4000-8000-000000000046",
    sceneArtifactRowId: "10000000-0000-4000-8000-000000000047",
    sceneArtifactId: "scene-authority-v1",
    sceneArtifactDigest: receipt.sceneArtifactDigest,
    sceneRegistryObjectSha256: sceneObjectReceipt.object.sha256,
    sceneRegistryObjectSizeBytes: sceneObjectReceipt.object.sizeBytes,
    sceneObjectReceipt,
    parsedMapDigest: receipt.parsedMapDigest,
    sceneMapVerificationReceiptId: handle.sceneMapVerificationReceiptId,
    sceneMapVerificationReceiptDigest:
      handle.sceneMapVerificationReceiptDigest,
    sceneMapVerificationReceiptExpiresAt: handle.expiresAt,
    sceneMapVerificationReceipt: handle,
    sceneMapParserReceiptId: receipt.verificationReceiptId,
    sceneMapParserReceiptDigest: receipt.sceneMapVerificationReceiptDigest,
    sceneMapParserReceiptExpiresAt: receipt.expiresAt,
    sceneMapVerificationProfile: receipt.verificationProfile,
    sceneMapParserPolicyDigest: receipt.parserPolicyDigest,
    sceneMapParserImplementationManifestDigest:
      receipt.parserImplementationManifestDigest,
    sceneMapParserRuntimeIdentityId: receipt.parserRuntimeIdentityId,
    sceneMapParserRuntimeIdentityDigest: receipt.parserRuntimeIdentityDigest,
    sceneMapParserRuntimeIdentityEffectiveAt:
      receipt.parserRuntimeIdentityEffectiveAt,
    sceneMapParserRuntimeIdentityExpiresAt:
      receipt.parserRuntimeIdentityExpiresAt,
    sceneMapParserRuntimeExecutableArtifactDigest:
      receipt.parserRuntimeExecutableArtifactDigest,
    sceneMapParserRuntimeDeploymentImageDigest:
      receipt.parserRuntimeDeploymentImageDigest,
    sceneMapParserRuntimeVerifierCapabilityPrincipal:
      receipt.parserRuntimeVerifierCapabilityPrincipal,
    sceneMapParserRuntimeSessionPrincipalSha256:
      receipt.parserRuntimeSessionPrincipalSha256,
    coverage,
    coverageDigest: historicalRuntimeSceneAuthorityCoverageDigest(coverage),
    validatedAt: "2026-08-20T10:00:00.000Z",
    presentationAdmissionReviewerAttestationId:
      "10000000-0000-4000-8000-000000000048",
    presentationAdmissionReviewerAttestationDigest: D,
    presentationAdmissionReviewerActorId: ACTORS[6],
    presentationAdmissionReviewerAttestationExpiresAt:
      receipt.presentationAdmissionReviewerAttestationExpiresAt,
    derivationExpiresAt: receipt.derivationExpiresAt,
    transformReviewExpiresAt: receipt.transformReviewExpiresAt,
    twinReleaseAuthorityReceiptId: "10000000-0000-4000-8000-000000000049",
    twinReleaseAuthorityDigest: E,
    twinReleaseDigest: receipt.twinReleaseDigest,
    twinReleaseAuthorityExpiresAt: receipt.twinReleaseAuthorityExpiresAt,
    providerCapabilityReceiptId:
      sceneObjectReceipt.object.immutabilityCapabilityReceiptId,
    providerCapabilityDigest: sceneObjectReceipt.object.immutabilityCapabilityDigest,
    providerCapabilityExpiresAt: receipt.sceneProviderCapabilityExpiresAt,
    authorityExpiresAt: receipt.expiresAt,
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
    const valid = validSceneSubject();
    const { sceneValidationSubjectDigest: _digest, ...validMaterial } = valid;
    const material = {
      ...validMaterial,
      sceneRegistryObjectSha256:
        valid.sceneRegistryObjectSha256 === A ? B : A,
    };
    expect(HistoricalRuntimeSceneAuthoritySubjectSchema.safeParse({
      ...material,
      sceneValidationSubjectDigest: historicalRuntimeSceneAuthoritySubjectDigest(material),
    }).success).toBe(false);
    const parsedMapMaterial = {
      ...validMaterial,
      parsedMapDigest: valid.parsedMapDigest === A ? B : A,
    };
    expect(HistoricalRuntimeSceneAuthoritySubjectSchema.safeParse({
      ...parsedMapMaterial,
      sceneValidationSubjectDigest:
        historicalRuntimeSceneAuthoritySubjectDigest(parsedMapMaterial),
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

  it("accepts the inclusive 90-day reviewed-profile boundary and rejects one millisecond beyond it", () => {
    const reviewedAt = "2026-08-20T11:00:00.000Z";
    const profileAt = (durationMs: number) => {
      const expiresAt = new Date(
        Date.parse(reviewedAt) + durationMs,
      ).toISOString();
      const constituentExpiries = {
        captureClearanceExpiresAt: expiresAt,
        derivationReviewExpiresAt: expiresAt,
        runtimeQaAuthorityExpiresAt: expiresAt,
        transformReviewExpiresAt: expiresAt,
        sceneValidationExpiresAt: expiresAt,
        packageCustodianAttestationExpiresAt: expiresAt,
        admissionReviewerAttestationExpiresAt: expiresAt,
        rightsClearanceExpiresAt: [expiresAt],
      } as const;
      const subjectMaterial = reviewedProfileSubjectMaterial({
        constituentExpiries,
        expiresAt,
      });
      const subject = HistoricalRuntimeReviewedProfileSubjectSchema.parse({
        ...subjectMaterial,
        reviewedProfileSubjectDigest:
          historicalRuntimeReviewedProfileSubjectDigest(subjectMaterial),
      });
      const material = {
        schemaVersion: "historical-runtime-reviewed-profile-evidence.v1",
        subject,
        reviewedProfileSubjectDigest: subject.reviewedProfileSubjectDigest,
        finalReviewerAttestationId:
          "10000000-0000-4000-8000-000000000066",
        finalReviewerAttestationDigest: B,
        finalReviewerActorId: ACTORS[8],
        finalReviewerAttestationExpiresAt: expiresAt,
        reviewedAt,
        expiresAt,
      } as const;
      return {
        ...material,
        reviewedProfileEvidenceDigest:
          historicalRuntimeReviewedProfileEvidenceDigest(material),
      };
    };

    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1_000;
    expect(HistoricalRuntimeReviewedProfileEvidenceSchema.safeParse(
      profileAt(ninetyDaysMs),
    ).success).toBe(true);
    expect(HistoricalRuntimeReviewedProfileEvidenceSchema.safeParse(
      profileAt(ninetyDaysMs + 1),
    ).success).toBe(false);
  });

  it("bounds Scene authority and composes production role documents through production receipts", () => {
    const subject = validSceneSubject();
    const unboundedSceneMaterial = {
      schemaVersion: "historical-runtime-scene-authority-receipt.v1",
      subject,
      sceneValidationSubjectDigest: subject.sceneValidationSubjectDigest,
      sceneMapParserReceiptId: subject.sceneMapParserReceiptId,
      sceneMapParserReceiptDigest: subject.sceneMapParserReceiptDigest,
      sceneMapParserReceiptExpiresAt: subject.sceneMapParserReceiptExpiresAt,
      sceneMapParserRuntimeIdentityId:
        subject.sceneMapParserRuntimeIdentityId,
      sceneMapParserRuntimeIdentityDigest:
        subject.sceneMapParserRuntimeIdentityDigest,
      sceneMapVerificationReceiptId: subject.sceneMapVerificationReceiptId,
      sceneMapVerificationReceiptDigest:
        subject.sceneMapVerificationReceiptDigest,
      sceneMapVerificationReceiptExpiresAt:
        subject.sceneMapVerificationReceiptExpiresAt,
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

  it("keeps parser leaf, compact handle, Scene subject, and final receipt profile-exact", () => {
    const localEvidence = localSceneMapParserEvidence();
    const localSubject = validSceneSubject(localEvidence);
    const finalMaterial = {
      schemaVersion: "historical-runtime-scene-authority-receipt.v1",
      subject: localSubject,
      sceneValidationSubjectDigest:
        localSubject.sceneValidationSubjectDigest,
      sceneMapParserReceiptId: localSubject.sceneMapParserReceiptId,
      sceneMapParserReceiptDigest: localSubject.sceneMapParserReceiptDigest,
      sceneMapParserReceiptExpiresAt:
        localSubject.sceneMapParserReceiptExpiresAt,
      sceneMapParserRuntimeIdentityId:
        localSubject.sceneMapParserRuntimeIdentityId,
      sceneMapParserRuntimeIdentityDigest:
        localSubject.sceneMapParserRuntimeIdentityDigest,
      sceneMapVerificationReceiptId:
        localSubject.sceneMapVerificationReceiptId,
      sceneMapVerificationReceiptDigest:
        localSubject.sceneMapVerificationReceiptDigest,
      sceneMapVerificationReceiptExpiresAt:
        localSubject.sceneMapVerificationReceiptExpiresAt,
      reviewerAttestationId: "10000000-0000-4000-8000-000000000067",
      reviewerAttestationDigest: B,
      reviewerActorId: ACTORS[5]!,
      reviewerAttestationExpiresAt: localSubject.authorityExpiresAt,
      reviewedAt: "2026-08-20T11:00:00.000Z",
      expiresAt: localSubject.authorityExpiresAt,
    } as const;
    expect(HistoricalRuntimeSceneMapParserReceiptSchema.safeParse(
      localEvidence.receipt,
    ).success).toBe(true);
    expect(HistoricalRuntimeSceneMapVerificationHandleSchema.safeParse(
      localEvidence.handle,
    ).success).toBe(true);
    expect(HistoricalRuntimeSceneAuthoritySubjectSchema.safeParse(
      localSubject,
    ).success).toBe(true);
    expect(HistoricalRuntimeSceneAuthorityReceiptSchema.safeParse({
      ...finalMaterial,
      sceneValidationDigest:
        historicalRuntimeSceneAuthorityReceiptDigest(finalMaterial),
    }).success).toBe(true);

    const productionEvidence = validSceneMapVerificationReceipt();
    const {
      sceneMapVerificationReceiptDigest: _mixedDigest,
      ...localMaterial
    } = localEvidence.receipt;
    const mixedProfileMaterial = {
      ...localMaterial,
      sceneObjectReceipt: productionEvidence.receipt.sceneObjectReceipt,
    };
    expect(HistoricalRuntimeSceneMapParserReceiptSchema.safeParse({
      ...mixedProfileMaterial,
      sceneMapVerificationReceiptDigest:
        historicalRuntimeSceneMapParserReceiptDigest(mixedProfileMaterial),
    }).success).toBe(false);

    const zeroSha = "0".repeat(64);
    const localZeroManifestMaterial = {
      ...localMaterial,
      parserImplementationManifestDigest: zeroSha,
    };
    expect(HistoricalRuntimeSceneMapParserReceiptSchema.safeParse({
      ...localZeroManifestMaterial,
      sceneMapVerificationReceiptDigest:
        historicalRuntimeSceneMapParserReceiptDigest(
          localZeroManifestMaterial,
        ),
    }).success).toBe(false);
    const {
      sceneMapVerificationReceiptDigest: _localHandleDigest,
      ...localHandleMaterial
    } = localEvidence.handle;
    const localZeroHandleManifestMaterial = {
      ...localHandleMaterial,
      parserImplementationManifestDigest: zeroSha,
    };
    expect(HistoricalRuntimeSceneMapVerificationHandleSchema.safeParse({
      ...localZeroHandleManifestMaterial,
      sceneMapVerificationReceiptDigest:
        historicalRuntimeSceneMapVerificationHandleDigest(
          localZeroHandleManifestMaterial,
        ),
    }).success).toBe(false);

    const {
      sceneMapVerificationReceiptDigest: _productionDigest,
      ...productionMaterial
    } = productionEvidence.receipt;
    const partialRuntimeMaterial = {
      ...productionMaterial,
      parserRuntimeDeploymentImageDigest: null,
    };
    expect(HistoricalRuntimeSceneMapParserReceiptSchema.safeParse({
      ...partialRuntimeMaterial,
      sceneMapVerificationReceiptDigest:
        historicalRuntimeSceneMapParserReceiptDigest(partialRuntimeMaterial),
    }).success).toBe(false);

    const {
      sceneMapVerificationReceiptDigest: _handleDigest,
      ...handleMaterial
    } = productionEvidence.handle;
    const partialHandleMaterial = {
      ...handleMaterial,
      parserRuntimeSessionPrincipalSha256: null,
    };
    expect(HistoricalRuntimeSceneMapVerificationHandleSchema.safeParse({
      ...partialHandleMaterial,
      sceneMapVerificationReceiptDigest:
        historicalRuntimeSceneMapVerificationHandleDigest(
          partialHandleMaterial,
        ),
    }).success).toBe(false);

    const staleHandleMaterial = {
      ...handleMaterial,
      derivationExpiresAt: handleMaterial.acceptedAt,
    };
    expect(HistoricalRuntimeSceneMapVerificationHandleSchema.safeParse({
      ...staleHandleMaterial,
      sceneMapVerificationReceiptDigest:
        historicalRuntimeSceneMapVerificationHandleDigest(staleHandleMaterial),
    }).success).toBe(false);

    const zeroProductionDigestMutations = [
      { ...productionMaterial, parserImplementationManifestDigest: zeroSha },
      { ...productionMaterial, parserRuntimeIdentityDigest: zeroSha },
      { ...productionMaterial, parserRuntimeExecutableArtifactDigest: zeroSha },
      { ...productionMaterial, parserRuntimeDeploymentImageDigest: zeroSha },
      { ...productionMaterial, parserRuntimeSessionPrincipalSha256: zeroSha },
    ];
    for (const zeroMaterial of zeroProductionDigestMutations) {
      expect(HistoricalRuntimeSceneMapParserReceiptSchema.safeParse({
        ...zeroMaterial,
        sceneMapVerificationReceiptDigest:
          historicalRuntimeSceneMapParserReceiptDigest(zeroMaterial),
      }).success).toBe(false);
    }

    const zeroHandleDigestMutations = [
      { ...handleMaterial, parserImplementationManifestDigest: zeroSha },
      { ...handleMaterial, parserRuntimeIdentityDigest: zeroSha },
      { ...handleMaterial, parserRuntimeExecutableArtifactDigest: zeroSha },
      { ...handleMaterial, parserRuntimeDeploymentImageDigest: zeroSha },
      { ...handleMaterial, parserRuntimeSessionPrincipalSha256: zeroSha },
    ];
    for (const zeroMaterial of zeroHandleDigestMutations) {
      expect(HistoricalRuntimeSceneMapVerificationHandleSchema.safeParse({
        ...zeroMaterial,
        sceneMapVerificationReceiptDigest:
          historicalRuntimeSceneMapVerificationHandleDigest(zeroMaterial),
      }).success).toBe(false);
    }

    const beyondTtl = "2026-09-20T09:45:00.001Z";
    const laterConstituentExpiry = "2026-10-20T09:45:00.000Z";
    const overTtlHandleMaterial = {
      ...handleMaterial,
      presentationAdmissionReviewerAttestationExpiresAt:
        laterConstituentExpiry,
      derivationExpiresAt: laterConstituentExpiry,
      transformReviewExpiresAt: laterConstituentExpiry,
      twinReleaseAuthorityExpiresAt: laterConstituentExpiry,
      sceneProviderCapabilityExpiresAt: laterConstituentExpiry,
      parserRuntimeIdentityExpiresAt: laterConstituentExpiry,
      expiresAt: beyondTtl,
    };
    expect(HistoricalRuntimeSceneMapVerificationHandleSchema.safeParse({
      ...overTtlHandleMaterial,
      sceneMapVerificationReceiptDigest:
        historicalRuntimeSceneMapVerificationHandleDigest(
          overTtlHandleMaterial,
        ),
    }).success).toBe(false);
  });

  it("binds production Scene receipt actors, direct object identity, and room-scope Scene identity", () => {
    const { receipt } = validSceneMapVerificationReceipt();
    const sceneReceipt = receipt.sceneObjectReceipt;
    const { receiptDigest: _sceneReceiptDigest, ...sceneReceiptMaterial } = sceneReceipt;
    const testScopedSceneReceiptMaterial = {
      ...sceneReceiptMaterial,
      custodianAuthority: objectActorAuthority(
        sceneReceipt.custodianActorId,
        "object_custodian",
        sceneReceipt.anonymousAccessDenial.probedAt,
      ),
      observedByAuthority: objectActorAuthority(
        sceneReceipt.observedByActorId,
        "object_observer",
        sceneReceipt.anonymousAccessDenial.probedAt,
      ),
      anonymousAccessDenial: {
        ...sceneReceipt.anonymousAccessDenial,
        proberAuthority: objectActorAuthority(
          sceneReceipt.anonymousAccessDenial.probedBy,
          "anonymous_denial_prober",
          sceneReceipt.anonymousAccessDenial.probedAt,
        ),
      },
    };
    const testScopedSceneReceipt = {
      ...testScopedSceneReceiptMaterial,
      receiptDigest: historicalRuntimeExactObjectReceiptDigest(
        testScopedSceneReceiptMaterial,
      ),
    };
    const {
      sceneMapVerificationReceiptDigest: _verificationDigest,
      ...verificationMaterial
    } = receipt;
    const crossEnvironmentMaterial = {
      ...verificationMaterial,
      sceneObjectReceipt: testScopedSceneReceipt,
    };
    expect(HistoricalRuntimeSceneMapParserReceiptSchema.safeParse({
      ...crossEnvironmentMaterial,
      sceneMapVerificationReceiptDigest:
        historicalRuntimeSceneMapParserReceiptDigest(
          crossEnvironmentMaterial,
        ),
    }).success).toBe(false);

    const validSubject = validSceneSubject();
    const { sceneValidationSubjectDigest: _subjectDigest, ...subjectMaterial } =
      validSubject;
    const substitutedObjectReceipt = productionExactReceipt({
      receiptId: validSubject.sceneObjectReceipt.receiptId,
      capabilityReceiptId:
        validSubject.sceneObjectReceipt.object.immutabilityCapabilityReceiptId,
      storageKeySha256:
        validSubject.sceneObjectReceipt.object.storageKeySha256 === A ? B : A,
      fileName: validSubject.sceneObjectReceipt.object.fileName,
      mimeType: validSubject.sceneObjectReceipt.object.mimeType,
      sha256: validSubject.sceneObjectReceipt.object.sha256,
      sizeBytes: validSubject.sceneObjectReceipt.object.sizeBytes,
    });
    const substitutedObjectMaterial = {
      ...subjectMaterial,
      sceneObjectReceipt: substitutedObjectReceipt,
    };
    expect(HistoricalRuntimeSceneAuthoritySubjectSchema.safeParse({
      ...substitutedObjectMaterial,
      sceneValidationSubjectDigest:
        historicalRuntimeSceneAuthoritySubjectDigest(
          substitutedObjectMaterial,
        ),
    }).success).toBe(false);

    const alternateUuid = "10000000-0000-4000-8000-000000000099";
    const alternateDigest = validSubject.twinReleaseDigest === A ? B : A;
    const laterExpiry = "2026-08-21T09:32:00.000Z";
    const driftedLineageMaterials = [
      { ...subjectMaterial, presentationAdmissionReviewerAttestationId: alternateUuid },
      { ...subjectMaterial, presentationAdmissionReviewerAttestationDigest: alternateDigest },
      { ...subjectMaterial, presentationAdmissionReviewerAttestationExpiresAt: laterExpiry },
      { ...subjectMaterial, derivationExpiresAt: laterExpiry },
      { ...subjectMaterial, transformReviewExpiresAt: laterExpiry },
      { ...subjectMaterial, twinReleaseAuthorityReceiptId: alternateUuid },
      { ...subjectMaterial, twinReleaseAuthorityDigest: alternateDigest },
      { ...subjectMaterial, twinReleaseAuthorityExpiresAt: laterExpiry },
      { ...subjectMaterial, twinReleaseDigest: alternateDigest },
      { ...subjectMaterial, providerCapabilityExpiresAt: laterExpiry },
    ];
    for (const driftedLineageMaterial of driftedLineageMaterials) {
      expect(HistoricalRuntimeSceneAuthoritySubjectSchema.safeParse({
        ...driftedLineageMaterial,
        sceneValidationSubjectDigest:
          historicalRuntimeSceneAuthoritySubjectDigest(
            driftedLineageMaterial,
          ),
      }).success).toBe(false);
    }

    const preVerificationMaterial = {
      ...subjectMaterial,
      validatedAt: "2026-08-20T09:40:00.000Z",
    };
    expect(HistoricalRuntimeSceneAuthoritySubjectSchema.safeParse({
      ...preVerificationMaterial,
      sceneValidationSubjectDigest:
        historicalRuntimeSceneAuthoritySubjectDigest(
          preVerificationMaterial,
        ),
    }).success).toBe(false);

    const driftedRoomBasis = {
      ...validSubject.coverage.roomScopeBasis,
      sceneArtifactDigest:
        validSubject.sceneArtifactDigest === A ? B : A,
    };
    const driftedCoverage = HistoricalRuntimeSceneAuthorityCoverageSchema.parse({
      ...validSubject.coverage,
      roomScopeBasis: driftedRoomBasis,
      roomScopeBasisDigest: historicalRuntimeRoomScopeBasisDigest(
        driftedRoomBasis,
      ),
    });
    const driftedRoomMaterial = {
      ...subjectMaterial,
      coverage: driftedCoverage,
      coverageDigest: historicalRuntimeSceneAuthorityCoverageDigest(
        driftedCoverage,
      ),
    };
    expect(HistoricalRuntimeSceneAuthoritySubjectSchema.safeParse({
      ...driftedRoomMaterial,
      sceneValidationSubjectDigest:
        historicalRuntimeSceneAuthoritySubjectDigest(driftedRoomMaterial),
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

import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import { RuntimePackageContentDigestSchema } from "./asset-version.js";
import { UserIdSchema } from "./user.js";

export const HISTORICAL_RUNTIME_MAX_EVIDENCE_OBJECT_BYTES = 64 * 1024 * 1024 * 1024;
export const HISTORICAL_RUNTIME_ANONYMOUS_DENIAL_MAX_TTL_MS = 24 * 60 * 60 * 1_000;
export const HISTORICAL_RUNTIME_PROVIDER_CAPABILITY_MAX_TTL_MS =
  30 * 24 * 60 * 60 * 1_000;

const SHA256 = RuntimePackageContentDigestSchema;
const DOMAIN_SHA256 = /^sha256:[0-9a-f]{64}$/u;
const STORAGE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,511}$/u;
const PRINTABLE_ETAG = /^[\u0021-\u007e]{1,512}$/u;
const SAFE_FILE_NAME = /^[^/\\]+$/u;

export const HistoricalRuntimeDomainSha256Schema = z.string().regex(DOMAIN_SHA256);
export type HistoricalRuntimeDomainSha256 = z.infer<
  typeof HistoricalRuntimeDomainSha256Schema
>;

function canonicalDigest(domain: string, value: unknown): string | null {
  try {
    return sha256Hex(
      `${domain}${stableCanonicalJson(CanonicalJsonValueSchema.parse(value))}`,
    );
  } catch {
    return null;
  }
}

export const HISTORICAL_RUNTIME_EVIDENCE_PROVIDER_PROFILES = [
  "runtime_private",
  "foundry_candidate",
  "local_fixture",
] as const;
export const HistoricalRuntimeEvidenceProviderProfileSchema = z.enum(
  HISTORICAL_RUNTIME_EVIDENCE_PROVIDER_PROFILES,
);
export type HistoricalRuntimeEvidenceProviderProfile = z.infer<
  typeof HistoricalRuntimeEvidenceProviderProfileSchema
>;

export const HistoricalRuntimeEvidenceProviderKindSchema = z.enum([
  "s3",
  "r2_s3",
  "r2_workers",
  "content_addressed_immutable",
  "local_fixture",
]);
export type HistoricalRuntimeEvidenceProviderKind = z.infer<
  typeof HistoricalRuntimeEvidenceProviderKindSchema
>;

export const HistoricalRuntimeEvidenceVersionKindSchema = z.enum([
  "s3_version_id",
  "r2_object_version",
  "content_addressed_immutable_key",
  "local_fixture_version",
]);
export type HistoricalRuntimeEvidenceVersionKind = z.infer<
  typeof HistoricalRuntimeEvidenceVersionKindSchema
>;

const ProviderVersionPairSchema = z.discriminatedUnion("providerKind", [
  z.object({
    providerKind: z.literal("s3"),
    versionKind: z.literal("s3_version_id"),
  }).strict(),
  z.object({
    providerKind: z.literal("r2_s3"),
    versionKind: z.literal("content_addressed_immutable_key"),
  }).strict(),
  z.object({
    providerKind: z.literal("r2_workers"),
    versionKind: z.literal("r2_object_version"),
  }).strict(),
  z.object({
    providerKind: z.literal("content_addressed_immutable"),
    versionKind: z.literal("content_addressed_immutable_key"),
  }).strict(),
  z.object({
    providerKind: z.literal("local_fixture"),
    versionKind: z.literal("local_fixture_version"),
  }).strict(),
]);

const HistoricalRuntimeProviderCapabilityMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-provider-capability.v2"),
  capabilityReceiptId: z.string().uuid(),
  providerProfile: HistoricalRuntimeEvidenceProviderProfileSchema,
  providerAccountSha256: SHA256,
  endpointAuthoritySha256: SHA256,
  privateBucketSha256: SHA256,
  providerKind: HistoricalRuntimeEvidenceProviderKindSchema,
  versionKind: HistoricalRuntimeEvidenceVersionKindSchema,
  exactVersionReadSupported: z.literal(true),
  overwritePreservesPriorVersion: z.literal(true),
  anonymousProbeSupported: z.literal(true),
  anonymousAccessProbeEquivalence: z.object({
    headRequestMethod: z.literal("HEAD"),
    headRequestDigest: SHA256,
    headResponseDigest: SHA256,
    headStatusCode: z.union([z.literal(401), z.literal(403), z.literal(404)]),
    headRedirectCount: z.literal(0),
    getRequestMethod: z.literal("GET"),
    getRangeHeader: z.literal("bytes=0-0"),
    getRequestDigest: SHA256,
    getResponseDigest: SHA256,
    getStatusCode: z.union([z.literal(401), z.literal(403), z.literal(404)]),
    getRedirectCount: z.literal(0),
    denialClass: z.enum([
      "authentication_required",
      "access_forbidden",
      "concealed_existing_object",
    ]),
  }).strict(),
  verificationMode: z.enum([
    "provider_native_version",
    "content_addressed_no_overwrite_with_retention",
    "local_fixture_exact_version",
  ]),
  testObjectStorageKeySha256: SHA256,
  initialWriteDigest: SHA256,
  initialReadDigest: SHA256,
  overwriteDigest: SHA256,
  priorVersionRereadDigest: SHA256,
  verifiedBy: UserIdSchema,
  verifiedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeProviderCapabilityDigest(value: unknown): string {
  const parsed = HistoricalRuntimeProviderCapabilityMaterialSchema.parse(value);
  const result = canonicalDigest(
    "venviewer.historical-runtime-provider-capability.v2\n",
    parsed,
  );
  if (result === null) throw new TypeError("Provider capability is not canonical JSON.");
  return result;
}

export const HistoricalRuntimeProviderCapabilitySchema =
  HistoricalRuntimeProviderCapabilityMaterialSchema.extend({
    capabilityDigest: SHA256,
  }).strict().superRefine((capability, context) => {
    const { capabilityDigest, ...material } = capability;
    const pairValid = ProviderVersionPairSchema.safeParse({
      providerKind: capability.providerKind,
      versionKind: capability.versionKind,
    }).success;
    const fixture = capability.providerProfile === "local_fixture";
    const expectedVerificationMode = capability.providerKind === "local_fixture"
      ? "local_fixture_exact_version"
      : capability.versionKind === "content_addressed_immutable_key"
        ? "content_addressed_no_overwrite_with_retention"
        : "provider_native_version";
    const anonymousProbe = capability.anonymousAccessProbeEquivalence;
    const expectedDenialClass = anonymousProbe.headStatusCode === 401
      ? "authentication_required"
      : anonymousProbe.headStatusCode === 403
        ? "access_forbidden"
        : "concealed_existing_object";
    if (
      !pairValid ||
      fixture !== (capability.providerKind === "local_fixture") ||
      capability.verificationMode !== expectedVerificationMode ||
      new Date(capability.expiresAt).getTime() <= new Date(capability.verifiedAt).getTime() ||
      new Date(capability.expiresAt).getTime() - new Date(capability.verifiedAt).getTime() >
        HISTORICAL_RUNTIME_PROVIDER_CAPABILITY_MAX_TTL_MS ||
      capability.initialReadDigest !== capability.initialWriteDigest ||
      capability.priorVersionRereadDigest !== capability.initialWriteDigest ||
      capability.overwriteDigest === capability.initialWriteDigest ||
      anonymousProbe.headStatusCode !== anonymousProbe.getStatusCode ||
      anonymousProbe.headRequestDigest === anonymousProbe.getRequestDigest ||
      anonymousProbe.denialClass !== expectedDenialClass ||
       canonicalDigest("venviewer.historical-runtime-provider-capability.v2\n", material) !==
        capabilityDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilityDigest"],
        message: "Provider capability must prove a changed overwrite and an unchanged exact reread of the original version within a finite verification window.",
      });
    }
  });
export type HistoricalRuntimeProviderCapability = z.infer<
  typeof HistoricalRuntimeProviderCapabilitySchema
>;

export const HistoricalRuntimeProductionProviderCapabilitySchema =
  HistoricalRuntimeProviderCapabilitySchema.superRefine((capability, context) => {
    if (
      capability.providerProfile === "local_fixture" ||
      capability.providerKind === "r2_workers"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerKind"],
        message: "Production provider authority requires a live-conformance-enabled provider; R2 Workers exact prior-version reread is not yet enabled.",
      });
    }
  });

export const HistoricalRuntimeEvidenceObjectIdentitySchema = z.object({
  providerProfile: HistoricalRuntimeEvidenceProviderProfileSchema,
  providerKind: HistoricalRuntimeEvidenceProviderKindSchema,
  providerAccountSha256: SHA256,
  endpointAuthoritySha256: SHA256,
  privateBucketSha256: SHA256,
  storageKeySha256: SHA256,
  versionKind: HistoricalRuntimeEvidenceVersionKindSchema,
  storageVersion: z.string().regex(STORAGE_VERSION),
  immutabilityCapabilityReceiptId: z.string().uuid(),
  immutabilityCapabilityDigest: SHA256,
  storageEtag: z.string().regex(PRINTABLE_ETAG),
  fileName: z.string().trim().min(1).max(255).regex(SAFE_FILE_NAME),
  mimeType: z.string().trim().min(1).max(160),
  sha256: SHA256,
  sizeBytes: z.number().int().positive().max(HISTORICAL_RUNTIME_MAX_EVIDENCE_OBJECT_BYTES),
}).strict().superRefine((identity, context) => {
  const pairValid = ProviderVersionPairSchema.safeParse({
    providerKind: identity.providerKind,
    versionKind: identity.versionKind,
  }).success;
  const fixture = identity.providerProfile === "local_fixture";
  if (!pairValid || fixture !== (identity.providerKind === "local_fixture")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["providerKind"],
      message: "Object identity must use a provider-native supported immutable-version pairing.",
    });
  }
});
export type HistoricalRuntimeEvidenceObjectIdentity = z.infer<
  typeof HistoricalRuntimeEvidenceObjectIdentitySchema
>;

const HistoricalRuntimeObjectActorWorkspaceMembershipSchema =
  z.discriminatedUnion("state", [
    z.object({
      state: z.literal("not_applicable"),
      reason: z.literal("platform_authority"),
    }).strict(),
    z.object({
      state: z.literal("active"),
      membershipId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      userId: UserIdSchema,
      workspaceRole: z.enum(["owner", "admin", "staff", "hallkeeper"]),
      venueRole: z.enum(["staff", "hallkeeper", "planner", "client"]),
      membershipStatus: z.literal("active"),
      membershipUpdatedAt: z.string().datetime({ offset: true }),
      membershipVersionDigest: SHA256,
    }).strict(),
  ]);

const HistoricalRuntimeObjectActorAuthorityMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-object-actor-authority.v1"),
  actorId: UserIdSchema,
  authorityRole: z.enum([
    "object_custodian",
    "object_observer",
    "anonymous_denial_prober",
  ]),
  environmentId: z.string().uuid(),
  environmentMode: z.enum(["production", "test"]),
  venueId: z.string().uuid(),
  spaceId: z.string().uuid(),
  platformRole: z.enum(["none", "operator", "admin"]),
  userRole: z.enum(["client", "planner", "staff", "hallkeeper", "admin"]),
  userVenueId: z.string().uuid().nullable(),
  workspaceMembership: HistoricalRuntimeObjectActorWorkspaceMembershipSchema,
  snapshottedAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeObjectActorAuthorityDigest(value: unknown): string {
  const parsed = HistoricalRuntimeObjectActorAuthorityMaterialSchema.parse(value);
  const result = canonicalDigest(
    "venviewer.historical-runtime-object-actor-authority.v1\n",
    parsed,
  );
  if (result === null) throw new TypeError("Object actor authority is not canonical JSON.");
  return result;
}

type HistoricalRuntimeObjectActorAuthorityMaterial = z.infer<
  typeof HistoricalRuntimeObjectActorAuthorityMaterialSchema
>;
export type HistoricalRuntimeObjectActorAuthority =
  HistoricalRuntimeObjectActorAuthorityMaterial & { authorityDigest: string };

export const HistoricalRuntimeObjectActorAuthoritySchema:
  z.ZodType<HistoricalRuntimeObjectActorAuthority> =
  HistoricalRuntimeObjectActorAuthorityMaterialSchema.extend({
    authorityDigest: SHA256,
  }).strict().superRefine((authority, context) => {
    const { authorityDigest, ...material } = authority;
    const platformAuthority = authority.platformRole === "operator" ||
      authority.platformRole === "admin";
    const membership = authority.workspaceMembership;
    const workspaceAuthority = membership.state === "active" &&
      authority.platformRole === "none" &&
      authority.userVenueId === authority.venueId &&
      authority.userRole !== "client" &&
      membership.userId === authority.actorId &&
      (membership.workspaceRole !== "staff" ||
        membership.venueRole === "hallkeeper" ||
        ["planner", "staff", "hallkeeper", "admin"].includes(authority.userRole));
    if (
      platformAuthority !== (membership.state === "not_applicable") ||
      (!platformAuthority && !workspaceAuthority) ||
      canonicalDigest(
        "venviewer.historical-runtime-object-actor-authority.v1\n",
        material,
      ) !== authorityDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorityDigest"],
        message: "Object receipt actor authority must bind an action-time platform or exact active same-venue membership snapshot.",
      });
    }
  });

export const HistoricalRuntimeAnonymousAccessDenialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-anonymous-access-denial.v2"),
  requestMethod: z.literal("HEAD"),
  providerProfile: HistoricalRuntimeEvidenceProviderProfileSchema,
  providerKind: HistoricalRuntimeEvidenceProviderKindSchema,
  providerAccountSha256: SHA256,
  endpointAuthoritySha256: SHA256,
  privateBucketSha256: SHA256,
  storageKeySha256: SHA256,
  versionKind: HistoricalRuntimeEvidenceVersionKindSchema,
  storageVersion: z.string().regex(STORAGE_VERSION),
  immutabilityCapabilityReceiptId: z.string().uuid(),
  immutabilityCapabilityDigest: SHA256,
  authenticatedReadRequestDigest: SHA256,
  requestDigest: SHA256,
  responseDigest: SHA256,
  statusCode: z.union([z.literal(401), z.literal(403), z.literal(404)]),
  denialClass: z.enum([
    "authentication_required",
    "access_forbidden",
    "concealed_existing_object",
  ]),
  redirectCount: z.literal(0),
  safeRangeGet: z.object({
    requestMethod: z.literal("GET"),
    rangeHeader: z.literal("bytes=0-0"),
    requestDigest: SHA256,
    responseDigest: SHA256,
    statusCode: z.union([z.literal(401), z.literal(403), z.literal(404)]),
    denialClass: z.enum([
      "authentication_required",
      "access_forbidden",
      "concealed_existing_object",
    ]),
    redirectCount: z.literal(0),
  }).strict(),
  probedBy: UserIdSchema,
  proberAuthority: HistoricalRuntimeObjectActorAuthoritySchema,
  probedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict().superRefine((denial, context) => {
  const probedAt = new Date(denial.probedAt).getTime();
  const expiresAt = new Date(denial.expiresAt).getTime();
  const expectedClass = denial.statusCode === 401
    ? "authentication_required"
    : denial.statusCode === 403
      ? "access_forbidden"
      : "concealed_existing_object";
  if (
    !Number.isFinite(probedAt) || !Number.isFinite(expiresAt) ||
    expiresAt <= probedAt ||
    expiresAt - probedAt > HISTORICAL_RUNTIME_ANONYMOUS_DENIAL_MAX_TTL_MS ||
    denial.denialClass !== expectedClass ||
    denial.safeRangeGet.statusCode !== denial.statusCode ||
    denial.safeRangeGet.denialClass !== denial.denialClass ||
    denial.safeRangeGet.requestDigest === denial.requestDigest ||
    denial.proberAuthority.actorId !== denial.probedBy ||
    denial.proberAuthority.authorityRole !== "anonymous_denial_prober" ||
    new Date(denial.proberAuthority.snapshottedAt).getTime() !== probedAt
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Anonymous denial must have a matching result class and expire within 24 hours of DB probe time.",
    });
  }
});
export type HistoricalRuntimeAnonymousAccessDenial = z.infer<
  typeof HistoricalRuntimeAnonymousAccessDenialSchema
>;

const HistoricalRuntimeExactObjectReceiptMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-exact-object-receipt.v2"),
  receiptId: z.string().uuid(),
  object: HistoricalRuntimeEvidenceObjectIdentitySchema,
  custodianActorId: UserIdSchema,
  custodianAuthority: HistoricalRuntimeObjectActorAuthoritySchema,
  observedByActorId: UserIdSchema,
  observedByAuthority: HistoricalRuntimeObjectActorAuthoritySchema,
  authenticatedReadRequestDigest: SHA256,
  authenticatedReadResponseDigest: SHA256,
  readAt: z.string().datetime({ offset: true }),
  anonymousAccessDenial: HistoricalRuntimeAnonymousAccessDenialSchema,
}).strict();

export function historicalRuntimeExactObjectReceiptDigest(value: unknown): string {
  const material = HistoricalRuntimeExactObjectReceiptMaterialSchema.parse(value);
  const result = canonicalDigest(
    "venviewer.historical-runtime-exact-object-receipt.v2\n",
    material,
  );
  if (result === null) throw new TypeError("Exact object receipt is not canonical JSON.");
  return result;
}

type HistoricalRuntimeExactObjectReceiptMaterial = z.infer<
  typeof HistoricalRuntimeExactObjectReceiptMaterialSchema
>;
export type HistoricalRuntimeExactObjectReceipt =
  HistoricalRuntimeExactObjectReceiptMaterial & { receiptDigest: string };

export const HistoricalRuntimeExactObjectReceiptSchema:
  z.ZodType<HistoricalRuntimeExactObjectReceipt> =
  HistoricalRuntimeExactObjectReceiptMaterialSchema.extend({
    receiptDigest: SHA256,
  }).strict().superRefine((receipt, context) => {
    const { receiptDigest, ...material } = receipt;
    const denial = receipt.anonymousAccessDenial;
    const readAt = new Date(receipt.readAt).getTime();
    const probedAt = new Date(denial.probedAt).getTime();
    if (
      canonicalDigest("venviewer.historical-runtime-exact-object-receipt.v2\n", material) !==
        receiptDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receiptDigest"],
        message: "Exact-object receipt digest must bind provider scope, versioned bytes, and denial probe.",
      });
    }
    if (
      probedAt < readAt ||
      probedAt - readAt > 5 * 60 * 1_000 ||
      receipt.custodianActorId !== receipt.custodianAuthority.actorId ||
      receipt.custodianAuthority.authorityRole !== "object_custodian" ||
      receipt.observedByActorId !== receipt.observedByAuthority.actorId ||
      receipt.observedByAuthority.authorityRole !== "object_observer" ||
      receipt.custodianAuthority.snapshottedAt !== denial.probedAt ||
      receipt.observedByAuthority.snapshottedAt !== denial.probedAt ||
      new Set([
        receipt.custodianActorId,
        receipt.observedByActorId,
        denial.probedBy,
      ]).size !== 3 ||
      receipt.custodianAuthority.environmentId !==
        receipt.observedByAuthority.environmentId ||
      receipt.custodianAuthority.environmentId !==
        denial.proberAuthority.environmentId ||
      receipt.custodianAuthority.venueId !== receipt.observedByAuthority.venueId ||
      receipt.custodianAuthority.venueId !== denial.proberAuthority.venueId ||
      receipt.custodianAuthority.spaceId !== receipt.observedByAuthority.spaceId ||
      receipt.custodianAuthority.spaceId !== denial.proberAuthority.spaceId ||
      denial.providerProfile !== receipt.object.providerProfile ||
      denial.providerKind !== receipt.object.providerKind ||
      denial.providerAccountSha256 !== receipt.object.providerAccountSha256 ||
      denial.endpointAuthoritySha256 !== receipt.object.endpointAuthoritySha256 ||
      denial.privateBucketSha256 !== receipt.object.privateBucketSha256 ||
      denial.storageKeySha256 !== receipt.object.storageKeySha256 ||
      denial.versionKind !== receipt.object.versionKind ||
      denial.storageVersion !== receipt.object.storageVersion ||
      denial.immutabilityCapabilityReceiptId !== receipt.object.immutabilityCapabilityReceiptId ||
      denial.immutabilityCapabilityDigest !== receipt.object.immutabilityCapabilityDigest ||
      denial.authenticatedReadRequestDigest !== receipt.authenticatedReadRequestDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["anonymousAccessDenial"],
        message: "Anonymous denial must chronologically follow and bind the same authenticated exact object read.",
      });
    }
  });

export const HistoricalRuntimeProductionExactObjectReceiptSchema =
  HistoricalRuntimeExactObjectReceiptSchema.superRefine((receipt, context) => {
    if (receipt.object.providerProfile === "local_fixture") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["object", "providerProfile"],
        message: "Production evidence cannot use local-fixture object authority.",
      });
    }
    if (receipt.object.providerKind === "r2_workers") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["object", "providerKind"],
        message: "Production receipts reject R2 Workers until live exact-prior-version reread conformance is proven.",
      });
    }
  });

import {
  createHash,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import { isAbsolute, normalize, resolve } from "node:path";
import { TextDecoder } from "node:util";
import {
  DsseEnvelopeSchema,
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
  verifyDsseEnvelope,
} from "@omnitwin/reconstruction-foundry";
import {
  LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_MANIFEST,
  LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_TRUST_ROOT,
} from "./local-offline-normalization-preview-bundled-release.generated.js";
import {
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_APPROVAL_SCOPE_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_BUILD_QUALIFICATION_STATUS_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_STOP_SIGNAL_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_WORKING_DIRECTORY_V2,
  parseLocalOfflinePreviewContainerConfiguration,
  type LocalOfflinePreviewContainerConfiguration,
} from "./local-offline-normalization-preview-container-preflight.js";

export const LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_MANIFEST_V1 =
  "omnitwin.reconstruction-foundry.offline-preview-bundled-release.v1";

export const LOCAL_OFFLINE_PREVIEW_LIVE_QUALIFICATION_REPORT_V1 =
  "omnitwin.reconstruction-foundry.offline-preview-live-qualification.v1";

export const LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_DSSE_PAYLOAD_TYPE =
  "application/vnd.omnitwin.offline-preview-bundled-release.v1+json";

export const LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_MANIFEST_DIGEST_DOMAIN =
  "OMNITWIN_OFFLINE_PREVIEW_BUNDLED_RELEASE_MANIFEST_V1";

export const LOCAL_OFFLINE_PREVIEW_LIVE_QUALIFICATION_REPORT_DIGEST_DOMAIN =
  "OMNITWIN_OFFLINE_PREVIEW_LIVE_QUALIFICATION_REPORT_V1";

const LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_DIGEST_DOMAIN =
  "OMNITWIN_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V2";

export const LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_REJECTION_CODES = [
  "MANIFEST_SHAPE_REJECTED",
  "MANIFEST_PAYLOAD_REJECTED",
  "MANIFEST_CANONICAL_BYTES_REJECTED",
  "MANIFEST_SIGNATURE_REJECTED",
  "MANIFEST_TRUST_ROOT_REJECTED",
  "MANIFEST_CONFIGURATION_REJECTED",
  "MANIFEST_DOCKER_EXECUTABLE_REJECTED",
  "MANIFEST_IMAGE_RUNTIME_REJECTED",
  "MANIFEST_PERMIT_KEY_REJECTED",
  "MANIFEST_PERMIT_KEY_FINGERPRINT_MISMATCH",
  "MANIFEST_PERMIT_KEY_ORDER_REJECTED",
  "QUALIFICATION_REPORT_REJECTED",
  "QUALIFICATION_REPORT_DIGEST_MISMATCH",
  "QUALIFICATION_REPORT_BINDING_MISMATCH",
] as const;

export type LocalOfflinePreviewBundledReleaseRejectionCode =
  (typeof LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_REJECTION_CODES)[number];

export interface LocalOfflinePreviewLiveQualificationChecksV1 {
  readonly successfulTransformAndFreshVerificationRuns: number;
  readonly successfulCancellationRuns: number;
  readonly networkModeNoneObserved: true;
  readonly readOnlyRootFilesystemObserved: true;
  readonly noHostMountsObserved: true;
  readonly nonRootUserObserved: true;
  readonly pid1WatchdogObserved: true;
  readonly freshContainerPerPhaseObserved: true;
  readonly cleanupAbsenceProved: true;
}

export interface LocalOfflinePreviewLiveQualificationReportPayloadV1 {
  readonly schemaVersion:
    typeof LOCAL_OFFLINE_PREVIEW_LIVE_QUALIFICATION_REPORT_V1;
  readonly status: "qualified";
  readonly qualifiedAt: string;
  readonly imageReference: string;
  readonly imageId: string;
  readonly imageApprovalScope:
    typeof LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_APPROVAL_SCOPE_V2;
  readonly imageBuildQualificationStatus:
    typeof LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_BUILD_QUALIFICATION_STATUS_V2;
  readonly containerConfigurationSha256: string;
  readonly dockerExecutableArtifactSha256: string;
  readonly workerProtocolSha256: string;
  readonly workerArtifactSha256: string;
  readonly seccompProfileSha256: string;
  readonly watchdogArtifactSha256: string;
  readonly checks: LocalOfflinePreviewLiveQualificationChecksV1;
}

export interface LocalOfflinePreviewLiveQualificationReportV1 {
  readonly payload: LocalOfflinePreviewLiveQualificationReportPayloadV1;
  readonly reportSha256: string;
}

export interface LocalOfflinePreviewBundledReleaseQualificationV1 {
  readonly kind: "docker_live_offline_preview_v1";
  /** The complete report is inside the signed manifest payload. */
  readonly report: LocalOfflinePreviewLiveQualificationReportV1;
}

export interface LocalOfflinePreviewBundledDockerExecutableV1 {
  readonly path: string;
  readonly artifactSha256: string;
}

export interface LocalOfflinePreviewBundledImageRuntimeContractV1 {
  readonly environment: readonly string[];
  readonly workingDirectory:
    typeof LOCAL_OFFLINE_PREVIEW_CONTAINER_WORKING_DIRECTORY_V2;
  readonly stopSignal: typeof LOCAL_OFFLINE_PREVIEW_CONTAINER_STOP_SIGNAL_V2;
}

export interface LocalOfflinePreviewBundledPermitKeyV1 {
  readonly purpose: "offline_normalization_preview_permit";
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly publicKeySpkiDerBase64: string;
  readonly publicKeySpkiSha256: string;
}

export interface LocalOfflinePreviewBundledReleaseSigningKeyV1 {
  readonly purpose: "offline_normalization_preview_release";
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly publicKeySpkiDerBase64: string;
  readonly publicKeySpkiSha256: string;
}

export interface LocalOfflinePreviewBundledReleaseManifestPayloadV1 {
  readonly schemaVersion:
    typeof LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_MANIFEST_V1;
  readonly releaseId: string;
  readonly qualification: LocalOfflinePreviewBundledReleaseQualificationV1;
  readonly dockerExecutable: LocalOfflinePreviewBundledDockerExecutableV1;
  readonly containerConfiguration: LocalOfflinePreviewContainerConfiguration;
  readonly imageRuntimeContract:
    LocalOfflinePreviewBundledImageRuntimeContractV1;
  readonly trustedPermitKeys:
    readonly LocalOfflinePreviewBundledPermitKeyV1[];
}

export interface LocalOfflinePreviewBundledReleaseSerializedClaim {
  readonly liveAuthorityCapable: false;
  readonly authority: "none";
  readonly claimStatus: "unauthenticated_integrity_claim";
  readonly attestationAuthority: "none";
  readonly cryptographicallyAuthenticated: false;
}

declare const BUNDLED_RELEASE_AUTHORITY_BRAND: unique symbol;

export interface LocalOfflinePreviewBundledReleaseAuthority {
  readonly [BUNDLED_RELEASE_AUTHORITY_BRAND]: true;
  readonly authority: "cryptographically_verified_bundled_release";
  readonly liveAuthorityCapable: true;
  readonly releaseId: string;
  readonly releaseManifestSha256: string;
  readonly verifiedReleaseSigningKeyIds: readonly string[];
  toJSON(): LocalOfflinePreviewBundledReleaseSerializedClaim;
}

export interface LocalOfflinePreviewBundledReleaseMaterial {
  readonly releaseId: string;
  readonly releaseManifestSha256: string;
  readonly qualificationReportSha256: string;
  readonly dockerExecutableArtifactSha256: string;
  readonly containerConfiguration: LocalOfflinePreviewContainerConfiguration;
  /** A detached map. Mutating it cannot change the process-owned authority. */
  readonly pinnedTrustedPermitKeys: ReadonlyMap<string, KeyObject>;
}

export type LocalOfflinePreviewBundledReleaseLookup =
  | Readonly<{
      status: "available";
      code: "SIGNED_BUNDLED_DOCKER_QUALIFICATION_AVAILABLE";
      capability: LocalOfflinePreviewBundledReleaseAuthority;
      toJSON(): LocalOfflinePreviewBundledReleaseSerializedClaim;
    }>
  | Readonly<{
      status: "unavailable";
      code:
        | "NO_DOCKER_QUALIFIED_BUNDLED_RELEASE"
        | "BUNDLED_RELEASE_MANIFEST_REJECTED";
      capability: null;
      rejectionCode: LocalOfflinePreviewBundledReleaseRejectionCode | null;
      toJSON(): LocalOfflinePreviewBundledReleaseSerializedClaim;
    }>;

interface ParsedPermitKey {
  readonly manifestKey: LocalOfflinePreviewBundledPermitKeyV1;
  readonly keyObject: KeyObject;
}

interface ParsedRelease {
  readonly payload: LocalOfflinePreviewBundledReleaseManifestPayloadV1;
  readonly payloadSha256: string;
  readonly permitKeys: readonly ParsedPermitKey[];
  readonly verifiedReleaseSigningKeyIds: readonly string[];
}

type PayloadParseResult =
  | Readonly<{
      ok: true;
      payload: LocalOfflinePreviewBundledReleaseManifestPayloadV1;
      permitKeys: readonly ParsedPermitKey[];
    }>
  | Readonly<{
      ok: false;
      code: LocalOfflinePreviewBundledReleaseRejectionCode;
    }>;

type ReportParseResult =
  | Readonly<{
      ok: true;
      report: LocalOfflinePreviewLiveQualificationReportV1;
    }>
  | Readonly<{
      ok: false;
      code: LocalOfflinePreviewBundledReleaseRejectionCode;
    }>;

type PublicKeyParseResult =
  | Readonly<{ ok: true; keyObject: KeyObject }>
  | Readonly<{
      ok: false;
      code: LocalOfflinePreviewBundledReleaseRejectionCode;
    }>;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const IMAGE_REFERENCE =
  /^[a-z0-9][a-z0-9._/-]{0,446}@sha256:[a-f0-9]{64}$/u;
const RELEASE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u;
const CANONICAL_UTC =
  /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAX_PERMIT_KEYS = 8;
const MAX_RELEASE_SIGNING_KEYS = 8;
const MAX_SPKI_DER_BYTES = 1024;
const MAX_SPKI_BASE64_CHARACTERS = 1_368;
const MAX_SIGNED_MANIFEST_BYTES = 512 * 1024;
const MAX_QUALIFICATION_RUNS = 10_000;

const PAYLOAD_KEYS = [
  "schemaVersion",
  "releaseId",
  "qualification",
  "dockerExecutable",
  "containerConfiguration",
  "imageRuntimeContract",
  "trustedPermitKeys",
] as const;
const QUALIFICATION_KEYS = ["kind", "report"] as const;
const REPORT_KEYS = ["payload", "reportSha256"] as const;
const REPORT_PAYLOAD_KEYS = [
  "schemaVersion",
  "status",
  "qualifiedAt",
  "imageReference",
  "imageId",
  "imageApprovalScope",
  "imageBuildQualificationStatus",
  "containerConfigurationSha256",
  "dockerExecutableArtifactSha256",
  "workerProtocolSha256",
  "workerArtifactSha256",
  "seccompProfileSha256",
  "watchdogArtifactSha256",
  "checks",
] as const;
const QUALIFICATION_CHECK_KEYS = [
  "successfulTransformAndFreshVerificationRuns",
  "successfulCancellationRuns",
  "networkModeNoneObserved",
  "readOnlyRootFilesystemObserved",
  "noHostMountsObserved",
  "nonRootUserObserved",
  "pid1WatchdogObserved",
  "freshContainerPerPhaseObserved",
  "cleanupAbsenceProved",
] as const;
const DOCKER_EXECUTABLE_KEYS = ["path", "artifactSha256"] as const;
const IMAGE_RUNTIME_KEYS = [
  "environment",
  "workingDirectory",
  "stopSignal",
] as const;
const PERMIT_KEY_KEYS = [
  "purpose",
  "algorithm",
  "keyId",
  "publicKeySpkiDerBase64",
  "publicKeySpkiSha256",
] as const;
const RELEASE_SIGNING_KEY_KEYS = PERMIT_KEY_KEYS;

const SERIALIZED_NON_AUTHORITY = Object.freeze({
  liveAuthorityCapable: false as const,
  authority: "none" as const,
  claimStatus: "unauthenticated_integrity_claim" as const,
  attestationAuthority: "none" as const,
  cryptographicallyAuthenticated: false as const,
});

const releaseAuthorityCapabilities = new WeakSet();
const releaseAuthorityMaterial = new WeakMap<object, ParsedRelease>();

function serializedNonAuthority():
LocalOfflinePreviewBundledReleaseSerializedClaim {
  return SERIALIZED_NON_AUTHORITY;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.enumerable === true
      );
    })
  );
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    right.every(
      (entry, index) =>
        Object.hasOwn(left, index) && left[index] === entry,
    )
  );
}

function isDenseJsonArray(value: readonly unknown[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function isCanonicalUtc(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}

function isCanonicalAbsolutePath(value: string): boolean {
  return isAbsolute(value) && normalize(value) === value &&
    resolve(value) === value;
}

function rawSha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(stableCanonicalJson(toCanonicalJson(value)), "utf8");
}

function digestReportPayload(
  payload: LocalOfflinePreviewLiveQualificationReportPayloadV1,
): string {
  return `sha256:${domainSeparatedSha256(
    LOCAL_OFFLINE_PREVIEW_LIVE_QUALIFICATION_REPORT_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  )}`;
}

function digestContainerConfiguration(
  configuration: LocalOfflinePreviewContainerConfiguration,
): string {
  return `sha256:${domainSeparatedSha256(
    LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_DIGEST_DOMAIN,
    toCanonicalJson(configuration),
  )}`;
}

function parseQualificationChecks(
  value: unknown,
): LocalOfflinePreviewLiveQualificationChecksV1 | null {
  if (!isPlainObject(value) ||
      !hasExactKeys(value, QUALIFICATION_CHECK_KEYS)) {
    return null;
  }
  const successfulRuns = value.successfulTransformAndFreshVerificationRuns;
  const cancellationRuns = value.successfulCancellationRuns;
  if (
    typeof successfulRuns !== "number" ||
    !Number.isSafeInteger(successfulRuns) ||
    successfulRuns < 1 ||
    successfulRuns > MAX_QUALIFICATION_RUNS ||
    typeof cancellationRuns !== "number" ||
    !Number.isSafeInteger(cancellationRuns) ||
    cancellationRuns < 1 ||
    cancellationRuns > MAX_QUALIFICATION_RUNS ||
    value.networkModeNoneObserved !== true ||
    value.readOnlyRootFilesystemObserved !== true ||
    value.noHostMountsObserved !== true ||
    value.nonRootUserObserved !== true ||
    value.pid1WatchdogObserved !== true ||
    value.freshContainerPerPhaseObserved !== true ||
    value.cleanupAbsenceProved !== true
  ) {
    return null;
  }
  return Object.freeze({
    successfulTransformAndFreshVerificationRuns: successfulRuns,
    successfulCancellationRuns: cancellationRuns,
    networkModeNoneObserved: true,
    readOnlyRootFilesystemObserved: true,
    noHostMountsObserved: true,
    nonRootUserObserved: true,
    pid1WatchdogObserved: true,
    freshContainerPerPhaseObserved: true,
    cleanupAbsenceProved: true,
  });
}

function parseQualificationReportPayload(
  value: unknown,
): LocalOfflinePreviewLiveQualificationReportPayloadV1 | null {
  if (!isPlainObject(value) || !hasExactKeys(value, REPORT_PAYLOAD_KEYS)) {
    return null;
  }
  const checks = parseQualificationChecks(value.checks);
  if (
    value.schemaVersion !==
      LOCAL_OFFLINE_PREVIEW_LIVE_QUALIFICATION_REPORT_V1 ||
    value.status !== "qualified" ||
    !isCanonicalUtc(value.qualifiedAt) ||
    typeof value.imageReference !== "string" ||
    !IMAGE_REFERENCE.test(value.imageReference) ||
    typeof value.imageId !== "string" ||
    !SHA256.test(value.imageId) ||
    value.imageApprovalScope !==
      LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_APPROVAL_SCOPE_V2 ||
    value.imageBuildQualificationStatus !==
      LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_BUILD_QUALIFICATION_STATUS_V2 ||
    typeof value.containerConfigurationSha256 !== "string" ||
    !SHA256.test(value.containerConfigurationSha256) ||
    typeof value.dockerExecutableArtifactSha256 !== "string" ||
    !SHA256.test(value.dockerExecutableArtifactSha256) ||
    typeof value.workerProtocolSha256 !== "string" ||
    !SHA256.test(value.workerProtocolSha256) ||
    typeof value.workerArtifactSha256 !== "string" ||
    !SHA256.test(value.workerArtifactSha256) ||
    typeof value.seccompProfileSha256 !== "string" ||
    !SHA256.test(value.seccompProfileSha256) ||
    typeof value.watchdogArtifactSha256 !== "string" ||
    !SHA256.test(value.watchdogArtifactSha256) ||
    checks === null
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    status: value.status,
    qualifiedAt: value.qualifiedAt,
    imageReference: value.imageReference,
    imageId: value.imageId,
    imageApprovalScope: value.imageApprovalScope,
    imageBuildQualificationStatus: value.imageBuildQualificationStatus,
    containerConfigurationSha256: value.containerConfigurationSha256,
    dockerExecutableArtifactSha256:
      value.dockerExecutableArtifactSha256,
    workerProtocolSha256: value.workerProtocolSha256,
    workerArtifactSha256: value.workerArtifactSha256,
    seccompProfileSha256: value.seccompProfileSha256,
    watchdogArtifactSha256: value.watchdogArtifactSha256,
    checks,
  });
}

function parseQualificationReport(value: unknown): ReportParseResult {
  if (!isPlainObject(value) || !hasExactKeys(value, REPORT_KEYS)) {
    return { ok: false, code: "QUALIFICATION_REPORT_REJECTED" };
  }
  const payload = parseQualificationReportPayload(value.payload);
  if (payload === null) {
    return { ok: false, code: "QUALIFICATION_REPORT_REJECTED" };
  }
  if (
    typeof value.reportSha256 !== "string" ||
    !SHA256.test(value.reportSha256) ||
    value.reportSha256 !== digestReportPayload(payload)
  ) {
    return {
      ok: false,
      code: "QUALIFICATION_REPORT_DIGEST_MISMATCH",
    };
  }
  return {
    ok: true,
    report: Object.freeze({
      payload,
      reportSha256: value.reportSha256,
    }),
  };
}

function parseQualification(
  value: unknown,
):
  | Readonly<{
      ok: true;
      qualification: LocalOfflinePreviewBundledReleaseQualificationV1;
    }>
  | Readonly<{
      ok: false;
      code: LocalOfflinePreviewBundledReleaseRejectionCode;
    }> {
  if (!isPlainObject(value) || !hasExactKeys(value, QUALIFICATION_KEYS) ||
      value.kind !== "docker_live_offline_preview_v1") {
    return { ok: false, code: "MANIFEST_PAYLOAD_REJECTED" };
  }
  const report = parseQualificationReport(value.report);
  return report.ok
    ? {
        ok: true,
        qualification: Object.freeze({
          kind: value.kind,
          report: report.report,
        }),
      }
    : report;
}

function parseDockerExecutable(
  value: unknown,
  configuration: LocalOfflinePreviewContainerConfiguration,
): LocalOfflinePreviewBundledDockerExecutableV1 | null {
  if (!isPlainObject(value) || !hasExactKeys(value, DOCKER_EXECUTABLE_KEYS)) {
    return null;
  }
  if (
    value.path !== configuration.dockerExecutablePath ||
    typeof value.path !== "string" ||
    !isCanonicalAbsolutePath(value.path) ||
    typeof value.artifactSha256 !== "string" ||
    !SHA256.test(value.artifactSha256)
  ) {
    return null;
  }
  return Object.freeze({
    path: value.path,
    artifactSha256: value.artifactSha256,
  });
}

function parseImageRuntimeContract(
  value: unknown,
): LocalOfflinePreviewBundledImageRuntimeContractV1 | null {
  if (!isPlainObject(value) || !hasExactKeys(value, IMAGE_RUNTIME_KEYS)) {
    return null;
  }
  if (
    !Array.isArray(value.environment) ||
    !isDenseJsonArray(value.environment) ||
    !value.environment.every(
      (entry): entry is string => typeof entry === "string",
    ) ||
    !arraysEqual(
      value.environment,
      LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2,
    ) ||
    value.workingDirectory !==
      LOCAL_OFFLINE_PREVIEW_CONTAINER_WORKING_DIRECTORY_V2 ||
    value.stopSignal !== LOCAL_OFFLINE_PREVIEW_CONTAINER_STOP_SIGNAL_V2
  ) {
    return null;
  }
  return Object.freeze({
    environment: Object.freeze([...value.environment]),
    workingDirectory: value.workingDirectory,
    stopSignal: value.stopSignal,
  });
}

function parseEd25519PublicKey(
  spkiDerBase64: string,
  expectedFingerprint: string,
  rejectionCode: LocalOfflinePreviewBundledReleaseRejectionCode,
): PublicKeyParseResult {
  const spki = Buffer.from(spkiDerBase64, "base64");
  if (
    spki.byteLength === 0 ||
    spki.byteLength > MAX_SPKI_DER_BYTES ||
    spki.toString("base64") !== spkiDerBase64
  ) {
    return { ok: false, code: rejectionCode };
  }
  try {
    const keyObject = createPublicKey({
      key: spki,
      format: "der",
      type: "spki",
    });
    const canonicalSpki = keyObject.export({ format: "der", type: "spki" });
    if (
      keyObject.asymmetricKeyType !== "ed25519" ||
      !Buffer.isBuffer(canonicalSpki) ||
      !canonicalSpki.equals(spki)
    ) {
      return { ok: false, code: rejectionCode };
    }
    if (rawSha256(spki) !== expectedFingerprint) {
      return {
        ok: false,
        code: rejectionCode === "MANIFEST_TRUST_ROOT_REJECTED"
          ? rejectionCode
          : "MANIFEST_PERMIT_KEY_FINGERPRINT_MISMATCH",
      };
    }
    return { ok: true, keyObject };
  } catch {
    return { ok: false, code: rejectionCode };
  }
}

function parsePermitKey(value: unknown):
  | Readonly<{ ok: true; key: ParsedPermitKey }>
  | Readonly<{
      ok: false;
      code: LocalOfflinePreviewBundledReleaseRejectionCode;
    }> {
  if (!isPlainObject(value) || !hasExactKeys(value, PERMIT_KEY_KEYS)) {
    return { ok: false, code: "MANIFEST_PERMIT_KEY_REJECTED" };
  }
  if (
    value.purpose !== "offline_normalization_preview_permit" ||
    value.algorithm !== "Ed25519" ||
    typeof value.keyId !== "string" ||
    !KEY_ID.test(value.keyId) ||
    typeof value.publicKeySpkiDerBase64 !== "string" ||
    value.publicKeySpkiDerBase64.length === 0 ||
    value.publicKeySpkiDerBase64.length > MAX_SPKI_BASE64_CHARACTERS ||
    !CANONICAL_BASE64.test(value.publicKeySpkiDerBase64) ||
    typeof value.publicKeySpkiSha256 !== "string" ||
    !SHA256.test(value.publicKeySpkiSha256)
  ) {
    return { ok: false, code: "MANIFEST_PERMIT_KEY_REJECTED" };
  }
  const publicKey = parseEd25519PublicKey(
    value.publicKeySpkiDerBase64,
    value.publicKeySpkiSha256,
    "MANIFEST_PERMIT_KEY_REJECTED",
  );
  if (!publicKey.ok) return publicKey;
  const manifestKey = Object.freeze({
    purpose: value.purpose,
    algorithm: value.algorithm,
    keyId: value.keyId,
    publicKeySpkiDerBase64: value.publicKeySpkiDerBase64,
    publicKeySpkiSha256: value.publicKeySpkiSha256,
  });
  return {
    ok: true,
    key: Object.freeze({ manifestKey, keyObject: publicKey.keyObject }),
  };
}

function parsePermitKeys(value: unknown):
  | Readonly<{ ok: true; keys: readonly ParsedPermitKey[] }>
  | Readonly<{
      ok: false;
      code: LocalOfflinePreviewBundledReleaseRejectionCode;
    }> {
  if (
    !Array.isArray(value) ||
    !isDenseJsonArray(value) ||
    value.length === 0 ||
    value.length > MAX_PERMIT_KEYS
  ) {
    return { ok: false, code: "MANIFEST_PERMIT_KEY_REJECTED" };
  }
  const keys: ParsedPermitKey[] = [];
  const fingerprints = new Set<string>();
  let previousKeyId: string | null = null;
  for (const input of value) {
    const parsed = parsePermitKey(input);
    if (!parsed.ok) return parsed;
    const { keyId, publicKeySpkiSha256 } = parsed.key.manifestKey;
    if (
      (previousKeyId !== null && keyId <= previousKeyId) ||
      fingerprints.has(publicKeySpkiSha256)
    ) {
      return { ok: false, code: "MANIFEST_PERMIT_KEY_ORDER_REJECTED" };
    }
    previousKeyId = keyId;
    fingerprints.add(publicKeySpkiSha256);
    keys.push(parsed.key);
  }
  return { ok: true, keys: Object.freeze(keys) };
}

function qualificationBindingsMatch(
  report: LocalOfflinePreviewLiveQualificationReportV1,
  configuration: LocalOfflinePreviewContainerConfiguration,
  dockerExecutable: LocalOfflinePreviewBundledDockerExecutableV1,
): boolean {
  const payload = report.payload;
  return (
    payload.imageReference === configuration.imageReference &&
    payload.imageId === configuration.imageId &&
    payload.containerConfigurationSha256 ===
      digestContainerConfiguration(configuration) &&
    payload.dockerExecutableArtifactSha256 ===
      dockerExecutable.artifactSha256 &&
    payload.workerProtocolSha256 === configuration.workerProtocolSha256 &&
    payload.workerArtifactSha256 === configuration.workerArtifactSha256 &&
    payload.seccompProfileSha256 === configuration.seccompProfileSha256 &&
    payload.watchdogArtifactSha256 ===
      configuration.runtimeWatchdog.artifactSha256
  );
}

function parsePayload(value: unknown): PayloadParseResult {
  if (!isPlainObject(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
    return { ok: false, code: "MANIFEST_PAYLOAD_REJECTED" };
  }
  if (
    value.schemaVersion !== LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_MANIFEST_V1 ||
    typeof value.releaseId !== "string" ||
    !RELEASE_ID.test(value.releaseId)
  ) {
    return { ok: false, code: "MANIFEST_PAYLOAD_REJECTED" };
  }
  const qualification = parseQualification(value.qualification);
  if (!qualification.ok) return qualification;
  const configuration = parseLocalOfflinePreviewContainerConfiguration(
    value.containerConfiguration,
  );
  if (
    configuration === null ||
    !isCanonicalAbsolutePath(configuration.seccompProfilePath)
  ) {
    return { ok: false, code: "MANIFEST_CONFIGURATION_REJECTED" };
  }
  const dockerExecutable = parseDockerExecutable(
    value.dockerExecutable,
    configuration,
  );
  if (dockerExecutable === null) {
    return { ok: false, code: "MANIFEST_DOCKER_EXECUTABLE_REJECTED" };
  }
  const imageRuntimeContract = parseImageRuntimeContract(
    value.imageRuntimeContract,
  );
  if (imageRuntimeContract === null) {
    return { ok: false, code: "MANIFEST_IMAGE_RUNTIME_REJECTED" };
  }
  const permitKeys = parsePermitKeys(value.trustedPermitKeys);
  if (!permitKeys.ok) return permitKeys;
  if (!qualificationBindingsMatch(
    qualification.qualification.report,
    configuration,
    dockerExecutable,
  )) {
    return {
      ok: false,
      code: "QUALIFICATION_REPORT_BINDING_MISMATCH",
    };
  }
  const payload = Object.freeze({
    schemaVersion: value.schemaVersion,
    releaseId: value.releaseId,
    qualification: qualification.qualification,
    dockerExecutable,
    containerConfiguration: configuration,
    imageRuntimeContract,
    trustedPermitKeys: Object.freeze(
      permitKeys.keys.map((entry) => entry.manifestKey),
    ),
  });
  return { ok: true, payload, permitKeys: permitKeys.keys };
}

function snapshotTrustedReleaseKeys(
  trustedKeysInput: unknown,
): ReadonlyMap<string, KeyObject> | null {
  try {
    if (!(trustedKeysInput instanceof Map) ||
        Object.getPrototypeOf(trustedKeysInput) !== Map.prototype ||
        Reflect.ownKeys(trustedKeysInput).length !== 0 ||
        trustedKeysInput.size === 0 ||
        trustedKeysInput.size > MAX_RELEASE_SIGNING_KEYS) {
      return null;
    }
    const trustedKeys = new Map<string, KeyObject>();
    const fingerprints = new Set<string>();
    for (const [keyId, rawKey] of trustedKeysInput) {
      if (typeof keyId !== "string" || !KEY_ID.test(keyId) ||
          typeof rawKey !== "object" || rawKey === null) {
        return null;
      }
      const key = rawKey as KeyObject;
      if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
        return null;
      }
      const spki = key.export({ format: "der", type: "spki" });
      if (!Buffer.isBuffer(spki)) return null;
      const fingerprint = rawSha256(spki);
      if (fingerprints.has(fingerprint)) return null;
      fingerprints.add(fingerprint);
      trustedKeys.set(keyId, key);
    }
    return trustedKeys;
  } catch {
    return null;
  }
}

function parseGeneratedTrustRoot(
  value: unknown,
): ReadonlyMap<string, KeyObject> | null {
  try {
    if (!Array.isArray(value) || !isDenseJsonArray(value) ||
        value.length === 0 || value.length > MAX_RELEASE_SIGNING_KEYS) {
      return null;
    }
    const trustedKeys = new Map<string, KeyObject>();
    const fingerprints = new Set<string>();
    let previousKeyId: string | null = null;
    for (const rawRecord of value) {
      if (!isPlainObject(rawRecord) ||
          !hasExactKeys(rawRecord, RELEASE_SIGNING_KEY_KEYS) ||
          rawRecord.purpose !== "offline_normalization_preview_release" ||
          rawRecord.algorithm !== "Ed25519" ||
          typeof rawRecord.keyId !== "string" ||
          !KEY_ID.test(rawRecord.keyId) ||
          typeof rawRecord.publicKeySpkiDerBase64 !== "string" ||
          rawRecord.publicKeySpkiDerBase64.length === 0 ||
          rawRecord.publicKeySpkiDerBase64.length >
            MAX_SPKI_BASE64_CHARACTERS ||
          !CANONICAL_BASE64.test(rawRecord.publicKeySpkiDerBase64) ||
          typeof rawRecord.publicKeySpkiSha256 !== "string" ||
          !SHA256.test(rawRecord.publicKeySpkiSha256) ||
          (previousKeyId !== null && rawRecord.keyId <= previousKeyId) ||
          fingerprints.has(rawRecord.publicKeySpkiSha256)) {
        return null;
      }
      const parsed = parseEd25519PublicKey(
        rawRecord.publicKeySpkiDerBase64,
        rawRecord.publicKeySpkiSha256,
        "MANIFEST_TRUST_ROOT_REJECTED",
      );
      if (!parsed.ok) return null;
      previousKeyId = rawRecord.keyId;
      fingerprints.add(rawRecord.publicKeySpkiSha256);
      trustedKeys.set(rawRecord.keyId, parsed.keyObject);
    }
    return trustedKeys;
  } catch {
    return null;
  }
}

function parseCanonicalSignedPayload(
  bytes: Uint8Array,
): PayloadParseResult {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SIGNED_MANIFEST_BYTES) {
    return { ok: false, code: "MANIFEST_PAYLOAD_REJECTED" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    const parsed = parsePayload(value);
    if (!parsed.ok) return parsed;
    if (!canonicalBytes(parsed.payload).equals(Buffer.from(bytes))) {
      return { ok: false, code: "MANIFEST_CANONICAL_BYTES_REJECTED" };
    }
    return parsed;
  } catch {
    return { ok: false, code: "MANIFEST_PAYLOAD_REJECTED" };
  }
}

class VerifiedBundledReleaseAuthority implements
LocalOfflinePreviewBundledReleaseAuthority {
  declare readonly [BUNDLED_RELEASE_AUTHORITY_BRAND]: true;
  readonly #releaseId: string;
  readonly #releaseManifestSha256: string;
  readonly #verifiedReleaseSigningKeyIds: readonly string[];

  constructor(release: ParsedRelease) {
    this.#releaseId = release.payload.releaseId;
    this.#releaseManifestSha256 = release.payloadSha256;
    this.#verifiedReleaseSigningKeyIds = Object.freeze([
      ...release.verifiedReleaseSigningKeyIds,
    ]);
    releaseAuthorityCapabilities.add(this);
    releaseAuthorityMaterial.set(this, release);
    Object.freeze(this);
  }

  get authority(): "cryptographically_verified_bundled_release" {
    return "cryptographically_verified_bundled_release";
  }

  get liveAuthorityCapable(): true {
    return true;
  }

  get releaseId(): string {
    return this.#releaseId;
  }

  get releaseManifestSha256(): string {
    return this.#releaseManifestSha256;
  }

  get verifiedReleaseSigningKeyIds(): readonly string[] {
    return this.#verifiedReleaseSigningKeyIds;
  }

  toJSON(): LocalOfflinePreviewBundledReleaseSerializedClaim {
    return serializedNonAuthority();
  }
}

Object.freeze(VerifiedBundledReleaseAuthority.prototype);

function unavailableLookup(
  code:
    | "NO_DOCKER_QUALIFIED_BUNDLED_RELEASE"
    | "BUNDLED_RELEASE_MANIFEST_REJECTED",
  rejectionCode: LocalOfflinePreviewBundledReleaseRejectionCode | null,
): LocalOfflinePreviewBundledReleaseLookup {
  return Object.freeze({
    status: "unavailable" as const,
    code,
    capability: null,
    rejectionCode,
    toJSON: serializedNonAuthority,
  });
}

/**
 * Verifies one exact canonical DSSE payload against an explicit, process-owned
 * Ed25519 trust root. A self-digest, embedded public key, or report hash is
 * never accepted as authority.
 */
export function verifyLocalOfflinePreviewBundledRelease(
  signedEnvelopeInput: unknown,
  trustedReleaseKeysInput: unknown,
): LocalOfflinePreviewBundledReleaseLookup {
  const trustedKeys = snapshotTrustedReleaseKeys(trustedReleaseKeysInput);
  if (trustedKeys === null) {
    return unavailableLookup(
      "BUNDLED_RELEASE_MANIFEST_REJECTED",
      "MANIFEST_TRUST_ROOT_REJECTED",
    );
  }
  try {
    const envelope = DsseEnvelopeSchema.safeParse(signedEnvelopeInput);
    if (!envelope.success ||
        envelope.data.payload.length > Math.ceil(MAX_SIGNED_MANIFEST_BYTES / 3) * 4 + 4) {
      return unavailableLookup(
        "BUNDLED_RELEASE_MANIFEST_REJECTED",
        "MANIFEST_SHAPE_REJECTED",
      );
    }
    const payloadBytes = Buffer.from(envelope.data.payload, "base64");
    if (payloadBytes.byteLength === 0 ||
        payloadBytes.byteLength > MAX_SIGNED_MANIFEST_BYTES) {
      payloadBytes.fill(0);
      return unavailableLookup(
        "BUNDLED_RELEASE_MANIFEST_REJECTED",
        "MANIFEST_PAYLOAD_REJECTED",
      );
    }
    const payloadSha256Hex = createHash("sha256")
      .update(payloadBytes)
      .digest("hex");
    let verified: ReturnType<typeof verifyDsseEnvelope>;
    try {
      verified = verifyDsseEnvelope(envelope.data, trustedKeys, {
        payloadType: LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_DSSE_PAYLOAD_TYPE,
        payloadSha256: payloadSha256Hex,
      });
    } catch {
      payloadBytes.fill(0);
      return unavailableLookup(
        "BUNDLED_RELEASE_MANIFEST_REJECTED",
        "MANIFEST_SIGNATURE_REJECTED",
      );
    }
    payloadBytes.fill(0);
    const parsed = parseCanonicalSignedPayload(verified.payload);
    if (!parsed.ok) return unavailableLookup(
      "BUNDLED_RELEASE_MANIFEST_REJECTED",
      parsed.code,
    );
    const release = Object.freeze({
      payload: parsed.payload,
      payloadSha256: `sha256:${verified.payloadSha256}`,
      permitKeys: parsed.permitKeys,
      verifiedReleaseSigningKeyIds: Object.freeze([
        ...verified.verifiedKeyIds,
      ]),
    });
    const capability = new VerifiedBundledReleaseAuthority(release);
    return Object.freeze({
      status: "available" as const,
      code: "SIGNED_BUNDLED_DOCKER_QUALIFICATION_AVAILABLE" as const,
      capability,
      toJSON: serializedNonAuthority,
    });
  } catch {
    return unavailableLookup(
      "BUNDLED_RELEASE_MANIFEST_REJECTED",
      "MANIFEST_SHAPE_REJECTED",
    );
  }
}

let productionLookup: LocalOfflinePreviewBundledReleaseLookup | null = null;

/**
 * Returns only the signed release and trust root compiled into the app. It
 * accepts no runtime manifest, report, path, image, digest, or keyring input.
 */
export function getLocalOfflinePreviewBundledReleaseAuthority():
LocalOfflinePreviewBundledReleaseLookup {
  if (productionLookup !== null) return productionLookup;
  if (LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_MANIFEST === null) {
    productionLookup = unavailableLookup(
      "NO_DOCKER_QUALIFIED_BUNDLED_RELEASE",
      null,
    );
    return productionLookup;
  }
  const trustedKeys = parseGeneratedTrustRoot(
    LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_TRUST_ROOT,
  );
  if (trustedKeys === null) {
    productionLookup = unavailableLookup(
      "BUNDLED_RELEASE_MANIFEST_REJECTED",
      "MANIFEST_TRUST_ROOT_REJECTED",
    );
    return productionLookup;
  }
  productionLookup = verifyLocalOfflinePreviewBundledRelease(
    LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_MANIFEST,
    trustedKeys,
  );
  return productionLookup;
}

export function isLocalOfflinePreviewBundledReleaseAuthority(
  value: unknown,
): value is LocalOfflinePreviewBundledReleaseAuthority {
  return typeof value === "object" && value !== null &&
    releaseAuthorityCapabilities.has(value);
}

/** Extracts fixed execution material only from a verified signed capability. */
export function readLocalOfflinePreviewBundledReleaseMaterial(
  capability: unknown,
): LocalOfflinePreviewBundledReleaseMaterial | null {
  if (typeof capability !== "object" || capability === null ||
      !releaseAuthorityCapabilities.has(capability)) {
    return null;
  }
  const release = releaseAuthorityMaterial.get(capability);
  if (release === undefined) return null;
  const payload = release.payload;
  return Object.freeze({
    releaseId: payload.releaseId,
    releaseManifestSha256: release.payloadSha256,
    qualificationReportSha256:
      payload.qualification.report.reportSha256,
    dockerExecutableArtifactSha256:
      payload.dockerExecutable.artifactSha256,
    containerConfiguration: payload.containerConfiguration,
    pinnedTrustedPermitKeys: new Map(
      release.permitKeys.map((entry) => [
        entry.manifestKey.keyId,
        entry.keyObject,
      ]),
    ),
  });
}

/**
 * Canonical digest helper for release generation. It validates every payload
 * field and report binding but never authenticates or installs authority.
 */
export function computeLocalOfflinePreviewBundledReleaseManifestSha256(
  payloadInput: unknown,
): string | null {
  try {
    const parsed = parsePayload(payloadInput);
    return parsed.ok ? rawSha256(canonicalBytes(parsed.payload)) : null;
  } catch {
    return null;
  }
}

/** Report self-consistency helper. A matching digest is never authority. */
export function computeLocalOfflinePreviewLiveQualificationReportSha256(
  payloadInput: unknown,
): string | null {
  try {
    const parsed = parseQualificationReportPayload(payloadInput);
    return parsed === null ? null : digestReportPayload(parsed);
  } catch {
    return null;
  }
}

/** Configuration binding helper for the external live qualification runner. */
export function computeLocalOfflinePreviewContainerConfigurationSha256(
  configurationInput: unknown,
): string | null {
  try {
    const parsed = parseLocalOfflinePreviewContainerConfiguration(
      configurationInput,
    );
    return parsed === null ? null : digestContainerConfiguration(parsed);
  } catch {
    return null;
  }
}

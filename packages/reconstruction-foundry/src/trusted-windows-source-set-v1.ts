import { createHmac, timingSafeEqual } from "node:crypto";
import { win32 } from "node:path";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import {
  TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0,
  type TrustedWindowsExistingOutputDirectoryBoundaryV0,
  type TrustedWindowsExistingOutputDirectoryPathEvidenceV0,
  type TrustedWindowsSourceIdentityV0,
  type TrustedWindowsSourcePathAcquisitionV0,
  type TrustedWindowsSourceSelectionV0,
} from "./trusted-windows-source-set-v0.js";

export const TRUSTED_WINDOWS_SOURCE_SET_INPUT_SCHEMA_VERSION_V1 =
  "trusted-windows-native-source-set-input.v1";
export const TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_SCHEMA_VERSION_V1 =
  "trusted-windows-source-set-manifest.v1";
export const TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_DIGEST_DOMAIN_V1 =
  "OMNITWIN.TRUSTED_WINDOWS_SOURCE_SET_MANIFEST.V1";
export const TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1 = Object.freeze({
  ...TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0,
  maxFilesPerSelection: 100_000,
  maxDiscoveredFiles: 100_000,
});

const SELECTION_IDENTITY_SET_DIGEST_DOMAIN =
  "OMNITWIN.TRUSTED_WINDOWS_SELECTION_IDENTITY_SET.V1";
const GLOBAL_IDENTITY_SET_DIGEST_DOMAIN =
  "OMNITWIN.TRUSTED_WINDOWS_GLOBAL_IDENTITY_SET.V1";
const PATH_COMPARISON_TRANSCRIPT_DIGEST_DOMAIN =
  "OMNITWIN.TRUSTED_WINDOWS_PATH_COMPARISON_TRANSCRIPT.V1";
const SOURCE_DIGEST_DOMAIN = "OMNITWIN.TRUSTED_WINDOWS_SOURCE_DIGEST.V1";
const SOURCE_SET_DIGEST_DOMAIN = "OMNITWIN.TRUSTED_WINDOWS_SOURCE_SET_DIGEST.V1";
const PUBLIC_SELECTION_IDENTITY_COMMITMENT_DOMAIN =
  "OMNITWIN.TRUSTED_WINDOWS_PUBLIC_SELECTION_IDENTITY_COMMITMENT.V1";
const PUBLIC_GLOBAL_IDENTITY_COMMITMENT_DOMAIN =
  "OMNITWIN.TRUSTED_WINDOWS_PUBLIC_GLOBAL_IDENTITY_COMMITMENT.V1";
const PUBLIC_COMPARISON_TRANSCRIPT_COMMITMENT_DOMAIN =
  "OMNITWIN.TRUSTED_WINDOWS_PUBLIC_COMPARISON_TRANSCRIPT_COMMITMENT.V1";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const NONCE = /^[a-f0-9]{64}$/u;
const ADAPTER_ID = /^[a-z0-9][a-z0-9._-]{2,95}$/u;
const VOLUME_SERIAL = /^[A-F0-9]{16}$/u;
const FILE_ID = /^[A-F0-9]{32}$/u;
const BYTE_COUNT = /^(?:0|[1-9][0-9]*)$/u;
const MAX_BYTE_COUNT_DIGITS = 32;
const MAX_WINDOWS_PATH_CODE_UNITS = 32_767;
const MAX_WINDOWS_SEGMENT_CODE_UNITS = 255;
const WINDOWS_INVALID_SEGMENT = /[<>:"/\\|?*]/u;
const WINDOWS_BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/u;
const WINDOWS_RESERVED_BASENAME = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM(?:[1-9]|[¹²³])|LPT(?:[1-9]|[¹²³]))$/u;

export type TrustedWindowsSourceIdentityV1 = TrustedWindowsSourceIdentityV0;

/**
 * Private point-in-time evidence that an opened Windows handle belongs to a
 * direct local fixed or removable volume. Raw DOS-device targets are never
 * retained; the native helper emits only these closed classifications.
 */
export interface TrustedWindowsLocalVolumeEvidenceV1 {
  readonly openedHandleFileType: "FILE_TYPE_DISK";
  readonly volumePathResolution: "get_volume_path_name_w";
  readonly driveTypeQuery: "get_drive_type_w";
  readonly driveType: "DRIVE_FIXED" | "DRIVE_REMOVABLE";
  readonly dosDeviceQuery: "query_dos_device_w";
  readonly dosDeviceMapping: "direct_local_volume";
  readonly dosDeviceAliasChainDetected: false;
  readonly substTargetDetected: false;
  readonly uncRedirectorDetected: false;
  readonly networkDeviceTargetDetected: false;
  readonly openedHandleVolumeCorroboration:
    "file_id_info_volume_serial_matches_opened_volume_root_handle";
  readonly openedHandleVolumeSerialNumberHex: string;
  readonly volumeRootHandleSerialNumberHex: string;
}

export interface TrustedWindowsExistingOutputDirectoryBoundaryV1
  extends TrustedWindowsExistingOutputDirectoryBoundaryV0 {
  readonly localVolumeEvidence: TrustedWindowsLocalVolumeEvidenceV1;
}

export interface TrustedWindowsInventoryIdentityEvidenceV1 {
  readonly identityComparisonMechanism: "windows_volume_serial_plus_file_id_128";
  readonly identityCount: number;
  readonly duplicateIdentityCount: 0;
  readonly identitySetSha256: string;
}

export interface TrustedWindowsSourceSelectionV1 extends TrustedWindowsSourceSelectionV0 {
  readonly localVolumeEvidence: TrustedWindowsLocalVolumeEvidenceV1;
  readonly inventoryFileIdentities: readonly TrustedWindowsSourceIdentityV1[];
  readonly inventoryIdentityEvidence: TrustedWindowsInventoryIdentityEvidenceV1;
}

export interface TrustedWindowsCrossSelectionIdentityEvidenceV1 {
  readonly identityComparisonMechanism: "windows_volume_serial_plus_file_id_128";
  readonly checkedIdentityCount: number;
  readonly duplicateIdentityCount: 0;
  readonly globalIdentitySetSha256: string;
}

export interface TrustedWindowsSourcePairComparisonV1 {
  readonly leftSelectionIndex: number;
  readonly rightSelectionIndex: number;
  readonly relation: "disjoint";
}

export interface TrustedWindowsOutputPairComparisonV1 {
  readonly selectionIndex: number;
  readonly relation: "disjoint";
}

export interface TrustedWindowsNativePathComparisonsV1 {
  readonly sourcePairs: readonly TrustedWindowsSourcePairComparisonV1[];
  readonly outputPairs: readonly TrustedWindowsOutputPairComparisonV1[];
}

export interface TrustedWindowsAdapterEvidenceV1 {
  readonly adapterId: string;
  readonly adapterBuildSha256: string;
  readonly identityComparisonMechanism: "windows_volume_serial_plus_file_id_128";
  readonly pathComparisonMechanism: "windows_compare_string_ordinal_ignore_case";
  readonly comparisonTranscriptSha256: string;
}

export interface TrustedWindowsNativeSourceSetInputV1 {
  readonly schemaVersion: typeof TRUSTED_WINDOWS_SOURCE_SET_INPUT_SCHEMA_VERSION_V1;
  readonly origin: "trusted_windows_native_launcher";
  readonly browserPathInputAccepted: false;
  readonly sessionNonceHex: string;
  readonly outputBoundary: TrustedWindowsExistingOutputDirectoryBoundaryV1;
  readonly selections: readonly TrustedWindowsSourceSelectionV1[];
  readonly adapterEvidence: TrustedWindowsAdapterEvidenceV1;
  readonly crossSelectionIdentityEvidence: TrustedWindowsCrossSelectionIdentityEvidenceV1;
  readonly nativePathComparisons: TrustedWindowsNativePathComparisonsV1;
}

export interface TrustedWindowsPathComparisonTranscriptInputV1 {
  readonly adapterId: string;
  readonly adapterBuildSha256: string;
  readonly identityComparisonMechanism: "windows_volume_serial_plus_file_id_128";
  readonly pathComparisonMechanism: "windows_compare_string_ordinal_ignore_case";
  readonly sourceCanonicalAbsolutePaths: readonly string[];
  readonly outputCanonicalAbsolutePath: string;
  readonly nativePathComparisons: TrustedWindowsNativePathComparisonsV1;
}

export interface TrustedWindowsSourceDigestSummaryV1 {
  readonly basketPosition: number;
  readonly sourceDigestSha256: string;
  readonly fileCount: number;
  readonly byteCountDecimal: string;
  readonly inventoryIdentityCount: number;
  readonly inventoryIdentitySetSha256: string;
}

export interface TrustedWindowsNativeSourceSetManifestV1 {
  readonly schemaVersion: typeof TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_SCHEMA_VERSION_V1;
  readonly authority: "none";
  readonly use: "inspection_only";
  readonly sourceSetDigestSha256: string;
  readonly sources: readonly TrustedWindowsSourceDigestSummaryV1[];
  readonly totals: {
    readonly selectedRoots: number;
    readonly discoveredFiles: number;
    readonly totalBytesDecimal: string;
    readonly inventoryIdentityCount: number;
  };
  readonly nativeEvidence: {
    readonly adapterBuildSha256: string;
    readonly comparisonTranscriptSha256: string;
    readonly checkedIdentityCount: number;
    readonly globalIdentitySetSha256: string;
    readonly sourcePairCount: number;
    readonly outputPairCount: number;
    readonly localVolumeProof: {
      readonly checkedBoundaryCount: number;
      readonly openedHandleFileType: "FILE_TYPE_DISK";
      readonly acceptedDriveTypes: "DRIVE_FIXED_OR_REMOVABLE";
      readonly dosDeviceMapping: "QUERY_DOS_DEVICE_DIRECT_LOCAL_VOLUME";
      readonly openedHandleVolumeCorroboration:
        "FILE_ID_INFO_VOLUME_SERIAL_MATCHES_OPENED_VOLUME_ROOT_HANDLE";
    };
  };
  readonly limits: typeof TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1;
  readonly manifestDigestSha256: string;
}

export type TrustedWindowsSourceSetV1ErrorCode =
  | "INVALID_PAYLOAD"
  | "MISSING_REQUIRED_FIELD"
  | "UNEXPECTED_FIELD"
  | "INVALID_DENSE_ARRAY"
  | "INVALID_SCHEMA_VERSION"
  | "INVALID_ADAPTER_EVIDENCE"
  | "INVALID_IDENTITY_EVIDENCE"
  | "INVALID_LOCAL_VOLUME_EVIDENCE"
  | "SELECTION_IDENTITY_COUNT_MISMATCH"
  | "FILE_ROOT_IDENTITY_MISMATCH"
  | "SELECTION_IDENTITY_DUPLICATE"
  | "SELECTION_ROOT_IDENTITY_DUPLICATE"
  | "SELECTION_IDENTITY_EVIDENCE_MISMATCH"
  | "CROSS_SELECTION_IDENTITY_DUPLICATE"
  | "CROSS_SELECTION_IDENTITY_EVIDENCE_MISMATCH"
  | "OUTPUT_SOURCE_IDENTITY_DUPLICATE"
  | "PATH_COMPARISON_COVERAGE_MISMATCH"
  | "COMPARISON_TRANSCRIPT_MISMATCH"
  | "BASE_CONTRACT_REJECTED"
  | "INVALID_MANIFEST";

const ERROR_MESSAGES: Readonly<Record<TrustedWindowsSourceSetV1ErrorCode, string>> = Object.freeze({
  INVALID_PAYLOAD: "The trusted native V1 source set has an invalid shape.",
  MISSING_REQUIRED_FIELD: "The trusted native V1 source set is missing a required field.",
  UNEXPECTED_FIELD: "The trusted native V1 source set contains a field this contract does not accept.",
  INVALID_DENSE_ARRAY: "A trusted native V1 evidence list is sparse, accessor-backed, or has extra members.",
  INVALID_SCHEMA_VERSION: "The trusted native source set uses an unsupported V1 schema version.",
  INVALID_ADAPTER_EVIDENCE: "The trusted Windows adapter evidence is incomplete or malformed.",
  INVALID_IDENTITY_EVIDENCE: "A Windows file identity is incomplete or malformed.",
  INVALID_LOCAL_VOLUME_EVIDENCE: "The direct local Windows volume evidence is incomplete or malformed.",
  SELECTION_IDENTITY_COUNT_MISMATCH: "A selected source does not contain the declared number of file identities.",
  FILE_ROOT_IDENTITY_MISMATCH: "A selected file does not match its opened Windows file identity.",
  SELECTION_IDENTITY_DUPLICATE: "One selected source repeats an underlying Windows file identity.",
  SELECTION_ROOT_IDENTITY_DUPLICATE: "Two selected sources have the same underlying Windows root identity.",
  SELECTION_IDENTITY_EVIDENCE_MISMATCH: "A selected source identity count or digest does not match its private evidence.",
  CROSS_SELECTION_IDENTITY_DUPLICATE: "Two selected sources contain the same underlying Windows file.",
  CROSS_SELECTION_IDENTITY_EVIDENCE_MISMATCH: "The global identity count or digest does not match the selected sources.",
  OUTPUT_SOURCE_IDENTITY_DUPLICATE: "The output directory is the same underlying Windows object as a selected source.",
  PATH_COMPARISON_COVERAGE_MISMATCH: "Native path comparisons do not cover every source and output pair exactly once.",
  COMPARISON_TRANSCRIPT_MISMATCH: "The native path comparison transcript does not match the exact private source set.",
  BASE_CONTRACT_REJECTED: "The trusted source set does not satisfy the strict Windows V0 safety boundary.",
  INVALID_MANIFEST: "The public V1 source-set manifest is malformed or internally inconsistent.",
});

export class TrustedWindowsSourceSetV1ValidationError extends Error {
  readonly code: TrustedWindowsSourceSetV1ErrorCode;

  constructor(code: TrustedWindowsSourceSetV1ErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "TrustedWindowsSourceSetV1ValidationError";
    this.code = code;
  }
}

interface ParsedV1Input extends TrustedWindowsNativeSourceSetInputV1 {
  readonly selections: readonly TrustedWindowsSourceSelectionV1[];
}

function fail(code: TrustedWindowsSourceSetV1ErrorCode): never {
  throw new TrustedWindowsSourceSetV1ValidationError(code);
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("INVALID_PAYLOAD");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail("INVALID_PAYLOAD");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return fail("UNEXPECTED_FIELD");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      return fail("INVALID_PAYLOAD");
    }
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Readonly<Record<string, unknown>>, expected: readonly string[]): void {
  const keys = Object.keys(record);
  const expectedSet = new Set(expected);
  if (keys.some((key) => !expectedSet.has(key))) fail("UNEXPECTED_FIELD");
  if (expected.some((key) => !Object.hasOwn(record, key))) fail("MISSING_REQUIRED_FIELD");
}

function denseArray(
  value: unknown,
  maximumLength: number = TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxDiscoveredFiles,
): readonly unknown[] {
  if (!Array.isArray(value)) return fail("INVALID_DENSE_ARRAY");
  if (value.length > maximumLength) return fail("INVALID_DENSE_ARRAY");
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1) return fail("INVALID_DENSE_ARRAY");
  if (ownKeys.some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string") return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key;
  })) {
    return fail("INVALID_DENSE_ARRAY");
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      return fail("INVALID_DENSE_ARRAY");
    }
    output.push(descriptor.value);
  }
  return output;
}

function parseIdentity(value: unknown): TrustedWindowsSourceIdentityV1 {
  const record = dataRecord(value);
  exactKeys(record, ["volumeSerialNumberHex", "fileIdHex"]);
  if (
    typeof record.volumeSerialNumberHex !== "string" ||
    !VOLUME_SERIAL.test(record.volumeSerialNumberHex) ||
    typeof record.fileIdHex !== "string" ||
    !FILE_ID.test(record.fileIdHex)
  ) {
    return fail("INVALID_IDENTITY_EVIDENCE");
  }
  return Object.freeze({
    volumeSerialNumberHex: record.volumeSerialNumberHex,
    fileIdHex: record.fileIdHex,
  });
}

function identityKey(identity: TrustedWindowsSourceIdentityV1): string {
  return `${identity.volumeSerialNumberHex}:${identity.fileIdHex}`;
}

function parseLocalVolumeEvidence(
  value: unknown,
  identity: TrustedWindowsSourceIdentityV1,
): TrustedWindowsLocalVolumeEvidenceV1 {
  const record = dataRecord(value);
  exactKeys(record, [
    "openedHandleFileType",
    "volumePathResolution",
    "driveTypeQuery",
    "driveType",
    "dosDeviceQuery",
    "dosDeviceMapping",
    "dosDeviceAliasChainDetected",
    "substTargetDetected",
    "uncRedirectorDetected",
    "networkDeviceTargetDetected",
    "openedHandleVolumeCorroboration",
    "openedHandleVolumeSerialNumberHex",
    "volumeRootHandleSerialNumberHex",
  ]);
  if (
    record.openedHandleFileType !== "FILE_TYPE_DISK" ||
    record.volumePathResolution !== "get_volume_path_name_w" ||
    record.driveTypeQuery !== "get_drive_type_w" ||
    (record.driveType !== "DRIVE_FIXED" && record.driveType !== "DRIVE_REMOVABLE") ||
    record.dosDeviceQuery !== "query_dos_device_w" ||
    record.dosDeviceMapping !== "direct_local_volume" ||
    record.dosDeviceAliasChainDetected !== false ||
    record.substTargetDetected !== false ||
    record.uncRedirectorDetected !== false ||
    record.networkDeviceTargetDetected !== false ||
    record.openedHandleVolumeCorroboration !==
      "file_id_info_volume_serial_matches_opened_volume_root_handle" ||
    typeof record.openedHandleVolumeSerialNumberHex !== "string" ||
    !VOLUME_SERIAL.test(record.openedHandleVolumeSerialNumberHex) ||
    typeof record.volumeRootHandleSerialNumberHex !== "string" ||
    !VOLUME_SERIAL.test(record.volumeRootHandleSerialNumberHex) ||
    record.openedHandleVolumeSerialNumberHex !== identity.volumeSerialNumberHex ||
    record.volumeRootHandleSerialNumberHex !== identity.volumeSerialNumberHex
  ) {
    return fail("INVALID_LOCAL_VOLUME_EVIDENCE");
  }
  return Object.freeze({
    openedHandleFileType: "FILE_TYPE_DISK",
    volumePathResolution: "get_volume_path_name_w",
    driveTypeQuery: "get_drive_type_w",
    driveType: record.driveType,
    dosDeviceQuery: "query_dos_device_w",
    dosDeviceMapping: "direct_local_volume",
    dosDeviceAliasChainDetected: false,
    substTargetDetected: false,
    uncRedirectorDetected: false,
    networkDeviceTargetDetected: false,
    openedHandleVolumeCorroboration:
      "file_id_info_volume_serial_matches_opened_volume_root_handle",
    openedHandleVolumeSerialNumberHex: record.openedHandleVolumeSerialNumberHex,
    volumeRootHandleSerialNumberHex: record.volumeRootHandleSerialNumberHex,
  });
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function assertSafeWindowsSegment(segment: string): void {
  const basename = segment.split(".", 1)[0]?.toUpperCase() ?? "";
  if (
    segment.length === 0 ||
    segment.length > MAX_WINDOWS_SEGMENT_CODE_UNITS ||
    segment === "." ||
    segment === ".." ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    WINDOWS_INVALID_SEGMENT.test(segment) ||
    WINDOWS_BIDI_CONTROL.test(segment) ||
    hasControlCharacter(segment) ||
    WINDOWS_RESERVED_BASENAME.test(basename)
  ) {
    fail("BASE_CONTRACT_REJECTED");
  }
}

/**
 * V1 validates only literal path syntax here. It deliberately performs no
 * JavaScript case folding or parent/child comparison; the complete native
 * CompareStringOrdinal transcript is the sole V1 path-relation authority.
 */
function assertCanonicalAbsoluteDosPath(canonicalPath: string, resolvedPath: string): void {
  if (
    canonicalPath.length === 0 ||
    canonicalPath.length > MAX_WINDOWS_PATH_CODE_UNITS ||
    resolvedPath !== canonicalPath ||
    canonicalPath.startsWith("\\\\") ||
    canonicalPath.startsWith("//") ||
    !/^[A-Z]:\\/u.test(canonicalPath) ||
    canonicalPath.length === 3 ||
    canonicalPath.includes("/") ||
    canonicalPath.endsWith("\\") ||
    win32.normalize(canonicalPath) !== canonicalPath
  ) {
    fail("BASE_CONTRACT_REJECTED");
  }
  for (const segment of canonicalPath.slice(3).split("\\")) {
    assertSafeWindowsSegment(segment);
  }
}

function sortedIdentityKeys(identities: readonly TrustedWindowsSourceIdentityV1[]): readonly string[] {
  return identities.map(identityKey).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function assertUniqueIdentities(
  identities: readonly TrustedWindowsSourceIdentityV1[],
  code: "SELECTION_IDENTITY_DUPLICATE" | "CROSS_SELECTION_IDENTITY_DUPLICATE",
): void {
  const keys = sortedIdentityKeys(identities);
  for (let index = 1; index < keys.length; index += 1) {
    if (keys[index] === keys[index - 1]) fail(code);
  }
}

export function deriveTrustedWindowsSelectionIdentityEvidenceV1(
  identities: readonly TrustedWindowsSourceIdentityV1[],
): TrustedWindowsInventoryIdentityEvidenceV1 {
  const parsed = denseArray(
    identities,
    TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxFilesPerSelection,
  ).map(parseIdentity);
  assertUniqueIdentities(parsed, "SELECTION_IDENTITY_DUPLICATE");
  return Object.freeze({
    identityComparisonMechanism: "windows_volume_serial_plus_file_id_128",
    identityCount: parsed.length,
    duplicateIdentityCount: 0,
    identitySetSha256: digest(SELECTION_IDENTITY_SET_DIGEST_DOMAIN, sortedIdentityKeys(parsed)),
  });
}

export function deriveTrustedWindowsCrossSelectionIdentityEvidenceV1(
  selections: readonly Pick<TrustedWindowsSourceSelectionV1, "inventoryFileIdentities">[],
): TrustedWindowsCrossSelectionIdentityEvidenceV1 {
  const parsedSelections = denseArray(
    selections,
    TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots,
  );
  const identities: TrustedWindowsSourceIdentityV1[] = [];
  for (const selection of parsedSelections) {
    const record = dataRecord(selection);
    if (!Object.hasOwn(record, "inventoryFileIdentities")) fail("MISSING_REQUIRED_FIELD");
    const selectionIdentities = denseArray(
      record.inventoryFileIdentities,
      TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxFilesPerSelection,
    ).map(parseIdentity);
    if (
      identities.length + selectionIdentities.length >
      TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxDiscoveredFiles
    ) {
      fail("INVALID_IDENTITY_EVIDENCE");
    }
    for (const identity of selectionIdentities) identities.push(identity);
  }
  assertUniqueIdentities(identities, "CROSS_SELECTION_IDENTITY_DUPLICATE");
  return Object.freeze({
    identityComparisonMechanism: "windows_volume_serial_plus_file_id_128",
    checkedIdentityCount: identities.length,
    duplicateIdentityCount: 0,
    globalIdentitySetSha256: digest(GLOBAL_IDENTITY_SET_DIGEST_DOMAIN, sortedIdentityKeys(identities)),
  });
}

export function deriveTrustedWindowsPathComparisonTranscriptSha256V1(
  input: TrustedWindowsPathComparisonTranscriptInputV1,
): string {
  const record = dataRecord(input);
  exactKeys(record, [
    "adapterId", "adapterBuildSha256", "identityComparisonMechanism",
    "pathComparisonMechanism", "sourceCanonicalAbsolutePaths",
    "outputCanonicalAbsolutePath", "nativePathComparisons",
  ]);
  if (
    typeof record.adapterId !== "string" ||
    !ADAPTER_ID.test(record.adapterId) ||
    typeof record.adapterBuildSha256 !== "string" ||
    !SHA256.test(record.adapterBuildSha256) ||
    record.identityComparisonMechanism !== "windows_volume_serial_plus_file_id_128" ||
    record.pathComparisonMechanism !== "windows_compare_string_ordinal_ignore_case" ||
    typeof record.outputCanonicalAbsolutePath !== "string"
  ) {
    return fail("INVALID_ADAPTER_EVIDENCE");
  }
  const sourceCanonicalAbsolutePaths = denseArray(
    record.sourceCanonicalAbsolutePaths,
    TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots,
  ).map((path) => {
    if (typeof path !== "string") return fail("INVALID_PAYLOAD");
    return path;
  });
  const nativePathComparisons = parsePathComparisons(record.nativePathComparisons);
  return digest(PATH_COMPARISON_TRANSCRIPT_DIGEST_DOMAIN, {
    adapterId: record.adapterId,
    adapterBuildSha256: record.adapterBuildSha256,
    identityComparisonMechanism: "windows_volume_serial_plus_file_id_128",
    pathComparisonMechanism: "windows_compare_string_ordinal_ignore_case",
    sourceCanonicalAbsolutePaths,
    outputCanonicalAbsolutePath: record.outputCanonicalAbsolutePath,
    nativePathComparisons,
  });
}

function parseSourcePathEvidence(value: unknown): TrustedWindowsSourceSelectionV0["pathEvidence"] {
  const record = dataRecord(value);
  const acquisition = record.acquisition;
  exactKeys(record, [
    "acquisition", "canonicalization", "inspectionMode", "pathIdentityCheckedByHandle",
    "reparseInspectionScope", "reparseInspectionComplete", "reparsePointsEncountered",
    "inventoryComplete", "regularFilesOnly",
  ]);
  if (
    (
      acquisition !== "windows_native_picker_handle" &&
      acquisition !== "windows_native_drop_cfhdrop_then_handle_open"
    ) ||
    record.canonicalization !== "final_path_by_handle" ||
    record.inspectionMode !== "read_only" ||
    record.pathIdentityCheckedByHandle !== true ||
    record.reparseInspectionScope !== "volume_root_through_complete_selection" ||
    record.reparseInspectionComplete !== true ||
    typeof record.reparsePointsEncountered !== "number" ||
    !Number.isSafeInteger(record.reparsePointsEncountered) ||
    Object.is(record.reparsePointsEncountered, -0) ||
    record.reparsePointsEncountered !== 0 ||
    record.inventoryComplete !== true ||
    record.regularFilesOnly !== true
  ) {
    return fail("BASE_CONTRACT_REJECTED");
  }
  return {
    acquisition: acquisition as TrustedWindowsSourcePathAcquisitionV0,
    canonicalization: "final_path_by_handle",
    inspectionMode: "read_only",
    pathIdentityCheckedByHandle: true,
    reparseInspectionScope: "volume_root_through_complete_selection",
    reparseInspectionComplete: true,
    reparsePointsEncountered: record.reparsePointsEncountered,
    inventoryComplete: true,
    regularFilesOnly: true,
  };
}

function parseOutputPathEvidence(
  value: unknown,
): TrustedWindowsExistingOutputDirectoryPathEvidenceV0 {
  const record = dataRecord(value);
  exactKeys(record, [
    "acquisition", "canonicalization", "inspectionMode", "pathIdentityCheckedByHandle",
    "directoryTypeCheckedByHandle", "reparseInspectionScope",
    "reparseInspectionComplete", "reparsePointsEncountered",
  ]);
  if (
    record.acquisition !== "windows_native_output_directory_handle" ||
    record.canonicalization !== "final_path_by_handle" ||
    record.inspectionMode !== "read_only" ||
    record.pathIdentityCheckedByHandle !== true ||
    record.directoryTypeCheckedByHandle !== true ||
    record.reparseInspectionScope !== "volume_root_through_output_directory" ||
    record.reparseInspectionComplete !== true ||
    typeof record.reparsePointsEncountered !== "number" ||
    !Number.isSafeInteger(record.reparsePointsEncountered) ||
    Object.is(record.reparsePointsEncountered, -0) ||
    record.reparsePointsEncountered !== 0
  ) {
    return fail("BASE_CONTRACT_REJECTED");
  }
  return {
    acquisition: "windows_native_output_directory_handle",
    canonicalization: "final_path_by_handle",
    inspectionMode: "read_only",
    pathIdentityCheckedByHandle: true,
    directoryTypeCheckedByHandle: true,
    reparseInspectionScope: "volume_root_through_output_directory",
    reparseInspectionComplete: true,
    reparsePointsEncountered: record.reparsePointsEncountered,
  };
}

function parseInventoryEvidence(value: unknown): TrustedWindowsInventoryIdentityEvidenceV1 {
  const record = dataRecord(value);
  exactKeys(record, [
    "identityComparisonMechanism", "identityCount", "duplicateIdentityCount", "identitySetSha256",
  ]);
  if (
    record.identityComparisonMechanism !== "windows_volume_serial_plus_file_id_128" ||
    typeof record.identityCount !== "number" ||
    !Number.isSafeInteger(record.identityCount) ||
    record.identityCount < 0 ||
    Object.is(record.identityCount, -0) ||
    Object.is(record.duplicateIdentityCount, -0) ||
    record.duplicateIdentityCount !== 0 ||
    typeof record.identitySetSha256 !== "string" ||
    !SHA256.test(record.identitySetSha256)
  ) {
    return fail("INVALID_IDENTITY_EVIDENCE");
  }
  return {
    identityComparisonMechanism: "windows_volume_serial_plus_file_id_128",
    identityCount: record.identityCount,
    duplicateIdentityCount: 0,
    identitySetSha256: record.identitySetSha256,
  };
}

function parseSelection(value: unknown): TrustedWindowsSourceSelectionV1 {
  const record = dataRecord(value);
  exactKeys(record, [
    "kind", "canonicalAbsolutePath", "resolvedAbsolutePath", "byteCountDecimal",
    "fileCount", "identity", "pathEvidence", "localVolumeEvidence", "inventoryFileIdentities",
    "inventoryIdentityEvidence",
  ]);
  if (
    (record.kind !== "file" && record.kind !== "directory") ||
    typeof record.canonicalAbsolutePath !== "string" ||
    typeof record.resolvedAbsolutePath !== "string" ||
    typeof record.byteCountDecimal !== "string" ||
    record.byteCountDecimal.length > MAX_BYTE_COUNT_DIGITS ||
    !BYTE_COUNT.test(record.byteCountDecimal) ||
    typeof record.fileCount !== "number" ||
    !Number.isSafeInteger(record.fileCount) ||
    record.fileCount < 0 ||
    Object.is(record.fileCount, -0) ||
    record.fileCount > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxFilesPerSelection ||
    BigInt(record.byteCountDecimal) >
      BigInt(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxBytesPerSelectionDecimal) ||
    (record.kind === "file" && record.fileCount !== 1) ||
    (record.kind === "directory" && record.fileCount === 0 && record.byteCountDecimal !== "0")
  ) {
    return fail("BASE_CONTRACT_REJECTED");
  }
  assertCanonicalAbsoluteDosPath(record.canonicalAbsolutePath, record.resolvedAbsolutePath);
  const identities = denseArray(
    record.inventoryFileIdentities,
    TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxFilesPerSelection,
  ).map(parseIdentity);
  const identity = parseIdentity(record.identity);
  return Object.freeze({
    kind: record.kind,
    canonicalAbsolutePath: record.canonicalAbsolutePath,
    resolvedAbsolutePath: record.resolvedAbsolutePath,
    byteCountDecimal: record.byteCountDecimal,
    fileCount: record.fileCount,
    identity,
    pathEvidence: parseSourcePathEvidence(record.pathEvidence),
    localVolumeEvidence: parseLocalVolumeEvidence(record.localVolumeEvidence, identity),
    inventoryFileIdentities: Object.freeze(identities),
    inventoryIdentityEvidence: Object.freeze(parseInventoryEvidence(record.inventoryIdentityEvidence)),
  });
}

function parseOutputBoundary(value: unknown): TrustedWindowsExistingOutputDirectoryBoundaryV1 {
  const record = dataRecord(value);
  exactKeys(record, [
    "kind", "canonicalAbsolutePath", "resolvedAbsolutePath", "identity", "pathEvidence",
    "localVolumeEvidence",
  ]);
  if (
    record.kind !== "directory" ||
    typeof record.canonicalAbsolutePath !== "string" ||
    typeof record.resolvedAbsolutePath !== "string"
  ) {
    return fail("BASE_CONTRACT_REJECTED");
  }
  assertCanonicalAbsoluteDosPath(record.canonicalAbsolutePath, record.resolvedAbsolutePath);
  const identity = parseIdentity(record.identity);
  return Object.freeze({
    kind: "directory",
    canonicalAbsolutePath: record.canonicalAbsolutePath,
    resolvedAbsolutePath: record.resolvedAbsolutePath,
    identity,
    pathEvidence: parseOutputPathEvidence(record.pathEvidence),
    localVolumeEvidence: parseLocalVolumeEvidence(record.localVolumeEvidence, identity),
  });
}

function parseAdapterEvidence(value: unknown): TrustedWindowsAdapterEvidenceV1 {
  const record = dataRecord(value);
  exactKeys(record, [
    "adapterId", "adapterBuildSha256", "identityComparisonMechanism",
    "pathComparisonMechanism", "comparisonTranscriptSha256",
  ]);
  if (
    typeof record.adapterId !== "string" ||
    !ADAPTER_ID.test(record.adapterId) ||
    typeof record.adapterBuildSha256 !== "string" ||
    !SHA256.test(record.adapterBuildSha256) ||
    record.identityComparisonMechanism !== "windows_volume_serial_plus_file_id_128" ||
    record.pathComparisonMechanism !== "windows_compare_string_ordinal_ignore_case" ||
    typeof record.comparisonTranscriptSha256 !== "string" ||
    !SHA256.test(record.comparisonTranscriptSha256)
  ) {
    return fail("INVALID_ADAPTER_EVIDENCE");
  }
  return Object.freeze({
    adapterId: record.adapterId,
    adapterBuildSha256: record.adapterBuildSha256,
    identityComparisonMechanism: "windows_volume_serial_plus_file_id_128",
    pathComparisonMechanism: "windows_compare_string_ordinal_ignore_case",
    comparisonTranscriptSha256: record.comparisonTranscriptSha256,
  });
}

function parseCrossSelectionEvidence(value: unknown): TrustedWindowsCrossSelectionIdentityEvidenceV1 {
  const record = dataRecord(value);
  exactKeys(record, [
    "identityComparisonMechanism", "checkedIdentityCount", "duplicateIdentityCount",
    "globalIdentitySetSha256",
  ]);
  if (
    record.identityComparisonMechanism !== "windows_volume_serial_plus_file_id_128" ||
    typeof record.checkedIdentityCount !== "number" ||
    !Number.isSafeInteger(record.checkedIdentityCount) ||
    record.checkedIdentityCount < 0 ||
    Object.is(record.checkedIdentityCount, -0) ||
    Object.is(record.duplicateIdentityCount, -0) ||
    record.duplicateIdentityCount !== 0 ||
    typeof record.globalIdentitySetSha256 !== "string" ||
    !SHA256.test(record.globalIdentitySetSha256)
  ) {
    return fail("INVALID_IDENTITY_EVIDENCE");
  }
  return Object.freeze({
    identityComparisonMechanism: "windows_volume_serial_plus_file_id_128",
    checkedIdentityCount: record.checkedIdentityCount,
    duplicateIdentityCount: 0,
    globalIdentitySetSha256: record.globalIdentitySetSha256,
  });
}

function parseSourcePair(value: unknown): TrustedWindowsSourcePairComparisonV1 {
  const record = dataRecord(value);
  exactKeys(record, ["leftSelectionIndex", "rightSelectionIndex", "relation"]);
  if (
    typeof record.leftSelectionIndex !== "number" ||
    !Number.isSafeInteger(record.leftSelectionIndex) ||
    record.leftSelectionIndex < 1 ||
    Object.is(record.leftSelectionIndex, -0) ||
    typeof record.rightSelectionIndex !== "number" ||
    !Number.isSafeInteger(record.rightSelectionIndex) ||
    record.rightSelectionIndex < 1 ||
    Object.is(record.rightSelectionIndex, -0) ||
    record.relation !== "disjoint"
  ) {
    return fail("PATH_COMPARISON_COVERAGE_MISMATCH");
  }
  return Object.freeze({
    leftSelectionIndex: record.leftSelectionIndex,
    rightSelectionIndex: record.rightSelectionIndex,
    relation: "disjoint",
  });
}

function parseOutputPair(value: unknown): TrustedWindowsOutputPairComparisonV1 {
  const record = dataRecord(value);
  exactKeys(record, ["selectionIndex", "relation"]);
  if (
    typeof record.selectionIndex !== "number" ||
    !Number.isSafeInteger(record.selectionIndex) ||
    record.selectionIndex < 1 ||
    Object.is(record.selectionIndex, -0) ||
    record.relation !== "disjoint"
  ) {
    return fail("PATH_COMPARISON_COVERAGE_MISMATCH");
  }
  return Object.freeze({ selectionIndex: record.selectionIndex, relation: "disjoint" });
}

function parsePathComparisons(value: unknown): TrustedWindowsNativePathComparisonsV1 {
  const record = dataRecord(value);
  exactKeys(record, ["sourcePairs", "outputPairs"]);
  const maximumSourcePairs = (
    TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots *
    (TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots - 1)
  ) / 2;
  return Object.freeze({
    sourcePairs: Object.freeze(denseArray(record.sourcePairs, maximumSourcePairs).map(parseSourcePair)),
    outputPairs: Object.freeze(denseArray(
      record.outputPairs,
      TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots,
    ).map(parseOutputPair)),
  });
}

function parseInput(value: unknown): ParsedV1Input {
  const record = dataRecord(value);
  exactKeys(record, [
    "schemaVersion", "origin", "browserPathInputAccepted", "sessionNonceHex",
    "outputBoundary", "selections", "adapterEvidence", "crossSelectionIdentityEvidence",
    "nativePathComparisons",
  ]);
  if (record.schemaVersion !== TRUSTED_WINDOWS_SOURCE_SET_INPUT_SCHEMA_VERSION_V1) {
    return fail("INVALID_SCHEMA_VERSION");
  }
  if (
    record.origin !== "trusted_windows_native_launcher" ||
    record.browserPathInputAccepted !== false ||
    typeof record.sessionNonceHex !== "string" ||
    !NONCE.test(record.sessionNonceHex)
  ) {
    return fail("INVALID_PAYLOAD");
  }
  const selections: TrustedWindowsSourceSelectionV1[] = [];
  let identityCount = 0;
  for (const selectionValue of denseArray(
    record.selections,
    TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots,
  )) {
    const selection = parseSelection(selectionValue);
    identityCount += selection.inventoryFileIdentities.length;
    if (identityCount > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxDiscoveredFiles) {
      fail("BASE_CONTRACT_REJECTED");
    }
    selections.push(selection);
  }
  return Object.freeze({
    schemaVersion: TRUSTED_WINDOWS_SOURCE_SET_INPUT_SCHEMA_VERSION_V1,
    origin: "trusted_windows_native_launcher",
    browserPathInputAccepted: false,
    sessionNonceHex: record.sessionNonceHex,
    outputBoundary: parseOutputBoundary(record.outputBoundary),
    selections: Object.freeze(selections),
    adapterEvidence: parseAdapterEvidence(record.adapterEvidence),
    crossSelectionIdentityEvidence: parseCrossSelectionEvidence(record.crossSelectionIdentityEvidence),
    nativePathComparisons: parsePathComparisons(record.nativePathComparisons),
  });
}

function assertBaseContract(input: ParsedV1Input): void {
  if (input.selections.length === 0) fail("BASE_CONTRACT_REJECTED");
  const rootIdentities = new Set<string>();
  let discoveredFiles = 0;
  let totalBytes = 0n;
  for (const selection of input.selections) {
    const rootIdentity = identityKey(selection.identity);
    if (rootIdentities.has(rootIdentity)) fail("SELECTION_ROOT_IDENTITY_DUPLICATE");
    rootIdentities.add(rootIdentity);
    discoveredFiles += selection.fileCount;
    totalBytes += BigInt(selection.byteCountDecimal);
    if (
      discoveredFiles > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxDiscoveredFiles ||
      totalBytes > BigInt(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxTotalBytesDecimal)
    ) {
      fail("BASE_CONTRACT_REJECTED");
    }
  }
}

function assertOutputIdentityIsDistinct(input: ParsedV1Input): void {
  const outputIdentity = identityKey(input.outputBoundary.identity);
  if (input.selections.some((selection) => identityKey(selection.identity) === outputIdentity)) {
    fail("OUTPUT_SOURCE_IDENTITY_DUPLICATE");
  }
}

function sameEvidence(
  left: TrustedWindowsInventoryIdentityEvidenceV1,
  right: TrustedWindowsInventoryIdentityEvidenceV1,
): boolean {
  return left.identityCount === right.identityCount &&
    left.identitySetSha256 === right.identitySetSha256;
}

function assertSelectionIdentityEvidence(selection: TrustedWindowsSourceSelectionV1): void {
  if (selection.inventoryFileIdentities.length !== selection.fileCount) {
    fail("SELECTION_IDENTITY_COUNT_MISMATCH");
  }
  if (
    selection.kind === "file" &&
    identityKey(selection.inventoryFileIdentities[0] ?? selection.identity) !== identityKey(selection.identity)
  ) {
    fail("FILE_ROOT_IDENTITY_MISMATCH");
  }
  const expected = deriveTrustedWindowsSelectionIdentityEvidenceV1(selection.inventoryFileIdentities);
  if (!sameEvidence(selection.inventoryIdentityEvidence, expected)) {
    fail("SELECTION_IDENTITY_EVIDENCE_MISMATCH");
  }
}

function assertCrossSelectionEvidence(input: ParsedV1Input): void {
  let expected: TrustedWindowsCrossSelectionIdentityEvidenceV1;
  try {
    expected = deriveTrustedWindowsCrossSelectionIdentityEvidenceV1(input.selections);
  } catch (error: unknown) {
    if (
      error instanceof TrustedWindowsSourceSetV1ValidationError &&
      error.code === "CROSS_SELECTION_IDENTITY_DUPLICATE"
    ) throw error;
    fail("CROSS_SELECTION_IDENTITY_EVIDENCE_MISMATCH");
  }
  const actual = input.crossSelectionIdentityEvidence;
  if (
    actual.checkedIdentityCount !== expected.checkedIdentityCount ||
    actual.globalIdentitySetSha256 !== expected.globalIdentitySetSha256
  ) {
    fail("CROSS_SELECTION_IDENTITY_EVIDENCE_MISMATCH");
  }
}

function expectedSourcePairs(selectionCount: number): readonly TrustedWindowsSourcePairComparisonV1[] {
  const pairs: TrustedWindowsSourcePairComparisonV1[] = [];
  for (let left = 1; left <= selectionCount; left += 1) {
    for (let right = left + 1; right <= selectionCount; right += 1) {
      pairs.push({ leftSelectionIndex: left, rightSelectionIndex: right, relation: "disjoint" });
    }
  }
  return pairs;
}

function assertPathComparisonCoverage(input: ParsedV1Input): void {
  const expectedSources = expectedSourcePairs(input.selections.length);
  const actualSources = input.nativePathComparisons.sourcePairs;
  if (actualSources.length !== expectedSources.length) fail("PATH_COMPARISON_COVERAGE_MISMATCH");
  for (let index = 0; index < expectedSources.length; index += 1) {
    const expected = expectedSources[index];
    const actual = actualSources[index];
    if (
      expected === undefined || actual === undefined ||
      actual.leftSelectionIndex !== expected.leftSelectionIndex ||
      actual.rightSelectionIndex !== expected.rightSelectionIndex
    ) {
      fail("PATH_COMPARISON_COVERAGE_MISMATCH");
    }
  }
  if (input.nativePathComparisons.outputPairs.length !== input.selections.length) {
    fail("PATH_COMPARISON_COVERAGE_MISMATCH");
  }
  for (let index = 0; index < input.selections.length; index += 1) {
    const pair = input.nativePathComparisons.outputPairs[index];
    if (pair?.selectionIndex !== index + 1) {
      fail("PATH_COMPARISON_COVERAGE_MISMATCH");
    }
  }
}

function assertComparisonTranscript(input: ParsedV1Input): void {
  const expected = deriveTrustedWindowsPathComparisonTranscriptSha256V1({
    adapterId: input.adapterEvidence.adapterId,
    adapterBuildSha256: input.adapterEvidence.adapterBuildSha256,
    identityComparisonMechanism: input.adapterEvidence.identityComparisonMechanism,
    pathComparisonMechanism: input.adapterEvidence.pathComparisonMechanism,
    sourceCanonicalAbsolutePaths: input.selections.map((selection) => selection.canonicalAbsolutePath),
    outputCanonicalAbsolutePath: input.outputBoundary.canonicalAbsolutePath,
    nativePathComparisons: input.nativePathComparisons,
  });
  if (input.adapterEvidence.comparisonTranscriptSha256 !== expected) {
    fail("COMPARISON_TRANSCRIPT_MISMATCH");
  }
}

function validateInput(value: unknown): ParsedV1Input {
  const input = parseInput(value);
  assertBaseContract(input);
  assertOutputIdentityIsDistinct(input);
  for (const selection of input.selections) assertSelectionIdentityEvidence(selection);
  assertCrossSelectionEvidence(input);
  assertPathComparisonCoverage(input);
  assertComparisonTranscript(input);
  return input;
}

function hmacDigest(nonceHex: string, domain: string, value: unknown): string {
  const canonical = stableCanonicalJson(toCanonicalJson(value));
  const valueDigest = createHmac("sha256", Buffer.from(nonceHex, "hex"))
    .update(domain, "ascii")
    .update(Buffer.from([0]))
    .update(canonical, "utf8")
    .digest("hex");
  return `sha256:${valueDigest}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
  return Object.freeze(value);
}

function privateSelectionCommitment(selection: TrustedWindowsSourceSelectionV1): Readonly<{
  kind: "file" | "directory";
  canonicalAbsolutePath: string;
  resolvedAbsolutePath: string;
  byteCountDecimal: string;
  fileCount: number;
  rootIdentityKey: string;
  pathEvidence: TrustedWindowsSourceSelectionV0["pathEvidence"];
  localVolumeEvidence: TrustedWindowsLocalVolumeEvidenceV1;
  inventoryIdentityKeys: readonly string[];
  inventoryIdentityEvidence: TrustedWindowsInventoryIdentityEvidenceV1;
}> {
  return {
    kind: selection.kind,
    canonicalAbsolutePath: selection.canonicalAbsolutePath,
    resolvedAbsolutePath: selection.resolvedAbsolutePath,
    byteCountDecimal: selection.byteCountDecimal,
    fileCount: selection.fileCount,
    rootIdentityKey: identityKey(selection.identity),
    pathEvidence: selection.pathEvidence,
    localVolumeEvidence: selection.localVolumeEvidence,
    inventoryIdentityKeys: sortedIdentityKeys(selection.inventoryFileIdentities),
    inventoryIdentityEvidence: selection.inventoryIdentityEvidence,
  };
}

function manifestBody(input: ParsedV1Input): Omit<TrustedWindowsNativeSourceSetManifestV1, "manifestDigestSha256"> {
  const privateSelections = input.selections.map(privateSelectionCommitment);
  const sources = privateSelections.map((selection, index) => ({
    basketPosition: index + 1,
    sourceDigestSha256: hmacDigest(input.sessionNonceHex, SOURCE_DIGEST_DOMAIN, {
      adapter: {
        adapterId: input.adapterEvidence.adapterId,
        adapterBuildSha256: input.adapterEvidence.adapterBuildSha256,
        identityComparisonMechanism: input.adapterEvidence.identityComparisonMechanism,
        pathComparisonMechanism: input.adapterEvidence.pathComparisonMechanism,
      },
      selection,
    }),
    fileCount: selection.fileCount,
    byteCountDecimal: selection.byteCountDecimal,
    inventoryIdentityCount: selection.inventoryIdentityEvidence.identityCount,
    inventoryIdentitySetSha256: hmacDigest(
      input.sessionNonceHex,
      PUBLIC_SELECTION_IDENTITY_COMMITMENT_DOMAIN,
      {
        basketPosition: index + 1,
        identitySetSha256: selection.inventoryIdentityEvidence.identitySetSha256,
      },
    ),
  }));
  const discoveredFiles = sources.reduce((total, source) => total + source.fileCount, 0);
  const totalBytes = sources.reduce((total, source) => total + BigInt(source.byteCountDecimal), 0n);
  return {
    schemaVersion: TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_SCHEMA_VERSION_V1,
    authority: "none",
    use: "inspection_only",
    sourceSetDigestSha256: hmacDigest(input.sessionNonceHex, SOURCE_SET_DIGEST_DOMAIN, {
      adapterEvidence: input.adapterEvidence,
      outputBoundary: input.outputBoundary,
      selections: privateSelections,
      crossSelectionIdentityEvidence: input.crossSelectionIdentityEvidence,
      nativePathComparisons: input.nativePathComparisons,
    }),
    sources,
    totals: {
      selectedRoots: sources.length,
      discoveredFiles,
      totalBytesDecimal: totalBytes.toString(10),
      inventoryIdentityCount: input.crossSelectionIdentityEvidence.checkedIdentityCount,
    },
    nativeEvidence: {
      adapterBuildSha256: input.adapterEvidence.adapterBuildSha256,
      comparisonTranscriptSha256: hmacDigest(
        input.sessionNonceHex,
        PUBLIC_COMPARISON_TRANSCRIPT_COMMITMENT_DOMAIN,
        input.adapterEvidence.comparisonTranscriptSha256,
      ),
      checkedIdentityCount: input.crossSelectionIdentityEvidence.checkedIdentityCount,
      globalIdentitySetSha256: hmacDigest(
        input.sessionNonceHex,
        PUBLIC_GLOBAL_IDENTITY_COMMITMENT_DOMAIN,
        input.crossSelectionIdentityEvidence.globalIdentitySetSha256,
      ),
      sourcePairCount: input.nativePathComparisons.sourcePairs.length,
      outputPairCount: input.nativePathComparisons.outputPairs.length,
      localVolumeProof: {
        checkedBoundaryCount: input.selections.length + 1,
        openedHandleFileType: "FILE_TYPE_DISK",
        acceptedDriveTypes: "DRIVE_FIXED_OR_REMOVABLE",
        dosDeviceMapping: "QUERY_DOS_DEVICE_DIRECT_LOCAL_VOLUME",
        openedHandleVolumeCorroboration:
          "FILE_ID_INFO_VOLUME_SERIAL_MATCHES_OPENED_VOLUME_ROOT_HANDLE",
      },
    },
    limits: TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1,
  };
}

export function buildTrustedWindowsSourceSetManifestV1(
  input: unknown,
): TrustedWindowsNativeSourceSetManifestV1 {
  const body = manifestBody(validateInput(input));
  const manifestDigestSha256 = digest(
    TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_DIGEST_DOMAIN_V1,
    body,
  );
  return deepFreeze({ ...body, manifestDigestSha256 });
}

function parseManifestSource(value: unknown, expectedPosition: number): TrustedWindowsSourceDigestSummaryV1 {
  const record = dataRecord(value);
  exactKeys(record, [
    "basketPosition", "sourceDigestSha256", "fileCount", "byteCountDecimal",
    "inventoryIdentityCount", "inventoryIdentitySetSha256",
  ]);
  if (
    record.basketPosition !== expectedPosition ||
    Object.is(record.basketPosition, -0) ||
    typeof record.sourceDigestSha256 !== "string" ||
    !SHA256.test(record.sourceDigestSha256) ||
    typeof record.fileCount !== "number" ||
    !Number.isSafeInteger(record.fileCount) ||
    record.fileCount < 0 ||
    Object.is(record.fileCount, -0) ||
    record.fileCount > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxFilesPerSelection ||
    typeof record.byteCountDecimal !== "string" ||
    record.byteCountDecimal.length > MAX_BYTE_COUNT_DIGITS ||
    !BYTE_COUNT.test(record.byteCountDecimal) ||
    BigInt(record.byteCountDecimal) > BigInt(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxBytesPerSelectionDecimal) ||
    (record.fileCount === 0 && record.byteCountDecimal !== "0") ||
    typeof record.inventoryIdentityCount !== "number" ||
    !Number.isSafeInteger(record.inventoryIdentityCount) ||
    record.inventoryIdentityCount < 0 ||
    Object.is(record.inventoryIdentityCount, -0) ||
    record.inventoryIdentityCount !== record.fileCount ||
    typeof record.inventoryIdentitySetSha256 !== "string" ||
    !SHA256.test(record.inventoryIdentitySetSha256)
  ) {
    return fail("INVALID_MANIFEST");
  }
  return {
    basketPosition: expectedPosition,
    sourceDigestSha256: record.sourceDigestSha256,
    fileCount: record.fileCount,
    byteCountDecimal: record.byteCountDecimal,
    inventoryIdentityCount: record.inventoryIdentityCount,
    inventoryIdentitySetSha256: record.inventoryIdentitySetSha256,
  };
}

function parseManifestTotals(value: unknown): TrustedWindowsNativeSourceSetManifestV1["totals"] {
  const record = dataRecord(value);
  exactKeys(record, [
    "selectedRoots", "discoveredFiles", "totalBytesDecimal", "inventoryIdentityCount",
  ]);
  if (
    typeof record.selectedRoots !== "number" ||
    !Number.isSafeInteger(record.selectedRoots) ||
    record.selectedRoots < 1 ||
    Object.is(record.selectedRoots, -0) ||
    typeof record.discoveredFiles !== "number" ||
    !Number.isSafeInteger(record.discoveredFiles) ||
    record.discoveredFiles < 0 ||
    Object.is(record.discoveredFiles, -0) ||
    typeof record.totalBytesDecimal !== "string" ||
    record.totalBytesDecimal.length > MAX_BYTE_COUNT_DIGITS ||
    !BYTE_COUNT.test(record.totalBytesDecimal) ||
    typeof record.inventoryIdentityCount !== "number" ||
    !Number.isSafeInteger(record.inventoryIdentityCount) ||
    record.inventoryIdentityCount < 0 ||
    Object.is(record.inventoryIdentityCount, -0)
  ) {
    return fail("INVALID_MANIFEST");
  }
  return {
    selectedRoots: record.selectedRoots,
    discoveredFiles: record.discoveredFiles,
    totalBytesDecimal: record.totalBytesDecimal,
    inventoryIdentityCount: record.inventoryIdentityCount,
  };
}

function parseManifestNativeEvidence(value: unknown): TrustedWindowsNativeSourceSetManifestV1["nativeEvidence"] {
  const record = dataRecord(value);
  exactKeys(record, [
    "adapterBuildSha256", "comparisonTranscriptSha256", "checkedIdentityCount",
    "globalIdentitySetSha256", "sourcePairCount", "outputPairCount", "localVolumeProof",
  ]);
  if (
    typeof record.adapterBuildSha256 !== "string" ||
    !SHA256.test(record.adapterBuildSha256) ||
    typeof record.comparisonTranscriptSha256 !== "string" ||
    !SHA256.test(record.comparisonTranscriptSha256) ||
    typeof record.globalIdentitySetSha256 !== "string" ||
    !SHA256.test(record.globalIdentitySetSha256) ||
    typeof record.checkedIdentityCount !== "number" ||
    !Number.isSafeInteger(record.checkedIdentityCount) ||
    record.checkedIdentityCount < 0 ||
    Object.is(record.checkedIdentityCount, -0) ||
    typeof record.sourcePairCount !== "number" ||
    !Number.isSafeInteger(record.sourcePairCount) ||
    record.sourcePairCount < 0 ||
    Object.is(record.sourcePairCount, -0) ||
    typeof record.outputPairCount !== "number" ||
    !Number.isSafeInteger(record.outputPairCount) ||
    record.outputPairCount < 0 ||
    Object.is(record.outputPairCount, -0)
  ) {
    return fail("INVALID_MANIFEST");
  }
  const localVolumeProof = dataRecord(record.localVolumeProof);
  exactKeys(localVolumeProof, [
    "checkedBoundaryCount",
    "openedHandleFileType",
    "acceptedDriveTypes",
    "dosDeviceMapping",
    "openedHandleVolumeCorroboration",
  ]);
  if (
    typeof localVolumeProof.checkedBoundaryCount !== "number" ||
    !Number.isSafeInteger(localVolumeProof.checkedBoundaryCount) ||
    localVolumeProof.checkedBoundaryCount < 1 ||
    Object.is(localVolumeProof.checkedBoundaryCount, -0) ||
    localVolumeProof.openedHandleFileType !== "FILE_TYPE_DISK" ||
    localVolumeProof.acceptedDriveTypes !== "DRIVE_FIXED_OR_REMOVABLE" ||
    localVolumeProof.dosDeviceMapping !== "QUERY_DOS_DEVICE_DIRECT_LOCAL_VOLUME" ||
    localVolumeProof.openedHandleVolumeCorroboration !==
      "FILE_ID_INFO_VOLUME_SERIAL_MATCHES_OPENED_VOLUME_ROOT_HANDLE"
  ) {
    return fail("INVALID_MANIFEST");
  }
  return {
    adapterBuildSha256: record.adapterBuildSha256,
    comparisonTranscriptSha256: record.comparisonTranscriptSha256,
    checkedIdentityCount: record.checkedIdentityCount,
    globalIdentitySetSha256: record.globalIdentitySetSha256,
    sourcePairCount: record.sourcePairCount,
    outputPairCount: record.outputPairCount,
    localVolumeProof: {
      checkedBoundaryCount: localVolumeProof.checkedBoundaryCount,
      openedHandleFileType: "FILE_TYPE_DISK",
      acceptedDriveTypes: "DRIVE_FIXED_OR_REMOVABLE",
      dosDeviceMapping: "QUERY_DOS_DEVICE_DIRECT_LOCAL_VOLUME",
      openedHandleVolumeCorroboration:
        "FILE_ID_INFO_VOLUME_SERIAL_MATCHES_OPENED_VOLUME_ROOT_HANDLE",
    },
  };
}

function parseManifestLimits(value: unknown): typeof TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1 {
  const record = dataRecord(value);
  exactKeys(record, [
    "maxSelectedRoots", "maxFilesPerSelection", "maxDiscoveredFiles",
    "maxBytesPerSelectionDecimal", "maxTotalBytesDecimal",
  ]);
  for (const [key, expected] of Object.entries(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1)) {
    if (record[key] !== expected) fail("INVALID_MANIFEST");
  }
  return TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1;
}

function parseManifest(value: unknown): TrustedWindowsNativeSourceSetManifestV1 {
  const record = dataRecord(value);
  exactKeys(record, [
    "schemaVersion", "authority", "use", "sourceSetDigestSha256", "sources",
    "totals", "nativeEvidence", "limits", "manifestDigestSha256",
  ]);
  if (
    record.schemaVersion !== TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_SCHEMA_VERSION_V1 ||
    record.authority !== "none" ||
    record.use !== "inspection_only" ||
    typeof record.sourceSetDigestSha256 !== "string" ||
    !SHA256.test(record.sourceSetDigestSha256) ||
    typeof record.manifestDigestSha256 !== "string" ||
    !SHA256.test(record.manifestDigestSha256)
  ) {
    return fail("INVALID_MANIFEST");
  }
  const sources = denseArray(
    record.sources,
    TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots,
  ).map((source, index) => parseManifestSource(source, index + 1));
  if (sources.length === 0 || sources.length > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots) {
    return fail("INVALID_MANIFEST");
  }
  const sourceDigests = new Set(sources.map((source) => source.sourceDigestSha256));
  if (sourceDigests.size !== sources.length) return fail("INVALID_MANIFEST");
  const totals = parseManifestTotals(record.totals);
  const nativeEvidence = parseManifestNativeEvidence(record.nativeEvidence);
  const discoveredFiles = sources.reduce((total, source) => total + source.fileCount, 0);
  const totalBytes = sources.reduce((total, source) => total + BigInt(source.byteCountDecimal), 0n);
  const expectedSourcePairs = (sources.length * (sources.length - 1)) / 2;
  if (
    totals.selectedRoots !== sources.length ||
    totals.discoveredFiles !== discoveredFiles ||
    totals.inventoryIdentityCount !== discoveredFiles ||
    totals.totalBytesDecimal !== totalBytes.toString(10) ||
    discoveredFiles > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxDiscoveredFiles ||
    totalBytes > BigInt(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxTotalBytesDecimal) ||
    nativeEvidence.checkedIdentityCount !== discoveredFiles ||
    nativeEvidence.sourcePairCount !== expectedSourcePairs ||
    nativeEvidence.outputPairCount !== sources.length
    || nativeEvidence.localVolumeProof.checkedBoundaryCount !== sources.length + 1
  ) {
    return fail("INVALID_MANIFEST");
  }
  return {
    schemaVersion: TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_SCHEMA_VERSION_V1,
    authority: "none",
    use: "inspection_only",
    sourceSetDigestSha256: record.sourceSetDigestSha256,
    sources,
    totals,
    nativeEvidence,
    limits: parseManifestLimits(record.limits),
    manifestDigestSha256: record.manifestDigestSha256,
  };
}

function safeDigestEqual(left: string, right: string): boolean {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  return timingSafeEqual(Buffer.from(left.slice(7), "hex"), Buffer.from(right.slice(7), "hex"));
}

/** Structural and semantic validation only. This does not establish native custody or trust. */
export function isStructurallyValidWindowsSourceSetManifestV1(manifest: unknown): boolean {
  try {
    const parsed = parseManifest(manifest);
    const { manifestDigestSha256, ...body } = parsed;
    const expected = digest(TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_DIGEST_DOMAIN_V1, body);
    return safeDigestEqual(manifestDigestSha256, expected);
  } catch {
    return false;
  }
}

/**
 * Compares a structurally valid manifest with an independently obtained digest.
 * Supplying the manifest's own digest proves nothing. Native custody requires
 * the controller's live, one-use receipt guard in addition to this comparison.
 */
export function doesWindowsSourceSetManifestMatchExpectedDigestV1(
  manifest: unknown,
  independentlyObtainedManifestDigestSha256: unknown,
): boolean {
  try {
    if (
      typeof independentlyObtainedManifestDigestSha256 !== "string" ||
      !SHA256.test(independentlyObtainedManifestDigestSha256)
    ) return false;
    const parsed = parseManifest(manifest);
    const { manifestDigestSha256, ...body } = parsed;
    const expected = digest(TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_DIGEST_DOMAIN_V1, body);
    return safeDigestEqual(manifestDigestSha256, expected) &&
      safeDigestEqual(manifestDigestSha256, independentlyObtainedManifestDigestSha256);
  } catch {
    return false;
  }
}

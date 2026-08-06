import { createHmac, timingSafeEqual } from "node:crypto";
import { win32 } from "node:path";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";

export const TRUSTED_WINDOWS_SOURCE_SET_INPUT_SCHEMA_VERSION_V0 =
  "trusted-windows-native-source-set-input.v0";
export const TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_SCHEMA_VERSION_V0 =
  "trusted-windows-source-set-manifest.v0";

export const TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0 = Object.freeze({
  maxSelectedRoots: 128,
  maxFilesPerSelection: 1_000_000,
  maxDiscoveredFiles: 1_000_000,
  maxBytesPerSelectionDecimal: "4398046511104",
  maxTotalBytesDecimal: "8796093022208",
});

const SOURCE_REF_DOMAIN = "OMNITWIN.TRUSTED_WINDOWS_SOURCE_REF.V0";
const SOURCE_SET_REF_DOMAIN = "OMNITWIN.TRUSTED_WINDOWS_SOURCE_SET_REF.V0";
const MANIFEST_DIGEST_DOMAIN = "OMNITWIN.TRUSTED_WINDOWS_SOURCE_SET_MANIFEST.V0";
const MAX_WINDOWS_PATH_CODE_UNITS = 32_767;
const MAX_WINDOWS_SEGMENT_CODE_UNITS = 255;
const MAX_BROWSER_LABEL_CODE_POINTS = 120;
const MAX_BYTE_COUNT_DIGITS = 32;
const CANONICAL_BYTE_COUNT = /^(?:0|[1-9][0-9]*)$/u;
const CANONICAL_NONCE = /^[a-f0-9]{64}$/u;
const CANONICAL_VOLUME_SERIAL = /^[A-F0-9]{8}(?:[A-F0-9]{8})?$/u;
const CANONICAL_FILE_ID = /^[A-F0-9]{32}$/u;
const CANONICAL_SOURCE_REF = /^src_[a-f0-9]{64}$/u;
const CANONICAL_SOURCE_SET_REF = /^set_[a-f0-9]{64}$/u;
const CANONICAL_MANIFEST_DIGEST = /^sha256:([a-f0-9]{64})$/u;
const WINDOWS_INVALID_SEGMENT = /[<>:"/\\|?*]/u;
const WINDOWS_BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/u;
const BROWSER_LABEL_CHARACTER = /^[\p{L}\p{N} ._()+-]$/u;
const WINDOWS_RESERVED_BASENAME = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM(?:[1-9]|[¹²³])|LPT(?:[1-9]|[¹²³]))$/u;

export type TrustedWindowsSelectionKindV0 = "file" | "directory";

export type TrustedWindowsSourcePathAcquisitionV0 =
  | "windows_native_picker_handle"
  | "windows_native_drop_cfhdrop_then_handle_open";

export interface TrustedWindowsSourceIdentityV0 {
  readonly volumeSerialNumberHex: string;
  readonly fileIdHex: string;
}

export interface TrustedWindowsSourcePathEvidenceV0 {
  readonly acquisition: TrustedWindowsSourcePathAcquisitionV0;
  readonly canonicalization: "final_path_by_handle";
  readonly inspectionMode: "read_only";
  readonly pathIdentityCheckedByHandle: true;
  readonly reparseInspectionScope: "volume_root_through_complete_selection";
  readonly reparseInspectionComplete: true;
  readonly reparsePointsEncountered: number;
  readonly inventoryComplete: true;
  readonly regularFilesOnly: true;
}

export interface TrustedWindowsConfiguredOutputPathEvidenceV0 {
  readonly acquisition: "trusted_launcher_output_configuration";
  readonly canonicalization: "resolved_existing_ancestor_and_validated_suffix";
  readonly inspectionMode: "read_only";
  readonly reparseInspectionScope: "volume_root_through_output_parent";
  readonly reparseInspectionComplete: true;
  readonly reparsePointsEncountered: number;
}

/** Stronger existing-directory evidence accepted by V0 for strict V1 composition. */
export interface TrustedWindowsExistingOutputDirectoryPathEvidenceV0 {
  readonly acquisition: "windows_native_output_directory_handle";
  readonly canonicalization: "final_path_by_handle";
  readonly inspectionMode: "read_only";
  readonly pathIdentityCheckedByHandle: true;
  readonly directoryTypeCheckedByHandle: true;
  readonly reparseInspectionScope: "volume_root_through_output_directory";
  readonly reparseInspectionComplete: true;
  readonly reparsePointsEncountered: number;
}

export type TrustedWindowsOutputPathEvidenceV0 =
  | TrustedWindowsConfiguredOutputPathEvidenceV0
  | TrustedWindowsExistingOutputDirectoryPathEvidenceV0;

export interface TrustedWindowsSourceSelectionV0 {
  readonly kind: TrustedWindowsSelectionKindV0;
  readonly canonicalAbsolutePath: string;
  readonly resolvedAbsolutePath: string;
  readonly byteCountDecimal: string;
  readonly fileCount: number;
  readonly identity: TrustedWindowsSourceIdentityV0;
  readonly pathEvidence: TrustedWindowsSourcePathEvidenceV0;
}

export interface TrustedWindowsConfiguredOutputBoundaryV0 {
  readonly canonicalAbsolutePath: string;
  readonly resolvedAbsolutePath: string;
  readonly pathEvidence: TrustedWindowsConfiguredOutputPathEvidenceV0;
}

export interface TrustedWindowsExistingOutputDirectoryBoundaryV0 {
  readonly kind: "directory";
  readonly canonicalAbsolutePath: string;
  readonly resolvedAbsolutePath: string;
  readonly identity: TrustedWindowsSourceIdentityV0;
  readonly pathEvidence: TrustedWindowsExistingOutputDirectoryPathEvidenceV0;
}

export type TrustedWindowsOutputBoundaryV0 =
  | TrustedWindowsConfiguredOutputBoundaryV0
  | TrustedWindowsExistingOutputDirectoryBoundaryV0;

export interface TrustedWindowsNativeSourceSetInputV0 {
  readonly schemaVersion: typeof TRUSTED_WINDOWS_SOURCE_SET_INPUT_SCHEMA_VERSION_V0;
  readonly origin: "trusted_windows_native_launcher";
  readonly browserPathInputAccepted: false;
  readonly sessionNonceHex: string;
  readonly outputBoundary: TrustedWindowsOutputBoundaryV0;
  readonly selections: readonly TrustedWindowsSourceSelectionV0[];
}

export interface BrowserSafeSourceSummaryV0 {
  readonly basketPosition: number;
  readonly sourceRef: string;
  readonly kind: TrustedWindowsSelectionKindV0;
  readonly displayName: string;
  readonly displayNameSafety: "sanitized_basename_only_plain_text";
  readonly displayNameWasSanitized: boolean;
  readonly fileCount: number;
  readonly byteCountDecimal: string;
}

export interface TrustedWindowsSourceSetManifestV0 {
  readonly schemaVersion: typeof TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_SCHEMA_VERSION_V0;
  readonly authority: "none";
  readonly use: "read_only_selection_review";
  readonly sourceSetRef: string;
  readonly sources: readonly BrowserSafeSourceSummaryV0[];
  readonly totals: {
    readonly selectedRoots: number;
    readonly discoveredFiles: number;
    readonly totalBytesDecimal: string;
  };
  readonly limits: typeof TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0;
  readonly manifestDigestSha256: string;
}

export type TrustedWindowsSourceSetErrorCodeV0 =
  | "INVALID_PAYLOAD"
  | "MISSING_REQUIRED_FIELD"
  | "UNEXPECTED_FIELD"
  | "INVALID_SCHEMA_VERSION"
  | "UNTRUSTED_PATH_ORIGIN"
  | "BROWSER_PATH_INPUT_REJECTED"
  | "INVALID_SESSION_NONCE"
  | "EMPTY_SOURCE_SET"
  | "SELECTED_ROOT_LIMIT_EXCEEDED"
  | "DEVICE_PATH_REJECTED"
  | "UNC_PATH_REJECTED"
  | "INVALID_ABSOLUTE_DOS_PATH"
  | "VOLUME_ROOT_REJECTED"
  | "NON_CANONICAL_PATH"
  | "UNSAFE_WINDOWS_PATH_SEGMENT"
  | "PATH_RESOLUTION_MISMATCH"
  | "INCOMPLETE_TRUSTED_PATH_EVIDENCE"
  | "INCOMPLETE_REPARSE_INSPECTION"
  | "REPARSE_POINT_REJECTED"
  | "INVALID_SOURCE_IDENTITY"
  | "INVALID_FILE_COUNT"
  | "INVALID_BYTE_COUNT"
  | "SELECTION_FILE_LIMIT_EXCEEDED"
  | "TOTAL_FILE_LIMIT_EXCEEDED"
  | "SELECTION_BYTE_LIMIT_EXCEEDED"
  | "TOTAL_BYTE_LIMIT_EXCEEDED"
  | "DUPLICATE_SOURCE_PATH"
  | "DUPLICATE_SOURCE_IDENTITY"
  | "SOURCE_PARENT_CHILD_OVERLAP"
  | "SOURCE_OUTPUT_OVERLAP";

const SAFE_ERROR_MESSAGES: Readonly<Record<TrustedWindowsSourceSetErrorCodeV0, string>> = Object.freeze({
  INVALID_PAYLOAD: "The native source selection has an invalid shape.",
  MISSING_REQUIRED_FIELD: "The native source selection is missing a required field.",
  UNEXPECTED_FIELD: "The native source selection contains a field this contract does not accept.",
  INVALID_SCHEMA_VERSION: "The native source selection uses an unsupported contract version.",
  UNTRUSTED_PATH_ORIGIN: "Source locations must come from the trusted native Windows launcher.",
  BROWSER_PATH_INPUT_REJECTED: "Browser-entered source locations are not accepted.",
  INVALID_SESSION_NONCE: "The native launcher did not provide a valid private session nonce.",
  EMPTY_SOURCE_SET: "Choose at least one file or folder.",
  SELECTED_ROOT_LIMIT_EXCEEDED: "The basket contains more selected items than this release can inspect safely.",
  DEVICE_PATH_REJECTED: "Windows device paths are not accepted as sources or outputs.",
  UNC_PATH_REJECTED: "Network share paths are not accepted by this offline source contract.",
  INVALID_ABSOLUTE_DOS_PATH: "A source or output is not a valid absolute Windows drive path.",
  VOLUME_ROOT_REJECTED: "Selecting an entire Windows drive is not allowed.",
  NON_CANONICAL_PATH: "The native launcher did not provide the already-canonical Windows path.",
  UNSAFE_WINDOWS_PATH_SEGMENT: "A source or output name is unsafe or ambiguous on Windows.",
  PATH_RESOLUTION_MISMATCH: "A selected path does not match the path resolved from its trusted handle.",
  INCOMPLETE_TRUSTED_PATH_EVIDENCE: "The trusted launcher did not complete the required read-only handle checks.",
  INCOMPLETE_REPARSE_INSPECTION: "The trusted launcher did not complete the required reparse-point inspection.",
  REPARSE_POINT_REJECTED: "A selected source or output boundary crosses a Windows reparse point.",
  INVALID_SOURCE_IDENTITY: "A selected source is missing its canonical Windows file identity.",
  INVALID_FILE_COUNT: "A selected source has an invalid discovered-file count.",
  INVALID_BYTE_COUNT: "A selected source has an invalid exact byte count.",
  SELECTION_FILE_LIMIT_EXCEEDED: "One selected item contains more files than this release can inspect safely.",
  TOTAL_FILE_LIMIT_EXCEEDED: "The basket contains more files than this release can inspect safely.",
  SELECTION_BYTE_LIMIT_EXCEEDED: "One selected item is larger than this release can inspect safely.",
  TOTAL_BYTE_LIMIT_EXCEEDED: "The basket is larger than this release can inspect safely.",
  DUPLICATE_SOURCE_PATH: "The same source location appears more than once in the basket.",
  DUPLICATE_SOURCE_IDENTITY: "Two basket items refer to the same underlying Windows file or folder.",
  SOURCE_PARENT_CHILD_OVERLAP: "A selected folder already contains another selected basket item.",
  SOURCE_OUTPUT_OVERLAP: "The output location and one selected source overlap.",
});

export class TrustedWindowsSourceSetValidationError extends Error {
  readonly code: TrustedWindowsSourceSetErrorCodeV0;
  readonly selectionIndex?: number;

  constructor(code: TrustedWindowsSourceSetErrorCodeV0, selectionIndex?: number) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "TrustedWindowsSourceSetValidationError";
    this.code = code;
    if (selectionIndex !== undefined) this.selectionIndex = selectionIndex;
  }
}

interface ParsedSelection {
  readonly kind: TrustedWindowsSelectionKindV0;
  readonly canonicalAbsolutePath: string;
  readonly comparablePath: string;
  readonly byteCount: bigint;
  readonly byteCountDecimal: string;
  readonly fileCount: number;
  readonly identity: TrustedWindowsSourceIdentityV0;
}

interface ParsedSourceSet {
  readonly sessionNonceHex: string;
  readonly outputComparablePath: string;
  readonly selections: readonly ParsedSelection[];
}

function fail(code: TrustedWindowsSourceSetErrorCodeV0, selectionIndex?: number): never {
  throw new TrustedWindowsSourceSetValidationError(code, selectionIndex);
}

function recordFromUnknown(value: unknown, selectionIndex?: number): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("INVALID_PAYLOAD", selectionIndex);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail("INVALID_PAYLOAD", selectionIndex);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return fail("UNEXPECTED_FIELD", selectionIndex);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      return fail("INVALID_PAYLOAD", selectionIndex);
    }
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  selectionIndex?: number,
): void {
  const expectedSet = new Set(expected);
  if (Object.keys(record).some((key) => !expectedSet.has(key))) {
    fail("UNEXPECTED_FIELD", selectionIndex);
  }
  if (expected.some((key) => !Object.hasOwn(record, key))) {
    fail("MISSING_REQUIRED_FIELD", selectionIndex);
  }
}

function isDevicePath(value: string): boolean {
  const folded = value.toLocaleLowerCase("en-US");
  return folded.startsWith("\\\\?\\") ||
    folded.startsWith("\\\\.\\") ||
    folded.startsWith("\\??\\") ||
    folded.startsWith("\\global??\\") ||
    folded.startsWith("\\device\\");
}

function assertSafeWindowsSegment(segment: string, selectionIndex?: number): void {
  const basename = segment.split(".", 1)[0]?.toLocaleUpperCase("en-US") ?? "";
  if (
    segment.length === 0 ||
    segment.length > MAX_WINDOWS_SEGMENT_CODE_UNITS ||
    segment === "." ||
    segment === ".." ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    WINDOWS_INVALID_SEGMENT.test(segment) ||
    hasControlCharacter(segment) ||
    WINDOWS_BIDI_CONTROL.test(segment) ||
    WINDOWS_RESERVED_BASENAME.test(basename)
  ) {
    fail("UNSAFE_WINDOWS_PATH_SEGMENT", selectionIndex);
  }
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function canonicalAbsoluteDosPath(value: unknown, selectionIndex?: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_WINDOWS_PATH_CODE_UNITS) {
    return fail("INVALID_ABSOLUTE_DOS_PATH", selectionIndex);
  }
  if (isDevicePath(value)) return fail("DEVICE_PATH_REJECTED", selectionIndex);
  if (value.startsWith("\\\\") || value.startsWith("//")) {
    return fail("UNC_PATH_REJECTED", selectionIndex);
  }
  if (/^[a-z]:\\/u.test(value)) return fail("NON_CANONICAL_PATH", selectionIndex);
  if (!/^[A-Z]:\\/u.test(value)) return fail("INVALID_ABSOLUTE_DOS_PATH", selectionIndex);
  if (value.length === 3) return fail("VOLUME_ROOT_REJECTED", selectionIndex);
  if (value.includes("/") || value.endsWith("\\") || win32.normalize(value) !== value) {
    return fail("NON_CANONICAL_PATH", selectionIndex);
  }
  for (const segment of value.slice(3).split("\\")) {
    assertSafeWindowsSegment(segment, selectionIndex);
  }
  return value;
}

function comparablePath(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

type ResolvedPathMatchModeV0 = "javascript_v0_case_fold" | "literal_native_final_path";

function assertResolvedPathMatch(
  canonicalPath: string,
  resolvedValue: unknown,
  selectionIndex?: number,
  mode: ResolvedPathMatchModeV0 = "javascript_v0_case_fold",
): void {
  const resolvedPath = canonicalAbsoluteDosPath(resolvedValue, selectionIndex);
  const matches = mode === "literal_native_final_path"
    ? canonicalPath === resolvedPath
    : comparablePath(canonicalPath) === comparablePath(resolvedPath);
  if (!matches) {
    fail("PATH_RESOLUTION_MISMATCH", selectionIndex);
  }
}

function parseSourcePathEvidence(value: unknown, selectionIndex: number): void {
  const evidence = recordFromUnknown(value, selectionIndex);
  assertExactKeys(evidence, [
    "acquisition", "canonicalization", "inspectionMode", "pathIdentityCheckedByHandle",
    "reparseInspectionScope", "reparseInspectionComplete", "reparsePointsEncountered",
    "inventoryComplete", "regularFilesOnly",
  ], selectionIndex);
  if (
    (
      evidence.acquisition !== "windows_native_picker_handle" &&
      evidence.acquisition !== "windows_native_drop_cfhdrop_then_handle_open"
    ) ||
    evidence.canonicalization !== "final_path_by_handle" ||
    evidence.inspectionMode !== "read_only" ||
    evidence.pathIdentityCheckedByHandle !== true ||
    evidence.inventoryComplete !== true ||
    evidence.regularFilesOnly !== true
  ) {
    fail("INCOMPLETE_TRUSTED_PATH_EVIDENCE", selectionIndex);
  }
  if (
    evidence.reparseInspectionScope !== "volume_root_through_complete_selection" ||
    evidence.reparseInspectionComplete !== true
  ) {
    fail("INCOMPLETE_REPARSE_INSPECTION", selectionIndex);
  }
  assertNoReparsePoints(evidence.reparsePointsEncountered, selectionIndex);
}

function parseConfiguredOutputPathEvidence(value: unknown): void {
  const evidence = recordFromUnknown(value);
  assertExactKeys(evidence, [
    "acquisition", "canonicalization", "inspectionMode", "reparseInspectionScope",
    "reparseInspectionComplete", "reparsePointsEncountered",
  ]);
  if (
    evidence.acquisition !== "trusted_launcher_output_configuration" ||
    evidence.canonicalization !== "resolved_existing_ancestor_and_validated_suffix" ||
    evidence.inspectionMode !== "read_only"
  ) {
    fail("INCOMPLETE_TRUSTED_PATH_EVIDENCE");
  }
  if (
    evidence.reparseInspectionScope !== "volume_root_through_output_parent" ||
    evidence.reparseInspectionComplete !== true
  ) {
    fail("INCOMPLETE_REPARSE_INSPECTION");
  }
  assertNoReparsePoints(evidence.reparsePointsEncountered);
}

function parseExistingOutputDirectoryPathEvidence(value: unknown): void {
  const evidence = recordFromUnknown(value);
  assertExactKeys(evidence, [
    "acquisition", "canonicalization", "inspectionMode", "pathIdentityCheckedByHandle",
    "directoryTypeCheckedByHandle", "reparseInspectionScope",
    "reparseInspectionComplete", "reparsePointsEncountered",
  ]);
  if (
    evidence.acquisition !== "windows_native_output_directory_handle" ||
    evidence.canonicalization !== "final_path_by_handle" ||
    evidence.inspectionMode !== "read_only" ||
    evidence.pathIdentityCheckedByHandle !== true ||
    evidence.directoryTypeCheckedByHandle !== true
  ) {
    fail("INCOMPLETE_TRUSTED_PATH_EVIDENCE");
  }
  if (
    evidence.reparseInspectionScope !== "volume_root_through_output_directory" ||
    evidence.reparseInspectionComplete !== true
  ) {
    fail("INCOMPLETE_REPARSE_INSPECTION");
  }
  assertNoReparsePoints(evidence.reparsePointsEncountered);
}

function assertNoReparsePoints(value: unknown, selectionIndex?: number): void {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== "number" ||
    value < 0 ||
    Object.is(value, -0)
  ) {
    fail("INCOMPLETE_REPARSE_INSPECTION", selectionIndex);
  }
  if (value !== 0) fail("REPARSE_POINT_REJECTED", selectionIndex);
}

function parseIdentity(value: unknown, selectionIndex?: number): TrustedWindowsSourceIdentityV0 {
  const identity = recordFromUnknown(value, selectionIndex);
  assertExactKeys(identity, ["volumeSerialNumberHex", "fileIdHex"], selectionIndex);
  if (
    typeof identity.volumeSerialNumberHex !== "string" ||
    !CANONICAL_VOLUME_SERIAL.test(identity.volumeSerialNumberHex) ||
    typeof identity.fileIdHex !== "string" ||
    !CANONICAL_FILE_ID.test(identity.fileIdHex)
  ) {
    return fail("INVALID_SOURCE_IDENTITY", selectionIndex);
  }
  return {
    volumeSerialNumberHex: identity.volumeSerialNumberHex,
    fileIdHex: identity.fileIdHex,
  };
}

function parseByteCount(value: unknown, selectionIndex: number): bigint {
  if (
    typeof value !== "string" ||
    value.length > MAX_BYTE_COUNT_DIGITS ||
    !CANONICAL_BYTE_COUNT.test(value)
  ) {
    return fail("INVALID_BYTE_COUNT", selectionIndex);
  }
  const byteCount = BigInt(value);
  if (byteCount > BigInt(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxBytesPerSelectionDecimal)) {
    fail("SELECTION_BYTE_LIMIT_EXCEEDED", selectionIndex);
  }
  return byteCount;
}

function parseFileCount(value: unknown, kind: TrustedWindowsSelectionKindV0, selectionIndex: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    Object.is(value, -0)
  ) {
    return fail("INVALID_FILE_COUNT", selectionIndex);
  }
  if (kind === "file" && value !== 1) fail("INVALID_FILE_COUNT", selectionIndex);
  if (value > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxFilesPerSelection) {
    fail("SELECTION_FILE_LIMIT_EXCEEDED", selectionIndex);
  }
  return value;
}

function parseSelection(
  value: unknown,
  selectionIndex: number,
  resolvedPathMatchMode: ResolvedPathMatchModeV0,
): ParsedSelection {
  const source = recordFromUnknown(value, selectionIndex);
  assertExactKeys(source, [
    "kind", "canonicalAbsolutePath", "resolvedAbsolutePath", "byteCountDecimal",
    "fileCount", "identity", "pathEvidence",
  ], selectionIndex);
  if (source.kind !== "file" && source.kind !== "directory") {
    return fail("INVALID_PAYLOAD", selectionIndex);
  }
  const canonicalPath = canonicalAbsoluteDosPath(source.canonicalAbsolutePath, selectionIndex);
  assertResolvedPathMatch(
    canonicalPath,
    source.resolvedAbsolutePath,
    selectionIndex,
    resolvedPathMatchMode,
  );
  parseSourcePathEvidence(source.pathEvidence, selectionIndex);
  const identity = parseIdentity(source.identity, selectionIndex);
  const fileCount = parseFileCount(source.fileCount, source.kind, selectionIndex);
  const byteCount = parseByteCount(source.byteCountDecimal, selectionIndex);
  if (source.kind === "directory" && fileCount === 0 && byteCount !== 0n) {
    fail("INVALID_BYTE_COUNT", selectionIndex);
  }
  return {
    kind: source.kind,
    canonicalAbsolutePath: canonicalPath,
    comparablePath: comparablePath(canonicalPath),
    byteCount,
    byteCountDecimal: byteCount.toString(10),
    fileCount,
    identity,
  };
}

function parseOutputBoundary(
  value: unknown,
  resolvedPathMatchMode: ResolvedPathMatchModeV0,
): { readonly comparable: string } {
  const output = recordFromUnknown(value);
  const existingDirectory = output.kind === "directory";
  assertExactKeys(output, existingDirectory
    ? ["kind", "canonicalAbsolutePath", "resolvedAbsolutePath", "identity", "pathEvidence"]
    : ["canonicalAbsolutePath", "resolvedAbsolutePath", "pathEvidence"]);
  const canonicalPath = canonicalAbsoluteDosPath(output.canonicalAbsolutePath);
  assertResolvedPathMatch(canonicalPath, output.resolvedAbsolutePath, undefined, resolvedPathMatchMode);
  if (existingDirectory) {
    parseIdentity(output.identity);
    parseExistingOutputDirectoryPathEvidence(output.pathEvidence);
  } else {
    parseConfiguredOutputPathEvidence(output.pathEvidence);
  }
  return { comparable: comparablePath(canonicalPath) };
}

function parseSelections(
  value: unknown,
  resolvedPathMatchMode: ResolvedPathMatchModeV0,
): readonly ParsedSelection[] {
  if (!Array.isArray(value)) fail("INVALID_PAYLOAD");
  if (value.length === 0) fail("EMPTY_SOURCE_SET");
  if (value.length > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxSelectedRoots) {
    fail("SELECTED_ROOT_LIMIT_EXCEEDED");
  }
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
    fail("UNEXPECTED_FIELD");
  }
  const parsed: ParsedSelection[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      fail("INVALID_PAYLOAD", index);
    }
    parsed.push(parseSelection(descriptor.value, index, resolvedPathMatchMode));
  }
  return parsed;
}

function parseSourceSet(
  value: unknown,
  resolvedPathMatchMode: ResolvedPathMatchModeV0 = "javascript_v0_case_fold",
): ParsedSourceSet {
  const sourceSet = recordFromUnknown(value);
  assertExactKeys(sourceSet, [
    "schemaVersion", "origin", "browserPathInputAccepted", "sessionNonceHex",
    "outputBoundary", "selections",
  ]);
  if (sourceSet.schemaVersion !== TRUSTED_WINDOWS_SOURCE_SET_INPUT_SCHEMA_VERSION_V0) {
    fail("INVALID_SCHEMA_VERSION");
  }
  if (sourceSet.origin !== "trusted_windows_native_launcher") fail("UNTRUSTED_PATH_ORIGIN");
  if (sourceSet.browserPathInputAccepted !== false) fail("BROWSER_PATH_INPUT_REJECTED");
  if (typeof sourceSet.sessionNonceHex !== "string" || !CANONICAL_NONCE.test(sourceSet.sessionNonceHex)) {
    fail("INVALID_SESSION_NONCE");
  }
  const output = parseOutputBoundary(sourceSet.outputBoundary, resolvedPathMatchMode);
  const selections = parseSelections(sourceSet.selections, resolvedPathMatchMode);
  return {
    sessionNonceHex: sourceSet.sessionNonceHex,
    outputComparablePath: output.comparable,
    selections,
  };
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}\\`);
}

function identityKey(identity: TrustedWindowsSourceIdentityV0): string {
  return `${identity.volumeSerialNumberHex}:${identity.fileIdHex}`;
}

function assertDisjointSelections(selections: readonly ParsedSelection[]): void {
  const paths = new Set<string>();
  const identities = new Set<string>();
  for (const [index, selection] of selections.entries()) {
    if (paths.has(selection.comparablePath)) fail("DUPLICATE_SOURCE_PATH", index);
    const key = identityKey(selection.identity);
    if (identities.has(key)) fail("DUPLICATE_SOURCE_IDENTITY", index);
    for (const prior of selections.slice(0, index)) {
      if (
        isSameOrDescendant(selection.comparablePath, prior.comparablePath) ||
        isSameOrDescendant(prior.comparablePath, selection.comparablePath)
      ) {
        fail("SOURCE_PARENT_CHILD_OVERLAP", index);
      }
    }
    paths.add(selection.comparablePath);
    identities.add(key);
  }
}

function assertUniqueSelectionIdentities(selections: readonly ParsedSelection[]): void {
  const identities = new Set<string>();
  for (const [index, selection] of selections.entries()) {
    const key = identityKey(selection.identity);
    if (identities.has(key)) fail("DUPLICATE_SOURCE_IDENTITY", index);
    identities.add(key);
  }
}

function assertOutputDisjoint(sourceSet: ParsedSourceSet): void {
  for (const [index, source] of sourceSet.selections.entries()) {
    if (
      isSameOrDescendant(sourceSet.outputComparablePath, source.comparablePath) ||
      isSameOrDescendant(source.comparablePath, sourceSet.outputComparablePath)
    ) {
      fail("SOURCE_OUTPUT_OVERLAP", index);
    }
  }
}

function exactTotals(selections: readonly ParsedSelection[]): {
  readonly discoveredFiles: number;
  readonly totalBytes: bigint;
} {
  let discoveredFiles = 0;
  let totalBytes = 0n;
  for (const selection of selections) {
    discoveredFiles += selection.fileCount;
    totalBytes += selection.byteCount;
    if (discoveredFiles > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxDiscoveredFiles) {
      fail("TOTAL_FILE_LIMIT_EXCEEDED");
    }
    if (totalBytes > BigInt(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxTotalBytesDecimal)) {
      fail("TOTAL_BYTE_LIMIT_EXCEEDED");
    }
  }
  return { discoveredFiles, totalBytes };
}

function browserSafeBasename(path: string): {
  readonly displayName: string;
  readonly displayNameWasSanitized: boolean;
} {
  const original = win32.basename(path).normalize("NFC");
  const sanitized = Array.from(original, (character) =>
    BROWSER_LABEL_CHARACTER.test(character) ? character : "�"
  ).join("").replace(/�+/gu, "�");
  const usable = sanitized.trim().length === 0 ? "Unnamed source" : sanitized;
  const codePoints = Array.from(usable);
  const displayName = codePoints.length > MAX_BROWSER_LABEL_CODE_POINTS
    ? `${codePoints.slice(0, MAX_BROWSER_LABEL_CODE_POINTS - 1).join("")}…`
    : usable;
  return {
    displayName,
    displayNameWasSanitized: displayName !== original,
  };
}

function opaqueRef(
  prefix: "src" | "set",
  domain: string,
  nonceHex: string,
  privateValue: unknown,
): string {
  const canonicalPrivateValue = stableCanonicalJson(toCanonicalJson(privateValue));
  const digest = createHmac("sha256", Buffer.from(nonceHex, "hex"))
    .update(domain, "ascii")
    .update(Buffer.from([0]))
    .update(canonicalPrivateValue, "utf8")
    .digest("hex");
  return `${prefix}_${digest}`;
}

function sourceSummary(
  source: ParsedSelection,
  basketPosition: number,
  nonceHex: string,
): BrowserSafeSourceSummaryV0 {
  const label = browserSafeBasename(source.canonicalAbsolutePath);
  const sourceRef = opaqueRef("src", SOURCE_REF_DOMAIN, nonceHex, {
    canonicalPath: source.comparablePath,
    identity: source.identity,
    kind: source.kind,
  });
  return {
    basketPosition,
    sourceRef,
    kind: source.kind,
    displayName: label.displayName,
    displayNameSafety: "sanitized_basename_only_plain_text",
    displayNameWasSanitized: label.displayNameWasSanitized,
    fileCount: source.fileCount,
    byteCountDecimal: source.byteCountDecimal,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
  return Object.freeze(value);
}

function manifestBody(sourceSet: ParsedSourceSet): Omit<TrustedWindowsSourceSetManifestV0, "manifestDigestSha256"> {
  assertDisjointSelections(sourceSet.selections);
  assertOutputDisjoint(sourceSet);
  const totals = exactTotals(sourceSet.selections);
  const sources = sourceSet.selections.map((source, index) =>
    sourceSummary(source, index + 1, sourceSet.sessionNonceHex)
  );
  const sourceSetRef = opaqueRef("set", SOURCE_SET_REF_DOMAIN, sourceSet.sessionNonceHex, {
    outputPath: sourceSet.outputComparablePath,
    sources: sourceSet.selections.map((source) => ({
      canonicalPath: source.comparablePath,
      identity: source.identity,
      kind: source.kind,
      fileCount: source.fileCount,
      byteCountDecimal: source.byteCountDecimal,
    })),
  });
  return {
    schemaVersion: TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_SCHEMA_VERSION_V0,
    authority: "none",
    use: "read_only_selection_review",
    sourceSetRef,
    sources,
    totals: {
      selectedRoots: sourceSet.selections.length,
      discoveredFiles: totals.discoveredFiles,
      totalBytesDecimal: totals.totalBytes.toString(10),
    },
    limits: TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0,
  };
}

export function buildTrustedWindowsSourceSetManifestV0(
  input: unknown,
): TrustedWindowsSourceSetManifestV0 {
  const body = manifestBody(parseSourceSet(input));
  const digest = domainSeparatedSha256(MANIFEST_DIGEST_DOMAIN, toCanonicalJson(body));
  return deepFreeze({
    ...body,
    manifestDigestSha256: `sha256:${digest}`,
  });
}

/**
 * Strict non-relational V0 precheck for the V1 native-transcript wrapper.
 * It validates exact shapes, literal final paths, handle/reparse evidence,
 * identities, counts, and limits, but deliberately performs no JavaScript path
 * case folding or parent/child decisions. Default V0 behavior is unchanged.
 */
export function assertTrustedWindowsSourceSetStructuralContractV0(input: unknown): void {
  const parsed = parseSourceSet(input, "literal_native_final_path");
  assertUniqueSelectionIdentities(parsed.selections);
  exactTotals(parsed.selections);
}

function parseManifestNaturalNumber(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    Object.is(value, -0)
  ) {
    throw new TypeError("Invalid source-set manifest count");
  }
  return value;
}

function parseManifestByteCount(value: unknown): bigint {
  if (
    typeof value !== "string" ||
    value.length > MAX_BYTE_COUNT_DIGITS ||
    !CANONICAL_BYTE_COUNT.test(value)
  ) {
    throw new TypeError("Invalid source-set manifest byte count");
  }
  return BigInt(value);
}

function parseManifestLimits(value: unknown): typeof TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0 {
  const limits = recordFromUnknown(value);
  assertExactKeys(limits, [
    "maxSelectedRoots",
    "maxFilesPerSelection",
    "maxDiscoveredFiles",
    "maxBytesPerSelectionDecimal",
    "maxTotalBytesDecimal",
  ]);
  for (const [key, expected] of Object.entries(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0)) {
    if (limits[key] !== expected) throw new TypeError("Source-set manifest limits changed");
  }
  return TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0;
}

function parseBrowserSafeSummary(
  value: unknown,
  expectedPosition: number,
): BrowserSafeSourceSummaryV0 {
  const summary = recordFromUnknown(value);
  assertExactKeys(summary, [
    "basketPosition",
    "sourceRef",
    "kind",
    "displayName",
    "displayNameSafety",
    "displayNameWasSanitized",
    "fileCount",
    "byteCountDecimal",
  ]);
  if (summary.basketPosition !== expectedPosition) {
    throw new TypeError("Source-set manifest basket positions are not canonical");
  }
  if (typeof summary.sourceRef !== "string" || !CANONICAL_SOURCE_REF.test(summary.sourceRef)) {
    throw new TypeError("Invalid source-set manifest source reference");
  }
  if (summary.kind !== "file" && summary.kind !== "directory") {
    throw new TypeError("Invalid source-set manifest source kind");
  }
  if (
    typeof summary.displayName !== "string" ||
    summary.displayName.length === 0 ||
    Array.from(summary.displayName).length > MAX_BROWSER_LABEL_CODE_POINTS ||
    hasControlCharacter(summary.displayName) ||
    WINDOWS_BIDI_CONTROL.test(summary.displayName) ||
    Array.from(summary.displayName).some((character) =>
      character !== "�" && character !== "…" && !BROWSER_LABEL_CHARACTER.test(character)
    )
  ) {
    throw new TypeError("Invalid source-set manifest display name");
  }
  if (
    summary.displayNameSafety !== "sanitized_basename_only_plain_text" ||
    typeof summary.displayNameWasSanitized !== "boolean"
  ) {
    throw new TypeError("Invalid source-set manifest display-name safety claim");
  }
  const fileCount = parseManifestNaturalNumber(summary.fileCount);
  if (summary.kind === "file" && fileCount !== 1) {
    throw new TypeError("A file summary must represent exactly one file");
  }
  if (fileCount > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxFilesPerSelection) {
    throw new TypeError("Source-set manifest selection file limit exceeded");
  }
  const byteCount = parseManifestByteCount(summary.byteCountDecimal);
  if (byteCount > BigInt(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxBytesPerSelectionDecimal)) {
    throw new TypeError("Source-set manifest selection byte limit exceeded");
  }
  if (summary.kind === "directory" && fileCount === 0 && byteCount !== 0n) {
    throw new TypeError("An empty directory summary cannot claim source bytes");
  }
  return {
    basketPosition: expectedPosition,
    sourceRef: summary.sourceRef,
    kind: summary.kind,
    displayName: summary.displayName,
    displayNameSafety: summary.displayNameSafety,
    displayNameWasSanitized: summary.displayNameWasSanitized,
    fileCount,
    byteCountDecimal: byteCount.toString(10),
  };
}

function parseTrustedWindowsSourceSetManifestV0(
  input: unknown,
): TrustedWindowsSourceSetManifestV0 {
  const manifest = recordFromUnknown(input);
  assertExactKeys(manifest, [
    "schemaVersion",
    "authority",
    "use",
    "sourceSetRef",
    "sources",
    "totals",
    "limits",
    "manifestDigestSha256",
  ]);
  if (
    manifest.schemaVersion !== TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_SCHEMA_VERSION_V0 ||
    manifest.authority !== "none" ||
    manifest.use !== "read_only_selection_review" ||
    typeof manifest.sourceSetRef !== "string" ||
    !CANONICAL_SOURCE_SET_REF.test(manifest.sourceSetRef) ||
    typeof manifest.manifestDigestSha256 !== "string" ||
    !CANONICAL_MANIFEST_DIGEST.test(manifest.manifestDigestSha256)
  ) {
    throw new TypeError("Invalid source-set manifest identity or policy");
  }
  if (!Array.isArray(manifest.sources)) {
    throw new TypeError("Invalid source-set manifest source list");
  }
  if (
    manifest.sources.length === 0 ||
    manifest.sources.length > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxSelectedRoots
  ) {
    throw new TypeError("Invalid source-set manifest source count");
  }
  const expectedSourceArrayKeys = new Set([
    "length",
    ...Array.from({ length: manifest.sources.length }, (_, index) => String(index)),
  ]);
  if (
    Reflect.ownKeys(manifest.sources).some((key) =>
      typeof key !== "string" || !expectedSourceArrayKeys.has(key)
    )
  ) {
    throw new TypeError("Source-set manifest source list is not a dense exact array");
  }
  const sources: BrowserSafeSourceSummaryV0[] = [];
  for (let index = 0; index < manifest.sources.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(manifest.sources, String(index));
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError("Source-set manifest source list is not a dense data array");
    }
    sources.push(parseBrowserSafeSummary(descriptor.value, index + 1));
  }
  if (new Set(sources.map((source) => source.sourceRef)).size !== sources.length) {
    throw new TypeError("Source-set manifest references must be unique");
  }
  const totals = recordFromUnknown(manifest.totals);
  assertExactKeys(totals, ["selectedRoots", "discoveredFiles", "totalBytesDecimal"]);
  const selectedRoots = parseManifestNaturalNumber(totals.selectedRoots);
  const discoveredFiles = parseManifestNaturalNumber(totals.discoveredFiles);
  const totalBytes = parseManifestByteCount(totals.totalBytesDecimal);
  const expectedFiles = sources.reduce((sum, source) => sum + source.fileCount, 0);
  const expectedBytes = sources.reduce(
    (sum, source) => sum + BigInt(source.byteCountDecimal),
    0n,
  );
  if (
    selectedRoots !== sources.length ||
    discoveredFiles !== expectedFiles ||
    totalBytes !== expectedBytes ||
    discoveredFiles > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxDiscoveredFiles ||
    totalBytes > BigInt(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxTotalBytesDecimal)
  ) {
    throw new TypeError("Source-set manifest totals do not match its sources");
  }
  const limits = parseManifestLimits(manifest.limits);
  return {
    schemaVersion: TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_SCHEMA_VERSION_V0,
    authority: "none",
    use: "read_only_selection_review",
    sourceSetRef: manifest.sourceSetRef,
    sources,
    totals: {
      selectedRoots,
      discoveredFiles,
      totalBytesDecimal: totalBytes.toString(10),
    },
    limits,
    manifestDigestSha256: manifest.manifestDigestSha256,
  };
}

export function verifyTrustedWindowsSourceSetManifestV0(
  input: unknown,
): boolean {
  try {
    const manifest = parseTrustedWindowsSourceSetManifestV0(input);
    const match = CANONICAL_MANIFEST_DIGEST.exec(manifest.manifestDigestSha256);
    if (match?.[1] === undefined) return false;
    const { manifestDigestSha256: _digest, ...body } = manifest;
    const expected = domainSeparatedSha256(MANIFEST_DIGEST_DOMAIN, toCanonicalJson(body));
    return timingSafeEqual(Buffer.from(match[1], "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

import { createHmac, randomBytes as nodeRandomBytes } from "node:crypto";
import { win32 } from "node:path";

const BASKET_VIEW_SCHEMA_VERSION = "trusted-windows-native-source-basket-view.v0";
const BASKET_EVENT_SCHEMA_VERSION = "trusted-windows-native-source-basket-event.v0";
const ADAPTER_RESPONSE_SCHEMA_VERSION = "trusted-windows-native-adapter-response.v0";
const PATH_COMPARISON_SCHEMA_VERSION = "trusted-windows-native-path-comparison.v0";
const SOURCE_REF_DOMAIN = "OMNITWIN.TRUSTED_WINDOWS_NATIVE_BASKET_SOURCE_REF.V0";
const MAX_PATH_CODE_UNITS = 32_767;
const MAX_PATH_SEGMENT_CODE_UNITS = 255;
const MAX_BYTE_COUNT_DIGITS = 32;
const MAX_DISPLAY_CODE_POINTS = 120;
const MAX_SELECTED_ROOTS = 128;
const MAX_FILES_PER_SELECTION = 1_000_000;
const MAX_DISCOVERED_FILES = 1_000_000;
const MAX_BYTES_PER_SELECTION = 4_398_046_511_104n;
const MAX_TOTAL_BYTES = 8_796_093_022_208n;
const BYTE_COUNT = /^(?:0|[1-9][0-9]*)$/u;
const VOLUME_SERIAL = /^[A-F0-9]{8}(?:[A-F0-9]{8})?$/u;
const FILE_ID = /^[A-F0-9]{32}$/u;
const SAFE_PUBLIC_CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;
const INVALID_WINDOWS_SEGMENT = /[<>:"/\\|?*]/u;
const WINDOWS_BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/u;
const WINDOWS_RESERVED_BASENAME = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM(?:[1-9]|[¹²³])|LPT(?:[1-9]|[¹²³]))$/u;
const SAFE_DISPLAY_CHARACTER = /^[\p{L}\p{N} ._()+-]$/u;

export const FAIL_CLOSED_WINDOWS_NATIVE_ADAPTER_BLOCKERS_V0 = Object.freeze([
  "Node.js has no built-in Windows Common Item Dialog API for trusted file and folder selection.",
  "Node.js file statistics do not expose the opened handle's Windows volume serial and 128-bit file ID.",
  "Node.js does not provide race-resistant handle traversal for every ancestor, descendant, junction, and reparse tag.",
  "A not-yet-created output needs native existing-ancestor resolution and reparse checks before its suffix is accepted.",
] as const);

/** Structural mirror of the package contract, checked again by its real V0 validator at start. */
export interface TrustedWindowsSourceIdentityV0 {
  readonly volumeSerialNumberHex: string;
  readonly fileIdHex: string;
}

export interface TrustedWindowsSourcePathEvidenceV0 {
  readonly acquisition:
    | "windows_native_picker_handle"
    | "windows_native_drop_cfhdrop_then_handle_open";
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
  readonly kind: "file" | "directory";
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
  readonly schemaVersion: "trusted-windows-native-source-set-input.v0";
  readonly origin: "trusted_windows_native_launcher";
  readonly browserPathInputAccepted: false;
  readonly sessionNonceHex: string;
  readonly outputBoundary: TrustedWindowsOutputBoundaryV0;
  readonly selections: readonly TrustedWindowsSourceSelectionV0[];
}

export interface TrustedWindowsSourceSelectionEvidenceV0 extends TrustedWindowsSourceSelectionV0 {
  /** Private native evidence. It is checked and removed before the V0 source-set input is emitted. */
  readonly inventoryFileIdentities: readonly TrustedWindowsSourceIdentityV0[];
}

export type NativeAdapterOperationV0 = "add_files" | "add_folder" | "add_dropped" | "start";

export interface NativeAdapterRequestV0 {
  readonly schemaVersion: "trusted-windows-native-adapter-request.v0";
  readonly requestRef: string;
  readonly sessionRef: string;
  readonly operation: NativeAdapterOperationV0;
  readonly readOnly: true;
  readonly browserPathInputAccepted: false;
}

export interface NativePathComparisonRequestV0 {
  readonly schemaVersion: "trusted-windows-native-path-comparison-request.v0";
  readonly requestRef: string;
  readonly sessionRef: string;
  readonly operation: "compare_paths";
  readonly leftCanonicalAbsolutePath: string;
  readonly rightCanonicalAbsolutePath: string;
  readonly readOnly: true;
}

interface NativeAdapterResponseBaseV0 {
  readonly schemaVersion: typeof ADAPTER_RESPONSE_SCHEMA_VERSION;
  readonly requestRef: string;
  readonly operation: NativeAdapterOperationV0;
}

export interface NativeSourcePickerSelectedResponseV0 extends NativeAdapterResponseBaseV0 {
  readonly operation: "add_files" | "add_folder" | "add_dropped";
  readonly status: "selected";
  readonly selections: readonly TrustedWindowsSourceSelectionEvidenceV0[];
}

export interface NativeSourcePickerCancelledResponseV0 extends NativeAdapterResponseBaseV0 {
  readonly operation: "add_files" | "add_folder" | "add_dropped";
  readonly status: "cancelled";
}

export interface NativeAdapterUnavailableResponseV0 extends NativeAdapterResponseBaseV0 {
  readonly status: "unavailable";
  readonly code: string;
}

export interface NativeAdapterFailedResponseV0 extends NativeAdapterResponseBaseV0 {
  readonly status: "failed";
  readonly code: string;
}

export type NativeSourcePickerResponseV0 =
  | NativeSourcePickerSelectedResponseV0
  | NativeSourcePickerCancelledResponseV0
  | NativeAdapterUnavailableResponseV0
  | NativeAdapterFailedResponseV0;

export interface NativeOutputBoundaryResolvedResponseV0 extends NativeAdapterResponseBaseV0 {
  readonly operation: "start";
  readonly status: "resolved";
  readonly outputBoundary: TrustedWindowsOutputBoundaryV0;
}

export interface NativeOutputBoundaryCancelledResponseV0 extends NativeAdapterResponseBaseV0 {
  readonly operation: "start";
  readonly status: "cancelled";
}

export type NativeOutputBoundaryResponseV0 =
  | NativeOutputBoundaryResolvedResponseV0
  | NativeOutputBoundaryCancelledResponseV0
  | NativeAdapterUnavailableResponseV0
  | NativeAdapterFailedResponseV0;

export type NativePathRelationV0 = "same" | "left_ancestor" | "left_descendant" | "disjoint";

export interface NativePathComparedResponseV0 {
  readonly schemaVersion: typeof PATH_COMPARISON_SCHEMA_VERSION;
  readonly requestRef: string;
  readonly status: "compared";
  readonly comparisonAuthority: "windows_compare_string_ordinal_ignore_case";
  readonly relation: NativePathRelationV0;
}

export interface NativePathComparisonUnavailableResponseV0 {
  readonly schemaVersion: typeof PATH_COMPARISON_SCHEMA_VERSION;
  readonly requestRef: string;
  readonly status: "unavailable" | "failed";
  readonly code: string;
}

export type NativePathComparisonResponseV0 =
  | NativePathComparedResponseV0
  | NativePathComparisonUnavailableResponseV0;

export interface TrustedWindowsNativeSourceAdapterV0 {
  pickFiles(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0>;
  pickFolder(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0>;
  dropSources(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0>;
  resolveOutputBoundary(request: NativeAdapterRequestV0): Promise<NativeOutputBoundaryResponseV0>;
  compareCanonicalPaths(request: NativePathComparisonRequestV0): Promise<NativePathComparisonResponseV0>;
}

export type TrustedWindowsSourceBasketActionV0 =
  | "add_files"
  | "add_folder"
  | "add_dropped"
  | "remove"
  | "clear"
  | "cancel"
  | "start";

export interface TrustedWindowsSourceBasketEventBindingV0 {
  readonly schemaVersion: typeof BASKET_EVENT_SCHEMA_VERSION;
  readonly sessionRef: string;
  readonly revision: number;
  readonly eventToken: string;
}

export type TrustedWindowsSourceBasketEventV0 =
  | (TrustedWindowsSourceBasketEventBindingV0 & {
    readonly action: Exclude<TrustedWindowsSourceBasketActionV0, "remove">;
  })
  | (TrustedWindowsSourceBasketEventBindingV0 & {
    readonly action: "remove";
    readonly sourceRef: string;
  });

export type TrustedWindowsSourceBasketStatusV0 =
  | "ready"
  | "started"
  | "start_uncertain"
  | "cancelled";

export interface TrustedWindowsSourceBasketSummaryV0 {
  readonly basketPosition: number;
  readonly sourceRef: string;
  readonly kind: "file" | "directory";
  readonly displayName: string;
  readonly displayNameSafety: "sanitized_basename_only_plain_text";
  readonly displayNameWasSanitized: boolean;
  readonly fileCount: number;
  readonly byteCountDecimal: string;
}

export interface TrustedWindowsSourceBasketViewV0 {
  readonly schemaVersion: typeof BASKET_VIEW_SCHEMA_VERSION;
  readonly sessionRef: string;
  readonly revision: number;
  readonly status: TrustedWindowsSourceBasketStatusV0;
  readonly busy: boolean;
  readonly sources: readonly TrustedWindowsSourceBasketSummaryV0[];
  readonly totals: {
    readonly selectedRoots: number;
    readonly discoveredFiles: number;
    readonly totalBytesDecimal: string;
  };
  readonly nextEvent: TrustedWindowsSourceBasketEventBindingV0 | null;
}

export type TrustedWindowsSourceBasketResultStatusV0 =
  | "updated"
  | "picker_cancelled"
  | "drop_cancelled"
  | "selection_rejected"
  | "start_rejected"
  | "adapter_unavailable"
  | "adapter_failed"
  | "started"
  | "start_uncertain"
  | "cancelled";

export interface TrustedWindowsSourceBasketResultV0 {
  readonly status: TrustedWindowsSourceBasketResultStatusV0;
  readonly code: string;
  readonly message: string;
  readonly view: TrustedWindowsSourceBasketViewV0;
}

export type TrustedWindowsNativeSourceBasketErrorCodeV0 =
  | "FORGED_EVENT"
  | "STALE_EVENT"
  | "CONTROLLER_TERMINAL"
  | "FORGED_ADAPTER_RESULT"
  | "RANDOM_SOURCE_FAILED";

const CONTROLLER_ERROR_MESSAGES: Readonly<Record<TrustedWindowsNativeSourceBasketErrorCodeV0, string>> =
  Object.freeze({
    FORGED_EVENT: "The source-basket action was not issued by this native session.",
    STALE_EVENT: "The source-basket action is out of date and cannot be replayed.",
    CONTROLLER_TERMINAL: "This source-basket session has already ended.",
    FORGED_ADAPTER_RESULT: "The native Windows adapter returned evidence that does not match its request.",
    RANDOM_SOURCE_FAILED: "The native source-basket session could not create private one-use tokens.",
  });

const RESULT_MESSAGES = Object.freeze({
  FILES_ADDED: "The selected files were added.",
  FOLDER_ADDED: "The selected folder was added.",
  DROPPED_ITEMS_ADDED: "The dropped files and folders were added.",
  SOURCE_REMOVED: "The selected item was removed.",
  BASKET_CLEARED: "The source basket was cleared.",
  PICKER_CANCELLED: "Nothing was added because the native picker was cancelled.",
  DROP_CANCELLED: "Nothing was added because the native drop panel was closed.",
  DUPLICATE_SOURCE: "That file or folder is already represented in the basket.",
  DUPLICATE_DISCOVERED_FILE: "Two selected folders contain the same underlying Windows file.",
  SOURCE_OVERLAP: "A selected folder already contains another selected item.",
  SOURCE_ROOT_LIMIT: "The basket contains too many selected files or folders.",
  SOURCE_SET_LIMIT: "The selected sources exceed the safe local inspection limits.",
  EMPTY_BASKET: "Add at least one file or folder before starting.",
  SOURCE_OUTPUT_OVERLAP: "The output location overlaps a selected source.",
  SOURCE_SET_CONTRACT_REJECTED: "The basket is not ready for trusted local inspection.",
  WINDOWS_NATIVE_BRIDGE_UNAVAILABLE: "The required trusted Windows picker bridge is not available.",
  NATIVE_ADAPTER_FAILED: "The trusted Windows adapter could not complete the action.",
  STARTED: "The trusted native source set was handed to local inspection.",
  START_UNCERTAIN: "The native handoff may have completed, so it will not be retried automatically.",
  CANCELLED: "The source-basket session was cancelled.",
});

export class TrustedWindowsNativeSourceBasketError extends Error {
  readonly code: TrustedWindowsNativeSourceBasketErrorCodeV0;

  constructor(code: TrustedWindowsNativeSourceBasketErrorCodeV0) {
    super(CONTROLLER_ERROR_MESSAGES[code]);
    this.name = "TrustedWindowsNativeSourceBasketError";
    this.code = code;
  }
}

export interface TrustedWindowsNativeSourceBasketControllerOptionsV0 {
  readonly adapter: TrustedWindowsNativeSourceAdapterV0;
  readonly randomBytes?: (size: number) => Uint8Array;
  /** Optional stricter wrapper caps; omitted values preserve the V0 production limits. */
  readonly maxFilesPerSelection?: number;
  readonly maxDiscoveredFiles?: number;
  /**
   * V1-only composition hook. Default V0 always performs its full historical
   * JavaScript path checks. The structural mode defers path relations to V1's
   * complete native CompareStringOrdinal transcript.
   */
  readonly packageSourceSetValidation?:
    | "v0_full"
    | "v0_structural_for_v1_native_path_transcript";
  /** Optional additional assertion; the package V0 validator always runs first. */
  readonly assertSourceSetInput?: (input: TrustedWindowsNativeSourceSetInputV0) => void;
  /** Native-only sink. The private input is never included in a browser-facing result. */
  readonly acceptTrustedStartInput: (
    input: TrustedWindowsNativeSourceSetInputV0,
  ) => Promise<void> | void;
}

interface PrivateSelection {
  readonly contractSelection: TrustedWindowsSourceSelectionV0;
  readonly inventoryFileIdentities: readonly TrustedWindowsSourceIdentityV0[];
  readonly sourceRef: string;
  readonly summary: Omit<TrustedWindowsSourceBasketSummaryV0, "basketPosition">;
}

interface ParsedEvent {
  readonly sessionRef: string;
  readonly revision: number;
  readonly eventToken: string;
  readonly action: TrustedWindowsSourceBasketActionV0;
  readonly sourceRef?: string;
}

interface ParsedPickerResult {
  readonly status: "selected" | "cancelled" | "unavailable" | "failed";
  readonly selections?: readonly TrustedWindowsSourceSelectionEvidenceV0[];
  readonly code?: string;
}

interface ParsedOutputResult {
  readonly status: "resolved" | "cancelled" | "unavailable" | "failed";
  readonly outputBoundary?: TrustedWindowsOutputBoundaryV0;
  readonly code?: string;
}

function fail(code: TrustedWindowsNativeSourceBasketErrorCodeV0): never {
  throw new TrustedWindowsNativeSourceBasketError(code);
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail("FORGED_ADAPTER_RESULT");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return fail("FORGED_ADAPTER_RESULT");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      return fail("FORGED_ADAPTER_RESULT");
    }
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Readonly<Record<string, unknown>>, expected: readonly string[]): void {
  const keys = Object.keys(record);
  const expectedSet = new Set(expected);
  if (
    keys.length !== expected.length ||
    keys.some((key) => !expectedSet.has(key)) ||
    expected.some((key) => !Object.hasOwn(record, key))
  ) {
    fail("FORGED_ADAPTER_RESULT");
  }
}

function denseArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return fail("FORGED_ADAPTER_RESULT");
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      return fail("FORGED_ADAPTER_RESULT");
    }
    output.push(descriptor.value);
  }
  return output;
}

function eventRecord(value: unknown): Record<string, unknown> {
  try {
    return dataRecord(value);
  } catch {
    return fail("FORGED_EVENT");
  }
}

function parseEvent(value: unknown): ParsedEvent {
  const record = eventRecord(value);
  const action = record.action;
  const actions: readonly TrustedWindowsSourceBasketActionV0[] = [
    "add_files", "add_folder", "add_dropped", "remove", "clear", "cancel", "start",
  ];
  if (typeof action !== "string" || !actions.includes(action as TrustedWindowsSourceBasketActionV0)) {
    return fail("FORGED_EVENT");
  }
  const expected = action === "remove"
    ? ["schemaVersion", "sessionRef", "revision", "eventToken", "action", "sourceRef"]
    : ["schemaVersion", "sessionRef", "revision", "eventToken", "action"];
  try {
    exactKeys(record, expected);
  } catch {
    return fail("FORGED_EVENT");
  }
  if (
    record.schemaVersion !== BASKET_EVENT_SCHEMA_VERSION ||
    typeof record.sessionRef !== "string" ||
    typeof record.eventToken !== "string" ||
    typeof record.revision !== "number" ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0 ||
    Object.is(record.revision, -0) ||
    (action === "remove" && typeof record.sourceRef !== "string")
  ) {
    return fail("FORGED_EVENT");
  }
  return {
    sessionRef: record.sessionRef,
    eventToken: record.eventToken,
    revision: record.revision,
    action: action as TrustedWindowsSourceBasketActionV0,
    ...(action === "remove" ? { sourceRef: record.sourceRef as string } : {}),
  };
}

function hasControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function assertSafeSegment(segment: string): void {
  const basename = segment.split(".", 1)[0]?.toLocaleUpperCase("en-US") ?? "";
  if (
    segment.length === 0 ||
    segment.length > MAX_PATH_SEGMENT_CODE_UNITS ||
    segment === "." ||
    segment === ".." ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    INVALID_WINDOWS_SEGMENT.test(segment) ||
    WINDOWS_BIDI_CONTROL.test(segment) ||
    WINDOWS_RESERVED_BASENAME.test(basename) ||
    hasControl(segment)
  ) {
    fail("FORGED_ADAPTER_RESULT");
  }
}

function canonicalDosPath(value: unknown): string {
  if (typeof value !== "string" || value.length <= 3 || value.length > MAX_PATH_CODE_UNITS) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  const folded = value.toLocaleLowerCase("en-US");
  if (
    folded.startsWith("\\\\?\\") ||
    folded.startsWith("\\\\.\\") ||
    folded.startsWith("\\??\\") ||
    value.startsWith("\\\\") ||
    value.startsWith("//") ||
    !/^[A-Z]:\\/u.test(value) ||
    value.includes("/") ||
    value.endsWith("\\") ||
    win32.normalize(value) !== value
  ) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  for (const segment of value.slice(3).split("\\")) assertSafeSegment(segment);
  return value;
}

function parseIdentity(value: unknown): TrustedWindowsSourceIdentityV0 {
  const record = dataRecord(value);
  exactKeys(record, ["volumeSerialNumberHex", "fileIdHex"]);
  if (
    typeof record.volumeSerialNumberHex !== "string" ||
    !VOLUME_SERIAL.test(record.volumeSerialNumberHex) ||
    typeof record.fileIdHex !== "string" ||
    !FILE_ID.test(record.fileIdHex)
  ) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  return Object.freeze({
    volumeSerialNumberHex: record.volumeSerialNumberHex,
    fileIdHex: record.fileIdHex,
  });
}

function identityKey(identity: TrustedWindowsSourceIdentityV0): string {
  return `${identity.volumeSerialNumberHex}:${identity.fileIdHex}`;
}

function parseSourcePathEvidence(value: unknown): TrustedWindowsSourceSelectionV0["pathEvidence"] {
  const record = dataRecord(value);
  exactKeys(record, [
    "acquisition", "canonicalization", "inspectionMode", "pathIdentityCheckedByHandle",
    "reparseInspectionScope", "reparseInspectionComplete", "reparsePointsEncountered",
    "inventoryComplete", "regularFilesOnly",
  ]);
  if (
    (record.acquisition !== "windows_native_picker_handle" &&
      record.acquisition !== "windows_native_drop_cfhdrop_then_handle_open") ||
    record.canonicalization !== "final_path_by_handle" ||
    record.inspectionMode !== "read_only" ||
    record.pathIdentityCheckedByHandle !== true ||
    record.reparseInspectionScope !== "volume_root_through_complete_selection" ||
    record.reparseInspectionComplete !== true ||
    Object.is(record.reparsePointsEncountered, -0) ||
    record.reparsePointsEncountered !== 0 ||
    record.inventoryComplete !== true ||
    record.regularFilesOnly !== true
  ) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  return Object.freeze({
    acquisition: record.acquisition,
    canonicalization: "final_path_by_handle",
    inspectionMode: "read_only",
    pathIdentityCheckedByHandle: true,
    reparseInspectionScope: "volume_root_through_complete_selection",
    reparseInspectionComplete: true,
    reparsePointsEncountered: 0,
    inventoryComplete: true,
    regularFilesOnly: true,
  });
}

function parseInventoryIdentities(
  value: unknown,
  rootIdentity: TrustedWindowsSourceIdentityV0,
  kind: "file" | "directory",
  fileCount: number,
): readonly TrustedWindowsSourceIdentityV0[] {
  const values = denseArray(value);
  if (values.length !== fileCount) return fail("FORGED_ADAPTER_RESULT");
  const identities = values.map(parseIdentity);
  const unique = new Set(identities.map(identityKey));
  if (unique.size !== identities.length) return fail("FORGED_ADAPTER_RESULT");
  if (kind === "file" && identityKey(identities[0] ?? rootIdentity) !== identityKey(rootIdentity)) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  return Object.freeze(identities);
}

function parseSelectionEvidence(value: unknown): TrustedWindowsSourceSelectionEvidenceV0 {
  const record = dataRecord(value);
  exactKeys(record, [
    "kind", "canonicalAbsolutePath", "resolvedAbsolutePath", "byteCountDecimal",
    "fileCount", "identity", "inventoryFileIdentities", "pathEvidence",
  ]);
  if (record.kind !== "file" && record.kind !== "directory") return fail("FORGED_ADAPTER_RESULT");
  const canonicalPath = canonicalDosPath(record.canonicalAbsolutePath);
  const resolvedPath = canonicalDosPath(record.resolvedAbsolutePath);
  if (canonicalPath !== resolvedPath) return fail("FORGED_ADAPTER_RESULT");
  if (
    typeof record.byteCountDecimal !== "string" ||
    record.byteCountDecimal.length > MAX_BYTE_COUNT_DIGITS ||
    !BYTE_COUNT.test(record.byteCountDecimal) ||
    typeof record.fileCount !== "number" ||
    !Number.isSafeInteger(record.fileCount) ||
    record.fileCount < 0 ||
    Object.is(record.fileCount, -0) ||
    record.fileCount > MAX_FILES_PER_SELECTION ||
    (record.kind === "file" && record.fileCount !== 1) ||
    (record.kind === "directory" && record.fileCount === 0 && record.byteCountDecimal !== "0")
  ) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  const identity = parseIdentity(record.identity);
  const inventoryFileIdentities = parseInventoryIdentities(
    record.inventoryFileIdentities,
    identity,
    record.kind,
    record.fileCount,
  );
  return Object.freeze({
    kind: record.kind,
    canonicalAbsolutePath: canonicalPath,
    resolvedAbsolutePath: resolvedPath,
    byteCountDecimal: record.byteCountDecimal,
    fileCount: record.fileCount,
    identity,
    inventoryFileIdentities,
    pathEvidence: parseSourcePathEvidence(record.pathEvidence),
  });
}

function parseConfiguredOutputPathEvidence(
  value: unknown,
): TrustedWindowsConfiguredOutputPathEvidenceV0 {
  const record = dataRecord(value);
  exactKeys(record, [
    "acquisition", "canonicalization", "inspectionMode", "reparseInspectionScope",
    "reparseInspectionComplete", "reparsePointsEncountered",
  ]);
  if (
    record.acquisition !== "trusted_launcher_output_configuration" ||
    record.canonicalization !== "resolved_existing_ancestor_and_validated_suffix" ||
    record.inspectionMode !== "read_only" ||
    record.reparseInspectionScope !== "volume_root_through_output_parent" ||
    record.reparseInspectionComplete !== true ||
    Object.is(record.reparsePointsEncountered, -0) ||
    record.reparsePointsEncountered !== 0
  ) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  return Object.freeze({
    acquisition: "trusted_launcher_output_configuration",
    canonicalization: "resolved_existing_ancestor_and_validated_suffix",
    inspectionMode: "read_only",
    reparseInspectionScope: "volume_root_through_output_parent",
    reparseInspectionComplete: true,
    reparsePointsEncountered: 0,
  });
}

function parseExistingOutputDirectoryPathEvidence(
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
    Object.is(record.reparsePointsEncountered, -0) ||
    record.reparsePointsEncountered !== 0
  ) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  return Object.freeze({
    acquisition: "windows_native_output_directory_handle",
    canonicalization: "final_path_by_handle",
    inspectionMode: "read_only",
    pathIdentityCheckedByHandle: true,
    directoryTypeCheckedByHandle: true,
    reparseInspectionScope: "volume_root_through_output_directory",
    reparseInspectionComplete: true,
    reparsePointsEncountered: 0,
  });
}

function parseOutputBoundary(value: unknown): TrustedWindowsOutputBoundaryV0 {
  const record = dataRecord(value);
  const existingDirectory = record.kind === "directory";
  exactKeys(record, existingDirectory
    ? ["kind", "canonicalAbsolutePath", "resolvedAbsolutePath", "identity", "pathEvidence"]
    : ["canonicalAbsolutePath", "resolvedAbsolutePath", "pathEvidence"]);
  const canonicalPath = canonicalDosPath(record.canonicalAbsolutePath);
  const resolvedPath = canonicalDosPath(record.resolvedAbsolutePath);
  if (canonicalPath !== resolvedPath) return fail("FORGED_ADAPTER_RESULT");
  if (existingDirectory) {
    return Object.freeze({
      kind: "directory",
      canonicalAbsolutePath: canonicalPath,
      resolvedAbsolutePath: resolvedPath,
      identity: parseIdentity(record.identity),
      pathEvidence: parseExistingOutputDirectoryPathEvidence(record.pathEvidence),
    });
  }
  return Object.freeze({
    canonicalAbsolutePath: canonicalPath,
    resolvedAbsolutePath: resolvedPath,
    pathEvidence: parseConfiguredOutputPathEvidence(record.pathEvidence),
  });
}

function parsePublicFailureCode(value: unknown): string {
  if (typeof value !== "string" || !SAFE_PUBLIC_CODE.test(value)) {
    return fail("FORGED_ADAPTER_RESULT");
  }
  return value;
}

function assertAdapterBinding(
  record: Readonly<Record<string, unknown>>,
  request: NativeAdapterRequestV0,
): void {
  if (
    record.schemaVersion !== ADAPTER_RESPONSE_SCHEMA_VERSION ||
    record.requestRef !== request.requestRef ||
    record.operation !== request.operation
  ) {
    fail("FORGED_ADAPTER_RESULT");
  }
}

function parsePickerResponse(value: unknown, request: NativeAdapterRequestV0): ParsedPickerResult {
  const record = dataRecord(value);
  if (record.status === "selected") {
    exactKeys(record, ["schemaVersion", "requestRef", "operation", "status", "selections"]);
    assertAdapterBinding(record, request);
    const selections = denseArray(record.selections).map(parseSelectionEvidence);
    const expectedKind = request.operation === "add_files"
      ? "file"
      : request.operation === "add_folder"
        ? "directory"
        : null;
    const expectedAcquisition = request.operation === "add_dropped"
      ? "windows_native_drop_cfhdrop_then_handle_open"
      : "windows_native_picker_handle";
    if (
      selections.length === 0 ||
      (request.operation === "add_folder" && selections.length !== 1) ||
      (expectedKind !== null && selections.some((selection) => selection.kind !== expectedKind)) ||
      selections.some(
        (selection) => selection.pathEvidence.acquisition !== expectedAcquisition,
      )
    ) {
      return fail("FORGED_ADAPTER_RESULT");
    }
    return { status: "selected", selections };
  }
  if (record.status === "cancelled") {
    exactKeys(record, ["schemaVersion", "requestRef", "operation", "status"]);
    assertAdapterBinding(record, request);
    return { status: "cancelled" };
  }
  if (record.status === "unavailable" || record.status === "failed") {
    exactKeys(record, ["schemaVersion", "requestRef", "operation", "status", "code"]);
    assertAdapterBinding(record, request);
    return { status: record.status, code: parsePublicFailureCode(record.code) };
  }
  return fail("FORGED_ADAPTER_RESULT");
}

function parseOutputResponse(value: unknown, request: NativeAdapterRequestV0): ParsedOutputResult {
  const record = dataRecord(value);
  if (record.status === "resolved") {
    exactKeys(record, ["schemaVersion", "requestRef", "operation", "status", "outputBoundary"]);
    assertAdapterBinding(record, request);
    return { status: "resolved", outputBoundary: parseOutputBoundary(record.outputBoundary) };
  }
  if (record.status === "cancelled") {
    exactKeys(record, ["schemaVersion", "requestRef", "operation", "status"]);
    assertAdapterBinding(record, request);
    return { status: "cancelled" };
  }
  if (record.status === "unavailable" || record.status === "failed") {
    exactKeys(record, ["schemaVersion", "requestRef", "operation", "status", "code"]);
    assertAdapterBinding(record, request);
    return { status: record.status, code: parsePublicFailureCode(record.code) };
  }
  return fail("FORGED_ADAPTER_RESULT");
}

function parseComparisonResponse(
  value: unknown,
  request: NativePathComparisonRequestV0,
): { readonly status: "compared" | "unavailable" | "failed"; readonly relation?: NativePathRelationV0; readonly code?: string } {
  const record = dataRecord(value);
  if (record.status === "compared") {
    exactKeys(record, [
      "schemaVersion", "requestRef", "status", "comparisonAuthority", "relation",
    ]);
    const relations: readonly NativePathRelationV0[] = [
      "same", "left_ancestor", "left_descendant", "disjoint",
    ];
    if (
      record.schemaVersion !== PATH_COMPARISON_SCHEMA_VERSION ||
      record.requestRef !== request.requestRef ||
      record.comparisonAuthority !== "windows_compare_string_ordinal_ignore_case" ||
      typeof record.relation !== "string" ||
      !relations.includes(record.relation as NativePathRelationV0)
    ) {
      return fail("FORGED_ADAPTER_RESULT");
    }
    return { status: "compared", relation: record.relation as NativePathRelationV0 };
  }
  if (record.status === "unavailable" || record.status === "failed") {
    exactKeys(record, ["schemaVersion", "requestRef", "status", "code"]);
    if (
      record.schemaVersion !== PATH_COMPARISON_SCHEMA_VERSION ||
      record.requestRef !== request.requestRef
    ) {
      return fail("FORGED_ADAPTER_RESULT");
    }
    return { status: record.status, code: parsePublicFailureCode(record.code) };
  }
  return fail("FORGED_ADAPTER_RESULT");
}

function sanitizedBasename(path: string): {
  readonly displayName: string;
  readonly displayNameWasSanitized: boolean;
} {
  const original = win32.basename(path).normalize("NFC");
  const sanitized = Array.from(original, (character) =>
    SAFE_DISPLAY_CHARACTER.test(character) ? character : "�"
  ).join("").replace(/�+/gu, "�");
  const usable = sanitized.trim().length === 0 ? "Unnamed source" : sanitized;
  const points = Array.from(usable);
  const displayName = points.length > MAX_DISPLAY_CODE_POINTS
    ? `${points.slice(0, MAX_DISPLAY_CODE_POINTS - 1).join("")}…`
    : usable;
  return { displayName, displayNameWasSanitized: displayName !== original };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
  return Object.freeze(value);
}

function contractSelection(
  evidence: TrustedWindowsSourceSelectionEvidenceV0,
): TrustedWindowsSourceSelectionV0 {
  return Object.freeze({
    kind: evidence.kind,
    canonicalAbsolutePath: evidence.canonicalAbsolutePath,
    resolvedAbsolutePath: evidence.resolvedAbsolutePath,
    byteCountDecimal: evidence.byteCountDecimal,
    fileCount: evidence.fileCount,
    identity: evidence.identity,
    pathEvidence: evidence.pathEvidence,
  });
}

interface SourceSetValidatorModuleV0 {
  readonly buildTrustedWindowsSourceSetManifestV0: (input: unknown) => unknown;
  readonly assertTrustedWindowsSourceSetStructuralContractV0?: (input: unknown) => void;
}

function hasSourceSetValidator(value: object): value is SourceSetValidatorModuleV0 {
  const candidate = value as { readonly buildTrustedWindowsSourceSetManifestV0?: unknown };
  return typeof candidate.buildTrustedWindowsSourceSetManifestV0 === "function";
}

async function assertPackageSourceSetContract(
  input: TrustedWindowsNativeSourceSetInputV0,
  mode: NonNullable<TrustedWindowsNativeSourceBasketControllerOptionsV0["packageSourceSetValidation"]>,
): Promise<void> {
  const module: object = await import("@omnitwin/reconstruction-foundry");
  if (!hasSourceSetValidator(module)) throw new Error("The source-set V0 validator is unavailable.");
  if (mode === "v0_structural_for_v1_native_path_transcript") {
    if (typeof module.assertTrustedWindowsSourceSetStructuralContractV0 !== "function") {
      throw new Error("The structural source-set V0 validator is unavailable.");
    }
    module.assertTrustedWindowsSourceSetStructuralContractV0(input);
    return;
  }
  module.buildTrustedWindowsSourceSetManifestV0(input);
}

export class TrustedWindowsNativeSourceBasketControllerV0 {
  readonly #adapter: TrustedWindowsNativeSourceAdapterV0;
  readonly #randomBytes: (size: number) => Uint8Array;
  readonly #assertSourceSetInput?: (input: TrustedWindowsNativeSourceSetInputV0) => void;
  readonly #acceptTrustedStartInput: (
    input: TrustedWindowsNativeSourceSetInputV0,
  ) => Promise<void> | void;
  readonly #maxFilesPerSelection: number;
  readonly #maxDiscoveredFiles: number;
  readonly #packageSourceSetValidation: NonNullable<
    TrustedWindowsNativeSourceBasketControllerOptionsV0["packageSourceSetValidation"]
  >;
  readonly #sessionRef: string;
  #nonce: Buffer | null;
  #eventToken: string | null;
  #revision = 0;
  #status: TrustedWindowsSourceBasketStatusV0 = "ready";
  #busy = false;
  #sources: PrivateSelection[] = [];
  #terminalSummaries: readonly TrustedWindowsSourceBasketSummaryV0[] = [];

  constructor(options: TrustedWindowsNativeSourceBasketControllerOptionsV0) {
    this.#adapter = options.adapter;
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes;
    this.#assertSourceSetInput = options.assertSourceSetInput;
    this.#acceptTrustedStartInput = options.acceptTrustedStartInput;
    this.#maxFilesPerSelection = options.maxFilesPerSelection ?? MAX_FILES_PER_SELECTION;
    this.#maxDiscoveredFiles = options.maxDiscoveredFiles ?? MAX_DISCOVERED_FILES;
    const packageSourceSetValidation: unknown =
      options.packageSourceSetValidation ?? "v0_full";
    if (
      !Number.isSafeInteger(this.#maxFilesPerSelection) ||
      this.#maxFilesPerSelection < 1 ||
      Object.is(this.#maxFilesPerSelection, -0) ||
      this.#maxFilesPerSelection > MAX_FILES_PER_SELECTION ||
      !Number.isSafeInteger(this.#maxDiscoveredFiles) ||
      this.#maxDiscoveredFiles < 1 ||
      Object.is(this.#maxDiscoveredFiles, -0) ||
      this.#maxDiscoveredFiles > MAX_DISCOVERED_FILES ||
      (
        packageSourceSetValidation !== "v0_full" &&
        packageSourceSetValidation !== "v0_structural_for_v1_native_path_transcript"
      )
    ) {
      throw new TypeError("Invalid trusted Windows source-basket limits.");
    }
    this.#packageSourceSetValidation = packageSourceSetValidation;
    this.#sessionRef = `basket_${this.#secretHex(16)}`;
    this.#nonce = this.#secretBytes(32);
    this.#eventToken = `evt_${this.#secretHex(32)}`;
  }

  getView(): TrustedWindowsSourceBasketViewV0 {
    const sources = this.#status === "ready"
      ? this.#sources.map((source, index) => ({ ...source.summary, basketPosition: index + 1 }))
      : this.#terminalSummaries;
    let discoveredFiles = 0;
    let totalBytes = 0n;
    for (const source of sources) {
      discoveredFiles += source.fileCount;
      totalBytes += BigInt(source.byteCountDecimal);
    }
    return deepFreeze({
      schemaVersion: BASKET_VIEW_SCHEMA_VERSION,
      sessionRef: this.#sessionRef,
      revision: this.#revision,
      status: this.#status,
      busy: this.#busy,
      sources,
      totals: {
        selectedRoots: sources.length,
        discoveredFiles,
        totalBytesDecimal: totalBytes.toString(10),
      },
      nextEvent: this.#status === "ready" && !this.#busy && this.#eventToken !== null
        ? {
          schemaVersion: BASKET_EVENT_SCHEMA_VERSION,
          sessionRef: this.#sessionRef,
          revision: this.#revision,
          eventToken: this.#eventToken,
        }
        : null,
    });
  }

  /**
   * Irreversibly clears private source evidence and the session nonce.
   * A stricter wrapper uses this when its own evidence checks fail after V0
   * has already accepted an adapter response.
   */
  disposePrivateState(): void {
    if (this.#status !== "ready") return;
    this.#terminalSummaries = [];
    this.#finishTerminal("cancelled");
  }

  async dispatch(eventValue: unknown): Promise<TrustedWindowsSourceBasketResultV0> {
    const event = parseEvent(eventValue);
    this.#assertEventBinding(event);
    this.#beginEvent();
    try {
      switch (event.action) {
        case "add_files": return await this.#add(event.action);
        case "add_folder": return await this.#add(event.action);
        case "add_dropped": return await this.#add(event.action);
        case "remove": return this.#remove(event.sourceRef ?? "");
        case "clear": return this.#clear();
        case "cancel": return this.#cancel();
        case "start": return await this.#start();
      }
    } catch (error: unknown) {
      if (error instanceof TrustedWindowsNativeSourceBasketError) {
        this.#finishReady();
        throw error;
      }
      return this.#finishReadyResult("adapter_failed", "NATIVE_ADAPTER_FAILED");
    }
  }

  #secretBytes(size: number): Buffer {
    let generated: Uint8Array;
    try {
      generated = this.#randomBytes(size);
    } catch {
      return fail("RANDOM_SOURCE_FAILED");
    }
    if (!(generated instanceof Uint8Array) || generated.byteLength !== size) {
      return fail("RANDOM_SOURCE_FAILED");
    }
    const copied = Buffer.from(generated);
    if (copied.every((byte) => byte === 0)) return fail("RANDOM_SOURCE_FAILED");
    return copied;
  }

  #secretHex(size: number): string {
    return this.#secretBytes(size).toString("hex");
  }

  #assertEventBinding(event: ParsedEvent): void {
    if (event.sessionRef !== this.#sessionRef) fail("FORGED_EVENT");
    if (event.revision !== this.#revision) fail("STALE_EVENT");
    if (this.#status !== "ready") fail("CONTROLLER_TERMINAL");
    if (this.#eventToken === null || event.eventToken !== this.#eventToken) fail("FORGED_EVENT");
  }

  #beginEvent(): void {
    this.#eventToken = null;
    this.#busy = true;
    this.#revision += 1;
  }

  #adapterRequest(operation: NativeAdapterOperationV0): NativeAdapterRequestV0 {
    return Object.freeze({
      schemaVersion: "trusted-windows-native-adapter-request.v0",
      requestRef: `native_request_${this.#secretHex(16)}`,
      sessionRef: this.#sessionRef,
      operation,
      readOnly: true,
      browserPathInputAccepted: false,
    });
  }

  #comparisonRequest(left: string, right: string): NativePathComparisonRequestV0 {
    return Object.freeze({
      schemaVersion: "trusted-windows-native-path-comparison-request.v0",
      requestRef: `native_compare_${this.#secretHex(16)}`,
      sessionRef: this.#sessionRef,
      operation: "compare_paths",
      leftCanonicalAbsolutePath: left,
      rightCanonicalAbsolutePath: right,
      readOnly: true,
    });
  }

  async #add(
    operation: "add_files" | "add_folder" | "add_dropped",
  ): Promise<TrustedWindowsSourceBasketResultV0> {
    const request = this.#adapterRequest(operation);
    const response = operation === "add_files"
      ? await this.#adapter.pickFiles(request)
      : operation === "add_folder"
        ? await this.#adapter.pickFolder(request)
        : await this.#adapter.dropSources(request);
    const parsed = parsePickerResponse(response, request);
    if (parsed.status === "cancelled") {
      return operation === "add_dropped"
        ? this.#finishReadyResult("drop_cancelled", "DROP_CANCELLED")
        : this.#finishReadyResult("picker_cancelled", "PICKER_CANCELLED");
    }
    if (parsed.status === "unavailable") {
      return this.#finishReadyResult("adapter_unavailable", parsed.code ?? "NATIVE_ADAPTER_FAILED");
    }
    if (parsed.status === "failed") {
      return this.#finishReadyResult("adapter_failed", "NATIVE_ADAPTER_FAILED");
    }
    const selections = parsed.selections ?? [];
    if (this.#sources.length + selections.length > MAX_SELECTED_ROOTS) {
      return this.#finishReadyResult("selection_rejected", "SOURCE_ROOT_LIMIT");
    }
    const existingFiles = this.#sources.reduce(
      (total, source) => total + source.contractSelection.fileCount,
      0,
    );
    const selectedFiles = selections.reduce((total, selection) => total + selection.fileCount, 0);
    const existingBytes = this.#sources.reduce(
      (total, source) => total + BigInt(source.contractSelection.byteCountDecimal),
      0n,
    );
    const selectedBytes = selections.reduce(
      (total, selection) => total + BigInt(selection.byteCountDecimal),
      0n,
    );
    if (
      existingFiles + selectedFiles > this.#maxDiscoveredFiles ||
      selections.some((selection) => selection.fileCount > this.#maxFilesPerSelection) ||
      selections.some((selection) => BigInt(selection.byteCountDecimal) > MAX_BYTES_PER_SELECTION) ||
      existingBytes + selectedBytes > MAX_TOTAL_BYTES
    ) {
      return this.#finishReadyResult("selection_rejected", "SOURCE_SET_LIMIT");
    }
    const conflict = await this.#selectionConflict(selections);
    if (conflict !== null) return this.#finishReadyResult("selection_rejected", conflict);
    for (const selection of selections) this.#sources.push(this.#privateSelection(selection));
    return this.#finishReadyResult(
      "updated",
      operation === "add_files"
        ? "FILES_ADDED"
        : operation === "add_folder"
          ? "FOLDER_ADDED"
          : "DROPPED_ITEMS_ADDED",
    );
  }

  async #selectionConflict(
    selections: readonly TrustedWindowsSourceSelectionEvidenceV0[],
  ): Promise<"DUPLICATE_SOURCE" | "DUPLICATE_DISCOVERED_FILE" | "SOURCE_OVERLAP" | null> {
    const existingRootIdentities = new Set(this.#sources.map((source) =>
      identityKey(source.contractSelection.identity)
    ));
    const discoveredFileIdentities = new Set(this.#sources.flatMap((source) =>
      source.inventoryFileIdentities.map(identityKey)
    ));
    const pending: TrustedWindowsSourceSelectionEvidenceV0[] = [];
    for (const selection of selections) {
      const rootKey = identityKey(selection.identity);
      if (existingRootIdentities.has(rootKey)) return "DUPLICATE_SOURCE";
      for (const identity of selection.inventoryFileIdentities) {
        const key = identityKey(identity);
        if (discoveredFileIdentities.has(key)) return "DUPLICATE_DISCOVERED_FILE";
        discoveredFileIdentities.add(key);
      }
      for (const existing of [...this.#sources.map((source) => source.contractSelection), ...pending]) {
        const relation = await this.#comparePaths(
          selection.canonicalAbsolutePath,
          existing.canonicalAbsolutePath,
        );
        if (relation === "same") return "DUPLICATE_SOURCE";
        if (relation !== "disjoint") return "SOURCE_OVERLAP";
      }
      existingRootIdentities.add(rootKey);
      pending.push(selection);
    }
    return null;
  }

  async #comparePaths(left: string, right: string): Promise<NativePathRelationV0> {
    const request = this.#comparisonRequest(left, right);
    const response = parseComparisonResponse(
      await this.#adapter.compareCanonicalPaths(request),
      request,
    );
    if (response.status !== "compared" || response.relation === undefined) {
      throw new Error("The native ordinal path comparison was unavailable.");
    }
    return response.relation;
  }

  #privateSelection(selection: TrustedWindowsSourceSelectionEvidenceV0): PrivateSelection {
    const nonce = this.#nonce;
    if (nonce === null) return fail("CONTROLLER_TERMINAL");
    const display = sanitizedBasename(selection.canonicalAbsolutePath);
    const sourceRef = `basket_src_${createHmac("sha256", nonce)
      .update(SOURCE_REF_DOMAIN, "ascii")
      .update(Buffer.from([0]))
      .update(JSON.stringify([
        selection.canonicalAbsolutePath,
        selection.identity.volumeSerialNumberHex,
        selection.identity.fileIdHex,
      ]), "utf8")
      .digest("hex")}`;
    return Object.freeze({
      contractSelection: contractSelection(selection),
      inventoryFileIdentities: selection.inventoryFileIdentities,
      sourceRef,
      summary: Object.freeze({
        sourceRef,
        kind: selection.kind,
        displayName: display.displayName,
        displayNameSafety: "sanitized_basename_only_plain_text",
        displayNameWasSanitized: display.displayNameWasSanitized,
        fileCount: selection.fileCount,
        byteCountDecimal: selection.byteCountDecimal,
      }),
    });
  }

  #remove(sourceRef: string): TrustedWindowsSourceBasketResultV0 {
    const index = this.#sources.findIndex((source) => source.sourceRef === sourceRef);
    if (index < 0) return fail("FORGED_EVENT");
    this.#sources.splice(index, 1);
    return this.#finishReadyResult("updated", "SOURCE_REMOVED");
  }

  #clear(): TrustedWindowsSourceBasketResultV0 {
    this.#sources = [];
    return this.#finishReadyResult("updated", "BASKET_CLEARED");
  }

  #cancel(): TrustedWindowsSourceBasketResultV0 {
    this.#terminalSummaries = [];
    this.#finishTerminal("cancelled");
    return this.#result("cancelled", "CANCELLED");
  }

  async #start(): Promise<TrustedWindowsSourceBasketResultV0> {
    if (this.#sources.length === 0) {
      return this.#finishReadyResult("start_rejected", "EMPTY_BASKET");
    }
    const request = this.#adapterRequest("start");
    const parsed = parseOutputResponse(await this.#adapter.resolveOutputBoundary(request), request);
    if (parsed.status === "cancelled") {
      return this.#finishReadyResult("picker_cancelled", "PICKER_CANCELLED");
    }
    if (parsed.status === "unavailable") {
      return this.#finishReadyResult("adapter_unavailable", parsed.code ?? "NATIVE_ADAPTER_FAILED");
    }
    if (parsed.status === "failed" || parsed.outputBoundary === undefined) {
      return this.#finishReadyResult("adapter_failed", "NATIVE_ADAPTER_FAILED");
    }
    for (const source of this.#sources) {
      const relation = await this.#comparePaths(
        parsed.outputBoundary.canonicalAbsolutePath,
        source.contractSelection.canonicalAbsolutePath,
      );
      if (relation !== "disjoint") {
        return this.#finishReadyResult("start_rejected", "SOURCE_OUTPUT_OVERLAP");
      }
    }
    const input = this.#buildSourceSetInput(parsed.outputBoundary);
    try {
      await assertPackageSourceSetContract(input, this.#packageSourceSetValidation);
      this.#assertSourceSetInput?.(input);
    } catch {
      return this.#finishReadyResult("start_rejected", "SOURCE_SET_CONTRACT_REJECTED");
    }
    this.#terminalSummaries = this.#currentSummaries();
    try {
      await this.#acceptTrustedStartInput(input);
    } catch {
      this.#finishTerminal("start_uncertain");
      return this.#result("start_uncertain", "START_UNCERTAIN");
    }
    this.#finishTerminal("started");
    return this.#result("started", "STARTED");
  }

  #buildSourceSetInput(outputBoundary: TrustedWindowsOutputBoundaryV0): TrustedWindowsNativeSourceSetInputV0 {
    const nonce = this.#nonce;
    if (nonce === null) return fail("CONTROLLER_TERMINAL");
    return deepFreeze({
      schemaVersion: "trusted-windows-native-source-set-input.v0",
      origin: "trusted_windows_native_launcher",
      browserPathInputAccepted: false,
      sessionNonceHex: nonce.toString("hex"),
      outputBoundary,
      selections: this.#sources.map((source) => source.contractSelection),
    });
  }

  #currentSummaries(): readonly TrustedWindowsSourceBasketSummaryV0[] {
    return this.#sources.map((source, index) => ({ ...source.summary, basketPosition: index + 1 }));
  }

  #finishReady(): void {
    this.#busy = false;
    this.#eventToken = `evt_${this.#secretHex(32)}`;
  }

  #finishReadyResult(
    status: Exclude<TrustedWindowsSourceBasketResultStatusV0, "started" | "start_uncertain" | "cancelled">,
    code: string,
  ): TrustedWindowsSourceBasketResultV0 {
    this.#finishReady();
    return this.#result(status, code);
  }

  #finishTerminal(status: Exclude<TrustedWindowsSourceBasketStatusV0, "ready">): void {
    this.#status = status;
    this.#busy = false;
    this.#eventToken = null;
    this.#sources = [];
    this.#nonce?.fill(0);
    this.#nonce = null;
  }

  #result(
    status: TrustedWindowsSourceBasketResultStatusV0,
    code: string,
  ): TrustedWindowsSourceBasketResultV0 {
    const safeCode = Object.hasOwn(RESULT_MESSAGES, code) ? code : "NATIVE_ADAPTER_FAILED";
    const message = RESULT_MESSAGES[safeCode as keyof typeof RESULT_MESSAGES];
    return deepFreeze({ status, code: safeCode, message, view: this.getView() });
  }
}

function unavailableAdapterResponse(
  request: NativeAdapterRequestV0,
): NativeAdapterUnavailableResponseV0 {
  return Object.freeze({
    schemaVersion: ADAPTER_RESPONSE_SCHEMA_VERSION,
    requestRef: request.requestRef,
    operation: request.operation,
    status: "unavailable",
    code: "WINDOWS_NATIVE_BRIDGE_UNAVAILABLE",
  });
}

export class FailClosedWindowsNativeSourceAdapterV0 implements TrustedWindowsNativeSourceAdapterV0 {
  pickFiles(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return Promise.resolve(unavailableAdapterResponse(request));
  }

  pickFolder(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return Promise.resolve(unavailableAdapterResponse(request));
  }

  dropSources(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return Promise.resolve(unavailableAdapterResponse(request));
  }

  resolveOutputBoundary(request: NativeAdapterRequestV0): Promise<NativeOutputBoundaryResponseV0> {
    return Promise.resolve(unavailableAdapterResponse(request));
  }

  compareCanonicalPaths(
    request: NativePathComparisonRequestV0,
  ): Promise<NativePathComparisonResponseV0> {
    return Promise.resolve(Object.freeze({
      schemaVersion: PATH_COMPARISON_SCHEMA_VERSION,
      requestRef: request.requestRef,
      status: "unavailable",
      code: "WINDOWS_NATIVE_BRIDGE_UNAVAILABLE",
    }));
  }
}

import {
  TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1,
  type TrustedWindowsExistingOutputDirectoryBoundaryV1,
  type TrustedWindowsLocalVolumeEvidenceV1,
  type TrustedWindowsNativePathComparisonsV1,
} from "@omnitwin/reconstruction-foundry";
import {
  FailClosedWindowsNativeSourceAdapterV1,
  type TrustedWindowsNativeFreshSourceSelectionEvidenceV1,
  type TrustedWindowsNativeOutputBoundaryResponseV1,
  type TrustedWindowsNativeRevalidatedStartEvidenceV1,
  type TrustedWindowsNativeRevalidatedStartReleaseV1,
  type TrustedWindowsNativeRevalidatedStartRequestV1,
  type TrustedWindowsNativeRevalidatedStartScopeV1,
  type TrustedWindowsNativeSourceAdapterV1,
  type TrustedWindowsNativeSourcePickerResponseV1,
} from "./trusted-windows-native-source-basket-v1.js";
import type {
  NativeAdapterRequestV0,
  NativePathComparedResponseV0,
  NativePathComparisonRequestV0,
  NativePathComparisonResponseV0,
} from "./trusted-windows-native-source-basket.js";
import { TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1 } from
  "./trusted-windows-native-source-helper-protocol.js";
import { win32 } from "node:path";

const HELPER_SESSION_REF = /^helper_session_(?!0{32}$)[a-f0-9]{32}$/u;
const BASKET_SESSION_REF = /^basket_(?!0{32}$)[a-f0-9]{32}$/u;
const ADAPTER_REQUEST_REF = /^native_request_(?!0{32}$)[a-f0-9]{32}$/u;
const COMPARISON_REQUEST_REF = /^native_compare_(?!0{32}$)[a-f0-9]{32}$/u;
const REVALIDATED_START_REQUEST_REF = /^revalidated_start_(?!0{32}$)[a-f0-9]{32}$/u;
const SOURCE_REF = /^helper_source_(?!0{32}$)[a-f0-9]{32}$/u;
const OUTPUT_REF = /^helper_output_(?!0{32}$)[a-f0-9]{32}$/u;
const SCOPE_REF = /^helper_scope_(?!0{32}$)[a-f0-9]{32}$/u;
const ADAPTER_ID = /^[a-z0-9][a-z0-9._-]{2,95}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const VOLUME_SERIAL = /^[A-F0-9]{16}$/u;
const FILE_ID = /^[A-F0-9]{32}$/u;
const BYTE_COUNT = /^(?:0|[1-9][0-9]*)$/u;
const CAPABILITY = /^[a-z][a-z0-9_]{1,63}$/u;
const MAX_PATH_CODE_UNITS = 32_767;
const MAX_PATH_SEGMENT_CODE_UNITS = 255;
const MAX_BYTE_COUNT_DIGITS = 32;
const INVALID_WINDOWS_SEGMENT = /[<>:"/\\|?*]/u;
const WINDOWS_BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/u;
const WINDOWS_RESERVED_BASENAME =
  /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM(?:[1-9]|[¹²³])|LPT(?:[1-9]|[¹²³]))$/u;

export const TRUSTED_WINDOWS_NATIVE_SOURCE_ADAPTER_REQUIRED_CAPABILITIES_V1 =
  Object.freeze([
    "pick_files",
    "pick_folder",
    "drop_sources",
    "resolve_output",
    "compare_paths",
    "revalidate_start",
    "release_revalidated_start",
    "close",
  ] as const);

/** Exact authenticated-handshake capability gap in the current low-level bridge. */
export const CURRENT_PROCESS_BRIDGE_MISSING_SOURCE_ADAPTER_CAPABILITIES_V1 =
  Object.freeze(
    TRUSTED_WINDOWS_NATIVE_SOURCE_ADAPTER_REQUIRED_CAPABILITIES_V1.filter(
      (capability) => !(TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1 as readonly string[])
        .includes(capability),
    ),
  );

export const TRUSTED_WINDOWS_NATIVE_SOURCE_ADAPTER_UNRESOLVED_GAPS_V1 = Object.freeze([
  "End-to-end custody still lacks production-composed read_source_bytes and write_output_bytes, a live framed data plane, folder-catalog delivery for the helper-private layout, true out-of-band cancellation, authenticated process composition, and race-resistant helper launch authenticity; create_run_output and create_output_file alone do not close those gaps.",
  "The helper still needs a provisional-reference release or active-selection synchronization operation before remove, clear, remove-then-readd, and output reselection can have exact handle lifecycle semantics; duplicate source identities and a second resolved output currently fail closed.",
  "Private JavaScript strings are dropped from adapter mappings after release or confirmed close; JavaScript cannot prove that immutable strings were zeroed in memory.",
] as const);

export type TrustedWindowsNativeSourceAdapterImplementationErrorCodeV1 =
  | "INVALID_HELPER_CLIENT"
  | "ADAPTER_SESSION_MISMATCH"
  | "ADAPTER_OPERATION_BUSY"
  | "ADAPTER_SESSION_CLOSED"
  | "PRIVATE_HELPER_PROTOCOL_FAILURE"
  | "PRIVATE_HELPER_OPERATION_FAILED"
  | "REVALIDATED_SCOPE_REJECTED"
  | "REVALIDATED_SCOPE_RELEASE_FAILED"
  | "HELPER_TEARDOWN_UNCONFIRMED";

const ERROR_MESSAGES: Readonly<
  Record<TrustedWindowsNativeSourceAdapterImplementationErrorCodeV1, string>
> = Object.freeze({
  INVALID_HELPER_CLIENT: "The trusted Windows helper client is unavailable.",
  ADAPTER_SESSION_MISMATCH: "The trusted Windows helper session does not match this basket.",
  ADAPTER_OPERATION_BUSY: "The trusted Windows helper is already processing a request.",
  ADAPTER_SESSION_CLOSED: "The trusted Windows helper session is no longer available.",
  PRIVATE_HELPER_PROTOCOL_FAILURE: "The trusted Windows helper returned invalid private data.",
  PRIVATE_HELPER_OPERATION_FAILED: "The trusted Windows helper could not complete that request.",
  REVALIDATED_SCOPE_REJECTED: "The trusted Windows helper rejected fresh source validation.",
  REVALIDATED_SCOPE_RELEASE_FAILED: "The trusted Windows helper scope could not be safely released.",
  HELPER_TEARDOWN_UNCONFIRMED:
    "The trusted Windows helper process could not be confirmed stopped.",
});

const INTERNAL_ADAPTER_ERROR_CODES = new WeakMap<
  object,
  TrustedWindowsNativeSourceAdapterImplementationErrorCodeV1
>();

export class TrustedWindowsNativeSourceAdapterImplementationErrorV1 extends Error {
  readonly code: TrustedWindowsNativeSourceAdapterImplementationErrorCodeV1;

  constructor(code: TrustedWindowsNativeSourceAdapterImplementationErrorCodeV1) {
    super(ERROR_MESSAGES[code]);
    this.name = "TrustedWindowsNativeSourceAdapterImplementationErrorV1";
    this.code = code;
  }
}

export interface TrustedWindowsNativeSourceAdapterLifecycleV1 {
  /** Resolves only after the exact helper session has confirmed no live scopes remain. */
  closeAndConfirmNoLiveScopes(): Promise<void>;
}

export type TrustedWindowsNativeSourceAdapterWithLifecycleV1 =
  TrustedWindowsNativeSourceAdapterV1 & TrustedWindowsNativeSourceAdapterLifecycleV1;

type RequiredCapability =
  typeof TRUSTED_WINDOWS_NATIVE_SOURCE_ADAPTER_REQUIRED_CAPABILITIES_V1[number];

interface PrivateHelperRequestBaseV1 {
  readonly schema_version: 1;
  readonly operation: RequiredCapability;
  readonly session_ref: string;
  readonly basket_session_ref: string;
  readonly request_ref: string;
}

interface PrivateSourceAcquisitionRequestV1 extends PrivateHelperRequestBaseV1 {
  readonly operation: "pick_files" | "pick_folder" | "drop_sources";
  readonly read_only: true;
  readonly browser_path_input_accepted: false;
}

interface PrivateResolveOutputRequestV1 extends PrivateHelperRequestBaseV1 {
  readonly operation: "resolve_output";
  readonly read_only: true;
  readonly browser_path_input_accepted: false;
}

interface PrivateComparePathsRequestV1 extends PrivateHelperRequestBaseV1 {
  readonly operation: "compare_paths";
  readonly left_canonical_absolute_path: string;
  readonly right_canonical_absolute_path: string;
  readonly read_only: true;
}

interface PrivateRevalidateStartRequestV1 extends PrivateHelperRequestBaseV1 {
  readonly operation: "revalidate_start";
  readonly adapter_id: string;
  readonly adapter_build_sha256: string;
  readonly expected_source_refs: readonly string[];
  readonly expected_output_ref: string;
  readonly read_only: true;
  readonly browser_path_input_accepted: false;
}

interface PrivateReleaseScopeRequestV1 extends PrivateHelperRequestBaseV1 {
  readonly operation: "release_revalidated_start";
  readonly scope_ref: string;
}

/**
 * Trusted composition seam only. Raw DTO types deliberately remain private to
 * this module and are not barrel exports. A rejected `revalidate_start` call
 * must mean that no live scope was created or that cleanup was confirmed.
 */
interface PrivateTrustedWindowsNativeSourceHelperClientV1 {
  readonly session_ref: string;
  readonly capabilities: readonly string[];
  pick_files(request: PrivateSourceAcquisitionRequestV1): Promise<unknown>;
  pick_folder(request: PrivateSourceAcquisitionRequestV1): Promise<unknown>;
  drop_sources(request: PrivateSourceAcquisitionRequestV1): Promise<unknown>;
  resolve_output(request: PrivateResolveOutputRequestV1): Promise<unknown>;
  compare_paths(request: PrivateComparePathsRequestV1): Promise<unknown>;
  revalidate_start(request: PrivateRevalidateStartRequestV1): Promise<unknown>;
  release_revalidated_start(request: PrivateReleaseScopeRequestV1): Promise<unknown>;
  close_and_confirm_no_live_scopes(): Promise<void>;
}

type AdapterState = "ready" | "scope_open" | "spent" | "poisoned";

interface PublicCallRecord {
  readonly generation: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: TrustedWindowsNativeSourceAdapterImplementationErrorV1) => void;
  settled: boolean;
}

interface CloseAttempt {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: TrustedWindowsNativeSourceAdapterImplementationErrorV1) => void;
  readonly owner: PublicCallRecord | null;
  readonly ownerError: TrustedWindowsNativeSourceAdapterImplementationErrorV1 | null;
}

interface StoredSourceReference {
  readonly sourceRef: string;
  readonly evidenceKey: string;
}

interface StoredOutputReference {
  readonly outputRef: string;
  readonly evidenceKey: string;
  readonly identityKey: string;
}

interface RawSelectionResult {
  readonly sourceRef: string;
  readonly evidence: TrustedWindowsNativeFreshSourceSelectionEvidenceV1;
}

function adapterError(
  code: TrustedWindowsNativeSourceAdapterImplementationErrorCodeV1,
): TrustedWindowsNativeSourceAdapterImplementationErrorV1 {
  const error = new TrustedWindowsNativeSourceAdapterImplementationErrorV1(code);
  INTERNAL_ADAPTER_ERROR_CODES.set(error, code);
  return error;
}

function internalAdapterErrorCode(
  error: unknown,
): TrustedWindowsNativeSourceAdapterImplementationErrorCodeV1 | null {
  if (typeof error !== "object" || error === null) return null;
  return INTERNAL_ADAPTER_ERROR_CODES.get(error) ?? null;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some((descriptor) =>
      descriptor.enumerable !== true || !("value" in descriptor)
    )) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
}

function denseArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length") ||
    ownKeys.some((key) => typeof key !== "string" ||
      (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || descriptor.enumerable !== true ||
      !("value" in descriptor)) {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
  }
  return value;
}

function fixedString(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  return value;
}

function hasControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function assertSafeWindowsSegment(segment: string): void {
  const basename = segment.split(".", 1)[0]?.toLocaleUpperCase("en-US") ?? "";
  if (segment.length === 0 || segment.length > MAX_PATH_SEGMENT_CODE_UNITS ||
    segment === "." || segment === ".." || segment.endsWith(".") ||
    segment.endsWith(" ") || INVALID_WINDOWS_SEGMENT.test(segment) ||
    WINDOWS_BIDI_CONTROL.test(segment) || WINDOWS_RESERVED_BASENAME.test(basename) ||
    hasControl(segment)) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
}

function canonicalPrivateDosPath(value: unknown): string {
  if (typeof value !== "string" || value.length <= 3 || value.length > MAX_PATH_CODE_UNITS) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  const folded = value.toLocaleLowerCase("en-US");
  if (folded.startsWith("\\\\?\\") || folded.startsWith("\\\\.\\") ||
    folded.startsWith("\\??\\") || value.startsWith("\\\\") ||
    value.startsWith("//") || !/^[A-Z]:\\/u.test(value) || value.includes("/") ||
    value.endsWith("\\") || win32.normalize(value) !== value) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  for (const segment of value.slice(3).split("\\")) assertSafeWindowsSegment(segment);
  return value;
}

function nonNegativeSafeInteger(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
    value > maximum || Object.is(value, -0)) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  return value;
}

function positiveSafeIndex(value: unknown, maximum: number): number {
  const parsed = nonNegativeSafeInteger(value, maximum);
  if (parsed === 0) throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  return parsed;
}

function parseIdentity(value: unknown): {
  readonly volumeSerialNumberHex: string;
  readonly fileIdHex: string;
} {
  const input = record(value);
  exactKeys(input, ["volume_serial_number_hex", "file_id_hex"]);
  return Object.freeze({
    volumeSerialNumberHex: fixedString(input.volume_serial_number_hex, VOLUME_SERIAL),
    fileIdHex: fixedString(input.file_id_hex, FILE_ID),
  });
}

function identityKey(identity: {
  readonly volumeSerialNumberHex: string;
  readonly fileIdHex: string;
}): string {
  return `${identity.volumeSerialNumberHex}:${identity.fileIdHex}`;
}

function parseLocalVolumeEvidence(
  value: unknown,
  expectedVolumeSerial: string,
): TrustedWindowsLocalVolumeEvidenceV1 {
  const input = record(value);
  exactKeys(input, [
    "opened_handle_file_type",
    "volume_path_resolution",
    "drive_type_query",
    "drive_type",
    "dos_device_query",
    "dos_device_mapping",
    "dos_device_alias_chain_detected",
    "subst_target_detected",
    "unc_redirector_detected",
    "network_device_target_detected",
    "opened_handle_volume_corroboration",
    "opened_handle_volume_serial_number_hex",
    "volume_root_handle_serial_number_hex",
  ]);
  if (input.opened_handle_file_type !== "FILE_TYPE_DISK" ||
    input.volume_path_resolution !== "get_volume_path_name_w" ||
    input.drive_type_query !== "get_drive_type_w" ||
    (input.drive_type !== "DRIVE_FIXED" && input.drive_type !== "DRIVE_REMOVABLE") ||
    input.dos_device_query !== "query_dos_device_w" ||
    input.dos_device_mapping !== "direct_local_volume" ||
    input.dos_device_alias_chain_detected !== false ||
    input.subst_target_detected !== false ||
    input.unc_redirector_detected !== false ||
    input.network_device_target_detected !== false ||
    input.opened_handle_volume_corroboration !==
      "file_id_info_volume_serial_matches_opened_volume_root_handle" ||
    input.opened_handle_volume_serial_number_hex !== expectedVolumeSerial ||
    input.volume_root_handle_serial_number_hex !== expectedVolumeSerial) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  return Object.freeze({
    openedHandleFileType: "FILE_TYPE_DISK",
    volumePathResolution: "get_volume_path_name_w",
    driveTypeQuery: "get_drive_type_w",
    driveType: input.drive_type,
    dosDeviceQuery: "query_dos_device_w",
    dosDeviceMapping: "direct_local_volume",
    dosDeviceAliasChainDetected: false,
    substTargetDetected: false,
    uncRedirectorDetected: false,
    networkDeviceTargetDetected: false,
    openedHandleVolumeCorroboration:
      "file_id_info_volume_serial_matches_opened_volume_root_handle",
    openedHandleVolumeSerialNumberHex: expectedVolumeSerial,
    volumeRootHandleSerialNumberHex: expectedVolumeSerial,
  });
}

type TrustedSourceAcquisition =
  | "windows_native_picker_handle"
  | "windows_native_drop_cfhdrop_then_handle_open";

function parseSourcePathEvidence(
  value: unknown,
  expectedAcquisition: TrustedSourceAcquisition | null = null,
) {
  const input = record(value);
  exactKeys(input, [
    "acquisition", "canonicalization", "inspection_mode",
    "path_identity_checked_by_handle", "reparse_inspection_scope",
    "reparse_inspection_complete", "reparse_points_encountered",
    "inventory_complete", "regular_files_only",
  ]);
  const acquisition = input.acquisition;
  if ((acquisition !== "windows_native_picker_handle" &&
    acquisition !== "windows_native_drop_cfhdrop_then_handle_open") ||
    (expectedAcquisition !== null && acquisition !== expectedAcquisition) ||
    input.canonicalization !== "final_path_by_handle" ||
    input.inspection_mode !== "read_only" ||
    input.path_identity_checked_by_handle !== true ||
    input.reparse_inspection_scope !== "volume_root_through_complete_selection" ||
    input.reparse_inspection_complete !== true ||
    nonNegativeSafeInteger(input.reparse_points_encountered, 0) !== 0 ||
    input.inventory_complete !== true || input.regular_files_only !== true) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  return Object.freeze({
    acquisition,
    canonicalization: "final_path_by_handle" as const,
    inspectionMode: "read_only" as const,
    pathIdentityCheckedByHandle: true as const,
    reparseInspectionScope: "volume_root_through_complete_selection" as const,
    reparseInspectionComplete: true as const,
    reparsePointsEncountered: 0,
    inventoryComplete: true as const,
    regularFilesOnly: true as const,
  });
}

function parseOutputPathEvidence(value: unknown) {
  const input = record(value);
  exactKeys(input, [
    "acquisition", "canonicalization", "inspection_mode",
    "path_identity_checked_by_handle", "directory_type_checked_by_handle",
    "reparse_inspection_scope", "reparse_inspection_complete",
    "reparse_points_encountered",
  ]);
  if (input.acquisition !== "windows_native_output_directory_handle" ||
    input.canonicalization !== "final_path_by_handle" ||
    input.inspection_mode !== "read_only" ||
    input.path_identity_checked_by_handle !== true ||
    input.directory_type_checked_by_handle !== true ||
    input.reparse_inspection_scope !== "volume_root_through_output_directory" ||
    input.reparse_inspection_complete !== true ||
    nonNegativeSafeInteger(input.reparse_points_encountered, 0) !== 0) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  return Object.freeze({
    acquisition: "windows_native_output_directory_handle" as const,
    canonicalization: "final_path_by_handle" as const,
    inspectionMode: "read_only" as const,
    pathIdentityCheckedByHandle: true as const,
    directoryTypeCheckedByHandle: true as const,
    reparseInspectionScope: "volume_root_through_output_directory" as const,
    reparseInspectionComplete: true as const,
    reparsePointsEncountered: 0,
  });
}

function parseRawSelection(
  value: unknown,
  expectedAcquisition: TrustedSourceAcquisition | null = null,
): RawSelectionResult {
  const wrapper = record(value);
  exactKeys(wrapper, ["source_ref", "evidence"]);
  const input = record(wrapper.evidence);
  exactKeys(input, [
    "kind", "canonical_absolute_path", "resolved_absolute_path",
    "byte_count_decimal", "file_count", "identity", "inventory_file_identities",
    "path_evidence", "local_volume_evidence",
  ]);
  if (input.kind !== "file" && input.kind !== "directory") {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  const byteCount = fixedString(input.byte_count_decimal, BYTE_COUNT);
  if (byteCount.length > MAX_BYTE_COUNT_DIGITS ||
    BigInt(byteCount) > BigInt(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxBytesPerSelectionDecimal)) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  const fileCount = nonNegativeSafeInteger(
    input.file_count,
    TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxFilesPerSelection,
  );
  if ((input.kind === "file" && fileCount !== 1) ||
    (input.kind === "directory" && fileCount === 0 && byteCount !== "0")) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  const identity = parseIdentity(input.identity);
  const inventory = denseArray(
    input.inventory_file_identities,
    TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxFilesPerSelection,
  ).map(parseIdentity);
  if (inventory.length !== fileCount) throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  const inventoryKeys = new Set<string>();
  for (const inventoryIdentity of inventory) {
    const key = identityKey(inventoryIdentity);
    if (inventoryIdentity.volumeSerialNumberHex !== identity.volumeSerialNumberHex ||
      inventoryKeys.has(key)) {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
    inventoryKeys.add(key);
  }
  if (input.kind === "file" &&
    (inventory.length !== 1 || identityKey(inventory[0] ?? identity) !== identityKey(identity))) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  const canonicalAbsolutePath = canonicalPrivateDosPath(input.canonical_absolute_path);
  const resolvedAbsolutePath = canonicalPrivateDosPath(input.resolved_absolute_path);
  if (canonicalAbsolutePath !== resolvedAbsolutePath) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  return Object.freeze({
    sourceRef: fixedString(wrapper.source_ref, SOURCE_REF),
    evidence: Object.freeze({
      kind: input.kind,
      canonicalAbsolutePath,
      resolvedAbsolutePath,
      byteCountDecimal: byteCount,
      fileCount,
      identity,
      inventoryFileIdentities: Object.freeze(inventory),
      pathEvidence: parseSourcePathEvidence(input.path_evidence, expectedAcquisition),
      localVolumeEvidence: parseLocalVolumeEvidence(
        input.local_volume_evidence,
        identity.volumeSerialNumberHex,
      ),
    }),
  });
}

function parseRawOutput(value: unknown): {
  readonly outputRef: string;
  readonly boundary: TrustedWindowsExistingOutputDirectoryBoundaryV1;
} {
  const wrapper = record(value);
  exactKeys(wrapper, ["output_ref", "boundary"]);
  const input = record(wrapper.boundary);
  exactKeys(input, [
    "kind", "canonical_absolute_path", "resolved_absolute_path", "identity",
    "path_evidence", "local_volume_evidence",
  ]);
  if (input.kind !== "directory") throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  const identity = parseIdentity(input.identity);
  const canonicalAbsolutePath = canonicalPrivateDosPath(input.canonical_absolute_path);
  const resolvedAbsolutePath = canonicalPrivateDosPath(input.resolved_absolute_path);
  if (canonicalAbsolutePath !== resolvedAbsolutePath) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
  return Object.freeze({
    outputRef: fixedString(wrapper.output_ref, OUTPUT_REF),
    boundary: Object.freeze({
      kind: "directory",
      canonicalAbsolutePath,
      resolvedAbsolutePath,
      identity,
      pathEvidence: parseOutputPathEvidence(input.path_evidence),
      localVolumeEvidence: parseLocalVolumeEvidence(
        input.local_volume_evidence,
        identity.volumeSerialNumberHex,
      ),
    }),
  });
}

function assertUniqueSelectionIdentities(
  selections: readonly RawSelectionResult[],
): void {
  const rootKeys = new Set<string>();
  const inventoryKeys = new Set<string>();
  for (const selection of selections) {
    const rootKey = identityKey(selection.evidence.identity);
    if (rootKeys.has(rootKey) || inventoryKeys.has(rootKey)) {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
    rootKeys.add(rootKey);
    for (const inventoryIdentity of selection.evidence.inventoryFileIdentities) {
      const key = identityKey(inventoryIdentity);
      const ownFileRoot = selection.evidence.kind === "file" && key === rootKey;
      if (inventoryKeys.has(key) || (rootKeys.has(key) && !ownFileRoot)) {
        throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      }
      inventoryKeys.add(key);
    }
  }
}

function assertOutputIdentityDisjoint(
  output: TrustedWindowsExistingOutputDirectoryBoundaryV1,
  selections: readonly RawSelectionResult[],
): void {
  const outputKey = identityKey(output.identity);
  for (const selection of selections) {
    if (identityKey(selection.evidence.identity) === outputKey ||
      selection.evidence.inventoryFileIdentities.some(
        (identity) => identityKey(identity) === outputKey,
      )) {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
  }
}

function evidenceKey(value: unknown): string {
  return JSON.stringify(value);
}

function assertResponseBinding(
  input: Readonly<Record<string, unknown>>,
  request: PrivateHelperRequestBaseV1,
): void {
  if (input.schema_version !== 1 || input.operation !== request.operation ||
    input.session_ref !== request.session_ref ||
    input.basket_session_ref !== request.basket_session_ref ||
    input.request_ref !== request.request_ref) {
    throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
  }
}

function safeUnavailableResponse(
  request: NativeAdapterRequestV0,
  status: "unavailable" | "failed",
): TrustedWindowsNativeSourcePickerResponseV1 | TrustedWindowsNativeOutputBoundaryResponseV1 {
  return Object.freeze({
    schemaVersion: "trusted-windows-native-adapter-response.v0",
    requestRef: request.requestRef,
    operation: request.operation,
    status,
    code: status === "unavailable"
      ? "WINDOWS_NATIVE_BRIDGE_UNAVAILABLE"
      : "WINDOWS_NATIVE_ADAPTER_FAILED",
  });
}

export class StrictTrustedWindowsNativeSourceAdapterV1
implements TrustedWindowsNativeSourceAdapterWithLifecycleV1 {
  readonly #client: PrivateTrustedWindowsNativeSourceHelperClientV1;
  readonly #helperSessionRef: string;
  readonly #seenRequestRefs = new Set<string>();
  readonly #sourceReferences: StoredSourceReference[] = [];
  readonly #seenOpaqueRefs = new Set<string>();
  readonly #retainedIdentityKeys = new Set<string>();
  readonly #activeCalls = new Set<PublicCallRecord>();
  readonly #operationOwnedTerminalErrors = new WeakSet();
  #outputReference: StoredOutputReference | null = null;
  #basketSessionRef: string | null = null;
  #state: AdapterState = "ready";
  #busy = false;
  #teardownConfirmed = false;
  #teardownUnconfirmed = false;
  #closeAttempt: CloseAttempt | null = null;
  #lifecycleEpoch = 0;
  #retainedFileCount = 0;
  #retainedBytes = 0n;

  constructor(client: PrivateTrustedWindowsNativeSourceHelperClientV1) {
    try {
      this.#helperSessionRef = fixedString(client.session_ref, HELPER_SESSION_REF);
      const capabilities = denseArray(client.capabilities, 64);
      const capabilitySet = new Set(capabilities);
      if (capabilities.some((capability) =>
        typeof capability !== "string" || !CAPABILITY.test(capability)
      ) ||
        capabilitySet.size !== capabilities.length ||
        TRUSTED_WINDOWS_NATIVE_SOURCE_ADAPTER_REQUIRED_CAPABILITIES_V1.some(
          (capability) => !capabilitySet.has(capability),
        )) {
        throw adapterError("INVALID_HELPER_CLIENT");
      }
      for (const method of [
        "pick_files", "pick_folder", "drop_sources", "resolve_output", "compare_paths",
        "revalidate_start", "release_revalidated_start",
        "close_and_confirm_no_live_scopes",
      ] as const) {
        if (typeof client[method] !== "function") throw adapterError("INVALID_HELPER_CLIENT");
      }
      this.#client = client;
    } catch {
      throw adapterError("INVALID_HELPER_CLIENT");
    }
  }

  pickFiles(
    request: NativeAdapterRequestV0,
  ): Promise<TrustedWindowsNativeSourcePickerResponseV1> {
    return this.#runPublicCall((call) =>
      this.#pick(call, request, "add_files", "pick_files")
    );
  }

  pickFolder(
    request: NativeAdapterRequestV0,
  ): Promise<TrustedWindowsNativeSourcePickerResponseV1> {
    return this.#runPublicCall((call) =>
      this.#pick(call, request, "add_folder", "pick_folder")
    );
  }

  dropSources(
    request: NativeAdapterRequestV0,
  ): Promise<TrustedWindowsNativeSourcePickerResponseV1> {
    return this.#runPublicCall((call) =>
      this.#pick(call, request, "add_dropped", "drop_sources")
    );
  }

  resolveOutputBoundary(
    request: NativeAdapterRequestV0,
  ): Promise<TrustedWindowsNativeOutputBoundaryResponseV1> {
    return this.#runPublicCall((call) => this.#resolveOutputBoundary(call, request));
  }

  async #resolveOutputBoundary(
    call: PublicCallRecord,
    request: NativeAdapterRequestV0,
  ): Promise<TrustedWindowsNativeOutputBoundaryResponseV1> {
    this.#assertRequestEntry();
    this.#validateAdapterRequest(request, "start");
    const rawRequest: PrivateResolveOutputRequestV1 = Object.freeze({
      schema_version: 1,
      operation: "resolve_output",
      session_ref: this.#helperSessionRef,
      basket_session_ref: request.sessionRef,
      request_ref: request.requestRef,
      read_only: true,
      browser_path_input_accepted: false,
    });
    return await this.#exclusive(async (epoch) => {
      let raw: unknown;
      try {
        raw = await this.#client.resolve_output(rawRequest);
      } catch {
        await this.#assertEpochAfterAwait(epoch);
        this.#assertEpochCurrent(epoch);
        return await this.#poison(call, "PRIVATE_HELPER_OPERATION_FAILED");
      }
      await this.#assertEpochAfterAwait(epoch);
      this.#assertEpochCurrent(epoch);
      try {
        const input = record(raw);
        if (input.status === "resolved") {
          exactKeys(input, [
            "schema_version", "operation", "session_ref", "basket_session_ref",
            "request_ref", "status", "output",
          ]);
          assertResponseBinding(input, rawRequest);
          const output = parseRawOutput(input.output);
          const outputIdentityKey = identityKey(output.boundary.identity);
          if (this.#outputReference !== null ||
            this.#seenOpaqueRefs.has(output.outputRef) ||
            this.#retainedIdentityKeys.has(outputIdentityKey)) {
            throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
          }
          this.#seenOpaqueRefs.add(output.outputRef);
          this.#outputReference = {
            outputRef: output.outputRef,
            evidenceKey: evidenceKey(output.boundary),
            identityKey: outputIdentityKey,
          };
          return Object.freeze({
            schemaVersion: "trusted-windows-native-adapter-response.v0" as const,
            requestRef: request.requestRef,
            operation: "start" as const,
            status: "resolved" as const,
            outputBoundary: output.boundary,
          });
        }
        if (input.status === "cancelled" || input.status === "unavailable" ||
          input.status === "failed") {
          exactKeys(input, [
            "schema_version", "operation", "session_ref", "basket_session_ref",
            "request_ref", "status",
          ]);
          assertResponseBinding(input, rawRequest);
          if (input.status === "cancelled") {
            return Object.freeze({
              schemaVersion: "trusted-windows-native-adapter-response.v0" as const,
              requestRef: request.requestRef,
              operation: "start" as const,
              status: "cancelled" as const,
            });
          }
          return safeUnavailableResponse(request, input.status) as
            TrustedWindowsNativeOutputBoundaryResponseV1;
        }
        throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      } catch {
        return await this.#poison(call, "PRIVATE_HELPER_PROTOCOL_FAILURE");
      }
    });
  }

  compareCanonicalPaths(
    request: NativePathComparisonRequestV0,
  ): Promise<NativePathComparisonResponseV0> {
    return this.#runPublicCall((call) => this.#compareCanonicalPaths(call, request));
  }

  async #compareCanonicalPaths(
    call: PublicCallRecord,
    request: NativePathComparisonRequestV0,
  ): Promise<NativePathComparisonResponseV0> {
    this.#assertRequestEntry();
    this.#validateComparisonRequest(request);
    const rawRequest: PrivateComparePathsRequestV1 = Object.freeze({
      schema_version: 1,
      operation: "compare_paths",
      session_ref: this.#helperSessionRef,
      basket_session_ref: request.sessionRef,
      request_ref: request.requestRef,
      left_canonical_absolute_path: request.leftCanonicalAbsolutePath,
      right_canonical_absolute_path: request.rightCanonicalAbsolutePath,
      read_only: true,
    });
    return await this.#exclusive(async (epoch) => {
      let raw: unknown;
      try {
        raw = await this.#client.compare_paths(rawRequest);
      } catch {
        await this.#assertEpochAfterAwait(epoch);
        this.#assertEpochCurrent(epoch);
        return await this.#poison(call, "PRIVATE_HELPER_OPERATION_FAILED");
      }
      await this.#assertEpochAfterAwait(epoch);
      this.#assertEpochCurrent(epoch);
      try {
        const input = record(raw);
        if (input.status === "compared") {
          exactKeys(input, [
            "schema_version", "operation", "session_ref", "basket_session_ref",
            "request_ref", "status", "comparison_authority", "relation",
          ]);
          assertResponseBinding(input, rawRequest);
          if (input.comparison_authority !== "windows_compare_string_ordinal_ignore_case") {
            throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
          }
          if (input.relation !== "same" && input.relation !== "ancestor" &&
            input.relation !== "descendant" && input.relation !== "disjoint") {
            throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
          }
          const relation = input.relation === "ancestor"
            ? "left_ancestor"
            : input.relation === "descendant"
              ? "left_descendant"
              : input.relation;
          return Object.freeze({
            schemaVersion: "trusted-windows-native-path-comparison.v0",
            requestRef: request.requestRef,
            status: "compared",
            comparisonAuthority: "windows_compare_string_ordinal_ignore_case",
            relation,
          }) satisfies NativePathComparedResponseV0;
        }
        if (input.status === "unavailable" || input.status === "failed") {
          exactKeys(input, [
            "schema_version", "operation", "session_ref", "basket_session_ref",
            "request_ref", "status",
          ]);
          assertResponseBinding(input, rawRequest);
          return Object.freeze({
            schemaVersion: "trusted-windows-native-path-comparison.v0" as const,
            requestRef: request.requestRef,
            status: input.status,
            code: input.status === "unavailable"
              ? "WINDOWS_NATIVE_BRIDGE_UNAVAILABLE"
              : "WINDOWS_NATIVE_ADAPTER_FAILED",
          });
        }
        throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      } catch {
        return await this.#poison(call, "PRIVATE_HELPER_PROTOCOL_FAILURE");
      }
    });
  }

  openRevalidatedStartScope(
    request: TrustedWindowsNativeRevalidatedStartRequestV1,
  ): Promise<TrustedWindowsNativeRevalidatedStartScopeV1> {
    return this.#runPublicCall((call) => this.#openRevalidatedStartScope(call, request));
  }

  async #openRevalidatedStartScope(
    call: PublicCallRecord,
    request: TrustedWindowsNativeRevalidatedStartRequestV1,
  ): Promise<TrustedWindowsNativeRevalidatedStartScopeV1> {
    try {
      this.#assertRequestEntry();
      this.#validateRevalidationRequest(request);
      const sourceRefs = this.#matchSourceReferences(request.expectedSelections);
      const outputReference = this.#outputReference;
      if (outputReference === null ||
        outputReference.evidenceKey !== evidenceKey(request.expectedOutputBoundary)) {
        throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      }
      const rawRequest: PrivateRevalidateStartRequestV1 = Object.freeze({
        schema_version: 1,
        operation: "revalidate_start",
        session_ref: this.#helperSessionRef,
        basket_session_ref: request.sessionRef,
        request_ref: request.requestRef,
        adapter_id: request.adapterId,
        adapter_build_sha256: request.adapterBuildSha256,
        expected_source_refs: Object.freeze(sourceRefs),
        expected_output_ref: outputReference.outputRef,
        read_only: true,
        browser_path_input_accepted: false,
      });
      return await this.#exclusive(async (epoch) => {
        let raw: unknown;
        try {
          raw = await this.#client.revalidate_start(rawRequest);
        } catch {
          await this.#assertEpochAfterAwait(epoch);
          this.#assertEpochCurrent(epoch);
          // The request may have reached the helper even when its response was
          // lost. The outer rejection guard confirms complete session teardown.
          throw adapterError("PRIVATE_HELPER_OPERATION_FAILED");
        }
        await this.#assertEpochAfterAwait(epoch);
        this.#assertEpochCurrent(epoch);
        try {
          const input = record(raw);
          if (input.status === "rejected") {
            exactKeys(input, [
              "schema_version", "operation", "session_ref", "basket_session_ref",
              "request_ref", "status", "no_live_scope",
            ]);
            assertResponseBinding(input, rawRequest);
            if (input.no_live_scope !== true) {
              throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
            }
            throw adapterError("REVALIDATED_SCOPE_REJECTED");
          }
          exactKeys(input, [
            "schema_version", "operation", "session_ref", "basket_session_ref",
            "request_ref", "status", "scope_ref", "evidence",
          ]);
          assertResponseBinding(input, rawRequest);
          if (input.status !== "opened") throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
          const scopeRef = fixedString(input.scope_ref, SCOPE_REF);
          if (this.#seenOpaqueRefs.has(scopeRef)) {
            throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
          }
          const evidence = this.#parseRevalidatedEvidence(
            input.evidence,
            request,
            sourceRefs,
            outputReference.outputRef,
          );
          this.#seenOpaqueRefs.add(scopeRef);
          this.#state = "scope_open";
          let releaseAttempt: Promise<TrustedWindowsNativeRevalidatedStartReleaseV1> | null = null;
          const release = (): Promise<TrustedWindowsNativeRevalidatedStartReleaseV1> =>
            this.#runPublicCall(async (releaseCall) => {
              if (releaseAttempt !== null) {
                try {
                  await releaseAttempt;
                } catch {
                  // The lifecycle arbiter selects the authoritative public error.
                }
                if (this.#teardownUnconfirmed) {
                  throw adapterError("HELPER_TEARDOWN_UNCONFIRMED");
                }
                if (this.#teardownConfirmed) {
                  throw adapterError("ADAPTER_SESSION_CLOSED");
                }
                throw adapterError("REVALIDATED_SCOPE_RELEASE_FAILED");
              }
              if (this.#state !== "scope_open") {
                throw adapterError("REVALIDATED_SCOPE_RELEASE_FAILED");
              }
              releaseAttempt = this.#releaseScope(releaseCall, request, scopeRef);
              return await releaseAttempt;
            });
          return Object.freeze({ evidence, release });
        } catch (error: unknown) {
          if (internalAdapterErrorCode(error) === "REVALIDATED_SCOPE_REJECTED") {
            throw adapterError("REVALIDATED_SCOPE_REJECTED");
          }
          throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
        }
      });
    } catch (error: unknown) {
      const terminalError = this.#safePublicError(
        error,
        "PRIVATE_HELPER_PROTOCOL_FAILURE",
      );
      if (this.#teardownUnconfirmed || this.#teardownConfirmed) throw terminalError;
      await this.#beginClose(call, terminalError);
      throw terminalError;
    }
  }

  /**
   * Trusted lifecycle seam for local-app stop, expiry, and failure handling.
   * It is deliberately not part of the browser-facing basket adapter contract.
   * A failed confirmation can be retried; a confirmed close is idempotent.
   */
  closeAndConfirmNoLiveScopes(): Promise<void> {
    return this.#beginClose(null, null);
  }

  async #pick(
    call: PublicCallRecord,
    request: NativeAdapterRequestV0,
    adapterOperation: "add_files" | "add_folder" | "add_dropped",
    helperOperation: "pick_files" | "pick_folder" | "drop_sources",
  ): Promise<TrustedWindowsNativeSourcePickerResponseV1> {
    this.#assertRequestEntry();
    this.#validateAdapterRequest(request, adapterOperation);
    const rawRequest: PrivateSourceAcquisitionRequestV1 = Object.freeze({
      schema_version: 1,
      operation: helperOperation,
      session_ref: this.#helperSessionRef,
      basket_session_ref: request.sessionRef,
      request_ref: request.requestRef,
      read_only: true,
      browser_path_input_accepted: false,
    });
    return await this.#exclusive(async (epoch) => {
      let raw: unknown;
      try {
        raw = helperOperation === "pick_files"
          ? await this.#client.pick_files(rawRequest)
          : helperOperation === "pick_folder"
            ? await this.#client.pick_folder(rawRequest)
            : await this.#client.drop_sources(rawRequest);
      } catch {
        await this.#assertEpochAfterAwait(epoch);
        this.#assertEpochCurrent(epoch);
        return await this.#poison(call, "PRIVATE_HELPER_OPERATION_FAILED");
      }
      await this.#assertEpochAfterAwait(epoch);
      this.#assertEpochCurrent(epoch);
      try {
        const input = record(raw);
        if (input.status === "selected") {
          exactKeys(input, [
            "schema_version", "operation", "session_ref", "basket_session_ref",
            "request_ref", "status", "selections",
          ]);
          assertResponseBinding(input, rawRequest);
          const expectedAcquisition: TrustedSourceAcquisition =
            helperOperation === "drop_sources"
              ? "windows_native_drop_cfhdrop_then_handle_open"
              : "windows_native_picker_handle";
          const parsed = denseArray(
            input.selections,
            TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots,
          ).map((selection) => parseRawSelection(selection, expectedAcquisition));
          if (parsed.length === 0 ||
            (helperOperation === "pick_folder" && (parsed.length !== 1 ||
              parsed[0]?.evidence.kind !== "directory")) ||
            (helperOperation === "pick_files" &&
              parsed.some((selection) => selection.evidence.kind !== "file"))) {
            throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
          }
          assertUniqueSelectionIdentities(parsed);
          const responseIdentityKeys = new Set<string>();
          for (const selection of parsed) {
            responseIdentityKeys.add(identityKey(selection.evidence.identity));
            for (const identity of selection.evidence.inventoryFileIdentities) {
              responseIdentityKeys.add(identityKey(identity));
            }
          }
          if (Array.from(responseIdentityKeys).some(
            (key) => this.#retainedIdentityKeys.has(key),
          ) || (this.#outputReference !== null &&
            responseIdentityKeys.has(this.#outputReference.identityKey))) {
            throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
          }
          const discoveredFiles = parsed.reduce(
            (total, selection) => total + selection.evidence.fileCount,
            0,
          );
          const totalBytes = parsed.reduce(
            (total, selection) => total + BigInt(selection.evidence.byteCountDecimal),
            0n,
          );
          if (this.#retainedFileCount + discoveredFiles >
              TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxDiscoveredFiles ||
            this.#retainedBytes + totalBytes >
              BigInt(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxTotalBytesDecimal) ||
            this.#sourceReferences.length + parsed.length >
              TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots) {
            throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
          }
          const newRefs = new Set<string>();
          for (const selection of parsed) {
            if (this.#seenOpaqueRefs.has(selection.sourceRef) || newRefs.has(selection.sourceRef)) {
              throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
            }
            newRefs.add(selection.sourceRef);
          }
          for (const selection of parsed) {
            this.#seenOpaqueRefs.add(selection.sourceRef);
            this.#sourceReferences.push({
              sourceRef: selection.sourceRef,
              evidenceKey: evidenceKey(selection.evidence),
            });
          }
          this.#retainedFileCount += discoveredFiles;
          this.#retainedBytes += totalBytes;
          for (const key of responseIdentityKeys) this.#retainedIdentityKeys.add(key);
          return Object.freeze({
            schemaVersion: "trusted-windows-native-adapter-response.v0" as const,
            requestRef: request.requestRef,
            operation: adapterOperation,
            status: "selected" as const,
            selections: Object.freeze(parsed.map((selection) => selection.evidence)),
          });
        }
        if (input.status === "cancelled" || input.status === "unavailable" ||
          input.status === "failed") {
          exactKeys(input, [
            "schema_version", "operation", "session_ref", "basket_session_ref",
            "request_ref", "status",
          ]);
          assertResponseBinding(input, rawRequest);
          if (input.status === "cancelled") {
            return Object.freeze({
              schemaVersion: "trusted-windows-native-adapter-response.v0" as const,
              requestRef: request.requestRef,
              operation: adapterOperation,
              status: "cancelled" as const,
            });
          }
          return safeUnavailableResponse(request, input.status) as
            TrustedWindowsNativeSourcePickerResponseV1;
        }
        throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      } catch {
        return await this.#poison(call, "PRIVATE_HELPER_PROTOCOL_FAILURE");
      }
    });
  }

  #parseRevalidatedEvidence(
    value: unknown,
    request: TrustedWindowsNativeRevalidatedStartRequestV1,
    sourceRefs: readonly string[],
    outputRef: string,
  ): TrustedWindowsNativeRevalidatedStartEvidenceV1 {
    const input = record(value);
    exactKeys(input, [
      "adapter_id", "adapter_build_sha256", "identity_comparison_mechanism",
      "path_comparison_mechanism", "output", "selections", "native_path_comparisons",
    ]);
    if (input.adapter_id !== request.adapterId ||
      input.adapter_build_sha256 !== request.adapterBuildSha256 ||
      input.identity_comparison_mechanism !== "windows_volume_serial_plus_file_id_128" ||
      input.path_comparison_mechanism !== "windows_compare_string_ordinal_ignore_case") {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
    const output = parseRawOutput(input.output);
    if (output.outputRef !== outputRef) throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    const selections = denseArray(
      input.selections,
      TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots,
    ).map((selection) => parseRawSelection(selection));
    if (selections.length !== sourceRefs.length ||
      selections.some((selection, index) => selection.sourceRef !== sourceRefs[index])) {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
    assertUniqueSelectionIdentities(selections);
    assertOutputIdentityDisjoint(output.boundary, selections);
    return Object.freeze({
      schemaVersion: "trusted-windows-native-revalidated-start-evidence.v1",
      requestRef: request.requestRef,
      sessionRef: request.sessionRef,
      operation: "revalidate_start",
      adapterId: request.adapterId,
      adapterBuildSha256: request.adapterBuildSha256,
      identityComparisonMechanism: "windows_volume_serial_plus_file_id_128",
      pathComparisonMechanism: "windows_compare_string_ordinal_ignore_case",
      outputBoundary: output.boundary,
      selections: Object.freeze(selections.map((selection) => selection.evidence)),
      nativePathComparisons: this.#parseNativePathComparisons(
        input.native_path_comparisons,
        selections.length,
      ),
    });
  }

  #parseNativePathComparisons(
    value: unknown,
    selectionCount: number,
  ): TrustedWindowsNativePathComparisonsV1 {
    const input = record(value);
    exactKeys(input, ["source_pairs", "output_pairs"]);
    const maximumPairs = (TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots *
      (TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots - 1)) / 2;
    const sourcePairs = denseArray(input.source_pairs, maximumPairs).map((pair, index) => {
      const item = record(pair);
      exactKeys(item, ["left_selection_index", "right_selection_index", "relation"]);
      if (item.relation !== "disjoint") throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      let expectedIndex = 0;
      let expectedLeft = 0;
      let expectedRight = 0;
      outer: for (let left = 1; left <= selectionCount; left += 1) {
        for (let right = left + 1; right <= selectionCount; right += 1) {
          if (expectedIndex === index) {
            expectedLeft = left;
            expectedRight = right;
            break outer;
          }
          expectedIndex += 1;
        }
      }
      const leftSelectionIndex = positiveSafeIndex(item.left_selection_index, selectionCount);
      const rightSelectionIndex = positiveSafeIndex(item.right_selection_index, selectionCount);
      if (leftSelectionIndex !== expectedLeft || rightSelectionIndex !== expectedRight) {
        throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      }
      return Object.freeze({
        leftSelectionIndex,
        rightSelectionIndex,
        relation: "disjoint" as const,
      });
    });
    const outputPairs = denseArray(
      input.output_pairs,
      TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots,
    ).map((pair, index) => {
      const item = record(pair);
      exactKeys(item, ["selection_index", "relation"]);
      if (item.relation !== "disjoint") throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      const selectionIndex = positiveSafeIndex(item.selection_index, selectionCount);
      if (selectionIndex !== index + 1) throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      return Object.freeze({
        selectionIndex,
        relation: "disjoint" as const,
      });
    });
    if (sourcePairs.length !== (selectionCount * (selectionCount - 1)) / 2 ||
      outputPairs.length !== selectionCount) {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
    return Object.freeze({
      sourcePairs: Object.freeze(sourcePairs),
      outputPairs: Object.freeze(outputPairs),
    });
  }

  async #releaseScope(
    call: PublicCallRecord,
    request: TrustedWindowsNativeRevalidatedStartRequestV1,
    scopeRef: string,
  ): Promise<TrustedWindowsNativeRevalidatedStartReleaseV1> {
    const epoch = this.#lifecycleEpoch;
    const rawRequest: PrivateReleaseScopeRequestV1 = Object.freeze({
      schema_version: 1,
      operation: "release_revalidated_start",
      session_ref: this.#helperSessionRef,
      basket_session_ref: request.sessionRef,
      request_ref: request.requestRef,
      scope_ref: scopeRef,
    });
    let raw: unknown;
    try {
      raw = await this.#client.release_revalidated_start(rawRequest);
    } catch {
      await this.#assertEpochAfterAwait(epoch);
      this.#assertEpochCurrent(epoch);
      return await this.#failRelease(call);
    }
    await this.#assertEpochAfterAwait(epoch);
    this.#assertEpochCurrent(epoch);
    try {
      const input = record(raw);
      exactKeys(input, [
        "schema_version", "operation", "session_ref", "basket_session_ref",
        "request_ref", "scope_ref", "status",
      ]);
      assertResponseBinding(input, rawRequest);
      if (input.scope_ref !== scopeRef || input.status !== "released") {
        throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      }
    } catch {
      return await this.#failRelease(call);
    }
    this.#assertEpochCurrent(epoch);
    this.#disposePrivateMappings();
    this.#state = "spent";
    return Object.freeze({
      schemaVersion: "trusted-windows-native-revalidated-start-release.v1",
      requestRef: request.requestRef,
      sessionRef: request.sessionRef,
      operation: "release_revalidated_start",
      status: "released",
    });
  }

  async #failRelease(call: PublicCallRecord): Promise<never> {
    const terminalError = adapterError("REVALIDATED_SCOPE_RELEASE_FAILED");
    await this.#beginClose(call, terminalError);
    throw terminalError;
  }

  #validateAdapterRequest(
    request: NativeAdapterRequestV0,
    operation: "add_files" | "add_folder" | "add_dropped" | "start",
  ): void {
    const input = record(request);
    exactKeys(input, [
      "schemaVersion", "requestRef", "sessionRef", "operation", "readOnly",
      "browserPathInputAccepted",
    ]);
    if (input.schemaVersion !== "trusted-windows-native-adapter-request.v0" ||
      input.operation !== operation || input.readOnly !== true ||
      input.browserPathInputAccepted !== false) {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
    fixedString(input.requestRef, ADAPTER_REQUEST_REF);
    this.#bindBasketSession(input.sessionRef);
    this.#useRequestRef(input.requestRef);
  }

  #validateComparisonRequest(request: NativePathComparisonRequestV0): void {
    const input = record(request);
    exactKeys(input, [
      "schemaVersion", "requestRef", "sessionRef", "operation",
      "leftCanonicalAbsolutePath", "rightCanonicalAbsolutePath", "readOnly",
    ]);
    if (input.schemaVersion !== "trusted-windows-native-path-comparison-request.v0" ||
      input.operation !== "compare_paths" || input.readOnly !== true) {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
    fixedString(input.requestRef, COMPARISON_REQUEST_REF);
    canonicalPrivateDosPath(input.leftCanonicalAbsolutePath);
    canonicalPrivateDosPath(input.rightCanonicalAbsolutePath);
    this.#bindBasketSession(input.sessionRef);
    this.#useRequestRef(input.requestRef);
  }

  #validateRevalidationRequest(request: TrustedWindowsNativeRevalidatedStartRequestV1): void {
    const input = record(request);
    exactKeys(input, [
      "schemaVersion", "requestRef", "sessionRef", "operation", "adapterId",
      "adapterBuildSha256", "readOnly", "browserPathInputAccepted",
      "expectedOutputBoundary", "expectedSelections",
    ]);
    if (input.schemaVersion !== "trusted-windows-native-revalidated-start-request.v1" ||
      input.operation !== "revalidate_start" || input.readOnly !== true ||
      input.browserPathInputAccepted !== false) {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
    fixedString(input.requestRef, REVALIDATED_START_REQUEST_REF);
    fixedString(input.adapterId, ADAPTER_ID);
    fixedString(input.adapterBuildSha256, SHA256);
    this.#bindBasketSession(input.sessionRef);
    this.#useRequestRef(input.requestRef);
    denseArray(input.expectedSelections, TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxSelectedRoots);
  }

  #bindBasketSession(value: unknown): void {
    const sessionRef = fixedString(value, BASKET_SESSION_REF);
    if (this.#basketSessionRef === null) this.#basketSessionRef = sessionRef;
    if (this.#basketSessionRef !== sessionRef) throw adapterError("ADAPTER_SESSION_MISMATCH");
  }

  #useRequestRef(value: unknown): void {
    if (typeof value !== "string" || this.#seenRequestRefs.has(value)) {
      throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
    }
    this.#seenRequestRefs.add(value);
  }

  #matchSourceReferences(
    selections: readonly TrustedWindowsNativeFreshSourceSelectionEvidenceV1[],
  ): string[] {
    const used = new Set<number>();
    return selections.map((selection) => {
      const key = evidenceKey(selection);
      // Without the still-missing provisional-reference release/sync operation,
      // a remove-then-readd can leave historical matches. The newest exact
      // match is safer than resurrecting the oldest retained handle.
      let index = -1;
      for (let candidate = this.#sourceReferences.length - 1; candidate >= 0; candidate -= 1) {
        const stored = this.#sourceReferences[candidate];
        if (stored !== undefined && !used.has(candidate) && stored.evidenceKey === key) {
          index = candidate;
          break;
        }
      }
      if (index < 0) throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      used.add(index);
      const stored = this.#sourceReferences[index];
      if (stored === undefined) throw adapterError("PRIVATE_HELPER_PROTOCOL_FAILURE");
      return stored.sourceRef;
    });
  }

  /**
   * Own the exact promise returned to the controller. Built-in resolve/reject
   * settles synchronously within one JavaScript turn, so either this arbiter
   * settles first or the synchronous close latch wins. Do not wrap the returned
   * promise in another async function: that would recreate a handoff gap.
   */
  #runPublicCall<T>(
    body: (call: PublicCallRecord) => Promise<T> | T,
  ): Promise<T> {
    let resolvePublic: (value: T | PromiseLike<T>) => void = () => undefined;
    let rejectPublic: (reason?: unknown) => void = () => undefined;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePublic = resolve;
      rejectPublic = reject;
    });
    const call: PublicCallRecord = {
      generation: this.#lifecycleEpoch,
      settled: false,
      resolve: (value) => {
        resolvePublic(value as T);
      },
      reject: (error) => {
        rejectPublic(error);
      },
    };
    this.#activeCalls.add(call);

    if (this.#teardownConfirmed) {
      this.#settlePublicError(call, adapterError("ADAPTER_SESSION_CLOSED"));
      return promise;
    }
    if (this.#teardownUnconfirmed) {
      this.#settlePublicError(call, adapterError("HELPER_TEARDOWN_UNCONFIRMED"));
      return promise;
    }
    if (this.#closeAttempt !== null) return promise;

    let result: Promise<T> | T;
    try {
      result = body(call);
    } catch (error: unknown) {
      this.#completePublicFailure(call, error);
      return promise;
    }
    void Promise.resolve(result).then(
      (value) => {
        this.#completePublicSuccess(call, value);
      },
      (error: unknown) => {
        this.#completePublicFailure(call, error);
      },
    );
    return promise;
  }

  #completePublicSuccess(call: PublicCallRecord, value: unknown): void {
    if (call.settled) return;
    if (this.#teardownUnconfirmed) {
      this.#settlePublicError(call, adapterError("HELPER_TEARDOWN_UNCONFIRMED"));
      return;
    }
    if (this.#teardownConfirmed) {
      this.#settlePublicError(call, adapterError("ADAPTER_SESSION_CLOSED"));
      return;
    }
    if (this.#closeAttempt !== null || call.generation !== this.#lifecycleEpoch) return;
    call.settled = true;
    this.#activeCalls.delete(call);
    call.resolve(value);
  }

  #completePublicFailure(call: PublicCallRecord, error: unknown): void {
    if (call.settled) return;
    if (this.#teardownUnconfirmed) {
      this.#settlePublicError(call, adapterError("HELPER_TEARDOWN_UNCONFIRMED"));
      return;
    }
    if (this.#teardownConfirmed) {
      this.#settlePublicError(call, adapterError("ADAPTER_SESSION_CLOSED"));
      return;
    }
    if (this.#closeAttempt !== null || call.generation !== this.#lifecycleEpoch) return;
    this.#settlePublicError(
      call,
      this.#safePublicError(error, "PRIVATE_HELPER_PROTOCOL_FAILURE"),
    );
  }

  #settlePublicError(
    call: PublicCallRecord,
    error: TrustedWindowsNativeSourceAdapterImplementationErrorV1,
  ): void {
    if (call.settled) return;
    call.settled = true;
    this.#activeCalls.delete(call);
    call.reject(error);
  }

  #safePublicError(
    error: unknown,
    fallback: TrustedWindowsNativeSourceAdapterImplementationErrorCodeV1,
  ): TrustedWindowsNativeSourceAdapterImplementationErrorV1 {
    return adapterError(internalAdapterErrorCode(error) ?? fallback);
  }

  #beginClose(
    owner: PublicCallRecord | null,
    ownerError: TrustedWindowsNativeSourceAdapterImplementationErrorV1 | null,
  ): Promise<void> {
    if (this.#teardownConfirmed) return Promise.resolve();
    if (this.#closeAttempt !== null) return this.#closeAttempt.promise;

    this.#lifecycleEpoch += 1;
    this.#state = "poisoned";

    let resolveClose: () => void = () => undefined;
    let rejectClose: (
      error: TrustedWindowsNativeSourceAdapterImplementationErrorV1,
    ) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    const attempt: CloseAttempt = {
      promise,
      resolve: resolveClose,
      reject: rejectClose,
      owner,
      ownerError,
    };

    // Store the exact attempt before invoking the client. A synchronous
    // re-entrant close therefore shares this promise instead of starting twice.
    this.#closeAttempt = attempt;
    let closeResult: Promise<void>;
    try {
      closeResult = this.#client.close_and_confirm_no_live_scopes();
    } catch {
      this.#finishClose(attempt, false);
      return promise;
    }
    void Promise.resolve(closeResult).then(
      () => {
        this.#finishClose(attempt, true);
      },
      () => {
        this.#finishClose(attempt, false);
      },
    );
    return promise;
  }

  #finishClose(attempt: CloseAttempt, confirmed: boolean): void {
    if (this.#closeAttempt !== attempt) return;

    let closeError: TrustedWindowsNativeSourceAdapterImplementationErrorV1 | null = null;
    if (confirmed) {
      this.#teardownConfirmed = true;
      this.#teardownUnconfirmed = false;
      this.#disposePrivateMappings();
      this.#state = "spent";
    } else {
      this.#teardownUnconfirmed = true;
      this.#state = "poisoned";
      closeError = adapterError("HELPER_TEARDOWN_UNCONFIRMED");
    }

    for (const call of Array.from(this.#activeCalls)) {
      if (confirmed && call === attempt.owner && attempt.ownerError !== null) {
        this.#settlePublicError(call, attempt.ownerError);
      } else {
        this.#settlePublicError(
          call,
          closeError ?? adapterError("ADAPTER_SESSION_CLOSED"),
        );
      }
    }

    this.#closeAttempt = null;
    if (confirmed) attempt.resolve();
    else attempt.reject(closeError ?? adapterError("HELPER_TEARDOWN_UNCONFIRMED"));
  }

  #assertEpochCurrent(expectedEpoch: number): void {
    if (this.#teardownUnconfirmed) {
      throw adapterError("HELPER_TEARDOWN_UNCONFIRMED");
    }
    if (this.#lifecycleEpoch === expectedEpoch) return;
    throw adapterError("ADAPTER_SESSION_CLOSED");
  }

  #assertRequestEntry(): void {
    if (this.#teardownUnconfirmed) {
      throw adapterError("HELPER_TEARDOWN_UNCONFIRMED");
    }
    if (this.#state === "poisoned" || this.#state === "spent") {
      throw adapterError("ADAPTER_SESSION_CLOSED");
    }
  }

  async #assertEpochAfterAwait(expectedEpoch: number): Promise<void> {
    if (this.#teardownUnconfirmed) {
      throw adapterError("HELPER_TEARDOWN_UNCONFIRMED");
    }
    if (this.#lifecycleEpoch === expectedEpoch) return;
    const close = this.#closeAttempt?.promise ?? null;
    if (close !== null) {
      try {
        await close;
      } catch {
        // The exact safe result is selected by the latched state below.
      }
    }
    this.#assertEpochCurrent(expectedEpoch);
  }

  #disposePrivateMappings(): void {
    // JavaScript strings are immutable, so this drops references but cannot
    // honestly claim byte-zeroization of path/evidence strings.
    this.#sourceReferences.splice(0, this.#sourceReferences.length);
    this.#seenOpaqueRefs.clear();
    this.#retainedIdentityKeys.clear();
    this.#seenRequestRefs.clear();
    this.#outputReference = null;
    this.#basketSessionRef = null;
    this.#retainedFileCount = 0;
    this.#retainedBytes = 0n;
  }

  async #exclusive<T>(operation: (epoch: number) => Promise<T>): Promise<T> {
    this.#assertRequestEntry();
    if (this.#state === "scope_open") throw adapterError("ADAPTER_OPERATION_BUSY");
    if (this.#busy) throw adapterError("ADAPTER_OPERATION_BUSY");
    const epoch = this.#lifecycleEpoch;
    this.#busy = true;
    try {
      let result: T;
      try {
        result = await operation(epoch);
      } catch (error: unknown) {
        if (typeof error === "object" && error !== null &&
          this.#operationOwnedTerminalErrors.has(error)) {
          const code = internalAdapterErrorCode(error);
          if (code !== null) throw adapterError(code);
        }
        await this.#assertEpochAfterAwait(epoch);
        this.#assertEpochCurrent(epoch);
        throw error;
      }
      await this.#assertEpochAfterAwait(epoch);
      this.#assertEpochCurrent(epoch);
      return result;
    } finally {
      this.#busy = false;
    }
  }

  async #poison(
    call: PublicCallRecord,
    code: "PRIVATE_HELPER_PROTOCOL_FAILURE" | "PRIVATE_HELPER_OPERATION_FAILED",
  ): Promise<never> {
    const terminalError = adapterError(code);
    this.#operationOwnedTerminalErrors.add(terminalError);
    await this.#beginClose(call, terminalError);
    throw terminalError;
  }
}

class FailClosedProcessBackedWindowsNativeSourceAdapterV1
  extends FailClosedWindowsNativeSourceAdapterV1
  implements TrustedWindowsNativeSourceAdapterLifecycleV1 {
  closeAndConfirmNoLiveScopes(): Promise<void> {
    // This factory never starts a helper process, so there is nothing live to close.
    return Promise.resolve();
  }
}

/**
 * Honest current composition point. Capability advertisement alone does not
 * prove a safely configured process composition: binary custody transfer,
 * true out-of-band cancellation, launch authenticity, and asynchronous
 * launcher/configuration ownership remain unresolved. Operations therefore
 * stay explicitly unavailable instead of being simulated with Node path access.
 */
export function createProcessBackedTrustedWindowsNativeSourceAdapterV1():
TrustedWindowsNativeSourceAdapterWithLifecycleV1 {
  return new FailClosedProcessBackedWindowsNativeSourceAdapterV1();
}

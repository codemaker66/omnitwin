import {
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  buildTrustedWindowsSourceSetManifestV1,
  deriveTrustedWindowsCrossSelectionIdentityEvidenceV1,
  deriveTrustedWindowsPathComparisonTranscriptSha256V1,
  deriveTrustedWindowsSelectionIdentityEvidenceV1,
  isStructurallyValidWindowsSourceSetManifestV1,
  stableCanonicalJson,
  toCanonicalJson,
  TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1,
  type TrustedWindowsExistingOutputDirectoryBoundaryV1,
  type TrustedWindowsLocalVolumeEvidenceV1,
  type TrustedWindowsNativePathComparisonsV1,
  type TrustedWindowsNativeSourceSetInputV1,
  type TrustedWindowsNativeSourceSetManifestV1,
  type TrustedWindowsSourceSelectionV1,
} from "@omnitwin/reconstruction-foundry";
import {
  FAIL_CLOSED_WINDOWS_NATIVE_ADAPTER_BLOCKERS_V0,
  FailClosedWindowsNativeSourceAdapterV0,
  TrustedWindowsNativeSourceBasketControllerV0,
  TrustedWindowsNativeSourceBasketError,
  type NativeAdapterRequestV0,
  type NativeOutputBoundaryResponseV0,
  type NativePathComparedResponseV0,
  type NativePathComparisonRequestV0,
  type NativePathComparisonResponseV0,
  type NativeSourcePickerResponseV0,
  type TrustedWindowsExistingOutputDirectoryBoundaryV0,
  type TrustedWindowsNativeSourceAdapterV0,
  type TrustedWindowsNativeSourceSetInputV0,
  type TrustedWindowsSourceBasketActionV0,
  type TrustedWindowsSourceBasketResultStatusV0,
  type TrustedWindowsSourceBasketStatusV0,
  type TrustedWindowsSourceSelectionEvidenceV0,
  type TrustedWindowsSourceSelectionV0,
} from "./trusted-windows-native-source-basket.js";

const BASKET_VIEW_SCHEMA_VERSION = "trusted-windows-native-source-basket-view.v1";
const BASKET_EVENT_SCHEMA_VERSION = "trusted-windows-native-source-basket-event.v1";
const START_RECEIPT_SCHEMA_VERSION = "trusted-windows-native-start-receipt.v1";
const REVALIDATED_START_REQUEST_SCHEMA_VERSION =
  "trusted-windows-native-revalidated-start-request.v1";
const REVALIDATED_START_EVIDENCE_SCHEMA_VERSION =
  "trusted-windows-native-revalidated-start-evidence.v1";
const REVALIDATED_START_RELEASE_SCHEMA_VERSION =
  "trusted-windows-native-revalidated-start-release.v1";
const RECEIPT_REF_DOMAIN = "OMNITWIN.TRUSTED_WINDOWS_NATIVE_START_RECEIPT_REF.V1";
const RECEIPT_AUTHENTICATION_DOMAIN =
  "OMNITWIN.TRUSTED_WINDOWS_NATIVE_START_RECEIPT_AUTHENTICATION.V1";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const ADAPTER_ID = /^[a-z0-9][a-z0-9._-]{2,95}$/u;
const SESSION_REF = /^basket_(?!0{32}$)[a-f0-9]{32}$/u;
const RECEIPT_REF = /^start_receipt_[a-f0-9]{64}$/u;
const BYTE_COUNT = /^(?:0|[1-9][0-9]*)$/u;
const VOLUME_SERIAL = /^[A-F0-9]{16}$/u;

export const FAIL_CLOSED_WINDOWS_NATIVE_ADAPTER_BLOCKERS_V1 = Object.freeze([
  ...FAIL_CLOSED_WINDOWS_NATIVE_ADAPTER_BLOCKERS_V0.slice(0, 3),
  "Node.js does not provide the existing output-directory handle, final-path identity, and complete root-through-directory reparse evidence required by V1.",
  "Node.js does not provide a native handle scope that freshly revalidates and retains every source and output handle through native sink settlement.",
] as const);

export const TRUSTED_WINDOWS_NATIVE_START_RECEIPT_LIMITATIONS_V1 = Object.freeze([
  "The receipt authenticates only the exact freshly revalidated source-set handoff accepted by this controller session.",
  "The native sink must consume the exact receipt once before its handoff returns.",
  "The controller keeps the adapter's revalidated scope open until the native sink settles, then requires an exact release acknowledgement.",
  "The exact native helper remains responsible for keeping all source and output handles open for that scope; this TypeScript contract cannot inspect a Windows handle.",
  "The receipt does not attest that source bytes stayed unchanged after the retained handle scope is released.",
  "The receipt grants no execution, publication, upload, or release authority.",
] as const);

export type TrustedWindowsSourceBasketActionV1 = TrustedWindowsSourceBasketActionV0;
export type TrustedWindowsSourceBasketStatusV1 = TrustedWindowsSourceBasketStatusV0;
export type TrustedWindowsSourceBasketResultStatusV1 = TrustedWindowsSourceBasketResultStatusV0;

export interface TrustedWindowsSourceBasketEventBindingV1 {
  readonly schemaVersion: typeof BASKET_EVENT_SCHEMA_VERSION;
  readonly sessionRef: string;
  readonly revision: number;
  readonly eventToken: string;
}

export type TrustedWindowsSourceBasketEventV1 =
  | (TrustedWindowsSourceBasketEventBindingV1 & {
    readonly action: Exclude<TrustedWindowsSourceBasketActionV1, "remove">;
  })
  | (TrustedWindowsSourceBasketEventBindingV1 & {
    readonly action: "remove";
    readonly basketPosition: number;
  });

export interface TrustedWindowsSourceBasketSummaryV1 {
  readonly basketPosition: number;
  readonly kind: "file" | "directory";
  readonly label: string;
  readonly labelSafety: "generated_kind_and_position_only";
  readonly fileCount: number;
  readonly byteCountDecimal: string;
}

export interface TrustedWindowsSourceBasketViewV1 {
  readonly schemaVersion: typeof BASKET_VIEW_SCHEMA_VERSION;
  readonly sessionRef: string;
  readonly revision: number;
  readonly status: TrustedWindowsSourceBasketStatusV1;
  readonly busy: boolean;
  readonly sources: readonly TrustedWindowsSourceBasketSummaryV1[];
  readonly totals: {
    readonly selectedRoots: number;
    readonly discoveredFiles: number;
    readonly totalBytesDecimal: string;
  };
  readonly nextEvent: TrustedWindowsSourceBasketEventBindingV1 | null;
}

export interface TrustedWindowsSourceBasketResultV1 {
  readonly status: TrustedWindowsSourceBasketResultStatusV1;
  readonly code: string;
  readonly message: string;
  readonly view: TrustedWindowsSourceBasketViewV1;
}

export interface TrustedWindowsNativeStartReceiptBodyV1 {
  readonly schemaVersion: typeof START_RECEIPT_SCHEMA_VERSION;
  readonly receiptRef: string;
  readonly sessionRef: string;
  readonly expectedManifestDigestSha256: string;
  readonly adapterBuildSha256: string;
  readonly selectedRoots: number;
  readonly discoveredFiles: number;
  readonly totalBytesDecimal: string;
  readonly issuedRevision: number;
  readonly authentication: "controller_authenticated";
  readonly authority: "none";
  readonly use: "inspection_only";
}

/** Native-only. This record must never be copied into a browser-facing result. */
export interface TrustedWindowsNativeStartReceiptV1
  extends TrustedWindowsNativeStartReceiptBodyV1 {
  readonly authenticationHmacSha256: string;
}

/** Native-only, live for exactly one start-sink callback. */
export interface TrustedWindowsNativeStartReceiptGuardV1 {
  consume(receipt: unknown): boolean;
}

/** Native-only request binding the exact provisional basket to one fresh handle scope. */
export interface TrustedWindowsNativeRevalidatedStartRequestV1 {
  readonly schemaVersion: typeof REVALIDATED_START_REQUEST_SCHEMA_VERSION;
  readonly requestRef: string;
  readonly sessionRef: string;
  readonly operation: "revalidate_start";
  readonly adapterId: string;
  readonly adapterBuildSha256: string;
  readonly readOnly: true;
  readonly browserPathInputAccepted: false;
  readonly expectedOutputBoundary: TrustedWindowsExistingOutputDirectoryBoundaryV1;
  readonly expectedSelections: readonly TrustedWindowsNativeFreshSourceSelectionEvidenceV1[];
}

export interface TrustedWindowsNativeFreshSourceSelectionEvidenceV1
  extends TrustedWindowsSourceSelectionEvidenceV0 {
  readonly localVolumeEvidence: TrustedWindowsLocalVolumeEvidenceV1;
}

export type TrustedWindowsNativeSourcePickerResponseV1 =
  | (Omit<Extract<NativeSourcePickerResponseV0, { readonly status: "selected" }>, "selections"> & {
    readonly selections: readonly TrustedWindowsNativeFreshSourceSelectionEvidenceV1[];
  })
  | Exclude<NativeSourcePickerResponseV0, { readonly status: "selected" }>;

export type TrustedWindowsNativeOutputBoundaryResponseV1 =
  | (Omit<Extract<NativeOutputBoundaryResponseV0, { readonly status: "resolved" }>, "outputBoundary"> & {
    readonly outputBoundary: TrustedWindowsExistingOutputDirectoryBoundaryV1;
  })
  | Exclude<NativeOutputBoundaryResponseV0, { readonly status: "resolved" }>;

/**
 * Complete fresh evidence yielded while the adapter still owns every opened
 * source and output handle. A boolean or partial acknowledgement is never evidence.
 */
export interface TrustedWindowsNativeRevalidatedStartEvidenceV1 {
  readonly schemaVersion: typeof REVALIDATED_START_EVIDENCE_SCHEMA_VERSION;
  readonly requestRef: string;
  readonly sessionRef: string;
  readonly operation: "revalidate_start";
  readonly adapterId: string;
  readonly adapterBuildSha256: string;
  readonly identityComparisonMechanism: "windows_volume_serial_plus_file_id_128";
  readonly pathComparisonMechanism: "windows_compare_string_ordinal_ignore_case";
  readonly outputBoundary: TrustedWindowsExistingOutputDirectoryBoundaryV1;
  readonly selections: readonly TrustedWindowsNativeFreshSourceSelectionEvidenceV1[];
  readonly nativePathComparisons: TrustedWindowsNativePathComparisonsV1;
}

export interface TrustedWindowsNativeRevalidatedStartReleaseV1 {
  readonly schemaVersion: typeof REVALIDATED_START_RELEASE_SCHEMA_VERSION;
  readonly requestRef: string;
  readonly sessionRef: string;
  readonly operation: "release_revalidated_start";
  readonly status: "released";
}

/**
 * Controller-owned custody scope. There is no adapter callback: the controller
 * validates evidence, settles the sink, and only then invokes `release` once.
 */
export interface TrustedWindowsNativeRevalidatedStartScopeV1 {
  readonly evidence: TrustedWindowsNativeRevalidatedStartEvidenceV1;
  /** Must be an own data property so the controller can retain it before parsing the envelope. */
  readonly release: () => Promise<TrustedWindowsNativeRevalidatedStartReleaseV1>;
}

export interface TrustedWindowsNativeSourceAdapterV1 extends TrustedWindowsNativeSourceAdapterV0 {
  pickFiles(request: NativeAdapterRequestV0): Promise<TrustedWindowsNativeSourcePickerResponseV1>;
  pickFolder(request: NativeAdapterRequestV0): Promise<TrustedWindowsNativeSourcePickerResponseV1>;
  dropSources(request: NativeAdapterRequestV0): Promise<TrustedWindowsNativeSourcePickerResponseV1>;
  resolveOutputBoundary(
    request: NativeAdapterRequestV0,
  ): Promise<TrustedWindowsNativeOutputBoundaryResponseV1>;
  /**
   * An ordinary synchronous failure or rejection means the adapter helper
   * retains every provisional handle and has already confirmed cleanup. The
   * sole exceptional rejection is an own data-property error code of
   * `HELPER_TEARDOWN_UNCONFIRMED`: no scope transfers to the controller, but the
   * trusted lifecycle owner must retry or force exact-helper shutdown because
   * cleanup could not be confirmed.
   * Every resolved response must expose an own data-property `release` function.
   */
  openRevalidatedStartScope(
    request: TrustedWindowsNativeRevalidatedStartRequestV1,
  ): Promise<TrustedWindowsNativeRevalidatedStartScopeV1>;
}

export type TrustedWindowsNativeSourceBasketV1ErrorCode =
  | "INVALID_ADAPTER_ID"
  | "INVALID_TRUSTED_ADAPTER_BUILD_SHA256"
  | "INVALID_RECEIPT_AUTHENTICATION_KEY"
  | "HELPER_TEARDOWN_UNCONFIRMED"
  | "PRIVATE_EVIDENCE_MISMATCH";

const V1_ERROR_MESSAGES: Readonly<Record<TrustedWindowsNativeSourceBasketV1ErrorCode, string>> =
  Object.freeze({
    INVALID_ADAPTER_ID: "The trusted Windows adapter identifier is invalid.",
    INVALID_TRUSTED_ADAPTER_BUILD_SHA256: "The trusted Windows adapter build digest is invalid.",
    INVALID_RECEIPT_AUTHENTICATION_KEY: "The native receipt authentication key is invalid.",
    HELPER_TEARDOWN_UNCONFIRMED:
      "The trusted Windows helper process could not be confirmed stopped.",
    PRIVATE_EVIDENCE_MISMATCH: "The private native evidence does not match the accepted source basket.",
  });

export class TrustedWindowsNativeSourceBasketV1Error extends Error {
  readonly code: TrustedWindowsNativeSourceBasketV1ErrorCode;

  constructor(code: TrustedWindowsNativeSourceBasketV1ErrorCode) {
    super(V1_ERROR_MESSAGES[code]);
    this.name = "TrustedWindowsNativeSourceBasketV1Error";
    this.code = code;
  }
}

export interface TrustedWindowsNativeSourceBasketControllerOptionsV1 {
  readonly adapter: TrustedWindowsNativeSourceAdapterV1;
  /** Trusted launcher configuration, not adapter-supplied response data. */
  readonly adapterId: string;
  /** Trusted launcher-pinned digest of the exact adapter build. */
  readonly trustedAdapterBuildSha256: string;
  readonly randomBytes?: (size: number) => Uint8Array;
  /** Optional native-only key. The controller copies it and zeroes its private copy. */
  readonly receiptAuthenticationKey?: Uint8Array;
  readonly assertSourceSetInput?: (
    input: TrustedWindowsNativeSourceSetInputV1,
    manifest: TrustedWindowsNativeSourceSetManifestV1,
  ) => void;
  /** Native-only sink. None of these values can enter the returned browser DTO. */
  readonly acceptTrustedStartInput: (
    input: TrustedWindowsNativeSourceSetInputV1,
    manifest: TrustedWindowsNativeSourceSetManifestV1,
    receipt: TrustedWindowsNativeStartReceiptV1,
    receiptGuard: TrustedWindowsNativeStartReceiptGuardV1,
  ) => Promise<void> | void;
}

interface ParsedEventV1 {
  readonly sessionRef: string;
  readonly revision: number;
  readonly eventToken: string;
  readonly action: TrustedWindowsSourceBasketActionV1;
  readonly basketPosition?: number;
}

interface PlainCloneSuccess {
  readonly ok: true;
  readonly value: unknown;
}

interface PlainCloneFailure {
  readonly ok: false;
}

type PlainCloneResult = PlainCloneSuccess | PlainCloneFailure;

interface RecordedPickerCall {
  readonly request: NativeAdapterRequestV0;
  readonly response: TrustedWindowsNativeSourcePickerResponseV1 | null;
}

interface RecordedOutputCall {
  readonly request: NativeAdapterRequestV0;
  readonly response: TrustedWindowsNativeOutputBoundaryResponseV1 | null;
}

interface RecordedComparisonCall {
  readonly request: NativePathComparisonRequestV0;
  readonly response: NativePathComparisonResponseV0 | null;
}

interface EventRecording {
  readonly pickerCalls: RecordedPickerCall[];
  readonly outputCalls: RecordedOutputCall[];
  readonly comparisonCalls: RecordedComparisonCall[];
  evidenceMismatch: boolean;
  helperTeardownUnconfirmed: boolean;
}

interface PrivateSelectionV1 {
  readonly sourceRef: string;
  readonly evidence: TrustedWindowsNativeFreshSourceSelectionEvidenceV1;
}

interface PreparedHandoffV1 {
  readonly v0InputCanonical: string;
  readonly expectedOutputBoundary: TrustedWindowsExistingOutputDirectoryBoundaryV1;
  readonly expectedSelections: readonly TrustedWindowsNativeFreshSourceSelectionEvidenceV1[];
}

interface ActiveReceiptV1 {
  readonly bodyCanonical: string;
  readonly receipt: TrustedWindowsNativeStartReceiptV1;
  consumed: boolean;
}

function failV1(code: TrustedWindowsNativeSourceBasketV1ErrorCode): never {
  throw new TrustedWindowsNativeSourceBasketV1Error(code);
}

function hasOwnHelperTeardownUnconfirmedCode(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "code");
    return descriptor !== undefined && "value" in descriptor &&
      descriptor.value === "HELPER_TEARDOWN_UNCONFIRMED";
  } catch {
    return false;
  }
}

function failEvent(code: "FORGED_EVENT" | "STALE_EVENT" | "CONTROLLER_TERMINAL"): never {
  throw new TrustedWindowsNativeSourceBasketError(code);
}

function inspectPlainRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      return null;
    }
    output[key] = descriptor.value;
  }
  return output;
}

function hasExactKeys(record: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  const expectedSet = new Set(expected);
  return keys.length === expected.length &&
    keys.every((key) => expectedSet.has(key)) &&
    expected.every((key) => Object.hasOwn(record, key));
}

function parsePrivateIdentityVolumeSerial(value: unknown): string {
  const identity = inspectPlainRecord(value);
  if (
    identity === null ||
    !hasExactKeys(identity, ["volumeSerialNumberHex", "fileIdHex"]) ||
    typeof identity.volumeSerialNumberHex !== "string" ||
    !VOLUME_SERIAL.test(identity.volumeSerialNumberHex) ||
    typeof identity.fileIdHex !== "string" ||
    !/^[A-F0-9]{32}$/u.test(identity.fileIdHex)
  ) return failV1("PRIVATE_EVIDENCE_MISMATCH");
  return identity.volumeSerialNumberHex;
}

function parsePrivateLocalVolumeEvidence(
  value: unknown,
  identityValue: unknown,
): TrustedWindowsLocalVolumeEvidenceV1 {
  const identityVolumeSerial = parsePrivateIdentityVolumeSerial(identityValue);
  const record = inspectPlainRecord(value);
  if (record === null || !hasExactKeys(record, [
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
  ])) return failV1("PRIVATE_EVIDENCE_MISMATCH");
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
    record.openedHandleVolumeSerialNumberHex !== identityVolumeSerial ||
    record.volumeRootHandleSerialNumberHex !== identityVolumeSerial
  ) return failV1("PRIVATE_EVIDENCE_MISMATCH");
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
    openedHandleVolumeSerialNumberHex: identityVolumeSerial,
    volumeRootHandleSerialNumberHex: identityVolumeSerial,
  });
}

function parsePrivatePickerSelection(
  value: unknown,
): TrustedWindowsNativeFreshSourceSelectionEvidenceV1 {
  const record = inspectPlainRecord(value);
  if (record === null || !hasExactKeys(record, [
    "kind", "canonicalAbsolutePath", "resolvedAbsolutePath", "byteCountDecimal",
    "fileCount", "identity", "inventoryFileIdentities", "pathEvidence", "localVolumeEvidence",
  ])) return failV1("PRIVATE_EVIDENCE_MISMATCH");
  parsePrivateLocalVolumeEvidence(record.localVolumeEvidence, record.identity);
  return value as TrustedWindowsNativeFreshSourceSelectionEvidenceV1;
}

function parsePrivateOutputBoundary(
  value: unknown,
): TrustedWindowsExistingOutputDirectoryBoundaryV1 {
  const record = inspectPlainRecord(value);
  if (record === null || !hasExactKeys(record, [
    "kind", "canonicalAbsolutePath", "resolvedAbsolutePath", "identity", "pathEvidence",
    "localVolumeEvidence",
  ]) || record.kind !== "directory") return failV1("PRIVATE_EVIDENCE_MISMATCH");
  parsePrivateLocalVolumeEvidence(record.localVolumeEvidence, record.identity);
  return value as TrustedWindowsExistingOutputDirectoryBoundaryV1;
}

function parseEvent(value: unknown): ParsedEventV1 {
  const record = inspectPlainRecord(value);
  if (record === null) return failEvent("FORGED_EVENT");
  const action = record.action;
  const actions: readonly TrustedWindowsSourceBasketActionV1[] = [
    "add_files", "add_folder", "add_dropped", "remove", "clear", "cancel", "start",
  ];
  if (typeof action !== "string" || !actions.includes(action as TrustedWindowsSourceBasketActionV1)) {
    return failEvent("FORGED_EVENT");
  }
  const expected = action === "remove"
    ? ["schemaVersion", "sessionRef", "revision", "eventToken", "action", "basketPosition"]
    : ["schemaVersion", "sessionRef", "revision", "eventToken", "action"];
  if (
    !hasExactKeys(record, expected) ||
    record.schemaVersion !== BASKET_EVENT_SCHEMA_VERSION ||
    typeof record.sessionRef !== "string" ||
    typeof record.eventToken !== "string" ||
    typeof record.revision !== "number" ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0 ||
    Object.is(record.revision, -0) ||
    (action === "remove" && (
      typeof record.basketPosition !== "number" ||
      !Number.isSafeInteger(record.basketPosition) ||
      record.basketPosition < 1 ||
      Object.is(record.basketPosition, -0)
    ))
  ) {
    return failEvent("FORGED_EVENT");
  }
  return {
    sessionRef: record.sessionRef,
    revision: record.revision,
    eventToken: record.eventToken,
    action: action as TrustedWindowsSourceBasketActionV1,
    ...(action === "remove" ? { basketPosition: record.basketPosition as number } : {}),
  };
}

function clonePlainData(value: unknown, depth = 0, active = new WeakSet()): PlainCloneResult {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return { ok: true, value };
  }
  if (typeof value !== "object" || depth > 16 || active.has(value)) return { ok: false };
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 1_000_000 || Reflect.ownKeys(value).length !== value.length + 1) {
        return { ok: false };
      }
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
          return { ok: false };
        }
        const cloned = clonePlainData(descriptor.value, depth + 1, active);
        if (!cloned.ok) return cloned;
        output.push(cloned.value);
      }
      if (Reflect.ownKeys(value).some((key) => key !== "length" && (
        typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length
      ))) {
        return { ok: false };
      }
      return { ok: true, value: Object.freeze(output) };
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return { ok: false };
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return { ok: false };
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        return { ok: false };
      }
      const cloned = clonePlainData(descriptor.value, depth + 1, active);
      if (!cloned.ok) return cloned;
      output[key] = cloned.value;
    }
    return { ok: true, value: Object.freeze(output) };
  } finally {
    active.delete(value);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
  return Object.freeze(value);
}

function canonical(value: unknown): string {
  return stableCanonicalJson(toCanonicalJson(value));
}

function contractSelection(evidence: TrustedWindowsSourceSelectionEvidenceV0): TrustedWindowsSourceSelectionV0 {
  return {
    kind: evidence.kind,
    canonicalAbsolutePath: evidence.canonicalAbsolutePath,
    resolvedAbsolutePath: evidence.resolvedAbsolutePath,
    byteCountDecimal: evidence.byteCountDecimal,
    fileCount: evidence.fileCount,
    identity: evidence.identity,
    pathEvidence: evidence.pathEvidence,
  };
}

function stripPrivatePickerResponse(
  response: TrustedWindowsNativeSourcePickerResponseV1,
): NativeSourcePickerResponseV0 {
  if (response.status !== "selected") return response;
  return {
    schemaVersion: response.schemaVersion,
    requestRef: response.requestRef,
    operation: response.operation,
    status: "selected",
    selections: response.selections.map((selection) => ({
      ...contractSelection(selection),
      inventoryFileIdentities: selection.inventoryFileIdentities,
    })),
  };
}

function contractOutputBoundary(
  boundary: TrustedWindowsExistingOutputDirectoryBoundaryV1,
): TrustedWindowsExistingOutputDirectoryBoundaryV0 {
  return {
    kind: boundary.kind,
    canonicalAbsolutePath: boundary.canonicalAbsolutePath,
    resolvedAbsolutePath: boundary.resolvedAbsolutePath,
    identity: boundary.identity,
    pathEvidence: boundary.pathEvidence,
  };
}

function stripPrivateOutputResponse(
  response: TrustedWindowsNativeOutputBoundaryResponseV1,
): NativeOutputBoundaryResponseV0 {
  if (response.status !== "resolved") return response;
  const boundaryRecord = inspectPlainRecord(response.outputBoundary);
  if (boundaryRecord === null || boundaryRecord.kind !== "directory") return response;
  return {
    schemaVersion: response.schemaVersion,
    requestRef: response.requestRef,
    operation: "start",
    status: "resolved",
    outputBoundary: contractOutputBoundary(response.outputBoundary),
  };
}

function sourcePairKey(leftRef: string, rightRef: string): string {
  return `${leftRef}\u0000${rightRef}`;
}

function isComparedDisjoint(
  response: NativePathComparisonResponseV0 | null,
): response is NativePathComparedResponseV0 {
  return response?.status === "compared" && response.relation === "disjoint";
}

class RecordingNativeAdapterV1 implements TrustedWindowsNativeSourceAdapterV0 {
  readonly #delegate: TrustedWindowsNativeSourceAdapterV1;
  #recording: EventRecording | null = null;

  constructor(delegate: TrustedWindowsNativeSourceAdapterV1) {
    this.#delegate = delegate;
  }

  begin(recording: EventRecording): void {
    if (this.#recording !== null) return failV1("PRIVATE_EVIDENCE_MISMATCH");
    this.#recording = recording;
  }

  end(recording: EventRecording): void {
    if (this.#recording === recording) this.#recording = null;
  }

  get activeRecording(): EventRecording | null {
    return this.#recording;
  }

  async pickFiles(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return await this.#picker(request, this.#delegate.pickFiles.bind(this.#delegate));
  }

  async pickFolder(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return await this.#picker(request, this.#delegate.pickFolder.bind(this.#delegate));
  }

  async dropSources(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return await this.#picker(request, this.#delegate.dropSources.bind(this.#delegate));
  }

  async #picker(
    request: NativeAdapterRequestV0,
    invoke: (request: NativeAdapterRequestV0) => Promise<TrustedWindowsNativeSourcePickerResponseV1>,
  ): Promise<NativeSourcePickerResponseV0> {
    const raw = await invoke(request);
    const cloned = clonePlainData(raw);
    if (!cloned.ok) throw new TrustedWindowsNativeSourceBasketError("FORGED_ADAPTER_RESULT");
    const response = cloned.value as TrustedWindowsNativeSourcePickerResponseV1;
    const responseRecord = inspectPlainRecord(response);
    if (
      responseRecord === null ||
      (response.status === "selected" && !hasExactKeys(responseRecord, [
        "schemaVersion", "requestRef", "operation", "status", "selections",
      ]))
    ) throw new TrustedWindowsNativeSourceBasketError("FORGED_ADAPTER_RESULT");
    this.#recording?.pickerCalls.push({ request, response });
    return stripPrivatePickerResponse(response);
  }

  async resolveOutputBoundary(
    request: NativeAdapterRequestV0,
  ): Promise<NativeOutputBoundaryResponseV0> {
    const raw = await this.#delegate.resolveOutputBoundary(request);
    const cloned = clonePlainData(raw);
    if (!cloned.ok) throw new TrustedWindowsNativeSourceBasketError("FORGED_ADAPTER_RESULT");
    const response = cloned.value as TrustedWindowsNativeOutputBoundaryResponseV1;
    const responseRecord = inspectPlainRecord(response);
    if (
      responseRecord === null ||
      (response.status === "resolved" && !hasExactKeys(responseRecord, [
        "schemaVersion", "requestRef", "operation", "status", "outputBoundary",
      ]))
    ) throw new TrustedWindowsNativeSourceBasketError("FORGED_ADAPTER_RESULT");
    this.#recording?.outputCalls.push({ request, response });
    return stripPrivateOutputResponse(response);
  }

  async compareCanonicalPaths(
    request: NativePathComparisonRequestV0,
  ): Promise<NativePathComparisonResponseV0> {
    const raw = await this.#delegate.compareCanonicalPaths(request);
    const cloned = clonePlainData(raw);
    const response = cloned.ok ? cloned.value as NativePathComparisonResponseV0 : null;
    this.#recording?.comparisonCalls.push({ request, response });
    return response ?? raw;
  }

  async openRevalidatedStartScope(
    request: TrustedWindowsNativeRevalidatedStartRequestV1,
  ): Promise<TrustedWindowsNativeRevalidatedStartScopeV1> {
    return await this.#delegate.openRevalidatedStartScope(request);
  }
}

function browserView(
  view: ReturnType<TrustedWindowsNativeSourceBasketControllerV0["getView"]>,
): TrustedWindowsSourceBasketViewV1 {
  return deepFreeze({
    schemaVersion: BASKET_VIEW_SCHEMA_VERSION,
    sessionRef: view.sessionRef,
    revision: view.revision,
    status: view.status,
    busy: view.busy,
    sources: view.sources.map((source) => ({
      basketPosition: source.basketPosition,
      kind: source.kind,
      label: `${source.kind === "file" ? "File" : "Folder"} ${String(source.basketPosition)}`,
      labelSafety: "generated_kind_and_position_only" as const,
      fileCount: source.fileCount,
      byteCountDecimal: source.byteCountDecimal,
    })),
    totals: { ...view.totals },
    nextEvent: view.nextEvent === null ? null : {
      schemaVersion: BASKET_EVENT_SCHEMA_VERSION,
      sessionRef: view.nextEvent.sessionRef,
      revision: view.nextEvent.revision,
      eventToken: view.nextEvent.eventToken,
    },
  });
}

function parseReceipt(value: unknown): TrustedWindowsNativeStartReceiptV1 | null {
  const record = inspectPlainRecord(value);
  if (record === null || !hasExactKeys(record, [
    "schemaVersion", "receiptRef", "sessionRef", "expectedManifestDigestSha256",
    "adapterBuildSha256", "selectedRoots", "discoveredFiles", "totalBytesDecimal",
    "issuedRevision", "authentication", "authority", "use", "authenticationHmacSha256",
  ])) return null;
  if (
    record.schemaVersion !== START_RECEIPT_SCHEMA_VERSION ||
    typeof record.receiptRef !== "string" || !RECEIPT_REF.test(record.receiptRef) ||
    typeof record.sessionRef !== "string" || !SESSION_REF.test(record.sessionRef) ||
    typeof record.expectedManifestDigestSha256 !== "string" || !SHA256.test(record.expectedManifestDigestSha256) ||
    typeof record.adapterBuildSha256 !== "string" || !SHA256.test(record.adapterBuildSha256) ||
    typeof record.selectedRoots !== "number" || !Number.isSafeInteger(record.selectedRoots) ||
    record.selectedRoots < 1 || Object.is(record.selectedRoots, -0) ||
    typeof record.discoveredFiles !== "number" || !Number.isSafeInteger(record.discoveredFiles) ||
    record.discoveredFiles < 0 || Object.is(record.discoveredFiles, -0) ||
    typeof record.totalBytesDecimal !== "string" || record.totalBytesDecimal.length > 32 ||
    !BYTE_COUNT.test(record.totalBytesDecimal) ||
    typeof record.issuedRevision !== "number" || !Number.isSafeInteger(record.issuedRevision) ||
    record.issuedRevision < 1 || Object.is(record.issuedRevision, -0) ||
    record.authentication !== "controller_authenticated" ||
    record.authority !== "none" ||
    record.use !== "inspection_only" ||
    typeof record.authenticationHmacSha256 !== "string" || !SHA256.test(record.authenticationHmacSha256)
  ) return null;
  return Object.freeze({
    schemaVersion: START_RECEIPT_SCHEMA_VERSION,
    receiptRef: record.receiptRef,
    sessionRef: record.sessionRef,
    expectedManifestDigestSha256: record.expectedManifestDigestSha256,
    adapterBuildSha256: record.adapterBuildSha256,
    selectedRoots: record.selectedRoots,
    discoveredFiles: record.discoveredFiles,
    totalBytesDecimal: record.totalBytesDecimal,
    issuedRevision: record.issuedRevision,
    authentication: "controller_authenticated",
    authority: "none",
    use: "inspection_only",
    authenticationHmacSha256: record.authenticationHmacSha256,
  });
}

function receiptBody(receipt: TrustedWindowsNativeStartReceiptV1): TrustedWindowsNativeStartReceiptBodyV1 {
  const { authenticationHmacSha256: _authentication, ...body } = receipt;
  return body;
}

function isExistingOutputDirectoryBoundary(
  boundary: TrustedWindowsNativeSourceSetInputV0["outputBoundary"],
): boundary is TrustedWindowsExistingOutputDirectoryBoundaryV0 {
  return "kind" in boundary;
}

function identityKey(identity: { readonly volumeSerialNumberHex: string; readonly fileIdHex: string }): string {
  return `${identity.volumeSerialNumberHex}:${identity.fileIdHex}`;
}

interface ParsedRevalidatedStartScopeV1 {
  readonly evidence: unknown;
  readonly release: () => Promise<TrustedWindowsNativeRevalidatedStartReleaseV1>;
  readonly receiver: object;
}

function retainRevalidatedStartRelease(value: unknown): Omit<ParsedRevalidatedStartScopeV1, "evidence"> | null {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return null;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, "release");
  } catch {
    return null;
  }
  if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "function") {
    return null;
  }
  return {
    release: descriptor.value as () => Promise<TrustedWindowsNativeRevalidatedStartReleaseV1>,
    receiver: value,
  };
}

function parseRevalidatedStartScope(
  value: unknown,
  retained: Omit<ParsedRevalidatedStartScopeV1, "evidence">,
): ParsedRevalidatedStartScopeV1 {
  const record = inspectPlainRecord(value);
  if (
    record === null ||
    !hasExactKeys(record, ["evidence", "release"]) ||
    record.release !== retained.release
  ) return failV1("PRIVATE_EVIDENCE_MISMATCH");
  return {
    evidence: record.evidence,
    ...retained,
  };
}

function parseRevalidatedStartRelease(
  value: unknown,
  request: TrustedWindowsNativeRevalidatedStartRequestV1,
): TrustedWindowsNativeRevalidatedStartReleaseV1 {
  const cloned = clonePlainData(value);
  if (!cloned.ok) return failV1("PRIVATE_EVIDENCE_MISMATCH");
  const record = inspectPlainRecord(cloned.value);
  if (
    record === null ||
    !hasExactKeys(record, ["schemaVersion", "requestRef", "sessionRef", "operation", "status"]) ||
    record.schemaVersion !== REVALIDATED_START_RELEASE_SCHEMA_VERSION ||
    record.requestRef !== request.requestRef ||
    record.sessionRef !== request.sessionRef ||
    record.operation !== "release_revalidated_start" ||
    record.status !== "released"
  ) return failV1("PRIVATE_EVIDENCE_MISMATCH");
  return Object.freeze({
    schemaVersion: REVALIDATED_START_RELEASE_SCHEMA_VERSION,
    requestRef: request.requestRef,
    sessionRef: request.sessionRef,
    operation: "release_revalidated_start",
    status: "released",
  });
}

function parseRevalidatedStartEvidence(
  value: unknown,
  request: TrustedWindowsNativeRevalidatedStartRequestV1,
): TrustedWindowsNativeRevalidatedStartEvidenceV1 {
  const cloned = clonePlainData(value);
  if (!cloned.ok) return failV1("PRIVATE_EVIDENCE_MISMATCH");
  const record = inspectPlainRecord(cloned.value);
  if (record === null || !hasExactKeys(record, [
    "schemaVersion", "requestRef", "sessionRef", "operation", "adapterId",
    "adapterBuildSha256", "identityComparisonMechanism", "pathComparisonMechanism",
    "outputBoundary", "selections", "nativePathComparisons",
  ])) return failV1("PRIVATE_EVIDENCE_MISMATCH");
  if (
    record.schemaVersion !== REVALIDATED_START_EVIDENCE_SCHEMA_VERSION ||
    record.requestRef !== request.requestRef ||
    record.sessionRef !== request.sessionRef ||
    record.operation !== "revalidate_start" ||
    record.adapterId !== request.adapterId ||
    record.adapterBuildSha256 !== request.adapterBuildSha256 ||
    record.identityComparisonMechanism !== "windows_volume_serial_plus_file_id_128" ||
    record.pathComparisonMechanism !== "windows_compare_string_ordinal_ignore_case" ||
    !Array.isArray(record.selections) ||
    typeof record.outputBoundary !== "object" || record.outputBoundary === null ||
    typeof record.nativePathComparisons !== "object" || record.nativePathComparisons === null
  ) return failV1("PRIVATE_EVIDENCE_MISMATCH");
  return cloned.value as TrustedWindowsNativeRevalidatedStartEvidenceV1;
}

export class TrustedWindowsNativeSourceBasketControllerV1 {
  readonly #adapter: RecordingNativeAdapterV1;
  readonly #controller: TrustedWindowsNativeSourceBasketControllerV0;
  readonly #adapterId: string;
  readonly #adapterBuildSha256: string;
  readonly #randomBytes: (size: number) => Uint8Array;
  readonly #assertSourceSetInput?: TrustedWindowsNativeSourceBasketControllerOptionsV1["assertSourceSetInput"];
  readonly #acceptTrustedStartInput: TrustedWindowsNativeSourceBasketControllerOptionsV1["acceptTrustedStartInput"];
  #receiptAuthenticationKey: Buffer | null;
  #privateSelections: PrivateSelectionV1[] = [];
  #sourceComparisons = new Map<string, RecordedComparisonCall>();
  #preparedHandoff: PreparedHandoffV1 | null = null;
  #activeReceipt: ActiveReceiptV1 | null = null;
  #poisoned = false;

  constructor(options: TrustedWindowsNativeSourceBasketControllerOptionsV1) {
    if (!ADAPTER_ID.test(options.adapterId)) {
      throw new TrustedWindowsNativeSourceBasketV1Error("INVALID_ADAPTER_ID");
    }
    if (!SHA256.test(options.trustedAdapterBuildSha256)) {
      throw new TrustedWindowsNativeSourceBasketV1Error(
        "INVALID_TRUSTED_ADAPTER_BUILD_SHA256",
      );
    }
    this.#adapterId = options.adapterId;
    this.#adapterBuildSha256 = options.trustedAdapterBuildSha256;
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes;
    this.#assertSourceSetInput = options.assertSourceSetInput;
    this.#acceptTrustedStartInput = options.acceptTrustedStartInput;
    this.#receiptAuthenticationKey = options.receiptAuthenticationKey === undefined
      ? this.#secretBytes(32)
      : this.#copyReceiptKey(options.receiptAuthenticationKey);
    this.#adapter = new RecordingNativeAdapterV1(options.adapter);
    try {
      this.#controller = new TrustedWindowsNativeSourceBasketControllerV0({
        adapter: this.#adapter,
        randomBytes: this.#randomBytes,
        maxFilesPerSelection: TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxFilesPerSelection,
        maxDiscoveredFiles: TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxDiscoveredFiles,
        packageSourceSetValidation: "v0_structural_for_v1_native_path_transcript",
        assertSourceSetInput: (input) => {
          try {
            this.#prepareV1Handoff(input);
          } catch (error: unknown) {
            if (
              error instanceof TrustedWindowsNativeSourceBasketV1Error &&
              error.code === "PRIVATE_EVIDENCE_MISMATCH"
            ) {
              const recording = this.#adapter.activeRecording;
              if (recording !== null) recording.evidenceMismatch = true;
              this.#poison();
            }
            throw error;
          }
        },
        acceptTrustedStartInput: async (input) => { await this.#acceptPreparedHandoff(input); },
      });
    } catch (error: unknown) {
      this.#zeroReceiptAuthenticationKey();
      throw error;
    }
  }

  getView(): TrustedWindowsSourceBasketViewV1 {
    const view = browserView(this.#controller.getView());
    if (!this.#poisoned) return view;
    return deepFreeze({
      ...view,
      status: "cancelled" as const,
      busy: false,
      sources: [],
      totals: {
        selectedRoots: 0,
        discoveredFiles: 0,
        totalBytesDecimal: "0",
      },
      nextEvent: null,
    });
  }

  async dispatch(eventValue: unknown): Promise<TrustedWindowsSourceBasketResultV1> {
    if (this.#poisoned) return failEvent("CONTROLLER_TERMINAL");
    const event = parseEvent(eventValue);
    const before = this.#controller.getView();
    const sourceRef = event.action === "remove"
      ? before.sources[event.basketPosition === undefined ? -1 : event.basketPosition - 1]?.sourceRef ?? "missing"
      : undefined;
    const v0Event = event.action === "remove"
      ? {
        schemaVersion: "trusted-windows-native-source-basket-event.v0" as const,
        sessionRef: event.sessionRef,
        revision: event.revision,
        eventToken: event.eventToken,
        action: "remove" as const,
        sourceRef: sourceRef ?? "missing",
      }
      : {
        schemaVersion: "trusted-windows-native-source-basket-event.v0" as const,
        sessionRef: event.sessionRef,
        revision: event.revision,
        eventToken: event.eventToken,
        action: event.action,
      };
    const ownsRecording = !before.busy;
    const recording: EventRecording = {
      pickerCalls: [],
      outputCalls: [],
      comparisonCalls: [],
      evidenceMismatch: false,
      helperTeardownUnconfirmed: false,
    };
    if (ownsRecording) this.#adapter.begin(recording);
    let result: Awaited<ReturnType<TrustedWindowsNativeSourceBasketControllerV0["dispatch"]>>;
    try {
      result = await this.#controller.dispatch(v0Event);
    } finally {
      if (ownsRecording) this.#adapter.end(recording);
    }
    if (recording.helperTeardownUnconfirmed) {
      return failV1("HELPER_TEARDOWN_UNCONFIRMED");
    }
    if (recording.evidenceMismatch) return failV1("PRIVATE_EVIDENCE_MISMATCH");
    if (ownsRecording) {
      try {
        this.#commitPrivateState(event, before, result, recording);
      } catch (error: unknown) {
        if (
          error instanceof TrustedWindowsNativeSourceBasketV1Error &&
          error.code === "PRIVATE_EVIDENCE_MISMATCH"
        ) this.#poison();
        throw error;
      }
    }
    if (result.view.status !== "ready") this.#finishPrivateTerminal(result.view.status);
    this.#preparedHandoff = null;
    return deepFreeze({
      status: result.status,
      code: result.code,
      message: result.message,
      view: browserView(result.view),
    });
  }

  /**
   * Native-only one-use guard. It is valid only while this controller invokes
   * its start sink; changed, cross-session, stale, and replayed receipts return false.
   */
  verifyAndConsumeTrustedStartReceipt(receiptValue: unknown): boolean {
    const active = this.#activeReceipt;
    const key = this.#receiptAuthenticationKey;
    if (active === null || active.consumed || key === null) return false;
    const receipt = parseReceipt(receiptValue);
    if (receipt === null) return false;
    const bodyCanonical = canonical(receiptBody(receipt));
    const expectedAuthentication = createHmac("sha256", key)
      .update(RECEIPT_AUTHENTICATION_DOMAIN, "ascii")
      .update(Buffer.from([0]))
      .update(bodyCanonical, "utf8")
      .digest();
    const suppliedAuthentication = Buffer.from(receipt.authenticationHmacSha256.slice(7), "hex");
    const authenticationMatches = expectedAuthentication.byteLength === suppliedAuthentication.byteLength &&
      timingSafeEqual(expectedAuthentication, suppliedAuthentication);
    expectedAuthentication.fill(0);
    suppliedAuthentication.fill(0);
    if (!authenticationMatches || bodyCanonical !== active.bodyCanonical) return false;
    active.consumed = true;
    return true;
  }

  #secretBytes(size: number): Buffer {
    let generated: Uint8Array;
    try {
      generated = this.#randomBytes(size);
    } catch {
      throw new TrustedWindowsNativeSourceBasketError("RANDOM_SOURCE_FAILED");
    }
    if (
      !(generated instanceof Uint8Array) ||
      generated.byteLength !== size ||
      generated.every((byte) => byte === 0)
    ) {
      throw new TrustedWindowsNativeSourceBasketError("RANDOM_SOURCE_FAILED");
    }
    return Buffer.from(generated);
  }

  #copyReceiptKey(value: Uint8Array): Buffer {
    if (!(value instanceof Uint8Array) || value.byteLength !== 32 || value.every((byte) => byte === 0)) {
      return failV1("INVALID_RECEIPT_AUTHENTICATION_KEY");
    }
    return Buffer.from(value);
  }

  #commitPrivateState(
    event: ParsedEventV1,
    before: ReturnType<TrustedWindowsNativeSourceBasketControllerV0["getView"]>,
    result: Awaited<ReturnType<TrustedWindowsNativeSourceBasketControllerV0["dispatch"]>>,
    recording: EventRecording,
  ): void {
    if (
      (event.action === "add_files" ||
        event.action === "add_folder" ||
        event.action === "add_dropped") &&
      result.status === "updated"
    ) {
      this.#commitAddedSelections(before, result.view, recording);
      return;
    }
    if (event.action === "remove" && result.status === "updated") {
      const liveRefs = new Set(result.view.sources.map((source) => source.sourceRef));
      this.#privateSelections = this.#privateSelections.filter((source) => liveRefs.has(source.sourceRef));
      for (const key of this.#sourceComparisons.keys()) {
        const [leftRef, rightRef] = key.split("\u0000", 2);
        if (leftRef === undefined || rightRef === undefined || !liveRefs.has(leftRef) || !liveRefs.has(rightRef)) {
          this.#sourceComparisons.delete(key);
        }
      }
      return;
    }
    if (event.action === "clear" && result.status === "updated") {
      this.#privateSelections = [];
      this.#sourceComparisons.clear();
    }
  }

  #commitAddedSelections(
    before: ReturnType<TrustedWindowsNativeSourceBasketControllerV0["getView"]>,
    after: ReturnType<TrustedWindowsNativeSourceBasketControllerV0["getView"]>,
    recording: EventRecording,
  ): void {
    if (recording.pickerCalls.length !== 1) return failV1("PRIVATE_EVIDENCE_MISMATCH");
    const picker = recording.pickerCalls[0];
    if (picker === undefined || picker.response?.status !== "selected") {
      return failV1("PRIVATE_EVIDENCE_MISMATCH");
    }
    const selections = picker.response.selections.map(parsePrivatePickerSelection);
    if (after.sources.length !== before.sources.length + selections.length) {
      return failV1("PRIVATE_EVIDENCE_MISMATCH");
    }
    const beforeRefs = before.sources.map((source) => source.sourceRef);
    if (beforeRefs.some((sourceRef, index) => after.sources[index]?.sourceRef !== sourceRef)) {
      return failV1("PRIVATE_EVIDENCE_MISMATCH");
    }
    const nextSelections = [...this.#privateSelections];
    for (let offset = 0; offset < selections.length; offset += 1) {
      const sourceRef = after.sources[before.sources.length + offset]?.sourceRef;
      const evidence = selections[offset];
      if (sourceRef === undefined || evidence === undefined) return failV1("PRIVATE_EVIDENCE_MISMATCH");
      nextSelections.push(Object.freeze({ sourceRef, evidence }));
    }
    const additions = nextSelections.length - this.#privateSelections.length;
    const expectedComparisonCount =
      (this.#privateSelections.length * additions) + ((additions * (additions - 1)) / 2);
    if (recording.comparisonCalls.length !== expectedComparisonCount) {
      return failV1("PRIVATE_EVIDENCE_MISMATCH");
    }
    const nextComparisons = new Map(this.#sourceComparisons);
    for (let rightIndex = this.#privateSelections.length; rightIndex < nextSelections.length; rightIndex += 1) {
      const right = nextSelections[rightIndex];
      if (right === undefined) return failV1("PRIVATE_EVIDENCE_MISMATCH");
      for (let leftIndex = 0; leftIndex < rightIndex; leftIndex += 1) {
        const left = nextSelections[leftIndex];
        if (left === undefined) return failV1("PRIVATE_EVIDENCE_MISMATCH");
        const matches = recording.comparisonCalls.filter((call) =>
          call.request.leftCanonicalAbsolutePath === right.evidence.canonicalAbsolutePath &&
          call.request.rightCanonicalAbsolutePath === left.evidence.canonicalAbsolutePath &&
          isComparedDisjoint(call.response)
        );
        if (matches.length !== 1 || matches[0] === undefined) {
          return failV1("PRIVATE_EVIDENCE_MISMATCH");
        }
        nextComparisons.set(sourcePairKey(left.sourceRef, right.sourceRef), matches[0]);
      }
    }
    this.#privateSelections = nextSelections;
    this.#sourceComparisons = nextComparisons;
  }

  #prepareV1Handoff(v0Input: TrustedWindowsNativeSourceSetInputV0): void {
    const recording = this.#adapter.activeRecording;
    const outputBoundary = v0Input.outputBoundary;
    if (
      recording === null ||
      recording.outputCalls.length !== 1 ||
      this.#privateSelections.length !== v0Input.selections.length ||
      !isExistingOutputDirectoryBoundary(outputBoundary)
    ) {
      return failV1("PRIVATE_EVIDENCE_MISMATCH");
    }
    const expectedSelections = this.#privateSelections.map((privateSource, index) => {
      const v0Selection = v0Input.selections[index];
      if (
        v0Selection === undefined ||
        canonical(v0Selection) !== canonical(contractSelection(privateSource.evidence))
      ) return failV1("PRIVATE_EVIDENCE_MISMATCH");
      return privateSource.evidence;
    });
    const recordedOutput = recording.outputCalls[0]?.response;
    if (recordedOutput?.status !== "resolved") return failV1("PRIVATE_EVIDENCE_MISMATCH");
    const privateOutputBoundary = parsePrivateOutputBoundary(recordedOutput.outputBoundary);
    if (canonical(contractOutputBoundary(privateOutputBoundary)) !== canonical(outputBoundary)) {
      return failV1("PRIVATE_EVIDENCE_MISMATCH");
    }
    if (
      expectedSelections.some((selection) =>
        selection.fileCount > TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxFilesPerSelection
      ) ||
      expectedSelections.reduce((total, selection) => total + selection.fileCount, 0) >
        TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxDiscoveredFiles ||
      expectedSelections.some((selection) =>
        identityKey(selection.identity) === identityKey(privateOutputBoundary.identity)
      )
    ) return failV1("PRIVATE_EVIDENCE_MISMATCH");
    this.#preparedHandoff = Object.freeze({
      v0InputCanonical: canonical(v0Input),
      expectedOutputBoundary: privateOutputBoundary,
      expectedSelections: Object.freeze(expectedSelections),
    });
  }

  async #acceptPreparedHandoff(v0Input: TrustedWindowsNativeSourceSetInputV0): Promise<void> {
    const prepared = this.#preparedHandoff;
    if (
      prepared === null ||
      this.#receiptAuthenticationKey === null ||
      prepared.v0InputCanonical !== canonical(v0Input)
    ) return this.#rejectPrivateEvidenceMismatch();
    const request: TrustedWindowsNativeRevalidatedStartRequestV1 = deepFreeze({
      schemaVersion: REVALIDATED_START_REQUEST_SCHEMA_VERSION,
      requestRef: `revalidated_start_${this.#secretBytes(16).toString("hex")}`,
      sessionRef: this.#controller.getView().sessionRef,
      operation: "revalidate_start",
      adapterId: this.#adapterId,
      adapterBuildSha256: this.#adapterBuildSha256,
      readOnly: true,
      browserPathInputAccepted: false,
      expectedOutputBoundary: prepared.expectedOutputBoundary,
      expectedSelections: prepared.expectedSelections,
    });
    let opened: unknown;
    try {
      opened = await this.#adapter.openRevalidatedStartScope(request);
    } catch (error: unknown) {
      if (hasOwnHelperTeardownUnconfirmedCode(error)) {
        return this.#rejectHelperTeardownUnconfirmed();
      }
      return this.#rejectPrivateEvidenceMismatch();
    }
    const retainedRelease = retainRevalidatedStartRelease(opened);
    if (retainedRelease === null) {
      throw new Error("The native revalidated handle scope release cannot be confirmed.");
    }
    const handoffState = { sinkEntered: false };
    let operationError: Error | null = null;
    try {
      const scope = parseRevalidatedStartScope(opened, retainedRelease);
      const evidence = parseRevalidatedStartEvidence(scope.evidence, request);
      await this.#acceptFreshEvidence(v0Input, prepared, evidence, () => {
        handoffState.sinkEntered = true;
      });
    } catch (error: unknown) {
      operationError = error instanceof Error
        ? error
        : new Error("The native revalidated handoff failed.");
    }
    let releaseFailed = false;
    try {
      const releaseValue: unknown = await Reflect.apply(
        retainedRelease.release,
        retainedRelease.receiver,
        [],
      );
      parseRevalidatedStartRelease(releaseValue, request);
    } catch {
      releaseFailed = true;
    }
    if (releaseFailed) {
      throw new Error("The native revalidated handle scope release was not confirmed.");
    }
    if (operationError !== null) {
      if (!handoffState.sinkEntered) return this.#rejectPrivateEvidenceMismatch();
      throw operationError;
    }
  }

  async #acceptFreshEvidence(
    v0Input: TrustedWindowsNativeSourceSetInputV0,
    prepared: PreparedHandoffV1,
    evidence: TrustedWindowsNativeRevalidatedStartEvidenceV1,
    onSinkEntry: () => void,
  ): Promise<void> {
    if (evidence.selections.length !== prepared.expectedSelections.length) {
      return failV1("PRIVATE_EVIDENCE_MISMATCH");
    }
    for (let index = 0; index < evidence.selections.length; index += 1) {
      const fresh = evidence.selections[index];
      const expected = prepared.expectedSelections[index];
      if (
        fresh === undefined ||
        expected === undefined ||
        canonical(fresh) !== canonical(expected)
      ) return failV1("PRIVATE_EVIDENCE_MISMATCH");
    }
    if (
      canonical(evidence.outputBoundary) !== canonical(prepared.expectedOutputBoundary) ||
      evidence.selections.some((selection) =>
        identityKey(selection.identity) === identityKey(evidence.outputBoundary.identity)
      )
    ) return failV1("PRIVATE_EVIDENCE_MISMATCH");
    let input: TrustedWindowsNativeSourceSetInputV1;
    let manifest: TrustedWindowsNativeSourceSetManifestV1;
    try {
      const selections: TrustedWindowsSourceSelectionV1[] = evidence.selections.map((selection) =>
        deepFreeze({
          ...selection,
          inventoryIdentityEvidence: deriveTrustedWindowsSelectionIdentityEvidenceV1(
            selection.inventoryFileIdentities,
          ),
        })
      );
      const nativePathComparisons = evidence.nativePathComparisons;
      const adapterBase = {
        adapterId: this.#adapterId,
        adapterBuildSha256: this.#adapterBuildSha256,
        identityComparisonMechanism: "windows_volume_serial_plus_file_id_128" as const,
        pathComparisonMechanism: "windows_compare_string_ordinal_ignore_case" as const,
      };
      input = deepFreeze({
        schemaVersion: "trusted-windows-native-source-set-input.v1",
        origin: "trusted_windows_native_launcher",
        browserPathInputAccepted: false,
        sessionNonceHex: v0Input.sessionNonceHex,
        outputBoundary: evidence.outputBoundary,
        selections,
        adapterEvidence: {
          ...adapterBase,
          comparisonTranscriptSha256: deriveTrustedWindowsPathComparisonTranscriptSha256V1({
            ...adapterBase,
            sourceCanonicalAbsolutePaths: selections.map((selection) => selection.canonicalAbsolutePath),
            outputCanonicalAbsolutePath: evidence.outputBoundary.canonicalAbsolutePath,
            nativePathComparisons,
          }),
        },
        crossSelectionIdentityEvidence: deriveTrustedWindowsCrossSelectionIdentityEvidenceV1(selections),
        nativePathComparisons,
      });
      manifest = buildTrustedWindowsSourceSetManifestV1(input);
    } catch {
      return failV1("PRIVATE_EVIDENCE_MISMATCH");
    }
    if (!isStructurallyValidWindowsSourceSetManifestV1(manifest)) {
      return failV1("PRIVATE_EVIDENCE_MISMATCH");
    }
    try {
      this.#assertSourceSetInput?.(input, manifest);
    } catch (error: unknown) {
      if (
        error instanceof TrustedWindowsNativeSourceBasketV1Error &&
        error.code === "PRIVATE_EVIDENCE_MISMATCH"
      ) {
        return failV1("PRIVATE_EVIDENCE_MISMATCH");
      }
      throw error;
    }
    await this.#issueReceiptAndSink(input, manifest, onSinkEntry);
  }

  async #issueReceiptAndSink(
    input: TrustedWindowsNativeSourceSetInputV1,
    manifest: TrustedWindowsNativeSourceSetManifestV1,
    onSinkEntry: () => void,
  ): Promise<void> {
    const key = this.#receiptAuthenticationKey;
    if (key === null) return failV1("PRIVATE_EVIDENCE_MISMATCH");
    const issuedRevision = this.#controller.getView().revision;
    const receiptRef = `start_receipt_${createHmac("sha256", key)
      .update(RECEIPT_REF_DOMAIN, "ascii")
      .update(Buffer.from([0]))
      .update(canonical({
        sessionRef: this.#controller.getView().sessionRef,
        issuedRevision,
        expectedManifestDigestSha256: manifest.manifestDigestSha256,
      }), "utf8")
      .digest("hex")}`;
    const body: TrustedWindowsNativeStartReceiptBodyV1 = Object.freeze({
      schemaVersion: START_RECEIPT_SCHEMA_VERSION,
      receiptRef,
      sessionRef: this.#controller.getView().sessionRef,
      expectedManifestDigestSha256: manifest.manifestDigestSha256,
      adapterBuildSha256: this.#adapterBuildSha256,
      selectedRoots: manifest.totals.selectedRoots,
      discoveredFiles: manifest.totals.discoveredFiles,
      totalBytesDecimal: manifest.totals.totalBytesDecimal,
      issuedRevision,
      authentication: "controller_authenticated",
      authority: "none",
      use: "inspection_only",
    });
    const bodyCanonical = canonical(body);
    const receipt: TrustedWindowsNativeStartReceiptV1 = Object.freeze({
      ...body,
      authenticationHmacSha256: `sha256:${createHmac("sha256", key)
        .update(RECEIPT_AUTHENTICATION_DOMAIN, "ascii")
        .update(Buffer.from([0]))
        .update(bodyCanonical, "utf8")
        .digest("hex")}`,
    });
    this.#activeReceipt = { bodyCanonical, receipt, consumed: false };
    const receiptGuard: TrustedWindowsNativeStartReceiptGuardV1 = Object.freeze({
      consume: (value: unknown): boolean => this.verifyAndConsumeTrustedStartReceipt(value),
    });
    let sinkFailed = false;
    let sinkError: unknown;
    try {
      onSinkEntry();
      await this.#acceptTrustedStartInput(input, manifest, receipt, receiptGuard);
    } catch (error: unknown) {
      sinkFailed = true;
      sinkError = error;
    }
    const guardAccepted = this.#activeReceipt.consumed;
    this.#activeReceipt = null;
    this.#zeroReceiptAuthenticationKey();
    if (sinkFailed) throw sinkError;
    if (!guardAccepted) return failV1("PRIVATE_EVIDENCE_MISMATCH");
  }

  #finishPrivateTerminal(status: Exclude<TrustedWindowsSourceBasketStatusV1, "ready">): void {
    void status;
    this.#privateSelections = [];
    this.#sourceComparisons.clear();
    this.#preparedHandoff = null;
    this.#activeReceipt = null;
    this.#zeroReceiptAuthenticationKey();
  }

  #poison(): void {
    this.#poisoned = true;
    this.#controller.disposePrivateState();
    this.#privateSelections = [];
    this.#sourceComparisons.clear();
    this.#preparedHandoff = null;
    this.#activeReceipt = null;
    this.#zeroReceiptAuthenticationKey();
  }

  #rejectPrivateEvidenceMismatch(): never {
    const recording = this.#adapter.activeRecording;
    if (recording !== null) recording.evidenceMismatch = true;
    this.#poison();
    return failV1("PRIVATE_EVIDENCE_MISMATCH");
  }

  #rejectHelperTeardownUnconfirmed(): never {
    const recording = this.#adapter.activeRecording;
    if (recording !== null) recording.helperTeardownUnconfirmed = true;
    this.#poison();
    return failV1("HELPER_TEARDOWN_UNCONFIRMED");
  }

  #zeroReceiptAuthenticationKey(): void {
    this.#receiptAuthenticationKey?.fill(0);
    this.#receiptAuthenticationKey = null;
  }
}

/** A safely configured production V1 composition is intentionally absent; this fallback remains fail-closed. */
export class FailClosedWindowsNativeSourceAdapterV1
  extends FailClosedWindowsNativeSourceAdapterV0
  implements TrustedWindowsNativeSourceAdapterV1 {
  override async pickFiles(
    request: NativeAdapterRequestV0,
  ): Promise<TrustedWindowsNativeSourcePickerResponseV1> {
    return await super.pickFiles(request) as TrustedWindowsNativeSourcePickerResponseV1;
  }

  override async pickFolder(
    request: NativeAdapterRequestV0,
  ): Promise<TrustedWindowsNativeSourcePickerResponseV1> {
    return await super.pickFolder(request) as TrustedWindowsNativeSourcePickerResponseV1;
  }

  override async dropSources(
    request: NativeAdapterRequestV0,
  ): Promise<TrustedWindowsNativeSourcePickerResponseV1> {
    return await super.dropSources(request) as TrustedWindowsNativeSourcePickerResponseV1;
  }

  override async resolveOutputBoundary(
    request: NativeAdapterRequestV0,
  ): Promise<TrustedWindowsNativeOutputBoundaryResponseV1> {
    return await super.resolveOutputBoundary(request) as TrustedWindowsNativeOutputBoundaryResponseV1;
  }

  openRevalidatedStartScope(
    _request: TrustedWindowsNativeRevalidatedStartRequestV1,
  ): Promise<TrustedWindowsNativeRevalidatedStartScopeV1> {
    return Promise.reject(new Error("The native revalidated handle scope is unavailable."));
  }
}

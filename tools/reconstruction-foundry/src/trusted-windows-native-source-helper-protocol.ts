import { createHash } from "node:crypto";

export const TRUSTED_WINDOWS_NATIVE_HELPER_PROTOCOL_SCHEMA_VERSION_V1 = 1;
export const TRUSTED_WINDOWS_NATIVE_HELPER_BUILD_IDENTIFIER_V1 =
  "venviewer-windows-source-helper/0.2.0";
export const TRUSTED_WINDOWS_NATIVE_HELPER_HANDSHAKE_DOMAIN_V1 =
  "OMNITWIN.WINDOWS_SOURCE_HELPER.HANDSHAKE.V1";
export const TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1 = Object.freeze([
  "pick_files",
  "pick_folder",
  "drop_sources",
  "resolve_output",
  "compare_paths",
  "revalidate_start",
  "release_revalidated_start",
  "create_run_output",
  "create_output_file",
  "close",
] as const);
export const TRUSTED_WINDOWS_NATIVE_HELPER_ERROR_CODES_V1 = Object.freeze([
  "INVALID_MESSAGE",
  "MESSAGE_TOO_LARGE",
  "UNSUPPORTED_OPERATION",
  "SESSION_MISMATCH",
  "SEQUENCE_MISMATCH",
  "PATH_REJECTED",
  "COMPARISON_FAILED",
  "CANCEL_TARGET_UNKNOWN",
  "REFERENCE_UNKNOWN",
  "OPERATION_ORDER_REJECTED",
  "CUSTODY_REJECTED",
  "INTERNAL_FAILURE",
] as const);

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HEX_32_PATTERN = /^[a-f0-9]{64}$/u;
const SESSION_REF_PATTERN = /^helper_session_(?!0{32}$)[a-f0-9]{32}$/u;
const REQUEST_REF_PATTERN = /^helper_request_(?!0{32}$)[a-f0-9]{32}$/u;
const BASKET_SESSION_REF_PATTERN = /^basket_(?!0{32}$)[a-f0-9]{32}$/u;
const NATIVE_REQUEST_REF_PATTERN = /^native_request_(?!0{32}$)[a-f0-9]{32}$/u;
const REVALIDATED_REQUEST_REF_PATTERN = /^revalidated_start_(?!0{32}$)[a-f0-9]{32}$/u;
const SOURCE_REF_PATTERN = /^helper_source_(?!0{32}$)[a-f0-9]{32}$/u;
const OUTPUT_REF_PATTERN = /^helper_output_(?!0{32}$)[a-f0-9]{32}$/u;
const SCOPE_REF_PATTERN = /^helper_scope_(?!0{32}$)[a-f0-9]{32}$/u;
const SOURCE_FILE_REF_PATTERN = /^helper_source_file_(?!0{32}$)[a-f0-9]{32}$/u;
const RUN_REF_PATTERN = /^helper_run_(?!0{32}$)[a-f0-9]{32}$/u;
const OUTPUT_FILE_REF_PATTERN = /^helper_output_file_(?!0{32}$)[a-f0-9]{32}$/u;
const VOLUME_SERIAL_PATTERN = /^[A-F0-9]{16}$/u;
const FILE_ID_PATTERN = /^[A-F0-9]{32}$/u;
const BYTE_COUNT_PATTERN = /^(?:0|[1-9][0-9]{0,31})$/u;
const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,95}$/u;
const MAX_PROTOCOL_STRING_CODE_UNITS = 32_767;
const MAX_JSON_DEPTH = 32;

export type TrustedWindowsNativeHelperCapabilityV1 =
  typeof TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1[number];
export type TrustedWindowsNativeHelperErrorCodeV1 =
  typeof TRUSTED_WINDOWS_NATIVE_HELPER_ERROR_CODES_V1[number];
export type TrustedWindowsNativeHelperPathRelationV1 =
  | "same"
  | "ancestor"
  | "descendant"
  | "disjoint";
export type TrustedWindowsNativeHelperSourceAcquisitionV1 =
  | "windows_native_picker_handle"
  | "windows_native_drop_cfhdrop_then_handle_open";

export interface TrustedWindowsNativeHelperHandshakeRequestV1 {
  readonly type: "handshake";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly challenge: string;
  readonly expected_helper_sha256: string;
}

export interface TrustedWindowsNativeHelperHandshakeOkV1 {
  readonly type: "handshake_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly process_architecture: "x86_64";
  readonly build_identifier: typeof TRUSTED_WINDOWS_NATIVE_HELPER_BUILD_IDENTIFIER_V1;
  readonly self_observed_image_sha256: string;
  readonly challenge_response_sha256: string;
  readonly capabilities: readonly TrustedWindowsNativeHelperCapabilityV1[];
}

export interface TrustedWindowsNativeHelperComparePathsRequestV1 {
  readonly type: "compare_paths";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly sequence: number;
  readonly left_path: string;
  readonly right_path: string;
}

export interface TrustedWindowsNativeHelperComparePathsOkV1 {
  readonly type: "compare_paths_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly sequence: number;
  readonly relation: TrustedWindowsNativeHelperPathRelationV1;
}

export interface TrustedWindowsNativeHelperAdapterBindingV1 {
  readonly basket_session_ref: string;
  readonly controller_request_ref: string;
}

interface TrustedWindowsNativeHelperBoundWorkRequestV1 {
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly sequence: number;
}

export interface TrustedWindowsNativeHelperPickFilesRequestV1
  extends TrustedWindowsNativeHelperBoundWorkRequestV1,
  TrustedWindowsNativeHelperAdapterBindingV1 {
  readonly type: "pick_files";
}

export interface TrustedWindowsNativeHelperPickFolderRequestV1
  extends TrustedWindowsNativeHelperBoundWorkRequestV1,
  TrustedWindowsNativeHelperAdapterBindingV1 {
  readonly type: "pick_folder";
}

export interface TrustedWindowsNativeHelperDropSourcesRequestV1
  extends TrustedWindowsNativeHelperBoundWorkRequestV1,
  TrustedWindowsNativeHelperAdapterBindingV1 {
  readonly type: "drop_sources";
}

export interface TrustedWindowsNativeHelperResolveOutputRequestV1
  extends TrustedWindowsNativeHelperBoundWorkRequestV1,
  TrustedWindowsNativeHelperAdapterBindingV1 {
  readonly type: "resolve_output";
}

export interface TrustedWindowsNativeHelperRevalidateStartRequestV1
  extends TrustedWindowsNativeHelperBoundWorkRequestV1,
  TrustedWindowsNativeHelperAdapterBindingV1 {
  readonly type: "revalidate_start";
  readonly adapter_id: string;
  readonly adapter_build_sha256: string;
  readonly expected_source_refs: readonly string[];
  readonly expected_output_ref: string;
}

export interface TrustedWindowsNativeHelperReleaseRevalidatedStartRequestV1
  extends TrustedWindowsNativeHelperBoundWorkRequestV1,
  TrustedWindowsNativeHelperAdapterBindingV1 {
  readonly type: "release_revalidated_start";
  readonly scope_ref: string;
}

export interface TrustedWindowsNativeHelperCreateRunOutputRequestV1
  extends TrustedWindowsNativeHelperBoundWorkRequestV1 {
  readonly type: "create_run_output";
  readonly scope_ref: string;
}

export interface TrustedWindowsNativeHelperCreateOutputFileRequestV1
  extends TrustedWindowsNativeHelperBoundWorkRequestV1 {
  readonly type: "create_output_file";
  readonly scope_ref: string;
  readonly run_ref: string;
  readonly component: string;
}

export interface TrustedWindowsNativeHelperIdentityV1
  extends Readonly<Record<string, StrictJsonValue>> {
  readonly volume_serial_number_hex: string;
  readonly file_id_hex: string;
}

export interface TrustedWindowsNativeHelperLocalVolumeEvidenceV1
  extends Readonly<Record<string, StrictJsonValue>> {
  readonly opened_handle_file_type: "FILE_TYPE_DISK";
  readonly volume_path_resolution: "get_volume_path_name_w";
  readonly drive_type_query: "get_drive_type_w";
  readonly drive_type: "DRIVE_FIXED" | "DRIVE_REMOVABLE";
  readonly dos_device_query: "query_dos_device_w";
  readonly dos_device_mapping: "direct_local_volume";
  readonly dos_device_alias_chain_detected: false;
  readonly subst_target_detected: false;
  readonly unc_redirector_detected: false;
  readonly network_device_target_detected: false;
  readonly opened_handle_volume_corroboration:
    "file_id_info_volume_serial_matches_opened_volume_root_handle";
  readonly opened_handle_volume_serial_number_hex: string;
  readonly volume_root_handle_serial_number_hex: string;
}

export interface TrustedWindowsNativeHelperSourceEvidenceV1 {
  readonly kind: "file" | "directory";
  readonly canonical_absolute_path: string;
  readonly resolved_absolute_path: string;
  readonly byte_count_decimal: string;
  readonly file_count: number;
  readonly identity: TrustedWindowsNativeHelperIdentityV1;
  readonly inventory_file_identities: readonly TrustedWindowsNativeHelperIdentityV1[];
  readonly path_evidence: TrustedWindowsNativeHelperSourcePathEvidenceV1;
  readonly local_volume_evidence: TrustedWindowsNativeHelperLocalVolumeEvidenceV1;
}

export interface TrustedWindowsNativeHelperSourcePathEvidenceV1
  extends Readonly<Record<string, StrictJsonValue>> {
  readonly acquisition: TrustedWindowsNativeHelperSourceAcquisitionV1;
  readonly canonicalization: "final_path_by_handle";
  readonly inspection_mode: "read_only";
  readonly path_identity_checked_by_handle: true;
  readonly reparse_inspection_scope: "volume_root_through_complete_selection";
  readonly reparse_inspection_complete: true;
  readonly reparse_points_encountered: 0;
  readonly inventory_complete: true;
  readonly regular_files_only: true;
}

export interface TrustedWindowsNativeHelperSourceSelectionV1 {
  readonly source_ref: string;
  readonly evidence: TrustedWindowsNativeHelperSourceEvidenceV1;
}

export interface TrustedWindowsNativeHelperOutputBoundaryV1 {
  readonly output_ref: string;
  readonly boundary: Readonly<Record<string, StrictJsonValue>>;
}

export interface TrustedWindowsNativeHelperPickOkV1 {
  readonly type: "pick_files_ok" | "pick_folder_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly sequence: number;
  readonly basket_session_ref: string;
  readonly controller_request_ref: string;
  readonly status: "selected" | "cancelled" | "failed";
  readonly selections?: readonly TrustedWindowsNativeHelperSourceSelectionV1[];
}

export interface TrustedWindowsNativeHelperDropSourcesOkV1 {
  readonly type: "drop_sources_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly sequence: number;
  readonly basket_session_ref: string;
  readonly controller_request_ref: string;
  readonly status: "selected" | "cancelled" | "failed";
  readonly selections?: readonly TrustedWindowsNativeHelperSourceSelectionV1[];
}

export interface TrustedWindowsNativeHelperResolveOutputOkV1 {
  readonly type: "resolve_output_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly sequence: number;
  readonly basket_session_ref: string;
  readonly controller_request_ref: string;
  readonly status: "resolved" | "cancelled" | "failed";
  readonly output?: TrustedWindowsNativeHelperOutputBoundaryV1;
}

export interface TrustedWindowsNativeHelperRevalidatedEvidenceV1 {
  readonly adapter_id: string;
  readonly adapter_build_sha256: string;
  readonly identity_comparison_mechanism: "windows_volume_serial_plus_file_id_128";
  readonly path_comparison_mechanism: "windows_compare_string_ordinal_ignore_case";
  readonly output: TrustedWindowsNativeHelperOutputBoundaryV1;
  readonly selections: readonly TrustedWindowsNativeHelperSourceSelectionV1[];
  readonly native_path_comparisons: Readonly<Record<string, StrictJsonValue>>;
}

export interface TrustedWindowsNativeHelperSourceFileReferenceV1 {
  readonly source_file_ref: string;
  readonly identity: TrustedWindowsNativeHelperIdentityV1;
}

export interface TrustedWindowsNativeHelperRevalidateStartOkV1 {
  readonly type: "revalidate_start_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly sequence: number;
  readonly basket_session_ref: string;
  readonly controller_request_ref: string;
  readonly status: "opened" | "rejected";
  readonly scope_ref?: string;
  readonly evidence?: TrustedWindowsNativeHelperRevalidatedEvidenceV1;
  readonly source_files?: readonly TrustedWindowsNativeHelperSourceFileReferenceV1[];
  readonly no_live_scope?: true;
}

export interface TrustedWindowsNativeHelperReleaseRevalidatedStartOkV1 {
  readonly type: "release_revalidated_start_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly sequence: number;
  readonly basket_session_ref: string;
  readonly controller_request_ref: string;
  readonly scope_ref: string;
  readonly status: "released";
}

export interface TrustedWindowsNativeHelperCreateRunOutputOkV1 {
  readonly type: "create_run_output_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly sequence: number;
  readonly scope_ref: string;
  readonly run_ref: string;
  readonly status: "created";
  readonly identity: TrustedWindowsNativeHelperIdentityV1;
}

export interface TrustedWindowsNativeHelperCreateOutputFileOkV1 {
  readonly type: "create_output_file_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly sequence: number;
  readonly scope_ref: string;
  readonly run_ref: string;
  readonly output_file_ref: string;
  readonly status: "created";
  readonly identity: TrustedWindowsNativeHelperIdentityV1;
}

export interface TrustedWindowsNativeHelperCancelRequestV1 {
  readonly type: "cancel";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly control_sequence: number;
  readonly target_request_ref: string;
}

export interface TrustedWindowsNativeHelperCancelOkV1 {
  readonly type: "cancel_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly control_sequence: number;
  readonly target_request_ref: string;
  readonly outcome: "requested";
}

export interface TrustedWindowsNativeHelperCloseRequestV1 {
  readonly type: "close";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly control_sequence: number;
}

export interface TrustedWindowsNativeHelperCloseOkV1 {
  readonly type: "close_ok";
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly control_sequence: number;
}

export interface TrustedWindowsNativeHelperErrorResponseV1 {
  readonly type: "error";
  readonly schema_version: 1;
  readonly session_ref: string | null;
  readonly request_ref: string | null;
  readonly sequence: number | null;
  readonly control_sequence: number | null;
  readonly code: TrustedWindowsNativeHelperErrorCodeV1;
}

export type TrustedWindowsNativeHelperRequestV1 =
  | TrustedWindowsNativeHelperHandshakeRequestV1
  | TrustedWindowsNativeHelperComparePathsRequestV1
  | TrustedWindowsNativeHelperPickFilesRequestV1
  | TrustedWindowsNativeHelperPickFolderRequestV1
  | TrustedWindowsNativeHelperDropSourcesRequestV1
  | TrustedWindowsNativeHelperResolveOutputRequestV1
  | TrustedWindowsNativeHelperRevalidateStartRequestV1
  | TrustedWindowsNativeHelperReleaseRevalidatedStartRequestV1
  | TrustedWindowsNativeHelperCreateRunOutputRequestV1
  | TrustedWindowsNativeHelperCreateOutputFileRequestV1
  | TrustedWindowsNativeHelperCancelRequestV1
  | TrustedWindowsNativeHelperCloseRequestV1;

export type TrustedWindowsNativeHelperResponseV1 =
  | TrustedWindowsNativeHelperHandshakeOkV1
  | TrustedWindowsNativeHelperComparePathsOkV1
  | TrustedWindowsNativeHelperPickOkV1
  | TrustedWindowsNativeHelperDropSourcesOkV1
  | TrustedWindowsNativeHelperResolveOutputOkV1
  | TrustedWindowsNativeHelperRevalidateStartOkV1
  | TrustedWindowsNativeHelperReleaseRevalidatedStartOkV1
  | TrustedWindowsNativeHelperCreateRunOutputOkV1
  | TrustedWindowsNativeHelperCreateOutputFileOkV1
  | TrustedWindowsNativeHelperCancelOkV1
  | TrustedWindowsNativeHelperCloseOkV1
  | TrustedWindowsNativeHelperErrorResponseV1;

type StrictJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly StrictJsonValue[]
  | { readonly [key: string]: StrictJsonValue };

export class TrustedWindowsNativeHelperProtocolParseError extends Error {
  constructor() {
    super("The trusted Windows helper returned invalid protocol data.");
    this.name = "TrustedWindowsNativeHelperProtocolParseError";
  }
}

function protocolParseError(): never {
  throw new TrustedWindowsNativeHelperProtocolParseError();
}

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

class StrictJsonParser {
  readonly #text: string;
  #offset = 0;

  constructor(text: string) {
    this.#text = text;
  }

  parse(): StrictJsonValue {
    this.#skipWhitespace();
    const value = this.#parseValue(0);
    this.#skipWhitespace();
    if (this.#offset !== this.#text.length) protocolParseError();
    return value;
  }

  #parseValue(depth: number): StrictJsonValue {
    if (depth > MAX_JSON_DEPTH) return protocolParseError();
    const token = this.#text[this.#offset];
    if (token === "{") return this.#parseObject(depth + 1);
    if (token === "[") return this.#parseArray(depth + 1);
    if (token === "\"") return this.#parseString();
    if (token === "t") return this.#parseLiteral("true", true);
    if (token === "f") return this.#parseLiteral("false", false);
    if (token === "n") return this.#parseLiteral("null", null);
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) {
      return this.#parseInteger();
    }
    return protocolParseError();
  }

  #parseObject(depth: number): StrictJsonValue {
    this.#offset += 1;
    this.#skipWhitespace();
    const output: Record<string, StrictJsonValue> = Object.create(null) as Record<string, StrictJsonValue>;
    const keys = new Set<string>();
    if (this.#consume("}")) return output;
    for (;;) {
      if (this.#text[this.#offset] !== "\"") return protocolParseError();
      const key = this.#parseString();
      if (keys.has(key)) return protocolParseError();
      keys.add(key);
      this.#skipWhitespace();
      if (!this.#consume(":")) return protocolParseError();
      this.#skipWhitespace();
      output[key] = this.#parseValue(depth);
      this.#skipWhitespace();
      if (this.#consume("}")) return output;
      if (!this.#consume(",")) return protocolParseError();
      this.#skipWhitespace();
    }
  }

  #parseArray(depth: number): StrictJsonValue {
    this.#offset += 1;
    this.#skipWhitespace();
    const output: StrictJsonValue[] = [];
    if (this.#consume("]")) return output;
    for (;;) {
      output.push(this.#parseValue(depth));
      this.#skipWhitespace();
      if (this.#consume("]")) return output;
      if (!this.#consume(",")) return protocolParseError();
      this.#skipWhitespace();
    }
  }

  #parseString(): string {
    const start = this.#offset;
    this.#offset += 1;
    let escaped = false;
    while (this.#offset < this.#text.length) {
      const character = this.#text[this.#offset];
      if (character === "\"" && !escaped) {
        this.#offset += 1;
        return this.#decodeString(this.#text.slice(start, this.#offset));
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        return protocolParseError();
      }
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      this.#offset += 1;
    }
    return protocolParseError();
  }

  #decodeString(serialized: string): string {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      return protocolParseError();
    }
    if (
      typeof value !== "string" ||
      value.length > MAX_PROTOCOL_STRING_CODE_UNITS ||
      !isUnicodeScalarString(value)
    ) return protocolParseError();
    return value;
  }

  #parseInteger(): number {
    const start = this.#offset;
    if (this.#text[this.#offset] === "-") this.#offset += 1;
    if (this.#text[this.#offset] === "0") this.#offset += 1;
    else this.#consumeDigits();
    const next = this.#text[this.#offset];
    if (next === "." || next === "e" || next === "E") return protocolParseError();
    const value = Number(this.#text.slice(start, this.#offset));
    if (!Number.isSafeInteger(value)) return protocolParseError();
    return value;
  }

  #consumeDigits(): void {
    const first = this.#text[this.#offset];
    if (first === undefined || first < "1" || first > "9") return protocolParseError();
    this.#offset += 1;
    for (;;) {
      const character = this.#text[this.#offset];
      if (character === undefined || character < "0" || character > "9") return;
      this.#offset += 1;
    }
  }

  #parseLiteral<T extends boolean | null>(serialized: string, value: T): T {
    if (!this.#text.startsWith(serialized, this.#offset)) return protocolParseError();
    this.#offset += serialized.length;
    return value;
  }

  #consume(expected: string): boolean {
    if (this.#text[this.#offset] !== expected) return false;
    this.#offset += 1;
    return true;
  }

  #skipWhitespace(): void {
    for (;;) {
      const character = this.#text[this.#offset];
      if (character !== " " && character !== "\t" && character !== "\r" && character !== "\n") return;
      this.#offset += 1;
    }
  }
}

function isRecord(
  value: StrictJsonValue | undefined,
): value is { readonly [key: string]: StrictJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrictJsonArray(
  value: StrictJsonValue | undefined,
): value is readonly StrictJsonValue[] {
  return Array.isArray(value);
}

function hasExactKeys(
  value: { readonly [key: string]: StrictJsonValue },
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    keys.every((key) => expected.includes(key)) &&
    expected.every((key) => Object.hasOwn(value, key));
}

function isPositiveSequence(value: StrictJsonValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isNullableSequence(value: StrictJsonValue | undefined): value is number | null {
  return value === null || isPositiveSequence(value);
}

function parseHandshakeOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperHandshakeOkV1 {
  const keys = [
    "type", "schema_version", "session_ref", "process_architecture",
    "build_identifier", "self_observed_image_sha256",
    "challenge_response_sha256", "capabilities",
  ] as const;
  if (!hasExactKeys(value, keys) ||
    value.schema_version !== TRUSTED_WINDOWS_NATIVE_HELPER_PROTOCOL_SCHEMA_VERSION_V1 ||
    typeof value.session_ref !== "string" || !SESSION_REF_PATTERN.test(value.session_ref) ||
    value.process_architecture !== "x86_64" ||
    value.build_identifier !== TRUSTED_WINDOWS_NATIVE_HELPER_BUILD_IDENTIFIER_V1 ||
    typeof value.self_observed_image_sha256 !== "string" ||
    !SHA256_PATTERN.test(value.self_observed_image_sha256) ||
    typeof value.challenge_response_sha256 !== "string" ||
    !SHA256_PATTERN.test(value.challenge_response_sha256) ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length !== TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1.length ||
    !value.capabilities.every((capability, index) =>
      capability === TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1[index])) {
    return protocolParseError();
  }
  return {
    type: "handshake_ok",
    schema_version: 1,
    session_ref: value.session_ref,
    process_architecture: "x86_64",
    build_identifier: TRUSTED_WINDOWS_NATIVE_HELPER_BUILD_IDENTIFIER_V1,
    self_observed_image_sha256: value.self_observed_image_sha256,
    challenge_response_sha256: value.challenge_response_sha256,
    capabilities: TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1,
  };
}

function parseComparePathsOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperComparePathsOkV1 {
  if (!hasExactKeys(value, [
    "type", "schema_version", "session_ref", "request_ref", "sequence", "relation",
  ]) || value.schema_version !== 1 ||
    typeof value.session_ref !== "string" || !SESSION_REF_PATTERN.test(value.session_ref) ||
    typeof value.request_ref !== "string" || !REQUEST_REF_PATTERN.test(value.request_ref) ||
    !isPositiveSequence(value.sequence) ||
    (value.relation !== "same" && value.relation !== "ancestor" &&
      value.relation !== "descendant" && value.relation !== "disjoint")) {
    return protocolParseError();
  }
  return {
    type: "compare_paths_ok", schema_version: 1,
    session_ref: value.session_ref, request_ref: value.request_ref,
    sequence: value.sequence, relation: value.relation,
  };
}

function isPrivateCanonicalPathCandidate(value: StrictJsonValue | undefined): value is string {
  return typeof value === "string" && value.length >= 3 &&
    value.length <= MAX_PROTOCOL_STRING_CODE_UNITS && /^[A-Z]:\\/u.test(value) &&
    !value.includes("/") && !value.includes("\0") &&
    !value.includes("\r") && !value.includes("\n");
}

function parseIdentity(
  value: StrictJsonValue | undefined,
): TrustedWindowsNativeHelperIdentityV1 {
  if (!isRecord(value) || !hasExactKeys(value, [
    "volume_serial_number_hex", "file_id_hex",
  ]) || typeof value.volume_serial_number_hex !== "string" ||
    !VOLUME_SERIAL_PATTERN.test(value.volume_serial_number_hex) ||
    typeof value.file_id_hex !== "string" || !FILE_ID_PATTERN.test(value.file_id_hex)) {
    return protocolParseError();
  }
  return {
    volume_serial_number_hex: value.volume_serial_number_hex,
    file_id_hex: value.file_id_hex,
  };
}

function parseLocalVolumeEvidence(
  value: StrictJsonValue | undefined,
  expectedVolumeSerial: string,
): TrustedWindowsNativeHelperLocalVolumeEvidenceV1 {
  const keys = [
    "opened_handle_file_type", "volume_path_resolution", "drive_type_query",
    "drive_type", "dos_device_query", "dos_device_mapping",
    "dos_device_alias_chain_detected", "subst_target_detected",
    "unc_redirector_detected", "network_device_target_detected",
    "opened_handle_volume_corroboration",
    "opened_handle_volume_serial_number_hex", "volume_root_handle_serial_number_hex",
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys) ||
    value.opened_handle_file_type !== "FILE_TYPE_DISK" ||
    value.volume_path_resolution !== "get_volume_path_name_w" ||
    value.drive_type_query !== "get_drive_type_w" ||
    (value.drive_type !== "DRIVE_FIXED" && value.drive_type !== "DRIVE_REMOVABLE") ||
    value.dos_device_query !== "query_dos_device_w" ||
    value.dos_device_mapping !== "direct_local_volume" ||
    value.dos_device_alias_chain_detected !== false ||
    value.subst_target_detected !== false || value.unc_redirector_detected !== false ||
    value.network_device_target_detected !== false ||
    value.opened_handle_volume_corroboration !==
      "file_id_info_volume_serial_matches_opened_volume_root_handle" ||
    value.opened_handle_volume_serial_number_hex !== expectedVolumeSerial ||
    value.volume_root_handle_serial_number_hex !== expectedVolumeSerial) {
    return protocolParseError();
  }
  return {
    opened_handle_file_type: "FILE_TYPE_DISK",
    volume_path_resolution: "get_volume_path_name_w",
    drive_type_query: "get_drive_type_w",
    drive_type: value.drive_type,
    dos_device_query: "query_dos_device_w",
    dos_device_mapping: "direct_local_volume",
    dos_device_alias_chain_detected: false,
    subst_target_detected: false,
    unc_redirector_detected: false,
    network_device_target_detected: false,
    opened_handle_volume_corroboration:
      "file_id_info_volume_serial_matches_opened_volume_root_handle",
    opened_handle_volume_serial_number_hex: expectedVolumeSerial,
    volume_root_handle_serial_number_hex: expectedVolumeSerial,
  };
}

function parseSourcePathEvidence(
  value: StrictJsonValue | undefined,
  expectedAcquisition: TrustedWindowsNativeHelperSourceAcquisitionV1 | null,
): TrustedWindowsNativeHelperSourcePathEvidenceV1 {
  const keys = [
    "acquisition", "canonicalization", "inspection_mode",
    "path_identity_checked_by_handle", "reparse_inspection_scope",
    "reparse_inspection_complete", "reparse_points_encountered",
    "inventory_complete", "regular_files_only",
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys) ||
    (value.acquisition !== "windows_native_picker_handle" &&
      value.acquisition !== "windows_native_drop_cfhdrop_then_handle_open") ||
    (expectedAcquisition !== null && value.acquisition !== expectedAcquisition) ||
    value.canonicalization !== "final_path_by_handle" ||
    value.inspection_mode !== "read_only" || value.path_identity_checked_by_handle !== true ||
    value.reparse_inspection_scope !== "volume_root_through_complete_selection" ||
    value.reparse_inspection_complete !== true || value.reparse_points_encountered !== 0 ||
    value.inventory_complete !== true || value.regular_files_only !== true) {
    return protocolParseError();
  }
  return {
    acquisition: value.acquisition,
    canonicalization: "final_path_by_handle",
    inspection_mode: "read_only",
    path_identity_checked_by_handle: true,
    reparse_inspection_scope: "volume_root_through_complete_selection",
    reparse_inspection_complete: true,
    reparse_points_encountered: 0,
    inventory_complete: true,
    regular_files_only: true,
  };
}

function parseOutputPathEvidence(
  value: StrictJsonValue | undefined,
): Readonly<Record<string, StrictJsonValue>> {
  const keys = [
    "acquisition", "canonicalization", "inspection_mode",
    "path_identity_checked_by_handle", "directory_type_checked_by_handle",
    "reparse_inspection_scope", "reparse_inspection_complete",
    "reparse_points_encountered",
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys) ||
    value.acquisition !== "windows_native_output_directory_handle" ||
    value.canonicalization !== "final_path_by_handle" ||
    value.inspection_mode !== "read_only" || value.path_identity_checked_by_handle !== true ||
    value.directory_type_checked_by_handle !== true ||
    value.reparse_inspection_scope !== "volume_root_through_output_directory" ||
    value.reparse_inspection_complete !== true || value.reparse_points_encountered !== 0) {
    return protocolParseError();
  }
  return { ...value };
}

function parseSourceSelection(
  value: StrictJsonValue,
  expectedAcquisition: TrustedWindowsNativeHelperSourceAcquisitionV1 | null = null,
): TrustedWindowsNativeHelperSourceSelectionV1 {
  if (!isRecord(value) || !hasExactKeys(value, ["source_ref", "evidence"]) ||
    typeof value.source_ref !== "string" || !SOURCE_REF_PATTERN.test(value.source_ref) ||
    !isRecord(value.evidence)) return protocolParseError();
  const evidence = value.evidence;
  if (!hasExactKeys(evidence, [
    "kind", "canonical_absolute_path", "resolved_absolute_path",
    "byte_count_decimal", "file_count", "identity", "inventory_file_identities",
    "path_evidence", "local_volume_evidence",
  ]) || (evidence.kind !== "file" && evidence.kind !== "directory") ||
    !isPrivateCanonicalPathCandidate(evidence.canonical_absolute_path) ||
    !isPrivateCanonicalPathCandidate(evidence.resolved_absolute_path) ||
    evidence.canonical_absolute_path !== evidence.resolved_absolute_path ||
    typeof evidence.byte_count_decimal !== "string" ||
    !BYTE_COUNT_PATTERN.test(evidence.byte_count_decimal) ||
    !isPositiveOrZeroInteger(evidence.file_count, 100_000) ||
    !Array.isArray(evidence.inventory_file_identities) ||
    evidence.inventory_file_identities.length !== evidence.file_count) {
    return protocolParseError();
  }
  const identity = parseIdentity(evidence.identity);
  const inventory = evidence.inventory_file_identities.map(parseIdentity);
  const identityKeys = new Set<string>();
  for (const item of inventory) {
    const key = `${item.volume_serial_number_hex}:${item.file_id_hex}`;
    if (item.volume_serial_number_hex !== identity.volume_serial_number_hex ||
      identityKeys.has(key)) return protocolParseError();
    identityKeys.add(key);
  }
  if (evidence.kind === "file" && (evidence.file_count !== 1 ||
    inventory[0]?.volume_serial_number_hex !== identity.volume_serial_number_hex ||
    inventory[0]?.file_id_hex !== identity.file_id_hex)) return protocolParseError();
  return {
    source_ref: value.source_ref,
    evidence: {
      kind: evidence.kind,
      canonical_absolute_path: evidence.canonical_absolute_path,
      resolved_absolute_path: evidence.resolved_absolute_path,
      byte_count_decimal: evidence.byte_count_decimal,
      file_count: evidence.file_count,
      identity,
      inventory_file_identities: inventory,
      path_evidence: parseSourcePathEvidence(evidence.path_evidence, expectedAcquisition),
      local_volume_evidence: parseLocalVolumeEvidence(
        evidence.local_volume_evidence,
        identity.volume_serial_number_hex,
      ),
    },
  };
}

function isPositiveOrZeroInteger(
  value: StrictJsonValue | undefined,
  maximum: number,
): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 0 && value <= maximum && !Object.is(value, -0);
}

function parseOutputBoundary(
  value: StrictJsonValue | undefined,
): TrustedWindowsNativeHelperOutputBoundaryV1 {
  if (!isRecord(value) || !hasExactKeys(value, ["output_ref", "boundary"]) ||
    typeof value.output_ref !== "string" || !OUTPUT_REF_PATTERN.test(value.output_ref) ||
    !isRecord(value.boundary)) return protocolParseError();
  const boundary = value.boundary;
  if (!hasExactKeys(boundary, [
    "kind", "canonical_absolute_path", "resolved_absolute_path", "identity",
    "path_evidence", "local_volume_evidence",
  ]) || boundary.kind !== "directory" ||
    !isPrivateCanonicalPathCandidate(boundary.canonical_absolute_path) ||
    !isPrivateCanonicalPathCandidate(boundary.resolved_absolute_path) ||
    boundary.canonical_absolute_path !== boundary.resolved_absolute_path) {
    return protocolParseError();
  }
  const identity = parseIdentity(boundary.identity);
  return {
    output_ref: value.output_ref,
    boundary: {
      kind: "directory",
      canonical_absolute_path: boundary.canonical_absolute_path,
      resolved_absolute_path: boundary.resolved_absolute_path,
      identity,
      path_evidence: parseOutputPathEvidence(boundary.path_evidence),
      local_volume_evidence: parseLocalVolumeEvidence(
        boundary.local_volume_evidence,
        identity.volume_serial_number_hex,
      ),
    },
  };
}

function parseAdapterWorkBinding(
  value: { readonly [key: string]: StrictJsonValue },
  controllerPattern: RegExp,
): void {
  if (value.schema_version !== 1 || typeof value.session_ref !== "string" ||
    !SESSION_REF_PATTERN.test(value.session_ref) || typeof value.request_ref !== "string" ||
    !REQUEST_REF_PATTERN.test(value.request_ref) || !isPositiveSequence(value.sequence) ||
    typeof value.basket_session_ref !== "string" ||
    !BASKET_SESSION_REF_PATTERN.test(value.basket_session_ref) ||
    typeof value.controller_request_ref !== "string" ||
    !controllerPattern.test(value.controller_request_ref)) protocolParseError();
}

function parsePickOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperPickOkV1 {
  const selected = value.status === "selected";
  if (!hasExactKeys(value, selected ? [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "basket_session_ref", "controller_request_ref", "status", "selections",
  ] : [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "basket_session_ref", "controller_request_ref", "status",
  ]) || (value.type !== "pick_files_ok" && value.type !== "pick_folder_ok") ||
    (value.status !== "selected" && value.status !== "cancelled" && value.status !== "failed")) {
    return protocolParseError();
  }
  parseAdapterWorkBinding(value, NATIVE_REQUEST_REF_PATTERN);
  if (!selected) {
    return {
      type: value.type,
      schema_version: 1,
      session_ref: value.session_ref as string,
      request_ref: value.request_ref as string,
      sequence: value.sequence as number,
      basket_session_ref: value.basket_session_ref as string,
      controller_request_ref: value.controller_request_ref as string,
      status: value.status as "cancelled" | "failed",
    };
  }
  if (!isStrictJsonArray(value.selections) || value.selections.length < 1 ||
    value.selections.length > 128) return protocolParseError();
  const selections = value.selections.map((selection) =>
    parseSourceSelection(selection, "windows_native_picker_handle"));
  if ((value.type === "pick_folder_ok" && selections.length !== 1) ||
    selections.some((selection) => selection.evidence.kind !==
      (value.type === "pick_files_ok" ? "file" : "directory"))) return protocolParseError();
  return {
    type: value.type,
    schema_version: 1,
    session_ref: value.session_ref as string,
    request_ref: value.request_ref as string,
    sequence: value.sequence as number,
    basket_session_ref: value.basket_session_ref as string,
    controller_request_ref: value.controller_request_ref as string,
    status: "selected",
    selections,
  };
}

function parseDropSourcesOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperDropSourcesOkV1 {
  const selected = value.status === "selected";
  if (!hasExactKeys(value, selected ? [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "basket_session_ref", "controller_request_ref", "status", "selections",
  ] : [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "basket_session_ref", "controller_request_ref", "status",
  ]) || value.type !== "drop_sources_ok" ||
    (value.status !== "selected" && value.status !== "cancelled" &&
      value.status !== "failed")) return protocolParseError();
  parseAdapterWorkBinding(value, NATIVE_REQUEST_REF_PATTERN);
  const base = {
    type: "drop_sources_ok" as const,
    schema_version: 1 as const,
    session_ref: value.session_ref as string,
    request_ref: value.request_ref as string,
    sequence: value.sequence as number,
    basket_session_ref: value.basket_session_ref as string,
    controller_request_ref: value.controller_request_ref as string,
  };
  if (!selected) {
    return { ...base, status: value.status as "cancelled" | "failed" };
  }
  if (!isStrictJsonArray(value.selections) || value.selections.length < 1 ||
    value.selections.length > 128) return protocolParseError();
  return {
    ...base,
    status: "selected",
    selections: value.selections.map((selection) => parseSourceSelection(
      selection,
      "windows_native_drop_cfhdrop_then_handle_open",
    )),
  };
}

function parseResolveOutputOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperResolveOutputOkV1 {
  const resolved = value.status === "resolved";
  if (!hasExactKeys(value, resolved ? [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "basket_session_ref", "controller_request_ref", "status", "output",
  ] : [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "basket_session_ref", "controller_request_ref", "status",
  ]) || value.type !== "resolve_output_ok" ||
    (value.status !== "resolved" && value.status !== "cancelled" &&
      value.status !== "failed")) return protocolParseError();
  parseAdapterWorkBinding(value, NATIVE_REQUEST_REF_PATTERN);
  const base = {
    type: "resolve_output_ok" as const,
    schema_version: 1 as const,
    session_ref: value.session_ref as string,
    request_ref: value.request_ref as string,
    sequence: value.sequence as number,
    basket_session_ref: value.basket_session_ref as string,
    controller_request_ref: value.controller_request_ref as string,
  };
  return resolved
    ? { ...base, status: "resolved", output: parseOutputBoundary(value.output) }
    : { ...base, status: value.status as "cancelled" | "failed" };
}

function parseNativePathComparisons(
  value: StrictJsonValue | undefined,
): Readonly<Record<string, StrictJsonValue>> {
  if (!isRecord(value) || !hasExactKeys(value, ["source_pairs", "output_pairs"]) ||
    !isStrictJsonArray(value.source_pairs) || !isStrictJsonArray(value.output_pairs) ||
    value.source_pairs.length > 8_128 || value.output_pairs.length > 128) {
    return protocolParseError();
  }
  const sourcePairs = value.source_pairs;
  const outputPairs = value.output_pairs;
  for (const pair of sourcePairs) {
    if (!isRecord(pair) || !hasExactKeys(pair, [
      "left_selection_index", "right_selection_index", "relation",
    ]) || !isPositiveSequence(pair.left_selection_index) ||
      !isPositiveSequence(pair.right_selection_index) || pair.relation !== "disjoint") {
      return protocolParseError();
    }
  }
  for (const pair of outputPairs) {
    if (!isRecord(pair) || !hasExactKeys(pair, ["selection_index", "relation"]) ||
      !isPositiveSequence(pair.selection_index) || pair.relation !== "disjoint") {
      return protocolParseError();
    }
  }
  return {
    source_pairs: sourcePairs.map((pair) => ({
      ...(pair as Record<string, StrictJsonValue>),
    })),
    output_pairs: outputPairs.map((pair) => ({
      ...(pair as Record<string, StrictJsonValue>),
    })),
  };
}

function parseRevalidateStartOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperRevalidateStartOkV1 {
  const opened = value.status === "opened";
  if (!hasExactKeys(value, opened ? [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "basket_session_ref", "controller_request_ref", "status", "scope_ref",
    "evidence", "source_files",
  ] : [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "basket_session_ref", "controller_request_ref", "status", "no_live_scope",
  ]) || value.type !== "revalidate_start_ok" ||
    (value.status !== "opened" && value.status !== "rejected")) return protocolParseError();
  parseAdapterWorkBinding(value, REVALIDATED_REQUEST_REF_PATTERN);
  const base = {
    type: "revalidate_start_ok" as const,
    schema_version: 1 as const,
    session_ref: value.session_ref as string,
    request_ref: value.request_ref as string,
    sequence: value.sequence as number,
    basket_session_ref: value.basket_session_ref as string,
    controller_request_ref: value.controller_request_ref as string,
  };
  if (!opened) {
    if (value.no_live_scope !== true) return protocolParseError();
    return { ...base, status: "rejected", no_live_scope: true };
  }
  if (typeof value.scope_ref !== "string" || !SCOPE_REF_PATTERN.test(value.scope_ref) ||
    !isRecord(value.evidence) || !hasExactKeys(value.evidence, [
      "adapter_id", "adapter_build_sha256", "identity_comparison_mechanism",
      "path_comparison_mechanism", "output", "selections", "native_path_comparisons",
    ]) || typeof value.evidence.adapter_id !== "string" ||
    !ADAPTER_ID_PATTERN.test(value.evidence.adapter_id) ||
    typeof value.evidence.adapter_build_sha256 !== "string" ||
    !SHA256_PATTERN.test(value.evidence.adapter_build_sha256) ||
    value.evidence.identity_comparison_mechanism !==
      "windows_volume_serial_plus_file_id_128" ||
    value.evidence.path_comparison_mechanism !==
      "windows_compare_string_ordinal_ignore_case" ||
    !isStrictJsonArray(value.evidence.selections) || value.evidence.selections.length < 1 ||
    value.evidence.selections.length > 128 || !isStrictJsonArray(value.source_files) ||
    value.source_files.length > 100_000) return protocolParseError();
  const evidence: TrustedWindowsNativeHelperRevalidatedEvidenceV1 = {
    adapter_id: value.evidence.adapter_id,
    adapter_build_sha256: value.evidence.adapter_build_sha256,
    identity_comparison_mechanism: "windows_volume_serial_plus_file_id_128",
    path_comparison_mechanism: "windows_compare_string_ordinal_ignore_case",
    output: parseOutputBoundary(value.evidence.output),
    selections: value.evidence.selections.map((selection) =>
      parseSourceSelection(selection)),
    native_path_comparisons: parseNativePathComparisons(
      value.evidence.native_path_comparisons,
    ),
  };
  const sourceFiles = value.source_files.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, ["source_file_ref", "identity"]) ||
      typeof item.source_file_ref !== "string" ||
      !SOURCE_FILE_REF_PATTERN.test(item.source_file_ref)) return protocolParseError();
    return { source_file_ref: item.source_file_ref, identity: parseIdentity(item.identity) };
  });
  if (new Set(sourceFiles.map((item) => item.source_file_ref)).size !== sourceFiles.length) {
    return protocolParseError();
  }
  return {
    ...base,
    status: "opened",
    scope_ref: value.scope_ref,
    evidence,
    source_files: sourceFiles,
  };
}

function parseReleaseRevalidatedStartOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperReleaseRevalidatedStartOkV1 {
  if (!hasExactKeys(value, [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "basket_session_ref", "controller_request_ref", "scope_ref", "status",
  ]) || value.type !== "release_revalidated_start_ok" || value.status !== "released" ||
    typeof value.scope_ref !== "string" || !SCOPE_REF_PATTERN.test(value.scope_ref)) {
    return protocolParseError();
  }
  parseAdapterWorkBinding(value, REVALIDATED_REQUEST_REF_PATTERN);
  return {
    type: "release_revalidated_start_ok",
    schema_version: 1,
    session_ref: value.session_ref as string,
    request_ref: value.request_ref as string,
    sequence: value.sequence as number,
    basket_session_ref: value.basket_session_ref as string,
    controller_request_ref: value.controller_request_ref as string,
    scope_ref: value.scope_ref,
    status: "released",
  };
}

function parseCreateRunOutputOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperCreateRunOutputOkV1 {
  if (!hasExactKeys(value, [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "scope_ref", "run_ref", "status", "identity",
  ]) || value.type !== "create_run_output_ok" || value.schema_version !== 1 ||
    typeof value.session_ref !== "string" || !SESSION_REF_PATTERN.test(value.session_ref) ||
    typeof value.request_ref !== "string" || !REQUEST_REF_PATTERN.test(value.request_ref) ||
    !isPositiveSequence(value.sequence) || typeof value.scope_ref !== "string" ||
    !SCOPE_REF_PATTERN.test(value.scope_ref) || typeof value.run_ref !== "string" ||
    !RUN_REF_PATTERN.test(value.run_ref) || value.status !== "created") {
    return protocolParseError();
  }
  return {
    type: "create_run_output_ok", schema_version: 1,
    session_ref: value.session_ref, request_ref: value.request_ref,
    sequence: value.sequence, scope_ref: value.scope_ref, run_ref: value.run_ref,
    status: "created", identity: parseIdentity(value.identity),
  };
}

function parseCreateOutputFileOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperCreateOutputFileOkV1 {
  if (!hasExactKeys(value, [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "scope_ref", "run_ref", "output_file_ref", "status", "identity",
  ]) || value.type !== "create_output_file_ok" || value.schema_version !== 1 ||
    typeof value.session_ref !== "string" || !SESSION_REF_PATTERN.test(value.session_ref) ||
    typeof value.request_ref !== "string" || !REQUEST_REF_PATTERN.test(value.request_ref) ||
    !isPositiveSequence(value.sequence) || typeof value.scope_ref !== "string" ||
    !SCOPE_REF_PATTERN.test(value.scope_ref) || typeof value.run_ref !== "string" ||
    !RUN_REF_PATTERN.test(value.run_ref) || typeof value.output_file_ref !== "string" ||
    !OUTPUT_FILE_REF_PATTERN.test(value.output_file_ref) || value.status !== "created") {
    return protocolParseError();
  }
  return {
    type: "create_output_file_ok", schema_version: 1,
    session_ref: value.session_ref, request_ref: value.request_ref,
    sequence: value.sequence, scope_ref: value.scope_ref, run_ref: value.run_ref,
    output_file_ref: value.output_file_ref, status: "created",
    identity: parseIdentity(value.identity),
  };
}

function parseCancelOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperCancelOkV1 {
  if (!hasExactKeys(value, [
    "type", "schema_version", "session_ref", "request_ref", "control_sequence",
    "target_request_ref", "outcome",
  ]) || value.schema_version !== 1 ||
    typeof value.session_ref !== "string" || !SESSION_REF_PATTERN.test(value.session_ref) ||
    typeof value.request_ref !== "string" || !REQUEST_REF_PATTERN.test(value.request_ref) ||
    !isPositiveSequence(value.control_sequence) ||
    typeof value.target_request_ref !== "string" ||
    !REQUEST_REF_PATTERN.test(value.target_request_ref) || value.outcome !== "requested") {
    return protocolParseError();
  }
  return {
    type: "cancel_ok", schema_version: 1, session_ref: value.session_ref,
    request_ref: value.request_ref, control_sequence: value.control_sequence,
    target_request_ref: value.target_request_ref, outcome: "requested",
  };
}

function parseCloseOk(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperCloseOkV1 {
  if (!hasExactKeys(value, [
    "type", "schema_version", "session_ref", "request_ref", "control_sequence",
  ]) || value.schema_version !== 1 ||
    typeof value.session_ref !== "string" || !SESSION_REF_PATTERN.test(value.session_ref) ||
    typeof value.request_ref !== "string" || !REQUEST_REF_PATTERN.test(value.request_ref) ||
    !isPositiveSequence(value.control_sequence)) return protocolParseError();
  return {
    type: "close_ok", schema_version: 1, session_ref: value.session_ref,
    request_ref: value.request_ref, control_sequence: value.control_sequence,
  };
}

function parseErrorResponse(
  value: { readonly [key: string]: StrictJsonValue },
): TrustedWindowsNativeHelperErrorResponseV1 {
  if (!hasExactKeys(value, [
    "type", "schema_version", "session_ref", "request_ref", "sequence",
    "control_sequence", "code",
  ]) || value.schema_version !== 1 ||
    (value.session_ref !== null &&
      (typeof value.session_ref !== "string" || !SESSION_REF_PATTERN.test(value.session_ref))) ||
    (value.request_ref !== null &&
      (typeof value.request_ref !== "string" || !REQUEST_REF_PATTERN.test(value.request_ref))) ||
    !isNullableSequence(value.sequence) || !isNullableSequence(value.control_sequence) ||
    typeof value.code !== "string" ||
    !TRUSTED_WINDOWS_NATIVE_HELPER_ERROR_CODES_V1.includes(
      value.code as TrustedWindowsNativeHelperErrorCodeV1,
    )) return protocolParseError();
  const hasWorkSequence = value.sequence !== null;
  const hasControlSequence = value.control_sequence !== null;
  const isBound = value.request_ref !== null;
  if ((isBound && value.session_ref === null) ||
    (isBound && hasWorkSequence === hasControlSequence) ||
    (!isBound && (hasWorkSequence || hasControlSequence))) return protocolParseError();
  return {
    type: "error", schema_version: 1, session_ref: value.session_ref,
    request_ref: value.request_ref, sequence: value.sequence,
    control_sequence: value.control_sequence,
    code: value.code as TrustedWindowsNativeHelperErrorCodeV1,
  };
}

export function parseTrustedWindowsNativeHelperResponseV1(
  serialized: string,
): TrustedWindowsNativeHelperResponseV1 {
  const value = new StrictJsonParser(serialized).parse();
  if (!isRecord(value) || typeof value.type !== "string") return protocolParseError();
  if (value.type === "handshake_ok") return parseHandshakeOk(value);
  if (value.type === "pick_files_ok" || value.type === "pick_folder_ok") {
    return parsePickOk(value);
  }
  if (value.type === "drop_sources_ok") return parseDropSourcesOk(value);
  if (value.type === "resolve_output_ok") return parseResolveOutputOk(value);
  if (value.type === "compare_paths_ok") return parseComparePathsOk(value);
  if (value.type === "revalidate_start_ok") return parseRevalidateStartOk(value);
  if (value.type === "release_revalidated_start_ok") {
    return parseReleaseRevalidatedStartOk(value);
  }
  if (value.type === "create_run_output_ok") return parseCreateRunOutputOk(value);
  if (value.type === "create_output_file_ok") return parseCreateOutputFileOk(value);
  if (value.type === "cancel_ok") return parseCancelOk(value);
  if (value.type === "close_ok") return parseCloseOk(value);
  if (value.type === "error") return parseErrorResponse(value);
  return protocolParseError();
}

export function deriveTrustedWindowsNativeHelperChallengeResponseV1(input: {
  readonly challengeHex: string;
  readonly expectedHelperSha256: string;
}): string {
  if (!HEX_32_PATTERN.test(input.challengeHex) ||
    !SHA256_PATTERN.test(input.expectedHelperSha256)) return protocolParseError();
  const hash = createHash("sha256");
  hash.update(TRUSTED_WINDOWS_NATIVE_HELPER_HANDSHAKE_DOMAIN_V1, "ascii");
  hash.update(Buffer.from([0]));
  hash.update(Buffer.from(input.challengeHex, "hex"));
  hash.update(Buffer.from([0]));
  hash.update(input.expectedHelperSha256, "ascii");
  hash.update(Buffer.from([0]));
  hash.update(TRUSTED_WINDOWS_NATIVE_HELPER_BUILD_IDENTIFIER_V1, "ascii");
  return `sha256:${hash.digest("hex")}`;
}

export function isTrustedWindowsNativeHelperSha256V1(value: string): boolean {
  return SHA256_PATTERN.test(value);
}

export function isTrustedWindowsNativeHelperSessionRefV1(value: string): boolean {
  return SESSION_REF_PATTERN.test(value);
}

export function isTrustedWindowsNativeHelperRequestRefV1(value: string): boolean {
  return REQUEST_REF_PATTERN.test(value);
}

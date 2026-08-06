import {
  spawn,
  type SpawnOptionsWithStdioTuple,
} from "node:child_process";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { Readable, Writable } from "node:stream";
import { TextDecoder } from "node:util";
import {
  TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1,
  TRUSTED_WINDOWS_NATIVE_HELPER_PROTOCOL_SCHEMA_VERSION_V1,
  deriveTrustedWindowsNativeHelperChallengeResponseV1,
  isTrustedWindowsNativeHelperRequestRefV1,
  isTrustedWindowsNativeHelperSessionRefV1,
  isTrustedWindowsNativeHelperSha256V1,
  parseTrustedWindowsNativeHelperResponseV1,
  type TrustedWindowsNativeHelperCancelRequestV1,
  type TrustedWindowsNativeHelperCloseRequestV1,
  type TrustedWindowsNativeHelperComparePathsRequestV1,
  type TrustedWindowsNativeHelperCreateOutputFileRequestV1,
  type TrustedWindowsNativeHelperCreateRunOutputRequestV1,
  type TrustedWindowsNativeHelperDropSourcesRequestV1,
  type TrustedWindowsNativeHelperHandshakeRequestV1,
  type TrustedWindowsNativeHelperPathRelationV1,
  type TrustedWindowsNativeHelperPickFilesRequestV1,
  type TrustedWindowsNativeHelperPickFolderRequestV1,
  type TrustedWindowsNativeHelperReleaseRevalidatedStartRequestV1,
  type TrustedWindowsNativeHelperResolveOutputRequestV1,
  type TrustedWindowsNativeHelperRevalidateStartRequestV1,
  type TrustedWindowsNativeHelperRequestV1,
  type TrustedWindowsNativeHelperResponseV1,
} from "./trusted-windows-native-source-helper-protocol.js";

const HANDSHAKE_TIMEOUT_MS = 10_000;
const OPERATION_TIMEOUT_MS = 5_000;
const PICKER_OR_REVALIDATION_TIMEOUT_MS = 4 * 60 * 60 * 1_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_HANDSHAKE_OR_CONTROL_REQUEST_BYTES = 64 * 1_024;
const MAX_WORK_REQUEST_BYTES = 1 * 1_024 * 1_024;
const MAX_HELPER_RESPONSE_BYTES = 32 * 1_024 * 1_024;
const MAX_HELPER_STDERR_BYTES = 64 * 1_024;
const MAX_PRIVATE_PATH_UTF16_UNITS = 32_767;
const MAX_EXECUTABLE_PATH_UTF16_UNITS = 32_767;
const MAX_OUTPUT_COMPONENT_UTF16_UNITS = 255;
const OPAQUE_REFERENCE_ATTEMPTS = 8;
const BASKET_SESSION_REF = /^basket_(?!0{32}$)[a-f0-9]{32}$/u;
const NATIVE_REQUEST_REF = /^native_request_(?!0{32}$)[a-f0-9]{32}$/u;
const NATIVE_COMPARE_REF = /^native_compare_(?!0{32}$)[a-f0-9]{32}$/u;
const REVALIDATED_START_REF = /^revalidated_start_(?!0{32}$)[a-f0-9]{32}$/u;
const SOURCE_REF = /^helper_source_(?!0{32}$)[a-f0-9]{32}$/u;
const OUTPUT_REF = /^helper_output_(?!0{32}$)[a-f0-9]{32}$/u;
const SCOPE_REF = /^helper_scope_(?!0{32}$)[a-f0-9]{32}$/u;
const RUN_REF = /^helper_run_(?!0{32}$)[a-f0-9]{32}$/u;
const OUTPUT_FILE_REF = /^helper_output_file_(?!0{32}$)[a-f0-9]{32}$/u;
const ADAPTER_ID = /^[a-z0-9][a-z0-9._-]{2,95}$/u;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
] as const);

export type TrustedWindowsNativeHelperBridgeErrorCodeV1 =
  | "INVALID_TRUSTED_CONFIGURATION"
  | "HELPER_VERIFICATION_FAILED"
  | "HELPER_UNAVAILABLE"
  | "HANDSHAKE_FAILED"
  | "PROTOCOL_FAILURE"
  | "OPERATION_FAILED"
  | "OPERATION_BUSY"
  | "NO_ACTIVE_OPERATION"
  | "OPERATION_CANCELLED"
  | "HELPER_CLOSED"
  | "DEADLINE_EXCEEDED"
  | "HELPER_TEARDOWN_UNCONFIRMED";

const SAFE_BRIDGE_ERROR_MESSAGES: Readonly<
  Record<TrustedWindowsNativeHelperBridgeErrorCodeV1, string>
> = Object.freeze({
  INVALID_TRUSTED_CONFIGURATION:
    "The trusted local helper configuration is invalid.",
  HELPER_VERIFICATION_FAILED:
    "The trusted local helper could not be verified.",
  HELPER_UNAVAILABLE:
    "The trusted local helper is unavailable.",
  HANDSHAKE_FAILED:
    "The trusted local helper could not establish a private session.",
  PROTOCOL_FAILURE:
    "The trusted local helper returned invalid private protocol data.",
  OPERATION_FAILED:
    "The trusted local helper could not complete that request.",
  OPERATION_BUSY:
    "The trusted local helper is already working on another request.",
  NO_ACTIVE_OPERATION:
    "There is no active local helper request to stop.",
  OPERATION_CANCELLED:
    "The trusted local helper request was stopped.",
  HELPER_CLOSED:
    "The trusted local helper session is closed.",
  DEADLINE_EXCEEDED:
    "The trusted local helper did not respond in time.",
  HELPER_TEARDOWN_UNCONFIRMED:
    "The trusted local helper process could not be confirmed stopped.",
});

const INTERNAL_BRIDGE_ERROR_CODES = new WeakMap<
  object,
  TrustedWindowsNativeHelperBridgeErrorCodeV1
>();

export class TrustedWindowsNativeHelperBridgeErrorV1 extends Error {
  readonly code: TrustedWindowsNativeHelperBridgeErrorCodeV1;

  constructor(code: TrustedWindowsNativeHelperBridgeErrorCodeV1) {
    super(SAFE_BRIDGE_ERROR_MESSAGES[code]);
    this.name = "TrustedWindowsNativeHelperBridgeErrorV1";
    this.code = code;
  }
}

export interface TrustedWindowsNativeHelperBridgeConfigurationV1 {
  /** Trusted launcher configuration only. It must never originate in a browser request. */
  readonly executablePath: string;
  /** Exact digest pinned by the trusted release manifest. */
  readonly expectedExecutableSha256: string;
}

export interface TrustedWindowsNativeHelperCompareInputV1 {
  /** Private canonical path accepted only from the native controller. */
  readonly leftCanonicalAbsolutePath: string;
  /** Private canonical path accepted only from the native controller. */
  readonly rightCanonicalAbsolutePath: string;
}

export interface TrustedWindowsNativeHelperCompareResultV1 {
  readonly relation: TrustedWindowsNativeHelperPathRelationV1;
  readonly comparisonAuthority: "windows_compare_string_ordinal_ignore_case";
}

export const TRUSTED_WINDOWS_NATIVE_HELPER_PROCESS_BRIDGE_UNRESOLVED_GAPS_V1 =
  Object.freeze([
    "Source-byte reads and output-byte writes are unavailable until dedicated inherited, bounded, back-pressured binary pipes are implemented end to end.",
    "Cancel is not advertised because the helper's current synchronous stdin loop cannot process a control frame while a picker or enumeration is in flight; close falls back to exact-child forced termination after the grace period.",
    "The Node pathname launch verifies checkpoint bytes but is not a race-resistant signed or protected executable-authenticity boundary.",
  ] as const);

interface TrustedWindowsNativeAdapterHelperRequestBaseV1 {
  readonly schema_version: 1;
  readonly session_ref: string;
  readonly basket_session_ref: string;
  readonly request_ref: string;
}

export interface TrustedWindowsNativeAdapterHelperPickRequestV1
  extends TrustedWindowsNativeAdapterHelperRequestBaseV1 {
  readonly operation: "pick_files" | "pick_folder";
  readonly read_only: true;
  readonly browser_path_input_accepted: false;
}

export interface TrustedWindowsNativeAdapterHelperDropSourcesRequestV1
  extends TrustedWindowsNativeAdapterHelperRequestBaseV1 {
  readonly operation: "drop_sources";
  readonly read_only: true;
  readonly browser_path_input_accepted: false;
}

export interface TrustedWindowsNativeAdapterHelperResolveOutputRequestV1
  extends TrustedWindowsNativeAdapterHelperRequestBaseV1 {
  readonly operation: "resolve_output";
  readonly read_only: true;
  readonly browser_path_input_accepted: false;
}

export interface TrustedWindowsNativeAdapterHelperComparePathsRequestV1
  extends TrustedWindowsNativeAdapterHelperRequestBaseV1 {
  readonly operation: "compare_paths";
  readonly left_canonical_absolute_path: string;
  readonly right_canonical_absolute_path: string;
  readonly read_only: true;
}

export interface TrustedWindowsNativeAdapterHelperRevalidateStartRequestV1
  extends TrustedWindowsNativeAdapterHelperRequestBaseV1 {
  readonly operation: "revalidate_start";
  readonly adapter_id: string;
  readonly adapter_build_sha256: string;
  readonly expected_source_refs: readonly string[];
  readonly expected_output_ref: string;
  readonly read_only: true;
  readonly browser_path_input_accepted: false;
}

export interface TrustedWindowsNativeAdapterHelperReleaseRequestV1
  extends TrustedWindowsNativeAdapterHelperRequestBaseV1 {
  readonly operation: "release_revalidated_start";
  readonly scope_ref: string;
}

export interface TrustedWindowsNativeHelperCreateRunResultV1 {
  readonly scope_ref: string;
  readonly run_ref: string;
  readonly identity: {
    readonly volume_serial_number_hex: string;
    readonly file_id_hex: string;
  };
}

export interface TrustedWindowsNativeHelperCreateOutputFileInputV1 {
  readonly component: string;
}

export interface TrustedWindowsNativeHelperCreateOutputFileResultV1 {
  readonly scope_ref: string;
  readonly run_ref: string;
  readonly output_file_ref: string;
  readonly identity: {
    readonly volume_serial_number_hex: string;
    readonly file_id_hex: string;
  };
}

export interface TrustedWindowsNativeHelperBrowserFailureV1 {
  readonly status: "cancelled" | "failed";
  readonly code:
    | "LOCAL_SELECTION_CANCELLED"
    | "LOCAL_SELECTION_BUSY"
    | "LOCAL_SELECTION_UNAVAILABLE";
  readonly message: string;
}

export interface TrustedWindowsNativeHelperProcessBridgeV1 {
  readonly session_ref: string;
  readonly capabilities: readonly string[];
  pick_files(request: TrustedWindowsNativeAdapterHelperPickRequestV1): Promise<unknown>;
  pick_folder(request: TrustedWindowsNativeAdapterHelperPickRequestV1): Promise<unknown>;
  drop_sources(
    request: TrustedWindowsNativeAdapterHelperDropSourcesRequestV1,
  ): Promise<unknown>;
  resolve_output(
    request: TrustedWindowsNativeAdapterHelperResolveOutputRequestV1,
  ): Promise<unknown>;
  compare_paths(
    request: TrustedWindowsNativeAdapterHelperComparePathsRequestV1,
  ): Promise<unknown>;
  revalidate_start(
    request: TrustedWindowsNativeAdapterHelperRevalidateStartRequestV1,
  ): Promise<unknown>;
  release_revalidated_start(
    request: TrustedWindowsNativeAdapterHelperReleaseRequestV1,
  ): Promise<unknown>;
  create_run_output(): Promise<TrustedWindowsNativeHelperCreateRunResultV1>;
  create_output_file(
    input: TrustedWindowsNativeHelperCreateOutputFileInputV1,
  ): Promise<TrustedWindowsNativeHelperCreateOutputFileResultV1>;
  compareCanonicalPaths(
    input: TrustedWindowsNativeHelperCompareInputV1,
  ): Promise<TrustedWindowsNativeHelperCompareResultV1>;
  /** Preserves graceful shutdown/protocol failures for trusted diagnostics. */
  close(): Promise<void>;
  /** Resolves once the exact child exit proves that no process-owned scopes remain. */
  close_and_confirm_no_live_scopes(): Promise<void>;
  /** Resolves only after the exact child process has emitted its close event. */
  waitForConfirmedExit(): Promise<void>;
}

interface NativeHelperChildProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

type NativeHelperSpawnOptions = SpawnOptionsWithStdioTuple<"pipe", "pipe", "pipe"> & {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly shell: false;
  readonly windowsHide: true;
  readonly detached: false;
};

export type TrustedWindowsNativeHelperChildFactoryV1 = (
  command: string,
  args: readonly string[],
  options: NativeHelperSpawnOptions,
) => NativeHelperChildProcess;

type BridgeState = "handshaking" | "ready" | "closing" | "closed" | "failed";
type ResponseChannel = "work" | "control";
type ExpectedResponseType =
  | "pick_files_ok"
  | "pick_folder_ok"
  | "drop_sources_ok"
  | "resolve_output_ok"
  | "compare_paths_ok"
  | "revalidate_start_ok"
  | "release_revalidated_start_ok"
  | "create_run_output_ok"
  | "create_output_file_ok"
  | "cancel_ok"
  | "close_ok";

interface PendingResponse {
  readonly channel: ResponseChannel;
  readonly requestRef: string;
  readonly sequence: number;
  readonly expectedType: ExpectedResponseType;
  readonly resolve: (response: TrustedWindowsNativeHelperResponseV1) => void;
  readonly reject: (error: Error) => void;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason: Error) => void;
}

interface ChildExitObservation {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface ForcedTeardownAttempt {
  readonly promise: Promise<void>;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  let rejectPromise: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function bridgeError(
  code: TrustedWindowsNativeHelperBridgeErrorCodeV1,
): TrustedWindowsNativeHelperBridgeErrorV1 {
  const error = new TrustedWindowsNativeHelperBridgeErrorV1(code);
  INTERNAL_BRIDGE_ERROR_CODES.set(error, code);
  return error;
}

function internalBridgeErrorCode(
  error: unknown,
): TrustedWindowsNativeHelperBridgeErrorCodeV1 | null {
  if (typeof error !== "object" || error === null) return null;
  return INTERNAL_BRIDGE_ERROR_CODES.get(error) ?? null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes);
}

function buildMinimalEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function assertTrustedConfiguration(
  configuration: TrustedWindowsNativeHelperBridgeConfigurationV1,
): void {
  const path = configuration.executablePath;
  if (path.length < 1 || path.length > MAX_EXECUTABLE_PATH_UTF16_UNITS ||
    path.includes("\0") || !isAbsolute(path) ||
    !isTrustedWindowsNativeHelperSha256V1(configuration.expectedExecutableSha256)) {
    throw bridgeError("INVALID_TRUSTED_CONFIGURATION");
  }
}

function assertPrivatePath(value: string): void {
  if (value.length < 3 || value.length > MAX_PRIVATE_PATH_UTF16_UNITS ||
    value.includes("\0") || value.includes("\r") || value.includes("\n")) {
    throw bridgeError("OPERATION_FAILED");
  }
}

function assertExactDataObject(
  value: object,
  expectedKeys: readonly string[],
): void {
  const prototype = Object.getPrototypeOf(value) as unknown;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0 || keys.length !== expectedKeys.length ||
    keys.some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => {
      const descriptor = descriptors[key];
      return descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true;
    })) throw bridgeError("OPERATION_FAILED");
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw bridgeError("OPERATION_FAILED");
  }
  return descriptor.value as unknown;
}

function assertAdapterBase(
  request: TrustedWindowsNativeAdapterHelperRequestBaseV1,
  sessionRef: string,
  requestPattern: RegExp,
): void {
  const schemaVersion = ownDataValue(request, "schema_version");
  const candidateSessionRef = ownDataValue(request, "session_ref");
  const basketSessionRef = ownDataValue(request, "basket_session_ref");
  const requestRef = ownDataValue(request, "request_ref");
  if (schemaVersion !== 1 || candidateSessionRef !== sessionRef ||
    typeof basketSessionRef !== "string" || !BASKET_SESSION_REF.test(basketSessionRef) ||
    typeof requestRef !== "string" || !requestPattern.test(requestRef)) {
    throw bridgeError("OPERATION_FAILED");
  }
}

function assertStringArray(
  value: readonly string[],
  maximum: number,
  pattern: RegExp,
): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum ||
    value.some((item) => typeof item !== "string" || !pattern.test(item)) ||
    new Set(value).size !== value.length) throw bridgeError("OPERATION_FAILED");
}

function statIdentityMatches(
  left: Awaited<ReturnType<FileHandle["stat"]>>,
  right: Awaited<ReturnType<FileHandle["stat"]>>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

async function hashOpenFile(handle: FileHandle): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1_024);
  let position = 0;
  for (;;) {
    const result = await handle.read(buffer, 0, buffer.byteLength, position);
    if (result.bytesRead === 0) break;
    hash.update(buffer.subarray(0, result.bytesRead));
    position += result.bytesRead;
  }
  return `sha256:${hash.digest("hex")}`;
}

async function openVerifiedExecutable(
  configuration: TrustedWindowsNativeHelperBridgeConfigurationV1,
): Promise<FileHandle> {
  let handle: FileHandle | null = null;
  try {
    const pathInfo = await lstat(configuration.executablePath);
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) {
      throw bridgeError("HELPER_VERIFICATION_FAILED");
    }
    handle = await open(configuration.executablePath, "r");
    const before = await handle.stat();
    if (!before.isFile()) throw bridgeError("HELPER_VERIFICATION_FAILED");
    const observedSha256 = await hashOpenFile(handle);
    const after = await handle.stat();
    if (!statIdentityMatches(before, after) ||
      !safeEqual(observedSha256, configuration.expectedExecutableSha256)) {
      throw bridgeError("HELPER_VERIFICATION_FAILED");
    }
    return handle;
  } catch (error: unknown) {
    if (handle !== null) await handle.close().catch(() => undefined);
    const code = internalBridgeErrorCode(error);
    if (code !== null) throw bridgeError(code);
    throw bridgeError("HELPER_VERIFICATION_FAILED");
  }
}

function responseCapFor(request: TrustedWindowsNativeHelperRequestV1): number {
  return request.type === "handshake" || request.type === "cancel" || request.type === "close"
    ? MAX_HANDSHAKE_OR_CONTROL_REQUEST_BYTES
    : MAX_WORK_REQUEST_BYTES;
}

function serializeBoundedRequest(
  request: TrustedWindowsNativeHelperRequestV1,
): Buffer {
  const serialized = Buffer.from(`${JSON.stringify(request)}\n`, "utf8");
  if (serialized.byteLength - 1 > responseCapFor(request)) {
    throw bridgeError("OPERATION_FAILED");
  }
  return serialized;
}

function makeRandomOpaqueReference(
  prefix: "helper_session_" | "helper_request_",
  isValid: (value: string) => boolean,
  randomSource: (size: number) => Uint8Array,
): string {
  for (let attempt = 0; attempt < OPAQUE_REFERENCE_ATTEMPTS; attempt += 1) {
    let random: Uint8Array;
    try {
      random = randomSource(16);
    } catch {
      throw bridgeError("HELPER_UNAVAILABLE");
    }
    if (!(random instanceof Uint8Array) || random.byteLength !== 16) {
      throw bridgeError("INVALID_TRUSTED_CONFIGURATION");
    }
    let value: string;
    try {
      value = `${prefix}${Buffer.from(random).toString("hex")}`;
    } catch {
      throw bridgeError("INVALID_TRUSTED_CONFIGURATION");
    }
    if (isValid(value)) return value;
  }
  throw bridgeError("INVALID_TRUSTED_CONFIGURATION");
}

function makeRandomSessionRef(
  randomSource: (size: number) => Uint8Array = randomBytes,
): string {
  return makeRandomOpaqueReference(
    "helper_session_",
    isTrustedWindowsNativeHelperSessionRefV1,
    randomSource,
  );
}

function makeRandomRequestRef(
  randomSource: (size: number) => Uint8Array = randomBytes,
): string {
  return makeRandomOpaqueReference(
    "helper_request_",
    isTrustedWindowsNativeHelperRequestRefV1,
    randomSource,
  );
}

/** @internal Focused-test seam; absent from every barrel, CLI, and browser route. */
export function generateTrustedWindowsNativeHelperReferenceForTestingV1(
  kind: "session" | "request",
  randomSource: (size: number) => Uint8Array,
): string {
  return kind === "session"
    ? makeRandomSessionRef(randomSource)
    : makeRandomRequestRef(randomSource);
}

class NativeHelperProcessBridge implements TrustedWindowsNativeHelperProcessBridgeV1 {
  readonly #child: NativeHelperChildProcess;
  readonly #expectedExecutableSha256: string;
  readonly #sessionRef: string;
  readonly #challengeHex: string;
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  readonly #stdoutAccumulator: Buffer;
  readonly #handshakeResponse = deferred<TrustedWindowsNativeHelperResponseV1>();
  readonly #exit = deferred<ChildExitObservation>();
  readonly #confirmedExitWaiters = new Set<Deferred<undefined>>();
  readonly #pendingWork = new Map<number, PendingResponse>();
  readonly #pendingControl = new Map<number, PendingResponse>();
  readonly #usedRequestRefs = new Set<string>();
  #state: BridgeState = "handshaking";
  #stdoutRemainderBytes = 0;
  #stderrBytes = 0;
  #nextWorkSequence = 1;
  #nextControlSequence = 1;
  #expectedWorkResponseSequence = 1;
  #expectedControlResponseSequence = 1;
  #writeChain: Promise<void> = Promise.resolve();
  #activeWorkRequestRef: string | null = null;
  #closePromise: Promise<void> | null = null;
  #forcedTeardown: ForcedTeardownAttempt | null = null;
  #mostRecentForcedTeardown: ForcedTeardownAttempt | null = null;
  #exitObserved = false;
  #handshakeSeen = false;
  #terminalErrorCode: TrustedWindowsNativeHelperBridgeErrorCodeV1 | null = null;
  #activeScopeRef: string | null = null;
  #activeRunRef: string | null = null;
  readonly #activeOutputFileRefs = new Set<string>();

  constructor(input: {
    readonly child: NativeHelperChildProcess;
    readonly expectedExecutableSha256: string;
    readonly sessionRef: string;
    readonly challengeHex: string;
    readonly stdoutAccumulator: Buffer;
  }) {
    this.#child = input.child;
    this.#expectedExecutableSha256 = input.expectedExecutableSha256;
    this.#sessionRef = input.sessionRef;
    this.#challengeHex = input.challengeHex;
    this.#stdoutAccumulator = input.stdoutAccumulator;
    void this.#handshakeResponse.promise.catch(() => undefined);
    this.#attachProcessListeners();
  }

  get session_ref(): string {
    return this.#sessionRef;
  }

  get capabilities(): readonly string[] {
    return TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1;
  }

  async establishHandshake(): Promise<void> {
    const request: TrustedWindowsNativeHelperHandshakeRequestV1 = {
      type: "handshake",
      schema_version: TRUSTED_WINDOWS_NATIVE_HELPER_PROTOCOL_SCHEMA_VERSION_V1,
      session_ref: this.#sessionRef,
      challenge: this.#challengeHex,
      expected_helper_sha256: this.#expectedExecutableSha256,
    };
    const operation = (async () => {
      await this.#write(request);
      const response = await this.#handshakeResponse.promise;
      this.#validateHandshakeResponse(response);
      if (this.#state !== "handshaking") throw bridgeError("HANDSHAKE_FAILED");
      this.#state = "ready";
    })();
    try {
      await this.#withDeadline(operation, HANDSHAKE_TIMEOUT_MS, "HANDSHAKE_FAILED");
    } catch (error: unknown) {
      const code = internalBridgeErrorCode(error) ?? "HANDSHAKE_FAILED";
      this.#failTerminal(code);
      throw bridgeError(code);
    }
  }

  async pick_files(
    request: TrustedWindowsNativeAdapterHelperPickRequestV1,
  ): Promise<unknown> {
    return await this.#pickForAdapter(request, "pick_files");
  }

  async pick_folder(
    request: TrustedWindowsNativeAdapterHelperPickRequestV1,
  ): Promise<unknown> {
    return await this.#pickForAdapter(request, "pick_folder");
  }

  async drop_sources(
    request: TrustedWindowsNativeAdapterHelperDropSourcesRequestV1,
  ): Promise<unknown> {
    return await this.#pickForAdapter(request, "drop_sources");
  }

  async #pickForAdapter(
    request:
      | TrustedWindowsNativeAdapterHelperPickRequestV1
      | TrustedWindowsNativeAdapterHelperDropSourcesRequestV1,
    operation: "pick_files" | "pick_folder" | "drop_sources",
  ): Promise<unknown> {
    assertExactDataObject(request, [
      "schema_version", "operation", "session_ref", "basket_session_ref",
      "request_ref", "read_only", "browser_path_input_accepted",
    ]);
    assertAdapterBase(request, this.#sessionRef, NATIVE_REQUEST_REF);
    if (ownDataValue(request, "operation") !== operation ||
      ownDataValue(request, "read_only") !== true ||
      ownDataValue(request, "browser_path_input_accepted") !== false) {
      throw bridgeError("OPERATION_FAILED");
    }
    await this.#assertReady();
    this.#assertWorkIdle();
    const requestRef = this.#nextUniqueRequestRef();
    const sequence = this.#takeWorkSequence();
    let wireRequest: TrustedWindowsNativeHelperPickFilesRequestV1 |
      TrustedWindowsNativeHelperPickFolderRequestV1 |
      TrustedWindowsNativeHelperDropSourcesRequestV1;
    if (operation === "pick_files") {
      wireRequest = {
        type: "pick_files", schema_version: 1, session_ref: this.#sessionRef,
        request_ref: requestRef, sequence,
        basket_session_ref: request.basket_session_ref,
        controller_request_ref: request.request_ref,
      };
    } else if (operation === "pick_folder") {
      wireRequest = {
        type: "pick_folder", schema_version: 1, session_ref: this.#sessionRef,
        request_ref: requestRef, sequence,
        basket_session_ref: request.basket_session_ref,
        controller_request_ref: request.request_ref,
      };
    } else {
      wireRequest = {
        type: "drop_sources", schema_version: 1, session_ref: this.#sessionRef,
        request_ref: requestRef, sequence,
        basket_session_ref: request.basket_session_ref,
        controller_request_ref: request.request_ref,
      };
    }
    const expectedResponse = operation === "pick_files"
      ? "pick_files_ok"
      : operation === "pick_folder"
        ? "pick_folder_ok"
        : "drop_sources_ok";
    const response = await this.#performWork(
      wireRequest,
      expectedResponse,
      PICKER_OR_REVALIDATION_TIMEOUT_MS,
    );
    if ((response.type !== "pick_files_ok" && response.type !== "pick_folder_ok" &&
      response.type !== "drop_sources_ok") ||
      response.type !== `${operation}_ok` ||
      response.basket_session_ref !== request.basket_session_ref ||
      response.controller_request_ref !== request.request_ref) {
      return await this.#rejectProtocolFailure();
    }
    const base = {
      schema_version: 1 as const,
      operation,
      session_ref: this.#sessionRef,
      basket_session_ref: request.basket_session_ref,
      request_ref: request.request_ref,
    };
    if (response.status === "selected") {
      if (response.selections === undefined) return await this.#rejectProtocolFailure();
      return Object.freeze({
        ...base,
        status: "selected" as const,
        selections: response.selections,
      });
    }
    if (response.selections !== undefined) return await this.#rejectProtocolFailure();
    return Object.freeze({ ...base, status: response.status });
  }

  async resolve_output(
    request: TrustedWindowsNativeAdapterHelperResolveOutputRequestV1,
  ): Promise<unknown> {
    assertExactDataObject(request, [
      "schema_version", "operation", "session_ref", "basket_session_ref",
      "request_ref", "read_only", "browser_path_input_accepted",
    ]);
    assertAdapterBase(request, this.#sessionRef, NATIVE_REQUEST_REF);
    if (ownDataValue(request, "operation") !== "resolve_output" ||
      ownDataValue(request, "read_only") !== true ||
      ownDataValue(request, "browser_path_input_accepted") !== false) {
      throw bridgeError("OPERATION_FAILED");
    }
    await this.#assertReady();
    this.#assertWorkIdle();
    const requestRef = this.#nextUniqueRequestRef();
    const sequence = this.#takeWorkSequence();
    const wireRequest: TrustedWindowsNativeHelperResolveOutputRequestV1 = {
      type: "resolve_output", schema_version: 1, session_ref: this.#sessionRef,
      request_ref: requestRef, sequence,
      basket_session_ref: request.basket_session_ref,
      controller_request_ref: request.request_ref,
    };
    const response = await this.#performWork(
      wireRequest,
      "resolve_output_ok",
      PICKER_OR_REVALIDATION_TIMEOUT_MS,
    );
    if (response.type !== "resolve_output_ok" ||
      response.basket_session_ref !== request.basket_session_ref ||
      response.controller_request_ref !== request.request_ref) {
      return await this.#rejectProtocolFailure();
    }
    const base = {
      schema_version: 1 as const,
      operation: "resolve_output" as const,
      session_ref: this.#sessionRef,
      basket_session_ref: request.basket_session_ref,
      request_ref: request.request_ref,
    };
    if (response.status === "resolved") {
      if (response.output === undefined) return await this.#rejectProtocolFailure();
      return Object.freeze({ ...base, status: "resolved" as const, output: response.output });
    }
    if (response.output !== undefined) return await this.#rejectProtocolFailure();
    return Object.freeze({ ...base, status: response.status });
  }

  async compare_paths(
    request: TrustedWindowsNativeAdapterHelperComparePathsRequestV1,
  ): Promise<unknown> {
    assertExactDataObject(request, [
      "schema_version", "operation", "session_ref", "basket_session_ref", "request_ref",
      "left_canonical_absolute_path", "right_canonical_absolute_path", "read_only",
    ]);
    assertAdapterBase(request, this.#sessionRef, NATIVE_COMPARE_REF);
    if (ownDataValue(request, "operation") !== "compare_paths" ||
      ownDataValue(request, "read_only") !== true) {
      throw bridgeError("OPERATION_FAILED");
    }
    const result = await this.compareCanonicalPaths({
      leftCanonicalAbsolutePath: request.left_canonical_absolute_path,
      rightCanonicalAbsolutePath: request.right_canonical_absolute_path,
    });
    return Object.freeze({
      schema_version: 1 as const,
      operation: "compare_paths" as const,
      session_ref: this.#sessionRef,
      basket_session_ref: request.basket_session_ref,
      request_ref: request.request_ref,
      status: "compared" as const,
      comparison_authority: result.comparisonAuthority,
      relation: result.relation,
    });
  }

  async revalidate_start(
    request: TrustedWindowsNativeAdapterHelperRevalidateStartRequestV1,
  ): Promise<unknown> {
    assertExactDataObject(request, [
      "schema_version", "operation", "session_ref", "basket_session_ref", "request_ref",
      "adapter_id", "adapter_build_sha256", "expected_source_refs", "expected_output_ref",
      "read_only", "browser_path_input_accepted",
    ]);
    assertAdapterBase(request, this.#sessionRef, REVALIDATED_START_REF);
    assertStringArray(request.expected_source_refs, 128, SOURCE_REF);
    if (ownDataValue(request, "operation") !== "revalidate_start" ||
      ownDataValue(request, "read_only") !== true ||
      ownDataValue(request, "browser_path_input_accepted") !== false ||
      !ADAPTER_ID.test(request.adapter_id) ||
      !isTrustedWindowsNativeHelperSha256V1(request.adapter_build_sha256) ||
      !OUTPUT_REF.test(request.expected_output_ref) || this.#activeScopeRef !== null) {
      throw bridgeError("OPERATION_FAILED");
    }
    await this.#assertReady();
    this.#assertWorkIdle();
    const requestRef = this.#nextUniqueRequestRef();
    const sequence = this.#takeWorkSequence();
    const wireRequest: TrustedWindowsNativeHelperRevalidateStartRequestV1 = {
      type: "revalidate_start", schema_version: 1, session_ref: this.#sessionRef,
      request_ref: requestRef, sequence,
      basket_session_ref: request.basket_session_ref,
      controller_request_ref: request.request_ref,
      adapter_id: request.adapter_id,
      adapter_build_sha256: request.adapter_build_sha256,
      expected_source_refs: [...request.expected_source_refs],
      expected_output_ref: request.expected_output_ref,
    };
    const response = await this.#performWork(
      wireRequest,
      "revalidate_start_ok",
      PICKER_OR_REVALIDATION_TIMEOUT_MS,
    );
    if (response.type !== "revalidate_start_ok" ||
      response.basket_session_ref !== request.basket_session_ref ||
      response.controller_request_ref !== request.request_ref) {
      return await this.#rejectProtocolFailure();
    }
    const base = {
      schema_version: 1 as const,
      operation: "revalidate_start" as const,
      session_ref: this.#sessionRef,
      basket_session_ref: request.basket_session_ref,
      request_ref: request.request_ref,
    };
    if (response.status === "rejected") {
      if (response.no_live_scope !== true || response.scope_ref !== undefined ||
        response.evidence !== undefined || response.source_files !== undefined) {
        return await this.#rejectProtocolFailure();
      }
      return Object.freeze({ ...base, status: "rejected" as const, no_live_scope: true });
    }
    if (response.scope_ref === undefined || response.evidence === undefined ||
      response.source_files === undefined || response.no_live_scope !== undefined ||
      response.evidence.adapter_id !== request.adapter_id ||
      response.evidence.adapter_build_sha256 !== request.adapter_build_sha256 ||
      response.evidence.output.output_ref !== request.expected_output_ref ||
      response.evidence.selections.length !== request.expected_source_refs.length ||
      response.evidence.selections.some(
        (selection, index) => selection.source_ref !== request.expected_source_refs[index],
      )) return await this.#rejectProtocolFailure();
    const expectedSourceIdentityKeys = new Set(
      response.evidence.selections.flatMap((selection) =>
        selection.evidence.inventory_file_identities.map((identity) =>
          `${identity.volume_serial_number_hex}:${identity.file_id_hex}`)),
    );
    const sourceFileIdentityKeys = new Set(
      response.source_files.map((sourceFile) =>
        `${sourceFile.identity.volume_serial_number_hex}:${sourceFile.identity.file_id_hex}`),
    );
    if (sourceFileIdentityKeys.size !== response.source_files.length ||
      sourceFileIdentityKeys.size !== expectedSourceIdentityKeys.size ||
      [...sourceFileIdentityKeys].some((key) => !expectedSourceIdentityKeys.has(key))) {
      return await this.#rejectProtocolFailure();
    }
    this.#activeScopeRef = response.scope_ref;
    return Object.freeze({
      ...base,
      status: "opened" as const,
      scope_ref: response.scope_ref,
      evidence: response.evidence,
    });
  }

  async release_revalidated_start(
    request: TrustedWindowsNativeAdapterHelperReleaseRequestV1,
  ): Promise<unknown> {
    assertExactDataObject(request, [
      "schema_version", "operation", "session_ref", "basket_session_ref", "request_ref",
      "scope_ref",
    ]);
    assertAdapterBase(request, this.#sessionRef, REVALIDATED_START_REF);
    if (ownDataValue(request, "operation") !== "release_revalidated_start" ||
      !SCOPE_REF.test(request.scope_ref) || request.scope_ref !== this.#activeScopeRef) {
      throw bridgeError("OPERATION_FAILED");
    }
    await this.#assertReady();
    this.#assertWorkIdle();
    const requestRef = this.#nextUniqueRequestRef();
    const sequence = this.#takeWorkSequence();
    const wireRequest: TrustedWindowsNativeHelperReleaseRevalidatedStartRequestV1 = {
      type: "release_revalidated_start", schema_version: 1,
      session_ref: this.#sessionRef, request_ref: requestRef, sequence,
      basket_session_ref: request.basket_session_ref,
      controller_request_ref: request.request_ref,
      scope_ref: request.scope_ref,
    };
    const response = await this.#performWork(
      wireRequest,
      "release_revalidated_start_ok",
      OPERATION_TIMEOUT_MS,
    );
    if (response.type !== "release_revalidated_start_ok" ||
      response.basket_session_ref !== request.basket_session_ref ||
      response.controller_request_ref !== request.request_ref ||
      response.scope_ref !== request.scope_ref) {
      return await this.#rejectProtocolFailure();
    }
    this.#clearScopeReferences();
    return Object.freeze({
      schema_version: 1 as const,
      operation: "release_revalidated_start" as const,
      session_ref: this.#sessionRef,
      basket_session_ref: request.basket_session_ref,
      request_ref: request.request_ref,
      scope_ref: request.scope_ref,
      status: "released" as const,
    });
  }

  async create_run_output(): Promise<TrustedWindowsNativeHelperCreateRunResultV1> {
    const scopeRef = this.#activeScopeRef;
    if (scopeRef === null || this.#activeRunRef !== null) throw bridgeError("OPERATION_FAILED");
    await this.#assertReady();
    this.#assertWorkIdle();
    const requestRef = this.#nextUniqueRequestRef();
    const sequence = this.#takeWorkSequence();
    const request: TrustedWindowsNativeHelperCreateRunOutputRequestV1 = {
      type: "create_run_output", schema_version: 1, session_ref: this.#sessionRef,
      request_ref: requestRef, sequence, scope_ref: scopeRef,
    };
    const response = await this.#performWork(
      request,
      "create_run_output_ok",
      OPERATION_TIMEOUT_MS,
    );
    if (response.type !== "create_run_output_ok" || response.scope_ref !== scopeRef ||
      !RUN_REF.test(response.run_ref)) {
      return await this.#rejectProtocolFailure();
    }
    this.#activeRunRef = response.run_ref;
    return Object.freeze({
      scope_ref: scopeRef,
      run_ref: response.run_ref,
      identity: response.identity,
    });
  }

  async create_output_file(
    input: TrustedWindowsNativeHelperCreateOutputFileInputV1,
  ): Promise<TrustedWindowsNativeHelperCreateOutputFileResultV1> {
    assertExactDataObject(input, ["component"]);
    const scopeRef = this.#activeScopeRef;
    const runRef = this.#activeRunRef;
    if (scopeRef === null || runRef === null || typeof input.component !== "string" ||
      input.component.length < 1 || input.component.length > MAX_OUTPUT_COMPONENT_UTF16_UNITS ||
      input.component.includes("\0") || input.component.includes("/") ||
      input.component.includes("\\")) throw bridgeError("OPERATION_FAILED");
    await this.#assertReady();
    this.#assertWorkIdle();
    const requestRef = this.#nextUniqueRequestRef();
    const sequence = this.#takeWorkSequence();
    const request: TrustedWindowsNativeHelperCreateOutputFileRequestV1 = {
      type: "create_output_file", schema_version: 1, session_ref: this.#sessionRef,
      request_ref: requestRef, sequence, scope_ref: scopeRef, run_ref: runRef,
      component: input.component,
    };
    const response = await this.#performWork(
      request,
      "create_output_file_ok",
      OPERATION_TIMEOUT_MS,
    );
    if (response.type !== "create_output_file_ok" || response.scope_ref !== scopeRef ||
      response.run_ref !== runRef ||
      !OUTPUT_FILE_REF.test(response.output_file_ref) ||
      this.#activeOutputFileRefs.has(response.output_file_ref)) {
      return await this.#rejectProtocolFailure();
    }
    this.#activeOutputFileRefs.add(response.output_file_ref);
    return Object.freeze({
      scope_ref: scopeRef,
      run_ref: runRef,
      output_file_ref: response.output_file_ref,
      identity: response.identity,
    });
  }

  async compareCanonicalPaths(
    input: TrustedWindowsNativeHelperCompareInputV1,
  ): Promise<TrustedWindowsNativeHelperCompareResultV1> {
    await this.#assertReady();
    if (this.#activeWorkRequestRef !== null) throw bridgeError("OPERATION_BUSY");
    assertPrivatePath(input.leftCanonicalAbsolutePath);
    assertPrivatePath(input.rightCanonicalAbsolutePath);
    const requestRef = this.#nextUniqueRequestRef();
    const sequence = this.#takeWorkSequence();
    const request: TrustedWindowsNativeHelperComparePathsRequestV1 = {
      type: "compare_paths",
      schema_version: 1,
      session_ref: this.#sessionRef,
      request_ref: requestRef,
      sequence,
      left_path: input.leftCanonicalAbsolutePath,
      right_path: input.rightCanonicalAbsolutePath,
    };
    this.#activeWorkRequestRef = requestRef;
    try {
      try {
        const response = await this.#withDeadline(
          this.#sendBoundRequest(request, "work", sequence, "compare_paths_ok"),
          OPERATION_TIMEOUT_MS,
          "DEADLINE_EXCEEDED",
        );
        if (response.type !== "compare_paths_ok") {
          throw bridgeError("PROTOCOL_FAILURE");
        }
        return {
          relation: response.relation,
          comparisonAuthority: "windows_compare_string_ordinal_ignore_case",
        };
      } catch (error: unknown) {
        if (this.#isFailed()) await this.#forceTerminateAndWait();
        throw error;
      }
    } finally {
      if (this.#activeWorkRequestRef === requestRef) {
        this.#activeWorkRequestRef = null;
      }
    }
  }

  async close(): Promise<void> {
    if (this.#closePromise !== null) {
      await this.#closePromise;
      return;
    }
    if (this.#state === "closed") return;
    if (this.#state === "failed") {
      await this.#forceTerminateAndWait();
      return;
    }
    this.#closePromise = this.#closeSession();
    await this.#closePromise;
    this.#clearScopeReferences();
  }

  async close_and_confirm_no_live_scopes(): Promise<void> {
    const activeTeardownAtEntry = this.#forcedTeardown;
    const mostRecentTeardownAtEntry = this.#mostRecentForcedTeardown;
    try {
      await this.close();
    } catch (error: unknown) {
      // This method reports the stronger lifecycle fact, not whether the
      // helper completed its graceful close protocol. Exact-child teardown is
      // still mandatory; its sole failure is HELPER_TEARDOWN_UNCONFIRMED.
      if (internalBridgeErrorCode(error) === "HELPER_TEARDOWN_UNCONFIRMED") {
        // Join the exact attempt that was already active, or one that began
        // while close() was pending. Only a failure already stale at entry may
        // authorize this lifecycle call to create one fresh bounded attempt.
        const attemptToJoin = activeTeardownAtEntry ??
          (this.#mostRecentForcedTeardown !== mostRecentTeardownAtEntry
            ? this.#mostRecentForcedTeardown
            : null);
        if (attemptToJoin !== null) {
          await attemptToJoin.promise;
        } else {
          await this.#forceTerminateAndWait();
        }
      } else {
        await this.#forceTerminateAndWait();
      }
    }
    await this.waitForConfirmedExit();
    this.#clearScopeReferences();
  }

  async waitForConfirmedExit(): Promise<void> {
    if (this.#exitObserved) return;
    const waiter = deferred<undefined>();
    this.#confirmedExitWaiters.add(waiter);
    try {
      await waiter.promise;
    } finally {
      this.#confirmedExitWaiters.delete(waiter);
    }
  }

  #assertWorkIdle(): void {
    if (this.#activeWorkRequestRef !== null) throw bridgeError("OPERATION_BUSY");
  }

  async #performWork(
    request: Exclude<
      TrustedWindowsNativeHelperRequestV1,
      | TrustedWindowsNativeHelperHandshakeRequestV1
      | TrustedWindowsNativeHelperCancelRequestV1
      | TrustedWindowsNativeHelperCloseRequestV1
    >,
    expectedType: ExpectedResponseType,
    timeoutMilliseconds: number,
  ): Promise<TrustedWindowsNativeHelperResponseV1> {
    // Every caller performs the async readiness check before allocating its
    // sequence. From here through setting the active reference there must be
    // no await, otherwise two callers could both consume sequences before the
    // busy latch becomes visible.
    this.#assertWorkIdle();
    this.#activeWorkRequestRef = request.request_ref;
    try {
      try {
        return await this.#withDeadline(
          this.#sendBoundRequest(request, "work", request.sequence, expectedType),
          timeoutMilliseconds,
          "DEADLINE_EXCEEDED",
        );
      } catch (error: unknown) {
        if (this.#isFailed()) await this.#forceTerminateAndWait();
        throw error;
      }
    } finally {
      if (this.#activeWorkRequestRef === request.request_ref) {
        this.#activeWorkRequestRef = null;
      }
    }
  }

  async #rejectProtocolFailure(): Promise<never> {
    this.#failTerminal("PROTOCOL_FAILURE");
    await this.#forceTerminateAndWait();
    throw bridgeError("PROTOCOL_FAILURE");
  }

  #clearScopeReferences(): void {
    this.#activeScopeRef = null;
    this.#activeRunRef = null;
    this.#activeOutputFileRefs.clear();
  }

  #attachProcessListeners(): void {
    this.#child.stdout.on("data", (chunk: Buffer) => {
      this.#onStdout(chunk);
    });
    this.#child.stderr.on("data", (chunk: Buffer) => {
      this.#stderrBytes += chunk.byteLength;
      if (this.#stderrBytes > MAX_HELPER_STDERR_BYTES) {
        this.#failTerminal("PROTOCOL_FAILURE");
      }
    });
    this.#child.stdin.on("error", () => {
      this.#failTerminal("HELPER_UNAVAILABLE");
    });
    this.#child.stdout.on("error", () => {
      this.#failTerminal("HELPER_UNAVAILABLE");
    });
    this.#child.stderr.on("error", () => {
      this.#failTerminal("HELPER_UNAVAILABLE");
    });
    this.#child.once("error", () => {
      this.#failTerminal("HELPER_UNAVAILABLE");
    });
    this.#child.once("close", (code, signal) => {
      this.#onChildClose(code, signal);
    });
  }

  #onStdout(chunk: Buffer): void {
    if (this.#state === "closed" || this.#state === "failed") return;
    let offset = 0;
    while (offset < chunk.byteLength) {
      const newlineIndex = chunk.indexOf(0x0a, offset);
      const end = newlineIndex < 0 ? chunk.byteLength : newlineIndex;
      const segment = chunk.subarray(offset, end);
      if (this.#stdoutRemainderBytes + segment.byteLength >
        MAX_HELPER_RESPONSE_BYTES) {
        this.#failTerminal("PROTOCOL_FAILURE");
        return;
      }
      if (segment.byteLength > 0) {
        segment.copy(this.#stdoutAccumulator, this.#stdoutRemainderBytes);
        this.#stdoutRemainderBytes += segment.byteLength;
      }
      if (newlineIndex < 0) return;
      const lineBytes = this.#stdoutRemainderBytes;
      const line = this.#stdoutAccumulator.subarray(0, lineBytes);
      this.#stdoutRemainderBytes = 0;
      try {
        if (line.byteLength === 0) {
          this.#failTerminal("PROTOCOL_FAILURE");
          return;
        }
        if (line.at(-1) === 0x0d || line.subarray(0, 3).equals(UTF8_BOM)) {
          this.#failTerminal("PROTOCOL_FAILURE");
          return;
        }
        if (!this.#parseAndDispatchLine(line)) return;
      } finally {
        this.#stdoutAccumulator.fill(0, 0, lineBytes);
      }
      offset = newlineIndex + 1;
    }
  }

  #parseAndDispatchLine(line: Buffer): boolean {
    let response: TrustedWindowsNativeHelperResponseV1;
    try {
      response = parseTrustedWindowsNativeHelperResponseV1(
        this.#decoder.decode(line),
      );
    } catch {
      this.#failTerminal("PROTOCOL_FAILURE");
      return false;
    }
    if (this.#state === "handshaking") {
      this.#dispatchHandshakeResponse(response);
      return !this.#isFailed();
    }
    if (this.#state !== "ready" && this.#state !== "closing") {
      this.#failTerminal("PROTOCOL_FAILURE");
      return false;
    }
    this.#dispatchBoundResponse(response);
    return !this.#isFailed();
  }

  #dispatchHandshakeResponse(response: TrustedWindowsNativeHelperResponseV1): void {
    if (this.#handshakeSeen) {
      this.#failTerminal("PROTOCOL_FAILURE");
      return;
    }
    this.#handshakeSeen = true;
    if (response.type === "error") {
      if (response.request_ref !== null || response.sequence !== null ||
        response.control_sequence !== null) {
        this.#failTerminal("PROTOCOL_FAILURE");
        return;
      }
      this.#handshakeResponse.reject(bridgeError("HANDSHAKE_FAILED"));
      this.#failTerminal("HANDSHAKE_FAILED");
      return;
    }
    if (response.type !== "handshake_ok") {
      this.#failTerminal("PROTOCOL_FAILURE");
      return;
    }
    this.#handshakeResponse.resolve(response);
  }

  #dispatchBoundResponse(response: TrustedWindowsNativeHelperResponseV1): void {
    if (response.type === "handshake_ok") {
      this.#failTerminal("PROTOCOL_FAILURE");
      return;
    }
    if (response.type === "error") {
      this.#dispatchBoundError(response);
      return;
    }
    if (response.type === "cancel_ok" || response.type === "close_ok") {
      this.#deliverBoundResponse("control", response.control_sequence, response);
      return;
    }
    this.#deliverBoundResponse("work", response.sequence, response);
  }

  #dispatchBoundError(
    response: Extract<TrustedWindowsNativeHelperResponseV1, { readonly type: "error" }>,
  ): void {
    if (response.session_ref !== this.#sessionRef || response.request_ref === null) {
      this.#failTerminal("PROTOCOL_FAILURE");
      return;
    }
    const channel = response.sequence === null ? "control" : "work";
    const sequence = response.sequence ?? response.control_sequence;
    if (sequence === null) {
      this.#failTerminal("PROTOCOL_FAILURE");
      return;
    }
    const pending = this.#takePending(channel, sequence, response.request_ref);
    if (pending === null) return;
    pending.reject(bridgeError("PROTOCOL_FAILURE"));
    this.#failTerminal("PROTOCOL_FAILURE");
  }

  #deliverBoundResponse(
    channel: ResponseChannel,
    sequence: number,
    response: Exclude<
      TrustedWindowsNativeHelperResponseV1,
      { readonly type: "handshake_ok" | "error" }
    >,
  ): void {
    if (response.session_ref !== this.#sessionRef) {
      this.#failTerminal("PROTOCOL_FAILURE");
      return;
    }
    const pending = this.#takePending(channel, sequence, response.request_ref);
    if (pending === null) return;
    if (response.type !== pending.expectedType) {
      pending.reject(bridgeError("PROTOCOL_FAILURE"));
      this.#failTerminal("PROTOCOL_FAILURE");
      return;
    }
    pending.resolve(response);
  }

  #takePending(
    channel: ResponseChannel,
    sequence: number,
    requestRef: string,
  ): PendingResponse | null {
    const expected = channel === "work"
      ? this.#expectedWorkResponseSequence
      : this.#expectedControlResponseSequence;
    const pendingMap = channel === "work" ? this.#pendingWork : this.#pendingControl;
    const pending = pendingMap.get(sequence);
    if (sequence !== expected || pending === undefined ||
      pending.requestRef !== requestRef || pending.channel !== channel) {
      this.#failTerminal("PROTOCOL_FAILURE");
      return null;
    }
    pendingMap.delete(sequence);
    if (channel === "work") this.#expectedWorkResponseSequence += 1;
    else this.#expectedControlResponseSequence += 1;
    return pending;
  }

  #validateHandshakeResponse(response: TrustedWindowsNativeHelperResponseV1): void {
    if (response.type !== "handshake_ok" || response.session_ref !== this.#sessionRef ||
      !safeEqual(response.self_observed_image_sha256, this.#expectedExecutableSha256) ||
      response.capabilities.length !== TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1.length ||
      !response.capabilities.every((value, index) =>
        value === TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1[index])) {
      throw bridgeError("HANDSHAKE_FAILED");
    }
    const expectedResponse = deriveTrustedWindowsNativeHelperChallengeResponseV1({
      challengeHex: this.#challengeHex,
      expectedHelperSha256: this.#expectedExecutableSha256,
    });
    if (!safeEqual(response.challenge_response_sha256, expectedResponse)) {
      throw bridgeError("HANDSHAKE_FAILED");
    }
  }

  async #sendBoundRequest(
    request: Exclude<TrustedWindowsNativeHelperRequestV1, { readonly type: "handshake" }>,
    channel: ResponseChannel,
    sequence: number,
    expectedType: ExpectedResponseType,
  ): Promise<TrustedWindowsNativeHelperResponseV1> {
    const pendingMap = channel === "work" ? this.#pendingWork : this.#pendingControl;
    if (pendingMap.has(sequence)) throw bridgeError("PROTOCOL_FAILURE");
    const response = deferred<TrustedWindowsNativeHelperResponseV1>();
    void response.promise.catch(() => undefined);
    pendingMap.set(sequence, {
      channel,
      requestRef: request.request_ref,
      sequence,
      expectedType,
      resolve: response.resolve,
      reject: response.reject,
    });
    try {
      await this.#write(request);
    } catch (error: unknown) {
      pendingMap.delete(sequence);
      this.#failTerminal("HELPER_UNAVAILABLE");
      const code = internalBridgeErrorCode(error);
      if (code !== null) throw bridgeError(code);
      throw bridgeError("HELPER_UNAVAILABLE");
    }
    try {
      return await response.promise;
    } finally {
      pendingMap.delete(sequence);
    }
  }

  #write(request: TrustedWindowsNativeHelperRequestV1): Promise<void> {
    const serialized = serializeBoundedRequest(request);
    const next = this.#writeChain.then(async () => {
      if (this.#state === "closed" || this.#state === "failed") {
        throw bridgeError("HELPER_CLOSED");
      }
      await new Promise<void>((resolveWrite, rejectWrite) => {
        this.#child.stdin.write(serialized, (error: Error | null | undefined) => {
          if (error === null || error === undefined) resolveWrite();
          else rejectWrite(bridgeError("HELPER_UNAVAILABLE"));
        });
      });
    });
    this.#writeChain = next.catch(() => undefined);
    return next;
  }

  async #withDeadline<T>(
    operation: Promise<T>,
    milliseconds: number,
    timeoutCode: TrustedWindowsNativeHelperBridgeErrorCodeV1,
  ): Promise<T> {
    return await new Promise<T>((resolveOperation, rejectOperation) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = bridgeError(timeoutCode);
        this.#failTerminal(timeoutCode);
        rejectOperation(error);
      }, milliseconds);
      void operation.then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolveOperation(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          rejectOperation(bridgeError(
            internalBridgeErrorCode(error) ?? "HELPER_UNAVAILABLE",
          ));
        },
      );
    });
  }

  async #closeSession(): Promise<void> {
    this.#state = "closing";
    const requestRef = this.#nextUniqueRequestRef();
    const controlSequence = this.#takeControlSequence();
    const request: TrustedWindowsNativeHelperCloseRequestV1 = {
      type: "close",
      schema_version: 1,
      session_ref: this.#sessionRef,
      request_ref: requestRef,
      control_sequence: controlSequence,
    };
    const shutdown = (async () => {
      const response = await this.#sendBoundRequest(
        request,
        "control",
        controlSequence,
        "close_ok",
      );
      if (response.type !== "close_ok") throw bridgeError("PROTOCOL_FAILURE");
      await this.#exit.promise;
      if (this.#state !== "closed") throw bridgeError("PROTOCOL_FAILURE");
    })();
    try {
      await this.#withDeadline(shutdown, SHUTDOWN_TIMEOUT_MS, "DEADLINE_EXCEEDED");
    } catch (error: unknown) {
      await this.#forceTerminateAndWait();
      throw error;
    }
  }

  #onChildClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#exitObserved) return;
    this.#exitObserved = true;
    this.#exit.resolve({ code, signal });
    for (const waiter of this.#confirmedExitWaiters) waiter.resolve(undefined);
    this.#confirmedExitWaiters.clear();
    if (this.#stdoutRemainderBytes > 0) {
      this.#failTerminal("PROTOCOL_FAILURE");
      return;
    }
    if (this.#state === "closing" && this.#pendingControl.size === 0 &&
      this.#pendingWork.size === 0 && code === 0 && signal === null) {
      this.#state = "closed";
      this.#clearScopeReferences();
      return;
    }
    if (this.#state !== "failed" && this.#state !== "closed") {
      this.#failTerminal("HELPER_UNAVAILABLE");
    }
  }

  #failTerminal(code: TrustedWindowsNativeHelperBridgeErrorCodeV1): void {
    if (this.#state === "failed" || this.#state === "closed") return;
    this.#state = "failed";
    this.#terminalErrorCode = code;
    this.#clearScopeReferences();
    if (this.#stdoutRemainderBytes > 0) {
      this.#stdoutAccumulator.fill(0, 0, this.#stdoutRemainderBytes);
      this.#stdoutRemainderBytes = 0;
    }
    const error = bridgeError(code);
    this.#handshakeResponse.reject(error);
    for (const pending of this.#pendingWork.values()) pending.reject(error);
    for (const pending of this.#pendingControl.values()) pending.reject(error);
    this.#pendingWork.clear();
    this.#pendingControl.clear();
    const teardown = this.#forceTerminateAndWait();
    // Keep the rejection observable through close(), waitForConfirmedExit(),
    // launch failure, and every later public operation without an unhandled
    // rejection if the owner has not reached one of those paths yet.
    void teardown.catch(() => undefined);
  }

  #signalExactChild(): void {
    if (this.#exitObserved) return;
    try {
      this.#child.kill("SIGKILL");
    } catch {
      // The exact child may have exited between the last observation and kill.
    }
  }

  async #forceTerminateAndWait(): Promise<void> {
    if (this.#exitObserved) return;
    if (this.#forcedTeardown !== null) {
      await this.#forcedTeardown.promise;
      return;
    }
    const promise = new Promise<void>((resolveExit, rejectExit) => {
      let settled = false;
      this.#signalExactChild();
      const retry = setInterval(() => {
        this.#signalExactChild();
      }, 250);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(retry);
        this.#signalExactChild();
        const error = bridgeError("HELPER_TEARDOWN_UNCONFIRMED");
        for (const waiter of this.#confirmedExitWaiters) waiter.reject(error);
        this.#confirmedExitWaiters.clear();
        rejectExit(error);
      }, SHUTDOWN_TIMEOUT_MS);
      void this.#exit.promise.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(retry);
        resolveExit();
      });
    });
    const attempt: ForcedTeardownAttempt = { promise };
    this.#forcedTeardown = attempt;
    this.#mostRecentForcedTeardown = attempt;
    try {
      await attempt.promise;
    } finally {
      if (this.#forcedTeardown === attempt) this.#forcedTeardown = null;
    }
  }

  #nextUniqueRequestRef(): string {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const requestRef = makeRandomRequestRef();
      if (!this.#usedRequestRefs.has(requestRef)) {
        this.#usedRequestRefs.add(requestRef);
        return requestRef;
      }
    }
    this.#failTerminal("PROTOCOL_FAILURE");
    throw bridgeError("PROTOCOL_FAILURE");
  }

  #takeWorkSequence(): number {
    if (!Number.isSafeInteger(this.#nextWorkSequence)) {
      this.#failTerminal("PROTOCOL_FAILURE");
      throw bridgeError("PROTOCOL_FAILURE");
    }
    const sequence = this.#nextWorkSequence;
    this.#nextWorkSequence += 1;
    return sequence;
  }

  #takeControlSequence(): number {
    if (!Number.isSafeInteger(this.#nextControlSequence)) {
      this.#failTerminal("PROTOCOL_FAILURE");
      throw bridgeError("PROTOCOL_FAILURE");
    }
    const sequence = this.#nextControlSequence;
    this.#nextControlSequence += 1;
    return sequence;
  }

  async #assertReady(): Promise<void> {
    if (this.#state === "ready") return;
    if (this.#state === "failed") {
      await this.#forceTerminateAndWait();
      throw bridgeError(this.#terminalErrorCode ?? "HELPER_UNAVAILABLE");
    }
    if (this.#state === "closing") {
      if (this.#closePromise !== null) await this.#closePromise;
      throw bridgeError("HELPER_CLOSED");
    }
    if (this.#state === "closed") {
      throw bridgeError("HELPER_CLOSED");
    }
    throw bridgeError("HELPER_UNAVAILABLE");
  }

  #isFailed(): boolean {
    return this.#state === "failed";
  }
}

function productionChildFactory(
  command: string,
  args: readonly string[],
  options: NativeHelperSpawnOptions,
): NativeHelperChildProcess {
  return spawn(command, args, options);
}

function allocateResponseAccumulator(): Buffer {
  try {
    return Buffer.alloc(MAX_HELPER_RESPONSE_BYTES);
  } catch {
    throw bridgeError("HELPER_UNAVAILABLE");
  }
}

function observeSpawnedChildExit(child: NativeHelperChildProcess): Promise<void> {
  const observed = deferred<undefined>();
  child.once("close", () => {
    observed.resolve(undefined);
  });
  // A production ChildProcess emits errors asynchronously. Attach this guard
  // before any await so construction cannot leave an unhandled child error.
  child.once("error", () => { /* observed by the bridge after construction */ });
  return observed.promise;
}

async function terminateSpawnedChildAndConfirm(
  child: NativeHelperChildProcess,
  exit: Promise<void>,
): Promise<void> {
  await new Promise<void>((resolveExit, rejectExit) => {
    let settled = false;
    const signal = (): void => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Confirmation still comes only from the exact child's close event.
      }
    };
    signal();
    const retry = setInterval(signal, 250);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(retry);
      signal();
      rejectExit(bridgeError("HELPER_TEARDOWN_UNCONFIRMED"));
    }, SHUTDOWN_TIMEOUT_MS);
    void exit.then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(retry);
      resolveExit();
    });
  });
}

async function launchBridge(
  configuration: TrustedWindowsNativeHelperBridgeConfigurationV1,
  childFactory: TrustedWindowsNativeHelperChildFactoryV1,
): Promise<TrustedWindowsNativeHelperProcessBridgeV1> {
  assertTrustedConfiguration(configuration);
  const stdoutAccumulator = allocateResponseAccumulator();
  const sessionRef = makeRandomSessionRef();
  let challengeHex: string;
  try {
    challengeHex = randomBytes(32).toString("hex");
  } catch {
    throw bridgeError("HELPER_UNAVAILABLE");
  }
  const verifiedHandle = await openVerifiedExecutable(configuration);
  let child: NativeHelperChildProcess | null = null;
  let rawExit: Promise<void> | null = null;
  let bridge: NativeHelperProcessBridge | null = null;
  let constructionFailed = false;
  try {
    child = childFactory(configuration.executablePath, [], {
      cwd: dirname(configuration.executablePath),
      env: buildMinimalEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      detached: false,
    });
    rawExit = observeSpawnedChildExit(child);
    bridge = new NativeHelperProcessBridge({
      child,
      expectedExecutableSha256: configuration.expectedExecutableSha256,
      sessionRef,
      challengeHex,
      stdoutAccumulator,
    });
  } catch {
    constructionFailed = true;
  } finally {
    await verifiedHandle.close().catch(() => undefined);
  }
  if (constructionFailed || bridge === null) {
    if (child !== null && rawExit !== null) {
      await terminateSpawnedChildAndConfirm(child, rawExit);
    } else if (child !== null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // No close observer could be attached, so teardown is unconfirmed.
      }
      throw bridgeError("HELPER_TEARDOWN_UNCONFIRMED");
    }
    throw bridgeError("HELPER_UNAVAILABLE");
  }
  try {
    await bridge.establishHandshake();
    return bridge;
  } catch (error: unknown) {
    try {
      await bridge.close();
    } catch (teardownError: unknown) {
      if (internalBridgeErrorCode(teardownError) === "HELPER_TEARDOWN_UNCONFIRMED") {
        throw bridgeError("HELPER_TEARDOWN_UNCONFIRMED");
      }
      throw bridgeError("HELPER_TEARDOWN_UNCONFIRMED");
    }
    const code = internalBridgeErrorCode(error);
    if (code !== null) throw bridgeError(code);
    throw bridgeError("HANDSHAKE_FAILED");
  }
}

/** Production launcher. The executable path and digest are trusted process configuration. */
export async function launchTrustedWindowsNativeHelperProcessBridgeV1(
  configuration: TrustedWindowsNativeHelperBridgeConfigurationV1,
): Promise<TrustedWindowsNativeHelperProcessBridgeV1> {
  return await launchBridge(configuration, productionChildFactory);
}

/** @internal Focused-test seam. It is intentionally absent from every barrel, CLI, and browser route. */
export async function launchTrustedWindowsNativeHelperProcessBridgeForTestingV1(
  configuration: TrustedWindowsNativeHelperBridgeConfigurationV1,
  childFactory: TrustedWindowsNativeHelperChildFactoryV1,
): Promise<TrustedWindowsNativeHelperProcessBridgeV1> {
  return await launchBridge(configuration, childFactory);
}

export function mapTrustedWindowsNativeHelperFailureForBrowserV1(
  error: unknown,
): TrustedWindowsNativeHelperBrowserFailureV1 {
  const code = internalBridgeErrorCode(error);
  if (code === "OPERATION_CANCELLED") {
    return {
      status: "cancelled",
      code: "LOCAL_SELECTION_CANCELLED",
      message: "The local selection was stopped.",
    };
  }
  if (code === "OPERATION_BUSY") {
    return {
      status: "failed",
      code: "LOCAL_SELECTION_BUSY",
      message: "Another local selection is already in progress.",
    };
  }
  return {
    status: "failed",
    code: "LOCAL_SELECTION_UNAVAILABLE",
    message: "The local Windows selection could not be completed.",
  };
}

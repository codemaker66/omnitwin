import { createHash, type KeyObject } from "node:crypto";
import {
  constants as filesystemConstants,
  existsSync,
  type BigIntStats,
} from "node:fs";
import {
  lstat,
  open,
  type FileHandle,
} from "node:fs/promises";
import { createRequire } from "node:module";
import {
  isAbsolute,
  join as joinPath,
  parse as parsePath,
  resolve as resolvePath,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Worker,
  type WorkerOptions,
  type ResourceLimits,
} from "node:worker_threads";
import {
  FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema,
  verifyFoundryOfflineNormalizeMeshGlbPreviewPermit,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
  type FoundryOfflineNormalizeMeshGlbPreviewVerifiedPermit,
} from "../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview.js";
import {
  DsseEnvelopeSchema,
} from "../../../packages/reconstruction-foundry/src/dsse.js";
import {
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES,
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0,
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESOURCE_LIMITS,
  parseLocalOfflineNormalizationPreviewVerifierResult,
  type LocalOfflineNormalizationPreviewVerifierInput,
} from "./local-offline-normalization-preview-verifier.js";

export const LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_INPUT_V0 =
  "omnitwin.local-offline-normalization-preview-helper-input.v0";
export const LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0 =
  "omnitwin.local-offline-normalization-preview-helper-result.v0";

const RECEIPT_SHA256 = /^[a-f0-9]{64}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/u;
const REQUEST_ID = /^[a-f0-9]{32}$/u;
const DEFAULT_HELPER_TIMEOUT_MS = 20_000;
const MAX_HELPER_TIMEOUT_MS = 60_000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_SESSION_REQUESTS = 256;
const MAX_PROCESS_CONSUMED_PERMITS = 4_096;
const LIFECYCLE_CONFIRMATION_GRACE_MS = 100;
const HELPER_TERMINATION_UNCONFIRMED_CODE =
  "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED";
const SOURCE_HANDLE_CLOSE_UNCONFIRMED_CODE =
  "LOCAL_OFFLINE_PREVIEW_SOURCE_HANDLE_CLOSE_UNCONFIRMED";

/**
 * Synchronous consume-once ledger shared by every controller in this Node
 * process. It is intentionally not a persistence claim across process restart.
 */
const PROCESS_CONSUMED_PERMIT_DIGESTS = new Set<string>();

function processPermitWasConsumed(digest: string): boolean {
  return PROCESS_CONSUMED_PERMIT_DIGESTS.has(digest);
}

function consumeProcessPermit(
  digest: string,
): "consumed" | "replay" | "ledger_full" {
  if (PROCESS_CONSUMED_PERMIT_DIGESTS.has(digest)) return "replay";
  if (
    PROCESS_CONSUMED_PERMIT_DIGESTS.size >= MAX_PROCESS_CONSUMED_PERMITS
  ) {
    return "ledger_full";
  }
  // Never prune consumed digests while this process is alive. Removing an
  // expired entry would make a wall-clock rollback able to resurrect it.
  PROCESS_CONSUMED_PERMIT_DIGESTS.add(digest);
  return "consumed";
}

async function waitForLifecycleConfirmation(
  attempt: Promise<boolean>,
  isConfirmed: () => boolean,
): Promise<boolean> {
  if (isConfirmed()) return true;
  let resolveGrace!: (value: boolean) => void;
  const graceExpired = new Promise<boolean>((resolve) => {
    resolveGrace = resolve;
  });
  const graceTimer = setTimeout(() => {
    resolveGrace(false);
  }, LIFECYCLE_CONFIRMATION_GRACE_MS);
  try {
    const attemptResult = await Promise.race([attempt, graceExpired]);
    return attemptResult || isConfirmed();
  } finally {
    clearTimeout(graceTimer);
  }
}

export type LocalOfflineNormalizationPreviewTrustedKeys = ReadonlyMap<
  string,
  KeyObject
>;

export const LOCAL_OFFLINE_NORMALIZATION_PREVIEW_RESOURCE_LIMITS =
  Object.freeze({
    maxOldGenerationSizeMb: 512,
    maxYoungGenerationSizeMb: 64,
    codeRangeSizeMb: 64,
    stackSizeMb: 4,
  } satisfies ResourceLimits);

export type LocalOfflineNormalizationPreviewState =
  | "blocked"
  | "ready"
  | "running"
  | "verified"
  | "failed";

/** The complete and only browser-facing start request. */
export interface LocalOfflineNormalizationPreviewStartRequest {
  readonly receiptSha256: string;
  readonly previewAssetId: string;
  readonly requestId: string;
}

/** Process-owned path binding. It must never be built from a browser value. */
export interface LocalOfflineNormalizationPreviewAssetBinding {
  readonly receiptSha256: string;
  readonly absolutePath: string;
}

/** Process-owned signed evidence. It must never come from a browser request. */
export interface LocalOfflineNormalizationPreviewPermitEvidence {
  readonly previewAssetId: string;
  readonly invocation: unknown;
  readonly permitEnvelope: unknown;
}

export interface LocalOfflineNormalizationPreviewDto {
  readonly state: LocalOfflineNormalizationPreviewState;
  readonly previewAssetId: string | null;
  readonly requestId: string | null;
  readonly message: string;
  readonly source: {
    readonly sizeBytes: number;
    readonly sha256: string;
  } | null;
  readonly output: {
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly reportSha256: string;
    readonly semanticExactMatch: true;
  } | null;
  readonly productionExecution: "disabled";
  readonly authority: "none";
  readonly serverPersistence: "none";
  readonly custody: "session_memory_only";
  readonly trustedSourceOnly: true;
  readonly localVolumeEstablished: false;
  readonly sandboxEstablished: false;
}

export const LOCAL_OFFLINE_NORMALIZATION_PREVIEW_INITIAL_DTO = Object.freeze({
  state: "blocked",
  previewAssetId: null,
  requestId: null,
  message:
    "No trusted process-side offline preview is configured for this local session.",
  source: null,
  output: null,
  productionExecution: "disabled",
  authority: "none",
  serverPersistence: "none",
  custody: "session_memory_only",
  trustedSourceOnly: true,
  localVolumeEstablished: false,
  sandboxEstablished: false,
} as const satisfies LocalOfflineNormalizationPreviewDto);

export interface LocalOfflineNormalizationPreviewVerifiedResult {
  readonly normalizedGlb: Buffer;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
}

/**
 * One bounded, revocable copy used while an HTTP response is sending bytes.
 * Call release exactly once when the response finishes or closes. Release is
 * idempotent, and controller stop/expiry may revoke the copy first.
 */
export interface LocalOfflineNormalizationPreviewOutputLease {
  readonly normalizedGlb: Buffer;
  release(): void;
}

export interface LocalOfflineNormalizationPreviewHelperInput {
  readonly schemaVersion: typeof LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_INPUT_V0;
  readonly sourceBytes: ArrayBuffer;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly permitEnvelope: unknown;
  /** Public verification keys only. They are process-pinned, not browser input. */
  readonly pinnedTrustedPermitKeys: LocalOfflineNormalizationPreviewTrustedKeys;
}

export interface LocalOfflineNormalizationPreviewHelperSuccess {
  readonly schemaVersion: typeof LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0;
  readonly kind: "completed";
  readonly normalizedGlb: ArrayBuffer;
  readonly report: unknown;
}

export interface LocalOfflineNormalizationPreviewHelperFailure {
  readonly schemaVersion: typeof LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0;
  readonly kind: "failed";
  readonly code: string;
}

export interface LocalOfflineNormalizationPreviewHelperLike {
  once(event: "message", listener: (value: unknown) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

export interface LocalOfflineNormalizationPreviewHelperLaunch {
  readonly scriptUrl: URL;
  readonly options: WorkerOptions;
}

export type LocalOfflineNormalizationPreviewHelperFactory = (
  launch: LocalOfflineNormalizationPreviewHelperLaunch,
) => LocalOfflineNormalizationPreviewHelperLike;

export interface CreateLocalOfflineNormalizationPreviewControllerOptions {
  readonly assetsByPreviewAssetId: ReadonlyMap<
    string,
    LocalOfflineNormalizationPreviewAssetBinding
  >;
  readonly evidenceByReceiptSha256: ReadonlyMap<
    string,
    LocalOfflineNormalizationPreviewPermitEvidence
  >;
  readonly pinnedTrustedPermitKeys: LocalOfflineNormalizationPreviewTrustedKeys;
  readonly helperTimeoutMs?: number;
  /** Process-side injection seam used by focused tests and reviewed hosts only. */
  readonly helperFactory?: LocalOfflineNormalizationPreviewHelperFactory;
  /** Test-only close seam. Production hosts must use the default exact close. */
  readonly sourceHandleCloser?: (handle: FileHandle) => Promise<void>;
}

interface StoredAssetBinding {
  readonly receiptSha256: string;
  readonly absolutePath: string;
}

interface StoredEvidence {
  readonly previewAssetId: string;
  readonly invocation: unknown;
  readonly permitEnvelope: unknown;
}

interface PreparedRequest {
  readonly request: LocalOfflineNormalizationPreviewStartRequest;
  readonly asset: StoredAssetBinding;
  readonly evidence: StoredEvidence;
  readonly verifiedPermit: FoundryOfflineNormalizeMeshGlbPreviewVerifiedPermit;
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly nlink: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

interface ExactSourceRead {
  readonly bytes: Buffer;
  readonly identity: FileIdentity;
}

interface ActiveRequest {
  readonly requestId: string;
  abortCode: string | null;
  readonly abortController: AbortController;
  readonly deadlineAt: number;
  readonly deadlineCode: string;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  helperLifecycle: TrackedHelperLifecycle | null;
  abortHelper: ((code: string) => Promise<boolean>) | null;
  readonly settled: Promise<void>;
  readonly resolveSettled: () => void;
}

interface TrackedHelperLifecycle {
  readonly requestId: string;
  readonly helper: LocalOfflineNormalizationPreviewHelperLike;
  terminationConfirmed: boolean;
  terminationAttempt: Promise<boolean> | null;
  terminationRetryTimer: ReturnType<typeof setTimeout> | null;
}

interface TrackedOutputLease {
  readonly requestId: string;
  readonly normalizedGlb: Buffer;
  readonly onRevoke: () => void;
  released: boolean;
}

interface TrackedSourceHandle {
  readonly requestId: string;
  readonly handle: FileHandle;
  closeConfirmed: boolean;
  closeAttempt: Promise<boolean> | null;
  closeRetryTimer: ReturnType<typeof setTimeout> | null;
}

type OpenTrackedSourceHandle = (
  absolutePath: string,
  flags: number,
  signal: AbortSignal,
) => Promise<TrackedSourceHandle>;

type CloseTrackedSourceHandle = (
  lifecycle: TrackedSourceHandle,
) => Promise<boolean>;

interface RetainedVerifiedResult
  extends LocalOfflineNormalizationPreviewVerifiedResult {
  readonly expiresAt: string;
  readonly expiryTimer: ReturnType<typeof setTimeout>;
}

class LocalOfflineNormalizationPreviewError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalOfflineNormalizationPreviewError";
    this.code = code;
  }
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new LocalOfflineNormalizationPreviewError(code, message, { cause });
}

function copyAndFreezeJson<T>(value: T): T {
  const copied = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null) return;
    Object.freeze(candidate);
    for (const nested of Object.values(candidate as Record<string, unknown>)) {
      freeze(nested);
    }
  };
  freeze(copied);
  return copied;
}

function bestEffortOverwrite(bytes: Uint8Array | null | undefined): void {
  if (bytes === null || bytes === undefined) return;
  try {
    bytes.fill(0);
  } catch {
    // Best effort only. Detached or immutable backing stores cannot be erased.
  }
}

function helperOutputBuffers(value: unknown): ArrayBuffer[] {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return [];
  }
  const raw = value as Record<string, unknown>;
  const buffers: ArrayBuffer[] = [];
  for (const field of ["normalizedGlb", "candidateOutputBytes"] as const) {
    const candidate = raw[field];
    if (candidate instanceof ArrayBuffer) buffers.push(candidate);
  }
  return buffers;
}

function bestEffortOverwriteHelperOutput(value: unknown): void {
  for (const output of helperOutputBuffers(value)) {
    try {
      bestEffortOverwrite(new Uint8Array(output));
    } catch {
      // A transferred backing store may already be detached.
    }
  }
}

function bestEffortOverwriteArrayBuffer(value: ArrayBuffer): void {
  try {
    bestEffortOverwrite(new Uint8Array(value));
  } catch {
    // A successful transfer detaches the parent-side backing store.
  }
}

function copyToTransferable(bytes: Uint8Array): ArrayBuffer {
  const transferable = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(transferable).set(bytes);
  return transferable;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function parseStartRequest(
  input: unknown,
): LocalOfflineNormalizationPreviewStartRequest {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !exactKeys(input as Record<string, unknown>, [
      "previewAssetId",
      "receiptSha256",
      "requestId",
    ])
  ) {
    fail(
      "LOCAL_OFFLINE_PREVIEW_REQUEST_INVALID",
      "The offline preview start request must contain only its three opaque identifiers.",
    );
  }
  const raw = input as Record<string, unknown>;
  if (
    typeof raw.previewAssetId !== "string" ||
    !OPAQUE_ID.test(raw.previewAssetId) ||
    typeof raw.requestId !== "string" ||
    !REQUEST_ID.test(raw.requestId) ||
    typeof raw.receiptSha256 !== "string" ||
    !RECEIPT_SHA256.test(raw.receiptSha256)
  ) {
    fail(
      "LOCAL_OFFLINE_PREVIEW_REQUEST_INVALID",
      "The offline preview start request identifiers are invalid.",
    );
  }
  return Object.freeze({
    previewAssetId: raw.previewAssetId,
    receiptSha256: raw.receiptSha256,
    requestId: raw.requestId,
  });
}

function sameStartRequest(
  left: LocalOfflineNormalizationPreviewStartRequest,
  right: LocalOfflineNormalizationPreviewStartRequest,
): boolean {
  return left.receiptSha256 === right.receiptSha256 &&
    left.previewAssetId === right.previewAssetId &&
    left.requestId === right.requestId;
}

function sourceDto(
  verified: FoundryOfflineNormalizeMeshGlbPreviewVerifiedPermit,
): NonNullable<LocalOfflineNormalizationPreviewDto["source"]> {
  return Object.freeze({
    sizeBytes: verified.invocation.source.sizeBytes,
    sha256: verified.invocation.source.sha256,
  });
}

function dto(
  request: LocalOfflineNormalizationPreviewStartRequest,
  state: LocalOfflineNormalizationPreviewState,
  options: {
    readonly output?: LocalOfflineNormalizationPreviewDto["output"];
    readonly source?: LocalOfflineNormalizationPreviewDto["source"];
    readonly failureCode?: string;
    readonly message?: string;
  } = {},
): LocalOfflineNormalizationPreviewDto {
  const message = options.message !== undefined
    ? options.failureCode === undefined
      ? options.message
      : `${options.message} (${options.failureCode})`
    : (options.failureCode === undefined
    ? state === "ready"
      ? "This trusted private source is ready for one offline preview run."
      : state === "running"
        ? "A helper thread with byte caps and V8 heap settings is creating the private preview. Those settings are not a whole-process memory limit or a sandbox."
        : state === "verified"
          ? "The private preview passed a separate fresh-verification helper and remains in session memory only."
          : "The private offline preview is blocked."
    : options.failureCode === HELPER_TERMINATION_UNCONFIRMED_CODE
      ? `The helper could not be confirmed stopped. No output was accepted. Stop the controller again to retry (${options.failureCode}).`
      : options.failureCode === SOURCE_HANDLE_CLOSE_UNCONFIRMED_CODE
        ? `The read-only source-file handle could not be confirmed closed. No output was accepted. Stop the controller again to retry (${options.failureCode}).`
      : `The private offline preview stopped safely without retaining unverified output (${options.failureCode}).`);
  return Object.freeze({
    state,
    previewAssetId: request.previewAssetId,
    requestId: request.requestId,
    message,
    source: options.source ?? null,
    output: options.output ?? null,
    productionExecution: "disabled",
    authority: "none",
    serverPersistence: "none",
    custody: "session_memory_only",
    trustedSourceOnly: true,
    localVolumeEstablished: false,
    sandboxEstablished: false,
  });
}

function availabilityDto(options: {
  readonly state: "blocked" | "ready";
  readonly previewAssetId?: string;
  readonly source?: LocalOfflineNormalizationPreviewDto["source"];
  readonly message: string;
}): LocalOfflineNormalizationPreviewDto {
  return Object.freeze({
    state: options.state,
    previewAssetId: options.previewAssetId ?? null,
    requestId: null,
    message: options.message,
    source: options.source ?? null,
    output: null,
    productionExecution: "disabled",
    authority: "none",
    serverPersistence: "none",
    custody: "session_memory_only",
    trustedSourceOnly: true,
    localVolumeEstablished: false,
    sandboxEstablished: false,
  });
}

function publicCode(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    /^[A-Z0-9_]{3,128}$/u.test(
      (error as { readonly code: string }).code,
    )
  ) {
    return (error as { readonly code: string }).code;
  }
  return fallback;
}

function identity(metadata: BigIntStats): FileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    mode: metadata.mode,
    nlink: metadata.nlink,
    size: metadata.size,
    mtimeNs: metadata.mtimeNs,
    ctimeNs: metadata.ctimeNs,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function assertRegularSingleLink(
  metadata: BigIntStats,
  expectedSize: number,
): void {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n) {
    fail(
      "LOCAL_OFFLINE_PREVIEW_SOURCE_NOT_EXACT_REGULAR_FILE",
      "The preview source must be one exact single-link regular file.",
    );
  }
  if (
    metadata.size !== BigInt(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > MAX_SOURCE_BYTES
  ) {
    fail(
      "LOCAL_OFFLINE_PREVIEW_SOURCE_SIZE_MISMATCH",
      "The preview source size does not match its signed invocation.",
    );
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new LocalOfflineNormalizationPreviewError(
      "LOCAL_OFFLINE_PREVIEW_CANCELLED",
      "The private offline preview was stopped.",
    );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

async function awaitFileOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const value = await operation;
  throwIfAborted(signal);
  return value;
}

async function readExactSource(
  absolutePath: string,
  invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  signal: AbortSignal,
  openTrackedHandle: OpenTrackedSourceHandle,
  closeTrackedHandle: CloseTrackedSourceHandle,
): Promise<ExactSourceRead> {
  let lifecycle: TrackedSourceHandle | null = null;
  let bytes: Buffer | null = null;
  try {
    const root = parsePath(absolutePath).root;
    let componentPath = root;
    for (
      const component of absolutePath
        .slice(root.length)
        .split(/[\\/]+/u)
        .filter((value) => value.length > 0)
    ) {
      componentPath = joinPath(componentPath, component);
      const componentMetadata = await awaitFileOperation(
        lstat(componentPath, { bigint: true }),
        signal,
      );
      if (componentMetadata.isSymbolicLink()) {
        fail(
          "LOCAL_OFFLINE_PREVIEW_SOURCE_NOT_EXACT_REGULAR_FILE",
          "The preview source path must not contain a symbolic link or junction.",
        );
      }
    }
    const before = await awaitFileOperation(
      lstat(absolutePath, { bigint: true }),
      signal,
    );
    assertRegularSingleLink(before, invocation.source.sizeBytes);
    const noFollow = "O_NOFOLLOW" in filesystemConstants
      ? filesystemConstants.O_NOFOLLOW
      : 0;
    lifecycle = await openTrackedHandle(
      absolutePath,
      filesystemConstants.O_RDONLY | noFollow,
      signal,
    );
    const handle = lifecycle.handle;
    const opened = await awaitFileOperation(
      handle.stat({ bigint: true }),
      signal,
    );
    const pathAfterOpen = await awaitFileOperation(
      lstat(absolutePath, { bigint: true }),
      signal,
    );
    assertRegularSingleLink(opened, invocation.source.sizeBytes);
    assertRegularSingleLink(pathAfterOpen, invocation.source.sizeBytes);
    const openedIdentity = identity(opened);
    if (
      !sameIdentity(identity(before), openedIdentity) ||
      !sameIdentity(identity(pathAfterOpen), openedIdentity)
    ) {
      fail(
        "LOCAL_OFFLINE_PREVIEW_SOURCE_IDENTITY_CHANGED",
        "The preview source path changed while its read-only handle was opened.",
      );
    }

    bytes = Buffer.alloc(invocation.source.sizeBytes);
    let offset = 0;
    const stream = handle.createReadStream({
      autoClose: false,
      start: 0,
      end: bytes.length - 1,
      highWaterMark: 1024 * 1024,
      signal,
    });
    for await (const rawChunk of stream) {
      throwIfAborted(signal);
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk as Uint8Array);
      if (offset + chunk.byteLength > bytes.length) {
        fail(
          "LOCAL_OFFLINE_PREVIEW_SOURCE_SIZE_MISMATCH",
          "The preview source exceeded its signed byte length.",
        );
      }
      chunk.copy(bytes, offset);
      offset += chunk.byteLength;
    }
    if (offset !== bytes.length) {
      fail(
        "LOCAL_OFFLINE_PREVIEW_SOURCE_SHORT_READ",
        "The preview source ended before its signed byte length.",
      );
    }

    const after = await awaitFileOperation(
      handle.stat({ bigint: true }),
      signal,
    );
    const pathAfterRead = await awaitFileOperation(
      lstat(absolutePath, { bigint: true }),
      signal,
    );
    assertRegularSingleLink(after, invocation.source.sizeBytes);
    assertRegularSingleLink(pathAfterRead, invocation.source.sizeBytes);
    if (
      !sameIdentity(openedIdentity, identity(after)) ||
      !sameIdentity(openedIdentity, identity(pathAfterRead))
    ) {
      fail(
        "LOCAL_OFFLINE_PREVIEW_SOURCE_IDENTITY_CHANGED",
        "The preview source changed during its exact read-only read.",
      );
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (`sha256:${digest}` !== invocation.source.sha256) {
      fail(
        "LOCAL_OFFLINE_PREVIEW_SOURCE_HASH_MISMATCH",
        "The preview source bytes do not match their signed SHA-256.",
      );
    }
    if (!await closeTrackedHandle(lifecycle)) {
      fail(
        SOURCE_HANDLE_CLOSE_UNCONFIRMED_CODE,
        "The read-only source handle could not be confirmed closed.",
      );
    }
    lifecycle = null;
    return { bytes, identity: openedIdentity };
  } catch (error: unknown) {
    bestEffortOverwrite(bytes);
    if (
      lifecycle !== null &&
      !await closeTrackedHandle(lifecycle)
    ) {
      fail(
        SOURCE_HANDLE_CLOSE_UNCONFIRMED_CODE,
        "The read-only source handle could not be confirmed closed.",
        error,
      );
    }
    if (signal.aborted) throw abortReason(signal);
    if (error instanceof LocalOfflineNormalizationPreviewError) throw error;
    fail(
      "LOCAL_OFFLINE_PREVIEW_SOURCE_READ_FAILED",
      "The exact read-only preview source could not be verified.",
      error,
    );
  }
}

function parseHelperSuccess(
  value: unknown,
): LocalOfflineNormalizationPreviewHelperSuccess {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    fail(
      "LOCAL_OFFLINE_PREVIEW_HELPER_MESSAGE_INVALID",
      "The helper returned a malformed result.",
    );
  }
  const raw = value as Record<string, unknown>;
  if (
    exactKeys(raw, ["code", "kind", "schemaVersion"]) &&
    raw.schemaVersion ===
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0 &&
    raw.kind === "failed" &&
    typeof raw.code === "string" &&
    /^[A-Z0-9_]{3,128}$/u.test(raw.code)
  ) {
    fail(raw.code, "The helper rejected the private preview safely.");
  }
  if (
    !exactKeys(raw, [
      "kind",
      "normalizedGlb",
      "report",
      "schemaVersion",
    ]) ||
    raw.schemaVersion !==
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0 ||
    raw.kind !== "completed" ||
    !(raw.normalizedGlb instanceof ArrayBuffer) ||
    raw.normalizedGlb.byteLength <= 0 ||
    raw.normalizedGlb.byteLength > MAX_SOURCE_BYTES
  ) {
    fail(
      "LOCAL_OFFLINE_PREVIEW_HELPER_MESSAGE_INVALID",
      "The helper returned a malformed result.",
    );
  }
  return {
    schemaVersion: LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0,
    kind: "completed",
    normalizedGlb: raw.normalizedGlb,
    report: raw.report,
  };
}

function defaultHelperFactory(
  launch: LocalOfflineNormalizationPreviewHelperLaunch,
): LocalOfflineNormalizationPreviewHelperLike {
  if (existsSync(fileURLToPath(launch.scriptUrl))) {
    return new Worker(launch.scriptUrl, launch.options);
  }

  // Source-tree tests do not have the compiled `.js` worker beside this file.
  // Register tsx inside the helper and import the fixed `.ts` entry. The URLs
  // are embedded in trusted bootstrap code, never accepted in workerData.
  const require = createRequire(import.meta.url);
  const tsxApiUrl = pathToFileURL(require.resolve("tsx/esm/api")).href;
  const compiledEntryPath = fileURLToPath(launch.scriptUrl);
  const fixedEntries = [
    "offline-normalization-preview.worker",
    "offline-normalization-preview-verifier.worker",
  ] as const;
  const fixedEntry = fixedEntries.find(
    (entry) =>
      fileURLToPath(new URL(`./${entry}.js`, import.meta.url)) ===
        compiledEntryPath,
  );
  if (fixedEntry === undefined) {
    throw new TypeError("offline preview helper entry is not fixed");
  }
  const sourceEntryUrl = new URL(`./${fixedEntry}.ts`, import.meta.url).href;
  const tsconfigPath = fileURLToPath(
    new URL("../tsconfig.json", import.meta.url),
  );
  const parentUrl = import.meta.url;
  const bootstrap = `void (async () => { const { tsImport } = await import(${JSON.stringify(
    tsxApiUrl,
  )}); await tsImport(${JSON.stringify(sourceEntryUrl)}, { parentURL: ${JSON.stringify(
    parentUrl,
  )}, tsconfig: ${JSON.stringify(tsconfigPath)} }); })();`;
  return new Worker(bootstrap, { ...launch.options, eval: true });
}

export class LocalOfflineNormalizationPreviewController {
  readonly #assets: ReadonlyMap<string, StoredAssetBinding>;
  readonly #evidence: ReadonlyMap<string, StoredEvidence>;
  readonly #keys: LocalOfflineNormalizationPreviewTrustedKeys;
  readonly #helperFactory: LocalOfflineNormalizationPreviewHelperFactory;
  readonly #sourceHandleCloser: (handle: FileHandle) => Promise<void>;
  readonly #helperTimeoutMs: number;
  readonly #states = new Map<string, LocalOfflineNormalizationPreviewDto>();
  readonly #requestBindings = new Map<
    string,
    LocalOfflineNormalizationPreviewStartRequest
  >();
  readonly #prepared = new Map<string, PreparedRequest>();
  readonly #results = new Map<
    string,
    RetainedVerifiedResult
  >();
  readonly #trackedHelpers = new Set<TrackedHelperLifecycle>();
  readonly #trackedSourceHandles = new Set<TrackedSourceHandle>();
  #outputLease: TrackedOutputLease | null = null;
  #active: ActiveRequest | null = null;
  #stopped = false;

  constructor(
    options: CreateLocalOfflineNormalizationPreviewControllerOptions,
  ) {
    if (
      !Number.isInteger(options.helperTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS) ||
      (options.helperTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS) <= 0 ||
      (options.helperTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS) >
        MAX_HELPER_TIMEOUT_MS
    ) {
      throw new TypeError("helperTimeoutMs is outside the fixed local bound");
    }
    this.#helperTimeoutMs =
      options.helperTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS;
    this.#helperFactory = options.helperFactory ?? defaultHelperFactory;
    this.#sourceHandleCloser = options.sourceHandleCloser ??
      ((handle) => handle.close());
    this.#keys = new Map(options.pinnedTrustedPermitKeys);

    const assets = new Map<string, StoredAssetBinding>();
    for (const [previewAssetId, record] of options.assetsByPreviewAssetId) {
      const canonicalPath = resolvePath(record.absolutePath);
      if (
        !OPAQUE_ID.test(previewAssetId) ||
        !RECEIPT_SHA256.test(record.receiptSha256) ||
        !isAbsolute(record.absolutePath) ||
        record.absolutePath !== canonicalPath ||
        /^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/u.test(record.absolutePath)
      ) {
        throw new TypeError("process-owned offline preview asset binding is invalid");
      }
      assets.set(
        previewAssetId,
        Object.freeze({
          receiptSha256: record.receiptSha256,
          absolutePath: canonicalPath,
        }),
      );
    }
    this.#assets = assets;

    const evidence = new Map<string, StoredEvidence>();
    for (const [receiptSha256, record] of options.evidenceByReceiptSha256) {
      if (
        !RECEIPT_SHA256.test(receiptSha256) ||
        !OPAQUE_ID.test(record.previewAssetId)
      ) {
        throw new TypeError("process-owned offline preview evidence is invalid");
      }
      evidence.set(
        receiptSha256,
        Object.freeze({
          previewAssetId: record.previewAssetId,
          invocation: copyAndFreezeJson(record.invocation),
          permitEnvelope: copyAndFreezeJson(record.permitEnvelope),
        }),
      );
    }
    this.#evidence = evidence;
  }

  /**
   * Returns only the path-free browser facts needed to decide whether Start
   * can be shown. Permit validity is rechecked on every call.
   */
  availability(receiptSha256?: string): LocalOfflineNormalizationPreviewDto {
    if (
      receiptSha256 !== undefined &&
      !RECEIPT_SHA256.test(receiptSha256)
    ) {
      return structuredClone(
        availabilityDto({
          state: "blocked",
          message: "No trusted private offline preview matches this receipt.",
        }),
      );
    }
    if (this.#stopped) {
      return structuredClone(
        availabilityDto({
          state: "blocked",
          message: "The private offline preview controller is stopped.",
        }),
      );
    }
    if (
      this.#trackedHelpers.size > 0 ||
      this.#trackedSourceHandles.size > 0
    ) {
      return structuredClone(
        availabilityDto({
          state: "blocked",
          message:
            "A prior helper or source-file handle could not be confirmed closed. Stop the controller again before starting another preview.",
        }),
      );
    }

    const candidates: Array<{
      readonly previewAssetId: string;
      readonly verifiedPermit: FoundryOfflineNormalizeMeshGlbPreviewVerifiedPermit;
    }> = [];
    for (const [candidateReceiptSha256, evidence] of this.#evidence) {
      if (
        receiptSha256 !== undefined &&
        candidateReceiptSha256 !== receiptSha256
      ) {
        continue;
      }
      const asset = this.#assets.get(evidence.previewAssetId);
      if (
        asset === undefined ||
        asset.receiptSha256 !== candidateReceiptSha256
      ) {
        continue;
      }
      try {
        const verifiedPermit =
          verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
            invocation: evidence.invocation,
            permitEnvelope: evidence.permitEnvelope,
            pinnedTrustedPermitKeys: this.#keys,
          });
        if (
          processPermitWasConsumed(
            verifiedPermit.permitPayloadSha256,
          )
        ) {
          continue;
        }
        candidates.push({
          previewAssetId: evidence.previewAssetId,
          verifiedPermit,
        });
      } catch {
        // An invalid, untrusted, not-yet-valid, or expired candidate is absent.
      }
    }

    if (candidates.length !== 1) {
      return structuredClone(
        availabilityDto({
          state: "blocked",
          message:
            candidates.length === 0
              ? "No trusted private offline preview is available for this receipt."
              : "More than one private offline preview matches; choose an exact receipt.",
        }),
      );
    }
    const candidate = candidates[0];
    if (candidate === undefined) {
      return structuredClone(
        availabilityDto({
          state: "blocked",
          message: "No trusted private offline preview is available for this receipt.",
        }),
      );
    }
    return structuredClone(
      availabilityDto({
        state: "ready",
        previewAssetId: candidate.previewAssetId,
        source: sourceDto(candidate.verifiedPermit),
        message:
          "One trusted private source is ready for an offline preview request.",
      }),
    );
  }

  prepare(
    input: LocalOfflineNormalizationPreviewStartRequest,
  ): LocalOfflineNormalizationPreviewDto {
    const request = parseStartRequest(input);
    const boundRequest = this.#requestBindings.get(request.requestId);
    if (
      boundRequest !== undefined &&
      !sameStartRequest(boundRequest, request)
    ) {
      return dto(request, "blocked", {
        failureCode: "LOCAL_OFFLINE_PREVIEW_REQUEST_ID_CONFLICT",
      });
    }
    const prior = this.#states.get(request.requestId);
    if (prior !== undefined) return prior;
    if (this.#requestBindings.size >= MAX_SESSION_REQUESTS) {
      return dto(request, "blocked", {
        failureCode: "LOCAL_OFFLINE_PREVIEW_SESSION_REQUEST_LIMIT",
      });
    }
    this.#requestBindings.set(request.requestId, request);
    if (this.#stopped) {
      return this.#record(
        dto(request, "blocked", {
          failureCode: "LOCAL_OFFLINE_PREVIEW_CONTROLLER_STOPPED",
        }),
      );
    }
    if (this.#active !== null) {
      return this.#record(
        dto(request, "blocked", {
          failureCode: "LOCAL_OFFLINE_PREVIEW_BUSY",
        }),
      );
    }
    if (
      this.#trackedHelpers.size > 0 ||
      this.#trackedSourceHandles.size > 0
    ) {
      return this.#record(
        dto(request, "blocked", {
          failureCode: this.#trackedHelpers.size > 0
            ? HELPER_TERMINATION_UNCONFIRMED_CODE
            : SOURCE_HANDLE_CLOSE_UNCONFIRMED_CODE,
        }),
      );
    }
    const asset = this.#assets.get(request.previewAssetId);
    const evidence = this.#evidence.get(request.receiptSha256);
    if (
      asset === undefined ||
      evidence === undefined ||
      asset.receiptSha256 !== request.receiptSha256 ||
      evidence.previewAssetId !== request.previewAssetId
    ) {
      return this.#record(
        dto(request, "blocked", {
          failureCode: "LOCAL_OFFLINE_PREVIEW_OPAQUE_BINDING_NOT_FOUND",
        }),
      );
    }

    let verifiedPermit: FoundryOfflineNormalizeMeshGlbPreviewVerifiedPermit;
    try {
      verifiedPermit = verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
        invocation: evidence.invocation,
        permitEnvelope: evidence.permitEnvelope,
        pinnedTrustedPermitKeys: this.#keys,
      });
    } catch (error: unknown) {
      return this.#record(
        dto(request, "blocked", {
          failureCode: publicCode(
            error,
            "LOCAL_OFFLINE_PREVIEW_PERMIT_REJECTED",
          ),
        }),
      );
    }
    if (
      processPermitWasConsumed(verifiedPermit.permitPayloadSha256)
    ) {
      return this.#record(
        dto(request, "blocked", {
          failureCode: "LOCAL_OFFLINE_PREVIEW_PERMIT_REPLAY_REJECTED",
        }),
      );
    }
    this.#prepared.set(
      request.requestId,
      Object.freeze({ request, asset, evidence, verifiedPermit }),
    );
    return this.#record(
      dto(request, "ready", { source: sourceDto(verifiedPermit) }),
    );
  }

  async start(
    input: LocalOfflineNormalizationPreviewStartRequest,
  ): Promise<LocalOfflineNormalizationPreviewDto> {
    const request = parseStartRequest(input);
    const boundRequest = this.#requestBindings.get(request.requestId);
    if (
      boundRequest !== undefined &&
      !sameStartRequest(boundRequest, request)
    ) {
      return dto(request, "blocked", {
        failureCode: "LOCAL_OFFLINE_PREVIEW_REQUEST_ID_CONFLICT",
      });
    }
    const prior = this.#states.get(request.requestId);
    const preparedDto = prior ?? this.prepare(request);
    if (preparedDto.state !== "ready") return preparedDto;
    const prepared = this.#prepared.get(request.requestId);
    if (
      prepared === undefined ||
      this.#active !== null ||
      this.#stopped ||
      this.#trackedHelpers.size > 0 ||
      this.#trackedSourceHandles.size > 0
    ) {
      return this.#record(
        dto(request, "blocked", {
          failureCode: this.#stopped
            ? "LOCAL_OFFLINE_PREVIEW_CONTROLLER_STOPPED"
            : this.#active !== null
              ? "LOCAL_OFFLINE_PREVIEW_BUSY"
              : this.#trackedHelpers.size > 0
                ? HELPER_TERMINATION_UNCONFIRMED_CODE
                : SOURCE_HANDLE_CLOSE_UNCONFIRMED_CODE,
        }),
      );
    }

    let resolveSettled = (): void => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const now = Date.now();
    const permitDeadlineAt = Date.parse(prepared.verifiedPermit.expiresAt);
    const timeoutDeadlineAt = now + this.#helperTimeoutMs;
    const deadlineAt = Math.min(permitDeadlineAt, timeoutDeadlineAt);
    const deadlineCode = permitDeadlineAt <= timeoutDeadlineAt
      ? "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_EXPIRED"
      : "LOCAL_OFFLINE_PREVIEW_OPERATION_TIMEOUT";
    const abortController = new AbortController();
    const active: ActiveRequest = {
      requestId: request.requestId,
      abortCode: null,
      abortController,
      deadlineAt,
      deadlineCode,
      deadlineTimer: null,
      helperLifecycle: null,
      abortHelper: null,
      settled,
      resolveSettled,
    };
    active.deadlineTimer = setTimeout(() => {
      void this.#abortActive(active, deadlineCode);
    }, Math.max(1, deadlineAt - now));
    active.deadlineTimer.unref();
    this.#active = active;
    this.#record(
      dto(request, "running", { source: sourceDto(prepared.verifiedPermit) }),
    );
    let initial: ExactSourceRead | null = null;
    let fresh: ExactSourceRead | null = null;
    let candidateOutput: Buffer | null = null;
    let helperResult: unknown = null;
    let verifierResult: unknown = null;
    try {
      const verifiedPermit =
        verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
          invocation: prepared.evidence.invocation,
          permitEnvelope: prepared.evidence.permitEnvelope,
          pinnedTrustedPermitKeys: this.#keys,
        });
      this.#assertActive(active);
      const consumption = consumeProcessPermit(
        verifiedPermit.permitPayloadSha256,
      );
      if (consumption === "replay") {
        fail(
          "LOCAL_OFFLINE_PREVIEW_PERMIT_REPLAY_REJECTED",
          "The one-run offline preview permit was already consumed in this process.",
        );
      }
      if (consumption === "ledger_full") {
        fail(
          "LOCAL_OFFLINE_PREVIEW_PROCESS_PERMIT_LEDGER_FULL",
          "The bounded process permit ledger cannot accept another active permit.",
        );
      }
      initial = await readExactSource(
        prepared.asset.absolutePath,
        verifiedPermit.invocation,
        active.abortController.signal,
        (absolutePath, flags, signal) =>
          this.#openTrackedSourceHandle(
            active.requestId,
            absolutePath,
            flags,
            signal,
          ),
        (lifecycle) => this.#closeTrackedSourceHandle(lifecycle),
      );
      this.#assertActive(active);
      const stillActivePermit =
        verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
          invocation: verifiedPermit.invocation,
          permitEnvelope: prepared.evidence.permitEnvelope,
          pinnedTrustedPermitKeys: this.#keys,
        });

      const helperPermitKey = this.#keys.get(
        stillActivePermit.invocation.permit.keyId,
      );
      if (helperPermitKey === undefined) {
        fail(
          "LOCAL_OFFLINE_PREVIEW_PINNED_PERMIT_KEY_MISSING",
          "The verified permit key is no longer present in the process-pinned keyring.",
        );
      }
      const helperPermitKeys = new Map([
        [stillActivePermit.invocation.permit.keyId, helperPermitKey],
      ]);

      const transferable = copyToTransferable(initial.bytes);
      bestEffortOverwrite(initial.bytes);
      initial = { bytes: Buffer.alloc(0), identity: initial.identity };

      helperResult = await this.#runHelper(
        active,
        {
          schemaVersion: LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_INPUT_V0,
          sourceBytes: transferable,
          invocation: stillActivePermit.invocation,
          permitEnvelope: prepared.evidence.permitEnvelope,
          pinnedTrustedPermitKeys: helperPermitKeys,
        },
        stillActivePermit.expiresAt,
      );
      this.#assertActive(active);
      const success = parseHelperSuccess(helperResult);
      candidateOutput = Buffer.from(success.normalizedGlb);
      helperResult = null;
      const helperReport =
        FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.parse(
          success.report,
        );

      fresh = await readExactSource(
        prepared.asset.absolutePath,
        stillActivePermit.invocation,
        active.abortController.signal,
        (absolutePath, flags, signal) =>
          this.#openTrackedSourceHandle(
            active.requestId,
            absolutePath,
            flags,
            signal,
          ),
        (lifecycle) => this.#closeTrackedSourceHandle(lifecycle),
      );
      if (!sameIdentity(initial.identity, fresh.identity)) {
        fail(
          "LOCAL_OFFLINE_PREVIEW_SOURCE_IDENTITY_CHANGED",
          "The preview source was replaced or mutated while the helper ran.",
        );
      }
      this.#assertActive(active);
      const freshSourceBytes = copyToTransferable(fresh.bytes);
      const candidateOutputBytes = copyToTransferable(candidateOutput);
      bestEffortOverwrite(fresh.bytes);
      fresh = { bytes: Buffer.alloc(0), identity: fresh.identity };
      bestEffortOverwrite(candidateOutput);
      candidateOutput = null;

      verifierResult = await this.#runVerifierHelper(active, {
        schemaVersion:
          LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0,
        freshSourceBytes,
        candidateOutputBytes,
        invocation: stillActivePermit.invocation,
        permitEnvelope: DsseEnvelopeSchema.parse(
          prepared.evidence.permitEnvelope,
        ),
        report: helperReport,
        pinnedTrustedPermitKeys: helperPermitKeys,
      }, stillActivePermit.expiresAt);
      this.#assertActive(active);
      const verified =
        parseLocalOfflineNormalizationPreviewVerifierResult(verifierResult);
      if (verified.kind === "failed") {
        fail(
          verified.code,
          "The separate fresh-verification helper rejected the preview.",
        );
      }
      candidateOutput = Buffer.from(verified.candidateOutputBytes);
      verifierResult = null;
      const report = FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.parse(
        verified.report,
      );
      const candidateSha256 = `sha256:${createHash("sha256")
        .update(candidateOutput)
        .digest("hex")}`;
      if (
        candidateOutput.byteLength !== report.output.sizeBytes ||
        candidateSha256 !== report.output.sha256 ||
        report.reportSha256 !== helperReport.reportSha256 ||
        JSON.stringify(report) !== JSON.stringify(helperReport)
      ) {
        fail(
          LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES.verificationFailed,
          "The fresh-verification result did not match the exact candidate and report.",
        );
      }
      this.#assertActive(active);

      const retained = candidateOutput;
      candidateOutput = null;
      const retentionMs =
        Date.parse(stillActivePermit.expiresAt) - Date.now();
      if (retentionMs <= 0) {
        bestEffortOverwrite(retained);
        fail(
          "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_EXPIRED",
          "The permit expired before session-memory retention.",
        );
      }
      const expiryTimer = setTimeout(() => {
        this.#discardResult(
          request.requestId,
          "LOCAL_OFFLINE_PREVIEW_RETAINED_RESULT_EXPIRED",
          "The session-only preview expired and its byte buffer was discarded on a best-effort basis.",
        );
      }, retentionMs);
      expiryTimer.unref();
      this.#results.set(request.requestId, {
        normalizedGlb: retained,
        report: copyAndFreezeJson(report),
        expiresAt: stillActivePermit.expiresAt,
        expiryTimer,
      });
      const finalDto = dto(request, "verified", {
        source: sourceDto(stillActivePermit),
        output: {
          sizeBytes: report.output.sizeBytes,
          sha256: report.output.sha256,
          reportSha256: report.reportSha256,
          semanticExactMatch: true,
        },
      });
      return this.#record(finalDto);
    } catch (error: unknown) {
      const failed = dto(request, "failed", {
        source: sourceDto(prepared.verifiedPermit),
        failureCode: publicCode(
          error,
          "LOCAL_OFFLINE_PREVIEW_VERIFICATION_FAILED",
        ),
      });
      return this.#record(failed);
    } finally {
      bestEffortOverwrite(initial?.bytes);
      bestEffortOverwrite(fresh?.bytes);
      bestEffortOverwrite(candidateOutput);
      bestEffortOverwriteHelperOutput(helperResult);
      bestEffortOverwriteHelperOutput(verifierResult);
      clearTimeout(active.deadlineTimer);
      active.deadlineTimer = null;
      this.#prepared.delete(request.requestId);
      if (this.#active === active) this.#active = null;
      active.resolveSettled();
    }
  }

  status(requestId: string): LocalOfflineNormalizationPreviewDto | null {
    const value = this.#states.get(requestId);
    return value === undefined ? null : structuredClone(value);
  }

  snapshot(requestId?: string): LocalOfflineNormalizationPreviewDto {
    if (requestId === undefined) {
      return structuredClone(LOCAL_OFFLINE_NORMALIZATION_PREVIEW_INITIAL_DTO);
    }
    return this.status(requestId) ??
      structuredClone(LOCAL_OFFLINE_NORMALIZATION_PREVIEW_INITIAL_DTO);
  }

  async cancel(
    requestId: string,
  ): Promise<LocalOfflineNormalizationPreviewDto | null> {
    const active = this.#active;
    if (active === null || active.requestId !== requestId) {
      await this.#closeSourceHandlesForRequest(requestId);
      if (this.#hasTrackedSourceHandleForRequest(requestId)) {
        const request = this.#requestBindings.get(requestId);
        if (request !== undefined) {
          return this.#record(
            dto(request, "failed", {
              source: this.#states.get(requestId)?.source ?? null,
              failureCode: SOURCE_HANDLE_CLOSE_UNCONFIRMED_CODE,
            }),
          );
        }
      }
      this.#discardResult(
        requestId,
        "LOCAL_OFFLINE_PREVIEW_CANCELLED",
        "The requested private preview was stopped and its session-memory copies were discarded on a best-effort basis. This is not secure erasure.",
      );
      return this.status(requestId);
    }
    const termination = this.#abortActive(
      active,
      "LOCAL_OFFLINE_PREVIEW_CANCELLED",
    );
    const terminationConfirmed = termination === undefined
      ? true
      : await termination;
    await active.settled;
    await this.#closeSourceHandlesForRequest(requestId);
    if (
      !terminationConfirmed ||
      this.#hasTrackedHelperForRequest(requestId) ||
      this.#hasTrackedSourceHandleForRequest(requestId)
    ) {
      const request = this.#requestBindings.get(requestId);
      if (request !== undefined) {
        return this.#record(
          dto(request, "failed", {
            source: this.#states.get(requestId)?.source ?? null,
            failureCode:
              !terminationConfirmed ||
                this.#hasTrackedHelperForRequest(requestId)
                ? HELPER_TERMINATION_UNCONFIRMED_CODE
                : SOURCE_HANDLE_CLOSE_UNCONFIRMED_CODE,
          }),
        );
      }
    }
    this.#discardResult(
      requestId,
      "LOCAL_OFFLINE_PREVIEW_CANCELLED",
      "The requested private preview was stopped and its session-memory copies were discarded on a best-effort basis. This is not secure erasure.",
    );
    return this.status(requestId);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    const attempted = new Set<TrackedHelperLifecycle>();
    const active = this.#active;
    if (active !== null) {
      const termination = this.#abortActive(
        active,
        "LOCAL_OFFLINE_PREVIEW_CONTROLLER_STOPPED",
      );
      if (termination !== undefined) {
        if (active.helperLifecycle !== null) {
          attempted.add(active.helperLifecycle);
        }
        await termination;
      }
      await active.settled;
    }
    for (const lifecycle of [...this.#trackedHelpers]) {
      if (attempted.has(lifecycle)) continue;
      await this.#terminateTrackedHelper(lifecycle);
    }
    for (const lifecycle of [...this.#trackedSourceHandles]) {
      await this.#closeTrackedSourceHandle(lifecycle);
    }
    for (const requestId of [...this.#results.keys()]) {
      this.#discardResult(
        requestId,
        "LOCAL_OFFLINE_PREVIEW_CONTROLLER_STOPPED",
        "The controller stopped and discarded its session-only preview bytes on a best-effort basis.",
      );
    }
    this.#prepared.clear();
    if (
      this.#trackedHelpers.size > 0 ||
      this.#trackedSourceHandles.size > 0
    ) {
      fail(
        this.#trackedHelpers.size > 0
          ? HELPER_TERMINATION_UNCONFIRMED_CODE
          : SOURCE_HANDLE_CLOSE_UNCONFIRMED_CODE,
        "One or more helper threads could not be confirmed stopped, or read-only source handles could not be confirmed closed. No safe-stop confirmation is available; call stop again to retry.",
      );
    }
  }

  readVerifiedResult(
    requestId: string,
  ): LocalOfflineNormalizationPreviewVerifiedResult | null {
    const result = this.#results.get(requestId);
    if (result === undefined) return null;
    if (Date.now() >= Date.parse(result.expiresAt)) {
      this.#discardResult(
        requestId,
        "LOCAL_OFFLINE_PREVIEW_RETAINED_RESULT_EXPIRED",
        "The session-only preview expired and its byte buffer was discarded on a best-effort basis.",
      );
      return null;
    }
    return {
      normalizedGlb: Buffer.from(result.normalizedGlb),
      report: structuredClone(result.report),
    };
  }

  /** Returns report JSON without cloning the potentially large GLB. */
  readVerifiedReport(
    requestId: string,
  ): FoundryOfflineNormalizeMeshGlbPreviewReportV0 | null {
    const result = this.#liveResult(requestId);
    return result === null ? null : structuredClone(result.report);
  }

  /**
   * Acquires at most one large output copy for the whole controller. The
   * expected digest is checked before allocation, so stale links allocate
   * nothing. The lease is revoked and wiped by stop, expiry, or discard.
   */
  acquireVerifiedOutput(
    requestId: string,
    expectedSha256: string,
    onRevoke: () => void = () => undefined,
  ): LocalOfflineNormalizationPreviewOutputLease | null {
    const result = this.#liveResult(requestId);
    if (
      result === null ||
      result.report.output.sha256 !== expectedSha256 ||
      this.#outputLease !== null
    ) {
      return null;
    }
    const tracked: TrackedOutputLease = {
      requestId,
      normalizedGlb: Buffer.from(result.normalizedGlb),
      onRevoke,
      released: false,
    };
    this.#outputLease = tracked;
    return Object.freeze({
      normalizedGlb: tracked.normalizedGlb,
      release: () => {
        this.#releaseOutputLease(tracked);
      },
    });
  }

  discardVerifiedResult(requestId: string): boolean {
    return this.#discardResult(
      requestId,
      "LOCAL_OFFLINE_PREVIEW_RESULT_DISCARDED",
      "The session-only preview bytes were discarded on a best-effort basis. This is not secure erasure.",
    );
  }

  #record(
    value: LocalOfflineNormalizationPreviewDto,
  ): LocalOfflineNormalizationPreviewDto {
    if (value.requestId === null) {
      throw new TypeError("request-scoped state requires a request ID");
    }
    this.#states.set(value.requestId, value);
    return structuredClone(value);
  }

  #discardResult(requestId: string, code: string, message: string): boolean {
    const result = this.#results.get(requestId);
    if (result === undefined) return false;
    if (this.#outputLease?.requestId === requestId) {
      this.#revokeOutputLease(this.#outputLease);
    }
    clearTimeout(result.expiryTimer);
    bestEffortOverwrite(result.normalizedGlb);
    this.#results.delete(requestId);
    const request = this.#requestBindings.get(requestId);
    const prior = this.#states.get(requestId);
    if (request !== undefined) {
      this.#record(
        dto(request, "blocked", {
          source: prior?.source ?? null,
          failureCode: code,
          message,
        }),
      );
    }
    return true;
  }

  #liveResult(requestId: string): RetainedVerifiedResult | null {
    const result = this.#results.get(requestId);
    if (result === undefined) return null;
    if (Date.now() >= Date.parse(result.expiresAt)) {
      this.#discardResult(
        requestId,
        "LOCAL_OFFLINE_PREVIEW_RETAINED_RESULT_EXPIRED",
        "The session-only preview expired and its byte buffer was discarded on a best-effort basis.",
      );
      return null;
    }
    return result;
  }

  #releaseOutputLease(lease: TrackedOutputLease): void {
    if (lease.released) return;
    lease.released = true;
    bestEffortOverwrite(lease.normalizedGlb);
    if (this.#outputLease === lease) this.#outputLease = null;
  }

  #revokeOutputLease(lease: TrackedOutputLease): void {
    if (lease.released) return;
    lease.released = true;
    if (this.#outputLease === lease) this.#outputLease = null;
    try {
      lease.onRevoke();
    } catch {
      // Revocation remains authoritative even if a transport callback fails.
    }
    bestEffortOverwrite(lease.normalizedGlb);
  }

  #assertActive(active: ActiveRequest): void {
    if (active.abortCode !== null) {
      fail(active.abortCode, "The private offline preview was stopped.");
    }
    if (this.#active !== active) {
      fail(
        "LOCAL_OFFLINE_PREVIEW_ACTIVE_REQUEST_LOST",
        "The private offline preview lost its one-run controller ownership.",
      );
    }
  }

  #abortActive(
    active: ActiveRequest,
    code: string,
  ): Promise<boolean> | undefined {
    active.abortCode ??= code;
    if (!active.abortController.signal.aborted) {
      active.abortController.abort(
        new LocalOfflineNormalizationPreviewError(
          active.abortCode,
          "The private offline preview was stopped.",
        ),
      );
    }
    return active.abortHelper?.(active.abortCode);
  }

  #hasTrackedHelperForRequest(requestId: string): boolean {
    for (const lifecycle of this.#trackedHelpers) {
      if (lifecycle.requestId === requestId) return true;
    }
    return false;
  }

  #hasTrackedSourceHandleForRequest(requestId: string): boolean {
    for (const lifecycle of this.#trackedSourceHandles) {
      if (lifecycle.requestId === requestId) return true;
    }
    return false;
  }

  async #openTrackedSourceHandle(
    requestId: string,
    absolutePath: string,
    flags: number,
    signal: AbortSignal,
  ): Promise<TrackedSourceHandle> {
    throwIfAborted(signal);
    const handle = await open(absolutePath, flags);
    const lifecycle: TrackedSourceHandle = {
      requestId,
      handle,
      closeConfirmed: false,
      closeAttempt: null,
      closeRetryTimer: null,
    };
    this.#trackedSourceHandles.add(lifecycle);
    if (signal.aborted) {
      const confirmed = await this.#closeTrackedSourceHandle(lifecycle);
      if (!confirmed) {
        fail(
          SOURCE_HANDLE_CLOSE_UNCONFIRMED_CODE,
          "The read-only source handle could not be confirmed closed after Stop.",
        );
      }
      throw abortReason(signal);
    }
    return lifecycle;
  }

  #confirmSourceHandleClosed(lifecycle: TrackedSourceHandle): void {
    lifecycle.closeConfirmed = true;
    if (lifecycle.closeRetryTimer !== null) {
      clearTimeout(lifecycle.closeRetryTimer);
      lifecycle.closeRetryTimer = null;
    }
    this.#trackedSourceHandles.delete(lifecycle);
  }

  #scheduleSourceHandleCloseRetry(lifecycle: TrackedSourceHandle): void {
    if (lifecycle.closeConfirmed || lifecycle.closeRetryTimer !== null) return;
    lifecycle.closeRetryTimer = setTimeout(() => {
      lifecycle.closeRetryTimer = null;
      void this.#closeTrackedSourceHandle(lifecycle).then((confirmed) => {
        if (!confirmed) this.#scheduleSourceHandleCloseRetry(lifecycle);
      });
    }, 250);
    lifecycle.closeRetryTimer.unref();
  }

  async #closeTrackedSourceHandle(
    lifecycle: TrackedSourceHandle,
  ): Promise<boolean> {
    if (lifecycle.closeConfirmed) return true;
    let attempt = lifecycle.closeAttempt;
    if (attempt === null) {
      attempt = (async (): Promise<boolean> => {
        try {
          await this.#sourceHandleCloser(lifecycle.handle);
          this.#confirmSourceHandleClosed(lifecycle);
        } catch {
          this.#scheduleSourceHandleCloseRetry(lifecycle);
        }
        return lifecycle.closeConfirmed;
      })();
      lifecycle.closeAttempt = attempt;
      void attempt.then(() => {
        if (lifecycle.closeAttempt === attempt) lifecycle.closeAttempt = null;
      });
    }
    const confirmed = await waitForLifecycleConfirmation(
      attempt,
      () => lifecycle.closeConfirmed,
    );
    if (!confirmed) {
      // A pending close call is never duplicated. It stays tracked while this
      // bounded retry loop waits for that call to settle.
      this.#scheduleSourceHandleCloseRetry(lifecycle);
    }
    return confirmed;
  }

  async #closeSourceHandlesForRequest(requestId: string): Promise<void> {
    for (const lifecycle of [...this.#trackedSourceHandles]) {
      if (lifecycle.requestId === requestId) {
        await this.#closeTrackedSourceHandle(lifecycle);
      }
    }
  }

  #confirmHelperTermination(lifecycle: TrackedHelperLifecycle): void {
    lifecycle.terminationConfirmed = true;
    if (lifecycle.terminationRetryTimer !== null) {
      clearTimeout(lifecycle.terminationRetryTimer);
      lifecycle.terminationRetryTimer = null;
    }
    this.#trackedHelpers.delete(lifecycle);
  }

  #scheduleHelperTerminationRetry(lifecycle: TrackedHelperLifecycle): void {
    if (
      lifecycle.terminationConfirmed ||
      lifecycle.terminationRetryTimer !== null
    ) {
      return;
    }
    lifecycle.terminationRetryTimer = setTimeout(() => {
      lifecycle.terminationRetryTimer = null;
      void this.#terminateTrackedHelper(lifecycle).then((confirmed) => {
        if (!confirmed) this.#scheduleHelperTerminationRetry(lifecycle);
      });
    }, 250);
    lifecycle.terminationRetryTimer.unref();
  }

  async #terminateTrackedHelper(
    lifecycle: TrackedHelperLifecycle,
  ): Promise<boolean> {
    if (lifecycle.terminationConfirmed) return true;
    let attempt = lifecycle.terminationAttempt;
    if (attempt === null) {
      attempt = (async (): Promise<boolean> => {
        try {
          await lifecycle.helper.terminate();
          this.#confirmHelperTermination(lifecycle);
        } catch {
          // The helper remains tracked. A later exit event or stop() retry is
          // required before the controller can confirm termination.
          this.#scheduleHelperTerminationRetry(lifecycle);
        }
        return lifecycle.terminationConfirmed;
      })();
      lifecycle.terminationAttempt = attempt;
      void attempt.then(() => {
        if (lifecycle.terminationAttempt === attempt) {
          lifecycle.terminationAttempt = null;
        }
      });
    }
    const confirmed = await waitForLifecycleConfirmation(
      attempt,
      () => lifecycle.terminationConfirmed,
    );
    if (!confirmed) {
      // Never start a second terminate() call while the first is pending.
      this.#scheduleHelperTerminationRetry(lifecycle);
    }
    return confirmed;
  }

  #runHelper(
    active: ActiveRequest,
    workerData: LocalOfflineNormalizationPreviewHelperInput,
    expiresAt: string,
  ): Promise<unknown> {
    return this.#runTrackedWorker(
      active,
      workerData,
      [workerData.sourceBytes],
      new URL("./offline-normalization-preview.worker.js", import.meta.url),
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_RESOURCE_LIMITS,
      expiresAt,
    );
  }

  #runVerifierHelper(
    active: ActiveRequest,
    workerData: LocalOfflineNormalizationPreviewVerifierInput,
    expiresAt: string,
  ): Promise<unknown> {
    return this.#runTrackedWorker(
      active,
      workerData,
      [workerData.freshSourceBytes, workerData.candidateOutputBytes],
      new URL(
        "./offline-normalization-preview-verifier.worker.js",
        import.meta.url,
      ),
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESOURCE_LIMITS,
      expiresAt,
    );
  }

  #runTrackedWorker(
    active: ActiveRequest,
    workerData: unknown,
    transferList: readonly ArrayBuffer[],
    scriptUrl: URL,
    resourceLimits: ResourceLimits,
    expiresAt: string,
  ): Promise<unknown> {
    const remainingPermitMs = Math.min(
      Date.parse(expiresAt),
      active.deadlineAt,
    ) - Date.now();
    if (remainingPermitMs <= 0) {
      fail(
        active.deadlineCode,
        "The offline preview deadline passed before helper launch.",
      );
    }
    const deadlineMs = remainingPermitMs;
    const options: WorkerOptions = {
      workerData,
      transferList: [...transferList],
      resourceLimits,
      // The source-tree tsx fallback must never create its normal disk cache.
      // No inherited environment variables or secret-bearing values are sent.
      env: { TSX_DISABLE_CACHE: "1" },
    };
    let helper: LocalOfflineNormalizationPreviewHelperLike;
    try {
      helper = this.#helperFactory({
        scriptUrl,
        options,
      });
    } catch (error: unknown) {
      for (const transfer of transferList) {
        bestEffortOverwriteArrayBuffer(transfer);
      }
      fail(
        "LOCAL_OFFLINE_PREVIEW_HELPER_LAUNCH_FAILED",
        "The byte-capped helper could not start.",
        error,
      );
    }
    const lifecycle: TrackedHelperLifecycle = {
      requestId: active.requestId,
      helper,
      terminationConfirmed: false,
      terminationAttempt: null,
      terminationRetryTimer: null,
    };
    this.#trackedHelpers.add(lifecycle);
    active.helperLifecycle = lifecycle;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const clear = (): void => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        active.abortHelper = null;
      };
      const terminationUnconfirmedError = () =>
        new LocalOfflineNormalizationPreviewError(
          HELPER_TERMINATION_UNCONFIRMED_CODE,
          "The helper could not be confirmed stopped, so no output was accepted.",
        );
      const abort = async (code: string): Promise<boolean> => {
        if (settled) return this.#terminateTrackedHelper(lifecycle);
        settled = true;
        clear();
        const terminationConfirmed = await this.#terminateTrackedHelper(
          lifecycle,
        );
        reject(
          terminationConfirmed
            ? new LocalOfflineNormalizationPreviewError(
              code,
              "The helper was terminated.",
            )
            : terminationUnconfirmedError(),
        );
        return terminationConfirmed;
      };
      active.abortHelper = abort;
      const deadlineCode = active.deadlineCode;
      timer = setTimeout(() => {
        void abort(deadlineCode);
      }, deadlineMs);
      helper.once("exit", () => {
        this.#confirmHelperTermination(lifecycle);
      });
      helper.once("message", (message) => {
        if (settled) {
          bestEffortOverwriteHelperOutput(message);
          return;
        }
        settled = true;
        clear();
        void this.#terminateTrackedHelper(lifecycle).then((confirmed) => {
          if (confirmed) {
            resolve(message);
          } else {
            bestEffortOverwriteHelperOutput(message);
            reject(terminationUnconfirmedError());
          }
        });
      });
      helper.once("error", () => {
        if (settled) return;
        settled = true;
        clear();
        void this.#terminateTrackedHelper(lifecycle).then((confirmed) => {
          reject(confirmed
            ? new LocalOfflineNormalizationPreviewError(
              "LOCAL_OFFLINE_PREVIEW_HELPER_CRASHED",
              "The helper crashed without trusted output.",
            )
            : terminationUnconfirmedError());
        });
      });
      helper.once("exit", (code) => {
        if (settled) return;
        settled = true;
        clear();
        reject(
          new LocalOfflineNormalizationPreviewError(
            "LOCAL_OFFLINE_PREVIEW_HELPER_EXITED_WITHOUT_RESULT",
            `The helper exited without a result (${String(code)}).`,
          ),
        );
      });
      if (active.abortCode !== null) void abort(active.abortCode);
    });
  }
}

export function createLocalOfflineNormalizationPreviewController(
  options: CreateLocalOfflineNormalizationPreviewControllerOptions,
): LocalOfflineNormalizationPreviewController {
  return new LocalOfflineNormalizationPreviewController(options);
}

import { spawn } from "node:child_process";
import type { Stats } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  E57AggregateMetadataSchema,
  UniversalSourceFactsFileResultSchema,
  UniversalSourceFactsReceiptFileIdentitySchema,
  domainSeparatedSha256,
  verifyLocalE57RuntimeAdapterBinding,
  verifyLocalE57RuntimeBundleReceipt,
  verifyLocalE57RuntimeQualificationReceipt,
  sha256RegularFileWithHead,
  stableCanonicalJson,
  toCanonicalJson,
  withUniversalSourceFactsE57Aggregate,
  type E57AggregateMetadata,
  type ExpectedRegularFileIdentity,
  type LocalE57RuntimeAdapterBinding,
  type LocalE57RuntimeBundleReceipt,
  type LocalE57RuntimeQualificationReceipt,
  type UniversalSourceFactsFileResult,
  type UniversalSourceFactsReceiptFileIdentity,
} from "@omnitwin/reconstruction-foundry";
import {
  assertLocalE57RuntimeBundleUnchanged,
  verifyLocalE57RuntimeBundleOnDisk,
  type LocalE57RuntimeBundleSnapshot,
} from "./local-e57-runtime-bundle-verifier.js";

export const LOCAL_E57_METADATA_PROBE_SCHEMA_VERSION =
  "venviewer.local-e57-metadata-probe.v0";
export const LOCAL_E57_METADATA_PROBE_DIGEST_DOMAIN =
  "VENVIEWER_LOCAL_E57_METADATA_PROBE_V0";
export const LOCAL_E57_METADATA_PROBE_TIMEOUT_MS = 15 * 60 * 1_000;
export const LOCAL_E57_METADATA_PROBE_OPERATION_TIMEOUT_MS = 45 * 60 * 1_000;
export const LOCAL_E57_METADATA_PROBE_MAX_STDOUT_BYTES = 4 * 1024 * 1024;
export const LOCAL_E57_METADATA_PROBE_MAX_STDERR_BYTES = 64 * 1024;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const REQUIRED_PYE57_DIST_INFO = "pye57-0.4.19.dist-info";
const REQUIRED_PROBE_SCHEMA_VERSION = "omnitwin.foundry.phase1-probe.v0";
const PYTHON_BOOTSTRAP = [
  "import runpy,sys",
  "dependency_root,probe,*probe_args=sys.argv[1:]",
  "sys.path.append(dependency_root)",
  "sys.argv=[probe,*probe_args]",
  "runpy.run_path(probe,run_name='__main__')",
].join(";");

export const LOCAL_E57_METADATA_PROBE_LIMITATIONS = Object.freeze([
  "THE_PRE_AND_POST_CHECKS_ARE_NOT_AN_ATOMIC_FILESYSTEM_SNAPSHOT",
  "THE_BOUND_RUNTIME_RECEIPT_ESTABLISHES_BYTE_IDENTITY_NOT_PUBLISHER_BUILD_REPRODUCIBILITY",
  "PYBIND11_EXACT_BUILD_VERSION_REMAINS_INFERRED_NOT_ATTESTED",
  "METADATA_STRUCTURE_DOES_NOT_ESTABLISH_BOUNDS_UNITS_ACCURACY_REGISTRATION_PROVENANCE_RIGHTS_OR_FIDELITY",
  "INTERPRETER_ISOLATION_FLAGS_AND_A_MINIMAL_ENVIRONMENT_ARE_NOT_AN_OPERATING_SYSTEM_SANDBOX",
] as const);

/**
 * Deliberately null until one production bundle has both a complete byte
 * receipt and a reviewed clean-host qualification. Tests inject a synthetic
 * binding through the explicitly test-only adapter factory.
 */
export const LOCAL_E57_METADATA_PROBE_BOUND_RUNTIME:
  LocalE57RuntimeAdapterBinding | null = null;

export const LOCAL_E57_METADATA_PROBE_POLICY = Object.freeze({
  authority: "none",
  cloudAccess: "none",
  imageBlobBytesRead: false,
  networkAccess: "not_requested",
  pointRecordsRead: false,
  processBoundary: "python_-I_-S_-B_minimal_environment",
  sourceAccess: "read-only",
  sourceWrites: "none",
} as const);

const UNAVAILABLE_REASONS = {
  E57_METADATA_READ_FAILED: {
    message: "The read-only E57 metadata reader could not inspect this file.",
    nextAction: "Review the bounded local probe diagnostic, then retry against the unchanged source digest.",
  },
  NUMPY_UNAVAILABLE: {
    message: "The isolated Python dependency folder does not contain NumPy.",
    nextAction: "Provide a reviewed local dependency folder containing NumPy and exact pye57 0.4.19.",
  },
  PROBE_OUTPUT_INVALID: {
    message: "The local probe did not return metadata that passes the strict E57 aggregate contract.",
    nextAction: "Review the pinned probe/runtime combination; do not attach its deep metadata.",
  },
  PROBE_OUTPUT_LIMIT_EXCEEDED: {
    message: "The local probe exceeded its fixed output limit.",
    nextAction: "Review the source and probe offline; do not raise the limit without a new bounded contract.",
  },
  PROBE_PROCESS_FAILED: {
    message: "The isolated local probe process did not complete successfully.",
    nextAction: "Check the pinned local Python prerequisites and retry without changing the source.",
  },
  PROBE_SCRIPT_MISSING: {
    message: "The pinned read-only E57 probe script is not available on this computer.",
    nextAction: "Install the reviewed probe script and supply its expected SHA-256.",
  },
  PROBE_STDERR_NOT_EMPTY: {
    message: "The local probe wrote an unexpected diagnostic stream.",
    nextAction: "Review the probe offline; no deep metadata was accepted.",
  },
  PROBE_TIMED_OUT: {
    message: "The local probe exceeded its fixed wall-clock time limit.",
    nextAction: "Review the source and runtime offline; no deep metadata was accepted.",
  },
  PYE57_0_4_19_UNAVAILABLE: {
    message: "Exact pye57 0.4.19 is not available in the isolated Python dependency folder.",
    nextAction: "Install exact pye57 0.4.19 locally, or ship the reviewed pinned runtime bundle.",
  },
  PYE57_VERSION_MISMATCH: {
    message: "The local probe reported a pye57 version other than the required 0.4.19.",
    nextAction: "Use exact pye57 0.4.19; do not attach metadata from another version.",
  },
  RUNTIME_VERSION_MISMATCH: {
    message: "The bound E57 worker reported Python or NumPy bytes outside its qualified version contract.",
    nextAction: "Reject the result and rematerialize the exact CPython 3.13.14 and NumPy 2.5.1 bundle.",
  },
  PYTHON_DEPENDENCY_ROOT_MISSING: {
    message: "The isolated Python dependency folder is not available on this computer.",
    nextAction: "Provide the reviewed local NumPy and exact pye57 0.4.19 dependency folder.",
  },
  PYTHON_EXECUTABLE_MISSING: {
    message: "The pinned Python interpreter is not available on this computer.",
    nextAction: "Install or bundle the reviewed interpreter and supply its expected SHA-256.",
  },
  RUNTIME_BUNDLE_UNBOUND: {
    message: "No clean-host-qualified E57 runtime bundle is bound to this application release.",
    nextAction: "Materialize and qualify the exact bundle, then compile its immutable binding into the release.",
  },
} as const;

export type LocalE57MetadataProbeUnavailableCode = keyof typeof UNAVAILABLE_REASONS;

export type LocalE57MetadataProbeErrorCode =
  | "LOCAL_E57_METADATA_PROBE_AGGREGATE_SIZE_MISMATCH"
  | "LOCAL_E57_METADATA_PROBE_CANCELLED"
  | "LOCAL_E57_METADATA_PROBE_DEADLINE_EXCEEDED"
  | "LOCAL_E57_METADATA_PROBE_INVALID_REQUEST"
  | "LOCAL_E57_METADATA_PROBE_PINNED_DIGEST_MISMATCH"
  | "LOCAL_E57_METADATA_PROBE_PINNED_FILE_MUTATED"
  | "LOCAL_E57_METADATA_PROBE_RECEIPT_DIGEST_MISMATCH"
  | "LOCAL_E57_METADATA_PROBE_RECEIPT_SIZE_MISMATCH"
  | "LOCAL_E57_METADATA_PROBE_RUNTIME_BUNDLE_INVALID"
  | "LOCAL_E57_METADATA_PROBE_RUNTIME_BUNDLE_MUTATED"
  | "LOCAL_E57_METADATA_PROBE_SOURCE_INVALID"
  | "LOCAL_E57_METADATA_PROBE_SOURCE_MUTATED"
  | "LOCAL_E57_METADATA_PROBE_TARGET_INVALID";

export class LocalE57MetadataProbeError extends Error {
  readonly code: LocalE57MetadataProbeErrorCode;

  constructor(code: LocalE57MetadataProbeErrorCode, message: string) {
    super(message);
    this.name = "LocalE57MetadataProbeError";
    this.code = code;
  }
}

export interface LocalE57MetadataProbePinnedFile {
  readonly path: string;
  readonly sha256: string;
}

export interface LocalE57MetadataProbeRuntimeBundleInput {
  readonly qualification: LocalE57RuntimeQualificationReceipt;
  readonly receipt: LocalE57RuntimeBundleReceipt;
  readonly rootPath: string;
}

export interface LocalE57MetadataProbeInput {
  readonly establishedSourceFacts: UniversalSourceFactsFileResult;
  readonly receiptIdentity: UniversalSourceFactsReceiptFileIdentity;
  readonly runtimeBundle: LocalE57MetadataProbeRuntimeBundleInput;
  readonly signal?: AbortSignal;
  readonly sourceRootPath: string;
}

export interface LocalE57MetadataProbeProcessInvocation {
  readonly arguments: readonly string[];
  readonly command: string;
  readonly limits: {
    readonly maximumStderrBytes: number;
    readonly maximumStdoutBytes: number;
    readonly timeoutMs: number;
  };
  readonly options: {
    readonly cwd: string;
    readonly env: Readonly<NodeJS.ProcessEnv>;
    readonly shell: false;
    readonly windowsHide: true;
  };
}

export type LocalE57MetadataProbeProcessOutcome =
  | {
      readonly exitCode: number | null;
      readonly kind: "completed";
      readonly signal: NodeJS.Signals | null;
      readonly stderr: Buffer;
      readonly stdout: Buffer;
    }
  | { readonly kind: "cancelled" }
  | { readonly kind: "spawn_failed" }
  | { readonly kind: "stderr_limit_exceeded" }
  | { readonly kind: "stdout_limit_exceeded" }
  | { readonly kind: "timed_out" };

export type LocalE57MetadataProbeProcessRunner = (
  invocation: LocalE57MetadataProbeProcessInvocation,
  signal: AbortSignal | undefined,
) => Promise<LocalE57MetadataProbeProcessOutcome>;

export interface LocalE57MetadataProbeUnavailableReason {
  readonly code: LocalE57MetadataProbeUnavailableCode;
  readonly message: string;
  readonly nextAction: string;
}

interface LocalE57MetadataProbeFileEvidence {
  readonly prePostSha256Match: true;
  readonly prePostStatIdentityMatch: true;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface LocalE57MetadataProbeExecutionEvidence {
  readonly interpreter: LocalE57MetadataProbeFileEvidence;
  readonly invocation: {
    readonly imageBlobBytesRead: false;
    readonly maximumStderrBytes: number;
    readonly maximumStdoutBytes: number;
    readonly mode: "inspect-e57-aggregate";
    readonly operationTimeoutMs: number;
    readonly pointRecordsRead: false;
    readonly pythonFlags: readonly ["-I", "-S", "-B"];
    readonly shell: false;
    readonly sourceOpenMode: "read-only";
    readonly timeoutMs: number;
    readonly windowsHide: true;
  };
  readonly probeScript: LocalE57MetadataProbeFileEvidence;
  readonly runtimeVersions: {
    readonly numpy: string;
    readonly pye57: "0.4.19";
    readonly python: string;
  };
  readonly runtimeBundle: {
    readonly adapterBindingSha256: string;
    readonly bundleReceiptSha256: string;
    readonly completeTreePrePostMatch: true;
    readonly fileCount: number;
    readonly microsoftCppRuntimeDisposition: "central_prerequisite_direct_from_microsoft";
    readonly qualificationSha256: string;
    readonly totalFileBytes: number;
  };
  readonly source: LocalE57MetadataProbeFileEvidence & {
    readonly receiptIdentityMatch: true;
  };
}

interface LocalE57MetadataProbeResultPayloadBase {
  readonly establishedHeader: {
    readonly code: "E57_PHYSICAL_HEADER_ESTABLISHED";
    readonly coverage: "physical_header";
    readonly state: "established";
  };
  readonly limitations: typeof LOCAL_E57_METADATA_PROBE_LIMITATIONS;
  readonly policy: typeof LOCAL_E57_METADATA_PROBE_POLICY;
  readonly receiptIdentity: {
    readonly path: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  };
  readonly schemaVersion: typeof LOCAL_E57_METADATA_PROBE_SCHEMA_VERSION;
  readonly sourceFacts: UniversalSourceFactsFileResult;
}

type LocalE57MetadataProbeResultPayload = LocalE57MetadataProbeResultPayloadBase & {
  readonly deepMetadata:
    | {
        readonly aggregate: E57AggregateMetadata;
        readonly execution: LocalE57MetadataProbeExecutionEvidence;
        readonly state: "available";
      }
    | {
        readonly reason: LocalE57MetadataProbeUnavailableReason;
        readonly state: "unavailable";
      };
};

export type LocalE57MetadataProbeResult = LocalE57MetadataProbeResultPayload & {
  readonly adapterResultSha256: string;
};

interface ValidatedTarget {
  readonly receiptIdentity: UniversalSourceFactsReceiptFileIdentity;
  readonly sourceFacts: UniversalSourceFactsFileResult;
}

interface ReadyPaths {
  readonly dependencyRootPath: string;
  readonly interpreterPath: string;
  readonly probePath: string;
  readonly runtimeBundle: {
    readonly binding: LocalE57RuntimeAdapterBinding;
    readonly qualification: LocalE57RuntimeQualificationReceipt;
    readonly receipt: LocalE57RuntimeBundleReceipt;
    readonly snapshot: LocalE57RuntimeBundleSnapshot;
  };
  readonly sourcePath: string;
}

type FileStatIdentity = ExpectedRegularFileIdentity;

interface FileSnapshot {
  readonly identity: FileStatIdentity;
  readonly sha256: string;
  readonly sizeBytes: number;
}

interface RunSnapshots {
  readonly interpreter: FileSnapshot;
  readonly probe: FileSnapshot;
  readonly source: FileSnapshot;
}

interface OperationAbortScope {
  readonly deadlineExceeded: () => boolean;
  readonly dispose: () => void;
  readonly signal: AbortSignal;
}

type SnapshotRole = "interpreter" | "probe" | "source";

type ProbeEvaluation =
  | { readonly aggregate: E57AggregateMetadata; readonly state: "available" }
  | { readonly code: LocalE57MetadataProbeUnavailableCode; readonly state: "unavailable" }
  | { readonly state: "cancelled" }
  | { readonly state: "source_mutated" };

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function pathKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameIdentity(left: FileStatIdentity, right: FileStatIdentity): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function statIdentity(value: Stats): FileStatIdentity {
  return {
    ctimeMs: value.ctimeMs,
    dev: value.dev,
    ino: value.ino,
    mtimeMs: value.mtimeMs,
    size: value.size,
  };
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_CANCELLED",
      "The read-only E57 metadata probe was cancelled; no adapter result was issued.",
    );
  }
}

function createOperationAbortScope(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): OperationAbortScope {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_INVALID_REQUEST",
      "The internal E57 adapter deadline must be a nonnegative safe integer.",
    );
  }
  const controller = new AbortController();
  let didDeadlineExpire = false;
  const callerAbort = (): void => {
    controller.abort();
  };
  callerSignal?.addEventListener("abort", callerAbort, { once: true });
  if (callerSignal?.aborted === true) controller.abort();
  const timeout = setTimeout(() => {
    didDeadlineExpire = true;
    controller.abort();
  }, timeoutMs);
  timeout.unref();
  return {
    deadlineExceeded: () => didDeadlineExpire,
    dispose: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", callerAbort);
    },
    signal: controller.signal,
  };
}

function validateTarget(input: LocalE57MetadataProbeInput): ValidatedTarget {
  let receiptIdentity: UniversalSourceFactsReceiptFileIdentity;
  let sourceFacts: UniversalSourceFactsFileResult;
  try {
    receiptIdentity = UniversalSourceFactsReceiptFileIdentitySchema.parse(input.receiptIdentity);
    sourceFacts = UniversalSourceFactsFileResultSchema.parse(input.establishedSourceFacts);
  } catch {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_TARGET_INVALID",
      "The adapter requires a valid receipt identity and established E57 physical-header result.",
    );
  }
  if (!isAbsolute(input.sourceRootPath) || !isAbsolute(input.runtimeBundle.rootPath)) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_INVALID_REQUEST",
      "Source and runtime-bundle roots must be absolute local paths.",
    );
  }
  assertEstablishedE57Target(sourceFacts, receiptIdentity);
  return { receiptIdentity, sourceFacts };
}

function assertEstablishedE57Target(
  sourceFacts: UniversalSourceFactsFileResult,
  receipt: UniversalSourceFactsReceiptFileIdentity,
): void {
  const validTarget = sourceFacts.kind === "asset" &&
    sourceFacts.asset.format === "e57" &&
    sourceFacts.asset.inspection.state === "established" &&
    sourceFacts.asset.inspection.code === "E57_PHYSICAL_HEADER_ESTABLISHED" &&
    sourceFacts.asset.inspection.coverage === "physical_header" &&
    sourceFacts.asset.facts !== null &&
    sourceFacts.asset.facts.aggregateMetadata === null;
  if (!validTarget) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_TARGET_INVALID",
      "Deep E57 metadata can only refine established physical-header facts that do not already contain an aggregate.",
    );
  }
  const source = sourceFacts.asset.source;
  if (source.path !== receipt.path || source.sizeBytes !== receipt.sizeBytes || source.sha256 !== receipt.sha256) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_TARGET_INVALID",
      "The established E57 physical-header result does not match its receipt identity.",
    );
  }
}

async function canonicalDirectoryOrMissing(path: string): Promise<string | null> {
  const absolute = resolve(path);
  try {
    const before = await lstat(absolute);
    if (before.isSymbolicLink() || !before.isDirectory()) return null;
    const canonical = await realpath(absolute);
    if (pathKey(canonical) !== pathKey(absolute)) return null;
    const after = await lstat(canonical);
    return !after.isSymbolicLink() && after.isDirectory() ? canonical : null;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
    return null;
  }
}

async function canonicalRegularFileOrMissing(path: string): Promise<string | null> {
  const absolute = resolve(path);
  try {
    const before = await lstat(absolute);
    if (before.isSymbolicLink() || !before.isFile()) return null;
    const canonical = await realpath(absolute);
    if (pathKey(canonical) !== pathKey(absolute)) return null;
    const after = await lstat(canonical);
    return !after.isSymbolicLink() && after.isFile() ? canonical : null;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
    return null;
  }
}

function containedBy(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot);
}

async function resolveSourcePath(rootInput: string, receiptPath: string): Promise<string> {
  const root = await canonicalDirectoryOrMissing(rootInput);
  if (root === null) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_SOURCE_INVALID",
      "The receipt source root is missing, linked, or not a regular directory.",
    );
  }
  const candidate = resolve(root, ...receiptPath.split("/"));
  if (!containedBy(root, candidate)) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_SOURCE_INVALID",
      "The receipt path does not stay inside its source root.",
    );
  }
  const sourcePath = await canonicalRegularFileOrMissing(candidate);
  if (sourcePath === null || !containedBy(root, sourcePath)) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_SOURCE_INVALID",
      "The receipt-bound E57 source is missing, linked, or not a regular file.",
    );
  }
  return sourcePath;
}

async function dependencyMarkerIsRegular(root: string, ...parts: readonly string[]): Promise<boolean> {
  return await canonicalRegularFileOrMissing(join(root, ...parts)) !== null;
}

async function hasExactPye57Dependency(root: string): Promise<boolean> {
  let matchingDirectories = 0;
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (
        entry.name.toLowerCase() === REQUIRED_PYE57_DIST_INFO &&
        entry.isDirectory() &&
        !entry.isSymbolicLink()
      ) {
        matchingDirectories += 1;
      }
    }
  } catch {
    return false;
  }
  return matchingDirectories === 1 &&
    await dependencyMarkerIsRegular(root, "pye57", "__init__.py") &&
    await dependencyMarkerIsRegular(root, REQUIRED_PYE57_DIST_INFO, "METADATA");
}

async function resolveReadyPaths(
  input: LocalE57MetadataProbeInput,
  sourcePath: string,
  boundRuntime: LocalE57RuntimeAdapterBinding | null,
): Promise<ReadyPaths | LocalE57MetadataProbeUnavailableCode> {
  if (boundRuntime === null) return "RUNTIME_BUNDLE_UNBOUND";
  let receipt: LocalE57RuntimeBundleReceipt;
  let qualification: LocalE57RuntimeQualificationReceipt;
  let binding: LocalE57RuntimeAdapterBinding;
  try {
    receipt = verifyLocalE57RuntimeBundleReceipt(input.runtimeBundle.receipt);
    qualification = verifyLocalE57RuntimeQualificationReceipt(
      input.runtimeBundle.qualification,
      receipt.bundleReceiptSha256,
    );
    binding = verifyLocalE57RuntimeAdapterBinding(
      boundRuntime,
      receipt,
      qualification,
    );
  } catch {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_RUNTIME_BUNDLE_INVALID",
      "The E57 runtime receipt, clean-host qualification, or compiled adapter binding is invalid.",
    );
  }
  const runtimeRoot = await canonicalDirectoryOrMissing(input.runtimeBundle.rootPath);
  if (runtimeRoot === null) return "PYTHON_DEPENDENCY_ROOT_MISSING";
  const memberPath = (path: string): string => join(runtimeRoot, ...path.split("/"));
  const interpreterPath = await canonicalRegularFileOrMissing(
    memberPath(receipt.layout.interpreterPath),
  );
  if (interpreterPath === null) return "PYTHON_EXECUTABLE_MISSING";
  const probePath = await canonicalRegularFileOrMissing(
    memberPath(receipt.layout.probeScriptPath),
  );
  if (probePath === null) return "PROBE_SCRIPT_MISSING";
  const dependencyRootPath = await canonicalDirectoryOrMissing(
    memberPath(receipt.layout.dependencyRootPath),
  );
  if (dependencyRootPath === null) return "PYTHON_DEPENDENCY_ROOT_MISSING";
  if (!await dependencyMarkerIsRegular(dependencyRootPath, "numpy", "__init__.py")) {
    return "NUMPY_UNAVAILABLE";
  }
  if (!await hasExactPye57Dependency(dependencyRootPath)) return "PYE57_0_4_19_UNAVAILABLE";
  try {
    const verified = await verifyLocalE57RuntimeBundleOnDisk({
      receipt,
      rootPath: runtimeRoot,
      signal: input.signal,
    });
    return {
      dependencyRootPath: verified.resolvedPaths.dependencyRootPath,
      interpreterPath: verified.resolvedPaths.interpreterPath,
      probePath: verified.resolvedPaths.probeScriptPath,
      runtimeBundle: {
        binding,
        qualification,
        receipt,
        snapshot: verified.snapshot,
      },
      sourcePath,
    };
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "LOCAL_E57_RUNTIME_BUNDLE_CANCELLED"
    ) {
      assertNotCancelled(input.signal);
    }
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_RUNTIME_BUNDLE_INVALID",
      "The complete E57 runtime directory differs from its immutable bundle receipt.",
    );
  }
}

function snapshotErrorCode(role: SnapshotRole): LocalE57MetadataProbeErrorCode {
  return role === "source"
    ? "LOCAL_E57_METADATA_PROBE_SOURCE_MUTATED"
    : "LOCAL_E57_METADATA_PROBE_PINNED_FILE_MUTATED";
}

async function snapshotRegularFile(
  path: string,
  role: SnapshotRole,
  signal: AbortSignal | undefined,
): Promise<FileSnapshot> {
  assertNotCancelled(signal);
  try {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile()) throw new Error("not a regular file");
    const beforeIdentity = statIdentity(before);
    const digest = await sha256RegularFileWithHead(path, 0, beforeIdentity, signal);
    const after = await lstat(path);
    const afterIdentity = statIdentity(after);
    if (after.isSymbolicLink() || !after.isFile() || !sameIdentity(beforeIdentity, afterIdentity)) {
      throw new Error("file identity changed while hashing");
    }
    return { identity: afterIdentity, sha256: digest.sha256, sizeBytes: digest.sizeBytes };
  } catch (error: unknown) {
    if (signal?.aborted === true || errorCode(error) === "HASH_CANCELLED") assertNotCancelled(signal);
    throw new LocalE57MetadataProbeError(
      snapshotErrorCode(role),
      role === "source"
        ? "The receipt-bound E57 source changed while its exact bytes were checked."
        : "A pinned interpreter or probe file changed while its exact bytes were checked.",
    );
  }
}

async function captureRunSnapshots(
  paths: ReadyPaths,
  signal: AbortSignal | undefined,
): Promise<RunSnapshots> {
  const [interpreter, probe, source] = await Promise.all([
    snapshotRegularFile(paths.interpreterPath, "interpreter", signal),
    snapshotRegularFile(paths.probePath, "probe", signal),
    snapshotRegularFile(paths.sourcePath, "source", signal),
  ]);
  return { interpreter, probe, source };
}

function assertReceiptDigest(
  receipt: UniversalSourceFactsReceiptFileIdentity,
  source: FileSnapshot,
): void {
  if (source.sizeBytes !== receipt.sizeBytes) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_RECEIPT_SIZE_MISMATCH",
      "The current E57 file size does not match the established receipt.",
    );
  }
  if (source.sha256 !== receipt.sha256) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_RECEIPT_DIGEST_MISMATCH",
      "The current E57 bytes do not match the established receipt SHA-256.",
    );
  }
}

function assertUnchangedSnapshots(before: RunSnapshots, after: RunSnapshots): void {
  for (const role of ["source", "interpreter", "probe"] as const) {
    const earlier = before[role];
    const later = after[role];
    if (
      earlier.sha256 !== later.sha256 ||
      earlier.sizeBytes !== later.sizeBytes ||
      !sameIdentity(earlier.identity, later.identity)
    ) {
      throw new LocalE57MetadataProbeError(
        snapshotErrorCode(role),
        role === "source"
          ? "The E57 source changed while the read-only metadata probe was running."
          : "The pinned interpreter or probe script changed while the metadata probe was running.",
      );
    }
  }
}

function minimalProbeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONHASHSEED: "0",
    PYTHONIOENCODING: "utf-8",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
  };
  const permitted = new Set(["systemroot", "temp", "tmp", "windir"]);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && permitted.has(key.toLowerCase())) environment[key] = value;
  }
  return environment;
}

function buildProcessInvocation(paths: ReadyPaths): LocalE57MetadataProbeProcessInvocation {
  return {
    arguments: [
      "-I",
      "-S",
      "-B",
      "-c",
      PYTHON_BOOTSTRAP,
      paths.dependencyRootPath,
      paths.probePath,
      "inspect-e57-aggregate",
      "--e57",
      paths.sourcePath,
    ],
    command: paths.interpreterPath,
    limits: {
      maximumStderrBytes: LOCAL_E57_METADATA_PROBE_MAX_STDERR_BYTES,
      maximumStdoutBytes: LOCAL_E57_METADATA_PROBE_MAX_STDOUT_BYTES,
      timeoutMs: LOCAL_E57_METADATA_PROBE_TIMEOUT_MS,
    },
    options: {
      cwd: dirname(paths.probePath),
      env: minimalProbeEnvironment(),
      shell: false,
      windowsHide: true,
    },
  };
}

type ProcessTermination = Exclude<LocalE57MetadataProbeProcessOutcome, { readonly kind: "completed" }>["kind"];

class BoundedProbeProcessCapture {
  readonly #abortListener = (): void => {
    this.requestTermination("cancelled");
  };
  readonly #child: ReturnType<typeof spawn>;
  readonly #invocation: LocalE57MetadataProbeProcessInvocation;
  readonly #resolveOutcome: (outcome: LocalE57MetadataProbeProcessOutcome) => void;
  readonly #signal: AbortSignal | undefined;
  readonly #stderrChunks: Buffer[] = [];
  readonly #stdoutChunks: Buffer[] = [];
  readonly #timeout: NodeJS.Timeout;
  #settled = false;
  #stderrBytes = 0;
  #stdoutBytes = 0;
  #termination: ProcessTermination | null = null;

  constructor(
    child: ReturnType<typeof spawn>,
    invocation: LocalE57MetadataProbeProcessInvocation,
    signal: AbortSignal | undefined,
    resolveOutcome: (outcome: LocalE57MetadataProbeProcessOutcome) => void,
  ) {
    this.#child = child;
    this.#invocation = invocation;
    this.#resolveOutcome = resolveOutcome;
    this.#signal = signal;
    this.#timeout = setTimeout(() => {
      this.requestTermination("timed_out");
    }, invocation.limits.timeoutMs);
    this.#timeout.unref();
    signal?.addEventListener("abort", this.#abortListener, { once: true });
    if (signal?.aborted === true) this.requestTermination("cancelled");
  }

  acceptStdout(rawChunk: Buffer | string): void {
    if (this.#termination !== null) return;
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    this.#stdoutBytes += chunk.byteLength;
    if (this.#stdoutBytes > this.#invocation.limits.maximumStdoutBytes) {
      this.requestTermination("stdout_limit_exceeded");
      return;
    }
    this.#stdoutChunks.push(Buffer.from(chunk));
  }

  acceptStderr(rawChunk: Buffer | string): void {
    if (this.#termination !== null) return;
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    this.#stderrBytes += chunk.byteLength;
    if (this.#stderrBytes > this.#invocation.limits.maximumStderrBytes) {
      this.requestTermination("stderr_limit_exceeded");
      return;
    }
    this.#stderrChunks.push(Buffer.from(chunk));
  }

  requestTermination(reason: ProcessTermination): void {
    if (this.#termination !== null) return;
    this.#termination = reason;
    this.#child.kill("SIGKILL");
  }

  close(exitCode: number | null, childSignal: NodeJS.Signals | null): void {
    if (this.#settled) return;
    this.#settled = true;
    clearTimeout(this.#timeout);
    this.#signal?.removeEventListener("abort", this.#abortListener);
    if (this.#termination !== null) {
      this.#resolveOutcome({ kind: this.#termination });
      return;
    }
    this.#resolveOutcome({
      exitCode,
      kind: "completed",
      signal: childSignal,
      stderr: Buffer.concat(this.#stderrChunks, this.#stderrBytes),
      stdout: Buffer.concat(this.#stdoutChunks, this.#stdoutBytes),
    });
  }
}

async function runBoundedPythonProbe(
  invocation: LocalE57MetadataProbeProcessInvocation,
  signal: AbortSignal | undefined,
): Promise<LocalE57MetadataProbeProcessOutcome> {
  if (signal?.aborted === true) return { kind: "cancelled" };
  return await new Promise<LocalE57MetadataProbeProcessOutcome>((resolveOutcome) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.command, [...invocation.arguments], {
        cwd: invocation.options.cwd,
        env: { ...invocation.options.env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      resolveOutcome({ kind: "spawn_failed" });
      return;
    }
    const capture = new BoundedProbeProcessCapture(child, invocation, signal, resolveOutcome);
    child.stdout?.on("data", (rawChunk: Buffer | string) => {
      capture.acceptStdout(rawChunk);
    });
    child.stderr?.on("data", (rawChunk: Buffer | string) => {
      capture.acceptStderr(rawChunk);
    });
    child.stdout?.once("error", () => {
      capture.requestTermination("spawn_failed");
    });
    child.stderr?.once("error", () => {
      capture.requestTermination("spawn_failed");
    });
    child.once("error", () => {
      capture.requestTermination("spawn_failed");
    });
    child.once("close", (exitCode: number | null, childSignal: NodeJS.Signals | null) => {
      capture.close(exitCode, childSignal);
    });
  });
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function parseJsonRecord(bytes: Buffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function errorEvaluation(stdout: Buffer): ProbeEvaluation {
  const document = parseJsonRecord(stdout);
  if (
    document === null ||
    document.status !== "error" ||
    document.mode !== "inspect-e57-aggregate" ||
    document.schemaVersion !== REQUIRED_PROBE_SCHEMA_VERSION ||
    !isJsonRecord(document.error)
  ) {
    return { code: "PROBE_PROCESS_FAILED", state: "unavailable" };
  }
  const code = document.error.code;
  if (code === "PYE57_UNAVAILABLE") return { code: "PYE57_0_4_19_UNAVAILABLE", state: "unavailable" };
  if (code === "PYE57_VERSION_MISMATCH") return { code: "PYE57_VERSION_MISMATCH", state: "unavailable" };
  if (code === "E57_READ_FAILED") return { code: "E57_METADATA_READ_FAILED", state: "unavailable" };
  if (code === "FILE_CHANGED_DURING_READ") return { state: "source_mutated" };
  return { code: "PROBE_PROCESS_FAILED", state: "unavailable" };
}

function successEvaluation(stdout: Buffer): ProbeEvaluation {
  const document = parseJsonRecord(stdout);
  if (
    document === null ||
    !hasExactKeys(document, ["mode", "result", "schemaVersion", "status"]) ||
    document.mode !== "inspect-e57-aggregate" ||
    document.schemaVersion !== REQUIRED_PROBE_SCHEMA_VERSION ||
    document.status !== "ok"
  ) {
    return { code: "PROBE_OUTPUT_INVALID", state: "unavailable" };
  }
  if (isJsonRecord(document.result) && isJsonRecord(document.result.adapter)) {
    const adapterVersion = document.result.adapter.version;
    if (adapterVersion !== undefined && adapterVersion !== "0.4.19") {
      return { code: "PYE57_VERSION_MISMATCH", state: "unavailable" };
    }
  }
  const parsed = E57AggregateMetadataSchema.safeParse(document.result);
  if (!parsed.success) return { code: "PROBE_OUTPUT_INVALID", state: "unavailable" };
  if (
    parsed.data.runtimeVersions.python !== "3.13.14" ||
    parsed.data.runtimeVersions.numpy !== "2.5.1"
  ) {
    return { code: "RUNTIME_VERSION_MISMATCH", state: "unavailable" };
  }
  return { aggregate: parsed.data, state: "available" };
}

function evaluateProcessOutcome(outcome: LocalE57MetadataProbeProcessOutcome): ProbeEvaluation {
  if (outcome.kind === "cancelled") return { state: "cancelled" };
  if (outcome.kind === "timed_out") return { code: "PROBE_TIMED_OUT", state: "unavailable" };
  if (outcome.kind === "stdout_limit_exceeded" || outcome.kind === "stderr_limit_exceeded") {
    return { code: "PROBE_OUTPUT_LIMIT_EXCEEDED", state: "unavailable" };
  }
  if (outcome.kind === "spawn_failed") return { code: "PROBE_PROCESS_FAILED", state: "unavailable" };
  if (
    outcome.stdout.byteLength > LOCAL_E57_METADATA_PROBE_MAX_STDOUT_BYTES ||
    outcome.stderr.byteLength > LOCAL_E57_METADATA_PROBE_MAX_STDERR_BYTES
  ) {
    return { code: "PROBE_OUTPUT_LIMIT_EXCEEDED", state: "unavailable" };
  }
  if (outcome.stderr.byteLength > 0) return { code: "PROBE_STDERR_NOT_EMPTY", state: "unavailable" };
  if (outcome.exitCode !== 0 || outcome.signal !== null) return errorEvaluation(outcome.stdout);
  return successEvaluation(outcome.stdout);
}

function unavailableReason(code: LocalE57MetadataProbeUnavailableCode): LocalE57MetadataProbeUnavailableReason {
  return { code, ...UNAVAILABLE_REASONS[code] };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const member of Object.values(value)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

function issueResult(payload: LocalE57MetadataProbeResultPayload): LocalE57MetadataProbeResult {
  const adapterResultSha256 = domainSeparatedSha256(
    LOCAL_E57_METADATA_PROBE_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
  return deepFreeze({ ...payload, adapterResultSha256 });
}

function basePayload(
  target: ValidatedTarget,
  sourceFacts: UniversalSourceFactsFileResult,
): LocalE57MetadataProbeResultPayloadBase {
  return {
    establishedHeader: {
      code: "E57_PHYSICAL_HEADER_ESTABLISHED",
      coverage: "physical_header",
      state: "established",
    },
    limitations: LOCAL_E57_METADATA_PROBE_LIMITATIONS,
    policy: LOCAL_E57_METADATA_PROBE_POLICY,
    receiptIdentity: {
      path: target.receiptIdentity.path,
      sha256: target.receiptIdentity.sha256,
      sizeBytes: target.receiptIdentity.sizeBytes,
    },
    schemaVersion: LOCAL_E57_METADATA_PROBE_SCHEMA_VERSION,
    sourceFacts,
  };
}

function issueUnavailable(
  target: ValidatedTarget,
  code: LocalE57MetadataProbeUnavailableCode,
): LocalE57MetadataProbeResult {
  return issueResult({
    ...basePayload(target, target.sourceFacts),
    deepMetadata: { reason: unavailableReason(code), state: "unavailable" },
  });
}

function fileEvidence(snapshot: FileSnapshot): LocalE57MetadataProbeFileEvidence {
  return {
    prePostSha256Match: true,
    prePostStatIdentityMatch: true,
    sha256: snapshot.sha256,
    sizeBytes: snapshot.sizeBytes,
  };
}

function executionEvidence(
  aggregate: E57AggregateMetadata,
  snapshots: RunSnapshots,
  runtimeBundle: ReadyPaths["runtimeBundle"],
): LocalE57MetadataProbeExecutionEvidence {
  return {
    interpreter: fileEvidence(snapshots.interpreter),
    invocation: {
      imageBlobBytesRead: false,
      maximumStderrBytes: LOCAL_E57_METADATA_PROBE_MAX_STDERR_BYTES,
      maximumStdoutBytes: LOCAL_E57_METADATA_PROBE_MAX_STDOUT_BYTES,
      mode: "inspect-e57-aggregate",
      operationTimeoutMs: LOCAL_E57_METADATA_PROBE_OPERATION_TIMEOUT_MS,
      pointRecordsRead: false,
      pythonFlags: ["-I", "-S", "-B"],
      shell: false,
      sourceOpenMode: "read-only",
      timeoutMs: LOCAL_E57_METADATA_PROBE_TIMEOUT_MS,
      windowsHide: true,
    },
    probeScript: fileEvidence(snapshots.probe),
    runtimeVersions: {
      numpy: aggregate.runtimeVersions.numpy,
      pye57: aggregate.adapter.version,
      python: aggregate.runtimeVersions.python,
    },
    runtimeBundle: {
      adapterBindingSha256: runtimeBundle.binding.adapterBindingSha256,
      bundleReceiptSha256: runtimeBundle.receipt.bundleReceiptSha256,
      completeTreePrePostMatch: true,
      fileCount: runtimeBundle.snapshot.fileCount,
      microsoftCppRuntimeDisposition:
        runtimeBundle.receipt.microsoftCppRuntime.disposition,
      qualificationSha256: runtimeBundle.qualification.qualificationSha256,
      totalFileBytes: runtimeBundle.snapshot.totalFileBytes,
    },
    source: { ...fileEvidence(snapshots.source), receiptIdentityMatch: true },
  };
}

function issueAvailable(
  target: ValidatedTarget,
  aggregate: E57AggregateMetadata,
  snapshots: RunSnapshots,
  runtimeBundle: ReadyPaths["runtimeBundle"],
): LocalE57MetadataProbeResult {
  if (aggregate.file.byteSize !== target.receiptIdentity.sizeBytes) {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_AGGREGATE_SIZE_MISMATCH",
      "The probe-reported E57 byte size does not match the established receipt.",
    );
  }
  const attached = withUniversalSourceFactsE57Aggregate(target.sourceFacts, aggregate);
  return issueResult({
    ...basePayload(target, attached),
    deepMetadata: {
      aggregate,
      execution: executionEvidence(aggregate, snapshots, runtimeBundle),
      state: "available",
    },
  });
}

async function runAdapterWithinBoundary(
  input: LocalE57MetadataProbeInput,
  runner: LocalE57MetadataProbeProcessRunner,
  boundRuntime: LocalE57RuntimeAdapterBinding | null,
): Promise<LocalE57MetadataProbeResult> {
  assertNotCancelled(input.signal);
  const target = validateTarget(input);
  const sourcePath = await resolveSourcePath(input.sourceRootPath, target.receiptIdentity.path);
  const ready = await resolveReadyPaths(input, sourcePath, boundRuntime);
  if (typeof ready === "string") {
    const currentSource = await snapshotRegularFile(sourcePath, "source", input.signal);
    assertReceiptDigest(target.receiptIdentity, currentSource);
    return issueUnavailable(target, ready);
  }
  const before = await captureRunSnapshots(ready, input.signal);
  assertReceiptDigest(target.receiptIdentity, before.source);
  assertNotCancelled(input.signal);
  let outcome: LocalE57MetadataProbeProcessOutcome;
  try {
    outcome = await runner(buildProcessInvocation(ready), input.signal);
  } catch {
    outcome = { kind: "spawn_failed" };
  }
  const after = await captureRunSnapshots(ready, input.signal);
  assertUnchangedSnapshots(before, after);
  assertReceiptDigest(target.receiptIdentity, after.source);
  let bundleAfter: Awaited<ReturnType<typeof verifyLocalE57RuntimeBundleOnDisk>>;
  try {
    bundleAfter = await verifyLocalE57RuntimeBundleOnDisk({
      receipt: ready.runtimeBundle.receipt,
      rootPath: ready.runtimeBundle.snapshot.rootPath,
      signal: input.signal,
    });
    assertLocalE57RuntimeBundleUnchanged(
      ready.runtimeBundle.snapshot,
      bundleAfter.snapshot,
    );
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "LOCAL_E57_RUNTIME_BUNDLE_CANCELLED"
    ) {
      assertNotCancelled(input.signal);
    }
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_RUNTIME_BUNDLE_MUTATED",
      "The complete E57 runtime bundle changed while the read-only metadata adapter was running.",
    );
  }
  assertNotCancelled(input.signal);
  const evaluation = evaluateProcessOutcome(outcome);
  if (evaluation.state === "cancelled") {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_CANCELLED",
      "The read-only E57 metadata probe was cancelled; no adapter result was issued.",
    );
  }
  if (evaluation.state === "source_mutated") {
    throw new LocalE57MetadataProbeError(
      "LOCAL_E57_METADATA_PROBE_SOURCE_MUTATED",
      "The E57 probe reported that the source changed during its read-only metadata pass.",
    );
  }
  if (evaluation.state === "unavailable") return issueUnavailable(target, evaluation.code);
  return issueAvailable(target, evaluation.aggregate, after, {
    ...ready.runtimeBundle,
    snapshot: bundleAfter.snapshot,
  });
}

async function runAdapter(
  input: LocalE57MetadataProbeInput,
  runner: LocalE57MetadataProbeProcessRunner,
  operationTimeoutMs: number,
  boundRuntime: LocalE57RuntimeAdapterBinding | null,
): Promise<LocalE57MetadataProbeResult> {
  const scope = createOperationAbortScope(input.signal, operationTimeoutMs);
  try {
    return await runAdapterWithinBoundary(
      { ...input, signal: scope.signal },
      runner,
      boundRuntime,
    );
  } catch (error: unknown) {
    if (
      scope.deadlineExceeded() &&
      error instanceof LocalE57MetadataProbeError &&
      error.code === "LOCAL_E57_METADATA_PROBE_CANCELLED"
    ) {
      throw new LocalE57MetadataProbeError(
        "LOCAL_E57_METADATA_PROBE_DEADLINE_EXCEEDED",
        "The read-only E57 adapter exceeded its full-operation deadline; no result was issued.",
      );
    }
    throw error;
  } finally {
    scope.dispose();
  }
}

export function __testOnlyCreateLocalE57MetadataProbeAdapter(
  runner: LocalE57MetadataProbeProcessRunner,
  operationTimeoutMs = LOCAL_E57_METADATA_PROBE_OPERATION_TIMEOUT_MS,
  boundRuntime: LocalE57RuntimeAdapterBinding | null = null,
): (input: LocalE57MetadataProbeInput) => Promise<LocalE57MetadataProbeResult> {
  return async (input) => await runAdapter(
    input,
    runner,
    operationTimeoutMs,
    boundRuntime,
  );
}

export async function inspectLocalE57Metadata(
  input: LocalE57MetadataProbeInput,
): Promise<LocalE57MetadataProbeResult> {
  return await runAdapter(
    input,
    runBoundedPythonProbe,
    LOCAL_E57_METADATA_PROBE_OPERATION_TIMEOUT_MS,
    LOCAL_E57_METADATA_PROBE_BOUND_RUNTIME,
  );
}

interface VerifiedResultReceiptIdentity {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) === stableCanonicalJson(toCanonicalJson(right));
}

function validateFixedHeader(value: unknown): boolean {
  return isJsonRecord(value) &&
    hasExactKeys(value, ["code", "coverage", "state"]) &&
    value.code === "E57_PHYSICAL_HEADER_ESTABLISHED" &&
    value.coverage === "physical_header" &&
    value.state === "established";
}

function validateFixedLimitations(value: unknown): boolean {
  return Array.isArray(value) &&
    value.length === LOCAL_E57_METADATA_PROBE_LIMITATIONS.length &&
    value.every((item, index) => item === LOCAL_E57_METADATA_PROBE_LIMITATIONS[index]);
}

function validateFixedPolicy(value: unknown): boolean {
  return isJsonRecord(value) &&
    hasExactKeys(value, [
      "authority",
      "cloudAccess",
      "imageBlobBytesRead",
      "networkAccess",
      "pointRecordsRead",
      "processBoundary",
      "sourceAccess",
      "sourceWrites",
    ]) &&
    value.authority === LOCAL_E57_METADATA_PROBE_POLICY.authority &&
    value.cloudAccess === LOCAL_E57_METADATA_PROBE_POLICY.cloudAccess &&
    value.imageBlobBytesRead === LOCAL_E57_METADATA_PROBE_POLICY.imageBlobBytesRead &&
    value.networkAccess === LOCAL_E57_METADATA_PROBE_POLICY.networkAccess &&
    value.pointRecordsRead === LOCAL_E57_METADATA_PROBE_POLICY.pointRecordsRead &&
    value.processBoundary === LOCAL_E57_METADATA_PROBE_POLICY.processBoundary &&
    value.sourceAccess === LOCAL_E57_METADATA_PROBE_POLICY.sourceAccess &&
    value.sourceWrites === LOCAL_E57_METADATA_PROBE_POLICY.sourceWrites;
}

function parseResultReceipt(value: unknown): VerifiedResultReceiptIdentity | null {
  if (
    !isJsonRecord(value) ||
    !hasExactKeys(value, ["path", "sha256", "sizeBytes"]) ||
    typeof value.path !== "string" ||
    !SHA256_HEX.test(typeof value.sha256 === "string" ? value.sha256 : "") ||
    !isSafeNonnegativeInteger(value.sizeBytes)
  ) {
    return null;
  }
  return { path: value.path, sha256: value.sha256 as string, sizeBytes: value.sizeBytes };
}

function sourceFactsMatchReceiptAndAggregate(
  sourceFacts: UniversalSourceFactsFileResult,
  receipt: VerifiedResultReceiptIdentity,
  aggregate: E57AggregateMetadata | null,
): boolean {
  if (
    sourceFacts.kind !== "asset" ||
    sourceFacts.asset.format !== "e57" ||
    sourceFacts.asset.inspection.state !== "established" ||
    sourceFacts.asset.inspection.code !== "E57_PHYSICAL_HEADER_ESTABLISHED" ||
    sourceFacts.asset.inspection.coverage !== "physical_header" ||
    sourceFacts.asset.facts === null ||
    sourceFacts.asset.source.path !== receipt.path ||
    sourceFacts.asset.source.sha256 !== receipt.sha256 ||
    sourceFacts.asset.source.sizeBytes !== receipt.sizeBytes
  ) {
    return false;
  }
  const attached = sourceFacts.asset.facts.aggregateMetadata;
  return aggregate === null
    ? attached === null
    : attached !== null && canonicalValuesEqual(attached, aggregate);
}

function validateFileEvidence(value: unknown): boolean {
  return isJsonRecord(value) &&
    hasExactKeys(value, [
      "prePostSha256Match",
      "prePostStatIdentityMatch",
      "sha256",
      "sizeBytes",
    ]) &&
    value.prePostSha256Match === true &&
    value.prePostStatIdentityMatch === true &&
    typeof value.sha256 === "string" &&
    SHA256_HEX.test(value.sha256) &&
    isSafeNonnegativeInteger(value.sizeBytes);
}

function validateSourceEvidence(value: unknown, receipt: VerifiedResultReceiptIdentity): boolean {
  return isJsonRecord(value) &&
    hasExactKeys(value, [
      "prePostSha256Match",
      "prePostStatIdentityMatch",
      "receiptIdentityMatch",
      "sha256",
      "sizeBytes",
    ]) &&
    value.prePostSha256Match === true &&
    value.prePostStatIdentityMatch === true &&
    value.receiptIdentityMatch === true &&
    value.sha256 === receipt.sha256 &&
    value.sizeBytes === receipt.sizeBytes;
}

function validateInvocationEvidence(value: unknown): boolean {
  if (!isJsonRecord(value) || !hasExactKeys(value, [
    "imageBlobBytesRead",
    "maximumStderrBytes",
    "maximumStdoutBytes",
    "mode",
    "operationTimeoutMs",
    "pointRecordsRead",
    "pythonFlags",
    "shell",
    "sourceOpenMode",
    "timeoutMs",
    "windowsHide",
  ])) {
    return false;
  }
  const flags = value.pythonFlags;
  return value.imageBlobBytesRead === false &&
    value.maximumStderrBytes === LOCAL_E57_METADATA_PROBE_MAX_STDERR_BYTES &&
    value.maximumStdoutBytes === LOCAL_E57_METADATA_PROBE_MAX_STDOUT_BYTES &&
    value.mode === "inspect-e57-aggregate" &&
    value.operationTimeoutMs === LOCAL_E57_METADATA_PROBE_OPERATION_TIMEOUT_MS &&
    value.pointRecordsRead === false &&
    Array.isArray(flags) &&
    flags.length === 3 &&
    flags[0] === "-I" &&
    flags[1] === "-S" &&
    flags[2] === "-B" &&
    value.shell === false &&
    value.sourceOpenMode === "read-only" &&
    value.timeoutMs === LOCAL_E57_METADATA_PROBE_TIMEOUT_MS &&
    value.windowsHide === true;
}

function validateRuntimeVersions(value: unknown, aggregate: E57AggregateMetadata): boolean {
  return isJsonRecord(value) &&
    hasExactKeys(value, ["numpy", "pye57", "python"]) &&
    value.numpy === aggregate.runtimeVersions.numpy &&
    value.pye57 === aggregate.adapter.version &&
    value.python === aggregate.runtimeVersions.python;
}

function validateRuntimeBundleEvidence(value: unknown): boolean {
  return isJsonRecord(value) &&
    hasExactKeys(value, [
      "adapterBindingSha256",
      "bundleReceiptSha256",
      "completeTreePrePostMatch",
      "fileCount",
      "microsoftCppRuntimeDisposition",
      "qualificationSha256",
      "totalFileBytes",
    ]) &&
    typeof value.adapterBindingSha256 === "string" &&
    SHA256_HEX.test(value.adapterBindingSha256) &&
    typeof value.bundleReceiptSha256 === "string" &&
    SHA256_HEX.test(value.bundleReceiptSha256) &&
    value.completeTreePrePostMatch === true &&
    typeof value.fileCount === "number" &&
    Number.isSafeInteger(value.fileCount) &&
    value.fileCount > 0 &&
    value.microsoftCppRuntimeDisposition ===
      "central_prerequisite_direct_from_microsoft" &&
    typeof value.qualificationSha256 === "string" &&
    SHA256_HEX.test(value.qualificationSha256) &&
    typeof value.totalFileBytes === "number" &&
    Number.isSafeInteger(value.totalFileBytes) &&
    value.totalFileBytes > 0;
}

function validateExecutionEvidence(
  value: unknown,
  receipt: VerifiedResultReceiptIdentity,
  aggregate: E57AggregateMetadata,
): boolean {
  return isJsonRecord(value) &&
    hasExactKeys(value, [
      "interpreter",
      "invocation",
      "probeScript",
      "runtimeBundle",
      "runtimeVersions",
      "source",
    ]) &&
    validateFileEvidence(value.interpreter) &&
    validateInvocationEvidence(value.invocation) &&
    validateFileEvidence(value.probeScript) &&
    validateRuntimeBundleEvidence(value.runtimeBundle) &&
    validateRuntimeVersions(value.runtimeVersions, aggregate) &&
    validateSourceEvidence(value.source, receipt);
}

function validateUnavailableDeepMetadata(
  value: Record<string, unknown>,
  sourceFacts: UniversalSourceFactsFileResult,
  receipt: VerifiedResultReceiptIdentity,
): boolean {
  if (!hasExactKeys(value, ["reason", "state"]) || !isJsonRecord(value.reason)) return false;
  const reason = value.reason;
  if (
    !hasExactKeys(reason, ["code", "message", "nextAction"]) ||
    typeof reason.code !== "string" ||
    !Object.prototype.hasOwnProperty.call(UNAVAILABLE_REASONS, reason.code)
  ) {
    return false;
  }
  const code = reason.code as LocalE57MetadataProbeUnavailableCode;
  const expected = UNAVAILABLE_REASONS[code];
  return reason.message === expected.message &&
    reason.nextAction === expected.nextAction &&
    sourceFactsMatchReceiptAndAggregate(sourceFacts, receipt, null);
}

function validateAvailableDeepMetadata(
  value: Record<string, unknown>,
  sourceFacts: UniversalSourceFactsFileResult,
  receipt: VerifiedResultReceiptIdentity,
): boolean {
  if (!hasExactKeys(value, ["aggregate", "execution", "state"])) return false;
  const aggregateResult = E57AggregateMetadataSchema.safeParse(value.aggregate);
  if (!aggregateResult.success || aggregateResult.data.file.byteSize !== receipt.sizeBytes) return false;
  return sourceFactsMatchReceiptAndAggregate(sourceFacts, receipt, aggregateResult.data) &&
    validateExecutionEvidence(value.execution, receipt, aggregateResult.data);
}

function validateResultPayload(value: Record<string, unknown>): boolean {
  if (
    !hasExactKeys(value, [
      "deepMetadata",
      "establishedHeader",
      "limitations",
      "policy",
      "receiptIdentity",
      "schemaVersion",
      "sourceFacts",
    ]) ||
    value.schemaVersion !== LOCAL_E57_METADATA_PROBE_SCHEMA_VERSION ||
    !validateFixedHeader(value.establishedHeader) ||
    !validateFixedLimitations(value.limitations) ||
    !validateFixedPolicy(value.policy) ||
    !isJsonRecord(value.deepMetadata)
  ) {
    return false;
  }
  const receipt = parseResultReceipt(value.receiptIdentity);
  const sourceFactsResult = UniversalSourceFactsFileResultSchema.safeParse(value.sourceFacts);
  if (receipt === null || !sourceFactsResult.success) return false;
  if (value.deepMetadata.state === "available") {
    return validateAvailableDeepMetadata(value.deepMetadata, sourceFactsResult.data, receipt);
  }
  if (value.deepMetadata.state === "unavailable") {
    return validateUnavailableDeepMetadata(value.deepMetadata, sourceFactsResult.data, receipt);
  }
  return false;
}

export function verifyLocalE57MetadataProbeResultDigest(result: unknown): boolean {
  try {
    if (!isJsonRecord(result) || !hasExactKeys(result, [
      "adapterResultSha256",
      "deepMetadata",
      "establishedHeader",
      "limitations",
      "policy",
      "receiptIdentity",
      "schemaVersion",
      "sourceFacts",
    ])) {
      return false;
    }
    const { adapterResultSha256, ...payload } = result;
    if (!validateResultPayload(payload)) return false;
    return typeof adapterResultSha256 === "string" &&
      SHA256_HEX.test(adapterResultSha256) &&
      adapterResultSha256 === domainSeparatedSha256(
      LOCAL_E57_METADATA_PROBE_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    );
  } catch {
    return false;
  }
}

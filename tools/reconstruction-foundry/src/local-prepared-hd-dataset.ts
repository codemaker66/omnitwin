import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import {
  FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0,
  FoundryPreparedHdDatasetPythonSummaryV0Schema,
  FoundryUniversalIntakeReceiptSchema,
  compileFoundryPreparedHdDatasetReadinessReceiptV0,
  inspectUniversalIntake,
  serializeFoundryPreparedHdDatasetReadinessReceiptV0,
  verifyFoundryPreparedHdDatasetReadinessReceiptV0,
  type FoundryPreparedHdDatasetReadinessReceiptV0,
  type FoundryPreparedHdDatasetToolReceiptsV0,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";

export const LOCAL_PREPARED_HD_DATASET_GATE_DTO_V0 =
  "omnitwin.foundry.local-prepared-hd-dataset-gate.v0";
export const LOCAL_PREPARED_HD_DATASET_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
export const LOCAL_PREPARED_HD_DATASET_MAX_STDERR_BYTES = 64 * 1024;
export const LOCAL_PREPARED_HD_DATASET_OPERATION_TIMEOUT_MS = 15 * 60 * 1_000;
export const LOCAL_PREPARED_HD_DATASET_SETTLEMENT_TIMEOUT_MS = 5_000;

const MAX_OPERATION_TIMEOUT_MS = 60 * 60 * 1_000;
const MAX_SETTLEMENT_TIMEOUT_MS = 60_000;
const MAX_TOOL_FILE_BYTES = 4 * 1024 * 1024;
const REQUEST_ID = /^[a-f0-9]{32}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export type LocalPreparedHdDatasetStateV0 =
  | "unavailable"
  | "ready"
  | "running"
  | "completed"
  | "failed";

export interface LocalPreparedHdDatasetStartRequestV0 {
  readonly requestId: string;
  readonly receiptSha256: string;
}

export interface LocalPreparedHdDatasetTrustedContextV0 {
  readonly repoRoot: string;
  readonly sourceRoot: string;
  readonly pythonExecutable: string;
}

export interface LocalPreparedHdDatasetReportSummaryDtoV0 {
  readonly schemaVersion: string;
  readonly readinessReceiptSha256: string;
  readonly sourceReceiptSha256: string;
  readonly cameraCount: number;
  readonly imageCount: number;
  readonly runtimeImageCount: number;
  readonly trainImageCount: number;
  readonly heldoutImageCount: number;
  readonly pointCount: number;
  readonly depthPriorCount: number;
}

export interface LocalPreparedHdDatasetDtoV0 {
  readonly schemaVersion: typeof LOCAL_PREPARED_HD_DATASET_GATE_DTO_V0;
  readonly state: LocalPreparedHdDatasetStateV0;
  readonly authority: "none";
  readonly operation: "prepared_dataset_validation_only";
  readonly receiptSha256: string | null;
  readonly requestId: string | null;
  readonly message: string;
  readonly failureCode: string | null;
  readonly report: LocalPreparedHdDatasetReportSummaryDtoV0 | null;
}

export interface LocalPreparedHdDatasetProcessInvocationV0 {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly limits: {
    readonly maximumStdoutBytes: number;
    readonly maximumStderrBytes: number;
    readonly timeoutMs: number;
  };
  readonly options: {
    readonly cwd: string;
    readonly env: Readonly<NodeJS.ProcessEnv>;
    readonly shell: false;
    readonly windowsHide: true;
  };
}

export type LocalPreparedHdDatasetProcessOutcomeV0 =
  | {
      readonly kind: "completed";
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly stdout: Buffer;
      readonly stderr: Buffer;
    }
  | { readonly kind: "cancelled" }
  | { readonly kind: "spawn_failed" }
  | { readonly kind: "stdout_limit_exceeded" }
  | { readonly kind: "stderr_limit_exceeded" }
  | { readonly kind: "timed_out" };

export type LocalPreparedHdDatasetProcessRunnerV0 = (
  invocation: LocalPreparedHdDatasetProcessInvocationV0,
  signal: AbortSignal,
) => Promise<LocalPreparedHdDatasetProcessOutcomeV0>;

export type LocalPreparedHdDatasetSourceInspectorV0 = (
  sourceRoot: string,
  signal: AbortSignal,
) => Promise<FoundryUniversalIntakeReceipt>;

export interface CreateLocalPreparedHdDatasetControllerV0Options {
  readonly trustedContext: LocalPreparedHdDatasetTrustedContextV0 | null;
  /** Process-owned injection seam. Browser requests can never select a runner. */
  readonly processRunner?: LocalPreparedHdDatasetProcessRunnerV0;
  /** Process-owned injection seam. Browser requests can never select an inspector. */
  readonly inspector?: LocalPreparedHdDatasetSourceInspectorV0;
  readonly operationTimeoutMs?: number;
  readonly settlementTimeoutMs?: number;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

interface StableToolFile {
  readonly identity: FileIdentity;
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

interface StableToolSet {
  readonly parser: StableToolFile;
  readonly cli: StableToolFile;
  readonly config: StableToolFile;
  readonly sourceLock: StableToolFile;
}

interface ActiveRun {
  readonly requestId: string;
  readonly receiptSha256: string;
  readonly abortController: AbortController;
  readonly settled: Promise<void>;
  readonly resolveSettled: () => void;
  completion: Promise<LocalPreparedHdDatasetDtoV0>;
  abortCode: string | null;
  deadline: ReturnType<typeof setTimeout> | null;
  acceptResult: boolean;
}

export class LocalPreparedHdDatasetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalPreparedHdDatasetError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new LocalPreparedHdDatasetError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

export function parseLocalPreparedHdDatasetStartRequestV0(
  input: unknown,
): LocalPreparedHdDatasetStartRequestV0 {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["receiptSha256", "requestId"]) ||
    typeof input.requestId !== "string" ||
    !REQUEST_ID.test(input.requestId) ||
    typeof input.receiptSha256 !== "string" ||
    !SHA256.test(input.receiptSha256)
  ) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_REQUEST_INVALID",
      "The prepared-dataset start request must contain only one opaque request ID and one intake receipt digest.",
    );
  }
  return Object.freeze({
    requestId: input.requestId,
    receiptSha256: input.receiptSha256,
  });
}

function validDuration(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function canonicalLocalAbsolutePath(value: string): string {
  const canonical = resolve(value);
  if (
    value.length === 0 ||
    !isAbsolute(value) ||
    value !== canonical ||
    /^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/u.test(value)
  ) {
    throw new TypeError("prepared-dataset trusted paths must be canonical local absolute paths");
  }
  return canonical;
}

function copyTrustedContext(
  input: LocalPreparedHdDatasetTrustedContextV0,
): LocalPreparedHdDatasetTrustedContextV0 {
  return Object.freeze({
    repoRoot: canonicalLocalAbsolutePath(input.repoRoot),
    sourceRoot: canonicalLocalAbsolutePath(input.sourceRoot),
    pythonExecutable: canonicalLocalAbsolutePath(input.pythonExecutable),
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const member of Object.values(value)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

function dto(input: {
  readonly state: LocalPreparedHdDatasetStateV0;
  readonly receiptSha256?: string | null;
  readonly requestId?: string | null;
  readonly message: string;
  readonly failureCode?: string | null;
  readonly report?: LocalPreparedHdDatasetReportSummaryDtoV0 | null;
}): LocalPreparedHdDatasetDtoV0 {
  return deepFreeze({
    schemaVersion: LOCAL_PREPARED_HD_DATASET_GATE_DTO_V0,
    state: input.state,
    authority: "none",
    operation: "prepared_dataset_validation_only",
    receiptSha256: input.receiptSha256 ?? null,
    requestId: input.requestId ?? null,
    message: input.message,
    failureCode: input.failureCode ?? null,
    report: input.report ?? null,
  });
}

function cloneDto(value: LocalPreparedHdDatasetDtoV0): LocalPreparedHdDatasetDtoV0 {
  return deepFreeze(structuredClone(value));
}

function exactPreparedPackageShape(receipt: FoundryUniversalIntakeReceipt): boolean {
  if (receipt.source.kind !== "directory" || receipt.files.length === 0) return false;
  let hasDataset = false;
  let hasDepths = false;
  for (const file of receipt.files) {
    if (file.path.startsWith("dataset/")) hasDataset = true;
    else if (file.path.startsWith("depths/")) hasDepths = true;
    else return false;
  }
  return hasDataset && hasDepths;
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function sameLocalPath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}

function fileIdentity(input: {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}): FileIdentity {
  return {
    dev: input.dev,
    ino: input.ino,
    size: input.size,
    mtimeMs: input.mtimeMs,
    ctimeMs: input.ctimeMs,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_CANCELLED",
      "The prepared-dataset validation was cancelled.",
    );
  }
}

async function stableReadToolFile(
  repoRoot: string,
  relativePath: string,
  signal: AbortSignal,
): Promise<StableToolFile> {
  assertNotCancelled(signal);
  const absolutePath = resolve(repoRoot, ...relativePath.split("/"));
  if (!isWithin(repoRoot, absolutePath)) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_TOOL_UNAVAILABLE",
      "A fixed prepared-dataset validation tool is unavailable.",
    );
  }
  const initialPathStat = await lstat(absolutePath);
  if (initialPathStat.isSymbolicLink() || !initialPathStat.isFile()) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_TOOL_UNAVAILABLE",
      "A fixed prepared-dataset validation tool is not a regular file.",
    );
  }
  const canonicalPath = await realpath(absolutePath);
  if (!sameLocalPath(canonicalPath, absolutePath)) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_TOOL_UNAVAILABLE",
      "A fixed prepared-dataset validation tool did not resolve to its fixed path.",
    );
  }
  const handle = await open(absolutePath, "r");
  try {
    const handleBefore = await handle.stat();
    const beforeIdentity = fileIdentity(handleBefore);
    if (
      !handleBefore.isFile() ||
      !sameIdentity(fileIdentity(initialPathStat), beforeIdentity) ||
      handleBefore.size <= 0 ||
      handleBefore.size > MAX_TOOL_FILE_BYTES
    ) {
      fail(
        "LOCAL_PREPARED_HD_DATASET_TOOL_UNAVAILABLE",
        "A fixed prepared-dataset validation tool is outside its file bounds.",
      );
    }
    const bytes = await handle.readFile();
    assertNotCancelled(signal);
    const handleAfter = await handle.stat();
    const finalPathStat = await lstat(absolutePath);
    const canonicalAfter = await realpath(absolutePath);
    if (
      bytes.byteLength !== handleBefore.size ||
      bytes.byteLength > MAX_TOOL_FILE_BYTES ||
      finalPathStat.isSymbolicLink() ||
      !finalPathStat.isFile() ||
      !sameIdentity(beforeIdentity, fileIdentity(handleAfter)) ||
      !sameIdentity(beforeIdentity, fileIdentity(finalPathStat)) ||
      !sameLocalPath(canonicalAfter, absolutePath)
    ) {
      fail(
        "LOCAL_PREPARED_HD_DATASET_TOOL_MUTATED",
        "A fixed prepared-dataset validation tool changed while it was read.",
      );
    }
    return Object.freeze({
      identity: beforeIdentity,
      path: relativePath,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } finally {
    await handle.close();
  }
}

async function stableReadToolSet(
  repoRoot: string,
  signal: AbortSignal,
): Promise<StableToolSet> {
  const [parser, cli, config, sourceLock] = await Promise.all([
    stableReadToolFile(repoRoot, FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.parser, signal),
    stableReadToolFile(repoRoot, FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.cli, signal),
    stableReadToolFile(repoRoot, FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.config, signal),
    stableReadToolFile(repoRoot, FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.sourceLock, signal),
  ]);
  return Object.freeze({ parser, cli, config, sourceLock });
}

function stableToolSetsMatch(before: StableToolSet, after: StableToolSet): boolean {
  return (["parser", "cli", "config", "sourceLock"] as const).every((key) =>
    before[key].path === after[key].path &&
    before[key].sizeBytes === after[key].sizeBytes &&
    before[key].sha256 === after[key].sha256 &&
    sameIdentity(before[key].identity, after[key].identity));
}

function toolReceipts(input: StableToolSet): FoundryPreparedHdDatasetToolReceiptsV0 {
  return {
    parser: {
      path: FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.parser,
      sizeBytes: input.parser.sizeBytes,
      sha256: input.parser.sha256,
    },
    cli: {
      path: FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.cli,
      sizeBytes: input.cli.sizeBytes,
      sha256: input.cli.sha256,
    },
    config: {
      path: FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.config,
      sizeBytes: input.config.sizeBytes,
      sha256: input.config.sha256,
    },
    sourceLock: {
      path: FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.sourceLock,
      sizeBytes: input.sourceLock.sizeBytes,
      sha256: input.sourceLock.sha256,
    },
  };
}

function minimalPythonEnvironment(): Readonly<NodeJS.ProcessEnv> {
  const environment: NodeJS.ProcessEnv = {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONHASHSEED: "0",
    PYTHONUTF8: "1",
  };
  const permitted = new Set([
    "appdata",
    "home",
    "systemroot",
    "windir",
    "temp",
    "tmp",
  ]);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && permitted.has(key.toLocaleLowerCase("en-US"))) {
      environment[key] = value;
    }
  }
  return Object.freeze(environment);
}

function processInvocation(
  context: LocalPreparedHdDatasetTrustedContextV0,
  timeoutMs: number,
): LocalPreparedHdDatasetProcessInvocationV0 {
  return deepFreeze({
    command: context.pythonExecutable,
    arguments: [
      "-B",
      "-m",
      "venviewer_training.colmap_contract_cli",
      "--package-root",
      context.sourceRoot,
    ],
    limits: {
      maximumStdoutBytes: LOCAL_PREPARED_HD_DATASET_MAX_STDOUT_BYTES,
      maximumStderrBytes: LOCAL_PREPARED_HD_DATASET_MAX_STDERR_BYTES,
      timeoutMs,
    },
    options: {
      cwd: context.repoRoot,
      env: minimalPythonEnvironment(),
      shell: false,
      windowsHide: true,
    },
  });
}

type ProcessTermination = Exclude<
  LocalPreparedHdDatasetProcessOutcomeV0,
  { readonly kind: "completed" }
>["kind"];

class BoundedProcessCapture {
  readonly #child: ReturnType<typeof spawn>;
  readonly #invocation: LocalPreparedHdDatasetProcessInvocationV0;
  readonly #signal: AbortSignal;
  readonly #resolve: (outcome: LocalPreparedHdDatasetProcessOutcomeV0) => void;
  readonly #stdout: Buffer[] = [];
  readonly #stderr: Buffer[] = [];
  readonly #timer: ReturnType<typeof setTimeout>;
  readonly #onAbort = (): void => {
    this.terminate("cancelled");
  };
  #stdoutBytes = 0;
  #stderrBytes = 0;
  #termination: ProcessTermination | null = null;
  #settled = false;

  constructor(
    child: ReturnType<typeof spawn>,
    invocation: LocalPreparedHdDatasetProcessInvocationV0,
    signal: AbortSignal,
    resolveOutcome: (outcome: LocalPreparedHdDatasetProcessOutcomeV0) => void,
  ) {
    this.#child = child;
    this.#invocation = invocation;
    this.#signal = signal;
    this.#resolve = resolveOutcome;
    this.#timer = setTimeout(() => {
      this.terminate("timed_out");
    }, invocation.limits.timeoutMs);
    this.#timer.unref();
    signal.addEventListener("abort", this.#onAbort, { once: true });
    if (signal.aborted) this.terminate("cancelled");
  }

  acceptStdout(chunkInput: Buffer | string): void {
    if (this.#termination !== null) return;
    const chunk = Buffer.isBuffer(chunkInput) ? chunkInput : Buffer.from(chunkInput);
    this.#stdoutBytes += chunk.byteLength;
    if (this.#stdoutBytes > this.#invocation.limits.maximumStdoutBytes) {
      this.terminate("stdout_limit_exceeded");
      return;
    }
    this.#stdout.push(Buffer.from(chunk));
  }

  acceptStderr(chunkInput: Buffer | string): void {
    if (this.#termination !== null) return;
    const chunk = Buffer.isBuffer(chunkInput) ? chunkInput : Buffer.from(chunkInput);
    this.#stderrBytes += chunk.byteLength;
    if (this.#stderrBytes > this.#invocation.limits.maximumStderrBytes) {
      this.terminate("stderr_limit_exceeded");
      return;
    }
    this.#stderr.push(Buffer.from(chunk));
  }

  terminate(reason: ProcessTermination): void {
    if (this.#termination !== null) return;
    this.#termination = reason;
    this.#child.kill("SIGKILL");
  }

  close(exitCode: number | null, childSignal: NodeJS.Signals | null): void {
    if (this.#settled) return;
    this.#settled = true;
    clearTimeout(this.#timer);
    this.#signal.removeEventListener("abort", this.#onAbort);
    if (this.#termination !== null) {
      this.#resolve({ kind: this.#termination });
      return;
    }
    this.#resolve({
      kind: "completed",
      exitCode,
      signal: childSignal,
      stdout: Buffer.concat(this.#stdout, this.#stdoutBytes),
      stderr: Buffer.concat(this.#stderr, this.#stderrBytes),
    });
  }
}

export const defaultLocalPreparedHdDatasetProcessRunnerV0:
  LocalPreparedHdDatasetProcessRunnerV0 = async (invocation, signal) => {
    if (signal.aborted) return { kind: "cancelled" };
    return await new Promise<LocalPreparedHdDatasetProcessOutcomeV0>((resolveOutcome) => {
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
      const capture = new BoundedProcessCapture(child, invocation, signal, resolveOutcome);
      child.stdout?.on("data", (chunk: Buffer | string) => {
        capture.acceptStdout(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        capture.acceptStderr(chunk);
      });
      child.stdout?.once("error", () => {
        capture.terminate("spawn_failed");
      });
      child.stderr?.once("error", () => {
        capture.terminate("spawn_failed");
      });
      child.once("error", () => {
        capture.terminate("spawn_failed");
      });
      child.once("close", (exitCode: number | null, childSignal: NodeJS.Signals | null) => {
        capture.close(exitCode, childSignal);
      });
    });
  };

const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });

function parsePythonSuccessEnvelope(
  bytes: Buffer,
): ReturnType<typeof FoundryPreparedHdDatasetPythonSummaryV0Schema.parse> {
  let text: string;
  try {
    text = fatalUtf8.decode(bytes);
  } catch {
    fail(
      "LOCAL_PREPARED_HD_DATASET_OUTPUT_INVALID",
      "The prepared-dataset validator returned invalid output.",
    );
  }
  if (!text.endsWith("\n")) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_OUTPUT_INVALID",
      "The prepared-dataset validator returned an incomplete output document.",
    );
  }
  const withoutLf = text.slice(0, -1);
  const documentText = withoutLf.endsWith("\r") ? withoutLf.slice(0, -1) : withoutLf;
  if (
    documentText.length === 0 ||
    documentText.trim() !== documentText ||
    documentText.includes("\n") ||
    documentText.includes("\r")
  ) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_OUTPUT_INVALID",
      "The prepared-dataset validator returned extra output.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(documentText);
  } catch {
    fail(
      "LOCAL_PREPARED_HD_DATASET_OUTPUT_INVALID",
      "The prepared-dataset validator returned malformed output.",
    );
  }
  const result = FoundryPreparedHdDatasetPythonSummaryV0Schema.safeParse(parsed);
  if (!result.success) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_OUTPUT_INVALID",
      "The prepared-dataset validator returned output outside the fixed contract.",
    );
  }
  return result.data;
}

function evaluateProcessOutcome(
  outcome: LocalPreparedHdDatasetProcessOutcomeV0,
): ReturnType<typeof FoundryPreparedHdDatasetPythonSummaryV0Schema.parse> {
  if (outcome.kind === "cancelled") {
    fail(
      "LOCAL_PREPARED_HD_DATASET_CANCELLED",
      "The prepared-dataset validation was cancelled.",
    );
  }
  if (outcome.kind === "timed_out") {
    fail(
      "LOCAL_PREPARED_HD_DATASET_TIMED_OUT",
      "The prepared-dataset validation exceeded its fixed deadline.",
    );
  }
  if (
    outcome.kind === "stdout_limit_exceeded" ||
    outcome.kind === "stderr_limit_exceeded"
  ) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_OUTPUT_LIMIT_EXCEEDED",
      "The prepared-dataset validator exceeded its output limit.",
    );
  }
  if (outcome.kind === "spawn_failed") {
    fail(
      "LOCAL_PREPARED_HD_DATASET_PROCESS_FAILED",
      "The prepared-dataset validator process could not be started.",
    );
  }
  if (
    outcome.stdout.byteLength > LOCAL_PREPARED_HD_DATASET_MAX_STDOUT_BYTES ||
    outcome.stderr.byteLength > LOCAL_PREPARED_HD_DATASET_MAX_STDERR_BYTES
  ) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_OUTPUT_LIMIT_EXCEEDED",
      "The prepared-dataset validator exceeded its output limit.",
    );
  }
  if (outcome.exitCode !== 0 || outcome.signal !== null) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_PROCESS_FAILED",
      "The prepared-dataset validator process failed.",
    );
  }
  if (outcome.stderr.byteLength !== 0) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_STDERR_NOT_EMPTY",
      "The prepared-dataset validator returned unexpected diagnostic output.",
    );
  }
  return parsePythonSuccessEnvelope(outcome.stdout);
}

function canonicalReceipt(receipt: FoundryUniversalIntakeReceipt): string {
  return JSON.stringify(receipt);
}

function containsForbiddenAbsolutePath(
  value: unknown,
  forbidden: readonly string[],
): boolean {
  if (typeof value === "string") {
    const comparable = process.platform === "win32"
      ? value.toLocaleLowerCase("en-US")
      : value;
    return forbidden.some((path) => {
      const candidate = process.platform === "win32"
        ? path.toLocaleLowerCase("en-US")
        : path;
      return comparable.includes(candidate);
    });
  }
  if (Array.isArray(value)) {
    return value.some((member) => containsForbiddenAbsolutePath(member, forbidden));
  }
  if (isRecord(value)) {
    return Object.values(value).some((member) =>
      containsForbiddenAbsolutePath(member, forbidden));
  }
  return false;
}

async function inspectSourceBefore(
  inspector: LocalPreparedHdDatasetSourceInspectorV0,
  context: LocalPreparedHdDatasetTrustedContextV0,
  signal: AbortSignal,
): Promise<FoundryUniversalIntakeReceipt> {
  try {
    const value = await inspector(context.sourceRoot, signal);
    return FoundryUniversalIntakeReceiptSchema.parse(value);
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    fail(
      "LOCAL_PREPARED_HD_DATASET_SOURCE_INSPECTION_FAILED",
      "The prepared package could not be re-inspected safely.",
    );
  }
}

async function inspectSourceAfter(
  inspector: LocalPreparedHdDatasetSourceInspectorV0,
  context: LocalPreparedHdDatasetTrustedContextV0,
  signal: AbortSignal,
): Promise<FoundryUniversalIntakeReceipt> {
  try {
    const value = await inspector(context.sourceRoot, signal);
    return FoundryUniversalIntakeReceiptSchema.parse(value);
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    fail(
      "LOCAL_PREPARED_HD_DATASET_SOURCE_MUTATED",
      "The prepared package did not remain stable after validation.",
    );
  }
}

async function readToolsBefore(
  context: LocalPreparedHdDatasetTrustedContextV0,
  signal: AbortSignal,
): Promise<StableToolSet> {
  try {
    return await stableReadToolSet(context.repoRoot, signal);
  } catch (error: unknown) {
    if (error instanceof LocalPreparedHdDatasetError || signal.aborted) throw error;
    fail(
      "LOCAL_PREPARED_HD_DATASET_TOOL_UNAVAILABLE",
      "The fixed prepared-dataset validation tools could not be read safely.",
    );
  }
}

async function readToolsAfter(
  context: LocalPreparedHdDatasetTrustedContextV0,
  signal: AbortSignal,
): Promise<StableToolSet> {
  try {
    return await stableReadToolSet(context.repoRoot, signal);
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    fail(
      "LOCAL_PREPARED_HD_DATASET_TOOL_MUTATED",
      "A fixed prepared-dataset validation tool did not remain stable.",
    );
  }
}

async function executePreparedHdDatasetGate(
  context: LocalPreparedHdDatasetTrustedContextV0,
  boundReceipt: FoundryUniversalIntakeReceipt,
  inspector: LocalPreparedHdDatasetSourceInspectorV0,
  runner: LocalPreparedHdDatasetProcessRunnerV0,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<FoundryPreparedHdDatasetReadinessReceiptV0> {
  const [sourceBefore, toolsBefore] = await Promise.all([
    inspectSourceBefore(inspector, context, signal),
    readToolsBefore(context, signal),
  ]);
  assertNotCancelled(signal);
  if (
    sourceBefore.receiptSha256 !== boundReceipt.receiptSha256 ||
    canonicalReceipt(sourceBefore) !== canonicalReceipt(boundReceipt) ||
    !exactPreparedPackageShape(sourceBefore)
  ) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_SOURCE_MUTATED",
      "The prepared package no longer matches its bound intake receipt.",
    );
  }

  let outcome: LocalPreparedHdDatasetProcessOutcomeV0;
  try {
    outcome = await runner(processInvocation(context, timeoutMs), signal);
  } catch {
    outcome = { kind: "spawn_failed" };
  }
  assertNotCancelled(signal);

  const [sourceAfter, toolsAfter] = await Promise.all([
    inspectSourceAfter(inspector, context, signal),
    readToolsAfter(context, signal),
  ]);
  assertNotCancelled(signal);
  if (
    sourceAfter.receiptSha256 !== sourceBefore.receiptSha256 ||
    canonicalReceipt(sourceAfter) !== canonicalReceipt(sourceBefore)
  ) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_SOURCE_MUTATED",
      "The prepared package changed while it was validated.",
    );
  }
  if (!stableToolSetsMatch(toolsBefore, toolsAfter)) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_TOOL_MUTATED",
      "A fixed prepared-dataset validation tool changed while it was used.",
    );
  }

  const pythonSummary = evaluateProcessOutcome(outcome);
  let verified: FoundryPreparedHdDatasetReadinessReceiptV0;
  try {
    const consumedSourceMembers = sourceBefore.files.map((file) => ({
      intakeReceiptSha256: sourceBefore.receiptSha256,
      file: structuredClone(file),
    }));
    const preparedFiles = sourceBefore.files.map((file) => ({
      path: file.path,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    }));
    const compiled = compileFoundryPreparedHdDatasetReadinessReceiptV0({
      sourceReceiptBefore: sourceBefore,
      sourceReceiptAfter: sourceAfter,
      consumedSourceMembers,
      toolReceipts: toolReceipts(toolsBefore),
      preparedFiles,
      pythonSummary,
    });
    verified = verifyFoundryPreparedHdDatasetReadinessReceiptV0(compiled);
    serializeFoundryPreparedHdDatasetReadinessReceiptV0(verified);
  } catch {
    fail(
      "LOCAL_PREPARED_HD_DATASET_RECEIPT_REJECTED",
      "The prepared package did not satisfy the strict readiness receipt contract.",
    );
  }
  if (
    containsForbiddenAbsolutePath(verified, [
      context.repoRoot,
      context.sourceRoot,
      context.pythonExecutable,
    ])
  ) {
    fail(
      "LOCAL_PREPARED_HD_DATASET_PATH_DISCLOSURE",
      "The prepared-dataset receipt was rejected because it contained a private path.",
    );
  }
  return verified;
}

function reportSummary(
  receipt: FoundryPreparedHdDatasetReadinessReceiptV0,
): LocalPreparedHdDatasetReportSummaryDtoV0 {
  const summary = receipt.pythonValidation.summary;
  return deepFreeze({
    schemaVersion: receipt.schemaVersion,
    readinessReceiptSha256: receipt.receiptSha256,
    sourceReceiptSha256: receipt.source.universalIntakeReceiptSha256,
    cameraCount: summary.cameraCount,
    imageCount: summary.imageCount,
    runtimeImageCount: summary.runtimeImageCount,
    trainImageCount: summary.splits.trainCount,
    heldoutImageCount: summary.splits.heldoutCount,
    pointCount: summary.point3DCount,
    depthPriorCount: summary.depth.priorCount,
  });
}

function failureMessage(code: string): string {
  switch (code) {
    case "LOCAL_PREPARED_HD_DATASET_CANCELLED":
      return "Prepared-dataset validation was cancelled. No readiness receipt was retained.";
    case "LOCAL_PREPARED_HD_DATASET_TIMED_OUT":
      return "Prepared-dataset validation exceeded its fixed deadline. No readiness receipt was retained.";
    case "LOCAL_PREPARED_HD_DATASET_CONTROLLER_CLOSED":
      return "The prepared-dataset validation controller is closed.";
    case "LOCAL_PREPARED_HD_DATASET_SOURCE_MUTATED":
      return "The prepared package changed or no longer matched its bound receipt. No readiness receipt was retained.";
    case "LOCAL_PREPARED_HD_DATASET_TOOL_MUTATED":
      return "A fixed validation tool changed during the run. No readiness receipt was retained.";
    default:
      return "Prepared-dataset validation failed safely. No readiness receipt was retained.";
  }
}

function errorCode(error: unknown): string {
  return error instanceof LocalPreparedHdDatasetError
    ? error.code
    : "LOCAL_PREPARED_HD_DATASET_RUNNER_FAILED";
}

async function waitForSettlement(active: ActiveRun, timeoutMs: number): Promise<boolean> {
  let cancelTimeout = (): void => undefined;
  const timeout = new Promise<boolean>((resolveTimeout) => {
    const timer = setTimeout(() => {
      resolveTimeout(false);
    }, timeoutMs);
    timer.unref();
    cancelTimeout = (): void => {
      clearTimeout(timer);
    };
  });
  try {
    return await Promise.race([
      active.settled.then(() => true),
      timeout,
    ]);
  } finally {
    cancelTimeout();
  }
}

export class LocalPreparedHdDatasetControllerV0 {
  readonly #trustedContext: LocalPreparedHdDatasetTrustedContextV0 | null;
  readonly #processRunner: LocalPreparedHdDatasetProcessRunnerV0;
  readonly #inspector: LocalPreparedHdDatasetSourceInspectorV0;
  readonly #operationTimeoutMs: number;
  readonly #settlementTimeoutMs: number;
  #receipt: FoundryUniversalIntakeReceipt | null = null;
  #state: LocalPreparedHdDatasetDtoV0;
  #active: ActiveRun | null = null;
  #boundRequestId: string | null = null;
  #completedReport: FoundryPreparedHdDatasetReadinessReceiptV0 | null = null;
  #closed = false;

  constructor(options: CreateLocalPreparedHdDatasetControllerV0Options) {
    const operationTimeoutMs = options.operationTimeoutMs ??
      LOCAL_PREPARED_HD_DATASET_OPERATION_TIMEOUT_MS;
    const settlementTimeoutMs = options.settlementTimeoutMs ??
      LOCAL_PREPARED_HD_DATASET_SETTLEMENT_TIMEOUT_MS;
    if (!validDuration(operationTimeoutMs, MAX_OPERATION_TIMEOUT_MS)) {
      throw new TypeError("operationTimeoutMs is outside the fixed prepared-dataset bound");
    }
    if (!validDuration(settlementTimeoutMs, MAX_SETTLEMENT_TIMEOUT_MS)) {
      throw new TypeError("settlementTimeoutMs is outside the fixed prepared-dataset bound");
    }
    this.#trustedContext = options.trustedContext === null
      ? null
      : copyTrustedContext(options.trustedContext);
    this.#processRunner = options.processRunner ??
      defaultLocalPreparedHdDatasetProcessRunnerV0;
    this.#inspector = options.inspector ?? (async (sourceRoot, signal) =>
      await inspectUniversalIntake(sourceRoot, { signal }));
    this.#operationTimeoutMs = operationTimeoutMs;
    this.#settlementTimeoutMs = settlementTimeoutMs;
    this.#state = dto({
      state: "unavailable",
      message: this.#trustedContext === null
        ? "The fixed local prepared-dataset validation runtime is unavailable."
        : "Bind the current prepared-package intake receipt before validation.",
      failureCode: this.#trustedContext === null
        ? "LOCAL_PREPARED_HD_DATASET_RUNTIME_UNAVAILABLE"
        : "LOCAL_PREPARED_HD_DATASET_RECEIPT_NOT_BOUND",
    });
  }

  bindReceipt(input: FoundryUniversalIntakeReceipt): void {
    if (this.#closed) {
      fail(
        "LOCAL_PREPARED_HD_DATASET_CONTROLLER_CLOSED",
        "The prepared-dataset validation controller is closed.",
      );
    }
    if (this.#active !== null || this.#boundRequestId !== null) {
      fail(
        "LOCAL_PREPARED_HD_DATASET_RECEIPT_REBIND_REFUSED",
        "The prepared-dataset controller cannot be rebound after a start request.",
      );
    }
    let receipt: FoundryUniversalIntakeReceipt;
    try {
      receipt = FoundryUniversalIntakeReceiptSchema.parse(input);
    } catch {
      fail(
        "LOCAL_PREPARED_HD_DATASET_RECEIPT_INVALID",
        "The prepared-dataset controller requires a valid universal intake receipt.",
      );
    }
    this.#receipt = structuredClone(receipt);
    if (this.#trustedContext === null) {
      this.#state = dto({
        state: "unavailable",
        receiptSha256: receipt.receiptSha256,
        message: "The fixed local prepared-dataset validation runtime is unavailable.",
        failureCode: "LOCAL_PREPARED_HD_DATASET_RUNTIME_UNAVAILABLE",
      });
      return;
    }
    if (!exactPreparedPackageShape(receipt)) {
      this.#state = dto({
        state: "unavailable",
        receiptSha256: receipt.receiptSha256,
        message: "Select one prepared package containing only dataset/ and depths/ members.",
        failureCode: "LOCAL_PREPARED_HD_DATASET_LAYOUT_UNAVAILABLE",
      });
      return;
    }
    this.#state = dto({
      state: "ready",
      receiptSha256: receipt.receiptSha256,
      message: "The prepared package is ready for strict Config-B dataset validation.",
    });
  }

  availability(): LocalPreparedHdDatasetDtoV0 {
    return this.snapshot();
  }

  snapshot(requestId?: string): LocalPreparedHdDatasetDtoV0 {
    if (requestId !== undefined && requestId !== this.#boundRequestId) {
      return cloneDto(dto({
        state: "failed",
        receiptSha256: this.#receipt?.receiptSha256 ?? null,
        requestId,
        message: "This prepared-dataset status request is stale for the current local session.",
        failureCode: "LOCAL_PREPARED_HD_DATASET_STALE_REQUEST",
      }));
    }
    return cloneDto(this.#state);
  }

  start(input: unknown): Promise<LocalPreparedHdDatasetDtoV0> {
    const request = parseLocalPreparedHdDatasetStartRequestV0(input);
    if (this.#closed) {
      return Promise.resolve(cloneDto(this.#closedDto(request.requestId)));
    }
    if (this.#receipt === null || this.#trustedContext === null || this.#state.state === "unavailable") {
      return Promise.resolve(cloneDto(this.#state));
    }
    if (request.receiptSha256 !== this.#receipt.receiptSha256) {
      return Promise.resolve(cloneDto(dto({
        state: "failed",
        receiptSha256: this.#receipt.receiptSha256,
        requestId: request.requestId,
        message: "The intake receipt changed. Refresh before validating the prepared package.",
        failureCode: "LOCAL_PREPARED_HD_DATASET_STALE_RECEIPT",
      })));
    }
    if (this.#boundRequestId !== null) {
      if (request.requestId === this.#boundRequestId) {
        return this.#active?.completion ?? Promise.resolve(cloneDto(this.#state));
      }
      return Promise.resolve(cloneDto(dto({
        state: "failed",
        receiptSha256: this.#receipt.receiptSha256,
        requestId: request.requestId,
        message: this.#active === null
          ? "This local session is bound to a different prepared-dataset request."
          : "Another prepared-dataset validation request is already running.",
        failureCode: this.#active === null
          ? "LOCAL_PREPARED_HD_DATASET_STALE_REQUEST"
          : "LOCAL_PREPARED_HD_DATASET_BUSY",
      })));
    }

    this.#boundRequestId = request.requestId;
    this.#completedReport = null;
    let resolveSettled = (): void => undefined;
    const settled = new Promise<void>((resolvePromise) => {
      resolveSettled = resolvePromise;
    });
    const active: ActiveRun = {
      requestId: request.requestId,
      receiptSha256: request.receiptSha256,
      abortController: new AbortController(),
      settled,
      resolveSettled,
      completion: Promise.resolve(this.#state),
      abortCode: null,
      deadline: null,
      acceptResult: true,
    };
    active.deadline = setTimeout(() => {
      this.#abort(active, "LOCAL_PREPARED_HD_DATASET_TIMED_OUT");
    }, this.#operationTimeoutMs);
    active.deadline.unref();
    this.#active = active;
    this.#state = dto({
      state: "running",
      receiptSha256: request.receiptSha256,
      requestId: request.requestId,
      message: "Re-inspecting the prepared package and fixed validator inputs.",
    });
    active.completion = this.#run(active, this.#trustedContext, structuredClone(this.#receipt));
    return active.completion;
  }

  async cancel(requestId: string): Promise<LocalPreparedHdDatasetDtoV0 | null> {
    if (!REQUEST_ID.test(requestId) || requestId !== this.#boundRequestId) return null;
    const active = this.#active;
    if (active === null || active.requestId !== requestId) return cloneDto(this.#state);
    this.#abort(active, "LOCAL_PREPARED_HD_DATASET_CANCELLED");
    if (!(await waitForSettlement(active, this.#settlementTimeoutMs))) {
      active.acceptResult = false;
      this.#completedReport = null;
      this.#state = dto({
        state: "failed",
        receiptSha256: active.receiptSha256,
        requestId,
        message: "The validator process could not be confirmed stopped. No readiness receipt was accepted.",
        failureCode: "LOCAL_PREPARED_HD_DATASET_RUNNER_SETTLEMENT_UNCONFIRMED",
      });
    }
    return cloneDto(this.#state);
  }

  readCompletedReport(
    requestId: string,
  ): FoundryPreparedHdDatasetReadinessReceiptV0 | null {
    if (
      requestId !== this.#boundRequestId ||
      this.#state.state !== "completed" ||
      this.#completedReport === null ||
      this.#closed
    ) {
      return null;
    }
    return structuredClone(
      verifyFoundryPreparedHdDatasetReadinessReceiptV0(this.#completedReport),
    );
  }

  async close(): Promise<void> {
    if (this.#closed && this.#active === null) return;
    this.#closed = true;
    const active = this.#active;
    if (active !== null) {
      this.#abort(active, "LOCAL_PREPARED_HD_DATASET_CONTROLLER_CLOSED");
      if (!(await waitForSettlement(active, this.#settlementTimeoutMs))) {
        active.acceptResult = false;
        this.#completedReport = null;
        this.#state = this.#closedDto(active.requestId);
        fail(
          "LOCAL_PREPARED_HD_DATASET_RUNNER_SETTLEMENT_UNCONFIRMED",
          "The prepared-dataset validator could not be confirmed stopped.",
        );
      }
    }
    this.#completedReport = null;
    this.#state = this.#closedDto(this.#boundRequestId);
  }

  async #run(
    active: ActiveRun,
    context: LocalPreparedHdDatasetTrustedContextV0,
    receipt: FoundryUniversalIntakeReceipt,
  ): Promise<LocalPreparedHdDatasetDtoV0> {
    try {
      const report = await executePreparedHdDatasetGate(
        context,
        receipt,
        this.#inspector,
        this.#processRunner,
        this.#operationTimeoutMs,
        active.abortController.signal,
      );
      if (active.abortCode !== null || active.abortController.signal.aborted) {
        fail(
          active.abortCode ?? "LOCAL_PREPARED_HD_DATASET_CANCELLED",
          "The prepared-dataset validation did not remain active through completion.",
        );
      }
      if (active.acceptResult && !this.#closed) {
        this.#completedReport = structuredClone(report);
        this.#state = dto({
          state: "completed",
          receiptSha256: active.receiptSha256,
          requestId: active.requestId,
          message: "The prepared package passed the strict read-only Config-B dataset gate.",
          report: reportSummary(report),
        });
      }
    } catch (error: unknown) {
      const code = active.abortCode ?? errorCode(error);
      if (active.acceptResult && !this.#closed) {
        this.#completedReport = null;
        this.#state = dto({
          state: "failed",
          receiptSha256: active.receiptSha256,
          requestId: active.requestId,
          message: failureMessage(code),
          failureCode: code,
        });
      } else if (active.acceptResult && this.#closed) {
        this.#completedReport = null;
        this.#state = this.#closedDto(active.requestId);
      }
    } finally {
      if (active.deadline !== null) clearTimeout(active.deadline);
      active.deadline = null;
      if (this.#active === active) this.#active = null;
      active.resolveSettled();
    }
    return cloneDto(this.#state);
  }

  #abort(active: ActiveRun, code: string): void {
    if (active.abortCode !== null) return;
    active.abortCode = code;
    active.abortController.abort();
  }

  #closedDto(requestId: string | null): LocalPreparedHdDatasetDtoV0 {
    return dto({
      state: "unavailable",
      receiptSha256: this.#receipt?.receiptSha256 ?? null,
      requestId,
      message: "The prepared-dataset validation controller is closed.",
      failureCode: "LOCAL_PREPARED_HD_DATASET_CONTROLLER_CLOSED",
    });
  }
}

export function createLocalPreparedHdDatasetControllerV0(
  options: CreateLocalPreparedHdDatasetControllerV0Options,
): LocalPreparedHdDatasetControllerV0 {
  return new LocalPreparedHdDatasetControllerV0(options);
}

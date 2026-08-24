import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";
import {
  FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS,
  FOUNDRY_E57_GEOMETRY_MAXIMUM_INPUT_POINTS,
  FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS,
  FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
  FoundryE57GeometryScanDescriptionV0Schema,
  sealFoundryE57GeometryReaderDescriptionV0,
  type FoundryE57GeometryInvocationV0,
  type FoundryE57GeometryReader,
  type FoundryE57GeometryReaderDescriptionV0,
} from "./e57-geometry-worker.js";
import { FoundryIntegrityError } from "./errors.js";
import { sha256RegularFile } from "./hash.js";
import {
  FOUNDRY_E57_SCAN_REDUCTION_BATCH_POINTS,
  FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_INPUT_POINTS,
  FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_POINTS_PER_SCAN,
  FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_SCANS,
  FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_TOTAL_POINTS,
  FOUNDRY_E57_SCAN_SHARDED_READER_DESCRIPTION_V0,
  FoundryE57RawReducedScanV0Schema,
  FoundryE57ScanReductionCropV0Schema,
  FoundryE57ScanReductionVoxelPolicyV0Schema,
  computeFoundryE57ScanShardedReductionInvocationSha256,
  sealFoundryE57ScanShardedReaderDescriptionV0,
  type FoundryE57ScanReductionReader,
  type FoundryE57ScanShardedReductionInvocationV0,
  type FoundryE57ScanShardedReaderDescriptionV0,
} from "./e57-scan-sharded-reduction.js";

export const FOUNDRY_E57_PYE57_SEQUENTIAL_STREAM_PROTOCOL_V0 =
  "omnitwin.foundry.e57-sequential-stream.v0";
export const FOUNDRY_E57_PYE57_SEQUENTIAL_DEFAULT_DEADLINE_MS = 60_000;
export const FOUNDRY_E57_PYE57_SEQUENTIAL_MINIMUM_DEADLINE_MS = 100;
export const FOUNDRY_E57_PYE57_SCAN_REDUCTION_STREAM_PROTOCOL_V0 =
  "omnitwin.foundry.e57-scan-sharded-reduction-stream.v0";
export const FOUNDRY_E57_PYE57_SCAN_REDUCTION_DEFAULT_DEADLINE_MS =
  24 * 60 * 60 * 1_000;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REQUEST_NONCE = /^[a-f0-9]{64}$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,159}$/u;
const MAXIMUM_BRIDGE_SCRIPT_BYTES = 1024 * 1024;
const MAXIMUM_PYTHON_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const MAXIMUM_STDERR_BYTES = 1024 * 1024;
const MAXIMUM_DESCRIPTION_LINE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_BATCH_LINE_BYTES = 24 * 1024 * 1024;
const MAXIMUM_PROTOCOL_LINE_BYTES = 32 * 1024 * 1024;
const MAXIMUM_AGGREGATE_STDOUT_BASE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_AGGREGATE_STDOUT_BYTES_PER_POINT = 192;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const ExactFileIdentitySchema = z
  .object({
    sizeBytes: z.number().int().safe().positive(),
    sha256: z.string().regex(SHA256),
  })
  .strict();

const StreamReadPolicySchema = z
  .object({
    pointPayload: z.literal("cartesian_fields_only"),
    imageDecoderAccess: z.literal(false),
    imageExtraction: z.literal(false),
    network: z.literal("none"),
    modelInference: z.literal("none"),
    modelTraining: z.literal("none"),
  })
  .strict();

const StreamDescriptionSchema = z
  .object({
    protocolVersion: z.literal(
      FOUNDRY_E57_PYE57_SEQUENTIAL_STREAM_PROTOCOL_V0,
    ),
    messageType: z.literal("description"),
    sequence: z.literal(0),
    sourceBefore: ExactFileIdentitySchema,
    bridge: ExactFileIdentitySchema,
    interpreter: ExactFileIdentitySchema,
    adapterVersion: z.string().regex(SAFE_VERSION),
    numpyVersion: z.string().min(1).max(160),
    pythonVersion: z.string().min(1).max(160),
    batchPoints: z.literal(FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS),
    scans: z
      .array(FoundryE57GeometryScanDescriptionV0Schema)
      .min(1)
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS),
    totalPointCount: z
      .number()
      .int()
      .safe()
      .positive()
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_INPUT_POINTS),
    readPolicy: StreamReadPolicySchema,
  })
  .strict();

const StreamPointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
    cartesianInvalidState: z.number().int().min(0).max(2),
  })
  .strict();

const StreamTerminalSchema = z
  .object({
    sourceAfter: ExactFileIdentitySchema,
    totalPointCount: z.number().int().safe().positive(),
    emittedPointCount: z.number().int().safe().positive(),
    batchCount: z.number().int().safe().positive(),
  })
  .strict();

const StreamBatchSchema = z
  .object({
    protocolVersion: z.literal(
      FOUNDRY_E57_PYE57_SEQUENTIAL_STREAM_PROTOCOL_V0,
    ),
    messageType: z.literal("batch"),
    sequence: z.number().int().safe().positive(),
    requestNonce: z.string().regex(REQUEST_NONCE),
    sourceSha256: z.string().regex(SHA256),
    scanIndex: z.number().int().nonnegative(),
    data3dGuid: z.string().min(1).max(512),
    startPointIndex: z.number().int().safe().nonnegative(),
    points: z
      .array(StreamPointSchema)
      .min(1)
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS),
    terminal: StreamTerminalSchema.nullable(),
  })
  .strict();

const ReductionStreamReadPolicySchema = z
  .object({
    rawPointTransport: z.literal("kept_inside_pinned_python_bridge"),
    emittedPayload: z.literal("bounded_reduced_representatives_only"),
    imageDecoderAccess: z.literal(false),
    imageExtraction: z.literal(false),
    network: z.literal("none"),
    modelInference: z.literal("none"),
    modelTraining: z.literal("none"),
  })
  .strict();

const ReductionStreamDescriptionSchema = z
  .object({
    protocolVersion: z.literal(
      FOUNDRY_E57_PYE57_SCAN_REDUCTION_STREAM_PROTOCOL_V0,
    ),
    messageType: z.literal("description"),
    sequence: z.literal(0),
    requestedStartScanIndex: z.number().int().nonnegative(),
    completedRepresentativeCount: z.number().int().safe().nonnegative(),
    sourceBefore: ExactFileIdentitySchema,
    bridge: ExactFileIdentitySchema,
    interpreter: ExactFileIdentitySchema,
    adapterVersion: z.string().regex(SAFE_VERSION),
    numpyVersion: z.string().min(1).max(160),
    pythonVersion: z.string().min(1).max(160),
    internalBatchPoints: z.literal(
      FOUNDRY_E57_SCAN_REDUCTION_BATCH_POINTS,
    ),
    scans: z
      .array(FoundryE57GeometryScanDescriptionV0Schema)
      .min(1)
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_SCANS),
    totalPointCount: z
      .number()
      .int()
      .safe()
      .positive()
      .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_INPUT_POINTS),
    crop: FoundryE57ScanReductionCropV0Schema,
    voxelPolicy: FoundryE57ScanReductionVoxelPolicyV0Schema,
    limits: z
      .object({
        maximumInputPoints: z
          .number()
          .int()
          .safe()
          .positive()
          .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_INPUT_POINTS),
        maximumScans: z
          .number()
          .int()
          .positive()
          .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_SCANS),
        internalBatchPoints: z.literal(
          FOUNDRY_E57_SCAN_REDUCTION_BATCH_POINTS,
        ),
        maximumRepresentativesPerScan: z
          .number()
          .int()
          .positive()
          .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_POINTS_PER_SCAN),
        maximumTotalRepresentatives: z
          .number()
          .int()
          .positive()
          .max(FOUNDRY_E57_SCAN_REDUCTION_MAXIMUM_TOTAL_POINTS),
      })
      .strict(),
    readPolicy: ReductionStreamReadPolicySchema,
  })
  .strict();

const ReductionStreamScanSchema = z
  .object({
    protocolVersion: z.literal(
      FOUNDRY_E57_PYE57_SCAN_REDUCTION_STREAM_PROTOCOL_V0,
    ),
    messageType: z.literal("scan"),
    sequence: z.number().int().safe().positive(),
    requestNonce: z.string().regex(REQUEST_NONCE),
    sourceSha256: z.string().regex(SHA256),
    scanIndex: z.number().int().nonnegative(),
    data3dGuid: z.string().min(1).max(512),
    counts: FoundryE57RawReducedScanV0Schema.shape.counts,
    points: FoundryE57RawReducedScanV0Schema.shape.points,
    aggregateRepresentativeCount: z.number().int().safe().nonnegative(),
    terminalSourceAfter:
      FoundryE57RawReducedScanV0Schema.shape.terminalSourceAfter,
  })
  .strict();

export interface FoundryLocalPye57SequentialGeometryReaderOptions {
  readonly sourcePath: string;
  readonly bridgeScriptPath: string;
  readonly expectedBridgeArtifactSha256: string;
  readonly pythonExecutable: string;
  readonly expectedPythonExecutableSha256: string;
  readonly commandDeadlineMs?: number;
  readonly onProcessStarted?: (processId: number) => void;
}

export interface FoundryLocalPye57ScanShardedReducerOptions {
  readonly sourcePath: string;
  readonly bridgeScriptPath: string;
  readonly expectedBridgeArtifactSha256: string;
  readonly pythonExecutable: string;
  readonly expectedPythonExecutableSha256: string;
  readonly sessionDeadlineMs?: number;
  readonly onProcessStarted?: (processId: number) => void;
}

interface ExactFileIdentity {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

interface ChildCloseResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface LineWaiter {
  readonly resolve: (line: Buffer) => void;
  readonly reject: (error: Error) => void;
}

interface ActiveReaderRun {
  readonly session: SequentialPye57Session;
  readonly description: FoundryE57GeometryReaderDescriptionV0;
  readonly signal: AbortSignal | undefined;
}

interface OpeningReaderRun {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly resolveDone: () => void;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, { cause });
}

function integrityError(
  code: string,
  message: string,
  cause?: unknown,
): FoundryIntegrityError {
  return new FoundryIntegrityError(code, message, { cause });
}

function parseBridgeFailure(stderr: string): FoundryIntegrityError | null {
  const lastLine = stderr.trim().split(/\r?\n/u).filter(Boolean).at(-1);
  if (lastLine === undefined) return null;
  try {
    const value = JSON.parse(lastLine) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      "message" in value &&
      typeof value.code === "string" &&
      typeof value.message === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value.code) &&
      value.message.length <= 4_096
    ) {
      return integrityError(value.code, value.message);
    }
  } catch {
    return null;
  }
  return null;
}

function validatedDeadline(options: {
  readonly commandDeadlineMs?: number;
}): number {
  const deadline =
    options.commandDeadlineMs ??
    FOUNDRY_E57_PYE57_SEQUENTIAL_DEFAULT_DEADLINE_MS;
  if (
    !Number.isSafeInteger(deadline) ||
    deadline < FOUNDRY_E57_PYE57_SEQUENTIAL_MINIMUM_DEADLINE_MS ||
    deadline > FOUNDRY_E57_PYE57_SEQUENTIAL_DEFAULT_DEADLINE_MS
  ) {
    fail(
      "E57_PYE57_STREAM_DEADLINE_INVALID",
      `The persistent E57 reader deadline must be an integer from ${String(FOUNDRY_E57_PYE57_SEQUENTIAL_MINIMUM_DEADLINE_MS)} through ${String(FOUNDRY_E57_PYE57_SEQUENTIAL_DEFAULT_DEADLINE_MS)} milliseconds.`,
    );
  }
  return deadline;
}

function assertLaunchNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    fail(
      "E57_GEOMETRY_CANCELLED",
      "The persistent E57 reader was cancelled before process launch.",
    );
  }
}

function isUncPath(path: string): boolean {
  return path.startsWith("\\\\") || path.startsWith("//");
}

async function resolveExactRegularFile(input: {
  readonly path: string;
  readonly expectedSha256: string;
  readonly maximumBytes: number;
  readonly invalidCode: string;
  readonly mismatchCode: string;
  readonly label: string;
}): Promise<ExactFileIdentity> {
  if (!isAbsolute(input.path) || !SHA256.test(input.expectedSha256)) {
    fail(
      input.invalidCode,
      `The ${input.label} requires an absolute path and one lowercase SHA-256 identity.`,
    );
  }
  const requested = resolve(input.path);
  let requestedMetadata: Awaited<ReturnType<typeof lstat>>;
  try {
    requestedMetadata = await lstat(requested);
  } catch (error: unknown) {
    fail(
      input.invalidCode,
      `The ${input.label} is unavailable or is not a bounded regular file.`,
      error,
    );
  }
  if (requestedMetadata.isSymbolicLink()) {
    fail(input.invalidCode, `The ${input.label} cannot be a symbolic link.`);
  }
  const path = await realpath(requested);
  const metadata = await lstat(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > input.maximumBytes
  ) {
    fail(input.invalidCode, `The ${input.label} is not a bounded regular file.`);
  }
  const digest = await sha256RegularFile(path);
  const sha256 = `sha256:${digest.sha256}`;
  if (sha256 !== input.expectedSha256) {
    fail(
      input.mismatchCode,
      `The ${input.label} does not match its exact caller-pinned SHA-256 identity.`,
    );
  }
  return { path, sizeBytes: digest.sizeBytes, sha256 };
}

function sanitizedPythonEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONHASHSEED: "0",
    PYTHONSAFEPATH: "1",
  };
  for (const name of [
    "APPDATA",
    "HOME",
    "LOCALAPPDATA",
    "SYSTEMROOT",
    "USERPROFILE",
    "WINDIR",
  ] as const) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

class BoundedNdjsonChild {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly maximumAggregateStdoutBytes: number;
  private readonly deadlineTimer: NodeJS.Timeout;
  private readonly signal: AbortSignal | undefined;
  private readonly closePromise: Promise<ChildCloseResult>;
  private readonly resolveClose: (result: ChildCloseResult) => void;
  private readonly stderrChunks: Buffer[] = [];
  private readonly stdoutLineChunks: Buffer[] = [];
  private queuedLine: Buffer | null = null;
  private lineWaiter: LineWaiter | null = null;
  private stderrBytes = 0;
  private stdoutLineBytes = 0;
  private aggregateStdoutBytes = 0;
  private responseCredits = 1;
  private closeResult: ChildCloseResult | null = null;
  private terminationError: Error | null = null;

  constructor(input: {
    readonly child: ChildProcessWithoutNullStreams;
    readonly deadlineMs: number;
    readonly maximumAggregateStdoutBytes: number;
    readonly signal?: AbortSignal;
  }) {
    this.child = input.child;
    this.maximumAggregateStdoutBytes = input.maximumAggregateStdoutBytes;
    this.signal = input.signal;
    let closeResolver: ((result: ChildCloseResult) => void) | undefined;
    this.closePromise = new Promise<ChildCloseResult>((resolvePromise) => {
      closeResolver = resolvePromise;
    });
    if (closeResolver === undefined) {
      fail(
        "E57_PYE57_STREAM_INTERNAL_STATE_INVALID",
        "The persistent E57 reader could not initialize its child-close observer.",
      );
    }
    this.resolveClose = closeResolver;
    this.deadlineTimer = setTimeout(() => {
      this.requestTermination(
        integrityError(
          "E57_PYE57_STREAM_DEADLINE_EXCEEDED",
          `The persistent E57 reader exceeded its ${String(input.deadlineMs)} millisecond session deadline.`,
        ),
      );
    }, input.deadlineMs);
    this.deadlineTimer.unref();
    this.attachProcessListeners();
    this.signal?.addEventListener("abort", this.abort, { once: true });
    if (this.signal?.aborted === true) this.abort();
  }

  get processId(): number | undefined {
    return this.child.pid;
  }

  private readonly abort = (): void => {
    this.requestTermination(
      integrityError(
        "E57_GEOMETRY_CANCELLED",
        "The persistent E57 reader was cancelled.",
      ),
    );
  };

  private attachProcessListeners(): void {
    this.child.on("error", (error: NodeJS.ErrnoException) => {
      this.requestTermination(
        integrityError(
          error.code === "ENOENT"
            ? "E57_PYE57_DEPENDENCY_UNAVAILABLE"
            : "E57_PYE57_STREAM_START_FAILED",
          error.code === "ENOENT"
            ? "The caller-pinned Python interpreter became unavailable before launch."
            : "The persistent E57 reader process could not start.",
          error,
        ),
      );
    });
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.acceptStdoutChunk(chunk);
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.acceptStderrChunk(chunk);
    });
    this.child.once("close", (code, signal) => {
      this.handleClose({ code, signal });
    });
  }

  private acceptStderrChunk(chunk: Buffer): void {
    if (this.closeResult !== null || this.terminationError !== null) return;
    this.stderrBytes += chunk.length;
    if (this.stderrBytes > MAXIMUM_STDERR_BYTES) {
      this.requestTermination(
        integrityError(
          "E57_PYE57_STREAM_ERROR_LIMIT_EXCEEDED",
          "The persistent E57 reader exceeded its bounded stderr contract.",
        ),
      );
      return;
    }
    this.stderrChunks.push(Buffer.from(chunk));
  }

  private acceptStdoutChunk(chunk: Buffer): void {
    if (this.closeResult !== null || this.terminationError !== null) return;
    if (this.responseCredits !== 1) {
      this.requestTermination(
        integrityError(
          "E57_PYE57_STREAM_UNSOLICITED_BYTES",
          "The command-gated persistent E57 reader emitted stdout bytes without an initial-description or next-command response credit.",
        ),
      );
      return;
    }
    this.aggregateStdoutBytes += chunk.length;
    if (this.aggregateStdoutBytes > this.maximumAggregateStdoutBytes) {
      this.requestTermination(
        integrityError(
          "E57_PYE57_STREAM_OUTPUT_LIMIT_EXCEEDED",
          "The persistent E57 reader exceeded its bounded aggregate stdout contract.",
        ),
      );
      return;
    }
    const newlineIndex = chunk.indexOf(0x0a);
    if (newlineIndex < 0) {
      this.stdoutLineBytes += chunk.length;
      if (this.stdoutLineBytes > MAXIMUM_PROTOCOL_LINE_BYTES) {
        this.requestTermination(
          integrityError(
            "E57_PYE57_STREAM_LINE_LIMIT_EXCEEDED",
            "The persistent E57 reader exceeded its bounded NDJSON line contract.",
          ),
        );
        return;
      }
      this.stdoutLineChunks.push(Buffer.from(chunk));
      return;
    }
    this.stdoutLineBytes += newlineIndex;
    if (this.stdoutLineBytes > MAXIMUM_PROTOCOL_LINE_BYTES) {
      this.requestTermination(
        integrityError(
          "E57_PYE57_STREAM_LINE_LIMIT_EXCEEDED",
          "The persistent E57 reader exceeded its bounded NDJSON line contract.",
        ),
      );
      return;
    }
    if (newlineIndex > 0) {
      this.stdoutLineChunks.push(Buffer.from(chunk.subarray(0, newlineIndex)));
    }
    const line = Buffer.concat(this.stdoutLineChunks, this.stdoutLineBytes);
    const extra = chunk.subarray(newlineIndex + 1);
    this.stdoutLineChunks.length = 0;
    this.stdoutLineBytes = 0;
    if (
      extra.length > 0 ||
      this.queuedLine !== null
    ) {
      this.requestTermination(
        integrityError(
          "E57_PYE57_STREAM_UNSOLICITED_RECORD",
          "The command-gated persistent E57 reader emitted a record without exactly one initial-description or next-command response credit.",
        ),
      );
      return;
    }
    this.responseCredits = 0;
    if (this.lineWaiter === null) {
      this.queuedLine = Buffer.from(line);
      return;
    }
    const waiter = this.lineWaiter;
    this.lineWaiter = null;
    waiter.resolve(Buffer.from(line));
  }

  private handleClose(result: ChildCloseResult): void {
    if (this.closeResult !== null) return;
    this.closeResult = result;
    clearTimeout(this.deadlineTimer);
    this.signal?.removeEventListener("abort", this.abort);
    this.resolveClose(result);
    if (this.lineWaiter !== null) {
      const waiter = this.lineWaiter;
      this.lineWaiter = null;
      waiter.reject(this.closureError());
    }
  }

  private closureError(): Error {
    if (this.terminationError !== null) return this.terminationError;
    const stderr = Buffer.concat(this.stderrChunks).toString("utf8");
    const bridgeFailure = parseBridgeFailure(stderr);
    if (bridgeFailure !== null) return bridgeFailure;
    return integrityError(
      "E57_PYE57_STREAM_CHILD_EXITED",
      `The persistent E57 reader exited before its next protocol record (exit ${String(this.closeResult?.code ?? null)}, signal ${String(this.closeResult?.signal ?? null)}).`,
    );
  }

  private requestTermination(error: Error): void {
    if (this.closeResult !== null || this.terminationError !== null) return;
    this.terminationError = error;
    this.queuedLine = null;
    this.stdoutLineChunks.length = 0;
    this.stdoutLineBytes = 0;
    this.responseCredits = 0;
    try {
      this.child.kill("SIGKILL");
    } catch {
      // The close/error event is the sole settlement boundary.
    }
  }

  private async waitForLine(): Promise<Buffer> {
    if (this.queuedLine !== null) {
      const line = this.queuedLine;
      this.queuedLine = null;
      return line;
    }
    if (this.closeResult !== null) throw this.closureError();
    if (this.terminationError !== null) {
      await this.closePromise;
      throw this.terminationError;
    }
    if (this.lineWaiter !== null) {
      await this.terminateAndThrow(
        integrityError(
          "E57_PYE57_STREAM_CONCURRENT_READ",
          "The persistent E57 reader refuses concurrent protocol reads.",
        ),
      );
    }
    return await new Promise<Buffer>((resolvePromise, rejectPromise) => {
      this.lineWaiter = {
        resolve: resolvePromise,
        reject: rejectPromise,
      };
    });
  }

  async readJsonLine(maximumLineBytes: number): Promise<unknown> {
    const line = await this.waitForLine();
    if (line.length === 0 || line.length > maximumLineBytes) {
      await this.terminateAndThrow(
        integrityError(
          "E57_PYE57_STREAM_LINE_LIMIT_EXCEEDED",
          "The persistent E57 reader returned an empty or over-limit NDJSON record.",
        ),
      );
    }
    let text = "";
    try {
      text = UTF8_DECODER.decode(line);
    } catch (error: unknown) {
      await this.terminateAndThrow(
        integrityError(
          "E57_PYE57_STREAM_UTF8_INVALID",
          "The persistent E57 reader returned invalid UTF-8.",
          error,
        ),
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error: unknown) {
      await this.terminateAndThrow(
        integrityError(
          "E57_PYE57_STREAM_JSON_INVALID",
          "The persistent E57 reader returned an invalid NDJSON record.",
          error,
        ),
      );
    }
  }

  async sendNext(
    sequence: number,
    protocolVersion = FOUNDRY_E57_PYE57_SEQUENTIAL_STREAM_PROTOCOL_V0,
  ): Promise<string> {
    if (this.signal?.aborted === true || this.terminationError !== null) {
      if (this.closeResult === null) await this.closePromise;
      throw this.closureError();
    }
    if (this.closeResult !== null) throw this.closureError();
    if (
      this.responseCredits !== 0 ||
      this.queuedLine !== null ||
      this.lineWaiter !== null ||
      this.stdoutLineBytes !== 0 ||
      this.stdoutLineChunks.length !== 0
    ) {
      await this.terminateAndThrow(
        integrityError(
          "E57_PYE57_STREAM_COMMAND_STATE_INVALID",
          "The persistent E57 reader refuses a next command while another response is credited, queued, or awaited.",
        ),
      );
    }
    this.responseCredits = 1;
    const requestNonce = randomBytes(32).toString("hex");
    const command = `${JSON.stringify({
      command: "next",
      protocolVersion,
      requestNonce,
      sequence,
    })}\n`;
    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.child.stdin.write(command, "utf8", (error) => {
        if (error === null || error === undefined) {
          resolvePromise();
        } else {
          rejectPromise(error);
        }
      });
    }).catch(async (error: unknown) => {
      await this.terminateAndThrow(
        integrityError(
          "E57_PYE57_STREAM_COMMAND_WRITE_FAILED",
          "The persistent E57 reader could not accept its next bounded-batch command.",
          error,
        ),
      );
    });
    return requestNonce;
  }

  async assertSuccessfulExit(): Promise<void> {
    const result = await this.closePromise;
    if (
      this.terminationError !== null ||
      result.code !== 0 ||
      result.signal !== null ||
      this.stdoutLineBytes !== 0 ||
      this.stdoutLineChunks.length !== 0 ||
      this.queuedLine !== null ||
      this.responseCredits !== 0
    ) {
      throw this.closureError();
    }
  }

  async terminateAndThrow(error: Error): Promise<never> {
    this.requestTermination(error);
    await this.closePromise;
    throw error;
  }

  async close(): Promise<void> {
    if (this.closeResult === null) {
      this.requestTermination(
        integrityError(
          "E57_PYE57_STREAM_SESSION_CLOSED",
          "The persistent E57 reader session was closed before terminal completion.",
        ),
      );
    }
    const result = await this.closePromise;
    if (this.terminationError === null && result.code !== 0) {
      throw this.closureError();
    }
  }
}

type StreamDescription = z.infer<typeof StreamDescriptionSchema>;
type StreamBatch = z.infer<typeof StreamBatchSchema>;

function sameFileIdentity(
  left: { readonly sizeBytes: number; readonly sha256: string },
  right: { readonly sizeBytes: number; readonly sha256: string },
): boolean {
  return left.sizeBytes === right.sizeBytes && left.sha256 === right.sha256;
}

function assertDescriptionInventory(
  description: StreamDescription,
  source: FoundryE57GeometryInvocationV0["source"],
  bridge: ExactFileIdentity,
  interpreter: ExactFileIdentity,
  maximumInputPoints: number,
  maximumScans: number,
): void {
  const declaredTotal = description.scans.reduce(
    (total, scan) => total + scan.pointCount,
    0,
  );
  const contiguous = description.scans.every(
    (scan, index) => scan.scanIndex === index,
  );
  const uniqueGuids =
    new Set(description.scans.map((scan) => scan.data3dGuid)).size ===
    description.scans.length;
  if (
    description.adapterVersion !== "0.4.19" ||
    !sameFileIdentity(description.sourceBefore, source) ||
    !sameFileIdentity(description.bridge, bridge) ||
    !sameFileIdentity(description.interpreter, interpreter) ||
    description.totalPointCount !== declaredTotal ||
    description.totalPointCount > maximumInputPoints ||
    description.scans.length > maximumScans ||
    !contiguous ||
    !uniqueGuids
  ) {
    fail(
      "E57_PYE57_STREAM_DESCRIPTION_MISMATCH",
      "The persistent E57 reader description does not bind the exact source, runtime identities, pye57 version, limits, contiguous scan inventory, and unique GUIDs.",
    );
  }
}

function parseDescription(value: unknown): StreamDescription {
  const parsed = StreamDescriptionSchema.safeParse(value);
  if (!parsed.success) {
    fail(
      "E57_PYE57_STREAM_DESCRIPTION_INVALID",
      "The persistent E57 reader returned an invalid strict description record.",
      parsed.error,
    );
  }
  return parsed.data;
}

function parseBatch(value: unknown): StreamBatch {
  const parsed = StreamBatchSchema.safeParse(value);
  if (!parsed.success) {
    fail(
      "E57_PYE57_STREAM_BATCH_INVALID",
      "The persistent E57 reader returned an invalid strict point-batch record.",
      parsed.error,
    );
  }
  return parsed.data;
}

function assertPreSchemaArrayLength(input: {
  readonly value: unknown;
  readonly property: string;
  readonly maximumLength: number;
  readonly code: string;
  readonly label: string;
}): void {
  if (typeof input.value !== "object" || input.value === null) {
    fail(input.code, `${input.label} is not one bounded protocol object.`);
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(
      input.value,
      input.property,
    );
  } catch (error: unknown) {
    fail(
      input.code,
      `${input.label}.${input.property} refused bounded pre-schema inspection.`,
      error,
    );
  }
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    !Array.isArray(descriptor.value)
  ) {
    fail(
      input.code,
      `${input.label}.${input.property} must be one own data array.`,
    );
  }
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Reflect.getOwnPropertyDescriptor(
      descriptor.value,
      "length",
    );
  } catch (error: unknown) {
    fail(
      input.code,
      `${input.label}.${input.property} refused bounded length inspection.`,
      error,
    );
  }
  const length: unknown = lengthDescriptor?.value;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > input.maximumLength
  ) {
    fail(
      input.code,
      `${input.label}.${input.property} exceeds its pre-schema invocation cap.`,
    );
  }
}

async function terminateForProtocolError(
  child: BoundedNdjsonChild,
  error: unknown,
  code: string,
  message: string,
): Promise<never> {
  const normalized =
    error instanceof FoundryIntegrityError
      ? error
      : integrityError(code, message, error);
  return await child.terminateAndThrow(normalized);
}

async function resolveRuntimeArtifacts(
  options:
    | FoundryLocalPye57SequentialGeometryReaderOptions
    | FoundryLocalPye57ScanShardedReducerOptions,
): Promise<{
  readonly bridge: ExactFileIdentity;
  readonly interpreter: ExactFileIdentity;
}> {
  const [bridge, interpreter] = await Promise.all([
    resolveExactRegularFile({
      path: options.bridgeScriptPath,
      expectedSha256: options.expectedBridgeArtifactSha256,
      maximumBytes: MAXIMUM_BRIDGE_SCRIPT_BYTES,
      invalidCode: "E57_PYE57_STREAM_BRIDGE_INVALID",
      mismatchCode: "E57_PYE57_STREAM_BRIDGE_IDENTITY_MISMATCH",
      label: "persistent E57 bridge",
    }),
    resolveExactRegularFile({
      path: options.pythonExecutable,
      expectedSha256: options.expectedPythonExecutableSha256,
      maximumBytes: MAXIMUM_PYTHON_EXECUTABLE_BYTES,
      invalidCode: "E57_PYE57_STREAM_PYTHON_INVALID",
      mismatchCode: "E57_PYE57_STREAM_PYTHON_IDENTITY_MISMATCH",
      label: "persistent E57 Python interpreter",
    }),
  ]);
  return { bridge, interpreter };
}

function streamArguments(input: {
  readonly source: FoundryE57GeometryInvocationV0["source"];
  readonly sourcePath: string;
  readonly maximumInputPoints: number;
  readonly maximumScans: number;
  readonly bridge: ExactFileIdentity;
  readonly interpreter: ExactFileIdentity;
}): string[] {
  return [
    "-E",
    "-P",
    "-B",
    input.bridge.path,
    "stream",
    "--source",
    input.sourcePath,
    "--expected-size",
    String(input.source.sizeBytes),
    "--expected-sha256",
    input.source.sha256,
    "--maximum-total-points",
    String(input.maximumInputPoints),
    "--maximum-scans",
    String(input.maximumScans),
    "--batch-points",
    String(FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS),
    "--expected-bridge-size",
    String(input.bridge.sizeBytes),
    "--expected-bridge-sha256",
    input.bridge.sha256,
    "--expected-python-size",
    String(input.interpreter.sizeBytes),
    "--expected-python-sha256",
    input.interpreter.sha256,
  ];
}

function spawnStreamChild(input: {
  readonly options: FoundryLocalPye57SequentialGeometryReaderOptions;
  readonly source: FoundryE57GeometryInvocationV0["source"];
  readonly maximumInputPoints: number;
  readonly maximumScans: number;
  readonly bridge: ExactFileIdentity;
  readonly interpreter: ExactFileIdentity;
  readonly deadlineMs: number;
  readonly signal?: AbortSignal;
}): BoundedNdjsonChild {
  const child = spawn(
    input.interpreter.path,
    streamArguments({
      source: input.source,
      sourcePath: input.options.sourcePath,
      maximumInputPoints: input.maximumInputPoints,
      maximumScans: input.maximumScans,
      bridge: input.bridge,
      interpreter: input.interpreter,
    }),
    {
      cwd: dirname(input.interpreter.path),
      env: sanitizedPythonEnvironment(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  return new BoundedNdjsonChild({
    child,
    deadlineMs: input.deadlineMs,
    maximumAggregateStdoutBytes:
      MAXIMUM_AGGREGATE_STDOUT_BASE_BYTES +
      input.maximumInputPoints * MAXIMUM_AGGREGATE_STDOUT_BYTES_PER_POINT,
    signal: input.signal,
  });
}

class SequentialPye57Session {
  private readonly child: BoundedNdjsonChild;
  private readonly source: FoundryE57GeometryInvocationV0["source"];
  private readonly streamDescription: StreamDescription;
  private nextScanIndex = 0;
  private nextPointIndex = 0;
  private nextSequence = 1;
  private completed = false;
  private reading = false;

  private constructor(input: {
    readonly child: BoundedNdjsonChild;
    readonly source: FoundryE57GeometryInvocationV0["source"];
    readonly streamDescription: StreamDescription;
  }) {
    this.child = input.child;
    this.source = input.source;
    this.streamDescription = input.streamDescription;
  }

  static async start(input: {
    readonly options: FoundryLocalPye57SequentialGeometryReaderOptions;
    readonly source: FoundryE57GeometryInvocationV0["source"];
    readonly maximumInputPoints: number;
    readonly maximumScans: number;
    readonly signal?: AbortSignal;
  }): Promise<SequentialPye57Session> {
    if (
      !isAbsolute(input.options.sourcePath) ||
      isUncPath(input.options.sourcePath)
    ) {
      fail(
        "E57_PYE57_SOURCE_UNSAFE",
        "The persistent E57 reader requires an absolute local caller-supplied source path and refuses UNC network roots.",
      );
    }
    assertLaunchNotCancelled(input.signal);
    const artifacts = await resolveRuntimeArtifacts(input.options);
    const deadlineMs = validatedDeadline(input.options);
    assertLaunchNotCancelled(input.signal);
    const child = spawnStreamChild({
      ...input,
      ...artifacts,
      deadlineMs,
    });
    try {
      const processId = child.processId;
      if (processId !== undefined) input.options.onProcessStarted?.(processId);
      const rawDescription = await child.readJsonLine(
        MAXIMUM_DESCRIPTION_LINE_BYTES,
      );
      const description = parseDescription(rawDescription);
      assertDescriptionInventory(
        description,
        input.source,
        artifacts.bridge,
        artifacts.interpreter,
        input.maximumInputPoints,
        input.maximumScans,
      );
      return new SequentialPye57Session({
        child,
        source: input.source,
        streamDescription: description,
      });
    } catch (error: unknown) {
      return await terminateForProtocolError(
        child,
        error,
        "E57_PYE57_STREAM_DESCRIPTION_INVALID",
        "The persistent E57 reader failed before its description was accepted.",
      );
    }
  }

  toReaderDescription(): FoundryE57GeometryReaderDescriptionV0 {
    return sealFoundryE57GeometryReaderDescriptionV0({
      schemaVersion: FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
      source: this.source,
      adapter: {
        name: "pye57_persistent_sequential",
        version: this.streamDescription.adapterVersion,
        bridgeArtifactSha256: this.streamDescription.bridge.sha256,
        pythonVersion: this.streamDescription.pythonVersion,
        numpyVersion: this.streamDescription.numpyVersion,
        pythonExecutableSha256: this.streamDescription.interpreter.sha256,
        pythonExecutableSizeBytes:
          this.streamDescription.interpreter.sizeBytes,
        identityAuthority: "caller_supplied_unverified",
      },
      readPolicy: {
        sourceAccess: "read_only_pre_and_post_size_sha256",
        batchAccess: "persistent_sequential_bounded_buffer",
        pointPayload: "cartesian_fields_only",
        fullContainerBytesHashed: true,
        imageDecoderAccess: false,
        imageExtraction: false,
        network: "none",
        modelInference: "none",
        modelTraining: "none",
      },
      coordinateContract: {
        pointFrame: "e57_data3d_local_cartesian",
        poseConvention: "normalized_quaternion_wxyz_then_translation_metres",
        rootFrame: "e57_root",
        units: "metre",
        axes: "right_handed_z_up",
      },
      scans: this.streamDescription.scans,
      totalPointCount: this.streamDescription.totalPointCount,
      authority: "none",
    });
  }

  private expectedBatchShape(): {
    readonly scan: StreamDescription["scans"][number];
    readonly maximumPoints: number;
    readonly terminal: boolean;
  } {
    const scan = this.streamDescription.scans[this.nextScanIndex];
    if (scan === undefined || this.nextPointIndex >= scan.pointCount) {
      fail(
        "E57_PYE57_STREAM_CURSOR_INVALID",
        "The persistent E57 reader cursor is outside its exact scan inventory.",
      );
    }
    const maximumPoints = Math.min(
      FOUNDRY_E57_GEOMETRY_MAXIMUM_BATCH_POINTS,
      scan.pointCount - this.nextPointIndex,
    );
    return {
      scan,
      maximumPoints,
      terminal:
        this.nextScanIndex === this.streamDescription.scans.length - 1 &&
        this.nextPointIndex + maximumPoints === scan.pointCount,
    };
  }

  private assertBatchBinding(
    batch: StreamBatch,
    expected: ReturnType<SequentialPye57Session["expectedBatchShape"]>,
    requestNonce: string,
  ): void {
    if (
      batch.sequence !== this.nextSequence ||
      batch.requestNonce !== requestNonce ||
      batch.sourceSha256 !== this.source.sha256 ||
      batch.scanIndex !== this.nextScanIndex ||
      batch.data3dGuid !== expected.scan.data3dGuid ||
      batch.startPointIndex !== this.nextPointIndex ||
      batch.points.length !== expected.maximumPoints
    ) {
      fail(
        "E57_PYE57_STREAM_BATCH_BINDING_MISMATCH",
        "The persistent E57 point batch does not bind the exact sequence, source, scan, GUID, cursor, and fixed batch size.",
      );
    }
  }

  private assertTerminalBinding(
    batch: StreamBatch,
    expectedTerminal: boolean,
  ): void {
    const terminal = batch.terminal;
    if (!expectedTerminal) {
      if (terminal !== null) {
        fail(
          "E57_PYE57_STREAM_TERMINAL_MISMATCH",
          "The persistent E57 reader declared completion before its exact final point.",
        );
      }
      return;
    }
    if (
      terminal === null ||
      !sameFileIdentity(terminal.sourceAfter, this.source) ||
      terminal.totalPointCount !== this.streamDescription.totalPointCount ||
      terminal.emittedPointCount !== this.streamDescription.totalPointCount ||
      terminal.batchCount !== this.nextSequence
    ) {
      fail(
        "E57_PYE57_STREAM_TERMINAL_MISMATCH",
        "The persistent E57 terminal record does not bind the exact post-read source identity, total point count, and batch count.",
      );
    }
  }

  private advance(expected: {
    readonly scan: StreamDescription["scans"][number];
    readonly maximumPoints: number;
    readonly terminal: boolean;
  }): void {
    this.nextPointIndex += expected.maximumPoints;
    this.nextSequence += 1;
    if (this.nextPointIndex === expected.scan.pointCount) {
      this.nextScanIndex += 1;
      this.nextPointIndex = 0;
    }
    if (expected.terminal) this.completed = true;
  }

  async readBatch(input: {
    readonly scanIndex: number;
    readonly startPointIndex: number;
    readonly maximumPoints: number;
  }): Promise<unknown> {
    if (this.completed || this.reading) {
      fail(
        this.completed
          ? "E57_PYE57_STREAM_ALREADY_COMPLETE"
          : "E57_PYE57_STREAM_CONCURRENT_READ",
        this.completed
          ? "The persistent E57 reader refuses a next command after terminal completion."
          : "The persistent E57 reader refuses concurrent next-batch commands.",
      );
    }
    const expected = this.expectedBatchShape();
    if (
      input.scanIndex !== this.nextScanIndex ||
      input.startPointIndex !== this.nextPointIndex ||
      input.maximumPoints !== expected.maximumPoints
    ) {
      fail(
        "E57_PYE57_STREAM_REQUEST_OUT_OF_ORDER",
        "The persistent E57 reader accepts only the exact next fixed-size scan-order batch.",
      );
    }
    this.reading = true;
    try {
      const requestNonce = await this.child.sendNext(this.nextSequence);
      const rawBatch = await this.child.readJsonLine(MAXIMUM_BATCH_LINE_BYTES);
      const batch = parseBatch(rawBatch);
      this.assertBatchBinding(batch, expected, requestNonce);
      this.assertTerminalBinding(batch, expected.terminal);
      this.advance(expected);
      if (expected.terminal) await this.child.assertSuccessfulExit();
      return {
        sourceSha256: batch.sourceSha256,
        scanIndex: batch.scanIndex,
        data3dGuid: batch.data3dGuid,
        startPointIndex: batch.startPointIndex,
        points: batch.points,
      };
    } catch (error: unknown) {
      return await terminateForProtocolError(
        this.child,
        error,
        "E57_PYE57_STREAM_BATCH_INVALID",
        "The persistent E57 reader failed while accepting its next point batch.",
      );
    } finally {
      this.reading = false;
    }
  }

  async close(): Promise<void> {
    await this.child.close();
  }
}

function sameSource(
  left: FoundryE57GeometryInvocationV0["source"],
  right: FoundryE57GeometryInvocationV0["source"],
): boolean {
  return (
    left.assetId === right.assetId &&
    left.relativePath === right.relativePath &&
    left.inputType === right.inputType &&
    left.sizeBytes === right.sizeBytes &&
    left.sha256 === right.sha256
  );
}

/**
 * Supplies the existing authority-none V0 geometry worker from one pye57
 * process per worker run. The process opens the E57 once and keeps one
 * low-level sequential point reader open per scan. A resumed V0 worker run
 * still starts a fresh process and replays the complete checkpoint prefix;
 * durable authenticated checkpoint custody is intentionally not claimed.
 */
export function createFoundryLocalPye57SequentialGeometryReader(
  options: FoundryLocalPye57SequentialGeometryReaderOptions,
): FoundryE57GeometryReader {
  let active: ActiveReaderRun | null = null;
  let opening: OpeningReaderRun | null = null;
  return {
    describe: async (input) => {
      if (active !== null || opening !== null) {
        fail(
          "E57_PYE57_STREAM_RUN_ALREADY_ACTIVE",
          "The persistent E57 reader already has one active worker run.",
        );
      }
      const controller = new AbortController();
      let resolveDone: (() => void) | undefined;
      const done = new Promise<void>((resolvePromise) => {
        resolveDone = resolvePromise;
      });
      if (resolveDone === undefined) {
        fail(
          "E57_PYE57_STREAM_INTERNAL_STATE_INVALID",
          "The persistent E57 reader could not initialize its opening-run observer.",
        );
      }
      const openingRun: OpeningReaderRun = {
        controller,
        done,
        resolveDone,
      };
      opening = openingRun;
      const signal =
        input.signal === undefined
          ? controller.signal
          : AbortSignal.any([input.signal, controller.signal]);
      let session: SequentialPye57Session | null = null;
      try {
        session = await SequentialPye57Session.start({
          options,
          source: input.source,
          maximumInputPoints: input.maximumInputPoints,
          maximumScans: input.maximumScans,
          signal,
        });
        const description = session.toReaderDescription();
        active = { session, description, signal: input.signal };
        session = null;
        return description;
      } finally {
        try {
          if (session !== null) await session.close();
        } finally {
          if (opening === openingRun) opening = null;
          openingRun.resolveDone();
        }
      }
    },
    readBatch: async (input) => {
      const run = active;
      if (
        run === null ||
        !sameSource(run.description.source, input.source) ||
        run.signal !== input.signal ||
        input.maximumInputPoints < run.description.totalPointCount ||
        input.maximumScans < run.description.scans.length
      ) {
        fail(
          "E57_PYE57_STREAM_RUN_BINDING_MISMATCH",
          "The persistent E57 reader batch does not belong to its exact active source, signal, and limits.",
        );
      }
      return await run.session.readBatch(input);
    },
    close: async () => {
      const openingRun = opening;
      openingRun?.controller.abort();
      if (openingRun !== null) await openingRun.done;
      const run = active;
      active = null;
      if (run !== null) await run.session.close();
    },
  };
}

type ReductionStreamDescription = z.infer<
  typeof ReductionStreamDescriptionSchema
>;
type ReductionStreamScan = z.infer<typeof ReductionStreamScanSchema>;

function validatedReductionDeadline(
  options: FoundryLocalPye57ScanShardedReducerOptions,
): number {
  const deadline =
    options.sessionDeadlineMs ??
    FOUNDRY_E57_PYE57_SCAN_REDUCTION_DEFAULT_DEADLINE_MS;
  if (
    !Number.isSafeInteger(deadline) ||
    deadline < FOUNDRY_E57_PYE57_SEQUENTIAL_MINIMUM_DEADLINE_MS ||
    deadline > FOUNDRY_E57_PYE57_SCAN_REDUCTION_DEFAULT_DEADLINE_MS
  ) {
    fail(
      "E57_PYE57_REDUCTION_DEADLINE_INVALID",
      `The scan-reduction session deadline must be an integer from ${String(FOUNDRY_E57_PYE57_SEQUENTIAL_MINIMUM_DEADLINE_MS)} through ${String(FOUNDRY_E57_PYE57_SCAN_REDUCTION_DEFAULT_DEADLINE_MS)} milliseconds.`,
    );
  }
  return deadline;
}

function reductionStreamArguments(input: {
  readonly invocation: FoundryE57ScanShardedReductionInvocationV0;
  readonly sourcePath: string;
  readonly startScanIndex: number;
  readonly completedRepresentativeCount: number;
  readonly bridge: ExactFileIdentity;
  readonly interpreter: ExactFileIdentity;
}): string[] {
  const { invocation } = input;
  return [
    "-E",
    "-P",
    "-B",
    input.bridge.path,
    "reduce-stream",
    "--source",
    input.sourcePath,
    "--expected-size",
    String(invocation.source.sizeBytes),
    "--expected-sha256",
    invocation.source.sha256,
    "--maximum-total-points",
    String(invocation.limits.maximumInputPoints),
    "--maximum-scans",
    String(invocation.limits.maximumScans),
    "--batch-points",
    String(invocation.limits.internalBatchPoints),
    "--start-scan-index",
    String(input.startScanIndex),
    "--completed-representative-count",
    String(input.completedRepresentativeCount),
    "--crop-min-x",
    String(invocation.crop.minimum[0]),
    "--crop-min-y",
    String(invocation.crop.minimum[1]),
    "--crop-min-z",
    String(invocation.crop.minimum[2]),
    "--crop-max-x",
    String(invocation.crop.maximum[0]),
    "--crop-max-y",
    String(invocation.crop.maximum[1]),
    "--crop-max-z",
    String(invocation.crop.maximum[2]),
    "--voxel-origin-x",
    String(invocation.voxelPolicy.originM[0]),
    "--voxel-origin-y",
    String(invocation.voxelPolicy.originM[1]),
    "--voxel-origin-z",
    String(invocation.voxelPolicy.originM[2]),
    "--voxel-size",
    String(invocation.voxelPolicy.voxelSizeM),
    "--maximum-representatives-per-scan",
    String(invocation.limits.maximumRepresentativesPerScan),
    "--maximum-total-representatives",
    String(invocation.limits.maximumTotalRepresentatives),
    "--expected-bridge-size",
    String(input.bridge.sizeBytes),
    "--expected-bridge-sha256",
    input.bridge.sha256,
    "--expected-python-size",
    String(input.interpreter.sizeBytes),
    "--expected-python-sha256",
    input.interpreter.sha256,
  ];
}

function spawnReductionStreamChild(input: {
  readonly options: FoundryLocalPye57ScanShardedReducerOptions;
  readonly invocation: FoundryE57ScanShardedReductionInvocationV0;
  readonly startScanIndex: number;
  readonly completedRepresentativeCount: number;
  readonly bridge: ExactFileIdentity;
  readonly interpreter: ExactFileIdentity;
  readonly deadlineMs: number;
  readonly signal?: AbortSignal;
}): BoundedNdjsonChild {
  const child = spawn(
    input.interpreter.path,
    reductionStreamArguments({
      invocation: input.invocation,
      sourcePath: input.options.sourcePath,
      startScanIndex: input.startScanIndex,
      completedRepresentativeCount: input.completedRepresentativeCount,
      bridge: input.bridge,
      interpreter: input.interpreter,
    }),
    {
      cwd: dirname(input.interpreter.path),
      env: sanitizedPythonEnvironment(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  return new BoundedNdjsonChild({
    child,
    deadlineMs: input.deadlineMs,
    maximumAggregateStdoutBytes:
      MAXIMUM_AGGREGATE_STDOUT_BASE_BYTES +
      input.invocation.limits.maximumTotalRepresentatives *
        MAXIMUM_AGGREGATE_STDOUT_BYTES_PER_POINT,
    signal: input.signal,
  });
}

function assertReductionDescriptionInventory(input: {
  readonly description: ReductionStreamDescription;
  readonly invocation: FoundryE57ScanShardedReductionInvocationV0;
  readonly startScanIndex: number;
  readonly completedRepresentativeCount: number;
  readonly bridge: ExactFileIdentity;
  readonly interpreter: ExactFileIdentity;
}): void {
  const { description, invocation } = input;
  let totalPointCount = 0;
  const guids = new Set<string>();
  const scansValid = description.scans.every((scan, index) => {
    totalPointCount += scan.pointCount;
    if (scan.scanIndex !== index || guids.has(scan.data3dGuid)) return false;
    guids.add(scan.data3dGuid);
    return true;
  });
  if (
    description.requestedStartScanIndex !== input.startScanIndex ||
    description.completedRepresentativeCount !==
      input.completedRepresentativeCount ||
    description.adapterVersion !== "0.4.19" ||
    !sameFileIdentity(description.sourceBefore, invocation.source) ||
    !sameFileIdentity(description.bridge, input.bridge) ||
    !sameFileIdentity(description.interpreter, input.interpreter) ||
    !sameCanonicalJson(description.crop, invocation.crop) ||
    !sameCanonicalJson(description.voxelPolicy, invocation.voxelPolicy) ||
    !sameCanonicalJson(description.limits, invocation.limits) ||
    !scansValid ||
    totalPointCount !== description.totalPointCount ||
    description.totalPointCount > invocation.limits.maximumInputPoints ||
    description.scans.length > invocation.limits.maximumScans ||
    input.startScanIndex >= description.scans.length
  ) {
    fail(
      "E57_PYE57_REDUCTION_DESCRIPTION_MISMATCH",
      "The scan reducer description does not bind the exact source, runtime, start scan, completed count, policy, limits, and contiguous scan inventory.",
    );
  }
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

class ScanShardedPye57ReductionSession {
  private nextSequence = 1;
  private nextScanIndex: number;
  private aggregateRepresentativeCount: number;
  private completed = false;
  private reading = false;

  private constructor(
    private readonly child: BoundedNdjsonChild,
    private readonly invocation: FoundryE57ScanShardedReductionInvocationV0,
    private readonly streamDescription: ReductionStreamDescription,
    startScanIndex: number,
    completedRepresentativeCount: number,
  ) {
    this.nextScanIndex = startScanIndex;
    this.aggregateRepresentativeCount = completedRepresentativeCount;
  }

  static async start(input: {
    readonly options: FoundryLocalPye57ScanShardedReducerOptions;
    readonly invocation: FoundryE57ScanShardedReductionInvocationV0;
    readonly startScanIndex: number;
    readonly completedRepresentativeCount: number;
    readonly signal?: AbortSignal;
  }): Promise<ScanShardedPye57ReductionSession> {
    if (
      !isAbsolute(input.options.sourcePath) ||
      isUncPath(input.options.sourcePath)
    ) {
      fail(
        "E57_PYE57_SOURCE_UNSAFE",
        "The scan reducer requires an absolute local caller-supplied source path and refuses UNC network roots.",
      );
    }
    assertLaunchNotCancelled(input.signal);
    const artifacts = await resolveRuntimeArtifacts(input.options);
    const deadlineMs = validatedReductionDeadline(input.options);
    assertLaunchNotCancelled(input.signal);
    const child = spawnReductionStreamChild({
      ...input,
      ...artifacts,
      deadlineMs,
    });
    try {
      const processId = child.processId;
      if (processId !== undefined) input.options.onProcessStarted?.(processId);
      const rawDescription = await child.readJsonLine(
        MAXIMUM_DESCRIPTION_LINE_BYTES,
      );
      assertPreSchemaArrayLength({
        value: rawDescription,
        property: "scans",
        maximumLength: input.invocation.limits.maximumScans,
        code: "E57_PYE57_REDUCTION_DESCRIPTION_INVALID",
        label: "Scan-reduction description",
      });
      const description = ReductionStreamDescriptionSchema.parse(
        rawDescription,
      );
      assertReductionDescriptionInventory({
        description,
        invocation: input.invocation,
        startScanIndex: input.startScanIndex,
        completedRepresentativeCount: input.completedRepresentativeCount,
        bridge: artifacts.bridge,
        interpreter: artifacts.interpreter,
      });
      return new ScanShardedPye57ReductionSession(
        child,
        input.invocation,
        description,
        input.startScanIndex,
        input.completedRepresentativeCount,
      );
    } catch (error: unknown) {
      return await terminateForProtocolError(
        child,
        error,
        "E57_PYE57_REDUCTION_DESCRIPTION_INVALID",
        "The scan reducer failed before its exact description was accepted.",
      );
    }
  }

  toReaderDescription(): FoundryE57ScanShardedReaderDescriptionV0 {
    return sealFoundryE57ScanShardedReaderDescriptionV0({
      schemaVersion: FOUNDRY_E57_SCAN_SHARDED_READER_DESCRIPTION_V0,
      invocationSha256:
        computeFoundryE57ScanShardedReductionInvocationSha256(
          this.invocation,
        ),
      inputCompatibilitySha256:
        this.invocation.checkpointContract.inputCompatibilitySha256,
      source: this.invocation.source,
      adapter: {
        name: "pye57_persistent_scan_sharded_reducer",
        version: this.streamDescription.adapterVersion,
        bridgeArtifactSha256: this.streamDescription.bridge.sha256,
        pythonExecutableSha256: this.streamDescription.interpreter.sha256,
        pythonExecutableSizeBytes:
          this.streamDescription.interpreter.sizeBytes,
        pythonVersion: this.streamDescription.pythonVersion,
        numpyVersion: this.streamDescription.numpyVersion,
        identityAuthority: "caller_supplied_unverified",
      },
      readPolicy: {
        sourceAccess: "read_only_pre_and_clean_terminal_sha256",
        scanAccess: "direct_scan_reader_sequential_from_source_point_zero",
        rawPointTransport: "kept_inside_pinned_python_bridge",
        emittedPayload: "bounded_reduced_representatives_only",
        imageDecoderAccess: false,
        imageExtraction: false,
        network: "none",
        modelInference: "none",
        modelTraining: "none",
      },
      crop: this.invocation.crop,
      voxelPolicy: this.invocation.voxelPolicy,
      limits: this.invocation.limits,
      coordinateContract: this.invocation.coordinateContract,
      scans: this.streamDescription.scans,
      totalPointCount: this.streamDescription.totalPointCount,
      authority: "none",
      activation: false,
    });
  }

  private assertScanBinding(
    scan: ReductionStreamScan,
    requestNonce: string,
  ): void {
    const expected = this.streamDescription.scans[this.nextScanIndex];
    if (
      expected === undefined ||
      scan.sequence !== this.nextSequence ||
      scan.requestNonce !== requestNonce ||
      scan.sourceSha256 !== this.invocation.source.sha256 ||
      scan.scanIndex !== this.nextScanIndex ||
      scan.data3dGuid !== expected.data3dGuid ||
      scan.counts.source !== expected.pointCount ||
      scan.counts.processed !== expected.pointCount ||
      scan.points.length !== scan.counts.representatives ||
      scan.points.length >
        this.invocation.limits.maximumRepresentativesPerScan ||
      scan.aggregateRepresentativeCount !==
        this.aggregateRepresentativeCount + scan.points.length ||
      scan.aggregateRepresentativeCount >
        this.invocation.limits.maximumTotalRepresentatives
    ) {
      fail(
        "E57_PYE57_REDUCTION_SCAN_BINDING_MISMATCH",
        "A reduced scan does not bind the exact sequence, nonce, source, scan, counts, and output caps.",
      );
    }
    const terminalExpected =
      this.nextScanIndex === this.streamDescription.scans.length - 1;
    if (
      terminalExpected !== (scan.terminalSourceAfter !== null) ||
      (scan.terminalSourceAfter !== null &&
        !sameFileIdentity(
          scan.terminalSourceAfter,
          this.invocation.source,
        ))
    ) {
      fail(
        "E57_PYE57_REDUCTION_TERMINAL_MISMATCH",
        "The reduced scan terminal source identity does not match the exact final scan boundary.",
      );
    }
  }

  async reduceNextScan(scanIndex: number): Promise<unknown> {
    if (this.completed || this.reading || scanIndex !== this.nextScanIndex) {
      fail(
        this.completed
          ? "E57_PYE57_REDUCTION_ALREADY_COMPLETE"
          : this.reading
            ? "E57_PYE57_REDUCTION_CONCURRENT_READ"
            : "E57_PYE57_REDUCTION_REQUEST_OUT_OF_ORDER",
        "The scan reducer accepts only one exact next scan command before terminal completion.",
      );
    }
    this.reading = true;
    try {
      const requestNonce = await this.child.sendNext(
        this.nextSequence,
        FOUNDRY_E57_PYE57_SCAN_REDUCTION_STREAM_PROTOCOL_V0,
      );
      const rawScan = await this.child.readJsonLine(
        MAXIMUM_PROTOCOL_LINE_BYTES,
      );
      assertPreSchemaArrayLength({
        value: rawScan,
        property: "points",
        maximumLength:
          this.invocation.limits.maximumRepresentativesPerScan,
        code: "E57_PYE57_REDUCTION_SCAN_INVALID",
        label: "Reduced-scan protocol record",
      });
      const scan = ReductionStreamScanSchema.parse(rawScan);
      this.assertScanBinding(scan, requestNonce);
      this.aggregateRepresentativeCount =
        scan.aggregateRepresentativeCount;
      this.nextSequence += 1;
      this.nextScanIndex += 1;
      const terminal =
        this.nextScanIndex === this.streamDescription.scans.length;
      if (terminal) {
        this.completed = true;
        await this.child.assertSuccessfulExit();
      }
      return FoundryE57RawReducedScanV0Schema.parse({
        sourceSha256: scan.sourceSha256,
        scanIndex: scan.scanIndex,
        data3dGuid: scan.data3dGuid,
        counts: scan.counts,
        points: scan.points,
        terminalSourceAfter: scan.terminalSourceAfter,
      });
    } catch (error: unknown) {
      return await terminateForProtocolError(
        this.child,
        error,
        "E57_PYE57_REDUCTION_SCAN_INVALID",
        "The scan reducer failed while accepting its next reduced scan.",
      );
    } finally {
      this.reading = false;
    }
  }

  async close(): Promise<void> {
    await this.child.close();
  }
}

interface ActiveReductionRun {
  readonly session: ScanShardedPye57ReductionSession;
  readonly signal: AbortSignal | undefined;
}

/**
 * Uses the reviewed command-credit, nonce, deadline, cancellation, kill/wait,
 * and output-cap process boundary while keeping raw points inside the pinned
 * Python bridge. It supplies no filesystem custody or execution fence.
 */
export function createFoundryLocalPye57ScanShardedReducer(
  options: FoundryLocalPye57ScanShardedReducerOptions,
): FoundryE57ScanReductionReader {
  let active: ActiveReductionRun | null = null;
  let opening: OpeningReaderRun | null = null;
  return {
    describe: async (input) => {
      if (active !== null || opening !== null) {
        fail(
          "E57_PYE57_REDUCTION_RUN_ALREADY_ACTIVE",
          "The scan reducer already has one active run.",
        );
      }
      const controller = new AbortController();
      let resolveDone: (() => void) | undefined;
      const done = new Promise<void>((resolvePromise) => {
        resolveDone = resolvePromise;
      });
      if (resolveDone === undefined) {
        fail(
          "E57_PYE57_REDUCTION_INTERNAL_STATE_INVALID",
          "The scan reducer could not initialize its opening-run observer.",
        );
      }
      const openingRun: OpeningReaderRun = {
        controller,
        done,
        resolveDone,
      };
      opening = openingRun;
      const signal =
        input.signal === undefined
          ? controller.signal
          : AbortSignal.any([input.signal, controller.signal]);
      let session: ScanShardedPye57ReductionSession | null = null;
      try {
        session = await ScanShardedPye57ReductionSession.start({
          options,
          invocation: input.invocation,
          startScanIndex: input.startScanIndex,
          completedRepresentativeCount:
            input.completedRepresentativeCount,
          signal,
        });
        const description = session.toReaderDescription();
        active = {
          session,
          signal: input.signal,
        };
        session = null;
        return description;
      } finally {
        try {
          if (session !== null) await session.close();
        } finally {
          if (opening === openingRun) opening = null;
          openingRun.resolveDone();
        }
      }
    },
    reduceNextScan: async (input) => {
      const run = active;
      if (run === null || run.signal !== input.signal) {
        fail(
          "E57_PYE57_REDUCTION_RUN_BINDING_MISMATCH",
          "The reduced scan request does not belong to its exact active signal-bound run.",
        );
      }
      return await run.session.reduceNextScan(input.scanIndex);
    },
    close: async () => {
      const openingRun = opening;
      openingRun?.controller.abort();
      if (openingRun !== null) await openingRun.done;
      const run = active;
      active = null;
      if (run !== null) await run.session.close();
    },
  };
}

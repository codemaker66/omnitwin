import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_E57_GEOMETRY_MAXIMUM_INPUT_POINTS,
  FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS,
  FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
  FoundryE57GeometryScanDescriptionV0Schema,
  sealFoundryE57GeometryReaderDescriptionV0,
  type FoundryE57GeometryReader,
} from "./e57-geometry-worker.js";
import { sha256RegularFile } from "./hash.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAXIMUM_BRIDGE_SCRIPT_BYTES = 1024 * 1024;
const MAXIMUM_BRIDGE_STDERR_BYTES = 1024 * 1024;
const MAXIMUM_PYTHON_EXECUTABLE_BYTES = 512 * 1024 * 1024;
export const FOUNDRY_E57_PYE57_DEFAULT_COMMAND_DEADLINE_MS = 60_000;
export const FOUNDRY_E57_PYE57_MINIMUM_COMMAND_DEADLINE_MS = 100;

export interface FoundryLocalPye57GeometryReaderOptions {
  readonly sourcePath: string;
  readonly bridgeScriptPath: string;
  readonly expectedBridgeArtifactSha256: string;
  readonly pythonExecutable: string;
  readonly commandDeadlineMs?: number;
}

interface BridgeSuccess {
  readonly value: unknown;
  readonly bridgeArtifactSha256: string;
}

interface BridgeFailurePayload {
  readonly code: string;
  readonly message: string;
}

const Pye57BridgeDescriptionSchema = z
  .object({
    adapterVersion: z.string().regex(SAFE_VERSION),
    pythonVersion: z.string().min(1).max(160),
    numpyVersion: z.string().min(1).max(160),
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
  })
  .strict();

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, { cause });
}

function parseBridgeFailure(stderr: string): BridgeFailurePayload | null {
  const lines = stderr.trim().split(/\r?\n/u).filter(Boolean);
  const last = lines.at(-1);
  if (last === undefined) return null;
  try {
    const parsed = JSON.parse(last) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "code" in parsed &&
      "message" in parsed &&
      typeof parsed.code === "string" &&
      typeof parsed.message === "string" &&
      SAFE_ID.test(parsed.code) &&
      parsed.message.length <= 4_096
    ) {
      return { code: parsed.code, message: parsed.message };
    }
  } catch {
    return null;
  }
  return null;
}

async function assertBridgeArtifactUnchanged(
  bridgePath: string,
  before: Awaited<ReturnType<typeof sha256RegularFile>>,
): Promise<void> {
  let after: Awaited<ReturnType<typeof sha256RegularFile>>;
  try {
    after = await sha256RegularFile(bridgePath);
  } catch (error: unknown) {
    throw new FoundryIntegrityError(
      "E57_PYE57_BRIDGE_ARTIFACT_CHANGED",
      "The local pye57 bridge artifact changed or became unreadable during execution.",
      { cause: error },
    );
  }
  if (after.sizeBytes !== before.sizeBytes || after.sha256 !== before.sha256) {
    throw new FoundryIntegrityError(
      "E57_PYE57_BRIDGE_ARTIFACT_CHANGED",
      "The local pye57 bridge artifact changed during execution.",
    );
  }
}

async function runPye57Bridge(
  options: FoundryLocalPye57GeometryReaderOptions,
  args: readonly string[],
  maximumStdoutBytes: number,
  signal: AbortSignal | undefined,
): Promise<BridgeSuccess> {
  if (!isAbsolute(options.bridgeScriptPath)) {
    fail(
      "E57_PYE57_BRIDGE_SCRIPT_INVALID",
      "The caller-supplied local pye57 bridge path must be absolute.",
    );
  }
  if (!isAbsolute(options.sourcePath)) {
    fail(
      "E57_PYE57_SOURCE_UNSAFE",
      "The caller-supplied local E57 source path must be absolute.",
    );
  }
  const requestedBridgePath = resolve(options.bridgeScriptPath);
  let requestedBridgeMetadata: Awaited<ReturnType<typeof lstat>>;
  try {
    requestedBridgeMetadata = await lstat(requestedBridgePath);
  } catch (error: unknown) {
    fail(
      "E57_PYE57_BRIDGE_SCRIPT_INVALID",
      "The configured local pye57 bridge script does not resolve to a bounded regular file.",
      error,
    );
  }
  if (requestedBridgeMetadata.isSymbolicLink()) {
    fail(
      "E57_PYE57_BRIDGE_SCRIPT_INVALID",
      "The local pye57 bridge refuses a symbolic-link script path.",
    );
  }
  let bridgePath: string;
  try {
    bridgePath = await realpath(requestedBridgePath);
  } catch (error: unknown) {
    fail(
      "E57_PYE57_BRIDGE_SCRIPT_INVALID",
      "The configured local pye57 bridge script cannot be resolved.",
      error,
    );
  }
  const bridgeMetadata = await lstat(bridgePath);
  if (
    bridgeMetadata.isSymbolicLink() ||
    !bridgeMetadata.isFile() ||
    bridgeMetadata.size <= 0 ||
    bridgeMetadata.size > MAXIMUM_BRIDGE_SCRIPT_BYTES
  ) {
    fail(
      "E57_PYE57_BRIDGE_SCRIPT_INVALID",
      "The local pye57 bridge must be one bounded regular file.",
    );
  }
  const bridgeDigest = await sha256RegularFile(bridgePath);
  const bridgeArtifactSha256 = `sha256:${bridgeDigest.sha256}`;
  if (!SHA256.test(options.expectedBridgeArtifactSha256)) {
    fail(
      "E57_PYE57_BRIDGE_EXPECTED_IDENTITY_INVALID",
      "The expected local pye57 bridge identity must be one lowercase SHA-256 digest.",
    );
  }
  if (bridgeArtifactSha256 !== options.expectedBridgeArtifactSha256) {
    fail(
      "E57_PYE57_BRIDGE_IDENTITY_MISMATCH",
      "The local pye57 bridge artifact does not match the caller-supplied SHA-256 identity.",
    );
  }
  const commandDeadlineMs =
    options.commandDeadlineMs ?? FOUNDRY_E57_PYE57_DEFAULT_COMMAND_DEADLINE_MS;
  if (
    !Number.isSafeInteger(commandDeadlineMs) ||
    commandDeadlineMs < FOUNDRY_E57_PYE57_MINIMUM_COMMAND_DEADLINE_MS ||
    commandDeadlineMs > FOUNDRY_E57_PYE57_DEFAULT_COMMAND_DEADLINE_MS
  ) {
    fail(
      "E57_PYE57_COMMAND_DEADLINE_INVALID",
      `The local pye57 command deadline must be an integer from ${String(FOUNDRY_E57_PYE57_MINIMUM_COMMAND_DEADLINE_MS)} through ${String(FOUNDRY_E57_PYE57_DEFAULT_COMMAND_DEADLINE_MS)} milliseconds.`,
    );
  }
  if (!isAbsolute(options.pythonExecutable)) {
    fail(
      "E57_PYE57_PYTHON_EXECUTABLE_INVALID",
      "The caller-supplied Python executable path must be absolute.",
    );
  }
  const requestedPythonPath = resolve(options.pythonExecutable);
  let requestedPythonMetadata: Awaited<ReturnType<typeof lstat>>;
  try {
    requestedPythonMetadata = await lstat(requestedPythonPath);
  } catch (error: unknown) {
    fail(
      "E57_PYE57_DEPENDENCY_UNAVAILABLE",
      `The caller-supplied local Python executable is unavailable: ${requestedPythonPath}.`,
      error,
    );
  }
  if (requestedPythonMetadata.isSymbolicLink()) {
    fail(
      "E57_PYE57_PYTHON_EXECUTABLE_INVALID",
      "The local pye57 adapter refuses a symbolic-link Python executable path.",
    );
  }
  let python: string;
  try {
    python = await realpath(requestedPythonPath);
  } catch (error: unknown) {
    fail(
      "E57_PYE57_DEPENDENCY_UNAVAILABLE",
      "The caller-supplied local Python executable cannot be resolved.",
      error,
    );
  }
  const pythonMetadata = await lstat(python);
  if (
    pythonMetadata.isSymbolicLink() ||
    !pythonMetadata.isFile() ||
    pythonMetadata.size <= 0 ||
    pythonMetadata.size > MAXIMUM_PYTHON_EXECUTABLE_BYTES
  ) {
    fail(
      "E57_PYE57_PYTHON_EXECUTABLE_INVALID",
      "The local pye57 adapter requires one bounded regular Python executable.",
    );
  }
  if (signal?.aborted === true) {
    fail(
      "E57_GEOMETRY_CANCELLED",
      "The local pye57 bridge was cancelled before process launch.",
    );
  }
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
  return await new Promise<BridgeSuccess>((resolvePromise, rejectPromise) => {
    const child = spawn(python, ["-E", "-P", "-B", bridgePath, ...args], {
      cwd: dirname(python),
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let terminalError: Error | null = null;
    const currentTerminalError = (): Error | null => terminalError;
    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      signal?.removeEventListener("abort", abort);
      rejectPromise(error);
    };
    const settleResolve = (success: BridgeSuccess): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      signal?.removeEventListener("abort", abort);
      resolvePromise(success);
    };
    const requestTermination = (error: Error): void => {
      if (settled || terminalError !== null) return;
      terminalError = error;
      stdout.length = 0;
      stderr.length = 0;
      try {
        child.kill("SIGKILL");
      } catch {
        // Rejection is intentionally deferred until the child emits close.
      }
    };
    const abort = (): void => {
      requestTermination(
        new FoundryIntegrityError(
          "E57_GEOMETRY_CANCELLED",
          "The local pye57 bridge was cancelled.",
        ),
      );
    };
    const deadlineTimer = setTimeout(() => {
      requestTermination(
        new FoundryIntegrityError(
          "E57_PYE57_BRIDGE_DEADLINE_EXCEEDED",
          `The local pye57 bridge exceeded its ${String(commandDeadlineMs)} millisecond command deadline.`,
        ),
      );
    }, commandDeadlineMs);
    deadlineTimer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) abort();
    child.on("error", (error: NodeJS.ErrnoException) => {
      requestTermination(
        new FoundryIntegrityError(
          error.code === "ENOENT"
            ? "E57_PYE57_DEPENDENCY_UNAVAILABLE"
            : "E57_PYE57_BRIDGE_START_FAILED",
          error.code === "ENOENT"
            ? `The configured local Python executable is unavailable: ${python}.`
            : "The local pye57 bridge process could not start.",
          { cause: error },
        ),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled || terminalError !== null) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maximumStdoutBytes) {
        requestTermination(
          new FoundryIntegrityError(
            "E57_PYE57_BRIDGE_OUTPUT_LIMIT_EXCEEDED",
            "The local pye57 bridge exceeded its bounded stdout contract.",
          ),
        );
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled || terminalError !== null) return;
      stderrBytes += chunk.length;
      if (stderrBytes > MAXIMUM_BRIDGE_STDERR_BYTES) {
        requestTermination(
          new FoundryIntegrityError(
            "E57_PYE57_BRIDGE_ERROR_LIMIT_EXCEEDED",
            "The local pye57 bridge exceeded its bounded stderr contract.",
          ),
        );
        return;
      }
      stderr.push(Buffer.from(chunk));
    });
    child.once("close", (code, terminationSignal) => {
      void (async (): Promise<void> => {
        if (settled) return;
        const afterHashError = currentTerminalError();
        if (afterHashError !== null) {
          settleReject(afterHashError);
          return;
        }
        try {
          await assertBridgeArtifactUnchanged(bridgePath, bridgeDigest);
        } catch (error: unknown) {
          settleReject(
            error instanceof Error
              ? error
              : new FoundryIntegrityError(
                  "E57_PYE57_BRIDGE_ARTIFACT_CHANGED",
                  "The local pye57 bridge artifact identity check failed.",
                  { cause: error },
                ),
          );
          return;
        }
        if (terminalError !== null) {
          settleReject(terminalError);
          return;
        }
        if (code !== 0) {
          const stderrText = Buffer.concat(stderr).toString("utf8");
          const failure = parseBridgeFailure(stderrText);
          settleReject(
            new FoundryIntegrityError(
              failure?.code ?? "E57_PYE57_BRIDGE_FAILED",
              failure?.message ??
                `The local pye57 bridge failed with exit ${String(code)} and signal ${String(terminationSignal)}.`,
            ),
          );
          return;
        }
        let value: unknown;
        try {
          value = JSON.parse(Buffer.concat(stdout).toString("utf8")) as unknown;
        } catch (error: unknown) {
          settleReject(
            new FoundryIntegrityError(
              "E57_PYE57_BRIDGE_JSON_INVALID",
              "The local pye57 bridge did not return one valid JSON document.",
              { cause: error },
            ),
          );
          return;
        }
        settleResolve({
          value,
          bridgeArtifactSha256,
        });
      })();
    });
  });
}

/**
 * Creates a local-only pye57 reader for the deterministic worker. The Python
 * bridge hashes every container byte before and after each command, including
 * possible embedded-image bytes, but never invokes an image decoder or extracts
 * images. Caller-supplied path identities and the Python/native environment are
 * unverified; this bounded seam is not activation evidence or a Grand Hall-scale
 * processing worker.
 */
export function createFoundryLocalPye57GeometryReader(
  options: FoundryLocalPye57GeometryReaderOptions,
): FoundryE57GeometryReader {
  return {
    describe: async (input) => {
      const result = await runPye57Bridge(
        options,
        [
          "describe",
          "--source",
          options.sourcePath,
          "--expected-size",
          String(input.source.sizeBytes),
          "--expected-sha256",
          input.source.sha256,
          "--maximum-total-points",
          String(input.maximumInputPoints),
          "--maximum-scans",
          String(input.maximumScans),
        ],
        4 * 1024 * 1024,
        input.signal,
      );
      const parsed = Pye57BridgeDescriptionSchema.safeParse(result.value);
      if (!parsed.success) {
        fail(
          "E57_PYE57_DESCRIPTION_INVALID",
          "The local pye57 bridge returned an invalid description object.",
          parsed.error,
        );
      }
      const record = parsed.data;
      return sealFoundryE57GeometryReaderDescriptionV0({
        schemaVersion: FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0,
        source: input.source,
        adapter: {
          name: "pye57",
          version: record.adapterVersion,
          bridgeArtifactSha256: result.bridgeArtifactSha256,
          pythonVersion: record.pythonVersion,
          numpyVersion: record.numpyVersion,
          identityAuthority: "caller_supplied_unverified",
        },
        readPolicy: {
          sourceAccess: "read_only_pre_and_post_size_sha256",
          batchAccess: "scan_start_replay_bounded_buffer",
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
        scans: record.scans,
        totalPointCount: record.totalPointCount,
        authority: "none",
      });
    },
    readBatch: async (input) => {
      const maximumStdoutBytes = Math.min(
        32 * 1024 * 1024,
        1024 * 1024 + input.maximumPoints * 160,
      );
      const result = await runPye57Bridge(
        options,
        [
          "read-batch",
          "--source",
          options.sourcePath,
          "--expected-size",
          String(input.source.sizeBytes),
          "--expected-sha256",
          input.source.sha256,
          "--maximum-total-points",
          String(input.maximumInputPoints),
          "--maximum-scans",
          String(input.maximumScans),
          "--scan-index",
          String(input.scanIndex),
          "--start-point-index",
          String(input.startPointIndex),
          "--maximum-points",
          String(input.maximumPoints),
        ],
        maximumStdoutBytes,
        input.signal,
      );
      return result.value;
    },
  };
}

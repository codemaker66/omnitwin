import {
  spawn,
  type SpawnOptionsWithStdioTuple,
} from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
import {
  compileFoundryCapturedQualityComparisonReportV0,
  type CompileFoundryCapturedQualityComparisonReportV0Input,
  type FoundryCapturedQualityComparisonReportV0,
} from "../../../packages/reconstruction-foundry/src/captured-quality-comparison.js";

const MAX_STDOUT_BYTES = 32 * 1_024 * 1_024;
const MAX_STDERR_BYTES = 4 * 1_024 * 1_024;
const MAX_RUNNER_OBSERVATION_BYTES = 4 * 1_024 * 1_024;
const PROGRESS_PREFIX = "CAPTURE_PROGRESS ";
const REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const RUNNER_OBSERVATION_SCHEMA =
  "venviewer.reception-captured-quality-runner-observation.v1";

export type CapturedQualityComparisonProcessPhase =
  | "verifying_sources"
  | "starting_renderer"
  | "capturing"
  | "scoring"
  | "finalizing";

export interface CapturedQualityComparisonProcessContext {
  readonly repoRoot: string;
  readonly qualityRoot: string;
  readonly mobileRoot: string;
  readonly outputRoot: string;
  readonly requestId: string;
}

export interface CapturedQualityComparisonProcessProgress {
  readonly phase: CapturedQualityComparisonProcessPhase;
  readonly completed: number;
  readonly total: 24;
  readonly message: string;
}

interface CapturedQualityComparisonChildProcess {
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "close",
    listener: (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => void,
  ): unknown;
}

export type CapturedQualityComparisonSpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<"ignore", "pipe", "pipe"> & {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly windowsHide: true;
  },
) => CapturedQualityComparisonChildProcess;

export interface CreateCapturedQualityComparisonProcessRunnerOptions {
  readonly runnerScriptPath?: string;
  /** @internal Focused-test seam. Production callers omit this. */
  readonly spawnProcess?: CapturedQualityComparisonSpawnProcess;
}

function requireAbsolutePath(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || !isAbsolute(trimmed)) {
    throw new TypeError(`${label} must be an absolute path from trusted process configuration.`);
  }
  return resolve(trimmed);
}

function abortError(): Error {
  const error = new Error("The local captured-quality comparison was stopped.");
  error.name = "AbortError";
  return error;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function exactFinalOutputPath(outputRoot: string, requestId: string): string {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new TypeError(
      "requestId must be a 32-character lowercase hexadecimal value.",
    );
  }
  const finalOutputPath = resolve(outputRoot, requestId);
  if (relative(outputRoot, finalOutputPath) !== requestId) {
    throw new TypeError(
      "The captured-quality final output path escaped its configured root.",
    );
  }
  return finalOutputPath;
}

async function removeOwnedFailedOutput(input: {
  readonly outputRoot: string;
  readonly finalOutputPath: string;
  readonly requestId: string;
  readonly existedBeforeSpawn: boolean;
}): Promise<void> {
  if (input.existedBeforeSpawn || !(await pathExists(input.finalOutputPath))) {
    return;
  }
  if (
    exactFinalOutputPath(input.outputRoot, input.requestId) !==
      input.finalOutputPath
  ) {
    throw new Error(
      "The failed captured-quality output could not be matched to its exact request path.",
    );
  }
  const outputRootInfo = await lstat(input.outputRoot);
  const finalOutputInfo = await lstat(input.finalOutputPath);
  if (
    !outputRootInfo.isDirectory() ||
    outputRootInfo.isSymbolicLink() ||
    !finalOutputInfo.isDirectory() ||
    finalOutputInfo.isSymbolicLink()
  ) {
    throw new Error(
      "The failed captured-quality output was not a removable owned directory.",
    );
  }
  const observationPath = join(
    input.finalOutputPath,
    "runner-observation.json",
  );
  const observationInfo = await lstat(observationPath);
  if (
    !observationInfo.isFile() ||
    observationInfo.isSymbolicLink() ||
    observationInfo.size < 1 ||
    observationInfo.size > MAX_RUNNER_OBSERVATION_BYTES
  ) {
    throw new Error(
      "The failed captured-quality output has no bounded ownership receipt.",
    );
  }
  const observationBytes = await readFile(observationPath);
  if (observationBytes.byteLength > MAX_RUNNER_OBSERVATION_BYTES) {
    throw new Error(
      "The failed captured-quality output ownership receipt exceeded its bound.",
    );
  }
  let observation: unknown;
  try {
    observation = JSON.parse(observationBytes.toString("utf8"));
  } catch {
    throw new Error(
      "The failed captured-quality output ownership receipt was invalid.",
    );
  }
  if (
    typeof observation !== "object" ||
    observation === null ||
    Array.isArray(observation)
  ) {
    throw new Error(
      "The failed captured-quality output ownership receipt was invalid.",
    );
  }
  const observationRecord = observation as Record<string, unknown>;
  const compileInputSha256 = observationRecord.compileInputSha256;
  if (
    observationRecord.schemaVersion !== RUNNER_OBSERVATION_SCHEMA ||
    observationRecord.requestId !== input.requestId ||
    typeof compileInputSha256 !== "string" ||
    !SHA256_PATTERN.test(compileInputSha256)
  ) {
    throw new Error(
      "The failed captured-quality output ownership receipt did not match the request.",
    );
  }
  const compileInputPath = join(input.finalOutputPath, "compile-input.json");
  const compileInputInfo = await lstat(compileInputPath);
  if (
    !compileInputInfo.isFile() ||
    compileInputInfo.isSymbolicLink() ||
    compileInputInfo.size < 1 ||
    compileInputInfo.size > MAX_STDOUT_BYTES
  ) {
    throw new Error(
      "The failed captured-quality output has no bounded compile-input receipt.",
    );
  }
  const compileInputBytes = await readFile(compileInputPath);
  if (compileInputBytes.byteLength > MAX_STDOUT_BYTES) {
    throw new Error(
      "The failed captured-quality output compile-input receipt exceeded its bound.",
    );
  }
  let compileInput: unknown;
  try {
    compileInput = JSON.parse(compileInputBytes.toString("utf8"));
  } catch {
    throw new Error(
      "The failed captured-quality output compile-input receipt was invalid.",
    );
  }
  const observedCompileInputSha256 = createHash("sha256")
    .update(JSON.stringify(compileInput), "utf8")
    .digest("hex");
  if (observedCompileInputSha256 !== compileInputSha256) {
    throw new Error(
      "The failed captured-quality output compile-input receipt did not match its ownership receipt.",
    );
  }
  await rm(input.finalOutputPath, { force: false, recursive: true });
  if (await pathExists(input.finalOutputPath)) {
    throw new Error(
      "The failed captured-quality output could not be confirmed removed.",
    );
  }
}

function parseProgressLine(
  line: string,
): CapturedQualityComparisonProcessProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(PROGRESS_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const phase = record.phase;
  const completedCaptures = record.completedCaptures;
  const totalCaptures = record.totalCaptures;
  if (
    ![
      "verifying_sources",
      "starting_renderer",
      "capturing",
      "scoring",
      "finalizing",
    ].includes(typeof phase === "string" ? phase : "") ||
    !Number.isSafeInteger(completedCaptures) ||
    (completedCaptures as number) < 0 ||
    (completedCaptures as number) > 24 ||
    totalCaptures !== 24
  ) {
    return null;
  }
  return {
    phase: phase as CapturedQualityComparisonProcessPhase,
    completed: completedCaptures as number,
    total: totalCaptures,
    message: phase === "verifying_sources"
      ? "Checking the eight frozen source files."
      : phase === "starting_renderer"
        ? "Starting the local Living Hall renderer."
        : phase === "capturing"
          ? "Capturing fixed Quality and Mobile views."
          : phase === "scoring"
            ? "Comparing the matched lossless images."
            : "Binding the final local report.",
  };
}

function collectProcess(
  child: CapturedQualityComparisonChildProcess,
  signal: AbortSignal,
  onProgress: (progress: CapturedQualityComparisonProcessProgress) => void,
): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    let settled = false;
    let terminationRequested = false;
    let pendingFailure: Error | null = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];
    let stderrRemainder = "";
    const stderrTail: string[] = [];

    const finish = (error: Error | null, value = ""): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error === null) resolvePromise(value);
      else rejectPromise(error);
    };
    const requestTermination = (error: Error): void => {
      if (settled) return;
      pendingFailure ??= error;
      if (terminationRequested) return;
      terminationRequested = true;
      child.kill("SIGTERM");
    };
    const onAbort = (): void => {
      requestTermination(abortError());
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (pendingFailure !== null) return;
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        requestTermination(new Error(
          "The captured-quality runner returned too much report data.",
        ));
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (pendingFailure !== null) return;
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) {
        requestTermination(new Error(
          "The captured-quality runner returned too much diagnostic data.",
        ));
        return;
      }
      const lines = `${stderrRemainder}${chunk.toString("utf8")}`.split(/\r?\n/u);
      stderrRemainder = lines.pop() ?? "";
      for (const line of lines) {
        const progress = parseProgressLine(line);
        if (progress !== null) onProgress(progress);
        else if (line.startsWith(PROGRESS_PREFIX)) {
          requestTermination(new Error(
            "The captured-quality runner returned invalid progress data.",
          ));
          return;
        } else if (line.trim().length > 0) {
          stderrTail.push(line.trim());
          if (stderrTail.length > 8) stderrTail.shift();
        }
      }
    });
    child.once("error", (error) => {
      finish(pendingFailure ?? error);
    });
    child.once("close", (code, terminationSignal) => {
      if (pendingFailure !== null) {
        finish(pendingFailure);
        return;
      }
      if (stderrRemainder.trim().length > 0) {
        const progress = parseProgressLine(stderrRemainder);
        if (progress !== null) onProgress(progress);
        else if (stderrRemainder.startsWith(PROGRESS_PREFIX)) {
          finish(new Error(
            "The captured-quality runner returned invalid progress data.",
          ));
          return;
        } else stderrTail.push(stderrRemainder.trim());
      }
      if (code !== 0) {
        const detail = stderrTail.at(-1);
        finish(new Error(
          detail === undefined
            ? `The captured-quality runner stopped (${terminationSignal ?? String(code)}).`
            : `The captured-quality runner stopped: ${detail}`,
        ));
        return;
      }
      finish(null, Buffer.concat(stdout).toString("utf8"));
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

/**
 * Build the trusted subprocess seam consumed by the single-flight controller.
 * Paths originate at process startup; no browser request can replace them.
 */
export function createCapturedQualityComparisonProcessRunner(
  options: CreateCapturedQualityComparisonProcessRunnerOptions = {},
): (
  context: CapturedQualityComparisonProcessContext,
  signal: AbortSignal,
  onProgress: (progress: CapturedQualityComparisonProcessProgress) => void,
) => Promise<FoundryCapturedQualityComparisonReportV0> {
  const spawnProcess: CapturedQualityComparisonSpawnProcess =
    options.spawnProcess ?? ((command, args, spawnOptions) =>
      spawn(command, args, spawnOptions));
  return async (context, signal, onProgress) => {
    const repoRoot = requireAbsolutePath(context.repoRoot, "repoRoot");
    const qualityRoot = requireAbsolutePath(context.qualityRoot, "qualityRoot");
    const mobileRoot = requireAbsolutePath(context.mobileRoot, "mobileRoot");
    const outputRoot = requireAbsolutePath(context.outputRoot, "outputRoot");
    const runnerScript = requireAbsolutePath(
      options.runnerScriptPath ?? resolve(
        repoRoot,
        "tools/reception-hd/run_captured_quality_comparison.mjs",
      ),
      "runnerScriptPath",
    );
    const finalOutputPath = exactFinalOutputPath(outputRoot, context.requestId);
    const finalOutputExistedBeforeSpawn = await pathExists(finalOutputPath);

    try {
      const child = spawnProcess(process.execPath, [
        runnerScript,
        "--repo-root",
        repoRoot,
        "--quality-root",
        qualityRoot,
        "--mobile-root",
        mobileRoot,
        "--output-root",
        outputRoot,
        "--request-id",
        context.requestId,
      ], {
        cwd: repoRoot,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const serializedInput = await collectProcess(child, signal, onProgress);
      if (signal.aborted) throw abortError();
      let input: unknown;
      try {
        input = JSON.parse(serializedInput);
      } catch {
        throw new Error(
          "The captured-quality runner did not return one valid JSON report input.",
        );
      }
      const report = compileFoundryCapturedQualityComparisonReportV0(
        input as CompileFoundryCapturedQualityComparisonReportV0Input,
      );
      return report;
    } catch (error: unknown) {
      await removeOwnedFailedOutput({
        outputRoot,
        finalOutputPath,
        requestId: context.requestId,
        existedBeforeSpawn: finalOutputExistedBeforeSpawn,
      });
      throw error;
    }
  };
}

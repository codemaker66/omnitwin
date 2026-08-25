import { spawn } from "node:child_process";
import { constants as fsConstants, type Stats } from "node:fs";
import { access, lstat, readdir, realpath, statfs } from "node:fs/promises";
import { arch, platform, totalmem } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { sha256RegularFileWithHead } from "@omnitwin/reconstruction-foundry";

import type {
  GrandHallGpuObservationV1,
  GrandHallLccObservationV1,
  GrandHallScratchObservationV1,
  GrandHallXgridsMachineObservationV1,
} from "./grand-hall-xgrids-lcc-preflight.js";

const PROCESS_TIMEOUT_MILLISECONDS = 15_000;
const MAX_PROCESS_STDOUT_BYTES = 64 * 1024;
const MAX_PROCESS_STDERR_BYTES = 64 * 1024;
const SCRATCH_ENVIRONMENT_KEY = "OMNITWIN_PREFLIGHT_SCRATCH_ROOT";

const SCRATCH_PROBE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$p = [Environment]::GetEnvironmentVariable('OMNITWIN_PREFLIGHT_SCRATCH_ROOT', 'Process')",
  "if ([string]::IsNullOrWhiteSpace($p)) { throw 'scratch path missing' }",
  "$item = Get-Item -LiteralPath $p -Force",
  "$driveName = $item.PSDrive.Name",
  "if ($driveName -notmatch '^[A-Za-z]$') { throw 'drive letter required' }",
  "$partitions = @(Get-Partition -DriveLetter $driveName)",
  "$disks = @($partitions | Get-Disk | Sort-Object Number -Unique)",
  "$volume = Get-Volume -DriveLetter $driveName",
  "$driveInfo = [System.IO.DriveInfo]::new($item.PSDrive.Root)",
  "$disk = if ($disks.Count -eq 1) { $disks[0] } else { $null }",
  "[ordered]@{ diskCount = $disks.Count; busType = if ($null -eq $disk) { $null } else { [string]$disk.BusType }; healthStatus = if ($null -eq $disk) { $null } else { [string]$disk.HealthStatus }; operationalStatus = if ($null -eq $disk) { $null } else { [string]$disk.OperationalStatus }; fileSystem = [string]$volume.FileSystem; driveType = [string]$driveInfo.DriveType } | ConvertTo-Json -Compress",
].join("; ");

interface BoundedProcessResult {
  readonly outcome: "completed" | "failed" | "timed_out" | "output_limit_exceeded";
  readonly exitCode: number | null;
  readonly stdout: string;
}

interface ScratchPowerShellResult {
  readonly diskCount: number;
  readonly busType: string | null;
  readonly healthStatus: string | null;
  readonly operationalStatus: string | null;
  readonly fileSystem: string;
  readonly driveType: string;
}

export interface GrandHallWindowsCollectorDependencies {
  readonly runProcess?: (
    executablePath: string,
    arguments_: readonly string[],
    environment: Readonly<Record<string, string>>,
  ) => Promise<BoundedProcessResult>;
  readonly platform?: string;
  readonly architecture?: string;
  readonly totalPhysicalMemoryBytes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function comparablePath(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

function windowsLocalAbsolutePath(value: string): boolean {
  if (!isAbsolute(value) || value.includes("\0")) return false;
  if (process.platform !== "win32") return true;
  const windows = value.replaceAll("/", "\\");
  return /^[A-Za-z]:\\/u.test(windows) && !windows.startsWith("\\\\") &&
    !windows.startsWith("\\?\\") && !windows.startsWith("\\.\\") &&
    !windows.slice(2).includes(":") &&
    !windows.slice(2).split("\\").some((part) => part === "." || part === "..");
}

async function safeRegularFile(path: string, allowSystemHardlinks = false): Promise<Stats | null> {
  try {
    const requested = resolve(path);
    const stats = await lstat(requested);
    if (
      stats.isSymbolicLink() || !stats.isFile() ||
      (!allowSystemHardlinks && stats.nlink !== 1)
    ) return null;
    const canonical = await realpath(requested);
    return comparablePath(canonical) === comparablePath(requested) ? stats : null;
  } catch {
    return null;
  }
}

async function safeDirectory(path: string): Promise<string | null> {
  if (!windowsLocalAbsolutePath(path)) return null;
  try {
    const requested = resolve(path);
    const stats = await lstat(requested);
    if (stats.isSymbolicLink() || !stats.isDirectory()) return null;
    const canonical = await realpath(requested);
    return comparablePath(canonical) === comparablePath(requested) ? canonical : null;
  } catch {
    return null;
  }
}

async function defaultRunProcess(
  executablePath: string,
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>>,
): Promise<BoundedProcessResult> {
  return await new Promise((resolvePromise) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];
    const finish = (result: BoundedProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(result);
    };
    const child = spawn(executablePath, [...arguments_], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...environment },
    });
    const timeout = setTimeout(() => {
      child.kill();
      finish({ outcome: "timed_out", exitCode: null, stdout: "" });
    }, PROCESS_TIMEOUT_MILLISECONDS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_PROCESS_STDOUT_BYTES) {
        child.kill();
        finish({ outcome: "output_limit_exceeded", exitCode: null, stdout: "" });
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_PROCESS_STDERR_BYTES) {
        child.kill();
        finish({ outcome: "output_limit_exceeded", exitCode: null, stdout: "" });
      }
    });
    child.once("error", () => {
      finish({ outcome: "failed", exitCode: null, stdout: "" });
    });
    child.once("close", (code) => {
      finish({
        outcome: code === 0 ? "completed" : "failed",
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

/**
 * Creates the entire child environment. It deliberately does not inherit process.env, so API
 * keys, tokens, user profile paths, proxy credentials, and unrelated operator state cannot reach
 * either read-only probe. Every path below is derived solely from the already-verified Windows
 * installation root; the optional scratch locator is passed only to the fixed PowerShell script.
 */
export function createGrandHallWindowsSubprocessEnvironment(
  windowsRoot: string,
  scratchRoot?: string,
): Readonly<Record<string, string>> {
  if (!windowsLocalAbsolutePath(windowsRoot)) return Object.freeze({});
  const root = resolve(windowsRoot);
  const system32 = resolve(root, "System32");
  const programFiles = resolve(root.slice(0, 2), "\\", "Program Files");
  const environment: Record<string, string> = {
    ComSpec: resolve(system32, "cmd.exe"),
    Path: `${system32};${root}`,
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    // NVML resolves its trusted 64-bit driver installation from ProgramFiles on Windows.
    ProgramFiles: programFiles,
    PSModulePath: resolve(system32, "WindowsPowerShell", "v1.0", "Modules"),
    SystemDrive: root.slice(0, 2),
    SystemRoot: root,
    WINDIR: root,
  };
  if (scratchRoot !== undefined) environment[SCRATCH_ENVIRONMENT_KEY] = scratchRoot;
  return Object.freeze(environment);
}

function unavailableGpu(): GrandHallGpuObservationV1 {
  return Object.freeze({
    state: "unavailable",
    gpuCount: null,
    name: null,
    memoryMiB: null,
    driverVersion: null,
    computeCapability: null,
    query: "nvidia_smi_fixed_read_only_query",
  });
}

export function parseNvidiaSmiObservation(output: string): GrandHallGpuObservationV1 {
  const lines = output.trim().split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length !== 1) return unavailableGpu();
  const fields = lines[0]?.split(",").map((field) => field.trim());
  if (fields === undefined || fields.length !== 5) return unavailableGpu();
  const [index, name, memoryText, driverVersion, computeText] = fields;
  const memoryMiB = Number(memoryText);
  const computeCapability = Number(computeText);
  if (
    index !== "0" || name === undefined || name.length === 0 ||
    !Number.isSafeInteger(memoryMiB) || memoryMiB <= 0 ||
    driverVersion === undefined || !/^[0-9]+(?:\.[0-9]+)+$/u.test(driverVersion) ||
    !Number.isFinite(computeCapability)
  ) return unavailableGpu();
  return Object.freeze({
    state: "observed",
    gpuCount: 1,
    name,
    memoryMiB,
    driverVersion,
    computeCapability,
    query: "nvidia_smi_fixed_read_only_query",
  });
}

async function collectGpu(
  runProcess: NonNullable<GrandHallWindowsCollectorDependencies["runProcess"]>,
): Promise<GrandHallGpuObservationV1> {
  const windowsRoot = process.env.WINDIR;
  if (windowsRoot === undefined) return unavailableGpu();
  const executable = resolve(windowsRoot, "System32", "nvidia-smi.exe");
  if (await safeRegularFile(executable, true) === null) return unavailableGpu();
  const result = await runProcess(executable, [
    "--query-gpu=index,name,memory.total,driver_version,compute_cap",
    "--format=csv,noheader,nounits",
  ], createGrandHallWindowsSubprocessEnvironment(windowsRoot));
  return result.outcome === "completed" && result.exitCode === 0
    ? parseNvidiaSmiObservation(result.stdout)
    : unavailableGpu();
}

function unavailableScratch(): GrandHallScratchObservationV1 {
  return Object.freeze({
    state: "unavailable",
    locator: "SCRATCH_ROOT",
    freeBytes: null,
    fileSystem: null,
    driveType: null,
    busType: null,
    healthStatus: null,
    operationalStatus: null,
    diskCount: null,
    directoryEmpty: null,
    writeAccessCheck: "not_run",
    writeBenchmarkPerformed: false,
  });
}

function parseScratchPowerShell(output: string): ScratchPowerShellResult | null {
  let value: unknown;
  try {
    value = JSON.parse(output.trim()) as unknown;
  } catch {
    return null;
  }
  if (
    !isRecord(value) || Object.keys(value).sort().join(",") !==
      "busType,diskCount,driveType,fileSystem,healthStatus,operationalStatus" ||
    !Number.isSafeInteger(value.diskCount) || typeof value.diskCount !== "number" ||
    (value.busType !== null && typeof value.busType !== "string") ||
    (value.healthStatus !== null && typeof value.healthStatus !== "string") ||
    (value.operationalStatus !== null && typeof value.operationalStatus !== "string") ||
    typeof value.fileSystem !== "string" || typeof value.driveType !== "string"
  ) return null;
  return {
    diskCount: value.diskCount,
    busType: value.busType,
    healthStatus: value.healthStatus,
    operationalStatus: value.operationalStatus,
    fileSystem: value.fileSystem,
    driveType: value.driveType,
  };
}

async function collectScratch(
  scratchRoot: string,
  runProcess: NonNullable<GrandHallWindowsCollectorDependencies["runProcess"]>,
): Promise<GrandHallScratchObservationV1> {
  const canonical = await safeDirectory(scratchRoot);
  const windowsRoot = process.env.WINDIR;
  if (canonical === null || windowsRoot === undefined) return unavailableScratch();
  const powerShell = resolve(
    windowsRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (await safeRegularFile(powerShell, true) === null) return unavailableScratch();
  let freeBytes: number;
  let directoryEmpty: boolean;
  let writeAccessCheck: "passed" | "failed";
  try {
    const [filesystem, names] = await Promise.all([
      statfs(canonical, { bigint: true }),
      readdir(canonical),
    ]);
    const available = filesystem.bavail * filesystem.bsize;
    if (available < 0n || available > BigInt(Number.MAX_SAFE_INTEGER)) return unavailableScratch();
    freeBytes = Number(available);
    directoryEmpty = names.length === 0;
    try {
      await access(canonical, fsConstants.R_OK | fsConstants.W_OK);
      writeAccessCheck = "passed";
    } catch {
      writeAccessCheck = "failed";
    }
  } catch {
    return unavailableScratch();
  }
  const result = await runProcess(powerShell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    SCRATCH_PROBE_SCRIPT,
  ], createGrandHallWindowsSubprocessEnvironment(windowsRoot, canonical));
  if (result.outcome !== "completed" || result.exitCode !== 0) return unavailableScratch();
  const parsed = parseScratchPowerShell(result.stdout);
  if (parsed === null) return unavailableScratch();
  return Object.freeze({
    state: "observed",
    locator: "SCRATCH_ROOT",
    freeBytes,
    fileSystem: parsed.fileSystem,
    driveType: parsed.driveType,
    busType: parsed.busType,
    healthStatus: parsed.healthStatus,
    operationalStatus: parsed.operationalStatus,
    diskCount: parsed.diskCount,
    directoryEmpty,
    writeAccessCheck,
    writeBenchmarkPerformed: false,
  });
}

function unavailableLcc(): GrandHallLccObservationV1 {
  return Object.freeze({
    state: "unavailable",
    locator: "LCC_INSTALL_ROOT",
    executable: null,
    versionFile: null,
    reportedInternalVersion: null,
    releaseCompatibilityReview: "required_not_recorded",
    futureSettingsEvidence: Object.freeze({
      creatorDataEnabled: "required_not_recorded",
      nvidiaNcoreDataSelected: "required_not_recorded",
      pointCloudPreviewAccepted: "required_not_recorded",
      lccResourceEstimatorAccepted: "required_not_recorded",
      intelligentSpaceRecognitionDisabled: "required_not_recorded",
      reconstructionConfigurationReviewed: "required_not_recorded",
    }),
  });
}

async function collectLcc(lccInstallRoot: string): Promise<GrandHallLccObservationV1> {
  const canonical = await safeDirectory(lccInstallRoot);
  if (canonical === null) return unavailableLcc();
  const executablePath = resolve(canonical, "LccStudio.exe");
  const versionPath = resolve(canonical, "build", "version.json");
  const [executableStats, versionStats] = await Promise.all([
    safeRegularFile(executablePath),
    safeRegularFile(versionPath),
  ]);
  if (executableStats === null || versionStats === null || versionStats.size > 4_096) {
    return unavailableLcc();
  }
  try {
    const [executableDigest, versionDigest] = await Promise.all([
      sha256RegularFileWithHead(executablePath, 0),
      sha256RegularFileWithHead(versionPath, versionStats.size),
    ]);
    if (executableDigest.sizeBytes !== executableStats.size || versionDigest.sizeBytes !== versionStats.size) {
      return unavailableLcc();
    }
    const versionHead = versionDigest.headBytes;
    const hasUtf8Bom = versionHead[0] === 0xef && versionHead[1] === 0xbb &&
      versionHead[2] === 0xbf;
    const versionPayload = hasUtf8Bom ? versionHead.subarray(3) : versionHead;
    const versionText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(versionPayload);
    if (versionText.includes("\0")) return unavailableLcc();
    const parsed: unknown = JSON.parse(versionText);
    if (
      !isRecord(parsed) || Object.keys(parsed).length !== 1 ||
      typeof parsed.version !== "string" || !/^[0-9]+(?:\.[0-9]+)+$/u.test(parsed.version)
    ) return unavailableLcc();
    return Object.freeze({
      state: "observed",
      locator: "LCC_INSTALL_ROOT",
      executable: Object.freeze({
        relativePath: "LccStudio.exe",
        sizeBytes: executableDigest.sizeBytes,
        sha256: `sha256:${executableDigest.sha256}`,
      }),
      versionFile: Object.freeze({
        relativePath: "build/version.json",
        sizeBytes: versionDigest.sizeBytes,
        sha256: `sha256:${versionDigest.sha256}`,
      }),
      reportedInternalVersion: parsed.version,
      releaseCompatibilityReview: "required_not_recorded",
      futureSettingsEvidence: Object.freeze({
        creatorDataEnabled: "required_not_recorded",
        nvidiaNcoreDataSelected: "required_not_recorded",
        pointCloudPreviewAccepted: "required_not_recorded",
        lccResourceEstimatorAccepted: "required_not_recorded",
        intelligentSpaceRecognitionDisabled: "required_not_recorded",
        reconstructionConfigurationReviewed: "required_not_recorded",
      }),
    });
  } catch {
    return unavailableLcc();
  }
}

export async function collectGrandHallWindowsMachineObservation(
  input: {
    readonly scratchRoot: string;
    readonly lccInstallRoot: string;
  },
  dependencies: GrandHallWindowsCollectorDependencies = {},
): Promise<GrandHallXgridsMachineObservationV1> {
  const observedPlatform = dependencies.platform ?? platform();
  const observedArchitecture = dependencies.architecture ?? arch();
  const observedMemory = dependencies.totalPhysicalMemoryBytes ?? totalmem();
  const runProcess = dependencies.runProcess ?? defaultRunProcess;
  if (observedPlatform !== "win32") {
    return Object.freeze({
      platform: observedPlatform,
      architecture: observedArchitecture,
      totalPhysicalMemoryBytes: observedMemory,
      gpu: unavailableGpu(),
      scratch: unavailableScratch(),
      lcc: unavailableLcc(),
    });
  }
  const [gpu, scratch, lcc] = await Promise.all([
    collectGpu(runProcess),
    collectScratch(input.scratchRoot, runProcess),
    collectLcc(input.lccInstallRoot),
  ]);
  return Object.freeze({
    platform: observedPlatform,
    architecture: observedArchitecture,
    totalPhysicalMemoryBytes: observedMemory,
    gpu,
    scratch,
    lcc,
  });
}

import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GRAND_HALL_DEFAULT_OBJECT_PREFIX,
  GRAND_HALL_STAGING_TARGET_ID,
} from "../lib/grand-hall-frontier-contract.js";
import {
  GRAND_HALL_REVIEWED_RAILWAY_CLI_SHA256,
  GRAND_HALL_REVIEWED_RAILWAY_CLI_VERSION,
} from "./grand-hall-railway-cli-contract.js";
import { rejectRetiredGrandHallV1Intake } from "./grand-hall-v1-intake-retired.js";

export const GRAND_HALL_R2_DPAPI_ARTIFACT_HEADER =
  "VENVIEWER-GRAND-HALL-R2-DPAPI-V1\n";

export const GRAND_HALL_R2_RAILWAY_FIELDS = [
  "RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID",
  "RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY",
  "RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN",
] as const;

export type GrandHallR2RailwayField =
  (typeof GRAND_HALL_R2_RAILWAY_FIELDS)[number];

export interface GrandHallR2RailwayTargetIds {
  readonly projectId: string;
  readonly environmentId: string;
  readonly serviceId: string;
}

const MAX_HELPER_OUTPUT_BYTES = 64 * 1_024;
const MAX_PROTECT_HELPER_RUNTIME_MS = 30_000;
const MAX_RAILWAY_HANDOFF_HELPER_RUNTIME_MS = 120_000;
const MAX_DPAPI_ARTIFACT_BYTES = 256 * 1_024;
const DPAPI_ARTIFACT_HEADER_BASE64 = Buffer.from(
  GRAND_HALL_R2_DPAPI_ARTIFACT_HEADER,
  "ascii",
).toString("base64");
const RAILWAY_HANDOFF_SCRIPT_PATH = fileURLToPath(
  new URL("./grand-hall-r2-dpapi-railway-handoff.ps1", import.meta.url),
);
const POWERSHELL_OUTPUT_PATH_ENV = "VENVIEWER_DPAPI_OUTPUT_PATH";
const POWERSHELL_RAILWAY_EXECUTABLE_ENV = "VENVIEWER_RAILWAY_EXECUTABLE";
const POWERSHELL_RAILWAY_PROJECT_ID_ENV = "VENVIEWER_RAILWAY_PROJECT_ID";
const POWERSHELL_RAILWAY_ENVIRONMENT_ID_ENV = "VENVIEWER_RAILWAY_ENVIRONMENT_ID";
const POWERSHELL_RAILWAY_SERVICE_ID_ENV = "VENVIEWER_RAILWAY_SERVICE_ID";
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

const PROTECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$stage = 1
try {
  $outputPath = [Environment]::GetEnvironmentVariable('${POWERSHELL_OUTPUT_PATH_ENV}', 'Process')
  if ([String]::IsNullOrWhiteSpace($outputPath) -or -not [IO.Path]::IsPathRooted($outputPath)) {
    throw 'Protected output path is unavailable.'
  }

  $stage = 2
  $inputStream = [Console]::OpenStandardInput()
  $memory = [IO.MemoryStream]::new()
  $memoryBacking = $null
  $plain = $null
  $protected = $null
  $header = $null
  $file = $null
  try {
    $inputStream.CopyTo($memory)
    $plain = $memory.ToArray()
    if ($plain.Length -eq 0) {
      throw 'Credential payload is empty.'
    }
    $stage = 3
    Add-Type -AssemblyName System.Security | Out-Null
    $protected = [Security.Cryptography.ProtectedData]::Protect(
      $plain,
      $null,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $stage = 4
    $header = [Convert]::FromBase64String('${DPAPI_ARTIFACT_HEADER_BASE64}')
    $file = [IO.FileStream]::new(
      $outputPath,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None
    )
    $file.Write($header, 0, $header.Length)
    $file.Write($protected, 0, $protected.Length)
    $file.Flush($true)
  } finally {
    if ($null -ne $file) {
      $file.Dispose()
    }
    try {
      $memoryBacking = $memory.GetBuffer()
      [Array]::Clear($memoryBacking, 0, $memoryBacking.Length)
    } catch { }
    $memory.Dispose()
    if ($null -ne $plain) {
      [Array]::Clear($plain, 0, $plain.Length)
    }
  }
} catch {
  [Environment]::Exit(40 + $stage)
}
`;

export class GrandHallR2DpapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrandHallR2DpapiError";
  }
}

function dpapiError(message: string): GrandHallR2DpapiError {
  return new GrandHallR2DpapiError(message);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function requiredWindowsRoot(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const root = env["SystemRoot"] ?? env["WINDIR"];
  if (
    root === undefined ||
    !win32.isAbsolute(root) ||
    root.trim() !== root ||
    hasControlCharacter(root)
  ) {
    throw dpapiError("Windows system root is unavailable for the DPAPI helper.");
  }
  return win32.resolve(root);
}

export function grandHallDpapiChildProcessBoundary(
  env: Readonly<Record<string, string | undefined>>,
  helperEnvironment: Readonly<Record<string, string>> = {},
  temporaryDirectory = tmpdir(),
): {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
} {
  const windowsRoot = requiredWindowsRoot(env);
  const rootMatch = /^([A-Za-z]:)[\\/]/u.exec(windowsRoot);
  if (rootMatch?.[1] === undefined) {
    throw dpapiError("Windows system drive is unavailable for the DPAPI helper.");
  }
  const systemDrive = rootMatch[1].toUpperCase();
  const configuredSystemDrive = env["SystemDrive"];
  if (
    configuredSystemDrive !== undefined &&
    configuredSystemDrive.toUpperCase() !== systemDrive
  ) {
    throw dpapiError("Windows system drive is inconsistent for the DPAPI helper.");
  }
  const configuredProgramData = env["ProgramData"];
  const programData = configuredProgramData ?? `${systemDrive}\\ProgramData`;
  if (
    !win32.isAbsolute(programData) ||
    win32.parse(programData).root.toUpperCase() !== `${systemDrive}\\`.toUpperCase() ||
    programData.trim() !== programData ||
    hasControlCharacter(programData)
  ) {
    throw dpapiError("Windows ProgramData is invalid for the DPAPI helper.");
  }
  if (!isAbsolute(temporaryDirectory)) {
    throw dpapiError("Windows temporary directory is invalid for the DPAPI helper.");
  }
  const childEnvironment: Record<string, string> = {
    ...helperEnvironment,
    SystemRoot: windowsRoot,
    WINDIR: windowsRoot,
    SystemDrive: systemDrive,
    ProgramData: win32.resolve(programData),
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory,
  };
  for (const name of [
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
  ] as const) {
    const value = env[name];
    if (
      value !== undefined &&
      value.length > 0 &&
      value.trim() === value &&
      !hasControlCharacter(value)
    ) {
      childEnvironment[name] = value;
    }
  }
  return { cwd: temporaryDirectory, env: childEnvironment };
}

function encodedPowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

type PowerShellInvocation = {
  readonly stdin: Buffer;
  readonly helperEnvironment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
} & (
  | { readonly script: string; readonly scriptFile?: never }
  | { readonly script?: never; readonly scriptFile: string }
);

async function runPrivatePowerShell(
  invocation: PowerShellInvocation,
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const windowsRoot = requiredWindowsRoot(env);
  const executable = join(
    windowsRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const boundary = grandHallDpapiChildProcessBoundary(
    env,
    invocation.helperEnvironment,
  );
  const commandArgs = invocation.scriptFile === undefined
    ? ["-EncodedCommand", encodedPowerShell(invocation.script)]
    : ["-File", resolve(invocation.scriptFile)];
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    ...commandArgs,
  ];

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: boundary.cwd,
      env: boundary.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    let outputBytes = 0;
    const rejectSafely = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      rejectPromise(dpapiError(
        "Windows DPAPI helper failed without exposing credential material.",
      ));
    };

    child.on("error", rejectSafely);
    child.stdin.on("error", rejectSafely);
    const countOutput = (chunk: Buffer): void => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_HELPER_OUTPUT_BYTES) rejectSafely();
    };
    child.stdout.on("data", countOutput);
    child.stderr.on("data", countOutput);
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0 || signal !== null || outputBytes !== 0) {
        rejectPromise(dpapiError(
          `Windows DPAPI helper failed without exposing credential material (exit ${String(code)}, output bytes ${String(outputBytes)}).`,
        ));
        return;
      }
      resolvePromise();
    });
    const timeout = setTimeout(rejectSafely, invocation.timeoutMs);
    try {
      child.stdin.end(invocation.stdin);
    } catch {
      rejectSafely();
    }
  });
}

function assertRailwayTargetIds(target: GrandHallR2RailwayTargetIds): void {
  for (const value of [target.projectId, target.environmentId, target.serviceId]) {
    if (!UUID_PATTERN.test(value)) {
      throw dpapiError(
        "Pinned Railway target identifiers must be canonical lowercase UUIDs.",
      );
    }
  }
}

export async function protectGrandHallR2CredentialWithCurrentUserDpapi(
  outputPath: string,
  plaintext: Buffer,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  rejectRetiredGrandHallV1Intake();
  if (!isAbsolute(outputPath)) {
    throw dpapiError("DPAPI output path must be absolute.");
  }
  if (plaintext.length === 0) {
    throw dpapiError("DPAPI credential payload must not be empty.");
  }
  await runPrivatePowerShell({
    script: PROTECT_SCRIPT,
    stdin: plaintext,
    helperEnvironment: {
      [POWERSHELL_OUTPUT_PATH_ENV]: resolve(outputPath),
    },
    timeoutMs: MAX_PROTECT_HELPER_RUNTIME_MS,
  }, env);
}

export async function stageGrandHallR2CredentialInRailwayWithCurrentUserDpapi(
  inputPath: string,
  railwayExecutable: string,
  target: GrandHallR2RailwayTargetIds,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  rejectRetiredGrandHallV1Intake();
  if (!isAbsolute(inputPath)) {
    throw dpapiError("DPAPI input path must be absolute.");
  }
  if (
    !isAbsolute(railwayExecutable) ||
    basename(railwayExecutable).toLowerCase() !== "railway.exe" ||
    railwayExecutable.trim() !== railwayExecutable ||
    hasControlCharacter(railwayExecutable)
  ) {
    throw dpapiError(
      "Railway executable must be an absolute native railway.exe path.",
    );
  }
  assertRailwayTargetIds(target);

  let artifact: Buffer;
  const handle = await open(resolve(inputPath), "r");
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size <= GRAND_HALL_R2_DPAPI_ARTIFACT_HEADER.length ||
      metadata.size > MAX_DPAPI_ARTIFACT_BYTES
    ) {
      throw dpapiError("DPAPI credential artifact is not a bounded regular file.");
    }
    artifact = await handle.readFile();
  } finally {
    await handle.close();
  }

  try {
    await runPrivatePowerShell({
      scriptFile: RAILWAY_HANDOFF_SCRIPT_PATH,
      stdin: artifact,
      helperEnvironment: {
        VENVIEWER_DPAPI_EXPECTED_HEADER_BASE64: DPAPI_ARTIFACT_HEADER_BASE64,
        VENVIEWER_DPAPI_EXPECTED_BUCKET: GRAND_HALL_STAGING_TARGET_ID,
        VENVIEWER_DPAPI_EXPECTED_PREFIX: GRAND_HALL_DEFAULT_OBJECT_PREFIX,
        VENVIEWER_DPAPI_RAILWAY_FIELD_1: GRAND_HALL_R2_RAILWAY_FIELDS[0],
        VENVIEWER_DPAPI_RAILWAY_FIELD_2: GRAND_HALL_R2_RAILWAY_FIELDS[1],
        VENVIEWER_DPAPI_RAILWAY_FIELD_3: GRAND_HALL_R2_RAILWAY_FIELDS[2],
        VENVIEWER_DPAPI_EXPECTED_RAILWAY_CLI_SHA256:
          GRAND_HALL_REVIEWED_RAILWAY_CLI_SHA256,
        VENVIEWER_DPAPI_EXPECTED_RAILWAY_CLI_VERSION:
          GRAND_HALL_REVIEWED_RAILWAY_CLI_VERSION,
        [POWERSHELL_RAILWAY_EXECUTABLE_ENV]: resolve(railwayExecutable),
        [POWERSHELL_RAILWAY_PROJECT_ID_ENV]: target.projectId,
        [POWERSHELL_RAILWAY_ENVIRONMENT_ID_ENV]: target.environmentId,
        [POWERSHELL_RAILWAY_SERVICE_ID_ENV]: target.serviceId,
      },
      timeoutMs: MAX_RAILWAY_HANDOFF_HELPER_RUNTIME_MS,
    }, env);
  } finally {
    artifact.fill(0);
  }
}

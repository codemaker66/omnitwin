import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  clearTimeout as clearScheduledTimeout,
  setTimeout as scheduleTimeout,
} from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "../../..");

export const REQUIRED_NODE_VERSION = "v22.18.0";
export const REQUIRED_PLATFORM = "win32";
export const REQUIRED_ARCH = "x64";
export const ESBUILD_VERSION = "0.25.0";
export const SHARP_NATIVE_VERSION = "0.34.5";
export const ENTRY_PATH = "tools/reconstruction-foundry/src/entry.ts";
export const LOCAL_HD_WORKER_GENERATED_SOURCE_PATH =
  "tools/reconstruction-foundry/src/local-hd-worker-manifest.generated.ts";
export const LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_SOURCE_PATH =
  "tools/reconstruction-foundry/src/local-e57-intake-environment.generated.ts";
export const BUNDLE_PATH = "foundry.mjs";
export const LEGAL_PATH = "foundry.mjs.LEGAL.txt";
export const BUILD_GRAPH_PATH = "build-graph.json";
export const RELEASE_MANIFEST_PATH = "release-manifest.json";
export const WINDOWS_LAUNCHER_PATH = "START-VENVIEWER-FOUNDRY.cmd";
export const START_HERE_PATH = "START-HERE.txt";
export const NODE_RUNTIME_PATH = "runtime/node.exe";
export const NODE_LICENSE_PATH = "runtime/LICENSE-node.rtf";
export const NODE_INSTALLER_SHA256 =
  "sha256:dffd8e34d8eb1a1a2e6f5e6f129c4b1b8a34aa54e02799007adc99d73efac75c";
export const BUNDLED_RELEASE_NULL_SOURCE_SHA256 =
  "sha256:11a12626a809230b4680d2026ac0790c7807cd1ea616f6fc3ebe64fcd5e5b393";

const TARGET = "node22.18";
const BUILD_GRAPH_SCHEMA_VERSION =
  "omnitwin.reconstruction-foundry.windows-x64-build-graph.v1";
const RELEASE_MANIFEST_SCHEMA_VERSION =
  "omnitwin.reconstruction-foundry.windows-x64-release-manifest.v1";
const CREATE_REQUIRE_BANNER =
  'import { createRequire as __omnitwinCreateRequire } from "node:module"; const require = __omnitwinCreateRequire(import.meta.url);';
const ESBUILD_BINARY_PATH =
  `node_modules/.pnpm/@esbuild+win32-x64@${ESBUILD_VERSION}/node_modules/@esbuild/win32-x64/esbuild.exe`;
const SHARP_NATIVE_ROOT =
  `node_modules/.pnpm/@img+sharp-win32-x64@${SHARP_NATIVE_VERSION}/node_modules/@img/sharp-win32-x64`;
const BUNDLED_RELEASE_SOURCE_PATH =
  "tools/reconstruction-foundry/src/local-offline-normalization-preview-bundled-release.generated.ts";
const BUNDLED_RELEASE_MODULE_PATH =
  "tools/reconstruction-foundry/src/local-offline-normalization-preview-bundled-release.ts";
const BUNDLED_RELEASE_PROBE_ENTRY_PATH =
  "tools/reconstruction-foundry/scripts/production-bundled-release-absence-probe.mjs";
const BUNDLED_RELEASE_PROBE_BUNDLE_NAME = "production-bundled-release-absence-probe.mjs";
const BUNDLED_RELEASE_PROBE_LEGAL_NAME = `${BUNDLED_RELEASE_PROBE_BUNDLE_NAME}.LEGAL.txt`;
const BUNDLED_RELEASE_PROBE_EXPECTED_STDOUT =
  "NO_DOCKER_QUALIFIED_BUNDLED_RELEASE\n";
const NODE_INSTALLER_PATH = resolve(
  homedir(),
  "Downloads",
  `node-${REQUIRED_NODE_VERSION}-x64.msi`,
);
const WINDOWS_POWERSHELL_PATH = resolve(
  parse(process.execPath).root,
  "Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
);
const NODE_INSTALLER_SIGNER_SUBJECT =
  "CN=OpenJS Foundation, O=OpenJS Foundation, L=San Francisco, S=California, C=US";
const NODE_INSTALLER_SIGNER_THUMBPRINT =
  "EAE583500C412290DF17D286ADCB1FAD1DB06971";
const TEMPORARY_PREFIX = ".foundry-windows-x64-release-";
const CHILD_KILL_CONFIRMATION_MS = 5_000;

export const CHILD_PROCESS_LIMITS = Object.freeze({
  powershellLicenseExtraction: Object.freeze({
    timeoutMs: 20_000,
    maxStdoutBytes: 4 * 1024 * 1024,
    maxStderrBytes: 1024 * 1024,
  }),
  esbuild: Object.freeze({
    timeoutMs: 120_000,
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 16 * 1024 * 1024,
  }),
  nodeVersion: Object.freeze({
    timeoutMs: 5_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
  }),
  smoke: Object.freeze({
    timeoutMs: 30_000,
    maxStdoutBytes: 4 * 1024 * 1024,
    maxStderrBytes: 4 * 1024 * 1024,
  }),
});

const BUNDLED_RELEASE_NULL_SOURCE_TEXT = [
  "/**",
  " * Build-owned input for the offline-preview sandbox release authority.",
  " *",
  " * There is deliberately no qualified release in this source tree. A release",
  " * build may replace this value with its generated, digest-bound manifest only",
  " * after Docker qualification evidence exists. Runtime callers cannot provide a",
  " * substitute value to the production lookup API.",
  " */",
  "export const LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_MANIFEST:",
  "  unknown = null;",
  "",
  "/**",
  " * Build-owned Ed25519 release-signing trust root. It remains absent whenever",
  " * the signed bundle above is absent. A production release generator must",
  " * replace both constants together; runtime input can replace neither.",
  " */",
  "export const LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_TRUST_ROOT:",
  "  unknown = null;",
  "",
].join("\n");

export const SOURCE_ALIASES = Object.freeze([
  Object.freeze({
    specifier: "@omnitwin/types/reconstruction-dsse",
    target: "packages/types/src/reconstruction-dsse.ts",
  }),
  Object.freeze({
    specifier: "@omnitwin/reconstruction-foundry",
    target: "packages/reconstruction-foundry/src/index.ts",
  }),
  Object.freeze({
    specifier: "@omnitwin/types",
    target: "packages/types/src/index.ts",
  }),
]);

export const SHARP_NATIVE_FILES = Object.freeze([
  "LICENSE",
  "README.md",
  "lib/libvips-42.dll",
  "lib/libvips-cpp-8.17.3.dll",
  "lib/sharp-win32-x64.node",
  "package.json",
  "versions.json",
]);

const SOURCE_ROOTS = Object.freeze([
  "tools/reconstruction-foundry/src/",
  "packages/reconstruction-foundry/src/",
  "packages/types/src/",
]);
const ALLOWED_SOURCE_DECLARATION =
  "packages/reconstruction-foundry/src/gltf-validator.d.ts";
const EMITTED_SOURCE_SUFFIXES = Object.freeze([
  ".d.ts",
  ".d.ts.map",
  ".js",
  ".js.map",
]);
const PNPM_ROOT = "node_modules/.pnpm/";
const FORBIDDEN_SOURCE_SEGMENTS = new Set(["__tests__", "dist", "support"]);
const TEST_FACTORY_PATTERN = /__testOnly[A-Za-z0-9_$]*/u;
const KNOWN_INTERNAL_OPTION_SEAMS = Object.freeze([
  "helperFactory",
  "offlineNormalizationPreviewTestHooks",
  "referenceVerificationTestHooks",
  "sourceHandleCloser",
]);
const SMALL_IO_FIELD = "testOnlyAllowSmallIo";
const SMALL_IO_PRODUCTION_REJECTION =
  "testOnlyAllowSmallIo is forbidden outside NODE_ENV=test.";
const REVIEWED_NON_BUILTIN_EXTERNALS = new Set([
  "@img/sharp-libvips-dev/cplusplus",
  "@img/sharp-libvips-dev/include",
  "@img/sharp-wasm32/versions",
]);
const BUILTIN_SPECIFIERS = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) =>
    specifier.startsWith("node:") ? specifier : `node:${specifier}`),
  // Experimental in the required Node release and omitted from builtinModules.
  "node:sqlite",
]);
const LIMITATIONS = Object.freeze([
  "This release proves deterministic packaging and byte custody only; it does not qualify production normalization.",
  "The bundled offline-normalization release manifest in current source remains null.",
  "Docker qualification was not authorized, run, or inferred by this builder.",
  "The smoke tests prove only that the scrubbed Windows runtime can load the CLI and native sharp package, and that a separately bundled production probe observes no bundled Docker-qualified release.",
  "No claim is made about legal rights, source truth, geometric accuracy, reconstruction quality, safety, or production suitability.",
  "Windows directory rename is the single best-available publication operation used here; strict atomic no-replace semantics and same-user race resistance are not established.",
  "The full published-tree re-read and re-hash is a point-in-time verification, not continuous tamper protection.",
  "The esbuild legal output and Sharp native LICENSE do not establish complete third-party licence closure for every pnpm input or approve commercial redistribution.",
  "The included Node executable is byte-bound to the initially inspected host file and the exact Node 22.18.0 MSI license text is included, but this package does not establish complete Node redistribution-notice closure.",
  "Builder, Node, esbuild, and source inputs are path-based: point-in-time before/after hashes do not establish stable-handle custody or resistance to a malicious same-user build-time swap-and-restore race.",
  "Node installer signature status and license extraction rely on the host Windows trust policy, Windows PowerShell, and read-only Windows Installer database COM APIs; this builder performs no independent Authenticode verification and executes no MSI installation or custom action.",
  "Every spawned PowerShell, direct esbuild executable, and Node process has fixed time and output bounds; a timed-out process must reach confirmed direct-child close after a kill request or the build fails and preserves its temporary handoff tree. This confirmation does not prove termination of descendants or Windows COM helpers. Abrupt builder or operating-system interruption can still prevent a handoff summary and leave temporary files or a process requiring operator review.",
  "The bundle audit rejects double-underscore test-only factory identifiers and reports four known internal option seams; it is not a comprehensive proof that no test seam exists.",
]);
export const FOUNDRY_CLOUD_ENVIRONMENT_VARIABLES = Object.freeze([
  "FOUNDRY_R2_ACCOUNT_ID",
  "FOUNDRY_R2_ACCESS_KEY_ID",
  "FOUNDRY_R2_SECRET_ACCESS_KEY",
  "FOUNDRY_R2_CANDIDATE_BUCKET",
  "R2_SESSION_TOKEN",
  "FOUNDRY_R2_ENDPOINT",
]);
const WINDOWS_LAUNCHER_LINES = Object.freeze([
  "@echo off",
  "setlocal DisableDelayedExpansion",
  "if \"%~1\"==\"\" goto :usage",
  "if not \"%~2\"==\"\" goto :too_many",
  "set \"FOUNDRY_SOURCE=%~f1\"",
  "if not exist \"%FOUNDRY_SOURCE%\" goto :missing_source",
  "set \"NODE_OPTIONS=\"",
  "set \"NODE_PATH=\"",
  "set \"NODE_ENV=production\"",
  ...FOUNDRY_CLOUD_ENVIRONMENT_VARIABLES.map((name) => `set "${name}="`),
  `set "FOUNDRY_NODE=%~dp0${NODE_RUNTIME_PATH.replaceAll("/", "\\")}"`,
  "if not exist \"%FOUNDRY_NODE%\" goto :node_missing",
  "set \"FOUNDRY_NODE_VERSION=\"",
  "for /f \"usebackq delims=\" %%V in (`\"%FOUNDRY_NODE%\" --version 2^>nul`) do set \"FOUNDRY_NODE_VERSION=%%V\"",
  `if not "%FOUNDRY_NODE_VERSION%"=="${REQUIRED_NODE_VERSION}" goto :node_required`,
  `"%FOUNDRY_NODE%" --disable-warning=ExperimentalWarning "%~dp0${BUNDLE_PATH}" local-app --source "%FOUNDRY_SOURCE%" --open`,
  "set \"FOUNDRY_EXIT_CODE=%ERRORLEVEL%\"",
  "if not \"%FOUNDRY_EXIT_CODE%\"==\"0\" echo Venviewer Foundry stopped with an error. Review the message above.",
  "exit /b %FOUNDRY_EXIT_CODE%",
  ":usage",
  `echo Drag exactly one local file or folder onto ${WINDOWS_LAUNCHER_PATH}.`,
  `echo Do not double-click the launcher. Read ${START_HERE_PATH} for the short guide.`,
  "exit /b 64",
  ":too_many",
  "echo Foundry did not start: drag exactly one local file or folder, not multiple items.",
  "exit /b 64",
  ":missing_source",
  "echo Foundry did not start: the dragged local file or folder cannot be found.",
  "exit /b 66",
  ":node_missing",
  "echo Foundry did not start: the included runtime\\node.exe is missing.",
  "exit /b 69",
  ":node_required",
  `echo Foundry did not start: included runtime\\node.exe --version must report exactly ${REQUIRED_NODE_VERSION}.`,
  "echo Replace this release with an intact verified copy, then try again.",
  "exit /b 69",
]);
const START_HERE_LINES = Object.freeze([
  "VENVIEWER RECONSTRUCTION FOUNDRY - WINDOWS RELEASE",
  "",
  "WHAT THIS RELEASE CAN DO",
  "This release can open one local source file or folder in the private Venviewer Foundry app on this computer. It can inspect and prepare local evidence using the controls exposed by that app. The launcher does not upload, publish, promote, or delete your source.",
  "",
  "HOW TO START",
  `1. Drag exactly one local file or folder onto ${WINDOWS_LAUNCHER_PATH}.`,
  "2. The launcher uses the private Node runtime included and byte-checked when this release was built; you do not need to install Node.",
  "3. The launcher opens the private local app in your browser. Keep the launcher window open while you use it.",
  "",
  "Normal Windows local paths, including paths with spaces, are supported. Paths containing control characters are not supported.",
  "",
  "HOW TO SAVE YOUR WORK",
  "Choose Download one complete file after the check finishes. That single JSON file contains the receipt, findings, evidence checklist, and any review, plan, or completed comparison from the current session.",
  "The one-file option is available for sources with 500 or fewer inspected files, and the completed JSON file must be no larger than 32 MiB.",
  "When you click, the app builds the file and reads the source again. Large local folders can take several seconds. If the source changed or the completed file is too large, nothing is saved.",
  "If you change any review or plan choices, build the updated review or plan first, then download the complete file again. This prevents an older choice from being saved by mistake. Separate downloads remain available when you need them.",
  "",
  "HOW TO STOP",
  "Choose Stop local session in the app, or press Ctrl+C in the launcher window. Closing only the browser tab may leave the local session running.",
  "",
  "WHAT STAYS LOCAL",
  "The app itself does not send the selected source to an online service. It only accepts connections from this computer.",
  `Before starting the app, the launcher removes these six Foundry cloud settings from the app's environment: ${FOUNDRY_CLOUD_ENVIRONMENT_VARIABLES.join(", ")}.`,
  "This is not local-disk proof: Windows may fetch source bytes if the selected path is mapped or cloud-backed. Files you save through the browser go to its Downloads location, which may be cloud-synced according to this computer's account settings.",
  "",
  "IMPORTANT LIMITS",
  "Docker transformation and production normalization authority are unavailable until they are separately qualified. This package does not perform that qualification, and the bundled normalization qualification manifest remains null.",
  "This package is deterministic release evidence, not proof of legal rights, source truth, geometric accuracy, reconstruction quality, safety, or production suitability.",
]);

export function windowsLauncherBytes() {
  return Buffer.from(`${WINDOWS_LAUNCHER_LINES.join("\r\n")}\r\n`, "utf8");
}

export function startHereBytes() {
  return Buffer.from(`${START_HERE_LINES.join("\r\n")}\r\n`, "utf8");
}

function fail(message, options = undefined) {
  const error = new Error(`Foundry Windows x64 production release build blocked: ${message}`);
  if (options?.temporaryHandoffRequired === true) {
    error.temporaryHandoffRequired = true;
  }
  if (typeof options?.childProcessDescription === "string") {
    error.childProcessDescription = options.childProcessDescription;
  }
  throw error;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical evidence contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail("canonical evidence contains an unsupported value");
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function systemErrorCode(error) {
  return isPlainObject(error) && typeof error.code === "string" ? error.code : null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function errorRequiresTemporaryHandoff(error) {
  return isPlainObject(error) && error.temporaryHandoffRequired === true;
}

async function settledAllOrThrow(promises) {
  const results = await Promise.allSettled(promises);
  const rejected = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === "rejected");
  if (rejected.length > 0) {
    const first = rejected[0].result.reason;
    const primary = first instanceof Error ? first : new Error(String(first));
    if (rejected.some(({ result }) =>
      errorRequiresTemporaryHandoff(result.reason))) {
      primary.temporaryHandoffRequired = true;
    }
    if (rejected.length > 1) {
      primary.message = `${primary.message} | Concurrent operations also failed: ${rejected
        .slice(1)
        .map(({ result, index }) => `${String(index)}=${errorMessage(result.reason)}`)
        .join("; ")}`;
    }
    throw primary;
  }
  return results.map(({ value }) => value);
}

function childFailureText(error) {
  if (error === null) return null;
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

export async function runBoundedChildProcess(options) {
  if (!isPlainObject(options) || typeof options.executable !== "string" ||
      !Array.isArray(options.args) ||
      options.args.some((argument) => typeof argument !== "string") ||
      typeof options.cwd !== "string" || typeof options.description !== "string" ||
      !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 ||
      !Number.isSafeInteger(options.maxStdoutBytes) || options.maxStdoutBytes <= 0 ||
      !Number.isSafeInteger(options.maxStderrBytes) || options.maxStderrBytes <= 0 ||
      !Number.isSafeInteger(options.killConfirmationMs) ||
      options.killConfirmationMs <= 0) {
    fail("bounded child-process options are malformed");
  }
  return await new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(options.executable, options.args, {
        cwd: options.cwd,
        env: {},
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolvePromise(Object.freeze({
        description: options.description,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        exitCode: null,
        signal: null,
        closeObserved: false,
        spawnError: childFailureText(error),
        stdoutError: null,
        stderrError: null,
        terminationReason: null,
        terminationRequested: false,
        terminationConfirmed: true,
        killRequestAccepted: null,
        killRequestError: null,
        temporaryHandoffRequired: false,
      }));
      return;
    }
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let spawnError = null;
    let stdoutError = null;
    let stderrError = null;
    let terminationReason = null;
    let killRequestAccepted = null;
    let killRequestError = null;
    let resolved = false;
    let timeoutHandle;
    let confirmationHandle;

    const finish = (exitCode, signal, closeObserved, noProcessStarted = false) => {
      if (resolved) return;
      resolved = true;
      if (timeoutHandle !== undefined) clearScheduledTimeout(timeoutHandle);
      if (confirmationHandle !== undefined) clearScheduledTimeout(confirmationHandle);
      const terminationRequested = terminationReason !== null;
      const terminationConfirmed = noProcessStarted ||
        !terminationRequested || closeObserved;
      resolvePromise(Object.freeze({
        description: options.description,
        stdout: Buffer.concat(stdoutChunks, stdoutBytes),
        stderr: Buffer.concat(stderrChunks, stderrBytes),
        exitCode,
        signal,
        closeObserved,
        spawnError,
        stdoutError,
        stderrError,
        terminationReason,
        terminationRequested,
        terminationConfirmed,
        killRequestAccepted,
        killRequestError,
        temporaryHandoffRequired: terminationRequested && !terminationConfirmed,
      }));
    };

    const requestTermination = (reason) => {
      if (resolved || terminationReason !== null) return;
      terminationReason = reason;
      try {
        killRequestAccepted = child.kill("SIGKILL");
      } catch (error) {
        killRequestError = childFailureText(error);
      }
      confirmationHandle = scheduleTimeout(() => {
        try {
          child.stdout?.destroy();
        } catch {
          // The unconfirmed direct child requires a preserved temporary handoff.
        }
        try {
          child.stderr?.destroy();
        } catch {
          // The unconfirmed direct child requires a preserved temporary handoff.
        }
        try {
          child.unref();
        } catch {
          // The unconfirmed direct child requires a preserved temporary handoff.
        }
        finish(null, null, false);
      }, options.killConfirmationMs);
    };

    const collect = (streamName, chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const isStdout = streamName === "stdout";
      const currentBytes = isStdout ? stdoutBytes : stderrBytes;
      const maximumBytes = isStdout
        ? options.maxStdoutBytes
        : options.maxStderrBytes;
      if (currentBytes + bytes.byteLength > maximumBytes) {
        requestTermination(`${streamName}_limit_exceeded`);
        return;
      }
      if (isStdout) {
        stdoutBytes += bytes.byteLength;
        stdoutChunks.push(bytes);
      } else {
        stderrBytes += bytes.byteLength;
        stderrChunks.push(bytes);
      }
    };

    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.stdout.once("error", (error) => {
      stdoutError = childFailureText(error);
      requestTermination("stdout_pipe_error");
    });
    child.stderr.once("error", (error) => {
      stderrError = childFailureText(error);
      requestTermination("stderr_pipe_error");
    });
    child.once("error", (error) => {
      spawnError = childFailureText(error);
      if (child.pid === undefined) {
        finish(null, null, false, true);
      } else {
        requestTermination("child_process_error");
      }
    });
    child.once("close", (exitCode, signal) => {
      finish(exitCode, signal, true);
    });
    timeoutHandle = scheduleTimeout(() => {
      requestTermination("timeout");
    }, options.timeoutMs);
  });
}

function boundedChildDiagnostic(result) {
  const stderr = result.stderr.toString("utf8").trim();
  return stderr === "" ? "" : `: ${stderr.slice(0, 4_096)}`;
}

function assertBoundedChildSucceeded(result) {
  if (result.spawnError !== null || result.stdoutError !== null ||
      result.stderrError !== null || result.terminationReason !== null ||
      result.closeObserved !== true || result.exitCode !== 0 || result.signal !== null) {
    const disposition = result.terminationReason === null
      ? ""
      : result.terminationConfirmed
        ? "; direct-child termination confirmed"
        : "; direct-child termination unconfirmed; temporary handoff required";
    fail(
      `${result.description} failed (exit=${String(result.exitCode)}, signal=${String(result.signal)}, ` +
        `termination=${String(result.terminationReason)}, spawn=${String(result.spawnError)}, ` +
        `stdoutPipe=${String(result.stdoutError)}, stderrPipe=${String(result.stderrError)}, ` +
        `killAccepted=${String(result.killRequestAccepted)}, killError=${String(result.killRequestError)}` +
        `)${disposition}${boundedChildDiagnostic(result)}`,
      {
        temporaryHandoffRequired: result.temporaryHandoffRequired,
        childProcessDescription: result.description,
      },
    );
  }
  return result;
}

function forwardSlash(value) {
  return value.replaceAll("\\", "/");
}

function arraysEqual(left, right) {
  return left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
}

function assertExactKeys(value, allowedKeys, description) {
  if (!isPlainObject(value)) fail(`${description} is not an object`);
  const actual = Object.keys(value).sort();
  const allowed = [...allowedKeys].sort();
  for (const key of actual) {
    if (!allowed.includes(key)) fail(`${description} contains unreviewed field: ${key}`);
  }
}

function repositoryPath(absolutePath) {
  const result = forwardSlash(relative(REPOSITORY_ROOT, absolutePath));
  if (result === "" || result === ".." || result.startsWith("../") || isAbsolute(result)) {
    fail("a required path escaped the repository root");
  }
  return result;
}

function normalizeRepositoryInputPath(inputPath) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    fail("metafile contains an empty input path");
  }
  const slashed = forwardSlash(inputPath);
  const normalized = isAbsolute(inputPath)
    ? repositoryPath(resolve(inputPath))
    : posix.normalize(slashed);
  if (normalized !== slashed || normalized === "." || normalized === ".." ||
      normalized.startsWith("../") || normalized.includes("//")) {
    fail(`metafile contains a non-canonical input path: ${inputPath}`);
  }
  return normalized;
}

export function assertAuditedSourceInputPath(inputPath) {
  const path = normalizeRepositoryInputPath(inputPath);
  if (path.startsWith(PNPM_ROOT)) return path;
  const sourceRoot = SOURCE_ROOTS.find((candidate) => path.startsWith(candidate));
  if (sourceRoot === undefined) fail(`unreviewed build input path: ${path}`);
  const sourceRelativePath = path.slice(sourceRoot.length);
  const segments = sourceRelativePath.split("/");
  if (segments.some((segment) => FORBIDDEN_SOURCE_SEGMENTS.has(segment))) {
    fail(`forbidden source directory in build graph: ${path}`);
  }
  if (/\.(?:test|spec)\.[^.]+$/u.test(path)) {
    fail(`test source present in build graph: ${path}`);
  }
  if (!path.endsWith(".ts")) {
    fail(`stale emitted or non-TypeScript source present in build graph: ${path}`);
  }
  return path;
}

export function assertNoEmittedSourceSiblings(paths) {
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) {
    fail("source-root inventory is malformed");
  }
  const emitted = paths.filter((path) =>
    path !== ALLOWED_SOURCE_DECLARATION &&
    EMITTED_SOURCE_SUFFIXES.some((suffix) => path.endsWith(suffix)));
  if (emitted.length > 0) {
    fail(`emitted source sibling is forbidden: ${emitted.sort()[0]}`);
  }
}

function normalizeImportRecord(record, description) {
  assertExactKeys(record, ["external", "kind", "original", "path"], description);
  if (typeof record.path !== "string" || typeof record.kind !== "string") {
    fail(`${description} has an invalid path or kind`);
  }
  const normalized = {
    path: record.external === true
      ? record.path
      : assertAuditedSourceInputPath(record.path),
    kind: record.kind,
    external: record.external === true,
    original: record.original ?? null,
  };
  if (normalized.original !== null && typeof normalized.original !== "string") {
    fail(`${description} has an invalid original specifier`);
  }
  return normalized;
}

function auditAliasResolution(importRecord, observations) {
  if (importRecord.original === null) return;
  const alias = SOURCE_ALIASES.find(({ specifier }) => specifier === importRecord.original);
  if (alias !== undefined) {
    if (importRecord.external || importRecord.path !== alias.target) {
      fail(`source alias did not resolve exactly to current source: ${alias.specifier}`);
    }
    observations.set(alias.specifier, (observations.get(alias.specifier) ?? 0) + 1);
    return;
  }
  if (SOURCE_ALIASES.some(({ specifier }) =>
    importRecord.original.startsWith(`${specifier}/`))) {
    fail(`unreviewed workspace package subpath: ${importRecord.original}`);
  }
}

function normalizeInputEntries(rawInputs, aliasObservations) {
  if (!isPlainObject(rawInputs)) fail("esbuild metafile inputs are invalid");
  return Object.entries(rawInputs).map(([rawPath, value]) => {
    const path = assertAuditedSourceInputPath(rawPath);
    assertExactKeys(value, ["bytes", "format", "imports"], `input ${path}`);
    if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || !Array.isArray(value.imports)) {
      fail(`input record is malformed: ${path}`);
    }
    const imports = value.imports.map((record, index) =>
      normalizeImportRecord(record, `import ${String(index)} from ${path}`));
    for (const importRecord of imports) auditAliasResolution(importRecord, aliasObservations);
    return {
      path,
      bytes: value.bytes,
      format: value.format ?? null,
      imports: imports.sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right), "en")),
    };
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function assertReviewedExternalSpecifier(specifier) {
  if (!BUILTIN_SPECIFIERS.has(specifier) &&
      !REVIEWED_NON_BUILTIN_EXTERNALS.has(specifier)) {
    fail(`unreviewed external runtime specifier: ${specifier}`);
  }
}

function normalizeOutputImport(record, description) {
  assertExactKeys(record, ["external", "kind", "path"], description);
  if (record.external !== true || typeof record.path !== "string" ||
      typeof record.kind !== "string") {
    fail(`${description} is not a reviewed external import`);
  }
  assertReviewedExternalSpecifier(record.path);
  return { path: record.path, kind: record.kind, external: true };
}

function normalizedOutputName(rawPath) {
  const name = posix.basename(forwardSlash(rawPath));
  if (name !== BUNDLE_PATH && name !== LEGAL_PATH) {
    fail(`esbuild emitted an unreviewed output: ${rawPath}`);
  }
  return name;
}

function normalizeOutputEntries(rawOutputs) {
  if (!isPlainObject(rawOutputs)) fail("esbuild metafile outputs are invalid");
  const outputs = Object.entries(rawOutputs).map(([rawPath, value]) => {
    const path = normalizedOutputName(rawPath);
    assertExactKeys(
      value,
      ["bytes", "entryPoint", "exports", "imports", "inputs"],
      `output ${path}`,
    );
    if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 ||
        !Array.isArray(value.imports) || !Array.isArray(value.exports) ||
        !isPlainObject(value.inputs)) {
      fail(`output record is malformed: ${path}`);
    }
    const imports = value.imports.map((record, index) =>
      normalizeOutputImport(record, `output import ${String(index)} from ${path}`));
    const inputs = Object.entries(value.inputs).map(([inputPath, contribution]) => {
      assertExactKeys(contribution, ["bytesInOutput"], `output contribution ${inputPath}`);
      if (!Number.isSafeInteger(contribution.bytesInOutput) ||
          contribution.bytesInOutput < 0) {
        fail(`output contribution is malformed: ${inputPath}`);
      }
      return {
        path: assertAuditedSourceInputPath(inputPath),
        bytesInOutput: contribution.bytesInOutput,
      };
    }).sort((left, right) => left.path.localeCompare(right.path, "en"));
    return {
      path,
      bytes: value.bytes,
      entryPoint: value.entryPoint === undefined
        ? null
        : assertAuditedSourceInputPath(value.entryPoint),
      exports: [...value.exports].sort(),
      imports: imports.sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right), "en")),
      inputs,
    };
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
  const names = outputs.map(({ path }) => path);
  if (!arraysEqual(names, [BUNDLE_PATH, LEGAL_PATH].sort())) {
    fail("esbuild did not emit exactly the bundle and third-party legal output");
  }
  const bundle = outputs.find(({ path }) => path === BUNDLE_PATH);
  const legal = outputs.find(({ path }) => path === LEGAL_PATH);
  if (bundle?.entryPoint !== ENTRY_PATH || bundle.exports.length !== 0 ||
      legal?.entryPoint !== null || legal.exports.length !== 0 ||
      legal.imports.length !== 0 || legal.inputs.length !== 0) {
    fail("esbuild output graph differs from the reviewed entry/legal shape");
  }
  return outputs;
}

export function auditAndNormalizeMetafile(rawMetafile) {
  assertExactKeys(rawMetafile, ["inputs", "outputs"], "esbuild metafile");
  const aliasObservations = new Map();
  const inputs = normalizeInputEntries(rawMetafile.inputs, aliasObservations);
  const outputs = normalizeOutputEntries(rawMetafile.outputs);
  for (const alias of SOURCE_ALIASES) {
    if ((aliasObservations.get(alias.specifier) ?? 0) === 0) {
      fail(`required current-source alias was not observed: ${alias.specifier}`);
    }
  }
  if (!inputs.some(({ path }) => path === ENTRY_PATH)) fail("entry source is absent");
  if (!inputs.some(({ path }) => path === BUNDLED_RELEASE_SOURCE_PATH)) {
    fail("null bundled-release source is absent from the audited graph");
  }
  if (!inputs.some(({ path }) => path === LOCAL_HD_WORKER_GENERATED_SOURCE_PATH)) {
    fail("build-owned HD worker generated source is absent from the audited graph");
  }
  if (!inputs.some(
    ({ path }) => path === LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_SOURCE_PATH,
  )) {
    fail("build-owned E57 environment generated source is absent from the audited graph");
  }
  const bundleOutput = outputs.find(({ path }) => path === BUNDLE_PATH);
  const e57EnvironmentContribution = bundleOutput?.inputs.find(
    ({ path }) => path === LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_SOURCE_PATH,
  );
  if (
    e57EnvironmentContribution === undefined ||
    e57EnvironmentContribution.bytesInOutput <= 0
  ) {
    fail(
      "build-owned E57 environment generated source contributes no bytes to foundry.mjs",
    );
  }
  return Object.freeze({
    entryPoint: ENTRY_PATH,
    aliases: SOURCE_ALIASES,
    inputs,
    outputs,
  });
}

function assertProductionProbeInputPath(inputPath) {
  const path = normalizeRepositoryInputPath(inputPath);
  return path === BUNDLED_RELEASE_PROBE_ENTRY_PATH
    ? path
    : assertAuditedSourceInputPath(path);
}

function normalizeProductionProbeImport(record, description, aliasObservations) {
  assertExactKeys(record, ["external", "kind", "original", "path"], description);
  if (typeof record.path !== "string" || typeof record.kind !== "string") {
    fail(`${description} has an invalid path or kind`);
  }
  const normalized = {
    path: record.external === true
      ? record.path
      : assertProductionProbeInputPath(record.path),
    kind: record.kind,
    external: record.external === true,
    original: record.original ?? null,
  };
  if (normalized.original !== null && typeof normalized.original !== "string") {
    fail(`${description} has an invalid original specifier`);
  }
  auditAliasResolution(normalized, aliasObservations);
  return normalized;
}

function auditAndNormalizeProductionProbeMetafile(rawMetafile) {
  assertExactKeys(rawMetafile, ["inputs", "outputs"], "production probe metafile");
  if (!isPlainObject(rawMetafile.inputs) || !isPlainObject(rawMetafile.outputs)) {
    fail("production probe metafile inputs or outputs are invalid");
  }
  const aliasObservations = new Map();
  const inputs = Object.entries(rawMetafile.inputs).map(([rawPath, value]) => {
    const path = assertProductionProbeInputPath(rawPath);
    assertExactKeys(value, ["bytes", "format", "imports"], `production probe input ${path}`);
    if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || !Array.isArray(value.imports)) {
      fail(`production probe input record is malformed: ${path}`);
    }
    const imports = value.imports.map((record, index) =>
      normalizeProductionProbeImport(
        record,
        `production probe import ${String(index)} from ${path}`,
        aliasObservations,
      ));
    return {
      path,
      bytes: value.bytes,
      format: value.format ?? null,
      imports: imports.sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right), "en")),
    };
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
  const outputs = Object.entries(rawMetafile.outputs).map(([rawPath, value]) => {
    const path = posix.basename(forwardSlash(rawPath));
    if (path !== BUNDLED_RELEASE_PROBE_BUNDLE_NAME &&
        path !== BUNDLED_RELEASE_PROBE_LEGAL_NAME) {
      fail(`production probe emitted an unreviewed output: ${rawPath}`);
    }
    assertExactKeys(
      value,
      ["bytes", "entryPoint", "exports", "imports", "inputs"],
      `production probe output ${path}`,
    );
    if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 ||
        !Array.isArray(value.imports) || !Array.isArray(value.exports) ||
        !isPlainObject(value.inputs)) {
      fail(`production probe output record is malformed: ${path}`);
    }
    const imports = value.imports.map((record, index) =>
      normalizeOutputImport(record, `production probe output import ${String(index)} from ${path}`));
    const contributions = Object.entries(value.inputs).map(([inputPath, contribution]) => {
      assertExactKeys(
        contribution,
        ["bytesInOutput"],
        `production probe output contribution ${inputPath}`,
      );
      if (!Number.isSafeInteger(contribution.bytesInOutput) ||
          contribution.bytesInOutput < 0) {
        fail(`production probe output contribution is malformed: ${inputPath}`);
      }
      return {
        path: assertProductionProbeInputPath(inputPath),
        bytesInOutput: contribution.bytesInOutput,
      };
    }).sort((left, right) => left.path.localeCompare(right.path, "en"));
    return {
      path,
      bytes: value.bytes,
      entryPoint: value.entryPoint === undefined
        ? null
        : assertProductionProbeInputPath(value.entryPoint),
      exports: [...value.exports].sort(),
      imports: imports.sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right), "en")),
      inputs: contributions,
    };
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (!inputs.some(({ path }) => path === BUNDLED_RELEASE_PROBE_ENTRY_PATH) ||
      !inputs.some(({ path }) => path === BUNDLED_RELEASE_MODULE_PATH) ||
      !inputs.some(({ path }) => path === BUNDLED_RELEASE_SOURCE_PATH)) {
    fail("production probe graph does not bind the exact entry, lookup, and generated source");
  }
  const names = outputs.map(({ path }) => path);
  if (!arraysEqual(
    names,
    [BUNDLED_RELEASE_PROBE_BUNDLE_NAME, BUNDLED_RELEASE_PROBE_LEGAL_NAME].sort(),
  )) {
    fail("production probe did not emit exactly its bundle and legal output");
  }
  const bundle = outputs.find(({ path }) => path === BUNDLED_RELEASE_PROBE_BUNDLE_NAME);
  const legal = outputs.find(({ path }) => path === BUNDLED_RELEASE_PROBE_LEGAL_NAME);
  if (bundle?.entryPoint !== BUNDLED_RELEASE_PROBE_ENTRY_PATH ||
      bundle.exports.length !== 0 || legal?.entryPoint !== null ||
      legal.exports.length !== 0 || legal.imports.length !== 0 || legal.inputs.length !== 0) {
    fail("production probe output graph differs from the reviewed shape");
  }
  return Object.freeze({
    entryPoint: BUNDLED_RELEASE_PROBE_ENTRY_PATH,
    aliases: SOURCE_ALIASES,
    inputs,
    outputs,
  });
}

export function auditBundleText(bundleText) {
  if (typeof bundleText !== "string") fail("bundle audit input is not text");
  const testFactory = TEST_FACTORY_PATTERN.exec(bundleText)?.[0];
  if (testFactory !== undefined) fail(`test-only factory symbol in bundle: ${testFactory}`);
  const smallIoPresent = bundleText.includes(SMALL_IO_FIELD);
  if (smallIoPresent && !bundleText.includes(SMALL_IO_PRODUCTION_REJECTION)) {
    fail("small-I/O test field is present without its production rejection");
  }
  const knownInternalOptionSeams = KNOWN_INTERNAL_OPTION_SEAMS.map((symbol) =>
    Object.freeze({
      symbol,
      present: bundleText.includes(symbol),
      disposition:
        "internal option name retained; the CLI accepts no corresponding flag and the entry bundle exports no API",
    }));
  return Object.freeze({
    knownDoubleUnderscoreTestOnlyFactorySymbolsPresent: false,
    testOnlyAllowSmallIoPresent: smallIoPresent,
    testOnlyAllowSmallIoProductionDisposition: smallIoPresent
      ? "NODE_ENV is defined as production; any true value is rejected before use"
      : "not present",
    knownInternalOptionSeams,
    comprehensiveNoTestSeamProof: false,
  });
}

export function assertDeterministicEsbuildOutputs(first, second) {
  if (!Buffer.isBuffer(first.bundle) || !Buffer.isBuffer(second.bundle) ||
      !Buffer.isBuffer(first.legal) || !Buffer.isBuffer(second.legal)) {
    fail("determinism comparison requires bundle and legal byte buffers");
  }
  if (!first.bundle.equals(second.bundle)) {
    fail("two fresh sibling builds emitted different foundry.mjs bytes");
  }
  if (!first.legal.equals(second.legal)) {
    fail("two fresh sibling builds emitted different third-party legal bytes");
  }
  if (canonicalJson(first.graph) !== canonicalJson(second.graph)) {
    fail("two fresh sibling builds emitted different normalized graphs");
  }
}

export function assertNativeRuntimeInventory(inventory) {
  if (!isPlainObject(inventory) || !Array.isArray(inventory.files) ||
      !Array.isArray(inventory.directories)) {
    fail("sharp native runtime inventory is malformed");
  }
  const files = [...inventory.files].sort();
  const directories = [...inventory.directories].sort();
  if (!arraysEqual(files, [...SHARP_NATIVE_FILES].sort()) ||
      !arraysEqual(directories, ["lib"])) {
    fail("@img/sharp-win32-x64 runtime differs from the exact reviewed allowlist");
  }
}

async function requireRegularFile(absolutePath, description) {
  let status;
  try {
    status = await lstat(absolutePath);
  } catch (error) {
    fail(`${description} cannot be read (${systemErrorCode(error) ?? "unknown error"})`);
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    fail(`${description} is not a regular non-symlink file`);
  }
  return status;
}

async function fileRecord(absolutePath, path) {
  const status = await requireRegularFile(absolutePath, path);
  const bytes = await readFile(absolutePath);
  if (bytes.byteLength !== status.size) fail(`file changed while hashing: ${path}`);
  const record = Object.freeze({ path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) });
  bytes.fill(0);
  return record;
}

async function identityFileBytes(absolutePath, path) {
  const before = await requireRegularFile(absolutePath, path);
  const bytes = await readFile(absolutePath);
  const after = await requireRegularFile(absolutePath, path);
  if (bytes.byteLength !== before.size || before.dev !== after.dev || before.ino !== after.ino ||
      before.birthtimeMs !== after.birthtimeMs || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs) {
    bytes.fill(0);
    fail(`file identity changed while hashing: ${path}`);
  }
  return Object.freeze({
    bytes,
    record: Object.freeze({
      path,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      identity: Object.freeze({
        dev: after.dev,
        ino: after.ino,
        birthtimeMs: after.birthtimeMs,
        mtimeMs: after.mtimeMs,
      }),
    }),
  });
}

async function identityFileRecord(absolutePath, path) {
  const held = await identityFileBytes(absolutePath, path);
  held.bytes.fill(0);
  return held.record;
}

export function assertBuilderInputsUnchanged(initialRecords, finalRecords) {
  if (canonicalJson(initialRecords) !== canonicalJson(finalRecords)) {
    fail("builder/runtime/esbuild input bytes or file identity changed during the build");
  }
}

async function repositoryInputRecords(inputs) {
  const records = [];
  for (const input of inputs) {
    const absolutePath = resolve(REPOSITORY_ROOT, input.path);
    if (repositoryPath(absolutePath) !== input.path) fail(`non-canonical input: ${input.path}`);
    const record = await fileRecord(absolutePath, input.path);
    if (record.sizeBytes !== input.bytes) fail(`metafile byte count mismatch: ${input.path}`);
    records.push(record);
  }
  return records;
}

function validatedRepositoryInputRecord(record, description) {
  assertExactKeys(record, ["path", "sha256", "sizeBytes"], description);
  if (typeof record.path !== "string" || record.path.length === 0 ||
      !Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 0 ||
      typeof record.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.sha256)) {
    fail(`${description} is malformed`);
  }
  return Object.freeze({
    path: record.path,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
  });
}

function repositoryRecordMap(records, description) {
  if (!Array.isArray(records)) fail(`${description} is not an array`);
  const map = new Map();
  for (const [index, rawRecord] of records.entries()) {
    const record = validatedRepositoryInputRecord(
      rawRecord,
      `${description} record ${String(index)}`,
    );
    if (map.has(record.path)) fail(`${description} repeats input path: ${record.path}`);
    map.set(record.path, record);
  }
  return map;
}

export function reconcileRepositoryInputRecords(recordSets) {
  if (!Array.isArray(recordSets) || recordSets.length === 0) {
    fail("source/dependency reconciliation requires at least one input-record set");
  }
  const union = new Map();
  for (const [setIndex, records] of recordSets.entries()) {
    const recordMap = repositoryRecordMap(records, `input-record set ${String(setIndex)}`);
    for (const [path, record] of recordMap) {
      const existing = union.get(path);
      if (existing !== undefined && canonicalJson(existing) !== canonicalJson(record)) {
        fail(`shared main/probe source or dependency record differs: ${path}`);
      }
      union.set(path, record);
    }
  }
  return Object.freeze([...union.values()].sort((left, right) =>
    left.path.localeCompare(right.path, "en")));
}

export function assertSharedRepositoryInputsEqual(mainRecords, probeRecords, description) {
  if (typeof description !== "string" || description.length === 0) {
    fail("shared main/probe input comparison requires a description");
  }
  const main = repositoryRecordMap(mainRecords, `${description} main inputs`);
  const probe = repositoryRecordMap(probeRecords, `${description} probe inputs`);
  const sharedPaths = [...main.keys()]
    .filter((path) => probe.has(path))
    .sort((left, right) => left.localeCompare(right, "en"));
  for (const path of [BUNDLED_RELEASE_SOURCE_PATH, BUNDLED_RELEASE_MODULE_PATH]) {
    if (!sharedPaths.includes(path)) {
      fail(`${description} does not share required bundled-release input: ${path}`);
    }
  }
  for (const path of sharedPaths) {
    if (canonicalJson(main.get(path)) !== canonicalJson(probe.get(path))) {
      fail(`${description} shared source or dependency differs: ${path}`);
    }
  }
  const sharedRecords = sharedPaths.map((path) => main.get(path));
  return Object.freeze({
    description,
    sharedInputCount: sharedRecords.length,
    sharedRecordsSha256: sha256(canonicalBytes(sharedRecords)),
  });
}

export function assertRepositoryInputRecordsUnchanged(heldRecords, rehashedRecords, description) {
  if (typeof description !== "string" || description.length === 0) {
    fail("source/dependency input rehash comparison requires a description");
  }
  const held = reconcileRepositoryInputRecords([heldRecords]);
  const rehashed = reconcileRepositoryInputRecords([rehashedRecords]);
  if (canonicalJson(held) !== canonicalJson(rehashed)) {
    fail(`${description} source/dependency input records changed during final rehash`);
  }
}

async function rehashRepositoryInputRecords(expectedRecords) {
  const expected = reconcileRepositoryInputRecords([expectedRecords]);
  const actual = [];
  for (const record of expected) {
    actual.push(await fileRecord(resolve(REPOSITORY_ROOT, record.path), record.path));
  }
  assertRepositoryInputRecordsUnchanged(expected, actual, "prepublication main/probe union");
  return Object.freeze({
    inputCount: actual.length,
    recordsSha256: sha256(canonicalBytes(actual)),
  });
}

async function walkRegularTree(root) {
  const files = [];
  const directories = [];
  async function visit(absoluteDirectory, relativeDirectory) {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relativePath = relativeDirectory === ""
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      const absolutePath = join(absoluteDirectory, entry.name);
      const status = await lstat(absolutePath);
      if (status.isSymbolicLink()) fail(`symbolic link is forbidden in tree: ${relativePath}`);
      if (status.isDirectory()) {
        directories.push(relativePath);
        await visit(absolutePath, relativePath);
      } else if (status.isFile()) {
        files.push(relativePath);
      } else {
        fail(`non-regular tree entry is forbidden: ${relativePath}`);
      }
    }
  }
  await visit(root, "");
  return { files, directories };
}

async function inspectSharpNativeRuntime() {
  const root = resolve(REPOSITORY_ROOT, SHARP_NATIVE_ROOT);
  const rootStatus = await lstat(root);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    fail("local @img/sharp-win32-x64 package root is not a regular directory");
  }
  const inventory = await walkRegularTree(root);
  assertNativeRuntimeInventory(inventory);
  const packageBytes = await readFile(join(root, "package.json"));
  const packageJson = JSON.parse(packageBytes.toString("utf8"));
  packageBytes.fill(0);
  if (!isPlainObject(packageJson) || packageJson.name !== "@img/sharp-win32-x64" ||
      packageJson.version !== SHARP_NATIVE_VERSION ||
      !arraysEqual(packageJson.os ?? [], ["win32"]) ||
      !arraysEqual(packageJson.cpu ?? [], ["x64"])) {
    fail("local sharp native package identity/platform is not exact");
  }
  const records = [];
  for (const path of SHARP_NATIVE_FILES) {
    records.push(await fileRecord(join(root, ...path.split("/")), path));
  }
  return Object.freeze({ root, records });
}

async function copySharpNativeRuntime(source, releaseDirectory) {
  const destination = join(releaseDirectory, "node_modules", "@img", "sharp-win32-x64");
  await mkdir(join(destination, "lib"), { recursive: true });
  for (const path of SHARP_NATIVE_FILES) {
    await copyFile(
      join(source.root, ...path.split("/")),
      join(destination, ...path.split("/")),
    );
  }
  const inventory = await walkRegularTree(destination);
  assertNativeRuntimeInventory(inventory);
  const destinationRecords = [];
  for (const path of SHARP_NATIVE_FILES) {
    destinationRecords.push(await fileRecord(
      join(destination, ...path.split("/")),
      path,
    ));
  }
  if (canonicalJson(destinationRecords) !== canonicalJson(source.records)) {
    fail("copied sharp native runtime differs from the inspected source bytes");
  }
}

function nodeRuntimeSourceRecord(builderRecords) {
  const record = builderRecords.find(({ path }) => path === "host/node.exe");
  if (record === undefined) fail("initial audited Node runtime record is missing");
  return record;
}

async function copyNodeRuntime(initialRecord, releaseDirectory) {
  const destination = join(releaseDirectory, ...NODE_RUNTIME_PATH.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(process.execPath, destination);
  const destinationRecord = await fileRecord(destination, NODE_RUNTIME_PATH);
  if (destinationRecord.sizeBytes !== initialRecord.sizeBytes ||
      destinationRecord.sha256 !== initialRecord.sha256) {
    fail("copied Node runtime differs from the initially inspected host bytes");
  }
  const result = assertBoundedChildSucceeded(await runBoundedChildProcess({
    executable: destination,
    args: ["--version"],
    cwd: releaseDirectory,
    description: "copied Node runtime version check",
    ...CHILD_PROCESS_LIMITS.nodeVersion,
    killConfirmationMs: CHILD_KILL_CONFIRMATION_MS,
  }));
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");
  if (stdout.trim() !== REQUIRED_NODE_VERSION || stderr !== "") {
    fail("copied Node runtime version output is not exact");
  }
  return destinationRecord;
}

function initialBuilderRecord(builderRecords, path) {
  const record = builderRecords.find((candidate) => candidate.path === path);
  if (record === undefined) fail(`initial audited builder record is missing: ${path}`);
  return record;
}

async function inspectExactNodeLicense(initialBuilders) {
  const installerRecord = initialBuilderRecord(initialBuilders, "host/node-installer.msi");
  if (installerRecord.sha256 !== NODE_INSTALLER_SHA256) {
    fail(`local Node ${REQUIRED_NODE_VERSION} MSI digest is not the exact reviewed digest`);
  }
  const installerPathBase64 = Buffer.from(NODE_INSTALLER_PATH, "utf16le").toString("base64");
  const script = [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    `$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${installerPathBase64}'))`,
    "$installer=New-Object -ComObject WindowsInstaller.Installer",
    "$signature=Get-AuthenticodeSignature -LiteralPath $p",
    "$timestampSubject=if($null -eq $signature.TimeStamperCertificate){$null}else{$signature.TimeStamperCertificate.Subject}",
    "$timestampThumbprint=if($null -eq $signature.TimeStamperCertificate){$null}else{$signature.TimeStamperCertificate.Thumbprint}",
    "$db=$installer.OpenDatabase($p,0)",
    "$versionView=$db.OpenView(\"SELECT `Value` FROM `Property` WHERE `Property`='ProductVersion'\")",
    "$versionView.Execute()",
    "$versionRecord=$versionView.Fetch()",
    "if($null -eq $versionRecord){throw 'Node MSI ProductVersion is absent'}",
    "$version=$versionRecord.StringData(1)",
    "$versionView.Close()",
    "$licenseView=$db.OpenView(\"SELECT `Text` FROM `Control` WHERE `Dialog_`='LicenseAgreementDlg' AND `Control`='LicenseText'\")",
    "$licenseView.Execute()",
    "$licenseRecord=$licenseView.Fetch()",
    "if($null -eq $licenseRecord){throw 'Node MSI license text is absent'}",
    "$license=$licenseRecord.StringData(1)",
    "$licenseView.Close()",
    "$utf8=[Text.UTF8Encoding]::new($false).GetBytes($license)",
    "$result=[ordered]@{productVersion=$version;signatureStatus=[string]$signature.Status;signerSubject=$signature.SignerCertificate.Subject;signerThumbprint=$signature.SignerCertificate.Thumbprint;timestampSubject=$timestampSubject;timestampThumbprint=$timestampThumbprint;licenseUtf8Base64=[Convert]::ToBase64String($utf8)}",
    "[Console]::Out.Write(($result|ConvertTo-Json -Compress))",
  ].join(";");
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  const result = assertBoundedChildSucceeded(await runBoundedChildProcess({
    executable: WINDOWS_POWERSHELL_PATH,
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
    cwd: REPOSITORY_ROOT,
    description: `exact Node ${REQUIRED_NODE_VERSION} MSI license extraction`,
    ...CHILD_PROCESS_LIMITS.powershellLicenseExtraction,
    killConfirmationMs: CHILD_KILL_CONFIRMATION_MS,
  }));
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");
  if (stderr !== "") {
    fail(`Node MSI license extraction wrote unexpected stderr: ${stderr.trim()}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    fail("Node MSI license extraction did not return canonical evidence");
  }
  if (!isPlainObject(parsed) || parsed.productVersion !== REQUIRED_NODE_VERSION.slice(1) ||
      parsed.signatureStatus !== "Valid" ||
      parsed.signerSubject !== NODE_INSTALLER_SIGNER_SUBJECT ||
      parsed.signerThumbprint !== NODE_INSTALLER_SIGNER_THUMBPRINT ||
      typeof parsed.timestampSubject !== "string" || parsed.timestampSubject.length === 0 ||
      typeof parsed.timestampThumbprint !== "string" ||
      !/^[A-F0-9]{40}$/u.test(parsed.timestampThumbprint) ||
      typeof parsed.licenseUtf8Base64 !== "string") {
    fail("Node MSI identity or extracted license record is not exact");
  }
  const bytes = Buffer.from(parsed.licenseUtf8Base64, "base64");
  if (bytes.toString("base64") !== parsed.licenseUtf8Base64 ||
      bytes.byteLength < 10_000 || bytes.byteLength > 2 * 1024 * 1024 ||
      !bytes.subarray(0, 6).equals(Buffer.from("{\\rtf1", "utf8")) ||
      !bytes.includes(Buffer.from("Node.js is licensed for use as follows:", "utf8"))) {
    bytes.fill(0);
    fail("Node MSI license text is malformed or incomplete");
  }
  return Object.freeze({
    bytes,
    installer: installerRecord,
    authenticode: Object.freeze({
      status: parsed.signatureStatus,
      signerSubject: parsed.signerSubject,
      signerThumbprint: parsed.signerThumbprint,
      timestampSubject: parsed.timestampSubject,
      timestampThumbprint: parsed.timestampThumbprint,
      verification: "host_windows_get_authenticode_signature",
      independentlyVerifiedByBuilder: false,
    }),
    extraction: Object.freeze({
      executable: initialBuilderRecord(initialBuilders, "host/windows-powershell.exe"),
      mechanism: "read_only_windows_installer_database_com_query",
      databaseOpenMode: 0,
      table: "Control",
      row: Object.freeze({ Dialog_: "LicenseAgreementDlg", Control: "LicenseText" }),
      msiInstallationOrCustomActionsExecuted: false,
    }),
    record: Object.freeze({
      path: `host/node-${REQUIRED_NODE_VERSION}-x64.msi#Control/LicenseAgreementDlg/LicenseText:utf8`,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      sourceFormat: "windows_installer_control_table_rtf_reencoded_utf8_without_bom",
    }),
  });
}

async function copyNodeLicense(source, releaseDirectory) {
  const destination = join(releaseDirectory, ...NODE_LICENSE_PATH.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, source.bytes, { flag: "wx", mode: 0o444 });
  const destinationRecord = await fileRecord(destination, NODE_LICENSE_PATH);
  if (destinationRecord.sizeBytes !== source.record.sizeBytes ||
      destinationRecord.sha256 !== source.record.sha256) {
    fail("included Node license differs from the exact locally extracted MSI license bytes");
  }
  return destinationRecord;
}

async function assertSourceRootsClean() {
  const files = [];
  for (const root of SOURCE_ROOTS) {
    const rootPath = root.slice(0, -1);
    const inventory = await walkRegularTree(resolve(REPOSITORY_ROOT, rootPath));
    files.push(...inventory.files.map((path) => `${rootPath}/${path}`));
  }
  assertNoEmittedSourceSiblings(files);
}

async function writeHumanStartFiles(releaseDirectory) {
  const launcher = windowsLauncherBytes();
  const startHere = startHereBytes();
  try {
    await settledAllOrThrow([
      writeFile(join(releaseDirectory, WINDOWS_LAUNCHER_PATH), launcher, {
        flag: "wx",
        mode: 0o555,
      }),
      writeFile(join(releaseDirectory, START_HERE_PATH), startHere, {
        flag: "wx",
        mode: 0o444,
      }),
    ]);
  } finally {
    launcher.fill(0);
    startHere.fill(0);
  }
}

export function validateOutputPathShape(outputDirectory) {
  if (typeof outputDirectory !== "string" || outputDirectory.length === 0 ||
      !isAbsolute(outputDirectory)) {
    fail("output directory must be an absolute path");
  }
  if (normalize(outputDirectory) !== outputDirectory ||
      resolve(outputDirectory) !== outputDirectory ||
      (outputDirectory.endsWith(sep) && dirname(outputDirectory) !== outputDirectory)) {
    fail("output directory must be canonical and normalized");
  }
  return outputDirectory;
}

async function assertOutputAvailable(outputDirectory) {
  validateOutputPathShape(outputDirectory);
  try {
    await lstat(outputDirectory);
    fail("output directory already exists");
  } catch (error) {
    if (systemErrorCode(error) !== "ENOENT") throw error;
  }
  const parent = dirname(outputDirectory);
  const status = await lstat(parent);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    fail("output parent must be an existing regular non-symlink directory");
  }
  const canonicalParent = await realpath(parent);
  if (canonicalParent !== parent) fail("output parent is not its canonical real path");
  return Object.freeze({ parent, dev: status.dev, ino: status.ino });
}

function assertSameParent(first, second) {
  if (first.parent !== second.parent || first.dev !== second.dev || first.ino !== second.ino) {
    fail("output parent identity changed during the build");
  }
}

function esbuildAliasArguments() {
  return SOURCE_ALIASES.map(({ specifier, target }) =>
    `--alias:${specifier}=${resolve(REPOSITORY_ROOT, target)}`);
}

function esbuildArguments(releaseDirectory, metafilePath) {
  return [
    ENTRY_PATH,
    "--bundle",
    "--platform=node",
    `--target=${TARGET}`,
    "--format=esm",
    "--minify",
    "--tree-shaking=true",
    "--legal-comments=external",
    `--banner:js=${CREATE_REQUIRE_BANNER}`,
    '--define:process.env.NODE_ENV="production"',
    ...esbuildAliasArguments(),
    `--outfile=${join(releaseDirectory, BUNDLE_PATH)}`,
    `--metafile=${metafilePath}`,
    "--log-level=warning",
  ];
}

function productionProbeEsbuildArguments(bundlePath, metafilePath) {
  return [
    BUNDLED_RELEASE_PROBE_ENTRY_PATH,
    "--bundle",
    "--platform=node",
    `--target=${TARGET}`,
    "--format=esm",
    "--minify",
    "--tree-shaking=true",
    "--legal-comments=external",
    `--banner:js=${CREATE_REQUIRE_BANNER}`,
    '--define:process.env.NODE_ENV="production"',
    ...esbuildAliasArguments(),
    `--outfile=${bundlePath}`,
    `--metafile=${metafilePath}`,
    "--log-level=warning",
  ];
}

async function runEsbuild(stageDirectory) {
  const releaseDirectory = join(stageDirectory, "release");
  const metafilePath = join(stageDirectory, "metafile.json");
  await mkdir(releaseDirectory);
  assertBoundedChildSucceeded(await runBoundedChildProcess({
    executable: resolve(REPOSITORY_ROOT, ESBUILD_BINARY_PATH),
    args: esbuildArguments(releaseDirectory, metafilePath),
    cwd: REPOSITORY_ROOT,
    description: "main release esbuild",
    ...CHILD_PROCESS_LIMITS.esbuild,
    killConfirmationMs: CHILD_KILL_CONFIRMATION_MS,
  }));
  const [bundle, legal, metafileBytes] = await settledAllOrThrow([
    readFile(join(releaseDirectory, BUNDLE_PATH)),
    readFile(join(releaseDirectory, LEGAL_PATH)),
    readFile(metafilePath),
  ]);
  if (bundle.byteLength === 0 || legal.byteLength === 0) {
    fail("esbuild emitted an empty bundle or third-party legal file");
  }
  const rawMetafile = JSON.parse(metafileBytes.toString("utf8"));
  metafileBytes.fill(0);
  const graph = auditAndNormalizeMetafile(rawMetafile);
  const outputBytes = new Map(graph.outputs.map((output) => [output.path, output.bytes]));
  if (outputBytes.get(BUNDLE_PATH) !== bundle.byteLength ||
      outputBytes.get(LEGAL_PATH) !== legal.byteLength) {
    fail("metafile output sizes do not match emitted bytes");
  }
  const bundleAudit = auditBundleText(bundle.toString("utf8"));
  return Object.freeze({ releaseDirectory, metafilePath, bundle, legal, graph, bundleAudit });
}

async function runProductionBundledReleaseProbeBuild(stageDirectory) {
  const probeDirectory = join(stageDirectory, "release", ".build-smoke");
  await mkdir(probeDirectory);
  const bundlePath = join(probeDirectory, BUNDLED_RELEASE_PROBE_BUNDLE_NAME);
  const legalPath = join(probeDirectory, BUNDLED_RELEASE_PROBE_LEGAL_NAME);
  const metafilePath = join(stageDirectory, "production-bundled-release-probe-metafile.json");
  assertBoundedChildSucceeded(await runBoundedChildProcess({
    executable: resolve(REPOSITORY_ROOT, ESBUILD_BINARY_PATH),
    args: productionProbeEsbuildArguments(bundlePath, metafilePath),
    cwd: REPOSITORY_ROOT,
    description: "production bundled-release probe esbuild",
    ...CHILD_PROCESS_LIMITS.esbuild,
    killConfirmationMs: CHILD_KILL_CONFIRMATION_MS,
  }));
  const [bundle, legal, metafileBytes] = await settledAllOrThrow([
    readFile(bundlePath),
    readFile(legalPath),
    readFile(metafilePath),
  ]);
  if (bundle.byteLength === 0 || legal.byteLength === 0) {
    fail("production bundled-release probe emitted an empty bundle or legal file");
  }
  const rawMetafile = JSON.parse(metafileBytes.toString("utf8"));
  metafileBytes.fill(0);
  const graph = auditAndNormalizeProductionProbeMetafile(rawMetafile);
  const outputBytes = new Map(graph.outputs.map((output) => [output.path, output.bytes]));
  if (outputBytes.get(BUNDLED_RELEASE_PROBE_BUNDLE_NAME) !== bundle.byteLength ||
      outputBytes.get(BUNDLED_RELEASE_PROBE_LEGAL_NAME) !== legal.byteLength) {
    fail("production bundled-release probe metafile sizes do not match emitted bytes");
  }
  return Object.freeze({
    stageDirectory,
    releaseDirectory: join(stageDirectory, "release"),
    bundlePath,
    legalPath,
    bundle,
    legal,
    graph,
  });
}

async function removeProductionProbeOutputs(probeBuild) {
  const probeDirectory = dirname(probeBuild.bundlePath);
  const expectedReleaseDirectory = join(probeBuild.stageDirectory, "release");
  const expectedProbeDirectory = join(expectedReleaseDirectory, ".build-smoke");
  if (probeBuild.releaseDirectory !== expectedReleaseDirectory ||
      probeDirectory !== expectedProbeDirectory ||
      dirname(probeBuild.legalPath) !== probeDirectory ||
      basename(probeBuild.bundlePath) !== BUNDLED_RELEASE_PROBE_BUNDLE_NAME ||
      basename(probeBuild.legalPath) !== BUNDLED_RELEASE_PROBE_LEGAL_NAME ||
      basename(probeDirectory) !== ".build-smoke") {
    fail("refusing to remove malformed production probe output paths");
  }
  const [releaseStatus, releaseRealpath, probeStatus, probeRealpath] = await settledAllOrThrow([
    lstat(expectedReleaseDirectory),
    realpath(expectedReleaseDirectory),
    lstat(probeDirectory),
    realpath(probeDirectory),
  ]);
  if (!releaseStatus.isDirectory() || releaseStatus.isSymbolicLink() ||
      releaseRealpath !== expectedReleaseDirectory ||
      !probeStatus.isDirectory() || probeStatus.isSymbolicLink() ||
      probeRealpath !== probeDirectory) {
    fail("production probe output directory is not a canonical regular directory");
  }
  const inventory = await walkRegularTree(probeDirectory);
  if (!arraysEqual(
    inventory.files,
    [BUNDLED_RELEASE_PROBE_BUNDLE_NAME, BUNDLED_RELEASE_PROBE_LEGAL_NAME].sort(),
  ) || inventory.directories.length !== 0) {
    fail("production probe output directory differs from the exact two-file inventory");
  }
  const [bundleRecord, legalRecord] = await settledAllOrThrow([
    identityFileRecord(
      probeBuild.bundlePath,
      `<ephemeral>/${BUNDLED_RELEASE_PROBE_BUNDLE_NAME}`,
    ),
    identityFileRecord(
      probeBuild.legalPath,
      `<ephemeral>/${BUNDLED_RELEASE_PROBE_LEGAL_NAME}`,
    ),
  ]);
  if (bundleRecord.sizeBytes !== probeBuild.bundle.byteLength ||
      bundleRecord.sha256 !== sha256(probeBuild.bundle) ||
      legalRecord.sizeBytes !== probeBuild.legal.byteLength ||
      legalRecord.sha256 !== sha256(probeBuild.legal)) {
    fail("production probe output bytes changed before verified removal");
  }
  await settledAllOrThrow([unlink(probeBuild.bundlePath), unlink(probeBuild.legalPath)]);
  const [finalProbeStatus, finalProbeRealpath, finalInventory] = await settledAllOrThrow([
    lstat(probeDirectory),
    realpath(probeDirectory),
    walkRegularTree(probeDirectory),
  ]);
  if (!finalProbeStatus.isDirectory() || finalProbeStatus.isSymbolicLink() ||
      finalProbeRealpath !== probeRealpath || finalProbeStatus.dev !== probeStatus.dev ||
      finalProbeStatus.ino !== probeStatus.ino ||
      finalProbeStatus.birthtimeMs !== probeStatus.birthtimeMs ||
      finalInventory.files.length !== 0 || finalInventory.directories.length !== 0) {
    fail("production probe output directory identity changed before removal");
  }
  await rmdir(probeDirectory);
}

function assertDeterministicProductionProbeBuilds(first, second) {
  if (!first.bundle.equals(second.bundle) || !first.legal.equals(second.legal) ||
      canonicalJson(first.graph) !== canonicalJson(second.graph)) {
    fail("two fresh production bundled-release probe builds differ");
  }
}

function normalizedSmokeStderr(stderr, description) {
  const normalized = stderr.replaceAll("\r\n", "\n").replace(/\(node:\d+\)/gu, "(node:<pid>)");
  if (normalized === "") return "";
  const expected = "(node:<pid>) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n" +
    "(Use `node --trace-warnings ...` to show where the warning was created)\n";
  if (normalized !== expected) fail(`${description} wrote unexpected stderr`);
  return normalized;
}

async function smokeRelease(releaseDirectory) {
  const nodeRuntime = join(releaseDirectory, ...NODE_RUNTIME_PATH.split("/"));
  const result = assertBoundedChildSucceeded(await runBoundedChildProcess({
    executable: nodeRuntime,
    args: [join(releaseDirectory, BUNDLE_PATH), "--help"],
    cwd: releaseDirectory,
    description: "node foundry.mjs --help smoke test",
    ...CHILD_PROCESS_LIMITS.smoke,
    killConfirmationMs: CHILD_KILL_CONFIRMATION_MS,
  }));
  const stdout = result.stdout.toString("utf8");
  const stderrOutput = result.stderr.toString("utf8");
  if (!stdout.startsWith("Usage:\n") ||
      !stdout.includes("This tool intentionally has no publish")) {
    fail("--help smoke output does not match the reviewed Foundry CLI usage");
  }
  const stderr = normalizedSmokeStderr(stderrOutput, "--help smoke test");
  return Object.freeze({
    command: [NODE_RUNTIME_PATH, BUNDLE_PATH, "--help"],
    environment: "empty",
    exitCode: 0,
    stdoutSha256: sha256(Buffer.from(stdout, "utf8")),
    normalizedStderrSha256: sha256(Buffer.from(stderr, "utf8")),
    nodeExperimentalSqliteWarningObserved: stderr.length > 0,
  });
}

async function smokeProductionBundledReleaseProbe(
  releaseDirectory,
  probeBuild,
  sourceInputs,
) {
  const nodeRuntime = join(releaseDirectory, ...NODE_RUNTIME_PATH.split("/"));
  const result = assertBoundedChildSucceeded(await runBoundedChildProcess({
    executable: nodeRuntime,
    args: [probeBuild.bundlePath],
    cwd: releaseDirectory,
    description: "production bundled-release lookup smoke test",
    ...CHILD_PROCESS_LIMITS.smoke,
    killConfirmationMs: CHILD_KILL_CONFIRMATION_MS,
  }));
  const stdout = result.stdout.toString("utf8");
  const stderrOutput = result.stderr.toString("utf8");
  if (stdout !== BUNDLED_RELEASE_PROBE_EXPECTED_STDOUT) {
    fail("production bundled-release lookup smoke output is not explicitly unavailable");
  }
  const stderr = normalizedSmokeStderr(
    stderrOutput,
    "production bundled-release lookup smoke test",
  );
  return Object.freeze({
    command: [NODE_RUNTIME_PATH, `<ephemeral>/${BUNDLED_RELEASE_PROBE_BUNDLE_NAME}`],
    environment: "empty",
    exitCode: 0,
    observedStatus: "unavailable",
    observedCode: "NO_DOCKER_QUALIFIED_BUNDLED_RELEASE",
    observedCapability: null,
    observedRejectionCode: null,
    stdoutSha256: sha256(Buffer.from(stdout, "utf8")),
    normalizedStderrSha256: sha256(Buffer.from(stderr, "utf8")),
    nodeExperimentalSqliteWarningObserved: stderr.length > 0,
    productionBundle: Object.freeze({
      sha256: sha256(probeBuild.bundle),
      sizeBytes: probeBuild.bundle.byteLength,
      legalSha256: sha256(probeBuild.legal),
      legalSizeBytes: probeBuild.legal.byteLength,
      normalizedGraph: probeBuild.graph,
      sourceInputs,
      freshSiblingBuildCount: 2,
      siblingBuildsByteIdentical: true,
    }),
  });
}

export function assertBundledReleaseNullSourceBytes(sourceBytes) {
  if (!(sourceBytes instanceof Uint8Array)) {
    fail("bundled-release source proof requires exact bytes");
  }
  const actual = Buffer.from(sourceBytes);
  const expected = Buffer.from(BUNDLED_RELEASE_NULL_SOURCE_TEXT, "utf8");
  try {
    const actualSha256 = sha256(actual);
    const expectedSha256 = sha256(expected);
    if (expectedSha256 !== BUNDLED_RELEASE_NULL_SOURCE_SHA256) {
      fail("builder's canonical bundled-release null source contract has an invalid digest");
    }
    if (actual.byteLength !== expected.byteLength ||
        actualSha256 !== BUNDLED_RELEASE_NULL_SOURCE_SHA256 ||
        !actual.equals(expected)) {
      fail(
        "bundled-release generated source must be exactly the reviewed two null exports with no imports, aliases, or additional executable code",
      );
    }
    return Object.freeze({
      path: BUNDLED_RELEASE_SOURCE_PATH,
      sizeBytes: actual.byteLength,
      sha256: actualSha256,
      exactExportedBindings: Object.freeze([
        "LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_MANIFEST",
        "LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_TRUST_ROOT",
      ]),
      initializerForEveryBinding: null,
      importsOrAdditionalExecutableCodePermitted: false,
      enforcement: "exact_canonical_source_bytes",
    });
  } finally {
    actual.fill(0);
    expected.fill(0);
  }
}

async function assertBundledReleaseSourceIsNull() {
  const source = await readFile(resolve(REPOSITORY_ROOT, BUNDLED_RELEASE_SOURCE_PATH));
  try {
    return assertBundledReleaseNullSourceBytes(source);
  } finally {
    source.fill(0);
  }
}

export function assertExactPayloadInventory(inventory, expectedFiles, expectedDirectories) {
  if (!isPlainObject(inventory) || !Array.isArray(inventory.files) ||
      !Array.isArray(inventory.directories) || !Array.isArray(expectedFiles) ||
      !Array.isArray(expectedDirectories) ||
      [...inventory.files, ...inventory.directories, ...expectedFiles, ...expectedDirectories]
        .some((path) => typeof path !== "string" || path.length === 0)) {
    fail("exact staged payload inventory evidence is malformed");
  }
  const sortedUnique = (paths, description) => {
    const sorted = [...paths].sort((left, right) => left.localeCompare(right, "en"));
    if (new Set(sorted).size !== sorted.length) {
      fail(`exact staged payload inventory repeats a ${description}`);
    }
    return sorted;
  };
  const actualFiles = sortedUnique(inventory.files, "file");
  const actualDirectories = sortedUnique(inventory.directories, "directory");
  const allowedFiles = sortedUnique(expectedFiles, "allowed file");
  const allowedDirectories = sortedUnique(expectedDirectories, "allowed directory");
  if (!arraysEqual(actualFiles, allowedFiles) ||
      !arraysEqual(actualDirectories, allowedDirectories)) {
    fail("exact staged payload inventory differs from its file/directory allowlist");
  }
}

export function assertHeldRecordMatches(observed, expected, description) {
  if (typeof description !== "string" || description.length === 0) {
    fail("held-record comparison requires a description");
  }
  const normalizeRecord = (record, recordDescription) => {
    if (!isPlainObject(record) || typeof record.path !== "string" ||
        !Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 0 ||
        typeof record.sha256 !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(record.sha256)) {
      fail(`${recordDescription} is malformed`);
    }
    return {
      path: record.path,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
    };
  };
  const normalizedObserved = normalizeRecord(observed, `${description} observed`);
  const normalizedExpected = normalizeRecord(expected, `${description} expected`);
  if (canonicalJson(normalizedObserved) !== canonicalJson(normalizedExpected)) {
    fail(`${description} differs from its held size/hash record`);
  }
}

function stagedPayloadDirectories() {
  return [
    "node_modules",
    "node_modules/@img",
    "node_modules/@img/sharp-win32-x64",
    "node_modules/@img/sharp-win32-x64/lib",
    "runtime",
  ].sort((left, right) => left.localeCompare(right, "en"));
}

function recordForHeldBytes(path, bytes) {
  return Object.freeze({ path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) });
}

function stagedPayloadExpectations(
  build,
  nativeRuntime,
  runtimeNode,
  graphEvidence,
  graphRecord,
  manifest,
  manifestRecord,
) {
  const launcher = windowsLauncherBytes();
  const startHere = startHereBytes();
  const graphBytes = canonicalBytes(graphEvidence);
  const manifestBytes = manifest === null ? null : canonicalBytes(manifest);
  const entries = [
    { record: recordForHeldBytes(BUNDLE_PATH, build.bundle), exactBytes: build.bundle },
    { record: recordForHeldBytes(LEGAL_PATH, build.legal), exactBytes: build.legal },
    { record: runtimeNode.executable.destination, exactBytes: null },
    { record: runtimeNode.license.destination, exactBytes: null },
    { record: recordForHeldBytes(WINDOWS_LAUNCHER_PATH, launcher), exactBytes: launcher },
    { record: recordForHeldBytes(START_HERE_PATH, startHere), exactBytes: startHere },
    { record: graphRecord, exactBytes: graphBytes },
    ...nativeRuntime.records.map((record) => ({
      record: Object.freeze({
        path: `node_modules/@img/sharp-win32-x64/${record.path}`,
        sizeBytes: record.sizeBytes,
        sha256: record.sha256,
      }),
      exactBytes: null,
    })),
  ];
  if ((manifest === null) !== (manifestRecord === null)) {
    launcher.fill(0);
    startHere.fill(0);
    graphBytes.fill(0);
    manifestBytes?.fill(0);
    fail("staged payload manifest evidence is incomplete");
  }
  if (manifest !== null && manifestBytes !== null) {
    entries.push({ record: manifestRecord, exactBytes: manifestBytes });
  }
  entries.sort((left, right) => left.record.path.localeCompare(right.record.path, "en"));
  return Object.freeze({
    entries,
    disposableBytes: [launcher, startHere, graphBytes, ...(manifestBytes === null ? [] : [manifestBytes])],
  });
}

async function verifyStagedPayload(
  build,
  nativeRuntime,
  runtimeNode,
  graphEvidence,
  graphRecord,
  manifest = null,
  manifestRecord = null,
) {
  const expected = stagedPayloadExpectations(
    build,
    nativeRuntime,
    runtimeNode,
    graphEvidence,
    graphRecord,
    manifest,
    manifestRecord,
  );
  const observed = [];
  try {
    const inventory = await walkRegularTree(build.releaseDirectory);
    assertExactPayloadInventory(
      inventory,
      expected.entries.map(({ record }) => record.path),
      stagedPayloadDirectories(),
    );
    const heldFiles = [];
    for (const { record } of expected.entries) {
      const held = await identityFileBytes(
        join(build.releaseDirectory, ...record.path.split("/")),
        record.path,
      );
      heldFiles.push(held);
      observed.push(held.bytes);
    }
    for (const [index, held] of heldFiles.entries()) {
      const expectedEntry = expected.entries[index];
      assertHeldRecordMatches(held.record, expectedEntry.record, expectedEntry.record.path);
      if (expectedEntry.exactBytes !== null &&
          !held.bytes.equals(expectedEntry.exactBytes)) {
        fail(`${expectedEntry.record.path} differs from its exact held bytes`);
      }
    }
    const files = heldFiles.map(({ record }) => Object.freeze({
      path: record.path,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
    }));
    const directories = stagedPayloadDirectories();
    return Object.freeze({
      files,
      directories,
      digest: sha256(canonicalBytes({ files, directories })),
    });
  } finally {
    for (const bytes of observed) bytes.fill(0);
    for (const bytes of expected.disposableBytes) bytes.fill(0);
  }
}

export async function snapshotTree(root) {
  const inventory = await walkRegularTree(root);
  const files = [];
  for (const path of inventory.files) {
    files.push(await fileRecord(join(root, ...path.split("/")), path));
  }
  const directories = Object.freeze([...inventory.directories]);
  const digest = sha256(canonicalBytes({ files, directories }));
  return Object.freeze({ files, directories, digest });
}

function assertTreeSnapshotsEqual(first, second, description) {
  if (canonicalJson(first) !== canonicalJson(second)) fail(`${description} differs by bytes or paths`);
}

export async function publishAndVerify(
  stagingDirectory,
  outputDirectory,
  expectedSnapshot,
  prepublicationVerification = undefined,
) {
  if (prepublicationVerification !== undefined) {
    if (typeof prepublicationVerification !== "function") {
      fail("prepublication verification callback is malformed");
    }
    await prepublicationVerification();
  }
  await rename(stagingDirectory, outputDirectory);
  const publishedSnapshot = await snapshotTree(outputDirectory);
  assertTreeSnapshotsEqual(
    expectedSnapshot,
    publishedSnapshot,
    "full post-publication tree re-read/re-hash",
  );
  return publishedSnapshot;
}

async function writeCanonicalEvidence(path, value) {
  const bytes = canonicalBytes(value);
  await writeFile(path, bytes, { flag: "wx", mode: 0o444 });
  const record = Object.freeze({
    path: basename(path),
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
  bytes.fill(0);
  return record;
}

async function builderInputRecords() {
  const paths = [
    [SCRIPT_PATH, repositoryPath(SCRIPT_PATH)],
    [process.execPath, "host/node.exe"],
    [NODE_INSTALLER_PATH, "host/node-installer.msi"],
    [WINDOWS_POWERSHELL_PATH, "host/windows-powershell.exe"],
    [
      resolve(REPOSITORY_ROOT, BUNDLED_RELEASE_PROBE_ENTRY_PATH),
      BUNDLED_RELEASE_PROBE_ENTRY_PATH,
    ],
    [resolve(REPOSITORY_ROOT, ESBUILD_BINARY_PATH), ESBUILD_BINARY_PATH],
  ];
  const records = [];
  for (const [absolutePath, path] of paths) {
    records.push(await identityFileRecord(absolutePath, path));
  }
  return records;
}

function releaseManifest(buildGraphRecord, payloadSnapshot, smoke, runtimeNode) {
  return Object.freeze({
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    releaseKind: "reconstruction_foundry_windows_x64_internal_operator_candidate",
    runtime: Object.freeze({
      platform: REQUIRED_PLATFORM,
      arch: REQUIRED_ARCH,
      nodeVersion: REQUIRED_NODE_VERSION,
      entrypoint: BUNDLE_PATH,
      systemNodeRequired: false,
      includedNodeExecutable: runtimeNode.executable.destination,
      includedNodeLicense: runtimeNode.license.destination,
    }),
    buildGraph: buildGraphRecord,
    payloadFiles: payloadSnapshot.files,
    payloadDirectories: payloadSnapshot.directories,
    payloadTreeSha256: payloadSnapshot.digest,
    repeatability: Object.freeze({
      freshSiblingBuildCount: 2,
      esbuildOutputsByteIdentical: true,
      normalizedGraphIdentical: true,
      completePreparedTreesByteIdentical: true,
    }),
    publication: Object.freeze({
      outputMustNotExist: true,
      mechanism: "single_best_available_windows_directory_rename",
      directoryRenameCount: 1,
      strictAtomicNoReplaceEstablished: false,
      sameUserRaceResistanceEstablished: false,
      verificationScope: "point_in_time_full_tree_reread_and_rehash_after_rename",
      publishedTreePreservedOnPostPublishFailure: true,
    }),
    thirdPartyLicenseEvidence: Object.freeze({
      esbuildLegalOutputIncluded: true,
      sharpNativeLicenseIncluded: true,
      nodeMsiLicenseRtfIncluded: true,
      thirdPartyLicenseClosureEstablished: false,
      commercialRedistributionApprovedByThisBuild: false,
    }),
    smokeTest: smoke,
    normalizationQualification: Object.freeze({
      productionNormalizationQualified: false,
      bundledReleaseManifestInCurrentSource: null,
      dockerQualificationAuthorized: false,
    }),
    limitations: LIMITATIONS,
  });
}

function buildGraphEvidence(
  firstBuild,
  sourceInputs,
  nativeRuntime,
  runtimeNode,
  smoke,
  builders,
  bundledReleaseNullSource,
  sourceCustody,
) {
  return Object.freeze({
    schemaVersion: BUILD_GRAPH_SCHEMA_VERSION,
    builder: Object.freeze({
      host: `${REQUIRED_PLATFORM}/${REQUIRED_ARCH}`,
      nodeVersion: REQUIRED_NODE_VERSION,
      esbuildVersion: ESBUILD_VERSION,
      target: TARGET,
      platform: "node",
      format: "esm",
      nodeEnvDefine: "production",
      createRequireBanner: CREATE_REQUIRE_BANNER,
      legalComments: "external",
      inputs: builders,
    }),
    aliases: SOURCE_ALIASES,
    normalizedGraph: firstBuild.graph,
    sourceInputs,
    sourceCustody,
    nativeRuntime: Object.freeze({
      package: `@img/sharp-win32-x64@${SHARP_NATIVE_VERSION}`,
      destination: "node_modules/@img/sharp-win32-x64",
      files: nativeRuntime.records,
    }),
    includedNodeRuntime: runtimeNode,
    bundledReleaseNullSource,
    bundleAudit: firstBuild.bundleAudit,
    smokeTest: smoke,
    limitations: LIMITATIONS,
  });
}

async function prepareReleaseTrees(
  firstBuild,
  secondBuild,
  graphEvidence,
  smoke,
  runtimeNode,
  nativeRuntime,
) {
  const graphRecords = await settledAllOrThrow([
    writeCanonicalEvidence(join(firstBuild.releaseDirectory, BUILD_GRAPH_PATH), graphEvidence),
    writeCanonicalEvidence(join(secondBuild.releaseDirectory, BUILD_GRAPH_PATH), graphEvidence),
  ]);
  if (canonicalJson(graphRecords[0]) !== canonicalJson(graphRecords[1])) {
    fail("canonical build-graph evidence differs between sibling staging trees");
  }
  const payloadSnapshots = await settledAllOrThrow([
    verifyStagedPayload(
      firstBuild,
      nativeRuntime,
      runtimeNode,
      graphEvidence,
      graphRecords[0],
    ),
    verifyStagedPayload(
      secondBuild,
      nativeRuntime,
      runtimeNode,
      graphEvidence,
      graphRecords[1],
    ),
  ]);
  assertTreeSnapshotsEqual(payloadSnapshots[0], payloadSnapshots[1], "prepared payload trees");
  const manifest = releaseManifest(
    graphRecords[0],
    payloadSnapshots[0],
    smoke,
    runtimeNode,
  );
  const manifestRecords = await settledAllOrThrow([
    writeCanonicalEvidence(join(firstBuild.releaseDirectory, RELEASE_MANIFEST_PATH), manifest),
    writeCanonicalEvidence(join(secondBuild.releaseDirectory, RELEASE_MANIFEST_PATH), manifest),
  ]);
  if (canonicalJson(manifestRecords[0]) !== canonicalJson(manifestRecords[1])) {
    fail("canonical release manifest differs between sibling staging trees");
  }
  const finalSnapshots = await settledAllOrThrow([
    verifyStagedPayload(
      firstBuild,
      nativeRuntime,
      runtimeNode,
      graphEvidence,
      graphRecords[0],
      manifest,
      manifestRecords[0],
    ),
    verifyStagedPayload(
      secondBuild,
      nativeRuntime,
      runtimeNode,
      graphEvidence,
      graphRecords[1],
      manifest,
      manifestRecords[1],
    ),
  ]);
  assertTreeSnapshotsEqual(finalSnapshots[0], finalSnapshots[1], "complete sibling release trees");
  return Object.freeze({
    expectedPublishedSnapshot: finalSnapshots[0],
    graphRecord: graphRecords[0],
    manifest,
    manifestRecord: manifestRecords[0],
  });
}

export async function captureTemporaryRootIdentity(temporaryRoot, expectedParent) {
  if (!isAbsolute(temporaryRoot) || dirname(temporaryRoot) !== expectedParent ||
      !basename(temporaryRoot).startsWith(TEMPORARY_PREFIX)) {
    fail("temporary build path does not match its expected parent/prefix");
  }
  const status = await lstat(temporaryRoot);
  const resolvedPath = await realpath(temporaryRoot);
  if (!status.isDirectory() || status.isSymbolicLink() || resolvedPath !== temporaryRoot) {
    fail("temporary build root is not a canonical regular directory");
  }
  return Object.freeze({
    path: temporaryRoot,
    parent: expectedParent,
    realpath: resolvedPath,
    dev: status.dev,
    ino: status.ino,
    birthtimeMs: status.birthtimeMs,
  });
}

export async function removeVerifiedTemporaryRoot(identity) {
  if (!isPlainObject(identity) || typeof identity.path !== "string" ||
      typeof identity.parent !== "string" || typeof identity.realpath !== "string" ||
      typeof identity.dev !== "number" || typeof identity.ino !== "number" ||
      typeof identity.birthtimeMs !== "number") {
    fail("temporary build identity is malformed");
  }
  const retryableCodes = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
  for (let attempt = 0; attempt <= 10; attempt += 1) {
    if (!isAbsolute(identity.path) || dirname(identity.path) !== identity.parent ||
        !basename(identity.path).startsWith(TEMPORARY_PREFIX)) {
      fail("refusing to clean an unverified temporary build path");
    }
    let status;
    let resolvedPath;
    try {
      status = await lstat(identity.path);
      resolvedPath = await realpath(identity.path);
    } catch (error) {
      if (attempt > 0 && systemErrorCode(error) === "ENOENT") return;
      throw error;
    }
    if (!status.isDirectory() || status.isSymbolicLink() ||
        resolvedPath !== identity.realpath || status.dev !== identity.dev ||
        status.ino !== identity.ino || status.birthtimeMs !== identity.birthtimeMs) {
      fail("temporary build root identity changed; preserving it instead of deleting");
    }
    try {
      await rm(identity.path, { recursive: true, force: false });
      return;
    } catch (error) {
      if (attempt === 10 || !retryableCodes.has(systemErrorCode(error) ?? "")) {
        throw error;
      }
      await delay(100);
    }
  }
}

function cleanupWarningRecord(error, skippedReason, temporaryRoot, outputDirectory, verified) {
  if (error === null && skippedReason === null) return null;
  return Object.freeze({
    message: error === null
      ? `temporary cleanup skipped: ${skippedReason}`
      : `temporary cleanup failed: ${errorMessage(error)}`,
    temporaryRoot,
    outputDirectory,
    publicationVerified: verified,
    operatorAction: "inspect and remove the reported temporary root only after confirming no process uses it",
  });
}

export function finalizeReleaseOutcome({
  result,
  primaryError,
  cleanupError,
  cleanupSkippedReason,
  temporaryRoot,
  outputDirectory,
  publicationVerified,
}) {
  if ((result !== null && !isPlainObject(result)) ||
      (primaryError !== null && !(primaryError instanceof Error)) ||
      (cleanupError !== null && !(cleanupError instanceof Error)) ||
      (cleanupSkippedReason !== null && typeof cleanupSkippedReason !== "string") ||
      typeof temporaryRoot !== "string" || typeof outputDirectory !== "string" ||
      typeof publicationVerified !== "boolean" ||
      (result === null) === (primaryError === null)) {
    fail("release outcome settlement is malformed");
  }
  const warning = cleanupWarningRecord(
    cleanupError,
    cleanupSkippedReason,
    temporaryRoot,
    outputDirectory,
    publicationVerified,
  );
  if (primaryError !== null) {
    if (warning !== null) {
      primaryError.message = `${primaryError.message} | Cleanup warning: ${warning.message}; ` +
        `temporary handoff: ${temporaryRoot}`;
      primaryError.cleanupWarning = warning;
      primaryError.temporaryBuildCleanupCompleted = false;
    }
    throw primaryError;
  }
  if (publicationVerified !== true) {
    fail("release result cannot settle before post-publication verification");
  }
  return Object.freeze({
    ...result,
    temporaryBuildCleanupCompleted: warning === null,
    cleanupWarning: warning,
  });
}

function assertHost() {
  if (process.version !== REQUIRED_NODE_VERSION) {
    fail(`requires Node ${REQUIRED_NODE_VERSION}; received ${process.version}`);
  }
  if (process.platform !== REQUIRED_PLATFORM || process.arch !== REQUIRED_ARCH) {
    fail(`requires ${REQUIRED_PLATFORM}/${REQUIRED_ARCH}; received ${process.platform}/${process.arch}`);
  }
}

async function assertLocalBuildPrerequisites() {
  await settledAllOrThrow([
    requireRegularFile(resolve(REPOSITORY_ROOT, ENTRY_PATH), ENTRY_PATH),
    requireRegularFile(
      resolve(REPOSITORY_ROOT, BUNDLED_RELEASE_PROBE_ENTRY_PATH),
      BUNDLED_RELEASE_PROBE_ENTRY_PATH,
    ),
    requireRegularFile(
      resolve(REPOSITORY_ROOT, BUNDLED_RELEASE_MODULE_PATH),
      BUNDLED_RELEASE_MODULE_PATH,
    ),
    requireRegularFile(NODE_INSTALLER_PATH, `exact Node ${REQUIRED_NODE_VERSION} MSI`),
    requireRegularFile(WINDOWS_POWERSHELL_PATH, "Windows PowerShell license extractor"),
    requireRegularFile(resolve(REPOSITORY_ROOT, ESBUILD_BINARY_PATH), ESBUILD_BINARY_PATH),
    ...SOURCE_ALIASES.map(({ target }) =>
      requireRegularFile(resolve(REPOSITORY_ROOT, target), target)),
  ]);
  const esbuildPackage = createRequire(import.meta.url)(
    resolve(REPOSITORY_ROOT, `node_modules/.pnpm/esbuild@${ESBUILD_VERSION}/node_modules/esbuild/package.json`),
  );
  if (esbuildPackage.version !== ESBUILD_VERSION) fail("esbuild package version is not exact");
  return await assertBundledReleaseSourceIsNull();
}

export async function buildProductionRelease(outputDirectory) {
  assertHost();
  const initialBuilders = await builderInputRecords();
  const initialParent = await assertOutputAvailable(outputDirectory);
  const bundledReleaseNullSource = await assertLocalBuildPrerequisites();
  await assertSourceRootsClean();
  const nativeRuntime = await inspectSharpNativeRuntime();
  const temporaryRoot = await mkdtemp(join(initialParent.parent, TEMPORARY_PREFIX));
  const temporaryIdentity = await captureTemporaryRootIdentity(
    temporaryRoot,
    initialParent.parent,
  );
  let nodeLicense;
  let coreResult = null;
  let primaryError = null;
  let publicationVerified = false;
  try {
    nodeLicense = await inspectExactNodeLicense(initialBuilders);
    const firstStage = join(temporaryRoot, "stage-a");
    const secondStage = join(temporaryRoot, "stage-b");
    await settledAllOrThrow([mkdir(firstStage), mkdir(secondStage)]);
    const firstBuild = await runEsbuild(firstStage);
    const firstSourceInputs = await repositoryInputRecords(firstBuild.graph.inputs);
    const secondBuild = await runEsbuild(secondStage);
    const secondSourceInputs = await repositoryInputRecords(secondBuild.graph.inputs);
    const firstProbeBuild = await runProductionBundledReleaseProbeBuild(firstStage);
    const firstProbeSourceInputs = await repositoryInputRecords(firstProbeBuild.graph.inputs);
    const secondProbeBuild = await runProductionBundledReleaseProbeBuild(secondStage);
    const secondProbeSourceInputs = await repositoryInputRecords(secondProbeBuild.graph.inputs);
    await assertSourceRootsClean();
    assertBuilderInputsUnchanged(initialBuilders, await builderInputRecords());
    assertDeterministicEsbuildOutputs(firstBuild, secondBuild);
    assertDeterministicProductionProbeBuilds(firstProbeBuild, secondProbeBuild);
    if (canonicalJson(firstSourceInputs) !== canonicalJson(secondSourceInputs)) {
      fail("audited source/dependency bytes changed between sibling builds");
    }
    if (canonicalJson(firstProbeSourceInputs) !== canonicalJson(secondProbeSourceInputs)) {
      fail("production probe source/dependency bytes changed between sibling builds");
    }
    const firstSharedInputs = assertSharedRepositoryInputsEqual(
      firstSourceInputs,
      firstProbeSourceInputs,
      "stage-a main/probe builds",
    );
    const secondSharedInputs = assertSharedRepositoryInputsEqual(
      secondSourceInputs,
      secondProbeSourceInputs,
      "stage-b main/probe builds",
    );
    if (canonicalJson({ ...firstSharedInputs, description: null }) !==
        canonicalJson({ ...secondSharedInputs, description: null })) {
      fail("shared main/probe input evidence differs between sibling stages");
    }
    const completeSourceInputUnion = reconcileRepositoryInputRecords([
      firstSourceInputs,
      secondSourceInputs,
      firstProbeSourceInputs,
      secondProbeSourceInputs,
    ]);
    const postBuildInputRehash = await rehashRepositoryInputRecords(completeSourceInputUnion);
    const sourceCustody = Object.freeze({
      sharedMainProbeInputs: Object.freeze([firstSharedInputs, secondSharedInputs]),
      completeInputUnion: Object.freeze({
        inputCount: completeSourceInputUnion.length,
        recordsSha256: sha256(canonicalBytes(completeSourceInputUnion)),
      }),
      postBuildUnifiedRehash: postBuildInputRehash,
      finalPrepublicationUnifiedRehash: Object.freeze({
        required: true,
        expectedInputCount: completeSourceInputUnion.length,
        expectedRecordsSha256: postBuildInputRehash.recordsSha256,
        completionReportedByBuilderSummary: true,
      }),
    });
    const initialNodeRuntime = nodeRuntimeSourceRecord(initialBuilders);
    const [firstNodeRuntime, secondNodeRuntime] = await settledAllOrThrow([
      copyNodeRuntime(initialNodeRuntime, firstBuild.releaseDirectory),
      copyNodeRuntime(initialNodeRuntime, secondBuild.releaseDirectory),
    ]);
    if (canonicalJson(firstNodeRuntime) !== canonicalJson(secondNodeRuntime)) {
      fail("included Node runtime records differ between sibling staging trees");
    }
    const [firstNodeLicense, secondNodeLicense] = await settledAllOrThrow([
      copyNodeLicense(nodeLicense, firstBuild.releaseDirectory),
      copyNodeLicense(nodeLicense, secondBuild.releaseDirectory),
    ]);
    if (canonicalJson(firstNodeLicense) !== canonicalJson(secondNodeLicense)) {
      fail("included Node license records differ between sibling staging trees");
    }
    await settledAllOrThrow([
      copySharpNativeRuntime(nativeRuntime, firstBuild.releaseDirectory),
      copySharpNativeRuntime(nativeRuntime, secondBuild.releaseDirectory),
      writeHumanStartFiles(firstBuild.releaseDirectory),
      writeHumanStartFiles(secondBuild.releaseDirectory),
    ]);
    const [firstHelpSmoke, secondHelpSmoke, firstLookupSmoke, secondLookupSmoke] =
      await settledAllOrThrow([
      smokeRelease(firstBuild.releaseDirectory),
      smokeRelease(secondBuild.releaseDirectory),
      smokeProductionBundledReleaseProbe(
        firstBuild.releaseDirectory,
        firstProbeBuild,
        firstProbeSourceInputs,
      ),
      smokeProductionBundledReleaseProbe(
        secondBuild.releaseDirectory,
        secondProbeBuild,
        secondProbeSourceInputs,
      ),
    ]);
    const firstSmoke = Object.freeze({
      cliHelp: firstHelpSmoke,
      bundledReleaseLookup: firstLookupSmoke,
    });
    const secondSmoke = Object.freeze({
      cliHelp: secondHelpSmoke,
      bundledReleaseLookup: secondLookupSmoke,
    });
    if (canonicalJson(firstSmoke) !== canonicalJson(secondSmoke)) {
      fail("scrubbed production smoke evidence differs between sibling builds");
    }
    await settledAllOrThrow([
      removeProductionProbeOutputs(firstProbeBuild),
      removeProductionProbeOutputs(secondProbeBuild),
    ]);
    const runtimeNode = Object.freeze({
      executable: Object.freeze({
        source: initialNodeRuntime,
        destination: firstNodeRuntime,
      }),
      license: Object.freeze({
        installer: nodeLicense.installer,
        authenticode: nodeLicense.authenticode,
        extraction: nodeLicense.extraction,
        source: nodeLicense.record,
        destination: firstNodeLicense,
      }),
    });
    const graphEvidence = buildGraphEvidence(
      firstBuild,
      firstSourceInputs,
      nativeRuntime,
      runtimeNode,
      firstSmoke,
      initialBuilders,
      bundledReleaseNullSource,
      sourceCustody,
    );
    const preparedRelease = await prepareReleaseTrees(
      firstBuild,
      secondBuild,
      graphEvidence,
      firstSmoke,
      runtimeNode,
      nativeRuntime,
    );
    assertBuilderInputsUnchanged(initialBuilders, await builderInputRecords());
    if (canonicalJson(await assertBundledReleaseSourceIsNull()) !==
        canonicalJson(bundledReleaseNullSource)) {
      fail("bundled-release null source contract changed during the build");
    }
    const finalParent = await assertOutputAvailable(outputDirectory);
    assertSameParent(initialParent, finalParent);
    await assertSourceRootsClean();
    const finalInputRehash = await rehashRepositoryInputRecords(completeSourceInputUnion);
    if (canonicalJson(finalInputRehash) !== canonicalJson(postBuildInputRehash)) {
      fail("final main/probe source input rehash evidence differs from the held union");
    }
    const publishedSnapshot = await publishAndVerify(
      firstBuild.releaseDirectory,
      outputDirectory,
      preparedRelease.expectedPublishedSnapshot,
      async () => {
        const finalStagedSnapshots = await settledAllOrThrow([
          verifyStagedPayload(
            firstBuild,
            nativeRuntime,
            runtimeNode,
            graphEvidence,
            preparedRelease.graphRecord,
            preparedRelease.manifest,
            preparedRelease.manifestRecord,
          ),
          verifyStagedPayload(
            secondBuild,
            nativeRuntime,
            runtimeNode,
            graphEvidence,
            preparedRelease.graphRecord,
            preparedRelease.manifest,
            preparedRelease.manifestRecord,
          ),
        ]);
        assertTreeSnapshotsEqual(
          finalStagedSnapshots[0],
          finalStagedSnapshots[1],
          "prepublication sibling release trees",
        );
        assertTreeSnapshotsEqual(
          preparedRelease.expectedPublishedSnapshot,
          finalStagedSnapshots[0],
          "prepublication candidate tree",
        );
      },
    );
    const publishedBundleRecord = publishedSnapshot.files.find(({ path }) =>
      path === BUNDLE_PATH) ?? fail("published bundle is missing");
    assertHeldRecordMatches(
      publishedBundleRecord,
      recordForHeldBytes(BUNDLE_PATH, firstBuild.bundle),
      "published foundry bundle",
    );
    publicationVerified = true;
    coreResult = Object.freeze({
      outputDirectory,
      publishedTreeSha256: publishedSnapshot.digest,
      publishedFileCount: publishedSnapshot.files.length,
      bundleSha256: publishedBundleRecord.sha256,
      buildGraphSha256: publishedSnapshot.files.find(({ path }) =>
        path === BUILD_GRAPH_PATH)?.sha256 ?? fail("published build graph is missing"),
      releaseManifestSha256: publishedSnapshot.files.find(({ path }) =>
        path === RELEASE_MANIFEST_PATH)?.sha256 ?? fail("published release manifest is missing"),
      repeatBuildsByteIdentical: true,
      normalizedGraphsIdentical: true,
      postPublishFullTreeVerified: true,
      allMainAndProbeInputsFinalRehashed: true,
      publishedBundleMatchesHeldBytes: true,
      productionNormalizationQualified: false,
    });
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
  } finally {
    nodeLicense?.bytes.fill(0);
  }
  let cleanupError = null;
  let cleanupSkippedReason = null;
  if (errorRequiresTemporaryHandoff(primaryError)) {
    cleanupSkippedReason = "a bounded direct child did not reach confirmed close";
  } else {
    try {
      await removeVerifiedTemporaryRoot(temporaryIdentity);
    } catch (error) {
      cleanupError = error instanceof Error ? error : new Error(String(error));
    }
  }
  return finalizeReleaseOutcome({
    result: coreResult,
    primaryError,
    cleanupError,
    cleanupSkippedReason,
    temporaryRoot,
    outputDirectory,
    publicationVerified,
  });
}

async function main() {
  if (process.argv.length !== 3) fail("provide exactly one absolute output directory");
  const summary = await buildProductionRelease(process.argv[2]);
  process.stdout.write(`${canonicalJson(summary)}\n`);
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

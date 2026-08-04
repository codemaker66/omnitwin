import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  realpath,
  stat,
  type FileHandle,
} from "node:fs/promises";
import {
  isAbsolute,
  normalize as normalizePath,
  posix,
  resolve as resolvePath,
} from "node:path";
import { TextDecoder } from "node:util";

export const LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V1 =
  "omnitwin.reconstruction-foundry.offline-preview-container.v1";

export const LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS = Object.freeze({
  workerKind: "io.omnitwin.foundry.worker.kind",
  workerProtocolSha256:
    "io.omnitwin.foundry.worker.protocol-sha256",
  workerArtifactSha256:
    "io.omnitwin.foundry.worker.artifact-sha256",
  seccompProfileSha256:
    "io.omnitwin.foundry.worker.seccomp-profile-sha256",
} as const);

export const LOCAL_OFFLINE_PREVIEW_CONTAINER_PREFLIGHT_ERROR_CODES = [
  "PREFLIGHT_CONFIGURATION_REJECTED",
  "DOCKER_EXECUTABLE_PATH_REJECTED",
  "DOCKER_EXECUTABLE_PROBE_FAILED",
  "DOCKER_EXECUTABLE_SYMLINK_REJECTED",
  "DOCKER_EXECUTABLE_NOT_REGULAR_FILE",
  "DOCKER_EXECUTABLE_CHANGED",
  "SECCOMP_PROFILE_PATH_REJECTED",
  "SECCOMP_PROFILE_PROBE_FAILED",
  "SECCOMP_PROFILE_SYMLINK_REJECTED",
  "SECCOMP_PROFILE_NOT_REGULAR_FILE",
  "SECCOMP_PROFILE_TOO_LARGE",
  "SECCOMP_PROFILE_CHANGED",
  "SECCOMP_PROFILE_DIGEST_MISMATCH",
  "SECCOMP_PROFILE_MALFORMED",
  "SECCOMP_DEFAULT_DENY_REQUIRED",
  "SECCOMP_FORBIDDEN_SYSCALL_ALLOWED",
  "DOCKER_VERSION_TIMEOUT",
  "DOCKER_VERSION_OUTPUT_LIMIT_EXCEEDED",
  "DOCKER_VERSION_INVOCATION_FAILED",
  "DOCKER_VERSION_COMMAND_FAILED",
  "DOCKER_VERSION_RESPONSE_MALFORMED",
  "DOCKER_SERVER_UNAVAILABLE",
  "DOCKER_PLATFORM_UNSUPPORTED",
  "DOCKER_INFO_TIMEOUT",
  "DOCKER_INFO_OUTPUT_LIMIT_EXCEEDED",
  "DOCKER_INFO_INVOCATION_FAILED",
  "DOCKER_INFO_COMMAND_FAILED",
  "DOCKER_INFO_RESPONSE_MALFORMED",
  "DOCKER_CGROUP_V2_REQUIRED",
  "DOCKER_SECCOMP_REQUIRED",
  "IMAGE_INSPECT_TIMEOUT",
  "IMAGE_INSPECT_OUTPUT_LIMIT_EXCEEDED",
  "IMAGE_INSPECT_INVOCATION_FAILED",
  "IMAGE_INSPECT_COMMAND_FAILED",
  "IMAGE_INSPECT_RESPONSE_MALFORMED",
  "IMAGE_PLATFORM_MISMATCH",
  "IMAGE_ID_MISMATCH",
  "IMAGE_REPOSITORY_DIGEST_MISMATCH",
  "IMAGE_LABEL_MISMATCH",
  "IMAGE_NONROOT_USER_MISMATCH",
  "IMAGE_ENTRYPOINT_MISMATCH",
  "IMAGE_DEFAULT_COMMAND_REJECTED",
  "IMAGE_EXPOSED_PORTS_REJECTED",
  "IMAGE_DECLARED_VOLUMES_REJECTED",
  "IMAGE_HEALTHCHECK_REJECTED",
  "PREFLIGHT_INTERNAL_FAILURE",
] as const;

export type LocalOfflinePreviewContainerPreflightErrorCode =
  (typeof LOCAL_OFFLINE_PREVIEW_CONTAINER_PREFLIGHT_ERROR_CODES)[number];

export type LocalOfflinePreviewContainerPreflightReport =
  | Readonly<{
      status: "eligible";
      code: "PREFLIGHT_ELIGIBLE";
      sandboxEstablished: false;
    }>
  | Readonly<{
      status: "blocked";
      code: LocalOfflinePreviewContainerPreflightErrorCode;
      sandboxEstablished: false;
    }>;

export interface LocalOfflinePreviewContainerResourceLimits {
  readonly cpuCores: number;
  readonly memoryBytes: number;
  readonly memorySwapBytes: number;
  readonly pidsLimit: number;
  readonly maximumInputBytes: number;
  readonly maximumOutputBytes: number;
  readonly maximumRuntimeMilliseconds: number;
}

export interface LocalOfflinePreviewContainerConfiguration {
  readonly schemaVersion:
    typeof LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V1;
  readonly authority: "none";
  readonly fallbackPolicy: "block";
  readonly containerPlatform: "linux/amd64";
  readonly dockerExecutablePath: string;
  readonly seccompProfilePath: string;
  readonly seccompProfileSha256: string;
  readonly seccompDefaultAction: "SCMP_ACT_ERRNO";
  readonly imageReference: string;
  readonly imageId: string;
  readonly imagePullPolicy: "never";
  readonly networkMode: "none";
  readonly rootFilesystem: "read_only";
  readonly mountPolicy: "none";
  readonly capabilityPolicy: "drop_all";
  readonly noNewPrivileges: true;
  readonly userId: number;
  readonly groupId: number;
  readonly workerKind: "offline_normalization_preview";
  readonly workerProtocolSha256: string;
  readonly workerArtifactSha256: string;
  readonly fixedEntrypoint: readonly string[];
  readonly resourceLimits: LocalOfflinePreviewContainerResourceLimits;
}

export interface LocalOfflinePreviewContainerFileProbeRequest {
  readonly absolutePath: string;
  readonly readContents: boolean;
  readonly maximumBytes: number;
}

export type LocalOfflinePreviewContainerFileProbeResult =
  | Readonly<{
      outcome: "ok";
      canonicalPath: string;
      fileType: "regular" | "other";
      symbolicLink: boolean;
      contents: Uint8Array | null;
    }>
  | Readonly<{
      outcome: "unavailable" | "too_large" | "changed";
    }>;

export type LocalOfflinePreviewContainerFileProbe = (
  request: LocalOfflinePreviewContainerFileProbeRequest,
) => Promise<LocalOfflinePreviewContainerFileProbeResult>;

export type LocalOfflinePreviewDockerReadOnlyCommand =
  | "version"
  | "info"
  | "image_inspect";

export interface LocalOfflinePreviewDockerCommandProbeRequest {
  readonly executablePath: string;
  readonly command: LocalOfflinePreviewDockerReadOnlyCommand;
  readonly imageReference: string | null;
  readonly timeoutMilliseconds: number;
  readonly maximumStdoutBytes: number;
  readonly maximumStderrBytes: number;
}

export type LocalOfflinePreviewDockerCommandProbeResult =
  | Readonly<{
      outcome: "completed";
      exitCode: number | null;
      stdout: Uint8Array;
      stderrByteLength: number;
    }>
  | Readonly<{
      outcome:
        | "timed_out"
        | "output_limit_exceeded"
        | "failed_to_start";
    }>;

export type LocalOfflinePreviewDockerCommandProbe = (
  request: LocalOfflinePreviewDockerCommandProbeRequest,
) => Promise<LocalOfflinePreviewDockerCommandProbeResult>;

export interface LocalOfflinePreviewContainerPreflightDependencies {
  readonly fileProbe?: LocalOfflinePreviewContainerFileProbe;
  readonly commandProbe?: LocalOfflinePreviewDockerCommandProbe;
}

type JsonObject = Record<string, unknown>;

type ParsedConfiguration = LocalOfflinePreviewContainerConfiguration;

type CommandStage = "version" | "info" | "image_inspect";

type ParsedCommandObject =
  | Readonly<{ ok: true; value: JsonObject }>
  | Readonly<{
      ok: false;
      code: LocalOfflinePreviewContainerPreflightErrorCode;
    }>;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const IMAGE_REFERENCE =
  /^[a-z0-9][a-z0-9._/-]{0,446}@sha256:[a-f0-9]{64}$/u;
const MAX_SECURITY_PROFILE_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MILLISECONDS = 10_000;
const MAX_COMMAND_STDOUT_BYTES = 1024 * 1024;
const MAX_COMMAND_STDERR_BYTES = 64 * 1024;
const MIN_CONTAINER_MEMORY_BYTES = 64 * 1024 * 1024;
const MAX_CONTAINER_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CONTAINER_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_CONTAINER_RUNTIME_MILLISECONDS = 60_000;
const MAX_CONTAINER_PIDS = 64;
const READ_CHUNK_BYTES = 64 * 1024;

const CONFIGURATION_KEYS = [
  "schemaVersion",
  "authority",
  "fallbackPolicy",
  "containerPlatform",
  "dockerExecutablePath",
  "seccompProfilePath",
  "seccompProfileSha256",
  "seccompDefaultAction",
  "imageReference",
  "imageId",
  "imagePullPolicy",
  "networkMode",
  "rootFilesystem",
  "mountPolicy",
  "capabilityPolicy",
  "noNewPrivileges",
  "userId",
  "groupId",
  "workerKind",
  "workerProtocolSha256",
  "workerArtifactSha256",
  "fixedEntrypoint",
  "resourceLimits",
] as const;

const RESOURCE_LIMIT_KEYS = [
  "cpuCores",
  "memoryBytes",
  "memorySwapBytes",
  "pidsLimit",
  "maximumInputBytes",
  "maximumOutputBytes",
  "maximumRuntimeMilliseconds",
] as const;

const FORBIDDEN_SECCOMP_SYSCALLS = new Set([
  "socket",
  "socketpair",
  "mount",
  "umount2",
  "ptrace",
  "bpf",
  "unshare",
  "setns",
]);

const DENYING_SECCOMP_ACTIONS = new Set([
  "SCMP_ACT_ERRNO",
  "SCMP_ACT_KILL",
  "SCMP_ACT_KILL_PROCESS",
  "SCMP_ACT_KILL_THREAD",
  "SCMP_ACT_TRAP",
]);

const COMMAND_ERROR_CODES = Object.freeze({
  version: Object.freeze({
    timeout: "DOCKER_VERSION_TIMEOUT",
    outputLimit: "DOCKER_VERSION_OUTPUT_LIMIT_EXCEEDED",
    invocation: "DOCKER_VERSION_INVOCATION_FAILED",
    command: "DOCKER_VERSION_COMMAND_FAILED",
    malformed: "DOCKER_VERSION_RESPONSE_MALFORMED",
  }),
  info: Object.freeze({
    timeout: "DOCKER_INFO_TIMEOUT",
    outputLimit: "DOCKER_INFO_OUTPUT_LIMIT_EXCEEDED",
    invocation: "DOCKER_INFO_INVOCATION_FAILED",
    command: "DOCKER_INFO_COMMAND_FAILED",
    malformed: "DOCKER_INFO_RESPONSE_MALFORMED",
  }),
  image_inspect: Object.freeze({
    timeout: "IMAGE_INSPECT_TIMEOUT",
    outputLimit: "IMAGE_INSPECT_OUTPUT_LIMIT_EXCEEDED",
    invocation: "IMAGE_INSPECT_INVOCATION_FAILED",
    command: "IMAGE_INSPECT_COMMAND_FAILED",
    malformed: "IMAGE_INSPECT_RESPONSE_MALFORMED",
  }),
} satisfies Record<
  CommandStage,
  Readonly<{
    timeout: LocalOfflinePreviewContainerPreflightErrorCode;
    outputLimit: LocalOfflinePreviewContainerPreflightErrorCode;
    invocation: LocalOfflinePreviewContainerPreflightErrorCode;
    command: LocalOfflinePreviewContainerPreflightErrorCode;
    malformed: LocalOfflinePreviewContainerPreflightErrorCode;
  }>
>);

function blocked(
  code: LocalOfflinePreviewContainerPreflightErrorCode,
): LocalOfflinePreviewContainerPreflightReport {
  return Object.freeze({ status: "blocked", code, sandboxEstablished: false });
}

function eligible(): LocalOfflinePreviewContainerPreflightReport {
  return Object.freeze({
    status: "eligible",
    code: "PREFLIGHT_ELIGIBLE",
    sandboxEstablished: false,
  });
}

function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactStringKeys(
  value: JsonObject,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string")) {
    return false;
  }
  const expectedKeys = new Set(expected);
  return keys.every((key) => typeof key === "string" && expectedKeys.has(key));
}

function isSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function parseEntrypoint(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    return null;
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > 1_024 ||
      entry.includes("\0") ||
      entry.includes("\r") ||
      entry.includes("\n")
    ) {
      return null;
    }
    entries.push(entry);
  }
  const executable = entries[0];
  if (
    executable === undefined ||
    !executable.startsWith("/") ||
    posix.normalize(executable) !== executable
  ) {
    return null;
  }
  return Object.freeze(entries);
}

function parseResourceLimits(
  value: unknown,
): LocalOfflinePreviewContainerResourceLimits | null {
  if (!isPlainObject(value) || !hasExactStringKeys(value, RESOURCE_LIMIT_KEYS)) {
    return null;
  }
  const cpuCores = value.cpuCores;
  const memoryBytes = value.memoryBytes;
  const memorySwapBytes = value.memorySwapBytes;
  const pidsLimit = value.pidsLimit;
  const maximumInputBytes = value.maximumInputBytes;
  const maximumOutputBytes = value.maximumOutputBytes;
  const maximumRuntimeMilliseconds = value.maximumRuntimeMilliseconds;
  if (
    !isSafeIntegerInRange(cpuCores, 1, 4) ||
    !isSafeIntegerInRange(
      memoryBytes,
      MIN_CONTAINER_MEMORY_BYTES,
      MAX_CONTAINER_MEMORY_BYTES,
    ) ||
    memorySwapBytes !== memoryBytes ||
    !isSafeIntegerInRange(pidsLimit, 1, MAX_CONTAINER_PIDS) ||
    !isSafeIntegerInRange(
      maximumInputBytes,
      1,
      MAX_CONTAINER_ARTIFACT_BYTES,
    ) ||
    !isSafeIntegerInRange(
      maximumOutputBytes,
      1,
      MAX_CONTAINER_ARTIFACT_BYTES,
    ) ||
    !isSafeIntegerInRange(
      maximumRuntimeMilliseconds,
      100,
      MAX_CONTAINER_RUNTIME_MILLISECONDS,
    )
  ) {
    return null;
  }
  return Object.freeze({
    cpuCores,
    memoryBytes,
    memorySwapBytes,
    pidsLimit,
    maximumInputBytes,
    maximumOutputBytes,
    maximumRuntimeMilliseconds,
  });
}

export function parseLocalOfflinePreviewContainerConfiguration(
  value: unknown,
): LocalOfflinePreviewContainerConfiguration | null {
  if (!isPlainObject(value) || !hasExactStringKeys(value, CONFIGURATION_KEYS)) {
    return null;
  }
  const fixedEntrypoint = parseEntrypoint(value.fixedEntrypoint);
  const resourceLimits = parseResourceLimits(value.resourceLimits);
  if (
    value.schemaVersion !== LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V1 ||
    value.authority !== "none" ||
    value.fallbackPolicy !== "block" ||
    value.containerPlatform !== "linux/amd64" ||
    typeof value.dockerExecutablePath !== "string" ||
    value.dockerExecutablePath.length === 0 ||
    value.dockerExecutablePath.length > 32_767 ||
    typeof value.seccompProfilePath !== "string" ||
    value.seccompProfilePath.length === 0 ||
    value.seccompProfilePath.length > 32_767 ||
    typeof value.seccompProfileSha256 !== "string" ||
    !SHA256.test(value.seccompProfileSha256) ||
    value.seccompDefaultAction !== "SCMP_ACT_ERRNO" ||
    typeof value.imageReference !== "string" ||
    !IMAGE_REFERENCE.test(value.imageReference) ||
    typeof value.imageId !== "string" ||
    !SHA256.test(value.imageId) ||
    value.imagePullPolicy !== "never" ||
    value.networkMode !== "none" ||
    value.rootFilesystem !== "read_only" ||
    value.mountPolicy !== "none" ||
    value.capabilityPolicy !== "drop_all" ||
    value.noNewPrivileges !== true ||
    !isSafeIntegerInRange(value.userId, 1, 65_534) ||
    !isSafeIntegerInRange(value.groupId, 1, 65_534) ||
    value.workerKind !== "offline_normalization_preview" ||
    typeof value.workerProtocolSha256 !== "string" ||
    !SHA256.test(value.workerProtocolSha256) ||
    typeof value.workerArtifactSha256 !== "string" ||
    !SHA256.test(value.workerArtifactSha256) ||
    fixedEntrypoint === null ||
    resourceLimits === null
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    authority: value.authority,
    fallbackPolicy: value.fallbackPolicy,
    containerPlatform: value.containerPlatform,
    dockerExecutablePath: value.dockerExecutablePath,
    seccompProfilePath: value.seccompProfilePath,
    seccompProfileSha256: value.seccompProfileSha256,
    seccompDefaultAction: value.seccompDefaultAction,
    imageReference: value.imageReference,
    imageId: value.imageId,
    imagePullPolicy: value.imagePullPolicy,
    networkMode: value.networkMode,
    rootFilesystem: value.rootFilesystem,
    mountPolicy: value.mountPolicy,
    capabilityPolicy: value.capabilityPolicy,
    noNewPrivileges: value.noNewPrivileges,
    userId: value.userId,
    groupId: value.groupId,
    workerKind: value.workerKind,
    workerProtocolSha256: value.workerProtocolSha256,
    workerArtifactSha256: value.workerArtifactSha256,
    fixedEntrypoint,
    resourceLimits,
  });
}

function pathIsAbsoluteAndLexicallyCanonical(value: string): boolean {
  return (
    isAbsolute(value) &&
    normalizePath(value) === value &&
    resolvePath(value) === value
  );
}

function canonicalPathsEqual(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}

function fileStatsMatch(
  before: BigIntStats,
  after: BigIntStats,
): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.nlink === after.nlink &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

async function readHandleBounded(
  handle: FileHandle,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (totalBytes <= maximumBytes) {
    const remaining = maximumBytes + 1 - totalBytes;
    const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, remaining));
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    chunks.push(chunk.subarray(0, bytesRead));
  }
  if (totalBytes > maximumBytes) return null;
  return Buffer.concat(chunks, totalBytes);
}

export const defaultLocalOfflinePreviewContainerFileProbe:
LocalOfflinePreviewContainerFileProbe = async (request) => {
  try {
    const pathLstatBefore = await lstat(request.absolutePath, { bigint: true });
    if (pathLstatBefore.isSymbolicLink()) {
      return {
        outcome: "ok",
        canonicalPath: await realpath(request.absolutePath),
        fileType: "other",
        symbolicLink: true,
        contents: null,
      };
    }
    const canonicalPathBefore = await realpath(request.absolutePath);
    const pathStatBefore = await stat(request.absolutePath, { bigint: true });
    if (!pathStatBefore.isFile()) {
      return {
        outcome: "ok",
        canonicalPath: canonicalPathBefore,
        fileType: "other",
        symbolicLink: false,
        contents: null,
      };
    }
    const handle = await open(request.absolutePath, "r");
    try {
      const handleStatBefore = await handle.stat({ bigint: true });
      if (!handleStatBefore.isFile()) return { outcome: "unavailable" };
      if (!fileStatsMatch(pathStatBefore, handleStatBefore)) {
        return { outcome: "changed" };
      }
      if (
        request.readContents &&
        handleStatBefore.size > BigInt(request.maximumBytes)
      ) {
        return { outcome: "too_large" };
      }
      const contents = request.readContents
        ? await readHandleBounded(handle, request.maximumBytes)
        : null;
      if (request.readContents && contents === null) {
        return { outcome: "too_large" };
      }
      const handleStatAfter = await handle.stat({ bigint: true });
      if (!fileStatsMatch(handleStatBefore, handleStatAfter)) {
        return { outcome: "changed" };
      }
      const pathLstatAfter = await lstat(request.absolutePath, {
        bigint: true,
      });
      const pathStatAfter = await stat(request.absolutePath, { bigint: true });
      const canonicalPathAfter = await realpath(request.absolutePath);
      if (
        pathLstatAfter.isSymbolicLink() ||
        !canonicalPathsEqual(canonicalPathBefore, canonicalPathAfter) ||
        !fileStatsMatch(pathLstatBefore, pathLstatAfter) ||
        !fileStatsMatch(pathStatBefore, pathStatAfter) ||
        !fileStatsMatch(handleStatAfter, pathStatAfter)
      ) {
        return { outcome: "changed" };
      }
      return {
        outcome: "ok",
        canonicalPath: canonicalPathAfter,
        fileType: "regular",
        symbolicLink: false,
        contents,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return { outcome: "unavailable" };
  }
};

function dockerArguments(
  request: LocalOfflinePreviewDockerCommandProbeRequest,
): readonly string[] | null {
  const format = "{{json .}}";
  if (request.command === "version" && request.imageReference === null) {
    return ["version", "--format", format];
  }
  if (request.command === "info" && request.imageReference === null) {
    return ["info", "--format", format];
  }
  if (
    request.command === "image_inspect" &&
    request.imageReference !== null &&
    IMAGE_REFERENCE.test(request.imageReference)
  ) {
    return [
      "image",
      "inspect",
      request.imageReference,
      "--format",
      format,
    ];
  }
  return null;
}

function dockerCliEnvironment(): Readonly<Record<string, string>> {
  return process.platform === "win32"
    ? Object.freeze({
        DOCKER_HOST: "npipe:////./pipe/dockerDesktopLinuxEngine",
      })
    : Object.freeze({ DOCKER_HOST: "unix:///var/run/docker.sock" });
}

function toBuffer(chunk: Buffer | string): Buffer {
  return typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
}

export const defaultLocalOfflinePreviewDockerCommandProbe:
LocalOfflinePreviewDockerCommandProbe = async (request) => {
  const argumentsList = dockerArguments(request);
  if (
    argumentsList === null ||
    request.timeoutMilliseconds < 1 ||
    request.timeoutMilliseconds > COMMAND_TIMEOUT_MILLISECONDS ||
    request.maximumStdoutBytes < 1 ||
    request.maximumStdoutBytes > MAX_COMMAND_STDOUT_BYTES ||
    request.maximumStderrBytes < 1 ||
    request.maximumStderrBytes > MAX_COMMAND_STDERR_BYTES
  ) {
    return { outcome: "failed_to_start" };
  }
  return await new Promise<LocalOfflinePreviewDockerCommandProbeResult>(
    (resolve) => {
      let settled = false;
      let stdoutByteLength = 0;
      let stderrByteLength = 0;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const stdoutChunks: Buffer[] = [];
      const child = spawn(request.executablePath, argumentsList, {
        env: dockerCliEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const finish = (
        result: LocalOfflinePreviewDockerCommandProbeResult,
      ): void => {
        if (settled) return;
        settled = true;
        if (timeout !== null) clearTimeout(timeout);
        resolve(result);
      };
      const stopForLimit = (): void => {
        stdoutChunks.length = 0;
        child.stdout.destroy();
        child.stderr.destroy();
        child.kill("SIGKILL");
        child.unref();
        finish({ outcome: "output_limit_exceeded" });
      };
      child.stdout.on("data", (rawChunk: Buffer | string) => {
        if (settled) return;
        const chunk = toBuffer(rawChunk);
        stdoutByteLength += chunk.byteLength;
        if (stdoutByteLength > request.maximumStdoutBytes) {
          stopForLimit();
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr.on("data", (rawChunk: Buffer | string) => {
        if (settled) return;
        stderrByteLength += toBuffer(rawChunk).byteLength;
        if (stderrByteLength > request.maximumStderrBytes) stopForLimit();
      });
      child.once("error", () => {
        finish({ outcome: "failed_to_start" });
      });
      child.once("close", (exitCode) => {
        if (settled) return;
        finish({
          outcome: "completed",
          exitCode,
          stdout: Buffer.concat(stdoutChunks, stdoutByteLength),
          stderrByteLength,
        });
      });
      timeout = setTimeout(() => {
        stdoutChunks.length = 0;
        child.stdout.destroy();
        child.stderr.destroy();
        child.kill("SIGKILL");
        child.unref();
        finish({ outcome: "timed_out" });
      }, request.timeoutMilliseconds);
    },
  );
};

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function decodeJsonObject(bytes: Uint8Array): JsonObject | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const entries: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== "string") return null;
    entries.push(entry);
  }
  return entries;
}

function validateSeccompProfile(
  bytes: Uint8Array,
  configuration: ParsedConfiguration,
): LocalOfflinePreviewContainerPreflightErrorCode | null {
  if (sha256(bytes) !== configuration.seccompProfileSha256) {
    return "SECCOMP_PROFILE_DIGEST_MISMATCH";
  }
  const profile = decodeJsonObject(bytes);
  if (profile === null) return "SECCOMP_PROFILE_MALFORMED";
  if (profile.defaultAction !== configuration.seccompDefaultAction) {
    return "SECCOMP_DEFAULT_DENY_REQUIRED";
  }
  if (!Array.isArray(profile.syscalls)) return "SECCOMP_PROFILE_MALFORMED";
  for (const ruleValue of profile.syscalls) {
    if (!isPlainObject(ruleValue)) return "SECCOMP_PROFILE_MALFORMED";
    const names = stringArray(ruleValue.names);
    if (names === null || typeof ruleValue.action !== "string") {
      return "SECCOMP_PROFILE_MALFORMED";
    }
    if (
      !DENYING_SECCOMP_ACTIONS.has(ruleValue.action) &&
      names.some((name) => FORBIDDEN_SECCOMP_SYSCALLS.has(name))
    ) {
      return "SECCOMP_FORBIDDEN_SYSCALL_ALLOWED";
    }
  }
  return null;
}

function mapFileProbeFailure(
  result: LocalOfflinePreviewContainerFileProbeResult,
  kind: "docker" | "seccomp",
): LocalOfflinePreviewContainerPreflightErrorCode | null {
  if (result.outcome === "unavailable") {
    return kind === "docker"
      ? "DOCKER_EXECUTABLE_PROBE_FAILED"
      : "SECCOMP_PROFILE_PROBE_FAILED";
  }
  if (result.outcome === "too_large") {
    return kind === "docker"
      ? "DOCKER_EXECUTABLE_PROBE_FAILED"
      : "SECCOMP_PROFILE_TOO_LARGE";
  }
  if (result.outcome === "changed") {
    return kind === "docker"
      ? "DOCKER_EXECUTABLE_CHANGED"
      : "SECCOMP_PROFILE_CHANGED";
  }
  return null;
}

async function verifyFileBindings(
  configuration: ParsedConfiguration,
  fileProbe: LocalOfflinePreviewContainerFileProbe,
): Promise<LocalOfflinePreviewContainerPreflightErrorCode | null> {
  if (!pathIsAbsoluteAndLexicallyCanonical(configuration.dockerExecutablePath)) {
    return "DOCKER_EXECUTABLE_PATH_REJECTED";
  }
  if (!pathIsAbsoluteAndLexicallyCanonical(configuration.seccompProfilePath)) {
    return "SECCOMP_PROFILE_PATH_REJECTED";
  }
  const dockerResult = await fileProbe({
    absolutePath: configuration.dockerExecutablePath,
    readContents: false,
    maximumBytes: 0,
  });
  const dockerFailure = mapFileProbeFailure(dockerResult, "docker");
  if (dockerFailure !== null) return dockerFailure;
  if (dockerResult.outcome !== "ok") return "DOCKER_EXECUTABLE_PROBE_FAILED";
  if (dockerResult.symbolicLink) return "DOCKER_EXECUTABLE_SYMLINK_REJECTED";
  if (dockerResult.fileType !== "regular") {
    return "DOCKER_EXECUTABLE_NOT_REGULAR_FILE";
  }
  if (
    !canonicalPathsEqual(
      dockerResult.canonicalPath,
      configuration.dockerExecutablePath,
    )
  ) {
    return "DOCKER_EXECUTABLE_CHANGED";
  }
  const seccompResult = await fileProbe({
    absolutePath: configuration.seccompProfilePath,
    readContents: true,
    maximumBytes: MAX_SECURITY_PROFILE_BYTES,
  });
  const seccompFailure = mapFileProbeFailure(seccompResult, "seccomp");
  if (seccompFailure !== null) return seccompFailure;
  if (seccompResult.outcome !== "ok") return "SECCOMP_PROFILE_PROBE_FAILED";
  if (seccompResult.symbolicLink) return "SECCOMP_PROFILE_SYMLINK_REJECTED";
  if (seccompResult.fileType !== "regular") {
    return "SECCOMP_PROFILE_NOT_REGULAR_FILE";
  }
  if (
    !canonicalPathsEqual(
      seccompResult.canonicalPath,
      configuration.seccompProfilePath,
    )
  ) {
    return "SECCOMP_PROFILE_CHANGED";
  }
  if (seccompResult.contents === null) return "SECCOMP_PROFILE_PROBE_FAILED";
  return validateSeccompProfile(seccompResult.contents, configuration);
}

function commandRequest(
  configuration: ParsedConfiguration,
  command: CommandStage,
): LocalOfflinePreviewDockerCommandProbeRequest {
  return Object.freeze({
    executablePath: configuration.dockerExecutablePath,
    command,
    imageReference:
      command === "image_inspect" ? configuration.imageReference : null,
    timeoutMilliseconds: COMMAND_TIMEOUT_MILLISECONDS,
    maximumStdoutBytes: MAX_COMMAND_STDOUT_BYTES,
    maximumStderrBytes: MAX_COMMAND_STDERR_BYTES,
  });
}

async function runJsonCommand(
  configuration: ParsedConfiguration,
  commandProbe: LocalOfflinePreviewDockerCommandProbe,
  stage: CommandStage,
): Promise<ParsedCommandObject> {
  const codes = COMMAND_ERROR_CODES[stage];
  const result = await commandProbe(commandRequest(configuration, stage));
  switch (result.outcome) {
    case "timed_out":
      return { ok: false, code: codes.timeout };
    case "output_limit_exceeded":
      return { ok: false, code: codes.outputLimit };
    case "failed_to_start":
      return { ok: false, code: codes.invocation };
    case "completed":
      break;
  }
  if (
    result.exitCode !== 0 ||
    result.stdout.byteLength > MAX_COMMAND_STDOUT_BYTES ||
    result.stderrByteLength > MAX_COMMAND_STDERR_BYTES
  ) {
    return {
      ok: false,
      code:
        result.stdout.byteLength > MAX_COMMAND_STDOUT_BYTES ||
        result.stderrByteLength > MAX_COMMAND_STDERR_BYTES
          ? codes.outputLimit
          : codes.command,
    };
  }
  const parsed = decodeJsonObject(result.stdout);
  return parsed === null
    ? { ok: false, code: codes.malformed }
    : { ok: true, value: parsed };
}

function requireJsonObject(value: unknown): JsonObject | null {
  return isPlainObject(value) ? value : null;
}

function validateVersion(
  version: JsonObject,
): LocalOfflinePreviewContainerPreflightErrorCode | null {
  if (requireJsonObject(version.Client) === null) {
    return "DOCKER_VERSION_RESPONSE_MALFORMED";
  }
  const server = requireJsonObject(version.Server);
  if (server === null) return "DOCKER_SERVER_UNAVAILABLE";
  if (typeof server.Version !== "string" || server.Version.length === 0) {
    return "DOCKER_VERSION_RESPONSE_MALFORMED";
  }
  if (server.Os !== "linux" || server.Arch !== "amd64") {
    return "DOCKER_PLATFORM_UNSUPPORTED";
  }
  return null;
}

function validateDockerInfo(
  info: JsonObject,
): LocalOfflinePreviewContainerPreflightErrorCode | null {
  if (info.OSType !== "linux") return "DOCKER_PLATFORM_UNSUPPORTED";
  if (info.Architecture !== "x86_64" && info.Architecture !== "amd64") {
    return "DOCKER_PLATFORM_UNSUPPORTED";
  }
  if (info.CgroupVersion !== "2") return "DOCKER_CGROUP_V2_REQUIRED";
  const securityOptions = stringArray(info.SecurityOptions);
  if (securityOptions === null) return "DOCKER_INFO_RESPONSE_MALFORMED";
  if (!securityOptions.some((option) => option.startsWith("name=seccomp"))) {
    return "DOCKER_SECCOMP_REQUIRED";
  }
  return null;
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function absentOrEmptyObject(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isPlainObject(value) && Reflect.ownKeys(value).length === 0)
  );
}

function requiredImageLabelsMatch(
  labels: JsonObject,
  configuration: ParsedConfiguration,
): boolean {
  return (
    labels[LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerKind] ===
      configuration.workerKind &&
    labels[
      LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerProtocolSha256
    ] === configuration.workerProtocolSha256 &&
    labels[
      LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerArtifactSha256
    ] === configuration.workerArtifactSha256 &&
    labels[
      LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.seccompProfileSha256
    ] === configuration.seccompProfileSha256
  );
}

function validateImageIdentity(
  image: JsonObject,
  configuration: ParsedConfiguration,
): LocalOfflinePreviewContainerPreflightErrorCode | null {
  if (image.Os !== "linux" || image.Architecture !== "amd64") {
    return "IMAGE_PLATFORM_MISMATCH";
  }
  if (image.Id !== configuration.imageId) return "IMAGE_ID_MISMATCH";
  const repoDigests = stringArray(image.RepoDigests);
  if (
    repoDigests === null ||
    !repoDigests.includes(configuration.imageReference)
  ) {
    return "IMAGE_REPOSITORY_DIGEST_MISMATCH";
  }
  return null;
}

function validateImageConfiguration(
  image: JsonObject,
  configuration: ParsedConfiguration,
): LocalOfflinePreviewContainerPreflightErrorCode | null {
  const imageConfiguration = requireJsonObject(image.Config);
  if (imageConfiguration === null) return "IMAGE_INSPECT_RESPONSE_MALFORMED";
  const labels = requireJsonObject(imageConfiguration.Labels);
  if (labels === null || !requiredImageLabelsMatch(labels, configuration)) {
    return "IMAGE_LABEL_MISMATCH";
  }
  const expectedUser =
    `${String(configuration.userId)}:${String(configuration.groupId)}`;
  if (imageConfiguration.User !== expectedUser) {
    return "IMAGE_NONROOT_USER_MISMATCH";
  }
  const entrypoint = stringArray(imageConfiguration.Entrypoint);
  if (
    entrypoint === null ||
    !arraysEqual(entrypoint, configuration.fixedEntrypoint)
  ) {
    return "IMAGE_ENTRYPOINT_MISMATCH";
  }
  const defaultCommand = imageConfiguration.Cmd;
  if (
    defaultCommand !== undefined &&
    defaultCommand !== null &&
    (!Array.isArray(defaultCommand) || defaultCommand.length !== 0)
  ) {
    return "IMAGE_DEFAULT_COMMAND_REJECTED";
  }
  if (!absentOrEmptyObject(imageConfiguration.ExposedPorts)) {
    return "IMAGE_EXPOSED_PORTS_REJECTED";
  }
  if (!absentOrEmptyObject(imageConfiguration.Volumes)) {
    return "IMAGE_DECLARED_VOLUMES_REJECTED";
  }
  if (
    imageConfiguration.Healthcheck !== undefined &&
    imageConfiguration.Healthcheck !== null
  ) {
    return "IMAGE_HEALTHCHECK_REJECTED";
  }
  return null;
}

async function executePreflight(
  configuration: ParsedConfiguration,
  dependencies: LocalOfflinePreviewContainerPreflightDependencies,
): Promise<LocalOfflinePreviewContainerPreflightReport> {
  const fileFailure = await verifyFileBindings(
    configuration,
    dependencies.fileProbe ?? defaultLocalOfflinePreviewContainerFileProbe,
  );
  if (fileFailure !== null) return blocked(fileFailure);
  const commandProbe =
    dependencies.commandProbe ?? defaultLocalOfflinePreviewDockerCommandProbe;
  const version = await runJsonCommand(configuration, commandProbe, "version");
  if (!version.ok) return blocked(version.code);
  const versionFailure = validateVersion(version.value);
  if (versionFailure !== null) return blocked(versionFailure);
  const info = await runJsonCommand(configuration, commandProbe, "info");
  if (!info.ok) return blocked(info.code);
  const infoFailure = validateDockerInfo(info.value);
  if (infoFailure !== null) return blocked(infoFailure);
  const image = await runJsonCommand(
    configuration,
    commandProbe,
    "image_inspect",
  );
  if (!image.ok) return blocked(image.code);
  const identityFailure = validateImageIdentity(image.value, configuration);
  if (identityFailure !== null) return blocked(identityFailure);
  const imageConfigurationFailure = validateImageConfiguration(
    image.value,
    configuration,
  );
  return imageConfigurationFailure === null
    ? eligible()
    : blocked(imageConfigurationFailure);
}

/**
 * Performs read-only eligibility checks. An eligible result is not a runtime
 * isolation receipt and deliberately keeps sandboxEstablished set to false.
 */
export async function preflightLocalOfflineNormalizationPreviewContainer(
  configurationInput: unknown,
  dependencies: LocalOfflinePreviewContainerPreflightDependencies = {},
): Promise<LocalOfflinePreviewContainerPreflightReport> {
  try {
    const configuration = parseLocalOfflinePreviewContainerConfiguration(
      configurationInput,
    );
    if (configuration === null) {
      return blocked("PREFLIGHT_CONFIGURATION_REJECTED");
    }
    return await executePreflight(configuration, dependencies);
  } catch {
    return blocked("PREFLIGHT_INTERNAL_FAILURE");
  }
}

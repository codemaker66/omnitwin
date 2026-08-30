import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  normalize,
  posix,
  resolve,
} from "node:path";

import {
  FoundryRestorationExperimentV0Schema,
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import sharp from "sharp";
import { z } from "zod";

import {
  GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME,
  GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME,
  GRAND_HALL_DIFIX_INPUT_HEIGHT,
  GRAND_HALL_DIFIX_INPUT_WIDTH,
  GRAND_HALL_DIFIX_MANIFEST_FILENAME,
  GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME,
  GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME,
} from "./grand-hall-difix-no-reference-input-pack-contract.js";
import {
  checkGrandHallDifixNoReferenceInputPack,
} from "./grand-hall-difix-no-reference-input-pack.js";
import {
  GRAND_HALL_DIFIX_EXPLICIT_RUN_OPT_IN,
  GrandHallDifixExecutionAuthorizationSchema,
  GrandHallDifixExecutionLockSchema,
  GrandHallDifixModelSealSchema,
  GrandHallDifixRuntimeSealSchema,
  assertGrandHallDifixBaseExperimentNotAuthorized,
  assertGrandHallDifixExperimentBindingProjectionMatches,
  assertGrandHallDifixExperimentMatchesMaterials,
  assertGrandHallDifixAuthorizationCurrent,
  assertGrandHallDifixAuthorizationMatchesLock,
  compileGrandHallDifixExecutionAuthorization,
  compileGrandHallDifixExecutionLock,
  createGrandHallDifixAttemptReceipt,
  createGrandHallDifixAuthorizationClaim,
  grandHallDifixExpectedLocalExperimentMaterials,
  type GrandHallDifixAttemptReceipt,
  type GrandHallDifixBoundFile,
  type GrandHallDifixExecutionAuthorization,
  type GrandHallDifixExecutionLock,
  type GrandHallDifixModelSeal,
  type GrandHallDifixRuntimeSeal,
} from "./grand-hall-difix-one-shot-contract.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

const MATERIAL_SET_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_DIFIX_MATERIAL_SET_V1";
const MAX_JSON_BYTES = 512 * 1024 * 1024;
const MAX_ADAPTER_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
const OOM_EXIT_CODE = 86;
const PYTHON_STABLE_SCRIPT_BOOTSTRAP = String.raw`import hashlib
import os
import stat
import sys

path = sys.argv[1]
expected_sha256 = sys.argv[2]
expected_size = int(sys.argv[3])
before = os.stat(path, follow_symlinks=False)
if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
    raise RuntimeError("bound Python script must be a direct single-link regular file")
descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0))
try:
    opened_before = os.fstat(descriptor)
    chunks = []
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            break
        chunks.append(chunk)
    source = b"".join(chunks)
    opened_after = os.fstat(descriptor)
finally:
    os.close(descriptor)
after = os.stat(path, follow_symlinks=False)
identity = lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
if identity(before) != identity(opened_before) or identity(opened_before) != identity(opened_after) or identity(opened_after) != identity(after):
    raise RuntimeError("bound Python script changed during stable read")
actual_sha256 = "sha256:" + hashlib.sha256(source).hexdigest()
if len(source) != expected_size or actual_sha256 != expected_sha256:
    raise RuntimeError("bound Python script differs from exact expected bytes")
sys.argv = [path, *sys.argv[4:]]
namespace = {"__name__": "__main__", "__file__": path, "__package__": None, "__cached__": None}
exec(compile(source, path, "exec", dont_inherit=True), namespace)
`;

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const HostPathSchema = z.string().min(3).max(4_096).refine(
  (value) => isAbsolute(value),
  "host path must be absolute",
);
const WslPathSchema = z.string().min(2).max(4_096).refine(
  (value) => value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."),
  "WSL path must be absolute and normalized",
);

export type GrandHallDifixOneShotErrorCode =
  | "INPUT_INVALID"
  | "INPUT_RACE"
  | "OUTPUT_EXISTS"
  | "OUTPUT_UNSAFE"
  | "AUTHORIZATION_INVALID"
  | "AUTHORIZATION_CONSUMED"
  | "PREFLIGHT_FAILED"
  | "MATERIAL_MISMATCH"
  | "PROCESS_FAILED";

export class GrandHallDifixOneShotError extends Error {
  constructor(
    readonly code: GrandHallDifixOneShotErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallDifixOneShotError";
  }
}

export class GrandHallDifixClaimPublicationError extends GrandHallDifixOneShotError {
  constructor(
    readonly plannedClaimSha256: string,
    cause: unknown,
  ) {
    super(
      "PROCESS_FAILED",
      "The authorization claim path was atomically consumed, but its receipt could not be completed.",
      cause,
    );
    this.name = "GrandHallDifixClaimPublicationError";
  }
}

export async function completeGrandHallDifixConsumedPrelaunch<T>(input: {
  readonly plannedClaimSha256: string;
  readonly consumeAuthorization: () => Promise<string>;
  readonly runExhaustivePrelaunch: () => Promise<T>;
  readonly publishConsumedFailure: (error: unknown) => Promise<void>;
}): Promise<{ readonly claimSha256: string; readonly value: T }> {
  let claimPublished = false;
  try {
    const claimSha256 = await input.consumeAuthorization();
    claimPublished = true;
    if (claimSha256 !== input.plannedClaimSha256) {
      fail("INPUT_RACE", "Published authorization claim digest differs from its planned bytes.");
    }
    const value = await input.runExhaustivePrelaunch();
    return { claimSha256, value };
  } catch (error) {
    const pathWasConsumed = claimPublished || error instanceof GrandHallDifixClaimPublicationError;
    if (pathWasConsumed) await input.publishConsumedFailure(error);
    throw error;
  }
}

interface StableFile {
  readonly absolutePath: string;
  readonly bytes: Buffer;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly identity: string;
}

function fail(
  code: GrandHallDifixOneShotErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new GrandHallDifixOneShotError(code, message, cause);
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

export function grandHallDifixStablePythonScriptArguments(input: {
  readonly pythonWsl: string;
  readonly scriptWsl: string;
  readonly scriptSha256: string;
  readonly scriptSizeBytes: number;
  readonly scriptArguments: readonly string[];
  readonly noSite: boolean;
}): string[] {
  const python = WslPathSchema.parse(input.pythonWsl);
  const script = WslPathSchema.parse(input.scriptWsl);
  const expectedSha256 = Sha256Schema.parse(input.scriptSha256);
  if (!Number.isSafeInteger(input.scriptSizeBytes) || input.scriptSizeBytes <= 0) {
    fail("INPUT_INVALID", "Bound Python script size must be a positive safe integer.");
  }
  return [
    python,
    "-I",
    "-B",
    ...(input.noSite ? ["-S"] : []),
    "-c",
    PYTHON_STABLE_SCRIPT_BOOTSTRAP,
    script,
    expectedSha256,
    String(input.scriptSizeBytes),
    ...input.scriptArguments,
  ];
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function comparablePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function samePath(left: string, right: string): boolean {
  return comparablePath(resolve(left)) === comparablePath(resolve(right));
}

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code;
}

function canonicalHostPath(value: string, label: string): string {
  if (!isAbsolute(value)) fail("OUTPUT_UNSAFE", `${label} must be absolute.`);
  const resolved = resolve(value);
  if (!samePath(resolved, normalize(value))) fail("OUTPUT_UNSAFE", `${label} must be normalized.`);
  return resolved;
}

function isDirectWslChild(parent: string, candidate: string): boolean {
  const prefix = `${parent.replace(/\/+$/u, "")}/`;
  return candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/");
}

function statIdentity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode, stats.nlink, stats.size, stats.mtimeNs, stats.ctimeNs]
    .map(String)
    .join(":");
}

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return statIdentity(left) === statIdentity(right);
}

async function stableRead(
  pathInput: string,
  label: string,
  maximumBytes: number,
): Promise<StableFile> {
  const absolutePath = canonicalHostPath(pathInput, label);
  const physicalPath = await realpath(absolutePath).catch((error: unknown) => (
    fail("INPUT_INVALID", `${label} cannot be resolved.`, error)
  ));
  if (!samePath(absolutePath, physicalPath)) fail("INPUT_INVALID", `${label} must not traverse a link or junction.`);
  const before = await lstat(absolutePath, { bigint: true }).catch((error: unknown) => (
    fail("INPUT_INVALID", `${label} is unavailable.`, error)
  ));
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    fail("INPUT_INVALID", `${label} must be a direct, single-link regular file.`);
  }
  if (before.size < 0n || before.size > BigInt(maximumBytes)) fail("INPUT_INVALID", `${label} has an invalid size.`);
  const handle = await open(absolutePath, "r").catch((error: unknown) => (
    fail("INPUT_INVALID", `${label} could not be opened.`, error)
  ));
  try {
    const openedBefore = await handle.stat({ bigint: true });
    if (!sameNode(before, openedBefore)) fail("INPUT_RACE", `${label} changed before its stable read.`);
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolutePath, { bigint: true });
    if (
      bytes.byteLength !== Number(openedBefore.size)
      || !sameNode(openedBefore, openedAfter)
      || !sameNode(openedAfter, pathAfter)
    ) fail("INPUT_RACE", `${label} changed during its stable read.`);
    return {
      absolutePath,
      bytes,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      identity: statIdentity(openedAfter),
    };
  } finally {
    await handle.close();
  }
}

async function requireDirectDirectory(pathInput: string, label: string): Promise<string> {
  const absolutePath = canonicalHostPath(pathInput, label);
  const physicalPath = await realpath(absolutePath).catch((error: unknown) => (
    fail("OUTPUT_UNSAFE", `${label} does not exist.`, error)
  ));
  if (!samePath(absolutePath, physicalPath)) fail("OUTPUT_UNSAFE", `${label} must not be a link or junction.`);
  const stats = await lstat(absolutePath, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail("OUTPUT_UNSAFE", `${label} must be a direct directory.`);
  return absolutePath;
}

async function requireAbsent(pathInput: string, label: string): Promise<void> {
  const path = canonicalHostPath(pathInput, label);
  const stats = await lstat(path, { bigint: true }).catch((error: unknown) => {
    if (hasErrnoCode(error, "ENOENT")) return null;
    throw error;
  });
  if (stats !== null) fail("OUTPUT_EXISTS", `${label} already exists and will not be replaced.`);
}

async function boundFile(
  hostPath: string,
  wslPath: string,
  label: string,
  maximumBytes = MAX_JSON_BYTES,
): Promise<GrandHallDifixBoundFile> {
  const stable = await stableRead(hostPath, label, maximumBytes);
  return {
    hostPath: stable.absolutePath,
    wslPath: WslPathSchema.parse(wslPath),
    sizeBytes: stable.sizeBytes,
    sha256: stable.sha256,
  };
}

async function assertBoundFile(
  expected: GrandHallDifixBoundFile,
  label: string,
  maximumBytes = MAX_JSON_BYTES,
): Promise<StableFile> {
  const stable = await stableRead(expected.hostPath, label, maximumBytes);
  if (stable.sizeBytes !== expected.sizeBytes || stable.sha256 !== expected.sha256) {
    fail("MATERIAL_MISMATCH", `${label} no longer matches its exact bound bytes.`);
  }
  return stable;
}

function parseStrictJson(bytes: Buffer, label: string): unknown {
  try {
    return parseGrandHallT554StrictJson(bytes);
  } catch (error) {
    fail("INPUT_INVALID", `${label} is not strict JSON.`, error);
  }
}

async function createOnlyJson(pathInput: string, value: unknown): Promise<void> {
  const path = canonicalHostPath(pathInput, "create-only JSON path");
  const handle = await open(path, "wx", 0o600).catch((error: unknown) => {
    if (hasErrnoCode(error, "EEXIST")) fail("OUTPUT_EXISTS", `${path} already exists and will not be replaced.`);
    throw error;
  });
  try {
    await handle.writeFile(canonicalBytes(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const ExecutionPathSpecSchema = z.object({
  executionLockHost: HostPathSchema,
  executionLockWsl: WslPathSchema,
  experimentHost: HostPathSchema,
  experimentWsl: WslPathSchema,
  inputPackDirectoryHost: HostPathSchema,
  inputPackDirectoryWsl: WslPathSchema,
  runtimeSealHost: HostPathSchema,
  runtimeSealWsl: WslPathSchema,
  modelSealHost: HostPathSchema,
  modelSealWsl: WslPathSchema,
  adapterHost: HostPathSchema,
  adapterWsl: WslPathSchema,
  runtimeSealToolHost: HostPathSchema,
  runtimeSealToolWsl: WslPathSchema,
  trustedVerifierPythonWsl: z.literal("/usr/bin/python3"),
  venvPythonWsl: WslPathSchema,
  providerSourceRootWsl: WslPathSchema,
  modelSnapshotRootWsl: WslPathSchema,
  controlDirectoryHost: HostPathSchema,
  controlDirectoryWsl: WslPathSchema,
  claimHost: HostPathSchema,
  claimWsl: WslPathSchema,
  attemptDirectoryHost: HostPathSchema,
  attemptDirectoryWsl: WslPathSchema,
  hfModulesCacheHost: HostPathSchema,
  hfModulesCacheWsl: WslPathSchema,
  torchHomeHost: HostPathSchema,
  torchHomeWsl: WslPathSchema,
  modelExecutionSnapshotHost: HostPathSchema,
  modelExecutionSnapshotWsl: WslPathSchema,
  outputImageHost: HostPathSchema,
  outputImageWsl: WslPathSchema,
  adapterReceiptHost: HostPathSchema,
  adapterReceiptWsl: WslPathSchema,
  stdoutHost: HostPathSchema,
  stdoutWsl: WslPathSchema,
  stderrHost: HostPathSchema,
  stderrWsl: WslPathSchema,
  startedReceiptHost: HostPathSchema,
  startedReceiptWsl: WslPathSchema,
  terminalReceiptHost: HostPathSchema,
  terminalReceiptWsl: WslPathSchema,
}).strict();

export const GrandHallDifixExecutionLockCompileSpecSchema = z.object({
  lockId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,159}$/u),
  compiledAt: z.string().datetime({ offset: true }),
  gitCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  wslDistribution: z.string().min(1).max(128),
  paths: ExecutionPathSpecSchema,
}).strict();
export type GrandHallDifixExecutionLockCompileSpec = z.infer<typeof GrandHallDifixExecutionLockCompileSpecSchema>;

function assertOutputLayout(spec: GrandHallDifixExecutionLockCompileSpec): void {
  const paths = spec.paths;
  const control = resolve(paths.controlDirectoryHost);
  const attempt = resolve(paths.attemptDirectoryHost);
  for (const [label, hostPath, wslPath] of [
    ["claim", paths.claimHost, paths.claimWsl],
    ["started receipt", paths.startedReceiptHost, paths.startedReceiptWsl],
    ["terminal receipt", paths.terminalReceiptHost, paths.terminalReceiptWsl],
  ] as const) {
    if (
      !samePath(dirname(hostPath), control)
      || !isDirectWslChild(paths.controlDirectoryWsl, wslPath)
    ) fail("OUTPUT_UNSAFE", `${label} must be a direct child of the exact control directory.`);
  }
  for (const [label, hostPath, wslPath] of [
    ["HF modules cache", paths.hfModulesCacheHost, paths.hfModulesCacheWsl],
    ["Torch home", paths.torchHomeHost, paths.torchHomeWsl],
    ["model execution snapshot", paths.modelExecutionSnapshotHost, paths.modelExecutionSnapshotWsl],
    ["output image", paths.outputImageHost, paths.outputImageWsl],
    ["adapter receipt", paths.adapterReceiptHost, paths.adapterReceiptWsl],
    ["stdout", paths.stdoutHost, paths.stdoutWsl],
    ["stderr", paths.stderrHost, paths.stderrWsl],
  ] as const) {
    if (
      !samePath(dirname(hostPath), attempt)
      || !isDirectWslChild(paths.attemptDirectoryWsl, wslPath)
    ) fail("OUTPUT_UNSAFE", `${label} must be a direct child of the exact attempt directory.`);
  }
  if (
    !samePath(dirname(paths.hfModulesCacheHost), attempt)
    || !samePath(dirname(paths.torchHomeHost), attempt)
    || samePath(paths.hfModulesCacheHost, paths.torchHomeHost)
    || !isDirectWslChild(paths.attemptDirectoryWsl, paths.hfModulesCacheWsl)
    || !isDirectWslChild(paths.attemptDirectoryWsl, paths.torchHomeWsl)
    || paths.hfModulesCacheWsl === paths.torchHomeWsl
  ) fail("OUTPUT_UNSAFE", "HF modules cache and Torch home must be distinct direct attempt-local children.");
  if (
    !samePath(dirname(paths.executionLockHost), control)
    || !isDirectWslChild(paths.controlDirectoryWsl, paths.executionLockWsl)
  ) {
    fail("OUTPUT_UNSAFE", "The execution lock must be written directly inside the control directory.");
  }
  const createOnlyHostPaths = [
    paths.executionLockHost,
    paths.claimHost,
    paths.startedReceiptHost,
    paths.terminalReceiptHost,
    paths.hfModulesCacheHost,
    paths.torchHomeHost,
    paths.modelExecutionSnapshotHost,
    paths.outputImageHost,
    paths.adapterReceiptHost,
    paths.stdoutHost,
    paths.stderrHost,
  ].map((path) => comparablePath(resolve(path)));
  if (new Set(createOnlyHostPaths).size !== createOnlyHostPaths.length) {
    fail("OUTPUT_UNSAFE", "Every create-only control, cache, log, receipt, and output path must be distinct.");
  }
}

async function parseSeal<T>(
  hostPath: string,
  label: string,
  schema: z.ZodType<T>,
): Promise<{ readonly stable: StableFile; readonly value: T }> {
  const stable = await stableRead(hostPath, label, MAX_JSON_BYTES);
  const value = schema.parse(parseStrictJson(stable.bytes, label));
  return { stable, value };
}

export async function compileGrandHallDifixExecutionLockFromSpec(
  specInput: unknown,
): Promise<GrandHallDifixExecutionLock> {
  const spec = GrandHallDifixExecutionLockCompileSpecSchema.parse(specInput);
  assertOutputLayout(spec);
  const paths = spec.paths;
  await requireDirectDirectory(paths.controlDirectoryHost, "control directory");
  await requireDirectDirectory(dirname(paths.attemptDirectoryHost), "attempt parent directory");
  for (const [label, path] of [
    ["execution lock", paths.executionLockHost],
    ["claim", paths.claimHost],
    ["attempt directory", paths.attemptDirectoryHost],
    ["HF modules cache", paths.hfModulesCacheHost],
    ["Torch home", paths.torchHomeHost],
    ["model execution snapshot", paths.modelExecutionSnapshotHost],
    ["started receipt", paths.startedReceiptHost],
    ["terminal receipt", paths.terminalReceiptHost],
  ] as const) await requireAbsent(path, label);

  const experimentResult = await parseSeal(
    paths.experimentHost,
    "immutable restoration experiment",
    FoundryRestorationExperimentV0Schema,
  );
  const runtimeResult = await parseSeal(
    paths.runtimeSealHost,
    "runtime seal",
    GrandHallDifixRuntimeSealSchema,
  );
  const modelResult = await parseSeal(
    paths.modelSealHost,
    "model seal",
    GrandHallDifixModelSealSchema,
  );
  const pack = await checkGrandHallDifixNoReferenceInputPack(paths.inputPackDirectoryHost);
  const manifestHost = resolve(paths.inputPackDirectoryHost, GRAND_HALL_DIFIX_MANIFEST_FILENAME);
  const publicationHost = resolve(paths.inputPackDirectoryHost, GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME);
  const sourceHost = resolve(paths.inputPackDirectoryHost, GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME);
  const sourceWsl = `${paths.inputPackDirectoryWsl}/${GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME}`;
  const packFile = async (
    fileName: string,
    label: string,
    maximumBytes = MAX_JSON_BYTES,
  ): Promise<GrandHallDifixBoundFile> => await boundFile(
    resolve(paths.inputPackDirectoryHost, fileName),
    `${paths.inputPackDirectoryWsl}/${fileName}`,
    label,
    maximumBytes,
  );
  const experimentMaterialRootHost = dirname(experimentResult.stable.absolutePath);
  const experimentMaterialRootWsl = posix.dirname(paths.experimentWsl);
  const experimentMaterials = await Promise.all(
    grandHallDifixExpectedLocalExperimentMaterials(experimentResult.value).map(async (expected) => {
      if (expected.relativePath.includes("/")) {
        fail("INPUT_INVALID", "Every generated experiment material must be one direct material-directory file.");
      }
      const material = await boundFile(
        resolve(experimentMaterialRootHost, expected.relativePath),
        `${experimentMaterialRootWsl}/${expected.relativePath}`,
        `experiment material ${expected.relativePath}`,
      );
      if (material.sizeBytes !== expected.sizeBytes || material.sha256 !== expected.sha256) {
        fail("MATERIAL_MISMATCH", `Experiment material ${expected.relativePath} disagrees with its planned bytes.`);
      }
      return {
        relativePath: expected.relativePath,
        artifactIds: [...expected.artifactIds],
        file: material,
      };
    }),
  );
  const executionPaths = {
    executionLockHost: canonicalHostPath(paths.executionLockHost, "execution lock"),
    executionLockWsl: paths.executionLockWsl,
    experiment: {
      hostPath: experimentResult.stable.absolutePath,
      wslPath: paths.experimentWsl,
      sizeBytes: experimentResult.stable.sizeBytes,
      sha256: experimentResult.stable.sha256,
    },
    experimentMaterials,
    inputPackDirectoryHost: canonicalHostPath(paths.inputPackDirectoryHost, "input pack directory"),
    inputPackDirectoryWsl: paths.inputPackDirectoryWsl,
    inputPackManifest: await boundFile(manifestHost, `${paths.inputPackDirectoryWsl}/${GRAND_HALL_DIFIX_MANIFEST_FILENAME}`, "input pack manifest"),
    inputPackPublicationReceipt: await boundFile(publicationHost, `${paths.inputPackDirectoryWsl}/${GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME}`, "input pack publication receipt"),
    sourceImage: await boundFile(sourceHost, sourceWsl, "source image", MAX_IMAGE_BYTES),
    browserCaptureRecord: await packFile(GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME, "browser capture record"),
    cameraArtifact: await packFile(pack.manifest.cameraArtifact.fileName, "camera artifact"),
    rendererArtifact: await packFile(pack.manifest.rendererArtifact.fileName, "renderer artifact"),
    reconstructionArtifact: await packFile(pack.manifest.reconstructionArtifact.fileName, "reconstruction artifact"),
    renderGenerationReceipt: await packFile(pack.manifest.renderGenerationReceipt.fileName, "render-generation receipt"),
    protectedMask: await packFile(GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME, "protected mask", MAX_IMAGE_BYTES),
    generatedRegionMask: await packFile(GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME, "generated-region mask", MAX_IMAGE_BYTES),
    runtimeSeal: {
      hostPath: runtimeResult.stable.absolutePath,
      wslPath: paths.runtimeSealWsl,
      sizeBytes: runtimeResult.stable.sizeBytes,
      sha256: runtimeResult.stable.sha256,
    },
    modelSeal: {
      hostPath: modelResult.stable.absolutePath,
      wslPath: paths.modelSealWsl,
      sizeBytes: modelResult.stable.sizeBytes,
      sha256: modelResult.stable.sha256,
    },
    adapter: await boundFile(paths.adapterHost, paths.adapterWsl, "Python adapter", MAX_ADAPTER_BYTES),
    runtimeSealTool: await boundFile(paths.runtimeSealToolHost, paths.runtimeSealToolWsl, "runtime seal tool", MAX_ADAPTER_BYTES),
    trustedVerifierPythonWsl: paths.trustedVerifierPythonWsl,
    venvPythonWsl: paths.venvPythonWsl,
    providerSourceRootWsl: paths.providerSourceRootWsl,
    modelSnapshotRootWsl: paths.modelSnapshotRootWsl,
    controlDirectoryHost: canonicalHostPath(paths.controlDirectoryHost, "control directory"),
    controlDirectoryWsl: paths.controlDirectoryWsl,
    claimHost: canonicalHostPath(paths.claimHost, "claim"),
    claimWsl: paths.claimWsl,
    attemptDirectoryHost: canonicalHostPath(paths.attemptDirectoryHost, "attempt directory"),
    attemptDirectoryWsl: paths.attemptDirectoryWsl,
    hfModulesCacheHost: canonicalHostPath(paths.hfModulesCacheHost, "HF modules cache"),
    hfModulesCacheWsl: paths.hfModulesCacheWsl,
    torchHomeHost: canonicalHostPath(paths.torchHomeHost, "Torch home"),
    torchHomeWsl: paths.torchHomeWsl,
    modelExecutionSnapshotHost: canonicalHostPath(paths.modelExecutionSnapshotHost, "model execution snapshot"),
    modelExecutionSnapshotWsl: paths.modelExecutionSnapshotWsl,
    sourceImageWsl: sourceWsl,
    outputImageHost: canonicalHostPath(paths.outputImageHost, "output image"),
    outputImageWsl: paths.outputImageWsl,
    adapterReceiptHost: canonicalHostPath(paths.adapterReceiptHost, "adapter receipt"),
    adapterReceiptWsl: paths.adapterReceiptWsl,
    stdoutHost: canonicalHostPath(paths.stdoutHost, "stdout"),
    stdoutWsl: paths.stdoutWsl,
    stderrHost: canonicalHostPath(paths.stderrHost, "stderr"),
    stderrWsl: paths.stderrWsl,
    startedReceiptHost: canonicalHostPath(paths.startedReceiptHost, "started receipt"),
    startedReceiptWsl: paths.startedReceiptWsl,
    terminalReceiptHost: canonicalHostPath(paths.terminalReceiptHost, "terminal receipt"),
    terminalReceiptWsl: paths.terminalReceiptWsl,
  };
  if (pack.publicationReceiptSha256 !== executionPaths.inputPackPublicationReceipt.sha256) {
    fail("MATERIAL_MISMATCH", "Input-pack checker and bound publication receipt disagree.");
  }
  const lock = compileGrandHallDifixExecutionLock({
    lockId: spec.lockId,
    compiledAt: spec.compiledAt,
    gitCommit: spec.gitCommit,
    experiment: experimentResult.value,
    runtimeSeal: runtimeResult.value,
    modelSeal: modelResult.value,
    inputPack: pack,
    inputPackManifestSha256: executionPaths.inputPackManifest.sha256,
    inputPackPublicationReceiptSha256: executionPaths.inputPackPublicationReceipt.sha256,
    inputPackBundleMaterialSha256: pack.manifest.bundleMaterialSha256,
    paths: executionPaths,
    wslDistribution: spec.wslDistribution,
  });
  await createOnlyJson(paths.executionLockHost, lock);
  return lock;
}

export const GrandHallDifixAuthorizationCompileSpecSchema = z.object({
  authorizationId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,159}$/u),
  executionLockHost: HostPathSchema,
  objectiveArtifactHost: HostPathSchema,
  objectiveArtifactWsl: WslPathSchema,
  objectiveArtifactStatementSha256: Sha256Schema,
  actorId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,159}$/u),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  nonce: z.string().regex(/^[a-f0-9]{64}$/u),
  outputHost: HostPathSchema,
}).strict();

export async function compileGrandHallDifixAuthorizationFromSpec(
  specInput: unknown,
): Promise<GrandHallDifixExecutionAuthorization> {
  const spec = GrandHallDifixAuthorizationCompileSpecSchema.parse(specInput);
  await requireDirectDirectory(dirname(spec.outputHost), "authorization overlay parent directory");
  await requireAbsent(spec.outputHost, "authorization overlay");
  const lockResult = await parseSeal(spec.executionLockHost, "execution lock", GrandHallDifixExecutionLockSchema);
  if (!samePath(lockResult.stable.absolutePath, lockResult.value.paths.executionLockHost)) {
    fail("AUTHORIZATION_INVALID", "Execution lock was not loaded from its exact bound path.");
  }
  const objective = await boundFile(
    spec.objectiveArtifactHost,
    spec.objectiveArtifactWsl,
    "active-goal objective artifact",
    MAX_JSON_BYTES,
  );
  const authorization = compileGrandHallDifixExecutionAuthorization({
    authorizationId: spec.authorizationId,
    executionLock: lockResult.value,
    objectiveArtifact: objective,
    objectiveArtifactStatementSha256: spec.objectiveArtifactStatementSha256,
    actorId: spec.actorId,
    issuedAt: spec.issuedAt,
    expiresAt: spec.expiresAt,
    nonce: spec.nonce,
  });
  await createOnlyJson(spec.outputHost, authorization);
  return authorization;
}

interface SpawnResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

function sanitizedHostEnvironment(): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = { WSL_UTF8: "1" };
  for (const key of ["SystemRoot", "WINDIR", "PATH"] as const) {
    const value = process.env[key];
    if (value !== undefined) output[key] = value;
  }
  return output;
}

async function spawnCaptured(command: string, args: readonly string[]): Promise<SpawnResult> {
  return await new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      shell: false,
      windowsHide: true,
      env: sanitizedHostEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      resolvePromise({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}

async function verifyWslHostMappings(
  lock: GrandHallDifixExecutionLock,
  authorization: GrandHallDifixExecutionAuthorization,
): Promise<void> {
  const runtimeStable = await assertBoundFile(lock.paths.runtimeSeal, "runtime seal for path mapping");
  const runtime = GrandHallDifixRuntimeSealSchema.parse(parseStrictJson(runtimeStable.bytes, "runtime seal for path mapping"));
  const modelStable = await assertBoundFile(lock.paths.modelSeal, "model seal for path mapping");
  const model = GrandHallDifixModelSealSchema.parse(parseStrictJson(modelStable.bytes, "model seal for path mapping"));
  if (
    lock.paths.providerSourceRootWsl !== runtime.providerSourceTree.wslRoot
    || lock.paths.modelSnapshotRootWsl !== model.snapshot.wslRoot
    || lock.paths.venvPythonWsl !== `${runtime.venv.wslRoot}/bin/python`
    || runtime.externalInterpreterChain[0]?.wslPath !== lock.paths.venvPythonWsl
    || runtime.trustedVerifierInterpreterChain[0]?.wslPath !== lock.paths.trustedVerifierPythonWsl
    || lock.paths.trustedVerifierPythonWsl === lock.paths.venvPythonWsl
  ) fail("MATERIAL_MISMATCH", "Execution roots do not match the exact sealed runtime/model roots.");
  const pairs = [
    [lock.paths.executionLockHost, lock.paths.executionLockWsl],
    [lock.paths.experiment.hostPath, lock.paths.experiment.wslPath],
    ...lock.paths.experimentMaterials.map((material) => [
      material.file.hostPath,
      material.file.wslPath,
    ] as const),
    [lock.paths.inputPackDirectoryHost, lock.paths.inputPackDirectoryWsl],
    [lock.paths.inputPackManifest.hostPath, lock.paths.inputPackManifest.wslPath],
    [lock.paths.inputPackPublicationReceipt.hostPath, lock.paths.inputPackPublicationReceipt.wslPath],
    [lock.paths.sourceImage.hostPath, lock.paths.sourceImage.wslPath],
    [lock.paths.browserCaptureRecord.hostPath, lock.paths.browserCaptureRecord.wslPath],
    [lock.paths.cameraArtifact.hostPath, lock.paths.cameraArtifact.wslPath],
    [lock.paths.rendererArtifact.hostPath, lock.paths.rendererArtifact.wslPath],
    [lock.paths.reconstructionArtifact.hostPath, lock.paths.reconstructionArtifact.wslPath],
    [lock.paths.renderGenerationReceipt.hostPath, lock.paths.renderGenerationReceipt.wslPath],
    [lock.paths.protectedMask.hostPath, lock.paths.protectedMask.wslPath],
    [lock.paths.generatedRegionMask.hostPath, lock.paths.generatedRegionMask.wslPath],
    [lock.paths.runtimeSeal.hostPath, lock.paths.runtimeSeal.wslPath],
    [lock.paths.modelSeal.hostPath, lock.paths.modelSeal.wslPath],
    [lock.paths.adapter.hostPath, lock.paths.adapter.wslPath],
    [lock.paths.runtimeSealTool.hostPath, lock.paths.runtimeSealTool.wslPath],
    [lock.paths.controlDirectoryHost, lock.paths.controlDirectoryWsl],
    [lock.paths.claimHost, lock.paths.claimWsl],
    [lock.paths.attemptDirectoryHost, lock.paths.attemptDirectoryWsl],
    [lock.paths.hfModulesCacheHost, lock.paths.hfModulesCacheWsl],
    [lock.paths.torchHomeHost, lock.paths.torchHomeWsl],
    [lock.paths.modelExecutionSnapshotHost, lock.paths.modelExecutionSnapshotWsl],
    [lock.paths.outputImageHost, lock.paths.outputImageWsl],
    [lock.paths.adapterReceiptHost, lock.paths.adapterReceiptWsl],
    [lock.paths.stdoutHost, lock.paths.stdoutWsl],
    [lock.paths.stderrHost, lock.paths.stderrWsl],
    [lock.paths.startedReceiptHost, lock.paths.startedReceiptWsl],
    [lock.paths.terminalReceiptHost, lock.paths.terminalReceiptWsl],
    [authorization.authorizationBasis.objectiveArtifact.hostPath, authorization.authorizationBasis.objectiveArtifact.wslPath],
    [runtime.venv.hostRoot, runtime.venv.wslRoot],
    [runtime.providerSourceTree.hostRoot, runtime.providerSourceTree.wslRoot],
    [runtime.sourceArchive.hostPath, runtime.sourceArchive.wslPath],
    [runtime.wheelhouse.hostRoot, runtime.wheelhouse.wslRoot],
    [runtime.wheelHashInventory.hostPath, runtime.wheelHashInventory.wslPath],
    [runtime.pipFreeze.hostPath, runtime.pipFreeze.wslPath],
    [model.snapshot.hostRoot, model.snapshot.wslRoot],
  ] as const;
  for (const [hostPath, wslPath] of pairs) {
    const result = await spawnCaptured("wsl.exe", [
      "--distribution",
      lock.launch.wslDistribution,
      "--exec",
      "wslpath",
      "-w",
      wslPath,
    ]).catch((error: unknown) => fail("PREFLIGHT_FAILED", "WSL path-pair preflight could not launch.", error));
    if (result.exitCode !== 0) fail("MATERIAL_MISMATCH", "A WSL path could not be mapped to its bound host path.");
    const mapped = result.stdout.toString("utf8").trim();
    if (!samePath(mapped, hostPath)) {
      fail("MATERIAL_MISMATCH", `WSL/host path pair mismatch for ${wslPath}.`);
    }
  }
}

export function grandHallDifixOfflineEnvArguments(
  lock: GrandHallDifixExecutionLock,
  home: string,
  caches: { readonly hfModulesCacheWsl: string; readonly torchHomeWsl: string } = {
    hfModulesCacheWsl: `${home}/venviewer-difix-hf-modules-unused`,
    torchHomeWsl: `${home}/venviewer-difix-torch-home-unused`,
  },
): string[] {
  const pairs = Object.entries({
    ...lock.launch.offlineEnvironment,
    DO_NOT_TRACK: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    HOME: home,
    XDG_CACHE_HOME: `${home}/.cache`,
    HF_HOME: `${home}/.cache/huggingface`,
    HF_MODULES_CACHE: caches.hfModulesCacheWsl,
    TORCH_HOME: caches.torchHomeWsl,
  }).sort(([left], [right]) => left.localeCompare(right));
  return ["env", "-i", ...pairs.map(([key, value]) => `${key}=${value}`)];
}

function wslNamespacePrefix(lock: GrandHallDifixExecutionLock): string[] {
  return [
    "--distribution",
    lock.launch.wslDistribution,
    "--exec",
    ...lock.launch.namespaceArgvPrefix,
  ];
}

function runtimeSealCheckArguments(
  lock: GrandHallDifixExecutionLock,
  runtime: GrandHallDifixRuntimeSeal,
): string[] {
  return grandHallDifixStablePythonScriptArguments({
    pythonWsl: lock.paths.trustedVerifierPythonWsl,
    scriptWsl: lock.paths.runtimeSealTool.wslPath,
    scriptSha256: lock.paths.runtimeSealTool.sha256,
    scriptSizeBytes: lock.paths.runtimeSealTool.sizeBytes,
    noSite: true,
    scriptArguments: [
      "check-runtime",
      "--venv-host", runtime.venv.hostRoot,
      "--venv-wsl", runtime.venv.wslRoot,
      "--venv-python-wsl", lock.paths.venvPythonWsl,
      "--trusted-verifier-python-wsl", lock.paths.trustedVerifierPythonWsl,
      "--source-host", runtime.providerSourceTree.hostRoot,
      "--source-wsl", runtime.providerSourceTree.wslRoot,
      "--source-archive-host", runtime.sourceArchive.hostPath,
      "--source-archive-wsl", runtime.sourceArchive.wslPath,
      "--wheelhouse-host", runtime.wheelhouse.hostRoot,
      "--wheelhouse-wsl", runtime.wheelhouse.wslRoot,
      "--wheel-hashes-host", runtime.wheelHashInventory.hostPath,
      "--wheel-hashes-wsl", runtime.wheelHashInventory.wslPath,
      "--pip-freeze-host", runtime.pipFreeze.hostPath,
      "--pip-freeze-wsl", runtime.pipFreeze.wslPath,
      "--manifest", lock.paths.runtimeSeal.wslPath,
    ],
  });
}

function modelSealCheckArguments(
  lock: GrandHallDifixExecutionLock,
  model: GrandHallDifixModelSeal,
): string[] {
  return grandHallDifixStablePythonScriptArguments({
    pythonWsl: lock.paths.trustedVerifierPythonWsl,
    scriptWsl: lock.paths.runtimeSealTool.wslPath,
    scriptSha256: lock.paths.runtimeSealTool.sha256,
    scriptSizeBytes: lock.paths.runtimeSealTool.sizeBytes,
    noSite: true,
    scriptArguments: [
      "check-model",
      "--snapshot-host", model.snapshot.hostRoot,
      "--snapshot-wsl", model.snapshot.wslRoot,
      "--manifest", lock.paths.modelSeal.wslPath,
    ],
  });
}

async function runNamespacedCheck(
  lock: GrandHallDifixExecutionLock,
  commandArgs: readonly string[],
  expectedState: "runtime_checked" | "model_checked",
): Promise<void> {
  const args = [
    ...wslNamespacePrefix(lock),
    ...grandHallDifixOfflineEnvArguments(lock, "/tmp"),
    ...commandArgs,
  ];
  const result = await spawnCaptured("wsl.exe", args).catch((error: unknown) => (
    fail("PREFLIGHT_FAILED", `${expectedState} could not launch in the no-network namespace.`, error)
  ));
  if (result.exitCode !== 0) fail("MATERIAL_MISMATCH", `${expectedState} failed against the sealed inventory.`);
  const lines = result.stdout.toString("utf8").trim().split(/\r?\n/u);
  const parsed = parseStrictJson(Buffer.from(lines.at(-1) ?? "", "utf8"), expectedState);
  if (typeof parsed !== "object" || parsed === null || !("state" in parsed) || parsed.state !== expectedState) {
    fail("MATERIAL_MISMATCH", `${expectedState} did not return its exact success receipt.`);
  }
}

interface CheckedMaterials {
  readonly lock: GrandHallDifixExecutionLock;
  readonly runtime: GrandHallDifixRuntimeSeal;
  readonly model: GrandHallDifixModelSeal;
  readonly materialSetSha256: string;
}

async function checkExactMaterials(
  lock: GrandHallDifixExecutionLock,
  includeExhaustiveDirectoryCheck: boolean,
): Promise<CheckedMaterials> {
  const experimentStable = await assertBoundFile(lock.paths.experiment, "immutable restoration experiment");
  const experimentRaw = parseStrictJson(experimentStable.bytes, "immutable restoration experiment");
  assertGrandHallDifixBaseExperimentNotAuthorized(experimentRaw);
  const experiment = FoundryRestorationExperimentV0Schema.parse(experimentRaw);
  if (
    experiment.experimentSha256 !== lock.experimentSha256
    || experiment.plannedExecutionLock.plannedExecutionLockSha256 !== lock.plannedExecutionLockSha256
  ) fail("MATERIAL_MISMATCH", "Immutable base experiment or planned lock disagrees with the one-shot lock.");
  const runtimeStable = await assertBoundFile(lock.paths.runtimeSeal, "runtime seal");
  const runtime = GrandHallDifixRuntimeSealSchema.parse(parseStrictJson(runtimeStable.bytes, "runtime seal"));
  const modelStable = await assertBoundFile(lock.paths.modelSeal, "model seal");
  const model = GrandHallDifixModelSealSchema.parse(parseStrictJson(modelStable.bytes, "model seal"));
  if (runtime.runtimeSealSha256 !== lock.runtimeSealSha256 || model.modelSealSha256 !== lock.modelSealSha256) {
    fail("MATERIAL_MISMATCH", "Runtime or model seal digest disagrees with the execution lock.");
  }
  const adapter = await assertBoundFile(lock.paths.adapter, "Python adapter", MAX_ADAPTER_BYTES);
  const sealTool = await assertBoundFile(lock.paths.runtimeSealTool, "runtime seal tool", MAX_ADAPTER_BYTES);
  const localExperimentMaterials = await Promise.all(lock.paths.experimentMaterials.map(async (material) => ({
    material,
    stable: await assertBoundFile(material.file, `experiment material ${material.relativePath}`),
  })));
  const manifest = await assertBoundFile(lock.paths.inputPackManifest, "input pack manifest");
  const publication = await assertBoundFile(lock.paths.inputPackPublicationReceipt, "input pack publication receipt");
  const source = await assertBoundFile(lock.paths.sourceImage, "source image", MAX_IMAGE_BYTES);
  const browserCaptureRecord = await assertBoundFile(lock.paths.browserCaptureRecord, "browser capture record");
  const cameraArtifact = await assertBoundFile(lock.paths.cameraArtifact, "camera artifact");
  const rendererArtifact = await assertBoundFile(lock.paths.rendererArtifact, "renderer artifact");
  const reconstructionArtifact = await assertBoundFile(lock.paths.reconstructionArtifact, "reconstruction artifact");
  const renderGenerationReceipt = await assertBoundFile(lock.paths.renderGenerationReceipt, "render-generation receipt");
  const protectedMask = await assertBoundFile(lock.paths.protectedMask, "protected mask", MAX_IMAGE_BYTES);
  const generatedRegionMask = await assertBoundFile(lock.paths.generatedRegionMask, "generated-region mask", MAX_IMAGE_BYTES);
  const pack = await checkGrandHallDifixNoReferenceInputPack(lock.paths.inputPackDirectoryHost);
  if (
    manifest.sha256 !== lock.inputPackManifestSha256
    || publication.sha256 !== lock.inputPackPublicationReceiptSha256
    || source.sha256 !== lock.sourceImageSha256
    || pack.manifest.bundleMaterialSha256 !== lock.inputPackBundleMaterialSha256
    || pack.publicationReceiptSha256 !== lock.inputPackPublicationReceiptSha256
    || browserCaptureRecord.sha256 !== pack.manifest.browserCaptureRecord.sha256
    || cameraArtifact.sha256 !== pack.manifest.cameraArtifact.sha256
    || rendererArtifact.sha256 !== pack.manifest.rendererArtifact.sha256
    || reconstructionArtifact.sha256 !== pack.manifest.reconstructionArtifact.sha256
    || renderGenerationReceipt.sha256 !== pack.manifest.renderGenerationReceipt.sha256
    || protectedMask.sha256 !== pack.manifest.protectedMask.sha256
    || generatedRegionMask.sha256 !== pack.manifest.generatedRegionMask.sha256
  ) fail("MATERIAL_MISMATCH", "Input pack or source image disagrees with the execution lock.");
  const experimentBindings = assertGrandHallDifixExperimentMatchesMaterials({
    experiment,
    runtimeSeal: runtime,
    modelSeal: model,
    inputPack: pack,
    paths: {
      ...lock.paths,
      experimentMaterials: localExperimentMaterials.map(({ material, stable }) => ({
        relativePath: material.relativePath,
        artifactIds: material.artifactIds,
        file: {
          hostPath: stable.absolutePath,
          wslPath: material.file.wslPath,
          sizeBytes: stable.sizeBytes,
          sha256: stable.sha256,
        },
      })),
    },
  });
  try {
    assertGrandHallDifixExperimentBindingProjectionMatches(lock.experimentBindings, experimentBindings);
  } catch (error: unknown) {
    fail("MATERIAL_MISMATCH", "Experiment-to-material cross-bindings disagree with the execution lock.", error);
  }
  if (includeExhaustiveDirectoryCheck) {
    await runNamespacedCheck(lock, runtimeSealCheckArguments(lock, runtime), "runtime_checked");
    await runNamespacedCheck(lock, modelSealCheckArguments(lock, model), "model_checked");
  }
  const materialSetSha256 = digest(MATERIAL_SET_DIGEST_DOMAIN, {
    experiment: experimentStable.sha256,
    runtimeSeal: runtimeStable.sha256,
    runtimeInventory: runtime.runtimeSealSha256,
    modelSeal: modelStable.sha256,
    modelInventory: model.modelSealSha256,
    adapter: adapter.sha256,
    runtimeSealTool: sealTool.sha256,
    localExperimentMaterials: localExperimentMaterials.map(({ material, stable }) => ({
      relativePath: material.relativePath,
      artifactIds: material.artifactIds,
      sha256: stable.sha256,
    })),
    inputPackManifest: manifest.sha256,
    inputPackPublicationReceipt: publication.sha256,
    inputPackBundleMaterial: pack.manifest.bundleMaterialSha256,
    sourceImage: source.sha256,
    browserCaptureRecord: browserCaptureRecord.sha256,
    cameraArtifact: cameraArtifact.sha256,
    rendererArtifact: rendererArtifact.sha256,
    reconstructionArtifact: reconstructionArtifact.sha256,
    renderGenerationReceipt: renderGenerationReceipt.sha256,
    protectedMask: protectedMask.sha256,
    generatedRegionMask: generatedRegionMask.sha256,
  });
  return { lock, runtime, model, materialSetSha256 };
}

export async function checkGrandHallDifixExecutionLock(
  lockHostPath: string,
  exhaustive = false,
): Promise<CheckedMaterials> {
  const stable = await stableRead(lockHostPath, "execution lock", MAX_JSON_BYTES);
  const lock = GrandHallDifixExecutionLockSchema.parse(parseStrictJson(stable.bytes, "execution lock"));
  if (!samePath(stable.absolutePath, lock.paths.executionLockHost)) {
    fail("MATERIAL_MISMATCH", "Execution lock was not read from its exact bound path.");
  }
  return await checkExactMaterials(lock, exhaustive);
}

export async function claimGrandHallDifixAuthorizationCreateOnly(input: {
  readonly authorization: GrandHallDifixExecutionAuthorization;
  readonly lock: GrandHallDifixExecutionLock;
  readonly claimedAt: string;
}): Promise<string> {
  const claim = createGrandHallDifixAuthorizationClaim({
    authorization: input.authorization,
    executionLock: input.lock,
    claimedAt: input.claimedAt,
  });
  const bytes = canonicalBytes(claim);
  const handle = await open(input.lock.paths.claimHost, "wx", 0o600).catch((error: unknown) => {
    if (hasErrnoCode(error, "EEXIST")) fail("AUTHORIZATION_CONSUMED", "The one-attempt authorization has already been consumed.");
    throw error;
  });
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw new GrandHallDifixClaimPublicationError(claim.claimSha256, error);
  }
  return claim.claimSha256;
}

const PreflightSchema = z.object({
  schemaVersion: z.literal("venviewer.grand-hall.difix-no-reference-preflight.v1"),
  networkConnectErrno: z.literal(101),
  networkUnreachable: z.literal(true),
  cudaAvailable: z.literal(true),
  cudaAllocationSucceeded: z.literal(true),
  gpuName: z.string().min(1),
  cudaRuntime: z.string().min(1),
  driverVersion: z.string().min(1),
  packages: z.record(z.string()),
}).strict();

async function preflightExactNamespace(lock: GrandHallDifixExecutionLock): Promise<void> {
  const result = await spawnCaptured("wsl.exe", [
    ...wslNamespacePrefix(lock),
    ...grandHallDifixOfflineEnvArguments(lock, "/tmp"),
    ...grandHallDifixStablePythonScriptArguments({
      pythonWsl: lock.paths.venvPythonWsl,
      scriptWsl: lock.paths.adapter.wslPath,
      scriptSha256: lock.paths.adapter.sha256,
      scriptSizeBytes: lock.paths.adapter.sizeBytes,
      noSite: false,
      scriptArguments: ["preflight"],
    }),
  ]).catch((error: unknown) => fail("PREFLIGHT_FAILED", "No-network CUDA preflight could not launch.", error));
  if (result.exitCode !== 0) fail("PREFLIGHT_FAILED", "No-network CUDA preflight failed.");
  const line = result.stdout.toString("utf8").trim().split(/\r?\n/u).at(-1) ?? "";
  PreflightSchema.parse(parseStrictJson(Buffer.from(line, "utf8"), "preflight receipt"));
}

async function openCreateOnlyLog(path: string, stream: "stdout" | "stderr"): Promise<FileHandle> {
  const handle = await open(path, "ax", 0o600).catch((error: unknown) => {
    if (hasErrnoCode(error, "EEXIST")) fail("OUTPUT_EXISTS", `${stream} log already exists.`);
    throw error;
  });
  await handle.writeFile(`VENVIEWER_DIFIX_${stream.toUpperCase()}_CAPTURE_V1\n`, "utf8");
  await handle.sync();
  return handle;
}

async function spawnToLogs(
  command: string,
  args: readonly string[],
  stdoutHandle: FileHandle,
  stderrHandle: FileHandle,
): Promise<number> {
  return await new Promise<number>((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      shell: false,
      windowsHide: true,
      env: sanitizedHostEnvironment(),
      stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
    });
    child.once("error", rejectPromise);
    child.once("close", (code) => { resolvePromise(code ?? 1); });
  });
}

const ActualExecutionSchema = z.object({
  schedulerClass: z.string().min(1),
  schedulerConfigSha256: Sha256Schema,
  timesteps: z.tuple([z.literal(199)]),
  torchDtype: z.literal("float32"),
  packages: z.record(z.string()),
  gpuName: z.string().min(1),
  cudaRuntime: z.string().min(1),
  driverVersion: z.string().min(1),
  peakCudaAllocatedBytes: z.number().int().nonnegative(),
  peakCudaReservedBytes: z.number().int().nonnegative(),
  peakRssBytes: z.number().int().nonnegative(),
  networkConnectErrnoBeforeLoad: z.literal(101),
  networkConnectErrnoAfterLoad: z.literal(101),
  pythonIsolated: z.literal(true),
  bytecodeWritesDisabled: z.literal(true),
  hfModulesCacheWsl: WslPathSchema,
  torchHomeWsl: WslPathSchema,
  modelExecutionSnapshotWsl: WslPathSchema,
}).strict();

const StablePythonFileReceiptSchema = z.object({
  wslPath: WslPathSchema,
  sizeBytes: z.number().int().positive(),
  sha256: Sha256Schema,
  linkCount: z.literal(1),
}).strict();

const ModelClosureFileReceiptSchema = StablePythonFileReceiptSchema.extend({
  relativePath: z.string().min(1).max(4_096),
}).strict();

const PreloadClosurePayloadSchema = z.object({
  providerPipeline: StablePythonFileReceiptSchema,
  modelFiles: z.array(ModelClosureFileReceiptSchema).length(13),
}).strict();

const PreloadClosureSchema = PreloadClosurePayloadSchema.extend({
  closureSha256: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  const { closureSha256: _digest, ...payload } = value;
  if (value.closureSha256 !== digest("VENVIEWER_GRAND_HALL_DIFIX_PRELOAD_CLOSURE_V1", payload)) {
    ctx.addIssue({ code: "custom", path: ["closureSha256"], message: "preload closure digest mismatch" });
  }
});

const PrivateModelExecutionSnapshotSchema = z.object({
  wslRoot: WslPathSchema,
  filesBeforeLoad: z.array(ModelClosureFileReceiptSchema).length(13),
  snapshotSha256BeforeLoad: Sha256Schema,
  filesAfterInference: z.array(ModelClosureFileReceiptSchema).length(13),
  snapshotSha256AfterInference: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  const before = { wslRoot: value.wslRoot, files: value.filesBeforeLoad };
  const after = { wslRoot: value.wslRoot, files: value.filesAfterInference };
  if (
    value.snapshotSha256BeforeLoad
    !== digest("VENVIEWER_GRAND_HALL_DIFIX_PRIVATE_MODEL_SNAPSHOT_V1", before)
  ) ctx.addIssue({ code: "custom", path: ["snapshotSha256BeforeLoad"], message: "private model snapshot pre-load digest mismatch" });
  if (
    value.snapshotSha256AfterInference
    !== digest("VENVIEWER_GRAND_HALL_DIFIX_PRIVATE_MODEL_SNAPSHOT_V1", after)
  ) ctx.addIssue({ code: "custom", path: ["snapshotSha256AfterInference"], message: "private model snapshot post-inference digest mismatch" });
  if (value.snapshotSha256BeforeLoad !== value.snapshotSha256AfterInference) {
    ctx.addIssue({ code: "custom", path: ["snapshotSha256AfterInference"], message: "private model snapshot changed after load" });
  }
});

const AuditedLocalCustomComponentSchema = z.object({
  deliberatelyExecutedAuditedLocalCustomPython: z.literal(true),
  remoteRetrieval: z.literal(false),
  sourceRelativePath: z.literal("vae/autoencoder_kl.py"),
  sourceSizeBytes: z.literal(24_456),
  sourceSha256: z.literal("sha256:a0c16e2fe489d0386b04274b25e6cec212f37264283f8ce1c042270d27250edf"),
  hfModulesCacheWsl: WslPathSchema,
  loadedClassModule: z.literal("diffusers_modules.local.autoencoder_kl"),
  loadedClassName: z.literal("AutoencoderKL"),
  copiedModuleWslPath: WslPathSchema,
  copiedModuleSizeBytes: z.literal(24_456),
  copiedModuleSha256AfterLoad: z.literal("sha256:a0c16e2fe489d0386b04274b25e6cec212f37264283f8ce1c042270d27250edf"),
  copiedModuleSha256AfterInference: z.literal("sha256:a0c16e2fe489d0386b04274b25e6cec212f37264283f8ce1c042270d27250edf"),
}).strict();

const AdapterReceiptSchema = z.object({
  schemaVersion: z.literal("venviewer.grand-hall.difix-no-reference-python-adapter-receipt.v1"),
  outcome: z.enum(["succeeded", "out_of_memory"]),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  sourceImage: z.object({
    sizeBytes: z.number().int().positive(),
    sha256: Sha256Schema,
    mode: z.literal("RGB"),
    width: z.literal(GRAND_HALL_DIFIX_INPUT_WIDTH),
    height: z.literal(GRAND_HALL_DIFIX_INPUT_HEIGHT),
  }).strict(),
  outputImage: z.object({
    sizeBytes: z.number().int().positive(),
    sha256: Sha256Schema,
    mode: z.literal("RGB"),
    width: z.literal(GRAND_HALL_DIFIX_INPUT_WIDTH),
    height: z.literal(GRAND_HALL_DIFIX_INPUT_HEIGHT),
  }).strict().nullable(),
  actualExecution: ActualExecutionSchema.nullable(),
  preloadClosure: PreloadClosureSchema,
  privateModelExecutionSnapshot: PrivateModelExecutionSnapshotSchema,
  auditedLocalCustomComponent: AuditedLocalCustomComponentSchema.nullable(),
  configuration: z.unknown(),
  failureCode: z.literal("cuda_out_of_memory").optional(),
  failureType: z.string().optional(),
  authority: z.object({
    captured: z.literal("none"),
    structural: z.literal("none"),
    runtime: z.literal("none"),
    resultClass: z.literal("generated_cinematic_diagnostic"),
  }).strict(),
  adapterReceiptSha256: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  const { adapterReceiptSha256: _digest, ...payload } = value;
  if (value.adapterReceiptSha256 !== digest("VENVIEWER_GRAND_HALL_DIFIX_PYTHON_ADAPTER_RECEIPT_V1", payload)) {
    ctx.addIssue({ code: "custom", path: ["adapterReceiptSha256"], message: "adapter receipt digest mismatch" });
  }
  if (
    value.outcome === "succeeded"
    && (
      value.auditedLocalCustomComponent === null
      || value.actualExecution === null
      || value.outputImage === null
      || value.failureCode !== undefined
      || value.failureType !== undefined
    )
  ) ctx.addIssue({ code: "custom", path: ["outcome"], message: "successful adapter receipt must bind the preload closure and audited local custom component" });
  if (
    value.outcome === "out_of_memory"
    && (value.outputImage !== null || value.failureCode !== "cuda_out_of_memory" || value.failureType === undefined)
  ) ctx.addIssue({ code: "custom", path: ["outcome"], message: "out-of-memory adapter receipt is inconsistent" });
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({ code: "custom", path: ["completedAt"], message: "adapter completion cannot precede start" });
  }
});

async function checkedOutputImage(lock: GrandHallDifixExecutionLock): Promise<StableFile> {
  const stable = await stableRead(lock.paths.outputImageHost, "Difix candidate output", MAX_IMAGE_BYTES);
  const metadata = await sharp(stable.bytes, { failOn: "error", limitInputPixels: GRAND_HALL_DIFIX_INPUT_WIDTH * GRAND_HALL_DIFIX_INPUT_HEIGHT })
    .metadata();
  if (
    metadata.format !== "png"
    || metadata.width !== GRAND_HALL_DIFIX_INPUT_WIDTH
    || metadata.height !== GRAND_HALL_DIFIX_INPUT_HEIGHT
    || metadata.channels !== 3
    || metadata.space !== "srgb"
  ) fail("PROCESS_FAILED", "Difix output is not the exact RGB sRGB 1024x576 PNG contract.");
  return stable;
}

async function receiptBoundFile(
  hostPath: string,
  wslPath: string,
  label: string,
  maximumBytes: number,
): Promise<GrandHallDifixBoundFile> {
  return await boundFile(hostPath, wslPath, label, maximumBytes);
}

export interface RunGrandHallDifixOneShotOptions {
  readonly lockHostPath: string;
  readonly authorizationHostPath: string;
  readonly explicitOptIn: string;
  readonly now?: () => Date;
}

export async function runGrandHallDifixOneShot(
  options: RunGrandHallDifixOneShotOptions,
): Promise<GrandHallDifixAttemptReceipt> {
  if (options.explicitOptIn !== GRAND_HALL_DIFIX_EXPLICIT_RUN_OPT_IN) {
    fail("AUTHORIZATION_INVALID", "The exact one-attempt execution opt-in phrase was not supplied.");
  }
  const now = options.now ?? (() => new Date());
  const lockStable = await stableRead(options.lockHostPath, "execution lock", MAX_JSON_BYTES);
  const lock = GrandHallDifixExecutionLockSchema.parse(parseStrictJson(lockStable.bytes, "execution lock"));
  if (!samePath(lockStable.absolutePath, lock.paths.executionLockHost)) fail("MATERIAL_MISMATCH", "Execution lock path mismatch.");
  const authorizationStable = await stableRead(options.authorizationHostPath, "authorization overlay", MAX_JSON_BYTES);
  const authorization = GrandHallDifixExecutionAuthorizationSchema.parse(parseStrictJson(authorizationStable.bytes, "authorization overlay"));
  assertGrandHallDifixAuthorizationMatchesLock(authorization, lock);
  await assertBoundFile(authorization.authorizationBasis.objectiveArtifact, "authorization objective artifact");
  assertGrandHallDifixAuthorizationCurrent(authorization, now());
  assertOutputLayout({
    lockId: lock.lockId,
    compiledAt: lock.compiledAt,
    gitCommit: lock.gitCommit,
    wslDistribution: lock.launch.wslDistribution,
    paths: {
      executionLockHost: lock.paths.executionLockHost,
      executionLockWsl: lock.paths.executionLockWsl,
      experimentHost: lock.paths.experiment.hostPath,
      experimentWsl: lock.paths.experiment.wslPath,
      inputPackDirectoryHost: lock.paths.inputPackDirectoryHost,
      inputPackDirectoryWsl: lock.paths.inputPackDirectoryWsl,
      runtimeSealHost: lock.paths.runtimeSeal.hostPath,
      runtimeSealWsl: lock.paths.runtimeSeal.wslPath,
      modelSealHost: lock.paths.modelSeal.hostPath,
      modelSealWsl: lock.paths.modelSeal.wslPath,
      adapterHost: lock.paths.adapter.hostPath,
      adapterWsl: lock.paths.adapter.wslPath,
      runtimeSealToolHost: lock.paths.runtimeSealTool.hostPath,
      runtimeSealToolWsl: lock.paths.runtimeSealTool.wslPath,
      trustedVerifierPythonWsl: lock.paths.trustedVerifierPythonWsl,
      venvPythonWsl: lock.paths.venvPythonWsl,
      providerSourceRootWsl: lock.paths.providerSourceRootWsl,
      modelSnapshotRootWsl: lock.paths.modelSnapshotRootWsl,
      controlDirectoryHost: lock.paths.controlDirectoryHost,
      controlDirectoryWsl: lock.paths.controlDirectoryWsl,
      claimHost: lock.paths.claimHost,
      claimWsl: lock.paths.claimWsl,
      attemptDirectoryHost: lock.paths.attemptDirectoryHost,
      attemptDirectoryWsl: lock.paths.attemptDirectoryWsl,
      hfModulesCacheHost: lock.paths.hfModulesCacheHost,
      hfModulesCacheWsl: lock.paths.hfModulesCacheWsl,
      torchHomeHost: lock.paths.torchHomeHost,
      torchHomeWsl: lock.paths.torchHomeWsl,
      modelExecutionSnapshotHost: lock.paths.modelExecutionSnapshotHost,
      modelExecutionSnapshotWsl: lock.paths.modelExecutionSnapshotWsl,
      outputImageHost: lock.paths.outputImageHost,
      outputImageWsl: lock.paths.outputImageWsl,
      adapterReceiptHost: lock.paths.adapterReceiptHost,
      adapterReceiptWsl: lock.paths.adapterReceiptWsl,
      stdoutHost: lock.paths.stdoutHost,
      stdoutWsl: lock.paths.stdoutWsl,
      stderrHost: lock.paths.stderrHost,
      stderrWsl: lock.paths.stderrWsl,
      startedReceiptHost: lock.paths.startedReceiptHost,
      startedReceiptWsl: lock.paths.startedReceiptWsl,
      terminalReceiptHost: lock.paths.terminalReceiptHost,
      terminalReceiptWsl: lock.paths.terminalReceiptWsl,
    },
  });
  await requireDirectDirectory(lock.paths.controlDirectoryHost, "control directory");
  await requireDirectDirectory(dirname(lock.paths.attemptDirectoryHost), "attempt parent directory");
  for (const [label, path] of [
    ["claim", lock.paths.claimHost],
    ["attempt directory", lock.paths.attemptDirectoryHost],
    ["HF modules cache", lock.paths.hfModulesCacheHost],
    ["Torch home", lock.paths.torchHomeHost],
    ["model execution snapshot", lock.paths.modelExecutionSnapshotHost],
    ["terminal receipt", lock.paths.terminalReceiptHost],
  ] as const) await requireAbsent(path, label);

  await verifyWslHostMappings(lock, authorization);
  const before = await checkExactMaterials(lock, false);
  await preflightExactNamespace(lock);
  const lockAgain = await stableRead(options.lockHostPath, "execution lock post-preflight", MAX_JSON_BYTES);
  const authAgain = await stableRead(options.authorizationHostPath, "authorization post-preflight", MAX_JSON_BYTES);
  if (lockAgain.sha256 !== lockStable.sha256 || authAgain.sha256 !== authorizationStable.sha256) {
    fail("INPUT_RACE", "Execution lock or authorization changed during preflight.");
  }
  await assertBoundFile(authorization.authorizationBasis.objectiveArtifact, "authorization objective artifact post-preflight");
  const claimInstant = now();
  assertGrandHallDifixAuthorizationCurrent(authorization, claimInstant);
  const claimedAt = claimInstant.toISOString();
  const plannedClaim = createGrandHallDifixAuthorizationClaim({
    authorization,
    executionLock: lock,
    claimedAt,
  });
  const claimSha256 = plannedClaim.claimSha256;
  const startedAt = claimedAt;
  const publishEmergencyTerminalIfAbsent = async (): Promise<void> => {
    const terminalExists = await lstat(lock.paths.terminalReceiptHost).then(
      () => true,
      () => false,
    );
    if (terminalExists) return;
    const emergencyTerminal = createGrandHallDifixAttemptReceipt({
      schemaVersion: "venviewer.grand-hall.difix-no-reference-attempt-receipt.v1",
      phase: "failed",
      authorizationSha256: authorization.authorizationSha256,
      executionLockSha256: lock.executionLockSha256,
      claimSha256,
      startedAt,
      completedAt: now().toISOString(),
      exitCode: null,
      noRetryPermitted: true,
      beforeMaterialSetSha256: before.materialSetSha256,
      afterMaterialSetSha256: null,
      stdout: null,
      stderr: null,
      outputImage: null,
      adapterReceipt: null,
      actualExecution: null,
      failure: {
        code: "process_failed",
        message: "The consumed one-shot attempt stopped at a control-plane boundary; retry is prohibited.",
      },
      authority: { captured: "none", structural: "none", runtime: "none", resultClass: "generated_cinematic_diagnostic" },
    });
    await createOnlyJson(lock.paths.terminalReceiptHost, emergencyTerminal);
  };
  await completeGrandHallDifixConsumedPrelaunch({
    plannedClaimSha256: claimSha256,
    consumeAuthorization: async () => await claimGrandHallDifixAuthorizationCreateOnly({ authorization, lock, claimedAt }),
    runExhaustivePrelaunch: async () => {
      try {
        await mkdir(lock.paths.attemptDirectoryHost, { recursive: false, mode: 0o700 });
      } catch (error) {
        const terminal = createGrandHallDifixAttemptReceipt({
          schemaVersion: "venviewer.grand-hall.difix-no-reference-attempt-receipt.v1",
          phase: "failed",
          authorizationSha256: authorization.authorizationSha256,
          executionLockSha256: lock.executionLockSha256,
          claimSha256,
          startedAt,
          completedAt: now().toISOString(),
          exitCode: null,
          noRetryPermitted: true,
          beforeMaterialSetSha256: before.materialSetSha256,
          afterMaterialSetSha256: null,
          stdout: null,
          stderr: null,
          outputImage: null,
          adapterReceipt: null,
          actualExecution: null,
          failure: { code: "process_failed", message: "Attempt directory could not be claimed create-only after authorization consumption." },
          authority: { captured: "none", structural: "none", runtime: "none", resultClass: "generated_cinematic_diagnostic" },
        });
        await createOnlyJson(lock.paths.terminalReceiptHost, terminal);
        throw new GrandHallDifixOneShotError("OUTPUT_EXISTS", "Authorization was consumed, but the create-only attempt directory could not be created.", error);
      }
      const startedReceipt = createGrandHallDifixAttemptReceipt({
        schemaVersion: "venviewer.grand-hall.difix-no-reference-attempt-receipt.v1",
        phase: "started",
        authorizationSha256: authorization.authorizationSha256,
        executionLockSha256: lock.executionLockSha256,
        claimSha256,
        startedAt,
        completedAt: null,
        exitCode: null,
        noRetryPermitted: true,
        beforeMaterialSetSha256: before.materialSetSha256,
        afterMaterialSetSha256: null,
        stdout: null,
        stderr: null,
        outputImage: null,
        adapterReceipt: null,
        actualExecution: null,
        failure: null,
        authority: { captured: "none", structural: "none", runtime: "none", resultClass: "generated_cinematic_diagnostic" },
      });
      await createOnlyJson(lock.paths.startedReceiptHost, startedReceipt);
      const exhaustiveBefore = await checkExactMaterials(lock, true);
      if (exhaustiveBefore.materialSetSha256 !== before.materialSetSha256) {
        fail("INPUT_RACE", "Bound materials changed between quick and exhaustive preflight.");
      }
      const lockAfterExhaustive = await stableRead(options.lockHostPath, "execution lock post-exhaustive-preflight", MAX_JSON_BYTES);
      const authorizationAfterExhaustive = await stableRead(
        options.authorizationHostPath,
        "authorization post-exhaustive-preflight",
        MAX_JSON_BYTES,
      );
      if (
        lockAfterExhaustive.sha256 !== lockStable.sha256
        || authorizationAfterExhaustive.sha256 !== authorizationStable.sha256
      ) fail("INPUT_RACE", "Execution lock or authorization changed during exhaustive preflight.");
      await assertBoundFile(
        authorization.authorizationBasis.objectiveArtifact,
        "authorization objective artifact post-exhaustive-preflight",
      );
    },
    publishConsumedFailure: publishEmergencyTerminalIfAbsent,
  });
  try {
  const stdoutHandle = await openCreateOnlyLog(lock.paths.stdoutHost, "stdout");
  const stderrHandle = await openCreateOnlyLog(lock.paths.stderrHost, "stderr");
  let exitCode = 1;
  try {
    exitCode = await spawnToLogs("wsl.exe", [
      ...wslNamespacePrefix(lock),
      ...grandHallDifixOfflineEnvArguments(lock, lock.paths.attemptDirectoryWsl, {
        hfModulesCacheWsl: lock.paths.hfModulesCacheWsl,
        torchHomeWsl: lock.paths.torchHomeWsl,
      }),
      ...grandHallDifixStablePythonScriptArguments({
        pythonWsl: lock.paths.venvPythonWsl,
        scriptWsl: lock.paths.adapter.wslPath,
        scriptSha256: lock.paths.adapter.sha256,
        scriptSizeBytes: lock.paths.adapter.sizeBytes,
        noSite: false,
        scriptArguments: [
          "run",
          "--execution-lock", lock.paths.executionLockWsl,
          "--expected-execution-lock-file-sha256", lockStable.sha256,
          "--expected-execution-lock-size-bytes", String(lockStable.sizeBytes),
          "--expected-execution-lock-sha256", lock.executionLockSha256,
          "--expected-source-image-sha256", lock.sourceImageSha256,
          "--expected-adapter-sha256", lock.adapterSha256,
          "--attempt-directory", lock.paths.attemptDirectoryWsl,
          "--hf-modules-cache", lock.paths.hfModulesCacheWsl,
          "--torch-home", lock.paths.torchHomeWsl,
          "--model-execution-snapshot", lock.paths.modelExecutionSnapshotWsl,
          "--source-image", lock.paths.sourceImageWsl,
          "--provider-source-root", lock.paths.providerSourceRootWsl,
          "--model-snapshot-root", lock.paths.modelSnapshotRootWsl,
          "--output-image", lock.paths.outputImageWsl,
          "--adapter-receipt", lock.paths.adapterReceiptWsl,
        ],
      }),
    ], stdoutHandle, stderrHandle);
  } finally {
    await Promise.all([stdoutHandle.close(), stderrHandle.close()]);
  }

  const stdout = await receiptBoundFile(lock.paths.stdoutHost, lock.paths.stdoutWsl, "stdout log", MAX_JSON_BYTES);
  const stderr = await receiptBoundFile(lock.paths.stderrHost, lock.paths.stderrWsl, "stderr log", MAX_JSON_BYTES);
  let postflight: CheckedMaterials | null = null;
  try {
    postflight = await checkExactMaterials(lock, true);
  } catch {
    const terminal = createGrandHallDifixAttemptReceipt({
      schemaVersion: "venviewer.grand-hall.difix-no-reference-attempt-receipt.v1",
      phase: "failed",
      authorizationSha256: authorization.authorizationSha256,
      executionLockSha256: lock.executionLockSha256,
      claimSha256,
      startedAt,
      completedAt: now().toISOString(),
      exitCode,
      noRetryPermitted: true,
      beforeMaterialSetSha256: before.materialSetSha256,
      afterMaterialSetSha256: null,
      stdout,
      stderr,
      outputImage: null,
      adapterReceipt: null,
      actualExecution: null,
      failure: { code: "postflight_integrity_failed", message: "A bound source/model/runtime/adapter material changed during the attempt." },
      authority: { captured: "none", structural: "none", runtime: "none", resultClass: "generated_cinematic_diagnostic" },
    });
    await createOnlyJson(lock.paths.terminalReceiptHost, terminal);
    return terminal;
  }

  let adapterReceiptFile: GrandHallDifixBoundFile | null = null;
  let actualExecution: z.infer<typeof ActualExecutionSchema> | null = null;
  let outputImage: GrandHallDifixBoundFile | null = null;
  if (await lstat(lock.paths.adapterReceiptHost).catch(() => null) !== null) {
    const stable = await stableRead(lock.paths.adapterReceiptHost, "adapter receipt", MAX_JSON_BYTES);
    const adapterReceipt = AdapterReceiptSchema.parse(parseStrictJson(stable.bytes, "adapter receipt"));
    if (
      digest("VENVIEWER_GRAND_HALL_DIFIX_CONFIGURATION_V1", adapterReceipt.configuration)
      !== lock.configurationSha256
    ) fail("PROCESS_FAILED", "Adapter receipt configuration differs from the exact execution lock.");
    const expectedProviderPipeline = postflight.runtime.providerSourceTree.files.find(
      (entry) => entry.relativePath === "src/pipeline_difix.py",
    );
    if (
      expectedProviderPipeline === undefined
      || adapterReceipt.preloadClosure.providerPipeline.wslPath !== `${lock.paths.providerSourceRootWsl}/src/pipeline_difix.py`
      || adapterReceipt.preloadClosure.providerPipeline.sizeBytes !== expectedProviderPipeline.sizeBytes
      || adapterReceipt.preloadClosure.providerPipeline.sha256 !== expectedProviderPipeline.sha256
    ) fail("PROCESS_FAILED", "Adapter receipt does not bind the exact reviewed provider pipeline source.");
    const expectedModelClosure = postflight.model.expectedLoadClosureFiles;
    if (
      adapterReceipt.preloadClosure.modelFiles.length !== expectedModelClosure.length
      || expectedModelClosure.some((expected, index) => {
        const actual = adapterReceipt.preloadClosure.modelFiles[index];
        return actual === undefined
          || actual.relativePath !== expected.relativePath
          || actual.wslPath !== `${lock.paths.modelSnapshotRootWsl}/${expected.relativePath}`
          || actual.sizeBytes !== expected.sizeBytes
          || actual.sha256 !== expected.sha256;
      })
    ) fail("PROCESS_FAILED", "Adapter receipt does not bind the exact audited model load closure.");
    const privateSnapshot = adapterReceipt.privateModelExecutionSnapshot;
    const privateSnapshotFilesMatch = (
      files: readonly z.infer<typeof ModelClosureFileReceiptSchema>[],
    ): boolean => files.length === expectedModelClosure.length
      && expectedModelClosure.every((expected, index) => {
        const actual = files[index];
        return actual !== undefined
          && actual.relativePath === expected.relativePath
          && actual.wslPath === `${lock.paths.modelExecutionSnapshotWsl}/${expected.relativePath}`
          && actual.sizeBytes === expected.sizeBytes
          && actual.sha256 === expected.sha256;
      });
    if (
      privateSnapshot.wslRoot !== lock.paths.modelExecutionSnapshotWsl
      || !privateSnapshotFilesMatch(privateSnapshot.filesBeforeLoad)
      || !privateSnapshotFilesMatch(privateSnapshot.filesAfterInference)
    ) fail("PROCESS_FAILED", "Adapter receipt does not bind the exact private create-only model execution snapshot.");
    if (
      adapterReceipt.actualExecution !== null
      && (
        adapterReceipt.actualExecution.hfModulesCacheWsl !== lock.paths.hfModulesCacheWsl
        || adapterReceipt.actualExecution.torchHomeWsl !== lock.paths.torchHomeWsl
        || adapterReceipt.actualExecution.modelExecutionSnapshotWsl !== lock.paths.modelExecutionSnapshotWsl
      )
    ) fail("PROCESS_FAILED", "Adapter actual-execution receipt escaped the exact attempt-local caches.");
    if (
      adapterReceipt.auditedLocalCustomComponent !== null
      && (
        adapterReceipt.auditedLocalCustomComponent.hfModulesCacheWsl !== lock.paths.hfModulesCacheWsl
        || adapterReceipt.auditedLocalCustomComponent.copiedModuleWslPath
          !== `${lock.paths.hfModulesCacheWsl}/diffusers_modules/local/autoencoder_kl.py`
      )
    ) fail("PROCESS_FAILED", "Audited local custom VAE receipt escaped the exact attempt-local module cache.");
    adapterReceiptFile = {
      hostPath: stable.absolutePath,
      wslPath: lock.paths.adapterReceiptWsl,
      sizeBytes: stable.sizeBytes,
      sha256: stable.sha256,
    };
    actualExecution = adapterReceipt.actualExecution;
    if (adapterReceipt.outcome === "succeeded") {
      const output = await checkedOutputImage(lock);
      if (adapterReceipt.outputImage?.sha256 !== output.sha256 || adapterReceipt.sourceImage.sha256 !== lock.sourceImageSha256) {
        fail("PROCESS_FAILED", "Adapter receipt does not bind the exact source and output bytes.");
      }
      outputImage = {
        hostPath: output.absolutePath,
        wslPath: lock.paths.outputImageWsl,
        sizeBytes: output.sizeBytes,
        sha256: output.sha256,
      };
    }
  }

  const succeeded = exitCode === 0 && outputImage !== null && adapterReceiptFile !== null && actualExecution !== null;
  const outOfMemory = exitCode === OOM_EXIT_CODE;
  const terminal = createGrandHallDifixAttemptReceipt({
    schemaVersion: "venviewer.grand-hall.difix-no-reference-attempt-receipt.v1",
    phase: succeeded ? "succeeded" : outOfMemory ? "out_of_memory" : "failed",
    authorizationSha256: authorization.authorizationSha256,
    executionLockSha256: lock.executionLockSha256,
    claimSha256,
    startedAt,
    completedAt: now().toISOString(),
    exitCode,
    noRetryPermitted: true,
    beforeMaterialSetSha256: before.materialSetSha256,
    afterMaterialSetSha256: postflight.materialSetSha256,
    stdout,
    stderr,
    outputImage,
    adapterReceipt: adapterReceiptFile,
    actualExecution,
    failure: succeeded
      ? null
      : outOfMemory
        ? { code: "cuda_out_of_memory", message: "The single authorized attempt exhausted CUDA memory; retry is prohibited." }
        : { code: "process_failed", message: "The single authorized provider process did not complete successfully; retry is prohibited." },
    authority: { captured: "none", structural: "none", runtime: "none", resultClass: "generated_cinematic_diagnostic" },
  });
  await createOnlyJson(lock.paths.terminalReceiptHost, terminal);
  return terminal;
  } catch (error) {
    await publishEmergencyTerminalIfAbsent();
    throw error;
  }
}

export function parseGrandHallDifixOneShotSpec(bytes: Buffer): unknown {
  return parseStrictJson(bytes, "one-shot specification");
}

export async function readGrandHallDifixOneShotSpec(path: string): Promise<unknown> {
  return parseGrandHallDifixOneShotSpec(await readFile(path));
}

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import {
  FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_SHA256,
  FOUNDRY_LOCAL_E57_AGGREGATE_PROBE,
  FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME,
  FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE,
  FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0,
  isCanonicalLocalE57BundlePath,
  issueLocalE57RuntimeBundleReceipt,
  stableCanonicalJson,
  toCanonicalJson,
  verifyFoundryLocalE57IntakeEnvironmentV0,
  type FoundryLocalE57IntakeEnvironmentV0,
  type LocalE57RuntimeBundleFileRole,
  type LocalE57RuntimeBundleReceipt,
} from "@omnitwin/reconstruction-foundry";
import { unzipSync } from "fflate";
import {
  verifyLocalE57RuntimeBundleOnDisk,
  type LocalE57RuntimeBundleSnapshot,
} from "./local-e57-runtime-bundle-verifier.js";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const ARTIFACT_IDS = [
  "cpython-runtime",
  "pye57-wheel",
  "numpy-wheel",
  "pyquaternion-wheel",
] as const;

type ArtifactId = typeof ARTIFACT_IDS[number];

export type LocalE57RuntimeBundleBuildErrorCode =
  | "LOCAL_E57_RUNTIME_BUILD_ARCHIVE_INVALID"
  | "LOCAL_E57_RUNTIME_BUILD_ARTIFACT_MISMATCH"
  | "LOCAL_E57_RUNTIME_BUILD_CANCELLED"
  | "LOCAL_E57_RUNTIME_BUILD_INPUT_INVALID"
  | "LOCAL_E57_RUNTIME_BUILD_LEGAL_MATERIAL_MISMATCH"
  | "LOCAL_E57_RUNTIME_BUILD_OUTPUT_EXISTS"
  | "LOCAL_E57_RUNTIME_BUILD_OUTPUT_INVALID"
  | "LOCAL_E57_RUNTIME_BUILD_PATH_COLLISION";

export class LocalE57RuntimeBundleBuildError extends Error {
  readonly code: LocalE57RuntimeBundleBuildErrorCode;

  constructor(code: LocalE57RuntimeBundleBuildErrorCode, message: string) {
    super(message);
    this.name = "LocalE57RuntimeBundleBuildError";
    this.code = code;
  }
}

export interface LocalE57RuntimeBundleBuildInput {
  readonly artifacts: Readonly<Record<ArtifactId, string>>;
  readonly createdAtUtc: string;
  readonly environment: unknown;
  readonly externalLegalMaterials: Readonly<Record<string, string>>;
  readonly outputRootPath: string;
  readonly probeScriptPath: string;
  readonly pybind11LicensePath: string;
  readonly signal?: AbortSignal;
}

export interface LocalE57RuntimeBundleBuildResult {
  readonly outputRootPath: string;
  readonly receipt: LocalE57RuntimeBundleReceipt;
  readonly receiptCanonicalBytes: Buffer;
  readonly snapshot: LocalE57RuntimeBundleSnapshot;
}

interface InputFileSnapshot {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly sizeBytes: number;
}

interface PendingOutputFile {
  readonly bytes: Buffer;
  readonly path: string;
  readonly role: LocalE57RuntimeBundleFileRole;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_CANCELLED",
      "The deterministic local E57 runtime-bundle build was cancelled.",
    );
  }
}

async function readCanonicalRegularFile(
  path: string,
  signal: AbortSignal | undefined,
): Promise<InputFileSnapshot> {
  assertNotCancelled(signal);
  if (!isAbsolute(path)) {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_INPUT_INVALID",
      "Every runtime-bundle input file must use an absolute path.",
    );
  }
  const absolute = resolve(path);
  try {
    const before = await lstat(absolute);
    const canonical = await realpath(absolute);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1 ||
      pathKey(canonical) !== pathKey(absolute)
    ) {
      throw new Error("input is linked, hard-linked, aliased, or non-regular");
    }
    const bytes = await readFile(absolute);
    assertNotCancelled(signal);
    const after = await lstat(absolute);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.nlink !== 1 ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error("input changed while being read");
    }
    return { bytes, sha256: sha256(bytes), sizeBytes: bytes.byteLength };
  } catch (error: unknown) {
    if (error instanceof LocalE57RuntimeBundleBuildError) throw error;
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_INPUT_INVALID",
      `Runtime-bundle input is missing, linked, hard-linked, aliased, non-regular, or unstable: ${absolute}`,
    );
  }
}

function normalizeArchiveMemberPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (!isCanonicalLocalE57BundlePath(normalized)) {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_ARCHIVE_INVALID",
      `Archive member has an unsafe or non-canonical path: ${path}`,
    );
  }
  return normalized;
}

function decodeArchive(
  artifactId: ArtifactId,
  archive: InputFileSnapshot,
): {
  readonly files: ReadonlyMap<string, Buffer>;
  readonly memberCount: number;
} {
  let decoded: Record<string, Uint8Array>;
  try {
    decoded = unzipSync(archive.bytes);
  } catch {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_ARCHIVE_INVALID",
      `Exact artifact is not a readable ZIP-compatible archive: ${artifactId}`,
    );
  }
  const members = new Map<string, Buffer>();
  const caseFolded = new Set<string>();
  for (const [rawPath, bytes] of Object.entries(decoded)) {
    if (rawPath.endsWith("/") || rawPath.endsWith("\\")) continue;
    const path = normalizeArchiveMemberPath(rawPath);
    const folded = path.toLowerCase();
    if (caseFolded.has(folded)) {
      throw new LocalE57RuntimeBundleBuildError(
        "LOCAL_E57_RUNTIME_BUILD_ARCHIVE_INVALID",
        `Archive contains a Windows case-folded path collision: ${artifactId}:${path}`,
      );
    }
    caseFolded.add(folded);
    members.set(path, Buffer.from(bytes));
  }
  return { files: members, memberCount: Object.keys(decoded).length };
}

function legalOutputPath(id: string, sourcePath: string | null): string {
  const sourceExtension = sourcePath === null ? "" : extname(sourcePath).toLowerCase();
  const extension = sourceExtension === ".json" ? ".json" : ".txt";
  return `legal/parent/${id}${extension}`;
}

function addPendingFile(
  outputs: Map<string, PendingOutputFile>,
  file: PendingOutputFile,
): void {
  if (!isCanonicalLocalE57BundlePath(file.path)) {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_INPUT_INVALID",
      `Generated output path is not canonical: ${file.path}`,
    );
  }
  const collision = [...outputs.keys()].find(
    (path) => path.toLowerCase() === file.path.toLowerCase(),
  );
  if (collision !== undefined) {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_PATH_COLLISION",
      `Two source members map to the same Windows output path: ${collision} / ${file.path}`,
    );
  }
  outputs.set(file.path, file);
}

function validateEnvironment(input: unknown): FoundryLocalE57IntakeEnvironmentV0 {
  const environment = verifyFoundryLocalE57IntakeEnvironmentV0(input);
  if (environment.environmentSha256 !== FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_SHA256) {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_INPUT_INVALID",
      "The runtime builder accepts only the reviewed T-536 E57 environment receipt.",
    );
  }
  return environment;
}

async function assertOutputParent(inputPath: string): Promise<{
  readonly outputRootPath: string;
  readonly parentPath: string;
}> {
  if (!isAbsolute(inputPath)) {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_OUTPUT_INVALID",
      "The runtime-bundle output root must be an absolute path.",
    );
  }
  const outputRootPath = resolve(inputPath);
  const parentPath = dirname(outputRootPath);
  const outputName = basename(outputRootPath);
  if (outputName.length < 1 || outputName === "." || outputName === "..") {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_OUTPUT_INVALID",
      "The runtime-bundle output root requires a safe final directory name.",
    );
  }
  try {
    const parentStats = await lstat(parentPath);
    const canonicalParent = await realpath(parentPath);
    if (
      parentStats.isSymbolicLink() ||
      !parentStats.isDirectory() ||
      pathKey(canonicalParent) !== pathKey(parentPath)
    ) {
      throw new Error("output parent is linked or not a directory");
    }
  } catch {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_OUTPUT_INVALID",
      "The runtime-bundle output parent is missing, linked, aliased, or not a directory.",
    );
  }
  try {
    await lstat(outputRootPath);
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_OUTPUT_EXISTS",
      "The runtime-bundle output path already exists; deterministic builds never merge or overwrite.",
    );
  } catch (error: unknown) {
    if (error instanceof LocalE57RuntimeBundleBuildError) throw error;
    const code = error !== null && typeof error === "object" && "code" in error
      ? error.code
      : null;
    if (code !== "ENOENT") {
      throw new LocalE57RuntimeBundleBuildError(
        "LOCAL_E57_RUNTIME_BUILD_OUTPUT_INVALID",
        "The runtime-bundle output path could not be checked safely.",
      );
    }
  }
  return { outputRootPath, parentPath };
}

async function buildPendingOutputs(
  input: LocalE57RuntimeBundleBuildInput,
  environment: FoundryLocalE57IntakeEnvironmentV0,
): Promise<Map<string, PendingOutputFile>> {
  const artifacts = new Map<ArtifactId, InputFileSnapshot>();
  const archives = new Map<ArtifactId, ReadonlyMap<string, Buffer>>();
  for (const artifactId of ARTIFACT_IDS) {
    const expected = environment.artifacts.find((artifact) => artifact.id === artifactId);
    const actual = await readCanonicalRegularFile(input.artifacts[artifactId], input.signal);
    if (
      expected === undefined ||
      actual.sizeBytes !== expected.byteSize ||
      actual.sha256 !== expected.sha256
    ) {
      throw new LocalE57RuntimeBundleBuildError(
        "LOCAL_E57_RUNTIME_BUILD_ARTIFACT_MISMATCH",
        `Selected archive does not match the T-536 receipt: ${artifactId}`,
      );
    }
    artifacts.set(artifactId, actual);
    const decoded = decodeArchive(artifactId, actual);
    if (decoded.memberCount !== expected.archiveMemberCount) {
      throw new LocalE57RuntimeBundleBuildError(
        "LOCAL_E57_RUNTIME_BUILD_ARCHIVE_INVALID",
        `Archive member count differs from the T-536 receipt: ${artifactId}`,
      );
    }
    archives.set(artifactId, decoded.files);
  }

  const outputs = new Map<string, PendingOutputFile>();
  for (const [path, bytes] of archives.get("cpython-runtime") ?? []) {
    addPendingFile(outputs, { bytes, path: `runtime/${path}`, role: "python_runtime" });
  }
  for (const artifactId of ["pye57-wheel", "numpy-wheel", "pyquaternion-wheel"] as const) {
    for (const [path, bytes] of archives.get(artifactId) ?? []) {
      addPendingFile(outputs, { bytes, path: `site-packages/${path}`, role: "site_package" });
    }
  }

  const probe = await readCanonicalRegularFile(input.probeScriptPath, input.signal);
  if (
    probe.sizeBytes !== FOUNDRY_LOCAL_E57_AGGREGATE_PROBE.sizeBytes ||
    probe.sha256 !== FOUNDRY_LOCAL_E57_AGGREGATE_PROBE.sha256
  ) {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_ARTIFACT_MISMATCH",
      "The selected probe does not match the exact reviewed aggregate-E57 probe receipt.",
    );
  }
  addPendingFile(outputs, {
    bytes: probe.bytes,
    path: FOUNDRY_LOCAL_E57_AGGREGATE_PROBE.bundlePath,
    role: "probe",
  });

  for (const material of environment.legal.materials) {
    let bytes: Buffer;
    if (material.source === "archive_member") {
      const archive = material.artifactId === null
        ? undefined
        : archives.get(material.artifactId);
      const member = material.memberPath === null
        ? undefined
        : archive?.get(material.memberPath);
      if (member === undefined) {
        throw new LocalE57RuntimeBundleBuildError(
          "LOCAL_E57_RUNTIME_BUILD_LEGAL_MATERIAL_MISMATCH",
          `A receipt-listed archive legal member is missing: ${material.id}`,
        );
      }
      bytes = member;
    } else {
      const suppliedPath = input.externalLegalMaterials[material.id];
      if (suppliedPath === undefined) {
        throw new LocalE57RuntimeBundleBuildError(
          "LOCAL_E57_RUNTIME_BUILD_LEGAL_MATERIAL_MISMATCH",
          `An exact external legal material was not supplied: ${material.id}`,
        );
      }
      bytes = (await readCanonicalRegularFile(suppliedPath, input.signal)).bytes;
    }
    if (bytes.byteLength !== material.byteSize || sha256(bytes) !== material.sha256) {
      throw new LocalE57RuntimeBundleBuildError(
        "LOCAL_E57_RUNTIME_BUILD_LEGAL_MATERIAL_MISMATCH",
        `Legal material differs from the T-536 receipt: ${material.id}`,
      );
    }
    addPendingFile(outputs, {
      bytes,
      path: legalOutputPath(material.id, material.memberPath),
      role: "legal",
    });
  }

  const pybind11 = await readCanonicalRegularFile(input.pybind11LicensePath, input.signal);
  if (
    pybind11.sizeBytes !== FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE.legalNoticeByteSize ||
    pybind11.sha256 !== FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE.legalNoticeSha256
  ) {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_LEGAL_MATERIAL_MISMATCH",
      "The supplied pybind11 notice differs from the exact version-invariant receipt.",
    );
  }
  addPendingFile(outputs, {
    bytes: pybind11.bytes,
    path: "legal/pybind11-LICENSE.txt",
    role: "legal",
  });
  return outputs;
}

function createReceipt(
  input: LocalE57RuntimeBundleBuildInput,
  outputs: ReadonlyMap<string, PendingOutputFile>,
): LocalE57RuntimeBundleReceipt {
  const files = [...outputs.values()]
    .sort((left, right) => compareOrdinal(left.path, right.path))
    .map((file) => ({
      path: file.path,
      role: file.role,
      sha256: sha256(file.bytes),
      sizeBytes: file.bytes.byteLength,
    }));
  return issueLocalE57RuntimeBundleReceipt({
    schemaVersion: FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0,
    authority: "none",
    bundleId: "omnitwin-local-e57-cp313-windows-x64-v0",
    createdAtUtc: input.createdAtUtc,
    execution: "disabled_until_clean_host_qualified_and_adapter_bound",
    fileCount: files.length,
    files,
    layout: {
      dependencyRootPath: "site-packages",
      interpreterPath: "runtime/python.exe",
      legalRootPath: "legal",
      probeScriptPath: "probe/foundry_phase1_probe.py",
    },
    legalPack: {
      microsoftInstallerBundled: false,
      parentEnvironmentLegalReceiptsApplied: true,
      pybind11NoticePath: "legal/pybind11-LICENSE.txt",
      rootPath: "legal",
      state: "assembled",
    },
    limitations: [
      "PYBIND11_EXACT_BUILD_VERSION_IS_INFERRED_NOT_ATTESTED",
      "SELECTED_MICROSOFT_VC_REDIST_INSTALLER_AND_CANONICAL_MSVCP140_DLL_ARE_NOT_BUNDLE_MEMBERS",
      "BUNDLE_BYTE_IDENTITY_DOES_NOT_ESTABLISH_PUBLISHER_BUILD_REPRODUCIBILITY",
    ],
    materialization: {
      completeAllowlist: true,
      directoriesExcludedFromReceipt: true,
      hardLinksEncountered: 0,
      regularFilesOnly: true,
      reparsePointsEncountered: 0,
    },
    microsoftCppRuntime: FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME,
    parentEnvironmentSha256: FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_SHA256,
    pybind11: {
      ...FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE,
      binaryFingerprintMarkers: [
        ...FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE.binaryFingerprintMarkers,
      ],
    },
    target: {
      architecture: "x64",
      lane: "e57_read_only_aggregate_metadata",
      operatingSystem: "windows",
      pythonAbi: "cp313",
      pythonImplementation: "CPython",
      pythonVersion: "3.13.14",
    },
    totalFileBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
  });
}

export async function materializeLocalE57RuntimeBundle(
  input: LocalE57RuntimeBundleBuildInput,
): Promise<LocalE57RuntimeBundleBuildResult> {
  assertNotCancelled(input.signal);
  if (!SHA256_HEX.test(FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME.sha256)) {
    throw new LocalE57RuntimeBundleBuildError(
      "LOCAL_E57_RUNTIME_BUILD_INPUT_INVALID",
      "The selected Microsoft prerequisite receipt is malformed.",
    );
  }
  const environment = validateEnvironment(input.environment);
  const { outputRootPath, parentPath } = await assertOutputParent(input.outputRootPath);
  const outputs = await buildPendingOutputs(input, environment);
  const receipt = createReceipt(input, outputs);
  const stagingPath = join(
    parentPath,
    `.${basename(outputRootPath)}.partial-${randomUUID()}`,
  );
  let published = false;
  try {
    await mkdir(stagingPath, { recursive: false });
    for (const file of [...outputs.values()].sort((left, right) =>
      compareOrdinal(left.path, right.path)
    )) {
      assertNotCancelled(input.signal);
      const outputPath = join(stagingPath, ...file.path.split("/"));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, file.bytes, { flag: "wx" });
    }
    const staged = await verifyLocalE57RuntimeBundleOnDisk({
      receipt,
      rootPath: stagingPath,
      signal: input.signal,
    });
    await rename(stagingPath, outputRootPath);
    published = true;
    const publishedVerification = await verifyLocalE57RuntimeBundleOnDisk({
      receipt,
      rootPath: outputRootPath,
      signal: input.signal,
    });
    if (
      staged.snapshot.fileCount !== publishedVerification.snapshot.fileCount ||
      staged.snapshot.totalFileBytes !== publishedVerification.snapshot.totalFileBytes
    ) {
      throw new LocalE57RuntimeBundleBuildError(
        "LOCAL_E57_RUNTIME_BUILD_OUTPUT_INVALID",
        "The published runtime bundle differs from the fully verified staging tree.",
      );
    }
    const receiptCanonicalBytes = Buffer.from(
      `${stableCanonicalJson(toCanonicalJson(receipt))}\n`,
      "utf8",
    );
    return {
      outputRootPath,
      receipt,
      receiptCanonicalBytes,
      snapshot: publishedVerification.snapshot,
    };
  } finally {
    if (!published) {
      const resolvedStaging = resolve(stagingPath);
      if (dirname(resolvedStaging) === resolve(parentPath) && basename(resolvedStaging).startsWith(
        `.${basename(outputRootPath)}.partial-`,
      )) {
        await rm(resolvedStaging, { force: true, recursive: true });
      }
    }
  }
}

import { spawn } from "node:child_process";
import {
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CaptureStageManifestSchema,
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_PHASE1_BUNDLE_V0,
  FOUNDRY_PHASE1_COLMAP_INSPECTION_V0,
  FOUNDRY_PHASE1_E57_INSPECTION_V0,
  FOUNDRY_PHASE1_RESIDUAL_REPORT_V0,
  FOUNDRY_PHASE1_TRANSFORM_PROPOSAL_V0,
  FoundryIngestManifestV0Schema,
  FoundryPhase1BundleV0Schema,
  FoundryPhase1ColmapInspectionMaterialV0Schema,
  FoundryPhase1ColmapInspectionV0Schema,
  FoundryPhase1E57InspectionMaterialV0Schema,
  FoundryPhase1E57InspectionV0Schema,
  FoundryPhase1IdentityReviewV0Schema,
  FoundryPhase1ProbeEnvelopeV0Schema,
  FoundryPhase1ResidualReportMaterialV0Schema,
  FoundryPhase1ResidualReportV0Schema,
  FoundryPhase1SweepCorrespondenceV0Schema,
  FoundryPhase1TransformProposalMaterialV0Schema,
  FoundryPhase1TransformProposalV0Schema,
  computeFoundryIngestManifestSha256,
  computeFoundryPhase1ColmapInspectionSha256,
  computeFoundryPhase1E57InspectionSha256,
  computeFoundryPhase1ResidualMetrics,
  computeFoundryPhase1ResidualReportSha256,
  computeFoundryPhase1TransformProposalSha256,
  type FoundryIngestManifestV0,
  type FoundryPhase1ColmapInspectionV0,
  type FoundryPhase1ColmapSourceFile,
  type FoundryPhase1CorrespondenceResidualV0,
  type FoundryPhase1E57InspectionV0,
  type FoundryPhase1IdentityReviewV0,
  type FoundryPhase1ProbeEnvelopeV0,
  type FoundryPhase1ResidualReportV0,
  type FoundryPhase1SweepCorrespondenceV0,
  type FoundryPhase1TransformProposalV0,
} from "@omnitwin/types";
import { sha256File, sha256Text, type FileDigest } from "./hash.js";

const FACE_NAMES = ["back", "down", "front", "left", "right", "up"] as const;
const SWEEP_COUNT = 50;
const EXPECTED_IMAGE_COUNT = SWEEP_COUNT * FACE_NAMES.length;
const E57_STAGE_PATH = "source/e57/cloud_0.e57";
const STAGE_MANIFEST_NAME = "capture-stage-manifest.json";
const DATABASE_PATH = "database.db";
const OPTIONAL_MODEL_PATH = "sparse/project.ini";
const REQUIRED_MODEL_PATHS = [
  "sparse/0/cameras.bin",
  "sparse/0/frames.bin",
  "sparse/0/images.bin",
  "sparse/0/points3D.bin",
  "sparse/0/rigs.bin",
] as const;
const MAX_PROBE_STDOUT_BYTES = 128 * 1024 * 1024;
const MAX_PROBE_STDERR_BYTES = 1024 * 1024;
const PROBE_TIMEOUT_MS = 15 * 60 * 1000;
const BUNDLED_PROBE_SCRIPT = fileURLToPath(
  new URL("../python/foundry_phase1_probe.py", import.meta.url),
);
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const FROZEN_HOLDOUT_SWEEPS = [5, 15, 25, 35, 44] as const;
const IDENTITY_REVIEW_OUTPUT = "identity-review.json";
const E57_INSPECTION_OUTPUT = "inspections/e57-inspection.json";
const COLMAP_INSPECTION_OUTPUT = "inspections/colmap-inspection.json";
const FULL_RESIDUAL_OUTPUT = "reports/alignment-full-fit-residuals.json";
const HOLDOUT_RESIDUAL_OUTPUT = "reports/alignment-frozen-holdout-residuals.json";
const TRANSFORM_OUTPUT = "proposals/colmap-to-e57-transform.json";
const MANIFEST_OUTPUT = "foundry-ingest-manifest-v0.json";
const PACKAGE_INDEX_OUTPUT = "phase1-output-index.json";
const BUNDLE_OUTPUT = "foundry-phase1-bundle-v0.json";
const RESIDUAL_REPORT_OUTPUT = "reports/colmap-to-e57-residual-report.json";
const RAW_E57_PROBE_OUTPUT = "inspections/raw/e57-probe-output.json";
const RAW_COLMAP_PROBE_OUTPUT = "inspections/raw/colmap-probe-output.json";
const RAW_ALIGNMENT_PROBE_OUTPUT = "inspections/raw/alignment-probe-output.json";

type ProbeSuccess = Extract<FoundryPhase1ProbeEnvelopeV0, { status: "ok" }>;

interface AlignmentResult extends Readonly<Record<string, unknown>> {
  readonly conventions: unknown;
  readonly correspondences: readonly unknown[];
  readonly fullFit: Readonly<Record<string, unknown>>;
  readonly phase1CandidateWithHoldout: Readonly<Record<string, unknown>>;
}

interface HashedInput {
  readonly rootId: "capture-stage-root" | "colmap-root";
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly digest: FileDigest;
  readonly kind: "e57" | "image" | "colmap-metadata";
}

interface FileState {
  readonly absolutePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly modifiedAtMs: number;
}

export interface FoundryPhase1Options {
  readonly identityReviewPath: string;
  readonly captureStageRoot: string;
  readonly colmapRoot: string;
  readonly outputDirectory: string;
  readonly projectId: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface FoundryPhase1Result {
  readonly outputDirectory: string;
  readonly manifestSha256: string;
  readonly assetCount: number;
  readonly includedSweeps: readonly number[];
  readonly excludedSweeps: readonly number[];
}

export interface FoundryPhase1Dependencies {
  readonly hashFile: (path: string) => Promise<FileDigest>;
  readonly resolvePythonExecutable: () => Promise<string>;
  readonly resolvePythonDependencyRoot: () => Promise<string>;
  readonly invokeProbe: (
    pythonExecutable: string,
    probeScript: string,
    dependencyRoot: string,
    args: readonly string[],
  ) => Promise<unknown>;
  readonly validateIdentityReview: (input: unknown) => FoundryPhase1IdentityReviewV0;
  readonly validateProbe: (input: unknown, expectedMode: ProbeSuccess["mode"]) => ProbeSuccess;
}

const defaultDependencies: FoundryPhase1Dependencies = {
  hashFile: sha256File,
  resolvePythonExecutable: resolvePythonExecutable,
  resolvePythonDependencyRoot: resolvePythonDependencyRoot,
  invokeProbe: invokePythonProbe,
  validateIdentityReview: (input) => FoundryPhase1IdentityReviewV0Schema.parse(input),
  validateProbe: validateProbeContract,
};

function errorCode(error: unknown): unknown {
  if (error !== null && typeof error === "object" && "code" in error) return error.code;
  return undefined;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(comparable(parent), comparable(candidate));
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent))
  );
}

function expectedImagePaths(): string[] {
  const paths: string[] = [];
  for (let sweep = 0; sweep < SWEEP_COUNT; sweep += 1) {
    for (const face of FACE_NAMES) {
      paths.push(`images/scan_${String(sweep).padStart(3, "0")}_${face}.jpg`);
    }
  }
  return paths.sort();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function canonicalDirectoryWithoutLinks(input: string, label: string): Promise<string> {
  const absolute = resolve(input);
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a link or non-directory: ${absolute}`);
  }
  const canonical = await realpath(absolute);
  if (comparable(canonical) !== comparable(absolute)) {
    throw new Error(`${label} resolves through a link or reparse point: ${absolute}`);
  }
  return canonical;
}

async function resolveThroughExistingAncestor(input: string): Promise<string> {
  let cursor = resolve(input);
  const suffix: string[] = [];
  while (!(await pathExists(cursor))) {
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`No existing ancestor for output path: ${input}`);
    suffix.unshift(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cursor = parent;
  }
  const metadata = await lstat(cursor);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Output path resolves through a link or reparse point: ${cursor}`);
  }
  const canonicalAncestor = await realpath(cursor);
  if (comparable(canonicalAncestor) !== comparable(cursor)) {
    throw new Error(`Output path resolves through a link or reparse point: ${cursor}`);
  }
  return resolve(canonicalAncestor, ...suffix);
}

async function assertSafeOutput(
  outputInput: string,
  protectedRoots: readonly string[],
): Promise<string> {
  if (/^(?:\\\\|\/\/)/u.test(outputInput)) {
    throw new Error(`Output must be a local non-UNC path: ${outputInput}`);
  }
  const output = await resolveThroughExistingAncestor(outputInput);
  if (await pathExists(output)) throw new Error(`Final output already exists: ${output}`);
  for (const root of protectedRoots) {
    if (isWithin(root, output) || isWithin(output, root)) {
      throw new Error(`Output must not overlap protected source root ${root}: ${output}`);
    }
  }
  return output;
}

async function assertRegularPathWithoutLinks(root: string, relativePath: string): Promise<string> {
  const parts = relativePath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error(`Unsafe bounded input path: ${relativePath}`);
  }
  let cursor = root;
  for (const part of parts) {
    cursor = join(cursor, part);
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Bounded input contains a link or reparse point: ${cursor}`);
    }
  }
  const metadata = await lstat(cursor);
  if (!metadata.isFile()) throw new Error(`Bounded input is not a regular file: ${cursor}`);
  const canonical = await realpath(cursor);
  if (!isWithin(root, canonical) || comparable(canonical) !== comparable(cursor)) {
    throw new Error(`Bounded input escapes or resolves through a link: ${cursor}`);
  }
  return canonical;
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a string`);
  return value;
}

function requireNumber(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be finite`);
  return value;
}

function requireSafeInteger(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = requireNumber(record, key);
  if (!Number.isSafeInteger(value)) throw new Error(`${key} must be a safe integer`);
  return value;
}

function requireRecordArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>>[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  return value.map((entry) => requireRecord(entry, key));
}

function requireVec3(record: Readonly<Record<string, unknown>>, key: string): [number, number, number] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
  ) {
    throw new Error(`${key} must be a finite three-vector`);
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function requireNumberArray(record: Readonly<Record<string, unknown>>, key: string): number[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    throw new Error(`${key} must be a finite number array`);
  }
  return value.map(Number);
}

function requireIntegerArray(record: Readonly<Record<string, unknown>>, key: string): number[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(item))) {
    throw new Error(`${key} must be an integer array`);
  }
  return value.map((item) => Number(item));
}

function validateProbeContract(input: unknown, expectedMode: ProbeSuccess["mode"]): ProbeSuccess {
  const envelope = FoundryPhase1ProbeEnvelopeV0Schema.parse(input);
  if (envelope.status !== "ok") {
    throw new Error(`Phase-1 probe failed (${envelope.error.code}): ${envelope.error.message}`);
  }
  if (envelope.mode !== expectedMode) {
    throw new Error(`Probe mode mismatch: expected ${expectedMode}, received ${envelope.mode}`);
  }
  return envelope;
}

function parseJson(text: string, label: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch (error: unknown) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

async function readIdentityReview(
  path: string,
  dependencies: FoundryPhase1Dependencies,
): Promise<FoundryPhase1IdentityReviewV0> {
  const absolute = resolve(path);
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Identity review must be a regular non-link file: ${absolute}`);
  }
  if (comparable(await realpath(absolute)) !== comparable(absolute)) {
    throw new Error(`Identity review resolves through a link or reparse point: ${absolute}`);
  }
  const review = dependencies.validateIdentityReview(
    parseJson(await readFile(absolute, "utf8"), "identity review"),
  );
  return review;
}

function executableNames(): readonly string[] {
  return process.platform === "win32" ? ["python.exe"] : ["python3", "python"];
}

async function resolvePythonExecutable(): Promise<string> {
  const pathValue = process.env.PATH;
  if (pathValue === undefined || pathValue.trim() === "") {
    throw new Error("PATH is unavailable; cannot resolve the pinned phase-1 Python interpreter");
  }
  for (const rawDirectory of pathValue.split(delimiter)) {
    const directory = rawDirectory.trim().replace(/^"|"$/gu, "");
    if (directory === "" || !isAbsolute(directory)) continue;
    for (const name of executableNames()) {
      const candidate = join(directory, name);
      try {
        const canonical = await realpath(candidate);
        const metadata = await lstat(canonical);
        if (metadata.isFile() && !metadata.isSymbolicLink()) return canonical;
      } catch (error: unknown) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }
  throw new Error("No regular Python interpreter was found on PATH");
}

async function resolvePythonDependencyRoot(): Promise<string> {
  const appData = process.env.APPDATA;
  if (appData === undefined || appData.trim() === "") {
    throw new Error("APPDATA is unavailable; cannot resolve the isolated Python dependency root");
  }
  const pythonUserRoot = join(appData, "Python");
  const candidates: string[] = [];
  for (const entry of await readdir(pythonUserRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^Python\d+$/u.test(entry.name)) continue;
    const sitePackages = join(pythonUserRoot, entry.name, "site-packages");
    if (
      await pathExists(join(sitePackages, "numpy", "__init__.py")) &&
      await pathExists(join(sitePackages, "pye57", "__init__.py"))
    ) {
      candidates.push(await canonicalDirectoryWithoutLinks(sitePackages, "Python dependency root"));
    }
  }
  if (candidates.length !== 1 || candidates[0] === undefined) {
    throw new Error(`Expected exactly one Python dependency root with NumPy and pye57; found ${String(candidates.length)}`);
  }
  return candidates[0];
}

function minimalProbeEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONHASHSEED: "0",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
  };
  const allowed = new Set(["systemroot", "windir", "temp", "tmp"]);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toLowerCase())) result[key] = value;
  }
  return result;
}

async function invokePythonProbe(
  pythonExecutable: string,
  probeScript: string,
  dependencyRoot: string,
  args: readonly string[],
): Promise<unknown> {
  return await new Promise<unknown>((resolvePromise, rejectPromise) => {
    const bootstrap = [
      "import runpy,sys",
      "dependency_root,probe,*probe_args=sys.argv[1:]",
      "sys.path.append(dependency_root)",
      "sys.argv=[probe,*probe_args]",
      "runpy.run_path(probe,run_name='__main__')",
    ].join(";");
    const child = spawn(
      pythonExecutable,
      ["-I", "-S", "-B", "-c", bootstrap, dependencyRoot, resolve(probeScript), ...args],
      {
      cwd: dirname(resolve(probeScript)),
      env: minimalProbeEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let limitExceeded: "stdout" | "stderr" | null = null;
    let timedOut = false;
    let settled = false;
    const finish = (error: Error | null, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error === null) resolvePromise(value);
      else rejectPromise(error);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, PROBE_TIMEOUT_MS);
    timeout.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_PROBE_STDOUT_BYTES) {
        limitExceeded = "stdout";
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_PROBE_STDERR_BYTES) {
        limitExceeded = "stderr";
        child.kill("SIGKILL");
        return;
      }
      stderr.push(chunk);
    });
    child.once("error", (error: Error) => {
      finish(error);
    });
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (timedOut) {
        finish(new Error(`Phase-1 probe exceeded the ${String(PROBE_TIMEOUT_MS)} ms wall-clock limit`));
        return;
      }
      if (limitExceeded !== null) {
        finish(new Error(`Phase-1 probe exceeded the bounded ${limitExceeded} limit`));
        return;
      }
      const output = Buffer.concat(stdout).toString("utf8");
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        let detail = errorOutput;
        try {
          detail = JSON.stringify(parseJson(output, "phase-1 probe error output"));
        } catch {
          // The bounded stderr is the only diagnostic when a process fails before JSON emission.
        }
        finish(
          new Error(`Phase-1 probe exited ${String(code)}${signal === null ? "" : ` (${signal})`}: ${detail}`),
        );
        return;
      }
      if (errorOutput !== "") {
        finish(new Error(`Phase-1 probe emitted unexpected stderr: ${errorOutput}`));
        return;
      }
      finish(null, parseJson(output, "phase-1 probe output"));
    });
  });
}

async function verifyCaptureStage(
  stageRoot: string,
  dependencies: FoundryPhase1Dependencies,
): Promise<HashedInput> {
  const manifestPath = await assertRegularPathWithoutLinks(stageRoot, STAGE_MANIFEST_NAME);
  const manifest = CaptureStageManifestSchema.parse(
    parseJson(await readFile(manifestPath, "utf8"), "capture stage manifest"),
  );
  const entry = manifest.files.find((file) => file.targetRelativePath === E57_STAGE_PATH);
  if (entry === undefined || entry.role !== "primary_capture") {
    throw new Error(`Capture stage manifest does not contain primary E57 target ${E57_STAGE_PATH}`);
  }
  const duplicates = manifest.files.filter((file) => file.targetRelativePath.endsWith(".e57"));
  if (duplicates.length !== 1) throw new Error("Capture stage must contain exactly one staged E57 asset");
  const absolutePath = await assertRegularPathWithoutLinks(stageRoot, E57_STAGE_PATH);
  const digest = await dependencies.hashFile(absolutePath);
  if (digest.sha256 !== entry.sha256 || digest.sizeBytes !== entry.sizeBytes) {
    throw new Error("Staged E57 bytes do not match the Capture Factory manifest digest");
  }
  return { rootId: "capture-stage-root", relativePath: E57_STAGE_PATH, absolutePath, digest, kind: "e57" };
}

async function assertExactDirectoryEntries(
  path: string,
  expectedFiles: ReadonlySet<string>,
): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  const actual = entries.map((entry) => entry.name).sort();
  const expected = [...expectedFiles].sort();
  if (actual.join("\n") !== expected.join("\n")) {
    throw new Error(`Bounded directory contents differ from the exact allowlist: ${path}`);
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Bounded directory contains a non-regular or linked entry: ${join(path, entry.name)}`);
    }
  }
}

async function enumerateBoundedColmap(colmapRoot: string): Promise<readonly string[]> {
  const imagePaths = expectedImagePaths();
  const imagesDirectory = await canonicalDirectoryWithoutLinks(join(colmapRoot, "images"), "COLMAP images root");
  await assertExactDirectoryEntries(
    imagesDirectory,
    new Set(imagePaths.map((path) => path.slice("images/".length))),
  );

  const sparseDirectory = await canonicalDirectoryWithoutLinks(join(colmapRoot, "sparse", "0"), "COLMAP sparse model root");
  const requiredNames = new Set(REQUIRED_MODEL_PATHS.map((path) => path.slice("sparse/0/".length)));
  const sparseEntries = await readdir(sparseDirectory, { withFileTypes: true });
  for (const entry of sparseEntries) {
    if (!requiredNames.has(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`COLMAP sparse/0 contains an unbounded or non-regular entry: ${entry.name}`);
    }
  }
  for (const required of requiredNames) {
    if (!sparseEntries.some((entry) => entry.name === required)) {
      throw new Error(`COLMAP sparse/0 is missing required file: ${required}`);
    }
  }

  await assertRegularPathWithoutLinks(colmapRoot, DATABASE_PATH);
  await assertSqliteSidecarsFrozen(colmapRoot);

  const paths = [DATABASE_PATH, ...REQUIRED_MODEL_PATHS, ...imagePaths];
  const sparseRoot = await canonicalDirectoryWithoutLinks(join(colmapRoot, "sparse"), "COLMAP sparse root");
  const sparseRootEntries = await readdir(sparseRoot, { withFileTypes: true });
  for (const entry of sparseRootEntries) {
    const validModelDirectory = entry.name === "0" && entry.isDirectory() && !entry.isSymbolicLink();
    const validProjectFile = entry.name === "project.ini" && entry.isFile() && !entry.isSymbolicLink();
    if (!validModelDirectory && !validProjectFile) {
      throw new Error(`COLMAP sparse contains an unbounded or linked entry: ${entry.name}`);
    }
  }
  if (sparseRootEntries.some((entry) => entry.name === "project.ini")) paths.push(OPTIONAL_MODEL_PATH);
  return paths.sort();
}

async function assertSqliteSidecarsFrozen(colmapRoot: string): Promise<void> {
  const journalPath = join(colmapRoot, `${DATABASE_PATH}-journal`);
  if (await pathExists(journalPath)) {
    throw new Error("COLMAP database has a rollback journal; recover or remove it before immutable inspection");
  }
  const walPath = join(colmapRoot, `${DATABASE_PATH}-wal`);
  if (await pathExists(walPath)) {
    const wal = await lstat(walPath);
    if (wal.isSymbolicLink() || !wal.isFile()) throw new Error("COLMAP WAL must be a regular non-link file");
    if (wal.size > 0) throw new Error("COLMAP database has a nonempty WAL; checkpoint it before immutable inspection");
  }
  const shmPath = join(colmapRoot, `${DATABASE_PATH}-shm`);
  if (await pathExists(shmPath)) {
    const shm = await lstat(shmPath);
    if (shm.isSymbolicLink() || !shm.isFile()) throw new Error("COLMAP SHM must be a regular non-link file");
  }
}

async function hashColmapInputs(
  colmapRoot: string,
  relativePaths: readonly string[],
  dependencies: FoundryPhase1Dependencies,
): Promise<HashedInput[]> {
  const inputs: HashedInput[] = [];
  for (const relativePath of relativePaths) {
    const absolutePath = await assertRegularPathWithoutLinks(colmapRoot, relativePath);
    const digest = await dependencies.hashFile(absolutePath);
    inputs.push({
      rootId: "colmap-root",
      relativePath,
      absolutePath,
      digest,
      kind: relativePath.startsWith("images/") ? "image" : "colmap-metadata",
    });
  }
  return inputs;
}

function snapshotStates(inputs: readonly HashedInput[]): FileState[] {
  return inputs.map((input) => ({
    absolutePath: input.absolutePath,
    sha256: input.digest.sha256,
    sizeBytes: input.digest.sizeBytes,
    modifiedAtMs: input.digest.modifiedAtMs,
  }));
}

async function assertStatesUnchanged(
  states: readonly FileState[],
  dependencies: FoundryPhase1Dependencies,
): Promise<void> {
  for (const before of states) {
    const linkState = await lstat(before.absolutePath);
    if (linkState.isSymbolicLink() || !linkState.isFile()) {
      throw new Error(`Input became a link or non-regular file after hashing: ${before.absolutePath}`);
    }
    const canonical = await realpath(before.absolutePath);
    if (comparable(canonical) !== comparable(before.absolutePath)) {
      throw new Error(`Input path changed identity after hashing: ${before.absolutePath}`);
    }
    const after = await stat(before.absolutePath);
    if (after.size !== before.sizeBytes || after.mtimeMs !== before.modifiedAtMs) {
      throw new Error(`Input changed after hashing: ${before.absolutePath}`);
    }
    const digest = await dependencies.hashFile(before.absolutePath);
    if (
      digest.sha256 !== before.sha256 ||
      digest.sizeBytes !== before.sizeBytes ||
      digest.modifiedAtMs !== before.modifiedAtMs
    ) {
      throw new Error(`Input content changed after hashing: ${before.absolutePath}`);
    }
  }
}

function asAlignmentResult(result: Readonly<Record<string, unknown>>): AlignmentResult {
  const correspondences = result.correspondences;
  if (!Array.isArray(correspondences) || correspondences.length !== SWEEP_COUNT) {
    throw new Error(`Alignment probe must emit ${String(SWEEP_COUNT)} correspondences`);
  }
  const fullFit = requireRecord(result.fullFit, "alignment fullFit");
  const candidate = requireRecord(
    result.phase1CandidateWithHoldout,
    "alignment phase1CandidateWithHoldout",
  );
  const allSweeps = Array.from({ length: SWEEP_COUNT }, (_, index) => index).join(",");
  const candidateSweeps = Array.from({ length: 49 }, (_, index) => index).join(",");
  const expectedFit = Array.from({ length: 49 }, (_, index) => index)
    .filter((index) => !FROZEN_HOLDOUT_SWEEPS.includes(index as (typeof FROZEN_HOLDOUT_SWEEPS)[number]))
    .join(",");
  if (requireIntegerArray(fullFit, "fitSweepIndices").join(",") !== allSweeps) {
    throw new Error("Full reproduction fit must use sweeps 0..49 exactly");
  }
  if (requireIntegerArray(candidate, "candidateSweepIndices").join(",") !== candidateSweeps) {
    throw new Error("Phase-1 candidate must use sweeps 0..48 exactly");
  }
  if (requireIntegerArray(candidate, "fitSweepIndices").join(",") !== expectedFit) {
    throw new Error("Phase-1 candidate fit must exclude sweep 049 and the frozen holdout");
  }
  if (requireIntegerArray(candidate, "heldOutSweepIndices").join(",") !== FROZEN_HOLDOUT_SWEEPS.join(",")) {
    throw new Error("Phase-1 candidate holdout must be frozen as [5,15,25,35,44]");
  }
  return {
    ...result,
    conventions: result.conventions,
    correspondences,
    fullFit,
    phase1CandidateWithHoldout: candidate,
  };
}

function prefixedSha256(hex: string): string {
  return `sha256:${hex}`;
}

function inputId(input: HashedInput): string {
  if (input.kind === "e57") return "e57-main";
  return `colmap-${sha256Text(input.relativePath).slice(0, 20)}`;
}

function imageRights() {
  return {
    basis: "vendor_export_terms" as const,
    commercialUse: "restricted" as const,
    modelTrainingUse: "prohibited" as const,
    redistribution: "restricted" as const,
    termsReviewedAt: null,
    termsReference: null,
    restrictions: [
      "Matterport-derived imagery is blocked from model training pending a written legal determination.",
      "Commercial processing and redistribution require legal review of the applicable export terms.",
    ],
  };
}

function e57Rights() {
  return {
    basis: "vendor_export_terms" as const,
    commercialUse: "restricted" as const,
    modelTrainingUse: "requires_review" as const,
    redistribution: "restricted" as const,
    termsReviewedAt: null,
    termsReference: null,
    restrictions: [
      "Matterport export rights require legal review before commercial reconstruction processing.",
      "This phase authorizes deterministic read-only metadata inspection only; no training or publication.",
    ],
  };
}

function buildManifest(
  options: FoundryPhase1Options,
  e57: HashedInput,
  colmap: readonly HashedInput[],
): FoundryIngestManifestV0 {
  const e57AssetId = inputId(e57);
  const assets = [e57, ...colmap].map((input) => ({
    id: inputId(input),
    sourceRootId: input.rootId,
    relativePath: input.relativePath,
    inputType:
      input.kind === "e57"
        ? ("matterport_e57" as const)
        : input.kind === "image"
          ? ("generic_image" as const)
          : input.relativePath === DATABASE_PATH
            ? ("colmap_database" as const)
            : ("colmap_sparse_model" as const),
    mediaType:
      input.kind === "e57"
        ? "model/e57"
        : input.kind === "image"
          ? "image/jpeg"
          : input.relativePath === DATABASE_PATH
            ? "application/vnd.sqlite3"
            : input.relativePath === OPTIONAL_MODEL_PATH
              ? "text/plain"
              : "application/vnd.colmap.sparse-model",
    sizeBytes: input.digest.sizeBytes,
    sha256: prefixedSha256(input.digest.sha256),
    immutable: true as const,
    captureState: input.kind === "e57" ? ("official_export" as const) : ("reference" as const),
    accessState: input.kind === "e57" ? ("official_export" as const) : ("direct" as const),
    capturedAt: null,
    coordinateFrameId: input.kind === "e57" ? "e57-scan-frame" : "colmap-camera-frame",
    calibrationAssetIds: [],
    parentAssetIds: [],
    rights: input.kind === "e57" ? e57Rights() : imageRights(),
    provenanceClass: "captured" as const,
    evidenceKinds: [],
    inspection: {
      geometryValue: input.kind === "e57" ? ("high" as const) : ("none" as const),
      appearanceValue: input.kind === "image" ? ("medium" as const) : ("none" as const),
      calibrationValue: input.kind === "colmap-metadata" ? ("medium" as const) : ("unknown" as const),
      scaleValue: input.kind === "e57" ? ("high" as const) : ("unknown" as const),
      metadataKeys:
        input.kind === "e57"
          ? ["data3D", "images2D", "pose"]
          : input.kind === "image"
            ? ["jpeg_sof", "colmap_image_name"]
            : ["colmap_binary_model"],
      decisiveNextTest:
        input.kind === "e57"
          ? "Review deterministic E57 inspection and independently verify the scanner-frame convention."
          : input.kind === "image"
            ? "Resolve Matterport-derived image processing and training rights before appearance work."
            : "Review deterministic COLMAP metadata inspection and alignment correspondences.",
    },
    notes:
      input.kind === "image" && input.relativePath.startsWith("images/scan_049_")
        ? [
            "Reproduction-only source: sweep 049 is excluded_adjacent_space and cannot enter the phase-1 candidate fit or holdout.",
            "Hashed as part of the exact 300-image first-50-sweep diagnostic set; not authorized for training.",
            "Historical derivation tool, environment, time, and complete parent lineage are unverified; no provenance edge is asserted.",
          ]
        : input.kind === "image"
          ? [
              "Phase-1 candidate source; hashed as part of the exact 300-image set and not authorized for training.",
              "Historical derivation tool, environment, time, and complete parent lineage are unverified; no provenance edge is asserted.",
            ]
        : input.kind === "colmap-metadata"
          ? [
              "Derived COLMAP metadata; database WAL, SHM, and rollback-journal sidecars are excluded from immutable input identity.",
              "Historical solve tool, environment, time, and complete parent lineage are unverified; no provenance edge is asserted.",
            ]
          : ["Digest verified against the existing Capture Factory stage manifest."],
  }));
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: options.projectId,
    createdAt: options.createdAt,
    createdBy: options.createdBy,
    sourceRoots: [
      {
        id: "capture-stage-root",
        kind: "local_directory",
        displayName: "Capture Factory verified stage",
        locationRedacted: "CAPTURE_FACTORY_STAGE_ROOT",
        caseSensitivity: process.platform === "win32" ? "insensitive" : "sensitive",
        readOnly: true,
      },
      {
        id: "colmap-root",
        kind: "local_directory",
        displayName: "Bounded first-50-sweep COLMAP diagnostic",
        locationRedacted: "COLMAP_DIAGNOSTIC_ROOT",
        caseSensitivity: process.platform === "win32" ? "insensitive" : "sensitive",
        readOnly: true,
      },
    ],
    coordinateFrames: [
      {
        id: "e57-scan-frame",
        kind: "lidar",
        units: "meters",
        handedness: "right",
        upAxis: "z",
        authority: "measured",
        provenanceAssetIds: [e57AssetId],
        crs: null,
      },
      {
        id: "colmap-camera-frame",
        kind: "camera",
        units: "unitless",
        handedness: "right",
        upAxis: "unknown",
        authority: "registered",
        provenanceAssetIds: colmap
          .filter((input) => input.kind === "colmap-metadata")
          .map(inputId)
          .sort(),
        crs: null,
      },
    ],
    transforms: [],
    assets: assets.sort((left, right) => left.id.localeCompare(right.id)),
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "requires_review",
    sourceMutationPermitted: false,
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

async function writeSyncedJson(root: string, relativePath: string, value: unknown): Promise<void> {
  const parts = relativePath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error(`Unsafe output artifact path: ${relativePath}`);
  }
  const target = join(root, ...parts);
  await mkdir(dirname(target), { recursive: true });
  const handle = await open(target, "wx");
  try {
    await handle.writeFile(jsonBytes(value), { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function collectOutputFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Output tree contains a link: ${absolute}`);
    if (entry.isDirectory()) files.push(...await collectOutputFiles(root, absolute));
    else if (entry.isFile()) files.push(relative(root, absolute).split(sep).join("/"));
    else throw new Error(`Output tree contains a non-regular entry: ${absolute}`);
  }
  return files;
}

async function verifyOutputTree(
  root: string,
  artifacts: Readonly<Record<string, unknown>>,
): Promise<void> {
  const expectedPaths = Object.keys(artifacts).sort();
  const actualPaths = (await collectOutputFiles(root)).sort();
  if (actualPaths.join("\n") !== expectedPaths.join("\n")) {
    throw new Error("Phase-1 output tree differs from the exact artifact allowlist");
  }
  for (const relativePath of expectedPaths) {
    const value = artifacts[relativePath];
    const expected = jsonBytes(value);
    const actual = await readFile(join(root, ...relativePath.split("/")), "utf8");
    if (actual !== expected || sha256Text(actual) !== sha256Text(expected)) {
      throw new Error(`Phase-1 output artifact failed post-write verification: ${relativePath}`);
    }
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    if (!(["EISDIR", "EINVAL", "EPERM"] as readonly unknown[]).includes(errorCode(error))) throw error;
  }
}

async function syncDirectoryTree(root: string): Promise<void> {
  const directories: string[] = [root];
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index];
    if (directory === undefined) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) directories.push(join(directory, entry.name));
    }
  }
  for (const directory of directories.reverse()) await syncDirectory(directory);
}

function artifactDigest(value: unknown): string {
  return prefixedSha256(sha256Text(jsonBytes(value)));
}

function domainSeparatedDigest(domain: string, value: unknown): string {
  return prefixedSha256(sha256Text(`${domain}\n${jsonBytes(value)}`));
}

function buildE57Inspection(
  review: FoundryPhase1IdentityReviewV0,
  source: HashedInput,
  probe: ProbeSuccess,
  inspectedAt: string,
): FoundryPhase1E57InspectionV0 {
  const result = probe.result;
  const adapter = requireRecord(result.adapter, "E57 adapter");
  const scans = requireRecordArray(result, "scans");
  if (result.openMode !== "read-only" || result.pointDataRead !== false) {
    throw new Error("E57 probe must prove read-only metadata access with no point-data reads");
  }
  const sourceSha256 = prefixedSha256(source.digest.sha256);
  if (review.sourceE57Sha256 !== sourceSha256) {
    throw new Error("Identity review E57 digest does not match the Capture Factory staged E57");
  }
  const pointRecordCount = scans.reduce(
    (total, scan) => total + requireSafeInteger(scan, "pointCount"),
    0,
  );
  const material = FoundryPhase1E57InspectionMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_E57_INSPECTION_V0,
    inspectionId: "grand-hall-e57-inspection",
    identityReviewSha256: review.reviewSha256,
    sourceE57Sha256: sourceSha256,
    sourceByteLength: source.digest.sizeBytes,
    probeOutputSha256: domainSeparatedDigest(`omnitwin.foundry.phase1-probe-output.${probe.mode}.v0`, probe),
    readMode: "read_only",
    pointDataRead: false,
    sourceMutationPermitted: false,
    adapter: {
      name: requireString(adapter, "name"),
      version: requireString(adapter, "version"),
    },
    coordinateConvention: { frame: "e57_global", units: "meters", upAxis: "z" },
    scanCount: requireSafeInteger(result, "scanCount"),
    image2DCount: requireSafeInteger(result, "imageCount"),
    pointRecordCount,
    reviewedSweepIndices: review.reviewedSweepIndices,
    faceDigests: review.faceDigests,
    inspectedAt,
  });
  return FoundryPhase1E57InspectionV0Schema.parse({
    ...material,
    inspectionSha256: computeFoundryPhase1E57InspectionSha256(material),
  });
}

const COLMAP_SOURCE_ROLE_BY_PATH: Readonly<Record<string, FoundryPhase1ColmapSourceFile["role"]>> = {
  "database.db": "database",
  "sparse/0/cameras.bin": "cameras_bin",
  "sparse/0/images.bin": "images_bin",
  "sparse/0/points3D.bin": "points3d_bin",
  "sparse/0/frames.bin": "frames_bin",
  "sparse/0/rigs.bin": "rigs_bin",
};

function buildColmapSourceFiles(colmap: readonly HashedInput[]): FoundryPhase1ColmapSourceFile[] {
  return colmap
    .filter((input) => input.relativePath in COLMAP_SOURCE_ROLE_BY_PATH)
    .map((input) => {
      const role = COLMAP_SOURCE_ROLE_BY_PATH[input.relativePath];
      if (role === undefined) throw new Error(`Unmapped COLMAP source role: ${input.relativePath}`);
      return {
        role,
        relativePath: input.relativePath,
        sha256: prefixedSha256(input.digest.sha256),
        byteLength: input.digest.sizeBytes,
      };
    })
    .sort((left, right) => left.role.localeCompare(right.role));
}

function imageSetMaterial(colmap: readonly HashedInput[]) {
  return colmap
    .filter((input) => input.kind === "image")
    .map((input) => ({
      relativePath: input.relativePath,
      sha256: prefixedSha256(input.digest.sha256),
      byteLength: input.digest.sizeBytes,
      scope: input.relativePath.startsWith("images/scan_049_")
        ? "reproduction_only_excluded_adjacent_space"
        : "phase1_candidate",
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function verifyProbeImageSet(
  colmap: readonly HashedInput[],
  imageFiles: Readonly<Record<string, unknown>>,
): void {
  const probeRecords = requireRecordArray(imageFiles, "records");
  const byName = new Map(probeRecords.map((record) => [requireString(record, "name"), record]));
  const images = colmap.filter((input) => input.kind === "image");
  if (byName.size !== EXPECTED_IMAGE_COUNT || images.length !== EXPECTED_IMAGE_COUNT) {
    throw new Error("COLMAP probe and TypeScript inventory must each contain exactly 300 images");
  }
  for (const input of images) {
    const name = input.relativePath.slice("images/".length);
    const record = byName.get(name);
    if (
      record === undefined ||
      requireString(record, "sha256") !== input.digest.sha256 ||
      requireSafeInteger(record, "byteSize") !== input.digest.sizeBytes
    ) {
      throw new Error(`COLMAP probe image digest disagrees with the immutable inventory: ${name}`);
    }
  }
}

function buildColmapInspection(
  review: FoundryPhase1IdentityReviewV0,
  colmap: readonly HashedInput[],
  probe: ProbeSuccess,
  inspectedAt: string,
): FoundryPhase1ColmapInspectionV0 {
  const result = probe.result;
  const database = requireRecord(result.database, "COLMAP database inspection");
  const imageFiles = requireRecord(result.imageFiles, "COLMAP image inspection");
  const sparse = requireRecord(result.sparseModel, "COLMAP sparse inspection");
  const encoding = requireRecord(sparse.binaryFormat, "COLMAP binary encoding");
  const cameras = requireRecord(sparse.cameras, "COLMAP cameras");
  const images = requireRecord(sparse.images, "COLMAP registered images");
  const points = requireRecord(sparse.points3D, "COLMAP points3D");
  verifyProbeImageSet(colmap, imageFiles);
  if (
    database.immutable !== true ||
    database.queryOnly !== true ||
    database.trustedSchema !== false ||
    requireSafeInteger(database, "walByteSize") !== 0
  ) {
    throw new Error("COLMAP database probe must be immutable, query-only, trusted-schema disabled, and observe an empty WAL");
  }
  const cameraModels = requireRecordArray(cameras, "records").map((camera) => ({
    cameraId: requireSafeInteger(camera, "cameraId"),
    modelName: requireString(camera, "modelName"),
    width: requireSafeInteger(camera, "width"),
    height: requireSafeInteger(camera, "height"),
    parameters: requireNumberArray(camera, "params"),
  }));
  const groups = requireRecordArray(sparse, "registeredSweepGroups");
  const material = FoundryPhase1ColmapInspectionMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_COLMAP_INSPECTION_V0,
    inspectionId: "grand-hall-colmap-inspection",
    identityReviewSha256: review.reviewSha256,
    sourceFiles: buildColmapSourceFiles(colmap),
    imageSetSha256: domainSeparatedDigest(
      "omnitwin.foundry.grand-hall-colmap-image-set.v0",
      imageSetMaterial(colmap),
    ),
    probeOutputSha256: domainSeparatedDigest(`omnitwin.foundry.phase1-probe-output.${probe.mode}.v0`, probe),
    readMode: "read_only",
    sourceMutationPermitted: false,
    binaryEncoding: {
      format: requireString(encoding, "format"),
      endianness: requireString(encoding, "endianness"),
    },
    poseConvention: {
      qvec: "hamilton_wxyz_world_to_camera",
      cameraCenter: "center=-R^Tt",
      sourceFrame: "colmap_world",
    },
    scanFilenamePattern: "scan_<three-decimal-digit-sweep>_<front|back|left|right|up|down>.jpg",
    scanGrouping: "strict_filename_then_unweighted_per_sweep_center_mean",
    databaseImageCount: requireRecordArray(database, "images").length,
    cameraCount: requireSafeInteger(cameras, "count"),
    registeredImageCount: requireSafeInteger(images, "count"),
    point3DCount: requireSafeInteger(points, "count"),
    cameraModels,
    registeredSweepIndices: groups.map((group) => requireSafeInteger(group, "sweepIndex")),
    inspectedAt,
  });
  return FoundryPhase1ColmapInspectionV0Schema.parse({
    ...material,
    inspectionSha256: computeFoundryPhase1ColmapInspectionSha256(material),
  });
}

function applySimilarity(matrix: readonly number[], point: readonly number[]): [number, number, number] {
  return [
    (matrix[0] ?? 0) * (point[0] ?? 0) + (matrix[4] ?? 0) * (point[1] ?? 0) +
      (matrix[8] ?? 0) * (point[2] ?? 0) + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * (point[0] ?? 0) + (matrix[5] ?? 0) * (point[1] ?? 0) +
      (matrix[9] ?? 0) * (point[2] ?? 0) + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * (point[0] ?? 0) + (matrix[6] ?? 0) * (point[1] ?? 0) +
      (matrix[10] ?? 0) * (point[2] ?? 0) + (matrix[14] ?? 0),
  ];
}

function similarityFromProbe(raw: unknown) {
  const transform = requireRecord(raw, "similarity transform");
  const matrixColumnMajor = requireNumberArray(transform, "matrixColumnMajor");
  if (matrixColumnMajor.length !== 16) throw new Error("Similarity matrix must contain 16 values");
  return {
    matrixColumnMajor,
    scale: requireNumber(transform, "scale"),
    rotationDeterminant: requireNumber(transform, "determinantRotation"),
  };
}

function correspondencesFromProbe(alignment: AlignmentResult): FoundryPhase1SweepCorrespondenceV0[] {
  return alignment.correspondences.map((raw, expectedSweep) => {
    const correspondence = requireRecord(raw, "alignment correspondence");
    const sweepIndex = requireSafeInteger(correspondence, "sweepIndex");
    if (sweepIndex !== expectedSweep) throw new Error("Alignment correspondences must be ordered sweeps 0..49");
    const centers = requireRecordArray(correspondence, "colmapFaceCenters").map((center) => ({
      imageName: requireString(center, "imageName"),
      face: requireString(center, "face"),
      centerColmapWorld: requireVec3(center, "centerColmapWorld"),
    }));
    if (requireSafeInteger(correspondence, "registeredFaceCount") !== centers.length) {
      throw new Error(`Registered face count mismatch for sweep ${String(sweepIndex)}`);
    }
    return {
      correspondenceId: `sweep-${String(sweepIndex).padStart(3, "0")}`,
      sweepIndex,
      colmapFaceCenters: centers,
      colmapCenterMean: requireVec3(correspondence, "colmapMeanCameraCenter"),
      e57GlobalCenterM: requireVec3(correspondence, "e57ScanCenter"),
    };
  }).map((correspondence) => FoundryPhase1SweepCorrespondenceV0Schema.parse(correspondence));
}

function residualEvaluation(
  sweepIndices: readonly number[],
  transform: { readonly matrixColumnMajor: readonly number[] },
  correspondences: readonly FoundryPhase1SweepCorrespondenceV0[],
): { records: FoundryPhase1CorrespondenceResidualV0[]; metrics: ReturnType<typeof computeFoundryPhase1ResidualMetrics> } {
  const bySweep = new Map(correspondences.map((correspondence) => [correspondence.sweepIndex, correspondence]));
  const records = sweepIndices.map((sweepIndex) => {
    const correspondence = bySweep.get(sweepIndex);
    if (correspondence === undefined) throw new Error(`Missing alignment correspondence for sweep ${String(sweepIndex)}`);
    const predicted = applySimilarity(transform.matrixColumnMajor, correspondence.colmapCenterMean);
    const residualVector: [number, number, number] = [
      predicted[0] - correspondence.e57GlobalCenterM[0],
      predicted[1] - correspondence.e57GlobalCenterM[1],
      predicted[2] - correspondence.e57GlobalCenterM[2],
    ];
    return {
      correspondenceId: correspondence.correspondenceId,
      sweepIndex,
      predictedE57GlobalM: predicted,
      residualVectorM: residualVector,
      residualMeters: Math.hypot(...residualVector),
    };
  });
  return { records, metrics: computeFoundryPhase1ResidualMetrics(records) };
}

function verifyProbeEvaluation(
  raw: unknown,
  evaluation: { readonly records: readonly FoundryPhase1CorrespondenceResidualV0[] },
  label: string,
): void {
  const rawEvaluation = requireRecord(raw, label);
  const rawRecords = requireRecordArray(rawEvaluation, "perSweep");
  if (rawRecords.length !== evaluation.records.length) throw new Error(`${label} record count mismatch`);
  for (const [index, record] of evaluation.records.entries()) {
    const rawRecord = rawRecords[index];
    if (
      rawRecord === undefined ||
      requireSafeInteger(rawRecord, "sweepIndex") !== record.sweepIndex ||
      Math.abs(requireNumber(rawRecord, "residualMeters") - record.residualMeters) > 1e-9
    ) {
      throw new Error(`${label} disagrees with independently recomputed residual ${String(index)}`);
    }
  }
}

function alignmentConventions(alignment: AlignmentResult) {
  const raw = requireRecord(alignment.conventions, "alignment conventions");
  const required: Readonly<Record<string, string>> = {
    colmapCameraCenter: "C=-R^T*t",
    colmapPose: "Hamilton qvec [w,x,y,z], world-to-camera",
    correspondenceAggregation: "unweighted arithmetic mean of registered face camera centres per sweep",
    e57ScanCenter: "data3D pose.translation in the E57 root frame",
    matrixLayout: "4x4 column-major; target=scale*rotation*source+translation",
    outlierRejection: "none",
    percentileMethod: "linear",
    reflectionPolicy: "forbidden; determinant(rotation) must be +1",
    similarityMethod: "isotropic Umeyama/SVD, unweighted",
  };
  for (const [key, expected] of Object.entries(required)) {
    if (raw[key] !== expected) throw new Error(`Unexpected alignment convention ${key}`);
  }
  return {
    e57Frame: "e57_global_metres_z_up" as const,
    e57Axes: "right_handed_xyz_z_up" as const,
    colmapPose: "qvec_hamilton_wxyz_world_to_camera" as const,
    colmapCameraCenter: "center=-R^Tt" as const,
    colmapCameraAxes: "right_down_forward" as const,
    colmapWorldAxes: "arbitrary_right_handed_sfm_world" as const,
    scanGrouping: "strict_scan_filename" as const,
    sweepAggregation: "unweighted_per_sweep_center_mean" as const,
    sweepWeighting: "one_equal_weight_per_sweep_not_per_image" as const,
    similarityMethod: "proper_isotropic_umeyama_det_plus_one" as const,
    reflectionPolicy: "forbidden_rotation_determinant_plus_one" as const,
    transformDirection: "colmap_world_to_e57_global" as const,
    matrixLayout: "4x4_column_major" as const,
    vectorConvention: "column_vector_target_equals_matrix_times_source" as const,
    residualUnits: "meters" as const,
    percentileMethod: "linear" as const,
    robustLoss: "none" as const,
    outlierRejection: "none" as const,
  };
}

function buildResidualReport(
  review: FoundryPhase1IdentityReviewV0,
  e57Inspection: FoundryPhase1E57InspectionV0,
  colmapInspection: FoundryPhase1ColmapInspectionV0,
  alignmentProbe: ProbeSuccess,
  generatedAt: string,
): FoundryPhase1ResidualReportV0 {
  const alignment = asAlignmentResult(alignmentProbe.result);
  const correspondences = correspondencesFromProbe(alignment);
  const fullTransform = similarityFromProbe(alignment.fullFit.transform);
  const candidateTransform = similarityFromProbe(alignment.phase1CandidateWithHoldout.transform);
  const full = residualEvaluation(
    Array.from({ length: SWEEP_COUNT }, (_, index) => index),
    fullTransform,
    correspondences,
  );
  const fitSweeps = requireIntegerArray(alignment.phase1CandidateWithHoldout, "fitSweepIndices");
  const holdoutSweeps = requireIntegerArray(alignment.phase1CandidateWithHoldout, "heldOutSweepIndices");
  const candidateSweeps = requireIntegerArray(alignment.phase1CandidateWithHoldout, "candidateSweepIndices");
  const fit = residualEvaluation(fitSweeps, candidateTransform, correspondences);
  const holdout = residualEvaluation(holdoutSweeps, candidateTransform, correspondences);
  const candidate = residualEvaluation(candidateSweeps, candidateTransform, correspondences);
  verifyProbeEvaluation(alignment.fullFit.evaluation, full, "full-fit evaluation");
  verifyProbeEvaluation(
    alignment.phase1CandidateWithHoldout.trainingEvaluation,
    fit,
    "candidate fit evaluation",
  );
  verifyProbeEvaluation(
    alignment.phase1CandidateWithHoldout.heldOutEvaluation,
    holdout,
    "candidate holdout evaluation",
  );
  verifyProbeEvaluation(
    alignment.phase1CandidateWithHoldout.pilotEvaluation,
    candidate,
    "candidate all-sweep evaluation",
  );
  const material = FoundryPhase1ResidualReportMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_RESIDUAL_REPORT_V0,
    reportId: "grand-hall-colmap-to-e57-residuals",
    identityReviewSha256: review.reviewSha256,
    e57InspectionSha256: e57Inspection.inspectionSha256,
    colmapInspectionSha256: colmapInspection.inspectionSha256,
    sourceE57Sha256: e57Inspection.sourceE57Sha256,
    colmapSourceFiles: colmapInspection.sourceFiles,
    alignmentProbeOutputSha256: domainSeparatedDigest(
      `omnitwin.foundry.phase1-probe-output.${alignmentProbe.mode}.v0`,
      alignmentProbe,
    ),
    conventions: alignmentConventions(alignment),
    limitations: {
      geometricCloudOverlap: "not_computed",
      independentSurveyedControl: "absent",
      metricClassification: "internal_self_consistency_only",
      sharedLineageRisk: "colmap_images_and_e57_centres_share_the_same_e57_export_lineage",
      imagePixelTrainEvalSplit: "none_no_image_training_or_pixel_evaluation_performed",
      identitySweepRole: "human_room_identity_review_inputs_not_alignment_evaluation_split",
      runtimeOrPublicAuthority: "none_pending_independent_control_and_human_transform_review",
    },
    correspondences,
    fullFit: {
      resultSet: "documented_full_fit_reproduction",
      fitSweepIndices: Array.from({ length: SWEEP_COUNT }, (_, index) => index),
      transform: fullTransform,
      evaluation: full,
      documentedDiagnostic: {
        scale: 1.7362602881,
        rmseMeters: 0.0106706,
        medianMeters: 0.0061596,
        p95Meters: 0.0164002,
        maxMeters: 0.0451409,
        classification: "prior_unreviewed_diagnostic",
        roundingTolerances: {
          scaleAbsolute: 5e-10,
          residualMetricAbsoluteMeters: 5e-8,
        },
        reproductionStatus: "matched_within_rounding_tolerance",
      },
    },
    phase1CandidateWithHoldout: {
      resultSet: "phase1_candidate_with_frozen_holdout",
      candidateSweepIndices: candidateSweeps,
      fitSweepIndices: fitSweeps,
      holdoutSweepIndices: holdoutSweeps,
      excludedSweeps: [{ sweepIndex: 49, disposition: "excluded_adjacent_space", use: "reproduction_only" }],
      transform: candidateTransform,
      fitEvaluation: fit,
      holdoutEvaluation: holdout,
      candidateEvaluation: candidate,
    },
    generatedAt,
  });
  return FoundryPhase1ResidualReportV0Schema.parse({
    ...material,
    reportSha256: computeFoundryPhase1ResidualReportSha256(material),
  });
}

function buildTransformProposal(
  review: FoundryPhase1IdentityReviewV0,
  manifestSha256: string,
  e57Inspection: FoundryPhase1E57InspectionV0,
  colmapInspection: FoundryPhase1ColmapInspectionV0,
  residualReport: FoundryPhase1ResidualReportV0,
  proposedAt: string,
): FoundryPhase1TransformProposalV0 {
  const candidate = residualReport.phase1CandidateWithHoldout;
  const material = FoundryPhase1TransformProposalMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_TRANSFORM_PROPOSAL_V0,
    proposalId: "grand-hall-colmap-to-e57-proposed",
    state: "proposed",
    identityReviewSha256: review.reviewSha256,
    ingestManifestSha256: manifestSha256,
    e57InspectionSha256: e57Inspection.inspectionSha256,
    colmapInspectionSha256: colmapInspection.inspectionSha256,
    residualReportSha256: residualReport.reportSha256,
    sourceE57Sha256: e57Inspection.sourceE57Sha256,
    colmapSourceFiles: colmapInspection.sourceFiles,
    sourceFrame: "COLMAP_WORLD",
    targetFrame: "E57_GLOBAL",
    units: "meters",
    alignmentMethod: "proper_isotropic_umeyama",
    conventions: residualReport.conventions,
    selectedResultSet: "phase1_candidate_with_frozen_holdout",
    fitSweepIndices: candidate.fitSweepIndices,
    holdoutSweepIndices: candidate.holdoutSweepIndices,
    excludedSweeps: candidate.excludedSweeps,
    matrix: candidate.transform.matrixColumnMajor,
    scale: candidate.transform.scale,
    residualMetrics: {
      fit: candidate.fitEvaluation.metrics,
      holdout: candidate.holdoutEvaluation.metrics,
      candidate: candidate.candidateEvaluation.metrics,
    },
    licenceGates: [
      {
        gate: "matterport_internal_processing",
        decision: "unresolved",
        evidenceSha256: null,
        note: "Only user-authorized read-only phase-one metadata inspection has occurred; commercial processing rights still require legal review.",
      },
      {
        gate: "matterport_model_training",
        decision: "blocked_out_of_scope",
        evidenceSha256: null,
        note: "Matterport-derived images are prohibited from model training pending a written legal determination.",
      },
      {
        gate: "xgrids_proprietary_payload",
        decision: "blocked_out_of_scope",
        evidenceSha256: null,
        note: "Phase one does not parse, decrypt, or otherwise inspect proprietary XGRIDS payloads.",
      },
      {
        gate: "public_release",
        decision: "blocked_out_of_scope",
        evidenceSha256: null,
        note: "The transform remains proposed with no runtime or public authority and cannot be published.",
      },
    ],
    reviewer: null,
    reviewerAttestationSha256: null,
    authority: { public: "none", runtime: "none" },
    proposedAt,
  });
  return FoundryPhase1TransformProposalV0Schema.parse({
    ...material,
    proposalSha256: computeFoundryPhase1TransformProposalSha256(material),
  });
}

async function writeAtomicOutput(
  output: string,
  artifacts: Readonly<Record<string, unknown>>,
): Promise<void> {
  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  if (comparable(await realpath(parent)) !== comparable(parent)) {
    throw new Error(`Output parent changed to a link or reparse point: ${parent}`);
  }
  const temporary = await mkdtemp(join(parent, `.${output.split(sep).at(-1) ?? "phase1"}.tmp-`));
  let promoted = false;
  try {
    const entries = Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right));
    for (const [relativePath, value] of entries) await writeSyncedJson(temporary, relativePath, value);
    await verifyOutputTree(temporary, artifacts);
    await syncDirectoryTree(temporary);
    if (await pathExists(output)) throw new Error(`Final output already exists: ${output}`);
    await rename(temporary, output);
    promoted = true;
    await verifyOutputTree(output, artifacts);
    await syncDirectory(parent);
  } finally {
    if (!promoted) await rm(temporary, { recursive: true, force: true });
  }
}

async function runFoundryPhase1WithDependencies(
  options: FoundryPhase1Options,
  dependencies: FoundryPhase1Dependencies,
): Promise<FoundryPhase1Result> {
  const review = await readIdentityReview(options.identityReviewPath, dependencies);
  const stageRoot = await canonicalDirectoryWithoutLinks(options.captureStageRoot, "Capture stage root");
  const colmapRoot = await canonicalDirectoryWithoutLinks(options.colmapRoot, "COLMAP root");
  const output = await assertSafeOutput(options.outputDirectory, [stageRoot, colmapRoot, REPOSITORY_ROOT]);
  const probeScript = resolve(BUNDLED_PROBE_SCRIPT);
  const probeMetadata = await lstat(probeScript);
  if (probeMetadata.isSymbolicLink() || !probeMetadata.isFile()) {
    throw new Error(`Phase-1 probe must be a regular non-link file: ${probeScript}`);
  }
  if (comparable(await realpath(probeScript)) !== comparable(probeScript)) {
    throw new Error(`Phase-1 probe resolves through a link or reparse point: ${probeScript}`);
  }
  const pythonExecutable = resolve(await dependencies.resolvePythonExecutable());
  if (!isAbsolute(pythonExecutable)) throw new Error("Phase-1 Python interpreter must resolve absolutely");
  const pythonMetadata = await lstat(pythonExecutable);
  if (pythonMetadata.isSymbolicLink() || !pythonMetadata.isFile()) {
    throw new Error(`Phase-1 Python interpreter must be a regular non-link file: ${pythonExecutable}`);
  }
  if (comparable(await realpath(pythonExecutable)) !== comparable(pythonExecutable)) {
    throw new Error(`Phase-1 Python interpreter resolves through a link or reparse point: ${pythonExecutable}`);
  }
  const pythonDependencyRoot = await canonicalDirectoryWithoutLinks(
    await dependencies.resolvePythonDependencyRoot(),
    "Python dependency root",
  );
  const probeDigest = await dependencies.hashFile(probeScript);
  const pythonDigest = await dependencies.hashFile(pythonExecutable);

  const e57 = await verifyCaptureStage(stageRoot, dependencies);
  const colmapPaths = await enumerateBoundedColmap(colmapRoot);
  if (colmapPaths.filter((path) => path.startsWith("images/")).length !== EXPECTED_IMAGE_COUNT) {
    throw new Error(`Bounded COLMAP set must contain exactly ${String(EXPECTED_IMAGE_COUNT)} images`);
  }
  const colmap = await hashColmapInputs(colmapRoot, colmapPaths, dependencies);
  const allInputs = [e57, ...colmap];
  const states = [
    ...snapshotStates(allInputs),
    {
      absolutePath: probeScript,
      sha256: probeDigest.sha256,
      sizeBytes: probeDigest.sizeBytes,
      modifiedAtMs: probeDigest.modifiedAtMs,
    },
    {
      absolutePath: pythonExecutable,
      sha256: pythonDigest.sha256,
      sizeBytes: pythonDigest.sizeBytes,
      modifiedAtMs: pythonDigest.modifiedAtMs,
    },
  ];

  const modelRoot = join(colmapRoot, "sparse", "0");
  const imagesRoot = join(colmapRoot, "images");
  const e57Probe = dependencies.validateProbe(
    await dependencies.invokeProbe(pythonExecutable, probeScript, pythonDependencyRoot, [
      "inspect-e57", "--e57", e57.absolutePath,
    ]),
    "inspect-e57",
  );
  const colmapProbe = dependencies.validateProbe(
    await dependencies.invokeProbe(pythonExecutable, probeScript, pythonDependencyRoot, [
      "inspect-colmap", "--model", modelRoot, "--images", imagesRoot, "--database", join(colmapRoot, DATABASE_PATH),
    ]),
    "inspect-colmap",
  );
  const alignmentProbe = dependencies.validateProbe(
    await dependencies.invokeProbe(pythonExecutable, probeScript, pythonDependencyRoot, [
      "align", "--e57", e57.absolutePath, "--model", modelRoot,
    ]),
    "align",
  );
  await assertSqliteSidecarsFrozen(colmapRoot);
  await assertStatesUnchanged(states, dependencies);

  const manifest = buildManifest(options, e57, colmap);
  const manifestSha256 = computeFoundryIngestManifestSha256(manifest);
  const e57Inspection = buildE57Inspection(review, e57, e57Probe, options.createdAt);
  const colmapInspection = buildColmapInspection(review, colmap, colmapProbe, options.createdAt);
  const residualReport = buildResidualReport(
    review,
    e57Inspection,
    colmapInspection,
    alignmentProbe,
    options.createdAt,
  );
  const transform = buildTransformProposal(
    review,
    manifestSha256,
    e57Inspection,
    colmapInspection,
    residualReport,
    options.createdAt,
  );
  const bundle = FoundryPhase1BundleV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_BUNDLE_V0,
    ingestManifestSha256: manifestSha256,
    identityReview: review,
    e57Inspection,
    colmapInspection,
    residualReport,
    transformProposal: transform,
  });
  const fullFitView = {
    schemaVersion: "omnitwin.foundry.similarity-full-fit-view.v0",
    reportSha256: residualReport.reportSha256,
    conventions: residualReport.conventions,
    correspondences: residualReport.correspondences,
    reproductionOnly: true,
    result: residualReport.fullFit,
  };
  const holdoutView = {
    schemaVersion: "omnitwin.foundry.similarity-holdout-view.v0",
    reportSha256: residualReport.reportSha256,
    conventions: residualReport.conventions,
    correspondences: residualReport.correspondences,
    excludedSweeps: residualReport.phase1CandidateWithHoldout.excludedSweeps,
    result: residualReport.phase1CandidateWithHoldout,
  };
  const artifacts: Readonly<Record<string, unknown>> = {
    [IDENTITY_REVIEW_OUTPUT]: review,
    [E57_INSPECTION_OUTPUT]: e57Inspection,
    [COLMAP_INSPECTION_OUTPUT]: colmapInspection,
    [RAW_E57_PROBE_OUTPUT]: e57Probe,
    [RAW_COLMAP_PROBE_OUTPUT]: colmapProbe,
    [RAW_ALIGNMENT_PROBE_OUTPUT]: alignmentProbe,
    [RESIDUAL_REPORT_OUTPUT]: residualReport,
    [FULL_RESIDUAL_OUTPUT]: fullFitView,
    [HOLDOUT_RESIDUAL_OUTPUT]: holdoutView,
    [TRANSFORM_OUTPUT]: transform,
    [MANIFEST_OUTPUT]: manifest,
    [BUNDLE_OUTPUT]: bundle,
  };
  const outputIndex = {
    schemaVersion: "omnitwin.foundry.phase1-output-index.v0",
    projectId: options.projectId,
    createdAt: options.createdAt,
    ingestManifestSha256: manifestSha256,
    identityDecision: review.decision,
    includedRoomSweeps: review.decision.confirmedIdentitySweepIndices,
    excludedRoomSweeps: review.decision.excludedSweeps,
    probeImplementationSha256: prefixedSha256(probeDigest.sha256),
    pythonInterpreterSha256: prefixedSha256(pythonDigest.sha256),
    probeExecutionPolicy: {
      bundledProbeOnly: true,
      isolatedPython: true,
      siteStartupDisabled: true,
      dependencyRootMode: "canonical_explicit_user_site",
      bytecodeWritesDisabled: true,
      inheritedEnvironment: false,
      timeoutMs: PROBE_TIMEOUT_MS,
    },
    files: Object.entries(artifacts)
      .map(([relativePath, value]) => ({ relativePath, sha256: artifactDigest(value) }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    permissions: {
      sourceMutation: false,
      training: false,
      paidCompute: false,
      proprietaryPayloadParsing: false,
      publication: false,
    },
    unresolvedGates: [
      "matterport_processing_and_model_training_rights",
      "independent_alignment_control",
      "transform_human_review",
      "residual_reports_human_review",
      "identity_review_external_attestation",
      "identity_reference_image_licence_metadata",
    ],
  };
  await writeAtomicOutput(output, { ...artifacts, [PACKAGE_INDEX_OUTPUT]: outputIndex });
  return {
    outputDirectory: output,
    manifestSha256,
    assetCount: manifest.assets.length,
    includedSweeps: review.decision.confirmedIdentitySweepIndices,
    excludedSweeps: review.decision.excludedSweeps.map((entry) => entry.sweepIndex),
  };
}

export async function runFoundryPhase1(
  options: FoundryPhase1Options,
): Promise<FoundryPhase1Result> {
  return await runFoundryPhase1WithDependencies(options, defaultDependencies);
}

export async function __testOnlyRunFoundryPhase1(
  options: FoundryPhase1Options,
  dependencies: FoundryPhase1Dependencies,
): Promise<FoundryPhase1Result> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Foundry phase-1 dependency injection is available only in the test environment");
  }
  return await runFoundryPhase1WithDependencies(options, dependencies);
}

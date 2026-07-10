import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  CAPTURE_STAGE_SCHEMA_VERSION,
  CaptureStageManifestSchema,
  type CaptureCopyPlanEntry,
  type CaptureStageManifest,
} from "@omnitwin/types";
import { sha256File, sha256Text } from "./hash.js";
import { inspectCapture } from "./inventory.js";
import {
  assertDisjointDestination,
  assertRegularNonLink,
  canonicalSourceRoot,
  resolveContainedPath,
} from "./path-safety.js";

const MANIFEST_NAME = "capture-stage-manifest.json";
const INSPECTION_NAME = "capture-intake-inspection.json";
const RENAME_ATTEMPTS = 8;

export interface StageCaptureResult {
  readonly manifest: CaptureStageManifest;
  readonly copied: number;
  readonly resumed: number;
  readonly skipped: number;
}

type CopyOutcome = "copied" | "resumed" | "skipped";

function errorCode(error: unknown): unknown {
  if (error !== null && typeof error === "object" && "code" in error) return error.code;
  return undefined;
}

async function existsAsRegularFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Expected a regular staging file: ${path}`);
    }
    return true;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function flushFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function matches(entry: CaptureCopyPlanEntry, digest: { sha256: string; sizeBytes: number }): boolean {
  return digest.sha256 === entry.sha256 && digest.sizeBytes === entry.sizeBytes;
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error: unknown) {
      const retryable = ["EPERM", "EBUSY", "EACCES"].includes(String(errorCode(error)));
      if (!retryable || attempt === RENAME_ATTEMPTS - 1) throw error;
      await new Promise<void>((done) => setTimeout(done, 25 * 2 ** attempt));
    }
  }
}

async function ensureSafeParent(stagingRoot: string, target: string): Promise<void> {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const canonicalParent = await realpath(parent);
  if (resolve(canonicalParent, basename(target)) !== target) {
    throw new Error(`Staging path resolves through a symbolic link: ${target}`);
  }
  resolveContainedPath(stagingRoot, target.slice(stagingRoot.length + 1).replaceAll("\\", "/"));
}

async function promoteVerifiedPartial(
  partial: string,
  target: string,
  entry: CaptureCopyPlanEntry,
): Promise<void> {
  if (await existsAsRegularFile(target)) {
    throw new Error(`Refusing to replace an existing staging target: ${target}`);
  }
  await flushFile(partial);
  const digest = await sha256File(partial);
  if (!matches(entry, digest)) {
    throw new Error(`Partial copy failed SHA-256 verification: ${partial}`);
  }
  await renameWithRetry(partial, target);
  const promoted = await lstat(target);
  // A same-directory rename preserves the already-hashed file object. Re-read
  // metadata here; a second full digest would add hours to large captures
  // without strengthening the atomic promotion guarantee.
  if (promoted.isSymbolicLink() || !promoted.isFile() || promoted.size !== entry.sizeBytes) {
    throw new Error(`Promoted staging file failed verification: ${target}`);
  }
}

async function stageEntry(
  sourceRoot: string,
  stagingRoot: string,
  entry: CaptureCopyPlanEntry,
): Promise<CopyOutcome> {
  const source = resolveContainedPath(sourceRoot, entry.sourceRelativePath);
  const target = resolveContainedPath(stagingRoot, entry.targetRelativePath);
  await assertRegularNonLink(source);
  await ensureSafeParent(stagingRoot, target);

  if (await existsAsRegularFile(target)) {
    const existing = await sha256File(target);
    if (matches(entry, existing)) return "skipped";
    throw new Error(`Existing staging target conflicts with copy plan: ${target}`);
  }

  const partial = `${target}.partial-${entry.sha256.slice(0, 16)}`;
  if (await existsAsRegularFile(partial)) {
    const partialDigest = await sha256File(partial);
    if (matches(entry, partialDigest)) {
      await promoteVerifiedPartial(partial, target, entry);
      return "resumed";
    }
    await rm(partial, { force: true });
  }

  await copyFile(source, partial, constants.COPYFILE_EXCL);
  await promoteVerifiedPartial(partial, target, entry);
  return "copied";
}

export async function writeImmutableJson(path: string, value: unknown): Promise<void> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  if (await existsAsRegularFile(path)) {
    if ((await readFile(path, "utf8")) === content) return;
    throw new Error(`Refusing to replace a different immutable report: ${path}`);
  }
  const digest = sha256Text(content);
  const partial = `${path}.partial-${digest.slice(0, 16)}`;
  if (await existsAsRegularFile(partial)) {
    if ((await readFile(partial, "utf8")) === content) {
      await renameWithRetry(partial, path);
      return;
    }
    await rm(partial, { force: true });
  }
  await writeFile(partial, content, { encoding: "utf8", flag: "wx" });
  await flushFile(partial);
  if ((await readFile(partial, "utf8")) !== content) {
    throw new Error(`Immutable report verification failed: ${partial}`);
  }
  await renameWithRetry(partial, path);
}

export async function stageCapture(
  sourceRootInput: string,
  stagingRootInput: string,
): Promise<StageCaptureResult> {
  const sourceRoot = await canonicalSourceRoot(sourceRootInput);
  const resolvedStaging = await assertDisjointDestination(sourceRoot, stagingRootInput);
  const inspection = await inspectCapture(sourceRoot);
  await mkdir(resolvedStaging, { recursive: true });
  const stagingRoot = await realpath(resolvedStaging);
  await assertDisjointDestination(sourceRoot, stagingRoot);
  await writeImmutableJson(resolveContainedPath(stagingRoot, INSPECTION_NAME), inspection);

  const outcomes: CopyOutcome[] = [];
  for (const entry of inspection.copyPlan) {
    outcomes.push(await stageEntry(sourceRoot, stagingRoot, entry));
  }
  const manifest = CaptureStageManifestSchema.parse({
    schemaVersion: CAPTURE_STAGE_SCHEMA_VERSION,
    sourceRoot,
    planSha256: inspection.planSha256,
    fileCount: inspection.copyPlan.length,
    totalBytes: inspection.copyPlan.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    files: inspection.copyPlan,
  });
  await writeImmutableJson(resolveContainedPath(stagingRoot, MANIFEST_NAME), manifest);
  return {
    manifest,
    copied: outcomes.filter((outcome) => outcome === "copied").length,
    resumed: outcomes.filter((outcome) => outcome === "resumed").length,
    skipped: outcomes.filter((outcome) => outcome === "skipped").length,
  };
}

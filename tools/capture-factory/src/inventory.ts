import { extname } from "node:path";
import { lstat, readdir } from "node:fs/promises";
import {
  CAPTURE_INTAKE_SCHEMA_VERSION,
  CaptureIntakeInspectionSchema,
  type CaptureCopyPlanEntry,
  type CaptureDuplicateGroup,
  type CaptureIntakeInspection,
  type CaptureInventoryFile,
} from "@omnitwin/types";
import { classifyCaptureFile, targetRelativePathFor } from "./classify.js";
import { sha256File, sha256Text } from "./hash.js";
import {
  canonicalSourceRoot,
  childPath,
  toCanonicalRelativePath,
} from "./path-safety.js";
import { inspectFileSignature } from "./signature.js";

interface WalkState {
  readonly root: string;
  readonly hashAll: boolean;
  directoryCount: number;
  readonly files: CaptureInventoryFile[];
}

export interface InspectCaptureOptions {
  readonly hashAll?: boolean;
}

function stableSort<T>(values: T[], key: (value: T) => string): T[] {
  return values.sort((left, right) => {
    const a = key(left);
    const b = key(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function sameMetadata(
  first: { readonly size: number; readonly mtimeMs: number },
  second: { readonly size: number; readonly mtimeMs: number },
): boolean {
  return first.size === second.size && first.mtimeMs === second.mtimeMs;
}

async function inventoryFile(
  state: WalkState,
  absolutePath: string,
  relativePath: string,
): Promise<void> {
  const before = await lstat(absolutePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`Capture inventory accepts regular files only: ${absolutePath}`);
  }
  const signature = await inspectFileSignature(absolutePath, before.size);
  const classification = classifyCaptureFile(relativePath, signature);
  const shouldHash = state.hashAll || classification.disposition === "stage";
  const digest = shouldHash ? await sha256File(absolutePath) : null;
  const after = await lstat(absolutePath);
  if (!sameMetadata(before, after)) {
    throw new Error(`Capture source changed while inventorying: ${absolutePath}`);
  }
  if (digest !== null && (digest.sizeBytes !== after.size || digest.modifiedAtMs !== after.mtimeMs)) {
    throw new Error(`Capture source metadata changed while hashing: ${absolutePath}`);
  }
  state.files.push({
    relativePath,
    sizeBytes: after.size,
    modifiedAtUtc: after.mtime.toISOString(),
    extension: extname(relativePath).toLowerCase(),
    signature,
    sha256: digest?.sha256 ?? null,
    classification,
  });
}

async function walkDirectory(state: WalkState, parts: readonly string[]): Promise<void> {
  const absoluteDirectory = childPath(state.root, parts);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  stableSort(entries, (entry) => entry.name);
  for (const entry of entries) {
    const childParts = [...parts, entry.name];
    const absolutePath = childPath(state.root, childParts);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not accepted as capture evidence: ${absolutePath}`);
    }
    if (entry.isDirectory()) {
      state.directoryCount += 1;
      await walkDirectory(state, childParts);
    } else if (entry.isFile()) {
      await inventoryFile(state, absolutePath, toCanonicalRelativePath(childParts));
    } else {
      throw new Error(`Unsupported filesystem entry in capture source: ${absolutePath}`);
    }
  }
}

function buildCopyPlan(files: readonly CaptureInventoryFile[]): CaptureCopyPlanEntry[] {
  return files
    .filter((file) => file.classification.disposition === "stage")
    .map((file) => {
      if (file.sha256 === null) throw new Error(`Staged file has no digest: ${file.relativePath}`);
      if (file.classification.role !== "primary_capture" && file.classification.role !== "vendor_control") {
        throw new Error(`Unsafe staged role: ${file.classification.role}`);
      }
      return {
        sourceRelativePath: file.relativePath,
        targetRelativePath: targetRelativePathFor(file),
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        role: file.classification.role,
      };
    });
}

function findDuplicates(files: readonly CaptureInventoryFile[]): CaptureDuplicateGroup[] {
  const byDigest = new Map<string, string[]>();
  for (const file of files) {
    if (file.sha256 === null) continue;
    const paths = byDigest.get(file.sha256) ?? [];
    paths.push(file.relativePath);
    byDigest.set(file.sha256, paths);
  }
  const groups = [...byDigest.entries()]
    .filter((entry) => entry[1].length > 1)
    .map(([sha256, relativePaths]) => ({ sha256, relativePaths: relativePaths.sort() }));
  return stableSort(groups, (group) => group.sha256);
}

export async function inspectCapture(
  sourceRootInput: string,
  options: InspectCaptureOptions = {},
): Promise<CaptureIntakeInspection> {
  const sourceRoot = await canonicalSourceRoot(sourceRootInput);
  const state: WalkState = {
    root: sourceRoot,
    hashAll: options.hashAll ?? false,
    directoryCount: 0,
    files: [],
  };
  await walkDirectory(state, []);
  stableSort(state.files, (file) => file.relativePath);
  const copyPlan = buildCopyPlan(state.files);
  const planSha256 = sha256Text(JSON.stringify(copyPlan));
  return CaptureIntakeInspectionSchema.parse({
    schemaVersion: CAPTURE_INTAKE_SCHEMA_VERSION,
    sourceRoot,
    directoryCount: state.directoryCount,
    fileCount: state.files.length,
    totalBytes: state.files.reduce((sum, file) => sum + file.sizeBytes, 0),
    hashedFileCount: state.files.filter((file) => file.sha256 !== null).length,
    files: state.files,
    copyPlan,
    duplicateGroups: findDuplicates(state.files),
    planSha256,
  });
}

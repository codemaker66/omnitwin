import type { Stats } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  sha256RegularFileWithHead,
  verifyLocalE57RuntimeBundleReceipt,
  type ExpectedRegularFileIdentity,
  type LocalE57RuntimeBundleReceipt,
} from "@omnitwin/reconstruction-foundry";

export type LocalE57RuntimeBundleVerificationErrorCode =
  | "LOCAL_E57_RUNTIME_BUNDLE_CANCELLED"
  | "LOCAL_E57_RUNTIME_BUNDLE_DIGEST_OR_SCHEMA_INVALID"
  | "LOCAL_E57_RUNTIME_BUNDLE_EXTRA_ENTRY"
  | "LOCAL_E57_RUNTIME_BUNDLE_FILE_IDENTITY_INVALID"
  | "LOCAL_E57_RUNTIME_BUNDLE_FILE_RECEIPT_MISMATCH"
  | "LOCAL_E57_RUNTIME_BUNDLE_MISSING_ENTRY"
  | "LOCAL_E57_RUNTIME_BUNDLE_ROOT_INVALID"
  | "LOCAL_E57_RUNTIME_BUNDLE_TREE_MUTATED";

export class LocalE57RuntimeBundleVerificationError extends Error {
  readonly code: LocalE57RuntimeBundleVerificationErrorCode;

  constructor(code: LocalE57RuntimeBundleVerificationErrorCode, message: string) {
    super(message);
    this.name = "LocalE57RuntimeBundleVerificationError";
    this.code = code;
  }
}

export interface LocalE57RuntimeBundleFileSnapshot {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly identity: ExpectedRegularFileIdentity;
}

export interface LocalE57RuntimeBundleSnapshot {
  readonly bundleReceiptSha256: string;
  readonly fileCount: number;
  readonly files: readonly LocalE57RuntimeBundleFileSnapshot[];
  readonly rootPath: string;
  readonly totalFileBytes: number;
}

export interface LocalE57RuntimeBundleResolvedPaths {
  readonly dependencyRootPath: string;
  readonly interpreterPath: string;
  readonly legalRootPath: string;
  readonly probeScriptPath: string;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameIdentity(
  left: ExpectedRegularFileIdentity,
  right: ExpectedRegularFileIdentity,
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function statIdentity(stats: Stats): ExpectedRegularFileIdentity {
  return {
    ctimeMs: stats.ctimeMs,
    dev: stats.dev,
    ino: stats.ino,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new LocalE57RuntimeBundleVerificationError(
      "LOCAL_E57_RUNTIME_BUNDLE_CANCELLED",
      "The complete local E57 runtime-bundle verification was cancelled.",
    );
  }
}

function containedBy(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot);
}

async function canonicalRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new LocalE57RuntimeBundleVerificationError(
      "LOCAL_E57_RUNTIME_BUNDLE_ROOT_INVALID",
      "The local E57 runtime bundle root must be an absolute path.",
    );
  }
  const absolute = resolve(path);
  try {
    const before = await lstat(absolute);
    const canonical = await realpath(absolute);
    const after = await lstat(canonical);
    if (
      before.isSymbolicLink() ||
      !before.isDirectory() ||
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      pathKey(canonical) !== pathKey(absolute)
    ) {
      throw new Error("root is linked, aliased, or not a directory");
    }
    return canonical;
  } catch (error: unknown) {
    if (error instanceof LocalE57RuntimeBundleVerificationError) throw error;
    throw new LocalE57RuntimeBundleVerificationError(
      "LOCAL_E57_RUNTIME_BUNDLE_ROOT_INVALID",
      "The local E57 runtime bundle root is missing, linked, aliased, or not a regular directory.",
    );
  }
}

function expectedDirectoryPaths(receipt: LocalE57RuntimeBundleReceipt): ReadonlySet<string> {
  const directories = new Set<string>();
  for (const file of receipt.files) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  return directories;
}

async function snapshotRegularFile(
  absolutePath: string,
  relativePath: string,
  signal: AbortSignal | undefined,
): Promise<LocalE57RuntimeBundleFileSnapshot> {
  assertNotCancelled(signal);
  try {
    const before = await lstat(absolutePath);
    const canonical = await realpath(absolutePath);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1 ||
      pathKey(canonical) !== pathKey(absolutePath)
    ) {
      throw new Error("file is linked, aliased, or not regular");
    }
    const beforeIdentity = statIdentity(before);
    const digest = await sha256RegularFileWithHead(
      absolutePath,
      0,
      beforeIdentity,
      signal,
    );
    const after = await lstat(absolutePath);
    const afterIdentity = statIdentity(after);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.nlink !== 1 ||
      !sameIdentity(beforeIdentity, afterIdentity)
    ) {
      throw new Error("file identity changed while hashing");
    }
    return {
      identity: afterIdentity,
      path: relativePath,
      sha256: digest.sha256,
      sizeBytes: digest.sizeBytes,
    };
  } catch {
    if (signal?.aborted === true) assertNotCancelled(signal);
    throw new LocalE57RuntimeBundleVerificationError(
      "LOCAL_E57_RUNTIME_BUNDLE_FILE_IDENTITY_INVALID",
      `Runtime-bundle member is missing, linked, hard-linked, aliased, non-regular, or unstable: ${relativePath}`,
    );
  }
}

async function walkBundle(
  root: string,
  receipt: LocalE57RuntimeBundleReceipt,
  signal: AbortSignal | undefined,
): Promise<readonly LocalE57RuntimeBundleFileSnapshot[]> {
  const expectedFiles = new Set(receipt.files.map((file) => file.path));
  const expectedDirectories = expectedDirectoryPaths(receipt);
  const snapshots: LocalE57RuntimeBundleFileSnapshot[] = [];

  async function walk(relativeDirectory: string): Promise<void> {
    assertNotCancelled(signal);
    const absoluteDirectory = relativeDirectory === ""
      ? root
      : join(root, ...relativeDirectory.split("/"));
    const canonical = await realpath(absoluteDirectory);
    if (pathKey(canonical) !== pathKey(absoluteDirectory) || !containedBy(root, canonical)) {
      throw new LocalE57RuntimeBundleVerificationError(
        "LOCAL_E57_RUNTIME_BUNDLE_FILE_IDENTITY_INVALID",
        `Runtime-bundle directory is linked or aliased: ${relativeDirectory || "."}`,
      );
    }
    const entries = (await readdir(absoluteDirectory, { withFileTypes: true }))
      .sort((left, right) => compareOrdinal(left.name, right.name));
    for (const entry of entries) {
      assertNotCancelled(signal);
      const relativePath = relativeDirectory === ""
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new LocalE57RuntimeBundleVerificationError(
          "LOCAL_E57_RUNTIME_BUNDLE_FILE_IDENTITY_INVALID",
          `Runtime-bundle entry is a symbolic link or junction: ${relativePath}`,
        );
      }
      if (entry.isDirectory()) {
        if (!expectedDirectories.has(relativePath)) {
          throw new LocalE57RuntimeBundleVerificationError(
            "LOCAL_E57_RUNTIME_BUNDLE_EXTRA_ENTRY",
            `Runtime-bundle directory is outside the complete receipt tree: ${relativePath}`,
          );
        }
        await walk(relativePath);
        continue;
      }
      if (!entry.isFile() || !expectedFiles.has(relativePath)) {
        throw new LocalE57RuntimeBundleVerificationError(
          "LOCAL_E57_RUNTIME_BUNDLE_EXTRA_ENTRY",
          `Runtime-bundle entry is not a receipt-listed regular file: ${relativePath}`,
        );
      }
      snapshots.push(await snapshotRegularFile(
        join(absoluteDirectory, entry.name),
        relativePath,
        signal,
      ));
    }
  }

  await walk("");
  return snapshots.sort((left, right) => compareOrdinal(left.path, right.path));
}

export async function verifyLocalE57RuntimeBundleOnDisk(input: {
  readonly receipt: unknown;
  readonly rootPath: string;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly receipt: LocalE57RuntimeBundleReceipt;
  readonly resolvedPaths: LocalE57RuntimeBundleResolvedPaths;
  readonly snapshot: LocalE57RuntimeBundleSnapshot;
}> {
  assertNotCancelled(input.signal);
  let receipt: LocalE57RuntimeBundleReceipt;
  try {
    receipt = verifyLocalE57RuntimeBundleReceipt(input.receipt);
  } catch {
    throw new LocalE57RuntimeBundleVerificationError(
      "LOCAL_E57_RUNTIME_BUNDLE_DIGEST_OR_SCHEMA_INVALID",
      "The local E57 runtime-bundle receipt is invalid or has a mismatched digest.",
    );
  }
  const rootPath = await canonicalRoot(input.rootPath);
  const files = await walkBundle(rootPath, receipt, input.signal);
  if (files.length !== receipt.files.length) {
    throw new LocalE57RuntimeBundleVerificationError(
      "LOCAL_E57_RUNTIME_BUNDLE_MISSING_ENTRY",
      "The local E57 runtime bundle does not contain every receipt-listed file.",
    );
  }
  for (let index = 0; index < receipt.files.length; index += 1) {
    const expected = receipt.files[index];
    const actual = files[index];
    if (
      expected === undefined ||
      actual === undefined ||
      expected.path !== actual.path ||
      expected.sizeBytes !== actual.sizeBytes ||
      expected.sha256 !== actual.sha256
    ) {
      throw new LocalE57RuntimeBundleVerificationError(
        "LOCAL_E57_RUNTIME_BUNDLE_FILE_RECEIPT_MISMATCH",
        `The complete runtime tree differs from its receipt at ${expected?.path ?? actual?.path ?? "unknown member"}.`,
      );
    }
  }
  const totalFileBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (totalFileBytes !== receipt.totalFileBytes) {
    throw new LocalE57RuntimeBundleVerificationError(
      "LOCAL_E57_RUNTIME_BUNDLE_FILE_RECEIPT_MISMATCH",
      "The complete runtime tree byte total differs from its receipt.",
    );
  }
  const resolveMember = (path: string): string => {
    const absolute = resolve(rootPath, ...path.split("/"));
    if (!containedBy(rootPath, absolute)) {
      throw new LocalE57RuntimeBundleVerificationError(
        "LOCAL_E57_RUNTIME_BUNDLE_FILE_RECEIPT_MISMATCH",
        "A runtime layout path escapes the verified bundle root.",
      );
    }
    return absolute;
  };
  return {
    receipt,
    resolvedPaths: {
      dependencyRootPath: resolveMember(receipt.layout.dependencyRootPath),
      interpreterPath: resolveMember(receipt.layout.interpreterPath),
      legalRootPath: resolveMember(receipt.layout.legalRootPath),
      probeScriptPath: resolveMember(receipt.layout.probeScriptPath),
    },
    snapshot: {
      bundleReceiptSha256: receipt.bundleReceiptSha256,
      fileCount: files.length,
      files,
      rootPath,
      totalFileBytes,
    },
  };
}

export function assertLocalE57RuntimeBundleUnchanged(
  before: LocalE57RuntimeBundleSnapshot,
  after: LocalE57RuntimeBundleSnapshot,
): void {
  if (
    before.bundleReceiptSha256 !== after.bundleReceiptSha256 ||
    before.fileCount !== after.fileCount ||
    before.totalFileBytes !== after.totalFileBytes ||
    pathKey(before.rootPath) !== pathKey(after.rootPath) ||
    before.files.length !== after.files.length
  ) {
    throw new LocalE57RuntimeBundleVerificationError(
      "LOCAL_E57_RUNTIME_BUNDLE_TREE_MUTATED",
      "The verified local E57 runtime bundle changed while the adapter was running.",
    );
  }
  for (let index = 0; index < before.files.length; index += 1) {
    const earlier = before.files[index];
    const later = after.files[index];
    if (
      earlier === undefined ||
      later === undefined ||
      earlier.path !== later.path ||
      earlier.sha256 !== later.sha256 ||
      earlier.sizeBytes !== later.sizeBytes ||
      !sameIdentity(earlier.identity, later.identity)
    ) {
      throw new LocalE57RuntimeBundleVerificationError(
        "LOCAL_E57_RUNTIME_BUNDLE_TREE_MUTATED",
        `The verified local E57 runtime bundle changed during execution at ${earlier?.path ?? later?.path ?? "unknown member"}.`,
      );
    }
  }
}

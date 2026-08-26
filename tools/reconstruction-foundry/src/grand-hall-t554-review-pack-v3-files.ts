import type { BigIntStats } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  GrandHallT554ReviewPackV3Error,
  grandHallT554V3FileSha256,
  type GrandHallT554V3Sha256,
} from "./grand-hall-t554-review-pack-v3-contract.js";

export interface GrandHallT554V3StableFile {
  readonly absolutePath: string;
  readonly bytes: Buffer;
  readonly sha256: GrandHallT554V3Sha256;
  readonly stats: BigIntStats;
}

export interface GrandHallT554V3DirectoryEntrySnapshot {
  readonly name: string;
  readonly stats: BigIntStats;
}

export interface GrandHallT554V3DirectorySnapshot {
  readonly stats: BigIntStats;
  readonly entries: readonly GrandHallT554V3DirectoryEntrySnapshot[];
}

export interface GrandHallT554V3SnapshotRead {
  readonly initial: GrandHallT554V3DirectorySnapshot;
  readonly final: GrandHallT554V3DirectorySnapshot;
  readonly files: ReadonlyMap<string, GrandHallT554V3StableFile>;
}

export interface GrandHallT554V3SnapshotReadTestSeam {
  readonly afterInitialSnapshot?: () => Promise<void> | void;
  readonly afterFileReads?: () => Promise<void> | void;
}

export interface GrandHallT554V3CanonicalNodeInput {
  readonly path: string;
  readonly label: string;
  readonly kind: "file" | "directory";
}

export interface GrandHallT554V3OutputSafety {
  readonly outputDirectory: string;
  readonly outputParent: string;
  readonly parentStats: BigIntStats;
  readonly outputStats?: BigIntStats;
}

function lexicalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function grandHallT554V3ComparablePath(path: string): string {
  const resolved = resolve(path);
  if (process.platform !== "win32") return resolved;
  return resolved.replaceAll("/", "\\").toLowerCase();
}

export function grandHallT554V3SameFileState(
  left: BigIntStats,
  right: BigIntStats,
): boolean {
  return left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.nlink === right.nlink &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

export function grandHallT554V3SameNode(
  left: BigIntStats,
  right: BigIntStats,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function requireAbsolute(path: string, label: string): string {
  if (typeof path !== "string" || path.length === 0 || !isAbsolute(path)) {
    throw new GrandHallT554ReviewPackV3Error(
      "ARGUMENT_INVALID",
      `${label} must be an absolute local path.`,
    );
  }
  return resolve(path);
}

function directNodeError(label: string): Error {
  return new Error(`${label} must be one stable direct non-link filesystem node.`);
}

async function canonicalDirectNode(
  input: GrandHallT554V3CanonicalNodeInput,
): Promise<{ readonly path: string; readonly stats: BigIntStats }> {
  const path = requireAbsolute(input.path, input.label);
  const before = await lstat(path, { bigint: true });
  const canonical = await realpath(path);
  const after = await lstat(path, { bigint: true });
  const expectedKind = input.kind === "file" ? before.isFile() : before.isDirectory();
  if (!expectedKind || before.isSymbolicLink() ||
    grandHallT554V3ComparablePath(canonical) !== grandHallT554V3ComparablePath(path) ||
    !grandHallT554V3SameFileState(before, after)) throw directNodeError(input.label);
  if (input.kind === "file" && before.nlink !== 1n) throw directNodeError(input.label);
  return { path, stats: after };
}

function isPathWithin(parent: string, candidate: string): boolean {
  const fromParent = relative(
    grandHallT554V3ComparablePath(parent),
    grandHallT554V3ComparablePath(candidate),
  );
  return fromParent === "" ||
    (!isAbsolute(fromParent) && fromParent !== ".." && !fromParent.startsWith(`..${sep}`));
}

function assertDisjointPaths(output: string, sources: readonly string[]): void {
  for (const source of sources) {
    if (isPathWithin(source, output) || isPathWithin(output, source)) {
      throw new GrandHallT554ReviewPackV3Error(
        "OUTPUT_UNSAFE",
        "T-554 v3 output must be canonically disjoint from every source node.",
      );
    }
  }
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error &&
      typeof error.code === "string"
    ? error.code
    : undefined;
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return;
    throw error;
  }
  throw new GrandHallT554ReviewPackV3Error(
    "OUTPUT_UNSAFE",
    "T-554 v3 output directory must not already exist.",
  );
}

async function sourceCanonicalPaths(
  inputs: readonly GrandHallT554V3CanonicalNodeInput[],
): Promise<readonly string[]> {
  try {
    const nodes = await Promise.all(inputs.map(canonicalDirectNode));
    return nodes.map((node) => node.path);
  } catch (error) {
    if (error instanceof GrandHallT554ReviewPackV3Error) throw error;
    throw new GrandHallT554ReviewPackV3Error(
      "SOURCE_INVALID",
      "A T-554 v3 source path is not one stable direct node.",
      error,
    );
  }
}

async function outputParentSafety(output: string): Promise<GrandHallT554V3OutputSafety> {
  try {
    const parent = await canonicalDirectNode({
      path: dirname(output),
      label: "T-554 v3 output parent",
      kind: "directory",
    });
    const canonicalOutput = resolve(parent.path, basename(output));
    if (grandHallT554V3ComparablePath(canonicalOutput) !==
      grandHallT554V3ComparablePath(output)) throw directNodeError("T-554 v3 output parent");
    return { outputDirectory: canonicalOutput, outputParent: parent.path, parentStats: parent.stats };
  } catch (error) {
    if (error instanceof GrandHallT554ReviewPackV3Error) throw error;
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_UNSAFE",
      "T-554 v3 output parent is not one stable direct directory.",
      error,
    );
  }
}

export async function assertGrandHallT554V3NewOutputSafety(
  outputPath: string,
  sourceInputs: readonly GrandHallT554V3CanonicalNodeInput[],
): Promise<GrandHallT554V3OutputSafety> {
  const output = requireAbsolute(outputPath, "T-554 v3 output directory");
  const safety = await outputParentSafety(output);
  await assertAbsent(safety.outputDirectory);
  assertDisjointPaths(safety.outputDirectory, await sourceCanonicalPaths(sourceInputs));
  return safety;
}

export async function assertGrandHallT554V3ExistingOutputSafety(
  outputPath: string,
  sourceInputs: readonly GrandHallT554V3CanonicalNodeInput[],
): Promise<GrandHallT554V3OutputSafety> {
  const output = requireAbsolute(outputPath, "T-554 v3 output directory");
  const safety = await outputParentSafety(output);
  try {
    const node = await canonicalDirectNode({
      path: safety.outputDirectory,
      label: "T-554 v3 output directory",
      kind: "directory",
    });
    assertDisjointPaths(node.path, await sourceCanonicalPaths(sourceInputs));
    return { ...safety, outputDirectory: node.path, outputStats: node.stats };
  } catch (error) {
    if (error instanceof GrandHallT554ReviewPackV3Error) throw error;
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_UNSAFE",
      "T-554 v3 output is not one stable direct directory.",
      error,
    );
  }
}

async function readHandleExactly(handle: FileHandle, size: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead < 1) throw new Error("File ended during its bounded read.");
    offset += result.bytesRead;
  }
  return bytes;
}

function assertDirectFileStats(
  path: string,
  canonical: string,
  stats: BigIntStats,
  maximumBytes: number,
  label: string,
): void {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n ||
    stats.size < 1n || stats.size > BigInt(maximumBytes) ||
    grandHallT554V3ComparablePath(canonical) !== grandHallT554V3ComparablePath(path)) {
    throw new Error(`${label} must be one bounded direct single-link regular file.`);
  }
}

function assertStableReadStates(
  states: readonly BigIntStats[],
  label: string,
): void {
  const first = states[0];
  if (first === undefined || states.some((state) => !grandHallT554V3SameFileState(first, state))) {
    throw new Error(`${label} identity changed during its descriptor-bound read.`);
  }
}

async function readOpenedStableFile(
  handle: FileHandle,
  path: string,
  pathBefore: BigIntStats,
  canonicalBefore: string,
  maximumBytes: number,
  label: string,
): Promise<{ readonly bytes: Buffer; readonly stats: BigIntStats }> {
  const descriptorBefore = await handle.stat({ bigint: true });
  assertDirectFileStats(path, canonicalBefore, descriptorBefore, maximumBytes, label);
  assertStableReadStates([pathBefore, descriptorBefore], label);
  const bytes = await readHandleExactly(handle, Number(descriptorBefore.size));
  const descriptorAfter = await handle.stat({ bigint: true });
  const pathAfter = await lstat(path, { bigint: true });
  const canonicalAfter = await realpath(path);
  assertDirectFileStats(path, canonicalAfter, descriptorAfter, maximumBytes, label);
  assertDirectFileStats(path, canonicalAfter, pathAfter, maximumBytes, label);
  assertStableReadStates([pathBefore, descriptorBefore, descriptorAfter, pathAfter], label);
  return { bytes, stats: pathAfter };
}

export async function readGrandHallT554V3StableDirectFile(
  inputPath: string,
  maximumBytes: number,
  label: string,
  code: "SOURCE_INVALID" | "OUTPUT_VERIFICATION_FAILED",
): Promise<GrandHallT554V3StableFile> {
  const path = requireAbsolute(inputPath, label);
  let handle: FileHandle | undefined;
  try {
    const pathBefore = await lstat(path, { bigint: true });
    const canonicalBefore = await realpath(path);
    assertDirectFileStats(path, canonicalBefore, pathBefore, maximumBytes, label);
    handle = await open(path, "r");
    const stable = await readOpenedStableFile(
      handle, path, pathBefore, canonicalBefore, maximumBytes, label,
    );
    return { absolutePath: path, bytes: stable.bytes,
      sha256: grandHallT554V3FileSha256(stable.bytes), stats: stable.stats };
  } catch (error) {
    if (error instanceof GrandHallT554ReviewPackV3Error) throw error;
    throw new GrandHallT554ReviewPackV3Error(code, `${label} could not be read safely.`, error);
  } finally {
    await handle?.close();
  }
}

function assertSnapshotEntry(
  directory: string,
  name: string,
  stats: BigIntStats,
  canonical: string,
): void {
  const path = resolve(directory, name);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n ||
    grandHallT554V3ComparablePath(canonical) !== grandHallT554V3ComparablePath(path)) {
    throw new Error("V3 output inventory contains a non-direct or multiply linked file.");
  }
}

export async function snapshotGrandHallT554V3DirectDirectory(
  directory: string,
): Promise<GrandHallT554V3DirectorySnapshot> {
  try {
    const node = await canonicalDirectNode({ path: directory,
      label: "T-554 v3 output directory", kind: "directory" });
    const dirents = await readdir(node.path, { withFileTypes: true });
    const entries = await Promise.all(dirents.map(async (dirent) => {
      if (!dirent.isFile() || dirent.isSymbolicLink()) throw new Error("Non-file output entry.");
      const path = resolve(node.path, dirent.name);
      const stats = await lstat(path, { bigint: true });
      assertSnapshotEntry(node.path, dirent.name, stats, await realpath(path));
      return { name: dirent.name, stats };
    }));
    const final = await canonicalDirectNode({ path: node.path,
      label: "T-554 v3 output directory", kind: "directory" });
    if (!grandHallT554V3SameFileState(node.stats, final.stats)) {
      throw new Error("V3 output directory changed during its inventory snapshot.");
    }
    return { stats: final.stats, entries: entries.sort((a, b) => lexicalOrder(a.name, b.name)) };
  } catch (error) {
    if (error instanceof GrandHallT554ReviewPackV3Error) throw error;
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED", "T-554 v3 output inventory is unsafe.", error,
    );
  }
}

function assertExpectedNames(
  snapshot: GrandHallT554V3DirectorySnapshot,
  expectedNames: readonly string[],
): void {
  const expected = expectedNames.slice().sort(lexicalOrder);
  const actual = snapshot.entries.map((entry) => entry.name);
  if (actual.join("\n") !== expected.join("\n")) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED",
      "T-554 v3 output inventory does not contain the exact four files.",
    );
  }
}

export function assertGrandHallT554V3SnapshotsEqual(
  before: GrandHallT554V3DirectorySnapshot,
  after: GrandHallT554V3DirectorySnapshot,
  message: string,
): void {
  const entriesEqual = before.entries.length === after.entries.length &&
    before.entries.every((entry, index) => {
      const finalEntry = after.entries[index];
      return finalEntry !== undefined && entry.name === finalEntry.name &&
        grandHallT554V3SameFileState(entry.stats, finalEntry.stats);
    });
  if (!grandHallT554V3SameFileState(before.stats, after.stats) || !entriesEqual) {
    throw new GrandHallT554ReviewPackV3Error("OUTPUT_VERIFICATION_FAILED", message);
  }
}

function assertReadBoundToSnapshots(
  file: GrandHallT554V3StableFile,
  name: string,
  initial: GrandHallT554V3DirectorySnapshot,
  final: GrandHallT554V3DirectorySnapshot,
): void {
  const before = initial.entries.find((entry) => entry.name === name);
  const after = final.entries.find((entry) => entry.name === name);
  if (before === undefined || after === undefined ||
    !grandHallT554V3SameFileState(before.stats, file.stats) ||
    !grandHallT554V3SameFileState(after.stats, file.stats)) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED",
      `${name} was not identity-bound across V3 inventory and content reads.`,
    );
  }
}

export async function readGrandHallT554V3ExactFlatDirectory(
  directory: string,
  expectedNames: readonly string[],
  maximumBytes: number,
  testSeam: GrandHallT554V3SnapshotReadTestSeam = {},
): Promise<GrandHallT554V3SnapshotRead> {
  const initial = await snapshotGrandHallT554V3DirectDirectory(directory);
  assertExpectedNames(initial, expectedNames);
  await testSeam.afterInitialSnapshot?.();
  const rows = await Promise.all(expectedNames.map(async (name) => [name,
    await readGrandHallT554V3StableDirectFile(resolve(directory, name), maximumBytes,
      `T-554 v3 output ${name}`, "OUTPUT_VERIFICATION_FAILED")] as const));
  await testSeam.afterFileReads?.();
  const final = await snapshotGrandHallT554V3DirectDirectory(directory);
  assertExpectedNames(final, expectedNames);
  assertGrandHallT554V3SnapshotsEqual(initial, final,
    "T-554 v3 output changed during one persisted-read phase.");
  const files = new Map(rows);
  for (const [name, file] of files) assertReadBoundToSnapshots(file, name, initial, final);
  return { initial, final, files };
}

export async function assertGrandHallT554V3OwnedDirectory(
  path: string,
  expected: BigIntStats,
  label: string,
): Promise<void> {
  try {
    const node = await canonicalDirectNode({ path, label, kind: "directory" });
    if (!grandHallT554V3SameNode(node.stats, expected)) {
      throw new Error(`${label} node identity changed.`);
    }
  } catch (error) {
    if (error instanceof GrandHallT554ReviewPackV3Error) throw error;
    throw new GrandHallT554ReviewPackV3Error("OUTPUT_UNSAFE", `${label} is no longer owned.`, error);
  }
}

export async function writeGrandHallT554V3ExclusiveSyncedFile(
  path: string,
  bytes: Buffer,
  validateOwnership: () => Promise<void>,
): Promise<void> {
  const handle = await open(path, "wx");
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || opened.size !== 0n) {
      throw new Error("New V3 output descriptor is not one empty single-link file.");
    }
    await validateOwnership();
    const pathBefore = await lstat(path, { bigint: true });
    const descriptorBefore = await handle.stat({ bigint: true });
    if (!grandHallT554V3SameFileState(opened, descriptorBefore) ||
      !grandHallT554V3SameFileState(descriptorBefore, pathBefore)) {
      throw new Error("New V3 output descriptor is not bound to its reserved path.");
    }
    await handle.writeFile(bytes);
    await handle.sync();
    await validateOwnership();
    const pathAfter = await lstat(path, { bigint: true });
    const descriptorAfter = await handle.stat({ bigint: true });
    if (!grandHallT554V3SameFileState(descriptorAfter, pathAfter) ||
      !grandHallT554V3SameNode(opened, descriptorAfter) ||
      descriptorAfter.nlink !== 1n || descriptorAfter.size !== BigInt(bytes.length)) {
      throw new Error("Written V3 output descriptor lost its reserved path binding.");
    }
  } finally {
    await handle.close();
  }
}

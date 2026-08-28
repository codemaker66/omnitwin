import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  open,
  opendir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  CanonicalJsonValueSchema,
  GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH,
  GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SHA256,
  GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SIZE_BYTES,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_DIRECTORY_COUNT,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_FILE_COUNT,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_TOTAL_BYTES,
  GRAND_HALL_PROCESSED_BIG_GUARDRAILS_V1,
  GRAND_HALL_PROCESSED_BIG_INVENTORY_V1,
  GRAND_HALL_PROCESSED_BIG_PROOF_V1,
  GRAND_HALL_PROCESSED_BIG_SOURCE_V1,
  GrandHallProcessedBigInventoryV1Schema,
  GrandHallProcessedBigReviewedInventoryV1Schema,
  computeGrandHallProcessedBigDuplicateGroups,
  computeGrandHallProcessedBigInventorySha256,
  computeGrandHallProcessedBigInventorySummary,
  computeGrandHallProcessedBigManifestSha256,
  computeGrandHallProcessedBigTopLevelPackages,
  stableCanonicalJson,
  type GrandHallProcessedBigInventoryMember,
  type GrandHallProcessedBigInventoryV1,
  type GrandHallProcessedBigInventoryV1Material,
  type GrandHallProcessedBigDirectoryRelativePath,
  type GrandHallProcessedBigReviewedInventoryV1,
} from "@omnitwin/types";

import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/](?![\\/])/u;
const WINDOWS_DEVICE_PATH_PATTERN = /^(?:\\\\[?.]\\|\\[?]{2}\\|\/\/[?.]\/)/u;
const WINDOWS_RESERVED_SEGMENT_PATTERN =
  /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
const WINDOWS_FORBIDDEN_SEGMENT_PATTERN = /[<>:"/\\|?*]/u;
const MAXIMUM_MEMBER_COUNT = 100_000;
const MAXIMUM_DIRECTORY_COUNT = 20_000;
const MAXIMUM_TREE_ENTRY_COUNT =
  MAXIMUM_MEMBER_COUNT + MAXIMUM_DIRECTORY_COUNT;
const MAXIMUM_MEMBER_BYTES = 64n * 1_024n * 1_024n * 1_024n;
const MAXIMUM_TOTAL_BYTES = 1_024n * 1_024n * 1_024n * 1_024n;
const MAXIMUM_RELATIVE_PATH_BYTES = 1_024;
const MAXIMUM_SEGMENT_BYTES = 255;
const MAXIMUM_PATH_DEPTH = 64;
const MAXIMUM_MANIFEST_BYTES = 32 * 1_024 * 1_024;
const HASH_CHUNK_BYTES = 8 * 1_024 * 1_024;
const INVENTORY_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,159}$/u;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type GrandHallProcessedBigInventoryErrorCode =
  | "ARGUMENT_INVALID"
  | "SOURCE_UNSAFE"
  | "SOURCE_CHANGED"
  | "OUTPUT_UNSAFE"
  | "MANIFEST_INVALID"
  | "INVENTORY_MISMATCH";

export class GrandHallProcessedBigInventoryError extends Error {
  constructor(
    readonly code: GrandHallProcessedBigInventoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallProcessedBigInventoryError";
  }
}

export interface __GrandHallProcessedBigInventoryTestSeam {
  readonly afterInitialSnapshot?: () => Promise<void> | void;
  readonly afterSourceDescriptorOpened?: (
    relativePath: string,
  ) => Promise<void> | void;
  readonly afterSourceBytesHashed?: (
    relativePath: string,
  ) => Promise<void> | void;
  readonly beforeFinalSnapshot?: () => Promise<void> | void;
}

export interface BuildGrandHallProcessedBigInventoryOptions {
  readonly sourceRoot: string;
  readonly inventoryId: string;
  readonly createdAt: string;
}

export interface CheckGrandHallProcessedBigInventoryOptions {
  readonly sourceRoot: string;
  readonly inventoryPath: string;
}

interface TreeEntrySnapshot {
  readonly relativePath: string;
  readonly kind: "directory" | "file";
  readonly stats: BigIntStats;
}

interface TreeSnapshot {
  readonly rootStats: BigIntStats;
  readonly directories: readonly TreeEntrySnapshot[];
  readonly files: readonly TreeEntrySnapshot[];
}

interface StableManifestRead {
  readonly bytes: Buffer;
  readonly stats: BigIntStats;
}

interface StableSourceEvidence {
  readonly directories: readonly GrandHallProcessedBigDirectoryRelativePath[];
  readonly members: readonly GrandHallProcessedBigInventoryMember[];
}


function fail(
  code: GrandHallProcessedBigInventoryErrorCode,
  message: string,
  cause?: unknown,
): GrandHallProcessedBigInventoryError {
  return new GrandHallProcessedBigInventoryError(code, message, cause);
}

function utf8Order(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function comparablePath(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32"
    ? normalized.replaceAll("/", "\\").toLowerCase()
    : normalized;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relationship = relative(comparablePath(root), comparablePath(candidate));
  return (
    relationship === "" ||
    (relationship !== ".." &&
      !relationship.startsWith(`..${sep}`) &&
      !isAbsolute(relationship))
  );
}

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameNode(left, right) &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.rdev === right.rdev &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function hasTraversalSegment(value: string): boolean {
  const withoutDrive = /^[A-Za-z]:/u.test(value) ? value.slice(2) : value;
  return withoutDrive
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "." || segment === "..");
}

function hasAlternateDataStreamSyntax(value: string): boolean {
  if (process.platform === "win32") return value.slice(2).includes(":");
  return value.includes(":");
}

function requireAbsoluteLocalPath(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\u0000") ||
    !isAbsolute(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//") ||
    WINDOWS_DEVICE_PATH_PATTERN.test(value) ||
    hasTraversalSegment(value) ||
    hasAlternateDataStreamSyntax(value) ||
    (process.platform === "win32" && !WINDOWS_DRIVE_ROOT_PATTERN.test(value))
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      `${label} must be one traversal-free absolute local non-device path without alternate-data-stream syntax.`,
    );
  }
  return resolve(value);
}

function requireInventoryIdentity(inventoryId: string, createdAt: string): void {
  if (
    typeof inventoryId !== "string" ||
    !INVENTORY_ID_PATTERN.test(inventoryId) ||
    typeof createdAt !== "string" ||
    !ISO_INSTANT_PATTERN.test(createdAt) ||
    Number.isNaN(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "Inventory identity requires one canonical safe ID and exact UTC millisecond instant.",
    );
  }
}

function assertSafeSegment(segment: string, label: string): void {
  const containsNonPrintableAscii = segment.split("").some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === undefined || codePoint < 0x20 || codePoint > 0x7e;
  });
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment !== segment.normalize("NFC") ||
    Buffer.from(segment, "utf8").toString("utf8") !== segment ||
    Buffer.byteLength(segment, "utf8") > MAXIMUM_SEGMENT_BYTES ||
    containsNonPrintableAscii ||
    WINDOWS_FORBIDDEN_SEGMENT_PATTERN.test(segment) ||
    WINDOWS_RESERVED_SEGMENT_PATTERN.test(segment) ||
    segment !== segment.trim() ||
    segment.endsWith(".") ||
    segment.endsWith(" ")
  ) {
    throw fail("SOURCE_UNSAFE", `${label} contains an unsafe path segment.`);
  }
}

function assertSafeRelativePath(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    Buffer.byteLength(value, "utf8") > MAXIMUM_RELATIVE_PATH_BYTES
  ) {
    throw fail("SOURCE_UNSAFE", `${label} is not a canonical relative POSIX path.`);
  }
  const segments = value.split("/");
  if (segments.length > MAXIMUM_PATH_DEPTH) {
    throw fail("SOURCE_UNSAFE", `${label} exceeds the bounded path depth.`);
  }
  for (const segment of segments) assertSafeSegment(segment, label);
}

function safeNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw fail("SOURCE_UNSAFE", `${label} is not exactly representable as a JSON integer.`);
  }
  return Number(value);
}

async function inspectDirectDirectory(
  path: string,
  label: string,
): Promise<BigIntStats> {
  try {
    const before = await lstat(path, { bigint: true });
    const canonical = await realpath(path);
    const after = await lstat(path, { bigint: true });
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      comparablePath(path) !== comparablePath(canonical) ||
      !sameFileState(before, after)
    ) {
      throw fail(
        "SOURCE_UNSAFE",
        `${label} is not one stable direct non-reparse directory.`,
      );
    }
    return after;
  } catch (error) {
    if (error instanceof GrandHallProcessedBigInventoryError) throw error;
    throw fail("SOURCE_UNSAFE", `${label} is unavailable or unsafe.`, error);
  }
}

function assertDirectTreeNode(
  rootStats: BigIntStats,
  absolutePath: string,
  canonicalPath: string,
  stats: BigIntStats,
  relativePath: string,
): "directory" | "file" {
  if (stats.isSymbolicLink() || comparablePath(absolutePath) !== comparablePath(canonicalPath)) {
    throw fail(
      "SOURCE_UNSAFE",
      `Source node ${relativePath} is a symbolic link, junction, reparse point, or path alias.`,
    );
  }
  if (stats.dev !== rootStats.dev) {
    throw fail(
      "SOURCE_UNSAFE",
      `Source node ${relativePath} crosses a filesystem or mounted-device boundary.`,
    );
  }
  if (stats.isDirectory()) return "directory";
  if (!stats.isFile()) {
    throw fail("SOURCE_UNSAFE", `Source node ${relativePath} is not a regular file.`);
  }
  if (stats.nlink !== 1n) {
    throw fail(
      "SOURCE_UNSAFE",
      `Source file ${relativePath} is hard-linked or has an unsafe link count.`,
    );
  }
  if (stats.size < 0n || stats.size > MAXIMUM_MEMBER_BYTES) {
    throw fail("SOURCE_UNSAFE", `Source file ${relativePath} exceeds the member bound.`);
  }
  return "file";
}

async function inspectTreeNode(
  rootStats: BigIntStats,
  absolutePath: string,
  relativePath: string,
): Promise<TreeEntrySnapshot> {
  try {
    const before = await lstat(absolutePath, { bigint: true });
    const canonical = await realpath(absolutePath);
    const after = await lstat(absolutePath, { bigint: true });
    if (!sameFileState(before, after)) {
      throw fail("SOURCE_CHANGED", `Source node ${relativePath} changed during inventory.`);
    }
    const kind = assertDirectTreeNode(
      rootStats,
      absolutePath,
      canonical,
      after,
      relativePath,
    );
    return { relativePath, kind, stats: after };
  } catch (error) {
    if (error instanceof GrandHallProcessedBigInventoryError) throw error;
    throw fail("SOURCE_CHANGED", `Source node ${relativePath} could not be inventoried.`, error);
  }
}

interface SnapshotAccumulator {
  readonly directories: TreeEntrySnapshot[];
  readonly files: TreeEntrySnapshot[];
  readonly foldedPaths: Set<string>;
  entryCount: number;
  totalBytes: bigint;
}

async function readSortedDirectoryNames(path: string): Promise<readonly string[]> {
  const names: string[] = [];
  const handle = await opendir(path, { bufferSize: 32 });
  try {
    for (;;) {
      const entry = await handle.read();
      if (entry === null) break;
      names.push(entry.name);
    }
  } finally {
    await handle.close();
  }
  return names.sort(utf8Order);
}

function recordUniquePortablePath(
  accumulator: SnapshotAccumulator,
  relativePath: string,
): void {
  const folded = relativePath.toLowerCase();
  if (accumulator.foldedPaths.has(folded)) {
    throw fail(
      "SOURCE_UNSAFE",
      `Source tree contains a case-fold path collision at ${relativePath}.`,
    );
  }
  accumulator.foldedPaths.add(folded);
}

async function visitSnapshotDirectory(
  root: string,
  rootStats: BigIntStats,
  relativeDirectory: string,
  accumulator: SnapshotAccumulator,
): Promise<void> {
  const absoluteDirectory =
    relativeDirectory === ""
      ? root
      : resolve(root, ...relativeDirectory.split("/"));
  const directoryBefore = await inspectDirectDirectory(
    absoluteDirectory,
    relativeDirectory === "" ? "Processed BIG source root" : relativeDirectory,
  );
  const names = await readSortedDirectoryNames(absoluteDirectory);
  for (const name of names) {
    assertSafeSegment(name, `Source entry ${name}`);
    const relativePath =
      relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
    assertSafeRelativePath(relativePath, `Source entry ${relativePath}`);
    recordUniquePortablePath(accumulator, relativePath);
    accumulator.entryCount += 1;
    if (accumulator.entryCount > MAXIMUM_TREE_ENTRY_COUNT) {
      throw fail("SOURCE_UNSAFE", "Source tree exceeds the bounded entry count.");
    }
    const absolutePath = resolve(root, ...relativePath.split("/"));
    if (!pathIsWithin(root, absolutePath)) {
      throw fail("SOURCE_UNSAFE", `Source entry ${relativePath} escaped its fixed root.`);
    }
    const snapshot = await inspectTreeNode(
      rootStats,
      absolutePath,
      relativePath,
    );
    if (snapshot.kind === "directory") {
      accumulator.directories.push(snapshot);
      if (accumulator.directories.length > MAXIMUM_DIRECTORY_COUNT) {
        throw fail("SOURCE_UNSAFE", "Source tree exceeds the directory bound.");
      }
      await visitSnapshotDirectory(root, rootStats, relativePath, accumulator);
      continue;
    }
    accumulator.files.push(snapshot);
    accumulator.totalBytes += snapshot.stats.size;
    if (
      accumulator.files.length > MAXIMUM_MEMBER_COUNT ||
      accumulator.totalBytes > MAXIMUM_TOTAL_BYTES
    ) {
      throw fail("SOURCE_UNSAFE", "Source tree exceeds its file or byte bound.");
    }
  }
  const directoryAfter = await inspectDirectDirectory(
    absoluteDirectory,
    relativeDirectory === "" ? "Processed BIG source root" : relativeDirectory,
  );
  if (!sameFileState(directoryBefore, directoryAfter)) {
    throw fail(
      "SOURCE_CHANGED",
      `Source directory ${relativeDirectory || "."} changed during inventory.`,
    );
  }
}

async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const rootBefore = await inspectDirectDirectory(root, "Processed BIG source root");
  const accumulator: SnapshotAccumulator = {
    directories: [],
    files: [],
    foldedPaths: new Set(),
    entryCount: 0,
    totalBytes: 0n,
  };
  await visitSnapshotDirectory(root, rootBefore, "", accumulator);
  const rootAfter = await inspectDirectDirectory(root, "Processed BIG source root");
  if (!sameFileState(rootBefore, rootAfter)) {
    throw fail("SOURCE_CHANGED", "Processed BIG source root changed during inventory.");
  }
  if (accumulator.files.length === 0) {
    throw fail("SOURCE_UNSAFE", "Processed BIG source root contains no regular files.");
  }
  return {
    rootStats: rootAfter,
    directories: accumulator.directories.sort((left, right) =>
      utf8Order(left.relativePath, right.relativePath),
    ),
    files: accumulator.files.sort((left, right) =>
      utf8Order(left.relativePath, right.relativePath),
    ),
  };
}

function assertSnapshotsEqual(initial: TreeSnapshot, final: TreeSnapshot): void {
  const entriesEqual = (
    left: readonly TreeEntrySnapshot[],
    right: readonly TreeEntrySnapshot[],
  ): boolean =>
    left.length === right.length &&
    left.every((entry, index) => {
      const counterpart = right[index];
      return (
        counterpart !== undefined &&
        entry.kind === counterpart.kind &&
        entry.relativePath === counterpart.relativePath &&
        sameFileState(entry.stats, counterpart.stats)
      );
    });
  if (
    !sameFileState(initial.rootStats, final.rootStats) ||
    !entriesEqual(initial.directories, final.directories) ||
    !entriesEqual(initial.files, final.files)
  ) {
    throw fail(
      "SOURCE_CHANGED",
      "Processed BIG source tree changed between its complete before/after snapshots.",
    );
  }
}

function directoryPathsDerivedFromFiles(
  files: readonly TreeEntrySnapshot[],
): readonly string[] {
  const paths = new Set<string>();
  for (const file of files) {
    const segments = file.relativePath.split("/");
    for (let end = 1; end < segments.length; end += 1) {
      paths.add(segments.slice(0, end).join("/"));
    }
  }
  return [...paths].sort(utf8Order);
}

function assertExactDirectoryInventory(snapshot: TreeSnapshot): void {
  const actual = snapshot.directories.map((entry) => entry.relativePath);
  const derived = directoryPathsDerivedFromFiles(snapshot.files);
  const actualSet = new Set(actual);
  const derivedSet = new Set(derived);
  const emptyDirectories = actual.filter((path) => !derivedSet.has(path));
  if (
    actual.length !== GRAND_HALL_PROCESSED_BIG_EXPECTED_DIRECTORY_COUNT ||
    derived.some((path) => !actualSet.has(path)) ||
    emptyDirectories.length !==
      GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES.length ||
    emptyDirectories.some(
      (path, index) =>
        path !== GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES[index],
    )
  ) {
    throw fail(
      "SOURCE_UNSAFE",
      "Processed BIG source does not contain every member-derived parent plus the exact nine audited empty directories.",
    );
  }
  const actualTopLevel = actual.filter((path) => !path.includes("/"));
  const expectedTopLevel = GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES.map(
    (entry) => entry.packageName,
  );
  if (
    actualTopLevel.length !== expectedTopLevel.length ||
    actualTopLevel.some((path, index) => path !== expectedTopLevel[index])
  ) {
    throw fail(
      "SOURCE_UNSAFE",
      "Processed BIG source does not contain the exact nine audited top-level packages.",
    );
  }
}

function assertExactPackageByteSummaries(snapshot: TreeSnapshot): void {
  for (const expected of GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES) {
    const prefix = `${expected.packageName}/`;
    const files = snapshot.files.filter((file) =>
      file.relativePath.startsWith(prefix),
    );
    const totalBytes = files.reduce((sum, file) => sum + file.stats.size, 0n);
    if (
      files.length !== expected.fileCount ||
      totalBytes !== BigInt(expected.totalBytes)
    ) {
      throw fail(
        "SOURCE_UNSAFE",
        `Processed BIG package ${expected.packageName} does not match its audited file/byte summary.`,
      );
    }
  }
}

function assertExactProcessedBigSnapshot(snapshot: TreeSnapshot): void {
  const totalBytes = snapshot.files.reduce(
    (sum, file) => sum + file.stats.size,
    0n,
  );
  const chosenObj = snapshot.files.find(
    (file) =>
      file.relativePath === GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH,
  );
  if (
    snapshot.files.length !== GRAND_HALL_PROCESSED_BIG_EXPECTED_FILE_COUNT ||
    totalBytes !== BigInt(GRAND_HALL_PROCESSED_BIG_EXPECTED_TOTAL_BYTES) ||
    chosenObj?.stats.size !== BigInt(GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SIZE_BYTES)
  ) {
    throw fail(
      "SOURCE_UNSAFE",
      "Processed BIG source does not match the audited total inventory or chosen OBJ size.",
    );
  }
  assertExactDirectoryInventory(snapshot);
  assertExactPackageByteSummaries(snapshot);
}

function assertExactChosenObjMember(
  members: readonly GrandHallProcessedBigInventoryMember[],
): void {
  const chosenObj = members.find(
    (member) =>
      member.relativePath === GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH,
  );
  if (
    chosenObj?.sizeBytes !== GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SIZE_BYTES ||
    chosenObj.sha256 !== GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SHA256
  ) {
    throw fail(
      "SOURCE_UNSAFE",
      "Processed BIG source does not contain the exact audited chosen Grand Hall OBJ bytes.",
    );
  }
}

async function hashExactOpenedFile(
  handle: FileHandle,
  byteLength: number,
  relativePath: string,
): Promise<GrandHallProcessedBigInventoryMember["sha256"]> {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, Math.max(1, byteLength)));
  const trailingProbe = Buffer.alloc(1);
  try {
    let offset = 0;
    while (offset < byteLength) {
      const requested = Math.min(chunk.length, byteLength - offset);
      const result = await handle.read(chunk, 0, requested, offset);
      if (result.bytesRead < 1) {
        throw fail("SOURCE_CHANGED", `Source file ${relativePath} ended during hashing.`);
      }
      hash.update(chunk.subarray(0, result.bytesRead));
      offset += result.bytesRead;
    }
    const trailing = await handle.read(trailingProbe, 0, 1, byteLength);
    if (trailing.bytesRead !== 0) {
      throw fail(
        "SOURCE_CHANGED",
        `Source file ${relativePath} grew beyond its inventoried byte length.`,
      );
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    chunk.fill(0);
    trailingProbe.fill(0);
  }
}

async function hashStableSourceFile(
  root: string,
  rootStats: BigIntStats,
  snapshot: TreeEntrySnapshot,
  seam: __GrandHallProcessedBigInventoryTestSeam,
): Promise<GrandHallProcessedBigInventoryMember> {
  const absolutePath = resolve(root, ...snapshot.relativePath.split("/"));
  let handle: FileHandle | undefined;
  try {
    const pathBefore = await lstat(absolutePath, { bigint: true });
    const canonicalBefore = await realpath(absolutePath);
    const kind = assertDirectTreeNode(
      rootStats,
      absolutePath,
      canonicalBefore,
      pathBefore,
      snapshot.relativePath,
    );
    if (kind !== "file" || !sameFileState(snapshot.stats, pathBefore)) {
      throw fail(
        "SOURCE_CHANGED",
        `Source file ${snapshot.relativePath} changed after the initial snapshot.`,
      );
    }
    handle = await open(absolutePath, "r");
    const descriptorBefore = await handle.stat({ bigint: true });
    if (!sameFileState(pathBefore, descriptorBefore)) {
      throw fail(
        "SOURCE_CHANGED",
        `Source file ${snapshot.relativePath} descriptor is not bound to its inventoried path.`,
      );
    }
    await seam.afterSourceDescriptorOpened?.(snapshot.relativePath);
    const byteLength = safeNumber(descriptorBefore.size, snapshot.relativePath);
    const sha256 = await hashExactOpenedFile(handle, byteLength, snapshot.relativePath);
    await seam.afterSourceBytesHashed?.(snapshot.relativePath);
    const descriptorAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolutePath, { bigint: true });
    const canonicalAfter = await realpath(absolutePath);
    assertDirectTreeNode(
      rootStats,
      absolutePath,
      canonicalAfter,
      pathAfter,
      snapshot.relativePath,
    );
    if (
      !sameFileState(snapshot.stats, descriptorAfter) ||
      !sameFileState(snapshot.stats, pathAfter)
    ) {
      throw fail(
        "SOURCE_CHANGED",
        `Source file ${snapshot.relativePath} changed during its descriptor-bound hash.`,
      );
    }
    return { relativePath: snapshot.relativePath, sizeBytes: byteLength, sha256 };
  } catch (error) {
    if (error instanceof GrandHallProcessedBigInventoryError) throw error;
    throw fail(
      "SOURCE_CHANGED",
      `Source file ${snapshot.relativePath} could not be hashed from one stable descriptor.`,
      error,
    );
  } finally {
    await handle?.close();
  }
}

function buildManifest(
  members: readonly GrandHallProcessedBigInventoryMember[],
  directories: readonly GrandHallProcessedBigDirectoryRelativePath[],
  inventoryId: string,
  createdAt: string,
): GrandHallProcessedBigInventoryV1 {
  try {
    const material: GrandHallProcessedBigInventoryV1Material = {
      schemaVersion: GRAND_HALL_PROCESSED_BIG_INVENTORY_V1,
      inventoryId,
      createdAt,
      source: GRAND_HALL_PROCESSED_BIG_SOURCE_V1,
      directories: [...directories],
      members: [...members],
      summary: computeGrandHallProcessedBigInventorySummary(
        members,
        directories,
      ),
      topLevelPackages: computeGrandHallProcessedBigTopLevelPackages(members),
      duplicateGroups: computeGrandHallProcessedBigDuplicateGroups(members),
      inventorySha256: computeGrandHallProcessedBigInventorySha256(members),
      proof: GRAND_HALL_PROCESSED_BIG_PROOF_V1,
      guardrails: GRAND_HALL_PROCESSED_BIG_GUARDRAILS_V1,
    };
    return deepFreeze(
      GrandHallProcessedBigInventoryV1Schema.parse({
        ...material,
        manifestSha256: computeGrandHallProcessedBigManifestSha256(material),
      }),
    );
  } catch (error) {
    throw fail(
      "SOURCE_UNSAFE",
      "Processed BIG source bytes do not satisfy the exact shared inventory contract.",
      error,
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}

function requireReviewedInventory(
  inventory: GrandHallProcessedBigInventoryV1,
  code: "SOURCE_UNSAFE" | "MANIFEST_INVALID",
): GrandHallProcessedBigReviewedInventoryV1 {
  const reviewed = GrandHallProcessedBigReviewedInventoryV1Schema.safeParse(inventory);
  if (!reviewed.success) {
    throw fail(
      code,
      "Processed BIG inventory does not match the reviewed exact member identity.",
      reviewed.error,
    );
  }
  return deepFreeze(reviewed.data);
}

function canonicalManifestBytes(manifest: GrandHallProcessedBigInventoryV1): Buffer {
  const canonical = CanonicalJsonValueSchema.parse(manifest);
  return Buffer.from(`${stableCanonicalJson(canonical)}\n`, "utf8");
}

async function collectStableSourceEvidence(
  sourceRoot: string,
  seam: __GrandHallProcessedBigInventoryTestSeam,
  validateSnapshot: (snapshot: TreeSnapshot) => void,
): Promise<StableSourceEvidence> {
  const initial = await snapshotTree(sourceRoot);
  validateSnapshot(initial);
  await seam.afterInitialSnapshot?.();
  const members: GrandHallProcessedBigInventoryMember[] = [];
  for (const file of initial.files) {
    members.push(
      await hashStableSourceFile(sourceRoot, initial.rootStats, file, seam),
    );
  }
  await seam.beforeFinalSnapshot?.();
  const final = await snapshotTree(sourceRoot);
  validateSnapshot(final);
  assertSnapshotsEqual(initial, final);
  return {
    directories: initial.directories.map((entry) => entry.relativePath),
    members,
  };
}

async function buildFromSource(
  sourceRoot: string,
  inventoryId: string,
  createdAt: string,
  seam: __GrandHallProcessedBigInventoryTestSeam,
): Promise<GrandHallProcessedBigInventoryV1> {
  const evidence = await collectStableSourceEvidence(
    sourceRoot,
    seam,
    assertExactProcessedBigSnapshot,
  );
  assertExactChosenObjMember(evidence.members);
  return buildManifest(
    evidence.members,
    evidence.directories,
    inventoryId,
    createdAt,
  );
}

function requireDisjointInventoryPath(
  sourceRoot: string,
  inventoryPath: string,
): string {
  const fixed = requireAbsoluteLocalPath(inventoryPath, "Inventory manifest path");
  if (pathIsWithin(sourceRoot, fixed)) {
    throw fail(
      "OUTPUT_UNSAFE",
      "Inventory manifest path must remain outside the source tree.",
    );
  }
  return fixed;
}

function parseCanonicalManifest(bytes: Buffer): GrandHallProcessedBigInventoryV1 {
  let value: unknown;
  try {
    value = parseGrandHallT554StrictJson(bytes);
  } catch (error) {
    throw fail("MANIFEST_INVALID", "Processed BIG inventory is not strict JSON.", error);
  }
  const parsedResult = GrandHallProcessedBigInventoryV1Schema.safeParse(value);
  if (!parsedResult.success) {
    throw fail(
      "MANIFEST_INVALID",
      "Processed BIG inventory does not satisfy the exact shared schema.",
      parsedResult.error,
    );
  }
  const parsed = deepFreeze(parsedResult.data);
  if (!bytes.equals(canonicalManifestBytes(parsed))) {
    throw fail("MANIFEST_INVALID", "Processed BIG inventory bytes are not canonical JSON.");
  }
  return parsed;
}

async function readExactOpenedFile(handle: FileHandle, byteLength: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  const trailingProbe = Buffer.alloc(1);
  try {
    let offset = 0;
    while (offset < byteLength) {
      const result = await handle.read(bytes, offset, byteLength - offset, offset);
      if (result.bytesRead < 1) {
        throw fail("MANIFEST_INVALID", "Inventory manifest ended during its exact read.");
      }
      offset += result.bytesRead;
    }
    const trailing = await handle.read(trailingProbe, 0, 1, byteLength);
    if (trailing.bytesRead !== 0) {
      throw fail("MANIFEST_INVALID", "Inventory manifest grew during its exact read.");
    }
    return bytes;
  } finally {
    trailingProbe.fill(0);
  }
}

async function readStableManifestPath(path: string): Promise<StableManifestRead> {
  let handle: FileHandle | undefined;
  let bytes: Buffer | undefined;
  try {
    const before = await lstat(path, { bigint: true });
    const canonicalBefore = await realpath(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1n ||
      before.size < 1n ||
      before.size > BigInt(MAXIMUM_MANIFEST_BYTES) ||
      comparablePath(path) !== comparablePath(canonicalBefore)
    ) {
      throw fail("OUTPUT_UNSAFE", "Inventory manifest path is not one bounded direct file.");
    }
    handle = await open(path, "r");
    const descriptorBefore = await handle.stat({ bigint: true });
    if (!sameFileState(before, descriptorBefore)) {
      throw fail("OUTPUT_UNSAFE", "Inventory manifest descriptor is not bound to its path.");
    }
    bytes = await readExactOpenedFile(handle, safeNumber(before.size, "Inventory manifest bytes"));
    const descriptorAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(path, { bigint: true });
    const canonicalAfter = await realpath(path);
    if (
      !sameFileState(before, descriptorAfter) ||
      !sameFileState(before, pathAfter) ||
      comparablePath(path) !== comparablePath(canonicalAfter)
    ) {
      throw fail("OUTPUT_UNSAFE", "Inventory manifest changed during its stable read.");
    }
    return { bytes, stats: pathAfter };
  } catch (error) {
    bytes?.fill(0);
    if (error instanceof GrandHallProcessedBigInventoryError) throw error;
    throw fail("OUTPUT_UNSAFE", "Inventory manifest could not be read safely.", error);
  } finally {
    await handle?.close();
  }
}

export async function buildGrandHallProcessedBigInventory(
  options: BuildGrandHallProcessedBigInventoryOptions,
): Promise<GrandHallProcessedBigReviewedInventoryV1> {
  const sourceRoot = requireAbsoluteLocalPath(options.sourceRoot, "Processed BIG source root");
  const rootStats = await inspectDirectDirectory(sourceRoot, "Processed BIG source root");
  if (rootStats.nlink < 1n) {
    throw fail("SOURCE_UNSAFE", "Processed BIG source root has an unsafe link count.");
  }
  requireInventoryIdentity(options.inventoryId, options.createdAt);
  return requireReviewedInventory(
    await buildFromSource(
      sourceRoot,
      options.inventoryId,
      options.createdAt,
      {},
    ),
    "SOURCE_UNSAFE",
  );
}

export async function checkGrandHallProcessedBigInventory(
  options: CheckGrandHallProcessedBigInventoryOptions,
): Promise<GrandHallProcessedBigReviewedInventoryV1> {
  const sourceRoot = requireAbsoluteLocalPath(options.sourceRoot, "Processed BIG source root");
  await inspectDirectDirectory(sourceRoot, "Processed BIG source root");
  const inventoryPath = requireDisjointInventoryPath(
    sourceRoot,
    options.inventoryPath,
  );
  const firstRead = await readStableManifestPath(inventoryPath);
  const expected = requireReviewedInventory(
    parseCanonicalManifest(firstRead.bytes),
    "MANIFEST_INVALID",
  );
  const rebuilt = requireReviewedInventory(
    await buildFromSource(
      sourceRoot,
      expected.inventoryId,
      expected.createdAt,
      {},
    ),
    "SOURCE_UNSAFE",
  );
  const secondRead = await readStableManifestPath(inventoryPath);
  if (
    !sameFileState(firstRead.stats, secondRead.stats) ||
    !firstRead.bytes.equals(secondRead.bytes)
  ) {
    throw fail("OUTPUT_UNSAFE", "Inventory manifest changed during source regeneration.");
  }
  if (!canonicalManifestBytes(expected).equals(canonicalManifestBytes(rebuilt))) {
    throw fail(
      "INVENTORY_MISMATCH",
      "Persisted inventory does not match an exact regeneration from the stable source tree.",
    );
  }
  return expected;
}

interface TestOnlyCollectStableEvidenceOptions {
  readonly sourceRoot: string;
  readonly testSeam?: __GrandHallProcessedBigInventoryTestSeam;
}

async function collectTestOnlyStableSourceEvidence(
  options: TestOnlyCollectStableEvidenceOptions,
): Promise<StableSourceEvidence> {
  const sourceRoot = requireAbsoluteLocalPath(
    options.sourceRoot,
    "Synthetic processed BIG source root",
  );
  await inspectDirectDirectory(sourceRoot, "Synthetic processed BIG source root");
  const evidence = await collectStableSourceEvidence(
    sourceRoot,
    options.testSeam ?? {},
    () => {
      // The exact 399-file contract is deliberately enforced only by the public build.
    },
  );
  return { directories: evidence.directories, members: evidence.members };
}

export const __testOnlyGrandHallProcessedBigInventory = Object.freeze({
  canonicalManifestBytes(
    manifest: GrandHallProcessedBigInventoryV1,
  ): Uint8Array {
    return Buffer.from(canonicalManifestBytes(manifest));
  },
  parseCanonicalManifestBytes(
    bytes: Uint8Array,
  ): GrandHallProcessedBigInventoryV1 {
    return parseCanonicalManifest(Buffer.from(bytes));
  },
  collectStableEvidence(
    options: TestOnlyCollectStableEvidenceOptions,
  ): Promise<StableSourceEvidence> {
    return collectTestOnlyStableSourceEvidence(options);
  },
  async collectStableMembers(
    options: TestOnlyCollectStableEvidenceOptions,
  ): Promise<readonly GrandHallProcessedBigInventoryMember[]> {
    return (await collectTestOnlyStableSourceEvidence(options)).members;
  },
});

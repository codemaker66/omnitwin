import { createHash } from "node:crypto";
import type { BigIntStats, Dirent } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  CanonicalJsonValueSchema,
  GrandHallClosedBoundaryV1Schema,
  GrandHallOutputInventoryMaskV1Schema,
  GrandHallPanoramaMaskSetV1Schema,
  GrandHallPortalDecisionsV1Schema,
  GrandHallReviewedTransformV1Schema,
  GrandHallRoomMembershipV2Schema,
  GrandHallScopeReviewPackV1Schema,
  stableCanonicalJson,
  type GrandHallClosedBoundaryV1,
  type GrandHallOutputInventoryMaskV1,
  type GrandHallOutputSourceMember,
  type GrandHallPanoramaMaskSetV1,
  type GrandHallPortalDecisionsV1,
  type GrandHallReviewedTransformV1,
  type GrandHallRoomMembershipV2,
  type GrandHallScopeReviewPackV1,
} from "@omnitwin/types";
import { z } from "zod";

import {
  computeGrandHallT554ClosedVolumeReviewSha256,
  computeGrandHallT554HumanDecisionsSha256,
  GrandHallT554ClosedVolumeReviewSchema,
  GrandHallT554HumanDecisionsSchema,
  type GrandHallT554ClosedVolumeReview,
  type GrandHallT554HumanDecisions,
} from "./grand-hall-t554-acceptance.js";
import {
  GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
  GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
  validateGrandHallT554MaskPngBytes,
  validateGrandHallT554SourceJpegBytes,
} from "./grand-hall-t554-media-validation.js";
import { isSafeGrandHallT554RelativePath } from "./grand-hall-t554-path-safety.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

const JSON_FILE_MAX_BYTES = 16 * 1024 * 1024;
const STREAM_BUFFER_BYTES = 8 * 1024 * 1024;
const SHA256_PREFIXED_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export const GRAND_HALL_ACCEPTED_SCOPE_BUNDLE_VERIFIER_VERSION =
  "venviewer.grand-hall-accepted-scope-bundle-integrity-verifier.v1";

export type GrandHallAcceptedScopeBundleVerificationErrorCode =
  | "ARGUMENT_INVALID"
  | "PATH_UNSAFE"
  | "PATH_ESCAPE"
  | "PATH_LINK"
  | "PATH_NON_REGULAR"
  | "PATH_IDENTITY_CHANGED"
  | "FILE_SIZE_MISMATCH"
  | "FILE_DIGEST_MISMATCH"
  | "JSON_INVALID"
  | "JSON_NON_CANONICAL"
  | "SCHEMA_INVALID"
  | "CROSS_BINDING_MISMATCH"
  | "SOURCE_INVENTORY_DRIFT"
  | "SOURCE_JPEG_INVALID"
  | "MASK_PNG_INVALID"
  | "SOURCE_MEMBER_INVALID"
  | "BITSET_INVALID";

export class GrandHallAcceptedScopeBundleVerificationError extends Error {
  readonly code: GrandHallAcceptedScopeBundleVerificationErrorCode;

  constructor(
    code: GrandHallAcceptedScopeBundleVerificationErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallAcceptedScopeBundleVerificationError";
    this.code = code;
  }
}

export interface GrandHallAcceptedScopeArtifactFiles {
  readonly publicationReceipt: string;
  readonly scopeReviewPack: string;
  readonly humanDecisions: string;
  readonly closedVolumeReview: string;
  readonly roomMembership: string;
  readonly portalDecisions: string;
  readonly closedBoundary: string;
  readonly panoramaMaskSet: string;
  readonly reviewedTransform: string;
  readonly outputInventoryMask: string;
}

export interface VerifyGrandHallAcceptedScopeBundleOptions {
  /** Dedicated root containing only the accepted artifact JSON, masks, and bitset. */
  readonly bundleRoot: string;
  /** Immutable root containing the exact 8,192 x 4,096 source JPEGs. */
  readonly panoramaSourceRoot: string;
  /** Dedicated root containing exactly the ordered record-bearing XGRIDS/LCC members. */
  readonly xgridsOutputRoot: string;
  readonly artifactFiles: GrandHallAcceptedScopeArtifactFiles;
  /**
   * Required format-aware parser. It receives the same descriptor stream that is hashed, so the
   * claimed record kind/count cannot be inferred from filenames or a second racy file read.
   */
  readonly createXgridsSourceMemberInspector: GrandHallXgridsSourceMemberInspectorFactory;
}

export interface GrandHallXgridsSourceMemberInspectionResult {
  readonly recordKind: "point" | "gaussian";
  readonly recordCount: number;
  readonly recordOrder: "native_file_order";
}

export interface GrandHallXgridsSourceMemberStreamInspector {
  /** Chunk storage is reused after this awaited call; copy bytes if the inspector must retain them. */
  update(bytes: Uint8Array, absoluteOffset: number): void | PromiseLike<void>;
  finish():
    | GrandHallXgridsSourceMemberInspectionResult
    | PromiseLike<GrandHallXgridsSourceMemberInspectionResult>;
}

export type GrandHallXgridsSourceMemberInspectorFactory = (
  member: GrandHallOutputSourceMember,
) => GrandHallXgridsSourceMemberStreamInspector;

export interface GrandHallAcceptedScopeBundleVerificationResult {
  readonly verifierVersion: typeof GRAND_HALL_ACCEPTED_SCOPE_BUNDLE_VERIFIER_VERSION;
  readonly integrityVerified: true;
  readonly sourceRecordStructureVerified: true;
  readonly productionTrustActivated: false;
  readonly runtimeAdmissionAuthorized: false;
  readonly semanticAccuracyReReviewed: false;
  readonly reviewPackSha256: string;
  readonly humanDecisionsSha256: string;
  readonly closedVolumeReviewSha256: string;
  readonly artifactSha256s: {
    readonly scopeReviewPack: string;
    readonly roomMembership: string;
    readonly portalDecisions: string;
    readonly closedBoundary: string;
    readonly panoramaMaskSet: string;
    readonly reviewedTransform: string;
    readonly outputInventoryMask: string;
  };
  readonly panoramaSourceCount: number;
  readonly panoramaMaskCount: number;
  readonly xgridsSourceMemberCount: number;
  readonly outputRecordCount: number;
  readonly includedRecordCount: number;
  readonly excludedRecordCount: number;
  readonly verifiedFileCount: number;
  readonly verifiedByteCount: number;
}

interface TrustedRoot {
  readonly label: string;
  readonly logicalPath: string;
  readonly canonicalPath: string;
  readonly identity: FileIdentity;
}

interface FileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly mode: bigint;
  readonly linkCount: bigint;
  readonly size: bigint;
  readonly modifiedNanoseconds: bigint;
  readonly changedNanoseconds: bigint;
}

interface StableFileResult {
  readonly bytes: Buffer | null;
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
  readonly identity: FileIdentity;
}

interface DirectoryWitness {
  readonly logicalPath: string;
  readonly canonicalPath: string;
  readonly identity: FileIdentity;
}

interface StableFileExpectation {
  readonly expectedByteLength?: number;
  readonly expectedSha256?: string;
  readonly expectedIdentity?: FileIdentity;
  readonly captureBytes: boolean;
  readonly maximumByteLength?: number;
  readonly onChunk?: (
    bytes: Uint8Array,
    absoluteOffset: number,
  ) => void | PromiseLike<void>;
}

interface LocatedRegularFile {
  readonly absolutePath: string;
  readonly canonicalPath: string;
  readonly stats: BigIntStats;
  readonly directoryWitnesses: readonly DirectoryWitness[];
}

interface FileSnapshot {
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
  readonly identity: FileIdentity;
}

interface VerificationSnapshot {
  readonly bundleFiles: Map<string, FileSnapshot>;
  readonly panoramaFiles: Map<string, FileSnapshot>;
  readonly xgridsFiles: Map<string, FileSnapshot>;
}

const PublicationFileReceiptSchema = z.object({
  fileName: z.string().trim().min(1).max(512).superRefine((value, context) => {
    if (!isSafeGrandHallT554RelativePath(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fileName must be a canonical traversal-free POSIX relative path",
      });
    }
  }),
  sha256: z.string().regex(SHA256_PREFIXED_PATTERN),
  byteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const T554PublicationReceiptSchema = z.object({
  authority: z.literal("human_accepted"),
  reviewPackSha256: z.string().regex(SHA256_PREFIXED_PATTERN),
  humanDecisionsSha256: z.string().regex(SHA256_PREFIXED_PATTERN),
  closedVolumeReviewSha256: z.string().regex(SHA256_PREFIXED_PATTERN),
  artifactSha256s: z.object({
    roomMembership: z.string().regex(SHA256_PREFIXED_PATTERN),
    interfaceDecisions: z.string().regex(SHA256_PREFIXED_PATTERN),
    closedBoundary: z.string().regex(SHA256_PREFIXED_PATTERN),
    panoramaMaskSet: z.string().regex(SHA256_PREFIXED_PATTERN),
  }).strict(),
  schemaVersion: z.literal("venviewer.grand-hall-t554-acceptance-publication.v1"),
  state: z.literal("complete"),
  productionTrust: z.null(),
  runtimeAdmissionAuthorized: z.literal(false),
  reconstructionAuthorized: z.literal(false),
  files: z.array(PublicationFileReceiptSchema).min(7).max(57),
}).strict().superRefine((receipt, context) => {
  const names = receipt.files.map((file) => file.fileName);
  const sorted = [...names].sort((left, right) => left.localeCompare(right));
  if (new Set(names).size !== names.length || !sameStringArray(names, sorted)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["files"],
      message: "file receipts must have unique fileName values in canonical sorted order",
    });
  }
  if (names.includes("publication-receipt.json")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["files"],
      message: "the publication receipt cannot include itself as a payload",
    });
  }
});

type T554PublicationReceipt = z.infer<typeof T554PublicationReceiptSchema>;

interface ParsedT554Artifacts {
  readonly scopeReviewPack: GrandHallScopeReviewPackV1;
  readonly humanDecisions: GrandHallT554HumanDecisions;
  readonly closedVolumeReview: GrandHallT554ClosedVolumeReview;
  readonly membership: GrandHallRoomMembershipV2;
  readonly portals: GrandHallPortalDecisionsV1;
  readonly boundary: GrandHallClosedBoundaryV1;
  readonly panoramaMasks: GrandHallPanoramaMaskSetV1;
  readonly publicationReceipt: T554PublicationReceipt;
}

interface ParsedT557Artifacts {
  readonly transform: GrandHallReviewedTransformV1;
  readonly outputMask: GrandHallOutputInventoryMaskV1;
}

interface ParsedAcceptedArtifacts extends ParsedT554Artifacts, ParsedT557Artifacts {}

interface VerificationTotals {
  fileCount: number;
  byteCount: number;
}

function createVerificationSnapshot(): VerificationSnapshot {
  return {
    bundleFiles: new Map(),
    panoramaFiles: new Map(),
    xgridsFiles: new Map(),
  };
}

function captureFileSnapshot(
  snapshots: Map<string, FileSnapshot>,
  relativePath: string,
  file: StableFileResult,
): void {
  if (snapshots.has(relativePath)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      `File ${relativePath} was assigned more than one initial snapshot identity.`,
    );
  }
  snapshots.set(relativePath, Object.freeze({
    byteLength: file.byteLength,
    sha256: file.sha256,
    identity: file.identity,
  }));
}

function requireFileSnapshot(
  snapshots: ReadonlyMap<string, FileSnapshot>,
  relativePath: string,
): FileSnapshot {
  const snapshot = snapshots.get(relativePath);
  if (snapshot === undefined) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      `File ${relativePath} has no initial snapshot identity.`,
    );
  }
  return snapshot;
}

function snapshotExpectation(snapshot: FileSnapshot, captureBytes: boolean): StableFileExpectation {
  return {
    captureBytes,
    expectedByteLength: snapshot.byteLength,
    expectedSha256: snapshot.sha256,
    expectedIdentity: snapshot.identity,
  };
}

function recordVerifiedFile(totals: VerificationTotals, byteLength: number): void {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    totals.fileCount >= Number.MAX_SAFE_INTEGER ||
    totals.byteCount > Number.MAX_SAFE_INTEGER - byteLength
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "ARGUMENT_INVALID",
      "Verified file totals exceed exact JavaScript integer accounting.",
    );
  }
  totals.fileCount += 1;
  totals.byteCount += byteLength;
}

function comparablePath(value: string): string {
  const normalized = resolve(value).replace(/^\\\\\?\\/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relationship = relative(root, candidate);
  return (
    relationship === "" ||
    (!relationship.startsWith(`..${sep}`) && relationship !== ".." && !isAbsolute(relationship))
  );
}

function identity(stats: BigIntStats): FileIdentity {
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    linkCount: stats.nlink,
    size: stats.size,
    modifiedNanoseconds: stats.mtimeNs,
    changedNanoseconds: stats.ctimeNs,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.linkCount === right.linkCount &&
    left.size === right.size &&
    left.modifiedNanoseconds === right.modifiedNanoseconds &&
    left.changedNanoseconds === right.changedNanoseconds
  );
}

function safeNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "ARGUMENT_INVALID",
      `${label} cannot be represented exactly by the verifier.`,
    );
  }
  return Number(value);
}

function requireSafeRelativePath(value: string, label: string): string {
  if (!isSafeGrandHallT554RelativePath(value)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_UNSAFE",
      `${label} must be a traversal-free canonical POSIX relative path.`,
    );
  }
  return value;
}

async function createTrustedRoot(path: string, label: string): Promise<TrustedRoot> {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "ARGUMENT_INVALID",
      `${label} must be an absolute path.`,
    );
  }
  const logicalPath = resolve(path);
  let stats: BigIntStats;
  let canonicalPath: string;
  try {
    stats = await lstat(logicalPath, { bigint: true });
    canonicalPath = await realpath(logicalPath);
  } catch (error) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "ARGUMENT_INVALID",
      `${label} is unavailable.`,
      error,
    );
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      stats.isSymbolicLink() ? "PATH_LINK" : "ARGUMENT_INVALID",
      `${label} must be a direct, non-link directory.`,
    );
  }
  if (comparablePath(canonicalPath) !== comparablePath(logicalPath)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_LINK",
      `${label} must not resolve through a reparse point or directory alias.`,
    );
  }
  return { label, logicalPath, canonicalPath, identity: identity(stats) };
}

function assertDisjointRoots(roots: readonly TrustedRoot[]): void {
  for (let leftIndex = 0; leftIndex < roots.length; leftIndex += 1) {
    const left = roots[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < roots.length; rightIndex += 1) {
      const right = roots[rightIndex];
      if (right === undefined) continue;
      if (
        pathIsWithin(left.canonicalPath, right.canonicalPath) ||
        pathIsWithin(right.canonicalPath, left.canonicalPath)
      ) {
        throw new GrandHallAcceptedScopeBundleVerificationError(
          "ARGUMENT_INVALID",
          `${left.label} and ${right.label} must be disjoint dedicated roots.`,
        );
      }
    }
  }
}

async function statTraversalEntry(
  root: TrustedRoot,
  safePath: string,
  absolutePath: string,
): Promise<BigIntStats> {
  try {
    return await lstat(absolutePath, { bigint: true });
  } catch (error) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_NON_REGULAR",
      `${root.label} file ${safePath} is unavailable.`,
      error,
    );
  }
}

function assertTraversalEntryKind(
  root: TrustedRoot,
  safePath: string,
  stats: BigIntStats,
  finalSegment: boolean,
): void {
  if (stats.isSymbolicLink()) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_LINK",
      `${root.label} file ${safePath} traverses a symbolic link or reparse point.`,
    );
  }
  if ((!finalSegment && !stats.isDirectory()) || (finalSegment && !stats.isFile())) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_NON_REGULAR",
      `${root.label} file ${safePath} is not a direct regular file.`,
    );
  }
}

async function createDirectoryWitness(
  root: TrustedRoot,
  safePath: string,
  logicalPath: string,
  stats: BigIntStats,
): Promise<DirectoryWitness> {
  const canonicalPath = await realpath(logicalPath);
  if (!pathIsWithin(root.canonicalPath, canonicalPath)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_ESCAPE",
      `${root.label} file ${safePath} traverses outside its trusted root.`,
    );
  }
  return { logicalPath, canonicalPath, identity: identity(stats) };
}

async function finalizeLocatedRegularFile(
  root: TrustedRoot,
  safePath: string,
  absolutePath: string,
  directoryWitnesses: readonly DirectoryWitness[],
): Promise<LocatedRegularFile> {
  const canonicalPath = await realpath(absolutePath);
  if (!pathIsWithin(root.canonicalPath, canonicalPath)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_ESCAPE",
      `${root.label} file ${safePath} resolves outside its trusted root.`,
    );
  }
  const stats = await statTraversalEntry(root, safePath, absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1n) {
    const code = stats.isSymbolicLink() || stats.nlink !== 1n ? "PATH_LINK" : "PATH_NON_REGULAR";
    throw new GrandHallAcceptedScopeBundleVerificationError(
      code,
      `${root.label} file ${safePath} changed or became linked before opening.`,
    );
  }
  return { absolutePath, canonicalPath, stats, directoryWitnesses };
}

async function locateDirectRegularFile(
  root: TrustedRoot,
  relativePath: string,
): Promise<LocatedRegularFile> {
  const safePath = requireSafeRelativePath(relativePath, `${root.label} file path`);
  const segments = safePath.split("/");
  let currentPath = root.logicalPath;
  const directoryWitnesses: DirectoryWitness[] = [{
    logicalPath: root.logicalPath,
    canonicalPath: root.canonicalPath,
    identity: root.identity,
  }];
  for (const [index, segment] of segments.entries()) {
    currentPath = resolve(currentPath, segment);
    if (!pathIsWithin(root.logicalPath, currentPath)) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "PATH_ESCAPE",
        `${root.label} file path escaped its trusted root.`,
      );
    }
    const stats = await statTraversalEntry(root, safePath, currentPath);
    const finalSegment = index === segments.length - 1;
    assertTraversalEntryKind(root, safePath, stats, finalSegment);
    if (!finalSegment) {
      directoryWitnesses.push(await createDirectoryWitness(root, safePath, currentPath, stats));
    }
  }
  return finalizeLocatedRegularFile(root, safePath, currentPath, directoryWitnesses);
}

async function assertDirectoryWitnessesStable(
  root: TrustedRoot,
  witnesses: readonly DirectoryWitness[],
  safePath: string,
): Promise<void> {
  for (const witness of witnesses) {
    const stats = await lstat(witness.logicalPath, { bigint: true });
    const canonicalPath = await realpath(witness.logicalPath);
    if (
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      !sameIdentity(witness.identity, identity(stats)) ||
      comparablePath(canonicalPath) !== comparablePath(witness.canonicalPath) ||
      !pathIsWithin(root.canonicalPath, canonicalPath)
    ) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "PATH_IDENTITY_CHANGED",
        `${root.label} parent path for ${safePath} changed during verification.`,
      );
    }
  }
}

function validateDiscoveredFile(
  root: TrustedRoot,
  safePath: string,
  discoveredIdentity: FileIdentity,
  expectation: StableFileExpectation,
): number {
  if (
    expectation.expectedIdentity !== undefined &&
    !sameIdentity(discoveredIdentity, expectation.expectedIdentity)
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_IDENTITY_CHANGED",
      `${root.label} file ${safePath} differs from its initial snapshot identity.`,
    );
  }
  const discoveredSize = safeNumber(discoveredIdentity.size, `${safePath} byte length`);
  if (
    expectation.maximumByteLength !== undefined &&
    discoveredSize > expectation.maximumByteLength
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "FILE_SIZE_MISMATCH",
      `${root.label} file ${safePath} exceeds its verification ceiling.`,
    );
  }
  if (
    expectation.expectedByteLength !== undefined &&
    discoveredSize !== expectation.expectedByteLength
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "FILE_SIZE_MISMATCH",
      `${root.label} file ${safePath} differs from its exact declared byte length.`,
    );
  }
  return discoveredSize;
}

function assertDescriptorInitiallyStable(
  root: TrustedRoot,
  safePath: string,
  discoveredIdentity: FileIdentity,
  descriptorIdentity: FileIdentity,
): void {
  if (!sameIdentity(discoveredIdentity, descriptorIdentity)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_IDENTITY_CHANGED",
      `${root.label} file ${safePath} changed while it was opened.`,
    );
  }
}

async function readDescriptorContent(
  handle: Awaited<ReturnType<typeof open>>,
  byteLength: number,
  expectation: StableFileExpectation,
  root: TrustedRoot,
  safePath: string,
): Promise<{ readonly bytes: Buffer | null; readonly sha256: `sha256:${string}` }> {
  const captured = expectation.captureBytes ? Buffer.alloc(byteLength) : null;
  const buffer = Buffer.allocUnsafe(Math.min(STREAM_BUFFER_BYTES, Math.max(byteLength, 1)));
  const hash = createHash("sha256");
  let offset = 0;
  while (offset < byteLength) {
    const requested = Math.min(buffer.byteLength, byteLength - offset);
    const read = await handle.read(buffer, 0, requested, offset);
    if (read.bytesRead <= 0) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "PATH_IDENTITY_CHANGED",
        `${root.label} file ${safePath} ended during verification.`,
      );
    }
    const chunk = buffer.subarray(0, read.bytesRead);
    hash.update(chunk);
    if (captured !== null) chunk.copy(captured, offset);
    await expectation.onChunk?.(chunk, offset);
    offset += read.bytesRead;
  }
  return { bytes: captured, sha256: `sha256:${hash.digest("hex")}` };
}

async function assertDescriptorStillStable(
  root: TrustedRoot,
  safePath: string,
  located: LocatedRegularFile,
  descriptorBefore: FileIdentity,
  handle: Awaited<ReturnType<typeof open>>,
): Promise<FileIdentity> {
  const descriptorAfter = identity(await handle.stat({ bigint: true }));
  const pathAfter = await lstat(located.absolutePath, { bigint: true });
  const canonicalAfter = await realpath(located.absolutePath);
  await assertDirectoryWitnessesStable(root, located.directoryWitnesses, safePath);
  if (
    pathAfter.isSymbolicLink() ||
    pathAfter.nlink !== 1n ||
    !sameIdentity(descriptorBefore, descriptorAfter) ||
    !sameIdentity(descriptorAfter, identity(pathAfter)) ||
    comparablePath(canonicalAfter) !== comparablePath(located.canonicalPath) ||
    !pathIsWithin(root.canonicalPath, canonicalAfter)
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_IDENTITY_CHANGED",
      `${root.label} file ${safePath} changed during same-descriptor verification.`,
    );
  }
  return descriptorAfter;
}

function assertExpectedFileDigest(
  root: TrustedRoot,
  safePath: string,
  actualSha256: string,
  expectedSha256: string | undefined,
): void {
  if (expectedSha256 !== undefined && actualSha256 !== expectedSha256) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "FILE_DIGEST_MISMATCH",
      `${root.label} file ${safePath} differs from its exact declared SHA-256.`,
    );
  }
}

async function readStableRegularFile(
  root: TrustedRoot,
  relativePath: string,
  expectation: StableFileExpectation,
): Promise<StableFileResult> {
  const safePath = requireSafeRelativePath(relativePath, `${root.label} file path`);
  const located = await locateDirectRegularFile(root, safePath);
  const discoveredIdentity = identity(located.stats);
  const byteLength = validateDiscoveredFile(root, safePath, discoveredIdentity, expectation);
  const handle = await open(located.absolutePath, "r");
  try {
    const descriptorBefore = identity(await handle.stat({ bigint: true }));
    assertDescriptorInitiallyStable(root, safePath, discoveredIdentity, descriptorBefore);
    const content = await readDescriptorContent(handle, byteLength, expectation, root, safePath);
    const stableIdentity = await assertDescriptorStillStable(
      root, safePath, located, descriptorBefore, handle,
    );
    assertExpectedFileDigest(root, safePath, content.sha256, expectation.expectedSha256);
    return { ...content, byteLength, identity: stableIdentity };
  } finally {
    await handle.close();
  }
}

function canonicalJsonBytes(value: unknown): string {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(value));
}

function parseCanonicalJson(bytes: Buffer, label: string): unknown {
  if (bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "JSON_NON_CANONICAL",
      `${label} must not contain a UTF-8 byte-order mark.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = parseGrandHallT554StrictJson(bytes);
  } catch (error) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "JSON_INVALID",
      `${label} is not strict duplicate-free UTF-8 JSON.`,
      error,
    );
  }
  const text = bytes.toString("utf8");
  let canonical: string;
  try {
    canonical = canonicalJsonBytes(parsed);
  } catch (error) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "JSON_INVALID",
      `${label} is outside the bounded canonical JSON domain.`,
      error,
    );
  }
  if (text !== canonical && text !== `${canonical}\n`) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "JSON_NON_CANONICAL",
      `${label} must use canonical JSON with at most one final LF.`,
    );
  }
  return parsed;
}

interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

function parseAcceptedArtifactFile<T>(
  file: StableFileResult,
  label: string,
  schema: RuntimeSchema<T>,
): T {
  if (file.bytes === null) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "JSON_INVALID",
      `${label} bytes were not retained for parsing.`,
    );
  }
  const parsed = parseCanonicalJson(file.bytes, label);
  try {
    return schema.parse(parsed);
  } catch (error) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SCHEMA_INVALID",
      `${label} failed its concrete accepted-artifact schema.`,
      error,
    );
  }
}

async function readAcceptedArtifact<T>(
  root: TrustedRoot,
  relativePath: string,
  label: string,
  schema: RuntimeSchema<T>,
  totals: VerificationTotals,
  snapshots: Map<string, FileSnapshot>,
): Promise<T> {
  const file = await readStableRegularFile(root, relativePath, {
    captureBytes: true,
    maximumByteLength: JSON_FILE_MAX_BYTES,
  });
  captureFileSnapshot(snapshots, relativePath, file);
  recordVerifiedFile(totals, file.byteLength);
  return parseAcceptedArtifactFile(file, label, schema);
}

async function rereadAcceptedArtifactSnapshot<T>(
  root: TrustedRoot,
  relativePath: string,
  label: string,
  schema: RuntimeSchema<T>,
  snapshots: ReadonlyMap<string, FileSnapshot>,
): Promise<T> {
  const snapshot = requireFileSnapshot(snapshots, relativePath);
  const file = await readStableRegularFile(root, relativePath, {
    ...snapshotExpectation(snapshot, true),
    maximumByteLength: JSON_FILE_MAX_BYTES,
  });
  return parseAcceptedArtifactFile(file, label, schema);
}

function validateAcceptedArtifactFiles(files: GrandHallAcceptedScopeArtifactFiles): void {
  const paths: readonly string[] = [
    files.publicationReceipt,
    files.scopeReviewPack,
    files.humanDecisions,
    files.closedVolumeReview,
    files.roomMembership,
    files.portalDecisions,
    files.closedBoundary,
    files.panoramaMaskSet,
    files.reviewedTransform,
    files.outputInventoryMask,
  ];
  if (
    files.publicationReceipt !== "publication-receipt.json" ||
    paths.some((path) => typeof path !== "string") ||
    new Set(paths).size !== paths.length
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "ARGUMENT_INVALID",
      "Each accepted artifact must have one distinct relative JSON path and the canonical receipt path.",
    );
  }
  paths.forEach((path, index) => {
    requireSafeRelativePath(path, `artifactFiles[${String(index)}]`);
    if (!/\.json$/u.test(path)) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "ARGUMENT_INVALID",
        "Accepted artifact paths must use the lowercase .json suffix.",
      );
    }
  });
}

async function readT554Artifacts(
  root: TrustedRoot,
  files: GrandHallAcceptedScopeArtifactFiles,
  totals: VerificationTotals,
  snapshots: Map<string, FileSnapshot>,
): Promise<ParsedT554Artifacts> {
  const read = <T>(path: string, label: string, schema: RuntimeSchema<T>) =>
    readAcceptedArtifact(root, path, label, schema, totals, snapshots);
  const [
    scopeReviewPack,
    humanDecisions,
    closedVolumeReview,
    membership,
    portals,
    boundary,
    panoramaMasks,
    publicationReceipt,
  ] = await Promise.all([
    read(files.scopeReviewPack, "scope review-pack artifact", GrandHallScopeReviewPackV1Schema),
    read(files.humanDecisions, "formal T-554 human decisions", GrandHallT554HumanDecisionsSchema),
    read(files.closedVolumeReview, "formal T-554 closed-volume review", GrandHallT554ClosedVolumeReviewSchema),
    read(files.roomMembership, "room membership artifact", GrandHallRoomMembershipV2Schema),
    read(files.portalDecisions, "portal decision artifact", GrandHallPortalDecisionsV1Schema),
    read(files.closedBoundary, "closed boundary artifact", GrandHallClosedBoundaryV1Schema),
    read(files.panoramaMaskSet, "panorama mask-set artifact", GrandHallPanoramaMaskSetV1Schema),
    read(files.publicationReceipt, "T-554 publication receipt", T554PublicationReceiptSchema),
  ]);
  return {
    scopeReviewPack,
    humanDecisions,
    closedVolumeReview,
    membership,
    portals,
    boundary,
    panoramaMasks,
    publicationReceipt,
  };
}

async function readT557Artifacts(
  root: TrustedRoot,
  files: GrandHallAcceptedScopeArtifactFiles,
  totals: VerificationTotals,
  snapshots: Map<string, FileSnapshot>,
): Promise<ParsedT557Artifacts> {
  const [transform, outputMask] = await Promise.all([
    readAcceptedArtifact(root, files.reviewedTransform, "reviewed transform artifact", GrandHallReviewedTransformV1Schema, totals, snapshots),
    readAcceptedArtifact(root, files.outputInventoryMask, "output inventory-mask artifact", GrandHallOutputInventoryMaskV1Schema, totals, snapshots),
  ]);
  return { transform, outputMask };
}

async function readAcceptedArtifacts(
  root: TrustedRoot,
  files: GrandHallAcceptedScopeArtifactFiles,
  totals: VerificationTotals,
  snapshots: Map<string, FileSnapshot>,
): Promise<ParsedAcceptedArtifacts> {
  validateAcceptedArtifactFiles(files);
  const [t554, t557] = await Promise.all([
    readT554Artifacts(root, files, totals, snapshots),
    readT557Artifacts(root, files, totals, snapshots),
  ]);
  return {
    ...t554,
    ...t557,
  };
}

function assertEqual(left: unknown, right: unknown, message: string): void {
  if (left !== right) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      message,
    );
  }
}

function assertCanonicalEqual(left: unknown, right: unknown, message: string): void {
  if (canonicalJsonBytes(left) !== canonicalJsonBytes(right)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      message,
    );
  }
}

interface FormalReviewDigests {
  readonly humanDecisionsSha256: `sha256:${string}`;
  readonly closedVolumeReviewSha256: `sha256:${string}`;
}

function acceptedHumanReview(
  reviewer: NonNullable<GrandHallT554HumanDecisions["reviewer"]>,
): GrandHallRoomMembershipV2["humanReview"] {
  return {
    state: "human_accepted",
    reviewerId: reviewer.reviewerId,
    reviewerRole: reviewer.reviewerRole,
    reviewedAt: reviewer.reviewedAt,
    knowledgeBasis: reviewer.knowledgeBasis,
    agentDecisionAuthority: reviewer.agentDecisionAuthority,
  };
}

function assertAcceptedReviewLifecycle(artifacts: ParsedAcceptedArtifacts): void {
  const { humanDecisions, closedVolumeReview } = artifacts;
  if (
    humanDecisions.reviewState !== "human_accepted" ||
    humanDecisions.finalDecision !== "ACCEPT" ||
    humanDecisions.reviewer === null ||
    closedVolumeReview.reviewState !== "human_accepted" ||
    closedVolumeReview.finalDecision !== "ACCEPT" ||
    closedVolumeReview.reviewer === null
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      "The preserved T-554 decisions and closed-volume review must both be explicitly human accepted.",
    );
  }
}

function assertMatterPakAndCleanupReviewBindings(
  artifacts: ParsedAcceptedArtifacts,
): void {
  const { scopeReviewPack, humanDecisions } = artifacts;
  const room = humanDecisions.matterPakRoomDecision;
  if (
    room.result !== "ACCEPT_AS_GRAND_HALL" ||
    room.sourceMembershipV1Sha256 !==
      scopeReviewPack.sourceEvidence.t550PendingMembershipV1Sha256 ||
    room.sourceBoundaryEvidenceSha256 !==
      scopeReviewPack.sourceEvidence.t551SourceEvidenceSha256
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      "The preserved MatterPak room decision does not accept exact room 9 against its bound evidence.",
    );
  }
  ["Window", "Mirror"].forEach((artifactClass, index) => {
    const inspection = humanDecisions.cleanupArtifactInspections[index];
    if (
      inspection?.artifactClass !== artifactClass ||
      inspection.result !== "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY" ||
      inspection.sourceBoundaryEvidenceSha256 !==
        scopeReviewPack.sourceEvidence.t551SourceEvidenceSha256
    ) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "CROSS_BINDING_MISMATCH",
        `The preserved ${artifactClass} inspection does not bind accepted source-scope handling.`,
      );
    }
  });
}

function assertPanoramaReviewSourceBindings(artifacts: ParsedAcceptedArtifacts): void {
  const { scopeReviewPack, humanDecisions } = artifacts;
  humanDecisions.panoramaDecisions.forEach((decision, index) => {
    const source = scopeReviewPack.candidatePanoramaSources[index];
    const boundIdentity = source === undefined ? null : {
      sweepNumber: source.sweepNumber,
      sourceJpgFileName: source.fileName,
      sourceJpgSha256: source.sha256,
      sourceJpgByteLength: source.byteLength,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
    };
    const reviewedIdentity = {
      sweepNumber: decision.sweepNumber,
      sourceJpgFileName: decision.sourceJpgFileName,
      sourceJpgSha256: decision.sourceJpgSha256,
      sourceJpgByteLength: decision.sourceJpgByteLength,
      widthPx: decision.widthPx,
      heightPx: decision.heightPx,
    };
    assertCanonicalEqual(
      reviewedIdentity,
      boundIdentity,
      `Preserved panorama decision ${String(index)} does not bind its exact review-pack source.`,
    );
  });
}

function assertNonCandidateReviewBindings(artifacts: ParsedAcceptedArtifacts): void {
  const { scopeReviewPack, humanDecisions } = artifacts;
  const sources = scopeReviewPack.panoramaDirectoryFiles.filter(
    (source) => source.t554Eligibility === "ineligible_unreviewed",
  );
  humanDecisions.nonCandidatePanoramaDecisions.forEach((decision, index) => {
    const source = sources[index];
    const boundIdentity = source === undefined ? null : {
      inventoryIndex: source.inventoryIndex,
      sourceJpgFileName: source.fileName,
      sourceJpgSha256: source.sha256,
      sourceJpgByteLength: source.byteLength,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
      embeddedSweepNumber: source.embeddedSweepNumber,
      result: "EXCLUDE_OUTSIDE_GRAND_HALL",
    };
    assertCanonicalEqual(
      {
        inventoryIndex: decision.inventoryIndex,
        sourceJpgFileName: decision.sourceJpgFileName,
        sourceJpgSha256: decision.sourceJpgSha256,
        sourceJpgByteLength: decision.sourceJpgByteLength,
        widthPx: decision.widthPx,
        heightPx: decision.heightPx,
        embeddedSweepNumber: decision.embeddedSweepNumber,
        result: decision.result,
      },
      boundIdentity,
      `Preserved non-candidate panorama decision ${String(index)} is not the exact reviewed exclusion.`,
    );
  });
}

function assertInterfaceReviewSourceBindings(artifacts: ParsedAcceptedArtifacts): void {
  const { scopeReviewPack, humanDecisions } = artifacts;
  humanDecisions.interfaceDecisions.forEach((decision, index) => {
    const candidate = scopeReviewPack.interfaceCandidates[index];
    const reviewedCandidate = {
      interfaceId: decision.interfaceId,
      grandHallRoomKey: decision.grandHallRoomKey,
      adjacentSourceRoomKey: decision.adjacentSourceRoomKey,
      sharedSourceVertexCount: decision.sharedSourceVertexCount,
      sharedSourceVertexSetSha256: decision.sharedSourceVertexSetSha256,
      boundsMeters: decision.boundsMeters,
    };
    assertCanonicalEqual(
      reviewedCandidate,
      candidate,
      `Preserved interface decision ${String(index)} does not bind its exact topology candidate.`,
    );
  });
}

function assertDecisionEvidenceBindings(
  artifacts: ParsedAcceptedArtifacts,
  decisionsSha256: string,
): void {
  const evidenceDigests = [
    ...artifacts.membership.panoramaRecords.map((record) => record.decisionEvidenceSha256),
    ...artifacts.portals.decisions.map((decision) => decision.grandHallSideEvidenceSha256),
    ...artifacts.boundary.semanticRefinements.map((refinement) => refinement.evidenceSha256),
  ];
  if (!evidenceDigests.every((digest) => digest === decisionsSha256)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      "Membership, interface, and boundary evidence must all bind the exact preserved human-decisions digest.",
    );
  }
}

function assertPanoramaDecisionArtifactBindings(artifacts: ParsedAcceptedArtifacts): void {
  artifacts.humanDecisions.panoramaDecisions.forEach((decision, index) => {
    const membership = artifacts.membership.panoramaRecords[index];
    if (membership === undefined) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "CROSS_BINDING_MISMATCH",
        `Membership is missing reviewed panorama ${String(index)}.`,
      );
    }
    if (decision.result === "INCLUDE") {
      if (
        membership.decision.disposition !== "include_with_binary_pixel_mask" ||
        membership.decision.classification !== decision.classification
      ) {
        throw new GrandHallAcceptedScopeBundleVerificationError(
          "CROSS_BINDING_MISMATCH",
          `Membership does not preserve included panorama decision ${String(index)}.`,
        );
      }
    } else if (membership.decision.disposition !== "exclude_whole_frame") {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "CROSS_BINDING_MISMATCH",
        `Membership does not preserve excluded panorama decision ${String(index)}.`,
      );
    }
  });
}

const INTERFACE_RESOLUTION_BY_REVIEW = {
  CLOSE_AT_REVIEWED_GRAND_HALL_PLANE: "close_at_reviewed_grand_hall_plane",
  EXCLUDE_BEYOND_INTERFACE: "exclude_beyond_interface",
  NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT: "not_a_portal_source_topology_artifact",
} as const;

const BOUNDARY_OPERATION_BY_REVIEW = {
  CLOSE_AT_REVIEWED_GRAND_HALL_PLANE: "retain_grand_hall_side",
  EXCLUDE_BEYOND_INTERFACE: "exclude_beyond_interface",
  NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT: "remove_non_architectural_capture_artifact",
} as const;

function assertInterfaceDecisionArtifactBindings(artifacts: ParsedAcceptedArtifacts): void {
  artifacts.humanDecisions.interfaceDecisions.forEach((review, index) => {
    const portal = artifacts.portals.decisions[index];
    const refinement = artifacts.boundary.semanticRefinements[index];
    if (review.result === "UNSURE" || review.note === null) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "CROSS_BINDING_MISMATCH",
        `Interface ${review.interfaceId} is not a resolved accepted review.`,
      );
    }
    if (
      portal?.interfaceId !== review.interfaceId ||
      portal.resolution !== INTERFACE_RESOLUTION_BY_REVIEW[review.result] ||
      portal.decisionNote !== review.note ||
      refinement?.interfaceId !== review.interfaceId ||
      refinement.operation !== BOUNDARY_OPERATION_BY_REVIEW[review.result]
    ) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "CROSS_BINDING_MISMATCH",
        `Interface artifacts do not preserve exact reviewed decision ${review.interfaceId}.`,
      );
    }
  });
}

function assertFormalReviewerBindings(artifacts: ParsedAcceptedArtifacts): void {
  const decisionsReviewer = artifacts.humanDecisions.reviewer;
  const volumeReviewer = artifacts.closedVolumeReview.reviewer;
  if (decisionsReviewer === null || volumeReviewer === null) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      "Accepted formal reviews must preserve non-null human reviewer identities.",
    );
  }
  const expectedDecisionReview = acceptedHumanReview(decisionsReviewer);
  const expectedVolumeReview = acceptedHumanReview(volumeReviewer);
  assertCanonicalEqual(
    artifacts.membership.humanReview,
    expectedDecisionReview,
    "Membership reviewer differs from the preserved human-decisions reviewer.",
  );
  assertCanonicalEqual(
    artifacts.portals.humanReview,
    expectedDecisionReview,
    "Interface reviewer differs from the preserved human-decisions reviewer.",
  );
  assertCanonicalEqual(
    artifacts.panoramaMasks.humanReview,
    expectedDecisionReview,
    "Mask reviewer differs from the preserved human-decisions reviewer.",
  );
  assertCanonicalEqual(
    artifacts.boundary.humanReview,
    expectedVolumeReview,
    "Boundary reviewer differs from the preserved closed-volume reviewer.",
  );
}

function assertClosedVolumeArtifactBinding(artifacts: ParsedAcceptedArtifacts): void {
  const volume = artifacts.closedVolumeReview;
  const boundary = artifacts.boundary;
  assertCanonicalEqual(
    {
      sourceFrame: boundary.sourceFrame,
      units: boundary.units,
      geometryRole: boundary.geometryRole,
      construction: boundary.construction,
      footprintXY: boundary.footprintXY,
      zMin: boundary.zMin,
      zMax: boundary.zMax,
      rendered: boundary.rendered,
      collisionGeometry: boundary.collisionGeometry,
      exportedAsArchitecture: boundary.exportedAsArchitecture,
      generatedGeometryCreated: boundary.generatedGeometryCreated,
    },
    {
      sourceFrame: volume.sourceFrame,
      units: volume.units,
      geometryRole: volume.geometryRole,
      construction: volume.construction,
      footprintXY: volume.footprintXY,
      zMin: volume.zMin,
      zMax: volume.zMax,
      rendered: volume.rendered,
      collisionGeometry: volume.collisionGeometry,
      exportedAsArchitecture: volume.exportedAsArchitecture,
      generatedGeometryCreated: volume.generatedGeometryCreated,
    },
    "Closed-boundary geometry or truth flags differ from the preserved accepted volume review.",
  );
}

function verifyFormalReviewCoreBindings(
  artifacts: ParsedAcceptedArtifacts,
): FormalReviewDigests {
  assertAcceptedReviewLifecycle(artifacts);
  assertEqual(
    artifacts.humanDecisions.reviewPackSha256,
    artifacts.scopeReviewPack.artifactSha256,
    "Human decisions do not bind the exact preserved T-554 review pack.",
  );
  assertEqual(
    artifacts.closedVolumeReview.reviewPackSha256,
    artifacts.scopeReviewPack.artifactSha256,
    "Closed-volume review does not bind the exact preserved T-554 review pack.",
  );
  assertMatterPakAndCleanupReviewBindings(artifacts);
  assertPanoramaReviewSourceBindings(artifacts);
  assertNonCandidateReviewBindings(artifacts);
  assertInterfaceReviewSourceBindings(artifacts);
  const humanDecisionsSha256 = computeGrandHallT554HumanDecisionsSha256(
    artifacts.humanDecisions,
  );
  const closedVolumeReviewSha256 = computeGrandHallT554ClosedVolumeReviewSha256(
    artifacts.closedVolumeReview,
  );
  assertDecisionEvidenceBindings(artifacts, humanDecisionsSha256);
  assertPanoramaDecisionArtifactBindings(artifacts);
  assertInterfaceDecisionArtifactBindings(artifacts);
  assertFormalReviewerBindings(artifacts);
  assertClosedVolumeArtifactBinding(artifacts);
  return { humanDecisionsSha256, closedVolumeReviewSha256 };
}

function verifyFormalMaskReviewBindings(artifacts: ParsedAcceptedArtifacts): void {
  artifacts.humanDecisions.panoramaDecisions.forEach((decision, index) => {
    const maskRecord = artifacts.panoramaMasks.sourceRecords[index];
    if (decision.result === "EXCLUDE") {
      if (maskRecord?.disposition !== "exclude_whole_frame") {
        throw new GrandHallAcceptedScopeBundleVerificationError(
          "CROSS_BINDING_MISMATCH",
          `Mask artifact does not preserve whole-frame exclusion ${String(index)}.`,
        );
      }
      return;
    }
    if (
      decision.result !== "INCLUDE" ||
      decision.maskFileName === null ||
      decision.reviewedMaskBinding === null ||
      !decision.maskReviewed ||
      maskRecord?.disposition !== "include_with_binary_pixel_mask"
    ) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "CROSS_BINDING_MISMATCH",
        `Mask artifact cannot prove accepted mask review ${String(index)}.`,
      );
    }
    const binding = decision.reviewedMaskBinding;
    const mask = maskRecord.mask;
    if (
      mask.fileName !== decision.maskFileName ||
      mask.sha256 !== binding.sha256 ||
      mask.byteLength !== binding.byteLength ||
      mask.includedPixelCount !== binding.includedPixelCount ||
      mask.excludedPixelCount !== binding.excludedPixelCount
    ) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "CROSS_BINDING_MISMATCH",
        `Mask artifact differs from the exact bytes and counts reviewed for panorama ${String(index)}.`,
      );
    }
    assertCanonicalEqual(
      mask.reasonCodes,
      decision.maskReasonCodes,
      `Mask reasons differ from the preserved review for panorama ${String(index)}.`,
    );
  });
}

function assertSharedReviewPackBindings(artifacts: ParsedAcceptedArtifacts): void {
  const reviewPackSha256 = artifacts.scopeReviewPack.artifactSha256;
  for (const [value, label] of [
    [artifacts.membership.reviewPackSha256, "room membership"],
    [artifacts.portals.reviewPackSha256, "portal decisions"],
    [artifacts.boundary.reviewPackSha256, "closed boundary"],
    [artifacts.panoramaMasks.reviewPackSha256, "panorama masks"],
    [artifacts.transform.scopeReviewPackSha256, "reviewed transform"],
    [artifacts.outputMask.scopeReviewPackSha256, "output inventory mask"],
  ] as const) {
    assertEqual(value, reviewPackSha256, `${label} does not bind the same T-554 review pack.`);
  }
}

function assertMembershipSourceBindings(artifacts: ParsedAcceptedArtifacts): void {
  const { scopeReviewPack, membership, panoramaMasks } = artifacts;
  assertEqual(
    membership.sourceMembershipV1Sha256,
    scopeReviewPack.sourceEvidence.t550PendingMembershipV1Sha256,
    "Accepted membership does not bind the T-550 membership candidate named by the T-554 review pack.",
  );
  assertEqual(
    membership.sourceBoundaryEvidenceSha256,
    scopeReviewPack.sourceEvidence.t551SourceEvidenceSha256,
    "Accepted membership does not bind the T-551 boundary evidence named by the T-554 review pack.",
  );
  assertEqual(
    membership.sourcePanoramaInventorySha256,
    scopeReviewPack.panoramaSourceInventorySha256,
    "Accepted membership does not bind the panorama inventory named by the T-554 review pack.",
  );
  assertCanonicalEqual(
    membership.panoramaRecords.map((record) => record.source),
    scopeReviewPack.candidatePanoramaSources,
    "Accepted membership sources do not exactly match the T-554 candidate panorama sources.",
  );
  assertEqual(
    membership.geometricCameraAuthority,
    "none",
    "Accepted panorama membership cannot establish geometric camera authority.",
  );
  assertEqual(
    panoramaMasks.geometricCameraAuthority,
    "none",
    "Accepted panorama masks cannot establish geometric camera authority.",
  );
}

function assertPortalAndTransformSourceBindings(artifacts: ParsedAcceptedArtifacts): void {
  const { scopeReviewPack, portals, transform } = artifacts;
  assertEqual(
    portals.sourceBoundaryEvidenceSha256,
    scopeReviewPack.sourceEvidence.t551SourceEvidenceSha256,
    "Portal decisions do not bind the T-551 boundary evidence named by the T-554 review pack.",
  );
  assertEqual(
    portals.interfaceInventorySha256,
    scopeReviewPack.interfaceInventorySha256,
    "Portal decisions do not bind the interface inventory named by the T-554 review pack.",
  );
  assertCanonicalEqual(
    portals.interfaceCandidates,
    scopeReviewPack.interfaceCandidates,
    "Portal candidates do not exactly match the T-554 interface candidates.",
  );
  assertEqual(
    transform.targetBoundaryEvidenceSha256,
    scopeReviewPack.sourceEvidence.t551SourceEvidenceSha256,
    "Reviewed transform does not bind the T-551 boundary evidence named by the T-554 review pack.",
  );
  assertEqual(
    transform.sourceXgridsReceiptSha256,
    scopeReviewPack.sourceEvidence.xgridsSourceReceiptSha256,
    "Reviewed transform does not bind the raw XGRIDS receipt named by the T-554 review pack.",
  );
  assertEqual(
    transform.targetMatterPakE57ReceiptSha256,
    scopeReviewPack.sourceEvidence.matterPakE57SourceReceiptSha256,
    "Reviewed transform does not bind the MatterPak E57 receipt named by the T-554 review pack.",
  );
}

function assertAcceptedT554ArtifactLinks(artifacts: ParsedAcceptedArtifacts): void {
  const { membership, portals, boundary, panoramaMasks } = artifacts;
  assertEqual(
    boundary.roomMembershipArtifactSha256,
    membership.artifactSha256,
    "Closed boundary does not bind the exact accepted membership artifact.",
  );
  assertEqual(
    panoramaMasks.membershipArtifactSha256,
    membership.artifactSha256,
    "Panorama masks do not bind the exact accepted membership artifact.",
  );
  assertEqual(
    boundary.portalDecisionArtifactSha256,
    portals.artifactSha256,
    "Closed boundary does not bind the exact portal-decision artifact.",
  );
  assertEqual(
    panoramaMasks.portalDecisionArtifactSha256,
    portals.artifactSha256,
    "Panorama masks do not bind the exact portal-decision artifact.",
  );
  assertEqual(
    boundary.portalInterfaceInventorySha256,
    portals.interfaceInventorySha256,
    "Closed boundary and portal decisions do not bind the same interface inventory.",
  );
  assertCanonicalEqual(
    boundary.portalInterfaceIds,
    portals.interfaceCandidates.map((candidate) => candidate.interfaceId),
    "Closed boundary interface IDs do not exactly match the portal candidate inventory.",
  );
}

function assertBoundaryPortalOperations(artifacts: ParsedAcceptedArtifacts): void {
  const { boundary, portals } = artifacts;
  const boundaryOperationByPortalResolution = {
    close_at_reviewed_grand_hall_plane: "retain_grand_hall_side",
    exclude_beyond_interface: "exclude_beyond_interface",
    not_a_portal_source_topology_artifact: "remove_non_architectural_capture_artifact",
  } as const;
  portals.decisions.forEach((decision, index) => {
    const refinement = boundary.semanticRefinements[index];
    if (
      refinement === undefined ||
      refinement.interfaceId !== decision.interfaceId ||
      refinement.operation !== boundaryOperationByPortalResolution[decision.resolution]
    ) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "CROSS_BINDING_MISMATCH",
        `Boundary operation for interface ${decision.interfaceId} contradicts its accepted portal resolution.`,
      );
    }
  });
}

function assertT557ArtifactLinks(artifacts: ParsedAcceptedArtifacts): void {
  const { membership, panoramaMasks, transform, outputMask, boundary } = artifacts;
  assertEqual(
    panoramaMasks.sourcePanoramaInventorySha256,
    membership.sourcePanoramaInventorySha256,
    "Panorama masks and membership do not bind the same ordered panorama inventory.",
  );
  assertEqual(
    outputMask.transformArtifactSha256,
    transform.artifactSha256,
    "Output inventory mask does not bind the exact reviewed transform artifact.",
  );
  assertEqual(
    outputMask.closedBoundaryArtifactSha256,
    boundary.artifactSha256,
    "Output inventory mask does not bind the exact accepted closed boundary.",
  );
  assertEqual(
    outputMask.xgridsSourceReceiptSha256,
    transform.sourceXgridsReceiptSha256,
    "Output inventory mask and transform do not bind the same XGRIDS source receipt.",
  );
  assertEqual(
    outputMask.xgridsOutputInventorySha256,
    transform.sourceXgridsOutputInventorySha256,
    "Output inventory mask and transform do not bind the same XGRIDS output inventory.",
  );
}

function assertPanoramaArtifactRecordBindings(artifacts: ParsedAcceptedArtifacts): void {
  const { membership, panoramaMasks } = artifacts;
  membership.panoramaRecords.forEach((membershipRecord, index) => {
    const maskRecord = panoramaMasks.sourceRecords[index];
    if (maskRecord === undefined) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "CROSS_BINDING_MISMATCH",
        `Panorama mask set is missing source record ${String(index)}.`,
      );
    }
    assertCanonicalEqual(
      maskRecord.source,
      membershipRecord.source,
      `Panorama source ${String(index)} differs between membership and mask artifacts.`,
    );
    assertEqual(
      maskRecord.disposition,
      membershipRecord.decision.disposition,
      `Panorama disposition ${String(index)} differs between membership and mask artifacts.`,
    );
  });
}

function assertDistinctMaskAndBitsetPaths(artifacts: ParsedAcceptedArtifacts): void {
  const { panoramaMasks, outputMask } = artifacts;
  const maskPaths = panoramaMasks.sourceRecords.flatMap((record) =>
    record.disposition === "include_with_binary_pixel_mask" ? [record.mask.fileName] : [],
  );
  if (new Set(maskPaths).size !== maskPaths.length) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      "Each included panorama must bind one distinct mask PNG file.",
    );
  }
  if (maskPaths.includes(outputMask.bitsetFileName)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      "The record bitset and panorama masks must use distinct bundle files.",
    );
  }
}

function verifyArtifactCrossBindings(artifacts: ParsedAcceptedArtifacts): void {
  assertSharedReviewPackBindings(artifacts);
  assertMembershipSourceBindings(artifacts);
  assertPortalAndTransformSourceBindings(artifacts);
  assertAcceptedT554ArtifactLinks(artifacts);
  assertBoundaryPortalOperations(artifacts);
  assertT557ArtifactLinks(artifacts);
  assertPanoramaArtifactRecordBindings(artifacts);
  assertDistinctMaskAndBitsetPaths(artifacts);
}

async function verifySourceJpeg(bytes: Buffer, label: string): Promise<void> {
  try {
    await validateGrandHallT554SourceJpegBytes(bytes);
  } catch (error) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SOURCE_JPEG_INVALID",
      `${label} is not an exact unrotated 8,192 x 4,096 RGB JPEG source.`,
      error,
    );
  }
}

function expectedPanoramaInventory(reviewPack: GrandHallScopeReviewPackV1): readonly string[] {
  return reviewPack.panoramaDirectoryFiles
    .map((source) => source.fileName)
    .sort((left, right) => left.localeCompare(right));
}

async function assertExactRootInventory(
  root: TrustedRoot,
  expectedInventory: readonly string[],
  message: string,
): Promise<void> {
  const actual = await inventoryRegularFiles(root);
  if (!sameStringArray(actual, expectedInventory)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SOURCE_INVENTORY_DRIFT",
      message,
    );
  }
}

async function verifyInitialPanoramaSource(
  root: TrustedRoot,
  source: GrandHallScopeReviewPackV1["panoramaDirectoryFiles"][number],
  snapshots: Map<string, FileSnapshot>,
  totals: VerificationTotals,
  decodedIdentities: Set<string>,
): Promise<void> {
  const file = await readStableRegularFile(root, source.fileName, {
    captureBytes: true,
    maximumByteLength: GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
    expectedByteLength: source.byteLength,
    expectedSha256: source.sha256,
  });
  captureFileSnapshot(snapshots, source.fileName, file);
  recordVerifiedFile(totals, file.byteLength);
  if (file.bytes === null) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SOURCE_JPEG_INVALID",
      `Source panorama ${source.fileName} was not retained for decode verification.`,
    );
  }
  if (!decodedIdentities.has(file.sha256)) {
    await verifySourceJpeg(file.bytes, `Source panorama ${source.fileName}`);
    decodedIdentities.add(file.sha256);
  }
}

async function verifyPanoramaSources(
  root: TrustedRoot,
  reviewPack: GrandHallScopeReviewPackV1,
  totals: VerificationTotals,
  snapshots: Map<string, FileSnapshot>,
): Promise<void> {
  const expectedInventory = expectedPanoramaInventory(reviewPack);
  await assertExactRootInventory(
    root, expectedInventory, "The panorama root does not contain exactly the 148 review-pack files.",
  );
  const decodedIdentities = new Set<string>();
  for (const source of reviewPack.panoramaDirectoryFiles) {
    await verifyInitialPanoramaSource(root, source, snapshots, totals, decodedIdentities);
  }
  await assertExactRootInventory(
    root, expectedInventory, "The panorama root changed during complete 148-file verification.",
  );
}

async function reverifyPanoramaSourceSnapshot(
  root: TrustedRoot,
  source: GrandHallScopeReviewPackV1["panoramaDirectoryFiles"][number],
  snapshots: ReadonlyMap<string, FileSnapshot>,
): Promise<void> {
  const snapshot = requireFileSnapshot(snapshots, source.fileName);
  if (snapshot.byteLength !== source.byteLength || snapshot.sha256 !== source.sha256) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      `Panorama ${source.fileName} snapshot does not match its review-pack content identity.`,
    );
  }
  await readStableRegularFile(root, source.fileName, {
    ...snapshotExpectation(snapshot, false),
    maximumByteLength: GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
  });
}

async function reverifyPanoramaSnapshot(
  root: TrustedRoot,
  reviewPack: GrandHallScopeReviewPackV1,
  snapshots: ReadonlyMap<string, FileSnapshot>,
): Promise<void> {
  const expectedInventory = expectedPanoramaInventory(reviewPack);
  await assertExactRootInventory(root, expectedInventory, "Panorama snapshot inventory drifted.");
  for (const source of reviewPack.panoramaDirectoryFiles) {
    await reverifyPanoramaSourceSnapshot(root, source, snapshots);
  }
  await assertExactRootInventory(root, expectedInventory, "Panorama snapshot changed on re-read.");
}

async function verifyPanoramaMasks(
  root: TrustedRoot,
  maskSet: GrandHallPanoramaMaskSetV1,
  totals: VerificationTotals,
  snapshots: Map<string, FileSnapshot>,
): Promise<void> {
  for (const record of maskSet.sourceRecords) {
    if (record.disposition !== "include_with_binary_pixel_mask") continue;
    const mask = record.mask;
    const file = await readStableRegularFile(root, mask.fileName, {
      captureBytes: true,
      maximumByteLength: GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
      expectedByteLength: mask.byteLength,
      expectedSha256: mask.sha256,
    });
    captureFileSnapshot(snapshots, mask.fileName, file);
    recordVerifiedFile(totals, file.byteLength);
    if (file.bytes === null) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "MASK_PNG_INVALID",
        `Mask ${mask.fileName} was not retained for full decode verification.`,
      );
    }
    try {
      const counts = await validateGrandHallT554MaskPngBytes(file.bytes);
      if (
        counts.includedPixelCount !== mask.includedPixelCount ||
        counts.excludedPixelCount !== mask.excludedPixelCount
      ) {
        throw new Error("decoded mask counts differ from the accepted artifact");
      }
    } catch (error) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "MASK_PNG_INVALID",
        `Mask ${mask.fileName} failed exact binary source-grid verification.`,
        error,
      );
    }
  }
}

async function assertInventoryDirectory(
  root: TrustedRoot,
  absoluteDirectory: string,
): Promise<void> {
  const stats = await lstat(absoluteDirectory, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      stats.isSymbolicLink() ? "PATH_LINK" : "PATH_NON_REGULAR",
      `${root.label} inventory contains a linked or non-directory container.`,
    );
  }
  const canonicalDirectory = await realpath(absoluteDirectory);
  if (
    !pathIsWithin(root.canonicalPath, canonicalDirectory) ||
    comparablePath(canonicalDirectory) !== comparablePath(absoluteDirectory)
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_ESCAPE",
      `${root.label} inventory escaped its trusted root or traversed an alias.`,
    );
  }
  if (
    absoluteDirectory === root.logicalPath &&
    !sameIdentity(root.identity, identity(stats))
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_IDENTITY_CHANGED",
      `${root.label} root identity changed during verification.`,
    );
  }
}

async function inventoryDirectoryEntry(
  root: TrustedRoot,
  discovered: string[],
  absoluteDirectory: string,
  relativeDirectory: string,
  entry: Dirent,
): Promise<void> {
  const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
  requireSafeRelativePath(relativePath, `${root.label} inventory entry`);
  const absolutePath = resolve(absoluteDirectory, entry.name);
  const stats = await lstat(absolutePath, { bigint: true });
  if (entry.isSymbolicLink() || stats.isSymbolicLink()) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_LINK",
      `${root.label} inventory entry ${relativePath} is a link or reparse point.`,
    );
  }
  if (entry.isDirectory() && stats.isDirectory()) {
    await inventoryDirectory(root, discovered, absolutePath, relativePath);
    return;
  }
  if (entry.isFile() && stats.isFile() && stats.nlink === 1n) {
    discovered.push(relativePath);
    return;
  }
  const code = entry.isFile() && stats.isFile() ? "PATH_LINK" : "PATH_NON_REGULAR";
  throw new GrandHallAcceptedScopeBundleVerificationError(
    code,
    `${root.label} inventory entry ${relativePath} is not a direct single-link file or directory.`,
  );
}

async function inventoryDirectory(
  root: TrustedRoot,
  discovered: string[],
  absoluteDirectory: string,
  relativeDirectory: string,
): Promise<void> {
  await assertInventoryDirectory(root, absoluteDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    await inventoryDirectoryEntry(root, discovered, absoluteDirectory, relativeDirectory, entry);
  }
}

async function inventoryRegularFiles(root: TrustedRoot): Promise<readonly string[]> {
  const discovered: string[] = [];
  await inventoryDirectory(root, discovered, root.logicalPath, "");
  return discovered.sort((left, right) => left.localeCompare(right));
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function expectedT554ReceiptPayloads(
  files: GrandHallAcceptedScopeArtifactFiles,
  artifacts: ParsedAcceptedArtifacts,
): readonly string[] {
  const maskFiles = artifacts.panoramaMasks.sourceRecords.flatMap((record) =>
    record.disposition === "include_with_binary_pixel_mask" ? [record.mask.fileName] : [],
  );
  return [
    files.scopeReviewPack,
    files.humanDecisions,
    files.closedVolumeReview,
    files.roomMembership,
    files.portalDecisions,
    files.closedBoundary,
    files.panoramaMaskSet,
    ...maskFiles,
  ].sort((left, right) => left.localeCompare(right));
}

function assertPublicationReceiptBindings(
  artifacts: ParsedAcceptedArtifacts,
  files: GrandHallAcceptedScopeArtifactFiles,
  formalDigests: FormalReviewDigests,
): void {
  const receipt = artifacts.publicationReceipt;
  assertEqual(receipt.reviewPackSha256, artifacts.scopeReviewPack.artifactSha256,
    "Publication receipt does not bind the exact T-554 review pack.");
  assertEqual(receipt.humanDecisionsSha256, formalDigests.humanDecisionsSha256,
    "Publication receipt does not bind the complete formal human decisions.");
  assertEqual(receipt.closedVolumeReviewSha256, formalDigests.closedVolumeReviewSha256,
    "Publication receipt does not bind the complete closed-volume review.");
  assertCanonicalEqual(receipt.artifactSha256s, {
    roomMembership: artifacts.membership.artifactSha256,
    interfaceDecisions: artifacts.portals.artifactSha256,
    closedBoundary: artifacts.boundary.artifactSha256,
    panoramaMaskSet: artifacts.panoramaMasks.artifactSha256,
  }, "Publication receipt artifact digests differ from the accepted T-554 payloads.");
  const receivedFiles = receipt.files.map((entry) => entry.fileName);
  if (!sameStringArray(receivedFiles, expectedT554ReceiptPayloads(files, artifacts))) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      "Publication receipt does not enumerate every and only T-554 payload file.",
    );
  }
}

async function verifyPublicationReceiptFiles(
  root: TrustedRoot,
  receipt: T554PublicationReceipt,
  snapshots: ReadonlyMap<string, FileSnapshot>,
): Promise<void> {
  for (const expected of receipt.files) {
    const snapshot = requireFileSnapshot(snapshots, expected.fileName);
    if (snapshot.byteLength !== expected.byteLength) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "FILE_SIZE_MISMATCH",
        `Initial payload ${expected.fileName} differs from its publication receipt length.`,
      );
    }
    if (snapshot.sha256 !== expected.sha256) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "FILE_DIGEST_MISMATCH",
        `Initial payload ${expected.fileName} differs from its publication receipt digest.`,
      );
    }
    await readStableRegularFile(root, expected.fileName, {
      captureBytes: false,
      expectedByteLength: expected.byteLength,
      expectedSha256: expected.sha256,
      expectedIdentity: snapshot.identity,
    });
  }
}

function expectedBundleInventory(
  files: GrandHallAcceptedScopeArtifactFiles,
  artifacts: ParsedAcceptedArtifacts,
): readonly string[] {
  const names = [
    ...artifacts.publicationReceipt.files.map((entry) => entry.fileName),
    files.publicationReceipt,
    files.reviewedTransform,
    files.outputInventoryMask,
    artifacts.outputMask.bitsetFileName,
  ];
  if (new Set(names).size !== names.length) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      "T-554 receipt payloads, T-557 artifacts, and the output bitset must be distinct files.",
    );
  }
  return names.sort((left, right) => left.localeCompare(right));
}

async function verifyExactBundleInventory(
  root: TrustedRoot,
  expected: readonly string[],
): Promise<void> {
  const actual = await inventoryRegularFiles(root);
  if (!sameStringArray(actual, expected)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SOURCE_INVENTORY_DRIFT",
      "The accepted bundle contains missing or undeclared files.",
    );
  }
}

function parseSourceMemberInspection(
  value: unknown,
  member: GrandHallOutputSourceMember,
  expectedRecordKind: "point" | "gaussian",
): GrandHallXgridsSourceMemberInspectionResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SOURCE_MEMBER_INVALID",
      `Format inspector returned no bounded result for ${member.fileName}.`,
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    !sameStringArray(keys, ["recordCount", "recordKind", "recordOrder"]) ||
    (record.recordKind !== "point" && record.recordKind !== "gaussian") ||
    typeof record.recordCount !== "number" ||
    !Number.isSafeInteger(record.recordCount) ||
    record.recordCount <= 0 ||
    record.recordOrder !== "native_file_order"
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SOURCE_MEMBER_INVALID",
      `Format inspector returned an invalid record inventory for ${member.fileName}.`,
    );
  }
  if (record.recordKind !== expectedRecordKind || record.recordCount !== member.recordCount) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SOURCE_MEMBER_INVALID",
      `Decoded record kind/count for ${member.fileName} differs from the accepted ordered inventory.`,
    );
  }
  return {
    recordKind: record.recordKind,
    recordCount: record.recordCount,
    recordOrder: record.recordOrder,
  };
}

async function verifyXgridsSourceMembers(
  root: TrustedRoot,
  outputMask: GrandHallOutputInventoryMaskV1,
  createInspector: GrandHallXgridsSourceMemberInspectorFactory,
  totals: VerificationTotals,
  snapshots: Map<string, FileSnapshot>,
): Promise<void> {
  const expectedInventory = outputMask.sourceMembers
    .map((member) => member.fileName)
    .sort((left, right) => left.localeCompare(right));
  await assertExactRootInventory(
    root, expectedInventory, "The XGRIDS root is not the exact accepted source-member inventory.",
  );
  for (const member of outputMask.sourceMembers) {
    const inspector = createInspector(Object.freeze({ ...member }));
    const file = await readStableRegularFile(root, member.fileName, {
      captureBytes: false,
      expectedByteLength: member.byteLength,
      expectedSha256: member.sha256,
      onChunk: (bytes, offset) => inspector.update(bytes, offset),
    });
    captureFileSnapshot(snapshots, member.fileName, file);
    recordVerifiedFile(totals, file.byteLength);
    parseSourceMemberInspection(await inspector.finish(), member, outputMask.recordKind);
  }
  await assertExactRootInventory(
    root, expectedInventory, "The XGRIDS source-member inventory changed during verification.",
  );
}

async function reverifyXgridsMemberSnapshot(
  root: TrustedRoot,
  member: GrandHallOutputSourceMember,
  snapshots: ReadonlyMap<string, FileSnapshot>,
): Promise<void> {
  const snapshot = requireFileSnapshot(snapshots, member.fileName);
  if (snapshot.byteLength !== member.byteLength || snapshot.sha256 !== member.sha256) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      `XGRIDS member ${member.fileName} snapshot does not match its accepted content identity.`,
    );
  }
  await readStableRegularFile(root, member.fileName, snapshotExpectation(snapshot, false));
}

async function reverifyXgridsSnapshot(
  root: TrustedRoot,
  outputMask: GrandHallOutputInventoryMaskV1,
  snapshots: ReadonlyMap<string, FileSnapshot>,
): Promise<void> {
  const expectedInventory = outputMask.sourceMembers
    .map((member) => member.fileName)
    .sort((left, right) => left.localeCompare(right));
  await assertExactRootInventory(root, expectedInventory, "XGRIDS snapshot inventory drifted.");
  for (const member of outputMask.sourceMembers) {
    await reverifyXgridsMemberSnapshot(root, member, snapshots);
  }
  await assertExactRootInventory(root, expectedInventory, "XGRIDS snapshot changed on re-read.");
}

const POPCOUNT = Uint8Array.from({ length: 256 }, (_, value) => {
  let remaining = value;
  let count = 0;
  while (remaining > 0) {
    count += remaining & 1;
    remaining >>>= 1;
  }
  return count;
});

function assertOutputBitsetCounts(
  outputMask: GrandHallOutputInventoryMaskV1,
  population: number,
  finalByte: number,
): void {
  const validFinalBits = outputMask.totalRecordCount % 8;
  if (validFinalBits !== 0) {
    const paddingMask = (0xff << validFinalBits) & 0xff;
    if ((finalByte & paddingMask) !== 0) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "BITSET_INVALID",
        "Output membership bitset has nonzero trailing padding bits.",
      );
    }
  }
  if (
    population !== outputMask.includedRecordCount ||
    outputMask.totalRecordCount - population !== outputMask.excludedRecordCount
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "BITSET_INVALID",
      "Output membership bitset population does not match the accepted included/excluded counts.",
    );
  }
}

async function readAndVerifyOutputBitset(
  root: TrustedRoot,
  outputMask: GrandHallOutputInventoryMaskV1,
  expectation: StableFileExpectation,
): Promise<StableFileResult> {
  let population = 0;
  let finalByte = 0;
  const file = await readStableRegularFile(root, outputMask.bitsetFileName, {
    ...expectation,
    onChunk: (chunk, absoluteOffset) => {
      for (let index = 0; index < chunk.length; index += 1) {
        const value = chunk[index] ?? 0;
        population += POPCOUNT[value] ?? 0;
        if (absoluteOffset + index === outputMask.bitsetByteLength - 1) finalByte = value;
      }
    },
  });
  assertOutputBitsetCounts(outputMask, population, finalByte);
  return file;
}

async function verifyOutputBitset(
  root: TrustedRoot,
  outputMask: GrandHallOutputInventoryMaskV1,
  totals: VerificationTotals,
  snapshots: Map<string, FileSnapshot>,
): Promise<void> {
  const file = await readAndVerifyOutputBitset(root, outputMask, {
    captureBytes: false,
    expectedByteLength: outputMask.bitsetByteLength,
    expectedSha256: outputMask.bitsetSha256,
  });
  captureFileSnapshot(snapshots, outputMask.bitsetFileName, file);
  recordVerifiedFile(totals, file.byteLength);
}

async function reverifyOutputBitsetSnapshot(
  root: TrustedRoot,
  outputMask: GrandHallOutputInventoryMaskV1,
  snapshots: ReadonlyMap<string, FileSnapshot>,
): Promise<void> {
  const snapshot = requireFileSnapshot(snapshots, outputMask.bitsetFileName);
  if (
    snapshot.byteLength !== outputMask.bitsetByteLength ||
    snapshot.sha256 !== outputMask.bitsetSha256
  ) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "CROSS_BINDING_MISMATCH",
      "Output bitset snapshot does not match its accepted content identity.",
    );
  }
  await readAndVerifyOutputBitset(root, outputMask, snapshotExpectation(snapshot, false));
}

function assertSha256Fields(artifacts: ParsedAcceptedArtifacts): void {
  const values = [
    artifacts.scopeReviewPack.artifactSha256,
    artifacts.membership.artifactSha256,
    artifacts.portals.artifactSha256,
    artifacts.boundary.artifactSha256,
    artifacts.panoramaMasks.artifactSha256,
    artifacts.transform.artifactSha256,
    artifacts.outputMask.artifactSha256,
  ];
  if (!values.every((value) => SHA256_PREFIXED_PATTERN.test(value))) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SCHEMA_INVALID",
      "Accepted artifact digest fields are not canonical SHA-256 identities.",
    );
  }
}

async function rereadLateJsonArtifacts(
  root: TrustedRoot,
  files: GrandHallAcceptedScopeArtifactFiles,
  initial: ParsedAcceptedArtifacts,
  snapshots: ReadonlyMap<string, FileSnapshot>,
): Promise<ParsedAcceptedArtifacts> {
  const [publicationReceipt, transform, outputMask] = await Promise.all([
    rereadAcceptedArtifactSnapshot(
      root, files.publicationReceipt, "late T-554 publication receipt",
      T554PublicationReceiptSchema, snapshots,
    ),
    rereadAcceptedArtifactSnapshot(
      root, files.reviewedTransform, "late reviewed transform artifact",
      GrandHallReviewedTransformV1Schema, snapshots,
    ),
    rereadAcceptedArtifactSnapshot(
      root, files.outputInventoryMask, "late output inventory-mask artifact",
      GrandHallOutputInventoryMaskV1Schema, snapshots,
    ),
  ]);
  assertCanonicalEqual(publicationReceipt, initial.publicationReceipt,
    "Publication receipt content changed after its initial parse.");
  assertCanonicalEqual(transform, initial.transform,
    "Reviewed transform content changed after its initial parse.");
  assertCanonicalEqual(outputMask, initial.outputMask,
    "Output inventory-mask content changed after its initial parse.");
  return { ...initial, publicationReceipt, transform, outputMask };
}

async function verifyEndOfRunSnapshot(
  roots: readonly [TrustedRoot, TrustedRoot, TrustedRoot],
  files: GrandHallAcceptedScopeArtifactFiles,
  artifacts: ParsedAcceptedArtifacts,
  formalDigests: FormalReviewDigests,
  snapshots: VerificationSnapshot,
  bundleInventory: readonly string[],
): Promise<void> {
  const [bundleRoot, panoramaRoot, xgridsRoot] = roots;
  await reverifyPanoramaSnapshot(
    panoramaRoot, artifacts.scopeReviewPack, snapshots.panoramaFiles,
  );
  await reverifyXgridsSnapshot(xgridsRoot, artifacts.outputMask, snapshots.xgridsFiles);
  await reverifyOutputBitsetSnapshot(bundleRoot, artifacts.outputMask, snapshots.bundleFiles);
  await verifyPublicationReceiptFiles(
    bundleRoot, artifacts.publicationReceipt, snapshots.bundleFiles,
  );
  const lateArtifacts = await rereadLateJsonArtifacts(
    bundleRoot, files, artifacts, snapshots.bundleFiles,
  );
  assertSha256Fields(lateArtifacts);
  verifyArtifactCrossBindings(lateArtifacts);
  assertPublicationReceiptBindings(lateArtifacts, files, formalDigests);
  await verifyExactBundleInventory(bundleRoot, bundleInventory);
}

function buildVerificationResult(
  artifacts: ParsedAcceptedArtifacts,
  formalReviewDigests: FormalReviewDigests,
  totals: VerificationTotals,
): GrandHallAcceptedScopeBundleVerificationResult {
  return Object.freeze({
    verifierVersion: GRAND_HALL_ACCEPTED_SCOPE_BUNDLE_VERIFIER_VERSION,
    integrityVerified: true,
    sourceRecordStructureVerified: true,
    productionTrustActivated: false,
    runtimeAdmissionAuthorized: false,
    semanticAccuracyReReviewed: false,
    reviewPackSha256: artifacts.scopeReviewPack.artifactSha256,
    humanDecisionsSha256: formalReviewDigests.humanDecisionsSha256,
    closedVolumeReviewSha256: formalReviewDigests.closedVolumeReviewSha256,
    artifactSha256s: Object.freeze({
      scopeReviewPack: artifacts.scopeReviewPack.artifactSha256,
      roomMembership: artifacts.membership.artifactSha256,
      portalDecisions: artifacts.portals.artifactSha256,
      closedBoundary: artifacts.boundary.artifactSha256,
      panoramaMaskSet: artifacts.panoramaMasks.artifactSha256,
      reviewedTransform: artifacts.transform.artifactSha256,
      outputInventoryMask: artifacts.outputMask.artifactSha256,
    }),
    panoramaSourceCount: artifacts.scopeReviewPack.panoramaDirectoryFiles.length,
    panoramaMaskCount: artifacts.panoramaMasks.maskCount,
    xgridsSourceMemberCount: artifacts.outputMask.sourceMembers.length,
    outputRecordCount: artifacts.outputMask.totalRecordCount,
    includedRecordCount: artifacts.outputMask.includedRecordCount,
    excludedRecordCount: artifacts.outputMask.excludedRecordCount,
    verifiedFileCount: totals.fileCount,
    verifiedByteCount: totals.byteCount,
  });
}

/**
 * Verifies byte integrity and cross-binding of a future human-accepted Grand Hall scope bundle.
 * This function does not perform the human semantic review, sign the bundle, or activate any
 * production trust root. A caller must require its success in addition to signature/trust policy.
 */
export async function verifyGrandHallAcceptedScopeBundle(
  options: VerifyGrandHallAcceptedScopeBundleOptions,
): Promise<GrandHallAcceptedScopeBundleVerificationResult> {
  const [bundleRoot, panoramaSourceRoot, xgridsOutputRoot] = await Promise.all([
    createTrustedRoot(options.bundleRoot, "bundleRoot"),
    createTrustedRoot(options.panoramaSourceRoot, "panoramaSourceRoot"),
    createTrustedRoot(options.xgridsOutputRoot, "xgridsOutputRoot"),
  ]);
  assertDisjointRoots([bundleRoot, panoramaSourceRoot, xgridsOutputRoot]);
  const totals: VerificationTotals = { fileCount: 0, byteCount: 0 };
  const snapshots = createVerificationSnapshot();
  const artifacts = await readAcceptedArtifacts(
    bundleRoot, options.artifactFiles, totals, snapshots.bundleFiles,
  );
  assertSha256Fields(artifacts);
  verifyArtifactCrossBindings(artifacts);
  const formalReviewDigests = verifyFormalReviewCoreBindings(artifacts);
  const bundleInventory = expectedBundleInventory(options.artifactFiles, artifacts);
  await verifyExactBundleInventory(bundleRoot, bundleInventory);
  await verifyPanoramaSources(
    panoramaSourceRoot, artifacts.scopeReviewPack, totals, snapshots.panoramaFiles,
  );
  await verifyPanoramaMasks(
    bundleRoot, artifacts.panoramaMasks, totals, snapshots.bundleFiles,
  );
  verifyFormalMaskReviewBindings(artifacts);
  await verifyOutputBitset(
    bundleRoot, artifacts.outputMask, totals, snapshots.bundleFiles,
  );
  await verifyXgridsSourceMembers(
    xgridsOutputRoot,
    artifacts.outputMask,
    options.createXgridsSourceMemberInspector,
    totals,
    snapshots.xgridsFiles,
  );
  assertPublicationReceiptBindings(artifacts, options.artifactFiles, formalReviewDigests);
  await verifyEndOfRunSnapshot(
    [bundleRoot, panoramaSourceRoot, xgridsOutputRoot],
    options.artifactFiles,
    artifacts,
    formalReviewDigests,
    snapshots,
    bundleInventory,
  );
  return buildVerificationResult(artifacts, formalReviewDigests, totals);
}

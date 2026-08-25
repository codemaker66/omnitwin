import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

import {
  CanonicalJsonValueSchema,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
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
import sharp from "sharp";

const JSON_FILE_MAX_BYTES = 16 * 1024 * 1024;
const MASK_PNG_MAX_BYTES = 64 * 1024 * 1024;
const SOURCE_JPEG_MAX_BYTES = 256 * 1024 * 1024;
const STREAM_BUFFER_BYTES = 8 * 1024 * 1024;
const PANORAMA_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const SHA256_PREFIXED_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_ALLOWED_CHUNKS = new Set(["IHDR", "IDAT", "IEND"]);
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
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
  readonly scopeReviewPack: string;
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
}

interface DirectoryWitness {
  readonly logicalPath: string;
  readonly canonicalPath: string;
  readonly identity: FileIdentity;
}

interface StableFileExpectation {
  readonly expectedByteLength?: number;
  readonly expectedSha256?: string;
  readonly captureBytes: boolean;
  readonly maximumByteLength?: number;
  readonly onChunk?: (
    bytes: Uint8Array,
    absoluteOffset: number,
  ) => void | PromiseLike<void>;
}

interface ParsedAcceptedArtifacts {
  readonly scopeReviewPack: GrandHallScopeReviewPackV1;
  readonly membership: GrandHallRoomMembershipV2;
  readonly portals: GrandHallPortalDecisionsV1;
  readonly boundary: GrandHallClosedBoundaryV1;
  readonly panoramaMasks: GrandHallPanoramaMaskSetV1;
  readonly transform: GrandHallReviewedTransformV1;
  readonly outputMask: GrandHallOutputInventoryMaskV1;
}

interface VerificationTotals {
  fileCount: number;
  byteCount: number;
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

interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: number;
  readonly compressionMethod: number;
  readonly filterMethod: number;
  readonly interlaceMethod: number;
}

function hasSafeUnicode(value: string): boolean {
  for (const character of Array.from(value)) {
    const code = character.charCodeAt(0);
    const codePoint = character.codePointAt(0) ?? code;
    const bidiControl =
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff;
    if (
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f) ||
      bidiControl ||
      (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
    ) {
      return false;
    }
  }
  return true;
}

function isSafeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    /[<>:"|?*]/u.test(value) ||
    !hasSafeUnicode(value)
  ) {
    return false;
  }
  return value.split("/").every((segment) => {
    const windowsStem = segment.split(".", 1)[0]?.toUpperCase() ?? "";
    return (
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsStem)
    );
  });
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
  if (!isSafeRelativePath(value)) {
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

async function locateDirectRegularFile(
  root: TrustedRoot,
  relativePath: string,
): Promise<{
  readonly absolutePath: string;
  readonly canonicalPath: string;
  readonly stats: BigIntStats;
  readonly directoryWitnesses: readonly DirectoryWitness[];
}> {
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
    let stats: BigIntStats;
    try {
      stats = await lstat(currentPath, { bigint: true });
    } catch (error) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "PATH_NON_REGULAR",
        `${root.label} file ${safePath} is unavailable.`,
        error,
      );
    }
    if (stats.isSymbolicLink()) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "PATH_LINK",
        `${root.label} file ${safePath} traverses a symbolic link or reparse point.`,
      );
    }
    const finalSegment = index === segments.length - 1;
    if ((!finalSegment && !stats.isDirectory()) || (finalSegment && !stats.isFile())) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "PATH_NON_REGULAR",
        `${root.label} file ${safePath} is not a direct regular file.`,
      );
    }
    if (!finalSegment) {
      const canonicalDirectory = await realpath(currentPath);
      if (!pathIsWithin(root.canonicalPath, canonicalDirectory)) {
        throw new GrandHallAcceptedScopeBundleVerificationError(
          "PATH_ESCAPE",
          `${root.label} file ${safePath} traverses outside its trusted root.`,
        );
      }
      directoryWitnesses.push({
        logicalPath: currentPath,
        canonicalPath: canonicalDirectory,
        identity: identity(stats),
      });
    }
  }
  const canonicalPath = await realpath(currentPath);
  if (!pathIsWithin(root.canonicalPath, canonicalPath)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_ESCAPE",
      `${root.label} file ${safePath} resolves outside its trusted root.`,
    );
  }
  const stats = await lstat(currentPath, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      stats.isSymbolicLink() ? "PATH_LINK" : "PATH_NON_REGULAR",
      `${root.label} file ${safePath} changed before it could be opened.`,
    );
  }
  if (stats.nlink !== 1n) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "PATH_LINK",
      `${root.label} file ${safePath} must not be a hard-linked alias.`,
    );
  }
  return { absolutePath: currentPath, canonicalPath, stats, directoryWitnesses };
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

async function readStableRegularFile(
  root: TrustedRoot,
  relativePath: string,
  expectation: StableFileExpectation,
): Promise<StableFileResult> {
  const safePath = requireSafeRelativePath(relativePath, `${root.label} file path`);
  const located = await locateDirectRegularFile(root, safePath);
  const discoveredIdentity = identity(located.stats);
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

  const handle = await open(located.absolutePath, "r");
  try {
    const descriptorBefore = identity(await handle.stat({ bigint: true }));
    if (!sameIdentity(discoveredIdentity, descriptorBefore)) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "PATH_IDENTITY_CHANGED",
        `${root.label} file ${safePath} changed while it was opened.`,
      );
    }
    const captured = expectation.captureBytes ? Buffer.alloc(discoveredSize) : null;
    const buffer = Buffer.allocUnsafe(Math.min(STREAM_BUFFER_BYTES, Math.max(discoveredSize, 1)));
    const hash = createHash("sha256");
    let offset = 0;
    while (offset < discoveredSize) {
      const requested = Math.min(buffer.byteLength, discoveredSize - offset);
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
    const sha256 = `sha256:${hash.digest("hex")}` as const;
    if (
      expectation.expectedSha256 !== undefined &&
      sha256 !== expectation.expectedSha256
    ) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "FILE_DIGEST_MISMATCH",
        `${root.label} file ${safePath} differs from its exact declared SHA-256.`,
      );
    }
    return { bytes: captured, byteLength: discoveredSize, sha256 };
  } finally {
    await handle.close();
  }
}

function canonicalJsonBytes(value: unknown): string {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(value));
}

function parseCanonicalJson(bytes: Buffer, label: string): unknown {
  let parsed: unknown;
  if (bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "JSON_NON_CANONICAL",
      `${label} must not contain a UTF-8 byte-order mark.`,
    );
  }
  let text: string;
  try {
    text = FATAL_UTF8_DECODER.decode(bytes);
  } catch (error) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "JSON_INVALID",
      `${label} contains malformed UTF-8.`,
      error,
    );
  }
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "JSON_INVALID",
      `${label} is not valid JSON.`,
      error,
    );
  }
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

async function readAcceptedArtifact<T>(
  root: TrustedRoot,
  relativePath: string,
  label: string,
  schema: RuntimeSchema<T>,
  totals: VerificationTotals,
): Promise<T> {
  const file = await readStableRegularFile(root, relativePath, {
    captureBytes: true,
    maximumByteLength: JSON_FILE_MAX_BYTES,
  });
  recordVerifiedFile(totals, file.byteLength);
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

async function readAcceptedArtifacts(
  root: TrustedRoot,
  files: GrandHallAcceptedScopeArtifactFiles,
  totals: VerificationTotals,
): Promise<ParsedAcceptedArtifacts> {
  const paths: readonly string[] = [
    files.scopeReviewPack,
    files.roomMembership,
    files.portalDecisions,
    files.closedBoundary,
    files.panoramaMaskSet,
    files.reviewedTransform,
    files.outputInventoryMask,
  ];
  if (paths.length !== 7 || new Set(paths).size !== paths.length) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "ARGUMENT_INVALID",
      "Each accepted artifact must have one distinct relative JSON path.",
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
  const [scopeReviewPack, membership, portals, boundary, panoramaMasks, transform, outputMask] =
    await Promise.all([
      readAcceptedArtifact(
        root,
        files.scopeReviewPack,
        "scope review-pack artifact",
        GrandHallScopeReviewPackV1Schema,
        totals,
      ),
      readAcceptedArtifact(
        root,
        files.roomMembership,
        "room membership artifact",
        GrandHallRoomMembershipV2Schema,
        totals,
      ),
      readAcceptedArtifact(
        root,
        files.portalDecisions,
        "portal decision artifact",
        GrandHallPortalDecisionsV1Schema,
        totals,
      ),
      readAcceptedArtifact(
        root,
        files.closedBoundary,
        "closed boundary artifact",
        GrandHallClosedBoundaryV1Schema,
        totals,
      ),
      readAcceptedArtifact(
        root,
        files.panoramaMaskSet,
        "panorama mask-set artifact",
        GrandHallPanoramaMaskSetV1Schema,
        totals,
      ),
      readAcceptedArtifact(
        root,
        files.reviewedTransform,
        "reviewed transform artifact",
        GrandHallReviewedTransformV1Schema,
        totals,
      ),
      readAcceptedArtifact(
        root,
        files.outputInventoryMask,
        "output inventory-mask artifact",
        GrandHallOutputInventoryMaskV1Schema,
        totals,
      ),
    ]);
  return {
    scopeReviewPack,
    membership,
    portals,
    boundary,
    panoramaMasks,
    transform,
    outputMask,
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

function verifyArtifactCrossBindings(artifacts: ParsedAcceptedArtifacts): void {
  const {
    scopeReviewPack,
    membership,
    portals,
    boundary,
    panoramaMasks,
    transform,
    outputMask,
  } = artifacts;
  const reviewPackSha256 = scopeReviewPack.artifactSha256;
  for (const [value, label] of [
    [membership.reviewPackSha256, "room membership"],
    [portals.reviewPackSha256, "portal decisions"],
    [boundary.reviewPackSha256, "closed boundary"],
    [panoramaMasks.reviewPackSha256, "panorama masks"],
    [transform.scopeReviewPackSha256, "reviewed transform"],
    [outputMask.scopeReviewPackSha256, "output inventory mask"],
  ] as const) {
    assertEqual(value, reviewPackSha256, `${label} does not bind the same T-554 review pack.`);
  }
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
    membership.cameraRecords.map((record) => record.source),
    scopeReviewPack.candidatePanoramaSources,
    "Accepted membership sources do not exactly match the T-554 candidate panorama sources.",
  );
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

  membership.cameraRecords.forEach((membershipRecord, index) => {
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

async function verifySourceJpeg(bytes: Buffer, label: string): Promise<void> {
  try {
    const decoderOptions = {
      failOn: "error",
      limitInputPixels: PANORAMA_PIXEL_COUNT,
    } as const;
    const metadata = await sharp(bytes, decoderOptions).metadata();
    if (
      metadata.format !== "jpeg" ||
      metadata.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
      metadata.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
      metadata.channels !== 3 ||
      metadata.depth !== "uchar" ||
      metadata.hasAlpha ||
      metadata.orientation !== undefined ||
      metadata.exif !== undefined
    ) {
      throw new Error("JPEG metadata does not match the exact source panorama grid");
    }
    const decoded = await sharp(bytes, decoderOptions).raw().toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
      decoded.info.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
      decoded.info.channels !== 3 ||
      decoded.data.length !== PANORAMA_PIXEL_COUNT * 3
    ) {
      throw new Error("JPEG full decode does not match the exact RGB source panorama grid");
    }
  } catch (error) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SOURCE_JPEG_INVALID",
      `${label} is not an exact unrotated 8,192 x 4,096 RGB JPEG source.`,
      error,
    );
  }
}

async function verifyPanoramaSources(
  root: TrustedRoot,
  membership: GrandHallRoomMembershipV2,
  totals: VerificationTotals,
): Promise<void> {
  const decodedIdentities = new Set<string>();
  for (const record of membership.cameraRecords) {
    const source = record.source;
    const file = await readStableRegularFile(root, source.fileName, {
      captureBytes: true,
      maximumByteLength: SOURCE_JPEG_MAX_BYTES,
      expectedByteLength: source.byteLength,
      expectedSha256: source.sha256,
    });
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
}

function inspectStrictGrayscalePng(bytes: Buffer): PngHeader {
  if (bytes.length < PNG_SIGNATURE.length + 25 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("invalid PNG signature or truncated stream");
  }
  let offset = 8;
  let header: PngHeader | null = null;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("truncated PNG chunk header");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.length) throw new Error("truncated PNG chunk");
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new Error("invalid PNG chunk type");
    if (!PNG_ALLOWED_CHUNKS.has(type)) {
      throw new Error(`mask PNG contains non-pixel chunk ${type}`);
    }
    if (type === "IHDR") {
      if (header !== null || offset !== 8 || length !== 13) throw new Error("invalid PNG IHDR");
      header = {
        width: bytes.readUInt32BE(dataStart),
        height: bytes.readUInt32BE(dataStart + 4),
        bitDepth: bytes[dataStart + 8] ?? -1,
        colourType: bytes[dataStart + 9] ?? -1,
        compressionMethod: bytes[dataStart + 10] ?? -1,
        filterMethod: bytes[dataStart + 11] ?? -1,
        interlaceMethod: bytes[dataStart + 12] ?? -1,
      };
    } else if (type === "IDAT") {
      if (header === null || sawEnd) throw new Error("PNG IDAT is out of order");
      sawImageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || header === null || !sawImageData || sawEnd) {
        throw new Error("invalid PNG IEND");
      }
      sawEnd = true;
      if (chunkEnd !== bytes.length) throw new Error("PNG has trailing bytes after IEND");
    }
    offset = chunkEnd;
  }
  if (header === null || !sawImageData || !sawEnd || offset !== bytes.length) {
    throw new Error("PNG stream is incomplete");
  }
  if (
    header.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
    header.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
    header.bitDepth !== 8 ||
    header.colourType !== 0 ||
    header.compressionMethod !== 0 ||
    header.filterMethod !== 0 ||
    (header.interlaceMethod !== 0 && header.interlaceMethod !== 1)
  ) {
    throw new Error("PNG IHDR is not the exact grayscale8 source-grid contract");
  }
  return header;
}

async function verifyMaskPixels(
  bytes: Buffer,
  expectedIncluded: number,
  expectedExcluded: number,
): Promise<void> {
  inspectStrictGrayscalePng(bytes);
  const decoderOptions = {
    failOn: "error" as const,
    limitInputPixels: PANORAMA_PIXEL_COUNT,
  };
  const metadata = await sharp(bytes, decoderOptions).metadata();
  if (
    metadata.format !== "png" ||
    metadata.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
    metadata.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
    metadata.space !== "b-w" ||
    metadata.channels !== 1 ||
    metadata.depth !== "uchar" ||
    metadata.hasAlpha ||
    metadata.hasProfile ||
    metadata.isPalette ||
    metadata.bitsPerSample !== 8 ||
    metadata.orientation !== undefined ||
    metadata.exif !== undefined ||
    metadata.icc !== undefined ||
    metadata.iptc !== undefined ||
    metadata.xmp !== undefined ||
    (metadata.comments !== undefined && metadata.comments.length > 0)
  ) {
    throw new Error("PNG metadata does not match grayscale8 no-metadata policy");
  }
  const decoded = await sharp(bytes, decoderOptions)
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    decoded.info.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
    decoded.info.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
    decoded.info.channels !== 1 ||
    decoded.data.length !== PANORAMA_PIXEL_COUNT
  ) {
    throw new Error("decoded PNG grid or channel count drifted");
  }
  let included = 0;
  let excluded = 0;
  for (const value of decoded.data) {
    if (value === 0) included += 1;
    else if (value === 255) excluded += 1;
    else throw new Error(`mask contains forbidden sample value ${String(value)}`);
  }
  if (included !== expectedIncluded || excluded !== expectedExcluded) {
    throw new Error("decoded mask counts differ from the accepted artifact");
  }
}

async function verifyPanoramaMasks(
  root: TrustedRoot,
  maskSet: GrandHallPanoramaMaskSetV1,
  totals: VerificationTotals,
): Promise<void> {
  for (const record of maskSet.sourceRecords) {
    if (record.disposition !== "include_with_binary_pixel_mask") continue;
    const mask = record.mask;
    const file = await readStableRegularFile(root, mask.fileName, {
      captureBytes: true,
      maximumByteLength: MASK_PNG_MAX_BYTES,
      expectedByteLength: mask.byteLength,
      expectedSha256: mask.sha256,
    });
    recordVerifiedFile(totals, file.byteLength);
    if (file.bytes === null) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "MASK_PNG_INVALID",
        `Mask ${mask.fileName} was not retained for full decode verification.`,
      );
    }
    try {
      await verifyMaskPixels(file.bytes, mask.includedPixelCount, mask.excludedPixelCount);
    } catch (error) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "MASK_PNG_INVALID",
        `Mask ${mask.fileName} failed exact binary source-grid verification.`,
        error,
      );
    }
  }
}

async function inventoryRegularFiles(
  root: TrustedRoot,
): Promise<readonly string[]> {
  const discovered: string[] = [];
  const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    const directoryStats = await lstat(absoluteDirectory, { bigint: true });
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        directoryStats.isSymbolicLink() ? "PATH_LINK" : "PATH_NON_REGULAR",
        `${root.label} inventory contains a linked or non-directory container.`,
      );
    }
    const canonicalDirectory = await realpath(absoluteDirectory);
    if (!pathIsWithin(root.canonicalPath, canonicalDirectory)) {
      throw new GrandHallAcceptedScopeBundleVerificationError(
        "PATH_ESCAPE",
        `${root.label} inventory escaped its trusted root.`,
      );
    }
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      requireSafeRelativePath(relativePath, `${root.label} inventory entry`);
      const absolutePath = resolve(absoluteDirectory, entry.name);
      const entryStats = await lstat(absolutePath, { bigint: true });
      if (entry.isSymbolicLink() || entryStats.isSymbolicLink()) {
        throw new GrandHallAcceptedScopeBundleVerificationError(
          "PATH_LINK",
          `${root.label} inventory entry ${relativePath} is a link or reparse point.`,
        );
      }
      if (entry.isDirectory() && entryStats.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile() && entryStats.isFile()) {
        if (entryStats.nlink !== 1n) {
          throw new GrandHallAcceptedScopeBundleVerificationError(
            "PATH_LINK",
            `${root.label} inventory entry ${relativePath} is a hard-linked alias.`,
          );
        }
        discovered.push(relativePath);
      } else {
        throw new GrandHallAcceptedScopeBundleVerificationError(
          "PATH_NON_REGULAR",
          `${root.label} inventory entry ${relativePath} is not a direct regular file or directory.`,
        );
      }
    }
  };
  await visit(root.logicalPath, "");
  return discovered.sort((left, right) => left.localeCompare(right));
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
): Promise<void> {
  const expectedInventory = outputMask.sourceMembers
    .map((member) => member.fileName)
    .sort((left, right) => left.localeCompare(right));
  const beforeInventory = await inventoryRegularFiles(root);
  if (!sameStringArray(beforeInventory, expectedInventory)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SOURCE_INVENTORY_DRIFT",
      "The XGRIDS/LCC output root is not the exact accepted source-member inventory.",
    );
  }
  for (const member of outputMask.sourceMembers) {
    const inspector = createInspector(Object.freeze({ ...member }));
    const file = await readStableRegularFile(root, member.fileName, {
      captureBytes: false,
      expectedByteLength: member.byteLength,
      expectedSha256: member.sha256,
      onChunk: (bytes, absoluteOffset) => inspector.update(bytes, absoluteOffset),
    });
    recordVerifiedFile(totals, file.byteLength);
    const rawInspection: unknown = await inspector.finish();
    parseSourceMemberInspection(rawInspection, member, outputMask.recordKind);
  }
  const afterInventory = await inventoryRegularFiles(root);
  if (!sameStringArray(afterInventory, beforeInventory)) {
    throw new GrandHallAcceptedScopeBundleVerificationError(
      "SOURCE_INVENTORY_DRIFT",
      "The XGRIDS/LCC source-member inventory changed during verification.",
    );
  }
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

async function verifyOutputBitset(
  root: TrustedRoot,
  outputMask: GrandHallOutputInventoryMaskV1,
  totals: VerificationTotals,
): Promise<void> {
  let population = 0;
  let finalByte = 0;
  const file = await readStableRegularFile(root, outputMask.bitsetFileName, {
    captureBytes: false,
    expectedByteLength: outputMask.bitsetByteLength,
    expectedSha256: outputMask.bitsetSha256,
    onChunk: (chunk, absoluteOffset) => {
      for (let index = 0; index < chunk.length; index += 1) {
        const value = chunk[index] ?? 0;
        population += POPCOUNT[value] ?? 0;
        if (absoluteOffset + index === outputMask.bitsetByteLength - 1) finalByte = value;
      }
    },
  });
  recordVerifiedFile(totals, file.byteLength);
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
  const artifacts = await readAcceptedArtifacts(bundleRoot, options.artifactFiles, totals);
  assertSha256Fields(artifacts);
  verifyArtifactCrossBindings(artifacts);
  await verifyPanoramaSources(panoramaSourceRoot, artifacts.membership, totals);
  await verifyPanoramaMasks(bundleRoot, artifacts.panoramaMasks, totals);
  await verifyXgridsSourceMembers(
    xgridsOutputRoot,
    artifacts.outputMask,
    options.createXgridsSourceMemberInspector,
    totals,
  );
  await verifyOutputBitset(bundleRoot, artifacts.outputMask, totals);

  return Object.freeze({
    verifierVersion: GRAND_HALL_ACCEPTED_SCOPE_BUNDLE_VERIFIER_VERSION,
    integrityVerified: true,
    sourceRecordStructureVerified: true,
    productionTrustActivated: false,
    runtimeAdmissionAuthorized: false,
    semanticAccuracyReReviewed: false,
    reviewPackSha256: artifacts.scopeReviewPack.artifactSha256,
    artifactSha256s: Object.freeze({
      scopeReviewPack: artifacts.scopeReviewPack.artifactSha256,
      roomMembership: artifacts.membership.artifactSha256,
      portalDecisions: artifacts.portals.artifactSha256,
      closedBoundary: artifacts.boundary.artifactSha256,
      panoramaMaskSet: artifacts.panoramaMasks.artifactSha256,
      reviewedTransform: artifacts.transform.artifactSha256,
      outputInventoryMask: artifacts.outputMask.artifactSha256,
    }),
    panoramaSourceCount: artifacts.membership.cameraRecords.length,
    panoramaMaskCount: artifacts.panoramaMasks.maskCount,
    xgridsSourceMemberCount: artifacts.outputMask.sourceMembers.length,
    outputRecordCount: artifacts.outputMask.totalRecordCount,
    includedRecordCount: artifacts.outputMask.includedRecordCount,
    excludedRecordCount: artifacts.outputMask.excludedRecordCount,
    verifiedFileCount: totals.fileCount,
    verifiedByteCount: totals.byteCount,
  });
}

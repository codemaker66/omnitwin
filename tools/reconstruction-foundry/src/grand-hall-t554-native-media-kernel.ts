import type { BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import {
  GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
  GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
  validateGrandHallT554MaskPngBytes,
  validateGrandHallT554SourceJpegBytes,
  type GrandHallT554MaskPixelCounts,
} from "./grand-hall-t554-media-validation.js";

export type GrandHallT554NativeMediaKernelErrorCode =
  | "ARGUMENT_INVALID"
  | "SOURCE_INVALID"
  | "SOURCE_CHANGED"
  | "SOURCE_IDENTITY_MISMATCH"
  | "MEDIA_INVALID";

export class GrandHallT554NativeMediaKernelError extends Error {
  readonly code: GrandHallT554NativeMediaKernelErrorCode;

  constructor(code: GrandHallT554NativeMediaKernelErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeMediaKernelError";
    this.code = code;
  }
}

export interface GrandHallT554NativeMediaInput {
  readonly sourceRoot: string;
  readonly fileName: string;
  readonly expectedSha256: string;
  readonly expectedByteLength: number;
}

interface GrandHallT554VerifiedMediaCommon {
  readonly fileName: string;
  readonly sha256: `sha256:${string}`;
  readonly byteLength: number;
  readonly copyBytes: () => Buffer;
}

export interface GrandHallT554VerifiedSourceJpeg extends GrandHallT554VerifiedMediaCommon {
  readonly kind: "source_jpeg";
}

export interface GrandHallT554VerifiedMaskPng extends GrandHallT554VerifiedMediaCommon,
  GrandHallT554MaskPixelCounts {
  readonly kind: "frozen_binary_mask";
}

export interface GrandHallT554NativeMediaKernelTestSeam {
  readonly afterPathSnapshot?: (absolutePath: string) => Promise<void> | void;
  readonly afterDescriptorPinned?: (absolutePath: string) => Promise<void> | void;
  readonly afterExactRead?: (absolutePath: string) => Promise<void> | void;
  readonly afterDecode?: (absolutePath: string) => Promise<void> | void;
}

interface ParsedMediaInput {
  readonly sourceRoot: string;
  readonly fileName: string;
  readonly expectedSha256: `sha256:${string}`;
  readonly expectedByteLength: number;
}

interface MediaPolicy<T> {
  readonly kind: "source_jpeg" | "frozen_binary_mask";
  readonly extension: ".jpg" | ".jpeg" | ".png";
  readonly maximumBytes: number;
  readonly decode: (bytes: Buffer) => Promise<T>;
}

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CANONICAL_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
const WINDOWS_DEVICE_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;

function fail(
  code: GrandHallT554NativeMediaKernelErrorCode,
  message: string,
  cause?: unknown,
): GrandHallT554NativeMediaKernelError {
  return new GrandHallT554NativeMediaKernelError(code, message, cause);
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32"
    ? normalized.replaceAll("/", "\\").toLowerCase()
    : normalized;
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.nlink === right.nlink &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function assertCanonicalBasename(fileName: string, extensions: readonly string[]): void {
  const hasExtension = extensions.some((extension) => fileName.endsWith(extension));
  if (fileName !== basename(fileName) || !CANONICAL_BASENAME_PATTERN.test(fileName) ||
    WINDOWS_DEVICE_PATTERN.test(fileName) || !hasExtension) {
    throw fail("ARGUMENT_INVALID", "Native media filename must be one canonical safe basename.");
  }
}

function parseInput(
  input: GrandHallT554NativeMediaInput,
  extensions: readonly string[],
  maximumBytes: number,
): ParsedMediaInput {
  if (typeof input.sourceRoot !== "string" || !isAbsolute(input.sourceRoot)) {
    throw fail("ARGUMENT_INVALID", "Native media source root must be absolute.");
  }
  if (typeof input.fileName !== "string") {
    throw fail("ARGUMENT_INVALID", "Native media filename must be a string.");
  }
  assertCanonicalBasename(input.fileName, extensions);
  if (!SHA256_PATTERN.test(input.expectedSha256)) {
    throw fail("ARGUMENT_INVALID", "Native media SHA-256 must use canonical lowercase form.");
  }
  if (!Number.isSafeInteger(input.expectedByteLength) || input.expectedByteLength < 1 ||
    input.expectedByteLength > maximumBytes) {
    throw fail("ARGUMENT_INVALID", "Native media expected length is outside its fixed bound.");
  }
  return { sourceRoot: resolve(input.sourceRoot), fileName: input.fileName,
    expectedSha256: input.expectedSha256 as `sha256:${string}`,
    expectedByteLength: input.expectedByteLength };
}

function assertRootStats(stats: BigIntStats): void {
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw fail("SOURCE_INVALID", "Native media source root must be one direct directory.");
  }
}

async function inspectRoot(path: string): Promise<BigIntStats> {
  const before = await lstat(path, { bigint: true });
  const canonical = await realpath(path);
  const after = await lstat(path, { bigint: true });
  assertRootStats(before);
  assertRootStats(after);
  if (comparablePath(canonical) !== comparablePath(path) || !sameFileState(before, after)) {
    throw fail("SOURCE_CHANGED", "Native media source root is aliased or changed.");
  }
  return after;
}

function assertFileStats(stats: BigIntStats, maximumBytes: number): void {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n ||
    stats.size < 1n || stats.size > BigInt(maximumBytes)) {
    throw fail("SOURCE_INVALID", "Native media must be one bounded direct single-link file.");
  }
}

async function inspectFilePath(
  path: string,
  fileName: string,
  maximumBytes: number,
): Promise<BigIntStats> {
  const before = await lstat(path, { bigint: true });
  const canonical = await realpath(path);
  const after = await lstat(path, { bigint: true });
  assertFileStats(before, maximumBytes);
  assertFileStats(after, maximumBytes);
  if (comparablePath(canonical) !== comparablePath(path) || basename(canonical) !== fileName ||
    !sameFileState(before, after)) {
    throw fail("SOURCE_CHANGED", "Native media path is aliased or changed.");
  }
  return after;
}

function assertStatesEqual(states: readonly BigIntStats[], label: string): void {
  const first = states[0];
  if (first === undefined || states.some((state) => !sameFileState(first, state))) {
    throw fail("SOURCE_CHANGED", `${label} changed during same-descriptor verification.`);
  }
}

async function readExactly(handle: FileHandle, byteLength: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const result = await handle.read(bytes, offset, byteLength - offset, offset);
    if (result.bytesRead < 1) throw fail("SOURCE_CHANGED", "Native media was truncated while read.");
    offset += result.bytesRead;
  }
  const trailing = await handle.read(Buffer.allocUnsafe(1), 0, 1, byteLength);
  if (trailing.bytesRead !== 0) throw fail("SOURCE_CHANGED", "Native media grew while read.");
  return bytes;
}

async function assertStablePhase(
  input: ParsedMediaInput,
  absolutePath: string,
  rootBefore: BigIntStats,
  fileBefore: BigIntStats,
  descriptor: BigIntStats,
  maximumBytes: number,
): Promise<void> {
  const pathNow = await inspectFilePath(absolutePath, input.fileName, maximumBytes);
  const rootNow = await inspectRoot(input.sourceRoot);
  assertStatesEqual([fileBefore, descriptor, pathNow], "Native media file");
  assertStatesEqual([rootBefore, rootNow], "Native media source root");
}

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function decodeMedia<T>(policy: MediaPolicy<T>, bytes: Buffer): Promise<T> {
  try {
    return await policy.decode(bytes);
  } catch (error) {
    throw fail("MEDIA_INVALID", `Native ${policy.kind} bytes failed full decode.`, error);
  }
}

function commonResult(
  input: ParsedMediaInput,
  bytes: Buffer,
): GrandHallT554VerifiedMediaCommon {
  const ownedBytes = Buffer.from(bytes);
  return { fileName: input.fileName, sha256: input.expectedSha256,
    byteLength: input.expectedByteLength, copyBytes: () => Buffer.from(ownedBytes) };
}

async function verifyMedia<T>(
  rawInput: GrandHallT554NativeMediaInput,
  policy: MediaPolicy<T>,
  seam: GrandHallT554NativeMediaKernelTestSeam,
): Promise<{ readonly input: ParsedMediaInput; readonly bytes: Buffer; readonly decoded: T }> {
  const extensions = policy.kind === "source_jpeg" ? [".jpg", ".jpeg"] : [policy.extension];
  const input = parseInput(rawInput, extensions, policy.maximumBytes);
  const rootBefore = await inspectRoot(input.sourceRoot);
  const absolutePath = resolve(input.sourceRoot, input.fileName);
  if (comparablePath(dirname(absolutePath)) !== comparablePath(input.sourceRoot)) {
    throw fail("ARGUMENT_INVALID", "Native media path escaped its fixed source root.");
  }
  const fileBefore = await inspectFilePath(absolutePath, input.fileName, policy.maximumBytes);
  if (fileBefore.size !== BigInt(input.expectedByteLength)) {
    throw fail("SOURCE_IDENTITY_MISMATCH", "Native media length differs from its exact identity.");
  }
  await seam.afterPathSnapshot?.(absolutePath);
  let handle: FileHandle | undefined;
  try {
    handle = await open(absolutePath, "r");
    const descriptorBefore = await handle.stat({ bigint: true });
    assertFileStats(descriptorBefore, policy.maximumBytes);
    await assertStablePhase(
      input, absolutePath, rootBefore, fileBefore, descriptorBefore, policy.maximumBytes,
    );
    await seam.afterDescriptorPinned?.(absolutePath);
    const bytes = await readExactly(handle, input.expectedByteLength);
    await seam.afterExactRead?.(absolutePath);
    const descriptorAfterRead = await handle.stat({ bigint: true });
    await assertStablePhase(
      input, absolutePath, rootBefore, fileBefore, descriptorAfterRead, policy.maximumBytes,
    );
    if (sha256(bytes) !== input.expectedSha256) {
      throw fail("SOURCE_IDENTITY_MISMATCH", "Native media SHA-256 differs from its exact identity.");
    }
    const decoded = await decodeMedia(policy, bytes);
    await seam.afterDecode?.(absolutePath);
    const descriptorAfterDecode = await handle.stat({ bigint: true });
    await assertStablePhase(
      input, absolutePath, rootBefore, fileBefore, descriptorAfterDecode, policy.maximumBytes,
    );
    return { input, bytes, decoded };
  } catch (error) {
    if (error instanceof GrandHallT554NativeMediaKernelError) throw error;
    throw fail("SOURCE_INVALID", "Native media could not be verified safely.", error);
  } finally {
    await handle?.close();
  }
}

const SOURCE_JPEG_POLICY: MediaPolicy<void> = {
  kind: "source_jpeg",
  extension: ".jpg",
  maximumBytes: GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
  decode: validateGrandHallT554SourceJpegBytes,
};

const MASK_PNG_POLICY: MediaPolicy<GrandHallT554MaskPixelCounts> = {
  kind: "frozen_binary_mask",
  extension: ".png",
  maximumBytes: GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
  decode: validateGrandHallT554MaskPngBytes,
};

async function verifySourceJpeg(
  input: GrandHallT554NativeMediaInput,
  seam: GrandHallT554NativeMediaKernelTestSeam,
): Promise<GrandHallT554VerifiedSourceJpeg> {
  const verified = await verifyMedia(input, SOURCE_JPEG_POLICY, seam);
  return Object.freeze({ kind: "source_jpeg" as const,
    ...commonResult(verified.input, verified.bytes) });
}

async function verifyMaskPng(
  input: GrandHallT554NativeMediaInput,
  seam: GrandHallT554NativeMediaKernelTestSeam,
): Promise<GrandHallT554VerifiedMaskPng> {
  const verified = await verifyMedia(input, MASK_PNG_POLICY, seam);
  return Object.freeze({ kind: "frozen_binary_mask" as const,
    ...commonResult(verified.input, verified.bytes), ...verified.decoded });
}

export function verifyGrandHallT554NativeSourceJpeg(
  input: GrandHallT554NativeMediaInput,
): Promise<GrandHallT554VerifiedSourceJpeg> {
  return verifySourceJpeg(input, {});
}

export function verifyGrandHallT554NativeMaskPng(
  input: GrandHallT554NativeMediaInput,
): Promise<GrandHallT554VerifiedMaskPng> {
  return verifyMaskPng(input, {});
}

export const __testOnlyGrandHallT554NativeMediaKernel = Object.freeze({
  verifySourceJpeg,
  verifyMaskPng,
});

import type { BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import {
  GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
  GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
  decodeGrandHallT554SourceJpegBytes,
  validateGrandHallT554MaskEvidencePngBytes,
  validateGrandHallT554MaskPngBytes,
  validateGrandHallT554MaskReasonMapPngBytes,
  validateGrandHallT554SourceJpegBytes,
  type GrandHallT554DecodedSourceJpeg,
  type GrandHallT554MaskEvidencePixelCounts,
  type GrandHallT554MaskPixelCounts,
  type GrandHallT554MaskReasonMapCounts,
  type GrandHallT554SourceJpegDecoderIdentity,
} from "./grand-hall-t554-media-validation.js";

export type GrandHallT554NativeMediaKernelErrorCode =
  | "ARGUMENT_INVALID"
  | "SOURCE_INVALID"
  | "SOURCE_CHANGED"
  | "SOURCE_IDENTITY_MISMATCH"
  | "SOURCE_CLOSED"
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
  /** Destroys the retained exact bytes. All later access fails closed. */
  readonly destroy: () => Promise<void>;
}

export interface GrandHallT554VerifiedSourceJpeg extends GrandHallT554VerifiedMediaCommon {
  readonly kind: "source_jpeg";
}

export interface GrandHallT554VerifiedMaskPng extends GrandHallT554VerifiedMediaCommon,
  GrandHallT554MaskPixelCounts {
  readonly kind: "frozen_binary_mask";
}

export interface GrandHallT554VerifiedMaskEvidence extends GrandHallT554MaskEvidencePixelCounts {
  readonly kind: "frozen_mask_evidence";
  readonly mask: {
    readonly fileName: string;
    readonly sha256: `sha256:${string}`;
    readonly byteLength: number;
  };
  readonly reasonMap: {
    readonly fileName: string;
    readonly sha256: `sha256:${string}`;
    readonly byteLength: number;
  };
}

export interface GrandHallT554NativeMediaKernelTestSeam {
  readonly afterPathSnapshot?: (absolutePath: string) => Promise<void> | void;
  readonly afterDescriptorPinned?: (absolutePath: string) => Promise<void> | void;
  readonly afterExactRead?: (absolutePath: string) => Promise<void> | void;
  readonly afterDecode?: (absolutePath: string) => Promise<void> | void;
  readonly afterBuffersDestroyed?: (facts: {
    readonly rawBytesWereZeroed: boolean;
    readonly decodedPixelsWereZeroed: boolean;
  }) => Promise<void> | void;
  readonly afterTransientBuffersDestroyed?: (facts: {
    readonly rawBytesWereZeroed: boolean;
  }) => Promise<void> | void;
}

export interface GrandHallT554PinnedSourceJpegVerification {
  readonly fileName: string;
  readonly sha256: `sha256:${string}`;
  readonly byteLength: number;
  readonly widthPx: 8192;
  readonly heightPx: 4096;
  readonly decodedChannelCount: 3;
  readonly decodedBitsPerSample: 8;
  readonly alphaPresent: false;
  readonly orientationMetadataPresent: false;
  readonly decodedPixelSha256: `sha256:${string}`;
  readonly decoderIdentity: GrandHallT554SourceJpegDecoderIdentity;
  readonly descriptorWitnessSha256: `sha256:${string}`;
  readonly sameOpenDescriptorHashedAndDecoded: true;
  readonly fullJpegDecodeCompleted: true;
}

export interface GrandHallT554PinnedSourceJpeg {
  readonly verification: GrandHallT554PinnedSourceJpegVerification;
  readonly copyExactRgb8Region: (
    leftPx: number,
    topPx: number,
    widthPx: number,
    heightPx: number,
  ) => Buffer;
  readonly finalize: () => Promise<GrandHallT554PinnedSourceJpegVerification>;
  readonly abandon: () => Promise<void>;
}

interface ParsedMediaInput {
  readonly sourceRoot: string;
  readonly fileName: string;
  readonly expectedSha256: `sha256:${string}`;
  readonly expectedByteLength: number;
}

interface MediaPolicy<T> {
  readonly kind: "source_jpeg" | "frozen_binary_mask" | "frozen_mask_reason_map";
  readonly extension: ".jpg" | ".jpeg" | ".png";
  readonly maximumBytes: number;
  readonly decode: (bytes: Buffer) => Promise<T>;
}

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CANONICAL_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
const WINDOWS_DEVICE_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/](?![\\/])/u;

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
  if (
    input.sourceRoot.startsWith("//") || input.sourceRoot.startsWith("\\\\") ||
    (process.platform === "win32" && !WINDOWS_DRIVE_ROOT_PATTERN.test(input.sourceRoot))
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "Native media source root must be a local drive path, never UNC or a device namespace.",
    );
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
  const bytes = Buffer.alloc(byteLength);
  const trailing = Buffer.alloc(1);
  try {
    let offset = 0;
    while (offset < byteLength) {
      const result = await handle.read(bytes, offset, byteLength - offset, offset);
      if (result.bytesRead < 1) {
        throw fail("SOURCE_CHANGED", "Native media was truncated while read.");
      }
      offset += result.bytesRead;
    }
    const trailingRead = await handle.read(trailing, 0, 1, byteLength);
    if (trailingRead.bytesRead !== 0) {
      throw fail("SOURCE_CHANGED", "Native media grew while read.");
    }
    return bytes;
  } catch (error) {
    bytes.fill(0);
    throw error;
  } finally {
    trailing.fill(0);
  }
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

async function assertPinnedStablePhase(
  handle: FileHandle,
  input: ParsedMediaInput,
  absolutePath: string,
  rootBefore: BigIntStats,
  fileBefore: BigIntStats,
  maximumBytes: number,
): Promise<BigIntStats> {
  const descriptorBefore = await handle.stat({ bigint: true });
  assertFileStats(descriptorBefore, maximumBytes);
  await assertStablePhase(
    input,
    absolutePath,
    rootBefore,
    fileBefore,
    descriptorBefore,
    maximumBytes,
  );
  const descriptorAfter = await handle.stat({ bigint: true });
  assertFileStats(descriptorAfter, maximumBytes);
  assertStatesEqual(
    [fileBefore, descriptorBefore, descriptorAfter],
    "Native media descriptor",
  );
  return descriptorAfter;
}

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function descriptorWitnessSha256(
  input: ParsedMediaInput,
  descriptor: BigIntStats,
  decodedPixelSha256: `sha256:${string}`,
  decoderIdentity: GrandHallT554SourceJpegDecoderIdentity,
): `sha256:${string}` {
  const material = JSON.stringify({
    schemaVersion: "venviewer.grand-hall-t554-source-descriptor-witness.v1",
    fileName: input.fileName,
    rawSha256: input.expectedSha256,
    rawByteLength: input.expectedByteLength,
    decodedPixelSha256,
    decoderIdentity,
    descriptor: {
      dev: descriptor.dev.toString(10),
      ino: descriptor.ino.toString(10),
      mode: descriptor.mode.toString(10),
      nlink: descriptor.nlink.toString(10),
      size: descriptor.size.toString(10),
      mtimeNs: descriptor.mtimeNs.toString(10),
      ctimeNs: descriptor.ctimeNs.toString(10),
    },
  });
  return sha256(Buffer.from(material, "utf8"));
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
  seam: GrandHallT554NativeMediaKernelTestSeam,
): GrandHallT554VerifiedMediaCommon {
  let ownedBytes: Buffer | undefined = bytes;
  return { fileName: input.fileName, sha256: input.expectedSha256,
    byteLength: input.expectedByteLength,
    copyBytes: () => {
      if (ownedBytes === undefined) {
        throw fail("SOURCE_CLOSED", "Verified native media bytes were destroyed.");
      }
      return Buffer.from(ownedBytes);
    },
    destroy: async () => {
      if (ownedBytes === undefined) {
        throw fail("SOURCE_CLOSED", "Verified native media bytes were already destroyed.");
      }
      const bytesToDestroy = ownedBytes;
      ownedBytes = undefined;
      bytesToDestroy.fill(0);
      await seam.afterTransientBuffersDestroyed?.({
        rawBytesWereZeroed: bytesToDestroy.every((value) => value === 0),
      });
    } };
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
  let bytes: Buffer | undefined;
  try {
    handle = await open(absolutePath, "r");
    const descriptorBefore = await handle.stat({ bigint: true });
    assertFileStats(descriptorBefore, policy.maximumBytes);
    await assertStablePhase(
      input, absolutePath, rootBefore, fileBefore, descriptorBefore, policy.maximumBytes,
    );
    await seam.afterDescriptorPinned?.(absolutePath);
    bytes = await readExactly(handle, input.expectedByteLength);
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
    const bytesToDestroy = bytes;
    bytes = undefined;
    bytesToDestroy?.fill(0);
    await seam.afterTransientBuffersDestroyed?.({
      rawBytesWereZeroed: bytesToDestroy?.every((value) => value === 0) ?? true,
    });
    if (error instanceof GrandHallT554NativeMediaKernelError) throw error;
    throw fail("SOURCE_INVALID", "Native media could not be verified safely.", error);
  } finally {
    await handle?.close();
  }
}

interface PinnedVerifiedMedia<T> {
  readonly input: ParsedMediaInput;
  readonly absolutePath: string;
  readonly rootBefore: BigIntStats;
  readonly fileBefore: BigIntStats;
  readonly maximumBytes: number;
  readonly handle: FileHandle;
  readonly bytes: Buffer;
  readonly decoded: T;
}

async function openPinnedVerifiedMedia<T>(
  rawInput: GrandHallT554NativeMediaInput,
  policy: MediaPolicy<T>,
  seam: GrandHallT554NativeMediaKernelTestSeam,
): Promise<PinnedVerifiedMedia<T>> {
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
  let bytes: Buffer | undefined;
  try {
    handle = await open(absolutePath, "r");
    await assertPinnedStablePhase(
      handle,
      input,
      absolutePath,
      rootBefore,
      fileBefore,
      policy.maximumBytes,
    );
    await seam.afterDescriptorPinned?.(absolutePath);
    bytes = await readExactly(handle, input.expectedByteLength);
    await seam.afterExactRead?.(absolutePath);
    await assertPinnedStablePhase(
      handle,
      input,
      absolutePath,
      rootBefore,
      fileBefore,
      policy.maximumBytes,
    );
    if (sha256(bytes) !== input.expectedSha256) {
      throw fail("SOURCE_IDENTITY_MISMATCH", "Native media SHA-256 differs from its exact identity.");
    }
    const decoded = await decodeMedia(policy, bytes);
    await seam.afterDecode?.(absolutePath);
    await assertPinnedStablePhase(
      handle,
      input,
      absolutePath,
      rootBefore,
      fileBefore,
      policy.maximumBytes,
    );
    const pinned = { input, absolutePath, rootBefore, fileBefore,
      maximumBytes: policy.maximumBytes, handle, bytes, decoded };
    handle = undefined;
    bytes = undefined;
    return pinned;
  } catch (error) {
    const bytesToDestroy = bytes;
    bytes = undefined;
    bytesToDestroy?.fill(0);
    await seam.afterTransientBuffersDestroyed?.({
      rawBytesWereZeroed: bytesToDestroy?.every((value) => value === 0) ?? true,
    });
    if (error instanceof GrandHallT554NativeMediaKernelError) throw error;
    throw fail("SOURCE_INVALID", "Native media could not be pinned safely.", error);
  } finally {
    await handle?.close();
  }
}

function assertPinnedVerifiedMediaStable(
  media: PinnedVerifiedMedia<unknown>,
): Promise<BigIntStats> {
  return assertPinnedStablePhase(
    media.handle,
    media.input,
    media.absolutePath,
    media.rootBefore,
    media.fileBefore,
    media.maximumBytes,
  );
}

async function assertClosedVerifiedMediaPathStable(
  media: PinnedVerifiedMedia<unknown>,
): Promise<void> {
  try {
    const pathNow = await inspectFilePath(
      media.absolutePath,
      media.input.fileName,
      media.maximumBytes,
    );
    const rootNow = await inspectRoot(media.input.sourceRoot);
    assertStatesEqual([media.fileBefore, pathNow], "Native media closed file path");
    assertStatesEqual([media.rootBefore, rootNow], "Native media closed source root");
  } catch (error) {
    if (error instanceof GrandHallT554NativeMediaKernelError) throw error;
    throw fail("SOURCE_CHANGED", "Native media path changed while its evidence pair closed.", error);
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

const MASK_REASON_MAP_PNG_POLICY: MediaPolicy<GrandHallT554MaskReasonMapCounts> = {
  kind: "frozen_mask_reason_map",
  extension: ".png",
  maximumBytes: GRAND_HALL_T554_MASK_PNG_MAX_BYTES,
  decode: validateGrandHallT554MaskReasonMapPngBytes,
};

class PinnedGrandHallT554SourceJpeg implements GrandHallT554PinnedSourceJpeg {
  readonly verification: GrandHallT554PinnedSourceJpegVerification;
  private lifecycle: "active" | "closing" | "closed" = "active";
  private rawBytes: Buffer | undefined;
  private decodedPixels: Buffer | undefined;

  constructor(
    private readonly input: ParsedMediaInput,
    private readonly absolutePath: string,
    private readonly rootBefore: BigIntStats,
    private readonly fileBefore: BigIntStats,
    descriptorWitnessState: BigIntStats,
    private readonly handle: FileHandle,
    rawBytes: Buffer,
    decoded: GrandHallT554DecodedSourceJpeg,
    private readonly seam: GrandHallT554NativeMediaKernelTestSeam,
  ) {
    const decodedPixelSha256 = sha256(decoded.pixels);
    this.verification = Object.freeze({
      fileName: input.fileName,
      sha256: input.expectedSha256,
      byteLength: input.expectedByteLength,
      widthPx: decoded.widthPx,
      heightPx: decoded.heightPx,
      decodedChannelCount: decoded.channelCount,
      decodedBitsPerSample: decoded.bitsPerSample,
      alphaPresent: decoded.alphaPresent,
      orientationMetadataPresent: decoded.orientationMetadataPresent,
      decodedPixelSha256,
      decoderIdentity: Object.freeze({ ...decoded.decoderIdentity }),
      descriptorWitnessSha256: descriptorWitnessSha256(
        input,
        descriptorWitnessState,
        decodedPixelSha256,
        decoded.decoderIdentity,
      ),
      sameOpenDescriptorHashedAndDecoded: true,
      fullJpegDecodeCompleted: true,
    });
    this.rawBytes = rawBytes;
    this.decodedPixels = decoded.pixels;
  }

  copyExactRgb8Region(
    leftPx: number,
    topPx: number,
    widthPx: number,
    heightPx: number,
  ): Buffer {
    if (this.lifecycle !== "active") {
      throw fail("SOURCE_CLOSED", "Native source descriptor epoch is no longer active.");
    }
    if (
      !Number.isSafeInteger(leftPx) ||
      !Number.isSafeInteger(topPx) ||
      !Number.isSafeInteger(widthPx) ||
      !Number.isSafeInteger(heightPx) ||
      leftPx < 0 ||
      topPx < 0 ||
      widthPx < 1 ||
      heightPx < 1 ||
      leftPx + widthPx > this.verification.widthPx ||
      topPx + heightPx > this.verification.heightPx
    ) {
      throw fail("ARGUMENT_INVALID", "RGB8 region is outside the exact decoded source grid.");
    }
    const pixels = this.decodedPixels;
    if (pixels === undefined) {
      throw fail("SOURCE_CLOSED", "Native source decoded pixels were destroyed.");
    }
    const bytesPerPixel = this.verification.decodedChannelCount;
    const rowByteLength = widthPx * bytesPerPixel;
    const copy = Buffer.alloc(rowByteLength * heightPx);
    for (let rowOffset = 0; rowOffset < heightPx; rowOffset += 1) {
      const sourceStart = (
        (topPx + rowOffset) * this.verification.widthPx + leftPx
      ) * bytesPerPixel;
      pixels.copy(
        copy,
        rowOffset * rowByteLength,
        sourceStart,
        sourceStart + rowByteLength,
      );
    }
    return copy;
  }

  private assertActive(): void {
    if (this.lifecycle !== "active") {
      throw fail("SOURCE_CLOSED", "Native source descriptor epoch is no longer active.");
    }
    this.lifecycle = "closing";
  }

  private async destroy(): Promise<void> {
    const rawBytes = this.rawBytes;
    const decodedPixels = this.decodedPixels;
    this.rawBytes = undefined;
    this.decodedPixels = undefined;
    rawBytes?.fill(0);
    decodedPixels?.fill(0);
    if (this.seam.afterBuffersDestroyed !== undefined) {
      await this.seam.afterBuffersDestroyed({
        rawBytesWereZeroed: rawBytes?.every((value) => value === 0) ?? true,
        decodedPixelsWereZeroed:
          decodedPixels?.every((value) => value === 0) ?? true,
      });
    }
  }

  private async closeAndDestroy(): Promise<void> {
    let closeError: unknown;
    try {
      await this.handle.close();
    } catch (error) {
      closeError = error;
    }
    try {
      await this.destroy();
    } finally {
      this.lifecycle = "closed";
    }
    if (closeError !== undefined) {
      throw fail("SOURCE_INVALID", "Native source descriptor could not be closed.", closeError);
    }
  }

  async finalize(): Promise<GrandHallT554PinnedSourceJpegVerification> {
    this.assertActive();
    let stabilityError: unknown;
    try {
      await assertPinnedStablePhase(
        this.handle,
        this.input,
        this.absolutePath,
        this.rootBefore,
        this.fileBefore,
        GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
      );
    } catch (error) {
      stabilityError = error;
    }
    let cleanupError: unknown;
    try {
      await this.closeAndDestroy();
    } catch (error) {
      cleanupError = error;
    }
    if (stabilityError !== undefined) {
      if (
        stabilityError instanceof GrandHallT554NativeMediaKernelError &&
        stabilityError.code === "SOURCE_CHANGED"
      ) {
        throw stabilityError;
      }
      throw fail(
        "SOURCE_CHANGED",
        "Native source descriptor or path changed before epoch finalization.",
        stabilityError,
      );
    }
    if (cleanupError instanceof Error) throw cleanupError;
    if (cleanupError !== undefined) {
      throw fail(
        "SOURCE_INVALID",
        "Native source descriptor cleanup failed with a non-error value.",
        cleanupError,
      );
    }
    return this.verification;
  }

  async abandon(): Promise<void> {
    this.assertActive();
    await this.closeAndDestroy();
  }
}

async function openPinnedSourceJpeg(
  rawInput: GrandHallT554NativeMediaInput,
  seam: GrandHallT554NativeMediaKernelTestSeam,
): Promise<GrandHallT554PinnedSourceJpeg> {
  const input = parseInput(
    rawInput,
    [".jpg", ".jpeg"],
    GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
  );
  const rootBefore = await inspectRoot(input.sourceRoot);
  const absolutePath = resolve(input.sourceRoot, input.fileName);
  if (comparablePath(dirname(absolutePath)) !== comparablePath(input.sourceRoot)) {
    throw fail("ARGUMENT_INVALID", "Native media path escaped its fixed source root.");
  }
  const fileBefore = await inspectFilePath(
    absolutePath,
    input.fileName,
    GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
  );
  if (fileBefore.size !== BigInt(input.expectedByteLength)) {
    throw fail("SOURCE_IDENTITY_MISMATCH", "Native media length differs from its exact identity.");
  }
  await seam.afterPathSnapshot?.(absolutePath);
  let handle: FileHandle | undefined;
  let bytes: Buffer | undefined;
  let decoded: GrandHallT554DecodedSourceJpeg | undefined;
  try {
    handle = await open(absolutePath, "r");
    await assertPinnedStablePhase(
      handle,
      input,
      absolutePath,
      rootBefore,
      fileBefore,
      GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
    );
    await seam.afterDescriptorPinned?.(absolutePath);
    bytes = await readExactly(handle, input.expectedByteLength);
    await seam.afterExactRead?.(absolutePath);
    await assertPinnedStablePhase(
      handle,
      input,
      absolutePath,
      rootBefore,
      fileBefore,
      GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
    );
    if (sha256(bytes) !== input.expectedSha256) {
      throw fail("SOURCE_IDENTITY_MISMATCH", "Native media SHA-256 differs from its exact identity.");
    }
    try {
      decoded = await decodeGrandHallT554SourceJpegBytes(bytes);
    } catch (error) {
      throw fail("MEDIA_INVALID", "Native source_jpeg bytes failed full decode.", error);
    }
    await seam.afterDecode?.(absolutePath);
    const descriptorAfterDecode = await assertPinnedStablePhase(
      handle,
      input,
      absolutePath,
      rootBefore,
      fileBefore,
      GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
    );
    const pinned = new PinnedGrandHallT554SourceJpeg(
      input,
      absolutePath,
      rootBefore,
      fileBefore,
      descriptorAfterDecode,
      handle,
      bytes,
      decoded,
      seam,
    );
    handle = undefined;
    bytes = undefined;
    decoded = undefined;
    return pinned;
  } catch (error) {
    bytes?.fill(0);
    decoded?.pixels.fill(0);
    if (error instanceof GrandHallT554NativeMediaKernelError) throw error;
    throw fail("SOURCE_INVALID", "Native source descriptor epoch could not be opened safely.", error);
  } finally {
    await handle?.close();
  }
}

async function verifySourceJpeg(
  input: GrandHallT554NativeMediaInput,
  seam: GrandHallT554NativeMediaKernelTestSeam,
): Promise<GrandHallT554VerifiedSourceJpeg> {
  const verified = await verifyMedia(input, SOURCE_JPEG_POLICY, seam);
  return Object.freeze({ kind: "source_jpeg" as const,
    ...commonResult(verified.input, verified.bytes, seam) });
}

async function verifyMaskPng(
  input: GrandHallT554NativeMediaInput,
  seam: GrandHallT554NativeMediaKernelTestSeam,
): Promise<GrandHallT554VerifiedMaskPng> {
  const verified = await verifyMedia(input, MASK_PNG_POLICY, seam);
  return Object.freeze({ kind: "frozen_binary_mask" as const,
    ...commonResult(verified.input, verified.bytes, seam), ...verified.decoded });
}

async function verifyMaskEvidence(
  maskInput: GrandHallT554NativeMediaInput,
  reasonMapInput: GrandHallT554NativeMediaInput,
  seam: GrandHallT554NativeMediaKernelTestSeam,
): Promise<GrandHallT554VerifiedMaskEvidence> {
  let mask: PinnedVerifiedMedia<GrandHallT554MaskPixelCounts> | undefined;
  let reasonMap:
    PinnedVerifiedMedia<GrandHallT554MaskReasonMapCounts> | undefined;
  let result: GrandHallT554VerifiedMaskEvidence | undefined;
  let operationError: unknown;
  try {
    mask = await openPinnedVerifiedMedia(maskInput, MASK_PNG_POLICY, seam);
    reasonMap = await openPinnedVerifiedMedia(
      reasonMapInput,
      MASK_REASON_MAP_PNG_POLICY,
      seam,
    );
    if (
      comparablePath(mask.input.sourceRoot) !== comparablePath(reasonMap.input.sourceRoot) ||
      mask.input.fileName === reasonMap.input.fileName
    ) {
      throw fail(
        "ARGUMENT_INVALID",
        "Mask and reason-map evidence must be distinct files in one exact local source root.",
      );
    }
    let facts: GrandHallT554MaskEvidencePixelCounts;
    try {
      facts = await validateGrandHallT554MaskEvidencePngBytes(mask.bytes, reasonMap.bytes);
    } catch (error) {
      throw fail(
        "MEDIA_INVALID",
        "Native binary mask and reason map failed exact source-aligned decode.",
        error,
      );
    }
    await Promise.all([
      assertPinnedVerifiedMediaStable(mask),
      assertPinnedVerifiedMediaStable(reasonMap),
    ]);
    result = Object.freeze({
      kind: "frozen_mask_evidence" as const,
      mask: Object.freeze({ fileName: mask.input.fileName,
        sha256: mask.input.expectedSha256, byteLength: mask.input.expectedByteLength }),
      reasonMap: Object.freeze({ fileName: reasonMap.input.fileName,
        sha256: reasonMap.input.expectedSha256,
        byteLength: reasonMap.input.expectedByteLength }),
      includedPixelCount: facts.includedPixelCount,
      excludedPixelCount: facts.excludedPixelCount,
      reasonSampleCounts: facts.reasonSampleCounts,
      pixelTileInventorySha256: facts.pixelTileInventorySha256,
    });
  } catch (error) {
    operationError = error;
  }
  let cleanupError: unknown;
  try {
    const handles = [mask?.handle, reasonMap?.handle].filter(
      (handle): handle is FileHandle => handle !== undefined,
    );
    const closeResults = await Promise.allSettled(handles.map(async (handle) => handle.close()));
    const buffers = [mask?.bytes, reasonMap?.bytes].filter(
      (bytes): bytes is Buffer => bytes !== undefined,
    );
    buffers.forEach((bytes) => { bytes.fill(0); });
    await seam.afterTransientBuffersDestroyed?.({
      rawBytesWereZeroed: buffers.every((bytes) => bytes.every((value) => value === 0)),
    });
    if (closeResults.some((result) => result.status === "rejected")) {
      throw fail("SOURCE_INVALID", "Pinned mask-evidence descriptors could not be closed.");
    }
    const media: PinnedVerifiedMedia<unknown>[] = [];
    if (mask !== undefined) media.push(mask);
    if (reasonMap !== undefined) media.push(reasonMap);
    await Promise.all(media.map(assertClosedVerifiedMediaPathStable));
  } catch (error) {
    cleanupError = error;
  }
  if (operationError instanceof Error) throw operationError;
  if (operationError !== undefined) {
    throw fail("SOURCE_INVALID", "Mask-evidence verification failed with a non-error value.");
  }
  if (cleanupError instanceof Error) throw cleanupError;
  if (cleanupError !== undefined) {
    throw fail("SOURCE_INVALID", "Mask-evidence cleanup failed with a non-error value.");
  }
  if (result === undefined) {
    throw fail("SOURCE_INVALID", "Mask-evidence verification produced no bounded result.");
  }
  return result;
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

export function verifyGrandHallT554NativeMaskEvidence(
  maskInput: GrandHallT554NativeMediaInput,
  reasonMapInput: GrandHallT554NativeMediaInput,
): Promise<GrandHallT554VerifiedMaskEvidence> {
  return verifyMaskEvidence(maskInput, reasonMapInput, {});
}

export function openGrandHallT554PinnedNativeSourceJpeg(
  input: GrandHallT554NativeMediaInput,
): Promise<GrandHallT554PinnedSourceJpeg> {
  return openPinnedSourceJpeg(input, {});
}

export const __testOnlyGrandHallT554NativeMediaKernel = /* @__PURE__ */ Object.freeze({
  verifySourceJpeg,
  verifyMaskPng,
  verifyMaskEvidence,
  openPinnedSourceJpeg,
});

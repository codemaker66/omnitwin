import { createHash } from "node:crypto";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_HASH_BUFFER_BYTES = 8 * 1024 * 1024;
export const FOUNDRY_MAX_HASH_HEAD_BYTES = 64 * 1024;

export interface StreamedFileDigest {
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface StreamedFileDigestWithHead extends StreamedFileDigest {
  readonly headBytes: Uint8Array;
  readonly modifiedAt: string;
}

export interface ExpectedRegularFileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

/**
 * Receives each byte range immediately after it is added to the file digest.
 * The view is reused by the next read, so observers must consume or copy it
 * synchronously and must not retain it.
 */
export type StreamedFileChunkObserver = (
  chunk: Uint8Array,
  absoluteOffset: number,
) => void;

/**
 * Runs bounded random-access inspection against the same already-open handle
 * whose complete byte stream was hashed. The completed SHA-256 is supplied so
 * derived observations can remain bound to that exact stream. The observer
 * must not close or retain the handle and must use explicit read positions.
 */
export type OpenRegularFileObserver = (
  handle: FileHandle,
  sizeBytes: number,
  sourceSha256: string,
) => Promise<void>;

function unchanged(
  before: ExpectedRegularFileIdentity,
  after: ExpectedRegularFileIdentity,
): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

function assertBoundedHeadBytes(headBytes: number): void {
  if (
    !Number.isSafeInteger(headBytes) ||
    headBytes < 0 ||
    headBytes > FOUNDRY_MAX_HASH_HEAD_BYTES
  ) {
    throw new FoundryIntegrityError(
      "HASH_HEAD_OUT_OF_BOUNDS",
      `Requested bounded head must be between 0 and ${String(FOUNDRY_MAX_HASH_HEAD_BYTES)} bytes.`,
    );
  }
}

function assertHashNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new FoundryIntegrityError(
      "HASH_CANCELLED",
      "The read-only file fingerprint was cancelled.",
    );
  }
}

export async function sha256RegularFileWithHead(
  path: string,
  headBytes: number,
  expectedIdentity?: ExpectedRegularFileIdentity,
  signal?: AbortSignal,
  observeChunk?: StreamedFileChunkObserver,
  observeOpenHandle?: OpenRegularFileObserver,
): Promise<StreamedFileDigestWithHead> {
  assertBoundedHeadBytes(headBytes);
  assertHashNotCancelled(signal);
  const pathBeforeOpen = await lstat(path);
  assertHashNotCancelled(signal);
  if (pathBeforeOpen.isSymbolicLink() || !pathBeforeOpen.isFile()) {
    throw new FoundryIntegrityError(
      "HASH_NON_REGULAR_FILE",
      `Cannot hash a symbolic link or non-regular file: ${path}`,
    );
  }
  if (!Number.isSafeInteger(pathBeforeOpen.size) || pathBeforeOpen.size < 0) {
    throw new FoundryIntegrityError("HASH_FILE_TOO_LARGE", `File size cannot be represented safely: ${path}`);
  }
  if (expectedIdentity !== undefined && !unchanged(expectedIdentity, pathBeforeOpen)) {
    throw new FoundryIntegrityError(
      "SOURCE_IDENTITY_CHANGED_BEFORE_HASH",
      `Source identity changed after discovery and before hashing: ${path}`,
    );
  }
  const handle = await open(path, "r");
  try {
    assertHashNotCancelled(signal);
    const before = await handle.stat();
    if (!before.isFile() || !unchanged(pathBeforeOpen, before)) {
      throw new FoundryIntegrityError(
        "SOURCE_PATH_CHANGED_BEFORE_HASH",
        `Source path changed or became a symbolic link before hashing: ${path}`,
      );
    }
    const pathAfterOpen = await lstat(path);
    if (pathAfterOpen.isSymbolicLink() || !pathAfterOpen.isFile() || !unchanged(before, pathAfterOpen)) {
      throw new FoundryIntegrityError(
        "SOURCE_PATH_CHANGED_BEFORE_HASH",
        `Source path changed or became a symbolic link before hashing: ${path}`,
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(FOUNDRY_HASH_BUFFER_BYTES);
    const retainedHead = Buffer.allocUnsafe(Math.min(headBytes, before.size));
    let retainedHeadBytes = 0;
    let position = 0;
    for (;;) {
      assertHashNotCancelled(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      assertHashNotCancelled(signal);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      observeChunk?.(buffer.subarray(0, bytesRead), position);
      const headBytesRemaining = retainedHead.length - retainedHeadBytes;
      if (headBytesRemaining > 0) {
        const copied = Math.min(bytesRead, headBytesRemaining);
        buffer.copy(retainedHead, retainedHeadBytes, 0, copied);
        retainedHeadBytes += copied;
      }
      position += bytesRead;
    }
    assertHashNotCancelled(signal);
    if (position !== before.size) {
      throw new FoundryIntegrityError("SOURCE_CHANGED_DURING_HASH", `Source changed while hashing: ${path}`);
    }
    const sourceSha256 = digest.digest("hex");
    await observeOpenHandle?.(handle, before.size, sourceSha256);
    assertHashNotCancelled(signal);
    const after = await handle.stat();
    if (!unchanged(before, after) || position !== after.size) {
      throw new FoundryIntegrityError("SOURCE_CHANGED_DURING_HASH", `Source changed while hashing: ${path}`);
    }
    const pathAfter = await lstat(path);
    assertHashNotCancelled(signal);
    if (pathAfter.isSymbolicLink() || !pathAfter.isFile() || !unchanged(after, pathAfter)) {
      throw new FoundryIntegrityError(
        "SOURCE_PATH_CHANGED_DURING_HASH",
        `Source path changed or became a symbolic link while hashing: ${path}`,
      );
    }
    return {
      sha256: sourceSha256,
      sizeBytes: after.size,
      headBytes: retainedHead,
      modifiedAt: after.mtime.toISOString(),
    };
  } finally {
    await handle.close();
  }
}

export async function sha256RegularFile(path: string): Promise<StreamedFileDigest> {
  const digest = await sha256RegularFileWithHead(path, 0);
  return { sha256: digest.sha256, sizeBytes: digest.sizeBytes };
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

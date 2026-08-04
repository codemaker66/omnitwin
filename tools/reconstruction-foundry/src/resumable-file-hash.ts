import {
  createHash,
  createHmac,
  createSecretKey,
  KeyObject,
  timingSafeEqual,
} from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, normalize, resolve } from "node:path";
import { createSHA256 } from "hash-wasm";

export const RESUMABLE_FILE_HASH_CHECKPOINT_DOMAIN =
  "omnitwin.reconstruction-foundry/resumable-sha256-checkpoint/v2";
export const RESUMABLE_FILE_HASH_CHECKPOINT_VERSION = "2";
export const RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION =
  "hash-wasm@4.12.0/sha256-save-v2";
export const RESUMABLE_FILE_HASH_DEFAULT_READ_BUFFER_BYTES = 8 * 1024 * 1024;
export const RESUMABLE_FILE_HASH_DEFAULT_CHECKPOINT_INTERVAL_BYTES = 64 * 1024 * 1024;
export const RESUMABLE_FILE_HASH_MAX_READ_BUFFER_BYTES = 64 * 1024 * 1024;
export const RESUMABLE_FILE_HASH_MIN_READ_BUFFER_BYTES = 64 * 1024;
export const RESUMABLE_FILE_HASH_MIN_CHECKPOINT_INTERVAL_BYTES = 1024 * 1024;

const CHECKPOINT_DIGEST_DOMAIN =
  "omnitwin.reconstruction-foundry/resumable-sha256-checkpoint-self-digest/v2";
const CHECKPOINT_AUTHENTICATION_DOMAIN =
  "omnitwin.reconstruction-foundry/resumable-sha256-checkpoint-authentication/v2";
const MAX_CHECKPOINT_STATE_BASE64_LENGTH = 128 * 1024;
const MAX_IDENTITY_DECIMAL_LENGTH = 40;
const MAX_AUTHENTICATION_KEY_ID_LENGTH = 128;
const MAX_AUTHENTICATION_CONTEXT_LENGTH = 256;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const SIGNED_INTEGER_PATTERN = /^(?:0|-?[1-9][0-9]*)$/u;
const SAFE_AUTHENTICATION_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/u;

export interface ResumableFileIdentity {
  readonly deviceId: string;
  readonly inode: string;
  readonly sizeBytes: number;
  readonly modifiedTimeNanoseconds: string;
  readonly statusChangedTimeNanoseconds: string;
}

/**
 * An authenticated resumable hash checkpoint. `hashStateBase64` is an opaque hash-wasm state
 * snapshot. It can contain plaintext bytes from the source and therefore must
 * be protected, retained, transmitted, and deleted as sensitively as the
 * source file itself. The self-digest detects corruption; it is not a digital
 * signature and does not make an untrusted checkpoint authoritative.
 */
export interface ResumableFileHashCheckpoint {
  readonly domain: typeof RESUMABLE_FILE_HASH_CHECKPOINT_DOMAIN;
  readonly checkpointVersion: typeof RESUMABLE_FILE_HASH_CHECKPOINT_VERSION;
  readonly implementationVersion: typeof RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION;
  /** Non-secret identifier for key rotation; the key itself is never serialized. */
  readonly keyId: string;
  /** Non-secret job/tenant context that prevents cross-context replay. */
  readonly context: string;
  readonly relativePath: string;
  readonly expectedSizeBytes: number;
  readonly expectedSha256: string;
  readonly fileIdentity: ResumableFileIdentity;
  readonly confirmedOffsetBytes: number;
  /** Sensitive opaque state; handle it with the same controls as source data. */
  readonly hashStateBase64: string;
  /** Public corruption diagnostic; authentication is provided by the HMAC below. */
  readonly checkpointSha256: string;
  readonly authenticationHmacSha256: string;
}

export interface ResumableFileHashCheckpointAuthentication {
  /** Secret HMAC key. Byte arrays must contain at least 32 bytes. */
  readonly key: KeyObject | Uint8Array;
  /** Bounded, safe, non-secret key identifier serialized into the checkpoint. */
  readonly keyId: string;
  /** Bounded, safe, non-secret anti-replay context serialized into the checkpoint. */
  readonly context: string;
}

export interface ResumableFileHashProgress {
  readonly relativePath: string;
  readonly expectedSizeBytes: number;
  readonly resumedFromBytes: number;
  readonly currentOffsetBytes: number;
  readonly bytesReadThisAttempt: number;
  /** Bytes represented by a checkpoint whose persistence callback resolved. */
  readonly durablyConfirmedBytes: number;
}

export interface ResumableFileHashResult extends ResumableFileHashProgress {
  readonly verified: true;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly fileIdentity: ResumableFileIdentity;
}

export type ResumableFileHashErrorCode =
  | "HASH_ARGUMENT_INVALID"
  | "HASH_PATH_NOT_ABSOLUTE"
  | "HASH_RELATIVE_PATH_UNSAFE"
  | "HASH_CANCELLED"
  | "HASH_SOURCE_UNAVAILABLE"
  | "HASH_SOURCE_SYMLINK"
  | "HASH_SOURCE_NON_REGULAR"
  | "HASH_SOURCE_TOO_LARGE"
  | "HASH_SOURCE_SIZE_MISMATCH"
  | "HASH_SOURCE_IDENTITY_CHANGED"
  | "HASH_CHECKPOINT_INVALID"
  | "HASH_CHECKPOINT_INTEGRITY_MISMATCH"
  | "HASH_CHECKPOINT_AUTHENTICATION_REQUIRED"
  | "HASH_CHECKPOINT_AUTHENTICATION_INVALID"
  | "HASH_CHECKPOINT_AUTHENTICATION_MISMATCH"
  | "HASH_CHECKPOINT_BINDING_MISMATCH"
  | "HASH_CHECKPOINT_STATE_INVALID"
  | "HASH_CHECKPOINT_PERSIST_FAILED"
  | "HASH_PROGRESS_CALLBACK_FAILED"
  | "HASH_RESUME_RESTART_REQUIRED"
  | "HASH_DIGEST_MISMATCH";

export class ResumableFileHashError extends Error {
  readonly code: ResumableFileHashErrorCode;
  readonly progress: ResumableFileHashProgress | null;

  constructor(
    code: ResumableFileHashErrorCode,
    message: string,
    progress: ResumableFileHashProgress | null = null,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ResumableFileHashError";
    this.code = code;
    this.progress = progress;
  }
}

export interface VerifyResumableSha256FileOptions {
  /** Absolute path retained inside the local daemon; never copied to a checkpoint. */
  readonly absolutePath: string;
  /** Traversal-free POSIX path used for receipts and checkpoint binding. */
  readonly relativePath: string;
  readonly expectedSizeBytes: number;
  /** Canonical lowercase SHA-256 hex without a `sha256:` prefix. */
  readonly expectedSha256: string;
  /** Untrusted persisted data is accepted here and validated before `load()`. */
  readonly checkpoint?: unknown;
  /** Required whenever `checkpoint` or `onCheckpoint` is present. Never serialized. */
  readonly checkpointAuthentication?: ResumableFileHashCheckpointAuthentication;
  /**
   * Explicit caller attestation required before a nonzero in-file resume. The
   * caller must know that device/inode/timestamps are strong and stable on this
   * local filesystem. Without it, the caller must restart from byte zero.
   */
  readonly resumeSafety?: "strong_identity_required";
  readonly checkpointIntervalBytes?: number;
  readonly readBufferBytes?: number;
  /** Allows sub-production I/O sizes only under NODE_ENV=test. */
  readonly testOnlyAllowSmallIo?: true;
  readonly signal?: AbortSignal;
  /**
   * Persist the sensitive checkpoint before resolving. The byte offset is not
   * reported as durable until the returned promise (or thenable) has resolved.
   */
  readonly onCheckpoint?: (
    checkpoint: ResumableFileHashCheckpoint,
  ) => void | PromiseLike<void>;
  readonly onProgress?: (
    progress: ResumableFileHashProgress,
  ) => void | PromiseLike<void>;
}

interface CheckpointCorePayload {
  readonly domain: typeof RESUMABLE_FILE_HASH_CHECKPOINT_DOMAIN;
  readonly checkpointVersion: typeof RESUMABLE_FILE_HASH_CHECKPOINT_VERSION;
  readonly implementationVersion: typeof RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION;
  readonly keyId: string;
  readonly context: string;
  readonly relativePath: string;
  readonly expectedSizeBytes: number;
  readonly expectedSha256: string;
  readonly fileIdentity: ResumableFileIdentity;
  readonly confirmedOffsetBytes: number;
  readonly hashStateBase64: string;
}

interface AuthenticatedCheckpointPayload extends CheckpointCorePayload {
  readonly checkpointSha256: string;
}

interface NormalizedCheckpointAuthentication {
  readonly key: KeyObject;
  readonly keyId: string;
  readonly context: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
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
    value.length > 2048 ||
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
  return value.split("/").every((part) => {
    const windowsStem = part.split(".", 1)[0]?.toUpperCase() ?? "";
    return (
      part !== "" &&
      part !== "." &&
      part !== ".." &&
      !part.endsWith(".") &&
      !part.endsWith(" ") &&
      !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsStem)
    );
  });
}

function assertSafeInteger(value: unknown, label: string, minimum = 0): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new ResumableFileHashError(
      "HASH_ARGUMENT_INVALID",
      `${label} must be a safe integer greater than or equal to ${String(minimum)}.`,
    );
  }
}

function assertCanonicalSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new ResumableFileHashError(
      "HASH_ARGUMENT_INVALID",
      `${label} must be exactly 64 lowercase hexadecimal characters.`,
    );
  }
}

function comparablePath(value: string): string {
  const withoutExtendedPrefix = normalize(value).replace(/^\\\\\?\\/u, "");
  return process.platform === "win32" ? withoutExtendedPrefix.toLowerCase() : withoutExtendedPrefix;
}

function identityFromStats(stats: BigIntStats): ResumableFileIdentity {
  if (stats.size < 0n || stats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ResumableFileHashError(
      "HASH_SOURCE_TOO_LARGE",
      "The source size cannot be represented exactly by this verifier.",
    );
  }
  const deviceId = stats.dev.toString(10);
  const inode = stats.ino.toString(10);
  const modifiedTimeNanoseconds = stats.mtimeNs.toString(10);
  const statusChangedTimeNanoseconds = stats.ctimeNs.toString(10);
  if (
    deviceId.length > MAX_IDENTITY_DECIMAL_LENGTH ||
    inode.length > MAX_IDENTITY_DECIMAL_LENGTH ||
    modifiedTimeNanoseconds.length > MAX_IDENTITY_DECIMAL_LENGTH ||
    statusChangedTimeNanoseconds.length > MAX_IDENTITY_DECIMAL_LENGTH ||
    !UNSIGNED_INTEGER_PATTERN.test(deviceId) ||
    !UNSIGNED_INTEGER_PATTERN.test(inode) ||
    !SIGNED_INTEGER_PATTERN.test(modifiedTimeNanoseconds) ||
    !SIGNED_INTEGER_PATTERN.test(statusChangedTimeNanoseconds)
  ) {
    throw new ResumableFileHashError(
      "HASH_SOURCE_TOO_LARGE",
      "The source identity cannot be represented safely by this verifier.",
    );
  }
  return Object.freeze({
    deviceId,
    inode,
    sizeBytes: Number(stats.size),
    modifiedTimeNanoseconds,
    statusChangedTimeNanoseconds,
  });
}

function sameIdentity(left: ResumableFileIdentity, right: ResumableFileIdentity): boolean {
  return (
    left.deviceId === right.deviceId &&
    left.inode === right.inode &&
    left.sizeBytes === right.sizeBytes &&
    left.modifiedTimeNanoseconds === right.modifiedTimeNanoseconds &&
    left.statusChangedTimeNanoseconds === right.statusChangedTimeNanoseconds
  );
}

function checkpointCorePayload(checkpoint: ResumableFileHashCheckpoint): CheckpointCorePayload {
  return {
    domain: checkpoint.domain,
    checkpointVersion: checkpoint.checkpointVersion,
    implementationVersion: checkpoint.implementationVersion,
    keyId: checkpoint.keyId,
    context: checkpoint.context,
    relativePath: checkpoint.relativePath,
    expectedSizeBytes: checkpoint.expectedSizeBytes,
    expectedSha256: checkpoint.expectedSha256,
    fileIdentity: {
      deviceId: checkpoint.fileIdentity.deviceId,
      inode: checkpoint.fileIdentity.inode,
      sizeBytes: checkpoint.fileIdentity.sizeBytes,
      modifiedTimeNanoseconds: checkpoint.fileIdentity.modifiedTimeNanoseconds,
      statusChangedTimeNanoseconds: checkpoint.fileIdentity.statusChangedTimeNanoseconds,
    },
    confirmedOffsetBytes: checkpoint.confirmedOffsetBytes,
    hashStateBase64: checkpoint.hashStateBase64,
  };
}

function authenticatedCheckpointPayload(
  checkpoint: ResumableFileHashCheckpoint,
): AuthenticatedCheckpointPayload {
  return {
    ...checkpointCorePayload(checkpoint),
    checkpointSha256: checkpoint.checkpointSha256,
  };
}

function digestCheckpointPayload(payload: CheckpointCorePayload): string {
  return createHash("sha256")
    .update(CHECKPOINT_DIGEST_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

function authenticateCheckpointPayload(
  payload: AuthenticatedCheckpointPayload,
  authentication: NormalizedCheckpointAuthentication,
): string {
  return createHmac("sha256", authentication.key)
    .update(CHECKPOINT_AUTHENTICATION_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

function isSafeAuthenticationLabel(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    value.normalize("NFC") === value &&
    SAFE_AUTHENTICATION_LABEL_PATTERN.test(value)
  );
}

function normalizeCheckpointAuthentication(
  value: unknown,
): NormalizedCheckpointAuthentication {
  if (value === undefined) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_AUTHENTICATION_REQUIRED",
      "Authenticated checkpoint use requires checkpointAuthentication.",
    );
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["key", "keyId", "context"]) ||
    !isSafeAuthenticationLabel(value.keyId, MAX_AUTHENTICATION_KEY_ID_LENGTH) ||
    !isSafeAuthenticationLabel(value.context, MAX_AUTHENTICATION_CONTEXT_LENGTH)
  ) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_AUTHENTICATION_INVALID",
      "Checkpoint authentication must contain an exact bounded key, keyId, and context.",
    );
  }
  let key: KeyObject;
  if (value.key instanceof Uint8Array) {
    if (value.key.byteLength < 32) {
      throw new ResumableFileHashError(
        "HASH_CHECKPOINT_AUTHENTICATION_INVALID",
        "Checkpoint authentication byte keys must contain at least 32 bytes.",
      );
    }
    key = createSecretKey(value.key);
  } else if (value.key instanceof KeyObject) {
    if (
      value.key.type !== "secret" ||
      value.key.symmetricKeySize === undefined ||
      value.key.symmetricKeySize < 32
    ) {
      throw new ResumableFileHashError(
        "HASH_CHECKPOINT_AUTHENTICATION_INVALID",
        "Checkpoint authentication KeyObjects must be secret keys of at least 32 bytes.",
      );
    }
    key = value.key;
  } else {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_AUTHENTICATION_INVALID",
      "Checkpoint authentication requires a KeyObject or Uint8Array key.",
    );
  }
  return Object.freeze({ key, keyId: value.keyId, context: value.context });
}

function cloneAndFreezeIdentity(identity: ResumableFileIdentity): ResumableFileIdentity {
  return Object.freeze({ ...identity });
}

function freezeCheckpoint(checkpoint: ResumableFileHashCheckpoint): ResumableFileHashCheckpoint {
  return Object.freeze({
    ...checkpoint,
    fileIdentity: cloneAndFreezeIdentity(checkpoint.fileIdentity),
  });
}

function parseIdentity(value: unknown): ResumableFileIdentity {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "deviceId",
      "inode",
      "sizeBytes",
      "modifiedTimeNanoseconds",
      "statusChangedTimeNanoseconds",
    ]) ||
    typeof value.deviceId !== "string" ||
    value.deviceId.length > MAX_IDENTITY_DECIMAL_LENGTH ||
    !UNSIGNED_INTEGER_PATTERN.test(value.deviceId) ||
    typeof value.inode !== "string" ||
    value.inode.length > MAX_IDENTITY_DECIMAL_LENGTH ||
    !UNSIGNED_INTEGER_PATTERN.test(value.inode) ||
    typeof value.sizeBytes !== "number" ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 0 ||
    typeof value.modifiedTimeNanoseconds !== "string" ||
    value.modifiedTimeNanoseconds.length > MAX_IDENTITY_DECIMAL_LENGTH ||
    !SIGNED_INTEGER_PATTERN.test(value.modifiedTimeNanoseconds) ||
    typeof value.statusChangedTimeNanoseconds !== "string" ||
    value.statusChangedTimeNanoseconds.length > MAX_IDENTITY_DECIMAL_LENGTH ||
    !SIGNED_INTEGER_PATTERN.test(value.statusChangedTimeNanoseconds)
  ) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_INVALID",
      "The checkpoint contains an invalid file identity.",
    );
  }
  return Object.freeze({
    deviceId: value.deviceId,
    inode: value.inode,
    sizeBytes: value.sizeBytes,
    modifiedTimeNanoseconds: value.modifiedTimeNanoseconds,
    statusChangedTimeNanoseconds: value.statusChangedTimeNanoseconds,
  });
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length > MAX_CHECKPOINT_STATE_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_STATE_INVALID",
      "The checkpoint hash state is not canonical bounded base64.",
    );
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_STATE_INVALID",
      "The checkpoint hash state is not canonical base64.",
    );
  }
  return decoded;
}

function validateCheckpointWithAuthentication(
  value: unknown,
  authentication: NormalizedCheckpointAuthentication,
): ResumableFileHashCheckpoint {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "domain",
      "checkpointVersion",
      "implementationVersion",
      "keyId",
      "context",
      "relativePath",
      "expectedSizeBytes",
      "expectedSha256",
      "fileIdentity",
      "confirmedOffsetBytes",
      "hashStateBase64",
      "checkpointSha256",
      "authenticationHmacSha256",
    ])
  ) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_INVALID",
      "The resumable hash checkpoint has an invalid shape.",
    );
  }
  if (
    value.domain !== RESUMABLE_FILE_HASH_CHECKPOINT_DOMAIN ||
    value.checkpointVersion !== RESUMABLE_FILE_HASH_CHECKPOINT_VERSION ||
    value.implementationVersion !== RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION ||
    !isSafeAuthenticationLabel(value.keyId, MAX_AUTHENTICATION_KEY_ID_LENGTH) ||
    !isSafeAuthenticationLabel(value.context, MAX_AUTHENTICATION_CONTEXT_LENGTH) ||
    typeof value.relativePath !== "string" ||
    !isSafeRelativePath(value.relativePath) ||
    typeof value.expectedSizeBytes !== "number" ||
    !Number.isSafeInteger(value.expectedSizeBytes) ||
    value.expectedSizeBytes < 0 ||
    typeof value.expectedSha256 !== "string" ||
    !SHA256_PATTERN.test(value.expectedSha256) ||
    typeof value.confirmedOffsetBytes !== "number" ||
    !Number.isSafeInteger(value.confirmedOffsetBytes) ||
    value.confirmedOffsetBytes < 0 ||
    value.confirmedOffsetBytes > value.expectedSizeBytes ||
    typeof value.hashStateBase64 !== "string" ||
    typeof value.checkpointSha256 !== "string" ||
    !SHA256_PATTERN.test(value.checkpointSha256) ||
    typeof value.authenticationHmacSha256 !== "string" ||
    !SHA256_PATTERN.test(value.authenticationHmacSha256)
  ) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_INVALID",
      "The resumable hash checkpoint contains an invalid field.",
    );
  }
  const fileIdentity = parseIdentity(value.fileIdentity);
  if (fileIdentity.sizeBytes !== value.expectedSizeBytes) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_INVALID",
      "The checkpoint file identity size does not match its expected size.",
    );
  }
  const structurallyValidatedState = decodeCanonicalBase64(value.hashStateBase64);
  structurallyValidatedState.fill(0);
  const checkpoint = freezeCheckpoint({
    domain: RESUMABLE_FILE_HASH_CHECKPOINT_DOMAIN,
    checkpointVersion: RESUMABLE_FILE_HASH_CHECKPOINT_VERSION,
    implementationVersion: RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION,
    keyId: value.keyId,
    context: value.context,
    relativePath: value.relativePath,
    expectedSizeBytes: value.expectedSizeBytes,
    expectedSha256: value.expectedSha256,
    fileIdentity,
    confirmedOffsetBytes: value.confirmedOffsetBytes,
    hashStateBase64: value.hashStateBase64,
    checkpointSha256: value.checkpointSha256,
    authenticationHmacSha256: value.authenticationHmacSha256,
  });
  if (digestCheckpointPayload(checkpointCorePayload(checkpoint)) !== checkpoint.checkpointSha256) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_INTEGRITY_MISMATCH",
      "The resumable hash checkpoint self-digest does not match.",
    );
  }
  const expectedAuthentication = Buffer.from(
    authenticateCheckpointPayload(authenticatedCheckpointPayload(checkpoint), authentication),
    "hex",
  );
  const suppliedAuthentication = Buffer.from(checkpoint.authenticationHmacSha256, "hex");
  const authenticationMatches = timingSafeEqual(
    expectedAuthentication,
    suppliedAuthentication,
  );
  expectedAuthentication.fill(0);
  suppliedAuthentication.fill(0);
  if (
    !authenticationMatches ||
    checkpoint.keyId !== authentication.keyId ||
    checkpoint.context !== authentication.context
  ) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_AUTHENTICATION_MISMATCH",
      "The checkpoint authentication, key identifier, or anti-replay context does not match.",
    );
  }
  return checkpoint;
}

/** Validates v2 structure, corruption digest, HMAC, key identifier, and context. */
export function validateResumableFileHashCheckpoint(
  value: unknown,
  checkpointAuthentication: ResumableFileHashCheckpointAuthentication,
): ResumableFileHashCheckpoint {
  return validateCheckpointWithAuthentication(
    value,
    normalizeCheckpointAuthentication(checkpointAuthentication),
  );
}

function buildCheckpoint(
  relativePath: string,
  expectedSizeBytes: number,
  expectedSha256: string,
  fileIdentity: ResumableFileIdentity,
  confirmedOffsetBytes: number,
  hashState: Uint8Array,
  authentication: NormalizedCheckpointAuthentication,
): ResumableFileHashCheckpoint {
  const stateBuffer = Buffer.from(
    hashState.buffer,
    hashState.byteOffset,
    hashState.byteLength,
  );
  const withoutDigest: CheckpointCorePayload = {
    domain: RESUMABLE_FILE_HASH_CHECKPOINT_DOMAIN,
    checkpointVersion: RESUMABLE_FILE_HASH_CHECKPOINT_VERSION,
    implementationVersion: RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION,
    keyId: authentication.keyId,
    context: authentication.context,
    relativePath,
    expectedSizeBytes,
    expectedSha256,
    fileIdentity: cloneAndFreezeIdentity(fileIdentity),
    confirmedOffsetBytes,
    hashStateBase64: stateBuffer.toString("base64"),
  };
  const withDigest: AuthenticatedCheckpointPayload = {
    ...withoutDigest,
    checkpointSha256: digestCheckpointPayload(withoutDigest),
  };
  return freezeCheckpoint({
    ...withDigest,
    authenticationHmacSha256: authenticateCheckpointPayload(withDigest, authentication),
  });
}

function progressSnapshot(
  relativePath: string,
  expectedSizeBytes: number,
  resumedFromBytes: number,
  currentOffsetBytes: number,
  bytesReadThisAttempt: number,
  durablyConfirmedBytes: number,
): ResumableFileHashProgress {
  return Object.freeze({
    relativePath,
    expectedSizeBytes,
    resumedFromBytes,
    currentOffsetBytes,
    bytesReadThisAttempt,
    durablyConfirmedBytes,
  });
}

function assertNotCancelled(
  signal: AbortSignal | undefined,
  progress: ResumableFileHashProgress,
): void {
  if (signal?.aborted === true) {
    throw new ResumableFileHashError(
      "HASH_CANCELLED",
      `SHA-256 verification was cancelled for ${progress.relativePath}.`,
      progress,
    );
  }
}

async function currentPathIdentity(
  absolutePath: string,
  relativePath: string,
): Promise<ResumableFileIdentity> {
  let metadata: BigIntStats;
  try {
    metadata = await lstat(absolutePath, { bigint: true });
  } catch (error) {
    throw new ResumableFileHashError(
      "HASH_SOURCE_UNAVAILABLE",
      `The source is unavailable: ${relativePath}.`,
      null,
      error,
    );
  }
  if (metadata.isSymbolicLink()) {
    throw new ResumableFileHashError(
      "HASH_SOURCE_SYMLINK",
      `Symbolic links are not accepted for hashing: ${relativePath}.`,
    );
  }
  if (!metadata.isFile()) {
    throw new ResumableFileHashError(
      "HASH_SOURCE_NON_REGULAR",
      `Only a regular file can be hashed: ${relativePath}.`,
    );
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(absolutePath);
  } catch (error) {
    throw new ResumableFileHashError(
      "HASH_SOURCE_UNAVAILABLE",
      `The source cannot be resolved safely: ${relativePath}.`,
      null,
      error,
    );
  }
  if (comparablePath(canonicalPath) !== comparablePath(absolutePath)) {
    throw new ResumableFileHashError(
      "HASH_SOURCE_SYMLINK",
      `The source path contains a symbolic link or junction: ${relativePath}.`,
    );
  }
  return identityFromStats(metadata);
}

async function assertOpenFileIdentity(
  handle: Awaited<ReturnType<typeof open>>,
  absolutePath: string,
  relativePath: string,
  expectedIdentity: ResumableFileIdentity,
  progress: ResumableFileHashProgress,
): Promise<void> {
  let handleIdentity: ResumableFileIdentity;
  try {
    const handleMetadata = await handle.stat({ bigint: true });
    if (!handleMetadata.isFile()) {
      throw new ResumableFileHashError(
        "HASH_SOURCE_NON_REGULAR",
        `The opened source is not a regular file: ${relativePath}.`,
        progress,
      );
    }
    handleIdentity = identityFromStats(handleMetadata);
  } catch (error) {
    if (error instanceof ResumableFileHashError) throw error;
    throw new ResumableFileHashError(
      "HASH_SOURCE_UNAVAILABLE",
      `The opened source cannot be inspected: ${relativePath}.`,
      progress,
      error,
    );
  }
  let pathIdentity: ResumableFileIdentity;
  try {
    pathIdentity = await currentPathIdentity(absolutePath, relativePath);
  } catch (error) {
    if (error instanceof ResumableFileHashError) {
      throw new ResumableFileHashError(error.code, error.message, progress, error);
    }
    throw error;
  }
  if (
    !sameIdentity(expectedIdentity, handleIdentity) ||
    !sameIdentity(expectedIdentity, pathIdentity)
  ) {
    throw new ResumableFileHashError(
      "HASH_SOURCE_IDENTITY_CHANGED",
      `The source identity changed during SHA-256 verification: ${relativePath}.`,
      progress,
    );
  }
}

async function emitProgress(
  callback: VerifyResumableSha256FileOptions["onProgress"],
  progress: ResumableFileHashProgress,
): Promise<void> {
  if (callback === undefined) return;
  try {
    await callback(progress);
  } catch (error) {
    throw new ResumableFileHashError(
      "HASH_PROGRESS_CALLBACK_FAILED",
      `The progress callback failed for ${progress.relativePath}.`,
      progress,
      error,
    );
  }
}

function assertCheckpointBinding(
  checkpoint: ResumableFileHashCheckpoint,
  relativePath: string,
  expectedSizeBytes: number,
  expectedSha256: string,
  fileIdentity: ResumableFileIdentity,
): void {
  if (
    checkpoint.relativePath !== relativePath ||
    checkpoint.expectedSizeBytes !== expectedSizeBytes ||
    checkpoint.expectedSha256 !== expectedSha256 ||
    !sameIdentity(checkpoint.fileIdentity, fileIdentity)
  ) {
    throw new ResumableFileHashError(
      "HASH_CHECKPOINT_BINDING_MISMATCH",
      `The checkpoint does not belong to the exact source and receipt entry: ${relativePath}.`,
    );
  }
}

export async function verifyResumableSha256File(
  options: VerifyResumableSha256FileOptions,
): Promise<ResumableFileHashResult> {
  if (typeof options.absolutePath !== "string" || !isAbsolute(options.absolutePath)) {
    throw new ResumableFileHashError(
      "HASH_PATH_NOT_ABSOLUTE",
      "The daemon-internal source path must be absolute.",
    );
  }
  if (typeof options.relativePath !== "string" || !isSafeRelativePath(options.relativePath)) {
    throw new ResumableFileHashError(
      "HASH_RELATIVE_PATH_UNSAFE",
      "The receipt path must be a traversal-free relative POSIX path.",
    );
  }
  assertSafeInteger(options.expectedSizeBytes, "expectedSizeBytes");
  assertCanonicalSha256(options.expectedSha256, "expectedSha256");
  const allowSmallTestIo = options.testOnlyAllowSmallIo === true;
  if (allowSmallTestIo && process.env.NODE_ENV !== "test") {
    throw new ResumableFileHashError(
      "HASH_ARGUMENT_INVALID",
      "testOnlyAllowSmallIo is forbidden outside NODE_ENV=test.",
    );
  }
  const readBufferBytes =
    options.readBufferBytes ?? RESUMABLE_FILE_HASH_DEFAULT_READ_BUFFER_BYTES;
  assertSafeInteger(
    readBufferBytes,
    "readBufferBytes",
    allowSmallTestIo ? 1 : RESUMABLE_FILE_HASH_MIN_READ_BUFFER_BYTES,
  );
  if (readBufferBytes > RESUMABLE_FILE_HASH_MAX_READ_BUFFER_BYTES) {
    throw new ResumableFileHashError(
      "HASH_ARGUMENT_INVALID",
      `readBufferBytes cannot exceed ${String(RESUMABLE_FILE_HASH_MAX_READ_BUFFER_BYTES)}.`,
    );
  }
  const checkpointIntervalBytes =
    options.checkpointIntervalBytes ?? RESUMABLE_FILE_HASH_DEFAULT_CHECKPOINT_INTERVAL_BYTES;
  assertSafeInteger(
    checkpointIntervalBytes,
    "checkpointIntervalBytes",
    allowSmallTestIo ? 1 : RESUMABLE_FILE_HASH_MIN_CHECKPOINT_INTERVAL_BYTES,
  );
  if (options.onCheckpoint !== undefined && typeof options.onCheckpoint !== "function") {
    throw new ResumableFileHashError(
      "HASH_ARGUMENT_INVALID",
      "onCheckpoint must be a function when provided.",
    );
  }
  if (options.onProgress !== undefined && typeof options.onProgress !== "function") {
    throw new ResumableFileHashError(
      "HASH_ARGUMENT_INVALID",
      "onProgress must be a function when provided.",
    );
  }
  const checkpointingRequested =
    options.checkpoint !== undefined || options.onCheckpoint !== undefined;
  const checkpointAuthentication = checkpointingRequested
    ? normalizeCheckpointAuthentication(options.checkpointAuthentication)
    : null;

  const absolutePath = resolve(options.absolutePath);
  let resumedFromBytes = 0;
  let currentOffsetBytes = 0;
  let bytesReadThisAttempt = 0;
  let durablyConfirmedBytes = 0;
  let hasDurableCheckpoint = false;
  const snapshot = (): ResumableFileHashProgress =>
    progressSnapshot(
      options.relativePath,
      options.expectedSizeBytes,
      resumedFromBytes,
      currentOffsetBytes,
      bytesReadThisAttempt,
      durablyConfirmedBytes,
    );

  assertNotCancelled(options.signal, snapshot());
  const discoveredIdentity = await currentPathIdentity(absolutePath, options.relativePath);
  assertNotCancelled(options.signal, snapshot());
  if (discoveredIdentity.sizeBytes !== options.expectedSizeBytes) {
    throw new ResumableFileHashError(
      "HASH_SOURCE_SIZE_MISMATCH",
      `The source size does not match the exact expected size for ${options.relativePath}.`,
      snapshot(),
    );
  }

  let handle: Awaited<ReturnType<typeof open>>;
  let buffer: Buffer | undefined;
  try {
    handle = await open(absolutePath, "r");
  } catch (error) {
    throw new ResumableFileHashError(
      "HASH_SOURCE_UNAVAILABLE",
      `The source cannot be opened read-only: ${options.relativePath}.`,
      snapshot(),
      error,
    );
  }

  try {
    await assertOpenFileIdentity(
      handle,
      absolutePath,
      options.relativePath,
      discoveredIdentity,
      snapshot(),
    );
    assertNotCancelled(options.signal, snapshot());

    const hasher = await createSHA256();
    if (options.checkpoint === undefined) {
      hasher.init();
    } else {
      if (checkpointAuthentication === null) {
        throw new ResumableFileHashError(
          "HASH_CHECKPOINT_AUTHENTICATION_REQUIRED",
          "Checkpoint resume requires checkpointAuthentication.",
        );
      }
      const checkpoint = validateCheckpointWithAuthentication(
        options.checkpoint,
        checkpointAuthentication,
      );
      assertCheckpointBinding(
        checkpoint,
        options.relativePath,
        options.expectedSizeBytes,
        options.expectedSha256,
        discoveredIdentity,
      );
      if (
        checkpoint.confirmedOffsetBytes > 0 &&
        options.resumeSafety !== "strong_identity_required"
      ) {
        throw new ResumableFileHashError(
          "HASH_RESUME_RESTART_REQUIRED",
          `Resume is disabled until the caller attests strong local file identity for ${options.relativePath}; restart from byte zero.`,
          snapshot(),
        );
      }
      const state = decodeCanonicalBase64(checkpoint.hashStateBase64);
      try {
        hasher.load(state);
      } catch (error) {
        throw new ResumableFileHashError(
          "HASH_CHECKPOINT_STATE_INVALID",
          `The checkpoint state is incompatible with this verifier: ${options.relativePath}.`,
          snapshot(),
          error,
        );
      } finally {
        state.fill(0);
      }
      resumedFromBytes = checkpoint.confirmedOffsetBytes;
      currentOffsetBytes = checkpoint.confirmedOffsetBytes;
      durablyConfirmedBytes = checkpoint.confirmedOffsetBytes;
      hasDurableCheckpoint = true;
    }

    await emitProgress(options.onProgress, snapshot());
    assertNotCancelled(options.signal, snapshot());
    buffer = Buffer.allocUnsafe(readBufferBytes);
    let nextCheckpointOffset = Math.min(
      options.expectedSizeBytes,
      currentOffsetBytes + checkpointIntervalBytes,
    );

    const persistCheckpoint = async (): Promise<void> => {
      if (options.onCheckpoint === undefined) return;
      if (checkpointAuthentication === null) {
        throw new ResumableFileHashError(
          "HASH_CHECKPOINT_AUTHENTICATION_REQUIRED",
          "Checkpoint persistence requires checkpointAuthentication.",
          snapshot(),
        );
      }
      await assertOpenFileIdentity(
        handle,
        absolutePath,
        options.relativePath,
        discoveredIdentity,
        snapshot(),
      );
      assertNotCancelled(options.signal, snapshot());
      const savedState = hasher.save();
      let checkpoint: ResumableFileHashCheckpoint;
      try {
        checkpoint = buildCheckpoint(
          options.relativePath,
          options.expectedSizeBytes,
          options.expectedSha256,
          discoveredIdentity,
          currentOffsetBytes,
          savedState,
          checkpointAuthentication,
        );
      } finally {
        savedState.fill(0);
      }
      try {
        await options.onCheckpoint(checkpoint);
      } catch (error) {
        throw new ResumableFileHashError(
          "HASH_CHECKPOINT_PERSIST_FAILED",
          `The checkpoint was not confirmed as persisted for ${options.relativePath}.`,
          snapshot(),
          error,
        );
      }
      durablyConfirmedBytes = currentOffsetBytes;
      hasDurableCheckpoint = true;
      await emitProgress(options.onProgress, snapshot());
      await assertOpenFileIdentity(
        handle,
        absolutePath,
        options.relativePath,
        discoveredIdentity,
        snapshot(),
      );
      assertNotCancelled(options.signal, snapshot());
    };

    while (currentOffsetBytes < options.expectedSizeBytes) {
      assertNotCancelled(options.signal, snapshot());
      const bytesUntilEnd = options.expectedSizeBytes - currentOffsetBytes;
      const bytesUntilCheckpoint =
        options.onCheckpoint === undefined
          ? bytesUntilEnd
          : nextCheckpointOffset - currentOffsetBytes;
      const requestedBytes = Math.min(buffer.length, bytesUntilEnd, bytesUntilCheckpoint);
      let bytesRead: number;
      try {
        ({ bytesRead } = await handle.read(
          buffer,
          0,
          requestedBytes,
          currentOffsetBytes,
        ));
      } catch (error) {
        throw new ResumableFileHashError(
          "HASH_SOURCE_UNAVAILABLE",
          `The source could not be read: ${options.relativePath}.`,
          snapshot(),
          error,
        );
      }
      bytesReadThisAttempt += bytesRead;
      assertNotCancelled(options.signal, snapshot());
      if (bytesRead === 0) {
        throw new ResumableFileHashError(
          "HASH_SOURCE_SIZE_MISMATCH",
          `The source ended before its exact expected size: ${options.relativePath}.`,
          snapshot(),
        );
      }
      hasher.update(buffer.subarray(0, bytesRead));
      currentOffsetBytes += bytesRead;
      await emitProgress(options.onProgress, snapshot());
      assertNotCancelled(options.signal, snapshot());
      if (
        options.onCheckpoint !== undefined &&
        currentOffsetBytes === nextCheckpointOffset
      ) {
        await persistCheckpoint();
        nextCheckpointOffset = Math.min(
          options.expectedSizeBytes,
          currentOffsetBytes + checkpointIntervalBytes,
        );
      }
    }

    if (options.onCheckpoint !== undefined && !hasDurableCheckpoint) {
      await persistCheckpoint();
    }
    await assertOpenFileIdentity(
      handle,
      absolutePath,
      options.relativePath,
      discoveredIdentity,
      snapshot(),
    );
    assertNotCancelled(options.signal, snapshot());
    const sha256 = hasher.digest("hex");
    await assertOpenFileIdentity(
      handle,
      absolutePath,
      options.relativePath,
      discoveredIdentity,
      snapshot(),
    );
    assertNotCancelled(options.signal, snapshot());
    if (sha256 !== options.expectedSha256) {
      throw new ResumableFileHashError(
        "HASH_DIGEST_MISMATCH",
        `The source SHA-256 does not match the exact expected digest for ${options.relativePath}.`,
        snapshot(),
      );
    }
    return Object.freeze({
      ...snapshot(),
      verified: true,
      sha256,
      sizeBytes: discoveredIdentity.sizeBytes,
      fileIdentity: cloneAndFreezeIdentity(discoveredIdentity),
    });
  } finally {
    buffer?.fill(0);
    await handle.close();
  }
}

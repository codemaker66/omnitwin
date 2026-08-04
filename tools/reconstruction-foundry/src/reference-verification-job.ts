import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  assertSafeBundlePath,
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  RESUMABLE_FILE_HASH_CHECKPOINT_VERSION,
  RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION,
  ResumableFileHashError,
  type ResumableFileHashCheckpoint,
  type ResumableFileHashResult,
  type ResumableFileIdentity,
  validateResumableFileHashCheckpoint,
  verifyResumableSha256File,
} from "./resumable-file-hash.js";

export const REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0 = "reference_integrity_verify_v0";
export const REFERENCE_INTEGRITY_VERIFY_SCHEMA_V0 =
  "omnitwin.reference-integrity-verification/v0";
export const REFERENCE_INTEGRITY_VERIFY_AUTHORITY_V0 = "none";
export const REFERENCE_INTEGRITY_VERIFY_SOURCE_PAYLOAD_BYTES_STAGED_V0 = 0;
export const REFERENCE_INTEGRITY_VERIFY_MAX_ADMITTED_FILES_V0 = 500;

const SUBJECT_SCHEMA = "omnitwin.reference-integrity-verification-subject/v0";
const STATE_SCHEMA = "omnitwin.reference-integrity-verification-state/v0";
const CHECKPOINT_ENVELOPE_SCHEMA =
  "omnitwin.reference-integrity-verification-checkpoint-envelope/v0";
const RESULT_SCHEMA = "omnitwin.reference-integrity-verification-result/v0";
const OBSERVATION_SCHEMA = "omnitwin.reference-integrity-verification-observation/v0";
const INDEX_SCHEMA = "omnitwin.reference-integrity-verification-output-index/v0";
const LOCK_SCHEMA = "omnitwin.reference-integrity-verification-writer-lock/v0";
const TAKEOVER_CLAIM_SCHEMA =
  "omnitwin.reference-integrity-verification-writer-takeover-claim/v0";

const SUBJECT_DIGEST_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.SUBJECT.V0";
const SUBJECT_BINDING_DIGEST_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.SUBJECT_BINDING.V0";
const STATE_DIGEST_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.STATE.V0";
const CHECKPOINT_ENVELOPE_DIGEST_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.CHECKPOINT.V0";
const RESULT_DIGEST_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.RESULT.V0";
const INDEX_DIGEST_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.INDEX.V0";
const LOCK_DIGEST_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.LOCK.V0";
const TAKEOVER_CLAIM_DIGEST_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.TAKEOVER_CLAIM.V0";
const SUBJECT_AUTH_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.SUBJECT_AUTH.V0";
const STATE_AUTH_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.STATE_AUTH.V0";
const CHECKPOINT_AUTH_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.CHECKPOINT_AUTH.V0";
const LOCK_AUTH_DOMAIN = "OMNITWIN.REFERENCE_VERIFY.LOCK_AUTH.V0";
const TAKEOVER_CLAIM_AUTH_DOMAIN =
  "OMNITWIN.REFERENCE_VERIFY.TAKEOVER_CLAIM_AUTH.V0";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const JOB_ID_PATTERN = /^riv0-[0-9a-f]{32}$/u;
const SNAPSHOT_NAME_PATTERN = /^(?<sequence>[0-9]{12})\.json$/u;
const CHECKPOINT_NAME_PATTERN = /^(?<sequence>[0-9]{12})\.json$/u;
const MAX_EVIDENCE_JSON_BYTES = 16 * 1024 * 1024;
const DEFAULT_CHECKPOINT_INTERVAL_BYTES = 64 * 1024 * 1024;
const CHECKPOINT_AUTHENTICATION_KEY_ID = "reference-integrity-record-v0";
const DURABLE_OBSERVER_MAX_WAIT_MS = 100;

export type ReferenceVerificationSourceKindV0 = "file" | "directory";

export interface ReferenceVerificationAdmittedFileV0 {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/**
 * The absolute source path is runtime-only. It is deliberately excluded from
 * every durable artifact written by this module.
 */
export interface ReferenceVerificationAdmittedSubjectV0 {
  readonly sourceKind: ReferenceVerificationSourceKindV0;
  readonly canonicalSourcePath: string;
  readonly receiptSha256: string;
  readonly reviewSha256: string;
  readonly admissionResultSha256: string;
  readonly manifestSha256: string;
  readonly files: readonly ReferenceVerificationAdmittedFileV0[];
}

export interface ReferenceVerificationProgressV0 {
  readonly totalFiles: number;
  readonly totalBytes: number;
  readonly filesVerified: number;
  readonly verifiedBytes: number;
  readonly activeFileIndex: number | null;
  readonly activeFileConfirmedBytes: number;
  readonly durablyConfirmedBytes: number;
  readonly measuredBytesReadThisAttempt: number;
  readonly minimumMeasuredBytesReadAcrossAttempts: number;
  readonly resumedFromBytesThisAttempt: number;
  readonly sourcePayloadBytesStaged: typeof REFERENCE_INTEGRITY_VERIFY_SOURCE_PAYLOAD_BYTES_STAGED_V0;
  readonly checkpointMayContainSourceFragments: true;
}

export type ReferenceVerificationJobPhaseV0 =
  | "ready"
  | "running"
  | "paused"
  | "succeeded"
  | "failed";

export interface ReferenceVerificationFailureV0 {
  readonly code: string;
  readonly message: string;
}

export interface ReferenceVerificationJobSnapshotV0 {
  readonly schemaVersion: typeof STATE_SCHEMA;
  readonly jobKind: typeof REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0;
  readonly jobId: string;
  readonly subjectBindingSha256: string;
  readonly sequence: number;
  readonly previousSnapshotSha256: string | null;
  readonly phase: ReferenceVerificationJobPhaseV0;
  readonly attempt: number;
  readonly observedAt: string;
  readonly progress: ReferenceVerificationProgressV0;
  readonly latestCheckpointEnvelopeSha256: string | null;
  readonly completedFiles: readonly ReferenceVerificationCompletedFileV0[];
  readonly failure: ReferenceVerificationFailureV0 | null;
  readonly outputIndexSha256: string | null;
  readonly snapshotSha256: string;
  readonly authenticationHmacSha256: string;
}

export interface ReferenceVerificationCompletedFileV0 {
  readonly fileIndex: number;
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly fileIdentity: ResumableFileIdentity;
}

export interface ReferenceVerificationDeterministicResultV0 {
  readonly schemaVersion: typeof RESULT_SCHEMA;
  readonly jobKind: typeof REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0;
  readonly authority: typeof REFERENCE_INTEGRITY_VERIFY_AUTHORITY_V0;
  readonly operation: "read_only_reference_integrity_verification";
  readonly reconstructionPerformed: false;
  readonly trainingPerformed: false;
  readonly gpuUsed: false;
  readonly externalProviderUsed: false;
  readonly sourceFilesStaged: false;
  readonly sourcePayloadBytesStaged: typeof REFERENCE_INTEGRITY_VERIFY_SOURCE_PAYLOAD_BYTES_STAGED_V0;
  readonly checkpointMayContainSourceFragments: true;
  readonly verifier: {
    readonly algorithm: "sha256";
    readonly implementationVersion: typeof RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION;
    readonly checkpointVersion: typeof RESUMABLE_FILE_HASH_CHECKPOINT_VERSION;
  };
  readonly subjectBindingSha256: string;
  readonly receiptSha256: string;
  readonly reviewSha256: string;
  readonly admissionResultSha256: string;
  readonly manifestSha256: string;
  readonly totalFiles: number;
  readonly totalBytes: number;
  readonly files: readonly {
    readonly relativePath: string;
    readonly sizeBytes: number;
    readonly expectedSha256: string;
    readonly measuredSha256: string;
    readonly status: "exact_match";
  }[];
  readonly resultSha256: string;
}

export interface ReferenceVerificationObservationV0 {
  readonly schemaVersion: typeof OBSERVATION_SCHEMA;
  readonly jobKind: typeof REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0;
  readonly jobId: string;
  readonly subjectBindingSha256: string;
  readonly verificationInterval: {
    readonly startedAt: string;
    readonly completedAt: string;
  };
  readonly attemptCount: number;
  readonly completedAttempt: number;
  readonly resumedFromBytesInCompletedAttempt: number;
  readonly measuredBytesReadInCompletedAttempt: number;
  readonly minimumMeasuredBytesReadAcrossAttempts: number;
  readonly sourcePayloadBytesStaged: typeof REFERENCE_INTEGRITY_VERIFY_SOURCE_PAYLOAD_BYTES_STAGED_V0;
  readonly checkpointMayContainSourceFragments: true;
  readonly note: string;
}

export interface ReferenceVerificationOutputIndexV0 {
  readonly schemaVersion: typeof INDEX_SCHEMA;
  readonly jobKind: typeof REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0;
  readonly subjectBindingSha256: string;
  readonly artifacts: readonly {
    readonly name: "deterministic-result.json" | "observation.json";
    readonly mediaType: "application/json";
    readonly sizeBytes: number;
    readonly sha256: string;
  }[];
  readonly indexSha256: string;
}

export interface ReferenceVerificationVerifiedOutputV0 {
  readonly result: ReferenceVerificationDeterministicResultV0;
  readonly observation: ReferenceVerificationObservationV0;
  readonly index: ReferenceVerificationOutputIndexV0;
}

export interface ReferenceVerificationJobControlV0 {
  readonly jobId: string;
  readonly attempt: number;
  readonly completion: Promise<ReferenceVerificationJobSnapshotV0>;
  cancel(): Promise<ReferenceVerificationJobSnapshotV0>;
}

export interface ReferenceVerificationDurableCheckpointEventV0 {
  readonly jobId: string;
  readonly attempt: number;
  readonly fileIndex: number;
  readonly relativePath: string;
  readonly confirmedOffsetBytes: number;
  readonly snapshot: ReferenceVerificationJobSnapshotV0;
}

export interface ReferenceVerificationMeasuredProgressEventV0 {
  readonly jobId: string;
  readonly attempt: number;
  readonly fileIndex: number;
  readonly relativePath: string;
  readonly currentOffsetBytes: number;
  readonly bytesReadThisAttempt: number;
  readonly durablyConfirmedBytes: number;
}

export interface ReferenceIntegrityVerificationCoordinatorOptionsV0 {
  /**
   * Existing, caller-owned private directory. It must be outside the source.
   * V0 writer arbitration assumes one local daemon process owns this directory;
   * it is not a distributed, cross-process locking protocol.
   */
  readonly evidenceRoot: string;
  readonly subject: ReferenceVerificationAdmittedSubjectV0;
  /** Caller-held daemon secret (32+ bytes). It is never written to evidence. */
  readonly recordAuthenticationKey: Uint8Array;
  /**
   * Defaults to re-reading every admitted file from byte zero after interruption.
   * Select the strong option only when the caller attests stable local file identity.
   */
  readonly resumePolicy?:
    | "restart_full_verification"
    | "strong_local_filesystem_attested";
  readonly checkpointIntervalBytes?: number;
  readonly readBufferBytes?: number;
  /** Awaited best-effort observability hook. Hook failures are isolated from the job. */
  readonly onDurableCheckpoint?: (
    event: ReferenceVerificationDurableCheckpointEventV0,
  ) => void | PromiseLike<void>;
  /** Awaited best-effort measured-read hook. Hook failures are isolated from the job. */
  readonly onMeasuredProgress?: (
    event: ReferenceVerificationMeasuredProgressEventV0,
  ) => void | PromiseLike<void>;
}

export class ReferenceVerificationJobErrorV0 extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ReferenceVerificationJobErrorV0";
    this.code = code;
  }
}

interface SourceIdentityV0 {
  readonly deviceId: string;
  readonly inode: string;
  readonly sizeBytes: number;
  readonly modifiedTimeNanoseconds: string;
  readonly statusChangedTimeNanoseconds: string;
  readonly kind: ReferenceVerificationSourceKindV0;
}

interface SubjectBindingV0 {
  readonly schemaVersion: typeof REFERENCE_INTEGRITY_VERIFY_SCHEMA_V0;
  readonly jobKind: typeof REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0;
  readonly sourceKind: ReferenceVerificationSourceKindV0;
  readonly verifier: {
    readonly algorithm: "sha256";
    readonly implementationVersion: typeof RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION;
    readonly checkpointVersion: typeof RESUMABLE_FILE_HASH_CHECKPOINT_VERSION;
  };
  readonly receiptSha256: string;
  readonly reviewSha256: string;
  readonly admissionResultSha256: string;
  readonly manifestSha256: string;
  readonly files: readonly ReferenceVerificationAdmittedFileV0[];
}

interface DurableSubjectV0 {
  readonly schemaVersion: typeof SUBJECT_SCHEMA;
  readonly jobKind: typeof REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0;
  readonly binding: SubjectBindingV0;
  readonly subjectBindingSha256: string;
  readonly initialSourceIdentity: SourceIdentityV0;
  readonly subjectSha256: string;
  readonly authenticationHmacSha256: string;
}

interface CheckpointEnvelopeV0 {
  readonly schemaVersion: typeof CHECKPOINT_ENVELOPE_SCHEMA;
  readonly jobKind: typeof REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0;
  readonly jobId: string;
  readonly subjectBindingSha256: string;
  readonly attempt: number;
  readonly sequence: number;
  readonly previousEnvelopeSha256: string | null;
  readonly fileIndex: number;
  readonly relativePath: string;
  readonly confirmedOffsetBytes: number;
  readonly createdAt: string;
  readonly checkpoint: ResumableFileHashCheckpoint;
  readonly envelopeSha256: string;
  readonly authenticationHmacSha256: string;
}

interface WriterLockV0 {
  readonly schemaVersion: typeof LOCK_SCHEMA;
  readonly jobId: string;
  readonly processId: number;
  readonly ownerToken: string;
  readonly acquiredAt: string;
  readonly lockSha256: string;
  readonly authenticationHmacSha256: string;
}

interface WriterTakeoverClaimV0 {
  readonly schemaVersion: typeof TAKEOVER_CLAIM_SCHEMA;
  readonly jobId: string;
  readonly processId: number;
  readonly ownerToken: string;
  readonly claimedAt: string;
  readonly claimSha256: string;
  readonly authenticationHmacSha256: string;
}

interface ActiveRunV0 {
  readonly controller: AbortController;
  readonly completion: Promise<ReferenceVerificationJobSnapshotV0>;
}

interface PreparedEnvironmentV0 {
  readonly evidenceRoot: string;
  readonly sourcePath: string;
  readonly sourceIdentity: SourceIdentityV0;
}

interface WriterLeaseV0 {
  readonly token: string;
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyValidatedRecord<T extends object>(
  value: Record<string, unknown>,
  requiredKeys: readonly (keyof T & string)[],
): T {
  if (requiredKeys.some((key) => !(key in value))) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_RECORD_FIELD_MISSING",
      "A validated durable record is missing a required field.",
    );
  }
  return Object.assign({}, value) as T;
}

function comparablePath(value: string): string {
  const normalized = resolve(value).replace(/^\\\\\?\\/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparablePath(root), comparablePath(candidate));
  return (
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  );
}

function sameIdentity(left: SourceIdentityV0, right: SourceIdentityV0): boolean {
  return (
    left.deviceId === right.deviceId &&
    left.inode === right.inode &&
    left.sizeBytes === right.sizeBytes &&
    left.modifiedTimeNanoseconds === right.modifiedTimeNanoseconds &&
    left.statusChangedTimeNanoseconds === right.statusChangedTimeNanoseconds &&
    left.kind === right.kind
  );
}

function sameFileIdentity(left: ResumableFileIdentity, right: ResumableFileIdentity): boolean {
  return (
    left.deviceId === right.deviceId &&
    left.inode === right.inode &&
    left.sizeBytes === right.sizeBytes &&
    left.modifiedTimeNanoseconds === right.modifiedTimeNanoseconds &&
    left.statusChangedTimeNanoseconds === right.statusChangedTimeNanoseconds
  );
}

function sourceIdentityFromStats(
  metadata: BigIntStats,
  kind: ReferenceVerificationSourceKindV0,
): SourceIdentityV0 {
  if (metadata.size < 0n || metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_SOURCE_SIZE_UNREPRESENTABLE",
      "The selected source size cannot be represented exactly.",
    );
  }
  return {
    deviceId: metadata.dev.toString(10),
    inode: metadata.ino.toString(10),
    sizeBytes: Number(metadata.size),
    modifiedTimeNanoseconds: metadata.mtimeNs.toString(10),
    statusChangedTimeNanoseconds: metadata.ctimeNs.toString(10),
    kind,
  };
}

async function inspectSourceIdentity(
  path: string,
  expectedKind: ReferenceVerificationSourceKindV0,
): Promise<SourceIdentityV0> {
  let metadata: BigIntStats;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_SOURCE_UNAVAILABLE",
      "The approved source is no longer available.",
      error,
    );
  }
  if (metadata.isSymbolicLink()) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_SOURCE_SYMLINK",
      "The approved source cannot be a symbolic link or junction.",
    );
  }
  if (
    (expectedKind === "file" && !metadata.isFile()) ||
    (expectedKind === "directory" && !metadata.isDirectory())
  ) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_SOURCE_KIND_CHANGED",
      "The approved source is no longer the expected kind of item.",
    );
  }
  const canonical = await realpath(path);
  if (comparablePath(canonical) !== comparablePath(path)) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_SOURCE_INDIRECT_PATH",
      "The approved source path now passes through a symbolic link or junction.",
    );
  }
  return sourceIdentityFromStats(metadata, expectedKind);
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_SUBJECT_INVALID",
      `${label} must be exactly 64 lowercase hexadecimal characters.`,
    );
  }
}

function safeInteger(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_SUBJECT_INVALID",
      `${label} must be a safe integer greater than or equal to ${String(minimum)}.`,
    );
  }
}

function deterministicPathCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function validateAndBuildBinding(
  subject: ReferenceVerificationAdmittedSubjectV0,
): SubjectBindingV0 {
  if (!isAbsolute(subject.canonicalSourcePath)) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_SOURCE_PATH_NOT_ABSOLUTE",
      "The daemon must receive a canonical absolute source path.",
    );
  }
  assertSha256(subject.receiptSha256, "receiptSha256");
  assertSha256(subject.reviewSha256, "reviewSha256");
  assertSha256(subject.admissionResultSha256, "admissionResultSha256");
  assertSha256(subject.manifestSha256, "manifestSha256");
  if (subject.files.length === 0) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_SUBJECT_INVALID",
      "At least one admitted file is required.",
    );
  }
  if (subject.files.length > REFERENCE_INTEGRITY_VERIFY_MAX_ADMITTED_FILES_V0) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_TOO_MANY_ADMITTED_FILES",
      `Reference verification accepts at most ${String(REFERENCE_INTEGRITY_VERIFY_MAX_ADMITTED_FILES_V0)} admitted files in V0.`,
    );
  }
  if (subject.sourceKind === "file" && subject.files.length !== 1) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_SUBJECT_INVALID",
      "A single-file source must contain exactly one admitted file.",
    );
  }
  const seenFolded = new Set<string>();
  let prior: string | null = null;
  const files = subject.files.map((file, index) => {
    assertSafeBundlePath(file.relativePath);
    safeInteger(file.sizeBytes, `files[${String(index)}].sizeBytes`);
    assertSha256(file.sha256, `files[${String(index)}].sha256`);
    if (prior !== null && deterministicPathCompare(prior, file.relativePath) >= 0) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_FILES_NOT_SORTED",
        "Admitted files must be unique and sorted by their UTF-8 relative path bytes.",
      );
    }
    prior = file.relativePath;
    const folded = file.relativePath.toLocaleLowerCase("en-US");
    if (seenFolded.has(folded)) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_FILE_CASE_COLLISION",
        "Admitted files cannot contain a case-insensitive path collision.",
      );
    }
    seenFolded.add(folded);
    return {
      relativePath: file.relativePath,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    };
  });
  return {
    schemaVersion: REFERENCE_INTEGRITY_VERIFY_SCHEMA_V0,
    jobKind: REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0,
    sourceKind: subject.sourceKind,
    verifier: {
      algorithm: "sha256",
      implementationVersion: RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION,
      checkpointVersion: RESUMABLE_FILE_HASH_CHECKPOINT_VERSION,
    },
    receiptSha256: subject.receiptSha256,
    reviewSha256: subject.reviewSha256,
    admissionResultSha256: subject.admissionResultSha256,
    manifestSha256: subject.manifestSha256,
    files,
  };
}

function withoutKeys(value: Record<string, unknown>, excludedKeys: readonly string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (!excludedKeys.includes(key)) output[key] = member;
  }
  return output;
}

function digestObject(domain: string, value: Record<string, unknown>, digestKey: string): string {
  return domainSeparatedSha256(domain, toCanonicalJson(withoutKeys(value, [digestKey])));
}

function hmacObject(
  key: Uint8Array,
  domain: string,
  value: Record<string, unknown>,
  excludedKeys: readonly string[] = ["authenticationHmacSha256"],
): string {
  return createHmac("sha256", key)
    .update(domain, "ascii")
    .update(Buffer.from([0]))
    .update(stableCanonicalJson(toCanonicalJson(withoutKeys(value, excludedKeys))), "utf8")
    .digest("hex");
}

function assertAuthenticRecord(
  key: Uint8Array,
  domain: string,
  value: Record<string, unknown>,
): void {
  const actual = value.authenticationHmacSha256;
  if (typeof actual !== "string" || !SHA256_PATTERN.test(actual)) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_RECORD_AUTHENTICATION_MISSING",
      "A private durable record has no valid authentication tag.",
    );
  }
  const expected = hmacObject(key, domain, value);
  if (!timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_RECORD_AUTHENTICATION_FAILED",
      "A private durable record failed keyed authentication.",
    );
  }
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertNoAbsoluteSourcePath(value: unknown, sourcePath: string): void {
  const sensitive = comparablePath(sourcePath);
  const visit = (member: unknown): void => {
    if (typeof member === "string") {
      if (comparablePathCandidate(member) === sensitive || member.includes(sourcePath)) {
        throw new ReferenceVerificationJobErrorV0(
          "REFERENCE_ABSOLUTE_PATH_IN_ARTIFACT",
          "A durable artifact attempted to contain the private absolute source path.",
        );
      }
      return;
    }
    if (Array.isArray(member)) {
      member.forEach(visit);
      return;
    }
    if (isRecord(member)) Object.values(member).forEach(visit);
  };
  visit(value);
}

function comparablePathCandidate(value: string): string | null {
  if (!isAbsolute(value)) return null;
  try {
    return comparablePath(value);
  } catch {
    return null;
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = isRecord(error) ? error.code : null;
    if (process.platform === "win32" && (code === "EPERM" || code === "EISDIR" || code === "EINVAL")) {
      return;
    }
    throw error;
  }
}

async function writeImmutableJson(
  path: string,
  value: unknown,
  sourcePath: string,
  beforePublish?: () => Promise<void>,
): Promise<Buffer> {
  assertNoAbsoluteSourcePath(value, sourcePath);
  const bytes = canonicalBytes(value);
  const authoritativeDirectory = dirname(path);
  const stagingDirectory = dirname(authoritativeDirectory);
  const stagedPath = join(
    stagingDirectory,
    `.pending-${basename(authoritativeDirectory)}-${randomUUID()}.json`,
  );
  const handle = await open(stagedPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await beforePublish?.();
    await link(stagedPath, path);
    await syncDirectory(authoritativeDirectory);
  } catch (publishError) {
    try {
      await unlink(stagedPath);
    } catch {
      // Preserve the authoritative publish error; stale staged files are ignored.
    }
    throw publishError;
  }
  try {
    await unlink(stagedPath);
  } catch (cleanupError) {
    if (errorCode(cleanupError) !== "ENOENT") throw cleanupError;
  }
  return bytes;
}

async function readCanonicalJson(path: string): Promise<{ readonly value: unknown; readonly bytes: Buffer }> {
  const metadata = await lstat(path, { bigint: true });
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_EVIDENCE_NON_REGULAR",
      "A durable evidence record is no longer a regular file.",
    );
  }
  if (metadata.size < 1n || metadata.size > BigInt(MAX_EVIDENCE_JSON_BYTES)) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_EVIDENCE_SIZE_INVALID",
      "A durable evidence record has an invalid size.",
    );
  }
  const bytes = await readFile(path);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_EVIDENCE_JSON_INVALID",
      "A durable evidence record is not valid JSON.",
      error,
    );
  }
  if (!bytes.equals(canonicalBytes(value))) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_EVIDENCE_NOT_CANONICAL",
      "A durable evidence record is not in its exact canonical form.",
    );
  }
  return { value, bytes };
}

function nowIso(): string {
  return new Date().toISOString();
}

function notifyObserverWithoutWaiting<T>(
  observer: ((event: T) => void | PromiseLike<void>) | undefined,
  event: T,
): void {
  if (observer === undefined) return;
  try {
    void Promise.resolve(observer(event)).catch(() => undefined);
  } catch {
    // Observers cannot change verification authority or job outcome.
  }
}

async function notifyObserverWithBoundedWait<T>(
  observer: ((event: T) => void | PromiseLike<void>) | undefined,
  event: T,
  signal: AbortSignal,
): Promise<void> {
  if (observer === undefined) return;
  let observerResult: void | PromiseLike<void>;
  try {
    observerResult = observer(event);
  } catch {
    return;
  }
  await new Promise<void>((resolveWait) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolveWait();
    };
    const timer = setTimeout(finish, DURABLE_OBSERVER_MAX_WAIT_MS);
    signal.addEventListener("abort", finish, { once: true });
    void Promise.resolve(observerResult).then(finish, finish);
  });
}

function totalSubjectBytes(binding: SubjectBindingV0): number {
  return binding.files.reduce((sum, file) => {
    const next = sum + file.sizeBytes;
    safeInteger(next, "total admitted bytes");
    return next;
  }, 0);
}

function makeProgress(
  binding: SubjectBindingV0,
  completedFiles: readonly ReferenceVerificationCompletedFileV0[],
  activeFileIndex: number | null,
  activeFileConfirmedBytes: number,
  measuredBytesReadThisAttempt: number,
  minimumMeasuredBytesReadAcrossAttempts: number,
  resumedFromBytesThisAttempt: number,
): ReferenceVerificationProgressV0 {
  const verifiedBytes = completedFiles.reduce((sum, file) => sum + file.sizeBytes, 0);
  return {
    totalFiles: binding.files.length,
    totalBytes: totalSubjectBytes(binding),
    filesVerified: completedFiles.length,
    verifiedBytes,
    activeFileIndex,
    activeFileConfirmedBytes,
    durablyConfirmedBytes: verifiedBytes + activeFileConfirmedBytes,
    measuredBytesReadThisAttempt,
    minimumMeasuredBytesReadAcrossAttempts,
    resumedFromBytesThisAttempt,
    sourcePayloadBytesStaged: REFERENCE_INTEGRITY_VERIFY_SOURCE_PAYLOAD_BYTES_STAGED_V0,
    checkpointMayContainSourceFragments: true,
  };
}

function stateWithoutDigest(
  input: Omit<ReferenceVerificationJobSnapshotV0, "schemaVersion" | "jobKind" | "snapshotSha256" | "authenticationHmacSha256">,
): Omit<ReferenceVerificationJobSnapshotV0, "snapshotSha256" | "authenticationHmacSha256"> {
  return {
    schemaVersion: STATE_SCHEMA,
    jobKind: REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0,
    ...input,
  };
}

function sealState(
  input: Omit<ReferenceVerificationJobSnapshotV0, "schemaVersion" | "jobKind" | "snapshotSha256" | "authenticationHmacSha256">,
  authenticationKey: Uint8Array,
): ReferenceVerificationJobSnapshotV0 {
  const unsigned = stateWithoutDigest(input);
  const selfDigested = {
    ...unsigned,
    snapshotSha256: domainSeparatedSha256(STATE_DIGEST_DOMAIN, toCanonicalJson(unsigned)),
  };
  return {
    ...selfDigested,
    authenticationHmacSha256: hmacObject(authenticationKey, STATE_AUTH_DOMAIN, selfDigested),
  };
}

function assertProgressShape(progress: unknown): asserts progress is ReferenceVerificationProgressV0 {
  if (!isRecord(progress)) throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_INVALID", "State progress is invalid.");
  const integers = [
    progress.totalFiles,
    progress.totalBytes,
    progress.filesVerified,
    progress.verifiedBytes,
    progress.activeFileConfirmedBytes,
    progress.durablyConfirmedBytes,
    progress.measuredBytesReadThisAttempt,
    progress.minimumMeasuredBytesReadAcrossAttempts,
    progress.resumedFromBytesThisAttempt,
    progress.sourcePayloadBytesStaged,
  ];
  if (integers.some((member) => typeof member !== "number" || !Number.isSafeInteger(member) || member < 0)) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_INVALID", "State progress contains an invalid counter.");
  }
  if (
    progress.sourcePayloadBytesStaged !== 0 ||
    progress.checkpointMayContainSourceFragments !== true
  ) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_STATE_STAGING_CLAIM_INVALID",
      "The reference-only job must report zero staged source payload while acknowledging sensitive checkpoint fragments.",
    );
  }
  if (progress.activeFileIndex !== null && (
    typeof progress.activeFileIndex !== "number" ||
    !Number.isSafeInteger(progress.activeFileIndex) ||
    progress.activeFileIndex < 0
  )) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_INVALID", "State active file index is invalid.");
  }
}

function parseState(value: unknown, authenticationKey: Uint8Array): ReferenceVerificationJobSnapshotV0 {
  if (!isRecord(value)) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_INVALID", "A durable state snapshot has an invalid shape.");
  }
  assertProgressShape(value.progress);
  if (
    value.schemaVersion !== STATE_SCHEMA ||
    value.jobKind !== REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0 ||
    typeof value.jobId !== "string" || !JOB_ID_PATTERN.test(value.jobId) ||
    typeof value.subjectBindingSha256 !== "string" || !SHA256_PATTERN.test(value.subjectBindingSha256) ||
    typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 ||
    (value.previousSnapshotSha256 !== null && (typeof value.previousSnapshotSha256 !== "string" || !SHA256_PATTERN.test(value.previousSnapshotSha256))) ||
    !["ready", "running", "paused", "succeeded", "failed"].includes(String(value.phase)) ||
    typeof value.attempt !== "number" || !Number.isSafeInteger(value.attempt) || value.attempt < 0 ||
    typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt)) ||
    (value.latestCheckpointEnvelopeSha256 !== null && (typeof value.latestCheckpointEnvelopeSha256 !== "string" || !SHA256_PATTERN.test(value.latestCheckpointEnvelopeSha256))) ||
    !Array.isArray(value.completedFiles) ||
    (value.failure !== null && !isRecord(value.failure)) ||
    (value.outputIndexSha256 !== null && (
      typeof value.outputIndexSha256 !== "string" ||
      !SHA256_PATTERN.test(value.outputIndexSha256)
    )) ||
    typeof value.snapshotSha256 !== "string" || !SHA256_PATTERN.test(value.snapshotSha256) ||
    typeof value.authenticationHmacSha256 !== "string" || !SHA256_PATTERN.test(value.authenticationHmacSha256)
  ) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_INVALID", "A durable state snapshot contains an invalid field.");
  }
  const expected = domainSeparatedSha256(
    STATE_DIGEST_DOMAIN,
    toCanonicalJson(withoutKeys(value, ["snapshotSha256", "authenticationHmacSha256"])),
  );
  if (expected !== value.snapshotSha256) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_INTEGRITY_MISMATCH", "A durable state snapshot self-digest does not match.");
  }
  assertAuthenticRecord(authenticationKey, STATE_AUTH_DOMAIN, value);
  return copyValidatedRecord<ReferenceVerificationJobSnapshotV0>(value, [
    "schemaVersion",
    "snapshotSha256",
    "authenticationHmacSha256",
  ]);
}

function stateDirectory(jobDirectory: string): string {
  return join(jobDirectory, "state");
}

function checkpointDirectory(jobDirectory: string): string {
  return join(jobDirectory, "checkpoints");
}

async function readStateChain(jobDirectory: string, authenticationKey: Uint8Array): Promise<readonly ReferenceVerificationJobSnapshotV0[]> {
  const directory = stateDirectory(jobDirectory);
  const names = (await readdir(directory)).sort();
  if (names.length === 0) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_MISSING", "The durable job has no state snapshots.");
  }
  const states: ReferenceVerificationJobSnapshotV0[] = [];
  let previous: ReferenceVerificationJobSnapshotV0 | null = null;
  for (const [index, name] of names.entries()) {
    const match = SNAPSHOT_NAME_PATTERN.exec(name);
    if (match === null || Number(match.groups?.sequence) !== index + 1) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_CHAIN_INVALID", "The immutable state sequence is incomplete or contains an unexpected entry.");
    }
    const state = parseState((await readCanonicalJson(join(directory, name))).value, authenticationKey);
    if (
      state.sequence !== index + 1 ||
      state.previousSnapshotSha256 !== (previous?.snapshotSha256 ?? null) ||
      (previous !== null && (
        state.jobId !== previous.jobId ||
        state.subjectBindingSha256 !== previous.subjectBindingSha256 ||
        state.attempt < previous.attempt ||
        state.progress.minimumMeasuredBytesReadAcrossAttempts < previous.progress.minimumMeasuredBytesReadAcrossAttempts ||
        (state.attempt === previous.attempt && (
          state.progress.filesVerified < previous.progress.filesVerified ||
          state.progress.durablyConfirmedBytes < previous.progress.durablyConfirmedBytes ||
          state.progress.measuredBytesReadThisAttempt < previous.progress.measuredBytesReadThisAttempt
        ))
      ))
    ) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_CHAIN_INVALID", "The immutable state hash chain or monotonic progress invariant is broken.");
    }
    states.push(state);
    previous = state;
  }
  return states;
}

async function appendState(
  jobDirectory: string,
  sourcePath: string,
  prior: ReferenceVerificationJobSnapshotV0,
  authenticationKey: Uint8Array,
  lease: WriterLeaseV0,
  input: Omit<ReferenceVerificationJobSnapshotV0, "schemaVersion" | "jobKind" | "sequence" | "previousSnapshotSha256" | "snapshotSha256" | "authenticationHmacSha256">,
): Promise<ReferenceVerificationJobSnapshotV0> {
  const state = sealState({
    ...input,
    sequence: prior.sequence + 1,
    previousSnapshotSha256: prior.snapshotSha256,
  }, authenticationKey);
  await writeImmutableJson(
    join(stateDirectory(jobDirectory), `${String(state.sequence).padStart(12, "0")}.json`),
    state,
    sourcePath,
    async () => lease.assertOwned(),
  );
  return state;
}

function sealSubject(binding: SubjectBindingV0, initialSourceIdentity: SourceIdentityV0, authenticationKey: Uint8Array): DurableSubjectV0 {
  const subjectBindingSha256 = domainSeparatedSha256(
    SUBJECT_BINDING_DIGEST_DOMAIN,
    toCanonicalJson(binding),
  );
  const unsigned: Omit<DurableSubjectV0, "subjectSha256" | "authenticationHmacSha256"> = {
    schemaVersion: SUBJECT_SCHEMA,
    jobKind: REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0,
    binding,
    subjectBindingSha256,
    initialSourceIdentity,
  };
  const selfDigested = {
    ...unsigned,
    subjectSha256: domainSeparatedSha256(SUBJECT_DIGEST_DOMAIN, toCanonicalJson(unsigned)),
  };
  return {
    ...selfDigested,
    authenticationHmacSha256: hmacObject(authenticationKey, SUBJECT_AUTH_DOMAIN, selfDigested),
  };
}

function parseSubject(value: unknown, authenticationKey: Uint8Array): DurableSubjectV0 {
  if (!isRecord(value) || typeof value.subjectSha256 !== "string") {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_SUBJECT_RECORD_INVALID", "The durable subject record has an invalid shape.");
  }
  const expected = domainSeparatedSha256(
    SUBJECT_DIGEST_DOMAIN,
    toCanonicalJson(withoutKeys(value, ["subjectSha256", "authenticationHmacSha256"])),
  );
  if (expected !== value.subjectSha256) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_SUBJECT_INTEGRITY_MISMATCH", "The durable subject record self-digest does not match.");
  }
  assertAuthenticRecord(authenticationKey, SUBJECT_AUTH_DOMAIN, value);
  return copyValidatedRecord<DurableSubjectV0>(value, [
    "schemaVersion",
    "subjectSha256",
    "authenticationHmacSha256",
  ]);
}

function sealCheckpointEnvelope(
  input: Omit<CheckpointEnvelopeV0, "schemaVersion" | "jobKind" | "envelopeSha256" | "authenticationHmacSha256">,
  authenticationKey: Uint8Array,
): CheckpointEnvelopeV0 {
  const unsigned: Omit<CheckpointEnvelopeV0, "envelopeSha256" | "authenticationHmacSha256"> = {
    schemaVersion: CHECKPOINT_ENVELOPE_SCHEMA,
    jobKind: REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0,
    ...input,
  };
  const selfDigested = {
    ...unsigned,
    envelopeSha256: domainSeparatedSha256(
      CHECKPOINT_ENVELOPE_DIGEST_DOMAIN,
      toCanonicalJson(unsigned),
    ),
  };
  return {
    ...selfDigested,
    authenticationHmacSha256: hmacObject(authenticationKey, CHECKPOINT_AUTH_DOMAIN, selfDigested),
  };
}

function parseCheckpointEnvelope(value: unknown, authenticationKey: Uint8Array): CheckpointEnvelopeV0 {
  if (!isRecord(value) || typeof value.envelopeSha256 !== "string") {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_CHECKPOINT_INVALID", "A private checkpoint envelope has an invalid shape.");
  }
  const expected = domainSeparatedSha256(
    CHECKPOINT_ENVELOPE_DIGEST_DOMAIN,
    toCanonicalJson(withoutKeys(value, ["envelopeSha256", "authenticationHmacSha256"])),
  );
  if (expected !== value.envelopeSha256) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_CHECKPOINT_INTEGRITY_MISMATCH", "A private checkpoint envelope self-digest does not match.");
  }
  assertAuthenticRecord(authenticationKey, CHECKPOINT_AUTH_DOMAIN, value);
  if (typeof value.jobId !== "string" || !JOB_ID_PATTERN.test(value.jobId)) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_CHECKPOINT_INVALID",
      "A private checkpoint envelope has an invalid job binding.",
    );
  }
  const checkpoint = validateResumableFileHashCheckpoint(value.checkpoint, {
    key: authenticationKey,
    keyId: CHECKPOINT_AUTHENTICATION_KEY_ID,
    context: value.jobId,
  });
  if (
    value.schemaVersion !== CHECKPOINT_ENVELOPE_SCHEMA ||
    value.jobKind !== REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0 ||
    typeof value.jobId !== "string" || !JOB_ID_PATTERN.test(value.jobId) ||
    typeof value.subjectBindingSha256 !== "string" || !SHA256_PATTERN.test(value.subjectBindingSha256) ||
    typeof value.attempt !== "number" || !Number.isSafeInteger(value.attempt) || value.attempt < 1 ||
    typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 ||
    (value.previousEnvelopeSha256 !== null && (typeof value.previousEnvelopeSha256 !== "string" || !SHA256_PATTERN.test(value.previousEnvelopeSha256))) ||
    typeof value.fileIndex !== "number" || !Number.isSafeInteger(value.fileIndex) || value.fileIndex < 0 ||
    typeof value.relativePath !== "string" ||
    typeof value.confirmedOffsetBytes !== "number" ||
    value.confirmedOffsetBytes !== checkpoint.confirmedOffsetBytes ||
    value.relativePath !== checkpoint.relativePath ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_CHECKPOINT_INVALID", "A private checkpoint envelope contains an invalid field.");
  }
  return {
    ...copyValidatedRecord<CheckpointEnvelopeV0>(value, [
      "schemaVersion",
      "envelopeSha256",
      "authenticationHmacSha256",
    ]),
    checkpoint,
  };
}

async function readCheckpointChain(jobDirectory: string, authenticationKey: Uint8Array): Promise<readonly CheckpointEnvelopeV0[]> {
  const directory = checkpointDirectory(jobDirectory);
  const names = (await readdir(directory)).sort();
  const checkpoints: CheckpointEnvelopeV0[] = [];
  let previous: CheckpointEnvelopeV0 | null = null;
  for (const [index, name] of names.entries()) {
    const match = CHECKPOINT_NAME_PATTERN.exec(name);
    if (match === null || Number(match.groups?.sequence) !== index + 1) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_CHECKPOINT_CHAIN_INVALID", "The private checkpoint sequence is incomplete or contains an unexpected entry.");
    }
    const envelope = parseCheckpointEnvelope(
      (await readCanonicalJson(join(directory, name))).value,
      authenticationKey,
    );
    if (
      envelope.sequence !== index + 1 ||
      envelope.previousEnvelopeSha256 !== (previous?.envelopeSha256 ?? null) ||
      (previous !== null && (
        envelope.jobId !== previous.jobId ||
        envelope.subjectBindingSha256 !== previous.subjectBindingSha256 ||
        envelope.attempt < previous.attempt ||
        (
          envelope.attempt === previous.attempt &&
          (
            envelope.fileIndex < previous.fileIndex ||
            (
              envelope.fileIndex === previous.fileIndex &&
              envelope.confirmedOffsetBytes <= previous.confirmedOffsetBytes
            )
          )
        )
      ))
    ) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_CHECKPOINT_CHAIN_INVALID", "The private checkpoint hash chain or progress order is broken.");
    }
    checkpoints.push(envelope);
    previous = envelope;
  }
  return checkpoints;
}

async function appendCheckpoint(
  jobDirectory: string,
  sourcePath: string,
  prior: CheckpointEnvelopeV0 | null,
  authenticationKey: Uint8Array,
  lease: WriterLeaseV0,
  input: Omit<CheckpointEnvelopeV0, "schemaVersion" | "jobKind" | "sequence" | "previousEnvelopeSha256" | "envelopeSha256" | "authenticationHmacSha256">,
): Promise<CheckpointEnvelopeV0> {
  const envelope = sealCheckpointEnvelope({
    ...input,
    sequence: (prior?.sequence ?? 0) + 1,
    previousEnvelopeSha256: prior?.envelopeSha256 ?? null,
  }, authenticationKey);
  await writeImmutableJson(
    join(checkpointDirectory(jobDirectory), `${String(envelope.sequence).padStart(12, "0")}.json`),
    envelope,
    sourcePath,
    async () => lease.assertOwned(),
  );
  return envelope;
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === "string" ? error.code : null;
}

async function ensureCanonicalExistingDirectory(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_PATH_NOT_ABSOLUTE", `${label} must be an absolute path.`);
  }
  const requested = resolve(path);
  const metadata = await lstat(requested);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_DIRECTORY_UNSAFE", `${label} must be an existing real directory, not a link.`);
  }
  const canonical = await realpath(requested);
  if (comparablePath(canonical) !== comparablePath(requested)) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_DIRECTORY_INDIRECT", `${label} cannot pass through a symbolic link or junction.`);
  }
  return canonical;
}

async function prepareEnvironment(
  evidenceRootInput: string,
  subject: ReferenceVerificationAdmittedSubjectV0,
): Promise<PreparedEnvironmentV0> {
  const evidenceRoot = await ensureCanonicalExistingDirectory(evidenceRootInput, "The private evidence root");
  const sourcePath = resolve(subject.canonicalSourcePath);
  const sourceCanonical = await realpath(sourcePath);
  if (comparablePath(sourceCanonical) !== comparablePath(sourcePath)) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_NOT_CANONICAL", "The source path must already be canonical and must not pass through a link.");
  }
  if (pathIsWithin(sourceCanonical, evidenceRoot) || pathIsWithin(evidenceRoot, sourceCanonical)) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_EVIDENCE_OVERLAPS_SOURCE", "The private evidence root and approved source must be disjoint.");
  }
  return {
    evidenceRoot,
    sourcePath: sourceCanonical,
    sourceIdentity: await inspectSourceIdentity(sourceCanonical, subject.sourceKind),
  };
}

async function ensureJobNamespace(evidenceRoot: string): Promise<string> {
  const namespace = join(evidenceRoot, REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0);
  try {
    await mkdir(namespace, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const canonical = await ensureCanonicalExistingDirectory(namespace, "The verification namespace");
  if (!pathIsWithin(evidenceRoot, canonical)) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_NAMESPACE_ESCAPE", "The verification namespace escaped its private root.");
  }
  return canonical;
}

function jobDirectoryFor(namespace: string, jobId: string): string {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_JOB_ID_INVALID", "The reference verification job ID is invalid.");
  }
  return join(namespace, jobId);
}

async function resolveAdmittedFile(
  sourcePath: string,
  sourceKind: ReferenceVerificationSourceKindV0,
  file: ReferenceVerificationAdmittedFileV0,
): Promise<string> {
  if (sourceKind === "file") {
    const identity = await inspectSourceIdentity(sourcePath, "file");
    if (identity.sizeBytes !== file.sizeBytes) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_SIZE_CHANGED", "The approved source file size changed.");
    }
    return sourcePath;
  }
  let cursor = sourcePath;
  const parts = file.relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    const metadata = await lstat(cursor, { bigint: true });
    if (metadata.isSymbolicLink()) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_SYMLINK", "An approved relative path now passes through a symbolic link or junction.");
    }
    if (index < parts.length - 1 && !metadata.isDirectory()) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_PATH_CHANGED", "An approved relative path is no longer a directory path.");
    }
    if (index === parts.length - 1 && !metadata.isFile()) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_NON_REGULAR", "An approved source entry is no longer a regular file.");
    }
  }
  const canonical = await realpath(cursor);
  if (comparablePath(canonical) !== comparablePath(cursor) || !pathIsWithin(sourcePath, canonical)) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_PATH_ESCAPE", "An approved relative path no longer resolves inside the source root.");
  }
  const metadata = await stat(canonical);
  if (metadata.size !== file.sizeBytes) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_SIZE_CHANGED", "An approved source file size changed.");
  }
  return canonical;
}

function newJobId(): string {
  return `riv0-${randomBytes(16).toString("hex")}`;
}

function lockPath(jobDirectory: string): string {
  return join(jobDirectory, "writer.lock.json");
}

function processAppearsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ESRCH") return false;
    return true;
  }
}

function parseLock(value: unknown, authenticationKey: Uint8Array): WriterLockV0 {
  if (!isRecord(value) || typeof value.lockSha256 !== "string") {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_LOCK_INVALID", "The job writer lock is invalid.");
  }
  const expected = domainSeparatedSha256(
    LOCK_DIGEST_DOMAIN,
    toCanonicalJson(withoutKeys(value, ["lockSha256", "authenticationHmacSha256"])),
  );
  if (expected !== value.lockSha256) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_LOCK_INTEGRITY_MISMATCH", "The job writer lock self-digest does not match.");
  }
  assertAuthenticRecord(authenticationKey, LOCK_AUTH_DOMAIN, value);
  if (
    value.schemaVersion !== LOCK_SCHEMA ||
    typeof value.jobId !== "string" || !JOB_ID_PATTERN.test(value.jobId) ||
    typeof value.processId !== "number" || !Number.isSafeInteger(value.processId) || value.processId < 1 ||
    typeof value.ownerToken !== "string" || !/^[0-9a-f]{64}$/u.test(value.ownerToken) ||
    typeof value.acquiredAt !== "string" || !Number.isFinite(Date.parse(value.acquiredAt))
  ) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_LOCK_INVALID", "The job writer lock contains an invalid field.");
  }
  return copyValidatedRecord<WriterLockV0>(value, [
    "schemaVersion",
    "lockSha256",
    "authenticationHmacSha256",
  ]);
}

function sealTakeoverClaim(
  jobId: string,
  ownerToken: string,
  authenticationKey: Uint8Array,
): WriterTakeoverClaimV0 {
  const unsigned: Omit<
    WriterTakeoverClaimV0,
    "claimSha256" | "authenticationHmacSha256"
  > = {
    schemaVersion: TAKEOVER_CLAIM_SCHEMA,
    jobId,
    processId: process.pid,
    ownerToken,
    claimedAt: nowIso(),
  };
  const selfDigested = {
    ...unsigned,
    claimSha256: domainSeparatedSha256(
      TAKEOVER_CLAIM_DIGEST_DOMAIN,
      toCanonicalJson(unsigned),
    ),
  };
  return {
    ...selfDigested,
    authenticationHmacSha256: hmacObject(
      authenticationKey,
      TAKEOVER_CLAIM_AUTH_DOMAIN,
      selfDigested,
    ),
  };
}

function parseTakeoverClaim(
  value: unknown,
  authenticationKey: Uint8Array,
): WriterTakeoverClaimV0 {
  if (!isRecord(value) || typeof value.claimSha256 !== "string") {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_TAKEOVER_CLAIM_INVALID",
      "The writer-lock takeover claim is invalid.",
    );
  }
  const expected = domainSeparatedSha256(
    TAKEOVER_CLAIM_DIGEST_DOMAIN,
    toCanonicalJson(withoutKeys(value, ["claimSha256", "authenticationHmacSha256"])),
  );
  if (expected !== value.claimSha256) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_TAKEOVER_CLAIM_INTEGRITY_MISMATCH",
      "The writer-lock takeover claim self-digest does not match.",
    );
  }
  assertAuthenticRecord(authenticationKey, TAKEOVER_CLAIM_AUTH_DOMAIN, value);
  if (
    value.schemaVersion !== TAKEOVER_CLAIM_SCHEMA ||
    typeof value.jobId !== "string" ||
    !JOB_ID_PATTERN.test(value.jobId) ||
    typeof value.processId !== "number" ||
    !Number.isSafeInteger(value.processId) ||
    value.processId < 1 ||
    typeof value.ownerToken !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.ownerToken) ||
    typeof value.claimedAt !== "string" ||
    !Number.isFinite(Date.parse(value.claimedAt))
  ) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_TAKEOVER_CLAIM_INVALID",
      "The writer-lock takeover claim contains an invalid field.",
    );
  }
  return copyValidatedRecord<WriterTakeoverClaimV0>(value, [
    "schemaVersion",
    "claimSha256",
    "authenticationHmacSha256",
  ]);
}

/*
 * V0 deliberately coordinates writer acquisition inside one local daemon.
 * This queue prevents two coordinators in that daemon from racing a takeover;
 * it does not claim to be a distributed cross-process lock.
 */
const localWriterAcquisitionTails = new Map<string, Promise<void>>();

async function serializeLocalWriterAcquisition<T>(
  jobDirectory: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = comparablePath(jobDirectory);
  const predecessor = localWriterAcquisitionTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const queued = predecessor.catch(() => undefined).then(() => gate);
  localWriterAcquisitionTails.set(key, queued);
  await predecessor.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (localWriterAcquisitionTails.get(key) === queued) {
      localWriterAcquisitionTails.delete(key);
    }
  }
}

async function acquireTakeoverClaim(
  jobDirectory: string,
  jobId: string,
  sourcePath: string,
  ownerToken: string,
  authenticationKey: Uint8Array,
): Promise<WriterTakeoverClaimV0> {
  const path = join(jobDirectory, "writer.takeover.claim");
  const claim = sealTakeoverClaim(jobId, ownerToken, authenticationKey);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeImmutableJson(path, claim, sourcePath);
      return claim;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    let existing: WriterTakeoverClaimV0;
    try {
      existing = parseTakeoverClaim(
        (await readCanonicalJson(path)).value,
        authenticationKey,
      );
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }
    if (existing.jobId !== jobId) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_TAKEOVER_CLAIM_JOB_MISMATCH",
        "The existing writer-lock takeover claim belongs to another job.",
      );
    }
    if (processAppearsAlive(existing.processId)) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_LOCK_TAKEOVER_IN_PROGRESS",
        "Another coordinator in the local daemon is already deciding ownership of the stale writer lock.",
      );
    }
    const stalePath = join(
      jobDirectory,
      `writer-takeover-claim-stale-${randomUUID()}.json`,
    );
    try {
      await rename(path, stalePath);
      await syncDirectory(jobDirectory);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }
  }
  throw new ReferenceVerificationJobErrorV0(
    "REFERENCE_LOCK_TAKEOVER_RACE",
    "Writer-lock takeover ownership could not be established safely.",
  );
}

async function releaseTakeoverClaim(
  jobDirectory: string,
  claim: WriterTakeoverClaimV0,
  authenticationKey: Uint8Array,
): Promise<void> {
  const path = join(jobDirectory, "writer.takeover.claim");
  let existing: WriterTakeoverClaimV0;
  try {
    existing = parseTakeoverClaim(
      (await readCanonicalJson(path)).value,
      authenticationKey,
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  if (existing.ownerToken !== claim.ownerToken) {
    throw new ReferenceVerificationJobErrorV0(
      "REFERENCE_LOCK_TAKEOVER_FENCED",
      "The coordinator no longer owns the writer-lock takeover claim.",
    );
  }
  await unlink(path);
  await syncDirectory(jobDirectory);
}

async function acquireWriterLease(
  jobDirectory: string,
  jobId: string,
  sourcePath: string,
  authenticationKey: Uint8Array,
): Promise<WriterLeaseV0> {
  return serializeLocalWriterAcquisition(jobDirectory, async () => {
    const path = lockPath(jobDirectory);
    const token = randomBytes(32).toString("hex");
    const unsigned: Omit<WriterLockV0, "lockSha256" | "authenticationHmacSha256"> = {
      schemaVersion: LOCK_SCHEMA,
      jobId,
      processId: process.pid,
      ownerToken: token,
      acquiredAt: nowIso(),
    };
    const selfDigested = {
      ...unsigned,
      lockSha256: domainSeparatedSha256(LOCK_DIGEST_DOMAIN, toCanonicalJson(unsigned)),
    };
    const lock: WriterLockV0 = {
      ...selfDigested,
      authenticationHmacSha256: hmacObject(authenticationKey, LOCK_AUTH_DOMAIN, selfDigested),
    };
    try {
      await writeImmutableJson(path, lock, sourcePath);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const claim = await acquireTakeoverClaim(
        jobDirectory,
        jobId,
        sourcePath,
        token,
        authenticationKey,
      );
      let takeoverError: unknown;
      try {
        let existing: WriterLockV0 | null = null;
        try {
          existing = parseLock((await readCanonicalJson(path)).value, authenticationKey);
        } catch (readError) {
          if (errorCode(readError) !== "ENOENT") throw readError;
        }
        if (existing !== null) {
          if (processAppearsAlive(existing.processId)) {
            throw new ReferenceVerificationJobErrorV0(
              "REFERENCE_JOB_ALREADY_RUNNING",
              "Another local coordinator already holds this job's writer lock.",
            );
          }
          const stalePath = join(jobDirectory, `writer-lock-stale-${randomUUID()}.json`);
          await rename(path, stalePath);
          await syncDirectory(jobDirectory);
        }
        await writeImmutableJson(path, lock, sourcePath);
      } catch (caughtTakeoverError) {
        takeoverError = caughtTakeoverError;
      }
      let cleanupError: unknown;
      try {
        await releaseTakeoverClaim(jobDirectory, claim, authenticationKey);
      } catch (caughtCleanupError) {
        cleanupError = caughtCleanupError;
      }
      if (takeoverError !== undefined) {
        if (takeoverError instanceof Error) throw takeoverError;
        throw new ReferenceVerificationJobErrorV0(
          "REFERENCE_LOCK_TAKEOVER_FAILED",
          "The stale writer-lock takeover failed safely.",
          takeoverError,
        );
      }
      if (cleanupError !== undefined) {
        if (cleanupError instanceof Error) throw cleanupError;
        throw new ReferenceVerificationJobErrorV0(
          "REFERENCE_LOCK_TAKEOVER_CLEANUP_FAILED",
          "The stale writer-lock takeover claim could not be cleaned up safely.",
          cleanupError,
        );
      }
    }
    const assertOwned = async (): Promise<void> => {
      const existing = parseLock((await readCanonicalJson(path)).value, authenticationKey);
      if (existing.ownerToken !== token) {
        throw new ReferenceVerificationJobErrorV0(
          "REFERENCE_LOCK_FENCED",
          "The active writer no longer owns the job lock.",
        );
      }
    };
    return {
      token,
      assertOwned,
      async release(): Promise<void> {
        try {
          await assertOwned();
        } catch (error) {
          if (errorCode(error) === "ENOENT") return;
          throw error;
        }
        await unlink(path);
        await syncDirectory(jobDirectory);
      },
    };
  });
}

function sanitizedFailure(error: unknown): ReferenceVerificationFailureV0 {
  const code =
    error instanceof ReferenceVerificationJobErrorV0 || error instanceof ResumableFileHashError
      ? error.code
      : "REFERENCE_VERIFICATION_FAILED";
  const sourceProblem = code.startsWith("HASH_SOURCE_") || code.startsWith("REFERENCE_SOURCE_");
  const checkpointProblem = code.startsWith("HASH_CHECKPOINT_") || code.startsWith("REFERENCE_CHECKPOINT_");
  return {
    code: /^[A-Z0-9_]{3,120}$/u.test(code) ? code : "REFERENCE_VERIFICATION_FAILED",
    message: sourceProblem
      ? "The approved source is missing, changed, or unsafe. No success report was produced."
      : checkpointProblem
        ? "A private resume checkpoint failed validation. No success report was produced."
        : "Local integrity verification stopped safely without producing a success report.",
  };
}

function resultWithoutDigest(binding: SubjectBindingV0, subjectBindingSha256: string): Omit<ReferenceVerificationDeterministicResultV0, "resultSha256"> {
  return {
    schemaVersion: RESULT_SCHEMA,
    jobKind: REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0,
    authority: REFERENCE_INTEGRITY_VERIFY_AUTHORITY_V0,
    operation: "read_only_reference_integrity_verification",
    reconstructionPerformed: false,
    trainingPerformed: false,
    gpuUsed: false,
    externalProviderUsed: false,
    sourceFilesStaged: false,
    sourcePayloadBytesStaged: REFERENCE_INTEGRITY_VERIFY_SOURCE_PAYLOAD_BYTES_STAGED_V0,
    checkpointMayContainSourceFragments: true,
    verifier: {
      algorithm: "sha256",
      implementationVersion: RESUMABLE_FILE_HASH_IMPLEMENTATION_VERSION,
      checkpointVersion: RESUMABLE_FILE_HASH_CHECKPOINT_VERSION,
    },
    subjectBindingSha256,
    receiptSha256: binding.receiptSha256,
    reviewSha256: binding.reviewSha256,
    admissionResultSha256: binding.admissionResultSha256,
    manifestSha256: binding.manifestSha256,
    totalFiles: binding.files.length,
    totalBytes: totalSubjectBytes(binding),
    files: binding.files.map((file) => ({
      relativePath: file.relativePath,
      sizeBytes: file.sizeBytes,
      expectedSha256: file.sha256,
      measuredSha256: file.sha256,
      status: "exact_match" as const,
    })),
  };
}

function sealResult(binding: SubjectBindingV0, subjectBindingSha256: string): ReferenceVerificationDeterministicResultV0 {
  const unsigned = resultWithoutDigest(binding, subjectBindingSha256);
  return {
    ...unsigned,
    resultSha256: domainSeparatedSha256(RESULT_DIGEST_DOMAIN, toCanonicalJson(unsigned)),
  };
}

function parseAndValidateResult(value: unknown, expected: ReferenceVerificationDeterministicResultV0): ReferenceVerificationDeterministicResultV0 {
  if (!isRecord(value) || typeof value.resultSha256 !== "string") {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_OUTPUT_INVALID", "The deterministic result has an invalid shape.");
  }
  if (digestObject(RESULT_DIGEST_DOMAIN, value, "resultSha256") !== value.resultSha256) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_OUTPUT_INTEGRITY_MISMATCH", "The deterministic result self-digest does not match.");
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    throw new ReferenceVerificationJobErrorV0("REFERENCE_OUTPUT_SUBJECT_MISMATCH", "The deterministic result does not match the exact admitted subject.");
  }
  return copyValidatedRecord<ReferenceVerificationDeterministicResultV0>(value, [
    "schemaVersion",
    "resultSha256",
  ]);
}

function sealIndex(
  subjectBindingSha256: string,
  resultBytes: Buffer,
  observationBytes: Buffer,
): ReferenceVerificationOutputIndexV0 {
  const unsigned: Omit<ReferenceVerificationOutputIndexV0, "indexSha256"> = {
    schemaVersion: INDEX_SCHEMA,
    jobKind: REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0,
    subjectBindingSha256,
    artifacts: [
      {
        name: "deterministic-result.json" as const,
        mediaType: "application/json" as const,
        sizeBytes: resultBytes.length,
        sha256: sha256Bytes(resultBytes),
      },
      {
        name: "observation.json" as const,
        mediaType: "application/json" as const,
        sizeBytes: observationBytes.length,
        sha256: sha256Bytes(observationBytes),
      },
    ],
  };
  return {
    ...unsigned,
    indexSha256: domainSeparatedSha256(INDEX_DIGEST_DOMAIN, toCanonicalJson(unsigned)),
  };
}

async function promoteOutputs(
  jobDirectory: string,
  sourcePath: string,
  result: ReferenceVerificationDeterministicResultV0,
  observation: ReferenceVerificationObservationV0,
  lease: WriterLeaseV0,
): Promise<ReferenceVerificationOutputIndexV0> {
  const finalDirectory = join(jobDirectory, "outputs");
  try {
    await lstat(finalDirectory);
    throw new ReferenceVerificationJobErrorV0("REFERENCE_OUTPUT_ALREADY_EXISTS", "A final output set already exists and must be verified before reuse.");
  } catch (error) {
    if (error instanceof ReferenceVerificationJobErrorV0) throw error;
    if (errorCode(error) !== "ENOENT") throw error;
  }
  const partial = join(jobDirectory, `outputs.partial-${randomUUID()}`);
  await mkdir(partial, { mode: 0o700 });
  const resultBytes = await writeImmutableJson(join(partial, "deterministic-result.json"), result, sourcePath);
  const observationBytes = await writeImmutableJson(join(partial, "observation.json"), observation, sourcePath);
  const index = sealIndex(result.subjectBindingSha256, resultBytes, observationBytes);
  await writeImmutableJson(join(partial, "index.json"), index, sourcePath);
  await syncDirectory(partial);
  await lease.assertOwned();
  await rename(partial, finalDirectory);
  await syncDirectory(jobDirectory);
  return index;
}

async function quarantineUnboundOutputs(
  jobDirectory: string,
  lease: WriterLeaseV0,
): Promise<void> {
  const outputPath = join(jobDirectory, "outputs");
  const orphanPath = join(jobDirectory, `outputs.orphan-${randomUUID()}`);
  await lease.assertOwned();
  try {
    await rename(outputPath, orphanPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  await syncDirectory(jobDirectory);
}

function observationFor(
  jobId: string,
  subjectBindingSha256: string,
  startedAt: string,
  completedAt: string,
  snapshot: ReferenceVerificationJobSnapshotV0,
): ReferenceVerificationObservationV0 {
  return {
    schemaVersion: OBSERVATION_SCHEMA,
    jobKind: REFERENCE_INTEGRITY_VERIFY_JOB_KIND_V0,
    jobId,
    subjectBindingSha256,
    verificationInterval: { startedAt, completedAt },
    attemptCount: snapshot.attempt,
    completedAttempt: snapshot.attempt,
    resumedFromBytesInCompletedAttempt: snapshot.progress.resumedFromBytesThisAttempt,
    measuredBytesReadInCompletedAttempt: snapshot.progress.measuredBytesReadThisAttempt,
    minimumMeasuredBytesReadAcrossAttempts: snapshot.progress.minimumMeasuredBytesReadAcrossAttempts,
    sourcePayloadBytesStaged: REFERENCE_INTEGRITY_VERIFY_SOURCE_PAYLOAD_BYTES_STAGED_V0,
    checkpointMayContainSourceFragments: true,
    note: "This records an interval during which approved bytes were read and matched. It is not an atomic filesystem snapshot and it is not a reconstruction result. Private resume checkpoints may contain small source fragments and require source-level protection.",
  };
}

export class ReferenceIntegrityVerificationCoordinatorV0 {
  readonly #options: ReferenceIntegrityVerificationCoordinatorOptionsV0;
  readonly #binding: SubjectBindingV0;
  readonly #subjectBindingSha256: string;
  readonly #authenticationKey: Buffer;
  readonly #active = new Map<string, ActiveRunV0>();

  constructor(options: ReferenceIntegrityVerificationCoordinatorOptionsV0) {
    if (!(options.recordAuthenticationKey instanceof Uint8Array) || options.recordAuthenticationKey.byteLength < 32) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_AUTHENTICATION_KEY_INVALID",
        "The local daemon must supply at least 32 bytes of secret record-authentication key material.",
      );
    }
    this.#options = options;
    this.#authenticationKey = Buffer.from(options.recordAuthenticationKey);
    this.#binding = validateAndBuildBinding(options.subject);
    this.#subjectBindingSha256 = domainSeparatedSha256(
      SUBJECT_BINDING_DIGEST_DOMAIN,
      toCanonicalJson(this.#binding),
    );
    const interval = options.checkpointIntervalBytes ?? DEFAULT_CHECKPOINT_INTERVAL_BYTES;
    safeInteger(interval, "checkpointIntervalBytes", 1);
    if (options.readBufferBytes !== undefined) safeInteger(options.readBufferBytes, "readBufferBytes", 1);
    const suppliedResumePolicy: unknown = options.resumePolicy;
    if (
      suppliedResumePolicy !== undefined &&
      suppliedResumePolicy !== "restart_full_verification" &&
      suppliedResumePolicy !== "strong_local_filesystem_attested"
    ) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_RESUME_POLICY_INVALID",
        "The verification resume policy is invalid.",
      );
    }
  }

  async startFresh(): Promise<ReferenceVerificationJobControlV0> {
    const environment = await prepareEnvironment(this.#options.evidenceRoot, this.#options.subject);
    const namespace = await ensureJobNamespace(environment.evidenceRoot);
    const jobId = newJobId();
    const jobDirectory = jobDirectoryFor(namespace, jobId);
    await mkdir(jobDirectory, { mode: 0o700 });
    await mkdir(stateDirectory(jobDirectory), { mode: 0o700 });
    await mkdir(checkpointDirectory(jobDirectory), { mode: 0o700 });
    const durableSubject = sealSubject(this.#binding, environment.sourceIdentity, this.#authenticationKey);
    await writeImmutableJson(join(jobDirectory, "subject.json"), durableSubject, environment.sourcePath);
    const ready = sealState({
      jobId,
      subjectBindingSha256: this.#subjectBindingSha256,
      sequence: 1,
      previousSnapshotSha256: null,
      phase: "ready",
      attempt: 0,
      observedAt: nowIso(),
      progress: makeProgress(this.#binding, [], null, 0, 0, 0, 0),
      latestCheckpointEnvelopeSha256: null,
      completedFiles: [],
      failure: null,
      outputIndexSha256: null,
    }, this.#authenticationKey);
    await writeImmutableJson(join(stateDirectory(jobDirectory), "000000000001.json"), ready, environment.sourcePath);
    return this.#launch(jobId, environment, jobDirectory, ready);
  }

  async recover(jobId: string): Promise<ReferenceVerificationJobSnapshotV0> {
    const { environment, jobDirectory, subject } = await this.#openExisting(jobId);
    if (!sameIdentity(subject.initialSourceIdentity, environment.sourceIdentity)) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_IDENTITY_CHANGED", "The source root identity changed since this job was created.");
    }
    const states = await readStateChain(jobDirectory, this.#authenticationKey);
    const checkpoints = await readCheckpointChain(jobDirectory, this.#authenticationKey);
    this.#validateRecoveredBindings(jobId, states, checkpoints);
    const latest = states.at(-1);
    if (latest === undefined) throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_MISSING", "The job has no state.");
    if (latest.phase === "succeeded") await this.verifyOutput(jobId);
    return latest;
  }

  async resume(jobId: string): Promise<ReferenceVerificationJobControlV0> {
    if (this.#active.has(jobId)) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_JOB_ALREADY_RUNNING", "This coordinator is already running the job.");
    }
    const { environment, jobDirectory, subject } = await this.#openExisting(jobId);
    if (!sameIdentity(subject.initialSourceIdentity, environment.sourceIdentity)) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_IDENTITY_CHANGED", "The source root identity changed since this job was created.");
    }
    const states = await readStateChain(jobDirectory, this.#authenticationKey);
    const checkpoints = await readCheckpointChain(jobDirectory, this.#authenticationKey);
    this.#validateRecoveredBindings(jobId, states, checkpoints);
    const latest = states.at(-1);
    if (latest === undefined) throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_MISSING", "The job has no state.");
    if (latest.phase === "succeeded") {
      await this.verifyOutput(jobId);
      throw new ReferenceVerificationJobErrorV0("REFERENCE_JOB_ALREADY_SUCCEEDED", "This verification job already has a verified final result.");
    }
    if (latest.phase === "failed") {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_JOB_FAILED_FRESH_REQUIRED", "A failed verification cannot be resumed; start a fresh job after correcting the source or evidence problem.");
    }
    return this.#launch(jobId, environment, jobDirectory, latest);
  }

  async inspect(jobId: string): Promise<ReferenceVerificationJobSnapshotV0> {
    const { environment, jobDirectory, subject } = await this.#openExisting(jobId);
    if (!sameIdentity(subject.initialSourceIdentity, environment.sourceIdentity)) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_SOURCE_IDENTITY_CHANGED",
        "The source root identity changed since this job was created.",
      );
    }
    const states = await readStateChain(jobDirectory, this.#authenticationKey);
    const checkpoints = await readCheckpointChain(jobDirectory, this.#authenticationKey);
    this.#validateRecoveredBindings(jobId, states, checkpoints);
    const latest = states.at(-1);
    if (latest === undefined) throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_MISSING", "The job has no state.");
    if (latest.phase === "succeeded") {
      this.#assertSucceededStateExact(latest);
      const output = await this.#verifyOutputArtifacts(jobDirectory, jobId);
      if (output.index.indexSha256 !== latest.outputIndexSha256) {
        throw new ReferenceVerificationJobErrorV0(
          "REFERENCE_OUTPUT_STATE_BINDING_MISMATCH",
          "The final output index is not the one bound into the authenticated succeeded state.",
        );
      }
      if (
        output.observation.completedAttempt !== latest.attempt ||
        output.observation.attemptCount !== latest.attempt
      ) {
        throw new ReferenceVerificationJobErrorV0(
          "REFERENCE_OUTPUT_ATTEMPT_MISMATCH",
          "The final observation does not match the authenticated succeeded attempt.",
        );
      }
    } else if (latest.outputIndexSha256 !== null) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_OUTPUT_BOUND_BEFORE_SUCCESS",
        "A non-succeeded state cannot bind a final output index.",
      );
    }
    return latest;
  }

  async cancel(jobId: string): Promise<ReferenceVerificationJobSnapshotV0> {
    const active = this.#active.get(jobId);
    if (active === undefined) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_JOB_NOT_ACTIVE", "This coordinator does not have an active run for that job.");
    }
    active.controller.abort();
    return active.completion;
  }

  async verifyOutput(jobId: string): Promise<ReferenceVerificationVerifiedOutputV0> {
    const { jobDirectory } = await this.#openExisting(jobId);
    const states = await readStateChain(jobDirectory, this.#authenticationKey);
    const checkpoints = await readCheckpointChain(jobDirectory, this.#authenticationKey);
    this.#validateRecoveredBindings(jobId, states, checkpoints);
    const latest = states.at(-1);
    if (latest === undefined) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_MISSING", "The job has no state.");
    }
    this.#assertSucceededStateExact(latest);
    const output = await this.#verifyOutputArtifacts(jobDirectory, jobId);
    if (output.index.indexSha256 !== latest.outputIndexSha256) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_OUTPUT_STATE_BINDING_MISMATCH",
        "The final output index is not the one bound into the authenticated succeeded state.",
      );
    }
    if (
      output.observation.completedAttempt !== latest.attempt ||
      output.observation.attemptCount !== latest.attempt
    ) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_OUTPUT_ATTEMPT_MISMATCH",
        "The final observation does not match the authenticated succeeded attempt.",
      );
    }
    return output;
  }

  async #verifyOutputArtifacts(
    jobDirectory: string,
    jobId: string,
  ): Promise<ReferenceVerificationVerifiedOutputV0> {
    const outputDirectory = join(jobDirectory, "outputs");
    const resultRecord = await readCanonicalJson(join(outputDirectory, "deterministic-result.json"));
    const observationRecord = await readCanonicalJson(join(outputDirectory, "observation.json"));
    const indexRecord = await readCanonicalJson(join(outputDirectory, "index.json"));
    const expectedResult = sealResult(this.#binding, this.#subjectBindingSha256);
    const result = parseAndValidateResult(resultRecord.value, expectedResult);
    if (
      !isRecord(observationRecord.value) ||
      observationRecord.value.schemaVersion !== OBSERVATION_SCHEMA ||
      typeof observationRecord.value.attemptCount !== "number" ||
      !Number.isSafeInteger(observationRecord.value.attemptCount) ||
      observationRecord.value.attemptCount < 1 ||
      typeof observationRecord.value.completedAttempt !== "number" ||
      !Number.isSafeInteger(observationRecord.value.completedAttempt) ||
      observationRecord.value.completedAttempt < 1 ||
      !isRecord(observationRecord.value.verificationInterval) ||
      typeof observationRecord.value.verificationInterval.startedAt !== "string" ||
      !Number.isFinite(Date.parse(observationRecord.value.verificationInterval.startedAt)) ||
      typeof observationRecord.value.verificationInterval.completedAt !== "string" ||
      !Number.isFinite(Date.parse(observationRecord.value.verificationInterval.completedAt))
    ) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_OBSERVATION_INVALID", "The verification observation is invalid.");
    }
    if (
      observationRecord.value.jobId !== jobId ||
      observationRecord.value.subjectBindingSha256 !== this.#subjectBindingSha256 ||
      observationRecord.value.sourcePayloadBytesStaged !== 0 ||
      observationRecord.value.checkpointMayContainSourceFragments !== true
    ) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_OBSERVATION_BINDING_MISMATCH", "The verification observation does not match this exact job and subject.");
    }
    const observation = copyValidatedRecord<ReferenceVerificationObservationV0>(
      observationRecord.value,
      ["schemaVersion", "jobId", "subjectBindingSha256"],
    );
    if (!isRecord(indexRecord.value) || typeof indexRecord.value.indexSha256 !== "string") {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_OUTPUT_INDEX_INVALID", "The output index is invalid.");
    }
    if (digestObject(INDEX_DIGEST_DOMAIN, indexRecord.value, "indexSha256") !== indexRecord.value.indexSha256) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_OUTPUT_INDEX_INTEGRITY_MISMATCH", "The output index self-digest does not match.");
    }
    const expectedIndex = sealIndex(this.#subjectBindingSha256, resultRecord.bytes, observationRecord.bytes);
    if (!canonicalBytes(indexRecord.value).equals(canonicalBytes(expectedIndex))) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_OUTPUT_INDEX_CONTENT_MISMATCH", "The output index does not describe the exact output bytes.");
    }
    return {
      result,
      observation,
      index: copyValidatedRecord<ReferenceVerificationOutputIndexV0>(
        indexRecord.value,
        ["schemaVersion", "indexSha256", "artifacts"],
      ),
    };
  }

  #assertSucceededStateExact(state: ReferenceVerificationJobSnapshotV0): void {
    const totalBytes = totalSubjectBytes(this.#binding);
    if (
      state.phase !== "succeeded" ||
      state.failure !== null ||
      state.outputIndexSha256 === null ||
      state.latestCheckpointEnvelopeSha256 !== null ||
      state.completedFiles.length !== this.#binding.files.length ||
      state.progress.totalFiles !== this.#binding.files.length ||
      state.progress.totalBytes !== totalBytes ||
      state.progress.filesVerified !== this.#binding.files.length ||
      state.progress.verifiedBytes !== totalBytes ||
      state.progress.activeFileIndex !== null ||
      state.progress.activeFileConfirmedBytes !== 0 ||
      state.progress.durablyConfirmedBytes !== totalBytes
    ) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_JOB_NOT_VERIFIED_SUCCEEDED",
        "Only a complete authenticated succeeded state can authorize final output verification.",
      );
    }
    for (const [index, completed] of state.completedFiles.entries()) {
      const admitted = this.#binding.files[index];
      if (
        admitted === undefined ||
        completed.fileIndex !== index ||
        completed.relativePath !== admitted.relativePath ||
        completed.sizeBytes !== admitted.sizeBytes ||
        completed.sha256 !== admitted.sha256
      ) {
        throw new ReferenceVerificationJobErrorV0(
          "REFERENCE_SUCCEEDED_FILE_ORDER_MISMATCH",
          "The authenticated succeeded state does not contain every admitted file in exact order.",
        );
      }
    }
  }

  async #openExisting(jobId: string): Promise<{
    readonly environment: PreparedEnvironmentV0;
    readonly jobDirectory: string;
    readonly subject: DurableSubjectV0;
  }> {
    const environment = await prepareEnvironment(this.#options.evidenceRoot, this.#options.subject);
    const namespace = await ensureJobNamespace(environment.evidenceRoot);
    const jobDirectory = jobDirectoryFor(namespace, jobId);
    await ensureCanonicalExistingDirectory(jobDirectory, "The verification job directory");
    const subject = parseSubject(
      (await readCanonicalJson(join(jobDirectory, "subject.json"))).value,
      this.#authenticationKey,
    );
    const expected = sealSubject(this.#binding, subject.initialSourceIdentity, this.#authenticationKey);
    if (
      subject.subjectBindingSha256 !== this.#subjectBindingSha256 ||
      !canonicalBytes(subject).equals(canonicalBytes(expected))
    ) {
      throw new ReferenceVerificationJobErrorV0("REFERENCE_JOB_SUBJECT_MISMATCH", "The job does not belong to this exact admitted subject.");
    }
    return { environment, jobDirectory, subject };
  }

  #validateRecoveredBindings(
    jobId: string,
    states: readonly ReferenceVerificationJobSnapshotV0[],
    checkpoints: readonly CheckpointEnvelopeV0[],
  ): void {
    for (const state of states) {
      if (state.jobId !== jobId || state.subjectBindingSha256 !== this.#subjectBindingSha256) {
        throw new ReferenceVerificationJobErrorV0("REFERENCE_STATE_BINDING_MISMATCH", "A state snapshot belongs to another job or admitted subject.");
      }
    }
    for (const checkpoint of checkpoints) {
      const file = this.#binding.files[checkpoint.fileIndex];
      if (
        checkpoint.jobId !== jobId ||
        checkpoint.subjectBindingSha256 !== this.#subjectBindingSha256 ||
        file === undefined ||
        checkpoint.relativePath !== file.relativePath ||
        checkpoint.checkpoint.expectedSha256 !== file.sha256 ||
        checkpoint.checkpoint.expectedSizeBytes !== file.sizeBytes
      ) {
        throw new ReferenceVerificationJobErrorV0("REFERENCE_CHECKPOINT_BINDING_MISMATCH", "A private checkpoint belongs to another job, subject, or file.");
      }
    }
    const latest = states.at(-1);
    if (
      latest !== undefined &&
      checkpoints.some((checkpoint) => checkpoint.attempt > latest.attempt)
    ) {
      throw new ReferenceVerificationJobErrorV0(
        "REFERENCE_CHECKPOINT_ATTEMPT_AHEAD",
        "A private checkpoint claims an attempt that has no authenticated state.",
      );
    }
    if (latest?.latestCheckpointEnvelopeSha256 !== null) {
      const referenced = checkpoints.find((checkpoint) => checkpoint.envelopeSha256 === latest?.latestCheckpointEnvelopeSha256);
      if (referenced === undefined || referenced.attempt !== latest?.attempt) {
        throw new ReferenceVerificationJobErrorV0("REFERENCE_CHECKPOINT_REFERENCE_MISSING", "The latest state references a missing private checkpoint.");
      }
    }
  }

  async #assertCompletedFilesUnchanged(
    environment: PreparedEnvironmentV0,
    completedFiles: readonly ReferenceVerificationCompletedFileV0[],
  ): Promise<void> {
    for (const completed of completedFiles) {
      const admitted = this.#binding.files[completed.fileIndex];
      if (
        admitted === undefined ||
        admitted.relativePath !== completed.relativePath ||
        admitted.sizeBytes !== completed.sizeBytes ||
        admitted.sha256 !== completed.sha256
      ) {
        throw new ReferenceVerificationJobErrorV0(
          "REFERENCE_COMPLETED_FILE_BINDING_INVALID",
          "A completed-file record no longer matches the exact admitted subject.",
        );
      }
      const absolute = await resolveAdmittedFile(
        environment.sourcePath,
        this.#binding.sourceKind,
        admitted,
      );
      const metadata = await lstat(absolute, { bigint: true });
      const identity: ResumableFileIdentity = {
        deviceId: metadata.dev.toString(10),
        inode: metadata.ino.toString(10),
        sizeBytes: Number(metadata.size),
        modifiedTimeNanoseconds: metadata.mtimeNs.toString(10),
        statusChangedTimeNanoseconds: metadata.ctimeNs.toString(10),
      };
      if (!sameFileIdentity(identity, completed.fileIdentity)) {
        throw new ReferenceVerificationJobErrorV0(
          "REFERENCE_COMPLETED_SOURCE_CHANGED",
          "A previously verified source file changed before the final result was sealed.",
        );
      }
    }
  }

  async #launch(
    jobId: string,
    environment: PreparedEnvironmentV0,
    jobDirectory: string,
    recovered: ReferenceVerificationJobSnapshotV0,
  ): Promise<ReferenceVerificationJobControlV0> {
    const launchedAttempt = recovered.attempt + 1;
    const lease = await acquireWriterLease(
      jobDirectory,
      jobId,
      environment.sourcePath,
      this.#authenticationKey,
    );
    const controller = new AbortController();
    const completion = this.#run(
      jobId,
      environment,
      jobDirectory,
      recovered,
      controller,
      lease,
    )
      .finally(() => {
        this.#active.delete(jobId);
      });
    this.#active.set(jobId, { controller, completion });
    return {
      jobId,
      attempt: launchedAttempt,
      completion,
      cancel: async () => {
        controller.abort();
        return completion;
      },
    };
  }

  async #run(
    jobId: string,
    environment: PreparedEnvironmentV0,
    jobDirectory: string,
    recovered: ReferenceVerificationJobSnapshotV0,
    controller: AbortController,
    lease: WriterLeaseV0,
  ): Promise<ReferenceVerificationJobSnapshotV0> {
    let current = recovered;
    const attempt = recovered.attempt + 1;
    const attemptStartedAt = nowIso();
    let completedFiles = [...recovered.completedFiles];
    let activeFileIndex: number | null = recovered.progress.activeFileIndex;
    let activeConfirmedBytes = recovered.progress.activeFileConfirmedBytes;
    let latestCheckpointEnvelopeSha256 = recovered.latestCheckpointEnvelopeSha256;
    let measuredThisAttempt = 0;
    let priorMinimumMeasured = recovered.progress.minimumMeasuredBytesReadAcrossAttempts;
    let minimumMeasuredAcrossAttempts = priorMinimumMeasured;
    let resumedFromThisAttempt = 0;
    let activeHashBaseMeasured = 0;
    let activeHashLatestBytes = 0;
    try {
      await quarantineUnboundOutputs(jobDirectory, lease);
      const checkpointChain = await readCheckpointChain(jobDirectory, this.#authenticationKey);
      let checkpointTail = checkpointChain.at(-1) ?? null;
      const recoveredNextFileIndex = completedFiles.length;
      const recoveredAttemptCheckpointTail = [...checkpointChain]
        .reverse()
        .find((entry) => entry.attempt === recovered.attempt);
      if (
        recoveredAttemptCheckpointTail !== undefined &&
        recoveredAttemptCheckpointTail.fileIndex > recoveredNextFileIndex
      ) {
        throw new ReferenceVerificationJobErrorV0(
          "REFERENCE_CHECKPOINT_AHEAD_OF_STATE",
          "A private checkpoint is ahead of the last authenticated completed-file state.",
        );
      }
      const recoverableTail = [...checkpointChain]
        .reverse()
        .find((entry) => (
          entry.attempt === recovered.attempt &&
          entry.fileIndex === recoveredNextFileIndex
        ));
      const unrecordedTailBytes = Math.max(
        0,
        (recoverableTail?.confirmedOffsetBytes ?? 0) - recovered.progress.activeFileConfirmedBytes,
      );
      priorMinimumMeasured += unrecordedTailBytes;
      minimumMeasuredAcrossAttempts = priorMinimumMeasured;
      const strongIdentityAttested =
        this.#options.resumePolicy === "strong_local_filesystem_attested";
      if (
        strongIdentityAttested &&
        recoverableTail !== undefined &&
        recoverableTail.confirmedOffsetBytes >= activeConfirmedBytes
      ) {
        activeFileIndex = recoveredNextFileIndex;
        activeConfirmedBytes = recoverableTail.confirmedOffsetBytes;
        latestCheckpointEnvelopeSha256 = recoverableTail.envelopeSha256;
      } else if (strongIdentityAttested) {
        activeFileIndex = completedFiles.length < this.#binding.files.length
          ? completedFiles.length
          : null;
        activeConfirmedBytes = 0;
        latestCheckpointEnvelopeSha256 = null;
      } else {
        completedFiles = [];
        activeFileIndex = this.#binding.files.length === 0 ? null : 0;
        activeConfirmedBytes = 0;
        latestCheckpointEnvelopeSha256 = null;
      }
      current = await appendState(jobDirectory, environment.sourcePath, current, this.#authenticationKey, lease, {
        jobId,
        subjectBindingSha256: this.#subjectBindingSha256,
        phase: "running",
        attempt,
        observedAt: attemptStartedAt,
        progress: makeProgress(
          this.#binding,
          completedFiles,
          activeFileIndex,
          activeConfirmedBytes,
          0,
          priorMinimumMeasured,
          0,
        ),
        latestCheckpointEnvelopeSha256,
        completedFiles,
        failure: null,
        outputIndexSha256: null,
      });
      const rootIdentity = await inspectSourceIdentity(environment.sourcePath, this.#binding.sourceKind);
      if (!sameIdentity(environment.sourceIdentity, rootIdentity)) {
        throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_IDENTITY_CHANGED", "The source root identity changed before verification resumed.");
      }
      await this.#assertCompletedFilesUnchanged(environment, completedFiles);
      for (let fileIndex = completedFiles.length; fileIndex < this.#binding.files.length; fileIndex += 1) {
        const admitted = this.#binding.files[fileIndex];
        if (admitted === undefined) throw new ReferenceVerificationJobErrorV0("REFERENCE_FILE_MISSING", "The admitted file list is incomplete.");
        activeFileIndex = fileIndex;
        const referencedEnvelope = !strongIdentityAttested || latestCheckpointEnvelopeSha256 === null
          ? undefined
          : checkpointChain.find((entry) => entry.envelopeSha256 === latestCheckpointEnvelopeSha256 && entry.fileIndex === fileIndex);
        const checkpoint = referencedEnvelope?.checkpoint;
        const resumeOffset = checkpoint?.confirmedOffsetBytes ?? 0;
        if (resumeOffset > 0) resumedFromThisAttempt += resumeOffset;
        activeConfirmedBytes = resumeOffset;
        const beforeFileMeasured = measuredThisAttempt;
        activeHashBaseMeasured = beforeFileMeasured;
        activeHashLatestBytes = 0;
        const absolutePath = await resolveAdmittedFile(environment.sourcePath, this.#binding.sourceKind, admitted);
        let latestProgressBytes = 0;
        const result: ResumableFileHashResult = await verifyResumableSha256File({
          absolutePath,
          relativePath: admitted.relativePath,
          expectedSizeBytes: admitted.sizeBytes,
          expectedSha256: admitted.sha256,
          checkpoint,
          checkpointAuthentication: {
            key: this.#authenticationKey,
            keyId: CHECKPOINT_AUTHENTICATION_KEY_ID,
            context: jobId,
          },
          resumeSafety: strongIdentityAttested ? "strong_identity_required" : undefined,
          checkpointIntervalBytes: this.#options.checkpointIntervalBytes ?? DEFAULT_CHECKPOINT_INTERVAL_BYTES,
          readBufferBytes: this.#options.readBufferBytes,
          testOnlyAllowSmallIo: process.env.NODE_ENV === "test" ? true : undefined,
          signal: controller.signal,
          onProgress: (progress) => {
            latestProgressBytes = progress.bytesReadThisAttempt;
            activeHashLatestBytes = progress.bytesReadThisAttempt;
            notifyObserverWithoutWaiting(this.#options.onMeasuredProgress, {
                jobId,
                attempt,
                fileIndex,
                relativePath: admitted.relativePath,
                currentOffsetBytes: progress.currentOffsetBytes,
                bytesReadThisAttempt: progress.bytesReadThisAttempt,
                durablyConfirmedBytes: progress.durablyConfirmedBytes,
            });
          },
          onCheckpoint: async (hashCheckpoint) => {
            const envelope = await appendCheckpoint(
              jobDirectory,
              environment.sourcePath,
              checkpointTail,
              this.#authenticationKey,
              lease,
              {
              jobId,
              subjectBindingSha256: this.#subjectBindingSha256,
              attempt,
              fileIndex,
              relativePath: admitted.relativePath,
              confirmedOffsetBytes: hashCheckpoint.confirmedOffsetBytes,
              createdAt: nowIso(),
              checkpoint: hashCheckpoint,
              },
            );
            checkpointTail = envelope;
            latestCheckpointEnvelopeSha256 = envelope.envelopeSha256;
            activeConfirmedBytes = hashCheckpoint.confirmedOffsetBytes;
            measuredThisAttempt = beforeFileMeasured + (hashCheckpoint.confirmedOffsetBytes - resumeOffset);
            minimumMeasuredAcrossAttempts = priorMinimumMeasured + measuredThisAttempt;
            current = await appendState(jobDirectory, environment.sourcePath, current, this.#authenticationKey, lease, {
              jobId,
              subjectBindingSha256: this.#subjectBindingSha256,
              phase: "running",
              attempt,
              observedAt: nowIso(),
              progress: makeProgress(
                this.#binding,
                completedFiles,
                fileIndex,
                activeConfirmedBytes,
                measuredThisAttempt,
                minimumMeasuredAcrossAttempts,
                resumedFromThisAttempt,
              ),
              latestCheckpointEnvelopeSha256,
              completedFiles,
              failure: null,
              outputIndexSha256: null,
            });
            await notifyObserverWithBoundedWait(
              this.#options.onDurableCheckpoint,
              {
                jobId,
                attempt,
                fileIndex,
                relativePath: admitted.relativePath,
                confirmedOffsetBytes: activeConfirmedBytes,
                snapshot: current,
              },
              controller.signal,
            );
          },
        });
        if (result.sha256 !== admitted.sha256 || result.sizeBytes !== admitted.sizeBytes) {
          throw new ReferenceVerificationJobErrorV0("REFERENCE_HASH_RESULT_MISMATCH", "The file verifier returned a result that does not match the admitted receipt.");
        }
        measuredThisAttempt = beforeFileMeasured + result.bytesReadThisAttempt;
        if (latestProgressBytes > result.bytesReadThisAttempt) {
          throw new ReferenceVerificationJobErrorV0("REFERENCE_PROGRESS_REGRESSED", "The measured file-read progress regressed.");
        }
        minimumMeasuredAcrossAttempts = priorMinimumMeasured + measuredThisAttempt;
        completedFiles = [
          ...completedFiles,
          {
            fileIndex,
            relativePath: admitted.relativePath,
            sizeBytes: admitted.sizeBytes,
            sha256: admitted.sha256,
            fileIdentity: result.fileIdentity,
          },
        ];
        activeFileIndex = null;
        activeConfirmedBytes = 0;
        latestCheckpointEnvelopeSha256 = null;
        current = await appendState(jobDirectory, environment.sourcePath, current, this.#authenticationKey, lease, {
          jobId,
          subjectBindingSha256: this.#subjectBindingSha256,
          phase: "running",
          attempt,
          observedAt: nowIso(),
          progress: makeProgress(
            this.#binding,
            completedFiles,
            null,
            0,
            measuredThisAttempt,
            minimumMeasuredAcrossAttempts,
            resumedFromThisAttempt,
          ),
          latestCheckpointEnvelopeSha256: null,
          completedFiles,
          failure: null,
          outputIndexSha256: null,
        });
      }
      const finalRootIdentity = await inspectSourceIdentity(environment.sourcePath, this.#binding.sourceKind);
      if (!sameIdentity(environment.sourceIdentity, finalRootIdentity)) {
        throw new ReferenceVerificationJobErrorV0("REFERENCE_SOURCE_CHANGED_DURING_JOB", "The source root changed during the verification interval.");
      }
      await this.#assertCompletedFilesUnchanged(environment, completedFiles);
      const result = sealResult(this.#binding, this.#subjectBindingSha256);
      const completedAt = nowIso();
      const observation = observationFor(jobId, this.#subjectBindingSha256, attemptStartedAt, completedAt, current);
      const outputIndex = await promoteOutputs(
        jobDirectory,
        environment.sourcePath,
        result,
        observation,
        lease,
      );
      current = await appendState(jobDirectory, environment.sourcePath, current, this.#authenticationKey, lease, {
        jobId,
        subjectBindingSha256: this.#subjectBindingSha256,
        phase: "succeeded",
        attempt,
        observedAt: completedAt,
        progress: makeProgress(
          this.#binding,
          completedFiles,
          null,
          0,
          measuredThisAttempt,
          minimumMeasuredAcrossAttempts,
          resumedFromThisAttempt,
        ),
        latestCheckpointEnvelopeSha256: null,
        completedFiles,
        failure: null,
        outputIndexSha256: outputIndex.indexSha256,
      });
      return current;
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof ResumableFileHashError && error.code === "HASH_CANCELLED");
      if (error instanceof ResumableFileHashError && error.progress !== null) {
        activeHashLatestBytes = Math.max(activeHashLatestBytes, error.progress.bytesReadThisAttempt);
      }
      measuredThisAttempt = Math.max(
        measuredThisAttempt,
        activeHashBaseMeasured + activeHashLatestBytes,
      );
      minimumMeasuredAcrossAttempts = priorMinimumMeasured + measuredThisAttempt;
      current = await appendState(jobDirectory, environment.sourcePath, current, this.#authenticationKey, lease, {
        jobId,
        subjectBindingSha256: this.#subjectBindingSha256,
        phase: cancelled ? "paused" : "failed",
        attempt,
        observedAt: nowIso(),
        progress: makeProgress(
          this.#binding,
          completedFiles,
          activeFileIndex,
          activeConfirmedBytes,
          measuredThisAttempt,
          minimumMeasuredAcrossAttempts,
          resumedFromThisAttempt,
        ),
        latestCheckpointEnvelopeSha256,
        completedFiles,
        failure: cancelled ? null : sanitizedFailure(error),
        outputIndexSha256: null,
      });
      return current;
    } finally {
      await lease.release();
    }
  }
}

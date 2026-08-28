import { createHash, randomBytes } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
  type CanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import {
  grandHallT554V3ComparablePath,
  grandHallT554V3SameFileState,
  grandHallT554V3SameNode,
} from "./grand-hall-t554-review-pack-v3-files.js";
import { isSafeGrandHallT554RelativePath } from "./grand-hall-t554-path-safety.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-native-review-journal-scope.v1";
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-native-review-journal-event.v1";
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_QUARANTINE_MARKER_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-native-review-journal-quarantine-marker.v1";
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V1";
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_GENESIS_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_GENESIS_V1";
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_V1";
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_BYTES = 1_048_576;
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_COUNT = 16_384;
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_TOTAL_EVENT_BYTES =
  64 * 1_024 * 1_024;

const SCOPE_FILE_NAME = "scope.json";
const CLAIMS_DIRECTORY_NAME = "claims";
const EVENTS_DIRECTORY_NAME = "events";
const PENDING_DIRECTORY_NAME = "pending";
const QUARANTINE_DIRECTORY_NAME = "quarantine";
const EVENT_SEQUENCE_WIDTH = 16;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const MAX_SCOPE_BYTES = 16_384;
const MAX_QUARANTINE_BYTES =
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_BYTES;
const MAX_QUARANTINE_ENTRY_COUNT =
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_COUNT;
const MAX_QUARANTINE_TOTAL_BYTES =
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_TOTAL_EVENT_BYTES;
const MAX_PENDING_ENTRY_COUNT = 256;
const MAXIMUM_PARALLEL_EVENT_READS = 32;
// This is a per-directory metadata bound. A stable replay snapshots four
// directories together, so its documented aggregate ceiling is 128 checks.
const MAXIMUM_PARALLEL_INVENTORY_ENTRY_CHECKS = 32;
const MAXIMUM_QUARANTINE_RECONCILIATION_ATTEMPTS = 32;
const ROOT_INVENTORY = [
  CLAIMS_DIRECTORY_NAME,
  EVENTS_DIRECTORY_NAME,
  PENDING_DIRECTORY_NAME,
  QUARANTINE_DIRECTORY_NAME,
  SCOPE_FILE_NAME,
].sort(lexicalOrder);
const PROHIBITED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_.-]{0,95}$/u;
const EVENT_FILE_PATTERN = /^([0-9]{16})-sha256-([0-9a-f]{64})\.json$/u;
const CLAIM_FILE_PATTERN = /^([0-9]{16})\.json$/u;
const PENDING_FILE_PATTERN =
  /^pending-([0-9]{16})-sha256-([0-9a-f]{64})-([0-9a-f]{32})\.json$/u;
const MOVED_QUARANTINE_FILE_PATTERN =
  /^moved-([0-9]{16})-sha256-([0-9a-f]{64})-bytes-(0|[1-9][0-9]{0,6})-sha256-([0-9a-f]{64})-([0-9a-f]{32})\.json$/u;
const MARKER_QUARANTINE_FILE_PATTERN =
  /^marker-([0-9]{16})-sha256-([0-9a-f]{64})-([0-9a-f]{32})\.json$/u;
const UTC_MILLISECOND_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

type Sha256 = `sha256:${string}`;

const Sha256Schema = z
  .string()
  .regex(SHA256_PATTERN)
  .transform((value): Sha256 => value as Sha256);
const SequenceSchema = z.number().int().min(1).max(MAX_SEQUENCE);

export const GrandHallT554NativeReviewJournalScopeSchema = z
  .object({
    sessionNonceSha256: Sha256Schema,
    sourceEpochSha256: Sha256Schema,
    subjectSha256: Sha256Schema,
    kind: z.enum(["session", "source", "mask"]),
    implementationSha256: Sha256Schema,
  })
  .strict();

export type GrandHallT554NativeReviewJournalScope = z.infer<
  typeof GrandHallT554NativeReviewJournalScopeSchema
>;

const ScopeFileMaterialSchema = z
  .object({
    schemaVersion: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_SCHEMA,
    ),
    scope: GrandHallT554NativeReviewJournalScopeSchema,
  })
  .strict();

const ScopeFileSchema = ScopeFileMaterialSchema.extend({
  scopeSha256: Sha256Schema,
}).strict();

const PersistedEventMaterialSchema = z
  .object({
    schemaVersion: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_SCHEMA,
    ),
    sequence: SequenceSchema,
    previousEventSha256: Sha256Schema,
    scope: GrandHallT554NativeReviewJournalScopeSchema,
    scopeSha256: Sha256Schema,
    scopeFileSha256: Sha256Schema,
    recordedAtUtc: z.string(),
    eventType: z.string().regex(EVENT_TYPE_PATTERN),
    payload: z.unknown(),
  })
  .strict();

const PersistedEventSchema = PersistedEventMaterialSchema.extend({
  eventSha256: Sha256Schema,
}).strict();

const QuarantineMarkerSchema = z
  .object({
    schemaVersion: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_QUARANTINE_MARKER_SCHEMA,
    ),
    scopeSha256: Sha256Schema,
    sequence: SequenceSchema,
    attemptedEventFileName: z.string(),
    attemptedEventSha256: Sha256Schema,
    disposition: z.literal("append_ambiguous_no_delete"),
  })
  .strict();

export interface GrandHallT554NativeReviewJournalAppendInput {
  readonly expectedRevision: number;
  readonly eventType: string;
  readonly payload: CanonicalJson;
  /**
   * Optional server-owned lower bound for the durable record time. The low-level
   * journal never derives this from payload bytes; typed adapters may supply it
   * after replaying their domain event.
   */
  readonly minimumRecordedAtUtc?: string;
}

export interface GrandHallT554NativeReviewJournalAppendValidation {
  readonly minimumRecordedAtUtc?: string;
}

export interface GrandHallT554NativeReviewJournalValidatedAppendInput extends Omit<
  GrandHallT554NativeReviewJournalAppendInput,
  "minimumRecordedAtUtc"
> {
  readonly validateCurrent: (
    current: Readonly<GrandHallT554NativeReviewJournalReplay>,
  ) => GrandHallT554NativeReviewJournalAppendValidation;
}

export interface GrandHallT554NativeReviewJournalEvent {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_SCHEMA;
  readonly sequence: number;
  readonly previousEventSha256: Sha256;
  readonly scope: GrandHallT554NativeReviewJournalScope;
  readonly scopeSha256: Sha256;
  readonly scopeFileSha256: Sha256;
  readonly recordedAtUtc: string;
  readonly eventType: string;
  readonly payload: CanonicalJson;
  readonly eventSha256: Sha256;
  readonly fileName: string;
  readonly fileSha256: Sha256;
  readonly fileByteLength: number;
}

export interface GrandHallT554NativeReviewJournalReplay {
  readonly scope: GrandHallT554NativeReviewJournalScope;
  readonly scopeSha256: Sha256;
  readonly scopeFileSha256: Sha256;
  readonly genesisSha256: Sha256;
  readonly revision: number;
  readonly headEventSha256: Sha256;
  readonly events: readonly GrandHallT554NativeReviewJournalEvent[];
}

/**
 * A process-crash-recoverable ordered record only; it conveys no review,
 * acceptance, or truth authority. Node cannot issue a directory durability
 * barrier on every platform, so this API does not claim sudden-power-loss
 * durability where directory fsync is unsupported (notably Windows).
 *
 * Cross-process contract: the sequence hard link is a final defensive CAS,
 * not an ownership protocol. A caller that can open, replay, recover, or append
 * this journal MUST hold the session root's explicit exclusive owner for the
 * whole operation. Stale ownership requires an explicit verified takeover;
 * PID age or elapsed time alone must never authorize recovery. The in-process
 * serial lane below does not satisfy this cross-process requirement.
 */
export interface GrandHallT554NativeReviewJournal {
  readonly workspaceRoot: string;
  readonly scope: GrandHallT554NativeReviewJournalScope;
  replay(): Promise<GrandHallT554NativeReviewJournalReplay>;
  append(
    input: GrandHallT554NativeReviewJournalAppendInput,
  ): Promise<GrandHallT554NativeReviewJournalReplay>;
  /**
   * Runs domain validation against the exact replay already held by the
   * journal's serial append lane. The callback must return the low-level event
   * only after accepting that replay; rejection publishes nothing.
   */
  appendValidated(
    input: GrandHallT554NativeReviewJournalValidatedAppendInput,
  ): Promise<GrandHallT554NativeReviewJournalReplay>;
}

export interface GrandHallT554NativeReviewJournalCreateOptions {
  readonly workspaceRoot: string;
  readonly scope: GrandHallT554NativeReviewJournalScope;
}

export interface GrandHallT554NativeReviewJournalOpenOptions {
  readonly workspaceRoot: string;
  readonly expectedScope: GrandHallT554NativeReviewJournalScope;
}

export interface __GrandHallT554NativeReviewJournalTestSeams {
  readonly nowUtc?: () => string;
  readonly quarantineToken?: () => string;
  readonly writeChunkByteLength?: number;
  readonly afterReplayBeforeReserve?: (context: {
    readonly workspaceRoot: string;
    readonly revision: number;
  }) => Promise<void> | void;
  readonly afterEventFileReserved?: (context: {
    readonly absolutePath: string;
    readonly sequence: number;
  }) => Promise<void> | void;
  readonly afterEventWriteChunk?: (context: {
    readonly absolutePath: string;
    readonly writtenByteLength: number;
    readonly totalByteLength: number;
  }) => Promise<void> | void;
  readonly afterEventFileSynced?: (context: {
    readonly absolutePath: string;
    readonly sequence: number;
  }) => Promise<void> | void;
  readonly afterClaimDirectorySynced?: (context: {
    readonly absolutePath: string;
    readonly sequence: number;
  }) => Promise<void> | void;
  readonly afterClaimConflictDetectedBeforeQuarantine?: (context: {
    readonly pendingAbsolutePath: string;
    readonly claimAbsolutePath: string;
    readonly sequence: number;
  }) => Promise<void> | void;
  readonly afterEventDirectorySynced?: (context: {
    readonly absolutePath: string;
    readonly sequence: number;
  }) => Promise<void> | void;
  readonly afterPendingDirectorySyncedBeforePostReplay?: (context: {
    readonly absolutePath: string;
    readonly sequence: number;
  }) => Promise<void> | void;
  readonly beforeCommittedContentRead?: (context: {
    readonly kind: "claim" | "event";
    readonly absolutePath: string;
    readonly sequence: number;
  }) => Promise<void> | void;
  readonly afterCommittedContentRead?: (context: {
    readonly kind: "claim" | "event";
    readonly absolutePath: string;
    readonly sequence: number;
  }) => Promise<void> | void;
  readonly beforeDirectorySync?: (context: {
    readonly absolutePath: string;
    readonly reason: string;
  }) => Promise<void> | void;
  readonly maximumEventCount?: number;
  readonly maximumTotalEventBytes?: number;
  readonly maximumQuarantineEntryCount?: number;
  readonly maximumQuarantineTotalBytes?: number;
}

export class GrandHallT554NativeReviewJournalError extends Error {
  constructor(
    public readonly code:
      | "ARGUMENT_INVALID"
      | "WORKSPACE_UNSAFE"
      | "JOURNAL_INVALID"
      | "JOURNAL_LIMIT_REACHED"
      | "REVISION_CONFLICT"
      | "APPEND_FAILED"
      | "APPEND_AMBIGUOUS",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewJournalError";
  }
}

interface NodeWitness {
  readonly absolutePath: string;
  readonly stats: BigIntStats;
}

interface JournalLimits {
  readonly maximumEventCount: number;
  readonly maximumTotalEventBytes: number;
  readonly maximumQuarantineEntryCount: number;
  readonly maximumQuarantineTotalBytes: number;
}

const PRODUCTION_JOURNAL_LIMITS = Object.freeze({
  maximumEventCount: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_COUNT,
  maximumTotalEventBytes:
    GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_TOTAL_EVENT_BYTES,
  maximumQuarantineEntryCount: MAX_QUARANTINE_ENTRY_COUNT,
  maximumQuarantineTotalBytes: MAX_QUARANTINE_TOTAL_BYTES,
});

function journalLimits(
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): JournalLimits {
  const limits = {
    maximumEventCount:
      seams.maximumEventCount ?? PRODUCTION_JOURNAL_LIMITS.maximumEventCount,
    maximumTotalEventBytes:
      seams.maximumTotalEventBytes ??
      PRODUCTION_JOURNAL_LIMITS.maximumTotalEventBytes,
    maximumQuarantineEntryCount:
      seams.maximumQuarantineEntryCount ??
      PRODUCTION_JOURNAL_LIMITS.maximumQuarantineEntryCount,
    maximumQuarantineTotalBytes:
      seams.maximumQuarantineTotalBytes ??
      PRODUCTION_JOURNAL_LIMITS.maximumQuarantineTotalBytes,
  };
  if (
    !Number.isSafeInteger(limits.maximumEventCount) ||
    limits.maximumEventCount < 1 ||
    limits.maximumEventCount > PRODUCTION_JOURNAL_LIMITS.maximumEventCount ||
    !Number.isSafeInteger(limits.maximumTotalEventBytes) ||
    limits.maximumTotalEventBytes < 1 ||
      limits.maximumTotalEventBytes >
      PRODUCTION_JOURNAL_LIMITS.maximumTotalEventBytes ||
    !Number.isSafeInteger(limits.maximumQuarantineEntryCount) ||
    limits.maximumQuarantineEntryCount < 1 ||
    limits.maximumQuarantineEntryCount >
      PRODUCTION_JOURNAL_LIMITS.maximumQuarantineEntryCount ||
    !Number.isSafeInteger(limits.maximumQuarantineTotalBytes) ||
    limits.maximumQuarantineTotalBytes < 1 ||
    limits.maximumQuarantineTotalBytes >
      PRODUCTION_JOURNAL_LIMITS.maximumQuarantineTotalBytes
  ) {
    throw new GrandHallT554NativeReviewJournalError(
      "ARGUMENT_INVALID",
      "Native-review journal limits must be positive and no greater than production bounds.",
    );
  }
  return Object.freeze(limits);
}

interface JournalLayout {
  readonly root: NodeWitness;
  readonly claims: NodeWitness;
  readonly events: NodeWitness;
  readonly pending: NodeWitness;
  readonly quarantine: NodeWitness;
  readonly scopeFile: NodeWitness;
  readonly scope: GrandHallT554NativeReviewJournalScope;
  readonly scopeSha256: Sha256;
  readonly scopeFileSha256: Sha256;
  readonly genesisSha256: Sha256;
}

interface DirectoryEntrySnapshot {
  readonly name: string;
  readonly stats: BigIntStats;
}

interface DirectorySnapshot {
  readonly stats: BigIntStats;
  readonly entries: readonly DirectoryEntrySnapshot[];
}

interface PendingAttempt {
  readonly absolutePath: string;
  readonly fileName: string;
  readonly sequence: number;
  readonly eventSha256: Sha256;
  readonly token: string;
  readonly stats: BigIntStats;
}

interface QuarantineInventory {
  readonly snapshot: DirectorySnapshot;
  readonly markerSequences: ReadonlySet<number>;
  readonly movedAttempts: readonly MovedQuarantineAttempt[];
}

interface MovedQuarantineAttempt {
  readonly absolutePath: string;
  readonly sequence: number;
  readonly eventSha256: Sha256;
  readonly token: string;
  readonly fileByteLength: number;
  readonly fileSha256: Sha256;
  readonly stats: BigIntStats;
}

function lexicalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function rawFileSha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function semanticSha256(domain: string, value: unknown): Sha256 {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function serializeCanonicalJson(value: unknown): Buffer {
  return Buffer.from(
    `${stableCanonicalJson(toCanonicalJson(value))}\n`,
    "utf8",
  );
}

function deepFreezeValue<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const member of Object.values(value)) {
    deepFreezeValue(member);
  }
  return Object.freeze(value);
}

function canonicalJsonValue(value: unknown, depth = 0): CanonicalJson {
  if (depth > 128)
    throw new Error("Canonical event payload nesting is too deep.");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Canonical event payload has a non-finite number.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value))
    return value.map((entry) => canonicalJsonValue(entry, depth + 1));
  if (typeof value !== "object")
    throw new Error("Event payload is outside canonical JSON.");
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Event payload objects must be plain records.");
  }
  const output: Record<string, CanonicalJson> = {};
  for (const key of Object.keys(value).sort(lexicalOrder)) {
    if (PROHIBITED_JSON_KEYS.has(key))
      throw new Error("Event payload has a prohibited key.");
    const member = (value as Record<string, unknown>)[key];
    if (member === undefined)
      throw new Error("Event payload has an undefined member.");
    output[key] = canonicalJsonValue(member, depth + 1);
  }
  return output;
}

function canonicalUtcInstant(value: string): string {
  const milliseconds = Date.parse(value);
  if (
    !UTC_MILLISECOND_PATTERN.test(value) ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new GrandHallT554NativeReviewJournalError(
      "ARGUMENT_INVALID",
      "Journal time must use canonical UTC millisecond form.",
    );
  }
  return value;
}

function normalizeScope(value: unknown): GrandHallT554NativeReviewJournalScope {
  try {
    return Object.freeze(
      GrandHallT554NativeReviewJournalScopeSchema.parse(value),
    );
  } catch (error) {
    throw new GrandHallT554NativeReviewJournalError(
      "ARGUMENT_INVALID",
      "Native-review journal scope is invalid.",
      error,
    );
  }
}

function scopesEqual(
  left: GrandHallT554NativeReviewJournalScope,
  right: GrandHallT554NativeReviewJournalScope,
): boolean {
  return (
    stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right))
  );
}

function resolvedAbsoluteRoot(input: string): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    !isAbsolute(input) ||
    input.includes("\0") ||
    input.normalize("NFC") !== input
  ) {
    throw new GrandHallT554NativeReviewJournalError(
      "ARGUMENT_INVALID",
      "Native-review journal workspace root must be one absolute NFC path.",
    );
  }
  return resolve(input);
}

async function directNode(
  absolutePath: string,
  kind: "file" | "directory",
  allowEmptyFile = false,
  allowMultipleFileLinks = false,
): Promise<NodeWitness> {
  const before = await lstat(absolutePath, { bigint: true });
  const canonical = await realpath(absolutePath);
  const after = await lstat(absolutePath, { bigint: true });
  const rightKind = kind === "file" ? before.isFile() : before.isDirectory();
  if (
    !rightKind ||
    before.isSymbolicLink() ||
    grandHallT554V3ComparablePath(canonical) !==
      grandHallT554V3ComparablePath(absolutePath) ||
    !grandHallT554V3SameFileState(before, after) ||
    (kind === "file" &&
      ((!allowMultipleFileLinks && before.nlink !== 1n) ||
        before.nlink < 1n ||
        (!allowEmptyFile && before.size < 1n)))
  ) {
    throw new Error(
      "Filesystem node is not one stable direct node of the required kind.",
    );
  }
  return { absolutePath, stats: after };
}

async function directInventoriedFileNode(
  absolutePath: string,
  allowEmptyFile = false,
  allowMultipleFileLinks = false,
): Promise<NodeWitness> {
  // This narrower witness is valid only for inventory snapshots and the
  // post-descriptor state check in readStableFile. Every file whose bytes are
  // consumed receives a full canonical directNode witness before open.
  const stats = await lstat(absolutePath, { bigint: true });
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    (!allowMultipleFileLinks && stats.nlink !== 1n) ||
    stats.nlink < 1n ||
    (!allowEmptyFile && stats.size < 1n)
  ) {
    throw new Error(
      "Inventoried journal child is not one direct file of the required kind.",
    );
  }
  return { absolutePath, stats };
}

function assertSameNode(
  actual: NodeWitness,
  expected: NodeWitness,
  label: string,
): void {
  if (
    grandHallT554V3ComparablePath(actual.absolutePath) !==
      grandHallT554V3ComparablePath(expected.absolutePath) ||
    !grandHallT554V3SameNode(actual.stats, expected.stats)
  ) {
    throw new Error(`${label} identity changed.`);
  }
}

function assertSafeUniqueNames(names: readonly string[], label: string): void {
  const folded = new Set<string>();
  for (const name of names) {
    if (!isSafeGrandHallT554RelativePath(name) || name.includes("/")) {
      throw new Error(`${label} contains an unsafe name.`);
    }
    const key = name.normalize("NFC").toLowerCase();
    if (folded.has(key))
      throw new Error(`${label} contains case-colliding names.`);
    folded.add(key);
  }
}

async function snapshotDirectory(
  directory: NodeWitness,
  options: {
    readonly allowEmptyFiles?: boolean;
    readonly allowMultipleFileLinks?: boolean;
  } = {},
): Promise<DirectorySnapshot> {
  const initial = await directNode(directory.absolutePath, "directory");
  assertSameNode(initial, directory, "Journal directory");
  const dirents = await readdir(directory.absolutePath, {
    withFileTypes: true,
  });
  const names = dirents.map((entry) => entry.name);
  assertSafeUniqueNames(names, "Journal inventory");
  const entries = await mapWithBoundedConcurrency(
    dirents,
    MAXIMUM_PARALLEL_INVENTORY_ENTRY_CHECKS,
    async (dirent) => {
      if (!dirent.isFile() || dirent.isSymbolicLink()) {
        throw new Error(
          "Journal inventory contains an extra directory or link.",
        );
      }
       const node = await directInventoriedFileNode(
         join(directory.absolutePath, dirent.name),
         options.allowEmptyFiles ?? true,
         options.allowMultipleFileLinks ?? false,
      );
      return { name: dirent.name, stats: node.stats };
    },
  );
  const final = await directNode(directory.absolutePath, "directory");
  assertSameNode(final, directory, "Journal directory");
  if (!grandHallT554V3SameFileState(initial.stats, final.stats)) {
    throw new Error("Journal directory changed during its inventory snapshot.");
  }
  return {
    stats: final.stats,
    entries: [...entries].sort((a, b) => lexicalOrder(a.name, b.name)),
  };
}

function snapshotsEqual(
  left: DirectorySnapshot,
  right: DirectorySnapshot,
): boolean {
  return (
    grandHallT554V3SameFileState(left.stats, right.stats) &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const candidate = right.entries[index];
      return (
        candidate !== undefined &&
        entry.name === candidate.name &&
        grandHallT554V3SameFileState(entry.stats, candidate.stats)
      );
    })
  );
}

async function readExactly(
  handle: FileHandle,
  byteLength: number,
): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (bytesRead < 1)
      throw new Error("Journal file was truncated during its bounded read.");
    offset += bytesRead;
  }
  const trailing = Buffer.allocUnsafe(1);
  const probe = await handle.read(trailing, 0, 1, byteLength);
  if (probe.bytesRead !== 0)
    throw new Error("Journal file grew beyond its bounded read.");
  return bytes;
}

async function readStableFile(
  absolutePath: string,
  expectedStats: BigIntStats,
  maximumBytes: number,
  allowEmptyFile = false,
  allowMultipleFileLinks = false,
): Promise<Buffer> {
  const before = await directNode(
    absolutePath,
    "file",
    allowEmptyFile,
    allowMultipleFileLinks,
  );
  if (
    !grandHallT554V3SameFileState(before.stats, expectedStats) ||
    before.stats.size > BigInt(maximumBytes)
  )
    throw new Error("Journal file snapshot binding failed.");
  const handle = await open(absolutePath, "r");
  try {
    const descriptorBefore = await handle.stat({ bigint: true });
    if (!grandHallT554V3SameFileState(before.stats, descriptorBefore)) {
      throw new Error(
        "Journal descriptor does not match its inventoried path.",
      );
    }
    const bytes = await readExactly(handle, Number(descriptorBefore.size));
    const descriptorAfter = await handle.stat({ bigint: true });
    const after = await directInventoriedFileNode(
      absolutePath,
      allowEmptyFile,
      allowMultipleFileLinks,
    );
    if (
      !grandHallT554V3SameFileState(descriptorBefore, descriptorAfter) ||
      !grandHallT554V3SameFileState(descriptorAfter, after.stats)
    ) {
      throw new Error("Journal file changed during its descriptor-bound read.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseCanonicalDocument(bytes: Buffer, label: string): unknown {
  const parsed = parseGrandHallT554StrictJson(bytes);
  if (!bytes.equals(serializeCanonicalJson(parsed))) {
    throw new Error(
      `${label} is not encoded as exact canonical JSON plus one LF.`,
    );
  }
  return parsed;
}

function buildScopeDocument(scope: GrandHallT554NativeReviewJournalScope): {
  readonly bytes: Buffer;
  readonly scopeSha256: Sha256;
} {
  const material = ScopeFileMaterialSchema.parse({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_SCHEMA,
    scope,
  });
  const scopeSha256 = semanticSha256(
    GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_DOMAIN,
    material,
  );
  return {
    bytes: serializeCanonicalJson({ ...material, scopeSha256 }),
    scopeSha256,
  };
}

function parseScopeDocument(bytes: Buffer): {
  readonly scope: GrandHallT554NativeReviewJournalScope;
  readonly scopeSha256: Sha256;
} {
  const parsed = ScopeFileSchema.parse(
    parseCanonicalDocument(bytes, "Journal scope"),
  );
  const { scopeSha256, ...material } = parsed;
  const expected = semanticSha256(
    GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_DOMAIN,
    material,
  );
  if (scopeSha256 !== expected)
    throw new Error("Journal scope digest drifted.");
  return { scope: Object.freeze(parsed.scope), scopeSha256 };
}

async function inspectRootInventory(root: NodeWitness): Promise<{
  readonly root: NodeWitness;
  readonly entries: ReadonlyMap<string, NodeWitness>;
}> {
  const before = await directNode(root.absolutePath, "directory");
  assertSameNode(before, root, "Journal workspace root");
  const dirents = await readdir(root.absolutePath, { withFileTypes: true });
  const names = dirents.map((entry) => entry.name).sort(lexicalOrder);
  assertSafeUniqueNames(names, "Journal root inventory");
  if (names.join("\n") !== ROOT_INVENTORY.join("\n")) {
    throw new Error("Journal root does not contain the exact fixed inventory.");
  }
  const entries = new Map<string, NodeWitness>();
  for (const dirent of dirents) {
    const expectedKind = dirent.name === SCOPE_FILE_NAME ? "file" : "directory";
    if (
      (expectedKind === "file" && !dirent.isFile()) ||
      (expectedKind === "directory" && !dirent.isDirectory()) ||
      dirent.isSymbolicLink()
    ) {
      throw new Error("Journal root inventory kind drifted.");
    }
    entries.set(
      dirent.name,
      await directNode(join(root.absolutePath, dirent.name), expectedKind),
    );
  }
  const after = await directNode(root.absolutePath, "directory");
  assertSameNode(after, root, "Journal workspace root");
  if (!grandHallT554V3SameFileState(before.stats, after.stats)) {
    throw new Error("Journal root changed during its inventory snapshot.");
  }
  return { root: after, entries };
}

async function loadLayout(
  workspaceRoot: string,
  expectedScope: GrandHallT554NativeReviewJournalScope,
  prior?: JournalLayout,
): Promise<JournalLayout> {
  try {
    const root = await directNode(workspaceRoot, "directory");
    if (prior !== undefined)
      assertSameNode(root, prior.root, "Journal workspace root");
    const inventory = await inspectRootInventory(root);
    const claims = inventory.entries.get(CLAIMS_DIRECTORY_NAME);
    const events = inventory.entries.get(EVENTS_DIRECTORY_NAME);
    const pending = inventory.entries.get(PENDING_DIRECTORY_NAME);
    const quarantine = inventory.entries.get(QUARANTINE_DIRECTORY_NAME);
    const scopeFile = inventory.entries.get(SCOPE_FILE_NAME);
    if (
      claims === undefined ||
      events === undefined ||
      pending === undefined ||
      quarantine === undefined ||
      scopeFile === undefined
    ) {
      throw new Error("Journal fixed inventory is incomplete.");
    }
    if (prior !== undefined) {
      assertSameNode(claims, prior.claims, "Journal claims directory");
      assertSameNode(events, prior.events, "Journal events directory");
      assertSameNode(pending, prior.pending, "Journal pending directory");
      assertSameNode(
        quarantine,
        prior.quarantine,
        "Journal quarantine directory",
      );
      assertSameNode(scopeFile, prior.scopeFile, "Journal scope file");
    }
    const scopeBytes = await readStableFile(
      scopeFile.absolutePath,
      scopeFile.stats,
      MAX_SCOPE_BYTES,
    );
    const parsed = parseScopeDocument(scopeBytes);
    if (!scopesEqual(parsed.scope, expectedScope))
      throw new Error("Journal scope is not the expected scope.");
    const scopeFileSha256 = rawFileSha256(scopeBytes);
    const genesisSha256 = semanticSha256(
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_GENESIS_DOMAIN,
      {
        scopeSha256: parsed.scopeSha256,
        scopeFileSha256,
      },
    );
    return {
      root: inventory.root,
      claims,
      events,
      pending,
      quarantine,
      scopeFile,
      scope: parsed.scope,
      scopeSha256: parsed.scopeSha256,
      scopeFileSha256,
      genesisSha256,
    };
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewJournalError) throw error;
    throw new GrandHallT554NativeReviewJournalError(
      "WORKSPACE_UNSAFE",
      "Native-review journal workspace layout or scope is unsafe.",
      error,
    );
  }
}

function eventFileName(sequence: number, eventSha256: Sha256): string {
  return `${String(sequence).padStart(EVENT_SEQUENCE_WIDTH, "0")}-${eventSha256.replace(":", "-")}.json`;
}

function claimFileName(sequence: number): string {
  return `${String(sequence).padStart(EVENT_SEQUENCE_WIDTH, "0")}.json`;
}

function pendingFileName(
  sequence: number,
  eventSha256: Sha256,
  token: string,
): string {
  return `pending-${String(sequence).padStart(EVENT_SEQUENCE_WIDTH, "0")}-${eventSha256.replace(":", "-")}-${token}.json`;
}

function parseSequence(value: string | undefined, label: string): number {
  const sequence = Number(value);
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_SEQUENCE
  ) {
    throw new Error(`${label} sequence is invalid.`);
  }
  return sequence;
}

function parseClaimFileName(name: string): number {
  const match = CLAIM_FILE_PATTERN.exec(name);
  const sequence = parseSequence(match?.[1], "Journal claim");
  if (match === null || claimFileName(sequence) !== name) {
    throw new Error("Journal claim filename is not canonical.");
  }
  return sequence;
}

function parsePendingFileName(name: string): {
  readonly sequence: number;
  readonly eventSha256: Sha256;
  readonly token: string;
} {
  const match = PENDING_FILE_PATTERN.exec(name);
  if (match === null) {
    throw new Error("Journal pending inventory contains an unsafe file.");
  }
  const sequence = parseSequence(match[1], "Journal pending attempt");
  const eventSha256 = Sha256Schema.parse(`sha256:${match[2] ?? ""}`);
  const token = match[3] ?? "";
  if (pendingFileName(sequence, eventSha256, token) !== name) {
    throw new Error("Journal pending filename is not canonical.");
  }
  return { sequence, eventSha256, token };
}

function parseEventFileName(name: string): {
  readonly sequence: number;
  readonly sha256: Sha256;
} {
  const match = EVENT_FILE_PATTERN.exec(name);
  if (match === null)
    throw new Error(
      "Journal event inventory contains an extra or unsafe file.",
    );
  const sequence = Number(match[1]);
  const sha256 = Sha256Schema.parse(`sha256:${match[2] ?? ""}`);
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_SEQUENCE ||
    eventFileName(sequence, sha256) !== name
  )
    throw new Error("Journal event filename is not canonical.");
  return { sequence, sha256 };
}

function parsePersistedEvent(
  bytes: Buffer,
  fileName: string,
  layout: JournalLayout,
): GrandHallT554NativeReviewJournalEvent {
  const parsed = PersistedEventSchema.parse(
    parseCanonicalDocument(bytes, `Journal event ${fileName}`),
  );
  const payload = canonicalJsonValue(parsed.payload);
  canonicalUtcInstant(parsed.recordedAtUtc);
  if (
    !scopesEqual(parsed.scope, layout.scope) ||
    parsed.scopeSha256 !== layout.scopeSha256 ||
    parsed.scopeFileSha256 !== layout.scopeFileSha256
  )
    throw new Error("Journal event scope drifted.");
  const { eventSha256, ...materialInput } = parsed;
  const material = { ...materialInput, scope: layout.scope, payload };
  const expected = semanticSha256(
    GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
    material,
  );
  if (
    eventSha256 !== expected ||
    eventFileName(parsed.sequence, eventSha256) !== fileName
  ) {
    throw new Error("Journal event digest or filename drifted.");
  }
  return {
    ...material,
    eventSha256,
    fileName,
    fileSha256: rawFileSha256(bytes),
    fileByteLength: bytes.length,
  };
}

function validateEventChainEntry(
  event: GrandHallT554NativeReviewJournalEvent,
  expectedSequence: number,
  expectedPrevious: Sha256,
  previousTimestamp: number,
): number {
  if (
    event.sequence !== expectedSequence ||
    event.previousEventSha256 !== expectedPrevious
  ) {
    throw new Error("Journal hash chain is broken.");
  }
  const timestamp = Date.parse(event.recordedAtUtc);
  if (timestamp < previousTimestamp) {
    throw new Error("Journal wall clock rolled backward.");
  }
  return timestamp;
}

function assertInventoryBounds(
  snapshot: DirectorySnapshot,
  limits: JournalLimits,
  label: string,
): void {
  if (snapshot.entries.length > limits.maximumEventCount) {
    throw new Error(`${label} inventory exceeds its fixed count bound.`);
  }
  const inventoryBytes = snapshot.entries.reduce(
    (total, entry) => total + entry.stats.size,
    0n,
  );
  if (inventoryBytes > BigInt(limits.maximumTotalEventBytes)) {
    throw new Error(`${label} inventory exceeds its fixed cumulative byte bound.`);
  }
}

async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  maximumConcurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let stopScheduling = false;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopScheduling) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) {
        throw new Error("Bounded journal read lost an inventory entry.");
      }
      try {
        results[index] = await operation(item, index);
      } catch (error) {
        stopScheduling = true;
        throw error;
      }
    }
  };
  const workerCount = Math.min(maximumConcurrency, items.length);
  const outcomes = await Promise.allSettled(
    Array.from({ length: workerCount }, async () => {
      await worker();
    }),
  );
  for (const outcome of outcomes) settledValue(outcome);
  return results;
}

function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

async function readClaims(
  layout: JournalLayout,
  snapshot: DirectorySnapshot,
  limits: JournalLimits,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<readonly GrandHallT554NativeReviewJournalEvent[]> {
  assertInventoryBounds(snapshot, limits, "Journal claim");
  const events = await mapWithBoundedConcurrency(
    snapshot.entries,
    MAXIMUM_PARALLEL_EVENT_READS,
    async (entry, index) => {
      const expectedSequence = index + 1;
      if (parseClaimFileName(entry.name) !== expectedSequence) {
        throw new Error("Journal claim sequence has a gap or duplicate.");
      }
      const absolutePath = join(layout.claims.absolutePath, entry.name);
      const context = {
        kind: "claim" as const,
        absolutePath,
        sequence: expectedSequence,
      };
      try {
        await seams.beforeCommittedContentRead?.(context);
        const bytes = await readStableFile(
          absolutePath,
          entry.stats,
          GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_BYTES,
          false,
          true,
        );
        const parsed = PersistedEventSchema.parse(
          parseCanonicalDocument(bytes, `Journal claim ${entry.name}`),
        );
        return parsePersistedEvent(
          bytes,
          eventFileName(parsed.sequence, parsed.eventSha256),
          layout,
        );
      } finally {
        await seams.afterCommittedContentRead?.(context);
      }
    },
  );
  let previous = layout.genesisSha256;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, event] of events.entries()) {
    const expectedSequence = index + 1;
    previousTimestamp = validateEventChainEntry(
      event,
      expectedSequence,
      previous,
      previousTimestamp,
    );
    previous = event.eventSha256;
  }
  return events;
}

async function readEvents(
  layout: JournalLayout,
  snapshot: DirectorySnapshot,
  limits: JournalLimits,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<readonly GrandHallT554NativeReviewJournalEvent[]> {
  assertInventoryBounds(snapshot, limits, "Journal event");
  const events = await mapWithBoundedConcurrency(
    snapshot.entries,
    MAXIMUM_PARALLEL_EVENT_READS,
    async (entry, index) => {
      const identity = parseEventFileName(entry.name);
      const expectedSequence = index + 1;
      if (identity.sequence !== expectedSequence) {
        throw new Error("Journal sequence has a gap or duplicate.");
      }
      const absolutePath = join(layout.events.absolutePath, entry.name);
      const context = {
        kind: "event" as const,
        absolutePath,
        sequence: expectedSequence,
      };
      try {
        await seams.beforeCommittedContentRead?.(context);
        const bytes = await readStableFile(
          absolutePath,
          entry.stats,
          GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_BYTES,
          false,
          true,
        );
        const event = parsePersistedEvent(bytes, entry.name, layout);
        if (event.eventSha256 !== identity.sha256) {
          throw new Error("Journal hash chain is broken.");
        }
        return event;
      } finally {
        await seams.afterCommittedContentRead?.(context);
      }
    },
  );
  let previous = layout.genesisSha256;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, event] of events.entries()) {
    const expectedSequence = index + 1;
    previousTimestamp = validateEventChainEntry(
      event,
      expectedSequence,
      previous,
      previousTimestamp,
    );
    previous = event.eventSha256;
  }
  return events;
}

type QuarantineEntryIdentity =
  | {
      readonly disposition: "moved";
      readonly sequence: number;
      readonly eventSha256: Sha256;
      readonly token: string;
      readonly fileByteLength: number;
      readonly fileSha256: Sha256;
    }
  | {
      readonly disposition: "marker";
      readonly sequence: number;
      readonly eventSha256: Sha256;
      readonly token: string;
    };

function parseQuarantineSequence(value: string | undefined): number {
  const sequence = Number(value);
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_SEQUENCE
  ) {
    throw new Error("Journal quarantine sequence is invalid.");
  }
  return sequence;
}

function parseQuarantineName(name: string): QuarantineEntryIdentity {
  const moved = MOVED_QUARANTINE_FILE_PATTERN.exec(name);
  if (moved !== null) {
    const sequence = parseQuarantineSequence(moved[1]);
    const eventSha256 = Sha256Schema.parse(`sha256:${moved[2] ?? ""}`);
    const fileByteLength = Number(moved[3]);
    const fileSha256 = Sha256Schema.parse(`sha256:${moved[4] ?? ""}`);
    const token = moved[5] ?? "";
    if (
      !Number.isSafeInteger(fileByteLength) ||
      fileByteLength < 0 ||
      fileByteLength > MAX_QUARANTINE_BYTES ||
      movedQuarantineFileName(
        sequence,
        eventSha256,
        token,
        fileByteLength,
        fileSha256,
      ) !== name
    ) {
      throw new Error("Journal moved-quarantine filename is not canonical.");
    }
    return {
      disposition: "moved",
      sequence,
      eventSha256,
      token,
      fileByteLength,
      fileSha256,
    };
  }
  const marker = MARKER_QUARANTINE_FILE_PATTERN.exec(name);
  if (marker === null) {
    throw new Error("Journal quarantine contains an extra or unsafe entry.");
  }
  const sequence = parseQuarantineSequence(marker[1]);
  const eventSha256 = Sha256Schema.parse(`sha256:${marker[2] ?? ""}`);
  const token = marker[3] ?? "";
  if (markerQuarantineFileName(sequence, eventSha256, token) !== name) {
    throw new Error("Journal quarantine-marker filename is not canonical.");
  }
  return { disposition: "marker", sequence, eventSha256, token };
}

async function inspectQuarantine(
  layout: JournalLayout,
  snapshot: DirectorySnapshot,
  limits: JournalLimits,
): Promise<QuarantineInventory> {
  if (snapshot.entries.length > limits.maximumQuarantineEntryCount) {
    throw new Error("Journal quarantine exceeds its fixed count bound.");
  }
  const totalBytes = snapshot.entries.reduce(
    (total, entry) => total + entry.stats.size,
    0n,
  );
  if (totalBytes > BigInt(limits.maximumQuarantineTotalBytes)) {
    throw new Error("Journal quarantine exceeds its fixed cumulative byte bound.");
  }
  const markerSequences = new Set<number>();
  const movedAttempts: MovedQuarantineAttempt[] = [];
  for (const entry of snapshot.entries) {
    const identity = parseQuarantineName(entry.name);
    if (entry.stats.size > BigInt(MAX_QUARANTINE_BYTES)) {
      throw new Error("Journal quarantine entry is over its byte bound.");
    }
    const bytes = await readStableFile(
      join(layout.quarantine.absolutePath, entry.name),
      entry.stats,
      identity.disposition === "marker" ? MAX_SCOPE_BYTES : MAX_QUARANTINE_BYTES,
      identity.disposition === "moved",
    );
    if (identity.disposition === "moved") {
      if (
        entry.stats.size !== BigInt(identity.fileByteLength) ||
        rawFileSha256(bytes) !== identity.fileSha256
      ) {
        throw new Error("Journal moved-quarantine byte receipt drifted.");
      }
      movedAttempts.push({
        absolutePath: join(layout.quarantine.absolutePath, entry.name),
        sequence: identity.sequence,
        eventSha256: identity.eventSha256,
        token: identity.token,
        fileByteLength: identity.fileByteLength,
        fileSha256: identity.fileSha256,
        stats: entry.stats,
      });
      continue;
    }
    const marker = QuarantineMarkerSchema.parse(
      parseCanonicalDocument(bytes, `Journal quarantine marker ${entry.name}`),
    );
    if (
      marker.scopeSha256 !== layout.scopeSha256 ||
      marker.sequence !== identity.sequence ||
      marker.attemptedEventSha256 !== identity.eventSha256 ||
      eventFileName(marker.sequence, marker.attemptedEventSha256) !==
        marker.attemptedEventFileName
    )
      throw new Error("Journal quarantine marker drifted.");
    markerSequences.add(marker.sequence);
  }
  return { snapshot, markerSequences, movedAttempts };
}

function assertPendingBounds(snapshot: DirectorySnapshot): void {
  if (snapshot.entries.length > MAX_PENDING_ENTRY_COUNT) {
    throw new Error("Journal pending inventory exceeds its fixed count bound.");
  }
  const totalBytes = snapshot.entries.reduce(
    (total, entry) => total + entry.stats.size,
    0n,
  );
  if (totalBytes > BigInt(MAX_QUARANTINE_TOTAL_BYTES)) {
    throw new Error("Journal pending inventory exceeds its fixed byte bound.");
  }
}

function pendingAttemptFromEntry(
  layout: JournalLayout,
  entry: DirectoryEntrySnapshot,
): PendingAttempt {
  const identity = parsePendingFileName(entry.name);
  return {
    absolutePath: join(layout.pending.absolutePath, entry.name),
    fileName: eventFileName(identity.sequence, identity.eventSha256),
    sequence: identity.sequence,
    eventSha256: identity.eventSha256,
    token: identity.token,
    stats: entry.stats,
  };
}

async function directNodeIfPresent(
  absolutePath: string,
  allowEmptyFile: boolean,
  allowMultipleFileLinks: boolean,
): Promise<NodeWitness | undefined> {
  try {
    return await directNode(
      absolutePath,
      "file",
      allowEmptyFile,
      allowMultipleFileLinks,
    );
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function publishHardLinkNoReplace(
  sourcePath: string,
  destinationPath: string,
  expectedNode: BigIntStats,
): Promise<void> {
  try {
    await link(sourcePath, destinationPath);
  } catch (error) {
    if (errnoCode(error) !== "EEXIST") throw error;
  }
  const destination = await directNode(destinationPath, "file", false, true);
  if (!grandHallT554V3SameNode(destination.stats, expectedNode)) {
    throw new Error("No-replace publication collided with another filesystem node.");
  }
}

async function unlinkExactNode(
  absolutePath: string,
  expectedNode: BigIntStats,
): Promise<boolean> {
  const current = await directNodeIfPresent(absolutePath, true, true);
  if (current === undefined) return false;
  if (!grandHallT554V3SameNode(current.stats, expectedNode)) {
    throw new Error("Journal cleanup path was replaced before unlink.");
  }
  try {
    await unlink(absolutePath);
  } catch (error) {
    // Another owner-governed recovery may have completed the same idempotent
    // cleanup after our identity check. A missing path is not permission to
    // delete or rewrite anything else.
    if (errnoCode(error) === "ENOENT") return false;
    throw error;
  }
  const residual = await directNodeIfPresent(absolutePath, true, true);
  if (residual !== undefined) {
    throw new Error("Journal cleanup path was recreated during unlink.");
  }
  return true;
}

async function assertQuarantineCanAccept(
  layout: JournalLayout,
  prospectiveByteLength: number,
  limits: JournalLimits,
): Promise<void> {
  if (
    !Number.isSafeInteger(prospectiveByteLength) ||
    prospectiveByteLength < 0 ||
    prospectiveByteLength > MAX_QUARANTINE_BYTES
  ) {
    throw new GrandHallT554NativeReviewJournalError(
      "JOURNAL_LIMIT_REACHED",
      "Native-review journal quarantine reservation has an invalid byte length.",
    );
  }
  const snapshot = await snapshotDirectory(layout.quarantine);
  const inventory = await inspectQuarantine(layout, snapshot, limits);
  if (inventory.markerSequences.size > 0) {
    throw new Error(
      "Journal cannot reserve quarantine capacity while an ambiguity marker is unresolved.",
    );
  }
  const currentBytes = snapshot.entries.reduce(
    (total, entry) => total + entry.stats.size,
    0n,
  );
  if (
    snapshot.entries.length + 1 > limits.maximumQuarantineEntryCount ||
    currentBytes + BigInt(prospectiveByteLength) >
      BigInt(limits.maximumQuarantineTotalBytes)
  ) {
    throw new GrandHallT554NativeReviewJournalError(
      "JOURNAL_LIMIT_REACHED",
      "Native-review journal lacks reserved quarantine capacity for another append attempt.",
    );
  }
}

async function completedMovedAttempt(
  attempt: PendingAttempt,
  layout: JournalLayout,
  limits: JournalLimits,
): Promise<MovedQuarantineAttempt> {
  const snapshot = await snapshotDirectory(layout.quarantine);
  const inventory = await inspectQuarantine(layout, snapshot, limits);
  const matches = inventory.movedAttempts.filter(
    (entry) =>
      entry.sequence === attempt.sequence &&
      entry.eventSha256 === attempt.eventSha256 &&
      entry.token === attempt.token,
  );
  const moved = matches[0];
  if (
    matches.length !== 1 ||
    moved === undefined ||
    !grandHallT554V3SameNode(moved.stats, attempt.stats) ||
    moved.stats.nlink !== 1n
  ) {
    throw new Error(
      "Pending attempt disappeared without one exact completed quarantine receipt.",
    );
  }
  return moved;
}

async function verifyMovedQuarantinePath(
  absolutePath: string,
  expectedNode: BigIntStats,
  expectedByteLength: number,
  expectedFileSha256: Sha256,
  expectedLinkCount: bigint,
): Promise<NodeWitness> {
  const moved = await directNode(absolutePath, "file", true, true);
  if (
    !grandHallT554V3SameNode(moved.stats, expectedNode) ||
    moved.stats.nlink !== expectedLinkCount ||
    moved.stats.size !== BigInt(expectedByteLength)
  ) {
    throw new Error("Quarantined pending attempt identity or link state drifted.");
  }
  const bytes = await readStableFile(
    absolutePath,
    moved.stats,
    MAX_QUARANTINE_BYTES,
    true,
    true,
  );
  if (
    bytes.length !== expectedByteLength ||
    rawFileSha256(bytes) !== expectedFileSha256
  ) {
    throw new Error("Quarantined pending attempt byte receipt drifted.");
  }
  return moved;
}

async function synchronizeCompletedMovedAttempt(
  attempt: PendingAttempt,
  layout: JournalLayout,
  limits: JournalLimits,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<void> {
  await completedMovedAttempt(attempt, layout, limits);
  await syncDirectory(
    layout.quarantine.absolutePath,
    "quarantine-destination-recovery",
    seams,
  );
  await syncDirectory(
    layout.pending.absolutePath,
    "quarantine-source-recovery",
    seams,
  );
}

async function quarantinePendingAttemptOnce(
  attempt: PendingAttempt,
  layout: JournalLayout,
  limits: JournalLimits,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<void> {
  const source = await directNodeIfPresent(attempt.absolutePath, true, true);
  if (source === undefined) {
    await synchronizeCompletedMovedAttempt(attempt, layout, limits, seams);
    return;
  }
  if (!grandHallT554V3SameNode(source.stats, attempt.stats)) {
    throw new Error("Uncommitted pending attempt has an unsafe link state.");
  }
  const sourceBytes = await readStableFile(
    attempt.absolutePath,
    source.stats,
    MAX_QUARANTINE_BYTES,
    true,
    true,
  );
  const sourceFileSha256 = rawFileSha256(sourceBytes);
  const destinationName = movedQuarantineFileName(
    attempt.sequence,
    attempt.eventSha256,
    attempt.token,
    sourceBytes.length,
    sourceFileSha256,
  );
  const destinationPath = join(layout.quarantine.absolutePath, destinationName);
  const existingDestination = await directNodeIfPresent(
    destinationPath,
    true,
    true,
  );
  if (existingDestination === undefined) {
    if (source.stats.nlink !== 1n) {
      throw new Error(
        "Uncommitted pending attempt has an unexplained hard-link alias.",
      );
    }
    await assertQuarantineCanAccept(layout, sourceBytes.length, limits);
    await publishHardLinkNoReplace(
      attempt.absolutePath,
      destinationPath,
      attempt.stats,
    );
  } else if (
    !grandHallT554V3SameNode(existingDestination.stats, attempt.stats)
  ) {
    throw new Error(
      "Pending attempt quarantine destination belongs to another filesystem node.",
    );
  }
  const linkedSource = await directNode(attempt.absolutePath, "file", true, true);
  const linkedDestination = await verifyMovedQuarantinePath(
    destinationPath,
    attempt.stats,
    sourceBytes.length,
    sourceFileSha256,
    2n,
  );
  if (
    linkedSource.stats.nlink !== 2n ||
    !grandHallT554V3SameFileState(
      linkedSource.stats,
      linkedDestination.stats,
    )
  ) {
    throw new Error(
      "Pending and quarantine names are not one exact two-link crash residue.",
    );
  }
  await syncDirectory(
    layout.quarantine.absolutePath,
    "quarantine-destination",
    seams,
  );
  await unlinkExactNode(attempt.absolutePath, attempt.stats);
  await syncDirectory(layout.pending.absolutePath, "quarantine-source", seams);
  await verifyMovedQuarantinePath(
    destinationPath,
    attempt.stats,
    sourceBytes.length,
    sourceFileSha256,
    1n,
  );
}

async function quarantinePendingAttempt(
  attempt: PendingAttempt,
  layout: JournalLayout,
  limits: JournalLimits,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<void> {
  let lastFailure: unknown = new Error(
    "Pending attempt quarantine reconciliation did not start.",
  );
  for (
    let reconciliationAttempt = 0;
    reconciliationAttempt < MAXIMUM_QUARANTINE_RECONCILIATION_ATTEMPTS;
    reconciliationAttempt += 1
  ) {
    try {
      await quarantinePendingAttemptOnce(attempt, layout, limits, seams);
      return;
    } catch (error) {
      lastFailure = error;
    }

    const source = await directNodeIfPresent(
      attempt.absolutePath,
      true,
      true,
    );
    if (source === undefined) {
      try {
        await synchronizeCompletedMovedAttempt(
          attempt,
          layout,
          limits,
          seams,
        );
        return;
      } catch (error) {
        // A concurrent, owner-governed recovery may still be between its
        // no-replace quarantine link and exact pending-name cleanup. Retry
        // only this same inode/token receipt; never select another path.
        lastFailure = error;
      }
    } else if (!grandHallT554V3SameNode(source.stats, attempt.stats)) {
      throw new Error(
        "Pending attempt path was replaced during quarantine reconciliation.",
        { cause: lastFailure },
      );
    }

    if (
      reconciliationAttempt + 1 <
      MAXIMUM_QUARANTINE_RECONCILIATION_ATTEMPTS
    ) {
      await new Promise<void>((resolveRetry) => {
        setTimeout(resolveRetry, 1);
      });
    }
  }
  if (lastFailure instanceof Error) throw lastFailure;
  throw new Error("Pending attempt quarantine reconciliation failed.", {
    cause: lastFailure,
  });
}

function assertMirroredCommittedPrefix(
  claimsSnapshot: DirectorySnapshot,
  eventsSnapshot: DirectorySnapshot,
  events: readonly GrandHallT554NativeReviewJournalEvent[],
): void {
  if (
    claimsSnapshot.entries.length !== eventsSnapshot.entries.length ||
    claimsSnapshot.entries.length !== events.length
  ) {
    throw new Error("Journal claim and event prefixes differ in length.");
  }
  for (const [index, event] of events.entries()) {
    const claimEntry = claimsSnapshot.entries[index];
    const eventEntry = eventsSnapshot.entries[index];
    const expectedSequence = index + 1;
    if (
      claimEntry === undefined ||
      eventEntry === undefined ||
      parseClaimFileName(claimEntry.name) !== expectedSequence ||
      event.sequence !== expectedSequence ||
      eventEntry.name !== event.fileName ||
      claimEntry.stats.nlink !== 2n ||
      eventEntry.stats.nlink !== 2n ||
      !grandHallT554V3SameNode(claimEntry.stats, eventEntry.stats) ||
      !grandHallT554V3SameFileState(claimEntry.stats, eventEntry.stats)
    ) {
      throw new Error("Journal claim and event files are not one exact hard-linked prefix.");
    }
  }
}

async function recoverPublicationResidues(
  layout: JournalLayout,
  limits: JournalLimits,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<void> {
  const pendingSnapshot = await snapshotDirectory(layout.pending, {
    allowEmptyFiles: true,
    allowMultipleFileLinks: true,
  });
  assertPendingBounds(pendingSnapshot);
  if (pendingSnapshot.entries.length === 0) return;
  const claimsSnapshot = await snapshotDirectory(layout.claims, {
    allowMultipleFileLinks: true,
  });
  const eventsSnapshot = await snapshotDirectory(layout.events, {
    allowMultipleFileLinks: true,
  });
  const claims = await readClaims(layout, claimsSnapshot, limits, seams);
  const events = await readEvents(layout, eventsSnapshot, limits, seams);
  if (events.length > claims.length) {
    throw new Error("Journal exposes an event without its durable claim.");
  }
  if (claims.length - events.length > 1) {
    throw new Error(
      "Journal has more than one unpublished claim, a state no valid writer can produce.",
    );
  }

  for (const [index, event] of events.entries()) {
    const claim = claims[index];
    const claimEntry = claimsSnapshot.entries[index];
    const eventEntry = eventsSnapshot.entries[index];
    if (
      claim === undefined ||
      claimEntry === undefined ||
      eventEntry === undefined ||
      claim.eventSha256 !== event.eventSha256 ||
      !grandHallT554V3SameNode(claimEntry.stats, eventEntry.stats)
    ) {
      throw new Error("Published event does not match its durable claim.");
    }
  }

  const committedPending = new Map<number, PendingAttempt[]>();
  const uncommittedPending: PendingAttempt[] = [];
  for (const entry of pendingSnapshot.entries) {
    const attempt = pendingAttemptFromEntry(layout, entry);
    const claimEntry = claimsSnapshot.entries[attempt.sequence - 1];
    if (
      claimEntry !== undefined &&
      parseClaimFileName(claimEntry.name) === attempt.sequence &&
      grandHallT554V3SameNode(claimEntry.stats, attempt.stats)
    ) {
      const claim = claims[attempt.sequence - 1];
      if (claim?.eventSha256 !== attempt.eventSha256) {
        throw new Error("Committed pending attempt filename drifted from its claim.");
      }
      const matches = committedPending.get(attempt.sequence) ?? [];
      matches.push(attempt);
      committedPending.set(attempt.sequence, matches);
    } else {
      uncommittedPending.push(attempt);
    }
  }

  let publishedEvent = false;
  for (const [index, claim] of claims.entries()) {
    const claimEntry = claimsSnapshot.entries[index];
    if (claimEntry === undefined) throw new Error("Journal claim snapshot is incomplete.");
    const matchingPending = committedPending.get(claim.sequence) ?? [];
    if (matchingPending.length > 1) {
      throw new Error("Journal claim has multiple pending publication links.");
    }
    const eventEntry = eventsSnapshot.entries[index];
    const expectedLinkCount = 1n +
      (eventEntry === undefined ? 0n : 1n) +
      BigInt(matchingPending.length);
    if (claimEntry.stats.nlink !== expectedLinkCount) {
      throw new Error("Journal claim has an unexplained hard-link count.");
    }
    if (eventEntry === undefined) {
      if (matchingPending.length !== 1) {
        throw new Error("Unpublished claim lacks its exact pending crash witness.");
      }
      await publishHardLinkNoReplace(
        join(layout.claims.absolutePath, claimFileName(claim.sequence)),
        join(layout.events.absolutePath, claim.fileName),
        claimEntry.stats,
      );
      publishedEvent = true;
    }
  }
  if (publishedEvent) {
    await syncDirectory(layout.events.absolutePath, "event-recovery", seams);
  }

  let observedCommittedPending = false;
  for (const attempts of committedPending.values()) {
    const attempt = attempts[0];
    if (attempt !== undefined) {
      observedCommittedPending = true;
      await unlinkExactNode(attempt.absolutePath, attempt.stats);
    }
  }
  if (observedCommittedPending) {
    await syncDirectory(layout.pending.absolutePath, "pending-recovery", seams);
  }
  for (const attempt of uncommittedPending) {
    await quarantinePendingAttempt(attempt, layout, limits, seams);
  }
}

async function replayInternal(
  workspaceRoot: string,
  expectedScope: GrandHallT554NativeReviewJournalScope,
  priorLayout: JournalLayout,
  limits: JournalLimits = PRODUCTION_JOURNAL_LIMITS,
  seams: __GrandHallT554NativeReviewJournalTestSeams = {},
): Promise<{
  readonly layout: JournalLayout;
  readonly replay: GrandHallT554NativeReviewJournalReplay;
}> {
  try {
    const layout = await loadLayout(workspaceRoot, expectedScope, priorLayout);
    await recoverPublicationResidues(layout, limits, seams);
    const [
      claimsBeforeResult,
      eventsBeforeResult,
      pendingBeforeResult,
      quarantineBeforeResult,
    ] = await Promise.allSettled([
        snapshotDirectory(layout.claims, {
          allowMultipleFileLinks: true,
        }),
        snapshotDirectory(layout.events, {
          allowMultipleFileLinks: true,
        }),
        snapshotDirectory(layout.pending, {
          allowEmptyFiles: true,
          allowMultipleFileLinks: true,
        }),
        snapshotDirectory(layout.quarantine),
      ] as const);
    const claimsBefore = settledValue(claimsBeforeResult);
    const eventsBefore = settledValue(eventsBeforeResult);
    const pendingBefore = settledValue(pendingBeforeResult);
    const quarantineBefore = settledValue(quarantineBeforeResult);
    if (pendingBefore.entries.length !== 0) {
      throw new Error("Journal pending recovery did not reach a clean state.");
    }
    const [eventsResult, quarantineResult] = await Promise.allSettled([
      readEvents(layout, eventsBefore, limits, seams),
      inspectQuarantine(layout, quarantineBefore, limits),
    ] as const);
    const events = settledValue(eventsResult);
    const quarantine = settledValue(quarantineResult);
    assertMirroredCommittedPrefix(claimsBefore, eventsBefore, events);
    const [
      claimsAfterResult,
      eventsAfterResult,
      pendingAfterResult,
      quarantineAfterResult,
    ] = await Promise.allSettled([
        snapshotDirectory(layout.claims, {
          allowMultipleFileLinks: true,
        }),
        snapshotDirectory(layout.events, {
          allowMultipleFileLinks: true,
        }),
        snapshotDirectory(layout.pending, {
          allowEmptyFiles: true,
          allowMultipleFileLinks: true,
        }),
        snapshotDirectory(layout.quarantine),
      ] as const);
    const claimsAfter = settledValue(claimsAfterResult);
    const eventsAfter = settledValue(eventsAfterResult);
    const pendingAfter = settledValue(pendingAfterResult);
    const quarantineAfter = settledValue(quarantineAfterResult);
    if (
      !snapshotsEqual(claimsBefore, claimsAfter) ||
      !snapshotsEqual(eventsBefore, eventsAfter) ||
      !snapshotsEqual(pendingBefore, pendingAfter) ||
      !snapshotsEqual(quarantine.snapshot, quarantineAfter)
    ) {
      throw new Error("Journal inventory changed during replay.");
    }
    const finalLayout = await loadLayout(workspaceRoot, expectedScope, layout);
    const revision = events.length;
    if (quarantine.markerSequences.size > 0) {
      throw new Error(
        "Journal contains an unresolved ambiguous-append marker.",
      );
    }
    return {
      layout: finalLayout,
      replay: {
        scope: finalLayout.scope,
        scopeSha256: finalLayout.scopeSha256,
        scopeFileSha256: finalLayout.scopeFileSha256,
        genesisSha256: finalLayout.genesisSha256,
        revision,
        headEventSha256:
          events.at(-1)?.eventSha256 ?? finalLayout.genesisSha256,
        events,
      },
    };
  } catch (error) {
    if (
      error instanceof GrandHallT554NativeReviewJournalError &&
      error.code === "WORKSPACE_UNSAFE"
    )
      throw error;
    throw new GrandHallT554NativeReviewJournalError(
      "JOURNAL_INVALID",
      "Native-review journal replay rejected the persisted inventory.",
      error,
    );
  }
}

async function assertEmptyFixedRoot(
  workspaceRoot: string,
): Promise<NodeWitness> {
  try {
    const root = await directNode(workspaceRoot, "directory");
    const before = await readdir(workspaceRoot, { withFileTypes: true });
    if (before.length !== 0) throw new Error("Workspace root is not empty.");
    const after = await directNode(workspaceRoot, "directory");
    if (!grandHallT554V3SameFileState(root.stats, after.stats)) {
      throw new Error("Workspace root changed during empty-root validation.");
    }
    return after;
  } catch (error) {
    throw new GrandHallT554NativeReviewJournalError(
      "WORKSPACE_UNSAFE",
      "New native-review journal workspace root must be one empty fixed direct directory.",
      error,
    );
  }
}

function directorySyncUnsupported(error: unknown): boolean {
  const code = errnoCode(error);
  if (code === "ENOTSUP") return true;
  return (
    process.platform === "win32" &&
    (code === "EACCES" ||
      code === "EBADF" ||
      code === "EINVAL" ||
      code === "EISDIR" ||
      code === "EPERM")
  );
}

async function syncDirectory(
  absolutePath: string,
  reason: string,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<void> {
  await seams.beforeDirectorySync?.({ absolutePath, reason });
  let handle: FileHandle | undefined;
  try {
    handle = await open(absolutePath, "r");
    await handle.sync();
  } catch (error) {
    // Node 22 returns EPERM for directory fsync on Windows. The append protocol
    // remains exact under process termination, but callers must not upgrade this
    // best-effort barrier into a sudden-power-loss durability claim.
    if (!directorySyncUnsupported(error)) throw error;
  } finally {
    await handle?.close();
  }
}

async function writeAll(
  handle: FileHandle,
  bytes: Buffer,
  absolutePath: string,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<void> {
  const configured = seams.writeChunkByteLength ?? bytes.length;
  if (!Number.isInteger(configured) || configured < 1) {
    throw new GrandHallT554NativeReviewJournalError(
      "ARGUMENT_INVALID",
      "Test write chunk byte length must be a positive integer.",
    );
  }
  let offset = 0;
  while (offset < bytes.length) {
    const length = Math.min(configured, bytes.length - offset);
    const { bytesWritten } = await handle.write(bytes, offset, length, offset);
    if (bytesWritten < 1 || bytesWritten > length)
      throw new Error("Journal append made no progress.");
    offset += bytesWritten;
    await seams.afterEventWriteChunk?.({
      absolutePath,
      writtenByteLength: offset,
      totalByteLength: bytes.length,
    });
  }
}

async function assertPendingPath(
  attempt: PendingAttempt,
  handle: FileHandle,
  layout: JournalLayout,
): Promise<void> {
  const pending = await directNode(layout.pending.absolutePath, "directory");
  const root = await directNode(layout.root.absolutePath, "directory");
  assertSameNode(pending, layout.pending, "Journal pending directory");
  assertSameNode(root, layout.root, "Journal workspace root");
  const descriptor = await handle.stat({ bigint: true });
  const path = await directNode(attempt.absolutePath, "file", true);
  if (
    !grandHallT554V3SameNode(descriptor, attempt.stats) ||
    descriptor.nlink !== 1n ||
    !grandHallT554V3SameFileState(descriptor, path.stats)
  ) {
    throw new Error(
      "Pending journal descriptor lost its direct path binding.",
    );
  }
}

async function reserveAndWritePending(
  eventSha256: Sha256,
  sequence: number,
  bytes: Buffer,
  layout: JournalLayout,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
  onReserved: (attempt: PendingAttempt) => void,
): Promise<void> {
  const token = newQuarantineToken(seams);
  const pendingName = pendingFileName(sequence, eventSha256, token);
  const absolutePath = join(layout.pending.absolutePath, pendingName);
  const handle = await open(absolutePath, "wx", 0o600);
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || stats.nlink !== 1n || stats.size !== 0n) {
      throw new Error(
        "Reserved journal pending file is not one empty single-link file.",
      );
    }
    const attempt: PendingAttempt = {
      absolutePath,
      fileName: eventFileName(sequence, eventSha256),
      sequence,
      eventSha256,
      token,
      stats,
    };
    onReserved(attempt);
    await assertPendingPath(attempt, handle, layout);
    await seams.afterEventFileReserved?.({ absolutePath, sequence });
    await assertPendingPath(attempt, handle, layout);
    await writeAll(handle, bytes, absolutePath, seams);
    await handle.sync();
    await seams.afterEventFileSynced?.({ absolutePath, sequence });
    await assertPendingPath(attempt, handle, layout);
    const final = await handle.stat({ bigint: true });
    if (
      !grandHallT554V3SameNode(final, stats) ||
      final.size !== BigInt(bytes.length)
    ) {
      throw new Error("Journal pending descriptor length or identity drifted.");
    }
  } finally {
    await handle.close();
  }
}

function newQuarantineToken(
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): string {
  const token = seams.quarantineToken?.() ?? randomBytes(16).toString("hex");
  if (!/^[0-9a-f]{32}$/u.test(token)) {
    throw new Error(
      "Quarantine token must be exactly 128 lowercase hexadecimal bits.",
    );
  }
  return token;
}

function movedQuarantineFileName(
  sequence: number,
  eventSha256: Sha256,
  token: string,
  fileByteLength: number,
  fileSha256: Sha256,
): string {
  return `moved-${String(sequence).padStart(EVENT_SEQUENCE_WIDTH, "0")}-${eventSha256.replace(":", "-")}-bytes-${String(fileByteLength)}-${fileSha256.replace(":", "-")}-${token}.json`;
}

function markerQuarantineFileName(
  sequence: number,
  eventSha256: Sha256,
  token: string,
): string {
  return `marker-${String(sequence).padStart(EVENT_SEQUENCE_WIDTH, "0")}-${eventSha256.replace(":", "-")}-${token}.json`;
}

async function writeExclusiveSynced(
  absolutePath: string,
  bytes: Buffer,
  validate: (handle: FileHandle, initial: BigIntStats) => Promise<void>,
): Promise<void> {
  const handle = await open(absolutePath, "wx", 0o600);
  try {
    const initial = await handle.stat({ bigint: true });
    if (!initial.isFile() || initial.nlink !== 1n || initial.size !== 0n) {
      throw new Error("Exclusive journal file reservation is unsafe.");
    }
    await validate(handle, initial);
    await writeAll(handle, bytes, absolutePath, {});
    await handle.sync();
    await validate(handle, initial);
  } finally {
    await handle.close();
  }
}

async function writeQuarantineMarker(
  attempt: PendingAttempt,
  layout: JournalLayout,
  limits: JournalLimits,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<void> {
  const name = markerQuarantineFileName(
    attempt.sequence,
    attempt.eventSha256,
    newQuarantineToken(seams),
  );
  const absolutePath = join(layout.quarantine.absolutePath, name);
  const bytes = serializeCanonicalJson(
    QuarantineMarkerSchema.parse({
      schemaVersion:
        GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_QUARANTINE_MARKER_SCHEMA,
      scopeSha256: layout.scopeSha256,
      sequence: attempt.sequence,
      attemptedEventFileName: attempt.fileName,
      attemptedEventSha256: attempt.eventSha256,
      disposition: "append_ambiguous_no_delete",
    }),
  );
  await assertQuarantineCanAccept(layout, bytes.length, limits);
  await writeExclusiveSynced(absolutePath, bytes, async (handle, initial) => {
    const directory = await directNode(
      layout.quarantine.absolutePath,
      "directory",
    );
    assertSameNode(
      directory,
      layout.quarantine,
      "Journal quarantine directory",
    );
    const path = await directNode(absolutePath, "file", true);
    const descriptor = await handle.stat({ bigint: true });
    if (
      !grandHallT554V3SameNode(initial, descriptor) ||
      !grandHallT554V3SameFileState(descriptor, path.stats)
    ) {
      throw new Error("Journal quarantine marker lost its path binding.");
    }
  });
  await syncDirectory(
    layout.quarantine.absolutePath,
    "quarantine-marker",
    seams,
  );
}

async function quarantineFailedAppend(
  attempt: PendingAttempt,
  layout: JournalLayout,
  limits: JournalLimits,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<"moved" | "marker"> {
  try {
    await quarantinePendingAttempt(attempt, layout, limits, seams);
    return "moved";
  } catch {
    await writeQuarantineMarker(attempt, layout, limits, seams);
    return "marker";
  }
}

function buildEventUnchecked(
  replay: GrandHallT554NativeReviewJournalReplay,
  input: GrandHallT554NativeReviewJournalAppendInput,
  recordedAtUtc: string,
): {
  readonly event: Omit<
    GrandHallT554NativeReviewJournalEvent,
    "fileName" | "fileSha256" | "fileByteLength"
  >;
  readonly bytes: Buffer;
  readonly fileName: string;
} {
  const payload = canonicalJsonValue(input.payload);
  const material = PersistedEventMaterialSchema.parse({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_SCHEMA,
    sequence: replay.revision + 1,
    previousEventSha256: replay.headEventSha256,
    scope: replay.scope,
    scopeSha256: replay.scopeSha256,
    scopeFileSha256: replay.scopeFileSha256,
    recordedAtUtc,
    eventType: input.eventType,
    payload,
  });
  const eventSha256 = semanticSha256(
    GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
    material,
  );
  const event = { ...material, payload, eventSha256 };
  const bytes = serializeCanonicalJson(event);
  if (bytes.length > GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_BYTES) {
    throw new GrandHallT554NativeReviewJournalError(
      "ARGUMENT_INVALID",
      "Native-review journal event exceeds its byte bound.",
    );
  }
  return { event, bytes, fileName: eventFileName(event.sequence, eventSha256) };
}

function buildEvent(
  replay: GrandHallT554NativeReviewJournalReplay,
  input: GrandHallT554NativeReviewJournalAppendInput,
  recordedAtUtc: string,
): ReturnType<typeof buildEventUnchecked> {
  try {
    return buildEventUnchecked(replay, input, recordedAtUtc);
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewJournalError) throw error;
    throw new GrandHallT554NativeReviewJournalError(
      "ARGUMENT_INVALID",
      "Native-review journal event type or payload is invalid.",
      error,
    );
  }
}

class SerialLane {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const LANES = new Map<string, SerialLane>();

function laneFor(workspaceRoot: string): SerialLane {
  const key = grandHallT554V3ComparablePath(workspaceRoot);
  let lane = LANES.get(key);
  if (lane === undefined) {
    lane = new SerialLane();
    LANES.set(key, lane);
  }
  return lane;
}

class NativeReviewJournal implements GrandHallT554NativeReviewJournal {
  private layout: JournalLayout;

  constructor(
    public readonly workspaceRoot: string,
    public readonly scope: GrandHallT554NativeReviewJournalScope,
    layout: JournalLayout,
    private readonly lane: SerialLane,
    private readonly seams: __GrandHallT554NativeReviewJournalTestSeams,
    private readonly limits: JournalLimits,
  ) {
    this.layout = layout;
  }

  replay(): Promise<GrandHallT554NativeReviewJournalReplay> {
    return this.lane.run(async () => {
      const result = await replayInternal(
        this.workspaceRoot,
        this.scope,
        this.layout,
        this.limits,
        this.seams,
      );
      this.layout = result.layout;
      return result.replay;
    });
  }

  append(
    input: GrandHallT554NativeReviewJournalAppendInput,
  ): Promise<GrandHallT554NativeReviewJournalReplay> {
    return this.lane.run(
      async () => await this.appendSerialized(input),
    );
  }

  appendValidated(
    input: GrandHallT554NativeReviewJournalValidatedAppendInput,
  ): Promise<GrandHallT554NativeReviewJournalReplay> {
    const { validateCurrent, ...appendInput } = input;
    return this.lane.run(
      async () =>
        await this.appendSerialized(appendInput, validateCurrent),
    );
  }

  private async appendSerialized(
    requestedInput: GrandHallT554NativeReviewJournalAppendInput,
    validateCurrent?: (
      current: Readonly<GrandHallT554NativeReviewJournalReplay>,
    ) => GrandHallT554NativeReviewJournalAppendValidation,
  ): Promise<GrandHallT554NativeReviewJournalReplay> {
    const expectedRevision = requestedInput.expectedRevision;
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      throw new GrandHallT554NativeReviewJournalError(
        "ARGUMENT_INVALID",
        "Expected journal revision must be a non-negative safe integer.",
      );
    }
    const current = await replayInternal(
      this.workspaceRoot,
      this.scope,
      this.layout,
      this.limits,
      this.seams,
    );
    this.layout = current.layout;
    if (expectedRevision !== current.replay.revision) {
      throw new GrandHallT554NativeReviewJournalError(
        "REVISION_CONFLICT",
        `Expected revision ${String(expectedRevision)} does not match current revision ${String(current.replay.revision)}.`,
      );
    }
    if (current.replay.revision >= this.limits.maximumEventCount) {
      throw new GrandHallT554NativeReviewJournalError(
        "JOURNAL_LIMIT_REACHED",
        "Native-review journal reached its fixed event-count bound.",
      );
    }
    const validation = validateCurrent?.(deepFreezeValue(current.replay));
    const input: GrandHallT554NativeReviewJournalAppendInput = {
      expectedRevision,
      eventType: requestedInput.eventType,
      payload: requestedInput.payload,
      ...((validation?.minimumRecordedAtUtc ??
        requestedInput.minimumRecordedAtUtc) === undefined
        ? {}
        : {
            minimumRecordedAtUtc:
              validation?.minimumRecordedAtUtc ??
              requestedInput.minimumRecordedAtUtc,
          }),
    };
    await this.seams.afterReplayBeforeReserve?.({
      workspaceRoot: this.workspaceRoot,
      revision: current.replay.revision,
    });
    const now = canonicalUtcInstant(
      this.seams.nowUtc?.() ?? new Date().toISOString(),
    );
    let minimumRecordedAtUtc: string | undefined;
    try {
      minimumRecordedAtUtc =
        input.minimumRecordedAtUtc === undefined
          ? undefined
          : canonicalUtcInstant(input.minimumRecordedAtUtc);
    } catch (error) {
      throw new GrandHallT554NativeReviewJournalError(
        "ARGUMENT_INVALID",
        "Minimum durable record time must be one canonical UTC millisecond instant.",
        error,
      );
    }
    const previousTime = current.replay.events.at(-1)?.recordedAtUtc;
    if (
      previousTime !== undefined &&
      Date.parse(now) < Date.parse(previousTime)
    ) {
      throw new GrandHallT554NativeReviewJournalError(
        "JOURNAL_INVALID",
        "Journal wall clock moved backward before append.",
      );
    }
    if (
      minimumRecordedAtUtc !== undefined &&
      Date.parse(now) < Date.parse(minimumRecordedAtUtc)
    ) {
      throw new GrandHallT554NativeReviewJournalError(
        "JOURNAL_INVALID",
        "Journal wall clock precedes the typed event's server-owned instant.",
      );
    }
    const built = buildEvent(current.replay, input, now);
    const priorEventBytes = current.replay.events.reduce(
      (total, event) => total + event.fileByteLength,
      0,
    );
    if (
      priorEventBytes + built.bytes.length >
      this.limits.maximumTotalEventBytes
    ) {
      throw new GrandHallT554NativeReviewJournalError(
        "JOURNAL_LIMIT_REACHED",
        "Native-review journal reached its fixed cumulative byte bound.",
      );
    }
    // The session-root exclusive owner makes this preflight a reservation for
    // the full attempt. Without that owner, no count/byte preflight can be an
    // atomic cross-process capacity reservation.
    await assertQuarantineCanAccept(
      this.layout,
      built.bytes.length,
      this.limits,
    );
    let attempt: PendingAttempt | undefined;
    let claimMayBeCommitted = false;
    try {
      await reserveAndWritePending(
        built.event.eventSha256,
        built.event.sequence,
        built.bytes,
        this.layout,
        this.seams,
        (value) => {
          attempt = value;
        },
      );
      if (attempt === undefined) {
        throw new Error("Journal pending reservation was not captured.");
      }
      await syncDirectory(
        this.layout.pending.absolutePath,
        "pending-publication",
        this.seams,
      );
      const pendingNode = await directNode(attempt.absolutePath, "file");
      if (!grandHallT554V3SameNode(pendingNode.stats, attempt.stats)) {
        throw new Error("Journal pending attempt changed before claim.");
      }
      const claimPath = join(
        this.layout.claims.absolutePath,
        claimFileName(built.event.sequence),
      );
      try {
        await link(attempt.absolutePath, claimPath);
      } catch (error) {
        if (errnoCode(error) === "EEXIST") {
          await this.seams.afterClaimConflictDetectedBeforeQuarantine?.({
            pendingAbsolutePath: attempt.absolutePath,
            claimAbsolutePath: claimPath,
            sequence: built.event.sequence,
          });
          throw new GrandHallT554NativeReviewJournalError(
            "REVISION_CONFLICT",
            `Journal sequence ${String(built.event.sequence)} was claimed by another process.`,
            error,
          );
        }
        throw error;
      }
      claimMayBeCommitted = true;
      const claimNode = await directNode(claimPath, "file", false, true);
      if (!grandHallT554V3SameNode(claimNode.stats, attempt.stats)) {
        throw new Error("Journal claim does not bind the pending attempt.");
      }
      await syncDirectory(
        this.layout.claims.absolutePath,
        "claim-publication",
        this.seams,
      );
      await this.seams.afterClaimDirectorySynced?.({
        absolutePath: claimPath,
        sequence: built.event.sequence,
      });
      const eventPath = join(this.layout.events.absolutePath, built.fileName);
      await publishHardLinkNoReplace(claimPath, eventPath, attempt.stats);
      await syncDirectory(
        this.layout.events.absolutePath,
        "event-publication",
        this.seams,
      );
      await this.seams.afterEventDirectorySynced?.({
        absolutePath: eventPath,
        sequence: built.event.sequence,
      });
      await unlinkExactNode(attempt.absolutePath, attempt.stats);
      await syncDirectory(
        this.layout.pending.absolutePath,
        "pending-cleanup",
        this.seams,
      );
      await this.seams.afterPendingDirectorySyncedBeforePostReplay?.({
        absolutePath: attempt.absolutePath,
        sequence: built.event.sequence,
      });
      const advanced = await replayInternal(
        this.workspaceRoot,
        this.scope,
        this.layout,
        this.limits,
        this.seams,
      );
      const appended = advanced.replay.events[current.replay.revision];
      if (
        advanced.replay.revision !== current.replay.revision + 1 ||
        appended?.eventSha256 !== built.event.eventSha256
      ) {
        throw new Error(
          "Post-append replay is not the exact one-event advancement that was claimed.",
        );
      }
      this.layout = advanced.layout;
      return advanced.replay;
    } catch (error) {
      if (claimMayBeCommitted) {
        throw new GrandHallT554NativeReviewJournalError(
          "APPEND_AMBIGUOUS",
          "Native-review journal append failed after its no-replace claim may have committed; replay is required.",
          error,
        );
      }
      if (attempt === undefined) {
        if (error instanceof GrandHallT554NativeReviewJournalError) throw error;
        throw new GrandHallT554NativeReviewJournalError(
          "APPEND_FAILED",
          "Native-review journal append failed before reservation.",
          error,
        );
      }
      let quarantineDisposition: "moved" | "marker";
      try {
        quarantineDisposition = await quarantineFailedAppend(
          attempt,
          this.layout,
          this.limits,
          this.seams,
        );
      } catch (quarantineError) {
        throw new GrandHallT554NativeReviewJournalError(
          "APPEND_AMBIGUOUS",
          "Native-review journal append failed and its ambiguity could not be quarantined.",
          { appendError: error, quarantineError },
        );
      }
      if (quarantineDisposition === "marker") {
        throw new GrandHallT554NativeReviewJournalError(
          "APPEND_AMBIGUOUS",
          "Native-review journal append failed and required an unresolved ambiguity marker.",
          error,
        );
      }
      if (
        error instanceof GrandHallT554NativeReviewJournalError &&
        error.code === "REVISION_CONFLICT"
      ) {
        throw error;
      }
      throw new GrandHallT554NativeReviewJournalError(
        "APPEND_FAILED",
        "Native-review journal append failed; the reserved attempt was quarantined without deletion.",
        error,
      );
    }
  }
}

async function createJournal(
  options: GrandHallT554NativeReviewJournalCreateOptions,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<GrandHallT554NativeReviewJournal> {
  const workspaceRoot = resolvedAbsoluteRoot(options.workspaceRoot);
  const scope = normalizeScope(options.scope);
  const limits = journalLimits(seams);
  const lane = laneFor(workspaceRoot);
  return await lane.run(async () => {
    const root = await assertEmptyFixedRoot(workspaceRoot);
    try {
      await mkdir(join(workspaceRoot, CLAIMS_DIRECTORY_NAME));
      await mkdir(join(workspaceRoot, EVENTS_DIRECTORY_NAME));
      await mkdir(join(workspaceRoot, PENDING_DIRECTORY_NAME));
      await mkdir(join(workspaceRoot, QUARANTINE_DIRECTORY_NAME));
      await syncDirectory(workspaceRoot, "layout-directories", seams);
      const scopeDocument = buildScopeDocument(scope);
      await writeExclusiveSynced(
        join(workspaceRoot, SCOPE_FILE_NAME),
        scopeDocument.bytes,
        async (handle, initial) => {
          const actualRoot = await directNode(workspaceRoot, "directory");
          assertSameNode(actualRoot, root, "Journal workspace root");
          const descriptor = await handle.stat({ bigint: true });
          const path = await directNode(
            join(workspaceRoot, SCOPE_FILE_NAME),
            "file",
            true,
          );
          if (
            !grandHallT554V3SameNode(initial, descriptor) ||
            !grandHallT554V3SameFileState(descriptor, path.stats)
          ) {
            throw new Error("Journal scope descriptor lost its path binding.");
          }
        },
      );
      await syncDirectory(workspaceRoot, "scope-publication", seams);
      const layout = await loadLayout(workspaceRoot, scope);
      const replayed = await replayInternal(
        workspaceRoot,
        scope,
        layout,
        limits,
        seams,
      );
      return new NativeReviewJournal(
        workspaceRoot,
        scope,
        replayed.layout,
        lane,
        seams,
        limits,
      );
    } catch (error) {
      if (error instanceof GrandHallT554NativeReviewJournalError) throw error;
      throw new GrandHallT554NativeReviewJournalError(
        "WORKSPACE_UNSAFE",
        "Native-review journal initialization failed closed; the workspace was not cleaned up.",
        error,
      );
    }
  });
}

async function openJournal(
  options: GrandHallT554NativeReviewJournalOpenOptions,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<GrandHallT554NativeReviewJournal> {
  const workspaceRoot = resolvedAbsoluteRoot(options.workspaceRoot);
  const scope = normalizeScope(options.expectedScope);
  const limits = journalLimits(seams);
  const lane = laneFor(workspaceRoot);
  return await lane.run(async () => {
    const layout = await loadLayout(workspaceRoot, scope);
    const replayed = await replayInternal(
      workspaceRoot,
      scope,
      layout,
      limits,
      seams,
    );
    return new NativeReviewJournal(
      workspaceRoot,
      scope,
      replayed.layout,
      lane,
      seams,
      limits,
    );
  });
}

export async function createGrandHallT554NativeReviewJournal(
  options: GrandHallT554NativeReviewJournalCreateOptions,
): Promise<GrandHallT554NativeReviewJournal> {
  return await createJournal(options, {});
}

export async function openGrandHallT554NativeReviewJournal(
  options: GrandHallT554NativeReviewJournalOpenOptions,
): Promise<GrandHallT554NativeReviewJournal> {
  return await openJournal(options, {});
}

export async function __testOnlyCreateGrandHallT554NativeReviewJournal(
  options: GrandHallT554NativeReviewJournalCreateOptions,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<GrandHallT554NativeReviewJournal> {
  return await createJournal(options, seams);
}

export async function __testOnlyOpenGrandHallT554NativeReviewJournal(
  options: GrandHallT554NativeReviewJournalOpenOptions,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<GrandHallT554NativeReviewJournal> {
  return await openJournal(options, seams);
}

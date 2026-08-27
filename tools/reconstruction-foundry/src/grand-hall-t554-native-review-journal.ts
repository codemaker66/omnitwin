import { createHash, randomBytes } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
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
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_COUNT = 4_096;
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_TOTAL_EVENT_BYTES =
  64 * 1_024 * 1_024;

const SCOPE_FILE_NAME = "scope.json";
const EVENTS_DIRECTORY_NAME = "events";
const QUARANTINE_DIRECTORY_NAME = "quarantine";
const EVENT_SEQUENCE_WIDTH = 16;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const MAX_SCOPE_BYTES = 16_384;
const MAX_QUARANTINE_BYTES = GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_BYTES;
const ROOT_INVENTORY = [EVENTS_DIRECTORY_NAME, QUARANTINE_DIRECTORY_NAME, SCOPE_FILE_NAME]
  .sort(lexicalOrder);
const PROHIBITED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_.-]{0,95}$/u;
const EVENT_FILE_PATTERN = /^([0-9]{16})-sha256-([0-9a-f]{64})\.json$/u;
const QUARANTINE_FILE_PATTERN =
  /^(moved|marker)-([0-9]{16})-sha256-([0-9a-f]{64})-([0-9a-f]{32})\.json$/u;
const UTC_MILLISECOND_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

type Sha256 = `sha256:${string}`;

const Sha256Schema = z.string().regex(SHA256_PATTERN)
  .transform((value): Sha256 => value as Sha256);
const SequenceSchema = z.number().int().min(1).max(MAX_SEQUENCE);

export const GrandHallT554NativeReviewJournalScopeSchema = z.object({
  sessionNonceSha256: Sha256Schema,
  sourceEpochSha256: Sha256Schema,
  subjectSha256: Sha256Schema,
  kind: z.enum(["source", "mask"]),
  implementationSha256: Sha256Schema,
}).strict();

export type GrandHallT554NativeReviewJournalScope = z.infer<
  typeof GrandHallT554NativeReviewJournalScopeSchema
>;

const ScopeFileMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_SCHEMA),
  scope: GrandHallT554NativeReviewJournalScopeSchema,
}).strict();

const ScopeFileSchema = ScopeFileMaterialSchema.extend({
  scopeSha256: Sha256Schema,
}).strict();

const PersistedEventMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_SCHEMA),
  sequence: SequenceSchema,
  previousEventSha256: Sha256Schema,
  scope: GrandHallT554NativeReviewJournalScopeSchema,
  scopeSha256: Sha256Schema,
  scopeFileSha256: Sha256Schema,
  recordedAtUtc: z.string(),
  eventType: z.string().regex(EVENT_TYPE_PATTERN),
  payload: z.unknown(),
}).strict();

const PersistedEventSchema = PersistedEventMaterialSchema.extend({
  eventSha256: Sha256Schema,
}).strict();

const QuarantineMarkerSchema = z.object({
  schemaVersion: z.literal(
    GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_QUARANTINE_MARKER_SCHEMA,
  ),
  scopeSha256: Sha256Schema,
  sequence: SequenceSchema,
  attemptedEventFileName: z.string(),
  attemptedEventSha256: Sha256Schema,
  disposition: z.literal("append_ambiguous_no_delete"),
}).strict();

export interface GrandHallT554NativeReviewJournalAppendInput {
  readonly expectedRevision: number;
  readonly eventType: string;
  readonly payload: CanonicalJson;
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

/** A durable ordered record only; it conveys no review, acceptance, or truth authority. */
export interface GrandHallT554NativeReviewJournal {
  readonly workspaceRoot: string;
  readonly scope: GrandHallT554NativeReviewJournalScope;
  replay(): Promise<GrandHallT554NativeReviewJournalReplay>;
  append(
    input: GrandHallT554NativeReviewJournalAppendInput,
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
  readonly afterEventDirectorySynced?: (context: {
    readonly absolutePath: string;
    readonly sequence: number;
  }) => Promise<void> | void;
  readonly beforeDirectorySync?: (context: {
    readonly absolutePath: string;
    readonly reason: string;
  }) => Promise<void> | void;
  readonly maximumEventCount?: number;
  readonly maximumTotalEventBytes?: number;
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
}

const PRODUCTION_JOURNAL_LIMITS = Object.freeze({
  maximumEventCount: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_COUNT,
  maximumTotalEventBytes:
    GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_TOTAL_EVENT_BYTES,
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
  };
  if (
    !Number.isSafeInteger(limits.maximumEventCount) ||
    limits.maximumEventCount < 1 ||
    limits.maximumEventCount > PRODUCTION_JOURNAL_LIMITS.maximumEventCount ||
    !Number.isSafeInteger(limits.maximumTotalEventBytes) ||
    limits.maximumTotalEventBytes < 1 ||
    limits.maximumTotalEventBytes >
      PRODUCTION_JOURNAL_LIMITS.maximumTotalEventBytes
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
  readonly events: NodeWitness;
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

interface EventReservation {
  readonly absolutePath: string;
  readonly fileName: string;
  readonly sequence: number;
  readonly eventSha256: Sha256;
  readonly stats: BigIntStats;
}

interface QuarantineInventory {
  readonly snapshot: DirectorySnapshot;
  readonly markerSequences: ReadonlySet<number>;
}

function lexicalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error &&
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
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function canonicalJsonValue(value: unknown, depth = 0): CanonicalJson {
  if (depth > 128) throw new Error("Canonical event payload nesting is too deep.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical event payload has a non-finite number.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalJsonValue(entry, depth + 1));
  if (typeof value !== "object") throw new Error("Event payload is outside canonical JSON.");
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Event payload objects must be plain records.");
  }
  const output: Record<string, CanonicalJson> = {};
  for (const key of Object.keys(value).sort(lexicalOrder)) {
    if (PROHIBITED_JSON_KEYS.has(key)) throw new Error("Event payload has a prohibited key.");
    const member = (value as Record<string, unknown>)[key];
    if (member === undefined) throw new Error("Event payload has an undefined member.");
    output[key] = canonicalJsonValue(member, depth + 1);
  }
  return output;
}

function canonicalUtcInstant(value: string): string {
  const milliseconds = Date.parse(value);
  if (!UTC_MILLISECOND_PATTERN.test(value) || !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value) {
    throw new GrandHallT554NativeReviewJournalError(
      "ARGUMENT_INVALID",
      "Journal time must use canonical UTC millisecond form.",
    );
  }
  return value;
}

function normalizeScope(value: unknown): GrandHallT554NativeReviewJournalScope {
  try {
    return Object.freeze(GrandHallT554NativeReviewJournalScopeSchema.parse(value));
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
  return stableCanonicalJson(toCanonicalJson(left)) === stableCanonicalJson(toCanonicalJson(right));
}

function resolvedAbsoluteRoot(input: string): string {
  if (typeof input !== "string" || input.length === 0 || !isAbsolute(input) ||
    input.includes("\0") || input.normalize("NFC") !== input) {
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
): Promise<NodeWitness> {
  const before = await lstat(absolutePath, { bigint: true });
  const canonical = await realpath(absolutePath);
  const after = await lstat(absolutePath, { bigint: true });
  const rightKind = kind === "file" ? before.isFile() : before.isDirectory();
  if (!rightKind || before.isSymbolicLink() ||
    grandHallT554V3ComparablePath(canonical) !== grandHallT554V3ComparablePath(absolutePath) ||
    !grandHallT554V3SameFileState(before, after) ||
    (kind === "file" && (before.nlink !== 1n || (!allowEmptyFile && before.size < 1n)))) {
    throw new Error("Filesystem node is not one stable direct node of the required kind.");
  }
  return { absolutePath, stats: after };
}

function assertSameNode(actual: NodeWitness, expected: NodeWitness, label: string): void {
  if (grandHallT554V3ComparablePath(actual.absolutePath) !==
      grandHallT554V3ComparablePath(expected.absolutePath) ||
    !grandHallT554V3SameNode(actual.stats, expected.stats)) {
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
    if (folded.has(key)) throw new Error(`${label} contains case-colliding names.`);
    folded.add(key);
  }
}

async function snapshotDirectory(directory: NodeWitness): Promise<DirectorySnapshot> {
  const initial = await directNode(directory.absolutePath, "directory");
  assertSameNode(initial, directory, "Journal directory");
  const dirents = await readdir(directory.absolutePath, { withFileTypes: true });
  const names = dirents.map((entry) => entry.name);
  assertSafeUniqueNames(names, "Journal inventory");
  const entries = await Promise.all(dirents.map(async (dirent) => {
    if (!dirent.isFile() || dirent.isSymbolicLink()) {
      throw new Error("Journal inventory contains an extra directory or link.");
    }
    const node = await directNode(join(directory.absolutePath, dirent.name), "file", true);
    return { name: dirent.name, stats: node.stats };
  }));
  const final = await directNode(directory.absolutePath, "directory");
  assertSameNode(final, directory, "Journal directory");
  if (!grandHallT554V3SameFileState(initial.stats, final.stats)) {
    throw new Error("Journal directory changed during its inventory snapshot.");
  }
  return { stats: final.stats, entries: entries.sort((a, b) => lexicalOrder(a.name, b.name)) };
}

function snapshotsEqual(left: DirectorySnapshot, right: DirectorySnapshot): boolean {
  return grandHallT554V3SameFileState(left.stats, right.stats) &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const candidate = right.entries[index];
      return candidate !== undefined && entry.name === candidate.name &&
        grandHallT554V3SameFileState(entry.stats, candidate.stats);
    });
}

async function readExactly(handle: FileHandle, byteLength: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (bytesRead < 1) throw new Error("Journal file was truncated during its bounded read.");
    offset += bytesRead;
  }
  const trailing = Buffer.allocUnsafe(1);
  const probe = await handle.read(trailing, 0, 1, byteLength);
  if (probe.bytesRead !== 0) throw new Error("Journal file grew beyond its bounded read.");
  return bytes;
}

async function readStableFile(
  absolutePath: string,
  expectedStats: BigIntStats,
  maximumBytes: number,
): Promise<Buffer> {
  const before = await directNode(absolutePath, "file");
  if (!grandHallT554V3SameFileState(before.stats, expectedStats) ||
    before.stats.size > BigInt(maximumBytes)) throw new Error("Journal file snapshot binding failed.");
  const handle = await open(absolutePath, "r");
  try {
    const descriptorBefore = await handle.stat({ bigint: true });
    if (!grandHallT554V3SameFileState(before.stats, descriptorBefore)) {
      throw new Error("Journal descriptor does not match its inventoried path.");
    }
    const bytes = await readExactly(handle, Number(descriptorBefore.size));
    const descriptorAfter = await handle.stat({ bigint: true });
    const after = await directNode(absolutePath, "file");
    if (!grandHallT554V3SameFileState(descriptorBefore, descriptorAfter) ||
      !grandHallT554V3SameFileState(descriptorAfter, after.stats)) {
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
    throw new Error(`${label} is not encoded as exact canonical JSON plus one LF.`);
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
  const scopeSha256 = semanticSha256(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_DOMAIN, material);
  return { bytes: serializeCanonicalJson({ ...material, scopeSha256 }), scopeSha256 };
}

function parseScopeDocument(bytes: Buffer): {
  readonly scope: GrandHallT554NativeReviewJournalScope;
  readonly scopeSha256: Sha256;
} {
  const parsed = ScopeFileSchema.parse(parseCanonicalDocument(bytes, "Journal scope"));
  const { scopeSha256, ...material } = parsed;
  const expected = semanticSha256(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_DOMAIN, material);
  if (scopeSha256 !== expected) throw new Error("Journal scope digest drifted.");
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
    if ((expectedKind === "file" && !dirent.isFile()) ||
      (expectedKind === "directory" && !dirent.isDirectory()) || dirent.isSymbolicLink()) {
      throw new Error("Journal root inventory kind drifted.");
    }
    entries.set(dirent.name, await directNode(join(root.absolutePath, dirent.name), expectedKind));
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
    if (prior !== undefined) assertSameNode(root, prior.root, "Journal workspace root");
    const inventory = await inspectRootInventory(root);
    const events = inventory.entries.get(EVENTS_DIRECTORY_NAME);
    const quarantine = inventory.entries.get(QUARANTINE_DIRECTORY_NAME);
    const scopeFile = inventory.entries.get(SCOPE_FILE_NAME);
    if (events === undefined || quarantine === undefined || scopeFile === undefined) {
      throw new Error("Journal fixed inventory is incomplete.");
    }
    if (prior !== undefined) {
      assertSameNode(events, prior.events, "Journal events directory");
      assertSameNode(quarantine, prior.quarantine, "Journal quarantine directory");
      assertSameNode(scopeFile, prior.scopeFile, "Journal scope file");
    }
    const scopeBytes = await readStableFile(scopeFile.absolutePath, scopeFile.stats, MAX_SCOPE_BYTES);
    const parsed = parseScopeDocument(scopeBytes);
    if (!scopesEqual(parsed.scope, expectedScope)) throw new Error("Journal scope is not the expected scope.");
    const scopeFileSha256 = rawFileSha256(scopeBytes);
    const genesisSha256 = semanticSha256(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_GENESIS_DOMAIN, {
      scopeSha256: parsed.scopeSha256,
      scopeFileSha256,
    });
    return { root: inventory.root, events, quarantine, scopeFile,
      scope: parsed.scope, scopeSha256: parsed.scopeSha256, scopeFileSha256, genesisSha256 };
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

function parseEventFileName(name: string): { readonly sequence: number; readonly sha256: Sha256 } {
  const match = EVENT_FILE_PATTERN.exec(name);
  if (match === null) throw new Error("Journal event inventory contains an extra or unsafe file.");
  const sequence = Number(match[1]);
  const sha256 = Sha256Schema.parse(`sha256:${match[2] ?? ""}`);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE ||
    eventFileName(sequence, sha256) !== name) throw new Error("Journal event filename is not canonical.");
  return { sequence, sha256 };
}

function parsePersistedEvent(
  bytes: Buffer,
  fileName: string,
  layout: JournalLayout,
): GrandHallT554NativeReviewJournalEvent {
  const parsed = PersistedEventSchema.parse(parseCanonicalDocument(bytes, `Journal event ${fileName}`));
  const payload = canonicalJsonValue(parsed.payload);
  canonicalUtcInstant(parsed.recordedAtUtc);
  if (!scopesEqual(parsed.scope, layout.scope) || parsed.scopeSha256 !== layout.scopeSha256 ||
    parsed.scopeFileSha256 !== layout.scopeFileSha256) throw new Error("Journal event scope drifted.");
  const { eventSha256, ...materialInput } = parsed;
  const material = { ...materialInput, scope: layout.scope, payload };
  const expected = semanticSha256(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN, material);
  if (eventSha256 !== expected || eventFileName(parsed.sequence, eventSha256) !== fileName) {
    throw new Error("Journal event digest or filename drifted.");
  }
  return { ...material, eventSha256, fileName, fileSha256: rawFileSha256(bytes),
    fileByteLength: bytes.length };
}

async function readEvents(
  layout: JournalLayout,
  snapshot: DirectorySnapshot,
  limits: JournalLimits,
): Promise<readonly GrandHallT554NativeReviewJournalEvent[]> {
  if (snapshot.entries.length > limits.maximumEventCount) {
    throw new Error("Journal event inventory exceeds its fixed count bound.");
  }
  const inventoryBytes = snapshot.entries.reduce(
    (total, entry) => total + entry.stats.size,
    0n,
  );
  if (inventoryBytes > BigInt(limits.maximumTotalEventBytes)) {
    throw new Error("Journal event inventory exceeds its fixed cumulative byte bound.");
  }
  const events: GrandHallT554NativeReviewJournalEvent[] = [];
  let previous = layout.genesisSha256;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, entry] of snapshot.entries.entries()) {
    const identity = parseEventFileName(entry.name);
    const expectedSequence = index + 1;
    if (identity.sequence !== expectedSequence) throw new Error("Journal sequence has a gap or duplicate.");
    const bytes = await readStableFile(
      join(layout.events.absolutePath, entry.name), entry.stats,
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_BYTES,
    );
    const event = parsePersistedEvent(bytes, entry.name, layout);
    if (event.sequence !== expectedSequence || event.eventSha256 !== identity.sha256 ||
      event.previousEventSha256 !== previous) throw new Error("Journal hash chain is broken.");
    const timestamp = Date.parse(event.recordedAtUtc);
    if (timestamp < previousTimestamp) throw new Error("Journal wall clock rolled backward.");
    events.push(event);
    previous = event.eventSha256;
    previousTimestamp = timestamp;
  }
  return events;
}

function parseQuarantineName(name: string): {
  readonly disposition: "moved" | "marker";
  readonly sequence: number;
  readonly eventSha256: Sha256;
} {
  const match = QUARANTINE_FILE_PATTERN.exec(name);
  if (match === null) throw new Error("Journal quarantine contains an extra or unsafe entry.");
  const sequence = Number(match[2]);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new Error("Journal quarantine sequence is invalid.");
  }
  return { disposition: match[1] as "moved" | "marker", sequence,
    eventSha256: Sha256Schema.parse(`sha256:${match[3] ?? ""}`) };
}

async function inspectQuarantine(
  layout: JournalLayout,
  snapshot: DirectorySnapshot,
): Promise<QuarantineInventory> {
  const markerSequences = new Set<number>();
  for (const entry of snapshot.entries) {
    const identity = parseQuarantineName(entry.name);
    if (entry.stats.size > BigInt(MAX_QUARANTINE_BYTES)) {
      throw new Error("Journal quarantine entry is over its byte bound.");
    }
    if (identity.disposition !== "marker") continue;
    const bytes = await readStableFile(
      join(layout.quarantine.absolutePath, entry.name), entry.stats, MAX_SCOPE_BYTES,
    );
    const marker = QuarantineMarkerSchema.parse(
      parseCanonicalDocument(bytes, `Journal quarantine marker ${entry.name}`),
    );
    if (marker.scopeSha256 !== layout.scopeSha256 || marker.sequence !== identity.sequence ||
      marker.attemptedEventSha256 !== identity.eventSha256 ||
      eventFileName(marker.sequence, marker.attemptedEventSha256) !==
        marker.attemptedEventFileName) throw new Error("Journal quarantine marker drifted.");
    markerSequences.add(marker.sequence);
  }
  return { snapshot, markerSequences };
}

async function replayInternal(
  workspaceRoot: string,
  expectedScope: GrandHallT554NativeReviewJournalScope,
  priorLayout: JournalLayout,
  limits: JournalLimits = PRODUCTION_JOURNAL_LIMITS,
): Promise<{ readonly layout: JournalLayout; readonly replay: GrandHallT554NativeReviewJournalReplay }> {
  try {
    const layout = await loadLayout(workspaceRoot, expectedScope, priorLayout);
    const eventsBefore = await snapshotDirectory(layout.events);
    const quarantineBefore = await snapshotDirectory(layout.quarantine);
    const events = await readEvents(layout, eventsBefore, limits);
    const quarantine = await inspectQuarantine(layout, quarantineBefore);
    const eventsAfter = await snapshotDirectory(layout.events);
    const quarantineAfter = await snapshotDirectory(layout.quarantine);
    if (!snapshotsEqual(eventsBefore, eventsAfter) ||
      !snapshotsEqual(quarantine.snapshot, quarantineAfter)) {
      throw new Error("Journal inventory changed during replay.");
    }
    const finalLayout = await loadLayout(workspaceRoot, expectedScope, layout);
    const revision = events.length;
    if ([...quarantine.markerSequences].some((sequence) => sequence <= revision)) {
      throw new Error("An ambiguous failed append overlaps the replayed revision.");
    }
    return { layout: finalLayout, replay: {
      scope: finalLayout.scope,
      scopeSha256: finalLayout.scopeSha256,
      scopeFileSha256: finalLayout.scopeFileSha256,
      genesisSha256: finalLayout.genesisSha256,
      revision,
      headEventSha256: events.at(-1)?.eventSha256 ?? finalLayout.genesisSha256,
      events,
    } };
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewJournalError &&
      error.code === "WORKSPACE_UNSAFE") throw error;
    throw new GrandHallT554NativeReviewJournalError(
      "JOURNAL_INVALID",
      "Native-review journal replay rejected the persisted inventory.",
      error,
    );
  }
}

async function assertEmptyFixedRoot(workspaceRoot: string): Promise<NodeWitness> {
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
  return process.platform === "win32" &&
    (code === "EACCES" || code === "EBADF" || code === "EINVAL" ||
      code === "EISDIR" || code === "EPERM");
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
    if (bytesWritten < 1 || bytesWritten > length) throw new Error("Journal append made no progress.");
    offset += bytesWritten;
    await seams.afterEventWriteChunk?.({ absolutePath, writtenByteLength: offset,
      totalByteLength: bytes.length });
  }
}

async function assertReservedPath(
  reservation: EventReservation,
  handle: FileHandle,
  layout: JournalLayout,
): Promise<void> {
  const events = await directNode(layout.events.absolutePath, "directory");
  const root = await directNode(layout.root.absolutePath, "directory");
  assertSameNode(events, layout.events, "Journal events directory");
  assertSameNode(root, layout.root, "Journal workspace root");
  const descriptor = await handle.stat({ bigint: true });
  const path = await directNode(reservation.absolutePath, "file", true);
  if (!grandHallT554V3SameNode(descriptor, reservation.stats) || descriptor.nlink !== 1n ||
    !grandHallT554V3SameFileState(descriptor, path.stats)) {
    throw new Error("Reserved journal descriptor lost its direct path binding.");
  }
}

async function reserveAndWriteEvent(
  absolutePath: string,
  fileName: string,
  eventSha256: Sha256,
  sequence: number,
  bytes: Buffer,
  layout: JournalLayout,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
  onReserved: (reservation: EventReservation) => void,
): Promise<void> {
  const handle = await open(absolutePath, "wx", 0o600);
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || stats.nlink !== 1n || stats.size !== 0n) {
      throw new Error("Reserved journal event is not one empty single-link file.");
    }
    const reservation = { absolutePath, fileName, sequence, eventSha256, stats };
    onReserved(reservation);
    await assertReservedPath(reservation, handle, layout);
    await seams.afterEventFileReserved?.({ absolutePath, sequence });
    await assertReservedPath(reservation, handle, layout);
    await writeAll(handle, bytes, absolutePath, seams);
    await handle.sync();
    await seams.afterEventFileSynced?.({ absolutePath, sequence });
    await assertReservedPath(reservation, handle, layout);
    const final = await handle.stat({ bigint: true });
    if (!grandHallT554V3SameNode(final, stats) || final.size !== BigInt(bytes.length)) {
      throw new Error("Journal event descriptor length or identity drifted.");
    }
  } finally {
    await handle.close();
  }
}

function newQuarantineToken(seams: __GrandHallT554NativeReviewJournalTestSeams): string {
  const token = seams.quarantineToken?.() ?? randomBytes(16).toString("hex");
  if (!/^[0-9a-f]{32}$/u.test(token)) {
    throw new Error("Quarantine token must be exactly 128 lowercase hexadecimal bits.");
  }
  return token;
}

function quarantineFileName(
  disposition: "moved" | "marker",
  reservation: EventReservation,
  token: string,
): string {
  return `${disposition}-${String(reservation.sequence).padStart(EVENT_SEQUENCE_WIDTH, "0")}-${reservation.eventSha256.replace(":", "-")}-${token}.json`;
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

async function moveReservationToQuarantine(
  reservation: EventReservation,
  layout: JournalLayout,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<boolean> {
  try {
    const current = await directNode(reservation.absolutePath, "file", true);
    if (!grandHallT554V3SameNode(current.stats, reservation.stats)) return false;
    const name = quarantineFileName("moved", reservation, newQuarantineToken(seams));
    const destination = join(layout.quarantine.absolutePath, name);
    try {
      await lstat(destination);
      return false;
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
    }
    await rename(reservation.absolutePath, destination);
    const moved = await directNode(destination, "file", true);
    if (!grandHallT554V3SameNode(moved.stats, reservation.stats)) {
      throw new Error("Quarantined journal event identity drifted.");
    }
    await syncDirectory(layout.events.absolutePath, "quarantine-source", seams);
    await syncDirectory(layout.quarantine.absolutePath, "quarantine-destination", seams);
    return true;
  } catch {
    return false;
  }
}

async function writeQuarantineMarker(
  reservation: EventReservation,
  layout: JournalLayout,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<void> {
  const name = quarantineFileName("marker", reservation, newQuarantineToken(seams));
  const absolutePath = join(layout.quarantine.absolutePath, name);
  const bytes = serializeCanonicalJson(QuarantineMarkerSchema.parse({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_QUARANTINE_MARKER_SCHEMA,
    scopeSha256: layout.scopeSha256,
    sequence: reservation.sequence,
    attemptedEventFileName: reservation.fileName,
    attemptedEventSha256: reservation.eventSha256,
    disposition: "append_ambiguous_no_delete",
  }));
  await writeExclusiveSynced(absolutePath, bytes, async (handle, initial) => {
    const directory = await directNode(layout.quarantine.absolutePath, "directory");
    assertSameNode(directory, layout.quarantine, "Journal quarantine directory");
    const path = await directNode(absolutePath, "file", true);
    const descriptor = await handle.stat({ bigint: true });
    if (!grandHallT554V3SameNode(initial, descriptor) ||
      !grandHallT554V3SameFileState(descriptor, path.stats)) {
      throw new Error("Journal quarantine marker lost its path binding.");
    }
  });
  await syncDirectory(layout.quarantine.absolutePath, "quarantine-marker", seams);
}

async function quarantineFailedAppend(
  reservation: EventReservation,
  layout: JournalLayout,
  seams: __GrandHallT554NativeReviewJournalTestSeams,
): Promise<void> {
  if (await moveReservationToQuarantine(reservation, layout, seams)) return;
  await writeQuarantineMarker(reservation, layout, seams);
}

function buildEventUnchecked(
  replay: GrandHallT554NativeReviewJournalReplay,
  input: GrandHallT554NativeReviewJournalAppendInput,
  recordedAtUtc: string,
): { readonly event: Omit<GrandHallT554NativeReviewJournalEvent,
  "fileName" | "fileSha256" | "fileByteLength">; readonly bytes: Buffer; readonly fileName: string } {
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
  const eventSha256 = semanticSha256(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
    material);
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
    this.tail = result.then(() => undefined, () => undefined);
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
      );
      this.layout = result.layout;
      return result.replay;
    });
  }

  append(
    input: GrandHallT554NativeReviewJournalAppendInput,
  ): Promise<GrandHallT554NativeReviewJournalReplay> {
    return this.lane.run(async () => await this.appendSerialized(input));
  }

  private async appendSerialized(
    input: GrandHallT554NativeReviewJournalAppendInput,
  ): Promise<GrandHallT554NativeReviewJournalReplay> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new GrandHallT554NativeReviewJournalError(
        "ARGUMENT_INVALID", "Expected journal revision must be a non-negative safe integer.",
      );
    }
    const current = await replayInternal(
      this.workspaceRoot,
      this.scope,
      this.layout,
      this.limits,
    );
    this.layout = current.layout;
    if (input.expectedRevision !== current.replay.revision) {
      throw new GrandHallT554NativeReviewJournalError(
        "REVISION_CONFLICT",
        `Expected revision ${String(input.expectedRevision)} does not match current revision ${String(current.replay.revision)}.`,
      );
    }
    if (current.replay.revision >= this.limits.maximumEventCount) {
      throw new GrandHallT554NativeReviewJournalError(
        "JOURNAL_LIMIT_REACHED",
        "Native-review journal reached its fixed event-count bound.",
      );
    }
    await this.seams.afterReplayBeforeReserve?.({ workspaceRoot: this.workspaceRoot,
      revision: current.replay.revision });
    const now = canonicalUtcInstant(this.seams.nowUtc?.() ?? new Date().toISOString());
    const previousTime = current.replay.events.at(-1)?.recordedAtUtc;
    if (previousTime !== undefined && Date.parse(now) < Date.parse(previousTime)) {
      throw new GrandHallT554NativeReviewJournalError(
        "JOURNAL_INVALID", "Journal wall clock moved backward before append.",
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
    let reservation: EventReservation | undefined;
    try {
      await reserveAndWriteEvent(
        join(this.layout.events.absolutePath, built.fileName), built.fileName,
        built.event.eventSha256, built.event.sequence, built.bytes, this.layout, this.seams,
        (value) => { reservation = value; },
      );
      await syncDirectory(this.layout.events.absolutePath, "event-publication", this.seams);
      await this.seams.afterEventDirectorySynced?.({
        absolutePath: join(this.layout.events.absolutePath, built.fileName),
        sequence: built.event.sequence,
      });
      const advanced = await replayInternal(
        this.workspaceRoot,
        this.scope,
        this.layout,
        this.limits,
      );
      if (advanced.replay.revision !== current.replay.revision + 1 ||
        advanced.replay.headEventSha256 !== built.event.eventSha256) {
        throw new Error("Post-append replay did not advance by the exact event.");
      }
      this.layout = advanced.layout;
      return advanced.replay;
    } catch (error) {
      if (reservation === undefined) {
        if (error instanceof GrandHallT554NativeReviewJournalError) throw error;
        throw new GrandHallT554NativeReviewJournalError(
          "APPEND_FAILED", "Native-review journal append failed before reservation.", error,
        );
      }
      try {
        await quarantineFailedAppend(reservation, this.layout, this.seams);
      } catch (quarantineError) {
        throw new GrandHallT554NativeReviewJournalError(
          "APPEND_AMBIGUOUS",
          "Native-review journal append failed and its ambiguity could not be quarantined.",
          { appendError: error, quarantineError },
        );
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
      await mkdir(join(workspaceRoot, EVENTS_DIRECTORY_NAME));
      await mkdir(join(workspaceRoot, QUARANTINE_DIRECTORY_NAME));
      await syncDirectory(workspaceRoot, "layout-directories", seams);
      const scopeDocument = buildScopeDocument(scope);
      await writeExclusiveSynced(join(workspaceRoot, SCOPE_FILE_NAME), scopeDocument.bytes,
        async (handle, initial) => {
          const actualRoot = await directNode(workspaceRoot, "directory");
          assertSameNode(actualRoot, root, "Journal workspace root");
          const descriptor = await handle.stat({ bigint: true });
          const path = await directNode(join(workspaceRoot, SCOPE_FILE_NAME), "file", true);
          if (!grandHallT554V3SameNode(initial, descriptor) ||
            !grandHallT554V3SameFileState(descriptor, path.stats)) {
            throw new Error("Journal scope descriptor lost its path binding.");
          }
        });
      await syncDirectory(workspaceRoot, "scope-publication", seams);
      const layout = await loadLayout(workspaceRoot, scope);
      const replayed = await replayInternal(workspaceRoot, scope, layout, limits);
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
    const replayed = await replayInternal(workspaceRoot, scope, layout, limits);
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

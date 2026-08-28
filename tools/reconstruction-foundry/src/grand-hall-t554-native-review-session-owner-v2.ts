import { createHash, randomBytes } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import {
  GrandHallT554NativeReviewSessionScopeV2Schema,
  type GrandHallT554NativeReviewSessionScopeV2,
} from "./grand-hall-t554-native-review-events-v2.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";
import {
  grandHallT554V3ComparablePath,
  grandHallT554V3SameFileState,
  grandHallT554V3SameNode,
} from "./grand-hall-t554-review-pack-v3-files.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_SESSION_OWNER_LEASE_V2 =
  "venviewer.grand-hall-t554-native-review-session-owner-lease.v2";
export const GRAND_HALL_T554_NATIVE_REVIEW_PRIOR_OWNER_WITNESS_V2 =
  "venviewer.grand-hall-t554-native-review-prior-owner-witness.v2";

const CONTROL_DESCRIPTOR_SCHEMA =
  "venviewer.grand-hall-t554-native-review-owner-control.v2";
const ROOT_BINDING_SCHEMA =
  "venviewer.grand-hall-t554-native-review-owner-root-binding.v2";
const OWNER_TRANSITION_SCHEMA =
  "venviewer.grand-hall-t554-native-review-owner-transition.v2";
const RELEASE_TRANSITION_SCHEMA =
  "venviewer.grand-hall-t554-native-review-owner-release.v2";
const ROOT_DESCRIPTOR_SCHEMA =
  "venviewer.grand-hall-t554-native-review-session-root-descriptor.v2";
const ROOT_BINDING_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_OWNER_ROOT_BINDING_V2";
const SESSION_SCOPE_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_OWNER_SESSION_SCOPE_V2";
const CONTROL_PATH_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_OWNER_CONTROL_PATH_V2";
const CONTROL_FILE = "control.json";
const RECORDS_DIRECTORY = "records";
const STAGING_DIRECTORY = "staging";
const TRANSITIONS_DIRECTORY = "transitions";
const CONTROL_NAMES = [
  CONTROL_FILE,
  RECORDS_DIRECTORY,
  STAGING_DIRECTORY,
  TRANSITIONS_DIRECTORY,
] as const;
const MAXIMUM_CONTROL_FILE_BYTES = 512 * 1_024;
const MAXIMUM_TRANSITION_COUNT = 16_384;
const MAXIMUM_RECORD_COUNT = MAXIMUM_TRANSITION_COUNT * 3;
const MAXIMUM_STAGE_COUNT = MAXIMUM_RECORD_COUNT + 64;
const MAXIMUM_CONTROL_TOTAL_BYTES = 128 * 1_024 * 1_024;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL_BIGINT_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const UTC_MILLISECOND_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const TRANSITION_FILE_PATTERN = /^([0-9]{16})\.json$/u;
const RECORD_FILE_PATTERN = /^transition-sha256-([0-9a-f]{64})\.json$/u;
const STAGE_FILE_PATTERN =
  /^(control|transition)-sha256-([0-9a-f]{64})-nonce-([0-9a-f]{32})\.stage$/u;

type Sha256 = `sha256:${string}`;

const Sha256Schema = z.string().regex(SHA256_PATTERN).transform((value) => value as Sha256);
const DecimalBigIntSchema = z.string().regex(DECIMAL_BIGINT_PATTERN);

const RootBindingMaterialSchema = z
  .object({
    schemaVersion: z.literal(ROOT_BINDING_SCHEMA),
    sessionIdSha256: Sha256Schema,
    sessionScopeSha256: Sha256Schema,
    sessionRootPathSha256: Sha256Schema,
    sessionRootDevice: DecimalBigIntSchema,
    sessionRootInode: DecimalBigIntSchema,
    rootDescriptorDevice: DecimalBigIntSchema,
    rootDescriptorInode: DecimalBigIntSchema,
    rootDescriptorFileSha256: Sha256Schema,
    rootDescriptorByteLength: z.number().int().positive().max(MAXIMUM_CONTROL_FILE_BYTES),
  })
  .strict();

const RootBindingSchema = RootBindingMaterialSchema.extend({
  bindingSha256: Sha256Schema,
}).strict();

const ControlDescriptorSchema = z
  .object({
    schemaVersion: z.literal(CONTROL_DESCRIPTOR_SCHEMA),
    rootBinding: RootBindingSchema,
    createdAtUtc: z.string().regex(UTC_MILLISECOND_PATTERN),
  })
  .strict();

const PriorOwnerReceiptSchema = z
  .object({
    transitionSequence: z.number().int().positive().max(MAXIMUM_TRANSITION_COUNT),
    transitionFileSha256: Sha256Schema,
    ownerNonceSha256: Sha256Schema,
    transitionHeadDevice: DecimalBigIntSchema,
    transitionHeadInode: DecimalBigIntSchema,
  })
  .strict();

const OwnerTransitionSchema = z
  .object({
    schemaVersion: z.literal(OWNER_TRANSITION_SCHEMA),
    transitionKind: z.literal("owner_acquired"),
    transitionSequence: z.number().int().positive().max(MAXIMUM_TRANSITION_COUNT),
    predecessorTransitionFileSha256: Sha256Schema.nullable(),
    rootBindingSha256: Sha256Schema,
    sessionIdSha256: Sha256Schema,
    acquisitionKind: z.enum([
      "initial",
      "post_release",
      "explicit_crash_takeover",
    ]),
    ownerNonceSha256: Sha256Schema,
    priorOwner: PriorOwnerReceiptSchema.nullable(),
    recordedAtUtc: z.string().regex(UTC_MILLISECOND_PATTERN),
  })
  .strict()
  .superRefine((transition, context) => {
    const initial = transition.transitionSequence === 1;
    if (
      (initial &&
        (transition.acquisitionKind !== "initial" ||
          transition.predecessorTransitionFileSha256 !== null ||
          transition.priorOwner !== null)) ||
      (!initial &&
        (transition.acquisitionKind === "initial" ||
          transition.predecessorTransitionFileSha256 === null ||
          transition.priorOwner === null))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "owner transition acquisition lineage is inconsistent",
      });
    }
  });

const ReleaseTransitionSchema = z
  .object({
    schemaVersion: z.literal(RELEASE_TRANSITION_SCHEMA),
    transitionKind: z.literal("owner_released"),
    transitionSequence: z.number().int().positive().max(MAXIMUM_TRANSITION_COUNT),
    predecessorTransitionFileSha256: Sha256Schema,
    rootBindingSha256: Sha256Schema,
    sessionIdSha256: Sha256Schema,
    releasedOwner: PriorOwnerReceiptSchema,
    recordedAtUtc: z.string().regex(UTC_MILLISECOND_PATTERN),
  })
  .strict();

const TransitionSchema = z.union([
  OwnerTransitionSchema,
  ReleaseTransitionSchema,
]);

const SessionRootDescriptorSchema = z
  .object({
    schemaVersion: z.literal(ROOT_DESCRIPTOR_SCHEMA),
    sessionScope: GrandHallT554NativeReviewSessionScopeV2Schema,
    implementationManifestFileName: z.literal(
      "grand-hall-t554-native-review-implementation-manifest.json",
    ),
    coordinatorDirectoryName: z.literal("coordinator"),
    childScopesDirectoryName: z.literal("child-scopes"),
    childrenDirectoryName: z.literal("children"),
    maskEvidenceDirectoryName: z.literal("mask-evidence"),
  })
  .strict();

type RootBinding = z.infer<typeof RootBindingSchema>;
type Transition = z.infer<typeof TransitionSchema>;

export interface GrandHallT554NativeReviewSessionOwnerLeaseV2 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_SESSION_OWNER_LEASE_V2;
  readonly sessionRoot: string;
  readonly sessionIdSha256: Sha256;
  readonly rootBindingSha256: Sha256;
  readonly ownerNonceSha256: Sha256;
  readonly transitionSequence: number;
  readonly transitionFileSha256: Sha256;
}

export interface GrandHallT554NativeReviewPriorOwnerWitnessV2 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_PRIOR_OWNER_WITNESS_V2;
  readonly sessionRoot: string;
  readonly sessionIdSha256: Sha256;
  readonly rootBindingSha256: Sha256;
  readonly ownerNonceSha256: Sha256;
  readonly transitionSequence: number;
  readonly transitionFileSha256: Sha256;
}

export class GrandHallT554NativeReviewSessionOwnerV2Error extends Error {
  constructor(
    readonly code:
      | "ARGUMENT_INVALID"
      | "ROOT_UNSAFE"
      | "CONTROL_INVALID"
      | "CONTROL_LIMIT_REACHED"
      | "ALREADY_OWNED"
      | "UNOWNED"
      | "STALE_LEASE"
      | "STALE_WITNESS"
      | "RACE_LOST",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewSessionOwnerV2Error";
  }
}

interface NodeWitness {
  readonly absolutePath: string;
  readonly stats: BigIntStats;
}

interface ExactFile extends NodeWitness {
  readonly bytes: Buffer;
  readonly fileSha256: Sha256;
}

interface RootWitness {
  readonly root: NodeWitness;
  readonly descriptor: ExactFile;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly binding: RootBinding;
}

interface TransitionEvidence {
  readonly transition: Transition;
  readonly bytes: Buffer;
  readonly fileSha256: Sha256;
  readonly head: NodeWitness;
  readonly record: NodeWitness;
}

type StageKind = "control" | "transition";

interface StageEvidence {
  readonly kind: StageKind;
  readonly targetFileSha256: Sha256;
  readonly nonceHex: string;
  readonly file: ExactFile;
  readonly complete: boolean;
  readonly transition: Transition | null;
}

interface RecordEvidence {
  readonly file: ExactFile;
  readonly transition: Transition;
}

interface ControlState {
  readonly controlDirectory: NodeWitness;
  readonly controlDescriptor: ExactFile;
  readonly recordsDirectory: NodeWitness;
  readonly stagingDirectory: NodeWitness;
  readonly transitionsDirectory: NodeWitness;
  readonly root: RootWitness;
  readonly transitions: readonly TransitionEvidence[];
  readonly records: ReadonlyMap<Sha256, RecordEvidence>;
  readonly stages: readonly StageEvidence[];
  readonly publishedRecordSha256s: ReadonlySet<Sha256>;
  readonly headRevision: number;
  readonly headFileSha256: Sha256 | null;
  readonly currentOwner: TransitionEvidence | null;
  readonly lastOwner: TransitionEvidence | null;
}

interface LeaseInternal {
  readonly sessionRoot: string;
  readonly expectedSessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly owner: TransitionEvidence;
  readonly controlDirectory: NodeWitness;
  readonly controlDescriptor: ExactFile;
  released: boolean;
}

interface WitnessInternal {
  readonly sessionRoot: string;
  readonly expectedSessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly owner: TransitionEvidence;
  readonly controlDirectory: NodeWitness;
  readonly controlDescriptor: ExactFile;
}

interface OwnerSeams {
  readonly afterStageCreated?: (stage: OwnerStageSeamInfo) => Promise<void> | void;
  readonly afterStagePartialWrite?: (stage: OwnerStageSeamInfo) => Promise<void> | void;
  readonly afterStageFileSynced?: (stage: OwnerStageSeamInfo) => Promise<void> | void;
  readonly afterCanonicalLinkedBeforeDirectorySync?: (
    stage: OwnerStageSeamInfo,
  ) => Promise<void> | void;
  readonly beforeStageCleanup?: (stage: OwnerStageSeamInfo) => Promise<void> | void;
  readonly afterRecordDurable?: (recordPath: string) => Promise<void> | void;
  readonly beforeTransitionPublish?: (headPath: string) => Promise<void> | void;
  readonly afterTransitionPublished?: (headPath: string) => Promise<void> | void;
}

interface OwnerStageSeamInfo {
  readonly kind: StageKind;
  readonly stagePath: string;
  readonly canonicalPath: string;
  readonly targetFileSha256: Sha256;
}

const leaseInternals = new WeakMap<
  GrandHallT554NativeReviewSessionOwnerLeaseV2,
  LeaseInternal
>();
const witnessInternals = new WeakMap<
  GrandHallT554NativeReviewPriorOwnerWitnessV2,
  WitnessInternal
>();

function fail(
  code: GrandHallT554NativeReviewSessionOwnerV2Error["code"],
  message: string,
  cause?: unknown,
): GrandHallT554NativeReviewSessionOwnerV2Error {
  return new GrandHallT554NativeReviewSessionOwnerV2Error(
    code,
    message,
    cause,
  );
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as Readonly<{ code?: unknown }>).code)
    : undefined;
}

function lexicalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalDigest(domain: string, value: unknown): Sha256 {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return (
      stableCanonicalJson(toCanonicalJson(left)) ===
      stableCanonicalJson(toCanonicalJson(right))
    );
  } catch {
    return false;
  }
}

function nowUtc(): string {
  return new Date().toISOString();
}

function ownerNonce(): Sha256 {
  return `sha256:${randomBytes(32).toString("hex")}`;
}

function stageNonceHex(): string {
  return randomBytes(16).toString("hex");
}

function resolvedRoot(input: string): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    !isAbsolute(input) ||
    input.includes("\0") ||
    input.normalize("NFC") !== input ||
    input.startsWith("//") ||
    input.startsWith("\\\\")
  ) {
    throw fail("ARGUMENT_INVALID", "Session root must be one absolute NFC path.");
  }
  return resolve(input);
}

export function deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(
  sessionRoot: string,
): string {
  const root = resolvedRoot(sessionRoot);
  const pathSha256 = canonicalDigest(
    CONTROL_PATH_DOMAIN,
    grandHallT554V3ComparablePath(root),
  );
  return join(
    dirname(root),
    `.venviewer-t554-owner-v2-${pathSha256.slice("sha256:".length)}`,
  );
}

async function directNode(
  absolutePath: string,
  kind: "file" | "directory",
  allowedFileLinks = 1n,
): Promise<NodeWitness> {
  const before = await lstat(absolutePath, { bigint: true });
  const canonical = await realpath(absolutePath);
  const after = await lstat(absolutePath, { bigint: true });
  if (
    (kind === "file" ? !before.isFile() : !before.isDirectory()) ||
    before.isSymbolicLink() ||
    (kind === "file" && before.nlink !== allowedFileLinks) ||
    grandHallT554V3ComparablePath(canonical) !==
      grandHallT554V3ComparablePath(absolutePath) ||
    !grandHallT554V3SameFileState(before, after)
  ) {
    throw fail("ROOT_UNSAFE", "Ownership path contains an unsafe filesystem node.");
  }
  return { absolutePath, stats: after };
}

async function readExactly(handle: FileHandle, byteLength: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const result = await handle.read(bytes, offset, byteLength - offset, offset);
    if (result.bytesRead < 1) throw fail("CONTROL_INVALID", "Ownership file truncated during read.");
    offset += result.bytesRead;
  }
  const probe = Buffer.allocUnsafe(1);
  if ((await handle.read(probe, 0, 1, byteLength)).bytesRead !== 0) {
    throw fail("CONTROL_INVALID", "Ownership file grew during bounded read.");
  }
  return bytes;
}

async function readExactFile(
  absolutePath: string,
  allowedFileLinks: bigint,
): Promise<ExactFile> {
  const path = await directNode(absolutePath, "file", allowedFileLinks);
  if (path.stats.size < 1n || path.stats.size > BigInt(MAXIMUM_CONTROL_FILE_BYTES)) {
    throw fail("CONTROL_LIMIT_REACHED", "Ownership file exceeds its exact byte bound.");
  }
  const handle = await open(absolutePath, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!grandHallT554V3SameFileState(before, path.stats)) {
      throw fail("CONTROL_INVALID", "Ownership descriptor changed before reading.");
    }
    const bytes = await readExactly(handle, Number(before.size));
    const after = await handle.stat({ bigint: true });
    const pathAfter = await directNode(absolutePath, "file", allowedFileLinks);
    if (
      !grandHallT554V3SameFileState(before, after) ||
      !grandHallT554V3SameFileState(after, pathAfter.stats)
    ) {
      throw fail("CONTROL_INVALID", "Ownership descriptor changed during reading.");
    }
    return { ...pathAfter, bytes, fileSha256: sha256(bytes) };
  } finally {
    await handle.close();
  }
}

function parseCanonical(bytes: Buffer, label: string): unknown {
  const parsed = parseGrandHallT554StrictJson(bytes);
  if (!bytes.equals(canonicalBytes(parsed))) {
    throw fail("CONTROL_INVALID", `${label} is not canonical JSON plus LF.`);
  }
  return parsed;
}

function rootBindingMaterial(binding: RootBinding): z.infer<typeof RootBindingMaterialSchema> {
  const { bindingSha256: _bindingSha256, ...material } = binding;
  return material;
}

async function loadRootWitness(
  sessionRoot: string,
  expectedSessionScope: unknown,
): Promise<RootWitness> {
  const rootPath = resolvedRoot(sessionRoot);
  const expected = GrandHallT554NativeReviewSessionScopeV2Schema.safeParse(
    expectedSessionScope,
  );
  if (!expected.success) {
    throw fail("ARGUMENT_INVALID", "Expected session scope is invalid.", expected.error);
  }
  const root = await directNode(rootPath, "directory");
  const descriptor = await readExactFile(join(rootPath, "session-root.json"), 1n);
  if (descriptor.stats.dev !== root.stats.dev) {
    throw fail("ROOT_UNSAFE", "Session descriptor crosses the root filesystem boundary.");
  }
  const parsed = SessionRootDescriptorSchema.safeParse(
    parseCanonical(descriptor.bytes, "Session-root descriptor"),
  );
  if (!parsed.success || !canonicalEqual(parsed.data.sessionScope, expected.data)) {
    throw fail(
      "ROOT_UNSAFE",
      "Session-root descriptor does not match the expected session scope.",
      parsed.success ? undefined : parsed.error,
    );
  }
  const material = {
    schemaVersion: ROOT_BINDING_SCHEMA,
    sessionIdSha256: expected.data.sessionIdSha256,
    sessionScopeSha256: canonicalDigest(SESSION_SCOPE_DOMAIN, expected.data),
    sessionRootPathSha256: canonicalDigest(
      CONTROL_PATH_DOMAIN,
      grandHallT554V3ComparablePath(rootPath),
    ),
    sessionRootDevice: String(root.stats.dev),
    sessionRootInode: String(root.stats.ino),
    rootDescriptorDevice: String(descriptor.stats.dev),
    rootDescriptorInode: String(descriptor.stats.ino),
    rootDescriptorFileSha256: descriptor.fileSha256,
    rootDescriptorByteLength: descriptor.bytes.length,
  } as const;
  const binding = RootBindingSchema.parse({
    ...material,
    bindingSha256: canonicalDigest(ROOT_BINDING_DOMAIN, material),
  });
  const finalRoot = await directNode(rootPath, "directory");
  const finalDescriptor = await directNode(
    join(rootPath, "session-root.json"),
    "file",
    1n,
  );
  if (
    !grandHallT554V3SameFileState(root.stats, finalRoot.stats) ||
    !grandHallT554V3SameFileState(descriptor.stats, finalDescriptor.stats)
  ) {
    throw fail("ROOT_UNSAFE", "Session root changed while its exact binding was read.");
  }
  return {
    root: finalRoot,
    descriptor: { ...descriptor, stats: finalDescriptor.stats },
    sessionScope: expected.data,
    binding,
  };
}

function assertRootBindingEqual(actual: RootBinding, expected: RootBinding): void {
  if (
    !canonicalEqual(actual, expected) ||
    actual.bindingSha256 !==
      canonicalDigest(ROOT_BINDING_DOMAIN, rootBindingMaterial(actual))
  ) {
    throw fail("ROOT_UNSAFE", "Ownership control is bound to another session root.");
  }
}

function directorySyncUnsupported(error: unknown): boolean {
  const code = errnoCode(error);
  return (
    process.platform === "win32" &&
    (code === "EACCES" ||
      code === "EBADF" ||
      code === "EINVAL" ||
      code === "EISDIR" ||
      code === "EPERM")
  );
}

async function syncDirectory(absolutePath: string): Promise<void> {
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

// This protocol is process-crash recoverable. Node cannot provide a directory
// durability barrier on every supported Windows filesystem, so a successful
// call must not be represented as sudden-power-loss durable when directory
// fsync is unavailable.

async function writeRange(
  handle: FileHandle,
  bytes: Buffer,
  start: number,
  end: number,
): Promise<void> {
  let offset = start;
  while (offset < end) {
    const result = await handle.write(bytes, offset, end - offset, offset);
    if (result.bytesWritten < 1) {
      throw fail("CONTROL_INVALID", "Ownership record write made no progress.");
    }
    offset += result.bytesWritten;
  }
}

async function readStageFile(
  absolutePath: string,
  allowedFileLinks: bigint,
): Promise<ExactFile> {
  const path = await directNode(absolutePath, "file", allowedFileLinks);
  if (path.stats.size > BigInt(MAXIMUM_CONTROL_FILE_BYTES)) {
    throw fail("CONTROL_LIMIT_REACHED", "Ownership stage exceeds its exact byte bound.");
  }
  const handle = await open(absolutePath, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!grandHallT554V3SameFileState(before, path.stats)) {
      throw fail("CONTROL_INVALID", "Ownership stage changed before reading.");
    }
    const bytes = await readExactly(handle, Number(before.size));
    const after = await handle.stat({ bigint: true });
    const pathAfter = await directNode(absolutePath, "file", allowedFileLinks);
    if (
      !grandHallT554V3SameFileState(before, after) ||
      !grandHallT554V3SameFileState(after, pathAfter.stats)
    ) {
      throw fail("CONTROL_INVALID", "Ownership stage changed during reading.");
    }
    return { ...pathAfter, bytes, fileSha256: sha256(bytes) };
  } finally {
    await handle.close();
  }
}

interface StagedPublication {
  readonly info: OwnerStageSeamInfo;
  readonly stage: ExactFile;
  readonly canonical: ExactFile;
  readonly linkedByThisAttempt: boolean;
  readonly aliasesCanonical: boolean;
}

async function publishStagedFile(input: {
  readonly controlPath: string;
  readonly kind: StageKind;
  readonly canonicalPath: string;
  readonly bytes: Buffer;
  readonly seams: OwnerSeams;
}): Promise<StagedPublication> {
  const targetFileSha256 = sha256(input.bytes);
  const stagePath = join(
    input.controlPath,
    STAGING_DIRECTORY,
    `${input.kind}-sha256-${targetFileSha256.slice("sha256:".length)}-nonce-${stageNonceHex()}.stage`,
  );
  const info: OwnerStageSeamInfo = {
    kind: input.kind,
    stagePath,
    canonicalPath: input.canonicalPath,
    targetFileSha256,
  };
  let handle: FileHandle | undefined;
  try {
    handle = await open(stagePath, "wx", 0o600);
    await input.seams.afterStageCreated?.(info);
    const midpoint = Math.max(1, Math.floor(input.bytes.length / 2));
    await writeRange(handle, input.bytes, 0, midpoint);
    await input.seams.afterStagePartialWrite?.(info);
    await writeRange(handle, input.bytes, midpoint, input.bytes.length);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  const staged = await readStageFile(stagePath, 1n);
  if (!staged.bytes.equals(input.bytes) || staged.fileSha256 !== targetFileSha256) {
    throw fail("CONTROL_INVALID", "Ownership stage does not contain its exact intended bytes.");
  }
  await input.seams.afterStageFileSynced?.(info);

  let linkedByThisAttempt = false;
  try {
    await link(stagePath, input.canonicalPath);
    linkedByThisAttempt = true;
    await input.seams.afterCanonicalLinkedBeforeDirectorySync?.(info);
  } catch (error) {
    if (errnoCode(error) !== "EEXIST") throw error;
  }
  await syncDirectory(dirname(input.canonicalPath));
  const canonicalLinkCount = (await lstat(input.canonicalPath, { bigint: true })).nlink;
  if (canonicalLinkCount < 1n || canonicalLinkCount > 3n) {
    throw fail("ROOT_UNSAFE", "Canonical ownership publication has an unsafe hardlink count.");
  }
  const canonical = await readExactFile(input.canonicalPath, canonicalLinkCount);
  const stageLinkCount = (await lstat(stagePath, { bigint: true })).nlink;
  if (stageLinkCount < 1n || stageLinkCount > 3n) {
    throw fail("ROOT_UNSAFE", "Ownership stage has an unsafe hardlink count after publication.");
  }
  const finalStage = await readStageFile(stagePath, stageLinkCount);
  const aliasesCanonical = grandHallT554V3SameNode(finalStage.stats, canonical.stats);
  if (
    input.kind === "transition" &&
    (!canonical.bytes.equals(input.bytes) || canonical.fileSha256 !== targetFileSha256)
  ) {
    throw fail("CONTROL_INVALID", "Content-addressed ownership record path collided.");
  }
  if (linkedByThisAttempt && !aliasesCanonical) {
    throw fail("CONTROL_INVALID", "Ownership publication link did not retain its staged inode.");
  }
  return {
    info,
    stage: finalStage,
    canonical,
    linkedByThisAttempt,
    aliasesCanonical,
  };
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (errnoCode(error) !== "EEXIST") throw error;
  }
  await directNode(path, "directory");
}

async function ensureControl(
  root: RootWitness,
  seams: OwnerSeams,
): Promise<string> {
  const controlPath = deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(
    root.root.absolutePath,
  );
  const parent = await directNode(dirname(root.root.absolutePath), "directory");
  if (parent.stats.dev !== root.root.stats.dev) {
    throw fail("ROOT_UNSAFE", "Ownership control parent crosses the session filesystem.");
  }
  await ensureDirectory(controlPath);
  await Promise.all([
    ensureDirectory(join(controlPath, RECORDS_DIRECTORY)),
    ensureDirectory(join(controlPath, STAGING_DIRECTORY)),
    ensureDirectory(join(controlPath, TRANSITIONS_DIRECTORY)),
  ]);
  const descriptorPath = join(controlPath, CONTROL_FILE);
  const descriptor = {
    schemaVersion: CONTROL_DESCRIPTOR_SCHEMA,
    rootBinding: root.binding,
    createdAtUtc: nowUtc(),
  } as const;
  let descriptorExists = true;
  try {
    await lstat(descriptorPath, { bigint: true });
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    descriptorExists = false;
  }
  if (!descriptorExists) {
    await publishStagedFile({
      controlPath,
      kind: "control",
      canonicalPath: descriptorPath,
      bytes: canonicalBytes(descriptor),
      seams,
    });
    await syncDirectory(controlPath);
  }
  return controlPath;
}

function safeNames(names: readonly string[]): void {
  const folded = new Set<string>();
  for (const name of names) {
    if (
      name.normalize("NFC") !== name ||
      !/^[a-z0-9][a-z0-9._-]{0,254}$/u.test(name) ||
      name.includes("..") ||
      folded.has(name.toLowerCase())
    ) {
      throw fail("CONTROL_INVALID", "Ownership control contains an unsafe or colliding name.");
    }
    folded.add(name.toLowerCase());
  }
}

function parseTransition(bytes: Buffer, label: string): Transition {
  const result = TransitionSchema.safeParse(parseCanonical(bytes, label));
  if (!result.success) {
    throw fail("CONTROL_INVALID", `${label} has an invalid exact schema.`, result.error);
  }
  return result.data;
}

async function loadControlState(
  root: RootWitness,
  requirePresent = true,
): Promise<ControlState | null> {
  const controlPath = deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(
    root.root.absolutePath,
  );
  let controlDirectory: NodeWitness;
  try {
    controlDirectory = await directNode(controlPath, "directory");
  } catch (error) {
    if (!requirePresent && errnoCode(error) === "ENOENT") return null;
    throw error;
  }
  if (controlDirectory.stats.dev !== root.root.stats.dev) {
    throw fail("ROOT_UNSAFE", "Ownership control crosses the session filesystem.");
  }
  const rootEntries = await readdir(controlPath, { withFileTypes: true });
  const rootNames = rootEntries.map((entry) => entry.name).sort(lexicalOrder);
  safeNames(rootNames);
  if (
    rootNames.join("\n") !== [...CONTROL_NAMES].sort(lexicalOrder).join("\n") ||
    rootEntries.some(
      (entry) =>
        (entry.name === CONTROL_FILE && !entry.isFile()) ||
        (entry.name !== CONTROL_FILE && !entry.isDirectory()),
    )
  ) {
    throw fail("CONTROL_INVALID", "Ownership control does not have its exact fixed layout.");
  }
  const recordsDirectory = await directNode(join(controlPath, RECORDS_DIRECTORY), "directory");
  const stagingDirectory = await directNode(join(controlPath, STAGING_DIRECTORY), "directory");
  const transitionsDirectory = await directNode(
    join(controlPath, TRANSITIONS_DIRECTORY),
    "directory",
  );
  if (
    grandHallT554V3SameNode(controlDirectory.stats, recordsDirectory.stats) ||
    grandHallT554V3SameNode(controlDirectory.stats, stagingDirectory.stats) ||
    grandHallT554V3SameNode(controlDirectory.stats, transitionsDirectory.stats) ||
    recordsDirectory.stats.dev !== root.root.stats.dev ||
    stagingDirectory.stats.dev !== root.root.stats.dev ||
    transitionsDirectory.stats.dev !== root.root.stats.dev ||
    grandHallT554V3SameNode(recordsDirectory.stats, stagingDirectory.stats) ||
    grandHallT554V3SameNode(recordsDirectory.stats, transitionsDirectory.stats) ||
    grandHallT554V3SameNode(stagingDirectory.stats, transitionsDirectory.stats)
  ) {
    throw fail("ROOT_UNSAFE", "Ownership namespaces alias or cross filesystems.");
  }

  const stageDirents = await readdir(stagingDirectory.absolutePath, {
    withFileTypes: true,
  });
  const stageNames = stageDirents.map((entry) => entry.name).sort(lexicalOrder);
  safeNames(stageNames);
  if (stageNames.length > MAXIMUM_STAGE_COUNT) {
    throw fail("CONTROL_LIMIT_REACHED", "Ownership staging count exceeds its bound.");
  }
  if (stageDirents.some((entry) => !entry.isFile())) {
    throw fail("CONTROL_INVALID", "Ownership staging contains a non-file member.");
  }
  let totalBytes = 0;
  const countedNodes = new Set<string>();
  const countBytes = (file: ExactFile): void => {
    const identity = `${String(file.stats.dev)}:${String(file.stats.ino)}`;
    if (!countedNodes.has(identity)) {
      countedNodes.add(identity);
      totalBytes += file.bytes.length;
      if (totalBytes > MAXIMUM_CONTROL_TOTAL_BYTES) {
        throw fail("CONTROL_LIMIT_REACHED", "Ownership control bytes exceed their bound.");
      }
    }
  };
  const stages: StageEvidence[] = [];
  const stageNodes = new Set<string>();
  for (const name of stageNames) {
    const match = STAGE_FILE_PATTERN.exec(name);
    if (
      match === null ||
      (match[1] !== "control" && match[1] !== "transition") ||
      match[2] === undefined ||
      match[3] === undefined
    ) {
      throw fail("CONTROL_INVALID", "Ownership stage name is invalid.");
    }
    const stagePath = join(stagingDirectory.absolutePath, name);
    const stageLinkCount = (await lstat(stagePath, { bigint: true })).nlink;
    if (stageLinkCount < 1n || stageLinkCount > 3n) {
      throw fail("ROOT_UNSAFE", "Ownership stage has an unsafe hardlink count.");
    }
    const file = await readStageFile(stagePath, stageLinkCount);
    if (file.stats.dev !== root.root.stats.dev) {
      throw fail("ROOT_UNSAFE", "Ownership stage crosses the session filesystem.");
    }
    const identity = `${String(file.stats.dev)}:${String(file.stats.ino)}`;
    if (stageNodes.has(identity)) {
      throw fail("ROOT_UNSAFE", "Two ownership stage names alias one inode.");
    }
    stageNodes.add(identity);
    countBytes(file);
    const targetFileSha256: Sha256 = `sha256:${match[2]}`;
    const complete = file.fileSha256 === targetFileSha256;
    let transition: Transition | null = null;
    if (!complete) {
      if (file.stats.nlink !== 1n) {
        throw fail("ROOT_UNSAFE", "An incomplete stage aliases a canonical publication.");
      }
    } else if (match[1] === "control") {
      const result = ControlDescriptorSchema.safeParse(
        parseCanonical(file.bytes, "Staged ownership control descriptor"),
      );
      if (!result.success) {
        throw fail("CONTROL_INVALID", "Complete staged control bytes are invalid.", result.error);
      }
      assertRootBindingEqual(result.data.rootBinding, root.binding);
    } else {
      transition = parseTransition(file.bytes, "Staged ownership transition");
      if (
        transition.rootBindingSha256 !== root.binding.bindingSha256 ||
        transition.sessionIdSha256 !== root.binding.sessionIdSha256
      ) {
        throw fail("CONTROL_INVALID", "Staged ownership transition is bound elsewhere.");
      }
    }
    stages.push({
      kind: match[1],
      targetFileSha256,
      nonceHex: match[3],
      file,
      complete,
      transition,
    });
  }

  const controlPathname = join(controlPath, CONTROL_FILE);
  const controlLinkCount = (await lstat(controlPathname, { bigint: true })).nlink;
  if (controlLinkCount !== 1n && controlLinkCount !== 2n) {
    throw fail("ROOT_UNSAFE", "Ownership control descriptor has an unsafe hardlink count.");
  }
  const controlDescriptor = await readExactFile(controlPathname, controlLinkCount);
  countBytes(controlDescriptor);
  const parsedControl = ControlDescriptorSchema.safeParse(
    parseCanonical(controlDescriptor.bytes, "Ownership control descriptor"),
  );
  if (!parsedControl.success) {
    throw fail("CONTROL_INVALID", "Ownership control descriptor is invalid.", parsedControl.error);
  }
  assertRootBindingEqual(parsedControl.data.rootBinding, root.binding);
  const aliasedControlStages = stages.filter((stage) =>
    grandHallT554V3SameNode(stage.file.stats, controlDescriptor.stats)
  );
  if (
    (controlDescriptor.stats.nlink === 1n && aliasedControlStages.length !== 0) ||
    (controlDescriptor.stats.nlink === 2n &&
      (aliasedControlStages.length !== 1 || aliasedControlStages[0]?.kind !== "control" ||
        !aliasedControlStages[0].complete)) ||
    stages.some(
      (stage) =>
        stage.kind === "control" &&
        stage.file.stats.nlink > 1n &&
        !grandHallT554V3SameNode(stage.file.stats, controlDescriptor.stats),
    )
  ) {
    throw fail("ROOT_UNSAFE", "Ownership control staging topology is unexplained.");
  }

  const recordDirents = await readdir(recordsDirectory.absolutePath, {
    withFileTypes: true,
  });
  const transitionDirents = await readdir(transitionsDirectory.absolutePath, {
    withFileTypes: true,
  });
  const recordNames = recordDirents.map((entry) => entry.name).sort(lexicalOrder);
  const transitionNames = transitionDirents
    .map((entry) => entry.name)
    .sort(lexicalOrder);
  safeNames(recordNames);
  safeNames(transitionNames);
  if (
    recordNames.length > MAXIMUM_RECORD_COUNT ||
    transitionNames.length > MAXIMUM_TRANSITION_COUNT
  ) {
    throw fail("CONTROL_LIMIT_REACHED", "Ownership history count exceeds its bound.");
  }
  if (
    recordDirents.some((entry) => !entry.isFile()) ||
    transitionDirents.some((entry) => !entry.isFile())
  ) {
    throw fail("CONTROL_INVALID", "Ownership history contains a non-file member.");
  }

  const records = new Map<Sha256, RecordEvidence>();
  for (const name of recordNames) {
    const match = RECORD_FILE_PATTERN.exec(name);
    if (match === null || match[1] === undefined) {
      throw fail("CONTROL_INVALID", "Ownership record name is invalid.");
    }
    const recordPath = join(recordsDirectory.absolutePath, name);
    const recordLinkCount = (await lstat(recordPath, { bigint: true })).nlink;
    if (recordLinkCount < 1n || recordLinkCount > 3n) {
      throw fail("ROOT_UNSAFE", "Ownership record has an unsafe hardlink count.");
    }
    const file = await readExactFile(recordPath, recordLinkCount);
    if (file.stats.dev !== root.root.stats.dev) {
      throw fail("ROOT_UNSAFE", "Ownership record crosses the session filesystem.");
    }
    countBytes(file);
    if (file.fileSha256 !== `sha256:${match[1]}`) {
      throw fail("CONTROL_INVALID", "Ownership record filename digest is false.");
    }
    const transition = parseTransition(file.bytes, "Ownership transition record");
    if (
      transition.rootBindingSha256 !== root.binding.bindingSha256 ||
      transition.sessionIdSha256 !== root.binding.sessionIdSha256 ||
      records.has(file.fileSha256)
    ) {
      throw fail("CONTROL_INVALID", "Ownership record binding or uniqueness is invalid.");
    }
    records.set(file.fileSha256, { file, transition });
  }

  const transitions: TransitionEvidence[] = [];
  for (const [index, name] of transitionNames.entries()) {
    const match = TRANSITION_FILE_PATTERN.exec(name);
    const expectedSequence = index + 1;
    if (
      match === null ||
      match[1] === undefined ||
      Number(match[1]) !== expectedSequence
    ) {
      throw fail("CONTROL_INVALID", "Ownership transition sequence has a gap or invalid name.");
    }
    const headPath = join(transitionsDirectory.absolutePath, name);
    const headLinkCount = (await lstat(headPath, { bigint: true })).nlink;
    if (headLinkCount !== 2n && headLinkCount !== 3n) {
      throw fail("ROOT_UNSAFE", "Ownership transition has an unsafe hardlink count.");
    }
    const head = await readExactFile(headPath, headLinkCount);
    if (head.stats.dev !== root.root.stats.dev) {
      throw fail("ROOT_UNSAFE", "Ownership transition crosses the session filesystem.");
    }
    countBytes(head);
    const record = records.get(head.fileSha256);
    if (
      record === undefined ||
      record.transition.transitionSequence !== expectedSequence ||
      !grandHallT554V3SameNode(head.stats, record.file.stats)
    ) {
      throw fail("CONTROL_INVALID", "Ownership transition head is not its exact record alias.");
    }
    transitions.push({
      transition: record.transition,
      bytes: head.bytes,
      fileSha256: head.fileSha256,
      head,
      record: record.file,
    });
  }

  const published = new Set(transitions.map((transition) => transition.fileSha256));
  for (const [fileSha256, record] of records) {
    const aliasedStages = stages.filter(
      (stage) =>
        stage.kind === "transition" &&
        stage.complete &&
        stage.targetFileSha256 === fileSha256 &&
        grandHallT554V3SameNode(stage.file.stats, record.file.stats),
    );
    const expectedLinks = published.has(fileSha256)
      ? BigInt(2 + aliasedStages.length)
      : BigInt(1 + aliasedStages.length);
    if (
      aliasedStages.length > 1 ||
      (!published.has(fileSha256) && aliasedStages.length !== 1) ||
      record.file.stats.nlink !== expectedLinks
    ) {
      throw fail("ROOT_UNSAFE", "Ownership record has an unexplained hardlink alias.");
    }
  }
  for (const stage of stages) {
    if (!stage.complete) continue;
    if (stage.kind === "control") {
      if (
        stage.file.stats.nlink !== 1n &&
        !grandHallT554V3SameNode(stage.file.stats, controlDescriptor.stats)
      ) {
        throw fail("ROOT_UNSAFE", "Complete control stage has an unexplained alias.");
      }
      continue;
    }
    const record = records.get(stage.targetFileSha256);
    const aliasesRecord =
      record !== undefined && grandHallT554V3SameNode(stage.file.stats, record.file.stats);
    const aliasedHeads = transitions.filter((transition) =>
      grandHallT554V3SameNode(stage.file.stats, transition.head.stats)
    );
    if (
      (stage.file.stats.nlink === 1n && (aliasesRecord || aliasedHeads.length !== 0)) ||
      (stage.file.stats.nlink === 2n && (!aliasesRecord || aliasedHeads.length !== 0)) ||
      (stage.file.stats.nlink === 3n && (!aliasesRecord || aliasedHeads.length !== 1))
    ) {
      throw fail("ROOT_UNSAFE", "Transition staging topology is unexplained.");
    }
  }

  let currentOwner: TransitionEvidence | null = null;
  let lastOwner: TransitionEvidence | null = null;
  let predecessorFileSha256: Sha256 | null = null;
  for (const evidence of transitions) {
    const transition = evidence.transition;
    if (transition.predecessorTransitionFileSha256 !== predecessorFileSha256) {
      throw fail("CONTROL_INVALID", "Ownership transition predecessor chain is broken.");
    }
    if (transition.transitionKind === "owner_acquired") {
      const expectedPrior = transition.acquisitionKind === "explicit_crash_takeover"
        ? currentOwner
        : lastOwner;
      const validState = transition.acquisitionKind === "initial"
        ? transition.transitionSequence === 1 &&
          currentOwner === null &&
          lastOwner === null &&
          transition.priorOwner === null
        : transition.acquisitionKind === "post_release"
          ? currentOwner === null &&
            lastOwner !== null &&
            transition.priorOwner !== null
          : currentOwner !== null && transition.priorOwner !== null;
      if (!validState) {
        throw fail("CONTROL_INVALID", "Ownership acquisition state transition is impossible.");
      }
      if (transition.priorOwner !== null) {
        if (
          expectedPrior === null ||
          transition.priorOwner.transitionSequence !==
            expectedPrior.transition.transitionSequence ||
          transition.priorOwner.transitionFileSha256 !== expectedPrior.fileSha256 ||
          transition.priorOwner.ownerNonceSha256 !==
            (expectedPrior.transition.transitionKind === "owner_acquired"
              ? expectedPrior.transition.ownerNonceSha256
              : "") ||
          transition.priorOwner.transitionHeadDevice !== String(expectedPrior.head.stats.dev) ||
          transition.priorOwner.transitionHeadInode !== String(expectedPrior.head.stats.ino)
        ) {
          throw fail("CONTROL_INVALID", "Ownership acquisition prior-owner receipt is false.");
        }
      }
      currentOwner = evidence;
      lastOwner = evidence;
    } else {
      if (
        currentOwner === null ||
        currentOwner.transition.transitionKind !== "owner_acquired" ||
        transition.releasedOwner.transitionSequence !==
          currentOwner.transition.transitionSequence ||
        transition.releasedOwner.transitionFileSha256 !== currentOwner.fileSha256 ||
        transition.releasedOwner.ownerNonceSha256 !==
          currentOwner.transition.ownerNonceSha256 ||
        transition.releasedOwner.transitionHeadDevice !== String(currentOwner.head.stats.dev) ||
        transition.releasedOwner.transitionHeadInode !== String(currentOwner.head.stats.ino)
      ) {
        throw fail("CONTROL_INVALID", "Ownership release receipt is false.");
      }
      currentOwner = null;
    }
    predecessorFileSha256 = evidence.fileSha256;
  }
  const finalControl = await directNode(controlPath, "directory");
  const finalRecords = await directNode(recordsDirectory.absolutePath, "directory");
  const finalStaging = await directNode(stagingDirectory.absolutePath, "directory");
  const finalTransitions = await directNode(
    transitionsDirectory.absolutePath,
    "directory",
  );
  if (
    !grandHallT554V3SameFileState(controlDirectory.stats, finalControl.stats) ||
    !grandHallT554V3SameFileState(recordsDirectory.stats, finalRecords.stats) ||
    !grandHallT554V3SameFileState(stagingDirectory.stats, finalStaging.stats) ||
    !grandHallT554V3SameFileState(
      transitionsDirectory.stats,
      finalTransitions.stats,
    )
  ) {
    throw fail("CONTROL_INVALID", "Ownership control changed during exact replay.");
  }
  return {
    controlDirectory,
    controlDescriptor,
    recordsDirectory,
    stagingDirectory,
    transitionsDirectory,
    root,
    transitions,
    records,
    stages,
    publishedRecordSha256s: published,
    headRevision: transitions.length,
    headFileSha256: predecessorFileSha256,
    currentOwner,
    lastOwner,
  };
}

function priorOwnerReceipt(owner: TransitionEvidence): z.infer<typeof PriorOwnerReceiptSchema> {
  if (owner.transition.transitionKind !== "owner_acquired") {
    throw fail("CONTROL_INVALID", "Prior-owner receipt requires an owner transition.");
  }
  return {
    transitionSequence: owner.transition.transitionSequence,
    transitionFileSha256: owner.fileSha256,
    ownerNonceSha256: owner.transition.ownerNonceSha256,
    transitionHeadDevice: String(owner.head.stats.dev),
    transitionHeadInode: String(owner.head.stats.ino),
  };
}

function stageCanonicalPath(state: ControlState, stage: StageEvidence): string {
  return stage.kind === "control"
    ? join(state.controlDirectory.absolutePath, CONTROL_FILE)
    : join(
        state.recordsDirectory.absolutePath,
        `transition-sha256-${stage.targetFileSha256.slice("sha256:".length)}.json`,
      );
}

function assertNamespaceIdentityEqual(
  actual: ControlState,
  expected: ControlState,
): void {
  if (
    !grandHallT554V3SameNode(actual.root.root.stats, expected.root.root.stats) ||
    !grandHallT554V3SameFileState(
      actual.root.descriptor.stats,
      expected.root.descriptor.stats,
    ) ||
    !actual.root.descriptor.bytes.equals(expected.root.descriptor.bytes) ||
    !grandHallT554V3SameNode(actual.controlDirectory.stats, expected.controlDirectory.stats) ||
    !grandHallT554V3SameNode(actual.recordsDirectory.stats, expected.recordsDirectory.stats) ||
    !grandHallT554V3SameNode(actual.stagingDirectory.stats, expected.stagingDirectory.stats) ||
    !grandHallT554V3SameNode(
      actual.transitionsDirectory.stats,
      expected.transitionsDirectory.stats,
    ) ||
    !grandHallT554V3SameNode(
      actual.controlDescriptor.stats,
      expected.controlDescriptor.stats,
    ) ||
    !actual.controlDescriptor.bytes.equals(expected.controlDescriptor.bytes)
  ) {
    throw fail("RACE_LOST", "Session root or ownership namespace identity was replaced.");
  }
}

async function refreshControlState(
  expected: ControlState,
  options: { readonly requireSameHead: boolean },
): Promise<ControlState> {
  const root = await loadRootWitness(
    expected.root.root.absolutePath,
    expected.root.sessionScope,
  );
  if (root.binding.bindingSha256 !== expected.root.binding.bindingSha256) {
    throw fail("RACE_LOST", "Session root binding changed during ownership publication.");
  }
  const actual = await loadControlState(root);
  if (actual === null) {
    throw fail("RACE_LOST", "Ownership control disappeared during publication.");
  }
  assertNamespaceIdentityEqual(actual, expected);
  if (
    options.requireSameHead &&
    (actual.headRevision !== expected.headRevision ||
      actual.headFileSha256 !== expected.headFileSha256)
  ) {
    throw fail("RACE_LOST", "Ownership chain head changed during publication.");
  }
  return actual;
}

async function removeExactStage(
  state: ControlState,
  stage: StageEvidence,
  seams: OwnerSeams,
): Promise<void> {
  const info: OwnerStageSeamInfo = {
    kind: stage.kind,
    stagePath: stage.file.absolutePath,
    canonicalPath: stageCanonicalPath(state, stage),
    targetFileSha256: stage.targetFileSha256,
  };
  await seams.beforeStageCleanup?.(info);
  const currentLinkCount = (await lstat(stage.file.absolutePath, { bigint: true })).nlink;
  const current = await readStageFile(stage.file.absolutePath, currentLinkCount);
  if (!grandHallT554V3SameFileState(current.stats, stage.file.stats)) {
    throw fail("RACE_LOST", "Ownership stage was replaced before exact cleanup.");
  }
  await unlink(stage.file.absolutePath);
  await syncDirectory(state.stagingDirectory.absolutePath);
}

async function recoverStagingResidues(
  initialState: ControlState,
  seams: OwnerSeams,
): Promise<ControlState> {
  let state = initialState;
  for (const originalStage of initialState.stages) {
    state = await refreshControlState(state, { requireSameHead: true });
    const stage = state.stages.find(
      (candidate) =>
        candidate.file.absolutePath === originalStage.file.absolutePath &&
        grandHallT554V3SameNode(candidate.file.stats, originalStage.file.stats),
    );
    if (stage === undefined) continue;
    if (!stage.complete || stage.kind === "control") {
      await removeExactStage(state, stage, seams);
      continue;
    }
    const record = state.records.get(stage.targetFileSha256);
    if (stage.file.stats.nlink === 1n && record === undefined) {
      const canonicalPath = stageCanonicalPath(state, stage);
      const info: OwnerStageSeamInfo = {
        kind: stage.kind,
        stagePath: stage.file.absolutePath,
        canonicalPath,
        targetFileSha256: stage.targetFileSha256,
      };
      try {
        await link(stage.file.absolutePath, canonicalPath);
        await seams.afterCanonicalLinkedBeforeDirectorySync?.(info);
      } catch (error) {
        if (errnoCode(error) !== "EEXIST") throw error;
      }
      await syncDirectory(state.recordsDirectory.absolutePath);
      continue;
    }
    if (
      stage.file.stats.nlink === 1n ||
      (stage.file.stats.nlink === 3n &&
        state.publishedRecordSha256s.has(stage.targetFileSha256))
    ) {
      await removeExactStage(state, stage, seams);
    }
  }
  return await refreshControlState(state, { requireSameHead: true });
}

async function publishTransition(
  state: ControlState,
  transition: Transition,
  seams: OwnerSeams,
): Promise<TransitionEvidence> {
  const bytes = canonicalBytes(transition);
  const fileSha256 = sha256(bytes);
  let current = await refreshControlState(state, { requireSameHead: true });
  const recordPath = join(
    current.recordsDirectory.absolutePath,
    `transition-sha256-${fileSha256.slice("sha256:".length)}.json`,
  );
  let headPath = join(
    current.transitionsDirectory.absolutePath,
    `${String(transition.transitionSequence).padStart(16, "0")}.json`,
  );
  const staged = await publishStagedFile({
    controlPath: current.controlDirectory.absolutePath,
    kind: "transition",
    canonicalPath: recordPath,
    bytes,
    seams,
  });
  current = await refreshControlState(current, { requireSameHead: true });
  const exactRecord = current.records.get(fileSha256);
  if (
    exactRecord === undefined ||
    !exactRecord.file.bytes.equals(bytes) ||
    exactRecord.transition.transitionSequence !== transition.transitionSequence
  ) {
    throw fail("RACE_LOST", "Staged ownership record did not remain exact.");
  }
  await seams.afterRecordDurable?.(recordPath);
  await seams.beforeTransitionPublish?.(headPath);
  current = await refreshControlState(current, { requireSameHead: true });
  const currentRecord = current.records.get(fileSha256);
  if (currentRecord === undefined || !currentRecord.file.bytes.equals(bytes)) {
    throw fail("RACE_LOST", "Ownership record changed before transition publication.");
  }
  headPath = join(
    current.transitionsDirectory.absolutePath,
    `${String(transition.transitionSequence).padStart(16, "0")}.json`,
  );
  try {
    await link(currentRecord.file.absolutePath, headPath);
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw fail("RACE_LOST", "Another process won the ownership transition slot.");
    }
    throw error;
  }
  await syncDirectory(current.transitionsDirectory.absolutePath);
  await seams.afterTransitionPublished?.(headPath);
  let refreshed = await refreshControlState(current, { requireSameHead: false });
  let published = refreshed.transitions[transition.transitionSequence - 1];
  if (
    published === undefined ||
    published.fileSha256 !== fileSha256 ||
    !canonicalEqual(published.transition, transition)
  ) {
    throw fail("RACE_LOST", "Published ownership transition did not remain exact.");
  }
  const publishedStage = refreshed.stages.find(
    (candidate) => candidate.file.absolutePath === staged.stage.absolutePath,
  );
  if (publishedStage !== undefined) {
    await removeExactStage(refreshed, publishedStage, seams);
    refreshed = await refreshControlState(refreshed, { requireSameHead: true });
    published = refreshed.transitions[transition.transitionSequence - 1];
    if (
      published === undefined ||
      published.fileSha256 !== fileSha256 ||
      !canonicalEqual(published.transition, transition)
    ) {
      throw fail("RACE_LOST", "Ownership transition changed during stage cleanup.");
    }
  }
  return published;
}

function leaseFromOwner(
  state: ControlState,
  owner: TransitionEvidence,
): GrandHallT554NativeReviewSessionOwnerLeaseV2 {
  if (owner.transition.transitionKind !== "owner_acquired") {
    throw fail("CONTROL_INVALID", "Cannot issue a lease for a non-owner transition.");
  }
  const lease = Object.freeze({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_SESSION_OWNER_LEASE_V2,
    sessionRoot: state.root.root.absolutePath,
    sessionIdSha256: state.root.binding.sessionIdSha256,
    rootBindingSha256: state.root.binding.bindingSha256,
    ownerNonceSha256: owner.transition.ownerNonceSha256,
    transitionSequence: owner.transition.transitionSequence,
    transitionFileSha256: owner.fileSha256,
  });
  leaseInternals.set(lease, {
    sessionRoot: state.root.root.absolutePath,
    expectedSessionScope: state.root.sessionScope,
    owner,
    controlDirectory: state.controlDirectory,
    controlDescriptor: state.controlDescriptor,
    released: false,
  });
  return lease;
}

async function assertLeaseInternal(
  lease: GrandHallT554NativeReviewSessionOwnerLeaseV2,
  sessionRoot: string,
  expectedSessionScope: unknown,
): Promise<{ readonly state: ControlState; readonly internal: LeaseInternal }> {
  const internal = leaseInternals.get(lease);
  if (internal === undefined) {
    throw fail("ARGUMENT_INVALID", "Session owner lease is not branded by this process.");
  }
  if (
    internal.released ||
    resolvedRoot(sessionRoot) !== internal.sessionRoot ||
    !canonicalEqual(expectedSessionScope, internal.expectedSessionScope)
  ) {
    throw fail("STALE_LEASE", "Session owner lease is released or bound elsewhere.");
  }
  const root = await loadRootWitness(sessionRoot, expectedSessionScope);
  if (root.binding.bindingSha256 !== lease.rootBindingSha256) {
    throw fail("STALE_LEASE", "Session root binding changed after lease acquisition.");
  }
  const state = await loadControlState(root);
  if (state === null) {
    throw fail("STALE_LEASE", "Session ownership control disappeared.");
  }
  const owner = state.currentOwner;
  if (
    owner === null ||
    owner.transition.transitionKind !== "owner_acquired" ||
    owner.fileSha256 !== lease.transitionFileSha256 ||
    owner.transition.ownerNonceSha256 !== lease.ownerNonceSha256 ||
    owner.transition.transitionSequence !== lease.transitionSequence ||
    !grandHallT554V3SameNode(
      state.controlDirectory.stats,
      internal.controlDirectory.stats,
    ) ||
    !grandHallT554V3SameNode(
      state.controlDescriptor.stats,
      internal.controlDescriptor.stats,
    ) ||
    !state.controlDescriptor.bytes.equals(internal.controlDescriptor.bytes) ||
    !grandHallT554V3SameNode(owner.head.stats, internal.owner.head.stats) ||
    !owner.bytes.equals(internal.owner.bytes)
  ) {
    throw fail("STALE_LEASE", "Session owner lease no longer owns the control chain head.");
  }
  return { state, internal };
}

async function acquire(
  input: {
    readonly sessionRoot: string;
    readonly expectedSessionScope: unknown;
  },
  seams: OwnerSeams,
): Promise<GrandHallT554NativeReviewSessionOwnerLeaseV2> {
  let root = await loadRootWitness(input.sessionRoot, input.expectedSessionScope);
  await ensureControl(root, seams);
  const refreshedRoot = await loadRootWitness(input.sessionRoot, input.expectedSessionScope);
  if (
    refreshedRoot.binding.bindingSha256 !== root.binding.bindingSha256 ||
    !grandHallT554V3SameNode(refreshedRoot.root.stats, root.root.stats) ||
    !grandHallT554V3SameFileState(
      refreshedRoot.descriptor.stats,
      root.descriptor.stats,
    )
  ) {
    throw fail("RACE_LOST", "Session root changed while ownership control was initialized.");
  }
  root = refreshedRoot;
  let state = await loadControlState(root);
  if (state === null) throw fail("CONTROL_INVALID", "Ownership control disappeared.");
  state = await recoverStagingResidues(state, seams);
  if (state.currentOwner !== null) {
    throw fail("ALREADY_OWNED", "Session root already has an active owner.");
  }
  const sequence = state.headRevision + 1;
  if (sequence > MAXIMUM_TRANSITION_COUNT) {
    throw fail("CONTROL_LIMIT_REACHED", "Ownership transition capacity is exhausted.");
  }
  const transition = OwnerTransitionSchema.parse({
    schemaVersion: OWNER_TRANSITION_SCHEMA,
    transitionKind: "owner_acquired",
    transitionSequence: sequence,
    predecessorTransitionFileSha256: state.headFileSha256,
    rootBindingSha256: root.binding.bindingSha256,
    sessionIdSha256: root.binding.sessionIdSha256,
    acquisitionKind: sequence === 1 ? "initial" : "post_release",
    ownerNonceSha256: ownerNonce(),
    priorOwner: state.lastOwner === null ? null : priorOwnerReceipt(state.lastOwner),
    recordedAtUtc: nowUtc(),
  });
  const owner = await publishTransition(state, transition, seams);
  const finalState = await refreshControlState(state, { requireSameHead: false });
  if (finalState.currentOwner?.fileSha256 !== owner.fileSha256) {
    throw fail("RACE_LOST", "Acquired owner was superseded before lease issue.");
  }
  return leaseFromOwner(finalState, owner);
}

export function acquireGrandHallT554NativeReviewSessionOwnerV2(input: {
  readonly sessionRoot: string;
  readonly expectedSessionScope: unknown;
}): Promise<GrandHallT554NativeReviewSessionOwnerLeaseV2> {
  return acquire(input, {});
}

export async function inspectGrandHallT554NativeReviewPriorOwnerV2(input: {
  readonly sessionRoot: string;
  readonly expectedSessionScope: unknown;
}): Promise<GrandHallT554NativeReviewPriorOwnerWitnessV2 | null> {
  const root = await loadRootWitness(input.sessionRoot, input.expectedSessionScope);
  const state = await loadControlState(root, false);
  const owner = state?.currentOwner;
  if (state === null || owner === undefined || owner === null) return null;
  if (owner.transition.transitionKind !== "owner_acquired") {
    throw fail("CONTROL_INVALID", "Current ownership state is not an owner transition.");
  }
  const witness = Object.freeze({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_PRIOR_OWNER_WITNESS_V2,
    sessionRoot: root.root.absolutePath,
    sessionIdSha256: root.binding.sessionIdSha256,
    rootBindingSha256: root.binding.bindingSha256,
    ownerNonceSha256: owner.transition.ownerNonceSha256,
    transitionSequence: owner.transition.transitionSequence,
    transitionFileSha256: owner.fileSha256,
  });
  witnessInternals.set(witness, {
    sessionRoot: root.root.absolutePath,
    expectedSessionScope: root.sessionScope,
    owner,
    controlDirectory: state.controlDirectory,
    controlDescriptor: state.controlDescriptor,
  });
  return witness;
}

async function takeOver(
  input: {
    readonly sessionRoot: string;
    readonly expectedSessionScope: unknown;
    readonly priorOwnerWitness: GrandHallT554NativeReviewPriorOwnerWitnessV2;
  },
  seams: OwnerSeams,
): Promise<GrandHallT554NativeReviewSessionOwnerLeaseV2> {
  const witnessed = witnessInternals.get(input.priorOwnerWitness);
  if (witnessed === undefined) {
    throw fail("ARGUMENT_INVALID", "Prior-owner witness is not branded by exact inspection.");
  }
  if (
    resolvedRoot(input.sessionRoot) !== witnessed.sessionRoot ||
    !canonicalEqual(input.expectedSessionScope, witnessed.expectedSessionScope)
  ) {
    throw fail("STALE_WITNESS", "Prior-owner witness belongs to another session root.");
  }
  const root = await loadRootWitness(input.sessionRoot, input.expectedSessionScope);
  let state = await loadControlState(root);
  if (state === null) {
    throw fail("STALE_WITNESS", "Session ownership control disappeared.");
  }
  const prior = state.currentOwner;
  if (
    prior === null ||
    prior.transition.transitionKind !== "owner_acquired" ||
    prior.fileSha256 !== input.priorOwnerWitness.transitionFileSha256 ||
    prior.transition.ownerNonceSha256 !== input.priorOwnerWitness.ownerNonceSha256 ||
    !grandHallT554V3SameNode(
      state.controlDirectory.stats,
      witnessed.controlDirectory.stats,
    ) ||
    !grandHallT554V3SameNode(
      state.controlDescriptor.stats,
      witnessed.controlDescriptor.stats,
    ) ||
    !state.controlDescriptor.bytes.equals(witnessed.controlDescriptor.bytes) ||
    !grandHallT554V3SameNode(prior.head.stats, witnessed.owner.head.stats) ||
    !prior.bytes.equals(witnessed.owner.bytes)
  ) {
    throw fail("STALE_WITNESS", "Prior-owner witness is no longer the exact active owner.");
  }
  state = await recoverStagingResidues(state, seams);
  const recoveredPrior = state.currentOwner;
  if (
    recoveredPrior === null ||
    recoveredPrior.fileSha256 !== prior.fileSha256 ||
    !grandHallT554V3SameNode(recoveredPrior.head.stats, prior.head.stats) ||
    !recoveredPrior.bytes.equals(prior.bytes)
  ) {
    throw fail("STALE_WITNESS", "Prior owner changed during staging recovery.");
  }
  const sequence = state.headRevision + 1;
  if (sequence > MAXIMUM_TRANSITION_COUNT) {
    throw fail("CONTROL_LIMIT_REACHED", "Ownership transition capacity is exhausted.");
  }
  const transition = OwnerTransitionSchema.parse({
    schemaVersion: OWNER_TRANSITION_SCHEMA,
    transitionKind: "owner_acquired",
    transitionSequence: sequence,
    predecessorTransitionFileSha256: state.headFileSha256,
    rootBindingSha256: root.binding.bindingSha256,
    sessionIdSha256: root.binding.sessionIdSha256,
    acquisitionKind: "explicit_crash_takeover",
    ownerNonceSha256: ownerNonce(),
    priorOwner: priorOwnerReceipt(recoveredPrior),
    recordedAtUtc: nowUtc(),
  });
  const owner = await publishTransition(state, transition, seams);
  const finalState = await refreshControlState(state, { requireSameHead: false });
  if (finalState.currentOwner?.fileSha256 !== owner.fileSha256) {
    throw fail("RACE_LOST", "Takeover owner was superseded before lease issue.");
  }
  return leaseFromOwner(finalState, owner);
}

/**
 * Explicit takeover is valid only after an operator has confirmed that the
 * predecessor process cannot execute again. The exact witness prevents stale
 * or cloned takeovers; it is deliberately not a PID- or elapsed-time liveness
 * oracle and cannot fence a predecessor that is still running.
 */
export function explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2(input: {
  readonly sessionRoot: string;
  readonly expectedSessionScope: unknown;
  readonly priorOwnerWitness: GrandHallT554NativeReviewPriorOwnerWitnessV2;
}): Promise<GrandHallT554NativeReviewSessionOwnerLeaseV2> {
  return takeOver(input, {});
}

export async function assertGrandHallT554NativeReviewSessionOwnerV2(input: {
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly sessionRoot: string;
  readonly expectedSessionScope: unknown;
}): Promise<void> {
  await assertLeaseInternal(
    input.lease,
    input.sessionRoot,
    input.expectedSessionScope,
  );
}

async function release(
  input: {
    readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
    readonly sessionRoot: string;
    readonly expectedSessionScope: unknown;
  },
  seams: OwnerSeams,
): Promise<void> {
  const initial = await assertLeaseInternal(
    input.lease,
    input.sessionRoot,
    input.expectedSessionScope,
  );
  await recoverStagingResidues(initial.state, seams);
  const { state, internal } = await assertLeaseInternal(
    input.lease,
    input.sessionRoot,
    input.expectedSessionScope,
  );
  const owner = state.currentOwner;
  if (owner === null || owner.transition.transitionKind !== "owner_acquired") {
    throw fail("STALE_LEASE", "Release requires the exact active owner.");
  }
  const sequence = state.headRevision + 1;
  if (sequence > MAXIMUM_TRANSITION_COUNT) {
    throw fail("CONTROL_LIMIT_REACHED", "Ownership transition capacity is exhausted.");
  }
  const transition = ReleaseTransitionSchema.parse({
    schemaVersion: RELEASE_TRANSITION_SCHEMA,
    transitionKind: "owner_released",
    transitionSequence: sequence,
    predecessorTransitionFileSha256: state.headFileSha256,
    rootBindingSha256: state.root.binding.bindingSha256,
    sessionIdSha256: state.root.binding.sessionIdSha256,
    releasedOwner: priorOwnerReceipt(owner),
    recordedAtUtc: nowUtc(),
  });
  const published = await publishTransition(state, transition, seams);
  let finalState = await refreshControlState(state, { requireSameHead: false });
  if (
    finalState.currentOwner !== null ||
    finalState.headFileSha256 !== published.fileSha256
  ) {
    throw fail("RACE_LOST", "Release did not remain the exact control-chain head.");
  }
  finalState = await refreshControlState(finalState, { requireSameHead: true });
  if (
    !grandHallT554V3SameNode(
      finalState.controlDirectory.stats,
      internal.controlDirectory.stats,
    ) ||
    !grandHallT554V3SameNode(
      finalState.controlDescriptor.stats,
      internal.controlDescriptor.stats,
    ) ||
    !finalState.controlDescriptor.bytes.equals(internal.controlDescriptor.bytes)
  ) {
    throw fail("RACE_LOST", "Release ownership namespace changed before lease retirement.");
  }
  internal.released = true;
}

export function releaseGrandHallT554NativeReviewSessionOwnerV2(input: {
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly sessionRoot: string;
  readonly expectedSessionScope: unknown;
}): Promise<void> {
  return release(input, {});
}

export const __testOnlyGrandHallT554NativeReviewSessionOwnerV2 = /* @__PURE__ */ Object.freeze(
  {
    acquire,
    takeOver,
    release,
  },
);

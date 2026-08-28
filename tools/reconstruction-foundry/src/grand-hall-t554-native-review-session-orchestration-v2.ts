import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";

import type {
  GrandHallT554NativeReviewCoordinatorReplayV2,
} from "./grand-hall-t554-native-review-coordinator-replay-v2.js";
import {
  createGrandHallT554NativeReviewDurableJournalV2,
  deriveGrandHallT554NativeReviewLowLevelScopeV2,
  openGrandHallT554NativeReviewDurableJournalV2,
  openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2,
  type GrandHallT554NativeReviewDurableJournalReplayV2,
  type GrandHallT554NativeReviewDurableJournalV2,
  type GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2,
  type GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2,
} from "./grand-hall-t554-native-review-durable-journal-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_DOMAIN,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_SCHEMA,
} from "./grand-hall-t554-native-review-journal.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
  GrandHallT554NativeReviewCanonicalUtcV2Schema,
  GrandHallT554NativeReviewMaskScopeV2Schema,
  GrandHallT554NativeReviewSha256V2Schema,
  type GrandHallT554NativeReviewCoordinatorEventV2,
  type GrandHallT554NativeReviewMaskChildEventV2,
  type GrandHallT554NativeReviewMaskCoverageCarryStateV2,
  type GrandHallT554NativeReviewMaskScopeV2,
  type GrandHallT554NativeReviewSessionScopeV2,
} from "./grand-hall-t554-native-review-events-v2.js";
import {
  assertGrandHallT554NativeReviewSessionOwnerV2,
  type GrandHallT554NativeReviewSessionOwnerLeaseV2,
} from "./grand-hall-t554-native-review-session-owner-v2.js";
import {
  openGrandHallT554NativeReviewSessionStoreV2,
  type GrandHallT554NativeReviewSessionStoreReplayV2,
} from "./grand-hall-t554-native-review-session-store-v2.js";

const CHILD_SCOPE_DESCRIPTOR_SCHEMA =
  "venviewer.grand-hall-t554-native-review-child-scope-descriptor.v2";
const MASK_CHILD_STAGE_SCHEMA =
  "venviewer.grand-hall-t554-native-review-mask-child-stage.v2";
const MASK_CHILD_STAGE_BINDING_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_MASK_CHILD_STAGE_BINDING_V2\n";
const MASK_CHILD_STAGE_TARGET_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_MASK_CHILD_STAGE_TARGET_V2\n";
const JOURNAL_SCOPE_FILE_NAME = "scope.json";
const JOURNAL_CLAIMS_DIRECTORY_NAME = "claims";
const JOURNAL_EVENTS_DIRECTORY_NAME = "events";
const JOURNAL_PENDING_DIRECTORY_NAME = "pending";
const JOURNAL_QUARANTINE_DIRECTORY_NAME = "quarantine";
const JOURNAL_ROOT_NAMES = [
  JOURNAL_CLAIMS_DIRECTORY_NAME,
  JOURNAL_EVENTS_DIRECTORY_NAME,
  JOURNAL_PENDING_DIRECTORY_NAME,
  JOURNAL_QUARANTINE_DIRECTORY_NAME,
  JOURNAL_SCOPE_FILE_NAME,
] as const;
const MASK_CHILD_FULL_STAGE_NAMES = [
  "child",
  "descriptor.json",
  "operation.json",
] as const;
const MASK_CHILD_DESCRIPTOR_STAGE_NAMES = [
  "descriptor.json",
  "operation.json",
] as const;
const FIRST_CLAIM_FILE_NAME = "0000000000000001.json";
const FIRST_EVENT_FILE_PATTERN =
  /^0000000000000001-sha256-[0-9a-f]{64}\.json$/u;
const MAXIMUM_STAGED_JOURNAL_FILE_BYTES = 8 * 1_024 * 1_024;
const SAFE_MEMBER_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,254}$/u;

type Sha256 = `sha256:${string}`;
type PendingIntent =
  GrandHallT554NativeReviewCoordinatorReplayV2["pendingIntent"];
export type GrandHallT554NativeReviewPendingIntentEventV2 = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  {
    readonly eventType:
      | "source.selection-intended.v2"
      | "mask.freeze-intended.v2"
      | "coverage.segment-resume-intended.v2";
  }
>;

export class GrandHallT554NativeReviewSessionOrchestrationV2Error extends Error {
  constructor(
    readonly code:
      | "ARGUMENT_INVALID"
      | "PENDING_INTENT_MISMATCH"
      | "ACTIVE_CHILD_MISMATCH"
      | "CHILD_PUBLICATION_INVALID"
      | "BROWSER_EPOCH_INVALID",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewSessionOrchestrationV2Error";
  }
}

function fail(
  code: GrandHallT554NativeReviewSessionOrchestrationV2Error["code"],
  message: string,
  cause?: unknown,
): GrandHallT554NativeReviewSessionOrchestrationV2Error {
  return new GrandHallT554NativeReviewSessionOrchestrationV2Error(
    code,
    message,
    cause,
  );
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

function lowLevelScopeFileBytes(
  scope: GrandHallT554NativeReviewMaskScopeV2,
): Buffer {
  const material = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_SCHEMA,
    scope: deriveGrandHallT554NativeReviewLowLevelScopeV2(scope),
  };
  const scopeSha256 =
    `sha256:${domainSeparatedSha256(
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_DOMAIN,
      toCanonicalJson(material),
    )}`;
  return canonicalBytes({ ...material, scopeSha256 });
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as Readonly<{ code?: unknown }>).code)
    : undefined;
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    const code = errnoCode(error);
    const unsupported =
      code === "ENOTSUP" ||
      (process.platform === "win32" &&
        (code === "EACCES" ||
          code === "EBADF" ||
          code === "EINVAL" ||
          code === "EISDIR" ||
          code === "EPERM"));
    if (!unsupported) throw error;
  } finally {
    await handle?.close();
  }
}

async function writeSyncedFile(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function rawSha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function domainSha256(domain: string, value: unknown): Sha256 {
  return rawSha256(
    Buffer.concat([Buffer.from(domain, "utf8"), canonicalBytes(value)]),
  );
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameObjectIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameObjectIdentity(left, right) &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

interface DirectDirectoryWitness {
  readonly absolutePath: string;
  readonly state: BigIntStats;
}

interface ExactFileWitness {
  readonly absolutePath: string;
  readonly state: BigIntStats;
  readonly bytes: Buffer;
}

async function inspectDirectDirectory(
  path: string,
): Promise<DirectDirectoryWitness> {
  const absolutePath = resolve(path);
  const state = await lstat(absolutePath, { bigint: true });
  if (
    !state.isDirectory() ||
    state.isSymbolicLink() ||
    comparablePath(await realpath(absolutePath)) !== comparablePath(absolutePath)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child publication directory is not one direct stable directory.",
    );
  }
  return { absolutePath, state };
}

async function assertSameDirectory(
  witness: DirectDirectoryWitness,
): Promise<void> {
  const current = await inspectDirectDirectory(witness.absolutePath);
  if (!sameObjectIdentity(current.state, witness.state)) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child publication directory identity changed during the operation.",
    );
  }
}

async function syncPinnedDirectory(
  witness: DirectDirectoryWitness,
): Promise<void> {
  await assertSameDirectory(witness);
  await syncDirectory(witness.absolutePath);
  await assertSameDirectory(witness);
}

async function readExactDirectFile(input: {
  readonly path: string;
  readonly maximumByteLength: number;
  readonly allowedLinkCounts: readonly bigint[];
  readonly expectedBytes?: Buffer;
}): Promise<ExactFileWitness> {
  const absolutePath = resolve(input.path);
  const before = await lstat(absolutePath, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    !input.allowedLinkCounts.includes(before.nlink) ||
    before.size < 0n ||
    before.size > BigInt(input.maximumByteLength) ||
    comparablePath(await realpath(absolutePath)) !== comparablePath(absolutePath)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child publication file is not one bounded direct file.",
    );
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absolutePath, "r");
    const opened = await handle.stat({ bigint: true });
    if (!sameFileState(before, opened)) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Mask child publication file changed before its exact read.",
      );
    }
    const bytes = await handle.readFile();
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await lstat(absolutePath, { bigint: true });
    if (
      BigInt(bytes.length) !== before.size ||
      !sameFileState(opened, afterHandle) ||
      !sameFileState(afterHandle, afterPath) ||
      comparablePath(await realpath(absolutePath)) !== comparablePath(absolutePath) ||
      (input.expectedBytes !== undefined &&
        !bytes.equals(input.expectedBytes))
    ) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Mask child publication file bytes or identity changed during read.",
      );
    }
    return { absolutePath, state: afterPath, bytes };
  } finally {
    await handle?.close();
  }
}

async function syncExactFile(witness: ExactFileWitness): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(witness.absolutePath, "r+");
    const opened = await handle.stat({ bigint: true });
    if (!sameFileState(opened, witness.state)) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Mask child publication file changed before its durability barrier.",
      );
    }
    await handle.sync();
    const after = await handle.stat({ bigint: true });
    if (!sameFileState(opened, after)) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Mask child publication file changed during its durability barrier.",
      );
    }
  } finally {
    await handle?.close();
  }
}

async function exactNames(
  directory: DirectDirectoryWitness,
  expected: readonly string[],
): Promise<void> {
  const names = (await readdir(directory.absolutePath)).sort();
  const sortedExpected = [...expected].sort();
  if (
    names.length !== sortedExpected.length ||
    names.some((name, index) => name !== sortedExpected[index])
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child stage contains an unexplained or missing node.",
    );
  }
  await assertSameDirectory(directory);
}

async function directKind(
  path: string,
): Promise<"absent" | "file" | "directory"> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Child publication path is a symbolic link.",
      );
    }
    if (stats.isFile()) return "file";
    if (stats.isDirectory()) return "directory";
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Child publication path has an unsupported node kind.",
    );
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return "absent";
    throw error;
  }
}

function assertSafeLeafName(value: string): void {
  if (
    !SAFE_MEMBER_NAME_PATTERN.test(value) ||
    value === "." ||
    value === ".." ||
    value.includes("..") ||
    value.endsWith(".") ||
    value.endsWith(" ")
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "Mask child leaf name is not one canonical server-owned basename.",
    );
  }
}

function childDescriptorBytes(
  leafName: string,
  scope: GrandHallT554NativeReviewMaskScopeV2,
): Buffer {
  return canonicalBytes({
    schemaVersion: CHILD_SCOPE_DESCRIPTOR_SCHEMA,
    leafName,
    scope,
  });
}

function maskStartEvent(input: {
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly startedAtUtc: string;
  readonly predecessorCoverage: GrandHallT554NativeReviewMaskCoverageCarryStateV2 | null;
}): GrandHallT554NativeReviewMaskChildEventV2 {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType: "mask.review-started.v2",
    payload: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-review-started.v2",
      browserEpochNonceSha256: input.scope.browserEpochNonceSha256,
      coverageSegmentIdSha256: input.scope.coverageSegmentIdSha256,
      coverageSegmentStartedAtUtc: input.startedAtUtc,
      firstSampleMustCreditZero: true,
      renderGeneration: input.scope.renderGeneration,
      sourceCustody: input.scope.sourceCustody,
      maskReviewSubjectSha256: input.scope.maskReviewSubjectSha256,
      maskStateSha256: input.scope.maskStateSha256,
      frozenBindingSha256: input.scope.frozenBindingSha256,
      frozenBinding: input.scope.frozenBinding,
      implementationManifest: input.scope.implementationManifest,
      predecessorCoverage: input.predecessorCoverage,
      authorityBoundary: input.scope.authorityBoundary,
    },
  };
}

function intentMatchesPending(
  event: GrandHallT554NativeReviewPendingIntentEventV2,
  pending: NonNullable<PendingIntent>,
): boolean {
  const expectedEventType =
    pending.kind === "source_selection"
      ? "source.selection-intended.v2"
      : pending.kind === "mask_freeze"
        ? "mask.freeze-intended.v2"
        : "coverage.segment-resume-intended.v2";
  return (
    event.eventType === expectedEventType &&
    event.payload.operationIdSha256 === pending.operationIdSha256 &&
    event.payload.allocatedRenderGeneration ===
      pending.allocatedRenderGeneration &&
    event.payload.childJournalLeafName === pending.childJournalLeafName
  );
}

/**
 * Resolves only the intent named by the replayed pending pointer. It never
 * guesses by returning the latest event of a compatible type.
 */
export function findExactPendingCoordinatorIntentEventV2(
  replay: GrandHallT554NativeReviewDurableJournalReplayV2,
  pending: PendingIntent,
): GrandHallT554NativeReviewPendingIntentEventV2 | null {
  if (pending === null) return null;
  const matches = replay.events.filter(
    (candidate): candidate is GrandHallT554NativeReviewPendingIntentEventV2 =>
      (candidate.eventType === "source.selection-intended.v2" ||
        candidate.eventType === "mask.freeze-intended.v2" ||
        candidate.eventType === "coverage.segment-resume-intended.v2") &&
      intentMatchesPending(candidate, pending),
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw fail(
      "PENDING_INTENT_MISMATCH",
      "Coordinator pending intent resolves to more than one durable event.",
    );
  }
  return matches[0] ?? null;
}

function checkpointAdvances(
  previous: Readonly<{
    kind: "source" | "mask";
    leafName: string;
    scopeSha256: Sha256;
    scopeFileSha256: Sha256;
    revision: number;
  }>,
  current: Readonly<{
    kind: "source" | "mask";
    leafName: string;
    scopeSha256: Sha256;
    scopeFileSha256: Sha256;
    revision: number;
  }>,
): boolean {
  return (
    previous.kind === current.kind &&
    previous.leafName === current.leafName &&
    previous.scopeSha256 === current.scopeSha256 &&
    previous.scopeFileSha256 === current.scopeFileSha256 &&
    current.revision >= previous.revision &&
    (current.revision !== previous.revision ||
      canonicalEqual(previous, current))
  );
}

export function latestVerifiedActiveSourceEvidenceV2(
  store: GrandHallT554NativeReviewSessionStoreReplayV2,
): GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2 | null {
  const checkpoint = store.coordinator.activeSource?.sourceJournal;
  if (checkpoint === undefined) return null;
  const child = store.children.find(
    (candidate) => candidate.leafName === checkpoint.leafName,
  );
  if (
    child?.evidence.kind !== "source" ||
    !checkpointAdvances(checkpoint, child.evidence.checkpoint)
  ) {
    throw fail(
      "ACTIVE_CHILD_MISMATCH",
      "Active source pointer has no exact latest verified source evidence.",
    );
  }
  return child.evidence;
}

export function latestVerifiedActiveMaskEvidenceV2(
  store: GrandHallT554NativeReviewSessionStoreReplayV2,
): GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2 | null {
  const checkpoint = store.coordinator.activeSource?.maskJournal;
  if (checkpoint === undefined || checkpoint === null) return null;
  const child = store.children.find(
    (candidate) => candidate.leafName === checkpoint.leafName,
  );
  if (
    child?.evidence.kind !== "mask" ||
    !checkpointAdvances(checkpoint, child.evidence.checkpoint)
  ) {
    throw fail(
      "ACTIVE_CHILD_MISMATCH",
      "Active mask pointer has no exact latest verified mask evidence.",
    );
  }
  return child.evidence;
}

export interface GrandHallT554NativeReviewPublishedMaskChildStartV2 {
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly journal: GrandHallT554NativeReviewDurableJournalV2;
  readonly evidence: GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2;
}

async function openExactMaskChild(input: {
  readonly sessionRoot: string;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
}): Promise<GrandHallT554NativeReviewPublishedMaskChildStartV2> {
  const workspaceRoot = join(input.sessionRoot, "children", input.leafName);
  const evidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot,
      expectedScope: input.scope,
    });
  if (evidence.kind !== "mask" || evidence.checkpoint.revision !== 1) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child start must reopen as exact revision-one mask evidence.",
    );
  }
  const journal = await openGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot,
    expectedScope: input.scope,
  });
  return { scope: input.scope, journal, evidence };
}

interface PublicationRoots {
  readonly session: DirectDirectoryWitness;
  readonly parent: DirectDirectoryWitness;
  readonly children: DirectDirectoryWitness;
  readonly descriptors: DirectDirectoryWitness;
}

interface StagedJournalWitness {
  readonly root: DirectDirectoryWitness;
  readonly claims: DirectDirectoryWitness;
  readonly events: DirectDirectoryWitness;
  readonly pending: DirectDirectoryWitness;
  readonly quarantine: DirectDirectoryWitness;
  readonly scopeFile: ExactFileWitness;
  readonly claimFile: ExactFileWitness;
  readonly eventFile: ExactFileWitness;
}

interface MaskChildStageBase {
  readonly root: DirectDirectoryWitness;
  readonly operationFile: ExactFileWitness;
  readonly descriptorFile: ExactFileWitness;
  readonly operationIdentitySha256: Sha256;
  readonly targetBindingSha256: Sha256;
}

interface FullMaskChildStage extends MaskChildStageBase {
  readonly mode: "full";
  readonly journal: StagedJournalWitness;
}

interface DescriptorMaskChildStage extends MaskChildStageBase {
  readonly mode: "descriptor_only";
}

type MaskChildStage = FullMaskChildStage | DescriptorMaskChildStage;

function stageTargetBindingSha256(
  leafName: string,
  scope: GrandHallT554NativeReviewMaskScopeV2,
): Sha256 {
  return domainSha256(MASK_CHILD_STAGE_TARGET_DOMAIN, {
    leafName,
    scope,
  });
}

function stageRootPath(
  roots: PublicationRoots,
  targetBindingSha256: Sha256,
  operationIdentitySha256: Sha256,
): string {
  return join(
    roots.parent.absolutePath,
    `.venviewer-t554-mask-child-${targetBindingSha256.slice("sha256:".length)}-${operationIdentitySha256.slice("sha256:".length)}.stage`,
  );
}

function stageOperationBytes(input: {
  readonly mode: "full" | "descriptor_only";
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly operationIdentitySha256: Sha256;
  readonly targetBindingSha256: Sha256;
}): Buffer {
  const operationBindingSha256 = domainSha256(
    MASK_CHILD_STAGE_BINDING_DOMAIN,
    {
      operationIdentitySha256: input.operationIdentitySha256,
      targetBindingSha256: input.targetBindingSha256,
    },
  );
  return canonicalBytes({
    schemaVersion: MASK_CHILD_STAGE_SCHEMA,
    mode: input.mode,
    leafName: input.leafName,
    targetBindingSha256: input.targetBindingSha256,
    operationIdentitySha256: input.operationIdentitySha256,
    operationBindingSha256,
    scopeSha256: domainSha256(
      "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_MASK_CHILD_STAGE_SCOPE_V2\n",
      input.scope,
    ),
  });
}

async function inspectPublicationRoots(
  sessionRoot: string,
): Promise<PublicationRoots> {
  const session = await inspectDirectDirectory(sessionRoot);
  const parent = await inspectDirectDirectory(dirname(session.absolutePath));
  const children = await inspectDirectDirectory(
    join(session.absolutePath, "children"),
  );
  const descriptors = await inspectDirectDirectory(
    join(session.absolutePath, "child-scopes"),
  );
  if (
    session.state.dev !== parent.state.dev ||
    session.state.dev !== children.state.dev ||
    session.state.dev !== descriptors.state.dev
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child publication roots are not on one pinned filesystem.",
    );
  }
  await assertSameDirectory(session);
  await assertSameDirectory(parent);
  return { session, parent, children, descriptors };
}

async function optionalDirectKind(
  path: string,
): Promise<"absent" | "file" | "directory"> {
  return await directKind(resolve(path));
}

async function optionalExactFile(input: {
  readonly path: string;
  readonly expectedBytes: Buffer;
  readonly allowedLinkCounts: readonly bigint[];
}): Promise<ExactFileWitness | null> {
  if ((await optionalDirectKind(input.path)) === "absent") return null;
  return await readExactDirectFile({
    path: input.path,
    maximumByteLength: input.expectedBytes.length,
    allowedLinkCounts: input.allowedLinkCounts,
    expectedBytes: input.expectedBytes,
  });
}

async function optionalPrefixFile(input: {
  readonly path: string;
  readonly expectedBytes: Buffer;
  readonly allowedLinkCounts: readonly bigint[];
}): Promise<ExactFileWitness | null> {
  if ((await optionalDirectKind(input.path)) === "absent") return null;
  const witness = await readExactDirectFile({
    path: input.path,
    maximumByteLength: input.expectedBytes.length,
    allowedLinkCounts: input.allowedLinkCounts,
  });
  if (
    !input.expectedBytes
      .subarray(0, witness.bytes.length)
      .equals(witness.bytes)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child publication file is not an exact writer prefix.",
    );
  }
  return witness;
}

async function inspectStagedJournal(input: {
  readonly stageChildPath: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
}): Promise<StagedJournalWitness> {
  const evidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot: input.stageChildPath,
      expectedScope: input.scope,
    });
  if (evidence.kind !== "mask" || evidence.checkpoint.revision !== 1) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Staged mask child is not exact revision-one mask evidence.",
    );
  }
  const root = await inspectDirectDirectory(input.stageChildPath);
  await exactNames(root, JOURNAL_ROOT_NAMES);
  const claims = await inspectDirectDirectory(
    join(root.absolutePath, JOURNAL_CLAIMS_DIRECTORY_NAME),
  );
  const events = await inspectDirectDirectory(
    join(root.absolutePath, JOURNAL_EVENTS_DIRECTORY_NAME),
  );
  const pending = await inspectDirectDirectory(
    join(root.absolutePath, JOURNAL_PENDING_DIRECTORY_NAME),
  );
  const quarantine = await inspectDirectDirectory(
    join(root.absolutePath, JOURNAL_QUARANTINE_DIRECTORY_NAME),
  );
  await exactNames(pending, []);
  await exactNames(quarantine, []);
  await exactNames(claims, [FIRST_CLAIM_FILE_NAME]);
  const eventNames = await readdir(events.absolutePath);
  const eventFileName = eventNames[0];
  if (
    eventNames.length !== 1 ||
    eventFileName === undefined ||
    !FIRST_EVENT_FILE_PATTERN.test(eventFileName)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Staged revision-one mask journal has an unexplained event inventory.",
    );
  }
  await assertSameDirectory(events);
  const scopeFile = await readExactDirectFile({
    path: join(root.absolutePath, JOURNAL_SCOPE_FILE_NAME),
    maximumByteLength: MAXIMUM_STAGED_JOURNAL_FILE_BYTES,
    allowedLinkCounts: [1n],
  });
  const claimFile = await readExactDirectFile({
    path: join(claims.absolutePath, FIRST_CLAIM_FILE_NAME),
    maximumByteLength: MAXIMUM_STAGED_JOURNAL_FILE_BYTES,
    allowedLinkCounts: [2n],
  });
  const eventFile = await readExactDirectFile({
    path: join(events.absolutePath, eventFileName),
    maximumByteLength: MAXIMUM_STAGED_JOURNAL_FILE_BYTES,
    allowedLinkCounts: [2n],
  });
  if (
    !sameObjectIdentity(claimFile.state, eventFile.state) ||
    !claimFile.bytes.equals(eventFile.bytes)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Staged mask journal claim and event are not one exact hard-link pair.",
    );
  }
  return {
    root,
    claims,
    events,
    pending,
    quarantine,
    scopeFile,
    claimFile,
    eventFile,
  };
}

async function loadMaskChildStage(input: {
  readonly roots: PublicationRoots;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly operationIdentitySha256: Sha256;
}): Promise<MaskChildStage | null> {
  const targetBindingSha256 = stageTargetBindingSha256(
    input.leafName,
    input.scope,
  );
  const stagePrefix = `.venviewer-t554-mask-child-${targetBindingSha256.slice("sha256:".length)}-`;
  const path = stageRootPath(
    input.roots,
    targetBindingSha256,
    input.operationIdentitySha256,
  );
  const targetStageNames = (await readdir(input.roots.parent.absolutePath)).filter(
    (name) => name.startsWith(stagePrefix) && name.endsWith(".stage"),
  );
  if (
    targetStageNames.some((name) => name !== basename(path)) ||
    targetStageNames.length > 1
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child target retains a stage for a different durable operation.",
    );
  }
  await assertSameDirectory(input.roots.parent);
  const kind = await optionalDirectKind(path);
  if (kind === "absent") return null;
  if (kind !== "directory") {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Deterministic mask child stage is not a direct directory.",
    );
  }
  const root = await inspectDirectDirectory(path);
  if (root.state.dev !== input.roots.parent.state.dev) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Deterministic mask child stage is on a different filesystem.",
    );
  }
  if (
    (await optionalDirectKind(join(root.absolutePath, "operation.json"))) !==
    "file"
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Deterministic mask child stage has no direct operation binding.",
    );
  }
  const operationFile = await readExactDirectFile({
    path: join(root.absolutePath, "operation.json"),
    maximumByteLength: 4_096,
    allowedLinkCounts: [1n],
  });
  const fullOperationBytes = stageOperationBytes({
    mode: "full",
    leafName: input.leafName,
    scope: input.scope,
    operationIdentitySha256: input.operationIdentitySha256,
    targetBindingSha256,
  });
  const descriptorOperationBytes = stageOperationBytes({
    mode: "descriptor_only",
    leafName: input.leafName,
    scope: input.scope,
    operationIdentitySha256: input.operationIdentitySha256,
    targetBindingSha256,
  });
  const mode = operationFile.bytes.equals(fullOperationBytes)
    ? "full"
    : operationFile.bytes.equals(descriptorOperationBytes)
      ? "descriptor_only"
      : null;
  if (mode === null) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Deterministic mask child stage belongs to a different durable operation.",
    );
  }
  await exactNames(
    root,
    mode === "full"
      ? MASK_CHILD_FULL_STAGE_NAMES
      : MASK_CHILD_DESCRIPTOR_STAGE_NAMES,
  );
  const descriptorFile = await readExactDirectFile({
    path: join(root.absolutePath, "descriptor.json"),
    maximumByteLength: childDescriptorBytes(input.leafName, input.scope).length,
    allowedLinkCounts: [1n, 2n],
    expectedBytes: childDescriptorBytes(input.leafName, input.scope),
  });
  const publishedDescriptorPath = join(
    input.roots.descriptors.absolutePath,
    `${input.leafName}.json`,
  );
  const publishedDescriptorKind = await optionalDirectKind(
    publishedDescriptorPath,
  );
  if (descriptorFile.state.nlink === 2n) {
    if (publishedDescriptorKind !== "file") {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Two-link staged descriptor has no exact published peer.",
      );
    }
    const publishedDescriptor = await readExactDirectFile({
      path: publishedDescriptorPath,
      maximumByteLength: descriptorFile.bytes.length,
      allowedLinkCounts: [2n],
      expectedBytes: descriptorFile.bytes,
    });
    if (!sameObjectIdentity(descriptorFile.state, publishedDescriptor.state)) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Two-link staged descriptor has an unexplained external peer.",
      );
    }
  } else if (publishedDescriptorKind !== "absent") {
    if (publishedDescriptorKind !== "file") {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Published descriptor has the wrong direct node kind.",
      );
    }
    await readExactDirectFile({
      path: publishedDescriptorPath,
      maximumByteLength: descriptorFile.bytes.length,
      allowedLinkCounts: [1n],
      expectedBytes: descriptorFile.bytes,
    });
  }
  const base = {
    root,
    operationFile,
    descriptorFile,
    operationIdentitySha256: input.operationIdentitySha256,
    targetBindingSha256,
  };
  if (mode === "descriptor_only") {
    return { ...base, mode };
  }
  const journal = await inspectStagedJournal({
    stageChildPath: join(root.absolutePath, "child"),
    scope: input.scope,
  });
  return { ...base, mode, journal };
}

interface InterruptedMaskChildStage {
  readonly root: DirectDirectoryWitness;
  readonly mode: "full" | "descriptor_only" | null;
  readonly operationFile: ExactFileWitness | null;
  readonly descriptorFile: ExactFileWitness | null;
  readonly child: DirectDirectoryWitness | null;
}

async function inspectInterruptedMaskChildStage(input: {
  readonly roots: PublicationRoots;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly operationIdentitySha256: Sha256;
}): Promise<InterruptedMaskChildStage | null> {
  const targetBindingSha256 = stageTargetBindingSha256(
    input.leafName,
    input.scope,
  );
  const stagePrefix = `.venviewer-t554-mask-child-${targetBindingSha256.slice("sha256:".length)}-`;
  const path = stageRootPath(
    input.roots,
    targetBindingSha256,
    input.operationIdentitySha256,
  );
  const targetStageNames = (await readdir(input.roots.parent.absolutePath)).filter(
    (name) => name.startsWith(stagePrefix) && name.endsWith(".stage"),
  );
  if (
    targetStageNames.some((name) => name !== basename(path)) ||
    targetStageNames.length > 1
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child target retains a stage for a different durable operation.",
    );
  }
  const kind = await optionalDirectKind(path);
  if (kind === "absent") return null;
  if (kind !== "directory") {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted deterministic mask child stage is not a direct directory.",
    );
  }
  const root = await inspectDirectDirectory(path);
  if (root.state.dev !== input.roots.parent.state.dev) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted deterministic mask child stage crossed a filesystem boundary.",
    );
  }
  const names = (await readdir(root.absolutePath)).sort();
  const operationKind = await optionalDirectKind(
    join(root.absolutePath, "operation.json"),
  );
  if (operationKind === "absent") {
    if (names.length !== 0) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Unbound interrupted stage contains an unexplained node.",
      );
    }
    return {
      root,
      mode: null,
      operationFile: null,
      descriptorFile: null,
      child: null,
    };
  }
  if (operationKind !== "file") {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted stage operation binding is not a direct file.",
    );
  }
  const operationFile = await readExactDirectFile({
    path: join(root.absolutePath, "operation.json"),
    maximumByteLength: 4_096,
    allowedLinkCounts: [1n],
  });
  const fullOperationBytes = stageOperationBytes({
    mode: "full",
    leafName: input.leafName,
    scope: input.scope,
    operationIdentitySha256: input.operationIdentitySha256,
    targetBindingSha256,
  });
  const descriptorOperationBytes = stageOperationBytes({
    mode: "descriptor_only",
    leafName: input.leafName,
    scope: input.scope,
    operationIdentitySha256: input.operationIdentitySha256,
    targetBindingSha256,
  });
  const mode = operationFile.bytes.equals(fullOperationBytes)
    ? "full"
    : operationFile.bytes.equals(descriptorOperationBytes)
      ? "descriptor_only"
      : null;
  if (
    mode === null &&
    !fullOperationBytes
      .subarray(0, operationFile.bytes.length)
      .equals(operationFile.bytes) &&
    !descriptorOperationBytes
      .subarray(0, operationFile.bytes.length)
      .equals(operationFile.bytes)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted stage operation file is not an exact durable-operation write prefix.",
    );
  }
  const allowedNames: readonly string[] =
    mode === "full"
      ? MASK_CHILD_FULL_STAGE_NAMES
      : mode === "descriptor_only"
        ? MASK_CHILD_DESCRIPTOR_STAGE_NAMES
        : (["operation.json"] as const);
  if (names.some((name) => !allowedNames.includes(name))) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted stage contains an unexplained direct node.",
    );
  }
  const descriptorPath = join(root.absolutePath, "descriptor.json");
  const descriptorKind = await optionalDirectKind(descriptorPath);
  const expectedDescriptorBytes = childDescriptorBytes(
    input.leafName,
    input.scope,
  );
  const descriptorFile =
    descriptorKind === "absent"
      ? null
      : descriptorKind === "file"
        ? await (async () => {
            const witness = await readExactDirectFile({
              path: descriptorPath,
              maximumByteLength: expectedDescriptorBytes.length,
              allowedLinkCounts: [1n, 2n],
            });
            if (
              !expectedDescriptorBytes
                .subarray(0, witness.bytes.length)
                .equals(witness.bytes) ||
              (witness.state.nlink === 2n &&
                !witness.bytes.equals(expectedDescriptorBytes))
            ) {
              throw fail(
                "CHILD_PUBLICATION_INVALID",
                "Interrupted staged descriptor is not an exact write prefix.",
              );
            }
            return witness;
          })()
        : (() => {
            throw fail(
              "CHILD_PUBLICATION_INVALID",
              "Interrupted staged descriptor is not a direct file.",
            );
          })();
  const childPath = join(root.absolutePath, "child");
  const childKind = await optionalDirectKind(childPath);
  const child =
    childKind === "absent"
      ? null
      : childKind === "directory"
        ? await inspectDirectDirectory(childPath)
        : (() => {
            throw fail(
              "CHILD_PUBLICATION_INVALID",
              "Interrupted staged child is not a direct directory.",
            );
          })();
  if ((mode === "descriptor_only" || mode === null) && child !== null) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Descriptor-only interrupted stage contains an unexplained child.",
    );
  }
  await assertSameDirectory(root);
  return { root, mode, operationFile, descriptorFile, child };
}

async function readPrefixFile(input: {
  readonly path: string;
  readonly expectedBytes: Buffer;
}): Promise<ExactFileWitness> {
  const witness = await readExactDirectFile({
    path: input.path,
    maximumByteLength: input.expectedBytes.length,
    allowedLinkCounts: [1n],
  });
  if (
    !input.expectedBytes
      .subarray(0, witness.bytes.length)
      .equals(witness.bytes)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted stage file is not an exact write prefix.",
    );
  }
  return witness;
}

interface InitializedJournalForDiscard {
  readonly root: DirectDirectoryWitness;
  readonly directories: readonly DirectDirectoryWitness[];
  readonly filesInRemovalOrder: readonly ExactFileWitness[];
}

async function inspectInitializedJournalForDiscard(input: {
  readonly child: DirectDirectoryWitness;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
}): Promise<InitializedJournalForDiscard> {
  await assertSameDirectory(input.child);
  const journal = await openGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: input.child.absolutePath,
    expectedScope: input.scope,
  });
  const replay = await journal.replay();
  await assertSameDirectory(input.child);
  if (replay.revision !== 0) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Committed revision-one staged journals must roll forward, not be discarded.",
    );
  }
  const root = await inspectDirectDirectory(input.child.absolutePath);
  if (!sameObjectIdentity(root.state, input.child.state)) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted staged journal root changed during recovery inspection.",
    );
  }
  await exactNames(root, JOURNAL_ROOT_NAMES);
  const claims = await inspectDirectDirectory(
    join(root.absolutePath, JOURNAL_CLAIMS_DIRECTORY_NAME),
  );
  const events = await inspectDirectDirectory(
    join(root.absolutePath, JOURNAL_EVENTS_DIRECTORY_NAME),
  );
  const pending = await inspectDirectDirectory(
    join(root.absolutePath, JOURNAL_PENDING_DIRECTORY_NAME),
  );
  const quarantine = await inspectDirectDirectory(
    join(root.absolutePath, JOURNAL_QUARANTINE_DIRECTORY_NAME),
  );
  await exactNames(pending, []);
  const scopeFile = await readExactDirectFile({
    path: join(root.absolutePath, JOURNAL_SCOPE_FILE_NAME),
    maximumByteLength: lowLevelScopeFileBytes(input.scope).length,
    allowedLinkCounts: [1n],
    expectedBytes: lowLevelScopeFileBytes(input.scope),
  });
  const filesInRemovalOrder: ExactFileWitness[] = [];
  await exactNames(claims, []);
  await exactNames(events, []);
  const quarantineNames = (await readdir(quarantine.absolutePath)).sort();
  for (const name of quarantineNames) {
    if (!SAFE_MEMBER_NAME_PATTERN.test(name)) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Interrupted staged journal quarantine contains an unsafe member.",
      );
    }
    filesInRemovalOrder.push(
      await readExactDirectFile({
        path: join(quarantine.absolutePath, name),
        maximumByteLength: MAXIMUM_STAGED_JOURNAL_FILE_BYTES,
        allowedLinkCounts: [1n],
      }),
    );
  }
  filesInRemovalOrder.push(scopeFile);
  return {
    root,
    directories: [claims, events, pending, quarantine],
    filesInRemovalOrder,
  };
}

async function removeInitializedJournalForDiscard(
  journal: InitializedJournalForDiscard,
): Promise<void> {
  await assertSameDirectory(journal.root);
  for (const file of journal.filesInRemovalOrder) {
    await unlinkExactWitness(file);
  }
  await assertSameDirectory(journal.root);
  for (const directory of [...journal.directories].reverse()) {
    await removeExactEmptyDirectory(directory);
  }
  await removeExactEmptyDirectory(journal.root);
}

async function removeCreationPrefixChild(input: {
  readonly child: DirectDirectoryWitness;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
}): Promise<void> {
  await assertSameDirectory(input.child);
  const names = (await readdir(input.child.absolutePath)).sort();
  if (names.some((name) => !JOURNAL_ROOT_NAMES.includes(
    name as (typeof JOURNAL_ROOT_NAMES)[number],
  ))) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted staged child contains an unexplained journal node.",
    );
  }
  const expectedDirectoryOrder = [
    JOURNAL_CLAIMS_DIRECTORY_NAME,
    JOURNAL_EVENTS_DIRECTORY_NAME,
    JOURNAL_PENDING_DIRECTORY_NAME,
    JOURNAL_QUARANTINE_DIRECTORY_NAME,
  ] as const;
  const presentDirectories: DirectDirectoryWitness[] = [];
  let missingSeen = false;
  for (const name of expectedDirectoryOrder) {
    const kind = await optionalDirectKind(join(input.child.absolutePath, name));
    if (kind === "absent") {
      missingSeen = true;
      continue;
    }
    if (kind !== "directory" || missingSeen) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Interrupted staged journal directories are not an exact creation prefix.",
      );
    }
    const directory = await inspectDirectDirectory(
      join(input.child.absolutePath, name),
    );
    presentDirectories.push(directory);
  }
  const scopePath = join(input.child.absolutePath, JOURNAL_SCOPE_FILE_NAME);
  const scopeKind = await optionalDirectKind(scopePath);
  let scopeFile: ExactFileWitness | null = null;
  if (scopeKind !== "absent") {
    if (
      scopeKind !== "file" ||
      presentDirectories.length !== expectedDirectoryOrder.length
    ) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Interrupted staged journal scope is not in its exact creation position.",
      );
    }
    scopeFile = await readPrefixFile({
      path: scopePath,
      expectedBytes: lowLevelScopeFileBytes(input.scope),
    });
    if (scopeFile.bytes.length === lowLevelScopeFileBytes(input.scope).length) {
      const initialized = await inspectInitializedJournalForDiscard(input);
      await removeInitializedJournalForDiscard(initialized);
      return;
    }
  }
  for (const directory of presentDirectories) {
    await exactNames(directory, []);
  }
  if (scopeFile !== null) await unlinkExactWitness(scopeFile);
  await assertSameDirectory(input.child);
  for (const directory of [...presentDirectories].reverse()) {
    await removeExactEmptyDirectory(directory);
  }
  await removeExactEmptyDirectory(input.child);
}

async function completeCommittedFullCreationStage(input: {
  readonly roots: PublicationRoots;
  readonly stage: InterruptedMaskChildStage;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly operationIdentitySha256: Sha256;
}): Promise<FullMaskChildStage | null> {
  if (
    input.stage.mode !== "full" ||
    input.stage.operationFile === null ||
    input.stage.child === null
  ) {
    return null;
  }
  try {
    await inspectStagedJournal({
      stageChildPath: input.stage.child.absolutePath,
      scope: input.scope,
    });
  } catch {
    return null;
  }
  await assertSameDirectory(input.stage.root);
  const descriptorBytes = childDescriptorBytes(input.leafName, input.scope);
  if (input.stage.descriptorFile !== null) {
    if (input.stage.descriptorFile.bytes.equals(descriptorBytes)) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Complete committed full stage unexpectedly failed exact reopen.",
      );
    }
    if (input.stage.descriptorFile.state.nlink !== 1n) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Partial committed-stage descriptor has an external hard link.",
      );
    }
    await unlinkExactWitness(input.stage.descriptorFile);
    await syncPinnedDirectory(input.stage.root);
  }
  await writeSyncedFile(
    join(input.stage.root.absolutePath, "descriptor.json"),
    descriptorBytes,
  );
  await syncPinnedDirectory(input.stage.root);
  const completed = await loadMaskChildStage({
    roots: input.roots,
    leafName: input.leafName,
    scope: input.scope,
    operationIdentitySha256: input.operationIdentitySha256,
  });
  if (completed?.mode !== "full") {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Committed interrupted stage did not roll forward to an exact full stage.",
    );
  }
  return completed;
}

async function removeInterruptedCreationPrefix(input: {
  readonly roots: PublicationRoots;
  readonly stage: InterruptedMaskChildStage;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly operationIdentitySha256: Sha256;
  readonly expectedMode: "full" | "descriptor_only";
}): Promise<void> {
  if (input.stage.mode === null) {
    if (input.stage.operationFile !== null) {
      const targetBindingSha256 = stageTargetBindingSha256(
        input.leafName,
        input.scope,
      );
      const expectedOperationBytes = stageOperationBytes({
        mode: input.expectedMode,
        leafName: input.leafName,
        scope: input.scope,
        operationIdentitySha256: input.operationIdentitySha256,
        targetBindingSha256,
      });
      if (
        !expectedOperationBytes
          .subarray(0, input.stage.operationFile.bytes.length)
          .equals(input.stage.operationFile.bytes) ||
        input.stage.descriptorFile !== null ||
        input.stage.child !== null
      ) {
        throw fail(
          "CHILD_PUBLICATION_INVALID",
          "Partial operation binding is not the first exact construction prefix.",
        );
      }
      await unlinkExactWitness(input.stage.operationFile);
    }
    await removeExactEmptyDirectory(input.stage.root);
    await syncPinnedDirectory(input.roots.parent);
    return;
  }
  if (
    input.stage.mode !== input.expectedMode ||
    input.stage.operationFile === null
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted stage is not an exact construction prefix for this publication topology.",
    );
  }
  if (input.stage.mode === "full") {
    if (
      input.stage.descriptorFile !== null &&
      input.stage.child === null
    ) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Full-stage descriptor prefix has no atomically prior child journal.",
      );
    }
    if (input.stage.child !== null) {
      await assertSameDirectory(input.stage.root);
      if (input.stage.descriptorFile !== null) {
        await inspectStagedJournal({
          stageChildPath: input.stage.child.absolutePath,
          scope: input.scope,
        });
      }
      if (input.stage.descriptorFile !== null) {
        await unlinkExactWitness(input.stage.descriptorFile);
      }
      await removeCreationPrefixChild({
        child: input.stage.child,
        scope: input.scope,
      });
      await assertSameDirectory(input.stage.root);
    }
  } else if (input.stage.child !== null) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Descriptor-only construction prefix contains a child journal.",
    );
  } else if (input.stage.descriptorFile !== null) {
    await unlinkExactWitness(input.stage.descriptorFile);
  }
  await unlinkExactWitness(input.stage.operationFile);
  await removeExactEmptyDirectory(input.stage.root);
  await syncPinnedDirectory(input.roots.parent);
}

async function removeFullCleanupSuffixChild(input: {
  readonly child: DirectDirectoryWitness;
  readonly published: StagedJournalWitness;
}): Promise<void> {
  const root = input.child;
  await assertSameDirectory(root);
  const names = (await readdir(root.absolutePath)).sort();
  if (names.some((name) => !JOURNAL_ROOT_NAMES.includes(
    name as (typeof JOURNAL_ROOT_NAMES)[number],
  ))) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted cleanup suffix contains an unexplained journal node.",
    );
  }
  const directoryNames = [
    JOURNAL_CLAIMS_DIRECTORY_NAME,
    JOURNAL_EVENTS_DIRECTORY_NAME,
    JOURNAL_PENDING_DIRECTORY_NAME,
    JOURNAL_QUARANTINE_DIRECTORY_NAME,
  ] as const;
  const directories = new Map<string, DirectDirectoryWitness>();
  for (const name of directoryNames) {
    const kind = await optionalDirectKind(join(root.absolutePath, name));
    if (kind === "absent") continue;
    if (kind !== "directory") {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Interrupted cleanup suffix journal member is not a direct directory.",
      );
    }
    directories.set(name, await inspectDirectDirectory(join(root.absolutePath, name)));
  }
  const claims = directories.get(JOURNAL_CLAIMS_DIRECTORY_NAME);
  const events = directories.get(JOURNAL_EVENTS_DIRECTORY_NAME);
  const pending = directories.get(JOURNAL_PENDING_DIRECTORY_NAME);
  const quarantine = directories.get(JOURNAL_QUARANTINE_DIRECTORY_NAME);
  if (pending !== undefined) await exactNames(pending, []);
  if (quarantine !== undefined) await exactNames(quarantine, []);
  const scopeFile = await optionalExactFile({
    path: join(root.absolutePath, JOURNAL_SCOPE_FILE_NAME),
    expectedBytes: input.published.scopeFile.bytes,
    allowedLinkCounts: [1n],
  });
  let claimFile =
    claims === undefined
      ? null
      : await optionalExactFile({
          path: join(claims.absolutePath, FIRST_CLAIM_FILE_NAME),
          expectedBytes: input.published.claimFile.bytes,
          allowedLinkCounts: [1n, 2n],
        });
  const eventName = basename(input.published.eventFile.absolutePath);
  const eventFile =
    events === undefined
      ? null
      : await optionalExactFile({
          path: join(events.absolutePath, eventName),
          expectedBytes: input.published.eventFile.bytes,
          allowedLinkCounts: [2n],
        });
  if (claims !== undefined) {
    await exactNames(claims, claimFile === null ? [] : [FIRST_CLAIM_FILE_NAME]);
  }
  if (events !== undefined) {
    await exactNames(events, eventFile === null ? [] : [eventName]);
  }
  const allDirectoriesPresent = directories.size === directoryNames.length;
  if (eventFile !== null) {
    if (
      !allDirectoriesPresent ||
      scopeFile === null ||
      claimFile === null ||
      claimFile.state.nlink !== 2n ||
      !sameObjectIdentity(eventFile.state, claimFile.state)
    ) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Interrupted cleanup event is not the exact first cleanup state.",
      );
    }
  } else if (claimFile !== null) {
    if (
      !allDirectoriesPresent ||
      scopeFile === null ||
      claimFile.state.nlink !== 1n
    ) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Interrupted cleanup claim is not the exact post-event suffix.",
      );
    }
  } else if (scopeFile !== null) {
    if (!allDirectoriesPresent) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Interrupted cleanup scope is not the exact post-claim suffix.",
      );
    }
  } else {
    const remaining = directoryNames.filter((name) => directories.has(name));
    const validDirectorySuffixes: readonly (readonly string[])[] = [
      directoryNames,
      directoryNames.slice(1),
      directoryNames.slice(2),
      directoryNames.slice(3),
      [],
    ];
    if (
      !validDirectorySuffixes.some(
        (candidate) =>
          candidate.length === remaining.length &&
          candidate.every((name, index) => name === remaining[index]),
      )
    ) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Interrupted journal directory inventory is not an exact cleanup suffix.",
      );
    }
  }
  if (eventFile !== null) {
    await unlinkExactWitness(eventFile);
    if (claimFile === null) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Interrupted cleanup lost the exact claim hard-link peer.",
      );
    }
    const refreshedClaim = await readExactDirectFile({
      path: claimFile.absolutePath,
      maximumByteLength: claimFile.bytes.length,
      allowedLinkCounts: [1n],
      expectedBytes: claimFile.bytes,
    });
    if (!sameObjectIdentity(refreshedClaim.state, claimFile.state)) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Interrupted cleanup claim identity changed after event unlink.",
      );
    }
    claimFile = refreshedClaim;
  }
  await assertSameDirectory(root);
  if (claimFile !== null) await unlinkExactWitness(claimFile);
  if (scopeFile !== null) await unlinkExactWitness(scopeFile);
  for (const name of directoryNames) {
    const directory = directories.get(name);
    if (directory !== undefined) await removeExactEmptyDirectory(directory);
  }
  await removeExactEmptyDirectory(root);
}

async function removeInterruptedCleanupSuffix(input: {
  readonly roots: PublicationRoots;
  readonly stage: InterruptedMaskChildStage;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
}): Promise<void> {
  const publishedChild = await openExactMaskChild({
    sessionRoot: input.roots.session.absolutePath,
    leafName: input.leafName,
    scope: input.scope,
  });
  if (publishedChild.evidence.checkpoint.revision !== 1) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted cleanup has no exact published revision-one child.",
    );
  }
  const descriptorPath = join(
    input.roots.descriptors.absolutePath,
    `${input.leafName}.json`,
  );
  await readExactDirectFile({
    path: descriptorPath,
    maximumByteLength: childDescriptorBytes(input.leafName, input.scope).length,
    allowedLinkCounts: [1n],
    expectedBytes: childDescriptorBytes(input.leafName, input.scope),
  });
  if (input.stage.mode === null) {
    await removeExactEmptyDirectory(input.stage.root);
    await syncPinnedDirectory(input.roots.parent);
    return;
  }
  if (
    input.stage.operationFile === null ||
    input.stage.descriptorFile !== null
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Interrupted cleanup is not past the staged-descriptor unlink barrier.",
    );
  }
  if (input.stage.mode === "full") {
    if (input.stage.child !== null) {
      await assertSameDirectory(input.stage.root);
      const publishedJournal = await inspectStagedJournal({
        stageChildPath: join(
          input.roots.children.absolutePath,
          input.leafName,
        ),
        scope: input.scope,
      });
      await removeFullCleanupSuffixChild({
        child: input.stage.child,
        published: publishedJournal,
      });
      await assertSameDirectory(input.stage.root);
    }
  } else if (input.stage.child !== null) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Descriptor-only cleanup suffix contains an unexplained child.",
    );
  }
  await unlinkExactWitness(input.stage.operationFile);
  await removeExactEmptyDirectory(input.stage.root);
  await syncPinnedDirectory(input.roots.parent);
  await syncPinnedDirectory(input.roots.descriptors);
}

async function loadOrRecoverInterruptedMaskChildStage(input: {
  readonly roots: PublicationRoots;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly operationIdentitySha256: Sha256;
}): Promise<MaskChildStage | null> {
  try {
    return await loadMaskChildStage(input);
  } catch (loadError) {
    const stage = await inspectInterruptedMaskChildStage(input);
    if (stage === null) throw loadError;
    const childPath = join(input.roots.children.absolutePath, input.leafName);
    const descriptorPath = join(
      input.roots.descriptors.absolutePath,
      `${input.leafName}.json`,
    );
    const childKind = await optionalDirectKind(childPath);
    const descriptorKind = await optionalDirectKind(descriptorPath);
    if (childKind === "absent" && descriptorKind === "absent") {
      const completed = await completeCommittedFullCreationStage({
        roots: input.roots,
        stage,
        leafName: input.leafName,
        scope: input.scope,
        operationIdentitySha256: input.operationIdentitySha256,
      });
      if (completed !== null) return completed;
      await removeInterruptedCreationPrefix({
        roots: input.roots,
        stage,
        leafName: input.leafName,
        scope: input.scope,
        operationIdentitySha256: input.operationIdentitySha256,
        expectedMode: "full",
      });
      return null;
    }
    if (childKind === "directory" && descriptorKind === "absent") {
      await openExactMaskChild({
        sessionRoot: input.roots.session.absolutePath,
        leafName: input.leafName,
        scope: input.scope,
      });
      await removeInterruptedCreationPrefix({
        roots: input.roots,
        stage,
        leafName: input.leafName,
        scope: input.scope,
        operationIdentitySha256: input.operationIdentitySha256,
        expectedMode: "descriptor_only",
      });
      return null;
    }
    if (childKind === "directory" && descriptorKind === "file") {
      await removeInterruptedCleanupSuffix({
        roots: input.roots,
        stage,
        leafName: input.leafName,
        scope: input.scope,
      });
      return null;
    }
    throw loadError;
  }
}

async function createFullMaskChildStage(input: {
  readonly roots: PublicationRoots;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly operationIdentitySha256: Sha256;
  readonly startedAtUtc: string;
  readonly predecessorCoverage: GrandHallT554NativeReviewMaskCoverageCarryStateV2 | null;
  readonly predecessorEvidence?: GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2;
}): Promise<{ readonly stage: FullMaskChildStage; readonly created: boolean }> {
  const existing = await loadMaskChildStage(input);
  if (existing !== null) {
    if (existing.mode !== "full") {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Descriptor-only stage cannot substitute for a full mask child stage.",
      );
    }
    return { stage: existing, created: false };
  }
  const targetBindingSha256 = stageTargetBindingSha256(
    input.leafName,
    input.scope,
  );
  const stagePath = stageRootPath(
    input.roots,
    targetBindingSha256,
    input.operationIdentitySha256,
  );
  try {
    await mkdir(stagePath, { mode: 0o700 });
  } catch (error) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Deterministic mask child stage could not be reserved exclusively.",
      error,
    );
  }
  const stageRoot = await inspectDirectDirectory(stagePath);
  await syncPinnedDirectory(input.roots.parent);
  await writeSyncedFile(
    join(stageRoot.absolutePath, "operation.json"),
    stageOperationBytes({
      mode: "full",
      leafName: input.leafName,
      scope: input.scope,
      operationIdentitySha256: input.operationIdentitySha256,
      targetBindingSha256,
    }),
  );
  const stagedChildPath = join(stageRoot.absolutePath, "child");
  await mkdir(stagedChildPath, { mode: 0o700 });
  const stagedJournal = await createGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: stagedChildPath,
    scope: input.scope,
  });
  await stagedJournal.append({
    expectedRevision: 0,
    event: maskStartEvent({
      scope: input.scope,
      startedAtUtc: input.startedAtUtc,
      predecessorCoverage: input.predecessorCoverage,
    }),
    ...(input.predecessorEvidence === undefined
      ? {}
      : { predecessorEvidence: input.predecessorEvidence }),
  });
  await writeSyncedFile(
    join(stageRoot.absolutePath, "descriptor.json"),
    childDescriptorBytes(input.leafName, input.scope),
  );
  await syncPinnedDirectory(stageRoot);
  const created = await loadMaskChildStage(input);
  if (created?.mode !== "full") {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Fresh deterministic mask child stage did not reopen exactly.",
    );
  }
  return { stage: created, created: true };
}

async function createDescriptorMaskChildStage(input: {
  readonly roots: PublicationRoots;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly operationIdentitySha256: Sha256;
}): Promise<DescriptorMaskChildStage> {
  const existing = await loadMaskChildStage(input);
  if (existing !== null) {
    if (existing.mode !== "descriptor_only") {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Full stage must be reconciled instead of replaced by descriptor repair.",
      );
    }
    return existing;
  }
  const targetBindingSha256 = stageTargetBindingSha256(
    input.leafName,
    input.scope,
  );
  const stagePath = stageRootPath(
    input.roots,
    targetBindingSha256,
    input.operationIdentitySha256,
  );
  try {
    await mkdir(stagePath, { mode: 0o700 });
  } catch (error) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Deterministic descriptor stage could not be reserved exclusively.",
      error,
    );
  }
  const stageRoot = await inspectDirectDirectory(stagePath);
  await syncPinnedDirectory(input.roots.parent);
  await writeSyncedFile(
    join(stageRoot.absolutePath, "operation.json"),
    stageOperationBytes({
      mode: "descriptor_only",
      leafName: input.leafName,
      scope: input.scope,
      operationIdentitySha256: input.operationIdentitySha256,
      targetBindingSha256,
    }),
  );
  await writeSyncedFile(
    join(stageRoot.absolutePath, "descriptor.json"),
    childDescriptorBytes(input.leafName, input.scope),
  );
  await syncPinnedDirectory(stageRoot);
  const created = await loadMaskChildStage(input);
  if (created?.mode !== "descriptor_only") {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Fresh deterministic descriptor stage did not reopen exactly.",
    );
  }
  return created;
}

async function createPinnedDirectory(
  path: string,
  parent: DirectDirectoryWitness,
): Promise<DirectDirectoryWitness> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child destination directory could not be created no-replace.",
      error,
    );
  }
  const created = await inspectDirectDirectory(path);
  if (created.state.dev !== parent.state.dev) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child destination directory crossed a filesystem boundary.",
    );
  }
  await syncPinnedDirectory(parent);
  return created;
}

interface PartialPublishedChild {
  readonly root: DirectDirectoryWitness;
  readonly directories: ReadonlyMap<string, DirectDirectoryWitness>;
  readonly scopeFile: ExactFileWitness | null;
  readonly claimFile: ExactFileWitness | null;
  readonly eventFile: ExactFileWitness | null;
}

async function inspectPartialPublishedChild(
  childPath: string,
  staged: StagedJournalWitness,
): Promise<PartialPublishedChild | null> {
  const kind = await optionalDirectKind(childPath);
  if (kind === "absent") return null;
  if (kind !== "directory") {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child destination is not a direct directory.",
    );
  }
  const root = await inspectDirectDirectory(childPath);
  const names = (await readdir(root.absolutePath)).sort();
  if (names.some((name) => !JOURNAL_ROOT_NAMES.includes(
    name as (typeof JOURNAL_ROOT_NAMES)[number],
  ))) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Partial mask child contains an unexplained root node.",
    );
  }
  const directories = new Map<string, DirectDirectoryWitness>();
  let missingDirectorySeen = false;
  for (const name of JOURNAL_ROOT_NAMES.slice(0, 4)) {
    const path = join(root.absolutePath, name);
    const entryKind = await optionalDirectKind(path);
    if (entryKind === "absent") {
      missingDirectorySeen = true;
      continue;
    }
    if (entryKind !== "directory" || missingDirectorySeen) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Partial mask child directories are not the exact writer prefix.",
      );
    }
    const directory = await inspectDirectDirectory(path);
    directories.set(name, directory);
  }
  const claims = directories.get(JOURNAL_CLAIMS_DIRECTORY_NAME);
  const events = directories.get(JOURNAL_EVENTS_DIRECTORY_NAME);
  const pending = directories.get(JOURNAL_PENDING_DIRECTORY_NAME);
  const quarantine = directories.get(JOURNAL_QUARANTINE_DIRECTORY_NAME);
  if (pending !== undefined) await exactNames(pending, []);
  if (quarantine !== undefined) await exactNames(quarantine, []);
  if (claims !== undefined) {
    const claimNames = await readdir(claims.absolutePath);
    if (
      claimNames.length > 1 ||
      (claimNames.length === 1 && claimNames[0] !== FIRST_CLAIM_FILE_NAME)
    ) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Partial mask child has an unexplained claim.",
      );
    }
  }
  if (events !== undefined) {
    const eventNames = await readdir(events.absolutePath);
    const expectedEventName = basename(staged.eventFile.absolutePath);
    if (
      eventNames.length > 1 ||
      (eventNames.length === 1 && eventNames[0] !== expectedEventName)
    ) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Partial mask child has an unexplained event.",
      );
    }
  }
  const scopeFile = await optionalPrefixFile({
    path: join(root.absolutePath, JOURNAL_SCOPE_FILE_NAME),
    expectedBytes: staged.scopeFile.bytes,
    allowedLinkCounts: [1n],
  });
  const scopeComplete = scopeFile?.bytes.equals(staged.scopeFile.bytes) ?? false;
  if (scopeFile !== null && directories.size !== 4) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Partial mask child scope precedes its fixed directory prefix.",
    );
  }
  const claimFile =
    claims === undefined
      ? null
      : await optionalPrefixFile({
          path: join(claims.absolutePath, FIRST_CLAIM_FILE_NAME),
          expectedBytes: staged.claimFile.bytes,
          allowedLinkCounts: [1n, 2n],
        });
  const claimComplete = claimFile?.bytes.equals(staged.claimFile.bytes) ?? false;
  if (claimFile !== null && !scopeComplete) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Partial mask child claim precedes its exact scope file.",
    );
  }
  const eventFile =
    events === undefined
      ? null
      : await optionalExactFile({
          path: join(events.absolutePath, basename(staged.eventFile.absolutePath)),
          expectedBytes: staged.eventFile.bytes,
          allowedLinkCounts: [2n],
        });
  if (
    eventFile !== null &&
    (!claimComplete ||
      claimFile === null ||
      !sameObjectIdentity(eventFile.state, claimFile.state) ||
      claimFile.state.nlink !== 2n)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Partial mask child event has no exact claim hard-link peer.",
    );
  }
  if (
    claimFile !== null &&
    eventFile === null &&
    claimFile.state.nlink !== 1n
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Partial mask child claim has an unexplained external hard link.",
    );
  }
  if (eventFile !== null && !scopeComplete) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Partial mask child event precedes its exact scope file.",
    );
  }
  await assertSameDirectory(root);
  return { root, directories, scopeFile, claimFile, eventFile };
}

async function adoptMaskChildNoReplace(input: {
  readonly roots: PublicationRoots;
  readonly stage: FullMaskChildStage;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly requireFreshReservation: boolean;
}): Promise<GrandHallT554NativeReviewPublishedMaskChildStartV2> {
  const childPath = join(input.roots.children.absolutePath, input.leafName);
  let partial = await inspectPartialPublishedChild(childPath, input.stage.journal);
  if (input.requireFreshReservation && partial !== null) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Fresh mask child publication lost its exclusive destination reservation.",
    );
  }
  if (partial === null) {
    const root = await createPinnedDirectory(childPath, input.roots.children);
    partial = {
      root,
      directories: new Map(),
      scopeFile: null,
      claimFile: null,
      eventFile: null,
    };
  }
  const directories = new Map(partial.directories);
  for (const name of JOURNAL_ROOT_NAMES.slice(0, 4)) {
    if (directories.has(name)) continue;
    directories.set(
      name,
      await createPinnedDirectory(join(partial.root.absolutePath, name), partial.root),
    );
  }
  let scopeFile = partial.scopeFile;
  if (
    scopeFile !== null &&
    !scopeFile.bytes.equals(input.stage.journal.scopeFile.bytes)
  ) {
    await assertSameDirectory(partial.root);
    await unlinkExactWitness(scopeFile);
    await syncPinnedDirectory(partial.root);
    scopeFile = null;
  }
  if (scopeFile === null) {
    const path = join(partial.root.absolutePath, JOURNAL_SCOPE_FILE_NAME);
    await writeSyncedFile(path, input.stage.journal.scopeFile.bytes);
    scopeFile = await readExactDirectFile({
      path,
      maximumByteLength: input.stage.journal.scopeFile.bytes.length,
      allowedLinkCounts: [1n],
      expectedBytes: input.stage.journal.scopeFile.bytes,
    });
    await syncPinnedDirectory(partial.root);
  }
  const claims = directories.get(JOURNAL_CLAIMS_DIRECTORY_NAME);
  const events = directories.get(JOURNAL_EVENTS_DIRECTORY_NAME);
  if (claims === undefined || events === undefined) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child destination directory creation lost a fixed journal directory.",
    );
  }
  let claimFile = partial.claimFile;
  if (
    claimFile !== null &&
    !claimFile.bytes.equals(input.stage.journal.claimFile.bytes)
  ) {
    await assertSameDirectory(partial.root);
    await unlinkExactWitness(claimFile);
    await syncPinnedDirectory(claims);
    claimFile = null;
  }
  if (claimFile === null) {
    const path = join(claims.absolutePath, FIRST_CLAIM_FILE_NAME);
    await writeSyncedFile(path, input.stage.journal.claimFile.bytes);
    claimFile = await readExactDirectFile({
      path,
      maximumByteLength: input.stage.journal.claimFile.bytes.length,
      allowedLinkCounts: [1n],
      expectedBytes: input.stage.journal.claimFile.bytes,
    });
    await syncPinnedDirectory(claims);
  }
  const eventPath = join(
    events.absolutePath,
    basename(input.stage.journal.eventFile.absolutePath),
  );
  if (partial.eventFile === null) {
    try {
      await link(claimFile.absolutePath, eventPath);
    } catch (error) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Mask child event could not be published no-replace.",
        error,
      );
    }
    await syncPinnedDirectory(events);
  }
  await syncExactFile(scopeFile);
  const complete = await inspectPartialPublishedChild(
    childPath,
    input.stage.journal,
  );
  if (
    complete === null ||
    complete.directories.size !== 4 ||
    complete.scopeFile === null ||
    complete.claimFile === null ||
    complete.eventFile === null
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child no-replace adoption did not produce the exact journal topology.",
    );
  }
  await assertSameDirectory(input.roots.session);
  await assertSameDirectory(input.roots.children);
  return await openExactMaskChild({
    sessionRoot: input.roots.session.absolutePath,
    leafName: input.leafName,
    scope: input.scope,
  });
}

async function publishDescriptorNoReplace(input: {
  readonly roots: PublicationRoots;
  readonly stage: MaskChildStage;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly allowExisting: boolean;
}): Promise<boolean> {
  const descriptorPath = join(
    input.roots.descriptors.absolutePath,
    `${input.leafName}.json`,
  );
  const expectedBytes = childDescriptorBytes(input.leafName, input.scope);
  const kind = await optionalDirectKind(descriptorPath);
  if (kind !== "absent") {
    if (!input.allowExisting || kind !== "file") {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Mask descriptor destination already exists; replacement is forbidden.",
      );
    }
    await readExactDirectFile({
      path: descriptorPath,
      maximumByteLength: expectedBytes.length,
      allowedLinkCounts: [1n, 2n],
      expectedBytes,
    });
    return false;
  }
  try {
    await link(input.stage.descriptorFile.absolutePath, descriptorPath);
  } catch (error) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask descriptor could not be hard-linked no-replace.",
      error,
    );
  }
  const staged = await readExactDirectFile({
    path: input.stage.descriptorFile.absolutePath,
    maximumByteLength: expectedBytes.length,
    allowedLinkCounts: [2n],
    expectedBytes,
  });
  const published = await readExactDirectFile({
    path: descriptorPath,
    maximumByteLength: expectedBytes.length,
    allowedLinkCounts: [2n],
    expectedBytes,
  });
  if (!sameObjectIdentity(staged.state, published.state)) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask descriptor publication did not create the exact hard-link pair.",
    );
  }
  await syncExactFile(published);
  await syncPinnedDirectory(input.roots.descriptors);
  return true;
}

async function assertPathAbsent(path: string): Promise<void> {
  try {
    await lstat(path, { bigint: true });
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return;
    throw error;
  }
  throw fail(
    "CHILD_PUBLICATION_INVALID",
    "Exact staged node still exists after removal.",
  );
}

async function unlinkExactWitness(witness: ExactFileWitness): Promise<void> {
  const immediatelyBefore = await lstat(witness.absolutePath, { bigint: true });
  if (!sameFileState(immediatelyBefore, witness.state)) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Exact staged file was replaced before unlink.",
    );
  }
  await unlink(witness.absolutePath);
  await assertPathAbsent(witness.absolutePath);
}

async function removeExactEmptyDirectory(
  witness: DirectDirectoryWitness,
): Promise<void> {
  await exactNames(witness, []);
  const immediatelyBefore = await lstat(witness.absolutePath, { bigint: true });
  if (!sameObjectIdentity(immediatelyBefore, witness.state)) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Exact staged directory was replaced before removal.",
    );
  }
  await rmdir(witness.absolutePath);
  await assertPathAbsent(witness.absolutePath);
}

async function unlinkStagedDescriptor(input: {
  readonly stage: MaskChildStage;
  readonly descriptorPath: string;
  readonly expectedBytes: Buffer;
}): Promise<void> {
  const staged = await readExactDirectFile({
    path: input.stage.descriptorFile.absolutePath,
    maximumByteLength: input.expectedBytes.length,
    allowedLinkCounts: [1n, 2n],
    expectedBytes: input.expectedBytes,
  });
  const published = await readExactDirectFile({
    path: input.descriptorPath,
    maximumByteLength: input.expectedBytes.length,
    allowedLinkCounts: [1n, 2n],
    expectedBytes: input.expectedBytes,
  });
  if (
    staged.state.nlink === 2n &&
    !sameObjectIdentity(staged.state, published.state)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Staged descriptor has an unexplained external hard link.",
    );
  }
  if (
    published.state.nlink === 2n &&
    !sameObjectIdentity(staged.state, published.state)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Published descriptor has an unexplained external hard link.",
    );
  }
  if (
    staged.state.nlink === 1n &&
    sameObjectIdentity(staged.state, published.state)
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Staged descriptor topology is internally inconsistent.",
    );
  }
  await unlinkExactWitness(staged);
  const final = await readExactDirectFile({
    path: input.descriptorPath,
    maximumByteLength: input.expectedBytes.length,
    allowedLinkCounts: [1n],
    expectedBytes: input.expectedBytes,
  });
  await syncExactFile(final);
}

async function cleanupMaskChildStage(input: {
  readonly roots: PublicationRoots;
  readonly stage: MaskChildStage;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
}): Promise<void> {
  const reloaded = await loadMaskChildStage({
    roots: input.roots,
    leafName: input.leafName,
    scope: input.scope,
    operationIdentitySha256: input.stage.operationIdentitySha256,
  });
  if (reloaded === null || reloaded.mode !== input.stage.mode) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Deterministic mask child stage changed before exact cleanup.",
    );
  }
  await openExactMaskChild({
    sessionRoot: input.roots.session.absolutePath,
    leafName: input.leafName,
    scope: input.scope,
  });
  const descriptorPath = join(
    input.roots.descriptors.absolutePath,
    `${input.leafName}.json`,
  );
  const descriptorBytes = childDescriptorBytes(input.leafName, input.scope);
  await unlinkStagedDescriptor({
    stage: reloaded,
    descriptorPath,
    expectedBytes: descriptorBytes,
  });
  if (reloaded.mode === "full") {
    const journal = reloaded.journal;
    const event = await readExactDirectFile({
      path: journal.eventFile.absolutePath,
      maximumByteLength: journal.eventFile.bytes.length,
      allowedLinkCounts: [2n],
      expectedBytes: journal.eventFile.bytes,
    });
    await unlinkExactWitness(event);
    const claim = await readExactDirectFile({
      path: journal.claimFile.absolutePath,
      maximumByteLength: journal.claimFile.bytes.length,
      allowedLinkCounts: [1n],
      expectedBytes: journal.claimFile.bytes,
    });
    if (!sameObjectIdentity(event.state, claim.state)) {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Staged claim identity changed during exact cleanup.",
      );
    }
    await unlinkExactWitness(claim);
    const scopeFile = await readExactDirectFile({
      path: journal.scopeFile.absolutePath,
      maximumByteLength: journal.scopeFile.bytes.length,
      allowedLinkCounts: [1n],
      expectedBytes: journal.scopeFile.bytes,
    });
    await unlinkExactWitness(scopeFile);
    await removeExactEmptyDirectory(journal.claims);
    await removeExactEmptyDirectory(journal.events);
    await removeExactEmptyDirectory(journal.pending);
    await removeExactEmptyDirectory(journal.quarantine);
    await removeExactEmptyDirectory(journal.root);
  }
  const operationFile = await readExactDirectFile({
    path: reloaded.operationFile.absolutePath,
    maximumByteLength: reloaded.operationFile.bytes.length,
    allowedLinkCounts: [1n],
    expectedBytes: reloaded.operationFile.bytes,
  });
  await unlinkExactWitness(operationFile);
  await removeExactEmptyDirectory(reloaded.root);
  await syncPinnedDirectory(input.roots.parent);
  await syncPinnedDirectory(input.roots.descriptors);
}

async function reopenExactPublishedMaskChildPair(input: {
  readonly roots: PublicationRoots;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
}): Promise<GrandHallT554NativeReviewPublishedMaskChildStartV2> {
  await assertSameDirectory(input.roots.session);
  await assertSameDirectory(input.roots.children);
  await assertSameDirectory(input.roots.descriptors);
  await readExactDirectFile({
    path: join(
      input.roots.descriptors.absolutePath,
      `${input.leafName}.json`,
    ),
    maximumByteLength: childDescriptorBytes(input.leafName, input.scope).length,
    allowedLinkCounts: [1n],
    expectedBytes: childDescriptorBytes(input.leafName, input.scope),
  });
  try {
    const reopened = await openExactMaskChild({
      sessionRoot: input.roots.session.absolutePath,
      leafName: input.leafName,
      scope: input.scope,
    });
    await assertSameDirectory(input.roots.session);
    await assertSameDirectory(input.roots.children);
    await assertSameDirectory(input.roots.descriptors);
    return reopened;
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewSessionOrchestrationV2Error) {
      throw error;
    }
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Published mask child changed during stage cleanup or final reopen.",
      error,
    );
  }
}

export async function publishGrandHallT554NativeReviewMaskChildStartV2(input: {
  readonly sessionRoot: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly leafName: string;
  readonly startedAtUtc: string;
  readonly predecessorCoverage: GrandHallT554NativeReviewMaskCoverageCarryStateV2 | null;
  readonly predecessorEvidence?: GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2;
  /** The exact durable coordinator operation identity; never a retry nonce. */
  readonly stageIdentitySha256: Sha256;
  readonly afterChildPublished?: () => Promise<void> | void;
  readonly afterDescriptorPublished?: () => Promise<void> | void;
  readonly afterStageCleanupBeforePublicationReopen?: () =>
    | Promise<void>
    | void;
}): Promise<GrandHallT554NativeReviewPublishedMaskChildStartV2> {
  assertSafeLeafName(input.leafName);
  const scope = GrandHallT554NativeReviewMaskScopeV2Schema.parse(input.scope);
  const stageIdentitySha256 = GrandHallT554NativeReviewSha256V2Schema.parse(
    input.stageIdentitySha256,
  );
  const startedAtUtc = GrandHallT554NativeReviewCanonicalUtcV2Schema.parse(
    input.startedAtUtc,
  );
  const roots = await inspectPublicationRoots(input.sessionRoot);
  const childPath = join(roots.children.absolutePath, input.leafName);
  const descriptorPath = join(
    roots.descriptors.absolutePath,
    `${input.leafName}.json`,
  );
  if (
    (await directKind(childPath)) !== "absent" ||
    (await directKind(descriptorPath)) !== "absent"
  ) {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Fresh mask child publication requires absent child and descriptor paths.",
    );
  }
  const staged = await createFullMaskChildStage({
    roots,
    leafName: input.leafName,
    scope,
    operationIdentitySha256: stageIdentitySha256,
    startedAtUtc,
    predecessorCoverage: input.predecessorCoverage,
    ...(input.predecessorEvidence === undefined
      ? {}
      : { predecessorEvidence: input.predecessorEvidence }),
  });
  await adoptMaskChildNoReplace({
    roots,
    stage: staged.stage,
    leafName: input.leafName,
    scope,
    requireFreshReservation: staged.created,
  });
  await input.afterChildPublished?.();
  await publishDescriptorNoReplace({
    roots,
    stage: staged.stage,
    leafName: input.leafName,
    scope,
    allowExisting: false,
  });
  await input.afterDescriptorPublished?.();
  await cleanupMaskChildStage({
    roots,
    stage: staged.stage,
    leafName: input.leafName,
    scope,
  });
  await input.afterStageCleanupBeforePublicationReopen?.();
  return await reopenExactPublishedMaskChildPair({
    roots,
    leafName: input.leafName,
    scope,
  });
}

export type GrandHallT554NativeReviewReconciledMaskChildStartV2 =
  | {
      readonly disposition: "absent";
      readonly journal: null;
      readonly evidence: null;
    }
  | ({ readonly disposition: "exact" } &
      GrandHallT554NativeReviewPublishedMaskChildStartV2);

export async function reconcileGrandHallT554NativeReviewMaskChildStartV2(input: {
  readonly sessionRoot: string;
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly leafName: string;
  /** The same durable operation identity used by the interrupted publication. */
  readonly descriptorStageIdentitySha256: Sha256;
  readonly afterDescriptorPublished?: () => Promise<void> | void;
  readonly afterStageCleanupBeforePublicationReopen?: () =>
    | Promise<void>
    | void;
}): Promise<GrandHallT554NativeReviewReconciledMaskChildStartV2> {
  assertSafeLeafName(input.leafName);
  const scope = GrandHallT554NativeReviewMaskScopeV2Schema.parse(input.scope);
  const descriptorStageIdentitySha256 =
    GrandHallT554NativeReviewSha256V2Schema.parse(
      input.descriptorStageIdentitySha256,
    );
  const roots = await inspectPublicationRoots(input.sessionRoot);
  const childPath = join(roots.children.absolutePath, input.leafName);
  const descriptorPath = join(
    roots.descriptors.absolutePath,
    `${input.leafName}.json`,
  );
  const childKind = await directKind(childPath);
  const descriptorKind = await directKind(descriptorPath);
  if (childKind !== "absent" && childKind !== "directory") {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask child path is not absent or a direct directory.",
    );
  }
  if (descriptorKind !== "absent" && descriptorKind !== "file") {
    throw fail(
      "CHILD_PUBLICATION_INVALID",
      "Mask descriptor path is not absent or a direct file.",
    );
  }
  let stage = await loadOrRecoverInterruptedMaskChildStage({
    roots,
    leafName: input.leafName,
    scope,
    operationIdentitySha256: descriptorStageIdentitySha256,
  });
  if (childKind === "absent") {
    if (descriptorKind !== "absent") {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Mask descriptor exists without its atomically prior child journal.",
      );
    }
    if (stage === null) {
      return { disposition: "absent", journal: null, evidence: null };
    }
    if (stage.mode !== "full") {
      throw fail(
        "CHILD_PUBLICATION_INVALID",
        "Mask descriptor exists without its atomically prior child journal.",
      );
    }
  }
  if (stage?.mode === "full") {
    await adoptMaskChildNoReplace({
      roots,
      stage,
      leafName: input.leafName,
      scope,
      requireFreshReservation: false,
    });
    const descriptorCreated = await publishDescriptorNoReplace({
      roots,
      stage,
      leafName: input.leafName,
      scope,
      allowExisting: true,
    });
    if (descriptorCreated) await input.afterDescriptorPublished?.();
    await cleanupMaskChildStage({
      roots,
      stage,
      leafName: input.leafName,
      scope,
    });
    await input.afterStageCleanupBeforePublicationReopen?.();
    return {
      disposition: "exact",
      ...(await reopenExactPublishedMaskChildPair({
        roots,
        leafName: input.leafName,
        scope,
      })),
    };
  }
  await openExactMaskChild({
    sessionRoot: roots.session.absolutePath,
    leafName: input.leafName,
    scope,
  });
  if (descriptorKind === "absent") {
    if (stage === null) {
      stage = await createDescriptorMaskChildStage({
        roots,
        leafName: input.leafName,
        scope,
        operationIdentitySha256: descriptorStageIdentitySha256,
      });
    }
    const descriptorCreated = await publishDescriptorNoReplace({
      roots,
      stage,
      leafName: input.leafName,
      scope,
      allowExisting: true,
    });
    if (descriptorCreated) await input.afterDescriptorPublished?.();
  }
  await readExactDirectFile({
    path: descriptorPath,
    maximumByteLength: childDescriptorBytes(input.leafName, scope).length,
    allowedLinkCounts: stage === null ? [1n] : [1n, 2n],
    expectedBytes: childDescriptorBytes(input.leafName, scope),
  });
  if (stage !== null) {
    await cleanupMaskChildStage({
      roots,
      stage,
      leafName: input.leafName,
      scope,
    });
    await input.afterStageCleanupBeforePublicationReopen?.();
  }
  return {
    disposition: "exact",
    ...(await reopenExactPublishedMaskChildPair({
      roots,
      leafName: input.leafName,
      scope,
    })),
  };
}

function coordinatorEvent<Event extends GrandHallT554NativeReviewCoordinatorEventV2>(
  eventType: Event["eventType"],
  payload: Event["payload"],
): Event {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType,
    payload,
  } as Event;
}

export async function rotateGrandHallT554NativeReviewBrowserEpochV2(input: {
  readonly reason: "clean_resume" | "crash_resume";
  readonly sessionRoot: string;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly coordinatorJournal: GrandHallT554NativeReviewDurableJournalV2;
  readonly store: GrandHallT554NativeReviewSessionStoreReplayV2;
  readonly newBrowserEpochNonceSha256: Sha256;
  readonly startedAtUtc: string;
  readonly afterDurable?: () => Promise<void> | void;
}): Promise<GrandHallT554NativeReviewSessionStoreReplayV2> {
  await assertGrandHallT554NativeReviewSessionOwnerV2({
    lease: input.lease,
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
  });
  const browser = input.store.coordinator.browserEpoch;
  if (browser === null || input.store.coordinator.pendingIntent !== null) {
    throw fail(
      "BROWSER_EPOCH_INVALID",
      "Browser rotation requires a predecessor epoch and no pending intent.",
    );
  }
  const newBrowserEpochNonceSha256 =
    GrandHallT554NativeReviewSha256V2Schema.parse(
      input.newBrowserEpochNonceSha256,
    );
  const startedAtUtc = GrandHallT554NativeReviewCanonicalUtcV2Schema.parse(
    input.startedAtUtc,
  );
  const activeSource = latestVerifiedActiveSourceEvidenceV2(input.store);
  const activeMask = latestVerifiedActiveMaskEvidenceV2(input.store);
  const replay = await input.coordinatorJournal.replay();
  if (
    replay.revision !== input.store.coordinatorJournal.revision ||
    replay.headEventSha256 !== input.store.coordinatorJournal.headEventSha256
  ) {
    throw fail(
      "BROWSER_EPOCH_INVALID",
      "Coordinator journal changed after the verified session-store snapshot.",
    );
  }
  await input.coordinatorJournal.append({
    expectedRevision: replay.revision,
    event: coordinatorEvent<Extract<
      GrandHallT554NativeReviewCoordinatorEventV2,
      { readonly eventType: "session.browser-epoch-started.v2" }
    >>("session.browser-epoch-started.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2",
      browserEpochNumber: browser.number + 1,
      browserEpochNonceSha256: newBrowserEpochNonceSha256,
      previousBrowserEpochNonceSha256: browser.nonceSha256,
      reason: input.reason,
      priorActiveSourceJournal: activeSource?.checkpoint ?? null,
      priorActiveMaskJournal: activeMask?.checkpoint ?? null,
      workspaceRevision: input.store.coordinator.workspaceRevision,
      maximumAllocatedRenderGeneration:
        input.store.coordinator.maximumAllocatedRenderGeneration,
      startedAtUtc,
    }),
  });
  await input.afterDurable?.();
  return await openGrandHallT554NativeReviewSessionStoreV2({
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
    lease: input.lease,
  });
}

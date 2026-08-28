import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import {
  computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256,
  computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256,
  computeGrandHallT554NativeReviewMaskSubjectV2Sha256,
  replayGrandHallT554NativeReviewCoordinatorV2,
  type GrandHallT554NativeReviewCoordinatorChildObligationV2,
  type GrandHallT554NativeReviewCoordinatorReplayV2,
} from "./grand-hall-t554-native-review-coordinator-replay-v2.js";
import {
  deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2,
  openGrandHallT554NativeReviewDurableJournalV2,
  openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2,
  type GrandHallT554NativeReviewDurableJournalReplayV2,
  type GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
} from "./grand-hall-t554-native-review-durable-journal-v2.js";
import {
  GrandHallT554NativeReviewJournalScopeV2Schema,
  GrandHallT554NativeReviewSessionScopeV2Schema,
  type GrandHallT554NativeReviewCoordinatorEventV2,
  type GrandHallT554NativeReviewFrozenMaskBindingV2,
  type GrandHallT554NativeReviewMaskChildCheckpointV2,
  type GrandHallT554NativeReviewMaskScopeV2,
  type GrandHallT554NativeReviewPreparedMaskBindingV2,
  type GrandHallT554NativeReviewSessionScopeV2,
  type GrandHallT554NativeReviewSourceCustodyBindingV2,
  type GrandHallT554NativeReviewSourceChildCheckpointV2,
  type GrandHallT554NativeReviewSourceScopeV2,
} from "./grand-hall-t554-native-review-events-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_MAXIMUM_TELEMETRY_EVENTS,
  GRAND_HALL_T554_NATIVE_TILE_COUNT,
} from "./grand-hall-t554-native-review-coverage.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA,
} from "./grand-hall-t554-native-review-implementation-manifest.js";
import {
  verifyGrandHallT554NativeMaskEvidence,
  type GrandHallT554VerifiedMaskEvidence,
} from "./grand-hall-t554-native-media-kernel.js";
import {
  buildGrandHallT554NativeMaskReplayContextV2,
  verifyGrandHallT554NativeMaskStateReplayV2,
  type GrandHallT554NativeMaskReplayV2,
} from "./grand-hall-t554-native-review-mask-replay-v2.js";
import { isSafeGrandHallT554RelativePath } from "./grand-hall-t554-path-safety.js";
import {
  createGrandHallT554NativeReviewCoverageCarryStateV2,
  replayGrandHallT554NativeReviewMaskChildV2,
  replayGrandHallT554NativeReviewSourceChildV2,
  type GrandHallT554NativeReviewChildReplayV2,
} from "./grand-hall-t554-native-review-replay-v2.js";
import type { GrandHallT554NativeMaskExactStateV2 } from "./grand-hall-t554-native-review-mask-store.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";
import {
  grandHallT554V3ComparablePath,
  grandHallT554V3SameFileState,
  grandHallT554V3SameNode,
} from "./grand-hall-t554-review-pack-v3-files.js";
import {
  assertGrandHallT554NativeReviewSessionOwnerV2,
  GrandHallT554NativeReviewSessionOwnerV2Error,
  type GrandHallT554NativeReviewSessionOwnerLeaseV2,
} from "./grand-hall-t554-native-review-session-owner-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_COUNT,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_TOTAL_EVENT_BYTES,
} from "./grand-hall-t554-native-review-journal.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_SESSION_ROOT_DESCRIPTOR_V2 =
  "venviewer.grand-hall-t554-native-review-session-root-descriptor.v2";
export const GRAND_HALL_T554_NATIVE_REVIEW_SESSION_STORE_REPLAY_V2 =
  "venviewer.grand-hall-t554-native-review-session-store-replay.v2";
export const GRAND_HALL_T554_NATIVE_REVIEW_SESSION_VERIFICATION_ATTESTATION_V2 =
  "venviewer.grand-hall-t554-native-review-session-verification-attestation.v2";

const ROOT_DESCRIPTOR_FILE = "session-root.json";
const COORDINATOR_DIRECTORY = "coordinator";
const CHILD_SCOPES_DIRECTORY = "child-scopes";
const CHILDREN_DIRECTORY = "children";
const MASK_EVIDENCE_DIRECTORY = "mask-evidence";
const CHILD_SCOPE_DESCRIPTOR_SCHEMA =
  "venviewer.grand-hall-t554-native-review-child-scope-descriptor.v2";
const ROOT_INVENTORY_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_SESSION_ROOT_INVENTORY_V2";
const VERIFICATION_ATTESTATION_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_SESSION_VERIFICATION_ATTESTATION_V2";
const IMPLEMENTATION_MANIFEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_V1";
const REVIEW_SOURCE_COUNT = 148;
const MAXIMUM_REVIEW_CHILDREN_PER_SOURCE = 2;
const MAXIMUM_CHILD_EVENT_COUNT =
  1 + GRAND_HALL_T554_NATIVE_TILE_COUNT +
  GRAND_HALL_T554_NATIVE_REVIEW_MAXIMUM_TELEMETRY_EVENTS;
const MAXIMUM_COORDINATOR_EVENT_COUNT = 16_384;
const JOURNAL_FIXED_ENTRY_COUNT = 5;
const ROOT_FIXED_ENTRY_COUNT = 6;
const MAXIMUM_REGISTRY_CHILD_COUNT =
  REVIEW_SOURCE_COUNT * MAXIMUM_REVIEW_CHILDREN_PER_SOURCE;
const MAXIMUM_MASK_EVIDENCE_FILE_COUNT = REVIEW_SOURCE_COUNT * 2;
const REQUIRED_REGISTRY_MAXIMUM_ROOT_ENTRY_COUNT =
  ROOT_FIXED_ENTRY_COUNT +
  MAXIMUM_REGISTRY_CHILD_COUNT *
    (1 + 1 + JOURNAL_FIXED_ENTRY_COUNT + 2 * MAXIMUM_CHILD_EVENT_COUNT +
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_COUNT) +
  JOURNAL_FIXED_ENTRY_COUNT + 2 * MAXIMUM_COORDINATOR_EVENT_COUNT +
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_COUNT +
  MAXIMUM_MASK_EVIDENCE_FILE_COUNT;
// A full 148-source session may legally retain one source and one mask child
// for each source at the child-event maximum. This exact arithmetic keeps the
// DoS ceiling finite while the invariant test avoids a multi-million-file fixture.
const MAXIMUM_ROOT_ENTRY_COUNT =
  REQUIRED_REGISTRY_MAXIMUM_ROOT_ENTRY_COUNT + 4_096;
const MAXIMUM_ROOT_FILE_BYTES = 64 * 1_024 * 1_024;
const MAXIMUM_CHILD_COUNT = 4_096;
const MAXIMUM_DESCRIPTOR_BYTES = 512 * 1_024;
const MAXIMUM_JOURNAL_UNIQUE_BYTES =
  2n * BigInt(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_TOTAL_EVENT_BYTES);
const REQUIRED_REGISTRY_MAXIMUM_ROOT_TOTAL_BYTES =
  BigInt(MAXIMUM_REGISTRY_CHILD_COUNT + 1) *
    MAXIMUM_JOURNAL_UNIQUE_BYTES +
  BigInt(MAXIMUM_MASK_EVIDENCE_FILE_COUNT) * BigInt(MAXIMUM_ROOT_FILE_BYTES) +
  BigInt(2 + MAXIMUM_REGISTRY_CHILD_COUNT * 2 + 1) *
    BigInt(MAXIMUM_DESCRIPTOR_BYTES);
// Count unique filesystem nodes, not authenticated claim/event aliases. The
// aggregate is independently bounded instead of multiplying every file by its
// per-file ceiling.
const MAXIMUM_ROOT_TOTAL_BYTES =
  REQUIRED_REGISTRY_MAXIMUM_ROOT_TOTAL_BYTES + 1_024n * 1_024n * 1_024n;
const MAXIMUM_RELATIVE_PATH_DEPTH = 8;
const MAXIMUM_RELATIVE_PATH_UTF8_BYTES = 1_024;
const MAXIMUM_CHILD_LEAF_UTF8_BYTES = 250;
const ROOT_NAMES = [
  CHILDREN_DIRECTORY,
  CHILD_SCOPES_DIRECTORY,
  COORDINATOR_DIRECTORY,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  MASK_EVIDENCE_DIRECTORY,
  ROOT_DESCRIPTOR_FILE,
].sort(lexicalOrder);

type Sha256 = `sha256:${string}`;
type IntentEvent = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  {
    readonly eventType:
      | "source.selection-intended.v2"
      | "mask.freeze-intended.v2"
      | "coverage.segment-resume-intended.v2";
  }
>;
type ResolutionEvent = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  {
    readonly eventType:
      | "source.selection-committed.v2"
      | "source.selection-recovery-aborted.v2"
      | "mask.freeze-committed.v2"
      | "mask.freeze-recovery-aborted.v2"
      | "coverage.segment-resume-committed.v2"
      | "coverage.segment-resume-recovery-aborted.v2";
  }
>;

const SessionRootDescriptorV2Schema = z
  .object({
    schemaVersion: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_SESSION_ROOT_DESCRIPTOR_V2,
    ),
    sessionScope: GrandHallT554NativeReviewSessionScopeV2Schema,
    implementationManifestFileName: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
    ),
    coordinatorDirectoryName: z.literal(COORDINATOR_DIRECTORY),
    childScopesDirectoryName: z.literal(CHILD_SCOPES_DIRECTORY),
    childrenDirectoryName: z.literal(CHILDREN_DIRECTORY),
    maskEvidenceDirectoryName: z.literal(MASK_EVIDENCE_DIRECTORY),
  })
  .strict();

const ChildScopeDescriptorV2Schema = z
  .object({
    schemaVersion: z.literal(CHILD_SCOPE_DESCRIPTOR_SCHEMA),
    leafName: z.string(),
    scope: GrandHallT554NativeReviewJournalScopeV2Schema,
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (descriptor.scope.kind === "session") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "kind"],
        message: "child descriptor cannot contain a session scope",
      });
    }
  });

export interface GrandHallT554NativeReviewSessionStoreChildV2 {
  readonly leafName: string;
  readonly disposition: GrandHallT554NativeReviewCoordinatorChildObligationV2["disposition"];
  readonly scope:
    | GrandHallT554NativeReviewSourceScopeV2
    | GrandHallT554NativeReviewMaskScopeV2;
  readonly evidence: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2;
}

export interface GrandHallT554NativeReviewSessionStoreReplayV2 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_SESSION_STORE_REPLAY_V2;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly coordinatorJournal: GrandHallT554NativeReviewDurableJournalReplayV2;
  readonly coordinator: GrandHallT554NativeReviewCoordinatorReplayV2;
  readonly children: readonly GrandHallT554NativeReviewSessionStoreChildV2[];
  readonly maskStateReplayCount: number;
  /** Byte-tree commitment only; it conveys no semantic verification. */
  readonly rootInventorySha256: Sha256;
  readonly verificationAttestationSha256: Sha256;
}

export class GrandHallT554NativeReviewSessionStoreV2Error extends Error {
  constructor(
    readonly code:
      | "ARGUMENT_INVALID"
      | "ROOT_UNSAFE"
      | "INVENTORY_INVALID"
      | "DESCRIPTOR_INVALID"
      | "IMPLEMENTATION_MISMATCH"
      | "COORDINATOR_INVALID"
      | "CHILD_MISMATCH"
      | "MASK_EVIDENCE_MISMATCH"
      | "MASK_STATE_MISMATCH"
      | "ROOT_CHANGED"
      | "LIMIT_REACHED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewSessionStoreV2Error";
  }
}

interface NodeWitness {
  readonly absolutePath: string;
  readonly stats: BigIntStats;
}

interface InventoryEntry {
  readonly relativePath: string;
  readonly kind: "directory" | "file";
  readonly stats: BigIntStats;
  readonly sha256: Sha256 | null;
  readonly byteLength: number;
}

interface RootInventory {
  readonly root: NodeWitness;
  readonly entries: readonly InventoryEntry[];
  readonly entriesByPath: ReadonlyMap<string, InventoryEntry>;
  /** Paths, node kinds, byte lengths, byte hashes, and internal link topology only. */
  readonly rootInventorySha256: Sha256;
}

interface Declaration {
  readonly intent: IntentEvent;
  resolution: ResolutionEvent | null;
}

interface SessionStoreSeam {
  readonly afterInitialInventory?: (root: string) => Promise<void> | void;
  readonly afterUniqueFileRead?: (relativePath: string) => Promise<void> | void;
}

function fail(
  code: GrandHallT554NativeReviewSessionStoreV2Error["code"],
  message: string,
  cause?: unknown,
): GrandHallT554NativeReviewSessionStoreV2Error {
  return new GrandHallT554NativeReviewSessionStoreV2Error(
    code,
    message,
    cause,
  );
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

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(
    value as Readonly<Record<string, unknown>>,
  )) {
    deepFreeze(child);
  }
  return Object.freeze(value);
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

function safeLeaf(name: string): boolean {
  return (
    name.normalize("NFC") === name &&
    isSafeGrandHallT554RelativePath(name) &&
    /^[a-z0-9][a-z0-9._-]{0,254}$/u.test(name) &&
    !name.includes("..") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

function safeChildLeaf(name: string): boolean {
  return safeLeaf(name) && Buffer.byteLength(name, "utf8") <= MAXIMUM_CHILD_LEAF_UTF8_BYTES;
}

function assertBoundedRelativePath(relativePath: string): void {
  const depth = relativePath === "" ? 0 : relativePath.split("/").length;
  if (
    depth > MAXIMUM_RELATIVE_PATH_DEPTH ||
    Buffer.byteLength(relativePath, "utf8") > MAXIMUM_RELATIVE_PATH_UTF8_BYTES
  ) {
    throw fail(
      "LIMIT_REACHED",
      "Session-root relative path exceeds its fixed depth or UTF-8 byte bound.",
    );
  }
}

async function directNode(
  absolutePath: string,
  kind: "file" | "directory",
): Promise<NodeWitness> {
  const before = await lstat(absolutePath, { bigint: true });
  const canonical = await realpath(absolutePath);
  const after = await lstat(absolutePath, { bigint: true });
  if (
    (kind === "file" ? !before.isFile() : !before.isDirectory()) ||
    before.isSymbolicLink() ||
    grandHallT554V3ComparablePath(canonical) !==
      grandHallT554V3ComparablePath(absolutePath) ||
    !grandHallT554V3SameFileState(before, after)
  ) {
    throw fail("ROOT_UNSAFE", "Session root contains an aliased or unstable node.");
  }
  return { absolutePath, stats: after };
}

interface JournalLinkMember {
  readonly journalRoot: string;
  readonly sequence: string;
  readonly role: "claim" | "event" | "pending";
}

function journalLinkMember(relativePath: string): JournalLinkMember | null {
  const claim =
    /^(coordinator|children\/[a-z0-9][a-z0-9._-]{0,254})\/claims\/([0-9]{16})\.json$/u.exec(
      relativePath,
    );
  if (claim !== null && claim[1] !== undefined && claim[2] !== undefined) {
    return { journalRoot: claim[1], sequence: claim[2], role: "claim" };
  }
  const event =
    /^(coordinator|children\/[a-z0-9][a-z0-9._-]{0,254})\/events\/([0-9]{16})-sha256-[0-9a-f]{64}\.json$/u.exec(
      relativePath,
    );
  if (event !== null && event[1] !== undefined && event[2] !== undefined) {
    return { journalRoot: event[1], sequence: event[2], role: "event" };
  }
  const pending =
    /^(coordinator|children\/[a-z0-9][a-z0-9._-]{0,254})\/pending\/pending-([0-9]{16})-sha256-[0-9a-f]{64}-[0-9a-f]{32}\.json$/u.exec(
      relativePath,
    );
  if (pending !== null && pending[1] !== undefined && pending[2] !== undefined) {
    return { journalRoot: pending[1], sequence: pending[2], role: "pending" };
  }
  return null;
}

function isExactInternalJournalLinkGroup(
  entries: readonly InventoryEntry[],
  allowCrashResidues: boolean,
): boolean {
  if (entries.length < 2 || entries.length > 3) return false;
  const members = entries.map((entry) => journalLinkMember(entry.relativePath));
  const first = members[0];
  if (
    first === undefined ||
    first === null ||
    members.some(
      (member) =>
        member === null ||
        member.journalRoot !== first.journalRoot ||
        member.sequence !== first.sequence,
    ) ||
    entries.some((entry) => entry.stats.nlink !== BigInt(entries.length))
  ) {
    return false;
  }
  const roles = new Set(members.map((member) => member?.role));
  if (roles.size !== entries.length || !roles.has("claim")) return false;
  return (
    (entries.length === 2 && roles.has("event")) ||
    (allowCrashResidues && entries.length === 2 && roles.has("pending")) ||
    (allowCrashResidues &&
      entries.length === 3 &&
      roles.has("event") &&
      roles.has("pending"))
  );
}

function assertExactRootLinkTopology(
  filesByIdentity: ReadonlyMap<string, readonly InventoryEntry[]>,
  allowCrashResidues: boolean,
): void {
  for (const entries of filesByIdentity.values()) {
    if (
      (entries.length === 1 && entries[0]?.stats.nlink === 1n) ||
      isExactInternalJournalLinkGroup(entries, allowCrashResidues)
    ) {
      continue;
    }
    throw fail(
      "ROOT_UNSAFE",
      `Session root contains an external or non-journal hardlink alias: ${entries
        .map((entry) => `${entry.relativePath} (nlink=${String(entry.stats.nlink)})`)
        .join(", ")}.`,
    );
  }
}

async function readExactly(handle: FileHandle, byteLength: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const result = await handle.read(bytes, offset, byteLength - offset, offset);
    if (result.bytesRead < 1) throw fail("ROOT_CHANGED", "File truncated during read.");
    offset += result.bytesRead;
  }
  const probe = Buffer.allocUnsafe(1);
  if ((await handle.read(probe, 0, 1, byteLength)).bytesRead !== 0) {
    throw fail("ROOT_CHANGED", "File grew during bounded read.");
  }
  return bytes;
}

async function readStableFile(
  absolutePath: string,
  expected: BigIntStats,
  maximumBytes: number,
): Promise<Buffer> {
  const node = await directNode(absolutePath, "file");
  if (
    !grandHallT554V3SameFileState(node.stats, expected) ||
    node.stats.size > BigInt(maximumBytes)
  ) {
    throw fail("ROOT_CHANGED", "File differs from its bounded inventory witness.");
  }
  const handle = await open(absolutePath, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!grandHallT554V3SameFileState(before, node.stats)) {
      throw fail("ROOT_CHANGED", "File descriptor differs from its path witness.");
    }
    const bytes = await readExactly(handle, Number(before.size));
    const after = await handle.stat({ bigint: true });
    const pathAfter = await directNode(absolutePath, "file");
    if (
      !grandHallT554V3SameFileState(before, after) ||
      !grandHallT554V3SameFileState(after, pathAfter.stats)
    ) {
      throw fail("ROOT_CHANGED", "File changed during descriptor-bound read.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function assertWithin(root: string, candidate: string): void {
  const fromRoot = relative(
    grandHallT554V3ComparablePath(root),
    grandHallT554V3ComparablePath(candidate),
  );
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw fail("ROOT_UNSAFE", "Session-root member escaped its fixed root.");
  }
}

async function snapshotRoot(
  rootPath: string,
  options: {
    readonly allowJournalCrashResidues: boolean;
    readonly afterUniqueFileRead?: (relativePath: string) => Promise<void> | void;
  },
): Promise<RootInventory> {
  const root = await directNode(rootPath, "directory");
  const entries: InventoryEntry[] = [];
  const folded = new Set<string>();
  const directoryIdentities = new Set<string>([
    `${String(root.stats.dev)}:${String(root.stats.ino)}`,
  ]);
  const filesByIdentity = new Map<string, InventoryEntry[]>();
  const verifiedFileByIdentity = new Map<
    string,
    {
      readonly stats: BigIntStats;
      readonly sha256: Sha256;
      readonly byteLength: number;
    }
  >();
  let totalBytes = 0n;
  const visit = async (relativeDirectory: string): Promise<void> => {
    assertBoundedRelativePath(relativeDirectory);
    const absoluteDirectory =
      relativeDirectory === "" ? rootPath : join(rootPath, ...relativeDirectory.split("/"));
    const before = await directNode(absoluteDirectory, "directory");
    const dirents = await readdir(absoluteDirectory, { withFileTypes: true });
    const direntsByName = new Map(dirents.map((dirent) => [dirent.name, dirent]));
    const names = [...direntsByName.keys()].sort(lexicalOrder);
    const localFolded = new Set<string>();
    for (const name of names) {
      if (!safeLeaf(name) || localFolded.has(name.toLowerCase())) {
        throw fail("ROOT_UNSAFE", "Session-root inventory contains an unsafe or case-colliding name.");
      }
      localFolded.add(name.toLowerCase());
    }
    for (const name of names) {
      const relativePath = relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
      assertBoundedRelativePath(relativePath);
      const foldedPath = relativePath.toLowerCase();
      if (folded.has(foldedPath)) throw fail("ROOT_UNSAFE", "Recursive path collision detected.");
      folded.add(foldedPath);
      if (++totalEntryCount > MAXIMUM_ROOT_ENTRY_COUNT) {
        throw fail("LIMIT_REACHED", "Session-root entry count exceeds its fixed bound.");
      }
      const absolutePath = join(rootPath, ...relativePath.split("/"));
      assertWithin(rootPath, absolutePath);
      const dirent = direntsByName.get(name);
      if (dirent === undefined) {
        throw fail("ROOT_CHANGED", "Inventoried directory entry disappeared.");
      }
      const kind = dirent.isDirectory() ? "directory" : "file";
      const node = await directNode(absolutePath, kind);
      if (node.stats.dev !== root.stats.dev) {
        throw fail("ROOT_UNSAFE", "Session root crosses a filesystem boundary.");
      }
      const identity = `${String(node.stats.dev)}:${String(node.stats.ino)}`;
      if (kind === "directory") {
        if (directoryIdentities.has(identity) || filesByIdentity.has(identity)) {
          throw fail("ROOT_UNSAFE", "Session root contains a directory alias.");
        }
        directoryIdentities.add(identity);
        entries.push({ relativePath, kind, stats: node.stats, sha256: null, byteLength: 0 });
        await visit(relativePath);
      } else {
        if (directoryIdentities.has(identity)) {
          throw fail("ROOT_UNSAFE", "Session root aliases a directory as a file.");
        }
        if (node.stats.size > BigInt(MAXIMUM_ROOT_FILE_BYTES)) {
          throw fail("LIMIT_REACHED", "Session-root file exceeds its fixed bound.");
        }
        const priorVerified = verifiedFileByIdentity.get(identity);
        if (
          priorVerified !== undefined &&
          !grandHallT554V3SameFileState(priorVerified.stats, node.stats)
        ) {
          throw fail("ROOT_CHANGED", "Hardlinked file changed between alias witnesses.");
        }
        if (priorVerified === undefined) totalBytes += node.stats.size;
        if (totalBytes > MAXIMUM_ROOT_TOTAL_BYTES) {
          throw fail("LIMIT_REACHED", "Session-root byte inventory exceeds its fixed bound.");
        }
        let verified = priorVerified;
        if (verified === undefined) {
          const bytes = await readStableFile(
            absolutePath,
            node.stats,
            MAXIMUM_ROOT_FILE_BYTES,
          );
          await options.afterUniqueFileRead?.(relativePath);
          verified = {
            stats: node.stats,
            sha256: sha256(bytes),
            byteLength: bytes.length,
          };
          verifiedFileByIdentity.set(identity, verified);
        }
        const inventoryEntry: InventoryEntry = {
          relativePath,
          kind,
          stats: node.stats,
          sha256: verified.sha256,
          byteLength: verified.byteLength,
        };
        entries.push(inventoryEntry);
        const aliases = filesByIdentity.get(identity) ?? [];
        aliases.push(inventoryEntry);
        filesByIdentity.set(identity, aliases);
      }
    }
    const after = await directNode(absoluteDirectory, "directory");
    if (!grandHallT554V3SameFileState(before.stats, after.stats)) {
      throw fail("ROOT_CHANGED", "Directory changed during recursive inventory.");
    }
  };
  let totalEntryCount = 0;
  await visit("");
  assertExactRootLinkTopology(filesByIdentity, options.allowJournalCrashResidues);
  if (
    !options.allowJournalCrashResidues &&
    entries.some(
      (candidate) =>
        candidate.kind === "file" && journalLinkMember(candidate.relativePath)?.role === "pending",
    )
  ) {
    throw fail("ROOT_UNSAFE", "A verified final session root cannot retain pending journal attempts.");
  }
  const rootNames = entries
    .filter((entry) => !entry.relativePath.includes("/"))
    .map((entry) => entry.relativePath)
    .sort(lexicalOrder);
  if (rootNames.join("\n") !== ROOT_NAMES.join("\n")) {
    throw fail("INVENTORY_INVALID", "Session root does not have its exact fixed inventory.");
  }
  const linkTopologyByPath = new Map<string, readonly string[]>();
  for (const aliases of filesByIdentity.values()) {
    const paths = aliases.map((candidate) => candidate.relativePath).sort(lexicalOrder);
    for (const path of paths) linkTopologyByPath.set(path, paths);
  }
  const material = entries
    .sort((left, right) => lexicalOrder(left.relativePath, right.relativePath))
    .map((entry) => ({
      relativePath: entry.relativePath,
      kind: entry.kind,
      byteLength: entry.byteLength,
      sha256: entry.sha256,
      hardlinkPaths:
        entry.kind === "file"
          ? (linkTopologyByPath.get(entry.relativePath) ?? [])
          : null,
    }));
  const orderedEntries = entries.sort((left, right) =>
    lexicalOrder(left.relativePath, right.relativePath),
  );
  return {
    root,
    entries: orderedEntries,
    entriesByPath: new Map(
      orderedEntries.map((candidate) => [candidate.relativePath, candidate]),
    ),
    rootInventorySha256: canonicalDigest(ROOT_INVENTORY_DOMAIN, material),
  };
}

function inventoriesEqual(left: RootInventory, right: RootInventory): boolean {
  return (
    grandHallT554V3SameNode(left.root.stats, right.root.stats) &&
    left.rootInventorySha256 === right.rootInventorySha256 &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const other = right.entries[index];
      return (
        other !== undefined &&
        entry.relativePath === other.relativePath &&
        entry.kind === other.kind &&
        entry.sha256 === other.sha256 &&
        grandHallT554V3SameFileState(entry.stats, other.stats)
      );
    })
  );
}

function entry(inventory: RootInventory, relativePath: string, kind: "file" | "directory"): InventoryEntry {
  const found = inventory.entriesByPath.get(relativePath);
  if (found === undefined || found.kind !== kind) {
    throw fail("INVENTORY_INVALID", `Required ${relativePath} ${kind} is missing.`);
  }
  return found;
}

function assertNamespaceShapes(inventory: RootInventory): void {
  for (const candidate of inventory.entries) {
    const segments = candidate.relativePath.split("/");
    if (segments[0] === CHILDREN_DIRECTORY && segments.length === 2 && candidate.kind !== "directory") {
      throw fail("INVENTORY_INVALID", "Children namespace permits only declared journal directories.");
    }
    if (
      segments[0] === CHILD_SCOPES_DIRECTORY &&
      ((segments.length === 2 && candidate.kind !== "file") || segments.length > 2)
    ) {
      throw fail("INVENTORY_INVALID", "Child-scopes namespace permits only direct descriptor files.");
    }
    if (
      segments[0] === MASK_EVIDENCE_DIRECTORY &&
      ((segments.length === 2 && candidate.kind !== "file") || segments.length > 2)
    ) {
      throw fail("INVENTORY_INVALID", "Mask-evidence namespace permits only direct evidence files.");
    }
  }
}

function parseCanonical(bytes: Buffer, label: string): unknown {
  const parsed = parseGrandHallT554StrictJson(bytes);
  const canonical = Buffer.from(`${stableCanonicalJson(toCanonicalJson(parsed))}\n`, "utf8");
  if (!bytes.equals(canonical)) throw fail("DESCRIPTOR_INVALID", `${label} is not exact canonical JSON plus LF.`);
  return parsed;
}

async function loadDescriptor(
  root: string,
  inventory: RootInventory,
  expectedScope: unknown,
): Promise<z.infer<typeof SessionRootDescriptorV2Schema>> {
  const rootEntry = entry(inventory, ROOT_DESCRIPTOR_FILE, "file");
  const bytes = await readStableFile(join(root, ROOT_DESCRIPTOR_FILE), rootEntry.stats, MAXIMUM_DESCRIPTOR_BYTES);
  const result = SessionRootDescriptorV2Schema.safeParse(parseCanonical(bytes, "Session-root descriptor"));
  if (!result.success) throw fail("DESCRIPTOR_INVALID", "Session-root descriptor has an invalid exact schema.", result.error);
  const expected = GrandHallT554NativeReviewSessionScopeV2Schema.safeParse(expectedScope);
  if (!expected.success || !canonicalEqual(result.data.sessionScope, expected.data)) {
    throw fail("DESCRIPTOR_INVALID", "Session-root descriptor differs from the expected session scope.", expected.success ? undefined : expected.error);
  }
  return result.data;
}

async function verifyManifestBytes(
  root: string,
  inventory: RootInventory,
  scope: GrandHallT554NativeReviewSessionScopeV2,
): Promise<void> {
  const relativePath = GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME;
  const file = entry(inventory, relativePath, "file");
  const bytes = await readStableFile(join(root, relativePath), file.stats, MAXIMUM_DESCRIPTOR_BYTES);
  const binding = scope.implementationManifest;
  if (bytes.length !== binding.byteLength || sha256(bytes) !== binding.fileSha256) {
    throw fail("IMPLEMENTATION_MISMATCH", "Preserved implementation-manifest bytes differ from the session binding.");
  }
  const parsed = parseCanonical(bytes, "Implementation manifest");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw fail("IMPLEMENTATION_MISMATCH", "Implementation manifest is not an object.");
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  const { semanticSha256: claimedSemantic, ...semanticMaterial } = record;
  if (
    record.schemaVersion !== GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA ||
    record.implementationId !== binding.implementationId ||
    claimedSemantic !== binding.semanticSha256 ||
    canonicalDigest(IMPLEMENTATION_MANIFEST_DOMAIN, semanticMaterial) !== binding.semanticSha256
  ) {
    throw fail("IMPLEMENTATION_MISMATCH", "Implementation manifest semantic binding is invalid.");
  }
}

function declarationsFromEvents(
  events: readonly GrandHallT554NativeReviewCoordinatorEventV2[],
): Map<string, Declaration> {
  const byLeaf = new Map<string, Declaration>();
  const byOperation = new Map<Sha256, Declaration>();
  for (const event of events) {
    if (
      event.eventType === "source.selection-intended.v2" ||
      event.eventType === "mask.freeze-intended.v2" ||
      event.eventType === "coverage.segment-resume-intended.v2"
    ) {
      const declaration: Declaration = { intent: event, resolution: null };
      byLeaf.set(event.payload.childJournalLeafName, declaration);
      byOperation.set(event.payload.operationIdSha256, declaration);
      continue;
    }
    if (
      event.eventType === "source.selection-committed.v2" ||
      event.eventType === "source.selection-recovery-aborted.v2" ||
      event.eventType === "mask.freeze-committed.v2" ||
      event.eventType === "mask.freeze-recovery-aborted.v2" ||
      event.eventType === "coverage.segment-resume-committed.v2" ||
      event.eventType === "coverage.segment-resume-recovery-aborted.v2"
    ) {
      const declaration = byOperation.get(event.payload.operationIdSha256);
      if (declaration !== undefined) declaration.resolution = event;
    }
  }
  return byLeaf;
}

function stableCustody(
  left: GrandHallT554NativeReviewSourceCustodyBindingV2,
  right: GrandHallT554NativeReviewSourceCustodyBindingV2,
): boolean {
  return (
    canonicalEqual(left.source, right.source) &&
    canonicalEqual(left.sourceVerification, right.sourceVerification) &&
    left.sourceReviewSubjectSha256 === right.sourceReviewSubjectSha256
  );
}

function preparedFromFrozen(
  frozen: GrandHallT554NativeReviewFrozenMaskBindingV2,
): GrandHallT554NativeReviewPreparedMaskBindingV2 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-mask-prepared-binding.v2",
    source: frozen.source,
    revision: frozen.revision,
    includedPixelCount: frozen.includedPixelCount,
    excludedPixelCount: frozen.excludedPixelCount,
    reasonCounts: frozen.reasonCounts,
    mask: {
      fileName: frozen.fileName,
      sha256: frozen.sha256,
      byteLength: frozen.byteLength,
      widthPx: frozen.widthPx,
      heightPx: frozen.heightPx,
      bitDepth: frozen.bitDepth,
      channelCount: frozen.channelCount,
      permittedPixelValues: frozen.permittedPixelValues,
      zeroMeaning: frozen.zeroMeaning,
      twoHundredFiftyFiveMeaning: frozen.twoHundredFiftyFiveMeaning,
    },
    reasonMap: frozen.reasonMap,
  };
}

function exactCommittedCustody(declaration: Declaration): GrandHallT554NativeReviewSourceCustodyBindingV2 | null {
  const resolution = declaration.resolution;
  return resolution?.eventType === "source.selection-committed.v2" ||
    resolution?.eventType === "coverage.segment-resume-committed.v2"
    ? resolution.payload.sourceCustody
    : null;
}

function validateChildScope(
  session: GrandHallT554NativeReviewSessionScopeV2,
  obligation: GrandHallT554NativeReviewCoordinatorChildObligationV2,
  declaration: Declaration,
  scope: GrandHallT554NativeReviewSourceScopeV2 | GrandHallT554NativeReviewMaskScopeV2,
): void {
  if (
    scope.kind !== obligation.kind ||
    scope.sessionIdSha256 !== session.sessionIdSha256 ||
    !canonicalEqual(scope.registry, session.registry) ||
    !canonicalEqual(scope.implementationManifest, session.implementationManifest) ||
    !canonicalEqual(scope.authorityBoundary, session.authorityBoundary) ||
    scope.browserEpochNonceSha256 !== obligation.browserEpochNonceSha256 ||
    scope.coverageSegmentIdSha256 !== obligation.coverageSegmentIdSha256 ||
    scope.renderGeneration !== obligation.allocatedRenderGeneration
  ) {
    throw fail("CHILD_MISMATCH", "Child scope differs from its coordinator declaration.");
  }
  const intent = declaration.intent;
  if (intent.eventType === "source.selection-intended.v2") {
    if (
      scope.kind !== "source" ||
      !canonicalEqual(
        scope.sourceCustody,
        intent.payload.preparedSourceCustody,
      )
    ) throw fail("CHILD_MISMATCH", "Selected-source child scope differs from its exact prepared custody.");
  } else if (intent.eventType === "mask.freeze-intended.v2") {
    if (
      scope.kind !== "mask" ||
      !canonicalEqual(scope.sourceCustody, intent.payload.sourceCustody) ||
      scope.maskReviewSubjectSha256 !== intent.payload.maskReviewSubjectSha256 ||
      scope.maskStateSha256 !== intent.payload.maskState.maskStateSha256 ||
      !canonicalEqual(preparedFromFrozen(scope.frozenBinding), intent.payload.preparedBinding) ||
      scope.frozenBindingSha256 !== computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256(scope.frozenBinding) ||
      scope.maskReviewSubjectSha256 !== computeGrandHallT554NativeReviewMaskSubjectV2Sha256({
        sourceReviewSubjectSha256: scope.sourceCustody.sourceReviewSubjectSha256,
        maskStateSha256: scope.maskStateSha256,
        maskEvidenceSha256: computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256(scope.frozenBinding),
        implementationManifest: session.implementationManifest,
      })
    ) throw fail("CHILD_MISMATCH", "Frozen-mask child scope differs from its prepared declaration.");
  } else {
    if (
      !canonicalEqual(
        scope.sourceCustody,
        intent.payload.preparedSourceCustody,
      )
    ) throw fail("CHILD_MISMATCH", "Resumed child scope differs from its exact prepared custody.");
    if (
      intent.payload.kind === "mask" &&
      (scope.kind !== "mask" ||
        !canonicalEqual(scope.frozenBinding, intent.payload.frozenBinding) ||
        scope.frozenBindingSha256 !== intent.payload.frozenBindingSha256 ||
        scope.maskReviewSubjectSha256 !== intent.payload.maskReviewSubjectSha256 ||
        scope.maskStateSha256 !== intent.payload.maskState.maskStateSha256)
    ) throw fail("CHILD_MISMATCH", "Resumed mask child changed frozen review evidence.");
  }
  const committed = exactCommittedCustody(declaration);
  if (committed !== null && !canonicalEqual(scope.sourceCustody, committed)) {
    throw fail("CHILD_MISMATCH", "Committed child scope differs from exact committed source custody.");
  }
  const resolution = declaration.resolution;
  if (resolution?.eventType === "mask.freeze-committed.v2" && scope.kind === "mask") {
    if (
      !canonicalEqual(scope.frozenBinding, resolution.payload.frozenBinding) ||
      scope.frozenBindingSha256 !== resolution.payload.frozenBindingSha256
    ) throw fail("CHILD_MISMATCH", "Mask child differs from its exact frozen commit.");
  }
}

async function validateHistoricalReferences(
  obligation: GrandHallT554NativeReviewCoordinatorChildObligationV2,
  evidence: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
  coordinator: GrandHallT554NativeReviewCoordinatorReplayV2,
): Promise<void> {
  for (const checkpoint of obligation.checkpointReferences) {
    const prefix = await deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2({
      evidence,
      revision: checkpoint.revision,
    });
    if (!canonicalEqual(prefix.checkpoint, checkpoint)) {
      throw fail("CHILD_MISMATCH", "Coordinator checkpoint does not match the exact historical child prefix.");
    }
  }
  if (
    obligation.disposition === "recovery_aborted_present" &&
    !obligation.checkpointReferences.some((checkpoint) => canonicalEqual(checkpoint, evidence.checkpoint))
  ) {
    throw fail("CHILD_MISMATCH", "Recovery-aborted child has an unacknowledged final head.");
  }
  const createdCheckpoint = (() => {
    const resolution = obligation.disposition === "pending" ? null : obligation.checkpointReferences[0] ?? null;
    return resolution;
  })();
  if (createdCheckpoint !== null) {
    if (createdCheckpoint.revision !== 1) {
      throw fail("CHILD_MISMATCH", "Created child checkpoint must be the exact typed start revision.");
    }
    const createdPrefix = await deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2({
      evidence,
      revision: 1,
    });
    const start = createdPrefix.events[0];
    if (
      !canonicalEqual(createdPrefix.checkpoint, createdCheckpoint) ||
      (obligation.kind === "source"
        ? start?.eventType !== "source.review-started.v2"
        : start?.eventType !== "mask.review-started.v2")
    ) {
      throw fail("CHILD_MISMATCH", "Created child checkpoint is not its exact typed start prefix.");
    }
  }
  const active = coordinator.activeSource;
  const activelyWritable =
    active !== null &&
    coordinator.pendingIntent === null &&
    coordinator.browserEpoch?.nonceSha256 === obligation.browserEpochNonceSha256 &&
    ((obligation.kind === "source" &&
      active.phase === "source_review" &&
      active.sourceJournal.leafName === obligation.leafName) ||
      (obligation.kind === "mask" &&
        active.phase === "mask_review" &&
        active.maskJournal?.leafName === obligation.leafName));
  if (obligation.disposition === "pending") {
    if (evidence.checkpoint.revision !== 1) {
      throw fail("CHILD_MISMATCH", "A pending created child cannot contain an unacknowledged tail.");
    }
    return;
  }
  const latestAcknowledged = obligation.checkpointReferences.at(-1);
  if (
    !activelyWritable &&
    (latestAcknowledged === undefined ||
      !canonicalEqual(latestAcknowledged, evidence.checkpoint))
  ) {
    throw fail("CHILD_MISMATCH", "A non-writable child has an unacknowledged durable tail.");
  }
}

async function validateResumeIntentPredecessor(
  declaration: Declaration,
  allEvidence: ReadonlyMap<string, GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2>,
): Promise<ReturnType<typeof createGrandHallT554NativeReviewCoverageCarryStateV2> | null> {
  const intent = declaration.intent;
  if (intent.eventType !== "coverage.segment-resume-intended.v2") {
    return null;
  }
  const prior = allEvidence.get(intent.payload.priorChildJournal.leafName);
  if (prior === undefined) throw fail("CHILD_MISMATCH", "Resume predecessor child is missing.");
  const prefix = await deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2({
    evidence: prior,
    revision: intent.payload.priorChildJournal.revision,
  });
  if (!canonicalEqual(prefix.checkpoint, intent.payload.priorChildJournal)) {
    throw fail("CHILD_MISMATCH", "Resume predecessor checkpoint is not an actual child prefix.");
  }
  const carry = createGrandHallT554NativeReviewCoverageCarryStateV2(prefix);
  if (
    !canonicalEqual(carry, intent.payload.predecessorCoverage)
  ) {
    throw fail("CHILD_MISMATCH", "Resume carry differs from actual predecessor child evidence.");
  }
  return carry;
}

function validatePresentChildStart(
  declaration: Declaration,
  evidence: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
  resumeCarry: ReturnType<typeof createGrandHallT554NativeReviewCoverageCarryStateV2> | null,
): void {
  const start = evidence.events[0];
  if (
    start === undefined ||
    (start.eventType !== "source.review-started.v2" &&
      start.eventType !== "mask.review-started.v2")
  ) {
    throw fail("CHILD_MISMATCH", "Present child does not begin with its typed start event.");
  }
  if (declaration.intent.eventType === "coverage.segment-resume-intended.v2") {
    if (resumeCarry === null || !canonicalEqual(resumeCarry, start.payload.predecessorCoverage)) {
      throw fail("CHILD_MISMATCH", "Present resumed child start differs from actual predecessor carry.");
    }
  } else if (start.payload.predecessorCoverage !== null) {
    throw fail("CHILD_MISMATCH", "Fresh child start forges predecessor carry.");
  }
}

async function openChildren(input: {
  readonly root: string;
  readonly inventory: RootInventory;
  readonly session: GrandHallT554NativeReviewSessionScopeV2;
  readonly coordinator: GrandHallT554NativeReviewCoordinatorReplayV2;
  readonly events: readonly GrandHallT554NativeReviewCoordinatorEventV2[];
  readonly assertOwner: () => Promise<void>;
}): Promise<readonly GrandHallT554NativeReviewSessionStoreChildV2[]> {
  const declarations = declarationsFromEvents(input.events);
  const childNames = input.inventory.entries
    .filter((candidate) => candidate.kind === "directory" && candidate.relativePath.startsWith(`${CHILDREN_DIRECTORY}/`) && !candidate.relativePath.slice(CHILDREN_DIRECTORY.length + 1).includes("/"))
    .map((candidate) => candidate.relativePath.slice(CHILDREN_DIRECTORY.length + 1))
    .sort(lexicalOrder);
  const scopeNames = input.inventory.entries
    .filter((candidate) => candidate.kind === "file" && candidate.relativePath.startsWith(`${CHILD_SCOPES_DIRECTORY}/`) && !candidate.relativePath.slice(CHILD_SCOPES_DIRECTORY.length + 1).includes("/"))
    .map((candidate) => candidate.relativePath.slice(CHILD_SCOPES_DIRECTORY.length + 1))
    .sort(lexicalOrder);
  if (childNames.length > MAXIMUM_CHILD_COUNT || scopeNames.length > MAXIMUM_CHILD_COUNT) throw fail("LIMIT_REACHED", "Child inventory exceeds its fixed count bound.");
  const expectedScopeNames = childNames.map((name) => `${name}.json`).sort(lexicalOrder);
  if (scopeNames.join("\n") !== expectedScopeNames.join("\n")) {
    throw fail("CHILD_MISMATCH", "Child journals and child-scope descriptors are not one-to-one.");
  }
  const present = new Set(childNames);
  const obligationsByLeaf = new Map(
    input.coordinator.childObligations.map((obligation) => [obligation.leafName, obligation]),
  );
  const declaredLeafNames = new Set(input.coordinator.declaredChildLeafNames);
  for (const leafName of input.coordinator.declaredChildLeafNames) {
    if (!safeChildLeaf(leafName)) {
      throw fail(
        "CHILD_MISMATCH",
        "Declared child leaf exceeds the Windows-safe leaf-plus-descriptor bound.",
      );
    }
  }
  for (const obligation of input.coordinator.childObligations) {
    const required = obligation.disposition === "committed" || obligation.disposition === "recovery_aborted_present";
    const forbidden = obligation.disposition === "recovery_aborted_absent";
    if ((required && !present.has(obligation.leafName)) || (forbidden && present.has(obligation.leafName))) {
      throw fail("CHILD_MISMATCH", "Child presence contradicts its coordinator disposition.");
    }
  }
  for (const name of childNames) {
    if (!safeChildLeaf(name) || !declaredLeafNames.has(name)) {
      throw fail("CHILD_MISMATCH", "Undeclared or overlong child journal exists.");
    }
  }
  const opened: {
    obligation: GrandHallT554NativeReviewCoordinatorChildObligationV2;
    declaration: Declaration;
    scope: GrandHallT554NativeReviewSourceScopeV2 | GrandHallT554NativeReviewMaskScopeV2;
    evidence: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2;
  }[] = [];
  for (const leafName of childNames) {
    const obligation = obligationsByLeaf.get(leafName);
    const declaration = declarations.get(leafName);
    if (obligation === undefined || declaration === undefined) throw fail("CHILD_MISMATCH", "Child lacks its exact coordinator declaration.");
    const descriptorRelative = `${CHILD_SCOPES_DIRECTORY}/${leafName}.json`;
    const descriptorEntry = entry(input.inventory, descriptorRelative, "file");
    const bytes = await readStableFile(join(input.root, ...descriptorRelative.split("/")), descriptorEntry.stats, MAXIMUM_DESCRIPTOR_BYTES);
    const parsed = ChildScopeDescriptorV2Schema.safeParse(parseCanonical(bytes, "Child-scope descriptor"));
    if (!parsed.success || parsed.data.leafName !== leafName || parsed.data.scope.kind === "session") {
      throw fail("CHILD_MISMATCH", "Child-scope descriptor is invalid or transplanted.", parsed.success ? undefined : parsed.error);
    }
    validateChildScope(input.session, obligation, declaration, parsed.data.scope);
    await input.assertOwner();
    const evidence = await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot: join(input.root, CHILDREN_DIRECTORY, leafName),
      expectedScope: parsed.data.scope,
    });
    await input.assertOwner();
    opened.push({ obligation, declaration, scope: parsed.data.scope, evidence });
  }
  const evidenceByLeaf = new Map(
    opened.map((child) => [child.evidence.checkpoint.leafName, child.evidence]),
  );
  const resumeCarryByLeaf = new Map<
    string,
    ReturnType<typeof createGrandHallT554NativeReviewCoverageCarryStateV2> | null
  >();
  for (const obligation of input.coordinator.childObligations) {
    const declaration = declarations.get(obligation.leafName);
    if (declaration === undefined) {
      throw fail("CHILD_MISMATCH", "Coordinator child obligation lacks its declaration.");
    }
    await input.assertOwner();
    resumeCarryByLeaf.set(
      obligation.leafName,
      await validateResumeIntentPredecessor(declaration, evidenceByLeaf),
    );
    await input.assertOwner();
  }
  for (const child of opened) {
    await input.assertOwner();
    await validateHistoricalReferences(
      child.obligation,
      child.evidence,
      input.coordinator,
    );
    validatePresentChildStart(
      child.declaration,
      child.evidence,
      resumeCarryByLeaf.get(child.obligation.leafName) ?? null,
    );
    await input.assertOwner();
  }
  return deepFreeze(
    opened
      .map((child) => ({
        leafName: child.evidence.checkpoint.leafName,
        disposition: child.obligation.disposition,
        scope: child.scope,
        evidence: child.evidence,
      }))
      .sort((left, right) => lexicalOrder(left.leafName, right.leafName)),
  );
}

interface CompletedSourceCoverageVerification {
  readonly coordinatorEventIndex: number;
  readonly sourceJournal: GrandHallT554NativeReviewSourceChildCheckpointV2;
  readonly coverageReplaySha256: Sha256;
}

async function verifyCompletedSourceCoverageReferences(
  session: GrandHallT554NativeReviewSessionScopeV2,
  events: readonly GrandHallT554NativeReviewCoordinatorEventV2[],
  children: readonly GrandHallT554NativeReviewSessionStoreChildV2[],
): Promise<readonly CompletedSourceCoverageVerification[]> {
  const evidenceByLeaf = new Map(
    children.map((child) => [child.leafName, child.evidence]),
  );
  const verified: CompletedSourceCoverageVerification[] = [];
  for (const [coordinatorEventIndex, event] of events.entries()) {
    if (
      event.eventType !== "mask.workflow-started.v2" &&
      event.eventType !== "source.decision-recorded.v2"
    ) {
      continue;
    }
    const claim = event.payload.completedSourceCoverage;
    const evidence = evidenceByLeaf.get(claim.sourceJournal.leafName);
    if (evidence === undefined || evidence.kind !== "source") {
      throw fail(
        "CHILD_MISMATCH",
        "Completed-source claim references a missing or non-source child.",
      );
    }
    const prefix =
      await deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2(
        {
          evidence,
          revision: claim.sourceJournal.revision,
        },
      );
    if (
      prefix.kind !== "source" ||
      !canonicalEqual(prefix.checkpoint, claim.sourceJournal)
    ) {
      throw fail(
        "CHILD_MISMATCH",
        "Completed-source checkpoint is not the exact source-child prefix.",
      );
    }
    const replay = replayGrandHallT554NativeReviewSourceChildV2(prefix);
    const coverage = replay.coverage;
    const actualClaim = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2" as const,
      sourceReviewSubjectSha256: coverage.subjectSha256,
      sourceJournal: prefix.checkpoint,
      completedTileBitsetHex: coverage.completedTileBitsetHex,
      completedTileCount: coverage.completedTileCount,
      cumulativeDwellStateSha256: coverage.cumulativeDwellStateSha256,
    };
    if (
      !coverage.complete ||
      coverage.completedTileCount !== GRAND_HALL_T554_NATIVE_TILE_COUNT
    ) {
      throw fail(
        "CHILD_MISMATCH",
        "Completed-source claim references a child prefix without full native coverage.",
      );
    }
    const carry = createGrandHallT554NativeReviewCoverageCarryStateV2(prefix);
    if (
      !canonicalEqual(actualClaim, claim) ||
      carry.kind !== "source" ||
      carry.cappedDwellMsUint16LeBase64url !==
        coverage.cappedDwellMsUint16LeBase64url ||
      carry.cappedDwellBytesSha256 !== coverage.cappedDwellBytesSha256 ||
      carry.cumulativeDwellStateSha256 !==
        coverage.cumulativeDwellStateSha256 ||
      !stableCustody(replay.scope.sourceCustody, event.payload.sourceCustody) ||
      replay.scope.sessionIdSha256 !== session.sessionIdSha256 ||
      !canonicalEqual(replay.scope.registry, session.registry) ||
      !canonicalEqual(
        replay.scope.implementationManifest,
        session.implementationManifest,
      ) ||
      replay.scope.sourceCustody.sourceReviewSubjectSha256 !==
        claim.sourceReviewSubjectSha256 ||
      (event.eventType === "source.decision-recorded.v2" &&
        Date.parse(event.payload.decidedAtUtc) <
          Date.parse(prefix.finalDurableRecordedAtUtc))
    ) {
      throw fail(
        "CHILD_MISMATCH",
        "Completed-source proof differs from exact durable child coverage replay.",
      );
    }
    verified.push({
      coordinatorEventIndex,
      sourceJournal: prefix.checkpoint,
      coverageReplaySha256: canonicalDigest(
        "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_COMPLETED_SOURCE_COVERAGE_REPLAY_V2",
        {
          coverage,
          stableSource: {
            source: replay.scope.sourceCustody.source,
            sourceVerification: replay.scope.sourceCustody.sourceVerification,
            sourceReviewSubjectSha256:
              replay.scope.sourceCustody.sourceReviewSubjectSha256,
          },
          registry: replay.scope.registry,
          implementationManifest: replay.scope.implementationManifest,
        },
      ),
    });
  }
  return deepFreeze(verified);
}

interface CompletedMaskCoverageVerification {
  readonly coordinatorEventIndex: number;
  readonly maskJournal: GrandHallT554NativeReviewMaskChildCheckpointV2;
  readonly coverageReplaySha256: Sha256;
}

async function verifyCompletedMaskCoverageReferences(
  session: GrandHallT554NativeReviewSessionScopeV2,
  events: readonly GrandHallT554NativeReviewCoordinatorEventV2[],
  children: readonly GrandHallT554NativeReviewSessionStoreChildV2[],
): Promise<readonly CompletedMaskCoverageVerification[]> {
  const evidenceByLeaf = new Map(
    children.map((child) => [child.leafName, child.evidence]),
  );
  const verified: CompletedMaskCoverageVerification[] = [];
  for (const [coordinatorEventIndex, event] of events.entries()) {
    if (
      event.eventType !== "source.decision-recorded.v2" ||
      event.payload.result !== "INCLUDE"
    ) {
      continue;
    }
    const claim = event.payload.completedMaskCoverage;
    const evidence = evidenceByLeaf.get(claim.maskJournal.leafName);
    if (evidence === undefined || evidence.kind !== "mask") {
      throw fail(
        "CHILD_MISMATCH",
        "Completed-mask claim references a missing or non-mask child.",
      );
    }
    const prefix =
      await deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2(
        {
          evidence,
          revision: claim.maskJournal.revision,
        },
      );
    if (
      prefix.kind !== "mask" ||
      !canonicalEqual(prefix.checkpoint, claim.maskJournal)
    ) {
      throw fail(
        "CHILD_MISMATCH",
        "Completed-mask checkpoint is not the exact mask-child prefix.",
      );
    }
    const replay = replayGrandHallT554NativeReviewMaskChildV2(prefix);
    const coverage = replay.coverage;
    const actualClaim = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-completed-mask-coverage.v2" as const,
      maskReviewSubjectSha256: replay.scope.maskReviewSubjectSha256,
      maskStateSha256: replay.scope.maskStateSha256,
      frozenBindingSha256: replay.scope.frozenBindingSha256,
      maskJournal: prefix.checkpoint,
      completedTileBitsetHex: coverage.completedTileBitsetHex,
      completedTileCount: coverage.completedTileCount,
      cumulativeDwellStateSha256: coverage.cumulativeDwellStateSha256,
    };
    if (
      !coverage.complete ||
      coverage.completedTileCount !== GRAND_HALL_T554_NATIVE_TILE_COUNT
    ) {
      throw fail(
        "CHILD_MISMATCH",
        "Completed-mask claim references a child prefix without full native coverage.",
      );
    }
    const carry = createGrandHallT554NativeReviewCoverageCarryStateV2(prefix);
    if (
      !canonicalEqual(actualClaim, claim) ||
      carry.kind !== "mask" ||
      carry.cappedDwellMsUint16LeBase64url !==
        coverage.cappedDwellMsUint16LeBase64url ||
      carry.cappedDwellBytesSha256 !== coverage.cappedDwellBytesSha256 ||
      carry.cumulativeDwellStateSha256 !==
        coverage.cumulativeDwellStateSha256 ||
      !canonicalEqual(
        replay.scope.sourceCustody,
        event.payload.sourceCustody,
      ) ||
      replay.scope.sessionIdSha256 !== session.sessionIdSha256 ||
      !canonicalEqual(replay.scope.registry, session.registry) ||
      !canonicalEqual(
        replay.scope.implementationManifest,
        session.implementationManifest,
      ) ||
      replay.scope.maskReviewSubjectSha256 !==
        event.payload.maskReviewSubjectSha256 ||
      replay.scope.maskStateSha256 !==
        event.payload.maskState.maskStateSha256 ||
      replay.scope.frozenBindingSha256 !== event.payload.frozenBindingSha256 ||
      !canonicalEqual(
        replay.scope.frozenBinding,
        event.payload.frozenBinding,
      ) ||
      Date.parse(event.payload.decidedAtUtc) <
        Date.parse(prefix.finalDurableRecordedAtUtc)
    ) {
      throw fail(
        "CHILD_MISMATCH",
        "Completed-mask proof differs from exact durable child coverage replay.",
      );
    }
    verified.push({
      coordinatorEventIndex,
      maskJournal: prefix.checkpoint,
      coverageReplaySha256: canonicalDigest(
        "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_COMPLETED_MASK_COVERAGE_REPLAY_V2",
        {
          coverage,
          stableMask: {
            source: replay.scope.sourceCustody.source,
            sourceVerification: replay.scope.sourceCustody.sourceVerification,
            sourceReviewSubjectSha256:
              replay.scope.sourceCustody.sourceReviewSubjectSha256,
            maskReviewSubjectSha256: replay.scope.maskReviewSubjectSha256,
            maskStateSha256: replay.scope.maskStateSha256,
            frozenBindingSha256: replay.scope.frozenBindingSha256,
            frozenBinding: replay.scope.frozenBinding,
          },
          registry: replay.scope.registry,
          implementationManifest: replay.scope.implementationManifest,
        },
      ),
    });
  }
  return deepFreeze(verified);
}

type MaskFreezeIntentEvent = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "mask.freeze-intended.v2" }
>;

interface MaskWorkflowVerification {
  readonly workflowEventIndex: number;
  readonly sourceReviewSubjectSha256: Sha256;
  readonly replay: GrandHallT554NativeMaskReplayV2;
}

interface MaskStateVerification {
  readonly workflows: readonly MaskWorkflowVerification[];
  readonly exactFreezeStateByOperation: ReadonlyMap<Sha256, GrandHallT554NativeMaskExactStateV2>;
}

function verifyMaskState(
  session: GrandHallT554NativeReviewSessionScopeV2,
  events: readonly GrandHallT554NativeReviewCoordinatorEventV2[],
): MaskStateVerification {
  type MaskGroup = {
    readonly workflowEventIndex: number;
    initial: Extract<
      GrandHallT554NativeReviewCoordinatorEventV2,
      { eventType: "mask.workflow-started.v2" }
    >;
    edits: Extract<
      GrandHallT554NativeReviewCoordinatorEventV2,
      { eventType: "mask.edited.v2" }
    >[];
    currentCustody: GrandHallT554NativeReviewSourceCustodyBindingV2;
    freezeIntents: MaskFreezeIntentEvent[];
  };
  let group: MaskGroup | null = null;
  const groups: MaskGroup[] = [];
  for (const [eventIndex, event] of events.entries()) {
    if (event.eventType === "mask.workflow-started.v2") {
      if (group !== null) groups.push(group);
      group = {
        workflowEventIndex: eventIndex,
        initial: event,
        edits: [],
        currentCustody: event.payload.sourceCustody,
        freezeIntents: [],
      };
    } else if (event.eventType === "mask.edited.v2") {
      if (group === null) throw fail("MASK_STATE_MISMATCH", "Mask edit has no workflow start.");
      if (!canonicalEqual(event.payload.sourceCustody, group.currentCustody)) {
        throw fail("MASK_STATE_MISMATCH", "Mask edit is not bound to the current exact source epoch.");
      }
      group.edits.push(event);
    } else if (event.eventType === "mask.edit-epoch-resumed.v2") {
      if (
        group === null ||
        !canonicalEqual(event.payload.sourceCustodyBefore, group.currentCustody) ||
        !stableCustody(event.payload.sourceCustody, group.currentCustody)
      ) {
        throw fail("MASK_STATE_MISMATCH", "Mask edit epoch resume changes stable source custody.");
      }
      group.currentCustody = event.payload.sourceCustody;
    } else if (event.eventType === "mask.freeze-intended.v2") {
      if (
        group === null ||
        !canonicalEqual(event.payload.sourceCustody, group.currentCustody)
      ) {
        throw fail("MASK_STATE_MISMATCH", "Mask freeze is not bound to the active workflow source epoch.");
      }
      group.freezeIntents.push(event);
    } else if (event.eventType === "source.abandoned.v2" && group !== null) {
      groups.push(group);
      group = null;
    }
  }
  if (group !== null) groups.push(group);
  const workflows: MaskWorkflowVerification[] = [];
  const exactFreezeStateByOperation = new Map<Sha256, GrandHallT554NativeMaskExactStateV2>();
  for (const current of groups) {
    const replay = verifyGrandHallT554NativeMaskStateReplayV2({
      context: buildGrandHallT554NativeMaskReplayContextV2(
        session,
        current.initial.payload.sourceCustody,
      ),
      initialMaskState: current.initial.payload.initialMaskState,
      events: current.edits,
    });
    const statesByRevision = new Map(
      replay.states.map((state) => [state.revision, state]),
    );
    for (const intent of current.freezeIntents) {
      const exact = statesByRevision.get(intent.payload.maskState.revision);
      if (
        exact === undefined ||
        exact.maskStateSha256 !== intent.payload.maskState.maskStateSha256 ||
        intent.payload.preparedBinding.revision !== exact.revision ||
        !stableCustody(intent.payload.sourceCustody, current.initial.payload.sourceCustody)
      ) {
        throw fail("MASK_STATE_MISMATCH", "Mask freeze revision is not an exact state in its bound workflow.");
      }
      exactFreezeStateByOperation.set(intent.payload.operationIdSha256, exact);
    }
    workflows.push({
      workflowEventIndex: current.workflowEventIndex,
      sourceReviewSubjectSha256:
        current.initial.payload.sourceCustody.sourceReviewSubjectSha256,
      replay,
    });
  }
  return {
    workflows: deepFreeze(workflows),
    exactFreezeStateByOperation,
  };
}

interface MaskEvidenceVerification {
  readonly operationIdSha256: Sha256;
  readonly revision: number;
  readonly pixelTileInventorySha256: Sha256;
}

interface MaskPublicationPlan {
  readonly metadataByName: ReadonlyMap<
    string,
    { readonly sha256: Sha256; readonly byteLength: number }
  >;
  readonly requiredNames: ReadonlySet<string>;
  readonly pendingPermittedNames: ReadonlySet<string>;
  readonly resolvedForbiddenNames: ReadonlySet<string>;
  readonly committedByOperation: ReadonlyMap<
    Sha256,
    GrandHallT554NativeReviewFrozenMaskBindingV2
  >;
}

function buildMaskPublicationPlan(
  events: readonly GrandHallT554NativeReviewCoordinatorEventV2[],
): MaskPublicationPlan {
  const metadataByName = new Map<
    string,
    { readonly sha256: Sha256; readonly byteLength: number }
  >();
  const requiredNames = new Set<string>();
  const pendingPermittedNames = new Set<string>();
  const resolvedForbiddenNames = new Set<string>();
  const intents = new Map<Sha256, MaskFreezeIntentEvent>();
  const resolved = new Set<Sha256>();
  const committedByOperation = new Map<
    Sha256,
    GrandHallT554NativeReviewFrozenMaskBindingV2
  >();
  const bindMetadata = (name: string, digest: Sha256, byteLength: number): void => {
    const prior = metadataByName.get(name);
    if (
      prior !== undefined &&
      (prior.sha256 !== digest || prior.byteLength !== byteLength)
    ) {
      throw fail(
        "MASK_EVIDENCE_MISMATCH",
        "Mask-evidence filename aliases different exact bytes.",
      );
    }
    metadataByName.set(name, { sha256: digest, byteLength });
  };
  for (const event of events) {
    if (event.eventType === "mask.freeze-intended.v2") {
      const binding = event.payload.preparedBinding;
      intents.set(event.payload.operationIdSha256, event);
      bindMetadata(binding.mask.fileName, binding.mask.sha256, binding.mask.byteLength);
      bindMetadata(
        binding.reasonMap.fileName,
        binding.reasonMap.sha256,
        binding.reasonMap.byteLength,
      );
      continue;
    }
    if (event.eventType === "mask.freeze-committed.v2") {
      const operation = event.payload.operationIdSha256;
      const intent = intents.get(operation);
      if (intent === undefined) {
        throw fail("MASK_EVIDENCE_MISMATCH", "Committed mask has no exact freeze intent.");
      }
      resolved.add(operation);
      committedByOperation.set(operation, event.payload.frozenBinding);
      requiredNames.add(intent.payload.preparedBinding.mask.fileName);
      requiredNames.add(intent.payload.preparedBinding.reasonMap.fileName);
      continue;
    }
    if (event.eventType === "mask.freeze-recovery-aborted.v2") {
      const operation = event.payload.operationIdSha256;
      const intent = intents.get(operation);
      if (intent === undefined) {
        throw fail("MASK_EVIDENCE_MISMATCH", "Aborted mask has no exact freeze intent.");
      }
      resolved.add(operation);
      const maskName = intent.payload.preparedBinding.mask.fileName;
      const reasonName = intent.payload.preparedBinding.reasonMap.fileName;
      const maskRequired =
        event.payload.publicationDisposition === "mask_only" ||
        event.payload.publicationDisposition === "mask_and_reason_map";
      const reasonRequired =
        event.payload.publicationDisposition === "reason_map_only" ||
        event.payload.publicationDisposition === "mask_and_reason_map";
      (maskRequired ? requiredNames : resolvedForbiddenNames).add(maskName);
      (reasonRequired ? requiredNames : resolvedForbiddenNames).add(reasonName);
    }
  }
  for (const [operation, intent] of intents) {
    if (resolved.has(operation)) continue;
    pendingPermittedNames.add(intent.payload.preparedBinding.mask.fileName);
    pendingPermittedNames.add(intent.payload.preparedBinding.reasonMap.fileName);
  }
  return {
    metadataByName,
    requiredNames,
    pendingPermittedNames,
    resolvedForbiddenNames,
    committedByOperation,
  };
}

const MASK_REASON_CODES_IN_SAMPLE_ORDER = [
  "adjacent_room_pixels",
  "portal_beyond_grand_hall_plane",
  "facade_or_exterior_pixels",
  "capture_artifact_outside_verified_room",
  "unverified_or_unknown_pixels",
] as const;

function exactReasonSampleCounts(
  state: GrandHallT554NativeMaskExactStateV2,
): readonly [number, number, number, number, number, number] {
  const byReason = new Map(
    state.reasonCounts.map((entry) => [entry.reasonCode, entry.pixelCount]),
  );
  return [
    state.includedPixelCount,
    byReason.get(MASK_REASON_CODES_IN_SAMPLE_ORDER[0]) ?? 0,
    byReason.get(MASK_REASON_CODES_IN_SAMPLE_ORDER[1]) ?? 0,
    byReason.get(MASK_REASON_CODES_IN_SAMPLE_ORDER[2]) ?? 0,
    byReason.get(MASK_REASON_CODES_IN_SAMPLE_ORDER[3]) ?? 0,
    byReason.get(MASK_REASON_CODES_IN_SAMPLE_ORDER[4]) ?? 0,
  ];
}

function assertMaskEvidenceMatchesExactState(
  verified: GrandHallT554VerifiedMaskEvidence,
  exact: GrandHallT554NativeMaskExactStateV2,
): void {
  if (
    verified.includedPixelCount !== exact.includedPixelCount ||
    verified.excludedPixelCount !== exact.excludedPixelCount ||
    verified.pixelTileInventorySha256 !== exact.pixelTileInventorySha256 ||
    !canonicalEqual(verified.reasonSampleCounts, exactReasonSampleCounts(exact))
  ) {
    throw fail(
      "MASK_EVIDENCE_MISMATCH",
      "Decoded mask evidence differs spatially from its exact committed freeze revision.",
    );
  }
}

function assertMaskPublicationNames(
  plan: MaskPublicationPlan,
  actualNames: ReadonlySet<string>,
): void {
  for (const name of actualNames) {
    const forbiddenWithoutIndependentRequirement =
      plan.resolvedForbiddenNames.has(name) && !plan.requiredNames.has(name);
    if (
      !plan.metadataByName.has(name) ||
      forbiddenWithoutIndependentRequirement ||
      (!plan.requiredNames.has(name) && !plan.pendingPermittedNames.has(name))
    ) {
      throw fail(
        "MASK_EVIDENCE_MISMATCH",
        "Mask-evidence namespace contains an extra or forbidden publication.",
      );
    }
  }
  for (const required of plan.requiredNames) {
    if (!actualNames.has(required)) {
      throw fail("MASK_EVIDENCE_MISMATCH", "Required mask-evidence file is missing.");
    }
  }
}

async function verifyMaskEvidenceNamespace(
  root: string,
  inventory: RootInventory,
  events: readonly GrandHallT554NativeReviewCoordinatorEventV2[],
  maskState: MaskStateVerification,
): Promise<readonly MaskEvidenceVerification[]> {
  const plan = buildMaskPublicationPlan(events);
  const actualNames = new Set(
    inventory.entries
      .filter(
        (candidate) =>
          candidate.kind === "file" &&
          candidate.relativePath.startsWith(`${MASK_EVIDENCE_DIRECTORY}/`) &&
          !candidate.relativePath
            .slice(MASK_EVIDENCE_DIRECTORY.length + 1)
            .includes("/"),
      )
      .map((candidate) =>
        candidate.relativePath.slice(MASK_EVIDENCE_DIRECTORY.length + 1),
      ),
  );
  assertMaskPublicationNames(plan, actualNames);
  for (const name of actualNames) {
    const expected = plan.metadataByName.get(name);
    const file = entry(inventory, `${MASK_EVIDENCE_DIRECTORY}/${name}`, "file");
    if (
      expected === undefined ||
      file.sha256 !== expected.sha256 ||
      file.byteLength !== expected.byteLength
    ) {
      throw fail(
        "MASK_EVIDENCE_MISMATCH",
        "Mask-evidence namespace contains mismatched bytes.",
      );
    }
  }
  const verified: MaskEvidenceVerification[] = [];
  for (const [operationIdSha256, frozen] of plan.committedByOperation) {
    const exact = maskState.exactFreezeStateByOperation.get(operationIdSha256);
    if (exact === undefined || exact.revision !== frozen.revision) {
      throw fail(
        "MASK_STATE_MISMATCH",
        "Committed mask freeze is not bound to an exact workflow revision.",
      );
    }
    const evidence = await verifyGrandHallT554NativeMaskEvidence(
      {
        sourceRoot: join(root, MASK_EVIDENCE_DIRECTORY),
        fileName: frozen.fileName,
        expectedSha256: frozen.sha256,
        expectedByteLength: frozen.byteLength,
      },
      {
        sourceRoot: join(root, MASK_EVIDENCE_DIRECTORY),
        fileName: frozen.reasonMap.fileName,
        expectedSha256: frozen.reasonMap.sha256,
        expectedByteLength: frozen.reasonMap.byteLength,
      },
    );
    assertMaskEvidenceMatchesExactState(evidence, exact);
    verified.push({
      operationIdSha256,
      revision: exact.revision,
      pixelTileInventorySha256: evidence.pixelTileInventorySha256,
    });
  }
  return deepFreeze(verified);
}

function replayChildForAttestation(
  child: GrandHallT554NativeReviewSessionStoreChildV2,
): GrandHallT554NativeReviewChildReplayV2 {
  return child.evidence.kind === "source"
    ? replayGrandHallT554NativeReviewSourceChildV2(child.evidence)
    : replayGrandHallT554NativeReviewMaskChildV2(child.evidence);
}

function verificationAttestationSha256(input: {
  readonly rootInventorySha256: Sha256;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly coordinator: GrandHallT554NativeReviewCoordinatorReplayV2;
  readonly children: readonly GrandHallT554NativeReviewSessionStoreChildV2[];
  readonly completedSourceCoverage: readonly CompletedSourceCoverageVerification[];
  readonly completedMaskCoverage: readonly CompletedMaskCoverageVerification[];
  readonly maskState: MaskStateVerification;
  readonly maskEvidence: readonly MaskEvidenceVerification[];
}): Sha256 {
  return canonicalDigest(VERIFICATION_ATTESTATION_DOMAIN, {
    schemaVersion:
      GRAND_HALL_T554_NATIVE_REVIEW_SESSION_VERIFICATION_ATTESTATION_V2,
    rootInventorySha256: input.rootInventorySha256,
    sessionScope: input.sessionScope,
    coordinator: input.coordinator,
    children: input.children.map((child) => ({
      leafName: child.leafName,
      disposition: child.disposition,
      scope: child.scope,
      checkpoint: child.evidence.checkpoint,
      finalDurableRecordedAtUtc: child.evidence.finalDurableRecordedAtUtc,
      replay: replayChildForAttestation(child),
    })),
    completedSourceCoverage: input.completedSourceCoverage,
    completedMaskCoverage: input.completedMaskCoverage,
    maskWorkflows: input.maskState.workflows.map((workflow) => ({
      workflowEventIndex: workflow.workflowEventIndex,
      sourceReviewSubjectSha256: workflow.sourceReviewSubjectSha256,
      context: workflow.replay.context,
      states: workflow.replay.states,
    })),
    maskEvidence: input.maskEvidence,
  });
}

async function openSessionStore(input: {
  readonly sessionRoot: string;
  readonly expectedSessionScope: unknown;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly seam?: SessionStoreSeam;
  readonly recoveryPass?: boolean;
  readonly expectedRootNode?: BigIntStats;
}): Promise<GrandHallT554NativeReviewSessionStoreReplayV2> {
  const root = resolvedRoot(input.sessionRoot);
  try {
    const assertOwner = async (): Promise<void> => {
      await assertGrandHallT554NativeReviewSessionOwnerV2({
        lease: input.lease,
        sessionRoot: root,
        expectedSessionScope: input.expectedSessionScope,
      });
    };
    await assertOwner();
    const initialInventory = await snapshotRoot(root, {
      allowJournalCrashResidues: input.recoveryPass !== true,
      afterUniqueFileRead: input.seam?.afterUniqueFileRead,
    });
    await assertOwner();
    if (
      input.expectedRootNode !== undefined &&
      !grandHallT554V3SameNode(initialInventory.root.stats, input.expectedRootNode)
    ) {
      throw fail("ROOT_CHANGED", "Session root was replaced during journal recovery.");
    }
    assertNamespaceShapes(initialInventory);
    await input.seam?.afterInitialInventory?.(root);
    await assertOwner();
    const descriptor = await loadDescriptor(root, initialInventory, input.expectedSessionScope);
    await verifyManifestBytes(root, initialInventory, descriptor.sessionScope);
    await assertOwner();
    const coordinatorJournal = await openGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: join(root, COORDINATOR_DIRECTORY),
      expectedScope: descriptor.sessionScope,
    });
    await assertOwner();
    const coordinatorJournalReplay = await coordinatorJournal.replay();
    await assertOwner();
    let coordinator: GrandHallT554NativeReviewCoordinatorReplayV2;
    try {
      coordinator = replayGrandHallT554NativeReviewCoordinatorV2({
        scope: descriptor.sessionScope,
        events: coordinatorJournalReplay.events,
      });
    } catch (error) {
      throw fail("COORDINATOR_INVALID", "Coordinator durable bytes fail exact semantic replay.", error);
    }
    await assertOwner();
    const events = coordinatorJournalReplay.events as readonly GrandHallT554NativeReviewCoordinatorEventV2[];
    const children = await openChildren({
      root,
      inventory: initialInventory,
      session: descriptor.sessionScope,
      coordinator,
      events,
      assertOwner,
    });
    await assertOwner();
    let completedSourceCoverage: readonly CompletedSourceCoverageVerification[];
    try {
      completedSourceCoverage = await verifyCompletedSourceCoverageReferences(
        descriptor.sessionScope,
        events,
        children,
      );
    } catch (error) {
      if (error instanceof GrandHallT554NativeReviewSessionStoreV2Error)
        throw error;
      throw fail(
        "CHILD_MISMATCH",
        "Completed source coverage failed exact historical child replay.",
        error,
      );
    }
    await assertOwner();
    let completedMaskCoverage: readonly CompletedMaskCoverageVerification[];
    try {
      completedMaskCoverage = await verifyCompletedMaskCoverageReferences(
        descriptor.sessionScope,
        events,
        children,
      );
    } catch (error) {
      if (error instanceof GrandHallT554NativeReviewSessionStoreV2Error) {
        throw error;
      }
      throw fail(
        "CHILD_MISMATCH",
        "Completed mask coverage failed exact historical child replay.",
        error,
      );
    }
    await assertOwner();
    let maskState: MaskStateVerification;
    try {
      maskState = verifyMaskState(descriptor.sessionScope, events);
    } catch (error) {
      if (error instanceof GrandHallT554NativeReviewSessionStoreV2Error)
        throw error;
      throw fail(
        "MASK_STATE_MISMATCH",
        "Coordinator mask state differs from exact deterministic raster replay.",
        error,
      );
    }
    await assertOwner();
    const maskEvidence = await verifyMaskEvidenceNamespace(
      root,
      initialInventory,
      events,
      maskState,
    );
    await assertOwner();
    const finalInventory = await snapshotRoot(root, {
      allowJournalCrashResidues: false,
      afterUniqueFileRead: input.seam?.afterUniqueFileRead,
    });
    await assertOwner();
    if (!inventoriesEqual(initialInventory, finalInventory)) {
      const hadRecoverablePending = initialInventory.entries.some(
        (candidate) =>
          candidate.kind === "file" &&
          journalLinkMember(candidate.relativePath)?.role === "pending",
      );
      if (
        input.recoveryPass !== true &&
        hadRecoverablePending &&
        grandHallT554V3SameNode(initialInventory.root.stats, finalInventory.root.stats)
      ) {
        return await openSessionStore({
          sessionRoot: root,
          expectedSessionScope: input.expectedSessionScope,
          lease: input.lease,
          recoveryPass: true,
          expectedRootNode: finalInventory.root.stats,
        });
      }
      throw fail("ROOT_CHANGED", "Session root changed while it was being verified.");
    }
    const attestationSha256 = verificationAttestationSha256({
      rootInventorySha256: finalInventory.rootInventorySha256,
      sessionScope: descriptor.sessionScope,
      coordinator,
      children,
      completedSourceCoverage,
      completedMaskCoverage,
      maskState,
      maskEvidence,
    });
    return deepFreeze({
      schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_SESSION_STORE_REPLAY_V2,
      sessionScope: descriptor.sessionScope,
      coordinatorJournal: coordinatorJournalReplay,
      coordinator,
      children,
      maskStateReplayCount: maskState.workflows.length,
      rootInventorySha256: finalInventory.rootInventorySha256,
      verificationAttestationSha256: attestationSha256,
    });
  } catch (error) {
    if (
      error instanceof GrandHallT554NativeReviewSessionStoreV2Error ||
      error instanceof GrandHallT554NativeReviewSessionOwnerV2Error
    ) {
      throw error;
    }
    throw fail("INVENTORY_INVALID", "Session-root verification failed closed.", error);
  }
}

export function openGrandHallT554NativeReviewSessionStoreV2(options: {
  readonly sessionRoot: string;
  readonly expectedSessionScope: unknown;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
}): Promise<GrandHallT554NativeReviewSessionStoreReplayV2> {
  return openSessionStore(options);
}

export const __testOnlyGrandHallT554NativeReviewSessionStoreV2 = /* @__PURE__ */ Object.freeze({
  openSessionStore,
  assertMaskEvidenceMatchesExactState,
  assertMaskPublicationNames,
  assertBoundedRelativePath,
  buildMaskPublicationPlan,
  verifyCompletedMaskCoverageReferences,
  verifyCompletedSourceCoverageReferences,
  safeChildLeaf,
  rootCapacityInvariant: () => Object.freeze({
    reviewSourceCount: REVIEW_SOURCE_COUNT,
    maximumRegistryChildCount: MAXIMUM_REGISTRY_CHILD_COUNT,
    maximumChildEventCount: MAXIMUM_CHILD_EVENT_COUNT,
    maximumJournalQuarantineEntryCount:
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_MAX_EVENT_COUNT,
    maximumJournalUniqueBytes: MAXIMUM_JOURNAL_UNIQUE_BYTES.toString(),
    requiredMaximumRootEntryCount:
      REQUIRED_REGISTRY_MAXIMUM_ROOT_ENTRY_COUNT,
    configuredMaximumRootEntryCount: MAXIMUM_ROOT_ENTRY_COUNT,
    requiredMaximumRootTotalBytes:
      REQUIRED_REGISTRY_MAXIMUM_ROOT_TOTAL_BYTES.toString(),
    configuredMaximumRootTotalBytes: MAXIMUM_ROOT_TOTAL_BYTES.toString(),
  }),
});

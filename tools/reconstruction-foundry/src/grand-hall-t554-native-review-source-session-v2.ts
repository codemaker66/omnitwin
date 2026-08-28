import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import {
  replayGrandHallT554NativeReviewCoordinatorV2,
} from "./grand-hall-t554-native-review-coordinator-replay-v2.js";
import {
  createGrandHallT554NativeReviewDurableJournalV2,
  openGrandHallT554NativeReviewDurableJournalV2,
  openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2,
  type GrandHallT554NativeReviewDurableJournalReplayV2,
  type GrandHallT554NativeReviewDurableJournalV2,
  type GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2,
} from "./grand-hall-t554-native-review-durable-journal-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
  GrandHallT554NativeReviewAuthorityBoundaryV2Schema,
  GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
  GrandHallT554NativeReviewRegistryBindingV2Schema,
  GrandHallT554NativeReviewSessionScopeV2Schema,
  GrandHallT554NativeReviewSha256V2Schema,
  GrandHallT554NativeReviewSourceScopeV2Schema,
  computeGrandHallT554NativeReviewHumanAttestationV2Sha256,
  computeGrandHallT554NativeReviewSourceDecisionV2Sha256,
  type GrandHallT554NativeReviewCoordinatorEventV2,
  type GrandHallT554NativeReviewHumanAttestationRecordedPayloadV2,
  type GrandHallT554NativeReviewImplementationManifestBindingV2,
  type GrandHallT554NativeReviewRegistryBindingV2,
  type GrandHallT554NativeReviewSessionScopeV2,
  type GrandHallT554NativeReviewSourceCoverageCarryStateV2,
  type GrandHallT554NativeReviewSourceChildEventV2,
  type GrandHallT554NativeReviewSourceCustodyBindingV2,
  type GrandHallT554NativeReviewSourceDecisionRecordedPayloadV2,
  type GrandHallT554NativeReviewSourceScopeV2,
} from "./grand-hall-t554-native-review-events-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  assertGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1,
  assertGrandHallT554VerifiedNativeReviewImplementationPackV1,
  type GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1,
  type GrandHallT554VerifiedNativeReviewImplementationPackV1,
} from "./grand-hall-t554-native-review-implementation-manifest.js";
import {
  computeGrandHallT554NativeReviewSourceReviewSubjectV2Sha256,
  planGrandHallT554NativeReviewNextSourceCoverageEventV2,
} from "./grand-hall-t554-native-review-source-kernel-v2.js";
import {
  acquireGrandHallT554NativeReviewSessionOwnerV2,
  assertGrandHallT554NativeReviewSessionOwnerV2,
  explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2,
  releaseGrandHallT554NativeReviewSessionOwnerV2,
  type GrandHallT554NativeReviewPriorOwnerWitnessV2,
  type GrandHallT554NativeReviewSessionOwnerLeaseV2,
} from "./grand-hall-t554-native-review-session-owner-v2.js";
import {
  findExactPendingCoordinatorIntentEventV2,
  latestVerifiedActiveSourceEvidenceV2,
  rotateGrandHallT554NativeReviewBrowserEpochV2,
} from "./grand-hall-t554-native-review-session-orchestration-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_SESSION_ROOT_DESCRIPTOR_V2,
  openGrandHallT554NativeReviewSessionStoreV2,
  type GrandHallT554NativeReviewSessionStoreReplayV2,
} from "./grand-hall-t554-native-review-session-store-v2.js";
import {
  assertGrandHallT554NativeReviewRegistry,
  type GrandHallT554NativeReviewRegistry,
  type GrandHallT554NativeReviewRegistrySource,
} from "./grand-hall-t554-native-review-registry.js";
import {
  createGrandHallT554NativeReviewCoverageCarryStateV2,
  replayGrandHallT554NativeReviewSourceChildV2,
} from "./grand-hall-t554-native-review-replay-v2.js";
import {
  GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH,
  computeGrandHallT554NativeSourceEpochBindingSha256V1,
  openGrandHallT554NativeSourceEpochV1,
  type GrandHallT554NativeSourceEpochBindingsV1,
  type GrandHallT554NativeSourceEpochSnapshotV1,
  type GrandHallT554NativeSourceTileRequestV1,
} from "./grand-hall-t554-native-source-epoch.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

const SESSION_SNAPSHOT_SCHEMA =
  "venviewer.grand-hall-t554-native-review-source-session.v2";
const SOURCE_TILE_SCHEMA =
  "venviewer.grand-hall-t554-native-review-source-tile.v2";
const SOURCE_COVERAGE_ACK_SCHEMA =
  "venviewer.grand-hall-t554-native-review-source-coverage-ack.v2";
const CHILD_SCOPE_DESCRIPTOR_SCHEMA =
  "venviewer.grand-hall-t554-native-review-child-scope-descriptor.v2";
const SESSION_SUBJECT_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_SESSION_SUBJECT_V2";
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SOURCE_COUNT = 148;
const TILE_COLUMN_COUNT = 32;
const TILE_ROW_COUNT = 16;
const TILE_WIDTH_PX = 256;
const TILE_HEIGHT_PX = 256;

type Sha256 = `sha256:${string}`;
type SourcePhase =
  | "source_review"
  | "source_decided"
  | "human_attested";
type SourceOnlyExcludeDecision = Extract<
  GrandHallT554NativeReviewSourceDecisionRecordedPayloadV2,
  { readonly result: "EXCLUDE" }
>;

const AuthorityBoundary = GrandHallT554NativeReviewAuthorityBoundaryV2Schema.parse({
  schemaVersion:
    "venviewer.grand-hall-t554-native-review-authority-boundary.v2",
  authority: "none",
  reviewState: "human_pending",
  finalDecision: "PENDING",
  acceptanceAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  exportAuthorized: false,
  generatedContentAuthorized: false,
});

const NonceSchema = z.string().regex(NONCE_PATTERN).refine((value) => {
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}, "nonce must be one canonical 256-bit base64url token");

const SessionRootSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      isAbsolute(value) &&
      !value.includes("\0") &&
      value.normalize("NFC") === value &&
      !value.startsWith("\\\\") &&
      !value.startsWith("//"),
    "sessionRoot must be one absolute local NFC path",
  );

const WorkspaceRevisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const RenderGenerationSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const SelectSourceInputSchema = z
  .object({
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    inventoryIndex: z.number().int().min(0).max(SOURCE_COUNT - 1),
  })
  .strict();

const SourceBindingInputShape = {
  sourceEpochNonce: NonceSchema,
  renderGeneration: RenderGenerationSchema,
};

const SourceTileInputSchema = z
  .object({
    ...SourceBindingInputShape,
    column: z.number().int().min(0).max(TILE_COLUMN_COUNT - 1),
    row: z.number().int().min(0).max(TILE_ROW_COUNT - 1),
  })
  .strict();

const SourceCoverageInputSchema = z
  .object({
    ...SourceBindingInputShape,
    documentVisibilityState: z.enum(["visible", "hidden", "prerender"]),
    documentFocusState: z.enum(["focused", "blurred"]),
    viewportCssWidth: z.number().finite().positive().max(16_384),
    viewportCssHeight: z.number().finite().positive().max(16_384),
    devicePixelRatio: z.number().finite().min(0.25).max(8),
    sourceToCssTransform: z
      .object({
        a: z.number().finite().positive().max(64),
        b: z.literal(0),
        c: z.literal(0),
        d: z.number().finite().positive().max(64),
        e: z.number().finite().min(-1_000_000).max(1_000_000),
        f: z.number().finite().min(-1_000_000).max(1_000_000),
      })
      .strict(),
    paintedTileBitsetHex: z.string().regex(/^[a-f0-9]{128}$/u),
  })
  .strict();

const ExcludeDecisionInputSchema = z
  .object({
    ...SourceBindingInputShape,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    note: z.string().trim().min(1).max(1_000),
  })
  .strict();

const HumanAttestationInputSchema = z
  .object({
    expectedBrowserEpochNonceSha256:
      GrandHallT554NativeReviewSha256V2Schema,
    renderGeneration: RenderGenerationSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    reviewerId: z.string().trim().min(1).max(160),
    knowledgeBasis: z
      .array(z.string().trim().min(1).max(240))
      .min(1)
      .max(32),
  })
  .strict();

const AbandonInputSchema = z
  .object({
    expectedBrowserEpochNonceSha256:
      GrandHallT554NativeReviewSha256V2Schema,
    renderGeneration: RenderGenerationSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    reason: z.enum(["operator_abandon", "source_switch", "session_stop"]),
  })
  .strict();

const StopInputSchema = z
  .object({ expectedWorkspaceRevision: WorkspaceRevisionSchema })
  .strict();

const RootDescriptorSchema = z
  .object({
    schemaVersion: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_SESSION_ROOT_DESCRIPTOR_V2,
    ),
    sessionScope: GrandHallT554NativeReviewSessionScopeV2Schema,
    implementationManifestFileName: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
    ),
    coordinatorDirectoryName: z.literal("coordinator"),
    childScopesDirectoryName: z.literal("child-scopes"),
    childrenDirectoryName: z.literal("children"),
    maskEvidenceDirectoryName: z.literal("mask-evidence"),
  })
  .strict();

interface SessionSourceEpoch {
  readonly snapshot: () => GrandHallT554NativeSourceEpochSnapshotV1;
  readonly copyTile: (input: GrandHallT554NativeSourceTileRequestV1) => Buffer;
  readonly abandon: () => Promise<void>;
}

interface SourceSessionSeams {
  readonly afterSourceSelectionIntentDurable?: () => Promise<void> | void;
  readonly afterSourceChildPublished?: () => Promise<void> | void;
  readonly afterSourceDescriptorPublished?: () => Promise<void> | void;
  readonly afterSourceSelectionCommitDurable?: () => Promise<void> | void;
  readonly afterBrowserEpochStartedDurable?: () => Promise<void> | void;
  readonly afterCoverageResumeIntentDurable?: () => Promise<void> | void;
  readonly afterCoverageResumeChildPublished?: () => Promise<void> | void;
  readonly afterCoverageResumeDescriptorPublished?: () => Promise<void> | void;
  readonly afterCoverageResumeCommitDurable?: () => Promise<void> | void;
}

interface SourceSessionDependencies {
  readonly registry: {
    readonly binding: GrandHallT554NativeReviewRegistryBindingV2;
    readonly sourceAt: (
      inventoryIndex: number,
    ) => GrandHallT554NativeReviewRegistrySource;
    readonly mediaInputAt: (inventoryIndex: number) => {
      readonly sourceRoot: string;
      readonly fileName: string;
      readonly expectedSha256: string;
      readonly expectedByteLength: number;
    };
  };
  readonly implementationManifestBinding: GrandHallT554NativeReviewImplementationManifestBindingV2;
  readonly copyExactManifestBytes: () => Buffer;
  readonly openSourceEpoch: (input: {
    readonly sourceRoot: string;
    readonly bindings: GrandHallT554NativeSourceEpochBindingsV1;
  }) => Promise<SessionSourceEpoch>;
  readonly newNonce: () => string;
  readonly nowUtc: () => string;
  readonly monotonicNowMs: () => number;
  readonly seam?: SourceSessionSeams;
}

interface ActiveRuntime {
  readonly epoch: SessionSourceEpoch;
  readonly sourceEpochNonce: string;
  readonly sourceScope: GrandHallT554NativeReviewSourceScopeV2;
  readonly childJournal: GrandHallT554NativeReviewDurableJournalV2;
  evidence: GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2;
}

interface PendingTile {
  resolved: boolean;
  readonly bytes: Buffer;
  readonly preparedBytesSha256: Sha256;
}

export interface GrandHallT554NativeReviewSourceSessionSnapshotV2 {
  readonly schemaVersion: typeof SESSION_SNAPSHOT_SCHEMA;
  readonly lifecycle: "active" | "poisoned" | "stopped";
  readonly sessionIdSha256: Sha256;
  readonly workspaceRevision: number;
  readonly maximumAllocatedRenderGeneration: number;
  readonly browserEpochNumber: number;
  readonly browserEpochNonceSha256: Sha256;
  readonly activeSource: {
    readonly inventoryIndex: number;
    readonly sweepNumber: number;
    readonly sourceEpochNonce: string | null;
    readonly renderGeneration: number;
    readonly phase: SourcePhase;
    readonly sourceReviewSubjectSha256: Sha256;
    readonly tileGrid: {
      readonly widthPx: typeof TILE_WIDTH_PX;
      readonly heightPx: typeof TILE_HEIGHT_PX;
      readonly columnCount: typeof TILE_COLUMN_COUNT;
      readonly rowCount: typeof TILE_ROW_COUNT;
    };
    readonly sourceCoverage: {
      readonly eventCount: number;
      readonly deliveredTileCount: number;
      readonly completedTileCount: number;
      readonly completedTileBitsetHex: string;
      readonly complete: boolean;
    };
    readonly decision: SourceOnlyExcludeDecision | null;
    readonly humanAttestation: GrandHallT554NativeReviewHumanAttestationRecordedPayloadV2 | null;
  } | null;
  readonly authority: "none";
  readonly reviewState: "human_pending";
  readonly finalDecision: "PENDING";
  readonly acceptanceAuthorized: false;
  readonly reconstructionAuthorized: false;
  readonly runtimeAuthorized: false;
  readonly exportAuthorized: false;
  readonly generatedContentAuthorized: false;
  readonly rootInventorySha256: Sha256;
  readonly verificationAttestationSha256: Sha256;
}

export interface GrandHallT554NativeReviewSourceTileV2 {
  readonly schemaVersion: typeof SOURCE_TILE_SCHEMA;
  readonly renderMode: "source_rgb8";
  readonly widthPx: typeof TILE_WIDTH_PX;
  readonly heightPx: typeof TILE_HEIGHT_PX;
  readonly sourceRgb8: Buffer;
  readonly commitDeliveryAfterSuccessfulSend: () => Promise<void>;
  readonly discardAfterFailedSend: () => Promise<void>;
}

export interface GrandHallT554NativeReviewSourceCoverageAcknowledgementV2 {
  readonly schemaVersion: typeof SOURCE_COVERAGE_ACK_SCHEMA;
  readonly sequence: number;
  readonly journalRevision: number;
  readonly completedTileCount: number;
  readonly complete: boolean;
}

export type GrandHallT554NativeReviewSourceSessionV2ErrorCode =
  | "ARGUMENT_INVALID"
  | "ROOT_ALREADY_EXISTS"
  | "ROOT_MISSING"
  | "SESSION_CLOSED"
  | "SESSION_STOPPED"
  | "SESSION_POISONED"
  | "WORKSPACE_REVISION_CONFLICT"
  | "NO_ACTIVE_SOURCE"
  | "SOURCE_STALE"
  | "PHASE_INVALID"
  | "SOURCE_COVERAGE_INCOMPLETE"
  | "DELIVERY_ALREADY_RESOLVED"
  | "SOURCE_TILE_MUTATED"
  | "DURABILITY_FAILURE"
  | "RESOURCE_FAILURE"
  | "RESOURCE_CLEANUP_FAILED"
  | "CRASH_RECOVERY_REQUIRED"
  | "INTERNAL_INVARIANT_FAILED";

export class GrandHallT554NativeReviewSourceSessionV2Error extends Error {
  constructor(
    readonly code: GrandHallT554NativeReviewSourceSessionV2ErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewSourceSessionV2Error";
  }
}

export interface GrandHallT554NativeReviewSourceSessionV2 {
  snapshot(): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2>;
  selectSource(input: {
    readonly expectedWorkspaceRevision: number;
    readonly inventoryIndex: number;
  }): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2>;
  prepareSourceTile(input: {
    readonly sourceEpochNonce: string;
    readonly renderGeneration: number;
    readonly column: number;
    readonly row: number;
  }): Promise<GrandHallT554NativeReviewSourceTileV2>;
  recordSourceCoverage(input: {
    readonly sourceEpochNonce: string;
    readonly renderGeneration: number;
    readonly documentVisibilityState: "visible" | "hidden" | "prerender";
    readonly documentFocusState: "focused" | "blurred";
    readonly viewportCssWidth: number;
    readonly viewportCssHeight: number;
    readonly devicePixelRatio: number;
    readonly sourceToCssTransform: {
      readonly a: number;
      readonly b: number;
      readonly c: number;
      readonly d: number;
      readonly e: number;
      readonly f: number;
    };
    readonly paintedTileBitsetHex: string;
  }): Promise<GrandHallT554NativeReviewSourceCoverageAcknowledgementV2>;
  recordExcludeDecision(input: {
    readonly sourceEpochNonce: string;
    readonly renderGeneration: number;
    readonly expectedWorkspaceRevision: number;
    readonly note: string;
  }): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2>;
  recordHumanAttestation(input: {
    readonly expectedBrowserEpochNonceSha256: Sha256;
    readonly renderGeneration: number;
    readonly expectedWorkspaceRevision: number;
    readonly reviewerId: string;
    readonly knowledgeBasis: readonly string[];
  }): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2>;
  abandonActiveSource(input: {
    readonly expectedBrowserEpochNonceSha256: Sha256;
    readonly renderGeneration: number;
    readonly expectedWorkspaceRevision: number;
    readonly reason: "operator_abandon" | "source_switch" | "session_stop";
  }): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2>;
  stop(input: {
    readonly expectedWorkspaceRevision: number;
  }): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2>;
  close(): Promise<void>;
}

class SerialMutationLane {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function fail(
  code: GrandHallT554NativeReviewSourceSessionV2ErrorCode,
  message: string,
  cause?: unknown,
): GrandHallT554NativeReviewSourceSessionV2Error {
  return new GrandHallT554NativeReviewSourceSessionV2Error(
    code,
    message,
    cause,
  );
}

function sha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function nonceSha256(value: string): Sha256 {
  return sha256(Buffer.from(value, "utf8"));
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

function event<Event extends GrandHallT554NativeReviewCoordinatorEventV2>(
  eventType: Event["eventType"],
  payload: Event["payload"],
): Event {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType,
    payload,
  } as Event;
}

function parseInput<TOutput, TDefinition extends z.ZodTypeDef, TInput>(
  schema: z.ZodType<TOutput, TDefinition, TInput>,
  input: unknown,
): TOutput {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw fail("ARGUMENT_INVALID", "Input does not match the exact source-session contract.", result.error);
  }
  return result.data;
}

function resolveSessionRoot(value: string): string {
  return resolve(parseInput(SessionRootSchema, value));
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
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function directKind(
  path: string,
): Promise<"absent" | "file" | "directory"> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw fail("CRASH_RECOVERY_REQUIRED", "Recovery path is a symbolic link.");
    }
    if (stats.isFile()) return "file";
    if (stats.isDirectory()) return "directory";
    throw fail("CRASH_RECOVERY_REQUIRED", "Recovery path has an unsupported node kind.");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return "absent";
    throw error;
  }
}

function laterUtc(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function assertExactManifestBytes(
  binding: GrandHallT554NativeReviewImplementationManifestBindingV2,
  bytes: Buffer,
): void {
  if (bytes.length !== binding.byteLength || sha256(bytes) !== binding.fileSha256) {
    throw fail(
      "ARGUMENT_INVALID",
      "Exact implementation-manifest bytes differ from their verified binding.",
    );
  }
}

function sourceEpochBindings(input: {
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
  readonly source: GrandHallT554NativeReviewRegistrySource["source"];
  readonly registry: GrandHallT554NativeReviewRegistryBindingV2;
  readonly implementationManifest: GrandHallT554NativeReviewImplementationManifestBindingV2;
}): GrandHallT554NativeSourceEpochBindingsV1 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-source-epoch-bindings.v1",
    sourceEpochNonce: input.sourceEpochNonce,
    renderGeneration: input.renderGeneration,
    reviewPack: input.registry.reviewPack,
    publicationReceipt: input.registry.publicationReceipt,
    workbenchImplementationManifest: {
      semanticSha256: input.implementationManifest.semanticSha256,
      fileSha256: input.implementationManifest.fileSha256,
      byteLength: input.implementationManifest.byteLength,
    },
    source: input.source,
  };
}

function assertEpochSnapshot(
  snapshot: GrandHallT554NativeSourceEpochSnapshotV1,
  bindings: GrandHallT554NativeSourceEpochBindingsV1,
): void {
  const observedSchemaVersion: string = snapshot.schemaVersion;
  const observedTileGrid: Readonly<{
    widthPx: number;
    heightPx: number;
    channelCount: number;
    resampling: string;
  }> = snapshot.tileGrid;
  const expectedEpochBindingSha256 =
    computeGrandHallT554NativeSourceEpochBindingSha256V1(
      bindings,
      snapshot.sourceVerification,
    );
  if (
    observedSchemaVersion !==
      "venviewer.grand-hall-t554-native-source-epoch.v1" ||
    snapshot.lifecycle !== "active" ||
    snapshot.closedDisposition !== null ||
    snapshot.sourceEpochNonce !== bindings.sourceEpochNonce ||
    snapshot.sourceEpochNonceSha256 !== nonceSha256(bindings.sourceEpochNonce) ||
    snapshot.renderGeneration !== bindings.renderGeneration ||
    snapshot.epochBindingSha256 !== expectedEpochBindingSha256 ||
    !canonicalEqual(snapshot.source, bindings.source) ||
    !canonicalEqual(snapshot.reviewPack, bindings.reviewPack) ||
    !canonicalEqual(snapshot.publicationReceipt, bindings.publicationReceipt) ||
    !canonicalEqual(
      snapshot.workbenchImplementationManifest,
      bindings.workbenchImplementationManifest,
    ) ||
    observedTileGrid.widthPx !== TILE_WIDTH_PX ||
    observedTileGrid.heightPx !== TILE_HEIGHT_PX ||
    snapshot.tileGrid.columnCount !== TILE_COLUMN_COUNT ||
    snapshot.tileGrid.rowCount !== TILE_ROW_COUNT ||
    observedTileGrid.channelCount !== 3 ||
    observedTileGrid.resampling !== "none" ||
    snapshot.tileGrid.bytesPerTile !== GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH
  ) {
    throw fail(
      "RESOURCE_FAILURE",
      "Native source epoch did not return the exact prepared source binding.",
    );
  }
}

function custodyFromEpoch(input: {
  readonly snapshot: GrandHallT554NativeSourceEpochSnapshotV1;
  readonly registry: GrandHallT554NativeReviewRegistryBindingV2;
  readonly implementationManifest: GrandHallT554NativeReviewImplementationManifestBindingV2;
}): GrandHallT554NativeReviewSourceCustodyBindingV2 {
  const sourceReviewSubjectSha256 =
    computeGrandHallT554NativeReviewSourceReviewSubjectV2Sha256({
      schemaVersion:
        "venviewer.grand-hall-t554-native-source-review-subject-material.v2",
      source: input.snapshot.source,
      sourceVerification: input.snapshot.sourceVerification,
      registry: input.registry,
      implementationManifest: input.implementationManifest,
    });
  return {
    source: input.snapshot.source,
    sourceVerification: input.snapshot.sourceVerification,
    sourceReviewSubjectSha256,
    sourceEpochBindingSha256: input.snapshot.epochBindingSha256,
    sourceEpochNonceSha256: input.snapshot.sourceEpochNonceSha256,
    sourceEpochRenderGeneration: input.snapshot.renderGeneration,
  };
}

function sourceScope(input: {
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly browserEpochNonceSha256: Sha256;
  readonly coverageSegmentIdSha256: Sha256;
  readonly renderGeneration: number;
  readonly sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2;
}): GrandHallT554NativeReviewSourceScopeV2 {
  return GrandHallT554NativeReviewSourceScopeV2Schema.parse({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "source",
    sessionIdSha256: input.sessionScope.sessionIdSha256,
    implementationManifest: input.sessionScope.implementationManifest,
    registry: input.sessionScope.registry,
    authorityBoundary: input.sessionScope.authorityBoundary,
    browserEpochNonceSha256: input.browserEpochNonceSha256,
    coverageSegmentIdSha256: input.coverageSegmentIdSha256,
    renderGeneration: input.renderGeneration,
    sourceCustody: input.sourceCustody,
  });
}

function childDescriptorBytes(
  leafName: string,
  scope: GrandHallT554NativeReviewSourceScopeV2,
): Buffer {
  return canonicalBytes({
    schemaVersion: CHILD_SCOPE_DESCRIPTOR_SCHEMA,
    leafName,
    scope,
  });
}

function sourceStartEvent(input: {
  readonly scope: GrandHallT554NativeReviewSourceScopeV2;
  readonly startedAtUtc: string;
  readonly predecessorCoverage: GrandHallT554NativeReviewSourceCoverageCarryStateV2 | null;
}): GrandHallT554NativeReviewSourceChildEventV2 {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType: "source.review-started.v2",
    payload: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-review-started.v2",
      browserEpochNonceSha256: input.scope.browserEpochNonceSha256,
      coverageSegmentIdSha256: input.scope.coverageSegmentIdSha256,
      coverageSegmentStartedAtUtc: input.startedAtUtc,
      firstSampleMustCreditZero: true,
      renderGeneration: input.scope.renderGeneration,
      sourceCustody: input.scope.sourceCustody,
      registry: input.scope.registry,
      implementationManifest: input.scope.implementationManifest,
      tileGrid: {
        widthPx: TILE_WIDTH_PX,
        heightPx: TILE_HEIGHT_PX,
        columnCount: TILE_COLUMN_COUNT,
        rowCount: TILE_ROW_COUNT,
        channelCount: 3,
        bytesPerTile: GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH,
        resampling: "none",
      },
      predecessorCoverage: input.predecessorCoverage,
      authorityBoundary: input.scope.authorityBoundary,
    },
  };
}

function sourceChildLeaf(
  kind: "selection" | "resume",
  renderGeneration: number,
  identity: Sha256,
): string {
  return `source-${kind}-${String(renderGeneration).padStart(8, "0")}-${identity.slice(-20)}`;
}

async function readSessionScope(
  sessionRoot: string,
): Promise<GrandHallT554NativeReviewSessionScopeV2> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(sessionRoot, "session-root.json"));
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      throw fail("ROOT_MISSING", "The source-review session root does not exist.", error);
    }
    throw error;
  }
  const parsed = parseGrandHallT554StrictJson(bytes);
  if (!bytes.equals(canonicalBytes(parsed))) {
    throw fail("CRASH_RECOVERY_REQUIRED", "Session root descriptor is not canonical JSON plus LF.");
  }
  return RootDescriptorSchema.parse(parsed).sessionScope;
}

function assertDependencyBindings(
  scope: GrandHallT554NativeReviewSessionScopeV2,
  dependencies: SourceSessionDependencies,
): void {
  const registry = GrandHallT554NativeReviewRegistryBindingV2Schema.parse(
    dependencies.registry.binding,
  );
  const implementation =
    GrandHallT554NativeReviewImplementationManifestBindingV2Schema.parse(
      dependencies.implementationManifestBinding,
    );
  if (
    !canonicalEqual(scope.registry, registry) ||
    !canonicalEqual(scope.implementationManifest, implementation) ||
    !canonicalEqual(scope.authorityBoundary, AuthorityBoundary)
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "Session dependencies differ from the exact persisted trust boundary.",
    );
  }
}

async function publishDescriptorFromBytes(input: {
  readonly sessionRoot: string;
  readonly leafName: string;
  readonly bytes: Buffer;
  readonly nonce: string;
}): Promise<void> {
  const parent = dirname(input.sessionRoot);
  const staged = join(
    parent,
    `.venviewer-t554-descriptor-${input.leafName}-${nonceSha256(input.nonce).slice(-16)}.stage`,
  );
  await writeSyncedFile(staged, input.bytes);
  await rename(
    staged,
    join(input.sessionRoot, "child-scopes", `${input.leafName}.json`),
  );
  await syncDirectory(join(input.sessionRoot, "child-scopes"));
}

interface PublishedSourceChild {
  readonly scope: GrandHallT554NativeReviewSourceScopeV2;
  readonly journal: GrandHallT554NativeReviewDurableJournalV2;
  readonly evidence: GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2;
}

async function publishSourceChild(input: {
  readonly sessionRoot: string;
  readonly scope: GrandHallT554NativeReviewSourceScopeV2;
  readonly leafName: string;
  readonly startedAtUtc: string;
  readonly predecessorCoverage: GrandHallT554NativeReviewSourceCoverageCarryStateV2 | null;
  readonly predecessorEvidence?: GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2;
  readonly stageNonce: string;
  readonly afterChildPublished?: () => Promise<void> | void;
  readonly afterDescriptorPublished?: () => Promise<void> | void;
}): Promise<PublishedSourceChild> {
  const stageRoot = join(
    dirname(input.sessionRoot),
    `.venviewer-t554-child-${input.leafName}-${nonceSha256(input.stageNonce).slice(-16)}.stage`,
  );
  const stagedChild = join(stageRoot, input.leafName);
  const stagedDescriptor = join(stageRoot, `${input.leafName}.json`);
  await mkdir(stageRoot);
  await mkdir(stagedChild);
  const stagedJournal = await createGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: stagedChild,
    scope: input.scope,
  });
  await stagedJournal.append({
    expectedRevision: 0,
    event: sourceStartEvent({
      scope: input.scope,
      startedAtUtc: input.startedAtUtc,
      predecessorCoverage: input.predecessorCoverage,
    }),
    ...(input.predecessorEvidence === undefined
      ? {}
      : { predecessorEvidence: input.predecessorEvidence }),
  });
  await writeSyncedFile(
    stagedDescriptor,
    childDescriptorBytes(input.leafName, input.scope),
  );
  await syncDirectory(stageRoot);

  await rename(
    stagedChild,
    join(input.sessionRoot, "children", input.leafName),
  );
  await syncDirectory(join(input.sessionRoot, "children"));
  await input.afterChildPublished?.();

  await rename(
    stagedDescriptor,
    join(input.sessionRoot, "child-scopes", `${input.leafName}.json`),
  );
  await syncDirectory(join(input.sessionRoot, "child-scopes"));
  await input.afterDescriptorPublished?.();

  const journal = await openGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: join(input.sessionRoot, "children", input.leafName),
    expectedScope: input.scope,
  });
  const evidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot: join(input.sessionRoot, "children", input.leafName),
      expectedScope: input.scope,
    });
  if (evidence.kind !== "source") {
    throw fail("INTERNAL_INVARIANT_FAILED", "Published source child reopened as a mask child.");
  }
  await rm(stageRoot, { force: true, recursive: true });
  return { scope: input.scope, journal, evidence };
}

function registryBindingFromRegistry(
  registry: GrandHallT554NativeReviewRegistry,
): GrandHallT554NativeReviewRegistryBindingV2 {
  const summary = registry.summary;
  return GrandHallT554NativeReviewRegistryBindingV2Schema.parse({
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-registry-binding.v2",
    venueSlug: summary.venueSlug,
    roomSlug: summary.roomSlug,
    sourceCount: summary.sourceCount,
    reviewPack: {
      semanticSha256: summary.reviewPackSha256,
      fileSha256: summary.reviewPackFileSha256,
      byteLength: summary.reviewPackFileByteLength,
    },
    publicationReceipt: {
      semanticSha256: summary.publicationReceiptSha256,
      fileSha256: summary.publicationReceiptFileSha256,
      byteLength: summary.publicationReceiptFileByteLength,
    },
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    acceptanceAuthorized: false,
    reconstructionAuthorized: false,
    runtimeAuthorized: false,
    exportAuthorized: false,
    generatedContentAuthorized: false,
  });
}

function productionDependencies(input: {
  readonly registry: GrandHallT554NativeReviewRegistry;
  readonly implementationPack: GrandHallT554VerifiedNativeReviewImplementationPackV1;
  readonly runtimeAuthority: GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1;
}): SourceSessionDependencies {
  assertGrandHallT554NativeReviewRegistry(input.registry);
  assertGrandHallT554VerifiedNativeReviewImplementationPackV1(
    input.implementationPack,
  );
  assertGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1(
    input.runtimeAuthority,
    input.implementationPack,
  );
  return {
    registry: {
      binding: registryBindingFromRegistry(input.registry),
      sourceAt: (inventoryIndex) => input.registry.sourceAt(inventoryIndex),
      mediaInputAt: (inventoryIndex) =>
        input.registry.mediaInputAt(inventoryIndex),
    },
    implementationManifestBinding: input.implementationPack.manifestBinding,
    copyExactManifestBytes: () =>
      input.implementationPack.copyExactManifestBytes(),
    openSourceEpoch: async (options) =>
      openGrandHallT554NativeSourceEpochV1(options),
    newNonce: () => randomBytes(32).toString("base64url"),
    nowUtc: () => new Date().toISOString(),
    monotonicNowMs: () => Number(process.hrtime.bigint() / 1_000_000n),
  };
}

async function abandonEpochAfterOperationFailure(
  epoch: SessionSourceEpoch,
  operationError: unknown,
  operation: string,
): Promise<never> {
  try {
    await epoch.abandon();
  } catch (cleanupError) {
    throw fail(
      "RESOURCE_CLEANUP_FAILED",
      `Native source epoch cleanup failed after ${operation}.`,
      { operationError, cleanupError },
    );
  }
  throw operationError;
}

async function prepareEpoch(input: {
  readonly dependencies: SourceSessionDependencies;
  readonly inventoryIndex: number;
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
}): Promise<{
  readonly epoch: SessionSourceEpoch;
  readonly snapshot: GrandHallT554NativeSourceEpochSnapshotV1;
  readonly source: GrandHallT554NativeReviewRegistrySource;
  readonly custody: GrandHallT554NativeReviewSourceCustodyBindingV2;
}> {
  const source = input.dependencies.registry.sourceAt(input.inventoryIndex);
  const media = input.dependencies.registry.mediaInputAt(input.inventoryIndex);
  if (
    media.fileName !== source.source.fileName ||
    media.expectedSha256 !== source.source.sha256 ||
    media.expectedByteLength !== source.source.byteLength ||
    typeof media.sourceRoot !== "string" ||
    media.sourceRoot.length === 0
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "Registry media input differs from the selected source identity.",
    );
  }
  const bindings = sourceEpochBindings({
    sourceEpochNonce: input.sourceEpochNonce,
    renderGeneration: input.renderGeneration,
    source: source.source,
    registry: input.dependencies.registry.binding,
    implementationManifest:
      input.dependencies.implementationManifestBinding,
  });
  const epoch = await input.dependencies.openSourceEpoch({
    sourceRoot: media.sourceRoot,
    bindings,
  });
  try {
    const snapshot = epoch.snapshot();
    assertEpochSnapshot(snapshot, bindings);
    const custody = custodyFromEpoch({
      snapshot,
      registry: input.dependencies.registry.binding,
      implementationManifest:
        input.dependencies.implementationManifestBinding,
    });
    return { epoch, snapshot, source, custody };
  } catch (error) {
    return await abandonEpochAfterOperationFailure(
      epoch,
      error,
      "prepared-epoch validation",
    );
  }
}

class GrandHallT554NativeReviewSourceSessionControllerV2
  implements GrandHallT554NativeReviewSourceSessionV2
{
  readonly #lane = new SerialMutationLane();
  readonly #pendingTiles = new Set<PendingTile>();
  #store: GrandHallT554NativeReviewSessionStoreReplayV2;
  #runtime: ActiveRuntime | null;
  #closed = false;

  constructor(
    readonly sessionRoot: string,
    readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2,
    readonly dependencies: SourceSessionDependencies,
    readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2,
    readonly coordinatorJournal: GrandHallT554NativeReviewDurableJournalV2,
    store: GrandHallT554NativeReviewSessionStoreReplayV2,
    runtime: ActiveRuntime | null,
  ) {
    this.#store = store;
    this.#runtime = runtime;
  }

  async #assertOwner(): Promise<void> {
    if (this.#closed) {
      throw fail("SESSION_CLOSED", "Source-review controller is closed.");
    }
    await assertGrandHallT554NativeReviewSessionOwnerV2({
      lease: this.lease,
      sessionRoot: this.sessionRoot,
      expectedSessionScope: this.sessionScope,
    });
  }

  async #refreshStore(): Promise<void> {
    await this.#assertOwner();
    const verified = await openGrandHallT554NativeReviewSessionStoreV2({
      sessionRoot: this.sessionRoot,
      expectedSessionScope: this.sessionScope,
      lease: this.lease,
    });
    await this.#assertOwner();
    this.#store = verified;
  }

  #coordinator() {
    return this.#store.coordinator;
  }

  #assertMutableLifecycle(): void {
    if (this.#coordinator().lifecycle === "stopped") {
      throw fail("SESSION_STOPPED", "Stopped source-review session is immutable.");
    }
    if (this.#coordinator().lifecycle === "poisoned") {
      throw fail("SESSION_POISONED", "Poisoned source-review session is immutable.");
    }
  }

  #assertWorkspaceRevision(expected: number): void {
    if (expected !== this.#coordinator().workspaceRevision) {
      throw fail(
        "WORKSPACE_REVISION_CONFLICT",
        "Source-review workspace revision CAS is stale.",
      );
    }
  }

  #currentEvidence(): GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2 {
    const active = this.#coordinator().activeSource;
    if (active === null) {
      throw fail("NO_ACTIVE_SOURCE", "There is no active source review.");
    }
    if (
      this.#runtime !== null &&
      this.#runtime.evidence.checkpoint.leafName ===
        active.sourceJournal.leafName
    ) {
      return this.#runtime.evidence;
    }
    const child = this.#store.children.find(
      (candidate) => candidate.leafName === active.sourceJournal.leafName,
    );
    if (child?.evidence.kind !== "source") {
      throw fail(
        "INTERNAL_INVARIANT_FAILED",
        "Active source child is absent from the fully verified session store.",
      );
    }
    return child.evidence;
  }

  #assertRuntimeBinding(input: {
    readonly sourceEpochNonce: string;
    readonly renderGeneration: number;
  }): {
    readonly active: NonNullable<
      GrandHallT554NativeReviewSessionStoreReplayV2["coordinator"]["activeSource"]
    >;
    readonly runtime: ActiveRuntime;
  } {
    const active = this.#coordinator().activeSource;
    const runtime = this.#runtime;
    if (active === null || runtime === null) {
      throw fail("NO_ACTIVE_SOURCE", "There is no active source capability.");
    }
    if (
      input.sourceEpochNonce !== runtime.sourceEpochNonce ||
      nonceSha256(input.sourceEpochNonce) !==
        active.sourceCustody.sourceEpochNonceSha256 ||
      input.renderGeneration !== active.renderGeneration
    ) {
      throw fail("SOURCE_STALE", "Source capability or render generation is stale.");
    }
    return { active, runtime };
  }

  #assertCoordinatorSourceBinding(input: {
    readonly expectedBrowserEpochNonceSha256: Sha256;
    readonly renderGeneration: number;
  }): {
    readonly active: NonNullable<
      GrandHallT554NativeReviewSessionStoreReplayV2["coordinator"]["activeSource"]
    >;
    readonly runtime: ActiveRuntime | null;
  } {
    const active = this.#coordinator().activeSource;
    const browser = this.#coordinator().browserEpoch;
    if (active === null || browser === null) {
      throw fail("NO_ACTIVE_SOURCE", "There is no active source lifecycle.");
    }
    if (
      input.renderGeneration !== active.renderGeneration ||
      input.expectedBrowserEpochNonceSha256 !== browser.nonceSha256
    ) {
      throw fail(
        "SOURCE_STALE",
        "Coordinator source generation or browser epoch is stale.",
      );
    }
    return { active, runtime: this.#runtime };
  }

  async #appendCoordinator(
    coordinatorEvent: GrandHallT554NativeReviewCoordinatorEventV2,
  ): Promise<GrandHallT554NativeReviewDurableJournalReplayV2> {
    await this.#assertOwner();
    const current = await this.coordinatorJournal.replay();
    const advanced = await this.coordinatorJournal.append({
      expectedRevision: current.revision,
      event: coordinatorEvent,
    });
    await this.#assertOwner();
    return advanced;
  }

  #snapshotVerified(): GrandHallT554NativeReviewSourceSessionSnapshotV2 {
    const coordinator = this.#coordinator();
    const browser = coordinator.browserEpoch;
    if (browser === null) {
      throw fail(
        "INTERNAL_INVARIANT_FAILED",
        "Verified source session has no browser epoch.",
      );
    }
    let activeSource: GrandHallT554NativeReviewSourceSessionSnapshotV2["activeSource"] =
      null;
    if (coordinator.activeSource !== null) {
      const runtime = this.#runtime;
      if (
        runtime === null &&
        coordinator.activeSource.phase !== "decision_recorded" &&
        coordinator.activeSource.phase !== "human_attested"
      ) {
        throw fail(
          "CRASH_RECOVERY_REQUIRED",
          "Active source has no process-local capability after reopen.",
        );
      }
      const evidence = this.#currentEvidence();
      const replay = replayGrandHallT554NativeReviewSourceChildV2(evidence);
      const decision = coordinator.activeSource.decision;
      if (decision !== null && decision.result !== "EXCLUDE") {
        throw fail(
          "PHASE_INVALID",
          "Source-only session cannot expose an include or mask decision.",
        );
      }
      const phase: SourcePhase =
        coordinator.activeSource.phase === "source_review"
          ? "source_review"
          : coordinator.activeSource.phase === "decision_recorded"
            ? "source_decided"
            : coordinator.activeSource.phase === "human_attested"
              ? "human_attested"
              : (() => {
                  throw fail(
                    "PHASE_INVALID",
                    "Source-only session cannot expose a mask workflow phase.",
                  );
                })();
      if (
        phase !== "source_review" &&
        decision === null
      ) {
        throw fail(
          "PHASE_INVALID",
          "Source-only terminal lifecycle requires one exact EXCLUDE decision.",
        );
      }
      activeSource = {
        inventoryIndex: coordinator.activeSource.sourceCustody.source.inventoryIndex,
        sweepNumber: coordinator.activeSource.sourceCustody.source.sweepNumber,
        sourceEpochNonce:
          phase === "source_review"
            ? runtime?.sourceEpochNonce ?? (() => {
                throw fail(
                  "CRASH_RECOVERY_REQUIRED",
                  "Source review has no process-local native epoch.",
                );
              })()
            : null,
        renderGeneration: coordinator.activeSource.renderGeneration,
        phase,
        sourceReviewSubjectSha256:
          coordinator.activeSource.sourceCustody.sourceReviewSubjectSha256,
        tileGrid: {
          widthPx: TILE_WIDTH_PX,
          heightPx: TILE_HEIGHT_PX,
          columnCount: TILE_COLUMN_COUNT,
          rowCount: TILE_ROW_COUNT,
        },
        sourceCoverage: {
          eventCount: replay.coverage.coverageEventCount,
          deliveredTileCount: replay.coverage.uniqueDeliveredTileCount,
          completedTileCount: replay.coverage.completedTileCount,
          completedTileBitsetHex: replay.coverage.completedTileBitsetHex,
          complete: replay.coverage.complete,
        },
        decision,
        humanAttestation: coordinator.activeSource.humanAttestation,
      };
    }
    return Object.freeze({
      schemaVersion: SESSION_SNAPSHOT_SCHEMA,
      lifecycle: coordinator.lifecycle,
      sessionIdSha256: coordinator.sessionIdSha256,
      workspaceRevision: coordinator.workspaceRevision,
      maximumAllocatedRenderGeneration:
        coordinator.maximumAllocatedRenderGeneration,
      browserEpochNumber: browser.number,
      browserEpochNonceSha256: browser.nonceSha256,
      activeSource,
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      exportAuthorized: false,
      generatedContentAuthorized: false,
      rootInventorySha256: this.#store.rootInventorySha256,
      verificationAttestationSha256:
        this.#store.verificationAttestationSha256,
    });
  }

  snapshot(): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    return this.#lane.run(async () => {
      await this.#refreshStore();
      return this.#snapshotVerified();
    });
  }

  selectSource(input: {
    readonly expectedWorkspaceRevision: number;
    readonly inventoryIndex: number;
  }): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(SelectSourceInputSchema, input);
      await this.#refreshStore();
      this.#assertMutableLifecycle();
      this.#assertWorkspaceRevision(request.expectedWorkspaceRevision);
      if (this.#coordinator().activeSource !== null) {
        throw fail(
          "PHASE_INVALID",
          "Active source must be explicitly abandoned before source selection.",
        );
      }
      const browser = this.#coordinator().browserEpoch;
      if (browser === null) {
        throw fail("INTERNAL_INVARIANT_FAILED", "Source selection has no browser epoch.");
      }
      const sourceEpochNonce = parseInput(NonceSchema, this.dependencies.newNonce());
      const allocatedRenderGeneration =
        this.#coordinator().maximumAllocatedRenderGeneration + 1;
      const prepared = await prepareEpoch({
        dependencies: this.dependencies,
        inventoryIndex: request.inventoryIndex,
        sourceEpochNonce,
        renderGeneration: allocatedRenderGeneration,
      });
      let runtimeTransferred = false;
      try {
      const operationIdSha256 = nonceSha256(
        parseInput(NonceSchema, this.dependencies.newNonce()),
      );
      const coverageSegmentIdSha256 = nonceSha256(
        parseInput(NonceSchema, this.dependencies.newNonce()),
      );
      const leafName = sourceChildLeaf(
        "selection",
        allocatedRenderGeneration,
        coverageSegmentIdSha256,
      );
      const scope = sourceScope({
        sessionScope: this.sessionScope,
        browserEpochNonceSha256: browser.nonceSha256,
        coverageSegmentIdSha256,
        renderGeneration: allocatedRenderGeneration,
        sourceCustody: prepared.custody,
      });
      await this.#appendCoordinator(
        event<Extract<
          GrandHallT554NativeReviewCoordinatorEventV2,
          { readonly eventType: "source.selection-intended.v2" }
        >>("source.selection-intended.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-source-selection-intended.v2",
          operationIdSha256,
          browserEpochNonceSha256: browser.nonceSha256,
          expectedWorkspaceRevision: request.expectedWorkspaceRevision,
          source: prepared.source.source,
          preparedSourceCustody: prepared.custody,
          sourceEpochNonceSha256: prepared.custody.sourceEpochNonceSha256,
          coverageSegmentIdSha256,
          previousRenderGeneration:
            this.#coordinator().maximumAllocatedRenderGeneration,
          allocatedRenderGeneration,
          childJournalLeafName: leafName,
          priorActiveSourceJournal: null,
        }),
      );
      await this.dependencies.seam?.afterSourceSelectionIntentDurable?.();

      const published = await publishSourceChild({
        sessionRoot: this.sessionRoot,
        scope,
        leafName,
        startedAtUtc: this.dependencies.nowUtc(),
        predecessorCoverage: null,
        stageNonce: parseInput(NonceSchema, this.dependencies.newNonce()),
        afterChildPublished:
          this.dependencies.seam?.afterSourceChildPublished,
        afterDescriptorPublished:
          this.dependencies.seam?.afterSourceDescriptorPublished,
      });
      await this.#appendCoordinator(
        event<Extract<
          GrandHallT554NativeReviewCoordinatorEventV2,
          { readonly eventType: "source.selection-committed.v2" }
        >>("source.selection-committed.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-source-selection-committed.v2",
          operationIdSha256,
          browserEpochNonceSha256: browser.nonceSha256,
          coverageSegmentIdSha256,
          previousWorkspaceRevision: request.expectedWorkspaceRevision,
          resultingWorkspaceRevision: request.expectedWorkspaceRevision + 1,
          renderGeneration: allocatedRenderGeneration,
          sourceCustody: prepared.custody,
          sourceJournal: published.evidence.checkpoint,
        }),
      );
      await this.dependencies.seam?.afterSourceSelectionCommitDurable?.();
      this.#runtime = {
        epoch: prepared.epoch,
        sourceEpochNonce,
        sourceScope: published.scope,
        childJournal: published.journal,
        evidence: published.evidence,
      };
      runtimeTransferred = true;
      await this.#refreshStore();
      return this.#snapshotVerified();
      } catch (error) {
        if (!runtimeTransferred) {
          return await abandonEpochAfterOperationFailure(
            prepared.epoch,
            error,
            "source selection",
          );
        }
        throw error;
      }
    });
  }

  prepareSourceTile(input: {
    readonly sourceEpochNonce: string;
    readonly renderGeneration: number;
    readonly column: number;
    readonly row: number;
  }): Promise<GrandHallT554NativeReviewSourceTileV2> {
    return this.#lane.run(async () => {
      const request = parseInput(SourceTileInputSchema, input);
      await this.#assertOwner();
      this.#assertMutableLifecycle();
      const { active, runtime } = this.#assertRuntimeBinding(request);
      if (active.phase !== "source_review") {
        throw fail("PHASE_INVALID", "Tiles are available only during source review.");
      }
      const epochSnapshot = runtime.epoch.snapshot();
      if (
        epochSnapshot.lifecycle !== "active" ||
        epochSnapshot.renderGeneration !== request.renderGeneration
      ) {
        throw fail("SOURCE_STALE", "Native source epoch is no longer active.");
      }
      const sourceRgb8 = runtime.epoch.copyTile(request);
      if (sourceRgb8.length !== GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH) {
        sourceRgb8.fill(0);
        throw fail("RESOURCE_FAILURE", "Native source tile has an unexpected byte length.");
      }
      const pending: PendingTile = {
        resolved: false,
        bytes: sourceRgb8,
        preparedBytesSha256: sha256(sourceRgb8),
      };
      this.#pendingTiles.add(pending);
      return {
        schemaVersion: SOURCE_TILE_SCHEMA,
        renderMode: "source_rgb8",
        widthPx: TILE_WIDTH_PX,
        heightPx: TILE_HEIGHT_PX,
        sourceRgb8,
        commitDeliveryAfterSuccessfulSend: async () => {
          await this.#lane.run(async () => {
            if (pending.resolved) {
              throw fail(
                "DELIVERY_ALREADY_RESOLVED",
                "Prepared tile delivery was already committed or discarded.",
              );
            }
            try {
              await this.#assertOwner();
              const binding = this.#assertRuntimeBinding(request);
              if (
                binding.active.phase !== "source_review" ||
                binding.runtime !== runtime
              ) {
                throw fail("SOURCE_STALE", "Prepared tile belongs to a stale source epoch.");
              }
              if (sha256(pending.bytes) !== pending.preparedBytesSha256) {
                throw fail(
                  "SOURCE_TILE_MUTATED",
                  "Prepared native source bytes changed before delivery acknowledgement.",
                );
              }
              const tileIndex = request.row * TILE_COLUMN_COUNT + request.column;
              const evidence = await runtime.childJournal.appendChildWithEvidence({
                expectedRevision: runtime.evidence.checkpoint.revision,
                event: {
                  schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
                  eventType: "source.tile-delivered.v2",
                  payload: {
                    schemaVersion:
                      "venviewer.grand-hall-t554-native-review-tile-delivered.v2",
                    browserEpochNonceSha256:
                      runtime.sourceScope.browserEpochNonceSha256,
                    sourceEpochNonceSha256:
                      runtime.sourceScope.sourceCustody.sourceEpochNonceSha256,
                    coverageSegmentIdSha256:
                      runtime.sourceScope.coverageSegmentIdSha256,
                    subjectSha256:
                      runtime.sourceScope.sourceCustody.sourceReviewSubjectSha256,
                    renderGeneration: runtime.sourceScope.renderGeneration,
                    column: request.column,
                    row: request.row,
                    tileIndex,
                    responseFinishedAtUtc: this.dependencies.nowUtc(),
                  },
                },
              });
              if (evidence.kind !== "source") {
                throw fail("INTERNAL_INVARIANT_FAILED", "Tile append changed child kind.");
              }
              runtime.evidence = evidence;
              await this.#assertOwner();
            } finally {
              pending.resolved = true;
              pending.bytes.fill(0);
              this.#pendingTiles.delete(pending);
            }
          });
        },
        discardAfterFailedSend: async () => {
          await this.#lane.run(() => {
            if (pending.resolved) {
              throw fail(
                "DELIVERY_ALREADY_RESOLVED",
                "Prepared tile delivery was already committed or discarded.",
              );
            }
            pending.resolved = true;
            pending.bytes.fill(0);
            this.#pendingTiles.delete(pending);
          });
        },
      };
    });
  }

  recordSourceCoverage(input: {
    readonly sourceEpochNonce: string;
    readonly renderGeneration: number;
    readonly documentVisibilityState: "visible" | "hidden" | "prerender";
    readonly documentFocusState: "focused" | "blurred";
    readonly viewportCssWidth: number;
    readonly viewportCssHeight: number;
    readonly devicePixelRatio: number;
    readonly sourceToCssTransform: {
      readonly a: number;
      readonly b: number;
      readonly c: number;
      readonly d: number;
      readonly e: number;
      readonly f: number;
    };
    readonly paintedTileBitsetHex: string;
  }): Promise<GrandHallT554NativeReviewSourceCoverageAcknowledgementV2> {
    return this.#lane.run(async () => {
      const request = parseInput(SourceCoverageInputSchema, input);
      await this.#assertOwner();
      this.#assertMutableLifecycle();
      const { active, runtime } = this.#assertRuntimeBinding(request);
      if (active.phase !== "source_review") {
        throw fail("PHASE_INVALID", "Coverage applies only to source review.");
      }
      const planned = planGrandHallT554NativeReviewNextSourceCoverageEventV2({
        scope: runtime.sourceScope,
        events: runtime.evidence.events,
        observation: {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-source-coverage-observation-input.v2",
          serverObservation: {
            receivedAtUtc: this.dependencies.nowUtc(),
            monotonicElapsedMs: this.dependencies.monotonicNowMs(),
          },
          telemetry: {
            documentVisibilityState: request.documentVisibilityState,
            documentFocusState: request.documentFocusState,
            viewportCssWidth: request.viewportCssWidth,
            viewportCssHeight: request.viewportCssHeight,
            devicePixelRatio: request.devicePixelRatio,
            sourceToCssTransform: request.sourceToCssTransform,
            paintedTileBitsetHex: request.paintedTileBitsetHex,
          },
        },
      });
      const evidence = await runtime.childJournal.appendChildWithEvidence({
        expectedRevision: runtime.evidence.checkpoint.revision,
        event: planned,
      });
      if (evidence.kind !== "source") {
        throw fail("INTERNAL_INVARIANT_FAILED", "Coverage append changed child kind.");
      }
      runtime.evidence = evidence;
      await this.#assertOwner();
      const coverage = replayGrandHallT554NativeReviewSourceChildV2(evidence).coverage;
      return Object.freeze({
        schemaVersion: SOURCE_COVERAGE_ACK_SCHEMA,
        sequence: planned.payload.sequence,
        journalRevision: evidence.checkpoint.revision,
        completedTileCount: coverage.completedTileCount,
        complete: coverage.complete,
      });
    });
  }

  recordExcludeDecision(input: {
    readonly sourceEpochNonce: string;
    readonly renderGeneration: number;
    readonly expectedWorkspaceRevision: number;
    readonly note: string;
  }): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(ExcludeDecisionInputSchema, input);
      await this.#refreshStore();
      this.#assertMutableLifecycle();
      this.#assertWorkspaceRevision(request.expectedWorkspaceRevision);
      const { active } = this.#assertRuntimeBinding(request);
      if (active.phase !== "source_review") {
        throw fail("PHASE_INVALID", "EXCLUDE can be recorded only from source review.");
      }
      const evidence = this.#currentEvidence();
      const coverage = replayGrandHallT554NativeReviewSourceChildV2(evidence).coverage;
      if (!coverage.complete) {
        throw fail(
          "SOURCE_COVERAGE_INCOMPLETE",
          "EXCLUDE requires complete native-grid source coverage.",
        );
      }
      const resultingRenderGeneration =
        this.#coordinator().maximumAllocatedRenderGeneration + 1;
      const material = {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-source-decision-recorded.v2" as const,
        operationIdSha256: nonceSha256(
          parseInput(NonceSchema, this.dependencies.newNonce()),
        ),
        browserEpochNonceSha256:
          this.#coordinator().browserEpoch?.nonceSha256 ?? (() => {
            throw fail("INTERNAL_INVARIANT_FAILED", "Decision has no browser epoch.");
          })(),
        previousWorkspaceRevision: request.expectedWorkspaceRevision,
        resultingWorkspaceRevision: request.expectedWorkspaceRevision + 1,
        sessionIdSha256: this.sessionScope.sessionIdSha256,
        registry: this.sessionScope.registry,
        implementationManifest: this.sessionScope.implementationManifest,
        authorityBoundary: this.sessionScope.authorityBoundary,
        sourceCustody: active.sourceCustody,
        previousRenderGeneration: active.renderGeneration,
        resultingRenderGeneration,
        completedSourceCoverage: {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2" as const,
          sourceReviewSubjectSha256:
            active.sourceCustody.sourceReviewSubjectSha256,
          sourceJournal: evidence.checkpoint,
          completedTileBitsetHex: coverage.completedTileBitsetHex,
          completedTileCount: 512 as const,
          cumulativeDwellStateSha256: coverage.cumulativeDwellStateSha256,
        },
        note: request.note,
        decidedAtUtc: laterUtc(
          this.dependencies.nowUtc(),
          evidence.finalDurableRecordedAtUtc,
        ),
        result: "EXCLUDE" as const,
        classification: "no_observed_grand_hall_pixels" as const,
        maskState: null,
        maskReviewSubjectSha256: null,
        frozenBindingSha256: null,
        frozenBinding: null,
        completedMaskCoverage: null,
      };
      const payload = {
        ...material,
        decisionSha256:
          computeGrandHallT554NativeReviewSourceDecisionV2Sha256(material),
      };
      await this.#appendCoordinator(
        event<Extract<
          GrandHallT554NativeReviewCoordinatorEventV2,
          { readonly eventType: "source.decision-recorded.v2" }
        >>("source.decision-recorded.v2", payload),
      );
      await this.#refreshStore();
      return this.#snapshotVerified();
    });
  }

  recordHumanAttestation(input: {
    readonly expectedBrowserEpochNonceSha256: Sha256;
    readonly renderGeneration: number;
    readonly expectedWorkspaceRevision: number;
    readonly reviewerId: string;
    readonly knowledgeBasis: readonly string[];
  }): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(HumanAttestationInputSchema, input);
      await this.#refreshStore();
      this.#assertMutableLifecycle();
      this.#assertWorkspaceRevision(request.expectedWorkspaceRevision);
      const { active } = this.#assertCoordinatorSourceBinding(request);
      if (active.phase !== "decision_recorded" || active.decision === null) {
        throw fail("PHASE_INVALID", "Human attestation requires a recorded source decision.");
      }
      const material = {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-source-human-attestation-recorded.v2" as const,
        operationIdSha256: nonceSha256(
          parseInput(NonceSchema, this.dependencies.newNonce()),
        ),
        browserEpochNonceSha256:
          this.#coordinator().browserEpoch?.nonceSha256 ?? (() => {
            throw fail("INTERNAL_INVARIANT_FAILED", "Attestation has no browser epoch.");
          })(),
        previousWorkspaceRevision: request.expectedWorkspaceRevision,
        resultingWorkspaceRevision: request.expectedWorkspaceRevision + 1,
        sessionIdSha256: this.sessionScope.sessionIdSha256,
        sourceReviewSubjectSha256:
          active.sourceCustody.sourceReviewSubjectSha256,
        decisionSha256: active.decision.decisionSha256,
        reviewerId: request.reviewerId,
        reviewerRole: "venue_owner_or_authorized_domain_reviewer" as const,
        knowledgeBasis: request.knowledgeBasis,
        attestedAtUtc: laterUtc(
          this.dependencies.nowUtc(),
          active.decision.decidedAtUtc,
        ),
        statement:
          "I reviewed the exact bound source at native scale and recorded only what I could support from supplied evidence." as const,
        humanPresenceProof: "not_cryptographic" as const,
        agentDecisionAuthority: "none" as const,
        authority: "none" as const,
      };
      const payload = {
        ...material,
        attestationSha256:
          computeGrandHallT554NativeReviewHumanAttestationV2Sha256(material),
      };
      await this.#appendCoordinator(
        event<Extract<
          GrandHallT554NativeReviewCoordinatorEventV2,
          { readonly eventType: "source.human-attestation-recorded.v2" }
        >>("source.human-attestation-recorded.v2", payload),
      );
      await this.#refreshStore();
      return this.#snapshotVerified();
    });
  }

  abandonActiveSource(input: {
    readonly expectedBrowserEpochNonceSha256: Sha256;
    readonly renderGeneration: number;
    readonly expectedWorkspaceRevision: number;
    readonly reason: "operator_abandon" | "source_switch" | "session_stop";
  }): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(AbandonInputSchema, input);
      await this.#refreshStore();
      this.#assertMutableLifecycle();
      this.#assertWorkspaceRevision(request.expectedWorkspaceRevision);
      const { active, runtime } = this.#assertCoordinatorSourceBinding(request);
      const evidence = this.#currentEvidence();
      for (const pending of this.#pendingTiles) {
        pending.resolved = true;
        pending.bytes.fill(0);
      }
      this.#pendingTiles.clear();
      await this.#appendCoordinator(
        event<Extract<
          GrandHallT554NativeReviewCoordinatorEventV2,
          { readonly eventType: "source.abandoned.v2" }
        >>("source.abandoned.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-source-abandoned.v2",
          browserEpochNonceSha256:
            this.#coordinator().browserEpoch?.nonceSha256 ?? (() => {
              throw fail("INTERNAL_INVARIANT_FAILED", "Abandon has no browser epoch.");
            })(),
          previousWorkspaceRevision: request.expectedWorkspaceRevision,
          resultingWorkspaceRevision: request.expectedWorkspaceRevision + 1,
          sourceCustody: active.sourceCustody,
          finalRenderGeneration: active.renderGeneration,
          sourceJournal: evidence.checkpoint,
          maskJournal: null,
          reason: request.reason,
        }),
      );
      await this.#refreshStore();
      if (runtime !== null) {
        try {
          await runtime.epoch.abandon();
        } catch (error) {
          throw fail(
            "RESOURCE_CLEANUP_FAILED",
            "Source journal was abandoned but native epoch cleanup failed.",
            error,
          );
        }
      }
      this.#runtime = null;
      return this.#snapshotVerified();
    });
  }

  stop(input: {
    readonly expectedWorkspaceRevision: number;
  }): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(StopInputSchema, input);
      await this.#refreshStore();
      this.#assertMutableLifecycle();
      this.#assertWorkspaceRevision(request.expectedWorkspaceRevision);
      if (this.#coordinator().activeSource !== null) {
        throw fail(
          "PHASE_INVALID",
          "Session stop requires an explicit active-source abandon first.",
        );
      }
      await this.#appendCoordinator(
        event<Extract<
          GrandHallT554NativeReviewCoordinatorEventV2,
          { readonly eventType: "session.stopped.v2" }
        >>("session.stopped.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-session-stopped.v2",
          browserEpochNonceSha256:
            this.#coordinator().browserEpoch?.nonceSha256 ?? (() => {
              throw fail("INTERNAL_INVARIANT_FAILED", "Stop has no browser epoch.");
            })(),
          previousWorkspaceRevision: request.expectedWorkspaceRevision,
          resultingWorkspaceRevision: request.expectedWorkspaceRevision + 1,
          stoppedAtUtc: this.dependencies.nowUtc(),
          activeSourceWasPresent: false,
          authorityBoundary: this.sessionScope.authorityBoundary,
        }),
      );
      await this.#refreshStore();
      return this.#snapshotVerified();
    });
  }

  close(): Promise<void> {
    return this.#lane.run(async () => {
      if (this.#closed) return;
      for (const pending of this.#pendingTiles) {
        pending.resolved = true;
        pending.bytes.fill(0);
      }
      this.#pendingTiles.clear();
      if (this.#runtime !== null) {
        try {
          await this.#runtime.epoch.abandon();
        } catch (error) {
          throw fail(
            "RESOURCE_CLEANUP_FAILED",
            "Native source epoch could not be abandoned before owner release.",
            error,
          );
        }
        this.#runtime = null;
      }
      await this.#assertOwner();
      await releaseGrandHallT554NativeReviewSessionOwnerV2({
        lease: this.lease,
        sessionRoot: this.sessionRoot,
        expectedSessionScope: this.sessionScope,
      });
      this.#closed = true;
    });
  }
}

async function createInjectedSourceSession(
  options: { readonly sessionRoot: string },
  dependencies: SourceSessionDependencies,
): Promise<GrandHallT554NativeReviewSourceSessionV2> {
  const sessionRoot = resolveSessionRoot(options.sessionRoot);
  if ((await directKind(sessionRoot)) !== "absent") {
    throw fail("ROOT_ALREADY_EXISTS", "Source-review session root already exists.");
  }
  const registry = GrandHallT554NativeReviewRegistryBindingV2Schema.parse(
    dependencies.registry.binding,
  );
  const implementation =
    GrandHallT554NativeReviewImplementationManifestBindingV2Schema.parse(
      dependencies.implementationManifestBinding,
    );
  const manifestBytes = dependencies.copyExactManifestBytes();
  assertExactManifestBytes(implementation, manifestBytes);
  const sessionNonce = parseInput(NonceSchema, dependencies.newNonce());
  const browserNonce = parseInput(NonceSchema, dependencies.newNonce());
  const sessionIdSha256 = nonceSha256(sessionNonce);
  const sessionScope = GrandHallT554NativeReviewSessionScopeV2Schema.parse({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "session",
    sessionIdSha256,
    subjectSha256: canonicalDigest(SESSION_SUBJECT_DOMAIN, {
      schemaVersion: "venviewer.grand-hall-t554-native-review-session-subject.v2",
      sessionIdSha256,
      registry,
      implementationManifest: implementation,
      authorityBoundary: AuthorityBoundary,
    }),
    implementationManifest: implementation,
    registry,
    authorityBoundary: AuthorityBoundary,
  });
  const parent = dirname(sessionRoot);
  if ((await directKind(parent)) !== "directory") {
    throw fail("ARGUMENT_INVALID", "Session-root parent must already exist as a direct directory.");
  }
  const stageRoot = join(
    parent,
    `.venviewer-t554-session-create-${nonceSha256(
      parseInput(NonceSchema, dependencies.newNonce()),
    ).slice(-24)}.stage`,
  );
  let published = false;
  try {
    await mkdir(stageRoot);
    await Promise.all([
      mkdir(join(stageRoot, "coordinator")),
      mkdir(join(stageRoot, "child-scopes")),
      mkdir(join(stageRoot, "children")),
      mkdir(join(stageRoot, "mask-evidence")),
    ]);
    await writeSyncedFile(
      join(
        stageRoot,
        GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
      ),
      manifestBytes,
    );
    await writeSyncedFile(
      join(stageRoot, "session-root.json"),
      canonicalBytes({
        schemaVersion:
          GRAND_HALL_T554_NATIVE_REVIEW_SESSION_ROOT_DESCRIPTOR_V2,
        sessionScope,
        implementationManifestFileName:
          GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
        coordinatorDirectoryName: "coordinator",
        childScopesDirectoryName: "child-scopes",
        childrenDirectoryName: "children",
        maskEvidenceDirectoryName: "mask-evidence",
      }),
    );
    const coordinator =
      await createGrandHallT554NativeReviewDurableJournalV2({
        workspaceRoot: join(stageRoot, "coordinator"),
        scope: sessionScope,
      });
    const created = await coordinator.append({
      expectedRevision: 0,
      event: event<Extract<
        GrandHallT554NativeReviewCoordinatorEventV2,
        { readonly eventType: "session.created.v2" }
      >>("session.created.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-session-created.v2",
        sessionIdSha256,
        workspaceRevision: 0,
        maximumAllocatedRenderGeneration: 0,
        registry,
        implementationManifest: implementation,
        authorityBoundary: AuthorityBoundary,
      }),
    });
    await coordinator.append({
      expectedRevision: created.revision,
      event: event<Extract<
        GrandHallT554NativeReviewCoordinatorEventV2,
        { readonly eventType: "session.browser-epoch-started.v2" }
      >>("session.browser-epoch-started.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2",
        browserEpochNumber: 1,
        browserEpochNonceSha256: nonceSha256(browserNonce),
        previousBrowserEpochNonceSha256: null,
        reason: "session_created",
        priorActiveSourceJournal: null,
        priorActiveMaskJournal: null,
        workspaceRevision: 0,
        maximumAllocatedRenderGeneration: 0,
        startedAtUtc: dependencies.nowUtc(),
      }),
    });
    await syncDirectory(stageRoot);
    await rename(stageRoot, sessionRoot);
    published = true;
    await syncDirectory(parent);
  } catch (error) {
    if (!published) await rm(stageRoot, { force: true, recursive: true });
    throw error;
  }

  const lease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
    sessionRoot,
    expectedSessionScope: sessionScope,
  });
  const coordinatorJournal =
    await openGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: join(sessionRoot, "coordinator"),
      expectedScope: sessionScope,
    });
  const store = await openGrandHallT554NativeReviewSessionStoreV2({
    sessionRoot,
    expectedSessionScope: sessionScope,
    lease,
  });
  return new GrandHallT554NativeReviewSourceSessionControllerV2(
    sessionRoot,
    sessionScope,
    dependencies,
    lease,
    coordinatorJournal,
    store,
    null,
  );
}

async function recoverPendingSourceMutation(input: {
  readonly sessionRoot: string;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly coordinatorJournal: GrandHallT554NativeReviewDurableJournalV2;
  readonly dependencies: SourceSessionDependencies;
}): Promise<void> {
  await assertGrandHallT554NativeReviewSessionOwnerV2({
    lease: input.lease,
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
  });
  const replay = await input.coordinatorJournal.replay();
  const coordinator = replayGrandHallT554NativeReviewCoordinatorV2({
    scope: input.sessionScope,
    events: replay.events,
  });
  if (coordinator.pendingIntent === null) return;
  const intent = findExactPendingCoordinatorIntentEventV2(
    replay,
    coordinator.pendingIntent,
  );
  if (intent === null) {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Pending coordinator intent cannot be resolved from its durable event.",
    );
  }
  if (intent.eventType === "mask.freeze-intended.v2") {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Source-only kernel cannot recover a pending mask freeze.",
    );
  }
  if (
    intent.eventType === "coverage.segment-resume-intended.v2" &&
    intent.payload.kind !== "source"
  ) {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Source-only kernel cannot recover a mask coverage intent.",
    );
  }
  const payload = intent.payload;
  const coverageSegmentIdSha256 =
    intent.eventType === "source.selection-intended.v2"
      ? intent.payload.coverageSegmentIdSha256
      : intent.payload.newCoverageSegmentIdSha256;
  const scope = sourceScope({
    sessionScope: input.sessionScope,
    browserEpochNonceSha256: payload.browserEpochNonceSha256,
    coverageSegmentIdSha256,
    renderGeneration: payload.allocatedRenderGeneration,
    sourceCustody: payload.preparedSourceCustody,
  });
  const leafName = payload.childJournalLeafName;
  const childPath = join(input.sessionRoot, "children", leafName);
  const descriptorPath = join(
    input.sessionRoot,
    "child-scopes",
    `${leafName}.json`,
  );
  let childKind = await directKind(childPath);
  let descriptorKind = await directKind(descriptorPath);
  if (descriptorKind !== "absent" && descriptorKind !== "file") {
    throw fail("CRASH_RECOVERY_REQUIRED", "Pending child descriptor is not a direct file.");
  }
  if (childKind !== "absent" && childKind !== "directory") {
    throw fail("CRASH_RECOVERY_REQUIRED", "Pending child journal is not a direct directory.");
  }
  if (childKind === "absent" && descriptorKind === "file") {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Descriptor exists without its atomically prior child journal.",
    );
  }
  if (childKind === "directory" && descriptorKind === "absent") {
    await publishDescriptorFromBytes({
      sessionRoot: input.sessionRoot,
      leafName,
      bytes: childDescriptorBytes(leafName, scope),
      nonce: parseInput(NonceSchema, input.dependencies.newNonce()),
    });
    descriptorKind = "file";
    childKind = "directory";
  }
  let evidence:
    | GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2
    | null = null;
  if (childKind === "directory" && descriptorKind === "file") {
    const opened =
      await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
        workspaceRoot: childPath,
        expectedScope: scope,
      });
    if (opened.kind !== "source") {
      throw fail("CRASH_RECOVERY_REQUIRED", "Pending source child reopened as a mask child.");
    }
    evidence = opened;
  }
  const browser = coordinator.browserEpoch;
  if (browser === null) {
    throw fail("CRASH_RECOVERY_REQUIRED", "Pending source intent has no browser epoch.");
  }
  if (intent.eventType === "source.selection-intended.v2") {
    await input.coordinatorJournal.append({
      expectedRevision: replay.revision,
      event: event<Extract<
        GrandHallT554NativeReviewCoordinatorEventV2,
        { readonly eventType: "source.selection-recovery-aborted.v2" }
      >>("source.selection-recovery-aborted.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-source-selection-recovery-aborted.v2",
        operationIdSha256: intent.payload.operationIdSha256,
        browserEpochNonceSha256: browser.nonceSha256,
        workspaceRevision: coordinator.workspaceRevision,
        consumedRenderGeneration: intent.payload.allocatedRenderGeneration,
        recovery:
          evidence === null
            ? { childDisposition: "absent", abandonedChildJournal: null }
            : {
                childDisposition: "exact_abandoned",
                abandonedChildJournal: evidence.checkpoint,
              },
      }),
    });
  } else {
    await input.coordinatorJournal.append({
      expectedRevision: replay.revision,
      event: event<Extract<
        GrandHallT554NativeReviewCoordinatorEventV2,
        { readonly eventType: "coverage.segment-resume-recovery-aborted.v2" }
      >>("coverage.segment-resume-recovery-aborted.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-coverage-segment-resume-recovery-aborted.v2",
        kind: "source",
        operationIdSha256: intent.payload.operationIdSha256,
        browserEpochNonceSha256: browser.nonceSha256,
        workspaceRevision: coordinator.workspaceRevision,
        consumedRenderGeneration: intent.payload.allocatedRenderGeneration,
        recovery:
          evidence === null
            ? { childDisposition: "absent", abandonedChildJournal: null }
            : {
                childDisposition: "exact_abandoned",
                abandonedChildJournal: evidence.checkpoint,
              },
      }),
    });
  }
  await assertGrandHallT554NativeReviewSessionOwnerV2({
    lease: input.lease,
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
  });
}

function latestActiveSourceEvidence(
  store: GrandHallT554NativeReviewSessionStoreReplayV2,
): GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2 | null {
  try {
    return latestVerifiedActiveSourceEvidenceV2(store);
  } catch (error) {
    throw fail(
      "INTERNAL_INVARIANT_FAILED",
      "Active source does not have exact durable child evidence.",
      error,
    );
  }
}

async function resumeActiveSource(input: {
  readonly sessionRoot: string;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly coordinatorJournal: GrandHallT554NativeReviewDurableJournalV2;
  readonly dependencies: SourceSessionDependencies;
  readonly store: GrandHallT554NativeReviewSessionStoreReplayV2;
}): Promise<{
  readonly store: GrandHallT554NativeReviewSessionStoreReplayV2;
  readonly runtime: ActiveRuntime;
}> {
  const active = input.store.coordinator.activeSource;
  if (active === null || active.phase !== "source_review") {
    throw fail(
      "PHASE_INVALID",
      "Only an active source-review phase can be reopened by this source-only kernel.",
    );
  }
  const predecessorEvidence = latestActiveSourceEvidence(input.store);
  if (predecessorEvidence === null) {
    throw fail("INTERNAL_INVARIANT_FAILED", "Source resume lost predecessor evidence.");
  }
  const predecessorCoverage =
    createGrandHallT554NativeReviewCoverageCarryStateV2(predecessorEvidence);
  if (predecessorCoverage.kind !== "source") {
    throw fail("INTERNAL_INVARIANT_FAILED", "Source predecessor emitted mask carry.");
  }
  const browser = input.store.coordinator.browserEpoch;
  if (browser === null) {
    throw fail("INTERNAL_INVARIANT_FAILED", "Source resume has no rotated browser epoch.");
  }
  const sourceEpochNonce = parseInput(
    NonceSchema,
    input.dependencies.newNonce(),
  );
  const allocatedRenderGeneration =
    input.store.coordinator.maximumAllocatedRenderGeneration + 1;
  const prepared = await prepareEpoch({
    dependencies: input.dependencies,
    inventoryIndex: active.sourceCustody.source.inventoryIndex,
    sourceEpochNonce,
    renderGeneration: allocatedRenderGeneration,
  });
  let runtimeTransferred = false;
  try {
  if (
    !canonicalEqual(prepared.custody.source, active.sourceCustody.source) ||
    !canonicalEqual(
      prepared.custody.sourceVerification,
      active.sourceCustody.sourceVerification,
    ) ||
    prepared.custody.sourceReviewSubjectSha256 !==
      active.sourceCustody.sourceReviewSubjectSha256
  ) {
    throw fail(
      "RESOURCE_FAILURE",
      "Reopened source differs from the exact stable predecessor custody.",
    );
  }
  const operationIdSha256 = nonceSha256(
    parseInput(NonceSchema, input.dependencies.newNonce()),
  );
  const coverageSegmentIdSha256 = nonceSha256(
    parseInput(NonceSchema, input.dependencies.newNonce()),
  );
  const leafName = sourceChildLeaf(
    "resume",
    allocatedRenderGeneration,
    coverageSegmentIdSha256,
  );
  const scope = sourceScope({
    sessionScope: input.sessionScope,
    browserEpochNonceSha256: browser.nonceSha256,
    coverageSegmentIdSha256,
    renderGeneration: allocatedRenderGeneration,
    sourceCustody: prepared.custody,
  });
  const replay = await input.coordinatorJournal.replay();
  await input.coordinatorJournal.append({
    expectedRevision: replay.revision,
    event: event<Extract<
      GrandHallT554NativeReviewCoordinatorEventV2,
      { readonly eventType: "coverage.segment-resume-intended.v2" }
    >>("coverage.segment-resume-intended.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-segment-resume-intended.v2",
      kind: "source",
      operationIdSha256,
      browserEpochNonceSha256: browser.nonceSha256,
      expectedWorkspaceRevision: input.store.coordinator.workspaceRevision,
      sourceCustodyBefore: active.sourceCustody,
      preparedSourceCustody: prepared.custody,
      previousVisibleRenderGeneration: active.renderGeneration,
      previousMaximumAllocatedRenderGeneration:
        input.store.coordinator.maximumAllocatedRenderGeneration,
      allocatedRenderGeneration,
      newSourceEpochNonceSha256: prepared.custody.sourceEpochNonceSha256,
      newCoverageSegmentIdSha256: coverageSegmentIdSha256,
      childJournalLeafName: leafName,
      priorChildJournal: predecessorEvidence.checkpoint,
      predecessorCoverage,
    }),
  });
  await input.dependencies.seam?.afterCoverageResumeIntentDurable?.();
  const published = await publishSourceChild({
    sessionRoot: input.sessionRoot,
    scope,
    leafName,
    startedAtUtc: laterUtc(
      input.dependencies.nowUtc(),
      predecessorEvidence.finalDurableRecordedAtUtc,
    ),
    predecessorCoverage,
    predecessorEvidence,
    stageNonce: parseInput(NonceSchema, input.dependencies.newNonce()),
    afterChildPublished:
      input.dependencies.seam?.afterCoverageResumeChildPublished,
    afterDescriptorPublished:
      input.dependencies.seam?.afterCoverageResumeDescriptorPublished,
  });
  const beforeCommit = await input.coordinatorJournal.replay();
  await input.coordinatorJournal.append({
    expectedRevision: beforeCommit.revision,
    event: event<Extract<
      GrandHallT554NativeReviewCoordinatorEventV2,
      { readonly eventType: "coverage.segment-resume-committed.v2" }
    >>("coverage.segment-resume-committed.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-segment-resume-committed.v2",
      kind: "source",
      operationIdSha256,
      browserEpochNonceSha256: browser.nonceSha256,
      previousWorkspaceRevision: input.store.coordinator.workspaceRevision,
      resultingWorkspaceRevision:
        input.store.coordinator.workspaceRevision + 1,
      renderGeneration: allocatedRenderGeneration,
      coverageSegmentIdSha256,
      sourceCustody: prepared.custody,
      sourceJournal: published.evidence.checkpoint,
    }),
  });
  await input.dependencies.seam?.afterCoverageResumeCommitDurable?.();
  const store = await openGrandHallT554NativeReviewSessionStoreV2({
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
    lease: input.lease,
  });
  const resumed = {
    store,
    runtime: {
      epoch: prepared.epoch,
      sourceEpochNonce,
      sourceScope: published.scope,
      childJournal: published.journal,
      evidence: published.evidence,
    },
  };
  runtimeTransferred = true;
  return resumed;
  } catch (error) {
    if (!runtimeTransferred) {
      return await abandonEpochAfterOperationFailure(
        prepared.epoch,
        error,
        "source coverage resume",
      );
    }
    throw error;
  }
}

async function openInjectedSourceSession(
  mode: "clean_resume" | "crash_resume",
  options: {
    readonly sessionRoot: string;
    readonly priorOwnerWitness?: GrandHallT554NativeReviewPriorOwnerWitnessV2;
  },
  dependencies: SourceSessionDependencies,
): Promise<GrandHallT554NativeReviewSourceSessionV2> {
  const sessionRoot = resolveSessionRoot(options.sessionRoot);
  const sessionScope = await readSessionScope(sessionRoot);
  assertDependencyBindings(sessionScope, dependencies);
  const manifestBytes = dependencies.copyExactManifestBytes();
  assertExactManifestBytes(
    dependencies.implementationManifestBinding,
    manifestBytes,
  );
  const persistedManifest = await readFile(
    join(
      sessionRoot,
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
    ),
  );
  if (!persistedManifest.equals(manifestBytes)) {
    throw fail(
      "ARGUMENT_INVALID",
      "Reopen implementation bytes differ from persisted session custody.",
    );
  }
  const lease =
    mode === "clean_resume"
      ? await acquireGrandHallT554NativeReviewSessionOwnerV2({
          sessionRoot,
          expectedSessionScope: sessionScope,
        })
      : await explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2({
          sessionRoot,
          expectedSessionScope: sessionScope,
          priorOwnerWitness:
            options.priorOwnerWitness ?? (() => {
              throw fail(
                "ARGUMENT_INVALID",
                "Explicit crash takeover requires a branded prior-owner witness.",
              );
            })(),
        });
  const coordinatorJournal =
    await openGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: join(sessionRoot, "coordinator"),
      expectedScope: sessionScope,
    });
  await recoverPendingSourceMutation({
    sessionRoot,
    sessionScope,
    lease,
    coordinatorJournal,
    dependencies,
  });
  let store = await openGrandHallT554NativeReviewSessionStoreV2({
    sessionRoot,
    expectedSessionScope: sessionScope,
    lease,
  });
  if (store.coordinator.lifecycle === "stopped") {
    return new GrandHallT554NativeReviewSourceSessionControllerV2(
      sessionRoot,
      sessionScope,
      dependencies,
      lease,
      coordinatorJournal,
      store,
      null,
    );
  }
  if (store.coordinator.lifecycle !== "active") {
    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease,
      sessionRoot,
      expectedSessionScope: sessionScope,
    });
    throw fail("SESSION_POISONED", "Poisoned source-review session cannot reopen.");
  }
  const activeBeforeRotation = store.coordinator.activeSource;
  if (
    activeBeforeRotation !== null &&
    activeBeforeRotation.phase !== "source_review" &&
    !(
      (activeBeforeRotation.phase === "decision_recorded" ||
        activeBeforeRotation.phase === "human_attested") &&
      activeBeforeRotation.decision?.result === "EXCLUDE"
    )
  ) {
    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease,
      sessionRoot,
      expectedSessionScope: sessionScope,
    });
    throw fail(
      "PHASE_INVALID",
      "Source-only kernel cannot reopen an INCLUDE or mask-workflow phase.",
    );
  }
  store = await rotateGrandHallT554NativeReviewBrowserEpochV2({
    reason: mode,
    sessionRoot,
    sessionScope,
    lease,
    coordinatorJournal,
    store,
    newBrowserEpochNonceSha256: nonceSha256(
      parseInput(NonceSchema, dependencies.newNonce()),
    ),
    startedAtUtc: dependencies.nowUtc(),
    afterDurable: dependencies.seam?.afterBrowserEpochStartedDurable,
  });
  let runtime: ActiveRuntime | null = null;
  if (store.coordinator.activeSource?.phase === "source_review") {
    const resumed = await resumeActiveSource({
      sessionRoot,
      sessionScope,
      lease,
      coordinatorJournal,
      dependencies,
      store,
    });
    store = resumed.store;
    runtime = resumed.runtime;
  } else if (
    store.coordinator.activeSource !== null &&
    store.coordinator.activeSource.phase !== "decision_recorded" &&
    store.coordinator.activeSource.phase !== "human_attested"
  ) {
    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease,
      sessionRoot,
      expectedSessionScope: sessionScope,
    });
    throw fail(
      "PHASE_INVALID",
      "Source-only kernel cannot reopen a mask-workflow phase.",
    );
  }
  return new GrandHallT554NativeReviewSourceSessionControllerV2(
    sessionRoot,
    sessionScope,
    dependencies,
    lease,
    coordinatorJournal,
    store,
    runtime,
  );
}

export interface GrandHallT554NativeReviewSourceSessionProductionOptionsV2 {
  readonly sessionRoot: string;
  readonly registry: GrandHallT554NativeReviewRegistry;
  readonly implementationPack: GrandHallT554VerifiedNativeReviewImplementationPackV1;
  readonly runtimeAuthority: GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1;
}

export interface GrandHallT554NativeReviewSourceSessionTakeoverOptionsV2
  extends GrandHallT554NativeReviewSourceSessionProductionOptionsV2 {
  readonly priorOwnerWitness: GrandHallT554NativeReviewPriorOwnerWitnessV2;
}

export async function createGrandHallT554NativeReviewSourceSessionV2(
  options: GrandHallT554NativeReviewSourceSessionProductionOptionsV2,
): Promise<GrandHallT554NativeReviewSourceSessionV2> {
  return await createInjectedSourceSession(
    { sessionRoot: options.sessionRoot },
    productionDependencies(options),
  );
}

export async function openGrandHallT554NativeReviewSourceSessionV2(
  options: GrandHallT554NativeReviewSourceSessionProductionOptionsV2,
): Promise<GrandHallT554NativeReviewSourceSessionV2> {
  return await openInjectedSourceSession(
    "clean_resume",
    { sessionRoot: options.sessionRoot },
    productionDependencies(options),
  );
}

export async function takeOverGrandHallT554NativeReviewSourceSessionAfterCrashV2(
  options: GrandHallT554NativeReviewSourceSessionTakeoverOptionsV2,
): Promise<GrandHallT554NativeReviewSourceSessionV2> {
  return await openInjectedSourceSession(
    "crash_resume",
    {
      sessionRoot: options.sessionRoot,
      priorOwnerWitness: options.priorOwnerWitness,
    },
    productionDependencies(options),
  );
}

export const __testOnlyGrandHallT554NativeReviewSourceSessionV2 =
  /* @__PURE__ */ Object.freeze({
    create: createInjectedSourceSession,
    open: (
      options: { readonly sessionRoot: string },
      dependencies: SourceSessionDependencies,
    ) => openInjectedSourceSession("clean_resume", options, dependencies),
    takeOver: (
      options: {
        readonly sessionRoot: string;
        readonly priorOwnerWitness: GrandHallT554NativeReviewPriorOwnerWitnessV2;
      },
      dependencies: SourceSessionDependencies,
    ) => openInjectedSourceSession("crash_resume", options, dependencies),
  });

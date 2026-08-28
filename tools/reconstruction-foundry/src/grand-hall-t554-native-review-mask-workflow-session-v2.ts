import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import {
  computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256,
  computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256,
  computeGrandHallT554NativeReviewMaskSubjectV2Sha256,
  computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256,
  computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256,
  replayGrandHallT554NativeReviewCoordinatorV2,
} from "./grand-hall-t554-native-review-coordinator-replay-v2.js";
import {
  openGrandHallT554NativeReviewDurableJournalV2,
  type GrandHallT554NativeReviewDurableJournalReplayV2,
  type GrandHallT554NativeReviewDurableJournalV2,
} from "./grand-hall-t554-native-review-durable-journal-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
  GrandHallT554NativeReviewAuthorityBoundaryV2Schema,
  GrandHallT554NativeReviewCompletedSourceCoverageV2Schema,
  GrandHallT554NativeReviewCoordinatorEventV2Schema,
  GrandHallT554NativeReviewFrozenMaskBindingV2Schema,
  GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
  GrandHallT554NativeReviewMaskEditV2Schema,
  GrandHallT554NativeReviewMaskScopeV2Schema,
  GrandHallT554NativeReviewPreparedMaskBindingV2Schema,
  GrandHallT554NativeReviewRegistryBindingV2Schema,
  GrandHallT554NativeReviewSessionScopeV2Schema,
  GrandHallT554NativeReviewSha256V2Schema,
  type GrandHallT554NativeReviewCompletedSourceCoverageV2,
  type GrandHallT554NativeReviewCoordinatorEventV2,
  type GrandHallT554NativeReviewFrozenMaskBindingV2,
  type GrandHallT554NativeReviewImplementationManifestBindingV2,
  type GrandHallT554NativeReviewMaskEditV2,
  type GrandHallT554NativeReviewMaskChildCheckpointV2,
  type GrandHallT554NativeReviewMaskScopeV2,
  type GrandHallT554NativeReviewMaskStateEvidenceV2,
  type GrandHallT554NativeReviewRegistryBindingV2,
  type GrandHallT554NativeReviewSessionScopeV2,
  type GrandHallT554NativeReviewSourceCustodyBindingV2,
} from "./grand-hall-t554-native-review-events-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  assertGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1,
  assertGrandHallT554VerifiedNativeReviewImplementationPackV1,
} from "./grand-hall-t554-native-review-implementation-manifest.js";
import {
  GrandHallT554NativeMaskRevisionStore,
  GrandHallT554NativeMaskStoreError,
  GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX,
  GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX,
  type GrandHallT554NativeMaskExactStateV2,
  type GrandHallT554NativeMaskPreparedFreezeV2,
} from "./grand-hall-t554-native-review-mask-store.js";
import {
  buildGrandHallT554NativeMaskReplayContextV2,
  type GrandHallT554NativeMaskReplayContextV2,
} from "./grand-hall-t554-native-review-mask-replay-v2.js";
import {
  acquireGrandHallT554NativeReviewSessionOwnerV2,
  assertGrandHallT554NativeReviewSessionOwnerV2,
  explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2,
  releaseGrandHallT554NativeReviewSessionOwnerV2,
  type GrandHallT554NativeReviewPriorOwnerWitnessV2,
  type GrandHallT554NativeReviewSessionOwnerLeaseV2,
} from "./grand-hall-t554-native-review-session-owner-v2.js";
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
  planGrandHallT554NativeReviewNextMaskCoverageEventV2,
  replayGrandHallT554NativeReviewMaskChildV2,
  replayGrandHallT554NativeReviewSourceChildV2,
  type GrandHallT554NativeReviewPlannedMaskCoverageEventV2,
} from "./grand-hall-t554-native-review-replay-v2.js";
import {
  findExactPendingCoordinatorIntentEventV2,
  latestVerifiedActiveMaskEvidenceV2,
  latestVerifiedActiveSourceEvidenceV2,
  publishGrandHallT554NativeReviewMaskChildStartV2,
  reconcileGrandHallT554NativeReviewMaskChildStartV2,
  rotateGrandHallT554NativeReviewBrowserEpochV2,
  type GrandHallT554NativeReviewPublishedMaskChildStartV2,
} from "./grand-hall-t554-native-review-session-orchestration-v2.js";
import type {
  GrandHallT554NativeReviewSourceSessionProductionOptionsV2,
  GrandHallT554NativeReviewSourceSessionTakeoverOptionsV2,
} from "./grand-hall-t554-native-review-source-session-v2.js";
import { computeGrandHallT554NativeReviewSourceReviewSubjectV2Sha256 } from "./grand-hall-t554-native-review-source-kernel-v2.js";
import {
  GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH,
  computeGrandHallT554NativeSourceEpochBindingSha256V1,
  openGrandHallT554NativeSourceEpochV1,
  type GrandHallT554NativeSourceEpochBindingsV1,
  type GrandHallT554NativeSourceEpochSnapshotV1,
  type GrandHallT554NativeSourceTileRequestV1,
} from "./grand-hall-t554-native-source-epoch.js";
import {
  GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
  GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
} from "./grand-hall-t554-native-review-coverage.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

const MASK_WORKFLOW_SNAPSHOT_SCHEMA =
  "venviewer.grand-hall-t554-native-review-mask-workflow-session.v2";
const MASK_TILE_SCHEMA =
  "venviewer.grand-hall-t554-native-review-mask-workflow-tile.v2";
const MASK_COVERAGE_ACK_SCHEMA =
  "venviewer.grand-hall-t554-native-review-mask-coverage-acknowledgement.v2";
const MASK_PLANE_TILE_BYTE_LENGTH =
  GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX *
  GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX;
const SESSION_SUBJECT_AUTHORITY =
  GrandHallT554NativeReviewAuthorityBoundaryV2Schema.parse({
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
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

type Sha256 = `sha256:${string}`;
type MaskWorkflowPhase = "source_review" | "mask_edit" | "mask_review";
type ActiveCoordinatorSource = NonNullable<
  GrandHallT554NativeReviewSessionStoreReplayV2["coordinator"]["activeSource"]
>;
type MaskWorkflowStartedEvent = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "mask.workflow-started.v2" }
>;
type MaskEditedEvent = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "mask.edited.v2" }
>;
type MaskFreezeIntendedEvent = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "mask.freeze-intended.v2" }
>;

const NonceSchema = z
  .string()
  .regex(NONCE_PATTERN)
  .refine((value) => {
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

const MutationGuardShape = {
  expectedBrowserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
  expectedWorkspaceRevision: WorkspaceRevisionSchema,
  expectedRenderGeneration: RenderGenerationSchema,
  sourceReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
};

const BeginMaskWorkflowInputSchema = z.object(MutationGuardShape).strict();
const ApplyMaskEditInputSchema = z
  .object({
    ...MutationGuardShape,
    edit: GrandHallT554NativeReviewMaskEditV2Schema,
  })
  .strict();
const FreezeMaskInputSchema = z
  .object({
    ...MutationGuardShape,
    expectedMaskRevision: z.number().int().positive().max(4_095),
  })
  .strict();

const RenderBindingShape = {
  expectedBrowserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
  expectedRenderGeneration: RenderGenerationSchema,
  sourceReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
  maskStateSha256: GrandHallT554NativeReviewSha256V2Schema,
  maskReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema.nullable(),
};

const MaskTileInputSchema = z
  .object({
    ...RenderBindingShape,
    column: z
      .number()
      .int()
      .min(0)
      .max(GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT - 1),
    row: z
      .number()
      .int()
      .min(0)
      .max(GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT - 1),
  })
  .strict();

const MaskCoverageInputSchema = z
  .object({
    ...RenderBindingShape,
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
      .strict()
      .superRefine((matrix, refinement) => {
        if (Math.abs(matrix.a - matrix.d) > 1e-9) {
          refinement.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["d"],
            message: "native mask review requires one uniform source scale",
          });
        }
      }),
    paintedTileBitsetHex: z.string().regex(/^[a-f0-9]{128}$/u),
  })
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

interface MaskWorkflowSessionSeamsV2 {
  readonly afterMaskWorkflowStartedDurable?: () => Promise<void> | void;
  readonly afterMaskEditDurable?: () => Promise<void> | void;
  readonly afterMaskFreezeIntentDurable?: () => Promise<void> | void;
  readonly afterMaskPairPublished?: () => Promise<void> | void;
  readonly afterMaskChildPublished?: () => Promise<void> | void;
  readonly afterMaskDescriptorPublished?: () => Promise<void> | void;
  readonly afterMaskChildStartPublishedBeforeRootVerification?: () => Promise<void> | void;
  readonly afterMaskFreezeCommitDurable?: () => Promise<void> | void;
  readonly afterMaskFreezeRecoveryAbortDurable?: () => Promise<void> | void;
  readonly beforeMaskTileDeliveryAppend?: () => Promise<void> | void;
  readonly beforeMaskCoverageAppend?: () => Promise<void> | void;
  readonly afterMaskTileDeliveryAppendDurable?: () => Promise<void> | void;
  readonly afterMaskCoverageAppendDurable?: () => Promise<void> | void;
}

interface MaskWorkflowSessionDependenciesV2 {
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
  }) => Promise<MaskWorkflowSourceEpochV2>;
  readonly newNonce: () => string;
  readonly nowUtc: () => string;
  readonly monotonicNowMs: () => number;
  readonly configureMaskStore?: (
    store: GrandHallT554NativeMaskRevisionStore,
  ) => void;
  readonly seam?: MaskWorkflowSessionSeamsV2;
}

interface MaskWorkflowSourceEpochV2 {
  readonly snapshot: () => GrandHallT554NativeSourceEpochSnapshotV1;
  readonly copyTile: (input: GrandHallT554NativeSourceTileRequestV1) => Buffer;
  readonly abandon: () => Promise<void>;
}

export interface GrandHallT554NativeReviewMaskWorkflowSnapshotV2 {
  readonly schemaVersion: typeof MASK_WORKFLOW_SNAPSHOT_SCHEMA;
  readonly lifecycle: "active" | "poisoned" | "stopped";
  readonly sessionIdSha256: Sha256;
  readonly workspaceRevision: number;
  readonly maximumAllocatedRenderGeneration: number;
  readonly browserEpochNumber: number;
  readonly browserEpochNonceSha256: Sha256;
  readonly activeSource: {
    readonly inventoryIndex: number;
    readonly sweepNumber: number;
    readonly renderGeneration: number;
    readonly phase: MaskWorkflowPhase;
    readonly sourceReviewSubjectSha256: Sha256;
    readonly completedSourceCoverage: GrandHallT554NativeReviewCompletedSourceCoverageV2 | null;
    readonly maskState: GrandHallT554NativeReviewMaskStateEvidenceV2 | null;
    readonly maskReviewSubjectSha256: Sha256 | null;
    readonly frozenBindingSha256: Sha256 | null;
    readonly frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2 | null;
    readonly maskJournalLeafName: string | null;
  };
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

interface MaskMutationGuardV2 {
  readonly expectedBrowserEpochNonceSha256: Sha256;
  readonly expectedWorkspaceRevision: number;
  readonly expectedRenderGeneration: number;
  readonly sourceReviewSubjectSha256: Sha256;
}

interface MaskRenderBindingV2 {
  readonly expectedBrowserEpochNonceSha256: Sha256;
  readonly expectedRenderGeneration: number;
  readonly sourceReviewSubjectSha256: Sha256;
  readonly maskStateSha256: Sha256;
  readonly maskReviewSubjectSha256: Sha256 | null;
}

export interface GrandHallT554NativeReviewMaskTileV2 {
  readonly schemaVersion: typeof MASK_TILE_SCHEMA;
  readonly renderMode: "source_rgb8_mask8_reason8";
  readonly widthPx: typeof GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX;
  readonly heightPx: typeof GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX;
  readonly sourceRgb8: Buffer;
  readonly mask8: Buffer;
  readonly reason8: Buffer;
  readonly commitDeliveryAfterSuccessfulSend: () => Promise<void>;
  readonly discardAfterFailedSend: () => Promise<void>;
}

export interface GrandHallT554NativeReviewMaskCoverageAcknowledgementV2 {
  readonly schemaVersion: typeof MASK_COVERAGE_ACK_SCHEMA;
  readonly sequence: number;
  readonly journalRevision: number;
  readonly deliveredTileCount: number;
  readonly completedTileCount: number;
  readonly complete: boolean;
}

export interface GrandHallT554NativeReviewMaskWorkflowSessionV2 {
  snapshot(): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2>;
  beginMaskWorkflow(
    input: MaskMutationGuardV2,
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2>;
  applyMaskEdit(
    input: MaskMutationGuardV2 & {
      readonly edit: GrandHallT554NativeReviewMaskEditV2;
    },
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2>;
  freezeMask(
    input: MaskMutationGuardV2 & { readonly expectedMaskRevision: number },
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2>;
  prepareMaskTile(
    input: MaskRenderBindingV2 & {
      readonly column: number;
      readonly row: number;
    },
  ): Promise<GrandHallT554NativeReviewMaskTileV2>;
  recordMaskCoverage(
    input: MaskRenderBindingV2 & {
      readonly documentVisibilityState: "visible" | "hidden" | "prerender";
      readonly documentFocusState: "focused" | "blurred";
      readonly viewportCssWidth: number;
      readonly viewportCssHeight: number;
      readonly devicePixelRatio: number;
      readonly sourceToCssTransform: {
        readonly a: number;
        readonly b: 0;
        readonly c: 0;
        readonly d: number;
        readonly e: number;
        readonly f: number;
      };
      readonly paintedTileBitsetHex: string;
    },
  ): Promise<GrandHallT554NativeReviewMaskCoverageAcknowledgementV2>;
  close(): Promise<void>;
}

export type GrandHallT554NativeReviewMaskWorkflowSessionV2ErrorCode =
  | "ARGUMENT_INVALID"
  | "ROOT_MISSING"
  | "SESSION_CLOSED"
  | "SESSION_STOPPED"
  | "SESSION_POISONED"
  | "WORKSPACE_REVISION_CONFLICT"
  | "BINDING_STALE"
  | "PHASE_INVALID"
  | "SOURCE_COVERAGE_INCOMPLETE"
  | "MASK_REVISION_CONFLICT"
  | "MASK_REVISION_TAINTED"
  | "DELIVERY_ALREADY_RESOLVED"
  | "RENDER_TILE_MUTATED"
  | "PENDING_TILE_DELIVERY"
  | "CRASH_RECOVERY_REQUIRED"
  | "RESOURCE_FAILURE"
  | "RESOURCE_CLEANUP_FAILED"
  | "INTERNAL_INVARIANT_FAILED";

export class GrandHallT554NativeReviewMaskWorkflowSessionV2Error extends Error {
  constructor(
    readonly code: GrandHallT554NativeReviewMaskWorkflowSessionV2ErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewMaskWorkflowSessionV2Error";
  }
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
  code: GrandHallT554NativeReviewMaskWorkflowSessionV2ErrorCode,
  message: string,
  cause?: unknown,
): GrandHallT554NativeReviewMaskWorkflowSessionV2Error {
  return new GrandHallT554NativeReviewMaskWorkflowSessionV2Error(
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

function canonicalTileBitmapContains(
  value: string,
  tileIndex: number,
): boolean {
  const bytes = Buffer.from(value, "hex");
  try {
    return (
      ((bytes[Math.floor(tileIndex / 8)] ?? 0) & (1 << (tileIndex % 8))) !== 0
    );
  } finally {
    bytes.fill(0);
  }
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

function parseInput<TOutput, TDefinition extends z.ZodTypeDef, TInput>(
  schema: z.ZodType<TOutput, TDefinition, TInput>,
  input: unknown,
): TOutput {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw fail(
    "ARGUMENT_INVALID",
    "Input does not match the exact mask-workflow contract.",
    parsed.error,
  );
}

function resolveSessionRoot(value: string): string {
  return resolve(parseInput(SessionRootSchema, value));
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as Readonly<{ code?: unknown }>).code)
    : undefined;
}

async function directKind(
  path: string,
): Promise<"absent" | "file" | "directory"> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw fail(
        "CRASH_RECOVERY_REQUIRED",
        "A trusted workflow path is a symbolic link.",
      );
    }
    if (stats.isFile()) return "file";
    if (stats.isDirectory()) return "directory";
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "A trusted workflow path has an unsupported node kind.",
    );
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return "absent";
    throw error;
  }
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

async function readSessionScope(
  sessionRoot: string,
): Promise<GrandHallT554NativeReviewSessionScopeV2> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(sessionRoot, "session-root.json"));
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      throw fail(
        "ROOT_MISSING",
        "The native-review session root does not exist.",
        error,
      );
    }
    throw error;
  }
  const parsed = parseGrandHallT554StrictJson(bytes);
  const canonical = Buffer.from(
    `${stableCanonicalJson(toCanonicalJson(parsed))}\n`,
    "utf8",
  );
  if (!bytes.equals(canonical)) {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Session root descriptor is not canonical JSON plus LF.",
    );
  }
  return RootDescriptorSchema.parse(parsed).sessionScope;
}

function assertExactManifestBytes(
  binding: GrandHallT554NativeReviewImplementationManifestBindingV2,
  bytes: Buffer,
): void {
  if (
    bytes.length !== binding.byteLength ||
    sha256(bytes) !== binding.fileSha256
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "Exact implementation-manifest bytes differ from their verified binding.",
    );
  }
}

function assertDependencyBindings(
  scope: GrandHallT554NativeReviewSessionScopeV2,
  dependencies: MaskWorkflowSessionDependenciesV2,
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
    !canonicalEqual(scope.authorityBoundary, SESSION_SUBJECT_AUTHORITY)
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "Session dependencies differ from the exact persisted trust boundary.",
    );
  }
}

function preparationDirectoryFor(
  sessionRoot: string,
  sessionIdSha256: Sha256,
): string {
  return join(
    dirname(sessionRoot),
    `.venviewer-t554-mask-preparation-${sessionIdSha256.slice(-24)}.v2`,
  );
}

async function ensurePreparationDirectory(path: string): Promise<void> {
  const kind = await directKind(path);
  if (kind === "directory") return;
  if (kind !== "absent") {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Mask preparation custody is not a direct directory.",
    );
  }
  await mkdir(path);
  await syncDirectory(dirname(path));
}

function stateEvidence(
  exact: GrandHallT554NativeMaskExactStateV2,
): GrandHallT554NativeReviewMaskStateEvidenceV2 {
  return {
    revision: exact.revision,
    maskStateSha256: exact.maskStateSha256,
    includedPixelCount: exact.includedPixelCount,
    excludedPixelCount: exact.excludedPixelCount,
    reasonCounts: [...exact.reasonCounts],
  };
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

function coordinatorEvents(
  events: readonly unknown[],
): readonly GrandHallT554NativeReviewCoordinatorEventV2[] {
  return events.map((candidate) =>
    GrandHallT554NativeReviewCoordinatorEventV2Schema.parse(candidate),
  );
}

function maskChildLeaf(
  renderGeneration: number,
  coverageSegmentIdSha256: Sha256,
): string {
  return `mask-freeze-${String(renderGeneration).padStart(8, "0")}-${coverageSegmentIdSha256.slice(-20)}`;
}

function laterUtc(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function mapMaskStoreError(
  error: unknown,
): GrandHallT554NativeReviewMaskWorkflowSessionV2Error {
  if (error instanceof GrandHallT554NativeReviewMaskWorkflowSessionV2Error) {
    return error;
  }
  if (error instanceof GrandHallT554NativeMaskStoreError) {
    if (error.code === "REVISION_CONFLICT") {
      return fail(
        "MASK_REVISION_CONFLICT",
        "Mask revision CAS is stale.",
        error,
      );
    }
    if (
      error.code === "ARGUMENT_INVALID" ||
      error.code === "NO_CHANGE" ||
      error.code === "REVISION_LIMIT_REACHED" ||
      error.code === "REVISION_STORAGE_LIMIT_REACHED" ||
      error.code === "RASTER_WORK_LIMIT_REACHED"
    ) {
      return fail(
        "ARGUMENT_INVALID",
        "Mask edit or freeze request was rejected.",
        error,
      );
    }
  }
  return fail(
    "RESOURCE_FAILURE",
    "Native mask operation failed closed.",
    error,
  );
}

function mapMaskRecoveryError(
  error: unknown,
): GrandHallT554NativeReviewMaskWorkflowSessionV2Error {
  if (error instanceof GrandHallT554NativeReviewMaskWorkflowSessionV2Error) {
    return error;
  }
  return fail(
    "CRASH_RECOVERY_REQUIRED",
    "Pending mask freeze could not be reconciled to exact durable evidence.",
    error,
  );
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

function productionDependencies(
  options: GrandHallT554NativeReviewSourceSessionProductionOptionsV2,
): MaskWorkflowSessionDependenciesV2 {
  assertGrandHallT554NativeReviewRegistry(options.registry);
  assertGrandHallT554VerifiedNativeReviewImplementationPackV1(
    options.implementationPack,
  );
  assertGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1(
    options.runtimeAuthority,
    options.implementationPack,
  );
  return {
    registry: {
      binding: registryBindingFromRegistry(options.registry),
      sourceAt: (inventoryIndex) => options.registry.sourceAt(inventoryIndex),
      mediaInputAt: (inventoryIndex) =>
        options.registry.mediaInputAt(inventoryIndex),
    },
    implementationManifestBinding: options.implementationPack.manifestBinding,
    copyExactManifestBytes: () =>
      options.implementationPack.copyExactManifestBytes(),
    openSourceEpoch: async (input) =>
      openGrandHallT554NativeSourceEpochV1(input),
    newNonce: () => randomBytes(32).toString("base64url"),
    nowUtc: () => new Date().toISOString(),
    monotonicNowMs: () => Number(process.hrtime.bigint() / 1_000_000n),
  };
}

function maskResumeSourceEpochBindings(input: {
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
  readonly source: GrandHallT554NativeReviewRegistrySource["source"];
  readonly dependencies: MaskWorkflowSessionDependenciesV2;
}): GrandHallT554NativeSourceEpochBindingsV1 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-source-epoch-bindings.v1",
    sourceEpochNonce: input.sourceEpochNonce,
    renderGeneration: input.renderGeneration,
    reviewPack: input.dependencies.registry.binding.reviewPack,
    publicationReceipt: input.dependencies.registry.binding.publicationReceipt,
    workbenchImplementationManifest: {
      semanticSha256:
        input.dependencies.implementationManifestBinding.semanticSha256,
      fileSha256: input.dependencies.implementationManifestBinding.fileSha256,
      byteLength: input.dependencies.implementationManifestBinding.byteLength,
    },
    source: input.source,
  };
}

function assertMaskResumeEpochSnapshot(
  snapshot: GrandHallT554NativeSourceEpochSnapshotV1,
  bindings: GrandHallT554NativeSourceEpochBindingsV1,
): Sha256 {
  const observedSchemaVersion: string = snapshot.schemaVersion;
  const observedTileGrid: Readonly<{
    widthPx: number;
    heightPx: number;
    columnCount: number;
    rowCount: number;
    channelCount: number;
    bytesPerTile: number;
    resampling: string;
  }> = snapshot.tileGrid;
  const expectedBindingSha256 =
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
    snapshot.sourceEpochNonceSha256 !==
      nonceSha256(bindings.sourceEpochNonce) ||
    snapshot.renderGeneration !== bindings.renderGeneration ||
    snapshot.epochBindingSha256 !== expectedBindingSha256 ||
    !canonicalEqual(snapshot.source, bindings.source) ||
    !canonicalEqual(snapshot.reviewPack, bindings.reviewPack) ||
    !canonicalEqual(snapshot.publicationReceipt, bindings.publicationReceipt) ||
    !canonicalEqual(
      snapshot.workbenchImplementationManifest,
      bindings.workbenchImplementationManifest,
    ) ||
    observedTileGrid.widthPx !== GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX ||
    observedTileGrid.heightPx !== GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX ||
    observedTileGrid.columnCount !== GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT ||
    observedTileGrid.rowCount !== GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT ||
    observedTileGrid.channelCount !== 3 ||
    observedTileGrid.bytesPerTile !==
      GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH ||
    observedTileGrid.resampling !== "none"
  ) {
    throw fail(
      "RESOURCE_FAILURE",
      "Mask-edit resume did not reopen the exact prepared source epoch.",
    );
  }
  return expectedBindingSha256;
}

function maskResumeCustody(input: {
  readonly snapshot: GrandHallT554NativeSourceEpochSnapshotV1;
  readonly sourceEpochBindingSha256: Sha256;
  readonly dependencies: MaskWorkflowSessionDependenciesV2;
}): GrandHallT554NativeReviewSourceCustodyBindingV2 {
  const sourceReviewSubjectSha256 =
    computeGrandHallT554NativeReviewSourceReviewSubjectV2Sha256({
      schemaVersion:
        "venviewer.grand-hall-t554-native-source-review-subject-material.v2",
      source: input.snapshot.source,
      sourceVerification: input.snapshot.sourceVerification,
      registry: input.dependencies.registry.binding,
      implementationManifest: input.dependencies.implementationManifestBinding,
    });
  return {
    source: input.snapshot.source,
    sourceVerification: input.snapshot.sourceVerification,
    sourceReviewSubjectSha256,
    sourceEpochBindingSha256: input.sourceEpochBindingSha256,
    sourceEpochNonceSha256: nonceSha256(input.snapshot.sourceEpochNonce),
    sourceEpochRenderGeneration: input.snapshot.renderGeneration,
  };
}

async function abandonMaskResumeEpochAfterFailure(
  epoch: MaskWorkflowSourceEpochV2,
  operationError: unknown,
): Promise<never> {
  try {
    await epoch.abandon();
  } catch (cleanupError) {
    throw fail(
      "RESOURCE_CLEANUP_FAILED",
      "Mask-edit resume source cleanup failed after verification failure.",
      { operationError, cleanupError },
    );
  }
  throw operationError;
}

interface PreparedMaskResumeEpochV2 {
  readonly epoch: MaskWorkflowSourceEpochV2;
  readonly bindings: GrandHallT554NativeSourceEpochBindingsV1;
  readonly snapshot: GrandHallT554NativeSourceEpochSnapshotV1;
  readonly custody: GrandHallT554NativeReviewSourceCustodyBindingV2;
}

async function prepareMaskResumeEpoch(input: {
  readonly active: ActiveCoordinatorSource;
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
  readonly dependencies: MaskWorkflowSessionDependenciesV2;
}): Promise<PreparedMaskResumeEpochV2> {
  const inventoryIndex = input.active.sourceCustody.source.inventoryIndex;
  const registrySource = input.dependencies.registry.sourceAt(inventoryIndex);
  const media = input.dependencies.registry.mediaInputAt(inventoryIndex);
  if (
    !canonicalEqual(registrySource.source, input.active.sourceCustody.source) ||
    media.fileName !== registrySource.source.fileName ||
    media.expectedSha256 !== registrySource.source.sha256 ||
    media.expectedByteLength !== registrySource.source.byteLength ||
    typeof media.sourceRoot !== "string" ||
    media.sourceRoot.length === 0
  ) {
    throw fail(
      "RESOURCE_FAILURE",
      "Mask-edit resume registry media differs from stable source custody.",
    );
  }
  const bindings = maskResumeSourceEpochBindings({
    sourceEpochNonce: input.sourceEpochNonce,
    renderGeneration: input.renderGeneration,
    source: registrySource.source,
    dependencies: input.dependencies,
  });
  let epoch: MaskWorkflowSourceEpochV2;
  try {
    epoch = await input.dependencies.openSourceEpoch({
      sourceRoot: media.sourceRoot,
      bindings,
    });
  } catch (error) {
    throw fail(
      "RESOURCE_FAILURE",
      "Mask-edit resume could not reopen the exact source epoch.",
      error,
    );
  }
  try {
    const snapshot = epoch.snapshot();
    const sourceEpochBindingSha256 = assertMaskResumeEpochSnapshot(
      snapshot,
      bindings,
    );
    const custody = maskResumeCustody({
      snapshot,
      sourceEpochBindingSha256,
      dependencies: input.dependencies,
    });
    if (!stableCustodyMatches(custody, input.active.sourceCustody)) {
      throw fail(
        "RESOURCE_FAILURE",
        "Mask-edit resume source verification changed stable custody.",
      );
    }
    return { epoch, bindings, snapshot, custody };
  } catch (error) {
    return await abandonMaskResumeEpochAfterFailure(epoch, error);
  }
}

function exactMaskStateMatches(
  claim: GrandHallT554NativeReviewMaskStateEvidenceV2,
  exact: GrandHallT554NativeMaskExactStateV2,
): boolean {
  return canonicalEqual(claim, stateEvidence(exact));
}

function stableCustodyMatches(
  left: GrandHallT554NativeReviewSourceCustodyBindingV2,
  right: GrandHallT554NativeReviewSourceCustodyBindingV2,
): boolean {
  return (
    canonicalEqual(left.source, right.source) &&
    canonicalEqual(left.sourceVerification, right.sourceVerification) &&
    left.sourceReviewSubjectSha256 === right.sourceReviewSubjectSha256
  );
}

function hasPartialPublicationAbortForMaskState(input: {
  readonly events: readonly GrandHallT554NativeReviewCoordinatorEventV2[];
  readonly sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2;
  readonly maskState: GrandHallT554NativeReviewMaskStateEvidenceV2;
}): boolean {
  const intents = new Map<Sha256, MaskFreezeIntendedEvent>();
  for (const coordinatorEvent of input.events) {
    if (coordinatorEvent.eventType === "mask.freeze-intended.v2") {
      intents.set(coordinatorEvent.payload.operationIdSha256, coordinatorEvent);
      continue;
    }
    if (
      coordinatorEvent.eventType !== "mask.freeze-recovery-aborted.v2" ||
      (coordinatorEvent.payload.publicationDisposition !== "mask_only" &&
        coordinatorEvent.payload.publicationDisposition !== "reason_map_only")
    ) {
      continue;
    }
    const intent = intents.get(coordinatorEvent.payload.operationIdSha256);
    if (
      intent !== undefined &&
      stableCustodyMatches(intent.payload.sourceCustody, input.sourceCustody) &&
      canonicalEqual(intent.payload.maskState, input.maskState)
    ) {
      return true;
    }
  }
  return false;
}

function latestMaskWorkflowStart(
  events: readonly GrandHallT554NativeReviewCoordinatorEventV2[],
  sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2,
): { readonly index: number; readonly event: MaskWorkflowStartedEvent } {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (
      candidate?.eventType === "mask.workflow-started.v2" &&
      stableCustodyMatches(candidate.payload.sourceCustody, sourceCustody)
    ) {
      return { index, event: candidate };
    }
  }
  throw fail(
    "INTERNAL_INVARIANT_FAILED",
    "Active mask phase has no exact durable workflow start.",
  );
}

interface RehydratedMaskStoreV2 {
  readonly store: GrandHallT554NativeMaskRevisionStore;
  readonly context: GrandHallT554NativeMaskReplayContextV2;
  readonly exactState: GrandHallT554NativeMaskExactStateV2;
}

function rehydrateMaskStore(input: {
  readonly sessionRoot: string;
  readonly preparationDirectory: string;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2;
  readonly expectedMaskState: GrandHallT554NativeReviewMaskStateEvidenceV2;
  readonly events: readonly GrandHallT554NativeReviewCoordinatorEventV2[];
  readonly dependencies: MaskWorkflowSessionDependenciesV2;
}): RehydratedMaskStoreV2 {
  const context = buildGrandHallT554NativeMaskReplayContextV2(
    input.sessionScope,
    input.sourceCustody,
  );
  const workflow = latestMaskWorkflowStart(input.events, input.sourceCustody);
  const store = new GrandHallT554NativeMaskRevisionStore({
    source: input.sourceCustody.source,
    publicationDirectory: join(input.sessionRoot, "mask-evidence"),
    preparationDirectory: input.preparationDirectory,
  });
  try {
    input.dependencies.configureMaskStore?.(store);
    let exact = store.exactStateV2(context);
    if (
      !exactMaskStateMatches(workflow.event.payload.initialMaskState, exact)
    ) {
      throw fail(
        "INTERNAL_INVARIANT_FAILED",
        "Durable mask workflow initial state differs from exact raster replay.",
      );
    }
    for (
      let index = workflow.index + 1;
      index < input.events.length;
      index += 1
    ) {
      const candidate = input.events[index];
      if (
        candidate?.eventType !== "mask.edited.v2" ||
        !stableCustodyMatches(
          candidate.payload.sourceCustody,
          input.sourceCustody,
        )
      ) {
        continue;
      }
      if (!exactMaskStateMatches(candidate.payload.previousMaskState, exact)) {
        throw fail(
          "INTERNAL_INVARIANT_FAILED",
          "Durable mask edit predecessor differs from exact raster replay.",
        );
      }
      store.applyEdit(candidate.payload.edit);
      exact = store.exactStateV2(context);
      if (!exactMaskStateMatches(candidate.payload.resultingMaskState, exact)) {
        throw fail(
          "INTERNAL_INVARIANT_FAILED",
          "Durable mask edit result differs from exact raster replay.",
        );
      }
    }
    if (!exactMaskStateMatches(input.expectedMaskState, exact)) {
      throw fail(
        "INTERNAL_INVARIANT_FAILED",
        "Coordinator mask state differs from exact durable edit replay.",
      );
    }
    return { store, context, exactState: exact };
  } catch (error) {
    try {
      store.abandon();
    } catch (cleanupError) {
      throw fail(
        "RESOURCE_CLEANUP_FAILED",
        "Mask replay cleanup failed after rehydration error.",
        { operationError: error, cleanupError },
      );
    }
    throw mapMaskStoreError(error);
  }
}

function completedSourceCoverage(
  store: GrandHallT554NativeReviewSessionStoreReplayV2,
): {
  readonly proof: GrandHallT554NativeReviewCompletedSourceCoverageV2;
  readonly finalDurableRecordedAtUtc: string;
} {
  const active = store.coordinator.activeSource;
  const evidence = latestVerifiedActiveSourceEvidenceV2(store);
  if (active === null || evidence === null) {
    throw fail(
      "INTERNAL_INVARIANT_FAILED",
      "Mask workflow requires exact active source-child evidence.",
    );
  }
  const coverage =
    replayGrandHallT554NativeReviewSourceChildV2(evidence).coverage;
  if (!coverage.complete || coverage.completedTileCount !== 512) {
    throw fail(
      "SOURCE_COVERAGE_INCOMPLETE",
      "Mask workflow requires complete native-grid source coverage.",
    );
  }
  return {
    proof: GrandHallT554NativeReviewCompletedSourceCoverageV2Schema.parse({
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2",
      sourceReviewSubjectSha256: active.sourceCustody.sourceReviewSubjectSha256,
      sourceJournal: evidence.checkpoint,
      completedTileBitsetHex: coverage.completedTileBitsetHex,
      completedTileCount: coverage.completedTileCount,
      cumulativeDwellStateSha256: coverage.cumulativeDwellStateSha256,
    }),
    finalDurableRecordedAtUtc: evidence.finalDurableRecordedAtUtc,
  };
}

function assertPreparedMatchesState(
  prepared: GrandHallT554NativeMaskPreparedFreezeV2["binding"],
  sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2,
  maskState: GrandHallT554NativeReviewMaskStateEvidenceV2,
): void {
  const parsed =
    GrandHallT554NativeReviewPreparedMaskBindingV2Schema.parse(prepared);
  if (
    !canonicalEqual(parsed.source, sourceCustody.source) ||
    parsed.revision !== maskState.revision ||
    parsed.includedPixelCount !== maskState.includedPixelCount ||
    parsed.excludedPixelCount !== maskState.excludedPixelCount ||
    !canonicalEqual(parsed.reasonCounts, maskState.reasonCounts)
  ) {
    throw fail(
      "INTERNAL_INVARIANT_FAILED",
      "Prepared mask evidence differs from the exact active mask state.",
    );
  }
}

function maskScope(input: {
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly browserEpochNonceSha256: Sha256;
  readonly coverageSegmentIdSha256: Sha256;
  readonly renderGeneration: number;
  readonly sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2;
  readonly maskReviewSubjectSha256: Sha256;
  readonly maskStateSha256: Sha256;
  readonly frozenBindingSha256: Sha256;
  readonly frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2;
}): GrandHallT554NativeReviewMaskScopeV2 {
  return GrandHallT554NativeReviewMaskScopeV2Schema.parse({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "mask",
    sessionIdSha256: input.sessionScope.sessionIdSha256,
    implementationManifest: input.sessionScope.implementationManifest,
    registry: input.sessionScope.registry,
    authorityBoundary: input.sessionScope.authorityBoundary,
    browserEpochNonceSha256: input.browserEpochNonceSha256,
    coverageSegmentIdSha256: input.coverageSegmentIdSha256,
    renderGeneration: input.renderGeneration,
    sourceCustody: input.sourceCustody,
    maskReviewSubjectSha256: input.maskReviewSubjectSha256,
    maskStateSha256: input.maskStateSha256,
    frozenBindingSha256: input.frozenBindingSha256,
    frozenBinding: input.frozenBinding,
  });
}

function finalRecordedAtUtc(
  replay: GrandHallT554NativeReviewDurableJournalReplayV2,
): string {
  const record = replay.records.at(-1);
  if (record === undefined) {
    throw fail(
      "INTERNAL_INVARIANT_FAILED",
      "Durable coordinator replay has no final record.",
    );
  }
  return record.recordedAtUtc;
}

function safelyDiscardPrepared(
  prepared: GrandHallT554NativeMaskPreparedFreezeV2,
): void {
  try {
    prepared.discard();
  } catch (error) {
    if (
      !(error instanceof GrandHallT554NativeMaskStoreError) ||
      error.code !== "PREPARED_FREEZE_CONSUMED"
    ) {
      throw error;
    }
  }
}

interface ActiveMaskWorkflowRuntimeV2 {
  readonly epoch: MaskWorkflowSourceEpochV2;
  readonly epochBindings: GrandHallT554NativeSourceEpochBindingsV1;
  readonly epochSnapshot: GrandHallT554NativeSourceEpochSnapshotV1;
  readonly sourceEpochNonce: string;
  maskStore: GrandHallT554NativeMaskRevisionStore;
  maskContext: GrandHallT554NativeMaskReplayContextV2;
  maskChild: GrandHallT554NativeReviewPublishedMaskChildStartV2 | null;
}

interface PendingMaskTileV2 {
  resolved: boolean;
  readonly sourceRgb8: Buffer;
  readonly mask8: Buffer;
  readonly reason8: Buffer;
  readonly sourceRgb8Sha256: Sha256;
  readonly mask8Sha256: Sha256;
  readonly reason8Sha256: Sha256;
}

function zeroPendingMaskTile(pending: PendingMaskTileV2): void {
  pending.resolved = true;
  pending.sourceRgb8.fill(0);
  pending.mask8.fill(0);
  pending.reason8.fill(0);
}

class GrandHallT554NativeReviewMaskWorkflowSessionControllerV2 implements GrandHallT554NativeReviewMaskWorkflowSessionV2 {
  readonly #lane = new SerialMutationLane();
  readonly #pendingTiles = new Set<PendingMaskTileV2>();
  #store: GrandHallT554NativeReviewSessionStoreReplayV2;
  #runtime: ActiveMaskWorkflowRuntimeV2 | null;
  #closed = false;
  #recoveryRequired = false;

  constructor(
    readonly sessionRoot: string,
    readonly preparationDirectory: string,
    readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2,
    readonly dependencies: MaskWorkflowSessionDependenciesV2,
    readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2,
    readonly coordinatorJournal: GrandHallT554NativeReviewDurableJournalV2,
    store: GrandHallT554NativeReviewSessionStoreReplayV2,
    runtime: ActiveMaskWorkflowRuntimeV2 | null,
  ) {
    this.#store = store;
    this.#runtime = runtime;
  }

  async #assertOwner(): Promise<void> {
    if (this.#closed) {
      throw fail("SESSION_CLOSED", "Mask-workflow controller is closed.");
    }
    if (this.#recoveryRequired) {
      throw fail(
        "CRASH_RECOVERY_REQUIRED",
        "Mask-workflow controller requires an exact disk recovery reopen.",
      );
    }
    await assertGrandHallT554NativeReviewSessionOwnerV2({
      lease: this.lease,
      sessionRoot: this.sessionRoot,
      expectedSessionScope: this.sessionScope,
    });
  }

  async #assertOwnerIncludingRecoveryRequired(): Promise<void> {
    if (this.#closed) {
      throw fail("SESSION_CLOSED", "Mask-workflow controller is closed.");
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

  #active(): ActiveCoordinatorSource {
    const active = this.#coordinator().activeSource;
    if (active === null) {
      throw fail(
        "PHASE_INVALID",
        "Mask workflow requires one active source review.",
      );
    }
    return active;
  }

  #assertMutableLifecycle(): void {
    if (this.#coordinator().lifecycle === "stopped") {
      throw fail(
        "SESSION_STOPPED",
        "Stopped native-review session is immutable.",
      );
    }
    if (this.#coordinator().lifecycle === "poisoned") {
      throw fail(
        "SESSION_POISONED",
        "Poisoned native-review session is immutable.",
      );
    }
  }

  #assertNoPendingTiles(operation: string): void {
    if (this.#pendingTiles.size !== 0) {
      throw fail(
        "PENDING_TILE_DELIVERY",
        `${operation} requires every prepared mask tile to be committed or discarded.`,
      );
    }
  }

  #assertGuard(request: MaskMutationGuardV2): ActiveCoordinatorSource {
    const coordinator = this.#coordinator();
    const browser = coordinator.browserEpoch;
    const active = this.#active();
    if (request.expectedWorkspaceRevision !== coordinator.workspaceRevision) {
      throw fail(
        "WORKSPACE_REVISION_CONFLICT",
        "Mask-workflow workspace revision CAS is stale.",
      );
    }
    if (
      browser === null ||
      request.expectedBrowserEpochNonceSha256 !== browser.nonceSha256 ||
      request.expectedRenderGeneration !== active.renderGeneration ||
      request.sourceReviewSubjectSha256 !==
        active.sourceCustody.sourceReviewSubjectSha256
    ) {
      throw fail(
        "BINDING_STALE",
        "Mask-workflow browser, generation, or source binding is stale.",
      );
    }
    return active;
  }

  #assertRenderBinding(request: MaskRenderBindingV2): {
    readonly active: ActiveCoordinatorSource;
    readonly runtime: ActiveMaskWorkflowRuntimeV2;
  } {
    const coordinator = this.#coordinator();
    const browser = coordinator.browserEpoch;
    const active = this.#active();
    const runtime = this.#runtime;
    if (
      runtime === null ||
      active.maskState === null ||
      (active.phase !== "mask_edit" && active.phase !== "mask_review")
    ) {
      throw fail(
        "PHASE_INVALID",
        "Mask tiles require one live editable or frozen mask runtime.",
      );
    }
    if (
      browser === null ||
      request.expectedBrowserEpochNonceSha256 !== browser.nonceSha256 ||
      request.expectedRenderGeneration !== active.renderGeneration ||
      request.sourceReviewSubjectSha256 !==
        active.sourceCustody.sourceReviewSubjectSha256 ||
      request.maskStateSha256 !== active.maskState.maskStateSha256 ||
      request.maskReviewSubjectSha256 !== active.maskReviewSubjectSha256
    ) {
      throw fail(
        "BINDING_STALE",
        "Mask render browser, generation, source, or mask binding is stale.",
      );
    }
    const epochSnapshot = runtime.epoch.snapshot();
    const observedBindingSha256 = assertMaskResumeEpochSnapshot(
      epochSnapshot,
      runtime.epochBindings,
    );
    const custody = maskResumeCustody({
      snapshot: epochSnapshot,
      sourceEpochBindingSha256: observedBindingSha256,
      dependencies: this.dependencies,
    });
    if (
      !canonicalEqual(epochSnapshot, runtime.epochSnapshot) ||
      !canonicalEqual(custody, active.sourceCustody) ||
      !exactMaskStateMatches(
        active.maskState,
        runtime.maskStore.exactStateV2(runtime.maskContext),
      ) ||
      (active.phase === "mask_edit" && runtime.maskChild !== null) ||
      (active.phase === "mask_review" &&
        (runtime.maskChild === null ||
          active.maskJournal === null ||
          runtime.maskChild.evidence.checkpoint.leafName !==
            active.maskJournal.leafName ||
          !canonicalEqual(runtime.maskChild.scope, {
            ...runtime.maskChild.scope,
            browserEpochNonceSha256: browser.nonceSha256,
            renderGeneration: active.renderGeneration,
            sourceCustody: active.sourceCustody,
            maskReviewSubjectSha256: active.maskReviewSubjectSha256,
            maskStateSha256: active.maskState.maskStateSha256,
            frozenBindingSha256: active.frozenBindingSha256,
            frozenBinding: active.frozenBinding,
          })))
    ) {
      throw fail(
        "INTERNAL_INVARIANT_FAILED",
        "Process-local mask runtime differs from verified coordinator state.",
      );
    }
    return { active, runtime };
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

  #snapshotVerified(): GrandHallT554NativeReviewMaskWorkflowSnapshotV2 {
    const coordinator = this.#coordinator();
    const browser = coordinator.browserEpoch;
    const active = coordinator.activeSource;
    if (browser === null || active === null) {
      throw fail(
        "PHASE_INVALID",
        "Mask-workflow snapshot requires one active source and browser epoch.",
      );
    }
    if (
      active.phase !== "source_review" &&
      active.phase !== "mask_edit" &&
      active.phase !== "mask_review"
    ) {
      throw fail(
        "PHASE_INVALID",
        "Mask-workflow facade cannot expose a decision or terminal source phase.",
      );
    }
    return Object.freeze({
      schemaVersion: MASK_WORKFLOW_SNAPSHOT_SCHEMA,
      lifecycle: coordinator.lifecycle,
      sessionIdSha256: coordinator.sessionIdSha256,
      workspaceRevision: coordinator.workspaceRevision,
      maximumAllocatedRenderGeneration:
        coordinator.maximumAllocatedRenderGeneration,
      browserEpochNumber: browser.number,
      browserEpochNonceSha256: browser.nonceSha256,
      activeSource: {
        inventoryIndex: active.sourceCustody.source.inventoryIndex,
        sweepNumber: active.sourceCustody.source.sweepNumber,
        renderGeneration: active.renderGeneration,
        phase: active.phase,
        sourceReviewSubjectSha256:
          active.sourceCustody.sourceReviewSubjectSha256,
        completedSourceCoverage: active.completedSourceCoverage,
        maskState: active.maskState,
        maskReviewSubjectSha256: active.maskReviewSubjectSha256,
        frozenBindingSha256: active.frozenBindingSha256,
        frozenBinding: active.frozenBinding,
        maskJournalLeafName: active.maskJournal?.leafName ?? null,
      },
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      exportAuthorized: false,
      generatedContentAuthorized: false,
      rootInventorySha256: this.#store.rootInventorySha256,
      verificationAttestationSha256: this.#store.verificationAttestationSha256,
    });
  }

  snapshot(): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    return this.#lane.run(async () => {
      await this.#refreshStore();
      return this.#snapshotVerified();
    });
  }

  beginMaskWorkflow(
    input: MaskMutationGuardV2,
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(BeginMaskWorkflowInputSchema, input);
      await this.#refreshStore();
      this.#assertMutableLifecycle();
      const active = this.#assertGuard(request);
      if (active.phase !== "source_review") {
        throw fail(
          "PHASE_INVALID",
          "Mask workflow can begin only from completed source review.",
        );
      }
      this.#assertNoPendingTiles("Mask workflow start");
      const coverage = completedSourceCoverage(this.#store);
      const resultingRenderGeneration =
        this.#coordinator().maximumAllocatedRenderGeneration + 1;
      const sourceEpochNonce = parseInput(
        NonceSchema,
        this.dependencies.newNonce(),
      );
      const preparedEpoch = await prepareMaskResumeEpoch({
        active,
        sourceEpochNonce,
        renderGeneration: resultingRenderGeneration,
        dependencies: this.dependencies,
      });
      let context: GrandHallT554NativeMaskReplayContextV2 | undefined;
      let maskStore: GrandHallT554NativeMaskRevisionStore | undefined;
      let runtimeTransferred = false;
      let operationError: unknown;
      let result: GrandHallT554NativeReviewMaskWorkflowSnapshotV2 | undefined;
      try {
        context = buildGrandHallT554NativeMaskReplayContextV2(
          this.sessionScope,
          preparedEpoch.custody,
        );
        maskStore = new GrandHallT554NativeMaskRevisionStore({
          source: preparedEpoch.custody.source,
          publicationDirectory: join(this.sessionRoot, "mask-evidence"),
          preparationDirectory: this.preparationDirectory,
        });
        this.dependencies.configureMaskStore?.(maskStore);
        const initialMaskState = stateEvidence(maskStore.exactStateV2(context));
        await this.#appendCoordinator(
          event<MaskWorkflowStartedEvent>("mask.workflow-started.v2", {
            schemaVersion:
              "venviewer.grand-hall-t554-native-review-mask-workflow-started.v2",
            browserEpochNonceSha256:
              this.#coordinator().browserEpoch?.nonceSha256 ??
              (() => {
                throw fail(
                  "INTERNAL_INVARIANT_FAILED",
                  "Mask workflow start has no browser epoch.",
                );
              })(),
            previousWorkspaceRevision: request.expectedWorkspaceRevision,
            resultingWorkspaceRevision: request.expectedWorkspaceRevision + 1,
            sourceCustodyBefore: active.sourceCustody,
            sourceCustody: preparedEpoch.custody,
            previousRenderGeneration: active.renderGeneration,
            resultingRenderGeneration,
            completedSourceCoverage: coverage.proof,
            initialMaskState,
          }),
        );
        await this.dependencies.seam?.afterMaskWorkflowStartedDurable?.();
        await this.#refreshStore();
        this.#runtime = {
          epoch: preparedEpoch.epoch,
          epochBindings: preparedEpoch.bindings,
          epochSnapshot: preparedEpoch.snapshot,
          sourceEpochNonce,
          maskStore,
          maskContext: context,
          maskChild: null,
        };
        runtimeTransferred = true;
        result = this.#snapshotVerified();
      } catch (error) {
        operationError = error;
      }
      const cleanupErrors: unknown[] = [];
      if (!runtimeTransferred) {
        if (maskStore !== undefined) {
          try {
            maskStore.abandon();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        try {
          await preparedEpoch.epoch.abandon();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (operationError !== undefined) {
        if (cleanupErrors.length !== 0) {
          throw fail(
            "RESOURCE_CLEANUP_FAILED",
            "Initial mask runtime cleanup failed after workflow-start error.",
            { operationError, cleanupErrors },
          );
        }
        throw mapMaskStoreError(operationError);
      }
      if (cleanupErrors.length !== 0) {
        throw fail(
          "RESOURCE_CLEANUP_FAILED",
          "Initial mask runtime cleanup failed.",
          cleanupErrors,
        );
      }
      if (result === undefined) {
        throw fail(
          "INTERNAL_INVARIANT_FAILED",
          "Mask workflow start produced no verified snapshot.",
        );
      }
      return result;
    });
  }

  applyMaskEdit(
    input: MaskMutationGuardV2 & {
      readonly edit: GrandHallT554NativeReviewMaskEditV2;
    },
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(ApplyMaskEditInputSchema, input);
      await this.#refreshStore();
      this.#assertMutableLifecycle();
      const active = this.#assertGuard(request);
      if (
        (active.phase !== "mask_edit" && active.phase !== "mask_review") ||
        active.maskState === null
      ) {
        throw fail(
          "PHASE_INVALID",
          "Mask edit requires an active mask workflow.",
        );
      }
      this.#assertNoPendingTiles("Mask edit");
      const browser = this.#coordinator().browserEpoch;
      if (browser === null) {
        throw fail(
          "INTERNAL_INVARIANT_FAILED",
          "Mask edit has no browser epoch.",
        );
      }
      const { runtime: priorRuntime } = this.#assertRenderBinding({
        expectedBrowserEpochNonceSha256: browser.nonceSha256,
        expectedRenderGeneration: active.renderGeneration,
        sourceReviewSubjectSha256:
          active.sourceCustody.sourceReviewSubjectSha256,
        maskStateSha256: active.maskState.maskStateSha256,
        maskReviewSubjectSha256: active.maskReviewSubjectSha256,
      });
      const rehydrated = rehydrateMaskStore({
        sessionRoot: this.sessionRoot,
        preparationDirectory: this.preparationDirectory,
        sessionScope: this.sessionScope,
        sourceCustody: active.sourceCustody,
        expectedMaskState: active.maskState,
        events: coordinatorEvents(this.#store.coordinatorJournal.events),
        dependencies: this.dependencies,
      });
      let runtimeTransferred = false;
      let operationError: unknown;
      let result: GrandHallT554NativeReviewMaskWorkflowSnapshotV2 | undefined;
      try {
        const previousMaskState = stateEvidence(rehydrated.exactState);
        rehydrated.store.applyEdit(request.edit);
        const resultingMaskState = stateEvidence(
          rehydrated.store.exactStateV2(rehydrated.context),
        );
        const invalidatedMaskEvidence =
          active.phase === "mask_review"
            ? latestVerifiedActiveMaskEvidenceV2(this.#store)
            : null;
        if (
          active.phase === "mask_review" &&
          invalidatedMaskEvidence === null
        ) {
          throw fail(
            "INTERNAL_INVARIANT_FAILED",
            "Frozen mask review has no exact durable mask-child evidence.",
          );
        }
        const resultingRenderGeneration =
          this.#coordinator().maximumAllocatedRenderGeneration + 1;
        await this.#appendCoordinator(
          event<MaskEditedEvent>("mask.edited.v2", {
            schemaVersion:
              "venviewer.grand-hall-t554-native-review-mask-edited.v2",
            operationIdSha256: nonceSha256(
              parseInput(NonceSchema, this.dependencies.newNonce()),
            ),
            browserEpochNonceSha256:
              this.#coordinator().browserEpoch?.nonceSha256 ??
              (() => {
                throw fail(
                  "INTERNAL_INVARIANT_FAILED",
                  "Mask edit has no browser epoch.",
                );
              })(),
            previousWorkspaceRevision: request.expectedWorkspaceRevision,
            resultingWorkspaceRevision: request.expectedWorkspaceRevision + 1,
            sourceCustody: active.sourceCustody,
            previousRenderGeneration: active.renderGeneration,
            resultingRenderGeneration,
            edit: request.edit,
            previousMaskState,
            resultingMaskState,
            invalidatedFrozenBindingSha256:
              active.phase === "mask_review"
                ? active.frozenBindingSha256
                : null,
            invalidatedMaskJournal: invalidatedMaskEvidence?.checkpoint ?? null,
          }),
        );
        await this.dependencies.seam?.afterMaskEditDurable?.();
        await this.#refreshStore();
        this.#runtime = {
          ...priorRuntime,
          maskStore: rehydrated.store,
          maskContext: rehydrated.context,
          maskChild: null,
        };
        runtimeTransferred = true;
        result = this.#snapshotVerified();
      } catch (error) {
        operationError = error;
      }
      const cleanupErrors: unknown[] = [];
      if (!runtimeTransferred) {
        try {
          rehydrated.store.abandon();
        } catch (error) {
          cleanupErrors.push(error);
        }
      } else {
        try {
          priorRuntime.maskStore.abandon();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (operationError !== undefined) {
        if (cleanupErrors.length !== 0) {
          throw fail(
            "RESOURCE_CLEANUP_FAILED",
            "Rehydrated mask-store cleanup failed after edit error.",
            { operationError, cleanupErrors },
          );
        }
        throw mapMaskStoreError(operationError);
      }
      if (cleanupErrors.length !== 0) {
        throw fail(
          "RESOURCE_CLEANUP_FAILED",
          "Rehydrated mask-store cleanup failed.",
          cleanupErrors,
        );
      }
      if (result === undefined) {
        throw fail(
          "INTERNAL_INVARIANT_FAILED",
          "Mask edit produced no verified snapshot.",
        );
      }
      return result;
    });
  }

  freezeMask(
    input: MaskMutationGuardV2 & { readonly expectedMaskRevision: number },
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(FreezeMaskInputSchema, input);
      await this.#refreshStore();
      this.#assertMutableLifecycle();
      const active = this.#assertGuard(request);
      if (active.phase !== "mask_edit" || active.maskState === null) {
        throw fail(
          "PHASE_INVALID",
          "Mask freeze requires an editable mask state.",
        );
      }
      if (request.expectedMaskRevision !== active.maskState.revision) {
        throw fail("MASK_REVISION_CONFLICT", "Mask revision CAS is stale.");
      }
      this.#assertNoPendingTiles("Mask freeze");
      const browser = this.#coordinator().browserEpoch;
      if (browser === null) {
        throw fail(
          "INTERNAL_INVARIANT_FAILED",
          "Mask freeze has no browser epoch.",
        );
      }
      const { runtime: priorRuntime } = this.#assertRenderBinding({
        expectedBrowserEpochNonceSha256: browser.nonceSha256,
        expectedRenderGeneration: active.renderGeneration,
        sourceReviewSubjectSha256:
          active.sourceCustody.sourceReviewSubjectSha256,
        maskStateSha256: active.maskState.maskStateSha256,
        maskReviewSubjectSha256: null,
      });
      if (
        active.maskState.revision === 0 ||
        active.maskState.includedPixelCount === 0
      ) {
        throw fail(
          "PHASE_INVALID",
          "Mask freeze requires an edited mask with included source pixels.",
        );
      }
      if (
        hasPartialPublicationAbortForMaskState({
          events: coordinatorEvents(this.#store.coordinatorJournal.events),
          sourceCustody: active.sourceCustody,
          maskState: active.maskState,
        })
      ) {
        throw fail(
          "MASK_REVISION_TAINTED",
          "This mask revision retains an exact partial publication; apply a new mask edit before freezing again.",
        );
      }
      const rehydrated = rehydrateMaskStore({
        sessionRoot: this.sessionRoot,
        preparationDirectory: this.preparationDirectory,
        sessionScope: this.sessionScope,
        sourceCustody: active.sourceCustody,
        expectedMaskState: active.maskState,
        events: coordinatorEvents(this.#store.coordinatorJournal.events),
        dependencies: this.dependencies,
      });
      const operationIdSha256 = nonceSha256(
        parseInput(NonceSchema, this.dependencies.newNonce()),
      );
      const coverageSegmentIdSha256 = nonceSha256(
        parseInput(NonceSchema, this.dependencies.newNonce()),
      );
      const allocatedRenderGeneration =
        this.#coordinator().maximumAllocatedRenderGeneration + 1;
      const childJournalLeafName = maskChildLeaf(
        allocatedRenderGeneration,
        coverageSegmentIdSha256,
      );
      let prepared: GrandHallT554NativeMaskPreparedFreezeV2 | undefined;
      let publishedMaskChild:
        | GrandHallT554NativeReviewPublishedMaskChildStartV2
        | undefined;
      let intentDurable = false;
      let runtimeTransferred = false;
      let operationError: unknown;
      let result: GrandHallT554NativeReviewMaskWorkflowSnapshotV2 | undefined;
      try {
        prepared = await rehydrated.store.prepareFreeze({
          expectedRevision: request.expectedMaskRevision,
          operationIdSha256,
        });
        assertPreparedMatchesState(
          prepared.binding,
          active.sourceCustody,
          active.maskState,
        );
        const preparedBindingSha256 =
          computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256(
            prepared.binding,
          );
        const maskReviewSubjectSha256 =
          computeGrandHallT554NativeReviewMaskSubjectV2Sha256({
            sourceReviewSubjectSha256:
              active.sourceCustody.sourceReviewSubjectSha256,
            maskStateSha256: active.maskState.maskStateSha256,
            maskEvidenceSha256:
              computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(
                prepared.binding,
              ),
            implementationManifest: this.sessionScope.implementationManifest,
          });
        const freezeIntentEvent = event<MaskFreezeIntendedEvent>(
          "mask.freeze-intended.v2",
          {
            schemaVersion:
              "venviewer.grand-hall-t554-native-review-mask-freeze-intended.v2",
            operationIdSha256,
            browserEpochNonceSha256:
              this.#coordinator().browserEpoch?.nonceSha256 ??
              (() => {
                throw fail(
                  "INTERNAL_INVARIANT_FAILED",
                  "Mask freeze intent has no browser epoch.",
                );
              })(),
            expectedWorkspaceRevision: request.expectedWorkspaceRevision,
            sourceCustody: active.sourceCustody,
            previousRenderGeneration: active.renderGeneration,
            allocatedRenderGeneration,
            maskState: active.maskState,
            maskReviewSubjectSha256,
            coverageSegmentIdSha256,
            preparedBindingSha256,
            preparedBinding: prepared.binding,
            childJournalLeafName,
          },
        );
        const intentReplay = await this.#appendCoordinator(freezeIntentEvent);
        intentDurable = true;
        this.#recoveryRequired = true;
        await this.dependencies.seam?.afterMaskFreezeIntentDurable?.();
        await this.#assertOwnerIncludingRecoveryRequired();
        const frozenBinding =
          GrandHallT554NativeReviewFrozenMaskBindingV2Schema.parse(
            await prepared.publishOrVerifyExact(),
          );
        await this.dependencies.seam?.afterMaskPairPublished?.();
        await this.#assertOwnerIncludingRecoveryRequired();
        const frozenBindingSha256 =
          computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256(
            frozenBinding,
          );
        if (
          computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256(
            frozenBinding,
          ) !==
          computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(
            prepared.binding,
          )
        ) {
          throw fail(
            "INTERNAL_INVARIANT_FAILED",
            "Published frozen mask differs from the prepared intent evidence.",
          );
        }
        const scope = maskScope({
          sessionScope: this.sessionScope,
          browserEpochNonceSha256:
            this.#coordinator().browserEpoch?.nonceSha256 ??
            (() => {
              throw fail(
                "INTERNAL_INVARIANT_FAILED",
                "Mask child creation has no browser epoch.",
              );
            })(),
          coverageSegmentIdSha256,
          renderGeneration: allocatedRenderGeneration,
          sourceCustody: active.sourceCustody,
          maskReviewSubjectSha256,
          maskStateSha256: active.maskState.maskStateSha256,
          frozenBindingSha256,
          frozenBinding,
        });
        const sourceEvidence = latestVerifiedActiveSourceEvidenceV2(
          this.#store,
        );
        if (sourceEvidence === null) {
          throw fail(
            "INTERNAL_INVARIANT_FAILED",
            "Mask child creation lost active source evidence.",
          );
        }
        const published =
          await publishGrandHallT554NativeReviewMaskChildStartV2({
            sessionRoot: this.sessionRoot,
            scope,
            leafName: childJournalLeafName,
            startedAtUtc: laterUtc(
              finalRecordedAtUtc(intentReplay),
              sourceEvidence.finalDurableRecordedAtUtc,
            ),
            predecessorCoverage: null,
            stageIdentitySha256: operationIdSha256,
            afterChildPublished:
              this.dependencies.seam?.afterMaskChildPublished,
            afterDescriptorPublished:
              this.dependencies.seam?.afterMaskDescriptorPublished,
          });
        publishedMaskChild = published;
        await this.dependencies.seam?.afterMaskChildStartPublishedBeforeRootVerification?.();
        const verifiedPending = await verifyPendingMaskFreezeCommitRoot({
          sessionRoot: this.sessionRoot,
          sessionScope: this.sessionScope,
          lease: this.lease,
          intent: freezeIntentEvent,
          expectedMaskJournal: published.evidence.checkpoint,
        });
        const beforeCommit = verifiedPending.store.coordinatorJournal;
        await this.coordinatorJournal.append({
          expectedRevision: beforeCommit.revision,
          event: event<
            Extract<
              GrandHallT554NativeReviewCoordinatorEventV2,
              { readonly eventType: "mask.freeze-committed.v2" }
            >
          >("mask.freeze-committed.v2", {
            schemaVersion:
              "venviewer.grand-hall-t554-native-review-mask-freeze-committed.v2",
            operationIdSha256,
            browserEpochNonceSha256: scope.browserEpochNonceSha256,
            previousWorkspaceRevision: request.expectedWorkspaceRevision,
            resultingWorkspaceRevision: request.expectedWorkspaceRevision + 1,
            sourceCustody: active.sourceCustody,
            renderGeneration: allocatedRenderGeneration,
            maskState: active.maskState,
            maskReviewSubjectSha256,
            coverageSegmentIdSha256,
            frozenBindingSha256,
            frozenBinding,
            maskJournal: verifiedPending.maskJournal,
          }),
        });
        await this.#assertOwnerIncludingRecoveryRequired();
        await this.dependencies.seam?.afterMaskFreezeCommitDurable?.();
        this.#recoveryRequired = false;
        await this.#refreshStore();
        this.#runtime = {
          ...priorRuntime,
          maskStore: rehydrated.store,
          maskContext: rehydrated.context,
          maskChild: publishedMaskChild,
        };
        runtimeTransferred = true;
        result = this.#snapshotVerified();
      } catch (error) {
        operationError = error;
      }
      const cleanupErrors: unknown[] = [];
      if (prepared !== undefined) {
        try {
          safelyDiscardPrepared(prepared);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (runtimeTransferred) {
        try {
          priorRuntime.maskStore.abandon();
        } catch (error) {
          cleanupErrors.push(error);
        }
      } else {
        try {
          rehydrated.store.abandon();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (operationError !== undefined) {
        if (cleanupErrors.length !== 0) {
          throw fail(
            "RESOURCE_CLEANUP_FAILED",
            "Mask freeze cleanup failed after operation error.",
            { operationError, cleanupError: cleanupErrors[0] },
          );
        }
        if (intentDurable) {
          throw fail(
            "CRASH_RECOVERY_REQUIRED",
            "Durable mask freeze intent requires exact disk recovery.",
            operationError,
          );
        }
        throw mapMaskStoreError(operationError);
      }
      if (cleanupErrors.length !== 0) {
        throw fail(
          "RESOURCE_CLEANUP_FAILED",
          "Mask freeze cleanup failed.",
          cleanupErrors[0],
        );
      }
      if (result === undefined) {
        throw fail(
          "INTERNAL_INVARIANT_FAILED",
          "Mask freeze produced no verified snapshot.",
        );
      }
      return result;
    });
  }

  prepareMaskTile(
    input: MaskRenderBindingV2 & {
      readonly column: number;
      readonly row: number;
    },
  ): Promise<GrandHallT554NativeReviewMaskTileV2> {
    return this.#lane.run(async () => {
      const request = parseInput(MaskTileInputSchema, input);
      await this.#assertOwner();
      this.#assertMutableLifecycle();
      const { runtime } = this.#assertRenderBinding(request);
      let sourceRgb8: Buffer | undefined;
      let mask8: Buffer | undefined;
      let reason8: Buffer | undefined;
      try {
        sourceRgb8 = runtime.epoch.copyTile({
          sourceEpochNonce: runtime.sourceEpochNonce,
          renderGeneration: runtime.epochSnapshot.renderGeneration,
          column: request.column,
          row: request.row,
        });
        mask8 = runtime.maskStore.copyMaskTileForServerRender(
          request.column,
          request.row,
        );
        reason8 = runtime.maskStore.copyReasonTileForServerRender(
          request.column,
          request.row,
        );
        if (
          sourceRgb8.length !== GRAND_HALL_T554_NATIVE_RGB8_TILE_BYTE_LENGTH ||
          mask8.length !== MASK_PLANE_TILE_BYTE_LENGTH ||
          reason8.length !== MASK_PLANE_TILE_BYTE_LENGTH
        ) {
          throw fail(
            "RESOURCE_FAILURE",
            "Prepared mask render planes have an unexpected byte length.",
          );
        }
      } catch (error) {
        sourceRgb8?.fill(0);
        mask8?.fill(0);
        reason8?.fill(0);
        throw mapMaskStoreError(error);
      }
      const pending: PendingMaskTileV2 = {
        resolved: false,
        sourceRgb8,
        mask8,
        reason8,
        sourceRgb8Sha256: sha256(sourceRgb8),
        mask8Sha256: sha256(mask8),
        reason8Sha256: sha256(reason8),
      };
      this.#pendingTiles.add(pending);
      return Object.freeze({
        schemaVersion: MASK_TILE_SCHEMA,
        renderMode: "source_rgb8_mask8_reason8" as const,
        widthPx: GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
        heightPx: GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
        sourceRgb8,
        mask8,
        reason8,
        commitDeliveryAfterSuccessfulSend: async () => {
          await this.#lane.run(async () => {
            if (pending.resolved) {
              throw fail(
                "DELIVERY_ALREADY_RESOLVED",
                "Prepared mask tile was already committed or discarded.",
              );
            }
            try {
              await this.#assertOwner();
              const binding = this.#assertRenderBinding(request);
              if (binding.runtime !== runtime) {
                throw fail(
                  "BINDING_STALE",
                  "Prepared tile belongs to a replaced mask runtime.",
                );
              }
              if (
                sha256(pending.sourceRgb8) !== pending.sourceRgb8Sha256 ||
                sha256(pending.mask8) !== pending.mask8Sha256 ||
                sha256(pending.reason8) !== pending.reason8Sha256
              ) {
                throw fail(
                  "RENDER_TILE_MUTATED",
                  "Prepared source, mask, or reason bytes changed before acknowledgement.",
                );
              }
              if (binding.active.phase === "mask_review") {
                const child = runtime.maskChild;
                if (child === null) {
                  throw fail(
                    "INTERNAL_INVARIANT_FAILED",
                    "Mask review has no process-local durable child.",
                  );
                }
                const tileIndex =
                  request.row * GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT +
                  request.column;
                const replay = replayGrandHallT554NativeReviewMaskChildV2(
                  child.evidence,
                );
                if (
                  !canonicalTileBitmapContains(
                    replay.coverage.deliveredTileBitsetHex,
                    tileIndex,
                  )
                ) {
                  try {
                    await this.dependencies.seam?.beforeMaskTileDeliveryAppend?.();
                    const evidence =
                      await child.journal.appendChildWithEvidence({
                        expectedRevision: child.evidence.checkpoint.revision,
                        event: {
                          schemaVersion:
                            GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
                          eventType: "mask.tile-delivered.v2",
                          payload: {
                            schemaVersion:
                              "venviewer.grand-hall-t554-native-review-tile-delivered.v2",
                            browserEpochNonceSha256:
                              child.scope.browserEpochNonceSha256,
                            sourceEpochNonceSha256:
                              child.scope.sourceCustody.sourceEpochNonceSha256,
                            coverageSegmentIdSha256:
                              child.scope.coverageSegmentIdSha256,
                            subjectSha256: child.scope.maskReviewSubjectSha256,
                            renderGeneration: child.scope.renderGeneration,
                            column: request.column,
                            row: request.row,
                            tileIndex,
                            responseFinishedAtUtc: this.dependencies.nowUtc(),
                          },
                        },
                      });
                    await this.dependencies.seam?.afterMaskTileDeliveryAppendDurable?.();
                    if (evidence.kind !== "mask") {
                      throw fail(
                        "INTERNAL_INVARIANT_FAILED",
                        "Mask tile delivery changed durable child kind.",
                      );
                    }
                    runtime.maskChild = { ...child, evidence };
                  } catch (error) {
                    this.#recoveryRequired = true;
                    throw fail(
                      "CRASH_RECOVERY_REQUIRED",
                      "Mask tile delivery durability is ambiguous after successful send.",
                      error,
                    );
                  }
                }
                await this.#assertOwner();
              }
            } finally {
              zeroPendingMaskTile(pending);
              this.#pendingTiles.delete(pending);
            }
          });
        },
        discardAfterFailedSend: async () => {
          await this.#lane.run(() => {
            if (pending.resolved) {
              throw fail(
                "DELIVERY_ALREADY_RESOLVED",
                "Prepared mask tile was already committed or discarded.",
              );
            }
            zeroPendingMaskTile(pending);
            this.#pendingTiles.delete(pending);
          });
        },
      });
    });
  }

  recordMaskCoverage(
    input: MaskRenderBindingV2 & {
      readonly documentVisibilityState: "visible" | "hidden" | "prerender";
      readonly documentFocusState: "focused" | "blurred";
      readonly viewportCssWidth: number;
      readonly viewportCssHeight: number;
      readonly devicePixelRatio: number;
      readonly sourceToCssTransform: {
        readonly a: number;
        readonly b: 0;
        readonly c: 0;
        readonly d: number;
        readonly e: number;
        readonly f: number;
      };
      readonly paintedTileBitsetHex: string;
    },
  ): Promise<GrandHallT554NativeReviewMaskCoverageAcknowledgementV2> {
    return this.#lane.run(async () => {
      const request = parseInput(MaskCoverageInputSchema, input);
      await this.#assertOwner();
      this.#assertMutableLifecycle();
      const { active, runtime } = this.#assertRenderBinding(request);
      if (active.phase !== "mask_review" || runtime.maskChild === null) {
        throw fail(
          "PHASE_INVALID",
          "Mask coverage applies only to the same-process frozen mask review.",
        );
      }
      const child = runtime.maskChild;
      let planned: GrandHallT554NativeReviewPlannedMaskCoverageEventV2;
      try {
        planned = planGrandHallT554NativeReviewNextMaskCoverageEventV2({
          scope: child.scope,
          events: child.evidence.events,
          observation: {
            schemaVersion:
              "venviewer.grand-hall-t554-native-review-mask-coverage-observation-input.v2",
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
      } catch (error) {
        throw mapMaskStoreError(error);
      }
      let evidence;
      try {
        await this.dependencies.seam?.beforeMaskCoverageAppend?.();
        evidence = await child.journal.appendChildWithEvidence({
          expectedRevision: child.evidence.checkpoint.revision,
          event: planned,
        });
        await this.dependencies.seam?.afterMaskCoverageAppendDurable?.();
      } catch (error) {
        this.#recoveryRequired = true;
        throw fail(
          "CRASH_RECOVERY_REQUIRED",
          "Mask coverage durability is ambiguous and requires exact disk recovery.",
          error,
        );
      }
      if (evidence.kind !== "mask") {
        throw fail(
          "INTERNAL_INVARIANT_FAILED",
          "Mask coverage changed durable child kind.",
        );
      }
      runtime.maskChild = { ...child, evidence };
      await this.#assertOwner();
      const coverage =
        replayGrandHallT554NativeReviewMaskChildV2(evidence).coverage;
      return Object.freeze({
        schemaVersion: MASK_COVERAGE_ACK_SCHEMA,
        sequence: planned.payload.sequence,
        journalRevision: evidence.checkpoint.revision,
        deliveredTileCount: coverage.uniqueDeliveredTileCount,
        completedTileCount: coverage.completedTileCount,
        complete: coverage.complete,
      });
    });
  }

  close(): Promise<void> {
    return this.#lane.run(async () => {
      if (this.#closed) return;
      const errors: unknown[] = [];
      for (const pending of this.#pendingTiles) {
        zeroPendingMaskTile(pending);
      }
      this.#pendingTiles.clear();
      try {
        await this.#assertOwnerIncludingRecoveryRequired();
      } catch (error) {
        errors.push(error);
      }
      const runtime = this.#runtime;
      this.#runtime = null;
      if (runtime !== null) {
        try {
          runtime.maskStore.abandon();
        } catch (error) {
          errors.push(error);
        }
        try {
          await runtime.epoch.abandon();
        } catch (error) {
          errors.push(error);
        }
      }
      let released = false;
      try {
        await releaseGrandHallT554NativeReviewSessionOwnerV2({
          lease: this.lease,
          sessionRoot: this.sessionRoot,
          expectedSessionScope: this.sessionScope,
        });
        released = true;
      } catch (error) {
        errors.push(error);
      }
      this.#closed = released;
      if (errors.length !== 0) {
        throw fail(
          "RESOURCE_CLEANUP_FAILED",
          "Mask workflow close encountered one or more fail-closed cleanup errors.",
          errors,
        );
      }
    });
  }
}

function exactPendingMaskFreeze(
  replay: GrandHallT554NativeReviewDurableJournalReplayV2,
  sessionScope: GrandHallT554NativeReviewSessionScopeV2,
): {
  readonly coordinator: ReturnType<
    typeof replayGrandHallT554NativeReviewCoordinatorV2
  >;
  readonly intent: MaskFreezeIntendedEvent;
} | null {
  const coordinator = replayGrandHallT554NativeReviewCoordinatorV2({
    scope: sessionScope,
    events: coordinatorEvents(replay.events),
  });
  if (coordinator.pendingIntent === null) return null;
  if (coordinator.pendingIntent.kind !== "mask_freeze") {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Mask-workflow facade cannot resolve a source or coverage-resume intent.",
    );
  }
  const found = findExactPendingCoordinatorIntentEventV2(
    replay,
    coordinator.pendingIntent,
  );
  if (found?.eventType !== "mask.freeze-intended.v2") {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Pending mask freeze cannot be resolved to its exact durable intent.",
    );
  }
  return { coordinator, intent: found };
}

async function verifyPendingMaskFreezeCommitRoot(input: {
  readonly sessionRoot: string;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly intent: MaskFreezeIntendedEvent;
  readonly expectedMaskJournal: GrandHallT554NativeReviewMaskChildCheckpointV2;
}): Promise<{
  readonly store: GrandHallT554NativeReviewSessionStoreReplayV2;
  readonly maskJournal: GrandHallT554NativeReviewMaskChildCheckpointV2;
}> {
  await assertGrandHallT554NativeReviewSessionOwnerV2({
    lease: input.lease,
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
  });
  const store = await openGrandHallT554NativeReviewSessionStoreV2({
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
    lease: input.lease,
  });
  const pending = store.coordinator.pendingIntent;
  const payload = input.intent.payload;
  if (
    pending?.kind !== "mask_freeze" ||
    pending.operationIdSha256 !== payload.operationIdSha256 ||
    pending.childJournalLeafName !== payload.childJournalLeafName ||
    pending.allocatedRenderGeneration !== payload.allocatedRenderGeneration
  ) {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Full-root verification found a different pending mask freeze.",
    );
  }
  const obligation = store.coordinator.childObligations.find(
    (candidate) => candidate.leafName === payload.childJournalLeafName,
  );
  const matchingChildren = store.children.filter(
    (candidate) => candidate.leafName === payload.childJournalLeafName,
  );
  const child = matchingChildren[0];
  if (
    obligation?.kind !== "mask" ||
    obligation.operationIdSha256 !== payload.operationIdSha256 ||
    obligation.declarationKind !== "mask_freeze" ||
    obligation.disposition !== "pending" ||
    matchingChildren.length !== 1 ||
    child?.evidence.kind !== "mask" ||
    child.evidence.checkpoint.revision !== 1 ||
    !canonicalEqual(child.evidence.checkpoint, input.expectedMaskJournal)
  ) {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Pending mask freeze child, descriptor, or revision-one evidence is not exact.",
    );
  }
  await assertGrandHallT554NativeReviewSessionOwnerV2({
    lease: input.lease,
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
  });
  return { store, maskJournal: child.evidence.checkpoint };
}

async function appendRecoveredFreezeCommit(input: {
  readonly sessionRoot: string;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly coordinatorJournal: GrandHallT554NativeReviewDurableJournalV2;
  readonly intent: MaskFreezeIntendedEvent;
  readonly frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2;
  readonly maskJournal: GrandHallT554NativeReviewMaskChildCheckpointV2;
}): Promise<void> {
  await assertGrandHallT554NativeReviewSessionOwnerV2({
    lease: input.lease,
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
  });
  const beforeCommit = await input.coordinatorJournal.replay();
  const pending = exactPendingMaskFreeze(beforeCommit, input.sessionScope);
  if (
    pending === null ||
    pending.intent.payload.operationIdSha256 !==
      input.intent.payload.operationIdSha256
  ) {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Mask freeze changed before recovered commit CAS.",
    );
  }
  const payload = input.intent.payload;
  await input.coordinatorJournal.append({
    expectedRevision: beforeCommit.revision,
    event: event<
      Extract<
        GrandHallT554NativeReviewCoordinatorEventV2,
        { readonly eventType: "mask.freeze-committed.v2" }
      >
    >("mask.freeze-committed.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-freeze-committed.v2",
      operationIdSha256: payload.operationIdSha256,
      browserEpochNonceSha256: payload.browserEpochNonceSha256,
      previousWorkspaceRevision: payload.expectedWorkspaceRevision,
      resultingWorkspaceRevision: payload.expectedWorkspaceRevision + 1,
      sourceCustody: payload.sourceCustody,
      renderGeneration: payload.allocatedRenderGeneration,
      maskState: payload.maskState,
      maskReviewSubjectSha256: payload.maskReviewSubjectSha256,
      coverageSegmentIdSha256: payload.coverageSegmentIdSha256,
      frozenBindingSha256:
        computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256(
          input.frozenBinding,
        ),
      frozenBinding: input.frozenBinding,
      maskJournal: input.maskJournal,
    }),
  });
  await assertGrandHallT554NativeReviewSessionOwnerV2({
    lease: input.lease,
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
  });
}

async function appendFreezeRecoveryAbort(input: {
  readonly sessionRoot: string;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly coordinatorJournal: GrandHallT554NativeReviewDurableJournalV2;
  readonly intent: MaskFreezeIntendedEvent;
  readonly publicationDisposition:
    | "none"
    | "mask_only"
    | "reason_map_only"
    | "mask_and_reason_map";
  readonly abandonedMaskJournal: GrandHallT554NativeReviewMaskChildCheckpointV2 | null;
  readonly dependencies: MaskWorkflowSessionDependenciesV2;
}): Promise<void> {
  await assertGrandHallT554NativeReviewSessionOwnerV2({
    lease: input.lease,
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
  });
  const beforeAbort = await input.coordinatorJournal.replay();
  const pending = exactPendingMaskFreeze(beforeAbort, input.sessionScope);
  if (
    pending === null ||
    pending.intent.payload.operationIdSha256 !==
      input.intent.payload.operationIdSha256
  ) {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Mask freeze changed before recovery-abort CAS.",
    );
  }
  const browser = pending.coordinator.browserEpoch;
  if (browser === null) {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Pending mask freeze recovery-abort has no browser epoch.",
    );
  }
  await input.coordinatorJournal.append({
    expectedRevision: beforeAbort.revision,
    event: event<
      Extract<
        GrandHallT554NativeReviewCoordinatorEventV2,
        { readonly eventType: "mask.freeze-recovery-aborted.v2" }
      >
    >("mask.freeze-recovery-aborted.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-freeze-recovery-aborted.v2",
      operationIdSha256: input.intent.payload.operationIdSha256,
      browserEpochNonceSha256: browser.nonceSha256,
      workspaceRevision: pending.coordinator.workspaceRevision,
      consumedRenderGeneration: input.intent.payload.allocatedRenderGeneration,
      publicationDisposition: input.publicationDisposition,
      abandonedMaskJournal: input.abandonedMaskJournal,
    }),
  });
  await assertGrandHallT554NativeReviewSessionOwnerV2({
    lease: input.lease,
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
  });
  await input.dependencies.seam?.afterMaskFreezeRecoveryAbortDurable?.();
}

async function recoverPendingMaskFreeze(input: {
  readonly sessionRoot: string;
  readonly preparationDirectory: string;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly coordinatorJournal: GrandHallT554NativeReviewDurableJournalV2;
  readonly dependencies: MaskWorkflowSessionDependenciesV2;
}): Promise<void> {
  await assertGrandHallT554NativeReviewSessionOwnerV2({
    lease: input.lease,
    sessionRoot: input.sessionRoot,
    expectedSessionScope: input.sessionScope,
  });
  const replay = await input.coordinatorJournal.replay();
  const pending = exactPendingMaskFreeze(replay, input.sessionScope);
  if (pending === null) return;
  const active = pending.coordinator.activeSource;
  if (
    active === null ||
    active.phase !== "mask_edit" ||
    active.maskState === null ||
    !canonicalEqual(active.maskState, pending.intent.payload.maskState)
  ) {
    throw fail(
      "CRASH_RECOVERY_REQUIRED",
      "Pending mask freeze is detached from its exact editable mask state.",
    );
  }
  const payload = pending.intent.payload;
  const rehydrated = rehydrateMaskStore({
    sessionRoot: input.sessionRoot,
    preparationDirectory: input.preparationDirectory,
    sessionScope: input.sessionScope,
    sourceCustody: payload.sourceCustody,
    expectedMaskState: payload.maskState,
    events: coordinatorEvents(replay.events),
    dependencies: input.dependencies,
  });
  let prepared: GrandHallT554NativeMaskPreparedFreezeV2 | undefined;
  let operationError: unknown;
  try {
    recovery: {
      prepared = await rehydrated.store.prepareFreeze({
        expectedRevision: payload.maskState.revision,
        operationIdSha256: payload.operationIdSha256,
      });
      assertPreparedMatchesState(
        prepared.binding,
        payload.sourceCustody,
        payload.maskState,
      );
      if (
        !canonicalEqual(prepared.binding, payload.preparedBinding) ||
        computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256(
          prepared.binding,
        ) !== payload.preparedBindingSha256
      ) {
        throw fail(
          "CRASH_RECOVERY_REQUIRED",
          "Regenerated mask bytes differ from the exact durable freeze intent.",
        );
      }
      const expectedSubject =
        computeGrandHallT554NativeReviewMaskSubjectV2Sha256({
          sourceReviewSubjectSha256:
            payload.sourceCustody.sourceReviewSubjectSha256,
          maskStateSha256: payload.maskState.maskStateSha256,
          maskEvidenceSha256:
            computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(
              prepared.binding,
            ),
          implementationManifest: input.sessionScope.implementationManifest,
        });
      if (expectedSubject !== payload.maskReviewSubjectSha256) {
        throw fail(
          "CRASH_RECOVERY_REQUIRED",
          "Regenerated mask subject differs from the exact durable freeze intent.",
        );
      }
      const publicationDisposition = await prepared.inspectPublication();
      const childPath = join(
        input.sessionRoot,
        "children",
        payload.childJournalLeafName,
      );
      const descriptorPath = join(
        input.sessionRoot,
        "child-scopes",
        `${payload.childJournalLeafName}.json`,
      );
      const childKind = await directKind(childPath);
      const descriptorKind = await directKind(descriptorPath);
      const hasAnyChildCustody =
        childKind !== "absent" || descriptorKind !== "absent";
      const currentBrowser = pending.coordinator.browserEpoch;
      if (currentBrowser === null) {
        throw fail(
          "CRASH_RECOVERY_REQUIRED",
          "Pending mask freeze has no current browser epoch.",
        );
      }
      const sameBrowser =
        currentBrowser.nonceSha256 === payload.browserEpochNonceSha256;
      const partial =
        publicationDisposition === "mask_only" ||
        publicationDisposition === "reason_map_only";
      if (
        (partial || publicationDisposition === "none") &&
        hasAnyChildCustody
      ) {
        throw fail(
          "CRASH_RECOVERY_REQUIRED",
          "Mask child custody exists without a complete exact publication pair.",
        );
      }
      if (!hasAnyChildCustody) {
        await openGrandHallT554NativeReviewSessionStoreV2({
          sessionRoot: input.sessionRoot,
          expectedSessionScope: input.sessionScope,
          lease: input.lease,
        });
      }
      if (partial || (!sameBrowser && publicationDisposition === "none")) {
        safelyDiscardPrepared(prepared);
        prepared = undefined;
        await appendFreezeRecoveryAbort({
          sessionRoot: input.sessionRoot,
          sessionScope: input.sessionScope,
          lease: input.lease,
          coordinatorJournal: input.coordinatorJournal,
          intent: pending.intent,
          publicationDisposition,
          abandonedMaskJournal: null,
          dependencies: input.dependencies,
        });
        break recovery;
      }

      const frozenBinding =
        GrandHallT554NativeReviewFrozenMaskBindingV2Schema.parse(
          await prepared.publishOrVerifyExact(),
        );
      prepared = undefined;
      if (
        computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256(
          frozenBinding,
        ) !==
        computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(
          payload.preparedBinding,
        )
      ) {
        throw fail(
          "CRASH_RECOVERY_REQUIRED",
          "Recovered frozen evidence differs from its prepared intent.",
        );
      }
      const frozenBindingSha256 =
        computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256(
          frozenBinding,
        );
      const scope = maskScope({
        sessionScope: input.sessionScope,
        browserEpochNonceSha256: payload.browserEpochNonceSha256,
        coverageSegmentIdSha256: payload.coverageSegmentIdSha256,
        renderGeneration: payload.allocatedRenderGeneration,
        sourceCustody: payload.sourceCustody,
        maskReviewSubjectSha256: payload.maskReviewSubjectSha256,
        maskStateSha256: payload.maskState.maskStateSha256,
        frozenBindingSha256,
        frozenBinding,
      });
      let reconciled = await reconcileGrandHallT554NativeReviewMaskChildStartV2(
        {
          sessionRoot: input.sessionRoot,
          scope,
          leafName: payload.childJournalLeafName,
          descriptorStageIdentitySha256: payload.operationIdSha256,
          afterDescriptorPublished:
            input.dependencies.seam?.afterMaskDescriptorPublished,
        },
      );
      const verifiedPendingStore =
        await openGrandHallT554NativeReviewSessionStoreV2({
          sessionRoot: input.sessionRoot,
          expectedSessionScope: input.sessionScope,
          lease: input.lease,
        });
      if (!sameBrowser) {
        await appendFreezeRecoveryAbort({
          sessionRoot: input.sessionRoot,
          sessionScope: input.sessionScope,
          lease: input.lease,
          coordinatorJournal: input.coordinatorJournal,
          intent: pending.intent,
          publicationDisposition: "mask_and_reason_map",
          abandonedMaskJournal:
            reconciled.disposition === "exact"
              ? reconciled.evidence.checkpoint
              : null,
          dependencies: input.dependencies,
        });
        break recovery;
      }
      if (reconciled.disposition === "absent") {
        const sourceEvidence =
          latestVerifiedActiveSourceEvidenceV2(verifiedPendingStore);
        if (sourceEvidence === null) {
          throw fail(
            "CRASH_RECOVERY_REQUIRED",
            "Recovered mask freeze lost exact source-child evidence.",
          );
        }
        const published =
          await publishGrandHallT554NativeReviewMaskChildStartV2({
            sessionRoot: input.sessionRoot,
            scope,
            leafName: payload.childJournalLeafName,
            startedAtUtc: laterUtc(
              finalRecordedAtUtc(replay),
              sourceEvidence.finalDurableRecordedAtUtc,
            ),
            predecessorCoverage: null,
            stageIdentitySha256: payload.operationIdSha256,
            afterChildPublished:
              input.dependencies.seam?.afterMaskChildPublished,
            afterDescriptorPublished:
              input.dependencies.seam?.afterMaskDescriptorPublished,
          });
        reconciled = { disposition: "exact", ...published };
      }
      const verifiedCommitRoot = await verifyPendingMaskFreezeCommitRoot({
        sessionRoot: input.sessionRoot,
        sessionScope: input.sessionScope,
        lease: input.lease,
        intent: pending.intent,
        expectedMaskJournal: reconciled.evidence.checkpoint,
      });
      await appendRecoveredFreezeCommit({
        sessionRoot: input.sessionRoot,
        sessionScope: input.sessionScope,
        lease: input.lease,
        coordinatorJournal: input.coordinatorJournal,
        intent: pending.intent,
        frozenBinding,
        maskJournal: verifiedCommitRoot.maskJournal,
      });
    }
  } catch (error) {
    operationError = error;
  }
  const cleanupErrors: unknown[] = [];
  if (prepared !== undefined) {
    try {
      safelyDiscardPrepared(prepared);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    rehydrated.store.abandon();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (operationError !== undefined) {
    if (cleanupErrors.length !== 0) {
      throw fail(
        "RESOURCE_CLEANUP_FAILED",
        "Recovered mask freeze cleanup also failed.",
        { operationError, cleanupError: cleanupErrors[0] },
      );
    }
    throw mapMaskRecoveryError(operationError);
  }
  if (cleanupErrors.length !== 0) {
    throw fail(
      "RESOURCE_CLEANUP_FAILED",
      "Recovered mask freeze cleanup failed.",
      cleanupErrors[0],
    );
  }
}

async function resumeMaskEditEpochAfterBrowserRotation(input: {
  readonly sessionRoot: string;
  readonly sessionScope: GrandHallT554NativeReviewSessionScopeV2;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
  readonly coordinatorJournal: GrandHallT554NativeReviewDurableJournalV2;
  readonly store: GrandHallT554NativeReviewSessionStoreReplayV2;
  readonly preparationDirectory: string;
  readonly dependencies: MaskWorkflowSessionDependenciesV2;
}): Promise<{
  readonly store: GrandHallT554NativeReviewSessionStoreReplayV2;
  readonly runtime: ActiveMaskWorkflowRuntimeV2;
}> {
  const coordinator = input.store.coordinator;
  const active = coordinator.activeSource;
  const browser = coordinator.browserEpoch;
  if (active === null || active.phase !== "mask_edit" || browser === null) {
    throw fail(
      "INTERNAL_INVARIANT_FAILED",
      "Mask-edit epoch resume requires an active mask and rotated browser epoch.",
    );
  }
  if (
    coordinator.workspaceRevision === Number.MAX_SAFE_INTEGER ||
    coordinator.maximumAllocatedRenderGeneration === Number.MAX_SAFE_INTEGER
  ) {
    throw fail(
      "RESOURCE_FAILURE",
      "Mask-edit epoch resume exhausted its durable CAS range.",
    );
  }
  const resultingRenderGeneration =
    coordinator.maximumAllocatedRenderGeneration + 1;
  const sourceEpochNonce = parseInput(
    NonceSchema,
    input.dependencies.newNonce(),
  );
  const preparedEpoch = await prepareMaskResumeEpoch({
    active,
    sourceEpochNonce,
    renderGeneration: resultingRenderGeneration,
    dependencies: input.dependencies,
  });
  let rehydrated: RehydratedMaskStoreV2 | undefined;
  let transferred = false;
  try {
    const operationIdSha256 = nonceSha256(
      parseInput(NonceSchema, input.dependencies.newNonce()),
    );
    await assertGrandHallT554NativeReviewSessionOwnerV2({
      lease: input.lease,
      sessionRoot: input.sessionRoot,
      expectedSessionScope: input.sessionScope,
    });
    const replay = await input.coordinatorJournal.replay();
    await input.coordinatorJournal.append({
      expectedRevision: replay.revision,
      event: event<
        Extract<
          GrandHallT554NativeReviewCoordinatorEventV2,
          { readonly eventType: "mask.edit-epoch-resumed.v2" }
        >
      >("mask.edit-epoch-resumed.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-mask-edit-epoch-resumed.v2",
        operationIdSha256,
        browserEpochNonceSha256: browser.nonceSha256,
        previousWorkspaceRevision: coordinator.workspaceRevision,
        resultingWorkspaceRevision: coordinator.workspaceRevision + 1,
        previousVisibleRenderGeneration: active.renderGeneration,
        previousMaximumAllocatedRenderGeneration:
          coordinator.maximumAllocatedRenderGeneration,
        resultingRenderGeneration,
        sourceCustodyBefore: active.sourceCustody,
        sourceCustody: preparedEpoch.custody,
      }),
    });
    await assertGrandHallT554NativeReviewSessionOwnerV2({
      lease: input.lease,
      sessionRoot: input.sessionRoot,
      expectedSessionScope: input.sessionScope,
    });
    const store = await openGrandHallT554NativeReviewSessionStoreV2({
      sessionRoot: input.sessionRoot,
      expectedSessionScope: input.sessionScope,
      lease: input.lease,
    });
    const resumedActive = store.coordinator.activeSource;
    if (
      resumedActive === null ||
      resumedActive.phase !== "mask_edit" ||
      resumedActive.maskState === null ||
      !canonicalEqual(resumedActive.sourceCustody, preparedEpoch.custody)
    ) {
      throw fail(
        "INTERNAL_INVARIANT_FAILED",
        "Mask-edit resume did not activate its exact retained source epoch.",
      );
    }
    rehydrated = rehydrateMaskStore({
      sessionRoot: input.sessionRoot,
      preparationDirectory: input.preparationDirectory,
      sessionScope: input.sessionScope,
      sourceCustody: resumedActive.sourceCustody,
      expectedMaskState: resumedActive.maskState,
      events: coordinatorEvents(store.coordinatorJournal.events),
      dependencies: input.dependencies,
    });
    const runtime: ActiveMaskWorkflowRuntimeV2 = {
      epoch: preparedEpoch.epoch,
      epochBindings: preparedEpoch.bindings,
      epochSnapshot: preparedEpoch.snapshot,
      sourceEpochNonce,
      maskStore: rehydrated.store,
      maskContext: rehydrated.context,
      maskChild: null,
    };
    transferred = true;
    return { store, runtime };
  } catch (operationError) {
    const cleanupErrors: unknown[] = [];
    if (!transferred) {
      try {
        rehydrated?.store.abandon();
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await preparedEpoch.epoch.abandon();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length !== 0) {
      throw fail(
        "RESOURCE_CLEANUP_FAILED",
        "Mask-edit resume cleanup failed after operation error.",
        { operationError, cleanupErrors },
      );
    }
    throw operationError;
  }
}

async function openInjectedMaskWorkflowSession(
  mode: "clean_resume" | "crash_resume",
  options: {
    readonly sessionRoot: string;
    readonly priorOwnerWitness?: GrandHallT554NativeReviewPriorOwnerWitnessV2;
  },
  dependencies: MaskWorkflowSessionDependenciesV2,
): Promise<GrandHallT554NativeReviewMaskWorkflowSessionV2> {
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
      : await explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2(
          {
            sessionRoot,
            expectedSessionScope: sessionScope,
            priorOwnerWitness:
              options.priorOwnerWitness ??
              (() => {
                throw fail(
                  "ARGUMENT_INVALID",
                  "Explicit crash takeover requires a branded prior-owner witness.",
                );
              })(),
          },
        );
  let handedOff = false;
  try {
    const preparationDirectory = preparationDirectoryFor(
      sessionRoot,
      sessionScope.sessionIdSha256,
    );
    await ensurePreparationDirectory(preparationDirectory);
    const coordinatorJournal =
      await openGrandHallT554NativeReviewDurableJournalV2({
        workspaceRoot: join(sessionRoot, "coordinator"),
        expectedScope: sessionScope,
      });
    await recoverPendingMaskFreeze({
      sessionRoot,
      preparationDirectory,
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
      throw fail(
        "SESSION_STOPPED",
        "Stopped native-review session cannot enter mask workflow.",
      );
    }
    if (store.coordinator.lifecycle !== "active") {
      throw fail(
        "SESSION_POISONED",
        "Poisoned native-review session cannot reopen.",
      );
    }
    const active = store.coordinator.activeSource;
    if (
      active === null ||
      (active.phase !== "source_review" &&
        active.phase !== "mask_edit" &&
        active.phase !== "mask_review")
    ) {
      throw fail(
        "PHASE_INVALID",
        "Mask-workflow facade requires source review, mask edit, or mask review.",
      );
    }
    if (active.phase === "mask_review") {
      throw fail(
        "PHASE_INVALID",
        "Mask review cannot reopen until its durable mask-coverage resume transaction exists.",
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
    });
    let runtime: ActiveMaskWorkflowRuntimeV2 | null = null;
    if (store.coordinator.activeSource?.phase === "mask_edit") {
      const resumed = await resumeMaskEditEpochAfterBrowserRotation({
        sessionRoot,
        sessionScope,
        lease,
        coordinatorJournal,
        store,
        preparationDirectory,
        dependencies,
      });
      store = resumed.store;
      runtime = resumed.runtime;
    }
    const controller =
      new GrandHallT554NativeReviewMaskWorkflowSessionControllerV2(
        sessionRoot,
        preparationDirectory,
        sessionScope,
        dependencies,
        lease,
        coordinatorJournal,
        store,
        runtime,
      );
    handedOff = true;
    return controller;
  } finally {
    if (!handedOff) {
      await releaseGrandHallT554NativeReviewSessionOwnerV2({
        lease,
        sessionRoot,
        expectedSessionScope: sessionScope,
      });
    }
  }
}

export async function openGrandHallT554NativeReviewMaskWorkflowSessionV2(
  options: GrandHallT554NativeReviewSourceSessionProductionOptionsV2,
): Promise<GrandHallT554NativeReviewMaskWorkflowSessionV2> {
  return await openInjectedMaskWorkflowSession(
    "clean_resume",
    { sessionRoot: options.sessionRoot },
    productionDependencies(options),
  );
}

export async function takeOverGrandHallT554NativeReviewMaskWorkflowSessionAfterCrashV2(
  options: GrandHallT554NativeReviewSourceSessionTakeoverOptionsV2,
): Promise<GrandHallT554NativeReviewMaskWorkflowSessionV2> {
  return await openInjectedMaskWorkflowSession(
    "crash_resume",
    {
      sessionRoot: options.sessionRoot,
      priorOwnerWitness: options.priorOwnerWitness,
    },
    productionDependencies(options),
  );
}

export const __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2 =
  /* @__PURE__ */ Object.freeze({
    open: (
      options: { readonly sessionRoot: string },
      dependencies: MaskWorkflowSessionDependenciesV2,
    ) => openInjectedMaskWorkflowSession("clean_resume", options, dependencies),
    takeOver: (
      options: {
        readonly sessionRoot: string;
        readonly priorOwnerWitness: GrandHallT554NativeReviewPriorOwnerWitnessV2;
      },
      dependencies: MaskWorkflowSessionDependenciesV2,
    ) => openInjectedMaskWorkflowSession("crash_resume", options, dependencies),
  });

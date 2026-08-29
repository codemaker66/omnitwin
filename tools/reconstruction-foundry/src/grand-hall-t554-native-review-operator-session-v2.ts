import { z } from "zod";

import { GrandHallT554NativeReviewMaskEditV2Schema } from "./grand-hall-t554-native-review-events-v2.js";
import {
  GrandHallT554NativeReviewMaskWorkflowSessionV2Error,
  openGrandHallT554NativeReviewMaskWorkflowSessionV2,
  takeOverGrandHallT554NativeReviewMaskWorkflowSessionAfterCrashV2,
  type GrandHallT554NativeReviewMaskTileV2,
  type GrandHallT554NativeReviewMaskWorkflowSessionV2,
  type GrandHallT554NativeReviewMaskWorkflowSnapshotV2,
} from "./grand-hall-t554-native-review-mask-workflow-session-v2.js";
import {
  GrandHallT554NativeReviewSourceSessionV2Error,
  createGrandHallT554NativeReviewSourceSessionV2,
  openGrandHallT554NativeReviewSourceSessionV2,
  type GrandHallT554NativeReviewSourceSessionProductionOptionsV2,
  type GrandHallT554NativeReviewSourceSessionTakeoverOptionsV2,
  type GrandHallT554NativeReviewSourceSessionV2,
  type GrandHallT554NativeReviewSourceSessionSnapshotV2,
  type GrandHallT554NativeReviewSourceTileV2,
} from "./grand-hall-t554-native-review-source-session-v2.js";

const OPERATOR_SNAPSHOT_SCHEMA =
  "venviewer.grand-hall-t554-native-review-operator-session.v2";
const SOURCE_TILE_RESPONSE_SCHEMA =
  "venviewer.grand-hall-t554-native-review-operator-source-tile.v2";
const MASK_TILE_RESPONSE_SCHEMA =
  "venviewer.grand-hall-t554-native-review-operator-mask-tile.v2";
const SOURCE_COVERAGE_ACK_RESPONSE_SCHEMA =
  "venviewer.grand-hall-t554-native-review-operator-source-coverage-ack.v2";
const MASK_COVERAGE_ACK_RESPONSE_SCHEMA =
  "venviewer.grand-hall-t554-native-review-operator-mask-coverage-ack.v2";
const TILE_COLUMN_COUNT = 32;
const TILE_ROW_COUNT = 16;
const TILE_COUNT = TILE_COLUMN_COUNT * TILE_ROW_COUNT;
const TILE_BITMAP_BYTE_LENGTH = TILE_COUNT / 8;
const SOURCE_COUNT = 148;

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
const BrowserEpochNumberSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const TileColumnSchema = z
  .number()
  .int()
  .min(0)
  .max(TILE_COLUMN_COUNT - 1);
const TileRowSchema = z
  .number()
  .int()
  .min(0)
  .max(TILE_ROW_COUNT - 1);
const PaintedTileSchema = z
  .object({
    column: TileColumnSchema,
    row: TileRowSchema,
  })
  .strict();
const AgentObservationSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("grand_hall_pixels_observed_human_pending"),
      proposedDisposition: z.literal("include_with_binary_pixel_mask"),
      maskAuthoringState: z.literal("required_not_authored"),
    })
    .strict(),
  z
    .object({
      state: z.literal("no_grand_hall_pixels_observed_human_pending"),
      proposedDisposition: z.literal("exclude_whole_frame"),
      maskAuthoringState: z.literal("not_required_if_human_confirms_exclusion"),
    })
    .strict(),
]);
const SourceCatalogSchema = z
  .array(
    z
      .object({
        inventoryIndex: z
          .number()
          .int()
          .min(0)
          .max(SOURCE_COUNT - 1),
        sweepNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        agentObservation: AgentObservationSchema,
      })
      .strict(),
  )
  .length(SOURCE_COUNT)
  .superRefine((sources, context) => {
    for (let index = 0; index < sources.length; index += 1) {
      if (sources[index]?.inventoryIndex !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "source catalog must use exact inventory order 0 through 147",
          path: [index, "inventoryIndex"],
        });
      }
    }
  });
const PaintedTilesSchema = z
  .array(PaintedTileSchema)
  .max(TILE_COUNT)
  .superRefine((tiles, context) => {
    const seen = new Set<number>();
    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index];
      if (tile === undefined) continue;
      const tileIndex = tile.row * TILE_COLUMN_COUNT + tile.column;
      if (seen.has(tileIndex)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "paintedTiles must not contain duplicate coordinates",
          path: [index],
        });
      }
      seen.add(tileIndex);
    }
  });
const SourceToCssTransformSchema = z
  .object({
    a: z.number().finite().positive().max(64),
    b: z.literal(0),
    c: z.literal(0),
    d: z.number().finite().positive().max(64),
    e: z.number().finite().min(-1_000_000).max(1_000_000),
    f: z.number().finite().min(-1_000_000).max(1_000_000),
  })
  .strict()
  .superRefine((matrix, context) => {
    if (Math.abs(matrix.a - matrix.d) > 1e-9) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "native review requires one uniform source scale",
        path: ["d"],
      });
    }
  });
const CoverageInputShape = {
  expectedBrowserEpochNumber: BrowserEpochNumberSchema,
  renderGeneration: RenderGenerationSchema,
  documentVisibilityState: z.enum(["visible", "hidden", "prerender"]),
  documentFocusState: z.enum(["focused", "blurred"]),
  viewportCssWidth: z.number().finite().positive().max(16_384),
  viewportCssHeight: z.number().finite().positive().max(16_384),
  devicePixelRatio: z.number().finite().min(0.25).max(8),
  sourceToCssTransform: SourceToCssTransformSchema,
  paintedTiles: PaintedTilesSchema,
};

const SelectSourceInputSchema = z
  .object({
    expectedBrowserEpochNumber: BrowserEpochNumberSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    inventoryIndex: z
      .number()
      .int()
      .min(0)
      .max(SOURCE_COUNT - 1),
  })
  .strict();
const TileInputSchema = z
  .object({
    expectedBrowserEpochNumber: BrowserEpochNumberSchema,
    renderGeneration: RenderGenerationSchema,
    column: TileColumnSchema,
    row: TileRowSchema,
  })
  .strict();
const CoverageInputSchema = z.object(CoverageInputShape).strict();
const ExpectedRevisionAndGenerationSchema = z
  .object({
    expectedBrowserEpochNumber: BrowserEpochNumberSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    renderGeneration: RenderGenerationSchema,
  })
  .strict();
const ApplyMaskEditInputSchema = z
  .object({
    expectedBrowserEpochNumber: BrowserEpochNumberSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    renderGeneration: RenderGenerationSchema,
    edit: GrandHallT554NativeReviewMaskEditV2Schema,
  })
  .strict();
const FreezeMaskInputSchema = z
  .object({
    expectedBrowserEpochNumber: BrowserEpochNumberSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    renderGeneration: RenderGenerationSchema,
    expectedMaskRevision: WorkspaceRevisionSchema,
  })
  .strict();
const ExcludeDecisionInputSchema = z
  .object({
    expectedBrowserEpochNumber: BrowserEpochNumberSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    renderGeneration: RenderGenerationSchema,
    note: z.string().trim().min(1).max(1_000),
  })
  .strict();
const IncludeDecisionInputSchema = z
  .object({
    expectedBrowserEpochNumber: BrowserEpochNumberSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    renderGeneration: RenderGenerationSchema,
    classification: z.enum(["grand_hall_core", "grand_hall_portal_threshold"]),
    note: z.string().trim().min(1).max(1_000),
  })
  .strict();
const AttestationInputSchema = z
  .object({
    expectedBrowserEpochNumber: BrowserEpochNumberSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    renderGeneration: RenderGenerationSchema,
    reviewerId: z.string().trim().min(1).max(160),
    knowledgeBasis: z.array(z.string().trim().min(1).max(240)).min(1).max(32),
  })
  .strict();
const AbandonInputSchema = z
  .object({
    expectedBrowserEpochNumber: BrowserEpochNumberSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    renderGeneration: RenderGenerationSchema,
    reason: z.enum(["operator_abandon", "source_switch", "session_stop"]),
  })
  .strict();
const StopInputSchema = z
  .object({
    expectedBrowserEpochNumber: BrowserEpochNumberSchema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
  })
  .strict();

export type GrandHallT554NativeReviewOperatorSessionV2ErrorCode =
  | "ARGUMENT_INVALID"
  | "SESSION_CLOSED"
  | "BROWSER_EPOCH_CONFLICT"
  | "WORKSPACE_REVISION_CONFLICT"
  | "RENDER_GENERATION_CONFLICT"
  | "PHASE_INVALID"
  | "SOURCE_COVERAGE_INCOMPLETE"
  | "PENDING_TILE_DELIVERY"
  | "DELIVERY_ALREADY_RESOLVED"
  | "RECOVERY_REQUIRED"
  | "TRANSITION_FAILED"
  | "RESOURCE_CLEANUP_FAILED";

export class GrandHallT554NativeReviewOperatorSessionV2Error extends Error {
  constructor(
    readonly code: GrandHallT554NativeReviewOperatorSessionV2ErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewOperatorSessionV2Error";
  }
}

export interface GrandHallT554NativeReviewOperatorSourceCatalogEntryV2 {
  readonly inventoryIndex: number;
  readonly sweepNumber: number;
  readonly agentObservation:
    | {
        readonly state: "grand_hall_pixels_observed_human_pending";
        readonly proposedDisposition: "include_with_binary_pixel_mask";
        readonly maskAuthoringState: "required_not_authored";
      }
    | {
        readonly state: "no_grand_hall_pixels_observed_human_pending";
        readonly proposedDisposition: "exclude_whole_frame";
        readonly maskAuthoringState: "not_required_if_human_confirms_exclusion";
      };
}

export interface GrandHallT554NativeReviewOperatorSessionSnapshotV2 {
  readonly schemaVersion: typeof OPERATOR_SNAPSHOT_SCHEMA;
  readonly lifecycle: "active" | "poisoned" | "stopped";
  readonly browserEpochNumber: number;
  readonly workspaceRevision: number;
  readonly maximumAllocatedRenderGeneration: number;
  readonly sources: readonly GrandHallT554NativeReviewOperatorSourceCatalogEntryV2[];
  readonly activeSource: {
    readonly inventoryIndex: number;
    readonly sweepNumber: number;
    readonly renderGeneration: number;
    readonly phase:
      | "source_review"
      | "mask_edit"
      | "mask_review"
      | "decision_recorded"
      | "human_attested";
    readonly sourceCoverage: {
      readonly completedTileCount: number;
      readonly totalTileCount: typeof TILE_COUNT;
      readonly complete: boolean;
    };
    readonly mask: {
      readonly revision: number;
      readonly frozen: boolean;
      readonly includedPixelCount: number;
      readonly excludedPixelCount: number;
    } | null;
    readonly decision:
      | {
          readonly result: "EXCLUDE";
          readonly classification: "no_observed_grand_hall_pixels";
        }
      | {
          readonly result: "INCLUDE";
          readonly classification:
            | "grand_hall_core"
            | "grand_hall_portal_threshold";
        }
      | null;
    readonly humanAttested: boolean;
  } | null;
  readonly authority: "none";
  readonly reviewState: "human_pending";
  readonly finalDecision: "PENDING";
  readonly acceptanceAuthorized: false;
  readonly reconstructionAuthorized: false;
  readonly runtimeAuthorized: false;
  readonly exportAuthorized: false;
  readonly generatedContentAuthorized: false;
}

export interface GrandHallT554NativeReviewOperatorSourceTileV2 {
  readonly schemaVersion: typeof SOURCE_TILE_RESPONSE_SCHEMA;
  readonly renderMode: "source_rgb8";
  readonly widthPx: number;
  readonly heightPx: number;
  readonly sourceRgb8: Buffer;
  readonly commitDeliveryAfterSuccessfulSend: () => Promise<void>;
  readonly discardAfterFailedSend: () => Promise<void>;
}

export interface GrandHallT554NativeReviewOperatorMaskTileV2 {
  readonly schemaVersion: typeof MASK_TILE_RESPONSE_SCHEMA;
  readonly renderMode: "source_rgb8_mask8_reason8";
  readonly widthPx: number;
  readonly heightPx: number;
  readonly sourceRgb8: Buffer;
  readonly mask8: Buffer;
  readonly reason8: Buffer;
  readonly commitDeliveryAfterSuccessfulSend: () => Promise<void>;
  readonly discardAfterFailedSend: () => Promise<void>;
}

export interface GrandHallT554NativeReviewOperatorSourceCoverageAcknowledgementV2 {
  readonly schemaVersion: typeof SOURCE_COVERAGE_ACK_RESPONSE_SCHEMA;
  readonly sequence: number;
  readonly completedTileCount: number;
  readonly complete: boolean;
}

export interface GrandHallT554NativeReviewOperatorMaskCoverageAcknowledgementV2 {
  readonly schemaVersion: typeof MASK_COVERAGE_ACK_RESPONSE_SCHEMA;
  readonly sequence: number;
  readonly deliveredTileCount: number;
  readonly completedTileCount: number;
  readonly complete: boolean;
}

export type GrandHallT554NativeReviewOperatorSelectSourceInputV2 = z.infer<
  typeof SelectSourceInputSchema
>;
export type GrandHallT554NativeReviewOperatorTileInputV2 = z.infer<
  typeof TileInputSchema
>;
export type GrandHallT554NativeReviewOperatorCoverageInputV2 = z.infer<
  typeof CoverageInputSchema
>;
export type GrandHallT554NativeReviewOperatorRevisionAndGenerationInputV2 =
  z.infer<typeof ExpectedRevisionAndGenerationSchema>;
export type GrandHallT554NativeReviewOperatorApplyMaskEditInputV2 = z.infer<
  typeof ApplyMaskEditInputSchema
>;
export type GrandHallT554NativeReviewOperatorFreezeMaskInputV2 = z.infer<
  typeof FreezeMaskInputSchema
>;
export type GrandHallT554NativeReviewOperatorExcludeDecisionInputV2 = z.infer<
  typeof ExcludeDecisionInputSchema
>;
export type GrandHallT554NativeReviewOperatorIncludeDecisionInputV2 = z.infer<
  typeof IncludeDecisionInputSchema
>;
export type GrandHallT554NativeReviewOperatorAttestationInputV2 = z.infer<
  typeof AttestationInputSchema
>;
export type GrandHallT554NativeReviewOperatorAbandonInputV2 = z.infer<
  typeof AbandonInputSchema
>;
export type GrandHallT554NativeReviewOperatorStopInputV2 = z.infer<
  typeof StopInputSchema
>;

export interface GrandHallT554NativeReviewOperatorSessionV2 {
  snapshot(): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  selectSource(
    input: GrandHallT554NativeReviewOperatorSelectSourceInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  prepareSourceTile(
    input: GrandHallT554NativeReviewOperatorTileInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSourceTileV2>;
  recordSourceCoverage(
    input: GrandHallT554NativeReviewOperatorCoverageInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSourceCoverageAcknowledgementV2>;
  recordExcludeDecision(
    input: GrandHallT554NativeReviewOperatorExcludeDecisionInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  beginMaskWorkflow(
    input: GrandHallT554NativeReviewOperatorRevisionAndGenerationInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  applyMaskEdit(
    input: GrandHallT554NativeReviewOperatorApplyMaskEditInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  freezeMask(
    input: GrandHallT554NativeReviewOperatorFreezeMaskInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  prepareMaskTile(
    input: GrandHallT554NativeReviewOperatorTileInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorMaskTileV2>;
  recordMaskCoverage(
    input: GrandHallT554NativeReviewOperatorCoverageInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorMaskCoverageAcknowledgementV2>;
  recordIncludeDecision(
    input: GrandHallT554NativeReviewOperatorIncludeDecisionInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  recordHumanAttestation(
    input: GrandHallT554NativeReviewOperatorAttestationInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  leaveSourcePending(
    input: GrandHallT554NativeReviewOperatorRevisionAndGenerationInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  abandonActiveSource(
    input: GrandHallT554NativeReviewOperatorAbandonInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  stop(
    input: GrandHallT554NativeReviewOperatorStopInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>;
  close(): Promise<void>;
}

export interface __GrandHallT554NativeReviewOperatorDelegateFactoriesV2 {
  readonly sourceCatalog: readonly GrandHallT554NativeReviewOperatorSourceCatalogEntryV2[];
  readonly createSource: () => Promise<GrandHallT554NativeReviewSourceSessionV2>;
  readonly openSource: () => Promise<GrandHallT554NativeReviewSourceSessionV2>;
  readonly openMask: () => Promise<GrandHallT554NativeReviewMaskWorkflowSessionV2>;
  readonly takeOverMask: () => Promise<GrandHallT554NativeReviewMaskWorkflowSessionV2>;
}

type Delegate =
  | {
      readonly kind: "source";
      readonly session: GrandHallT554NativeReviewSourceSessionV2;
    }
  | {
      readonly kind: "mask";
      readonly session: GrandHallT554NativeReviewMaskWorkflowSessionV2;
    };

interface PendingDelivery {
  resolved: boolean;
  readonly buffers: readonly Buffer[];
  readonly commit: () => Promise<void>;
  readonly discard: () => Promise<void>;
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
  code: GrandHallT554NativeReviewOperatorSessionV2ErrorCode,
  message: string,
  cause?: unknown,
): GrandHallT554NativeReviewOperatorSessionV2Error {
  return new GrandHallT554NativeReviewOperatorSessionV2Error(
    code,
    message,
    cause,
  );
}

function parseInput<T>(schema: z.ZodType<T>, value: T): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw fail(
      "ARGUMENT_INVALID",
      result.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
      result.error,
    );
  }
  return result.data;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<PropertyKey, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function parseSourceCatalog(
  value: readonly GrandHallT554NativeReviewOperatorSourceCatalogEntryV2[],
): readonly GrandHallT554NativeReviewOperatorSourceCatalogEntryV2[] {
  const result = SourceCatalogSchema.safeParse(value);
  if (!result.success) {
    throw fail(
      "ARGUMENT_INVALID",
      `Operator source catalog is invalid: ${result.error.issues
        .map(
          (issue) => `${issue.path.join(".") || "sources"}: ${issue.message}`,
        )
        .join("; ")}`,
      result.error,
    );
  }
  return deepFreeze(
    result.data.map((source) => ({
      inventoryIndex: source.inventoryIndex,
      sweepNumber: source.sweepNumber,
      agentObservation: { ...source.agentObservation },
    })),
  );
}

function paintedTileBitsetHex(
  paintedTiles: readonly { readonly column: number; readonly row: number }[],
): string {
  const bitmap = Buffer.alloc(TILE_BITMAP_BYTE_LENGTH);
  try {
    for (const tile of paintedTiles) {
      const tileIndex = tile.row * TILE_COLUMN_COUNT + tile.column;
      const byteIndex = Math.floor(tileIndex / 8);
      const bitIndex = tileIndex % 8;
      const prior = bitmap[byteIndex];
      if (prior === undefined) {
        throw fail(
          "ARGUMENT_INVALID",
          "Painted tile is outside the native grid.",
        );
      }
      bitmap[byteIndex] = prior | (1 << bitIndex);
    }
    return bitmap.toString("hex");
  } finally {
    bitmap.fill(0);
  }
}

function assertExpectedRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw fail(
      "WORKSPACE_REVISION_CONFLICT",
      `Expected workspace revision ${String(expected)} but found ${String(actual)}.`,
    );
  }
}

function assertBrowserEpochNumber(actual: number, expected: number): void {
  if (actual !== expected) {
    throw fail(
      "BROWSER_EPOCH_CONFLICT",
      `Expected browser epoch ${String(expected)} but found ${String(actual)}.`,
    );
  }
}

function nextSafeInteger(value: number): number | null {
  return Number.isSafeInteger(value) && value < Number.MAX_SAFE_INTEGER
    ? value + 1
    : null;
}

function assertRenderGeneration(actual: number, expected: number): void {
  if (actual !== expected) {
    throw fail(
      "RENDER_GENERATION_CONFLICT",
      `Expected render generation ${String(expected)} but found ${String(actual)}.`,
    );
  }
}

function projectSourceSnapshot(
  snapshot: GrandHallT554NativeReviewSourceSessionSnapshotV2,
  sources: readonly GrandHallT554NativeReviewOperatorSourceCatalogEntryV2[],
): GrandHallT554NativeReviewOperatorSessionSnapshotV2 {
  return deepFreeze({
    schemaVersion: OPERATOR_SNAPSHOT_SCHEMA,
    lifecycle: snapshot.lifecycle,
    browserEpochNumber: snapshot.browserEpochNumber,
    workspaceRevision: snapshot.workspaceRevision,
    maximumAllocatedRenderGeneration: snapshot.maximumAllocatedRenderGeneration,
    sources,
    activeSource:
      snapshot.activeSource === null
        ? null
        : {
            inventoryIndex: snapshot.activeSource.inventoryIndex,
            sweepNumber: snapshot.activeSource.sweepNumber,
            renderGeneration: snapshot.activeSource.renderGeneration,
            phase:
              snapshot.activeSource.phase === "source_decided"
                ? "decision_recorded"
                : snapshot.activeSource.phase,
            sourceCoverage: {
              completedTileCount:
                snapshot.activeSource.sourceCoverage.completedTileCount,
              totalTileCount: TILE_COUNT,
              complete: snapshot.activeSource.sourceCoverage.complete,
            },
            mask: null,
            decision:
              snapshot.activeSource.decision === null
                ? null
                : {
                    result: "EXCLUDE",
                    classification:
                      snapshot.activeSource.decision.classification,
                  },
            humanAttested: snapshot.activeSource.humanAttestation !== null,
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

function projectMaskSnapshot(
  snapshot: GrandHallT554NativeReviewMaskWorkflowSnapshotV2,
  sources: readonly GrandHallT554NativeReviewOperatorSourceCatalogEntryV2[],
): GrandHallT554NativeReviewOperatorSessionSnapshotV2 {
  return deepFreeze({
    schemaVersion: OPERATOR_SNAPSHOT_SCHEMA,
    lifecycle: snapshot.lifecycle,
    browserEpochNumber: snapshot.browserEpochNumber,
    workspaceRevision: snapshot.workspaceRevision,
    maximumAllocatedRenderGeneration: snapshot.maximumAllocatedRenderGeneration,
    sources,
    activeSource:
      snapshot.activeSource === null
        ? null
        : {
            inventoryIndex: snapshot.activeSource.inventoryIndex,
            sweepNumber: snapshot.activeSource.sweepNumber,
            renderGeneration: snapshot.activeSource.renderGeneration,
            phase: snapshot.activeSource.phase,
            sourceCoverage: {
              completedTileCount:
                snapshot.activeSource.completedSourceCoverage
                  ?.completedTileCount ?? 0,
              totalTileCount: TILE_COUNT,
              complete: snapshot.activeSource.completedSourceCoverage !== null,
            },
            mask:
              snapshot.activeSource.maskState === null
                ? null
                : {
                    revision: snapshot.activeSource.maskState.revision,
                    frozen:
                      snapshot.activeSource.phase === "mask_review" ||
                      snapshot.activeSource.phase === "decision_recorded" ||
                      snapshot.activeSource.phase === "human_attested",
                    includedPixelCount:
                      snapshot.activeSource.maskState.includedPixelCount,
                    excludedPixelCount:
                      snapshot.activeSource.maskState.excludedPixelCount,
                  },
            decision:
              snapshot.activeSource.decision === null
                ? null
                : {
                    result: "INCLUDE",
                    classification:
                      snapshot.activeSource.decision.classification,
                  },
            humanAttested: snapshot.activeSource.humanAttestation !== null,
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

function isSourcePhaseInvalid(error: unknown): boolean {
  return (
    error instanceof GrandHallT554NativeReviewSourceSessionV2Error &&
    error.code === "PHASE_INVALID"
  );
}

function isMaskPhaseInvalid(error: unknown): boolean {
  return (
    error instanceof GrandHallT554NativeReviewMaskWorkflowSessionV2Error &&
    error.code === "PHASE_INVALID"
  );
}

function isSafeDelegateRejection(error: unknown): boolean {
  if (error instanceof GrandHallT554NativeReviewSourceSessionV2Error) {
    switch (error.code) {
      case "ARGUMENT_INVALID":
      case "SESSION_STOPPED":
      case "WORKSPACE_REVISION_CONFLICT":
      case "NO_ACTIVE_SOURCE":
      case "SOURCE_STALE":
      case "PHASE_INVALID":
      case "SOURCE_COVERAGE_INCOMPLETE":
      case "DELIVERY_ALREADY_RESOLVED":
        return true;
      default:
        return false;
    }
  }
  if (error instanceof GrandHallT554NativeReviewMaskWorkflowSessionV2Error) {
    switch (error.code) {
      case "ARGUMENT_INVALID":
      case "SESSION_STOPPED":
      case "WORKSPACE_REVISION_CONFLICT":
      case "BINDING_STALE":
      case "PHASE_INVALID":
      case "SOURCE_COVERAGE_INCOMPLETE":
      case "MASK_COVERAGE_INCOMPLETE":
      case "MASK_REVISION_CONFLICT":
      case "MASK_REVISION_TAINTED":
      case "DELIVERY_ALREADY_RESOLVED":
      case "PENDING_TILE_DELIVERY":
        return true;
      default:
        return false;
    }
  }
  return false;
}

class GrandHallT554NativeReviewOperatorSessionControllerV2 implements GrandHallT554NativeReviewOperatorSessionV2 {
  readonly #lane = new SerialMutationLane();
  readonly #pendingDeliveries = new Set<PendingDelivery>();
  readonly #cleanupDelegates = new Set<Delegate>();
  #delegate: Delegate | null;
  #closed = false;
  #recoveryRequired = false;

  constructor(
    delegate: Delegate,
    private readonly factories: __GrandHallT554NativeReviewOperatorDelegateFactoriesV2,
    private readonly sourceCatalog: readonly GrandHallT554NativeReviewOperatorSourceCatalogEntryV2[],
  ) {
    this.#delegate = delegate;
  }

  #assertOpen(): Delegate {
    if (this.#closed) {
      throw fail("SESSION_CLOSED", "Operator session is closed.");
    }
    if (this.#recoveryRequired || this.#delegate === null) {
      throw fail(
        "RECOVERY_REQUIRED",
        "Operator session requires close and explicit reopen after an uncertain operation.",
      );
    }
    return this.#delegate;
  }

  async #runDelegateMutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!isSafeDelegateRejection(error)) this.#recoveryRequired = true;
      throw error;
    }
  }

  async #closeForHandoff(delegate: Delegate, operation: string): Promise<void> {
    this.#delegate = null;
    this.#cleanupDelegates.add(delegate);
    try {
      await delegate.session.close();
      this.#cleanupDelegates.delete(delegate);
    } catch (error) {
      this.#recoveryRequired = true;
      throw fail(
        "TRANSITION_FAILED",
        `${operation} failed while closing the prior controller.`,
        error,
      );
    }
  }

  async #discardOpenedTransitionDelegate(
    delegate: Delegate,
    operationError: unknown,
    message: string,
  ): Promise<never> {
    this.#delegate = null;
    this.#recoveryRequired = true;
    this.#cleanupDelegates.add(delegate);
    let cleanupError: unknown;
    try {
      await delegate.session.close();
      this.#cleanupDelegates.delete(delegate);
    } catch (error) {
      cleanupError = error;
    }
    throw fail(
      cleanupError === undefined
        ? "TRANSITION_FAILED"
        : "RESOURCE_CLEANUP_FAILED",
      message,
      cleanupError === undefined
        ? operationError
        : { operationError, cleanupError },
    );
  }

  #assertNoPendingDeliveries(operation: string): void {
    if (this.#pendingDeliveries.size !== 0) {
      throw fail(
        "PENDING_TILE_DELIVERY",
        `${operation} requires every prepared tile response to be committed or discarded.`,
      );
    }
  }

  async #snapshotDelegate(delegate = this.#assertOpen()): Promise<
    | {
        readonly kind: "source";
        readonly snapshot: GrandHallT554NativeReviewSourceSessionSnapshotV2;
      }
    | {
        readonly kind: "mask";
        readonly snapshot: GrandHallT554NativeReviewMaskWorkflowSnapshotV2;
      }
  > {
    if (delegate.kind === "source") {
      return { kind: "source", snapshot: await delegate.session.snapshot() };
    }
    return { kind: "mask", snapshot: await delegate.session.snapshot() };
  }

  #project(
    value:
      | {
          readonly kind: "source";
          readonly snapshot: GrandHallT554NativeReviewSourceSessionSnapshotV2;
        }
      | {
          readonly kind: "mask";
          readonly snapshot: GrandHallT554NativeReviewMaskWorkflowSnapshotV2;
        },
  ): GrandHallT554NativeReviewOperatorSessionSnapshotV2 {
    return value.kind === "source"
      ? this.#projectSource(value.snapshot)
      : this.#projectMask(value.snapshot);
  }

  #projectSource(
    snapshot: GrandHallT554NativeReviewSourceSessionSnapshotV2,
  ): GrandHallT554NativeReviewOperatorSessionSnapshotV2 {
    return projectSourceSnapshot(snapshot, this.sourceCatalog);
  }

  #projectMask(
    snapshot: GrandHallT554NativeReviewMaskWorkflowSnapshotV2,
  ): GrandHallT554NativeReviewOperatorSessionSnapshotV2 {
    return projectMaskSnapshot(snapshot, this.sourceCatalog);
  }

  #sourceActive(
    snapshot: GrandHallT554NativeReviewSourceSessionSnapshotV2,
  ): NonNullable<
    GrandHallT554NativeReviewSourceSessionSnapshotV2["activeSource"]
  > {
    if (snapshot.activeSource === null) {
      throw fail("PHASE_INVALID", "Operation requires one active source.");
    }
    return snapshot.activeSource;
  }

  #maskActive(
    snapshot: GrandHallT554NativeReviewMaskWorkflowSnapshotV2,
  ): NonNullable<
    GrandHallT554NativeReviewMaskWorkflowSnapshotV2["activeSource"]
  > {
    if (snapshot.activeSource === null) {
      throw fail("PHASE_INVALID", "Operation requires one active source.");
    }
    return snapshot.activeSource;
  }

  #wrapSourceTile(
    tile: GrandHallT554NativeReviewSourceTileV2,
  ): GrandHallT554NativeReviewOperatorSourceTileV2 {
    const pending: PendingDelivery = {
      resolved: false,
      buffers: [tile.sourceRgb8],
      commit: tile.commitDeliveryAfterSuccessfulSend,
      discard: tile.discardAfterFailedSend,
    };
    this.#pendingDeliveries.add(pending);
    return Object.freeze({
      schemaVersion: SOURCE_TILE_RESPONSE_SCHEMA,
      renderMode: tile.renderMode,
      widthPx: tile.widthPx,
      heightPx: tile.heightPx,
      sourceRgb8: tile.sourceRgb8,
      commitDeliveryAfterSuccessfulSend: async () => {
        await this.#resolveDelivery(pending, "commit");
      },
      discardAfterFailedSend: async () => {
        await this.#resolveDelivery(pending, "discard");
      },
    });
  }

  #wrapMaskTile(
    tile: GrandHallT554NativeReviewMaskTileV2,
  ): GrandHallT554NativeReviewOperatorMaskTileV2 {
    const pending: PendingDelivery = {
      resolved: false,
      buffers: [tile.sourceRgb8, tile.mask8, tile.reason8],
      commit: tile.commitDeliveryAfterSuccessfulSend,
      discard: tile.discardAfterFailedSend,
    };
    this.#pendingDeliveries.add(pending);
    return Object.freeze({
      schemaVersion: MASK_TILE_RESPONSE_SCHEMA,
      renderMode: tile.renderMode,
      widthPx: tile.widthPx,
      heightPx: tile.heightPx,
      sourceRgb8: tile.sourceRgb8,
      mask8: tile.mask8,
      reason8: tile.reason8,
      commitDeliveryAfterSuccessfulSend: async () => {
        await this.#resolveDelivery(pending, "commit");
      },
      discardAfterFailedSend: async () => {
        await this.#resolveDelivery(pending, "discard");
      },
    });
  }

  async #resolveDelivery(
    pending: PendingDelivery,
    resolution: "commit" | "discard",
  ): Promise<void> {
    await this.#lane.run(async () => {
      if (pending.resolved) {
        throw fail(
          "DELIVERY_ALREADY_RESOLVED",
          "Prepared tile response was already committed or discarded.",
        );
      }
      if (this.#recoveryRequired) {
        pending.resolved = true;
        let discardError: unknown;
        try {
          await pending.discard();
        } catch (error) {
          discardError = error;
        } finally {
          for (const buffer of pending.buffers) buffer.fill(0);
          this.#pendingDeliveries.delete(pending);
        }
        throw fail(
          "RECOVERY_REQUIRED",
          "Tile delivery was discarded because an earlier operation requires recovery.",
          discardError,
        );
      }
      pending.resolved = true;
      try {
        await (resolution === "commit" ? pending.commit() : pending.discard());
      } catch (error) {
        this.#recoveryRequired = true;
        throw error;
      } finally {
        for (const buffer of pending.buffers) buffer.fill(0);
        this.#pendingDeliveries.delete(pending);
      }
    });
  }

  snapshot(): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () =>
      this.#project(await this.#snapshotDelegate()),
    );
  }

  selectSource(
    input: GrandHallT554NativeReviewOperatorSelectSourceInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(SelectSourceInputSchema, input);
      this.#assertNoPendingDeliveries("Source selection");
      let delegate = this.#assertOpen();
      if (delegate.kind === "mask") {
        const maskSnapshot = await delegate.session.snapshot();
        assertBrowserEpochNumber(
          maskSnapshot.browserEpochNumber,
          request.expectedBrowserEpochNumber,
        );
        assertExpectedRevision(
          maskSnapshot.workspaceRevision,
          request.expectedWorkspaceRevision,
        );
        if (maskSnapshot.lifecycle !== "active") {
          throw fail(
            "PHASE_INVALID",
            `Source selection cannot reopen a ${maskSnapshot.lifecycle} session.`,
          );
        }
        if (maskSnapshot.activeSource !== null) {
          throw fail(
            "PHASE_INVALID",
            "Abandon the active mask-workflow source before selecting another source.",
          );
        }
        await this.#closeForHandoff(delegate, "Mask-to-source handoff");
        let source: GrandHallT554NativeReviewSourceSessionV2;
        try {
          source = await this.factories.openSource();
        } catch (error) {
          this.#recoveryRequired = true;
          throw fail(
            "TRANSITION_FAILED",
            "Mask-to-source controller handoff failed after close.",
            error,
          );
        }
        const openedSourceDelegate: Delegate = {
          kind: "source",
          session: source,
        };
        let sourceSnapshot: GrandHallT554NativeReviewSourceSessionSnapshotV2;
        try {
          sourceSnapshot = await source.snapshot();
        } catch (error) {
          return await this.#discardOpenedTransitionDelegate(
            openedSourceDelegate,
            error,
            "Source controller could not verify the reopened session binding.",
          );
        }
        const expectedSourceBrowserEpochNumber = nextSafeInteger(
          maskSnapshot.browserEpochNumber,
        );
        if (
          sourceSnapshot.sessionIdSha256 !== maskSnapshot.sessionIdSha256 ||
          sourceSnapshot.workspaceRevision !== maskSnapshot.workspaceRevision ||
          sourceSnapshot.maximumAllocatedRenderGeneration !==
            maskSnapshot.maximumAllocatedRenderGeneration ||
          expectedSourceBrowserEpochNumber === null ||
          sourceSnapshot.browserEpochNumber !==
            expectedSourceBrowserEpochNumber ||
          sourceSnapshot.activeSource !== null
        ) {
          return await this.#discardOpenedTransitionDelegate(
            openedSourceDelegate,
            undefined,
            "Source controller did not reopen the exact inactive session binding.",
          );
        }
        delegate = openedSourceDelegate;
        this.#delegate = delegate;
      } else {
        const sourceSnapshot = await delegate.session.snapshot();
        assertBrowserEpochNumber(
          sourceSnapshot.browserEpochNumber,
          request.expectedBrowserEpochNumber,
        );
        assertExpectedRevision(
          sourceSnapshot.workspaceRevision,
          request.expectedWorkspaceRevision,
        );
      }
      const snapshot = await this.#runDelegateMutation(
        async () =>
          await delegate.session.selectSource({
            expectedWorkspaceRevision: request.expectedWorkspaceRevision,
            inventoryIndex: request.inventoryIndex,
          }),
      );
      return this.#projectSource(snapshot);
    });
  }

  prepareSourceTile(
    input: GrandHallT554NativeReviewOperatorTileInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSourceTileV2> {
    return this.#lane.run(async () => {
      const request = parseInput(TileInputSchema, input);
      const delegate = this.#assertOpen();
      if (delegate.kind !== "source") {
        throw fail(
          "PHASE_INVALID",
          "Source tile requires source-review phase.",
        );
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#sourceActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      if (
        active.phase !== "source_review" ||
        active.sourceEpochNonce === null
      ) {
        throw fail(
          "PHASE_INVALID",
          "Source tile requires active source review.",
        );
      }
      return this.#wrapSourceTile(
        await delegate.session.prepareSourceTile({
          sourceEpochNonce: active.sourceEpochNonce,
          renderGeneration: request.renderGeneration,
          column: request.column,
          row: request.row,
        }),
      );
    });
  }

  recordSourceCoverage(
    input: GrandHallT554NativeReviewOperatorCoverageInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSourceCoverageAcknowledgementV2> {
    return this.#lane.run(async () => {
      const request = parseInput(CoverageInputSchema, input);
      this.#assertNoPendingDeliveries("Source coverage observation");
      const delegate = this.#assertOpen();
      if (delegate.kind !== "source") {
        throw fail(
          "PHASE_INVALID",
          "Source coverage requires source-review phase.",
        );
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#sourceActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      if (
        active.phase !== "source_review" ||
        active.sourceEpochNonce === null
      ) {
        throw fail(
          "PHASE_INVALID",
          "Source coverage requires active source review.",
        );
      }
      const sourceEpochNonce = active.sourceEpochNonce;
      const acknowledgement = await this.#runDelegateMutation(
        async () =>
          await delegate.session.recordSourceCoverage({
            sourceEpochNonce,
            renderGeneration: request.renderGeneration,
            documentVisibilityState: request.documentVisibilityState,
            documentFocusState: request.documentFocusState,
            viewportCssWidth: request.viewportCssWidth,
            viewportCssHeight: request.viewportCssHeight,
            devicePixelRatio: request.devicePixelRatio,
            sourceToCssTransform: request.sourceToCssTransform,
            paintedTileBitsetHex: paintedTileBitsetHex(request.paintedTiles),
          }),
      );
      return deepFreeze({
        schemaVersion: SOURCE_COVERAGE_ACK_RESPONSE_SCHEMA,
        sequence: acknowledgement.sequence,
        completedTileCount: acknowledgement.completedTileCount,
        complete: acknowledgement.complete,
      });
    });
  }

  recordExcludeDecision(
    input: GrandHallT554NativeReviewOperatorExcludeDecisionInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(ExcludeDecisionInputSchema, input);
      this.#assertNoPendingDeliveries("EXCLUDE decision");
      const delegate = this.#assertOpen();
      if (delegate.kind !== "source") {
        throw fail("PHASE_INVALID", "EXCLUDE requires source-review phase.");
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#sourceActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertExpectedRevision(
        snapshot.workspaceRevision,
        request.expectedWorkspaceRevision,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      if (
        active.phase !== "source_review" ||
        active.sourceEpochNonce === null
      ) {
        throw fail("PHASE_INVALID", "EXCLUDE requires active source review.");
      }
      const sourceEpochNonce = active.sourceEpochNonce;
      return this.#projectSource(
        await this.#runDelegateMutation(
          async () =>
            await delegate.session.recordExcludeDecision({
              sourceEpochNonce,
              renderGeneration: request.renderGeneration,
              expectedWorkspaceRevision: request.expectedWorkspaceRevision,
              note: request.note,
            }),
        ),
      );
    });
  }

  beginMaskWorkflow(
    input: GrandHallT554NativeReviewOperatorRevisionAndGenerationInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(ExpectedRevisionAndGenerationSchema, input);
      this.#assertNoPendingDeliveries("Mask workflow start");
      const delegate = this.#assertOpen();
      if (delegate.kind !== "source") {
        throw fail(
          "PHASE_INVALID",
          "Mask workflow is already active or terminal.",
        );
      }
      const sourceSnapshot = await delegate.session.snapshot();
      const sourceActive = this.#sourceActive(sourceSnapshot);
      assertBrowserEpochNumber(
        sourceSnapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertExpectedRevision(
        sourceSnapshot.workspaceRevision,
        request.expectedWorkspaceRevision,
      );
      assertRenderGeneration(
        sourceActive.renderGeneration,
        request.renderGeneration,
      );
      if (sourceActive.phase !== "source_review") {
        throw fail(
          "PHASE_INVALID",
          "Mask workflow requires active source review.",
        );
      }
      if (!sourceActive.sourceCoverage.complete) {
        throw fail(
          "SOURCE_COVERAGE_INCOMPLETE",
          "Mask workflow requires complete native-grid source coverage.",
        );
      }

      await this.#closeForHandoff(delegate, "Source-to-mask handoff");
      let mask: GrandHallT554NativeReviewMaskWorkflowSessionV2;
      try {
        mask = await this.factories.openMask();
      } catch (error) {
        this.#recoveryRequired = true;
        throw fail(
          "TRANSITION_FAILED",
          "Source-to-mask controller handoff failed after close.",
          error,
        );
      }
      const openedMaskDelegate: Delegate = { kind: "mask", session: mask };
      let maskSnapshot: GrandHallT554NativeReviewMaskWorkflowSnapshotV2;
      let maskActive: NonNullable<
        GrandHallT554NativeReviewMaskWorkflowSnapshotV2["activeSource"]
      >;
      try {
        maskSnapshot = await mask.snapshot();
        maskActive = this.#maskActive(maskSnapshot);
      } catch (error) {
        return await this.#discardOpenedTransitionDelegate(
          openedMaskDelegate,
          error,
          "Mask controller could not verify the reopened source binding.",
        );
      }
      const expectedMaskBrowserEpochNumber = nextSafeInteger(
        sourceSnapshot.browserEpochNumber,
      );
      if (
        maskSnapshot.sessionIdSha256 !== sourceSnapshot.sessionIdSha256 ||
        maskSnapshot.workspaceRevision !== sourceSnapshot.workspaceRevision ||
        maskSnapshot.maximumAllocatedRenderGeneration !==
          sourceSnapshot.maximumAllocatedRenderGeneration ||
        expectedMaskBrowserEpochNumber === null ||
        maskSnapshot.browserEpochNumber !== expectedMaskBrowserEpochNumber ||
        maskActive.inventoryIndex !== sourceActive.inventoryIndex ||
        maskActive.sweepNumber !== sourceActive.sweepNumber ||
        maskActive.renderGeneration !== sourceActive.renderGeneration ||
        maskActive.sourceReviewSubjectSha256 !==
          sourceActive.sourceReviewSubjectSha256 ||
        maskActive.phase !== "source_review"
      ) {
        return await this.#discardOpenedTransitionDelegate(
          openedMaskDelegate,
          undefined,
          "Mask controller did not reopen the exact source-review binding.",
        );
      }
      this.#delegate = openedMaskDelegate;
      return this.#projectMask(
        await this.#runDelegateMutation(
          async () =>
            await mask.beginMaskWorkflow({
              expectedBrowserEpochNonceSha256:
                maskSnapshot.browserEpochNonceSha256,
              expectedWorkspaceRevision: request.expectedWorkspaceRevision,
              expectedRenderGeneration: request.renderGeneration,
              sourceReviewSubjectSha256: maskActive.sourceReviewSubjectSha256,
            }),
        ),
      );
    });
  }

  applyMaskEdit(
    input: GrandHallT554NativeReviewOperatorApplyMaskEditInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(ApplyMaskEditInputSchema, input);
      this.#assertNoPendingDeliveries("Mask edit");
      const delegate = this.#assertOpen();
      if (delegate.kind !== "mask") {
        throw fail("PHASE_INVALID", "Mask edit requires mask workflow.");
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#maskActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertExpectedRevision(
        snapshot.workspaceRevision,
        request.expectedWorkspaceRevision,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      return this.#projectMask(
        await this.#runDelegateMutation(
          async () =>
            await delegate.session.applyMaskEdit({
              ...this.#maskMutationGuard(snapshot, active, request),
              edit: request.edit,
            }),
        ),
      );
    });
  }

  freezeMask(
    input: GrandHallT554NativeReviewOperatorFreezeMaskInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(FreezeMaskInputSchema, input);
      this.#assertNoPendingDeliveries("Mask freeze");
      const delegate = this.#assertOpen();
      if (delegate.kind !== "mask") {
        throw fail("PHASE_INVALID", "Mask freeze requires mask workflow.");
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#maskActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertExpectedRevision(
        snapshot.workspaceRevision,
        request.expectedWorkspaceRevision,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      return this.#projectMask(
        await this.#runDelegateMutation(
          async () =>
            await delegate.session.freezeMask({
              ...this.#maskMutationGuard(snapshot, active, request),
              expectedMaskRevision: request.expectedMaskRevision,
            }),
        ),
      );
    });
  }

  prepareMaskTile(
    input: GrandHallT554NativeReviewOperatorTileInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorMaskTileV2> {
    return this.#lane.run(async () => {
      const request = parseInput(TileInputSchema, input);
      const delegate = this.#assertOpen();
      if (delegate.kind !== "mask") {
        throw fail("PHASE_INVALID", "Mask tile requires mask workflow.");
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#maskActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      return this.#wrapMaskTile(
        await delegate.session.prepareMaskTile({
          ...this.#maskRenderBinding(snapshot, active),
          column: request.column,
          row: request.row,
        }),
      );
    });
  }

  recordMaskCoverage(
    input: GrandHallT554NativeReviewOperatorCoverageInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorMaskCoverageAcknowledgementV2> {
    return this.#lane.run(async () => {
      const request = parseInput(CoverageInputSchema, input);
      this.#assertNoPendingDeliveries("Mask coverage observation");
      const delegate = this.#assertOpen();
      if (delegate.kind !== "mask") {
        throw fail("PHASE_INVALID", "Mask coverage requires mask workflow.");
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#maskActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      const acknowledgement = await this.#runDelegateMutation(
        async () =>
          await delegate.session.recordMaskCoverage({
            ...this.#maskRenderBinding(snapshot, active),
            documentVisibilityState: request.documentVisibilityState,
            documentFocusState: request.documentFocusState,
            viewportCssWidth: request.viewportCssWidth,
            viewportCssHeight: request.viewportCssHeight,
            devicePixelRatio: request.devicePixelRatio,
            sourceToCssTransform: request.sourceToCssTransform,
            paintedTileBitsetHex: paintedTileBitsetHex(request.paintedTiles),
          }),
      );
      return deepFreeze({
        schemaVersion: MASK_COVERAGE_ACK_RESPONSE_SCHEMA,
        sequence: acknowledgement.sequence,
        deliveredTileCount: acknowledgement.deliveredTileCount,
        completedTileCount: acknowledgement.completedTileCount,
        complete: acknowledgement.complete,
      });
    });
  }

  recordIncludeDecision(
    input: GrandHallT554NativeReviewOperatorIncludeDecisionInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(IncludeDecisionInputSchema, input);
      this.#assertNoPendingDeliveries("INCLUDE decision");
      const delegate = this.#assertOpen();
      if (delegate.kind !== "mask") {
        throw fail("PHASE_INVALID", "INCLUDE requires reviewed mask workflow.");
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#maskActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertExpectedRevision(
        snapshot.workspaceRevision,
        request.expectedWorkspaceRevision,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      return this.#projectMask(
        await this.#runDelegateMutation(
          async () =>
            await delegate.session.recordIncludeDecision({
              ...this.#maskMutationGuard(snapshot, active, request),
              classification: request.classification,
              note: request.note,
            }),
        ),
      );
    });
  }

  recordHumanAttestation(
    input: GrandHallT554NativeReviewOperatorAttestationInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(AttestationInputSchema, input);
      this.#assertNoPendingDeliveries("Human attestation");
      const delegate = this.#assertOpen();
      if (delegate.kind === "source") {
        const snapshot = await delegate.session.snapshot();
        const active = this.#sourceActive(snapshot);
        assertBrowserEpochNumber(
          snapshot.browserEpochNumber,
          request.expectedBrowserEpochNumber,
        );
        assertExpectedRevision(
          snapshot.workspaceRevision,
          request.expectedWorkspaceRevision,
        );
        assertRenderGeneration(
          active.renderGeneration,
          request.renderGeneration,
        );
        return this.#projectSource(
          await this.#runDelegateMutation(
            async () =>
              await delegate.session.recordHumanAttestation({
                expectedBrowserEpochNonceSha256:
                  snapshot.browserEpochNonceSha256,
                renderGeneration: request.renderGeneration,
                expectedWorkspaceRevision: request.expectedWorkspaceRevision,
                reviewerId: request.reviewerId,
                knowledgeBasis: request.knowledgeBasis,
              }),
          ),
        );
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#maskActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertExpectedRevision(
        snapshot.workspaceRevision,
        request.expectedWorkspaceRevision,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      return this.#projectMask(
        await this.#runDelegateMutation(
          async () =>
            await delegate.session.recordHumanAttestation({
              ...this.#maskMutationGuard(snapshot, active, request),
              reviewerId: request.reviewerId,
              knowledgeBasis: request.knowledgeBasis,
            }),
        ),
      );
    });
  }

  leaveSourcePending(
    input: GrandHallT554NativeReviewOperatorRevisionAndGenerationInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(ExpectedRevisionAndGenerationSchema, input);
      this.#assertNoPendingDeliveries("Leave source pending");
      const delegate = this.#assertOpen();
      if (delegate.kind === "source") {
        const snapshot = await delegate.session.snapshot();
        const active = this.#sourceActive(snapshot);
        assertBrowserEpochNumber(
          snapshot.browserEpochNumber,
          request.expectedBrowserEpochNumber,
        );
        assertExpectedRevision(
          snapshot.workspaceRevision,
          request.expectedWorkspaceRevision,
        );
        assertRenderGeneration(
          active.renderGeneration,
          request.renderGeneration,
        );
        if (active.phase !== "source_review") {
          throw fail(
            "PHASE_INVALID",
            "Leave pending cannot erase or replace a recorded decision.",
          );
        }
        return this.#projectSource(
          await this.#runDelegateMutation(
            async () =>
              await delegate.session.abandonActiveSource({
                expectedBrowserEpochNonceSha256:
                  snapshot.browserEpochNonceSha256,
                renderGeneration: request.renderGeneration,
                expectedWorkspaceRevision: request.expectedWorkspaceRevision,
                reason: "operator_abandon",
              }),
          ),
        );
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#maskActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertExpectedRevision(
        snapshot.workspaceRevision,
        request.expectedWorkspaceRevision,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      if (
        active.phase === "decision_recorded" ||
        active.phase === "human_attested"
      ) {
        throw fail(
          "PHASE_INVALID",
          "Leave pending cannot erase or replace a recorded decision.",
        );
      }
      return this.#projectMask(
        await this.#runDelegateMutation(
          async () =>
            await delegate.session.abandonActiveSource({
              ...this.#maskMutationGuard(snapshot, active, request),
              reason: "operator_abandon",
            }),
        ),
      );
    });
  }

  abandonActiveSource(
    input: GrandHallT554NativeReviewOperatorAbandonInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(AbandonInputSchema, input);
      this.#assertNoPendingDeliveries("Source abandonment");
      const delegate = this.#assertOpen();
      if (delegate.kind === "source") {
        const snapshot = await delegate.session.snapshot();
        const active = this.#sourceActive(snapshot);
        assertBrowserEpochNumber(
          snapshot.browserEpochNumber,
          request.expectedBrowserEpochNumber,
        );
        assertExpectedRevision(
          snapshot.workspaceRevision,
          request.expectedWorkspaceRevision,
        );
        assertRenderGeneration(
          active.renderGeneration,
          request.renderGeneration,
        );
        return this.#projectSource(
          await this.#runDelegateMutation(
            async () =>
              await delegate.session.abandonActiveSource({
                expectedBrowserEpochNonceSha256:
                  snapshot.browserEpochNonceSha256,
                renderGeneration: request.renderGeneration,
                expectedWorkspaceRevision: request.expectedWorkspaceRevision,
                reason: request.reason,
              }),
          ),
        );
      }
      const snapshot = await delegate.session.snapshot();
      const active = this.#maskActive(snapshot);
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertExpectedRevision(
        snapshot.workspaceRevision,
        request.expectedWorkspaceRevision,
      );
      assertRenderGeneration(active.renderGeneration, request.renderGeneration);
      return this.#projectMask(
        await this.#runDelegateMutation(
          async () =>
            await delegate.session.abandonActiveSource({
              ...this.#maskMutationGuard(snapshot, active, request),
              reason: request.reason,
            }),
        ),
      );
    });
  }

  stop(
    input: GrandHallT554NativeReviewOperatorStopInputV2,
  ): Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2> {
    return this.#lane.run(async () => {
      const request = parseInput(StopInputSchema, input);
      this.#assertNoPendingDeliveries("Session stop");
      const delegate = this.#assertOpen();
      const snapshot = await delegate.session.snapshot();
      assertBrowserEpochNumber(
        snapshot.browserEpochNumber,
        request.expectedBrowserEpochNumber,
      );
      assertExpectedRevision(
        snapshot.workspaceRevision,
        request.expectedWorkspaceRevision,
      );
      if (delegate.kind === "source") {
        return this.#projectSource(
          await this.#runDelegateMutation(
            async () =>
              await delegate.session.stop({
                expectedWorkspaceRevision: request.expectedWorkspaceRevision,
              }),
          ),
        );
      }
      return this.#projectMask(
        await this.#runDelegateMutation(
          async () =>
            await delegate.session.stop({
              expectedWorkspaceRevision: request.expectedWorkspaceRevision,
            }),
        ),
      );
    });
  }

  close(): Promise<void> {
    return this.#lane.run(async () => {
      const cleanupErrors: unknown[] = [];
      if (!this.#closed) {
        this.#closed = true;
        for (const pending of [...this.#pendingDeliveries]) {
          pending.resolved = true;
          try {
            await pending.discard();
          } catch (error) {
            cleanupErrors.push(error);
          } finally {
            for (const buffer of pending.buffers) buffer.fill(0);
            this.#pendingDeliveries.delete(pending);
          }
        }
        const delegate = this.#delegate;
        this.#delegate = null;
        if (delegate !== null) this.#cleanupDelegates.add(delegate);
      }
      for (const delegate of [...this.#cleanupDelegates]) {
        try {
          await delegate.session.close();
          this.#cleanupDelegates.delete(delegate);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length !== 0) {
        throw fail(
          "RESOURCE_CLEANUP_FAILED",
          "Operator session cleanup failed after fail-closed delivery disposal.",
          cleanupErrors,
        );
      }
    });
  }

  #maskMutationGuard(
    snapshot: GrandHallT554NativeReviewMaskWorkflowSnapshotV2,
    active: NonNullable<
      GrandHallT554NativeReviewMaskWorkflowSnapshotV2["activeSource"]
    >,
    input: {
      readonly expectedWorkspaceRevision: number;
      readonly renderGeneration: number;
    },
  ) {
    return {
      expectedBrowserEpochNonceSha256: snapshot.browserEpochNonceSha256,
      expectedWorkspaceRevision: input.expectedWorkspaceRevision,
      expectedRenderGeneration: input.renderGeneration,
      sourceReviewSubjectSha256: active.sourceReviewSubjectSha256,
    };
  }

  #maskRenderBinding(
    snapshot: GrandHallT554NativeReviewMaskWorkflowSnapshotV2,
    active: NonNullable<
      GrandHallT554NativeReviewMaskWorkflowSnapshotV2["activeSource"]
    >,
  ) {
    if (active.maskState === null) {
      throw fail("PHASE_INVALID", "Mask rendering requires one mask state.");
    }
    return {
      expectedBrowserEpochNonceSha256: snapshot.browserEpochNonceSha256,
      expectedRenderGeneration: active.renderGeneration,
      sourceReviewSubjectSha256: active.sourceReviewSubjectSha256,
      maskStateSha256: active.maskState.maskStateSha256,
      maskReviewSubjectSha256: active.maskReviewSubjectSha256,
    };
  }
}

function productionFactories(
  options: GrandHallT554NativeReviewSourceSessionProductionOptionsV2,
  takeoverOptions?: GrandHallT554NativeReviewSourceSessionTakeoverOptionsV2,
): __GrandHallT554NativeReviewOperatorDelegateFactoriesV2 {
  return Object.freeze({
    sourceCatalog: options.registry.sources.map((entry) => ({
      inventoryIndex: entry.source.inventoryIndex,
      sweepNumber: entry.source.sweepNumber,
      agentObservation: { ...entry.observation },
    })),
    createSource: async () =>
      await createGrandHallT554NativeReviewSourceSessionV2(options),
    openSource: async () =>
      await openGrandHallT554NativeReviewSourceSessionV2(options),
    openMask: async () =>
      await openGrandHallT554NativeReviewMaskWorkflowSessionV2(options),
    takeOverMask: async () => {
      if (takeoverOptions === undefined) {
        throw fail(
          "ARGUMENT_INVALID",
          "Crash takeover requires one prior-owner witness.",
        );
      }
      return await takeOverGrandHallT554NativeReviewMaskWorkflowSessionAfterCrashV2(
        takeoverOptions,
      );
    },
  });
}

async function createInjectedOperatorSession(
  factories: __GrandHallT554NativeReviewOperatorDelegateFactoriesV2,
): Promise<GrandHallT554NativeReviewOperatorSessionV2> {
  const sourceCatalog = parseSourceCatalog(factories.sourceCatalog);
  const source = await factories.createSource();
  return new GrandHallT554NativeReviewOperatorSessionControllerV2(
    { kind: "source", session: source },
    factories,
    sourceCatalog,
  );
}

async function openInjectedOperatorSession(
  factories: __GrandHallT554NativeReviewOperatorDelegateFactoriesV2,
): Promise<GrandHallT554NativeReviewOperatorSessionV2> {
  const sourceCatalog = parseSourceCatalog(factories.sourceCatalog);
  try {
    const source = await factories.openSource();
    return new GrandHallT554NativeReviewOperatorSessionControllerV2(
      { kind: "source", session: source },
      factories,
      sourceCatalog,
    );
  } catch (error) {
    if (!isSourcePhaseInvalid(error)) throw error;
  }
  const mask = await factories.openMask();
  return new GrandHallT554NativeReviewOperatorSessionControllerV2(
    { kind: "mask", session: mask },
    factories,
    sourceCatalog,
  );
}

async function throwAfterTakenOverControllerCleanup(
  controller: {
    readonly close: () => Promise<void>;
  },
  operationError: unknown,
  message: string,
): Promise<never> {
  const cleanupErrors: unknown[] = [];
  let released = false;
  for (let attempt = 0; attempt < 2 && !released; attempt += 1) {
    try {
      await controller.close();
      released = true;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length === 0) throw operationError;
  throw fail("RESOURCE_CLEANUP_FAILED", message, {
    operationError,
    cleanupErrors,
    ownerReleaseEventuallySucceeded: released,
  });
}

async function takeOverInjectedOperatorSession(
  factories: __GrandHallT554NativeReviewOperatorDelegateFactoriesV2,
): Promise<GrandHallT554NativeReviewOperatorSessionV2> {
  const sourceCatalog = parseSourceCatalog(factories.sourceCatalog);
  let mask: GrandHallT554NativeReviewMaskWorkflowSessionV2;
  try {
    mask = await factories.takeOverMask();
  } catch (error) {
    if (!isMaskPhaseInvalid(error)) throw error;
    const source = await factories.openSource();
    return new GrandHallT554NativeReviewOperatorSessionControllerV2(
      { kind: "source", session: source },
      factories,
      sourceCatalog,
    );
  }
  let snapshot: GrandHallT554NativeReviewMaskWorkflowSnapshotV2;
  try {
    snapshot = await mask.snapshot();
  } catch (error) {
    return await throwAfterTakenOverControllerCleanup(
      mask,
      error,
      "Taken-over mask controller inspection failed and controller cleanup encountered one or more errors.",
    );
  }
  if (snapshot.activeSource?.phase !== "source_review") {
    return new GrandHallT554NativeReviewOperatorSessionControllerV2(
      { kind: "mask", session: mask },
      factories,
      sourceCatalog,
    );
  }
  try {
    await mask.close();
  } catch (error) {
    return await throwAfterTakenOverControllerCleanup(
      mask,
      error,
      "Taken-over mask controller source handoff failed and controller cleanup encountered one or more errors.",
    );
  }
  const source = await factories.openSource();
  let sourceSnapshot: GrandHallT554NativeReviewSourceSessionSnapshotV2;
  try {
    sourceSnapshot = await source.snapshot();
  } catch (error) {
    return await throwAfterTakenOverControllerCleanup(
      source,
      error,
      "Clean-open source controller inspection failed after takeover and controller cleanup encountered one or more errors.",
    );
  }
  const maskActive = snapshot.activeSource;
  const sourceActive = sourceSnapshot.activeSource;
  const expectedBrowserEpochNumber = nextSafeInteger(
    snapshot.browserEpochNumber,
  );
  const expectedWorkspaceRevision = nextSafeInteger(snapshot.workspaceRevision);
  const expectedRenderGeneration = nextSafeInteger(
    snapshot.maximumAllocatedRenderGeneration,
  );
  if (
    sourceSnapshot.sessionIdSha256 !== snapshot.sessionIdSha256 ||
    expectedBrowserEpochNumber === null ||
    sourceSnapshot.browserEpochNumber !== expectedBrowserEpochNumber ||
    expectedWorkspaceRevision === null ||
    sourceSnapshot.workspaceRevision !== expectedWorkspaceRevision ||
    expectedRenderGeneration === null ||
    sourceSnapshot.maximumAllocatedRenderGeneration !==
      expectedRenderGeneration ||
    sourceActive === null ||
    sourceActive.phase !== "source_review" ||
    sourceActive.inventoryIndex !== maskActive.inventoryIndex ||
    sourceActive.sweepNumber !== maskActive.sweepNumber ||
    sourceActive.renderGeneration !== expectedRenderGeneration ||
    sourceActive.sourceReviewSubjectSha256 !==
      maskActive.sourceReviewSubjectSha256
  ) {
    return await throwAfterTakenOverControllerCleanup(
      source,
      fail(
        "TRANSITION_FAILED",
        "Clean-open source controller did not advance the exact taken-over source-review binding.",
      ),
      "Clean-open source controller binding verification failed after takeover and controller cleanup encountered one or more errors.",
    );
  }
  return new GrandHallT554NativeReviewOperatorSessionControllerV2(
    { kind: "source", session: source },
    factories,
    sourceCatalog,
  );
}

export async function createGrandHallT554NativeReviewOperatorSessionV2(
  options: GrandHallT554NativeReviewSourceSessionProductionOptionsV2,
): Promise<GrandHallT554NativeReviewOperatorSessionV2> {
  return await createInjectedOperatorSession(productionFactories(options));
}

export async function openGrandHallT554NativeReviewOperatorSessionV2(
  options: GrandHallT554NativeReviewSourceSessionProductionOptionsV2,
): Promise<GrandHallT554NativeReviewOperatorSessionV2> {
  return await openInjectedOperatorSession(productionFactories(options));
}

export async function takeOverGrandHallT554NativeReviewOperatorSessionAfterCrashV2(
  options: GrandHallT554NativeReviewSourceSessionTakeoverOptionsV2,
): Promise<GrandHallT554NativeReviewOperatorSessionV2> {
  return await takeOverInjectedOperatorSession(
    productionFactories(options, options),
  );
}

export const __testOnlyGrandHallT554NativeReviewOperatorSessionV2 =
  /* @__PURE__ */ Object.freeze({
    create: createInjectedOperatorSession,
    open: openInjectedOperatorSession,
    takeOver: takeOverInjectedOperatorSession,
  });

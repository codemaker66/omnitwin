import { createHash } from "node:crypto";

import { CanonicalJsonValueSchema, stableCanonicalJson } from "@omnitwin/types";

import {
  GRAND_HALL_T554_MAXIMUM_CREDITED_HEARTBEAT_GAP_MS,
  GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE,
  GRAND_HALL_T554_NATIVE_REVIEW_MAXIMUM_TELEMETRY_EVENTS,
  GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
  GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
} from "./grand-hall-t554-native-review-coverage.js";
import {
  isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
  type GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
  type GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2,
  type GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2,
} from "./grand-hall-t554-native-review-durable-journal-v2.js";
import {
  GrandHallT554NativeReviewMaskChildCheckpointV2Schema,
  GrandHallT554NativeReviewMaskChildEventV2Schema,
  GrandHallT554NativeReviewMaskCoverageCarryStateV2Schema,
  GrandHallT554NativeReviewMaskScopeV2Schema,
  GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
  GrandHallT554NativeReviewSourceChildEventV2Schema,
  GrandHallT554NativeReviewSourceCoverageCarryStateV2Schema,
  GrandHallT554NativeReviewSourceScopeV2Schema,
  type GrandHallT554NativeReviewCoverageObservedPayloadV2,
  type GrandHallT554NativeReviewMaskChildEventV2,
  type GrandHallT554NativeReviewMaskCoverageCarryStateV2,
  type GrandHallT554NativeReviewMaskScopeV2,
  type GrandHallT554NativeReviewSourceChildEventV2,
  type GrandHallT554NativeReviewSourceCoverageCarryStateV2,
  type GrandHallT554NativeReviewSourceScopeV2,
  type GrandHallT554NativeReviewTileDeliveredPayloadV2,
} from "./grand-hall-t554-native-review-events-v2.js";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TILE_BITMAP_BYTE_LENGTH = Math.ceil(
  GRAND_HALL_T554_NATIVE_TILE_COUNT / 8,
);
const TILE_BITMAP_HEX_LENGTH = TILE_BITMAP_BYTE_LENGTH * 2;
const DWELL_VECTOR_BYTE_LENGTH = GRAND_HALL_T554_NATIVE_TILE_COUNT * 2;
const EMPTY_TILE_BITMAP_HEX = "0".repeat(TILE_BITMAP_HEX_LENGTH);
const MAXIMUM_CHILD_EVENT_COUNT =
  1 +
  GRAND_HALL_T554_NATIVE_TILE_COUNT +
  GRAND_HALL_T554_NATIVE_REVIEW_MAXIMUM_TELEMETRY_EVENTS;
const COVERAGE_EVENT_DIGEST_DOMAINS = Object.freeze({
  source: "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_COVERAGE_EVENT_V2",
  mask: "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_MASK_COVERAGE_EVENT_V2",
});
const DWELL_STATE_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_DWELL_STATE_V2";

type Sha256 = `sha256:${string}`;
type CoverageDisqualifier =
  GrandHallT554NativeReviewCoverageObservedPayloadV2["derived"]["disqualifier"];
type SourceStartEvent = Extract<
  GrandHallT554NativeReviewSourceChildEventV2,
  { readonly eventType: "source.review-started.v2" }
>;
type MaskStartEvent = Extract<
  GrandHallT554NativeReviewMaskChildEventV2,
  { readonly eventType: "mask.review-started.v2" }
>;

export interface GrandHallT554NativeReviewCoverageReplaySnapshotV2 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-review-coverage-replay-snapshot.v2";
  readonly kind: "source" | "mask";
  readonly subjectSha256: Sha256;
  readonly browserEpochNonceSha256: Sha256;
  readonly sourceEpochNonceSha256: Sha256;
  readonly coverageSegmentIdSha256: Sha256;
  readonly renderGeneration: number;
  readonly childEventCount: number;
  readonly uniqueDeliveredTileCount: number;
  readonly coverageEventCount: number;
  readonly lastCoverageEventSha256: Sha256 | null;
  readonly deliveredTileBitsetHex: string;
  readonly cappedDwellMsUint16LeBase64url: string;
  readonly cappedDwellBytesSha256: Sha256;
  readonly cumulativeDwellStateSha256: Sha256;
  readonly completedTileBitsetHex: string;
  readonly completedTileCount: number;
  readonly complete: boolean;
}

export interface GrandHallT554NativeReviewSourceChildReplayV2 {
  readonly kind: "source";
  readonly scope: GrandHallT554NativeReviewSourceScopeV2;
  readonly started: SourceStartEvent["payload"];
  readonly coverage: GrandHallT554NativeReviewCoverageReplaySnapshotV2;
}

export interface GrandHallT554NativeReviewMaskChildReplayV2 {
  readonly kind: "mask";
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly started: MaskStartEvent["payload"];
  readonly coverage: GrandHallT554NativeReviewCoverageReplaySnapshotV2;
}

export type GrandHallT554NativeReviewChildReplayV2 =
  | GrandHallT554NativeReviewSourceChildReplayV2
  | GrandHallT554NativeReviewMaskChildReplayV2;

export type {
  GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
  GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2,
  GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2,
} from "./grand-hall-t554-native-review-durable-journal-v2.js";

export class GrandHallT554NativeReviewReplayV2Error extends Error {
  constructor(
    readonly code:
      | "ARGUMENT_INVALID"
      | "EVENT_INVALID"
      | "TRANSITION_INVALID"
      | "BINDING_MISMATCH"
      | "DERIVED_MISMATCH"
      | "CLOCK_INVALID"
      | "EVENT_LIMIT_REACHED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewReplayV2Error";
  }
}

interface ReplayBindings {
  readonly kind: "source" | "mask";
  readonly browserEpochNonceSha256: Sha256;
  readonly sourceEpochNonceSha256: Sha256;
  readonly coverageSegmentIdSha256: Sha256;
  readonly subjectSha256: Sha256;
  readonly renderGeneration: number;
  readonly segmentStartedAtUtc: string;
}

interface PreviousCoverageSample {
  readonly monotonicElapsedMs: number;
  readonly eligibleTiles: ReadonlySet<number>;
  readonly currentDisqualifier: Exclude<
    CoverageDisqualifier,
    "first_sample" | "heartbeat_gap_exceeded" | "no_continuously_visible_tiles"
  >;
}

interface ReplayAccumulator {
  readonly bindings: ReplayBindings;
  readonly deliveredTiles: Set<number>;
  readonly dwellBytes: Buffer;
  childEventCount: number;
  coverageEventCount: number;
  lastCoverageEventSha256: Sha256 | null;
  previousCoverageSample: PreviousCoverageSample | undefined;
  lastServerInstantMs: number;
}

function sha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalDigest(domain: string, value: unknown): Sha256 {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return sha256(
    Buffer.from(`${domain}\n${stableCanonicalJson(canonical)}`, "utf8"),
  );
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return (
      stableCanonicalJson(CanonicalJsonValueSchema.parse(left)) ===
      stableCanonicalJson(CanonicalJsonValueSchema.parse(right))
    );
  } catch {
    return false;
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const child of Object.values(
    value as Readonly<Record<string, unknown>>,
  )) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function frozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function assertVerifiedDurableChildEvidence(
  evidence: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
  expectedKind: "source" | "mask",
): void {
  if (
    !isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2(
      evidence,
    ) ||
    evidence.kind !== expectedKind
  ) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "ARGUMENT_INVALID",
      "Child replay requires exact evidence emitted by the verified durable-journal adapter.",
    );
  }
}

function assertBinding(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "BINDING_MISMATCH",
      message,
    );
  }
}

function assertTransition(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "TRANSITION_INVALID",
      message,
    );
  }
}

function parseCanonicalInstant(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "CLOCK_INVALID",
      `${label} is not one canonical UTC millisecond instant.`,
    );
  }
  return milliseconds;
}

function bitmapFromIndexes(indexes: ReadonlySet<number>): string {
  const bytes = Buffer.alloc(TILE_BITMAP_BYTE_LENGTH);
  try {
    for (const index of indexes) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= GRAND_HALL_T554_NATIVE_TILE_COUNT
      ) {
        throw new GrandHallT554NativeReviewReplayV2Error(
          "DERIVED_MISMATCH",
          "A derived tile index is outside the exact native grid.",
        );
      }
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << bitIndex);
    }
    return bytes.toString("hex");
  } finally {
    bytes.fill(0);
  }
}

function indexesFromBitmap(value: string): ReadonlySet<number> {
  if (
    !new RegExp(`^[a-f0-9]{${String(TILE_BITMAP_HEX_LENGTH)}}$`, "u").test(
      value,
    )
  ) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "EVENT_INVALID",
      "A native-grid bitmap is not the exact canonical 512-bit encoding.",
    );
  }
  const bytes = Buffer.from(value, "hex");
  const indexes = new Set<number>();
  try {
    for (let index = 0; index < GRAND_HALL_T554_NATIVE_TILE_COUNT; index += 1) {
      const byte = bytes[Math.floor(index / 8)] ?? 0;
      if ((byte & (1 << (index % 8))) !== 0) indexes.add(index);
    }
    return indexes;
  } finally {
    bytes.fill(0);
  }
}

function intersectIndexes(
  left: ReadonlySet<number>,
  right: ReadonlySet<number>,
): ReadonlySet<number> {
  const intersection = new Set<number>();
  for (const index of left) {
    if (right.has(index)) intersection.add(index);
  }
  return intersection;
}

function completedIndexes(dwellBytes: Buffer): ReadonlySet<number> {
  const completed = new Set<number>();
  for (let index = 0; index < GRAND_HALL_T554_NATIVE_TILE_COUNT; index += 1) {
    if (
      dwellBytes.readUInt16LE(index * 2) ===
      GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE
    ) {
      completed.add(index);
    }
  }
  return completed;
}

function cumulativeDwellStateSha256(dwellBytes: Buffer): Sha256 {
  return sha256(
    Buffer.concat([
      Buffer.from(`${DWELL_STATE_DIGEST_DOMAIN}\n`, "utf8"),
      dwellBytes,
    ]),
  );
}

export function computeGrandHallT554NativeReviewCoverageEventV2Sha256(
  kind: "source" | "mask",
  payload: Omit<
    GrandHallT554NativeReviewCoverageObservedPayloadV2,
    "coverageEventSha256"
  >,
): Sha256 {
  return canonicalDigest(COVERAGE_EVENT_DIGEST_DOMAINS[kind], payload);
}

function seedDwellBytes(
  carry:
    | GrandHallT554NativeReviewSourceCoverageCarryStateV2
    | GrandHallT554NativeReviewMaskCoverageCarryStateV2
    | null,
): Buffer {
  if (carry === null) return Buffer.alloc(DWELL_VECTOR_BYTE_LENGTH);
  const bytes = Buffer.from(carry.cappedDwellMsUint16LeBase64url, "base64url");
  if (
    bytes.length !== DWELL_VECTOR_BYTE_LENGTH ||
    sha256(bytes) !== carry.cappedDwellBytesSha256 ||
    cumulativeDwellStateSha256(bytes) !== carry.cumulativeDwellStateSha256
  ) {
    bytes.fill(0);
    throw new GrandHallT554NativeReviewReplayV2Error(
      "DERIVED_MISMATCH",
      "The predecessor dwell vector does not match its exact digest bindings.",
    );
  }
  const completed = completedIndexes(bytes);
  if (
    bitmapFromIndexes(completed) !== carry.completedTileBitsetHex ||
    completed.size !== carry.completedTileCount
  ) {
    bytes.fill(0);
    throw new GrandHallT554NativeReviewReplayV2Error(
      "DERIVED_MISMATCH",
      "The predecessor dwell vector does not match its completion witnesses.",
    );
  }
  return bytes;
}

function sourceStableCustodyEqual(
  left: GrandHallT554NativeReviewSourceScopeV2["sourceCustody"],
  right: GrandHallT554NativeReviewSourceScopeV2["sourceCustody"],
): boolean {
  return (
    canonicalEqual(left.source, right.source) &&
    canonicalEqual(left.sourceVerification, right.sourceVerification) &&
    left.sourceReviewSubjectSha256 === right.sourceReviewSubjectSha256
  );
}

function validateSourceStart(
  scope: GrandHallT554NativeReviewSourceScopeV2,
  start: SourceStartEvent["payload"],
): ReplayAccumulator {
  assertBinding(
    start.browserEpochNonceSha256 === scope.browserEpochNonceSha256,
    "Source start browser epoch differs from its journal scope.",
  );
  assertBinding(
    start.coverageSegmentIdSha256 === scope.coverageSegmentIdSha256,
    "Source start coverage segment differs from its journal scope.",
  );
  assertBinding(
    start.renderGeneration === scope.renderGeneration,
    "Source start generation differs from its journal scope.",
  );
  assertBinding(
    canonicalEqual(start.sourceCustody, scope.sourceCustody),
    "Source start custody differs from its journal scope.",
  );
  assertBinding(
    canonicalEqual(start.registry, scope.registry),
    "Source start registry differs from its journal scope.",
  );
  assertBinding(
    canonicalEqual(start.implementationManifest, scope.implementationManifest),
    "Source start implementation differs from its journal scope.",
  );
  assertBinding(
    canonicalEqual(start.authorityBoundary, scope.authorityBoundary),
    "Source start authority boundary differs from its journal scope.",
  );
  const startedAt = parseCanonicalInstant(
    start.coverageSegmentStartedAtUtc,
    "Source coverage-segment start",
  );
  if (start.predecessorCoverage !== null) {
    const predecessor = start.predecessorCoverage;
    assertBinding(
      predecessor.sessionIdSha256 === scope.sessionIdSha256,
      "Predecessor source coverage belongs to a different session.",
    );
    assertBinding(
      canonicalEqual(predecessor.registry, scope.registry),
      "Predecessor source coverage used a different registry.",
    );
    assertBinding(
      predecessor.subjectSha256 ===
        scope.sourceCustody.sourceReviewSubjectSha256,
      "Predecessor source coverage subject differs from the current stable subject.",
    );
    assertBinding(
      canonicalEqual(
        predecessor.implementationManifest,
        scope.implementationManifest,
      ),
      "Predecessor source coverage used a different implementation.",
    );
    assertBinding(
      sourceStableCustodyEqual(predecessor.sourceCustody, scope.sourceCustody),
      "Predecessor source coverage used different source/decode custody.",
    );
    assertBinding(
      predecessor.priorBrowserEpochNonceSha256 !==
        scope.browserEpochNonceSha256,
      "Resumed source coverage reused the predecessor browser epoch.",
    );
    assertBinding(
      predecessor.priorCoverageSegmentIdSha256 !==
        scope.coverageSegmentIdSha256,
      "Resumed source coverage reused the predecessor coverage segment.",
    );
    assertBinding(
      predecessor.priorSourceEpochBindingSha256 !==
        scope.sourceCustody.sourceEpochBindingSha256 &&
        predecessor.priorSourceEpochNonceSha256 !==
          scope.sourceCustody.sourceEpochNonceSha256,
      "Resumed source coverage reused the predecessor source epoch.",
    );
    assertTransition(
      scope.sourceCustody.sourceEpochRenderGeneration >
        predecessor.priorSourceEpochRenderGeneration &&
        scope.renderGeneration > predecessor.priorRenderGeneration,
      "Resumed source coverage did not advance render generations.",
    );
    assertTransition(
      startedAt >=
        parseCanonicalInstant(
          predecessor.predecessorFinalDurableRecordedAtUtc,
          "Predecessor source child final durable record",
        ),
      "Resumed source coverage starts before its predecessor journal ended.",
    );
  }
  return {
    bindings: {
      kind: "source",
      browserEpochNonceSha256: scope.browserEpochNonceSha256,
      sourceEpochNonceSha256: scope.sourceCustody.sourceEpochNonceSha256,
      coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
      subjectSha256: scope.sourceCustody.sourceReviewSubjectSha256,
      renderGeneration: scope.renderGeneration,
      segmentStartedAtUtc: start.coverageSegmentStartedAtUtc,
    },
    deliveredTiles: new Set<number>(),
    dwellBytes: seedDwellBytes(start.predecessorCoverage),
    childEventCount: 1,
    coverageEventCount: 0,
    lastCoverageEventSha256: null,
    previousCoverageSample: undefined,
    lastServerInstantMs: startedAt,
  };
}

function validateMaskStart(
  scope: GrandHallT554NativeReviewMaskScopeV2,
  start: MaskStartEvent["payload"],
): ReplayAccumulator {
  assertBinding(
    start.browserEpochNonceSha256 === scope.browserEpochNonceSha256,
    "Mask start browser epoch differs from its journal scope.",
  );
  assertBinding(
    start.coverageSegmentIdSha256 === scope.coverageSegmentIdSha256,
    "Mask start coverage segment differs from its journal scope.",
  );
  assertBinding(
    start.renderGeneration === scope.renderGeneration,
    "Mask start generation differs from its journal scope.",
  );
  assertBinding(
    canonicalEqual(start.sourceCustody, scope.sourceCustody),
    "Mask start source custody differs from its journal scope.",
  );
  assertBinding(
    start.maskReviewSubjectSha256 === scope.maskReviewSubjectSha256,
    "Mask start subject differs from its journal scope.",
  );
  assertBinding(
    start.maskStateSha256 === scope.maskStateSha256,
    "Mask start state differs from its journal scope.",
  );
  assertBinding(
    start.frozenBindingSha256 === scope.frozenBindingSha256,
    "Mask start frozen digest differs from its journal scope.",
  );
  assertBinding(
    canonicalEqual(start.frozenBinding, scope.frozenBinding),
    "Mask start frozen binding differs from its journal scope.",
  );
  assertBinding(
    canonicalEqual(start.implementationManifest, scope.implementationManifest),
    "Mask start implementation differs from its journal scope.",
  );
  assertBinding(
    canonicalEqual(start.authorityBoundary, scope.authorityBoundary),
    "Mask start authority boundary differs from its journal scope.",
  );
  const startedAt = parseCanonicalInstant(
    start.coverageSegmentStartedAtUtc,
    "Mask coverage-segment start",
  );
  if (start.predecessorCoverage !== null) {
    const predecessor = start.predecessorCoverage;
    assertBinding(
      predecessor.sessionIdSha256 === scope.sessionIdSha256,
      "Predecessor mask coverage belongs to a different session.",
    );
    assertBinding(
      canonicalEqual(predecessor.registry, scope.registry),
      "Predecessor mask coverage used a different registry.",
    );
    assertBinding(
      predecessor.subjectSha256 === scope.maskReviewSubjectSha256,
      "Predecessor mask coverage subject differs from the current subject.",
    );
    assertBinding(
      predecessor.maskStateSha256 === scope.maskStateSha256,
      "Predecessor mask coverage state differs from the current state.",
    );
    assertBinding(
      predecessor.frozenBindingSha256 === scope.frozenBindingSha256,
      "Predecessor mask coverage frozen digest differs from the current binding.",
    );
    assertBinding(
      canonicalEqual(predecessor.frozenBinding, scope.frozenBinding),
      "Predecessor mask coverage frozen binding differs from the current binding.",
    );
    assertBinding(
      canonicalEqual(
        predecessor.implementationManifest,
        scope.implementationManifest,
      ),
      "Predecessor mask coverage used a different implementation.",
    );
    assertBinding(
      sourceStableCustodyEqual(predecessor.sourceCustody, scope.sourceCustody),
      "Predecessor mask coverage used different source/decode custody.",
    );
    assertBinding(
      predecessor.priorBrowserEpochNonceSha256 !==
        scope.browserEpochNonceSha256,
      "Resumed mask coverage reused the predecessor browser epoch.",
    );
    assertBinding(
      predecessor.priorCoverageSegmentIdSha256 !==
        scope.coverageSegmentIdSha256,
      "Resumed mask coverage reused the predecessor coverage segment.",
    );
    assertBinding(
      predecessor.priorSourceEpochBindingSha256 !==
        scope.sourceCustody.sourceEpochBindingSha256 &&
        predecessor.priorSourceEpochNonceSha256 !==
          scope.sourceCustody.sourceEpochNonceSha256,
      "Resumed mask coverage reused the predecessor source epoch.",
    );
    assertTransition(
      scope.sourceCustody.sourceEpochRenderGeneration >
        predecessor.priorSourceEpochRenderGeneration &&
        scope.renderGeneration > predecessor.priorRenderGeneration,
      "Resumed mask coverage did not advance render generations.",
    );
    assertTransition(
      startedAt >=
        parseCanonicalInstant(
          predecessor.predecessorFinalDurableRecordedAtUtc,
          "Predecessor mask child final durable record",
        ),
      "Resumed mask coverage starts before its predecessor journal ended.",
    );
  }
  return {
    bindings: {
      kind: "mask",
      browserEpochNonceSha256: scope.browserEpochNonceSha256,
      sourceEpochNonceSha256: scope.sourceCustody.sourceEpochNonceSha256,
      coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
      subjectSha256: scope.maskReviewSubjectSha256,
      renderGeneration: scope.renderGeneration,
      segmentStartedAtUtc: start.coverageSegmentStartedAtUtc,
    },
    deliveredTiles: new Set<number>(),
    dwellBytes: seedDwellBytes(start.predecessorCoverage),
    childEventCount: 1,
    coverageEventCount: 0,
    lastCoverageEventSha256: null,
    previousCoverageSample: undefined,
    lastServerInstantMs: startedAt,
  };
}

function assertEventBindings(
  accumulator: ReplayAccumulator,
  payload: Pick<
    GrandHallT554NativeReviewTileDeliveredPayloadV2,
    | "browserEpochNonceSha256"
    | "sourceEpochNonceSha256"
    | "coverageSegmentIdSha256"
    | "subjectSha256"
    | "renderGeneration"
  >,
): void {
  const binding = accumulator.bindings;
  assertBinding(
    payload.browserEpochNonceSha256 === binding.browserEpochNonceSha256,
    "Child event browser epoch differs from its start event.",
  );
  assertBinding(
    payload.sourceEpochNonceSha256 === binding.sourceEpochNonceSha256,
    "Child event source epoch differs from its start event.",
  );
  assertBinding(
    payload.coverageSegmentIdSha256 === binding.coverageSegmentIdSha256,
    "Child event coverage segment differs from its start event.",
  );
  assertBinding(
    payload.subjectSha256 === binding.subjectSha256,
    "Child event subject differs from its start event.",
  );
  assertBinding(
    payload.renderGeneration === binding.renderGeneration,
    "Child event generation differs from its start event.",
  );
}

function advanceServerInstant(
  accumulator: ReplayAccumulator,
  value: string,
  label: string,
): void {
  const milliseconds = parseCanonicalInstant(value, label);
  if (milliseconds < accumulator.lastServerInstantMs) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "CLOCK_INVALID",
      `${label} moves backwards within the child journal.`,
    );
  }
  accumulator.lastServerInstantMs = milliseconds;
}

function replayDelivery(
  accumulator: ReplayAccumulator,
  payload: GrandHallT554NativeReviewTileDeliveredPayloadV2,
): void {
  assertEventBindings(accumulator, payload);
  advanceServerInstant(
    accumulator,
    payload.responseFinishedAtUtc,
    "Tile response finish",
  );
  assertTransition(
    !accumulator.deliveredTiles.has(payload.tileIndex),
    "A child journal contains a duplicate first-delivery event.",
  );
  accumulator.deliveredTiles.add(payload.tileIndex);
  accumulator.childEventCount += 1;
}

function fullyVisibleDeliveredTiles(
  payload: GrandHallT554NativeReviewCoverageObservedPayloadV2,
  deliveredTiles: ReadonlySet<number>,
): ReadonlySet<number> {
  const paintedTiles = indexesFromBitmap(
    payload.telemetry.paintedTileBitsetHex,
  );
  const matrix = payload.telemetry.sourceToCssTransform;
  const epsilon = 1e-7;
  const visible = new Set<number>();
  for (let row = 0; row < GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT; row += 1) {
    for (
      let column = 0;
      column < GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT;
      column += 1
    ) {
      const index = row * GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT + column;
      if (!deliveredTiles.has(index) || !paintedTiles.has(index)) continue;
      const left =
        column * GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX * matrix.a + matrix.e;
      const right =
        (column + 1) * GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX * matrix.a +
        matrix.e;
      const top =
        row * GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX * matrix.d + matrix.f;
      const bottom =
        (row + 1) * GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX * matrix.d + matrix.f;
      if (
        left >= -epsilon &&
        top >= -epsilon &&
        right <= payload.telemetry.viewportCssWidth + epsilon &&
        bottom <= payload.telemetry.viewportCssHeight + epsilon
      )
        visible.add(index);
    }
  }
  return visible;
}

function currentEligibilityDisqualifier(
  payload: GrandHallT554NativeReviewCoverageObservedPayloadV2,
  visibleCount: number,
): PreviousCoverageSample["currentDisqualifier"] {
  if (payload.telemetry.documentVisibilityState !== "visible") {
    return "document_not_visible";
  }
  if (payload.telemetry.documentFocusState !== "focused") {
    return "document_not_focused";
  }
  const matrix = payload.telemetry.sourceToCssTransform;
  if (Math.min(matrix.a, matrix.d) * payload.telemetry.devicePixelRatio < 1) {
    return "below_native_device_scale";
  }
  if (visibleCount === 0) return "no_fully_visible_delivered_tiles";
  return null;
}

function applyCreditedDwell(
  dwellBytes: Buffer,
  creditedTiles: ReadonlySet<number>,
  creditedDurationMs: number,
): void {
  for (const index of creditedTiles) {
    const offset = index * 2;
    const current = dwellBytes.readUInt16LE(offset);
    dwellBytes.writeUInt16LE(
      Math.min(
        GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE,
        current + creditedDurationMs,
      ),
      offset,
    );
  }
}

function expectedCoverageDerived(
  accumulator: ReplayAccumulator,
  payload: GrandHallT554NativeReviewCoverageObservedPayloadV2,
): GrandHallT554NativeReviewCoverageObservedPayloadV2["derived"] {
  const visibleTiles = fullyVisibleDeliveredTiles(
    payload,
    accumulator.deliveredTiles,
  );
  const currentDisqualifier = currentEligibilityDisqualifier(
    payload,
    visibleTiles.size,
  );
  const currentEligibleTiles =
    currentDisqualifier === null ? visibleTiles : new Set<number>();
  const previous = accumulator.previousCoverageSample;
  const monotonicDeltaMs =
    previous === undefined
      ? 0
      : payload.serverObservation.monotonicElapsedMs -
        previous.monotonicElapsedMs;
  if (monotonicDeltaMs < 0) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "CLOCK_INVALID",
      "Coverage monotonic position moves backwards within one segment.",
    );
  }
  let creditedTiles: ReadonlySet<number> = new Set<number>();
  let creditedDurationMs = 0;
  let disqualifier: CoverageDisqualifier;
  if (previous === undefined) {
    disqualifier = "first_sample";
  } else if (currentDisqualifier !== null) {
    disqualifier = currentDisqualifier;
  } else if (
    monotonicDeltaMs > GRAND_HALL_T554_MAXIMUM_CREDITED_HEARTBEAT_GAP_MS
  ) {
    disqualifier = "heartbeat_gap_exceeded";
  } else if (previous.currentDisqualifier !== null) {
    disqualifier = previous.currentDisqualifier;
  } else {
    creditedTiles = intersectIndexes(
      previous.eligibleTiles,
      currentEligibleTiles,
    );
    if (creditedTiles.size === 0) {
      disqualifier = "no_continuously_visible_tiles";
    } else {
      creditedDurationMs = monotonicDeltaMs;
      disqualifier = null;
      applyCreditedDwell(
        accumulator.dwellBytes,
        creditedTiles,
        creditedDurationMs,
      );
    }
  }
  const completed = completedIndexes(accumulator.dwellBytes);
  accumulator.previousCoverageSample = {
    monotonicElapsedMs: payload.serverObservation.monotonicElapsedMs,
    eligibleTiles: currentEligibleTiles,
    currentDisqualifier,
  };
  return {
    effectiveDevicePixelsPerSourcePixel:
      Math.min(
        payload.telemetry.sourceToCssTransform.a,
        payload.telemetry.sourceToCssTransform.d,
      ) * payload.telemetry.devicePixelRatio,
    serverMonotonicDeltaMs: monotonicDeltaMs,
    deliveredTileBitsetHex: bitmapFromIndexes(accumulator.deliveredTiles),
    fullyVisibleDeliveredTileBitsetHex: bitmapFromIndexes(visibleTiles),
    creditedTileBitsetHex: bitmapFromIndexes(creditedTiles),
    creditedDurationMs,
    disqualifier,
    completedTileBitsetHex: bitmapFromIndexes(completed),
    completedTileCount: completed.size,
    cumulativeDwellStateSha256: cumulativeDwellStateSha256(
      accumulator.dwellBytes,
    ),
  };
}

function replayCoverage(
  accumulator: ReplayAccumulator,
  payload: GrandHallT554NativeReviewCoverageObservedPayloadV2,
): void {
  assertEventBindings(accumulator, payload);
  assertTransition(
    payload.sequence === accumulator.coverageEventCount,
    "Coverage observations must use one gap-free sequence.",
  );
  assertTransition(
    payload.previousCoverageEventSha256 === accumulator.lastCoverageEventSha256,
    "Coverage observation predecessor digest does not match replay state.",
  );
  advanceServerInstant(
    accumulator,
    payload.serverObservation.receivedAtUtc,
    "Coverage observation receipt",
  );
  const expected = expectedCoverageDerived(accumulator, payload);
  if (!canonicalEqual(payload.derived, expected)) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "DERIVED_MISMATCH",
      "Coverage witnesses do not match strict replay of server-owned state.",
    );
  }
  const { coverageEventSha256, ...material } = payload;
  const expectedEventSha256 =
    computeGrandHallT554NativeReviewCoverageEventV2Sha256(
      accumulator.bindings.kind,
      material,
    );
  if (coverageEventSha256 !== expectedEventSha256) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "DERIVED_MISMATCH",
      "Coverage event digest does not match its exact canonical material.",
    );
  }
  accumulator.lastCoverageEventSha256 = coverageEventSha256;
  accumulator.coverageEventCount += 1;
  accumulator.childEventCount += 1;
}

function snapshotReplay(
  accumulator: ReplayAccumulator,
): GrandHallT554NativeReviewCoverageReplaySnapshotV2 {
  const completed = completedIndexes(accumulator.dwellBytes);
  const dwellBase64url = accumulator.dwellBytes.toString("base64url");
  return Object.freeze({
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-replay-snapshot.v2" as const,
    kind: accumulator.bindings.kind,
    subjectSha256: accumulator.bindings.subjectSha256,
    browserEpochNonceSha256: accumulator.bindings.browserEpochNonceSha256,
    sourceEpochNonceSha256: accumulator.bindings.sourceEpochNonceSha256,
    coverageSegmentIdSha256: accumulator.bindings.coverageSegmentIdSha256,
    renderGeneration: accumulator.bindings.renderGeneration,
    childEventCount: accumulator.childEventCount,
    uniqueDeliveredTileCount: accumulator.deliveredTiles.size,
    coverageEventCount: accumulator.coverageEventCount,
    lastCoverageEventSha256: accumulator.lastCoverageEventSha256,
    deliveredTileBitsetHex: bitmapFromIndexes(accumulator.deliveredTiles),
    cappedDwellMsUint16LeBase64url: dwellBase64url,
    cappedDwellBytesSha256: sha256(accumulator.dwellBytes),
    cumulativeDwellStateSha256: cumulativeDwellStateSha256(
      accumulator.dwellBytes,
    ),
    completedTileBitsetHex: bitmapFromIndexes(completed),
    completedTileCount: completed.size,
    complete: completed.size === GRAND_HALL_T554_NATIVE_TILE_COUNT,
  });
}

function assertChildEventLimit(length: number): void {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "ARGUMENT_INVALID",
      "A v2 child replay requires at least its typed start event.",
    );
  }
  if (length > MAXIMUM_CHILD_EVENT_COUNT) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "EVENT_LIMIT_REACHED",
      "The v2 child event inventory exceeds its fixed replay bound.",
    );
  }
}

export interface GrandHallT554NativeReviewValidatedSourceChildSequenceV2 {
  readonly replay: GrandHallT554NativeReviewSourceChildReplayV2;
  readonly latestServerOwnedAtUtc: string;
}

export interface GrandHallT554NativeReviewValidatedMaskChildSequenceV2 {
  readonly replay: GrandHallT554NativeReviewMaskChildReplayV2;
  readonly latestServerOwnedAtUtc: string;
}

/**
 * Validates an untrusted in-memory sequence. This conveys no durability or
 * review authority; the durable-journal adapter uses it before reserving a
 * record on disk.
 */
export function validateGrandHallT554NativeReviewSourceChildSequenceV2(input: {
  readonly scope: unknown;
  readonly events: readonly unknown[];
}): GrandHallT554NativeReviewValidatedSourceChildSequenceV2 {
  const scopeResult = GrandHallT554NativeReviewSourceScopeV2Schema.safeParse(
    input.scope,
  );
  if (!scopeResult.success) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "ARGUMENT_INVALID",
      "The source child scope is not the exact v2 schema.",
      scopeResult.error,
    );
  }
  assertChildEventLimit(input.events.length);
  const parsed = input.events.map((event, index) => {
    const result =
      GrandHallT554NativeReviewSourceChildEventV2Schema.safeParse(event);
    if (!result.success) {
      throw new GrandHallT554NativeReviewReplayV2Error(
        "EVENT_INVALID",
        `Source child event ${String(index + 1)} is not an exact typed v2 event.`,
        result.error,
      );
    }
    return result.data;
  });
  const first = parsed[0];
  assertTransition(
    first?.eventType === "source.review-started.v2",
    "Source child replay must begin with exactly one source start event.",
  );
  const accumulator = validateSourceStart(scopeResult.data, first.payload);
  try {
    for (const event of parsed.slice(1)) {
      if (event.eventType === "source.review-started.v2") {
        throw new GrandHallT554NativeReviewReplayV2Error(
          "TRANSITION_INVALID",
          "Source child replay contains a second start event.",
        );
      }
      if (event.eventType === "source.tile-delivered.v2") {
        replayDelivery(accumulator, event.payload);
      } else {
        replayCoverage(accumulator, event.payload);
      }
    }
    return Object.freeze({
      replay: Object.freeze({
        kind: "source" as const,
        scope: frozenClone(scopeResult.data),
        started: frozenClone(first.payload),
        coverage: snapshotReplay(accumulator),
      }),
      latestServerOwnedAtUtc: new Date(
        accumulator.lastServerInstantMs,
      ).toISOString(),
    });
  } finally {
    accumulator.dwellBytes.fill(0);
    accumulator.deliveredTiles.clear();
  }
}

/**
 * Validates an untrusted in-memory sequence. This conveys no durability or
 * review authority; the durable-journal adapter uses it before reserving a
 * record on disk.
 */
export function validateGrandHallT554NativeReviewMaskChildSequenceV2(input: {
  readonly scope: unknown;
  readonly events: readonly unknown[];
}): GrandHallT554NativeReviewValidatedMaskChildSequenceV2 {
  const scopeResult = GrandHallT554NativeReviewMaskScopeV2Schema.safeParse(
    input.scope,
  );
  if (!scopeResult.success) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "ARGUMENT_INVALID",
      "The mask child scope is not the exact v2 schema.",
      scopeResult.error,
    );
  }
  assertChildEventLimit(input.events.length);
  const parsed = input.events.map((event, index) => {
    const result =
      GrandHallT554NativeReviewMaskChildEventV2Schema.safeParse(event);
    if (!result.success) {
      throw new GrandHallT554NativeReviewReplayV2Error(
        "EVENT_INVALID",
        `Mask child event ${String(index + 1)} is not an exact typed v2 event.`,
        result.error,
      );
    }
    return result.data;
  });
  const first = parsed[0];
  assertTransition(
    first?.eventType === "mask.review-started.v2",
    "Mask child replay must begin with exactly one mask start event.",
  );
  const accumulator = validateMaskStart(scopeResult.data, first.payload);
  try {
    for (const event of parsed.slice(1)) {
      if (event.eventType === "mask.review-started.v2") {
        throw new GrandHallT554NativeReviewReplayV2Error(
          "TRANSITION_INVALID",
          "Mask child replay contains a second start event.",
        );
      }
      if (event.eventType === "mask.tile-delivered.v2") {
        replayDelivery(accumulator, event.payload);
      } else {
        replayCoverage(accumulator, event.payload);
      }
    }
    return Object.freeze({
      replay: Object.freeze({
        kind: "mask" as const,
        scope: frozenClone(scopeResult.data),
        started: frozenClone(first.payload),
        coverage: snapshotReplay(accumulator),
      }),
      latestServerOwnedAtUtc: new Date(
        accumulator.lastServerInstantMs,
      ).toISOString(),
    });
  } finally {
    accumulator.dwellBytes.fill(0);
    accumulator.deliveredTiles.clear();
  }
}

export function replayGrandHallT554NativeReviewSourceChildV2(
  evidence: GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2,
): GrandHallT554NativeReviewSourceChildReplayV2 {
  assertVerifiedDurableChildEvidence(evidence, "source");
  const checkpointResult =
    GrandHallT554NativeReviewSourceChildCheckpointV2Schema.safeParse(
      evidence.checkpoint,
    );
  if (
    !checkpointResult.success ||
    checkpointResult.data.revision !== evidence.events.length
  ) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "BINDING_MISMATCH",
      "Source child checkpoint does not bind the exact durable event inventory.",
      checkpointResult.success ? undefined : checkpointResult.error,
    );
  }
  const validated =
    validateGrandHallT554NativeReviewSourceChildSequenceV2(evidence);
  if (
    parseCanonicalInstant(
      evidence.finalDurableRecordedAtUtc,
      "Source child final durable record",
    ) < Date.parse(validated.latestServerOwnedAtUtc)
  ) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "CLOCK_INVALID",
      "Source child final durable record precedes its server-owned event time.",
    );
  }
  return validated.replay;
}

export function replayGrandHallT554NativeReviewMaskChildV2(
  evidence: GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2,
): GrandHallT554NativeReviewMaskChildReplayV2 {
  assertVerifiedDurableChildEvidence(evidence, "mask");
  const checkpointResult =
    GrandHallT554NativeReviewMaskChildCheckpointV2Schema.safeParse(
      evidence.checkpoint,
    );
  if (
    !checkpointResult.success ||
    checkpointResult.data.revision !== evidence.events.length
  ) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "BINDING_MISMATCH",
      "Mask child checkpoint does not bind the exact durable event inventory.",
      checkpointResult.success ? undefined : checkpointResult.error,
    );
  }
  const validated =
    validateGrandHallT554NativeReviewMaskChildSequenceV2(evidence);
  if (
    parseCanonicalInstant(
      evidence.finalDurableRecordedAtUtc,
      "Mask child final durable record",
    ) < Date.parse(validated.latestServerOwnedAtUtc)
  ) {
    throw new GrandHallT554NativeReviewReplayV2Error(
      "CLOCK_INVALID",
      "Mask child final durable record precedes its server-owned event time.",
    );
  }
  return validated.replay;
}

export function createGrandHallT554NativeReviewCoverageCarryStateV2(
  evidence: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
):
  | GrandHallT554NativeReviewSourceCoverageCarryStateV2
  | GrandHallT554NativeReviewMaskCoverageCarryStateV2 {
  const replay =
    evidence.kind === "source"
      ? replayGrandHallT554NativeReviewSourceChildV2(evidence)
      : replayGrandHallT554NativeReviewMaskChildV2(evidence);
  const coverage = replay.coverage;
  assertTransition(
    coverage.coverageEventCount > 0,
    "Coverage carry requires at least one durably replayed observation.",
  );
  if (replay.kind === "source") {
    assertTransition(
      evidence.kind === "source",
      "Source replay cannot emit carry from mask evidence.",
    );
    const checkpoint = evidence.checkpoint;
    return frozenClone(
      GrandHallT554NativeReviewSourceCoverageCarryStateV2Schema.parse({
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-coverage-carry-state.v2",
        kind: "source",
        subjectSha256: coverage.subjectSha256,
        predecessorJournal: checkpoint,
        sessionIdSha256: replay.scope.sessionIdSha256,
        registry: replay.scope.registry,
        implementationManifest: replay.scope.implementationManifest,
        sourceCustody: replay.scope.sourceCustody,
        priorBrowserEpochNonceSha256: replay.scope.browserEpochNonceSha256,
        priorSourceEpochBindingSha256:
          replay.scope.sourceCustody.sourceEpochBindingSha256,
        priorSourceEpochNonceSha256:
          replay.scope.sourceCustody.sourceEpochNonceSha256,
        priorSourceEpochRenderGeneration:
          replay.scope.sourceCustody.sourceEpochRenderGeneration,
        priorCoverageSegmentIdSha256: replay.scope.coverageSegmentIdSha256,
        priorRenderGeneration: replay.scope.renderGeneration,
        predecessorFinalDurableRecordedAtUtc:
          evidence.finalDurableRecordedAtUtc,
        cappedDwellMsUint16LeBase64url: coverage.cappedDwellMsUint16LeBase64url,
        cappedDwellBytesSha256: coverage.cappedDwellBytesSha256,
        completedTileBitsetHex: coverage.completedTileBitsetHex,
        completedTileCount: coverage.completedTileCount,
        cumulativeDwellStateSha256: coverage.cumulativeDwellStateSha256,
      }),
    );
  }
  assertTransition(
    evidence.kind === "mask",
    "Mask replay cannot emit carry from source evidence.",
  );
  const checkpoint = evidence.checkpoint;
  return frozenClone(
    GrandHallT554NativeReviewMaskCoverageCarryStateV2Schema.parse({
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-carry-state.v2",
      kind: "mask",
      subjectSha256: coverage.subjectSha256,
      predecessorJournal: checkpoint,
      maskStateSha256: replay.scope.maskStateSha256,
      frozenBindingSha256: replay.scope.frozenBindingSha256,
      frozenBinding: replay.scope.frozenBinding,
      sessionIdSha256: replay.scope.sessionIdSha256,
      registry: replay.scope.registry,
      implementationManifest: replay.scope.implementationManifest,
      sourceCustody: replay.scope.sourceCustody,
      priorBrowserEpochNonceSha256: replay.scope.browserEpochNonceSha256,
      priorSourceEpochBindingSha256:
        replay.scope.sourceCustody.sourceEpochBindingSha256,
      priorSourceEpochNonceSha256:
        replay.scope.sourceCustody.sourceEpochNonceSha256,
      priorSourceEpochRenderGeneration:
        replay.scope.sourceCustody.sourceEpochRenderGeneration,
      priorCoverageSegmentIdSha256: replay.scope.coverageSegmentIdSha256,
      priorRenderGeneration: replay.scope.renderGeneration,
      predecessorFinalDurableRecordedAtUtc: evidence.finalDurableRecordedAtUtc,
      cappedDwellMsUint16LeBase64url: coverage.cappedDwellMsUint16LeBase64url,
      cappedDwellBytesSha256: coverage.cappedDwellBytesSha256,
      completedTileBitsetHex: coverage.completedTileBitsetHex,
      completedTileCount: coverage.completedTileCount,
      cumulativeDwellStateSha256: coverage.cumulativeDwellStateSha256,
    }),
  );
}


export function emptyGrandHallT554NativeReviewTileBitmapV2(): string {
  return EMPTY_TILE_BITMAP_HEX;
}

export function emptyGrandHallT554NativeReviewDwellVectorV2(): {
  readonly cappedDwellMsUint16LeBase64url: string;
  readonly cappedDwellBytesSha256: Sha256;
  readonly cumulativeDwellStateSha256: Sha256;
} {
  const bytes = Buffer.alloc(DWELL_VECTOR_BYTE_LENGTH);
  try {
    return Object.freeze({
      cappedDwellMsUint16LeBase64url: bytes.toString("base64url"),
      cappedDwellBytesSha256: sha256(bytes),
      cumulativeDwellStateSha256: cumulativeDwellStateSha256(bytes),
    });
  } finally {
    bytes.fill(0);
  }
}

export function isGrandHallT554NativeReviewSha256V2(
  value: string,
): value is Sha256 {
  return SHA256_PATTERN.test(value);
}

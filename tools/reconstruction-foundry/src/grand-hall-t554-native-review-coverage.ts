import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  CanonicalJsonValueSchema,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  stableCanonicalJson,
} from "@omnitwin/types";
import { z } from "zod";

export const GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX = 256;
export const GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX = 256;
export const GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX / GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX;
export const GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT =
  GRAND_HALL_PANORAMA_HEIGHT_PX / GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX;
export const GRAND_HALL_T554_NATIVE_TILE_COUNT =
  GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT *
  GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT;
export const GRAND_HALL_T554_NATIVE_TILE_BITMAP_BYTE_LENGTH =
  GRAND_HALL_T554_NATIVE_TILE_COUNT / 8;
export const GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE = 750;
export const GRAND_HALL_T554_MAXIMUM_CREDITED_HEARTBEAT_GAP_MS = 500;

const SESSION_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ZERO_BITMAP_HEX = "00".repeat(
  GRAND_HALL_T554_NATIVE_TILE_BITMAP_BYTE_LENGTH,
);

const SourceToCssTransformSchema = z
  .object({
    a: z.number().finite().positive().max(64),
    b: z.number().finite(),
    c: z.number().finite(),
    d: z.number().finite().positive().max(64),
    e: z.number().finite().min(-1_000_000).max(1_000_000),
    f: z.number().finite().min(-1_000_000).max(1_000_000),
  })
  .strict()
  .superRefine((matrix, ctx) => {
    if (matrix.b !== 0 || matrix.c !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["b"],
        message: "native review forbids rotated or skewed source transforms",
      });
    }
    if (Math.abs(matrix.a - matrix.d) > 1e-9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["d"],
        message: "native review requires one uniform source scale",
      });
    }
  });

const PaintedTileSchema = z
  .object({
    column: z.number().int().min(0).max(GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT - 1),
    row: z.number().int().min(0).max(GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT - 1),
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const GrandHallT554NativeReviewTelemetrySampleV1Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-telemetry-sample.v1",
    ),
    sessionNonce: z.string().regex(SESSION_NONCE_PATTERN),
    sourceEpochNonce: z.string().regex(SESSION_NONCE_PATTERN),
    subjectSha256: z.string().regex(SHA256_PATTERN),
    renderGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    documentVisibilityState: z.enum(["visible", "hidden", "prerender"]),
    documentFocusState: z.enum(["focused", "blurred"]),
    viewportCssWidth: z.number().finite().positive().max(16_384),
    viewportCssHeight: z.number().finite().positive().max(16_384),
    devicePixelRatio: z.number().finite().min(0.25).max(8),
    sourceToCssTransform: SourceToCssTransformSchema,
    paintedTiles: z.array(PaintedTileSchema).max(GRAND_HALL_T554_NATIVE_TILE_COUNT),
  })
  .strict()
  .superRefine((sample, ctx) => {
    const tileKeys = sample.paintedTiles.map((tile) => `${String(tile.row)}:${String(tile.column)}`);
    if (new Set(tileKeys).size !== tileKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paintedTiles"],
        message: "painted tile acknowledgements must be unique",
      });
    }
  });

export type GrandHallT554NativeReviewTelemetrySampleV1 = z.infer<
  typeof GrandHallT554NativeReviewTelemetrySampleV1Schema
>;

export type GrandHallT554NativeReviewCoverageDisqualifierV1 =
  | "first_sample"
  | "document_not_visible"
  | "document_not_focused"
  | "below_native_device_scale"
  | "no_fully_visible_delivered_tiles"
  | "no_continuously_visible_tiles"
  | null;

export interface GrandHallT554NativeReviewCoverageEventV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-coverage-event.v1";
  readonly sequence: number;
  readonly serverReceivedAt: string;
  readonly previousEventSha256: string | null;
  readonly rawTelemetry: GrandHallT554NativeReviewTelemetrySampleV1;
  readonly derived: {
    readonly effectiveDevicePixelsPerSourcePixel: number;
    readonly serverMonotonicDeltaMs: number;
    readonly fullyVisibleDeliveredTileBitsetHex: string;
    readonly creditedTileBitsetHex: string;
    readonly creditedDurationMs: number;
    readonly disqualifier: GrandHallT554NativeReviewCoverageDisqualifierV1;
    readonly completedTileBitsetHex: string;
    readonly completedTileCount: number;
  };
  readonly eventSha256: string;
}

export interface GrandHallT554NativeReviewCoverageSnapshotV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-coverage-snapshot.v1";
  readonly subjectSha256: string;
  readonly sessionNonceSha256: string;
  readonly sourceEpochNonceSha256: string;
  readonly renderGeneration: number;
  readonly eventCount: number;
  readonly lastEventSha256: string | null;
  readonly deliveredTileBitsetHex: string;
  readonly completedTileBitsetHex: string;
  readonly completedTileCount: number;
  readonly minimumDwellMsPerTile: typeof GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE;
  readonly complete: boolean;
}

export interface GrandHallT554NativeReviewCoverageControllerOptions {
  readonly sessionNonce: string;
  readonly sourceEpochNonce: string;
  readonly subjectSha256: string;
  readonly renderGeneration: number;
  readonly wallClock?: () => Date;
  readonly monotonicNowMs?: () => number;
}

export class GrandHallT554NativeReviewCoverageError extends Error {
  constructor(
    readonly code:
      | "SESSION_INVALID"
      | "SUBJECT_INVALID"
      | "TILE_INVALID"
      | "TELEMETRY_INVALID"
      | "SEQUENCE_INVALID"
      | "CLOCK_INVALID",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewCoverageError";
  }
}

function sha256Bytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function semanticDigest(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return sha256Bytes(Buffer.from(`${domain}\n${stableCanonicalJson(canonical)}`, "utf8"));
}

function bitmapFromIndexes(indexes: ReadonlySet<number>): string {
  const bytes = Buffer.alloc(GRAND_HALL_T554_NATIVE_TILE_BITMAP_BYTE_LENGTH);
  for (const index of indexes) {
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << bitIndex);
  }
  return bytes.toString("hex");
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

function tileIndex(column: number, row: number): number {
  return row * GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT + column;
}

function fullyVisibleTileIndexes(
  sample: GrandHallT554NativeReviewTelemetrySampleV1,
  deliveredTileGenerations: ReadonlyMap<number, number>,
): ReadonlySet<number> {
  const acknowledged = new Set(
    sample.paintedTiles
      .filter((tile) => tile.generation === sample.renderGeneration)
      .map((tile) => tileIndex(tile.column, tile.row)),
  );
  const matrix = sample.sourceToCssTransform;
  const epsilon = 1e-7;
  const visible = new Set<number>();
  for (let row = 0; row < GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT; row += 1) {
    for (let column = 0; column < GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT; column += 1) {
      const index = tileIndex(column, row);
      if (
        deliveredTileGenerations.get(index) !== sample.renderGeneration ||
        !acknowledged.has(index)
      ) continue;
      const left = column * GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX * matrix.a + matrix.e;
      const right = (column + 1) * GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX * matrix.a + matrix.e;
      const top = row * GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX * matrix.d + matrix.f;
      const bottom = (row + 1) * GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX * matrix.d + matrix.f;
      if (
        left >= -epsilon &&
        top >= -epsilon &&
        right <= sample.viewportCssWidth + epsilon &&
        bottom <= sample.viewportCssHeight + epsilon
      ) visible.add(index);
    }
  }
  return visible;
}

function eligibilityDisqualifier(
  sample: GrandHallT554NativeReviewTelemetrySampleV1,
  visibleTileCount: number,
): Exclude<GrandHallT554NativeReviewCoverageDisqualifierV1, "first_sample" | "no_continuously_visible_tiles" | null> | null {
  if (sample.documentVisibilityState !== "visible") return "document_not_visible";
  if (sample.documentFocusState !== "focused") return "document_not_focused";
  if (
    Math.min(sample.sourceToCssTransform.a, sample.sourceToCssTransform.d) *
      sample.devicePixelRatio < 1
  ) return "below_native_device_scale";
  if (visibleTileCount === 0) return "no_fully_visible_delivered_tiles";
  return null;
}

function canonicalServerInstant(date: Date): string {
  const milliseconds = date.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new GrandHallT554NativeReviewCoverageError(
      "CLOCK_INVALID",
      "server clock did not return a finite instant",
    );
  }
  return new Date(milliseconds).toISOString();
}

export class GrandHallT554NativeReviewCoverageControllerV1 {
  private readonly sessionNonce: string;
  private readonly sourceEpochNonce: string;
  private readonly subjectSha256: string;
  private readonly renderGeneration: number;
  private readonly wallClock: () => Date;
  private readonly monotonicNowMs: () => number;
  private readonly deliveredTileGenerations = new Map<number, number>();
  private readonly dwellMsByTile = new Uint32Array(
    GRAND_HALL_T554_NATIVE_TILE_COUNT,
  );
  private readonly journal: GrandHallT554NativeReviewCoverageEventV1[] = [];
  private previousSample:
    | {
        readonly sample: GrandHallT554NativeReviewTelemetrySampleV1;
        readonly wallReceivedAtMs: number;
        readonly monotonicReceivedAtMs: number;
        readonly eligibleTiles: ReadonlySet<number>;
        readonly disqualifier: GrandHallT554NativeReviewCoverageDisqualifierV1;
      }
    | undefined;

  constructor(options: GrandHallT554NativeReviewCoverageControllerOptions) {
    if (!SESSION_NONCE_PATTERN.test(options.sessionNonce)) {
      throw new GrandHallT554NativeReviewCoverageError(
        "SESSION_INVALID",
        "native-review session nonce must be one 256-bit base64url token",
      );
    }
    if (!SESSION_NONCE_PATTERN.test(options.sourceEpochNonce)) {
      throw new GrandHallT554NativeReviewCoverageError(
        "SESSION_INVALID",
        "native-review source epoch nonce must be one 256-bit base64url token",
      );
    }
    if (!SHA256_PATTERN.test(options.subjectSha256)) {
      throw new GrandHallT554NativeReviewCoverageError(
        "SUBJECT_INVALID",
        "native-review subject must be one canonical SHA-256 digest",
      );
    }
    if (
      !Number.isSafeInteger(options.renderGeneration) ||
      options.renderGeneration < 1
    ) {
      throw new GrandHallT554NativeReviewCoverageError(
        "SESSION_INVALID",
        "native-review render generation must be one positive safe integer",
      );
    }
    this.sessionNonce = options.sessionNonce;
    this.sourceEpochNonce = options.sourceEpochNonce;
    this.subjectSha256 = options.subjectSha256;
    this.renderGeneration = options.renderGeneration;
    this.wallClock = options.wallClock ?? (() => new Date());
    this.monotonicNowMs = options.monotonicNowMs ?? (() => performance.now());
  }

  recordDeliveredTile(column: number, row: number): void {
    if (
      !Number.isInteger(column) ||
      !Number.isInteger(row) ||
      column < 0 ||
      column >= GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT ||
      row < 0 ||
      row >= GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT
    ) {
      throw new GrandHallT554NativeReviewCoverageError(
        "TILE_INVALID",
        "delivered native tile is outside the exact 32 by 16 source grid",
      );
    }
    this.deliveredTileGenerations.set(
      tileIndex(column, row),
      this.renderGeneration,
    );
  }

  recordTelemetry(
    input: unknown,
  ): GrandHallT554NativeReviewCoverageEventV1 {
    const parsed = GrandHallT554NativeReviewTelemetrySampleV1Schema.safeParse(input);
    if (!parsed.success) {
      throw new GrandHallT554NativeReviewCoverageError(
        "TELEMETRY_INVALID",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    const sample = parsed.data;
    if (
      sample.sessionNonce !== this.sessionNonce ||
      sample.sourceEpochNonce !== this.sourceEpochNonce ||
      sample.subjectSha256 !== this.subjectSha256 ||
      sample.renderGeneration !== this.renderGeneration
    ) {
      throw new GrandHallT554NativeReviewCoverageError(
        "SESSION_INVALID",
        "telemetry is not bound to the active server review session and subject",
      );
    }
    if (sample.sequence !== this.journal.length) {
      throw new GrandHallT554NativeReviewCoverageError(
        "SEQUENCE_INVALID",
        "telemetry sequence must be gap-free and append-only",
      );
    }

    const receivedAt = this.wallClock();
    const wallReceivedAtMs = receivedAt.getTime();
    const monotonicReceivedAtMs = this.monotonicNowMs();
    if (!Number.isFinite(monotonicReceivedAtMs) || monotonicReceivedAtMs < 0) {
      throw new GrandHallT554NativeReviewCoverageError(
        "CLOCK_INVALID",
        "server monotonic clock did not return a finite nonnegative value",
      );
    }
    const serverReceivedAt = canonicalServerInstant(receivedAt);
    if (
      this.previousSample !== undefined &&
      (
        wallReceivedAtMs < this.previousSample.wallReceivedAtMs ||
        monotonicReceivedAtMs < this.previousSample.monotonicReceivedAtMs
      )
    ) {
      throw new GrandHallT554NativeReviewCoverageError(
        "CLOCK_INVALID",
        "native-review telemetry clocks must not move backwards",
      );
    }

    const visibleTiles = fullyVisibleTileIndexes(
      sample,
      this.deliveredTileGenerations,
    );
    const currentDisqualifier = eligibilityDisqualifier(sample, visibleTiles.size);
    const currentEligibleTiles = currentDisqualifier === null
      ? visibleTiles
      : new Set<number>();
    const serverMonotonicDeltaMs = this.previousSample === undefined
      ? 0
      : monotonicReceivedAtMs - this.previousSample.monotonicReceivedAtMs;
    let creditedTiles: ReadonlySet<number> = new Set<number>();
    let creditedDurationMs = 0;
    let disqualifier: GrandHallT554NativeReviewCoverageDisqualifierV1;

    if (this.previousSample === undefined) {
      disqualifier = "first_sample";
    } else if (currentDisqualifier !== null) {
      disqualifier = currentDisqualifier;
    } else if (this.previousSample.disqualifier !== null) {
      disqualifier = this.previousSample.disqualifier;
    } else {
      creditedTiles = intersectIndexes(
        this.previousSample.eligibleTiles,
        currentEligibleTiles,
      );
      if (creditedTiles.size === 0) {
        disqualifier = "no_continuously_visible_tiles";
      } else {
        creditedDurationMs = Math.min(
          GRAND_HALL_T554_MAXIMUM_CREDITED_HEARTBEAT_GAP_MS,
          Math.max(
            0,
            serverMonotonicDeltaMs,
          ),
        );
        disqualifier = null;
        for (const index of creditedTiles) {
          const current = this.dwellMsByTile[index] ?? 0;
          this.dwellMsByTile[index] = Math.min(
            GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE,
            current + creditedDurationMs,
          );
        }
      }
    }

    const completedTiles = new Set<number>();
    this.dwellMsByTile.forEach((dwellMs, index) => {
      if (dwellMs >= GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE) {
        completedTiles.add(index);
      }
    });
    const previousEventSha256 = this.journal.at(-1)?.eventSha256 ?? null;
    const material = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-event.v1" as const,
      sequence: sample.sequence,
      serverReceivedAt,
      previousEventSha256,
      rawTelemetry: sample,
      derived: {
        effectiveDevicePixelsPerSourcePixel:
          Math.min(
            sample.sourceToCssTransform.a,
            sample.sourceToCssTransform.d,
          ) * sample.devicePixelRatio,
        serverMonotonicDeltaMs,
        fullyVisibleDeliveredTileBitsetHex: bitmapFromIndexes(visibleTiles),
        creditedTileBitsetHex: bitmapFromIndexes(creditedTiles),
        creditedDurationMs,
        disqualifier,
        completedTileBitsetHex: bitmapFromIndexes(completedTiles),
        completedTileCount: completedTiles.size,
      },
    };
    const event: GrandHallT554NativeReviewCoverageEventV1 = {
      ...material,
      eventSha256: semanticDigest(
        "venviewer.grand-hall-t554-native-review-coverage-event-digest.v1",
        material,
      ),
    };
    this.journal.push(event);
    this.previousSample = {
      sample,
      wallReceivedAtMs,
      monotonicReceivedAtMs,
      eligibleTiles: currentEligibleTiles,
      disqualifier: currentDisqualifier,
    };
    return structuredClone(event);
  }

  snapshot(): GrandHallT554NativeReviewCoverageSnapshotV1 {
    const completedTiles = new Set<number>();
    this.dwellMsByTile.forEach((dwellMs, index) => {
      if (dwellMs >= GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE) {
        completedTiles.add(index);
      }
    });
    return {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-snapshot.v1",
      subjectSha256: this.subjectSha256,
      sessionNonceSha256: sha256Bytes(Buffer.from(this.sessionNonce, "utf8")),
      sourceEpochNonceSha256: sha256Bytes(
        Buffer.from(this.sourceEpochNonce, "utf8"),
      ),
      renderGeneration: this.renderGeneration,
      eventCount: this.journal.length,
      lastEventSha256: this.journal.at(-1)?.eventSha256 ?? null,
      deliveredTileBitsetHex: bitmapFromIndexes(
        new Set(this.deliveredTileGenerations.keys()),
      ),
      completedTileBitsetHex: bitmapFromIndexes(completedTiles),
      completedTileCount: completedTiles.size,
      minimumDwellMsPerTile: GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE,
      complete: completedTiles.size === GRAND_HALL_T554_NATIVE_TILE_COUNT,
    };
  }

  events(): readonly GrandHallT554NativeReviewCoverageEventV1[] {
    return structuredClone(this.journal);
  }

  dwellMsForTile(column: number, row: number): number {
    if (
      !Number.isInteger(column) ||
      !Number.isInteger(row) ||
      column < 0 ||
      column >= GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT ||
      row < 0 ||
      row >= GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT
    ) {
      throw new GrandHallT554NativeReviewCoverageError(
        "TILE_INVALID",
        "native tile is outside the exact source grid",
      );
    }
    return this.dwellMsByTile[tileIndex(column, row)] ?? 0;
  }
}

export function emptyGrandHallT554NativeTileBitmapHex(): string {
  return ZERO_BITMAP_HEX;
}

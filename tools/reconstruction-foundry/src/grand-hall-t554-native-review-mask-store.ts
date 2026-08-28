import type { BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS,
  GrandHallPanoramaSourceJpgIdentityV2Schema,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import sharp from "sharp";
import { z } from "zod";

import {
  GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES,
  validateGrandHallT554MaskPngBytes,
  validateGrandHallT554MaskReasonMapPngBytes,
} from "./grand-hall-t554-media-validation.js";
import {
  computeGrandHallT554NativeMaskPixelTileInventorySha256V2,
  computeGrandHallT554NativeMaskTileDigestPairV2,
  GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX,
  GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX,
} from "./grand-hall-t554-native-mask-spatial-digest-v2.js";
import { verifyGrandHallT554NativeMaskEvidence } from "./grand-hall-t554-native-media-kernel.js";

export {
  GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX,
  GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX,
} from "./grand-hall-t554-native-mask-spatial-digest-v2.js";

export const GRAND_HALL_T554_NATIVE_MASK_STORE_V1 =
  "venviewer.grand-hall-t554-native-mask-store.v1";
export const GRAND_HALL_T554_NATIVE_MASK_RASTERIZER_V2 =
  "venviewer.grand-hall-t554-native-mask-rasterizer.integer-pixel-centres.v2";
export const GRAND_HALL_T554_NATIVE_MASK_MAX_POLYGON_VERTEX_COUNT = 512;
export const GRAND_HALL_T554_NATIVE_MASK_MAX_REVISION = 4_095;
export const GRAND_HALL_T554_NATIVE_MASK_MAX_OWNED_BUFFER_BYTES = 512 * 1_024 * 1_024;
export const GRAND_HALL_T554_NATIVE_MASK_MAX_CHANGED_TILE_SEALS = 4_095;

export const GRAND_HALL_T554_NATIVE_MASK_REASON_CODES = [
  "adjacent_room_pixels",
  "portal_beyond_grand_hall_plane",
  "facade_or_exterior_pixels",
  "capture_artifact_outside_verified_room",
  "unverified_or_unknown_pixels",
] as const;

export type GrandHallT554NativeMaskReasonCode =
  (typeof GRAND_HALL_T554_NATIVE_MASK_REASON_CODES)[number];

export type GrandHallT554NativeMaskStoreErrorCode =
  | "ARGUMENT_INVALID"
  | "SOURCE_BINDING_INVALID"
  | "REVISION_CONFLICT"
  | "NO_CHANGE"
  | "REVISION_LIMIT_REACHED"
  | "REVISION_STORAGE_LIMIT_REACHED"
  | "RASTER_WORK_LIMIT_REACHED"
  | "OPERATION_BUSY"
  | "STORE_ABANDONED"
  | "PUBLICATION_DISABLED"
  | "PUBLICATION_EXISTS"
  | "PUBLICATION_PARTIAL"
  | "PUBLICATION_INVALID"
  | "PREPARED_FREEZE_CONSUMED"
  | "ENCODING_INVALID"
  | "INTERNAL_INVARIANT_FAILED";

export class GrandHallT554NativeMaskStoreError extends Error {
  readonly code: GrandHallT554NativeMaskStoreErrorCode;

  constructor(
    code: GrandHallT554NativeMaskStoreErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeMaskStoreError";
    this.code = code;
  }
}

export interface GrandHallT554NativeMaskPublishingStoreConfig {
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  readonly publicationDirectory: string;
  /**
   * A trusted, same-volume directory outside the verified session root. It is
   * required by prepareFreeze() so final evidence names are created atomically
   * with no-replace hard links rather than written in place.
   */
  readonly preparationDirectory?: string;
}

export interface GrandHallT554NativeMaskReplayOnlyStoreConfig {
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  readonly mode: "replay-only";
}

export type GrandHallT554NativeMaskStoreConfig =
  | GrandHallT554NativeMaskPublishingStoreConfig
  | GrandHallT554NativeMaskReplayOnlyStoreConfig;

export interface GrandHallT554NativeMaskReasonCount {
  readonly reasonCode: GrandHallT554NativeMaskReasonCode;
  readonly pixelCount: number;
}

export type GrandHallT554NativeMaskPublicationDurability =
  | "directory_fsync"
  | "windows_file_fsync_fallback";

interface GrandHallT554NativeMaskFrozenBindingCommon {
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  readonly revision: number;
  readonly fileName: string;
  readonly sha256: `sha256:${string}`;
  readonly byteLength: number;
  readonly widthPx: typeof GRAND_HALL_PANORAMA_WIDTH_PX;
  readonly heightPx: typeof GRAND_HALL_PANORAMA_HEIGHT_PX;
  readonly bitDepth: 8;
  readonly channelCount: 1;
  readonly permittedPixelValues: readonly [0, 255];
  readonly zeroMeaning: "grand_hall_included";
  readonly twoHundredFiftyFiveMeaning: "excluded_or_unknown";
  readonly includedPixelCount: number;
  readonly excludedPixelCount: number;
  readonly reasonCounts: readonly GrandHallT554NativeMaskReasonCount[];
  readonly publicationDurability: GrandHallT554NativeMaskPublicationDurability;
  readonly immutableFrozen: true;
}

export interface GrandHallT554NativeMaskReasonMapBinding {
  readonly fileName: string;
  readonly sha256: `sha256:${string}`;
  readonly byteLength: number;
  readonly widthPx: typeof GRAND_HALL_PANORAMA_WIDTH_PX;
  readonly heightPx: typeof GRAND_HALL_PANORAMA_HEIGHT_PX;
  readonly bitDepth: 8;
  readonly channelCount: 1;
  readonly permittedPixelValues: readonly [0, 1, 2, 3, 4, 5];
  readonly zeroMeaning: "grand_hall_included";
  readonly reasonSampleCodebook: readonly [
    { readonly sample: 1; readonly reasonCode: "adjacent_room_pixels" },
    { readonly sample: 2; readonly reasonCode: "portal_beyond_grand_hall_plane" },
    { readonly sample: 3; readonly reasonCode: "facade_or_exterior_pixels" },
    { readonly sample: 4; readonly reasonCode: "capture_artifact_outside_verified_room" },
    { readonly sample: 5; readonly reasonCode: "unverified_or_unknown_pixels" },
  ];
}

export interface GrandHallT554NativeMaskFrozenBindingV2 extends
  GrandHallT554NativeMaskFrozenBindingCommon {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-mask-frozen-binding.v2";
  readonly reasonMap: GrandHallT554NativeMaskReasonMapBinding;
}

export type GrandHallT554NativeMaskFrozenBinding =
  GrandHallT554NativeMaskFrozenBindingV2;

export interface GrandHallT554NativeMaskStoreSnapshot {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_MASK_STORE_V1;
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  readonly revision: number;
  readonly includedPixelCount: number;
  readonly excludedPixelCount: number;
  readonly reasonCounts: readonly GrandHallT554NativeMaskReasonCount[];
  readonly activeFrozenBinding: GrandHallT554NativeMaskFrozenBinding | null;
}

export interface GrandHallT554NativeMaskExactStateV2 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-mask-exact-state.v2";
  readonly rasterizerVersion: typeof GRAND_HALL_T554_NATIVE_MASK_RASTERIZER_V2;
  readonly revision: number;
  readonly widthPx: typeof GRAND_HALL_PANORAMA_WIDTH_PX;
  readonly heightPx: typeof GRAND_HALL_PANORAMA_HEIGHT_PX;
  readonly includedPixelCount: number;
  readonly excludedPixelCount: number;
  readonly reasonCounts: readonly GrandHallT554NativeMaskReasonCount[];
  readonly pixelTileInventorySha256: `sha256:${string}`;
  readonly maskStateSha256: `sha256:${string}`;
}

export type GrandHallT554NativeMaskPublicationDisposition =
  | "none"
  | "mask_only"
  | "reason_map_only"
  | "mask_and_reason_map";

export interface GrandHallT554NativeMaskPreparedFileBindingV2 {
  readonly fileName: string;
  readonly sha256: `sha256:${string}`;
  readonly byteLength: number;
  readonly widthPx: typeof GRAND_HALL_PANORAMA_WIDTH_PX;
  readonly heightPx: typeof GRAND_HALL_PANORAMA_HEIGHT_PX;
  readonly bitDepth: 8;
  readonly channelCount: 1;
  readonly permittedPixelValues: [0, 255];
  readonly zeroMeaning: "grand_hall_included";
  readonly twoHundredFiftyFiveMeaning: "excluded_or_unknown";
}

export interface GrandHallT554NativeMaskPreparedReasonMapBindingV2 {
  readonly fileName: string;
  readonly sha256: `sha256:${string}`;
  readonly byteLength: number;
  readonly widthPx: typeof GRAND_HALL_PANORAMA_WIDTH_PX;
  readonly heightPx: typeof GRAND_HALL_PANORAMA_HEIGHT_PX;
  readonly bitDepth: 8;
  readonly channelCount: 1;
  readonly permittedPixelValues: [0, 1, 2, 3, 4, 5];
  readonly zeroMeaning: "grand_hall_included";
  readonly reasonSampleCodebook: [
    { readonly sample: 1; readonly reasonCode: "adjacent_room_pixels" },
    { readonly sample: 2; readonly reasonCode: "portal_beyond_grand_hall_plane" },
    { readonly sample: 3; readonly reasonCode: "facade_or_exterior_pixels" },
    { readonly sample: 4; readonly reasonCode: "capture_artifact_outside_verified_room" },
    { readonly sample: 5; readonly reasonCode: "unverified_or_unknown_pixels" },
  ];
}

export interface GrandHallT554NativeMaskPreparedBindingV2 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-mask-prepared-binding.v2";
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  readonly revision: number;
  readonly includedPixelCount: number;
  readonly excludedPixelCount: number;
  readonly reasonCounts: GrandHallT554NativeMaskReasonCount[];
  readonly mask: GrandHallT554NativeMaskPreparedFileBindingV2;
  readonly reasonMap: GrandHallT554NativeMaskPreparedReasonMapBindingV2;
}

/**
 * Process-local, one-use authority to publish exactly the bytes represented by
 * binding. No raster or encoded byte buffer is exposed to the caller.
 */
export interface GrandHallT554NativeMaskPreparedFreezeV2 {
  readonly binding: GrandHallT554NativeMaskPreparedBindingV2;
  inspectPublication(): Promise<GrandHallT554NativeMaskPublicationDisposition>;
  publishOrVerifyExact(): Promise<GrandHallT554NativeMaskFrozenBindingV2>;
  discard(): void;
}

export interface GrandHallT554NativeMaskPixel {
  readonly value: 0 | 255;
  readonly reasonCode: GrandHallT554NativeMaskReasonCode | null;
}

const PIXEL_COUNT = GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const TILE_COLUMN_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX / GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX;
const TILE_ROW_COUNT =
  GRAND_HALL_PANORAMA_HEIGHT_PX / GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX;
const TILE_COUNT = TILE_COLUMN_COUNT * TILE_ROW_COUNT;
const TILE_PIXEL_COUNT =
  GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX *
  GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX;
const UNKNOWN_REASON_SAMPLE = GRAND_HALL_T554_NATIVE_MASK_REASON_CODES.length;
const MASK_EXACT_STATE_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_MASK_EXACT_STATE_V2";
const EXACT_CONTEXT_MAX_DEPTH = 32;
const EXACT_CONTEXT_MAX_NODE_COUNT = 8_192;
const EXACT_CONTEXT_MAX_UTF8_BYTES = 1_048_576;
const CANONICAL_OUTPUT_BASENAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,254}$/u;
const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/](?![\\/])/u;
const REASON_SAMPLE_CODEBOOK = Object.freeze([
  Object.freeze({ sample: 1 as const, reasonCode: GRAND_HALL_T554_NATIVE_MASK_REASON_CODES[0] }),
  Object.freeze({ sample: 2 as const, reasonCode: GRAND_HALL_T554_NATIVE_MASK_REASON_CODES[1] }),
  Object.freeze({ sample: 3 as const, reasonCode: GRAND_HALL_T554_NATIVE_MASK_REASON_CODES[2] }),
  Object.freeze({ sample: 4 as const,
    reasonCode: GRAND_HALL_T554_NATIVE_MASK_REASON_CODES[3] }),
  Object.freeze({ sample: 5 as const, reasonCode: GRAND_HALL_T554_NATIVE_MASK_REASON_CODES[4] }),
] as const);

const PixelCoordinateXSchema = z.number().int().min(0).max(GRAND_HALL_PANORAMA_WIDTH_PX);
const PixelCoordinateYSchema = z.number().int().min(0).max(GRAND_HALL_PANORAMA_HEIGHT_PX);
const ExpectedRevisionSchema = z.number().int().nonnegative()
  .max(GRAND_HALL_T554_NATIVE_MASK_MAX_REVISION);
const MaskReasonCodeSchema = z.enum(GRAND_HALL_T554_NATIVE_MASK_REASON_CODES);

const RectanglePrimitiveSchema = z.object({
  kind: z.literal("rectangle"),
  horizontalSeam: z.enum(["none", "wrap"]),
  leftPx: PixelCoordinateXSchema,
  topPx: PixelCoordinateYSchema,
  rightExclusivePx: PixelCoordinateXSchema,
  bottomExclusivePx: PixelCoordinateYSchema,
}).strict().superRefine((rectangle, context) => {
  if (rectangle.topPx >= rectangle.bottomExclusivePx) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bottomExclusivePx"],
      message: "rectangle must contain at least one source-grid row" });
  }
  if (rectangle.horizontalSeam === "none" && rectangle.leftPx >= rectangle.rightExclusivePx) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rightExclusivePx"],
      message: "non-wrapping rectangle must increase from left to right" });
  }
  if (
    rectangle.horizontalSeam === "wrap" &&
    (
      rectangle.leftPx <= rectangle.rightExclusivePx ||
      rectangle.leftPx === GRAND_HALL_PANORAMA_WIDTH_PX
    )
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["horizontalSeam"],
      message: "wrapping rectangle must cross the seam from a larger in-grid x to a smaller x" });
  }
});

const PolygonPointSchema = z.object({
  xPx: PixelCoordinateXSchema,
  yPx: PixelCoordinateYSchema,
}).strict();

const PolygonPrimitiveSchema = z.object({
  kind: z.literal("polygon"),
  horizontalSeam: z.enum(["none", "wrap_shortest"]),
  points: z.array(PolygonPointSchema).min(3)
    .max(GRAND_HALL_T554_NATIVE_MASK_MAX_POLYGON_VERTEX_COUNT),
}).strict();

const MaskPrimitiveSchema = z.union([
  RectanglePrimitiveSchema,
  PolygonPrimitiveSchema,
]);

const IncludeEditSchema = z.object({
  expectedRevision: ExpectedRevisionSchema,
  operation: z.literal("include"),
  primitive: MaskPrimitiveSchema,
}).strict();

const ExcludeEditSchema = z.object({
  expectedRevision: ExpectedRevisionSchema,
  operation: z.literal("exclude"),
  reasonCode: MaskReasonCodeSchema,
  primitive: MaskPrimitiveSchema,
}).strict();

const EditRequestSchema = z.discriminatedUnion("operation", [
  IncludeEditSchema,
  ExcludeEditSchema,
]);

const FreezeRequestSchema = z.object({
  expectedRevision: ExpectedRevisionSchema,
}).strict();

const PrepareFreezeRequestSchema = z.object({
  expectedRevision: ExpectedRevisionSchema,
  operationIdSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();

type MaskEditRequest = z.infer<typeof EditRequestSchema>;
type MaskPrimitive = z.infer<typeof MaskPrimitiveSchema>;
type PolygonPrimitive = z.infer<typeof PolygonPrimitiveSchema>;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface ExactTileFactsV2 {
  readonly includedPixelCount: number;
  readonly excludedPixelCount: number;
  readonly reasonCounts: readonly number[];
  readonly maskSha256: `sha256:${string}`;
  readonly reasonSha256: `sha256:${string}`;
}

interface TileState {
  readonly mask: Buffer;
  readonly reasons: Buffer;
  readonly exactFacts: ExactTileFactsV2;
}

interface MutableTileState {
  readonly mask: Buffer;
  readonly reasons: Buffer;
}

interface MaskRevision {
  readonly revision: number;
  readonly tiles: readonly TileState[];
  readonly includedPixelCount: number;
  readonly excludedPixelCount: number;
  readonly reasonCounts: readonly number[];
}

interface MutableRevision {
  readonly tiles: Array<TileState | MutableTileState>;
  readonly clonedTiles: Map<number, MutableTileState>;
  includedPixelCount: number;
  excludedPixelCount: number;
  readonly reasonCounts: number[];
}

interface DerivedRevisionFacts {
  readonly includedPixelCount: number;
  readonly excludedPixelCount: number;
  readonly reasonCounts: readonly number[];
}

interface Intersection {
  readonly numerator: number;
  readonly denominator: number;
}

interface GrandHallT554NativeMaskStoreTestSeam {
  readonly afterBufferZeroed?: (facts: {
    readonly byteLength: number;
    readonly allZero: true;
  }) => void;
  readonly beforePublicationDirectorySync?: (
    publicationDirectory: string,
  ) => Promise<void> | void;
  readonly afterPublicationDurabilityBarrier?: (facts: {
    readonly publicationDirectory: string;
    readonly mode: GrandHallT554NativeMaskPublicationDurability;
  }) => Promise<void> | void;
  readonly afterPreparedFinalLinked?: (facts: {
    readonly plane: "mask" | "reason_map";
  }) => Promise<void> | void;
  readonly afterPreparedPairVerified?: () => Promise<void> | void;
  readonly beforePreparedPublicationRootsValidated?: () => Promise<void> | void;
  readonly maximumChangedTileSeals?: number;
}

const TEST_SEAMS = new WeakMap<
  GrandHallT554NativeMaskRevisionStore,
  GrandHallT554NativeMaskStoreTestSeam
>();

interface CanonicalJsonObject {
  readonly [key: string]: CanonicalJsonValue;
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | CanonicalJsonObject;

interface CanonicalTraversalBudget {
  nodeCount: number;
  utf8Bytes: number;
}

function fail(
  code: GrandHallT554NativeMaskStoreErrorCode,
  message: string,
  cause?: unknown,
): GrandHallT554NativeMaskStoreError {
  return new GrandHallT554NativeMaskStoreError(code, message, cause);
}

function cloneSource(
  source: GrandHallPanoramaSourceJpgIdentityV2,
): GrandHallPanoramaSourceJpgIdentityV2 {
  return structuredClone(source);
}

function canonicalFailure(message: string): GrandHallT554NativeMaskStoreError {
  return fail("ARGUMENT_INVALID", `native mask exact-state context ${message}`);
}

function consumeCanonicalBudget(
  budget: CanonicalTraversalBudget,
  utf8Bytes: number,
): void {
  budget.nodeCount += 1;
  budget.utf8Bytes += utf8Bytes;
  if (budget.nodeCount > EXACT_CONTEXT_MAX_NODE_COUNT) {
    throw canonicalFailure("exceeds the bounded node count");
  }
  if (budget.utf8Bytes > EXACT_CONTEXT_MAX_UTF8_BYTES) {
    throw canonicalFailure("exceeds the bounded UTF-8 byte count");
  }
}

function canonicalizePlainJson(
  value: unknown,
  budget: CanonicalTraversalBudget,
  ancestors: Set<object>,
  depth: number,
): CanonicalJsonValue {
  if (depth > EXACT_CONTEXT_MAX_DEPTH) {
    throw canonicalFailure("exceeds the bounded nesting depth");
  }
  if (value === null) {
    consumeCanonicalBudget(budget, 0);
    return null;
  }
  if (typeof value === "boolean") {
    consumeCanonicalBudget(budget, 0);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw canonicalFailure("contains a non-finite number");
    }
    consumeCanonicalBudget(budget, 0);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    consumeCanonicalBudget(budget, Buffer.byteLength(value, "utf8"));
    return value;
  }
  if (typeof value !== "object") {
    throw canonicalFailure(`contains unsupported ${typeof value} data`);
  }
  if (ancestors.has(value)) {
    throw canonicalFailure("contains a cycle");
  }
  const prototype = Reflect.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (
    (!isArray && prototype !== Object.prototype && prototype !== null) ||
    (isArray && prototype !== Array.prototype)
  ) {
    throw canonicalFailure("must contain only arrays and plain objects");
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw canonicalFailure("contains symbol-keyed data");
  }
  ancestors.add(value);
  try {
    if (isArray) {
      if (value.length > EXACT_CONTEXT_MAX_NODE_COUNT) {
        throw canonicalFailure("contains an oversized array");
      }
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== value.length + 1 || !names.includes("length")) {
        throw canonicalFailure("contains a sparse or decorated array");
      }
      consumeCanonicalBudget(budget, 0);
      const output: CanonicalJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          throw canonicalFailure("contains a sparse or accessor-backed array");
        }
        output.push(
          canonicalizePlainJson(
            descriptor.value,
            budget,
            ancestors,
            depth + 1,
          ),
        );
      }
      return output;
    }

    const names = Object.getOwnPropertyNames(value);
    consumeCanonicalBudget(
      budget,
      names.reduce((sum, key) => sum + Buffer.byteLength(key, "utf8"), 0),
    );
    const output = Object.create(null) as Record<string, CanonicalJsonValue>;
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        throw canonicalFailure("contains non-enumerable or accessor-backed data");
      }
      Object.defineProperty(output, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: canonicalizePlainJson(
          descriptor.value,
          budget,
          ancestors,
          depth + 1,
        ),
      });
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function toBoundedCanonicalJson(value: unknown): CanonicalJsonValue {
  try {
    return canonicalizePlainJson(
      value,
      { nodeCount: 0, utf8Bytes: 0 },
      new Set<object>(),
      0,
    );
  } catch (error) {
    if (error instanceof GrandHallT554NativeMaskStoreError) throw error;
    throw canonicalFailure("could not be inspected as bounded canonical JSON");
  }
}

function stableBoundedCanonicalJson(value: CanonicalJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number" ||
    typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableBoundedCanonicalJson).join(",")}]`;
  }
  const object = value as CanonicalJsonObject;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${stableBoundedCanonicalJson(object[key] ?? null)}`
  ).join(",")}}`;
}

function parseSource(
  input: unknown,
): GrandHallPanoramaSourceJpgIdentityV2 {
  const parsed = GrandHallPanoramaSourceJpgIdentityV2Schema.safeParse(input);
  if (!parsed.success) {
    throw fail("SOURCE_BINDING_INVALID", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  const source = parsed.data;
  if (
    source.inventoryIndex >= GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT ||
    source.sweepNumber !== GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS[source.inventoryIndex] ||
    source.fileName !== basename(source.fileName) ||
    source.byteLength > GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES
  ) {
    throw fail("SOURCE_BINDING_INVALID", "mask store source does not bind one exact supplied panorama row");
  }
  return Object.freeze(cloneSource(source));
}

function parseConfig(
  config: unknown,
): {
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  readonly publicationDirectory: string | null;
  readonly preparationDirectory: string | null;
  readonly replayOnly: boolean;
} {
  if (
    typeof config !== "object" || config === null ||
    !("source" in config)
  ) {
    throw fail("ARGUMENT_INVALID", "native mask store configuration must be an object");
  }
  const keys = Object.keys(config).sort();
  if ("mode" in config) {
    if (
      config.mode !== "replay-only" ||
      keys.length !== 2 || keys[0] !== "mode" || keys[1] !== "source"
    ) {
      throw fail("ARGUMENT_INVALID", "replay-only mask configuration must contain only source and mode");
    }
    return {
      source: parseSource(config.source),
      publicationDirectory: null,
      preparationDirectory: null,
      replayOnly: true,
    };
  }
  if (!("publicationDirectory" in config) ||
    (keys.length !== 2 && keys.length !== 3) ||
    (keys.length === 2 && keys[0] !== "publicationDirectory") ||
    (keys.length === 3 &&
      (keys[0] !== "preparationDirectory" || keys[1] !== "publicationDirectory")) ||
    keys[keys.length - 1] !== "source" ||
    (keys.length === 3 && !("preparationDirectory" in config))) {
    throw fail(
      "ARGUMENT_INVALID",
      "publishing mask configuration may contain only source, publicationDirectory, and preparationDirectory",
    );
  }
  const source = parseSource(config.source);
  if (
    typeof config.publicationDirectory !== "string" ||
    !isAbsolute(config.publicationDirectory) ||
    config.publicationDirectory.startsWith("//") ||
    config.publicationDirectory.startsWith("\\\\") ||
    (process.platform === "win32" &&
      !WINDOWS_DRIVE_ROOT_PATTERN.test(config.publicationDirectory))
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "mask publication directory must be one absolute local-drive server path",
    );
  }
  let preparationDirectory: string | null = null;
  if ("preparationDirectory" in config) {
    if (
      typeof config.preparationDirectory !== "string" ||
      !isAbsolute(config.preparationDirectory) ||
      config.preparationDirectory.startsWith("//") ||
      config.preparationDirectory.startsWith("\\\\") ||
      (process.platform === "win32" &&
        !WINDOWS_DRIVE_ROOT_PATTERN.test(config.preparationDirectory))
    ) {
      throw fail(
        "ARGUMENT_INVALID",
        "mask preparation directory must be one absolute local-drive server path",
      );
    }
    preparationDirectory = resolve(config.preparationDirectory);
    const publication = comparablePath(resolve(config.publicationDirectory));
    const preparation = comparablePath(preparationDirectory);
    const separator = process.platform === "win32" ? "\\" : "/";
    if (
      publication === preparation ||
      preparation.startsWith(`${publication}${separator}`) ||
      publication.startsWith(`${preparation}${separator}`)
    ) {
      throw fail(
        "ARGUMENT_INVALID",
        "mask preparation and publication directories must be disjoint siblings",
      );
    }
  }
  return {
    source,
    publicationDirectory: resolve(config.publicationDirectory),
    preparationDirectory,
    replayOnly: false,
  };
}

function parseEdit(input: unknown): MaskEditRequest {
  const parsed = EditRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw fail("ARGUMENT_INVALID", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

function parseExpectedRevision(input: unknown): number {
  const parsed = FreezeRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw fail("ARGUMENT_INVALID", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data.expectedRevision;
}

function parsePrepareFreezeRequest(input: unknown): z.infer<typeof PrepareFreezeRequestSchema> {
  const parsed = PrepareFreezeRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw fail("ARGUMENT_INVALID", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

function reasonSample(reasonCode: GrandHallT554NativeMaskReasonCode): number {
  const index = GRAND_HALL_T554_NATIVE_MASK_REASON_CODES.indexOf(reasonCode);
  if (index < 0) throw fail("INTERNAL_INVARIANT_FAILED", "unknown mask reason code");
  return index + 1;
}

function reasonCode(sample: number): GrandHallT554NativeMaskReasonCode {
  const code = GRAND_HALL_T554_NATIVE_MASK_REASON_CODES[sample - 1];
  if (code === undefined) {
    throw fail("INTERNAL_INVARIANT_FAILED", "mask reason sample is outside the fixed codebook");
  }
  return code;
}

function reasonCountObjects(counts: readonly number[]): readonly GrandHallT554NativeMaskReasonCount[] {
  return Object.freeze(GRAND_HALL_T554_NATIVE_MASK_REASON_CODES.flatMap((code, index) => {
    const pixelCount = counts[index + 1] ?? 0;
    return pixelCount === 0 ? [] : [Object.freeze({ reasonCode: code, pixelCount })];
  }));
}

function initialRevision(): MaskRevision {
  const mask = Buffer.alloc(TILE_PIXEL_COUNT, 255);
  const reasons = Buffer.alloc(TILE_PIXEL_COUNT, UNKNOWN_REASON_SAMPLE);
  const shared = sealTileState(mask, reasons);
  const reasonCounts = Array.from(
    { length: GRAND_HALL_T554_NATIVE_MASK_REASON_CODES.length + 1 },
    (_, index) => index === UNKNOWN_REASON_SAMPLE ? PIXEL_COUNT : 0,
  );
  return Object.freeze({ revision: 0,
    tiles: Object.freeze(Array.from({ length: TILE_COUNT }, () => shared)),
    includedPixelCount: 0, excludedPixelCount: PIXEL_COUNT,
    reasonCounts: Object.freeze(reasonCounts) });
}

function mutableRevision(revision: MaskRevision): MutableRevision {
  return { tiles: [...revision.tiles], clonedTiles: new Map<number, MutableTileState>(),
    includedPixelCount: revision.includedPixelCount,
    excludedPixelCount: revision.excludedPixelCount,
    reasonCounts: [...revision.reasonCounts] };
}

function tileIndexAndOffset(x: number, y: number): { readonly tileIndex: number; readonly offset: number } {
  const tileColumn = Math.floor(x / GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX);
  const tileRow = Math.floor(y / GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX);
  const localX = x % GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX;
  const localY = y % GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX;
  return { tileIndex: tileRow * TILE_COLUMN_COUNT + tileColumn,
    offset: localY * GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX + localX };
}

function writableTile(revision: MutableRevision, tileIndex: number): MutableTileState {
  const current = revision.tiles[tileIndex];
  if (current === undefined) throw fail("INTERNAL_INVARIANT_FAILED", "mask tile is absent");
  const existing = revision.clonedTiles.get(tileIndex);
  if (existing !== undefined) return existing;
  const cloned = { mask: Buffer.from(current.mask), reasons: Buffer.from(current.reasons) };
  revision.tiles[tileIndex] = cloned;
  revision.clonedTiles.set(tileIndex, cloned);
  return cloned;
}

function applyPixel(
  revision: MutableRevision,
  tile: MutableTileState,
  offset: number,
  operation: "include" | "exclude",
  excludedReasonSample: number,
): void {
  const oldMask = tile.mask[offset];
  const oldReason = tile.reasons[offset];
  if (oldMask === undefined || oldReason === undefined) {
    throw fail("INTERNAL_INVARIANT_FAILED", "mask pixel offset escaped its native tile");
  }
  const newMask = operation === "include" ? 0 : 255;
  const newReason = operation === "include" ? 0 : excludedReasonSample;
  if (oldMask === newMask && oldReason === newReason) return;
  if (oldMask === 0) revision.includedPixelCount -= 1;
  else revision.excludedPixelCount -= 1;
  if (oldReason > 0) revision.reasonCounts[oldReason] = (revision.reasonCounts[oldReason] ?? 0) - 1;
  if (newMask === 0) revision.includedPixelCount += 1;
  else revision.excludedPixelCount += 1;
  if (newReason > 0) revision.reasonCounts[newReason] = (revision.reasonCounts[newReason] ?? 0) + 1;
  tile.mask[offset] = newMask;
  tile.reasons[offset] = newReason;
}

function applyNormalizedSpan(
  revision: MutableRevision,
  y: number,
  xStart: number,
  xEndExclusive: number,
  operation: "include" | "exclude",
  excludedReasonSample: number,
): void {
  let x = xStart;
  while (x < xEndExclusive) {
    const located = tileIndexAndOffset(x, y);
    const runLength = Math.min(
      xEndExclusive - x,
      GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX -
        (x % GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX),
    );
    applyTileRun(
      revision,
      located.tileIndex,
      located.offset,
      located.offset + runLength,
      operation,
      excludedReasonSample,
    );
    x += runLength;
  }
}

function applyTileRun(
  revision: MutableRevision,
  tileIndex: number,
  startOffset: number,
  endOffset: number,
  operation: "include" | "exclude",
  excludedReasonSample: number,
): void {
  const current = revision.tiles[tileIndex];
  if (current === undefined) throw fail("INTERNAL_INVARIANT_FAILED", "mask tile is absent");
  const newMask = operation === "include" ? 0 : 255;
  const newReason = operation === "include" ? 0 : excludedReasonSample;
  let changeRequired = revision.clonedTiles.has(tileIndex);
  for (let offset = startOffset; !changeRequired && offset < endOffset; offset += 1) {
    changeRequired = current.mask[offset] !== newMask || current.reasons[offset] !== newReason;
  }
  if (!changeRequired) return;
  const tile = writableTile(revision, tileIndex);
  for (let offset = startOffset; offset < endOffset; offset += 1) {
    applyPixel(revision, tile, offset, operation, excludedReasonSample);
  }
}

function zeroClonedRevisionBuffers(revision: MutableRevision): void {
  revision.clonedTiles.forEach((tile) => {
    tile.mask.fill(0);
    tile.reasons.fill(0);
  });
}

function moduloWidth(value: number): number {
  const remainder = value % GRAND_HALL_PANORAMA_WIDTH_PX;
  return remainder < 0 ? remainder + GRAND_HALL_PANORAMA_WIDTH_PX : remainder;
}

function applyPossiblyWrappedSpan(
  revision: MutableRevision,
  y: number,
  xStart: number,
  xEndExclusive: number,
  operation: "include" | "exclude",
  excludedReasonSample: number,
): void {
  let cursor = xStart;
  while (cursor < xEndExclusive) {
    const normalizedStart = moduloWidth(cursor);
    const length = Math.min(
      xEndExclusive - cursor,
      GRAND_HALL_PANORAMA_WIDTH_PX - normalizedStart,
    );
    applyNormalizedSpan(
      revision, y, normalizedStart, normalizedStart + length, operation, excludedReasonSample,
    );
    cursor += length;
  }
}

function applyRectangle(
  revision: MutableRevision,
  primitive: z.infer<typeof RectanglePrimitiveSchema>,
  operation: "include" | "exclude",
  excludedReasonSample: number,
): void {
  for (let y = primitive.topPx; y < primitive.bottomExclusivePx; y += 1) {
    if (primitive.horizontalSeam === "none") {
      applyNormalizedSpan(
        revision, y, primitive.leftPx, primitive.rightExclusivePx, operation, excludedReasonSample,
      );
    } else {
      applyNormalizedSpan(
        revision, y, primitive.leftPx, GRAND_HALL_PANORAMA_WIDTH_PX,
        operation, excludedReasonSample,
      );
      applyNormalizedSpan(
        revision, y, 0, primitive.rightExclusivePx, operation, excludedReasonSample,
      );
    }
  }
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function unwrapPolygon(primitive: PolygonPrimitive): readonly Point[] {
  const raw = primitive.points.map((point) => ({ x: point.xPx, y: point.yPx }));
  if (primitive.horizontalSeam === "none") return raw;
  if (raw.some((point) => point.x === GRAND_HALL_PANORAMA_WIDTH_PX)) {
    throw fail("ARGUMENT_INVALID", "seam-wrapped polygon x coordinates must be in 0..8191");
  }
  const first = raw[0];
  if (first === undefined) throw fail("ARGUMENT_INVALID", "polygon has no first vertex");
  const unwrapped: Point[] = [first];
  for (let index = 1; index < raw.length; index += 1) {
    const previousRaw = raw[index - 1];
    const currentRaw = raw[index];
    const previousUnwrapped = unwrapped[index - 1];
    if (previousRaw === undefined || currentRaw === undefined || previousUnwrapped === undefined) {
      throw fail("INTERNAL_INVARIANT_FAILED", "polygon vertex sequence is incomplete");
    }
    let delta = currentRaw.x - previousRaw.x;
    if (Math.abs(delta) * 2 === GRAND_HALL_PANORAMA_WIDTH_PX) {
      throw fail("ARGUMENT_INVALID", "seam-wrapped polygon contains an ambiguous half-panorama edge");
    }
    if (delta * 2 > GRAND_HALL_PANORAMA_WIDTH_PX) delta -= GRAND_HALL_PANORAMA_WIDTH_PX;
    if (delta * 2 < -GRAND_HALL_PANORAMA_WIDTH_PX) delta += GRAND_HALL_PANORAMA_WIDTH_PX;
    unwrapped.push({ x: previousUnwrapped.x + delta, y: currentRaw.y });
  }
  const lastRaw = raw.at(-1);
  const lastUnwrapped = unwrapped.at(-1);
  if (lastRaw === undefined || lastUnwrapped === undefined) {
    throw fail("INTERNAL_INVARIANT_FAILED", "polygon closing edge is absent");
  }
  let closingDelta = first.x - lastRaw.x;
  if (Math.abs(closingDelta) * 2 === GRAND_HALL_PANORAMA_WIDTH_PX) {
    throw fail("ARGUMENT_INVALID", "seam-wrapped polygon contains an ambiguous closing edge");
  }
  if (closingDelta * 2 > GRAND_HALL_PANORAMA_WIDTH_PX) {
    closingDelta -= GRAND_HALL_PANORAMA_WIDTH_PX;
  }
  if (closingDelta * 2 < -GRAND_HALL_PANORAMA_WIDTH_PX) {
    closingDelta += GRAND_HALL_PANORAMA_WIDTH_PX;
  }
  if (lastUnwrapped.x + closingDelta !== first.x) {
    throw fail("ARGUMENT_INVALID", "seam-wrapped polygon winds around the full panorama");
  }
  const xValues = unwrapped.map((point) => point.x);
  if (Math.max(...xValues) - Math.min(...xValues) >= GRAND_HALL_PANORAMA_WIDTH_PX) {
    throw fail("ARGUMENT_INVALID", "seam-wrapped polygon spans a full panorama or more");
  }
  return unwrapped;
}

function orientation(first: Point, second: Point, third: Point): number {
  return (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x);
}

function pointOnSegment(first: Point, second: Point, point: Point): boolean {
  return orientation(first, second, point) === 0 &&
    point.x >= Math.min(first.x, second.x) && point.x <= Math.max(first.x, second.x) &&
    point.y >= Math.min(first.y, second.y) && point.y <= Math.max(first.y, second.y);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  ) return true;
  return (abC === 0 && pointOnSegment(a, b, c)) ||
    (abD === 0 && pointOnSegment(a, b, d)) ||
    (cdA === 0 && pointOnSegment(c, d, a)) ||
    (cdB === 0 && pointOnSegment(c, d, b));
}

function assertSimplePolygon(points: readonly Point[]): void {
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    if (next === undefined || afterNext === undefined || samePoint(point, next)) {
      throw fail("ARGUMENT_INVALID", "polygon contains a duplicate consecutive vertex");
    }
    if (orientation(point, next, afterNext) === 0) {
      throw fail("ARGUMENT_INVALID", "polygon contains a non-canonical collinear vertex");
    }
  });
  for (let left = 0; left < points.length; left += 1) {
    const leftEnd = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightEnd = (right + 1) % points.length;
      const adjacent = left === right || leftEnd === right || rightEnd === left;
      if (adjacent) continue;
      const a = points[left];
      const b = points[leftEnd];
      const c = points[right];
      const d = points[rightEnd];
      if (a !== undefined && b !== undefined && c !== undefined && d !== undefined &&
        segmentsIntersect(a, b, c, d)) {
        throw fail("ARGUMENT_INVALID", "polygon must be simple and non-self-intersecting");
      }
    }
  }
  const doubledArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return next === undefined ? sum : sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (doubledArea === 0) throw fail("ARGUMENT_INVALID", "polygon must enclose nonzero area");
}

function scanlineIntersections(points: readonly Point[], row: number): Intersection[] {
  const centerY2 = row * 2 + 1;
  const intersections: Intersection[] = [];
  points.forEach((first, index) => {
    const second = points[(index + 1) % points.length];
    if (second === undefined || first.y === second.y) return;
    const low = first.y < second.y ? first : second;
    const high = first.y < second.y ? second : first;
    if (centerY2 < low.y * 2 || centerY2 >= high.y * 2) return;
    const deltaY = high.y - low.y;
    const numerator = 2 * low.x * deltaY +
      (centerY2 - 2 * low.y) * (high.x - low.x);
    intersections.push({ numerator, denominator: 2 * deltaY });
  });
  intersections.sort((left, right) =>
    left.numerator * right.denominator - right.numerator * left.denominator);
  if (intersections.length % 2 !== 0) {
    throw fail("INTERNAL_INVARIANT_FAILED", "simple polygon produced an odd scanline intersection count");
  }
  return intersections;
}

function firstPixelCenterAtOrAfter(intersection: Intersection): number {
  return Math.ceil(
    (2 * intersection.numerator - intersection.denominator) /
      (2 * intersection.denominator),
  );
}

function applyPolygon(
  revision: MutableRevision,
  primitive: PolygonPrimitive,
  operation: "include" | "exclude",
  excludedReasonSample: number,
): void {
  const points = unwrapPolygon(primitive);
  assertSimplePolygon(points);
  const yValues = points.map((point) => point.y);
  const firstRow = Math.max(0, Math.min(...yValues));
  const endRow = Math.min(GRAND_HALL_PANORAMA_HEIGHT_PX, Math.max(...yValues));
  for (let row = firstRow; row < endRow; row += 1) {
    const intersections = scanlineIntersections(points, row);
    for (let index = 0; index < intersections.length; index += 2) {
      const left = intersections[index];
      const right = intersections[index + 1];
      if (left === undefined || right === undefined) {
        throw fail("INTERNAL_INVARIANT_FAILED", "polygon intersection pair is incomplete");
      }
      let start = firstPixelCenterAtOrAfter(left);
      let end = firstPixelCenterAtOrAfter(right);
      if (primitive.horizontalSeam === "none") {
        start = Math.max(0, start);
        end = Math.min(GRAND_HALL_PANORAMA_WIDTH_PX, end);
      }
      if (start < end) {
        applyPossiblyWrappedSpan(revision, row, start, end, operation, excludedReasonSample);
      }
    }
  }
}

function applyPrimitive(
  revision: MutableRevision,
  primitive: MaskPrimitive,
  operation: "include" | "exclude",
  excludedReasonSample: number,
): void {
  if (primitive.kind === "rectangle") {
    applyRectangle(revision, primitive, operation, excludedReasonSample);
  } else {
    applyPolygon(revision, primitive, operation, excludedReasonSample);
  }
}

function sealRevision(revision: MutableRevision, revisionNumber: number): MaskRevision {
  const tiles = revision.tiles.map((tile, tileIndex) => {
    const mutable = revision.clonedTiles.get(tileIndex);
    if (mutable !== undefined) return sealTileState(mutable.mask, mutable.reasons);
    if (!("exactFacts" in tile)) {
      throw fail("INTERNAL_INVARIANT_FAILED", "unchanged mask tile is not sealed");
    }
    return tile;
  });
  const derived = deriveRevisionFactsFromTileCommitments(tiles);
  if (
    derived.includedPixelCount !== revision.includedPixelCount ||
    derived.excludedPixelCount !== revision.excludedPixelCount ||
    derived.reasonCounts.some((count, index) =>
      count !== (revision.reasonCounts[index] ?? 0))
  ) {
    tiles.forEach((tile, tileIndex) => {
      if (revision.clonedTiles.has(tileIndex)) {
        tile.mask.fill(0);
        tile.reasons.fill(0);
      }
    });
    throw fail("INTERNAL_INVARIANT_FAILED", "sealed mask tile facts disagree with the edited revision");
  }
  return Object.freeze({ revision: revisionNumber,
    tiles: Object.freeze(tiles),
    includedPixelCount: revision.includedPixelCount,
    excludedPixelCount: revision.excludedPixelCount,
    reasonCounts: Object.freeze([...revision.reasonCounts]) });
}

function deriveRevisionFactsFromTileCommitments(
  tiles: readonly TileState[],
): DerivedRevisionFacts {
  let includedPixelCount = 0;
  let excludedPixelCount = 0;
  const reasonCounts = Array.from(
    { length: GRAND_HALL_T554_NATIVE_MASK_REASON_CODES.length + 1 },
    () => 0,
  );
  tiles.forEach((tile) => {
    includedPixelCount += tile.exactFacts.includedPixelCount;
    excludedPixelCount += tile.exactFacts.excludedPixelCount;
    tile.exactFacts.reasonCounts.forEach((count, index) => {
      reasonCounts[index] = (reasonCounts[index] ?? 0) + count;
    });
  });
  return { includedPixelCount, excludedPixelCount,
    reasonCounts: Object.freeze(reasonCounts) };
}

function deriveRevisionFacts(revision: MaskRevision): DerivedRevisionFacts {
  const derived = deriveRevisionFactsFromTileCommitments(revision.tiles);
  if (
    derived.includedPixelCount !== revision.includedPixelCount ||
    derived.excludedPixelCount !== revision.excludedPixelCount ||
    derived.reasonCounts.some((count, index) => count !== (revision.reasonCounts[index] ?? 0))
  ) {
    throw fail("INTERNAL_INVARIANT_FAILED", "stored mask revision counts drifted from exact pixels");
  }
  return derived;
}

function flattenPlane(revision: MaskRevision, plane: "mask" | "reasons"): Buffer {
  const bytes = Buffer.alloc(PIXEL_COUNT);
  try {
    revision.tiles.forEach((tile, tileIndex) => {
      const tileRow = Math.floor(tileIndex / TILE_COLUMN_COUNT);
      const tileColumn = tileIndex % TILE_COLUMN_COUNT;
      for (let localY = 0; localY < GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX; localY += 1) {
        const sourceStart = localY * GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX;
        const targetStart =
          (tileRow * GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX + localY) *
            GRAND_HALL_PANORAMA_WIDTH_PX +
          tileColumn * GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX;
        tile[plane].copy(
          bytes,
          targetStart,
          sourceStart,
          sourceStart + GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX,
        );
      }
    });
    return bytes;
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

function retainOnlyPixelPngChunks(bytes: Buffer): Buffer {
  if (bytes.length < 8) throw fail("ENCODING_INVALID", "encoded PNG is truncated");
  const retained = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw fail("ENCODING_INVALID", "encoded PNG chunk is truncated");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd < offset || chunkEnd > bytes.length) {
      throw fail("ENCODING_INVALID", "encoded PNG chunk length is invalid");
    }
    if (type === "IHDR" || type === "IDAT" || type === "IEND") {
      retained.push(bytes.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }
  if (offset !== bytes.length) throw fail("ENCODING_INVALID", "encoded PNG has trailing bytes");
  return Buffer.concat(retained);
}

async function encodeCanonicalPlane(
  pixels: Buffer,
  validate: (bytes: Buffer) => Promise<unknown>,
  label: string,
): Promise<Buffer> {
  let encoded: Buffer | undefined;
  try {
    encoded = await sharp(pixels, { raw: { width: GRAND_HALL_PANORAMA_WIDTH_PX,
      height: GRAND_HALL_PANORAMA_HEIGHT_PX, channels: 1 } })
      .toColourspace("b-w")
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false,
        force: true, progressive: false })
      .toBuffer();
    const canonical = retainOnlyPixelPngChunks(encoded);
    try {
      await validate(canonical);
      return canonical;
    } catch (error) {
      canonical.fill(0);
      throw error;
    }
  } catch (error) {
    if (error instanceof GrandHallT554NativeMaskStoreError) throw error;
    throw fail(
      "ENCODING_INVALID",
      `${label} could not be encoded as canonical grayscale8 PNG`,
      error,
    );
  } finally {
    encoded?.fill(0);
  }
}

function encodeCanonicalMask(mask: Buffer): Promise<Buffer> {
  return encodeCanonicalPlane(mask, validateGrandHallT554MaskPngBytes, "native mask");
}

function encodeCanonicalReasonMap(reasons: Buffer): Promise<Buffer> {
  return encodeCanonicalPlane(
    reasons,
    validateGrandHallT554MaskReasonMapPngBytes,
    "native mask reason map",
  );
}

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function domainDigest(
  domain: string,
  value: unknown,
): `sha256:${string}` {
  const canonical = toBoundedCanonicalJson(value);
  return `sha256:${createHash("sha256")
    .update(
      `${domain}\n${stableBoundedCanonicalJson(canonical)}`,
      "utf8",
    )
    .digest("hex")}`;
}

function sealTileState(mask: Buffer, reasons: Buffer): TileState {
  if (mask.length !== TILE_PIXEL_COUNT || reasons.length !== TILE_PIXEL_COUNT) {
    throw fail("INTERNAL_INVARIANT_FAILED", "mask tile byte length is not exact");
  }
  let includedPixelCount = 0;
  let excludedPixelCount = 0;
  const reasonCounts = Array.from(
    { length: GRAND_HALL_T554_NATIVE_MASK_REASON_CODES.length + 1 },
    () => 0,
  );
  for (let offset = 0; offset < TILE_PIXEL_COUNT; offset += 1) {
    const maskSample = mask[offset];
    const reasonSampleValue = reasons[offset];
    if (maskSample === 0 && reasonSampleValue === 0) {
      includedPixelCount += 1;
    } else if (
      maskSample === 255 && reasonSampleValue !== undefined &&
      reasonSampleValue > 0 && reasonSampleValue <= UNKNOWN_REASON_SAMPLE
    ) {
      excludedPixelCount += 1;
      reasonCounts[reasonSampleValue] =
        (reasonCounts[reasonSampleValue] ?? 0) + 1;
    } else {
      throw fail("INTERNAL_INVARIANT_FAILED", "mask and exclusion-reason tile bytes disagree");
    }
  }
  const tileDigestPair = computeGrandHallT554NativeMaskTileDigestPairV2(mask, reasons);
  const exactFacts: ExactTileFactsV2 = Object.freeze({
    includedPixelCount,
    excludedPixelCount,
    reasonCounts: Object.freeze(reasonCounts),
    maskSha256: tileDigestPair.maskSha256,
    reasonSha256: tileDigestPair.reasonSha256,
  });
  return Object.freeze({ mask, reasons, exactFacts });
}

function computePixelTileInventorySha256(
  revision: MaskRevision,
): `sha256:${string}` {
  return computeGrandHallT554NativeMaskPixelTileInventorySha256V2(
    revision.tiles.map((tile) => ({
      maskSha256: tile.exactFacts.maskSha256,
      reasonSha256: tile.exactFacts.reasonSha256,
    })),
  );
}

function comparablePath(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32"
    ? absolute.replaceAll("/", "\\").toLowerCase()
    : absolute;
}

function sameObjectIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return sameObjectIdentity(left, right) && left.nlink === right.nlink &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

async function inspectPublicationDirectory(path: string): Promise<BigIntStats> {
  const before = await lstat(path, { bigint: true });
  const canonical = await realpath(path);
  const after = await lstat(path, { bigint: true });
  if (
    !before.isDirectory() || before.isSymbolicLink() ||
    !after.isDirectory() || after.isSymbolicLink() ||
    comparablePath(canonical) !== comparablePath(path) ||
    !sameObjectIdentity(before, after)
  ) {
    throw fail("PUBLICATION_INVALID", "mask publication directory is aliased or unstable");
  }
  return after;
}

function outputFileName(
  plane: "mask" | "reason-map",
  source: GrandHallPanoramaSourceJpgIdentityV2,
  revision: number,
  digest: `sha256:${string}`,
): string {
  const fileName = [
    plane,
    String(source.inventoryIndex).padStart(3, "0"),
    `sweep-${String(source.sweepNumber).padStart(3, "0")}`,
    `source-${source.sha256.replace("sha256:", "sha256-")}`,
    `revision-${String(revision).padStart(4, "0")}`,
    digest.replace("sha256:", "sha256-"),
  ].join("-") + ".png";
  if (!CANONICAL_OUTPUT_BASENAME_PATTERN.test(fileName)) {
    throw fail("INTERNAL_INVARIANT_FAILED", "derived frozen mask filename is not canonical");
  }
  return fileName;
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error &&
      typeof error.code === "string"
    ? error.code
    : undefined;
}

async function syncPublicationDirectory(
  publicationDirectory: string,
  expectedDirectory: BigIntStats,
  publishedFile: { readonly absolutePath: string; readonly state: BigIntStats },
  seam: GrandHallT554NativeMaskStoreTestSeam,
): Promise<GrandHallT554NativeMaskPublicationDurability> {
  await seam.beforePublicationDirectorySync?.(publicationDirectory);
  let handle: FileHandle | undefined;
  let mode: GrandHallT554NativeMaskPublicationDurability = "directory_fsync";
  try {
    handle = await open(publicationDirectory, "r");
    const before = await handle.stat({ bigint: true });
    if (!before.isDirectory() || !sameObjectIdentity(before, expectedDirectory)) {
      throw fail(
        "PUBLICATION_INVALID",
        "mask publication directory descriptor differs from the inspected directory",
      );
    }
    try {
      await handle.sync();
    } catch (error) {
      const code = errnoCode(error);
      if (
        process.platform !== "win32" ||
        (code !== "EACCES" && code !== "EBADF" && code !== "EINVAL" &&
          code !== "EISDIR" && code !== "EPERM")
      ) {
        throw error;
      }
      mode = "windows_file_fsync_fallback";
    }
    const after = await handle.stat({ bigint: true });
    if (!after.isDirectory() || !sameObjectIdentity(before, after)) {
      throw fail("PUBLICATION_INVALID", "mask publication directory changed during fsync");
    }
  } finally {
    await handle?.close();
  }
  if (mode === "windows_file_fsync_fallback") {
    let fileHandle: FileHandle | undefined;
    try {
      fileHandle = await open(publishedFile.absolutePath, "r+");
      const before = await fileHandle.stat({ bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
        !sameFileState(before, publishedFile.state)) {
        throw fail(
          "PUBLICATION_INVALID",
          "Windows durability fallback did not reopen the exact published file",
        );
      }
      await fileHandle.sync();
      const after = await fileHandle.stat({ bigint: true });
      if (!sameFileState(before, after)) {
        throw fail(
          "PUBLICATION_INVALID",
          "published file changed during the Windows durability fallback",
        );
      }
    } finally {
      await fileHandle?.close();
    }
  }
  const afterSync = await inspectPublicationDirectory(publicationDirectory);
  if (!sameObjectIdentity(expectedDirectory, afterSync)) {
    throw fail("PUBLICATION_INVALID", "mask publication directory changed after fsync");
  }
  await seam.afterPublicationDurabilityBarrier?.({ publicationDirectory, mode });
  return mode;
}

async function syncDirectoryMetadata(directory: string): Promise<void> {
  const expected = await inspectPublicationDirectory(directory);
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, "r");
    const opened = await handle.stat({ bigint: true });
    if (!opened.isDirectory() || !sameObjectIdentity(expected, opened)) {
      throw fail("PUBLICATION_INVALID", "directory changed before metadata durability barrier");
    }
    try {
      await handle.sync();
    } catch (error) {
      const code = errnoCode(error);
      if (
        process.platform !== "win32" ||
        (code !== "EACCES" && code !== "EBADF" && code !== "EINVAL" &&
          code !== "EISDIR" && code !== "EPERM")
      ) {
        throw error;
      }
    }
    const after = await handle.stat({ bigint: true });
    if (!after.isDirectory() || !sameObjectIdentity(opened, after)) {
      throw fail("PUBLICATION_INVALID", "directory changed during metadata durability barrier");
    }
    const resolvedAfter = await inspectPublicationDirectory(directory);
    if (!sameObjectIdentity(expected, resolvedAfter)) {
      throw fail(
        "PUBLICATION_INVALID",
        "directory path changed during metadata durability barrier",
      );
    }
  } catch (error) {
    if (error instanceof GrandHallT554NativeMaskStoreError) throw error;
    throw fail("PUBLICATION_INVALID", "directory metadata durability barrier failed", error);
  } finally {
    await handle?.close();
  }
}

async function writeAll(handle: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (result.bytesWritten < 1) {
      throw fail("PUBLICATION_INVALID", "frozen mask descriptor stopped accepting bytes");
    }
    offset += result.bytesWritten;
  }
}

async function publishNoReplace(
  publicationDirectory: string,
  fileName: string,
  bytes: Buffer,
  seam: GrandHallT554NativeMaskStoreTestSeam,
): Promise<GrandHallT554NativeMaskPublicationDurability> {
  const outputPath = join(publicationDirectory, fileName);
  let handle: FileHandle | undefined;
  try {
    const rootBefore = await inspectPublicationDirectory(publicationDirectory);
    handle = await open(outputPath, "wx", 0o600);
    const empty = await handle.stat({ bigint: true });
    if (!empty.isFile() || empty.isSymbolicLink() || empty.nlink !== 1n || empty.size !== 0n) {
      throw fail("PUBLICATION_INVALID", "reserved frozen mask descriptor is not a new direct file");
    }
    await writeAll(handle, bytes);
    await handle.sync();
    const written = await handle.stat({ bigint: true });
    if (!sameObjectIdentity(empty, written) || written.nlink !== 1n ||
      written.size !== BigInt(bytes.length)) {
      throw fail("PUBLICATION_INVALID", "frozen mask descriptor identity or length drifted");
    }
    await handle.close();
    handle = undefined;
    const pathState = await lstat(outputPath, { bigint: true });
    const canonical = await realpath(outputPath);
    const rootAfter = await inspectPublicationDirectory(publicationDirectory);
    if (
      !pathState.isFile() || pathState.isSymbolicLink() || pathState.nlink !== 1n ||
      pathState.size !== BigInt(bytes.length) || !sameObjectIdentity(empty, pathState) ||
      comparablePath(canonical) !== comparablePath(outputPath) ||
      !sameObjectIdentity(rootBefore, rootAfter)
    ) {
      throw fail("PUBLICATION_INVALID", "published frozen mask path is aliased or unstable");
    }
    return await syncPublicationDirectory(
      publicationDirectory,
      rootBefore,
      { absolutePath: outputPath, state: pathState },
      seam,
    );
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw fail("PUBLICATION_EXISTS", "frozen mask destination already exists; replacement is forbidden", error);
    }
    if (error instanceof GrandHallT554NativeMaskStoreError) throw error;
    throw fail("PUBLICATION_INVALID", "frozen mask no-replace publication failed", error);
  } finally {
    await handle?.close();
  }
}

interface PreparedPlaneBytes {
  readonly fileName: string;
  readonly digest: `sha256:${string}`;
  readonly bytes: Buffer;
}

interface ExactPathWitness {
  readonly absolutePath: string;
  readonly state: BigIntStats;
}

interface PreparedPublicationRoots {
  readonly publication: BigIntStats;
  readonly preparation: BigIntStats;
}

function isMissing(error: unknown): boolean {
  return errnoCode(error) === "ENOENT";
}

async function readAndCompareExactFile(
  directory: string,
  plane: PreparedPlaneBytes,
  allowedLinkCounts: readonly bigint[],
): Promise<ExactPathWitness | null> {
  const absolutePath = join(directory, plane.fileName);
  let before: BigIntStats;
  try {
    before = await lstat(absolutePath, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  let handle: FileHandle | undefined;
  const scratch = Buffer.allocUnsafe(Math.min(64 * 1_024, Math.max(1, plane.bytes.length)));
  try {
    if (
      !before.isFile() || before.isSymbolicLink() ||
      !allowedLinkCounts.includes(before.nlink) ||
      before.size !== BigInt(plane.bytes.length) ||
      comparablePath(await realpath(absolutePath)) !== comparablePath(absolutePath)
    ) {
      throw fail("PUBLICATION_INVALID", "prepared mask path is not one exact direct file");
    }
    handle = await open(absolutePath, "r");
    const opened = await handle.stat({ bigint: true });
    if (!sameFileState(before, opened)) {
      throw fail("PUBLICATION_INVALID", "prepared mask path changed before exact read");
    }
    let offset = 0;
    while (offset < plane.bytes.length) {
      const requested = Math.min(scratch.length, plane.bytes.length - offset);
      const read = await handle.read(scratch, 0, requested, offset);
      if (read.bytesRead !== requested ||
        !scratch.subarray(0, requested).equals(plane.bytes.subarray(offset, offset + requested))) {
        throw fail("PUBLICATION_INVALID", "prepared mask path bytes differ from the intended bytes");
      }
      offset += requested;
    }
    const eof = await handle.read(scratch, 0, 1, plane.bytes.length);
    if (eof.bytesRead !== 0 || sha256(plane.bytes) !== plane.digest) {
      throw fail("PUBLICATION_INVALID", "prepared mask path length or digest differs from intent");
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await lstat(absolutePath, { bigint: true });
    if (
      !sameFileState(opened, afterHandle) ||
      !sameFileState(afterHandle, afterPath) ||
      comparablePath(await realpath(absolutePath)) !== comparablePath(absolutePath)
    ) {
      throw fail("PUBLICATION_INVALID", "prepared mask path changed during exact read");
    }
    return { absolutePath, state: afterPath };
  } catch (error) {
    if (error instanceof GrandHallT554NativeMaskStoreError) throw error;
    throw fail("PUBLICATION_INVALID", "prepared mask path could not be read exactly", error);
  } finally {
    scratch.fill(0);
    await handle?.close();
  }
}

function dispositionFromPresence(mask: boolean, reasonMap: boolean):
  GrandHallT554NativeMaskPublicationDisposition {
  if (mask && reasonMap) return "mask_and_reason_map";
  if (mask) return "mask_only";
  if (reasonMap) return "reason_map_only";
  return "none";
}

async function unlinkKnownDirectPreparationFile(
  absolutePath: string,
  operationDirectory: string,
): Promise<void> {
  const before = await lstat(absolutePath, { bigint: true });
  if (
    !before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
    comparablePath(await realpath(absolutePath)) !== comparablePath(absolutePath)
  ) {
    throw fail("PUBLICATION_INVALID", "known preparation residue is not one direct file");
  }
  const immediatelyBeforeUnlink = await lstat(absolutePath, { bigint: true });
  if (!sameFileState(before, immediatelyBeforeUnlink)) {
    throw fail("PUBLICATION_INVALID", "known preparation residue changed before unlink");
  }
  await unlink(absolutePath);
  await syncDirectoryMetadata(operationDirectory);
}

async function inspectExactPreparedPublication(
  publicationDirectory: string,
  preparationDirectory: string,
  expectedRoots: PreparedPublicationRoots,
  operationIdSha256: string,
  mask: PreparedPlaneBytes,
  reasonMap: PreparedPlaneBytes,
): Promise<GrandHallT554NativeMaskPublicationDisposition> {
  const rootBefore = await inspectPublicationDirectory(publicationDirectory);
  const preparationRootBefore = await inspectPublicationDirectory(preparationDirectory);
  if (
    !sameObjectIdentity(rootBefore, expectedRoots.publication) ||
    !sameObjectIdentity(preparationRootBefore, expectedRoots.preparation)
  ) {
    throw fail(
      "PUBLICATION_INVALID",
      "prepared mask publication roots changed after pre-intent validation",
    );
  }
  const operationDirectory = join(
    preparationDirectory,
    `freeze-${operationIdSha256.slice("sha256:".length)}`,
  );
  let operationDirectoryExists = false;
  try {
    const operationState = await inspectPublicationDirectory(operationDirectory);
    if (operationState.dev !== expectedRoots.preparation.dev) {
      throw fail(
        "PUBLICATION_INVALID",
        "mask operation stage is on a different filesystem from its pinned preparation root",
      );
    }
    operationDirectoryExists = true;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const maskWitness = await readAndCompareExactFile(
    publicationDirectory,
    mask,
    [1n, 2n, 3n],
  );
  const reasonWitness = await readAndCompareExactFile(
    publicationDirectory,
    reasonMap,
    [1n, 2n, 3n],
  );
  const reconcileLinkedPreparationAliases = async (
    final: ExactPathWitness | null,
    stageLeafName: "mask.stage" | "reason-map.stage",
    pendingLeafName: "mask.pending" | "reason-map.pending",
    plane: PreparedPlaneBytes,
  ): Promise<void> => {
    if (final === null || final.state.nlink === 1n) return;
    if (!operationDirectoryExists) {
      throw fail(
        "PUBLICATION_INVALID",
        "multi-link final mask has no exact operation-stage witness",
      );
    }
    const stage = await readAndCompareExactFile(
      operationDirectory,
      { ...plane, fileName: stageLeafName },
      [1n, 2n, 3n],
    );
    let pending: ExactPathWitness | null = null;
    try {
      pending = await readAndCompareExactFile(
        operationDirectory,
        { ...plane, fileName: pendingLeafName },
        [1n, 2n, 3n],
      );
    } catch {
      // A non-exact direct pending write is handled by the known-residue loop.
    }
    const matchingAliases = [pending, stage].filter(
      (alias): alias is ExactPathWitness =>
        alias !== null && sameObjectIdentity(alias.state, final.state),
    );
    if (final.state.nlink !== BigInt(matchingAliases.length + 1)) {
      throw fail(
        "PUBLICATION_INVALID",
        "multi-link final mask has an unexplained external hard link",
      );
    }
    for (const alias of matchingAliases) {
      await unlinkExactStagePlane(alias, operationDirectory, plane);
      await syncDirectoryMetadata(operationDirectory);
    }
  };
  await reconcileLinkedPreparationAliases(
    maskWitness,
    "mask.stage",
    "mask.pending",
    mask,
  );
  await reconcileLinkedPreparationAliases(
    reasonWitness,
    "reason-map.stage",
    "reason-map.pending",
    reasonMap,
  );
  if (operationDirectoryExists) {
    const expectedStageEntries = [
      { leafName: "mask.pending", plane: mask },
      { leafName: "mask.stage", plane: mask },
      { leafName: "reason-map.pending", plane: reasonMap },
      { leafName: "reason-map.stage", plane: reasonMap },
    ] as const;
    const actualNames = (await readdir(operationDirectory)).sort();
    if (actualNames.some((name) =>
      !expectedStageEntries.some((expected) => expected.leafName === name))) {
      throw fail("PUBLICATION_INVALID", "mask operation stage contains an unexplained entry");
    }
    for (const pair of [
      { pending: "mask.pending", stage: "mask.stage", plane: mask },
      { pending: "reason-map.pending", stage: "reason-map.stage", plane: reasonMap },
    ] as const) {
      let pendingAlias: ExactPathWitness | null = null;
      try {
        pendingAlias = await readAndCompareExactFile(
          operationDirectory,
          { ...pair.plane, fileName: pair.pending },
          [2n],
        );
      } catch {
        // A partial direct pending file is handled by the exact-known cleanup
        // loop below. A two-link mismatch remains fail-closed there.
      }
      if (pendingAlias === null) continue;
      const stageAlias = await readAndCompareExactFile(
        operationDirectory,
        { ...pair.plane, fileName: pair.stage },
        [2n],
      );
      if (
        stageAlias === null ||
        !sameObjectIdentity(pendingAlias.state, stageAlias.state)
      ) {
        throw fail("PUBLICATION_INVALID", "pending mask hard link has no exact stage peer");
      }
      await unlinkExactStagePlane(
        pendingAlias,
        operationDirectory,
        pair.plane,
      );
      await syncDirectoryMetadata(operationDirectory);
    }
    for (const expected of expectedStageEntries) {
      const absolutePath = join(operationDirectory, expected.leafName);
      let witness: ExactPathWitness | null;
      try {
        witness = await readAndCompareExactFile(
          operationDirectory,
          { ...expected.plane, fileName: expected.leafName },
          [1n, 2n],
        );
      } catch (error) {
        if (!expected.leafName.endsWith(".pending")) throw error;
        try {
          await unlinkKnownDirectPreparationFile(absolutePath, operationDirectory);
          continue;
        } catch {
          throw error;
        }
      }
      if (witness === null) continue;
      if (witness.state.nlink !== 1n) {
        throw fail(
          "PUBLICATION_INVALID",
          "mask operation stage retains an unexplained external hard link",
        );
      }
      await unlinkExactStagePlane(
        witness,
        operationDirectory,
        expected.plane,
      );
      await syncDirectoryMetadata(operationDirectory);
    }
  }
  const canonicalMask = await readAndCompareExactFile(
    publicationDirectory,
    mask,
    [1n],
  );
  const canonicalReason = await readAndCompareExactFile(
    publicationDirectory,
    reasonMap,
    [1n],
  );
  if (
    (maskWitness === null) !== (canonicalMask === null) ||
    (reasonWitness === null) !== (canonicalReason === null)
  ) {
    throw fail("PUBLICATION_INVALID", "mask publication presence changed during normalization");
  }
  const rootAfter = await inspectPublicationDirectory(publicationDirectory);
  const preparationRootAfter = await inspectPublicationDirectory(preparationDirectory);
  if (
    !sameFileState(rootBefore, rootAfter) ||
    !sameObjectIdentity(rootAfter, expectedRoots.publication) ||
    !sameObjectIdentity(preparationRootAfter, expectedRoots.preparation)
  ) {
    throw fail("PUBLICATION_INVALID", "mask publication directory changed during inspection");
  }
  if (operationDirectoryExists) {
    await removeEmptyStageDirectory(
      operationDirectory,
      preparationDirectory,
      expectedRoots.preparation,
    );
  }
  if (canonicalMask !== null) await syncExactFile(canonicalMask);
  if (canonicalReason !== null) await syncExactFile(canonicalReason);
  if (canonicalMask !== null || canonicalReason !== null) {
    const durableRoot = await inspectPublicationDirectory(publicationDirectory);
    if (!sameObjectIdentity(durableRoot, expectedRoots.publication)) {
      throw fail(
        "PUBLICATION_INVALID",
        "prepared mask publication root changed before recovery durability barrier",
      );
    }
    if (canonicalMask !== null) {
      await syncPublicationDirectory(
        publicationDirectory,
        durableRoot,
        canonicalMask,
        {},
      );
    }
    if (canonicalReason !== null) {
      await syncPublicationDirectory(
        publicationDirectory,
        durableRoot,
        canonicalReason,
        {},
      );
    }
    const finalRoot = await inspectPublicationDirectory(publicationDirectory);
    if (!sameObjectIdentity(finalRoot, expectedRoots.publication)) {
      throw fail(
        "PUBLICATION_INVALID",
        "prepared mask publication root changed after recovery durability barrier",
      );
    }
  }
  const finalPublicationRoot = await inspectPublicationDirectory(publicationDirectory);
  const finalPreparationRoot = await inspectPublicationDirectory(preparationDirectory);
  if (
    !sameObjectIdentity(finalPublicationRoot, expectedRoots.publication) ||
    !sameObjectIdentity(finalPreparationRoot, expectedRoots.preparation)
  ) {
    throw fail(
      "PUBLICATION_INVALID",
      "prepared mask publication roots changed before recovery classification",
    );
  }
  return dispositionFromPresence(canonicalMask !== null, canonicalReason !== null);
}

async function createOrOpenStageDirectory(
  preparationDirectory: string,
  operationIdSha256: string,
  publicationDirectory: string,
  expectedRoots: PreparedPublicationRoots,
): Promise<string> {
  const preparationRoot = await inspectPublicationDirectory(preparationDirectory);
  const publicationRoot = await inspectPublicationDirectory(publicationDirectory);
  if (
    preparationRoot.dev !== publicationRoot.dev ||
    !sameObjectIdentity(preparationRoot, expectedRoots.preparation) ||
    !sameObjectIdentity(publicationRoot, expectedRoots.publication)
  ) {
    throw fail(
      "PUBLICATION_INVALID",
      "mask preparation and publication directories must be on the same filesystem",
    );
  }
  const operationDirectory = join(
    preparationDirectory,
    `freeze-${operationIdSha256.slice("sha256:".length)}`,
  );
  try {
    await mkdir(operationDirectory, { mode: 0o700 });
  } catch (error) {
    if (errnoCode(error) !== "EEXIST") {
      throw fail("PUBLICATION_INVALID", "mask operation stage could not be created", error);
    }
  }
  const operationState = await inspectPublicationDirectory(operationDirectory);
  if (operationState.dev !== publicationRoot.dev ||
    comparablePath(dirname(operationDirectory)) !== comparablePath(preparationDirectory)) {
    throw fail("PUBLICATION_INVALID", "mask operation stage is aliased or cross-volume");
  }
  const names = (await readdir(operationDirectory)).sort();
  if (names.some((name) =>
    name !== "mask.pending" &&
    name !== "mask.stage" &&
    name !== "reason-map.pending" &&
    name !== "reason-map.stage")) {
    throw fail("PUBLICATION_INVALID", "mask operation stage contains an unexplained entry");
  }
  await syncDirectoryMetadata(preparationDirectory);
  const preparationAfterSync = await inspectPublicationDirectory(preparationDirectory);
  const operationAfterSync = await inspectPublicationDirectory(operationDirectory);
  if (
    !sameObjectIdentity(preparationAfterSync, expectedRoots.preparation) ||
    !sameObjectIdentity(operationAfterSync, operationState)
  ) {
    throw fail(
      "PUBLICATION_INVALID",
      "mask operation-stage custody changed during its parent durability barrier",
    );
  }
  return operationDirectory;
}

async function assertPreparedPublicationRoots(
  publicationDirectory: string,
  preparationDirectory: string,
): Promise<PreparedPublicationRoots> {
  const publication = await inspectPublicationDirectory(publicationDirectory);
  const preparation = await inspectPublicationDirectory(preparationDirectory);
  if (publication.dev !== preparation.dev) {
    throw fail(
      "PUBLICATION_INVALID",
      "mask preparation and publication directories must be stable and same-volume before intent",
    );
  }
  return Object.freeze({ publication, preparation });
}

async function writeOrVerifyStagePlane(
  operationDirectory: string,
  stageLeafName: "mask.stage" | "reason-map.stage",
  plane: PreparedPlaneBytes,
): Promise<ExactPathWitness> {
  const pendingLeafName = stageLeafName === "mask.stage"
    ? "mask.pending" as const
    : "reason-map.pending" as const;
  const stagePlane = { ...plane, fileName: stageLeafName };
  const pendingPlane = { ...plane, fileName: pendingLeafName };
  let existing = await readAndCompareExactFile(
    operationDirectory,
    stagePlane,
    [1n, 2n],
  );
  let pending: ExactPathWitness | null = null;
  try {
    pending = await readAndCompareExactFile(
      operationDirectory,
      pendingPlane,
      [1n, 2n],
    );
  } catch (error) {
    const pendingPath = join(operationDirectory, pendingLeafName);
    let incomplete: BigIntStats;
    try {
      incomplete = await lstat(pendingPath, { bigint: true });
    } catch (statError) {
      if (isMissing(statError)) throw error;
      throw statError;
    }
    if (
      !incomplete.isFile() || incomplete.isSymbolicLink() || incomplete.nlink !== 1n ||
      comparablePath(await realpath(pendingPath)) !== comparablePath(pendingPath)
    ) {
      throw error;
    }
    const immediatelyBeforeUnlink = await lstat(pendingPath, { bigint: true });
    if (!sameFileState(incomplete, immediatelyBeforeUnlink)) throw error;
    await unlink(pendingPath);
    await syncDirectoryMetadata(operationDirectory);
  }
  if (existing !== null) {
    if (pending !== null) {
      if (
        existing.state.nlink !== 2n || pending.state.nlink !== 2n ||
        !sameObjectIdentity(existing.state, pending.state)
      ) {
        throw fail("PUBLICATION_INVALID", "mask stage and pending aliases disagree");
      }
      await unlinkExactStagePlane(pending, operationDirectory, plane);
      await syncDirectoryMetadata(operationDirectory);
      existing = await readAndCompareExactFile(operationDirectory, stagePlane, [1n, 2n]);
      if (existing === null) {
        throw fail("PUBLICATION_INVALID", "mask stage vanished during pending reconciliation");
      }
    }
    return existing;
  }
  const absolutePendingPath = join(operationDirectory, pendingLeafName);
  let handle: FileHandle | undefined;
  try {
    if (pending === null) {
      handle = await open(absolutePendingPath, "wx", 0o600);
    }
    if (handle !== undefined) {
      const empty = await handle.stat({ bigint: true });
      if (!empty.isFile() || empty.isSymbolicLink() || empty.nlink !== 1n || empty.size !== 0n) {
        throw fail("PUBLICATION_INVALID", "mask stage descriptor is not a fresh direct file");
      }
      await writeAll(handle, plane.bytes);
      await handle.sync();
      const written = await handle.stat({ bigint: true });
      if (
        !sameObjectIdentity(empty, written) || written.nlink !== 1n ||
        written.size !== BigInt(plane.bytes.length)
      ) {
        throw fail("PUBLICATION_INVALID", "mask stage descriptor changed while writing");
      }
      await handle.close();
      handle = undefined;
      pending = await readAndCompareExactFile(operationDirectory, pendingPlane, [1n]);
      if (pending === null) {
        throw fail("PUBLICATION_INVALID", "mask pending file vanished after its durable write");
      }
    }
    if (pending === null) {
      throw fail("PUBLICATION_INVALID", "mask pending file is absent before stage promotion");
    }
    await syncExactFile(pending);
    await syncDirectoryMetadata(operationDirectory);
    try {
      await link(absolutePendingPath, join(operationDirectory, stageLeafName));
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") throw error;
      const racedStage = await readAndCompareExactFile(
        operationDirectory,
        stagePlane,
        [2n],
      );
      if (racedStage === null || !sameObjectIdentity(racedStage.state, pending.state)) {
        throw fail("PUBLICATION_INVALID", "mask stage promotion collided with a different node");
      }
    }
    await syncDirectoryMetadata(operationDirectory);
    pending = await readAndCompareExactFile(operationDirectory, pendingPlane, [2n]);
    const promoted = await readAndCompareExactFile(operationDirectory, stagePlane, [2n]);
    if (
      pending === null || promoted === null ||
      !sameObjectIdentity(pending.state, promoted.state)
    ) {
      throw fail("PUBLICATION_INVALID", "mask stage promotion did not create one exact hard-link pair");
    }
    await unlinkExactStagePlane(pending, operationDirectory, plane);
    await syncDirectoryMetadata(operationDirectory);
    const witnessed = await readAndCompareExactFile(operationDirectory, stagePlane, [1n]);
    if (witnessed === null) {
      throw fail("PUBLICATION_INVALID", "mask stage vanished after pending cleanup");
    }
    return witnessed;
  } catch (error) {
    if (error instanceof GrandHallT554NativeMaskStoreError) throw error;
    throw fail("PUBLICATION_INVALID", "mask stage write failed", error);
  } finally {
    await handle?.close();
  }
}

async function assertExistingStageTopology(
  stage: ExactPathWitness,
  publicationDirectory: string,
  plane: PreparedPlaneBytes,
): Promise<void> {
  if (stage.state.nlink === 1n) return;
  const final = await readAndCompareExactFile(publicationDirectory, plane, [2n]);
  if (final === null || !sameObjectIdentity(stage.state, final.state)) {
    throw fail(
      "PUBLICATION_INVALID",
      "two-link mask stage is not paired only with its exact intended final name",
    );
  }
}

async function linkNoReplaceOrVerifyExact(
  stage: ExactPathWitness,
  publicationDirectory: string,
  plane: PreparedPlaneBytes,
  expectedPublicationRoot: BigIntStats,
  disposition: "must_create" | "must_exist",
): Promise<void> {
  const outputPath = join(publicationDirectory, plane.fileName);
  const rootBefore = await inspectPublicationDirectory(publicationDirectory);
  if (!sameObjectIdentity(rootBefore, expectedPublicationRoot)) {
    throw fail("PUBLICATION_INVALID", "prepared mask publication root changed before linking");
  }
  if (disposition === "must_exist") {
    const existing = await readAndCompareExactFile(publicationDirectory, plane, [1n]);
    const rootAfter = await inspectPublicationDirectory(publicationDirectory);
    if (
      existing === null ||
      !sameObjectIdentity(rootAfter, expectedPublicationRoot) ||
      !sameObjectIdentity(rootBefore, rootAfter)
    ) {
      throw fail(
        "PUBLICATION_INVALID",
        "complete prepared evidence changed before exact adoption",
      );
    }
    return;
  }
  try {
    await link(stage.absolutePath, outputPath);
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw fail(
        "PUBLICATION_INVALID",
        "prepared mask destination appeared after an empty pre-publication disposition",
        error,
      );
    }
    throw fail("PUBLICATION_INVALID", "prepared mask hard-link publication failed", error);
  }
  const stagedAfter = await lstat(stage.absolutePath, { bigint: true });
  const linked = await lstat(outputPath, { bigint: true });
  const rootAfter = await inspectPublicationDirectory(publicationDirectory);
  if (
    !sameObjectIdentity(stage.state, stagedAfter) ||
    !sameObjectIdentity(stagedAfter, linked) ||
    stagedAfter.nlink !== 2n || linked.nlink !== 2n ||
    linked.size !== BigInt(plane.bytes.length) ||
    comparablePath(await realpath(outputPath)) !== comparablePath(outputPath) ||
    !sameObjectIdentity(rootAfter, expectedPublicationRoot) ||
    !sameObjectIdentity(rootBefore, rootAfter)
  ) {
    throw fail("PUBLICATION_INVALID", "prepared mask hard link has unexpected identity or topology");
  }
}

async function unlinkExactStagePlane(
  stage: ExactPathWitness,
  operationDirectory: string,
  plane: PreparedPlaneBytes,
): Promise<void> {
  const stageLeafName = basename(stage.absolutePath);
  const witnessed = await readAndCompareExactFile(
    operationDirectory,
    { ...plane, fileName: stageLeafName },
    [1n, 2n, 3n],
  );
  if (witnessed === null) {
    throw fail("PUBLICATION_INVALID", "mask stage vanished before exact unlink");
  }
  const before = witnessed.state;
  if (
    !before.isFile() || before.isSymbolicLink() ||
    !sameObjectIdentity(before, stage.state) ||
    before.size !== BigInt(plane.bytes.length)
  ) {
    throw fail("PUBLICATION_INVALID", "mask stage changed before exact unlink");
  }
  await unlink(stage.absolutePath);
  try {
    await lstat(stage.absolutePath, { bigint: true });
    throw fail("PUBLICATION_INVALID", "mask stage still exists after exact unlink");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await inspectPublicationDirectory(operationDirectory);
}

async function syncExactFile(witness: ExactPathWitness): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(witness.absolutePath, "r+");
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() || opened.isSymbolicLink() || opened.nlink !== 1n ||
      !sameFileState(opened, witness.state)
    ) {
      throw fail("PUBLICATION_INVALID", "exact final changed before file durability barrier");
    }
    await handle.sync();
    const after = await handle.stat({ bigint: true });
    if (!sameFileState(opened, after)) {
      throw fail("PUBLICATION_INVALID", "exact final changed during file durability barrier");
    }
  } catch (error) {
    if (error instanceof GrandHallT554NativeMaskStoreError) throw error;
    throw fail("PUBLICATION_INVALID", "exact final file durability barrier failed", error);
  } finally {
    await handle?.close();
  }
}

async function removeEmptyStageDirectory(
  operationDirectory: string,
  preparationDirectory: string,
  expectedPreparationRoot: BigIntStats,
): Promise<void> {
  const names = await readdir(operationDirectory);
  if (names.length !== 0) {
    throw fail("PUBLICATION_INVALID", "mask operation stage was not empty after publication");
  }
  const before = await inspectPublicationDirectory(operationDirectory);
  await rmdir(operationDirectory);
  try {
    await lstat(operationDirectory, { bigint: true });
    throw fail("PUBLICATION_INVALID", "mask operation stage still exists after removal");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const preparationState = await inspectPublicationDirectory(preparationDirectory);
  if (
    preparationState.dev !== before.dev ||
    !sameObjectIdentity(preparationState, expectedPreparationRoot)
  ) {
    throw fail("PUBLICATION_INVALID", "mask preparation directory changed during cleanup");
  }
  await syncDirectoryMetadata(preparationDirectory);
  const preparationAfterSync = await inspectPublicationDirectory(preparationDirectory);
  if (!sameObjectIdentity(preparationAfterSync, expectedPreparationRoot)) {
    throw fail("PUBLICATION_INVALID", "mask preparation directory changed after cleanup");
  }
}

async function reopenPublishedEvidence(
  publicationDirectory: string,
  mask: {
    readonly fileName: string;
    readonly digest: `sha256:${string}`;
    readonly byteLength: number;
  },
  reasonMap: {
    readonly fileName: string;
    readonly digest: `sha256:${string}`;
    readonly byteLength: number;
  },
): Promise<DerivedRevisionFacts> {
  try {
    const verified = await verifyGrandHallT554NativeMaskEvidence({
      sourceRoot: publicationDirectory,
      fileName: mask.fileName,
      expectedSha256: mask.digest,
      expectedByteLength: mask.byteLength,
    }, {
      sourceRoot: publicationDirectory,
      fileName: reasonMap.fileName,
      expectedSha256: reasonMap.digest,
      expectedByteLength: reasonMap.byteLength,
    });
    return { includedPixelCount: verified.includedPixelCount,
      excludedPixelCount: verified.excludedPixelCount,
      reasonCounts: Object.freeze([0, ...verified.reasonSampleCounts.slice(1)]) };
  } catch (error) {
    throw fail(
      "PUBLICATION_INVALID",
      "published mask evidence failed exact same-path reopen and source-aligned full decode",
      error,
    );
  }
}

function cloneFrozenBinding<T extends GrandHallT554NativeMaskFrozenBinding>(binding: T): T {
  return structuredClone(binding);
}

function sameDerivedFacts(left: DerivedRevisionFacts, right: DerivedRevisionFacts): boolean {
  return left.includedPixelCount === right.includedPixelCount &&
    left.excludedPixelCount === right.excludedPixelCount &&
    left.reasonCounts.length === right.reasonCounts.length &&
    left.reasonCounts.every((count, index) => count === right.reasonCounts[index]);
}

function factsFromBinding(binding: GrandHallT554NativeMaskFrozenBindingV2): DerivedRevisionFacts {
  const reasonCounts = Array.from(
    { length: GRAND_HALL_T554_NATIVE_MASK_REASON_CODES.length + 1 },
    () => 0,
  );
  binding.reasonCounts.forEach((entry) => {
    reasonCounts[reasonSample(entry.reasonCode)] = entry.pixelCount;
  });
  return { includedPixelCount: binding.includedPixelCount,
    excludedPixelCount: binding.excludedPixelCount,
    reasonCounts: Object.freeze(reasonCounts) };
}

function clonePreparedBinding(
  binding: GrandHallT554NativeMaskPreparedBindingV2,
): GrandHallT554NativeMaskPreparedBindingV2 {
  const clone = structuredClone(binding);
  Object.freeze(clone.source);
  clone.reasonCounts.forEach(Object.freeze);
  Object.freeze(clone.reasonCounts);
  Object.freeze(clone.mask.permittedPixelValues);
  Object.freeze(clone.mask);
  clone.reasonMap.reasonSampleCodebook.forEach(Object.freeze);
  Object.freeze(clone.reasonMap.reasonSampleCodebook);
  Object.freeze(clone.reasonMap.permittedPixelValues);
  Object.freeze(clone.reasonMap);
  return Object.freeze(clone);
}

function preparedBindingFromEncoded(
  source: GrandHallPanoramaSourceJpgIdentityV2,
  revision: MaskRevision,
  facts: DerivedRevisionFacts,
  encodedMask: Buffer,
  encodedReasonMap: Buffer,
): GrandHallT554NativeMaskPreparedBindingV2 {
  const maskDigest = sha256(encodedMask);
  const reasonMapDigest = sha256(encodedReasonMap);
  const maskFileName = outputFileName("mask", source, revision.revision, maskDigest);
  const reasonMapFileName = outputFileName(
    "reason-map",
    source,
    revision.revision,
    reasonMapDigest,
  );
  const binding: GrandHallT554NativeMaskPreparedBindingV2 = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-mask-prepared-binding.v2" as const,
    source: cloneSource(source),
    revision: revision.revision,
    includedPixelCount: facts.includedPixelCount,
    excludedPixelCount: facts.excludedPixelCount,
    reasonCounts: [...reasonCountObjects(facts.reasonCounts)],
    mask: {
      fileName: maskFileName,
      sha256: maskDigest,
      byteLength: encodedMask.length,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      bitDepth: 8 as const,
      channelCount: 1 as const,
      permittedPixelValues: [0, 255],
      zeroMeaning: "grand_hall_included" as const,
      twoHundredFiftyFiveMeaning: "excluded_or_unknown" as const,
    },
    reasonMap: {
      fileName: reasonMapFileName,
      sha256: reasonMapDigest,
      byteLength: encodedReasonMap.length,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      bitDepth: 8 as const,
      channelCount: 1 as const,
      permittedPixelValues: [0, 1, 2, 3, 4, 5],
      zeroMeaning: "grand_hall_included" as const,
      reasonSampleCodebook: REASON_SAMPLE_CODEBOOK.map((entry) => ({ ...entry })) as
        GrandHallT554NativeMaskPreparedReasonMapBindingV2["reasonSampleCodebook"],
    },
  };
  return clonePreparedBinding(binding);
}

async function publishPreparedPair(
  publicationDirectory: string,
  preparationDirectory: string,
  expectedRoots: PreparedPublicationRoots,
  operationIdSha256: string,
  initialDisposition: "none" | "mask_and_reason_map",
  prepared: GrandHallT554NativeMaskPreparedBindingV2,
  encodedMask: Buffer,
  encodedReasonMap: Buffer,
  facts: DerivedRevisionFacts,
  seam: GrandHallT554NativeMaskStoreTestSeam,
): Promise<GrandHallT554NativeMaskFrozenBindingV2> {
  const mask: PreparedPlaneBytes = {
    fileName: prepared.mask.fileName,
    digest: prepared.mask.sha256,
    bytes: encodedMask,
  };
  const reasonMap: PreparedPlaneBytes = {
    fileName: prepared.reasonMap.fileName,
    digest: prepared.reasonMap.sha256,
    bytes: encodedReasonMap,
  };
  const operationDirectory = await createOrOpenStageDirectory(
    preparationDirectory,
    operationIdSha256,
    publicationDirectory,
    expectedRoots,
  );
  const maskStage = await writeOrVerifyStagePlane(
    operationDirectory,
    "mask.stage",
    mask,
  );
  const reasonStage = await writeOrVerifyStagePlane(
    operationDirectory,
    "reason-map.stage",
    reasonMap,
  );
  await assertExistingStageTopology(maskStage, publicationDirectory, mask);
  await assertExistingStageTopology(reasonStage, publicationDirectory, reasonMap);
  const linkDisposition = initialDisposition === "none" ? "must_create" : "must_exist";
  await linkNoReplaceOrVerifyExact(
    maskStage,
    publicationDirectory,
    mask,
    expectedRoots.publication,
    linkDisposition,
  );
  await seam.afterPreparedFinalLinked?.({ plane: "mask" });
  await linkNoReplaceOrVerifyExact(
    reasonStage,
    publicationDirectory,
    reasonMap,
    expectedRoots.publication,
    linkDisposition,
  );
  await seam.afterPreparedFinalLinked?.({ plane: "reason_map" });

  if (process.platform !== "win32") {
    const publicationRoot = await inspectPublicationDirectory(publicationDirectory);
    if (!sameObjectIdentity(publicationRoot, expectedRoots.publication)) {
      throw fail("PUBLICATION_INVALID", "prepared mask publication root changed before fsync");
    }
    const maskLinked = await readAndCompareExactFile(
      publicationDirectory,
      mask,
      [1n, 2n],
    );
    const reasonLinked = await readAndCompareExactFile(
      publicationDirectory,
      reasonMap,
      [1n, 2n],
    );
    if (maskLinked === null || reasonLinked === null) {
      throw fail("PUBLICATION_INVALID", "prepared mask pair vanished before durability barrier");
    }
    const maskMode = await syncPublicationDirectory(
      publicationDirectory,
      publicationRoot,
      maskLinked,
      {},
    );
    const reasonMode = await syncPublicationDirectory(
      publicationDirectory,
      publicationRoot,
      reasonLinked,
      {},
    );
    if (maskMode !== reasonMode) {
      throw fail("PUBLICATION_INVALID", "prepared mask pair used inconsistent durability barriers");
    }
  }

  await unlinkExactStagePlane(maskStage, operationDirectory, mask);
  await syncDirectoryMetadata(operationDirectory);
  await unlinkExactStagePlane(reasonStage, operationDirectory, reasonMap);
  await syncDirectoryMetadata(operationDirectory);

  const publicationRoot = await inspectPublicationDirectory(publicationDirectory);
  if (!sameObjectIdentity(publicationRoot, expectedRoots.publication)) {
    throw fail("PUBLICATION_INVALID", "prepared mask publication root changed before final flush");
  }
  const maskFinal = await readAndCompareExactFile(publicationDirectory, mask, [1n]);
  const reasonFinal = await readAndCompareExactFile(publicationDirectory, reasonMap, [1n]);
  if (maskFinal === null || reasonFinal === null) {
    throw fail("PUBLICATION_INVALID", "prepared mask pair vanished before final flush");
  }
  await syncExactFile(maskFinal);
  await syncExactFile(reasonFinal);
  const maskMode = await syncPublicationDirectory(
    publicationDirectory,
    publicationRoot,
    maskFinal,
    seam,
  );
  const reasonMode = await syncPublicationDirectory(
    publicationDirectory,
    publicationRoot,
    reasonFinal,
    seam,
  );
  if (maskMode !== reasonMode) {
    throw fail("PUBLICATION_INVALID", "prepared mask pair used inconsistent final barriers");
  }
  const publicationDurability = maskMode;

  const verified = await reopenPublishedEvidence(
    publicationDirectory,
    {
      fileName: prepared.mask.fileName,
      digest: prepared.mask.sha256,
      byteLength: prepared.mask.byteLength,
    },
    {
      fileName: prepared.reasonMap.fileName,
      digest: prepared.reasonMap.sha256,
      byteLength: prepared.reasonMap.byteLength,
    },
  );
  if (!sameDerivedFacts(verified, facts)) {
    throw fail(
      "PUBLICATION_INVALID",
      "reopened prepared PNG evidence differs from the immutable mask revision",
    );
  }
  await seam.afterPreparedPairVerified?.();
  await removeEmptyStageDirectory(
    operationDirectory,
    preparationDirectory,
    expectedRoots.preparation,
  );
  const finalPublicationRoot = await inspectPublicationDirectory(publicationDirectory);
  const finalPreparationRoot = await inspectPublicationDirectory(preparationDirectory);
  if (
    !sameObjectIdentity(finalPublicationRoot, expectedRoots.publication) ||
    !sameObjectIdentity(finalPreparationRoot, expectedRoots.preparation)
  ) {
    throw fail(
      "PUBLICATION_INVALID",
      "prepared mask publication roots changed before verified return",
    );
  }
  return Object.freeze({
    schemaVersion: "venviewer.grand-hall-t554-native-mask-frozen-binding.v2" as const,
    source: Object.freeze(cloneSource(prepared.source)),
    revision: prepared.revision,
    fileName: prepared.mask.fileName,
    sha256: prepared.mask.sha256,
    byteLength: prepared.mask.byteLength,
    widthPx: prepared.mask.widthPx,
    heightPx: prepared.mask.heightPx,
    bitDepth: prepared.mask.bitDepth,
    channelCount: prepared.mask.channelCount,
    permittedPixelValues: prepared.mask.permittedPixelValues,
    zeroMeaning: prepared.mask.zeroMeaning,
    twoHundredFiftyFiveMeaning: prepared.mask.twoHundredFiftyFiveMeaning,
    includedPixelCount: verified.includedPixelCount,
    excludedPixelCount: verified.excludedPixelCount,
    reasonCounts: Object.freeze(reasonCountObjects(verified.reasonCounts)),
    publicationDurability,
    reasonMap: Object.freeze(structuredClone(prepared.reasonMap)),
    immutableFrozen: true as const,
  });
}

function assertPixelCoordinate(x: number, y: number): void {
  if (
    !Number.isInteger(x) || !Number.isInteger(y) ||
    x < 0 || x >= GRAND_HALL_PANORAMA_WIDTH_PX ||
    y < 0 || y >= GRAND_HALL_PANORAMA_HEIGHT_PX
  ) {
    throw fail("ARGUMENT_INVALID", "mask pixel coordinate is outside the exact source grid");
  }
}

export class GrandHallT554NativeMaskRevisionStore {
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  readonly #publicationDirectory: string | null;
  readonly #preparationDirectory: string | null;
  readonly #replayOnly: boolean;
  readonly #revisions = new Map<number, MaskRevision>();
  #currentRevisionNumber = 0;
  #activeFrozenBinding: GrandHallT554NativeMaskFrozenBindingV2 | null = null;
  #abandoned = false;
  #operationBusy = false;
  #activePreparationToken: object | null = null;
  #ownedBufferBytes = TILE_PIXEL_COUNT * 2;
  #changedTileSealCount = 0;

  constructor(config: GrandHallT554NativeMaskStoreConfig) {
    const parsed = parseConfig(config);
    this.source = parsed.source;
    this.#publicationDirectory = parsed.publicationDirectory;
    this.#preparationDirectory = parsed.preparationDirectory;
    this.#replayOnly = parsed.replayOnly;
    this.#revisions.set(0, initialRevision());
  }

  static createReplayOnly(
    source: GrandHallPanoramaSourceJpgIdentityV2,
  ): GrandHallT554NativeMaskRevisionStore {
    return new GrandHallT554NativeMaskRevisionStore({ source, mode: "replay-only" });
  }

  #assertUsable(): void {
    if (this.#abandoned) throw fail("STORE_ABANDONED", "native mask store was abandoned");
  }

  #currentRevision(): MaskRevision {
    this.#assertUsable();
    const revision = this.#revisions.get(this.#currentRevisionNumber);
    if (revision === undefined) {
      throw fail("INTERNAL_INVARIANT_FAILED", "current native mask revision is absent");
    }
    return revision;
  }

  #assertExpectedRevision(expectedRevision: number): void {
    if (expectedRevision !== this.#currentRevisionNumber) {
      throw fail("REVISION_CONFLICT", "native mask compare-and-swap revision is stale");
    }
  }

  snapshot(): GrandHallT554NativeMaskStoreSnapshot {
    const revision = this.#currentRevision();
    return { schemaVersion: GRAND_HALL_T554_NATIVE_MASK_STORE_V1,
      source: cloneSource(this.source), revision: revision.revision,
      includedPixelCount: revision.includedPixelCount,
      excludedPixelCount: revision.excludedPixelCount,
      reasonCounts: reasonCountObjects(revision.reasonCounts),
      activeFrozenBinding: this.#activeFrozenBinding === null
        ? null : cloneFrozenBinding(this.#activeFrozenBinding) };
  }

  exactStateV2(context: unknown): GrandHallT554NativeMaskExactStateV2 {
    const canonicalContext = toBoundedCanonicalJson(context);
    const revision = this.#currentRevision();
    const facts = deriveRevisionFacts(revision);
    const reasonCounts = reasonCountObjects(facts.reasonCounts);
    const pixelTileInventorySha256 =
      computePixelTileInventorySha256(revision);
    const header = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-mask-exact-state-header.v2",
      rasterizerVersion: GRAND_HALL_T554_NATIVE_MASK_RASTERIZER_V2,
      context: canonicalContext,
      source: this.source,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      tileWidthPx: GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX,
      tileHeightPx: GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX,
      tileOrder: "row-major-tiles-and-row-major-pixels.v1",
      revision: revision.revision,
      includedPixelCount: facts.includedPixelCount,
      excludedPixelCount: facts.excludedPixelCount,
      reasonCounts,
      pixelTileInventorySha256,
    };
    return Object.freeze({
      schemaVersion:
        "venviewer.grand-hall-t554-native-mask-exact-state.v2" as const,
      rasterizerVersion: GRAND_HALL_T554_NATIVE_MASK_RASTERIZER_V2,
      revision: revision.revision,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      includedPixelCount: facts.includedPixelCount,
      excludedPixelCount: facts.excludedPixelCount,
      reasonCounts,
      pixelTileInventorySha256,
      maskStateSha256: domainDigest(MASK_EXACT_STATE_DIGEST_DOMAIN, header),
    });
  }

  pixelForServerRender(x: number, y: number): GrandHallT554NativeMaskPixel {
    this.#assertUsable();
    assertPixelCoordinate(x, y);
    const revision = this.#currentRevision();
    const located = tileIndexAndOffset(x, y);
    const tile = revision.tiles[located.tileIndex];
    const value = tile?.mask[located.offset];
    const reason = tile?.reasons[located.offset];
    if ((value !== 0 && value !== 255) || reason === undefined) {
      throw fail("INTERNAL_INVARIANT_FAILED", "native mask pixel is unavailable");
    }
    return { value, reasonCode: reason === 0 ? null : reasonCode(reason) };
  }

  applyEdit(input: unknown): GrandHallT554NativeMaskStoreSnapshot {
    this.#assertUsable();
    if (this.#operationBusy) throw fail("OPERATION_BUSY", "a native mask freeze is in progress");
    const edit = parseEdit(input);
    this.#assertExpectedRevision(edit.expectedRevision);
    if (this.#currentRevisionNumber >= GRAND_HALL_T554_NATIVE_MASK_MAX_REVISION) {
      throw fail("REVISION_LIMIT_REACHED", "native mask revision bound was reached");
    }
    const mutable = mutableRevision(this.#currentRevision());
    const excludedReasonSample = edit.operation === "exclude"
      ? reasonSample(edit.reasonCode)
      : 0;
    try {
      applyPrimitive(mutable, edit.primitive, edit.operation, excludedReasonSample);
    } catch (error) {
      zeroClonedRevisionBuffers(mutable);
      throw error;
    }
    if (mutable.clonedTiles.size === 0) {
      throw fail("NO_CHANGE", "native mask edit did not change any source-grid pixel");
    }
    const seam = TEST_SEAMS.get(this);
    const maximumChangedTileSeals = seam?.maximumChangedTileSeals ??
      GRAND_HALL_T554_NATIVE_MASK_MAX_CHANGED_TILE_SEALS;
    if (this.#changedTileSealCount + mutable.clonedTiles.size > maximumChangedTileSeals) {
      zeroClonedRevisionBuffers(mutable);
      throw fail(
        "RASTER_WORK_LIMIT_REACHED",
        "native mask cumulative changed-tile seal budget was reached",
      );
    }
    const addedBufferBytes = mutable.clonedTiles.size * TILE_PIXEL_COUNT * 2;
    if (this.#ownedBufferBytes + addedBufferBytes >
      GRAND_HALL_T554_NATIVE_MASK_MAX_OWNED_BUFFER_BYTES) {
      zeroClonedRevisionBuffers(mutable);
      throw fail(
        "REVISION_STORAGE_LIMIT_REACHED",
        "native mask immutable-revision buffer budget was reached",
      );
    }
    const nextNumber = this.#currentRevisionNumber + 1;
    let sealed: MaskRevision;
    try {
      sealed = sealRevision(mutable, nextNumber);
    } catch (error) {
      zeroClonedRevisionBuffers(mutable);
      throw error;
    }
    this.#revisions.set(nextNumber, sealed);
    this.#currentRevisionNumber = nextNumber;
    this.#ownedBufferBytes += addedBufferBytes;
    this.#changedTileSealCount += mutable.clonedTiles.size;
    this.#activeFrozenBinding = null;
    return this.snapshot();
  }

  async prepareFreeze(input: unknown): Promise<GrandHallT554NativeMaskPreparedFreezeV2> {
    this.#assertUsable();
    if (
      this.#replayOnly ||
      this.#publicationDirectory === null ||
      this.#preparationDirectory === null
    ) {
      throw fail(
        "PUBLICATION_DISABLED",
        "prepared mask publication requires explicit evidence and same-volume preparation directories",
      );
    }
    const request = parsePrepareFreezeRequest(input);
    const publicationDirectory = this.#publicationDirectory;
    const preparationDirectory = this.#preparationDirectory;
    this.#assertExpectedRevision(request.expectedRevision);
    if (this.#operationBusy) {
      throw fail("OPERATION_BUSY", "a native mask mutation or preparation is in progress");
    }
    this.#operationBusy = true;
    let rawMask: Buffer | undefined;
    let rawReasonMap: Buffer | undefined;
    let encodedMask: Buffer | undefined;
    let encodedReasonMap: Buffer | undefined;
    let expectedRoots: PreparedPublicationRoots;
    let handedOff = false;
    try {
      try {
        await (TEST_SEAMS.get(this) ?? {}).beforePreparedPublicationRootsValidated?.();
        expectedRoots = await assertPreparedPublicationRoots(
          publicationDirectory,
          preparationDirectory,
        );
      } catch (error) {
        this.#activeFrozenBinding = null;
        if (error instanceof GrandHallT554NativeMaskStoreError) throw error;
        throw fail(
          "PUBLICATION_INVALID",
          "prepared mask publication roots could not be validated",
          error,
        );
      }
      this.#assertUsable();
      this.#assertExpectedRevision(request.expectedRevision);
      const revision = this.#currentRevision();
      const facts = deriveRevisionFacts(revision);
      rawMask = flattenPlane(revision, "mask");
      rawReasonMap = flattenPlane(revision, "reasons");
      encodedMask = await encodeCanonicalMask(rawMask);
      encodedReasonMap = await encodeCanonicalReasonMap(rawReasonMap);
      const prepared = preparedBindingFromEncoded(
        this.source,
        revision,
        facts,
        encodedMask,
        encodedReasonMap,
      );
      const maskBytes = encodedMask;
      const reasonBytes = encodedReasonMap;
      const preparedRoots = expectedRoots;
      const token = Object.freeze({});
      this.#activePreparationToken = token;
      let consumed = false;
      let capabilityBusy = false;
      const assertLive = (): void => {
        if (
          consumed ||
          this.#activePreparationToken !== token ||
          !this.#operationBusy ||
          this.#abandoned
        ) {
          throw fail(
            "PREPARED_FREEZE_CONSUMED",
            "prepared mask capability is no longer live",
          );
        }
      };
      const release = (): void => {
        maskBytes.fill(0);
        reasonBytes.fill(0);
        if (this.#activePreparationToken === token) {
          this.#activePreparationToken = null;
          this.#operationBusy = false;
        }
      };
      const publicBinding = clonePreparedBinding(prepared);
      const capability: GrandHallT554NativeMaskPreparedFreezeV2 = {
        binding: publicBinding,
        inspectPublication: async () => {
          assertLive();
          if (capabilityBusy) {
            throw fail("OPERATION_BUSY", "prepared mask capability is already resolving");
          }
          capabilityBusy = true;
          try {
            try {
              const disposition = await inspectExactPreparedPublication(
                publicationDirectory,
                preparationDirectory,
                preparedRoots,
                request.operationIdSha256,
                {
                  fileName: prepared.mask.fileName,
                  digest: prepared.mask.sha256,
                  bytes: maskBytes,
                },
                {
                  fileName: prepared.reasonMap.fileName,
                  digest: prepared.reasonMap.sha256,
                  bytes: reasonBytes,
                },
              );
              if (disposition !== "mask_and_reason_map") {
                this.#activeFrozenBinding = null;
              }
              return disposition;
            } catch (error) {
              this.#activeFrozenBinding = null;
              if (error instanceof GrandHallT554NativeMaskStoreError) throw error;
              throw fail(
                "PUBLICATION_INVALID",
                "prepared mask publication inspection failed closed",
                error,
              );
            }
          } finally {
            capabilityBusy = false;
          }
        },
        publishOrVerifyExact: async () => {
          assertLive();
          if (capabilityBusy) {
            throw fail("OPERATION_BUSY", "prepared mask capability is already resolving");
          }
          capabilityBusy = true;
          consumed = true;
          try {
            try {
              const initialDisposition = await inspectExactPreparedPublication(
                publicationDirectory,
                preparationDirectory,
                preparedRoots,
                request.operationIdSha256,
                {
                  fileName: prepared.mask.fileName,
                  digest: prepared.mask.sha256,
                  bytes: maskBytes,
                },
                {
                  fileName: prepared.reasonMap.fileName,
                  digest: prepared.reasonMap.sha256,
                  bytes: reasonBytes,
                },
              );
              if (
                initialDisposition === "mask_only" ||
                initialDisposition === "reason_map_only"
              ) {
                this.#activeFrozenBinding = null;
                throw fail(
                  "PUBLICATION_PARTIAL",
                  "a partial exact crash publication cannot become frozen evidence",
                );
              }
              const frozen = await publishPreparedPair(
                publicationDirectory,
                preparationDirectory,
                preparedRoots,
                request.operationIdSha256,
                initialDisposition,
                prepared,
                maskBytes,
                reasonBytes,
                facts,
                TEST_SEAMS.get(this) ?? {},
              );
              return cloneFrozenBinding(frozen);
            } catch (error) {
              this.#activeFrozenBinding = null;
              if (error instanceof GrandHallT554NativeMaskStoreError) throw error;
              throw fail(
                "PUBLICATION_INVALID",
                "prepared mask publication failed closed",
                error,
              );
            }
          } finally {
            release();
          }
        },
        discard: () => {
          assertLive();
          if (capabilityBusy) {
            throw fail("OPERATION_BUSY", "prepared mask capability is already resolving");
          }
          consumed = true;
          release();
        },
      };
      handedOff = true;
      return Object.freeze(capability);
    } finally {
      rawMask?.fill(0);
      rawReasonMap?.fill(0);
      if (!handedOff) {
        encodedMask?.fill(0);
        encodedReasonMap?.fill(0);
        this.#activePreparationToken = null;
        this.#operationBusy = false;
      }
    }
  }

  async freeze(input: unknown): Promise<GrandHallT554NativeMaskFrozenBindingV2> {
    this.#assertUsable();
    if (this.#replayOnly || this.#publicationDirectory === null) {
      throw fail(
        "PUBLICATION_DISABLED",
        "replay-only native mask stores cannot freeze or publish evidence",
      );
    }
    const publicationDirectory = this.#publicationDirectory;
    const expectedRevision = parseExpectedRevision(input);
    this.#assertExpectedRevision(expectedRevision);
    if (this.#preparationDirectory !== null) {
      const revision = this.#currentRevision();
      const operationIdSha256 = domainDigest(
        "VENVIEWER_GRAND_HALL_T554_NATIVE_MASK_LEGACY_FREEZE_OPERATION_V2",
        {
          source: this.source,
          revision: revision.revision,
          pixelTileInventorySha256: computePixelTileInventorySha256(revision),
        },
      );
      const prepared = await this.prepareFreeze({
        expectedRevision,
        operationIdSha256,
      });
      try {
        const disposition = await prepared.inspectPublication();
        if (disposition === "mask_only" || disposition === "reason_map_only") {
          this.#activeFrozenBinding = null;
          prepared.discard();
          throw fail(
            "PUBLICATION_PARTIAL",
            "legacy freeze refuses to complete a partial exact crash publication without a durable recovery decision",
          );
        }
        const frozen = await prepared.publishOrVerifyExact();
        this.#activeFrozenBinding = frozen;
        return cloneFrozenBinding(frozen);
      } catch (error) {
        this.#activeFrozenBinding = null;
        try {
          prepared.discard();
        } catch (cleanupError) {
          if (
            !(cleanupError instanceof GrandHallT554NativeMaskStoreError) ||
            cleanupError.code !== "PREPARED_FREEZE_CONSUMED"
          ) {
            throw fail(
              "INTERNAL_INVARIANT_FAILED",
              "legacy freeze preparation cleanup failed",
              { operationError: error, cleanupError },
            );
          }
        }
        throw error;
      }
    }
    if (this.#operationBusy) throw fail("OPERATION_BUSY", "a native mask mutation is in progress");
    this.#operationBusy = true;
    let rawMask: Buffer | undefined;
    let rawReasonMap: Buffer | undefined;
    let encodedMask: Buffer | undefined;
    let encodedReasonMap: Buffer | undefined;
    try {
      const seam = TEST_SEAMS.get(this) ?? {};
      if (this.#activeFrozenBinding?.revision === expectedRevision) {
        const binding = this.#activeFrozenBinding;
        try {
          const reopened = await reopenPublishedEvidence(
            publicationDirectory,
            { fileName: binding.fileName, digest: binding.sha256,
              byteLength: binding.byteLength },
            { fileName: binding.reasonMap.fileName, digest: binding.reasonMap.sha256,
              byteLength: binding.reasonMap.byteLength },
          );
          if (!sameDerivedFacts(reopened, factsFromBinding(binding))) {
            throw fail(
              "PUBLICATION_INVALID",
              "cached frozen binding differs from its reopened immutable evidence bytes",
            );
          }
          return cloneFrozenBinding(binding);
        } catch (error) {
          this.#activeFrozenBinding = null;
          throw error;
        }
      }
      const revision = this.#currentRevision();
      const facts = deriveRevisionFacts(revision);
      rawMask = flattenPlane(revision, "mask");
      rawReasonMap = flattenPlane(revision, "reasons");
      encodedMask = await encodeCanonicalMask(rawMask);
      encodedReasonMap = await encodeCanonicalReasonMap(rawReasonMap);
      const digest = sha256(encodedMask);
      const reasonMapDigest = sha256(encodedReasonMap);
      const fileName = outputFileName("mask", this.source, revision.revision, digest);
      const reasonMapFileName = outputFileName(
        "reason-map",
        this.source,
        revision.revision,
        reasonMapDigest,
      );
      const publicationDurability = await publishNoReplace(
        publicationDirectory,
        fileName,
        encodedMask,
        seam,
      );
      const reasonMapPublicationDurability = await publishNoReplace(
        publicationDirectory,
        reasonMapFileName,
        encodedReasonMap,
        seam,
      );
      if (publicationDurability !== reasonMapPublicationDurability) {
        throw fail(
          "PUBLICATION_INVALID",
          "mask and reason-map publication used different durability barriers",
        );
      }
      const verified = await reopenPublishedEvidence(
        publicationDirectory,
        { fileName, digest, byteLength: encodedMask.length },
        { fileName: reasonMapFileName, digest: reasonMapDigest,
          byteLength: encodedReasonMap.length },
      );
      if (!sameDerivedFacts(verified, facts)) {
        throw fail(
          "PUBLICATION_INVALID",
          "reopened PNG evidence differs from the immutable mask and reason revision",
        );
      }
      const reasonMap: GrandHallT554NativeMaskReasonMapBinding = Object.freeze({
        fileName: reasonMapFileName,
        sha256: reasonMapDigest,
        byteLength: encodedReasonMap.length,
        widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
        heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
        bitDepth: 8 as const,
        channelCount: 1 as const,
        permittedPixelValues: [0, 1, 2, 3, 4, 5] as const,
        zeroMeaning: "grand_hall_included" as const,
        reasonSampleCodebook: REASON_SAMPLE_CODEBOOK,
      });
      const binding: GrandHallT554NativeMaskFrozenBindingV2 = Object.freeze({
        schemaVersion: "venviewer.grand-hall-t554-native-mask-frozen-binding.v2" as const,
        source: Object.freeze(cloneSource(this.source)), revision: revision.revision,
        fileName, sha256: digest, byteLength: encodedMask.length,
        widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
        heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
        bitDepth: 8 as const, channelCount: 1 as const,
        permittedPixelValues: [0, 255] as const,
        zeroMeaning: "grand_hall_included" as const,
        twoHundredFiftyFiveMeaning: "excluded_or_unknown" as const,
        includedPixelCount: verified.includedPixelCount,
        excludedPixelCount: verified.excludedPixelCount,
        reasonCounts: reasonCountObjects(verified.reasonCounts),
        publicationDurability,
        reasonMap,
        immutableFrozen: true as const,
      });
      this.#activeFrozenBinding = binding;
      return cloneFrozenBinding(binding);
    } finally {
      rawMask?.fill(0);
      rawReasonMap?.fill(0);
      encodedMask?.fill(0);
      encodedReasonMap?.fill(0);
      this.#operationBusy = false;
    }
  }

  abandon(): void {
    this.#assertUsable();
    if (this.#operationBusy) throw fail("OPERATION_BUSY", "cannot abandon while a native mask freeze is active");
    const buffers = new Set<Buffer>();
    this.#revisions.forEach((revision) => {
      revision.tiles.forEach((tile) => {
        buffers.add(tile.mask);
        buffers.add(tile.reasons);
      });
    });
    const seam = TEST_SEAMS.get(this);
    const cleanupFailures: unknown[] = [];

    // Abandonment becomes terminal before untrusted test hooks run. Cleanup is
    // best-effort across every owned buffer even if one hook throws.
    this.#abandoned = true;
    try {
      buffers.forEach((buffer) => {
        try {
          buffer.fill(0);
          seam?.afterBufferZeroed?.({ byteLength: buffer.length, allZero: true });
        } catch (error) {
          cleanupFailures.push(error);
        }
      });
    } finally {
      this.#revisions.clear();
      this.#ownedBufferBytes = 0;
      this.#changedTileSealCount = 0;
      this.#activeFrozenBinding = null;
      TEST_SEAMS.delete(this);
    }
    if (cleanupFailures.length !== 0) {
      throw fail(
        "INTERNAL_INVARIANT_FAILED",
        `native mask abandonment cleanup failed ${String(cleanupFailures.length)} time(s)`,
        cleanupFailures[0],
      );
    }
  }
}

export const __testOnlyGrandHallT554NativeMaskRevisionStore = /* @__PURE__ */ Object.freeze({
  observeBufferZeroing(
    store: GrandHallT554NativeMaskRevisionStore,
    afterBufferZeroed: (facts: {
      readonly byteLength: number;
      readonly allZero: true;
    }) => void,
  ): void {
    TEST_SEAMS.set(store, { ...TEST_SEAMS.get(store), afterBufferZeroed });
  },
  setMaximumChangedTileSeals(
    store: GrandHallT554NativeMaskRevisionStore,
    maximumChangedTileSeals: number,
  ): void {
    if (!Number.isInteger(maximumChangedTileSeals) || maximumChangedTileSeals < 0) {
      throw fail(
        "ARGUMENT_INVALID",
        "test maximum changed-tile seals must be a non-negative integer",
      );
    }
    TEST_SEAMS.set(store, {
      ...TEST_SEAMS.get(store),
      maximumChangedTileSeals,
    });
  },
  observePublicationDirectorySync(
    store: GrandHallT554NativeMaskRevisionStore,
    callbacks: Pick<
      GrandHallT554NativeMaskStoreTestSeam,
      "beforePublicationDirectorySync" | "afterPublicationDurabilityBarrier"
    >,
  ): void {
    TEST_SEAMS.set(store, { ...TEST_SEAMS.get(store), ...callbacks });
  },
  observePreparedPublication(
    store: GrandHallT554NativeMaskRevisionStore,
    callbacks: Pick<
      GrandHallT554NativeMaskStoreTestSeam,
      | "afterPreparedFinalLinked"
      | "afterPreparedPairVerified"
      | "beforePreparedPublicationRootsValidated"
    >,
  ): void {
    TEST_SEAMS.set(store, { ...TEST_SEAMS.get(store), ...callbacks });
  },
});

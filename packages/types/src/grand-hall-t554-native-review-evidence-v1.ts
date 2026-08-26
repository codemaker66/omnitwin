import { z } from "zod";

import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "./grand-hall-room-scope-artifacts.js";
import {
  GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
  GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS,
  GrandHallPanoramaSourceInventoryV3Schema,
  GrandHallPanoramaSourceJpgIdentityV2Schema,
  computeGrandHallPanoramaSourceInventoryV3Sha256,
} from "./grand-hall-room-scope-artifacts-v2.js";
import { GRAND_HALL_T554_HUMAN_DECISIONS_V3 } from "./grand-hall-room-scope-artifacts-v3.js";
import { RuntimeSha256Schema } from "./runtime-venue-manifest.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_EVIDENCE_V1 =
  "venviewer.grand-hall-t554-native-review-evidence.v1";
export const GRAND_HALL_T554_NATIVE_REVIEW_EVIDENCE_DIGEST_V1 =
  "venviewer.grand-hall-t554-native-review-evidence-digest.v1";
export const GRAND_HALL_T554_PENDING_WORKBENCH_EXPORT_RECEIPT_V1 =
  "venviewer.grand-hall-t554-pending-workbench-export-receipt.v1";
export const GRAND_HALL_T554_PENDING_WORKBENCH_EXPORT_RECEIPT_DIGEST_V1 =
  "venviewer.grand-hall-t554-pending-workbench-export-receipt-digest.v1";
export const GRAND_HALL_T554_WORKBENCH_CREATED_BY =
  "venviewer-grand-hall-t554-local-review-workbench-v1";
export const GRAND_HALL_T554_NATIVE_EVIDENCE_PATH_PREFIX = "receipts/native";
export const GRAND_HALL_T554_NATIVE_EVIDENCE_INVENTORY_INDEX_WIDTH = 3;
export const GRAND_HALL_T554_JSON_EVIDENCE_MAX_BYTE_LENGTH = 16 * 1_024 * 1_024;
export const GRAND_HALL_T554_FROZEN_MASK_MAX_BYTE_LENGTH = 64 * 1_024 * 1_024;
export const GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTE_LENGTH = 256 * 1_024 * 1_024;

export const GRAND_HALL_T554_NATIVE_COVERAGE_CELL_WIDTH_PX = 256;
export const GRAND_HALL_T554_NATIVE_COVERAGE_CELL_HEIGHT_PX = 256;
export const GRAND_HALL_T554_NATIVE_COVERAGE_COLUMN_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX / GRAND_HALL_T554_NATIVE_COVERAGE_CELL_WIDTH_PX;
export const GRAND_HALL_T554_NATIVE_COVERAGE_ROW_COUNT =
  GRAND_HALL_PANORAMA_HEIGHT_PX / GRAND_HALL_T554_NATIVE_COVERAGE_CELL_HEIGHT_PX;
export const GRAND_HALL_T554_NATIVE_COVERAGE_CELL_COUNT =
  GRAND_HALL_T554_NATIVE_COVERAGE_COLUMN_COUNT *
  GRAND_HALL_T554_NATIVE_COVERAGE_ROW_COUNT;
export const GRAND_HALL_T554_NATIVE_COVERAGE_BITMAP_BYTE_LENGTH =
  GRAND_HALL_T554_NATIVE_COVERAGE_CELL_COUNT / 8;

const PANORAMA_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const COMPLETE_COVERAGE_BITMAP_HEX = "ff".repeat(
  GRAND_HALL_T554_NATIVE_COVERAGE_BITMAP_BYTE_LENGTH,
);
const COVERAGE_BITMAP_PATTERN = new RegExp(
  `^[a-f0-9]{${String(GRAND_HALL_T554_NATIVE_COVERAGE_BITMAP_BYTE_LENGTH * 2)}}$`,
  "u",
);
const PositiveByteLengthSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const JsonEvidenceByteLengthSchema = PositiveByteLengthSchema.max(
  GRAND_HALL_T554_JSON_EVIDENCE_MAX_BYTE_LENGTH,
);
const FrozenMaskByteLengthSchema = PositiveByteLengthSchema.max(
  GRAND_HALL_T554_FROZEN_MASK_MAX_BYTE_LENGTH,
);
const SourceJpegByteLengthSchema = PositiveByteLengthSchema.max(
  GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTE_LENGTH,
);
const SafeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const IsoInstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .datetime({ offset: false, precision: 3 })
  .refine(
    (value) => {
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
    },
    "instant must be the canonical UTC millisecond form YYYY-MM-DDTHH:mm:ss.sssZ",
  );

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

function canonicalDigest(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let offset = 0; offset < value.length; offset += 2) {
    bytes[offset / 2] = Number.parseInt(value.slice(offset, offset + 2), 16);
  }
  return bytes;
}

function bitmapDigest(value: string): string {
  return `sha256:${sha256Hex(hexBytes(value))}`;
}

function bitmapPopcount(value: string): number {
  let count = 0;
  for (const byte of hexBytes(value)) {
    let remaining = byte;
    while (remaining !== 0) {
      count += remaining & 1;
      remaining >>>= 1;
    }
  }
  return count;
}

function bitmapUnion(values: readonly string[]): string {
  const union = new Uint8Array(GRAND_HALL_T554_NATIVE_COVERAGE_BITMAP_BYTE_LENGTH);
  for (const value of values) {
    const bytes = hexBytes(value);
    bytes.forEach((byte, index) => {
      union[index] = (union[index] ?? 0) | byte;
    });
  }
  return Array.from(union, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function computeGrandHallT554CoverageBitmapSha256(bitmapHex: string): string {
  if (!COVERAGE_BITMAP_PATTERN.test(bitmapHex)) {
    throw new Error("native-review coverage bitmap must be the exact canonical grid length");
  }
  return bitmapDigest(bitmapHex);
}

/**
 * Canonical native-evidence member path. Inventory indexes are zero-based,
 * three-digit decimal values. The digest's Windows-unsafe colon is encoded as
 * a hyphen: receipts/native/000/sha256-<64-lowercase-hex>.json.
 */
export function formatGrandHallT554NativeEvidenceFileName(
  inventoryIndex: number,
  receiptSha256: string,
): string {
  const parsedIndex = z
    .number()
    .int()
    .min(0)
    .max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT - 1)
    .parse(inventoryIndex);
  const parsedDigest = RuntimeSha256Schema.parse(receiptSha256);
  return `${GRAND_HALL_T554_NATIVE_EVIDENCE_PATH_PREFIX}/${String(parsedIndex).padStart(
    GRAND_HALL_T554_NATIVE_EVIDENCE_INVENTORY_INDEX_WIDTH,
    "0",
  )}/${parsedDigest.replace("sha256:", "sha256-")}.json`;
}

function hasSafePathUnicode(value: string): boolean {
  for (const character of Array.from(value)) {
    const code = character.charCodeAt(0);
    const codePoint = character.codePointAt(0) ?? code;
    const bidiControl =
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff;
    if (
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f) ||
      bidiControl ||
      (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
    ) return false;
  }
  return true;
}

function isSafeRelativeFile(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    /[<>:"|?*]/u.test(value) ||
    !hasSafePathUnicode(value)
  ) return false;
  return value.split("/").every((segment) => {
    const windowsStem = segment.split(".", 1)[0]?.toUpperCase() ?? "";
    return segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !/^(?:CON|PRN|AUX|NUL|COM(?:[1-9]|[¹²³])|LPT(?:[1-9]|[¹²³]))$/u.test(
        windowsStem,
      );
  });
}

const SafeRelativeFileSchema = z.string().superRefine((value, ctx) => {
  if (!isSafeRelativeFile(value)) {
    addIssue(ctx, [], "file must be a canonical traversal-free POSIX relative path");
  }
});

const CoverageBitmapSchema = z
  .object({
    bitOrder: z.literal("least_significant_bit_first_within_each_byte"),
    cellOrder: z.literal("row_major_top_to_bottom_left_to_right"),
    byteLength: z.literal(GRAND_HALL_T554_NATIVE_COVERAGE_BITMAP_BYTE_LENGTH),
    coveredCellBitsetHex: z.string().regex(COVERAGE_BITMAP_PATTERN),
    coveredCellBitsetSha256: RuntimeSha256Schema,
    coveredCellCount: z.number().int().min(1).max(GRAND_HALL_T554_NATIVE_COVERAGE_CELL_COUNT),
  })
  .strict()
  .superRefine((bitmap, ctx) => {
    if (bitmap.coveredCellBitsetSha256 !== bitmapDigest(bitmap.coveredCellBitsetHex)) {
      addIssue(ctx, ["coveredCellBitsetSha256"], "coverage bitmap digest does not match its exact bytes");
    }
    if (bitmap.coveredCellCount !== bitmapPopcount(bitmap.coveredCellBitsetHex)) {
      addIssue(ctx, ["coveredCellCount"], "coverage cell count does not match its exact bitmap");
    }
  });

const NativeCoverageIntervalSchema = z
  .object({
    startedAt: IsoInstantSchema,
    endedAt: IsoInstantSchema,
    minimumEffectiveDevicePixelsPerSourcePixel: z.number().finite().min(1).max(16),
    tabVisibleThroughout: z.literal(true),
    viewerFocusedThroughout: z.literal(true),
    naturalDimensionsVerified: z.literal(true),
    serverClampedHeartbeatDurationMs: z.number().int().positive().max(3_600_000),
    coverage: CoverageBitmapSchema,
  })
  .strict()
  .superRefine((interval, ctx) => {
    const startedAt = Date.parse(interval.startedAt);
    const endedAt = Date.parse(interval.endedAt);
    if (startedAt >= endedAt) {
      addIssue(ctx, ["endedAt"], "native-review interval must end after it starts");
    }
    if (interval.serverClampedHeartbeatDurationMs > endedAt - startedAt) {
      addIssue(ctx, ["serverClampedHeartbeatDurationMs"], "heartbeat duration cannot exceed its wall-clock review interval");
    }
  });

const CompletedNativeCoverageObjectSchema = z
  .object({
    schemaVersion: z.literal("venviewer.grand-hall-t554-native-grid-coverage.v1"),
    subjectKind: z.enum(["source_jpeg", "frozen_binary_mask"]),
    subjectSha256: RuntimeSha256Schema,
    sourceGridWidthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    sourceGridHeightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
    cellWidthPx: z.literal(GRAND_HALL_T554_NATIVE_COVERAGE_CELL_WIDTH_PX),
    cellHeightPx: z.literal(GRAND_HALL_T554_NATIVE_COVERAGE_CELL_HEIGHT_PX),
    columnCount: z.literal(GRAND_HALL_T554_NATIVE_COVERAGE_COLUMN_COUNT),
    rowCount: z.literal(GRAND_HALL_T554_NATIVE_COVERAGE_ROW_COUNT),
    cellCount: z.literal(GRAND_HALL_T554_NATIVE_COVERAGE_CELL_COUNT),
    complete: z.literal(true),
    coverage: CoverageBitmapSchema,
    reviewIntervals: z.array(NativeCoverageIntervalSchema).min(1).max(2_048),
  })
  .strict();

type CompletedNativeCoverageObject = z.infer<
  typeof CompletedNativeCoverageObjectSchema
>;

function refineCompletedNativeCoverage(
  coverage: CompletedNativeCoverageObject,
  ctx: z.RefinementCtx,
): void {
  if (
    coverage.coverage.coveredCellCount !== GRAND_HALL_T554_NATIVE_COVERAGE_CELL_COUNT ||
    coverage.coverage.coveredCellBitsetHex !== COMPLETE_COVERAGE_BITMAP_HEX
  ) {
    addIssue(ctx, ["coverage"], "sealed native review requires complete coverage of every source-grid cell");
  }
  const intervalUnion = bitmapUnion(
    coverage.reviewIntervals.map((interval) => interval.coverage.coveredCellBitsetHex),
  );
  if (intervalUnion !== coverage.coverage.coveredCellBitsetHex) {
    addIssue(ctx, ["reviewIntervals"], "native-review intervals do not realize the declared complete bitmap");
  }
  coverage.reviewIntervals.forEach((interval, index) => {
    const previous = coverage.reviewIntervals[index - 1];
    if (previous !== undefined && Date.parse(previous.endedAt) > Date.parse(interval.startedAt)) {
      addIssue(ctx, ["reviewIntervals", index, "startedAt"], "native-review intervals must be chronological and non-overlapping");
    }
  });
}

export const GrandHallT554CompletedNativeCoverageV1Schema =
  CompletedNativeCoverageObjectSchema.superRefine(refineCompletedNativeCoverage);

export type GrandHallT554CompletedNativeCoverageV1 = z.infer<
  typeof GrandHallT554CompletedNativeCoverageV1Schema
>;

const SourceVerificationSchema = z
  .object({
    sha256: RuntimeSha256Schema,
    byteLength: SourceJpegByteLengthSchema,
    widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
    sameOpenDescriptorHashedAndDecoded: z.literal(true),
    fullJpegDecodeCompleted: z.literal(true),
    decodedChannelCount: z.literal(3),
    decodedBitsPerSample: z.literal(8),
    alphaPresent: z.literal(false),
    orientationMetadataPresent: z.literal(false),
  })
  .strict();

const PanoramaMaskReasonSchema = z.enum([
  "adjacent_room_pixels",
  "portal_beyond_grand_hall_plane",
  "facade_or_exterior_pixels",
  "capture_artifact_outside_verified_room",
  "unverified_or_unknown_pixels",
]);

const FrozenStrictMaskBindingSchema = z
  .object({
    fileName: SafeRelativeFileSchema.refine((value) => /\.png$/u.test(value), "mask file must name a lowercase .png file"),
    sha256: RuntimeSha256Schema,
    byteLength: FrozenMaskByteLengthSchema,
    widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
    bitDepth: z.literal(8),
    channelCount: z.literal(1),
    colourType: z.literal("grayscale"),
    alphaPresent: z.literal(false),
    ancillaryMetadataPresent: z.literal(false),
    permittedPixelValues: z.tuple([z.literal(0), z.literal(255)]),
    zeroMeaning: z.literal("grand_hall_included"),
    twoHundredFiftyFiveMeaning: z.literal("excluded_or_unknown"),
    includedPixelCount: z.number().int().positive().max(PANORAMA_PIXEL_COUNT),
    excludedPixelCount: SafeCountSchema.max(PANORAMA_PIXEL_COUNT),
    reasonCodes: z.array(PanoramaMaskReasonSchema).max(5),
    exactBinarySourceGridDecoded: z.literal(true),
    immutableFrozen: z.literal(true),
  })
  .strict()
  .superRefine((mask, ctx) => {
    if (mask.includedPixelCount + mask.excludedPixelCount !== PANORAMA_PIXEL_COUNT) {
      addIssue(ctx, ["excludedPixelCount"], "frozen mask counts must cover the exact source grid");
    }
    if (new Set(mask.reasonCodes).size !== mask.reasonCodes.length) {
      addIssue(ctx, ["reasonCodes"], "frozen mask reason codes must be unique");
    }
    if (
      (mask.excludedPixelCount === 0 && mask.reasonCodes.length !== 0) ||
      (mask.excludedPixelCount > 0 && mask.reasonCodes.length === 0)
    ) {
      addIssue(ctx, ["reasonCodes"], "mask reasons must be empty exactly when no pixels are excluded");
    }
  });

export type GrandHallT554FrozenStrictMaskBindingV1 = z.infer<
  typeof FrozenStrictMaskBindingSchema
>;

const IncludeDecisionSchema = z
  .object({
    result: z.literal("INCLUDE"),
    classification: z.enum(["grand_hall_core", "grand_hall_portal_threshold"]),
    note: z.string().trim().min(1).max(1_000),
    mask: FrozenStrictMaskBindingSchema,
    maskReviewCoverage: GrandHallT554CompletedNativeCoverageV1Schema,
  })
  .strict();

const ExcludeDecisionSchema = z
  .object({
    result: z.literal("EXCLUDE"),
    classification: z.literal("no_observed_grand_hall_pixels"),
    note: z.string().trim().min(1).max(1_000),
    mask: z.null(),
    maskReviewCoverage: z.null(),
  })
  .strict();

const SealedPanoramaDecisionSchema = z.discriminatedUnion("result", [
  IncludeDecisionSchema,
  ExcludeDecisionSchema,
]);

const HumanAttestationSchema = z
  .object({
    reviewerId: z.string().trim().min(1).max(160),
    reviewerRole: z.literal("venue_owner_or_authorized_domain_reviewer"),
    knowledgeBasis: z.array(z.string().trim().min(1).max(240)).min(1).max(32),
    attestedAt: IsoInstantSchema,
    statement: z.literal(
      "I reviewed the exact bound source at native scale and recorded only what I could support from supplied evidence.",
    ),
    agentDecisionAuthority: z.literal("none"),
  })
  .strict();

const GrandHallT554NativeReviewEvidenceMaterialV1ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_T554_NATIVE_REVIEW_EVIDENCE_V1),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    reviewPackSha256: RuntimeSha256Schema,
    workbenchImplementationSha256: RuntimeSha256Schema,
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    sourceVerification: SourceVerificationSchema,
    sourceReviewCoverage: GrandHallT554CompletedNativeCoverageV1Schema,
    decision: SealedPanoramaDecisionSchema,
    humanAttestation: HumanAttestationSchema,
    sealedAt: IsoInstantSchema,
    storageSemantics: z.literal("content_addressed_no_replace"),
    evidenceScope: z.literal("procedural_native_grid_review_only"),
    humanPresenceProof: z.literal("not_cryptographic"),
    authority: z.literal("none"),
    acceptanceAuthorized: z.literal(false),
    reconstructionAuthorized: z.literal(false),
    runtimeAuthorized: z.literal(false),
    generatedContentAuthorized: z.literal(false),
  })
  .strict();

type GrandHallT554NativeReviewEvidenceMaterialV1Object = z.infer<
  typeof GrandHallT554NativeReviewEvidenceMaterialV1ObjectSchema
>;

function refineNativeReviewEvidenceMaterial(
  receipt: GrandHallT554NativeReviewEvidenceMaterialV1Object,
  ctx: z.RefinementCtx,
): void {
  const source = receipt.source;
  const verification = receipt.sourceVerification;
  if (
    source.sweepNumber !==
      GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS[source.inventoryIndex]
  ) {
    addIssue(ctx, ["source"], "native-review source must occupy its exact 148-file inventory position");
  }
  if (
    verification.sha256 !== source.sha256 ||
    verification.byteLength !== source.byteLength
  ) {
    addIssue(ctx, ["sourceVerification"], "source verification must bind the exact panorama identity");
  }
  if (
    receipt.sourceReviewCoverage.subjectKind !== "source_jpeg" ||
    receipt.sourceReviewCoverage.subjectSha256 !== source.sha256
  ) {
    addIssue(ctx, ["sourceReviewCoverage"], "native source coverage must bind the exact source JPEG digest");
  }
  if (receipt.decision.result === "INCLUDE") {
    if (
      receipt.decision.maskReviewCoverage.subjectKind !== "frozen_binary_mask" ||
      receipt.decision.maskReviewCoverage.subjectSha256 !== receipt.decision.mask.sha256
    ) {
      addIssue(ctx, ["decision", "maskReviewCoverage"], "mask review coverage must bind the exact frozen mask digest");
    }
  }
  const lastSourceInterval = receipt.sourceReviewCoverage.reviewIntervals.at(-1);
  const lastMaskInterval = receipt.decision.result === "INCLUDE"
    ? receipt.decision.maskReviewCoverage.reviewIntervals.at(-1)
    : undefined;
  const attestedAt = Date.parse(receipt.humanAttestation.attestedAt);
  const latestReviewEnd = Math.max(
    Date.parse(lastSourceInterval?.endedAt ?? receipt.humanAttestation.attestedAt),
    Date.parse(lastMaskInterval?.endedAt ?? receipt.humanAttestation.attestedAt),
  );
  if (attestedAt < latestReviewEnd) {
    addIssue(ctx, ["humanAttestation", "attestedAt"], "human attestation cannot predate the final native-review interval");
  }
  if (Date.parse(receipt.sealedAt) < attestedAt) {
    addIssue(ctx, ["sealedAt"], "receipt cannot be sealed before its human attestation");
  }
}

export const GrandHallT554NativeReviewEvidenceMaterialV1Schema =
  GrandHallT554NativeReviewEvidenceMaterialV1ObjectSchema.superRefine(
    refineNativeReviewEvidenceMaterial,
  );

export type GrandHallT554NativeReviewEvidenceMaterialV1 = z.infer<
  typeof GrandHallT554NativeReviewEvidenceMaterialV1Schema
>;

export function computeGrandHallT554NativeReviewEvidenceV1Sha256(
  material: GrandHallT554NativeReviewEvidenceMaterialV1,
): string {
  const parsed = GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(material);
  return canonicalDigest(GRAND_HALL_T554_NATIVE_REVIEW_EVIDENCE_DIGEST_V1, parsed);
}

const GrandHallT554NativeReviewEvidenceV1ObjectSchema =
  GrandHallT554NativeReviewEvidenceMaterialV1ObjectSchema.extend({
    receiptSha256: RuntimeSha256Schema,
  }).strict();

export const GrandHallT554NativeReviewEvidenceV1Schema =
  GrandHallT554NativeReviewEvidenceV1ObjectSchema.superRefine((receipt, ctx) => {
    const { receiptSha256, ...material } = receipt;
    refineNativeReviewEvidenceMaterial(material, ctx);
    if (
      receiptSha256 !==
        canonicalDigest(GRAND_HALL_T554_NATIVE_REVIEW_EVIDENCE_DIGEST_V1, material)
    ) {
      addIssue(ctx, ["receiptSha256"], "native-review receipt digest must bind every exact review field");
    }
  });

export type GrandHallT554NativeReviewEvidenceV1 = z.infer<
  typeof GrandHallT554NativeReviewEvidenceV1Schema
>;

export function sealGrandHallT554NativeReviewEvidenceV1(
  material: GrandHallT554NativeReviewEvidenceMaterialV1,
): GrandHallT554NativeReviewEvidenceV1 {
  const parsed = GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(material);
  return GrandHallT554NativeReviewEvidenceV1Schema.parse({
    ...parsed,
    receiptSha256: canonicalDigest(
      GRAND_HALL_T554_NATIVE_REVIEW_EVIDENCE_DIGEST_V1,
      parsed,
    ),
  });
}

const NativeEvidenceMemberSchema = z
  .object({
    fileName: SafeRelativeFileSchema.refine((value) => /\.json$/u.test(value), "native evidence member must name a lowercase .json file"),
    receiptSha256: RuntimeSha256Schema,
    fileSha256: RuntimeSha256Schema,
    byteLength: JsonEvidenceByteLengthSchema,
  })
  .strict();

const PendingExportSourceRecordBaseSchema = z.object({
  source: GrandHallPanoramaSourceJpgIdentityV2Schema,
});

const PendingExportSourceRecordSchema = z.discriminatedUnion("result", [
  PendingExportSourceRecordBaseSchema.extend({
    result: z.literal("UNSURE"),
    nativeResolutionHumanReviewCompleted: z.literal(false),
    nativeReviewEvidence: z.null(),
    maskReviewed: z.literal(false),
    mask: z.null(),
  }).strict(),
  PendingExportSourceRecordBaseSchema.extend({
    result: z.literal("INCLUDE"),
    nativeResolutionHumanReviewCompleted: z.literal(true),
    nativeReviewEvidence: NativeEvidenceMemberSchema,
    maskReviewed: z.literal(true),
    mask: FrozenStrictMaskBindingSchema,
  }).strict(),
  PendingExportSourceRecordBaseSchema.extend({
    result: z.literal("EXCLUDE"),
    nativeResolutionHumanReviewCompleted: z.literal(true),
    nativeReviewEvidence: NativeEvidenceMemberSchema,
    maskReviewed: z.literal(false),
    mask: z.null(),
  }).strict(),
]);

const PendingHumanDecisionsMemberSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_T554_HUMAN_DECISIONS_V3),
    fileName: z.literal("human-decisions-v3-human-pending.json"),
    semanticSha256: RuntimeSha256Schema,
    fileSha256: RuntimeSha256Schema,
    byteLength: JsonEvidenceByteLengthSchema,
    authority: z.literal("none"),
    reviewState: z.literal("human_pending"),
    finalDecision: z.literal("PENDING"),
    reviewer: z.null(),
    nativeResolutionHumanReviewCompleted: z.literal(false),
    nativeReviewEvidenceSetSha256: z.null(),
  })
  .strict();

const GrandHallT554PendingWorkbenchExportReceiptMaterialV1ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_T554_PENDING_WORKBENCH_EXPORT_RECEIPT_V1),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    createdAt: IsoInstantSchema,
    createdBy: z.literal(GRAND_HALL_T554_WORKBENCH_CREATED_BY),
    reviewPackSha256: RuntimeSha256Schema,
    workbenchImplementationSha256: RuntimeSha256Schema,
    workspaceStateSha256: RuntimeSha256Schema,
    panoramaSourceInventorySha256: RuntimeSha256Schema,
    panoramaRecordCount: z.literal(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    resolvedPanoramaCount: SafeCountSchema.max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    unresolvedPanoramaCount: SafeCountSchema.max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    includedPanoramaCount: SafeCountSchema.max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    excludedPanoramaCount: SafeCountSchema.max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    nativeReviewEvidenceCount: SafeCountSchema.max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    maskCount: SafeCountSchema.max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    sourceRecords: z
      .array(PendingExportSourceRecordSchema)
      .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    humanDecisions: PendingHumanDecisionsMemberSchema,
    state: z.literal("human_pending_workbench_export_requires_byte_level_sealer"),
    publicationOrder: z.literal("payloads_then_receipt_last"),
    storageSemantics: z.literal("no_replace"),
    humanPresenceProof: z.literal("not_cryptographic"),
    authority: z.literal("none"),
    reviewState: z.literal("human_pending"),
    finalDecision: z.literal("PENDING"),
    reviewer: z.null(),
    nativeResolutionHumanReviewCompleted: z.literal(false),
    nativeReviewEvidenceSetSha256: z.null(),
    byteLevelSealerCompleted: z.literal(false),
    acceptanceAuthorized: z.literal(false),
    reconstructionAuthorized: z.literal(false),
    runtimeAuthorized: z.literal(false),
    generatedContentAuthorized: z.literal(false),
    externalNetworkUsed: z.literal(false),
    productionTrust: z.null(),
  })
  .strict();

type GrandHallT554PendingWorkbenchExportReceiptMaterialV1Object = z.infer<
  typeof GrandHallT554PendingWorkbenchExportReceiptMaterialV1ObjectSchema
>;

function refinePendingWorkbenchExportReceiptMaterial(
  receipt: GrandHallT554PendingWorkbenchExportReceiptMaterialV1Object,
  ctx: z.RefinementCtx,
): void {
  const sources = receipt.sourceRecords.map((record) => record.source);
  const sourceInventory = GrandHallPanoramaSourceInventoryV3Schema.safeParse(sources);
  if (!sourceInventory.success) {
    sourceInventory.error.issues.forEach((issue) => {
      ctx.addIssue({ ...issue, path: ["sourceRecords", ...issue.path] });
    });
  } else if (
    receipt.panoramaSourceInventorySha256 !==
      computeGrandHallPanoramaSourceInventoryV3Sha256(sourceInventory.data)
  ) {
    addIssue(ctx, ["panoramaSourceInventorySha256"], "pending export must bind the exact ordered 148-source inventory");
  }

  const included = receipt.sourceRecords.filter((record) => record.result === "INCLUDE");
  const excluded = receipt.sourceRecords.filter((record) => record.result === "EXCLUDE");
  const unresolved = receipt.sourceRecords.filter((record) => record.result === "UNSURE");
  const resolvedCount = included.length + excluded.length;
  const expectedCounts = [
    ["resolvedPanoramaCount", receipt.resolvedPanoramaCount, resolvedCount],
    ["unresolvedPanoramaCount", receipt.unresolvedPanoramaCount, unresolved.length],
    ["includedPanoramaCount", receipt.includedPanoramaCount, included.length],
    ["excludedPanoramaCount", receipt.excludedPanoramaCount, excluded.length],
    ["nativeReviewEvidenceCount", receipt.nativeReviewEvidenceCount, resolvedCount],
    ["maskCount", receipt.maskCount, included.length],
  ] as const;
  expectedCounts.forEach(([field, actual, expected]) => {
    if (actual !== expected) addIssue(ctx, [field], `${field} does not match the exact source records`);
  });

  const nativeEvidence = receipt.sourceRecords.flatMap((record) =>
    record.nativeReviewEvidence === null ? [] : [record.nativeReviewEvidence]
  );
  receipt.sourceRecords.forEach((record, index) => {
    const member = record.nativeReviewEvidence;
    if (
      member !== null &&
      member.fileName !== formatGrandHallT554NativeEvidenceFileName(
        record.source.inventoryIndex,
        member.receiptSha256,
      )
    ) {
      addIssue(
        ctx,
        ["sourceRecords", index, "nativeReviewEvidence", "fileName"],
        "native-review evidence path must be derived from the exact source inventory index and receipt digest",
      );
    }
  });
  const receiptDigests = nativeEvidence.map((member) => member.receiptSha256);
  if (new Set(receiptDigests).size !== receiptDigests.length) {
    addIssue(ctx, ["sourceRecords"], "active native-review receipt digests must be unique per panorama");
  }
  const evidenceFileDigests = nativeEvidence.map((member) => member.fileSha256);
  if (new Set(evidenceFileDigests).size !== evidenceFileDigests.length) {
    addIssue(ctx, ["sourceRecords"], "native-review evidence file digests must be unique per panorama");
  }
  const evidenceFileNames = nativeEvidence.map((member) => member.fileName.toUpperCase());
  if (new Set(evidenceFileNames).size !== evidenceFileNames.length) {
    addIssue(ctx, ["sourceRecords"], "native-review evidence filenames must be unique under Windows comparison");
  }
  const masks = included.map((record) => record.mask);
  const maskNames = masks.map((mask) => mask.fileName.toUpperCase());
  if (new Set(maskNames).size !== maskNames.length) {
    addIssue(ctx, ["sourceRecords"], "frozen mask filenames must be unique under Windows comparison");
  }

}

export const GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema =
  GrandHallT554PendingWorkbenchExportReceiptMaterialV1ObjectSchema.superRefine(
    refinePendingWorkbenchExportReceiptMaterial,
  );

export type GrandHallT554PendingWorkbenchExportReceiptMaterialV1 = z.infer<
  typeof GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema
>;

export function computeGrandHallT554PendingWorkbenchExportReceiptV1Sha256(
  material: GrandHallT554PendingWorkbenchExportReceiptMaterialV1,
): string {
  const parsed = GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(material);
  return canonicalDigest(
    GRAND_HALL_T554_PENDING_WORKBENCH_EXPORT_RECEIPT_DIGEST_V1,
    parsed,
  );
}

const GrandHallT554PendingWorkbenchExportReceiptV1ObjectSchema =
  GrandHallT554PendingWorkbenchExportReceiptMaterialV1ObjectSchema.extend({
    receiptSha256: RuntimeSha256Schema,
  }).strict();

export const GrandHallT554PendingWorkbenchExportReceiptV1Schema =
  GrandHallT554PendingWorkbenchExportReceiptV1ObjectSchema.superRefine(
    (receipt, ctx) => {
      const { receiptSha256, ...material } = receipt;
      refinePendingWorkbenchExportReceiptMaterial(material, ctx);
      if (
        receiptSha256 !== canonicalDigest(
          GRAND_HALL_T554_PENDING_WORKBENCH_EXPORT_RECEIPT_DIGEST_V1,
          material,
        )
      ) {
        addIssue(ctx, ["receiptSha256"], "pending workbench receipt digest must bind every exact export field");
      }
    },
  );

export type GrandHallT554PendingWorkbenchExportReceiptV1 = z.infer<
  typeof GrandHallT554PendingWorkbenchExportReceiptV1Schema
>;

export function sealGrandHallT554PendingWorkbenchExportReceiptV1(
  material: GrandHallT554PendingWorkbenchExportReceiptMaterialV1,
): GrandHallT554PendingWorkbenchExportReceiptV1 {
  const parsed = GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(material);
  return GrandHallT554PendingWorkbenchExportReceiptV1Schema.parse({
    ...parsed,
    receiptSha256: canonicalDigest(
      GRAND_HALL_T554_PENDING_WORKBENCH_EXPORT_RECEIPT_DIGEST_V1,
      parsed,
    ),
  });
}

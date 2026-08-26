import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  domainSeparatedSha256,
  sha256RegularFileWithHead,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import sharp from "sharp";
import { z } from "zod";

import {
  GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
  GRAND_HALL_T554_EXPECTED_SOURCE_FILE_COUNT,
  GRAND_HALL_T554_EXPECTED_WIDTH_PX,
  GRAND_HALL_T554_EXPECTED_HEIGHT_PX,
  GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
  GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
  GrandHallT554PanoramaReviewError,
  assertGrandHallT554ExistingReviewOutputSafety,
  assertGrandHallT554ReviewOutputSafety,
  collectGrandHallT554PanoramaInventory,
  parseGrandHallT554PanoramaFilename,
  readGrandHallT554StablePanoramaBytes,
  verifyPersistedGrandHallT554PanoramaReviewPack,
  type GrandHallT554PanoramaInventory,
  type GrandHallT554PanoramaInventoryFile,
} from "./grand-hall-t554-panorama-review.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-panorama-inventory-review.v1";
export const GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_V1";
export const GRAND_HALL_T554_PANORAMA_INVENTORY_PAGE_SOURCE_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_PANORAMA_INVENTORY_PAGE_SOURCE_V1";
export const GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_MANIFEST_FILENAME =
  "panorama-inventory-review-index-authority-none.json";
export const GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_PREFIX =
  "panorama-inventory-human-review-page";
export const GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_SIZE = 16;
export const GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_RECORD_COUNT = 98;
export const GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_COUNT = 7;
export const GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_OUTPUT_FILE_COUNT = 8;

const T550_CANDIDATE_SWEEP_MAX = 50;
const MISSING_SOURCE_SWEEP = 93;
const REVIEW_PAGE_WIDTH_PX = 1_600;
const REVIEW_PAGE_HEADER_HEIGHT_PX = 120;
const REVIEW_PAGE_COLUMNS = 4;
const REVIEW_PAGE_ROWS = 4;
const REVIEW_PAGE_IMAGE_HEIGHT_PX = 200;
const REVIEW_PAGE_LABEL_HEIGHT_PX = 64;
const REVIEW_PAGE_HEIGHT_PX =
  REVIEW_PAGE_HEADER_HEIGHT_PX +
  REVIEW_PAGE_ROWS * (REVIEW_PAGE_IMAGE_HEIGHT_PX + REVIEW_PAGE_LABEL_HEIGHT_PX);
const REVIEW_PAGE_KERNEL = "lanczos3";
const MAX_SOURCE_JPEG_BYTES = 16 * 1_024 * 1_024;
const MAX_REVIEW_PNG_BYTES = 32 * 1_024 * 1_024;
const MAX_REVIEW_MANIFEST_BYTES = 4 * 1_024 * 1_024;

type Sha256 = `sha256:${string}`;
type Rgb = readonly [number, number, number];

const REVIEW_BACKGROUND: Rgb = [5, 10, 13];
const REVIEW_GOLD: Rgb = [214, 169, 78];
const REVIEW_WHITE: Rgb = [236, 238, 236];
const REVIEW_MUTED: Rgb = [151, 157, 157];
const REVIEW_PENDING: Rgb = [104, 112, 120];

const REVIEW_MANIFEST_SUBJECT = Object.freeze({
  venueSlug: "trades-hall",
  roomSlug: "grand-hall",
  taskId: "T-554",
  scope: "remaining_panorama_inventory_human_review_aid_only",
} as const);

const REVIEW_SCOPE_GUARDS = Object.freeze({
  candidateEligibilityChanged: false,
  roomMembershipInferred: false,
  humanAcceptanceRecorded: false,
  masksGenerated: false,
  trainingAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  publicEvidenceAuthorized: false,
} as const);

const REVIEW_PROOF = Object.freeze({
  exactCandidateReviewPackVerified: true,
  exactFullPanoramaInventoryVerified: true,
  everyRemainingSourceIdentityBoundToOneTile: true,
  sourceWrites: "none",
  networkRequests: "none",
} as const);

const REVIEW_WARNINGS = Object.freeze([
  "These pages cover the 98 supplied panoramas outside the preserved T-550 sweep 1-50 candidate set.",
  "A page tile is a resampled human-review aid, not evidence that its source belongs to or lies outside the Grand Hall.",
  "If a human finds possible Grand Hall evidence here, the accepted review set remains incomplete until that exact source is dispositioned.",
  "This supplement grants no mask, pose, training, reconstruction, runtime, public, or architectural authority.",
] as const);

const FONT_3X5: Readonly<Record<string, string>> = Object.freeze({
  " ": "000000000000000",
  "-": "000000111000000",
  _: "000000000000111",
  "/": "001001010100100",
  ".": "000000000000010",
  ":": "000010000010000",
  "#": "101111101111101",
  "?": "110001010000010",
  "0": "111101101101111",
  "1": "010110010010111",
  "2": "110001010100111",
  "3": "110001010001110",
  "4": "101101111001001",
  "5": "111100110001110",
  "6": "111100111101111",
  "7": "111001010010010",
  "8": "111101111101111",
  "9": "111101111001110",
  A: "010101111101101",
  B: "110101110101110",
  C: "011100100100011",
  D: "110101101101110",
  E: "111100110100111",
  F: "111100110100100",
  G: "011100101101011",
  H: "101101111101101",
  I: "111010010010111",
  J: "001001001101010",
  K: "101101110101101",
  L: "100100100100111",
  M: "101111111101101",
  N: "101111111111101",
  O: "010101101101010",
  P: "110101110100100",
  Q: "010101101111011",
  R: "110101110101101",
  S: "011100010001110",
  T: "111010010010010",
  U: "101101101101111",
  V: "101101101101010",
  W: "101101111111101",
  X: "101101010101101",
  Y: "101101010010010",
  Z: "111001010100111",
});

const Sha256Schema = z.string()
  .regex(/^sha256:[0-9a-f]{64}$/u)
  .transform((value): Sha256 => value as Sha256);
const NamingAnomalySchema = z.enum([
  "four_digit_zero_padded_sweep_id",
  "filename_token_pg_instead_of_jpg",
]);

const ReviewRecordSchema = z.object({
  sourceLocator: z.string().min(1).max(300),
  relativePath: z.string().regex(/^sweep_[0-9]{3,4}(?:jpg|pg)\.jpg$/u),
  sweepNumber: z.number().int().min(51).max(149).refine((value) => value !== 93),
  digitToken: z.string().regex(/^[0-9]{3,4}$/u),
  namingAnomalies: z.array(NamingAnomalySchema).max(2),
  byteLength: z.number().int().positive().max(MAX_SOURCE_JPEG_BYTES),
  sha256: Sha256Schema,
  mediaType: z.literal("image/jpeg"),
  widthPx: z.literal(GRAND_HALL_T554_EXPECTED_WIDTH_PX),
  heightPx: z.literal(GRAND_HALL_T554_EXPECTED_HEIGHT_PX),
  jpegFrame: z.enum(["baseline_dct", "extended_sequential_dct", "progressive_dct"]),
  jfifHeaderPresent: z.boolean(),
  stableDuringRead: z.literal(true),
  reviewEligibility: z.literal("not_in_t550_ineligible_unreviewed"),
  humanReviewState: z.literal("pending"),
  possibleGrandHallEvidenceState: z.literal("human_pending"),
  roomMembershipDisposition: z.null(),
  authority: z.literal("none"),
  trainingInputPermitted: z.literal(false),
  reconstructionInputPermitted: z.literal(false),
  runtimeInputPermitted: z.literal(false),
  publicEvidencePermitted: z.literal(false),
  pageNumber: z.number().int().min(1).max(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_COUNT),
  tileIndex: z.number().int().min(0).max(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_SIZE - 1),
}).strict();

const ReviewPageSchema = z.object({
  relativePath: z.string().regex(/^panorama-inventory-human-review-page-[0-9]{2}-of-07\.png$/u),
  pageNumber: z.number().int().min(1).max(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_COUNT),
  sourceRecordCount: z.number().int().min(1).max(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_SIZE),
  sourceSweepNumbers: z.array(z.number().int().min(51).max(149)).min(1).max(16),
  sourceRecordInventorySha256: Sha256Schema,
  mediaType: z.literal("image/png"),
  widthPx: z.literal(REVIEW_PAGE_WIDTH_PX),
  heightPx: z.literal(REVIEW_PAGE_HEIGHT_PX),
  byteLength: z.number().int().positive().max(MAX_REVIEW_PNG_BYTES),
  sha256: Sha256Schema,
  authority: z.literal("none"),
  role: z.literal("inventory_human_review_only_resampled_contact_sheet"),
  reconstructionInputPermitted: z.literal(false),
}).strict();

const ManifestMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_SCHEMA),
  subject: z.object({
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    taskId: z.literal("T-554"),
    scope: z.literal("remaining_panorama_inventory_human_review_aid_only"),
  }).strict(),
  authority: z.literal("none"),
  reviewState: z.literal("human_pending"),
  sourceMutationPermitted: z.literal(false),
  networkAccess: z.literal("none"),
  preservedCandidateReview: z.object({
    manifestSha256: z.literal(GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256),
    candidateSweepRange: z.tuple([z.literal(1), z.literal(50)]),
    candidateRecordCount: z.literal(50),
    exactPersistedPackVerifiedBeforeRender: z.literal(true),
    bytesOrDigestsChangedByThisSupplement: z.literal(false),
  }).strict(),
  panoramaInventory: z.object({
    sourceLocator: z.literal(GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR),
    fileCount: z.literal(GRAND_HALL_T554_EXPECTED_SOURCE_FILE_COUNT),
    inventorySha256: z.literal(GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256),
    candidateRecordCount: z.literal(50),
    remainingRecordCount: z.literal(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_RECORD_COUNT),
    records: z.array(ReviewRecordSchema).length(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_RECORD_COUNT),
  }).strict(),
  pagination: z.object({
    pageSize: z.literal(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_SIZE),
    pageCount: z.literal(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_COUNT),
    outputFileCount: z.literal(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_OUTPUT_FILE_COUNT),
    pages: z.array(ReviewPageSchema).length(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_COUNT),
  }).strict(),
  scopeGuards: z.object({
    candidateEligibilityChanged: z.literal(false),
    roomMembershipInferred: z.literal(false),
    humanAcceptanceRecorded: z.literal(false),
    masksGenerated: z.literal(false),
    trainingAuthorized: z.literal(false),
    reconstructionAuthorized: z.literal(false),
    runtimeAuthorized: z.literal(false),
    publicEvidenceAuthorized: z.literal(false),
  }).strict(),
  toolchain: z.object({
    sharpVersion: z.string().min(1).max(40),
    libvipsVersion: z.string().min(1).max(40),
    labelRenderer: z.literal("embedded_3x5_bitmap_font_v1"),
    outputEncoding: z.literal("png_rgb8_no_metadata"),
    resamplingKernel: z.literal(REVIEW_PAGE_KERNEL),
  }).strict(),
  proof: z.object({
    exactCandidateReviewPackVerified: z.literal(true),
    exactFullPanoramaInventoryVerified: z.literal(true),
    everyRemainingSourceIdentityBoundToOneTile: z.literal(true),
    sourceWrites: z.literal("none"),
    networkRequests: z.literal("none"),
  }).strict(),
  warnings: z.tuple([
    z.literal("These pages cover the 98 supplied panoramas outside the preserved T-550 sweep 1-50 candidate set."),
    z.literal("A page tile is a resampled human-review aid, not evidence that its source belongs to or lies outside the Grand Hall."),
    z.literal("If a human finds possible Grand Hall evidence here, the accepted review set remains incomplete until that exact source is dispositioned."),
    z.literal("This supplement grants no mask, pose, training, reconstruction, runtime, public, or architectural authority."),
  ]),
}).strict();

const ManifestSchema = ManifestMaterialSchema.extend({ manifestSha256: Sha256Schema }).strict();

export type GrandHallT554PanoramaInventoryReviewRecord = z.infer<typeof ReviewRecordSchema>;
export type GrandHallT554PanoramaInventoryReviewPageEvidence = z.infer<typeof ReviewPageSchema>;
export type GrandHallT554PanoramaInventoryReviewManifest = z.infer<typeof ManifestSchema>;

export interface GrandHallT554PanoramaInventoryReviewPagePlan {
  readonly pageNumber: number;
  readonly relativePath: string;
  readonly records: readonly GrandHallT554PanoramaInventoryFile[];
  readonly sourceRecordInventorySha256: Sha256;
}

export interface GrandHallT554RenderedPanoramaInventoryReviewPage
  extends GrandHallT554PanoramaInventoryReviewPageEvidence {
  readonly bytes: Buffer;
}

export interface GenerateGrandHallT554PanoramaInventoryReviewOptions {
  readonly panoramaSourceRoot: string;
  readonly preservedCandidateReviewDirectory: string;
  readonly outputDirectory: string;
}

export interface GeneratedGrandHallT554PanoramaInventoryReview {
  readonly outputDirectory: string;
  readonly manifest: GrandHallT554PanoramaInventoryReviewManifest;
  readonly manifestFileSha256: Sha256;
  readonly manifestFileByteLength: number;
}

export interface VerifiedGrandHallT554PanoramaInventoryReview {
  readonly outputDirectory: string;
  readonly manifestSha256: Sha256;
  readonly manifestFileSha256: Sha256;
  readonly manifestFileByteLength: number;
  readonly pageCount: 7;
  readonly outputFileCount: 8;
  readonly sourceRecordCount: 98;
  readonly pngDecodeVerified: true;
  readonly authority: "none";
}

function pageFileName(pageNumber: number): string {
  return `${GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_PREFIX}-${String(pageNumber).padStart(2, "0")}-of-07.png`;
}

function pageSourceDigest(records: readonly GrandHallT554PanoramaInventoryFile[]): Sha256 {
  const identities = records.map((record) => ({
    sweepNumber: record.sweepNumber,
    relativePath: record.relativePath,
    byteLength: record.byteLength,
    sha256: record.sha256,
  }));
  return `sha256:${domainSeparatedSha256(
    GRAND_HALL_T554_PANORAMA_INVENTORY_PAGE_SOURCE_DOMAIN,
    toCanonicalJson(identities),
  )}`;
}

function assertExactFullInventory(files: readonly GrandHallT554PanoramaInventoryFile[]): void {
  if (files.length !== GRAND_HALL_T554_EXPECTED_SOURCE_FILE_COUNT) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      "All-source review pagination requires exactly 148 supplied panoramas.",
    );
  }
  const expected = Array.from({ length: 149 }, (_, index) => index + 1)
    .filter((sweep) => sweep !== MISSING_SOURCE_SWEEP);
  const actual = files.map((record) => record.sweepNumber).sort((left, right) => left - right);
  if (actual.some((sweep, index) => sweep !== expected[index])) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      "All-source review pagination requires exact sweeps 1-149 with only sweep 93 absent.",
    );
  }
}

export function buildGrandHallT554PanoramaInventoryReviewPagePlans(
  files: readonly GrandHallT554PanoramaInventoryFile[],
): readonly GrandHallT554PanoramaInventoryReviewPagePlan[] {
  assertExactFullInventory(files);
  const remaining = files
    .filter((record) => record.sweepNumber > T550_CANDIDATE_SWEEP_MAX)
    .sort((left, right) => left.sweepNumber - right.sweepNumber);
  if (remaining.length !== GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_RECORD_COUNT) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      "All-source review pagination requires exactly 98 non-candidate inventory records.",
    );
  }
  return Array.from(
    { length: GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_COUNT },
    (_, index) => {
      const records = remaining.slice(
        index * GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_SIZE,
        (index + 1) * GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_SIZE,
      );
      return {
        pageNumber: index + 1,
        relativePath: pageFileName(index + 1),
        records,
        sourceRecordInventorySha256: pageSourceDigest(records),
      };
    },
  );
}

function setRgb(canvas: Buffer, width: number, x: number, y: number, color: Rgb): void {
  const offset = (y * width + x) * 3;
  canvas[offset] = color[0];
  canvas[offset + 1] = color[1];
  canvas[offset + 2] = color[2];
}

function fillRectangle(
  canvas: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgb,
): void {
  const endX = Math.min(canvasWidth, x + width);
  const endY = Math.min(canvasHeight, y + height);
  for (let targetY = Math.max(0, y); targetY < endY; targetY += 1) {
    for (let targetX = Math.max(0, x); targetX < endX; targetX += 1) {
      setRgb(canvas, canvasWidth, targetX, targetY, color);
    }
  }
}

function drawText(
  canvas: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  text: string,
  scale: number,
  color: Rgb,
): void {
  let cursorX = x;
  for (const character of text.toUpperCase()) {
    const glyph = FONT_3X5[character] ?? FONT_3X5["?"] ?? "";
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (glyph[row * 3 + column] !== "1") continue;
        fillRectangle(canvas, width, height, cursorX + column * scale, y + row * scale, scale, scale, color);
      }
    }
    cursorX += 4 * scale;
  }
}

function drawBorder(
  canvas: Buffer,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  fillRectangle(canvas, REVIEW_PAGE_WIDTH_PX, REVIEW_PAGE_HEIGHT_PX, x, y, width, 4, REVIEW_PENDING);
  fillRectangle(canvas, REVIEW_PAGE_WIDTH_PX, REVIEW_PAGE_HEIGHT_PX, x, y + height - 4, width, 4, REVIEW_PENDING);
  fillRectangle(canvas, REVIEW_PAGE_WIDTH_PX, REVIEW_PAGE_HEIGHT_PX, x, y, 4, height, REVIEW_PENDING);
  fillRectangle(canvas, REVIEW_PAGE_WIDTH_PX, REVIEW_PAGE_HEIGHT_PX, x + width - 4, y, 4, height, REVIEW_PENDING);
}

function blitRgb(
  canvas: Buffer,
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
): void {
  const sourceStride = sourceWidth * 3;
  const canvasStride = REVIEW_PAGE_WIDTH_PX * 3;
  for (let row = 0; row < sourceHeight; row += 1) {
    source.copy(canvas, (y + row) * canvasStride + x * 3, row * sourceStride, (row + 1) * sourceStride);
  }
}

async function resizeReviewSource(
  bytes: Buffer,
  record: GrandHallT554PanoramaInventoryFile,
  width: number,
): Promise<Buffer> {
  try {
    const resized = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: GRAND_HALL_T554_EXPECTED_WIDTH_PX * GRAND_HALL_T554_EXPECTED_HEIGHT_PX,
    })
      .resize(width, REVIEW_PAGE_IMAGE_HEIGHT_PX, { fit: "fill", kernel: REVIEW_PAGE_KERNEL })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      resized.info.width !== width ||
      resized.info.height !== REVIEW_PAGE_IMAGE_HEIGHT_PX ||
      resized.info.channels !== 3
    ) {
      throw new Error("Unexpected RGB8 review raster dimensions.");
    }
    return resized.data;
  } catch (error) {
    throw new GrandHallT554PanoramaReviewError(
      "RENDER_FAILED",
      `${record.sourceLocator} could not be decoded into a review-only raster.`,
      error,
    );
  }
}

function drawPageHeader(canvas: Buffer, pageNumber: number): void {
  drawText(canvas, REVIEW_PAGE_WIDTH_PX, REVIEW_PAGE_HEIGHT_PX, 24, 18, "REVIEW ONLY - AUTHORITY NONE", 4, REVIEW_GOLD);
  drawText(canvas, REVIEW_PAGE_WIDTH_PX, REVIEW_PAGE_HEIGHT_PX, 24, 50, `ALL SOURCE INVENTORY PAGE ${String(pageNumber)} OF 7 - HUMAN PENDING`, 3, REVIEW_WHITE);
  drawText(canvas, REVIEW_PAGE_WIDTH_PX, REVIEW_PAGE_HEIGHT_PX, 24, 82, "NOT T550 CANDIDATES - ELIGIBILITY UNCHANGED - NO ROOM INFERENCE", 2, REVIEW_MUTED);
}

function drawTileLabels(
  canvas: Buffer,
  record: GrandHallT554PanoramaInventoryFile,
  x: number,
  y: number,
): void {
  drawText(canvas, REVIEW_PAGE_WIDTH_PX, REVIEW_PAGE_HEIGHT_PX, x + 10, y + REVIEW_PAGE_IMAGE_HEIGHT_PX + 8, `SWEEP ${String(record.sweepNumber).padStart(3, "0")} - HUMAN MEMBERSHIP PENDING`, 2, REVIEW_WHITE);
  drawText(canvas, REVIEW_PAGE_WIDTH_PX, REVIEW_PAGE_HEIGHT_PX, x + 10, y + REVIEW_PAGE_IMAGE_HEIGHT_PX + 32, `SHA ${record.sha256.slice(7, 23)} - SOURCE BOUND`, 2, REVIEW_MUTED);
}

async function drawReviewTile(
  canvas: Buffer,
  record: GrandHallT554PanoramaInventoryFile,
  tileIndex: number,
  loadBytes: (record: GrandHallT554PanoramaInventoryFile) => Promise<Buffer>,
): Promise<void> {
  const cellWidth = REVIEW_PAGE_WIDTH_PX / REVIEW_PAGE_COLUMNS;
  const cellHeight = REVIEW_PAGE_IMAGE_HEIGHT_PX + REVIEW_PAGE_LABEL_HEIGHT_PX;
  const x = (tileIndex % REVIEW_PAGE_COLUMNS) * cellWidth;
  const y = REVIEW_PAGE_HEADER_HEIGHT_PX + Math.floor(tileIndex / REVIEW_PAGE_COLUMNS) * cellHeight;
  const bytes = await loadBytes(record);
  const resized = await resizeReviewSource(bytes, record, cellWidth);
  blitRgb(canvas, resized, cellWidth, REVIEW_PAGE_IMAGE_HEIGHT_PX, x, y);
  drawBorder(canvas, x, y, cellWidth, cellHeight);
  drawTileLabels(canvas, record, x, y);
}

export async function renderGrandHallT554PanoramaInventoryReviewPage(
  plan: GrandHallT554PanoramaInventoryReviewPagePlan,
  loadBytes: (record: GrandHallT554PanoramaInventoryFile) => Promise<Buffer>,
): Promise<GrandHallT554RenderedPanoramaInventoryReviewPage> {
  const canvas = Buffer.alloc(
    REVIEW_PAGE_WIDTH_PX * REVIEW_PAGE_HEIGHT_PX * 3,
    Buffer.from(REVIEW_BACKGROUND),
  );
  drawPageHeader(canvas, plan.pageNumber);
  for (const [tileIndex, record] of plan.records.entries()) {
    await drawReviewTile(canvas, record, tileIndex, loadBytes);
  }
  const bytes = await sharp(canvas, {
    raw: { width: REVIEW_PAGE_WIDTH_PX, height: REVIEW_PAGE_HEIGHT_PX, channels: 3 },
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true }).toBuffer();
  const evidence = ReviewPageSchema.parse({
    relativePath: plan.relativePath,
    pageNumber: plan.pageNumber,
    sourceRecordCount: plan.records.length,
    sourceSweepNumbers: plan.records.map((record) => record.sweepNumber),
    sourceRecordInventorySha256: plan.sourceRecordInventorySha256,
    mediaType: "image/png",
    widthPx: REVIEW_PAGE_WIDTH_PX,
    heightPx: REVIEW_PAGE_HEIGHT_PX,
    byteLength: bytes.length,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    authority: "none",
    role: "inventory_human_review_only_resampled_contact_sheet",
    reconstructionInputPermitted: false,
  });
  return { ...evidence, bytes };
}

function reviewRecord(
  source: GrandHallT554PanoramaInventoryFile,
  pageNumber: number,
  tileIndex: number,
): GrandHallT554PanoramaInventoryReviewRecord {
  if (source.sourceLocator !== `${GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR}/${source.relativePath}`) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      `Sweep ${String(source.sweepNumber)} source locator is not bound to its exact relative path.`,
    );
  }
  return ReviewRecordSchema.parse({
    ...source,
    reviewEligibility: "not_in_t550_ineligible_unreviewed",
    humanReviewState: "pending",
    possibleGrandHallEvidenceState: "human_pending",
    roomMembershipDisposition: null,
    authority: "none",
    trainingInputPermitted: false,
    reconstructionInputPermitted: false,
    runtimeInputPermitted: false,
    publicEvidencePermitted: false,
    pageNumber,
    tileIndex,
  });
}

function manifestRecords(
  plans: readonly GrandHallT554PanoramaInventoryReviewPagePlan[],
): readonly GrandHallT554PanoramaInventoryReviewRecord[] {
  return plans.flatMap((plan) =>
    plan.records.map((record, tileIndex) => reviewRecord(record, plan.pageNumber, tileIndex)),
  );
}

function manifestMaterial(
  inventory: GrandHallT554PanoramaInventory,
  plans: readonly GrandHallT554PanoramaInventoryReviewPagePlan[],
  pages: readonly GrandHallT554RenderedPanoramaInventoryReviewPage[],
): z.infer<typeof ManifestMaterialSchema> {
  return ManifestMaterialSchema.parse({
    schemaVersion: GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_SCHEMA,
    subject: REVIEW_MANIFEST_SUBJECT,
    authority: "none",
    reviewState: "human_pending",
    sourceMutationPermitted: false,
    networkAccess: "none",
    preservedCandidateReview: {
      manifestSha256: GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
      candidateSweepRange: [1, 50],
      candidateRecordCount: 50,
      exactPersistedPackVerifiedBeforeRender: true,
      bytesOrDigestsChangedByThisSupplement: false,
    },
    panoramaInventory: {
      sourceLocator: GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
      fileCount: inventory.fileCount,
      inventorySha256: inventory.inventorySha256,
      candidateRecordCount: 50,
      remainingRecordCount: GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_RECORD_COUNT,
      records: manifestRecords(plans),
    },
    pagination: {
      pageSize: GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_SIZE,
      pageCount: pages.length,
      outputFileCount: GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_OUTPUT_FILE_COUNT,
      pages: pages.map(({ bytes: _bytes, ...page }) => page),
    },
    scopeGuards: REVIEW_SCOPE_GUARDS,
    toolchain: {
      sharpVersion: sharp.versions.sharp,
      libvipsVersion: sharp.versions.vips,
      labelRenderer: "embedded_3x5_bitmap_font_v1",
      outputEncoding: "png_rgb8_no_metadata",
      resamplingKernel: REVIEW_PAGE_KERNEL,
    },
    proof: REVIEW_PROOF,
    warnings: REVIEW_WARNINGS,
  });
}

export function buildGrandHallT554PanoramaInventoryReviewManifest(
  inventory: GrandHallT554PanoramaInventory,
  plans: readonly GrandHallT554PanoramaInventoryReviewPagePlan[],
  pages: readonly GrandHallT554RenderedPanoramaInventoryReviewPage[],
): GrandHallT554PanoramaInventoryReviewManifest {
  const material = manifestMaterial(inventory, plans, pages);
  return ManifestSchema.parse({
    ...material,
    manifestSha256: `sha256:${domainSeparatedSha256(
      GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_DOMAIN,
      toCanonicalJson(material),
    )}`,
  });
}

function serializeManifest(manifest: GrandHallT554PanoramaInventoryReviewManifest): Buffer {
  const { manifestSha256, ...material } = manifest;
  const recomputed = `sha256:${domainSeparatedSha256(
    GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_DOMAIN,
    toCanonicalJson(material),
  )}`;
  if (manifestSha256 !== recomputed) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_PUBLISH_FAILED",
      "All-source review manifest self-digest is inconsistent.",
    );
  }
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function readHandleExactly(handle: FileHandle, sizeBytes: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(sizeBytes);
  let offset = 0;
  while (offset < sizeBytes) {
    const { bytesRead } = await handle.read(bytes, offset, sizeBytes - offset, offset);
    if (bytesRead <= 0) throw new Error("Review output ended during stable read.");
    offset += bytesRead;
  }
  return bytes;
}

async function readStableOutput(path: string, maxBytes: number): Promise<{ bytes: Buffer; sha256: Sha256 }> {
  let bytes: Buffer | undefined;
  const digest = await sha256RegularFileWithHead(
    path,
    0,
    undefined,
    undefined,
    undefined,
    async (handle, sizeBytes, sourceSha256) => {
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxBytes) {
        throw new Error("Review output exceeds its bounded read limit.");
      }
      bytes = await readHandleExactly(handle, sizeBytes);
      if (createHash("sha256").update(bytes).digest("hex") !== sourceSha256) {
        throw new Error("Review output changed during stable read.");
      }
    },
  );
  if (bytes === undefined) throw new Error("Review output stable bytes were not captured.");
  return { bytes, sha256: `sha256:${digest.sha256}` };
}

function failCrossBinding(message: string): never {
  throw new GrandHallT554PanoramaReviewError(
    "OUTPUT_VERIFICATION_FAILED",
    message,
  );
}

function assertRecordIdentity(
  record: GrandHallT554PanoramaInventoryReviewRecord,
  expectedSweep: number,
): void {
  if (record.sweepNumber !== expectedSweep) {
    failCrossBinding("Remaining panorama records are not in exact sweep order.");
  }
  const parsed = parseGrandHallT554PanoramaFilename(record.relativePath);
  if (
    parsed.sweepNumber !== record.sweepNumber ||
    parsed.digitToken !== record.digitToken ||
    parsed.namingAnomalies.join("\n") !== record.namingAnomalies.join("\n") ||
    record.sourceLocator !== `${GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR}/${record.relativePath}`
  ) {
    failCrossBinding(`Sweep ${String(record.sweepNumber)} identity fields are inconsistent.`);
  }
}

function recordsForPage(
  manifest: GrandHallT554PanoramaInventoryReviewManifest,
  pageNumber: number,
): readonly GrandHallT554PanoramaInventoryReviewRecord[] {
  return manifest.panoramaInventory.records.filter(
    (record) => record.pageNumber === pageNumber,
  );
}

function assertPageCrossBinding(
  manifest: GrandHallT554PanoramaInventoryReviewManifest,
  page: GrandHallT554PanoramaInventoryReviewPageEvidence,
): void {
  const records = recordsForPage(manifest, page.pageNumber);
  const expectedTiles = records.map((record) => record.tileIndex);
  if (
    records.length !== page.sourceRecordCount ||
    expectedTiles.some((tileIndex, index) => tileIndex !== index) ||
    records.map((record) => record.sweepNumber).join("\n") !== page.sourceSweepNumbers.join("\n") ||
    page.sourceRecordInventorySha256 !== pageSourceDigest(records)
  ) {
    failCrossBinding(`Review page ${String(page.pageNumber)} is not bound to its exact source records.`);
  }
}

function assertManifestCrossBindings(
  manifest: GrandHallT554PanoramaInventoryReviewManifest,
): void {
  const expectedSweeps = Array.from({ length: 99 }, (_, index) => index + 51)
    .filter((sweep) => sweep !== MISSING_SOURCE_SWEEP);
  manifest.panoramaInventory.records.forEach((record, index) => {
    const expectedSweep = expectedSweeps[index];
    if (expectedSweep === undefined) failCrossBinding("Remaining panorama inventory is too long.");
    assertRecordIdentity(record, expectedSweep);
  });
  manifest.pagination.pages.forEach((page, index) => {
    if (page.pageNumber !== index + 1 || page.relativePath !== pageFileName(index + 1)) {
      failCrossBinding("Review pages are not in exact deterministic page order.");
    }
    assertPageCrossBinding(manifest, page);
  });
}

function parseManifest(bytes: Buffer): GrandHallT554PanoramaInventoryReviewManifest {
  const manifest = ManifestSchema.parse(parseGrandHallT554StrictJson(bytes));
  const { manifestSha256, ...material } = manifest;
  const recomputed = `sha256:${domainSeparatedSha256(
    GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_DOMAIN,
    toCanonicalJson(material),
  )}`;
  if (manifestSha256 !== recomputed) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted all-source review manifest self-digest is invalid.",
    );
  }
  assertManifestCrossBindings(manifest);
  return manifest;
}

function expectedOutputNames(manifest: GrandHallT554PanoramaInventoryReviewManifest): readonly string[] {
  return [
    ...manifest.pagination.pages.map((page) => page.relativePath),
    GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_MANIFEST_FILENAME,
  ].sort((left, right) => left.localeCompare(right, "en"));
}

async function verifyPage(
  outputDirectory: string,
  evidence: GrandHallT554PanoramaInventoryReviewPageEvidence,
): Promise<void> {
  const stable = await readStableOutput(resolve(outputDirectory, evidence.relativePath), MAX_REVIEW_PNG_BYTES);
  if (stable.sha256 !== evidence.sha256 || stable.bytes.length !== evidence.byteLength) {
    throw new GrandHallT554PanoramaReviewError("OUTPUT_VERIFICATION_FAILED", `${evidence.relativePath} differs from its manifest identity.`);
  }
  const decoded = await sharp(stable.bytes, { failOn: "error", limitInputPixels: REVIEW_PAGE_WIDTH_PX * REVIEW_PAGE_HEIGHT_PX })
    .removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== evidence.widthPx || decoded.info.height !== evidence.heightPx || decoded.info.channels !== 3) {
    throw new GrandHallT554PanoramaReviewError("OUTPUT_VERIFICATION_FAILED", `${evidence.relativePath} does not decode as its declared RGB8 page.`);
  }
}

async function inspectPersistedReview(
  outputDirectory: string,
): Promise<VerifiedGrandHallT554PanoramaInventoryReview> {
  const manifestPath = resolve(outputDirectory, GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_MANIFEST_FILENAME);
  const stableManifest = await readStableOutput(manifestPath, MAX_REVIEW_MANIFEST_BYTES);
  const manifest = parseManifest(stableManifest.bytes);
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile()) || entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right, "en")).join("\n") !== expectedOutputNames(manifest).join("\n")) {
    throw new GrandHallT554PanoramaReviewError("OUTPUT_VERIFICATION_FAILED", "All-source review output inventory is not exact.");
  }
  for (const page of manifest.pagination.pages) await verifyPage(outputDirectory, page);
  return {
    outputDirectory,
    manifestSha256: manifest.manifestSha256,
    manifestFileSha256: stableManifest.sha256,
    manifestFileByteLength: stableManifest.bytes.length,
    pageCount: GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_COUNT,
    outputFileCount: GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_OUTPUT_FILE_COUNT,
    sourceRecordCount: 98,
    pngDecodeVerified: true,
    authority: "none",
  };
}

async function publishReview(
  outputDirectory: string,
  outputParent: string,
  pages: readonly GrandHallT554RenderedPanoramaInventoryReviewPage[],
  manifest: GrandHallT554PanoramaInventoryReviewManifest,
): Promise<VerifiedGrandHallT554PanoramaInventoryReview> {
  const temporaryDirectory = resolve(outputParent, `.${basename(outputDirectory)}.partial-${String(process.pid)}-${randomUUID()}`);
  try {
    await mkdir(temporaryDirectory, { recursive: false });
    for (const page of pages) await writeFile(resolve(temporaryDirectory, page.relativePath), page.bytes, { flag: "wx" });
    await writeFile(resolve(temporaryDirectory, GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_MANIFEST_FILENAME), serializeManifest(manifest), { flag: "wx" });
    await inspectPersistedReview(temporaryDirectory);
    await rename(temporaryDirectory, outputDirectory);
    return await inspectPersistedReview(outputDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (error instanceof GrandHallT554PanoramaReviewError) throw error;
    throw new GrandHallT554PanoramaReviewError("OUTPUT_PUBLISH_FAILED", "All-source review supplement could not be published.", error);
  }
}

async function buildFromSources(
  options: GenerateGrandHallT554PanoramaInventoryReviewOptions,
): Promise<{
  readonly manifest: GrandHallT554PanoramaInventoryReviewManifest;
  readonly pages: readonly GrandHallT554RenderedPanoramaInventoryReviewPage[];
}> {
  const preserved = await verifyPersistedGrandHallT554PanoramaReviewPack(options.preservedCandidateReviewDirectory);
  if (preserved.manifestSha256 !== GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256) {
    throw new GrandHallT554PanoramaReviewError("OUTPUT_VERIFICATION_FAILED", "Preserved candidate review pack digest changed.");
  }
  const inventory = await collectGrandHallT554PanoramaInventory({ sourceRoot: options.panoramaSourceRoot });
  if (inventory.inventorySha256 !== GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256) {
    throw new GrandHallT554PanoramaReviewError("SOURCE_INVENTORY_INVALID", "Panorama inventory does not match the exact reviewed 148-file identity.");
  }
  const plans = buildGrandHallT554PanoramaInventoryReviewPagePlans(inventory.files);
  const pages: GrandHallT554RenderedPanoramaInventoryReviewPage[] = [];
  for (const plan of plans) {
    pages.push(await renderGrandHallT554PanoramaInventoryReviewPage(plan, (record) =>
      readGrandHallT554StablePanoramaBytes(resolve(options.panoramaSourceRoot, record.relativePath), record),
    ));
  }
  return { manifest: buildGrandHallT554PanoramaInventoryReviewManifest(inventory, plans, pages), pages };
}

export async function generateGrandHallT554PanoramaInventoryReview(
  options: GenerateGrandHallT554PanoramaInventoryReviewOptions,
): Promise<GeneratedGrandHallT554PanoramaInventoryReview> {
  const safety = await assertGrandHallT554ReviewOutputSafety({
    sourceRoots: [options.panoramaSourceRoot, options.preservedCandidateReviewDirectory],
    outputDirectory: options.outputDirectory,
  });
  const built = await buildFromSources(options);
  const verified = await publishReview(safety.outputDirectory, safety.outputParent, built.pages, built.manifest);
  return { outputDirectory: verified.outputDirectory, manifest: built.manifest, manifestFileSha256: verified.manifestFileSha256, manifestFileByteLength: verified.manifestFileByteLength };
}

export async function verifyPersistedGrandHallT554PanoramaInventoryReview(
  outputDirectory: string,
): Promise<VerifiedGrandHallT554PanoramaInventoryReview> {
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({
    sourceRoots: [],
    outputDirectory,
  });
  return await inspectPersistedReview(safety.outputDirectory);
}

export async function checkGrandHallT554PanoramaInventoryReview(
  options: GenerateGrandHallT554PanoramaInventoryReviewOptions,
): Promise<VerifiedGrandHallT554PanoramaInventoryReview & { readonly exactRegenerationVerified: true }> {
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({
    sourceRoots: [options.panoramaSourceRoot, options.preservedCandidateReviewDirectory],
    outputDirectory: options.outputDirectory,
  });
  const first = await inspectPersistedReview(safety.outputDirectory);
  const expected = await buildFromSources(options);
  const expectedManifest = serializeManifest(expected.manifest);
  const persistedManifest = await readStableOutput(resolve(safety.outputDirectory, GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_MANIFEST_FILENAME), MAX_REVIEW_MANIFEST_BYTES);
  if (!persistedManifest.bytes.equals(expectedManifest)) throw new GrandHallT554PanoramaReviewError("OUTPUT_VERIFICATION_FAILED", "All-source review manifest differs from exact source regeneration.");
  for (const page of expected.pages) {
    const persisted = await readStableOutput(resolve(safety.outputDirectory, page.relativePath), MAX_REVIEW_PNG_BYTES);
    if (!persisted.bytes.equals(page.bytes)) throw new GrandHallT554PanoramaReviewError("OUTPUT_VERIFICATION_FAILED", `${page.relativePath} differs from exact source regeneration.`);
  }
  const final = await inspectPersistedReview(safety.outputDirectory);
  if (first.manifestFileSha256 !== final.manifestFileSha256) throw new GrandHallT554PanoramaReviewError("OUTPUT_VERIFICATION_FAILED", "All-source review changed during exact regeneration check.");
  return { ...final, exactRegenerationVerified: true };
}

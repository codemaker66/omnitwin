import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import {
  domainSeparatedSha256,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import sharp from "sharp";

import {
  GRAND_HALL_T554_EXPECTED_HEIGHT_PX,
  GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
  GRAND_HALL_T554_EXPECTED_WIDTH_PX,
  GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
  GrandHallT554PanoramaReviewError,
  assertGrandHallT554ExistingReviewOutputSafety,
  assertGrandHallT554ReviewOutputSafety,
  collectGrandHallT554PanoramaInventory,
  readGrandHallT554StablePanoramaBytes,
  type GrandHallT554PanoramaInventory,
  type GrandHallT554PanoramaInventoryFile,
} from "./grand-hall-t554-panorama-review.js";

export const GRAND_HALL_MATTERPORT_BOUNDARY_REVIEW_SCHEMA =
  "omnitwin.foundry.grand-hall-matterport-boundary-review.v1";
export const GRAND_HALL_MATTERPORT_BOUNDARY_PROVENANCE_DOMAIN =
  "OMNITWIN_GRAND_HALL_MATTERPORT_BOUNDARY_PROVENANCE_V1";
export const GRAND_HALL_MATTERPORT_BOUNDARY_CONTACT_SHEET_FILENAME =
  "matterport-boundary-contact-sheet-sweeps-001-060.png";
export const GRAND_HALL_MATTERPORT_BOUNDARY_REVIEW_FORM_FILENAME =
  "matterport-boundary-review-form.json";
export const GRAND_HALL_MATTERPORT_BOUNDARY_PROVENANCE_FILENAME =
  "matterport-boundary-provenance.json";
export const GRAND_HALL_MATTERPORT_BOUNDARY_README_FILENAME = "README.md";
export const GRAND_HALL_MATTERPORT_BOUNDARY_SOURCE_COUNT = 60;
export const GRAND_HALL_MATTERPORT_BOUNDARY_DETAIL_SWEEPS = Object.freeze([
  47, 48, 49, 50, 51,
] as const);
export const GRAND_HALL_MATTERPORT_BOUNDARY_ALLOWED_LABELS = Object.freeze([
  "UNREVIEWED",
  "IN",
  "THRESHOLD",
  "OUT",
] as const);

const SHEET_WIDTH_PX = 3_440;
const SHEET_HEIGHT_PX = 1_900;
const SHEET_COLUMNS = 10;
const MAIN_TILE_WIDTH_PX = 320;
const MAIN_IMAGE_HEIGHT_PX = 160;
const MAIN_LABEL_HEIGHT_PX = 42;
const MAIN_COLUMN_GAP_PX = 16;
const MAIN_ROW_GAP_PX = 10;
const MAIN_GRID_LEFT_PX = 48;
const MAIN_GRID_TOP_PX = 116;
const DETAIL_TILE_WIDTH_PX = 640;
const DETAIL_IMAGE_HEIGHT_PX = 320;
const DETAIL_LABEL_HEIGHT_PX = 42;
const DETAIL_COLUMN_GAP_PX = 16;
const DETAIL_GRID_LEFT_PX = 88;
const DETAIL_GRID_TOP_PX = 1_436;
const RESAMPLING_KERNEL = "lanczos3";
export const GRAND_HALL_MATTERPORT_BOUNDARY_OUTPUT_FILENAMES = Object.freeze([
  GRAND_HALL_MATTERPORT_BOUNDARY_CONTACT_SHEET_FILENAME,
  GRAND_HALL_MATTERPORT_BOUNDARY_PROVENANCE_FILENAME,
  GRAND_HALL_MATTERPORT_BOUNDARY_README_FILENAME,
  GRAND_HALL_MATTERPORT_BOUNDARY_REVIEW_FORM_FILENAME,
] as const);

type Sha256 = `sha256:${string}`;
type ReviewLabel = (typeof GRAND_HALL_MATTERPORT_BOUNDARY_ALLOWED_LABELS)[number];
type Rgb = readonly [number, number, number];

const BACKGROUND: Rgb = [6, 10, 13];
const PANEL: Rgb = [13, 19, 23];
const BORDER: Rgb = [99, 108, 113];
const WHITE: Rgb = [236, 238, 236];
const MUTED: Rgb = [157, 165, 168];
const GOLD: Rgb = [214, 169, 78];

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

export interface GrandHallMatterportBoundaryTileGeometry {
  readonly xPx: number;
  readonly yPx: number;
  readonly imageWidthPx: number;
  readonly imageHeightPx: number;
  readonly labelHeightPx: number;
  readonly fullEquirectangularFrameVisible: true;
  readonly cropApplied: false;
}

export interface GrandHallMatterportBoundaryPlanRecord {
  readonly source: GrandHallT554PanoramaInventoryFile;
  readonly absoluteSourcePath: string;
  readonly initialLabel: ReviewLabel;
  readonly mainTile: GrandHallMatterportBoundaryTileGeometry;
  readonly enlargedBoundaryTile: GrandHallMatterportBoundaryTileGeometry | null;
}

export interface GrandHallMatterportBoundaryReviewPlan {
  readonly panoramaSourceRoot: string;
  readonly records: readonly GrandHallMatterportBoundaryPlanRecord[];
  readonly sheetWidthPx: typeof SHEET_WIDTH_PX;
  readonly sheetHeightPx: typeof SHEET_HEIGHT_PX;
}

export interface GrandHallMatterportBoundaryRenderedSheet {
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly sha256: Sha256;
  readonly widthPx: typeof SHEET_WIDTH_PX;
  readonly heightPx: typeof SHEET_HEIGHT_PX;
  readonly mediaType: "image/png";
  readonly sourceLoadCount: typeof GRAND_HALL_MATTERPORT_BOUNDARY_SOURCE_COUNT;
  readonly fullEquirectangularFrameVisible: true;
  readonly cropApplied: false;
}

export interface GenerateGrandHallMatterportBoundaryReviewOptions {
  readonly panoramaSourceRoot: string;
  readonly outputDirectory: string;
}

export interface GrandHallMatterportBoundaryOutputEvidence {
  readonly relativePath: string;
  readonly mediaType: "image/png" | "application/json" | "text/markdown";
  readonly byteLength: number;
  readonly sha256: Sha256;
}

export interface GrandHallMatterportBoundaryGeneratedReview {
  readonly outputDirectory: string;
  readonly provenanceSha256: Sha256;
  readonly provenanceFileSha256: Sha256;
  readonly panoramaInventorySha256: Sha256;
  readonly outputs: readonly GrandHallMatterportBoundaryOutputEvidence[];
  readonly sourceRecordCount: typeof GRAND_HALL_MATTERPORT_BOUNDARY_SOURCE_COUNT;
  readonly allLabelsUnreviewed: true;
  readonly exactRegenerationVerified?: true;
}

interface BuiltBoundaryReview {
  readonly artifacts: ReadonlyMap<string, Buffer>;
  readonly result: Omit<GrandHallMatterportBoundaryGeneratedReview, "outputDirectory">;
}

export interface GrandHallMatterportBoundaryAtomicPublishTestSeam {
  readonly afterTemporaryDirectoryCreated?: (
    temporaryDirectory: string,
  ) => Promise<void> | void;
}

function sha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function provenanceDigest(
  canonicalMaterial: ReturnType<typeof toCanonicalJson>,
): Sha256 {
  return `sha256:${domainSeparatedSha256(
    GRAND_HALL_MATTERPORT_BOUNDARY_PROVENANCE_DOMAIN,
    canonicalMaterial,
  )}`;
}

function comparablePath(path: string): string {
  const absolute = resolve(path).replaceAll("/", "\\");
  return process.platform === "win32"
    ? absolute.toLocaleLowerCase("en-US")
    : absolute;
}

export function assertGrandHallMatterportBoundaryPartialDirectoryDirectChild(
  outputParent: string,
  outputDirectory: string,
  temporaryDirectory: string,
): void {
  const absoluteParent = resolve(outputParent);
  const absoluteOutput = resolve(outputDirectory);
  const absoluteTemporary = resolve(temporaryDirectory);
  const expectedPrefix = `.${basename(absoluteOutput)}.partial-`;
  if (
    comparablePath(dirname(absoluteOutput)) !== comparablePath(absoluteParent) ||
    comparablePath(dirname(absoluteTemporary)) !== comparablePath(absoluteParent) ||
    comparablePath(absoluteTemporary) === comparablePath(absoluteOutput) ||
    !basename(absoluteTemporary).startsWith(expectedPrefix) ||
    basename(absoluteTemporary).length <= expectedPrefix.length
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_PUBLISH_FAILED",
      "Boundary review partial directory is not a uniquely named direct child of the validated output parent.",
    );
  }
}

function mainTileGeometry(index: number): GrandHallMatterportBoundaryTileGeometry {
  const column = index % SHEET_COLUMNS;
  const row = Math.floor(index / SHEET_COLUMNS);
  return {
    xPx: MAIN_GRID_LEFT_PX + column * (MAIN_TILE_WIDTH_PX + MAIN_COLUMN_GAP_PX),
    yPx: MAIN_GRID_TOP_PX + row * (MAIN_IMAGE_HEIGHT_PX + MAIN_LABEL_HEIGHT_PX + MAIN_ROW_GAP_PX),
    imageWidthPx: MAIN_TILE_WIDTH_PX,
    imageHeightPx: MAIN_IMAGE_HEIGHT_PX,
    labelHeightPx: MAIN_LABEL_HEIGHT_PX,
    fullEquirectangularFrameVisible: true,
    cropApplied: false,
  };
}

function detailTileGeometry(sweepNumber: number): GrandHallMatterportBoundaryTileGeometry | null {
  const index = GRAND_HALL_MATTERPORT_BOUNDARY_DETAIL_SWEEPS.indexOf(
    sweepNumber as (typeof GRAND_HALL_MATTERPORT_BOUNDARY_DETAIL_SWEEPS)[number],
  );
  if (index < 0) return null;
  return {
    xPx: DETAIL_GRID_LEFT_PX + index * (DETAIL_TILE_WIDTH_PX + DETAIL_COLUMN_GAP_PX),
    yPx: DETAIL_GRID_TOP_PX,
    imageWidthPx: DETAIL_TILE_WIDTH_PX,
    imageHeightPx: DETAIL_IMAGE_HEIGHT_PX,
    labelHeightPx: DETAIL_LABEL_HEIGHT_PX,
    fullEquirectangularFrameVisible: true,
    cropApplied: false,
  };
}

export function buildGrandHallMatterportBoundaryReviewPlan(
  panoramaSourceRoot: string,
  files: readonly GrandHallT554PanoramaInventoryFile[],
): GrandHallMatterportBoundaryReviewPlan {
  const absoluteRoot = resolve(panoramaSourceRoot);
  const bySweep = new Map(files.map((file) => [file.sweepNumber, file]));
  const records = Array.from(
    { length: GRAND_HALL_MATTERPORT_BOUNDARY_SOURCE_COUNT },
    (_, index): GrandHallMatterportBoundaryPlanRecord => {
      const sweepNumber = index + 1;
      const source = bySweep.get(sweepNumber);
      if (source === undefined) {
        throw new GrandHallT554PanoramaReviewError(
          "SOURCE_INVENTORY_INVALID",
          `Boundary review source sweep ${String(sweepNumber).padStart(3, "0")} is missing.`,
        );
      }
      if (
        source.widthPx !== GRAND_HALL_T554_EXPECTED_WIDTH_PX ||
        source.heightPx !== GRAND_HALL_T554_EXPECTED_HEIGHT_PX ||
        source.sourceLocator !== `${GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR}/${source.relativePath}`
      ) {
        throw new GrandHallT554PanoramaReviewError(
          "SOURCE_INVENTORY_INVALID",
          `Boundary review source sweep ${String(sweepNumber).padStart(3, "0")} has inconsistent identity or dimensions.`,
        );
      }
      return {
        source,
        absoluteSourcePath: resolve(absoluteRoot, source.relativePath),
        initialLabel: "UNREVIEWED",
        mainTile: mainTileGeometry(index),
        enlargedBoundaryTile: detailTileGeometry(sweepNumber),
      };
    },
  );
  if (
    records.length !== GRAND_HALL_MATTERPORT_BOUNDARY_SOURCE_COUNT ||
    records.some((record, index) => record.source.sweepNumber !== index + 1) ||
    records.filter((record) => record.enlargedBoundaryTile !== null).map((record) => record.source.sweepNumber).join(",") !==
      GRAND_HALL_MATTERPORT_BOUNDARY_DETAIL_SWEEPS.join(",")
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      "Boundary review plan is not the exact neutral sweep 001-060 plan.",
    );
  }
  return {
    panoramaSourceRoot: absoluteRoot,
    records,
    sheetWidthPx: SHEET_WIDTH_PX,
    sheetHeightPx: SHEET_HEIGHT_PX,
  };
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
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(canvasWidth, x + width);
  const bottom = Math.min(canvasHeight, y + height);
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      const offset = (row * canvasWidth + column) * 3;
      canvas[offset] = color[0];
      canvas[offset + 1] = color[1];
      canvas[offset + 2] = color[2];
    }
  }
}

function drawText(
  canvas: Buffer,
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
        fillRectangle(
          canvas,
          SHEET_WIDTH_PX,
          SHEET_HEIGHT_PX,
          cursorX + column * scale,
          y + row * scale,
          scale,
          scale,
          color,
        );
      }
    }
    cursorX += 4 * scale;
  }
}

function drawBorder(
  canvas: Buffer,
  geometry: GrandHallMatterportBoundaryTileGeometry,
): void {
  const height = geometry.imageHeightPx + geometry.labelHeightPx;
  fillRectangle(canvas, SHEET_WIDTH_PX, SHEET_HEIGHT_PX, geometry.xPx, geometry.yPx, geometry.imageWidthPx, 3, BORDER);
  fillRectangle(canvas, SHEET_WIDTH_PX, SHEET_HEIGHT_PX, geometry.xPx, geometry.yPx + height - 3, geometry.imageWidthPx, 3, BORDER);
  fillRectangle(canvas, SHEET_WIDTH_PX, SHEET_HEIGHT_PX, geometry.xPx, geometry.yPx, 3, height, BORDER);
  fillRectangle(canvas, SHEET_WIDTH_PX, SHEET_HEIGHT_PX, geometry.xPx + geometry.imageWidthPx - 3, geometry.yPx, 3, height, BORDER);
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
  const canvasStride = SHEET_WIDTH_PX * 3;
  for (let row = 0; row < sourceHeight; row += 1) {
    source.copy(
      canvas,
      (y + row) * canvasStride + x * 3,
      row * sourceStride,
      (row + 1) * sourceStride,
    );
  }
}

async function fullFrameThumbnail(
  sourceBytes: Buffer,
  record: GrandHallMatterportBoundaryPlanRecord,
  geometry: GrandHallMatterportBoundaryTileGeometry,
): Promise<Buffer> {
  try {
    const rendered = await sharp(sourceBytes, {
      failOn: "error",
      limitInputPixels: GRAND_HALL_T554_EXPECTED_WIDTH_PX * GRAND_HALL_T554_EXPECTED_HEIGHT_PX,
    })
      .resize(geometry.imageWidthPx, geometry.imageHeightPx, {
        fit: "contain",
        kernel: RESAMPLING_KERNEL,
        background: { r: 0, g: 0, b: 0 },
      })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      rendered.info.width !== geometry.imageWidthPx ||
      rendered.info.height !== geometry.imageHeightPx ||
      rendered.info.channels !== 3
    ) {
      throw new Error("Unexpected RGB8 thumbnail dimensions.");
    }
    return rendered.data;
  } catch (error) {
    throw new GrandHallT554PanoramaReviewError(
      "RENDER_FAILED",
      `Sweep ${String(record.source.sweepNumber).padStart(3, "0")} could not be rendered without cropping.`,
      error,
    );
  }
}

function drawTileLabel(
  canvas: Buffer,
  record: GrandHallMatterportBoundaryPlanRecord,
  geometry: GrandHallMatterportBoundaryTileGeometry,
): void {
  fillRectangle(
    canvas,
    SHEET_WIDTH_PX,
    SHEET_HEIGHT_PX,
    geometry.xPx,
    geometry.yPx + geometry.imageHeightPx,
    geometry.imageWidthPx,
    geometry.labelHeightPx,
    PANEL,
  );
  const sweep = String(record.source.sweepNumber).padStart(3, "0");
  drawText(canvas, geometry.xPx + 9, geometry.yPx + geometry.imageHeightPx + 6, `${sweep} UNREVIEWED`, 2, WHITE);
  drawText(canvas, geometry.xPx + 9, geometry.yPx + geometry.imageHeightPx + 24, `SHA ${record.source.sha256.slice(7, 19)}`, 2, MUTED);
  drawBorder(canvas, geometry);
}

function drawSheetScaffold(canvas: Buffer): void {
  drawText(canvas, 48, 20, "MATTERPORT GRAND HALL BOUNDARY REVIEW", 4, GOLD);
  drawText(canvas, 48, 54, "SWEEPS 001-060 - ALL LABELS UNREVIEWED - AUTHORITY NONE", 3, WHITE);
  drawText(canvas, 48, 82, "FULL EQUIRECTANGULAR CONTEXT - NO CROP - HUMAN REVIEW REQUIRED", 2, MUTED);
  drawText(canvas, 88, 1_398, "BOUNDARY DETAIL 047-051 - ENLARGED ONLY - NO PREACCEPTANCE", 3, GOLD);
  drawText(canvas, 88, 1_818, "ALLOWED LABELS: UNREVIEWED / IN / THRESHOLD / OUT", 3, WHITE);
  drawText(canvas, 88, 1_850, "DECISIONS MUST BE RECORDED BY A HUMAN IN THE REVIEW FORM", 2, MUTED);
}

export async function renderGrandHallMatterportBoundaryContactSheet(
  plan: GrandHallMatterportBoundaryReviewPlan,
  loadBytes: (record: GrandHallMatterportBoundaryPlanRecord) => Promise<Buffer>,
): Promise<GrandHallMatterportBoundaryRenderedSheet> {
  if (plan.records.some((record) => record.initialLabel !== "UNREVIEWED")) {
    throw new GrandHallT554PanoramaReviewError(
      "RENDER_FAILED",
      "Boundary review rendering requires every initial label to remain UNREVIEWED.",
    );
  }
  const canvas = Buffer.alloc(
    SHEET_WIDTH_PX * SHEET_HEIGHT_PX * 3,
    Buffer.from(BACKGROUND),
  );
  drawSheetScaffold(canvas);
  let sourceLoadCount = 0;
  for (const record of plan.records) {
    const sourceBytes = await loadBytes(record);
    sourceLoadCount += 1;
    const main = await fullFrameThumbnail(sourceBytes, record, record.mainTile);
    blitRgb(
      canvas,
      main,
      record.mainTile.imageWidthPx,
      record.mainTile.imageHeightPx,
      record.mainTile.xPx,
      record.mainTile.yPx,
    );
    drawTileLabel(canvas, record, record.mainTile);
    if (record.enlargedBoundaryTile !== null) {
      const detail = await fullFrameThumbnail(sourceBytes, record, record.enlargedBoundaryTile);
      blitRgb(
        canvas,
        detail,
        record.enlargedBoundaryTile.imageWidthPx,
        record.enlargedBoundaryTile.imageHeightPx,
        record.enlargedBoundaryTile.xPx,
        record.enlargedBoundaryTile.yPx,
      );
      drawTileLabel(canvas, record, record.enlargedBoundaryTile);
    }
  }
  if (sourceLoadCount !== GRAND_HALL_MATTERPORT_BOUNDARY_SOURCE_COUNT) {
    throw new GrandHallT554PanoramaReviewError(
      "RENDER_FAILED",
      "Boundary review did not load each of the 60 exact source panoramas once.",
    );
  }
  const bytes = await sharp(canvas, {
    raw: { width: SHEET_WIDTH_PX, height: SHEET_HEIGHT_PX, channels: 3 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true })
    .toBuffer();
  return {
    bytes,
    byteLength: bytes.length,
    sha256: sha256(bytes),
    widthPx: SHEET_WIDTH_PX,
    heightPx: SHEET_HEIGHT_PX,
    mediaType: "image/png",
    sourceLoadCount: GRAND_HALL_MATTERPORT_BOUNDARY_SOURCE_COUNT,
    fullEquirectangularFrameVisible: true,
    cropApplied: false,
  };
}

function serializeJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function buildGrandHallMatterportBoundaryReviewForm(
  plan: GrandHallMatterportBoundaryReviewPlan,
  inventory: GrandHallT554PanoramaInventory,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: GRAND_HALL_MATTERPORT_BOUNDARY_REVIEW_SCHEMA,
    purpose: "human_review_of_grand_hall_room_boundary_only",
    authority: "none_until_human_completed_and_separately_accepted",
    sourceRoot: plan.panoramaSourceRoot,
    sourceInventorySha256: inventory.inventorySha256,
    reviewState: "UNREVIEWED",
    allowedLabels: GRAND_HALL_MATTERPORT_BOUNDARY_ALLOWED_LABELS,
    reviewer: null,
    reviewedAtUtc: null,
    instructions: [
      "Inspect the full equirectangular frame in the contact sheet and, when needed, the exact source JPEG.",
      "Set each label to exactly UNREVIEWED, IN, THRESHOLD, or OUT.",
      "Do not infer membership from sweep number or filename.",
      "THRESHOLD means the view crosses the Grand Hall room boundary and needs later pixel-mask review.",
    ],
    records: plan.records.map((record) => ({
      sweepNumber: record.source.sweepNumber,
      relativePath: record.source.relativePath,
      sourceSha256: record.source.sha256,
      label: "UNREVIEWED" satisfies ReviewLabel,
      notes: "",
    })),
  });
}

function readmeBytes(inventorySha256: Sha256): Buffer {
  const lines = [
    "# Grand Hall Matterport boundary review",
    "",
    "This is a human-review aid, not a room-membership decision. Every sweep starts as `UNREVIEWED`.",
    "The sheet shows the complete 2:1 equirectangular frame for sweeps 001-060 without cropping.",
    "Sweeps 047-051 are repeated at a larger size solely to make the possible transition easier to inspect.",
    "",
    "Review labels:",
    "",
    "- `UNREVIEWED`: no human decision yet.",
    "- `IN`: human-confirmed Grand Hall interior evidence.",
    "- `THRESHOLD`: the view crosses the Grand Hall boundary; later pixel-mask review is required.",
    "- `OUT`: human-confirmed outside the Grand Hall boundary.",
    "",
    "Edit only `matterport-boundary-review-form.json`. Do not decide from filenames or numbering alone.",
    "The initial exact-regeneration check is expected to fail after a reviewer intentionally changes the form.",
    "No source panorama is copied or modified by this generator.",
    "",
    `Exact 148-file source inventory: \`${inventorySha256}\``,
    "",
  ];
  return Buffer.from(lines.join("\n"), "utf8");
}

function outputEvidence(
  relativePath: string,
  mediaType: GrandHallMatterportBoundaryOutputEvidence["mediaType"],
  bytes: Buffer,
): GrandHallMatterportBoundaryOutputEvidence {
  return { relativePath, mediaType, byteLength: bytes.length, sha256: sha256(bytes) };
}

function provenanceMaterial(
  plan: GrandHallMatterportBoundaryReviewPlan,
  inventory: GrandHallT554PanoramaInventory,
  sheet: GrandHallMatterportBoundaryRenderedSheet,
  derivatives: readonly GrandHallMatterportBoundaryOutputEvidence[],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: GRAND_HALL_MATTERPORT_BOUNDARY_REVIEW_SCHEMA,
    subject: {
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      scope: "matterport_sweeps_001_060_boundary_human_review_aid_only",
    },
    authority: "none",
    reviewState: "UNREVIEWED",
    allowedLabels: GRAND_HALL_MATTERPORT_BOUNDARY_ALLOWED_LABELS,
    sourcePolicy: {
      readMode: "read_only",
      sourceMutationPermitted: false,
      sourceCopiesWritten: false,
      networkAccess: "none",
    },
    panoramaInventory: {
      sourceLocator: GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
      absoluteSourceRoot: plan.panoramaSourceRoot,
      suppliedFileCount: inventory.fileCount,
      suppliedTotalBytes: inventory.totalBytes,
      suppliedInventorySha256: inventory.inventorySha256,
      missingSweepNumbersWithin1To149: inventory.missingSweepNumbersWithin1To149,
      selectedSweepRangeInclusive: [1, 60],
      selectedRecordCount: plan.records.length,
      records: plan.records.map((record) => ({
        sweepNumber: record.source.sweepNumber,
        relativePath: record.source.relativePath,
        absoluteSourcePath: record.absoluteSourcePath,
        sourceLocator: record.source.sourceLocator,
        byteLength: record.source.byteLength,
        sha256: record.source.sha256,
        mediaType: record.source.mediaType,
        widthPx: record.source.widthPx,
        heightPx: record.source.heightPx,
        jpegFrame: record.source.jpegFrame,
        jfifHeaderPresent: record.source.jfifHeaderPresent,
        stableDuringRead: record.source.stableDuringRead,
        initialLabel: record.initialLabel,
        mainTile: record.mainTile,
        enlargedBoundaryTile: record.enlargedBoundaryTile,
      })),
    },
    rendering: {
      contactSheet: {
        relativePath: GRAND_HALL_MATTERPORT_BOUNDARY_CONTACT_SHEET_FILENAME,
        widthPx: sheet.widthPx,
        heightPx: sheet.heightPx,
        sourceLoadCount: sheet.sourceLoadCount,
        fullEquirectangularFrameVisible: sheet.fullEquirectangularFrameVisible,
        cropApplied: sheet.cropApplied,
        enlargedBoundarySweeps: GRAND_HALL_MATTERPORT_BOUNDARY_DETAIL_SWEEPS,
      },
      toolchain: {
        sharpVersion: sharp.versions.sharp,
        libvipsVersion: sharp.versions.vips,
        resamplingKernel: RESAMPLING_KERNEL,
        resizeFit: "contain",
        labelRenderer: "embedded_3x5_bitmap_font_v1",
        outputEncoding: "png_rgb8_no_metadata",
      },
    },
    derivatives,
    scopeGuards: {
      roomMembershipInferred: false,
      anySweepPreAccepted: false,
      humanAcceptanceRecorded: false,
      masksGenerated: false,
      trainingAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      architecturalGenerationAuthorized: false,
    },
  });
}

async function buildFromSources(
  options: GenerateGrandHallMatterportBoundaryReviewOptions,
): Promise<BuiltBoundaryReview> {
  const inventory = await collectGrandHallT554PanoramaInventory({
    sourceRoot: options.panoramaSourceRoot,
  });
  if (inventory.inventorySha256 !== GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256) {
    throw new GrandHallT554PanoramaReviewError(
      "SOURCE_INVENTORY_INVALID",
      "Matterport source identities drifted from the exact reviewed 148-file inventory.",
    );
  }
  const plan = buildGrandHallMatterportBoundaryReviewPlan(options.panoramaSourceRoot, inventory.files);
  const sheet = await renderGrandHallMatterportBoundaryContactSheet(
    plan,
    async (record) => await readGrandHallT554StablePanoramaBytes(
      record.absoluteSourcePath,
      record.source,
    ),
  );
  const reviewFormBytes = serializeJson(
    buildGrandHallMatterportBoundaryReviewForm(plan, inventory),
  );
  const readme = readmeBytes(inventory.inventorySha256);
  const preProvenanceDerivatives = [
    outputEvidence(
      GRAND_HALL_MATTERPORT_BOUNDARY_CONTACT_SHEET_FILENAME,
      "image/png",
      sheet.bytes,
    ),
    outputEvidence(
      GRAND_HALL_MATTERPORT_BOUNDARY_REVIEW_FORM_FILENAME,
      "application/json",
      reviewFormBytes,
    ),
    outputEvidence(
      GRAND_HALL_MATTERPORT_BOUNDARY_README_FILENAME,
      "text/markdown",
      readme,
    ),
  ];
  const material = provenanceMaterial(plan, inventory, sheet, preProvenanceDerivatives);
  const provenanceSha256 = provenanceDigest(toCanonicalJson(material));
  const provenanceBytes = serializeJson({ ...material, provenanceSha256 });
  const artifacts = new Map<string, Buffer>([
    [GRAND_HALL_MATTERPORT_BOUNDARY_CONTACT_SHEET_FILENAME, sheet.bytes],
    [GRAND_HALL_MATTERPORT_BOUNDARY_PROVENANCE_FILENAME, provenanceBytes],
    [GRAND_HALL_MATTERPORT_BOUNDARY_README_FILENAME, readme],
    [GRAND_HALL_MATTERPORT_BOUNDARY_REVIEW_FORM_FILENAME, reviewFormBytes],
  ]);
  const outputs = [
    ...preProvenanceDerivatives,
    outputEvidence(
      GRAND_HALL_MATTERPORT_BOUNDARY_PROVENANCE_FILENAME,
      "application/json",
      provenanceBytes,
    ),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  return {
    artifacts,
    result: {
      provenanceSha256,
      provenanceFileSha256: sha256(provenanceBytes),
      panoramaInventorySha256: inventory.inventorySha256,
      outputs,
      sourceRecordCount: GRAND_HALL_MATTERPORT_BOUNDARY_SOURCE_COUNT,
      allLabelsUnreviewed: true,
    },
  };
}

async function verifyAgainstBuilt(
  outputDirectory: string,
  built: BuiltBoundaryReview,
): Promise<void> {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right, "en"));
  const expectedNames = [...GRAND_HALL_MATTERPORT_BOUNDARY_OUTPUT_FILENAMES]
    .sort((left, right) => left.localeCompare(right, "en"));
  if (
    entries.some((entry) => !entry.isFile()) ||
    names.join("\n") !== expectedNames.join("\n")
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Boundary review output inventory is not exact.",
    );
  }
  for (const [relativePath, expectedBytes] of built.artifacts) {
    const persisted = await readFile(resolve(outputDirectory, relativePath));
    if (!persisted.equals(expectedBytes)) {
      throw new GrandHallT554PanoramaReviewError(
        "OUTPUT_VERIFICATION_FAILED",
        `${relativePath} differs from exact source regeneration.`,
      );
    }
  }
  const sheetBytes = built.artifacts.get(GRAND_HALL_MATTERPORT_BOUNDARY_CONTACT_SHEET_FILENAME);
  if (sheetBytes === undefined) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Boundary review contact sheet is missing from the exact build.",
    );
  }
  const metadata = await sharp(sheetBytes, {
    failOn: "error",
    limitInputPixels: SHEET_WIDTH_PX * SHEET_HEIGHT_PX,
  }).metadata();
  if (
    metadata.width !== SHEET_WIDTH_PX ||
    metadata.height !== SHEET_HEIGHT_PX ||
    metadata.channels !== 3
  ) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Boundary review contact sheet is not the declared RGB8 PNG.",
    );
  }
}

async function publishBuilt(
  outputDirectory: string,
  outputParent: string,
  built: BuiltBoundaryReview,
  testSeam: GrandHallMatterportBoundaryAtomicPublishTestSeam = {},
): Promise<void> {
  const temporaryDirectory = resolve(
    outputParent,
    `.${basename(outputDirectory)}.partial-${String(process.pid)}-${randomUUID()}`,
  );
  assertGrandHallMatterportBoundaryPartialDirectoryDirectChild(
    outputParent,
    outputDirectory,
    temporaryDirectory,
  );
  let temporaryDirectoryCreated = false;
  try {
    await mkdir(temporaryDirectory, { recursive: false });
    temporaryDirectoryCreated = true;
    await testSeam.afterTemporaryDirectoryCreated?.(temporaryDirectory);
    for (const [relativePath, bytes] of built.artifacts) {
      await writeFile(resolve(temporaryDirectory, relativePath), bytes, { flag: "wx" });
    }
    await verifyAgainstBuilt(temporaryDirectory, built);
    await rename(temporaryDirectory, outputDirectory);
    await verifyAgainstBuilt(outputDirectory, built);
  } catch (error) {
    if (temporaryDirectoryCreated) {
      assertGrandHallMatterportBoundaryPartialDirectoryDirectChild(
        outputParent,
        outputDirectory,
        temporaryDirectory,
      );
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    if (error instanceof GrandHallT554PanoramaReviewError) throw error;
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_PUBLISH_FAILED",
      "Boundary review evidence could not be published atomically.",
      error,
    );
  }
}

export async function __testOnlyPublishGrandHallMatterportBoundaryReview(
  outputDirectory: string,
  outputParent: string,
  built: {
    readonly artifacts: ReadonlyMap<string, Buffer>;
  },
  testSeam: GrandHallMatterportBoundaryAtomicPublishTestSeam,
): Promise<void> {
  const exactNames = [...built.artifacts.keys()]
    .sort((left, right) => left.localeCompare(right, "en"));
  const expectedNames = [...GRAND_HALL_MATTERPORT_BOUNDARY_OUTPUT_FILENAMES]
    .sort((left, right) => left.localeCompare(right, "en"));
  if (exactNames.join("\n") !== expectedNames.join("\n")) {
    throw new GrandHallT554PanoramaReviewError(
      "OUTPUT_VERIFICATION_FAILED",
      "Test-only atomic publication requires the exact fixed output filenames.",
    );
  }
  const placeholderResult: Omit<GrandHallMatterportBoundaryGeneratedReview, "outputDirectory"> = {
    provenanceSha256: sha256(Buffer.from("test-only-provenance-material", "utf8")),
    provenanceFileSha256: sha256(
      built.artifacts.get(GRAND_HALL_MATTERPORT_BOUNDARY_PROVENANCE_FILENAME) ?? Buffer.alloc(0),
    ),
    panoramaInventorySha256: GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
    outputs: [],
    sourceRecordCount: GRAND_HALL_MATTERPORT_BOUNDARY_SOURCE_COUNT,
    allLabelsUnreviewed: true,
  };
  await publishBuilt(
    outputDirectory,
    outputParent,
    { artifacts: built.artifacts, result: placeholderResult },
    testSeam,
  );
}

export async function generateGrandHallMatterportBoundaryReview(
  options: GenerateGrandHallMatterportBoundaryReviewOptions,
): Promise<GrandHallMatterportBoundaryGeneratedReview> {
  const safety = await assertGrandHallT554ReviewOutputSafety({
    sourceRoots: [options.panoramaSourceRoot],
    outputDirectory: options.outputDirectory,
  });
  const built = await buildFromSources(options);
  await publishBuilt(safety.outputDirectory, safety.outputParent, built);
  return { outputDirectory: safety.outputDirectory, ...built.result };
}

export async function checkGrandHallMatterportBoundaryReview(
  options: GenerateGrandHallMatterportBoundaryReviewOptions,
): Promise<GrandHallMatterportBoundaryGeneratedReview & { readonly exactRegenerationVerified: true }> {
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({
    sourceRoots: [options.panoramaSourceRoot],
    outputDirectory: options.outputDirectory,
  });
  const built = await buildFromSources(options);
  await verifyAgainstBuilt(safety.outputDirectory, built);
  return {
    outputDirectory: safety.outputDirectory,
    ...built.result,
    exactRegenerationVerified: true,
  };
}

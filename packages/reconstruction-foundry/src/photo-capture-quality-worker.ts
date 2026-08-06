import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { basename, dirname, extname, relative, sep } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { FoundryIntegrityError } from "./errors.js";
import {
  canonicalBundleRoot,
  resolveBundlePath,
} from "./path-safety.js";
import {
  FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0,
  FOUNDRY_RECEPTION_30_BUILD_SLOTS,
  FOUNDRY_RECEPTION_30_HELDOUT_SLOTS,
  FoundryPhotoCaptureQualityAssignmentV0Schema,
  FoundryPhotoCaptureQualityRoleV0Schema,
  compileFoundryPhotoCaptureQualityReportV0,
  type FoundryPhotoCaptureQualityIssueCodeV0,
  type FoundryPhotoCaptureQualityPhotoV0,
  type FoundryPhotoCaptureQualityReportV0,
  type FoundryPhotoCaptureQualityRoleV0,
} from "./photo-capture-quality-report.js";
import {
  FoundryUniversalIntakeReceiptSchema,
  type FoundryUniversalIntakeReceipt,
} from "./intake-receipt.js";

export const FOUNDRY_PHOTO_CAPTURE_QUALITY_MAX_SOURCE_BYTES =
  256 * 1_024 * 1_024;
export const FOUNDRY_PHOTO_CAPTURE_QUALITY_MAX_INPUT_PIXELS = 200_000_000;

const JPEG_EXTENSIONS = new Set([".jpg", ".jpeg"]);
const PNG_EXTENSIONS = new Set([".png"]);
const RAW_EXTENSIONS = new Set([
  ".3fr",
  ".arw",
  ".cr2",
  ".cr3",
  ".dng",
  ".erf",
  ".iiq",
  ".kdc",
  ".mef",
  ".mos",
  ".mrw",
  ".nef",
  ".nrw",
  ".orf",
  ".pef",
  ".raf",
  ".raw",
  ".rw2",
  ".sr2",
  ".srf",
]);
const SESSION_NOTE_EXTENSIONS = new Set([".md", ".txt"]);
const BUILD_SLOTS = new Set<string>(FOUNDRY_RECEPTION_30_BUILD_SLOTS);
const HELDOUT_SLOTS = new Set<string>(FOUNDRY_RECEPTION_30_HELDOUT_SLOTS);

export const FoundryPhotoCaptureQualityRequestedAssignmentV0Schema = z
  .object({
    path: z.string().trim().min(1).max(1_024),
    role: FoundryPhotoCaptureQualityRoleV0Schema,
  })
  .strict();
export type FoundryPhotoCaptureQualityRequestedAssignmentV0 = z.infer<
  typeof FoundryPhotoCaptureQualityRequestedAssignmentV0Schema
>;

export interface FoundryPhotoCaptureQualityCandidateV0 {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mediaType: "image/jpeg" | "image/png";
  readonly suggestedRole: FoundryPhotoCaptureQualityRoleV0;
  readonly protocolSlot: string | null;
}

export interface FoundryPhotoCaptureQualityWorkerProgressV0 {
  readonly completed: number;
  readonly total: number;
  readonly currentPath: string | null;
}

export interface RunFoundryPhotoCaptureQualityWorkerV0Options {
  readonly sourceRoot: string;
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly assignments: readonly FoundryPhotoCaptureQualityRequestedAssignmentV0[];
  readonly generatedAt?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (
    progress: FoundryPhotoCaptureQualityWorkerProgressV0,
  ) => void;
}

export interface FoundryPhotoCaptureQualityWorkerV0Result {
  readonly report: FoundryPhotoCaptureQualityReportV0;
  readonly thumbnails: ReadonlyMap<string, Buffer>;
}

interface DecodedPhoto {
  readonly assignment: z.infer<typeof FoundryPhotoCaptureQualityAssignmentV0Schema> & {
    readonly role: "build" | "heldout";
  };
  readonly imageId: string;
  readonly mediaType: "image/jpeg" | "image/png";
  readonly metrics: NonNullable<
    Extract<FoundryPhotoCaptureQualityPhotoV0["decode"], { status: "decoded" }>[
      "metrics"
    ]
  >;
  readonly thumbnail: NonNullable<
    Extract<FoundryPhotoCaptureQualityPhotoV0["decode"], { status: "decoded" }>[
      "thumbnail"
    ]
  >;
  readonly thumbnailBytes: Buffer;
  readonly rawCounterpartPaths: readonly string[];
  readonly baseIssues: readonly PhotoIssue[];
}

interface FailedPhoto {
  readonly assignment: z.infer<typeof FoundryPhotoCaptureQualityAssignmentV0Schema> & {
    readonly role: "build" | "heldout";
  };
  readonly imageId: string;
  readonly mediaType: "image/jpeg" | "image/png";
  readonly rawCounterpartPaths: readonly string[];
  readonly baseIssues: readonly PhotoIssue[];
}

interface PhotoIssue {
  readonly code: FoundryPhotoCaptureQualityIssueCodeV0;
  readonly severity: "review" | "retake";
  readonly guidance: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw new FoundryIntegrityError(
    "PHOTO_CAPTURE_QUALITY_CANCELLED",
    "The local photo capture-quality analysis was cancelled.",
  );
}

function lowerExtension(path: string): string {
  return extname(path).toLowerCase();
}

function mediaTypeFor(path: string): "image/jpeg" | "image/png" | null {
  const extension = lowerExtension(path);
  if (JPEG_EXTENSIONS.has(extension)) return "image/jpeg";
  if (PNG_EXTENSIONS.has(extension)) return "image/png";
  return null;
}

function hasExpectedMagic(
  magicHex: string,
  mediaType: "image/jpeg" | "image/png",
): boolean {
  return mediaType === "image/jpeg"
    ? magicHex.startsWith("ffd8ff")
    : magicHex.startsWith("89504e470d0a1a0a");
}

function normalizedStem(path: string): string {
  const leaf = basename(path);
  return leaf.slice(0, leaf.length - extname(leaf).length).toUpperCase();
}

export function classifyFoundryReceptionPilotPhotoNameV0(path: string): {
  readonly role: FoundryPhotoCaptureQualityRoleV0;
  readonly protocolSlot: string | null;
} {
  const stem = normalizedStem(path);
  if (BUILD_SLOTS.has(stem)) return { role: "build", protocolSlot: stem };
  if (HELDOUT_SLOTS.has(stem)) return { role: "heldout", protocolSlot: stem };
  return { role: "ignore", protocolSlot: null };
}

export function listFoundryPhotoCaptureQualityCandidatesV0(
  input: FoundryUniversalIntakeReceipt,
): readonly FoundryPhotoCaptureQualityCandidateV0[] {
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(input);
  return receipt.files
    .flatMap((file): FoundryPhotoCaptureQualityCandidateV0[] => {
      const mediaType = mediaTypeFor(file.path);
      if (mediaType === null || !hasExpectedMagic(file.inspection.magicHex, mediaType)) {
        return [];
      }
      const classification = classifyFoundryReceptionPilotPhotoNameV0(file.path);
      return [{
        path: file.path,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        mediaType,
        suggestedRole: classification.role,
        protocolSlot: classification.protocolSlot,
      }];
    })
    .sort((left, right) => compareText(left.path, right.path));
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return fromRoot === "" || (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !fromRoot.startsWith("../") &&
    !fromRoot.startsWith("..\\")
  );
}

async function readExactReceiptBytes(
  root: string,
  assignment: z.infer<typeof FoundryPhotoCaptureQualityAssignmentV0Schema>,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  throwIfCancelled(signal);
  const requestedPath = resolveBundlePath(root, assignment.path);
  const beforePath = await lstat(requestedPath);
  if (beforePath.isSymbolicLink() || !beforePath.isFile()) {
    throw new FoundryIntegrityError(
      "PHOTO_SOURCE_NOT_REGULAR",
      `The selected photo is no longer a regular file: ${assignment.path}`,
    );
  }
  if (
    beforePath.size !== assignment.sizeBytes ||
    beforePath.size > FOUNDRY_PHOTO_CAPTURE_QUALITY_MAX_SOURCE_BYTES
  ) {
    throw new FoundryIntegrityError(
      "PHOTO_SOURCE_SIZE_CHANGED",
      `The selected photo size changed or exceeds the local analysis bound: ${assignment.path}`,
    );
  }
  const canonicalPath = await realpath(requestedPath);
  if (!isWithin(root, canonicalPath)) {
    throw new FoundryIntegrityError(
      "PHOTO_SOURCE_PATH_ESCAPE",
      `The selected photo resolves outside the intake root: ${assignment.path}`,
    );
  }
  const handle = await open(canonicalPath, "r");
  try {
    const beforeHandle = await handle.stat();
    const afterOpenPath = await lstat(requestedPath);
    if (
      afterOpenPath.isSymbolicLink() ||
      !afterOpenPath.isFile() ||
      !sameFileIdentity(beforePath, beforeHandle) ||
      !sameFileIdentity(beforeHandle, afterOpenPath)
    ) {
      throw new FoundryIntegrityError(
        "PHOTO_SOURCE_CHANGED_BEFORE_READ",
        `The selected photo changed before it could be read: ${assignment.path}`,
      );
    }
    throwIfCancelled(signal);
    const bytes = await handle.readFile({ signal });
    throwIfCancelled(signal);
    const afterHandle = await handle.stat();
    const afterPath = await lstat(requestedPath);
    if (
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      !sameFileIdentity(beforeHandle, afterHandle) ||
      !sameFileIdentity(afterHandle, afterPath)
    ) {
      throw new FoundryIntegrityError(
        "PHOTO_SOURCE_CHANGED_DURING_READ",
        `The selected photo changed while it was being read: ${assignment.path}`,
      );
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== assignment.sizeBytes || sha256 !== assignment.sha256) {
      throw new FoundryIntegrityError(
        "PHOTO_SOURCE_RECEIPT_MISMATCH",
        `The selected photo no longer matches the intake receipt: ${assignment.path}`,
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(quantile * sorted.length));
  return sorted[index] ?? 0;
}

function tenengrad(luma: Float64Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let count = 0;
  const at = (x: number, y: number): number => luma[y * width + x] ?? 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const gx =
        -at(x - 1, y - 1) + at(x + 1, y - 1) +
        -2 * at(x - 1, y) + 2 * at(x + 1, y) +
        -at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      sum += gx * gx + gy * gy;
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

function hashDifferenceRows(grayscale: Uint8Array): string {
  let bits = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = grayscale[y * 9 + x] ?? 0;
      const right = grayscale[y * 9 + x + 1] ?? 0;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

function baseIssuesForMetrics(
  metrics: DecodedPhoto["metrics"],
  rawCounterpartPresent: boolean,
): PhotoIssue[] {
  const t = FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0;
  const issues: PhotoIssue[] = [];
  if (metrics.sourceMegapixels < t.minimumMegapixels) {
    issues.push({
      code: "resolution_too_low",
      severity: "retake",
      guidance: "Retake at a higher native resolution; this file is below the frozen 8 MP minimum for the pilot.",
    });
  } else if (metrics.sourceMegapixels < t.reviewMegapixels) {
    issues.push({
      code: "resolution_below_recommended",
      severity: "review",
      guidance: "Review at 100% and prefer a higher-resolution capture; this file is below the 12 MP review threshold.",
    });
  }
  if (metrics.tenengrad < t.retakeTenengrad) {
    issues.push({
      code: "severe_blur",
      severity: "retake",
      guidance: "Retake with locked focus and a steadier camera; edge energy is below the severe-blur threshold.",
    });
  } else if (metrics.tenengrad < t.reviewTenengrad) {
    issues.push({
      code: "possible_blur",
      severity: "review",
      guidance: "Inspect focus at 100%; edge energy is below the review threshold and may indicate blur or a texture-poor frame.",
    });
  }
  if (metrics.shadowClippedFraction >= t.retakeClippedFraction) {
    issues.push({
      code: "severe_shadow_clipping",
      severity: "retake",
      guidance: "Retake with more shadow detail; at least 12% of analysed luminance is clipped near black.",
    });
  } else if (metrics.shadowClippedFraction >= t.reviewClippedFraction) {
    issues.push({
      code: "shadow_clipping",
      severity: "review",
      guidance: "Review dark timber and corners; at least 3% of analysed luminance is clipped near black.",
    });
  }
  if (metrics.highlightClippedFraction >= t.retakeClippedFraction) {
    issues.push({
      code: "severe_highlight_clipping",
      severity: "retake",
      guidance: "Retake with lower exposure; at least 12% of analysed luminance is clipped near white.",
    });
  } else if (metrics.highlightClippedFraction >= t.reviewClippedFraction) {
    issues.push({
      code: "highlight_clipping",
      severity: "review",
      guidance: "Review windows and light fittings; at least 3% of analysed luminance is clipped near white.",
    });
  }
  if (metrics.lumaP50 <= t.retakeDarkMedian) {
    issues.push({
      code: "extreme_underexposure",
      severity: "retake",
      guidance: "Retake with corrected manual exposure; the median luminance is extremely dark.",
    });
  } else if (metrics.lumaP50 >= t.retakeBrightMedian) {
    issues.push({
      code: "extreme_overexposure",
      severity: "retake",
      guidance: "Retake with corrected manual exposure; the median luminance is extremely bright.",
    });
  }
  if (!rawCounterpartPresent) {
    issues.push({
      code: "raw_counterpart_missing",
      severity: "review",
      guidance: "Add the matching untouched RAW capture or record why this pilot image has no RAW counterpart.",
    });
  }
  return issues;
}

async function decodePhoto(
  bytes: Buffer,
  mediaType: "image/jpeg" | "image/png",
): Promise<{
  readonly metrics: DecodedPhoto["metrics"];
  readonly thumbnail: DecodedPhoto["thumbnail"];
  readonly thumbnailBytes: Buffer;
}> {
  const input = sharp(bytes, {
    failOn: "error",
    limitInputPixels: FOUNDRY_PHOTO_CAPTURE_QUALITY_MAX_INPUT_PIXELS,
    sequentialRead: true,
  });
  const metadata = await input.metadata();
  const expectedFormat = mediaType === "image/jpeg" ? "jpeg" : "png";
  if (
    metadata.format !== expectedFormat ||
    metadata.width < 1 ||
    metadata.height < 1
  ) {
    throw new Error("The payload format or dimensions do not match the selected image type.");
  }
  const analysis = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: FOUNDRY_PHOTO_CAPTURE_QUALITY_MAX_INPUT_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({
      width: FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.analysisMaxDimensionPx,
      height: FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.analysisMaxDimensionPx,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: { r: 127, g: 127, b: 127 } })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (analysis.info.channels !== 3) {
    throw new Error("The decoded image did not produce three-channel sRGB pixels.");
  }
  const pixelCount = analysis.info.width * analysis.info.height;
  const luma = new Float64Array(pixelCount);
  const sortedLuma = new Array<number>(pixelCount);
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let lumaSum = 0;
  let lumaSquaredSum = 0;
  let shadowCount = 0;
  let highlightCount = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 3;
    const red = (analysis.data[offset] ?? 0) / 255;
    const green = (analysis.data[offset + 1] ?? 0) / 255;
    const blue = (analysis.data[offset + 2] ?? 0) / 255;
    const value = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    redSum += red;
    greenSum += green;
    blueSum += blue;
    lumaSum += value;
    lumaSquaredSum += value * value;
    if (value <= 8 / 255) shadowCount += 1;
    if (value >= 247 / 255) highlightCount += 1;
    luma[index] = value;
    sortedLuma[index] = value;
  }
  sortedLuma.sort((left, right) => left - right);
  const lumaMean = lumaSum / pixelCount;
  const variance = Math.max(0, lumaSquaredSum / pixelCount - lumaMean * lumaMean);
  const hashPixels = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: FOUNDRY_PHOTO_CAPTURE_QUALITY_MAX_INPUT_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({ width: 9, height: 8, fit: "fill" })
    .flatten({ background: { r: 127, g: 127, b: 127 } })
    .greyscale()
    .raw()
    .toBuffer();
  const thumbnailOutput = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: FOUNDRY_PHOTO_CAPTURE_QUALITY_MAX_INPUT_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({
      width: FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.thumbnailMaxWidthPx,
      height: FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.thumbnailMaxHeightPx,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: { r: 28, g: 28, b: 27 } })
    .webp({ quality: 78, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  const metrics: DecodedPhoto["metrics"] = {
    sourceWidthPx: metadata.width,
    sourceHeightPx: metadata.height,
    sourceMegapixels: rounded((metadata.width * metadata.height) / 1_000_000),
    analysisWidthPx: analysis.info.width,
    analysisHeightPx: analysis.info.height,
    lumaMean: rounded(lumaMean),
    lumaStandardDeviation: rounded(Math.sqrt(variance)),
    lumaP05: rounded(percentile(sortedLuma, 0.05)),
    lumaP50: rounded(percentile(sortedLuma, 0.5)),
    lumaP95: rounded(percentile(sortedLuma, 0.95)),
    shadowClippedFraction: rounded(shadowCount / pixelCount),
    highlightClippedFraction: rounded(highlightCount / pixelCount),
    tenengrad: rounded(tenengrad(luma, analysis.info.width, analysis.info.height)),
    meanRgb: [
      rounded(redSum / pixelCount),
      rounded(greenSum / pixelCount),
      rounded(blueSum / pixelCount),
    ],
    differenceHash64: hashDifferenceRows(hashPixels),
  };
  return {
    metrics,
    thumbnail: {
      mediaType: "image/webp",
      widthPx: thumbnailOutput.info.width,
      heightPx: thumbnailOutput.info.height,
      sizeBytes: thumbnailOutput.data.byteLength,
      sha256: createHash("sha256").update(thumbnailOutput.data).digest("hex"),
    },
    thumbnailBytes: thumbnailOutput.data,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function colourMedian(
  photos: readonly DecodedPhoto[],
  role: "build" | "heldout",
): readonly [number, number, number] | null {
  const members = photos.filter((photo) => photo.assignment.role === role);
  if (members.length < 3) return null;
  return [
    median(members.map((photo) => photo.metrics.meanRgb[0])),
    median(members.map((photo) => photo.metrics.meanRgb[1])),
    median(members.map((photo) => photo.metrics.meanRgb[2])),
  ];
}

function colourDistance(
  value: readonly [number, number, number],
  reference: readonly [number, number, number],
): number {
  const squared = value.reduce((total, component, index) => {
    const delta = component - (reference[index] ?? 0);
    return total + delta * delta;
  }, 0);
  return Math.sqrt(squared) / Math.sqrt(3);
}

function hammingDistance64(left: string, right: string): number {
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (difference !== 0n) {
    count += Number(difference & 1n);
    difference >>= 1n;
  }
  return count;
}

function verdictFor(issues: readonly PhotoIssue[]): "pass" | "review" | "retake" {
  if (issues.some((issue) => issue.severity === "retake")) return "retake";
  return issues.length > 0 ? "review" : "pass";
}

function rawCounterparts(
  receipt: FoundryUniversalIntakeReceipt,
  photoPath: string,
): readonly string[] {
  const expectedDirectory = dirname(photoPath).replaceAll("\\", "/");
  const expectedStem = normalizedStem(photoPath);
  return receipt.files
    .filter((file) => {
      const fileDirectory = dirname(file.path).replaceAll("\\", "/");
      return fileDirectory === expectedDirectory &&
        normalizedStem(file.path) === expectedStem &&
        RAW_EXTENSIONS.has(lowerExtension(file.path));
    })
    .map((file) => file.path)
    .sort(compareText);
}

function candidateSessionNotes(
  receipt: FoundryUniversalIntakeReceipt,
): readonly string[] {
  return receipt.files
    .filter((file) => SESSION_NOTE_EXTENSIONS.has(lowerExtension(file.path)))
    .map((file) => file.path)
    .sort(compareText)
    .slice(0, 32);
}

function imageIdFor(path: string, sha256: string): string {
  return `photo-${createHash("sha256").update(`${path}\n${sha256}`, "utf8").digest("hex").slice(0, 24)}`;
}

function hydrateAssignments(
  receipt: FoundryUniversalIntakeReceipt,
  requestedInput: readonly FoundryPhotoCaptureQualityRequestedAssignmentV0[],
): readonly z.infer<typeof FoundryPhotoCaptureQualityAssignmentV0Schema>[] {
  const requested = z
    .array(FoundryPhotoCaptureQualityRequestedAssignmentV0Schema)
    .min(1)
    .max(500)
    .parse(requestedInput);
  const candidates = listFoundryPhotoCaptureQualityCandidatesV0(receipt);
  const candidateByPath = new Map(candidates.map((candidate) => [candidate.path, candidate] as const));
  const requestedPaths = requested.map((assignment) => assignment.path);
  if (
    new Set(requestedPaths).size !== requestedPaths.length ||
    requested.length !== candidates.length ||
    candidates.some((candidate) => !requestedPaths.includes(candidate.path))
  ) {
    throw new FoundryIntegrityError(
      "PHOTO_ASSIGNMENT_SET_MISMATCH",
      "Photo assignments must cover every eligible JPEG/PNG exactly once.",
    );
  }
  return requested
    .map((assignment) => {
      const candidate = candidateByPath.get(assignment.path);
      if (candidate === undefined) {
        throw new FoundryIntegrityError(
          "PHOTO_ASSIGNMENT_UNKNOWN_PATH",
          "A photo assignment is not bound to this intake receipt.",
        );
      }
      return FoundryPhotoCaptureQualityAssignmentV0Schema.parse({
        path: candidate.path,
        sha256: candidate.sha256,
        sizeBytes: candidate.sizeBytes,
        role: assignment.role,
        protocolSlot: candidate.protocolSlot,
      });
    })
    .sort((left, right) => compareText(left.path, right.path));
}

export async function runFoundryPhotoCaptureQualityWorkerV0(
  options: RunFoundryPhotoCaptureQualityWorkerV0Options,
): Promise<FoundryPhotoCaptureQualityWorkerV0Result> {
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(options.receipt);
  if (receipt.source.kind !== "directory") {
    throw new FoundryIntegrityError(
      "PHOTO_WORKBENCH_REQUIRES_DIRECTORY",
      "The photo capture-quality workbench requires one selected folder.",
    );
  }
  const root = await canonicalBundleRoot(options.sourceRoot);
  if (basename(root) !== receipt.source.label) {
    throw new FoundryIntegrityError(
      "PHOTO_SOURCE_ROOT_LABEL_MISMATCH",
      "The selected photo folder no longer matches the intake receipt.",
    );
  }
  const assignments = hydrateAssignments(receipt, options.assignments);
  const activeAssignments = assignments.filter(
    (assignment): assignment is typeof assignment & { role: "build" | "heldout" } =>
      assignment.role !== "ignore",
  );
  const decoded: DecodedPhoto[] = [];
  const failed: FailedPhoto[] = [];
  const thumbnails = new Map<string, Buffer>();
  options.onProgress?.({ completed: 0, total: activeAssignments.length, currentPath: null });
  for (const [index, assignment] of activeAssignments.entries()) {
    throwIfCancelled(options.signal);
    options.onProgress?.({
      completed: index,
      total: activeAssignments.length,
      currentPath: assignment.path,
    });
    const mediaType = mediaTypeFor(assignment.path);
    if (mediaType === null) {
      throw new FoundryIntegrityError(
        "PHOTO_ASSIGNMENT_MEDIA_TYPE_MISMATCH",
        "An assigned photo no longer has an eligible media type.",
      );
    }
    const counterpartPaths = rawCounterparts(receipt, assignment.path);
    const imageId = imageIdFor(assignment.path, assignment.sha256);
    const bytes = await readExactReceiptBytes(root, assignment, options.signal);
    throwIfCancelled(options.signal);
    try {
      const output = await decodePhoto(bytes, mediaType);
      throwIfCancelled(options.signal);
      const baseIssues = baseIssuesForMetrics(
        output.metrics,
        counterpartPaths.length > 0,
      );
      decoded.push({
        assignment,
        imageId,
        mediaType,
        metrics: output.metrics,
        thumbnail: output.thumbnail,
        thumbnailBytes: output.thumbnailBytes,
        rawCounterpartPaths: counterpartPaths,
        baseIssues,
      });
      thumbnails.set(imageId, output.thumbnailBytes);
    } catch (error: unknown) {
      throwIfCancelled(options.signal);
      if (error instanceof FoundryIntegrityError) throw error;
      const issues: PhotoIssue[] = [{
        code: "decode_failed",
        severity: "retake",
        guidance: "Replace or re-export this file from the untouched camera original; its JPEG/PNG pixels could not be decoded.",
      }];
      if (counterpartPaths.length === 0) {
        issues.push({
          code: "raw_counterpart_missing",
          severity: "review",
          guidance: "Add the matching untouched RAW capture or record why this pilot image has no RAW counterpart.",
        });
      }
      failed.push({
        assignment,
        imageId,
        mediaType,
        rawCounterpartPaths: counterpartPaths,
        baseIssues: issues,
      });
    }
    options.onProgress?.({
      completed: index + 1,
      total: activeAssignments.length,
      currentPath: null,
    });
  }
  const roleMedians = {
    build: colourMedian(decoded, "build"),
    heldout: colourMedian(decoded, "heldout"),
  } as const;
  const photos: FoundryPhotoCaptureQualityPhotoV0[] = [];
  for (const assignment of activeAssignments) {
    const decodedPhoto = decoded.find((photo) => photo.assignment.path === assignment.path);
    if (decodedPhoto !== undefined) {
      const medianRgb = roleMedians[assignment.role];
      const distance = medianRgb === null
        ? null
        : rounded(colourDistance(decodedPhoto.metrics.meanRgb, medianRgb));
      const issues = [...decodedPhoto.baseIssues];
      if (
        distance !== null &&
        distance >= FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.reviewColourDistance
      ) {
        issues.push({
          code: "colour_balance_outlier",
          severity: "review",
          guidance: "Review white balance and lighting consistency; average colour differs materially from this role's median capture.",
        });
      }
      photos.push({
        imageId: decodedPhoto.imageId,
        source: decodedPhoto.assignment,
        decode: {
          status: "decoded",
          mediaType: decodedPhoto.mediaType,
          metrics: decodedPhoto.metrics,
          thumbnail: decodedPhoto.thumbnail,
        },
        rawCounterpart: decodedPhoto.rawCounterpartPaths.length > 0
          ? { state: "present_unreviewed", paths: [...decodedPhoto.rawCounterpartPaths] }
          : { state: "missing", paths: [] },
        colourDistanceFromRoleMedian: distance,
        issues,
        verdict: verdictFor(issues),
      });
      continue;
    }
    const failedPhoto = failed.find((photo) => photo.assignment.path === assignment.path);
    if (failedPhoto === undefined) {
      throw new FoundryIntegrityError(
        "PHOTO_ANALYSIS_RESULT_MISSING",
        "A selected photo produced no bounded analysis result.",
      );
    }
    photos.push({
      imageId: failedPhoto.imageId,
      source: failedPhoto.assignment,
      decode: {
        status: "decode_failed",
        mediaType: failedPhoto.mediaType,
        failureCode: "unsupported_or_corrupt_pixel_payload",
        metrics: null,
        thumbnail: null,
      },
      rawCounterpart: failedPhoto.rawCounterpartPaths.length > 0
        ? { state: "present_unreviewed", paths: [...failedPhoto.rawCounterpartPaths] }
        : { state: "missing", paths: [] },
      colourDistanceFromRoleMedian: null,
      issues: [...failedPhoto.baseIssues],
      verdict: verdictFor(failedPhoto.baseIssues),
    });
  }
  const similarityFindings: Array<{
    leftImageId: string;
    rightImageId: string;
    kind: "within_role_near_duplicate" | "cross_role_holdout_overlap_risk";
    hammingDistance: number;
    guidance: string;
  }> = [];
  for (let leftIndex = 0; leftIndex < decoded.length; leftIndex += 1) {
    const left = decoded[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < decoded.length; rightIndex += 1) {
      const right = decoded[rightIndex];
      if (right === undefined) continue;
      const distance = hammingDistance64(
        left.metrics.differenceHash64,
        right.metrics.differenceHash64,
      );
      if (distance > FOUNDRY_PHOTO_CAPTURE_QUALITY_THRESHOLDS_V0.nearDuplicateHammingMax) {
        continue;
      }
      const crossesRoles = left.assignment.role !== right.assignment.role;
      similarityFindings.push({
        leftImageId: left.imageId,
        rightImageId: right.imageId,
        kind: crossesRoles
          ? "cross_role_holdout_overlap_risk"
          : "within_role_near_duplicate",
        hammingDistance: distance,
        guidance: crossesRoles
          ? "Review the split: a build and held-out frame have nearly identical low-frequency structure, which may weaken the independence of the test set."
          : "Review both frames at full resolution and retake from a more distinct position if they do not add useful parallax or coverage.",
      });
    }
  }
  throwIfCancelled(options.signal);
  const report = compileFoundryPhotoCaptureQualityReportV0({
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sourceReceiptSha256: receipt.receiptSha256,
    assignments,
    photos,
    similarityFindings,
    candidateSessionNotePaths: candidateSessionNotes(receipt),
  });
  return { report, thumbnails };
}

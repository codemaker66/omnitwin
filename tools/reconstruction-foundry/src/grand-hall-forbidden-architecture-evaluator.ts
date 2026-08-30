import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, mkdtemp, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFoundryRestorationSemanticResultV0,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import sharp from "sharp";
import { z } from "zod";

export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONFIGURATION_SCHEMA =
  "venviewer.grand-hall.forbidden-architecture-configuration.v1";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_RUNTIME_SCHEMA =
  "venviewer.grand-hall.forbidden-architecture-runtime.v1";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_MATERIALS_RECEIPT_SCHEMA =
  "venviewer.grand-hall.forbidden-architecture-materials-receipt.v1";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_EVIDENCE_SCHEMA =
  "venviewer.grand-hall.forbidden-architecture-evidence.v1";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_PUBLICATION_RECEIPT_SCHEMA =
  "venviewer.grand-hall.forbidden-architecture-publication-receipt.v1";

export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONFIGURATION_FILENAME =
  "forbidden-architecture-configuration.json";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_RUNTIME_FILENAME =
  "forbidden-architecture-runtime.json";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_MATERIALS_RECEIPT_FILENAME =
  "publication-receipt.json";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_SOURCE_OVERLAY_FILENAME =
  "source-difference-overlay.png";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_CANDIDATE_OVERLAY_FILENAME =
  "candidate-difference-overlay.png";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_HEATMAP_FILENAME =
  "difference-heatmap.png";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONTACT_SHEET_FILENAME =
  "source-candidate-contact-sheet.png";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_SEMANTIC_RESULT_FILENAME =
  "semantic-result.not-evaluated.json";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_EVIDENCE_FILENAME =
  "review-evidence.json";
export const GRAND_HALL_FORBIDDEN_ARCHITECTURE_PUBLICATION_RECEIPT_FILENAME =
  "publication-receipt.json";

const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_PIXELS = 100_000_000;
const EXECUTING_IMPLEMENTATION_PATH = fileURLToPath(import.meta.url);
const moduleRequire = createRequire(import.meta.url);
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const AbsolutePathSchema = z.string().min(3).max(4_096).refine(isAbsolute, "path must be absolute");
const SafeFileNameSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,179}$/u);

export const GrandHallForbiddenArchitectureConfigurationSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONFIGURATION_SCHEMA),
  authority: z.literal("none"),
  comparison: z.object({
    colorChannels: z.literal("srgb_rgb_bytes"),
    resizeAllowed: z.literal(false),
    differenceThreshold: z.literal(0),
    outsideGeneratedRegionColor: z.tuple([z.literal(255), z.literal(0), z.literal(255)]),
    insideGeneratedRegionColor: z.tuple([z.literal(255), z.literal(191), z.literal(0)]),
    maximumOverlayAlpha: z.literal(160),
    contactSheetGapPixels: z.literal(8),
  }).strict(),
  forbiddenReviewClasses: z.tuple([
    z.literal("invented_window"),
    z.literal("invented_doorway"),
    z.literal("dark_central_floor"),
    z.literal("neighbouring_room"),
    z.literal("facade"),
    z.literal("generated_fill_outside_mask"),
  ]),
  semanticDecisionPolicy: z.literal("qualified_human_review_required"),
  automaticSemanticDetectionPermitted: z.literal(false),
  zeroDetectionsMayBeInferredFromPixelDifference: z.literal(false),
  expectedInputs: z.object({
    source: z.object({
      sizeBytes: z.number().int().positive(),
      sha256: Sha256Schema,
      width: z.number().int().positive().max(65_536),
      height: z.number().int().positive().max(65_536),
    }).strict(),
    protectedMask: z.object({
      role: z.literal("protected_region"),
      semantics: z.literal("white_255_means_protected"),
      sizeBytes: z.number().int().positive(),
      sha256: Sha256Schema,
      width: z.number().int().positive().max(65_536),
      height: z.number().int().positive().max(65_536),
      whitePixelCount: z.number().int().nonnegative(),
    }).strict(),
    generatedRegionMask: z.object({
      role: z.literal("generated_region"),
      semantics: z.literal("white_255_means_generated_region"),
      sizeBytes: z.number().int().positive(),
      sha256: Sha256Schema,
      width: z.number().int().positive().max(65_536),
      height: z.number().int().positive().max(65_536),
      whitePixelCount: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
}).strict();
export type GrandHallForbiddenArchitectureConfiguration = z.infer<
  typeof GrandHallForbiddenArchitectureConfigurationSchema
>;

const BASE_CONFIGURATION = {
  schemaVersion: GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONFIGURATION_SCHEMA,
  authority: "none",
  comparison: {
    colorChannels: "srgb_rgb_bytes",
    resizeAllowed: false,
    differenceThreshold: 0,
    outsideGeneratedRegionColor: [255, 0, 255],
    insideGeneratedRegionColor: [255, 191, 0],
    maximumOverlayAlpha: 160,
    contactSheetGapPixels: 8,
  },
  forbiddenReviewClasses: [
    "invented_window",
    "invented_doorway",
    "dark_central_floor",
    "neighbouring_room",
    "facade",
    "generated_fill_outside_mask",
  ],
  semanticDecisionPolicy: "qualified_human_review_required",
  automaticSemanticDetectionPermitted: false,
  zeroDetectionsMayBeInferredFromPixelDifference: false,
} as const;

const FileReceiptSchema = z.object({
  fileName: SafeFileNameSchema,
  sizeBytes: z.number().int().positive(),
  sha256: Sha256Schema,
}).strict();

export const GrandHallForbiddenArchitectureRuntimeSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_FORBIDDEN_ARCHITECTURE_RUNTIME_SCHEMA),
  authority: z.literal("none"),
  implementation: z.object({
    preparedFromPath: AbsolutePathSchema,
    sizeBytes: z.number().int().positive(),
    sha256: Sha256Schema,
  }).strict(),
  nodeVersion: z.string().min(1),
  sharpVersion: z.string().min(1),
  zodVersion: z.string().min(1),
  configurationSha256: Sha256Schema,
  platform: z.string().min(1),
  architecture: z.string().min(1),
  execution: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("typescript_via_tsx"),
      tsxVersion: z.string().min(1),
      typescriptVersion: z.string().min(1),
    }).strict(),
    z.object({
      mode: z.literal("compiled_javascript"),
      tsxVersion: z.null(),
      typescriptVersion: z.null(),
    }).strict(),
  ]),
  networkRequired: z.literal(false),
  modelRequired: z.literal(false),
  automaticSemanticDetectionAvailable: z.literal(false),
}).strict();
export type GrandHallForbiddenArchitectureRuntime = z.infer<
  typeof GrandHallForbiddenArchitectureRuntimeSchema
>;

export const GrandHallForbiddenArchitectureMaterialsReceiptSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_FORBIDDEN_ARCHITECTURE_MATERIALS_RECEIPT_SCHEMA),
  authority: z.literal("none"),
  receiptWrittenLast: z.literal(true),
  implementation: z.object({
    preparedFromPath: AbsolutePathSchema,
    sizeBytes: z.number().int().positive(),
    sha256: Sha256Schema,
  }).strict(),
  configuration: FileReceiptSchema.extend({
    fileName: z.literal(GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONFIGURATION_FILENAME),
  }).strict(),
  runtime: FileReceiptSchema.extend({
    fileName: z.literal(GRAND_HALL_FORBIDDEN_ARCHITECTURE_RUNTIME_FILENAME),
  }).strict(),
}).strict();

export const GrandHallForbiddenArchitectureEvidenceSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_FORBIDDEN_ARCHITECTURE_EVIDENCE_SCHEMA),
  authority: z.literal("none"),
  semanticStatus: z.literal("not_evaluated"),
  semanticUncertainty: z.literal("unknown"),
  humanReviewRequired: z.literal(true),
  automaticSemanticDetectionPerformed: z.literal(false),
  semanticDetections: z.null(),
  source: FileReceiptSchema,
  candidate: FileReceiptSchema,
  protectedMask: FileReceiptSchema,
  generatedRegionMask: FileReceiptSchema,
  implementationSha256: Sha256Schema,
  configurationSha256: Sha256Schema,
  runtimeEnvironmentSha256: Sha256Schema,
  width: z.number().int().positive().max(65_536),
  height: z.number().int().positive().max(65_536),
  changedPixelCount: z.number().int().nonnegative(),
  changedOutsideGeneratedRegionPixelCount: z.number().int().nonnegative(),
  maximumChannelDifference: z.number().int().min(0).max(255),
  outputs: z.object({
    sourceOverlay: FileReceiptSchema,
    candidateOverlay: FileReceiptSchema,
    heatmap: FileReceiptSchema,
    contactSheet: FileReceiptSchema,
    semanticResult: FileReceiptSchema,
  }).strict(),
  limitations: z.tuple([
    z.literal("Pixel differences are review navigation evidence, not semantic detections."),
    z.literal("No automated claim is made about windows, doorways, floor appearance, neighbouring rooms, facade, or generated fill."),
    z.literal("A qualified human must review the fixed-camera evidence before any semantic result can become evaluated."),
  ]),
}).strict().superRefine((value, ctx) => {
  if (value.changedOutsideGeneratedRegionPixelCount > value.changedPixelCount) {
    ctx.addIssue({ code: "custom", path: ["changedOutsideGeneratedRegionPixelCount"], message: "outside-mask changes cannot exceed total changed pixels" });
  }
});

export const GrandHallForbiddenArchitecturePublicationReceiptSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_FORBIDDEN_ARCHITECTURE_PUBLICATION_RECEIPT_SCHEMA),
  authority: z.literal("none"),
  outputState: z.literal("complete_not_evaluated_human_review_required"),
  receiptWrittenLast: z.literal(true),
  evidence: FileReceiptSchema.extend({
    fileName: z.literal(GRAND_HALL_FORBIDDEN_ARCHITECTURE_EVIDENCE_FILENAME),
  }).strict(),
  filesBeforeReceipt: z.array(FileReceiptSchema).length(6),
}).strict();

export interface PrepareGrandHallForbiddenArchitectureEvaluatorOptions {
  readonly implementationPath: string;
  readonly sourceImagePath: string;
  readonly protectedMaskPath: string;
  readonly generatedRegionMaskPath: string;
  readonly width: number;
  readonly height: number;
  readonly outputDirectory: string;
  readonly testHooks?: GrandHallForbiddenArchitectureEvaluatorTestHooks;
}

export interface RunGrandHallForbiddenArchitectureEvaluatorOptions {
  readonly sourceImagePath: string;
  readonly candidateImagePath: string;
  readonly protectedMaskPath: string;
  readonly generatedRegionMaskPath: string;
  readonly implementationPath: string;
  readonly configurationPath: string;
  readonly runtimePath: string;
  readonly outputDirectory: string;
  readonly testHooks?: GrandHallForbiddenArchitectureEvaluatorTestHooks;
}

export interface GrandHallForbiddenArchitectureEvaluatorTestHooks {
  readonly afterStagingClaimed?: (context: {
    readonly stagingDirectory: string;
    readonly targetDirectory: string;
  }) => Promise<void> | void;
  readonly afterPublishedIdentityRead?: (context: {
    readonly targetDirectory: string;
    readonly publishedIdentity: string;
  }) => Promise<void> | void;
}

interface StableFile {
  readonly absolutePath: string;
  readonly bytes: Buffer;
  readonly sizeBytes: number;
  readonly sha256: `sha256:${string}`;
  readonly identity: string;
}

interface PendingFile {
  readonly receipt: z.infer<typeof FileReceiptSchema>;
  readonly bytes: Buffer;
}

interface DecodedRgb {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

interface DecodedMask {
  readonly data: Buffer;
  readonly whitePixelCount: number;
}

export class GrandHallForbiddenArchitectureEvaluatorError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "INPUT_RACE" | "OUTPUT_EXISTS" | "OUTPUT_INVALID", message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallForbiddenArchitectureEvaluatorError";
  }
}

function fail(
  code: GrandHallForbiddenArchitectureEvaluatorError["code"],
  message: string,
  cause?: unknown,
): never {
  throw new GrandHallForbiddenArchitectureEvaluatorError(code, message, cause);
}

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function canonicalPath(value: string, label: string): string {
  if (!isAbsolute(value)) fail("INPUT_INVALID", `${label} must be absolute.`);
  const path = resolve(value);
  if (path !== normalize(value)) fail("INPUT_INVALID", `${label} must be normalized and traversal-free.`);
  return path;
}

function samePath(left: string, right: string): boolean {
  const comparable = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
  return comparable(resolve(left)) === comparable(resolve(right));
}

function packageVersion(packageName: "tsx" | "typescript" | "zod"): string {
  const value: unknown = moduleRequire(`${packageName}/package.json`);
  return z.object({ version: z.string().min(1) }).parse(value).version;
}

function currentExecutionDescriptor(): z.infer<typeof GrandHallForbiddenArchitectureRuntimeSchema>["execution"] {
  return extname(EXECUTING_IMPLEMENTATION_PATH) === ".ts"
    ? {
        mode: "typescript_via_tsx",
        tsxVersion: packageVersion("tsx"),
        typescriptVersion: packageVersion("typescript"),
      }
    : { mode: "compiled_javascript", tsxVersion: null, typescriptVersion: null };
}

function identity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(":");
}

function directoryIdentity(stats: BigIntStats): string {
  return [stats.dev, stats.ino].map(String).join(":");
}

async function stableRead(pathInput: string, label: string): Promise<StableFile> {
  const absolutePath = canonicalPath(pathInput, label);
  const physical = await realpath(absolutePath).catch((error: unknown) => fail("INPUT_INVALID", `${label} cannot be resolved.`, error));
  if (!samePath(physical, absolutePath)) fail("INPUT_INVALID", `${label} must not traverse a link or junction.`);
  const before = await lstat(absolutePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size <= 0n || before.size > BigInt(MAX_INPUT_BYTES)) {
    fail("INPUT_INVALID", `${label} must be a direct, single-link, non-empty regular file within the byte limit.`);
  }
  const handle = await open(absolutePath, "r");
  try {
    const openedBefore = await handle.stat({ bigint: true });
    if (identity(openedBefore) !== identity(before)) fail("INPUT_RACE", `${label} changed while opening.`);
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const after = await lstat(absolutePath, { bigint: true });
    if (identity(openedBefore) !== identity(openedAfter) || identity(openedAfter) !== identity(after) || bytes.byteLength !== Number(after.size)) {
      fail("INPUT_RACE", `${label} changed while reading.`);
    }
    return { absolutePath, bytes, sizeBytes: bytes.byteLength, sha256: sha256(bytes), identity: identity(after) };
  } finally {
    await handle.close();
  }
}

async function requireUnchanged(file: StableFile, label: string): Promise<void> {
  const repeated = await stableRead(file.absolutePath, label);
  if (repeated.identity !== file.identity || repeated.sha256 !== file.sha256 || !repeated.bytes.equals(file.bytes)) {
    fail("INPUT_RACE", `${label} changed after validation.`);
  }
}

function rejectProhibitedJsonKeys(value: unknown, label: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const member of value) rejectProhibitedJsonKeys(member, label);
    return;
  }
  for (const [key, member] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      fail("INPUT_INVALID", `${label} contains a prohibited object key.`);
    }
    rejectProhibitedJsonKeys(member, label);
  }
}

function parseCanonicalJson(file: StableFile, label: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(file.bytes.toString("utf8"));
  } catch (error: unknown) {
    return fail("INPUT_INVALID", `${label} is not valid JSON.`, error);
  }
  rejectProhibitedJsonKeys(value, label);
  if (!file.bytes.equals(canonicalBytes(value))) fail("INPUT_INVALID", `${label} must be canonical JSON with one LF terminator.`);
  return value;
}

function pending(fileName: string, bytes: Buffer): PendingFile {
  return { receipt: { fileName, sizeBytes: bytes.byteLength, sha256: sha256(bytes) }, bytes };
}

function pendingJson(fileName: string, value: unknown): PendingFile {
  return pending(fileName, canonicalBytes(value));
}

interface ClaimedStagingDirectory {
  readonly target: string;
  readonly staging: string;
  readonly identity: string;
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
    fail("OUTPUT_EXISTS", "Output directory must be absent.");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function claimStagingDirectory(pathInput: string): Promise<ClaimedStagingDirectory> {
  const target = canonicalPath(pathInput, "Output directory");
  const parent = dirname(target);
  if (!samePath(parent, await realpath(parent))) fail("INPUT_INVALID", "Output parent must not traverse a link or junction.");
  await requireAbsent(target);
  const staging = await mkdtemp(join(parent, `.${basename(target)}.staging-`));
  const metadata = await lstat(staging, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(staging, await realpath(staging))) {
    fail("OUTPUT_INVALID", "Claimed staging directory must be direct.");
  }
  return { target, staging, identity: directoryIdentity(metadata) };
}

async function requireStagingIdentity(claim: ClaimedStagingDirectory): Promise<void> {
  const metadata = await lstat(claim.staging, { bigint: true }).catch((error: unknown) =>
    fail("OUTPUT_INVALID", "Claimed staging directory disappeared.", error));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || directoryIdentity(metadata) !== claim.identity ||
      !samePath(claim.staging, await realpath(claim.staging))) {
    fail("OUTPUT_INVALID", "Claimed staging directory identity changed.");
  }
}

async function writeExclusive(claim: ClaimedStagingDirectory, file: PendingFile): Promise<void> {
  await requireStagingIdentity(claim);
  const path = resolve(claim.staging, file.receipt.fileName);
  if (dirname(path) !== claim.staging) fail("OUTPUT_INVALID", "Unsafe output file name.");
  const handle = await open(path, "wx", 0o600).catch((error: unknown) => fail("OUTPUT_EXISTS", `${file.receipt.fileName} already exists.`, error));
  try {
    await handle.writeFile(file.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await requireStagingIdentity(claim);
}

async function stablePublishedDirectory(
  claim: ClaimedStagingDirectory,
  hook?: GrandHallForbiddenArchitectureEvaluatorTestHooks["afterPublishedIdentityRead"],
): Promise<void> {
  const before = await lstat(claim.target, { bigint: true }).catch((error: unknown) =>
    fail("OUTPUT_INVALID", "Published output directory is unavailable.", error));
  await hook?.({ targetDirectory: claim.target, publishedIdentity: directoryIdentity(before) });
  const physical = await realpath(claim.target).catch((error: unknown) =>
    fail("OUTPUT_INVALID", "Published output directory cannot be resolved.", error));
  const after = await lstat(claim.target, { bigint: true }).catch((error: unknown) =>
    fail("OUTPUT_INVALID", "Published output directory disappeared during verification.", error));
  if (!before.isDirectory() || before.isSymbolicLink() || !after.isDirectory() || after.isSymbolicLink() ||
      directoryIdentity(before) !== claim.identity || directoryIdentity(after) !== claim.identity ||
      !samePath(claim.target, physical)) {
    fail("OUTPUT_INVALID", "Published output identity differs from verified staging.");
  }
}

async function publishStagingDirectory(
  claim: ClaimedStagingDirectory,
  hook?: GrandHallForbiddenArchitectureEvaluatorTestHooks["afterPublishedIdentityRead"],
): Promise<void> {
  await requireStagingIdentity(claim);
  await requireAbsent(claim.target);
  await rename(claim.staging, claim.target).catch((error: unknown) =>
    fail("OUTPUT_EXISTS", "Atomic output publication lost its absent-target race.", error));
  await stablePublishedDirectory(claim, hook);
}

async function cleanupStagingDirectory(claim: ClaimedStagingDirectory): Promise<void> {
  try {
    await requireStagingIdentity(claim);
    await rm(claim.staging, { recursive: true, force: false });
  } catch {
    // Never remove a path after its identity diverges from our staging directory.
  }
}

async function exactInventory(directory: string, expected: readonly string[]): Promise<void> {
  const actual = (await readdir(directory)).sort();
  const wanted = [...expected].sort();
  if (stableCanonicalJson(actual) !== stableCanonicalJson(wanted)) fail("OUTPUT_INVALID", "Output inventory is incomplete or contains unexpected files.");
}

async function decodeRgb(file: StableFile, label: string): Promise<DecodedRgb> {
  const metadata = await sharp(file.bytes, { failOn: "error", limitInputPixels: MAX_PIXELS, sequentialRead: true }).metadata()
    .catch((error: unknown) => fail("INPUT_INVALID", `${label} metadata could not be decoded.`, error));
  if (metadata.format !== "png" || metadata.pages !== undefined && metadata.pages !== 1 || metadata.channels !== 3 || metadata.hasAlpha ||
      metadata.hasProfile || metadata.orientation !== undefined || metadata.space !== "srgb" || metadata.depth !== "uchar") {
    fail("INPUT_INVALID", `${label} must be a single-page opaque three-channel 8-bit sRGB PNG.`);
  }
  const decoded = await sharp(file.bytes, { failOn: "error", limitInputPixels: MAX_PIXELS, sequentialRead: true })
    .toColourspace("srgb").raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  if (decoded.info.channels !== 3 || decoded.info.width < 1 || decoded.info.height < 1) fail("INPUT_INVALID", `${label} must decode to an RGB image.`);
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height };
}

async function decodeMask(file: StableFile, width: number, height: number, label: string): Promise<DecodedMask> {
  const metadata = await sharp(file.bytes, { failOn: "error", limitInputPixels: MAX_PIXELS, sequentialRead: true }).metadata()
    .catch((error: unknown) => fail("INPUT_INVALID", `${label} metadata could not be decoded.`, error));
  if (metadata.format !== "png" || metadata.width !== width || metadata.height !== height ||
      metadata.pages !== undefined && metadata.pages !== 1 || metadata.channels !== 1 || metadata.hasAlpha ||
      metadata.hasProfile || metadata.orientation !== undefined || metadata.space !== "b-w" || metadata.depth !== "uchar") {
    fail("INPUT_INVALID", `${label} must be a single-page one-channel binary 8-bit grayscale PNG at the exact expected extent.`);
  }
  const decoded = await sharp(file.bytes, { failOn: "error", limitInputPixels: MAX_PIXELS, sequentialRead: true })
    .toColourspace("b-w").raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  if (decoded.info.channels !== 1 || decoded.info.width !== width || decoded.info.height !== height) {
    fail("INPUT_INVALID", `${label} dimensions must match the exact source/candidate extent.`);
  }
  let whitePixelCount = 0;
  for (const value of decoded.data) {
    if (value !== 0 && value !== 255) fail("INPUT_INVALID", `${label} must be exactly binary (0 or 255).`);
    if (value === 255) whitePixelCount += 1;
  }
  return { data: decoded.data, whitePixelCount };
}

function buildDifferenceVisuals(
  source: DecodedRgb,
  candidate: DecodedRgb,
  protectedMask: Buffer,
  generatedMask: Buffer,
  configuration: GrandHallForbiddenArchitectureConfiguration,
): { readonly sourceOverlay: Buffer; readonly candidateOverlay: Buffer; readonly heatmap: Buffer; readonly changedPixelCount: number; readonly changedOutsideGeneratedRegionPixelCount: number; readonly maximumChannelDifference: number } {
  const sourceOverlay = Buffer.from(source.data);
  const candidateOverlay = Buffer.from(candidate.data);
  const heatmap = Buffer.alloc(source.data.length);
  let changedPixelCount = 0;
  let changedOutsideGeneratedRegionPixelCount = 0;
  let maximumChannelDifference = 0;
  for (let pixel = 0; pixel < protectedMask.length; pixel += 1) {
    const offset = pixel * 3;
    const maximumDifference = Math.max(
      Math.abs((source.data[offset] ?? 0) - (candidate.data[offset] ?? 0)),
      Math.abs((source.data[offset + 1] ?? 0) - (candidate.data[offset + 1] ?? 0)),
      Math.abs((source.data[offset + 2] ?? 0) - (candidate.data[offset + 2] ?? 0)),
    );
    maximumChannelDifference = Math.max(maximumChannelDifference, maximumDifference);
    const changed = protectedMask[pixel] !== 0 && maximumDifference > configuration.comparison.differenceThreshold;
    if (!changed) continue;
    changedPixelCount += 1;
    const generated = generatedMask[pixel] !== 0;
    if (!generated) changedOutsideGeneratedRegionPixelCount += 1;
    const color = generated
      ? configuration.comparison.insideGeneratedRegionColor
      : configuration.comparison.outsideGeneratedRegionColor;
    const alpha = Math.round(configuration.comparison.maximumOverlayAlpha * maximumDifference / 255);
    for (let channel = 0; channel < 3; channel += 1) {
      const colorValue = color[channel] ?? 0;
      sourceOverlay[offset + channel] = Math.round(((sourceOverlay[offset + channel] ?? 0) * (255 - alpha) + colorValue * alpha) / 255);
      candidateOverlay[offset + channel] = Math.round(((candidateOverlay[offset + channel] ?? 0) * (255 - alpha) + colorValue * alpha) / 255);
      heatmap[offset + channel] = Math.round(colorValue * maximumDifference / 255);
    }
  }
  return { sourceOverlay, candidateOverlay, heatmap, changedPixelCount, changedOutsideGeneratedRegionPixelCount, maximumChannelDifference };
}

async function encodeRgb(data: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(data, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
}

async function contactSheet(
  sourceOverlay: Buffer,
  candidateOverlay: Buffer,
  heatmap: Buffer,
  width: number,
  height: number,
  gap: number,
): Promise<Buffer> {
  return sharp({
    create: { width: width * 3 + gap * 2, height, channels: 3, background: { r: 8, g: 10, b: 14 } },
  }).composite([
    { input: sourceOverlay, left: 0, top: 0 },
    { input: candidateOverlay, left: width + gap, top: 0 },
    { input: heatmap, left: (width + gap) * 2, top: 0 },
  ]).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
}

function receiptFromStable(file: StableFile): z.infer<typeof FileReceiptSchema> {
  return { fileName: file.absolutePath.split(/[\\/]/u).at(-1) ?? "artifact.bin", sizeBytes: file.sizeBytes, sha256: file.sha256 };
}

function requireDistinctFiles(files: readonly StableFile[]): void {
  const paths = new Set(files.map((file) => process.platform === "win32" ? file.absolutePath.toLowerCase() : file.absolutePath));
  const identities = new Set(files.map((file) => file.identity));
  if (paths.size !== files.length || identities.size !== files.length) {
    fail("INPUT_INVALID", "Source, candidate, protected mask, and generated-region mask must be distinct direct files.");
  }
}

export async function prepareGrandHallForbiddenArchitectureEvaluatorMaterials(
  options: PrepareGrandHallForbiddenArchitectureEvaluatorOptions,
): Promise<{ readonly outputDirectory: string; readonly configuration: PendingFile["receipt"]; readonly runtime: PendingFile["receipt"]; readonly receiptSha256: `sha256:${string}` }> {
  const width = z.number().int().positive().max(65_536).parse(options.width);
  const height = z.number().int().positive().max(65_536).parse(options.height);
  const [implementation, sourceFile, protectedMaskFile, generatedMaskFile] = await Promise.all([
    stableRead(options.implementationPath, "Evaluator implementation"),
    stableRead(options.sourceImagePath, "Bound source image"),
    stableRead(options.protectedMaskPath, "Bound protected mask"),
    stableRead(options.generatedRegionMaskPath, "Bound generated-region mask"),
  ]);
  requireDistinctFiles([sourceFile, protectedMaskFile, generatedMaskFile]);
  const [protectedMask, generatedMask] = await Promise.all([
    decodeMask(protectedMaskFile, width, height, "Bound protected mask"),
    decodeMask(generatedMaskFile, width, height, "Bound generated-region mask"),
  ]);
  const executingImplementation = await stableRead(EXECUTING_IMPLEMENTATION_PATH, "Executing evaluator implementation");
  if (implementation.sha256 !== executingImplementation.sha256 || implementation.sizeBytes !== executingImplementation.sizeBytes) {
    fail("INPUT_INVALID", "Prepared evaluator implementation must be byte-identical to the executing evaluator module.");
  }
  const configurationFile = pendingJson(
    GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONFIGURATION_FILENAME,
    GrandHallForbiddenArchitectureConfigurationSchema.parse({
      ...BASE_CONFIGURATION,
      expectedInputs: {
        source: { sizeBytes: sourceFile.sizeBytes, sha256: sourceFile.sha256, width, height },
        protectedMask: {
          role: "protected_region",
          semantics: "white_255_means_protected",
          sizeBytes: protectedMaskFile.sizeBytes,
          sha256: protectedMaskFile.sha256,
          width,
          height,
          whitePixelCount: protectedMask.whitePixelCount,
        },
        generatedRegionMask: {
          role: "generated_region",
          semantics: "white_255_means_generated_region",
          sizeBytes: generatedMaskFile.sizeBytes,
          sha256: generatedMaskFile.sha256,
          width,
          height,
          whitePixelCount: generatedMask.whitePixelCount,
        },
      },
    }),
  );
  const runtime = GrandHallForbiddenArchitectureRuntimeSchema.parse({
    schemaVersion: GRAND_HALL_FORBIDDEN_ARCHITECTURE_RUNTIME_SCHEMA,
    authority: "none",
    implementation: { preparedFromPath: implementation.absolutePath, sizeBytes: implementation.sizeBytes, sha256: implementation.sha256 },
    nodeVersion: process.versions.node,
    sharpVersion: sharp.versions.sharp,
    zodVersion: packageVersion("zod"),
    configurationSha256: sha256(configurationFile.bytes),
    platform: process.platform,
    architecture: process.arch,
    execution: currentExecutionDescriptor(),
    networkRequired: false,
    modelRequired: false,
    automaticSemanticDetectionAvailable: false,
  });
  const runtimeFile = pendingJson(GRAND_HALL_FORBIDDEN_ARCHITECTURE_RUNTIME_FILENAME, runtime);
  const receipt = GrandHallForbiddenArchitectureMaterialsReceiptSchema.parse({
    schemaVersion: GRAND_HALL_FORBIDDEN_ARCHITECTURE_MATERIALS_RECEIPT_SCHEMA,
    authority: "none",
    receiptWrittenLast: true,
    implementation: runtime.implementation,
    configuration: configurationFile.receipt,
    runtime: runtimeFile.receipt,
  });
  const receiptFile = pendingJson(GRAND_HALL_FORBIDDEN_ARCHITECTURE_MATERIALS_RECEIPT_FILENAME, receipt);
  const staging = await claimStagingDirectory(options.outputDirectory);
  let published = false;
  try {
    await options.testHooks?.afterStagingClaimed?.({ stagingDirectory: staging.staging, targetDirectory: staging.target });
    await requireStagingIdentity(staging);
    await writeExclusive(staging, configurationFile);
    await writeExclusive(staging, runtimeFile);
    await Promise.all([
      requireUnchanged(implementation, "Evaluator implementation"),
      requireUnchanged(executingImplementation, "Executing evaluator implementation"),
      requireUnchanged(sourceFile, "Bound source image"),
      requireUnchanged(protectedMaskFile, "Bound protected mask"),
      requireUnchanged(generatedMaskFile, "Bound generated-region mask"),
    ]);
    await writeExclusive(staging, receiptFile);
    await exactInventory(staging.staging, [configurationFile.receipt.fileName, runtimeFile.receipt.fileName, receiptFile.receipt.fileName]);
    await publishStagingDirectory(staging, options.testHooks?.afterPublishedIdentityRead);
    published = true;
  } finally {
    if (!published) await cleanupStagingDirectory(staging);
  }
  await stablePublishedDirectory(staging);
  return { outputDirectory: staging.target, configuration: configurationFile.receipt, runtime: runtimeFile.receipt, receiptSha256: sha256(receiptFile.bytes) };
}

export async function runGrandHallForbiddenArchitectureEvaluator(
  options: RunGrandHallForbiddenArchitectureEvaluatorOptions,
): Promise<{ readonly outputDirectory: string; readonly semanticResultSha256: string; readonly receiptSha256: `sha256:${string}` }> {
  const [sourceFile, candidateFile, protectedMaskFile, generatedMaskFile, implementationFile, configurationFile, runtimeFile] = await Promise.all([
    stableRead(options.sourceImagePath, "Source image"),
    stableRead(options.candidateImagePath, "Candidate image"),
    stableRead(options.protectedMaskPath, "Protected mask"),
    stableRead(options.generatedRegionMaskPath, "Generated-region mask"),
    stableRead(options.implementationPath, "Evaluator implementation"),
    stableRead(options.configurationPath, "Evaluator configuration"),
    stableRead(options.runtimePath, "Evaluator runtime"),
  ]);
  const configuration = GrandHallForbiddenArchitectureConfigurationSchema.parse(parseCanonicalJson(configurationFile, "Evaluator configuration"));
  const runtime = GrandHallForbiddenArchitectureRuntimeSchema.parse(parseCanonicalJson(runtimeFile, "Evaluator runtime"));
  requireDistinctFiles([sourceFile, candidateFile, protectedMaskFile, generatedMaskFile]);
  const expected = configuration.expectedInputs;
  if (sourceFile.sha256 !== expected.source.sha256 || sourceFile.sizeBytes !== expected.source.sizeBytes ||
      protectedMaskFile.sha256 !== expected.protectedMask.sha256 || protectedMaskFile.sizeBytes !== expected.protectedMask.sizeBytes ||
      generatedMaskFile.sha256 !== expected.generatedRegionMask.sha256 || generatedMaskFile.sizeBytes !== expected.generatedRegionMask.sizeBytes) {
    return fail("INPUT_INVALID", "Source or mask bytes do not match their exact bound configuration role and digest.");
  }
  const executingImplementationFile = await stableRead(EXECUTING_IMPLEMENTATION_PATH, "Executing evaluator implementation");
  if (
    runtime.implementation.sha256 !== implementationFile.sha256 ||
    runtime.implementation.sizeBytes !== implementationFile.sizeBytes ||
    executingImplementationFile.sha256 !== implementationFile.sha256 ||
    executingImplementationFile.sizeBytes !== implementationFile.sizeBytes
  ) {
    return fail("INPUT_INVALID", "Evaluator runtime does not bind the exact implementation bytes.");
  }
  if (
    runtime.nodeVersion !== process.versions.node ||
    runtime.sharpVersion !== sharp.versions.sharp ||
    runtime.zodVersion !== packageVersion("zod") ||
    runtime.configurationSha256 !== configurationFile.sha256 ||
    runtime.platform !== process.platform ||
    runtime.architecture !== process.arch ||
    stableCanonicalJson(toCanonicalJson(runtime.execution)) !==
      stableCanonicalJson(toCanonicalJson(currentExecutionDescriptor()))
  ) {
    return fail("INPUT_INVALID", "Evaluator runtime does not match the executing Node, Sharp, platform, architecture, and transpiler closure.");
  }
  const [source, candidate] = await Promise.all([decodeRgb(sourceFile, "Source image"), decodeRgb(candidateFile, "Candidate image")]);
  if (source.width !== candidate.width || source.height !== candidate.height) return fail("INPUT_INVALID", "Source and candidate dimensions must match exactly; resizing is prohibited.");
  if (source.width !== expected.source.width || source.height !== expected.source.height ||
      expected.protectedMask.width !== source.width || expected.protectedMask.height !== source.height ||
      expected.generatedRegionMask.width !== source.width || expected.generatedRegionMask.height !== source.height) {
    return fail("INPUT_INVALID", "Decoded source/candidate/mask extent disagrees with the exact bound configuration.");
  }
  const [protectedMask, generatedMask] = await Promise.all([
    decodeMask(protectedMaskFile, source.width, source.height, "Protected mask"),
    decodeMask(generatedMaskFile, source.width, source.height, "Generated-region mask"),
  ]);
  if (protectedMask.whitePixelCount !== expected.protectedMask.whitePixelCount ||
      generatedMask.whitePixelCount !== expected.generatedRegionMask.whitePixelCount) {
    return fail("INPUT_INVALID", "Decoded binary mask counts disagree with their exact protected/generated roles.");
  }
  const visuals = buildDifferenceVisuals(source, candidate, protectedMask.data, generatedMask.data, configuration);
  const [sourceOverlayBytes, candidateOverlayBytes, heatmapBytes] = await Promise.all([
    encodeRgb(visuals.sourceOverlay, source.width, source.height),
    encodeRgb(visuals.candidateOverlay, source.width, source.height),
    encodeRgb(visuals.heatmap, source.width, source.height),
  ]);
  const contactSheetBytes = await contactSheet(
    sourceOverlayBytes,
    candidateOverlayBytes,
    heatmapBytes,
    source.width,
    source.height,
    configuration.comparison.contactSheetGapPixels,
  );
  const sourceOverlay = pending(GRAND_HALL_FORBIDDEN_ARCHITECTURE_SOURCE_OVERLAY_FILENAME, sourceOverlayBytes);
  const candidateOverlay = pending(GRAND_HALL_FORBIDDEN_ARCHITECTURE_CANDIDATE_OVERLAY_FILENAME, candidateOverlayBytes);
  const heatmap = pending(GRAND_HALL_FORBIDDEN_ARCHITECTURE_HEATMAP_FILENAME, heatmapBytes);
  const sheet = pending(GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONTACT_SHEET_FILENAME, contactSheetBytes);
  const semanticResult = createFoundryRestorationSemanticResultV0({
    status: "not_evaluated",
    uncertainty: "unknown",
    detections: null,
    evaluatorReceiptArtifact: null,
    binding: {
      implementationSha256: implementationFile.sha256,
      configurationSha256: configurationFile.sha256,
      runtimeEnvironmentSha256: runtimeFile.sha256,
      beforeSha256: sourceFile.sha256,
      afterSha256: candidateFile.sha256,
      protectedRegionMaskSha256: protectedMaskFile.sha256,
      generatedRegionMaskSha256: generatedMaskFile.sha256,
    },
  });
  const semanticResultFile = pendingJson(GRAND_HALL_FORBIDDEN_ARCHITECTURE_SEMANTIC_RESULT_FILENAME, semanticResult);
  const evidence = GrandHallForbiddenArchitectureEvidenceSchema.parse({
    schemaVersion: GRAND_HALL_FORBIDDEN_ARCHITECTURE_EVIDENCE_SCHEMA,
    authority: "none",
    semanticStatus: "not_evaluated",
    semanticUncertainty: "unknown",
    humanReviewRequired: true,
    automaticSemanticDetectionPerformed: false,
    semanticDetections: null,
    source: receiptFromStable(sourceFile),
    candidate: receiptFromStable(candidateFile),
    protectedMask: receiptFromStable(protectedMaskFile),
    generatedRegionMask: receiptFromStable(generatedMaskFile),
    implementationSha256: implementationFile.sha256,
    configurationSha256: configurationFile.sha256,
    runtimeEnvironmentSha256: runtimeFile.sha256,
    width: source.width,
    height: source.height,
    changedPixelCount: visuals.changedPixelCount,
    changedOutsideGeneratedRegionPixelCount: visuals.changedOutsideGeneratedRegionPixelCount,
    maximumChannelDifference: visuals.maximumChannelDifference,
    outputs: {
      sourceOverlay: sourceOverlay.receipt,
      candidateOverlay: candidateOverlay.receipt,
      heatmap: heatmap.receipt,
      contactSheet: sheet.receipt,
      semanticResult: semanticResultFile.receipt,
    },
    limitations: [
      "Pixel differences are review navigation evidence, not semantic detections.",
      "No automated claim is made about windows, doorways, floor appearance, neighbouring rooms, facade, or generated fill.",
      "A qualified human must review the fixed-camera evidence before any semantic result can become evaluated.",
    ],
  });
  const evidenceFile = pendingJson(GRAND_HALL_FORBIDDEN_ARCHITECTURE_EVIDENCE_FILENAME, evidence);
  const filesBeforeReceipt = [sourceOverlay, candidateOverlay, heatmap, sheet, semanticResultFile, evidenceFile] as const;
  await Promise.all([
    sourceFile,
    candidateFile,
    protectedMaskFile,
    generatedMaskFile,
    implementationFile,
    executingImplementationFile,
    configurationFile,
    runtimeFile,
  ].map((file) => requireUnchanged(file, file.absolutePath)));
  const receipt = GrandHallForbiddenArchitecturePublicationReceiptSchema.parse({
    schemaVersion: GRAND_HALL_FORBIDDEN_ARCHITECTURE_PUBLICATION_RECEIPT_SCHEMA,
    authority: "none",
    outputState: "complete_not_evaluated_human_review_required",
    receiptWrittenLast: true,
    evidence: evidenceFile.receipt,
    filesBeforeReceipt: filesBeforeReceipt.map((file) => file.receipt),
  });
  const receiptFile = pendingJson(GRAND_HALL_FORBIDDEN_ARCHITECTURE_PUBLICATION_RECEIPT_FILENAME, receipt);
  const staging = await claimStagingDirectory(options.outputDirectory);
  let published = false;
  try {
    await options.testHooks?.afterStagingClaimed?.({ stagingDirectory: staging.staging, targetDirectory: staging.target });
    await requireStagingIdentity(staging);
    for (const file of filesBeforeReceipt) await writeExclusive(staging, file);
    await writeExclusive(staging, receiptFile);
    await exactInventory(staging.staging, [...filesBeforeReceipt.map((file) => file.receipt.fileName), receiptFile.receipt.fileName]);
    await Promise.all([
      sourceFile,
      candidateFile,
      protectedMaskFile,
      generatedMaskFile,
      implementationFile,
      executingImplementationFile,
      configurationFile,
      runtimeFile,
    ].map((file) => requireUnchanged(file, file.absolutePath)));
    await publishStagingDirectory(staging, options.testHooks?.afterPublishedIdentityRead);
    published = true;
  } finally {
    if (!published) await cleanupStagingDirectory(staging);
  }
  await stablePublishedDirectory(staging);
  return { outputDirectory: staging.target, semanticResultSha256: semanticResult.semanticResultSha256, receiptSha256: sha256(receiptFile.bytes) };
}

import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  normalize,
  relative,
  resolve,
} from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  VisualLineageBenchmarkV0Schema,
  type VisualLineageBenchmarkV0,
  type VisualLineageRepresentationV0,
} from "@omnitwin/types";
import sharp from "sharp";

import {
  GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME,
  GRAND_HALL_DIFIX_CAMERA_ARTIFACT_SCHEMA,
  GRAND_HALL_DIFIX_CAPTURE_BENCHMARK_ID,
  GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX,
  GRAND_HALL_DIFIX_CAPTURE_METHOD,
  GRAND_HALL_DIFIX_CAPTURE_MODE,
  GRAND_HALL_DIFIX_EXPECTED_CAMERA,
  GRAND_HALL_DIFIX_EXPECTED_GAUSSIAN_COUNT,
  GRAND_HALL_DIFIX_EXPECTED_SOURCE_MEMBERS,
  GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME,
  GRAND_HALL_DIFIX_INPUT_HEIGHT,
  GRAND_HALL_DIFIX_INPUT_PACK_SCHEMA,
  GRAND_HALL_DIFIX_INPUT_WIDTH,
  GRAND_HALL_DIFIX_MANIFEST_FILENAME,
  GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME,
  GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_DIFIX_RECONSTRUCTION_ARTIFACT_SCHEMA,
  GRAND_HALL_DIFIX_RENDERER_ARTIFACT_SCHEMA,
  GRAND_HALL_DIFIX_RENDER_GENERATION_RECEIPT_SCHEMA,
  GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME,
  GrandHallDifixCameraArtifactSchema,
  GrandHallDifixInputPackManifestSchema,
  GrandHallDifixObservedCaptureSchema,
  GrandHallDifixPublicationReceiptSchema,
  GrandHallDifixReconstructionArtifactSchema,
  GrandHallDifixRendererArtifactSchema,
  GrandHallDifixRenderGenerationReceiptSchema,
  isGrandHallDifixNominalDprOne,
  type GrandHallDifixArtifactReference,
  type GrandHallDifixCameraArtifact,
  type GrandHallDifixFileReceipt,
  type GrandHallDifixInputPackManifest,
  type GrandHallDifixObservedCapture,
  type GrandHallDifixPublicationReceipt,
  type GrandHallDifixReconstructionArtifact,
  type GrandHallDifixRendererArtifact,
  type GrandHallDifixRenderGenerationReceipt,
} from "./grand-hall-difix-no-reference-input-pack-contract.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

const INPUT_PACK_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_DIFIX_INPUT_PACK_V1";
const MAX_CAPTURE_PNG_BYTES = 64 * 1024 * 1024;
const MAX_BROWSER_RECORD_BYTES = 16 * 1024 * 1024;
const EXPECTED_PIXEL_COUNT = GRAND_HALL_DIFIX_INPUT_WIDTH * GRAND_HALL_DIFIX_INPUT_HEIGHT;

export type GrandHallDifixInputPackErrorCode =
  | "INPUT_INVALID"
  | "INPUT_RACE"
  | "PNG_INVALID"
  | "RECORD_MISMATCH"
  | "OUTPUT_EXISTS"
  | "OUTPUT_INVALID"
  | "OUTPUT_UNSAFE";

export class GrandHallDifixInputPackError extends Error {
  constructor(
    readonly code: GrandHallDifixInputPackErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallDifixInputPackError";
  }
}

export interface GrandHallDifixInputPackOptions {
  readonly capturePngPath: string;
  readonly browserRecordPath: string;
  readonly outputDirectory: string;
}

export interface VerifiedGrandHallDifixInputPack {
  readonly outputDirectory: string;
  readonly manifest: GrandHallDifixInputPackManifest;
  readonly publicationReceipt: GrandHallDifixPublicationReceipt;
  readonly publicationReceiptSha256: string;
  readonly artifacts: GrandHallDifixVerifiedArtifactDocuments;
}

export interface GrandHallDifixVerifiedArtifactDocuments {
  readonly camera: GrandHallDifixCameraArtifact;
  readonly renderer: GrandHallDifixRendererArtifact;
  readonly reconstruction: GrandHallDifixReconstructionArtifact;
  readonly renderGeneration: GrandHallDifixRenderGenerationReceipt;
}

interface StableFile {
  readonly absolutePath: string;
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly identity: string;
}

interface ValidatedCapture {
  readonly benchmark: VisualLineageBenchmarkV0;
  readonly representation: VisualLineageRepresentationV0;
  readonly observedCapture: GrandHallDifixObservedCapture;
}

interface PendingFile {
  readonly receipt: GrandHallDifixFileReceipt;
  readonly bytes: Buffer;
}

type PendingArtifact = PendingFile & {
  readonly reference: GrandHallDifixArtifactReference;
};

interface InputImageFiles {
  readonly sourceRender: PendingFile;
  readonly captureRecord: PendingFile;
  readonly protectedMask: PendingFile;
  readonly generatedMask: PendingFile;
}

interface ClosureArtifacts {
  readonly camera: PendingArtifact;
  readonly renderer: PendingArtifact;
  readonly reconstruction: PendingArtifact;
  readonly renderGeneration: PendingArtifact;
}

interface OutputClaim {
  readonly directory: string;
  readonly identity: string;
}

function fail(
  code: GrandHallDifixInputPackErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new GrandHallDifixInputPackError(code, message, cause);
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) === stableCanonicalJson(toCanonicalJson(right));
}

function requireExactJson(label: string, actual: unknown, expected: unknown): void {
  if (!sameJson(actual, expected)) {
    fail("RECORD_MISMATCH", `${label} does not match the pinned Grand Hall contract.`);
  }
}

function canonicalAbsolutePath(value: string, label: string): string {
  if (!isAbsolute(value)) fail("OUTPUT_UNSAFE", `${label} must be an absolute path.`);
  const canonical = resolve(value);
  if (canonical !== normalize(value)) {
    fail("OUTPUT_UNSAFE", `${label} must be normalized and traversal-free.`);
  }
  return canonical;
}

function comparablePath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function samePath(left: string, right: string): boolean {
  return comparablePath(resolve(left)) === comparablePath(resolve(right));
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relationship = relative(directory, candidate);
  return relationship !== ""
    && !relationship.startsWith("..")
    && !isAbsolute(relationship);
}

function identityOf(stats: BigIntStats): string {
  return [
    stats.dev,
    stats.ino,
    stats.mode,
    stats.size,
    stats.mtimeNs,
    stats.ctimeNs,
  ].map(String).join(":");
}

function nodeIdentityOf(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode].map(String).join(":");
}

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function stableRead(
  inputPath: string,
  label: string,
  maxBytes: number,
): Promise<StableFile> {
  const absolutePath = canonicalAbsolutePath(inputPath, label);
  const physicalPath = await realpath(absolutePath).catch((error: unknown) => (
    fail("INPUT_INVALID", `${label} cannot be resolved to a physical path.`, error)
  ));
  if (!samePath(physicalPath, absolutePath)) {
    fail("INPUT_INVALID", `${label} must not traverse a symbolic link or junction.`);
  }
  const pathBefore = await lstat(absolutePath, { bigint: true }).catch((error: unknown) => (
    fail("INPUT_INVALID", `${label} is not a readable regular file.`, error)
  ));
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    fail("INPUT_INVALID", `${label} must be a regular file, not a link or directory.`);
  }
  if (pathBefore.size <= 0n || pathBefore.size > BigInt(maxBytes)) {
    fail("INPUT_INVALID", `${label} has an invalid byte length ${String(pathBefore.size)}.`);
  }

  const handle = await open(absolutePath, "r").catch((error: unknown) => (
    fail("INPUT_INVALID", `${label} could not be opened.`, error)
  ));
  try {
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || !sameNode(pathBefore, openedBefore)) {
      fail("INPUT_RACE", `${label} changed while it was opened.`);
    }
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolutePath, { bigint: true });
    if (
      bytes.byteLength !== Number(openedBefore.size)
      || !sameNode(openedBefore, openedAfter)
      || !sameNode(openedAfter, pathAfter)
    ) {
      fail("INPUT_RACE", `${label} changed during its stable read.`);
    }
    return {
      absolutePath,
      bytes,
      sha256: sha256(bytes),
      identity: identityOf(openedAfter),
    };
  } finally {
    await handle.close();
  }
}

async function requireUnchanged(
  original: StableFile,
  label: string,
  maxBytes: number,
): Promise<void> {
  const repeated = await stableRead(original.absolutePath, label, maxBytes);
  if (
    repeated.identity !== original.identity
    || repeated.sha256 !== original.sha256
    || !repeated.bytes.equals(original.bytes)
  ) {
    fail("INPUT_RACE", `${label} changed after validation.`);
  }
}

async function decodeExactPng(
  bytes: Buffer,
  label: string,
): Promise<{
  readonly data: Buffer;
  readonly decodedChannels: number;
  readonly encodedChannels: number;
  readonly depth: string;
  readonly bitsPerSample: number | undefined;
  readonly hasAlpha: boolean;
  readonly isPalette: boolean;
  readonly space: string;
}> {
  try {
    const decoderOptions = {
      failOn: "error" as const,
      limitInputPixels: EXPECTED_PIXEL_COUNT,
      sequentialRead: true,
    };
    const metadata = await sharp(bytes, decoderOptions).metadata();
    if (
      metadata.format !== "png"
      || metadata.width !== GRAND_HALL_DIFIX_INPUT_WIDTH
      || metadata.height !== GRAND_HALL_DIFIX_INPUT_HEIGHT
      || (metadata.pages ?? 1) !== 1
    ) {
      fail(
        "PNG_INVALID",
        `${label} must be one fully decodable ${String(GRAND_HALL_DIFIX_INPUT_WIDTH)}x${String(GRAND_HALL_DIFIX_INPUT_HEIGHT)} PNG image.`,
      );
    }
    const decoded = await sharp(bytes, decoderOptions).raw().toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== GRAND_HALL_DIFIX_INPUT_WIDTH
      || decoded.info.height !== GRAND_HALL_DIFIX_INPUT_HEIGHT
      || decoded.info.channels < 1
      || decoded.info.channels > 4
      || decoded.data.byteLength !== EXPECTED_PIXEL_COUNT * decoded.info.channels
    ) {
      fail("PNG_INVALID", `${label} did not fully decode to its declared pixel extent.`);
    }
    return {
      data: decoded.data,
      decodedChannels: decoded.info.channels,
      encodedChannels: metadata.channels,
      depth: metadata.depth,
      bitsPerSample: metadata.bitsPerSample,
      hasAlpha: metadata.hasAlpha,
      isPalette: metadata.isPalette,
      space: metadata.space,
    };
  } catch (error: unknown) {
    if (error instanceof GrandHallDifixInputPackError) throw error;
    fail("PNG_INVALID", `${label} could not be fully decoded as PNG.`, error);
  }
}

function requireExactSourcePng(
  decoded: Awaited<ReturnType<typeof decodeExactPng>>,
  code: "PNG_INVALID" | "OUTPUT_INVALID",
): void {
  if (
    decoded.encodedChannels !== 3
    || decoded.decodedChannels !== 3
    || decoded.depth !== "uchar"
    || decoded.bitsPerSample !== 8
    || decoded.hasAlpha
    || decoded.isPalette
    || decoded.space !== "srgb"
  ) {
    fail(
      code,
      "Source render must be an exact non-palette, non-alpha, 8-bit unsigned RGB PNG in sRGB space.",
    );
  }
}

function hardwareRenderer(environment: {
  readonly webglVendor: string;
  readonly webglRenderer: string;
}): boolean {
  const identity = `${environment.webglVendor} ${environment.webglRenderer}`.toLowerCase();
  const software = [
    "swiftshader",
    "llvmpipe",
    "softpipe",
    "software rasterizer",
    "microsoft basic render driver",
    "mesa offscreen",
  ];
  const hardware = [
    "nvidia",
    "geforce",
    "amd",
    "radeon",
    "intel",
    "apple gpu",
    "adreno",
    "qualcomm",
    "mali",
    "powervr",
  ];
  return !software.some((marker) => identity.includes(marker))
    && hardware.some((marker) => identity.includes(marker));
}

const EXPECTED_RENDERER_SETTINGS = Object.freeze({
  renderer: "Three.js 0.180 / Spark 2.0",
  antialias: false,
  transparent: true,
  depthWrite: false,
  maxSplats: "asset_count_plus_one_exact_runtime; library_default_fixture",
  maxStdDev: "library_default",
  minAlpha: "library_default",
  preBlurAmount: "library_default",
  blurAmount: "library_default",
  focalAdjustment: "library_default",
  toneMapping: "NoToneMapping",
  outputColorSpace: "srgb",
});

const EXPECTED_FIXTURE_CAMERA = Object.freeze({
  position: GRAND_HALL_DIFIX_EXPECTED_CAMERA.position,
  target: [0.15796363067625974, 2.15606153541565, -0.19184415815737577],
  fov: 60,
  near: 0.05,
  far: 80,
});

const EXPECTED_FIXTURE_GROUP = Object.freeze({
  zUp: true,
  offset: [4.74065113067626, 2.84312653541565, -8.584035158157375],
});

function parseBrowserBenchmark(bytes: Buffer): VisualLineageBenchmarkV0 {
  let benchmark: VisualLineageBenchmarkV0;
  try {
    benchmark = VisualLineageBenchmarkV0Schema.parse(parseGrandHallT554StrictJson(bytes));
  } catch (error: unknown) {
    fail("INPUT_INVALID", "Browser capture record is not strict VisualLineageBenchmarkV0 JSON.", error);
  }
  return benchmark;
}

function requireBenchmarkHeader(benchmark: VisualLineageBenchmarkV0): void {
  if (
    benchmark.benchmarkId !== GRAND_HALL_DIFIX_CAPTURE_BENCHMARK_ID
    || benchmark.roomRef !== "trades-hall/grand-hall"
    || benchmark.viewport.width !== GRAND_HALL_DIFIX_INPUT_WIDTH
    || benchmark.viewport.height !== GRAND_HALL_DIFIX_INPUT_HEIGHT
    || !isGrandHallDifixNominalDprOne(benchmark.viewport.devicePixelRatio)
  ) {
    fail("RECORD_MISMATCH", "Browser record is not the explicit 1024x576 Grand Hall Difix capture mode.");
  }
  requireExactJson("Fixed camera", benchmark.camera, GRAND_HALL_DIFIX_EXPECTED_CAMERA);
  requireExactJson("Renderer settings", benchmark.rendererSettings, EXPECTED_RENDERER_SETTINGS);
  if (
    benchmark.runStartedAt === undefined
    || benchmark.runCompletedAt === undefined
    || benchmark.worktreeSourceStateSha256 === undefined
    || Date.parse(benchmark.runCompletedAt) < Date.parse(benchmark.runStartedAt)
  ) {
    fail("RECORD_MISMATCH", "Browser record lacks a coherent run window and source-state digest.");
  }
  if (benchmark.representations.length !== 1) {
    fail("RECORD_MISMATCH", "Difix input browser record must contain exactly one SOG representation.");
  }
}

function requireSogRepresentation(
  benchmark: VisualLineageBenchmarkV0,
): VisualLineageRepresentationV0 {
  const representation = benchmark.representations[0];
  if (representation === undefined) {
    fail("RECORD_MISMATCH", "Difix input browser record has no SOG representation.");
  }
  if (
    representation.id !== "exact-sog-frontier"
    || representation.format !== "sog"
    || representation.status !== "diagnostic"
    || representation.visualAssessment !== "not_reviewed"
    || representation.cameraRegistration !== "inspection_only"
    || representation.rendererProfile !== "diagnostic_resolved_defaults"
  ) {
    fail("RECORD_MISMATCH", "Browser record representation is not the pinned diagnostic SOG lane.");
  }
  return representation;
}

function requireScreenshotBinding(
  representation: VisualLineageRepresentationV0,
  capture: StableFile,
  enforceOriginalCapturePath: boolean,
): void {
  const screenshot = representation.screenshot;
  if (
    screenshot === undefined
    || !isAbsolute(screenshot.path)
    || (enforceOriginalCapturePath && !samePath(screenshot.path, capture.absolutePath))
    || screenshot.sha256 !== capture.sha256
    || screenshot.sizeBytes !== capture.bytes.byteLength
    || screenshot.width !== GRAND_HALL_DIFIX_INPUT_WIDTH
    || screenshot.height !== GRAND_HALL_DIFIX_INPUT_HEIGHT
  ) {
    fail("RECORD_MISMATCH", "Browser record screenshot receipt does not bind the supplied PNG.");
  }
}

function requireSogRuntimeClosure(representation: VisualLineageRepresentationV0): void {
  requireExactJson(
    "SOG source members",
    representation.sourceMembers,
    GRAND_HALL_DIFIX_EXPECTED_SOURCE_MEMBERS,
  );
  requireExactJson(
    "SOG source references",
    representation.sourceRefs,
    GRAND_HALL_DIFIX_EXPECTED_SOURCE_MEMBERS.map((member) => member.sha256),
  );
  if (
    representation.decodedSplatCount !== GRAND_HALL_DIFIX_EXPECTED_GAUSSIAN_COUNT
    || representation.warmupFrameCount !== 8
    || representation.frameSampleCount !== 1
    || representation.sparkRuntimeState?.activeSplats !== GRAND_HALL_DIFIX_EXPECTED_GAUSSIAN_COUNT
    || representation.sparkRuntimeState.sorting
    || representation.sparkRuntimeState.sortDirty
    || representation.sparkRuntimeState.dirty
    || representation.sparkRuntimeState.sortRadial
  ) {
    fail(
      "RECORD_MISMATCH",
      "Browser record does not bind the exact 8-warm-up/1-sample settled 6,019,684-splat SOG profile.",
    );
  }
}

function requireCameraClosure(representation: VisualLineageRepresentationV0): void {
  const actualCamera = representation.actualCamera;
  if (actualCamera === undefined) {
    fail("RECORD_MISMATCH", "Browser record lacks observed fixed-camera evidence.");
  }
  requireExactJson("Observed camera", actualCamera, {
    position: GRAND_HALL_DIFIX_EXPECTED_CAMERA.position,
    quaternion: GRAND_HALL_DIFIX_EXPECTED_CAMERA.quaternion,
    projectionMatrix: GRAND_HALL_DIFIX_EXPECTED_CAMERA.projectionMatrix,
    fov: GRAND_HALL_DIFIX_EXPECTED_CAMERA.fov,
    near: GRAND_HALL_DIFIX_EXPECTED_CAMERA.near,
    far: GRAND_HALL_DIFIX_EXPECTED_CAMERA.far,
  });
  const fixture = representation.fixtureSettings;
  if (fixture === undefined) {
    fail("RECORD_MISMATCH", "Browser record lacks fixed fixture settings.");
  }
  requireExactJson("Fixture camera", fixture.camera, EXPECTED_FIXTURE_CAMERA);
  requireExactJson("Fixture group", fixture.group, EXPECTED_FIXTURE_GROUP);
  requireExactJson("Fixture renderer", fixture.renderer, {
    dpr: 1,
    antialias: false,
    fixedCamera: true,
    transparent: true,
    depthWrite: false,
  });
}

function parseObservedCapture(
  representation: VisualLineageRepresentationV0,
): GrandHallDifixObservedCapture {
  const evidence = representation.limitations.filter((entry) => (
    entry.startsWith(GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX)
  ));
  if (evidence.length !== 1) {
    fail("RECORD_MISMATCH", "Browser record must contain exactly one structured capture-evidence marker.");
  }
  try {
    const payload = evidence[0]?.slice(GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX.length);
    const parsed = parseGrandHallT554StrictJson(Buffer.from(payload ?? "", "utf8"));
    return GrandHallDifixObservedCaptureSchema.parse(parsed);
  } catch (error: unknown) {
    fail("RECORD_MISMATCH", "Browser capture-evidence marker is not the exact Difix capture contract.", error);
  }
}

function requireRendererClosure(
  benchmark: VisualLineageBenchmarkV0,
  representation: VisualLineageRepresentationV0,
): GrandHallDifixObservedCapture {
  if (
    representation.actualRenderer?.toneMapping !== "NoToneMapping"
    || representation.actualRenderer.outputColorSpace !== "srgb"
  ) {
    fail("RECORD_MISMATCH", "Browser record is not the NoToneMapping/sRGB renderer lane.");
  }
  if (
    representation.environment === undefined
    || representation.environment.contextLost
    || !hardwareRenderer(representation.environment)
  ) {
    fail("RECORD_MISMATCH", "Browser record lacks explicit non-lost hardware WebGL evidence.");
  }
  const observedCapture = parseObservedCapture(representation);
  if (
    observedCapture.canvasWidth !== benchmark.viewport.width
    || observedCapture.canvasHeight !== benchmark.viewport.height
    || observedCapture.devicePixelRatio !== benchmark.viewport.devicePixelRatio
    || observedCapture.contextAntialias !== representation.fixtureSettings?.renderer.antialias
  ) {
    fail("RECORD_MISMATCH", "Observed capture evidence is not cross-bound to the viewport and fixture renderer.");
  }
  return observedCapture;
}

function parseAndValidateBrowserRecord(
  bytes: Buffer,
  capture: StableFile,
  enforceOriginalCapturePath = true,
): ValidatedCapture {
  const benchmark = parseBrowserBenchmark(bytes);
  requireBenchmarkHeader(benchmark);
  const representation = requireSogRepresentation(benchmark);
  requireScreenshotBinding(representation, capture, enforceOriginalCapturePath);
  requireSogRuntimeClosure(representation);
  requireCameraClosure(representation);
  const observedCapture = requireRendererClosure(benchmark, representation);
  return { benchmark, representation, observedCapture };
}

function receipt(fileName: string, bytes: Buffer): GrandHallDifixFileReceipt {
  return { fileName, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
}

function artifact(
  prefix: string,
  artifactType: GrandHallDifixArtifactReference["artifactType"],
  value: unknown,
): PendingArtifact {
  const bytes = canonicalBytes(value);
  const digest = sha256(bytes);
  const fileName = `${prefix}.sha256-${digest.slice("sha256:".length)}.json`;
  const fileReceipt = receipt(fileName, bytes);
  return {
    bytes,
    receipt: fileReceipt,
    reference: { artifactType, ...fileReceipt },
  };
}

async function makeMask(value: 0 | 255): Promise<Buffer> {
  return sharp(Buffer.alloc(EXPECTED_PIXEL_COUNT, value), {
    raw: {
      width: GRAND_HALL_DIFIX_INPUT_WIDTH,
      height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
      channels: 1,
    },
  }).toColourspace("b-w").png({
    adaptiveFiltering: false,
    compressionLevel: 9,
    palette: false,
  }).toBuffer();
}

async function requireExactMask(bytes: Buffer, value: 0 | 255, label: string): Promise<void> {
  const decoded = await decodeExactPng(bytes, label);
  let grayscale: {
    readonly data: Buffer;
    readonly info: {
      readonly channels: number;
      readonly width: number;
      readonly height: number;
    };
  };
  try {
    grayscale = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: EXPECTED_PIXEL_COUNT,
      sequentialRead: true,
    }).toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
  } catch (error: unknown) {
    fail("OUTPUT_INVALID", `${label} did not fully decode as one-channel grayscale.`, error);
  }
  if (
    decoded.encodedChannels !== 1
    || grayscale.info.channels !== 1
    || grayscale.info.width !== GRAND_HALL_DIFIX_INPUT_WIDTH
    || grayscale.info.height !== GRAND_HALL_DIFIX_INPUT_HEIGHT
    || grayscale.data.byteLength !== EXPECTED_PIXEL_COUNT
    || decoded.depth !== "uchar"
    || decoded.bitsPerSample !== 8
    || decoded.hasAlpha
    || decoded.isPalette
    || decoded.space !== "b-w"
    || grayscale.data.some((entry) => entry !== value)
  ) {
    fail(
      "OUTPUT_INVALID",
      `${label} is not the required non-palette, non-alpha, 8-bit grayscale constant-${String(value)} mask.`,
    );
  }
}

function bundleMaterialSha256(value: unknown): string {
  return `sha256:${domainSeparatedSha256(INPUT_PACK_DIGEST_DOMAIN, toCanonicalJson(value))}`;
}

function expectedInputPaths(options: GrandHallDifixInputPackOptions): {
  readonly capturePngPath: string;
  readonly browserRecordPath: string;
  readonly outputDirectory: string;
} {
  const capturePngPath = canonicalAbsolutePath(options.capturePngPath, "Capture PNG path");
  const browserRecordPath = canonicalAbsolutePath(options.browserRecordPath, "Browser record path");
  const outputDirectory = canonicalAbsolutePath(options.outputDirectory, "Output directory");
  if (samePath(capturePngPath, browserRecordPath)) {
    fail("OUTPUT_UNSAFE", "Capture PNG and browser record paths must be distinct.");
  }
  if (
    samePath(outputDirectory, capturePngPath)
    || samePath(outputDirectory, browserRecordPath)
    || isInsideDirectory(outputDirectory, capturePngPath)
    || isInsideDirectory(outputDirectory, browserRecordPath)
  ) {
    fail("OUTPUT_UNSAFE", "Input files must not be located inside the new output directory.");
  }
  if (basename(outputDirectory) === "" || samePath(outputDirectory, dirname(outputDirectory))) {
    fail("OUTPUT_UNSAFE", "Output directory cannot be a filesystem root.");
  }
  return { capturePngPath, browserRecordPath, outputDirectory };
}

async function assertSafeOutputParent(outputDirectory: string): Promise<void> {
  const parent = dirname(outputDirectory);
  const physicalParent = await realpath(parent).catch((error: unknown) => (
    fail("OUTPUT_UNSAFE", "Output parent cannot be resolved to a physical path.", error)
  ));
  if (!samePath(physicalParent, parent)) {
    fail("OUTPUT_UNSAFE", "Output parent must not traverse a symbolic link or junction.");
  }
  const stats = await lstat(parent).catch((error: unknown) => (
    fail("OUTPUT_UNSAFE", "Output parent must already exist as a real directory.", error)
  ));
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail("OUTPUT_UNSAFE", "Output parent must be a real directory, not a link.");
  }
}

async function claimOutputDirectory(outputDirectory: string): Promise<OutputClaim> {
  try {
    await mkdir(outputDirectory, { recursive: false });
  } catch (error: unknown) {
    fail("OUTPUT_EXISTS", "Output directory already exists or could not be claimed; no replacement is permitted.", error);
  }
  const stats = await lstat(outputDirectory, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail("OUTPUT_UNSAFE", "Claimed output path is not a real directory.");
  }
  return { directory: outputDirectory, identity: nodeIdentityOf(stats) };
}

async function assertOutputClaim(claim: OutputClaim): Promise<void> {
  const stats = await lstat(claim.directory, { bigint: true }).catch((error: unknown) => (
    fail("OUTPUT_UNSAFE", "Claimed output directory disappeared during publication.", error)
  ));
  if (
    !stats.isDirectory()
    || stats.isSymbolicLink()
    || nodeIdentityOf(stats) !== claim.identity
  ) fail("OUTPUT_UNSAFE", "Claimed output directory changed during publication.");
}

async function writeExclusive(claim: OutputClaim, file: PendingFile): Promise<void> {
  await assertOutputClaim(claim);
  const target = resolve(claim.directory, file.receipt.fileName);
  if (dirname(target) !== claim.directory) {
    fail("OUTPUT_UNSAFE", `Unsafe output filename ${file.receipt.fileName}.`);
  }
  await writeFile(target, file.bytes, { flag: "wx", mode: 0o600 }).catch((error: unknown) => (
    fail("OUTPUT_EXISTS", `Refused to replace output ${file.receipt.fileName}.`, error)
  ));
  await assertOutputClaim(claim);
}

async function exactDirectoryNames(directory: string, expected: readonly string[]): Promise<void> {
  const actual = (await readdir(directory)).sort();
  const sortedExpected = [...expected].sort();
  if (!sameJson(actual, sortedExpected)) {
    fail("OUTPUT_INVALID", "Output directory inventory changed or contains an unexpected file.");
  }
}

async function buildInputImageFiles(
  capture: StableFile,
  browserRecord: StableFile,
): Promise<InputImageFiles> {
  const sourceRender: PendingFile = {
    bytes: capture.bytes,
    receipt: receipt(GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME, capture.bytes),
  };
  const captureRecord: PendingFile = {
    bytes: browserRecord.bytes,
    receipt: receipt(GRAND_HALL_DIFIX_BROWSER_RECORD_FILENAME, browserRecord.bytes),
  };
  const protectedMaskBytes = await makeMask(255);
  const generatedMaskBytes = await makeMask(0);
  await requireExactMask(protectedMaskBytes, 255, "Protected mask");
  await requireExactMask(generatedMaskBytes, 0, "Generated-region mask");
  const protectedMask: PendingFile = {
    bytes: protectedMaskBytes,
    receipt: receipt(GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME, protectedMaskBytes),
  };
  const generatedMask: PendingFile = {
    bytes: generatedMaskBytes,
    receipt: receipt(GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME, generatedMaskBytes),
  };
  return { sourceRender, captureRecord, protectedMask, generatedMask };
}

function buildCameraArtifact(validated: ValidatedCapture): PendingArtifact {
  const cameraValue = GrandHallDifixCameraArtifactSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_CAMERA_ARTIFACT_SCHEMA,
    authority: "none",
    roomRef: "trades-hall/grand-hall",
    sourcePoseIndex: 19_890,
    sourcePoseAuthority: "position_derived_inspection_only",
    opticalCalibrationAuthority: "none",
    fixedCamera: validated.benchmark.camera,
    observedCamera: validated.representation.actualCamera,
  });
  return artifact("camera", "camera", cameraValue);
}

function isDirectCanvasCaptureMethod(method: string): boolean {
  return method === GRAND_HALL_DIFIX_CAPTURE_METHOD;
}

function buildRendererArtifact(validated: ValidatedCapture): PendingArtifact {
  const rendererValue = GrandHallDifixRendererArtifactSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_RENDERER_ARTIFACT_SCHEMA,
    authority: "none",
    roomRef: "trades-hall/grand-hall",
    engine: "Three.js 0.180 / Spark 2.0",
    viewport: validated.benchmark.viewport,
    observedCapture: validated.observedCapture,
    directCanvasCapture: isDirectCanvasCaptureMethod(validated.observedCapture.method),
    resizeApplied: validated.observedCapture.resizeApplied,
    rendererClass: "hardware",
    settings: validated.benchmark.rendererSettings,
    observedRenderer: validated.representation.actualRenderer,
    environment: validated.representation.environment,
  });
  return artifact("renderer", "renderer", rendererValue);
}

function buildReconstructionArtifact(validated: ValidatedCapture): PendingArtifact {
  const reconstructionValue = GrandHallDifixReconstructionArtifactSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_RECONSTRUCTION_ARTIFACT_SCHEMA,
    authority: "none",
    roomRef: "trades-hall/grand-hall",
    truthClass: "source_derived_reconstruction_render_input",
    format: "sog",
    representationId: "exact-sog-frontier",
    sourceVariant: "scans_BIG_MODEL_TH_GH_1",
    sourceMembers: validated.representation.sourceMembers,
    decodedSplatCount: validated.representation.decodedSplatCount,
    runtimeState: validated.representation.sparkRuntimeState,
  });
  return artifact("reconstruction", "reconstruction", reconstructionValue);
}

function buildRenderGenerationArtifact(
  images: InputImageFiles,
  validated: ValidatedCapture,
  camera: PendingArtifact,
  renderer: PendingArtifact,
  reconstruction: PendingArtifact,
): PendingArtifact {
  const renderGenerationValue = GrandHallDifixRenderGenerationReceiptSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_RENDER_GENERATION_RECEIPT_SCHEMA,
    authority: "none",
    roomRef: "trades-hall/grand-hall",
    captureMode: GRAND_HALL_DIFIX_CAPTURE_MODE,
    benchmarkId: GRAND_HALL_DIFIX_CAPTURE_BENCHMARK_ID,
    truthClass: "source_derived_diagnostic_render",
    capturedSourceTruthClaimed: false,
    generatedContentPresent: false,
    directCanvasCapture: isDirectCanvasCaptureMethod(validated.observedCapture.method),
    resizeApplied: validated.observedCapture.resizeApplied,
    sourceRender: images.sourceRender.receipt,
    browserCaptureRecord: images.captureRecord.receipt,
    git: {
      commitSha: validated.benchmark.gitSha,
      worktreeDirty: validated.benchmark.worktreeDirty,
      sourceStateSha256: validated.benchmark.worktreeSourceStateSha256,
    },
    runStartedAt: validated.benchmark.runStartedAt,
    runCompletedAt: validated.benchmark.runCompletedAt,
    cameraArtifact: camera.reference,
    rendererArtifact: renderer.reference,
    reconstructionArtifact: reconstruction.reference,
    limitations: [
      "Inspection-only camera; not source optical calibration or accepted metric camera authority.",
      "Source-derived diagnostic render; not captured-source truth and not an accepted room-boundary result.",
      "No provider execution, generated fill, reconstruction replacement, runtime admission, staging, publication, or production promotion authority.",
    ],
  });
  return artifact(
    "render-generation-receipt",
    "render_generation",
    renderGenerationValue,
  );
}

function buildClosureArtifacts(
  images: InputImageFiles,
  validated: ValidatedCapture,
): ClosureArtifacts {
  const camera = buildCameraArtifact(validated);
  const renderer = buildRendererArtifact(validated);
  const reconstruction = buildReconstructionArtifact(validated);
  const renderGeneration = buildRenderGenerationArtifact(
    images,
    validated,
    camera,
    renderer,
    reconstruction,
  );
  return { camera, renderer, reconstruction, renderGeneration };
}

function bundleMaterial(images: InputImageFiles, closure: ClosureArtifacts): object {
  return {
    sourceRender: images.sourceRender.receipt,
    browserCaptureRecord: images.captureRecord.receipt,
    protectedMask: images.protectedMask.receipt,
    generatedRegionMask: images.generatedMask.receipt,
    cameraArtifact: closure.camera.reference,
    rendererArtifact: closure.renderer.reference,
    reconstructionArtifact: closure.reconstruction.reference,
    renderGenerationReceipt: closure.renderGeneration.reference,
  };
}

const AUTHORITY_GUARDS = Object.freeze({
  authority: "none",
  providerExecutionPermitted: false,
  modelTrainingPermitted: false,
  reconstructionReplacementPermitted: false,
  sourceTruthReplacementPermitted: false,
  runtimeAdmissionPermitted: false,
  stagingPermitted: false,
  publicationPermitted: false,
  productionPromotionPermitted: false,
});

function buildManifestFile(
  images: InputImageFiles,
  closure: ClosureArtifacts,
): { readonly manifest: GrandHallDifixInputPackManifest; readonly file: PendingFile } {
  const bundleDigest = bundleMaterialSha256(bundleMaterial(images, closure));
  const manifest = GrandHallDifixInputPackManifestSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_INPUT_PACK_SCHEMA,
    packId: "trades-hall-grand-hall-difix-no-reference-source-pose-19890-v1",
    authority: AUTHORITY_GUARDS,
    roomRef: "trades-hall/grand-hall",
    inputLane: "source_derived_diagnostic",
    providerTarget: "difix_no_reference_diagnostic",
    sourceRender: images.sourceRender.receipt,
    browserCaptureRecord: images.captureRecord.receipt,
    protectedMask: {
      ...images.protectedMask.receipt,
      semantics: "white_255_means_protected",
      protectedPixelCount: EXPECTED_PIXEL_COUNT,
    },
    generatedRegionMask: {
      ...images.generatedMask.receipt,
      semantics: "white_255_means_generated_region",
      generatedPixelCount: 0,
    },
    cameraArtifact: closure.camera.reference,
    rendererArtifact: closure.renderer.reference,
    reconstructionArtifact: closure.reconstruction.reference,
    renderGenerationReceipt: closure.renderGeneration.reference,
    bundleMaterialSha256: bundleDigest,
  });
  const manifestBytes = canonicalBytes(manifest);
  const file: PendingFile = {
    bytes: manifestBytes,
    receipt: receipt(GRAND_HALL_DIFIX_MANIFEST_FILENAME, manifestBytes),
  };
  return { manifest, file };
}

function buildPublicationReceipt(
  filesBeforeReceipt: readonly PendingFile[],
  manifestFile: PendingFile,
  bundleDigest: string,
): { readonly publicationReceipt: GrandHallDifixPublicationReceipt; readonly file: PendingFile } {
  const publicationReceipt = GrandHallDifixPublicationReceiptSchema.parse({
    schemaVersion: "venviewer.grand-hall.difix-no-reference-input-pack-publication-receipt.v1",
    authority: "none",
    outputState: "complete_authority_none",
    receiptWrittenLast: true,
    manifest: manifestFile.receipt,
    filesBeforeReceipt: filesBeforeReceipt.map((file) => file.receipt),
    bundleMaterialSha256: bundleDigest,
  });
  const bytes = canonicalBytes(publicationReceipt);
  return {
    publicationReceipt,
    file: {
      bytes,
      receipt: receipt(GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME, bytes),
    },
  };
}

async function buildPendingFiles(
  capture: StableFile,
  browserRecord: StableFile,
  validated: ValidatedCapture,
): Promise<{
  readonly filesBeforeReceipt: readonly PendingFile[];
  readonly receiptFile: PendingFile;
  readonly manifest: GrandHallDifixInputPackManifest;
  readonly publicationReceipt: GrandHallDifixPublicationReceipt;
}> {
  const images = await buildInputImageFiles(capture, browserRecord);
  const closure = buildClosureArtifacts(images, validated);
  const manifest = buildManifestFile(images, closure);
  const filesBeforeReceipt = [
    images.sourceRender,
    images.captureRecord,
    images.protectedMask,
    images.generatedMask,
    closure.camera,
    closure.renderer,
    closure.reconstruction,
    closure.renderGeneration,
    manifest.file,
  ] as const;
  const publication = buildPublicationReceipt(
    filesBeforeReceipt,
    manifest.file,
    manifest.manifest.bundleMaterialSha256,
  );
  return {
    filesBeforeReceipt,
    receiptFile: publication.file,
    manifest: manifest.manifest,
    publicationReceipt: publication.publicationReceipt,
  };
}

async function readPackFile(
  outputDirectory: string,
  expected: GrandHallDifixFileReceipt,
): Promise<StableFile> {
  const target = resolve(outputDirectory, expected.fileName);
  if (dirname(target) !== outputDirectory) fail("OUTPUT_UNSAFE", "Pack receipt contains an unsafe path.");
  const stable = await stableRead(target, expected.fileName, MAX_CAPTURE_PNG_BYTES);
  if (stable.sha256 !== expected.sha256 || stable.bytes.byteLength !== expected.sizeBytes) {
    fail("OUTPUT_INVALID", `Pack file receipt mismatch: ${expected.fileName}.`);
  }
  return stable;
}

function requireDigestAddress(reference: GrandHallDifixArtifactReference): void {
  const expectedSuffix = `.sha256-${reference.sha256.slice("sha256:".length)}.json`;
  const expectedPrefix = {
    camera: "camera",
    renderer: "renderer",
    reconstruction: "reconstruction",
    render_generation: "render-generation-receipt",
  }[reference.artifactType];
  if (reference.fileName !== `${expectedPrefix}${expectedSuffix}`) {
    fail("OUTPUT_INVALID", `Artifact is not digest-addressed: ${reference.fileName}.`);
  }
}

interface LoadedPack {
  readonly outputDirectory: string;
  readonly outputClaim: OutputClaim;
  readonly receiptStable: StableFile;
  readonly publicationReceipt: GrandHallDifixPublicationReceipt;
  readonly expectedNames: readonly string[];
  readonly files: ReadonlyMap<string, StableFile>;
  readonly manifest: GrandHallDifixInputPackManifest;
}

interface PackImages {
  readonly source: StableFile;
  readonly browserRecord: StableFile;
  readonly protectedMask: StableFile;
  readonly generatedMask: StableFile;
}

interface PackArtifactFiles {
  readonly camera: StableFile;
  readonly renderer: StableFile;
  readonly reconstruction: StableFile;
  readonly renderGeneration: StableFile;
}

type PackArtifactDocuments = GrandHallDifixVerifiedArtifactDocuments;

async function openPackDirectory(outputDirectory: string): Promise<OutputClaim> {
  const directoryStats = await lstat(outputDirectory, { bigint: true }).catch((error: unknown) => (
    fail("OUTPUT_INVALID", "Input-pack output directory does not exist.", error)
  ));
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    fail("OUTPUT_UNSAFE", "Input-pack output must be a real directory.");
  }
  return {
    directory: outputDirectory,
    identity: nodeIdentityOf(directoryStats),
  };
}

function parsePublicationReceipt(receiptStable: StableFile): GrandHallDifixPublicationReceipt {
  let publicationReceipt: GrandHallDifixPublicationReceipt;
  try {
    publicationReceipt = GrandHallDifixPublicationReceiptSchema.parse(
      parseGrandHallT554StrictJson(receiptStable.bytes),
    );
  } catch (error: unknown) {
    fail("OUTPUT_INVALID", "Publication receipt is not canonical contract JSON.", error);
  }
  if (!canonicalBytes(publicationReceipt).equals(receiptStable.bytes)) {
    fail("OUTPUT_INVALID", "Publication receipt is not canonical JSON with one terminal LF.");
  }
  return publicationReceipt;
}

function parsePackManifest(
  stable: StableFile,
  publicationReceipt: GrandHallDifixPublicationReceipt,
): GrandHallDifixInputPackManifest {
  let manifest: GrandHallDifixInputPackManifest;
  try {
    manifest = GrandHallDifixInputPackManifestSchema.parse(
      parseGrandHallT554StrictJson(stable.bytes),
    );
  } catch (error: unknown) {
    fail("OUTPUT_INVALID", "Pack manifest is not strict authority-none contract JSON.", error);
  }
  if (
    !canonicalBytes(manifest).equals(stable.bytes)
    || !sameJson(
      publicationReceipt.manifest,
      receipt(GRAND_HALL_DIFIX_MANIFEST_FILENAME, stable.bytes),
    )
    || publicationReceipt.bundleMaterialSha256 !== manifest.bundleMaterialSha256
  ) fail("OUTPUT_INVALID", "Manifest canonical bytes or publication cross-binding failed.");
  return manifest;
}

function baseReceipt(reference: GrandHallDifixFileReceipt): GrandHallDifixFileReceipt {
  return {
    fileName: reference.fileName,
    sizeBytes: reference.sizeBytes,
    sha256: reference.sha256,
  };
}

function requireCanonicalReceiptOrder(
  publicationReceipt: GrandHallDifixPublicationReceipt,
  manifest: GrandHallDifixInputPackManifest,
): void {
  const expected = [
    manifest.sourceRender,
    manifest.browserCaptureRecord,
    manifest.protectedMask,
    manifest.generatedRegionMask,
    manifest.cameraArtifact,
    manifest.rendererArtifact,
    manifest.reconstructionArtifact,
    manifest.renderGenerationReceipt,
    publicationReceipt.manifest,
  ].map(baseReceipt);
  if (!sameJson(publicationReceipt.filesBeforeReceipt, expected)) {
    fail(
      "OUTPUT_INVALID",
      "Publication receipt filesBeforeReceipt is not in the canonical source/record/masks/artifacts/manifest order.",
    );
  }
}

async function loadPack(outputDirectoryInput: string): Promise<LoadedPack> {
  const outputDirectory = canonicalAbsolutePath(outputDirectoryInput, "Output directory");
  const outputClaim = await openPackDirectory(outputDirectory);
  const receiptStable = await stableRead(
    resolve(outputDirectory, GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME),
    "Publication receipt",
    MAX_BROWSER_RECORD_BYTES,
  );
  const publicationReceipt = parsePublicationReceipt(receiptStable);
  const expectedNames = [
    ...publicationReceipt.filesBeforeReceipt.map((entry) => entry.fileName),
    GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME,
  ];
  if (new Set(expectedNames).size !== expectedNames.length) {
    fail("OUTPUT_INVALID", "Publication receipt contains duplicate file names.");
  }
  await exactDirectoryNames(outputDirectory, expectedNames);
  const files = new Map<string, StableFile>();
  for (const fileReceipt of publicationReceipt.filesBeforeReceipt) {
    files.set(fileReceipt.fileName, await readPackFile(outputDirectory, fileReceipt));
  }
  const manifestStable = files.get(GRAND_HALL_DIFIX_MANIFEST_FILENAME);
  if (manifestStable === undefined) fail("OUTPUT_INVALID", "Pack manifest is missing.");
  const manifest = parsePackManifest(manifestStable, publicationReceipt);
  requireCanonicalReceiptOrder(publicationReceipt, manifest);
  return {
    outputDirectory,
    outputClaim,
    receiptStable,
    publicationReceipt,
    expectedNames,
    files,
    manifest,
  };
}

function selectPackImages(pack: LoadedPack): PackImages {
  const source = pack.files.get(pack.manifest.sourceRender.fileName);
  const browserRecord = pack.files.get(pack.manifest.browserCaptureRecord.fileName);
  const protectedMask = pack.files.get(pack.manifest.protectedMask.fileName);
  const generatedMask = pack.files.get(pack.manifest.generatedRegionMask.fileName);
  if (
    source === undefined
    || browserRecord === undefined
    || protectedMask === undefined
    || generatedMask === undefined
  ) {
    fail("OUTPUT_INVALID", "Pack image or masks are missing.");
  }
  return { source, browserRecord, protectedMask, generatedMask };
}

function requireReceiptBinding(
  label: string,
  reference: GrandHallDifixFileReceipt,
  stable: StableFile,
): void {
  if (!sameJson(reference, receipt(reference.fileName, stable.bytes))) {
    fail("OUTPUT_INVALID", `${label} receipt is not cross-bound to its file.`);
  }
}

async function validatePackImages(
  pack: LoadedPack,
  images: PackImages,
): Promise<ValidatedCapture> {
  for (const [label, reference, stable] of [
    ["Source render", pack.manifest.sourceRender, images.source],
    ["Browser record", pack.manifest.browserCaptureRecord, images.browserRecord],
    ["Protected mask", pack.manifest.protectedMask, images.protectedMask],
    ["Generated-region mask", pack.manifest.generatedRegionMask, images.generatedMask],
  ] as const) {
    requireReceiptBinding(label, {
      fileName: reference.fileName,
      sizeBytes: reference.sizeBytes,
      sha256: reference.sha256,
    }, stable);
  }
  const decodedSource = await decodeExactPng(images.source.bytes, "Source render");
  requireExactSourcePng(decodedSource, "OUTPUT_INVALID");
  await requireExactMask(images.protectedMask.bytes, 255, "Protected mask");
  await requireExactMask(images.generatedMask.bytes, 0, "Generated-region mask");
  return parseAndValidateBrowserRecord(images.browserRecord.bytes, images.source, false);
}

function selectArtifactFiles(pack: LoadedPack): PackArtifactFiles {
  for (const reference of [
    pack.manifest.cameraArtifact,
    pack.manifest.rendererArtifact,
    pack.manifest.reconstructionArtifact,
    pack.manifest.renderGenerationReceipt,
  ]) requireDigestAddress(reference);
  if (
    pack.manifest.cameraArtifact.artifactType !== "camera"
    || pack.manifest.rendererArtifact.artifactType !== "renderer"
    || pack.manifest.reconstructionArtifact.artifactType !== "reconstruction"
    || pack.manifest.renderGenerationReceipt.artifactType !== "render_generation"
  ) fail("OUTPUT_INVALID", "Manifest artifact roles do not match their digest-addressed types.");
  const camera = pack.files.get(pack.manifest.cameraArtifact.fileName);
  const renderer = pack.files.get(pack.manifest.rendererArtifact.fileName);
  const reconstruction = pack.files.get(pack.manifest.reconstructionArtifact.fileName);
  const renderGeneration = pack.files.get(pack.manifest.renderGenerationReceipt.fileName);
  if (
    camera === undefined
    || renderer === undefined
    || reconstruction === undefined
    || renderGeneration === undefined
  ) fail("OUTPUT_INVALID", "A digest-addressed closure artifact is missing.");
  return { camera, renderer, reconstruction, renderGeneration };
}

function validateArtifactFileReceipts(pack: LoadedPack, files: PackArtifactFiles): void {
  for (const [reference, stable] of [
    [pack.manifest.cameraArtifact, files.camera],
    [pack.manifest.rendererArtifact, files.renderer],
    [pack.manifest.reconstructionArtifact, files.reconstruction],
    [pack.manifest.renderGenerationReceipt, files.renderGeneration],
  ] as const) {
    requireReceiptBinding("Artifact", {
      fileName: reference.fileName,
      sizeBytes: reference.sizeBytes,
      sha256: reference.sha256,
    }, stable);
  }
}

function parseArtifactDocuments(files: PackArtifactFiles): PackArtifactDocuments {
  try {
    const camera = GrandHallDifixCameraArtifactSchema.parse(
      parseGrandHallT554StrictJson(files.camera.bytes),
    );
    const renderer = GrandHallDifixRendererArtifactSchema.parse(
      parseGrandHallT554StrictJson(files.renderer.bytes),
    );
    const reconstruction = GrandHallDifixReconstructionArtifactSchema.parse(
      parseGrandHallT554StrictJson(files.reconstruction.bytes),
    );
    const renderGeneration = GrandHallDifixRenderGenerationReceiptSchema.parse(
      parseGrandHallT554StrictJson(files.renderGeneration.bytes),
    );
    return { camera, renderer, reconstruction, renderGeneration };
  } catch (error: unknown) {
    fail("OUTPUT_INVALID", "A digest-addressed closure artifact failed strict parsing.", error);
  }
}

function validateCanonicalArtifacts(files: PackArtifactFiles, documents: PackArtifactDocuments): void {
  for (const [value, stable, label] of [
    [documents.camera, files.camera, "camera"],
    [documents.renderer, files.renderer, "renderer"],
    [documents.reconstruction, files.reconstruction, "reconstruction"],
    [documents.renderGeneration, files.renderGeneration, "render-generation"],
  ] as const) {
    if (!canonicalBytes(value).equals(stable.bytes)) {
      fail("OUTPUT_INVALID", `${label} artifact is not canonical JSON with one terminal LF.`);
    }
  }
}

function validateArtifactBindings(
  manifest: GrandHallDifixInputPackManifest,
  documents: PackArtifactDocuments,
  validatedCapture: ValidatedCapture,
): void {
    requireExactJson("Camera artifact fixed camera", documents.camera.fixedCamera, validatedCapture.benchmark.camera);
    requireExactJson(
      "Camera artifact observed camera",
      documents.camera.observedCamera,
      validatedCapture.representation.actualCamera,
    );
    requireExactJson("Renderer artifact settings", documents.renderer.settings, validatedCapture.benchmark.rendererSettings);
    requireExactJson(
      "Renderer artifact viewport",
      documents.renderer.viewport,
      validatedCapture.benchmark.viewport,
    );
    requireExactJson(
      "Renderer artifact observed renderer",
      documents.renderer.observedRenderer,
      validatedCapture.representation.actualRenderer,
    );
    requireExactJson(
      "Renderer artifact environment",
      documents.renderer.environment,
      validatedCapture.representation.environment,
    );
    requireExactJson(
      "Renderer artifact observed capture",
      documents.renderer.observedCapture,
      validatedCapture.observedCapture,
    );
    requireExactJson(
      "Reconstruction artifact members",
      documents.reconstruction.sourceMembers,
      validatedCapture.representation.sourceMembers,
    );
    requireExactJson(
      "Reconstruction artifact runtime",
      documents.reconstruction.runtimeState,
      validatedCapture.representation.sparkRuntimeState,
    );
    requireExactJson("Render receipt source", documents.renderGeneration.sourceRender, manifest.sourceRender);
    requireExactJson(
      "Render receipt browser record",
      documents.renderGeneration.browserCaptureRecord,
      manifest.browserCaptureRecord,
    );
    requireExactJson("Render receipt camera", documents.renderGeneration.cameraArtifact, manifest.cameraArtifact);
    requireExactJson("Render receipt renderer", documents.renderGeneration.rendererArtifact, manifest.rendererArtifact);
    requireExactJson(
      "Render receipt reconstruction",
      documents.renderGeneration.reconstructionArtifact,
      manifest.reconstructionArtifact,
    );
    requireExactJson("Render receipt git", documents.renderGeneration.git, {
      commitSha: validatedCapture.benchmark.gitSha,
      worktreeDirty: validatedCapture.benchmark.worktreeDirty,
      sourceStateSha256: validatedCapture.benchmark.worktreeSourceStateSha256,
    });
    if (
      documents.renderGeneration.runStartedAt !== validatedCapture.benchmark.runStartedAt
      || documents.renderGeneration.runCompletedAt !== validatedCapture.benchmark.runCompletedAt
    ) {
      fail("RECORD_MISMATCH", "Render-generation run window is not cross-bound to the browser record.");
    }
}

function validateBundleDigest(manifest: GrandHallDifixInputPackManifest): void {
  const recomputedBundleDigest = bundleMaterialSha256({
    sourceRender: manifest.sourceRender,
    browserCaptureRecord: manifest.browserCaptureRecord,
    protectedMask: {
      fileName: manifest.protectedMask.fileName,
      sizeBytes: manifest.protectedMask.sizeBytes,
      sha256: manifest.protectedMask.sha256,
    },
    generatedRegionMask: {
      fileName: manifest.generatedRegionMask.fileName,
      sizeBytes: manifest.generatedRegionMask.sizeBytes,
      sha256: manifest.generatedRegionMask.sha256,
    },
    cameraArtifact: manifest.cameraArtifact,
    rendererArtifact: manifest.rendererArtifact,
    reconstructionArtifact: manifest.reconstructionArtifact,
    renderGenerationReceipt: manifest.renderGenerationReceipt,
  });
  if (recomputedBundleDigest !== manifest.bundleMaterialSha256) {
    fail("OUTPUT_INVALID", "Input-pack bundle material digest does not reproduce.");
  }
}

async function requireLoadedPackStable(pack: LoadedPack): Promise<void> {
  await exactDirectoryNames(pack.outputDirectory, pack.expectedNames);
  await assertOutputClaim(pack.outputClaim);
  for (const stable of pack.files.values()) {
    await requireUnchanged(stable, basename(stable.absolutePath), MAX_CAPTURE_PNG_BYTES);
  }
  await requireUnchanged(pack.receiptStable, "Publication receipt", MAX_BROWSER_RECORD_BYTES);
}

export async function checkGrandHallDifixNoReferenceInputPack(
  outputDirectoryInput: string,
): Promise<VerifiedGrandHallDifixInputPack> {
  const pack = await loadPack(outputDirectoryInput);
  const images = selectPackImages(pack);
  const validatedCapture = await validatePackImages(pack, images);
  const artifactFiles = selectArtifactFiles(pack);
  validateArtifactFileReceipts(pack, artifactFiles);
  const artifactDocuments = parseArtifactDocuments(artifactFiles);
  validateCanonicalArtifacts(artifactFiles, artifactDocuments);
  validateArtifactBindings(pack.manifest, artifactDocuments, validatedCapture);
  validateBundleDigest(pack.manifest);
  await requireLoadedPackStable(pack);
  return {
    outputDirectory: pack.outputDirectory,
    manifest: pack.manifest,
    publicationReceipt: pack.publicationReceipt,
    publicationReceiptSha256: pack.receiptStable.sha256,
    artifacts: artifactDocuments,
  };
}

export async function writeGrandHallDifixNoReferenceInputPack(
  optionsInput: GrandHallDifixInputPackOptions,
): Promise<VerifiedGrandHallDifixInputPack> {
  const options = expectedInputPaths(optionsInput);
  await assertSafeOutputParent(options.outputDirectory);
  const [capture, browserRecord] = await Promise.all([
    stableRead(options.capturePngPath, "Capture PNG", MAX_CAPTURE_PNG_BYTES),
    stableRead(options.browserRecordPath, "Browser record", MAX_BROWSER_RECORD_BYTES),
  ]);
  const decodedCapture = await decodeExactPng(capture.bytes, "Capture PNG");
  requireExactSourcePng(decodedCapture, "PNG_INVALID");
  const validated = parseAndValidateBrowserRecord(browserRecord.bytes, capture);
  const built = await buildPendingFiles(capture, browserRecord, validated);
  await Promise.all([
    requireUnchanged(capture, "Capture PNG", MAX_CAPTURE_PNG_BYTES),
    requireUnchanged(browserRecord, "Browser record", MAX_BROWSER_RECORD_BYTES),
  ]);
  const claim = await claimOutputDirectory(options.outputDirectory);
  for (const file of built.filesBeforeReceipt) await writeExclusive(claim, file);
  await exactDirectoryNames(
    options.outputDirectory,
    built.filesBeforeReceipt.map((file) => file.receipt.fileName),
  );
  await Promise.all([
    requireUnchanged(capture, "Capture PNG", MAX_CAPTURE_PNG_BYTES),
    requireUnchanged(browserRecord, "Browser record", MAX_BROWSER_RECORD_BYTES),
  ]);
  await writeExclusive(claim, built.receiptFile);
  return checkGrandHallDifixNoReferenceInputPack(options.outputDirectory);
}

export const GRAND_HALL_DIFIX_INPUT_PACK_USAGE = [
  "Write (create-only):",
  "  grand-hall-difix-input-pack --capture-png <absolute.png> --browser-record <absolute.json> --output <absolute-new-directory>",
  "Check (zero-write):",
  "  grand-hall-difix-input-pack --check --output <absolute-existing-directory>",
].join("\n");

export type GrandHallDifixInputPackArguments =
  | { readonly check: true; readonly outputDirectory: string }
  | GrandHallDifixInputPackOptions & { readonly check: false };

export function parseGrandHallDifixInputPackArguments(
  argumentsInput: readonly string[],
): GrandHallDifixInputPackArguments {
  let check = false;
  const values = new Map<string, string>();
  for (let index = 0; index < argumentsInput.length; index += 1) {
    const argument = argumentsInput[index];
    if (argument === "--check") {
      check = true;
      continue;
    }
    if (!["--capture-png", "--browser-record", "--output"].includes(argument ?? "")) {
      fail("INPUT_INVALID", `Unknown argument ${JSON.stringify(argument)}.`);
    }
    const value = argumentsInput[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail("INPUT_INVALID", `Missing value for ${String(argument)}.`);
    }
    if (values.has(String(argument))) fail("INPUT_INVALID", `Duplicate argument ${String(argument)}.`);
    values.set(String(argument), value);
    index += 1;
  }
  const outputDirectory = values.get("--output");
  if (outputDirectory === undefined) fail("INPUT_INVALID", "Missing --output.");
  if (check) {
    if (values.has("--capture-png") || values.has("--browser-record")) {
      fail("INPUT_INVALID", "--check accepts only --output.");
    }
    return { check: true, outputDirectory };
  }
  const capturePngPath = values.get("--capture-png");
  const browserRecordPath = values.get("--browser-record");
  if (capturePngPath === undefined || browserRecordPath === undefined) {
    fail("INPUT_INVALID", "Write mode requires --capture-png and --browser-record.");
  }
  return { check: false, capturePngPath, browserRecordPath, outputDirectory };
}

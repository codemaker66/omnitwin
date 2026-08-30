import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, mkdtemp, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FOUNDRY_RESTORATION_OPT_IN_STATEMENT,
  FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_CLOSURE_V0,
  FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_MEDIA_TYPE,
  FoundryRestorationExperimentV0Schema,
  compileFoundryRestorationExperimentV0,
  createFoundryRestorationFixedCameraV0,
  createFoundryRestorationMaskAnalysisReceiptV0,
  createFoundryRestorationRenderDerivationReceiptV0,
  domainSeparatedSha256,
  getFoundryRestorationProviderProfileV0,
  stableCanonicalJson,
  toCanonicalJson,
  type FoundryRestorationExperimentV0,
  type FoundryRestorationProviderLockPayloadV0,
} from "@omnitwin/reconstruction-foundry";
import sharp from "sharp";
import { z } from "zod";

import {
  GRAND_HALL_DIFIX_EXACT_CONFIGURATION,
  GRAND_HALL_DIFIX_ADAPTER_ID,
  GRAND_HALL_DIFIX_RUNTIME_ENVIRONMENT_ARTIFACT_SCHEMA,
  GrandHallDifixRuntimeEnvironmentArtifactSchema,
  GrandHallDifixModelSealSchema,
  GrandHallDifixRuntimeSealSchema,
  grandHallDifixExpectedLocalExperimentMaterials,
  type GrandHallDifixModelSeal,
  type GrandHallDifixRuntimeSeal,
} from "./grand-hall-difix-one-shot-contract.js";
import {
  GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME,
  GRAND_HALL_DIFIX_INPUT_HEIGHT,
  GRAND_HALL_DIFIX_INPUT_WIDTH,
  GRAND_HALL_DIFIX_MANIFEST_FILENAME,
  GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME,
  GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME,
  GrandHallDifixCameraArtifactSchema,
  GrandHallDifixInputPackManifestSchema,
  GrandHallDifixPublicationReceiptSchema,
  GrandHallDifixReconstructionArtifactSchema,
  GrandHallDifixRendererArtifactSchema,
  GrandHallDifixRenderGenerationReceiptSchema,
  type GrandHallDifixInputPackManifest,
  type GrandHallDifixPublicationReceipt,
  type GrandHallDifixFileReceipt,
} from "./grand-hall-difix-no-reference-input-pack-contract.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZATION_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-experiment-materialization.v1";
export const GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZATION_RECEIPT_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-experiment-materialization-receipt.v1";
export const GRAND_HALL_DIFIX_RENDERER_IMPLEMENTATION_MANIFEST_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-renderer-implementation-manifest.v1";
export const GRAND_HALL_DIFIX_RENDERER_RUNTIME_ARTIFACT_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-renderer-runtime-artifact.v1";
export const GRAND_HALL_DIFIX_MASK_ANALYZER_CONFIGURATION_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-mask-analyzer-configuration.v1";
export const GRAND_HALL_DIFIX_MASK_ANALYZER_RUNTIME_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-mask-analyzer-runtime.v1";
export const GRAND_HALL_DIFIX_MASK_ANALYSIS_PROCESS_RECEIPT_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-mask-analysis-process-receipt.v1";

const EXPERIMENT_FILENAME = "restoration-experiment.v0.json";
const PARAMETER_CONFIGURATION_FILENAME = "parameter-configuration.json";
const RUNTIME_ENVIRONMENT_FILENAME = "runtime-environment.json";
const RENDERER_IMPLEMENTATION_FILENAME = "renderer-implementation-manifest.json";
const RENDERER_RUNTIME_FILENAME = "renderer-runtime.json";
const MASK_ANALYZER_CONFIGURATION_FILENAME = "mask-analyzer-configuration.json";
const MASK_ANALYZER_RUNTIME_FILENAME = "mask-analyzer-runtime.json";
const PROTECTED_MASK_PROCESS_FILENAME = "protected-mask-analysis-process.json";
const GENERATED_MASK_PROCESS_FILENAME = "generated-mask-analysis-process.json";
const PROVIDER_ADAPTER_FILENAME = "provider-adapter.py";
const MASK_ANALYZER_IMPLEMENTATION_FILENAME = "mask-analyzer-implementation.bin";
const PROTECTED_EVALUATOR_IMPLEMENTATION_FILENAME = "protected-evaluator-implementation.bin";
const PROTECTED_EVALUATOR_CONFIGURATION_FILENAME = "protected-evaluator-configuration.json";
const PROTECTED_EVALUATOR_RUNTIME_FILENAME = "protected-evaluator-runtime.json";
const SEMANTIC_EVALUATOR_IMPLEMENTATION_FILENAME = "semantic-evaluator-implementation.bin";
const SEMANTIC_EVALUATOR_CONFIGURATION_FILENAME = "semantic-evaluator-configuration.json";
const SEMANTIC_EVALUATOR_RUNTIME_FILENAME = "semantic-evaluator-runtime.json";
const PUBLICATION_RECEIPT_FILENAME = "publication-receipt.json";
const MAX_JSON_BYTES = 512 * 1024 * 1024;
const MAX_IMPLEMENTATION_BYTES = 512 * 1024 * 1024;
const EXECUTING_MATERIALIZER_PATH = fileURLToPath(import.meta.url);
const EXPECTED_PIXEL_COUNT = GRAND_HALL_DIFIX_INPUT_WIDTH * GRAND_HALL_DIFIX_INPUT_HEIGHT;
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const SafeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u);
const SafeRelativePathSchema = z.string().min(1).max(2_048).refine((value) => (
  !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === "" || part === "." || part === "..")
), "path must be a safe relative slash-delimited path");
const AbsolutePathSchema = z.string().min(3).max(4_096).refine(isAbsolute, "path must be absolute");

const ExternalArtifactSpecSchema = z.object({
  artifactId: SafeIdSchema,
  absolutePath: AbsolutePathSchema,
  relativePath: SafeRelativePathSchema,
  mediaType: z.string().regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u),
}).strict();

const EvaluatorSpecSchema = z.object({
  implementation: ExternalArtifactSpecSchema,
  configuration: ExternalArtifactSpecSchema.extend({ mediaType: z.literal("application/json") }).strict(),
  runtimeEnvironment: ExternalArtifactSpecSchema.extend({ mediaType: z.literal("application/json") }).strict(),
}).strict();

export const GrandHallDifixExperimentMaterializationSpecSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZATION_SCHEMA),
  experimentId: SafeIdSchema,
  projectId: SafeIdSchema,
  inputPackDirectory: AbsolutePathSchema,
  runtimeSealPath: AbsolutePathSchema,
  modelSealPath: AbsolutePathSchema,
  providerAdapterPath: AbsolutePathSchema,
  rendererImplementationFiles: z.array(ExternalArtifactSpecSchema).min(1).max(128),
  maskAnalyzerImplementation: ExternalArtifactSpecSchema,
  protectedRegionEvaluator: EvaluatorSpecSchema,
  forbiddenSemanticEvaluator: EvaluatorSpecSchema,
  providerReview: z.object({
    reviewedBy: SafeIdSchema,
    reviewedAt: z.string().datetime({ offset: true }),
  }).strict(),
  operatorOptIn: z.object({
    actorId: SafeIdSchema,
    acceptedAt: z.string().datetime({ offset: true }),
    statement: z.literal(FOUNDRY_RESTORATION_OPT_IN_STATEMENT),
  }).strict(),
  outputDirectory: AbsolutePathSchema,
}).strict();
export type GrandHallDifixExperimentMaterializationSpec = z.infer<
  typeof GrandHallDifixExperimentMaterializationSpecSchema
>;

const FileReceiptSchema = z.object({
  fileName: SafeRelativePathSchema,
  sizeBytes: z.number().int().positive(),
  sha256: Sha256Schema,
}).strict();

const ExternalFileBindingSchema = z.object({
  artifactId: SafeIdSchema,
  absolutePath: AbsolutePathSchema,
  relativePath: SafeRelativePathSchema,
  mediaType: z.string().min(3).max(160),
  sizeBytes: z.number().int().positive(),
  sha256: Sha256Schema,
}).strict();

export const GrandHallDifixExperimentMaterializationReceiptSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZATION_RECEIPT_SCHEMA),
  authority: z.literal("none"),
  outputState: z.literal("complete_authority_none"),
  receiptWrittenLast: z.literal(true),
  experiment: FileReceiptSchema.extend({ fileName: z.literal(EXPERIMENT_FILENAME) }).strict(),
  filesBeforeReceipt: z.array(FileReceiptSchema).length(17),
  externalInputs: z.array(ExternalFileBindingSchema).min(8).max(512),
}).strict();
export type GrandHallDifixExperimentMaterializationReceipt = z.infer<
  typeof GrandHallDifixExperimentMaterializationReceiptSchema
>;

export type GrandHallDifixExperimentMaterializationErrorCode =
  | "INPUT_INVALID"
  | "INPUT_RACE"
  | "MATERIAL_INVALID"
  | "OUTPUT_EXISTS"
  | "OUTPUT_INVALID"
  | "OUTPUT_UNSAFE";

export class GrandHallDifixExperimentMaterializationError extends Error {
  constructor(
    readonly code: GrandHallDifixExperimentMaterializationErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallDifixExperimentMaterializationError";
  }
}

interface StableFile {
  readonly absolutePath: string;
  readonly bytes: Buffer;
  readonly sizeBytes: number;
  readonly sha256: `sha256:${string}`;
  readonly identity: string;
}

interface ArtifactRecord {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: `sha256:${string}`;
  readonly canonicalization: "byte_exact" | "rfc8785_json";
  readonly immutable: true;
  readonly accessMode: "read_only";
  readonly authority: "none";
}

type JsonArtifactRecord = Omit<ArtifactRecord, "mediaType" | "canonicalization"> & {
  readonly mediaType: "application/json";
  readonly canonicalization: "rfc8785_json";
};

type ImageArtifactRecord = Omit<ArtifactRecord, "mediaType" | "canonicalization"> & {
  readonly mediaType: "image/png";
  readonly canonicalization: "byte_exact";
  readonly width: number;
  readonly height: number;
};

interface PendingFile {
  readonly receipt: z.infer<typeof FileReceiptSchema>;
  readonly bytes: Buffer;
}

interface LoadedExternalArtifact {
  readonly spec: z.infer<typeof ExternalArtifactSpecSchema>;
  readonly stable: StableFile;
  readonly artifact: ArtifactRecord;
  readonly binding: z.infer<typeof ExternalFileBindingSchema>;
}

interface MaskFacts {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly decodedWidth: number;
  readonly decodedHeight: number;
  readonly pixelCount: number;
  readonly zeroPixelCount: number;
  readonly onePixelCount: number;
  readonly nonzeroPixelCount: number;
  readonly coverageFraction: number;
  readonly state: "all_zero" | "all_one" | "partial";
}

function fail(
  code: GrandHallDifixExperimentMaterializationErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new GrandHallDifixExperimentMaterializationError(code, message, cause);
}

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function canonicalPath(value: string, label: string): string {
  if (!isAbsolute(value)) fail("OUTPUT_UNSAFE", `${label} must be absolute.`);
  const canonical = resolve(value);
  if (canonical !== normalize(value)) fail("OUTPUT_UNSAFE", `${label} must be normalized and traversal-free.`);
  return canonical;
}

function samePath(left: string, right: string): boolean {
  const normalizeCase = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
  return normalizeCase(resolve(left)) === normalizeCase(resolve(right));
}

function nodeIdentity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(":");
}

function directoryIdentity(stats: BigIntStats): string {
  return [stats.dev, stats.ino].map(String).join(":");
}

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return nodeIdentity(left) === nodeIdentity(right);
}

async function stableRead(inputPath: string, label: string, maximumBytes: number): Promise<StableFile> {
  const absolutePath = canonicalPath(inputPath, label);
  const physicalPath = await realpath(absolutePath).catch((error: unknown) =>
    fail("INPUT_INVALID", `${label} cannot be resolved.`, error));
  if (!samePath(absolutePath, physicalPath)) fail("INPUT_INVALID", `${label} must not traverse a link or junction.`);
  const pathBefore = await lstat(absolutePath, { bigint: true }).catch((error: unknown) =>
    fail("INPUT_INVALID", `${label} is unavailable.`, error));
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) fail("INPUT_INVALID", `${label} must be a direct regular file.`);
  if (pathBefore.nlink !== 1n) fail("INPUT_INVALID", `${label} must have exactly one hard link.`);
  if (pathBefore.size <= 0n || pathBefore.size > BigInt(maximumBytes)) fail("INPUT_INVALID", `${label} has an invalid byte length.`);
  const handle = await open(absolutePath, "r");
  try {
    const openedBefore = await handle.stat({ bigint: true });
    if (!sameNode(pathBefore, openedBefore)) fail("INPUT_RACE", `${label} changed while opening.`);
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolutePath, { bigint: true });
    if (!sameNode(openedBefore, openedAfter) || !sameNode(openedAfter, pathAfter) || bytes.byteLength !== Number(openedAfter.size)) {
      fail("INPUT_RACE", `${label} changed during its stable read.`);
    }
    return { absolutePath, bytes, sizeBytes: bytes.byteLength, sha256: sha256(bytes), identity: nodeIdentity(openedAfter) };
  } finally {
    await handle.close();
  }
}

async function requireUnchanged(file: StableFile, label: string, maximumBytes: number): Promise<void> {
  const repeated = await stableRead(file.absolutePath, label, maximumBytes);
  if (repeated.identity !== file.identity || repeated.sha256 !== file.sha256 || !repeated.bytes.equals(file.bytes)) {
    fail("INPUT_RACE", `${label} changed after validation.`);
  }
}

function requireCanonicalJson(file: StableFile, label: string): unknown {
  const parsed = parseGrandHallT554StrictJson(file.bytes);
  if (!file.bytes.equals(canonicalBytes(parsed))) {
    fail("MATERIAL_INVALID", `${label} must use exact canonical JSON bytes with one LF terminator.`);
  }
  return parsed;
}

function artifactRecord(
  artifactId: string,
  relativePath: string,
  mediaType: string,
  bytes: Buffer,
): ArtifactRecord {
  return {
    artifactId,
    relativePath,
    mediaType,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
    canonicalization: mediaType === "application/json" || mediaType.endsWith("+json") ? "rfc8785_json" : "byte_exact",
    immutable: true,
    accessMode: "read_only",
    authority: "none",
  };
}

function requireFileReceipt(file: StableFile, receipt: GrandHallDifixFileReceipt, label: string): void {
  if (file.sizeBytes !== receipt.sizeBytes || file.sha256 !== receipt.sha256) {
    fail("INPUT_RACE", `${label} no longer matches the verified input-pack receipt.`);
  }
}

function pendingJson(fileName: string, value: unknown): PendingFile {
  const bytes = canonicalBytes(value);
  return { receipt: { fileName, sizeBytes: bytes.byteLength, sha256: sha256(bytes) }, bytes };
}

function pendingBytes(fileName: string, bytes: Buffer): PendingFile {
  return { receipt: { fileName, sizeBytes: bytes.byteLength, sha256: sha256(bytes) }, bytes };
}

function artifactForPending(artifactId: string, file: PendingFile): JsonArtifactRecord {
  return {
    ...artifactRecord(artifactId, file.receipt.fileName, "application/json", file.bytes),
    mediaType: "application/json",
    canonicalization: "rfc8785_json",
  };
}

function byteArtifactForPending(
  artifactId: string,
  mediaType: string,
  file: PendingFile,
): ArtifactRecord {
  return artifactRecord(artifactId, file.receipt.fileName, mediaType, file.bytes);
}

async function loadExternalArtifact(
  specInput: z.infer<typeof ExternalArtifactSpecSchema>,
  label: string,
): Promise<LoadedExternalArtifact> {
  const spec = ExternalArtifactSpecSchema.parse(specInput);
  const stable = await stableRead(spec.absolutePath, label, MAX_IMPLEMENTATION_BYTES);
  const canonicalization = spec.mediaType === "application/json" || spec.mediaType.endsWith("+json")
    ? "rfc8785_json" as const
    : "byte_exact" as const;
  if (canonicalization === "rfc8785_json") requireCanonicalJson(stable, label);
  return {
    spec,
    stable,
    artifact: { ...artifactRecord(spec.artifactId, spec.relativePath, spec.mediaType, stable.bytes), canonicalization },
    binding: {
      artifactId: spec.artifactId,
      absolutePath: stable.absolutePath,
      relativePath: spec.relativePath,
      mediaType: spec.mediaType,
      sizeBytes: stable.sizeBytes,
      sha256: stable.sha256,
    },
  };
}

export function deriveGrandHallDifixFixedCameraViewMatrix(
  position: readonly [number, number, number],
  quaternion: readonly [number, number, number, number],
): number[] {
  const [x, y, z, w] = quaternion;
  const quaternionNorm = Math.hypot(x, y, z, w);
  if (!Number.isFinite(quaternionNorm) || Math.abs(quaternionNorm - 1) > 1e-12) {
    fail("MATERIAL_INVALID", "Fixed-camera quaternion must be finite and normalized before view-matrix derivation.");
  }
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const xy = x * y2; const xz = x * z2;
  const yy = y * y2; const yz = y * z2; const zz = z * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;
  const r00 = 1 - (yy + zz); const r01 = xy - wz; const r02 = xz + wy;
  const r10 = xy + wz; const r11 = 1 - (xx + zz); const r12 = yz - wx;
  const r20 = xz - wy; const r21 = yz + wx; const r22 = 1 - (xx + yy);
  const [px, py, pz] = position;
  return [
    r00, r01, r02, 0,
    r10, r11, r12, 0,
    r20, r21, r22, 0,
    -(r00 * px + r10 * py + r20 * pz),
    -(r01 * px + r11 * py + r21 * pz),
    -(r02 * px + r12 * py + r22 * pz),
    1,
  ];
}

async function analyzeMask(file: StableFile, label: string): Promise<MaskFacts> {
  const startedAt = new Date().toISOString();
  const decoded = await sharp(file.bytes, {
    failOn: "error",
    limitInputPixels: EXPECTED_PIXEL_COUNT,
    sequentialRead: true,
  }).toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== GRAND_HALL_DIFIX_INPUT_WIDTH || decoded.info.height !== GRAND_HALL_DIFIX_INPUT_HEIGHT || decoded.info.channels !== 1) {
    fail("MATERIAL_INVALID", `${label} must decode as the exact one-channel Grand Hall mask extent.`);
  }
  let zeroPixelCount = 0;
  let onePixelCount = 0;
  for (const value of decoded.data) {
    if (value === 0) zeroPixelCount += 1;
    if (value === 255) onePixelCount += 1;
  }
  const nonzeroPixelCount = decoded.data.length - zeroPixelCount;
  const state = zeroPixelCount === decoded.data.length ? "all_zero" : onePixelCount === decoded.data.length ? "all_one" : "partial";
  let completedAt = new Date().toISOString();
  while (Date.parse(startedAt) >= Date.parse(completedAt)) {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 1));
    completedAt = new Date().toISOString();
  }
  return {
    startedAt,
    completedAt,
    decodedWidth: decoded.info.width,
    decodedHeight: decoded.info.height,
    pixelCount: decoded.data.length,
    zeroPixelCount,
    onePixelCount,
    nonzeroPixelCount,
    coverageFraction: nonzeroPixelCount / decoded.data.length,
    state,
  };
}

function imageArtifact(
  artifactId: string,
  relativePath: string,
  receipt: GrandHallDifixFileReceipt,
): ImageArtifactRecord {
  return {
    artifactId,
    relativePath,
    mediaType: "image/png",
    sizeBytes: receipt.sizeBytes,
    sha256: receipt.sha256 as `sha256:${string}`,
    canonicalization: "byte_exact",
    immutable: true,
    accessMode: "read_only",
    authority: "none",
    width: GRAND_HALL_DIFIX_INPUT_WIDTH,
    height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
  };
}

function reviewedLicenseEvidence(
  officialLicenseComponents: NonNullable<ReturnType<typeof getFoundryRestorationProviderProfileV0>["repositoryRequirements"][number]["officialLicenseComponents"]>,
  document: NonNullable<ReturnType<typeof getFoundryRestorationProviderProfileV0>["repositoryRequirements"][number]["licenseDocument"]>,
  reviewedBy: string,
  reviewedAt: string,
) {
  return {
    officialLicenseFacts: { document, components: officialLicenseComponents },
    projectPolicyReview: {
      reviewedUsePosture: "noncommercial_internal_r_and_d_only" as const,
      reviewedBy,
      reviewedAt,
      commercialUseAllowed: false as const,
      distributionAllowed: false as const,
    },
  };
}

function buildProviderLock(
  runtimeSeal: GrandHallDifixRuntimeSeal,
  modelSeal: GrandHallDifixModelSeal,
  review: GrandHallDifixExperimentMaterializationSpec["providerReview"],
): FoundryRestorationProviderLockPayloadV0 {
  const profile = getFoundryRestorationProviderProfileV0("difix3d_plus");
  const repository = profile.repositoryRequirements.find((entry) => entry.role === "difix3d_source");
  const model = profile.modelRequirements.find((entry) => entry.role === "difix_checkpoint");
  if (repository?.repositoryId === null || repository?.repositoryId === undefined || repository.revision === null ||
      repository.officialLicenseComponents === null || repository.licenseDocument === null ||
      model?.modelId === null || model?.modelId === undefined || model.revision === null ||
      model.officialLicenseComponents === null || model.licenseDocument === null) {
    return fail("MATERIAL_INVALID", "The canonical Difix provider profile is missing its audited official identity.");
  }
  return {
    lane: "difix3d_plus",
    reviewedBy: review.reviewedBy,
    reviewedAt: review.reviewedAt,
    exactOfficialIdentityReviewed: true,
    repositories: [{
      role: repository.role,
      repositoryId: repository.repositoryId,
      revision: repository.revision,
      sourceArchiveSha256: runtimeSeal.sourceArchive.sha256,
      licenseEvidence: reviewedLicenseEvidence(repository.officialLicenseComponents, repository.licenseDocument, review.reviewedBy, review.reviewedAt),
    }],
    models: [{
      role: model.role,
      modelId: model.modelId,
      revision: model.revision,
      repositoryManifestSha256: modelSeal.auditedSnapshotManifestSha256,
      access: model.access,
      licenseEvidence: reviewedLicenseEvidence(model.officialLicenseComponents, model.licenseDocument, review.reviewedBy, review.reviewedAt),
      weights: modelSeal.expectedWeightFiles.map((weight) => ({ ...weight })),
    }],
  };
}

interface ClaimedStagingDirectory {
  readonly target: string;
  readonly staging: string;
  readonly identity: string;
}

async function requireAbsent(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
    fail("OUTPUT_EXISTS", `${label} must be absent.`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function claimStagingDirectory(outputDirectoryInput: string): Promise<ClaimedStagingDirectory> {
  const target = canonicalPath(outputDirectoryInput, "Output directory");
  const parent = dirname(target);
  const parentPhysical = await realpath(parent).catch((error: unknown) =>
    fail("OUTPUT_UNSAFE", "Output parent must already exist.", error));
  if (!samePath(parent, parentPhysical)) fail("OUTPUT_UNSAFE", "Output parent must not traverse a link or junction.");
  await requireAbsent(target, "Output directory");
  const staging = await mkdtemp(join(parent, `.${basename(target)}.staging-`));
  const metadata = await lstat(staging, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(staging, await realpath(staging))) {
    fail("OUTPUT_UNSAFE", "Claimed staging directory is not a direct directory.");
  }
  return { target, staging, identity: directoryIdentity(metadata) };
}

async function requireStagingIdentity(claim: ClaimedStagingDirectory): Promise<void> {
  const metadata = await lstat(claim.staging, { bigint: true }).catch((error: unknown) =>
    fail("OUTPUT_UNSAFE", "Claimed staging directory disappeared.", error));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || directoryIdentity(metadata) !== claim.identity ||
      !samePath(claim.staging, await realpath(claim.staging))) {
    fail("OUTPUT_UNSAFE", "Claimed staging directory identity changed.");
  }
}

async function writeExclusive(claim: ClaimedStagingDirectory, file: PendingFile): Promise<void> {
  await requireStagingIdentity(claim);
  const path = resolve(claim.staging, file.receipt.fileName);
  if (dirname(path) !== claim.staging) fail("OUTPUT_UNSAFE", `Unsafe materialization member path: ${file.receipt.fileName}.`);
  const handle = await open(path, "wx", 0o600).catch((error: unknown) =>
    fail("OUTPUT_EXISTS", `Materialization member already exists: ${file.receipt.fileName}.`, error));
  try {
    await handle.writeFile(file.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await requireStagingIdentity(claim);
}

async function publishStagingDirectory(
  claim: ClaimedStagingDirectory,
  hook?: GrandHallDifixExperimentMaterializationTestHooks["afterPublishedIdentityRead"],
): Promise<void> {
  await requireStagingIdentity(claim);
  await requireAbsent(claim.target, "Output directory");
  await rename(claim.staging, claim.target).catch((error: unknown) =>
    fail("OUTPUT_EXISTS", "Atomic publication failed because the output target is no longer absent.", error));
  const published = await lstat(claim.target, { bigint: true });
  await hook?.({ targetDirectory: claim.target, publishedIdentity: directoryIdentity(published) });
  const physical = await realpath(claim.target);
  const publishedAfterResolution = await lstat(claim.target, { bigint: true });
  if (!published.isDirectory() || published.isSymbolicLink() || !publishedAfterResolution.isDirectory() ||
      publishedAfterResolution.isSymbolicLink() || directoryIdentity(published) !== claim.identity ||
      directoryIdentity(publishedAfterResolution) !== claim.identity || !samePath(claim.target, physical)) {
    fail("OUTPUT_UNSAFE", "Published output directory identity does not match the verified staging directory.");
  }
}

async function cleanupStagingDirectory(claim: ClaimedStagingDirectory): Promise<void> {
  try {
    await requireStagingIdentity(claim);
    await rm(claim.staging, { recursive: true, force: false });
  } catch {
    // Never remove a path whose identity no longer matches the directory created here.
  }
}

function requireDisjointPaths(spec: GrandHallDifixExperimentMaterializationSpec): void {
  const output = resolve(spec.outputDirectory);
  const inputPack = resolve(spec.inputPackDirectory);
  const packRelationship = relative(inputPack, output);
  if (output === inputPack || (packRelationship !== "" && !packRelationship.startsWith("..") && !isAbsolute(packRelationship))) {
    fail("OUTPUT_UNSAFE", "Output directory cannot be inside the immutable input pack.");
  }
  const inputs = [
    spec.inputPackDirectory,
    spec.runtimeSealPath,
    spec.modelSealPath,
    spec.providerAdapterPath,
    ...spec.rendererImplementationFiles.map((entry) => entry.absolutePath),
    spec.maskAnalyzerImplementation.absolutePath,
    spec.protectedRegionEvaluator.implementation.absolutePath,
    spec.protectedRegionEvaluator.configuration.absolutePath,
    spec.protectedRegionEvaluator.runtimeEnvironment.absolutePath,
    spec.forbiddenSemanticEvaluator.implementation.absolutePath,
    spec.forbiddenSemanticEvaluator.configuration.absolutePath,
    spec.forbiddenSemanticEvaluator.runtimeEnvironment.absolutePath,
  ].map((value) => resolve(value));
  for (const input of inputs) {
    const relationship = relative(output, input);
    if (input === output || (relationship !== "" && !relationship.startsWith("..") && !isAbsolute(relationship))) {
      fail("OUTPUT_UNSAFE", "Output directory cannot contain any bound input material.");
    }
  }
}

async function exactDirectoryInventory(directory: string, expected: readonly string[]): Promise<void> {
  const actual = (await readdir(directory)).sort();
  const sortedExpected = [...expected].sort();
  if (stableCanonicalJson(actual) !== stableCanonicalJson(sortedExpected)) {
    fail("OUTPUT_INVALID", "Materialization directory inventory is incomplete or contains unexpected files.");
  }
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) === stableCanonicalJson(toCanonicalJson(right));
}

function requireReceiptEntry(
  receipt: GrandHallDifixPublicationReceipt,
  expected: GrandHallDifixFileReceipt,
  label: string,
): void {
  const actual = receipt.filesBeforeReceipt.find((entry) => entry.fileName === expected.fileName);
  if (actual === undefined || actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) {
    fail("MATERIAL_INVALID", `${label} is not bound by the exact input-pack publication receipt.`);
  }
}

function inputPackBundleMaterial(manifest: GrandHallDifixInputPackManifest): object {
  return {
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
  };
}

interface PublishedInputPackMetadata {
  readonly outputDirectory: string;
  readonly manifest: GrandHallDifixInputPackManifest;
  readonly publicationReceipt: GrandHallDifixPublicationReceipt;
  readonly publicationReceiptSha256: `sha256:${string}`;
  readonly manifestFile: StableFile;
  readonly publicationReceiptFile: StableFile;
  readonly sourceRenderFile: StableFile;
  readonly browserCaptureRecordFile: StableFile;
}

async function loadPublishedInputPackMetadata(
  inputPackDirectory: string,
): Promise<PublishedInputPackMetadata> {
  const outputDirectory = canonicalPath(inputPackDirectory, "Input-pack directory");
  const receiptFile = await stableRead(
    resolve(outputDirectory, GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME),
    "Input-pack publication receipt",
    MAX_JSON_BYTES,
  );
  const publicationReceipt = GrandHallDifixPublicationReceiptSchema.parse(
    requireCanonicalJson(receiptFile, "Input-pack publication receipt"),
  );
  const manifestFile = await stableRead(
    resolve(outputDirectory, GRAND_HALL_DIFIX_MANIFEST_FILENAME),
    "Input-pack manifest",
    MAX_JSON_BYTES,
  );
  requireFileReceipt(manifestFile, publicationReceipt.manifest, "Input-pack manifest");
  const manifest = GrandHallDifixInputPackManifestSchema.parse(
    requireCanonicalJson(manifestFile, "Input-pack manifest"),
  );
  if (manifest.bundleMaterialSha256 !== publicationReceipt.bundleMaterialSha256) {
    fail("MATERIAL_INVALID", "Input-pack manifest and publication receipt bundle digests disagree.");
  }
  const expectedBundleSha256 = `sha256:${domainSeparatedSha256(
    "VENVIEWER_GRAND_HALL_DIFIX_INPUT_PACK_V1",
    toCanonicalJson(inputPackBundleMaterial(manifest)),
  )}`;
  if (manifest.bundleMaterialSha256 !== expectedBundleSha256) {
    fail("MATERIAL_INVALID", "Input-pack bundle material digest does not reproduce from metadata.");
  }
  for (const [label, expected] of [
    ["source render", manifest.sourceRender],
    ["browser capture record", manifest.browserCaptureRecord],
    ["protected mask", manifest.protectedMask],
    ["generated-region mask", manifest.generatedRegionMask],
    ["camera artifact", manifest.cameraArtifact],
    ["renderer artifact", manifest.rendererArtifact],
    ["reconstruction descriptor", manifest.reconstructionArtifact],
    ["render-generation receipt", manifest.renderGenerationReceipt],
    ["manifest", publicationReceipt.manifest],
  ] as const) requireReceiptEntry(publicationReceipt, expected, label);
  const expectedNames = [
    ...publicationReceipt.filesBeforeReceipt.map((entry) => entry.fileName),
    GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME,
  ];
  if (new Set(expectedNames).size !== expectedNames.length) {
    fail("MATERIAL_INVALID", "Input-pack publication receipt contains duplicate member names.");
  }
  await exactDirectoryInventory(outputDirectory, expectedNames);
  const [sourceRenderFile, browserCaptureRecordFile] = await Promise.all([
    stableRead(resolve(outputDirectory, manifest.sourceRender.fileName), "Source render bytes", MAX_IMPLEMENTATION_BYTES),
    stableRead(resolve(outputDirectory, manifest.browserCaptureRecord.fileName), "Browser capture record", MAX_JSON_BYTES),
  ]);
  requireFileReceipt(sourceRenderFile, manifest.sourceRender, "Source render");
  requireFileReceipt(browserCaptureRecordFile, manifest.browserCaptureRecord, "Browser capture record");
  return {
    outputDirectory,
    manifest,
    publicationReceipt,
    publicationReceiptSha256: receiptFile.sha256,
    manifestFile,
    publicationReceiptFile: receiptFile,
    sourceRenderFile,
    browserCaptureRecordFile,
  };
}

async function loadEvaluator(
  spec: z.infer<typeof EvaluatorSpecSchema>,
  label: string,
): Promise<{ readonly implementation: LoadedExternalArtifact; readonly configuration: LoadedExternalArtifact; readonly runtime: LoadedExternalArtifact }> {
  const [implementation, configuration, runtime] = await Promise.all([
    loadExternalArtifact(spec.implementation, `${label} implementation`),
    loadExternalArtifact(spec.configuration, `${label} configuration`),
    loadExternalArtifact(spec.runtimeEnvironment, `${label} runtime environment`),
  ]);
  return { implementation, configuration, runtime };
}

interface EvaluatorBinding {
  readonly implementationArtifact: ArtifactRecord;
  readonly configurationArtifact: JsonArtifactRecord;
  readonly runtimeEnvironmentArtifact: JsonArtifactRecord;
}

interface MaterializedEvaluator {
  readonly files: readonly [PendingFile, PendingFile, PendingFile];
  readonly binding: EvaluatorBinding;
}

function materializeEvaluator(
  evaluator: Awaited<ReturnType<typeof loadEvaluator>>,
  fileNames: readonly [string, string, string],
): MaterializedEvaluator {
  const implementation = pendingBytes(fileNames[0], evaluator.implementation.stable.bytes);
  const configuration = pendingBytes(fileNames[1], evaluator.configuration.stable.bytes);
  const runtime = pendingBytes(fileNames[2], evaluator.runtime.stable.bytes);
  return {
    files: [implementation, configuration, runtime],
    binding: {
      implementationArtifact: byteArtifactForPending(
        evaluator.implementation.spec.artifactId,
        evaluator.implementation.spec.mediaType,
        implementation,
      ),
      configurationArtifact: artifactForPending(
        evaluator.configuration.spec.artifactId,
        configuration,
      ),
      runtimeEnvironmentArtifact: artifactForPending(
        evaluator.runtime.spec.artifactId,
        runtime,
      ),
    },
  };
}

function buildRendererImplementationManifest(
  files: readonly LoadedExternalArtifact[],
  sourceState: z.infer<typeof GrandHallDifixRenderGenerationReceiptSchema>["git"],
  materializationExternalInputs: readonly z.infer<typeof ExternalFileBindingSchema>[],
): object {
  return {
    schemaVersion: GRAND_HALL_DIFIX_RENDERER_IMPLEMENTATION_MANIFEST_SCHEMA,
    authority: "none",
    closureSemantics: "reviewed_entrypoints_plus_render_receipt_source_state",
    sourceState,
    reviewedEntrypoints: files.map((file) => ({
      role: file.spec.artifactId,
      sourcePath: file.stable.absolutePath,
      sizeBytes: file.stable.sizeBytes,
      sha256: file.stable.sha256,
      mediaType: file.spec.mediaType,
      relativePath: file.spec.relativePath,
    })).sort((left, right) => left.role.localeCompare(right.role, "en")),
    materializationExternalInputs,
  };
}

function buildRuntimeEnvironmentArtifact(runtimeSealFile: StableFile, runtimeSeal: GrandHallDifixRuntimeSeal): object {
  return GrandHallDifixRuntimeEnvironmentArtifactSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_RUNTIME_ENVIRONMENT_ARTIFACT_SCHEMA,
    authority: "none",
    runtimeSealArtifact: {
      sourcePath: runtimeSealFile.absolutePath,
      sizeBytes: runtimeSealFile.sizeBytes,
      sha256: runtimeSealFile.sha256,
    },
    runtimeSealSha256: runtimeSeal.runtimeSealSha256,
    runtimeId: runtimeSeal.runtimeId,
    providerRepositoryId: runtimeSeal.providerRepositoryId,
    providerRevision: runtimeSeal.providerRevision,
    sourceArchive: {
      sizeBytes: runtimeSeal.sourceArchive.sizeBytes,
      sha256: runtimeSeal.sourceArchive.sha256,
    },
    sealedForOfflineExecution: runtimeSeal.sealedForOfflineExecution,
  });
}

function buildRendererRuntimeArtifact(
  renderer: z.infer<typeof GrandHallDifixRendererArtifactSchema>,
  rendererReceipt: GrandHallDifixFileReceipt,
  browserRecordReceipt: GrandHallDifixFileReceipt,
): object {
  return {
    schemaVersion: GRAND_HALL_DIFIX_RENDERER_RUNTIME_ARTIFACT_SCHEMA,
    authority: "none",
    rendererArtifact: rendererReceipt,
    browserCaptureRecord: browserRecordReceipt,
    engine: renderer.engine,
    viewport: renderer.viewport,
    observedCapture: renderer.observedCapture,
    observedRenderer: renderer.observedRenderer,
    environment: renderer.environment,
  };
}

function buildMaskProcessReceipt(
  maskRole: "protected_region" | "generated_region",
  mask: ReturnType<typeof imageArtifact>,
  facts: MaskFacts,
  implementation: ArtifactRecord,
  configuration: ArtifactRecord,
  runtime: ArtifactRecord,
): object {
  return {
    schemaVersion: GRAND_HALL_DIFIX_MASK_ANALYSIS_PROCESS_RECEIPT_SCHEMA,
    authority: "none",
    maskRole,
    maskArtifact: mask,
    analyzerImplementationSha256: implementation.sha256,
    analyzerConfigurationSha256: configuration.sha256,
    analyzerRuntimeSha256: runtime.sha256,
    ...facts,
  };
}

function maskAnalysisReceipt(
  mask: ReturnType<typeof imageArtifact>,
  facts: MaskFacts,
  implementation: ArtifactRecord,
  configuration: JsonArtifactRecord,
  runtime: JsonArtifactRecord,
  processArtifact: JsonArtifactRecord,
) {
  return createFoundryRestorationMaskAnalysisReceiptV0({
    maskArtifact: mask,
    analyzerImplementationArtifact: implementation,
    analyzerConfigurationArtifact: configuration,
    analyzerRuntimeArtifact: runtime,
    analyzerProcessReceiptArtifact: processArtifact,
    ...facts,
  });
}

interface MaterializationContext {
  readonly spec: GrandHallDifixExperimentMaterializationSpec;
  readonly runtimeSealFile: StableFile;
  readonly runtimeSeal: GrandHallDifixRuntimeSeal;
  readonly modelSealFile: StableFile;
  readonly modelSeal: GrandHallDifixModelSeal;
  readonly adapter: LoadedExternalArtifact;
  readonly rendererImplementationFiles: readonly LoadedExternalArtifact[];
  readonly maskAnalyzerImplementation: LoadedExternalArtifact;
  readonly executingMaterializerFile: StableFile;
  readonly protectedEvaluator: Awaited<ReturnType<typeof loadEvaluator>>;
  readonly semanticEvaluator: Awaited<ReturnType<typeof loadEvaluator>>;
}

async function loadMaterializationContext(
  spec: GrandHallDifixExperimentMaterializationSpec,
): Promise<MaterializationContext> {
  const adapterSpec = ExternalArtifactSpecSchema.parse({
    artifactId: GRAND_HALL_DIFIX_ADAPTER_ID,
    absolutePath: spec.providerAdapterPath,
    relativePath: "implementations/grand_hall_difix_no_reference_adapter.py",
    mediaType: "text/x-python",
  });
  const [runtimeSealFile, modelSealFile, adapter, rendererImplementationFiles, maskAnalyzerImplementation, executingMaterializerFile, protectedEvaluator, semanticEvaluator] = await Promise.all([
    stableRead(spec.runtimeSealPath, "Runtime seal", MAX_JSON_BYTES),
    stableRead(spec.modelSealPath, "Model seal", MAX_JSON_BYTES),
    loadExternalArtifact(adapterSpec, "Difix provider adapter"),
    Promise.all(spec.rendererImplementationFiles.map((file, index) => loadExternalArtifact(file, `Renderer implementation file ${String(index + 1)}`))),
    loadExternalArtifact(spec.maskAnalyzerImplementation, "Mask analyzer implementation"),
    stableRead(EXECUTING_MATERIALIZER_PATH, "Executing mask analyzer implementation", MAX_IMPLEMENTATION_BYTES),
    loadEvaluator(spec.protectedRegionEvaluator, "Protected-region evaluator"),
    loadEvaluator(spec.forbiddenSemanticEvaluator, "Forbidden-semantic evaluator"),
  ]);
  const runtimeSeal = GrandHallDifixRuntimeSealSchema.parse(requireCanonicalJson(runtimeSealFile, "Runtime seal"));
  const modelSeal = GrandHallDifixModelSealSchema.parse(requireCanonicalJson(modelSealFile, "Model seal"));
  if (
    maskAnalyzerImplementation.stable.sha256 !== executingMaterializerFile.sha256 ||
    maskAnalyzerImplementation.stable.sizeBytes !== executingMaterializerFile.sizeBytes
  ) {
    fail("MATERIAL_INVALID", "Mask analyzer implementation must be byte-identical to the executing materializer module.");
  }
  return {
    spec,
    runtimeSealFile,
    runtimeSeal,
    modelSealFile,
    modelSeal,
    adapter,
    rendererImplementationFiles,
    maskAnalyzerImplementation,
    executingMaterializerFile,
    protectedEvaluator,
    semanticEvaluator,
  };
}

function contextExternalArtifacts(context: MaterializationContext): readonly LoadedExternalArtifact[] {
  return [
    context.adapter,
    ...context.rendererImplementationFiles,
    context.maskAnalyzerImplementation,
    context.protectedEvaluator.implementation,
    context.protectedEvaluator.configuration,
    context.protectedEvaluator.runtime,
    context.semanticEvaluator.implementation,
    context.semanticEvaluator.configuration,
    context.semanticEvaluator.runtime,
  ];
}

async function reverifyContext(context: MaterializationContext): Promise<void> {
  await Promise.all([
    requireUnchanged(context.runtimeSealFile, "Runtime seal", MAX_JSON_BYTES),
    requireUnchanged(context.modelSealFile, "Model seal", MAX_JSON_BYTES),
    requireUnchanged(context.executingMaterializerFile, "Executing mask analyzer implementation", MAX_IMPLEMENTATION_BYTES),
    ...contextExternalArtifacts(context).map((artifact) =>
      requireUnchanged(artifact.stable, artifact.spec.artifactId, MAX_IMPLEMENTATION_BYTES)),
  ]);
}

async function reverifyInputPackMaterials(files: readonly StableFile[]): Promise<void> {
  await Promise.all(files.map((file) => requireUnchanged(file, file.absolutePath, MAX_JSON_BYTES)));
}

function assertChronology(spec: GrandHallDifixExperimentMaterializationSpec, createdAt: string): void {
  if (Date.parse(spec.providerReview.reviewedAt) > Date.parse(createdAt)) {
    fail("MATERIAL_INVALID", "Provider review cannot postdate experiment compilation.");
  }
  if (Date.parse(spec.operatorOptIn.acceptedAt) > Date.parse(createdAt)) {
    fail("MATERIAL_INVALID", "Operator opt-in cannot postdate experiment compilation.");
  }
}

export interface VerifiedGrandHallDifixExperimentMaterialization {
  readonly outputDirectory: string;
  readonly experiment: FoundryRestorationExperimentV0;
  readonly receipt: GrandHallDifixExperimentMaterializationReceipt;
  readonly receiptSha256: `sha256:${string}`;
}

export interface GrandHallDifixExperimentMaterializationTestHooks {
  readonly afterStagingClaimed?: (context: {
    readonly stagingDirectory: string;
    readonly targetDirectory: string;
  }) => Promise<void> | void;
  readonly afterPublishedBeforeCheck?: (context: {
    readonly targetDirectory: string;
    readonly publishedIdentity: string;
  }) => Promise<void> | void;
  readonly afterPublishedIdentityRead?: (context: {
    readonly targetDirectory: string;
    readonly publishedIdentity: string;
  }) => Promise<void> | void;
}

async function stableDirectoryIdentity(path: string, expectedIdentity?: string): Promise<string> {
  const before = await lstat(path, { bigint: true }).catch((error: unknown) =>
    fail("OUTPUT_INVALID", "Materialization directory is unavailable.", error));
  if (!before.isDirectory() || before.isSymbolicLink()) fail("OUTPUT_INVALID", "Materialization directory must be direct.");
  const identity = directoryIdentity(before);
  if (expectedIdentity !== undefined && identity !== expectedIdentity) fail("OUTPUT_INVALID", "Materialization directory identity changed.");
  const physical = await realpath(path).catch((error: unknown) => fail("OUTPUT_INVALID", "Materialization directory cannot be resolved.", error));
  const after = await lstat(path, { bigint: true }).catch((error: unknown) =>
    fail("OUTPUT_INVALID", "Materialization directory disappeared during verification.", error));
  if (!samePath(path, physical) || !after.isDirectory() || after.isSymbolicLink() || directoryIdentity(after) !== identity) {
    fail("OUTPUT_INVALID", "Materialization directory changed during path verification.");
  }
  return identity;
}

export async function writeGrandHallDifixExperimentMaterialization(
  specInput: GrandHallDifixExperimentMaterializationSpec,
  testHooks?: GrandHallDifixExperimentMaterializationTestHooks,
): Promise<VerifiedGrandHallDifixExperimentMaterialization> {
  const spec = GrandHallDifixExperimentMaterializationSpecSchema.parse(specInput);
  requireDisjointPaths(spec);
  const verifiedPack = await loadPublishedInputPackMetadata(spec.inputPackDirectory);
  const context = await loadMaterializationContext(spec);
  const manifest = verifiedPack.manifest;
  const packRoot = resolve(verifiedPack.outputDirectory);
  const [cameraFile, rendererFile, reconstructionFile, renderGenerationFile, protectedMaskFile, generatedMaskFile] = await Promise.all([
    stableRead(resolve(packRoot, manifest.cameraArtifact.fileName), "Camera artifact", MAX_JSON_BYTES),
    stableRead(resolve(packRoot, manifest.rendererArtifact.fileName), "Renderer artifact", MAX_JSON_BYTES),
    stableRead(resolve(packRoot, manifest.reconstructionArtifact.fileName), "Reconstruction descriptor", MAX_JSON_BYTES),
    stableRead(resolve(packRoot, manifest.renderGenerationReceipt.fileName), "Render-generation receipt", MAX_JSON_BYTES),
    stableRead(resolve(packRoot, GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME), "Protected mask", MAX_JSON_BYTES),
    stableRead(resolve(packRoot, GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME), "Generated-region mask", MAX_JSON_BYTES),
  ]);
  requireFileReceipt(cameraFile, manifest.cameraArtifact, "Camera artifact");
  requireFileReceipt(rendererFile, manifest.rendererArtifact, "Renderer artifact");
  requireFileReceipt(reconstructionFile, manifest.reconstructionArtifact, "Reconstruction descriptor");
  requireFileReceipt(renderGenerationFile, manifest.renderGenerationReceipt, "Render-generation receipt");
  requireFileReceipt(protectedMaskFile, manifest.protectedMask, "Protected mask");
  requireFileReceipt(generatedMaskFile, manifest.generatedRegionMask, "Generated-region mask");
  const cameraArtifact = GrandHallDifixCameraArtifactSchema.parse(requireCanonicalJson(cameraFile, "Camera artifact"));
  const rendererArtifact = GrandHallDifixRendererArtifactSchema.parse(requireCanonicalJson(rendererFile, "Renderer artifact"));
  const reconstructionArtifact = GrandHallDifixReconstructionArtifactSchema.parse(requireCanonicalJson(reconstructionFile, "Reconstruction descriptor"));
  const renderGeneration = GrandHallDifixRenderGenerationReceiptSchema.parse(
    requireCanonicalJson(renderGenerationFile, "Render-generation receipt"),
  );
  if (
    !canonicalEqual(renderGeneration.sourceRender, manifest.sourceRender) ||
    !canonicalEqual(renderGeneration.cameraArtifact, manifest.cameraArtifact) ||
    !canonicalEqual(renderGeneration.rendererArtifact, manifest.rendererArtifact) ||
    !canonicalEqual(renderGeneration.reconstructionArtifact, manifest.reconstructionArtifact)
  ) {
    return fail("MATERIAL_INVALID", "Render-generation receipt does not cross-bind the exact source closure.");
  }
  const stablePackMaterials = [
    verifiedPack.manifestFile,
    verifiedPack.publicationReceiptFile,
    verifiedPack.sourceRenderFile,
    verifiedPack.browserCaptureRecordFile,
    cameraFile,
    rendererFile,
    reconstructionFile,
    renderGenerationFile,
    protectedMaskFile,
    generatedMaskFile,
  ] as const;
  const [protectedFacts, generatedFacts] = await Promise.all([
    analyzeMask(protectedMaskFile, "Protected mask"),
    analyzeMask(generatedMaskFile, "Generated-region mask"),
  ]);
  if (protectedFacts.state !== "all_one" || generatedFacts.state !== "all_zero") {
    return fail("MATERIAL_INVALID", "The Difix no-reference lane requires an all-one protected mask and all-zero generated-region mask.");
  }

  const externalInputBindings = ExternalFileBindingSchema.array().parse([
    { artifactId: "runtime-seal", absolutePath: context.runtimeSealFile.absolutePath, relativePath: "seals/runtime-seal.json", mediaType: "application/json", sizeBytes: context.runtimeSealFile.sizeBytes, sha256: context.runtimeSealFile.sha256 },
    { artifactId: "model-seal", absolutePath: context.modelSealFile.absolutePath, relativePath: "seals/model-seal.json", mediaType: "application/json", sizeBytes: context.modelSealFile.sizeBytes, sha256: context.modelSealFile.sha256 },
    ...contextExternalArtifacts(context).map((artifact) => artifact.binding),
    { artifactId: "input-pack-source-render", absolutePath: verifiedPack.sourceRenderFile.absolutePath, relativePath: manifest.sourceRender.fileName, mediaType: "image/png", sizeBytes: verifiedPack.sourceRenderFile.sizeBytes, sha256: verifiedPack.sourceRenderFile.sha256 },
    { artifactId: "input-pack-browser-capture-record", absolutePath: verifiedPack.browserCaptureRecordFile.absolutePath, relativePath: manifest.browserCaptureRecord.fileName, mediaType: "application/json", sizeBytes: verifiedPack.browserCaptureRecordFile.sizeBytes, sha256: verifiedPack.browserCaptureRecordFile.sha256 },
    { artifactId: "input-pack-manifest", absolutePath: verifiedPack.manifestFile.absolutePath, relativePath: GRAND_HALL_DIFIX_MANIFEST_FILENAME, mediaType: "application/json", sizeBytes: verifiedPack.manifestFile.sizeBytes, sha256: verifiedPack.manifestFile.sha256 },
    { artifactId: "input-pack-publication-receipt", absolutePath: verifiedPack.publicationReceiptFile.absolutePath, relativePath: GRAND_HALL_DIFIX_PUBLICATION_RECEIPT_FILENAME, mediaType: "application/json", sizeBytes: verifiedPack.publicationReceiptFile.sizeBytes, sha256: verifiedPack.publicationReceiptFile.sha256 },
    { artifactId: "input-pack-camera", absolutePath: cameraFile.absolutePath, relativePath: manifest.cameraArtifact.fileName, mediaType: "application/json", sizeBytes: cameraFile.sizeBytes, sha256: cameraFile.sha256 },
    { artifactId: "input-pack-renderer", absolutePath: rendererFile.absolutePath, relativePath: manifest.rendererArtifact.fileName, mediaType: "application/json", sizeBytes: rendererFile.sizeBytes, sha256: rendererFile.sha256 },
    { artifactId: "input-pack-reconstruction", absolutePath: reconstructionFile.absolutePath, relativePath: manifest.reconstructionArtifact.fileName, mediaType: FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_MEDIA_TYPE, sizeBytes: reconstructionFile.sizeBytes, sha256: reconstructionFile.sha256 },
    { artifactId: "input-pack-render-generation-receipt", absolutePath: renderGenerationFile.absolutePath, relativePath: manifest.renderGenerationReceipt.fileName, mediaType: "application/json", sizeBytes: renderGenerationFile.sizeBytes, sha256: renderGenerationFile.sha256 },
    { artifactId: "input-pack-protected-mask", absolutePath: protectedMaskFile.absolutePath, relativePath: GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME, mediaType: "image/png", sizeBytes: protectedMaskFile.sizeBytes, sha256: protectedMaskFile.sha256 },
    { artifactId: "input-pack-generated-mask", absolutePath: generatedMaskFile.absolutePath, relativePath: GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME, mediaType: "image/png", sizeBytes: generatedMaskFile.sizeBytes, sha256: generatedMaskFile.sha256 },
  ].sort((left, right) => left.artifactId.localeCompare(right.artifactId, "en")));

  const parameterFile = pendingJson(PARAMETER_CONFIGURATION_FILENAME, GRAND_HALL_DIFIX_EXACT_CONFIGURATION);
  const runtimeFile = pendingJson(RUNTIME_ENVIRONMENT_FILENAME, buildRuntimeEnvironmentArtifact(context.runtimeSealFile, context.runtimeSeal));
  const rendererImplementationFile = pendingJson(
    RENDERER_IMPLEMENTATION_FILENAME,
    buildRendererImplementationManifest(context.rendererImplementationFiles, renderGeneration.git, externalInputBindings),
  );
  const rendererRuntimeFile = pendingJson(RENDERER_RUNTIME_FILENAME, buildRendererRuntimeArtifact(rendererArtifact, manifest.rendererArtifact, manifest.browserCaptureRecord));
  const maskConfigurationFile = pendingJson(MASK_ANALYZER_CONFIGURATION_FILENAME, {
    schemaVersion: GRAND_HALL_DIFIX_MASK_ANALYZER_CONFIGURATION_SCHEMA,
    authority: "none",
    decoder: "sharp_raw_grayscale",
    width: GRAND_HALL_DIFIX_INPUT_WIDTH,
    height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
    zeroValue: 0,
    oneValue: 255,
    nonzeroRule: "value_greater_than_zero",
  });
  const maskRuntimeFile = pendingJson(MASK_ANALYZER_RUNTIME_FILENAME, {
    schemaVersion: GRAND_HALL_DIFIX_MASK_ANALYZER_RUNTIME_SCHEMA,
    authority: "none",
    nodeVersion: process.versions.node,
    sharpVersion: sharp.versions.sharp,
    implementationSha256: context.maskAnalyzerImplementation.stable.sha256,
  });
  const adapterMaterialFile = pendingBytes(PROVIDER_ADAPTER_FILENAME, context.adapter.stable.bytes);
  const maskImplementationFile = pendingBytes(
    MASK_ANALYZER_IMPLEMENTATION_FILENAME,
    context.maskAnalyzerImplementation.stable.bytes,
  );
  const protectedEvaluator = materializeEvaluator(context.protectedEvaluator, [
    PROTECTED_EVALUATOR_IMPLEMENTATION_FILENAME,
    PROTECTED_EVALUATOR_CONFIGURATION_FILENAME,
    PROTECTED_EVALUATOR_RUNTIME_FILENAME,
  ]);
  const semanticEvaluator = materializeEvaluator(context.semanticEvaluator, [
    SEMANTIC_EVALUATOR_IMPLEMENTATION_FILENAME,
    SEMANTIC_EVALUATOR_CONFIGURATION_FILENAME,
    SEMANTIC_EVALUATOR_RUNTIME_FILENAME,
  ]);
  const adapterMaterialArtifact = byteArtifactForPending(
    GRAND_HALL_DIFIX_ADAPTER_ID,
    context.adapter.spec.mediaType,
    adapterMaterialFile,
  );
  const maskImplementationArtifact = byteArtifactForPending(
    context.maskAnalyzerImplementation.spec.artifactId,
    context.maskAnalyzerImplementation.spec.mediaType,
    maskImplementationFile,
  );
  const parameterArtifact = artifactForPending("grand-hall-difix-exact-parameters", parameterFile);
  const runtimeArtifact = artifactForPending("grand-hall-difix-runtime-environment", runtimeFile);
  const rendererImplementationManifestArtifact = artifactForPending("grand-hall-source-renderer-implementation", rendererImplementationFile);
  const rendererRuntimeArtifact = artifactForPending("grand-hall-source-renderer-runtime", rendererRuntimeFile);
  const maskConfigurationArtifact = artifactForPending("grand-hall-mask-analyzer-configuration", maskConfigurationFile);
  const maskRuntimeArtifact = artifactForPending("grand-hall-mask-analyzer-runtime", maskRuntimeFile);
  const protectedMaskArtifact = imageArtifact("grand-hall-protected-region-mask", GRAND_HALL_DIFIX_PROTECTED_MASK_FILENAME, manifest.protectedMask);
  const generatedMaskArtifact = imageArtifact("grand-hall-generated-region-mask", GRAND_HALL_DIFIX_GENERATED_MASK_FILENAME, manifest.generatedRegionMask);
  const protectedProcessFile = pendingJson(PROTECTED_MASK_PROCESS_FILENAME, buildMaskProcessReceipt(
    "protected_region", protectedMaskArtifact, protectedFacts, maskImplementationArtifact, maskConfigurationArtifact, maskRuntimeArtifact,
  ));
  const generatedProcessFile = pendingJson(GENERATED_MASK_PROCESS_FILENAME, buildMaskProcessReceipt(
    "generated_region", generatedMaskArtifact, generatedFacts, maskImplementationArtifact, maskConfigurationArtifact, maskRuntimeArtifact,
  ));
  const protectedAnalysis = maskAnalysisReceipt(
    protectedMaskArtifact, protectedFacts, maskImplementationArtifact, maskConfigurationArtifact, maskRuntimeArtifact,
    artifactForPending("grand-hall-protected-mask-analysis-process", protectedProcessFile),
  );
  const generatedAnalysis = maskAnalysisReceipt(
    generatedMaskArtifact, generatedFacts, maskImplementationArtifact, maskConfigurationArtifact, maskRuntimeArtifact,
    artifactForPending("grand-hall-generated-mask-analysis-process", generatedProcessFile),
  );
  const createdAt = new Date().toISOString();
  assertChronology(spec, createdAt);
  const fixedCamera = createFoundryRestorationFixedCameraV0({
    cameraId: cameraArtifact.fixedCamera.id,
    coordinateFrameId: "three_world",
    viewMatrixColumnMajor: deriveGrandHallDifixFixedCameraViewMatrix(cameraArtifact.fixedCamera.position, cameraArtifact.fixedCamera.quaternion),
    projectionMatrixColumnMajor: [...cameraArtifact.fixedCamera.projectionMatrix],
    width: GRAND_HALL_DIFIX_INPUT_WIDTH,
    height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
    rendererProfileSha256: manifest.rendererArtifact.sha256,
    colorSpace: "srgb",
  });
  const sourceNamespace = "source/trades-hall/grand-hall/difix/input-pack";
  const sourceRenderInput = {
    role: "source_fixed_camera_render",
    artifactId: "grand-hall-source-fixed-camera-render",
    namespace: sourceNamespace,
    relativePath: GRAND_HALL_DIFIX_SOURCE_RENDER_FILENAME,
    mediaType: "image/png",
    width: GRAND_HALL_DIFIX_INPUT_WIDTH,
    height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
    sizeBytes: manifest.sourceRender.sizeBytes,
    sha256: manifest.sourceRender.sha256,
    canonicalization: "byte_exact" as const,
    immutable: true,
    accessMode: "read_only" as const,
    truthLayer: "SOURCE_DERIVED_TRUTH" as const,
    artifactClass: "source_derived_reconstruction_render" as const,
    preparationLineage: null,
    reconstructionDescriptorClosure: null,
    authority: "none" as const,
  };
  const reconstructionClosure = {
    schemaVersion: FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_CLOSURE_V0,
    descriptorSchemaVersion: reconstructionArtifact.schemaVersion,
    descriptorSizeBytes: reconstructionFile.sizeBytes,
    descriptorSha256: reconstructionFile.sha256,
    format: reconstructionArtifact.format,
    representationId: reconstructionArtifact.representationId,
    sourceVariant: reconstructionArtifact.sourceVariant,
    decodedElementCount: reconstructionArtifact.decodedSplatCount,
    memberCount: reconstructionArtifact.sourceMembers.length,
    totalMemberBytes: reconstructionArtifact.sourceMembers.reduce((total, member) => total + member.sizeBytes, 0),
    members: reconstructionArtifact.sourceMembers.map((member) => ({ ...member })),
  } as const;
  const reconstructionInput = {
    role: "source_reconstruction",
    artifactId: "grand-hall-source-reconstruction-descriptor",
    namespace: sourceNamespace,
    relativePath: manifest.reconstructionArtifact.fileName,
    mediaType: FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_MEDIA_TYPE,
    width: null,
    height: null,
    sizeBytes: reconstructionFile.sizeBytes,
    sha256: reconstructionFile.sha256,
    canonicalization: "rfc8785_json" as const,
    immutable: true,
    accessMode: "read_only" as const,
    truthLayer: "SOURCE_DERIVED_TRUTH" as const,
    artifactClass: "source_derived_reconstruction" as const,
    preparationLineage: null,
    reconstructionDescriptorClosure: reconstructionClosure,
    authority: "none" as const,
  };
  const reconstructionDerivationArtifact = {
    artifactId: reconstructionInput.artifactId,
    relativePath: reconstructionInput.relativePath,
    mediaType: reconstructionInput.mediaType,
    sizeBytes: reconstructionInput.sizeBytes,
    sha256: reconstructionInput.sha256,
    canonicalization: reconstructionInput.canonicalization,
    immutable: true as const,
    accessMode: "read_only" as const,
    authority: "none" as const,
  };
  const sourceRenderDerivationArtifact = {
    artifactId: sourceRenderInput.artifactId,
    relativePath: sourceRenderInput.relativePath,
    mediaType: "image/png" as const,
    sizeBytes: sourceRenderInput.sizeBytes,
    sha256: sourceRenderInput.sha256,
    canonicalization: "byte_exact" as const,
    immutable: true as const,
    accessMode: "read_only" as const,
    authority: "none" as const,
    width: GRAND_HALL_DIFIX_INPUT_WIDTH,
    height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
  };
  const renderDerivationReceipt = createFoundryRestorationRenderDerivationReceiptV0({
    sourceReconstructionArtifact: reconstructionDerivationArtifact,
    cameraId: fixedCamera.cameraId,
    cameraSha256: fixedCamera.cameraSha256,
    rendererProfileArtifact: {
      artifactId: "grand-hall-source-renderer-profile",
      relativePath: manifest.rendererArtifact.fileName,
      mediaType: "application/json",
      sizeBytes: rendererFile.sizeBytes,
      sha256: rendererFile.sha256,
      canonicalization: "rfc8785_json",
      immutable: true,
      accessMode: "read_only",
      authority: "none",
    },
    rendererImplementationArtifact: rendererImplementationManifestArtifact,
    rendererRuntimeArtifact,
    sourceRenderArtifact: sourceRenderDerivationArtifact,
  });
  const experiment = compileFoundryRestorationExperimentV0({
    experimentId: spec.experimentId,
    projectId: spec.projectId,
    createdAt,
    lane: "difix3d_plus",
    providerVariant: "difix",
    providerLock: buildProviderLock(context.runtimeSeal, context.modelSeal, spec.providerReview),
    plannedExecution: {
      providerAdapterId: GRAND_HALL_DIFIX_ADAPTER_ID,
      providerAdapterImplementationArtifact: adapterMaterialArtifact,
      parameterConfigurationArtifact: parameterArtifact,
      runtimeEnvironmentArtifact: runtimeArtifact,
      fixedCameraClosures: [{
        cameraId: fixedCamera.cameraId,
        cameraSha256: fixedCamera.cameraSha256,
        renderDerivationReceipt,
        protectedRegionMask: { artifact: protectedMaskArtifact, maskRole: "protected_region", analysis: protectedAnalysis },
        generatedRegionMask: { artifact: generatedMaskArtifact, maskRole: "generated_region", analysis: generatedAnalysis },
        protectedRegionEvaluator: protectedEvaluator.binding,
        forbiddenSemanticEvaluator: semanticEvaluator.binding,
      }],
    },
    operatorOptIn: spec.operatorOptIn,
    inputs: [sourceRenderInput, reconstructionInput],
    fixedCameras: [fixedCamera],
  });
  const experimentFile = pendingJson(EXPERIMENT_FILENAME, experiment);
  const filesBeforeReceipt = [
    parameterFile,
    runtimeFile,
    rendererImplementationFile,
    rendererRuntimeFile,
    maskConfigurationFile,
    maskRuntimeFile,
    adapterMaterialFile,
    maskImplementationFile,
    ...protectedEvaluator.files,
    ...semanticEvaluator.files,
    protectedProcessFile,
    generatedProcessFile,
    experimentFile,
  ] as const;
  await Promise.all([reverifyContext(context), reverifyInputPackMaterials(stablePackMaterials)]);
  const receipt = GrandHallDifixExperimentMaterializationReceiptSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZATION_RECEIPT_SCHEMA,
    authority: "none",
    outputState: "complete_authority_none",
    receiptWrittenLast: true,
    experiment: experimentFile.receipt,
    filesBeforeReceipt: filesBeforeReceipt.map((file) => file.receipt),
    externalInputs: externalInputBindings,
  });
  const receiptFile = pendingJson(PUBLICATION_RECEIPT_FILENAME, receipt);
  const staging = await claimStagingDirectory(spec.outputDirectory);
  let published = false;
  try {
    await testHooks?.afterStagingClaimed?.({
      stagingDirectory: staging.staging,
      targetDirectory: staging.target,
    });
    await requireStagingIdentity(staging);
    for (const file of filesBeforeReceipt) await writeExclusive(staging, file);
    await exactDirectoryInventory(staging.staging, filesBeforeReceipt.map((file) => file.receipt.fileName));
    await Promise.all([reverifyContext(context), reverifyInputPackMaterials(stablePackMaterials)]);
    await writeExclusive(staging, receiptFile);
    await exactDirectoryInventory(staging.staging, [...filesBeforeReceipt.map((file) => file.receipt.fileName), PUBLICATION_RECEIPT_FILENAME]);
    await Promise.all([reverifyContext(context), reverifyInputPackMaterials(stablePackMaterials)]);
    await publishStagingDirectory(staging, testHooks?.afterPublishedIdentityRead);
    published = true;
  } finally {
    if (!published) await cleanupStagingDirectory(staging);
  }
  await testHooks?.afterPublishedBeforeCheck?.({ targetDirectory: staging.target, publishedIdentity: staging.identity });
  return checkGrandHallDifixExperimentMaterializationImpl(staging.target, staging.identity);
}

async function checkGrandHallDifixExperimentMaterializationImpl(
  outputDirectoryInput: string,
  expectedDirectoryIdentity?: string,
): Promise<VerifiedGrandHallDifixExperimentMaterialization> {
  const outputDirectory = canonicalPath(outputDirectoryInput, "Materialization output directory");
  const verifiedDirectoryIdentity = await stableDirectoryIdentity(outputDirectory, expectedDirectoryIdentity);
  const receiptStable = await stableRead(resolve(outputDirectory, PUBLICATION_RECEIPT_FILENAME), "Materialization publication receipt", MAX_JSON_BYTES);
  const receipt = GrandHallDifixExperimentMaterializationReceiptSchema.parse(requireCanonicalJson(receiptStable, "Materialization publication receipt"));
  const expectedNames = [...receipt.filesBeforeReceipt.map((file) => file.fileName), PUBLICATION_RECEIPT_FILENAME];
  if (new Set(expectedNames).size !== expectedNames.length) {
    fail("OUTPUT_INVALID", "Materialization receipt contains duplicate member names.");
  }
  await exactDirectoryInventory(outputDirectory, expectedNames);
  const experimentStable = await stableRead(resolve(outputDirectory, receipt.experiment.fileName), "Restoration experiment", MAX_JSON_BYTES);
  if (experimentStable.sizeBytes !== receipt.experiment.sizeBytes || experimentStable.sha256 !== receipt.experiment.sha256) {
    fail("OUTPUT_INVALID", "Restoration experiment receipt mismatch.");
  }
  const experiment = FoundryRestorationExperimentV0Schema.parse(requireCanonicalJson(experimentStable, "Restoration experiment"));
  const plannedExpectations = grandHallDifixExpectedLocalExperimentMaterials(experiment);
  const fixedMaterialNames = [
    PARAMETER_CONFIGURATION_FILENAME,
    RUNTIME_ENVIRONMENT_FILENAME,
    RENDERER_IMPLEMENTATION_FILENAME,
    RENDERER_RUNTIME_FILENAME,
    MASK_ANALYZER_CONFIGURATION_FILENAME,
    MASK_ANALYZER_RUNTIME_FILENAME,
    PROVIDER_ADAPTER_FILENAME,
    MASK_ANALYZER_IMPLEMENTATION_FILENAME,
    PROTECTED_EVALUATOR_IMPLEMENTATION_FILENAME,
    PROTECTED_EVALUATOR_CONFIGURATION_FILENAME,
    PROTECTED_EVALUATOR_RUNTIME_FILENAME,
    SEMANTIC_EVALUATOR_IMPLEMENTATION_FILENAME,
    SEMANTIC_EVALUATOR_CONFIGURATION_FILENAME,
    SEMANTIC_EVALUATOR_RUNTIME_FILENAME,
    PROTECTED_MASK_PROCESS_FILENAME,
    GENERATED_MASK_PROCESS_FILENAME,
  ].sort();
  if (!canonicalEqual(plannedExpectations.map((entry) => entry.relativePath).sort(), fixedMaterialNames)) {
    fail("OUTPUT_INVALID", "Parsed experiment does not bind the exact fixed Grand Hall material inventory.");
  }
  const receiptByName = new Map(receipt.filesBeforeReceipt.map((entry) => [entry.fileName, entry]));
  if (!canonicalEqual([...receiptByName.keys()].sort(), [...fixedMaterialNames, EXPERIMENT_FILENAME].sort())) {
    fail("OUTPUT_INVALID", "Publication receipt does not exactly cover the experiment-derived material inventory.");
  }
  const planned = experiment.plannedExecutionLock;
  const plannedArtifacts = [
    planned.providerAdapterImplementationArtifact,
    planned.parameterConfigurationArtifact,
    planned.runtimeEnvironmentArtifact,
    ...planned.fixedCameraClosures.flatMap((closure) => [
      closure.renderDerivationReceipt.rendererImplementationArtifact,
      closure.renderDerivationReceipt.rendererRuntimeArtifact,
      closure.protectedRegionMask.analysis.analyzerImplementationArtifact,
      closure.protectedRegionMask.analysis.analyzerConfigurationArtifact,
      closure.protectedRegionMask.analysis.analyzerRuntimeArtifact,
      closure.protectedRegionMask.analysis.analyzerProcessReceiptArtifact,
      closure.generatedRegionMask.analysis.analyzerImplementationArtifact,
      closure.generatedRegionMask.analysis.analyzerConfigurationArtifact,
      closure.generatedRegionMask.analysis.analyzerRuntimeArtifact,
      closure.generatedRegionMask.analysis.analyzerProcessReceiptArtifact,
      closure.protectedRegionEvaluator.implementationArtifact,
      closure.protectedRegionEvaluator.configurationArtifact,
      closure.protectedRegionEvaluator.runtimeEnvironmentArtifact,
      closure.forbiddenSemanticEvaluator.implementationArtifact,
      closure.forbiddenSemanticEvaluator.configurationArtifact,
      closure.forbiddenSemanticEvaluator.runtimeEnvironmentArtifact,
    ]),
  ];
  const localMaterials = new Map<string, StableFile>();
  for (const expected of plannedExpectations) {
    const receiptEntry = receiptByName.get(expected.relativePath);
    if (receiptEntry === undefined || receiptEntry.sizeBytes !== expected.sizeBytes || receiptEntry.sha256 !== expected.sha256) {
      fail("OUTPUT_INVALID", `Receipt disagrees with experiment-derived material ${expected.relativePath}.`);
    }
    const actual = await stableRead(resolve(outputDirectory, expected.relativePath), expected.relativePath, MAX_IMPLEMENTATION_BYTES);
    localMaterials.set(expected.relativePath, actual);
    if (actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) {
      fail("OUTPUT_INVALID", `Material bytes disagree with experiment-derived binding ${expected.relativePath}.`);
    }
    const artifactBindings = plannedArtifacts.filter((artifact) => artifact.relativePath === expected.relativePath);
    if (artifactBindings.length === 0 || artifactBindings.some((artifact) =>
      artifact.sizeBytes !== actual.sizeBytes || artifact.sha256 !== actual.sha256)) {
      fail("OUTPUT_INVALID", `Material ${expected.relativePath} is not consistently cross-bound by the planned execution.`);
    }
    if (artifactBindings.some((artifact) => artifact.canonicalization === "rfc8785_json")) {
      requireCanonicalJson(actual, `Planned JSON material ${expected.relativePath}`);
    }
  }
  const rendererManifestFile = localMaterials.get(RENDERER_IMPLEMENTATION_FILENAME);
  const runtimeEnvironmentFile = localMaterials.get(RUNTIME_ENVIRONMENT_FILENAME);
  if (rendererManifestFile === undefined || runtimeEnvironmentFile === undefined) fail("OUTPUT_INVALID", "Required local binding manifests are missing.");
  const rendererManifest = z.object({
    reviewedEntrypoints: z.array(z.object({
      role: SafeIdSchema,
      sourcePath: AbsolutePathSchema,
      sizeBytes: z.number().int().positive(),
      sha256: Sha256Schema,
      mediaType: z.string().min(3),
      relativePath: SafeRelativePathSchema,
    }).passthrough()).min(1),
    materializationExternalInputs: ExternalFileBindingSchema.array().min(1).max(512),
  }).passthrough().parse(requireCanonicalJson(rendererManifestFile, "Renderer implementation manifest"));
  const runtimeEnvironment = GrandHallDifixRuntimeEnvironmentArtifactSchema.parse(
    requireCanonicalJson(runtimeEnvironmentFile, "Runtime environment artifact"),
  );
  const closure = planned.fixedCameraClosures[0];
  if (closure === undefined) fail("OUTPUT_INVALID", "The exact fixed-camera closure is missing.");
  const sourceInput = experiment.inputs.find((input) => input.role === "source_fixed_camera_render");
  const reconstructionInput = experiment.inputs.find((input) => input.role === "source_reconstruction");
  if (sourceInput === undefined || reconstructionInput === undefined) fail("OUTPUT_INVALID", "The exact source inputs are missing.");
  const plannedById = new Map(plannedArtifacts.map((artifact) => [artifact.artifactId, artifact]));
  const externallySourcedPlannedArtifacts = [
    planned.providerAdapterImplementationArtifact,
    closure.protectedRegionMask.analysis.analyzerImplementationArtifact,
    closure.generatedRegionMask.analysis.analyzerImplementationArtifact,
    closure.protectedRegionEvaluator.implementationArtifact,
    closure.protectedRegionEvaluator.configurationArtifact,
    closure.protectedRegionEvaluator.runtimeEnvironmentArtifact,
    closure.forbiddenSemanticEvaluator.implementationArtifact,
    closure.forbiddenSemanticEvaluator.configurationArtifact,
    closure.forbiddenSemanticEvaluator.runtimeEnvironmentArtifact,
  ];
  const expectedExternalIds = new Set<string>([
    "runtime-seal", "model-seal",
    "input-pack-source-render", "input-pack-browser-capture-record", "input-pack-manifest",
    "input-pack-publication-receipt", "input-pack-camera", "input-pack-renderer",
    "input-pack-reconstruction", "input-pack-render-generation-receipt",
    "input-pack-protected-mask", "input-pack-generated-mask",
    ...externallySourcedPlannedArtifacts.map((artifact) => artifact.artifactId),
    ...rendererManifest.reviewedEntrypoints.map((entry) => entry.role),
  ]);
  const externalIds = receipt.externalInputs.map((entry) => entry.artifactId);
  if (new Set(externalIds).size !== externalIds.length ||
      !canonicalEqual(externalIds, [...externalIds].sort((left, right) => left.localeCompare(right, "en"))) ||
      !canonicalEqual([...externalIds].sort(), [...expectedExternalIds].sort())) {
    fail("OUTPUT_INVALID", "External-input receipt must be the exact unique sorted experiment-derived binding set.");
  }
  if (!canonicalEqual(receipt.externalInputs, rendererManifest.materializationExternalInputs)) {
    fail("OUTPUT_INVALID", "External-input receipt disagrees with the exact experiment-bound full external-input closure.");
  }
  const externalById = new Map(receipt.externalInputs.map((entry) => [entry.artifactId, entry]));
  for (const entry of receipt.externalInputs) {
    const current = await stableRead(entry.absolutePath, `External input ${entry.artifactId}`, MAX_IMPLEMENTATION_BYTES);
    if (current.sizeBytes !== entry.sizeBytes || current.sha256 !== entry.sha256) {
      fail("OUTPUT_INVALID", `External input ${entry.artifactId} changed or was substituted.`);
    }
    const plannedArtifact = plannedById.get(entry.artifactId);
    if (plannedArtifact !== undefined && (plannedArtifact.sizeBytes !== entry.sizeBytes || plannedArtifact.sha256 !== entry.sha256)) {
      fail("OUTPUT_INVALID", `External input ${entry.artifactId} disagrees with its planned execution artifact.`);
    }
  }
  for (const reviewed of rendererManifest.reviewedEntrypoints) {
    const entry = externalById.get(reviewed.role);
    if (entry === undefined || !samePath(entry.absolutePath, reviewed.sourcePath) || entry.relativePath !== reviewed.relativePath ||
        entry.sizeBytes !== reviewed.sizeBytes || entry.sha256 !== reviewed.sha256 || entry.mediaType !== reviewed.mediaType) {
      fail("OUTPUT_INVALID", `Renderer external input ${reviewed.role} disagrees with its reviewed source closure.`);
    }
  }
  const runtimeEntry = externalById.get("runtime-seal");
  if (runtimeEntry === undefined || !samePath(runtimeEntry.absolutePath, runtimeEnvironment.runtimeSealArtifact.sourcePath) ||
      runtimeEntry.sizeBytes !== runtimeEnvironment.runtimeSealArtifact.sizeBytes || runtimeEntry.sha256 !== runtimeEnvironment.runtimeSealArtifact.sha256) {
    fail("OUTPUT_INVALID", "Runtime seal external input disagrees with the planned runtime descriptor.");
  }
  const modelEntry = externalById.get("model-seal");
  if (modelEntry === undefined) fail("OUTPUT_INVALID", "Model seal external input is missing.");
  const modelSeal = GrandHallDifixModelSealSchema.parse(requireCanonicalJson(
    await stableRead(modelEntry.absolutePath, "External model seal", MAX_JSON_BYTES), "External model seal",
  ));
  const providerModel = experiment.providerLock.models.find((model) => model.role === "difix_checkpoint");
  if (providerModel === undefined || providerModel.modelId !== modelSeal.modelId || providerModel.revision !== modelSeal.revision ||
      providerModel.repositoryManifestSha256 !== modelSeal.auditedSnapshotManifestSha256 ||
      !canonicalEqual(providerModel.weights, modelSeal.expectedWeightFiles)) {
    fail("OUTPUT_INVALID", "Model seal external input disagrees with the experiment provider lock.");
  }
  const fixedExternalExpectations = [
    ["input-pack-source-render", sourceInput],
    ["input-pack-reconstruction", reconstructionInput],
    ["input-pack-renderer", closure.renderDerivationReceipt.rendererProfileArtifact],
    ["input-pack-protected-mask", closure.protectedRegionMask.artifact],
    ["input-pack-generated-mask", closure.generatedRegionMask.artifact],
  ] as const;
  for (const [id, artifact] of fixedExternalExpectations) {
    const entry = externalById.get(id);
    if (entry === undefined || entry.sizeBytes !== artifact.sizeBytes || entry.sha256 !== artifact.sha256 || entry.mediaType !== artifact.mediaType) {
      fail("OUTPUT_INVALID", `Input-pack external input ${id} disagrees with the experiment.`);
    }
  }
  const manifestEntry = externalById.get("input-pack-manifest");
  const publicationEntry = externalById.get("input-pack-publication-receipt");
  if (manifestEntry === undefined || publicationEntry === undefined) fail("OUTPUT_INVALID", "Input-pack seal bindings are missing.");
  const externalManifest = GrandHallDifixInputPackManifestSchema.parse(requireCanonicalJson(
    await stableRead(manifestEntry.absolutePath, "External input-pack manifest", MAX_JSON_BYTES), "External input-pack manifest",
  ));
  const externalPublication = GrandHallDifixPublicationReceiptSchema.parse(requireCanonicalJson(
    await stableRead(publicationEntry.absolutePath, "External input-pack publication receipt", MAX_JSON_BYTES), "External input-pack publication receipt",
  ));
  if (externalManifest.bundleMaterialSha256 !== externalPublication.bundleMaterialSha256 ||
      externalManifest.sourceRender.sha256 !== sourceInput.sha256 ||
      externalManifest.reconstructionArtifact.sha256 !== reconstructionInput.sha256 ||
      externalManifest.rendererArtifact.sha256 !== closure.renderDerivationReceipt.rendererProfileArtifact.sha256) {
    fail("OUTPUT_INVALID", "External input-pack manifest/publication closure disagrees with the experiment.");
  }
  const cameraEntry = externalById.get("input-pack-camera");
  const renderGenerationEntry = externalById.get("input-pack-render-generation-receipt");
  const browserEntry = externalById.get("input-pack-browser-capture-record");
  if (cameraEntry === undefined || renderGenerationEntry === undefined || browserEntry === undefined ||
      cameraEntry.sha256 !== externalManifest.cameraArtifact.sha256 || cameraEntry.sizeBytes !== externalManifest.cameraArtifact.sizeBytes ||
      renderGenerationEntry.sha256 !== externalManifest.renderGenerationReceipt.sha256 || renderGenerationEntry.sizeBytes !== externalManifest.renderGenerationReceipt.sizeBytes ||
      browserEntry.sha256 !== externalManifest.browserCaptureRecord.sha256 || browserEntry.sizeBytes !== externalManifest.browserCaptureRecord.sizeBytes) {
    fail("OUTPUT_INVALID", "Input-pack camera/browser/render-generation external bindings disagree with the sealed pack manifest.");
  }
  await stableDirectoryIdentity(outputDirectory, verifiedDirectoryIdentity);
  return { outputDirectory, experiment, receipt, receiptSha256: receiptStable.sha256 };
}

export async function checkGrandHallDifixExperimentMaterialization(
  outputDirectoryInput: string,
): Promise<VerifiedGrandHallDifixExperimentMaterialization> {
  try {
    return await checkGrandHallDifixExperimentMaterializationImpl(outputDirectoryInput);
  } catch (error: unknown) {
    if (error instanceof GrandHallDifixExperimentMaterializationError && error.code === "OUTPUT_INVALID") {
      throw error;
    }
    return fail("OUTPUT_INVALID", "Grand Hall Difix experiment materialization is invalid.", error);
  }
}

export const GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZER_USAGE = [
  "Write (create-only):",
  "  grand-hall-difix-experiment-materializer --spec <absolute-materialization-spec.json>",
  "Check (zero-write):",
  "  grand-hall-difix-experiment-materializer --check --output <absolute-existing-directory>",
].join("\n");

export type GrandHallDifixExperimentMaterializerArguments =
  | { readonly check: true; readonly outputDirectory: string }
  | { readonly check: false; readonly specPath: string };

export function parseGrandHallDifixExperimentMaterializerArguments(
  argv: readonly string[],
): GrandHallDifixExperimentMaterializerArguments {
  if (argv.length === 2 && argv[0] === "--spec" && argv[1] !== undefined) {
    return { check: false, specPath: canonicalPath(argv[1], "Materialization spec") };
  }
  if (argv.length === 3 && argv[0] === "--check" && argv[1] === "--output" && argv[2] !== undefined) {
    return { check: true, outputDirectory: canonicalPath(argv[2], "Materialization output") };
  }
  return fail("INPUT_INVALID", GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZER_USAGE);
}

export async function readGrandHallDifixExperimentMaterializationSpec(
  path: string,
): Promise<GrandHallDifixExperimentMaterializationSpec> {
  const stable = await stableRead(path, "Materialization spec", MAX_JSON_BYTES);
  return GrandHallDifixExperimentMaterializationSpecSchema.parse(parseGrandHallT554StrictJson(stable.bytes));
}

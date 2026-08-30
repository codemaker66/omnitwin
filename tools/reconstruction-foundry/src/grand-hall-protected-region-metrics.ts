import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as filesystemConstants, type BigIntStats } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { endianness } from "node:os";

import sharp from "sharp";
import { z } from "zod";

import { GrandHallDifixRuntimeSealSchema } from "./grand-hall-difix-one-shot-contract.js";

export const GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_SCHEMA =
  "venviewer.grand-hall.protected-region-metrics-implementation.v1";
export const GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_SCHEMA =
  "venviewer.grand-hall.protected-region-metrics-configuration.v1";
export const GRAND_HALL_PROTECTED_METRICS_RUNTIME_SCHEMA =
  "venviewer.grand-hall.protected-region-metrics-runtime.v1";
export const GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_SCHEMA =
  "venviewer.grand-hall.protected-region-metrics-pack-receipt.v1";
export const GRAND_HALL_PROTECTED_METRICS_RESULT_SCHEMA =
  "venviewer.grand-hall.protected-region-metrics-result.v1";

export const GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_FILENAME =
  "implementation-manifest.json";
export const GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_FILENAME =
  "configuration.json";
export const GRAND_HALL_PROTECTED_METRICS_RUNTIME_FILENAME =
  "runtime-environment.json";
export const GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_FILENAME =
  "publication-receipt.json";

const IMPLEMENTATION_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_V1";
const CONFIGURATION_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_V1";
const RUNTIME_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_PROTECTED_METRICS_RUNTIME_V1";
const PACK_RECEIPT_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_V1";
const RESULT_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_PROTECTED_METRICS_RESULT_V1";
const IMPLEMENTATION_CLOSURE_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_PROTECTED_METRICS_SOURCE_CLOSURE_V1";
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;
const MAX_IMPLEMENTATION_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_FILENAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,159}$/u;
const LPIPS_PYTHON_FILENAME = "grand-hall-protected-region-lpips.py";
const LPIPS_RUNTIME_SEAL_PATH = "F:\\venviewer-provider-cache\\difix3d\\seals\\runtime-difix-py312-cu128-c76edc-v1-692e2cc6-20260830T064114Z.json";
const LPIPS_RUNTIME_SEAL_RAW_SHA256 = "sha256:e1f2b9fc4ee3a547748e5efc7322868ba8ab0b5bcb4413156cbed5b99b0bf0d1";
const LPIPS_RUNTIME_SEAL_SIZE = 7_712_892;
const LPIPS_RUNTIME_SEAL_INNER_SHA256 = "sha256:e36c81ce2ba1e567ea4adfbd6ac1b7ed8c5fc6a2c912560bbcd07a44baa9dbf1";
const LPIPS_ALEXNET_WEIGHT_PATH = "C:\\Users\\blake\\.cache\\torch\\hub\\checkpoints\\alexnet-owt-7be5be79.pth";
const LPIPS_ALEXNET_WEIGHT_SHA256 = "sha256:7be5be791159472b1fbf3c69796f7cb30dca7ad8466c2df70058c37116cdee02";
const LPIPS_ALEXNET_WEIGHT_SIZE = 244_408_911;
const LPIPS_CALIBRATION_WEIGHT_PATH = "F:\\venviewer-provider-cache\\difix3d\\c76edc595586e16732c91ddee82f3a6d83a8a9cc\\runtime-py312-cu128-v1\\venv\\lib\\python3.12\\site-packages\\lpips\\weights\\v0.1\\alex.pth";
const LPIPS_CALIBRATION_WEIGHT_SHA256 = "sha256:df73285e35b22355a2df87cdb6b70b343713b667eddbda73e1977e0c860835c0";
const LPIPS_CALIBRATION_WEIGHT_SIZE = 6_009;
const LPIPS_VENV_PYTHON_WSL = "/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/runtime-py312-cu128-v1/venv/bin/python";
const RUNTIME_SEAL_TOOL_PATH = "C:\\Users\\blake\\omnitwin2-grand-hall-exact-runtime\\tools\\reconstruction-foundry\\python\\grand_hall_difix_runtime_seal.py";
const RUNTIME_SEAL_TOOL_WSL = "/mnt/c/Users/blake/omnitwin2-grand-hall-exact-runtime/tools/reconstruction-foundry/python/grand_hall_difix_runtime_seal.py";
const RUNTIME_SEAL_TOOL_SHA256 = "sha256:1fd19dc305ae8aa7f22a7df9e21456cdc01fb04828030649b2d0dab172733306";
const RUNTIME_SEAL_TOOL_SIZE = 21_933;
const STABLE_PYTHON_BOOTSTRAP = String.raw`import hashlib, os, stat, sys
path=sys.argv[1]; expected=sys.argv[2]; size=int(sys.argv[3]); before=os.stat(path,follow_symlinks=False)
if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1: raise RuntimeError("bound script is unsafe")
fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0)|getattr(os,"O_CLOEXEC",0))
try:
 opened_before=os.fstat(fd); chunks=[]
 while True:
  chunk=os.read(fd,1024*1024)
  if not chunk: break
  chunks.append(chunk)
 source=b"".join(chunks); opened_after=os.fstat(fd)
finally: os.close(fd)
after=os.stat(path,follow_symlinks=False); ident=lambda v:(v.st_dev,v.st_ino,v.st_mode,v.st_nlink,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
if ident(before)!=ident(opened_before) or ident(opened_before)!=ident(opened_after) or ident(opened_after)!=ident(after): raise RuntimeError("bound script changed")
if len(source)!=size or "sha256:"+hashlib.sha256(source).hexdigest()!=expected: raise RuntimeError("bound script mismatch")
sys.argv=[path,*sys.argv[4:]]; exec(compile(source,path,"exec",dont_inherit=True),{"__name__":"__main__","__file__":path,"__package__":None,"__cached__":None})
`;
const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const Sha256Schema = z.string().regex(SHA256_PATTERN);
const FileReceiptSchema = z.object({
  fileName: z.string().regex(SAFE_FILENAME_PATTERN),
  sizeBytes: z.number().int().positive(),
  sha256: Sha256Schema,
}).strict();

const ImplementationMemberSchema = FileReceiptSchema.extend({
  mediaType: z.enum(["application/typescript", "text/javascript", "text/x-python"]),
}).strict();

const ImplementationPayloadSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_SCHEMA),
  authority: z.literal("none"),
  executionBoundary: z.literal("local_offline_read_only_inputs_create_only_result"),
  members: z.array(ImplementationMemberSchema).length(3),
  closureSha256: Sha256Schema,
}).strict();

const ImplementationManifestSchema = ImplementationPayloadSchema.extend({
  implementationManifestSha256: Sha256Schema,
}).strict();

const ConfigurationPayloadSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_SCHEMA),
  authority: z.literal("none"),
  decoder: z.object({
    implementation: z.literal("sharp"),
    acceptedFormat: z.literal("png"),
    imageColourspace: z.literal("srgb"),
    imageChannels: z.literal(3),
    imageAlpha: z.literal("forbidden"),
    embeddedColourProfile: z.literal("forbidden"),
    orientationMetadata: z.literal("forbidden"),
    imageDepth: z.literal("uchar"),
    maskColourspace: z.literal("b-w"),
    maskChannels: z.literal(1),
    maskAlpha: z.literal("forbidden"),
    maskDepth: z.literal("uchar"),
    maskValues: z.tuple([z.literal(0), z.literal(255)]),
  }).strict(),
  meanAbsoluteError: z.object({
    algorithm: z.literal("masked_rgb_uint8_mean_absolute_error_v1"),
    normalizationDenominator: z.literal(255),
    channels: z.tuple([z.literal("red"), z.literal("green"), z.literal("blue")]),
  }).strict(),
  structuralSimilarity: z.object({
    algorithm: z.literal("masked_gaussian_window_luma_ssim_v1"),
    lumaTransfer: z.literal("srgb_encoded_bt709"),
    lumaCoefficients: z.tuple([z.literal(0.2126), z.literal(0.7152), z.literal(0.0722)]),
    windowSize: z.literal(11),
    gaussianSigma: z.literal(1.5),
    dynamicRange: z.literal(255),
    k1: z.literal(0.01),
    k2: z.literal(0.03),
    maskRule: z.literal("renormalize_each_window_over_protected_samples"),
    boundaryRule: z.literal("truncate_and_renormalize"),
    reportedRawRange: z.tuple([z.literal(-1), z.literal(1)]),
    contractValueRule: z.literal("clamp_raw_mean_to_zero_one"),
  }).strict(),
  edgeDisplacement: z.object({
    algorithm: z.literal("symmetric_euclidean_hausdorff_of_sobel_luma_edges_v1"),
    lumaTransfer: z.literal("srgb_encoded_bt709"),
    sobelMagnitudeThreshold: z.literal(64),
    neighbourhood: z.literal("three_by_three_fully_protected"),
    distanceTransform: z.literal("exact_squared_euclidean_felzenszwalb_huttenlocher"),
    emptyEligibleDomainRule: z.literal("fail_closed"),
    noEdgeRule: z.literal("zero_only_when_both_sets_empty_otherwise_fail_closed"),
  }).strict(),
  learnedPerceptualSimilarity: z.object({
    algorithm: z.literal("lpips_0.1_alex_spatial_masked_native_resolution_v1"),
    device: z.literal("cpu"),
    inputRange: z.literal("zero_one_with_lpips_normalize_true"),
    nativeResolutionRequired: z.literal(true),
    spatialAggregation: z.literal("arithmetic_mean_over_binary_protected_mask"),
    aggregateProjection: z.literal("protected_region_lpips_equals_max_zero_raw_masked_mean"),
    deterministicAlgorithmsRequired: z.literal(true),
    networkNamespace: z.literal("linux_unshare_user_map_root_net"),
    pythonFlags: z.tuple([z.literal("-I"), z.literal("-B")]),
  }).strict(),
}).strict();

const ConfigurationSchema = ConfigurationPayloadSchema.extend({
  configurationSha256: Sha256Schema,
}).strict();

const RuntimePayloadSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_PROTECTED_METRICS_RUNTIME_SCHEMA),
  authority: z.literal("none"),
  nodeVersion: z.string().min(1),
  v8Version: z.string().min(1),
  platform: z.string().min(1),
  architecture: z.string().min(1),
  endianness: z.enum(["BE", "LE"]),
  sharpVersion: z.string().min(1),
  libvipsVersion: z.string().min(1),
  executionMode: z.enum(["typescript_source_via_tsx", "compiled_esm_via_node"]),
  tsxVersion: z.string().min(1).nullable(),
  typescriptVersion: z.string().min(1).nullable(),
  implementationManifestFileSha256: Sha256Schema,
  configurationFileSha256: Sha256Schema,
  lpips: z.object({
    runtimeSeal: FileReceiptSchema.extend({ innerSha256: Sha256Schema }).strict(),
    venvPythonWsl: z.literal(LPIPS_VENV_PYTHON_WSL),
    packageVersion: z.literal("0.1.4"),
    torchVersion: z.literal("2.11.0+cu128"),
    torchvisionVersion: z.literal("0.26.0+cu128"),
    alexnetWeight: FileReceiptSchema,
    calibrationWeight: FileReceiptSchema,
  }).strict(),
}).strict();

const DependencyPackageSchema = z.object({ version: z.string().min(1) }).passthrough();
const moduleRequire = createRequire(import.meta.url);

const RuntimeSchema = RuntimePayloadSchema.extend({
  runtimeSha256: Sha256Schema,
}).strict();

const PackReceiptPayloadSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_SCHEMA),
  authority: z.literal("none"),
  receiptWrittenLast: z.literal(true),
  filesBeforeReceipt: z.array(FileReceiptSchema).length(3),
}).strict();

const PackReceiptSchema = PackReceiptPayloadSchema.extend({
  packReceiptSha256: Sha256Schema,
}).strict();

const ImageBindingSchema = z.object({
  role: z.enum(["source", "candidate", "protected_mask"]),
  mediaType: z.literal("image/png"),
  sizeBytes: z.number().int().positive(),
  sha256: Sha256Schema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  channels: z.number().int().positive(),
  colourspace: z.string().min(1),
  depth: z.literal("uchar"),
}).strict();

const LpipsPythonResultSchema = z.object({
  schemaVersion: z.literal("venviewer.grand-hall.protected-region-lpips-result.v1"),
  authority: z.literal("none"),
  device: z.literal("cpu"),
  deterministicAlgorithms: z.literal(true),
  nativeWidth: z.number().int().positive(),
  nativeHeight: z.number().int().positive(),
  protectedPixelCount: z.number().int().positive(),
  protectedRegionLpips: z.number().finite().nonnegative(),
  rawProtectedRegionLpips: z.number().finite(),
  rawStandardProtectedRegionLpips: z.number().finite(),
  standardParityAbsoluteDifference: z.number().min(0).max(1e-8),
  networkNamespaceProbeErrno: z.literal(101),
  aggregation: z.literal("arithmetic_mean_of_spatial_lpips_over_binary_protected_mask"),
  aggregateProjection: z.literal("protected_region_lpips_equals_max_zero_raw_masked_mean"),
  lpipsVersion: z.literal("0.1.4"),
  torchVersion: z.literal("2.11.0+cu128"),
  torchvisionVersion: z.literal("0.26.0+cu128"),
  pythonVersion: z.literal("3.12.3"),
  inputs: z.object({
    source: z.object({ sha256: Sha256Schema, sizeBytes: z.number().int().positive() }).strict(),
    candidate: z.object({ sha256: Sha256Schema, sizeBytes: z.number().int().positive() }).strict(),
    protected_mask: z.object({ sha256: Sha256Schema, sizeBytes: z.number().int().positive() }).strict(),
    implementation: z.object({ sha256: Sha256Schema, sizeBytes: z.number().int().positive() }).strict(),
  }).strict(),
  weights: z.object({
    alexnet: z.object({ sha256: z.literal(LPIPS_ALEXNET_WEIGHT_SHA256), sizeBytes: z.literal(LPIPS_ALEXNET_WEIGHT_SIZE) }).strict(),
    calibration: z.object({ sha256: z.literal(LPIPS_CALIBRATION_WEIGHT_SHA256), sizeBytes: z.literal(LPIPS_CALIBRATION_WEIGHT_SIZE) }).strict(),
  }).strict(),
}).strict();

const RuntimeAttestationSchema = z.object({
  state: z.literal("runtime_checked"),
  runtimeSealFileSha256: z.literal(LPIPS_RUNTIME_SEAL_RAW_SHA256),
  runtimeSealSha256: z.literal(LPIPS_RUNTIME_SEAL_INNER_SHA256),
  verifierSha256: z.literal(RUNTIME_SEAL_TOOL_SHA256),
  networkNamespace: z.literal("linux_unshare_user_map_root_net"),
}).strict();

const LpipsProcessResultSchema = LpipsPythonResultSchema.extend({
  runtimeAttestation: RuntimeAttestationSchema,
}).strict().superRefine((value, ctx) => {
  const expectedProjection = Math.max(0, value.rawProtectedRegionLpips);
  const expectedParity = Math.abs(value.rawProtectedRegionLpips - value.rawStandardProtectedRegionLpips);
  if (!Object.is(value.protectedRegionLpips, expectedProjection) && value.protectedRegionLpips !== expectedProjection) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["protectedRegionLpips"], message: "LPIPS projection must equal max(0, raw masked mean)" });
  }
  if (value.standardParityAbsoluteDifference !== expectedParity || expectedParity > 1e-8) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["standardParityAbsoluteDifference"], message: "LPIPS parity must equal the exact raw aggregate difference and remain within tolerance" });
  }
});

const ResultPayloadBaseSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_PROTECTED_METRICS_RESULT_SCHEMA),
  authority: z.literal("none"),
  status: z.literal("evaluated"),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  evaluator: z.object({
    implementationManifest: FileReceiptSchema,
    configuration: FileReceiptSchema,
    runtimeEnvironment: FileReceiptSchema,
    packReceipt: FileReceiptSchema.nullable(),
  }).strict(),
  inputs: z.object({
    source: ImageBindingSchema,
    candidate: ImageBindingSchema,
    protectedMask: ImageBindingSchema,
  }).strict(),
  metrics: z.object({
    protectedPixelCount: z.number().int().positive(),
    protectedRgbSampleCount: z.number().int().positive(),
    protectedRegionMeanAbsoluteError: z.number().min(0).max(1),
  protectedRegionLpips: z.number().finite().nonnegative(),
    protectedRegionSsim: z.number().min(0).max(1),
    rawProtectedRegionSsim: z.number().min(-1).max(1),
    sourceProtectedEdgePixelCount: z.number().int().nonnegative(),
    candidateProtectedEdgePixelCount: z.number().int().nonnegative(),
    maximumProtectedEdgeDisplacementPixels: z.number().nonnegative(),
  }).strict(),
  lpipsProcess: LpipsProcessResultSchema,
}).strict();

function refineResultPayload(
  value: z.infer<typeof ResultPayloadBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  if (Date.parse(value.startedAt) >= Date.parse(value.completedAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "evaluation must complete after it starts" });
  }
  const { source, candidate, protectedMask } = value.inputs;
  if (source.role !== "source" || source.channels !== 3 || source.colourspace !== "srgb" ||
      candidate.role !== "candidate" || candidate.channels !== 3 || candidate.colourspace !== "srgb" ||
      protectedMask.role !== "protected_mask" || protectedMask.channels !== 1 || protectedMask.colourspace !== "b-w") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "input roles and decoded image formats must match their exact semantic slots" });
  }
  if (source.width !== candidate.width || source.height !== candidate.height ||
      source.width !== protectedMask.width || source.height !== protectedMask.height) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "all decoded extents must match" });
  }
  if (value.metrics.protectedRgbSampleCount !== value.metrics.protectedPixelCount * 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics", "protectedRgbSampleCount"], message: "RGB sample count must be three times the protected pixel count" });
  }
  if (value.metrics.protectedRegionLpips !== value.lpipsProcess.protectedRegionLpips ||
      value.metrics.protectedPixelCount !== value.lpipsProcess.protectedPixelCount ||
      source.width !== value.lpipsProcess.nativeWidth || source.height !== value.lpipsProcess.nativeHeight) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lpipsProcess"], message: "LPIPS process metrics and extents must exactly match the result payload" });
  }
  for (const [binding, processRole] of [[source, "source"], [candidate, "candidate"], [protectedMask, "protected_mask"]] as const) {
    const processInput = value.lpipsProcess.inputs[processRole];
    if (binding.sha256 !== processInput.sha256 || binding.sizeBytes !== processInput.sizeBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lpipsProcess", "inputs", processRole], message: "LPIPS process input must exactly match the top-level input binding" });
    }
  }
}

const ResultPayloadSchema = ResultPayloadBaseSchema.superRefine(refineResultPayload);

export const GrandHallProtectedRegionMetricsResultSchema = ResultPayloadBaseSchema.extend({
  resultSha256: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  refineResultPayload(value, ctx);
  const { resultSha256, ...payload } = value;
  if (resultSha256 !== domainDigest(RESULT_DIGEST_DOMAIN, payload)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resultSha256"], message: "result self-digest is invalid" });
  }
});

export type GrandHallProtectedRegionMetricsResult = z.infer<
  typeof GrandHallProtectedRegionMetricsResultSchema
>;

export type GrandHallProtectedRegionMetricsErrorCode =
  | "INPUT_INVALID"
  | "INPUT_RACE"
  | "MATERIAL_INVALID"
  | "METRIC_UNDEFINED"
  | "OUTPUT_EXISTS"
  | "OUTPUT_UNSAFE";

export class GrandHallProtectedRegionMetricsError extends Error {
  constructor(
    readonly code: GrandHallProtectedRegionMetricsErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallProtectedRegionMetricsError";
  }
}

interface StableFile {
  readonly absolutePath: string;
  readonly bytes: Buffer;
  readonly sizeBytes: number;
  readonly sha256: `sha256:${string}`;
  readonly identity: string;
}

interface DecodedImage {
  readonly pixels: Buffer;
  readonly binding: z.infer<typeof ImageBindingSchema>;
}

interface VerifiedEvaluatorMaterial {
  readonly implementationFile: StableFile;
  readonly configurationFile: StableFile;
  readonly runtimeFile: StableFile;
  readonly receiptFile: StableFile | null;
}

export interface MaterializeGrandHallProtectedRegionMetricsPackOptions {
  readonly outputDirectory: string;
  readonly beforePublishTestHook?: (stagingDirectory: string) => Promise<void>;
}

interface EvaluateGrandHallProtectedRegionMetricsCommonOptions {
  readonly sourcePath: string;
  readonly candidatePath: string;
  readonly protectedMaskPath: string;
  readonly outputPath: string;
  readonly beforeResultPublishTestHook?: (stagingPath: string) => Promise<void>;
  readonly beforeLpipsImplementationBootstrapTestHook?: (implementationPath: string) => Promise<void>;
}

export type EvaluateGrandHallProtectedRegionMetricsOptions =
  EvaluateGrandHallProtectedRegionMetricsCommonOptions & (
    | {
        readonly evaluatorPackDirectory: string;
        readonly evaluatorImplementationManifestPath?: never;
        readonly evaluatorConfigurationPath?: never;
        readonly evaluatorRuntimePath?: never;
      }
    | {
        readonly evaluatorPackDirectory?: never;
        readonly evaluatorImplementationManifestPath: string;
        readonly evaluatorConfigurationPath: string;
        readonly evaluatorRuntimePath: string;
      }
  );

const CONFIGURATION_PAYLOAD = {
  schemaVersion: GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_SCHEMA,
  authority: "none",
  decoder: {
    implementation: "sharp",
    acceptedFormat: "png",
    imageColourspace: "srgb",
    imageChannels: 3,
    imageAlpha: "forbidden",
    embeddedColourProfile: "forbidden",
    orientationMetadata: "forbidden",
    imageDepth: "uchar",
    maskColourspace: "b-w",
    maskChannels: 1,
    maskAlpha: "forbidden",
    maskDepth: "uchar",
    maskValues: [0, 255],
  },
  meanAbsoluteError: {
    algorithm: "masked_rgb_uint8_mean_absolute_error_v1",
    normalizationDenominator: 255,
    channels: ["red", "green", "blue"],
  },
  structuralSimilarity: {
    algorithm: "masked_gaussian_window_luma_ssim_v1",
    lumaTransfer: "srgb_encoded_bt709",
    lumaCoefficients: [0.2126, 0.7152, 0.0722],
    windowSize: 11,
    gaussianSigma: 1.5,
    dynamicRange: 255,
    k1: 0.01,
    k2: 0.03,
    maskRule: "renormalize_each_window_over_protected_samples",
    boundaryRule: "truncate_and_renormalize",
    reportedRawRange: [-1, 1],
    contractValueRule: "clamp_raw_mean_to_zero_one",
  },
  edgeDisplacement: {
    algorithm: "symmetric_euclidean_hausdorff_of_sobel_luma_edges_v1",
    lumaTransfer: "srgb_encoded_bt709",
    sobelMagnitudeThreshold: 64,
    neighbourhood: "three_by_three_fully_protected",
    distanceTransform: "exact_squared_euclidean_felzenszwalb_huttenlocher",
    emptyEligibleDomainRule: "fail_closed",
    noEdgeRule: "zero_only_when_both_sets_empty_otherwise_fail_closed",
  },
  learnedPerceptualSimilarity: {
    algorithm: "lpips_0.1_alex_spatial_masked_native_resolution_v1",
    device: "cpu",
    inputRange: "zero_one_with_lpips_normalize_true",
    nativeResolutionRequired: true,
    spatialAggregation: "arithmetic_mean_over_binary_protected_mask",
    aggregateProjection: "protected_region_lpips_equals_max_zero_raw_masked_mean",
    deterministicAlgorithmsRequired: true,
    networkNamespace: "linux_unshare_user_map_root_net",
    pythonFlags: ["-I", "-B"],
  },
} as const;

function fail(
  code: GrandHallProtectedRegionMetricsErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new GrandHallProtectedRegionMetricsError(code, message, cause);
}

function toCanonicalValue(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("MATERIAL_INVALID", "Canonical JSON cannot contain non-finite numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(toCanonicalValue);
  if (typeof value === "object") {
    const output: Record<string, CanonicalValue> = {};
    for (const [key, member] of Object.entries(value)) {
      if (member === undefined) fail("MATERIAL_INVALID", `Canonical JSON member ${key} is undefined.`);
      output[key] = toCanonicalValue(member);
    }
    return output;
  }
  return fail("MATERIAL_INVALID", `Canonical JSON does not support ${typeof value}.`);
}

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as { readonly [key: string]: CanonicalValue };
  return `{${Object.keys(object).sort((left, right) => left.localeCompare(right)).map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(object[key] ?? null)}`
  )).join(",")}}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalJson(toCanonicalValue(value))}\n`, "utf8");
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function domainDigest(domain: string, value: unknown): `sha256:${string}` {
  const payload = canonicalJson(toCanonicalValue(value));
  return `sha256:${createHash("sha256").update(domain, "ascii").update(Buffer.from([0])).update(payload, "utf8").digest("hex")}`;
}

function canonicalPath(input: string, label: string): string {
  if (!isAbsolute(input)) fail("OUTPUT_UNSAFE", `${label} must be absolute.`);
  const canonical = resolve(input);
  if (canonical !== normalize(input)) fail("OUTPUT_UNSAFE", `${label} must be normalized and traversal-free.`);
  return canonical;
}

function samePath(left: string, right: string): boolean {
  const normalizeCase = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
  return normalizeCase(resolve(left)) === normalizeCase(resolve(right));
}

function nodeIdentity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(":");
}

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return nodeIdentity(left) === nodeIdentity(right);
}

function directoryIdentity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode].map(String).join(":");
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
  const noFollow = "O_NOFOLLOW" in filesystemConstants ? filesystemConstants.O_NOFOLLOW : 0;
  const handle = await open(absolutePath, filesystemConstants.O_RDONLY | noFollow).catch((error: unknown) =>
    fail("INPUT_INVALID", `${label} could not be opened safely.`, error));
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

function parseCanonical<T>(file: StableFile, schema: z.ZodType<T>, label: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.bytes.toString("utf8"));
  } catch (error) {
    return fail("MATERIAL_INVALID", `${label} is not valid JSON.`, error);
  }
  if (!file.bytes.equals(canonicalBytes(parsed))) fail("MATERIAL_INVALID", `${label} is not exact canonical JSON with one LF terminator.`);
  const result = schema.safeParse(parsed);
  if (!result.success) fail("MATERIAL_INVALID", `${label} does not satisfy its closed schema: ${result.error.message}`);
  return result.data;
}

function fileReceipt(fileName: string, bytes: Buffer): z.infer<typeof FileReceiptSchema> {
  return { fileName, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
}

function withDigest<TPayload extends Record<string, unknown>, TKey extends string>(
  payload: TPayload,
  key: TKey,
  domain: string,
): TPayload & Record<TKey, `sha256:${string}`> {
  return { ...payload, [key]: domainDigest(domain, payload) } as TPayload & Record<TKey, `sha256:${string}`>;
}

function implementationPaths(): readonly string[] {
  const implementation = fileURLToPath(import.meta.url);
  const extension = extname(implementation);
  const entry = resolve(dirname(implementation), `grand-hall-protected-region-metrics-entry${extension}`);
  const lpipsImplementation = resolve(dirname(implementation), LPIPS_PYTHON_FILENAME);
  return [implementation, entry, lpipsImplementation];
}

async function buildImplementationManifest(): Promise<z.infer<typeof ImplementationManifestSchema>> {
  const files = await Promise.all(implementationPaths().map((path) => stableRead(path, `Evaluator implementation ${basename(path)}`, MAX_IMPLEMENTATION_BYTES)));
  const members = files.map((file) => ({
    fileName: basename(file.absolutePath),
    mediaType: extname(file.absolutePath) === ".py"
      ? "text/x-python" as const
      : extname(file.absolutePath) === ".ts"
        ? "application/typescript" as const
        : "text/javascript" as const,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
  })).sort((left, right) => left.fileName.localeCompare(right.fileName));
  const payload = ImplementationPayloadSchema.parse({
    schemaVersion: GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_SCHEMA,
    authority: "none",
    executionBoundary: "local_offline_read_only_inputs_create_only_result",
    members,
    closureSha256: domainDigest(IMPLEMENTATION_CLOSURE_DIGEST_DOMAIN, members),
  });
  return ImplementationManifestSchema.parse(withDigest(payload, "implementationManifestSha256", IMPLEMENTATION_DIGEST_DOMAIN));
}

function buildConfiguration(): z.infer<typeof ConfigurationSchema> {
  const payload = ConfigurationPayloadSchema.parse(CONFIGURATION_PAYLOAD);
  return ConfigurationSchema.parse(withDigest(payload, "configurationSha256", CONFIGURATION_DIGEST_DOMAIN));
}

function buildRuntime(
  implementationFileSha256: `sha256:${string}`,
  configurationFileSha256: `sha256:${string}`,
): z.infer<typeof RuntimeSchema> {
  const sourceMode = implementationPaths().some((path) => extname(path) === ".ts");
  const dependencyVersion = (packageName: string): string => {
    const packageJson: unknown = moduleRequire(`${packageName}/package.json`);
    return DependencyPackageSchema.parse(packageJson).version;
  };
  const payload = RuntimePayloadSchema.parse({
    schemaVersion: GRAND_HALL_PROTECTED_METRICS_RUNTIME_SCHEMA,
    authority: "none",
    nodeVersion: process.versions.node,
    v8Version: process.versions.v8,
    platform: process.platform,
    architecture: process.arch,
    endianness: endianness(),
    sharpVersion: sharp.versions.sharp,
    libvipsVersion: sharp.versions.vips,
    executionMode: sourceMode ? "typescript_source_via_tsx" : "compiled_esm_via_node",
    tsxVersion: sourceMode ? dependencyVersion("tsx") : null,
    typescriptVersion: sourceMode ? dependencyVersion("typescript") : null,
    implementationManifestFileSha256: implementationFileSha256,
    configurationFileSha256,
    lpips: {
      runtimeSeal: {
        fileName: basename(LPIPS_RUNTIME_SEAL_PATH).toLowerCase(),
        sizeBytes: LPIPS_RUNTIME_SEAL_SIZE,
        sha256: LPIPS_RUNTIME_SEAL_RAW_SHA256,
        innerSha256: LPIPS_RUNTIME_SEAL_INNER_SHA256,
      },
      venvPythonWsl: LPIPS_VENV_PYTHON_WSL,
      packageVersion: "0.1.4",
      torchVersion: "2.11.0+cu128",
      torchvisionVersion: "0.26.0+cu128",
      alexnetWeight: {
        fileName: basename(LPIPS_ALEXNET_WEIGHT_PATH),
        sizeBytes: LPIPS_ALEXNET_WEIGHT_SIZE,
        sha256: LPIPS_ALEXNET_WEIGHT_SHA256,
      },
      calibrationWeight: {
        fileName: basename(LPIPS_CALIBRATION_WEIGHT_PATH),
        sizeBytes: LPIPS_CALIBRATION_WEIGHT_SIZE,
        sha256: LPIPS_CALIBRATION_WEIGHT_SHA256,
      },
    },
  });
  return RuntimeSchema.parse(withDigest(payload, "runtimeSha256", RUNTIME_DIGEST_DOMAIN));
}

async function verifyLpipsStaticMaterial(): Promise<void> {
  const [seal, alexnet, calibration] = await Promise.all([
    stableRead(LPIPS_RUNTIME_SEAL_PATH, "LPIPS runtime seal", 16 * 1024 * 1024),
    stableRead(LPIPS_ALEXNET_WEIGHT_PATH, "LPIPS AlexNet weight", MAX_IMAGE_BYTES),
    stableRead(LPIPS_CALIBRATION_WEIGHT_PATH, "LPIPS calibration weight", MAX_IMPLEMENTATION_BYTES),
  ]);
  if (seal.sizeBytes !== LPIPS_RUNTIME_SEAL_SIZE || seal.sha256 !== LPIPS_RUNTIME_SEAL_RAW_SHA256 ||
      alexnet.sizeBytes !== LPIPS_ALEXNET_WEIGHT_SIZE || alexnet.sha256 !== LPIPS_ALEXNET_WEIGHT_SHA256 ||
      calibration.sizeBytes !== LPIPS_CALIBRATION_WEIGHT_SIZE || calibration.sha256 !== LPIPS_CALIBRATION_WEIGHT_SHA256) {
    fail("MATERIAL_INVALID", "LPIPS runtime seal or weight bytes do not match the exact lock.");
  }
  let parsedSeal: unknown;
  try {
    parsedSeal = JSON.parse(seal.bytes.toString("utf8"));
  } catch (error) {
    fail("MATERIAL_INVALID", "LPIPS runtime seal is not valid JSON.", error);
  }
  const inner = z.object({
    runtimeSealSha256: z.literal(LPIPS_RUNTIME_SEAL_INNER_SHA256),
    sealedForOfflineExecution: z.literal(true),
    networkAcquisitionComplete: z.literal(true),
  }).passthrough().safeParse(parsedSeal);
  if (!inner.success) fail("MATERIAL_INVALID", "LPIPS runtime seal inner binding is invalid.");
}

async function writeExclusive(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, "wx", 0o600).catch((error: unknown) =>
    fail("OUTPUT_EXISTS", `Create-only output already exists: ${path}.`, error));
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomicCreateOnlyResult(
  outputPath: string,
  bytes: Buffer,
  expectedParentIdentity: string,
  beforePublishTestHook?: (stagingPath: string) => Promise<void>,
): Promise<void> {
  const parent = dirname(outputPath);
  const parentStats = await lstat(parent, { bigint: true });
  if (!parentStats.isDirectory()) fail("OUTPUT_UNSAFE", "Result output parent is not a directory.");
  const parentIdentity = directoryIdentity(parentStats);
  if (parentIdentity !== expectedParentIdentity) fail("OUTPUT_UNSAFE", "Protected-metrics result parent changed during evaluation.");
  const stagingPath = resolve(parent, `.${basename(outputPath)}.staging-${randomBytes(24).toString("hex")}`);
  await writeExclusive(stagingPath, bytes);
  const staged = await stableRead(stagingPath, "Staged protected-metrics result", MAX_IMPLEMENTATION_BYTES);
  if (!staged.bytes.equals(bytes)) fail("OUTPUT_UNSAFE", "Staged protected-metrics result bytes changed before publish.");
  await beforePublishTestHook?.(stagingPath);
  const stagedAfterHook = await stableRead(stagingPath, "Staged protected-metrics result before publish", MAX_IMPLEMENTATION_BYTES);
  if (stagedAfterHook.identity !== staged.identity || stagedAfterHook.sha256 !== staged.sha256 ||
      !stagedAfterHook.bytes.equals(staged.bytes)) {
    fail("OUTPUT_UNSAFE", "Staged protected-metrics result identity or bytes changed before publish.");
  }
  await requireDirectoryIdentity(parent, parentIdentity, "Protected-metrics result parent before publish");
  try {
    await lstat(outputPath);
    fail("OUTPUT_EXISTS", "Protected-metrics result output was claimed before publish.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await link(stagingPath, outputPath).catch((error: unknown) =>
    fail("OUTPUT_EXISTS", "Staged protected-metrics result could not be atomically linked to the absent output.", error));
  await requireDirectoryIdentity(parent, parentIdentity, "Protected-metrics result parent after publish");
  await unlink(stagingPath).catch((error: unknown) =>
    fail("OUTPUT_UNSAFE", "Published protected-metrics staging link could not be removed.", error));
  await requireDirectoryIdentity(parent, parentIdentity, "Protected-metrics result parent after staging unlink");
  const published = await stableRead(outputPath, "Published protected-metrics result", MAX_IMPLEMENTATION_BYTES);
  if (published.sha256 !== staged.sha256 || !published.bytes.equals(staged.bytes)) {
    fail("OUTPUT_UNSAFE", "Published protected-metrics result does not match its exact staging bytes.");
  }
}

export async function captureGrandHallProtectedMetricsOutputParentIdentity(outputPath: string): Promise<string> {
  const canonicalOutput = canonicalPath(outputPath, "Protected-metrics result output");
  const parent = dirname(canonicalOutput);
  const physical = await realpath(parent).catch((error: unknown) =>
    fail("OUTPUT_UNSAFE", "Protected-metrics result parent must already exist.", error));
  if (!samePath(parent, physical)) fail("OUTPUT_UNSAFE", "Protected-metrics result parent must not traverse a link or junction.");
  const stats = await lstat(parent, { bigint: true });
  if (!stats.isDirectory()) fail("OUTPUT_UNSAFE", "Protected-metrics result parent is not a directory.");
  return directoryIdentity(stats);
}

export async function publishGrandHallProtectedMetricsResultCreateOnly(options: {
  readonly outputPath: string;
  readonly bytes: Buffer;
  readonly expectedParentIdentity: string;
  readonly beforePublishTestHook?: (stagingPath: string) => Promise<void>;
}): Promise<void> {
  await writeAtomicCreateOnlyResult(
    canonicalPath(options.outputPath, "Protected-metrics result output"), options.bytes,
    options.expectedParentIdentity, options.beforePublishTestHook,
  );
}

interface StagingDirectoryClaim {
  readonly requested: string;
  readonly staging: string;
  readonly identity: string;
}

async function requireDirectoryIdentity(path: string, identity: string, label: string): Promise<void> {
  const physical = await realpath(path).catch((error: unknown) => fail("OUTPUT_UNSAFE", `${label} cannot be resolved.`, error));
  if (!samePath(path, physical)) fail("OUTPUT_UNSAFE", `${label} was redirected through a link or junction.`);
  const stats = await lstat(path, { bigint: true });
  if (!stats.isDirectory() || directoryIdentity(stats) !== identity) fail("OUTPUT_UNSAFE", `${label} identity changed.`);
}

async function claimStagingDirectory(input: string): Promise<StagingDirectoryClaim> {
  const requested = canonicalPath(input, "Evaluator pack output directory");
  const parent = dirname(requested);
  const physicalParent = await realpath(parent).catch((error: unknown) =>
    fail("OUTPUT_UNSAFE", "Evaluator pack output parent must already exist.", error));
  if (!samePath(parent, physicalParent)) fail("OUTPUT_UNSAFE", "Evaluator pack output parent must not traverse a link or junction.");
  try {
    await lstat(requested);
    fail("OUTPUT_EXISTS", "Evaluator pack requested output must remain absent.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const staging = resolve(parent, `.${basename(requested)}.staging-${randomBytes(24).toString("hex")}`);
  await mkdir(staging, { recursive: false, mode: 0o700 }).catch((error: unknown) =>
    fail("OUTPUT_EXISTS", "Cryptographically unique evaluator staging directory could not be claimed.", error));
  const stats = await lstat(staging, { bigint: true });
  const identity = directoryIdentity(stats);
  await requireDirectoryIdentity(staging, identity, "Evaluator staging directory");
  return { requested, staging, identity };
}

async function publishStagingDirectory(claim: StagingDirectoryClaim): Promise<string> {
  await requireDirectoryIdentity(claim.staging, claim.identity, "Evaluator staging directory before publish");
  try {
    await lstat(claim.requested);
    fail("OUTPUT_EXISTS", "Evaluator pack requested output was claimed before publish.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await rename(claim.staging, claim.requested).catch((error: unknown) =>
    fail("OUTPUT_EXISTS", "Evaluator staging directory could not be atomically published to the absent requested output.", error));
  await requireDirectoryIdentity(claim.requested, claim.identity, "Published evaluator directory");
  return claim.requested;
}

async function exactDirectoryInventory(directory: string, expected: readonly string[]): Promise<void> {
  const actual = (await readdir(directory)).sort((left, right) => left.localeCompare(right));
  const wanted = [...expected].sort((left, right) => left.localeCompare(right));
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
    fail("MATERIAL_INVALID", `Evaluator pack inventory mismatch: expected ${wanted.join(", ")}; received ${actual.join(", ")}.`);
  }
}

export async function materializeGrandHallProtectedRegionMetricsPack(
  options: MaterializeGrandHallProtectedRegionMetricsPackOptions,
): Promise<{ readonly outputDirectory: string; readonly receipt: z.infer<typeof PackReceiptSchema> }> {
  await verifyLpipsStaticMaterial();
  const [implementation, configuration] = await Promise.all([
    buildImplementationManifest(),
    Promise.resolve(buildConfiguration()),
  ]);
  const implementationBytes = canonicalBytes(implementation);
  const configurationBytes = canonicalBytes(configuration);
  const runtime = buildRuntime(sha256(implementationBytes), sha256(configurationBytes));
  const runtimeBytes = canonicalBytes(runtime);
  const beforeReceipt = [
    { name: GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_FILENAME, bytes: implementationBytes },
    { name: GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_FILENAME, bytes: configurationBytes },
    { name: GRAND_HALL_PROTECTED_METRICS_RUNTIME_FILENAME, bytes: runtimeBytes },
  ] as const;
  const receiptPayload = PackReceiptPayloadSchema.parse({
    schemaVersion: GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_SCHEMA,
    authority: "none",
    receiptWrittenLast: true,
    filesBeforeReceipt: beforeReceipt.map((file) => fileReceipt(file.name, file.bytes)),
  });
  const receipt = PackReceiptSchema.parse(withDigest(receiptPayload, "packReceiptSha256", PACK_RECEIPT_DIGEST_DOMAIN));
  const claim = await claimStagingDirectory(options.outputDirectory);
  for (const file of beforeReceipt) {
    await requireDirectoryIdentity(claim.staging, claim.identity, "Evaluator staging directory during materialization");
    await writeExclusive(resolve(claim.staging, file.name), file.bytes);
  }
  await requireDirectoryIdentity(claim.staging, claim.identity, "Evaluator staging directory before receipt");
  await writeExclusive(resolve(claim.staging, GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_FILENAME), canonicalBytes(receipt));
  await exactDirectoryInventory(claim.staging, [
    ...beforeReceipt.map((file) => file.name),
    GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_FILENAME,
  ]);
  await options.beforePublishTestHook?.(claim.staging);
  const outputDirectory = await publishStagingDirectory(claim);
  await exactDirectoryInventory(outputDirectory, [
    ...beforeReceipt.map((file) => file.name),
    GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_FILENAME,
  ]);
  return { outputDirectory, receipt };
}

function requireSelfDigest<T extends Record<string, unknown>>(
  value: T,
  digestKey: keyof T,
  domain: string,
  label: string,
): void {
  const actual = value[digestKey];
  const payload = Object.fromEntries(Object.entries(value).filter(([key]) => key !== String(digestKey)));
  if (actual !== domainDigest(domain, payload)) fail("MATERIAL_INVALID", `${label} self-digest is invalid.`);
}

async function verifyEvaluatorFiles(
  implementationFile: StableFile,
  configurationFile: StableFile,
  runtimeFile: StableFile,
  receiptFile: StableFile | null,
): Promise<VerifiedEvaluatorMaterial> {
  await verifyLpipsStaticMaterial();
  const implementation = parseCanonical(implementationFile, ImplementationManifestSchema, "Evaluator implementation manifest");
  const configuration = parseCanonical(configurationFile, ConfigurationSchema, "Evaluator configuration");
  const runtime = parseCanonical(runtimeFile, RuntimeSchema, "Evaluator runtime");
  requireSelfDigest(implementation, "implementationManifestSha256", IMPLEMENTATION_DIGEST_DOMAIN, "Evaluator implementation manifest");
  requireSelfDigest(configuration, "configurationSha256", CONFIGURATION_DIGEST_DOMAIN, "Evaluator configuration");
  requireSelfDigest(runtime, "runtimeSha256", RUNTIME_DIGEST_DOMAIN, "Evaluator runtime");
  if (canonicalJson(toCanonicalValue(configuration)) !== canonicalJson(toCanonicalValue(buildConfiguration()))) {
    fail("MATERIAL_INVALID", "Evaluator configuration is not the exact supported configuration.");
  }
  const currentImplementation = await buildImplementationManifest();
  if (canonicalJson(toCanonicalValue(implementation)) !== canonicalJson(toCanonicalValue(currentImplementation))) {
    fail("MATERIAL_INVALID", "Evaluator implementation closure does not match the executing implementation bytes.");
  }
  const currentRuntime = buildRuntime(implementationFile.sha256, configurationFile.sha256);
  if (canonicalJson(toCanonicalValue(runtime)) !== canonicalJson(toCanonicalValue(currentRuntime))) {
    fail("MATERIAL_INVALID", "Evaluator runtime closure does not match the executing runtime and copied artifact bytes.");
  }
  if (receiptFile !== null) {
    const receipt = parseCanonical(receiptFile, PackReceiptSchema, "Evaluator pack receipt");
    requireSelfDigest(receipt, "packReceiptSha256", PACK_RECEIPT_DIGEST_DOMAIN, "Evaluator pack receipt");
    const expectedReceipts = [implementationFile, configurationFile, runtimeFile].map((file) =>
      fileReceipt(basename(file.absolutePath), file.bytes));
    if (canonicalJson(toCanonicalValue(receipt.filesBeforeReceipt)) !== canonicalJson(toCanonicalValue(expectedReceipts))) {
      fail("MATERIAL_INVALID", "Evaluator pack receipt does not bind the exact files.");
    }
  }
  return { implementationFile, configurationFile, runtimeFile, receiptFile };
}

async function verifyEvaluatorPack(input: string): Promise<VerifiedEvaluatorMaterial> {
  const directory = canonicalPath(input, "Evaluator pack directory");
  const physical = await realpath(directory).catch((error: unknown) =>
    fail("INPUT_INVALID", "Evaluator pack directory cannot be resolved.", error));
  if (!samePath(directory, physical)) fail("INPUT_INVALID", "Evaluator pack directory must not traverse a link or junction.");
  const [implementationFile, configurationFile, runtimeFile, receiptFile] = await Promise.all([
    stableRead(resolve(directory, GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_FILENAME), "Evaluator implementation manifest", MAX_IMPLEMENTATION_BYTES),
    stableRead(resolve(directory, GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_FILENAME), "Evaluator configuration", MAX_IMPLEMENTATION_BYTES),
    stableRead(resolve(directory, GRAND_HALL_PROTECTED_METRICS_RUNTIME_FILENAME), "Evaluator runtime", MAX_IMPLEMENTATION_BYTES),
    stableRead(resolve(directory, GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_FILENAME), "Evaluator pack receipt", MAX_IMPLEMENTATION_BYTES),
  ]);
  await exactDirectoryInventory(directory, [
    GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_FILENAME,
    GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_FILENAME,
    GRAND_HALL_PROTECTED_METRICS_RUNTIME_FILENAME,
    GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_FILENAME,
  ]);
  return verifyEvaluatorFiles(implementationFile, configurationFile, runtimeFile, receiptFile);
}

async function verifyExplicitEvaluatorMaterial(
  implementationPath: string,
  configurationPath: string,
  runtimePath: string,
): Promise<VerifiedEvaluatorMaterial> {
  const [implementationFile, configurationFile, runtimeFile] = await Promise.all([
    stableRead(implementationPath, "Copied evaluator implementation manifest", MAX_IMPLEMENTATION_BYTES),
    stableRead(configurationPath, "Copied evaluator configuration", MAX_IMPLEMENTATION_BYTES),
    stableRead(runtimePath, "Copied evaluator runtime", MAX_IMPLEMENTATION_BYTES),
  ]);
  const identities = new Set([implementationFile.absolutePath, configurationFile.absolutePath, runtimeFile.absolutePath].map((path) =>
    process.platform === "win32" ? path.toLowerCase() : path));
  if (identities.size !== 3) fail("INPUT_INVALID", "Copied evaluator implementation, configuration, and runtime must be distinct files.");
  return verifyEvaluatorFiles(implementationFile, configurationFile, runtimeFile, null);
}

async function decodeRgb(file: StableFile, role: "source" | "candidate"): Promise<DecodedImage> {
  const decoderOptions = { failOn: "error" as const, limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true };
  const metadata = await sharp(file.bytes, decoderOptions).metadata().catch((error: unknown) =>
    fail("INPUT_INVALID", `${role} PNG metadata could not be decoded.`, error));
  if (metadata.format !== "png" || metadata.width <= 0 || metadata.height <= 0 ||
      metadata.pages !== undefined && metadata.pages !== 1 ||
      metadata.channels !== 3 || metadata.hasAlpha || metadata.hasProfile || metadata.orientation !== undefined ||
      metadata.space !== "srgb" || metadata.depth !== "uchar") {
    fail("INPUT_INVALID", `${role} must be a single-page, opaque, three-channel, 8-bit sRGB PNG.`);
  }
  const decoded = await sharp(file.bytes, decoderOptions).toColourspace("srgb").raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true })
    .catch((error: unknown) => fail("INPUT_INVALID", `${role} PNG pixels could not be decoded.`, error));
  if (decoded.info.width !== metadata.width || decoded.info.height !== metadata.height || decoded.info.channels !== 3 ||
      decoded.data.byteLength !== metadata.width * metadata.height * 3) {
    fail("INPUT_INVALID", `${role} decoded pixels do not match its declared extent.`);
  }
  return {
    pixels: decoded.data,
    binding: {
      role,
      mediaType: "image/png",
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      width: metadata.width,
      height: metadata.height,
      channels: 3,
      colourspace: "srgb",
      depth: "uchar",
    },
  };
}

async function decodeMask(file: StableFile): Promise<DecodedImage> {
  const decoderOptions = { failOn: "error" as const, limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true };
  const metadata = await sharp(file.bytes, decoderOptions).metadata().catch((error: unknown) =>
    fail("INPUT_INVALID", "Protected-mask PNG metadata could not be decoded.", error));
  if (metadata.format !== "png" || metadata.width <= 0 || metadata.height <= 0 ||
      metadata.pages !== undefined && metadata.pages !== 1 ||
      metadata.channels !== 1 || metadata.hasAlpha || metadata.hasProfile || metadata.orientation !== undefined ||
      metadata.space !== "b-w" || metadata.depth !== "uchar") {
    fail("INPUT_INVALID", "Protected mask must be a single-page, one-channel, 8-bit grayscale PNG without alpha.");
  }
  const decoded = await sharp(file.bytes, decoderOptions).toColourspace("b-w").raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true })
    .catch((error: unknown) => fail("INPUT_INVALID", "Protected-mask PNG pixels could not be decoded.", error));
  if (decoded.info.width !== metadata.width || decoded.info.height !== metadata.height || decoded.info.channels !== 1 ||
      decoded.data.byteLength !== metadata.width * metadata.height) {
    fail("INPUT_INVALID", "Protected-mask decoded pixels do not match its declared extent.");
  }
  let protectedCount = 0;
  for (const value of decoded.data) {
    if (value !== 0 && value !== 255) fail("INPUT_INVALID", "Protected mask must be exactly binary: every sample must be 0 or 255.");
    if (value === 255) protectedCount += 1;
  }
  if (protectedCount === 0) fail("METRIC_UNDEFINED", "Protected mask contains no protected pixels.");
  return {
    pixels: decoded.data,
    binding: {
      role: "protected_mask",
      mediaType: "image/png",
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      width: metadata.width,
      height: metadata.height,
      channels: 1,
      colourspace: "b-w",
      depth: "uchar",
    },
  };
}

function luma(rgb: Buffer): Float64Array {
  const output = new Float64Array(rgb.byteLength / 3);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    const offset = pixel * 3;
    output[pixel] = 0.2126 * numericSample(rgb, offset) +
      0.7152 * numericSample(rgb, offset + 1) +
      0.0722 * numericSample(rgb, offset + 2);
  }
  return output;
}

function numericSample(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined) fail("METRIC_UNDEFINED", `Metric sample index ${String(index)} is outside its exact buffer.`);
  return value;
}

function gaussianKernel(): Float64Array {
  const radius = 5;
  const sigma = 1.5;
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let index = -radius; index <= radius; index += 1) {
    const value = Math.exp(-(index * index) / (2 * sigma * sigma));
    kernel[index + radius] = value;
    sum += value;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] = numericSample(kernel, index) / sum;
  return kernel;
}

function convolveSeparable(values: Float64Array, width: number, height: number, kernel: Float64Array): Float64Array {
  const radius = Math.floor(kernel.length / 2);
  const horizontal = new Float64Array(values.length);
  const output = new Float64Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = x + offset;
        if (sampleX >= 0 && sampleX < width) {
          total += numericSample(values, y * width + sampleX) * numericSample(kernel, offset + radius);
        }
      }
      horizontal[y * width + x] = total;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = y + offset;
        if (sampleY >= 0 && sampleY < height) {
          total += numericSample(horizontal, sampleY * width + x) * numericSample(kernel, offset + radius);
        }
      }
      output[y * width + x] = total;
    }
  }
  return output;
}

function maskedMoment(values: Float64Array, mask: Buffer, transform: (value: number, index: number) => number): Float64Array {
  const output = new Float64Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    if (mask[index] === 255) output[index] = transform(numericSample(values, index), index);
  }
  return output;
}

function protectedSsim(
  source: Float64Array,
  candidate: Float64Array,
  mask: Buffer,
  width: number,
  height: number,
): { readonly raw: number; readonly bounded: number } {
  const kernel = gaussianKernel();
  const maskValues = maskedMoment(source, mask, () => 1);
  const weight = convolveSeparable(maskValues, width, height, kernel);
  const sourceMeanNumerator = convolveSeparable(maskedMoment(source, mask, (value) => value), width, height, kernel);
  const candidateMeanNumerator = convolveSeparable(maskedMoment(candidate, mask, (_value, index) => numericSample(candidate, index)), width, height, kernel);
  const sourceSquare = convolveSeparable(maskedMoment(source, mask, (value) => value * value), width, height, kernel);
  const candidateSquare = convolveSeparable(maskedMoment(candidate, mask, (_value, index) => numericSample(candidate, index) ** 2), width, height, kernel);
  const cross = convolveSeparable(maskedMoment(source, mask, (value, index) => value * numericSample(candidate, index)), width, height, kernel);
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  let total = 0;
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 255) continue;
    const localWeight = numericSample(weight, index);
    if (!(localWeight > 0)) fail("METRIC_UNDEFINED", "SSIM window has no protected sample weight.");
    const meanSource = numericSample(sourceMeanNumerator, index) / localWeight;
    const meanCandidate = numericSample(candidateMeanNumerator, index) / localWeight;
    const varianceSource = Math.max(0, numericSample(sourceSquare, index) / localWeight - meanSource * meanSource);
    const varianceCandidate = Math.max(0, numericSample(candidateSquare, index) / localWeight - meanCandidate * meanCandidate);
    const covariance = numericSample(cross, index) / localWeight - meanSource * meanCandidate;
    const numerator = (2 * meanSource * meanCandidate + c1) * (2 * covariance + c2);
    const denominator = (meanSource * meanSource + meanCandidate * meanCandidate + c1) *
      (varianceSource + varianceCandidate + c2);
    if (!(denominator > 0) || !Number.isFinite(numerator / denominator)) {
      fail("METRIC_UNDEFINED", "SSIM produced a non-finite local value.");
    }
    total += Math.max(-1, Math.min(1, numerator / denominator));
    count += 1;
  }
  if (count === 0) fail("METRIC_UNDEFINED", "SSIM has no protected evaluation centres.");
  const raw = Math.max(-1, Math.min(1, total / count));
  return { raw, bounded: Math.max(0, Math.min(1, raw)) };
}

function sobelEdges(
  luminance: Float64Array,
  mask: Buffer,
  width: number,
  height: number,
): { readonly edges: Uint8Array; readonly eligibleCenterCount: number } {
  const edges = new Uint8Array(luminance.length);
  let eligibleCenterCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let fullyProtected = true;
      for (let maskY = y - 1; maskY <= y + 1 && fullyProtected; maskY += 1) {
        for (let maskX = x - 1; maskX <= x + 1; maskX += 1) {
          if (mask[maskY * width + maskX] !== 255) { fullyProtected = false; break; }
        }
      }
      if (!fullyProtected) continue;
      eligibleCenterCount += 1;
      const topLeft = numericSample(luminance, (y - 1) * width + x - 1);
      const top = numericSample(luminance, (y - 1) * width + x);
      const topRight = numericSample(luminance, (y - 1) * width + x + 1);
      const left = numericSample(luminance, y * width + x - 1);
      const right = numericSample(luminance, y * width + x + 1);
      const bottomLeft = numericSample(luminance, (y + 1) * width + x - 1);
      const bottom = numericSample(luminance, (y + 1) * width + x);
      const bottomRight = numericSample(luminance, (y + 1) * width + x + 1);
      const gradientX = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
      const gradientY = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      if (Math.hypot(gradientX, gradientY) >= 64) edges[y * width + x] = 1;
    }
  }
  return { edges, eligibleCenterCount };
}

function distanceTransformOneDimension(values: Float64Array): Float64Array {
  const length = values.length;
  const distances = new Float64Array(length);
  const locations = new Int32Array(length);
  const boundaries = new Float64Array(length + 1);
  let envelope = 0;
  locations[0] = 0;
  boundaries[0] = Number.NEGATIVE_INFINITY;
  boundaries[1] = Number.POSITIVE_INFINITY;
  for (let position = 1; position < length; position += 1) {
    let intersection = 0;
    let searching = true;
    while (searching) {
      const previous = numericSample(locations, envelope);
      intersection = ((numericSample(values, position) + position * position) - (numericSample(values, previous) + previous * previous)) /
        (2 * position - 2 * previous);
      if (intersection > numericSample(boundaries, envelope)) {
        searching = false;
      } else {
        envelope -= 1;
        if (envelope < 0) fail("METRIC_UNDEFINED", "Distance-transform envelope became invalid.");
      }
    }
    envelope += 1;
    locations[envelope] = position;
    boundaries[envelope] = intersection;
    boundaries[envelope + 1] = Number.POSITIVE_INFINITY;
  }
  envelope = 0;
  for (let position = 0; position < length; position += 1) {
    while (numericSample(boundaries, envelope + 1) < position) envelope += 1;
    const nearest = numericSample(locations, envelope);
    distances[position] = (position - nearest) ** 2 + numericSample(values, nearest);
  }
  return distances;
}

function squaredEuclideanDistanceTransform(features: Uint8Array, width: number, height: number): Float64Array {
  const unreachable = width * width + height * height + 1;
  const horizontal = new Float64Array(features.length);
  const row = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) row[x] = features[y * width + x] === 1 ? 0 : unreachable;
    horizontal.set(distanceTransformOneDimension(row), y * width);
  }
  const output = new Float64Array(features.length);
  const column = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) column[y] = numericSample(horizontal, y * width + x);
    const transformed = distanceTransformOneDimension(column);
    for (let y = 0; y < height; y += 1) output[y * width + x] = numericSample(transformed, y);
  }
  return output;
}

function edgeDisplacement(
  sourceLuma: Float64Array,
  candidateLuma: Float64Array,
  mask: Buffer,
  width: number,
  height: number,
): { readonly sourceCount: number; readonly candidateCount: number; readonly maximumPixels: number } {
  const sourceEdgeAnalysis = sobelEdges(sourceLuma, mask, width, height);
  const candidateEdgeAnalysis = sobelEdges(candidateLuma, mask, width, height);
  if (sourceEdgeAnalysis.eligibleCenterCount === 0 ||
      sourceEdgeAnalysis.eligibleCenterCount !== candidateEdgeAnalysis.eligibleCenterCount) {
    fail("METRIC_UNDEFINED", "Protected mask has no valid three-by-three Sobel evaluation neighbourhood.");
  }
  const sourceEdges = sourceEdgeAnalysis.edges;
  const candidateEdges = candidateEdgeAnalysis.edges;
  const sourceCount = sourceEdges.reduce((sum, value) => sum + value, 0);
  const candidateCount = candidateEdges.reduce((sum, value) => sum + value, 0);
  if (sourceCount === 0 && candidateCount === 0) return { sourceCount, candidateCount, maximumPixels: 0 };
  if (sourceCount === 0 || candidateCount === 0) {
    fail("METRIC_UNDEFINED", "Protected edge displacement is undefined because exactly one image has protected Sobel edges.");
  }
  const distanceToSource = squaredEuclideanDistanceTransform(sourceEdges, width, height);
  const distanceToCandidate = squaredEuclideanDistanceTransform(candidateEdges, width, height);
  let maximumSquared = 0;
  for (let index = 0; index < sourceEdges.length; index += 1) {
    if (sourceEdges[index] === 1) maximumSquared = Math.max(maximumSquared, numericSample(distanceToCandidate, index));
    if (candidateEdges[index] === 1) maximumSquared = Math.max(maximumSquared, numericSample(distanceToSource, index));
  }
  return { sourceCount, candidateCount, maximumPixels: Math.sqrt(maximumSquared) };
}

function hostPathToWsl(input: string, label: string): string {
  const path = canonicalPath(input, label);
  const match = /^([A-Za-z]):\\(.*)$/u.exec(path);
  if (match === null) fail("INPUT_INVALID", `${label} must be a Windows drive path addressable through WSL.`);
  const drive = match[1];
  const remainder = match[2];
  if (drive === undefined || remainder === undefined || remainder.split("").some((character) => character.charCodeAt(0) <= 0x1f)) {
    fail("INPUT_INVALID", `${label} cannot be represented as a safe WSL path.`);
  }
  return `/mnt/${drive.toLowerCase()}/${remainder.replaceAll("\\", "/")}`;
}

interface ProcessOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function spawnBounded(
  command: string, arguments_: readonly string[], timeoutMs = 180_000, stdinBytes?: Buffer,
): Promise<ProcessOutcome> {
  return new Promise<ProcessOutcome>((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...arguments_], {
      shell: false,
      windowsHide: true,
      stdio: [stdinBytes === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: {
        SystemRoot: "C:\\Windows",
        WINDIR: "C:\\Windows",
        WSLENV: "",
        CUDA_VISIBLE_DEVICES: "",
        OMP_NUM_THREADS: "1",
        MKL_NUM_THREADS: "1",
        OPENBLAS_NUM_THREADS: "1",
        PYTHONHASHSEED: "0",
        TORCH_HOME: "/mnt/c/Users/blake/.cache/torch",
        TOKENIZERS_PARALLELISM: "false",
      },
    });
    if (child.stdout === null || child.stderr === null) {
      child.kill();
      rejectPromise(new GrandHallProtectedRegionMetricsError("METRIC_UNDEFINED", "Offline process pipes were not created."));
      return;
    }
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    const rejectOnce = (error: GrandHallProtectedRegionMetricsError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(error);
    };
    const collect = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill();
        return;
      }
      target.push(Buffer.from(chunk));
    };
    childStdout.on("data", (chunk: Buffer) => { collect(stdout, chunk); });
    childStderr.on("data", (chunk: Buffer) => { collect(stderr, chunk); });
    if (stdinBytes !== undefined && child.stdin !== null) {
      child.stdin.once("error", (error) => {
        child.kill();
        rejectOnce(new GrandHallProtectedRegionMetricsError("METRIC_UNDEFINED", "Offline process rejected its exact bounded input.", error));
      });
      child.stdin.end(stdinBytes);
    }
    child.once("error", (error) => {
      rejectOnce(new GrandHallProtectedRegionMetricsError("METRIC_UNDEFINED", "Offline LPIPS process could not start.", error));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        rejectPromise(new GrandHallProtectedRegionMetricsError("METRIC_UNDEFINED", "Offline LPIPS process exceeded its output bound."));
        return;
      }
      resolvePromise({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function verifyExactLpipsRuntime(): Promise<z.infer<typeof RuntimeAttestationSchema>> {
  const tool = await stableRead(RUNTIME_SEAL_TOOL_PATH, "Difix runtime-seal verifier", MAX_IMPLEMENTATION_BYTES);
  const sealFile = await stableRead(LPIPS_RUNTIME_SEAL_PATH, "Difix runtime seal", 16 * 1024 * 1024);
  if (tool.sizeBytes !== RUNTIME_SEAL_TOOL_SIZE || tool.sha256 !== RUNTIME_SEAL_TOOL_SHA256) {
    fail("MATERIAL_INVALID", "Difix runtime-seal verifier does not match its exact lock.");
  }
  const seal = GrandHallDifixRuntimeSealSchema.parse(JSON.parse(sealFile.bytes.toString("utf8")));
  const args = [
    "--distribution", "Ubuntu", "--exec", "/usr/bin/unshare", "--user", "--map-root-user", "--net",
    "/usr/bin/env", "-i", "HOME=/tmp", "PATH=/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE=1", "PYTHONNOUSERSITE=1",
    "/usr/bin/python3", "-I", "-B", "-S", "-c", STABLE_PYTHON_BOOTSTRAP,
    RUNTIME_SEAL_TOOL_WSL, RUNTIME_SEAL_TOOL_SHA256, String(RUNTIME_SEAL_TOOL_SIZE), "check-runtime",
    "--venv-host", seal.venv.hostRoot, "--venv-wsl", seal.venv.wslRoot,
    "--venv-python-wsl", LPIPS_VENV_PYTHON_WSL, "--trusted-verifier-python-wsl", "/usr/bin/python3",
    "--source-host", seal.providerSourceTree.hostRoot, "--source-wsl", seal.providerSourceTree.wslRoot,
    "--source-archive-host", seal.sourceArchive.hostPath, "--source-archive-wsl", seal.sourceArchive.wslPath,
    "--wheelhouse-host", seal.wheelhouse.hostRoot, "--wheelhouse-wsl", seal.wheelhouse.wslRoot,
    "--wheel-hashes-host", seal.wheelHashInventory.hostPath, "--wheel-hashes-wsl", seal.wheelHashInventory.wslPath,
    "--pip-freeze-host", seal.pipFreeze.hostPath, "--pip-freeze-wsl", seal.pipFreeze.wslPath,
    "--manifest", "/dev/stdin",
  ] as const;
  const outcome = await spawnBounded("C:\\Windows\\System32\\wsl.exe", args, 3_600_000, sealFile.bytes);
  if (outcome.exitCode !== 0 || outcome.stderr !== "") fail("MATERIAL_INVALID", `Exact runtime inventory check failed: ${outcome.stderr.slice(0, 2_000)}`);
  const receipt = z.object({ state: z.literal("runtime_checked"), runtimeSealSha256: z.literal(LPIPS_RUNTIME_SEAL_INNER_SHA256) }).strict().safeParse(JSON.parse(outcome.stdout));
  if (!receipt.success) fail("MATERIAL_INVALID", "Exact runtime inventory check returned an invalid receipt.");
  await requireUnchanged(tool, "Difix runtime-seal verifier", MAX_IMPLEMENTATION_BYTES);
  await requireUnchanged(sealFile, "Difix runtime seal", 16 * 1024 * 1024);
  return RuntimeAttestationSchema.parse({
    state: "runtime_checked",
    runtimeSealFileSha256: sealFile.sha256,
    runtimeSealSha256: receipt.data.runtimeSealSha256,
    verifierSha256: tool.sha256,
    networkNamespace: "linux_unshare_user_map_root_net",
  });
}

async function evaluateProtectedLpips(
  sourceFile: StableFile,
  candidateFile: StableFile,
  maskFile: StableFile,
  expectedWidth: number,
  expectedHeight: number,
  expectedProtectedCount: number,
  expectedImplementation: { readonly sha256: string; readonly sizeBytes: number },
  beforeImplementationBootstrapTestHook?: (implementationPath: string) => Promise<void>,
): Promise<z.infer<typeof LpipsProcessResultSchema>> {
  const pythonPath = implementationPaths().find((path) => basename(path) === LPIPS_PYTHON_FILENAME);
  if (pythonPath === undefined) fail("MATERIAL_INVALID", "LPIPS implementation is absent from the evaluator closure.");
  const implementation = await stableRead(pythonPath, "LPIPS implementation", MAX_IMPLEMENTATION_BYTES);
  if (implementation.sha256 !== expectedImplementation.sha256 || implementation.sizeBytes !== expectedImplementation.sizeBytes) {
    fail("MATERIAL_INVALID", "LPIPS implementation no longer matches the verified evaluator manifest member.");
  }
  await beforeImplementationBootstrapTestHook?.(implementation.absolutePath);
  await requireUnchanged(implementation, "LPIPS implementation before stable bootstrap", MAX_IMPLEMENTATION_BYTES);
  const runtimeAttestation = await verifyExactLpipsRuntime();
  const arguments_ = [
    "--distribution", "Ubuntu", "--exec", "/usr/bin/unshare", "--user", "--map-root-user", "--net",
    "/usr/bin/env", "-i", "HOME=/tmp", "PATH=/usr/bin:/bin", "LANG=C.UTF-8", "PYTHONDONTWRITEBYTECODE=1",
    "PYTHONNOUSERSITE=1", "PYTHONHASHSEED=0", "OMP_NUM_THREADS=1", "MKL_NUM_THREADS=1", "OPENBLAS_NUM_THREADS=1",
    "CUDA_VISIBLE_DEVICES=", "TOKENIZERS_PARALLELISM=false",
    LPIPS_VENV_PYTHON_WSL, "-I", "-B", "-c", STABLE_PYTHON_BOOTSTRAP,
    hostPathToWsl(implementation.absolutePath, "LPIPS implementation"), implementation.sha256, String(implementation.sizeBytes),
    "--source", hostPathToWsl(sourceFile.absolutePath, "LPIPS source"),
    "--candidate", hostPathToWsl(candidateFile.absolutePath, "LPIPS candidate"),
    "--protected-mask", hostPathToWsl(maskFile.absolutePath, "LPIPS protected mask"),
    "--source-sha256", sourceFile.sha256.slice("sha256:".length),
    "--candidate-sha256", candidateFile.sha256.slice("sha256:".length),
    "--protected-mask-sha256", maskFile.sha256.slice("sha256:".length),
    "--alexnet-weight", hostPathToWsl(LPIPS_ALEXNET_WEIGHT_PATH, "LPIPS AlexNet weight"),
    "--calibration-weight", hostPathToWsl(LPIPS_CALIBRATION_WEIGHT_PATH, "LPIPS calibration weight"),
    "--implementation", hostPathToWsl(implementation.absolutePath, "LPIPS implementation"),
    "--implementation-sha256", implementation.sha256.slice("sha256:".length),
  ] as const;
  const outcome = await spawnBounded("C:\\Windows\\System32\\wsl.exe", arguments_);
  if (outcome.exitCode !== 0 || outcome.stderr !== "") {
    fail("METRIC_UNDEFINED", `Offline LPIPS failed closed (exit ${String(outcome.exitCode)}): ${outcome.stderr.slice(0, 2_000)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.stdout);
  } catch (error) {
    fail("METRIC_UNDEFINED", "Offline LPIPS did not emit valid JSON.", error);
  }
  if (!outcome.stdout.startsWith("{") || !outcome.stdout.endsWith("}\n") || outcome.stdout.slice(0, -1).includes("\n")) {
    fail("METRIC_UNDEFINED", "Offline LPIPS output must be one compact JSON object with one LF terminator.");
  }
  const pythonResult = LpipsPythonResultSchema.safeParse(parsed);
  if (!pythonResult.success) fail("METRIC_UNDEFINED", `Offline LPIPS result is invalid: ${pythonResult.error.message}`);
  const value = LpipsProcessResultSchema.parse({ ...pythonResult.data, runtimeAttestation });
  const expectedInputs = {
    source: { sha256: sourceFile.sha256, sizeBytes: sourceFile.sizeBytes },
    candidate: { sha256: candidateFile.sha256, sizeBytes: candidateFile.sizeBytes },
    protected_mask: { sha256: maskFile.sha256, sizeBytes: maskFile.sizeBytes },
    implementation: { sha256: implementation.sha256, sizeBytes: implementation.sizeBytes },
  };
  if (value.nativeWidth !== expectedWidth || value.nativeHeight !== expectedHeight ||
      value.protectedPixelCount !== expectedProtectedCount ||
      canonicalJson(toCanonicalValue(value.inputs)) !== canonicalJson(toCanonicalValue(expectedInputs))) {
    fail("METRIC_UNDEFINED", "Offline LPIPS result does not bind the exact inputs, extent, and mask count.");
  }
  await requireUnchanged(implementation, "LPIPS implementation", MAX_IMPLEMENTATION_BYTES);
  return value;
}

function calculateMetrics(
  source: DecodedImage,
  candidate: DecodedImage,
  mask: DecodedImage,
): Omit<z.infer<typeof ResultPayloadSchema>["metrics"], "protectedRegionLpips"> {
  const { width, height } = source.binding;
  if (candidate.binding.width !== width || candidate.binding.height !== height ||
      mask.binding.width !== width || mask.binding.height !== height) {
    fail("INPUT_INVALID", "Source, candidate, and protected-mask decoded extents must match exactly.");
  }
  let protectedPixelCount = 0;
  let absoluteError = 0;
  for (let pixel = 0; pixel < mask.pixels.length; pixel += 1) {
    if (mask.pixels[pixel] !== 255) continue;
    protectedPixelCount += 1;
    const offset = pixel * 3;
    absoluteError += Math.abs(numericSample(source.pixels, offset) - numericSample(candidate.pixels, offset));
    absoluteError += Math.abs(numericSample(source.pixels, offset + 1) - numericSample(candidate.pixels, offset + 1));
    absoluteError += Math.abs(numericSample(source.pixels, offset + 2) - numericSample(candidate.pixels, offset + 2));
  }
  if (protectedPixelCount === 0) fail("METRIC_UNDEFINED", "Protected mask contains no protected pixels.");
  const sourceLuma = luma(source.pixels);
  const candidateLuma = luma(candidate.pixels);
  const ssim = absoluteError === 0
    ? { raw: 1, bounded: 1 }
    : protectedSsim(sourceLuma, candidateLuma, mask.pixels, width, height);
  const edges = edgeDisplacement(sourceLuma, candidateLuma, mask.pixels, width, height);
  return {
    protectedPixelCount,
    protectedRgbSampleCount: protectedPixelCount * 3,
    protectedRegionMeanAbsoluteError: absoluteError / (protectedPixelCount * 3 * 255),
    protectedRegionSsim: ssim.bounded,
    rawProtectedRegionSsim: ssim.raw,
    sourceProtectedEdgePixelCount: edges.sourceCount,
    candidateProtectedEdgePixelCount: edges.candidateCount,
    maximumProtectedEdgeDisplacementPixels: edges.maximumPixels,
  };
}

export async function calculateGrandHallProtectedPixelEdgeMetrics(options: {
  readonly sourcePath: string;
  readonly candidatePath: string;
  readonly protectedMaskPath: string;
}): Promise<ReturnType<typeof calculateMetrics>> {
  const [sourceFile, candidateFile, maskFile] = await Promise.all([
    stableRead(options.sourcePath, "Source PNG", MAX_IMAGE_BYTES),
    stableRead(options.candidatePath, "Candidate PNG", MAX_IMAGE_BYTES),
    stableRead(options.protectedMaskPath, "Protected-mask PNG", MAX_IMAGE_BYTES),
  ]);
  const [source, candidate, mask] = await Promise.all([
    decodeRgb(sourceFile, "source"), decodeRgb(candidateFile, "candidate"), decodeMask(maskFile),
  ]);
  const metrics = calculateMetrics(source, candidate, mask);
  await Promise.all([
    requireUnchanged(sourceFile, "Source PNG", MAX_IMAGE_BYTES),
    requireUnchanged(candidateFile, "Candidate PNG", MAX_IMAGE_BYTES),
    requireUnchanged(maskFile, "Protected-mask PNG", MAX_IMAGE_BYTES),
  ]);
  return metrics;
}

async function ensurePositiveCompletion(startedMs: number): Promise<string> {
  while (Date.now() <= startedMs) await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  return new Date().toISOString();
}

export async function evaluateGrandHallProtectedRegionMetrics(
  options: EvaluateGrandHallProtectedRegionMetricsOptions,
): Promise<GrandHallProtectedRegionMetricsResult> {
  const outputPath = canonicalPath(options.outputPath, "Protected-metrics result output");
  const outputParent = dirname(outputPath);
  const physicalOutputParent = await realpath(outputParent).catch((error: unknown) =>
    fail("OUTPUT_UNSAFE", "Protected-metrics result parent must already exist.", error));
  if (!samePath(outputParent, physicalOutputParent)) fail("OUTPUT_UNSAFE", "Protected-metrics result parent must not traverse a link or junction.");
  const initialOutputParentStats = await lstat(outputParent, { bigint: true });
  if (!initialOutputParentStats.isDirectory()) fail("OUTPUT_UNSAFE", "Protected-metrics result parent is not a directory.");
  const initialOutputParentIdentity = directoryIdentity(initialOutputParentStats);
  try {
    await lstat(outputPath);
    fail("OUTPUT_EXISTS", "Protected-metrics result output must be absent before evaluation.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (options.evaluatorPackDirectory !== undefined) {
    const packRelationship = relative(resolve(options.evaluatorPackDirectory), outputPath);
    if (packRelationship === "" || (!packRelationship.startsWith("..") && !isAbsolute(packRelationship))) {
      fail("OUTPUT_UNSAFE", "Protected-metrics result cannot be written inside the immutable evaluator pack.");
    }
  }
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const evaluatorMaterial = options.evaluatorPackDirectory !== undefined
    ? verifyEvaluatorPack(options.evaluatorPackDirectory)
    : verifyExplicitEvaluatorMaterial(
        options.evaluatorImplementationManifestPath,
        options.evaluatorConfigurationPath,
        options.evaluatorRuntimePath,
      );
  const [pack, sourceFile, candidateFile, maskFile] = await Promise.all([
    evaluatorMaterial,
    stableRead(options.sourcePath, "Source PNG", MAX_IMAGE_BYTES),
    stableRead(options.candidatePath, "Candidate PNG", MAX_IMAGE_BYTES),
    stableRead(options.protectedMaskPath, "Protected-mask PNG", MAX_IMAGE_BYTES),
  ]);
  const uniqueInputs = new Set([sourceFile.absolutePath, candidateFile.absolutePath, maskFile.absolutePath].map((path) =>
    process.platform === "win32" ? path.toLowerCase() : path));
  if (uniqueInputs.size !== 3) fail("INPUT_INVALID", "Source, candidate, and protected mask must be three distinct files.");
  const [source, candidate, mask] = await Promise.all([
    decodeRgb(sourceFile, "source"),
    decodeRgb(candidateFile, "candidate"),
    decodeMask(maskFile),
  ]);
  const pixelEdgeMetrics = calculateMetrics(source, candidate, mask);
  const implementationManifest = ImplementationManifestSchema.parse(JSON.parse(pack.implementationFile.bytes.toString("utf8")));
  const expectedLpipsImplementation = implementationManifest.members.find((member) => member.fileName === LPIPS_PYTHON_FILENAME);
  if (expectedLpipsImplementation === undefined) fail("MATERIAL_INVALID", "Verified evaluator manifest has no LPIPS implementation member.");
  const lpipsProcess = await evaluateProtectedLpips(
    sourceFile,
    candidateFile,
    maskFile,
    source.binding.width,
    source.binding.height,
    pixelEdgeMetrics.protectedPixelCount,
    expectedLpipsImplementation,
    options.beforeLpipsImplementationBootstrapTestHook,
  );
  const metrics = {
    ...pixelEdgeMetrics,
    protectedRegionLpips: lpipsProcess.protectedRegionLpips,
  };
  const stabilityChecks: Promise<void>[] = [
    requireUnchanged(sourceFile, "Source PNG", MAX_IMAGE_BYTES),
    requireUnchanged(candidateFile, "Candidate PNG", MAX_IMAGE_BYTES),
    requireUnchanged(maskFile, "Protected-mask PNG", MAX_IMAGE_BYTES),
    requireUnchanged(pack.implementationFile, "Evaluator implementation manifest", MAX_IMPLEMENTATION_BYTES),
    requireUnchanged(pack.configurationFile, "Evaluator configuration", MAX_IMPLEMENTATION_BYTES),
    requireUnchanged(pack.runtimeFile, "Evaluator runtime", MAX_IMPLEMENTATION_BYTES),
  ];
  if (pack.receiptFile !== null) {
    stabilityChecks.push(requireUnchanged(pack.receiptFile, "Evaluator pack receipt", MAX_IMPLEMENTATION_BYTES));
  }
  await Promise.all(stabilityChecks);
  const completedAt = await ensurePositiveCompletion(startedMs);
  const payload = ResultPayloadSchema.parse({
    schemaVersion: GRAND_HALL_PROTECTED_METRICS_RESULT_SCHEMA,
    authority: "none",
    status: "evaluated",
    startedAt,
    completedAt,
    evaluator: {
      implementationManifest: fileReceipt(basename(pack.implementationFile.absolutePath), pack.implementationFile.bytes),
      configuration: fileReceipt(basename(pack.configurationFile.absolutePath), pack.configurationFile.bytes),
      runtimeEnvironment: fileReceipt(basename(pack.runtimeFile.absolutePath), pack.runtimeFile.bytes),
      packReceipt: pack.receiptFile === null
        ? null
        : fileReceipt(GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_FILENAME, pack.receiptFile.bytes),
    },
    inputs: { source: source.binding, candidate: candidate.binding, protectedMask: mask.binding },
    metrics,
    lpipsProcess,
  });
  const result = GrandHallProtectedRegionMetricsResultSchema.parse(withDigest(payload, "resultSha256", RESULT_DIGEST_DOMAIN));
  await writeAtomicCreateOnlyResult(outputPath, canonicalBytes(result), initialOutputParentIdentity, options.beforeResultPublishTestHook);
  return result;
}

export async function verifyGrandHallProtectedRegionMetricsResult(
  resultPath: string,
): Promise<GrandHallProtectedRegionMetricsResult> {
  const file = await stableRead(resultPath, "Protected-metrics result", MAX_IMPLEMENTATION_BYTES);
  const result = parseCanonical(file, GrandHallProtectedRegionMetricsResultSchema, "Protected-metrics result");
  requireSelfDigest(result, "resultSha256", RESULT_DIGEST_DOMAIN, "Protected-metrics result");
  return result;
}

export type GrandHallProtectedRegionMetricsCliArguments =
  | { readonly command: "materialize"; readonly outputDirectory: string }
  | {
      readonly command: "evaluate";
      readonly sourcePath: string;
      readonly candidatePath: string;
      readonly protectedMaskPath: string;
      readonly evaluatorPackDirectory?: string;
      readonly evaluatorImplementationManifestPath?: string;
      readonly evaluatorConfigurationPath?: string;
      readonly evaluatorRuntimePath?: string;
      readonly outputPath: string;
    }
  | { readonly command: "check-result"; readonly resultPath: string };

function parseOptions(tokens: readonly string[]): ReadonlyMap<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index];
    const value = tokens[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--") || value.startsWith("--") || options.has(key)) {
      fail("INPUT_INVALID", "CLI options must be unique --name value pairs.");
    }
    options.set(key, value);
  }
  return options;
}

function exactOption(options: ReadonlyMap<string, string>, key: string): string {
  const value = options.get(key);
  if (value === undefined) fail("INPUT_INVALID", `Missing required option ${key}.`);
  return value;
}

export function parseGrandHallProtectedRegionMetricsArguments(
  argv: readonly string[],
): GrandHallProtectedRegionMetricsCliArguments {
  const command = argv[0];
  const options = parseOptions(argv.slice(1));
  const allowed = command === "materialize" ? new Set(["--output-dir"])
    : command === "evaluate" ? new Set([
        "--source", "--candidate", "--protected-mask", "--evaluator-pack", "--evaluator-implementation",
        "--evaluator-configuration", "--evaluator-runtime", "--output",
      ])
      : command === "check-result" ? new Set(["--result"])
        : fail("INPUT_INVALID", "Command must be materialize, evaluate, or check-result.");
  for (const key of options.keys()) if (!allowed.has(key)) fail("INPUT_INVALID", `Unknown option ${key}.`);
  if (command === "materialize") return { command, outputDirectory: exactOption(options, "--output-dir") };
  if (command === "check-result") return { command, resultPath: exactOption(options, "--result") };
  const evaluatorPackDirectory = options.get("--evaluator-pack");
  const evaluatorImplementationManifestPath = options.get("--evaluator-implementation");
  const evaluatorConfigurationPath = options.get("--evaluator-configuration");
  const evaluatorRuntimePath = options.get("--evaluator-runtime");
  const explicitCount = [evaluatorImplementationManifestPath, evaluatorConfigurationPath, evaluatorRuntimePath]
    .filter((value) => value !== undefined).length;
  if ((evaluatorPackDirectory === undefined && explicitCount !== 3) ||
      (evaluatorPackDirectory !== undefined && explicitCount !== 0)) {
    fail("INPUT_INVALID", "Evaluate requires either --evaluator-pack or the complete explicit evaluator implementation/configuration/runtime trio.");
  }
  return {
    command: "evaluate",
    sourcePath: exactOption(options, "--source"),
    candidatePath: exactOption(options, "--candidate"),
    protectedMaskPath: exactOption(options, "--protected-mask"),
    evaluatorPackDirectory,
    evaluatorImplementationManifestPath,
    evaluatorConfigurationPath,
    evaluatorRuntimePath,
    outputPath: exactOption(options, "--output"),
  };
}

export async function runGrandHallProtectedRegionMetricsCli(argv: readonly string[]): Promise<string> {
  const arguments_ = parseGrandHallProtectedRegionMetricsArguments(argv);
  if (arguments_.command === "materialize") {
    const result = await materializeGrandHallProtectedRegionMetricsPack({ outputDirectory: arguments_.outputDirectory });
    return canonicalJson(toCanonicalValue({ command: arguments_.command, outputDirectory: result.outputDirectory, packReceiptSha256: result.receipt.packReceiptSha256 }));
  }
  if (arguments_.command === "check-result") {
    const result = await verifyGrandHallProtectedRegionMetricsResult(arguments_.resultPath);
    return canonicalJson(toCanonicalValue({ command: arguments_.command, resultSha256: result.resultSha256, status: result.status }));
  }
  const common = {
    sourcePath: arguments_.sourcePath,
    candidatePath: arguments_.candidatePath,
    protectedMaskPath: arguments_.protectedMaskPath,
    outputPath: arguments_.outputPath,
  };
  let result: GrandHallProtectedRegionMetricsResult;
  if (arguments_.evaluatorPackDirectory !== undefined) {
    result = await evaluateGrandHallProtectedRegionMetrics({
      ...common,
      evaluatorPackDirectory: arguments_.evaluatorPackDirectory,
    });
  } else {
    const implementation = arguments_.evaluatorImplementationManifestPath;
    const configuration = arguments_.evaluatorConfigurationPath;
    const runtime = arguments_.evaluatorRuntimePath;
    if (implementation === undefined || configuration === undefined || runtime === undefined) {
      fail("INPUT_INVALID", "Explicit evaluator material is incomplete after argument validation.");
    }
    result = await evaluateGrandHallProtectedRegionMetrics({
      ...common,
      evaluatorImplementationManifestPath: implementation,
      evaluatorConfigurationPath: configuration,
      evaluatorRuntimePath: runtime,
    });
  }
  return canonicalJson(toCanonicalValue({ command: arguments_.command, resultSha256: result.resultSha256, metrics: result.metrics }));
}

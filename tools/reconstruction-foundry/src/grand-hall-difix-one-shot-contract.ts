import { createHash } from "node:crypto";

import {
  FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_MEDIA_TYPE,
  FoundryRestorationExperimentV0Schema,
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
  type FoundryRestorationExperimentV0,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import {
  GRAND_HALL_DIFIX_EXPECTED_SOURCE_MEMBERS,
  GRAND_HALL_DIFIX_INPUT_HEIGHT,
  GRAND_HALL_DIFIX_INPUT_WIDTH,
  GrandHallDifixCameraArtifactSchema,
  GrandHallDifixInputPackManifestSchema,
  GrandHallDifixReconstructionArtifactSchema,
  GrandHallDifixRendererArtifactSchema,
  GrandHallDifixRenderGenerationReceiptSchema,
  type GrandHallDifixCameraArtifact,
  type GrandHallDifixInputPackManifest,
  type GrandHallDifixReconstructionArtifact,
  type GrandHallDifixRendererArtifact,
  type GrandHallDifixRenderGenerationReceipt,
} from "./grand-hall-difix-no-reference-input-pack-contract.js";

export const GRAND_HALL_DIFIX_EXECUTION_LOCK_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-execution-lock.v1";
export const GRAND_HALL_DIFIX_AUTHORIZATION_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-execution-authorization.v1";
export const GRAND_HALL_DIFIX_RUNTIME_SEAL_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-runtime-seal.v1";
export const GRAND_HALL_DIFIX_MODEL_SEAL_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-model-seal.v1";
export const GRAND_HALL_DIFIX_ATTEMPT_RECEIPT_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-attempt-receipt.v1";
export const GRAND_HALL_DIFIX_CLAIM_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-authorization-claim.v1";
export const GRAND_HALL_DIFIX_RUNTIME_ENVIRONMENT_ARTIFACT_SCHEMA =
  "venviewer.grand-hall.difix-no-reference-runtime-environment-artifact.v1";

export const GRAND_HALL_DIFIX_PROVIDER_REPOSITORY_ID = "nv-tlabs/Difix3D";
export const GRAND_HALL_DIFIX_PROVIDER_REVISION =
  "c76edc595586e16732c91ddee82f3a6d83a8a9cc";
export const GRAND_HALL_DIFIX_MODEL_ID = "nvidia/difix";
export const GRAND_HALL_DIFIX_MODEL_REVISION =
  "2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388";
export const GRAND_HALL_DIFIX_ADAPTER_ID =
  "venviewer-grand-hall-difix-no-reference-local-one-shot-v1";
export const GRAND_HALL_DIFIX_EXPLICIT_RUN_OPT_IN =
  "I AUTHORIZE ONE LOCAL ZERO-COST NO-NETWORK DIFIX DIAGNOSTIC ATTEMPT; CONSUME THIS AUTHORIZATION EVEN IF IT FAILS.";

export const GRAND_HALL_DIFIX_MODEL_LOAD_CLOSURE = Object.freeze([
  Object.freeze({ relativePath: "model_index.json", sizeBytes: 586, sha256: "sha256:0b4316574ae102b3855c4508a13becc81b353f6455dafa6186ac37d82c8292b9" }),
  Object.freeze({ relativePath: "scheduler/scheduler_config.json", sizeBytes: 700, sha256: "sha256:78e1c4d74df2c94c7d886f0d3f9ccff9c88851dda9c6ae4ccab3356a18efa855" }),
  Object.freeze({ relativePath: "text_encoder/config.json", sizeBytes: 603, sha256: "sha256:2796729c12b32c17e039ef9d5a78bcc61d52d1afbcbe11edf004a26531c92c2a" }),
  Object.freeze({ relativePath: "text_encoder/model.safetensors", sizeBytes: 1_361_596_304, sha256: "sha256:67e013543d4fac905c882e2993d86a2d454ee69dc9e8f37c0c23d33a48959d15" }),
  Object.freeze({ relativePath: "tokenizer/merges.txt", sizeBytes: 524_619, sha256: "sha256:9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a" }),
  Object.freeze({ relativePath: "tokenizer/special_tokens_map.json", sizeBytes: 574, sha256: "sha256:c2d0fb8b86ad86b1f46134d4a5f93fd1e688c932a78efc8d149087c33a53ad06" }),
  Object.freeze({ relativePath: "tokenizer/tokenizer_config.json", sizeBytes: 885, sha256: "sha256:b91e0a1eba063043b4ee76bec870f2fa0c12a3ff404155b30e64c77d25c0758f" }),
  Object.freeze({ relativePath: "tokenizer/vocab.json", sizeBytes: 1_059_962, sha256: "sha256:e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349" }),
  Object.freeze({ relativePath: "unet/config.json", sizeBytes: 1_852, sha256: "sha256:bc47aaf41ef8a34b38ef06518ace2276bb57c38a92309c40e398a8d96a8e33db" }),
  Object.freeze({ relativePath: "unet/diffusion_pytorch_model.safetensors", sizeBytes: 3_463_726_504, sha256: "sha256:3815819b0009d16b5f7538ecbf2dd0ac4a6b07a238ab82d869465c347864bb70" }),
  Object.freeze({ relativePath: "vae/autoencoder_kl.py", sizeBytes: 24_456, sha256: "sha256:a0c16e2fe489d0386b04274b25e6cec212f37264283f8ce1c042270d27250edf" }),
  Object.freeze({ relativePath: "vae/config.json", sizeBytes: 698, sha256: "sha256:d2ea6077dead151d8d0f21cd772b0de11b056c9c723c203840f6afaa1f3185f7" }),
  Object.freeze({ relativePath: "vae/diffusion_pytorch_model.safetensors", sizeBytes: 338_717_612, sha256: "sha256:20a5e872469d801876e448ec1d499b1e99cc666497a6aa133ed22c9e0a7a1a25" }),
] as const);

const EXECUTION_LOCK_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_DIFIX_EXECUTION_LOCK_V1";
const AUTHORIZATION_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_DIFIX_AUTHORIZATION_V1";
const ATTEMPT_RECEIPT_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_DIFIX_ATTEMPT_RECEIPT_V1";
const CLAIM_DIGEST_DOMAIN = "VENVIEWER_GRAND_HALL_DIFIX_AUTHORIZATION_CLAIM_V1";

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const AbsoluteHostPathSchema = z.string().min(3).max(4_096).refine(
  (value) => /^[A-Za-z]:\\/u.test(value) || value.startsWith("/"),
  "path must be an absolute host path",
);
const AbsoluteWslPathSchema = z.string().min(2).max(4_096).refine(
  (value) => value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."),
  "path must be an absolute normalized WSL path",
);
const SafeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,159}$/u);
const NonceSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const UtcInstantSchema = z.string().datetime({ offset: true });
const IMMUTABLE_NOT_AUTHORIZED_CAPABILITIES = z.object({
  capabilities: z.object({
    execution: z.literal("not_authorized"),
    dispatchEnabled: z.literal(false),
  }).passthrough(),
}).passthrough();

export function assertGrandHallDifixBaseExperimentNotAuthorized(input: unknown): void {
  if (!IMMUTABLE_NOT_AUTHORIZED_CAPABILITIES.safeParse(input).success) {
    throw new Error("The immutable base experiment must remain not_authorized with dispatch disabled.");
  }
}

function digest(domain: string, payload: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(payload))}`;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) === stableCanonicalJson(toCanonicalJson(right));
}

function canonicalJsonFileBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function rawSha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function localExperimentMaterialSetSha256(
  materials: readonly GrandHallDifixExperimentMaterialFile[],
): string {
  return digest("VENVIEWER_GRAND_HALL_DIFIX_LOCAL_EXPERIMENT_MATERIAL_SET_V1", materials.map((material) => ({
    relativePath: material.relativePath,
    artifactIds: material.artifactIds,
    sizeBytes: material.file.sizeBytes,
    sha256: material.file.sha256,
  })));
}

function uniqueSorted(values: readonly string[]): boolean {
  return values.length === new Set(values).size
    && values.every((value, index) => index === 0 || (values[index - 1] ?? "") < value);
}

function isDirectPortableChild(parent: string, candidate: string): boolean {
  const normalizedParent = parent.replace(/[\\/]+$/u, "").toLowerCase();
  const normalizedCandidate = candidate.toLowerCase();
  if (!normalizedCandidate.startsWith(`${normalizedParent}/`) && !normalizedCandidate.startsWith(`${normalizedParent}\\`)) return false;
  const remainder = normalizedCandidate.slice(normalizedParent.length + 1);
  return remainder.length > 0 && !/[\\/]/u.test(remainder);
}

function portableBasename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? "";
}

function portableParent(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index <= 0 ? path.slice(0, Math.max(1, index + 1)) : path.slice(0, index);
}

function normalizedPortableHost(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
}

export const GrandHallDifixBoundFileSchema = z.object({
  hostPath: AbsoluteHostPathSchema,
  wslPath: AbsoluteWslPathSchema,
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: Sha256Schema,
}).strict();
export type GrandHallDifixBoundFile = z.infer<typeof GrandHallDifixBoundFileSchema>;

export const GrandHallDifixRuntimeEnvironmentArtifactSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_RUNTIME_ENVIRONMENT_ARTIFACT_SCHEMA),
  authority: z.literal("none"),
  runtimeSealArtifact: z.object({
    sourcePath: AbsoluteHostPathSchema,
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: Sha256Schema,
  }).strict(),
  runtimeSealSha256: Sha256Schema,
  runtimeId: SafeIdSchema,
  providerRepositoryId: z.literal(GRAND_HALL_DIFIX_PROVIDER_REPOSITORY_ID),
  providerRevision: z.literal(GRAND_HALL_DIFIX_PROVIDER_REVISION),
  sourceArchive: z.object({
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: Sha256Schema,
  }).strict(),
  sealedForOfflineExecution: z.literal(true),
}).strict();
export type GrandHallDifixRuntimeEnvironmentArtifact = z.infer<
  typeof GrandHallDifixRuntimeEnvironmentArtifactSchema
>;

const SafeRelativePosixPathSchema = z.string().min(1).max(4_096).refine(
  (value) => !value.startsWith("/")
    && !value.includes("\\")
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
  "path must be a normalized traversal-free relative POSIX path",
);

export const GrandHallDifixExperimentMaterialFileSchema = z.object({
  relativePath: SafeRelativePosixPathSchema.refine(
    (value) => !value.includes("/"),
    "experiment material must be one direct material-directory file",
  ),
  artifactIds: z.array(SafeIdSchema).min(1).max(128),
  file: GrandHallDifixBoundFileSchema,
}).strict().superRefine((value, ctx) => {
  if (!uniqueSorted(value.artifactIds)) {
    ctx.addIssue({ code: "custom", path: ["artifactIds"], message: "artifact IDs must be unique and ordinal-sorted" });
  }
});
export type GrandHallDifixExperimentMaterialFile = z.infer<
  typeof GrandHallDifixExperimentMaterialFileSchema
>;

export const GrandHallDifixInventoryEntrySchema = z.object({
  relativePath: z.string().min(1).max(4_096).refine(
    (value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."),
    "inventory path must be a safe relative POSIX path",
  ),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  mode: z.number().int().nonnegative(),
  linkCount: z.number().int().positive(),
  sha256: Sha256Schema,
}).strict();

export const GrandHallDifixSymlinkEntrySchema = z.object({
  relativePath: z.string().min(1).max(4_096).refine(
    (value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."),
    "symlink inventory path must be a safe relative POSIX path",
  ),
  target: z.string().min(1).max(4_096),
  resolvedWslPath: AbsoluteWslPathSchema,
  resolvedType: z.literal("file"),
  resolvedSizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  resolvedSha256: Sha256Schema,
}).strict();

const DirectoryInventorySchema = z.object({
  hostRoot: AbsoluteHostPathSchema,
  wslRoot: AbsoluteWslPathSchema,
  totalFileBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  fileCount: z.number().int().nonnegative(),
  files: z.array(GrandHallDifixInventoryEntrySchema).max(1_000_000),
  symlinks: z.array(GrandHallDifixSymlinkEntrySchema).max(1_000_000),
  inventorySha256: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  const paths = value.files.map((entry) => entry.relativePath);
  const links = value.symlinks.map((entry) => entry.relativePath);
  if (!uniqueSorted(paths)) ctx.addIssue({ code: "custom", path: ["files"], message: "files must be unique and sorted" });
  if (!uniqueSorted(links)) ctx.addIssue({ code: "custom", path: ["symlinks"], message: "symlinks must be unique and sorted" });
  if (value.fileCount !== value.files.length) ctx.addIssue({ code: "custom", path: ["fileCount"], message: "fileCount must match files" });
  if (value.totalFileBytes !== value.files.reduce((sum, entry) => sum + entry.sizeBytes, 0)) {
    ctx.addIssue({ code: "custom", path: ["totalFileBytes"], message: "totalFileBytes must match files" });
  }
  if (value.inventorySha256 !== digest("VENVIEWER_GRAND_HALL_DIFIX_DIRECTORY_INVENTORY_V1", {
    files: value.files,
    symlinks: value.symlinks,
  })) {
    ctx.addIssue({ code: "custom", path: ["inventorySha256"], message: "directory inventory digest mismatch" });
  }
});

const InterpreterChainEntrySchema = z.object({
  wslPath: AbsoluteWslPathSchema,
  nodeType: z.enum(["file", "symlink"]),
  target: z.string().min(1).max(4_096).nullable(),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: Sha256Schema.nullable(),
}).strict();

const RuntimeSealPayloadObjectSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_RUNTIME_SEAL_SCHEMA),
  runtimeId: SafeIdSchema,
  createdAt: UtcInstantSchema,
  providerRepositoryId: z.literal(GRAND_HALL_DIFIX_PROVIDER_REPOSITORY_ID),
  providerRevision: z.literal(GRAND_HALL_DIFIX_PROVIDER_REVISION),
  venv: DirectoryInventorySchema,
  trustedVerifierInterpreterChain: z.array(InterpreterChainEntrySchema).min(1).max(32),
  externalInterpreterChain: z.array(InterpreterChainEntrySchema).min(1).max(32),
  providerSourceTree: DirectoryInventorySchema,
  sourceArchive: GrandHallDifixBoundFileSchema,
  wheelhouse: DirectoryInventorySchema,
  wheelHashInventory: GrandHallDifixBoundFileSchema,
  pipFreeze: GrandHallDifixBoundFileSchema,
  networkAcquisitionComplete: z.literal(true),
  sealedForOfflineExecution: z.literal(true),
}).strict();

function validateRuntimeSealPayload(
  value: z.infer<typeof RuntimeSealPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  for (const chainName of ["trustedVerifierInterpreterChain", "externalInterpreterChain"] as const) {
    const chain = value[chainName];
    const interpreterPaths = chain.map((entry) => entry.wslPath);
    if (new Set(interpreterPaths).size !== interpreterPaths.length) {
      ctx.addIssue({ code: "custom", path: [chainName], message: "interpreter chain paths must be unique" });
    }
    if (chain.at(-1)?.nodeType !== "file") {
      ctx.addIssue({ code: "custom", path: [chainName], message: "interpreter chain must terminate in a hashed regular file" });
    }
    for (const [index, entry] of chain.entries()) {
      const terminal = index === chain.length - 1;
      if (
        (terminal && (entry.nodeType !== "file" || entry.sha256 === null || entry.target !== null))
        || (!terminal && (entry.nodeType !== "symlink" || entry.sha256 !== null || entry.target === null))
      ) ctx.addIssue({ code: "custom", path: [chainName, index], message: "interpreter chain node types, targets, and hashes are inconsistent" });
    }
  }
  if (
    value.sourceArchive.sizeBytes !== 6_041_600
    || value.sourceArchive.sha256 !== "sha256:01b1cd73b67b2b8e6003860295f465b4a3a46f705032c599bfe02b33e6d66a80"
  ) ctx.addIssue({ code: "custom", path: ["sourceArchive"], message: "provider source archive must match the audited deterministic archive" });
  const pipeline = value.providerSourceTree.files.find((entry) => entry.relativePath === "src/pipeline_difix.py");
  if (
    pipeline === undefined
    || pipeline.sizeBytes !== 56_400
    || pipeline.sha256 !== "sha256:2f73e2708b3f9ce560800163554f869e5e43e3a42049f67da3609f7736cbab3a"
  ) ctx.addIssue({ code: "custom", path: ["providerSourceTree"], message: "runtime source tree must contain the exact pinned pipeline_difix.py" });
}

export const GrandHallDifixRuntimeSealSchema = RuntimeSealPayloadObjectSchema.extend({
  runtimeSealSha256: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  const { runtimeSealSha256: _digest, ...payload } = value;
  validateRuntimeSealPayload(RuntimeSealPayloadObjectSchema.parse(payload), ctx);
  if (value.runtimeSealSha256 !== digest("VENVIEWER_GRAND_HALL_DIFIX_RUNTIME_SEAL_V1", payload)) {
    ctx.addIssue({ code: "custom", path: ["runtimeSealSha256"], message: "runtime seal digest mismatch" });
  }
});
export type GrandHallDifixRuntimeSeal = z.infer<typeof GrandHallDifixRuntimeSealSchema>;

const ModelSealPayloadSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_MODEL_SEAL_SCHEMA),
  modelId: z.literal(GRAND_HALL_DIFIX_MODEL_ID),
  revision: z.literal(GRAND_HALL_DIFIX_MODEL_REVISION),
  createdAt: UtcInstantSchema,
  snapshot: DirectoryInventorySchema,
  localFilesOnly: z.literal(true),
  auditedSnapshotManifestSha256: z.literal("sha256:6d3d3d8155b03b3021deb1597eb70355dfff2281ba4e526920ec7b1c12f2aea9"),
  auditedSha256SumsSha256: z.literal("sha256:eeb786cee49b2e611b29a685411f92ab431eec98985ce93eb366ee1cd94e7298"),
  auditedAcquisitionReceiptSha256: z.literal("sha256:6f05ac17c461cb55568e05ea51983a943715a640903340377227ac3c615fdea4"),
  modelIndexSha256: z.literal("sha256:0b4316574ae102b3855c4508a13becc81b353f6455dafa6186ac37d82c8292b9"),
  expectedWeightFiles: z.tuple([
    z.object({
      relativePath: z.literal("text_encoder/model.safetensors"),
      sizeBytes: z.literal(1_361_596_304),
      sha256: z.literal("sha256:67e013543d4fac905c882e2993d86a2d454ee69dc9e8f37c0c23d33a48959d15"),
    }).strict(),
    z.object({
      relativePath: z.literal("unet/diffusion_pytorch_model.safetensors"),
      sizeBytes: z.literal(3_463_726_504),
      sha256: z.literal("sha256:3815819b0009d16b5f7538ecbf2dd0ac4a6b07a238ab82d869465c347864bb70"),
    }).strict(),
    z.object({
      relativePath: z.literal("vae/diffusion_pytorch_model.safetensors"),
      sizeBytes: z.literal(338_717_612),
      sha256: z.literal("sha256:20a5e872469d801876e448ec1d499b1e99cc666497a6aa133ed22c9e0a7a1a25"),
    }).strict(),
  ]),
  expectedLoadClosureFiles: z.array(z.object({
    relativePath: z.string().min(1).max(4_096),
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: Sha256Schema,
  }).strict()).length(GRAND_HALL_DIFIX_MODEL_LOAD_CLOSURE.length),
}).strict();

export const GrandHallDifixModelSealSchema = ModelSealPayloadSchema.extend({
  modelSealSha256: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  const { modelSealSha256: _digest, ...payload } = value;
  if (value.modelSealSha256 !== digest("VENVIEWER_GRAND_HALL_DIFIX_MODEL_SEAL_V1", payload)) {
    ctx.addIssue({ code: "custom", path: ["modelSealSha256"], message: "model seal digest mismatch" });
  }
  const expected = value.expectedWeightFiles.map((entry) => entry.relativePath);
  if (!uniqueSorted(expected)) ctx.addIssue({ code: "custom", path: ["expectedWeightFiles"], message: "expected weight files must be unique and sorted" });
  if (!canonicalEqual(value.expectedLoadClosureFiles, GRAND_HALL_DIFIX_MODEL_LOAD_CLOSURE)) {
    ctx.addIssue({ code: "custom", path: ["expectedLoadClosureFiles"], message: "model load closure must match every exact audited runtime input" });
  }
  for (const expectedWeight of value.expectedWeightFiles) {
    const inventoryEntry = value.snapshot.files.find((entry) => entry.relativePath === expectedWeight.relativePath);
    if (
      inventoryEntry === undefined
      || inventoryEntry.sizeBytes !== expectedWeight.sizeBytes
      || inventoryEntry.sha256 !== expectedWeight.sha256
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedWeightFiles"],
        message: `expected weight ${expectedWeight.relativePath} must exactly match the sealed snapshot inventory`,
      });
    }
  }
  for (const [relativePath, expectedSha256] of [
    ["SNAPSHOT-MANIFEST.json", value.auditedSnapshotManifestSha256],
    ["SHA256SUMS", value.auditedSha256SumsSha256],
    ["model_index.json", value.modelIndexSha256],
  ] as const) {
    if (value.snapshot.files.find((entry) => entry.relativePath === relativePath)?.sha256 !== expectedSha256) {
      ctx.addIssue({ code: "custom", path: ["snapshot"], message: `${relativePath} must match the independently audited snapshot evidence` });
    }
  }
  for (const expectedFile of value.expectedLoadClosureFiles) {
    const inventoryEntry = value.snapshot.files.find((entry) => entry.relativePath === expectedFile.relativePath);
    if (
      inventoryEntry === undefined
      || inventoryEntry.sizeBytes !== expectedFile.sizeBytes
      || inventoryEntry.sha256 !== expectedFile.sha256
      || inventoryEntry.linkCount !== 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["snapshot"],
        message: `${expectedFile.relativePath} must be a direct single-link exact load-closure file`,
      });
    }
  }
});
export type GrandHallDifixModelSeal = z.infer<typeof GrandHallDifixModelSealSchema>;

export const GRAND_HALL_DIFIX_EXACT_CONFIGURATION = Object.freeze({
  prompt: "remove degradation",
  referenceImage: null,
  torchDtype: "float32",
  width: GRAND_HALL_DIFIX_INPUT_WIDTH,
  height: GRAND_HALL_DIFIX_INPUT_HEIGHT,
  numInferenceSteps: 1,
  timesteps: Object.freeze([199]),
  guidanceScale: 0,
  negativePrompt: null,
  numImagesPerPrompt: 1,
  eta: 0,
  generatorDevice: "cuda",
  seed: 42,
  outputType: "pil",
  returnDict: true,
  guidanceRescale: 0,
  clipSkip: null,
  imageProcessor: Object.freeze({
    doResize: false,
    doConvertRgb: false,
    doNormalize: true,
  }),
  disabledOptimizations: Object.freeze([
    "autocast",
    "compile",
    "cpu_offload",
    "tf32",
    "vae_tiling",
    "xformers",
  ]),
  deterministicAlgorithms: true,
  cudnnBenchmark: false,
  cudnnDeterministic: true,
  localFilesOnly: true,
} as const);

const ExactConfigurationSchema = z.object({
  prompt: z.literal("remove degradation"),
  referenceImage: z.null(),
  torchDtype: z.literal("float32"),
  width: z.literal(GRAND_HALL_DIFIX_INPUT_WIDTH),
  height: z.literal(GRAND_HALL_DIFIX_INPUT_HEIGHT),
  numInferenceSteps: z.literal(1),
  timesteps: z.tuple([z.literal(199)]),
  guidanceScale: z.literal(0),
  negativePrompt: z.null(),
  numImagesPerPrompt: z.literal(1),
  eta: z.literal(0),
  generatorDevice: z.literal("cuda"),
  seed: z.literal(42),
  outputType: z.literal("pil"),
  returnDict: z.literal(true),
  guidanceRescale: z.literal(0),
  clipSkip: z.null(),
  imageProcessor: z.object({
    doResize: z.literal(false),
    doConvertRgb: z.literal(false),
    doNormalize: z.literal(true),
  }).strict(),
  disabledOptimizations: z.tuple([
    z.literal("autocast"),
    z.literal("compile"),
    z.literal("cpu_offload"),
    z.literal("tf32"),
    z.literal("vae_tiling"),
    z.literal("xformers"),
  ]),
  deterministicAlgorithms: z.literal(true),
  cudnnBenchmark: z.literal(false),
  cudnnDeterministic: z.literal(true),
  localFilesOnly: z.literal(true),
}).strict();

const GrandHallDifixWeightBindingSchema = z.object({
  relativePath: SafeRelativePosixPathSchema,
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: Sha256Schema,
}).strict();

const GrandHallDifixExperimentBindingsSchema = z.object({
  provider: z.object({
    repositorySourceArchiveSha256: Sha256Schema,
    modelRepositoryManifestSha256: Sha256Schema,
    modelWeights: z.array(GrandHallDifixWeightBindingSchema).min(1).max(10_000),
  }).strict(),
  plannedExecution: z.object({
    providerAdapterId: z.literal(GRAND_HALL_DIFIX_ADAPTER_ID),
    providerAdapterImplementationSha256: Sha256Schema,
    parameterConfigurationArtifactSha256: Sha256Schema,
    runtimeEnvironmentArtifactSha256: Sha256Schema,
  }).strict(),
  inputPack: z.object({
    bundleMaterialSha256: Sha256Schema,
    sourceRenderSha256: Sha256Schema,
    browserCaptureRecordSha256: Sha256Schema,
    cameraArtifactSha256: Sha256Schema,
    rendererArtifactSha256: Sha256Schema,
    reconstructionArtifactSha256: Sha256Schema,
    reconstructionMemberClosureSha256: Sha256Schema,
    renderGenerationReceiptSha256: Sha256Schema,
    protectedMaskSha256: Sha256Schema,
    generatedRegionMaskSha256: Sha256Schema,
  }).strict(),
  fixedCamera: z.object({
    cameraSha256: Sha256Schema,
    protectedMaskAnalysisReceiptSha256: Sha256Schema,
    generatedMaskAnalysisReceiptSha256: Sha256Schema,
  }).strict(),
  localExperimentMaterialSetSha256: Sha256Schema,
}).strict();
export type GrandHallDifixExperimentBindings = z.infer<
  typeof GrandHallDifixExperimentBindingsSchema
>;

export function assertGrandHallDifixExperimentBindingProjectionMatches(
  compiledBindingInput: unknown,
  observedBindingInput: unknown,
): void {
  const compiledBinding = GrandHallDifixExperimentBindingsSchema.parse(compiledBindingInput);
  const observedBinding = GrandHallDifixExperimentBindingsSchema.parse(observedBindingInput);
  if (!canonicalEqual(compiledBinding, observedBinding)) {
    throw new Error("Observed experiment-to-material cross-bindings must exactly equal the compiled binding projection.");
  }
}

const ExecutionPathsSchema = z.object({
  executionLockHost: AbsoluteHostPathSchema,
  executionLockWsl: AbsoluteWslPathSchema,
  experiment: GrandHallDifixBoundFileSchema,
  experimentMaterials: z.array(GrandHallDifixExperimentMaterialFileSchema).max(1_024),
  inputPackDirectoryHost: AbsoluteHostPathSchema,
  inputPackDirectoryWsl: AbsoluteWslPathSchema,
  inputPackManifest: GrandHallDifixBoundFileSchema,
  inputPackPublicationReceipt: GrandHallDifixBoundFileSchema,
  sourceImage: GrandHallDifixBoundFileSchema,
  browserCaptureRecord: GrandHallDifixBoundFileSchema,
  cameraArtifact: GrandHallDifixBoundFileSchema,
  rendererArtifact: GrandHallDifixBoundFileSchema,
  reconstructionArtifact: GrandHallDifixBoundFileSchema,
  renderGenerationReceipt: GrandHallDifixBoundFileSchema,
  protectedMask: GrandHallDifixBoundFileSchema,
  generatedRegionMask: GrandHallDifixBoundFileSchema,
  runtimeSeal: GrandHallDifixBoundFileSchema,
  modelSeal: GrandHallDifixBoundFileSchema,
  adapter: GrandHallDifixBoundFileSchema,
  runtimeSealTool: GrandHallDifixBoundFileSchema,
  trustedVerifierPythonWsl: z.literal("/usr/bin/python3"),
  venvPythonWsl: AbsoluteWslPathSchema,
  providerSourceRootWsl: AbsoluteWslPathSchema,
  modelSnapshotRootWsl: AbsoluteWslPathSchema,
  controlDirectoryHost: AbsoluteHostPathSchema,
  controlDirectoryWsl: AbsoluteWslPathSchema,
  claimHost: AbsoluteHostPathSchema,
  claimWsl: AbsoluteWslPathSchema,
  attemptDirectoryHost: AbsoluteHostPathSchema,
  attemptDirectoryWsl: AbsoluteWslPathSchema,
  hfModulesCacheHost: AbsoluteHostPathSchema,
  hfModulesCacheWsl: AbsoluteWslPathSchema,
  torchHomeHost: AbsoluteHostPathSchema,
  torchHomeWsl: AbsoluteWslPathSchema,
  modelExecutionSnapshotHost: AbsoluteHostPathSchema,
  modelExecutionSnapshotWsl: AbsoluteWslPathSchema,
  sourceImageWsl: AbsoluteWslPathSchema,
  outputImageHost: AbsoluteHostPathSchema,
  outputImageWsl: AbsoluteWslPathSchema,
  adapterReceiptHost: AbsoluteHostPathSchema,
  adapterReceiptWsl: AbsoluteWslPathSchema,
  stdoutHost: AbsoluteHostPathSchema,
  stdoutWsl: AbsoluteWslPathSchema,
  stderrHost: AbsoluteHostPathSchema,
  stderrWsl: AbsoluteWslPathSchema,
  startedReceiptHost: AbsoluteHostPathSchema,
  startedReceiptWsl: AbsoluteWslPathSchema,
  terminalReceiptHost: AbsoluteHostPathSchema,
  terminalReceiptWsl: AbsoluteWslPathSchema,
}).strict().superRefine((value, ctx) => {
  if (!uniqueSorted(value.experimentMaterials.map((material) => material.relativePath))) {
    ctx.addIssue({ code: "custom", path: ["experimentMaterials"], message: "experiment materials must be unique and ordinal-sorted by relative path" });
  }
  const experimentHostParent = normalizedPortableHost(portableParent(value.experiment.hostPath));
  const experimentWslParent = portableParent(value.experiment.wslPath);
  for (const [index, material] of value.experimentMaterials.entries()) {
    if (
      normalizedPortableHost(material.file.hostPath) !== `${experimentHostParent}/${material.relativePath.toLowerCase()}`
      || material.file.wslPath !== `${experimentWslParent}/${material.relativePath}`
    ) {
      ctx.addIssue({ code: "custom", path: ["experimentMaterials", index], message: "experiment material must be the exact direct sibling of the immutable experiment" });
    }
  }
  if (value.sourceImageWsl !== value.sourceImage.wslPath) {
    ctx.addIssue({ code: "custom", path: ["sourceImageWsl"], message: "sourceImageWsl must equal the exact bound source-image WSL path" });
  }
  for (const [hostKey, wslKey] of [
    ["executionLockHost", "executionLockWsl"],
    ["claimHost", "claimWsl"],
    ["startedReceiptHost", "startedReceiptWsl"],
    ["terminalReceiptHost", "terminalReceiptWsl"],
  ] as const) {
    if (
      !isDirectPortableChild(value.controlDirectoryHost, value[hostKey])
      || !isDirectPortableChild(value.controlDirectoryWsl, value[wslKey])
    ) ctx.addIssue({ code: "custom", path: [hostKey], message: "control artifact must be a direct control-directory child" });
  }
  for (const [hostKey, wslKey] of [
    ["hfModulesCacheHost", "hfModulesCacheWsl"],
    ["torchHomeHost", "torchHomeWsl"],
    ["modelExecutionSnapshotHost", "modelExecutionSnapshotWsl"],
    ["outputImageHost", "outputImageWsl"],
    ["adapterReceiptHost", "adapterReceiptWsl"],
    ["stdoutHost", "stdoutWsl"],
    ["stderrHost", "stderrWsl"],
  ] as const) {
    if (
      !isDirectPortableChild(value.attemptDirectoryHost, value[hostKey])
      || !isDirectPortableChild(value.attemptDirectoryWsl, value[wslKey])
    ) ctx.addIssue({ code: "custom", path: [hostKey], message: "attempt artifact must be a direct attempt-directory child" });
  }
  const hostOutputs = [
    value.executionLockHost,
    value.claimHost,
    value.startedReceiptHost,
    value.terminalReceiptHost,
    value.hfModulesCacheHost,
    value.torchHomeHost,
    value.modelExecutionSnapshotHost,
    value.outputImageHost,
    value.adapterReceiptHost,
    value.stdoutHost,
    value.stderrHost,
  ].map((path) => path.toLowerCase());
  if (new Set(hostOutputs).size !== hostOutputs.length) {
    ctx.addIssue({ code: "custom", path: ["controlDirectoryHost"], message: "all create-only output paths must be distinct" });
  }
});

const ExecutionLockPayloadSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_EXECUTION_LOCK_SCHEMA),
  lockId: SafeIdSchema,
  compiledAt: UtcInstantSchema,
  gitCommit: GitShaSchema,
  experimentSha256: Sha256Schema,
  plannedExecutionLockSha256: Sha256Schema,
  providerAdapterId: z.literal(GRAND_HALL_DIFIX_ADAPTER_ID),
  configuration: ExactConfigurationSchema,
  configurationSha256: Sha256Schema,
  experimentBindings: GrandHallDifixExperimentBindingsSchema,
  runtimeSealSha256: Sha256Schema,
  modelSealSha256: Sha256Schema,
  inputPackManifestSha256: Sha256Schema,
  inputPackPublicationReceiptSha256: Sha256Schema,
  inputPackBundleMaterialSha256: Sha256Schema,
  sourceImageSha256: Sha256Schema,
  adapterSha256: Sha256Schema,
  runtimeSealToolSha256: Sha256Schema,
  paths: ExecutionPathsSchema,
  launch: z.object({
    wslDistribution: z.string().min(1).max(128),
    namespaceArgvPrefix: z.tuple([
      z.literal("unshare"),
      z.literal("--user"),
      z.literal("--map-root-user"),
      z.literal("--net"),
    ]),
    offlineEnvironment: z.object({
      HF_HUB_OFFLINE: z.literal("1"),
      TRANSFORMERS_OFFLINE: z.literal("1"),
      DIFFUSERS_OFFLINE: z.literal("1"),
      HF_DATASETS_OFFLINE: z.literal("1"),
      HF_HUB_DISABLE_IMPLICIT_TOKEN: z.literal("1"),
      HF_HUB_DISABLE_TELEMETRY: z.literal("1"),
      PIP_NO_INDEX: z.literal("1"),
      WANDB_MODE: z.literal("disabled"),
      TOKENIZERS_PARALLELISM: z.literal("false"),
      CUDA_MODULE_LOADING: z.literal("EAGER"),
      CUBLAS_WORKSPACE_CONFIG: z.literal(":4096:8"),
    }).strict(),
  }).strict(),
  policies: z.object({
    network: z.literal("os_namespace_unreachable"),
    externalCost: z.literal("zero"),
    sourceAccess: z.literal("read_only"),
    output: z.literal("create_only_no_overwrite"),
    retries: z.literal(0),
    retryOnOutOfMemory: z.literal(false),
    secretsAllowed: z.literal(false),
    capturedAuthority: z.literal("none"),
    structuralAuthority: z.literal("none"),
    runtimeAuthority: z.literal("none"),
    resultClass: z.literal("generated_cinematic_diagnostic"),
  }).strict(),
}).strict();

export const GrandHallDifixExecutionLockSchema = ExecutionLockPayloadSchema.extend({
  executionLockSha256: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  const { executionLockSha256: _digest, ...payload } = value;
  if (value.executionLockSha256 !== digest(EXECUTION_LOCK_DIGEST_DOMAIN, payload)) {
    ctx.addIssue({ code: "custom", path: ["executionLockSha256"], message: "execution lock digest mismatch" });
  }
  if (value.configurationSha256 !== digest("VENVIEWER_GRAND_HALL_DIFIX_CONFIGURATION_V1", value.configuration)) {
    ctx.addIssue({ code: "custom", path: ["configurationSha256"], message: "configuration digest mismatch" });
  }
  if (
    value.experimentBindings.plannedExecution.parameterConfigurationArtifactSha256
    !== rawSha256(canonicalJsonFileBytes(value.configuration))
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["experimentBindings", "plannedExecution", "parameterConfigurationArtifactSha256"],
      message: "parameter configuration artifact must contain the exact canonical one-shot configuration bytes",
    });
  }
  if (
    value.experimentBindings.plannedExecution.providerAdapterImplementationSha256 !== value.adapterSha256
    || value.experimentBindings.inputPack.bundleMaterialSha256 !== value.inputPackBundleMaterialSha256
    || value.experimentBindings.inputPack.sourceRenderSha256 !== value.sourceImageSha256
  ) {
    ctx.addIssue({ code: "custom", path: ["experimentBindings"], message: "experiment bindings must agree with the one-shot lock" });
  }
  if (
    value.experimentBindings.inputPack.browserCaptureRecordSha256 !== value.paths.browserCaptureRecord.sha256
    || value.experimentBindings.inputPack.cameraArtifactSha256 !== value.paths.cameraArtifact.sha256
    || value.experimentBindings.inputPack.rendererArtifactSha256 !== value.paths.rendererArtifact.sha256
    || value.experimentBindings.inputPack.reconstructionArtifactSha256 !== value.paths.reconstructionArtifact.sha256
    || value.experimentBindings.inputPack.renderGenerationReceiptSha256 !== value.paths.renderGenerationReceipt.sha256
    || value.experimentBindings.inputPack.protectedMaskSha256 !== value.paths.protectedMask.sha256
    || value.experimentBindings.inputPack.generatedRegionMaskSha256 !== value.paths.generatedRegionMask.sha256
  ) {
    ctx.addIssue({ code: "custom", path: ["experimentBindings", "inputPack"], message: "input-pack experiment bindings must equal every exact bound file" });
  }
  if (
    value.experimentBindings.localExperimentMaterialSetSha256
    !== localExperimentMaterialSetSha256(value.paths.experimentMaterials)
  ) {
    ctx.addIssue({ code: "custom", path: ["experimentBindings", "localExperimentMaterialSetSha256"], message: "local experiment-material set digest mismatch" });
  }
  for (const [field, actual, bound] of [
    ["inputPackManifestSha256", value.inputPackManifestSha256, value.paths.inputPackManifest.sha256],
    ["inputPackPublicationReceiptSha256", value.inputPackPublicationReceiptSha256, value.paths.inputPackPublicationReceipt.sha256],
    ["sourceImageSha256", value.sourceImageSha256, value.paths.sourceImage.sha256],
    ["adapterSha256", value.adapterSha256, value.paths.adapter.sha256],
    ["runtimeSealToolSha256", value.runtimeSealToolSha256, value.paths.runtimeSealTool.sha256],
  ] as const) {
    if (actual !== bound) {
      ctx.addIssue({ code: "custom", path: [field], message: `${field} must equal its exact bound-file digest` });
    }
  }
});
export type GrandHallDifixExecutionLock = z.infer<typeof GrandHallDifixExecutionLockSchema>;

const AuthorizationPayloadObjectSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_AUTHORIZATION_SCHEMA),
  authorizationId: SafeIdSchema,
  executionLockSha256: Sha256Schema,
  experimentSha256: Sha256Schema,
  plannedExecutionLockSha256: Sha256Schema,
  authorizationBasis: z.object({
    kind: z.literal("active_user_goal_objective_artifact"),
    objectiveArtifact: GrandHallDifixBoundFileSchema,
    objectiveArtifactStatementSha256: Sha256Schema,
  }).strict(),
  actor: z.object({
    id: SafeIdSchema,
    role: z.literal("goal_owner_authorized_operator"),
  }).strict(),
  issuedAt: UtcInstantSchema,
  expiresAt: UtcInstantSchema,
  nonce: NonceSchema,
  grant: z.literal("one_local_difix_no_reference_diagnostic_attempt"),
  maximumAttempts: z.literal(1),
  externalCostLimitUsd: z.literal(0),
  exactBindings: z.object({
    adapterSha256: Sha256Schema,
    configurationSha256: Sha256Schema,
    runtimeSealSha256: Sha256Schema,
    modelSealSha256: Sha256Schema,
    inputPackManifestSha256: Sha256Schema,
    inputPackPublicationReceiptSha256: Sha256Schema,
    sourceImageSha256: Sha256Schema,
  }).strict(),
  exactCreateOnlyPaths: z.object({
    claimHost: AbsoluteHostPathSchema,
    attemptDirectoryHost: AbsoluteHostPathSchema,
    hfModulesCacheHost: AbsoluteHostPathSchema,
    torchHomeHost: AbsoluteHostPathSchema,
    modelExecutionSnapshotHost: AbsoluteHostPathSchema,
    outputImageHost: AbsoluteHostPathSchema,
    adapterReceiptHost: AbsoluteHostPathSchema,
    stdoutHost: AbsoluteHostPathSchema,
    stderrHost: AbsoluteHostPathSchema,
    startedReceiptHost: AbsoluteHostPathSchema,
    terminalReceiptHost: AbsoluteHostPathSchema,
  }).strict(),
  policies: z.object({
    baseExperimentRemainsNotAuthorizedAndImmutable: z.literal(true),
    overlayDoesNotMutateExperiment: z.literal(true),
    claimConsumesAuthorizationEvenOnFailure: z.literal(true),
    network: z.literal("os_namespace_unreachable"),
    sourceAccess: z.literal("read_only"),
    output: z.literal("create_only_no_overwrite"),
    retries: z.literal(0),
    retryOnOutOfMemory: z.literal(false),
    secretsAllowed: z.literal(false),
    capturedAuthority: z.literal("none"),
    structuralAuthority: z.literal("none"),
    runtimeAuthority: z.literal("none"),
    resultClass: z.literal("generated_cinematic_diagnostic"),
  }).strict(),
}).strict();

function validateAuthorizationPayload(
  value: z.infer<typeof AuthorizationPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  if (Date.parse(value.issuedAt) >= Date.parse(value.expiresAt)) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "authorization must expire after issuance" });
  }
  if (Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 30 * 60 * 1_000) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "authorization lifetime must not exceed 30 minutes" });
  }
  if (value.authorizationBasis.objectiveArtifactStatementSha256 !== value.authorizationBasis.objectiveArtifact.sha256) {
    ctx.addIssue({ code: "custom", path: ["authorizationBasis", "objectiveArtifactStatementSha256"], message: "objective statement digest must equal the exact objective artifact byte digest" });
  }
  if (!portableBasename(value.exactCreateOnlyPaths.claimHost).toLowerCase().includes(value.nonce)) {
    ctx.addIssue({ code: "custom", path: ["exactCreateOnlyPaths", "claimHost"], message: "claim filename must include the full authorization nonce" });
  }
}

const AuthorizationPayloadSchema = AuthorizationPayloadObjectSchema.superRefine(
  validateAuthorizationPayload,
);

export const GrandHallDifixExecutionAuthorizationSchema = AuthorizationPayloadObjectSchema.extend({
  authorizationSha256: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  const { authorizationSha256: _digest, ...payload } = value;
  validateAuthorizationPayload(AuthorizationPayloadObjectSchema.parse(payload), ctx);
  if (value.authorizationSha256 !== digest(AUTHORIZATION_DIGEST_DOMAIN, payload)) {
    ctx.addIssue({ code: "custom", path: ["authorizationSha256"], message: "authorization digest mismatch" });
  }
});
export type GrandHallDifixExecutionAuthorization = z.infer<typeof GrandHallDifixExecutionAuthorizationSchema>;

const ClaimPayloadSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_CLAIM_SCHEMA),
  authorizationSha256: Sha256Schema,
  executionLockSha256: Sha256Schema,
  nonce: NonceSchema,
  claimedAt: UtcInstantSchema,
  attemptOrdinal: z.literal(1),
  authorizationConsumed: z.literal(true),
  consumedEvenOnFailure: z.literal(true),
}).strict();
export const GrandHallDifixAuthorizationClaimSchema = ClaimPayloadSchema.extend({
  claimSha256: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  const { claimSha256: _digest, ...payload } = value;
  if (value.claimSha256 !== digest(CLAIM_DIGEST_DOMAIN, payload)) {
    ctx.addIssue({ code: "custom", path: ["claimSha256"], message: "claim digest mismatch" });
  }
});
export type GrandHallDifixAuthorizationClaim = z.infer<typeof GrandHallDifixAuthorizationClaimSchema>;

const AttemptReceiptPayloadObjectSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_DIFIX_ATTEMPT_RECEIPT_SCHEMA),
  phase: z.enum(["started", "succeeded", "failed", "out_of_memory"]),
  authorizationSha256: Sha256Schema,
  executionLockSha256: Sha256Schema,
  claimSha256: Sha256Schema,
  startedAt: UtcInstantSchema,
  completedAt: UtcInstantSchema.nullable(),
  exitCode: z.number().int().nullable(),
  noRetryPermitted: z.literal(true),
  beforeMaterialSetSha256: Sha256Schema,
  afterMaterialSetSha256: Sha256Schema.nullable(),
  stdout: GrandHallDifixBoundFileSchema.nullable(),
  stderr: GrandHallDifixBoundFileSchema.nullable(),
  outputImage: GrandHallDifixBoundFileSchema.nullable(),
  adapterReceipt: GrandHallDifixBoundFileSchema.nullable(),
  actualExecution: z.object({
    schedulerClass: z.string().min(1).max(500),
    schedulerConfigSha256: Sha256Schema,
    timesteps: z.tuple([z.literal(199)]),
    torchDtype: z.literal("float32"),
    packages: z.record(z.string().min(1).max(200)),
    gpuName: z.string().min(1).max(500),
    cudaRuntime: z.string().min(1).max(100),
    driverVersion: z.string().min(1).max(100),
    peakCudaAllocatedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    peakCudaReservedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    peakRssBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    networkConnectErrnoBeforeLoad: z.literal(101),
    networkConnectErrnoAfterLoad: z.literal(101),
    pythonIsolated: z.literal(true),
    bytecodeWritesDisabled: z.literal(true),
    hfModulesCacheWsl: AbsoluteWslPathSchema,
    torchHomeWsl: AbsoluteWslPathSchema,
    modelExecutionSnapshotWsl: AbsoluteWslPathSchema,
  }).strict().nullable(),
  failure: z.object({
    code: z.enum(["process_failed", "cuda_out_of_memory", "postflight_integrity_failed"]),
    message: z.string().min(1).max(2_000),
  }).strict().nullable(),
  authority: z.object({
    captured: z.literal("none"),
    structural: z.literal("none"),
    runtime: z.literal("none"),
    resultClass: z.literal("generated_cinematic_diagnostic"),
  }).strict(),
}).strict();

function validateAttemptReceiptPayload(
  value: z.infer<typeof AttemptReceiptPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const terminal = value.phase !== "started";
  if (terminal !== (value.completedAt !== null)) ctx.addIssue({ code: "custom", path: ["completedAt"], message: "terminal receipts require completedAt" });
  if (value.completedAt !== null && Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({ code: "custom", path: ["completedAt"], message: "receipt completion cannot precede attempt start" });
  }
  if (
    value.phase === "started"
    && (
      value.exitCode !== null
      || value.afterMaterialSetSha256 !== null
      || value.stdout !== null
      || value.stderr !== null
      || value.outputImage !== null
      || value.adapterReceipt !== null
      || value.actualExecution !== null
      || value.failure !== null
    )
  ) ctx.addIssue({ code: "custom", path: ["phase"], message: "started receipt cannot contain terminal artifacts" });
  if (
    value.phase === "succeeded"
    && (
      value.exitCode !== 0
      || value.outputImage === null
      || value.adapterReceipt === null
      || value.stdout === null
      || value.stderr === null
      || value.actualExecution === null
      || value.failure !== null
      || value.afterMaterialSetSha256 !== value.beforeMaterialSetSha256
    )
  ) {
    ctx.addIssue({ code: "custom", path: ["phase"], message: "successful receipt is incomplete" });
  }
  if ((value.phase === "failed" || value.phase === "out_of_memory") && value.failure === null) {
    ctx.addIssue({ code: "custom", path: ["failure"], message: "failure receipt requires failure detail" });
  }
  if (
    value.phase === "out_of_memory"
    && (value.exitCode !== 86 || value.failure?.code !== "cuda_out_of_memory" || value.outputImage !== null)
  ) ctx.addIssue({ code: "custom", path: ["phase"], message: "out-of-memory receipt is inconsistent" });
  if (value.phase === "failed" && value.failure?.code === "cuda_out_of_memory") {
    ctx.addIssue({ code: "custom", path: ["failure"], message: "CUDA OOM must use the out_of_memory phase" });
  }
}

const AttemptReceiptPayloadSchema = AttemptReceiptPayloadObjectSchema.superRefine(
  validateAttemptReceiptPayload,
);

export const GrandHallDifixAttemptReceiptSchema = AttemptReceiptPayloadObjectSchema.extend({
  attemptReceiptSha256: Sha256Schema,
}).strict().superRefine((value, ctx) => {
  const { attemptReceiptSha256: _digest, ...payload } = value;
  validateAttemptReceiptPayload(AttemptReceiptPayloadObjectSchema.parse(payload), ctx);
  if (value.attemptReceiptSha256 !== digest(ATTEMPT_RECEIPT_DIGEST_DOMAIN, payload)) {
    ctx.addIssue({ code: "custom", path: ["attemptReceiptSha256"], message: "attempt receipt digest mismatch" });
  }
});
export type GrandHallDifixAttemptReceipt = z.infer<typeof GrandHallDifixAttemptReceiptSchema>;

interface GrandHallDifixDigestAddressedArtifact {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly canonicalization: "byte_exact" | "rfc8785_json";
  readonly immutable: true;
  readonly accessMode: "read_only";
  readonly authority: "none";
}

export interface GrandHallDifixVerifiedInputPackEvidence {
  readonly manifest: GrandHallDifixInputPackManifest;
  readonly artifacts: {
    readonly camera: GrandHallDifixCameraArtifact;
    readonly renderer: GrandHallDifixRendererArtifact;
    readonly reconstruction: GrandHallDifixReconstructionArtifact;
    readonly renderGeneration: GrandHallDifixRenderGenerationReceipt;
  };
}

export interface GrandHallDifixExperimentMaterialExpectation {
  readonly artifactIds: readonly string[];
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

function expectedViewMatrixColumnMajor(
  camera: GrandHallDifixCameraArtifact["fixedCamera"],
): readonly number[] {
  const [x, y, z, w] = camera.quaternion;
  const [px, py, pz] = camera.position;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const world00 = 1 - (yy + zz);
  const world01 = xy - wz;
  const world02 = xz + wy;
  const world10 = xy + wz;
  const world11 = 1 - (xx + zz);
  const world12 = yz - wx;
  const world20 = xz - wy;
  const world21 = yz + wx;
  const world22 = 1 - (xx + yy);
  return [
    world00, world01, world02, 0,
    world10, world11, world12, 0,
    world20, world21, world22, 0,
    -(world00 * px + world10 * py + world20 * pz),
    -(world01 * px + world11 * py + world21 * pz),
    -(world02 * px + world12 * py + world22 * pz),
    1,
  ];
}

export function grandHallDifixExpectedViewMatrixColumnMajor(
  camera: GrandHallDifixCameraArtifact["fixedCamera"],
): readonly number[] {
  return expectedViewMatrixColumnMajor(camera);
}

function requireArtifactMatchesBoundFile(
  label: string,
  artifact: GrandHallDifixDigestAddressedArtifact,
  bound: GrandHallDifixBoundFile,
  expectedRelativePath: string,
  expectedMediaType: string,
): void {
  if (
    artifact.relativePath !== expectedRelativePath
    || artifact.mediaType !== expectedMediaType
    || artifact.sizeBytes !== bound.sizeBytes
    || artifact.sha256 !== bound.sha256
  ) {
    throw new Error(`${label} must bind the exact selected material bytes and media identity.`);
  }
}

function requireCanonicalArtifactDocumentMatchesReceipt(
  label: string,
  document: unknown,
  receipt: { readonly sizeBytes: number; readonly sha256: string },
): void {
  const bytes = canonicalJsonFileBytes(document);
  if (bytes.byteLength !== receipt.sizeBytes || rawSha256(bytes) !== receipt.sha256) {
    throw new Error(`${label} document must be the exact canonical input-pack artifact bytes.`);
  }
}

function localExperimentMaterialArtifacts(
  experiment: FoundryRestorationExperimentV0,
): readonly GrandHallDifixDigestAddressedArtifact[] {
  const planned = experiment.plannedExecutionLock;
  const artifacts: GrandHallDifixDigestAddressedArtifact[] = [
    planned.providerAdapterImplementationArtifact,
    planned.parameterConfigurationArtifact,
    planned.runtimeEnvironmentArtifact,
  ];
  for (const closure of planned.fixedCameraClosures) {
    artifacts.push(
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
    );
  }
  return artifacts;
}

export function grandHallDifixExpectedLocalExperimentMaterials(
  experimentInput: FoundryRestorationExperimentV0,
): readonly GrandHallDifixExperimentMaterialExpectation[] {
  const experiment = FoundryRestorationExperimentV0Schema.parse(experimentInput);
  const byRelativePath = new Map<string, {
    readonly relativePath: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly artifactIds: Set<string>;
  }>();
  for (const artifact of localExperimentMaterialArtifacts(experiment)) {
    const existing = byRelativePath.get(artifact.relativePath);
    if (
      existing !== undefined
      && (existing.sizeBytes !== artifact.sizeBytes || existing.sha256 !== artifact.sha256)
    ) {
      throw new Error(`Local experiment material ${artifact.relativePath} has conflicting byte identities.`);
    }
    if (existing === undefined) {
      byRelativePath.set(artifact.relativePath, {
        relativePath: artifact.relativePath,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        artifactIds: new Set([artifact.artifactId]),
      });
    } else {
      existing.artifactIds.add(artifact.artifactId);
    }
  }
  return [...byRelativePath.values()].map((material) => ({
    ...material,
    artifactIds: [...material.artifactIds].sort(),
  })).sort((left, right) => (
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  ));
}

function assertLocalExperimentMaterials(
  experiment: FoundryRestorationExperimentV0,
  materialsInput: readonly GrandHallDifixExperimentMaterialFile[],
): readonly GrandHallDifixExperimentMaterialFile[] {
  const materials = materialsInput.map((material) => GrandHallDifixExperimentMaterialFileSchema.parse(material));
  const expectedArtifacts = localExperimentMaterialArtifacts(experiment);
  const expectedByPath = new Map<string, GrandHallDifixDigestAddressedArtifact[]>();
  for (const artifact of expectedArtifacts) {
    const existing = expectedByPath.get(artifact.relativePath) ?? [];
    const conflict = existing.find((candidate) => (
      candidate.sizeBytes !== artifact.sizeBytes || candidate.sha256 !== artifact.sha256
    ));
    if (conflict !== undefined) {
      throw new Error(`Local experiment material ${artifact.relativePath} has conflicting byte identities.`);
    }
    existing.push(artifact);
    expectedByPath.set(artifact.relativePath, existing);
  }
  if (!canonicalEqual(
    materials.map((material) => material.relativePath),
    [...expectedByPath.keys()].sort(),
  )) {
    throw new Error("Bound local experiment materials must exactly cover every planned material file.");
  }
  for (const material of materials) {
    const expected = expectedByPath.get(material.relativePath);
    if (expected === undefined) throw new Error("Unexpected local experiment material binding.");
    const expectedArtifactIds = [...new Set(expected.map((artifact) => artifact.artifactId))].sort();
    if (
      material.file.sizeBytes !== expected[0]?.sizeBytes
      || material.file.sha256 !== expected[0]?.sha256
      || !canonicalEqual(material.artifactIds, expectedArtifactIds)
    ) {
      throw new Error(`Local experiment material ${material.relativePath} disagrees with its exact planned bytes.`);
    }
  }
  return materials;
}

export interface AssertGrandHallDifixExperimentBindingsInput {
  readonly experiment: FoundryRestorationExperimentV0;
  readonly runtimeSeal: GrandHallDifixRuntimeSeal;
  readonly modelSeal: GrandHallDifixModelSeal;
  readonly inputPack: GrandHallDifixVerifiedInputPackEvidence;
  readonly paths: z.input<typeof ExecutionPathsSchema>;
}

export function assertGrandHallDifixExperimentMatchesMaterials(
  input: AssertGrandHallDifixExperimentBindingsInput,
): GrandHallDifixExperimentBindings {
  const experiment = FoundryRestorationExperimentV0Schema.parse(input.experiment);
  const runtimeSeal = GrandHallDifixRuntimeSealSchema.parse(input.runtimeSeal);
  const modelSeal = GrandHallDifixModelSealSchema.parse(input.modelSeal);
  const paths = ExecutionPathsSchema.parse(input.paths);
  const manifest = GrandHallDifixInputPackManifestSchema.parse(input.inputPack.manifest);
  const artifacts = {
    camera: GrandHallDifixCameraArtifactSchema.parse(input.inputPack.artifacts.camera),
    renderer: GrandHallDifixRendererArtifactSchema.parse(input.inputPack.artifacts.renderer),
    reconstruction: GrandHallDifixReconstructionArtifactSchema.parse(input.inputPack.artifacts.reconstruction),
    renderGeneration: GrandHallDifixRenderGenerationReceiptSchema.parse(input.inputPack.artifacts.renderGeneration),
  };
  requireCanonicalArtifactDocumentMatchesReceipt("Camera", artifacts.camera, manifest.cameraArtifact);
  requireCanonicalArtifactDocumentMatchesReceipt("Renderer", artifacts.renderer, manifest.rendererArtifact);
  requireCanonicalArtifactDocumentMatchesReceipt("Reconstruction", artifacts.reconstruction, manifest.reconstructionArtifact);
  requireCanonicalArtifactDocumentMatchesReceipt(
    "Render-generation receipt",
    artifacts.renderGeneration,
    manifest.renderGenerationReceipt,
  );
  const planned = experiment.plannedExecutionLock;
  if (planned.providerAdapterId !== GRAND_HALL_DIFIX_ADAPTER_ID) {
    throw new Error("The restoration experiment must select the exact bounded Difix adapter identity.");
  }
  requireArtifactMatchesBoundFile(
    "Provider adapter implementation",
    planned.providerAdapterImplementationArtifact,
    paths.adapter,
    planned.providerAdapterImplementationArtifact.relativePath,
    "text/x-python",
  );
  const configurationBytes = canonicalJsonFileBytes(GRAND_HALL_DIFIX_EXACT_CONFIGURATION);
  if (
    planned.parameterConfigurationArtifact.sha256 !== rawSha256(configurationBytes)
    || planned.parameterConfigurationArtifact.sizeBytes !== configurationBytes.byteLength
  ) {
    throw new Error("The restoration experiment parameter artifact must contain the exact one-shot configuration bytes.");
  }
  const runtimeEnvironment = GrandHallDifixRuntimeEnvironmentArtifactSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_RUNTIME_ENVIRONMENT_ARTIFACT_SCHEMA,
    authority: "none",
    runtimeSealArtifact: {
      sourcePath: paths.runtimeSeal.hostPath,
      sizeBytes: paths.runtimeSeal.sizeBytes,
      sha256: paths.runtimeSeal.sha256,
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
  const runtimeEnvironmentBytes = canonicalJsonFileBytes(runtimeEnvironment);
  if (
    planned.runtimeEnvironmentArtifact.sizeBytes !== runtimeEnvironmentBytes.byteLength
    || planned.runtimeEnvironmentArtifact.sha256 !== rawSha256(runtimeEnvironmentBytes)
  ) {
    throw new Error("The restoration experiment runtime artifact must bind the exact outer and inner runtime seal closure.");
  }
  const repository = experiment.providerLock.repositories.find((candidate) => candidate.role === "difix3d_source");
  if (repository?.sourceArchiveSha256 !== runtimeSeal.sourceArchive.sha256) {
    throw new Error("The restoration experiment provider source archive must match the exact runtime-sealed archive.");
  }
  const model = experiment.providerLock.models.find((candidate) => candidate.role === "difix_checkpoint");
  if (
    model === undefined
    || model.repositoryManifestSha256 !== modelSeal.auditedSnapshotManifestSha256
    || !canonicalEqual(model.weights, modelSeal.expectedWeightFiles)
  ) {
    throw new Error("The restoration experiment model manifest and weights must match the exact model seal.");
  }
  const sourceRender = experiment.inputs.find((candidate) => candidate.role === "source_fixed_camera_render");
  const sourceReconstruction = experiment.inputs.find((candidate) => candidate.role === "source_reconstruction");
  if (
    sourceRender === undefined
    || sourceRender.relativePath !== manifest.sourceRender.fileName
    || sourceRender.mediaType !== "image/png"
    || sourceRender.width !== GRAND_HALL_DIFIX_INPUT_WIDTH
    || sourceRender.height !== GRAND_HALL_DIFIX_INPUT_HEIGHT
    || sourceRender.sizeBytes !== manifest.sourceRender.sizeBytes
    || sourceRender.sha256 !== manifest.sourceRender.sha256
  ) {
    throw new Error("The restoration experiment source render must match the exact selected input-pack PNG.");
  }
  const expectedMembers = artifacts.reconstruction.sourceMembers.map((member) => ({ ...member }));
  const descriptorClosure = sourceReconstruction?.reconstructionDescriptorClosure ?? null;
  if (
    sourceReconstruction === undefined
    || sourceReconstruction.relativePath !== manifest.reconstructionArtifact.fileName
    || sourceReconstruction.mediaType !== FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_MEDIA_TYPE
    || sourceReconstruction.canonicalization !== "rfc8785_json"
    || sourceReconstruction.sizeBytes !== manifest.reconstructionArtifact.sizeBytes
    || sourceReconstruction.sha256 !== manifest.reconstructionArtifact.sha256
    || descriptorClosure === null
    || descriptorClosure.descriptorSchemaVersion !== artifacts.reconstruction.schemaVersion
    || descriptorClosure.descriptorSizeBytes !== manifest.reconstructionArtifact.sizeBytes
    || descriptorClosure.descriptorSha256 !== manifest.reconstructionArtifact.sha256
    || descriptorClosure.format !== artifacts.reconstruction.format
    || descriptorClosure.representationId !== artifacts.reconstruction.representationId
    || descriptorClosure.sourceVariant !== artifacts.reconstruction.sourceVariant
    || descriptorClosure.decodedElementCount !== artifacts.reconstruction.decodedSplatCount
    || descriptorClosure.memberCount !== expectedMembers.length
    || descriptorClosure.totalMemberBytes !== expectedMembers.reduce((sum, member) => sum + member.sizeBytes, 0)
    || !canonicalEqual(descriptorClosure.members, expectedMembers)
    || !canonicalEqual(expectedMembers, GRAND_HALL_DIFIX_EXPECTED_SOURCE_MEMBERS)
  ) {
    throw new Error("The restoration experiment reconstruction descriptor must match the exact SOG bundle member closure.");
  }
  const fixedCamera = experiment.fixedCameras[0];
  const cameraClosure = planned.fixedCameraClosures[0];
  if (
    experiment.fixedCameras.length !== 1
    || planned.fixedCameraClosures.length !== 1
    || fixedCamera === undefined
    || cameraClosure === undefined
    || fixedCamera.cameraId !== artifacts.camera.fixedCamera.id
    || fixedCamera.coordinateFrameId !== "three_world"
    || !canonicalEqual(fixedCamera.viewMatrixColumnMajor, expectedViewMatrixColumnMajor(artifacts.camera.fixedCamera))
    || !canonicalEqual(fixedCamera.projectionMatrixColumnMajor, artifacts.camera.fixedCamera.projectionMatrix)
    || fixedCamera.width !== GRAND_HALL_DIFIX_INPUT_WIDTH
    || fixedCamera.height !== GRAND_HALL_DIFIX_INPUT_HEIGHT
    || fixedCamera.rendererProfileSha256 !== manifest.rendererArtifact.sha256
  ) {
    throw new Error("The restoration experiment fixed camera must match the exact selected camera and renderer evidence.");
  }
  requireArtifactMatchesBoundFile(
    "Renderer profile",
    cameraClosure.renderDerivationReceipt.rendererProfileArtifact,
    paths.rendererArtifact,
    manifest.rendererArtifact.fileName,
    "application/json",
  );
  requireArtifactMatchesBoundFile(
    "Render-derivation source image",
    cameraClosure.renderDerivationReceipt.sourceRenderArtifact,
    paths.sourceImage,
    manifest.sourceRender.fileName,
    "image/png",
  );
  requireArtifactMatchesBoundFile(
    "Render-derivation reconstruction descriptor",
    cameraClosure.renderDerivationReceipt.sourceReconstructionArtifact,
    paths.reconstructionArtifact,
    manifest.reconstructionArtifact.fileName,
    FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_MEDIA_TYPE,
  );
  requireArtifactMatchesBoundFile(
    "Protected-region mask",
    cameraClosure.protectedRegionMask.artifact,
    paths.protectedMask,
    manifest.protectedMask.fileName,
    "image/png",
  );
  requireArtifactMatchesBoundFile(
    "Generated-region mask",
    cameraClosure.generatedRegionMask.artifact,
    paths.generatedRegionMask,
    manifest.generatedRegionMask.fileName,
    "image/png",
  );
  const localMaterials = assertLocalExperimentMaterials(experiment, paths.experimentMaterials);
  return GrandHallDifixExperimentBindingsSchema.parse({
    provider: {
      repositorySourceArchiveSha256: runtimeSeal.sourceArchive.sha256,
      modelRepositoryManifestSha256: modelSeal.auditedSnapshotManifestSha256,
      modelWeights: modelSeal.expectedWeightFiles,
    },
    plannedExecution: {
      providerAdapterId: planned.providerAdapterId,
      providerAdapterImplementationSha256: planned.providerAdapterImplementationArtifact.sha256,
      parameterConfigurationArtifactSha256: planned.parameterConfigurationArtifact.sha256,
      runtimeEnvironmentArtifactSha256: planned.runtimeEnvironmentArtifact.sha256,
    },
    inputPack: {
      bundleMaterialSha256: manifest.bundleMaterialSha256,
      sourceRenderSha256: manifest.sourceRender.sha256,
      browserCaptureRecordSha256: manifest.browserCaptureRecord.sha256,
      cameraArtifactSha256: manifest.cameraArtifact.sha256,
      rendererArtifactSha256: manifest.rendererArtifact.sha256,
      reconstructionArtifactSha256: manifest.reconstructionArtifact.sha256,
      reconstructionMemberClosureSha256: digest(
        "VENVIEWER_GRAND_HALL_DIFIX_RECONSTRUCTION_MEMBER_CLOSURE_V1",
        expectedMembers,
      ),
      renderGenerationReceiptSha256: manifest.renderGenerationReceipt.sha256,
      protectedMaskSha256: manifest.protectedMask.sha256,
      generatedRegionMaskSha256: manifest.generatedRegionMask.sha256,
    },
    fixedCamera: {
      cameraSha256: fixedCamera.cameraSha256,
      protectedMaskAnalysisReceiptSha256: cameraClosure.protectedRegionMask.analysis.maskAnalysisReceiptSha256,
      generatedMaskAnalysisReceiptSha256: cameraClosure.generatedRegionMask.analysis.maskAnalysisReceiptSha256,
    },
    localExperimentMaterialSetSha256: localExperimentMaterialSetSha256(localMaterials),
  });
}

export interface CompileGrandHallDifixExecutionLockInput {
  readonly lockId: string;
  readonly compiledAt: string;
  readonly gitCommit: string;
  readonly experiment: FoundryRestorationExperimentV0;
  readonly runtimeSeal: GrandHallDifixRuntimeSeal;
  readonly modelSeal: GrandHallDifixModelSeal;
  readonly inputPack: GrandHallDifixVerifiedInputPackEvidence;
  readonly inputPackManifestSha256: string;
  readonly inputPackPublicationReceiptSha256: string;
  readonly inputPackBundleMaterialSha256: string;
  readonly paths: z.input<typeof ExecutionPathsSchema>;
  readonly wslDistribution: string;
}

export function compileGrandHallDifixExecutionLock(
  input: CompileGrandHallDifixExecutionLockInput,
): GrandHallDifixExecutionLock {
  assertGrandHallDifixBaseExperimentNotAuthorized(input.experiment);
  const experiment = FoundryRestorationExperimentV0Schema.parse(input.experiment);
  const runtimeSeal = GrandHallDifixRuntimeSealSchema.parse(input.runtimeSeal);
  const modelSeal = GrandHallDifixModelSealSchema.parse(input.modelSeal);
  if (experiment.lane !== "difix3d_plus" || experiment.providerVariant !== "difix") {
    throw new Error("The one-shot lane requires the pinned no-reference Difix experiment.");
  }
  const configuration = ExactConfigurationSchema.parse(GRAND_HALL_DIFIX_EXACT_CONFIGURATION);
  const paths = ExecutionPathsSchema.parse(input.paths);
  if (
    input.inputPack.manifest.bundleMaterialSha256 !== input.inputPackBundleMaterialSha256
    || paths.sourceImage.sha256 !== input.inputPack.manifest.sourceRender.sha256
    || paths.browserCaptureRecord.sha256 !== input.inputPack.manifest.browserCaptureRecord.sha256
    || paths.cameraArtifact.sha256 !== input.inputPack.manifest.cameraArtifact.sha256
    || paths.rendererArtifact.sha256 !== input.inputPack.manifest.rendererArtifact.sha256
    || paths.reconstructionArtifact.sha256 !== input.inputPack.manifest.reconstructionArtifact.sha256
    || paths.renderGenerationReceipt.sha256 !== input.inputPack.manifest.renderGenerationReceipt.sha256
    || paths.protectedMask.sha256 !== input.inputPack.manifest.protectedMask.sha256
    || paths.generatedRegionMask.sha256 !== input.inputPack.manifest.generatedRegionMask.sha256
  ) {
    throw new Error("The one-shot paths must bind every exact selected input-pack material.");
  }
  const experimentBindings = assertGrandHallDifixExperimentMatchesMaterials({
    experiment,
    runtimeSeal,
    modelSeal,
    inputPack: input.inputPack,
    paths,
  });
  if (paths.providerSourceRootWsl !== runtimeSeal.providerSourceTree.wslRoot) {
    throw new Error("Provider source root must be the exact runtime-sealed source tree.");
  }
  if (paths.modelSnapshotRootWsl !== modelSeal.snapshot.wslRoot) {
    throw new Error("Model snapshot root must be the exact model-sealed snapshot tree.");
  }
  if (
    paths.venvPythonWsl !== `${runtimeSeal.venv.wslRoot}/bin/python`
    || runtimeSeal.externalInterpreterChain[0]?.wslPath !== paths.venvPythonWsl
  ) {
    throw new Error("Execution interpreter must be the exact runtime-sealed venv Python chain head.");
  }
  if (runtimeSeal.trustedVerifierInterpreterChain[0]?.wslPath !== paths.trustedVerifierPythonWsl) {
    throw new Error("Seal verifier must be the distinct exact trusted verifier chain head.");
  }
  if (paths.trustedVerifierPythonWsl === paths.venvPythonWsl) {
    throw new Error("Trusted seal verifier must be distinct from the target venv interpreter.");
  }
  const payload = ExecutionLockPayloadSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_EXECUTION_LOCK_SCHEMA,
    lockId: input.lockId,
    compiledAt: input.compiledAt,
    gitCommit: input.gitCommit,
    experimentSha256: experiment.experimentSha256,
    plannedExecutionLockSha256: experiment.plannedExecutionLock.plannedExecutionLockSha256,
    providerAdapterId: GRAND_HALL_DIFIX_ADAPTER_ID,
    configuration,
    configurationSha256: digest("VENVIEWER_GRAND_HALL_DIFIX_CONFIGURATION_V1", configuration),
    experimentBindings,
    runtimeSealSha256: runtimeSeal.runtimeSealSha256,
    modelSealSha256: modelSeal.modelSealSha256,
    inputPackManifestSha256: input.inputPackManifestSha256,
    inputPackPublicationReceiptSha256: input.inputPackPublicationReceiptSha256,
    inputPackBundleMaterialSha256: input.inputPackBundleMaterialSha256,
    sourceImageSha256: paths.sourceImage.sha256,
    adapterSha256: paths.adapter.sha256,
    runtimeSealToolSha256: paths.runtimeSealTool.sha256,
    paths,
    launch: {
      wslDistribution: input.wslDistribution,
      namespaceArgvPrefix: ["unshare", "--user", "--map-root-user", "--net"],
      offlineEnvironment: {
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        DIFFUSERS_OFFLINE: "1",
        HF_DATASETS_OFFLINE: "1",
        HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
        PIP_NO_INDEX: "1",
        WANDB_MODE: "disabled",
        TOKENIZERS_PARALLELISM: "false",
        CUDA_MODULE_LOADING: "EAGER",
        CUBLAS_WORKSPACE_CONFIG: ":4096:8",
      },
    },
    policies: {
      network: "os_namespace_unreachable",
      externalCost: "zero",
      sourceAccess: "read_only",
      output: "create_only_no_overwrite",
      retries: 0,
      retryOnOutOfMemory: false,
      secretsAllowed: false,
      capturedAuthority: "none",
      structuralAuthority: "none",
      runtimeAuthority: "none",
      resultClass: "generated_cinematic_diagnostic",
    },
  });
  return GrandHallDifixExecutionLockSchema.parse({
    ...payload,
    executionLockSha256: digest(EXECUTION_LOCK_DIGEST_DOMAIN, payload),
  });
}

export interface CompileGrandHallDifixAuthorizationInput {
  readonly authorizationId: string;
  readonly executionLock: GrandHallDifixExecutionLock;
  readonly objectiveArtifact: GrandHallDifixBoundFile;
  readonly objectiveArtifactStatementSha256: string;
  readonly actorId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
}

export function compileGrandHallDifixExecutionAuthorization(
  input: CompileGrandHallDifixAuthorizationInput,
): GrandHallDifixExecutionAuthorization {
  const lock = GrandHallDifixExecutionLockSchema.parse(input.executionLock);
  const objectiveArtifact = GrandHallDifixBoundFileSchema.parse(input.objectiveArtifact);
  if (input.objectiveArtifactStatementSha256 !== objectiveArtifact.sha256) {
    throw new Error("The active-goal statement digest must be the exact objective artifact byte digest.");
  }
  const paths = lock.paths;
  const payload = AuthorizationPayloadSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_AUTHORIZATION_SCHEMA,
    authorizationId: input.authorizationId,
    executionLockSha256: lock.executionLockSha256,
    experimentSha256: lock.experimentSha256,
    plannedExecutionLockSha256: lock.plannedExecutionLockSha256,
    authorizationBasis: {
      kind: "active_user_goal_objective_artifact",
      objectiveArtifact,
      objectiveArtifactStatementSha256: input.objectiveArtifactStatementSha256,
    },
    actor: { id: input.actorId, role: "goal_owner_authorized_operator" },
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    grant: "one_local_difix_no_reference_diagnostic_attempt",
    maximumAttempts: 1,
    externalCostLimitUsd: 0,
    exactBindings: {
      adapterSha256: lock.adapterSha256,
      configurationSha256: lock.configurationSha256,
      runtimeSealSha256: lock.runtimeSealSha256,
      modelSealSha256: lock.modelSealSha256,
      inputPackManifestSha256: lock.inputPackManifestSha256,
      inputPackPublicationReceiptSha256: lock.inputPackPublicationReceiptSha256,
      sourceImageSha256: lock.sourceImageSha256,
    },
    exactCreateOnlyPaths: {
      claimHost: paths.claimHost,
      attemptDirectoryHost: paths.attemptDirectoryHost,
      hfModulesCacheHost: paths.hfModulesCacheHost,
      torchHomeHost: paths.torchHomeHost,
      modelExecutionSnapshotHost: paths.modelExecutionSnapshotHost,
      outputImageHost: paths.outputImageHost,
      adapterReceiptHost: paths.adapterReceiptHost,
      stdoutHost: paths.stdoutHost,
      stderrHost: paths.stderrHost,
      startedReceiptHost: paths.startedReceiptHost,
      terminalReceiptHost: paths.terminalReceiptHost,
    },
    policies: {
      baseExperimentRemainsNotAuthorizedAndImmutable: true,
      overlayDoesNotMutateExperiment: true,
      claimConsumesAuthorizationEvenOnFailure: true,
      network: "os_namespace_unreachable",
      sourceAccess: "read_only",
      output: "create_only_no_overwrite",
      retries: 0,
      retryOnOutOfMemory: false,
      secretsAllowed: false,
      capturedAuthority: "none",
      structuralAuthority: "none",
      runtimeAuthority: "none",
      resultClass: "generated_cinematic_diagnostic",
    },
  });
  return GrandHallDifixExecutionAuthorizationSchema.parse({
    ...payload,
    authorizationSha256: digest(AUTHORIZATION_DIGEST_DOMAIN, payload),
  });
}

export function createGrandHallDifixAuthorizationClaim(input: {
  readonly authorization: GrandHallDifixExecutionAuthorization;
  readonly executionLock: GrandHallDifixExecutionLock;
  readonly claimedAt: string;
}): GrandHallDifixAuthorizationClaim {
  const authorization = GrandHallDifixExecutionAuthorizationSchema.parse(input.authorization);
  const lock = GrandHallDifixExecutionLockSchema.parse(input.executionLock);
  if (authorization.executionLockSha256 !== lock.executionLockSha256) {
    throw new Error("Authorization does not bind this execution lock.");
  }
  const claimedAt = Date.parse(input.claimedAt);
  if (claimedAt < Date.parse(authorization.issuedAt) || claimedAt >= Date.parse(authorization.expiresAt)) {
    throw new Error("Authorization claim instant is outside the active authorization window.");
  }
  const payload = ClaimPayloadSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_CLAIM_SCHEMA,
    authorizationSha256: authorization.authorizationSha256,
    executionLockSha256: lock.executionLockSha256,
    nonce: authorization.nonce,
    claimedAt: input.claimedAt,
    attemptOrdinal: 1,
    authorizationConsumed: true,
    consumedEvenOnFailure: true,
  });
  return GrandHallDifixAuthorizationClaimSchema.parse({
    ...payload,
    claimSha256: digest(CLAIM_DIGEST_DOMAIN, payload),
  });
}

export function createGrandHallDifixAttemptReceipt(
  input: z.input<typeof AttemptReceiptPayloadSchema>,
): GrandHallDifixAttemptReceipt {
  const payload = AttemptReceiptPayloadSchema.parse(input);
  return GrandHallDifixAttemptReceiptSchema.parse({
    ...payload,
    attemptReceiptSha256: digest(ATTEMPT_RECEIPT_DIGEST_DOMAIN, payload),
  });
}

export function assertGrandHallDifixAuthorizationMatchesLock(
  authorizationInput: unknown,
  lockInput: unknown,
): { readonly authorization: GrandHallDifixExecutionAuthorization; readonly lock: GrandHallDifixExecutionLock } {
  const authorization = GrandHallDifixExecutionAuthorizationSchema.parse(authorizationInput);
  const lock = GrandHallDifixExecutionLockSchema.parse(lockInput);
  if (authorization.executionLockSha256 !== lock.executionLockSha256) throw new Error("Authorization lock digest mismatch.");
  if (authorization.experimentSha256 !== lock.experimentSha256) throw new Error("Authorization experiment digest mismatch.");
  if (authorization.plannedExecutionLockSha256 !== lock.plannedExecutionLockSha256) throw new Error("Authorization planned-lock digest mismatch.");
  if (!canonicalEqual(authorization.exactBindings, {
    adapterSha256: lock.adapterSha256,
    configurationSha256: lock.configurationSha256,
    runtimeSealSha256: lock.runtimeSealSha256,
    modelSealSha256: lock.modelSealSha256,
    inputPackManifestSha256: lock.inputPackManifestSha256,
    inputPackPublicationReceiptSha256: lock.inputPackPublicationReceiptSha256,
    sourceImageSha256: lock.sourceImageSha256,
  })) throw new Error("Authorization exact bindings disagree with the lock.");
  if (!canonicalEqual(authorization.exactCreateOnlyPaths, {
    claimHost: lock.paths.claimHost,
    attemptDirectoryHost: lock.paths.attemptDirectoryHost,
    hfModulesCacheHost: lock.paths.hfModulesCacheHost,
    torchHomeHost: lock.paths.torchHomeHost,
    modelExecutionSnapshotHost: lock.paths.modelExecutionSnapshotHost,
    outputImageHost: lock.paths.outputImageHost,
    adapterReceiptHost: lock.paths.adapterReceiptHost,
    stdoutHost: lock.paths.stdoutHost,
    stderrHost: lock.paths.stderrHost,
    startedReceiptHost: lock.paths.startedReceiptHost,
    terminalReceiptHost: lock.paths.terminalReceiptHost,
  })) throw new Error("Authorization create-only paths disagree with the lock.");
  return { authorization, lock };
}

export function assertGrandHallDifixAuthorizationCurrent(
  authorization: GrandHallDifixExecutionAuthorization,
  now: Date,
): void {
  const instant = now.getTime();
  if (!Number.isFinite(instant)) throw new Error("Authorization check time is invalid.");
  if (instant < Date.parse(authorization.issuedAt)) throw new Error("Authorization is not active yet.");
  if (instant >= Date.parse(authorization.expiresAt)) throw new Error("Authorization has expired.");
}

import { FoundryRelativePathSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FoundryUniversalIntakeFileSchema,
  FoundryUniversalIntakeReceiptSchema,
  type FoundryUniversalIntakeReceipt,
} from "./intake-receipt.js";

export const FOUNDRY_PREPARED_HD_DATASET_READINESS_V0 =
  "omnitwin.foundry.prepared-hd-dataset-readiness.v0";
export const FOUNDRY_PREPARED_HD_DATASET_READINESS_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_PREPARED_HD_DATASET_READINESS_V0";
export const FOUNDRY_PREPARED_HD_DATASET_RESULT_V0 =
  "prepared_dataset_validated_runtime_and_training_disabled";
export const FOUNDRY_PREPARED_HD_DATASET_PYTHON_GATE_V0 =
  "venviewer.prepared-hd-dataset-gate.v0";
export const FOUNDRY_PREPARED_HD_DATASET_PYTHON_SUMMARY_V0 =
  "omnitwin.colmap-training-contract.v0";

export const FOUNDRY_PREPARED_HD_DATASET_LAYOUT_V0 = {
  datasetRoot: "dataset/",
  depthRoot: "depths/",
} as const;

export const FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0 = {
  depthRequired: true,
  dataFactor: 2,
  testEvery: 8,
  splitRule: "sorted_filename_index_modulo_test_every",
  runtimeImageDirectory: "images_2",
} as const;

export const FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0 = {
  parser: "venviewer_training/colmap_contract.py",
  cli: "venviewer_training/colmap_contract_cli.py",
  config: "configs/training/config_b.yaml",
  sourceLock: "venviewer_training/gsplat-v1.5.3.source-lock.json",
} as const;

export const FOUNDRY_PREPARED_HD_DATASET_CAPABILITIES_V0 = {
  preparedDatasetValidation: true,
  registration: false,
  reconstruction: false,
  training: false,
  enhancement: false,
  execution: false,
  authority: false,
  signing: false,
  publication: false,
} as const;

export const FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0 = [
  "No registration is performed or authorized.",
  "No reconstruction is performed or authorized.",
  "No training is performed or authorized.",
  "No enhancement is performed or authorized.",
  "No runtime execution is enabled or authorized.",
  "This receipt grants no operational authority.",
  "No signing is performed or authorized.",
  "No publication is performed or authorized.",
] as const;

const MAX_MEMBERS = 100_000;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const Sha256Schema = z.string().regex(SHA256_HEX);
const PositiveSafeIntegerSchema = z.number().int().safe().positive();
const NonNegativeSafeIntegerSchema = z.number().int().safe().nonnegative();
const FiniteNumberSchema = z.number().finite();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalString(input: unknown): string {
  return stableCanonicalJson(toCanonicalJson(input));
}

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

function assertSortedUniqueCaseSafe(
  paths: readonly string[],
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  label: string,
): void {
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  for (const [index, memberPath] of paths.entries()) {
    if (index > 0 && compareText(paths[index - 1] ?? "", memberPath) >= 0) {
      addIssue(ctx, path, `${label} must be strictly sorted by path`);
      break;
    }
    if (exact.has(memberPath)) {
      addIssue(ctx, [...path, index], `${label} contains a duplicate path`);
    }
    exact.add(memberPath);
    const caseKey = memberPath.toLocaleLowerCase("en-US");
    const collision = folded.get(caseKey);
    if (collision !== undefined && collision !== memberPath) {
      addIssue(
        ctx,
        [...path, index],
        `${label} contains a case-insensitive path collision with ${collision}`,
      );
    }
    folded.set(caseKey, memberPath);
  }
}

function withoutFinalExtension(path: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(0, dot) : path;
}

function finalStem(path: string): string {
  const fileName = path.split("/").at(-1) ?? "";
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export const FoundryPreparedHdDatasetSourceMemberReceiptV0Schema = z
  .object({
    intakeReceiptSha256: Sha256Schema,
    file: FoundryUniversalIntakeFileSchema,
  })
  .strict();
export type FoundryPreparedHdDatasetSourceMemberReceiptV0 = z.infer<
  typeof FoundryPreparedHdDatasetSourceMemberReceiptV0Schema
>;

export const FoundryPreparedHdDatasetFileReceiptV0Schema = z
  .object({
    path: FoundryRelativePathSchema.refine(
      (path) => path.startsWith("dataset/") || path.startsWith("depths/"),
      "prepared file must be rooted beneath dataset/ or depths/",
    ),
    sizeBytes: PositiveSafeIntegerSchema,
    sha256: Sha256Schema,
  })
  .strict();
export type FoundryPreparedHdDatasetFileReceiptV0 = z.infer<
  typeof FoundryPreparedHdDatasetFileReceiptV0Schema
>;

const ToolFileReceiptSchema = z
  .object({
    path: FoundryRelativePathSchema,
    sizeBytes: PositiveSafeIntegerSchema,
    sha256: Sha256Schema,
  })
  .strict();

export const FoundryPreparedHdDatasetToolReceiptsV0Schema = z
  .object({
    parser: ToolFileReceiptSchema.extend({
      path: z.literal(FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.parser),
    }).strict(),
    cli: ToolFileReceiptSchema.extend({
      path: z.literal(FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.cli),
    }).strict(),
    config: ToolFileReceiptSchema.extend({
      path: z.literal(FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.config),
    }).strict(),
    sourceLock: ToolFileReceiptSchema.extend({
      path: z.literal(FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.sourceLock),
    }).strict(),
  })
  .strict();
export type FoundryPreparedHdDatasetToolReceiptsV0 = z.infer<
  typeof FoundryPreparedHdDatasetToolReceiptsV0Schema
>;

const FileSummarySchema = z
  .object({
    bytes: PositiveSafeIntegerSchema,
    sha256: Sha256Schema,
  })
  .strict();

const CameraSummarySchema = z
  .object({
    cameraId: PositiveSafeIntegerSchema,
    modelId: z.literal(1),
    model: z.literal("PINHOLE"),
    width: PositiveSafeIntegerSchema,
    height: PositiveSafeIntegerSchema,
    params: z.tuple([
      FiniteNumberSchema,
      FiniteNumberSchema,
      FiniteNumberSchema,
      FiniteNumberSchema,
    ]),
  })
  .strict();

const ImageSummarySchema = z
  .object({
    imageId: PositiveSafeIntegerSchema,
    name: FoundryRelativePathSchema,
    cameraId: PositiveSafeIntegerSchema,
    cameraModel: z.literal("PINHOLE"),
    width: PositiveSafeIntegerSchema,
    height: PositiveSafeIntegerSchema,
    observationCount: NonNegativeSafeIntegerSchema,
    sha256: Sha256Schema,
  })
  .strict();

const RuntimeImageSummarySchema = z
  .object({
    sourceName: FoundryRelativePathSchema,
    name: FoundryRelativePathSchema,
    width: PositiveSafeIntegerSchema,
    height: PositiveSafeIntegerSchema,
    sha256: Sha256Schema,
  })
  .strict();

const DepthPriorSummarySchema = z
  .object({
    fileName: FoundryRelativePathSchema.refine(
      (path) => !path.includes("/"),
      "depth prior fileName must be a file name, not a path",
    ),
    imageName: FoundryRelativePathSchema,
    sha256: Sha256Schema,
    sampleCount: PositiveSafeIntegerSchema,
    width: PositiveSafeIntegerSchema,
    height: PositiveSafeIntegerSchema,
    uvDtype: z.literal("float32"),
    depthDtype: z.literal("float32"),
  })
  .strict();

const PythonSummaryObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PREPARED_HD_DATASET_PYTHON_SUMMARY_V0),
    binaryFormat: z
      .object({
        format: z.literal("COLMAP sparse binary"),
        endianness: z.literal("little"),
      })
      .strict(),
    parserSemantics: z
      .object({
        implementation: z.literal("gsplat v1.5.3 examples/datasets/colmap.py"),
        dataFactor: z.literal(FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0.dataFactor),
        testEvery: z.literal(FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0.testEvery),
        splitRule: z.literal(FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0.splitRule),
        runtimeImageDirectory: z.literal(
          FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0.runtimeImageDirectory,
        ),
        extMetadataAccepted: z.literal(false),
      })
      .strict(),
    files: z
      .object({
        "cameras.bin": FileSummarySchema,
        "images.bin": FileSummarySchema,
        "points3D.bin": FileSummarySchema,
        "splits.json": FileSummarySchema,
      })
      .strict(),
    cameraCount: PositiveSafeIntegerSchema,
    cameras: z.array(CameraSummarySchema).min(1).max(MAX_MEMBERS),
    imageCount: z.number().int().safe().min(2).max(MAX_MEMBERS),
    images: z.array(ImageSummarySchema).min(2).max(MAX_MEMBERS),
    runtimeImageCount: z.number().int().safe().min(2).max(MAX_MEMBERS),
    runtimeImages: z.array(RuntimeImageSummarySchema).min(2).max(MAX_MEMBERS),
    point3DCount: NonNegativeSafeIntegerSchema,
    pointObservationCount: NonNegativeSafeIntegerSchema,
    splits: z
      .object({
        train: z.array(FoundryRelativePathSchema).min(1).max(MAX_MEMBERS),
        heldout: z.array(FoundryRelativePathSchema).min(1).max(MAX_MEMBERS),
        trainCount: PositiveSafeIntegerSchema,
        heldoutCount: PositiveSafeIntegerSchema,
      })
      .strict(),
    depth: z
      .object({
        required: z.literal(true),
        priorCount: PositiveSafeIntegerSchema,
        priors: z.array(DepthPriorSummarySchema).min(1).max(MAX_MEMBERS),
      })
      .strict(),
  })
  .strict();

function validatePythonSummary(
  summary: z.infer<typeof PythonSummaryObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  if (summary.cameraCount !== summary.cameras.length) {
    addIssue(ctx, ["cameraCount"], "cameraCount must equal cameras.length");
  }
  if (summary.imageCount !== summary.images.length) {
    addIssue(ctx, ["imageCount"], "imageCount must equal images.length");
  }
  if (summary.runtimeImageCount !== summary.runtimeImages.length) {
    addIssue(
      ctx,
      ["runtimeImageCount"],
      "runtimeImageCount must equal runtimeImages.length",
    );
  }
  if (summary.splits.trainCount !== summary.splits.train.length) {
    addIssue(ctx, ["splits", "trainCount"], "trainCount must equal train.length");
  }
  if (summary.splits.heldoutCount !== summary.splits.heldout.length) {
    addIssue(
      ctx,
      ["splits", "heldoutCount"],
      "heldoutCount must equal heldout.length",
    );
  }
  if (summary.depth.priorCount !== summary.depth.priors.length) {
    addIssue(ctx, ["depth", "priorCount"], "priorCount must equal priors.length");
  }

  const cameraIds = summary.cameras.map((camera) => camera.cameraId);
  if (
    new Set(cameraIds).size !== cameraIds.length ||
    cameraIds.some((cameraId, index) => index > 0 && cameraId <= (cameraIds[index - 1] ?? 0))
  ) {
    addIssue(ctx, ["cameras"], "cameras must have unique, ascending cameraId values");
  }
  const cameras = new Map(summary.cameras.map((camera) => [camera.cameraId, camera]));

  const imageNames = summary.images.map((image) => image.name);
  assertSortedUniqueCaseSafe(imageNames, ctx, ["images"], "image names");
  const imageIds = summary.images.map((image) => image.imageId);
  if (new Set(imageIds).size !== imageIds.length) {
    addIssue(ctx, ["images"], "imageId values must be unique");
  }
  const images = new Map(summary.images.map((image) => [image.name, image]));
  for (const [index, image] of summary.images.entries()) {
    const camera = cameras.get(image.cameraId);
    if (camera === undefined) {
      addIssue(ctx, ["images", index, "cameraId"], "image references an unknown camera");
      continue;
    }
    if (image.width !== camera.width || image.height !== camera.height) {
      addIssue(
        ctx,
        ["images", index],
        "image camera model and dimensions must match its camera",
      );
    }
    if (
      image.width % FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0.dataFactor !== 0 ||
      image.height % FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0.dataFactor !== 0
    ) {
      addIssue(ctx, ["images", index], "image dimensions must be exactly divisible by dataFactor 2");
    }
  }

  const expectedHeldout = imageNames.filter(
    (_name, index) => index % FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0.testEvery === 0,
  );
  const expectedTrain = imageNames.filter(
    (_name, index) => index % FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0.testEvery !== 0,
  );
  if (canonicalString(summary.splits.train) !== canonicalString(expectedTrain)) {
    addIssue(ctx, ["splits", "train"], "train split does not match the fixed sorted modulo rule");
  }
  if (canonicalString(summary.splits.heldout) !== canonicalString(expectedHeldout)) {
    addIssue(
      ctx,
      ["splits", "heldout"],
      "heldout split does not match the fixed sorted modulo rule",
    );
  }

  const runtimeSourceNames = summary.runtimeImages.map((image) => image.sourceName);
  if (canonicalString(runtimeSourceNames) !== canonicalString(imageNames)) {
    addIssue(
      ctx,
      ["runtimeImages"],
      "runtime images must map one-for-one in sorted source-image order",
    );
  }
  const runtimeNames = summary.runtimeImages.map((image) => image.name);
  assertSortedUniqueCaseSafe(runtimeNames, ctx, ["runtimeImages"], "runtime image names");
  for (const [index, runtimeImage] of summary.runtimeImages.entries()) {
    const sourceImage = images.get(runtimeImage.sourceName);
    if (sourceImage === undefined) {
      addIssue(
        ctx,
        ["runtimeImages", index, "sourceName"],
        "runtime image references an unknown source image",
      );
      continue;
    }
    if (withoutFinalExtension(runtimeImage.name) !== withoutFinalExtension(sourceImage.name)) {
      addIssue(
        ctx,
        ["runtimeImages", index, "name"],
        "runtime image must preserve the source relative stem",
      );
    }
    if (
      runtimeImage.width * FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0.dataFactor !==
        sourceImage.width ||
      runtimeImage.height * FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0.dataFactor !==
        sourceImage.height
    ) {
      addIssue(
        ctx,
        ["runtimeImages", index],
        "runtime image dimensions must be exactly one half of source dimensions",
      );
    }
  }

  const depthImageNames = summary.depth.priors.map((prior) => prior.imageName);
  if (canonicalString(depthImageNames) !== canonicalString(expectedTrain)) {
    addIssue(
      ctx,
      ["depth", "priors"],
      "required depth priors must match all and only training images",
    );
  }
  const depthFileNames = summary.depth.priors.map((prior) => prior.fileName);
  assertSortedUniqueCaseSafe(
    depthFileNames,
    ctx,
    ["depth", "priors"],
    "depth prior file names",
  );
  for (const [index, prior] of summary.depth.priors.entries()) {
    const image = images.get(prior.imageName);
    if (image === undefined) {
      addIssue(
        ctx,
        ["depth", "priors", index, "imageName"],
        "depth prior references an unknown image",
      );
      continue;
    }
    if (prior.fileName !== `${finalStem(prior.imageName)}.npz`) {
      addIssue(
        ctx,
        ["depth", "priors", index, "fileName"],
        "depth prior fileName must exactly match the source image stem",
      );
    }
    if (prior.width !== image.width || prior.height !== image.height) {
      addIssue(
        ctx,
        ["depth", "priors", index],
        "depth prior dimensions must match the source image",
      );
    }
  }
}

export const FoundryPreparedHdDatasetPythonSummaryV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PREPARED_HD_DATASET_PYTHON_GATE_V0),
    ok: z.literal(true),
    summary: PythonSummaryObjectSchema.superRefine(validatePythonSummary),
  })
  .strict();
export type FoundryPreparedHdDatasetPythonSummaryV0 = z.infer<
  typeof FoundryPreparedHdDatasetPythonSummaryV0Schema
>;

const SourceBindingSchema = z
  .object({
    universalIntakeReceipt: FoundryUniversalIntakeReceiptSchema,
    universalIntakeReceiptSha256: Sha256Schema,
    beforeReceiptSha256: Sha256Schema,
    afterReceiptSha256: Sha256Schema,
    unchanged: z.literal(true),
    consumedMembers: z
      .array(FoundryPreparedHdDatasetSourceMemberReceiptV0Schema)
      .max(MAX_MEMBERS),
  })
  .strict();

const PackageSummarySchema = z
  .object({
    fileCount: PositiveSafeIntegerSchema,
    totalBytes: PositiveSafeIntegerSchema,
    datasetFileCount: PositiveSafeIntegerSchema,
    depthFileCount: PositiveSafeIntegerSchema,
  })
  .strict();

const LayoutSchema = z
  .object({
    datasetRoot: z.literal(FOUNDRY_PREPARED_HD_DATASET_LAYOUT_V0.datasetRoot),
    depthRoot: z.literal(FOUNDRY_PREPARED_HD_DATASET_LAYOUT_V0.depthRoot),
  })
  .strict();

const ConfigBSchema = z
  .object({
    depthRequired: z.literal(true),
    dataFactor: z.literal(2),
    testEvery: z.literal(8),
    splitRule: z.literal("sorted_filename_index_modulo_test_every"),
    runtimeImageDirectory: z.literal("images_2"),
  })
  .strict();

const CapabilitiesSchema = z
  .object({
    preparedDatasetValidation: z.literal(true),
    registration: z.literal(false),
    reconstruction: z.literal(false),
    training: z.literal(false),
    enhancement: z.literal(false),
    execution: z.literal(false),
    authority: z.literal(false),
    signing: z.literal(false),
    publication: z.literal(false),
  })
  .strict();

const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0[0]),
  z.literal(FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0[1]),
  z.literal(FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0[2]),
  z.literal(FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0[3]),
  z.literal(FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0[4]),
  z.literal(FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0[5]),
  z.literal(FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0[6]),
  z.literal(FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0[7]),
]);

const ReceiptPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PREPARED_HD_DATASET_READINESS_V0),
    authority: z.literal("none"),
    result: z.literal(FOUNDRY_PREPARED_HD_DATASET_RESULT_V0),
    source: SourceBindingSchema,
    packageLayout: LayoutSchema,
    configB: ConfigBSchema,
    toolReceipts: FoundryPreparedHdDatasetToolReceiptsV0Schema,
    preparedFiles: z.array(FoundryPreparedHdDatasetFileReceiptV0Schema).min(1).max(MAX_MEMBERS),
    preparedPackageSummary: PackageSummarySchema,
    pythonValidation: FoundryPreparedHdDatasetPythonSummaryV0Schema,
    capabilities: CapabilitiesSchema,
    limitations: LimitationsSchema,
  })
  .strict();

type ReceiptPayload = z.infer<typeof ReceiptPayloadObjectSchema>;

function expectedPreparedPaths(summary: z.infer<typeof PythonSummaryObjectSchema>): Map<string, {
  readonly sizeBytes: number | null;
  readonly sha256: string;
}> {
  const paths = new Map<string, { readonly sizeBytes: number | null; readonly sha256: string }>();
  const add = (path: string, sizeBytes: number | null, sha256: string): void => {
    paths.set(path, { sizeBytes, sha256 });
  };
  add(
    "dataset/sparse/0/cameras.bin",
    summary.files["cameras.bin"].bytes,
    summary.files["cameras.bin"].sha256,
  );
  add(
    "dataset/sparse/0/images.bin",
    summary.files["images.bin"].bytes,
    summary.files["images.bin"].sha256,
  );
  add(
    "dataset/sparse/0/points3D.bin",
    summary.files["points3D.bin"].bytes,
    summary.files["points3D.bin"].sha256,
  );
  add(
    "dataset/splits.json",
    summary.files["splits.json"].bytes,
    summary.files["splits.json"].sha256,
  );
  for (const image of summary.images) {
    add(`dataset/images/${image.name}`, null, image.sha256);
  }
  for (const image of summary.runtimeImages) {
    add(`dataset/images_2/${image.name}`, null, image.sha256);
  }
  for (const prior of summary.depth.priors) {
    add(`depths/${prior.fileName}`, null, prior.sha256);
  }
  return paths;
}

function expectedPackageSummary(
  files: readonly FoundryPreparedHdDatasetFileReceiptV0[],
): z.infer<typeof PackageSummarySchema> {
  let totalBytes = 0;
  let datasetFileCount = 0;
  let depthFileCount = 0;
  for (const file of files) {
    totalBytes += file.sizeBytes;
    if (!Number.isSafeInteger(totalBytes)) {
      throw new FoundryIntegrityError(
        "PREPARED_HD_DATASET_SIZE_OUT_OF_BOUNDS",
        "Prepared package byte total cannot be represented safely.",
      );
    }
    if (file.path.startsWith("dataset/")) datasetFileCount += 1;
    if (file.path.startsWith("depths/")) depthFileCount += 1;
  }
  return { fileCount: files.length, totalBytes, datasetFileCount, depthFileCount };
}

function validateReceiptPayload(payload: ReceiptPayload, ctx: z.RefinementCtx): void {
  const sourceReceipt = payload.source.universalIntakeReceipt;
  const intakeDigest = sourceReceipt.receiptSha256;
  if (
    payload.source.universalIntakeReceiptSha256 !== intakeDigest ||
    payload.source.beforeReceiptSha256 !== intakeDigest ||
    payload.source.afterReceiptSha256 !== intakeDigest
  ) {
    addIssue(
      ctx,
      ["source"],
      "universal, before, and after intake receipt digests must be exactly equal",
    );
  }

  const sourcePaths = sourceReceipt.files.map((file) => file.path);
  assertSortedUniqueCaseSafe(
    sourcePaths,
    ctx,
    ["source", "universalIntakeReceipt", "files"],
    "intake source paths",
  );
  const consumedPaths = payload.source.consumedMembers.map((member) => member.file.path);
  assertSortedUniqueCaseSafe(
    consumedPaths,
    ctx,
    ["source", "consumedMembers"],
    "consumed source paths",
  );
  if (payload.source.consumedMembers.length !== sourceReceipt.files.length) {
    addIssue(
      ctx,
      ["source", "consumedMembers"],
      "every intake member must be consumed exactly once",
    );
  }
  for (const [index, member] of payload.source.consumedMembers.entries()) {
    if (member.intakeReceiptSha256 !== intakeDigest) {
      addIssue(
        ctx,
        ["source", "consumedMembers", index, "intakeReceiptSha256"],
        "consumed member must cross-link the exact intake receipt",
      );
    }
    const expectedFile = sourceReceipt.files[index];
    if (expectedFile === undefined || canonicalString(member.file) !== canonicalString(expectedFile)) {
      addIssue(
        ctx,
        ["source", "consumedMembers", index, "file"],
        "consumed member must exactly equal the matching intake file receipt",
      );
    }
  }

  const preparedPaths = payload.preparedFiles.map((file) => file.path);
  assertSortedUniqueCaseSafe(
    preparedPaths,
    ctx,
    ["preparedFiles"],
    "prepared file paths",
  );
  if (payload.preparedFiles.length !== sourceReceipt.files.length) {
    addIssue(
      ctx,
      ["preparedFiles"],
      "prepared files must consume the entire exact universal intake package",
    );
  }
  for (const [index, preparedFile] of payload.preparedFiles.entries()) {
    const sourceFile = sourceReceipt.files[index];
    if (
      sourceFile === undefined ||
      preparedFile.path !== sourceFile.path ||
      preparedFile.sizeBytes !== sourceFile.sizeBytes ||
      preparedFile.sha256 !== sourceFile.sha256
    ) {
      addIssue(
        ctx,
        ["preparedFiles", index],
        "prepared file must exactly match the source receipt path, byte size, and hash",
      );
    }
  }
  const expectedFiles = expectedPreparedPaths(payload.pythonValidation.summary);
  if (expectedFiles.size !== payload.preparedFiles.length) {
    addIssue(
      ctx,
      ["preparedFiles"],
      "prepared files must contain exactly the members consumed by the Python summary",
    );
  }
  for (const [index, file] of payload.preparedFiles.entries()) {
    const expected = expectedFiles.get(file.path);
    if (expected === undefined) {
      addIssue(ctx, ["preparedFiles", index, "path"], "prepared file is not consumed by the summary");
      continue;
    }
    if (file.sha256 !== expected.sha256) {
      addIssue(
        ctx,
        ["preparedFiles", index, "sha256"],
        "prepared file hash does not match the Python summary",
      );
    }
    if (expected.sizeBytes !== null && file.sizeBytes !== expected.sizeBytes) {
      addIssue(
        ctx,
        ["preparedFiles", index, "sizeBytes"],
        "prepared file byte size does not match the Python summary",
      );
    }
  }

  const expectedSummary = expectedPackageSummary(payload.preparedFiles);
  if (canonicalString(payload.preparedPackageSummary) !== canonicalString(expectedSummary)) {
    addIssue(
      ctx,
      ["preparedPackageSummary"],
      "prepared package summary does not match its file receipts",
    );
  }
}

const ReceiptPayloadSchema = ReceiptPayloadObjectSchema.superRefine(validateReceiptPayload);

export function computeFoundryPreparedHdDatasetReadinessReceiptSha256(
  input: unknown,
): string {
  const payload = ReceiptPayloadSchema.parse(input);
  return domainSeparatedSha256(
    FOUNDRY_PREPARED_HD_DATASET_READINESS_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

export const FoundryPreparedHdDatasetReadinessReceiptV0Schema =
  ReceiptPayloadObjectSchema.extend({ receiptSha256: Sha256Schema })
    .strict()
    .superRefine((receipt, ctx) => {
      const { receiptSha256: _receiptSha256, ...payload } = receipt;
      const parsed = ReceiptPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue(issue);
        return;
      }
      if (
        receipt.receiptSha256 !==
        computeFoundryPreparedHdDatasetReadinessReceiptSha256(parsed.data)
      ) {
        addIssue(
          ctx,
          ["receiptSha256"],
          "prepared HD dataset readiness digest does not match its canonical payload",
        );
      }
    });

export type FoundryPreparedHdDatasetReadinessReceiptV0 = z.infer<
  typeof FoundryPreparedHdDatasetReadinessReceiptV0Schema
>;

export interface CompileFoundryPreparedHdDatasetReadinessReceiptV0Input {
  readonly sourceReceiptBefore: FoundryUniversalIntakeReceipt;
  readonly sourceReceiptAfter: FoundryUniversalIntakeReceipt;
  readonly consumedSourceMembers: readonly FoundryPreparedHdDatasetSourceMemberReceiptV0[];
  readonly toolReceipts: FoundryPreparedHdDatasetToolReceiptsV0;
  readonly preparedFiles: readonly FoundryPreparedHdDatasetFileReceiptV0[];
  readonly pythonSummary: FoundryPreparedHdDatasetPythonSummaryV0;
}

function parseIntakeReceipt(input: unknown, label: string): FoundryUniversalIntakeReceipt {
  const parsed = FoundryUniversalIntakeReceiptSchema.safeParse(input);
  if (!parsed.success) {
    throw new FoundryIntegrityError(
      "PREPARED_HD_DATASET_INVALID_INTAKE_RECEIPT",
      `${label} universal intake receipt is invalid.`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export function compileFoundryPreparedHdDatasetReadinessReceiptV0(
  input: CompileFoundryPreparedHdDatasetReadinessReceiptV0Input,
): FoundryPreparedHdDatasetReadinessReceiptV0 {
  const sourceReceiptBefore = parseIntakeReceipt(input.sourceReceiptBefore, "Before");
  const sourceReceiptAfter = parseIntakeReceipt(input.sourceReceiptAfter, "After");
  if (
    sourceReceiptBefore.receiptSha256 !== sourceReceiptAfter.receiptSha256 ||
    canonicalString(sourceReceiptBefore) !== canonicalString(sourceReceiptAfter)
  ) {
    throw new FoundryIntegrityError(
      "PREPARED_HD_DATASET_SOURCE_MUTATED",
      "Universal intake receipt changed while the prepared dataset was validated.",
    );
  }

  const parsedFiles = z
    .array(FoundryPreparedHdDatasetFileReceiptV0Schema)
    .min(1)
    .max(MAX_MEMBERS)
    .parse(input.preparedFiles);
  const payload = ReceiptPayloadSchema.parse({
    schemaVersion: FOUNDRY_PREPARED_HD_DATASET_READINESS_V0,
    authority: "none",
    result: FOUNDRY_PREPARED_HD_DATASET_RESULT_V0,
    source: {
      universalIntakeReceipt: sourceReceiptBefore,
      universalIntakeReceiptSha256: sourceReceiptBefore.receiptSha256,
      beforeReceiptSha256: sourceReceiptBefore.receiptSha256,
      afterReceiptSha256: sourceReceiptAfter.receiptSha256,
      unchanged: true,
      consumedMembers: input.consumedSourceMembers,
    },
    packageLayout: { ...FOUNDRY_PREPARED_HD_DATASET_LAYOUT_V0 },
    configB: { ...FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0 },
    toolReceipts: input.toolReceipts,
    preparedFiles: parsedFiles,
    preparedPackageSummary: expectedPackageSummary(parsedFiles),
    pythonValidation: input.pythonSummary,
    capabilities: { ...FOUNDRY_PREPARED_HD_DATASET_CAPABILITIES_V0 },
    limitations: [...FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0],
  });
  return FoundryPreparedHdDatasetReadinessReceiptV0Schema.parse({
    ...payload,
    receiptSha256: computeFoundryPreparedHdDatasetReadinessReceiptSha256(payload),
  });
}

export function verifyFoundryPreparedHdDatasetReadinessReceiptV0(
  input: unknown,
): FoundryPreparedHdDatasetReadinessReceiptV0 {
  const parsed = FoundryPreparedHdDatasetReadinessReceiptV0Schema.safeParse(input);
  if (!parsed.success) {
    throw new FoundryIntegrityError(
      "PREPARED_HD_DATASET_RECEIPT_INVALID",
      "Prepared HD dataset readiness receipt failed strict verification.",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export function serializeFoundryPreparedHdDatasetReadinessReceiptV0(
  value: FoundryPreparedHdDatasetReadinessReceiptV0,
): string {
  return stableCanonicalJson(
    toCanonicalJson(verifyFoundryPreparedHdDatasetReadinessReceiptV0(value)),
  );
}

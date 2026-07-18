import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { stableCanonicalJson, domainSeparatedSha256, toCanonicalJson } from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  type ExpectedRegularFileIdentity,
  sha256RegularFileWithHead,
} from "./hash.js";
import { canonicalBundleRoot, listSafeBundleFiles } from "./path-safety.js";

export const FOUNDRY_TRAINING_CANDIDATE_VERIFICATION_V0 =
  "omnitwin.foundry.training-candidate-verification.v0";
export const VENVIEWER_ASSET_BUNDLE_V0 = "venviewer.assetbundle.v0";

const DIGEST_DOMAIN = {
  contentSet: "OMNITWIN_FOUNDRY_TRAINING_CANDIDATE_CONTENT_SET_V0",
  verification: "OMNITWIN_FOUNDRY_TRAINING_CANDIDATE_VERIFICATION_V0",
} as const;

const REQUIRED_CONTENT_FILES = [
  "colmap_input.json",
  "eval_holdout.json",
  "git_state.json",
  "hardware.json",
  "scene.ply",
  "training_config.json",
  "training_metrics.jsonl",
] as const;
const OPTIONAL_CONTENT_FILES = ["bilateral_grid.bin"] as const;
const ALLOWED_ROOT_FILES = [
  ...OPTIONAL_CONTENT_FILES,
  ...REQUIRED_CONTENT_FILES,
  "manifest.json",
] as const;
const VERIFIED_DOSSIER_FILES = [...REQUIRED_CONTENT_FILES, "manifest.json"].sort(
  (left, right) => left < right ? -1 : left > right ? 1 : 0,
);

const VENUE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RUN_ID = /^\d{8}T\d{6}Z-[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const OCI_IMAGE_DIGEST = /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/u;

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_METRICS_BYTES = 128 * 1024 * 1024;
const MAX_METRICS_LINES = 1_000_000;
const MAX_METRICS_LINE_BYTES = 64 * 1024;
const MAX_SCENE_BYTES = 128 * 1024 * 1024 * 1024;
const MAX_BILATERAL_GRID_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_CONTENT_BYTES = 128 * 1024 * 1024 * 1024 + 512 * 1024 * 1024;
const PLY_HEAD_BYTES = 64 * 1024;
const MAX_PLY_VERTICES = 100_000_000;
const MAX_JSON_DEPTH = 128;

const SafeIntegerSchema = z.number().int().nonnegative().safe();
const PositiveIntegerSchema = z.number().int().positive().safe();
const FiniteNumberSchema = z.number().finite();
const Sha256HexSchema = z.string().regex(SHA256_HEX);
const Sha256Schema = z.string().regex(SHA256);
const compareCodePoints = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
const nonBlankString = (max: number): z.ZodString => z.string().trim().min(1).max(max);
const VenueIdSchema = z.string().min(1).max(128).regex(VENUE_ID);
const RunIdSchema = z
  .string()
  .min(1)
  .max(150)
  .regex(RUN_ID)
  .refine((value) => {
    const timestamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/u.exec(value);
    if (timestamp === null) return false;
    const [year = "", month = "", day = "", hour = "", minute = "", second = ""] =
      timestamp.slice(1);
    const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
    const date = new Date(iso);
    return !Number.isNaN(date.valueOf()) && date.toISOString() === iso;
  }, "run_id must start with a real compact UTC instant");

const TrainingCandidateManifestFileSchema = z
  .object({
    name: z.enum([...REQUIRED_CONTENT_FILES, ...OPTIONAL_CONTENT_FILES]),
    size: SafeIntegerSchema,
    sha256: Sha256HexSchema,
  })
  .strict();

export const TrainingCandidateManifestV0Schema = z
  .object({
    schema_version: z.literal(VENVIEWER_ASSET_BUNDLE_V0),
    venue_id: VenueIdSchema,
    run_id: RunIdSchema,
    signature: z
      .object({
        status: z.literal("placeholder"),
        algorithm: z.null(),
        key_id: z.null(),
        value: z.null(),
      })
      .strict(),
    files: z.array(TrainingCandidateManifestFileSchema).min(7).max(8),
    total_size: SafeIntegerSchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const names = manifest.files.map((file) => file.name);
    const sortedNames = [...names].sort(compareCodePoints);
    if (
      new Set(names).size !== names.length ||
      names.some((name, index) => name !== sortedNames[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "manifest files must be unique and sorted by name",
      });
    }
    for (const required of REQUIRED_CONTENT_FILES) {
      if (!names.includes(required)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files"],
          message: `manifest is missing required file ${required}`,
        });
      }
    }
    const sum = manifest.files.reduce((total, file) => total + file.size, 0);
    if (!Number.isSafeInteger(sum) || sum !== manifest.total_size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["total_size"],
        message: "manifest total_size must exactly equal the listed byte total",
      });
    }
  });

export type TrainingCandidateManifestV0 = z.infer<typeof TrainingCandidateManifestV0Schema>;

const TrainingConfigSchema = z
  .object({
    config_path: nonBlankString(4096),
    config_sha256: Sha256HexSchema,
    seed: SafeIntegerSchema,
    invocation_argv: z.array(nonBlankString(4096)).min(1).max(512),
    trainer_image: z.string().regex(OCI_IMAGE_DIGEST),
    max_steps: PositiveIntegerSchema,
    antialiased: z.boolean(),
    depth_loss: z.boolean(),
    depth_lambda: FiniteNumberSchema.nonnegative(),
    with_ut: z.boolean(),
    with_eval3d: z.boolean(),
    post_processing: z.enum(["none", "bilateral_grid"]),
    sh_degree: z.number().int().min(0).max(4),
    bilateral_grid_shape: z
      .tuple([PositiveIntegerSchema, PositiveIntegerSchema, PositiveIntegerSchema])
      .optional(),
    strategy: z
      .object({
        type: z.literal("MCMCStrategy"),
        cap_max: PositiveIntegerSchema,
        noise_lr: FiniteNumberSchema.nonnegative(),
        refine_start_iter: SafeIntegerSchema,
        refine_stop_iter: PositiveIntegerSchema,
        refine_every: PositiveIntegerSchema,
        min_opacity: FiniteNumberSchema.nonnegative().max(1),
      })
      .passthrough(),
    extra_flags: z.array(nonBlankString(256)).max(256),
  })
  .passthrough()
  .superRefine((config, ctx) => {
    if (config.strategy.refine_stop_iter > config.max_steps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["strategy", "refine_stop_iter"],
        message: "refine_stop_iter cannot exceed max_steps",
      });
    }
    if (config.post_processing === "bilateral_grid" && config.bilateral_grid_shape === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bilateral_grid_shape"],
        message: "bilateral_grid post-processing requires an explicit grid shape",
      });
    }
    if (config.post_processing === "none" && config.bilateral_grid_shape !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bilateral_grid_shape"],
        message: "a bilateral grid shape is not valid when post-processing is disabled",
      });
    }
  });

const PsnrMetricSchema = z.number().finite().min(-1_000).max(1_000);
const SsimMetricSchema = z.number().finite().min(0).max(1);
const LpipsMetricSchema = z.number().finite().min(0).max(100);
const EvalHoldoutSchema = z
  .object({
    config: z.record(z.unknown()),
    data: nonBlankString(4096),
    device: nonBlankString(128),
    torch_version: nonBlankString(128),
    summary: z
      .object({
        psnr: PsnrMetricSchema,
        ssim: SsimMetricSchema,
        lpips: LpipsMetricSchema,
        fps: z.null(),
      })
      .passthrough(),
    per_image: z
      .array(
        z
          .object({
            name: nonBlankString(1024),
            psnr: PsnrMetricSchema,
            ssim: SsimMetricSchema,
            lpips: LpipsMetricSchema,
          })
          .passthrough(),
      )
      .min(1)
      .max(1_000_000),
  })
  .passthrough()
  .superRefine((evaluation, ctx) => {
    const names = evaluation.per_image.map((image) => image.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["per_image"],
        message: "held-out image names must be unique",
      });
    }
    const sorted = [...names].sort(compareCodePoints);
    if (names.some((name, index) => name !== sorted[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["per_image"],
        message: "held-out image names must be sorted",
      });
    }
  });

const HardwareSchema = z
  .object({
    gpu: nonBlankString(512),
    device_count: PositiveIntegerSchema,
    torch: nonBlankString(128),
    cuda: nonBlankString(128),
    driver: nonBlankString(128),
    trainer_image: z.string().regex(OCI_IMAGE_DIGEST),
    pod_id: nonBlankString(256),
    pod_region: nonBlankString(256),
  })
  .strict()
  .superRefine((hardware, ctx) => {
    for (const [key, value] of Object.entries(hardware)) {
      if (
        typeof value === "string" &&
        /^(?:cpu|unknown|null|none|n\/a|na|unset|placeholder|tbd|-+)$/iu.test(value.trim())
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must contain captured non-placeholder training hardware evidence`,
        });
      }
    }
  });

const GitStateSchema = z
  .object({
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
    branch: nonBlankString(512),
    remote: nonBlankString(4096),
    dirty: z.literal(false),
  })
  .strict()
  .superRefine((git, ctx) => {
    if (!/^(?:https:\/\/|ssh:\/\/|git@)[^\s]+$/u.test(git.remote)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remote"],
        message: "git remote must be an explicit sanitized https, ssh, or git@ location",
      });
    }
    if (/^https:\/\/[^/@:]+:[^/@]+@/u.test(git.remote)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remote"],
        message: "git remote must not embed credentials",
      });
    }
  });

const Vector3Schema = z.tuple([FiniteNumberSchema, FiniteNumberSchema, FiniteNumberSchema]);
const ColmapInputSchema = z
  .object({
    n_cameras: PositiveIntegerSchema,
    n_images: PositiveIntegerSchema,
    n_points3D: PositiveIntegerSchema,
    image_width: PositiveIntegerSchema,
    image_height: PositiveIntegerSchema,
    point_bbox_min: Vector3Schema,
    point_bbox_max: Vector3Schema,
  })
  .strict()
  .superRefine((colmap, ctx) => {
    for (let index = 0; index < 3; index += 1) {
      if ((colmap.point_bbox_min[index] ?? 0) >= (colmap.point_bbox_max[index] ?? 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["point_bbox_max", index],
          message: "COLMAP bounding-box maximums must exceed minimums",
        });
      }
    }
  });

const MetricLineSchema = z
  .object({
    step: PositiveIntegerSchema,
    loss: FiniteNumberSchema.nonnegative().optional(),
    psnr: PsnrMetricSchema.optional(),
    eval_psnr: PsnrMetricSchema.optional(),
    eval_ssim: SsimMetricSchema.optional(),
    eval_lpips: LpipsMetricSchema.optional(),
  })
  .passthrough()
  .superRefine((row, ctx) => {
    if (
      row.loss === undefined &&
      row.psnr === undefined &&
      row.eval_psnr === undefined &&
      row.eval_ssim === undefined &&
      row.eval_lpips === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a metric row must contain at least one declared training or evaluation metric",
      });
    }
  });

const VerifiedTrainingCandidateFileSchema = z
  .object({
    name: z.enum([...REQUIRED_CONTENT_FILES, ...OPTIONAL_CONTENT_FILES, "manifest.json"]),
    sizeBytes: SafeIntegerSchema,
    sha256: Sha256Schema,
  })
  .strict();

const TRAINING_CANDIDATE_CHECKS = [
  "exact_root_file_set",
  "placeholder_signature_only",
  "manifest_identity_matches_expected",
  "manifest_sizes_and_hashes",
  "bounded_json_schemas",
  "monotonic_training_metrics",
  "binary_little_endian_gaussian_ply",
  "bilateral_grid_config_consistency",
  "final_whole_tree_reinspection",
] as const;

const TRAINING_CANDIDATE_BLOCKERS = [
  "ingest_manifest_binding_missing",
  "job_spec_binding_missing",
  "provider_plan_binding_missing",
  "attempt_ledger_binding_missing",
  "quality_contract_binding_missing",
  "trusted_signature_missing",
] as const;

const TrainingCandidateControlBindingsSchema = z
  .object({
    ingestManifest: z.literal("missing_from_legacy_d014_v0"),
    jobSpec: z.literal("missing_from_legacy_d014_v0"),
    providerPlan: z.literal("missing_from_legacy_d014_v0"),
    attemptLedger: z.literal("missing_from_legacy_d014_v0"),
    qualityContract: z.literal("missing_from_legacy_d014_v0"),
  })
  .strict();

const TrainingCandidateCapabilitiesSchema = z
  .object({
    localVerification: z.literal("completed_verified"),
    execution: z.literal("not_authorized"),
    cloudDispatch: z.literal("not_authorized"),
    modelTraining: z.literal("not_authorized"),
    objectStoreMutation: z.literal("not_authorized"),
    qualityApproval: z.literal("not_authorized"),
    humanReview: z.literal("required"),
    signing: z.literal("not_authorized"),
    evidenceRegistration: z.literal("not_authorized"),
    assetVersionRegistration: z.literal("not_authorized"),
    publication: z.literal("not_authorized"),
    promotion: z.literal("not_authorized"),
    runtimeConsumption: z.literal("not_authorized"),
  })
  .strict();

const TrainingCandidateVerificationMaterialFields = {
    schemaVersion: z.literal(FOUNDRY_TRAINING_CANDIDATE_VERIFICATION_V0),
    manifestSchemaVersion: z.literal(VENVIEWER_ASSET_BUNDLE_V0),
    venueId: VenueIdSchema,
    runId: RunIdSchema,
    manifestSha256: Sha256Schema,
    contentSetSha256: Sha256Schema,
    files: z.array(VerifiedTrainingCandidateFileSchema).length(8),
    totalContentSizeBytes: SafeIntegerSchema,
    metricRows: PositiveIntegerSchema,
    finalMetricStep: PositiveIntegerSchema,
    gaussianVertexCount: PositiveIntegerSchema,
    checks: z.tuple(TRAINING_CANDIDATE_CHECKS.map((check) => z.literal(check)) as [
      z.ZodLiteral<(typeof TRAINING_CANDIDATE_CHECKS)[0]>,
      ...z.ZodLiteral<(typeof TRAINING_CANDIDATE_CHECKS)[number]>[],
    ]),
    trustStatus: z.literal("untrusted_candidate_verified"),
    releaseEligibility: z.literal("blocked_missing_control_bindings_and_signature"),
    blockers: z.tuple(TRAINING_CANDIDATE_BLOCKERS.map((blocker) => z.literal(blocker)) as [
      z.ZodLiteral<(typeof TRAINING_CANDIDATE_BLOCKERS)[0]>,
      ...z.ZodLiteral<(typeof TRAINING_CANDIDATE_BLOCKERS)[number]>[],
    ]),
    controlBindings: TrainingCandidateControlBindingsSchema,
    outcome: z.literal("valid_untrusted_training_candidate"),
    authority: z.literal("none"),
    capabilities: TrainingCandidateCapabilitiesSchema,
} as const;

const TrainingCandidateVerificationMaterialV0Schema = z
  .object(TrainingCandidateVerificationMaterialFields)
  .strict()
  .superRefine((verification, ctx) => {
    const names = verification.files.map((file) => file.name);
    const sorted = [...names].sort(compareCodePoints);
    if (
      names.length !== new Set(names).size ||
      names.some((name, index) => name !== sorted[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "verified files must be unique and sorted",
      });
    }
    if (
      names.length !== VERIFIED_DOSSIER_FILES.length ||
      names.some((name, index) => name !== VERIFIED_DOSSIER_FILES[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "verified dossiers must contain the exact non-bilateral D-014 file set",
      });
    }
    const manifestFile = verification.files.find((file) => file.name === "manifest.json");
    if (manifestFile?.sha256 !== verification.manifestSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manifestSha256"],
        message: "manifestSha256 must match the indexed manifest.json digest",
      });
    }
    const contentFiles = verification.files.filter((file) => file.name !== "manifest.json");
    const contentTotal = contentFiles
      .reduce((total, file) => total + file.sizeBytes, 0);
    if (!Number.isSafeInteger(contentTotal) || contentTotal !== verification.totalContentSizeBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalContentSizeBytes"],
        message: "verified content byte total must match every non-manifest file",
      });
    }
    const expectedContentSetSha256 = `sha256:${domainSeparatedSha256(
      DIGEST_DOMAIN.contentSet,
      toCanonicalJson(contentFiles),
    )}`;
    if (verification.contentSetSha256 !== expectedContentSetSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentSetSha256"],
        message: "contentSetSha256 must bind the exact sorted non-manifest file index",
      });
    }
  });

export type TrainingCandidateVerificationMaterialV0 = z.infer<
  typeof TrainingCandidateVerificationMaterialV0Schema
>;

export function computeTrainingCandidateVerificationSha256(
  material: TrainingCandidateVerificationMaterialV0,
): string {
  const parsed = TrainingCandidateVerificationMaterialV0Schema.parse(material);
  return `sha256:${domainSeparatedSha256(DIGEST_DOMAIN.verification, toCanonicalJson(parsed))}`;
}

export const TrainingCandidateVerificationV0Schema = z
  .object({
    ...TrainingCandidateVerificationMaterialFields,
    verificationSha256: Sha256Schema,
  })
  .strict()
  .superRefine((verification, ctx) => {
    const { verificationSha256: _digest, ...material } = verification;
    const parsedMaterial = TrainingCandidateVerificationMaterialV0Schema.safeParse(material);
    if (!parsedMaterial.success) {
      for (const issue of parsedMaterial.error.issues) {
        ctx.addIssue({ ...issue, path: issue.path });
      }
      return;
    }
    if (
      verification.verificationSha256 !==
      computeTrainingCandidateVerificationSha256(parsedMaterial.data)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verificationSha256"],
        message: "verificationSha256 must bind the exact verification dossier",
      });
    }
  });

export type TrainingCandidateVerificationV0 = z.infer<typeof TrainingCandidateVerificationV0Schema>;

function identityFromStat(stat: Stats): ExpectedRegularFileIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameIdentity(left: ExpectedRegularFileIdentity, right: ExpectedRegularFileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function decodeAndValidateJson(bytes: Buffer, label: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_JSON_BOM_INVALID",
      `${label} must not contain a UTF-8 byte-order mark.`,
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_JSON_ENCODING_INVALID",
      `${label} must be valid UTF-8.`,
      { cause: error },
    );
  }
  if (text.charCodeAt(0) === 0xfeff) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_JSON_BOM_INVALID",
      `${label} must not contain a UTF-8 byte-order mark.`,
    );
  }

  let index = 0;
  const isWhitespace = (character: string | undefined): boolean =>
    character === " " || character === "\t" || character === "\n" || character === "\r";
  const skipWhitespace = (): void => {
    while (index < text.length && isWhitespace(text[index])) index += 1;
  };
  const fail = (message: string): never => {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_JSON_LEXICAL_INVALID",
      `${label} ${message} at character ${String(index)}.`,
    );
  };
  const parseStringToken = (): string => {
    if (text[index] !== '"') fail("contains an invalid string token");
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try {
          const value: unknown = JSON.parse(text.slice(start, index));
          if (typeof value !== "string") return fail("contains an invalid string value");
          return value;
        } catch (error: unknown) {
          if (error instanceof FoundryIntegrityError) throw error;
          fail("contains an invalid escaped string");
        }
      }
      if (character === "\\") {
        index += 1;
        const escape = text[index];
        if (escape === "u") {
          const hex = text.slice(index + 1, index + 5);
          if (!/^[a-fA-F0-9]{4}$/u.test(hex)) fail("contains an invalid unicode escape");
          index += 5;
          continue;
        }
        if (escape === undefined || !/^["\\/bfnrt]$/u.test(escape)) {
          fail("contains an invalid escape");
        }
        index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        fail("contains an unescaped control character");
      }
      index += 1;
    }
    return fail("contains an unterminated string");
  };
  const parseNumberToken = (): void => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index));
    if (match === null) return fail("contains an invalid number");
    index += match[0].length;
  };
  const prohibitedKeys = new Set(["__proto__", "constructor", "prototype"]);
  const parseValue = (depth: number): void => {
    if (depth > MAX_JSON_DEPTH) fail("exceeds the maximum nesting depth");
    skipWhitespace();
    const character = text[index];
    if (character === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      for (;;) {
        skipWhitespace();
        const key = parseStringToken();
        if (keys.has(key)) fail(`contains duplicate object key ${JSON.stringify(key)}`);
        if (prohibitedKeys.has(key)) fail(`contains prohibited object key ${JSON.stringify(key)}`);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") fail("is missing a colon after an object key");
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        if (text[index] !== ",") fail("is missing a comma between object members");
        index += 1;
      }
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      for (;;) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        if (text[index] !== ",") fail("is missing a comma between array elements");
        index += 1;
      }
    }
    if (character === '"') {
      parseStringToken();
      return;
    }
    if (character === "-" || (character !== undefined && /^[0-9]$/u.test(character))) {
      parseNumberToken();
      return;
    }
    for (const literal of ["true", "false", "null"] as const) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    fail("contains an invalid value");
  };

  parseValue(0);
  skipWhitespace();
  if (index !== text.length) fail("contains trailing data");
  return text;
}

async function readStableBoundedFile(
  path: string,
  expected: ExpectedRegularFileIdentity,
  maxBytes: number,
): Promise<Buffer> {
  if (expected.size > maxBytes) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_FILE_TOO_LARGE",
      `Candidate file exceeds its bounded parser limit: ${path}`,
    );
  }
  const pathBeforeOpen = await lstat(path);
  if (
    pathBeforeOpen.isSymbolicLink() ||
    !pathBeforeOpen.isFile() ||
    pathBeforeOpen.nlink !== 1 ||
    !sameIdentity(identityFromStat(pathBeforeOpen), expected)
  ) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_FILE_CHANGED",
      `Candidate path changed before bounded open: ${path}`,
    );
  }
  const handle = await open(path, "r");
  try {
    const before = identityFromStat(await handle.stat());
    if (!sameIdentity(before, expected)) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_FILE_CHANGED",
        `Candidate file changed before bounded read: ${path}`,
      );
    }
    const pathAfterOpen = await lstat(path);
    if (
      pathAfterOpen.isSymbolicLink() ||
      !pathAfterOpen.isFile() ||
      pathAfterOpen.nlink !== 1 ||
      !sameIdentity(identityFromStat(pathAfterOpen), before)
    ) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_FILE_CHANGED",
        `Candidate path changed after bounded open: ${path}`,
      );
    }
    const bytes = await handle.readFile();
    const after = identityFromStat(await handle.stat());
    if (!sameIdentity(before, after) || bytes.length !== after.size) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_FILE_CHANGED",
        `Candidate file changed during bounded read: ${path}`,
      );
    }
    const pathAfterRead = await lstat(path);
    if (
      pathAfterRead.isSymbolicLink() ||
      !pathAfterRead.isFile() ||
      pathAfterRead.nlink !== 1 ||
      !sameIdentity(identityFromStat(pathAfterRead), after)
    ) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_FILE_CHANGED",
        `Candidate path changed after bounded read: ${path}`,
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseJsonBytes<T>(bytes: Buffer, schema: z.ZodType<T>, label: string): T {
  let value: unknown;
  try {
    value = JSON.parse(decodeAndValidateJson(bytes, label));
  } catch (error: unknown) {
    if (error instanceof FoundryIntegrityError) throw error;
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_JSON_INVALID",
      `${label} is not valid JSON.`,
      { cause: error },
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_SCHEMA_INVALID",
      `${label} does not satisfy the D-014 candidate contract: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

function parseTrainingMetrics(bytes: Buffer, maxSteps: number): {
  readonly metricRows: number;
  readonly finalMetricStep: number;
  readonly finalEvaluation: {
    readonly psnr?: number;
    readonly ssim?: number;
    readonly lpips?: number;
  };
} {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new FoundryIntegrityError(
      "TRAINING_METRICS_ENCODING_INVALID",
      "training_metrics.jsonl must not contain a byte-order mark.",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    throw new FoundryIntegrityError(
      "TRAINING_METRICS_ENCODING_INVALID",
      "training_metrics.jsonl must be valid UTF-8 without replacement bytes.",
      { cause: error },
    );
  }
  if (text.charCodeAt(0) === 0xfeff) {
    throw new FoundryIntegrityError(
      "TRAINING_METRICS_ENCODING_INVALID",
      "training_metrics.jsonl must not contain a byte-order mark.",
    );
  }
  const rawLines = text.split("\n");
  if (rawLines.at(-1) === "") rawLines.pop();
  if (rawLines.length === 0 || rawLines.length > MAX_METRICS_LINES) {
    throw new FoundryIntegrityError(
      "TRAINING_METRICS_ROW_COUNT_INVALID",
      "training_metrics.jsonl must contain a bounded non-empty metric history.",
    );
  }
  let priorStep = 0;
  let finalEvaluation: { psnr?: number; ssim?: number; lpips?: number } = {};
  for (const [index, rawLine] of rawLines.entries()) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0 || Buffer.byteLength(line, "utf8") > MAX_METRICS_LINE_BYTES) {
      throw new FoundryIntegrityError(
        "TRAINING_METRICS_LINE_INVALID",
        `Metric row ${String(index + 1)} is blank or exceeds the bounded line size.`,
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(decodeAndValidateJson(
        Buffer.from(line, "utf8"),
        `training_metrics.jsonl row ${String(index + 1)}`,
      ));
    } catch (error: unknown) {
      if (error instanceof FoundryIntegrityError) throw error;
      throw new FoundryIntegrityError(
        "TRAINING_METRICS_JSON_INVALID",
        `Metric row ${String(index + 1)} is not valid JSON.`,
        { cause: error },
      );
    }
    const row = MetricLineSchema.safeParse(value);
    if (!row.success) {
      throw new FoundryIntegrityError(
        "TRAINING_METRICS_SCHEMA_INVALID",
        `Metric row ${String(index + 1)} is invalid: ${row.error.issues[0]?.message ?? "invalid"}`,
      );
    }
    if (row.data.step <= priorStep || row.data.step > maxSteps) {
      throw new FoundryIntegrityError(
        "TRAINING_METRICS_STEP_INVALID",
        `Metric row ${String(index + 1)} must have a strictly increasing step no greater than max_steps.`,
      );
    }
    priorStep = row.data.step;
    finalEvaluation = {
      ...(row.data.eval_psnr === undefined ? {} : { psnr: row.data.eval_psnr }),
      ...(row.data.eval_ssim === undefined ? {} : { ssim: row.data.eval_ssim }),
      ...(row.data.eval_lpips === undefined ? {} : { lpips: row.data.eval_lpips }),
    };
  }
  if (priorStep !== maxSteps) {
    throw new FoundryIntegrityError(
      "TRAINING_METRICS_INCOMPLETE",
      "The final recorded training metric step must equal training_config.max_steps.",
    );
  }
  return { metricRows: rawLines.length, finalMetricStep: priorStep, finalEvaluation };
}

function gaussianPropertyOrder(shDegree: number): readonly string[] {
  const restCount = 3 * ((shDegree + 1) ** 2 - 1);
  return [
    "x",
    "y",
    "z",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    ...Array.from({ length: restCount }, (_unused, index) => `f_rest_${String(index)}`),
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ];
}

interface GaussianPlyLayout {
  readonly vertexCount: number;
  readonly headerBytes: number;
  readonly vertexStrideBytes: number;
  readonly quaternionOffsetBytes: number;
}

function inspectGaussianPlyHead(
  head: Uint8Array,
  totalSizeBytes: number,
  shDegree: number,
  capMax: number,
): GaussianPlyLayout {
  const marker = Buffer.from("end_header\n", "ascii");
  const windowsMarker = Buffer.from("end_header\r\n", "ascii");
  const buffer = Buffer.from(head);
  const unixEnd = buffer.indexOf(marker);
  const windowsEnd = buffer.indexOf(windowsMarker);
  const useWindowsMarker = windowsEnd >= 0 && (unixEnd < 0 || windowsEnd < unixEnd);
  const end = useWindowsMarker ? windowsEnd : unixEnd;
  const markerBytes = useWindowsMarker ? windowsMarker.length : marker.length;
  if (end < 0 || end + markerBytes > PLY_HEAD_BYTES) {
    throw new FoundryIntegrityError(
      "TRAINING_SCENE_PLY_HEADER_INVALID",
      "scene.ply must have a complete bounded PLY header.",
    );
  }
  const headerBytes = end + markerBytes;
  const header = buffer.subarray(0, headerBytes).toString("ascii");
  const lines = header.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.at(-1) !== "end_header") {
    throw new FoundryIntegrityError(
      "TRAINING_SCENE_PLY_HEADER_INVALID",
      "scene.ply must terminate its header with an exact standalone end_header line.",
    );
  }
  if (lines[0] !== "ply" || lines[1] !== "format binary_little_endian 1.0") {
    throw new FoundryIntegrityError(
      "TRAINING_SCENE_PLY_FORMAT_INVALID",
      "scene.ply must be PLY binary_little_endian 1.0.",
    );
  }
  let vertexCount: number | null = null;
  let currentElement: string | null = null;
  const properties: Array<{ readonly name: string; readonly type: string }> = [];
  for (const line of lines.slice(2)) {
    if (line === "end_header") break;
    if (line.startsWith("comment ") || line.startsWith("obj_info ")) continue;
    const element = /^element ([A-Za-z0-9_]+) (\d+)$/u.exec(line);
    if (element !== null) {
      currentElement = element[1] ?? null;
      if (currentElement !== "vertex" || vertexCount !== null) {
        throw new FoundryIntegrityError(
          "TRAINING_SCENE_PLY_ELEMENT_INVALID",
          "scene.ply must contain one vertex element and no mesh/list elements.",
        );
      }
      vertexCount = Number(element[2]);
      continue;
    }
    if (line.startsWith("property list ")) {
      throw new FoundryIntegrityError(
        "TRAINING_SCENE_PLY_PROPERTY_INVALID",
        "scene.ply cannot contain variable-length list properties.",
      );
    }
    const property = /^property ([A-Za-z0-9_]+) ([A-Za-z0-9_]+)$/u.exec(line);
    if (property !== null) {
      if (currentElement !== "vertex") {
        throw new FoundryIntegrityError(
          "TRAINING_SCENE_PLY_PROPERTY_INVALID",
          "Every scene.ply property must belong to the vertex element.",
        );
      }
      const type = property[1] ?? "";
      const name = property[2] ?? "";
      if (
        (type !== "float" && type !== "float32") ||
        properties.some((candidate) => candidate.name === name)
      ) {
        throw new FoundryIntegrityError(
          "TRAINING_SCENE_PLY_PROPERTY_INVALID",
          "scene.ply properties must be unique float32 scalar values.",
        );
      }
      properties.push({ name, type });
      continue;
    }
    throw new FoundryIntegrityError(
      "TRAINING_SCENE_PLY_HEADER_INVALID",
      `scene.ply contains an unsupported header declaration: ${line}.`,
    );
  }
  if (
    vertexCount === null ||
    !Number.isSafeInteger(vertexCount) ||
    vertexCount <= 0 ||
    vertexCount > Math.min(MAX_PLY_VERTICES, capMax)
  ) {
    throw new FoundryIntegrityError(
      "TRAINING_SCENE_PLY_VERTEX_COUNT_INVALID",
      "scene.ply vertex count must be positive and no greater than both the verifier cap and strategy.cap_max.",
    );
  }
  const expectedProperties = gaussianPropertyOrder(shDegree);
  const observedProperties = properties.map((property) => property.name);
  if (
    observedProperties.length !== expectedProperties.length ||
    observedProperties.some((property, index) => property !== expectedProperties[index])
  ) {
    throw new FoundryIntegrityError(
      "TRAINING_SCENE_PLY_PROPERTIES_INVALID",
      `scene.ply must use the exact gsplat float32 property order for sh_degree=${String(shDegree)}.`,
    );
  }
  const vertexStrideBytes = expectedProperties.length * 4;
  const expectedSize = headerBytes + vertexCount * vertexStrideBytes;
  if (!Number.isSafeInteger(expectedSize) || expectedSize !== totalSizeBytes) {
    throw new FoundryIntegrityError(
      "TRAINING_SCENE_PLY_PAYLOAD_SIZE_INVALID",
      "scene.ply payload size must exactly match vertex count and fixed property stride.",
    );
  }
  return {
    vertexCount,
    headerBytes,
    vertexStrideBytes,
    quaternionOffsetBytes: expectedProperties.indexOf("rot_0") * 4,
  };
}

async function validateGaussianPlyPayload(
  path: string,
  expectedIdentity: ExpectedRegularFileIdentity,
  layout: GaussianPlyLayout,
): Promise<void> {
  const handle = await open(path, "r");
  try {
    const before = identityFromStat(await handle.stat());
    if (!sameIdentity(before, expectedIdentity)) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_FILE_CHANGED",
        "scene.ply changed before payload validation.",
      );
    }
    const targetBufferBytes = 8 * 1024 * 1024;
    const verticesPerChunk = Math.max(1, Math.floor(targetBufferBytes / layout.vertexStrideBytes));
    const buffer = Buffer.allocUnsafe(verticesPerChunk * layout.vertexStrideBytes);
    let position = layout.headerBytes;
    let verticesRead = 0;
    while (verticesRead < layout.vertexCount) {
      const verticesThisChunk = Math.min(verticesPerChunk, layout.vertexCount - verticesRead);
      const bytesThisChunk = verticesThisChunk * layout.vertexStrideBytes;
      let filled = 0;
      while (filled < bytesThisChunk) {
        const result = await handle.read(
          buffer,
          filled,
          bytesThisChunk - filled,
          position + filled,
        );
        if (result.bytesRead === 0) {
          throw new FoundryIntegrityError(
            "TRAINING_SCENE_PLY_PAYLOAD_TRUNCATED",
            "scene.ply ended before its declared vertex payload.",
          );
        }
        filled += result.bytesRead;
      }
      for (let vertexOffset = 0; vertexOffset < bytesThisChunk; vertexOffset += layout.vertexStrideBytes) {
        for (let floatOffset = 0; floatOffset < layout.vertexStrideBytes; floatOffset += 4) {
          if (!Number.isFinite(buffer.readFloatLE(vertexOffset + floatOffset))) {
            throw new FoundryIntegrityError(
              "TRAINING_SCENE_PLY_NONFINITE_VALUE",
              "scene.ply contains a non-finite Gaussian value.",
            );
          }
        }
        let quaternionNormSquared = 0;
        for (let component = 0; component < 4; component += 1) {
          const value = buffer.readFloatLE(
            vertexOffset + layout.quaternionOffsetBytes + component * 4,
          );
          quaternionNormSquared += value * value;
        }
        if (quaternionNormSquared <= 1e-20) {
          throw new FoundryIntegrityError(
            "TRAINING_SCENE_PLY_QUATERNION_INVALID",
            "scene.ply contains a zero-length Gaussian rotation quaternion.",
          );
        }
      }
      position += bytesThisChunk;
      verticesRead += verticesThisChunk;
    }
    const after = identityFromStat(await handle.stat());
    if (!sameIdentity(before, after) || position !== after.size) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_FILE_CHANGED",
        "scene.ply changed during payload validation.",
      );
    }
  } finally {
    await handle.close();
  }
}

function maxBytesFor(name: (typeof ALLOWED_ROOT_FILES)[number]): number {
  if (name === "scene.ply") return MAX_SCENE_BYTES;
  if (name === "training_metrics.jsonl") return MAX_METRICS_BYTES;
  if (name === "bilateral_grid.bin") return MAX_BILATERAL_GRID_BYTES;
  return MAX_JSON_BYTES;
}

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertExactRootFiles(paths: readonly string[]): void {
  if (paths.some((path) => path.includes("/"))) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_NESTED_ENTRY",
      "A D-014 training candidate must contain only its exact top-level contract files.",
    );
  }
  const sorted = [...paths].sort(compareCodePoints);
  const allowed = new Set<string>(ALLOWED_ROOT_FILES);
  if (sorted.some((path) => !allowed.has(path))) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_UNEXPECTED_FILE",
      `Unexpected D-014 candidate file: ${sorted.find((path) => !allowed.has(path)) ?? "unknown"}.`,
    );
  }
  for (const required of [...REQUIRED_CONTENT_FILES, "manifest.json"] as const) {
    if (!sorted.includes(required)) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_MISSING_FILE",
        `D-014 candidate is missing required file: ${required}.`,
      );
    }
  }
}

export async function verifyTrainingCandidateBundle(input: {
  readonly bundleRoot: string;
  readonly expectedVenueId: string;
  readonly expectedRunId: string;
}): Promise<TrainingCandidateVerificationV0> {
  const expectedVenueId = VenueIdSchema.parse(input.expectedVenueId);
  const expectedRunId = RunIdSchema.parse(input.expectedRunId);
  const root = await canonicalBundleRoot(input.bundleRoot);
  if (basename(root) !== expectedRunId) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_ROOT_NAME_MISMATCH",
      "The extracted D-014 bundle root basename must equal the expected run_id.",
    );
  }
  const files = await listSafeBundleFiles(root);
  assertExactRootFiles(files.map((file) => file.relativePath));

  const identities = new Map<string, ExpectedRegularFileIdentity>();
  let discoveredTotal = 0;
  for (const file of files) {
    const handle = await open(file.absolutePath, "r");
    try {
      const metadata = await handle.stat();
      if (metadata.nlink !== 1) {
        throw new FoundryIntegrityError(
          "TRAINING_CANDIDATE_HARDLINK",
          `Candidate files must not have additional hard links: ${file.relativePath}.`,
        );
      }
      const identity = identityFromStat(metadata);
      const name = file.relativePath as (typeof ALLOWED_ROOT_FILES)[number];
      if (identity.size > maxBytesFor(name)) {
        throw new FoundryIntegrityError(
          "TRAINING_CANDIDATE_FILE_TOO_LARGE",
          `Candidate file exceeds its contract limit: ${name}.`,
        );
      }
      identities.set(name, identity);
      if (name !== "manifest.json") discoveredTotal += identity.size;
    } finally {
      await handle.close();
    }
  }
  if (!Number.isSafeInteger(discoveredTotal) || discoveredTotal > MAX_TOTAL_CONTENT_BYTES) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_TOTAL_TOO_LARGE",
      "Candidate bundle exceeds the D-014 verification byte budget.",
    );
  }

  const byName = new Map(files.map((file) => [file.relativePath, file.absolutePath]));
  const pathFor = (name: string): string => {
    const path = byName.get(name);
    if (path === undefined) {
      throw new FoundryIntegrityError("TRAINING_CANDIDATE_MISSING_FILE", `Missing candidate file: ${name}.`);
    }
    return path;
  };
  const identityFor = (name: string): ExpectedRegularFileIdentity => {
    const identity = identities.get(name);
    if (identity === undefined) {
      throw new FoundryIntegrityError("TRAINING_CANDIDATE_MISSING_FILE", `Missing candidate identity: ${name}.`);
    }
    return identity;
  };

  const manifestBytes = await readStableBoundedFile(
    pathFor("manifest.json"),
    identityFor("manifest.json"),
    MAX_JSON_BYTES,
  );
  const manifest = parseJsonBytes(manifestBytes, TrainingCandidateManifestV0Schema, "manifest.json");
  if (manifest.venue_id !== expectedVenueId || manifest.run_id !== expectedRunId) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_IDENTITY_MISMATCH",
      "Candidate manifest venue_id/run_id does not match the expected control-plane identity.",
    );
  }
  const actualContentNames = files
    .map((file) => file.relativePath)
    .filter((name) => name !== "manifest.json")
    .sort(compareCodePoints);
  const manifestContentNames = manifest.files.map((file) => file.name);
  if (
    actualContentNames.length !== manifestContentNames.length ||
    actualContentNames.some((name, index) => name !== manifestContentNames[index])
  ) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_MANIFEST_FILE_SET_MISMATCH",
      "Candidate root and manifest must account for the exact same content files.",
    );
  }

  const verifiedFiles: Array<z.infer<typeof VerifiedTrainingCandidateFileSchema>> = [{
    name: "manifest.json",
    sizeBytes: manifestBytes.length,
    sha256: `sha256:${rawSha256(manifestBytes)}`,
  }];
  let sceneHead: Uint8Array | null = null;
  for (const entry of manifest.files) {
    const digest = await sha256RegularFileWithHead(
      pathFor(entry.name),
      entry.name === "scene.ply" ? PLY_HEAD_BYTES : 0,
      identityFor(entry.name),
    );
    if (digest.sizeBytes !== entry.size || digest.sha256 !== entry.sha256) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_DIGEST_MISMATCH",
        `Candidate size/hash does not match manifest.json: ${entry.name}.`,
      );
    }
    if (entry.name === "scene.ply") sceneHead = digest.headBytes;
    verifiedFiles.push({
      name: entry.name,
      sizeBytes: entry.size,
      sha256: `sha256:${entry.sha256}`,
    });
  }
  verifiedFiles.sort((left, right) => compareCodePoints(left.name, right.name));

  const jsonEntry = async <T>(name: string, schema: z.ZodType<T>): Promise<T> => {
    const manifestEntry = manifest.files.find((entry) => entry.name === name);
    if (manifestEntry === undefined) {
      throw new FoundryIntegrityError("TRAINING_CANDIDATE_MISSING_FILE", `Missing manifest entry: ${name}.`);
    }
    const bytes = await readStableBoundedFile(pathFor(name), identityFor(name), maxBytesFor(name as never));
    if (bytes.length !== manifestEntry.size || rawSha256(bytes) !== manifestEntry.sha256) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_FILE_CHANGED",
        `Candidate file changed after manifest verification: ${name}.`,
      );
    }
    return parseJsonBytes(bytes, schema, name);
  };

  const trainingConfig = await jsonEntry("training_config.json", TrainingConfigSchema);
  const evaluation = await jsonEntry("eval_holdout.json", EvalHoldoutSchema);
  const hardware = await jsonEntry("hardware.json", HardwareSchema);
  await jsonEntry("git_state.json", GitStateSchema);
  await jsonEntry("colmap_input.json", ColmapInputSchema);

  const metricsEntry = manifest.files.find((entry) => entry.name === "training_metrics.jsonl");
  if (metricsEntry === undefined) {
    throw new FoundryIntegrityError("TRAINING_CANDIDATE_MISSING_FILE", "Missing training metrics manifest entry.");
  }
  const metricsBytes = await readStableBoundedFile(
    pathFor("training_metrics.jsonl"),
    identityFor("training_metrics.jsonl"),
    MAX_METRICS_BYTES,
  );
  if (rawSha256(metricsBytes) !== metricsEntry.sha256 || metricsBytes.length !== metricsEntry.size) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_FILE_CHANGED",
      "training_metrics.jsonl changed after manifest verification.",
    );
  }
  const metrics = parseTrainingMetrics(metricsBytes, trainingConfig.max_steps);

  const mean = (values: readonly number[]): number => {
    let sum = 0;
    let compensation = 0;
    for (const value of values) {
      const corrected = value - compensation;
      const next = sum + corrected;
      compensation = (next - sum) - corrected;
      sum = next;
    }
    const result = sum / values.length;
    if (!Number.isFinite(result)) {
      throw new FoundryIntegrityError(
        "TRAINING_EVALUATION_MEAN_INVALID",
        "Held-out metric arithmetic produced a non-finite mean.",
      );
    }
    return result;
  };
  const near = (left: number, right: number): boolean =>
    Math.abs(left - right) <= 0.005 * Math.max(1, Math.abs(left), Math.abs(right));
  const heldOutMeans = {
    psnr: mean(evaluation.per_image.map((image) => image.psnr)),
    ssim: mean(evaluation.per_image.map((image) => image.ssim)),
    lpips: mean(evaluation.per_image.map((image) => image.lpips)),
  };
  if (
    !near(heldOutMeans.psnr, evaluation.summary.psnr) ||
    !near(heldOutMeans.ssim, evaluation.summary.ssim) ||
    !near(heldOutMeans.lpips, evaluation.summary.lpips)
  ) {
    throw new FoundryIntegrityError(
      "TRAINING_EVALUATION_SUMMARY_MISMATCH",
      "eval_holdout summary metrics must match the declared per-image arithmetic means.",
    );
  }
  for (const metric of ["psnr", "ssim", "lpips"] as const) {
    const finalMetric = metrics.finalEvaluation[metric];
    if (finalMetric !== undefined && !near(finalMetric, evaluation.summary[metric])) {
      throw new FoundryIntegrityError(
        "TRAINING_EVALUATION_METRICS_MISMATCH",
        `The final eval_${metric} metric must agree with eval_holdout.json.`,
      );
    }
  }
  if (evaluation.device.toLocaleLowerCase("en-US") !== "cuda" || evaluation.torch_version !== hardware.torch) {
    throw new FoundryIntegrityError(
      "TRAINING_EVALUATION_ENVIRONMENT_MISMATCH",
      "eval_holdout must record CUDA and the exact torch version captured in hardware.json.",
    );
  }
  const expectedPodId = expectedRunId.slice("YYYYMMDDTHHMMSSZ-".length);
  if (
    hardware.pod_id !== expectedPodId ||
    hardware.trainer_image !== trainingConfig.trainer_image
  ) {
    throw new FoundryIntegrityError(
      "TRAINING_HARDWARE_PROVENANCE_MISMATCH",
      "hardware pod_id and trainer image must exactly match run_id and training_config.json.",
    );
  }

  if (sceneHead === null) {
    throw new FoundryIntegrityError("TRAINING_CANDIDATE_MISSING_FILE", "Missing scene.ply inspection bytes.");
  }
  const sceneEntry = manifest.files.find((entry) => entry.name === "scene.ply");
  if (sceneEntry === undefined) {
    throw new FoundryIntegrityError("TRAINING_CANDIDATE_MISSING_FILE", "Missing scene.ply manifest entry.");
  }
  const gaussianLayout = inspectGaussianPlyHead(
    sceneHead,
    sceneEntry.size,
    trainingConfig.sh_degree,
    trainingConfig.strategy.cap_max,
  );
  await validateGaussianPlyPayload(
    pathFor("scene.ply"),
    identityFor("scene.ply"),
    gaussianLayout,
  );
  const gaussianVertexCount = gaussianLayout.vertexCount;

  const hasGrid = manifest.files.some((entry) => entry.name === "bilateral_grid.bin");
  if (hasGrid || trainingConfig.post_processing === "bilateral_grid") {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_BILATERAL_GRID_UNVERIFIABLE",
      "D-014 does not yet specify bilateral-grid view count, channels, layout, dtype, endian, and serialization; grid candidates cannot be verified.",
    );
  }

  const finalRoot = await canonicalBundleRoot(root);
  if (finalRoot !== root) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_ROOT_CHANGED",
      "Candidate root identity changed during verification.",
    );
  }
  const finalFiles = await listSafeBundleFiles(finalRoot);
  assertExactRootFiles(finalFiles.map((file) => file.relativePath));
  const expectedFinalFiles = new Map<string, z.infer<typeof VerifiedTrainingCandidateFileSchema>>(
    verifiedFiles.map((file) => [file.name, file]),
  );
  if (
    finalFiles.length !== expectedFinalFiles.size ||
    finalFiles.some((file) => !expectedFinalFiles.has(file.relativePath))
  ) {
    throw new FoundryIntegrityError(
      "TRAINING_CANDIDATE_TREE_CHANGED",
      "Candidate file set changed during verification.",
    );
  }
  for (const file of finalFiles) {
    const expected = expectedFinalFiles.get(file.relativePath);
    if (expected === undefined) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_TREE_CHANGED",
        `Candidate gained an unverified file: ${file.relativePath}.`,
      );
    }
    const digest = await sha256RegularFileWithHead(
      file.absolutePath,
      0,
      identityFor(file.relativePath),
    );
    if (
      digest.sizeBytes !== expected.sizeBytes ||
      `sha256:${digest.sha256}` !== expected.sha256
    ) {
      throw new FoundryIntegrityError(
        "TRAINING_CANDIDATE_TREE_CHANGED",
        `Candidate changed during final reinspection: ${file.relativePath}.`,
      );
    }
  }

  const contentFiles = verifiedFiles.filter((file) => file.name !== "manifest.json");
  const contentSetSha256 = `sha256:${domainSeparatedSha256(
    DIGEST_DOMAIN.contentSet,
    toCanonicalJson(contentFiles),
  )}`;
  const material = TrainingCandidateVerificationMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_TRAINING_CANDIDATE_VERIFICATION_V0,
    manifestSchemaVersion: VENVIEWER_ASSET_BUNDLE_V0,
    venueId: manifest.venue_id,
    runId: manifest.run_id,
    manifestSha256: `sha256:${rawSha256(manifestBytes)}`,
    contentSetSha256,
    files: verifiedFiles,
    totalContentSizeBytes: manifest.total_size,
    metricRows: metrics.metricRows,
    finalMetricStep: metrics.finalMetricStep,
    gaussianVertexCount,
    checks: TRAINING_CANDIDATE_CHECKS,
    trustStatus: "untrusted_candidate_verified",
    releaseEligibility: "blocked_missing_control_bindings_and_signature",
    blockers: TRAINING_CANDIDATE_BLOCKERS,
    controlBindings: {
      ingestManifest: "missing_from_legacy_d014_v0",
      jobSpec: "missing_from_legacy_d014_v0",
      providerPlan: "missing_from_legacy_d014_v0",
      attemptLedger: "missing_from_legacy_d014_v0",
      qualityContract: "missing_from_legacy_d014_v0",
    },
    outcome: "valid_untrusted_training_candidate",
    authority: "none",
    capabilities: {
      localVerification: "completed_verified",
      execution: "not_authorized",
      cloudDispatch: "not_authorized",
      modelTraining: "not_authorized",
      objectStoreMutation: "not_authorized",
      qualityApproval: "not_authorized",
      humanReview: "required",
      signing: "not_authorized",
      evidenceRegistration: "not_authorized",
      assetVersionRegistration: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
      runtimeConsumption: "not_authorized",
    },
  });
  return TrainingCandidateVerificationV0Schema.parse({
    ...material,
    verificationSha256: computeTrainingCandidateVerificationSha256(material),
  });
}

export function canonicalTrainingCandidateVerificationJson(
  verification: TrainingCandidateVerificationV0,
): string {
  return `${stableCanonicalJson(toCanonicalJson(TrainingCandidateVerificationV0Schema.parse(verification)))}\n`;
}

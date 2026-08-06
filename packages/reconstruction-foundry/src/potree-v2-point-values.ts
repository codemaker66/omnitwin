import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { zlibSync } from "fflate";
import { z } from "zod";
import {
  FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES,
  FOUNDRY_POTREE_V2_POINT_RECORD_BYTES,
} from "./potree-v2-source-facts.js";
import {
  FoundryPotreeV2BundleAssetV7Schema,
  type FoundryPotreeV2BundleAssetV7,
} from "./source-facts-v7.js";

export const FOUNDRY_POTREE_V2_POINT_VALUES_OCTREE_MAX_BYTES = 64 * 1024 * 1024;
export const FOUNDRY_POTREE_V2_POINT_VALUES_POINT_MAX_COUNT = 4_000_000;
export const FOUNDRY_POTREE_V2_POINT_VALUES_DEEP_PROFILE_MAX_COUNT = 500_000;
export const FOUNDRY_POTREE_V2_POINT_VALUES_TIME_MAX_MS = 30_000;
export const FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH = 1024;
export const FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT = 1024;
export const FOUNDRY_POTREE_V2_POINT_PREVIEW_MARGIN = 32;
export const FOUNDRY_POTREE_V2_POINT_PREVIEW_PROFILE =
  "deterministic_cpu_triplanar_rgba_png_fflate_0_8_2_v1";

export const FOUNDRY_POTREE_V2_POINT_PREVIEW_VIEW_IDS = Object.freeze([
  "position_0_1",
  "position_0_2",
  "position_1_2",
] as const);
export const FOUNDRY_POTREE_V2_POINT_PREVIEW_MODES = Object.freeze([
  "omitted_component",
  "intensity_byte",
  "opaque_vendor_byte",
  "record_density",
] as const);
export const FOUNDRY_POTREE_V2_POINT_VALUE_QUALITY_WARNINGS = Object.freeze([
  "exact_position_duplicate_concentration_observed",
] as const);

type PreviewViewId =
  (typeof FOUNDRY_POTREE_V2_POINT_PREVIEW_VIEW_IDS)[number];
type PreviewMode =
  (typeof FOUNDRY_POTREE_V2_POINT_PREVIEW_MODES)[number];

const PREVIEW_VIEW_SPECS = Object.freeze([
  {
    viewId: "position_0_1",
    projectedAxes: [0, 1] as const,
    omittedAxis: 2 as const,
  },
  {
    viewId: "position_0_2",
    projectedAxes: [0, 2] as const,
    omittedAxis: 1 as const,
  },
  {
    viewId: "position_1_2",
    projectedAxes: [1, 2] as const,
    omittedAxis: 0 as const,
  },
] as const);

const PREVIEW_COLOR_MAP_BY_MODE = Object.freeze({
  omitted_component: "fixed_viridis_anchors_v1",
  intensity_byte: "raw_uint8_grayscale_v1",
  opaque_vendor_byte: "opaque_uint8_viridis_anchors_v1",
  record_density: "log_record_density_inferno_anchors_v1",
} as const satisfies Readonly<Record<PreviewMode, string>>);

const DUPLICATE_CONCENTRATION_RATE = 0.01;

function previewFileName(viewId: PreviewViewId, mode: PreviewMode): string {
  return `potree-v2-${viewId}-${mode}.png`;
}

export const FOUNDRY_POTREE_V2_POINT_VALUE_FAILURE_CODES = Object.freeze([
  "POTREE_V2_POINT_VALUES_BUNDLE_INVALID",
  "POTREE_V2_POINT_VALUES_V7_INSPECTION_NOT_ESTABLISHED",
  "POTREE_V2_POINT_VALUES_MEMBER_IDENTITY_MISMATCH",
  "POTREE_V2_POINT_VALUES_OCTREE_SIZE_LIMIT_EXCEEDED",
  "POTREE_V2_POINT_VALUES_POINT_COUNT_LIMIT_EXCEEDED",
  "POTREE_V2_POINT_VALUES_TIME_LIMIT_EXCEEDED",
  "POTREE_V2_POINT_VALUES_HIERARCHY_INVALID",
  "POTREE_V2_POINT_VALUES_NODE_BOUNDS_VIOLATION",
  "POTREE_V2_POINT_VALUES_DECLARED_RANGE_VIOLATION",
  "POTREE_V2_POINT_VALUES_PREVIEW_ENCODING_FAILED",
  "POTREE_V2_POINT_VALUES_INSPECTION_FAILED",
] as const);
export type FoundryPotreeV2PointValueFailureCode =
  (typeof FOUNDRY_POTREE_V2_POINT_VALUE_FAILURE_CODES)[number];
export type FoundryPotreeV2PointValueFailureCategory =
  | "resource_limit"
  | "parse_failure"
  | "validation_failure";

export const FOUNDRY_POTREE_V2_POINT_VALUE_FAILURE_CATEGORY_BY_CODE =
  Object.freeze({
    POTREE_V2_POINT_VALUES_BUNDLE_INVALID: "validation_failure",
    POTREE_V2_POINT_VALUES_V7_INSPECTION_NOT_ESTABLISHED: "validation_failure",
    POTREE_V2_POINT_VALUES_MEMBER_IDENTITY_MISMATCH: "validation_failure",
    POTREE_V2_POINT_VALUES_OCTREE_SIZE_LIMIT_EXCEEDED: "resource_limit",
    POTREE_V2_POINT_VALUES_POINT_COUNT_LIMIT_EXCEEDED: "resource_limit",
    POTREE_V2_POINT_VALUES_TIME_LIMIT_EXCEEDED: "resource_limit",
    POTREE_V2_POINT_VALUES_HIERARCHY_INVALID: "parse_failure",
    POTREE_V2_POINT_VALUES_NODE_BOUNDS_VIOLATION: "validation_failure",
    POTREE_V2_POINT_VALUES_DECLARED_RANGE_VIOLATION: "validation_failure",
    POTREE_V2_POINT_VALUES_PREVIEW_ENCODING_FAILED: "parse_failure",
    POTREE_V2_POINT_VALUES_INSPECTION_FAILED: "parse_failure",
  } as const satisfies Readonly<Record<
    FoundryPotreeV2PointValueFailureCode,
    FoundryPotreeV2PointValueFailureCategory
  >>);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const Int32Schema = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const Vec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const NonnegativeVec3Schema = z.tuple([
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
]);
const IntVec3Schema = z.tuple([
  Int32Schema,
  Int32Schema,
  Int32Schema,
]);
const HistogramSchema = z.array(z.number().int().safe().nonnegative()).length(256);
const QuantileValuesSchema = z.tuple([
  z.number().finite(), z.number().finite(), z.number().finite(),
  z.number().finite(), z.number().finite(), z.number().finite(),
  z.number().finite(),
]);
const QuantilesByAxisSchema = z.tuple([
  QuantileValuesSchema,
  QuantileValuesSchema,
  QuantileValuesSchema,
]);
const RawQuantileValuesSchema = z.tuple([
  Int32Schema, Int32Schema, Int32Schema, Int32Schema,
  Int32Schema, Int32Schema, Int32Schema,
]);
const RawQuantilesByAxisSchema = z.tuple([
  RawQuantileValuesSchema,
  RawQuantileValuesSchema,
  RawQuantileValuesSchema,
]);

const PreviewViewIdSchema = z.enum(FOUNDRY_POTREE_V2_POINT_PREVIEW_VIEW_IDS);
const PreviewModeSchema = z.enum(FOUNDRY_POTREE_V2_POINT_PREVIEW_MODES);
const AxisSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

const PreviewImageManifestSchema = z.object({
  bundleSha256: z.string().regex(SHA256_HEX),
  viewId: PreviewViewIdSchema,
  mode: PreviewModeSchema,
  fileName: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,159}\.png$/u),
  mediaType: z.literal("image/png"),
  width: z.literal(FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH),
  height: z.literal(FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT),
  marginPixels: z.literal(FOUNDRY_POTREE_V2_POINT_PREVIEW_MARGIN),
  projectedAxes: z.tuple([AxisSchema, AxisSchema]),
  omittedAxis: AxisSchema,
  fit: z.literal("observed_extrema_uniform_no_crop"),
  cameraDirection: z.literal("positive_omitted_component"),
  frontmostRule: z.literal("maximum_omitted_component"),
  tieBreakRule: z.literal("lowest_record_ordinal"),
  colorMap: z.enum([
    "fixed_viridis_anchors_v1",
    "raw_uint8_grayscale_v1",
    "opaque_uint8_viridis_anchors_v1",
    "log_record_density_inferno_anchors_v1",
  ]),
  occupiedPixelCount: z.number().int().safe().positive(),
  maxRecordsPerPixel: z.number().int().safe().positive(),
  pixelSha256: z.string().regex(SHA256_HEX),
  byteLength: z.number().int().safe().positive(),
  sha256: z.string().regex(SHA256_HEX),
}).strict();

export const FoundryPotreeV2PointPreviewManifestSchema = z.object({
  profile: z.literal(FOUNDRY_POTREE_V2_POINT_PREVIEW_PROFILE),
  imageCount: z.literal(12),
  images: z.array(PreviewImageManifestSchema).length(12),
}).strict().superRefine((manifest, ctx) => {
  const keys = manifest.images.map((image) => `${image.viewId}:${image.mode}`);
  if (new Set(keys).size !== 12) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["images"],
      message: "Preview manifest must contain every unique view and mode pair exactly once",
    });
  }
  for (const [index, image] of manifest.images.entries()) {
    const view = PREVIEW_VIEW_SPECS[Math.floor(
      index / FOUNDRY_POTREE_V2_POINT_PREVIEW_MODES.length,
    )];
    const mode = FOUNDRY_POTREE_V2_POINT_PREVIEW_MODES[
      index % FOUNDRY_POTREE_V2_POINT_PREVIEW_MODES.length
    ];
    if (view === undefined || mode === undefined) continue;
    if (
      image.viewId !== view.viewId ||
      image.mode !== mode ||
      image.projectedAxes[0] !== view.projectedAxes[0] ||
      image.projectedAxes[1] !== view.projectedAxes[1] ||
      image.omittedAxis !== view.omittedAxis ||
      image.colorMap !== PREVIEW_COLOR_MAP_BY_MODE[mode] ||
      image.fileName !== previewFileName(view.viewId, mode)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["images", index],
        message:
          "Preview image order, projection, color map, and filename must match the canonical view-mode registry",
      });
    }
  }
});
export type FoundryPotreeV2PointPreviewManifest = z.infer<
  typeof FoundryPotreeV2PointPreviewManifestSchema
>;

const ByteDistributionShape = {
  observedMin: z.number().int().min(0).max(255),
  observedMax: z.number().int().min(0).max(255),
  sum: z.number().int().safe().nonnegative(),
  distinctCount: z.number().int().min(1).max(256),
  histogram: HistogramSchema,
  declaredRangeSatisfied: z.literal(true),
} as const;
const IntensityByteDistributionSchema = z.object({
  byteOffset: z.literal(12),
  ...ByteDistributionShape,
}).strict();
const OpaqueVendorByteDistributionSchema = z.object({
  byteOffset: z.literal(13),
  ...ByteDistributionShape,
  declaredName: z.literal("lcc prediction"),
  semantics: z.literal("not_established"),
}).strict();

const DeepProfilePerformedSchema = z.object({
  state: z.literal("performed"),
  thresholdPointCount: z.literal(FOUNDRY_POTREE_V2_POINT_VALUES_DEEP_PROFILE_MAX_COUNT),
  quantileMethod: z.literal("nearest_rank"),
  quantileProbabilities: z.tuple([
    z.literal(0.01), z.literal(0.05), z.literal(0.25), z.literal(0.5),
    z.literal(0.75), z.literal(0.95), z.literal(0.99),
  ]),
  rawPositionQuantilesByAxis: RawQuantilesByAxisSchema,
  decodedPositionQuantilesByAxis: QuantilesByAxisSchema,
  uniquePositionCount: z.number().int().safe().positive(),
  duplicatePositionRecordCount: z.number().int().safe().nonnegative(),
  positionsWithMultiplicity: z.number().int().safe().nonnegative(),
  maximumPositionMultiplicity: z.number().int().safe().positive(),
  mostRepeatedRawPosition: IntVec3Schema,
  uniqueFullRecordCount: z.number().int().safe().positive(),
  duplicateFullRecordCount: z.number().int().safe().nonnegative(),
}).strict();
const DeepProfileNotPerformedSchema = z.object({
  state: z.literal("not_performed"),
  reason: z.literal("point_count_exceeds_exact_profile_limit"),
  thresholdPointCount: z.literal(FOUNDRY_POTREE_V2_POINT_VALUES_DEEP_PROFILE_MAX_COUNT),
}).strict();

export const FoundryPotreeV2PointValueFactsSchema = z.object({
  schemaVersion: z.literal("omnitwin.foundry.potree-v2-point-values.v1"),
  profile: z.literal("xgrids_default_14_byte_full_numeric_decode_and_triplanar_preview"),
  authority: z.literal("none"),
  bundleRoot: z.string().max(4096),
  bundleSha256: z.string().regex(SHA256_HEX),
  recordCount: z.number().int().safe().positive().max(
    FOUNDRY_POTREE_V2_POINT_VALUES_POINT_MAX_COUNT,
  ),
  recordStrideBytes: z.literal(FOUNDRY_POTREE_V2_POINT_RECORD_BYTES),
  position: z.object({
    rawMin: IntVec3Schema,
    rawMax: IntVec3Schema,
    decodedMin: Vec3Schema,
    decodedMax: Vec3Schema,
    finiteComponentCount: z.number().int().safe().positive(),
    nodeBoundsViolationCount: z.literal(0),
    declaredRangeSatisfied: z.literal(true),
    toleranceByAxis: NonnegativeVec3Schema,
  }).strict(),
  intensity: IntensityByteDistributionSchema,
  opaqueVendorByte: OpaqueVendorByteDistributionSchema,
  deepProfile: z.discriminatedUnion("state", [
    DeepProfilePerformedSchema,
    DeepProfileNotPerformedSchema,
  ]),
  qualityWarnings: z.array(z.enum(
    FOUNDRY_POTREE_V2_POINT_VALUE_QUALITY_WARNINGS,
  )).max(1),
  previews: FoundryPotreeV2PointPreviewManifestSchema,
  limitations: z.tuple([
    z.literal("NUMERIC_COORDINATES_DO_NOT_ESTABLISH_UNITS_FRAME_CRS_ACCURACY_OR_PHYSICAL_MEANING"),
    z.literal("CPU_RASTERS_ARE_DIAGNOSTIC_PREVIEWS_NOT_OFFICIAL_VIEWER_FIDELITY_EVIDENCE"),
    z.literal("THE_OPAQUE_VENDOR_BYTE_REMAINS_SEMANTICALLY_UNKNOWN"),
    z.literal("DUPLICATE_CONCENTRATION_IS_AN_OBSERVATION_NOT A CORRUPTION_OR_CAUSE CLAIM"),
  ]),
}).strict().superRefine((facts, ctx) => {
  if (facts.position.finiteComponentCount !== facts.recordCount * 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["position", "finiteComponentCount"], message: "Finite component total must equal three per record" });
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (
      (facts.position.rawMin[axis] ?? 0) >
        (facts.position.rawMax[axis] ?? 0) ||
      (facts.position.decodedMin[axis] ?? 0) >
        (facts.position.decodedMax[axis] ?? 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["position"],
        message: "Observed position minima must not exceed maxima",
      });
    }
  }
  for (const [path, distribution] of [
    ["intensity", facts.intensity],
    ["opaqueVendorByte", facts.opaqueVendorByte],
  ] as const) {
    const count = distribution.histogram.reduce((sum, value) => sum + value, 0);
    const sum = distribution.histogram.reduce((total, value, index) => total + value * index, 0);
    const observed = distribution.histogram.flatMap((value, index) =>
      value > 0 ? [index] : []
    );
    if (
      count !== facts.recordCount ||
      sum !== distribution.sum ||
      observed.length !== distribution.distinctCount ||
      distribution.observedMin !== observed[0] ||
      distribution.observedMax !== observed.at(-1) ||
      distribution.observedMin > distribution.observedMax
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: "Byte distribution equations do not match the record count" });
    }
  }
  if (
    (facts.recordCount <= FOUNDRY_POTREE_V2_POINT_VALUES_DEEP_PROFILE_MAX_COUNT) !==
      (facts.deepProfile.state === "performed")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deepProfile"],
      message:
        "Exact-profile state must be derived from the frozen point-count threshold",
    });
  }
  if (facts.deepProfile.state === "performed") {
    const profile = facts.deepProfile;
    if (
      profile.uniquePositionCount + profile.duplicatePositionRecordCount !==
        facts.recordCount ||
      profile.uniqueFullRecordCount + profile.duplicateFullRecordCount !==
        facts.recordCount ||
      profile.uniquePositionCount > profile.uniqueFullRecordCount ||
      profile.uniqueFullRecordCount > facts.recordCount ||
      profile.positionsWithMultiplicity > profile.uniquePositionCount ||
      profile.maximumPositionMultiplicity > facts.recordCount ||
      profile.duplicatePositionRecordCount < profile.positionsWithMultiplicity ||
      profile.maximumPositionMultiplicity - 1 >
        profile.duplicatePositionRecordCount ||
      (profile.positionsWithMultiplicity === 0) !==
        (profile.maximumPositionMultiplicity === 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deepProfile"],
        message:
          "Exact-profile uniqueness, duplicate, and multiplicity equations must match the record count",
      });
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const rawQuantiles = profile.rawPositionQuantilesByAxis[axis] ?? [];
      const decodedQuantiles =
        profile.decodedPositionQuantilesByAxis[axis] ?? [];
      if (
        rawQuantiles.some((value, index) =>
          index > 0 && value < (rawQuantiles[index - 1] ?? value)
        ) ||
        decodedQuantiles.some((value, index) =>
          index > 0 && value < (decodedQuantiles[index - 1] ?? value)
        ) ||
        rawQuantiles.some((value) =>
          value < (facts.position.rawMin[axis] ?? value) ||
          value > (facts.position.rawMax[axis] ?? value)
        ) ||
        decodedQuantiles.some((value) =>
          value < (facts.position.decodedMin[axis] ?? value) ||
          value > (facts.position.decodedMax[axis] ?? value)
        ) ||
        (profile.mostRepeatedRawPosition[axis] ?? 0) <
          (facts.position.rawMin[axis] ?? 0) ||
        (profile.mostRepeatedRawPosition[axis] ?? 0) >
          (facts.position.rawMax[axis] ?? 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deepProfile"],
          message:
            "Exact-profile quantiles must be monotone and bounded by observed extrema",
        });
      }
    }
  }
  const duplicateWarningExpected = facts.deepProfile.state === "performed" &&
    facts.deepProfile.maximumPositionMultiplicity > 1 &&
    (facts.deepProfile.maximumPositionMultiplicity - 1) / facts.recordCount >=
      DUPLICATE_CONCENTRATION_RATE;
  if (
    JSON.stringify(facts.qualityWarnings) !== JSON.stringify(
      duplicateWarningExpected
        ? ["exact_position_duplicate_concentration_observed"]
        : [],
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["qualityWarnings"],
      message:
        "Quality warnings must be derived exactly from the duplicate concentration profile",
    });
  }
  if (facts.previews.images.some((image) => image.bundleSha256 !== facts.bundleSha256)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["previews"], message: "Every preview must bind the exact bundle digest" });
  }
  if (facts.previews.images.some((image) =>
    image.occupiedPixelCount > facts.recordCount ||
    image.maxRecordsPerPixel > facts.recordCount
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["previews"],
      message: "Preview occupancy counts must not exceed the decoded record count",
    });
  }
});
export type FoundryPotreeV2PointValueFacts = z.infer<
  typeof FoundryPotreeV2PointValueFactsSchema
>;

const OutcomeCommonSchema = z.object({
  bundleRoot: z.string().max(4096),
  bundleSha256: z.string().regex(SHA256_HEX),
});
const EstablishedOutcomeSchema = OutcomeCommonSchema.extend({
  state: z.literal("established"),
  category: z.literal("established"),
  code: z.literal("POTREE_V2_POINT_VALUES_ESTABLISHED"),
  coverage: z.literal("all_records_numeric_values_and_deterministic_previews"),
  facts: FoundryPotreeV2PointValueFactsSchema,
}).strict();
const FailureOutcomeSchema = OutcomeCommonSchema.extend({
  state: z.literal("facts_not_established"),
  category: z.enum(["resource_limit", "parse_failure", "validation_failure"]),
  code: z.enum(FOUNDRY_POTREE_V2_POINT_VALUE_FAILURE_CODES),
  coverage: z.literal("none"),
  facts: z.null(),
}).strict();

export const FoundryPotreeV2PointValuesOutcomeSchema = z.discriminatedUnion(
  "state",
  [EstablishedOutcomeSchema, FailureOutcomeSchema],
).superRefine((outcome, ctx) => {
  if (
    outcome.state === "established" &&
    (
      outcome.facts.bundleRoot !== outcome.bundleRoot ||
      outcome.facts.bundleSha256 !== outcome.bundleSha256
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["facts"],
      message: "Established facts must retain the exact outcome bundle identity",
    });
  }
  if (
    outcome.state === "facts_not_established" &&
    FOUNDRY_POTREE_V2_POINT_VALUE_FAILURE_CATEGORY_BY_CODE[outcome.code] !==
      outcome.category
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["category"],
      message: "Failure category contradicts the frozen code registry",
    });
  }
});
export type FoundryPotreeV2PointValuesOutcome =
  | z.infer<typeof EstablishedOutcomeSchema>
  | z.infer<typeof FailureOutcomeSchema>;

export interface FoundryPotreeV2PointPreviewFile {
  readonly bundleRoot: string;
  readonly bundleSha256: string;
  readonly viewId: z.infer<typeof PreviewViewIdSchema>;
  readonly mode: z.infer<typeof PreviewModeSchema>;
  readonly fileName: string;
  readonly mediaType: "image/png";
  readonly byteLength: number;
  readonly sha256: string;
  readonly bytes: Buffer;
}

export interface InspectPotreeV2PointValuesFromBuffersInput {
  readonly bundle: FoundryPotreeV2BundleAssetV7;
  readonly hierarchyBytes: Uint8Array;
  readonly octreeBytes: Uint8Array;
  readonly signal: AbortSignal;
}

export interface InspectPotreeV2PointValuesResult {
  readonly outcome: FoundryPotreeV2PointValuesOutcome;
  readonly previewFiles: readonly FoundryPotreeV2PointPreviewFile[];
}

export class FoundryPotreeV2PointValuesCancellationError extends Error {
  public readonly code = "POTREE_V2_POINT_VALUES_CANCELLED";
  public constructor() {
    super("Potree v2 point-value inspection was cancelled.");
    this.name = "AbortError";
  }
}

class PointValueFailure extends Error {
  public constructor(public readonly code: FoundryPotreeV2PointValueFailureCode) {
    super(code);
  }
}

type Vec3 = readonly [number, number, number];
interface Box3 { readonly min: Vec3; readonly max: Vec3 }
interface NodeRange {
  readonly start: number;
  readonly end: number;
  readonly pointCount: number;
  readonly name: string;
  readonly box: Box3;
}
interface ChunkWork {
  readonly start: number;
  readonly end: number;
  readonly rootName: string;
}

const ZERO_SHA256 = "0".repeat(64);
const SCAN_BLOCK_RECORDS = 65_536;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bundleIds(input: unknown): { bundleRoot: string; bundleSha256: string } {
  const candidate = typeof input === "object" && input !== null
    ? input as Readonly<Record<string, unknown>>
    : {};
  return {
    bundleRoot:
      typeof candidate.bundleRoot === "string" &&
      candidate.bundleRoot.length <= 4096
        ? candidate.bundleRoot
        : "",
    bundleSha256:
      typeof candidate.bundleSha256 === "string" &&
      SHA256_HEX.test(candidate.bundleSha256)
        ? candidate.bundleSha256
        : ZERO_SHA256,
  };
}

function failureOutcome(
  bundle: unknown,
  code: FoundryPotreeV2PointValueFailureCode,
): FoundryPotreeV2PointValuesOutcome {
  return FoundryPotreeV2PointValuesOutcomeSchema.parse({
    ...bundleIds(bundle),
    state: "facts_not_established",
    category: FOUNDRY_POTREE_V2_POINT_VALUE_FAILURE_CATEGORY_BY_CODE[code],
    code,
    coverage: "none",
    facts: null,
  });
}

export function preflightPotreeV2PointValues(
  bundleInput: unknown,
): FoundryPotreeV2PointValuesOutcome | null {
  const parsed = FoundryPotreeV2BundleAssetV7Schema.safeParse(bundleInput);
  if (!parsed.success) return failureOutcome(bundleInput, "POTREE_V2_POINT_VALUES_BUNDLE_INVALID");
  const bundle = parsed.data;
  if (bundle.inspection.state !== "established" || bundle.facts === null) {
    return failureOutcome(bundle, "POTREE_V2_POINT_VALUES_V7_INSPECTION_NOT_ESTABLISHED");
  }
  const octree = bundle.members.find((member) => member.role === "octree");
  if (octree === undefined) return failureOutcome(bundle, "POTREE_V2_POINT_VALUES_BUNDLE_INVALID");
  if (octree.sizeBytes > FOUNDRY_POTREE_V2_POINT_VALUES_OCTREE_MAX_BYTES) {
    return failureOutcome(bundle, "POTREE_V2_POINT_VALUES_OCTREE_SIZE_LIMIT_EXCEEDED");
  }
  if (bundle.facts.metadata.pointCount > FOUNDRY_POTREE_V2_POINT_VALUES_POINT_MAX_COUNT) {
    return failureOutcome(bundle, "POTREE_V2_POINT_VALUES_POINT_COUNT_LIMIT_EXCEEDED");
  }
  return null;
}

function guard(signal: AbortSignal, startedAt: number): void {
  if (signal.aborted) throw new FoundryPotreeV2PointValuesCancellationError();
  if (performance.now() - startedAt > FOUNDRY_POTREE_V2_POINT_VALUES_TIME_MAX_MS) {
    throw new PointValueFailure("POTREE_V2_POINT_VALUES_TIME_LIMIT_EXCEEDED");
  }
}

function childBox(parent: Box3, index: number): Box3 {
  const min: [number, number, number] = [...parent.min];
  const max: [number, number, number] = [...parent.max];
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  for (const [axis, bit] of [[2, 0], [1, 1], [0, 2]] as const) {
    if ((index & (1 << bit)) !== 0) min[axis] += size[axis] / 2;
    else max[axis] -= size[axis] / 2;
  }
  return { min, max };
}

function boxForName(root: Box3, name: string): Box3 {
  let box = root;
  for (let index = 1; index < name.length; index += 1) {
    const child = Number(name[index]);
    if (!Number.isInteger(child) || child < 0 || child > 7) {
      throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
    }
    box = childBox(box, child);
  }
  return box;
}

function boundedU64(bytes: Buffer, offset: number): number {
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value > ((1n << 63n) - 1n)) {
    throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
  }
  return Number(value);
}

function parseHierarchy(
  bundle: FoundryPotreeV2BundleAssetV7,
  bytes: Buffer,
  signal: AbortSignal,
  startedAt: number,
): NodeRange[] {
  const facts = bundle.facts;
  if (facts === null) throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
  const firstSize = facts.metadata.hierarchyFirstChunkSizeBytes;
  const root: Box3 = facts.metadata.declaredBoundingBox;
  if (firstSize <= 0 || firstSize > bytes.length || firstSize % FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES !== 0) {
    throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
  }
  const chunks: ChunkWork[] = [{ start: 0, end: firstSize, rootName: "r" }];
  const visited: Array<readonly [number, number]> = [];
  const realNames = new Set<string>();
  const ranges: NodeRange[] = [];
  let reachableBytes = 0;
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    guard(signal, startedAt);
    const work = chunks[chunkIndex];
    if (work === undefined || work.start < 0 || work.end > bytes.length || work.start >= work.end ||
        work.start % 22 !== 0 || work.end % 22 !== 0 ||
        visited.some(([start, end]) => start < work.end && work.start < end)) {
      throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
    }
    visited.push([work.start, work.end]);
    reachableBytes += work.end - work.start;
    const names = [work.rootName];
    let nameIndex = 0;
    for (let offset = work.start; offset < work.end; offset += 22) {
      const name = names[nameIndex];
      nameIndex += 1;
      if (name === undefined) throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
      const type = bytes.readUInt8(offset);
      const mask = bytes.readUInt8(offset + 1);
      const pointCount = bytes.readUInt32LE(offset + 2);
      const byteOffset = boundedU64(bytes, offset + 6);
      const byteSize = boundedU64(bytes, offset + 14);
      if (offset === work.start && chunkIndex > 0 && type === 2) {
        throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
      }
      if (type === 2) {
        if (byteSize <= 0 || byteOffset + byteSize > bytes.length) {
          throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
        }
        chunks.push({ start: byteOffset, end: byteOffset + byteSize, rootName: name });
        continue;
      }
      if ((type !== 0 && type !== 1) || realNames.has(name) || byteSize !== pointCount * 14) {
        throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
      }
      realNames.add(name);
      ranges.push({
        start: byteOffset,
        end: byteOffset + byteSize,
        pointCount,
        name,
        box: boxForName(root, name),
      });
      for (let child = 0; child < 8; child += 1) {
        if ((mask & (1 << child)) !== 0) names.push(`${name}${String(child)}`);
      }
    }
    if (nameIndex !== names.length) throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
  }
  if (reachableBytes !== bytes.length || ranges.length !== facts.hierarchy.logicalNodeCount) {
    throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
  }
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  let cursor = 0;
  let pointTotal = 0;
  for (const range of sorted) {
    if (range.start !== cursor || range.end < range.start || range.end > facts.octree.sourceSizeBytes || range.start % 14 !== 0 || range.end % 14 !== 0) {
      throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
    }
    cursor = range.end;
    pointTotal += range.pointCount;
  }
  if (cursor !== facts.octree.sourceSizeBytes || pointTotal !== facts.metadata.pointCount) {
    throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
  }
  return sorted;
}

interface ScanResult {
  readonly rawMin: [number, number, number];
  readonly rawMax: [number, number, number];
  readonly decodedMin: [number, number, number];
  readonly decodedMax: [number, number, number];
  readonly intensityHistogram: number[];
  readonly vendorHistogram: number[];
  readonly intensitySum: number;
  readonly vendorSum: number;
  readonly deepRaw: readonly [Int32Array, Int32Array, Int32Array] | null;
  readonly deepIntensity: Uint8Array | null;
  readonly deepVendor: Uint8Array | null;
}

function scanValues(
  bundle: FoundryPotreeV2BundleAssetV7,
  octree: Buffer,
  ranges: readonly NodeRange[],
  signal: AbortSignal,
  startedAt: number,
): ScanResult {
  const facts = bundle.facts;
  if (facts === null) throw new PointValueFailure("POTREE_V2_POINT_VALUES_INSPECTION_FAILED");
  const count = facts.metadata.pointCount;
  const deep = count <= FOUNDRY_POTREE_V2_POINT_VALUES_DEEP_PROFILE_MAX_COUNT;
  const raw: [Int32Array, Int32Array, Int32Array] | null = deep
    ? [new Int32Array(count), new Int32Array(count), new Int32Array(count)]
    : null;
  const deepIntensity = deep ? new Uint8Array(count) : null;
  const deepVendor = deep ? new Uint8Array(count) : null;
  const rawMin: [number, number, number] = [2_147_483_647, 2_147_483_647, 2_147_483_647];
  const rawMax: [number, number, number] = [-2_147_483_648, -2_147_483_648, -2_147_483_648];
  const decodedMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const decodedMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const intensityHistogram = Array.from({ length: 256 }, () => 0);
  const vendorHistogram = Array.from({ length: 256 }, () => 0);
  const positionAttribute = facts.metadata.attributes[0];
  const intensityAttribute = facts.metadata.attributes[1];
  const vendorAttribute = facts.metadata.attributes[2];
  let intensitySum = 0;
  let vendorSum = 0;
  let scanned = 0;
  for (const range of ranges) {
    for (let offset = range.start; offset < range.end; offset += 14) {
      if (scanned % SCAN_BLOCK_RECORDS === 0) guard(signal, startedAt);
      const ordinal = offset / 14;
      const values: Vec3 = [
        octree.readInt32LE(offset),
        octree.readInt32LE(offset + 4),
        octree.readInt32LE(offset + 8),
      ];
      for (let axis = 0; axis < 3; axis += 1) {
        const value = values[axis] ?? 0;
        const scale = facts.metadata.declaredScale[axis] ?? 0;
        const decoded = value * scale + (facts.metadata.declaredOffset[axis] ?? 0);
        const numericEpsilon = Number.EPSILON * Math.max(1, Math.abs(decoded), Math.abs(range.box.min[axis] ?? 0), Math.abs(range.box.max[axis] ?? 0));
        const tolerance = Math.max(scale, numericEpsilon);
        if (!Number.isFinite(decoded)) throw new PointValueFailure("POTREE_V2_POINT_VALUES_DECLARED_RANGE_VIOLATION");
        if (decoded < (range.box.min[axis] ?? 0) - tolerance || decoded > (range.box.max[axis] ?? 0) + tolerance) {
          throw new PointValueFailure("POTREE_V2_POINT_VALUES_NODE_BOUNDS_VIOLATION");
        }
        const declaredMin = positionAttribute.declaredMin[axis] ?? Infinity;
        const declaredMax = positionAttribute.declaredMax[axis] ?? -Infinity;
        if (decoded < declaredMin - tolerance || decoded > declaredMax + tolerance) {
          throw new PointValueFailure("POTREE_V2_POINT_VALUES_DECLARED_RANGE_VIOLATION");
        }
        rawMin[axis] = Math.min(rawMin[axis] ?? Infinity, value);
        rawMax[axis] = Math.max(rawMax[axis] ?? -Infinity, value);
        decodedMin[axis] = Math.min(decodedMin[axis] ?? Infinity, decoded);
        decodedMax[axis] = Math.max(decodedMax[axis] ?? -Infinity, decoded);
        const rawAxis = raw?.[axis];
        if (rawAxis !== undefined) rawAxis[ordinal] = value;
      }
      const intensity = octree.readUInt8(offset + 12);
      const vendor = octree.readUInt8(offset + 13);
      if (intensity < intensityAttribute.declaredMin[0] || intensity > intensityAttribute.declaredMax[0] ||
          vendor < vendorAttribute.declaredMin[0] || vendor > vendorAttribute.declaredMax[0]) {
        throw new PointValueFailure("POTREE_V2_POINT_VALUES_DECLARED_RANGE_VIOLATION");
      }
      intensityHistogram[intensity] = (intensityHistogram[intensity] ?? 0) + 1;
      vendorHistogram[vendor] = (vendorHistogram[vendor] ?? 0) + 1;
      intensitySum += intensity;
      vendorSum += vendor;
      if (deepIntensity !== null) deepIntensity[ordinal] = intensity;
      if (deepVendor !== null) deepVendor[ordinal] = vendor;
      scanned += 1;
    }
  }
  if (scanned !== count) throw new PointValueFailure("POTREE_V2_POINT_VALUES_HIERARCHY_INVALID");
  return { rawMin, rawMax, decodedMin, decodedMax, intensityHistogram, vendorHistogram, intensitySum, vendorSum, deepRaw: raw, deepIntensity, deepVendor };
}

const QUANTILE_PROBABILITIES = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99] as const;

function nearestRank(sorted: Int32Array, probability: number): number {
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)] ?? 0;
}

function deepProfile(
  scan: ScanResult,
  metadata: NonNullable<FoundryPotreeV2BundleAssetV7["facts"]>["metadata"],
): z.infer<typeof DeepProfilePerformedSchema> | z.infer<typeof DeepProfileNotPerformedSchema> {
  const raw = scan.deepRaw;
  const intensity = scan.deepIntensity;
  const vendor = scan.deepVendor;
  if (raw === null || intensity === null || vendor === null) {
    return { state: "not_performed", reason: "point_count_exceeds_exact_profile_limit", thresholdPointCount: FOUNDRY_POTREE_V2_POINT_VALUES_DEEP_PROFILE_MAX_COUNT };
  }
  const count = raw[0].length;
  const rawQuantiles = raw.map((axis) => {
    const sorted = axis.slice().sort();
    return QUANTILE_PROBABILITIES.map((probability) => nearestRank(sorted, probability));
  }) as [number[], number[], number[]];
  const decodedQuantiles = rawQuantiles.map((axisValues, axis) => axisValues.map(
    (value) => value * (metadata.declaredScale[axis] ?? 0) + (metadata.declaredOffset[axis] ?? 0),
  )) as [number[], number[], number[]];
  const indices = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) indices[index] = index;
  indices.sort((left, right) =>
    (raw[0][left] ?? 0) - (raw[0][right] ?? 0) ||
    (raw[1][left] ?? 0) - (raw[1][right] ?? 0) ||
    (raw[2][left] ?? 0) - (raw[2][right] ?? 0));
  let uniquePositions = 0;
  let positionsWithMultiplicity = 0;
  let maximumMultiplicity = 0;
  let mostRepeated: [number, number, number] = [0, 0, 0];
  for (let start = 0; start < count;) {
    let end = start + 1;
    const first = indices[start] ?? 0;
    while (end < count) {
      const candidate = indices[end] ?? 0;
      if (raw[0][candidate] !== raw[0][first] || raw[1][candidate] !== raw[1][first] || raw[2][candidate] !== raw[2][first]) break;
      end += 1;
    }
    const multiplicity = end - start;
    uniquePositions += 1;
    if (multiplicity > 1) positionsWithMultiplicity += 1;
    if (multiplicity > maximumMultiplicity) {
      maximumMultiplicity = multiplicity;
      mostRepeated = [raw[0][first] ?? 0, raw[1][first] ?? 0, raw[2][first] ?? 0];
    }
    start = end;
  }
  indices.sort((left, right) =>
    (raw[0][left] ?? 0) - (raw[0][right] ?? 0) ||
    (raw[1][left] ?? 0) - (raw[1][right] ?? 0) ||
    (raw[2][left] ?? 0) - (raw[2][right] ?? 0) ||
    (intensity[left] ?? 0) - (intensity[right] ?? 0) ||
    (vendor[left] ?? 0) - (vendor[right] ?? 0));
  let uniqueFullRecords = 0;
  for (let index = 0; index < count;) {
    const first = indices[index] ?? 0;
    let end = index + 1;
    while (end < count) {
      const candidate = indices[end] ?? 0;
      if (raw[0][candidate] !== raw[0][first] || raw[1][candidate] !== raw[1][first] || raw[2][candidate] !== raw[2][first] || intensity[candidate] !== intensity[first] || vendor[candidate] !== vendor[first]) break;
      end += 1;
    }
    uniqueFullRecords += 1;
    index = end;
  }
  return DeepProfilePerformedSchema.parse({
    state: "performed",
    thresholdPointCount: FOUNDRY_POTREE_V2_POINT_VALUES_DEEP_PROFILE_MAX_COUNT,
    quantileMethod: "nearest_rank",
    quantileProbabilities: QUANTILE_PROBABILITIES,
    rawPositionQuantilesByAxis: rawQuantiles,
    decodedPositionQuantilesByAxis: decodedQuantiles,
    uniquePositionCount: uniquePositions,
    duplicatePositionRecordCount: count - uniquePositions,
    positionsWithMultiplicity,
    maximumPositionMultiplicity: maximumMultiplicity,
    mostRepeatedRawPosition: mostRepeated,
    uniqueFullRecordCount: uniqueFullRecords,
    duplicateFullRecordCount: count - uniqueFullRecords,
  });
}

const VIRIDIS_ANCHORS = Object.freeze([
  [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
] as const);
const INFERNO_ANCHORS = Object.freeze([
  [0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 8], [252, 255, 164],
] as const);

function colorFromAnchors(anchors: readonly (readonly [number, number, number])[], value: number): readonly [number, number, number] {
  const scaled = Math.max(0, Math.min(1, value)) * (anchors.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(anchors.length - 1, lower + 1);
  const amount = scaled - lower;
  const a = anchors[lower] ?? [0, 0, 0];
  const b = anchors[upper] ?? a;
  return [
    Math.round(a[0] + (b[0] - a[0]) * amount),
    Math.round(a[1] + (b[1] - a[1]) * amount),
    Math.round(a[2] + (b[2] - a[2]) * amount),
  ];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + payload.length);
  output.writeUInt32BE(payload.length, 0);
  name.copy(output, 4);
  payload.copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, 8 + payload.length)), 8 + payload.length);
  return output;
}

function encodePng(rgba: Buffer): Buffer {
  const rowBytes = FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH * 4;
  const scanlines = Buffer.alloc((rowBytes + 1) * FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT);
  for (let row = 0; row < FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT; row += 1) {
    rgba.copy(scanlines, row * (rowBytes + 1) + 1, row * rowBytes, (row + 1) * rowBytes);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH, 0);
  ihdr.writeUInt32BE(FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const compressed = Buffer.from(zlibSync(scanlines, {
    level: 9,
    mem: 8,
  }));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePosition(raw: Vec3, scale: Vec3, offset: Vec3): Vec3 {
  return [
    raw[0] * scale[0] + offset[0],
    raw[1] * scale[1] + offset[1],
    raw[2] * scale[2] + offset[2],
  ];
}

function renderPreviews(
  bundle: FoundryPotreeV2BundleAssetV7,
  octree: Buffer,
  scan: ScanResult,
  signal: AbortSignal,
  startedAt: number,
): { manifest: FoundryPotreeV2PointPreviewManifest; files: FoundryPotreeV2PointPreviewFile[] } {
  const facts = bundle.facts;
  if (facts === null) throw new PointValueFailure("POTREE_V2_POINT_VALUES_PREVIEW_ENCODING_FAILED");
  const pixelCount = FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH * FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT;
  const files: FoundryPotreeV2PointPreviewFile[] = [];
  const images: z.infer<typeof PreviewImageManifestSchema>[] = [];
  for (const spec of PREVIEW_VIEW_SPECS) {
    guard(signal, startedAt);
    const occupancy = new Uint32Array(pixelCount);
    const frontOrdinal = new Uint32Array(pixelCount);
    frontOrdinal.fill(0xffffffff);
    const frontDepth = new Float64Array(pixelCount);
    frontDepth.fill(-Infinity);
    const frontIntensity = new Uint8Array(pixelCount);
    const frontVendor = new Uint8Array(pixelCount);
    const [axisX, axisY] = spec.projectedAxes;
    const spanX = scan.decodedMax[axisX] - scan.decodedMin[axisX];
    const spanY = scan.decodedMax[axisY] - scan.decodedMin[axisY];
    const available = FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH - 2 * FOUNDRY_POTREE_V2_POINT_PREVIEW_MARGIN;
    const candidates = [spanX, spanY].filter((span) => span > 0).map((span) => available / span);
    const fitScale = candidates.length === 0 ? 1 : Math.min(...candidates);
    const offsetX = (FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH - spanX * fitScale) / 2;
    const offsetY = (FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT - spanY * fitScale) / 2;
    let maxRecordsPerPixel = 0;
    for (let ordinal = 0; ordinal < facts.metadata.pointCount; ordinal += 1) {
      if (ordinal % SCAN_BLOCK_RECORDS === 0) guard(signal, startedAt);
      const recordOffset = ordinal * 14;
      const raw: Vec3 = [octree.readInt32LE(recordOffset), octree.readInt32LE(recordOffset + 4), octree.readInt32LE(recordOffset + 8)];
      const decoded = decodePosition(
        raw,
        facts.metadata.declaredScale,
        facts.metadata.declaredOffset,
      );
      const x = Math.max(0, Math.min(FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH - 1, Math.floor(offsetX + (decoded[axisX] - scan.decodedMin[axisX]) * fitScale)));
      const rawY = Math.floor(offsetY + (decoded[axisY] - scan.decodedMin[axisY]) * fitScale);
      const y = Math.max(0, Math.min(FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT - 1, FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT - 1 - rawY));
      const pixel = y * FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH + x;
      const count = (occupancy[pixel] ?? 0) + 1;
      occupancy[pixel] = count;
      maxRecordsPerPixel = Math.max(maxRecordsPerPixel, count);
      const depth = decoded[spec.omittedAxis];
      if (depth > (frontDepth[pixel] ?? -Infinity) || (depth === frontDepth[pixel] && ordinal < (frontOrdinal[pixel] ?? 0xffffffff))) {
        frontDepth[pixel] = depth;
        frontOrdinal[pixel] = ordinal;
        frontIntensity[pixel] = octree.readUInt8(recordOffset + 12);
        frontVendor[pixel] = octree.readUInt8(recordOffset + 13);
      }
    }
    const occupiedPixelCount = occupancy.reduce((total, value) => total + (value > 0 ? 1 : 0), 0);
    for (const mode of FOUNDRY_POTREE_V2_POINT_PREVIEW_MODES) {
      guard(signal, startedAt);
      const rgba = Buffer.alloc(pixelCount * 4);
      const depthSpan = scan.decodedMax[spec.omittedAxis] - scan.decodedMin[spec.omittedAxis];
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        if ((occupancy[pixel] ?? 0) === 0) continue;
        let color: readonly [number, number, number];
        if (mode === "intensity_byte") {
          const value = frontIntensity[pixel] ?? 0;
          color = [value, value, value];
        } else if (mode === "opaque_vendor_byte") {
          color = colorFromAnchors(VIRIDIS_ANCHORS, (frontVendor[pixel] ?? 0) / 255);
        } else if (mode === "record_density") {
          color = colorFromAnchors(INFERNO_ANCHORS, Math.log1p(occupancy[pixel] ?? 0) / Math.log1p(maxRecordsPerPixel));
        } else {
          const normalized = depthSpan === 0 ? 0.5 : ((frontDepth[pixel] ?? 0) - scan.decodedMin[spec.omittedAxis]) / depthSpan;
          color = colorFromAnchors(VIRIDIS_ANCHORS, normalized);
        }
        const offset = pixel * 4;
        rgba[offset] = color[0]; rgba[offset + 1] = color[1]; rgba[offset + 2] = color[2]; rgba[offset + 3] = 255;
      }
      const png = encodePng(rgba);
      const fileName = previewFileName(spec.viewId, mode);
      const file: FoundryPotreeV2PointPreviewFile = {
        bundleRoot: bundle.bundleRoot,
        bundleSha256: bundle.bundleSha256,
        viewId: spec.viewId,
        mode,
        fileName,
        mediaType: "image/png",
        byteLength: png.length,
        sha256: sha256(png),
        bytes: png,
      };
      files.push(file);
      images.push(PreviewImageManifestSchema.parse({
        bundleSha256: bundle.bundleSha256,
        viewId: spec.viewId,
        mode,
        fileName,
        mediaType: "image/png",
        width: FOUNDRY_POTREE_V2_POINT_PREVIEW_WIDTH,
        height: FOUNDRY_POTREE_V2_POINT_PREVIEW_HEIGHT,
        marginPixels: FOUNDRY_POTREE_V2_POINT_PREVIEW_MARGIN,
        projectedAxes: spec.projectedAxes,
        omittedAxis: spec.omittedAxis,
        fit: "observed_extrema_uniform_no_crop",
        cameraDirection: "positive_omitted_component",
        frontmostRule: "maximum_omitted_component",
        tieBreakRule: "lowest_record_ordinal",
        colorMap: PREVIEW_COLOR_MAP_BY_MODE[mode],
        occupiedPixelCount,
        maxRecordsPerPixel,
        pixelSha256: sha256(rgba),
        byteLength: png.length,
        sha256: file.sha256,
      }));
    }
  }
  return {
    manifest: FoundryPotreeV2PointPreviewManifestSchema.parse({
      profile: FOUNDRY_POTREE_V2_POINT_PREVIEW_PROFILE,
      imageCount: 12,
      images,
    }),
    files,
  };
}

function distribution(
  histogram: number[],
  sum: number,
  byteOffset: 12 | 13,
): z.infer<typeof IntensityByteDistributionSchema> |
  Omit<z.infer<typeof OpaqueVendorByteDistributionSchema>,
    "declaredName" | "semantics"> {
  const observed = histogram.flatMap((count, value) => count > 0 ? [value] : []);
  const value = {
    byteOffset,
    observedMin: observed[0] ?? 0,
    observedMax: observed.at(-1) ?? 0,
    sum,
    distinctCount: observed.length,
    histogram,
    declaredRangeSatisfied: true,
  } as const;
  return byteOffset === 12
    ? IntensityByteDistributionSchema.parse(value)
    : z.object({
      byteOffset: z.literal(13),
      ...ByteDistributionShape,
    }).strict().parse(value);
}

export function inspectPotreeV2PointValuesFromBuffers(
  input: InspectPotreeV2PointValuesFromBuffersInput,
): InspectPotreeV2PointValuesResult {
  const startedAt = performance.now();
  guard(input.signal, startedAt);
  const parsed = FoundryPotreeV2BundleAssetV7Schema.safeParse(input.bundle);
  if (!parsed.success) return { outcome: failureOutcome(input.bundle, "POTREE_V2_POINT_VALUES_BUNDLE_INVALID"), previewFiles: [] };
  const bundle = parsed.data;
  const preflight = preflightPotreeV2PointValues(bundle);
  if (preflight !== null) return { outcome: preflight, previewFiles: [] };
  try {
    const hierarchyIdentity = bundle.members.find(
      (member) => member.role === "hierarchy",
    );
    const octreeIdentity = bundle.members.find(
      (member) => member.role === "octree",
    );
    if (
      hierarchyIdentity === undefined ||
      octreeIdentity === undefined ||
      hierarchyIdentity.sizeBytes !== input.hierarchyBytes.byteLength ||
      octreeIdentity.sizeBytes !== input.octreeBytes.byteLength
    ) {
      throw new PointValueFailure(
        "POTREE_V2_POINT_VALUES_MEMBER_IDENTITY_MISMATCH",
      );
    }
    const hierarchyBytes = Buffer.isBuffer(input.hierarchyBytes)
      ? input.hierarchyBytes
      : Buffer.from(input.hierarchyBytes);
    const octreeBytes = Buffer.isBuffer(input.octreeBytes)
      ? input.octreeBytes
      : Buffer.from(input.octreeBytes);
    if (
        sha256(hierarchyBytes) !== hierarchyIdentity.sha256 || sha256(octreeBytes) !== octreeIdentity.sha256) {
      throw new PointValueFailure("POTREE_V2_POINT_VALUES_MEMBER_IDENTITY_MISMATCH");
    }
    guard(input.signal, startedAt);
    const ranges = parseHierarchy(bundle, hierarchyBytes, input.signal, startedAt);
    const scan = scanValues(bundle, octreeBytes, ranges, input.signal, startedAt);
    const facts = bundle.facts;
    if (facts === null) throw new PointValueFailure("POTREE_V2_POINT_VALUES_INSPECTION_FAILED");
    const exactProfile = deepProfile(scan, facts.metadata);
    const qualityWarnings = exactProfile.state === "performed" &&
      exactProfile.maximumPositionMultiplicity > 1 &&
      (exactProfile.maximumPositionMultiplicity - 1) /
        facts.metadata.pointCount >= DUPLICATE_CONCENTRATION_RATE
      ? ["exact_position_duplicate_concentration_observed"] as const
      : [] as const;
    const previews = renderPreviews(bundle, octreeBytes, scan, input.signal, startedAt);
    guard(input.signal, startedAt);
    if (sha256(hierarchyBytes) !== hierarchyIdentity.sha256 || sha256(octreeBytes) !== octreeIdentity.sha256) {
      throw new PointValueFailure("POTREE_V2_POINT_VALUES_MEMBER_IDENTITY_MISMATCH");
    }
    const pointFacts = FoundryPotreeV2PointValueFactsSchema.parse({
      schemaVersion: "omnitwin.foundry.potree-v2-point-values.v1",
      profile: "xgrids_default_14_byte_full_numeric_decode_and_triplanar_preview",
      authority: "none",
      bundleRoot: bundle.bundleRoot,
      bundleSha256: bundle.bundleSha256,
      recordCount: facts.metadata.pointCount,
      recordStrideBytes: 14,
      position: {
        rawMin: scan.rawMin,
        rawMax: scan.rawMax,
        decodedMin: scan.decodedMin,
        decodedMax: scan.decodedMax,
        finiteComponentCount: facts.metadata.pointCount * 3,
        nodeBoundsViolationCount: 0,
        declaredRangeSatisfied: true,
        toleranceByAxis: facts.metadata.declaredScale,
      },
      intensity: distribution(scan.intensityHistogram, scan.intensitySum, 12),
      opaqueVendorByte: { ...distribution(scan.vendorHistogram, scan.vendorSum, 13), declaredName: "lcc prediction", semantics: "not_established" },
      deepProfile: exactProfile,
      qualityWarnings,
      previews: previews.manifest,
      limitations: [
        "NUMERIC_COORDINATES_DO_NOT_ESTABLISH_UNITS_FRAME_CRS_ACCURACY_OR_PHYSICAL_MEANING",
        "CPU_RASTERS_ARE_DIAGNOSTIC_PREVIEWS_NOT_OFFICIAL_VIEWER_FIDELITY_EVIDENCE",
        "THE_OPAQUE_VENDOR_BYTE_REMAINS_SEMANTICALLY_UNKNOWN",
        "DUPLICATE_CONCENTRATION_IS_AN_OBSERVATION_NOT A CORRUPTION_OR_CAUSE CLAIM",
      ],
    });
    return {
      outcome: FoundryPotreeV2PointValuesOutcomeSchema.parse({
        bundleRoot: bundle.bundleRoot,
        bundleSha256: bundle.bundleSha256,
        state: "established",
        category: "established",
        code: "POTREE_V2_POINT_VALUES_ESTABLISHED",
        coverage: "all_records_numeric_values_and_deterministic_previews",
        facts: pointFacts,
      }),
      previewFiles: previews.files,
    };
  } catch (error) {
    if (error instanceof FoundryPotreeV2PointValuesCancellationError) throw error;
    const code = error instanceof PointValueFailure
      ? error.code
      : "POTREE_V2_POINT_VALUES_INSPECTION_FAILED";
    return { outcome: failureOutcome(bundle, code), previewFiles: [] };
  }
}

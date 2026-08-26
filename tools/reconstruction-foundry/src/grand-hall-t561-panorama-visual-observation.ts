import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import {
  domainSeparatedSha256,
  sha256RegularFileWithHead,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import sharp from "sharp";
import { z } from "zod";

import {
  GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
  GRAND_HALL_T554_EXPECTED_HEIGHT_PX,
  GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
  GRAND_HALL_T554_EXPECTED_WIDTH_PX,
  assertGrandHallT554ExistingReviewOutputSafety,
  assertGrandHallT554ReviewOutputSafety,
  collectGrandHallT554PanoramaInventory,
  parseGrandHallT554PanoramaFilename,
  readGrandHallT554StablePanoramaBytes,
  verifyPersistedGrandHallT554PanoramaReviewPack,
  type GrandHallT554PanoramaInventory,
  type GrandHallT554PanoramaInventoryFile,
} from "./grand-hall-t554-panorama-review.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T561_OBSERVATION_INPUT_SCHEMA =
  "omnitwin.foundry.grand-hall-t561-panorama-visual-observation-input.v1";
export const GRAND_HALL_T561_OBSERVATION_MANIFEST_SCHEMA =
  "omnitwin.foundry.grand-hall-t561-panorama-visual-observation-pack.v1";
export const GRAND_HALL_T561_OBSERVATION_RECEIPT_SCHEMA =
  "omnitwin.foundry.grand-hall-t561-panorama-visual-observation-receipt.v1";
export const GRAND_HALL_T561_OBSERVATION_INPUT_DOMAIN =
  "OMNITWIN_GRAND_HALL_T561_PANORAMA_VISUAL_OBSERVATION_INPUT_V1";
export const GRAND_HALL_T561_OBSERVATION_MANIFEST_DOMAIN =
  "OMNITWIN_GRAND_HALL_T561_PANORAMA_VISUAL_OBSERVATION_MANIFEST_V1";
export const GRAND_HALL_T561_OBSERVATION_RECEIPT_DOMAIN =
  "OMNITWIN_GRAND_HALL_T561_PANORAMA_VISUAL_OBSERVATION_RECEIPT_V1";
export const GRAND_HALL_T561_ROI_SET_DOMAIN =
  "OMNITWIN_GRAND_HALL_T561_PANORAMA_VISUAL_OBSERVATION_ROI_SET_V1";
export const GRAND_HALL_T561_MANIFEST_FILENAME =
  "panorama-visual-observations-authority-none.json";
export const GRAND_HALL_T561_RECEIPT_FILENAME = "publication-receipt.json";
export const GRAND_HALL_T561_PRESENT_SOURCE_COUNT = 148;
export const GRAND_HALL_T561_ABSENT_SWEEP_NUMBER = 93;
export const GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX = 2_048;
export const GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX = 1_024;
export const GRAND_HALL_T561_REVIEW_AID_HEIGHT_PX = 1_152;

const MAX_OBSERVATION_INPUT_BYTES = 4 * 1_024 * 1_024;
const MAX_MANIFEST_BYTES = 8 * 1_024 * 1_024;
const MAX_RECEIPT_BYTES = 2 * 1_024 * 1_024;
const MAX_REVIEW_AID_BYTES = 32 * 1_024 * 1_024;
const REVIEW_AID_FOOTER_HEIGHT_PX =
  GRAND_HALL_T561_REVIEW_AID_HEIGHT_PX - GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX;
const REVIEW_AID_RESAMPLING_KERNEL = "lanczos3";

type Sha256 = `sha256:${string}`;
type Rgb = readonly [number, number, number];

const Sha256Schema = z.string()
  .regex(/^sha256:[0-9a-f]{64}$/u)
  .transform((value): Sha256 => value as Sha256);
export const GrandHallT561SourcePixelRectangleSchema = z.object({
  x: z.number().int().min(0).max(GRAND_HALL_T554_EXPECTED_WIDTH_PX - 1),
  y: z.number().int().min(0).max(GRAND_HALL_T554_EXPECTED_HEIGHT_PX - 1),
  width: z.number().int().positive().max(GRAND_HALL_T554_EXPECTED_WIDTH_PX),
  height: z.number().int().positive().max(GRAND_HALL_T554_EXPECTED_HEIGHT_PX),
}).strict().superRefine((rectangle, context) => {
  if (
    rectangle.x + rectangle.width > GRAND_HALL_T554_EXPECTED_WIDTH_PX ||
    rectangle.y + rectangle.height > GRAND_HALL_T554_EXPECTED_HEIGHT_PX
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "ROI rectangle exceeds the source grid." });
  }
});
export const GrandHallT561AttentionRegionSchema = z.object({
  regionId: z.string().regex(/^s(?:00[1-9]|0[1-9][0-9]|1[0-4][0-9])-r(?:0[1-9]|[1-9][0-9])$/u),
  contentHint: z.enum([
    "grand_hall_pixels",
    "non_grand_hall_or_unknown_pixels",
    "visual_boundary_uncertain",
  ]),
  coordinateSpace: z.literal("source_equirectangular_pixels_top_left_origin"),
  coverageIntent: z.literal("conservative_attention_area"),
  wrapsHorizontalSeam: z.boolean(),
  sourcePixelRectangles: z.array(GrandHallT561SourcePixelRectangleSchema).min(1).max(2),
  authority: z.literal("none"),
}).strict().superRefine((region, context) => {
  const rectangles = region.sourcePixelRectangles;
  if (!region.wrapsHorizontalSeam && rectangles.length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A non-wrapping ROI has exactly one rectangle." });
  }
  if (region.wrapsHorizontalSeam) {
    const touchesLeft = rectangles.some((rectangle) => rectangle.x === 0);
    const touchesRight = rectangles.some(
      (rectangle) => rectangle.x + rectangle.width === GRAND_HALL_T554_EXPECTED_WIDTH_PX,
    );
    if (rectangles.length !== 2 || !touchesLeft || !touchesRight) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A seam-wrapping ROI requires two rectangles touching opposite horizontal edges.",
      });
    }
  }
});
export const GrandHallT561ObservationStateSchema = z.enum([
  "grand_hall_pixels_observed",
  "no_grand_hall_pixels_observed",
  "uncertain_possible_grand_hall_pixels",
]);
export const GrandHallT561FrameContextSchema = z.enum([
  "broad_grand_hall_view",
  "mixed_boundary_frame",
  "localized_grand_hall_pixels",
  "no_grand_hall_pixels_observed",
  "uncertain",
]);
export const GrandHallT561ObservationRecordSchema = z.object({
  sweepNumber: z.number().int().min(1).max(149).refine((value) => value !== 93),
  relativePath: z.string().regex(/^sweep_[0-9]{3,4}(?:jpg|pg)\.jpg$/u),
  byteLength: z.number().int().positive().max(16 * 1_024 * 1_024),
  sha256: Sha256Schema,
  widthPx: z.literal(GRAND_HALL_T554_EXPECTED_WIDTH_PX),
  heightPx: z.literal(GRAND_HALL_T554_EXPECTED_HEIGHT_PX),
  observationState: GrandHallT561ObservationStateSchema,
  frameContext: GrandHallT561FrameContextSchema,
  boundarySensitive: z.boolean(),
  attentionRegions: z.array(GrandHallT561AttentionRegionSchema).max(16),
  note: z.string().trim().min(1).max(500).refine((value) => value === value.normalize("NFC")),
  authority: z.literal("none"),
  humanReviewState: z.literal("pending"),
  roomMembershipAuthority: z.literal("none"),
  cameraPoseAuthority: z.literal("none"),
  maskAuthority: z.literal("none"),
  trainingInputPermitted: z.literal(false),
  reconstructionInputPermitted: z.literal(false),
  runtimeInputPermitted: z.literal(false),
  publicEvidencePermitted: z.literal(false),
}).strict().superRefine((record, context) => {
  validateObservationSemantics(record, context);
});
/**
 * Exact authoring contract before its semantic digest is added. Records must be
 * ordered by sweep 1..149 with sweep 93 omitted; sweep 93 lives only in the
 * one-element absentSources tuple. Pass the complete material to
 * sealGrandHallT561ObservationInput rather than hand-authoring its digest.
 */
export const GrandHallT561ObservationInputMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T561_OBSERVATION_INPUT_SCHEMA),
  subject: z.object({
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    taskId: z.literal("T-561"),
    scope: z.literal("agent_visual_observation_of_all_supplied_panoramas"),
  }).strict(),
  authority: z.literal("none"),
  inspection: z.object({
    method: z.literal("agent_visual_review_of_exact_source_file"),
    displayedWidthPx: z.literal(GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX),
    displayedHeightPx: z.literal(GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX),
    displayMayHaveBeenResampled: z.literal(true),
    nativeResolutionHumanReviewCompleted: z.literal(false),
    humanAcceptanceRecorded: z.literal(false),
  }).strict(),
  sourceBindings: z.object({
    t554PanoramaManifestSha256: z.literal(GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256),
    panoramaInventorySha256: z.literal(GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256),
    presentSourceCount: z.literal(GRAND_HALL_T561_PRESENT_SOURCE_COUNT),
    absentSweepNumbersWithin1To149: z.tuple([z.literal(GRAND_HALL_T561_ABSENT_SWEEP_NUMBER)]),
  }).strict(),
  records: z.array(GrandHallT561ObservationRecordSchema).length(GRAND_HALL_T561_PRESENT_SOURCE_COUNT),
  absentSources: z.tuple([z.object({
    sweepNumber: z.literal(GRAND_HALL_T561_ABSENT_SWEEP_NUMBER),
    sourceState: z.literal("absent_from_exact_supplied_inventory"),
    visualObservationState: z.literal("not_observable_source_absent"),
    authority: z.literal("none"),
  }).strict()]),
}).strict();
export const GrandHallT561ObservationInputSchema = GrandHallT561ObservationInputMaterialSchema.extend({
  observationSetSha256: Sha256Schema,
}).strict();

export type GrandHallT561AttentionRegion = z.infer<typeof GrandHallT561AttentionRegionSchema>;
export type GrandHallT561ObservationRecord = z.infer<typeof GrandHallT561ObservationRecordSchema>;
export type GrandHallT561ObservationInputMaterial = z.infer<typeof GrandHallT561ObservationInputMaterialSchema>;
export type GrandHallT561ObservationInput = z.infer<typeof GrandHallT561ObservationInputSchema>;

const REVIEW_AID_WARNINGS = Object.freeze([
  "This is a resampled visual-attention aid, not a panorama mask.",
  "Inside or outside an attention rectangle establishes no room-membership or pixel authority.",
] as const);
const PACK_WARNINGS = Object.freeze([
  "Visual observations remain agent-authored, authority-none, and human-pending.",
  "No Grand Hall pixels observed means none were noticed in this review; it is not proof of absence or an exclusion decision.",
  "The 2048x1024 inspection display may have been resampled; native-resolution human review is not complete.",
  "No observation or review aid grants mask, pose, training, reconstruction, runtime, staging, public, or architectural authority.",
] as const);

const ReviewAidEvidenceSchema = z.object({
  relativePath: z.string().regex(/^boundary-attention-sweep-[0-9]{3}-review-only\.png$/u),
  sourceSweepNumber: z.number().int().min(1).max(149).refine((value) => value !== 93),
  sourceJpegSha256: Sha256Schema,
  roiSetSha256: Sha256Schema,
  mediaType: z.literal("image/png"),
  sourceDisplayWidthPx: z.literal(GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX),
  sourceDisplayHeightPx: z.literal(GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX),
  widthPx: z.literal(GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX),
  heightPx: z.literal(GRAND_HALL_T561_REVIEW_AID_HEIGHT_PX),
  byteLength: z.number().int().positive().max(MAX_REVIEW_AID_BYTES),
  sha256: Sha256Schema,
  authority: z.literal("none"),
  role: z.literal("resampled_non_mask_visual_attention_aid"),
  maskAuthority: z.literal("none"),
  reconstructionInputPermitted: z.literal(false),
  warnings: z.tuple([
    z.literal(REVIEW_AID_WARNINGS[0]),
    z.literal(REVIEW_AID_WARNINGS[1]),
  ]),
}).strict();

export type GrandHallT561ReviewAidEvidence = z.infer<typeof ReviewAidEvidenceSchema>;
export interface GrandHallT561RenderedReviewAid extends GrandHallT561ReviewAidEvidence {
  readonly bytes: Buffer;
}

const GuardSchema = z.object({
  sourceMutationPermitted: z.literal(false),
  humanAcceptanceRecorded: z.literal(false),
  nativeResolutionHumanReviewCompleted: z.literal(false),
  roomMembershipAuthority: z.literal("none"),
  cameraStationInferred: z.literal(false),
  cameraPoseAuthority: z.literal("none"),
  maskGenerated: z.literal(false),
  maskAuthority: z.literal("none"),
  t550CandidateSetChanged: z.literal(false),
  t554AcceptanceAuthorized: z.literal(false),
  trainingAuthorized: z.literal(false),
  reconstructionAuthorized: z.literal(false),
  runtimeAuthorized: z.literal(false),
  stagingAuthorized: z.literal(false),
  publicEvidenceAuthorized: z.literal(false),
  generatedContentUsed: z.literal(false),
}).strict();
const FIXED_GUARDS = Object.freeze({
  sourceMutationPermitted: false,
  humanAcceptanceRecorded: false,
  nativeResolutionHumanReviewCompleted: false,
  roomMembershipAuthority: "none",
  cameraStationInferred: false,
  cameraPoseAuthority: "none",
  maskGenerated: false,
  maskAuthority: "none",
  t550CandidateSetChanged: false,
  t554AcceptanceAuthorized: false,
  trainingAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  stagingAuthorized: false,
  publicEvidenceAuthorized: false,
  generatedContentUsed: false,
} as const);

const ManifestMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T561_OBSERVATION_MANIFEST_SCHEMA),
  subject: GrandHallT561ObservationInputMaterialSchema.shape.subject,
  authority: z.literal("none"),
  reviewState: z.literal("agent_observation_complete_human_pending"),
  sourceBindings: z.object({
    t554PanoramaManifestSha256: z.literal(GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256),
    panoramaInventorySha256: z.literal(GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256),
    presentSourceCount: z.literal(GRAND_HALL_T561_PRESENT_SOURCE_COUNT),
    absentSweepNumbersWithin1To149: z.tuple([z.literal(GRAND_HALL_T561_ABSENT_SWEEP_NUMBER)]),
    observationInputFileSha256: Sha256Schema,
    observationInputFileByteLength: z.number().int().positive().max(MAX_OBSERVATION_INPUT_BYTES),
    observationSetSha256: Sha256Schema,
  }).strict(),
  inspection: GrandHallT561ObservationInputMaterialSchema.shape.inspection,
  records: z.array(GrandHallT561ObservationRecordSchema).length(GRAND_HALL_T561_PRESENT_SOURCE_COUNT),
  absentSources: GrandHallT561ObservationInputMaterialSchema.shape.absentSources,
  summary: z.object({
    grandHallPixelsObservedCount: z.number().int().min(0).max(148),
    noGrandHallPixelsObservedCount: z.number().int().min(0).max(148),
    uncertainPossibleGrandHallPixelsCount: z.number().int().min(0).max(148),
    boundarySensitiveRecordCount: z.number().int().min(0).max(148),
    reviewAidCount: z.number().int().min(0).max(148),
    outOfCurrentCandidateSetObservedOrUncertainSweeps: z.array(
      z.number().int().min(51).max(149).refine((value) => value !== 93),
    ).max(98),
    t554Implication: z.literal("human_confirmation_required_before_any_candidate_set_rebuild"),
  }).strict(),
  reviewAids: z.array(ReviewAidEvidenceSchema).max(148),
  guards: GuardSchema,
  toolchain: z.object({
    nodeVersion: z.string().min(1).max(40),
    sharpVersion: z.string().min(1).max(40),
    libvipsVersion: z.string().min(1).max(40),
    resamplingKernel: z.literal(REVIEW_AID_RESAMPLING_KERNEL),
    labelRenderer: z.literal("embedded_3x5_bitmap_font_v1"),
    outputEncoding: z.literal("png_rgb8_no_metadata"),
  }).strict(),
  proof: z.object({
    exactT554PanoramaPackVerified: z.literal(true),
    exactPanoramaInventoryVerified: z.literal(true),
    everyPresentSourceIdentityMatchedObservation: z.literal(true),
    everyPresentSourceVisuallyDispositioned: z.literal(true),
    absentSweep93RepresentedWithoutFabricatedIdentity: z.literal(true),
    reviewAidsDerivedOnlyFromBoundSourceBytesAndInputRois: z.literal(true),
    sourceWrites: z.literal("none"),
    networkRequests: z.literal("none"),
  }).strict(),
  warnings: z.tuple([
    z.literal(PACK_WARNINGS[0]),
    z.literal(PACK_WARNINGS[1]),
    z.literal(PACK_WARNINGS[2]),
    z.literal(PACK_WARNINGS[3]),
  ]),
}).strict();
const ManifestSchema = ManifestMaterialSchema.extend({ manifestSha256: Sha256Schema }).strict();

export type GrandHallT561ObservationManifest = z.infer<typeof ManifestSchema>;

const PayloadEvidenceSchema = z.object({
  relativePath: z.string().refine(
    (value) => value === GRAND_HALL_T561_MANIFEST_FILENAME ||
      /^boundary-attention-sweep-[0-9]{3}-review-only\.png$/u.test(value),
    "Payload path is not a permitted flat T-561 output name.",
  ),
  byteLength: z.number().int().positive().max(MAX_REVIEW_AID_BYTES),
  sha256: Sha256Schema,
}).strict();
const ReceiptMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T561_OBSERVATION_RECEIPT_SCHEMA),
  state: z.literal("complete"),
  authority: z.literal("none"),
  manifestSha256: Sha256Schema,
  panoramaInventorySha256: z.literal(GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256),
  observationSetSha256: Sha256Schema,
  payloadFileCount: z.number().int().min(1).max(149),
  outputFileCount: z.number().int().min(2).max(150),
  payloads: z.array(PayloadEvidenceSchema).min(1).max(149),
  guards: GuardSchema,
}).strict();
const ReceiptSchema = ReceiptMaterialSchema.extend({ receiptSha256: Sha256Schema }).strict();
export type GrandHallT561ObservationReceipt = z.infer<typeof ReceiptSchema>;

export class GrandHallT561PanoramaVisualObservationError extends Error {
  public constructor(
    public readonly code:
      | "ARGUMENT_INVALID"
      | "INPUT_INVALID"
      | "SOURCE_MISMATCH"
      | "OUTPUT_UNSAFE"
      | "OUTPUT_PUBLISH_FAILED"
      | "OUTPUT_VERIFICATION_FAILED"
      | "RENDER_FAILED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT561PanoramaVisualObservationError";
  }
}

function validateObservationSemantics(
  record: {
    readonly sweepNumber: number;
    readonly observationState: z.infer<typeof GrandHallT561ObservationStateSchema>;
    readonly frameContext: z.infer<typeof GrandHallT561FrameContextSchema>;
    readonly boundarySensitive: boolean;
    readonly attentionRegions: readonly GrandHallT561AttentionRegion[];
  },
  context: z.RefinementCtx,
): void {
  const regions = record.attentionRegions;
  const expectedPrefix = `s${String(record.sweepNumber).padStart(3, "0")}-`;
  if (new Set(regions.map((region) => region.regionId)).size !== regions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "ROI region ids must be unique." });
  }
  if (regions.some((region) => !region.regionId.startsWith(expectedPrefix))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "ROI region ids must match their sweep." });
  }
  if (regions.some((region, index) => region.regionId !== `${expectedPrefix}r${String(index + 1).padStart(2, "0")}`)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "ROI region ids must be sequential and ordered." });
  }
  if (record.boundarySensitive !== (regions.length > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Boundary sensitivity and ROI presence disagree." });
  }
  if (record.observationState === "no_grand_hall_pixels_observed") {
    if (record.frameContext !== "no_grand_hall_pixels_observed" || regions.length !== 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "No-observed records cannot carry boundary ROIs." });
    }
    return;
  }
  if (record.observationState === "grand_hall_pixels_observed") {
    const allowed = ["broad_grand_hall_view", "mixed_boundary_frame", "localized_grand_hall_pixels"];
    if (!allowed.includes(record.frameContext)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Observed Grand Hall pixels require a compatible frame context." });
    }
    if (record.frameContext !== "broad_grand_hall_view" && regions.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Boundary-sensitive positive records require a review ROI." });
    }
    if (record.frameContext === "broad_grand_hall_view" && regions.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Broad non-boundary records cannot carry boundary ROIs." });
    }
    return;
  }
  if (record.frameContext !== "uncertain") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Uncertain observations require the uncertain frame context." });
  }
}

function expectedSweepNumbers(): readonly number[] {
  return Array.from({ length: 149 }, (_, index) => index + 1)
    .filter((sweepNumber) => sweepNumber !== GRAND_HALL_T561_ABSENT_SWEEP_NUMBER);
}

function digestMaterial(domain: string, material: unknown): Sha256 {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(material))}`;
}

export function sealGrandHallT561ObservationInput(
  material: GrandHallT561ObservationInputMaterial,
): GrandHallT561ObservationInput {
  const parsed = GrandHallT561ObservationInputMaterialSchema.parse(material);
  assertObservationCoverage(parsed.records);
  return GrandHallT561ObservationInputSchema.parse({
    ...parsed,
    observationSetSha256: digestMaterial(GRAND_HALL_T561_OBSERVATION_INPUT_DOMAIN, parsed),
  });
}

/** Deterministic UTF-8/LF authoring form for a sealed observation input. */
export function serializeGrandHallT561ObservationInput(
  input: GrandHallT561ObservationInput,
): Buffer {
  const parsed = GrandHallT561ObservationInputSchema.parse(input);
  const { observationSetSha256, ...material } = parsed;
  if (observationSetSha256 !== digestMaterial(GRAND_HALL_T561_OBSERVATION_INPUT_DOMAIN, material)) {
    throw new GrandHallT561PanoramaVisualObservationError("INPUT_INVALID", "Observation input semantic digest is invalid.");
  }
  assertObservationCoverage(parsed.records);
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export function parseGrandHallT561ObservationInput(bytes: Buffer): GrandHallT561ObservationInput {
  let parsed: GrandHallT561ObservationInput;
  try {
    parsed = GrandHallT561ObservationInputSchema.parse(parseGrandHallT554StrictJson(bytes));
  } catch (error) {
    throw new GrandHallT561PanoramaVisualObservationError(
      "INPUT_INVALID",
      "Observation input is not strict valid T-561 JSON.",
      error,
    );
  }
  const { observationSetSha256, ...material } = parsed;
  if (observationSetSha256 !== digestMaterial(GRAND_HALL_T561_OBSERVATION_INPUT_DOMAIN, material)) {
    throw new GrandHallT561PanoramaVisualObservationError(
      "INPUT_INVALID",
      "Observation input semantic digest is invalid.",
    );
  }
  assertObservationCoverage(parsed.records);
  return parsed;
}

function assertObservationCoverage(records: readonly GrandHallT561ObservationRecord[]): void {
  const expected = expectedSweepNumbers();
  records.forEach((record, index) => {
    const expectedSweep = expected[index];
    const parsedName = parseGrandHallT554PanoramaFilename(record.relativePath);
    if (expectedSweep === undefined || record.sweepNumber !== expectedSweep) {
      throw new GrandHallT561PanoramaVisualObservationError(
        "INPUT_INVALID",
        "Observation records must cover all 148 present sweeps in exact numeric order.",
      );
    }
    if (parsedName.sweepNumber !== record.sweepNumber) {
      throw new GrandHallT561PanoramaVisualObservationError(
        "INPUT_INVALID",
        `Sweep ${String(record.sweepNumber)} filename and numeric identity disagree.`,
      );
    }
  });
}

function assertInventoryMatchesInput(
  inventory: GrandHallT554PanoramaInventory,
  input: GrandHallT561ObservationInput,
): void {
  if (
    inventory.fileCount !== GRAND_HALL_T561_PRESENT_SOURCE_COUNT ||
    inventory.inventorySha256 !== GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256 ||
    inventory.missingSweepNumbersWithin1To149.join(",") !== String(GRAND_HALL_T561_ABSENT_SWEEP_NUMBER)
  ) {
    throw new GrandHallT561PanoramaVisualObservationError(
      "SOURCE_MISMATCH",
      "Panorama source inventory is not the exact bound 148-file inventory.",
    );
  }
  inventory.files.forEach((source, index) => {
    const observation = input.records[index];
    if (observation === undefined || !sameSourceIdentity(source, observation)) {
      throw new GrandHallT561PanoramaVisualObservationError(
        "SOURCE_MISMATCH",
        `Sweep ${String(source.sweepNumber)} differs from its observation source binding.`,
      );
    }
  });
}

function sameSourceIdentity(
  source: GrandHallT554PanoramaInventoryFile,
  observation: GrandHallT561ObservationRecord,
): boolean {
  return source.sweepNumber === observation.sweepNumber &&
    source.relativePath === observation.relativePath &&
    source.byteLength === observation.byteLength &&
    source.sha256 === observation.sha256 &&
    source.widthPx === observation.widthPx &&
    source.heightPx === observation.heightPx;
}

interface StableFileBytes {
  readonly absolutePath: string;
  readonly bytes: Buffer;
  readonly sha256: Sha256;
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replaceAll("/", "\\").replace(/[\\]+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function readStableDirectFile(path: string, maximumBytes: number): Promise<StableFileBytes> {
  if (!isAbsolute(path)) {
    throw new GrandHallT561PanoramaVisualObservationError("INPUT_INVALID", "Observation input path must be absolute.");
  }
  const absolutePath = resolve(path);
  const before = await lstat(absolutePath);
  const canonical = await realpath(absolutePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || comparablePath(canonical) !== comparablePath(absolutePath)) {
    throw new GrandHallT561PanoramaVisualObservationError("INPUT_INVALID", "Observation input must be one direct regular file with one link.");
  }
  let bytes: Buffer | undefined;
  const digest = await sha256RegularFileWithHead(
    absolutePath,
    0,
    undefined,
    undefined,
    undefined,
    async (handle: FileHandle, sizeBytes: number, sourceSha256: string) => {
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maximumBytes) {
        throw new GrandHallT561PanoramaVisualObservationError("INPUT_INVALID", "Observation input exceeds its bounded size.");
      }
      bytes = await readHandleExactly(handle, sizeBytes);
      if (createHash("sha256").update(bytes).digest("hex") !== sourceSha256) {
        throw new GrandHallT561PanoramaVisualObservationError("INPUT_INVALID", "Observation input changed during stable read.");
      }
    },
  );
  const after = await lstat(absolutePath);
  if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || before.dev !== after.dev || before.ino !== after.ino) {
    throw new GrandHallT561PanoramaVisualObservationError("INPUT_INVALID", "Observation input identity changed during read.");
  }
  if (bytes === undefined) throw new GrandHallT561PanoramaVisualObservationError("INPUT_INVALID", "Observation input bytes were not captured.");
  return { absolutePath, bytes, sha256: `sha256:${digest.sha256}` };
}

async function readHandleExactly(
  handle: FileHandle,
  sizeBytes: number,
): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(sizeBytes);
  let offset = 0;
  while (offset < sizeBytes) {
    const result = await handle.read(bytes, offset, sizeBytes - offset, offset);
    if (result.bytesRead < 1) throw new Error("File ended during bounded stable read.");
    offset += result.bytesRead;
  }
  return bytes;
}

const FONT_3X5: Readonly<Record<string, string>> = Object.freeze({
  " ": "000000000000000", "-": "000000111000000", "/": "001001010100100",
  "0": "111101101101111", "1": "010110010010111", "2": "110001010100111",
  "3": "110001010001110", "4": "101101111001001", "5": "111100110001110",
  "6": "111100111101111", "7": "111001010010010", "8": "111101111101111",
  "9": "111101111001110", A: "010101111101101", B: "110101110101110",
  C: "011100100100011", D: "110101101101110", E: "111100110100111",
  F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101",
  L: "100100100100111", M: "101111111101101", N: "101111111111101",
  O: "010101101101010", P: "110101110100100", Q: "010101101111011",
  R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101",
  X: "101101010101101", Y: "101101010010010", Z: "111001010100111",
});

function setRgb(canvas: Buffer, width: number, x: number, y: number, color: Rgb): void {
  const offset = (y * width + x) * 3;
  canvas[offset] = color[0];
  canvas[offset + 1] = color[1];
  canvas[offset + 2] = color[2];
}

function fillRectangle(
  canvas: Buffer,
  canvasWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgb,
): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) setRgb(canvas, canvasWidth, px, py, color);
  }
}

function drawText(
  canvas: Buffer,
  canvasWidth: number,
  x: number,
  y: number,
  value: string,
  scale: number,
  color: Rgb,
): void {
  let cursor = x;
  for (const character of value.toUpperCase()) {
    const glyph = FONT_3X5[character] ?? "000000000000000";
    for (let index = 0; index < glyph.length; index += 1) {
      if (glyph[index] !== "1") continue;
      const gx = index % 3;
      const gy = Math.floor(index / 3);
      fillRectangle(canvas, canvasWidth, cursor + gx * scale, y + gy * scale, scale, scale, color);
    }
    cursor += 4 * scale;
  }
}

function roiColor(hint: GrandHallT561AttentionRegion["contentHint"]): Rgb {
  if (hint === "grand_hall_pixels") return [49, 170, 116];
  if (hint === "non_grand_hall_or_unknown_pixels") return [218, 76, 76];
  return [214, 169, 78];
}

function drawOutline(
  canvas: Buffer,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgb,
): void {
  const lineWidth = Math.min(4, width, height);
  fillRectangle(canvas, GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX, x, y, width, lineWidth, color);
  fillRectangle(canvas, GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX, x, y + height - lineWidth, width, lineWidth, color);
  fillRectangle(canvas, GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX, x, y, lineWidth, height, color);
  fillRectangle(canvas, GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX, x + width - lineWidth, y, lineWidth, height, color);
}

function drawAttentionRegions(canvas: Buffer, record: GrandHallT561ObservationRecord): void {
  const scaleX = GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX / record.widthPx;
  const scaleY = GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX / record.heightPx;
  for (const region of record.attentionRegions) {
    for (const rectangle of region.sourcePixelRectangles) {
      const left = Math.min(
        GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX - 1,
        Math.floor(rectangle.x * scaleX),
      );
      const top = Math.min(
        GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX - 1,
        Math.floor(rectangle.y * scaleY),
      );
      const right = Math.min(
        GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX,
        Math.max(left + 1, Math.ceil((rectangle.x + rectangle.width) * scaleX)),
      );
      const bottom = Math.min(
        GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX,
        Math.max(top + 1, Math.ceil((rectangle.y + rectangle.height) * scaleY)),
      );
      drawOutline(canvas, left, top, right - left, bottom - top, roiColor(region.contentHint));
    }
  }
}

function reviewAidFileName(sweepNumber: number): string {
  return `boundary-attention-sweep-${String(sweepNumber).padStart(3, "0")}-review-only.png`;
}

async function renderReviewAidPng(
  sourceBytes: Buffer,
  record: GrandHallT561ObservationRecord,
): Promise<Buffer> {
  const resized = await sharp(sourceBytes, {
    failOn: "error",
    limitInputPixels: Math.max(record.widthPx * record.heightPx, 1),
  }).resize(GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX, GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX, {
    fit: "fill",
    kernel: REVIEW_AID_RESAMPLING_KERNEL,
  }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  const canvas = Buffer.alloc(
    GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX * GRAND_HALL_T561_REVIEW_AID_HEIGHT_PX * 3,
    5,
  );
  resized.copy(canvas, 0);
  drawAttentionRegions(canvas, record);
  fillRectangle(
    canvas,
    GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX,
    0,
    GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX,
    GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX,
    REVIEW_AID_FOOTER_HEIGHT_PX,
    [5, 10, 13],
  );
  drawText(canvas, GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX, 24, 1_056, `SWEEP ${String(record.sweepNumber).padStart(3, "0")} / REVIEW AID ONLY / NOT A MASK / AUTHORITY NONE`, 4, [214, 169, 78]);
  return sharp(canvas, {
    raw: { width: GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX, height: GRAND_HALL_T561_REVIEW_AID_HEIGHT_PX, channels: 3 },
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
}

function buildReviewAidEvidence(
  record: GrandHallT561ObservationRecord,
  bytes: Buffer,
): GrandHallT561RenderedReviewAid {
  return {
    ...ReviewAidEvidenceSchema.parse({
      relativePath: reviewAidFileName(record.sweepNumber),
      sourceSweepNumber: record.sweepNumber,
      sourceJpegSha256: record.sha256,
      roiSetSha256: digestMaterial(GRAND_HALL_T561_ROI_SET_DOMAIN, record.attentionRegions),
      mediaType: "image/png",
      sourceDisplayWidthPx: GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX,
      sourceDisplayHeightPx: GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX,
      widthPx: GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX,
      heightPx: GRAND_HALL_T561_REVIEW_AID_HEIGHT_PX,
      byteLength: bytes.length,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      authority: "none",
      role: "resampled_non_mask_visual_attention_aid",
      maskAuthority: "none",
      reconstructionInputPermitted: false,
      warnings: REVIEW_AID_WARNINGS,
    }),
    bytes,
  };
}

export async function renderGrandHallT561ReviewAid(
  sourceBytes: Buffer,
  record: GrandHallT561ObservationRecord,
): Promise<GrandHallT561RenderedReviewAid> {
  if (!record.boundarySensitive || record.attentionRegions.length === 0) {
    throw new GrandHallT561PanoramaVisualObservationError("RENDER_FAILED", "Only boundary-sensitive records produce review aids.");
  }
  try {
    return buildReviewAidEvidence(record, await renderReviewAidPng(sourceBytes, record));
  } catch (error) {
    if (error instanceof GrandHallT561PanoramaVisualObservationError) throw error;
    throw new GrandHallT561PanoramaVisualObservationError("RENDER_FAILED", `Review aid for sweep ${String(record.sweepNumber)} could not be rendered.`, error);
  }
}

interface InputFileEvidence {
  readonly sha256: Sha256;
  readonly byteLength: number;
}

function buildSummary(
  input: GrandHallT561ObservationInput,
  aids: readonly GrandHallT561RenderedReviewAid[],
): GrandHallT561ObservationManifest["summary"] {
  const count = (state: GrandHallT561ObservationRecord["observationState"]): number =>
    input.records.filter((record) => record.observationState === state).length;
  const outOfSet = input.records
    .filter((record) => record.sweepNumber > 50 && record.observationState !== "no_grand_hall_pixels_observed")
    .map((record) => record.sweepNumber);
  return {
    grandHallPixelsObservedCount: count("grand_hall_pixels_observed"),
    noGrandHallPixelsObservedCount: count("no_grand_hall_pixels_observed"),
    uncertainPossibleGrandHallPixelsCount: count("uncertain_possible_grand_hall_pixels"),
    boundarySensitiveRecordCount: input.records.filter((record) => record.boundarySensitive).length,
    reviewAidCount: aids.length,
    outOfCurrentCandidateSetObservedOrUncertainSweeps: outOfSet,
    t554Implication: "human_confirmation_required_before_any_candidate_set_rebuild",
  };
}

export function buildGrandHallT561ObservationManifest(
  input: GrandHallT561ObservationInput,
  inputFile: InputFileEvidence,
  aids: readonly GrandHallT561RenderedReviewAid[],
): GrandHallT561ObservationManifest {
  const material = ManifestMaterialSchema.parse({
    schemaVersion: GRAND_HALL_T561_OBSERVATION_MANIFEST_SCHEMA,
    subject: input.subject,
    authority: "none",
    reviewState: "agent_observation_complete_human_pending",
    sourceBindings: {
      ...input.sourceBindings,
      observationInputFileSha256: inputFile.sha256,
      observationInputFileByteLength: inputFile.byteLength,
      observationSetSha256: input.observationSetSha256,
    },
    inspection: input.inspection,
    records: input.records,
    absentSources: input.absentSources,
    summary: buildSummary(input, aids),
    reviewAids: aids.map(({ bytes: _bytes, ...evidence }) => evidence),
    guards: FIXED_GUARDS,
    toolchain: {
      nodeVersion: process.version,
      sharpVersion: sharp.versions.sharp,
      libvipsVersion: sharp.versions.vips,
      resamplingKernel: REVIEW_AID_RESAMPLING_KERNEL,
      labelRenderer: "embedded_3x5_bitmap_font_v1",
      outputEncoding: "png_rgb8_no_metadata",
    },
    proof: {
      exactT554PanoramaPackVerified: true,
      exactPanoramaInventoryVerified: true,
      everyPresentSourceIdentityMatchedObservation: true,
      everyPresentSourceVisuallyDispositioned: true,
      absentSweep93RepresentedWithoutFabricatedIdentity: true,
      reviewAidsDerivedOnlyFromBoundSourceBytesAndInputRois: true,
      sourceWrites: "none",
      networkRequests: "none",
    },
    warnings: PACK_WARNINGS,
  });
  const manifest = ManifestSchema.parse({
    ...material,
    manifestSha256: digestMaterial(GRAND_HALL_T561_OBSERVATION_MANIFEST_DOMAIN, material),
  });
  assertManifestCrossBindings(manifest);
  return manifest;
}

function serializeManifest(manifest: GrandHallT561ObservationManifest): Buffer {
  const { manifestSha256, ...material } = manifest;
  if (manifestSha256 !== digestMaterial(GRAND_HALL_T561_OBSERVATION_MANIFEST_DOMAIN, material)) {
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_PUBLISH_FAILED", "manifestSha256 is inconsistent.");
  }
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function serializeReceipt(receipt: GrandHallT561ObservationReceipt): Buffer {
  const { receiptSha256, ...material } = receipt;
  if (receiptSha256 !== digestMaterial(GRAND_HALL_T561_OBSERVATION_RECEIPT_DOMAIN, material)) {
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_PUBLISH_FAILED", "receiptSha256 is inconsistent.");
  }
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

function payloadEvidence(relativePath: string, bytes: Buffer): z.infer<typeof PayloadEvidenceSchema> {
  return PayloadEvidenceSchema.parse({
    relativePath,
    byteLength: bytes.length,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  });
}

function buildReceipt(
  manifest: GrandHallT561ObservationManifest,
  manifestBytes: Buffer,
  aids: readonly GrandHallT561RenderedReviewAid[],
): GrandHallT561ObservationReceipt {
  const payloads = [
    payloadEvidence(GRAND_HALL_T561_MANIFEST_FILENAME, manifestBytes),
    ...aids.map((aid) => payloadEvidence(aid.relativePath, aid.bytes)),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  const material = ReceiptMaterialSchema.parse({
    schemaVersion: GRAND_HALL_T561_OBSERVATION_RECEIPT_SCHEMA,
    state: "complete",
    authority: "none",
    manifestSha256: manifest.manifestSha256,
    panoramaInventorySha256: GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
    observationSetSha256: manifest.sourceBindings.observationSetSha256,
    payloadFileCount: payloads.length,
    outputFileCount: payloads.length + 1,
    payloads,
    guards: FIXED_GUARDS,
  });
  return ReceiptSchema.parse({
    ...material,
    receiptSha256: digestMaterial(GRAND_HALL_T561_OBSERVATION_RECEIPT_DOMAIN, material),
  });
}

export interface GenerateGrandHallT561ObservationOptions {
  readonly panoramaSourceRoot: string;
  readonly t554PanoramaPackDirectory: string;
  readonly observationInputPath: string;
  readonly outputDirectory: string;
}

export interface GrandHallT561BuildDependencies {
  readonly verifyPanoramaPack: (directory: string) => Promise<{ readonly manifestSha256: Sha256 }>;
  readonly collectInventory: (sourceRoot: string) => Promise<GrandHallT554PanoramaInventory>;
  readonly readSourceBytes: (
    sourceRoot: string,
    record: GrandHallT554PanoramaInventoryFile,
  ) => Promise<Buffer>;
  readonly verifyDecodedSource: (
    sourceBytes: Buffer,
    record: GrandHallT554PanoramaInventoryFile,
  ) => Promise<void>;
  readonly renderAid: (
    sourceBytes: Buffer,
    record: GrandHallT561ObservationRecord,
  ) => Promise<GrandHallT561RenderedReviewAid>;
}

async function verifyFullSourceJpegDecode(
  sourceBytes: Buffer,
  record: GrandHallT554PanoramaInventoryFile,
): Promise<void> {
  try {
    const decoded = await sharp(sourceBytes, {
      failOn: "error",
      limitInputPixels: record.widthPx * record.heightPx,
    }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== record.widthPx ||
      decoded.info.height !== record.heightPx ||
      decoded.info.channels !== 3 ||
      decoded.data.length !== record.widthPx * record.heightPx * 3
    ) {
      throw new Error("Decoded dimensions or channel inventory differ from the bound JPEG identity.");
    }
  } catch (error) {
    throw new GrandHallT561PanoramaVisualObservationError(
      "SOURCE_MISMATCH",
      `Sweep ${String(record.sweepNumber)} failed its complete source-JPEG decode.`,
      error,
    );
  }
}

const DEFAULT_DEPENDENCIES: GrandHallT561BuildDependencies = {
  verifyPanoramaPack: verifyPersistedGrandHallT554PanoramaReviewPack,
  collectInventory: (sourceRoot) => collectGrandHallT554PanoramaInventory({ sourceRoot }),
  readSourceBytes: (sourceRoot, record) =>
    readGrandHallT554StablePanoramaBytes(resolve(sourceRoot, record.relativePath), record),
  verifyDecodedSource: verifyFullSourceJpegDecode,
  renderAid: renderGrandHallT561ReviewAid,
};

interface BuiltPack {
  readonly manifest: GrandHallT561ObservationManifest;
  readonly manifestBytes: Buffer;
  readonly aids: readonly GrandHallT561RenderedReviewAid[];
  readonly receipt: GrandHallT561ObservationReceipt;
  readonly receiptBytes: Buffer;
}

async function buildPack(
  options: GenerateGrandHallT561ObservationOptions,
  dependencies: GrandHallT561BuildDependencies,
): Promise<BuiltPack> {
  const inputFile = await readStableDirectFile(options.observationInputPath, MAX_OBSERVATION_INPUT_BYTES);
  const input = parseGrandHallT561ObservationInput(inputFile.bytes);
  const verifiedPack = await dependencies.verifyPanoramaPack(options.t554PanoramaPackDirectory);
  if (verifiedPack.manifestSha256 !== GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256) {
    throw new GrandHallT561PanoramaVisualObservationError("SOURCE_MISMATCH", "T-554 panorama pack digest changed.");
  }
  const inventory = await dependencies.collectInventory(options.panoramaSourceRoot);
  assertInventoryMatchesInput(inventory, input);
  const sourceBySweep = new Map(inventory.files.map((record) => [record.sweepNumber, record]));
  const aids: GrandHallT561RenderedReviewAid[] = [];
  for (const observation of input.records) {
    const source = sourceBySweep.get(observation.sweepNumber);
    if (source === undefined) throw new GrandHallT561PanoramaVisualObservationError("SOURCE_MISMATCH", "Observed source is missing.");
    const bytes = await dependencies.readSourceBytes(options.panoramaSourceRoot, source);
    const bytesSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (bytes.length !== observation.byteLength || bytesSha256 !== observation.sha256) {
      throw new GrandHallT561PanoramaVisualObservationError(
        "SOURCE_MISMATCH",
        `Sweep ${String(observation.sweepNumber)} bytes differ from the bound source identity.`,
      );
    }
    await dependencies.verifyDecodedSource(bytes, source);
    if (observation.boundarySensitive) {
      aids.push(await dependencies.renderAid(bytes, observation));
    }
  }
  const finalInventory = await dependencies.collectInventory(options.panoramaSourceRoot);
  assertInventoryMatchesInput(finalInventory, input);
  const finalPack = await dependencies.verifyPanoramaPack(options.t554PanoramaPackDirectory);
  if (finalPack.manifestSha256 !== verifiedPack.manifestSha256) {
    throw new GrandHallT561PanoramaVisualObservationError("SOURCE_MISMATCH", "T-554 panorama pack changed during build.");
  }
  const finalInputFile = await readStableDirectFile(options.observationInputPath, MAX_OBSERVATION_INPUT_BYTES);
  if (finalInputFile.sha256 !== inputFile.sha256 || !finalInputFile.bytes.equals(inputFile.bytes)) {
    throw new GrandHallT561PanoramaVisualObservationError("INPUT_INVALID", "Observation input changed during build.");
  }
  const manifest = buildGrandHallT561ObservationManifest(
    input,
    { sha256: inputFile.sha256, byteLength: inputFile.bytes.length },
    aids,
  );
  const manifestBytes = serializeManifest(manifest);
  const receipt = buildReceipt(manifest, manifestBytes, aids);
  const receiptBytes = serializeReceipt(receipt);
  return { manifest, manifestBytes, aids, receipt, receiptBytes };
}

function assertObservationInputOutsideOutput(observationInputPath: string, outputDirectory: string): void {
  const input = comparablePath(observationInputPath);
  const output = comparablePath(outputDirectory);
  if (input === output || input.startsWith(`${output}\\`) || output.startsWith(`${input}\\`)) {
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_UNSAFE", "Output and observation input must be disjoint.");
  }
}

async function readStableOutput(path: string, maximumBytes: number): Promise<StableFileBytes> {
  try {
    return await readStableDirectFile(path, maximumBytes);
  } catch (error) {
    if (error instanceof GrandHallT561PanoramaVisualObservationError) {
      throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", `Output ${basename(path)} is not a stable direct file.`, error);
    }
    throw error;
  }
}

export function parseGrandHallT561ObservationManifest(
  bytes: Buffer,
): GrandHallT561ObservationManifest {
  try {
    const manifest = ManifestSchema.parse(parseGrandHallT554StrictJson(bytes));
    const { manifestSha256, ...material } = manifest;
    if (manifestSha256 !== digestMaterial(GRAND_HALL_T561_OBSERVATION_MANIFEST_DOMAIN, material)) throw new Error("manifest digest mismatch");
    assertManifestCrossBindings(manifest);
    return manifest;
  } catch (error) {
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", "Persisted observation manifest is invalid.", error);
  }
}

function assertManifestCrossBindings(manifest: GrandHallT561ObservationManifest): void {
  assertObservationCoverage(manifest.records);
  const boundaryRecords = manifest.records.filter((record) => record.boundarySensitive);
  const observed = manifest.records.filter((record) => record.observationState === "grand_hall_pixels_observed").length;
  const noneObserved = manifest.records.filter((record) => record.observationState === "no_grand_hall_pixels_observed").length;
  const uncertain = manifest.records.length - observed - noneObserved;
  if (
    manifest.summary.grandHallPixelsObservedCount !== observed ||
    manifest.summary.noGrandHallPixelsObservedCount !== noneObserved ||
    manifest.summary.uncertainPossibleGrandHallPixelsCount !== uncertain ||
    manifest.summary.boundarySensitiveRecordCount !== boundaryRecords.length ||
    manifest.summary.reviewAidCount !== manifest.reviewAids.length ||
    manifest.reviewAids.length !== boundaryRecords.length
  ) throw new Error("manifest summary counts are inconsistent");
  boundaryRecords.forEach((record, index) => {
    const aid = manifest.reviewAids[index];
    if (
      aid === undefined ||
      aid.sourceSweepNumber !== record.sweepNumber ||
      aid.relativePath !== reviewAidFileName(record.sweepNumber) ||
      aid.sourceJpegSha256 !== record.sha256 ||
      aid.roiSetSha256 !== digestMaterial(GRAND_HALL_T561_ROI_SET_DOMAIN, record.attentionRegions)
    ) throw new Error(`review aid ${String(index)} is not bound to its source observation`);
  });
  const expectedOutOfSet = manifest.records
    .filter((record) => record.sweepNumber > 50 && record.observationState !== "no_grand_hall_pixels_observed")
    .map((record) => record.sweepNumber);
  if (manifest.summary.outOfCurrentCandidateSetObservedOrUncertainSweeps.join(",") !== expectedOutOfSet.join(",")) {
    throw new Error("out-of-candidate observation summary is inconsistent");
  }
}

export function parseGrandHallT561ObservationReceipt(
  bytes: Buffer,
): GrandHallT561ObservationReceipt {
  try {
    const receipt = ReceiptSchema.parse(parseGrandHallT554StrictJson(bytes));
    const { receiptSha256, ...material } = receipt;
    if (receiptSha256 !== digestMaterial(GRAND_HALL_T561_OBSERVATION_RECEIPT_DOMAIN, material)) throw new Error("receipt digest mismatch");
    return receipt;
  } catch (error) {
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", "Persisted observation receipt is invalid.", error);
  }
}

function expectedOutputNames(receipt: GrandHallT561ObservationReceipt): readonly string[] {
  return [...receipt.payloads.map((payload) => payload.relativePath), GRAND_HALL_T561_RECEIPT_FILENAME]
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function verifyReviewAid(
  outputDirectory: string,
  evidence: GrandHallT561ReviewAidEvidence,
): Promise<void> {
  const stable = await readStableOutput(resolve(outputDirectory, evidence.relativePath), MAX_REVIEW_AID_BYTES);
  if (stable.sha256 !== evidence.sha256 || stable.bytes.length !== evidence.byteLength) {
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", `${evidence.relativePath} differs from its manifest binding.`);
  }
  const decoded = await sharp(stable.bytes, {
    failOn: "error",
    limitInputPixels: evidence.widthPx * evidence.heightPx,
  }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== evidence.widthPx || decoded.info.height !== evidence.heightPx || decoded.info.channels !== 3) {
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", `${evidence.relativePath} is not the declared RGB8 review aid.`);
  }
}

export interface VerifiedGrandHallT561ObservationPack {
  readonly outputDirectory: string;
  readonly manifestSha256: Sha256;
  readonly receiptSha256: Sha256;
  readonly sourceRecordCount: 148;
  readonly absentSweepNumbersWithin1To149: readonly [93];
  readonly reviewAidCount: number;
  readonly outputFileCount: number;
  readonly authority: "none";
  readonly nativeResolutionHumanReviewCompleted: false;
}

async function inspectPersistedPack(outputDirectory: string): Promise<VerifiedGrandHallT561ObservationPack> {
  const manifestFile = await readStableOutput(resolve(outputDirectory, GRAND_HALL_T561_MANIFEST_FILENAME), MAX_MANIFEST_BYTES);
  const receiptFile = await readStableOutput(resolve(outputDirectory, GRAND_HALL_T561_RECEIPT_FILENAME), MAX_RECEIPT_BYTES);
  const manifest = parseGrandHallT561ObservationManifest(manifestFile.bytes);
  const receipt = parseGrandHallT561ObservationReceipt(receiptFile.bytes);
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right, "en"));
  if (entries.some((entry) => !entry.isFile()) || names.join("\n") !== expectedOutputNames(receipt).join("\n")) {
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", "Observation output inventory is not exact and flat.");
  }
  if (
    receipt.manifestSha256 !== manifest.manifestSha256 ||
    receipt.observationSetSha256 !== manifest.sourceBindings.observationSetSha256 ||
    receipt.payloadFileCount !== receipt.payloads.length ||
    receipt.outputFileCount !== entries.length
  ) throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", "Receipt and manifest cross-bindings disagree.");
  const expectedPayloadNames = [
    GRAND_HALL_T561_MANIFEST_FILENAME,
    ...manifest.reviewAids.map((aid) => aid.relativePath),
  ].sort((left, right) => left.localeCompare(right, "en"));
  if (receipt.payloads.map((payload) => payload.relativePath).join("\n") !== expectedPayloadNames.join("\n")) {
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", "Receipt payload inventory is not the manifest payload inventory.");
  }
  for (const payload of receipt.payloads) {
    const maximum = payload.relativePath === GRAND_HALL_T561_MANIFEST_FILENAME ? MAX_MANIFEST_BYTES : MAX_REVIEW_AID_BYTES;
    const stable = await readStableOutput(resolve(outputDirectory, payload.relativePath), maximum);
    if (stable.sha256 !== payload.sha256 || stable.bytes.length !== payload.byteLength) {
      throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", `${payload.relativePath} differs from the receipt.`);
    }
  }
  for (const aid of manifest.reviewAids) await verifyReviewAid(outputDirectory, aid);
  return {
    outputDirectory,
    manifestSha256: manifest.manifestSha256,
    receiptSha256: receipt.receiptSha256,
    sourceRecordCount: 148,
    absentSweepNumbersWithin1To149: [93],
    reviewAidCount: manifest.reviewAids.length,
    outputFileCount: receipt.outputFileCount,
    authority: "none",
    nativeResolutionHumanReviewCompleted: false,
  };
}

async function publishPack(outputDirectory: string, outputParent: string, built: BuiltPack): Promise<void> {
  const temporary = resolve(outputParent, `.${basename(outputDirectory)}.partial-${String(process.pid)}-${randomUUID()}`);
  try {
    await mkdir(temporary, { recursive: false });
    for (const aid of built.aids) await writeFile(resolve(temporary, aid.relativePath), aid.bytes, { flag: "wx" });
    await writeFile(resolve(temporary, GRAND_HALL_T561_MANIFEST_FILENAME), built.manifestBytes, { flag: "wx" });
    await writeFile(resolve(temporary, GRAND_HALL_T561_RECEIPT_FILENAME), built.receiptBytes, { flag: "wx" });
    await inspectPersistedPack(temporary);
    await rename(temporary, outputDirectory);
    await inspectPersistedPack(outputDirectory);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (error instanceof GrandHallT561PanoramaVisualObservationError) throw error;
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_PUBLISH_FAILED", "Observation pack could not be published.", error);
  }
}

export async function generateGrandHallT561ObservationPack(
  options: GenerateGrandHallT561ObservationOptions,
  dependencies: GrandHallT561BuildDependencies = DEFAULT_DEPENDENCIES,
): Promise<VerifiedGrandHallT561ObservationPack> {
  assertObservationInputOutsideOutput(options.observationInputPath, options.outputDirectory);
  const safety = await assertGrandHallT554ReviewOutputSafety({
    sourceRoots: [options.panoramaSourceRoot, options.t554PanoramaPackDirectory],
    outputDirectory: options.outputDirectory,
  });
  const built = await buildPack(options, dependencies);
  await publishPack(safety.outputDirectory, safety.outputParent, built);
  return await inspectPersistedPack(safety.outputDirectory);
}

export async function verifyPersistedGrandHallT561ObservationPack(
  outputDirectory: string,
): Promise<VerifiedGrandHallT561ObservationPack> {
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({ sourceRoots: [], outputDirectory });
  return await inspectPersistedPack(safety.outputDirectory);
}

async function compareExpectedPack(outputDirectory: string, built: BuiltPack): Promise<void> {
  const expected = new Map<string, Buffer>([
    [GRAND_HALL_T561_MANIFEST_FILENAME, built.manifestBytes],
    [GRAND_HALL_T561_RECEIPT_FILENAME, built.receiptBytes],
    ...built.aids.map((aid): readonly [string, Buffer] => [aid.relativePath, aid.bytes]),
  ]);
  for (const [relativePath, bytes] of expected) {
    const maximum = relativePath === GRAND_HALL_T561_RECEIPT_FILENAME
      ? MAX_RECEIPT_BYTES
      : relativePath === GRAND_HALL_T561_MANIFEST_FILENAME ? MAX_MANIFEST_BYTES : MAX_REVIEW_AID_BYTES;
    const persisted = await readStableOutput(resolve(outputDirectory, relativePath), maximum);
    if (!persisted.bytes.equals(bytes)) {
      throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", `${relativePath} differs from exact regeneration.`);
    }
  }
}

export async function checkGrandHallT561ObservationPack(
  options: GenerateGrandHallT561ObservationOptions,
  dependencies: GrandHallT561BuildDependencies = DEFAULT_DEPENDENCIES,
): Promise<VerifiedGrandHallT561ObservationPack & { readonly exactRegenerationVerified: true }> {
  assertObservationInputOutsideOutput(options.observationInputPath, options.outputDirectory);
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({
    sourceRoots: [options.panoramaSourceRoot, options.t554PanoramaPackDirectory],
    outputDirectory: options.outputDirectory,
  });
  const before = await inspectPersistedPack(safety.outputDirectory);
  const built = await buildPack(options, dependencies);
  await compareExpectedPack(safety.outputDirectory, built);
  const after = await inspectPersistedPack(safety.outputDirectory);
  if (before.receiptSha256 !== after.receiptSha256 || before.manifestSha256 !== after.manifestSha256) {
    throw new GrandHallT561PanoramaVisualObservationError("OUTPUT_VERIFICATION_FAILED", "Observation output changed during independent check.");
  }
  return { ...after, exactRegenerationVerified: true };
}

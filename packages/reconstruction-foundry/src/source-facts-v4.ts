import { createHash } from "node:crypto";
import { E57_PHYSICAL_HEADER_BYTES, FoundryRelativePathSchema } from "@omnitwin/types";
import { z } from "zod";
import { domainSeparatedSha256, stableCanonicalJson, toCanonicalJson } from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES,
} from "./gaussian-ply-source-facts.js";
import {
  FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITS,
  FoundryMediaContainerSourceFactsSchema,
  type FoundryMediaContainerSourceFactsOutcome,
} from "./media-container-source-facts.js";
import {
  FOUNDRY_SOG_META_JSON_MAX_DEPTH,
  FOUNDRY_SOG_META_JSON_MAX_VALUES,
  FOUNDRY_SOG_META_MAX_BYTES,
  FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES,
  FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES,
  FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES,
  FOUNDRY_SOG_ZIP_MAX_ENTRIES,
} from "./sog-source-facts.js";
import {
  FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES,
  FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_DEPTH,
  FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_VALUES,
  FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES,
  FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES,
  FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
  UniversalSourceFactsReceiptFileIdentitySchema,
  type UniversalSourceFactsReceiptFileIdentity,
} from "./source-facts.js";
import {
  FOUNDRY_SOURCE_FACTS_V3_LIMITATIONS,
  FOUNDRY_UNIVERSAL_SOURCE_FACTS_V3,
  UniversalSourceFactsV3AssetSchema,
  UniversalSourceFactsV3FileResultSchema,
  createUniversalSourceFactsV3StreamCollector,
  type UniversalSourceFactsV3FileResult,
  type UniversalSourceFactsV3FinalizeOptions,
} from "./source-facts-v3.js";
import {
  FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES,
  FOUNDRY_SPZ_EXTENSION_MAX_BYTES,
  FOUNDRY_SPZ_EXTENSION_MAX_RECORDS,
  FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES,
  FOUNDRY_SPZ_LEGACY_HEADER_BYTES,
  FOUNDRY_SPZ_SOURCE_MAX_BYTES,
  FOUNDRY_SPZ_V4_HEADER_BYTES,
  FOUNDRY_SPZ_V4_MAX_COMPRESSION_RATIO,
} from "./spz-source-facts.js";

export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4 =
  "omnitwin.foundry.universal-source-facts.v4";
export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4";
export const FOUNDRY_SOURCE_FACTS_V4_LIMITATIONS = Object.freeze([
  ...FOUNDRY_SOURCE_FACTS_V3_LIMITATIONS,
] as const);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;

export const UniversalSourceFactsV4ReceiptFileIdentitySchema =
  UniversalSourceFactsReceiptFileIdentitySchema.extend({
    magicHex: z.string().regex(/^(?:[a-f0-9]{2})*$/u).max(256),
  }).strict();
export type UniversalSourceFactsV4ReceiptFileIdentity = z.infer<
  typeof UniversalSourceFactsV4ReceiptFileIdentitySchema
>;

const SourceIdentityBaseSchema = z.object({
  path: FoundryRelativePathSchema,
  sizeBytes: z.number().int().safe().nonnegative(),
  sha256: z.string().regex(SHA256_HEX),
}).strict();

const UnknownFactSchema = z.object({
  code: z.string().regex(STABLE_CODE),
  label: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500),
  decisiveNextTest: z.string().trim().min(1).max(500),
}).strict();

function unknownFact(
  code: string,
  label: string,
  reason: string,
  decisiveNextTest: string,
): Readonly<z.infer<typeof UnknownFactSchema>> {
  return Object.freeze(UnknownFactSchema.parse({ code, label, reason, decisiveNextTest }));
}

export const FOUNDRY_MEDIA_CONTAINER_UNKNOWNS = Object.freeze([
  unknownFact(
    "MEDIA_CAPTURE_ROLE_UNKNOWN",
    "Capture role",
    "Container facts do not decide whether this source is a DSLR image, phone image, panorama, ordinary image, or video capture.",
    "Obtain an authoritative capture-session or source-context record bound to this exact SHA-256 that states the source role without inferring it from extension, dimensions, metadata presence, or container validity.",
  ),
  unknownFact(
    "MEDIA_PROVENANCE_CLASS_UNKNOWN",
    "Provenance class",
    "Container facts do not decide whether the content is captured, enhanced-captured, generated, or concept/imagination material.",
    "Obtain a digest-bound lineage record that classifies the source as captured, enhanced-captured, generated, or concept/imagination and identifies every material transformation.",
  ),
  unknownFact("MEDIA_CAPTURE_DEVICE_UNKNOWN", "Capture device", "Container structure and optional metadata presence do not establish the authoritative device, lens, sensor, or capture application.", "Corroborate digest-bound capture-session records and original-device metadata, recording absent, stripped, edited, or contradictory fields explicitly."),
  unknownFact("MEDIA_CAPTURE_TIME_UNKNOWN", "Capture time", "Container structure does not establish an authoritative capture instant or prove that embedded timestamps are original and unedited.", "Bind this exact digest to a capture-session clock record and reconcile any embedded timestamp, timezone, sequence, and modification evidence."),
  unknownFact("MEDIA_CAMERA_CALIBRATION_UNKNOWN", "Camera calibration", "Container facts do not establish trustworthy intrinsics, distortion, rolling-shutter behavior, extrinsics, or calibration applicability.", "Bind this exact digest to a reviewed calibration record and verify the declared camera model against controlled observations."),
  unknownFact("MEDIA_PROJECTION_UNKNOWN", "Projection and panorama model", "Container dimensions and metadata presence do not establish perspective, equirectangular, cubemap, fisheye, cropped-panorama, or other projection semantics.", "Obtain authoritative projection metadata or run a separately reviewed projection test against this exact digest with explicit model and acceptance limits."),
  unknownFact("MEDIA_PIXEL_OR_SAMPLE_DECODE_UNKNOWN", "Decoded pixels or media samples", "Container inspection does not decode or validate complete image pixels, video samples, colour transforms, or presentation output.", "Run a separately reviewed bounded decoder against this exact digest and record byte, pixel, frame, duration, memory, codec, and cancellation limits."),
  unknownFact("MEDIA_SEQUENCE_RELATIONSHIP_UNKNOWN", "Sequence relationship", "One valid media container does not establish its ordering, continuity, overlap, synchronization, pose, or relationship to other images, video, audio, or sensor records.", "Obtain a digest-bound capture manifest or independently verify sequence ordering, timestamps, camera relationships, and missing intervals."),
  unknownFact("MEDIA_VISUAL_FIDELITY_UNKNOWN", "Visual fidelity", "Container validity does not establish fidelity to the captured venue or freedom from blur, exposure error, stitching faults, edits, or generated content.", "Compare decoded output under a frozen colour and viewpoint protocol with rights-cleared reference observations and record indeterminate regions."),
  unknownFact("MEDIA_RIGHTS_UNKNOWN", "Usage rights", "Container inspection does not evaluate ownership, privacy, model-training, derivative-output, commercial-use, or redistribution rights.", "Obtain an authorized purpose-scoped rights decision bound to this exact SHA-256."),
] as const);

const InspectionSchema = z.object({
  state: z.enum(["established", "facts_not_established"]),
  category: z.enum(["established", "resource_limit", "parse_failure", "unsupported_variant", "unsupported_container"]),
  code: z.string().regex(STABLE_CODE),
  coverage: z.enum(["none", "physical_header", "container_header", "container_header_and_json", "complete_container_structure", "complete_stream"]),
}).strict().superRefine((value, ctx) => {
  if ((value.state === "established") !== (value.category === "established")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: "inspection state and category must agree" });
  }
});

export const FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES = Object.freeze([
  "matterport_panorama",
  "dslr_image",
  "generic_image",
  "panorama_360",
  "phone_image",
  "drone_media",
  "video",
] as const);
const MediaReceiptCandidateInputTypeSchema = z.enum(FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES);
type MediaReceiptCandidateInputType = z.infer<typeof MediaReceiptCandidateInputTypeSchema>;
const STILL_RECEIPT_CANDIDATES = new Set<MediaReceiptCandidateInputType>([
  "matterport_panorama", "dslr_image", "generic_image", "panorama_360", "phone_image",
]);

function canonicalMediaReceiptCandidates(
  values: readonly MediaReceiptCandidateInputType[],
): MediaReceiptCandidateInputType[] {
  const present = new Set(values);
  return FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES.filter((value) => present.has(value));
}

const MediaSourceSchema = SourceIdentityBaseSchema.extend({
  inputType: z.enum(["generic_image", "video", "drone_media"]),
  receiptCandidateInputTypes: z.array(MediaReceiptCandidateInputTypeSchema).min(1).max(
    FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES.length,
  ),
}).strict().superRefine((source, ctx) => {
  if (JSON.stringify(source.receiptCandidateInputTypes) !== JSON.stringify(canonicalMediaReceiptCandidates(source.receiptCandidateInputTypes))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["receiptCandidateInputTypes"], message: "media receipt candidates must be unique and canonically ordered" });
  }
});

export const FoundryMediaContainerFactsV4Schema = FoundryMediaContainerSourceFactsSchema;
export type FoundryMediaContainerFactsV4 = z.infer<typeof FoundryMediaContainerFactsV4Schema>;

const MediaContainerAssetSchema = z.object({
  source: MediaSourceSchema,
  format: z.enum(["jpeg", "png", "iso_bmff", "media_container"]),
  inspection: InspectionSchema,
  facts: FoundryMediaContainerFactsV4Schema.nullable(),
  unknowns: z.array(UnknownFactSchema),
}).strict().superRefine((asset, ctx) => {
  if ((asset.inspection.state === "established") !== (asset.facts !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["facts"], message: "media facts must match inspection state" });
  }
  if (JSON.stringify(asset.unknowns) !== JSON.stringify(FOUNDRY_MEDIA_CONTAINER_UNKNOWNS)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unknowns"], message: "media unknowns must match V4 coverage" });
  }
  if (asset.inspection.state === "established") {
    const factsFormat = asset.facts?.format;
    const expectedInputType = factsFormat === "iso_bmff" ? "video" : "generic_image";
    if (asset.inspection.category !== "established" || asset.inspection.code !== "MEDIA_CONTAINER_FORMAT_FACTS_ESTABLISHED" || asset.inspection.coverage !== "complete_container_structure" || asset.format !== factsFormat || asset.source.inputType !== expectedInputType || asset.facts?.container.sourceSizeBytes !== asset.source.sizeBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspection"], message: "established media inspection fields are inconsistent" });
    }
    return;
  }
  const code = asset.inspection.code as (typeof FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CODES)[number];
  const expectedCategory = (FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE as Partial<Record<string, string>>)[code];
  const hasStill = asset.source.receiptCandidateInputTypes.some((value) => STILL_RECEIPT_CANDIDATES.has(value));
  const hasVideo = asset.source.receiptCandidateInputTypes.includes("video");
  const hasDrone = asset.source.receiptCandidateInputTypes.includes("drone_media");
  const expectedFailedInputType = hasVideo
    ? "video"
    : hasStill
      ? "generic_image"
      : hasDrone
        ? "drone_media"
        : null;
  if (asset.format !== "media_container" || asset.facts !== null || expectedFailedInputType === null || asset.source.inputType !== expectedFailedInputType || !FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CODES.includes(code) || expectedCategory === undefined || expectedCategory === "cancelled" || asset.inspection.category !== expectedCategory || asset.inspection.coverage !== "none") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspection"], message: "failed media inspection fields are inconsistent" });
  }
});

export const UniversalSourceFactsV4AssetSchema = z.union([UniversalSourceFactsV3AssetSchema, MediaContainerAssetSchema]);
export type UniversalSourceFactsV4Asset = z.infer<typeof UniversalSourceFactsV4AssetSchema>;

function isMediaContainerAsset(
  asset: UniversalSourceFactsV4Asset,
): asset is z.infer<typeof MediaContainerAssetSchema> {
  return "receiptCandidateInputTypes" in asset.source;
}

const BlockedSourceSchema = SourceIdentityBaseSchema.extend({ inputType: z.literal("xgrids_xbin") }).strict();

export const UniversalSourceFactsV4FileResultSchema = z.union([
  UniversalSourceFactsV3FileResultSchema,
  z.object({ kind: z.literal("asset"), asset: MediaContainerAssetSchema }).strict(),
]);
export type UniversalSourceFactsV4FileResult = z.infer<typeof UniversalSourceFactsV4FileResultSchema>;

const PolicySchema = z.object({
  sourceAccess: z.literal("read_only"),
  mutation: z.literal("none"),
  reconstruction: z.literal("none"),
  networkAccess: z.literal("none"),
  externalProcess: z.enum(["none", "local_pye57_read_only"]),
  metadataProbe: z.enum(["none", "local_pye57_read_only"]),
  authority: z.literal("none"),
  rights: z.literal("not_evaluated"),
}).strict();

const MediaLimitsSchema = z.record(
  z.string().trim().min(1).max(120),
  z.number().int().safe().nonnegative(),
).superRefine((limits, ctx) => {
  if (JSON.stringify(limits) !== JSON.stringify(FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITS)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "media limits must match the immutable inspector profile" });
  }
});

const LimitsSchema = z.object({
  inheritedProfile: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V3),
  e57PhysicalHeaderBytes: z.literal(E57_PHYSICAL_HEADER_BYTES),
  glbJsonChunkMaxBytes: z.literal(FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES),
  glbJsonMaxDepth: z.literal(FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_DEPTH),
  glbJsonMaxValues: z.literal(FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_VALUES),
  objLogicalLineMaxBytes: z.literal(FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES),
  sogZipMaxEntries: z.literal(FOUNDRY_SOG_ZIP_MAX_ENTRIES),
  sogZipCentralDirectoryMaxBytes: z.literal(FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES),
  sogMetaJsonMaxBytes: z.literal(FOUNDRY_SOG_META_MAX_BYTES),
  sogMetaJsonMaxDepth: z.literal(FOUNDRY_SOG_META_JSON_MAX_DEPTH),
  sogMetaJsonMaxValues: z.literal(FOUNDRY_SOG_META_JSON_MAX_VALUES),
  sogWebpMemberMaxBytes: z.literal(FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES),
  sogWebpAggregateMaxBytes: z.literal(FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES),
  spzSourceMaxBytes: z.literal(FOUNDRY_SPZ_SOURCE_MAX_BYTES),
  spzDecompressedMaxBytes: z.literal(FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES),
  spzExtensionMaxBytes: z.literal(FOUNDRY_SPZ_EXTENSION_MAX_BYTES),
  spzExtensionMaxRecords: z.literal(FOUNDRY_SPZ_EXTENSION_MAX_RECORDS),
  spzGzipHeaderMaxBytes: z.literal(FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES),
  spzLegacyHeaderBytes: z.literal(FOUNDRY_SPZ_LEGACY_HEADER_BYTES),
  spzV4HeaderBytes: z.literal(FOUNDRY_SPZ_V4_HEADER_BYTES),
  spzV4MaxCompressionRatio: z.literal(FOUNDRY_SPZ_V4_MAX_COMPRESSION_RATIO),
  gaussianPlySourceMaxBytes: z.literal(FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES),
  gaussianPlyHeaderMaxBytes: z.literal(FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES),
  gaussianPlyHeaderLineMaxBytes: z.literal(FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES),
  gaussianPlyElementMaxCount: z.literal(FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT),
  gaussianPlyPropertyMaxCount: z.literal(FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT),
  gaussianPlyCommentMaxCount: z.literal(FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT),
  gaussianPlyVertexMaxCount: z.literal(FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT),
  gaussianPlyVertexStrideMaxBytes: z.literal(FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES),
  mediaContainer: MediaLimitsSchema,
}).strict();

const SummarySchema = z.object({
  receiptFileCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  assetCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  establishedCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  factsNotEstablishedCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  untargetedFileCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  blockedSourceCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
}).strict();

const ArtifactBaseSchema = z.object({
  schemaVersion: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4),
  receiptSha256: z.string().regex(SHA256_HEX),
  policy: PolicySchema,
  limitations: z.tuple([
    z.literal(FOUNDRY_SOURCE_FACTS_V4_LIMITATIONS[0]),
    z.literal(FOUNDRY_SOURCE_FACTS_V4_LIMITATIONS[1]),
    z.literal(FOUNDRY_SOURCE_FACTS_V4_LIMITATIONS[2]),
  ]),
  limits: LimitsSchema,
  summary: SummarySchema,
  factsSha256: z.string().regex(SHA256_HEX),
}).strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
  assets: z.array(UniversalSourceFactsV4AssetSchema).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
}).strict();

const UnavailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("unavailable"),
  assets: z.tuple([]),
  affectedSources: z.array(BlockedSourceSchema).min(1).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  reason: z.object({
    code: z.literal("XGRIDS_XBIN_UNSUPPORTED"),
    message: z.literal("Universal Source Facts V4 are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate."),
    nextAction: z.literal(FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION),
  }).strict(),
}).strict();

type ArtifactWithoutValidation = z.infer<typeof AvailableArtifactSchema> | z.infer<typeof UnavailableArtifactSchema>;
type ArtifactPayload = ArtifactWithoutValidation extends infer Artifact
  ? Artifact extends ArtifactWithoutValidation ? Omit<Artifact, "factsSha256"> : never
  : never;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { factsSha256: _factsSha256, ...payload } = value;
  return domainSeparatedSha256(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4_DIGEST_DOMAIN, toCanonicalJson(payload));
}

function validateArtifact(value: ArtifactWithoutValidation, ctx: z.RefinementCtx): void {
  const paths = value.assets.map((asset) => asset.source.path);
  const sorted = [...paths].sort(compareText);
  if (new Set(paths).size !== paths.length || paths.some((path, index) => path !== sorted[index])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assets"], message: "V4 asset paths must be unique and sorted" });
  }
  const expectedSummary = value.state === "available"
    ? {
        receiptFileCount: value.summary.receiptFileCount,
        assetCount: value.assets.length,
        establishedCount: value.assets.filter((asset) => asset.inspection.state === "established").length,
        factsNotEstablishedCount: value.assets.filter((asset) => asset.inspection.state === "facts_not_established").length,
        untargetedFileCount: value.summary.receiptFileCount - value.assets.length,
        blockedSourceCount: 0,
      }
    : {
        receiptFileCount: value.summary.receiptFileCount,
        assetCount: 0,
        establishedCount: 0,
        factsNotEstablishedCount: 0,
        untargetedFileCount: value.summary.receiptFileCount - value.affectedSources.length,
        blockedSourceCount: value.affectedSources.length,
      };
  if (expectedSummary.untargetedFileCount < 0 || JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["summary"], message: "V4 summary does not match artifact contents" });
  }
  if (value.state === "unavailable") {
    const blockedPaths = value.affectedSources.map((source) => source.path);
    const sortedBlocked = [...blockedPaths].sort(compareText);
    if (new Set(blockedPaths).size !== blockedPaths.length || blockedPaths.some((path, index) => path !== sortedBlocked[index])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["affectedSources"], message: "V4 affected sources must be unique and sorted" });
    }
  }
  const usesPye57 = value.assets.some((asset) =>
    asset.format === "e57" && asset.facts?.aggregateMetadata !== null && asset.facts?.aggregateMetadata !== undefined
  );
  const expectedProbe = usesPye57 ? "local_pye57_read_only" : "none";
  if (value.policy.metadataProbe !== expectedProbe || value.policy.externalProcess !== expectedProbe) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["policy", "metadataProbe"], message: "V4 metadata probe policy contradicts attached E57 evidence" });
  }
  if (value.factsSha256 !== artifactDigest(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["factsSha256"], message: "V4 facts digest does not match canonical payload" });
  }
}

export const FoundryUniversalSourceFactsV4Schema = z.discriminatedUnion("state", [
  AvailableArtifactSchema,
  UnavailableArtifactSchema,
]).superRefine(validateArtifact);
export type FoundryUniversalSourceFactsV4 = z.infer<typeof FoundryUniversalSourceFactsV4Schema>;

export interface UniversalSourceFactsV4FinalizeOptions extends UniversalSourceFactsV3FinalizeOptions {
  readonly mediaContainerInspection?: FoundryMediaContainerSourceFactsOutcome;
}

export interface UniversalSourceFactsV4StreamCollector {
  observe(chunk: Uint8Array, absoluteOffset: number): void;
  finalize(
    identity: UniversalSourceFactsV4ReceiptFileIdentity,
    options?: UniversalSourceFactsV4FinalizeOptions,
  ): UniversalSourceFactsV4FileResult;
}

function hasCandidate(identity: UniversalSourceFactsReceiptFileIdentity, inputType: string): boolean {
  return identity.detection.candidates.some((candidate) => candidate.inputType === inputType);
}

function establishedMediaFormatFromMagic(
  magicHex: string,
): "jpeg" | "png" | "iso_bmff" | null {
  if (magicHex.startsWith("89504e470d0a1a0a")) return "png";
  if (magicHex.startsWith("ffd8")) return "jpeg";
  if (magicHex.length >= 16 && magicHex.slice(8, 16) === "66747970") {
    return "iso_bmff";
  }
  return null;
}

function mediaReceiptCandidates(
  identity: UniversalSourceFactsReceiptFileIdentity,
): MediaReceiptCandidateInputType[] {
  const inputTypes = new Set(identity.detection.candidates.map((candidate) => candidate.inputType));
  return FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES.filter((inputType) => inputTypes.has(inputType));
}

function mediaTargetInputType(
  identity: UniversalSourceFactsReceiptFileIdentity,
): "generic_image" | "video" | "drone_media" | null {
  const candidates = mediaReceiptCandidates(identity);
  const hasStill = candidates.some((candidate) => STILL_RECEIPT_CANDIDATES.has(candidate));
  const hasVideo = candidates.includes("video");
  const hasDrone = candidates.includes("drone_media");
  if (hasVideo) return "video";
  if (hasStill) return "generic_image";
  if (hasDrone) return "drone_media";
  return null;
}

function extension(relativePath: string): string {
  const leaf = relativePath.replaceAll("\\", "/").split("/").at(-1) ?? relativePath;
  const dot = leaf.lastIndexOf(".");
  return dot < 0 ? "" : leaf.slice(dot).toLowerCase();
}

/** V4 is additive: every target already owned by V1-V3 keeps precedence. */
function claimedByInheritedSourceFacts(
  identity: UniversalSourceFactsReceiptFileIdentity,
  e57Magic: boolean,
  glbMagic: boolean,
): boolean {
  if (e57Magic || glbMagic) return true;
  const suffix = extension(identity.path);
  return hasCandidate(identity, "gaussian_ply") ||
    hasCandidate(identity, "ply_point_cloud") ||
    hasCandidate(identity, "spz") || suffix === ".spz" ||
    hasCandidate(identity, "sog") || suffix === ".sog" ||
    hasCandidate(identity, "generic_e57") ||
    hasCandidate(identity, "matterport_e57") || suffix === ".e57" ||
    hasCandidate(identity, "glb_gltf") || suffix === ".gltf" || suffix === ".glb" ||
    hasCandidate(identity, "obj") || suffix === ".obj";
}

function assertMediaFailureOutcome(
  outcome: Extract<FoundryMediaContainerSourceFactsOutcome, { readonly state: "facts_not_established" }>,
): void {
  if (outcome.category === "cancelled" || outcome.code === "MEDIA_CONTAINER_INSPECTION_CANCELLED") {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V4_MEDIA_INSPECTION_CANCELLED",
      "The read-only media-container Source Facts inspection was cancelled; no V4 artifact was issued.",
    );
  }
  const expectedCategory = FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[outcome.code];
  if (!FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CODES.includes(outcome.code) || expectedCategory !== outcome.category) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V4_MEDIA_OUTCOME_INVALID",
      "The bounded media-container Source Facts outcome is contradictory; no V4 artifact was issued.",
    );
  }
}

function mediaContainerResult(
  identity: UniversalSourceFactsV4ReceiptFileIdentity,
  receiptTargetInputType: "generic_image" | "video" | "drone_media",
  outcome: FoundryMediaContainerSourceFactsOutcome,
): UniversalSourceFactsV4FileResult {
  const sourceBase = {
    path: identity.path,
    sizeBytes: identity.sizeBytes,
    sha256: identity.sha256,
    receiptCandidateInputTypes: mediaReceiptCandidates(identity),
  };
  if (outcome.state === "established") {
    const facts = FoundryMediaContainerFactsV4Schema.parse(outcome.facts);
    const expectedFormat = establishedMediaFormatFromMagic(identity.magicHex);
    if (expectedFormat === null || facts.format !== expectedFormat) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V4_MEDIA_FORMAT_BINDING_MISMATCH",
        "Established media Source Facts format contradicts the receipt-bound signature bytes.",
      );
    }
    const establishedInputType = facts.format === "iso_bmff" ? "video" : "generic_image";
    return UniversalSourceFactsV4FileResultSchema.parse({
      kind: "asset",
      asset: {
        source: { ...sourceBase, inputType: establishedInputType },
        format: facts.format,
        inspection: {
          state: "established",
          category: "established",
          code: "MEDIA_CONTAINER_FORMAT_FACTS_ESTABLISHED",
          coverage: "complete_container_structure",
        },
        facts,
        unknowns: FOUNDRY_MEDIA_CONTAINER_UNKNOWNS,
      },
    });
  }
  assertMediaFailureOutcome(outcome);
  return UniversalSourceFactsV4FileResultSchema.parse({
    kind: "asset",
    asset: {
      source: { ...sourceBase, inputType: receiptTargetInputType },
      format: "media_container",
      inspection: {
        state: "facts_not_established",
        category: outcome.category,
        code: outcome.code,
        coverage: "none",
      },
      facts: null,
      unknowns: FOUNDRY_MEDIA_CONTAINER_UNKNOWNS,
    },
  });
}

class UniversalSourceFactsV4StreamCollectorImpl implements UniversalSourceFactsV4StreamCollector {
  private readonly v3Collector;
  private readonly hash = createHash("sha256");
  private readonly prefix = Buffer.alloc(128);
  private prefixBytes = 0;
  private observedBytes = 0;
  private finalized = false;

  constructor(private readonly relativePath: string) {
    this.relativePath = FoundryRelativePathSchema.parse(relativePath);
    this.v3Collector = createUniversalSourceFactsV3StreamCollector(this.relativePath);
  }

  observe(chunk: Uint8Array, absoluteOffset: number): void {
    if (this.finalized) throw new FoundryIntegrityError("SOURCE_FACTS_V4_COLLECTOR_FINALIZED", "Source Facts V4 collector is already finalized.");
    if (!(chunk instanceof Uint8Array) || absoluteOffset !== this.observedBytes) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V4_NONCONTIGUOUS_STREAM", "Source Facts V4 byte chunks must be contiguous and start at offset zero.");
    }
    this.v3Collector.observe(chunk, absoluteOffset);
    this.hash.update(chunk);
    if (this.prefixBytes < this.prefix.length) {
      const copyBytes = Math.min(this.prefix.length - this.prefixBytes, chunk.length);
      this.prefix.set(chunk.subarray(0, copyBytes), this.prefixBytes);
      this.prefixBytes += copyBytes;
    }
    this.observedBytes += chunk.length;
  }

  finalize(
    identityInput: UniversalSourceFactsV4ReceiptFileIdentity,
    options: UniversalSourceFactsV4FinalizeOptions = {},
  ): UniversalSourceFactsV4FileResult {
    if (this.finalized) throw new FoundryIntegrityError("SOURCE_FACTS_V4_COLLECTOR_FINALIZED", "Source Facts V4 collector is already finalized.");
    this.finalized = true;
    const identity = UniversalSourceFactsV4ReceiptFileIdentitySchema.parse(identityInput);
    if (identity.path !== this.relativePath || identity.sizeBytes !== this.observedBytes) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V4_IDENTITY_MISMATCH", "Source Facts V4 bytes do not match their receipt identity.");
    }
    const observedSha256 = this.hash.digest("hex");
    if (observedSha256 !== identity.sha256) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V4_SHA256_MISMATCH", "Source Facts V4 bytes do not match the receipt SHA-256.");
    }
    const magicHex = this.prefix.subarray(0, this.prefixBytes).toString("hex");
    if (identity.magicHex !== magicHex) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V4_MAGIC_BINDING_MISMATCH",
        "Source Facts V4 prefix bytes do not match the receipt-bound magic bytes.",
      );
    }
    const e57Magic = magicHex.startsWith("4153544d2d453537");
    const glbMagic = magicHex.startsWith("676c5446");
    const targetInputType = claimedByInheritedSourceFacts(identity, e57Magic, glbMagic)
      ? null
      : mediaTargetInputType(identity);
    if (options.mediaContainerInspection !== undefined && targetInputType === null) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V4_UNEXPECTED_MEDIA_INSPECTION", "A bounded media inspection was supplied for a non-media V4 target.");
    }
    if (targetInputType !== null) {
      if (options.sogInspection !== undefined || options.spzInspection !== undefined || options.gaussianPlyInspection !== undefined) {
        throw new FoundryIntegrityError("SOURCE_FACTS_V4_CONTRADICTORY_INSPECTIONS", "A media V4 target cannot carry a SOG, SPZ, or Gaussian PLY inspection.");
      }
      if (options.mediaContainerInspection === undefined) {
        throw new FoundryIntegrityError("SOURCE_FACTS_V4_MEDIA_INSPECTION_REQUIRED", "Media Source Facts V4 require a bounded inspection on the identity-bound open handle.");
      }
      if (options.mediaContainerInspection.sourceSizeBytes !== this.observedBytes || options.mediaContainerInspection.sourceSha256 !== observedSha256) {
        throw new FoundryIntegrityError("SOURCE_FACTS_V4_MEDIA_INSPECTION_SOURCE_MISMATCH", "The bounded media inspection does not match the receipt-bound V4 byte stream.");
      }
      return mediaContainerResult(identity, targetInputType, options.mediaContainerInspection);
    }
    const { magicHex: _magicHex, ...v3Identity } = identity;
    const v3Result: UniversalSourceFactsV3FileResult = this.v3Collector.finalize(v3Identity, {
      ...(options.sogInspection === undefined ? {} : { sogInspection: options.sogInspection }),
      ...(options.spzInspection === undefined ? {} : { spzInspection: options.spzInspection }),
      ...(options.gaussianPlyInspection === undefined ? {} : { gaussianPlyInspection: options.gaussianPlyInspection }),
    });
    return UniversalSourceFactsV4FileResultSchema.parse(v3Result);
  }
}

export function createUniversalSourceFactsV4StreamCollector(
  relativePath: string,
): UniversalSourceFactsV4StreamCollector {
  return new UniversalSourceFactsV4StreamCollectorImpl(relativePath);
}

const LIMITS: z.infer<typeof LimitsSchema> = {
  inheritedProfile: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V3,
  e57PhysicalHeaderBytes: E57_PHYSICAL_HEADER_BYTES,
  glbJsonChunkMaxBytes: FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES,
  glbJsonMaxDepth: FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_DEPTH,
  glbJsonMaxValues: FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_VALUES,
  objLogicalLineMaxBytes: FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES,
  sogZipMaxEntries: FOUNDRY_SOG_ZIP_MAX_ENTRIES,
  sogZipCentralDirectoryMaxBytes: FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES,
  sogMetaJsonMaxBytes: FOUNDRY_SOG_META_MAX_BYTES,
  sogMetaJsonMaxDepth: FOUNDRY_SOG_META_JSON_MAX_DEPTH,
  sogMetaJsonMaxValues: FOUNDRY_SOG_META_JSON_MAX_VALUES,
  sogWebpMemberMaxBytes: FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES,
  sogWebpAggregateMaxBytes: FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES,
  spzSourceMaxBytes: FOUNDRY_SPZ_SOURCE_MAX_BYTES,
  spzDecompressedMaxBytes: FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES,
  spzExtensionMaxBytes: FOUNDRY_SPZ_EXTENSION_MAX_BYTES,
  spzExtensionMaxRecords: FOUNDRY_SPZ_EXTENSION_MAX_RECORDS,
  spzGzipHeaderMaxBytes: FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES,
  spzLegacyHeaderBytes: FOUNDRY_SPZ_LEGACY_HEADER_BYTES,
  spzV4HeaderBytes: FOUNDRY_SPZ_V4_HEADER_BYTES,
  spzV4MaxCompressionRatio: FOUNDRY_SPZ_V4_MAX_COMPRESSION_RATIO,
  gaussianPlySourceMaxBytes: FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES,
  gaussianPlyHeaderMaxBytes: FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES,
  gaussianPlyHeaderLineMaxBytes: FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES,
  gaussianPlyElementMaxCount: FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT,
  gaussianPlyPropertyMaxCount: FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT,
  gaussianPlyCommentMaxCount: FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT,
  gaussianPlyVertexMaxCount: FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT,
  gaussianPlyVertexStrideMaxBytes: FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES,
  mediaContainer: FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITS,
};

function resultSource(result: UniversalSourceFactsV4FileResult): z.infer<typeof SourceIdentityBaseSchema> {
  return result.kind === "asset" ? result.asset.source : result.source;
}

function policyForAssets(assets: readonly UniversalSourceFactsV4Asset[]): z.infer<typeof PolicySchema> {
  const usesPye57 = assets.some((asset) =>
    asset.format === "e57" && asset.facts?.aggregateMetadata !== null && asset.facts?.aggregateMetadata !== undefined
  );
  const probe = usesPye57 ? "local_pye57_read_only" as const : "none" as const;
  return {
    sourceAccess: "read_only",
    mutation: "none",
    reconstruction: "none",
    networkAccess: "none",
    externalProcess: probe,
    metadataProbe: probe,
    authority: "none",
    rights: "not_evaluated",
  };
}

function issueArtifact(payload: ArtifactPayload): FoundryUniversalSourceFactsV4 {
  const candidate = { ...payload, factsSha256: "0".repeat(64) } as ArtifactWithoutValidation;
  return FoundryUniversalSourceFactsV4Schema.parse({ ...payload, factsSha256: artifactDigest(candidate) });
}

function uniqueSortedResults(inputs: readonly UniversalSourceFactsV4FileResult[]): UniversalSourceFactsV4FileResult[] {
  if (inputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V4_FILE_COUNT_LIMIT", "Source Facts V4 results exceed the receipt file-count limit.");
  }
  const results = inputs.map((result) => UniversalSourceFactsV4FileResultSchema.parse(result));
  results.sort((left, right) => compareText(resultSource(left).path, resultSource(right).path));
  const paths = results.map((result) => resultSource(result).path);
  if (new Set(paths).size !== paths.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V4_DUPLICATE_RESULT_PATH", "Source Facts V4 results must have unique paths.");
  }
  return results;
}

function unavailableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  affectedSourcesInput: readonly z.infer<typeof BlockedSourceSchema>[],
): FoundryUniversalSourceFactsV4 {
  const affectedSources = affectedSourcesInput
    .map((source) => BlockedSourceSchema.parse(source))
    .sort((left, right) => compareText(left.path, right.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4,
    receiptSha256,
    state: "unavailable",
    policy: policyForAssets([]),
    limitations: [...FOUNDRY_SOURCE_FACTS_V4_LIMITATIONS],
    limits: LIMITS,
    summary: {
      receiptFileCount,
      assetCount: 0,
      establishedCount: 0,
      factsNotEstablishedCount: 0,
      untargetedFileCount: receiptFileCount - affectedSources.length,
      blockedSourceCount: affectedSources.length,
    },
    assets: [],
    affectedSources,
    reason: {
      code: "XGRIDS_XBIN_UNSUPPORTED",
      message: "Universal Source Facts V4 are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate.",
      nextAction: FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
    },
  });
}

function availableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  results: readonly UniversalSourceFactsV4FileResult[],
): FoundryUniversalSourceFactsV4 {
  const assets = results
    .filter((result): result is Extract<UniversalSourceFactsV4FileResult, { readonly kind: "asset" }> => result.kind === "asset")
    .map((result) => result.asset)
    .sort((left, right) => compareText(left.source.path, right.source.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4,
    receiptSha256,
    state: "available",
    policy: policyForAssets(assets),
    limitations: [...FOUNDRY_SOURCE_FACTS_V4_LIMITATIONS],
    limits: LIMITS,
    summary: {
      receiptFileCount,
      assetCount: assets.length,
      establishedCount: assets.filter((asset) => asset.inspection.state === "established").length,
      factsNotEstablishedCount: assets.filter((asset) => asset.inspection.state === "facts_not_established").length,
      untargetedFileCount: receiptFileCount - assets.length,
      blockedSourceCount: 0,
    },
    assets,
  });
}

export function createUniversalSourceFactsV4ArtifactFromReceipt(
  receiptSha256Input: string,
  identityInputs: readonly UniversalSourceFactsV4ReceiptFileIdentity[],
  resultInputs: readonly UniversalSourceFactsV4FileResult[] = [],
): FoundryUniversalSourceFactsV4 {
  const receiptSha256 = z.string().regex(SHA256_HEX).parse(receiptSha256Input);
  if (identityInputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V4_FILE_COUNT_LIMIT", "Source Facts V4 receipt identities exceed the file-count limit.");
  }
  const identities = identityInputs
    .map((identity) => UniversalSourceFactsV4ReceiptFileIdentitySchema.parse(identity))
    .sort((left, right) => compareText(left.path, right.path));
  const identityPaths = identities.map((identity) => identity.path);
  if (new Set(identityPaths).size !== identityPaths.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V4_DUPLICATE_RECEIPT_PATH", "Source Facts V4 receipt identities must have unique paths.");
  }
  const blocked = identities
    .filter((identity) => hasCandidate(identity, "xgrids_xbin"))
    .map((identity) => ({
      path: identity.path,
      sizeBytes: identity.sizeBytes,
      sha256: identity.sha256,
      inputType: "xgrids_xbin" as const,
    }));
  if (blocked.length > 0) return unavailableArtifact(receiptSha256, identities.length, blocked);

  const results = uniqueSortedResults(resultInputs);
  if (results.length !== identities.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V4_RESULT_SET_INCOMPLETE", "Available Source Facts V4 require one finalized result per receipt file.");
  }
  for (const [index, identity] of identities.entries()) {
    const result = results[index];
    if (result === undefined) throw new FoundryIntegrityError("SOURCE_FACTS_V4_RESULT_SET_INCOMPLETE", "Source Facts V4 result is missing.");
    const source = resultSource(result);
    if (source.path !== identity.path || source.sizeBytes !== identity.sizeBytes || source.sha256 !== identity.sha256) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V4_RESULT_IDENTITY_MISMATCH", "Source Facts V4 result does not match its receipt identity.");
    }
    if (result.kind === "xbin_block") {
      throw new FoundryIntegrityError("SOURCE_FACTS_V4_UNEXPECTED_XBIN_RESULT", "An XBIN result was not declared by receipt detection.");
    }
    const e57Magic = identity.magicHex.startsWith("4153544d2d453537");
    const glbMagic = identity.magicHex.startsWith("676c5446");
    const inheritedTarget = claimedByInheritedSourceFacts(identity, e57Magic, glbMagic);
    const expectedMediaCandidates = mediaReceiptCandidates(identity);
    const mediaAsset = result.kind === "asset" &&
      isMediaContainerAsset(result.asset)
      ? result.asset
      : null;
    const shouldBeMediaAsset = !inheritedTarget && expectedMediaCandidates.length > 0;
    if ((mediaAsset !== null) !== shouldBeMediaAsset) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V4_RESULT_TARGET_MISMATCH",
        "A Source Facts V4 result does not match the receipt-derived inherited/media target.",
      );
    }
    if (mediaAsset !== null) {
      if (
        JSON.stringify(mediaAsset.source.receiptCandidateInputTypes) !==
          JSON.stringify(expectedMediaCandidates)
      ) {
        throw new FoundryIntegrityError(
          "SOURCE_FACTS_V4_MEDIA_CANDIDATE_BINDING_MISMATCH",
          "Media Source Facts candidates do not exactly match receipt detection.",
        );
      }
      if (mediaAsset.inspection.state === "established") {
        const expectedFormat = establishedMediaFormatFromMagic(identity.magicHex);
        if (expectedFormat === null || mediaAsset.format !== expectedFormat) {
          throw new FoundryIntegrityError(
            "SOURCE_FACTS_V4_MEDIA_FORMAT_BINDING_MISMATCH",
            "Established media Source Facts format contradicts the receipt-bound signature bytes.",
          );
        }
      } else if (mediaAsset.source.inputType !== mediaTargetInputType(identity)) {
        throw new FoundryIntegrityError(
          "SOURCE_FACTS_V4_MEDIA_INPUT_TYPE_BINDING_MISMATCH",
          "Failed media Source Facts input type contradicts receipt detection.",
        );
      }
    }
  }
  return availableArtifact(receiptSha256, identities.length, results);
}

export function serializeUniversalSourceFactsV4Artifact(value: FoundryUniversalSourceFactsV4): string {
  return stableCanonicalJson(toCanonicalJson(FoundryUniversalSourceFactsV4Schema.parse(value)));
}

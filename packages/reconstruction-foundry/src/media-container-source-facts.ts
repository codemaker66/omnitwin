import type { FileHandle } from "node:fs/promises";
import { z } from "zod";

export const FOUNDRY_MEDIA_CONTAINER_SOURCE_MAX_BYTES = 128 * 1024 * 1024 * 1024;
export const FOUNDRY_MEDIA_CONTAINER_READ_CHUNK_BYTES = 1024 * 1024;
export const FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX = 1_000_000;
export const FOUNDRY_MEDIA_CONTAINER_PIXEL_COUNT_MAX = 1_000_000_000;
export const FOUNDRY_MEDIA_CONTAINER_JPEG_MARKER_MAX_COUNT = 65_536;
export const FOUNDRY_MEDIA_CONTAINER_JPEG_METADATA_MAX_BYTES = 64 * 1024 * 1024;
export const FOUNDRY_MEDIA_CONTAINER_PNG_CHUNK_MAX_COUNT = 65_536;
export const FOUNDRY_MEDIA_CONTAINER_PNG_ANCILLARY_MAX_BYTES = 256 * 1024 * 1024;
export const FOUNDRY_MEDIA_CONTAINER_BMFF_BOX_MAX_COUNT = 100_000;
export const FOUNDRY_MEDIA_CONTAINER_BMFF_DEPTH_MAX = 32;
export const FOUNDRY_MEDIA_CONTAINER_BMFF_BRAND_MAX_COUNT = 64;
export const FOUNDRY_MEDIA_CONTAINER_BMFF_TRACK_MAX_COUNT = 256;
export const FOUNDRY_MEDIA_CONTAINER_BMFF_SAMPLE_DESCRIPTION_MAX_COUNT = 256;

export const FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITS = Object.freeze({
  sourceMaxBytes: FOUNDRY_MEDIA_CONTAINER_SOURCE_MAX_BYTES,
  readChunkBytes: FOUNDRY_MEDIA_CONTAINER_READ_CHUNK_BYTES,
  dimensionMax: FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX,
  pixelCountMax: FOUNDRY_MEDIA_CONTAINER_PIXEL_COUNT_MAX,
  jpegMarkerMaxCount: FOUNDRY_MEDIA_CONTAINER_JPEG_MARKER_MAX_COUNT,
  jpegMetadataMaxBytes: FOUNDRY_MEDIA_CONTAINER_JPEG_METADATA_MAX_BYTES,
  pngChunkMaxCount: FOUNDRY_MEDIA_CONTAINER_PNG_CHUNK_MAX_COUNT,
  pngAncillaryMaxBytes: FOUNDRY_MEDIA_CONTAINER_PNG_ANCILLARY_MAX_BYTES,
  bmffBoxMaxCount: FOUNDRY_MEDIA_CONTAINER_BMFF_BOX_MAX_COUNT,
  bmffDepthMax: FOUNDRY_MEDIA_CONTAINER_BMFF_DEPTH_MAX,
  bmffBrandMaxCount: FOUNDRY_MEDIA_CONTAINER_BMFF_BRAND_MAX_COUNT,
  bmffTrackMaxCount: FOUNDRY_MEDIA_CONTAINER_BMFF_TRACK_MAX_COUNT,
  bmffSampleDescriptionMaxCount: FOUNDRY_MEDIA_CONTAINER_BMFF_SAMPLE_DESCRIPTION_MAX_COUNT,
} as const);

export const FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITATIONS = Object.freeze([
  "IMAGE_PIXELS_VIDEO_SAMPLES_AUDIO_AND_COLOUR_TRANSFORMS_ARE_NOT_DECODED",
  "OPTIONAL_METADATA_PAYLOADS_ARE_NOT_RETAINED_OR_TREATED_AS_AUTHORITATIVE",
  "CONTAINER_BRANDS_CODEC_DECLARATIONS_AND_MOVIE_TRACK_METADATA_DO_NOT_ESTABLISH_SAMPLE_TABLE_COMPLETENESS_MDAT_BINDING_OR_DECODER_COMPATIBILITY",
  "CONTAINER_FACTS_DO_NOT_ESTABLISH_CAPTURE_ROLE_PROVENANCE_CALIBRATION_FIDELITY_OR_RIGHTS",
] as const);

export const FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CODES = Object.freeze([
  "MEDIA_CONTAINER_INSPECTION_CANCELLED",
  "MEDIA_CONTAINER_UNRECOGNIZED",
  "MEDIA_CONTAINER_SOURCE_SIZE_INVALID",
  "MEDIA_CONTAINER_SOURCE_SIZE_LIMIT_EXCEEDED",
  "MEDIA_CONTAINER_SOURCE_NOT_REGULAR",
  "MEDIA_CONTAINER_SOURCE_SIZE_MISMATCH",
  "MEDIA_CONTAINER_SOURCE_CHANGED",
  "MEDIA_CONTAINER_HANDLE_READ_FAILED",
  "MEDIA_CONTAINER_DIMENSION_LIMIT_EXCEEDED",
  "MEDIA_CONTAINER_PIXEL_COUNT_LIMIT_EXCEEDED",
  "JPEG_MARKER_LIMIT_EXCEEDED",
  "JPEG_METADATA_LIMIT_EXCEEDED",
  "JPEG_CODING_PROCESS_UNSUPPORTED",
  "JPEG_SAMPLE_PRECISION_UNSUPPORTED",
  "JPEG_COMPONENT_COUNT_UNSUPPORTED",
  "JPEG_MULTIPLE_FRAME_HEADERS_UNSUPPORTED",
  "JPEG_DEFINE_NUMBER_OF_LINES_UNSUPPORTED",
  "JPEG_MARKER_STRUCTURE_INVALID",
  "JPEG_SEGMENT_LENGTH_INVALID",
  "JPEG_FRAME_HEADER_INVALID",
  "JPEG_SCAN_HEADER_INVALID",
  "JPEG_FRAME_HEADER_MISSING",
  "JPEG_SCAN_MISSING",
  "JPEG_EOI_MISSING",
  "JPEG_TRAILING_BYTES",
  "PNG_CHUNK_LIMIT_EXCEEDED",
  "PNG_ANCILLARY_LIMIT_EXCEEDED",
  "PNG_ANIMATION_UNSUPPORTED",
  "PNG_CRITICAL_CHUNK_UNSUPPORTED",
  "PNG_IHDR_INVALID",
  "PNG_CHUNK_TYPE_INVALID",
  "PNG_CHUNK_LENGTH_INVALID",
  "PNG_CHUNK_CRC_MISMATCH",
  "PNG_CHUNK_ORDER_INVALID",
  "PNG_IDAT_MISSING",
  "PNG_IEND_INVALID",
  "PNG_TRAILING_BYTES",
  "BMFF_BOX_LIMIT_EXCEEDED",
  "BMFF_DEPTH_LIMIT_EXCEEDED",
  "BMFF_BRAND_LIMIT_EXCEEDED",
  "BMFF_TRACK_LIMIT_EXCEEDED",
  "BMFF_SAMPLE_DESCRIPTION_LIMIT_EXCEEDED",
  "BMFF_HEIF_AVIF_UNSUPPORTED",
  "BMFF_FRAGMENTED_UNSUPPORTED",
  "BMFF_ENCRYPTED_UNSUPPORTED",
  "BMFF_OPEN_ENDED_BOX_UNSUPPORTED",
  "BMFF_BOX_TYPE_INVALID",
  "BMFF_BOX_SIZE_INVALID",
  "BMFF_BOX_TILING_INVALID",
  "BMFF_FTYP_MISSING",
  "BMFF_FTYP_INVALID",
  "BMFF_MOOV_MISSING",
  "BMFF_MULTIPLE_MOOV",
  "BMFF_MVHD_INVALID",
  "BMFF_MDAT_MISSING",
  "BMFF_TRACK_STRUCTURE_INVALID",
  "BMFF_VIDEO_TRACK_MISSING",
  "BMFF_VIDEO_SAMPLE_DESCRIPTION_INVALID",
  "MEDIA_CONTAINER_INSPECTION_FAILED",
] as const);

export type FoundryMediaContainerSourceFactsFailureCode =
  (typeof FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CODES)[number];
export type FoundryMediaContainerSourceFactsFailureCategory =
  | "parse_failure"
  | "resource_limit"
  | "unsupported_variant"
  | "unsupported_container"
  | "cancelled";

export const FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE = Object.freeze({
  MEDIA_CONTAINER_INSPECTION_CANCELLED: "cancelled",
  MEDIA_CONTAINER_UNRECOGNIZED: "unsupported_container",
  MEDIA_CONTAINER_SOURCE_SIZE_INVALID: "resource_limit",
  MEDIA_CONTAINER_SOURCE_SIZE_LIMIT_EXCEEDED: "resource_limit",
  MEDIA_CONTAINER_SOURCE_NOT_REGULAR: "parse_failure",
  MEDIA_CONTAINER_SOURCE_SIZE_MISMATCH: "parse_failure",
  MEDIA_CONTAINER_SOURCE_CHANGED: "parse_failure",
  MEDIA_CONTAINER_HANDLE_READ_FAILED: "parse_failure",
  MEDIA_CONTAINER_DIMENSION_LIMIT_EXCEEDED: "resource_limit",
  MEDIA_CONTAINER_PIXEL_COUNT_LIMIT_EXCEEDED: "resource_limit",
  JPEG_MARKER_LIMIT_EXCEEDED: "resource_limit",
  JPEG_METADATA_LIMIT_EXCEEDED: "resource_limit",
  JPEG_CODING_PROCESS_UNSUPPORTED: "unsupported_variant",
  JPEG_SAMPLE_PRECISION_UNSUPPORTED: "unsupported_variant",
  JPEG_COMPONENT_COUNT_UNSUPPORTED: "unsupported_variant",
  JPEG_MULTIPLE_FRAME_HEADERS_UNSUPPORTED: "unsupported_variant",
  JPEG_DEFINE_NUMBER_OF_LINES_UNSUPPORTED: "unsupported_variant",
  JPEG_MARKER_STRUCTURE_INVALID: "parse_failure",
  JPEG_SEGMENT_LENGTH_INVALID: "parse_failure",
  JPEG_FRAME_HEADER_INVALID: "parse_failure",
  JPEG_SCAN_HEADER_INVALID: "parse_failure",
  JPEG_FRAME_HEADER_MISSING: "parse_failure",
  JPEG_SCAN_MISSING: "parse_failure",
  JPEG_EOI_MISSING: "parse_failure",
  JPEG_TRAILING_BYTES: "parse_failure",
  PNG_CHUNK_LIMIT_EXCEEDED: "resource_limit",
  PNG_ANCILLARY_LIMIT_EXCEEDED: "resource_limit",
  PNG_ANIMATION_UNSUPPORTED: "unsupported_variant",
  PNG_CRITICAL_CHUNK_UNSUPPORTED: "unsupported_variant",
  PNG_IHDR_INVALID: "parse_failure",
  PNG_CHUNK_TYPE_INVALID: "parse_failure",
  PNG_CHUNK_LENGTH_INVALID: "parse_failure",
  PNG_CHUNK_CRC_MISMATCH: "parse_failure",
  PNG_CHUNK_ORDER_INVALID: "parse_failure",
  PNG_IDAT_MISSING: "parse_failure",
  PNG_IEND_INVALID: "parse_failure",
  PNG_TRAILING_BYTES: "parse_failure",
  BMFF_BOX_LIMIT_EXCEEDED: "resource_limit",
  BMFF_DEPTH_LIMIT_EXCEEDED: "resource_limit",
  BMFF_BRAND_LIMIT_EXCEEDED: "resource_limit",
  BMFF_TRACK_LIMIT_EXCEEDED: "resource_limit",
  BMFF_SAMPLE_DESCRIPTION_LIMIT_EXCEEDED: "resource_limit",
  BMFF_HEIF_AVIF_UNSUPPORTED: "unsupported_variant",
  BMFF_FRAGMENTED_UNSUPPORTED: "unsupported_variant",
  BMFF_ENCRYPTED_UNSUPPORTED: "unsupported_variant",
  BMFF_OPEN_ENDED_BOX_UNSUPPORTED: "unsupported_variant",
  BMFF_BOX_TYPE_INVALID: "parse_failure",
  BMFF_BOX_SIZE_INVALID: "parse_failure",
  BMFF_BOX_TILING_INVALID: "parse_failure",
  BMFF_FTYP_MISSING: "parse_failure",
  BMFF_FTYP_INVALID: "parse_failure",
  BMFF_MOOV_MISSING: "parse_failure",
  BMFF_MULTIPLE_MOOV: "parse_failure",
  BMFF_MVHD_INVALID: "parse_failure",
  BMFF_MDAT_MISSING: "parse_failure",
  BMFF_TRACK_STRUCTURE_INVALID: "parse_failure",
  BMFF_VIDEO_TRACK_MISSING: "parse_failure",
  BMFF_VIDEO_SAMPLE_DESCRIPTION_INVALID: "parse_failure",
  MEDIA_CONTAINER_INSPECTION_FAILED: "parse_failure",
} as const satisfies Readonly<Record<
  FoundryMediaContainerSourceFactsFailureCode,
  FoundryMediaContainerSourceFactsFailureCategory
>>);

const DECIMAL_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const FOURCC = /^[\x20-\x7e]{4}$/u;
const BMFF_HEIF_AVIF_BRANDS = new Set([
  "avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1",
]);
const DecimalIntegerSchema = z.string().regex(DECIMAL_INTEGER).max(40);
const ContainerSchema = z.object({
  sourceSizeBytes: z.number().int().safe().positive().max(FOUNDRY_MEDIA_CONTAINER_SOURCE_MAX_BYTES),
  exactFileLengthVerified: z.literal(true),
  trailingBytes: z.literal(0),
}).strict();
const DimensionsSchema = z.object({
  width: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX),
  height: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX),
  pixelCount: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_PIXEL_COUNT_MAX),
}).strict().superRefine((value, ctx) => {
  if (value.pixelCount !== value.width * value.height) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pixelCount"], message: "pixel count must equal width times height" });
  }
});
const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITATIONS[0]),
  z.literal(FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITATIONS[1]),
  z.literal(FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITATIONS[2]),
  z.literal(FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITATIONS[3]),
]);

const JpegFactsSchema = z.object({
  format: z.literal("jpeg"),
  profile: z.literal("jpeg_sof0_or_sof2_8bit_huffman"),
  inspectionCoverage: z.literal("complete_marker_and_entropy_structure"),
  dimensions: DimensionsSchema,
  coding: z.object({
    process: z.enum(["baseline_sequential_dct", "progressive_dct"]),
    samplePrecisionBits: z.literal(8),
    componentCount: z.union([z.literal(1), z.literal(3), z.literal(4)]),
    scanCount: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_JPEG_MARKER_MAX_COUNT),
    restartMarkerCount: z.number().int().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_JPEG_MARKER_MAX_COUNT),
  }).strict(),
  structure: z.object({
    markerCount: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_JPEG_MARKER_MAX_COUNT),
    appSegmentCount: z.number().int().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_JPEG_MARKER_MAX_COUNT),
    commentSegmentCount: z.number().int().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_JPEG_MARKER_MAX_COUNT),
    metadataPayloadBytes: z.number().int().safe().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_JPEG_METADATA_MAX_BYTES),
    eoiOffsetBytes: z.number().int().safe().positive().max(FOUNDRY_MEDIA_CONTAINER_SOURCE_MAX_BYTES),
  }).strict(),
  container: ContainerSchema,
  limitations: LimitationsSchema,
}).strict().superRefine((facts, ctx) => {
  if (facts.structure.eoiOffsetBytes + 2 !== facts.container.sourceSizeBytes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["structure", "eoiOffsetBytes"], message: "JPEG EOI must end at exact file length" });
  }
});

const PngFactsSchema = z.object({
  format: z.literal("png"),
  profile: z.literal("png_static"),
  inspectionCoverage: z.literal("complete_chunk_table_and_crc"),
  dimensions: DimensionsSchema,
  image: z.object({
    bitDepth: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
    colorType: z.enum(["grayscale", "truecolor", "indexed", "grayscale_alpha", "truecolor_alpha"]),
    channelCount: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    interlace: z.enum(["none", "adam7"]),
  }).strict(),
  chunks: z.object({
    count: z.number().int().min(3).max(FOUNDRY_MEDIA_CONTAINER_PNG_CHUNK_MAX_COUNT),
    idatCount: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_PNG_CHUNK_MAX_COUNT),
    idatPayloadBytes: z.number().int().safe().positive().max(FOUNDRY_MEDIA_CONTAINER_SOURCE_MAX_BYTES),
    ancillaryCount: z.number().int().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_PNG_CHUNK_MAX_COUNT),
    ancillaryPayloadBytes: z.number().int().safe().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_PNG_ANCILLARY_MAX_BYTES),
    paletteEntries: z.number().int().min(1).max(256).nullable(),
    transparencyDeclared: z.boolean(),
    allCrcsVerified: z.literal(true),
    animationChunks: z.literal(0),
  }).strict(),
  container: ContainerSchema,
  limitations: LimitationsSchema,
}).strict().superRefine((facts, ctx) => {
  const expectedChannels = {
    grayscale: 1,
    truecolor: 3,
    indexed: 1,
    grayscale_alpha: 2,
    truecolor_alpha: 4,
  } as const;
  const legalBitDepths = {
    grayscale: [1, 2, 4, 8, 16],
    truecolor: [8, 16],
    indexed: [1, 2, 4, 8],
    grayscale_alpha: [8, 16],
    truecolor_alpha: [8, 16],
  } as const;
  const colorType = facts.image.colorType;
  if (facts.image.channelCount !== expectedChannels[colorType]) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["image", "channelCount"], message: "PNG channel count contradicts color type" });
  }
  if (!(legalBitDepths[colorType] as readonly number[]).includes(facts.image.bitDepth)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["image", "bitDepth"], message: "PNG bit depth contradicts color type" });
  }
  if (colorType === "indexed") {
    if (facts.chunks.paletteEntries === null || facts.chunks.paletteEntries > 2 ** facts.image.bitDepth) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chunks", "paletteEntries"], message: "indexed PNG facts require a legal palette" });
    }
  } else if (
    (colorType === "grayscale" || colorType === "grayscale_alpha") &&
    facts.chunks.paletteEntries !== null
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chunks", "paletteEntries"], message: "grayscale PNG facts cannot declare a palette" });
  }
  if (
    (colorType === "grayscale_alpha" || colorType === "truecolor_alpha") &&
    facts.chunks.transparencyDeclared
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chunks", "transparencyDeclared"], message: "alpha PNG color types cannot also declare tRNS" });
  }
  const expectedChunkCount = 2 + facts.chunks.idatCount + facts.chunks.ancillaryCount +
    (facts.chunks.paletteEntries === null ? 0 : 1);
  if (facts.chunks.count !== expectedChunkCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chunks", "count"], message: "PNG chunk counts are inconsistent" });
  }
  if (facts.chunks.transparencyDeclared && facts.chunks.ancillaryCount === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chunks", "ancillaryCount"], message: "PNG tRNS declaration requires an ancillary chunk" });
  }
  if (facts.chunks.ancillaryCount === 0 && facts.chunks.ancillaryPayloadBytes !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chunks", "ancillaryPayloadBytes"], message: "PNG ancillary bytes require an ancillary chunk" });
  }
});

const BmffSampleDescriptionSchema = z.object({
  ordinal: z.number().int().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_BMFF_SAMPLE_DESCRIPTION_MAX_COUNT - 1),
  typeCode: z.string().regex(FOURCC),
  width: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX),
  height: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX),
}).strict().superRefine((value, ctx) => {
  if (value.width * value.height > FOUNDRY_MEDIA_CONTAINER_PIXEL_COUNT_MAX) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["width"], message: "sample-description pixel count exceeds the profile limit" });
  }
});

const BmffVideoTrackSchema = z.object({
  ordinal: z.number().int().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_BMFF_TRACK_MAX_COUNT - 1),
  trackId: z.number().int().positive().max(0xffff_ffff),
  enabled: z.boolean(),
  trackWidthPixels: z.number().finite().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX),
  trackHeightPixels: z.number().finite().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX),
  mediaTimescale: z.number().int().positive().max(0xffff_ffff),
  mediaDurationUnits: DecimalIntegerSchema,
  sampleDescriptions: z.array(BmffSampleDescriptionSchema).min(1).max(
    FOUNDRY_MEDIA_CONTAINER_BMFF_SAMPLE_DESCRIPTION_MAX_COUNT,
  ),
}).strict().superRefine((track, ctx) => {
  if (track.sampleDescriptions.some((entry, index) => entry.ordinal !== index)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sampleDescriptions"], message: "sample-description ordinals must be contiguous" });
  }
});

const IsoBmffFactsSchema = z.object({
  format: z.literal("iso_bmff"),
  profile: z.literal("iso_bmff_movie_video_track_declarations"),
  inspectionCoverage: z.literal("complete_top_level_tiling_and_selected_movie_video_structure"),
  fileType: z.object({
    majorBrand: z.string().regex(FOURCC),
    minorVersion: z.number().int().nonnegative().max(0xffff_ffff),
    compatibleBrands: z.array(z.string().regex(FOURCC)).max(FOUNDRY_MEDIA_CONTAINER_BMFF_BRAND_MAX_COUNT),
  }).strict(),
  movie: z.object({
    timescale: z.number().int().positive().max(0xffff_ffff),
    durationUnits: DecimalIntegerSchema,
  }).strict(),
  boxes: z.object({
    count: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_BMFF_BOX_MAX_COUNT),
    maxDepth: z.number().int().min(1).max(FOUNDRY_MEDIA_CONTAINER_BMFF_DEPTH_MAX),
    topLevelCount: z.number().int().min(3).max(FOUNDRY_MEDIA_CONTAINER_BMFF_BOX_MAX_COUNT),
    extendedSizeCount: z.number().int().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_BMFF_BOX_MAX_COUNT),
    mdatCount: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_BMFF_BOX_MAX_COUNT),
    mdatPayloadBytes: z.number().int().safe().nonnegative().max(FOUNDRY_MEDIA_CONTAINER_SOURCE_MAX_BYTES),
  }).strict(),
  tracks: z.object({
    count: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_BMFF_TRACK_MAX_COUNT),
    videoCount: z.number().int().positive().max(FOUNDRY_MEDIA_CONTAINER_BMFF_TRACK_MAX_COUNT),
    video: z.array(BmffVideoTrackSchema).min(1).max(FOUNDRY_MEDIA_CONTAINER_BMFF_TRACK_MAX_COUNT),
  }).strict(),
  container: ContainerSchema,
  limitations: LimitationsSchema,
}).strict().superRefine((facts, ctx) => {
  if (
    [facts.fileType.majorBrand, ...facts.fileType.compatibleBrands]
      .some((brand) => BMFF_HEIF_AVIF_BRANDS.has(brand))
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fileType"], message: "HEIF and AVIF brands are outside the ISO movie-video declaration profile" });
  }
  if (facts.tracks.videoCount !== facts.tracks.video.length || facts.tracks.videoCount > facts.tracks.count) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks"], message: "BMFF track counts are inconsistent" });
  }
  if (facts.tracks.video.some((track, index) => track.ordinal >= facts.tracks.count || (index > 0 && track.ordinal <= (facts.tracks.video[index - 1]?.ordinal ?? -1)))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks", "video"], message: "video-track ordinals must preserve unique track order" });
  }
  if (new Set(facts.tracks.video.map((track) => track.trackId)).size !== facts.tracks.video.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks", "video"], message: "video-track identifiers must be unique" });
  }
  if (
    facts.boxes.topLevelCount > facts.boxes.count ||
    facts.boxes.extendedSizeCount > facts.boxes.count ||
    facts.boxes.mdatCount > facts.boxes.topLevelCount ||
    facts.boxes.mdatPayloadBytes > facts.container.sourceSizeBytes ||
    facts.tracks.count > facts.boxes.count
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["boxes"], message: "BMFF box, media-data, and track counts are inconsistent" });
  }
});

export const FoundryMediaContainerSourceFactsSchema = z.union([
  JpegFactsSchema,
  PngFactsSchema,
  IsoBmffFactsSchema,
]);
export type FoundryMediaContainerSourceFacts = z.infer<typeof FoundryMediaContainerSourceFactsSchema>;

export interface FoundryMediaContainerSourceFactsSourceBinding {
  readonly sourceSha256: string;
  readonly sourceSizeBytes: number;
}

export type FoundryMediaContainerSourceFactsOutcome = FoundryMediaContainerSourceFactsSourceBinding & (
  | { readonly state: "established"; readonly facts: FoundryMediaContainerSourceFacts }
  | {
      readonly state: "facts_not_established";
      readonly category: FoundryMediaContainerSourceFactsFailureCategory;
      readonly code: FoundryMediaContainerSourceFactsFailureCode;
    }
  );

type FailureCategory = FoundryMediaContainerSourceFactsFailureCategory;
type FailureCode = FoundryMediaContainerSourceFactsFailureCode;

class MediaContainerInspectionFailure extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly code: FailureCode,
  ) {
    super(code);
    this.name = "MediaContainerInspectionFailure";
  }
}

function fail(category: FailureCategory, code: FailureCode): never {
  if (FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code] !== category) {
    throw new MediaContainerInspectionFailure("parse_failure", "MEDIA_CONTAINER_INSPECTION_FAILED");
  }
  throw new MediaContainerInspectionFailure(category, code);
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("cancelled", "MEDIA_CONTAINER_INSPECTION_CANCELLED");
}

function sameFileIdentity(
  left: Awaited<ReturnType<FileHandle["stat"]>>,
  right: Awaited<ReturnType<FileHandle["stat"]>>,
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

async function statHandle(
  handle: FileHandle,
  signal: AbortSignal | undefined,
): Promise<Awaited<ReturnType<FileHandle["stat"]>>> {
  try {
    assertNotCancelled(signal);
    const value = await handle.stat();
    assertNotCancelled(signal);
    return value;
  } catch (error: unknown) {
    if (error instanceof MediaContainerInspectionFailure) throw error;
    fail("parse_failure", "MEDIA_CONTAINER_HANDLE_READ_FAILED");
  }
}

class BoundedHandleReader {
  private cache = Buffer.alloc(0);
  private cacheStart = -1;

  constructor(
    private readonly handle: FileHandle,
    readonly size: number,
    private readonly signal: AbortSignal | undefined,
  ) {}

  private assertRange(position: number, length: number, code: FailureCode): void {
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position + length > this.size) {
      fail("parse_failure", code);
    }
  }

  async readExact(position: number, length: number, code: FailureCode): Promise<Buffer> {
    this.assertRange(position, length, code);
    const output = Buffer.allocUnsafe(length);
    let completed = 0;
    try {
      while (completed < length) {
        assertNotCancelled(this.signal);
        const requested = Math.min(FOUNDRY_MEDIA_CONTAINER_READ_CHUNK_BYTES, length - completed);
        const { bytesRead } = await this.handle.read(output, completed, requested, position + completed);
        assertNotCancelled(this.signal);
        if (bytesRead <= 0) fail("parse_failure", code);
        completed += bytesRead;
      }
      return output;
    } catch (error: unknown) {
      if (error instanceof MediaContainerInspectionFailure) throw error;
      fail("parse_failure", "MEDIA_CONTAINER_HANDLE_READ_FAILED");
    }
  }

  async byte(position: number, code: FailureCode): Promise<number> {
    this.assertRange(position, 1, code);
    if (position < this.cacheStart || position >= this.cacheStart + this.cache.length) {
      const length = Math.min(FOUNDRY_MEDIA_CONTAINER_READ_CHUNK_BYTES, this.size - position);
      this.cache = await this.readExact(position, length, code);
      this.cacheStart = position;
    }
    const value = this.cache[position - this.cacheStart];
    if (value === undefined) fail("parse_failure", code);
    return value;
  }

  async forEachChunk(
    position: number,
    length: number,
    code: FailureCode,
    consume: (chunk: Buffer) => void,
  ): Promise<void> {
    this.assertRange(position, length, code);
    let completed = 0;
    while (completed < length) {
      const chunkLength = Math.min(FOUNDRY_MEDIA_CONTAINER_READ_CHUNK_BYTES, length - completed);
      consume(await this.readExact(position + completed, chunkLength, code));
      completed += chunkLength;
    }
  }
}

function assertDimensions(width: number, height: number): void {
  if (width <= 0 || height <= 0 || width > FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX || height > FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX) {
    fail("resource_limit", "MEDIA_CONTAINER_DIMENSION_LIMIT_EXCEEDED");
  }
  if (width * height > FOUNDRY_MEDIA_CONTAINER_PIXEL_COUNT_MAX) {
    fail("resource_limit", "MEDIA_CONTAINER_PIXEL_COUNT_LIMIT_EXCEEDED");
  }
}

function dimensions(width: number, height: number): z.infer<typeof DimensionsSchema> {
  assertDimensions(width, height);
  return { width, height, pixelCount: width * height };
}

function decimal(value: number | bigint): string {
  return value.toString(10);
}

function fourcc(bytes: Buffer, code: FailureCode): string {
  if (bytes.length !== 4 || [...bytes].some((byte) => byte < 0x20 || byte > 0x7e)) {
    fail("parse_failure", code);
  }
  return bytes.toString("ascii");
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function detectedFormat(
  reader: BoundedHandleReader,
): Promise<"jpeg" | "png" | "iso_bmff" | null> {
  if (reader.size >= 3) {
    const head = await reader.readExact(0, Math.min(16, reader.size), "MEDIA_CONTAINER_HANDLE_READ_FAILED");
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
    if (head.length >= PNG_SIGNATURE.length && head.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "png";
    // The ftyp signature is enough to route malformed ISO-BMFF candidates to
    // the BMFF parser, which then emits a stable box/ftyp failure instead of
    // misclassifying a recognizable but invalid container as unrecognized.
    if (head.length >= 8 && head.subarray(4, 8).toString("ascii") === "ftyp") return "iso_bmff";
  }
  return null;
}

const JPEG_UNSUPPORTED_SOF_MARKERS = new Set([
  0xc1, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

interface JpegFrame {
  readonly process: "baseline_sequential_dct" | "progressive_dct";
  readonly width: number;
  readonly height: number;
  readonly componentIds: ReadonlySet<number>;
  readonly componentCount: 1 | 3 | 4;
}

async function inspectJpeg(reader: BoundedHandleReader): Promise<FoundryMediaContainerSourceFacts> {
  if (reader.size < 4) fail("parse_failure", "JPEG_MARKER_STRUCTURE_INVALID");
  const soi = await reader.readExact(0, 2, "JPEG_MARKER_STRUCTURE_INVALID");
  if (soi[0] !== 0xff || soi[1] !== 0xd8) fail("unsupported_container", "MEDIA_CONTAINER_UNRECOGNIZED");

  let position = 2;
  let markerCount = 1;
  let appSegmentCount = 0;
  let commentSegmentCount = 0;
  let metadataPayloadBytes = 0;
  let scanCount = 0;
  let restartMarkerCount = 0;
  let frame: JpegFrame | null = null;
  let pendingMarker: { readonly code: number; readonly markerStart: number; readonly afterCode: number } | null = null;

  const countMarker = (): void => {
    markerCount += 1;
    if (markerCount > FOUNDRY_MEDIA_CONTAINER_JPEG_MARKER_MAX_COUNT) {
      fail("resource_limit", "JPEG_MARKER_LIMIT_EXCEEDED");
    }
  };

  for (;;) {
    if (position >= reader.size && pendingMarker === null) fail("parse_failure", "JPEG_EOI_MISSING");
    let markerCode: number;
    let markerStart: number;
    if (pendingMarker !== null) {
      markerCode = pendingMarker.code;
      markerStart = pendingMarker.markerStart;
      position = pendingMarker.afterCode;
      pendingMarker = null;
    } else {
      markerStart = position;
      if (await reader.byte(position, "JPEG_MARKER_STRUCTURE_INVALID") !== 0xff) {
        fail("parse_failure", "JPEG_MARKER_STRUCTURE_INVALID");
      }
      position += 1;
      while (position < reader.size && await reader.byte(position, "JPEG_MARKER_STRUCTURE_INVALID") === 0xff) {
        position += 1;
      }
      if (position >= reader.size) fail("parse_failure", "JPEG_EOI_MISSING");
      markerCode = await reader.byte(position, "JPEG_MARKER_STRUCTURE_INVALID");
      position += 1;
      if (markerCode === 0x00) fail("parse_failure", "JPEG_MARKER_STRUCTURE_INVALID");
    }
    countMarker();

    if (markerCode === 0xd9) {
      if (position !== reader.size) fail("parse_failure", "JPEG_TRAILING_BYTES");
      if (frame === null) fail("parse_failure", "JPEG_FRAME_HEADER_MISSING");
      if (scanCount === 0) fail("parse_failure", "JPEG_SCAN_MISSING");
      return FoundryMediaContainerSourceFactsSchema.parse({
        format: "jpeg",
        profile: "jpeg_sof0_or_sof2_8bit_huffman",
        inspectionCoverage: "complete_marker_and_entropy_structure",
        dimensions: dimensions(frame.width, frame.height),
        coding: {
          process: frame.process,
          samplePrecisionBits: 8,
          componentCount: frame.componentCount,
          scanCount,
          restartMarkerCount,
        },
        structure: {
          markerCount,
          appSegmentCount,
          commentSegmentCount,
          metadataPayloadBytes,
          eoiOffsetBytes: markerStart,
        },
        container: {
          sourceSizeBytes: reader.size,
          exactFileLengthVerified: true,
          trailingBytes: 0,
        },
        limitations: FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITATIONS,
      });
    }
    if (markerCode === 0xd8 || (markerCode >= 0xd0 && markerCode <= 0xd7)) {
      fail("parse_failure", "JPEG_MARKER_STRUCTURE_INVALID");
    }
    if (markerCode === 0x01) continue;
    if (
      JPEG_UNSUPPORTED_SOF_MARKERS.has(markerCode) ||
      markerCode === 0xc8 ||
      markerCode === 0xcc ||
      markerCode === 0xde ||
      markerCode === 0xdf ||
      (markerCode >= 0xf0 && markerCode <= 0xfd)
    ) {
      fail("unsupported_variant", "JPEG_CODING_PROCESS_UNSUPPORTED");
    }
    if (markerCode === 0xdc) {
      fail("unsupported_variant", "JPEG_DEFINE_NUMBER_OF_LINES_UNSUPPORTED");
    }

    if (position + 2 > reader.size) fail("parse_failure", "JPEG_SEGMENT_LENGTH_INVALID");
    const segmentLengthBytes = await reader.readExact(position, 2, "JPEG_SEGMENT_LENGTH_INVALID");
    const segmentLength = segmentLengthBytes.readUInt16BE(0);
    if (segmentLength < 2 || position + segmentLength > reader.size) {
      fail("parse_failure", "JPEG_SEGMENT_LENGTH_INVALID");
    }
    const payloadStart = position + 2;
    const payloadLength = segmentLength - 2;
    const segmentEnd = position + segmentLength;

    if ((markerCode >= 0xe0 && markerCode <= 0xef) || markerCode === 0xfe) {
      if (markerCode === 0xfe) commentSegmentCount += 1;
      else appSegmentCount += 1;
      metadataPayloadBytes += payloadLength;
      if (metadataPayloadBytes > FOUNDRY_MEDIA_CONTAINER_JPEG_METADATA_MAX_BYTES) {
        fail("resource_limit", "JPEG_METADATA_LIMIT_EXCEEDED");
      }
    }

    if (markerCode === 0xc0 || markerCode === 0xc2) {
      if (frame !== null) fail("unsupported_variant", "JPEG_MULTIPLE_FRAME_HEADERS_UNSUPPORTED");
      if (payloadLength < 6) fail("parse_failure", "JPEG_FRAME_HEADER_INVALID");
      const payload = await reader.readExact(payloadStart, payloadLength, "JPEG_FRAME_HEADER_INVALID");
      const precision = payload[0] ?? 0;
      const height = payload.readUInt16BE(1);
      const width = payload.readUInt16BE(3);
      const componentCount = payload[5] ?? 0;
      if (precision !== 8) fail("unsupported_variant", "JPEG_SAMPLE_PRECISION_UNSUPPORTED");
      if (componentCount !== 1 && componentCount !== 3 && componentCount !== 4) {
        fail("unsupported_variant", "JPEG_COMPONENT_COUNT_UNSUPPORTED");
      }
      if (height === 0) fail("unsupported_variant", "JPEG_DEFINE_NUMBER_OF_LINES_UNSUPPORTED");
      if (payloadLength !== 6 + componentCount * 3) fail("parse_failure", "JPEG_FRAME_HEADER_INVALID");
      assertDimensions(width, height);
      const componentIds = new Set<number>();
      for (let index = 0; index < componentCount; index += 1) {
        const offset = 6 + index * 3;
        const componentId = payload[offset] ?? -1;
        const sampling = payload[offset + 1] ?? 0;
        const quantizationTable = payload[offset + 2] ?? 0xff;
        const horizontal = sampling >>> 4;
        const vertical = sampling & 0x0f;
        if (componentIds.has(componentId) || horizontal < 1 || horizontal > 4 || vertical < 1 || vertical > 4 || quantizationTable > 3) {
          fail("parse_failure", "JPEG_FRAME_HEADER_INVALID");
        }
        componentIds.add(componentId);
      }
      frame = {
        process: markerCode === 0xc0 ? "baseline_sequential_dct" : "progressive_dct",
        width,
        height,
        componentIds,
        componentCount,
      };
    }

    position = segmentEnd;
    if (markerCode !== 0xda) continue;
    if (frame === null) fail("parse_failure", "JPEG_SCAN_HEADER_INVALID");
    const scanHeader = await reader.readExact(payloadStart, payloadLength, "JPEG_SCAN_HEADER_INVALID");
    const scanComponentCount = scanHeader[0] ?? 0;
    if (scanComponentCount < 1 || scanComponentCount > frame.componentCount || payloadLength !== 4 + scanComponentCount * 2) {
      fail("parse_failure", "JPEG_SCAN_HEADER_INVALID");
    }
    const scanComponents = new Set<number>();
    for (let index = 0; index < scanComponentCount; index += 1) {
      const offset = 1 + index * 2;
      const componentId = scanHeader[offset] ?? -1;
      const tableSelectors = scanHeader[offset + 1] ?? 0xff;
      if (!frame.componentIds.has(componentId) || scanComponents.has(componentId) || (tableSelectors >>> 4) > 3 || (tableSelectors & 0x0f) > 3) {
        fail("parse_failure", "JPEG_SCAN_HEADER_INVALID");
      }
      scanComponents.add(componentId);
    }
    const spectralStart = scanHeader[1 + scanComponentCount * 2] ?? 0xff;
    const spectralEnd = scanHeader[2 + scanComponentCount * 2] ?? 0xff;
    const approximation = scanHeader[3 + scanComponentCount * 2] ?? 0xff;
    if (frame.process === "baseline_sequential_dct") {
      if (spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0) {
        fail("parse_failure", "JPEG_SCAN_HEADER_INVALID");
      }
    } else {
      const high = approximation >>> 4;
      const low = approximation & 0x0f;
      if (spectralStart > spectralEnd || spectralEnd > 63 || (spectralStart === 0 && spectralEnd !== 0) || (scanComponentCount > 1 && spectralStart !== 0) || high > 13 || low > 13 || (high !== 0 && high !== low + 1)) {
        fail("parse_failure", "JPEG_SCAN_HEADER_INVALID");
      }
    }
    scanCount += 1;

    while (position < reader.size) {
      const value = await reader.byte(position, "JPEG_EOI_MISSING");
      position += 1;
      if (value !== 0xff) continue;
      const markerStartInScan = position - 1;
      while (position < reader.size && await reader.byte(position, "JPEG_EOI_MISSING") === 0xff) {
        position += 1;
      }
      if (position >= reader.size) fail("parse_failure", "JPEG_EOI_MISSING");
      const next = await reader.byte(position, "JPEG_EOI_MISSING");
      position += 1;
      if (next === 0x00) continue;
      if (next >= 0xd0 && next <= 0xd7) {
        countMarker();
        restartMarkerCount += 1;
        continue;
      }
      pendingMarker = { code: next, markerStart: markerStartInScan, afterCode: position };
      break;
    }
    if (pendingMarker === null) fail("parse_failure", "JPEG_EOI_MISSING");
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (0xedb8_8320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32Update(state: number, bytes: Uint8Array): number {
  let result = state;
  for (const byte of bytes) {
    result = (CRC32_TABLE[(result ^ byte) & 0xff] ?? 0) ^ (result >>> 8);
  }
  return result >>> 0;
}

function validPngChunkType(bytes: Buffer): boolean {
  return bytes.length === 4 && [...bytes].every((byte) =>
    (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)
  ) && (bytes[2] ?? 0) >= 0x41 && (bytes[2] ?? 0) <= 0x5a;
}

function pngColorFacts(
  colorTypeCode: number,
): readonly [
  "grayscale" | "truecolor" | "indexed" | "grayscale_alpha" | "truecolor_alpha",
  1 | 2 | 3 | 4,
] {
  switch (colorTypeCode) {
    case 0: return ["grayscale", 1];
    case 2: return ["truecolor", 3];
    case 3: return ["indexed", 1];
    case 4: return ["grayscale_alpha", 2];
    case 6: return ["truecolor_alpha", 4];
    default: fail("parse_failure", "PNG_IHDR_INVALID");
  }
}

async function inspectPng(reader: BoundedHandleReader): Promise<FoundryMediaContainerSourceFacts> {
  if (reader.size < PNG_SIGNATURE.length + 12) fail("parse_failure", "PNG_IHDR_INVALID");
  const signature = await reader.readExact(0, PNG_SIGNATURE.length, "PNG_IHDR_INVALID");
  if (!signature.equals(PNG_SIGNATURE)) fail("unsupported_container", "MEDIA_CONTAINER_UNRECOGNIZED");

  let position = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let ancillaryCount = 0;
  let ancillaryPayloadBytes = 0;
  let idatCount = 0;
  let idatPayloadBytes = 0;
  let seenIdat = false;
  let idatEnded = false;
  let seenIend = false;
  let seenPlte = false;
  let seenTrns = false;
  let paletteEntries: number | null = null;
  let width = 0;
  let height = 0;
  let bitDepth: 1 | 2 | 4 | 8 | 16 = 8;
  let colorTypeCode = -1;
  let interlace: "none" | "adam7" = "none";

  while (position < reader.size) {
    if (position + 12 > reader.size) fail("parse_failure", "PNG_CHUNK_LENGTH_INVALID");
    const header = await reader.readExact(position, 8, "PNG_CHUNK_LENGTH_INVALID");
    const payloadLength = header.readUInt32BE(0);
    const typeBytes = header.subarray(4, 8);
    if (!validPngChunkType(typeBytes)) fail("parse_failure", "PNG_CHUNK_TYPE_INVALID");
    const type = typeBytes.toString("ascii");
    if (payloadLength > 0x7fff_ffff || position + 12 + payloadLength > reader.size) {
      fail("parse_failure", "PNG_CHUNK_LENGTH_INVALID");
    }
    chunkCount += 1;
    if (chunkCount > FOUNDRY_MEDIA_CONTAINER_PNG_CHUNK_MAX_COUNT) {
      fail("resource_limit", "PNG_CHUNK_LIMIT_EXCEEDED");
    }
    const payloadStart = position + 8;
    let crcState = crc32Update(0xffff_ffff, typeBytes);
    await reader.forEachChunk(payloadStart, payloadLength, "PNG_CHUNK_LENGTH_INVALID", (chunk) => {
      crcState = crc32Update(crcState, chunk);
    });
    const expectedCrc = (crcState ^ 0xffff_ffff) >>> 0;
    const storedCrc = (await reader.readExact(payloadStart + payloadLength, 4, "PNG_CHUNK_LENGTH_INVALID")).readUInt32BE(0);
    if (storedCrc !== expectedCrc) fail("parse_failure", "PNG_CHUNK_CRC_MISMATCH");

    const ancillary = (typeBytes[0] ?? 0x41) >= 0x61;
    if (ancillary) {
      ancillaryCount += 1;
      ancillaryPayloadBytes += payloadLength;
      if (ancillaryPayloadBytes > FOUNDRY_MEDIA_CONTAINER_PNG_ANCILLARY_MAX_BYTES) {
        fail("resource_limit", "PNG_ANCILLARY_LIMIT_EXCEEDED");
      }
    }
    if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      fail("unsupported_variant", "PNG_ANIMATION_UNSUPPORTED");
    }
    if (!ancillary && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) {
      fail("unsupported_variant", "PNG_CRITICAL_CHUNK_UNSUPPORTED");
    }

    if (type === "IHDR") {
      if (chunkCount !== 1 || payloadLength !== 13) fail("parse_failure", "PNG_IHDR_INVALID");
      const ihdr = await reader.readExact(payloadStart, 13, "PNG_IHDR_INVALID");
      width = ihdr.readUInt32BE(0);
      height = ihdr.readUInt32BE(4);
      const rawBitDepth = ihdr[8] ?? 0;
      colorTypeCode = ihdr[9] ?? -1;
      const compression = ihdr[10] ?? -1;
      const filter = ihdr[11] ?? -1;
      const rawInterlace = ihdr[12] ?? -1;
      const legalDepths: Readonly<Record<number, readonly number[]>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (!(colorTypeCode in legalDepths) || !(legalDepths[colorTypeCode]?.includes(rawBitDepth) ?? false) || compression !== 0 || filter !== 0 || (rawInterlace !== 0 && rawInterlace !== 1)) {
        fail("parse_failure", "PNG_IHDR_INVALID");
      }
      assertDimensions(width, height);
      bitDepth = rawBitDepth as 1 | 2 | 4 | 8 | 16;
      interlace = rawInterlace === 0 ? "none" : "adam7";
    } else if (chunkCount === 1) {
      fail("parse_failure", "PNG_IHDR_INVALID");
    }

    if (type === "PLTE") {
      if (seenPlte || seenIdat || payloadLength === 0 || payloadLength % 3 !== 0 || payloadLength > 768) {
        fail("parse_failure", "PNG_CHUNK_ORDER_INVALID");
      }
      seenPlte = true;
      paletteEntries = payloadLength / 3;
      if (colorTypeCode === 3 && paletteEntries > 2 ** bitDepth) {
        fail("parse_failure", "PNG_CHUNK_ORDER_INVALID");
      }
      if (colorTypeCode === 0 || colorTypeCode === 4) {
        fail("parse_failure", "PNG_CHUNK_ORDER_INVALID");
      }
    }

    if (type === "tRNS") {
      const indexedLengthValid = colorTypeCode === 3 && seenPlte && paletteEntries !== null &&
        payloadLength >= 1 && payloadLength <= paletteEntries;
      const lengthValid = (colorTypeCode === 0 && payloadLength === 2) ||
        (colorTypeCode === 2 && payloadLength === 6) || indexedLengthValid;
      if (seenTrns || seenIdat || colorTypeCode === 4 || colorTypeCode === 6 || !lengthValid) {
        fail("parse_failure", "PNG_CHUNK_ORDER_INVALID");
      }
      seenTrns = true;
    }

    if (type === "IDAT") {
      if (idatEnded || colorTypeCode < 0) fail("parse_failure", "PNG_CHUNK_ORDER_INVALID");
      seenIdat = true;
      idatCount += 1;
      idatPayloadBytes += payloadLength;
    } else if (seenIdat && type !== "IEND") {
      idatEnded = true;
    }

    const chunkEnd = payloadStart + payloadLength + 4;
    if (type === "IEND") {
      if (payloadLength !== 0 || !seenIdat) fail("parse_failure", "PNG_IEND_INVALID");
      if (chunkEnd !== reader.size) fail("parse_failure", "PNG_TRAILING_BYTES");
      seenIend = true;
      position = chunkEnd;
      break;
    }
    position = chunkEnd;
  }

  if (!seenIend) fail("parse_failure", "PNG_IEND_INVALID");
  if (!seenIdat || idatPayloadBytes <= 0) fail("parse_failure", "PNG_IDAT_MISSING");
  if (colorTypeCode === 3 && !seenPlte) fail("parse_failure", "PNG_CHUNK_ORDER_INVALID");
  const selected = pngColorFacts(colorTypeCode);
  return FoundryMediaContainerSourceFactsSchema.parse({
    format: "png",
    profile: "png_static",
    inspectionCoverage: "complete_chunk_table_and_crc",
    dimensions: dimensions(width, height),
    image: {
      bitDepth,
      colorType: selected[0],
      channelCount: selected[1],
      interlace,
    },
    chunks: {
      count: chunkCount,
      idatCount,
      idatPayloadBytes,
      ancillaryCount,
      ancillaryPayloadBytes,
      paletteEntries,
      transparencyDeclared: seenTrns,
      allCrcsVerified: true,
      animationChunks: 0,
    },
    container: {
      sourceSizeBytes: reader.size,
      exactFileLengthVerified: true,
      trailingBytes: 0,
    },
    limitations: FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITATIONS,
  });
}

interface BmffBox {
  readonly type: string;
  readonly start: number;
  readonly size: number;
  readonly headerSize: number;
  readonly contentStart: number;
  readonly end: number;
  readonly depth: number;
  readonly extendedSize: boolean;
  readonly children: readonly BmffBox[];
}

interface BmffParseContext {
  boxCount: number;
  maxDepth: number;
  extendedSizeCount: number;
}

const BMFF_CONTAINER_TYPES = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
const BMFF_FRAGMENT_TYPES = new Set(["moof", "traf", "mvex", "mfra", "tfhd", "trun"]);
const BMFF_ENCRYPTION_TYPES = new Set(["pssh", "sinf", "schi", "tenc"]);
async function readBmffBoxHeader(
  reader: BoundedHandleReader,
  start: number,
  parentEnd: number,
  depth: number,
  context: BmffParseContext,
): Promise<Omit<BmffBox, "children">> {
  if (depth > FOUNDRY_MEDIA_CONTAINER_BMFF_DEPTH_MAX) fail("resource_limit", "BMFF_DEPTH_LIMIT_EXCEEDED");
  if (start + 8 > parentEnd) fail("parse_failure", "BMFF_BOX_TILING_INVALID");
  const base = await reader.readExact(start, 8, "BMFF_BOX_TILING_INVALID");
  const size32 = base.readUInt32BE(0);
  const type = fourcc(base.subarray(4, 8), "BMFF_BOX_TYPE_INVALID");
  let headerSize = 8;
  let size: number;
  let extendedSize = false;
  if (size32 === 0) fail("unsupported_variant", "BMFF_OPEN_ENDED_BOX_UNSUPPORTED");
  if (size32 === 1) {
    if (start + 16 > parentEnd) fail("parse_failure", "BMFF_BOX_SIZE_INVALID");
    const extended = (await reader.readExact(start + 8, 8, "BMFF_BOX_SIZE_INVALID")).readBigUInt64BE(0);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) fail("resource_limit", "MEDIA_CONTAINER_SOURCE_SIZE_LIMIT_EXCEEDED");
    size = Number(extended);
    headerSize = 16;
    extendedSize = true;
  } else {
    size = size32;
  }
  if (type === "uuid") headerSize += 16;
  if (size < headerSize || start + size > parentEnd) fail("parse_failure", "BMFF_BOX_SIZE_INVALID");
  context.boxCount += 1;
  if (context.boxCount > FOUNDRY_MEDIA_CONTAINER_BMFF_BOX_MAX_COUNT) fail("resource_limit", "BMFF_BOX_LIMIT_EXCEEDED");
  context.maxDepth = Math.max(context.maxDepth, depth);
  if (extendedSize) context.extendedSizeCount += 1;
  if (BMFF_FRAGMENT_TYPES.has(type)) fail("unsupported_variant", "BMFF_FRAGMENTED_UNSUPPORTED");
  if (BMFF_ENCRYPTION_TYPES.has(type)) fail("unsupported_variant", "BMFF_ENCRYPTED_UNSUPPORTED");
  return {
    type,
    start,
    size,
    headerSize,
    contentStart: start + headerSize,
    end: start + size,
    depth,
    extendedSize,
  };
}

async function parseBmffBoxes(
  reader: BoundedHandleReader,
  start: number,
  end: number,
  depth: number,
  context: BmffParseContext,
): Promise<BmffBox[]> {
  const boxes: BmffBox[] = [];
  let position = start;
  while (position < end) {
    const header = await readBmffBoxHeader(reader, position, end, depth, context);
    const children = BMFF_CONTAINER_TYPES.has(header.type)
      ? await parseBmffBoxes(reader, header.contentStart, header.end, depth + 1, context)
      : [];
    boxes.push({ ...header, children });
    position = header.end;
  }
  if (position !== end) fail("parse_failure", "BMFF_BOX_TILING_INVALID");
  return boxes;
}

function childrenOf(box: BmffBox, type: string): BmffBox[] {
  return box.children.filter((child) => child.type === type);
}

function oneChild(box: BmffBox, type: string, code: FailureCode): BmffBox {
  const matches = childrenOf(box, type);
  if (matches.length !== 1) fail("parse_failure", code);
  const selected = matches[0];
  if (selected === undefined) fail("parse_failure", code);
  return selected;
}

async function parseMovieHeader(
  reader: BoundedHandleReader,
  box: BmffBox,
): Promise<{ readonly timescale: number; readonly durationUnits: string }> {
  const contentLength = box.end - box.contentStart;
  if (contentLength < 20) fail("parse_failure", "BMFF_MVHD_INVALID");
  const version = await reader.byte(box.contentStart, "BMFF_MVHD_INVALID");
  if (version !== 0 && version !== 1) fail("parse_failure", "BMFF_MVHD_INVALID");
  const required = version === 0 ? 20 : 32;
  if (contentLength < required) fail("parse_failure", "BMFF_MVHD_INVALID");
  const bytes = await reader.readExact(box.contentStart, required, "BMFF_MVHD_INVALID");
  const timescale = bytes.readUInt32BE(version === 0 ? 12 : 20);
  const duration = version === 0
    ? BigInt(bytes.readUInt32BE(16))
    : bytes.readBigUInt64BE(24);
  if (timescale <= 0) fail("parse_failure", "BMFF_MVHD_INVALID");
  return { timescale, durationUnits: decimal(duration) };
}

async function parseTrackHeader(
  reader: BoundedHandleReader,
  box: BmffBox,
): Promise<{
  readonly trackId: number;
  readonly enabled: boolean;
  readonly width: number;
  readonly height: number;
}> {
  const contentLength = box.end - box.contentStart;
  if (contentLength < 4) fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
  const versionAndFlags = await reader.readExact(box.contentStart, 4, "BMFF_TRACK_STRUCTURE_INVALID");
  const version = versionAndFlags[0] ?? 0xff;
  if (version !== 0 && version !== 1) fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
  const required = version === 0 ? 84 : 96;
  if (contentLength < required) fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
  const bytes = await reader.readExact(box.contentStart, required, "BMFF_TRACK_STRUCTURE_INVALID");
  const trackId = bytes.readUInt32BE(version === 0 ? 12 : 20);
  const widthRaw = bytes.readUInt32BE(version === 0 ? 76 : 88);
  const heightRaw = bytes.readUInt32BE(version === 0 ? 80 : 92);
  const width = widthRaw / 65_536;
  const height = heightRaw / 65_536;
  if (trackId <= 0 || width > FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX || height > FOUNDRY_MEDIA_CONTAINER_DIMENSION_MAX) {
    fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
  }
  const flags = ((versionAndFlags[1] ?? 0) << 16) | ((versionAndFlags[2] ?? 0) << 8) | (versionAndFlags[3] ?? 0);
  return { trackId, enabled: (flags & 1) !== 0, width, height };
}

async function parseMediaHeader(
  reader: BoundedHandleReader,
  box: BmffBox,
): Promise<{ readonly timescale: number; readonly durationUnits: string }> {
  const contentLength = box.end - box.contentStart;
  if (contentLength < 20) fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
  const version = await reader.byte(box.contentStart, "BMFF_TRACK_STRUCTURE_INVALID");
  if (version !== 0 && version !== 1) fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
  const required = version === 0 ? 20 : 32;
  if (contentLength < required) fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
  const bytes = await reader.readExact(box.contentStart, required, "BMFF_TRACK_STRUCTURE_INVALID");
  const timescale = bytes.readUInt32BE(version === 0 ? 12 : 20);
  const duration = version === 0
    ? BigInt(bytes.readUInt32BE(16))
    : bytes.readBigUInt64BE(24);
  if (timescale <= 0) fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
  return { timescale, durationUnits: decimal(duration) };
}

async function parseHandlerType(reader: BoundedHandleReader, box: BmffBox): Promise<string> {
  if (box.end - box.contentStart < 12) fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
  const bytes = await reader.readExact(box.contentStart, 12, "BMFF_TRACK_STRUCTURE_INVALID");
  if (bytes[0] !== 0) fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
  return fourcc(bytes.subarray(8, 12), "BMFF_TRACK_STRUCTURE_INVALID");
}

async function parseVideoSampleDescriptions(
  reader: BoundedHandleReader,
  box: BmffBox,
  context: BmffParseContext,
): Promise<z.infer<typeof BmffSampleDescriptionSchema>[]> {
  if (box.end - box.contentStart < 8) fail("parse_failure", "BMFF_VIDEO_SAMPLE_DESCRIPTION_INVALID");
  const header = await reader.readExact(box.contentStart, 8, "BMFF_VIDEO_SAMPLE_DESCRIPTION_INVALID");
  if (header[0] !== 0 || header[1] !== 0 || header[2] !== 0 || header[3] !== 0) {
    fail("parse_failure", "BMFF_VIDEO_SAMPLE_DESCRIPTION_INVALID");
  }
  const count = header.readUInt32BE(4);
  if (count <= 0) fail("parse_failure", "BMFF_VIDEO_SAMPLE_DESCRIPTION_INVALID");
  if (count > FOUNDRY_MEDIA_CONTAINER_BMFF_SAMPLE_DESCRIPTION_MAX_COUNT) {
    fail("resource_limit", "BMFF_SAMPLE_DESCRIPTION_LIMIT_EXCEEDED");
  }
  const descriptions: z.infer<typeof BmffSampleDescriptionSchema>[] = [];
  let position = box.contentStart + 8;
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const entry = await readBmffBoxHeader(reader, position, box.end, box.depth + 1, context);
    if (entry.type === "encv" || entry.type === "enca") fail("unsupported_variant", "BMFF_ENCRYPTED_UNSUPPORTED");
    if (entry.end - entry.contentStart < 78) fail("parse_failure", "BMFF_VIDEO_SAMPLE_DESCRIPTION_INVALID");
    const visualHeader = await reader.readExact(entry.contentStart, 28, "BMFF_VIDEO_SAMPLE_DESCRIPTION_INVALID");
    const width = visualHeader.readUInt16BE(24);
    const height = visualHeader.readUInt16BE(26);
    assertDimensions(width, height);
    descriptions.push(BmffSampleDescriptionSchema.parse({ ordinal, typeCode: entry.type, width, height }));
    const childStart = entry.contentStart + 78;
    if (childStart < entry.end) {
      await parseBmffBoxes(reader, childStart, entry.end, entry.depth + 1, context);
    }
    position = entry.end;
  }
  if (position !== box.end) fail("parse_failure", "BMFF_VIDEO_SAMPLE_DESCRIPTION_INVALID");
  return descriptions;
}

async function inspectIsoBmff(reader: BoundedHandleReader): Promise<FoundryMediaContainerSourceFacts> {
  const context: BmffParseContext = { boxCount: 0, maxDepth: 0, extendedSizeCount: 0 };
  const topLevel = await parseBmffBoxes(reader, 0, reader.size, 1, context);
  const first = topLevel[0];
  if (first?.type !== "ftyp") fail("parse_failure", "BMFF_FTYP_MISSING");
  const ftypContentBytes = first.end - first.contentStart;
  if (ftypContentBytes < 8 || (ftypContentBytes - 8) % 4 !== 0) fail("parse_failure", "BMFF_FTYP_INVALID");
  const brandCount = 1 + (ftypContentBytes - 8) / 4;
  if (brandCount > FOUNDRY_MEDIA_CONTAINER_BMFF_BRAND_MAX_COUNT) {
    fail("resource_limit", "BMFF_BRAND_LIMIT_EXCEEDED");
  }
  const ftyp = await reader.readExact(first.contentStart, ftypContentBytes, "BMFF_FTYP_INVALID");
  const majorBrand = fourcc(ftyp.subarray(0, 4), "BMFF_FTYP_INVALID");
  const minorVersion = ftyp.readUInt32BE(4);
  const compatibleBrands: string[] = [];
  for (let offset = 8; offset < ftyp.length; offset += 4) {
    compatibleBrands.push(fourcc(ftyp.subarray(offset, offset + 4), "BMFF_FTYP_INVALID"));
  }
  if ([majorBrand, ...compatibleBrands].some((brand) => BMFF_HEIF_AVIF_BRANDS.has(brand))) {
    fail("unsupported_variant", "BMFF_HEIF_AVIF_UNSUPPORTED");
  }

  const moovBoxes = topLevel.filter((box) => box.type === "moov");
  if (moovBoxes.length === 0) fail("parse_failure", "BMFF_MOOV_MISSING");
  if (moovBoxes.length !== 1) fail("parse_failure", "BMFF_MULTIPLE_MOOV");
  const moov = moovBoxes[0];
  if (moov === undefined) fail("parse_failure", "BMFF_MOOV_MISSING");
  const movie = await parseMovieHeader(reader, oneChild(moov, "mvhd", "BMFF_MVHD_INVALID"));
  const mdats = topLevel.filter((box) => box.type === "mdat");
  if (mdats.length === 0) fail("parse_failure", "BMFF_MDAT_MISSING");
  const mdatPayloadBytes = mdats.reduce((total, box) => total + (box.end - box.contentStart), 0);

  const trackBoxes = childrenOf(moov, "trak");
  if (trackBoxes.length === 0) fail("parse_failure", "BMFF_VIDEO_TRACK_MISSING");
  if (trackBoxes.length > FOUNDRY_MEDIA_CONTAINER_BMFF_TRACK_MAX_COUNT) {
    fail("resource_limit", "BMFF_TRACK_LIMIT_EXCEEDED");
  }
  const trackIds = new Set<number>();
  const video: z.infer<typeof BmffVideoTrackSchema>[] = [];
  for (const [ordinal, trackBox] of trackBoxes.entries()) {
    const trackHeader = await parseTrackHeader(reader, oneChild(trackBox, "tkhd", "BMFF_TRACK_STRUCTURE_INVALID"));
    if (trackIds.has(trackHeader.trackId)) fail("parse_failure", "BMFF_TRACK_STRUCTURE_INVALID");
    trackIds.add(trackHeader.trackId);
    const mediaBox = oneChild(trackBox, "mdia", "BMFF_TRACK_STRUCTURE_INVALID");
    const handlerType = await parseHandlerType(reader, oneChild(mediaBox, "hdlr", "BMFF_TRACK_STRUCTURE_INVALID"));
    if (handlerType !== "vide") continue;
    const mediaHeader = await parseMediaHeader(reader, oneChild(mediaBox, "mdhd", "BMFF_TRACK_STRUCTURE_INVALID"));
    const minf = oneChild(mediaBox, "minf", "BMFF_TRACK_STRUCTURE_INVALID");
    const stbl = oneChild(minf, "stbl", "BMFF_TRACK_STRUCTURE_INVALID");
    const sampleDescriptions = await parseVideoSampleDescriptions(
      reader,
      oneChild(stbl, "stsd", "BMFF_VIDEO_SAMPLE_DESCRIPTION_INVALID"),
      context,
    );
    video.push(BmffVideoTrackSchema.parse({
      ordinal,
      trackId: trackHeader.trackId,
      enabled: trackHeader.enabled,
      trackWidthPixels: trackHeader.width,
      trackHeightPixels: trackHeader.height,
      mediaTimescale: mediaHeader.timescale,
      mediaDurationUnits: mediaHeader.durationUnits,
      sampleDescriptions,
    }));
  }
  if (video.length === 0) fail("parse_failure", "BMFF_VIDEO_TRACK_MISSING");

  return FoundryMediaContainerSourceFactsSchema.parse({
    format: "iso_bmff",
    profile: "iso_bmff_movie_video_track_declarations",
    inspectionCoverage: "complete_top_level_tiling_and_selected_movie_video_structure",
    fileType: { majorBrand, minorVersion, compatibleBrands },
    movie,
    boxes: {
      count: context.boxCount,
      maxDepth: context.maxDepth,
      topLevelCount: topLevel.length,
      extendedSizeCount: context.extendedSizeCount,
      mdatCount: mdats.length,
      mdatPayloadBytes,
    },
    tracks: {
      count: trackBoxes.length,
      videoCount: video.length,
      video,
    },
    container: {
      sourceSizeBytes: reader.size,
      exactFileLengthVerified: true,
      trailingBytes: 0,
    },
    limitations: FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_LIMITATIONS,
  });
}

/**
 * Inspects one already-open, identity-bound JPEG, PNG, or ISO-BMFF handle.
 * The path is never accepted or reopened. The inspector validates bounded
 * container structure only; it does not decode pixels, samples, or audio.
 */
export async function inspectMediaContainerSourceFacts(
  handle: FileHandle,
  fileSize: number,
  sourceSha256: string,
  signal?: AbortSignal,
): Promise<FoundryMediaContainerSourceFactsOutcome> {
  const binding: FoundryMediaContainerSourceFactsSourceBinding = {
    sourceSha256,
    sourceSizeBytes: fileSize,
  };
  try {
    assertNotCancelled(signal);
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
      fail("resource_limit", "MEDIA_CONTAINER_SOURCE_SIZE_INVALID");
    }
    if (fileSize > FOUNDRY_MEDIA_CONTAINER_SOURCE_MAX_BYTES) {
      fail("resource_limit", "MEDIA_CONTAINER_SOURCE_SIZE_LIMIT_EXCEEDED");
    }
    const before = await statHandle(handle, signal);
    if (!before.isFile()) fail("parse_failure", "MEDIA_CONTAINER_SOURCE_NOT_REGULAR");
    if (before.size !== fileSize) fail("parse_failure", "MEDIA_CONTAINER_SOURCE_SIZE_MISMATCH");

    const reader = new BoundedHandleReader(handle, fileSize, signal);
    const format = await detectedFormat(reader);
    let facts: FoundryMediaContainerSourceFacts;
    if (format === "jpeg") facts = await inspectJpeg(reader);
    else if (format === "png") facts = await inspectPng(reader);
    else if (format === "iso_bmff") facts = await inspectIsoBmff(reader);
    else fail("unsupported_container", "MEDIA_CONTAINER_UNRECOGNIZED");

    assertNotCancelled(signal);
    const after = await statHandle(handle, signal);
    if (!sameFileIdentity(before, after) || after.size !== fileSize) {
      fail("parse_failure", "MEDIA_CONTAINER_SOURCE_CHANGED");
    }
    return {
      ...binding,
      state: "established",
      facts: FoundryMediaContainerSourceFactsSchema.parse(facts),
    };
  } catch (error: unknown) {
    if (error instanceof MediaContainerInspectionFailure) {
      return { ...binding, state: "facts_not_established", category: error.category, code: error.code };
    }
    return {
      ...binding,
      state: "facts_not_established",
      category: "parse_failure",
      code: "MEDIA_CONTAINER_INSPECTION_FAILED",
    };
  }
}

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "@omnitwin/types";
import sharp from "sharp";

import { deriveGrandHallT554NativeMaskSpatialFactsV2 } from "./grand-hall-t554-native-mask-spatial-digest-v2.js";

export const GRAND_HALL_T554_MASK_PNG_MAX_BYTES = 64 * 1024 * 1024;
export const GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTES = 256 * 1024 * 1024;

const PANORAMA_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_ALLOWED_CHUNKS = new Set(["IHDR", "IDAT", "IEND"]);

interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: number;
  readonly compressionMethod: number;
  readonly filterMethod: number;
  readonly interlaceMethod: number;
}

export interface GrandHallT554MaskPixelCounts {
  readonly includedPixelCount: number;
  readonly excludedPixelCount: number;
}

export type GrandHallT554MaskReasonSampleCounts = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface GrandHallT554MaskReasonMapCounts {
  /** Index zero is the included-pixel sample; indexes 1..5 are the fixed reason samples. */
  readonly reasonSampleCounts: GrandHallT554MaskReasonSampleCounts;
}

export interface GrandHallT554MaskEvidencePixelCounts extends
  GrandHallT554MaskPixelCounts,
  GrandHallT554MaskReasonMapCounts {
  /** Exact v2 spatial commitment; comparable with mask-store exactStateV2(). */
  readonly pixelTileInventorySha256: `sha256:${string}`;
}

interface GrandHallT554MaskValidationTestSeam {
  readonly afterDecodedBuffersDestroyed?: (facts: {
    readonly maskPixelsWereZeroed: boolean;
    readonly reasonPixelsWereZeroed: boolean;
  }) => void;
}

function reasonSampleCountTuple(
  counts: readonly number[],
): GrandHallT554MaskReasonSampleCounts {
  return Object.freeze([
    counts[0] ?? 0,
    counts[1] ?? 0,
    counts[2] ?? 0,
    counts[3] ?? 0,
    counts[4] ?? 0,
    counts[5] ?? 0,
  ]);
}

export interface GrandHallT554SourceJpegDecoderIdentity {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1";
  readonly library: "sharp";
  readonly sharpVersion: string;
  readonly libvipsVersion: string;
  readonly pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1";
}

export interface GrandHallT554DecodedSourceJpeg {
  readonly widthPx: typeof GRAND_HALL_PANORAMA_WIDTH_PX;
  readonly heightPx: typeof GRAND_HALL_PANORAMA_HEIGHT_PX;
  readonly channelCount: 3;
  readonly bitsPerSample: 8;
  readonly alphaPresent: false;
  readonly orientationMetadataPresent: false;
  readonly decoderIdentity: GrandHallT554SourceJpegDecoderIdentity;
  /** Owned mutable storage. The native media kernel must destroy it after use. */
  readonly pixels: Buffer;
}

/** Fully decodes one exact 8,192 × 4,096 unrotated RGB source JPEG. */
export async function decodeGrandHallT554SourceJpegBytes(
  bytes: Buffer,
): Promise<GrandHallT554DecodedSourceJpeg> {
  const decoderOptions = {
    failOn: "error",
    limitInputPixels: PANORAMA_PIXEL_COUNT,
  } as const;
  const metadata = await sharp(bytes, decoderOptions).metadata();
  if (
    metadata.format !== "jpeg" ||
    metadata.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
    metadata.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
    metadata.space !== "srgb" ||
    metadata.channels !== 3 ||
    metadata.depth !== "uchar" ||
    metadata.hasAlpha ||
    metadata.orientation !== undefined ||
    metadata.exif !== undefined
  ) {
    throw new Error("JPEG metadata does not match the exact source panorama grid");
  }
  const decoded = await sharp(bytes, decoderOptions).raw().toBuffer({
    resolveWithObject: true,
  });
  if (
    decoded.info.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
    decoded.info.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
    decoded.info.channels !== 3 ||
    decoded.data.length !== PANORAMA_PIXEL_COUNT * 3
  ) {
    decoded.data.fill(0);
    throw new Error("JPEG full decode does not match the exact RGB source panorama grid");
  }
  return {
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    channelCount: 3,
    bitsPerSample: 8,
    alphaPresent: false,
    orientationMetadataPresent: false,
    decoderIdentity: {
      schemaVersion:
        "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1",
      library: "sharp",
      sharpVersion: sharp.versions.sharp,
      libvipsVersion: sharp.versions.vips,
      pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1",
    },
    pixels: decoded.data,
  };
}

/** Validates a source JPEG without retaining its decoded pixel buffer. */
export async function validateGrandHallT554SourceJpegBytes(bytes: Buffer): Promise<void> {
  const decoded = await decodeGrandHallT554SourceJpegBytes(bytes);
  try {
    // A successful full decode is the validation result.
  } finally {
    decoded.pixels.fill(0);
  }
}

function assertExactPngHeader(header: PngHeader): void {
  if (
    header.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
    header.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
    header.bitDepth !== 8 ||
    header.colourType !== 0 ||
    header.compressionMethod !== 0 ||
    header.filterMethod !== 0 ||
    (header.interlaceMethod !== 0 && header.interlaceMethod !== 1)
  ) {
    throw new Error("PNG IHDR is not the exact grayscale8 source-grid contract");
  }
}

function inspectStrictGrayscalePng(bytes: Buffer): PngHeader {
  if (bytes.length < PNG_SIGNATURE.length + 25 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("invalid PNG signature or truncated stream");
  }
  let offset = 8;
  let header: PngHeader | null = null;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("truncated PNG chunk header");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.length) throw new Error("truncated PNG chunk");
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new Error("invalid PNG chunk type");
    if (!PNG_ALLOWED_CHUNKS.has(type)) {
      throw new Error(`mask PNG contains non-pixel chunk ${type}`);
    }
    if (type === "IHDR") {
      if (header !== null || offset !== 8 || length !== 13) throw new Error("invalid PNG IHDR");
      header = {
        width: bytes.readUInt32BE(dataStart),
        height: bytes.readUInt32BE(dataStart + 4),
        bitDepth: bytes[dataStart + 8] ?? -1,
        colourType: bytes[dataStart + 9] ?? -1,
        compressionMethod: bytes[dataStart + 10] ?? -1,
        filterMethod: bytes[dataStart + 11] ?? -1,
        interlaceMethod: bytes[dataStart + 12] ?? -1,
      };
    } else if (type === "IDAT") {
      if (header === null || sawEnd) throw new Error("PNG IDAT is out of order");
      sawImageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || header === null || !sawImageData || sawEnd) {
        throw new Error("invalid PNG IEND");
      }
      sawEnd = true;
      if (chunkEnd !== bytes.length) throw new Error("PNG has trailing bytes after IEND");
    }
    offset = chunkEnd;
  }
  if (header === null || !sawImageData || !sawEnd || offset !== bytes.length) {
    throw new Error("PNG stream is incomplete");
  }
  assertExactPngHeader(header);
  return header;
}

async function decodeStrictGrayscalePng(bytes: Buffer): Promise<Buffer> {
  inspectStrictGrayscalePng(bytes);
  const decoderOptions = {
    failOn: "error" as const,
    limitInputPixels: PANORAMA_PIXEL_COUNT,
  };
  const metadata = await sharp(bytes, decoderOptions).metadata();
  if (
    metadata.format !== "png" ||
    metadata.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
    metadata.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
    metadata.space !== "b-w" ||
    metadata.channels !== 1 ||
    metadata.depth !== "uchar" ||
    metadata.hasAlpha ||
    metadata.hasProfile ||
    metadata.isPalette ||
    metadata.bitsPerSample !== 8 ||
    metadata.orientation !== undefined ||
    metadata.exif !== undefined ||
    metadata.icc !== undefined ||
    metadata.iptc !== undefined ||
    metadata.xmp !== undefined ||
    (metadata.comments !== undefined && metadata.comments.length > 0)
  ) {
    throw new Error("PNG metadata does not match grayscale8 no-metadata policy");
  }
  const decoded = await sharp(bytes, decoderOptions)
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    decoded.info.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
    decoded.info.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
    decoded.info.channels !== 1 ||
    decoded.data.length !== PANORAMA_PIXEL_COUNT
  ) {
    decoded.data.fill(0);
    throw new Error("decoded PNG grid or channel count drifted");
  }
  return decoded.data;
}

/** Fully decodes an exact grayscale8 mask and counts only permitted 0/255 samples. */
export async function validateGrandHallT554MaskPngBytes(
  bytes: Buffer,
): Promise<GrandHallT554MaskPixelCounts> {
  const pixels = await decodeStrictGrayscalePng(bytes);
  let includedPixelCount = 0;
  let excludedPixelCount = 0;
  try {
    for (const value of pixels) {
      if (value === 0) includedPixelCount += 1;
      else if (value === 255) excludedPixelCount += 1;
      else throw new Error(`mask contains forbidden sample value ${String(value)}`);
    }
    return { includedPixelCount, excludedPixelCount };
  } finally {
    pixels.fill(0);
  }
}

/** Fully decodes the canonical reason plane: 0 included, 1..5 fixed exclusion reasons. */
export async function validateGrandHallT554MaskReasonMapPngBytes(
  bytes: Buffer,
): Promise<GrandHallT554MaskReasonMapCounts> {
  const pixels = await decodeStrictGrayscalePng(bytes);
  const counts = [0, 0, 0, 0, 0, 0];
  try {
    for (const value of pixels) {
      if (value > 5) {
        throw new Error(`mask reason map contains forbidden sample value ${String(value)}`);
      }
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return {
      reasonSampleCounts: reasonSampleCountTuple(counts),
    };
  } finally {
    pixels.fill(0);
  }
}

async function validateMaskEvidencePngBytes(
  maskBytes: Buffer,
  reasonMapBytes: Buffer,
  seam: GrandHallT554MaskValidationTestSeam,
): Promise<GrandHallT554MaskEvidencePixelCounts> {
  let maskPixels: Buffer | undefined;
  let reasonPixels: Buffer | undefined;
  try {
    maskPixels = await decodeStrictGrayscalePng(maskBytes);
    reasonPixels = await decodeStrictGrayscalePng(reasonMapBytes);
    return deriveGrandHallT554NativeMaskSpatialFactsV2(maskPixels, reasonPixels);
  } finally {
    maskPixels?.fill(0);
    reasonPixels?.fill(0);
    seam.afterDecodedBuffersDestroyed?.({
      maskPixelsWereZeroed: maskPixels?.every((value) => value === 0) ?? true,
      reasonPixelsWereZeroed: reasonPixels?.every((value) => value === 0) ?? true,
    });
  }
}

/** Reopens both immutable evidence planes and derives all mask facts from their exact bytes. */
export function validateGrandHallT554MaskEvidencePngBytes(
  maskBytes: Buffer,
  reasonMapBytes: Buffer,
): Promise<GrandHallT554MaskEvidencePixelCounts> {
  return validateMaskEvidencePngBytes(maskBytes, reasonMapBytes, {});
}

export const __testOnlyGrandHallT554MediaValidation = /* @__PURE__ */ Object.freeze({
  validateMaskEvidencePngBytes,
});

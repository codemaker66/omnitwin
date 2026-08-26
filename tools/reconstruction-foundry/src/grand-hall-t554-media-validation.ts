import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "@omnitwin/types";
import sharp from "sharp";

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

/** Fully decodes one exact 8,192 × 4,096 unrotated RGB source JPEG. */
export async function validateGrandHallT554SourceJpegBytes(bytes: Buffer): Promise<void> {
  const decoderOptions = {
    failOn: "error",
    limitInputPixels: PANORAMA_PIXEL_COUNT,
  } as const;
  const metadata = await sharp(bytes, decoderOptions).metadata();
  if (
    metadata.format !== "jpeg" ||
    metadata.width !== GRAND_HALL_PANORAMA_WIDTH_PX ||
    metadata.height !== GRAND_HALL_PANORAMA_HEIGHT_PX ||
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
    throw new Error("JPEG full decode does not match the exact RGB source panorama grid");
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

/** Fully decodes an exact grayscale8 mask and counts only permitted 0/255 samples. */
export async function validateGrandHallT554MaskPngBytes(
  bytes: Buffer,
): Promise<GrandHallT554MaskPixelCounts> {
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
    throw new Error("decoded PNG grid or channel count drifted");
  }
  let includedPixelCount = 0;
  let excludedPixelCount = 0;
  for (const value of decoded.data) {
    if (value === 0) includedPixelCount += 1;
    else if (value === 255) excludedPixelCount += 1;
    else throw new Error(`mask contains forbidden sample value ${String(value)}`);
  }
  return { includedPixelCount, excludedPixelCount };
}

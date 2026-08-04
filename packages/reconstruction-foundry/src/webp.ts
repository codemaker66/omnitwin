import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_WEBP_MAX_BYTES = 32 * 1024 * 1024;
const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

export interface WebpDimensions {
  readonly width: number;
  readonly height: number;
  readonly encoding: "VP8" | "VP8L" | "VP8X";
}

function ascii(bytes: Buffer, start: number, end: number): string {
  return bytes.subarray(start, end).toString("ascii");
}

function uint24Le(bytes: Buffer, offset: number): number {
  return bytes.readUInt8(offset) | (bytes.readUInt8(offset + 1) << 8) | (bytes.readUInt8(offset + 2) << 16);
}

function vp8Dimensions(bytes: Buffer, dataOffset: number, dataLength: number): WebpDimensions {
  if (
    dataLength < 10 ||
    bytes[dataOffset + 3] !== 0x9d ||
    bytes[dataOffset + 4] !== 0x01 ||
    bytes[dataOffset + 5] !== 0x2a
  ) {
    throw new FoundryIntegrityError("INVALID_WEBP_IMAGE_DATA", "Lossy WebP frame header is missing or invalid.");
  }
  return {
    width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
    height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
    encoding: "VP8",
  };
}

function vp8lDimensions(bytes: Buffer, dataOffset: number, dataLength: number): WebpDimensions {
  if (dataLength < 5 || bytes[dataOffset] !== 0x2f) {
    throw new FoundryIntegrityError("INVALID_WEBP_IMAGE_DATA", "Lossless WebP signature byte is missing or invalid.");
  }
  const b0 = bytes.readUInt8(dataOffset + 1);
  const b1 = bytes.readUInt8(dataOffset + 2);
  const b2 = bytes.readUInt8(dataOffset + 3);
  const b3 = bytes.readUInt8(dataOffset + 4);
  return {
    width: 1 + b0 + ((b1 & 0x3f) << 8),
    height: 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
    encoding: "VP8L",
  };
}

/** Parses the complete RIFF chunk table and requires actual image data. */
export function parseWebpDimensions(bytes: Buffer, actualSizeBytes: number): WebpDimensions {
  if (
    actualSizeBytes <= RIFF_HEADER_BYTES ||
    actualSizeBytes > FOUNDRY_WEBP_MAX_BYTES ||
    bytes.length !== actualSizeBytes ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 12) !== "WEBP"
  ) {
    throw new FoundryIntegrityError("INVALID_WEBP_HEADER", "WebP file has an invalid or incomplete RIFF/WEBP container.");
  }
  const declaredSize = bytes.readUInt32LE(4) + 8;
  if (declaredSize !== actualSizeBytes) {
    throw new FoundryIntegrityError(
      "WEBP_SIZE_MISMATCH",
      `WebP RIFF size ${String(declaredSize)} does not match file size ${String(actualSizeBytes)}.`,
    );
  }

  let offset = RIFF_HEADER_BYTES;
  let extendedDimensions: WebpDimensions | null = null;
  let imageDimensions: WebpDimensions | null = null;
  while (offset < bytes.length) {
    if (bytes.length - offset < CHUNK_HEADER_BYTES) {
      throw new FoundryIntegrityError("INVALID_WEBP_CHUNK", "WebP has a truncated RIFF chunk header.");
    }
    const type = ascii(bytes, offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + CHUNK_HEADER_BYTES;
    const dataEnd = dataOffset + chunkLength;
    const paddedEnd = dataEnd + (chunkLength % 2);
    if (dataEnd > bytes.length || paddedEnd > bytes.length) {
      throw new FoundryIntegrityError("INVALID_WEBP_CHUNK", `WebP ${type} chunk exceeds the RIFF boundary.`);
    }
    if (chunkLength % 2 === 1 && bytes[dataEnd] !== 0) {
      throw new FoundryIntegrityError("INVALID_WEBP_CHUNK", `WebP ${type} chunk has non-zero RIFF padding.`);
    }
    if (type === "ANIM" || type === "ANMF") {
      throw new FoundryIntegrityError("UNSUPPORTED_WEBP_ANIMATION", "Twin panorama WebP files cannot be animated.");
    }
    if (type === "VP8X") {
      if (extendedDimensions !== null || chunkLength !== 10) {
        throw new FoundryIntegrityError("INVALID_WEBP_HEADER", "WebP must contain at most one valid VP8X feature chunk.");
      }
      extendedDimensions = {
        width: uint24Le(bytes, dataOffset + 4) + 1,
        height: uint24Le(bytes, dataOffset + 7) + 1,
        encoding: "VP8X",
      };
    } else if (type === "VP8 " || type === "VP8L") {
      if (imageDimensions !== null) {
        throw new FoundryIntegrityError("INVALID_WEBP_IMAGE_DATA", "WebP must contain exactly one primary image-data chunk.");
      }
      imageDimensions = type === "VP8 "
        ? vp8Dimensions(bytes, dataOffset, chunkLength)
        : vp8lDimensions(bytes, dataOffset, chunkLength);
    }
    offset = paddedEnd;
  }
  if (offset !== bytes.length || imageDimensions === null) {
    throw new FoundryIntegrityError("INVALID_WEBP_IMAGE_DATA", "WebP contains no complete VP8 or VP8L image-data chunk.");
  }
  if (
    extendedDimensions !== null &&
    (extendedDimensions.width !== imageDimensions.width || extendedDimensions.height !== imageDimensions.height)
  ) {
    throw new FoundryIntegrityError("WEBP_DIMENSION_MISMATCH", "WebP VP8X canvas and image bitstream dimensions disagree.");
  }
  return extendedDimensions ?? imageDimensions;
}

export async function inspectWebpBytes(bytes: Buffer, sizeBytes: number): Promise<WebpDimensions> {
  const dimensions = parseWebpDimensions(bytes, sizeBytes);
  try {
    const image = sharp(bytes, {
      failOn: "error",
      limitInputPixels: 70_000_000,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== "webp" ||
      metadata.width !== dimensions.width ||
      metadata.height !== dimensions.height ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new Error("decoded metadata does not match the RIFF image contract");
    }
    // stats() forces libvips to decode the complete pixel stream, so a valid
    // header with truncated/corrupt image bytes cannot pass machine QA.
    await image.stats();
  } catch (error: unknown) {
    throw new FoundryIntegrityError("WEBP_DECODE_FAILED", "WebP image bytes could not be fully decoded.", { cause: error });
  }
  return dimensions;
}

export async function inspectWebp(path: string, sizeBytes: number): Promise<WebpDimensions> {
  if (sizeBytes <= 0 || sizeBytes > FOUNDRY_WEBP_MAX_BYTES) {
    throw new FoundryIntegrityError(
      "WEBP_SIZE_OUT_OF_BOUNDS",
      `WebP must be no larger than ${String(FOUNDRY_WEBP_MAX_BYTES)} bytes.`,
    );
  }
  return inspectWebpBytes(await readFile(path), sizeBytes);
}

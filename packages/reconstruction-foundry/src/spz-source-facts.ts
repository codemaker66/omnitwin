import type { FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import * as nodeZlib from "node:zlib";

export const FOUNDRY_SPZ_SOURCE_MAX_BYTES = 64 * 1024 * 1024 * 1024;
export const FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES = 64 * 1024 * 1024 * 1024;
export const FOUNDRY_SPZ_EXTENSION_MAX_BYTES = 16 * 1024 * 1024;
export const FOUNDRY_SPZ_EXTENSION_MAX_RECORDS = 256;
export const FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES = 1024 * 1024;
export const FOUNDRY_SPZ_LEGACY_HEADER_BYTES = 16;
export const FOUNDRY_SPZ_V4_HEADER_BYTES = 32;
export const FOUNDRY_SPZ_V4_MAX_COMPRESSION_RATIO = 1024;

export const FOUNDRY_SPZ_SOURCE_FACTS_LIMITATIONS = Object.freeze([
  "GAUSSIAN_ATTRIBUTE_VALUES_ARE_NOT_DECODED",
  "STRUCTURAL_AND_COMPRESSION_FACTS_DO_NOT_ESTABLISH_PHYSICAL_BOUNDS_UNITS_FRAME_OR_RENDERER_COMPATIBILITY",
  "FORMAT_FACTS_DO_NOT_ESTABLISH_VISUAL_FIDELITY_PROVENANCE_ACCURACY_REGISTRATION_OR_RIGHTS",
] as const);

export const FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CODES = Object.freeze([
  "SPZ_INSPECTION_CANCELLED",
  "SPZ_SOURCE_SIZE_INVALID",
  "SPZ_SOURCE_SIZE_LIMIT_EXCEEDED",
  "SPZ_SOURCE_NOT_REGULAR",
  "SPZ_SOURCE_SIZE_MISMATCH",
  "SPZ_SOURCE_CHANGED",
  "SPZ_HANDLE_READ_FAILED",
  "SPZ_CONTAINER_UNRECOGNIZED",
  "SPZ_GZIP_HEADER_INVALID",
  "SPZ_GZIP_HEADER_SIZE_LIMIT_EXCEEDED",
  "SPZ_GZIP_STREAM_INVALID",
  "SPZ_GZIP_TRAILER_INVALID",
  "SPZ_GZIP_TRAILING_DATA_UNSUPPORTED",
  "SPZ_LEGACY_HEADER_TRUNCATED",
  "SPZ_LEGACY_MAGIC_INVALID",
  "SPZ_ENVELOPE_VERSION_MISMATCH",
  "SPZ_VERSION_UNSUPPORTED",
  "SPZ_GAUSSIAN_COUNT_INVALID",
  "SPZ_SH_DEGREE_UNSUPPORTED",
  "SPZ_FLAGS_UNSUPPORTED",
  "SPZ_RESERVED_HEADER_UNSUPPORTED",
  "SPZ_DECOMPRESSED_SIZE_LIMIT_EXCEEDED",
  "SPZ_PAYLOAD_LENGTH_MISMATCH",
  "SPZ_V4_POINT_COUNT_PLAUSIBILITY_LIMIT_EXCEEDED",
  "SPZ_V4_TOC_OFFSET_INVALID",
  "SPZ_V4_STREAM_COUNT_INVALID",
  "SPZ_V4_TOC_INVALID",
  "SPZ_V4_STREAM_SIZE_MISMATCH",
  "SPZ_V4_STREAM_RANGE_INVALID",
  "SPZ_V4_ZSTD_FRAME_INVALID",
  "SPZ_V4_ZSTD_RUNTIME_UNAVAILABLE",
  "SPZ_EXTENSION_SIZE_LIMIT_EXCEEDED",
  "SPZ_EXTENSION_RECORD_LIMIT_EXCEEDED",
  "SPZ_EXTENSION_RECORD_INVALID",
  "SPZ_EXTENSION_DECLARATION_MISMATCH",
  "SPZ_INSPECTION_FAILED",
] as const);

export type FoundrySpzSourceFactsFailureCode =
  (typeof FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CODES)[number];
export type FoundrySpzSourceFactsFailureCategory =
  | "parse_failure"
  | "resource_limit"
  | "unsupported_variant"
  | "unsupported_container"
  | "cancelled";

export const FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE = Object.freeze({
  SPZ_INSPECTION_CANCELLED: "cancelled",
  SPZ_SOURCE_SIZE_INVALID: "resource_limit",
  SPZ_SOURCE_SIZE_LIMIT_EXCEEDED: "resource_limit",
  SPZ_SOURCE_NOT_REGULAR: "parse_failure",
  SPZ_SOURCE_SIZE_MISMATCH: "parse_failure",
  SPZ_SOURCE_CHANGED: "parse_failure",
  SPZ_HANDLE_READ_FAILED: "parse_failure",
  SPZ_CONTAINER_UNRECOGNIZED: "unsupported_container",
  SPZ_GZIP_HEADER_INVALID: "parse_failure",
  SPZ_GZIP_HEADER_SIZE_LIMIT_EXCEEDED: "resource_limit",
  SPZ_GZIP_STREAM_INVALID: "parse_failure",
  SPZ_GZIP_TRAILER_INVALID: "parse_failure",
  SPZ_GZIP_TRAILING_DATA_UNSUPPORTED: "unsupported_variant",
  SPZ_LEGACY_HEADER_TRUNCATED: "parse_failure",
  SPZ_LEGACY_MAGIC_INVALID: "parse_failure",
  SPZ_ENVELOPE_VERSION_MISMATCH: "unsupported_variant",
  SPZ_VERSION_UNSUPPORTED: "unsupported_variant",
  SPZ_GAUSSIAN_COUNT_INVALID: "parse_failure",
  SPZ_SH_DEGREE_UNSUPPORTED: "unsupported_variant",
  SPZ_FLAGS_UNSUPPORTED: "unsupported_variant",
  SPZ_RESERVED_HEADER_UNSUPPORTED: "unsupported_variant",
  SPZ_DECOMPRESSED_SIZE_LIMIT_EXCEEDED: "resource_limit",
  SPZ_PAYLOAD_LENGTH_MISMATCH: "parse_failure",
  SPZ_V4_POINT_COUNT_PLAUSIBILITY_LIMIT_EXCEEDED: "resource_limit",
  SPZ_V4_TOC_OFFSET_INVALID: "parse_failure",
  SPZ_V4_STREAM_COUNT_INVALID: "parse_failure",
  SPZ_V4_TOC_INVALID: "parse_failure",
  SPZ_V4_STREAM_SIZE_MISMATCH: "parse_failure",
  SPZ_V4_STREAM_RANGE_INVALID: "parse_failure",
  SPZ_V4_ZSTD_FRAME_INVALID: "parse_failure",
  SPZ_V4_ZSTD_RUNTIME_UNAVAILABLE: "unsupported_variant",
  SPZ_EXTENSION_SIZE_LIMIT_EXCEEDED: "resource_limit",
  SPZ_EXTENSION_RECORD_LIMIT_EXCEEDED: "resource_limit",
  SPZ_EXTENSION_RECORD_INVALID: "parse_failure",
  SPZ_EXTENSION_DECLARATION_MISMATCH: "parse_failure",
  SPZ_INSPECTION_FAILED: "parse_failure",
} as const satisfies Readonly<
  Record<FoundrySpzSourceFactsFailureCode, FoundrySpzSourceFactsFailureCategory>
>);

export type FoundrySpzExtensionRecognizedType =
  | "adobe_safe_orbit_camera"
  | "adobe_coordinate_system"
  | "unknown";

export interface FoundrySpzExtensionRecordFacts {
  readonly typeCodeHex: string;
  readonly payloadBytes: number;
  readonly recognizedType: FoundrySpzExtensionRecognizedType;
}

export type FoundrySpzStreamRole =
  | "positions"
  | "alphas"
  | "colors_dc"
  | "scales"
  | "rotations"
  | "spherical_harmonics_non_dc";

export interface FoundrySpzV4StreamFacts {
  readonly role: FoundrySpzStreamRole;
  readonly compressedSizeBytes: number;
  readonly uncompressedSizeBytes: number;
  readonly zstdFrameMagicVerified: true;
  readonly completeZstdDecompressionVerified: true;
}

export interface FoundrySpzSourceFacts {
  readonly format: "spz_legacy_gzip" | "spz_v4_zstd";
  readonly inspectionCoverage:
    | "single_gzip_member_header_declared_layout_and_complete_stream"
    | "plaintext_header_extensions_toc_and_complete_zstd_streams";
  readonly version: 1 | 2 | 3 | 4;
  readonly count: number;
  readonly fractionalBitsRaw: number;
  readonly antialiased: boolean;
  readonly sphericalHarmonics: {
    readonly degree: 0 | 1 | 2 | 3 | 4;
    readonly nonDcCoefficientCount: 0 | 3 | 8 | 15 | 24;
    readonly bytesPerGaussian: 0 | 9 | 24 | 45 | 72;
  };
  readonly attributeLayout: {
    readonly positionEncoding: "float16_xyz" | "signed_fixed_point_24_xyz";
    readonly positionBytesPerGaussian: 6 | 9;
    readonly alphaBytesPerGaussian: 1;
    readonly colorDcBytesPerGaussian: 3;
    readonly scaleBytesPerGaussian: 3;
    readonly rotationEncoding: "first_three_quaternion_uint8" | "smallest_three_quaternion_uint32";
    readonly rotationBytesPerGaussian: 3 | 4;
    readonly sphericalHarmonicsBytesPerGaussian: 0 | 9 | 24 | 45 | 72;
    readonly totalBytesPerGaussian: number;
  };
  readonly extensions: {
    readonly declared: boolean;
    readonly totalBytes: number;
    readonly records: readonly FoundrySpzExtensionRecordFacts[];
  };
  readonly container:
    | {
        readonly kind: "legacy_gzip";
        readonly sourceSizeBytes: number;
        readonly headerBytes: 16;
        readonly corePayloadBytes: number;
        readonly extensionBytes: number;
        readonly decompressedSizeBytes: number;
        readonly gzipHeaderBytes: number;
        readonly singleGzipMemberVerified: true;
        readonly gzipCrc32Verified: true;
        readonly gzipInputSizeVerified: true;
        readonly exactDecompressedLengthVerified: true;
      }
    | {
        readonly kind: "v4_zstd_multistream";
        readonly sourceSizeBytes: number;
        readonly headerBytes: 32;
        readonly tocByteOffset: number;
        readonly tocBytes: number;
        readonly streamCount: 5 | 6;
        readonly totalCompressedStreamBytes: number;
        readonly totalUncompressedStreamBytes: number;
        readonly compressedStreamsEndAtFileEnd: true;
        readonly streams: readonly FoundrySpzV4StreamFacts[];
      };
  readonly limitations: typeof FOUNDRY_SPZ_SOURCE_FACTS_LIMITATIONS;
}

export interface FoundrySpzSourceFactsSourceBinding {
  readonly sourceSha256: string;
  readonly sourceSizeBytes: number;
}

export type FoundrySpzSourceFactsOutcome = FoundrySpzSourceFactsSourceBinding & (
  | { readonly state: "established"; readonly facts: FoundrySpzSourceFacts }
  | {
      readonly state: "facts_not_established";
      readonly category: FoundrySpzSourceFactsFailureCategory;
      readonly code: FoundrySpzSourceFactsFailureCode;
    }
);

const SPZ_MAGIC = 0x5053474e;
const GZIP_FIXED_HEADER_BYTES = 10;
const GZIP_TRAILER_BYTES = 8;
const READ_CHUNK_BYTES = 1024 * 1024;
const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const ADOBE_SAFE_ORBIT_CAMERA = 0xadbe0002;
const ADOBE_COORDINATE_SYSTEM = 0xadbe0003;

type FailureCategory = FoundrySpzSourceFactsFailureCategory;
type FailureCode = FoundrySpzSourceFactsFailureCode;

class SpzInspectionFailure extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly code: FailureCode,
  ) {
    super(code);
    this.name = "SpzInspectionFailure";
  }
}

function fail(category: FailureCategory, code: FailureCode): never {
  throw new SpzInspectionFailure(category, code);
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("cancelled", "SPZ_INSPECTION_CANCELLED");
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

async function readExact(
  handle: FileHandle,
  length: number,
  position: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) {
    fail("parse_failure", "SPZ_HANDLE_READ_FAILED");
  }
  const output = Buffer.alloc(length);
  let offset = 0;
  try {
    while (offset < length) {
      assertNotCancelled(signal);
      const { bytesRead } = await handle.read(output, offset, length - offset, position + offset);
      assertNotCancelled(signal);
      if (bytesRead === 0) fail("parse_failure", "SPZ_HANDLE_READ_FAILED");
      offset += bytesRead;
    }
  } catch (error: unknown) {
    if (error instanceof SpzInspectionFailure) throw error;
    fail("parse_failure", "SPZ_HANDLE_READ_FAILED");
  }
  return output;
}

async function* readHandleRangeChunks(
  handle: FileHandle,
  start: number,
  length: number,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, Math.max(1, length)));
  let offset = 0;
  try {
    while (offset < length) {
      assertNotCancelled(signal);
      const wanted = Math.min(buffer.length, length - offset);
      const { bytesRead } = await handle.read(buffer, 0, wanted, start + offset);
      assertNotCancelled(signal);
      if (bytesRead === 0) fail("parse_failure", "SPZ_HANDLE_READ_FAILED");
      offset += bytesRead;
      yield Buffer.from(buffer.subarray(0, bytesRead));
    }
  } catch (error: unknown) {
    if (error instanceof SpzInspectionFailure) throw error;
    fail("parse_failure", "SPZ_HANDLE_READ_FAILED");
  }
}

function uint64AsSafeNumber(
  bytes: Buffer,
  offset: number,
  category: FailureCategory,
  code: FailureCode,
): number {
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(category, code);
  }
  return Number(value);
}

function shFacts(degree: number): FoundrySpzSourceFacts["sphericalHarmonics"] {
  const coefficients = [0, 3, 8, 15, 24] as const;
  const bytes = [0, 9, 24, 45, 72] as const;
  if (!Number.isInteger(degree) || degree < 0 || degree >= coefficients.length) {
    fail("unsupported_variant", "SPZ_SH_DEGREE_UNSUPPORTED");
  }
  return {
    degree: degree as 0 | 1 | 2 | 3 | 4,
    nonDcCoefficientCount: coefficients[degree] as 0 | 3 | 8 | 15 | 24,
    bytesPerGaussian: bytes[degree] as 0 | 9 | 24 | 45 | 72,
  };
}

function layoutFor(
  version: 1 | 2 | 3 | 4,
  sh: FoundrySpzSourceFacts["sphericalHarmonics"],
): FoundrySpzSourceFacts["attributeLayout"] {
  const positionBytes = version === 1 ? 6 : 9;
  const rotationBytes = version >= 3 ? 4 : 3;
  return {
    positionEncoding: version === 1 ? "float16_xyz" : "signed_fixed_point_24_xyz",
    positionBytesPerGaussian: positionBytes,
    alphaBytesPerGaussian: 1,
    colorDcBytesPerGaussian: 3,
    scaleBytesPerGaussian: 3,
    rotationEncoding: version >= 3
      ? "smallest_three_quaternion_uint32"
      : "first_three_quaternion_uint8",
    rotationBytesPerGaussian: rotationBytes,
    sphericalHarmonicsBytesPerGaussian: sh.bytesPerGaussian,
    totalBytesPerGaussian: positionBytes + 1 + 3 + 3 + rotationBytes + sh.bytesPerGaussian,
  };
}

function recognizedExtension(type: number): FoundrySpzExtensionRecognizedType {
  if (type === ADOBE_SAFE_ORBIT_CAMERA) return "adobe_safe_orbit_camera";
  if (type === ADOBE_COORDINATE_SYSTEM) return "adobe_coordinate_system";
  return "unknown";
}

function parseExtensions(bytes: Buffer): readonly FoundrySpzExtensionRecordFacts[] {
  if (bytes.length > FOUNDRY_SPZ_EXTENSION_MAX_BYTES) {
    fail("resource_limit", "SPZ_EXTENSION_SIZE_LIMIT_EXCEEDED");
  }
  const records: FoundrySpzExtensionRecordFacts[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    if (records.length >= FOUNDRY_SPZ_EXTENSION_MAX_RECORDS) {
      fail("resource_limit", "SPZ_EXTENSION_RECORD_LIMIT_EXCEEDED");
    }
    if (cursor + 8 > bytes.length) fail("parse_failure", "SPZ_EXTENSION_RECORD_INVALID");
    const type = bytes.readUInt32LE(cursor);
    const payloadBytes = bytes.readUInt32LE(cursor + 4);
    const end = cursor + 8 + payloadBytes;
    if (!Number.isSafeInteger(end) || end > bytes.length) {
      fail("parse_failure", "SPZ_EXTENSION_RECORD_INVALID");
    }
    const recognizedType = recognizedExtension(type);
    if (
      (recognizedType === "adobe_safe_orbit_camera" && payloadBytes !== 12) ||
      (recognizedType === "adobe_coordinate_system" && payloadBytes !== 4)
    ) {
      fail("parse_failure", "SPZ_EXTENSION_RECORD_INVALID");
    }
    if (recognizedType === "adobe_coordinate_system") {
      const coordinateSystem = bytes.readUInt32LE(cursor + 8);
      if (coordinateSystem < 1 || coordinateSystem > 16) {
        fail("parse_failure", "SPZ_EXTENSION_RECORD_INVALID");
      }
    }
    records.push({
      typeCodeHex: type.toString(16).padStart(8, "0"),
      payloadBytes,
      recognizedType,
    });
    cursor = end;
  }
  return records;
}

async function gzipHeaderLength(
  handle: FileHandle,
  fileSize: number,
  signal?: AbortSignal,
): Promise<number> {
  if (fileSize < GZIP_FIXED_HEADER_BYTES + GZIP_TRAILER_BYTES) {
    fail("parse_failure", "SPZ_GZIP_HEADER_INVALID");
  }
  const captured = await readExact(
    handle,
    Math.min(fileSize, FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES + 1),
    0,
    signal,
  );
  if (captured[0] !== 0x1f || captured[1] !== 0x8b || captured[2] !== 8) {
    fail("parse_failure", "SPZ_GZIP_HEADER_INVALID");
  }
  const flags = captured[3] ?? 0xff;
  if ((flags & 0xe0) !== 0) fail("parse_failure", "SPZ_GZIP_HEADER_INVALID");
  let cursor = GZIP_FIXED_HEADER_BYTES;
  const requireBytes = (count: number): void => {
    const end = cursor + count;
    if (!Number.isSafeInteger(end) || end > fileSize - GZIP_TRAILER_BYTES) {
      fail("parse_failure", "SPZ_GZIP_HEADER_INVALID");
    }
    if (end > FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES) {
      fail("resource_limit", "SPZ_GZIP_HEADER_SIZE_LIMIT_EXCEEDED");
    }
    if (end > captured.length) fail("parse_failure", "SPZ_GZIP_HEADER_INVALID");
  };
  if ((flags & 0x04) !== 0) {
    requireBytes(2);
    const extraBytes = captured.readUInt16LE(cursor);
    cursor += 2;
    requireBytes(extraBytes);
    cursor += extraBytes;
  }
  for (const flag of [0x08, 0x10]) {
    if ((flags & flag) === 0) continue;
    let terminated = false;
    while (!terminated) {
      requireBytes(1);
      if (captured[cursor] === 0) {
        cursor += 1;
        terminated = true;
        continue;
      }
      cursor += 1;
    }
  }
  if ((flags & 0x02) !== 0) {
    requireBytes(2);
    const expected = captured.readUInt16LE(cursor);
    const actual = crc32(captured.subarray(0, cursor)) & 0xffff;
    if (expected !== actual) fail("parse_failure", "SPZ_GZIP_HEADER_INVALID");
    cursor += 2;
  }
  return cursor;
}

let crcTable: Uint32Array | undefined;

function getCrcTable(): Uint32Array {
  if (crcTable !== undefined) return crcTable;
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

function updateCrc32(state: number, bytes: Uint8Array): number {
  const table = getCrcTable();
  let value = state;
  for (const byte of bytes) value = (table[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  return (updateCrc32(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

async function inspectLegacy(
  handle: FileHandle,
  fileSize: number,
  signal?: AbortSignal,
): Promise<FoundrySpzSourceFacts> {
  const headerBytes = await gzipHeaderLength(handle, fileSize, signal);
  const inflater = createInflateRaw();
  const source = Readable.from(
    readHandleRangeChunks(handle, headerBytes, fileSize - headerBytes, signal),
    { objectMode: false },
  );
  source.on("error", (error: Error) => inflater.destroy(error));
  source.pipe(inflater);

  const header = Buffer.alloc(FOUNDRY_SPZ_LEGACY_HEADER_BYTES);
  let capturedHeaderBytes = 0;
  let decompressedBytes = 0;
  let crcState = 0xffffffff;
  let version: 1 | 2 | 3 | undefined;
  let count: number | undefined;
  let fractionalBits = 0;
  let antialiased = false;
  let sh: FoundrySpzSourceFacts["sphericalHarmonics"] | undefined;
  let layout: FoundrySpzSourceFacts["attributeLayout"] | undefined;
  let coreEndBytes: number | undefined;
  let extensionsDeclared = false;
  let extensionBytes = 0;
  const extensionChunks: Buffer[] = [];
  try {
    for await (const value of inflater) {
      assertNotCancelled(signal);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      const chunkStart = decompressedBytes;
      crcState = updateCrc32(crcState, chunk);
      if (capturedHeaderBytes < header.length) {
        const copyBytes = Math.min(header.length - capturedHeaderBytes, chunk.length);
        chunk.copy(header, capturedHeaderBytes, 0, copyBytes);
        capturedHeaderBytes += copyBytes;
      }
      decompressedBytes += chunk.length;
      if (decompressedBytes > FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES) {
        fail("resource_limit", "SPZ_DECOMPRESSED_SIZE_LIMIT_EXCEEDED");
      }
      if (capturedHeaderBytes === header.length && coreEndBytes === undefined) {
        if (header.readUInt32LE(0) !== SPZ_MAGIC) fail("parse_failure", "SPZ_LEGACY_MAGIC_INVALID");
        const rawVersion = header.readUInt32LE(4);
        if (rawVersion === 4) fail("unsupported_variant", "SPZ_ENVELOPE_VERSION_MISMATCH");
        if (rawVersion < 1 || rawVersion > 3) fail("unsupported_variant", "SPZ_VERSION_UNSUPPORTED");
        version = rawVersion as 1 | 2 | 3;
        count = header.readUInt32LE(8);
        if (count === 0 || count > 0x7fffffff) fail("parse_failure", "SPZ_GAUSSIAN_COUNT_INVALID");
        sh = shFacts(header.readUInt8(12));
        fractionalBits = header.readUInt8(13);
        const flags = header.readUInt8(14);
        if ((flags & ~0x03) !== 0) fail("unsupported_variant", "SPZ_FLAGS_UNSUPPORTED");
        if (header.readUInt8(15) !== 0) fail("unsupported_variant", "SPZ_RESERVED_HEADER_UNSUPPORTED");
        antialiased = (flags & 0x01) !== 0;
        extensionsDeclared = (flags & 0x02) !== 0;
        layout = layoutFor(version, sh);
        const expected = BigInt(FOUNDRY_SPZ_LEGACY_HEADER_BYTES) +
          BigInt(count) * BigInt(layout.totalBytesPerGaussian);
        if (expected > BigInt(FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES) || expected > BigInt(Number.MAX_SAFE_INTEGER)) {
          fail("resource_limit", "SPZ_DECOMPRESSED_SIZE_LIMIT_EXCEEDED");
        }
        coreEndBytes = Number(expected);
      }
      if (coreEndBytes !== undefined && decompressedBytes > coreEndBytes) {
        if (!extensionsDeclared) fail("parse_failure", "SPZ_PAYLOAD_LENGTH_MISMATCH");
        const extensionStart = Math.max(0, coreEndBytes - chunkStart);
        if (extensionStart < chunk.length) {
          const extensionChunk = Buffer.from(chunk.subarray(extensionStart));
          extensionBytes += extensionChunk.length;
          if (extensionBytes > FOUNDRY_SPZ_EXTENSION_MAX_BYTES) {
            fail("resource_limit", "SPZ_EXTENSION_SIZE_LIMIT_EXCEEDED");
          }
          extensionChunks.push(extensionChunk);
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof SpzInspectionFailure) throw error;
    if (signal?.aborted === true) fail("cancelled", "SPZ_INSPECTION_CANCELLED");
    fail("parse_failure", "SPZ_GZIP_STREAM_INVALID");
  } finally {
    source.unpipe(inflater);
    source.destroy();
    inflater.destroy();
  }
  if (capturedHeaderBytes !== header.length) fail("parse_failure", "SPZ_LEGACY_HEADER_TRUNCATED");
  if (
    version === undefined || count === undefined || sh === undefined || layout === undefined ||
    coreEndBytes === undefined || decompressedBytes < coreEndBytes
  ) {
    fail("parse_failure", "SPZ_PAYLOAD_LENGTH_MISMATCH");
  }
  if (extensionsDeclared !== (extensionBytes > 0)) {
    fail("parse_failure", "SPZ_EXTENSION_DECLARATION_MISMATCH");
  }
  const extensionRecords = parseExtensions(
    extensionBytes === 0 ? Buffer.alloc(0) : Buffer.concat(extensionChunks, extensionBytes),
  );
  const deflateBytes = inflater.bytesWritten;
  const trailerOffset = headerBytes + deflateBytes;
  if (trailerOffset + GZIP_TRAILER_BYTES !== fileSize) {
    fail("unsupported_variant", "SPZ_GZIP_TRAILING_DATA_UNSUPPORTED");
  }
  const trailer = await readExact(handle, GZIP_TRAILER_BYTES, trailerOffset, signal);
  const actualCrc = (crcState ^ 0xffffffff) >>> 0;
  if (trailer.readUInt32LE(0) !== actualCrc) fail("parse_failure", "SPZ_GZIP_TRAILER_INVALID");
  if (trailer.readUInt32LE(4) !== (decompressedBytes >>> 0)) {
    fail("parse_failure", "SPZ_GZIP_TRAILER_INVALID");
  }
  return {
    format: "spz_legacy_gzip",
    inspectionCoverage: "single_gzip_member_header_declared_layout_and_complete_stream",
    version,
    count,
    fractionalBitsRaw: fractionalBits,
    antialiased,
    sphericalHarmonics: sh,
    attributeLayout: layout,
    extensions: {
      declared: extensionsDeclared,
      totalBytes: extensionBytes,
      records: extensionRecords,
    },
    container: {
      kind: "legacy_gzip",
      sourceSizeBytes: fileSize,
      headerBytes: 16,
      corePayloadBytes: coreEndBytes - FOUNDRY_SPZ_LEGACY_HEADER_BYTES,
      extensionBytes,
      decompressedSizeBytes: decompressedBytes,
      gzipHeaderBytes: headerBytes,
      singleGzipMemberVerified: true,
      gzipCrc32Verified: true,
      gzipInputSizeVerified: true,
      exactDecompressedLengthVerified: true,
    },
    limitations: FOUNDRY_SPZ_SOURCE_FACTS_LIMITATIONS,
  };
}

function v4StreamPlan(
  count: number,
  sh: FoundrySpzSourceFacts["sphericalHarmonics"],
): readonly { readonly role: FoundrySpzStreamRole; readonly bytes: number }[] {
  const plan: Array<{ role: FoundrySpzStreamRole; bytes: number }> = [
    { role: "positions", bytes: count * 9 },
    { role: "alphas", bytes: count },
    { role: "colors_dc", bytes: count * 3 },
    { role: "scales", bytes: count * 3 },
    { role: "rotations", bytes: count * 4 },
  ];
  if (sh.bytesPerGaussian > 0) {
    plan.push({ role: "spherical_harmonics_non_dc", bytes: count * sh.bytesPerGaussian });
  }
  if (plan.some((item) => !Number.isSafeInteger(item.bytes))) {
    fail("resource_limit", "SPZ_DECOMPRESSED_SIZE_LIMIT_EXCEEDED");
  }
  return plan;
}

async function verifyZstdStream(
  handle: FileHandle,
  start: number,
  compressedBytes: number,
  expectedUncompressedBytes: number,
  signal?: AbortSignal,
): Promise<void> {
  if (compressedBytes < ZSTD_FRAME_MAGIC.length) fail("parse_failure", "SPZ_V4_ZSTD_FRAME_INVALID");
  const magic = await readExact(handle, ZSTD_FRAME_MAGIC.length, start, signal);
  if (!magic.equals(ZSTD_FRAME_MAGIC)) fail("parse_failure", "SPZ_V4_ZSTD_FRAME_INVALID");
  const factory = (nodeZlib as Partial<typeof nodeZlib>).createZstdDecompress;
  if (typeof factory !== "function") {
    fail("unsupported_variant", "SPZ_V4_ZSTD_RUNTIME_UNAVAILABLE");
  }
  const decoder = factory();
  const source = Readable.from(
    readHandleRangeChunks(handle, start, compressedBytes, signal),
    { objectMode: false },
  );
  source.on("error", (error: Error) => decoder.destroy(error));
  source.pipe(decoder);
  let decodedBytes = 0;
  let consumedCompressedBytes = 0;
  try {
    for await (const value of decoder) {
      assertNotCancelled(signal);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      decodedBytes += chunk.length;
      if (decodedBytes > expectedUncompressedBytes) {
        fail("parse_failure", "SPZ_V4_STREAM_SIZE_MISMATCH");
      }
    }
    consumedCompressedBytes = decoder.bytesWritten;
  } catch (error: unknown) {
    if (error instanceof SpzInspectionFailure) throw error;
    if (signal?.aborted === true) fail("cancelled", "SPZ_INSPECTION_CANCELLED");
    fail("parse_failure", "SPZ_V4_ZSTD_FRAME_INVALID");
  } finally {
    source.unpipe(decoder);
    source.destroy();
    decoder.destroy();
  }
  if (decodedBytes !== expectedUncompressedBytes) {
    fail("parse_failure", "SPZ_V4_STREAM_SIZE_MISMATCH");
  }
  if (consumedCompressedBytes !== compressedBytes) {
    fail("parse_failure", "SPZ_V4_ZSTD_FRAME_INVALID");
  }
}

async function inspectV4(
  handle: FileHandle,
  fileSize: number,
  signal?: AbortSignal,
): Promise<FoundrySpzSourceFacts> {
  if (fileSize < FOUNDRY_SPZ_V4_HEADER_BYTES) fail("parse_failure", "SPZ_V4_TOC_INVALID");
  const header = await readExact(handle, FOUNDRY_SPZ_V4_HEADER_BYTES, 0, signal);
  if (header.readUInt32LE(0) !== SPZ_MAGIC) fail("unsupported_container", "SPZ_CONTAINER_UNRECOGNIZED");
  const rawVersion = header.readUInt32LE(4);
  if (rawVersion >= 1 && rawVersion <= 3) {
    fail("unsupported_variant", "SPZ_ENVELOPE_VERSION_MISMATCH");
  }
  if (rawVersion !== 4) fail("unsupported_variant", "SPZ_VERSION_UNSUPPORTED");
  const count = header.readUInt32LE(8);
  if (count === 0 || count > 0x7fffffff) fail("parse_failure", "SPZ_GAUSSIAN_COUNT_INVALID");
  const plausibilityMaximum = (BigInt(fileSize) * BigInt(FOUNDRY_SPZ_V4_MAX_COMPRESSION_RATIO)) / 9n;
  if (BigInt(count) > plausibilityMaximum) {
    fail("resource_limit", "SPZ_V4_POINT_COUNT_PLAUSIBILITY_LIMIT_EXCEEDED");
  }
  const sh = shFacts(header.readUInt8(12));
  const fractionalBits = header.readUInt8(13);
  const flags = header.readUInt8(14);
  if ((flags & ~0x03) !== 0) fail("unsupported_variant", "SPZ_FLAGS_UNSUPPORTED");
  const extensionsDeclared = (flags & 0x02) !== 0;
  const streamCount = header.readUInt8(15);
  const expectedStreamCount = sh.degree === 0 ? 5 : 6;
  if (streamCount !== expectedStreamCount) fail("parse_failure", "SPZ_V4_STREAM_COUNT_INVALID");
  const tocByteOffset = header.readUInt32LE(16);
  if (header.subarray(20, 32).some((byte) => byte !== 0)) {
    fail("unsupported_variant", "SPZ_RESERVED_HEADER_UNSUPPORTED");
  }
  if (tocByteOffset < FOUNDRY_SPZ_V4_HEADER_BYTES) {
    fail("parse_failure", "SPZ_V4_TOC_OFFSET_INVALID");
  }
  const extensionBytes = tocByteOffset - FOUNDRY_SPZ_V4_HEADER_BYTES;
  if (extensionBytes > FOUNDRY_SPZ_EXTENSION_MAX_BYTES) {
    fail("resource_limit", "SPZ_EXTENSION_SIZE_LIMIT_EXCEEDED");
  }
  if (extensionsDeclared !== (extensionBytes > 0)) {
    fail("parse_failure", "SPZ_EXTENSION_DECLARATION_MISMATCH");
  }
  const extensionData = extensionBytes === 0
    ? Buffer.alloc(0)
    : await readExact(handle, extensionBytes, FOUNDRY_SPZ_V4_HEADER_BYTES, signal);
  const extensionRecords = parseExtensions(extensionData);
  const tocBytes = streamCount * 16;
  if (tocByteOffset + tocBytes > fileSize) fail("parse_failure", "SPZ_V4_TOC_INVALID");
  const toc = await readExact(handle, tocBytes, tocByteOffset, signal);
  const plan = v4StreamPlan(count, sh);
  const layout = layoutFor(4, sh);
  const totalExpected = plan.reduce((total, item) => total + item.bytes, 0);
  if (totalExpected > FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES) {
    fail("resource_limit", "SPZ_DECOMPRESSED_SIZE_LIMIT_EXCEEDED");
  }
  const entries: Array<{ role: FoundrySpzStreamRole; compressed: number; uncompressed: number; start: number }> = [];
  let compressedOffset = tocByteOffset + tocBytes;
  for (const [index, expected] of plan.entries()) {
    const compressed = uint64AsSafeNumber(
      toc,
      index * 16,
      "parse_failure",
      "SPZ_V4_STREAM_RANGE_INVALID",
    );
    const uncompressed = uint64AsSafeNumber(
      toc,
      index * 16 + 8,
      "resource_limit",
      "SPZ_DECOMPRESSED_SIZE_LIMIT_EXCEEDED",
    );
    if (compressed <= 0) fail("parse_failure", "SPZ_V4_STREAM_RANGE_INVALID");
    if (uncompressed !== expected.bytes) fail("parse_failure", "SPZ_V4_STREAM_SIZE_MISMATCH");
    if (compressed > fileSize - compressedOffset) {
      fail("parse_failure", "SPZ_V4_STREAM_RANGE_INVALID");
    }
    entries.push({ role: expected.role, compressed, uncompressed, start: compressedOffset });
    compressedOffset += compressed;
  }
  if (compressedOffset !== fileSize) fail("parse_failure", "SPZ_V4_STREAM_RANGE_INVALID");
  const streams: FoundrySpzV4StreamFacts[] = [];
  for (const entry of entries) {
    assertNotCancelled(signal);
    await verifyZstdStream(handle, entry.start, entry.compressed, entry.uncompressed, signal);
    streams.push({
      role: entry.role,
      compressedSizeBytes: entry.compressed,
      uncompressedSizeBytes: entry.uncompressed,
      zstdFrameMagicVerified: true,
      completeZstdDecompressionVerified: true,
    });
  }
  return {
    format: "spz_v4_zstd",
    inspectionCoverage: "plaintext_header_extensions_toc_and_complete_zstd_streams",
    version: 4,
    count,
    fractionalBitsRaw: fractionalBits,
    antialiased: (flags & 0x01) !== 0,
    sphericalHarmonics: sh,
    attributeLayout: layout,
    extensions: {
      declared: extensionsDeclared,
      totalBytes: extensionBytes,
      records: extensionRecords,
    },
    container: {
      kind: "v4_zstd_multistream",
      sourceSizeBytes: fileSize,
      headerBytes: 32,
      tocByteOffset,
      tocBytes,
      streamCount,
      totalCompressedStreamBytes: entries.reduce((total, entry) => total + entry.compressed, 0),
      totalUncompressedStreamBytes: entries.reduce((total, entry) => total + entry.uncompressed, 0),
      compressedStreamsEndAtFileEnd: true,
      streams,
    },
    limitations: FOUNDRY_SPZ_SOURCE_FACTS_LIMITATIONS,
  };
}

/**
 * Inspects one already-open, identity-bound SPZ handle. The path is never
 * accepted or reopened, and attribute bytes are traversed only to validate
 * their declared layout and compression streams; Gaussian values are not
 * decoded or interpreted.
 */
export async function inspectSpzSourceFacts(
  handle: FileHandle,
  fileSize: number,
  sourceSha256: string,
  signal?: AbortSignal,
): Promise<FoundrySpzSourceFactsOutcome> {
  const binding: FoundrySpzSourceFactsSourceBinding = {
    sourceSha256,
    sourceSizeBytes: fileSize,
  };
  try {
    assertNotCancelled(signal);
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
      fail("resource_limit", "SPZ_SOURCE_SIZE_INVALID");
    }
    if (fileSize > FOUNDRY_SPZ_SOURCE_MAX_BYTES) {
      fail("resource_limit", "SPZ_SOURCE_SIZE_LIMIT_EXCEEDED");
    }
    const before = await handle.stat();
    assertNotCancelled(signal);
    if (!before.isFile()) fail("parse_failure", "SPZ_SOURCE_NOT_REGULAR");
    if (before.size !== fileSize) fail("parse_failure", "SPZ_SOURCE_SIZE_MISMATCH");
    const prefix = await readExact(handle, Math.min(4, fileSize), 0, signal);
    let facts: FoundrySpzSourceFacts;
    if (prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b) {
      facts = await inspectLegacy(handle, fileSize, signal);
    } else if (prefix.length === 4 && prefix.readUInt32LE(0) === SPZ_MAGIC) {
      facts = await inspectV4(handle, fileSize, signal);
    } else {
      fail("unsupported_container", "SPZ_CONTAINER_UNRECOGNIZED");
    }
    assertNotCancelled(signal);
    const after = await handle.stat();
    assertNotCancelled(signal);
    if (!sameFileIdentity(before, after) || after.size !== fileSize) {
      fail("parse_failure", "SPZ_SOURCE_CHANGED");
    }
    return { ...binding, state: "established", facts };
  } catch (error: unknown) {
    if (error instanceof SpzInspectionFailure) {
      return { ...binding, state: "facts_not_established", category: error.category, code: error.code };
    }
    return {
      ...binding,
      state: "facts_not_established",
      category: "parse_failure",
      code: "SPZ_INSPECTION_FAILED",
    };
  }
}

import type { FileHandle } from "node:fs/promises";
import { parseWebpDimensions, type WebpDimensions } from "./webp.js";

export const FOUNDRY_SOG_ZIP_MAX_ENTRIES = 64;
export const FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;
export const FOUNDRY_SOG_META_MAX_BYTES = 1024 * 1024;
export const FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES = 32 * 1024 * 1024;
export const FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES = 128 * 1024 * 1024;
export const FOUNDRY_SOG_META_JSON_MAX_DEPTH = 64;
export const FOUNDRY_SOG_META_JSON_MAX_VALUES = 100_000;

export function foundrySogShCentroidWidth(bands: 1 | 2 | 3): 192 | 512 | 960 {
  return bands === 1 ? 192 : bands === 2 ? 512 : 960;
}

export const FOUNDRY_SOG_SOURCE_FACTS_LIMITATIONS = [
  "ENCODED_MEANS_RANGES_ARE_NOT_DECODED_PHYSICAL_BOUNDS",
  "WEBP_RIFF_VALIDATION_DOES_NOT_DECODE_PIXELS_OR_GAUSSIAN_ATTRIBUTES",
  "CONTAINER_FACTS_DO_NOT_ESTABLISH_RENDERER_COMPATIBILITY_QUALITY_PROVENANCE_UNITS_FRAME_ACCURACY_REGISTRATION_OR_RIGHTS",
] as const;

export const FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CODES = [
  "SOG_INSPECTION_CANCELLED",
  "SOG_SOURCE_SIZE_INVALID",
  "SOG_SOURCE_NOT_REGULAR",
  "SOG_SOURCE_SIZE_MISMATCH",
  "SOG_SOURCE_CHANGED",
  "SOG_HANDLE_READ_FAILED",
  "SOG_ZIP_EOCD_NOT_FOUND",
  "SOG_ZIP_MULTIDISK_UNSUPPORTED",
  "SOG_ZIP64_UNSUPPORTED",
  "SOG_ZIP_ENTRY_LIMIT_EXCEEDED",
  "SOG_ZIP_CENTRAL_DIRECTORY_LIMIT_EXCEEDED",
  "SOG_ZIP_CENTRAL_DIRECTORY_INVALID",
  "SOG_ZIP_ENTRY_HEADER_INVALID",
  "SOG_ZIP_ENCRYPTION_UNSUPPORTED",
  "SOG_ZIP_DATA_DESCRIPTOR_UNSUPPORTED",
  "SOG_ZIP_COMPRESSION_UNSUPPORTED",
  "SOG_ZIP_FLAGS_UNSUPPORTED",
  "SOG_ZIP_NAME_LIMIT_EXCEEDED",
  "SOG_ZIP_NAME_INVALID",
  "SOG_ZIP_DUPLICATE_NAME",
  "SOG_ZIP_PREFIX_COLLISION",
  "SOG_ZIP_MEMBER_SIZE_INVALID",
  "SOG_ZIP_LOCAL_HEADER_INVALID",
  "SOG_ZIP_HEADER_MISMATCH",
  "SOG_ZIP_PREFIX_UNSUPPORTED",
  "SOG_ZIP_ENTRY_OVERLAP",
  "SOG_ZIP_GAP_UNSUPPORTED",
  "SOG_META_MISSING",
  "SOG_META_SIZE_LIMIT_EXCEEDED",
  "SOG_MEMBER_SIZE_LIMIT_EXCEEDED",
  "SOG_PLANE_AGGREGATE_LIMIT_EXCEEDED",
  "SOG_MEMBER_CRC_MISMATCH",
  "SOG_META_UTF8_INVALID",
  "SOG_META_JSON_SYNTAX_INVALID",
  "SOG_META_JSON_DUPLICATE_KEY",
  "SOG_META_JSON_DEPTH_LIMIT_EXCEEDED",
  "SOG_META_JSON_VALUE_LIMIT_EXCEEDED",
  "SOG_META_JSON_NUMBER_OUT_OF_RANGE",
  "SOG_META_SCHEMA_INVALID",
  "SOG_META_VERSION_UNSUPPORTED",
  "SOG_MEMBER_MISSING",
  "SOG_MEMBER_EXTRA",
  "SOG_WEBP_INVALID",
  "SOG_WEBP_DIMENSIONS_INCONSISTENT",
  "SOG_GAUSSIAN_CAPACITY_INSUFFICIENT",
  "SOG_SH_CENTROID_DIMENSIONS_INVALID",
  "SOG_INSPECTION_FAILED",
] as const;

export type FoundrySogSourceFactsFailureCode =
  (typeof FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CODES)[number];
export type FoundrySogSourceFactsFailureCategory =
  | "parse_failure"
  | "resource_limit"
  | "unsupported_variant"
  | "cancelled";

export const FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE = {
  SOG_INSPECTION_CANCELLED: "cancelled",
  SOG_SOURCE_SIZE_INVALID: "resource_limit",
  SOG_SOURCE_NOT_REGULAR: "parse_failure",
  SOG_SOURCE_SIZE_MISMATCH: "parse_failure",
  SOG_SOURCE_CHANGED: "parse_failure",
  SOG_HANDLE_READ_FAILED: "parse_failure",
  SOG_ZIP_EOCD_NOT_FOUND: "parse_failure",
  SOG_ZIP_MULTIDISK_UNSUPPORTED: "unsupported_variant",
  SOG_ZIP64_UNSUPPORTED: "unsupported_variant",
  SOG_ZIP_ENTRY_LIMIT_EXCEEDED: "resource_limit",
  SOG_ZIP_CENTRAL_DIRECTORY_LIMIT_EXCEEDED: "resource_limit",
  SOG_ZIP_CENTRAL_DIRECTORY_INVALID: "parse_failure",
  SOG_ZIP_ENTRY_HEADER_INVALID: "parse_failure",
  SOG_ZIP_ENCRYPTION_UNSUPPORTED: "unsupported_variant",
  SOG_ZIP_DATA_DESCRIPTOR_UNSUPPORTED: "unsupported_variant",
  SOG_ZIP_COMPRESSION_UNSUPPORTED: "unsupported_variant",
  SOG_ZIP_FLAGS_UNSUPPORTED: "unsupported_variant",
  SOG_ZIP_NAME_LIMIT_EXCEEDED: "resource_limit",
  SOG_ZIP_NAME_INVALID: "parse_failure",
  SOG_ZIP_DUPLICATE_NAME: "parse_failure",
  SOG_ZIP_PREFIX_COLLISION: "parse_failure",
  SOG_ZIP_MEMBER_SIZE_INVALID: "parse_failure",
  SOG_ZIP_LOCAL_HEADER_INVALID: "parse_failure",
  SOG_ZIP_HEADER_MISMATCH: "parse_failure",
  SOG_ZIP_PREFIX_UNSUPPORTED: "unsupported_variant",
  SOG_ZIP_ENTRY_OVERLAP: "parse_failure",
  SOG_ZIP_GAP_UNSUPPORTED: "unsupported_variant",
  SOG_META_MISSING: "parse_failure",
  SOG_META_SIZE_LIMIT_EXCEEDED: "resource_limit",
  SOG_MEMBER_SIZE_LIMIT_EXCEEDED: "resource_limit",
  SOG_PLANE_AGGREGATE_LIMIT_EXCEEDED: "resource_limit",
  SOG_MEMBER_CRC_MISMATCH: "parse_failure",
  SOG_META_UTF8_INVALID: "parse_failure",
  SOG_META_JSON_SYNTAX_INVALID: "parse_failure",
  SOG_META_JSON_DUPLICATE_KEY: "parse_failure",
  SOG_META_JSON_DEPTH_LIMIT_EXCEEDED: "resource_limit",
  SOG_META_JSON_VALUE_LIMIT_EXCEEDED: "resource_limit",
  SOG_META_JSON_NUMBER_OUT_OF_RANGE: "parse_failure",
  SOG_META_SCHEMA_INVALID: "parse_failure",
  SOG_META_VERSION_UNSUPPORTED: "unsupported_variant",
  SOG_MEMBER_MISSING: "parse_failure",
  SOG_MEMBER_EXTRA: "parse_failure",
  SOG_WEBP_INVALID: "parse_failure",
  SOG_WEBP_DIMENSIONS_INCONSISTENT: "parse_failure",
  SOG_GAUSSIAN_CAPACITY_INSUFFICIENT: "parse_failure",
  SOG_SH_CENTROID_DIMENSIONS_INVALID: "parse_failure",
  SOG_INSPECTION_FAILED: "parse_failure",
} as const satisfies Readonly<
  Record<FoundrySogSourceFactsFailureCode, FoundrySogSourceFactsFailureCategory>
>;

export type FoundrySogWebpRole =
  | "means_l"
  | "means_u"
  | "scales"
  | "quats"
  | "sh0"
  | "shN_centroids"
  | "shN_labels";

export interface FoundrySogWebpPlaneFacts {
  readonly role: FoundrySogWebpRole;
  readonly kind: "per_gaussian" | "sh_palette";
  readonly sizeBytes: number;
  readonly crc32Hex: string;
  readonly width: number;
  readonly height: number;
  readonly encoding: WebpDimensions["encoding"];
}

export interface FoundryStoredZipSogV2Facts {
  readonly format: "sog_v2_stored_zip";
  readonly inspectionCoverage: "stored_zip_meta_json_and_complete_webp_riff_structure";
  readonly version: 2;
  readonly count: number;
  readonly antialias: {
    readonly declared: boolean;
    readonly declaredValue: boolean | null;
    readonly formatDefault: false;
  };
  readonly assetGeneratorDeclared: boolean;
  readonly encodedMeansRange: {
    readonly mins: readonly [number, number, number];
    readonly maxs: readonly [number, number, number];
  };
  readonly sphericalHarmonics: {
    readonly higherOrderPresent: boolean;
    readonly bands: 1 | 2 | 3 | null;
    readonly paletteCount: number | null;
  };
  readonly container: {
    readonly archiveSizeBytes: number;
    readonly entryCount: number;
    readonly centralDirectoryBytes: number;
    readonly archiveCommentBytes: number;
    readonly metaJsonBytes: number;
    readonly totalMemberUncompressedBytes: number;
    readonly webpPlaneBytes: number;
    readonly dataDescriptorCount: number;
    readonly exactMemberSet: true;
    readonly allMembersStored: true;
    readonly allMemberCrc32Verified: true;
    readonly allDataDescriptorsVerified: true;
    readonly localHeaderFieldsConsistentWithCentralDirectory: true;
    readonly archiveHasNoPrefixOrGaps: true;
    readonly entryRangesNonOverlapping: true;
  };
  readonly sharedPerGaussianImage: {
    readonly width: number;
    readonly height: number;
    readonly capacityPixels: number;
    readonly countFitsCapacity: true;
  };
  readonly planes: readonly FoundrySogWebpPlaneFacts[];
  readonly limitations: typeof FOUNDRY_SOG_SOURCE_FACTS_LIMITATIONS;
}

export interface FoundrySogSourceFactsSourceBinding {
  readonly sourceSha256: string;
  readonly sourceSizeBytes: number;
}

export type FoundrySogSourceFactsOutcome = FoundrySogSourceFactsSourceBinding & (
  | { readonly state: "established"; readonly facts: FoundryStoredZipSogV2Facts }
  | {
      readonly state: "facts_not_established";
      readonly category: FoundrySogSourceFactsFailureCategory;
      readonly code: FoundrySogSourceFactsFailureCode;
    }
);

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 65_535;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const ZIP64_EXTRA_ID = 0x0001;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_ENCRYPTED_FLAGS = 0x0001 | 0x0040;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_DATA_DESCRIPTOR_BYTES = 16;
const ZIP_MAX_NAME_BYTES = 4_096;
const READ_CHUNK_BYTES = 1024 * 1024;
const CRC32_TABLE = makeCrc32Table();

type FailureCategory = FoundrySogSourceFactsFailureCategory;
type FailureCode = FoundrySogSourceFactsFailureCode;

class SogInspectionFailure extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly code: FailureCode,
  ) {
    super(code);
    this.name = "SogInspectionFailure";
  }
}

function fail(category: FailureCategory, code: FailureCode): never {
  if (FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code] !== category) {
    throw new SogInspectionFailure("parse_failure", "SOG_INSPECTION_FAILED");
  }
  throw new SogInspectionFailure(category, code);
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("cancelled", "SOG_INSPECTION_CANCELLED");
}

function uint32(bytes: Buffer, offset: number): number {
  return bytes.readUInt32LE(offset);
}

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function readExactAt(
  handle: FileHandle,
  position: number,
  length: number,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length < 0) {
    fail("parse_failure", "SOG_ZIP_MEMBER_SIZE_INVALID");
  }
  const output = Buffer.allocUnsafe(length);
  let completed = 0;
  try {
    while (completed < length) {
      assertNotCancelled(signal);
      const requested = Math.min(READ_CHUNK_BYTES, length - completed);
      const { bytesRead } = await handle.read(output, completed, requested, position + completed);
      if (bytesRead <= 0) fail("parse_failure", "SOG_HANDLE_READ_FAILED");
      completed += bytesRead;
    }
  } catch (error: unknown) {
    if (error instanceof SogInspectionFailure) throw error;
    fail("parse_failure", "SOG_HANDLE_READ_FAILED");
  }
  assertNotCancelled(signal);
  return output;
}

interface EocdFacts {
  readonly offset: number;
  readonly entryCount: number;
  readonly centralDirectoryOffset: number;
  readonly centralDirectoryBytes: number;
  readonly commentBytes: number;
}

async function readEocd(
  handle: FileHandle,
  fileSize: number,
  signal: AbortSignal | undefined,
): Promise<EocdFacts> {
  if (fileSize < EOCD_MIN_BYTES) fail("parse_failure", "SOG_ZIP_EOCD_NOT_FOUND");
  const tailBytes = Math.min(fileSize, EOCD_MIN_BYTES + ZIP_MAX_COMMENT_BYTES);
  const tailOffset = fileSize - tailBytes;
  const tail = await readExactAt(handle, tailOffset, tailBytes, signal);
  let relativeOffset = -1;
  for (let index = tail.length - EOCD_MIN_BYTES; index >= 0; index -= 1) {
    if (uint32(tail, index) !== EOCD_SIGNATURE) continue;
    const commentBytes = tail.readUInt16LE(index + 20);
    if (index + EOCD_MIN_BYTES + commentBytes === tail.length) {
      relativeOffset = index;
      break;
    }
  }
  if (relativeOffset < 0) fail("parse_failure", "SOG_ZIP_EOCD_NOT_FOUND");
  const offset = tailOffset + relativeOffset;
  if (
    (relativeOffset >= 20 && uint32(tail, relativeOffset - 20) === ZIP64_LOCATOR_SIGNATURE) ||
    (relativeOffset >= 56 && uint32(tail, relativeOffset - 56) === ZIP64_EOCD_SIGNATURE)
  ) {
    fail("unsupported_variant", "SOG_ZIP64_UNSUPPORTED");
  }
  const disk = tail.readUInt16LE(relativeOffset + 4);
  const centralDisk = tail.readUInt16LE(relativeOffset + 6);
  const diskEntries = tail.readUInt16LE(relativeOffset + 8);
  const totalEntries = tail.readUInt16LE(relativeOffset + 10);
  const centralDirectoryBytes = uint32(tail, relativeOffset + 12);
  const centralDirectoryOffset = uint32(tail, relativeOffset + 16);
  const commentBytes = tail.readUInt16LE(relativeOffset + 20);
  if (
    disk === 0xffff ||
    centralDisk === 0xffff ||
    diskEntries === 0xffff ||
    totalEntries === 0xffff ||
    centralDirectoryBytes === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    fail("unsupported_variant", "SOG_ZIP64_UNSUPPORTED");
  }
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    fail("unsupported_variant", "SOG_ZIP_MULTIDISK_UNSUPPORTED");
  }
  if (totalEntries > FOUNDRY_SOG_ZIP_MAX_ENTRIES) {
    fail("resource_limit", "SOG_ZIP_ENTRY_LIMIT_EXCEEDED");
  }
  if (centralDirectoryBytes > FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES) {
    fail("resource_limit", "SOG_ZIP_CENTRAL_DIRECTORY_LIMIT_EXCEEDED");
  }
  if (
    centralDirectoryOffset + centralDirectoryBytes !== offset ||
    centralDirectoryOffset < 0 ||
    centralDirectoryOffset > fileSize
  ) {
    fail("parse_failure", "SOG_ZIP_CENTRAL_DIRECTORY_INVALID");
  }
  return {
    offset,
    entryCount: totalEntries,
    centralDirectoryOffset,
    centralDirectoryBytes,
    commentBytes,
  };
}

interface CentralEntry {
  readonly name: string;
  readonly nameBytes: Buffer;
  readonly versionNeeded: number;
  readonly flags: number;
  readonly method: number;
  readonly modificationTime: number;
  readonly modificationDate: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function validateExtraFields(bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 4) fail("parse_failure", "SOG_ZIP_ENTRY_HEADER_INVALID");
    const id = bytes.readUInt16LE(offset);
    const size = bytes.readUInt16LE(offset + 2);
    if (id === ZIP64_EXTRA_ID) fail("unsupported_variant", "SOG_ZIP64_UNSUPPORTED");
    offset += 4 + size;
    if (offset > bytes.length) fail("parse_failure", "SOG_ZIP_ENTRY_HEADER_INVALID");
  }
}

function decodeZipName(bytes: Buffer): string {
  if (bytes.length === 0 || bytes.length > ZIP_MAX_NAME_BYTES) {
    fail("resource_limit", "SOG_ZIP_NAME_LIMIT_EXCEEDED");
  }
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("parse_failure", "SOG_ZIP_NAME_INVALID");
  }
  const parts = name.split("/");
  if (
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.includes("\\") ||
    name.includes("\u0000") ||
    name.includes(":") ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    hasControlCharacter(name)
  ) {
    fail("parse_failure", "SOG_ZIP_NAME_INVALID");
  }
  return name;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    if (character.charCodeAt(0) < 0x20) return true;
  }
  return false;
}

function validateFlags(flags: number): void {
  if ((flags & ZIP_ENCRYPTED_FLAGS) !== 0) {
    fail("unsupported_variant", "SOG_ZIP_ENCRYPTION_UNSUPPORTED");
  }
  if ((flags & ~(ZIP_UTF8_FLAG | ZIP_DATA_DESCRIPTOR_FLAG)) !== 0) {
    fail("unsupported_variant", "SOG_ZIP_FLAGS_UNSUPPORTED");
  }
}

function parseCentralDirectory(bytes: Buffer, expectedCount: number): CentralEntry[] {
  const entries: CentralEntry[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (entries.length >= expectedCount || bytes.length - offset < CENTRAL_HEADER_BYTES) {
      fail("parse_failure", "SOG_ZIP_CENTRAL_DIRECTORY_INVALID");
    }
    if (uint32(bytes, offset) !== CENTRAL_SIGNATURE) {
      fail("parse_failure", "SOG_ZIP_ENTRY_HEADER_INVALID");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const modificationTime = bytes.readUInt16LE(offset + 12);
    const modificationDate = bytes.readUInt16LE(offset + 14);
    const crc = uint32(bytes, offset + 16);
    const compressedSize = uint32(bytes, offset + 20);
    const uncompressedSize = uint32(bytes, offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const diskStart = bytes.readUInt16LE(offset + 34);
    const localHeaderOffset = uint32(bytes, offset + 42);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      diskStart === 0xffff
    ) {
      fail("unsupported_variant", "SOG_ZIP64_UNSUPPORTED");
    }
    if (diskStart !== 0) fail("unsupported_variant", "SOG_ZIP_MULTIDISK_UNSUPPORTED");
    validateFlags(flags);
    if (method !== 0) fail("unsupported_variant", "SOG_ZIP_COMPRESSION_UNSUPPORTED");
    if (compressedSize !== uncompressedSize) {
      fail("parse_failure", "SOG_ZIP_MEMBER_SIZE_INVALID");
    }
    const end = offset + CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
    if (end > bytes.length) fail("parse_failure", "SOG_ZIP_ENTRY_HEADER_INVALID");
    const nameBytes = Buffer.from(bytes.subarray(offset + CENTRAL_HEADER_BYTES, offset + CENTRAL_HEADER_BYTES + nameLength));
    const extraStart = offset + CENTRAL_HEADER_BYTES + nameLength;
    validateExtraFields(bytes.subarray(extraStart, extraStart + extraLength));
    entries.push({
      name: decodeZipName(nameBytes),
      nameBytes,
      versionNeeded: bytes.readUInt16LE(offset + 6),
      flags,
      method,
      modificationTime,
      modificationDate,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = end;
  }
  if (offset !== bytes.length || entries.length !== expectedCount) {
    fail("parse_failure", "SOG_ZIP_CENTRAL_DIRECTORY_INVALID");
  }
  const names = entries.map((entry) => entry.name);
  if (new Set(names).size !== names.length) fail("parse_failure", "SOG_ZIP_DUPLICATE_NAME");
  const sortedNames = [...names].sort();
  for (let index = 0; index < sortedNames.length; index += 1) {
    const name = sortedNames[index];
    if (name === undefined) continue;
    for (let otherIndex = index + 1; otherIndex < sortedNames.length; otherIndex += 1) {
      const other = sortedNames[otherIndex];
      if (other === undefined || !other.startsWith(`${name}/`)) break;
      fail("parse_failure", "SOG_ZIP_PREFIX_COLLISION");
    }
  }
  return entries;
}

interface LocatedEntry extends CentralEntry {
  readonly dataOffset: number;
  readonly dataEnd: number;
  readonly recordEnd: number;
}

async function locateEntries(
  handle: FileHandle,
  entries: readonly CentralEntry[],
  centralDirectoryOffset: number,
  signal: AbortSignal | undefined,
): Promise<LocatedEntry[]> {
  const located: LocatedEntry[] = [];
  for (const entry of entries) {
    if (entry.localHeaderOffset + LOCAL_HEADER_BYTES > centralDirectoryOffset) {
      fail("parse_failure", "SOG_ZIP_LOCAL_HEADER_INVALID");
    }
    const header = await readExactAt(handle, entry.localHeaderOffset, LOCAL_HEADER_BYTES, signal);
    if (uint32(header, 0) !== LOCAL_SIGNATURE) fail("parse_failure", "SOG_ZIP_LOCAL_HEADER_INVALID");
    const flags = header.readUInt16LE(6);
    const method = header.readUInt16LE(8);
    const modificationTime = header.readUInt16LE(10);
    const modificationDate = header.readUInt16LE(12);
    const crc = uint32(header, 14);
    const compressedSize = uint32(header, 18);
    const uncompressedSize = uint32(header, 22);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      fail("unsupported_variant", "SOG_ZIP64_UNSUPPORTED");
    }
    if (nameLength > ZIP_MAX_NAME_BYTES) fail("resource_limit", "SOG_ZIP_NAME_LIMIT_EXCEEDED");
    validateFlags(flags);
    if (method !== 0) fail("unsupported_variant", "SOG_ZIP_COMPRESSION_UNSUPPORTED");
    const variableLength = nameLength + extraLength;
    if (entry.localHeaderOffset + LOCAL_HEADER_BYTES + variableLength > centralDirectoryOffset) {
      fail("parse_failure", "SOG_ZIP_LOCAL_HEADER_INVALID");
    }
    const variable = await readExactAt(
      handle,
      entry.localHeaderOffset + LOCAL_HEADER_BYTES,
      variableLength,
      signal,
    );
    const localName = variable.subarray(0, nameLength);
    validateExtraFields(variable.subarray(nameLength));
    const usesDataDescriptor = (flags & ZIP_DATA_DESCRIPTOR_FLAG) !== 0;
    const localCrcMatches = usesDataDescriptor
      ? crc === 0 || crc === entry.crc32
      : crc === entry.crc32;
    const localCompressedSizeMatches = usesDataDescriptor
      ? compressedSize === 0 || compressedSize === entry.compressedSize
      : compressedSize === entry.compressedSize;
    const localUncompressedSizeMatches = usesDataDescriptor
      ? uncompressedSize === 0 || uncompressedSize === entry.uncompressedSize
      : uncompressedSize === entry.uncompressedSize;
    if (
      header.readUInt16LE(4) !== entry.versionNeeded ||
      flags !== entry.flags ||
      method !== entry.method ||
      modificationTime !== entry.modificationTime ||
      modificationDate !== entry.modificationDate ||
      !localCrcMatches ||
      !localCompressedSizeMatches ||
      !localUncompressedSizeMatches ||
      !localName.equals(entry.nameBytes)
    ) {
      fail("parse_failure", "SOG_ZIP_HEADER_MISMATCH");
    }
    const dataOffset = entry.localHeaderOffset + LOCAL_HEADER_BYTES + variableLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > centralDirectoryOffset) {
      fail("parse_failure", "SOG_ZIP_MEMBER_SIZE_INVALID");
    }
    let recordEnd = dataEnd;
    if (usesDataDescriptor) {
      if (dataEnd + 4 > centralDirectoryOffset) {
        fail("parse_failure", "SOG_ZIP_MEMBER_SIZE_INVALID");
      }
      const descriptorSignature = await readExactAt(handle, dataEnd, 4, signal);
      if (uint32(descriptorSignature, 0) !== ZIP_DATA_DESCRIPTOR_SIGNATURE) {
        fail("unsupported_variant", "SOG_ZIP_DATA_DESCRIPTOR_UNSUPPORTED");
      }
      if (dataEnd + ZIP_DATA_DESCRIPTOR_BYTES > centralDirectoryOffset) {
        fail("parse_failure", "SOG_ZIP_MEMBER_SIZE_INVALID");
      }
      const descriptor = await readExactAt(
        handle,
        dataEnd,
        ZIP_DATA_DESCRIPTOR_BYTES,
        signal,
      );
      if (
        uint32(descriptor, 4) !== entry.crc32 ||
        uint32(descriptor, 8) !== entry.compressedSize ||
        uint32(descriptor, 12) !== entry.uncompressedSize
      ) {
        fail("parse_failure", "SOG_ZIP_HEADER_MISMATCH");
      }
      recordEnd += ZIP_DATA_DESCRIPTOR_BYTES;
    }
    located.push({ ...entry, dataOffset, dataEnd, recordEnd });
  }
  const ordered = [...located].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  let expectedOffset = 0;
  for (const entry of ordered) {
    if (entry.localHeaderOffset < expectedOffset) fail("parse_failure", "SOG_ZIP_ENTRY_OVERLAP");
    if (entry.localHeaderOffset > expectedOffset) {
      fail(
        "unsupported_variant",
        expectedOffset === 0 ? "SOG_ZIP_PREFIX_UNSUPPORTED" : "SOG_ZIP_GAP_UNSUPPORTED",
      );
    }
    expectedOffset = entry.recordEnd;
  }
  if (expectedOffset !== centralDirectoryOffset) {
    fail("unsupported_variant", expectedOffset === 0 ? "SOG_ZIP_PREFIX_UNSUPPORTED" : "SOG_ZIP_GAP_UNSUPPORTED");
  }
  return located;
}

function isJsonWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
}

class BoundedSogJsonParser {
  private index = 0;
  private values = 0;

  constructor(private readonly text: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(1);
    this.skipWhitespace();
    if (this.index !== this.text.length) fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
    return value;
  }

  private parseValue(depth: number): unknown {
    if (depth > FOUNDRY_SOG_META_JSON_MAX_DEPTH) {
      fail("resource_limit", "SOG_META_JSON_DEPTH_LIMIT_EXCEEDED");
    }
    this.values += 1;
    if (this.values > FOUNDRY_SOG_META_JSON_MAX_VALUES) {
      fail("resource_limit", "SOG_META_JSON_VALUE_LIMIT_EXCEEDED");
    }
    const character = this.text[this.index];
    if (character === "{") return this.parseObject(depth);
    if (character === "[") return this.parseArray(depth);
    if (character === "\"") return this.parseString();
    if (this.take("true")) return true;
    if (this.take("false")) return false;
    if (this.take("null")) return null;
    return this.parseNumber();
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.index += 1;
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      if (this.text[this.index] !== "\"") fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
      const key = this.parseString();
      if (keys.has(key)) fail("parse_failure", "SOG_META_JSON_DUPLICATE_KEY");
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
      this.index += 1;
      this.skipWhitespace();
      result[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ",") fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
      this.index += 1;
      this.skipWhitespace();
    }
    return fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
  }

  private parseArray(depth: number): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      result.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ",") fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
      this.index += 1;
      this.skipWhitespace();
    }
    return fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      const character = this.text[this.index];
      if (!escaped && character === "\"") {
        this.index += 1;
        let parsed: string;
        try {
          parsed = JSON.parse(this.text.slice(start, this.index)) as string;
        } catch {
          return fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
        }
        if (!hasValidUnicodeScalars(parsed)) fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
        return parsed;
      }
      if (!escaped && code < 0x20) fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      this.index += 1;
    }
    return fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(this.text.slice(this.index));
    if (match === null) return fail("parse_failure", "SOG_META_JSON_SYNTAX_INVALID");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("parse_failure", "SOG_META_JSON_NUMBER_OUT_OF_RANGE");
    return value;
  }

  private take(keyword: string): boolean {
    if (!this.text.startsWith(keyword, this.index)) return false;
    this.index += keyword.length;
    return true;
  }

  private skipWhitespace(): void {
    while (isJsonWhitespace(this.text.charCodeAt(this.index))) this.index += 1;
  }
}

function hasValidUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("parse_failure", "SOG_META_SCHEMA_INVALID");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value).sort();
  const expected = [...required, ...optional.filter((key) => value[key] !== undefined)].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail("parse_failure", "SOG_META_SCHEMA_INVALID");
  }
}

function finiteTuple3(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    fail("parse_failure", "SOG_META_SCHEMA_INVALID");
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function finiteCodebook(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 256 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    fail("parse_failure", "SOG_META_SCHEMA_INVALID");
  }
}

function exactFileSlots(value: unknown, expected: readonly string[]): void {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((item, index) => item !== expected[index])) {
    fail("parse_failure", "SOG_META_SCHEMA_INVALID");
  }
}

interface ParsedMeta {
  readonly count: number;
  readonly antialiasDeclared: boolean;
  readonly antialiasValue: boolean | null;
  readonly assetGeneratorDeclared: boolean;
  readonly meansMins: [number, number, number];
  readonly meansMaxs: [number, number, number];
  readonly sh: null | { readonly count: number; readonly bands: 1 | 2 | 3 };
  readonly expectedMembers: readonly string[];
}

function parseMeta(bytes: Buffer): ParsedMeta {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("parse_failure", "SOG_META_UTF8_INVALID");
  }
  const root = record(new BoundedSogJsonParser(text).parse());
  exactKeys(root, ["version", "count", "means", "scales", "quats", "sh0"], ["asset", "antialias", "shN"]);
  if (root.version !== 2) fail("unsupported_variant", "SOG_META_VERSION_UNSUPPORTED");
  if (!Number.isSafeInteger(root.count) || (root.count as number) <= 0) {
    fail("parse_failure", "SOG_META_SCHEMA_INVALID");
  }
  const antialiasDeclared = root.antialias !== undefined;
  if (antialiasDeclared && typeof root.antialias !== "boolean") {
    fail("parse_failure", "SOG_META_SCHEMA_INVALID");
  }
  let assetGeneratorDeclared = false;
  if (root.asset !== undefined) {
    const asset = record(root.asset);
    exactKeys(asset, [], ["generator"]);
    if (asset.generator !== undefined) {
      if (typeof asset.generator !== "string" || asset.generator.length === 0 || asset.generator.length > 500) {
        fail("parse_failure", "SOG_META_SCHEMA_INVALID");
      }
      assetGeneratorDeclared = true;
    }
  }
  const means = record(root.means);
  exactKeys(means, ["mins", "maxs", "files"]);
  const meansMins = finiteTuple3(means.mins);
  const meansMaxs = finiteTuple3(means.maxs);
  if (meansMins.some((minimum, index) => minimum > (meansMaxs[index] ?? minimum))) {
    fail("parse_failure", "SOG_META_SCHEMA_INVALID");
  }
  exactFileSlots(means.files, ["means_l.webp", "means_u.webp"]);
  const scales = record(root.scales);
  exactKeys(scales, ["codebook", "files"]);
  finiteCodebook(scales.codebook);
  exactFileSlots(scales.files, ["scales.webp"]);
  const quats = record(root.quats);
  exactKeys(quats, ["files"]);
  exactFileSlots(quats.files, ["quats.webp"]);
  const sh0 = record(root.sh0);
  exactKeys(sh0, ["codebook", "files"]);
  finiteCodebook(sh0.codebook);
  exactFileSlots(sh0.files, ["sh0.webp"]);
  let sh: ParsedMeta["sh"] = null;
  if (root.shN !== undefined) {
    const shN = record(root.shN);
    exactKeys(shN, ["count", "bands", "codebook", "files"]);
    if (!Number.isSafeInteger(shN.count) || (shN.count as number) < 1 || (shN.count as number) > 65_536) {
      fail("parse_failure", "SOG_META_SCHEMA_INVALID");
    }
    if (shN.bands !== 1 && shN.bands !== 2 && shN.bands !== 3) {
      fail("parse_failure", "SOG_META_SCHEMA_INVALID");
    }
    finiteCodebook(shN.codebook);
    exactFileSlots(shN.files, ["shN_centroids.webp", "shN_labels.webp"]);
    sh = { count: shN.count as number, bands: shN.bands };
  }
  return {
    count: root.count as number,
    antialiasDeclared,
    antialiasValue: antialiasDeclared ? root.antialias as boolean : null,
    assetGeneratorDeclared,
    meansMins,
    meansMaxs,
    sh,
    expectedMembers: [
      "meta.json",
      "means_l.webp",
      "means_u.webp",
      "scales.webp",
      "quats.webp",
      "sh0.webp",
      ...(sh === null ? [] : ["shN_centroids.webp", "shN_labels.webp"]),
    ],
  };
}

async function readVerifiedMember(
  handle: FileHandle,
  entry: LocatedEntry,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const bytes = await readExactAt(handle, entry.dataOffset, entry.uncompressedSize, signal);
  if (crc32(bytes) !== entry.crc32) fail("parse_failure", "SOG_MEMBER_CRC_MISMATCH");
  return bytes;
}

const BASE_PLANES = [
  ["means_l", "means_l.webp"],
  ["means_u", "means_u.webp"],
  ["scales", "scales.webp"],
  ["quats", "quats.webp"],
  ["sh0", "sh0.webp"],
] as const;
const SH_PLANES = [
  ["shN_centroids", "shN_centroids.webp"],
  ["shN_labels", "shN_labels.webp"],
] as const;

function exactMemberSet(entries: readonly LocatedEntry[], expected: readonly string[]): void {
  const actual = new Set(entries.map((entry) => entry.name));
  for (const name of expected) {
    if (!actual.has(name)) fail("parse_failure", "SOG_MEMBER_MISSING");
  }
  if (actual.size !== expected.length) fail("parse_failure", "SOG_MEMBER_EXTRA");
}

function sameFileIdentity(
  left: { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number },
  right: { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function inspectEstablished(
  handle: FileHandle,
  fileSize: number,
  signal: AbortSignal | undefined,
): Promise<FoundryStoredZipSogV2Facts> {
  const eocd = await readEocd(handle, fileSize, signal);
  const centralBytes = await readExactAt(
    handle,
    eocd.centralDirectoryOffset,
    eocd.centralDirectoryBytes,
    signal,
  );
  const centralEntries = parseCentralDirectory(centralBytes, eocd.entryCount);
  const metaCentral = centralEntries.find((entry) => entry.name === "meta.json");
  if (metaCentral === undefined) fail("parse_failure", "SOG_META_MISSING");
  if (metaCentral.uncompressedSize > FOUNDRY_SOG_META_MAX_BYTES) {
    fail("resource_limit", "SOG_META_SIZE_LIMIT_EXCEEDED");
  }
  let declaredWebpBytes = 0;
  for (const entry of centralEntries) {
    if (!entry.name.endsWith(".webp")) continue;
    if (entry.uncompressedSize > FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES) {
      fail("resource_limit", "SOG_MEMBER_SIZE_LIMIT_EXCEEDED");
    }
    declaredWebpBytes += entry.uncompressedSize;
    if (declaredWebpBytes > FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES) {
      fail("resource_limit", "SOG_PLANE_AGGREGATE_LIMIT_EXCEEDED");
    }
  }
  const entries = await locateEntries(handle, centralEntries, eocd.centralDirectoryOffset, signal);
  const byName = new Map(entries.map((entry) => [entry.name, entry] as const));
  const metaEntry = byName.get("meta.json");
  if (metaEntry === undefined) fail("parse_failure", "SOG_META_MISSING");
  const meta = parseMeta(await readVerifiedMember(handle, metaEntry, signal));
  exactMemberSet(entries, meta.expectedMembers);
  const planeSlots = [...BASE_PLANES, ...(meta.sh === null ? [] : SH_PLANES)];
  const planes: FoundrySogWebpPlaneFacts[] = [];
  let webpPlaneBytes = 0;
  for (const [role, memberName] of planeSlots) {
    const entry = byName.get(memberName);
    if (entry === undefined) fail("parse_failure", "SOG_MEMBER_MISSING");
    if (entry.uncompressedSize <= 0 || entry.uncompressedSize > FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES) {
      fail("resource_limit", "SOG_MEMBER_SIZE_LIMIT_EXCEEDED");
    }
    webpPlaneBytes += entry.uncompressedSize;
    if (webpPlaneBytes > FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES) {
      fail("resource_limit", "SOG_PLANE_AGGREGATE_LIMIT_EXCEEDED");
    }
    const bytes = await readVerifiedMember(handle, entry, signal);
    let dimensions: WebpDimensions;
    try {
      dimensions = parseWebpDimensions(bytes, bytes.length);
    } catch {
      fail("parse_failure", "SOG_WEBP_INVALID");
    }
    planes.push({
      role,
      kind: role === "shN_centroids" ? "sh_palette" : "per_gaussian",
      sizeBytes: bytes.length,
      crc32Hex: entry.crc32.toString(16).padStart(8, "0"),
      ...dimensions,
    });
  }
  const perGaussian = planes.filter((plane) => plane.kind === "per_gaussian");
  const reference = perGaussian[0];
  if (reference === undefined || perGaussian.some((plane) => plane.width !== reference.width || plane.height !== reference.height)) {
    fail("parse_failure", "SOG_WEBP_DIMENSIONS_INCONSISTENT");
  }
  const capacityPixels = reference.width * reference.height;
  if (!Number.isSafeInteger(capacityPixels) || meta.count > capacityPixels) {
    fail("parse_failure", "SOG_GAUSSIAN_CAPACITY_INSUFFICIENT");
  }
  if (meta.sh !== null) {
    const centroids = planes.find((plane) => plane.role === "shN_centroids");
    const expectedWidth = foundrySogShCentroidWidth(meta.sh.bands);
    const expectedHeight = Math.ceil(meta.sh.count / 64);
    if (centroids === undefined || centroids.width !== expectedWidth || centroids.height !== expectedHeight) {
      fail("parse_failure", "SOG_SH_CENTROID_DIMENSIONS_INVALID");
    }
  }
  const totalMemberUncompressedBytes = entries.reduce((total, entry) => total + entry.uncompressedSize, 0);
  return {
    format: "sog_v2_stored_zip",
    inspectionCoverage: "stored_zip_meta_json_and_complete_webp_riff_structure",
    version: 2,
    count: meta.count,
    antialias: {
      declared: meta.antialiasDeclared,
      declaredValue: meta.antialiasValue,
      formatDefault: false,
    },
    assetGeneratorDeclared: meta.assetGeneratorDeclared,
    encodedMeansRange: { mins: meta.meansMins, maxs: meta.meansMaxs },
    sphericalHarmonics: {
      higherOrderPresent: meta.sh !== null,
      bands: meta.sh?.bands ?? null,
      paletteCount: meta.sh?.count ?? null,
    },
    container: {
      archiveSizeBytes: fileSize,
      entryCount: entries.length,
      centralDirectoryBytes: eocd.centralDirectoryBytes,
      archiveCommentBytes: eocd.commentBytes,
      metaJsonBytes: metaEntry.uncompressedSize,
      totalMemberUncompressedBytes,
      webpPlaneBytes,
      dataDescriptorCount: entries.filter((entry) =>
        (entry.flags & ZIP_DATA_DESCRIPTOR_FLAG) !== 0
      ).length,
      exactMemberSet: true,
      allMembersStored: true,
      allMemberCrc32Verified: true,
      allDataDescriptorsVerified: true,
      localHeaderFieldsConsistentWithCentralDirectory: true,
      archiveHasNoPrefixOrGaps: true,
      entryRangesNonOverlapping: true,
    },
    sharedPerGaussianImage: {
      width: reference.width,
      height: reference.height,
      capacityPixels,
      countFitsCapacity: true,
    },
    planes,
    limitations: FOUNDRY_SOG_SOURCE_FACTS_LIMITATIONS,
  };
}

/**
 * Inspects one already-open, identity-bound SOG handle. This function never
 * accepts or reopens a path, never decompresses members, and never decodes
 * WebP pixels or Gaussian attributes.
 */
export async function inspectStoredZipSogV2SourceFacts(
  handle: FileHandle,
  fileSize: number,
  sourceSha256: string,
  signal?: AbortSignal,
): Promise<FoundrySogSourceFactsOutcome> {
  const sourceBinding: FoundrySogSourceFactsSourceBinding = {
    sourceSha256,
    sourceSizeBytes: fileSize,
  };
  try {
    assertNotCancelled(signal);
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
      fail("resource_limit", "SOG_SOURCE_SIZE_INVALID");
    }
    const before = await handle.stat();
    if (!before.isFile()) fail("parse_failure", "SOG_SOURCE_NOT_REGULAR");
    if (before.size !== fileSize) fail("parse_failure", "SOG_SOURCE_SIZE_MISMATCH");
    const facts = await inspectEstablished(handle, fileSize, signal);
    assertNotCancelled(signal);
    const after = await handle.stat();
    assertNotCancelled(signal);
    if (!sameFileIdentity(before, after) || after.size !== fileSize) {
      fail("parse_failure", "SOG_SOURCE_CHANGED");
    }
    return { ...sourceBinding, state: "established", facts };
  } catch (error: unknown) {
    if (error instanceof SogInspectionFailure) {
      return {
        ...sourceBinding,
        state: "facts_not_established",
        category: error.category,
        code: error.code,
      };
    }
    return {
      ...sourceBinding,
      state: "facts_not_established",
      category: "parse_failure",
      code: "SOG_INSPECTION_FAILED",
    };
  }
}

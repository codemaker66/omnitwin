import { createGunzip, inflateRawSync } from "node:zlib";
import type { Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  FOUNDRY_WEBP_MAX_BYTES,
  inspectWebpBytes,
  type ExpectedRegularFileIdentity,
  type WebpDimensions,
} from "@omnitwin/reconstruction-foundry";

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_MAX_TAIL_BYTES = 65_557;
const MAX_SOG_ENTRIES = 64;
const MAX_SOG_CENTRAL_BYTES = 4 * 1024 * 1024;
const MAX_SOG_META_BYTES = 1024 * 1024;
const MAX_SPZ_UNCOMPRESSED_BYTES = 64 * 1024 * 1024 * 1024;
const SPZ_MAGIC = 0x5053474e;
const SPZ_HEADER_BYTES = 16;
const SPZ_ALLOWED_FLAGS = 0x81;

export type Lcc2ContainerValidationErrorCode =
  | "cancelled"
  | "count_mismatch"
  | "invalid"
  | "source_changed"
  | "unsupported";

export class Lcc2ContainerValidationError extends Error {
  public readonly code: Lcc2ContainerValidationErrorCode;

  public constructor(code: Lcc2ContainerValidationErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "Lcc2ContainerValidationError";
    this.code = code;
  }
}

export interface ValidateLcc2ContainerOptions {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly expectedIdentity: ExpectedRegularFileIdentity;
  readonly expectedGaussianCount: number;
  readonly splatType: ".sog" | ".spz";
  readonly signal?: AbortSignal;
}

interface ZipMember {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly dataOffset: number;
}

function fail(
  code: Lcc2ContainerValidationErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new Lcc2ContainerValidationError(code, message, cause);
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    fail("cancelled", "LCC2 container validation was cancelled.");
  }
}

function identityFromStats(metadata: Stats): ExpectedRegularFileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
  };
}

function sameIdentity(
  left: ExpectedRegularFileIdentity,
  right: ExpectedRegularFileIdentity,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function readExact(
  handle: FileHandle,
  length: number,
  position: number,
  label: string,
): Promise<Buffer> {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) {
    fail("invalid", `${label} has an unsafe byte range.`);
  }
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(output, offset, length - offset, position + offset);
    if (bytesRead === 0) fail("invalid", `${label} is truncated.`);
    offset += bytesRead;
  }
  return output;
}

async function* readHandleChunks(
  handle: FileHandle,
  fileSize: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<Buffer> {
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, fileSize)));
  let position = 0;
  while (position < fileSize) {
    assertNotCancelled(signal);
    const wanted = Math.min(buffer.length, fileSize - position);
    const { bytesRead } = await handle.read(buffer, 0, wanted, position);
    if (bytesRead === 0) return fail("source_changed", "SPZ source ended before its checked size.");
    position += bytesRead;
    // Readable consumers may retain a yielded chunk while requesting the next
    // one, so do not expose the reusable backing buffer.
    yield Buffer.from(buffer.subarray(0, bytesRead));
  }
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
  for (const byte of bytes) {
    value = (table[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  }
  return value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  return (updateCrc32(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

function safeZipName(bytes: Buffer): string {
  if (bytes.length === 0 || bytes.length > 256 || bytes.some((byte) => byte > 0x7f)) {
    return fail("invalid", "SOG ZIP member names must be bounded ASCII names.");
  }
  const name = bytes.toString("ascii");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
    return fail("invalid", `Unsafe or unsupported SOG ZIP member name: ${name}`);
  }
  return name;
}

async function parseZipMembers(
  handle: FileHandle,
  fileSize: number,
): Promise<readonly ZipMember[]> {
  if (!Number.isSafeInteger(fileSize) || fileSize < 22) {
    return fail("invalid", "SOG must be a non-empty ZIP archive.");
  }
  const tailLength = Math.min(fileSize, ZIP_MAX_TAIL_BYTES);
  const tail = await readExact(handle, tailLength, fileSize - tailLength, "SOG ZIP trailer");
  let endOffset = -1;
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== ZIP_END_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === tail.length) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) return fail("invalid", "SOG ZIP end record is missing or malformed.");
  if (
    tail.readUInt16LE(endOffset + 4) !== 0 ||
    tail.readUInt16LE(endOffset + 6) !== 0
  ) {
    return fail("unsupported", "Multi-disk SOG ZIP archives are not supported.");
  }
  const entriesOnDisk = tail.readUInt16LE(endOffset + 8);
  const entryCount = tail.readUInt16LE(endOffset + 10);
  const centralSize = tail.readUInt32LE(endOffset + 12);
  const centralOffset = tail.readUInt32LE(endOffset + 16);
  if (
    entryCount === 0 ||
    entryCount > MAX_SOG_ENTRIES ||
    entriesOnDisk !== entryCount ||
    centralSize > MAX_SOG_CENTRAL_BYTES ||
    centralOffset === 0xffffffff ||
    centralSize === 0xffffffff
  ) {
    return fail("unsupported", "SOG ZIP directory shape is unsupported or unbounded.");
  }
  const absoluteEndOffset = fileSize - tailLength + endOffset;
  if (centralOffset + centralSize !== absoluteEndOffset) {
    return fail("invalid", "SOG ZIP central directory does not end at its end record.");
  }
  const central = await readExact(handle, centralSize, centralOffset, "SOG ZIP central directory");
  const provisional: Array<Omit<ZipMember, "dataOffset">> = [];
  const names = new Set<string>();
  let cursor = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) {
      return fail("invalid", "SOG ZIP central directory entry is malformed.");
    }
    const flags = central.readUInt16LE(cursor + 8);
    const method = central.readUInt16LE(cursor + 10);
    const crc = central.readUInt32LE(cursor + 16);
    const compressedSize = central.readUInt32LE(cursor + 20);
    const uncompressedSize = central.readUInt32LE(cursor + 24);
    const nameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
    const diskStart = central.readUInt16LE(cursor + 34);
    const localHeaderOffset = central.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > central.length) return fail("invalid", "SOG ZIP central entry is truncated.");
    if (
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      return fail("unsupported", "ZIP64 SOG members are not supported.");
    }
    if ((flags & ~0x0808) !== 0 || (method !== 0 && method !== 8)) {
      return fail("unsupported", "Encrypted or unusually compressed SOG members are not supported.");
    }
    const name = safeZipName(central.subarray(cursor + 46, cursor + 46 + nameLength));
    if (names.has(name)) return fail("invalid", `Duplicate SOG ZIP member: ${name}`);
    names.add(name);
    provisional.push({
      name,
      flags,
      method,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor = next;
  }
  if (cursor !== central.length) return fail("invalid", "SOG ZIP central directory has trailing data.");

  const members: ZipMember[] = [];
  for (const member of provisional) {
    if (member.localHeaderOffset + 30 > centralOffset) {
      return fail("invalid", `SOG member ${member.name} has an invalid local header offset.`);
    }
    const local = await readExact(handle, 30, member.localHeaderOffset, `SOG member ${member.name}`);
    if (local.readUInt32LE(0) !== ZIP_LOCAL_SIGNATURE) {
      return fail("invalid", `SOG member ${member.name} has no local ZIP header.`);
    }
    const localFlags = local.readUInt16LE(6);
    const localMethod = local.readUInt16LE(8);
    const localCrc = local.readUInt32LE(14);
    const localCompressedSize = local.readUInt32LE(18);
    const localUncompressedSize = local.readUInt32LE(22);
    const localNameLength = local.readUInt16LE(26);
    const localExtraLength = local.readUInt16LE(28);
    const localName = safeZipName(await readExact(
      handle,
      localNameLength,
      member.localHeaderOffset + 30,
      `SOG member ${member.name} name`,
    ));
    if (localName !== member.name || localFlags !== member.flags || localMethod !== member.method) {
      return fail("invalid", `SOG member ${member.name} local and central headers disagree.`);
    }
    if (
      (member.flags & 0x0008) === 0 &&
      (
        localCrc !== member.crc32 ||
        localCompressedSize !== member.compressedSize ||
        localUncompressedSize !== member.uncompressedSize
      )
    ) {
      return fail("invalid", `SOG member ${member.name} has inconsistent sizes or CRC.`);
    }
    const dataOffset = member.localHeaderOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + member.compressedSize > centralOffset) {
      return fail("invalid", `SOG member ${member.name} data overlaps the central directory.`);
    }
    members.push({ ...member, dataOffset });
  }
  const ordered = [...members].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  if ((ordered[0]?.localHeaderOffset ?? -1) !== 0) {
    return fail("unsupported", "Prefixed or self-extracting SOG ZIP archives are not supported.");
  }
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    if (current === undefined || next === undefined || current.dataOffset + current.compressedSize > next.localHeaderOffset) {
      return fail("invalid", "SOG ZIP member byte ranges overlap.");
    }
  }
  return members;
}

async function readSogMeta(handle: FileHandle, member: ZipMember): Promise<Buffer> {
  if (
    member.compressedSize > MAX_SOG_META_BYTES ||
    member.uncompressedSize > MAX_SOG_META_BYTES ||
    member.uncompressedSize === 0
  ) {
    return fail("invalid", "SOG meta.json is empty or too large.");
  }
  const compressed = await readExact(handle, member.compressedSize, member.dataOffset, "SOG meta.json");
  let bytes: Buffer;
  try {
    bytes = member.method === 0
      ? compressed
      : inflateRawSync(compressed, { maxOutputLength: MAX_SOG_META_BYTES });
  } catch (error: unknown) {
    return fail("invalid", "SOG meta.json cannot be decompressed.", error);
  }
  if (bytes.length !== member.uncompressedSize || crc32(bytes) !== member.crc32) {
    return fail("invalid", "SOG meta.json size or CRC does not match the ZIP directory.");
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface SogImagePlan {
  readonly referencedFiles: readonly string[];
  readonly perGaussianFiles: readonly string[];
  readonly shNCentroids?: {
    readonly file: string;
    readonly paletteCount: number;
    readonly bands: 1 | 2 | 3;
  };
}

function finiteNumberArray(value: unknown, length: number, label: string): readonly number[] {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some((member) => typeof member !== "number" || !Number.isFinite(member))
  ) {
    return fail("invalid", `SOG meta.json ${label} must contain exactly ${String(length)} finite numbers.`);
  }
  return value as number[];
}

function sogFileSlots(
  section: Record<string, unknown>,
  label: string,
  expectedLength: number,
): readonly string[] {
  if (!Array.isArray(section.files) || section.files.length !== expectedLength) {
    return fail(
      "invalid",
      `SOG meta.json ${label}.files must contain exactly ${String(expectedLength)} ordered WebP name${expectedLength === 1 ? "" : "s"}.`,
    );
  }
  const files: string[] = [];
  for (const value of section.files) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.webp$/u.test(value)) {
      return fail("invalid", `SOG meta.json ${label}.files contains an unsafe WebP name.`);
    }
    files.push(value);
  }
  return files;
}

function sogImagePlan(meta: Record<string, unknown>): SogImagePlan {
  const means = meta.means;
  const scales = meta.scales;
  const quats = meta.quats;
  const sh0 = meta.sh0;
  if (!isRecord(means) || !isRecord(scales) || !isRecord(quats) || !isRecord(sh0)) {
    return fail("invalid", "SOG meta.json must define means, scales, quats, and sh0 objects.");
  }
  const mins = finiteNumberArray(means.mins, 3, "means.mins");
  const maxs = finiteNumberArray(means.maxs, 3, "means.maxs");
  if (mins.some((minimum, index) => minimum > (maxs[index] ?? Number.NEGATIVE_INFINITY))) {
    return fail("invalid", "SOG meta.json means.mins cannot exceed means.maxs.");
  }
  finiteNumberArray(scales.codebook, 256, "scales.codebook");
  finiteNumberArray(sh0.codebook, 256, "sh0.codebook");
  if (meta.antialias !== undefined && typeof meta.antialias !== "boolean") {
    return fail("invalid", "SOG meta.json antialias must be boolean when present.");
  }

  const meansFiles = sogFileSlots(means, "means", 2);
  const scalesFiles = sogFileSlots(scales, "scales", 1);
  const quatFiles = sogFileSlots(quats, "quats", 1);
  const sh0Files = sogFileSlots(sh0, "sh0", 1);
  const perGaussianFiles = [...meansFiles, ...scalesFiles, ...quatFiles, ...sh0Files];
  let shNCentroids: SogImagePlan["shNCentroids"];
  if (meta.shN !== undefined) {
    if (!isRecord(meta.shN)) {
      return fail("invalid", "SOG meta.json shN must be an object when present.");
    }
    const shNFiles = sogFileSlots(meta.shN, "shN", 2);
    const paletteCount = meta.shN.count;
    const bands = meta.shN.bands;
    if (!Number.isSafeInteger(paletteCount) || typeof paletteCount !== "number" || paletteCount < 1 || paletteCount > 65_536) {
      return fail("invalid", "SOG meta.json shN.count must be an integer from 1 through 65536.");
    }
    if (bands !== 1 && bands !== 2 && bands !== 3) {
      return fail("invalid", "SOG meta.json shN.bands must be the integer 1, 2, or 3.");
    }
    finiteNumberArray(meta.shN.codebook, 256, "shN.codebook");
    const centroidFile = shNFiles[0];
    const labelFile = shNFiles[1];
    if (centroidFile === undefined || labelFile === undefined) {
      return fail("invalid", "SOG meta.json shN.files is incomplete.");
    }
    shNCentroids = { file: centroidFile, paletteCount, bands };
    perGaussianFiles.push(labelFile);
  }

  const referencedFiles = [
    ...perGaussianFiles,
    ...(shNCentroids === undefined ? [] : [shNCentroids.file]),
  ];
  if (new Set(referencedFiles).size !== referencedFiles.length) {
    return fail("invalid", "SOG meta.json references a WebP member more than once.");
  }
  return { referencedFiles, perGaussianFiles, shNCentroids };
}

async function validateSog(
  handle: FileHandle,
  fileSize: number,
  expectedCount: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const members = await parseZipMembers(handle, fileSize);
  const byName = new Map(members.map((member) => [member.name, member] as const));
  const metaMember = byName.get("meta.json");
  if (metaMember === undefined) return fail("invalid", "SOG ZIP must contain exactly one meta.json member.");
  let meta: unknown;
  try {
    const bytes = await readSogMeta(handle, metaMember);
    meta = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error: unknown) {
    if (error instanceof Lcc2ContainerValidationError) throw error;
    return fail("invalid", "SOG meta.json must be valid UTF-8 JSON.", error);
  }
  if (!isRecord(meta) || meta.version !== 2 || !Number.isSafeInteger(meta.count) || typeof meta.count !== "number" || meta.count < 1) {
    return fail("unsupported", "Only bounded SOG v2 metadata with a positive count is supported.");
  }
  if (meta.count !== expectedCount) {
    return fail(
      "count_mismatch",
      `SOG embeds ${String(meta.count)} Gaussians but the LCC2 manifest assigns ${String(expectedCount)}.`,
    );
  }
  const imagePlan = sogImagePlan(meta);
  if (members.length !== imagePlan.referencedFiles.length + 1) {
    return fail("invalid", "SOG ZIP members must exactly match the files referenced by meta.json.");
  }
  const dimensionsByName = new Map<string, WebpDimensions>();
  for (const name of imagePlan.referencedFiles) {
    assertNotCancelled(signal);
    const member = byName.get(name);
    if (member === undefined) return fail("invalid", `SOG meta.json references missing member ${name}.`);
    if (
      member.method !== 0 ||
      member.compressedSize !== member.uncompressedSize ||
      member.uncompressedSize < 12 ||
      member.uncompressedSize > FOUNDRY_WEBP_MAX_BYTES
    ) {
      return fail("unsupported", `SOG WebP member ${name} must use the observed stored-WebP layout.`);
    }
    const bytes = await readExact(handle, member.uncompressedSize, member.dataOffset, `SOG WebP member ${name}`);
    assertNotCancelled(signal);
    if (crc32(bytes) !== member.crc32) {
      return fail("invalid", `SOG member ${name} fails its ZIP CRC check.`);
    }
    try {
      dimensionsByName.set(name, await inspectWebpBytes(bytes, member.uncompressedSize));
    } catch (error: unknown) {
      return fail("invalid", `SOG member ${name} is not a completely decodable WebP image.`, error);
    }
    assertNotCancelled(signal);
  }

  const firstPerGaussian = imagePlan.perGaussianFiles[0];
  const expectedDimensions = firstPerGaussian === undefined
    ? undefined
    : dimensionsByName.get(firstPerGaussian);
  if (expectedDimensions === undefined) {
    return fail("invalid", "SOG does not contain a usable per-Gaussian image set.");
  }
  for (const name of imagePlan.perGaussianFiles) {
    const dimensions = dimensionsByName.get(name);
    if (
      dimensions === undefined ||
      dimensions.width !== expectedDimensions.width ||
      dimensions.height !== expectedDimensions.height
    ) {
      return fail("invalid", "Every per-Gaussian SOG image must have the same dimensions.");
    }
  }
  if (expectedDimensions.width * expectedDimensions.height < meta.count) {
    return fail(
      "invalid",
      `SOG images provide fewer pixels than the declared ${String(meta.count)} Gaussians.`,
    );
  }
  if (imagePlan.shNCentroids !== undefined) {
    const centroidDimensions = dimensionsByName.get(imagePlan.shNCentroids.file);
    const coefficients = [3, 8, 15][imagePlan.shNCentroids.bands - 1];
    if (centroidDimensions === undefined || coefficients === undefined) {
      return fail("invalid", "SOG shN centroid image is missing.");
    }
    const expectedWidth = 64 * coefficients;
    const expectedHeight = Math.ceil(imagePlan.shNCentroids.paletteCount / 64);
    if (
      centroidDimensions.width !== expectedWidth ||
      centroidDimensions.height !== expectedHeight
    ) {
      return fail(
        "invalid",
        `SOG shN centroid image must be ${String(expectedWidth)}x${String(expectedHeight)} pixels.`,
      );
    }
  }
}

function spzBytesPerSplat(version: number, shDegree: number, flags: number): number {
  const shBytes = [0, 9, 24, 45][shDegree];
  if (shBytes === undefined) return fail("unsupported", `Unsupported SPZ spherical-harmonic degree ${String(shDegree)}.`);
  const positionBytes = version === 1 ? 6 : 9;
  const quaternionBytes = version === 3 ? 4 : 3;
  return positionBytes + 1 + 3 + 3 + quaternionBytes + shBytes + ((flags & 0x80) !== 0 ? 6 : 0);
}

async function validateSpz(
  handle: FileHandle,
  fileSize: number,
  expectedCount: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (fileSize < 18) return fail("invalid", "SPZ file is too short to contain a gzip stream and SPZ header.");
  const gzipMagic = await readExact(handle, 2, 0, "SPZ gzip header");
  if (gzipMagic[0] !== 0x1f || gzipMagic[1] !== 0x8b) {
    return fail("unsupported", "Only the observed gzip-compressed SPZ versions 1 through 3 are supported.");
  }
  // Stream explicit-position reads through the identity-checked FileHandle.
  // This neither reopens the path nor gives a ReadStream ownership of the
  // descriptor, avoiding both replacement races and accidental handle close.
  const compressed = Readable.from(readHandleChunks(handle, fileSize, signal), {
    objectMode: false,
  });
  const gunzip = createGunzip();
  // Readable.pipe does not forward source errors to its destination. Forward
  // them explicitly so an AbortError is observed by the async iterator and
  // converted to the worker's structured cancellation result instead of
  // becoming an unhandled process error.
  compressed.on("error", (error: Error) => {
    gunzip.destroy(error);
  });
  compressed.pipe(gunzip);
  const header = Buffer.alloc(SPZ_HEADER_BYTES);
  let headerBytes = 0;
  let totalBytes = 0;
  let expectedBytes: number | undefined;
  try {
    for await (const value of gunzip) {
      assertNotCancelled(signal);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      if (headerBytes < header.length) {
        const copied = Math.min(header.length - headerBytes, chunk.length);
        chunk.copy(header, headerBytes, 0, copied);
        headerBytes += copied;
      }
      totalBytes += chunk.length;
      if (headerBytes === header.length && expectedBytes === undefined) {
        if (header.readUInt32LE(0) !== SPZ_MAGIC) return fail("invalid", "SPZ header magic is invalid.");
        const version = header.readUInt32LE(4);
        const count = header.readUInt32LE(8);
        const shDegree = header.readUInt8(12);
        const fractionalBits = header.readUInt8(13);
        const flags = header.readUInt8(14);
        const reserved = header.readUInt8(15);
        if (version < 1 || version > 3) {
          return fail("unsupported", `Unsupported legacy SPZ version ${String(version)}.`);
        }
        if (count !== expectedCount) {
          return fail(
            "count_mismatch",
            `SPZ embeds ${String(count)} Gaussians but the LCC2 manifest assigns ${String(expectedCount)}.`,
          );
        }
        if (shDegree > 3 || fractionalBits > 24 || (flags & ~SPZ_ALLOWED_FLAGS) !== 0 || reserved !== 0) {
          return fail("invalid", "SPZ header contains unsupported degree, precision, flags, or reserved data.");
        }
        expectedBytes = SPZ_HEADER_BYTES + count * spzBytesPerSplat(version, shDegree, flags);
        if (!Number.isSafeInteger(expectedBytes) || expectedBytes > MAX_SPZ_UNCOMPRESSED_BYTES) {
          return fail("unsupported", "SPZ decompressed size exceeds the bounded validator limit.");
        }
      }
      if (expectedBytes !== undefined && totalBytes > expectedBytes) {
        return fail("invalid", "SPZ decompressed payload is longer than its header declares.");
      }
    }
  } catch (error: unknown) {
    if (error instanceof Lcc2ContainerValidationError) throw error;
    if (signal?.aborted === true) return fail("cancelled", "SPZ validation was cancelled.", error);
    return fail("invalid", "SPZ gzip stream is malformed or fails its integrity check.", error);
  } finally {
    compressed.unpipe(gunzip);
    compressed.destroy();
    gunzip.destroy();
  }
  if (headerBytes !== header.length || expectedBytes === undefined || totalBytes !== expectedBytes) {
    return fail("invalid", "SPZ decompressed payload length does not match its header.");
  }
}

export async function validateLcc2Container(options: ValidateLcc2ContainerOptions): Promise<void> {
  assertNotCancelled(options.signal);
  let handle: FileHandle;
  try {
    handle = await open(options.absolutePath, "r");
  } catch (error: unknown) {
    return fail("source_changed", `Cannot open declared LCC2 member ${options.relativePath}.`, error);
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      !sameIdentity(identityFromStats(before), options.expectedIdentity)
    ) {
      return fail("source_changed", `Declared LCC2 member changed before validation: ${options.relativePath}.`);
    }
    if (options.splatType === ".sog") {
      await validateSog(handle, before.size, options.expectedGaussianCount, options.signal);
    } else {
      await validateSpz(
        handle,
        before.size,
        options.expectedGaussianCount,
        options.signal,
      );
    }
    assertNotCancelled(options.signal);
    const after = await handle.stat();
    const pathAfter = await lstat(options.absolutePath);
    if (
      !after.isFile() ||
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      pathAfter.nlink !== 1 ||
      !sameIdentity(options.expectedIdentity, identityFromStats(after)) ||
      !sameIdentity(identityFromStats(after), identityFromStats(pathAfter))
    ) {
      return fail("source_changed", `Declared LCC2 member changed during validation: ${options.relativePath}.`);
    }
  } catch (error: unknown) {
    if (error instanceof Lcc2ContainerValidationError) throw error;
    return fail("source_changed", `Declared LCC2 member became unavailable during validation: ${options.relativePath}.`, error);
  } finally {
    await handle.close();
  }
}

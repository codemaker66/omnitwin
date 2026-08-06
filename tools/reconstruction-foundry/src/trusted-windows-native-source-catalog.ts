import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Process-private decoder for the native helper's VNSHCAT1 source catalogue.
 *
 * This module is intentionally absent from every package barrel. Catalogue
 * bytes, names, identities, references, and digests must remain inside the
 * trusted local controller.
 */

export const TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1 = 80;
export const TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_RECORD_HEADER_BYTES_V1 = 40;
export const TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_MAX_ENCODED_BYTES_V1 =
  80 * 1_024 * 1_024;

const MAX_FILES = 100_000;
const MAX_RECORDS = 200_000;
const MAX_COMPONENTS = 1_024;
const MAX_COMPONENT_UNITS = 255;
const MAX_PATH_UNITS = 32_767;
const FILE_TRAILER_BYTES = 24;
const REFERENCE_SUFFIX_BYTES = 16;
const MODELED_RECORD_BYTES = 128;
const MODELED_COMPONENT_BYTES = 64;
const MODELED_ALIGNMENT_BYTES = 16;
const SOURCE_FILE_REFERENCE_PREFIX = "helper_source_file_";

const MAGIC = Buffer.from("VNSHCAT1", "ascii");
const LAYOUT_DIGEST_DOMAIN = Buffer.from("VNSH-LAYOUT-V1\0", "ascii");
const VERSION = 1;
const SOURCE_KIND_FILE = 1;
const SOURCE_KIND_FOLDER = 2;
const RECORD_KIND_DIRECTORY = 1;
const RECORD_KIND_FILE = 2;

const VERSION_OFFSET = 8;
const HEADER_SIZE_OFFSET = 10;
const SOURCE_KIND_OFFSET = 12;
const HEADER_RESERVED_U24_OFFSET = 13;
const DIRECTORY_COUNT_OFFSET = 16;
const FILE_COUNT_OFFSET = 20;
const RECORD_COUNT_OFFSET = 24;
const HEADER_RESERVED_U32_OFFSET = 28;
const TOTAL_ENCODED_BYTES_OFFSET = 32;
const LAYOUT_SHA256_OFFSET = 40;
const HEADER_RESERVED_U64_OFFSET = 72;

const RECORD_KIND_OFFSET = 0;
const RECORD_FLAGS_OFFSET = 1;
const RECORD_HEADER_SIZE_OFFSET = 2;
const RECORD_LENGTH_OFFSET = 4;
const RECORD_VOLUME_OFFSET = 8;
const RECORD_FILE_ID_OFFSET = 16;
const RECORD_COMPONENT_COUNT_OFFSET = 32;
const RECORD_RESERVED_U32_OFFSET = 36;

const NODE_INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");
const TYPED_ARRAY_BUFFER_GETTER = captureTypedArrayGetter("buffer");
const TYPED_ARRAY_BYTE_LENGTH_GETTER = captureTypedArrayGetter("byteLength");
const TYPED_ARRAY_BYTE_OFFSET_GETTER = captureTypedArrayGetter("byteOffset");
const TYPED_ARRAY_TAG_GETTER = captureTypedArrayGetter(Symbol.toStringTag);

export type TrustedWindowsNativeSourceCatalogErrorCodeV1 =
  | "INVALID_INPUT"
  | "TOO_SHORT"
  | "TOO_LARGE"
  | "INVALID_MAGIC"
  | "INVALID_VERSION"
  | "INVALID_HEADER_SIZE"
  | "INVALID_SOURCE_KIND"
  | "NONZERO_RESERVED"
  | "INVALID_COUNTS"
  | "INVALID_ENCODED_LENGTH"
  | "TRUNCATED"
  | "INVALID_RECORD_KIND"
  | "INVALID_RECORD_FLAGS"
  | "INVALID_RECORD_HEADER_SIZE"
  | "INVALID_RECORD_LENGTH"
  | "INVALID_RECORD_ORDER"
  | "DUPLICATE_IDENTITY"
  | "INVALID_COMPONENT"
  | "INVALID_FILE_REFERENCE"
  | "DUPLICATE_FILE_REFERENCE"
  | "LAYOUT_DIGEST_MISMATCH"
  | "ARITHMETIC_OVERFLOW"
  | "CATALOG_DESTROYED";

export class TrustedWindowsNativeSourceCatalogErrorV1 extends Error {
  readonly code: TrustedWindowsNativeSourceCatalogErrorCodeV1;

  constructor(code: TrustedWindowsNativeSourceCatalogErrorCodeV1) {
    super(`Trusted Windows native source catalog rejected: ${code}`);
    this.name = "TrustedWindowsNativeSourceCatalogErrorV1";
    this.code = code;
  }
}

const INTERNAL_CATALOG_ERRORS = new WeakMap<
  object,
  TrustedWindowsNativeSourceCatalogErrorCodeV1
>();

export interface TrustedWindowsNativeRawUtf16ComponentV1 {
  readonly unitCount: number;
  readonly destroyed: boolean;
  /** Catalogue-owned process-private view. Do not mutate or retain after destroy(). */
  privateUnitsView(): Readonly<Uint16Array>;
}

export interface TrustedWindowsNativeSourceCatalogRecordV1 {
  readonly kind: "directory" | "file";
  readonly volumeSerialNumber: bigint;
  readonly componentCount: number;
  readonly expectedSize: bigint | null;
  readonly sourceFileRef: string | null;
  readonly destroyed: boolean;
  /** Catalogue-owned process-private view. Do not mutate or retain after destroy(). */
  privateFileIdView(): Readonly<Uint8Array>;
  /** Catalogue-owned process-private view. Do not mutate or retain after destroy(). */
  privateSourceFileReferenceSuffixView(): Readonly<Uint8Array> | null;
  componentAt(index: number): TrustedWindowsNativeRawUtf16ComponentV1;
}

export interface TrustedWindowsNativeSourceCatalogV1 {
  readonly sourceKind: "file" | "folder";
  readonly directoryCount: number;
  readonly fileCount: number;
  readonly recordCount: number;
  readonly totalEncodedBytes: bigint;
  readonly modeledMemoryBytes: number;
  readonly destroyed: boolean;
  records(): readonly TrustedWindowsNativeSourceCatalogRecordV1[];
  /** Catalogue-owned process-private view. Do not mutate or retain after destroy(). */
  privateEncodedBytesView(): Readonly<Uint8Array>;
  /** Catalogue-owned process-private view. Do not mutate or retain after destroy(). */
  privateLayoutSha256View(): Readonly<Uint8Array>;
  /** Catalogue-owned process-private view. Do not mutate or retain after destroy(). */
  privateCatalogSha256View(): Readonly<Uint8Array>;
  /** Wipes all catalogue-owned bytes and invalidates private accessors. Idempotent. */
  destroy(): void;
}

interface IntrinsicUint8ArrayWindow {
  readonly buffer: ArrayBufferLike;
  readonly byteLength: number;
  readonly byteOffset: number;
}

interface HeaderFields {
  readonly sourceKindWire: typeof SOURCE_KIND_FILE | typeof SOURCE_KIND_FOLDER;
  readonly directoryCount: number;
  readonly fileCount: number;
  readonly recordCount: number;
  readonly totalEncodedBytes: bigint;
}

interface CanonicalRecordKey {
  readonly kind: typeof RECORD_KIND_DIRECTORY | typeof RECORD_KIND_FILE;
  readonly volume: bigint;
  readonly fileId: Buffer;
}

interface ParsedRecord {
  readonly record: DecodedSourceCatalogRecord;
  readonly nextOffset: number;
  readonly key: CanonicalRecordKey;
  readonly identityKey: string;
  readonly referenceKey: string | null;
  readonly modeledMemoryBytes: number;
  readonly isRoot: boolean;
}

interface CatalogSummary {
  readonly sourceKind: "file" | "folder";
  readonly directoryCount: number;
  readonly fileCount: number;
  readonly recordCount: number;
  readonly totalEncodedBytes: string;
  readonly destroyed: boolean;
}

interface RecordSummary {
  readonly kind: "directory" | "file";
  readonly componentCount: number;
  readonly hasExpectedSize: boolean;
  readonly hasSourceFileReference: boolean;
  readonly destroyed: boolean;
}

interface ComponentSummary {
  readonly unitCount: number;
  readonly destroyed: boolean;
}

const EMPTY_RECORDS: readonly TrustedWindowsNativeSourceCatalogRecordV1[] = Object.freeze([]);

class DecodedRawUtf16Component implements TrustedWindowsNativeRawUtf16ComponentV1 {
  readonly #units: Uint16Array;
  #destroyed = false;

  constructor(units: Uint16Array) {
    this.#units = units;
    attachRedactedRepresentations(this, () => this.#summary());
    Object.freeze(this);
  }

  get unitCount(): number {
    return this.#units.length;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  privateUnitsView(): Readonly<Uint16Array> {
    this.#assertLive();
    return this.#units;
  }

  destroyInternal(): void {
    if (this.#destroyed) return;
    this.#units.fill(0);
    this.#destroyed = true;
  }

  #assertLive(): void {
    if (this.#destroyed) throw catalogError("CATALOG_DESTROYED");
  }

  #summary(): ComponentSummary {
    return Object.freeze({
      unitCount: this.#units.length,
      destroyed: this.#destroyed,
    });
  }
}

class DecodedSourceCatalogRecord implements TrustedWindowsNativeSourceCatalogRecordV1 {
  readonly #kind: "directory" | "file";
  readonly #volumeSerialNumber: bigint;
  readonly #fileId: Buffer;
  readonly #components: readonly DecodedRawUtf16Component[];
  readonly #expectedSize: bigint | null;
  readonly #referenceSuffix: Buffer | null;
  #destroyed = false;

  constructor(input: {
    readonly kind: "directory" | "file";
    readonly volumeSerialNumber: bigint;
    readonly fileId: Buffer;
    readonly components: readonly DecodedRawUtf16Component[];
    readonly expectedSize: bigint | null;
    readonly referenceSuffix: Buffer | null;
  }) {
    this.#kind = input.kind;
    this.#volumeSerialNumber = input.volumeSerialNumber;
    this.#fileId = input.fileId;
    this.#components = Object.freeze([...input.components]);
    this.#expectedSize = input.expectedSize;
    this.#referenceSuffix = input.referenceSuffix;
    attachRedactedRepresentations(this, () => this.#summary());
    Object.freeze(this);
  }

  get kind(): "directory" | "file" {
    return this.#kind;
  }

  get volumeSerialNumber(): bigint {
    this.#assertLive();
    return this.#volumeSerialNumber;
  }

  get componentCount(): number {
    return this.#components.length;
  }

  get expectedSize(): bigint | null {
    this.#assertLive();
    return this.#expectedSize;
  }

  get sourceFileRef(): string | null {
    this.#assertLive();
    return this.#referenceSuffix === null
      ? null
      : `${SOURCE_FILE_REFERENCE_PREFIX}${this.#referenceSuffix.toString("hex")}`;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  privateFileIdView(): Readonly<Uint8Array> {
    this.#assertLive();
    return this.#fileId;
  }

  privateSourceFileReferenceSuffixView(): Readonly<Uint8Array> | null {
    this.#assertLive();
    return this.#referenceSuffix;
  }

  componentAt(index: number): TrustedWindowsNativeRawUtf16ComponentV1 {
    this.#assertLive();
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.#components.length) {
      throw catalogError("INVALID_INPUT");
    }
    const component = this.#components[index];
    if (component === undefined) throw catalogError("INVALID_INPUT");
    return component;
  }

  destroyInternal(): void {
    if (this.#destroyed) return;
    this.#fileId.fill(0);
    this.#referenceSuffix?.fill(0);
    for (const component of this.#components) component.destroyInternal();
    this.#destroyed = true;
  }

  #assertLive(): void {
    if (this.#destroyed) throw catalogError("CATALOG_DESTROYED");
  }

  #summary(): RecordSummary {
    return Object.freeze({
      kind: this.#kind,
      componentCount: this.#components.length,
      hasExpectedSize: this.#expectedSize !== null,
      hasSourceFileReference: this.#referenceSuffix !== null,
      destroyed: this.#destroyed,
    });
  }
}

class DecodedSourceCatalog implements TrustedWindowsNativeSourceCatalogV1 {
  readonly #sourceKind: "file" | "folder";
  readonly #directoryCount: number;
  readonly #fileCount: number;
  readonly #recordCount: number;
  readonly #totalEncodedBytes: bigint;
  readonly #modeledMemoryBytes: number;
  readonly #encodedBytes: Buffer;
  readonly #layoutSha256: Buffer;
  readonly #catalogSha256: Buffer;
  #records: readonly DecodedSourceCatalogRecord[];
  #destroyed = false;

  constructor(input: {
    readonly sourceKind: "file" | "folder";
    readonly directoryCount: number;
    readonly fileCount: number;
    readonly recordCount: number;
    readonly totalEncodedBytes: bigint;
    readonly modeledMemoryBytes: number;
    readonly encodedBytes: Buffer;
    readonly layoutSha256: Buffer;
    readonly catalogSha256: Buffer;
    readonly records: readonly DecodedSourceCatalogRecord[];
  }) {
    this.#sourceKind = input.sourceKind;
    this.#directoryCount = input.directoryCount;
    this.#fileCount = input.fileCount;
    this.#recordCount = input.recordCount;
    this.#totalEncodedBytes = input.totalEncodedBytes;
    this.#modeledMemoryBytes = input.modeledMemoryBytes;
    this.#encodedBytes = input.encodedBytes;
    this.#layoutSha256 = input.layoutSha256;
    this.#catalogSha256 = input.catalogSha256;
    this.#records = Object.freeze([...input.records]);
    attachRedactedRepresentations(this, () => this.#summary());
    Object.freeze(this);
  }

  get sourceKind(): "file" | "folder" {
    return this.#sourceKind;
  }

  get directoryCount(): number {
    return this.#directoryCount;
  }

  get fileCount(): number {
    return this.#fileCount;
  }

  get recordCount(): number {
    return this.#recordCount;
  }

  get totalEncodedBytes(): bigint {
    return this.#totalEncodedBytes;
  }

  get modeledMemoryBytes(): number {
    return this.#modeledMemoryBytes;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  records(): readonly TrustedWindowsNativeSourceCatalogRecordV1[] {
    return this.#destroyed ? EMPTY_RECORDS : this.#records;
  }

  privateEncodedBytesView(): Readonly<Uint8Array> {
    this.#assertLive();
    return this.#encodedBytes;
  }

  privateLayoutSha256View(): Readonly<Uint8Array> {
    this.#assertLive();
    return this.#layoutSha256;
  }

  privateCatalogSha256View(): Readonly<Uint8Array> {
    this.#assertLive();
    return this.#catalogSha256;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#encodedBytes.fill(0);
    this.#layoutSha256.fill(0);
    this.#catalogSha256.fill(0);
    for (const record of this.#records) record.destroyInternal();
    this.#records = Object.freeze([]);
    this.#destroyed = true;
  }

  #assertLive(): void {
    if (this.#destroyed) throw catalogError("CATALOG_DESTROYED");
  }

  #summary(): CatalogSummary {
    return Object.freeze({
      sourceKind: this.#sourceKind,
      directoryCount: this.#directoryCount,
      fileCount: this.#fileCount,
      recordCount: this.#recordCount,
      totalEncodedBytes: this.#totalEncodedBytes.toString(10),
      destroyed: this.#destroyed,
    });
  }
}

export function decodeTrustedWindowsNativeSourceCatalogV1(
  bytes: Uint8Array,
): TrustedWindowsNativeSourceCatalogV1;
export function decodeTrustedWindowsNativeSourceCatalogV1(
  bytes: unknown,
): TrustedWindowsNativeSourceCatalogV1 {
  return withSafeCatalogErrors(() => {
    const ownedBytes = copyBoundedCatalog(bytes);
    try {
      return parseOwnedCatalog(ownedBytes);
    } catch (error: unknown) {
      ownedBytes.fill(0);
      throw error;
    }
  });
}

function parseOwnedCatalog(bytes: Buffer): TrustedWindowsNativeSourceCatalogV1 {
  const header = decodeHeader(bytes);
  const sourceKind = header.sourceKindWire === SOURCE_KIND_FILE ? "file" : "folder";
  const records: DecodedSourceCatalogRecord[] = [];
  let layoutSha256: Buffer | null = null;
  let catalogSha256: Buffer | null = null;
  try {
    const result = parseRecords(bytes, header, records);
    layoutSha256 = result.layoutSha256;
    catalogSha256 = createHash("sha256").update(bytes).digest();
    return new DecodedSourceCatalog({
      sourceKind,
      directoryCount: header.directoryCount,
      fileCount: header.fileCount,
      recordCount: header.recordCount,
      totalEncodedBytes: header.totalEncodedBytes,
      modeledMemoryBytes: result.modeledMemoryBytes,
      encodedBytes: bytes,
      layoutSha256,
      catalogSha256,
      records,
    });
  } catch (error: unknown) {
    for (const record of records) record.destroyInternal();
    layoutSha256?.fill(0);
    catalogSha256?.fill(0);
    throw error;
  }
}

function decodeHeader(bytes: Buffer): HeaderFields {
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) fail("INVALID_MAGIC");
  if (bytes.readUInt16BE(VERSION_OFFSET) !== VERSION) fail("INVALID_VERSION");
  if (
    bytes.readUInt16BE(HEADER_SIZE_OFFSET) !==
    TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1
  ) {
    fail("INVALID_HEADER_SIZE");
  }
  const sourceKindWire = decodeSourceKind(bytes[SOURCE_KIND_OFFSET]);
  if (
    hasNonzero(bytes, HEADER_RESERVED_U24_OFFSET, DIRECTORY_COUNT_OFFSET) ||
    bytes.readUInt32BE(HEADER_RESERVED_U32_OFFSET) !== 0 ||
    hasNonzero(
      bytes,
      HEADER_RESERVED_U64_OFFSET,
      TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1,
    )
  ) {
    fail("NONZERO_RESERVED");
  }
  const directoryCount = bytes.readUInt32BE(DIRECTORY_COUNT_OFFSET);
  const fileCount = bytes.readUInt32BE(FILE_COUNT_OFFSET);
  const recordCount = bytes.readUInt32BE(RECORD_COUNT_OFFSET);
  validateCounts(sourceKindWire, directoryCount, fileCount, recordCount);
  const totalEncodedBytes = bytes.readBigUInt64BE(TOTAL_ENCODED_BYTES_OFFSET);
  if (
    totalEncodedBytes > BigInt(TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_MAX_ENCODED_BYTES_V1) ||
    totalEncodedBytes !== BigInt(bytes.byteLength)
  ) {
    fail("INVALID_ENCODED_LENGTH");
  }
  return { sourceKindWire, directoryCount, fileCount, recordCount, totalEncodedBytes };
}

function parseRecords(
  bytes: Buffer,
  header: HeaderFields,
  records: DecodedSourceCatalogRecord[],
): { readonly layoutSha256: Buffer; readonly modeledMemoryBytes: number } {
  const layoutHash = createLayoutHash(bytes);
  const identities = new Set<string>();
  const references = new Set<string>();
  let previousKey: CanonicalRecordKey | null = null;
  let cursor = TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1;
  let directories = 0;
  let files = 0;
  let roots = 0;
  let modeledMemoryBytes = 0;

  for (let index = 0; index < header.recordCount; index += 1) {
    const parsed = decodeRecord(bytes, cursor, header.sourceKindWire, layoutHash);
    validateRecordIdentity(parsed, previousKey, identities, references);
    previousKey = parsed.key;
    directories += parsed.record.kind === "directory" ? 1 : 0;
    files += parsed.record.kind === "file" ? 1 : 0;
    roots += parsed.isRoot ? 1 : 0;
    modeledMemoryBytes = checkedAdd(modeledMemoryBytes, parsed.modeledMemoryBytes);
    if (modeledMemoryBytes > TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_MAX_ENCODED_BYTES_V1) {
      parsed.record.destroyInternal();
      fail("TOO_LARGE");
    }
    records.push(parsed.record);
    cursor = parsed.nextOffset;
  }
  validateObservedCatalog(bytes, header, cursor, directories, files, roots, references.size);
  const observedLayoutSha256 = layoutHash.digest();
  const expectedLayoutSha256 = bytes.subarray(LAYOUT_SHA256_OFFSET, HEADER_RESERVED_U64_OFFSET);
  if (!timingSafeEqual(observedLayoutSha256, expectedLayoutSha256)) {
    observedLayoutSha256.fill(0);
    fail("LAYOUT_DIGEST_MISMATCH");
  }
  return { layoutSha256: observedLayoutSha256, modeledMemoryBytes };
}

function decodeRecord(
  bytes: Buffer,
  offset: number,
  sourceKind: typeof SOURCE_KIND_FILE | typeof SOURCE_KIND_FOLDER,
  layoutHash: ReturnType<typeof createHash>,
): ParsedRecord {
  const headerEnd = checkedAdd(offset, TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_RECORD_HEADER_BYTES_V1);
  if (headerEnd > bytes.byteLength) fail("TRUNCATED");
  const wireKind = decodeRecordKind(bytes[offset + RECORD_KIND_OFFSET]);
  validateRecordHeader(bytes, offset, wireKind);
  const recordLength = bytes.readUInt32BE(offset + RECORD_LENGTH_OFFSET);
  const recordEnd = checkedAdd(offset, recordLength);
  if (recordEnd > bytes.byteLength) fail("TRUNCATED");
  const componentCount = bytes.readUInt32BE(offset + RECORD_COMPONENT_COUNT_OFFSET);
  validateComponentTopology(wireKind, sourceKind, componentCount);
  const trailerBytes = wireKind === RECORD_KIND_FILE ? FILE_TRAILER_BYTES : 0;
  const payloadEnd = recordEnd - trailerBytes;
  if (payloadEnd < headerEnd) fail("INVALID_RECORD_LENGTH");
  return decodeRecordPayload({
    bytes,
    offset,
    headerEnd,
    payloadEnd,
    recordEnd,
    componentCount,
    wireKind,
    layoutHash,
  });
}

function decodeRecordPayload(input: {
  readonly bytes: Buffer;
  readonly offset: number;
  readonly headerEnd: number;
  readonly payloadEnd: number;
  readonly recordEnd: number;
  readonly componentCount: number;
  readonly wireKind: typeof RECORD_KIND_DIRECTORY | typeof RECORD_KIND_FILE;
  readonly layoutHash: ReturnType<typeof createHash>;
}): ParsedRecord {
  let fileId: Buffer | null = null;
  let referenceSuffix: Buffer | null = null;
  const components: DecodedRawUtf16Component[] = [];
  let record: DecodedSourceCatalogRecord | null = null;
  try {
    fileId = Buffer.from(input.bytes.subarray(
      input.offset + RECORD_FILE_ID_OFFSET,
      input.offset + RECORD_FILE_ID_OFFSET + 16,
    ));
    const decodedComponents = decodeComponents(input, components);
    const volume = input.bytes.readBigUInt64BE(input.offset + RECORD_VOLUME_OFFSET);
    const expectedSize = input.wireKind === RECORD_KIND_FILE
      ? input.bytes.readBigUInt64BE(input.payloadEnd)
      : null;
    referenceSuffix = input.wireKind === RECORD_KIND_FILE
      ? decodeReferenceSuffix(input.bytes, input.payloadEnd + 8)
      : null;
    record = new DecodedSourceCatalogRecord({
      kind: input.wireKind === RECORD_KIND_DIRECTORY ? "directory" : "file",
      volumeSerialNumber: volume,
      fileId,
      components,
      expectedSize,
      referenceSuffix,
    });
    updateLayoutHash(input, decodedComponents.digestRanges);
    return {
      record,
      nextOffset: input.recordEnd,
      key: { kind: input.wireKind, volume, fileId },
      identityKey: `${volume.toString(16)}:${fileId.toString("hex")}`,
      referenceKey: referenceSuffix?.toString("hex") ?? null,
      modeledMemoryBytes: decodedComponents.modeledMemoryBytes,
      isRoot: input.componentCount === 0,
    };
  } catch (error: unknown) {
    if (record !== null) record.destroyInternal();
    else {
      fileId?.fill(0);
      referenceSuffix?.fill(0);
      for (const component of components) component.destroyInternal();
    }
    throw error;
  }
}

function decodeComponents(
  input: {
    readonly bytes: Buffer;
    readonly headerEnd: number;
    readonly payloadEnd: number;
    readonly componentCount: number;
  },
  components: DecodedRawUtf16Component[],
): {
  readonly digestRanges: readonly (readonly [number, number])[];
  readonly modeledMemoryBytes: number;
} {
  const digestRanges: (readonly [number, number])[] = [];
  let cursor = input.headerEnd;
  let pathUnits = Math.max(0, input.componentCount - 1);
  let modeledMemoryBytes = MODELED_RECORD_BYTES;
  for (let index = 0; index < input.componentCount; index += 1) {
    const lengthOffset = cursor;
    if (checkedAdd(cursor, 4) > input.payloadEnd) fail("TRUNCATED");
    const unitCount = input.bytes.readUInt32BE(cursor);
    cursor += 4;
    if (unitCount === 0 || unitCount > MAX_COMPONENT_UNITS) fail("INVALID_COMPONENT");
    pathUnits = checkedAdd(pathUnits, unitCount);
    if (pathUnits > MAX_PATH_UNITS) fail("INVALID_COMPONENT");
    const componentEnd = checkedAdd(cursor, checkedMultiply(unitCount, 2));
    if (componentEnd > input.payloadEnd) fail("TRUNCATED");
    const units = decodeRawUtf16Units(input.bytes, cursor, unitCount);
    validatePrivateComponent(units);
    components.push(new DecodedRawUtf16Component(units));
    modeledMemoryBytes = checkedAdd(
      modeledMemoryBytes,
      modeledComponentBytes(unitCount),
    );
    digestRanges.push([lengthOffset, componentEnd]);
    cursor = componentEnd;
  }
  if (cursor !== input.payloadEnd) fail("INVALID_RECORD_LENGTH");
  return { digestRanges, modeledMemoryBytes };
}

function validateRecordHeader(
  bytes: Buffer,
  offset: number,
  wireKind: typeof RECORD_KIND_DIRECTORY | typeof RECORD_KIND_FILE,
): void {
  if (bytes[offset + RECORD_FLAGS_OFFSET] !== 0) fail("INVALID_RECORD_FLAGS");
  if (
    bytes.readUInt16BE(offset + RECORD_HEADER_SIZE_OFFSET) !==
    TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_RECORD_HEADER_BYTES_V1
  ) {
    fail("INVALID_RECORD_HEADER_SIZE");
  }
  if (bytes.readUInt32BE(offset + RECORD_RESERVED_U32_OFFSET) !== 0) {
    fail("NONZERO_RESERVED");
  }
  const recordLength = bytes.readUInt32BE(offset + RECORD_LENGTH_OFFSET);
  const minimum = TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_RECORD_HEADER_BYTES_V1 +
    (wireKind === RECORD_KIND_FILE ? FILE_TRAILER_BYTES : 0);
  if (recordLength < minimum) fail("INVALID_RECORD_LENGTH");
}

function validateComponentTopology(
  wireKind: typeof RECORD_KIND_DIRECTORY | typeof RECORD_KIND_FILE,
  sourceKind: typeof SOURCE_KIND_FILE | typeof SOURCE_KIND_FOLDER,
  componentCount: number,
): void {
  if (componentCount > MAX_COMPONENTS) fail("INVALID_COMPONENT");
  if (wireKind === RECORD_KIND_FILE && componentCount === 0) fail("INVALID_COMPONENT");
  if (sourceKind === SOURCE_KIND_FILE && componentCount !== 1) fail("INVALID_COMPONENT");
  if (
    wireKind === RECORD_KIND_DIRECTORY &&
    componentCount === 0 &&
    sourceKind !== SOURCE_KIND_FOLDER
  ) {
    fail("INVALID_COMPONENT");
  }
}

function validateRecordIdentity(
  parsed: ParsedRecord,
  previousKey: CanonicalRecordKey | null,
  identities: Set<string>,
  references: Set<string>,
): void {
  if (previousKey !== null && compareRecordKeys(previousKey, parsed.key) >= 0) {
    parsed.record.destroyInternal();
    fail("INVALID_RECORD_ORDER");
  }
  if (identities.has(parsed.identityKey)) {
    parsed.record.destroyInternal();
    fail("DUPLICATE_IDENTITY");
  }
  identities.add(parsed.identityKey);
  if (parsed.referenceKey !== null) {
    if (references.has(parsed.referenceKey)) {
      parsed.record.destroyInternal();
      fail("DUPLICATE_FILE_REFERENCE");
    }
    references.add(parsed.referenceKey);
  }
}

function validateObservedCatalog(
  bytes: Buffer,
  header: HeaderFields,
  cursor: number,
  directories: number,
  files: number,
  roots: number,
  referenceCount: number,
): void {
  if (cursor !== bytes.byteLength) fail("INVALID_ENCODED_LENGTH");
  if (
    directories !== header.directoryCount ||
    files !== header.fileCount ||
    referenceCount !== header.fileCount ||
    (header.sourceKindWire === SOURCE_KIND_FILE ? roots !== 0 : roots !== 1)
  ) {
    fail("INVALID_COUNTS");
  }
}

function validateCounts(
  sourceKind: typeof SOURCE_KIND_FILE | typeof SOURCE_KIND_FOLDER,
  directoryCount: number,
  fileCount: number,
  recordCount: number,
): void {
  const expectedRecordCount = directoryCount + fileCount;
  if (expectedRecordCount > 0xffff_ffff) fail("ARITHMETIC_OVERFLOW");
  if (
    recordCount !== expectedRecordCount ||
    fileCount > MAX_FILES ||
    recordCount > MAX_RECORDS ||
    (sourceKind === SOURCE_KIND_FILE
      ? directoryCount !== 0 || fileCount !== 1
      : directoryCount === 0)
  ) {
    fail("INVALID_COUNTS");
  }
}

function validatePrivateComponent(units: Uint16Array): void {
  if (
    units.length === 0 ||
    units.length > MAX_COMPONENT_UNITS ||
    isDotComponent(units) ||
    hasTrailingDotOrSpace(units) ||
    units.some(isForbiddenComponentUnit) ||
    isReservedDosName(units)
  ) {
    units.fill(0);
    fail("INVALID_COMPONENT");
  }
}

function isDotComponent(units: Uint16Array): boolean {
  return units.length === 1 && units[0] === 0x002e ||
    units.length === 2 && units[0] === 0x002e && units[1] === 0x002e;
}

function hasTrailingDotOrSpace(units: Uint16Array): boolean {
  const last = units.at(-1);
  return last === 0x002e || last === 0x0020;
}

function isForbiddenComponentUnit(unit: number): boolean {
  return unit <= 0x001f ||
    unit === 0x007f ||
    unit === 0x0022 ||
    unit === 0x002a ||
    unit === 0x002f ||
    unit === 0x003a ||
    unit === 0x003c ||
    unit === 0x003e ||
    unit === 0x003f ||
    unit === 0x005c ||
    unit === 0x007c ||
    unit >= 0x202a && unit <= 0x202e ||
    unit >= 0x2066 && unit <= 0x2069;
}

function isReservedDosName(units: Uint16Array): boolean {
  const dotIndex = units.indexOf(0x002e);
  const stem = units.subarray(0, dotIndex < 0 ? units.length : dotIndex);
  for (const reserved of [
    [0x43, 0x4f, 0x4e],
    [0x50, 0x52, 0x4e],
    [0x41, 0x55, 0x58],
    [0x4e, 0x55, 0x4c],
    [0x43, 0x4c, 0x4f, 0x43, 0x4b, 0x24],
    [0x43, 0x4f, 0x4e, 0x49, 0x4e, 0x24],
    [0x43, 0x4f, 0x4e, 0x4f, 0x55, 0x54, 0x24],
  ] as const) {
    if (asciiUnitsEqualIgnoreCase(stem, reserved)) return true;
  }
  return hasReservedNumericSuffix(stem, [0x43, 0x4f, 0x4d]) ||
    hasReservedNumericSuffix(stem, [0x4c, 0x50, 0x54]);
}

function asciiUnitsEqualIgnoreCase(
  actual: Uint16Array,
  expected: readonly number[],
): boolean {
  return actual.length === expected.length && actual.every(
    (unit, index) => upperAscii(unit) === expected[index],
  );
}

function hasReservedNumericSuffix(
  units: Uint16Array,
  prefix: readonly [number, number, number],
): boolean {
  return units.length === 4 &&
    asciiUnitsEqualIgnoreCase(units.subarray(0, 3), prefix) &&
    isReservedNumericUnit(units[3]);
}

function isReservedNumericUnit(unit: number | undefined): boolean {
  return unit !== undefined && (unit >= 0x31 && unit <= 0x39 ||
    unit === 0x00b9 || unit === 0x00b2 || unit === 0x00b3);
}

function upperAscii(unit: number): number {
  return unit >= 0x61 && unit <= 0x7a ? unit - 0x20 : unit;
}

function createLayoutHash(bytes: Buffer): ReturnType<typeof createHash> {
  const hash = createHash("sha256");
  hash.update(LAYOUT_DIGEST_DOMAIN);
  hash.update(bytes.subarray(SOURCE_KIND_OFFSET, SOURCE_KIND_OFFSET + 1));
  hash.update(bytes.subarray(DIRECTORY_COUNT_OFFSET, RECORD_COUNT_OFFSET));
  return hash;
}

function updateLayoutHash(
  input: {
    readonly bytes: Buffer;
    readonly offset: number;
    readonly payloadEnd: number;
    readonly wireKind: typeof RECORD_KIND_DIRECTORY | typeof RECORD_KIND_FILE;
    readonly layoutHash: ReturnType<typeof createHash>;
  },
  componentRanges: readonly (readonly [number, number])[],
): void {
  input.layoutHash.update(input.bytes.subarray(input.offset, input.offset + 1));
  input.layoutHash.update(input.bytes.subarray(
    input.offset + RECORD_VOLUME_OFFSET,
    input.offset + RECORD_COMPONENT_COUNT_OFFSET,
  ));
  input.layoutHash.update(input.bytes.subarray(
    input.offset + RECORD_COMPONENT_COUNT_OFFSET,
    input.offset + RECORD_RESERVED_U32_OFFSET,
  ));
  for (const [start, end] of componentRanges) {
    input.layoutHash.update(input.bytes.subarray(start, end));
  }
  if (input.wireKind === RECORD_KIND_FILE) {
    input.layoutHash.update(input.bytes.subarray(input.payloadEnd, input.payloadEnd + 8));
  }
}

function decodeRawUtf16Units(bytes: Buffer, offset: number, unitCount: number): Uint16Array {
  const units = new Uint16Array(unitCount);
  for (let index = 0; index < unitCount; index += 1) {
    units[index] = bytes.readUInt16BE(offset + index * 2);
  }
  return units;
}

function decodeReferenceSuffix(bytes: Buffer, offset: number): Buffer {
  const end = checkedAdd(offset, REFERENCE_SUFFIX_BYTES);
  if (end > bytes.byteLength) fail("TRUNCATED");
  const suffix = Buffer.from(bytes.subarray(offset, end));
  if (suffix.every((byte) => byte === 0)) {
    suffix.fill(0);
    fail("INVALID_FILE_REFERENCE");
  }
  return suffix;
}

function modeledComponentBytes(unitCount: number): number {
  const rawBytes = checkedMultiply(unitCount, 2);
  const alignedBytes = Math.ceil(rawBytes / MODELED_ALIGNMENT_BYTES) * MODELED_ALIGNMENT_BYTES;
  return checkedAdd(MODELED_COMPONENT_BYTES, alignedBytes);
}

function compareRecordKeys(left: CanonicalRecordKey, right: CanonicalRecordKey): number {
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  if (left.volume !== right.volume) return left.volume < right.volume ? -1 : 1;
  return Buffer.compare(left.fileId, right.fileId);
}

function decodeSourceKind(
  value: number | undefined,
): typeof SOURCE_KIND_FILE | typeof SOURCE_KIND_FOLDER {
  if (value !== SOURCE_KIND_FILE && value !== SOURCE_KIND_FOLDER) fail("INVALID_SOURCE_KIND");
  return value;
}

function decodeRecordKind(
  value: number | undefined,
): typeof RECORD_KIND_DIRECTORY | typeof RECORD_KIND_FILE {
  if (value !== RECORD_KIND_DIRECTORY && value !== RECORD_KIND_FILE) {
    fail("INVALID_RECORD_KIND");
  }
  return value;
}

function copyBoundedCatalog(value: unknown): Buffer {
  const source = intrinsicUint8ArrayWindow(value);
  if (source.byteLength < TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1) {
    fail("TOO_SHORT");
  }
  if (source.byteLength > TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_MAX_ENCODED_BYTES_V1) {
    fail("TOO_LARGE");
  }
  let copy: Buffer | null = null;
  try {
    const view = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    copy = Buffer.from(view);
    if (copy.byteLength !== source.byteLength) fail("INVALID_ENCODED_LENGTH");
    return copy;
  } catch (error: unknown) {
    copy?.fill(0);
    throw error;
  }
}

function intrinsicUint8ArrayWindow(value: unknown): IntrinsicUint8ArrayWindow {
  if (!isObjectIdentity(value)) fail("INVALID_INPUT");
  let tag: unknown;
  let buffer: unknown;
  let byteLength: unknown;
  let byteOffset: unknown;
  try {
    tag = TYPED_ARRAY_TAG_GETTER(value);
    buffer = TYPED_ARRAY_BUFFER_GETTER(value);
    byteLength = TYPED_ARRAY_BYTE_LENGTH_GETTER(value);
    byteOffset = TYPED_ARRAY_BYTE_OFFSET_GETTER(value);
  } catch {
    fail("INVALID_INPUT");
  }
  if (
    tag !== "Uint8Array" ||
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    typeof byteOffset !== "number" ||
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0
  ) {
    fail("INVALID_INPUT");
  }
  return { buffer: buffer as ArrayBufferLike, byteLength, byteOffset };
}

function captureTypedArrayGetter(key: PropertyKey): (receiver: object) => unknown {
  const prototype = Object.getPrototypeOf(Uint8Array.prototype) as object | null;
  const descriptor = prototype === null
    ? undefined
    : Object.getOwnPropertyDescriptor(prototype, key);
  const getter: unknown = descriptor === undefined ? undefined : Reflect.get(descriptor, "get");
  if (typeof getter !== "function") {
    throw new Error("Required typed-array intrinsic is unavailable.");
  }
  return (receiver: object): unknown => Reflect.apply(getter, receiver, []);
}

function attachRedactedRepresentations(
  target: object,
  summary: () => object,
): void {
  Object.defineProperty(target, NODE_INSPECT_CUSTOM, {
    configurable: false,
    enumerable: false,
    value: summary,
    writable: false,
  });
  Object.defineProperty(target, "toJSON", {
    configurable: false,
    enumerable: false,
    value: summary,
    writable: false,
  });
}

function withSafeCatalogErrors<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error: unknown) {
    const code = isObjectIdentity(error)
      ? INTERNAL_CATALOG_ERRORS.get(error) ?? "INVALID_INPUT"
      : "INVALID_INPUT";
    throw catalogError(code);
  }
}

function catalogError(
  code: TrustedWindowsNativeSourceCatalogErrorCodeV1,
): TrustedWindowsNativeSourceCatalogErrorV1 {
  const error = new TrustedWindowsNativeSourceCatalogErrorV1(code);
  INTERNAL_CATALOG_ERRORS.set(error, code);
  return error;
}

function fail(code: TrustedWindowsNativeSourceCatalogErrorCodeV1): never {
  throw catalogError(code);
}

function hasNonzero(bytes: Buffer, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (bytes[index] !== 0) return true;
  }
  return false;
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) fail("ARITHMETIC_OVERFLOW");
  return result;
}

function checkedMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) fail("ARITHMETIC_OVERFLOW");
  return result;
}

function isObjectIdentity(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

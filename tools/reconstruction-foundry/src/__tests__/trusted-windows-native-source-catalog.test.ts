import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { format, inspect } from "node:util";

import { describe, expect, it } from "vitest";

import {
  decodeTrustedWindowsNativeSourceCatalogV1,
  TrustedWindowsNativeSourceCatalogErrorV1,
  TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1,
  TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_MAX_ENCODED_BYTES_V1,
  TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_RECORD_HEADER_BYTES_V1,
  type TrustedWindowsNativeSourceCatalogErrorCodeV1,
} from "../trusted-windows-native-source-catalog.js";

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

const SOURCE_KIND_FILE = 1;
const SOURCE_KIND_FOLDER = 2;
const RECORD_KIND_DIRECTORY = 1;
const RECORD_KIND_FILE = 2;
const FILE_TRAILER_BYTES = 24;
const LAYOUT_DIGEST_DOMAIN = Buffer.from("VNSH-LAYOUT-V1\0", "ascii");

interface GoldenFixture {
  readonly format: string;
  readonly version: number;
  readonly header_size_bytes: number;
  readonly record_header_size_bytes: number;
  readonly max_encoded_bytes: number;
  readonly vectors: readonly GoldenVector[];
}

interface GoldenVector {
  readonly name: string;
  readonly source_kind: "file" | "folder";
  readonly directory_count: number;
  readonly file_count: number;
  readonly record_count: number;
  readonly total_encoded_bytes_decimal: string;
  readonly layout_sha256_hex: string;
  readonly catalog_sha256_hex: string;
  readonly source_file_ref: string;
  readonly catalog_hex: string;
}

interface FixtureRecord {
  readonly kind: typeof RECORD_KIND_DIRECTORY | typeof RECORD_KIND_FILE;
  readonly volume: bigint;
  readonly fileId: Buffer;
  readonly components: readonly (readonly number[])[];
  readonly expectedSize?: bigint;
  readonly referenceSuffix?: Buffer;
}

const GOLDEN_FIXTURE = JSON.parse(readFileSync(new URL(
  "../../native/windows-source-helper/test-vectors/vnshcat1-golden-vectors.json",
  import.meta.url,
), "utf8")) as GoldenFixture;

describe("trusted Windows native VNSHCAT1 source-catalog decoder", () => {
  it("decodes the shared Rust golden vector byte-for-byte", () => {
    expect(GOLDEN_FIXTURE).toMatchObject({
      format: "VNSHCAT1",
      version: 1,
      header_size_bytes: TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1,
      record_header_size_bytes: TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_RECORD_HEADER_BYTES_V1,
      max_encoded_bytes: TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_MAX_ENCODED_BYTES_V1,
    });
    expect(GOLDEN_FIXTURE.vectors).toHaveLength(1);
    const vector = requiredGoldenVector();
    const encoded = Buffer.from(vector.catalog_hex, "hex");
    const catalog = decodeTrustedWindowsNativeSourceCatalogV1(encoded);

    try {
      expect(catalog.sourceKind).toBe(vector.source_kind);
      expect(catalog.directoryCount).toBe(vector.directory_count);
      expect(catalog.fileCount).toBe(vector.file_count);
      expect(catalog.recordCount).toBe(vector.record_count);
      expect(catalog.totalEncodedBytes.toString(10)).toBe(vector.total_encoded_bytes_decimal);
      expect(Buffer.from(catalog.privateLayoutSha256View()).toString("hex"))
        .toBe(vector.layout_sha256_hex);
      expect(Buffer.from(catalog.privateCatalogSha256View()).toString("hex"))
        .toBe(vector.catalog_sha256_hex);

      const records = catalog.records();
      expect(records).toHaveLength(3);
      expect(records.map((record) => record.kind)).toEqual([
        "directory",
        "directory",
        "file",
      ]);
      expect(records[0]?.componentCount).toBe(0);
      expect(records[1]?.componentAt(0).privateUnitsView()).toEqual(
        Uint16Array.from([0x0045, 0xd800, 0x006d, 0x0070, 0x0074, 0x0079]),
      );
      expect(records[2]?.componentAt(0).privateUnitsView()).toEqual(
        Uint16Array.from([
          0x0066,
          0x0069,
          0x006c,
          0x0065,
          0x002e,
          0x0062,
          0x0069,
          0x006e,
        ]),
      );
      expect(records[2]?.expectedSize).toBe(3n);
      expect(records[2]?.sourceFileRef).toBe(vector.source_file_ref);
      expect(Buffer.from(catalog.privateEncodedBytesView()).toString("hex"))
        .toBe(vector.catalog_hex);
    } finally {
      catalog.destroy();
    }
  });

  it("accepts the exact single-file topology including a zero-byte file", () => {
    const encoded = encodeFixture(SOURCE_KIND_FILE, [fileRecord({
      expectedSize: 0n,
      components: [[0x0041]],
    })]);
    const catalog = decodeTrustedWindowsNativeSourceCatalogV1(encoded);

    try {
      expect(catalog.sourceKind).toBe("file");
      expect(catalog.directoryCount).toBe(0);
      expect(catalog.fileCount).toBe(1);
      expect(catalog.records()[0]?.expectedSize).toBe(0n);
    } finally {
      catalog.destroy();
    }
  });

  it("rejects every fixed-header violation with stable privacy-safe codes", () => {
    const valid = goldenBytes();
    const cases: readonly (readonly [
      TrustedWindowsNativeSourceCatalogErrorCodeV1,
      (bytes: Buffer) => Buffer,
    ])[] = [
      ["TOO_SHORT", (bytes) => bytes.subarray(
        0,
        TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1 - 1,
      )],
      ["INVALID_MAGIC", (bytes) => mutate(bytes, (copy) => {
        copy.writeUInt8(copy.readUInt8(0) ^ 0xff, 0);
      })],
      ["INVALID_VERSION", (bytes) => mutate(bytes, (copy) => {
        copy.writeUInt16BE(2, VERSION_OFFSET);
      })],
      ["INVALID_HEADER_SIZE", (bytes) => mutate(bytes, (copy) => {
        copy.writeUInt16BE(79, HEADER_SIZE_OFFSET);
      })],
      ["INVALID_SOURCE_KIND", (bytes) => mutate(bytes, (copy) => {
        copy[SOURCE_KIND_OFFSET] = 3;
      })],
      ["NONZERO_RESERVED", (bytes) => mutate(bytes, (copy) => {
        copy[HEADER_RESERVED_U24_OFFSET] = 1;
      })],
      ["NONZERO_RESERVED", (bytes) => mutate(bytes, (copy) => {
        copy.writeUInt32BE(1, HEADER_RESERVED_U32_OFFSET);
      })],
      ["NONZERO_RESERVED", (bytes) => mutate(bytes, (copy) => {
        copy[HEADER_RESERVED_U64_OFFSET] = 1;
      })],
      ["INVALID_COUNTS", (bytes) => mutate(bytes, (copy) => {
        copy.writeUInt32BE(100_001, FILE_COUNT_OFFSET);
        copy.writeUInt32BE(100_003, RECORD_COUNT_OFFSET);
      })],
      ["INVALID_COUNTS", (bytes) => mutate(bytes, (copy) => {
        copy.writeUInt32BE(4, RECORD_COUNT_OFFSET);
      })],
      ["INVALID_ENCODED_LENGTH", (bytes) => mutate(bytes, (copy) => {
        copy.writeBigUInt64BE(BigInt(copy.byteLength + 1), TOTAL_ENCODED_BYTES_OFFSET);
      })],
    ];

    for (const [code, corrupt] of cases) {
      expectCatalogError(() => decodeTrustedWindowsNativeSourceCatalogV1(corrupt(valid)), code);
    }
  });

  it("rejects every record-envelope violation before private payload use", () => {
    const valid = goldenBytes();
    const rootOffset = TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1;
    const cases: readonly (readonly [
      TrustedWindowsNativeSourceCatalogErrorCodeV1,
      (bytes: Buffer) => Buffer,
    ])[] = [
      ["INVALID_RECORD_KIND", (bytes) => mutate(bytes, (copy) => {
        copy[rootOffset + RECORD_KIND_OFFSET] = 3;
      })],
      ["INVALID_RECORD_FLAGS", (bytes) => mutate(bytes, (copy) => {
        copy[rootOffset + RECORD_FLAGS_OFFSET] = 1;
      })],
      ["INVALID_RECORD_HEADER_SIZE", (bytes) => mutate(bytes, (copy) => {
        copy.writeUInt16BE(39, rootOffset + RECORD_HEADER_SIZE_OFFSET);
      })],
      ["NONZERO_RESERVED", (bytes) => mutate(bytes, (copy) => {
        copy.writeUInt32BE(1, rootOffset + RECORD_RESERVED_U32_OFFSET);
      })],
      ["INVALID_RECORD_LENGTH", (bytes) => mutate(bytes, (copy) => {
        copy.writeUInt32BE(39, rootOffset + RECORD_LENGTH_OFFSET);
      })],
      ["TRUNCATED", (bytes) => {
        const copy = Buffer.from(bytes.subarray(0, -1));
        copy.writeBigUInt64BE(BigInt(copy.byteLength), TOTAL_ENCODED_BYTES_OFFSET);
        return copy;
      }],
      ["INVALID_RECORD_LENGTH", (bytes) => mutate(bytes, (copy) => {
        copy.writeUInt32BE(41, rootOffset + RECORD_LENGTH_OFFSET);
      })],
    ];

    for (const [code, corrupt] of cases) {
      expectCatalogError(() => decodeTrustedWindowsNativeSourceCatalogV1(corrupt(valid)), code);
    }
  });

  it("rejects non-canonical order and duplicate native identities", () => {
    const first = directoryRecord({ fileId: identityBytes(0x20), components: [] });
    const lower = directoryRecord({ fileId: identityBytes(0x10), components: [[0x0041]] });
    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(encodeFixture(
        SOURCE_KIND_FOLDER,
        [first, lower],
      )),
      "INVALID_RECORD_ORDER",
    );

    const sharedIdentity = identityBytes(0x30);
    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(encodeFixture(
        SOURCE_KIND_FOLDER,
        [
          directoryRecord({ fileId: sharedIdentity, components: [] }),
          fileRecord({ fileId: sharedIdentity, components: [[0x0042]] }),
        ],
      )),
      "DUPLICATE_IDENTITY",
    );
  });

  it("rejects zero and duplicate source-file reference suffixes", () => {
    const zeroReference = encodeFixture(SOURCE_KIND_FOLDER, [
      directoryRecord({ components: [] }),
      fileRecord({ referenceSuffix: Buffer.alloc(16), components: [[0x0041]] }),
    ]);
    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(zeroReference),
      "INVALID_FILE_REFERENCE",
    );

    const repeated = Buffer.alloc(16, 0x44);
    const duplicateReference = encodeFixture(SOURCE_KIND_FOLDER, [
      directoryRecord({ components: [] }),
      fileRecord({
        fileId: identityBytes(0x40),
        referenceSuffix: repeated,
        components: [[0x0041]],
      }),
      fileRecord({
        fileId: identityBytes(0x60),
        referenceSuffix: repeated,
        components: [[0x0042]],
      }),
    ]);
    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(duplicateReference),
      "DUPLICATE_FILE_REFERENCE",
    );
  });

  it("enforces file, folder-root, empty-directory, and path-component topology", () => {
    const cases: readonly (readonly [
      number,
      readonly FixtureRecord[],
      TrustedWindowsNativeSourceCatalogErrorCodeV1,
    ])[] = [
      [SOURCE_KIND_FILE, [fileRecord({ components: [] })], "INVALID_COMPONENT"],
      [SOURCE_KIND_FILE, [fileRecord({ components: [[0x0041], [0x0042]] })], "INVALID_COMPONENT"],
      [SOURCE_KIND_FOLDER, [directoryRecord({ components: [[0x0041]] })], "INVALID_COUNTS"],
      [SOURCE_KIND_FOLDER, [
        directoryRecord({ fileId: identityBytes(0x10), components: [] }),
        directoryRecord({ fileId: identityBytes(0x30), components: [] }),
      ], "INVALID_COUNTS"],
      [SOURCE_KIND_FOLDER, [
        directoryRecord({ components: [] }),
        fileRecord({ components: [[0x002e]] }),
      ], "INVALID_COMPONENT"],
      [SOURCE_KIND_FOLDER, [
        directoryRecord({ components: [] }),
        fileRecord({ components: [[0x0041, 0x0020]] }),
      ], "INVALID_COMPONENT"],
      [SOURCE_KIND_FOLDER, [
        directoryRecord({ components: [] }),
        fileRecord({ components: [[0x0043, 0x004f, 0x004e]] }),
      ], "INVALID_COMPONENT"],
      [SOURCE_KIND_FOLDER, [
        directoryRecord({ components: [] }),
        fileRecord({ components: [[0x202e]] }),
      ], "INVALID_COMPONENT"],
    ];

    for (const [sourceKind, records, errorCode] of cases) {
      expectCatalogError(
        () => decodeTrustedWindowsNativeSourceCatalogV1(encodeFixture(sourceKind, records)),
        errorCode,
      );
    }

    const validEmptyDirectory = encodeFixture(SOURCE_KIND_FOLDER, [
      directoryRecord({ components: [] }),
      directoryRecord({ fileId: identityBytes(0x30), components: [[0xd800]] }),
    ]);
    const catalog = decodeTrustedWindowsNativeSourceCatalogV1(validEmptyDirectory);
    try {
      expect(catalog.records()[1]?.componentAt(0).privateUnitsView()[0]).toBe(0xd800);
    } finally {
      catalog.destroy();
    }
  });

  it("enforces component depth, segment, path, and modeled-memory bounds", () => {
    const tooDeep = Array.from({ length: 1_025 }, () => [0x0041] as const);
    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(encodeFixture(
        SOURCE_KIND_FILE,
        [fileRecord({ components: tooDeep })],
      )),
      "INVALID_COMPONENT",
    );

    const tooWide = [Array.from({ length: 256 }, () => 0x0041)];
    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(encodeFixture(
        SOURCE_KIND_FILE,
        [fileRecord({ components: tooWide })],
      )),
      "INVALID_COMPONENT",
    );

    const longPath = Array.from(
      { length: 129 },
      () => Array.from({ length: 255 }, () => 0x0041),
    );
    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(encodeFixture(
        SOURCE_KIND_FOLDER,
        [directoryRecord({ components: [] }), fileRecord({ components: longPath })],
      )),
      "INVALID_COMPONENT",
    );
  });

  it("rejects a mismatched layout digest and trailing bytes", () => {
    const badDigest = mutate(goldenBytes(), (copy) => {
      copy.writeUInt8(copy.readUInt8(LAYOUT_SHA256_OFFSET) ^ 1, LAYOUT_SHA256_OFFSET);
    });
    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(badDigest),
      "LAYOUT_DIGEST_MISMATCH",
    );

    const withTrailingByte = Buffer.concat([goldenBytes(), Buffer.from([0])]);
    withTrailingByte.writeBigUInt64BE(
      BigInt(withTrailingByte.byteLength),
      TOTAL_ENCODED_BYTES_OFFSET,
    );
    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(withTrailingByte),
      "INVALID_ENCODED_LENGTH",
    );
  });

  it("rejects actual input above the 80 MiB cap before parsing", () => {
    const oversized = new Uint8Array(
      TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_MAX_ENCODED_BYTES_V1 + 1,
    );
    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(oversized),
      "TOO_LARGE",
    );
  });

  it("does not inspect hostile Proxy properties or prototypes", () => {
    const reads = { property: 0, prototype: 0 };
    const hostile = new Proxy(goldenBytes(), {
      get: (): never => {
        reads.property += 1;
        throw new Error("foreign getter failure");
      },
      getPrototypeOf: (): never => {
        reads.prototype += 1;
        throw new Error("foreign prototype failure");
      },
    });

    expectCatalogError(
      () => decodeTrustedWindowsNativeSourceCatalogV1(hostile),
      "INVALID_INPUT",
    );
    expect(reads).toEqual({ property: 0, prototype: 0 });
  });

  it("redacts inspection, console formatting, JSON, and rejection text", () => {
    const vector = requiredGoldenVector();
    const encoded = goldenBytes();
    const catalog = decodeTrustedWindowsNativeSourceCatalogV1(encoded);

    try {
      const record = catalog.records()[1];
      if (record === undefined) expect.fail("Expected a decoded record");
      const component = record.componentAt(0);
      const outputs = [
        inspect(catalog, { breakLength: Infinity }),
        format("%O", catalog),
        JSON.stringify(catalog),
        inspect(record, { breakLength: Infinity }),
        JSON.stringify(record),
        inspect(component, { breakLength: Infinity }),
        JSON.stringify(component),
      ];
      const privateMarkers = [
        vector.source_file_ref,
        vector.layout_sha256_hex,
        vector.catalog_sha256_hex,
        Buffer.from(record.privateFileIdView()).toString("hex"),
        Array.from(component.privateUnitsView()).join(","),
      ];
      for (const output of outputs) {
        for (const marker of privateMarkers) expect(output).not.toContain(marker);
      }
      expect(JSON.parse(JSON.stringify(catalog))).toEqual({
        sourceKind: "folder",
        directoryCount: 2,
        fileCount: 1,
        recordCount: 3,
        totalEncodedBytes: "260",
        destroyed: false,
      });

      const corrupt = mutate(encoded, (copy) => {
        copy.writeUInt8(copy.readUInt8(LAYOUT_SHA256_OFFSET) ^ 1, LAYOUT_SHA256_OFFSET);
      });
      let rejectionText = "";
      try {
        decodeTrustedWindowsNativeSourceCatalogV1(corrupt);
      } catch (error: unknown) {
        rejectionText = format("%O", error);
      }
      for (const marker of privateMarkers) expect(rejectionText).not.toContain(marker);
    } finally {
      catalog.destroy();
    }
  });

  it("owns its backing copy and wipes every retained private byte on destroy", () => {
    const callerBytes = goldenBytes();
    const callerSnapshot = Buffer.from(callerBytes);
    const catalog = decodeTrustedWindowsNativeSourceCatalogV1(callerBytes);
    const encodedView = catalog.privateEncodedBytesView();
    const layoutDigestView = catalog.privateLayoutSha256View();
    const catalogDigestView = catalog.privateCatalogSha256View();
    const records = catalog.records();
    const record = records[2];
    if (record === undefined) expect.fail("Expected a decoded file record");
    const fileIdView = record.privateFileIdView();
    const referenceView = record.privateSourceFileReferenceSuffixView();
    if (referenceView === null) expect.fail("Expected a decoded file reference");
    const componentView = record.componentAt(0).privateUnitsView();

    callerBytes.fill(0);
    expect(Buffer.from(encodedView)).toEqual(callerSnapshot);
    catalog.destroy();
    catalog.destroy();

    for (const view of [
      encodedView,
      layoutDigestView,
      catalogDigestView,
      fileIdView,
      referenceView,
      componentView,
    ]) {
      expect(Array.from(view).every((value) => value === 0)).toBe(true);
    }
    expect(catalog.destroyed).toBe(true);
    expect(catalog.records()).toEqual([]);
    expectCatalogError(() => record.componentAt(0), "CATALOG_DESTROYED");
  });
});

function requiredGoldenVector(): GoldenVector {
  const vector = GOLDEN_FIXTURE.vectors[0];
  if (vector === undefined) throw new Error("Golden fixture is empty.");
  return vector;
}

function goldenBytes(): Buffer {
  return Buffer.from(requiredGoldenVector().catalog_hex, "hex");
}

function mutate(bytes: Buffer, operation: (copy: Buffer) => void): Buffer {
  const copy = Buffer.from(bytes);
  operation(copy);
  return copy;
}

function expectCatalogError(
  operation: () => unknown,
  code: TrustedWindowsNativeSourceCatalogErrorCodeV1,
): void {
  try {
    operation();
    expect.fail(`Expected source catalog rejection ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(TrustedWindowsNativeSourceCatalogErrorV1);
    expect(error).toMatchObject({
      code,
      message: `Trusted Windows native source catalog rejected: ${code}`,
    });
  }
}

function identityBytes(seed: number): Buffer {
  return Buffer.from(Array.from({ length: 16 }, (_, index) => (seed + index) & 0xff));
}

function directoryRecord(input: Partial<FixtureRecord>): FixtureRecord {
  return {
    kind: RECORD_KIND_DIRECTORY,
    volume: input.volume ?? 0x0102_0304_0506_0708n,
    fileId: Buffer.from(input.fileId ?? identityBytes(0x10)),
    components: input.components ?? [],
  };
}

function fileRecord(input: Partial<FixtureRecord>): FixtureRecord {
  return {
    kind: RECORD_KIND_FILE,
    volume: input.volume ?? 0x0102_0304_0506_0708n,
    fileId: Buffer.from(input.fileId ?? identityBytes(0x50)),
    components: input.components ?? [[0x0041]],
    expectedSize: input.expectedSize ?? 7n,
    referenceSuffix: Buffer.from(input.referenceSuffix ?? Buffer.alloc(16, 0x33)),
  };
}

function encodeFixture(sourceKind: number, records: readonly FixtureRecord[]): Buffer {
  const directoryCount = records.filter((record) => record.kind === RECORD_KIND_DIRECTORY).length;
  const fileCount = records.filter((record) => record.kind === RECORD_KIND_FILE).length;
  const encodedRecords = records.map(encodeRecord);
  const totalEncodedBytes = TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1 +
    encodedRecords.reduce((total, record) => total + record.byteLength, 0);
  const header = Buffer.alloc(TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1);
  header.write("VNSHCAT1", 0, "ascii");
  header.writeUInt16BE(1, VERSION_OFFSET);
  header.writeUInt16BE(TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_HEADER_BYTES_V1, HEADER_SIZE_OFFSET);
  header[SOURCE_KIND_OFFSET] = sourceKind;
  header.writeUInt32BE(directoryCount, DIRECTORY_COUNT_OFFSET);
  header.writeUInt32BE(fileCount, FILE_COUNT_OFFSET);
  header.writeUInt32BE(records.length, RECORD_COUNT_OFFSET);
  header.writeBigUInt64BE(BigInt(totalEncodedBytes), TOTAL_ENCODED_BYTES_OFFSET);
  layoutDigest(sourceKind, directoryCount, fileCount, records).copy(header, LAYOUT_SHA256_OFFSET);
  return Buffer.concat([header, ...encodedRecords], totalEncodedBytes);
}

function encodeRecord(record: FixtureRecord): Buffer {
  const componentBuffers = record.components.map(encodeComponent);
  const trailerBytes = record.kind === RECORD_KIND_FILE ? FILE_TRAILER_BYTES : 0;
  const recordLength = TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_RECORD_HEADER_BYTES_V1 +
    componentBuffers.reduce((total, component) => total + component.byteLength, 0) +
    trailerBytes;
  const encoded = Buffer.alloc(recordLength);
  encoded[RECORD_KIND_OFFSET] = record.kind;
  encoded.writeUInt16BE(
    TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_RECORD_HEADER_BYTES_V1,
    RECORD_HEADER_SIZE_OFFSET,
  );
  encoded.writeUInt32BE(recordLength, RECORD_LENGTH_OFFSET);
  encoded.writeBigUInt64BE(record.volume, RECORD_VOLUME_OFFSET);
  record.fileId.copy(encoded, RECORD_FILE_ID_OFFSET);
  encoded.writeUInt32BE(record.components.length, RECORD_COMPONENT_COUNT_OFFSET);
  let cursor = TRUSTED_WINDOWS_NATIVE_SOURCE_CATALOG_RECORD_HEADER_BYTES_V1;
  for (const component of componentBuffers) {
    component.copy(encoded, cursor);
    cursor += component.byteLength;
  }
  if (record.kind === RECORD_KIND_FILE) {
    encoded.writeBigUInt64BE(record.expectedSize ?? 0n, cursor);
    (record.referenceSuffix ?? Buffer.alloc(16)).copy(encoded, cursor + 8);
  }
  return encoded;
}

function encodeComponent(units: readonly number[]): Buffer {
  const encoded = Buffer.alloc(4 + units.length * 2);
  encoded.writeUInt32BE(units.length, 0);
  for (const [index, unit] of units.entries()) encoded.writeUInt16BE(unit, 4 + index * 2);
  return encoded;
}

function layoutDigest(
  sourceKind: number,
  directoryCount: number,
  fileCount: number,
  records: readonly FixtureRecord[],
): Buffer {
  const hash = createHash("sha256");
  hash.update(LAYOUT_DIGEST_DOMAIN);
  hash.update(Buffer.from([sourceKind]));
  hash.update(uint32(directoryCount));
  hash.update(uint32(fileCount));
  for (const record of records) updateLayoutDigestRecord(hash, record);
  return hash.digest();
}

function updateLayoutDigestRecord(
  hash: ReturnType<typeof createHash>,
  record: FixtureRecord,
): void {
  hash.update(Buffer.from([record.kind]));
  hash.update(uint64(record.volume));
  hash.update(record.fileId);
  hash.update(uint32(record.components.length));
  for (const component of record.components) {
    hash.update(uint32(component.length));
    for (const unit of component) hash.update(uint16(unit));
  }
  if (record.kind === RECORD_KIND_FILE) hash.update(uint64(record.expectedSize ?? 0n));
}

function uint16(value: number): Buffer {
  const encoded = Buffer.alloc(2);
  encoded.writeUInt16BE(value);
  return encoded;
}

function uint32(value: number): Buffer {
  const encoded = Buffer.alloc(4);
  encoded.writeUInt32BE(value);
  return encoded;
}

function uint64(value: bigint): Buffer {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(value);
  return encoded;
}

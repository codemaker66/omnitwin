import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, gzipSync, zstdCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES,
  inspectSpzSourceFacts,
  type FoundrySpzSourceFactsOutcome,
} from "../spz-source-facts.js";

const roots: string[] = [];
const SHA256 = "a".repeat(64);
const SH_BYTES = [0, 9, 24, 45, 72] as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function legacyBytesPerGaussian(version: 1 | 2 | 3, degree: number): number {
  return (version === 1 ? 6 : 9) + 1 + 3 + 3 + (version === 3 ? 4 : 3) + (SH_BYTES[degree] ?? 0);
}

interface LegacyFixtureOptions {
  readonly version?: number;
  readonly count?: number;
  readonly degree?: number;
  readonly fractionalBits?: number;
  readonly flags?: number;
  readonly reserved?: number;
  readonly payloadDelta?: number;
  readonly extensionBytes?: Buffer;
}

function legacyPayload(options: LegacyFixtureOptions = {}): Buffer {
  const version = options.version ?? 3;
  const count = options.count ?? 2;
  const degree = options.degree ?? 0;
  const bytesPerGaussian = version >= 1 && version <= 3
    ? legacyBytesPerGaussian(version as 1 | 2 | 3, degree)
    : 20;
  const payloadBytes = Math.max(0, count * bytesPerGaussian + (options.payloadDelta ?? 0));
  const extensionBytes = options.extensionBytes ?? Buffer.alloc(0);
  const coreEnd = 16 + payloadBytes;
  const bytes = Buffer.alloc(coreEnd + extensionBytes.length);
  bytes.writeUInt32LE(0x5053474e, 0);
  bytes.writeUInt32LE(version, 4);
  bytes.writeUInt32LE(count, 8);
  bytes.writeUInt8(degree, 12);
  bytes.writeUInt8(options.fractionalBits ?? 12, 13);
  bytes.writeUInt8(options.flags ?? 0, 14);
  bytes.writeUInt8(options.reserved ?? 0, 15);
  for (let index = 16; index < coreEnd; index += 1) bytes[index] = index & 0xff;
  extensionBytes.copy(bytes, coreEnd);
  return bytes;
}

function legacyFixture(options: LegacyFixtureOptions = {}): Buffer {
  return gzipSync(legacyPayload(options));
}

function crc32ForTest(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function gzipWithHeader(
  raw: Buffer,
  options: {
    readonly extra?: Buffer;
    readonly filename?: Buffer;
    readonly comment?: Buffer;
    readonly headerCrc?: boolean;
  },
): Buffer {
  const flags =
    (options.headerCrc === true ? 0x02 : 0) |
    (options.extra !== undefined ? 0x04 : 0) |
    (options.filename !== undefined ? 0x08 : 0) |
    (options.comment !== undefined ? 0x10 : 0);
  const fixed = Buffer.from([0x1f, 0x8b, 8, flags, 0, 0, 0, 0, 0, 0xff]);
  const parts: Buffer[] = [fixed];
  if (options.extra !== undefined) {
    if (options.extra.length > 0xffff) throw new Error("test gzip extra field exceeds uint16");
    const length = Buffer.alloc(2);
    length.writeUInt16LE(options.extra.length);
    parts.push(length, options.extra);
  }
  if (options.filename !== undefined) parts.push(options.filename, Buffer.from([0]));
  if (options.comment !== undefined) parts.push(options.comment, Buffer.from([0]));
  let header = Buffer.concat(parts);
  if (options.headerCrc === true) {
    const checksum = Buffer.alloc(2);
    checksum.writeUInt16LE(crc32ForTest(header) & 0xffff);
    header = Buffer.concat([header, checksum]);
  }
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32ForTest(raw), 0);
  trailer.writeUInt32LE(raw.length >>> 0, 4);
  return Buffer.concat([header, deflateRawSync(raw), trailer]);
}

interface V4Fixture {
  readonly bytes: Buffer;
  readonly tocOffset: number;
  readonly tocBytes: number;
  readonly streamOffsets: readonly number[];
}

function extensionRecord(type: number, payload: Buffer): Buffer {
  const record = Buffer.alloc(8 + payload.length);
  record.writeUInt32LE(type, 0);
  record.writeUInt32LE(payload.length, 4);
  payload.copy(record, 8);
  return record;
}

function v4Fixture(options: {
  readonly version?: number;
  readonly count?: number;
  readonly degree?: number;
  readonly fractionalBits?: number;
  readonly flags?: number;
  readonly reservedIndex?: number;
  readonly streamCount?: number;
  readonly extensionBytes?: Buffer;
} = {}): V4Fixture {
  const version = options.version ?? 4;
  const count = options.count ?? 3;
  const degree = options.degree ?? 0;
  const sizes = [count * 9, count, count * 3, count * 3, count * 4];
  if ((SH_BYTES[degree] ?? 0) > 0) sizes.push(count * (SH_BYTES[degree] ?? 0));
  const streams = sizes.map((size, streamIndex) => {
    const bytes = Buffer.alloc(size);
    for (let index = 0; index < size; index += 1) bytes[index] = (streamIndex * 31 + index) & 0xff;
    return zstdCompressSync(bytes);
  });
  const extensionBytes = options.extensionBytes ?? Buffer.alloc(0);
  const tocOffset = 32 + extensionBytes.length;
  const streamCount = options.streamCount ?? streams.length;
  const tocBytes = streamCount * 16;
  const headerAndToc = Buffer.alloc(tocOffset + tocBytes);
  headerAndToc.writeUInt32LE(0x5053474e, 0);
  headerAndToc.writeUInt32LE(version, 4);
  headerAndToc.writeUInt32LE(count, 8);
  headerAndToc.writeUInt8(degree, 12);
  headerAndToc.writeUInt8(options.fractionalBits ?? 12, 13);
  headerAndToc.writeUInt8(options.flags ?? (extensionBytes.length > 0 ? 0x02 : 0), 14);
  headerAndToc.writeUInt8(streamCount, 15);
  headerAndToc.writeUInt32LE(tocOffset, 16);
  if (options.reservedIndex !== undefined) headerAndToc[20 + options.reservedIndex] = 1;
  extensionBytes.copy(headerAndToc, 32);
  for (let index = 0; index < streamCount; index += 1) {
    const compressed = streams[index];
    headerAndToc.writeBigUInt64LE(BigInt(compressed?.length ?? 0), tocOffset + index * 16);
    headerAndToc.writeBigUInt64LE(BigInt(sizes[index] ?? 0), tocOffset + index * 16 + 8);
  }
  const streamOffsets: number[] = [];
  let cursor = headerAndToc.length;
  for (const stream of streams) {
    streamOffsets.push(cursor);
    cursor += stream.length;
  }
  return {
    bytes: Buffer.concat([headerAndToc, ...streams]),
    tocOffset,
    tocBytes,
    streamOffsets,
  };
}

async function inspect(bytes: Buffer, signal?: AbortSignal): Promise<FoundrySpzSourceFactsOutcome> {
  const root = await mkdtemp(join(tmpdir(), "foundry-spz-facts-"));
  roots.push(root);
  const path = join(root, "scene.spz");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  try {
    return await inspectSpzSourceFacts(handle, bytes.length, SHA256, signal);
  } finally {
    await handle.close();
  }
}

function expectFailure(
  outcome: FoundrySpzSourceFactsOutcome,
  code: keyof typeof FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
): void {
  expect(outcome).toMatchObject({
    state: "facts_not_established",
    category: FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code],
    code,
    sourceSha256: SHA256,
  });
}

describe("SPZ Source Facts", () => {
  for (const version of [1, 2, 3] as const) {
    for (const degree of [0, 1, 2, 3, 4] as const) {
      it(`establishes a complete legacy v${String(version)} degree-${String(degree)} stream`, async () => {
        const outcome = await inspect(legacyFixture({ version, degree, count: 3, flags: 1 }));
        expect(outcome).toMatchObject({
          state: "established",
          facts: {
            format: "spz_legacy_gzip",
            version,
            count: 3,
            fractionalBitsRaw: 12,
            antialiased: true,
            sphericalHarmonics: {
              degree,
              bytesPerGaussian: SH_BYTES[degree],
            },
            attributeLayout: {
              positionBytesPerGaussian: version === 1 ? 6 : 9,
              rotationBytesPerGaussian: version === 3 ? 4 : 3,
              totalBytesPerGaussian: legacyBytesPerGaussian(version, degree),
            },
            container: {
              kind: "legacy_gzip",
              decompressedSizeBytes: 16 + 3 * legacyBytesPerGaussian(version, degree),
              singleGzipMemberVerified: true,
              gzipCrc32Verified: true,
              gzipInputSizeVerified: true,
              exactDecompressedLengthVerified: true,
            },
          },
        });
      });
    }
  }

  for (const degree of [0, 1, 2, 3, 4] as const) {
    it(`establishes a complete v4 degree-${String(degree)} multi-stream file`, async () => {
      const fixture = v4Fixture({ degree, count: 3, flags: 1 });
      const outcome = await inspect(fixture.bytes);
      expect(outcome).toMatchObject({
        state: "established",
        facts: {
          format: "spz_v4_zstd",
          version: 4,
          count: 3,
          antialiased: true,
          sphericalHarmonics: { degree, bytesPerGaussian: SH_BYTES[degree] },
          extensions: { declared: false, totalBytes: 0, records: [] },
          container: {
            kind: "v4_zstd_multistream",
            streamCount: degree === 0 ? 5 : 6,
            tocByteOffset: 32,
            compressedStreamsEndAtFileEnd: true,
          },
        },
      });
      if (outcome.state !== "established" || outcome.facts.container.kind !== "v4_zstd_multistream") {
        throw new Error("expected established v4 facts");
      }
      expect(outcome.facts.container.streams).toHaveLength(degree === 0 ? 5 : 6);
      expect(outcome.facts.container.streams.every((stream) =>
        stream.zstdFrameMagicVerified && stream.completeZstdDecompressionVerified
      )).toBe(true);
    });
  }

  it("records bounded, structurally valid v4 extension records without asserting a frame", async () => {
    const coordinatePayload = Buffer.alloc(4);
    coordinatePayload.writeUInt32LE(7, 0);
    const extensions = Buffer.concat([
      extensionRecord(0xadbe0003, coordinatePayload),
      extensionRecord(0x12345678, Buffer.from([1, 2, 3])),
    ]);
    const outcome = await inspect(v4Fixture({ extensionBytes: extensions }).bytes);
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        extensions: {
          declared: true,
          totalBytes: extensions.length,
          records: [
            { typeCodeHex: "adbe0003", payloadBytes: 4, recognizedType: "adobe_coordinate_system" },
            { typeCodeHex: "12345678", payloadBytes: 3, recognizedType: "unknown" },
          ],
        },
      },
    });
  });

  it("records bounded, structurally valid legacy extension records", async () => {
    const coordinatePayload = Buffer.alloc(4);
    coordinatePayload.writeUInt32LE(7, 0);
    const extensions = Buffer.concat([
      extensionRecord(0xadbe0003, coordinatePayload),
      extensionRecord(0x12345678, Buffer.from([1, 2, 3])),
    ]);
    const outcome = await inspect(legacyFixture({ flags: 0x02, extensionBytes: extensions }));
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        format: "spz_legacy_gzip",
        extensions: {
          declared: true,
          totalBytes: extensions.length,
          records: [
            { typeCodeHex: "adbe0003", payloadBytes: 4, recognizedType: "adobe_coordinate_system" },
            { typeCodeHex: "12345678", payloadBytes: 3, recognizedType: "unknown" },
          ],
        },
        container: { kind: "legacy_gzip", extensionBytes: extensions.length },
      },
    });
  });

  it("accepts legal gzip FEXTRA, FNAME, FCOMMENT, and FHCRC fields", async () => {
    const raw = legacyPayload();
    const bytes = gzipWithHeader(raw, {
      extra: Buffer.alloc(0xffff, 0x41),
      filename: Buffer.from("scene.spz"),
      comment: Buffer.from("bounded fixture"),
      headerCrc: true,
    });
    const outcome = await inspect(bytes);
    expect(outcome).toMatchObject({ state: "established", facts: { format: "spz_legacy_gzip" } });
  });

  it("reports a dedicated resource limit when a gzip header exceeds its published cap", async () => {
    const bytes = gzipWithHeader(legacyPayload(), {
      filename: Buffer.alloc(FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES, 0x41),
    });
    expectFailure(await inspect(bytes), "SPZ_GZIP_HEADER_SIZE_LIMIT_EXCEEDED");
  });

  it("rejects gzip-wrapped v4 and plaintext legacy headers as envelope mismatches", async () => {
    expectFailure(await inspect(legacyFixture({ version: 4 })), "SPZ_ENVELOPE_VERSION_MISMATCH");
    const plaintext = v4Fixture({ version: 3 }).bytes;
    expectFailure(await inspect(plaintext), "SPZ_ENVELOPE_VERSION_MISMATCH");
  });

  it("rejects an unrecognized outer container", async () => {
    expectFailure(await inspect(Buffer.from("not an spz")), "SPZ_CONTAINER_UNRECOGNIZED");
  });

  it("rejects a corrupt gzip trailer, appended bytes, and a second gzip member", async () => {
    const corrupt = Buffer.from(legacyFixture());
    corrupt[corrupt.length - 8] = (corrupt[corrupt.length - 8] ?? 0) ^ 0xff;
    expectFailure(await inspect(corrupt), "SPZ_GZIP_TRAILER_INVALID");
    expectFailure(
      await inspect(Buffer.concat([legacyFixture(), Buffer.from([0])])),
      "SPZ_GZIP_TRAILING_DATA_UNSUPPORTED",
    );
    expectFailure(
      await inspect(Buffer.concat([legacyFixture(), gzipSync(Buffer.alloc(0))])),
      "SPZ_GZIP_TRAILING_DATA_UNSUPPORTED",
    );
  });

  it("rejects legacy layout contradictions", async () => {
    expectFailure(await inspect(legacyFixture({ count: 0 })), "SPZ_GAUSSIAN_COUNT_INVALID");
    expectFailure(await inspect(legacyFixture({ degree: 5 })), "SPZ_SH_DEGREE_UNSUPPORTED");
    expectFailure(await inspect(legacyFixture({ flags: 2 })), "SPZ_EXTENSION_DECLARATION_MISMATCH");
    expectFailure(await inspect(legacyFixture({ flags: 0x80 })), "SPZ_FLAGS_UNSUPPORTED");
    expectFailure(await inspect(legacyFixture({ reserved: 1 })), "SPZ_RESERVED_HEADER_UNSUPPORTED");
    expectFailure(await inspect(legacyFixture({ payloadDelta: -1 })), "SPZ_PAYLOAD_LENGTH_MISMATCH");
    expectFailure(await inspect(legacyFixture({ payloadDelta: 1 })), "SPZ_PAYLOAD_LENGTH_MISMATCH");
  });

  it("rejects undeclared, empty-declared, and malformed legacy extension tails", async () => {
    const validRecord = extensionRecord(0x12345678, Buffer.from([1]));
    expectFailure(
      await inspect(legacyFixture({ flags: 0, extensionBytes: validRecord })),
      "SPZ_PAYLOAD_LENGTH_MISMATCH",
    );
    expectFailure(await inspect(legacyFixture({ flags: 0x02 })), "SPZ_EXTENSION_DECLARATION_MISMATCH");
    const malformed = Buffer.alloc(8);
    malformed.writeUInt32LE(0x12345678, 0);
    malformed.writeUInt32LE(1, 4);
    expectFailure(
      await inspect(legacyFixture({ flags: 0x02, extensionBytes: malformed })),
      "SPZ_EXTENSION_RECORD_INVALID",
    );
  });

  it("records the full u8 fractional-bits field without shifting or inferring decode support", async () => {
    for (const fractionalBits of [0, 12, 30, 31, 255]) {
      const outcome = await inspect(legacyFixture({ fractionalBits }));
      expect(outcome).toMatchObject({ state: "established", facts: { fractionalBitsRaw: fractionalBits } });
    }
  });

  it("rejects v4 stream-count, TOC-size, EOF, flag, and reserved-byte contradictions", async () => {
    expectFailure(await inspect(v4Fixture({ degree: 0, streamCount: 6 }).bytes), "SPZ_V4_STREAM_COUNT_INVALID");
    expectFailure(await inspect(v4Fixture({ degree: 1, streamCount: 5 }).bytes), "SPZ_V4_STREAM_COUNT_INVALID");

    const wrongSize = v4Fixture();
    wrongSize.bytes.writeBigUInt64LE(28n, wrongSize.tocOffset + 8);
    expectFailure(await inspect(wrongSize.bytes), "SPZ_V4_STREAM_SIZE_MISMATCH");

    expectFailure(
      await inspect(Buffer.concat([v4Fixture().bytes, Buffer.from([0])])),
      "SPZ_V4_STREAM_RANGE_INVALID",
    );
    expectFailure(await inspect(v4Fixture({ flags: 0x80 }).bytes), "SPZ_FLAGS_UNSUPPORTED");
    expectFailure(await inspect(v4Fixture({ reservedIndex: 11 }).bytes), "SPZ_RESERVED_HEADER_UNSUPPORTED");
  });

  it("classifies an unsafe compressed TOC integer as an invalid stream range", async () => {
    const fixture = v4Fixture();
    fixture.bytes.writeBigUInt64LE(0xffffffffffffffffn, fixture.tocOffset);
    expectFailure(await inspect(fixture.bytes), "SPZ_V4_STREAM_RANGE_INVALID");
  });

  it("rejects malformed extension declarations and records", async () => {
    expectFailure(
      await inspect(v4Fixture({ flags: 0x02, extensionBytes: Buffer.alloc(0) }).bytes),
      "SPZ_EXTENSION_DECLARATION_MISMATCH",
    );
    const record = extensionRecord(0x12345678, Buffer.from([1]));
    expectFailure(
      await inspect(v4Fixture({ flags: 0, extensionBytes: record }).bytes),
      "SPZ_EXTENSION_DECLARATION_MISMATCH",
    );
    const overrun = Buffer.alloc(8);
    overrun.writeUInt32LE(0x12345678, 0);
    overrun.writeUInt32LE(1, 4);
    expectFailure(await inspect(v4Fixture({ extensionBytes: overrun }).bytes), "SPZ_EXTENSION_RECORD_INVALID");
  });

  it("rejects corrupted v4 compressed bytes", async () => {
    const fixture = v4Fixture();
    fixture.bytes[fixture.streamOffsets[0] ?? 0] = 0;
    expectFailure(await inspect(fixture.bytes), "SPZ_V4_ZSTD_FRAME_INVALID");
  });

  it("rejects an extra concatenated Zstandard frame hidden inside one TOC stream range", async () => {
    const fixture = v4Fixture();
    const firstOffset = fixture.streamOffsets[0] ?? 0;
    const firstCompressedBytes = Number(fixture.bytes.readBigUInt64LE(fixture.tocOffset));
    const firstEnd = firstOffset + firstCompressedBytes;
    const extraFrame = zstdCompressSync(Buffer.alloc(0));
    const bytes = Buffer.concat([
      fixture.bytes.subarray(0, firstEnd),
      extraFrame,
      fixture.bytes.subarray(firstEnd),
    ]);
    bytes.writeBigUInt64LE(BigInt(firstCompressedBytes + extraFrame.length), fixture.tocOffset);
    expectFailure(await inspect(bytes), "SPZ_V4_ZSTD_FRAME_INVALID");
  });

  it("returns a stable cancellation outcome", async () => {
    const controller = new AbortController();
    controller.abort();
    expectFailure(await inspect(legacyFixture(), controller.signal), "SPZ_INSPECTION_CANCELLED");
  });

  it("keeps public failure registries frozen at runtime", () => {
    expect(Object.isFrozen(FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CODES)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE)).toBe(true);
    expect(FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE.SPZ_V4_ZSTD_RUNTIME_UNAVAILABLE)
      .toBe("unsupported_variant");
  });
});

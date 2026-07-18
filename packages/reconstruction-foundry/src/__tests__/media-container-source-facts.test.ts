import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CODES,
  FoundryMediaContainerSourceFactsSchema,
  inspectMediaContainerSourceFacts,
  type FoundryMediaContainerSourceFactsOutcome,
} from "../media-container-source-facts.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function jpegFixture(marker = 0xc0, width = 3, height = 2): Buffer {
  if (marker !== 0xc0 && marker !== 0xc2) return Buffer.from([0xff, 0xd8, 0xff, marker]);
  const frameHeader = Buffer.from([
    0xff, marker, 0x00, 0x0b, 0x08,
    height >>> 8, height & 0xff,
    width >>> 8, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ]);
  const scanHeader = marker === 0xc0
    ? Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])
    : Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
  return Buffer.from([
    0xff, 0xd8,
    ...frameHeader,
    ...scanHeader,
    0x01, 0x02, 0xff, 0x00, 0x03, 0xff, 0xd0, 0x04,
    0xff, 0xd9,
  ]);
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

function crc32(bytes: Uint8Array): number {
  let state = 0xffff_ffff;
  for (const byte of bytes) {
    state = (CRC32_TABLE[(state ^ byte) & 0xff] ?? 0) ^ (state >>> 8);
  }
  return (state ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + payload.length);
  result.writeUInt32BE(payload.length, 0);
  typeBytes.copy(result, 4);
  payload.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return result;
}

function pngFixture(options: {
  readonly animated?: boolean;
  readonly badIdatCrc?: boolean;
  readonly height?: number;
  readonly transparency?: boolean;
  readonly transparencyPayloadBytes?: number;
  readonly width?: number;
} = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(options.width ?? 3, 0);
  ihdr.writeUInt32BE(options.height ?? 2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x03, 0x00]));
  if (options.badIdatCrc === true) {
    const crcTailOffset = idat.length - 1;
    idat[crcTailOffset] = (idat[crcTailOffset] ?? 0) ^ 0xff;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...(options.animated === true ? [pngChunk("acTL", Buffer.alloc(8))] : []),
    ...(options.transparency === true ? [pngChunk("tRNS", Buffer.alloc(options.transparencyPayloadBytes ?? 6))] : []),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function box(type: string, ...payloads: readonly Buffer[]): Buffer {
  const payload = Buffer.concat(payloads);
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, "ascii");
  payload.copy(result, 8);
  return result;
}

function tkhd(trackId: number, width = 3, height = 2): Buffer {
  const payload = Buffer.alloc(84);
  payload[3] = 1;
  payload.writeUInt32BE(trackId, 12);
  payload.writeUInt32BE(width * 65_536, 76);
  payload.writeUInt32BE(height * 65_536, 80);
  return box("tkhd", payload);
}

function handler(type: "vide" | "soun"): Buffer {
  const payload = Buffer.alloc(24);
  payload.write(type, 8, 4, "ascii");
  return box("hdlr", payload);
}

function videoTrack(trackId: number): Buffer {
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(1_000, 12);
  mdhd.writeUInt32BE(2_000, 16);
  const visual = Buffer.alloc(78);
  visual.writeUInt16BE(3, 24);
  visual.writeUInt16BE(2, 26);
  const stsd = Buffer.alloc(8);
  stsd.writeUInt32BE(1, 4);
  return box(
    "trak",
    tkhd(trackId),
    box(
      "mdia",
      box("mdhd", mdhd),
      handler("vide"),
      box("minf", box("stbl", box("stsd", stsd, box("avc1", visual)))),
    ),
  );
}

function audioTrack(trackId: number): Buffer {
  return box("trak", tkhd(trackId, 0, 0), box("mdia", handler("soun")));
}

function isoBmffFixture(options: {
  readonly majorBrand?: string;
  readonly duplicateAudioTrackId?: boolean;
  readonly encrypted?: boolean;
  readonly fragmented?: boolean;
} = {}): Buffer {
  const ftyp = Buffer.alloc(12);
  ftyp.write(options.majorBrand ?? "isom", 0, 4, "ascii");
  ftyp.writeUInt32BE(1, 4);
  ftyp.write("mp42", 8, 4, "ascii");
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1_000, 12);
  mvhd.writeUInt32BE(2_000, 16);
  const tracks = options.duplicateAudioTrackId === true
    ? [audioTrack(7), videoTrack(7)]
    : [videoTrack(7)];
  return Buffer.concat([
    box("ftyp", ftyp),
    box("moov", box("mvhd", mvhd), ...tracks),
    ...(options.fragmented === true ? [box("moof", Buffer.alloc(0))] : []),
    ...(options.encrypted === true ? [box("pssh", Buffer.alloc(0))] : []),
    box("mdat", Buffer.from([1, 2, 3, 4])),
  ]);
}

async function withHandle<T>(bytes: Buffer, action: (handle: FileHandle) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "foundry-media-container-facts-"));
  roots.push(root);
  const path = join(root, "source.bin");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  try {
    return await action(handle);
  } finally {
    await handle.close();
  }
}

async function inspect(
  bytes: Buffer,
  options: { readonly fileSize?: number; readonly signal?: AbortSignal } = {},
): Promise<FoundryMediaContainerSourceFactsOutcome> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return withHandle(bytes, (handle) => inspectMediaContainerSourceFacts(
    handle,
    options.fileSize ?? bytes.length,
    sha256,
    options.signal,
  ));
}

function expectFailure(
  outcome: FoundryMediaContainerSourceFactsOutcome,
  code: keyof typeof FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
): void {
  expect(outcome).toMatchObject({
    state: "facts_not_established",
    category: FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code],
    code,
  });
}

describe("media-container Source Facts inspector", () => {
  it("establishes bounded JPEG marker and entropy structure", async () => {
    const bytes = jpegFixture();
    const outcome = await inspect(bytes);
    expect(outcome).toMatchObject({
      state: "established",
      sourceSizeBytes: bytes.length,
      facts: {
        format: "jpeg",
        dimensions: { width: 3, height: 2, pixelCount: 6 },
        coding: { process: "baseline_sequential_dct", scanCount: 1, restartMarkerCount: 1 },
        structure: { markerCount: 5 },
      },
    });
    if (outcome.state !== "established") throw new Error("expected JPEG facts");
    expect(FoundryMediaContainerSourceFactsSchema.parse(outcome.facts)).toEqual(outcome.facts);
  });

  it("establishes the restricted progressive JPEG profile and rejects impossible dimensions", async () => {
    const progressive = await inspect(jpegFixture(0xc2));
    expect(progressive).toMatchObject({
      state: "established",
      facts: { coding: { process: "progressive_dct", scanCount: 1 } },
    });
    expectFailure(await inspect(jpegFixture(0xc0, 65_535, 65_535)), "MEDIA_CONTAINER_PIXEL_COUNT_LIMIT_EXCEEDED");
  });

  it("establishes PNG chunks, CRCs, and legal tRNS ordering without decoding pixels", async () => {
    const outcome = await inspect(pngFixture({ transparency: true }));
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        format: "png",
        dimensions: { width: 3, height: 2, pixelCount: 6 },
        image: { colorType: "truecolor", bitDepth: 8 },
        chunks: { count: 4, idatCount: 1, transparencyDeclared: true, allCrcsVerified: true },
      },
    });
  });

  it("establishes selected ISO-BMFF movie and video-track declarations without claiming sample tables", async () => {
    const outcome = await inspect(isoBmffFixture());
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        format: "iso_bmff",
        profile: "iso_bmff_movie_video_track_declarations",
        inspectionCoverage: "complete_top_level_tiling_and_selected_movie_video_structure",
        fileType: { majorBrand: "isom", compatibleBrands: ["mp42"] },
        movie: { timescale: 1_000, durationUnits: "2000" },
        tracks: {
          count: 1,
          videoCount: 1,
          video: [{ trackId: 7, mediaTimescale: 1_000, sampleDescriptions: [{ typeCode: "avc1", width: 3, height: 2 }] }],
        },
      },
    });
  });

  it("routes malformed ftyp signatures into stable BMFF parse failures", async () => {
    const malformed = Buffer.alloc(8);
    malformed.writeUInt32BE(4, 0);
    malformed.write("ftyp", 4, 4, "ascii");
    expectFailure(await inspect(malformed), "BMFF_BOX_SIZE_INVALID");
  });

  it("rejects unsupported JPEG coding markers and HEIF-family BMFF brands", async () => {
    expectFailure(await inspect(jpegFixture(0xc8)), "JPEG_CODING_PROCESS_UNSUPPORTED");
    expectFailure(await inspect(isoBmffFixture({ majorBrand: "heim" })), "BMFF_HEIF_AVIF_UNSUPPORTED");
  });

  it("rejects bad PNG CRCs and duplicate IDs across video and non-video tracks", async () => {
    expectFailure(await inspect(pngFixture({ badIdatCrc: true })), "PNG_CHUNK_CRC_MISMATCH");
    expectFailure(await inspect(isoBmffFixture({ duplicateAudioTrackId: true })), "BMFF_TRACK_STRUCTURE_INVALID");
  });

  it("does not accept animated, malformed-transparent, or dimension-excessive PNG structure", async () => {
    expectFailure(await inspect(pngFixture({ animated: true })), "PNG_ANIMATION_UNSUPPORTED");
    expectFailure(await inspect(pngFixture({ transparency: true, transparencyPayloadBytes: 5 })), "PNG_CHUNK_ORDER_INVALID");
    expectFailure(await inspect(pngFixture({ width: 1_000_001 })), "MEDIA_CONTAINER_DIMENSION_LIMIT_EXCEEDED");
  });

  it("rejects fragmented and encrypted ISO-BMFF variants before issuing video facts", async () => {
    expectFailure(await inspect(isoBmffFixture({ fragmented: true })), "BMFF_FRAGMENTED_UNSUPPORTED");
    expectFailure(await inspect(isoBmffFixture({ encrypted: true })), "BMFF_ENCRYPTED_UNSUPPORTED");
  });

  it("rejects impossible reassembled PNG and BMFF fact relationships at the schema boundary", async () => {
    const png = await inspect(pngFixture({ transparency: true }));
    if (png.state !== "established" || png.facts.format !== "png") {
      throw new Error("expected PNG facts");
    }
    expect(FoundryMediaContainerSourceFactsSchema.safeParse({
      ...png.facts,
      image: { ...png.facts.image, channelCount: 1 },
    }).success).toBe(false);
    expect(FoundryMediaContainerSourceFactsSchema.safeParse({
      ...png.facts,
      image: { ...png.facts.image, colorType: "grayscale" },
      chunks: { ...png.facts.chunks, paletteEntries: 2 },
    }).success).toBe(false);
    expect(FoundryMediaContainerSourceFactsSchema.safeParse({
      ...png.facts,
      chunks: { ...png.facts.chunks, count: png.facts.chunks.count + 1 },
    }).success).toBe(false);

    const bmff = await inspect(isoBmffFixture());
    if (bmff.state !== "established" || bmff.facts.format !== "iso_bmff") {
      throw new Error("expected BMFF facts");
    }
    const firstTrack = bmff.facts.tracks.video[0];
    if (firstTrack === undefined) throw new Error("expected video track");
    expect(FoundryMediaContainerSourceFactsSchema.safeParse({
      ...bmff.facts,
      tracks: {
        ...bmff.facts.tracks,
        count: 2,
        videoCount: 2,
        video: [firstTrack, { ...firstTrack, ordinal: 1 }],
      },
    }).success).toBe(false);
    expect(FoundryMediaContainerSourceFactsSchema.safeParse({
      ...bmff.facts,
      boxes: { ...bmff.facts.boxes, topLevelCount: bmff.facts.boxes.count + 1 },
    }).success).toBe(false);
    expect(FoundryMediaContainerSourceFactsSchema.safeParse({
      ...bmff.facts,
      fileType: { ...bmff.facts.fileType, majorBrand: "avif" },
    }).success).toBe(false);
  });

  it("returns stable source-binding and cancellation failures without issuing facts", async () => {
    const bytes = jpegFixture();
    expectFailure(await inspect(bytes, { fileSize: bytes.length + 1 }), "MEDIA_CONTAINER_SOURCE_SIZE_MISMATCH");
    const controller = new AbortController();
    controller.abort();
    expectFailure(await inspect(bytes, { signal: controller.signal }), "MEDIA_CONTAINER_INSPECTION_CANCELLED");
    expectFailure(await inspect(bytes, { fileSize: 0 }), "MEDIA_CONTAINER_SOURCE_SIZE_INVALID");
  });

  it("freezes a category-complete stable failure registry", () => {
    expect(Object.isFrozen(FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CODES)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE)).toBe(true);
    expect(Object.keys(FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE).sort()).toEqual(
      [...FOUNDRY_MEDIA_CONTAINER_SOURCE_FACTS_FAILURE_CODES].sort(),
    );
  });
});

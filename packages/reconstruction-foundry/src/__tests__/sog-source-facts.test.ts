import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_SOG_META_JSON_MAX_DEPTH,
  FOUNDRY_SOG_META_JSON_MAX_VALUES,
  FOUNDRY_SOG_META_MAX_BYTES,
  FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES,
  FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES,
  inspectStoredZipSogV2SourceFacts,
  type FoundrySogSourceFactsOutcome,
} from "../sog-source-facts.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function vp8l(width: number, height: number): Buffer {
  const widthValue = width - 1;
  const heightValue = height - 1;
  const data = Buffer.from([
    0x2f,
    widthValue & 0xff,
    ((widthValue >> 8) & 0x3f) | ((heightValue & 0x03) << 6),
    (heightValue >> 2) & 0xff,
    (heightValue >> 10) & 0x0f,
  ]);
  const chunk = Buffer.alloc(8 + data.length + 1);
  chunk.write("VP8L", 0, "ascii");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  const output = Buffer.alloc(12 + chunk.length);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WEBP", 8, "ascii");
  chunk.copy(output, 12);
  return output;
}

interface MetaOptions {
  readonly count?: number;
  readonly antialias?: boolean | "absent";
  readonly sh?: null | { readonly count: number; readonly bands: 1 | 2 | 3 };
}

function metaBytes(options: MetaOptions = {}): Buffer {
  const codebook = Array.from({ length: 256 }, (_, index) => index / 255);
  const value: Record<string, unknown> = {
    version: 2,
    asset: { generator: "test-fixture" },
    count: options.count ?? 4,
    means: {
      mins: [-2, -1, -3],
      maxs: [2, 3, 1],
      files: ["means_l.webp", "means_u.webp"],
    },
    scales: { codebook, files: ["scales.webp"] },
    quats: { files: ["quats.webp"] },
    sh0: { codebook, files: ["sh0.webp"] },
  };
  if (options.antialias !== "absent") value.antialias = options.antialias ?? true;
  if (options.sh !== null && options.sh !== undefined) {
    value.shN = {
      count: options.sh.count,
      bands: options.sh.bands,
      codebook,
      files: ["shN_centroids.webp", "shN_labels.webp"],
    };
  }
  return Buffer.from(JSON.stringify(value), "utf8");
}

interface EntrySpec {
  readonly name: string;
  readonly data: Buffer;
  readonly flags?: number;
  readonly method?: number;
  readonly crc?: number;
  readonly localCrc?: number;
  readonly localDeclaredSize?: number;
  readonly centralDeclaredSize?: number;
  readonly centralCommentBytes?: number;
  readonly dataDescriptor?: "signed" | "signed_bad_crc" | "unsigned";
}

interface ZipOptions {
  readonly prefix?: Buffer;
  readonly gapAfterFirstEntry?: Buffer;
  readonly zip64Eocd?: boolean;
  readonly disk?: number;
}

function zip(entries: readonly EntrySpec[], options: ZipOptions = {}): Buffer {
  const prefix = options.prefix ?? Buffer.alloc(0);
  const locals: Buffer[] = [prefix];
  const central: Buffer[] = [];
  let localOffset = prefix.length;
  for (const [entryIndex, entry] of entries.entries()) {
    const name = Buffer.from(entry.name, "utf8");
    const flags = (entry.flags ?? 0) | (entry.dataDescriptor === undefined ? 0 : 0x0008);
    const method = entry.method ?? 0;
    const checksum = entry.crc ?? crc32(entry.data);
    const localChecksum = entry.localCrc ?? (entry.dataDescriptor === undefined ? checksum : 0);
    const localDeclaredSize = entry.localDeclaredSize ??
      (entry.dataDescriptor === undefined ? entry.data.length : 0);
    const descriptor = entry.dataDescriptor === undefined
      ? Buffer.alloc(0)
      : Buffer.alloc(entry.dataDescriptor === "unsigned" ? 12 : 16);
    if (entry.dataDescriptor !== undefined) {
      const valueOffset = entry.dataDescriptor === "unsigned" ? 0 : 4;
      if (entry.dataDescriptor !== "unsigned") descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(
        entry.dataDescriptor === "signed_bad_crc" ? (checksum + 1) >>> 0 : checksum,
        valueOffset,
      );
      descriptor.writeUInt32LE(entry.data.length, valueOffset + 4);
      descriptor.writeUInt32LE(entry.data.length, valueOffset + 8);
    }
    const local = Buffer.alloc(30 + name.length + entry.data.length + descriptor.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(localChecksum, 14);
    local.writeUInt32LE(localDeclaredSize, 18);
    local.writeUInt32LE(localDeclaredSize, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    entry.data.copy(local, 30 + name.length);
    descriptor.copy(local, 30 + name.length + entry.data.length);
    locals.push(local);

    const commentBytes = entry.centralCommentBytes ?? 0;
    const declaredSize = entry.centralDeclaredSize ?? entry.data.length;
    const directory = Buffer.alloc(46 + name.length + commentBytes);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(declaredSize, 20);
    directory.writeUInt32LE(declaredSize, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(commentBytes, 32);
    directory.writeUInt32LE(localOffset, 42);
    name.copy(directory, 46);
    central.push(directory);
    localOffset += local.length;
    if (entryIndex === 0 && options.gapAfterFirstEntry !== undefined) {
      locals.push(options.gapAfterFirstEntry);
      localOffset += options.gapAfterFirstEntry.length;
    }
  }
  const localBytes = Buffer.concat(locals);
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.disk ?? 0, 4);
  const count = options.zip64Eocd === true ? 0xffff : entries.length;
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, centralBytes, eocd]);
}

interface ValidArchiveOptions extends MetaOptions {
  readonly width?: number;
  readonly height?: number;
  readonly planeDimensions?: Partial<Record<"means_l" | "means_u" | "scales" | "quats" | "sh0" | "shN_labels", readonly [number, number]>>;
}

function validEntries(options: ValidArchiveOptions = {}): EntrySpec[] {
  const width = options.width ?? 2;
  const height = options.height ?? 2;
  const dimension = (role: keyof NonNullable<ValidArchiveOptions["planeDimensions"]>): readonly [number, number] =>
    options.planeDimensions?.[role] ?? [width, height];
  const entries: EntrySpec[] = [{ name: "meta.json", data: metaBytes(options) }];
  for (const [role, name] of [
    ["means_l", "means_l.webp"],
    ["means_u", "means_u.webp"],
    ["scales", "scales.webp"],
    ["quats", "quats.webp"],
    ["sh0", "sh0.webp"],
  ] as const) {
    const [planeWidth, planeHeight] = dimension(role);
    entries.push({ name, data: vp8l(planeWidth, planeHeight) });
  }
  if (options.sh !== null && options.sh !== undefined) {
    const centroidWidth = options.sh.bands === 1 ? 192 : options.sh.bands === 2 ? 512 : 960;
    entries.push({
      name: "shN_centroids.webp",
      data: vp8l(centroidWidth, Math.ceil(options.sh.count / 64)),
    });
    const [labelWidth, labelHeight] = dimension("shN_labels");
    entries.push({ name: "shN_labels.webp", data: vp8l(labelWidth, labelHeight) });
  }
  return entries;
}

async function inspect(
  bytes: Buffer,
  signal?: AbortSignal,
  declaredFileSize = bytes.length,
): Promise<FoundrySogSourceFactsOutcome> {
  const directory = await mkdtemp(join(tmpdir(), "omnitwin-sog-facts-"));
  cleanup.push(directory);
  const path = join(directory, "fixture.sog");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  try {
    return await inspectStoredZipSogV2SourceFacts(
      handle,
      declaredFileSize,
      createHash("sha256").update(bytes).digest("hex"),
      signal,
    );
  } finally {
    await handle.close();
  }
}

function archiveWithMeta(data: Buffer): Buffer {
  const entries = validEntries({ sh: null });
  const meta = entries[0];
  if (meta === undefined) throw new Error("missing fixture meta");
  entries[0] = { ...meta, data };
  return zip(entries);
}

function patchedMeta(search: string, replacement: string): Buffer {
  const source = metaBytes({ sh: null }).toString("utf8");
  const patched = source.replace(search, replacement);
  if (patched === source) throw new Error(`missing metadata fixture token: ${search}`);
  return Buffer.from(patched, "utf8");
}

function expectFailure(
  outcome: FoundrySogSourceFactsOutcome,
  code: string,
  category?: string,
): void {
  expect(outcome).toMatchObject({
    state: "facts_not_established",
    code,
    ...(category === undefined ? {} : { category }),
  });
}

describe("stored-ZIP SOG v2 source facts", () => {
  it("exports one exact category for every stable failure code", () => {
    expect(Object.keys(FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE).sort()).toEqual(
      [...FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CODES].sort(),
    );
  });

  it("establishes exact SH0-only facts without emitting archive member names", async () => {
    const outcome = await inspect(zip(validEntries({ antialias: "absent", sh: null })));
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        format: "sog_v2_stored_zip",
        count: 4,
        antialias: { declared: false, declaredValue: null, formatDefault: false },
        encodedMeansRange: { mins: [-2, -1, -3], maxs: [2, 3, 1] },
        sphericalHarmonics: { higherOrderPresent: false, bands: null, paletteCount: null },
        container: {
          entryCount: 6,
          exactMemberSet: true,
          allMembersStored: true,
          allMemberCrc32Verified: true,
          localHeaderFieldsConsistentWithCentralDirectory: true,
          archiveHasNoPrefixOrGaps: true,
          entryRangesNonOverlapping: true,
        },
        sharedPerGaussianImage: { width: 2, height: 2, capacityPixels: 4, countFitsCapacity: true },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(".webp");
    if (outcome.state === "established") {
      expect(outcome.facts.planes.map((plane) => plane.role)).toEqual([
        "means_l", "means_u", "scales", "quats", "sh0",
      ]);
      expect(outcome.facts.planes.every((plane) => plane.encoding === "VP8L")).toBe(true);
    }
  });

  it("establishes higher-order SH palette and label structure", async () => {
    const outcome = await inspect(zip(validEntries({ sh: { count: 65, bands: 3 } })));
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        sphericalHarmonics: { higherOrderPresent: true, bands: 3, paletteCount: 65 },
        container: { entryCount: 8 },
      },
    });
    if (outcome.state === "established") {
      expect(outcome.facts.planes.find((plane) => plane.role === "shN_centroids")).toMatchObject({
        kind: "sh_palette",
        width: 960,
        height: 2,
      });
    }
  });

  it("handles a real-shaped 602409-Gaussian declaration without decoding plane pixels", async () => {
    const outcome = await inspect(zip(validEntries({ count: 602_409, width: 1_024, height: 589, sh: null })));
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        count: 602_409,
        sharedPerGaussianImage: {
          width: 1_024,
          height: 589,
          capacityPixels: 603_136,
          countFitsCapacity: true,
        },
      },
    });
  });

  it.each([
    [1, 192],
    [2, 512],
    [3, 960],
  ] as const)("pins the bands-%i SH centroid width to %i pixels", async (bands, width) => {
    const outcome = await inspect(zip(validEntries({ sh: { count: 65, bands } })));
    if (outcome.state !== "established") throw new Error("expected established SOG facts");
    expect(outcome.facts.planes.find((plane) => plane.role === "shN_centroids")).toMatchObject({
      width,
      height: 2,
      kind: "sh_palette",
    });
  });

  it("validates signed descriptors with zero local placeholders without claiming field equality", async () => {
    const entries = validEntries({ sh: null }).map((entry) => ({
      ...entry,
      dataDescriptor: "signed" as const,
    }));
    const archive = zip(entries);
    expect(archive.readUInt32LE(14)).toBe(0);
    expect(archive.readUInt32LE(18)).toBe(0);
    expect(archive.readUInt32LE(22)).toBe(0);
    const outcome = await inspect(archive);
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        container: {
          dataDescriptorCount: 6,
          allDataDescriptorsVerified: true,
          localHeaderFieldsConsistentWithCentralDirectory: true,
          archiveHasNoPrefixOrGaps: true,
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("localAndCentralMemberFieldsAgree");
  });

  it("rejects a signed data descriptor whose CRC contradicts the central directory", async () => {
    const entries = validEntries({ sh: null });
    const plane = entries[1];
    if (plane === undefined) throw new Error("missing fixture plane");
    entries[1] = { ...plane, dataDescriptor: "signed_bad_crc" };
    expectFailure(await inspect(zip(entries)), "SOG_ZIP_HEADER_MISMATCH", "parse_failure");
  });

  it("rejects a nonzero descriptor-local size that contradicts the central directory", async () => {
    const entries = validEntries({ sh: null });
    const plane = entries[1];
    if (plane === undefined) throw new Error("missing fixture plane");
    entries[1] = {
      ...plane,
      dataDescriptor: "signed",
      localDeclaredSize: plane.data.length + 1,
    };
    expectFailure(await inspect(zip(entries)), "SOG_ZIP_HEADER_MISMATCH", "parse_failure");
  });

  it("rejects duplicate JSON object keys before schema validation", async () => {
    const entries = validEntries({ sh: null });
    const meta = entries[0];
    if (meta === undefined) throw new Error("missing fixture meta");
    const duplicate = Buffer.from(
      meta.data.toString("utf8").replace('"version":2', '"version":2,"version":2'),
      "utf8",
    );
    entries[0] = { ...meta, data: duplicate };
    expectFailure(await inspect(zip(entries)), "SOG_META_JSON_DUPLICATE_KEY", "parse_failure");
  });

  it.each([
    [
      "schema mismatch",
      () => patchedMeta('"count":4', '"count":0'),
      "SOG_META_SCHEMA_INVALID",
      "parse_failure",
    ],
    [
      "unsupported version",
      () => patchedMeta('"version":2', '"version":3'),
      "SOG_META_VERSION_UNSUPPORTED",
      "unsupported_variant",
    ],
    [
      "excessive nesting",
      () => Buffer.from(
        `${"[".repeat(FOUNDRY_SOG_META_JSON_MAX_DEPTH)}0${"]".repeat(FOUNDRY_SOG_META_JSON_MAX_DEPTH)}`,
        "utf8",
      ),
      "SOG_META_JSON_DEPTH_LIMIT_EXCEEDED",
      "resource_limit",
    ],
    [
      "excessive values",
      () => Buffer.from(`[${"0,".repeat(FOUNDRY_SOG_META_JSON_MAX_VALUES - 1)}0]`, "utf8"),
      "SOG_META_JSON_VALUE_LIMIT_EXCEEDED",
      "resource_limit",
    ],
    [
      "non-finite number",
      () => patchedMeta('"count":4', '"count":1e999'),
      "SOG_META_JSON_NUMBER_OUT_OF_RANGE",
      "parse_failure",
    ],
  ] as const)("rejects metadata with %s", async (_label, metadata, code, category) => {
    expectFailure(await inspect(archiveWithMeta(metadata())), code, category);
  });

  it("rejects non-UTF-8 metadata and malformed complete-member WebP structure", async () => {
    const invalidText = validEntries({ sh: null });
    const meta = invalidText[0];
    if (meta === undefined) throw new Error("missing fixture meta");
    invalidText[0] = { ...meta, data: Buffer.from([0xff]) };
    expectFailure(await inspect(zip(invalidText)), "SOG_META_UTF8_INVALID", "parse_failure");

    const invalidWebp = validEntries({ sh: null });
    const plane = invalidWebp[1];
    if (plane === undefined) throw new Error("missing fixture plane");
    invalidWebp[1] = { ...plane, data: Buffer.from("not-a-webp", "ascii") };
    expectFailure(await inspect(zip(invalidWebp)), "SOG_WEBP_INVALID", "parse_failure");
  });

  it.each([
    ["unsafe name", [...validEntries({ sh: null }), { name: "../escape.webp", data: vp8l(2, 2) }], "SOG_ZIP_NAME_INVALID"],
    ["duplicate name", [...validEntries({ sh: null }), { name: "means_l.webp", data: vp8l(2, 2) }], "SOG_ZIP_DUPLICATE_NAME"],
  ] as const)("rejects %s", async (_label, entries, code) => {
    expectFailure(await inspect(zip(entries)), code, "parse_failure");
  });

  it("rejects archive prefixes and gaps between local members", async () => {
    expectFailure(
      await inspect(zip(validEntries({ sh: null }), { prefix: Buffer.from("prefix") })),
      "SOG_ZIP_PREFIX_UNSUPPORTED",
      "unsupported_variant",
    );
    expectFailure(
      await inspect(zip(validEntries({ sh: null }), { gapAfterFirstEntry: Buffer.from("gap") })),
      "SOG_ZIP_GAP_UNSUPPORTED",
      "unsupported_variant",
    );
  });

  it("distinguishes member CRC failure from central/local header disagreement", async () => {
    const badCrcEntries = validEntries({ sh: null });
    const plane = badCrcEntries[1];
    if (plane === undefined) throw new Error("missing fixture plane");
    badCrcEntries[1] = { ...plane, crc: (crc32(plane.data) + 1) >>> 0 };
    expectFailure(await inspect(zip(badCrcEntries)), "SOG_MEMBER_CRC_MISMATCH", "parse_failure");

    const mismatchEntries = validEntries({ sh: null });
    const mismatch = mismatchEntries[1];
    if (mismatch === undefined) throw new Error("missing fixture plane");
    mismatchEntries[1] = { ...mismatch, localCrc: (crc32(mismatch.data) + 1) >>> 0 };
    expectFailure(await inspect(zip(mismatchEntries)), "SOG_ZIP_HEADER_MISMATCH", "parse_failure");
  });

  it.each([
    ["non-final", 1],
    ["final", -1],
  ] as const)("rejects an actual unsigned descriptor in the %s member stably", async (_position, targetIndex) => {
    const entries = validEntries({ sh: null });
    const resolvedIndex = targetIndex < 0 ? entries.length - 1 : targetIndex;
    const target = entries[resolvedIndex];
    if (target === undefined) throw new Error("missing fixture descriptor target");
    entries[resolvedIndex] = { ...target, dataDescriptor: "unsigned" };
    expectFailure(
      await inspect(zip(entries)),
      "SOG_ZIP_DATA_DESCRIPTOR_UNSUPPORTED",
      "unsupported_variant",
    );
  });

  it.each([
    ["deflated member", { method: 8 }, {}, "SOG_ZIP_COMPRESSION_UNSUPPORTED"],
    ["data descriptor", { flags: 0x0008 }, {}, "SOG_ZIP_DATA_DESCRIPTOR_UNSUPPORTED"],
    ["encrypted member", { flags: 0x0001 }, {}, "SOG_ZIP_ENCRYPTION_UNSUPPORTED"],
    ["general-purpose flag", { flags: 0x0002 }, {}, "SOG_ZIP_FLAGS_UNSUPPORTED"],
    ["multidisk archive", {}, { disk: 1 }, "SOG_ZIP_MULTIDISK_UNSUPPORTED"],
    ["ZIP64 EOCD", {}, { zip64Eocd: true }, "SOG_ZIP64_UNSUPPORTED"],
  ] as const)("rejects unsupported %s", async (_label, entryPatch, zipOptions, code) => {
    const entries = validEntries({ sh: null });
    const plane = entries[1];
    if (plane === undefined) throw new Error("missing fixture plane");
    entries[1] = { ...plane, ...entryPatch };
    expectFailure(await inspect(zip(entries, zipOptions)), code, "unsupported_variant");
  });

  it("rejects missing and extra members against the exact meta-selected set", async () => {
    const missing = validEntries({ sh: null });
    missing.splice(2, 1);
    expectFailure(await inspect(zip(missing)), "SOG_MEMBER_MISSING", "parse_failure");

    const extra = [...validEntries({ sh: null }), { name: "extra.bin", data: Buffer.from("extra") }];
    expectFailure(await inspect(zip(extra)), "SOG_MEMBER_EXTRA", "parse_failure");
  });

  it("rejects inconsistent per-Gaussian dimensions and insufficient pixel capacity", async () => {
    const inconsistent = validEntries({ sh: null, planeDimensions: { scales: [3, 2] } });
    expectFailure(await inspect(zip(inconsistent)), "SOG_WEBP_DIMENSIONS_INCONSISTENT", "parse_failure");

    const insufficient = validEntries({ sh: null, count: 5, width: 2, height: 2 });
    expectFailure(await inspect(zip(insufficient)), "SOG_GAUSSIAN_CAPACITY_INSUFFICIENT", "parse_failure");
  });

  it("rejects SH centroid dimensions that contradict the declared band layout", async () => {
    const entries = validEntries({ sh: { count: 65, bands: 3 } });
    const centroidIndex = entries.findIndex((entry) => entry.name === "shN_centroids.webp");
    const centroids = entries[centroidIndex];
    if (centroids === undefined) throw new Error("missing fixture SH centroids");
    entries[centroidIndex] = { ...centroids, data: vp8l(959, 2) };
    expectFailure(
      await inspect(zip(entries)),
      "SOG_SH_CENTROID_DIMENSIONS_INVALID",
      "parse_failure",
    );
  });

  it.each([
    ["metadata member", 0, FOUNDRY_SOG_META_MAX_BYTES + 1, "SOG_META_SIZE_LIMIT_EXCEEDED"],
    ["WebP member", 1, FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES + 1, "SOG_MEMBER_SIZE_LIMIT_EXCEEDED"],
  ] as const)("rejects an oversized declared %s before member reads", async (_label, entryIndex, size, code) => {
    const entries = validEntries({ sh: null });
    const entry = entries[entryIndex];
    if (entry === undefined) throw new Error("missing fixture limit target");
    entries[entryIndex] = { ...entry, centralDeclaredSize: size };
    expectFailure(await inspect(zip(entries)), code, "resource_limit");
  });

  it("fails resource limits before allocating declared plane payloads", async () => {
    const entries = validEntries({ sh: null }).map((entry) =>
      entry.name.endsWith(".webp")
        ? { ...entry, centralDeclaredSize: Math.floor(FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES / 5) + 1 }
        : entry,
    );
    expectFailure(
      await inspect(zip(entries)),
      "SOG_PLANE_AGGREGATE_LIMIT_EXCEEDED",
      "resource_limit",
    );

    const tooMany = Array.from({ length: 65 }, (_, index) => ({
      name: `entry-${String(index)}.bin`,
      data: Buffer.alloc(0),
    }));
    expectFailure(await inspect(zip(tooMany)), "SOG_ZIP_ENTRY_LIMIT_EXCEEDED", "resource_limit");

    const hugeCentral = Array.from({ length: 64 }, (_, index) => ({
      name: `entry-${String(index)}.bin`,
      data: Buffer.alloc(0),
      centralCommentBytes: 65_535,
    }));
    expectFailure(
      await inspect(zip(hugeCentral)),
      "SOG_ZIP_CENTRAL_DIRECTORY_LIMIT_EXCEEDED",
      "resource_limit",
    );
  });

  it("distinguishes an initial source-size mismatch from a post-read source change", async () => {
    const bytes = zip(validEntries({ sh: null }));
    expectFailure(
      await inspect(bytes, undefined, bytes.length + 1),
      "SOG_SOURCE_SIZE_MISMATCH",
      "parse_failure",
    );

    const directory = await mkdtemp(join(tmpdir(), "omnitwin-sog-source-change-"));
    cleanup.push(directory);
    const path = join(directory, "fixture.sog");
    await writeFile(path, bytes);
    const handle = await open(path, "r");
    let statCalls = 0;
    const changedHandle: FileHandle = new Proxy(handle, {
      get(target, property) {
        if (property === "stat") {
          return async () => {
            const stats = await target.stat();
            statCalls += 1;
            if (statCalls === 2) stats.mtimeMs += 1;
            return stats;
          };
        }
        if (property === "read") return target.read.bind(target);
        throw new Error(`Unexpected file-handle property: ${String(property)}`);
      },
    });
    try {
      expectFailure(
        await inspectStoredZipSogV2SourceFacts(
          changedHandle,
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
        ),
        "SOG_SOURCE_CHANGED",
        "parse_failure",
      );
      expect(statCalls).toBe(2);
    } finally {
      await handle.close();
    }
  });

  it("returns a stable cancellation outcome without reading members", async () => {
    const controller = new AbortController();
    controller.abort();
    expectFailure(
      await inspect(zip(validEntries({ sh: null })), controller.signal),
      "SOG_INSPECTION_CANCELLED",
      "cancelled",
    );
  });

  it("returns cancellation when the signal aborts during the final identity stat", async () => {
    const bytes = zip(validEntries({ sh: null }));
    const directory = await mkdtemp(join(tmpdir(), "omnitwin-sog-final-stat-"));
    cleanup.push(directory);
    const path = join(directory, "fixture.sog");
    await writeFile(path, bytes);
    const handle = await open(path, "r");
    const controller = new AbortController();
    let statCalls = 0;
    const observedHandle: FileHandle = new Proxy(handle, {
      get(target, property) {
        if (property === "stat") {
          return async () => {
            const stats = await target.stat();
            statCalls += 1;
            if (statCalls === 2) controller.abort();
            return stats;
          };
        }
        if (property === "read") return target.read.bind(target);
        throw new Error(`Unexpected file-handle property: ${String(property)}`);
      },
    });
    try {
      expectFailure(
        await inspectStoredZipSogV2SourceFacts(
          observedHandle,
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
          controller.signal,
        ),
        "SOG_INSPECTION_CANCELLED",
        "cancelled",
      );
      expect(statCalls).toBe(2);
    } finally {
      await handle.close();
    }
  });
});

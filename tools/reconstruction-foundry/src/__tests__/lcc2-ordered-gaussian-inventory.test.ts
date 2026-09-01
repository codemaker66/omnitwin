import { createHash } from "node:crypto";
import {
  appendFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { endianness, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  domainSeparatedSha256,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  decodeSogV2CoordinateV1,
  inspectOrderedSogMember,
  inspectOrderedSogMemberCoordinateStream,
  Lcc2ContainerValidationError,
} from "../lcc2-container-validation.js";
import {
  inspectLcc2OrderedGaussianInventory,
} from "../lcc2-ordered-gaussian-inventory.js";
import { parseLcc2OrderedGaussianInventoryArguments } from "../lcc2-ordered-gaussian-inventory-cli.js";
import {
  LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1,
  LCC2_SOG_COORDINATE_STREAM_LIMITS_V1,
  LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1,
  LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1,
  LCC2_SOG_COORDINATE_DECODER_V1,
  GRAND_HALL_BIG_SOG_V1_COORDINATE_SOURCE_PROFILE,
  checkLcc2SogCoordinateStream as checkLcc2SogCoordinateStreamLibrary,
  writeLcc2SogCoordinateStream as writeLcc2SogCoordinateStreamLibrary,
  type Lcc2SogCoordinateStreamExpectedSourceProfileV1,
  type Lcc2SogCoordinateStreamOptionsV1,
} from "../lcc2-sog-coordinate-stream.js";
import { parseLcc2SogCoordinateStreamArguments } from "../lcc2-sog-coordinate-stream-cli.js";

const cleanup: string[] = [];
const fixtureSourceProfiles = new Map<
  string,
  Promise<Lcc2SogCoordinateStreamExpectedSourceProfileV1>
>();

afterEach(async () => {
  fixtureSourceProfiles.clear();
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function makeStoredZip(entries: readonly { readonly name: string; readonly bytes: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "ascii");
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.bytes.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + entry.bytes.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

type Pixel = readonly [number, number, number, number];

async function webp(
  width: number,
  height: number,
  pixels: readonly Pixel[],
  lossless = true,
): Promise<Buffer> {
  if (pixels.length !== width * height) throw new Error("Test pixel grid mismatch.");
  return sharp(Buffer.from(pixels.flat()), {
    raw: { width, height, channels: 4 },
  }).webp(lossless ? { lossless: true } : { lossless: false, quality: 100 }).toBuffer();
}

function withDeclaredVp8lDimensions(bytes: Buffer, width: number, height: number): Buffer {
  const output = Buffer.from(bytes);
  const chunkOffset = output.indexOf(Buffer.from("VP8L", "ascii"));
  if (chunkOffset < 0) throw new Error("Test WebP has no VP8L chunk.");
  const dataOffset = chunkOffset + 8;
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  output[dataOffset + 1] = encodedWidth & 0xff;
  output[dataOffset + 2] = ((encodedWidth >>> 8) & 0x3f) | ((encodedHeight & 0x03) << 6);
  output[dataOffset + 3] = (encodedHeight >>> 2) & 0xff;
  output[dataOffset + 4] = (output[dataOffset + 4] ?? 0) & 0xf0 | ((encodedHeight >>> 10) & 0x0f);
  return output;
}

interface OrderedSogFixture {
  readonly bytes: Buffer;
  readonly positions: Buffer;
  readonly packed: Buffer;
}

async function makeOrderedSog(
  count: 1 | 2 | 3,
  seed = 0,
  options: {
    readonly invalidQuaternion?: boolean;
    readonly invalidLabel?: boolean;
    readonly lossyRole?: "means_l.webp";
    readonly trailingSeed?: number;
    readonly oversizedHeader?: boolean;
    readonly withoutShN?: boolean;
    readonly duplicateCountKey?: boolean;
    readonly escapedDuplicateCountKey?: boolean;
    readonly prohibitedMetaKey?: boolean;
    readonly meansMins?: readonly [number, number, number];
    readonly meansMaxs?: readonly [number, number, number];
  } = {},
): Promise<OrderedSogFixture> {
  const trailing = options.trailingSeed ?? 200;
  const meansLower: Pixel[] = [
    [1 + seed, 2, 3, 255],
    [4 + seed, 5, 6, 255],
    [7 + seed, 8, 9, 255],
    [trailing, trailing + 1, trailing + 2, 255],
  ];
  const meansUpper: Pixel[] = [
    [10, 11, 12, 255],
    [13, 14, 15, 255],
    [16, 17, 18, 255],
    [trailing + 3, trailing + 4, trailing + 5, 255],
  ];
  const scales: Pixel[] = [
    [21, 22, 23, 255],
    [24, 25, 26, 255],
    [27, 28, 29, 255],
    [trailing, trailing, trailing, 255],
  ];
  const quats: Pixel[] = [
    [31, 32, 33, options.invalidQuaternion === true ? 251 : 252],
    [34, 35, 36, 253],
    [37, 38, 39, 255],
    [trailing, trailing, trailing, 0],
  ];
  const sh0: Pixel[] = [
    [41, 42, 43, 44],
    [45, 46, 47, 48],
    [49, 50, 51, 52],
    [trailing, trailing, trailing, trailing],
  ];
  const labels: Pixel[] = [
    [0, 0, 0, 255],
    [1, 0, 0, 255],
    [options.invalidLabel === true ? 3 : 2, 0, 0, 255],
    [255, 255, 0, 255],
  ];
  const centroidPixels = Array.from<unknown, Pixel>({ length: 192 }, (_, index) => [
    index % 256,
    (index + 1) % 256,
    (index + 2) % 256,
    255,
  ]);
  const planes = new Map<string, Buffer>([
    ["means_l.webp", await webp(2, 2, meansLower, options.lossyRole !== "means_l.webp")],
    ["means_u.webp", await webp(2, 2, meansUpper)],
    ["scales.webp", await webp(2, 2, scales)],
    ["quats.webp", await webp(2, 2, quats)],
    ["sh0.webp", await webp(2, 2, sh0)],
  ]);
  if (options.withoutShN !== true) {
    planes.set("shN_centroids.webp", await webp(192, 1, centroidPixels));
    planes.set("shN_labels.webp", await webp(2, 2, labels));
  }
  if (options.oversizedHeader === true) {
    planes.set("means_l.webp", withDeclaredVp8lDimensions(planes.get("means_l.webp")!, 2_900, 2_900));
  }
  const metaBase = {
    version: 2,
    count,
    antialias: false,
    means: {
      mins: options.meansMins ?? [0, 0, 0],
      maxs: options.meansMaxs ?? [1, 1, 1],
      files: ["means_l.webp", "means_u.webp"],
    },
    scales: { codebook: Array.from({ length: 256 }, () => 0), files: ["scales.webp"] },
    quats: { files: ["quats.webp"] },
    sh0: { codebook: Array.from({ length: 256 }, () => 0), files: ["sh0.webp"] },
  };
  const meta = options.withoutShN === true ? metaBase : {
    ...metaBase,
    shN: {
      count: 3,
      bands: 1,
      codebook: Array.from({ length: 256 }, () => 0),
      files: ["shN_centroids.webp", "shN_labels.webp"],
    },
  };
  let metaJson = JSON.stringify(meta);
  if (options.duplicateCountKey === true) {
    metaJson = metaJson.replace(`"count":${String(count)}`, `"count":${String(count)},"count":${String(count)}`);
  }
  if (options.escapedDuplicateCountKey === true) {
    metaJson = metaJson.replace(`"count":${String(count)}`, `"count":${String(count)},"co\\u0075nt":${String(count)}`);
  }
  if (options.prohibitedMetaKey === true) {
    metaJson = `{"__proto__":{},${metaJson.slice(1)}`;
  }
  const bytes = makeStoredZip([
    ...[...planes].map(([name, planeBytes]) => ({ name, bytes: planeBytes })),
    { name: "meta.json", bytes: Buffer.from(metaJson, "utf8") },
  ]);
  const positions = Buffer.alloc(count * 6);
  const packedRecordBytes = options.withoutShN === true ? 17 : 19;
  const packed = Buffer.alloc(count * packedRecordBytes);
  for (let index = 0; index < count; index += 1) {
    const lo = meansLower[index]!;
    const hi = meansUpper[index]!;
    const scale = scales[index]!;
    const quat = quats[index]!;
    const color = sh0[index]!;
    const label = labels[index]!;
    const positionOffset = index * 6;
    const recordOffset = index * packedRecordBytes;
    const position = [lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]];
    positions.set(position, positionOffset);
    const record = [
      ...position,
      scale[0], scale[1], scale[2],
      quat[0], quat[1], quat[2], quat[3],
      color[0], color[1], color[2], color[3],
      ...(options.withoutShN === true ? [] : [label[0], label[1]]),
    ];
    packed.set(record, recordOffset);
  }
  return { bytes, positions, packed };
}

async function writeSog(bytes: Buffer, name = "fixture.sog"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lcc2-ordered-member-"));
  cleanup.push(root);
  const path = join(root, name);
  await writeFile(path, bytes);
  return path;
}

async function inspectFixture(fixture: OrderedSogFixture, path: string, count: number) {
  return inspectOrderedSogMember({
    absolutePath: path,
    relativePath: "fixture.sog",
    expectedSizeBytes: fixture.bytes.length,
    expectedSha256: `sha256:${sha256(fixture.bytes)}`,
    expectedGaussianCount: count,
  });
}

describe("inspectOrderedSogMember", () => {
  it("freezes the exact reviewed row-major record stream and ignores trailing pixels", async () => {
    const fixture = await makeOrderedSog(3);
    const path = await writeSog(fixture.bytes);
    const receipt = await inspectFixture(fixture, path, 3);

    expect(receipt.quantizedPositionSha256).toBe(`sha256:${sha256(fixture.positions)}`);
    expect(receipt.packedRecordSha256).toBe(`sha256:${sha256(fixture.packed)}`);
    expect(receipt.ignoredTrailingPixelCount).toBe(1);
    expect(receipt.packedRecordBytes).toBe(19);
    expect(receipt.proof).toEqual(expect.objectContaining({
      ordinalPolicy: "row_major_top_left_meta_count_v1",
      everyPropertyPlaneUsesLosslessVp8lCodec: true,
      decodedCoordinates: false,
      roomMembershipEstablished: false,
    }));
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.planes)).toBe(true);

    const differentTrailing = await makeOrderedSog(3, 0, { trailingSeed: 100 });
    const otherPath = await writeSog(differentTrailing.bytes, "other.sog");
    const other = await inspectFixture(differentTrailing, otherPath, 3);
    expect(other.sha256).not.toBe(receipt.sha256);
    expect(other.packedRecordSha256).toBe(receipt.packedRecordSha256);
    expect(other.quantizedPositionSha256).toBe(receipt.quantizedPositionSha256);
  });

  it("rejects lossy property planes, reserved quaternion modes, and out-of-range labels", async () => {
    for (const fixture of [
      await makeOrderedSog(3, 0, { lossyRole: "means_l.webp" }),
      await makeOrderedSog(3, 0, { invalidQuaternion: true }),
      await makeOrderedSog(3, 0, { invalidLabel: true }),
    ]) {
      const path = await writeSog(fixture.bytes);
      await expect(inspectFixture(fixture, path, 3)).rejects.toBeInstanceOf(Lcc2ContainerValidationError);
    }
  });

  it("uses the exact 17-byte record layout when higher-order SH is absent", async () => {
    const fixture = await makeOrderedSog(3, 0, { withoutShN: true });
    const path = await writeSog(fixture.bytes);
    const receipt = await inspectFixture(fixture, path, 3);
    expect(receipt.packedRecordBytes).toBe(17);
    expect(receipt.packedRecordSha256).toBe(`sha256:${sha256(fixture.packed)}`);
    expect(receipt.planes.map((plane) => plane.role)).not.toContain("shN_palette_labels");
    expect(receipt.planes.map((plane) => plane.role)).not.toContain("shN_centroids");
  });

  it("fails closed when its source changes during inspection", async () => {
    const fixture = await makeOrderedSog(3);
    const path = await writeSog(fixture.bytes);
    await expect(inspectOrderedSogMember({
      absolutePath: path,
      relativePath: "fixture.sog",
      expectedSizeBytes: fixture.bytes.length,
      expectedSha256: `sha256:${sha256(fixture.bytes)}`,
      expectedGaussianCount: 3,
      testHooks: {
        beforeFinalIdentityCheck: async () => appendFile(path, Buffer.from([0])),
      },
    })).rejects.toMatchObject({ code: "source_changed" });
  });

  it("rejects an oversized decoded grid before attempting full image decode", async () => {
    const fixture = await makeOrderedSog(3, 0, { oversizedHeader: true });
    const path = await writeSog(fixture.bytes);
    await expect(inspectFixture(fixture, path, 3)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("rejects literal, escaped-alias, and prohibited metadata keys plus linked source paths", async () => {
    for (const fixture of [
      await makeOrderedSog(3, 0, { duplicateCountKey: true }),
      await makeOrderedSog(3, 0, { escapedDuplicateCountKey: true }),
      await makeOrderedSog(3, 0, { prohibitedMetaKey: true }),
    ]) {
      const path = await writeSog(fixture.bytes);
      await expect(inspectFixture(fixture, path, 3)).rejects.toMatchObject({ code: "invalid" });
    }

    const fixture = await makeOrderedSog(3);
    const path = await writeSog(fixture.bytes, "original.sog");
    const linkedPath = join(dirname(path), "linked.sog");
    await link(path, linkedPath);
    await expect(inspectOrderedSogMember({
      absolutePath: linkedPath,
      relativePath: "linked.sog",
      expectedSizeBytes: fixture.bytes.length,
      expectedSha256: `sha256:${sha256(fixture.bytes)}`,
      expectedGaussianCount: 3,
    })).rejects.toMatchObject({ code: "source_changed" });
  });

  it("derives only from its immutable snapshot and still rejects mutate-then-restore custody", async () => {
    const fixture = await makeOrderedSog(3);
    const changed = await makeOrderedSog(3, 1);
    const path = await writeSog(fixture.bytes);
    await expect(inspectOrderedSogMember({
      absolutePath: path,
      relativePath: "fixture.sog",
      expectedSizeBytes: fixture.bytes.length,
      expectedSha256: `sha256:${sha256(fixture.bytes)}`,
      expectedGaussianCount: 3,
      testHooks: {
        afterSnapshot: async () => writeFile(path, changed.bytes),
        beforeFinalIdentityCheck: async () => writeFile(path, fixture.bytes),
      },
    })).rejects.toMatchObject({ code: "source_changed" });
  });

  it("clears ephemeral coordinate views immediately after the awaited consumer returns", async () => {
    const fixture = await makeOrderedSog(3);
    const path = await writeSog(fixture.bytes);
    let retainedQuantized: Buffer | undefined;
    let retainedFloat64: Buffer | undefined;
    await inspectOrderedSogMemberCoordinateStream({
      absolutePath: path,
      relativePath: "fixture.sog",
      expectedSizeBytes: fixture.bytes.length,
      expectedSha256: `sha256:${sha256(fixture.bytes)}`,
      expectedGaussianCount: 3,
      consumeCoordinateChunk: (chunk) => {
        retainedQuantized = chunk.quantizedUint16LeXyz;
        retainedFloat64 = chunk.dequantizedFloat64LeXyz;
        expect(retainedQuantized.some((value) => value !== 0)).toBe(true);
      },
      testHooks: {
        beforeFinalIdentityCheck: () => {
          expect(retainedQuantized?.every((value) => value === 0)).toBe(true);
          expect(retainedFloat64?.every((value) => value === 0)).toBe(true);
        },
      },
    });
  });
});

async function writeLcc2Fixture(options: {
  readonly oversizedLeaf?: boolean;
  readonly leafSeed?: number;
  readonly meansMins?: readonly [number, number, number];
  readonly meansMaxs?: readonly [number, number, number];
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lcc2-ordered-package-"));
  cleanup.push(root);
  const paths = ["data/3dgs/leaf-0.sog", "data/3dgs/leaf-1.sog", "data/3dgs/env.sog"];
  const fixtures = [
    await makeOrderedSog(2, options.leafSeed ?? 0, {
      oversizedHeader: options.oversizedLeaf,
      meansMins: options.meansMins,
      meansMaxs: options.meansMaxs,
    }),
    await makeOrderedSog(1, 60),
    await makeOrderedSog(1, 90),
  ];
  for (let index = 0; index < paths.length; index += 1) {
    const path = join(root, ...paths[index]!.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, fixtures[index]!.bytes);
  }
  const manifest = {
    version: "0.0.3",
    guid: "0123456789abcdef0123456789abcdef",
    fileType: "quality",
    splatType: ".sog",
    totalLevels: 1,
    lodSplats: [3],
    totalSplats: 3,
    env: { type: "splats", splatsCount: 1 },
    root: {
      id: "0",
      childNum: 2,
      splatFiles: paths,
      data: { env: { name: 2 } },
      child: {
        "0": { id: "0_0", childNum: 0, data: { "3dgs": { name: 0, start: 0, count: 2 } } },
        "1": { id: "0_1", childNum: 0, data: { "3dgs": { name: 1, start: 0, count: 1 } } },
      },
    },
  };
  const manifestPath = join(root, "scene.lcc2");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

async function expectedFixtureSourceProfile(
  manifestPath: string,
): Promise<Lcc2SogCoordinateStreamExpectedSourceProfileV1> {
  const cached = fixtureSourceProfiles.get(manifestPath);
  if (cached !== undefined) return cached;
  const pending = inspectLcc2OrderedGaussianInventory({ manifestPath }).then((receipt) => ({
    profileId: "synthetic-lcc2-sog-v1",
    gaussianCount: receipt.inventory.gaussianCount,
    memberCount: receipt.inventory.members.length,
    ordinalInventorySha256: receipt.inventory.ordinalInventorySha256,
    orderedInventoryReceiptSha256: receipt.receiptSha256,
  }));
  fixtureSourceProfiles.set(manifestPath, pending);
  return pending;
}

type FixtureCoordinateStreamOptions = Omit<
  Lcc2SogCoordinateStreamOptionsV1,
  "expectedSourceProfile"
> & {
  readonly expectedSourceProfile?: Lcc2SogCoordinateStreamExpectedSourceProfileV1;
};

async function writeLcc2SogCoordinateStream(
  options: FixtureCoordinateStreamOptions,
) {
  return writeLcc2SogCoordinateStreamLibrary({
    ...options,
    expectedSourceProfile: options.expectedSourceProfile ??
      await expectedFixtureSourceProfile(options.manifestPath),
  });
}

async function checkLcc2SogCoordinateStream(
  options: FixtureCoordinateStreamOptions,
) {
  return checkLcc2SogCoordinateStreamLibrary({
    ...options,
    expectedSourceProfile: options.expectedSourceProfile ??
      await expectedFixtureSourceProfile(options.manifestPath),
  });
}

async function writeManifestOnlyLimitFixture(input: {
  readonly gaussianCount: number;
  readonly memberCount: number;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lcc2-coordinate-limit-package-"));
  cleanup.push(root);
  const memberPaths = Array.from(
    { length: input.memberCount },
    (_, index) => `data/3dgs/leaf-${String(index)}.sog`,
  );
  const environmentPath = "data/3dgs/env.sog";
  const perMemberCounts = Array.from({ length: input.memberCount }, (_, index) =>
    index === 0 ? input.gaussianCount - (input.memberCount - 1) : 1);
  const manifest = {
    version: "0.0.3",
    guid: "0123456789abcdef0123456789abcdef",
    fileType: "quality",
    splatType: ".sog",
    totalLevels: 1,
    lodSplats: [input.gaussianCount],
    totalSplats: input.gaussianCount,
    env: { type: "splats", splatsCount: 1 },
    root: {
      id: "0",
      childNum: input.memberCount,
      splatFiles: [...memberPaths, environmentPath],
      data: { env: { name: input.memberCount } },
      child: Object.fromEntries(perMemberCounts.map((count, index) => [
        String(index),
        {
          id: `0_${String(index)}`,
          childNum: 0,
          data: { "3dgs": { name: index, start: 0, count } },
        },
      ])),
    },
  };
  const manifestPath = join(root, "scene.lcc2");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

const boundedDummySourceProfile: Lcc2SogCoordinateStreamExpectedSourceProfileV1 = {
  profileId: "bounded-test-profile-v1",
  gaussianCount: 3,
  memberCount: 2,
  ordinalInventorySha256: `sha256:${"0".repeat(64)}`,
  orderedInventoryReceiptSha256: `sha256:${"1".repeat(64)}`,
};

describe("inspectLcc2OrderedGaussianInventory", () => {
  it("assigns one exact contiguous global ordinal domain in file-index order", async () => {
    const manifestPath = await writeLcc2Fixture();
    const receipt = await inspectLcc2OrderedGaussianInventory({ manifestPath });
    expect(receipt.inventory.gaussianCount).toBe(3);
    expect(receipt.inventory.members.map((member) => ({
      fileIndex: member.fileIndex,
      start: member.globalStart,
      end: member.globalEndExclusive,
    }))).toEqual([
      { fileIndex: 0, start: 0, end: 2 },
      { fileIndex: 1, start: 2, end: 3 },
    ]);
    expect(receipt.proof).toEqual(expect.objectContaining({
      environmentPolicy: "exclude",
      environmentIncludedInOrdinalInventory: false,
      coordinateFrameEstablished: false,
      roomMembershipEstablished: false,
      authority: "none",
      sourceWrites: "none",
    }));
    const ordinalMaterial = {
      sourceFrontierReceiptSha256: receipt.sourceFrontier.receiptSha256,
      memberTraversalPolicy: receipt.inventory.memberTraversalPolicy,
      localOrdinalPolicy: receipt.inventory.localOrdinalPolicy,
      gaussianCount: receipt.inventory.gaussianCount,
      members: receipt.inventory.members.map((member) => ({
        fileIndex: member.fileIndex,
        relativePath: member.relativePath,
        globalStart: member.globalStart,
        globalEndExclusive: member.globalEndExclusive,
        gaussianCount: member.gaussianCount,
        sha256: member.sha256,
        metaJsonSha256: member.metaJsonSha256,
        quantizedPositionSha256: member.quantizedPositionSha256,
        packedRecordSha256: member.packedRecordSha256,
        planes: member.planes,
      })),
    };
    expect(receipt.inventory.ordinalInventorySha256).toBe(`sha256:${domainSeparatedSha256(
      "OMNITWIN_LCC2_ORDERED_GAUSSIAN_INVENTORY_V1",
      toCanonicalJson(ordinalMaterial),
    )}`);
    expect(domainSeparatedSha256(
      "OMNITWIN_LCC2_ORDERED_GAUSSIAN_INVENTORY_V1",
      toCanonicalJson({ ...ordinalMaterial, members: [...ordinalMaterial.members].reverse() }),
    )).not.toBe(receipt.inventory.ordinalInventorySha256.slice("sha256:".length));
    const { receiptSha256, ...receiptMaterial } = receipt;
    expect(receiptSha256).toBe(`sha256:${domainSeparatedSha256(
      "OMNITWIN_LCC2_ORDERED_GAUSSIAN_INVENTORY_RECEIPT_V1",
      toCanonicalJson(receiptMaterial),
    )}`);
    expect(Object.isFrozen(receipt.inventory.members[0])).toBe(true);
  });

  it("is deterministic for identical packages and sensitive to one in-range property change", async () => {
    const first = await inspectLcc2OrderedGaussianInventory({ manifestPath: await writeLcc2Fixture() });
    const identical = await inspectLcc2OrderedGaussianInventory({ manifestPath: await writeLcc2Fixture() });
    const changed = await inspectLcc2OrderedGaussianInventory({
      manifestPath: await writeLcc2Fixture({ leafSeed: 1 }),
    });
    expect(identical.inventory.ordinalInventorySha256).toBe(first.inventory.ordinalInventorySha256);
    expect(identical.receiptSha256).toBe(first.receiptSha256);
    expect(changed.inventory.ordinalInventorySha256).not.toBe(first.inventory.ordinalInventorySha256);
    expect(changed.receiptSha256).not.toBe(first.receiptSha256);
  });

  it("fails closed when a selected file changes before the final frontier proof", async () => {
    const manifestPath = await writeLcc2Fixture();
    await expect(inspectLcc2OrderedGaussianInventory({
      manifestPath,
      testHooks: {
        beforeFinalFrontierInspection: async () => appendFile(
          join(dirname(manifestPath), "data", "3dgs", "leaf-0.sog"),
          Buffer.from([0]),
        ),
      },
    })).rejects.toMatchObject({ code: "LCC2_CONTAINER_INVALID" });
  });

  it("threads its decoded-image cap through the initial frontier validation", async () => {
    const manifestPath = await writeLcc2Fixture({ oversizedLeaf: true });
    await expect(inspectLcc2OrderedGaussianInventory({ manifestPath })).rejects.toMatchObject({
      code: "LCC2_CONTAINER_UNSUPPORTED",
    });
  });
});

describe("parseLcc2OrderedGaussianInventoryArguments", () => {
  it("requires exactly one manifest and exposes no environment override", () => {
    expect(parseLcc2OrderedGaussianInventoryArguments(["--manifest", "C:\\capture\\scene.lcc2"]))
      .toEqual({ manifestPath: "C:\\capture\\scene.lcc2" });
    expect(parseLcc2OrderedGaussianInventoryArguments(["--help"])).toBeNull();
    expect(() => parseLcc2OrderedGaussianInventoryArguments([
      "--manifest", "C:\\capture\\scene.lcc2", "--environment", "include",
    ])).toThrow(/Unknown/u);
  });
});

function expectedFixtureQuantizedCoordinates(): Buffer {
  return Buffer.from([
    1, 10, 2, 11, 3, 12,
    4, 13, 5, 14, 6, 15,
    61, 10, 2, 11, 3, 12,
  ]);
}

function expectedUnloggedCoordinate(low: number, high: number): number {
  const quantized = low | (high << 8);
  const normalizedLogCoordinate = quantized / 65_535;
  return normalizedLogCoordinate < 0
    ? -(Math.exp(Math.abs(normalizedLogCoordinate)) - 1)
    : Math.exp(Math.abs(normalizedLogCoordinate)) - 1;
}

describe("LCC2 SOG coordinate stream", () => {
  it("pins the only real CLI source profile and the bounded adapter ceilings", () => {
    expect(LCC2_SOG_COORDINATE_STREAM_LIMITS_V1).toEqual({
      maximumGaussianCount: 8_000_000,
      maximumMemberCount: 64,
    });
    expect(GRAND_HALL_BIG_SOG_V1_COORDINATE_SOURCE_PROFILE).toEqual({
      profileId: "grand-hall-big-sog-v1",
      gaussianCount: 6_019_684,
      memberCount: 11,
      ordinalInventorySha256: "sha256:e8d7c8d94b246bfb1e047088af31e4fcb74c34c65ed67c16435995a4f46ab46d",
      orderedInventoryReceiptSha256: "sha256:247cdad37b50821a9b06c59a139e3e6897c8b8c318c9c78de15b3c26187b30e3",
    });
    expect(Object.isFrozen(LCC2_SOG_COORDINATE_STREAM_LIMITS_V1)).toBe(true);
    expect(Object.isFrozen(GRAND_HALL_BIG_SOG_V1_COORDINATE_SOURCE_PROFILE)).toBe(true);
  });

  it("pins SOG v2 endpoint, midpoint, negative, zero, and degenerate-bound arithmetic", () => {
    const reference = (minimum: number, maximum: number, quantized: number): number => {
      const scale = (maximum - minimum) || 1;
      const logCoordinate = minimum + scale * (quantized / 65_535);
      const magnitude = Math.exp(Math.abs(logCoordinate)) - 1;
      return logCoordinate < 0 ? -magnitude : magnitude;
    };
    expect(decodeSogV2CoordinateV1(-2, 3, 0)).toBe(reference(-2, 3, 0));
    expect(decodeSogV2CoordinateV1(-2, 3, 65_535)).toBe(reference(-2, 3, 65_535));
    expect(decodeSogV2CoordinateV1(-2, 3, 32_768)).toBe(reference(-2, 3, 32_768));
    expect(decodeSogV2CoordinateV1(-2, -1, 17)).toBe(reference(-2, -1, 17));
    expect(Object.is(decodeSogV2CoordinateV1(-0, -0, 0), -0)).toBe(false);
    expect(decodeSogV2CoordinateV1(0.75, 0.75, 0)).toBe(reference(0.75, 0.75, 0));
    expect(decodeSogV2CoordinateV1(0.75, 0.75, 65_535)).toBe(reference(0.75, 0.75, 65_535));
    expect(decodeSogV2CoordinateV1(0.75, 0.75, 0))
      .not.toBe(decodeSogV2CoordinateV1(0.75, 0.75, 65_535));

    const float64Le = (value: number): string => {
      const bytes = Buffer.alloc(8);
      bytes.writeDoubleLE(value);
      return bytes.toString("hex");
    };
    expect(float64Le(decodeSogV2CoordinateV1(-2, 3, 0))).toBe("aeddd4b8648e19c0");
    expect(float64Le(decodeSogV2CoordinateV1(-2, 3, 65_535))).toBe("06b16fbfe5153340");
    expect(float64Le(decodeSogV2CoordinateV1(-2, 3, 32_768))).toBe("389b3403d7c2e43f");
    expect(float64Le(decodeSogV2CoordinateV1(0.75, 0.75, 0))).toBe("f0b9cf683bdff13f");
    expect(float64Le(decodeSogV2CoordinateV1(0.75, 0.75, 65_535))).toBe("beac5b90b6041340");
    expect(float64Le(decodeSogV2CoordinateV1(-0, -0, 0))).toBe("0000000000000000");
  });

  it("publishes exact manifest/member/global order with the public SOG v2 symmetric-log inverse", async () => {
    const manifestPath = await writeLcc2Fixture();
    const outputParent = await mkdtemp(join(tmpdir(), "lcc2-coordinate-output-"));
    cleanup.push(outputParent);
    const outputDirectory = join(outputParent, "coordinate-stream");

    const receipt = await writeLcc2SogCoordinateStream({ manifestPath, outputDirectory });
    const quantized = await readFile(join(outputDirectory, LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1));
    const float64 = await readFile(join(outputDirectory, LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1));
    const expectedQuantized = expectedFixtureQuantizedCoordinates();

    expect(quantized).toEqual(expectedQuantized);
    expect(float64.length).toBe(3 * 3 * 8);
    for (let gaussian = 0; gaussian < 3; gaussian += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const quantizedOffset = gaussian * 6 + axis * 2;
        expect(float64.readDoubleLE(gaussian * 24 + axis * 8)).toBe(
          expectedUnloggedCoordinate(
            expectedQuantized[quantizedOffset] ?? 0,
            expectedQuantized[quantizedOffset + 1] ?? 0,
          ),
        );
      }
    }
    expect(receipt.stream.gaussianCount).toBe(3);
    expect(receipt.sourceProfile).toEqual(await expectedFixtureSourceProfile(manifestPath));
    expect(receipt.limits).toEqual(LCC2_SOG_COORDINATE_STREAM_LIMITS_V1);
    expect(receipt.stream.decoder).toEqual(LCC2_SOG_COORDINATE_DECODER_V1);
    expect(receipt.stream.emitterRuntime).toEqual({
      nodeVersion: process.version,
      v8Version: process.versions.v8,
      platform: process.platform,
      architecture: process.arch,
      hostByteOrder: endianness(),
      outputByteOrder: "explicit_little_endian_buffer_writes",
    });
    const quantizedMins = [2_561, 2_818, 3_075] as const;
    const quantizedMaxs = [3_332, 3_589, 3_846] as const;
    const float64Mins = quantizedMins.map((value) => decodeSogV2CoordinateV1(0, 1, value));
    const float64Maxs = quantizedMaxs.map((value) => decodeSogV2CoordinateV1(0, 1, value));
    expect(receipt.stream.statistics).toEqual({
      quantizedUint16: { mins: quantizedMins, maxs: quantizedMaxs },
      decodedFloat64PreFround: {
        mins: float64Mins,
        maxs: float64Maxs,
        finiteCounts: [3, 3, 3],
        nonFiniteCounts: [0, 0, 0],
      },
      referenceFloat32Projection: {
        projection: "Math.fround",
        mins: float64Mins.map(Math.fround),
        maxs: float64Maxs.map(Math.fround),
        finiteCounts: [3, 3, 3],
        nonFiniteCounts: [0, 0, 0],
      },
    });
    expect(receipt.stream.members.map(({ statistics }) =>
      statistics.decodedFloat64PreFround.finiteCounts)).toEqual([
      [2, 2, 2],
      [1, 1, 1],
    ]);
    expect(receipt.stream.members.map((member) => ({
      fileIndex: member.fileIndex,
      start: member.globalStart,
      end: member.globalEndExclusive,
    }))).toEqual([
      { fileIndex: 0, start: 0, end: 2 },
      { fileIndex: 1, start: 2, end: 3 },
    ]);
    expect(receipt.proof).toEqual(expect.objectContaining({
      authority: "none",
      coordinatesDequantizedFromExactSogV2Bytes: true,
      everyDecodedFloat64AndReferenceFloat32Finite: true,
      expectedSourceProfileMatched: true,
      sourceLimitsCheckedBeforeCoordinateDecode: true,
      sourceLimitsCheckedBeforeOutputBodyCreation: true,
      independentReferenceComparisonPerformed: false,
      coordinateFrameEstablished: false,
      roomMembershipEstablished: false,
      maskProduced: false,
      transformProduced: false,
      transformAccepted: false,
      trainingPerformed: false,
      reconstructionPerformed: false,
      generatedContentAdded: false,
      runtimeAdmissionGranted: false,
      productionTrust: null,
    }));
    expect(JSON.parse(await readFile(
      join(outputDirectory, LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1),
      "utf8",
    ))).toEqual(receipt);

    const before = await Promise.all([
      LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1,
      LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1,
      LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1,
    ].map((name) => lstat(join(outputDirectory, name))));
    await expect(checkLcc2SogCoordinateStream({ manifestPath, outputDirectory })).resolves.toEqual(receipt);
    const after = await Promise.all([
      LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1,
      LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1,
      LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1,
    ].map((name) => lstat(join(outputDirectory, name))));
    expect(after.map(({ size, mtimeMs, ctimeMs }) => ({ size, mtimeMs, ctimeMs })))
      .toEqual(before.map(({ size, mtimeMs, ctimeMs }) => ({ size, mtimeMs, ctimeMs })));
  });

  it("normalizes an equivalent output spelling before post-publication verification", async () => {
    const manifestPath = await writeLcc2Fixture();
    const outputParent = await mkdtemp(join(tmpdir(), "lcc2-coordinate-output-"));
    cleanup.push(outputParent);
    const outputDirectory = join(outputParent, "coordinate-stream");
    const equivalentOutputSpelling = `${outputDirectory}${sep}`;

    const receipt = await writeLcc2SogCoordinateStream({
      manifestPath,
      outputDirectory: equivalentOutputSpelling,
    });

    expect(receipt.stream.gaussianCount).toBe(3);
    await expect(checkLcc2SogCoordinateStream({ manifestPath, outputDirectory }))
      .resolves.toEqual(receipt);
    expect((await readdir(outputDirectory)).sort()).toEqual([
      LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1,
      LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1,
      LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1,
    ].sort());
  });

  it.runIf(process.platform === "win32")(
    "rejects Windows file-namespace aliases before source/output containment checks",
    async () => {
      const manifestPath = await writeLcc2Fixture();
      const expectedSourceProfile = await expectedFixtureSourceProfile(manifestPath);
      const outputParent = await mkdtemp(join(tmpdir(), "lcc2-coordinate-output-"));
      cleanup.push(outputParent);
      const outputInsideSource = join(dirname(manifestPath), "unsafe-coordinate-output");
      const namespacedOutputInsideSource = `\\\\?\\${outputInsideSource}`;
      const ordinaryOutput = join(outputParent, "ordinary-output");
      const namespacedManifest = `\\\\?\\${manifestPath}`;

      await expect(writeLcc2SogCoordinateStreamLibrary({
        manifestPath,
        outputDirectory: namespacedOutputInsideSource,
        expectedSourceProfile,
      })).rejects.toMatchObject({ code: "LCC2_COORDINATE_ARGUMENT_INVALID" });
      await expect(writeLcc2SogCoordinateStreamLibrary({
        manifestPath: namespacedManifest,
        outputDirectory: ordinaryOutput,
        expectedSourceProfile,
      })).rejects.toMatchObject({ code: "LCC2_COORDINATE_ARGUMENT_INVALID" });
      await expect(lstat(outputInsideSource)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(ordinaryOutput)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("rejects over-total and over-member manifest plans before staging or coordinate decoding", async () => {
    const outputParent = await mkdtemp(join(tmpdir(), "lcc2-coordinate-limit-output-"));
    cleanup.push(outputParent);
    const cases = [
      {
        label: "over-total",
        manifestPath: await writeManifestOnlyLimitFixture({
          gaussianCount: LCC2_SOG_COORDINATE_STREAM_LIMITS_V1.maximumGaussianCount + 1,
          memberCount: 1,
        }),
      },
      {
        label: "over-members",
        manifestPath: await writeManifestOnlyLimitFixture({
          gaussianCount: LCC2_SOG_COORDINATE_STREAM_LIMITS_V1.maximumMemberCount + 1,
          memberCount: LCC2_SOG_COORDINATE_STREAM_LIMITS_V1.maximumMemberCount + 1,
        }),
      },
    ] as const;
    for (const testCase of cases) {
      const outputDirectory = join(outputParent, testCase.label);
      let stagingClaimed = false;
      await expect(writeLcc2SogCoordinateStreamLibrary({
        manifestPath: testCase.manifestPath,
        outputDirectory,
        expectedSourceProfile: boundedDummySourceProfile,
        testHooks: {
          afterStagingClaimed: () => {
            stagingClaimed = true;
          },
        },
      })).rejects.toMatchObject({ code: "LCC2_COORDINATE_LIMIT_EXCEEDED" });
      expect(stagingClaimed).toBe(false);
      await expect(lstat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect((await readdir(outputParent)).filter((name) => name.includes(".staging-"))).toEqual([]);
  });

  it("rejects wrong expected counts, ordinal identity, or ordered-receipt identity before publication", async () => {
    const manifestPath = await writeLcc2Fixture();
    const expected = await expectedFixtureSourceProfile(manifestPath);
    const outputParent = await mkdtemp(join(tmpdir(), "lcc2-coordinate-profile-output-"));
    cleanup.push(outputParent);
    const wrongProfiles = [
      {
        ...expected,
        gaussianCount: expected.gaussianCount + 1,
      },
      {
        ...expected,
        memberCount: expected.memberCount + 1,
      },
      {
        ...expected,
        ordinalInventorySha256: `sha256:${"a".repeat(64)}`,
      },
      {
        ...expected,
        orderedInventoryReceiptSha256: `sha256:${"b".repeat(64)}`,
      },
    ] as const;
    for (const [index, expectedSourceProfile] of wrongProfiles.entries()) {
      const outputDirectory = join(outputParent, `wrong-profile-${String(index)}`);
      let publishAttempted = false;
      await expect(writeLcc2SogCoordinateStreamLibrary({
        manifestPath,
        outputDirectory,
        expectedSourceProfile,
        testHooks: {
          beforePublish: () => {
            publishAttempted = true;
          },
        },
      })).rejects.toMatchObject({ code: "LCC2_COORDINATE_SOURCE_PROFILE_MISMATCH" });
      expect(publishAttempted).toBe(false);
      await expect(lstat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect((await readdir(outputParent)).filter((name) => name.includes(".staging-"))).toEqual([]);
  });

  it("is create-only, detects a changed body in zero-write check mode, and preserves the first publication", async () => {
    const manifestPath = await writeLcc2Fixture();
    const outputParent = await mkdtemp(join(tmpdir(), "lcc2-coordinate-output-"));
    cleanup.push(outputParent);
    const outputDirectory = join(outputParent, "coordinate-stream");
    const first = await writeLcc2SogCoordinateStream({ manifestPath, outputDirectory });

    await expect(writeLcc2SogCoordinateStream({ manifestPath, outputDirectory }))
      .rejects.toMatchObject({ code: "LCC2_COORDINATE_OUTPUT_EXISTS" });
    expect(JSON.parse(await readFile(
      join(outputDirectory, LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1),
      "utf8",
    ))).toEqual(first);

    const quantizedPath = join(outputDirectory, LCC2_SOG_COORDINATE_STREAM_QUANTIZED_FILE_V1);
    const changed = await readFile(quantizedPath);
    changed[0] = (changed[0] ?? 0) ^ 0xff;
    await writeFile(quantizedPath, changed);
    await expect(checkLcc2SogCoordinateStream({ manifestPath, outputDirectory }))
      .rejects.toMatchObject({ code: "LCC2_COORDINATE_OUTPUT_MISMATCH" });
  });

  it("rejects float64 drift, receipt drift, and an extra output member", async () => {
    const manifestPath = await writeLcc2Fixture();
    const outputParent = await mkdtemp(join(tmpdir(), "lcc2-coordinate-output-"));
    cleanup.push(outputParent);

    const float64Output = join(outputParent, "float64-drift");
    await writeLcc2SogCoordinateStream({ manifestPath, outputDirectory: float64Output });
    const float64Path = join(float64Output, LCC2_SOG_COORDINATE_STREAM_FLOAT64_FILE_V1);
    const changedFloat64 = await readFile(float64Path);
    changedFloat64[changedFloat64.length - 1] = (changedFloat64[changedFloat64.length - 1] ?? 0) ^ 0x80;
    await writeFile(float64Path, changedFloat64);
    await expect(checkLcc2SogCoordinateStream({ manifestPath, outputDirectory: float64Output }))
      .rejects.toMatchObject({ code: "LCC2_COORDINATE_OUTPUT_MISMATCH" });

    const receiptOutput = join(outputParent, "receipt-drift");
    await writeLcc2SogCoordinateStream({ manifestPath, outputDirectory: receiptOutput });
    const receiptPath = join(receiptOutput, LCC2_SOG_COORDINATE_STREAM_RECEIPT_FILE_V1);
    await appendFile(receiptPath, Buffer.from(" ", "ascii"));
    await expect(checkLcc2SogCoordinateStream({ manifestPath, outputDirectory: receiptOutput }))
      .rejects.toMatchObject({ code: "LCC2_COORDINATE_OUTPUT_MISMATCH" });

    const extraOutput = join(outputParent, "extra-file");
    await writeLcc2SogCoordinateStream({ manifestPath, outputDirectory: extraOutput });
    await writeFile(join(extraOutput, "unexpected.bin"), Buffer.from([1]));
    await expect(checkLcc2SogCoordinateStream({ manifestPath, outputDirectory: extraOutput }))
      .rejects.toMatchObject({ code: "LCC2_COORDINATE_OUTPUT_MISMATCH" });
  });

  it("maps a rejected body-handle write and removes only its owned private staging directory", async () => {
    const manifestPath = await writeLcc2Fixture();
    const outputParent = await mkdtemp(join(tmpdir(), "lcc2-coordinate-output-"));
    cleanup.push(outputParent);
    const outputDirectory = join(outputParent, "write-failure");
    await expect(writeLcc2SogCoordinateStream({
      manifestPath,
      outputDirectory,
      testHooks: {
        beforeFirstBodyWrite: async ({ closeBodyHandles }) => closeBodyHandles(),
      },
    })).rejects.toMatchObject({ code: "LCC2_COORDINATE_OUTPUT_WRITE_FAILED" });
    await expect(lstat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(outputParent)).filter((name) => name.includes(".staging-"))).toEqual([]);
  });

  it("cleans its private staging directory on source drift and never replaces a racing target", async () => {
    const manifestPath = await writeLcc2Fixture();
    const outputParent = await mkdtemp(join(tmpdir(), "lcc2-coordinate-output-"));
    cleanup.push(outputParent);
    const driftTarget = join(outputParent, "drift");
    await expect(writeLcc2SogCoordinateStream({
      manifestPath,
      outputDirectory: driftTarget,
      testHooks: {
        beforeFinalInventoryInspection: async () => appendFile(
          join(dirname(manifestPath), "data", "3dgs", "leaf-0.sog"),
          Buffer.from([0]),
        ),
      },
    })).rejects.toBeInstanceOf(Error);
    await expect(lstat(driftTarget)).rejects.toMatchObject({ code: "ENOENT" });

    const racingManifest = await writeLcc2Fixture();
    const racingTarget = join(outputParent, "racing");
    await expect(writeLcc2SogCoordinateStream({
      manifestPath: racingManifest,
      outputDirectory: racingTarget,
      testHooks: {
        beforePublish: async ({ targetDirectory }) => mkdir(targetDirectory),
      },
    })).rejects.toMatchObject({ code: "LCC2_COORDINATE_OUTPUT_EXISTS" });
    expect((await lstat(racingTarget)).isDirectory()).toBe(true);
  });

  it("rejects non-finite symmetric-log recovery and a replaced check target", async () => {
    const manifestPath = await writeLcc2Fixture({
      meansMins: [1_000, 1_000, 1_000],
      meansMaxs: [1_001, 1_001, 1_001],
    });
    const outputParent = await mkdtemp(join(tmpdir(), "lcc2-coordinate-output-"));
    cleanup.push(outputParent);
    await expect(writeLcc2SogCoordinateStream({
      manifestPath,
      outputDirectory: join(outputParent, "overflow"),
    })).rejects.toMatchObject({ code: "LCC2_COORDINATE_DECODE_INVALID" });

    const stableManifest = await writeLcc2Fixture();
    const outputDirectory = join(outputParent, "replace-race");
    await writeLcc2SogCoordinateStream({ manifestPath: stableManifest, outputDirectory });
    const moved = join(outputParent, "moved-original");
    await expect(checkLcc2SogCoordinateStream({
      manifestPath: stableManifest,
      outputDirectory,
      testHooks: {
        afterOutputIdentityRead: async ({ targetDirectory }) => {
          await rename(targetDirectory, moved);
          await mkdir(targetDirectory);
        },
      },
    })).rejects.toMatchObject({ code: "LCC2_COORDINATE_OUTPUT_UNSAFE" });
  });
});

describe("parseLcc2SogCoordinateStreamArguments", () => {
  it("requires the one named Grand Hall profile plus an explicit mode and manifest/output pair", () => {
    expect(parseLcc2SogCoordinateStreamArguments([
      "write", "--profile", "grand-hall-big-sog-v1",
      "--manifest", "C:\\capture\\scene.lcc2", "--output", "D:\\evidence\\coordinates",
    ])).toEqual({
      mode: "write",
      profile: "grand-hall-big-sog-v1",
      manifestPath: "C:\\capture\\scene.lcc2",
      outputDirectory: "D:\\evidence\\coordinates",
    });
    expect(parseLcc2SogCoordinateStreamArguments(["--help"])).toBeNull();
    expect(() => parseLcc2SogCoordinateStreamArguments([
      "check", "--profile", "grand-hall-big-sog-v1",
      "--manifest", "C:\\capture\\scene.lcc2", "--output", "D:\\evidence\\coordinates", "--mask", "x",
    ])).toThrow(/Unknown/u);
    expect(() => parseLcc2SogCoordinateStreamArguments([
      "write", "--profile", "arbitrary-source",
      "--manifest", "C:\\capture\\scene.lcc2", "--output", "D:\\evidence\\coordinates",
    ])).toThrow(/grand-hall-big-sog-v1/u);
    expect(() => parseLcc2SogCoordinateStreamArguments([
      "write", "--manifest", "C:\\capture\\scene.lcc2", "--output", "D:\\evidence\\coordinates",
    ])).toThrow(/--profile is required/u);
    expect(() => parseLcc2SogCoordinateStreamArguments([
      "write", "--profile", "grand-hall-big-sog-v1",
      "--manifest", "C:\\capture\\scene.lcc2", "--output", "D:\\evidence\\coordinates",
      "--ordinal-sha256", `sha256:${"0".repeat(64)}`,
    ])).toThrow(/Unknown/u);
  });
});

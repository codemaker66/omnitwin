import { createHash } from "node:crypto";
import {
  appendFile,
  link,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  domainSeparatedSha256,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  inspectOrderedSogMember,
  Lcc2ContainerValidationError,
} from "../lcc2-container-validation.js";
import {
  inspectLcc2OrderedGaussianInventory,
} from "../lcc2-ordered-gaussian-inventory.js";
import { parseLcc2OrderedGaussianInventoryArguments } from "../lcc2-ordered-gaussian-inventory-cli.js";

const cleanup: string[] = [];

afterEach(async () => {
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
    means: { mins: [0, 0, 0], maxs: [1, 1, 1], files: ["means_l.webp", "means_u.webp"] },
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
});

async function writeLcc2Fixture(options: {
  readonly oversizedLeaf?: boolean;
  readonly leafSeed?: number;
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lcc2-ordered-package-"));
  cleanup.push(root);
  const paths = ["data/3dgs/leaf-0.sog", "data/3dgs/leaf-1.sog", "data/3dgs/env.sog"];
  const fixtures = [
    await makeOrderedSog(2, options.leafSeed ?? 0, { oversizedHeader: options.oversizedLeaf }),
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

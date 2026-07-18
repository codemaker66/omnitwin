import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compileLcc2HighestDetailFrontier,
  inspectLcc2HighestDetailFrontier,
} from "../lcc2-frontier.js";
import { validateLcc2Container } from "../lcc2-container-validation.js";

interface TestNode {
  readonly id: string;
  childNum: number;
  child?: Record<string, TestNode>;
  data?: {
    "3dgs"?: {
      name: number;
      start: number;
      count: number;
    };
    env?: { name: number };
  };
}

interface TestManifest {
  version: "0.0.3";
  guid: string;
  fileType: string;
  splatType: ".sog" | ".spz";
  totalLevels: number;
  lodSplats: number[];
  totalSplats: number;
  env: { type: "splats"; splatsCount: number };
  root: TestNode & {
    splatFiles: string[];
    data: { env: { name: number } };
  };
}

interface Fixture {
  readonly root: string;
  readonly manifestPath: string;
  readonly manifest: TestManifest;
}

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function shapedManifest(
  levelWidths: readonly number[],
  fileCounts: readonly number[],
  splatType: ".sog" | ".spz" = ".sog",
): TestManifest {
  if (levelWidths.length !== fileCounts.length) throw new Error("Test shape mismatch");
  const root: TestManifest["root"] = {
    id: "0",
    childNum: 0,
    splatFiles: [],
    data: { env: { name: -1 } },
  };
  const levels: TestNode[][] = [];
  let parents: TestNode[] = [root];
  for (const [depthOffset, width] of levelWidths.entries()) {
    if (width < parents.length) throw new Error("Every test parent needs at least one child");
    const nodes: TestNode[] = [];
    for (let index = 0; index < width; index += 1) {
      const parent = parents[index % parents.length]!;
      parent.child ??= {};
      const key = String(Object.keys(parent.child).length);
      const node: TestNode = { id: `${parent.id}_${key}`, childNum: 0 };
      parent.child[key] = node;
      parent.childNum += 1;
      nodes.push(node);
    }
    levels.push(nodes);
    parents = nodes;
    if (depthOffset + 1 === levelWidths.length) {
      expect(nodes).toHaveLength(width);
    }
  }

  const splatFiles: string[] = [];
  const levelFileIndexes: number[][] = [];
  for (const [depthOffset, count] of fileCounts.entries()) {
    const indexes: number[] = [];
    for (let file = 0; file < count; file += 1) {
      indexes.push(splatFiles.length);
      splatFiles.push(`data/3dgs/depth-${String(depthOffset + 1)}-part-${String(file)}${splatType}`);
    }
    levelFileIndexes.push(indexes);
  }
  const levelCounts: number[] = [];
  for (const [depthOffset, nodes] of levels.entries()) {
    const indexes = levelFileIndexes[depthOffset]!;
    const starts = new Map<number, number>();
    let levelCount = 0;
    for (const [nodeIndex, node] of nodes.entries()) {
      const fileIndex = indexes[nodeIndex % indexes.length]!;
      const count = (depthOffset + 1) * 100 + nodeIndex + 1;
      const start = starts.get(fileIndex) ?? 0;
      node.data = { "3dgs": { name: fileIndex, start, count } };
      starts.set(fileIndex, start + count);
      levelCount += count;
    }
    levelCounts.push(levelCount);
  }
  const environmentIndex = splatFiles.length;
  splatFiles.push(`data/3dgs/env${splatType}`);
  root.splatFiles = splatFiles;
  root.data.env.name = environmentIndex;
  const lodSplats = [...levelCounts].reverse();
  return {
    version: "0.0.3",
    guid: "0123456789abcdef0123456789abcdef",
    fileType: levelWidths.length === 3 ? "quality" : "portable",
    splatType,
    totalLevels: levelWidths.length,
    lodSplats,
    totalSplats: lodSplats.reduce((sum, count) => sum + count, 0),
    env: { type: "splats", splatsCount: 17 },
    root,
  };
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

// Deterministic lossless WebPs generated once with sharp/libvips. Keeping the
// bytes inline makes the validator tests hermetic while exercising a complete
// decoder rather than a hand-written RIFF stub that no browser can load.
const WEBP_64_X_64 = Buffer.from(
  "UklGRiYAAABXRUJQVlA4TBoAAAAvP8APAAdQgVQIIAAKmv7HABLC//daRP9TPw==",
  "base64",
);
const WEBP_32_X_32 = Buffer.from(
  "UklGRiAAAABXRUJQVlA4TBQAAAAvH8AHAAdQgVQIIAAKmv7HiIj+Bw==",
  "base64",
);
const WEBP_1_X_1 = Buffer.from(
  "UklGRiAAAABXRUJQVlA4TBQAAAAvAAAAAAdQgVQIIAAKmv7HiIj+Bw==",
  "base64",
);
const WEBP_192_X_1 = Buffer.from(
  "UklGRiAAAABXRUJQVlA4TBQAAAAvvwAAAAdQgVQIIAAKmv7HiIj+Bw==",
  "base64",
);

interface TestSogMeta {
  version: 2;
  count: number;
  antialias: boolean;
  means: { mins: number[]; maxs: number[]; files: string[] };
  scales: { codebook: number[]; files: string[] };
  quats: { files: string[] };
  sh0: { codebook: number[]; files: string[] };
  shN?: { count: number; bands: number; codebook: number[]; files: string[] };
}

interface SogFixtureOptions {
  readonly transformMeta?: (meta: TestSogMeta) => void;
  readonly imageOverrides?: Readonly<Record<string, Buffer>>;
  readonly allImages?: Buffer;
  readonly includeShN?: boolean;
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
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
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

function makeSogFixture(count: number, options: SogFixtureOptions = {}): Buffer {
  const meta: TestSogMeta = {
    version: 2,
    count,
    antialias: false,
    means: {
      mins: [0, 0, 0],
      maxs: [1, 1, 1],
      files: ["means_l.webp", "means_u.webp"],
    },
    scales: { codebook: Array.from({ length: 256 }, () => 0), files: ["scales.webp"] },
    quats: { files: ["quats.webp"] },
    sh0: { codebook: Array.from({ length: 256 }, () => 0), files: ["sh0.webp"] },
  };
  if (options.includeShN === true) {
    meta.shN = {
      count: 64,
      bands: 1,
      codebook: Array.from({ length: 256 }, () => 0),
      files: ["shN_centroids.webp", "shN_labels.webp"],
    };
  }
  options.transformMeta?.(meta);
  const files = [
    ...meta.means.files,
    ...meta.scales.files,
    ...meta.quats.files,
    ...meta.sh0.files,
    ...(meta.shN?.files ?? []),
  ];
  const metaBytes = Buffer.from(JSON.stringify(meta), "utf8");
  return makeStoredZip([
    ...files.map((name) => ({
      name,
      bytes: options.imageOverrides?.[name] ?? options.allImages ??
        (name === "shN_centroids.webp" ? WEBP_192_X_1 : WEBP_64_X_64),
    })),
    { name: "meta.json", bytes: metaBytes },
  ]);
}

interface SpzFixtureOptions {
  readonly version?: 1 | 2 | 3;
  readonly shDegree?: 0 | 1 | 2 | 3;
  readonly flags?: number;
}

function makeSpzFixture(count: number, options: SpzFixtureOptions = {}): Buffer {
  const version = options.version ?? 3;
  const shDegree = options.shDegree ?? 0;
  const flags = options.flags ?? 0;
  const shBytes = [0, 9, 24, 45][shDegree]!;
  const bytesPerSplat = (version === 1 ? 6 : 9) + 1 + 3 + 3 + (version === 3 ? 4 : 3) +
    shBytes + ((flags & 0x80) !== 0 ? 6 : 0);
  const uncompressed = Buffer.alloc(16 + count * bytesPerSplat);
  uncompressed.writeUInt32LE(0x5053474e, 0);
  uncompressed.writeUInt32LE(version, 4);
  uncompressed.writeUInt32LE(count, 8);
  uncompressed.writeUInt8(shDegree, 12);
  uncompressed.writeUInt8(12, 13);
  uncompressed.writeUInt8(flags, 14);
  return gzipSync(uncompressed, { level: 1 });
}

function manifestFileCounts(manifest: TestManifest): ReadonlyMap<string, number> {
  const countsByIndex = new Map<number, number>();
  const visit = (node: TestNode): void => {
    const splat = node.data?.["3dgs"];
    if (splat !== undefined) {
      countsByIndex.set(splat.name, (countsByIndex.get(splat.name) ?? 0) + splat.count);
    }
    for (const child of Object.values(node.child ?? {})) visit(child);
  };
  visit(manifest.root);
  countsByIndex.set(manifest.root.data.env.name, manifest.env.splatsCount);
  return new Map([...countsByIndex].map(([index, count]) => [manifest.root.splatFiles[index]!, count]));
}

async function writeFixture(manifest: TestManifest, fileName = "scene.lcc2"): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "lcc2-frontier-"));
  cleanup.push(root);
  const counts = manifestFileCounts(manifest);
  for (const path of manifest.root.splatFiles) {
    const absolute = join(root, ...path.split("/"));
    await mkdir(dirname(absolute), { recursive: true });
    const count = counts.get(path);
    if (count === undefined) throw new Error(`No fixture count for ${path}`);
    await writeFile(absolute, manifest.splatType === ".sog"
      ? makeSogFixture(count)
      : makeSpzFixture(count));
  }
  const manifestPath = join(root, fileName);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifestPath, manifest };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeStandaloneContainer(
  extension: ".sog" | ".spz",
  bytes: Buffer,
): Promise<{
  readonly absolutePath: string;
  readonly expectedIdentity: {
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
  };
}> {
  const root = await mkdtemp(join(tmpdir(), "lcc2-container-"));
  cleanup.push(root);
  const absolutePath = join(root, `fixture${extension}`);
  await writeFile(absolutePath, bytes);
  const metadata = await lstat(absolutePath);
  return {
    absolutePath,
    expectedIdentity: {
      dev: metadata.dev,
      ino: metadata.ino,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      ctimeMs: metadata.ctimeMs,
    },
  };
}

async function inspectWithReplacementSog(options: SogFixtureOptions): Promise<unknown> {
  const fixture = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2]));
  const relativePath = fixture.manifest.root.splatFiles.at(-2)!;
  const count = manifestFileCounts(fixture.manifest).get(relativePath)!;
  await writeFile(
    join(fixture.root, ...relativePath.split("/")),
    makeSogFixture(count, options),
  );
  return inspectLcc2HighestDetailFrontier({
    manifestPath: fixture.manifestPath,
    environmentPolicy: "exclude",
  });
}

describe("authoritative LCC2 highest-detail frontier compiler", () => {
  it("derives Reception's 3-level, 4-file leaf frontier without using filename depth", () => {
    const manifest = shapedManifest([21, 23, 30], [1, 2, 4]);
    const plan = compileLcc2HighestDetailFrontier(manifest, { environmentPolicy: "exclude" });
    expect(plan.selection).toMatchObject({
      policy: "authoritative_leaf_nodes_v1",
      depth: 3,
      nodeCount: 30,
      gaussianCount: manifest.lodSplats[0],
    });
    expect(plan.selection.members).toHaveLength(4);
    expect(plan.selection.members.every((member) => member.depth === 3)).toBe(true);
    expect(plan.ancestorAlternatives).toHaveLength(3);
    expect(plan.proof.levels.map((level) => [level.nodeCount, level.fileCount])).toEqual([
      [21, 1],
      [23, 2],
      [30, 4],
    ]);
    expect(plan.environment).toMatchObject({
      policy: "exclude",
      relativePath: "data/3dgs/env.sog",
    });
  });

  it("derives Grand Hall's 5-level, 9-file leaf frontier with all 31 leaves", () => {
    const manifest = shapedManifest([8, 8, 15, 16, 31], [1, 2, 3, 4, 9]);
    const plan = compileLcc2HighestDetailFrontier(manifest, { environmentPolicy: "exclude" });
    expect(plan.selection).toMatchObject({
      depth: 5,
      nodeCount: 31,
      gaussianCount: manifest.lodSplats[0],
    });
    expect(plan.selection.members).toHaveLength(9);
    expect(plan.ancestorAlternatives).toHaveLength(10);
    expect(plan.proof.levels.map((level) => [level.nodeCount, level.fileCount])).toEqual([
      [8, 1],
      [8, 2],
      [15, 3],
      [16, 4],
      [31, 9],
    ]);
  });

  it("requires an explicit environment decision and rejects an implicit env file", () => {
    const manifest = shapedManifest([2, 2, 2], [1, 1, 2]);
    expect(() => compileLcc2HighestDetailFrontier(manifest, {
      environmentPolicy: undefined as never,
    })).toThrow(expect.objectContaining({ code: "LCC2_ENVIRONMENT_POLICY_REQUIRED" }));
    manifest.root.data = {} as TestManifest["root"]["data"];
    expect(() => compileLcc2HighestDetailFrontier(manifest, {
      environmentPolicy: "exclude",
    })).toThrow(expect.objectContaining({ code: "LCC2_SCHEMA_INVALID" }));
  });

  it("rejects a level file whose declared ranges overlap or leave a gap", () => {
    const manifest = shapedManifest([2, 2, 2], [1, 1, 1]);
    const firstLeaf = Object.values(Object.values(manifest.root.child!)[0]!.child!)[0]!;
    const leaf = Object.values(firstLeaf.child!)[0]!;
    leaf.data!["3dgs"]!.start += 1;
    expect(() => compileLcc2HighestDetailFrontier(manifest, {
      environmentPolicy: "exclude",
    })).toThrow(expect.objectContaining({ code: "LCC2_RANGE_INVALID" }));
  });

  it("rejects an early leaf, a mixed-depth file, and published count drift", () => {
    const earlyLeaf = shapedManifest([2, 2, 2], [1, 1, 2]);
    const earlyDepthOne = Object.values(earlyLeaf.root.child!)[0]!;
    const earlyDepthTwo = Object.values(earlyDepthOne.child!)[0]!;
    earlyDepthTwo.childNum = 0;
    delete earlyDepthTwo.child;
    expect(() => compileLcc2HighestDetailFrontier(earlyLeaf, {
      environmentPolicy: "exclude",
    })).toThrow(expect.objectContaining({ code: "LCC2_TREE_INVALID" }));

    const mixedDepth = shapedManifest([2, 2, 2], [1, 1, 2]);
    const depthOne = Object.values(mixedDepth.root.child!)[0]!;
    const depthTwo = Object.values(depthOne.child!)[0]!;
    const leaf = Object.values(depthTwo.child!)[0]!;
    leaf.data!["3dgs"]!.name = depthTwo.data!["3dgs"]!.name;
    expect(() => compileLcc2HighestDetailFrontier(mixedDepth, {
      environmentPolicy: "exclude",
    })).toThrow(expect.objectContaining({ code: "LCC2_TREE_INVALID" }));

    const countDrift = shapedManifest([2, 2, 2], [1, 1, 2]);
    countDrift.lodSplats[0]! += 1;
    countDrift.totalSplats += 1;
    expect(() => compileLcc2HighestDetailFrontier(countDrift, {
      environmentPolicy: "exclude",
    })).toThrow(expect.objectContaining({ code: "LCC2_COUNT_MISMATCH" }));
  });
});

describe("read-only LCC2 frontier worker", () => {
  it("hashes the selected Reception members and excluded env deterministically", async () => {
    const fixture = await writeFixture(shapedManifest([21, 23, 30], [1, 2, 4]), "Reception Room.lcc2");
    const first = await inspectLcc2HighestDetailFrontier({
      manifestPath: fixture.manifestPath,
      environmentPolicy: "exclude",
    });
    const second = await inspectLcc2HighestDetailFrontier({
      manifestPath: fixture.manifestPath,
      environmentPolicy: "exclude",
    });
    expect(second).toEqual(first);
    expect(first.selection.members).toHaveLength(4);
    expect(first.selection.members.every((member) => /^sha256:[a-f0-9]{64}$/u.test(member.sha256))).toBe(true);
    expect(first.runtime.memberPaths).toEqual(first.selection.members.map((member) => member.relativePath));
    expect(first.environment.runtimeLoaded).toBe(false);
    expect(first.environment.sha256).toBe(`sha256:${sha256(await readFile(join(
      fixture.root,
      ...first.environment.relativePath.split("/"),
    )))}`);
    expect(first.receiptSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.proof).toMatchObject({
      everyDeclaredSplatFilePresent: true,
      noDeclaredSplatPathIsLinked: true,
      everyDeclaredContainerValidated: true,
      everyEmbeddedGaussianCountMatchesManifest: true,
      allHashedFilesStable: true,
      networkAccess: "none",
      sourceWrites: "none",
    });
  });

  it("validates a real gzip SPZ layout and its embedded per-file counts", async () => {
    const fixture = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2], ".spz"));
    const receipt = await inspectLcc2HighestDetailFrontier({
      manifestPath: fixture.manifestPath,
      environmentPolicy: "exclude",
    });
    expect(receipt.source.splatType).toBe(".spz");
    expect(receipt.selection.gaussianCount).toBe(fixture.manifest.lodSplats[0]);
    expect(receipt.selection.members).toHaveLength(2);
    expect(receipt.environment.relativePath).toBe("data/3dgs/env.spz");
    expect(receipt.proof.everyDeclaredContainerValidated).toBe(true);
  });

  it.each([
    ["v1 degree-1", { version: 1, shDegree: 1, flags: 0 }],
    ["v2 degree-2 antialias", { version: 2, shDegree: 2, flags: 0x01 }],
    ["v3 degree-3", { version: 3, shDegree: 3, flags: 0 }],
    ["v3 degree-0 LOD", { version: 3, shDegree: 0, flags: 0x80 }],
    ["v3 degree-3 antialias plus LOD", { version: 3, shDegree: 3, flags: 0x81 }],
  ] as const)("validates the installed Spark SPZ byte formula for %s", async (_label, options) => {
    const count = 19;
    const standalone = await writeStandaloneContainer(".spz", makeSpzFixture(count, options));
    await expect(validateLcc2Container({
      absolutePath: standalone.absolutePath,
      relativePath: "data/3dgs/fixture.spz",
      expectedIdentity: standalone.expectedIdentity,
      expectedGaussianCount: count,
      splatType: ".spz",
    })).resolves.toBeUndefined();
  });

  it("converts an in-flight SPZ source abort into a typed cancellation", async () => {
    const count = 101;
    const standalone = await writeStandaloneContainer(".spz", makeSpzFixture(count));
    const controller = new AbortController();
    const validation = validateLcc2Container({
      absolutePath: standalone.absolutePath,
      relativePath: "data/3dgs/fixture.spz",
      expectedIdentity: standalone.expectedIdentity,
      expectedGaussianCount: count,
      splatType: ".spz",
      signal: controller.signal,
    });
    // The validator has passed its synchronous preflight but is still waiting
    // on the file open, so the stream receives an already-aborted signal.
    queueMicrotask(() => {
      controller.abort();
    });
    await expect(validation).rejects.toMatchObject({
      name: "Lcc2ContainerValidationError",
      code: "cancelled",
    });
  });

  it("accepts fully decodable production-shaped SOG v2 images including shN", async () => {
    await expect(inspectWithReplacementSog({ includeShN: true })).resolves.toMatchObject({
      proof: {
        everyDeclaredContainerValidated: true,
        everyEmbeddedGaussianCountMatchesManifest: true,
      },
    });
  });

  it.each([
    ["missing means_u slot", {
      transformMeta: (meta: TestSogMeta) => {
        meta.means.files = ["means_l.webp"];
      },
    }],
    ["RIFF-wrapped but undecodable WebP", {
      imageOverrides: {
        "scales.webp": (() => {
          const chunk = Buffer.alloc(12);
          chunk.write("VP8 ", 0, "ascii");
          chunk.writeUInt32LE(4, 4);
          const bytes = Buffer.alloc(24);
          bytes.write("RIFF", 0, "ascii");
          bytes.writeUInt32LE(16, 4);
          bytes.write("WEBP", 8, "ascii");
          chunk.copy(bytes, 12);
          return bytes;
        })(),
      },
    }],
    ["too few image pixels", { allImages: WEBP_1_X_1 }],
    ["mismatched per-Gaussian image dimensions", {
      imageOverrides: { "scales.webp": WEBP_32_X_32 },
    }],
    ["short scale codebook", {
      transformMeta: (meta: TestSogMeta) => {
        meta.scales.codebook = meta.scales.codebook.slice(1);
      },
    }],
    ["wrong shN centroid dimensions", {
      includeShN: true,
      imageOverrides: { "shN_centroids.webp": WEBP_64_X_64 },
    }],
    ["wrong shN label dimensions", {
      includeShN: true,
      imageOverrides: { "shN_labels.webp": WEBP_32_X_32 },
    }],
  ] satisfies ReadonlyArray<readonly [string, SogFixtureOptions]>) (
    "rejects a SOG v2 container with %s",
    async (_label, options) => {
      await expect(inspectWithReplacementSog(options)).rejects.toMatchObject({
        code: "LCC2_CONTAINER_INVALID",
      });
    },
  );

  it("rejects malformed SOG bytes and embedded SOG or SPZ count drift", async () => {
    const malformed = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2]));
    const malformedPath = malformed.manifest.root.splatFiles.at(-2)!;
    await writeFile(join(malformed.root, ...malformedPath.split("/")), "not a SOG archive");
    await expect(inspectLcc2HighestDetailFrontier({
      manifestPath: malformed.manifestPath,
      environmentPolicy: "exclude",
    })).rejects.toMatchObject({ code: "LCC2_CONTAINER_INVALID" });

    const sogMismatch = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2]));
    const sogPath = sogMismatch.manifest.root.splatFiles.at(-2)!;
    const sogExpected = manifestFileCounts(sogMismatch.manifest).get(sogPath)!;
    await writeFile(join(sogMismatch.root, ...sogPath.split("/")), makeSogFixture(sogExpected + 1));
    await expect(inspectLcc2HighestDetailFrontier({
      manifestPath: sogMismatch.manifestPath,
      environmentPolicy: "exclude",
    })).rejects.toMatchObject({ code: "LCC2_EMBEDDED_COUNT_MISMATCH" });

    const spzMismatch = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2], ".spz"));
    const spzPath = spzMismatch.manifest.root.splatFiles.at(-2)!;
    const spzExpected = manifestFileCounts(spzMismatch.manifest).get(spzPath)!;
    await writeFile(join(spzMismatch.root, ...spzPath.split("/")), makeSpzFixture(spzExpected + 1));
    await expect(inspectLcc2HighestDetailFrontier({
      manifestPath: spzMismatch.manifestPath,
      environmentPolicy: "exclude",
    })).rejects.toMatchObject({ code: "LCC2_EMBEDDED_COUNT_MISMATCH" });
  });

  it("deep-freezes every digest-covered receipt member", async () => {
    const fixture = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2]));
    const receipt = await inspectLcc2HighestDetailFrontier({
      manifestPath: fixture.manifestPath,
      environmentPolicy: "exclude",
    });
    const seen = new WeakSet();
    const assertDeepFrozen = (value: unknown): void => {
      if (typeof value !== "object" || value === null || seen.has(value)) return;
      seen.add(value);
      expect(Object.isFrozen(value)).toBe(true);
      for (const member of Object.values(value)) assertDeepFrozen(member);
    };
    assertDeepFrozen(receipt);
    expect(() => (receipt.runtime.memberPaths as string[]).push("changed.sog")).toThrow();
  });

  it("binds validated ancestor bytes into the receipt digest", async () => {
    const fixture = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2]));
    const first = await inspectLcc2HighestDetailFrontier({
      manifestPath: fixture.manifestPath,
      environmentPolicy: "exclude",
    });
    const ancestorPath = fixture.manifest.root.splatFiles[0]!;
    const ancestorCount = manifestFileCounts(fixture.manifest).get(ancestorPath)!;
    await writeFile(
      join(fixture.root, ...ancestorPath.split("/")),
      makeSogFixture(ancestorCount, {
        transformMeta: (meta) => {
          meta.scales.codebook[0] = 0.25;
        },
      }),
    );
    const second = await inspectLcc2HighestDetailFrontier({
      manifestPath: fixture.manifestPath,
      environmentPolicy: "exclude",
    });

    const firstAncestor = first.ancestorAlternatives.find((member) => member.relativePath === ancestorPath);
    const secondAncestor = second.ancestorAlternatives.find((member) => member.relativePath === ancestorPath);
    expect(firstAncestor?.sha256).not.toBe(secondAncestor?.sha256);
    expect(first.receiptSha256).not.toBe(second.receiptSha256);
  });

  it("adds env only after an explicit include decision", async () => {
    const fixture = await writeFixture(shapedManifest([8, 8, 15, 16, 31], [1, 2, 3, 4, 9]));
    const receipt = await inspectLcc2HighestDetailFrontier({
      manifestPath: fixture.manifestPath,
      environmentPolicy: "include",
    });
    expect(receipt.environment.runtimeLoaded).toBe(true);
    expect(receipt.runtime.memberPaths.at(-1)).toBe("data/3dgs/env.sog");
    expect(receipt.runtime.gaussianCount).toBe(
      receipt.selection.gaussianCount + receipt.environment.gaussianCount,
    );
  });

  it("rejects a missing declared member before issuing a receipt", async () => {
    const fixture = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2]));
    const missing = fixture.manifest.root.splatFiles.at(-2)!;
    await unlink(join(fixture.root, ...missing.split("/")));
    await expect(inspectLcc2HighestDetailFrontier({
      manifestPath: fixture.manifestPath,
      environmentPolicy: "exclude",
    })).rejects.toMatchObject({ code: "LCC2_FILE_MISSING" });
  });

  it("rejects linked content and a selected file changed after discovery", async () => {
    const linkedFixture = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2]));
    const linkedPath = linkedFixture.manifest.root.splatFiles.at(-2)!;
    const linkedAbsolute = join(linkedFixture.root, ...linkedPath.split("/"));
    const outside = join(linkedFixture.root, "outside.sog");
    await writeFile(outside, "outside");
    await unlink(linkedAbsolute);
    await link(outside, linkedAbsolute);
    await expect(inspectLcc2HighestDetailFrontier({
      manifestPath: linkedFixture.manifestPath,
      environmentPolicy: "exclude",
    })).rejects.toMatchObject({ code: "LCC2_FILE_HARDLINKED" });

    const unstableFixture = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2]));
    const selected = unstableFixture.manifest.root.splatFiles.at(-2)!;
    let changed = false;
    await expect(inspectLcc2HighestDetailFrontier({
      manifestPath: unstableFixture.manifestPath,
      environmentPolicy: "exclude",
      testHooks: {
        beforeHash: async (relativePath) => {
          if (!changed && relativePath === selected) {
            changed = true;
            await writeFile(join(unstableFixture.root, ...relativePath.split("/")), "changed");
          }
        },
      },
    })).rejects.toMatchObject({
      name: "Lcc2FrontierError",
      code: "LCC2_SOURCE_CHANGED",
    });
  });

  it("rejects duplicate JSON keys before schema compilation", async () => {
    const fixture = await writeFixture(shapedManifest([2, 2, 2], [1, 1, 2]));
    await writeFile(fixture.manifestPath, '{"version":"0.0.3","version":"0.0.3"}\n');
    await expect(inspectLcc2HighestDetailFrontier({
      manifestPath: fixture.manifestPath,
      environmentPolicy: "exclude",
    })).rejects.toMatchObject({ code: "LCC2_JSON_LEXICAL_INVALID" });
  });
});

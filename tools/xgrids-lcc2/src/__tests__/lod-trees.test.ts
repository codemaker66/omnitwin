import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRoomLodTrees,
  readGeneratedManifest,
  servedTilesOf,
  type LodBuildRunner,
} from "../lod-trees.js";
import { writeRoomManifest, type RoomManifestEntry } from "../stage.js";

// ---------------------------------------------------------------------------
// Prebuilt level-of-detail trees for the staged tiles.
//
// The capture drive is not always attached, so the command works from the
// staging root and the generated manifest alone: read the module the stage
// command wrote, build one tree per SERVED tile (finest level and sky shell),
// keep the header and its chunks together under lod/, and write the manifest
// back with a descriptor per tree. The builder itself is Spark's build-lod
// binary; here it is a fake that writes the same shape of files.
// ---------------------------------------------------------------------------

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function entry(overrides: Partial<RoomManifestEntry> = {}): RoomManifestEntry {
  return {
    roomSlug: "saloon",
    captureDir: "scan_output_2_saloon",
    splatType: ".sog",
    totalSplats: 30,
    totalLevels: 2,
    splatsByLevel: [10, 20],
    finestLevel: 2,
    finestLevelSplats: 20,
    tiles: [
      { file: "0_0.sog", bytes: 3, sha256: "a".repeat(64), lodLevel: 1, isEnvironment: false },
      { file: "0_1_0.sog", bytes: 4, sha256: "b".repeat(64), lodLevel: 2, isEnvironment: false },
      { file: "0_1_1.sog", bytes: 4, sha256: "c".repeat(64), lodLevel: 2, isEnvironment: false },
      { file: "env.sog", bytes: 2, sha256: "d".repeat(64), lodLevel: null, isEnvironment: true },
    ],
    totalBytes: 13,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    extentM: [12, 5.4, 7],
    spawn: { position: [0, 1.5, 0], yaw: 0 },
    bounds: { min: [-5, 0.5, -3], max: [5, 3, 3] },
    eyeHeightM: 1.5,
    alignmentConfidence: "confident",
    alignmentNote: "fixture",
    ...overrides,
  };
}

/** A header in Spark's RAD0 layout: magic, u32 JSON length, the JSON. */
function radHeader(chunks: readonly { filename: string; bytes: number }[]): Buffer {
  const json = Buffer.from(JSON.stringify({
    version: 1,
    type: "gsplat",
    count: 16706,
    maxSh: 3,
    lodTree: true,
    chunkSize: 65536,
    allChunkBytes: chunks.reduce((sum, c) => sum + c.bytes, 0),
    chunks: chunks.map((c, i) => ({ offset: i * 65536, bytes: c.bytes, filename: c.filename })),
    comment: "{\n  \"input\": \"has braces { } inside a string\"\n}",
  }), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.byteLength, 0);
  return Buffer.concat([Buffer.from("RAD0", "ascii"), length, json]);
}

/** Behaves like build-lod --rad-chunked: writes <base>-lod.rad and chunks beside the input. */
function fakeBuilder(chunkCount = 1): LodBuildRunner {
  return vi.fn((inputPath: string) => {
    const dir = dirname(inputPath);
    const base = basename(inputPath).replace(/\.sog$/u, "");
    const chunks = Array.from({ length: chunkCount }, (_, i) => ({
      filename: `${base}-lod-${String(i)}.radc`,
      bytes: 100 + i,
    }));
    for (const chunk of chunks) {
      writeFileSync(join(dir, chunk.filename), Buffer.alloc(chunk.bytes, i8(chunk.bytes)));
    }
    writeFileSync(join(dir, `${base}-lod.rad`), radHeader(chunks));
    return { ok: true, detail: `wrote ${base}` };
  });
}

function i8(n: number): number {
  return n % 256;
}

function stagedRoom(dir: string, roomEntry: RoomManifestEntry): string {
  const stagedDir = join(dir, "trades-hall", roomEntry.roomSlug);
  mkdirSync(stagedDir, { recursive: true });
  for (const tile of roomEntry.tiles) {
    writeFileSync(join(stagedDir, tile.file), Buffer.alloc(tile.bytes, 7));
  }
  return stagedDir;
}

describe("readGeneratedManifest", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("reads back exactly what writeRoomManifest wrote", () => {
    dir = mkdtempSync(join(tmpdir(), "lcc2-lod-"));
    const out = join(dir, "bundles.ts");
    const entries = [entry(), entry({ roomSlug: "grand-hall", finestLevel: 2 })];
    writeRoomManifest(out, entries);

    expect(readGeneratedManifest(out)).toEqual(entries);
  });

  it("refuses a module that is not a generated manifest, naming what it looked for", () => {
    dir = mkdtempSync(join(tmpdir(), "lcc2-lod-"));
    const out = join(dir, "other.ts");
    writeFileSync(out, "export const x = 1;\n", "utf8");

    expect(() => readGeneratedManifest(out)).toThrow(/GENERATED_ROOM_SPLAT_BUNDLES/u);
  });
});

describe("servedTilesOf", () => {
  it("keeps the finest level and the sky shell, never a coarser level", () => {
    const served = servedTilesOf(entry()).map((tile) => tile.file);
    expect(served).toEqual(["0_1_0.sog", "0_1_1.sog", "env.sog"]);
  });
});

describe("buildRoomLodTrees", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("builds one tree per served tile, moves header and chunks under lod/, and records bytes and digests", () => {
    dir = mkdtempSync(join(tmpdir(), "lcc2-lod-"));
    const roomEntry = entry();
    const stagedDir = stagedRoom(dir, roomEntry);
    const builder = fakeBuilder();

    const result = buildRoomLodTrees(roomEntry, stagedDir, builder);

    expect(result.failures).toEqual([]);
    expect(builder).toHaveBeenCalledTimes(3);
    const byFile = new Map(result.entry.tiles.map((tile) => [tile.file, tile]));
    expect(byFile.get("0_0.sog")?.lod).toBeUndefined();

    const tree = byFile.get("0_1_0.sog")?.lod;
    expect(tree).toBeDefined();
    expect(tree?.file).toBe("lod/0_1_0-lod.rad");
    const headerPath = join(stagedDir, "lod", "0_1_0-lod.rad");
    expect(existsSync(headerPath)).toBe(true);
    expect(existsSync(join(stagedDir, "0_1_0-lod.rad"))).toBe(false);
    expect(tree?.bytes).toBe(readFileSync(headerPath).byteLength);
    expect(tree?.sha256).toBe(sha256(readFileSync(headerPath)));
    expect(tree?.chunks).toEqual([
      {
        file: "lod/0_1_0-lod-0.radc",
        bytes: 100,
        sha256: sha256(readFileSync(join(stagedDir, "lod", "0_1_0-lod-0.radc"))),
      },
    ]);
    expect(byFile.get("env.sog")?.lod?.file).toBe("lod/env-lod.rad");

    // Everything else about the entry is untouched.
    expect({ ...result.entry, tiles: undefined }).toEqual({ ...roomEntry, tiles: undefined });
  });

  it("describes every chunk of a multi-chunk tree, in header order", () => {
    dir = mkdtempSync(join(tmpdir(), "lcc2-lod-"));
    const roomEntry = entry();
    const stagedDir = stagedRoom(dir, roomEntry);

    const result = buildRoomLodTrees(roomEntry, stagedDir, fakeBuilder(3));

    const chunks = result.entry.tiles.find((tile) => tile.file === "0_1_1.sog")?.lod?.chunks ?? [];
    expect(chunks.map((chunk) => chunk.file)).toEqual([
      "lod/0_1_1-lod-0.radc",
      "lod/0_1_1-lod-1.radc",
      "lod/0_1_1-lod-2.radc",
    ]);
    expect(chunks.map((chunk) => chunk.bytes)).toEqual([100, 101, 102]);
  });

  it("leaves an existing tree alone and still records it, so a re-run is cheap and complete", () => {
    dir = mkdtempSync(join(tmpdir(), "lcc2-lod-"));
    const roomEntry = entry();
    const stagedDir = stagedRoom(dir, roomEntry);
    const first = buildRoomLodTrees(roomEntry, stagedDir, fakeBuilder());
    const builder = fakeBuilder();

    const second = buildRoomLodTrees(roomEntry, stagedDir, builder);

    expect(builder).not.toHaveBeenCalled();
    expect(second.entry).toEqual(first.entry);
  });

  it("rebuilds a tree whose existing header has no chunks, since an unchunked file cannot be paged", () => {
    dir = mkdtempSync(join(tmpdir(), "lcc2-lod-"));
    const roomEntry = entry();
    const stagedDir = stagedRoom(dir, roomEntry);
    mkdirSync(join(stagedDir, "lod"));
    writeFileSync(join(stagedDir, "lod", "env-lod.rad"), radHeader([]));
    const builder = fakeBuilder();

    const result = buildRoomLodTrees(roomEntry, stagedDir, builder);

    expect(result.failures).toEqual([]);
    expect(builder).toHaveBeenCalledTimes(3);
    const env = result.entry.tiles.find((tile) => tile.file === "env.sog")?.lod;
    expect(env?.chunks).toHaveLength(1);
    expect(existsSync(join(stagedDir, "lod", "env-lod.rad.unchunked"))).toBe(true);
  });

  it("records a failure for a tile whose build fails or leaves no header, and finishes the rest", () => {
    dir = mkdtempSync(join(tmpdir(), "lcc2-lod-"));
    const roomEntry = entry();
    const stagedDir = stagedRoom(dir, roomEntry);
    const good = fakeBuilder();
    const builder: LodBuildRunner = (inputPath) =>
      inputPath.endsWith("0_1_0.sog") ? { ok: false, detail: "exit 101" } : good(inputPath);

    const result = buildRoomLodTrees(roomEntry, stagedDir, builder);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("0_1_0.sog");
    expect(result.failures[0]).toContain("exit 101");
    expect(result.entry.tiles.find((tile) => tile.file === "0_1_0.sog")?.lod).toBeUndefined();
    expect(result.entry.tiles.find((tile) => tile.file === "0_1_1.sog")?.lod).toBeDefined();
    expect(result.entry.tiles.find((tile) => tile.file === "env.sog")?.lod).toBeDefined();
  });

  it("rejects a header whose chunk is missing on disk rather than describing a tree that cannot load", () => {
    dir = mkdtempSync(join(tmpdir(), "lcc2-lod-"));
    const roomEntry = entry();
    const stagedDir = stagedRoom(dir, roomEntry);
    const builder: LodBuildRunner = (inputPath) => {
      const base = basename(inputPath).replace(/\.sog$/u, "");
      writeFileSync(join(dirname(inputPath), `${base}-lod.rad`), radHeader([{ filename: `${base}-lod-0.radc`, bytes: 9 }]));
      return { ok: true };
    };

    const result = buildRoomLodTrees(roomEntry, stagedDir, builder);

    expect(result.failures).toHaveLength(3);
    expect(result.failures[0]).toMatch(/chunk .* missing/u);
    expect(result.entry.tiles.every((tile) => tile.lod === undefined)).toBe(true);
  });
});

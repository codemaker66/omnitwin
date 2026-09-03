import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { RoomManifestEntry, StagedFile, StagedLodTree, StagedTile } from "./stage.js";

// ---------------------------------------------------------------------------
// Prebuilt level-of-detail trees.
//
// Spark can build a level-of-detail tree in the browser at load time, at one
// to three seconds per million Gaussians; on the Grand Hall that is twelve
// seconds a visitor waits for detail they already had. Built once here with
// Spark's own `build-lod`, the tree ships beside the tile as a small header
// (`<tile>-lod.rad`) and numbered chunks (`<tile>-lod-N.radc`) the viewer
// pages in as it needs them, and loads in the time the tile itself took.
//
// This works from the staging root and the generated manifest alone, because
// the capture drive is not always attached. Tiles are never modified; the
// trees live in a `lod/` directory beside them, and the manifest gains one
// descriptor per tree so the runtime can choose it.
// ---------------------------------------------------------------------------

export interface LodBuildOutcome {
  readonly ok: boolean;
  readonly detail?: string;
}

/** Runs the tree builder on one tile; outputs land beside the input. */
export type LodBuildRunner = (inputPath: string) => LodBuildOutcome;

export interface LodBuildResult {
  readonly entry: RoomManifestEntry;
  readonly failures: readonly string[];
  readonly built: number;
  readonly reused: number;
}

const MANIFEST_DECLARATION = "GENERATED_ROOM_SPLAT_BUNDLES: readonly GeneratedRoomSplatBundle[] =";
const LITERAL_END = "] as const;";
const LOD_DIR = "lod";
const RAD_MAGIC = "RAD0";

/**
 * Reads the entries back out of the module `writeRoomManifest` wrote. The
 * literal is `JSON.stringify(entries)` under a fixed declaration, so this is
 * a slice and a parse, not a TypeScript parser.
 */
export function readGeneratedManifest(path: string): RoomManifestEntry[] {
  const text = readFileSync(path, "utf8");
  const declaration = text.indexOf(MANIFEST_DECLARATION);
  if (declaration === -1) {
    throw new Error(`${path} is not a generated manifest: no ${MANIFEST_DECLARATION.split(":")[0] ?? ""} declaration`);
  }
  // The declaration itself contains `[]`; the literal's bracket comes after it.
  const open = text.indexOf("[", declaration + MANIFEST_DECLARATION.length);
  const close = text.lastIndexOf(LITERAL_END);
  if (open === -1 || close === -1 || close < open) {
    throw new Error(`${path}: the GENERATED_ROOM_SPLAT_BUNDLES literal is not where the writer puts it`);
  }
  return JSON.parse(text.slice(open, close + 1)) as RoomManifestEntry[];
}

/** The tiles a viewer fetches: the finest level and the sky shell. */
export function servedTilesOf(entry: RoomManifestEntry): readonly StagedTile[] {
  return entry.tiles.filter((tile) => tile.isEnvironment || tile.lodLevel === entry.finestLevel);
}

interface RadHeader {
  readonly count?: number;
  readonly chunks?: readonly { readonly filename: string; readonly bytes: number }[];
}

/** Parses the JSON header of a `.rad` file: magic, little-endian u32 length, JSON. */
function readRadHeader(path: string): RadHeader {
  const bytes = readFileSync(path);
  if (bytes.byteLength < 8 || bytes.subarray(0, 4).toString("ascii") !== RAD_MAGIC) {
    throw new Error(`${basename(path)} is not a ${RAD_MAGIC} header`);
  }
  const length = bytes.readUInt32LE(4);
  if (8 + length > bytes.byteLength) {
    throw new Error(`${basename(path)}: header length ${String(length)} exceeds the file`);
  }
  return JSON.parse(bytes.subarray(8, 8 + length).toString("utf8")) as RadHeader;
}

function fileRecord(stagedDir: string, relativeFile: string): StagedFile {
  const path = join(stagedDir, relativeFile);
  return {
    file: relativeFile,
    bytes: statSync(path).size,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

/** Describes a tree already under lod/, refusing one whose chunks are not all there. */
function describeTree(stagedDir: string, headerName: string): StagedLodTree {
  const header = readRadHeader(join(stagedDir, LOD_DIR, headerName));
  const chunks = (header.chunks ?? []).map((chunk) => {
    if (!existsSync(join(stagedDir, LOD_DIR, chunk.filename))) {
      throw new Error(`chunk ${chunk.filename} missing for ${headerName}`);
    }
    return fileRecord(stagedDir, `${LOD_DIR}/${chunk.filename}`);
  });
  return {
    ...fileRecord(stagedDir, `${LOD_DIR}/${headerName}`),
    splats: header.count ?? 0,
    chunks,
  };
}

/** Moves a freshly built header and its chunks from beside the tile into lod/. */
function adoptBuiltTree(stagedDir: string, headerName: string): void {
  const builtHeader = join(stagedDir, headerName);
  const header = readRadHeader(builtHeader);
  const chunkNames = (header.chunks ?? []).map((chunk) => chunk.filename);
  const missing = chunkNames.find((name) => !existsSync(join(stagedDir, name)));
  if (missing !== undefined) {
    // A header without its chunks would be published as a tree that cannot
    // load; the builder's own output is the only thing removed here.
    rmSync(builtHeader, { force: true });
    throw new Error(`chunk ${missing} missing beside ${headerName}`);
  }
  for (const name of chunkNames) renameSync(join(stagedDir, name), join(stagedDir, LOD_DIR, name));
  renameSync(builtHeader, join(stagedDir, LOD_DIR, headerName));
}

/**
 * Builds (or adopts) a tree for every served tile of a room and returns the
 * entry with a descriptor on each. A tile whose tree cannot be built or
 * verified is recorded as a failure and left without a descriptor, so the
 * runtime falls back to the tile itself rather than to a broken tree.
 */
export function buildRoomLodTrees(
  entry: RoomManifestEntry,
  stagedDir: string,
  run: LodBuildRunner,
): LodBuildResult {
  mkdirSync(join(stagedDir, LOD_DIR), { recursive: true });
  const served = new Set(servedTilesOf(entry).map((tile) => tile.file));
  const failures: string[] = [];
  let built = 0;
  let reused = 0;

  const tiles = entry.tiles.map((tile): StagedTile => {
    if (!served.has(tile.file)) return tile;
    const headerName = `${tile.file.replace(/\.[^.]+$/u, "")}-lod.rad`;
    try {
      const existing = join(stagedDir, LOD_DIR, headerName);
      if (existsSync(existing)) {
        if ((readRadHeader(existing).chunks ?? []).length > 0) {
          const lod = describeTree(stagedDir, headerName);
          reused += 1;
          return { ...tile, lod };
        }
        // An unchunked tree cannot be paged. Set it aside, name intact, and
        // build the chunked one; nothing is deleted.
        renameSync(existing, `${existing}.unchunked`);
      }
      const outcome = run(join(stagedDir, tile.file));
      if (!outcome.ok) throw new Error(`build-lod failed: ${outcome.detail ?? "no detail"}`);
      if (!existsSync(join(stagedDir, headerName))) {
        throw new Error(`build-lod wrote no header ${headerName}`);
      }
      adoptBuiltTree(stagedDir, headerName);
      const lod = describeTree(stagedDir, headerName);
      built += 1;
      return { ...tile, lod };
    } catch (error) {
      failures.push(`${tile.file}: ${error instanceof Error ? error.message : String(error)}`);
      const { lod: _stale, ...withoutTree } = tile;
      return withoutTree;
    }
  });

  return { entry: { ...entry, tiles }, failures, built, reused };
}

/** The real builder: Spark's `build-lod --quality --rad-chunked <tile>`. */
export function buildLodRunner(executable: string): LodBuildRunner {
  return (inputPath) => {
    const result = spawnSync(executable, ["--quality", "--rad-chunked", inputPath], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error !== undefined) return { ok: false, detail: result.error.message };
    if (result.status !== 0) {
      return { ok: false, detail: `exit ${String(result.status)}: ${(result.stderr || result.stdout).slice(-400)}` };
    }
    const wrote = result.stdout.split("\n").filter((line) => line.startsWith("Wrote"));
    return { ok: true, detail: wrote.join("; ") };
  };
}

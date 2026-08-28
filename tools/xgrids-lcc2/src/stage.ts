import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { RoomBundle } from "./room-bundle.js";

// ---------------------------------------------------------------------------
// Staging.
//
// Tiles are large (roughly 1 GB across the eight Trades Hall rooms), so they
// are staged OUTSIDE the repository and served from there in development;
// production serves the same names from R2. What the repository keeps is the
// generated manifest — a few kilobytes of JSON naming the tiles, their bytes
// and their digests.
//
// Staging never writes to, renames inside, or deletes from a capture root. It
// only ever reads the source and writes to the staging root.
// ---------------------------------------------------------------------------

export interface StagedTile {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly lodLevel: number | null;
  readonly isEnvironment: boolean;
}

export interface StageResult {
  readonly roomSlug: string;
  readonly stagedDir: string;
  readonly tiles: readonly StagedTile[];
  readonly totalBytes: number;
  readonly failures: readonly string[];
}

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Copies a room's tiles into `<stagingRoot>/<venueSlug>/<roomSlug>/` and
 * returns a byte-and-digest receipt for each. A tile that cannot be read is
 * recorded as a failure rather than aborting the room, so one bad file does
 * not hide the state of the rest.
 */
export function stageRoomTiles(
  bundle: RoomBundle,
  captureRoot: string,
  stagingRoot: string,
  venueSlug: string,
): StageResult {
  const stagedDir = join(stagingRoot, venueSlug, bundle.roomSlug);
  mkdirSync(stagedDir, { recursive: true });

  const tiles: StagedTile[] = [];
  const failures: string[] = [];
  let totalBytes = 0;

  for (const tile of bundle.tiles) {
    const source = join(captureRoot, "lcc2-result", tile.sourcePath);
    const destination = join(stagedDir, tile.file);
    try {
      const sourceBytes = statSync(source).size;
      // Skip a byte-identical tile that is already staged: re-staging a gigabyte
      // to rediscover the same digests is waste, not diligence.
      let alreadyStaged = false;
      try {
        alreadyStaged = statSync(destination).size === sourceBytes;
      } catch {
        alreadyStaged = false;
      }
      if (!alreadyStaged) copyFileSync(source, destination);

      const bytes = statSync(destination).size;
      if (bytes !== sourceBytes) {
        failures.push(`${tile.file}: staged ${String(bytes)} bytes but source is ${String(sourceBytes)}`);
        continue;
      }
      tiles.push({
        file: tile.file,
        bytes,
        sha256: sha256Of(destination),
        lodLevel: tile.lodLevel,
        isEnvironment: tile.isEnvironment,
      });
      totalBytes += bytes;
    } catch (error) {
      failures.push(`${tile.file}: ${String(error)}`);
    }
  }

  return { roomSlug: bundle.roomSlug, stagedDir, tiles, totalBytes, failures };
}

export interface RoomManifestEntry {
  readonly roomSlug: string;
  readonly captureDir: string;
  readonly splatType: string;
  readonly totalSplats: number;
  readonly totalLevels: number;
  readonly tiles: readonly StagedTile[];
  readonly totalBytes: number;
  readonly transform: {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number];
    readonly scale: 1;
  };
  /** Scene-space width, height, depth in metres. */
  readonly extentM: readonly [number, number, number];
  /** Where the viewer starts: a pose the scanner actually occupied. */
  readonly spawn: {
    readonly position: readonly [number, number, number];
    readonly yaw: number;
  } | null;
  /** The box the viewer may move within, in scene metres. */
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  } | null;
  /** How high the scanner was carried above the floor, in metres. */
  readonly eyeHeightM: number | null;
  readonly alignmentConfidence: "confident" | "review";
  readonly alignmentNote: string;
}

/**
 * Writes the generated manifest as a TypeScript module.
 *
 * TypeScript rather than JSON so the web package gets compile-time types
 * without `resolveJsonModule`, matching how `data/room-geometries.ts` is
 * already consumed. Stable key order keeps regeneration diffs readable.
 */
export function writeRoomManifest(outPath: string, entries: readonly RoomManifestEntry[]): void {
  const header = [
    "// GENERATED FILE - DO NOT EDIT BY HAND.",
    "//",
    "// Produced by @omnitwin/xgrids-lcc2:",
    "//   pnpm --filter @omnitwin/xgrids-lcc2 lcc2 -- stage",
    '//     --scans "<capture root>" --grand-hall "<grand hall root>"',
    '//     --out "<staging root>" --manifest "<this file>"',
    "//",
    "// Tile bytes are NOT in the repository: roughly a gigabyte across these",
    "// rooms is staged outside it and served from R2 in production. What lives",
    "// here is the descriptor - tile names, sizes, digests, and the room-local",
    "// transform derived from each capture's own room mesh.",
    "",
    "export interface GeneratedSplatTile {",
    "  readonly file: string;",
    "  readonly bytes: number;",
    "  readonly sha256: string;",
    "  /** Octree depth: 1 is coarsest and loads first. Null for the sky shell. */",
    "  readonly lodLevel: number | null;",
    "  /** The environment sphere, which is not room geometry. */",
    "  readonly isEnvironment: boolean;",
    "}",
    "",
    "export interface GeneratedRoomSplatBundle {",
    "  readonly roomSlug: string;",
    "  readonly captureDir: string;",
    "  readonly splatType: string;",
    "  readonly totalSplats: number;",
    "  readonly totalLevels: number;",
    "  readonly tiles: readonly GeneratedSplatTile[];",
    "  readonly totalBytes: number;",
    "  readonly transform: {",
    "    readonly position: readonly [number, number, number];",
    "    readonly rotation: readonly [number, number, number];",
    "    readonly scale: 1;",
    "  };",
    "  /** Scene-space width, height, depth in metres. */",
    "  readonly extentM: readonly [number, number, number];",
    "  /**",
    "   * Where the viewer starts, from the scanner's own walk.",
    "   *",
    "   * A pose the operator actually occupied, so it cannot be outside the room",
    "   * and is guaranteed to have captured surface in every direction. Null when",
    "   * the capture shipped no usable trajectory.",
    "   */",
    "  readonly spawn: {",
    "    readonly position: readonly [number, number, number];",
    "    readonly yaw: number;",
    "  } | null;",
    "  /**",
    "   * The box the viewer may move within, in scene metres.",
    "   *",
    "   * The region the operator walked. Outside it a capture has no data at all —",
    "   * only the backs of surfaces — so there is nothing there worth showing.",
    "   */",
    "  readonly bounds: {",
    "    readonly min: readonly [number, number, number];",
    "    readonly max: readonly [number, number, number];",
    "  } | null;",
    "  /** How high the scanner was carried above the floor, in metres. */",
    "  readonly eyeHeightM: number | null;",
    "  /**",
    "   * Whether the derived alignment can be trusted without human review.",
    "   * `review` means the capture is probably a whole-floor scan in which this",
    "   * room is only a part - see the tool's roomCropM.",
    "   */",
    "  readonly alignmentConfidence: \"confident\" | \"review\";",
    "  readonly alignmentNote: string;",
    "}",
    "",
    'export const GENERATED_VENUE_SLUG = "trades-hall";',
    "",
    "export const GENERATED_ROOM_SPLAT_BUNDLES: readonly GeneratedRoomSplatBundle[] =",
    `  ${JSON.stringify(entries, null, 2).split("\n").join("\n  ")} as const;`,
    "",
  ].join("\n");

  writeFileSync(outPath, header, "utf8");
}

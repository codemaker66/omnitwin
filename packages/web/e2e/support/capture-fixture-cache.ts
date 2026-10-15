import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GeneratedRoomSplatBundle, GeneratedSplatTile } from "../../src/data/generated/trades-hall-splat-bundles.js";

// ---------------------------------------------------------------------------
// Descriptor-pinned capture bytes for the planner e2e specs (T-654).
//
// The bytes are staged on disk before a run, by `scripts/stage-e2e-captures.mjs`
// locally or by CI's Actions cache. Tests only read and verify them here; they
// never fetch. Fetching inside the fixture made four planner specs depend on
// the public r2.dev bucket, which is rate-limited: on 13 October 2026 its
// downloads timed out or had their sockets closed mid-body for nine minutes
// and failed every attempt of those specs.
//
// Only type imports and Node built-ins appear here, so the staging script can
// load this file directly with Node's type stripping.
// ---------------------------------------------------------------------------

/** The public bucket that serves the published tiles named in the descriptor. */
export const PUBLISHED_CAPTURE_ORIGIN = "https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev";
/** Chooses the staging directory; the default suits a local machine. */
export const CAPTURE_CACHE_DIR_ENV = "E2E_CAPTURE_CACHE_DIR";
export const STAGE_CAPTURES_COMMAND = "pnpm --filter @omnitwin/web e2e:stage-captures";

/** The app path, and the bucket key prefix, of a room's staged tiles. */
export function capturePathPrefix(roomSlug: string): string {
  return `/splats/trades-hall/${roomSlug}/`;
}

/** What the planner requests for a staged room: the finest level and the environment shell. */
export function stagedFixtureTiles(bundle: GeneratedRoomSplatBundle): readonly GeneratedSplatTile[] {
  return bundle.tiles.filter((tile) => tile.isEnvironment || tile.lodLevel === bundle.finestLevel);
}

export function captureCacheDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[CAPTURE_CACHE_DIR_ENV]?.trim() ?? "";
  return configured.length > 0 ? configured : join(tmpdir(), "venviewer-e2e-captures-v1");
}

/** Bytes are stored under their digest, so restaged tiles never reuse stale bytes. */
export function cachedTilePath(directory: string, tile: Pick<GeneratedSplatTile, "sha256">): string {
  return join(directory, tile.sha256);
}

export function matchesDescriptor(tile: Pick<GeneratedSplatTile, "bytes" | "sha256">, bytes: Uint8Array): boolean {
  return bytes.length === tile.bytes && createHash("sha256").update(bytes).digest("hex") === tile.sha256;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Reads a staged tile, failing with the staging command when it is absent or altered. */
export async function readStagedTile(directory: string, tile: GeneratedSplatTile): Promise<Buffer> {
  let bytes: Buffer;
  try {
    bytes = await readFile(cachedTilePath(directory, tile));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    throw new Error(`Capture fixture ${tile.file} is not staged in ${directory}. Run \`${STAGE_CAPTURES_COMMAND}\` first.`);
  }
  if (!matchesDescriptor(tile, bytes)) {
    throw new Error(`Capture fixture ${tile.file} in ${directory} differs from its descriptor. Run \`${STAGE_CAPTURES_COMMAND}\` to stage it again.`);
  }
  return bytes;
}

/** Reads a tile that may legitimately be absent; altered bytes count as absent. */
export async function readTileIfStaged(directory: string, tile: GeneratedSplatTile): Promise<Buffer | null> {
  try {
    const bytes = await readFile(cachedTilePath(directory, tile));
    return matchesDescriptor(tile, bytes) ? bytes : null;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

import {
  LCC2_ENV_TILE_ID,
  lodLevelForTileId,
  tileIdForSplatFile,
  type Lcc2Manifest,
} from "./lcc2-manifest.js";

// ---------------------------------------------------------------------------
// Manifest -> room bundle.
//
// This is the descriptor the web runtime consumes: an ordered tile list with
// LOD levels, plus the counts needed for honest load progress. It is generated
// from the capture's own manifest rather than transcribed by hand, which is
// what the existing hand-written RECEPTION_TILE_MANIFEST is.
//
// Ordering is load order: coarsest LOD first so the room resolves from a rough
// whole into detail, with the environment shell last — it is a sky sphere, not
// room geometry, and a viewer that never gets to it has still seen the room.
// ---------------------------------------------------------------------------

export interface RoomBundleTile {
  /** Tile file name as it appears in the served bundle, e.g. "0_7_0_0.sog". */
  readonly file: string;
  /** Octree node id, e.g. "0_7_0_0". */
  readonly tileId: string;
  /** Octree depth; null for the environment shell. */
  readonly lodLevel: number | null;
  /** Path within the capture, e.g. "data/3dgs/0_7_0_0.sog". */
  readonly sourcePath: string;
  /** True for the sky sphere, which must never be measured as room geometry. */
  readonly isEnvironment: boolean;
}

export interface RoomBundle {
  readonly roomSlug: string;
  readonly splatType: string;
  readonly totalSplats: number;
  readonly totalLevels: number;
  readonly tiles: readonly RoomBundleTile[];
}

/**
 * Builds the ordered tile list for a room. Tiles sort by LOD level ascending
 * (coarse first), then by name for a stable, reproducible order; the
 * environment shell always sorts last.
 */
export function roomBundleFromManifest(roomSlug: string, manifest: Lcc2Manifest): RoomBundle {
  const splatFiles = manifest.root.splatFiles ?? [];

  const tiles: RoomBundleTile[] = splatFiles.map((sourcePath) => {
    const tileId = tileIdForSplatFile(sourcePath);
    const isEnvironment = tileId === LCC2_ENV_TILE_ID;
    return {
      file: sourcePath.split("/").pop() ?? sourcePath,
      tileId,
      lodLevel: lodLevelForTileId(tileId),
      sourcePath,
      isEnvironment,
    };
  });

  tiles.sort((left, right) => {
    if (left.isEnvironment !== right.isEnvironment) return left.isEnvironment ? 1 : -1;
    const leftLevel = left.lodLevel ?? Number.MAX_SAFE_INTEGER;
    const rightLevel = right.lodLevel ?? Number.MAX_SAFE_INTEGER;
    if (leftLevel !== rightLevel) return leftLevel - rightLevel;
    return left.file.localeCompare(right.file);
  });

  return {
    roomSlug,
    splatType: manifest.splatType,
    totalSplats: manifest.totalSplats,
    totalLevels: manifest.totalLevels,
    tiles,
  };
}

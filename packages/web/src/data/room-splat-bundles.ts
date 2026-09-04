import {
  GENERATED_ROOM_SPLAT_BUNDLES,
  GENERATED_VENUE_SLUG,
  type GeneratedRoomSplatBundle,
} from "./generated/trades-hall-splat-bundles.js";

// ---------------------------------------------------------------------------
// The captured layer, per room.
//
// Tile bytes live outside the repository — roughly a gigabyte across the eight
// Trades Hall rooms. This module turns the generated descriptor into what the
// scene needs: ordered tile URLs, the room-local transform derived from each
// capture's own room mesh, and a camera framed from that room's measured size.
//
// Everything here is derived. Nothing is hand-tuned per room, which is the
// point: the Reception Room's previous transform was eyeballed and carried a
// "not a signed room-local alignment" caveat, and each new room would have
// needed the same by-hand pass.
// ---------------------------------------------------------------------------

export type {
  GeneratedRoomSplatBundle,
  GeneratedSplatTile,
} from "./generated/trades-hall-splat-bundles.js";
import type { GeneratedSplatTile } from "./generated/trades-hall-splat-bundles.js";

/**
 * Where tile bytes are served from.
 *
 * Development serves the staging root through a Vite middleware; production
 * points at R2. Trailing slashes are trimmed so callers can join with "/"
 * without producing a doubled separator.
 */
export function splatBaseUrl(configuredBaseUrl: string | undefined): string {
  const configured = configuredBaseUrl?.trim() ?? "";
  const base = configured.length > 0 ? configured : "/splats";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function roomSplatBundle(roomSlug: string): GeneratedRoomSplatBundle | null {
  return GENERATED_ROOM_SPLAT_BUNDLES.find((bundle) => bundle.roomSlug === roomSlug) ?? null;
}

export function roomsWithSplatBundles(): readonly string[] {
  return GENERATED_ROOM_SPLAT_BUNDLES.map((bundle) => bundle.roomSlug);
}

/**
 * The tiles that reach the renderer: the finest level only, plus the sky shell.
 *
 * An XGRIDS LCC2 octree is not progressive detail. Each level is the WHOLE
 * room at a different density, so the finest level alone is the complete
 * reconstruction and every coarser level is a lower-density copy of the same
 * surfaces. Mounting them together draws the room once per level — the Grand
 * Hall's 24 tiles put 11.5 million splats on screen where its finest level is
 * 6.0 million, and the renderer froze for minutes even on a desktop GPU.
 *
 * The staged bundle keeps every level (a coarser tier is the right thing to
 * serve a phone), but serving is one level, never a stack.
 */
function servedTiles(bundle: GeneratedRoomSplatBundle): readonly GeneratedSplatTile[] {
  return bundle.tiles.filter(
    (tile) => tile.isEnvironment || tile.lodLevel === bundle.finestLevel,
  );
}

/**
 * Where a standing person's eyes are, in metres above the floor. The walk is
 * shown from here whatever height the scanner was carried at: the Grand Hall
 * capture records its pole at 3 m, which is a stepladder, not a visitor.
 */
export const WALK_EYE_HEIGHT_M = 1.6;
/** Vertical freedom either side of eye height: a crouch and a tiptoe. */
const WALK_EYE_BAND_M = 0.25;

export interface RoomWalkPose {
  readonly spawn: {
    readonly position: readonly [number, number, number];
    readonly yaw: number;
  };
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
}

/**
 * The pose a visitor walks from: the scanner's floor plan and heading, at a
 * person's eye height. The captured walk box keeps its x and z extent (the
 * operator's path is the only honest limit on where a visitor may stand) and
 * takes a narrow band around eye height instead of the scanner's; under a low
 * ceiling the eye drops so the head stays clear of it. Null for a capture that
 * shipped no walk.
 */
export function walkPoseForBundle(bundle: GeneratedRoomSplatBundle): RoomWalkPose | null {
  const { spawn, bounds } = bundle;
  if (spawn === null || bounds === null) return null;
  const ceiling = Math.max(bundle.extentM[1], 1);
  const eye = Math.min(WALK_EYE_HEIGHT_M, ceiling - 0.5);
  const low = Math.max(0.3, eye - WALK_EYE_BAND_M);
  const high = Math.min(ceiling - 0.2, eye + WALK_EYE_BAND_M);
  return {
    spawn: { position: [spawn.position[0], eye, spawn.position[2]], yaw: spawn.yaw },
    bounds: {
      min: [bounds.min[0], low, bounds.min[2]],
      max: [bounds.max[0], high, bounds.max[2]],
    },
  };
}

/** One thing the scene mounts for one served tile: the tile, or its prebuilt tree. */
export interface RoomSplatSource {
  readonly url: string;
  /** True when `url` is a paged Spark level-of-detail tree rather than the tile. */
  readonly tree: boolean;
  /** The tile this source stands for, for counting load progress per tile. */
  readonly file: string;
}

/**
 * The sources for a bundle under a room base URL.
 *
 * With `preferTrees`, a tile that has a prebuilt tree (built by `lcc2 lod`)
 * is served as that tree, paged, so the viewer neither downloads the whole
 * tile nor rebuilds a tree in the browser; a tile without one is served as
 * itself. Order is the served order: finest level, then the sky shell.
 */
function sourceForTile(
  tile: GeneratedSplatTile,
  roomBaseUrl: string,
  preferTrees: boolean,
): RoomSplatSource {
  const tree = preferTrees ? tile.lod : undefined;
  return tree === undefined
    ? { url: `${roomBaseUrl}/${tile.file}`, tree: false, file: tile.file }
    : { url: `${roomBaseUrl}/${tree.file}`, tree: true, file: tile.file };
}

export function splatSourcesForBundle(
  bundle: GeneratedRoomSplatBundle,
  roomBaseUrl: string,
  preferTrees: boolean,
): readonly RoomSplatSource[] {
  return servedTiles(bundle).map((tile) => sourceForTile(tile, roomBaseUrl, preferTrees));
}

/**
 * The two stages a room is delivered in, plus the sky that outlives both.
 *
 * Every XGRIDS level is the WHOLE room at one density, which is what makes a
 * ladder possible: the coarsest level is a complete, soft room in a single
 * 6-8 MB request, where the finest is 75-111 MB over eight to eleven. Serving
 * the coarse room first turns a blank canvas into a picture in seconds — the
 * finest level alone left the Grand Hall empty for 17.3 s and unfinished for
 * 45.9 s on a 20 Mbps line (measured 2026-09-04).
 *
 * The stages are mounted, never merged: two levels on screen at once draw the
 * same surfaces twice and haze the room, so the scene shows one and swaps.
 */
export interface RoomSplatLadder {
  /** The sky shell. Mounted once and kept: it does not get sharper. */
  readonly environment: readonly RoomSplatSource[];
  /** The coarse room, shown first. Empty when the capture has one level only. */
  readonly coarse: readonly RoomSplatSource[];
  /** The full reconstruction: the finest level, and what the visitor keeps. */
  readonly sharp: readonly RoomSplatSource[];
}

/** The coarsest level a capture staged, or null when it staged only one. */
function coarsestRoomLevel(bundle: GeneratedRoomSplatBundle): number | null {
  const levels = bundle.tiles
    .filter((tile) => !tile.isEnvironment && tile.lodLevel !== null)
    .map((tile) => tile.lodLevel as number);
  if (levels.length === 0) return null;
  const coarsest = Math.min(...levels);
  return coarsest < bundle.finestLevel ? coarsest : null;
}

/** A bundle's delivery ladder under a room base URL. */
export function splatLadderForBundle(
  bundle: GeneratedRoomSplatBundle,
  roomBaseUrl: string,
  preferTrees: boolean,
): RoomSplatLadder {
  const coarsest = coarsestRoomLevel(bundle);
  const atLevel = (level: number | null): readonly RoomSplatSource[] => (level === null
    ? []
    : bundle.tiles
      .filter((tile) => !tile.isEnvironment && tile.lodLevel === level)
      .map((tile) => sourceForTile(tile, roomBaseUrl, preferTrees)));
  return {
    environment: bundle.tiles
      .filter((tile) => tile.isEnvironment)
      .map((tile) => sourceForTile(tile, roomBaseUrl, preferTrees)),
    coarse: atLevel(coarsest),
    sharp: atLevel(bundle.finestLevel),
  };
}

/** The delivery ladder for a room; every stage empty for an unknown room. */
export function roomSplatLadder(
  roomSlug: string,
  configuredBaseUrl: string | undefined,
  preferTrees: boolean,
): RoomSplatLadder {
  const bundle = roomSplatBundle(roomSlug);
  if (bundle === null) return { environment: [], coarse: [], sharp: [] };
  const base = `${splatBaseUrl(configuredBaseUrl)}/${GENERATED_VENUE_SLUG}/${roomSlug}`;
  return splatLadderForBundle(bundle, base, preferTrees);
}

/** The sources for a room, environment shell last; empty for an unknown room. */
export function roomSplatTileSources(
  roomSlug: string,
  configuredBaseUrl: string | undefined,
  preferTrees: boolean,
): readonly RoomSplatSource[] {
  const bundle = roomSplatBundle(roomSlug);
  if (bundle === null) return [];
  const base = `${splatBaseUrl(configuredBaseUrl)}/${GENERATED_VENUE_SLUG}/${roomSlug}`;
  return splatSourcesForBundle(bundle, base, preferTrees);
}

/**
 * Tile URLs for a room, environment shell last.
 *
 * The generated bundle is already ordered, so this only selects the served
 * level and prefixes the base. The environment shell stays included but last —
 * a viewer whose connection gives out before it arrives has still seen the
 * room, which is the part that matters.
 */
export function roomSplatTileUrls(
  roomSlug: string,
  configuredBaseUrl: string | undefined,
): readonly string[] {
  return roomSplatTileSources(roomSlug, configuredBaseUrl, false).map((source) => source.url);
}

/** Splats the served level draws: the reconstruction's true count. */
export function roomSplatServedSplats(roomSlug: string): number {
  return roomSplatBundle(roomSlug)?.finestLevelSplats ?? 0;
}

/** Tiles a viewer fetches for a room, sky shell included. */
export function roomSplatServedTileCount(roomSlug: string): number {
  const bundle = roomSplatBundle(roomSlug);
  return bundle === null ? 0 : servedTiles(bundle).length;
}

/** Bytes a room will actually pull, for honest load progress. */
export function roomSplatServedBytes(roomSlug: string): number {
  const bundle = roomSplatBundle(roomSlug);
  if (bundle === null) return 0;
  return servedTiles(bundle).reduce((sum, tile) => sum + tile.bytes, 0);
}

/** Bytes staged across every level, which is more than any viewer fetches. */
export function roomSplatTotalBytes(roomSlug: string): number {
  return roomSplatBundle(roomSlug)?.totalBytes ?? 0;
}

export interface DerivedRoomCamera {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly targetBounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
}

const CAMERA_FOV_DEGREES = 48;

/** Eye height for an interior view, in metres. */
const EYE_HEIGHT_M = 1.6;

/**
 * Frames a camera from a room's measured extent.
 *
 * The room is already centred on the origin with its floor at y = 0 by the
 * generated transform, so framing is a function of size alone: stand far enough
 * back that the wider of the two floor axes fits the field of view, look at the
 * middle of the room at roughly eye height, and keep the target inside the
 * walls so a drag cannot wander out of the room.
 *
 * A room shorter than eye height would otherwise put the camera in the ceiling,
 * so both heights are clamped against the measured ceiling.
 */
export function deriveRoomCamera(extentM: readonly [number, number, number]): DerivedRoomCamera {
  const [width, height, depth] = extentM;
  const halfWidth = Math.max(width, 0.5) / 2;
  const halfDepth = Math.max(depth, 0.5) / 2;
  const safeHeight = Math.max(height, 0.5);

  const halfFov = (CAMERA_FOV_DEGREES * Math.PI) / 180 / 2;
  // The distance at which the whole room would fit the frame. For most real
  // rooms this is further away than the room is deep.
  const fitDistance = (Math.max(halfWidth, halfDepth) / Math.tan(halfFov)) * 1.15;

  // Stand INSIDE the room, near the back wall. Using fitDistance directly would
  // put the camera beyond the far wall and show the room from outside as a
  // floating object — measured on the Reception Room, whose fit distance is
  // 19.0 m against a 14.7 m depth. Seeing the whole room at once is not what
  // standing in one looks like, so containment wins over framing.
  const standDistance = Math.min(fitDistance, halfDepth * 0.82);

  const lookHeight = Math.min(EYE_HEIGHT_M, safeHeight * 0.6);
  const standHeight = Math.min(EYE_HEIGHT_M * 1.25, safeHeight * 0.75);

  return {
    position: [0, standHeight, standDistance],
    target: [0, lookHeight, -halfDepth * 0.35],
    fov: CAMERA_FOV_DEGREES,
    minDistance: 0.8,
    // Far enough to back into a corner, never far enough to leave the room.
    maxDistance: Math.max(standDistance * 1.35, Math.hypot(halfWidth, halfDepth)),
    targetBounds: {
      min: [-halfWidth * 0.9, 0.3, -halfDepth * 0.9],
      max: [halfWidth * 0.9, Math.max(0.4, safeHeight * 0.85), halfDepth * 0.9],
    },
  };
}

/**
 * Whether this room's alignment has been reviewed by a human.
 *
 * `review` means the tool derived a frame it does not vouch for — usually a
 * whole-floor capture in which the room is only a part. The room still renders;
 * the caller is expected to say so rather than present it as settled.
 */
export function roomAlignmentIsConfident(roomSlug: string): boolean {
  return roomSplatBundle(roomSlug)?.alignmentConfidence === "confident";
}

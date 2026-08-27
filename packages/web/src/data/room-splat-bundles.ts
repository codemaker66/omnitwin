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
 * Tile URLs in load order: coarsest level first, environment shell last.
 *
 * The generated bundle is already ordered, so this only prefixes the base. The
 * environment shell stays included but last — a viewer whose connection gives
 * out before it arrives has still seen the room, which is the part that matters.
 */
export function roomSplatTileUrls(
  roomSlug: string,
  configuredBaseUrl: string | undefined,
): readonly string[] {
  const bundle = roomSplatBundle(roomSlug);
  if (bundle === null) return [];
  const base = `${splatBaseUrl(configuredBaseUrl)}/${GENERATED_VENUE_SLUG}/${roomSlug}`;
  return bundle.tiles.map((tile) => `${base}/${tile.file}`);
}

/** Total bytes a room will pull, for honest load progress. */
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

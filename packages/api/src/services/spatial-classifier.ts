// ---------------------------------------------------------------------------
// Spatial Zone Classifier — converts coordinates to human-readable positions
//
// Takes a placed object's XZ position (real-world metres, origin at room
// centre) and the room dimensions, and produces a description a hallkeeper
// can read: "Centre of room, 3.2m from stage" or "Front-right, against east wall".
// ---------------------------------------------------------------------------

/** Named zone in the 3×3 room grid. */
export type ZoneName =
  | "front-left" | "front-centre" | "front-right"
  | "centre-left" | "centre" | "centre-right"
  | "back-left" | "back-centre" | "back-right";

/** Room orientation info needed by the classifier. */
export interface RoomLayout {
  /** Room width in metres (X axis). */
  readonly widthM: number;
  /** Room length in metres (Z axis — front-to-back). */
  readonly lengthM: number;
  /** Named features for distance references. */
  readonly features: readonly RoomFeaturePoint[];
}

/** A named point of interest in the room (entrance, stage, exit). */
export interface RoomFeaturePoint {
  readonly name: string;
  /** Position in metres, origin at room centre. */
  readonly x: number;
  readonly z: number;
}

/** Output of the spatial classifier. */
export interface SpatialDescription {
  /** 3×3 zone name. */
  readonly zone: ZoneName;
  /** Human-readable description. */
  readonly description: string;
  /** Distance to nearest wall in metres. */
  readonly nearestWallDistanceM: number;
  /** Name of nearest wall ("north", "south", "east", "west"). */
  readonly nearestWall: string;
}

/** Wall proximity threshold — below this, describe as "against [wall]". */
const AGAINST_WALL_THRESHOLD_M = 0.5;

// ---------------------------------------------------------------------------
// Zone classification
// ---------------------------------------------------------------------------

/**
 * Classifies an XZ position into one of 9 named zones.
 *
 * The room is divided into a 3×3 grid. The Z axis runs front-to-back
 * (negative Z = front/entrance, positive Z = back/stage).
 * The X axis runs left-to-right (negative X = left, positive X = right)
 * from the perspective of someone walking in from the entrance.
 */
export function classifyZone(
  x: number,
  z: number,
  widthM: number,
  lengthM: number,
): ZoneName {
  const halfW = widthM / 2;
  const halfL = lengthM / 2;
  const thirdW = widthM / 3;
  const thirdL = lengthM / 3;

  // Normalise to zone boundaries (room goes from -half to +half)
  const col = x < -halfW + thirdW ? "left" : x > halfW - thirdW ? "right" : "centre";
  // Negative Z = front (entrance), positive Z = back
  const row = z < -halfL + thirdL ? "front" : z > halfL - thirdL ? "back" : "centre";

  if (row === "centre" && col === "centre") return "centre";
  return `${row}-${col}` as ZoneName;
}

// ---------------------------------------------------------------------------
// Wall distance
// ---------------------------------------------------------------------------

interface WallDistance {
  readonly wall: string;
  readonly distanceM: number;
}

/**
 * Computes distance to the four cardinal walls of a rectangular room.
 * Returns the nearest wall name and distance.
 *
 * Convention: "north" = front (negative Z), "south" = back (positive Z),
 * "west" = left (negative X), "east" = right (positive X).
 */
export function computeNearestWall(
  x: number,
  z: number,
  widthM: number,
  lengthM: number,
): WallDistance {
  const halfW = widthM / 2;
  const halfL = lengthM / 2;

  const distances: readonly WallDistance[] = [
    { wall: "north", distanceM: z + halfL },    // front wall
    { wall: "south", distanceM: halfL - z },     // back wall
    { wall: "west", distanceM: x + halfW },      // left wall
    { wall: "east", distanceM: halfW - x },      // right wall
  ];

  let nearest = distances[0]!;
  for (const d of distances) {
    if (d.distanceM < nearest.distanceM) nearest = d;
  }
  return { wall: nearest.wall, distanceM: Math.max(0, nearest.distanceM) };
}

// ---------------------------------------------------------------------------
// Feature distance
// ---------------------------------------------------------------------------

interface FeatureDistance {
  readonly name: string;
  readonly distanceM: number;
}

/**
 * Finds the nearest named feature and distance from a point.
 * Returns null if no features are defined.
 */
export function computeNearestFeature(
  x: number,
  z: number,
  features: readonly RoomFeaturePoint[],
): FeatureDistance | null {
  if (features.length === 0) return null;

  let nearest: FeatureDistance | null = null;
  for (const f of features) {
    const dx = x - f.x;
    const dz = z - f.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (nearest === null || dist < nearest.distanceM) {
      nearest = { name: f.name, distanceM: dist };
    }
  }
  return nearest;
}

// ---------------------------------------------------------------------------
// Description builder
// ---------------------------------------------------------------------------

/** Human-friendly zone labels. */
const ZONE_LABELS: Readonly<Record<ZoneName, string>> = {
  "front-left": "Front-left",
  "front-centre": "Front-centre",
  "front-right": "Front-right",
  "centre-left": "Centre-left",
  "centre": "Centre of room",
  "centre-right": "Centre-right",
  "back-left": "Back-left",
  "back-centre": "Back-centre",
  "back-right": "Back-right",
};

/**
 * Generates a full spatial description for a placed object.
 *
 * Examples:
 * - "Centre of room, 3.2m from stage"
 * - "Front-right, against east wall"
 * - "Back-centre, 1.5m from south wall"
 */
export function classifyPosition(
  x: number,
  z: number,
  room: RoomLayout,
): SpatialDescription {
  const zone = classifyZone(x, z, room.widthM, room.lengthM);
  const { wall, distanceM } = computeNearestWall(x, z, room.widthM, room.lengthM);
  const nearestFeature = computeNearestFeature(x, z, room.features);

  const zoneLabel = ZONE_LABELS[zone];
  let detail: string;

  if (distanceM < AGAINST_WALL_THRESHOLD_M) {
    detail = `against ${wall} wall`;
  } else if (nearestFeature !== null && nearestFeature.distanceM < distanceM) {
    detail = `${nearestFeature.distanceM.toFixed(1)}m from ${nearestFeature.name}`;
  } else {
    detail = `${distanceM.toFixed(1)}m from ${wall} wall`;
  }

  return {
    zone,
    description: `${zoneLabel}, ${detail}`,
    nearestWallDistanceM: distanceM,
    nearestWall: wall,
  };
}

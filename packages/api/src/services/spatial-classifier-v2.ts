import type { Zone } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Spatial Classifier V2 — 7-zone classification for the hallkeeper sheet
//
// v1's 3x3 grid was useful for placement descriptions ("Front-left,
// 2.1m from stage") but the hallkeeper's foot path doesn't follow a
// 3x3 — they walk the perimeter first, then the centre, and treat
// walls and entrances as distinct landmarks.
//
// v2 collapses to 7 zones that match the demo's model:
//
//   - Entrance     (near the door — registration desk, guest book go here)
//   - North wall   (upper edge of the plan)
//   - South wall   (lower edge)
//   - East wall    (right edge)
//   - West wall    (left edge)
//   - Perimeter    (near any wall but not a cardinal edge)
//   - Centre       (everything else)
//
// Coordinate convention (inherited from v1):
//   x axis: left (-) to right (+)
//   z axis: front/entrance (-) to back (+)
//   Origin at room centre, metres.
//
// The classifier is pure — no room features, no fallback logic.
// Callers that want "against north wall, 2.1m from stage" join the
// v2 zone to v1's feature-distance output.
// ---------------------------------------------------------------------------

/** Normalised fractional bands — these match the demo's classifier exactly. */
const NORTH_BAND = 0.2;   // top 20% of the room length
const SOUTH_BAND = 0.8;   // bottom 80%+ of the room length
const WEST_BAND = 0.15;   // left 15% of the room width
const EAST_BAND = 0.85;   // right 85%+ of the room width
const PERIMETER_X_INNER = 0.25;
const PERIMETER_X_OUTER = 0.75;
const PERIMETER_Z_INNER = 0.30;
const PERIMETER_Z_OUTER = 0.70;

export interface RoomDimensions {
  readonly widthM: number;
  readonly lengthM: number;
}

/**
 * Classify an (x, z) position into one of 7 zones.
 *
 * The "Entrance" zone takes precedence over "West wall" when both
 * apply: the entrance lives at the west side of Trades Hall's Grand
 * Hall, and a reg desk there is a reg desk at the entrance, not
 * "against the west wall". This is an opinionated priority — if a
 * future venue has the entrance elsewhere, we'd parameterise it.
 */
export function classifyZoneV2(
  x: number,
  z: number,
  room: RoomDimensions,
): Zone {
  // Normalise to [0, 1] where 0,0 is the front-left corner.
  const nx = (x + room.widthM / 2) / room.widthM;
  const nz = (z + room.lengthM / 2) / room.lengthM;

  // Entrance is the front-left slice (low nx AND low-middle nz band).
  // This matches where reg desks actually land in Trades Hall plans.
  if (nx < WEST_BAND && nz > SOUTH_BAND * 0.7) return "Entrance";

  // Cardinal walls — check these before perimeter/centre.
  if (nz < NORTH_BAND) return "North wall";
  if (nz > SOUTH_BAND) return "South wall";
  if (nx > EAST_BAND) return "East wall";
  if (nx < WEST_BAND) return "West wall";

  // Perimeter: near-but-not-against any edge.
  if (nx < PERIMETER_X_INNER || nx > PERIMETER_X_OUTER ||
      nz < PERIMETER_Z_INNER || nz > PERIMETER_Z_OUTER) {
    return "Perimeter";
  }

  return "Centre";
}

/**
 * Sort order for zones on the sheet. This matches how the hallkeeper
 * walks the room: structure/entrance first, then perimeter (so they're
 * not walking past completed work), then centre, last touches last.
 */
const ZONE_ORDER: Readonly<Record<Zone, number>> = {
  "Entrance": 0,
  "North wall": 1,
  "West wall": 2,
  "East wall": 3,
  "South wall": 4,
  "Perimeter": 5,
  "Centre": 6,
};

export function zoneSortKey(zone: Zone): number {
  return ZONE_ORDER[zone];
}

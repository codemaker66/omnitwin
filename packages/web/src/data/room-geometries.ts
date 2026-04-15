// ---------------------------------------------------------------------------
// Room geometry data — accurate wall polygons for Trades Hall Glasgow
// Coordinates are in real-world metres, origin at room centre (0,0).
// Polygons are clockwise when viewed from above (Y-down in 2D → XZ plane).
// ---------------------------------------------------------------------------

export interface RoomFeature {
  readonly type: "platform" | "alcove" | "column";
  readonly polygon: readonly (readonly [number, number])[];
  readonly height: number;
  readonly label: string;
}

export interface RoomGeometry {
  /** Wall outline as [x, z] pairs in metres, clockwise, centred at origin. */
  readonly wallPolygon: readonly (readonly [number, number])[];
  /** Ceiling height in metres. */
  readonly ceilingHeight: number;
  /** Additional architectural features (balconies, platforms, alcoves). */
  readonly features: readonly RoomFeature[];
  /** Whether this room has a dome. */
  readonly hasDome: boolean;
  /** Dome radius in metres (only if hasDome is true). */
  readonly domeRadius: number;
}

// ---------------------------------------------------------------------------
// 1. Grand Hall — 21m × 10m with balcony along south wall
// Rectangular with a raised balcony platform (2m deep, 0.8m high)
// Has a 7m diameter gilded dome in the ceiling centre
// ---------------------------------------------------------------------------

const GRAND_HALL_HW = 10.5; // half-width  = 21m / 2
const GRAND_HALL_HL = 5;    // half-length = 10m / 2

const grandHallPolygon: readonly (readonly [number, number])[] = [
  [-GRAND_HALL_HW, -GRAND_HALL_HL],
  [GRAND_HALL_HW, -GRAND_HALL_HL],
  [GRAND_HALL_HW, GRAND_HALL_HL],
  [-GRAND_HALL_HW, GRAND_HALL_HL],
];

const grandHallFeatures: readonly RoomFeature[] = [];

// ---------------------------------------------------------------------------
// 2. Saloon — 11.9m × 6.9m with alcove niches
// Roughly rectangular with shallow alcoves on the long walls
// ---------------------------------------------------------------------------

const SALOON_HW = 5.95; // half width (11.9/2)
const SALOON_HL = 3.45; // half length (6.9/2)
const ALCOVE_DEPTH = 0.6;
const ALCOVE_WIDTH = 1.8;

const saloonPolygon: readonly (readonly [number, number])[] = [
  // Start bottom-left, go clockwise
  [-SALOON_HW, -SALOON_HL],
  // Bottom wall (south) — straight
  [SALOON_HW, -SALOON_HL],
  // Right wall (east) — with two alcoves
  [SALOON_HW, -SALOON_HL + 1.5],
  [SALOON_HW + ALCOVE_DEPTH, -SALOON_HL + 1.5],
  [SALOON_HW + ALCOVE_DEPTH, -SALOON_HL + 1.5 + ALCOVE_WIDTH],
  [SALOON_HW, -SALOON_HL + 1.5 + ALCOVE_WIDTH],
  [SALOON_HW, SALOON_HL - 1.5 - ALCOVE_WIDTH],
  [SALOON_HW + ALCOVE_DEPTH, SALOON_HL - 1.5 - ALCOVE_WIDTH],
  [SALOON_HW + ALCOVE_DEPTH, SALOON_HL - 1.5],
  [SALOON_HW, SALOON_HL - 1.5],
  // Top wall (north) — straight
  [SALOON_HW, SALOON_HL],
  [-SALOON_HW, SALOON_HL],
  // Left wall (west) — with two alcoves
  [-SALOON_HW, SALOON_HL - 1.5],
  [-SALOON_HW - ALCOVE_DEPTH, SALOON_HL - 1.5],
  [-SALOON_HW - ALCOVE_DEPTH, SALOON_HL - 1.5 - ALCOVE_WIDTH],
  [-SALOON_HW, SALOON_HL - 1.5 - ALCOVE_WIDTH],
  [-SALOON_HW, -SALOON_HL + 1.5 + ALCOVE_WIDTH],
  [-SALOON_HW - ALCOVE_DEPTH, -SALOON_HL + 1.5 + ALCOVE_WIDTH],
  [-SALOON_HW - ALCOVE_DEPTH, -SALOON_HL + 1.5],
  [-SALOON_HW, -SALOON_HL + 1.5],
];

// ---------------------------------------------------------------------------
// 3. Reception Room — L-shaped: 9.6m × 7m upper + 7.3m × 5m lower
// Traced from the floor plan image (reception-room-floorplan.png)
// Total bounding box: ~9.6m wide × 12m deep
// Centred at origin
// ---------------------------------------------------------------------------

const receptionPolygon: readonly (readonly [number, number])[] = [
  // Upper section — ceremony/seating area (9.6m wide, 7m deep)
  // Start top-left, clockwise
  [-4.8, -6.0],   // top-left
  [4.8, -6.0],    // top-right
  [4.8, 1.0],     // right side down to junction
  // Step in to lower section width
  [3.65, 1.0],    // step right edge
  [3.65, 6.0],    // bottom-right of lower section
  [-3.65, 6.0],   // bottom-left of lower section
  [-3.65, 1.0],   // step left edge
  [-4.8, 1.0],    // left side at junction
];

// ---------------------------------------------------------------------------
// 4. Robert Adam Room — two sections, wide top + narrow bottom
//    Upper: 11.4m wide × 7.4m deep (main ceremony/seating area)
//    Lower: 5.6m wide × 5.0m deep (secondary space, left-aligned)
//    Left walls are flush. Step-in is on the RIGHT side.
//    Curved wall: LEFT side of lower section, concave (curves inward ~1.2m)
//    Centred on the upper section's midpoint.
//    Total bounding: 11.4m wide × 12.4m deep
// ---------------------------------------------------------------------------

// Origin at centre of upper section
const RA_UW = 5.7;  // upper half-width (11.4/2)
const RA_UD = 3.7;  // upper half-depth (7.4/2)
// Lower section is 5.6m wide (left-aligned with upper), 5.0m deep
const RA_LD = 5.0;

const robertAdamPolygon: readonly (readonly [number, number])[] = [
  // Upper section — start top-left, clockwise
  [-RA_UW, -RA_UD],                          // top-left
  [RA_UW, -RA_UD],                           // top-right
  [RA_UW, RA_UD],                            // bottom-right of upper

  // Step IN on the right — lower section is narrower, left-aligned
  // Lower right wall: x = left wall + 5.6m = -5.7 + 5.6 = -0.1
  [-0.1, RA_UD],                             // step-in point

  // Lower right wall going down
  [-0.1, RA_UD + RA_LD],                     // bottom-right of lower

  // Bottom wall with small door indentations (0.3m deep)
  [-1.6, RA_UD + RA_LD],
  [-1.6, RA_UD + RA_LD + 0.3],              // door 1
  [-2.4, RA_UD + RA_LD + 0.3],
  [-2.4, RA_UD + RA_LD],
  [-3.3, RA_UD + RA_LD],
  [-3.3, RA_UD + RA_LD + 0.3],              // door 2
  [-4.1, RA_UD + RA_LD + 0.3],
  [-4.1, RA_UD + RA_LD],

  // Bottom-left of lower
  [-RA_UW, RA_UD + RA_LD],

  // Left wall of lower section — concave curve inward (~1.2m over 4m span)
  // Curves from (-5.7, 8.7) up to (-5.7, 3.7), bowing RIGHT (inward)
  [-5.7, RA_UD + RA_LD - 0.5],              // start of curve
  [-4.9, RA_UD + RA_LD - 1.2],
  [-4.6, RA_UD + RA_LD - 2.0],
  [-4.5, RA_UD + RA_LD - 2.5],              // apex — 1.2m inward
  [-4.6, RA_UD + RA_LD - 3.0],
  [-4.9, RA_UD + RA_LD - 3.8],
  [-5.7, RA_UD + RA_LD - 4.5],              // end of curve

  // Left wall continues straight up to upper section
  [-RA_UW, RA_UD],                           // bottom-left of upper = top-left of lower
];

// ---------------------------------------------------------------------------
// Export all room geometries keyed by space name
// ---------------------------------------------------------------------------

export const roomGeometries: Readonly<Record<string, RoomGeometry>> = {
  "Grand Hall": {
    wallPolygon: grandHallPolygon,
    ceilingHeight: 7.0,
    features: grandHallFeatures,
    hasDome: true,
    domeRadius: 3.5,
  },
  "Saloon": {
    wallPolygon: saloonPolygon,
    ceilingHeight: 5.4,
    features: [],
    hasDome: false,
    domeRadius: 0,
  },
  "Reception Room": {
    wallPolygon: receptionPolygon,
    ceilingHeight: 3.2,
    features: [],
    hasDome: false,
    domeRadius: 0,
  },
  "Robert Adam Room": {
    wallPolygon: robertAdamPolygon,
    ceilingHeight: 2.18,
    features: [],
    hasDome: false,
    domeRadius: 0,
  },
};

// ---------------------------------------------------------------------------
// Per-space geometry resolution — prefers the hand-authored Trades Hall
// geometry (balconies, dome, alcoves), falls back to the space's own
// floorPlanOutline, and null only as a last resort.
//
// Historically the editor looked up geometries by space NAME. That meant any
// space outside the original four Trades Hall rooms — future venues, custom
// admin-authored spaces — rendered against the generic GrandHallRoom fallback
// instead of its own floor plan. This resolver honours the polygon-as-source-
// of-truth invariant from the backend: if the space has a polygon, we render
// that polygon.
// ---------------------------------------------------------------------------

export interface SpaceLike {
  readonly name: string;
  readonly heightM: string;
  readonly floorPlanOutline: readonly { readonly x: number; readonly y: number }[];
}

const MIN_POLYGON_POINTS = 3;

export function resolveRoomGeometry(space: SpaceLike): RoomGeometry | null {
  // 1. Hand-authored geometry for known Trades Hall rooms.
  const named = roomGeometries[space.name];
  if (named !== undefined) return named;

  // 2. Derive from the space's own polygon. The backend guarantees a
  //    ≥3-point outline on every space (enforced by routes/spaces.ts +
  //    the 0007 migration) — this is the polygon-driven runtime path.
  if (space.floorPlanOutline.length >= MIN_POLYGON_POINTS) {
    const wallPolygon: readonly (readonly [number, number])[] = space.floorPlanOutline.map(
      (p) => [p.x, p.y] as const,
    );
    const height = parseFloat(space.heightM);
    return {
      wallPolygon,
      ceilingHeight: Number.isFinite(height) && height > 0 ? height : 3,
      features: [],
      hasDome: false,
      domeRadius: 0,
    };
  }

  // 3. No usable polygon — caller falls back to the hard-coded GrandHallRoom.
  return null;
}

// ---------------------------------------------------------------------------
// Utility: compute bounding box of a polygon
// ---------------------------------------------------------------------------

export function computeBoundingBox(polygon: readonly (readonly [number, number])[]): {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly width: number;
  readonly depth: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

/**
 * Point-in-polygon test using ray casting algorithm.
 * Works for any simple polygon (convex or concave, no self-intersections).
 */
export function isPointInPolygon(
  px: number,
  pz: number,
  polygon: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]?.[0] ?? 0;
    const zi = polygon[i]?.[1] ?? 0;
    const xj = polygon[j]?.[0] ?? 0;
    const zj = polygon[j]?.[1] ?? 0;

    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

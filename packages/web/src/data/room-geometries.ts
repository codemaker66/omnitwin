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
// 1. Grand Hall — 21m × 10.5m with balcony along south wall
// Rectangular with a raised balcony platform (2m deep, 0.8m high)
// Has a 7m diameter gilded dome in the ceiling centre
// ---------------------------------------------------------------------------

const GRAND_HALL_HW = 10.5; // half width (21/2)
const GRAND_HALL_HL = 5.25; // half length (10.5/2)

const grandHallPolygon: readonly (readonly [number, number])[] = [
  [-GRAND_HALL_HW, -GRAND_HALL_HL],
  [GRAND_HALL_HW, -GRAND_HALL_HL],
  [GRAND_HALL_HW, GRAND_HALL_HL],
  [-GRAND_HALL_HW, GRAND_HALL_HL],
];

const grandHallFeatures: readonly RoomFeature[] = [
  {
    type: "platform",
    polygon: [
      [-GRAND_HALL_HW, -GRAND_HALL_HL],
      [GRAND_HALL_HW, -GRAND_HALL_HL],
      [GRAND_HALL_HW, -GRAND_HALL_HL + 2.0],
      [-GRAND_HALL_HW, -GRAND_HALL_HL + 2.0],
    ],
    height: 0.8,
    label: "Balcony",
  },
];

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
// 4. Robert Adam Room — 9.7m × 5.6m
// Rectangular room with a subtle curved bay window on one end wall.
// The curve bows outward ~0.4m over a 3m span on the south wall.
// Ceiling height 2.18m — a low, intimate, ornate room.
// ---------------------------------------------------------------------------

const ROBERT_HW = 4.85; // half width (9.7/2)
const ROBERT_HL = 2.8;  // half length (5.6/2)

const robertAdamPolygon: readonly (readonly [number, number])[] = [
  // Start top-left, clockwise
  [-ROBERT_HW, -ROBERT_HL],
  [ROBERT_HW, -ROBERT_HL],
  [ROBERT_HW, ROBERT_HL],
  // South wall — subtle curved bay window (6 segments, ~0.4m outward)
  [1.5, ROBERT_HL],
  [1.2, ROBERT_HL + 0.2],
  [0.6, ROBERT_HL + 0.35],
  [0.0, ROBERT_HL + 0.4],
  [-0.6, ROBERT_HL + 0.35],
  [-1.2, ROBERT_HL + 0.2],
  [-1.5, ROBERT_HL],
  [-ROBERT_HW, ROBERT_HL],
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

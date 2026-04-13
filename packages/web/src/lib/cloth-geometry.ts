// ---------------------------------------------------------------------------
// cloth-geometry — pure functions for procedural table cloth drape meshes
// ---------------------------------------------------------------------------

/** Offset above table top so cloth clears the table surface geometry. */
const CLOTH_OFFSET = 0.035;

/** How far the cloth disc overhangs past the table edge (render-space). */
const OVERHANG = 0.04;

/** Number of fabric folds around the skirt circumference. */
const NUM_FOLDS = 14;

/** Secondary fold frequency for realism (breaks regularity). */
const FOLD_SECONDARY_FREQ = 2.3;

/** Phase offset for secondary folds. */
const FOLD_SECONDARY_PHASE = 1.7;

/** How far the cloth flares out at the very bottom (render-space). */
const BOTTOM_FLARE = 0.04;

// ---------------------------------------------------------------------------
// Round cloth — disc top + hanging skirt with fabric folds
// ---------------------------------------------------------------------------

/**
 * Compute geometry for a round banquet table cloth.
 * Two parts:
 *   1. Flat disc on top of the table
 *   2. Hanging cylindrical skirt from table edge to floor, with pleat folds
 *
 * The cloth completely covers the table — when clothed, the table mesh is hidden.
 *
 * @param tableRadius    - Radius of the table top (render-space)
 * @param tableHeight    - Height of the table top (Y, real-world, unscaled)
 * @param radialSegments - Segments around the circumference (default 64)
 * @param discRings      - Concentric rings on the flat top (default 6)
 * @param skirtRings     - Vertical rings on the hanging skirt (default 20)
 * @param foldDepth      - Depth of each pleat fold (render-space, default 0.05)
 * @param progress       - Animation progress 0–1 (0 = flat disc, 1 = full drape)
 */
export function computeRoundClothGeometry(
  tableRadius: number,
  tableHeight: number,
  radialSegments: number = 64,
  discRings: number = 6,
  skirtRings: number = 20,
  foldDepth: number = 0.05,
  progress: number = 1,
): ClothGeometryResult {
  const stride = radialSegments + 1;
  const discVertCount = (discRings + 1) * stride;
  const skirtVertCount = skirtRings * stride; // skirt ring 0 = disc outer ring (shared)
  const totalVerts = discVertCount + skirtVertCount;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  let vi = 0;
  let ni = 0;
  let ui = 0;

  // --- Part 1: Flat disc on table top (overhangs table edge) ---
  const discRadius = tableRadius + OVERHANG;
  for (let ring = 0; ring <= discRings; ring++) {
    const ringFrac = ring / discRings;
    const r = ringFrac * discRadius;

    for (let seg = 0; seg <= radialSegments; seg++) {
      const theta = (seg / radialSegments) * Math.PI * 2;

      positions[vi++] = r * Math.cos(theta);
      positions[vi++] = tableHeight + CLOTH_OFFSET;
      positions[vi++] = r * Math.sin(theta);

      normals[ni++] = 0;
      normals[ni++] = 1;
      normals[ni++] = 0;

      uvs[ui++] = 0.5 + ringFrac * 0.5 * Math.cos(theta);
      uvs[ui++] = 0.5 + ringFrac * 0.5 * Math.sin(theta);
    }
  }

  // --- Part 2: Hanging skirt from table edge to floor ---
  // progress controls how far the skirt has unfurled (0 = tucked at edge, 1 = floor)
  for (let ring = 1; ring <= skirtRings; ring++) {
    // t goes from 0 (table edge) to 1 (floor)
    const t = ring / skirtRings;

    // Y position: modulated by progress (unfurl animation)
    const effectiveT = t * progress;
    const y = tableHeight * (1 - effectiveT);

    // Fold amplitude increases toward the floor, scaled by progress
    const amp = foldDepth * smoothstep(t, 0.05, 0.6) * progress;

    // Slight flare at the very bottom
    const flare = BOTTOM_FLARE * smoothstep(t, 0.7, 1.0) * progress;

    for (let seg = 0; seg <= radialSegments; seg++) {
      const theta = (seg / radialSegments) * Math.PI * 2;

      // Fold displacement: primary + secondary for natural irregularity
      const fold = computeFoldDisplacement(theta, amp);

      const r = discRadius + fold + flare;

      positions[vi++] = r * Math.cos(theta);
      positions[vi++] = y;
      positions[vi++] = r * Math.sin(theta);

      // Normal: mostly outward, tilted by fold
      const foldDeriv = computeFoldDerivative(theta, amp);
      const nx = Math.cos(theta);
      const nz = Math.sin(theta);
      // Cross product gives tangent-aware normal
      const nLen = Math.sqrt(nx * nx + foldDeriv * foldDeriv + nz * nz);
      normals[ni++] = nx / nLen;
      normals[ni++] = -foldDeriv / nLen;
      normals[ni++] = nz / nLen;

      uvs[ui++] = seg / radialSegments;
      uvs[ui++] = 0.5 + t * 0.5;
    }
  }

  // --- Indices ---
  const discFaces = discRings * radialSegments * 2;
  const skirtFaces = skirtRings * radialSegments * 2;
  const indices = new Uint32Array((discFaces + skirtFaces) * 3);
  let ii = 0;

  // Disc faces
  for (let ring = 0; ring < discRings; ring++) {
    for (let seg = 0; seg < radialSegments; seg++) {
      const a = ring * stride + seg;
      const b = a + stride;
      indices[ii++] = a;
      indices[ii++] = b;
      indices[ii++] = a + 1;
      indices[ii++] = a + 1;
      indices[ii++] = b;
      indices[ii++] = b + 1;
    }
  }

  // Skirt faces: connect disc outer ring to first skirt ring, then skirt rings together
  for (let ring = 0; ring < skirtRings; ring++) {
    for (let seg = 0; seg < radialSegments; seg++) {
      let topIdx: number;
      let botIdx: number;

      if (ring === 0) {
        // Top row: disc outer ring
        topIdx = discRings * stride + seg;
        // Bottom row: first skirt ring
        botIdx = discVertCount + seg;
      } else {
        topIdx = discVertCount + (ring - 1) * stride + seg;
        botIdx = discVertCount + ring * stride + seg;
      }

      indices[ii++] = topIdx;
      indices[ii++] = botIdx;
      indices[ii++] = topIdx + 1;
      indices[ii++] = topIdx + 1;
      indices[ii++] = botIdx;
      indices[ii++] = botIdx + 1;
    }
  }

  return { positions, normals, uvs, indices };
}

// ---------------------------------------------------------------------------
// Rectangular cloth — flat top + hanging skirt with folds
// ---------------------------------------------------------------------------

/**
 * Compute geometry for a rectangular trestle table cloth.
 * Flat on top, vertical skirt on all four sides with fabric folds.
 *
 * @param tableWidth   - Table width (render-space, X axis)
 * @param tableDepth   - Table depth (render-space, Z axis)
 * @param tableHeight  - Table height (Y, real-world)
 * @param segmentsX    - Subdivisions along width (default 16)
 * @param segmentsZ    - Subdivisions along depth (default 16)
 * @param skirtRings   - Vertical rings on hanging sides (default 16)
 * @param foldDepth    - Pleat fold depth (render-space, default 0.04)
 */
export function computeRectClothGeometry(
  tableWidth: number,
  tableDepth: number,
  tableHeight: number,
  segmentsX: number = 16,
  segmentsZ: number = 16,
  skirtRings: number = 16,
  foldDepth: number = 0.04,
): ClothGeometryResult {
  const halfW = tableWidth / 2 + OVERHANG;
  const halfD = tableDepth / 2 + OVERHANG;
  const clothWidth = tableWidth + OVERHANG * 2;
  const clothDepth = tableDepth + OVERHANG * 2;

  // Top: grid of vertices
  const topVerts = (segmentsX + 1) * (segmentsZ + 1);

  // Skirt: perimeter loop × skirtRings
  // Perimeter segments: 2*(segmentsX + segmentsZ)
  const perimSegs = 2 * (segmentsX + segmentsZ);
  const skirtVerts = (perimSegs + 1) * skirtRings; // +1 for wrap seam

  const totalVerts = topVerts + skirtVerts;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  let vi = 0;
  let ni = 0;
  let ui = 0;

  // --- Part 1: Flat top (overhangs table edge to hide rim) ---
  for (let iz = 0; iz <= segmentsZ; iz++) {
    const fz = iz / segmentsZ;
    const z = (fz - 0.5) * clothDepth;
    for (let ix = 0; ix <= segmentsX; ix++) {
      const fx = ix / segmentsX;
      const x = (fx - 0.5) * clothWidth;

      positions[vi++] = x;
      positions[vi++] = tableHeight + CLOTH_OFFSET;
      positions[vi++] = z;

      normals[ni++] = 0;
      normals[ni++] = 1;
      normals[ni++] = 0;

      uvs[ui++] = fx;
      uvs[ui++] = fz;
    }
  }

  // --- Part 2: Skirt around perimeter ---
  // Walk the perimeter: front (+Z), right (+X), back (-Z), left (-X)
  const perimPoints = computePerimeterPoints(halfW, halfD, segmentsX, segmentsZ);

  for (let ring = 1; ring <= skirtRings; ring++) {
    const t = ring / skirtRings;
    const y = tableHeight * (1 - t);
    const amp = foldDepth * smoothstep(t, 0.05, 0.6);
    const flare = BOTTOM_FLARE * smoothstep(t, 0.7, 1.0);

    for (let pi = 0; pi <= perimSegs; pi++) {
      const pp = perimPoints[pi % perimSegs];
      if (pp === undefined) continue;

      const fold = computeFoldDisplacement(pp.perimFrac * Math.PI * 2, amp);
      const outward = fold + flare;

      positions[vi++] = pp.x + pp.nx * outward;
      positions[vi++] = y;
      positions[vi++] = pp.z + pp.nz * outward;

      normals[ni++] = pp.nx;
      normals[ni++] = 0;
      normals[ni++] = pp.nz;

      uvs[ui++] = pp.perimFrac;
      uvs[ui++] = 0.5 + t * 0.5;
    }
  }

  // --- Indices ---
  // Top grid
  const topFaces = segmentsX * segmentsZ * 2;
  const topStride = segmentsX + 1;
  // Skirt: connect perimeter edge to skirt, then skirt rows
  const skirtFaces = perimSegs * skirtRings * 2;

  const indices = new Uint32Array((topFaces + skirtFaces) * 3);
  let ii = 0;

  // Top grid faces
  for (let iz = 0; iz < segmentsZ; iz++) {
    for (let ix = 0; ix < segmentsX; ix++) {
      const a = iz * topStride + ix;
      const b = a + topStride;
      indices[ii++] = a;
      indices[ii++] = b;
      indices[ii++] = a + 1;
      indices[ii++] = a + 1;
      indices[ii++] = b;
      indices[ii++] = b + 1;
    }
  }

  // Skirt faces: connect top perimeter edge to first skirt ring
  // We need to find the top-grid indices along the perimeter
  const perimTopIndices = computePerimeterTopIndices(segmentsX, segmentsZ);
  const skirtStride = perimSegs + 1;

  for (let ring = 0; ring < skirtRings; ring++) {
    for (let pi = 0; pi < perimSegs; pi++) {
      let topIdx: number;
      let botIdx: number;

      if (ring === 0) {
        topIdx = perimTopIndices[pi] ?? 0;
        botIdx = topVerts + pi;
      } else {
        topIdx = topVerts + (ring - 1) * skirtStride + pi;
        botIdx = topVerts + ring * skirtStride + pi;
      }

      const topNext = ring === 0
        ? (perimTopIndices[(pi + 1) % perimSegs] ?? 0)
        : topIdx + 1;
      const botNext = botIdx + 1;

      indices[ii++] = topIdx;
      indices[ii++] = botIdx;
      indices[ii++] = topNext;
      indices[ii++] = topNext;
      indices[ii++] = botIdx;
      indices[ii++] = botNext;
    }
  }

  return { positions, normals, uvs, indices };
}

// ---------------------------------------------------------------------------
// Fold computation — shared by round and rectangular
// ---------------------------------------------------------------------------

/**
 * Compute fold displacement at angle theta with given amplitude.
 * Uses primary + secondary frequencies for natural-looking pleats.
 */
export function computeFoldDisplacement(theta: number, amplitude: number): number {
  const primary = Math.sin(theta * NUM_FOLDS);
  const secondary = Math.sin(theta * NUM_FOLDS * FOLD_SECONDARY_FREQ + FOLD_SECONDARY_PHASE);
  return (primary * 0.7 + secondary * 0.3) * amplitude;
}

/**
 * Derivative of fold displacement w.r.t. theta (for normal computation).
 */
export function computeFoldDerivative(theta: number, amplitude: number): number {
  const dp = Math.cos(theta * NUM_FOLDS) * NUM_FOLDS;
  const ds = Math.cos(theta * NUM_FOLDS * FOLD_SECONDARY_FREQ + FOLD_SECONDARY_PHASE) * NUM_FOLDS * FOLD_SECONDARY_FREQ;
  return (dp * 0.7 + ds * 0.3) * amplitude;
}

// ---------------------------------------------------------------------------
// Smoothstep helper
// ---------------------------------------------------------------------------

/** Smoothstep interpolation from edge0 to edge1. */
export function smoothstep(x: number, edge0: number, edge1: number): number {
  if (edge0 === edge1) return x >= edge0 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Rectangular perimeter helpers
// ---------------------------------------------------------------------------

interface PerimPoint {
  readonly x: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  readonly perimFrac: number;
}

function computePerimeterPoints(
  halfW: number,
  halfD: number,
  segX: number,
  segZ: number,
): readonly PerimPoint[] {
  const points: PerimPoint[] = [];
  const totalSegs = 2 * (segX + segZ);

  // Front edge: z = +halfD, x goes from -halfW to +halfW
  for (let i = 0; i < segX; i++) {
    const fx = i / segX;
    points.push({ x: (fx - 0.5) * halfW * 2, z: halfD, nx: 0, nz: 1, perimFrac: points.length / totalSegs });
  }
  // Right edge: x = +halfW, z goes from +halfD to -halfD
  for (let i = 0; i < segZ; i++) {
    const fz = i / segZ;
    points.push({ x: halfW, z: halfD - fz * halfD * 2, nx: 1, nz: 0, perimFrac: points.length / totalSegs });
  }
  // Back edge: z = -halfD, x goes from +halfW to -halfW
  for (let i = 0; i < segX; i++) {
    const fx = i / segX;
    points.push({ x: halfW - fx * halfW * 2, z: -halfD, nx: 0, nz: -1, perimFrac: points.length / totalSegs });
  }
  // Left edge: x = -halfW, z goes from -halfD to +halfD
  for (let i = 0; i < segZ; i++) {
    const fz = i / segZ;
    points.push({ x: -halfW, z: -halfD + fz * halfD * 2, nx: -1, nz: 0, perimFrac: points.length / totalSegs });
  }

  return points;
}

/**
 * Returns top-grid vertex indices along the perimeter in the same order
 * as computePerimeterPoints walks the edge.
 */
function computePerimeterTopIndices(segX: number, segZ: number): readonly number[] {
  const stride = segX + 1;
  const indices: number[] = [];

  // Front edge (last row, z = segZ): left to right
  for (let ix = 0; ix < segX; ix++) {
    indices.push(segZ * stride + ix);
  }
  // Right edge (last col, x = segX): top to bottom (z goes from segZ to 0)
  for (let iz = 0; iz < segZ; iz++) {
    indices.push((segZ - iz) * stride + segX);
  }
  // Back edge (first row, z = 0): right to left
  for (let ix = 0; ix < segX; ix++) {
    indices.push(0 * stride + (segX - ix));
  }
  // Left edge (first col, x = 0): bottom to top (z goes from 0 to segZ)
  for (let iz = 0; iz < segZ; iz++) {
    indices.push(iz * stride + 0);
  }

  return indices;
}

// ---------------------------------------------------------------------------
// Shared types & constants
// ---------------------------------------------------------------------------

export interface ClothGeometryResult {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

/** Cloth colour — black fabric. */
export const CLOTH_COLOR = "#1a1a1a";

/** Number of folds (exported for testing). */
export const FOLD_COUNT = NUM_FOLDS;

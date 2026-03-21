import type { FloorPlanPoint } from "../space.js";

// ---------------------------------------------------------------------------
// Geometry — pure 2D geometry utilities for the layout solver
// ---------------------------------------------------------------------------

/**
 * Tests if a point is inside a polygon using the ray-casting algorithm.
 * The polygon is defined by an array of points forming a closed loop.
 * Points exactly on an edge may return either true or false (boundary case).
 */
export function pointInPolygon(point: FloorPlanPoint, polygon: readonly FloorPlanPoint[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (pi === undefined || pj === undefined) continue;

    const yi = pi.y;
    const yj = pj.y;
    const xi = pi.x;
    const xj = pj.x;

    if ((yi > point.y) !== (yj > point.y)) {
      const intersectX = xj + ((point.y - yj) / (yi - yj)) * (xi - xj);
      if (point.x < intersectX) {
        inside = !inside;
      }
    }
  }

  return inside;
}

/**
 * Computes the minimum distance from a point to the nearest edge of a polygon.
 * Each edge is a line segment between consecutive polygon vertices.
 */
export function distanceToEdge(point: FloorPlanPoint, polygon: readonly FloorPlanPoint[]): number {
  const n = polygon.length;
  if (n < 2) return Infinity;

  let minDist = Infinity;

  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (a === undefined || b === undefined) continue;

    const dist = pointToSegmentDistance(point, a, b);
    if (dist < minDist) {
      minDist = dist;
    }
  }

  return minDist;
}

/**
 * Computes the distance from a point to a line segment.
 */
function pointToSegmentDistance(
  p: FloorPlanPoint,
  a: FloorPlanPoint,
  b: FloorPlanPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // a and b are the same point
    return distanceToPoint(p, a);
  }

  // Project point onto the line, clamped to segment
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projection: FloorPlanPoint = {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };

  return distanceToPoint(p, projection);
}

/**
 * Euclidean distance between two 2D points.
 */
export function distanceToPoint(a: FloorPlanPoint, b: FloorPlanPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Tests if an entire circle fits inside a polygon.
 * The circle center must be inside the polygon, and the distance from the
 * center to the nearest edge must be >= radius.
 */
export function circleInPolygon(
  center: FloorPlanPoint,
  radius: number,
  polygon: readonly FloorPlanPoint[],
): boolean {
  if (!pointInPolygon(center, polygon)) return false;
  return distanceToEdge(center, polygon) >= radius;
}

/**
 * Tests if an axis-aligned (then rotated) rectangle fits inside a polygon.
 * Checks all four corners of the rotated rectangle.
 *
 * @param center   - Center of the rectangle.
 * @param width    - Width along the local X axis.
 * @param depth    - Depth along the local Y axis.
 * @param rotation - Rotation in radians (counter-clockwise).
 * @param polygon  - The enclosing polygon.
 */
export function rectInPolygon(
  center: FloorPlanPoint,
  width: number,
  depth: number,
  rotation: number,
  polygon: readonly FloorPlanPoint[],
): boolean {
  const corners = getRectCorners(center, width, depth, rotation);
  return corners.every((c) => pointInPolygon(c, polygon));
}

/**
 * Computes the four corners of a rotated rectangle.
 */
function getRectCorners(
  center: FloorPlanPoint,
  width: number,
  depth: number,
  rotation: number,
): readonly FloorPlanPoint[] {
  const hw = width / 2;
  const hd = depth / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const offsets: readonly [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];

  return offsets.map(([ox, oy]) => ({
    x: center.x + ox * cos - oy * sin,
    y: center.y + ox * sin + oy * cos,
  }));
}

/**
 * Tests if a line segment intersects an axis-aligned-then-rotated rectangle.
 * Uses separating axis theorem on the rectangle's two axes.
 */
export function lineIntersectsRect(
  lineStart: FloorPlanPoint,
  lineEnd: FloorPlanPoint,
  rectCenter: FloorPlanPoint,
  rectWidth: number,
  rectDepth: number,
  rectRotation: number,
): boolean {
  // Transform line into rectangle's local space (unrotated, centered at origin)
  const cos = Math.cos(-rectRotation);
  const sin = Math.sin(-rectRotation);

  const localStart = transformPoint(lineStart, rectCenter, cos, sin);
  const localEnd = transformPoint(lineEnd, rectCenter, cos, sin);

  // Now test line segment against axis-aligned rect centered at origin
  const hw = rectWidth / 2;
  const hd = rectDepth / 2;

  return lineSegmentIntersectsAABB(localStart, localEnd, -hw, -hd, hw, hd);
}

function transformPoint(
  p: FloorPlanPoint,
  center: FloorPlanPoint,
  cos: number,
  sin: number,
): FloorPlanPoint {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

/**
 * Tests if a line segment intersects an axis-aligned bounding box.
 * Uses the Liang–Barsky algorithm.
 */
function lineSegmentIntersectsAABB(
  start: FloorPlanPoint,
  end: FloorPlanPoint,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const edges: readonly [number, number][] = [
    [-dx, start.x - xMin],
    [dx, xMax - start.x],
    [-dy, start.y - yMin],
    [dy, yMax - start.y],
  ];

  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      // Parallel to edge
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        t0 = Math.max(t0, r);
      } else {
        t1 = Math.min(t1, r);
      }
      if (t0 > t1) return false;
    }
  }

  return true;
}

/**
 * Generates a grid of evenly spaced points inside a polygon.
 * Useful for placing tables at regular intervals.
 *
 * @param polygon  - The enclosing polygon.
 * @param spacingX - Horizontal spacing between grid points.
 * @param spacingY - Vertical spacing between grid points.
 * @returns Array of grid points that fall inside the polygon.
 */
export function generateGridPoints(
  polygon: readonly FloorPlanPoint[],
  spacingX: number,
  spacingY: number,
): FloorPlanPoint[] {
  if (polygon.length < 3 || spacingX <= 0 || spacingY <= 0) return [];

  // Find bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // Generate grid, offset by half-spacing to center within the polygon
  const startX = minX + spacingX / 2;
  const startY = minY + spacingY / 2;
  const points: FloorPlanPoint[] = [];

  for (let x = startX; x < maxX; x += spacingX) {
    for (let y = startY; y < maxY; y += spacingY) {
      const candidate = { x, y };
      if (pointInPolygon(candidate, polygon)) {
        points.push(candidate);
      }
    }
  }

  return points;
}

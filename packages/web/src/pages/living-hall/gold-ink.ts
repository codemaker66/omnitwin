// -----------------------------------------------------------------------------
// gold-ink — the drafting pen's stroke paths, as pure data.
//
// The Dressing's first table (docs/superpowers/specs/2026-07-10-dressing-
// storyboard.md) is authored here as an ordered list of polyline strokes in
// world metres. The pen replays them at constant speed: progress is mapped
// through cumulative stroke length, so scroll — the only clock — moves the
// nib evenly whether it is rounding a plate or running a drape line.
// Everything is a plain number tuple: no three.js import, fully testable.
// -----------------------------------------------------------------------------

export type InkPoint = readonly [number, number, number];

export interface InkStroke {
  /** Polyline points in draw order; consecutive points become segments. */
  readonly points: readonly InkPoint[];
  /** Which storyboard beat this stroke belongs to (for tests/tuning). */
  readonly beat: "cloth" | "settings" | "centre" | "company";
}

export interface FirstTableConfig {
  readonly centre: InkPoint;
  readonly tabletopY: number;
  readonly hemY: number;
  readonly floorY: number;
  readonly radius: number;
  readonly covers: number;
}

/** Storyboard placement: mid-room on station 3's gaze line; floor at −1.6
 *  (capture height above floor), 0.75m table, 0.9m radius, eight covers. */
export const FIRST_TABLE: FirstTableConfig = {
  centre: [-2.0, 0, 7.5],
  tabletopY: -0.85,
  hemY: -1.55,
  floorY: -1.6,
  radius: 0.9,
  covers: 8,
};

export const INK_GOLD = 0xc9a86a;
export const INK_GOLD_BRIGHT = 0xe6c684;
/** The act's dead zones per the storyboard: pen starts at 10%, settles at 95%. */
export const INK_WINDOW = { start: 0.1, end: 0.95 } as const;

function circleStroke(
  cx: number,
  y: number,
  cz: number,
  radius: number,
  beat: InkStroke["beat"],
  segments = 48,
  startAngle = 0,
): InkStroke {
  const points: InkPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + (i / segments) * Math.PI * 2;
    points.push([cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius]);
  }
  return { points, beat };
}

function lineStroke(a: InkPoint, b: InkPoint, beat: InkStroke["beat"]): InkStroke {
  return { points: [a, b], beat };
}

function rect(
  corners: readonly [InkPoint, InkPoint, InkPoint, InkPoint],
  beat: InkStroke["beat"],
): InkStroke {
  const [p0, p1, p2, p3] = corners;
  return { points: [p0, p1, p2, p3, p0], beat };
}

/** One chair as six strokes: seat outline, backrest outline, four legs.
 *  Local frame faces the table centre; `angle` positions it on the ring. */
function chairStrokes(cfg: FirstTableConfig, angle: number): InkStroke[] {
  const ringRadius = cfg.radius + 0.38;
  const cx = cfg.centre[0] + Math.cos(angle) * ringRadius;
  const cz = cfg.centre[2] + Math.sin(angle) * ringRadius;
  const seatY = cfg.floorY + 0.46;
  const backTopY = cfg.floorY + 0.95;
  const half = 0.21;
  // Local axes: `in` points toward the table, `side` is perpendicular.
  const inX = -Math.cos(angle);
  const inZ = -Math.sin(angle);
  const sideX = -inZ;
  const sideZ = inX;
  const corner = (s: number, f: number, y: number): InkPoint => [
    cx + sideX * half * s + inX * half * f,
    y,
    cz + sideZ * half * s + inZ * half * f,
  ];
  return [
    rect([corner(-1, -1, seatY), corner(1, -1, seatY), corner(1, 1, seatY), corner(-1, 1, seatY)], "company"),
    // Backrest rises from the seat's outer edge.
    rect(
      [corner(-1, -1, seatY), corner(-1, -1, backTopY), corner(1, -1, backTopY), corner(1, -1, seatY)],
      "company",
    ),
    lineStroke(corner(-1, -1, seatY), corner(-1, -1, cfg.floorY), "company"),
    lineStroke(corner(1, -1, seatY), corner(1, -1, cfg.floorY), "company"),
    lineStroke(corner(-1, 1, seatY), corner(-1, 1, cfg.floorY), "company"),
    lineStroke(corner(1, 1, seatY), corner(1, 1, cfg.floorY), "company"),
  ];
}

/** The full stroke sequence in storyboard order: cloth → settings → centre →
 *  company. Chairs alternate across the table (0,4,2,6,1,5,3,7) so the
 *  composition stays balanced while it fills. */
export function buildFirstTableStrokes(cfg: FirstTableConfig = FIRST_TABLE): readonly InkStroke[] {
  const strokes: InkStroke[] = [];
  const [cx, , cz] = cfg.centre;

  // — the cloth: rim, hem, ten drape lines —
  strokes.push(circleStroke(cx, cfg.tabletopY, cz, cfg.radius, "cloth", 64));
  strokes.push(circleStroke(cx, cfg.hemY, cz, cfg.radius, "cloth", 64));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    strokes.push(
      lineStroke(
        [cx + Math.cos(a) * cfg.radius, cfg.tabletopY, cz + Math.sin(a) * cfg.radius],
        [cx + Math.cos(a) * cfg.radius, cfg.hemY, cz + Math.sin(a) * cfg.radius],
        "cloth",
      ),
    );
  }

  // — the settings: a plate then its glass, cover by cover, clockwise —
  const plateRing = cfg.radius - 0.28;
  const glassRing = cfg.radius - 0.42;
  for (let i = 0; i < cfg.covers; i++) {
    const a = (i / cfg.covers) * Math.PI * 2;
    const px = cx + Math.cos(a) * plateRing;
    const pz = cz + Math.sin(a) * plateRing;
    strokes.push(circleStroke(px, cfg.tabletopY + 0.005, pz, 0.14, "settings", 32));
    const ga = a + 0.28;
    strokes.push(
      circleStroke(cx + Math.cos(ga) * glassRing, cfg.tabletopY + 0.01, cz + Math.sin(ga) * glassRing, 0.04, "settings", 16),
    );
  }

  // — the centre: floral ring, candle stem, flame ring —
  strokes.push(circleStroke(cx, cfg.tabletopY + 0.02, cz, 0.24, "centre", 40));
  strokes.push(lineStroke([cx, cfg.tabletopY, cz], [cx, cfg.tabletopY + 0.32, cz], "centre"));
  strokes.push(circleStroke(cx, cfg.tabletopY + 0.34, cz, 0.015, "centre", 10));

  // — the company: eight chairs, alternating across the table —
  const order = [0, 4, 2, 6, 1, 5, 3, 7];
  for (const seat of order) {
    const a = (seat / cfg.covers) * Math.PI * 2;
    strokes.push(...chairStrokes(cfg, a));
  }

  return strokes;
}

export interface InkGeometry {
  /** Segment endpoints, flattened xyz pairs, in draw order. */
  readonly positions: Float32Array;
  /** Cumulative length at the end of each segment (metres). */
  readonly cumulativeLengths: readonly number[];
  readonly totalLength: number;
  readonly segmentCount: number;
}

export function strokesToInkGeometry(strokes: readonly InkStroke[]): InkGeometry {
  const positions: number[] = [];
  const cumulativeLengths: number[] = [];
  let total = 0;
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1];
      const b = stroke.points[i];
      if (a === undefined || b === undefined) continue;
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      cumulativeLengths.push(total);
    }
  }
  return {
    positions: new Float32Array(positions),
    cumulativeLengths,
    totalLength: total,
    segmentCount: cumulativeLengths.length,
  };
}

/** Act progress → number of fully-drawn segments, length-weighted (constant
 *  pen speed) inside the storyboard window. */
export function drawnSegments(geometry: InkGeometry, actProgress: number): number {
  const w = (actProgress - INK_WINDOW.start) / (INK_WINDOW.end - INK_WINDOW.start);
  const inked = Math.min(1, Math.max(0, w)) * geometry.totalLength;
  if (inked <= 0) return 0;
  if (inked >= geometry.totalLength) return geometry.segmentCount;
  // First segment whose cumulative length exceeds the inked length.
  let lo = 0;
  let hi = geometry.segmentCount - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((geometry.cumulativeLengths[mid] ?? Infinity) < inked) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The pen nib's position: the end point of the last drawn segment. */
export function penHead(geometry: InkGeometry, segments: number): InkPoint | null {
  if (segments <= 0 || segments > geometry.segmentCount) return null;
  const i = (segments - 1) * 6;
  const x = geometry.positions[i + 3];
  const y = geometry.positions[i + 4];
  const z = geometry.positions[i + 5];
  if (x === undefined || y === undefined || z === undefined) return null;
  return [x, y, z];
}

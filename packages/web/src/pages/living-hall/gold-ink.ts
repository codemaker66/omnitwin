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

// ————————————————————————————————————————————————————————————————————————————
// Beat two — the event-type programs and the floor fill.
//
// The first table is drawn lovingly, in full; the fill that follows is the
// draftsman's quicker hand (rim, four drapes, a plate ring, seat squares).
// Seat ceilings come exclusively from trades-hall-venue-truth — the tick can
// never contradict the venue's published numbers because it has no numbers
// of its own.
// ————————————————————————————————————————————————————————————————————————————

export type DressingEventType = "wedding" | "dinner" | "conference";

export interface InkElement {
  /** Seats this element contributes when the pen completes it. */
  readonly seats: number;
  /** Index of the element's last stroke in the program's stroke list. */
  readonly lastStrokeIndex: number;
}

export interface DressingProgram {
  readonly eventType: DressingEventType;
  readonly strokes: readonly InkStroke[];
  readonly elements: readonly InkElement[];
  readonly totalSeats: number;
  /** Venue-truth ceiling for this format, and its published format name. */
  readonly seatCeiling: number;
  readonly ceilingFormat: "dinner" | "theatre";
}

/** A round of eight in the pen's shorthand: rim, four drapes, plate ring,
 *  eight seat squares. */
function shorthandRound(cfg: FirstTableConfig, cx: number, cz: number): InkStroke[] {
  const strokes: InkStroke[] = [];
  strokes.push(circleStroke(cx, cfg.tabletopY, cz, cfg.radius, "company", 32));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    strokes.push(
      lineStroke(
        [cx + Math.cos(a) * cfg.radius, cfg.tabletopY, cz + Math.sin(a) * cfg.radius],
        [cx + Math.cos(a) * cfg.radius, cfg.hemY, cz + Math.sin(a) * cfg.radius],
        "company",
      ),
    );
  }
  strokes.push(circleStroke(cx, cfg.tabletopY + 0.005, cz, cfg.radius - 0.28, "company", 24));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const sx = cx + Math.cos(a) * (cfg.radius + 0.38);
    const sz = cz + Math.sin(a) * (cfg.radius + 0.38);
    const h = 0.19;
    const seatY = cfg.floorY + 0.46;
    strokes.push(
      rect(
        [
          [sx - h, seatY, sz - h],
          [sx + h, seatY, sz - h],
          [sx + h, seatY, sz + h],
          [sx - h, seatY, sz + h],
        ],
        "company",
      ),
    );
  }
  return strokes;
}

/** A seat square + back line — the shorthand chair for banquets and rows. */
function shorthandChair(cx: number, cz: number, facing: number, floorY: number): InkStroke[] {
  const h = 0.19;
  const seatY = floorY + 0.46;
  const backY = floorY + 0.9;
  // Back edge sits opposite the facing direction.
  const bx = cx - Math.cos(facing) * h;
  const bz = cz - Math.sin(facing) * h;
  const sideX = -Math.sin(facing);
  const sideZ = Math.cos(facing);
  return [
    rect(
      [
        [cx - sideX * h - Math.cos(facing) * h, seatY, cz - sideZ * h - Math.sin(facing) * h],
        [cx + sideX * h - Math.cos(facing) * h, seatY, cz + sideZ * h - Math.sin(facing) * h],
        [cx + sideX * h + Math.cos(facing) * h, seatY, cz + sideZ * h + Math.sin(facing) * h],
        [cx - sideX * h + Math.cos(facing) * h, seatY, cz - sideZ * h + Math.sin(facing) * h],
      ],
      "company",
    ),
    {
      points: [
        [bx - sideX * h, seatY, bz - sideZ * h],
        [bx - sideX * h, backY, bz - sideZ * h],
        [bx + sideX * h, backY, bz + sideZ * h],
        [bx + sideX * h, seatY, bz + sideZ * h],
      ],
      beat: "company",
    },
  ];
}

/** Positions for the six shorthand rounds around the first table. */
const WEDDING_ROUND_CENTRES: readonly (readonly [number, number])[] = [
  [-4.6, 5.2],
  [0.6, 5.2],
  [-4.6, 9.5],
  [0.6, 9.5],
  [-2.0, 10.6],
  [-2.0, 4.2],
];

function weddingProgram(cfg: FirstTableConfig): { strokes: InkStroke[]; elements: InkElement[] } {
  const strokes: InkStroke[] = [...buildFirstTableStrokes(cfg)];
  const elements: InkElement[] = [{ seats: cfg.covers, lastStrokeIndex: strokes.length - 1 }];
  for (const [cx, cz] of WEDDING_ROUND_CENTRES) {
    strokes.push(...shorthandRound(cfg, cx, cz));
    elements.push({ seats: 8, lastStrokeIndex: strokes.length - 1 });
  }
  return { strokes, elements };
}

function dinnerProgram(cfg: FirstTableConfig): { strokes: InkStroke[]; elements: InkElement[] } {
  const strokes: InkStroke[] = [];
  const elements: InkElement[] = [];
  const runs: readonly (readonly [number, number])[] = [
    [-4.3, 0], // banquet centre x
    [0.9, 0],
  ];
  const z0 = 2.6;
  const z1 = 10.6;
  const halfW = 0.5;
  for (const [bx] of runs) {
    // Tabletop and hem outlines, then four corner drapes.
    for (const y of [cfg.tabletopY, cfg.hemY]) {
      strokes.push(
        rect(
          [
            [bx - halfW, y, z0],
            [bx + halfW, y, z0],
            [bx + halfW, y, z1],
            [bx - halfW, y, z1],
          ],
          "company",
        ),
      );
    }
    for (const [dx, dz] of [
      [-halfW, z0],
      [halfW, z0],
      [-halfW, z1],
      [halfW, z1],
    ] as const) {
      strokes.push(lineStroke([bx + dx, cfg.tabletopY, dz], [bx + dx, cfg.hemY, dz], "company"));
    }
    elements.push({ seats: 0, lastStrokeIndex: strokes.length - 1 });
    // 15 chairs a side, facing the table.
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 15; i++) {
        const cz = z0 + 0.35 + (i * (z1 - z0 - 0.7)) / 14;
        const cx = bx + side * (halfW + 0.32);
        strokes.push(...shorthandChair(cx, cz, side > 0 ? Math.PI : 0, cfg.floorY));
        elements.push({ seats: 1, lastStrokeIndex: strokes.length - 1 });
      }
    }
  }
  return { strokes, elements };
}

function conferenceProgram(cfg: FirstTableConfig): { strokes: InkStroke[]; elements: InkElement[] } {
  const strokes: InkStroke[] = [];
  const elements: InkElement[] = [];
  // Eight rows of ten, facing the window wall (+z).
  for (let row = 0; row < 8; row++) {
    const cz = 3.0 + row * 0.95;
    for (let i = 0; i < 10; i++) {
      const cx = -4.75 + i * 0.85;
      strokes.push(...shorthandChair(cx, cz, Math.PI / 2, cfg.floorY));
      elements.push({ seats: 1, lastStrokeIndex: strokes.length - 1 });
    }
  }
  return { strokes, elements };
}

export function buildDressingProgram(
  eventType: DressingEventType,
  capacities: { readonly dinner: number; readonly theatre: number },
  cfg: FirstTableConfig = FIRST_TABLE,
): DressingProgram {
  const built =
    eventType === "wedding"
      ? weddingProgram(cfg)
      : eventType === "dinner"
        ? dinnerProgram(cfg)
        : conferenceProgram(cfg);
  const totalSeats = built.elements.reduce((n, e) => n + e.seats, 0);
  const ceilingFormat = eventType === "conference" ? "theatre" : "dinner";
  return {
    eventType,
    strokes: built.strokes,
    elements: built.elements,
    totalSeats,
    seatCeiling: ceilingFormat === "theatre" ? capacities.theatre : capacities.dinner,
    ceilingFormat,
  };
}

/** Per-element last-SEGMENT indices for a program's stroke list — segment
 *  ordering matches strokesToInkGeometry. */
export function elementSegmentEnds(program: DressingProgram): readonly number[] {
  const segmentsPerStroke = program.strokes.map((s) => s.points.length - 1);
  const ends: number[] = [];
  for (const element of program.elements) {
    let count = 0;
    for (let i = 0; i <= element.lastStrokeIndex; i++) count += segmentsPerStroke[i] ?? 0;
    ends.push(count);
  }
  return ends;
}

/** Seats completed once `segments` segments are drawn. */
export function seatsAtSegments(
  program: DressingProgram,
  segmentEnds: readonly number[],
  segments: number,
): number {
  let seats = 0;
  for (let i = 0; i < program.elements.length; i++) {
    if ((segmentEnds[i] ?? Infinity) <= segments) seats += program.elements[i]?.seats ?? 0;
  }
  return seats;
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

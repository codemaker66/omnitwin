// ---------------------------------------------------------------------------
// The Grand Hall, Trades Hall of Glasgow — measured specification
//
// One typed description of the room that the real-time model, its light bake
// and the planner's cameras all read. Every dimension here is measured from
// the hall's own laser scan, not from photographs of events in it:
//
//   - The Matterport E57 capture of 11 July 2026 (149 Pro3 sweeps; sweeps
//     0–48 are the Grand Hall), as published for the twin viewer at
//     twin.venviewer.com/trades-hall: the station poses in manifest.json, the
//     reviewed dollhouse mesh (mesh/dollhouse.glb, E57 frame, Z up) and the
//     world-aligned 8K equirectangular panorama from every station.
//   - Plan and section cuts through the mesh, orthographic depth renders of
//     each wall and of the ceiling, and the panoramas projected onto those
//     surfaces. tools/grand-hall-survey/README.md records the method and
//     reproduces every number below.
//
// Frame: metres, the planner's render frame (RENDER_SCALE = 1). The origin is
// the centre of the hall's floor; y is up; x runs the length from the
// fireplace wall (x < 0) to the opposite end wall (x > 0); z runs the width
// from the window wall (z < 0) to the door wall (z > 0). Facing the
// fireplace, the windows are on the right. From the scan's E57 frame:
//   x = 8.795 − X,  y = Z − 0.045,  z = Y + 4.963.
//
// Accuracy: wall planes and opening edges to about ±2 cm (mesh tier
// "ops-grade-2cm"). Everything fixed to the walls comes from the scan's relief
// directly (hall-relief.ts), not from this file. The venue's published plan
// (21 m × 10.5 m) is the planning record; the scan measures the panelled
// interior at 21.14 m × 10.59 m.
// ---------------------------------------------------------------------------

export const HALL_LENGTH = 21.135;
export const HALL_WIDTH = 10.59;
/** Underside of the coffered ceiling. */
export const HALL_HEIGHT = 6.7;
export const HALL_HALF_LENGTH = HALL_LENGTH / 2;
export const HALL_HALF_WIDTH = HALL_WIDTH / 2;

/** The scan frame this specification was measured in. */
export const HALL_SURVEY = {
  /** E57 (X, Y) of the planner origin: the centre of the interior. */
  centre: [8.795, -4.963] as const,
  /** E57 Z of the floor. */
  floor: 0.045,
} as const;

/** Planner position of a point given in the scan's E57 frame. */
export function fromSurvey(point: readonly [number, number, number]): [number, number, number] {
  return [HALL_SURVEY.centre[0] - point[0], point[2] - HALL_SURVEY.floor, point[1] - HALL_SURVEY.centre[1]];
}

/** Walls by what they hold. "end" is the wall opposite the fireplace. */
export type HallWallId = "window" | "door" | "fireplace" | "end";

/**
 * A wall as seen from inside the room: `u` runs left to right along the wall
 * from `origin`, `v` is height above the floor, and `normal` points into the
 * room. World position = origin + tangent·u + up·v + normal·depth.
 */
export interface HallWall {
  readonly id: HallWallId;
  readonly length: number;
  readonly origin: readonly [number, number, number];
  readonly tangent: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
}

export const HALL_WALLS: readonly HallWall[] = [
  { id: "window", length: HALL_LENGTH, origin: [-HALL_HALF_LENGTH, 0, -HALL_HALF_WIDTH], tangent: [1, 0, 0], normal: [0, 0, 1] },
  { id: "end", length: HALL_WIDTH, origin: [HALL_HALF_LENGTH, 0, -HALL_HALF_WIDTH], tangent: [0, 0, 1], normal: [-1, 0, 0] },
  { id: "door", length: HALL_LENGTH, origin: [HALL_HALF_LENGTH, 0, HALL_HALF_WIDTH], tangent: [-1, 0, 0], normal: [0, 0, -1] },
  { id: "fireplace", length: HALL_WIDTH, origin: [-HALL_HALF_LENGTH, 0, HALL_HALF_WIDTH], tangent: [0, 0, -1], normal: [1, 0, 0] },
];

export function hallWall(id: HallWallId): HallWall {
  const wall = HALL_WALLS.find((candidate) => candidate.id === id);
  if (wall === undefined) throw new Error(`Unknown hall wall ${id}`);
  return wall;
}

/** World position of a wall-local point. `depth` is measured into the room. */
export function wallPoint(wall: HallWall, u: number, v: number, depth = 0): [number, number, number] {
  return [
    wall.origin[0] + wall.tangent[0] * u + wall.normal[0] * depth,
    v,
    wall.origin[2] + wall.tangent[2] * u + wall.normal[2] * depth,
  ];
}

/**
 * The horizontal bands of the wall elevation, bottom to top, with how far
 * each stands proud of (+) or behind (−) the plaster face.
 */
export const HALL_ELEVATION = {
  skirtingTop: 0.16,
  /** Top of the mahogany dado's cap rail. */
  dadoTop: 1.95,
  /** Underside of the cap rail. */
  dadoRail: 1.86,
  /** The moulded ledge under the frieze that hides its LED uplights. */
  ledgeBottom: 4.05,
  friezeBottom: 4.25,
  friezeTop: 5.47,
  /** The band above the frieze lettered with the trades' names. */
  inscriptionTop: 5.63,
  /** Top of the cornice under the attic panelling. */
  corniceTop: 5.75,
  ceiling: HALL_HEIGHT,
  dadoProud: 0.018,
  ledgeProud: 0.06,
  friezeSet: -0.025,
  corniceProud: 0.05,
  atticSet: -0.012,
} as const;

export type HallOpeningKind = "arched-window" | "window" | "door";

export interface HallOpening {
  readonly id: string;
  readonly kind: HallOpeningKind;
  readonly wall: HallWallId;
  /** Centre of the opening along the wall (wall-local u). */
  readonly centre: number;
  /** Clear width at the wall face. */
  readonly width: number;
  /** Bottom of the clear opening. */
  readonly sill: number;
  /**
   * Head of a square opening, or where an arched window's semicircular head
   * springs (its radius is half its width).
   */
  readonly head: number;
}

/** Window-wall u of a scan X; door-wall u of a scan X. */
const windowU = (scanX: number): number => HALL_HALF_LENGTH + HALL_SURVEY.centre[0] - scanX;
const doorU = (scanX: number): number => HALL_HALF_LENGTH - HALL_SURVEY.centre[0] + scanX;

export const HALL_OPENINGS: readonly HallOpening[] = [
  // Window wall: three round-headed windows (both ends and the centre) and
  // two cased sash windows between them, symmetrical about the centre line.
  { id: "arch-fireplace", kind: "arched-window", wall: "window", centre: windowU(17.83), width: 2.7, sill: 0.915, head: 3.76 },
  { id: "window-fireplace", kind: "window", wall: "window", centre: windowU(13.71), width: 1.43, sill: 0.935, head: 3.305 },
  { id: "arch-centre", kind: "arched-window", wall: "window", centre: windowU(8.82), width: 2.67, sill: 0.915, head: 3.76 },
  { id: "window-end", kind: "window", wall: "window", centre: windowU(3.93), width: 1.43, sill: 0.935, head: 3.305 },
  { id: "arch-end", kind: "arched-window", wall: "window", centre: windowU(-0.19), width: 2.7, sill: 0.915, head: 3.76 },
  // Door wall: three doorways in carved mahogany doorcases; the centre one,
  // under the clock, is the main door.
  { id: "door-end", kind: "door", wall: "door", centre: doorU(-0.025), width: 1.08, sill: 0, head: 2.35 },
  { id: "door-main", kind: "door", wall: "door", centre: doorU(8.79), width: 1.43, sill: 0, head: 2.35 },
  { id: "door-fireplace", kind: "door", wall: "door", centre: doorU(17.665), width: 1.08, sill: 0, head: 2.35 },
];

export function isWindow(opening: HallOpening): boolean {
  return opening.kind === "arched-window" || opening.kind === "window";
}

/** Top of an opening: the crown of an arch, or the square head. */
export function openingTop(opening: HallOpening): number {
  return opening.kind === "arched-window" ? opening.head + opening.width / 2 : opening.head;
}

/** The upper edge of the clear opening at wall-local `u`, or null outside it. */
export function openingHeadAt(opening: HallOpening, u: number): number | null {
  const half = opening.width / 2;
  const offset = u - opening.centre;
  if (offset < -half - 1e-9 || offset > half + 1e-9) return null;
  if (opening.kind !== "arched-window") return opening.head;
  return opening.head + Math.sqrt(Math.max(0, half * half - offset * offset));
}

/**
 * The dome over the centre: a spherical cap on a steep band that carries the
 * arms of the fourteen Incorporations, a gilt ring at its foot, and a crown
 * ring around a lowered central plate from which the great chandelier hangs.
 * Profile points are (radius, height) from the foot to the crown.
 */
export const HALL_DOME = {
  /** Radius of the gilt ring where the dome meets the ceiling. */
  footRadius: 3.32,
  /** The cap's sphere: centre height and radius. */
  sphereCentre: 5.371,
  sphereRadius: 3.67,
  /** Where the steep shield band meets the cap. */
  bandTopRadius: 2.95,
  /** Inner edge of the radial panels; the crown ring lies within it. */
  crownRadius: 1.2,
  /** The crown ring's inner edge and the lowered plate inside it. */
  plateRadius: 0.86,
  plateHeight: 8.75,
  crownHeight: 8.93,
  /** Broad radial panels between darker ribs. */
  panels: 14,
  /** The arms of the fourteen Incorporations on the band. */
  shields: 14,
  /** The hexagonal frame in the coffered ceiling around the dome. */
  frameCircumradius: 4.0,
} as const;

/** Height of the dome's inner surface at radius r (foot to crown). */
export function domeHeightAt(r: number): number {
  const d = HALL_DOME;
  if (r >= d.footRadius) return HALL_HEIGHT;
  if (r <= d.bandTopRadius) {
    const cap = d.sphereCentre + Math.sqrt(Math.max(0, d.sphereRadius * d.sphereRadius - r * r));
    return Math.min(cap, d.crownHeight);
  }
  // The band: a steep quarter-ellipse from the cap down to the foot ring.
  const top = d.sphereCentre + Math.sqrt(Math.max(0, d.sphereRadius * d.sphereRadius - d.bandTopRadius * d.bandTopRadius));
  const t = (r - d.bandTopRadius) / (d.footRadius - d.bandTopRadius);
  return HALL_HEIGHT + (top - HALL_HEIGHT) * Math.sqrt(Math.max(0, 1 - t * t));
}

/** The coffered ceiling: a lattice of flat-topped hexagonal coffers. */
export const HALL_COFFERS = {
  /** Centre spacing along a row (x). */
  pitch: 1.0235,
  /** Spacing between rows (z), a little more than regular hexagons need. */
  rowPitch: 0.894,
  /** Circumradius of a coffer's outer gilt fillet. */
  outerRadius: 0.465,
  /** Circumradius of its raised inner panel. */
  innerRadius: 0.38,
  /** Plain border between the cornice and the lattice. */
  border: 0.34,
  /** Rows run from −rows to +rows; the centre row's cells sit half a pitch off x = 0. */
  rows: 5,
} as const;

export type ChandelierStyle = "gilt-leaf" | "scroll";

export interface HallChandelier {
  readonly id: string;
  readonly style: ChandelierStyle;
  /** Centre of the light-bearing body. */
  readonly position: readonly [number, number, number];
  /** Where the suspension meets the ceiling or the dome's plate. */
  readonly suspension: number;
  /** Lowest point of the fitting. */
  readonly bottom: number;
  /** The fitting's reach from its axis: metal, leaves and bulbs. */
  readonly radius: number;
  /**
   * Radius of the bright body that stands in for the fitting's lamps in the
   * reflection environment. It sets how much light the lamps add to
   * reflections, and the moods were set with these values; it is not a
   * measurement of the fitting.
   */
  readonly glowRadius: number;
}

/** Chandelier roses: on the coffer lattice, half a pitch off its columns. */
const ROSE_X = 6.5 * HALL_COFFERS.pitch;
const ROSE_Z = 3 * HALL_COFFERS.rowPitch;

/**
 * Lowest points and reaches as measured against a metric grid in the scan's
 * panoramas (stations scan_024 and scan_029; see hall-chandeliers.ts).
 */
export const HALL_CHANDELIERS: readonly HallChandelier[] = [
  { id: "chandelier-dome", style: "gilt-leaf", position: [0, 4.75, 0], suspension: HALL_DOME.plateHeight, bottom: 3.85, radius: 0.9, glowRadius: 0.82 },
  { id: "chandelier-fireplace-window", style: "scroll", position: [-ROSE_X, 4.45, -ROSE_Z], suspension: HALL_HEIGHT, bottom: 3.58, radius: 0.66, glowRadius: 0.58 },
  { id: "chandelier-fireplace-door", style: "scroll", position: [-ROSE_X, 4.45, ROSE_Z], suspension: HALL_HEIGHT, bottom: 3.58, radius: 0.66, glowRadius: 0.58 },
  { id: "chandelier-end-window", style: "scroll", position: [ROSE_X, 4.45, -ROSE_Z], suspension: HALL_HEIGHT, bottom: 3.58, radius: 0.66, glowRadius: 0.58 },
  { id: "chandelier-end-door", style: "scroll", position: [ROSE_X, 4.45, ROSE_Z], suspension: HALL_HEIGHT, bottom: 3.58, radius: 0.66, glowRadius: 0.58 },
];

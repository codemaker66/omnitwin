// ---------------------------------------------------------------------------
// What lies beyond the Grand Hall's doors
//
// Pure data and a parser, no renderer. Near each doorway, the floor of the
// space beyond it within a reach of the doorway's outer face, as measured for
// the planner's section (tools/grand-hall-survey/measure/beyond-doors.py; its
// output, beyond-doors.json, is the provenance the tests hold these numbers
// to):
//
//   - D1, the end door: the Saloon (F.01), from the scan: its herringbone oak,
//     the Spanish mahogany panelling on its face of the door wall, the single
//     leaf at that face (hall-doors.ts);
//   - D2, the main door: the head of Stair 5 (F.16 and F.17), from the scan:
//     the pale landing with the inlaid TRADES HALL and the crest, the
//     balustrade over the stairwell (straight in the scan, not curved: its rail
//     runs at z 8.015-8.12 between newels at x -1.15 and 1.14), the stairwell
//     falling away beyond it to the half landing at y -1.8;
//   - D3, the fireplace door: the east end of the F.16 corridor, and D4, the
//     fire exit: Stair 7's landing (F.11), from the 2010 FIRST plan only (the
//     scan did not go there).
//
// Further out, the whole first floor's walls come from the 2010 FIRST plan,
// read as vectors and registered to the scan (measure/first-floor.py), and
// published beside the survey's photographs (first-floor-2010.json, fetched
// only for the Atelier section): every polygon carries the plan paths it came
// from, and the registration its residuals against the scanned walls.
//
// Frame: the planner's (hall-spec.ts), metres; outlines are (x, z) in plan.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { HALL_OPENINGS, HALL_WALLS, hallDoor, wallPoint } from "./hall-spec.js";
import { hallSurveyUrl } from "./hall-photos.js";

/** A point in plan: planner (x, z). */
export type PlanPoint = readonly [number, number];

/** What a beyond floor is drawn as. */
export type BeyondFinish = "saloon-oak" | "landing-stone" | "corridor" | "stair-landing";

/** The space beyond one doorway. */
export interface BeyondSpace {
  /** The HALL_OPENINGS id. */
  readonly opening: string;
  readonly label: "D1" | "D2" | "D3" | "D4";
  readonly room: string;
  /** How far from the doorway's outer face the floor is drawn (it fades out toward it), metres. */
  readonly reach: number;
  /** The floor beyond, in plan: it meets the hall's outer faces wherever it reaches them, across the doorway too. */
  readonly floor: readonly PlanPoint[];
  /** Where the floor falls away (the main door's stairwell), drawn dark. */
  readonly well: readonly PlanPoint[] | null;
  /** The floor's level as the scan has it (null where only the plan is evidence), metres. */
  readonly scanLevel: number | null;
  readonly finish: BeyondFinish;
  readonly source: string;
}

const SCAN_SOURCE = "scan: the dollhouse mesh's height map at 2 cm, the floor within 6 cm of its level beyond the doorway, joined to it, within the reach (measure/beyond-doors.py)";
const PLAN_SOURCE = "2010 FIRST plan (first-floor-2010.json, registered to the scan): its floor joined to the doorway, within the reach (measure/beyond-doors.py)";

/**
 * The four spaces (beyond-doors.json, 20 October 2026). The scan puts the
 * Saloon's floor 4.3 cm and the landing 4.6 cm under the hall's (the mesh is
 * good to about 2 cm; the hall's own floor reads -1 cm in it): the planner
 * draws them at BEYOND_FLOOR_Y, a rendering tolerance above the city model's
 * caps at the floor's level.
 */
export const BEYOND_SPACES: readonly BeyondSpace[] = [
  {
    opening: "door-end", label: "D1", room: "F.01 Saloon", reach: 2.4, scanLevel: -0.043, finish: "saloon-oak", well: null,
    floor: [
      [7.5, 8.075], [7.5, 8.439], [7.847, 8.629], [8.237, 8.763], [8.643, 8.828], [8.997, 8.828], [9.403, 8.763], [9.793, 8.629],
      [10.104, 8.463], [10.388, 8.252], [10.637, 8.003], [10.848, 7.719], [11.014, 7.408], [11.133, 7.075], [11.218, 6.435],
      [11.08, 6.435], [11.08, 6.855], [11.04, 6.875], [10.78, 6.855], [10.78, 6.735], [10.84, 6.735], [10.88, 6.615], [10.88, 6.435],
      [7.45, 6.435], [7.45, 8.075],
    ],
    source: `${SCAN_SOURCE}; the Saloon itself, to its west face at x 7.45 (open there onto the end of the F.16 corridor)`,
  },
  {
    opening: "door-main", label: "D2", room: "F.16 at the head of Stair 5", reach: 2.4, scanLevel: -0.046, finish: "landing-stone",
    floor: [
      [-0.72, 6.385], [-0.72, 6.435], [-2.394, 6.435], [-2.337, 6.911], [-2.165, 7.411], [-1.887, 7.862], [-1.536, 8.225],
      [-1.315, 8.225], [-1.295, 7.965], [-0.935, 8.005], [1.025, 8.005], [1.285, 7.965], [1.265, 8.205], [1.546, 8.225],
      [1.897, 7.862], [2.175, 7.411], [2.333, 6.968], [2.404, 6.444], [0.73, 6.435], [0.73, 6.385],
    ],
    well: [
      [1.085, 8.205], [1.045, 8.065], [1.085, 7.996], [-1.095, 7.987], [-1.075, 8.165], [-1.175, 8.225], [-1.195, 8.425],
      [-1.155, 8.425], [-1.155, 8.486], [-0.968, 8.579], [-0.521, 8.727], [-0.113, 8.782], [0.299, 8.767], [0.702, 8.682],
      [1.13, 8.505], [1.105, 8.385], [1.145, 8.385], [1.145, 8.205],
    ],
    source: `${SCAN_SOURCE}; the stairwell, the cells more than 15 cm below the landing`,
  },
  {
    opening: "door-fireplace", label: "D3", room: "F.16, its east lobby", reach: 2.4, scanLevel: null, finish: "corridor", well: null,
    floor: [
      [-10.443, 6.075], [-10.444, 6.218], [-11.207, 6.221], [-11.207, 6.621], [-11.087, 6.993], [-10.898, 7.359], [-10.58, 7.759],
      [-10.455, 7.758], [-10.455, 7.877], [-10.346, 7.968], [-7.38, 7.956], [-7.053, 7.643], [-6.782, 7.258], [-6.61, 6.884],
      [-6.498, 6.437], [-7.0, 6.435], [-7.002, 5.755], [-8.33, 5.755], [-8.33, 6.075],
    ],
    source: PLAN_SOURCE,
  },
  {
    opening: "door-fire-exit", label: "D4", room: "F.11 Stair 7, its landing", reach: 1.2, scanLevel: null, finish: "stair-landing", well: null,
    floor: [
      [-12.012, -4.412], [-12.419, -4.249], [-12.741, -3.95], [-12.934, -3.555], [-12.972, -3.117], [-12.849, -2.695],
      [-12.583, -2.346], [-12.209, -2.115], [-11.777, -2.035], [-11.777, -4.435],
    ],
    source: PLAN_SOURCE,
  },
];

/**
 * The beyond floors' level: 1 cm above the hall's floor. The city model's caps
 * lie at the floor's level outside its cut-out for the hall (|x| > 11.2 or
 * |z| > 5.95), under these floors, and 1 cm is several depth steps at any
 * distance the planner allows (hall-section.ts CITY_CUTOUT). The doorways'
 * thresholds lie at 8 mm (hall-wall-body.ts THRESHOLD_HEIGHT).
 */
export const BEYOND_FLOOR_Y = 0.01;

/**
 * The landing's balustrade over the stairwell, from the scan (beyond-doors.json
 * balustrade): the rail's top 0.811 m, its top 10.5 cm deep (z 8.015-8.12);
 * newels 0.34 by 0.36 m at their base, 1.21 m to the top of their finials; the
 * balusters 6.7 cm across at their widest, 14.4 cm apart between the first
 * and last the mesh resolves (x -0.876 and 0.853; its middle is broken where a
 * station stood in front of it).
 */
export const LANDING_BALUSTRADE = {
  railTop: 0.811,
  railZ: [8.015, 8.12],
  newels: [
    { x: [-1.317, -0.978], z: [7.982, 8.339], top: 1.212 },
    { x: [0.965, 1.308], z: [7.978, 8.35], top: 1.215 },
  ],
  balusters: { first: -0.876, last: 0.853, count: 13, width: 0.067, z: 8.076 },
  source: "scan: mesh vertices over the straight run and its newels, a section at 0.3 m through the balusters (measure/beyond-doors.py)",
} as const;

/**
 * The Saloon's face of the door wall east of the end door, from the scan
 * (beyond-doors.json saloonPanelling): Spanish mahogany panelling, its dado
 * standing 3.9 cm proud of the wall's face to 1.2 m. West of the doorway the
 * doorcase stands flush.
 */
export const SALOON_DADO = {
  top: 1.2,
  proud: 0.039,
  /** Along the door wall's outer face, planner x: from the doorcase east, out past the reach. */
  from: 9.5,
  to: 11.2,
  source: "scan: vertical sections every 10 cm through the Saloon's face of the door wall, x 9.9-11.5 (measure/beyond-doors.py)",
} as const;

/** A doorway's outer face: its wall (HALL_WALLS index), its extent along the wall and in plan. */
export interface DoorwayFace {
  readonly wall: number;
  readonly u0: number;
  readonly u1: number;
  /** Depth of the doorway's outer face behind the wall's plane (negative). */
  readonly depth: number;
  /** The outer face's two ends in plan, and its middle. */
  readonly a: PlanPoint;
  readonly b: PlanPoint;
  readonly centre: PlanPoint;
  /** Unit vector away from the hall, in plan. */
  readonly outward: PlanPoint;
}

/** Where a doorway comes out of the hall's wall (hall-spec.ts, HALL_DOORS' depth). */
export function doorwayFace(opening: string): DoorwayFace {
  const entry = HALL_OPENINGS.find((candidate) => candidate.id === opening);
  const door = hallDoor(opening);
  if (entry === undefined || door === undefined) throw new Error(`No doorway ${opening}`);
  const wallIndex = HALL_WALLS.findIndex((candidate) => candidate.id === entry.wall);
  const wall = HALL_WALLS[wallIndex];
  if (wall === undefined) throw new Error(`No wall for ${opening}`);
  const u0 = entry.centre - entry.width / 2;
  const u1 = entry.centre + entry.width / 2;
  const pa = wallPoint(wall, u0, 0, -door.depth);
  const pb = wallPoint(wall, u1, 0, -door.depth);
  const pc = wallPoint(wall, entry.centre, 0, -door.depth);
  return {
    wall: wallIndex, u0, u1, depth: -door.depth,
    a: [pa[0], pa[2]], b: [pb[0], pb[2]], centre: [pc[0], pc[2]],
    outward: [-wall.normal[0], -wall.normal[2]],
  };
}

/** The nearest distance from a plan point to a doorway's outer face, metres (the beyond's fade and its light). */
export function distanceToDoorway(face: DoorwayFace, p: PlanPoint): number {
  const dx = face.b[0] - face.a[0];
  const dz = face.b[1] - face.a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - face.a[0]) * dx + (p[1] - face.a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - (face.a[0] + t * dx), p[1] - (face.a[1] + t * dz));
}

/** Whether a plan point lies inside a closed outline (even-odd). */
export function insideOutline(outline: readonly PlanPoint[], p: PlanPoint): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a === undefined || b === undefined) continue;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// The first floor from the 2010 plan (published, fetched for Atelier)
// ---------------------------------------------------------------------------

export const FIRST_FLOOR_FILE = "first-floor-2010.json";

/** The first floor's file, at the survey's revision. */
export function firstFloorUrl(): string {
  return hallSurveyUrl(FIRST_FLOOR_FILE);
}

/** Coordinates outside this box mean a malformed file, metres (the building is about 31 by 25 m). */
const PLAN_LIMIT = 40;

const coordinate = z.number().finite().gte(-PLAN_LIMIT).lte(PLAN_LIMIT);
const ring = z.array(z.tuple([coordinate, coordinate])).min(3).max(4000);
const polygon = z.object({ id: z.string().min(1), outline: ring, holes: z.array(ring).max(200), source: z.string().min(1) });
const residual = z.object({ metres: z.number(), median: z.number().nonnegative(), p90: z.number().nonnegative() });

const firstFloorSchema = z.object({
  version: z.literal(1),
  source: z.object({ file: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/), page: z.number().int().positive() }),
  registration: z.object({
    affine: z.tuple([z.tuple([z.number(), z.number(), z.number()]), z.tuple([z.number(), z.number(), z.number()])]),
    residuals: z.object({ fitted: z.record(z.string(), residual) }),
  }),
  walls: z.array(polygon).min(1).max(500),
  floor: z.array(polygon).max(50),
});

export interface PlanPolygon {
  readonly id: string;
  readonly outline: readonly PlanPoint[];
  readonly holes: readonly (readonly PlanPoint[])[];
  readonly source: string;
}

export interface FirstFloorPlan {
  readonly walls: readonly PlanPolygon[];
  readonly floor: readonly PlanPolygon[];
  /** Plan points (PDF) to planner (x, z): rows x and z of an affine map. */
  readonly affine: readonly [readonly [number, number, number], readonly [number, number, number]];
  /** The registration's residuals against the scanned walls, per region (median and p90, metres). */
  readonly residuals: Readonly<Record<string, { readonly metres: number; readonly median: number; readonly p90: number }>>;
  readonly sourceSha256: string;
}

/** Reads first-floor-2010.json, rejecting anything malformed. */
export function parseFirstFloor(value: unknown): FirstFloorPlan {
  const parsed = firstFloorSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Grand Hall first floor: ${parsed.error.issues[0]?.message ?? "malformed"}`);
  const data = parsed.data;
  const toPolygon = (entry: z.infer<typeof polygon>): PlanPolygon => ({
    id: entry.id,
    source: entry.source,
    outline: entry.outline.map(([x, zz]): PlanPoint => [x, zz]),
    holes: entry.holes.map((hole) => hole.map(([x, zz]): PlanPoint => [x, zz])),
  });
  return {
    walls: data.walls.map(toPolygon),
    floor: data.floor.map(toPolygon),
    affine: data.registration.affine,
    residuals: data.registration.residuals.fitted,
    sourceSha256: data.source.sha256,
  };
}

/** Fetches and reads the first floor; rejects on a network failure or a malformed file. */
export async function loadFirstFloor(signal?: AbortSignal): Promise<FirstFloorPlan> {
  const response = await fetch(firstFloorUrl(), signal === undefined ? {} : { signal });
  if (!response.ok) throw new Error(`Grand Hall first floor: HTTP ${String(response.status)}`);
  const body: unknown = await response.json();
  return parseFirstFloor(body);
}

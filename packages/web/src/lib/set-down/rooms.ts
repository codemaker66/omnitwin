// ---------------------------------------------------------------------------
// The surveyed volume and surfaces of each Trades Hall room, for its echo
// (T-700).
//
// Each room's areas are worked out here from its named source, so a later
// survey edits one place. Absorption per material comes from acoustic-data.ts;
// room-acoustics.ts turns these surfaces into reverberation times. Rooms are
// laid out about their own centre: x along the length, z across the width,
// as hall-spec.ts frames the Grand Hall.
//
// Sources. "Survey" is the 17 October 2026 survey of the Matterport twin of
// the building (T-662): its mesh, its 149 scan stations and the 2010
// licensing plans. "Published" is the venue's own room sizes
// (tradeshallglasgow.co.uk/rooms, fetched 17 October 2026). A figure is
// measured where the survey measured it; every other figure is EST and says
// what it rests on.
// ---------------------------------------------------------------------------

import type { SurfaceMaterialId } from "./acoustic-data.js";
import type { BandValues } from "./bands.js";
import {
  HALL_DOME,
  HALL_DOORS,
  HALL_ELEVATION,
  HALL_HEIGHT,
  HALL_LENGTH,
  HALL_OPENINGS,
  HALL_WIDTH,
  domeHeightAt,
  isWindow,
  openingTop,
  type HallOpening,
} from "../../components/grand-hall/hall-spec.js";

export type RoomSlug =
  | "grand-hall"
  | "saloon"
  | "robert-adam-room"
  | "reception-room"
  | "north-gallery"
  | "south-gallery";

export interface RoomSurface {
  readonly material: SurfaceMaterialId;
  readonly areaM2: number;
  readonly role: "floor" | "wall" | "ceiling" | "opening";
  /**
   * Set on the Grand Hall's dome: a ceiling surface that rises above the
   * ceiling plane, which the offline tracer draws as a cap. Its material alone
   * cannot say so, since it shares the flat ceiling's.
   */
  readonly dome?: true;
}

export interface RoomAcoustics {
  readonly slug: string;
  readonly volumeM3: number;
  readonly surfaces: readonly RoomSurface[];
  /** Per-band multiplier on the Eyring time, fitted by the ray tracer (Task 7). */
  readonly calibration: BandValues;
  readonly source: string;
}

/** The floor rectangle a reference layout is set out in, centred on the room. */
export interface RoomPlan {
  readonly lengthM: number;
  readonly widthM: number;
}

/** Calibration before the tracer fits it: Eyring as calculated. */
export const UNCALIBRATED: BandValues = [1, 1, 1, 1, 1, 1, 1];

/**
 * Each room's calibration, fitted to the offline ray tracer (T-700, Task 7):
 * per band, the tracer's empty T20 over Eyring's empty time, clamped to
 * 0.7-1.3 and rounded to 3 decimals. From tools/set-down-acoustics/results.json,
 * retraced on 13 Nov 2026 after ruling R49's changes to the rooms, and again on
 * 18 Nov 2026 after the Robert Adam Room took its measured outline (ruling
 * R96), when every other room traced exactly as on 13 November. Both times with
 * seeds 1 and 2 (200,000 rays a band; 2,000,000 in the galleries, which share
 * one trace), and run twice to the same bytes. The tracer draws each room as a
 * box with the model's volume and surface areas, so the factors correct
 * Eyring's diffuse-field assumption on those boxes; they are not fitted to the
 * rooms' outlines. The 125 Hz factor is 1 wherever the room's Schroeder
 * frequency is above that octave's lower edge, where rays say nothing about a
 * modal response (ruling R39): every room but the Grand Hall. The Robert Adam
 * Room's 250 and 500 Hz factors (1.3 and 1.196) are kept as fitted (ruling
 * R59): its absorption sits on the floor and ceiling between hard walls, and
 * Fitzroy's formula for uneven absorption, independent of the tracer, puts
 * those bands at 1.613 and 1.321 x Eyring (README.md, "What stays
 * uncertain"). At 250 Hz its tracer reads 1.319 x Eyring, just past the clamp,
 * and the model stays within 1.4 % of it there. The
 * galleries' 1-8 kHz bands sit at the clamp: their tracer reads 1.35-1.57 x
 * Eyring there, an upper bound for an unsurveyed attic section (README.md,
 * "Difference explained"). After any change to a room's surfaces, export,
 * retrace and refit; the tests fail until rooms.json, results.json and these
 * agree.
 */
const TRACER_CALIBRATION: Readonly<Record<RoomSlug, BandValues>> = {
  "grand-hall": [1.067, 1.038, 1.023, 1.009, 1.008, 1.007, 1.006],
  saloon: [1, 1.024, 1.019, 1.012, 1.01, 1.006, 1.006],
  "robert-adam-room": [1, 1.3, 1.196, 1.089, 1.071, 1.053, 1.031],
  "reception-room": [1, 1.009, 1, 0.992, 0.991, 0.989, 0.987],
  "north-gallery": [1, 1.068, 1.198, 1.3, 1.3, 1.3, 1.3],
  "south-gallery": [1, 1.068, 1.198, 1.3, 1.3, 1.3, 1.3],
};

/**
 * A door in the Saloon, the Reception Room or a gallery, 1.6 x 2.6 m (EST): no
 * source sizes those rooms' doors (the survey sees double doors in most of
 * them); the figure is a pair of leaves somewhat larger than the Grand Hall's
 * scanned doorways (1.06-1.45 m wide, hall-spec.ts). A door is a few m2 of a
 * room's hundreds, so the error is small. The Robert Adam Room's doors are
 * measured (ROBERT_ADAM).
 */
const HOUSE_DOOR_M2 = 1.6 * 2.6;

function surface(material: SurfaceMaterialId, areaM2: number, role: RoomSurface["role"]): RoomSurface {
  return { material, areaM2, role };
}

// ---------------------------------------------------------------------------
// The Grand Hall, from components/grand-hall/hall-spec.ts
// ---------------------------------------------------------------------------

/** Rings the dome's profile is integrated in; halving it moves neither figure by 0.01 %. */
const DOME_STEPS = 1024;

/** The dome above the ceiling plane, from its scanned profile. */
export interface DomeGeometry {
  /** The air above the ceiling plane, m3. */
  readonly volumeM3: number;
  /** The dome's inner face, from the gilt foot ring to the crown plate, m2. */
  readonly surfaceM2: number;
  /** The hole it leaves in the ceiling, m2. */
  readonly openingM2: number;
}

/**
 * Integrates the scanned dome (HALL_DOME, domeHeightAt in hall-spec.ts) as a
 * surface of revolution in `steps` rings from the crown to the foot ring: the
 * volume by the midpoint rule on 2 pi r (h(r) - ceiling) dr, the inner face
 * as a stack of conical frusta, which stays exact where the band drops
 * vertically to the foot.
 */
export function domeGeometry(steps: number = DOME_STEPS): DomeGeometry {
  const n = Math.max(1, Math.floor(steps));
  const foot = HALL_DOME.footRadius;
  const dr = foot / n;
  let volumeM3 = 0;
  let surfaceM2 = 0;
  let r0 = 0;
  let h0 = domeHeightAt(0);
  for (let i = 1; i <= n; i += 1) {
    const mid = (i - 0.5) * dr;
    volumeM3 += 2 * Math.PI * mid * (domeHeightAt(mid) - HALL_HEIGHT) * dr;
    const r1 = i * dr;
    const h1 = domeHeightAt(r1);
    surfaceM2 += Math.PI * (r0 + r1) * Math.hypot(r1 - r0, h1 - h0);
    r0 = r1;
    h0 = h1;
  }
  return { volumeM3, surfaceM2, openingM2: Math.PI * foot * foot };
}
/**
 * The mahogany dado's height: the top of its cap rail, as the scan measures it
 * (HALL_ELEVATION.dadoTop, 1.95 m; ruling R12 replaced the plan's 1.2 m).
 */
const DADO_BAND_M = HALL_ELEVATION.dadoTop;
/**
 * The width of each of a window's two velour curtains, flat (EST), as the plan
 * sets it: 31 m2 of velour, and 2.51 s at 1 kHz in the empty hall (Eyring as
 * calculated), inside the plan's 2.0-2.6 s; widths from about 0.81 to 1.57 m
 * pass. (Before the dome was integrated from the scan, its EST volume put the
 * hall over 2.6 s and this was raised to 1.05 m; with the scanned dome the
 * plan's figure stood. The first hand estimate of 27 October assumed 45 m2.)
 */
const CURTAIN_WIDTH_M = 0.9;

/** The clear area of an opening; an arched window adds its semicircular head. */
function openingArea(opening: HallOpening): number {
  const square = opening.width * (opening.head - opening.sill);
  if (opening.kind !== "arched-window") return square;
  const radius = opening.width / 2;
  return square + (Math.PI * radius * radius) / 2;
}

/**
 * The area an opening takes out of the dado band, floor to cap rail: a window
 * only above its sill (0.915-0.935 m), a door from the floor to its head or
 * the rail. Under a sill the wall is panelled.
 */
function openingAreaInDado(opening: HallOpening): number {
  const bottom = Math.max(0, opening.sill);
  const top = Math.min(openingTop(opening), DADO_BAND_M);
  return opening.width * Math.max(0, top - bottom);
}

function grandHall(): RoomAcoustics {
  const windows = HALL_OPENINGS.filter(isWindow);
  const doorIds = new Set(HALL_DOORS.map((door) => door.opening));
  const doors = HALL_OPENINGS.filter((opening) => doorIds.has(opening.id));

  const floor = HALL_LENGTH * HALL_WIDTH;
  const dome = domeGeometry();
  const volume = floor * HALL_HEIGHT + dome.volumeM3;

  const perimeter = 2 * (HALL_LENGTH + HALL_WIDTH);
  const glazing = windows.reduce((sum, opening) => sum + openingArea(opening), 0);
  const doorArea = doors.reduce((sum, opening) => sum + openingArea(opening), 0);
  const openingsInDado = HALL_OPENINGS.reduce((sum, opening) => sum + openingAreaInDado(opening), 0);
  const dado = perimeter * DADO_BAND_M - openingsInDado;
  const upperWall = perimeter * HALL_HEIGHT - glazing - doorArea - dado;
  // Two curtains a window, each as tall as the window's clear opening.
  const curtains = windows.reduce(
    (sum, opening) => sum + 2 * CURTAIN_WIDTH_M * (openingTop(opening) - opening.sill),
    0,
  );

  return {
    slug: "grand-hall",
    volumeM3: volume,
    surfaces: [
      surface("oak-boards-joists", floor, "floor"),
      surface("plaster-lath", floor - dome.openingM2, "ceiling"),
      // No source gives the dome's construction (EST). The 2010 licensing
      // plans put a "Dome Space" over it between the galleries, so it has air
      // behind it; it takes the plaster-on-lath row of the ceiling round it.
      { material: "plaster-lath", areaM2: dome.surfaceM2, role: "ceiling", dome: true },
      surface("hardwood-panelling", dado, "wall"),
      surface("hardwood-panelling", upperWall / 2, "wall"),
      surface("plaster-masonry", upperWall / 2, "wall"),
      surface("sash-glazing", glazing, "opening"),
      surface("timber-door", doorArea, "opening"),
      surface("velour-drape", curtains, "wall"),
    ],
    calibration: TRACER_CALIBRATION["grand-hall"],
    source:
      "hall-spec.ts (scan of 11 July 2026): plan, ceiling, HALL_OPENINGS windows and HALL_DOORS doors; the scanned dome (HALL_DOME, domeHeightAt), integrated, its material EST; dado to the scanned 1.95 m cap rail, less each opening's part of that band; curtains 2 x 0.9 m a window (EST)",
  };
}

// ---------------------------------------------------------------------------
// The other rooms, from the survey (17 October 2026) and the venue's figures
// ---------------------------------------------------------------------------

/**
 * Saloon, 11.8 x 7.1 m under a 5.60 m mean ceiling:
 * - length 11.8 m: measured, the survey's clear span;
 * - width 7.1 m (EST): the midpoint of the survey's measured 6.8 m between
 *   the wall faces and 7.4 m into the window bays; 11.8 x 7.1 = 83.8 m2
 *   against the published 84 m2 (12 x 7 m);
 * - ceiling 5.60 m: measured, the area mean of the survey mesh's ceiling over
 *   the clear span (upward rays on a 0.2 m and a 0.1 m grid agree to 1 mm). The
 *   survey reads 5.48-5.53 m over the flat field and 5.6-5.86 m in the
 *   central panel; the published 5.4 m is lower than both.
 * The rest is EST. The three leaded windows are 2.0 x 3.5 m: the survey
 * measures three bays about 2 m wide, not their height. Marble is 2 m2 for
 * the chimneypiece, one door is the house's, and 70 % of the wall is
 * panelled: HES and the survey describe the room as mahogany panelled, but
 * the panelled share is not measured.
 */
function saloon(): RoomAcoustics {
  const length = 11.8;
  const width = 7.1;
  const height = 5.6;
  const windows = 3 * 2.0 * 3.5;
  const marble = 2;
  const door = HOUSE_DOOR_M2;
  const wall = 2 * (length + width) * height - windows - marble - door;
  return {
    slug: "saloon",
    volumeM3: length * width * height,
    surfaces: [
      surface("parquet-timber-subfloor", length * width, "floor"),
      surface("plaster-lath", length * width, "ceiling"),
      surface("hardwood-panelling", wall * 0.7, "wall"),
      surface("plaster-masonry", wall * 0.3, "wall"),
      surface("marble", marble, "wall"),
      surface("leaded-glass", windows, "opening"),
      surface("timber-door", door, "opening"),
    ],
    calibration: TRACER_CALIBRATION.saloon,
    source:
      "survey: 11.8 m long (measured), 7.1 m wide (EST, the midpoint of the measured 6.8-7.4 m), 5.60 m mean ceiling (measured, the mesh's area mean); EST: walls 70 % panelling, three 2.0 x 3.5 m leaded windows, marble 2 m2, one 1.6 x 2.6 m door",
  };
}

/** An opening's width, sill and head in m, the sill and head above the lower floor. */
type OpeningSize = readonly [width: number, sill: number, head: number];

function openingM2([width, sill, head]: OpeningSize): number {
  return width * (head - sill);
}

/** The Robert Adam Room's steps, m2 (ROBERT_ADAM.lower.stepsM2 says how it is found). */
const ROBERT_ADAM_STEPS_M2 = 3.064;

/**
 * The Robert Adam Room as T-662 measured it from the July scan (#442, ruling
 * R96). "The outline" is tools/surveyed-rooms/robert-adam-room.room.json: 64
 * walls, each with its measured height above the lower floor (the ceiling met
 * 0.10 m inside its face), and the floor levels and ceiling regions. "The
 * README" is tools/surveyed-rooms/measure/robert-adam-room/README.md. Each
 * figure below names its source; robertAdamRoom says how they are combined,
 * and room-acoustics.test.ts recomputes them from the outline.
 */
export const ROBERT_ADAM = {
  lower: {
    /**
     * The steps: the alcove's 3.360 m width between its walls, from the first
     * riser to the top one, 0.912 m (the outline; README, "Steps": 3.1 m2). They
     * stand south of the top riser's line under the alcove's raised panel, so
     * their floor and air are the lower section's, and not the upper's.
     */
    stepsM2: ROBERT_ADAM_STEPS_M2,
    /**
     * The outline south of the top riser's line (E57 Y 0.376, the wall the arch
     * is in), 112.060 m2: 108.996 m2 of floor with the street recess, the lift
     * bay and the alcove (README, "Lower section, area": 109.0 m2) and the
     * steps' 3.064 m2 (README, "Steps": 3.1 m2).
     */
    floorM2: 108.996 + ROBERT_ADAM_STEPS_M2,
    /**
     * The area mean of the air's height over that floor, from the outline: its
     * ceiling regions (eleven raised panels at 3.173-3.216 m, the side aisles'
     * cross beams at 2.896-2.932 m, the boxed lintels over the windows at 2.678
     * and 2.717 m, the lift bay at 2.706 m, and the beams' 2.8 m soffit
     * wherever no region is drawn) above its floor levels (the treads and
     * plinths 0.146-0.43 m up), on a 1 cm raster. Taking the regions as
     * polygons instead gives 3.004 m.
     */
    meanHeightM: 3.003,
    /**
     * Its 40 walls, 62.347 m long (the outline), each its length times its
     * measured height: 185.175 m2. The two short walls either side of the arch
     * stand partly behind the plinths beside the steps; the 0.24 m2 hidden
     * there is counted.
     */
    wallM2: 185.175,
  },
  upper: {
    /**
     * The outline north of the top riser: the landing, the lobby and the main
     * upper room (README, "Upper section, area": 52.5 m2).
     */
    floorM2: 52.459,
    /**
     * The area mean of the outline's ceiling above the upper floor: its flat
     * ceiling at 2.171 m over 30.6 m2 (README, "Ceilings": 2.166-2.180 m), the
     * raised field's two rectangles at 2.288 and 2.293 m over 21.5 m2, and the
     * arch between the lobby and the main room at 2.055 m over 0.3 m2, on a
     * 1 cm raster (2.219 m as polygons too).
     */
    meanHeightM: 2.219,
    /**
     * Its 24 walls, 35.039 m long (the outline), each its length times its
     * measured height above the upper floor (0.594 m above the lower; README,
     * "Floors and steps"): 75.308 m2. The curved screen wall counts its
     * 1.652 m arc (a quarter circle of 1.052 m, README "Wall faces"), not the
     * outline's 1.486 m chord.
     */
    wallM2: 75.308,
  },
  /**
   * The arch to the upper section: 2.375 m wide between its jambs, square-headed
   * at the upper ceiling's height, 2.77 m above the lower floor (README,
   * "Openings", and the outline's two jambs). Over its head the lower side's
   * wall runs on to the alcove's raised panel, 3.191 m (the outline).
   */
  arch: { widthM: 2.375, headM: 2.77, alcoveCeilingM: 3.191 },
  /**
   * The two street windows (README, "Openings"): from the board to the boxed
   * lintel's soffit. Their glass rises 0.11-0.13 m behind the lintel, which
   * the room's air does not meet, so that strip is not counted.
   */
  windows: [
    [2.26, 0.605, 2.677],
    [2.23, 0.637, 2.716],
  ],
  /**
   * The glazed entrance screen in the middle bay (README, "Openings"): a glazed
   * door between two sidelights, from its 0.285 m plinth to its head.
   */
  entranceScreen: [2.72, 0.285, 2.745],
  /**
   * The five doors (README, "Openings"): the double door to the entrance
   * hall's lobby, the timber door in the west wall, the double door to the
   * rear corridor and the two doors in the upper north wall.
   */
  doors: [
    [1.35, 0, 2.05],
    [0.71, 0, 2.045],
    [1.66, 0.594, 2.634],
    [0.94, 0.594, 2.599],
    [0.95, 0.594, 2.584],
  ],
} as const;

/**
 * Robert Adam Room: a lower section on the street front of 112.06 m2, with a
 * 3.003 m mean height, and, four risers up behind it, an upper section of
 * 52.46 m2 with a 2.219 m mean height above its floor, joined by an arch
 * 2.375 m wide: 164.52 m2 of floor (README, "Whole room": 164.5 m2) and
 * 452.9 m3 of air. ROBERT_ADAM gives each figure's source. How they are
 * combined:
 * - Floor and ceiling: each section's plan area. The coffers' sides, the
 *   vertical faces round the panels, beams, lintels and raised field, come to
 *   42 m2 by the outline's ceiling regions (52 m2 counting the edges along the
 *   walls too, an upper bound), and would add about 5.5-7 % to the room's
 *   absorption at 1 kHz as plaster on masonry or on lath; they are left out,
 *   as the Grand Hall's coffers are, and so are the risers' and the plinths'
 *   faces.
 * - Volume: each section's floor area times its area-mean height.
 * - Walls: each section's walls at their measured heights, and over the arch's
 *   head 2.375 x (3.191 - 2.77) = 1.0 m2 more. Nothing is counted across the
 *   arch itself. The published figures' model took the upper section's whole
 *   5.6 x 2.2 m end as open (EST); the arch is 2.375 m wide, so the walls
 *   either side of it now count.
 * - The published figures were partial. The lower section is 7.64 m deep only
 *   to its shoulders (the website's 7.6 m); it runs on behind them, 10.07 m
 *   wide, to the back wall at 9.44 m (README, "Lower section, depth" and
 *   "width"). Ruling R60's "the mesh gives 8.88 m to the facade" was the
 *   facade's outer face, not a surface the room's air meets (R96).
 * - The upper section's height: ruling R66 kept 2.2 m, the flat ceiling,
 *   because the 17 October mesh's area mean (2.303 m) was pulled up by higher
 *   parts that survey did not identify. #442 identifies and measures them, the
 *   raised field, so the area mean of the measured parts, 2.219 m, replaces
 *   R66's figure (+0.9 %, 1.0 m3).
 * - The platform lift's upper landing (1.0 x 1.42 m, 1.98 m high) lies outside
 *   the outline, and is left out: about 2.8 m3, 0.6 % of the air. Its open way
 *   from the lobby (the outline's lift-landing wall) and the lift's gate over
 *   the bay (lift-head, whose 0.594 m riser the outline gives, taken up to the
 *   bay's 2.706 m ceiling) are counted as wall.
 * - Openings at their measured sizes (README, "Openings"): two windows of
 *   4.68 and 4.64 m2 and the entrance screen, 6.69 m2, as glazing; five doors,
 *   11.38 m2, as timber doors, closed as every room's are (the lobby door stood
 *   open in the scan). The screen is taken as glass throughout (EST: by the
 *   README its glass is 2.27 m of its 2.72 m width, the rest timber framing),
 *   as the Reception Room's glazed doors are. The published figures' model had
 *   three 1.6 x 2.0 m windows and two 1.6 x 2.6 m doors (EST).
 * - No curtain (ruling R97). That model hung 2 x 2.2 m of velour at the arch (EST), on the
 *   17 October survey's reading of a red curtain there from station 112, which
 *   it marked as inferred. #442 finds the arch lined in timber and records no
 *   curtain in the room (README, "The room, in words" and "Inventory"); the
 *   scan's photographs from stations 103 and 112 show the bare lining.
 * - Materials as before (EST): oak boards on joists; plaster on lath for both
 *   ceilings; plaster on masonry for every wall, including the fluted piers
 *   and casings, the arch's timber lining, the alcove's mirrors and the
 *   radiator casings, none of whose construction is measured. The survey puts
 *   the lower section under the south end of the Grand Hall and the upper
 *   under the Saloon, so each ceiling sits 0.4-0.8 m under a first-floor timber
 *   floor (the Grand Hall's oak boards on joists, the Saloon's parquet on a
 *   timber subfloor, as this file has them). A ceiling with a void takes the
 *   lath row, not solid plaster (ruling R49).
 */
function robertAdamRoom(): RoomAcoustics {
  const { lower, upper, arch } = ROBERT_ADAM;
  const floor = lower.floorM2 + upper.floorM2;
  const overArch = arch.widthM * (arch.alcoveCeilingM - arch.headM);
  const walls = lower.wallM2 + upper.wallM2 + overArch;
  const windows = ROBERT_ADAM.windows.reduce((sum, size) => sum + openingM2(size), 0);
  const screen = openingM2(ROBERT_ADAM.entranceScreen);
  const doors = ROBERT_ADAM.doors.reduce((sum, size) => sum + openingM2(size), 0);
  return {
    slug: "robert-adam-room",
    volumeM3: lower.floorM2 * lower.meanHeightM + upper.floorM2 * upper.meanHeightM,
    surfaces: [
      surface("oak-boards-joists", floor, "floor"),
      surface("plaster-lath", floor, "ceiling"),
      surface("plaster-masonry", walls - windows - screen - doors, "wall"),
      surface("sash-glazing", windows, "opening"),
      // The glazed entrance screen, taken as glass (EST: its timber framing is
      // about a sixth of its width).
      surface("sash-glazing", screen, "opening"),
      surface("timber-door", doors, "opening"),
    ],
    calibration: TRACER_CALIBRATION["robert-adam-room"],
    source:
      "T-662's outline (#442, tools/surveyed-rooms/robert-adam-room.room.json and its measure README): lower section 112.06 m2 with the steps (README 109.0 + 3.1 m2) at a 3.003 m mean height, upper 52.46 m2 (README 52.5 m2) at 2.219 m above its floor (the outline's flat ceiling and raised field, replacing R66's 2.2 m), both the area means of the outline's ceiling regions; walls 260.48 m2 at their measured heights (97.39 m of wall, the screen wall at its arc) and 1.0 m2 over the 2.375 m arch; openings as measured (README, Openings): two windows 2.26 x 2.072 and 2.23 x 2.079 m, the glazed entrance screen 2.72 x 2.46 m (taken as glass, EST), five doors 11.38 m2; no curtain at the arch (#442); the lift's upper landing left out; materials EST: oak boards on joists, plaster-on-lath ceilings under the timber floors above, plaster walls",
  };
}

/**
 * The Reception Room's L, as data/room-geometries.ts traces it from the floor
 * plan (a 9.6 x 7.0 m arm and a 7.3 x 5.0 m arm, 12 m deep), scaled evenly to
 * the surveyed 100 m2 (EST: the survey gives the area, not the arms, so the
 * perimeter, and with it the wall area, comes from the trace's proportions).
 */
const RECEPTION_TRACE = { wide: [9.6, 7.0], narrow: [7.3, 5.0] } as const;
const RECEPTION_AREA_M2 = 100;
/**
 * Measured: the area mean of the survey mesh's ceiling over the L as the
 * survey measures it (upward rays on a 0.2 m grid): 3.11 m over the window
 * part and 2.60 m over the inner part, where the survey reads 3.09-3.14 m,
 * 2.80-2.84 m over the inner field and 2.42-2.53 m at the bulkheads. The
 * published 3.2 m is the window part's.
 */
const RECEPTION_MEAN_CEILING_M = 2.89;
const RECEPTION_SCALE = Math.sqrt(
  RECEPTION_AREA_M2 /
    (RECEPTION_TRACE.wide[0] * RECEPTION_TRACE.wide[1] + RECEPTION_TRACE.narrow[0] * RECEPTION_TRACE.narrow[1]),
);

/**
 * Reception Room: an L of 100 m2 under a 2.89 m mean coved ceiling. Its walls
 * and ceiling are taken as plasterboard (EST: the room was built in 2009, "a
 * new reception room installed at ground level", Urban Realm, 31 Aug 2009),
 * its floor as timber on a ground-floor slab (EST). The four windows are
 * 1.2 x 2.4 m with sheers and velour drapes (EST: the survey counts four and
 * sees both, and sizes none).
 */
function receptionRoom(): RoomAcoustics {
  // An L's perimeter is its bounding rectangle's.
  const perimeter =
    2 * (RECEPTION_TRACE.wide[0] + RECEPTION_TRACE.wide[1] + RECEPTION_TRACE.narrow[1]) * RECEPTION_SCALE;
  const windows = 4 * 1.2 * 2.4;
  const glazedDoors = 2 * HOUSE_DOOR_M2;
  return {
    slug: "reception-room",
    volumeM3: RECEPTION_AREA_M2 * RECEPTION_MEAN_CEILING_M,
    surfaces: [
      surface("timber-on-slab", RECEPTION_AREA_M2, "floor"),
      surface("plasterboard-studs", RECEPTION_AREA_M2, "ceiling"),
      surface("plasterboard-studs", perimeter * RECEPTION_MEAN_CEILING_M - windows - glazedDoors, "wall"),
      surface("sash-glazing", windows, "opening"),
      // The glazed doors are taken as glass (EST: the survey calls them glazed
      // but gives no split of glass and frame; glass is most of their face).
      surface("sash-glazing", glazedDoors, "opening"),
      surface("sheer-curtain", 4 * 2.4 * 2.4, "wall"),
      surface("velour-drape", 4 * 2 * 1.2 * 2.6, "wall"),
    ],
    calibration: TRACER_CALIBRATION["reception-room"],
    source:
      "survey: an L of 100 m2 (measured; its arms from the room-geometries.ts trace, scaled, EST) under a 2.89 m mean ceiling (measured, the mesh's area mean); EST: plasterboard walls and ceiling, timber on a slab, four 1.2 x 2.4 m windows with sheers and velour drapes, two glazed doors of 1.6 x 2.6 m",
  };
}

/**
 * A gallery: 11.5 x 4.1 x 2.8 m, carpeted; two sashes, a three-light front
 * window, one door. The size is measured on the XGRIDS scans (11.4-11.5 x
 * 4.08-4.12 m, the ceiling slab about 2.8 m above the floor slab; the
 * published 2.1 m height conflicts with it). The walls and ceiling are taken
 * as plasterboard on studs (EST, ruling R13): the galleries are the 2003
 * attic fit-out, "two new meeting rooms on the previously disused top floor"
 * (Craftsman, Spring 2003), and plaster on masonry gave an implausible 2.45 s
 * at 125 Hz. The windows' sizes are EST: the 2010 plan draws two windows on
 * the outer wall and a three-light front window, and sizes none.
 */
function gallery(slug: "north-gallery" | "south-gallery"): RoomAcoustics {
  const length = 11.5;
  const width = 4.1;
  const height = 2.8;
  const windows = 2 * 1.0 * 1.6 + 2.0 * 1.6;
  const door = HOUSE_DOOR_M2;
  return {
    slug,
    volumeM3: length * width * height,
    surfaces: [
      surface("carpet-on-underlay", length * width, "floor"),
      surface("plasterboard-studs", length * width, "ceiling"),
      surface("plasterboard-studs", 2 * (length + width) * height - windows - door, "wall"),
      surface("sash-glazing", windows, "opening"),
      surface("timber-door", door, "opening"),
    ],
    calibration: TRACER_CALIBRATION[slug],
    source:
      "XGRIDS scans: 11.5 x 4.1 x 2.8 m (measured); plasterboard walls and ceiling of the 2003 attic fit-out (EST); EST: two 1.0 x 1.6 m sashes and a 2.0 x 1.6 m front window, one door of 1.6 x 2.6 m",
  };
}

export const ROOM_ACOUSTICS: Readonly<Record<RoomSlug, RoomAcoustics>> = {
  "grand-hall": grandHall(),
  saloon: saloon(),
  "robert-adam-room": robertAdamRoom(),
  "reception-room": receptionRoom(),
  "north-gallery": gallery("north-gallery"),
  "south-gallery": gallery("south-gallery"),
};

/**
 * Where each room's reference layout is set out: the whole floor, or for the
 * two-part rooms their main part (the Robert Adam Room's lower section in
 * front of its shoulders, the Reception Room's wide arm). The Robert Adam
 * Room's is the published 11.2 x 7.6 m, which T-662 measures as 11.19 x 7.64 m
 * (#442, its README's "Lower section, width" and "depth"); the 3-4 cm moves no
 * reference chair out of the room.
 */
export const ROOM_PLANS: Readonly<Record<RoomSlug, RoomPlan>> = {
  "grand-hall": { lengthM: HALL_LENGTH, widthM: HALL_WIDTH },
  saloon: { lengthM: 11.8, widthM: 7.1 },
  "robert-adam-room": { lengthM: 11.2, widthM: 7.6 },
  "reception-room": {
    lengthM: RECEPTION_TRACE.wide[0] * RECEPTION_SCALE,
    widthM: RECEPTION_TRACE.wide[1] * RECEPTION_SCALE,
  },
  "north-gallery": { lengthM: 11.5, widthM: 4.1 },
  "south-gallery": { lengthM: 11.5, widthM: 4.1 },
};

/** Whether `slug` is one of the surveyed rooms. */
export function isRoomSlug(slug: string): slug is RoomSlug {
  return Object.prototype.hasOwnProperty.call(ROOM_ACOUSTICS, slug);
}

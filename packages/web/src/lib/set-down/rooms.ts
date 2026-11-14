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
 * retraced on 13 Nov 2026 after ruling R49's changes to the rooms, with seeds 1
 * and 2 (200,000 rays a band; 2,000,000 in the galleries, which share one
 * trace), and run twice to the same bytes. The tracer draws each room as a box
 * with the model's volume and surface areas, so the factors correct Eyring's
 * diffuse-field assumption on those boxes; they are not fitted to the rooms'
 * outlines. The 125 Hz factor is 1 wherever the room's Schroeder frequency is
 * above that octave's lower edge, where rays say nothing about a modal
 * response (ruling R39): every room but the Grand Hall. The Robert Adam
 * Room's 250 and 500 Hz factors (1.261, 1.156) are kept (ruling R59): its
 * absorption sits on the floor and ceiling between hard walls, and Fitzroy's
 * formula for uneven absorption, independent of the tracer, puts those bands
 * at 1.365 and 1.086 x Eyring (README.md, "What stays uncertain"). The
 * galleries' 1-8 kHz bands sit at the clamp: their tracer reads 1.35-1.57 x
 * Eyring there, an upper bound for an unsurveyed attic section (README.md,
 * "Difference explained"). After any change to a room's surfaces, export,
 * retrace and refit; the tests fail until rooms.json, results.json and these
 * agree.
 */
const TRACER_CALIBRATION: Readonly<Record<RoomSlug, BandValues>> = {
  "grand-hall": [1.067, 1.038, 1.023, 1.009, 1.008, 1.007, 1.006],
  saloon: [1, 1.024, 1.019, 1.012, 1.01, 1.006, 1.006],
  "robert-adam-room": [1, 1.261, 1.156, 1.062, 1.049, 1.042, 1.026],
  "reception-room": [1, 1.009, 1, 0.992, 0.991, 0.989, 0.987],
  "north-gallery": [1, 1.068, 1.198, 1.3, 1.3, 1.3, 1.3],
  "south-gallery": [1, 1.068, 1.198, 1.3, 1.3, 1.3, 1.3],
};

/**
 * A door outside the Grand Hall, 1.6 x 2.6 m (EST): no source sizes the other
 * rooms' doors (the survey sees double doors in most of them); the figure is
 * a pair of leaves somewhat larger than the Grand Hall's scanned doorways
 * (1.06-1.45 m wide, hall-spec.ts). A door is a few m2 of a room's hundreds,
 * so the error is small.
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

/**
 * Robert Adam Room: a lower section of 11.2 x 7.6 m under a 3.03 m mean
 * ceiling, open to an upper section of 9.8 x 5.6 x 2.2 m.
 * - Lower section: 11.2 m measured and published; 7.6 m published (85.1 m2).
 *   The survey's mesh runs up to 8.9 m deep to the facade's inner face, piers
 *   and window bays included, and does not reconcile that with 7.6 m (EST,
 *   the published figure). Ceiling 3.03 m: measured, the area mean of the
 *   survey mesh's ceiling (upward rays on a 0.2 m grid): 57-59 % of the plan
 *   is domed bays at 3.18 m, the rest under beams and arches at 2.81 m, where
 *   the survey reads 3.20 and 2.80 m.
 * - Upper section: 9.8 x 5.6 m measured. Its ceiling is kept at 2.2 m (ruling
 *   R66): the survey measures its flat ceiling at 2.15-2.29 m, which takes in
 *   the published 2.18 m. The survey mesh's area mean over the section's
 *   outline is 2.303 m (upward rays on a 0.2 m grid), but its 95th percentile
 *   is 2.98 m: some higher parts inside the outline, which the survey does not
 *   identify, pull the mean up. Taking 2.303 m instead would add about 5.7 m3,
 *   1.5 % of the room's 379 m3.
 * - Both ceilings are plaster on lath (EST: no source gives their
 *   construction). The survey puts the lower section under the south end of
 *   the Grand Hall and the upper under the Saloon. Their floors are at Z -3.57
 *   and -2.98 m, so each ceiling sits 0.4-0.8 m under a first-floor timber
 *   floor at Z 0: the Grand Hall's oak boards on joists and the Saloon's
 *   parquet on a timber subfloor, as this file has them. A ceiling with a void
 *   takes the lath row, not solid plaster.
 * - The upper section's whole 5.6 x 2.2 m end is taken as open to the lower
 *   one (EST: the survey sees the two joined by four steps and a curtained
 *   arch, but does not size the arch), so neither side has a wall there.
 * - The three street windows are 1.6 x 2.0 m sashes (EST: the survey counts
 *   three bays, partly obscured glazing, and sizes none). The curtain at the
 *   arch is 2 x 2.2 m of velour (EST) and the two doors are the house's.
 */
function robertAdamRoom(): RoomAcoustics {
  const lower = { length: 11.2, width: 7.6, height: 3.03 };
  const upper = { length: 9.8, width: 5.6, height: 2.2 }; // the measured flat ceiling (R66), not the mesh's 2.303 m mean
  const opening = upper.width * upper.height;
  const lowerWall = 2 * (lower.length + lower.width) * lower.height - opening;
  const upperWall = (2 * upper.length + upper.width) * upper.height;
  const windows = 3 * 1.6 * 2.0;
  const doors = 2 * HOUSE_DOOR_M2;
  const plan = lower.length * lower.width + upper.length * upper.width;
  return {
    slug: "robert-adam-room",
    volumeM3: lower.length * lower.width * lower.height + upper.length * upper.width * upper.height,
    surfaces: [
      surface("oak-boards-joists", plan, "floor"),
      surface("plaster-lath", plan, "ceiling"),
      surface("plaster-masonry", lowerWall + upperWall - windows - doors, "wall"),
      surface("sash-glazing", windows, "opening"),
      surface("timber-door", doors, "opening"),
      surface("velour-drape", 2 * 2.2, "wall"),
    ],
    calibration: TRACER_CALIBRATION["robert-adam-room"],
    source:
      "survey: lower 11.2 m (measured) x 7.6 m (published) under a 3.03 m mean ceiling (measured, the mesh's area mean), open to an upper 9.8 x 5.6 m (measured) x 2.2 m (the measured 2.15-2.29 m flat ceiling; the mesh's area mean is 2.303 m, R66); ceilings plaster on lath under the timber floors above (EST); EST: three 1.6 x 2.0 m windows, a 2 x 2.2 m velour curtain at the arch, two doors of 1.6 x 2.6 m",
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
 * two-part rooms their main part (the Robert Adam Room's lower section, the
 * Reception Room's wide arm).
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

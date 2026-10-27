// ---------------------------------------------------------------------------
// The surveyed volume and surfaces of each Trades Hall room, for its echo
// (T-677).
//
// Each room's areas are worked out here from its named source, so a later
// survey edits one place. Absorption per material comes from acoustic-data.ts;
// room-acoustics.ts turns these surfaces into reverberation times. Rooms are
// laid out about their own centre: x along the length, z across the width,
// as hall-spec.ts frames the Grand Hall.
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
 * A door the survey has not sized is taken as the Saloon's, 1.6 x 2.6 m (EST):
 * it is the only door the plan measures, and the house's doors are pairs of
 * that order. A door is a few m2 of a room's hundreds, so the error is small.
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
 * sets it: 31 m2 of velour, and 2.53 s at 1 kHz in the empty hall, inside the
 * plan's 2.0-2.6 s. (Before the dome was integrated from the scan, its EST
 * volume put the hall over 2.6 s and this was raised to 1.05 m; with the
 * scanned dome, widths from 0.9 to about 1.23 m pass, so the plan's figure
 * stands. The research estimate assumed 45 m2.)
 */
const CURTAIN_WIDTH_M = 0.9;

/** The clear area of an opening; an arched window adds its semicircular head. */
function openingArea(opening: HallOpening): number {
  const square = opening.width * (opening.head - opening.sill);
  if (opening.kind !== "arched-window") return square;
  const radius = opening.width / 2;
  return square + (Math.PI * radius * radius) / 2;
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
  const openingWidths = HALL_OPENINGS.reduce((sum, opening) => sum + opening.width, 0);
  const dado = (perimeter - openingWidths) * DADO_BAND_M;
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
      surface("plaster-masonry", dome.surfaceM2, "ceiling"),
      surface("hardwood-panelling", dado, "wall"),
      surface("hardwood-panelling", upperWall / 2, "wall"),
      surface("plaster-masonry", upperWall / 2, "wall"),
      surface("sash-glazing", glazing, "opening"),
      surface("timber-door", doorArea, "opening"),
      surface("velour-drape", curtains, "wall"),
    ],
    calibration: UNCALIBRATED,
    source:
      "hall-spec.ts (scan of 11 July 2026): plan, ceiling, HALL_OPENINGS windows and HALL_DOORS doors; the scanned dome (HALL_DOME, domeHeightAt), integrated; dado to the scanned 1.95 m cap rail; curtains 2 x 0.9 m a window (EST)",
  };
}

// ---------------------------------------------------------------------------
// The other rooms, from the survey facts in the T-677 plan
// ---------------------------------------------------------------------------

/** Saloon: 11.8 x 7.1 m, ceiling 5.7 m; three leaded windows, marble, one door. */
function saloon(): RoomAcoustics {
  const length = 11.8;
  const width = 7.1;
  const height = 5.7;
  const windows = 3 * 2.0 * 3.5;
  const marble = 2;
  const door = 1.6 * 2.6;
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
    calibration: UNCALIBRATED,
    source:
      "survey: 11.8 x 7.1 x 5.7 m; walls 70 % panelling; three 2.0 x 3.5 m leaded windows; marble 2 m2; one 1.6 x 2.6 m door",
  };
}

/**
 * Robert Adam Room: a lower section of 11.2 x 7.6 x 2.9 m open to an upper
 * section of 9.8 x 5.6 x 2.2 m. The upper section's whole 5.6 x 2.2 m end is
 * taken as open to the lower one (EST: the survey says the two are open to
 * each other and hangs a curtain at the arch, but does not size the arch), so
 * neither side has a wall there. The windows are taken as sashes (EST: the
 * survey gives their size, not their glazing, and the house's windows are
 * sashes).
 */
function robertAdamRoom(): RoomAcoustics {
  const lower = { length: 11.2, width: 7.6, height: 2.9 };
  const upper = { length: 9.8, width: 5.6, height: 2.2 };
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
      surface("plaster-masonry", plan, "ceiling"),
      surface("plaster-masonry", lowerWall + upperWall - windows - doors, "wall"),
      surface("sash-glazing", windows, "opening"),
      surface("timber-door", doors, "opening"),
      surface("velour-drape", 2 * 2.2, "wall"),
    ],
    calibration: UNCALIBRATED,
    source:
      "survey: 11.2 x 7.6 x 2.9 m open to 9.8 x 5.6 x 2.2 m; three 1.6 x 2.0 m windows; a 2 x 2.2 m velour curtain at the arch; two doors of 1.6 x 2.6 m (EST)",
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
const RECEPTION_MEAN_CEILING_M = 2.8;
const RECEPTION_SCALE = Math.sqrt(
  RECEPTION_AREA_M2 /
    (RECEPTION_TRACE.wide[0] * RECEPTION_TRACE.wide[1] + RECEPTION_TRACE.narrow[0] * RECEPTION_TRACE.narrow[1]),
);

/** Reception Room: an L of 100 m2 under a 2.8 m mean coved ceiling. */
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
    calibration: UNCALIBRATED,
    source:
      "survey: an L of 100 m2 (the room-geometries.ts trace, scaled), 2.8 m mean ceiling; four 1.2 x 2.4 m windows with sheers and velour drapes; two glazed doors of 1.6 x 2.6 m (EST)",
  };
}

/**
 * A gallery: 11.5 x 4.1 x 2.8 m, carpeted; two sashes, a three-light front
 * window, one door. The walls and ceiling are taken as plasterboard on studs
 * (EST, ruling R13): the galleries are the 2003 attic fit-out, "two new
 * meeting rooms on the previously disused top floor" (Craftsman, 2003), and
 * plaster on masonry gave an implausible 2.45 s at 125 Hz.
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
    calibration: UNCALIBRATED,
    source:
      "survey: 11.5 x 4.1 x 2.8 m; plasterboard walls and ceiling of the 2003 attic fit-out (EST); two 1.0 x 1.6 m sashes and a 2.0 x 1.6 m front window; one door of 1.6 x 2.6 m (EST)",
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

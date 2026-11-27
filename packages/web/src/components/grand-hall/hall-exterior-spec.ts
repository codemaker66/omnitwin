// ---------------------------------------------------------------------------
// Trades Hall's Glassford Street front, as measured
//
// Robert Adam's front of 1791-94: a channelled ground floor under a tall
// principal floor, seven parts in a symmetrical row (end bay, a raised
// Venetian-window pavilion, a recessed link with a pedimented window, the
// temple front with four coupled Ionic columns under a pediment, then the
// same again), balustrades and attics over them, and over the centre a
// rosette attic, the sculpted arms and the green copper dome on its drum.
//
// Sources, as each value's note says:
//   L     the Scottish LiDAR Phase 5 50 cm DSM (2020; Crown copyright Scottish
//         Government and Fugro, OGL v3.0): heights, the front's line, the dome
//   P     reference photographs read at a scale fitted to the LiDAR heights
//         (the photographs are references only: no pixel of them is used)
//   room  the hall's own survey (hall-spec.ts): the five windows and the
//         window wall's outer face, to which the front is anchored
//   I     inferred from construction or typology where nothing shows it
// The specification and its derivation: D:/claude/orbit-lookdev-20260923/
// spec/facade (facade.json, build_facade_spec.py, elevation.png), checked
// against the 2010 first-floor plan and the hall's survey for this model
// (T-681, D:/claude/th-facade-20261028).
//
// Frame: the front's own. `u` runs along the front toward grid north (the
// viewer's right, standing in Garth Street looking at the door), from the
// building's axis; `z` is metres above the pavement at the front's foot;
// depth is "proud": metres out from the window wall's outer face, toward the
// street. The planner's frame turns this round: x = axis − u, y = z + the
// pavement's height, z = the wall's outer face − proud (hall-exterior.ts).
// ---------------------------------------------------------------------------

import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_OPENINGS, HALL_WALL_THICKNESS } from "./hall-spec.js";
import { HALL_PAVEMENT_Y } from "./hall-site.js";

const CENTRE_WINDOW = HALL_OPENINGS.find((opening) => opening.id === "arch-centre");

/**
 * The planner's x of the building's axis: the centre window's centre (room).
 * An opening's `centre` runs along its wall from the wall's origin, and the
 * window wall's origin is x = −HALL_HALF_LENGTH.
 */
export const FRONT_AXIS_X = CENTRE_WINDOW === undefined ? 0 : -HALL_HALF_LENGTH + CENTRE_WINDOW.centre;

/** The planner's z of the window wall's outer face (room: the hall's half width and the wall's 0.95 m). */
export const FRONT_FACE_Z = -(HALL_HALF_WIDTH + HALL_WALL_THICKNESS.window.thickness);

/** The pavement at the front's foot, planner y. */
export const FRONT_PAVEMENT_Y = HALL_PAVEMENT_Y;

/** Half the frontage: 30.60 m end to end (LP: the photographs' width at the LiDAR scale, mirror-averaged). */
export const FRONT_HALF_WIDTH = 15.298;

/** How far behind the outer face the ground floor's wall reaches under the hall (room: the window wall's thickness). */
export const GROUND_WALL_DEPTH = HALL_WALL_THICKNESS.window.thickness;

/** How thick the front's walls are where no surveyed wall stands behind them (I: the window wall's own). */
export const FREE_WALL_DEPTH = HALL_WALL_THICKNESS.window.thickness;

export type BayKind = "end-bay" | "pavilion" | "link" | "temple";

export interface FrontBay {
  readonly id: string;
  readonly kind: BayKind;
  readonly uMin: number;
  readonly uMax: number;
  /** Metres the bay's wall face stands out from the window wall's outer face. */
  readonly proud: number;
  /** Top of the bay's own masonry (balustrade, parapet or attic), above the pavement. */
  readonly top: number;
}

/**
 * The front's faces in plan, measured by the hall's own scan (scan: the E57
 * IS the planner's frame; it ranges out through the arched windows' lower
 * lights and the open front door: D:/claude/th-facade-20261028/registration/
 * registration.json, measured_faces_e57). The temple front's back wall, and
 * the links in its plane (LP), stand 0.067 m out from the window wall's
 * modelled face (the centre window's outer reveal ends at planner z −6.312,
 * sweep 39). The pavilions stand 0.295 m forward of them (their Venetian
 * windows' outer reveals end at z −6.607, sweeps 40 and 42; the DSM's roof
 * edges step 0.30 m, L). The end bays stand 0.18 m forward of the links (L:
 * the DSM's roof edges; the scan cannot see them). The 2010 plan's front
 * lines put the steps at 0.053-0.106 m and are not followed: its portico line
 * matches the scan to 0.03 m, its bays do not.
 */
export const LINK_FACE_PROUD = 0.067;
const PAVILION_STEP = 0.295;
/**
 * The end bays' steps over the links from the DSM's roof edges (L: +0.235 m
 * south, +0.125 m north). The two are not in one plane: the 2010 plan also
 * draws the north end bay set back from the south one (by 0.20 m).
 */
const END_BAY_STEP_SOUTH = 0.235;
const END_BAY_STEP_NORTH = 0.125;

/**
 * The seven parts, south to north (P: the photographs' widths, which the
 * plan's breaks match to 0.02-0.08 m), their faces as the scan and the DSM
 * measure them.
 */
export const FRONT_BAYS: readonly FrontBay[] = [
  { id: "end-bay-south", kind: "end-bay", uMin: -15.298, uMax: -11.652, proud: LINK_FACE_PROUD + END_BAY_STEP_SOUTH, top: 12.018 },
  { id: "pavilion-south", kind: "pavilion", uMin: -11.652, uMax: -6.366, proud: LINK_FACE_PROUD + PAVILION_STEP, top: 14.949 },
  { id: "link-south", kind: "link", uMin: -6.366, uMax: -3.486, proud: LINK_FACE_PROUD, top: 14.105 },
  { id: "temple-front", kind: "temple", uMin: -3.486, uMax: 3.486, proud: LINK_FACE_PROUD, top: 14.689 },
  { id: "link-north", kind: "link", uMin: 3.486, uMax: 6.366, proud: LINK_FACE_PROUD, top: 14.105 },
  { id: "pavilion-north", kind: "pavilion", uMin: 6.366, uMax: 11.652, proud: LINK_FACE_PROUD + PAVILION_STEP, top: 14.949 },
  { id: "end-bay-north", kind: "end-bay", uMin: 11.652, uMax: 15.298, proud: LINK_FACE_PROUD + END_BAY_STEP_NORTH, top: 12.018 },
];

/** The ground floor and the main levels, metres above the pavement. */
export const FRONT_LEVELS = {
  /** Top of the plinth (P). */
  plinthTop: 0.63,
  /** How far the plinth stands out from the rustication (I). */
  plinthProud: 0.05,
  /** The channelled ground floor: 12 courses of 0.317 m (P) from the plinth to the string course. */
  courses: 12,
  courseHeight: 0.317,
  /** The channels' width and depth (I: a typical V-channel of the 1790s). */
  channelWidth: 0.04,
  channelDepth: 0.025,
  /**
   * The string course over the rustication (P: from 4.429 m). The principal
   * floor's windows stand on it: the hall's sills are 4.705 m over the
   * pavement (room) and the end bays' 4.657 m (P), so it ends just under
   * them; the 4.827 m the photographs give for it is the temple front's
   * podium top (TEMPLE.podiumTop), which the centre window's balcony sits on.
   */
  stringBottom: 4.429,
  stringTop: 4.62,
  stringProud: 0.12,
  /** The principal floor's window sills (P). */
  sill: 4.681,
  /** The main entablature (P; its top LP): architrave, frieze, cornice. */
  architraveBottom: 10.154,
  friezeBottom: 10.235,
  friezeTop: 10.771,
  corniceTop: 10.94,
  /** The main cornice's projection (I: as deep as it is tall). */
  corniceProjection: 0.4,
} as const;

/** A ground-floor opening: shopfront, doorway or the front door. */
export interface GroundOpening {
  readonly u: number;
  readonly width: number;
  readonly bottom: number;
  /** Top of the opening's square part: a shopfront's head, a door's transom. */
  readonly top: number;
  readonly head: "flat" | "segmental" | "round";
  /** The arch's crown over its springing (round: half the width; flat: 0). */
  readonly rise: number;
  /** The voussoirs' ring: how wide it is outside the opening, and how many stones. */
  readonly ringWidth: number;
  readonly voussoirs: number;
  readonly fill: "shopfront" | "doorway" | "front-door";
}

const mirrored = <T extends { readonly u: number }>(north: T): readonly [T, T] => [{ ...north, u: -north.u }, north];

/**
 * The seven ground-floor openings (P). The end bays and links have modern
 * shopfronts (three lights over panelled stall risers) under flat arches of
 * splayed voussoirs, flush, with no raised keystone (the photographs' audit:
 * the links' arches are flat too, extrados and intrados); the pavilions have
 * arched doorways with fanlights; the centre the front door in its moulded
 * arch of 11 voussoirs. A flat arch's `ringWidth` is how far its top stands
 * out past the opening each side (3.327 m and 2.541 m wide at their tops).
 */
export const GROUND_OPENINGS: readonly GroundOpening[] = [
  ...mirrored({ u: 13.453, width: 2.39, bottom: 0.07, top: 3.072, head: "flat", rise: 0, ringWidth: 0.469, voussoirs: 9, fill: "shopfront" } as const),
  ...mirrored({ u: 9.034, width: 2.85, bottom: 0.05, top: 3.025, head: "round", rise: 0.761, ringWidth: 0.55, voussoirs: 11, fill: "doorway" } as const),
  ...mirrored({ u: 4.946, width: 2.379, bottom: 0.07, top: 3.061, head: "flat", rise: 0, ringWidth: 0.081, voussoirs: 9, fill: "shopfront" } as const),
  { u: 0, width: 1.743, bottom: 0.08, top: 2.648, head: "round", rise: 0.718, ringWidth: 0.88, voussoirs: 11, fill: "front-door" },
];

/** How far back the pavilions' doors stand in their openings (scan: the south pavilion's leaves at planner z −6.467). */
export const DOORWAY_SETBACK = 0.165;

/** The front door's surround (P): its moulded arch, keystone plaque and bracket lamps. */
export const FRONT_DOOR = {
  archOuterWidth: 2.82,
  archCrownOuter: 3.707,
  archBand: 0.538,
  plaqueZ: 3.732,
  plaqueDiameter: 0.384,
  lampU: 2.461,
  lampBottom: 2.904,
  lampTop: 3.494,
  lampWidth: 0.256,
} as const;

/**
 * The temple front, proud of the window wall: the podium's face from the scan
 * (the front door's reveal ends at planner z −7.200, sweep 145), the columns'
 * axes from the plan (its four column circles at z −6.836, 0.59 m across; its
 * portico line agrees with the scan's podium face to 0.03 m), the entablature
 * on the columns' upper face (I) and the pediment's cornice a cornice's
 * overhang beyond it (I: the DSM's lip stands 1.2 m past the podium's face,
 * the LiDAR's shadow in front of a front facing away from the aircraft).
 */
export const TEMPLE = {
  halfWidth: 3.486,
  /** The channelled podium under the columns, to its top (P), and its face (scan). */
  podiumTop: 4.827,
  podiumProud: 0.955,
  /** The podium's top member stands out over it as the centre window's balcony (scan: its outermost at z −7.4). */
  podiumTopProud: 0.2,
  /**
   * Four Ionic columns in two coupled pairs (P: axes along the front, mirror-
   * averaged; two readings of the frontal photograph agree), their axes'
   * depth (plan), diameters and heights (P). The plan draws the pairs 0.845 m
   * apart and their group 0.105 m off the podium's centre, which the
   * photograph does not show; the photograph's symmetric axes are kept.
   */
  columnU: [-3.063, -2.148, 2.148, 3.063],
  /**
   * Plain pilaster responds on the back wall behind each pair (P, an oblique
   * view; plan: 0.652 m wide, their face 0.30 m out from the plan's own wall
   * line at planner z −6.165, so at z −6.465, clear of the columns' backs).
   */
  respondHalfWidth: 0.326,
  respondProud: 0.22,
  columnAxisProud: 0.591,
  columnBottom: 4.833,
  columnTop: 10.13,
  diameterLower: 0.627,
  diameterUpper: 0.549,
  baseHeight: 0.314,
  capitalHeight: 0.575,
  /** The entablature over the columns (P), its face (I) and the pediment (LP: apex 12.38 m). */
  entablatureHalfWidth: 3.641,
  entablatureBottom: 10.13,
  entablatureArchitraveTop: 10.38,
  entablatureFriezeTop: 10.87,
  entablatureTop: 11.091,
  entablatureProud: 0.591 + 0.549 / 2 + 0.02,
  pedimentHalfWidth: 3.677,
  pedimentApex: 12.376,
  pedimentCorniceProud: 0.591 + 0.549 / 2 + 0.02 + 0.25,
  rakingCorniceDepth: 0.3,
  /** The attic over the centre with its band of 13 octagonal rosette panels (P; top LP). */
  atticHalfWidth: 3.716,
  atticBottom: 12.9,
  atticBaseTop: 13.332,
  rosetteBottom: 13.602,
  rosetteTop: 14.143,
  rosetteCount: 13,
  rosettePitch: 0.522,
  rosetteOctagon: 0.487,
  rosetteDiameter: 0.284,
  atticCorniceBottom: 14.44,
  atticTop: 14.689,
} as const;

/**
 * The hall's own five windows in the front: Venetian windows in the
 * pavilions and the temple front, pedimented sashes in the links. Their
 * openings are the room's (hall-spec.ts HALL_OPENINGS, the survey, to about
 * 2 cm), so the front's openings and the hall's glazing are one; their
 * surrounds are the photographs' (P).
 */
export const PRINCIPAL_WINDOWS = {
  venetian: {
    outerWidth: 2.87,
    springing: 7.61,
    crown: 9.05,
    sideLight: 0.37,
    colonnette: 0.335,
    sideEntablatureBottom: 7.07,
    sideEntablatureTop: 7.6,
    /** The arched recess round the window (I: the arch's band, as the fanlight's ring). */
    recessBand: 0.18,
  },
  pedimented: {
    /**
     * The sashes' openings in the front are narrower than inside, where their
     * reveals splay out to the room's 1.43 m (plan: the outer opening line
     * 1.212 m; P: the glass 1.203 m), inside an architrave 1.58 m across (P).
     */
    exteriorWidth: 1.212,
    architraveWidth: 1.58,
    glassTop: 7.129,
    consoleBottom: 6.845,
    consoleTop: 7.602,
    consoleWidth: 0.2,
    pedimentWidth: 2.249,
    pedimentBase: 7.675,
    pedimentApex: 8.259,
    /** The griffin-and-urn panel over it (P). */
    panelWidth: 2.135,
    panelBottom: 8.724,
    panelTop: 9.434,
  },
} as const;

/** The end bays' upper windows (P): a corniced window on consoles under a square mezzanine window. */
export const END_BAY_WINDOWS = {
  u: 13.4,
  architraveWidth: 1.626,
  glassWidth: 1.124,
  glassTop: 7.015,
  architraveTop: 7.203,
  consoleBottom: 6.712,
  consoleTop: 7.56,
  corniceWidth: 2.353,
  corniceBottom: 7.538,
  corniceTop: 7.78,
  mezzanineFrameWidth: 1.443,
  mezzanineGlassWidth: 1.027,
  mezzanineFrameBottom: 8.236,
  mezzanineFrameTop: 9.604,
  mezzanineGlassBottom: 8.472,
  mezzanineGlassTop: 9.398,
} as const;

/**
 * The balustrades over the end bays and links, and the pavilions' parapets
 * (P; tops LP). The pavilions' baluster groups are blind, engaged against
 * sunk panels of a solid parapet, 3, 8 and 3 at 0.148 m (the photographs'
 * audit: no sky shows through them where it does through the links').
 */
export const BALUSTRADES = {
  endBay: { bottom: 10.94, top: 12.018, balusters: 13 },
  link: { bottom: 12.9, top: 14.105, balusters: 9 },
  /** The links' attic window and upper cornice under their balustrade (P). */
  linkAttic: { windowBottom: 11.467, windowTop: 12.386, windowWidth: 1.189, corniceBottom: 12.7, corniceTop: 12.9 },
  /** The pavilions' attic storey and parapet (P): three windows, top cornice, three groups of balusters. */
  pavilionAttic: {
    windowBottom: 11.621,
    windowTop: 12.902,
    centreWidth: 1.164,
    sideU: 1.121,
    sideWidth: 0.387,
    corniceBottom: 13.623,
    corniceTop: 13.91,
    parapetPlinthTop: 14.29,
    copingBottom: 14.824,
    top: 14.949,
    groups: [{ du: -1.121, balusters: 3 }, { du: 0, balusters: 8 }, { du: 1.121, balusters: 3 }],
    pitch: 0.148,
  },
  /** The paterae in the pavilions' frieze (P). */
  pavilionPaterae: { du: [-2.106, -0.767, 0.768, 2.106], z: 10.449, diameter: 0.335 },
} as const;

/**
 * Four rainwater pipes the front's full height, in the links' corners at the
 * pavilions and at the temple front (P: the photographs' audit, three
 * photographs agree on them; their exact u to about 0.1 m).
 */
export const DOWNPIPES = {
  u: [-6.25, -3.6, 3.6, 6.25],
  radius: 0.05,
  proud: LINK_FACE_PROUD + 0.08,
  top: 10.154,
} as const;

/**
 * The sculpted arms on the attic (P, descriptive: a massing, not a likeness;
 * their depth L, measured in the DSM against the attic's own edge, 0.14 m
 * and 1.45 m behind it, so the LiDAR's shadow on this front cancels).
 */
export const SCULPTURE = {
  halfWidth: 1.679,
  frontProud: LINK_FACE_PROUD - 0.14,
  backProud: LINK_FACE_PROUD - 1.451,
  pedestalTop: 15.386,
  cartoucheWidth: 0.839,
  cartoucheBottom: 15.685,
  cartoucheTop: 16.664,
  finialTop: 17.246,
  figureHeadLeft: 16.365,
  figureHeadRight: 16.505,
} as const;

/**
 * The domed drum (L: the DSM's cornice ring and crown; P: the drum's wall and
 * the dome's spring). Its centre is the DSM's contour circles' (ten levels
 * from 16.75 m to 21.25 m agree to 0.02 m; a ring's centre carries none of
 * the LiDAR's shadow) under the scan's registration: planner x −0.053, z
 * −0.447. It is not concentric with the hall's painted dome, whose axis is
 * the room's centre to 0.01 m (scan): it stands 0.44 m (±0.07) streetward.
 */
export const DOME = {
  /** Centre along the front (L) and behind the window wall's outer face (L, scan registration). */
  u: FRONT_AXIS_X + 0.053,
  behindFace: -FRONT_FACE_Z - 0.447,
  drumRadius: 3.378,
  drumCorniceRadius: 3.548,
  drumBase: 15.206,
  drumCorniceBottom: 18.851,
  drumCorniceTop: 19.16,
  domeRadius: 3.065,
  domeSpring: 18.707,
  domeCrown: 21.772,
  ribs: 24,
  lanternRadius: 0.675,
  lanternCorniceRadius: 0.802,
  lanternBase: 21.722,
  lanternCorniceBottom: 22.893,
  lanternCorniceTop: 23.246,
  cupolaTop: 24.106,
  finialTip: 24.484,
  /** The flagpole on the sculpture's pedestal (L: where it stands and its top, a lower bound; P: its width). */
  flagpoleU: 0.055,
  flagpoleBehindFace: 1.115 - LINK_FACE_PROUD,
  flagpoleBase: 15.386,
  flagpoleTop: 27.503,
  flagpoleDiameter: 0.15,
} as const;

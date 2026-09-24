/**
 * Grand Hall ornamental dressing, described as data.
 *
 * Every mesh, group and instanced block below is a transcription of the
 * ornament JSX that preceded it: same expressions, same order, same names.
 * `GrandHallOrnaments` renders this description as the per-mesh tree and bakes
 * merged draw batches from it for surfaces that are fully opaque.
 *
 *   - Crown moulding, skirting, and raised dark-timber wainscot panels
 *   - Pilasters framing the three arched windows on one long wall
 *   - Curtain-dressed arched-window facades with cool daylight panes
 *   - Ochre mural frieze, three opposite-wall double doors, and short-end focal wall cues
 *   - Avodire geometric coffer field and fourteen-trade dome ring
 *   - Three chandeliers along the 21m hall axis, with the central chandelier under the dome
 *
 * All ornaments use `meshStandardMaterial` with the project's standard
 * roughness/metalness profile — no point lights, no runtime shadows,
 * per the renderer's prebaked-lighting rule.
 */

import { DoubleSide } from "three";
import type { SurfaceKey } from "../stores/visibility-store.js";
import {
  TRIM_COLOR,
  BRASS_GOLD,
  BRONZE_DARK,
  BURGUNDY,
  CRYSTAL,
  WINDOW_GLOW,
  CEILING_COLOR,
  DOME_COLOR,
} from "../constants/colors.js";
import { DOME_RADIUS } from "./GrandHallRoom.js";
import type {
  OrnamentGeometry,
  OrnamentGroupNode,
  OrnamentInstancesNode,
  OrnamentMaterial,
  OrnamentMeshNode,
  OrnamentNode,
  Vec3,
} from "../lib/ornament-batching.js";

const AVODIRE_BEAM = "#714018";
const AVODIRE_HIGHLIGHT = "#d49a55";
const PANEL_DARK_OAK = "#4a2d16";
const PANEL_SHADOW = "#2e1b0c";
const MARBLE_WHITE = "#f2eee2";
const PORTRAIT_DARK = "#2a2119";
const CURTAIN_CREAM = "#d6bea0";
const CURTAIN_SHADOW = "#92785d";
const WINDOW_FRAME_SHADOW = "#d9cba8";
const MURAL_GOLD = "#b98532";
const MURAL_SHADOW = "#705018";
const UNDERLIGHT = "#f5d47a";
const GLASS_BLUE = "#b7d1df";
const GLASS_HIGHLIGHT = "#f4fbff";
const FIREBOX_DARK = "#120d09";
const EMBER_ORANGE = "#d86924";
const SOOT_SHADOW = "#24160f";
const DOOR_TIMBER = "#2b160c";
const DOOR_HIGHLIGHT = "#6c411d";
export const WALL_ORNAMENT_SECTION_HIDE_BELOW_M = 3.2;
export const CEILING_ORNAMENT_SECTION_EPSILON_M = 0.12;

export function shouldShowWallOrnamentsForSection(sectionHeight: number, roomHeight: number): boolean {
  const threshold = Math.max(0, Math.min(roomHeight - CEILING_ORNAMENT_SECTION_EPSILON_M, WALL_ORNAMENT_SECTION_HIDE_BELOW_M));
  return sectionHeight >= threshold;
}

export function shouldShowCeilingOrnamentsForSection(sectionHeight: number, roomHeight: number): boolean {
  return sectionHeight >= roomHeight - CEILING_ORNAMENT_SECTION_EPSILON_M;
}

// ---------------------------------------------------------------------------
// Description vocabulary
// ---------------------------------------------------------------------------

/** A `SurfaceVisibilityGroup`: faded and toggled with one room surface. */
export interface OrnamentSurface {
  readonly kind: "surface";
  readonly surfaceKey: SurfaceKey;
  readonly name: string;
  readonly children: readonly OrnamentNode[];
}

/** Named wrapper groups that hold surfaces, mirroring the component structure. */
export interface OrnamentSurfaceCluster {
  readonly kind: "cluster";
  readonly name: string;
  readonly surfaces: readonly OrnamentSurface[];
}

export type OrnamentLayer = OrnamentSurface | OrnamentSurfaceCluster;

interface MaterialExtras {
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly depthWrite?: boolean;
  readonly side?: OrnamentMaterial["side"];
}

function standard(color: string, roughness: number, metalness: number, extras: MaterialExtras = {}): OrnamentMaterial {
  return { color, roughness, metalness, ...extras };
}

function mesh(
  geometry: OrnamentGeometry,
  material: OrnamentMaterial,
  placement: { readonly name?: string; readonly position?: Vec3; readonly rotation?: Vec3; readonly exact?: boolean } = {},
): OrnamentMeshNode {
  return { kind: "mesh", geometry, material, ...placement };
}

interface Interval {
  readonly min: number;
  readonly max: number;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.min < b.max && b.min < a.max;
}

function group(
  children: readonly OrnamentNode[],
  placement: { readonly name?: string; readonly position?: Vec3; readonly rotation?: Vec3; readonly scale?: Vec3 } = {},
): OrnamentGroupNode {
  return { kind: "group", children, ...placement };
}

function surface(surfaceKey: SurfaceKey, name: string, children: readonly OrnamentNode[]): OrnamentSurface {
  return { kind: "surface", surfaceKey, name, children };
}

const box = (width: number, height: number, depth: number): OrnamentGeometry => ({ kind: "box", args: [width, height, depth] });
const sphere = (radius: number, widthSegments: number, heightSegments: number): OrnamentGeometry =>
  ({ kind: "sphere", args: [radius, widthSegments, heightSegments] });
const cylinder = (radiusTop: number, radiusBottom: number, height: number, radialSegments: number): OrnamentGeometry =>
  ({ kind: "cylinder", args: [radiusTop, radiusBottom, height, radialSegments] });
const torus = (radius: number, tube: number, radialSegments: number, tubularSegments: number): OrnamentGeometry =>
  ({ kind: "torus", args: [radius, tube, radialSegments, tubularSegments] });

// ---------------------------------------------------------------------------
// Crown moulding — slim ivory strip at the top of every wall
// ---------------------------------------------------------------------------

const CROWN_HEIGHT = 0.28;
const CROWN_DEPTH = 0.16;
const CROWN_BAND_HEIGHT = 0.06;

function crownMoulding(width: number, length: number, wallHeight: number): OrnamentSurfaceCluster {
  // Y-centre of the crown moulding row — sits tucked against the ceiling
  const yCentre = wallHeight - CROWN_HEIGHT / 2;
  // Inset slightly from the wall plane so the moulding box doesn't z-fight
  const halfW = width / 2 - CROWN_DEPTH / 2;
  const halfL = length / 2 - CROWN_DEPTH / 2;

  return {
    kind: "cluster",
    name: "crown-moulding",
    surfaces: [
      // Front + back walls (along Z) — long bar runs the room width
      ...[-halfL, halfL].map((z, i) => surface(i === 0 ? "wall-back" : "wall-front", `crown-${i === 0 ? "back" : "front"}`, [
        group([
          mesh(box(width, CROWN_HEIGHT, CROWN_DEPTH), standard(TRIM_COLOR, 0.85, 0)),
          // Gold band running along the bottom edge of the moulding
          mesh(box(width, CROWN_BAND_HEIGHT, 0.012), standard(BRASS_GOLD, 0.45, 0.3), {
            position: [0, -CROWN_HEIGHT / 2 + CROWN_BAND_HEIGHT / 2, CROWN_DEPTH / 2 + 0.001],
          }),
        ], { position: [0, yCentre, z] }),
      ])),
      // Left + right walls (along X) — long bar runs the room length
      ...[-halfW, halfW].map((x, i) => surface(i === 0 ? "wall-left" : "wall-right", `crown-${i === 0 ? "left" : "right"}`, [
        group([
          mesh(box(CROWN_DEPTH, CROWN_HEIGHT, length), standard(TRIM_COLOR, 0.85, 0)),
          mesh(box(0.012, CROWN_BAND_HEIGHT, length), standard(BRASS_GOLD, 0.45, 0.3), {
            position: [CROWN_DEPTH / 2 + 0.001, -CROWN_HEIGHT / 2 + CROWN_BAND_HEIGHT / 2, 0],
          }),
        ], { position: [x, yCentre, 0] }),
      ])),
    ],
  };
}

// ---------------------------------------------------------------------------
// Skirting — slim dark strip at the floor
// ---------------------------------------------------------------------------

const SKIRT_HEIGHT = 0.18;
const SKIRT_DEPTH = 0.06;

function skirting(width: number, length: number): OrnamentSurfaceCluster {
  const yCentre = SKIRT_HEIGHT / 2;
  const halfW = width / 2 - SKIRT_DEPTH / 2;
  const halfL = length / 2 - SKIRT_DEPTH / 2;

  return {
    kind: "cluster",
    name: "skirting",
    surfaces: [
      ...[-halfL, halfL].map((z, i) => surface(i === 0 ? "wall-back" : "wall-front", `skirt-${i === 0 ? "back" : "front"}`, [
        mesh(box(width, SKIRT_HEIGHT, SKIRT_DEPTH), standard("#3e2a14", 0.7, 0), { position: [0, yCentre, z] }),
      ])),
      ...[-halfW, halfW].map((x, i) => surface(i === 0 ? "wall-left" : "wall-right", `skirt-${i === 0 ? "left" : "right"}`, [
        mesh(box(SKIRT_DEPTH, SKIRT_HEIGHT, length), standard("#3e2a14", 0.7, 0), { position: [x, yCentre, 0] }),
      ])),
    ],
  };
}

// ---------------------------------------------------------------------------
// Raised wainscot panels — dark lower-wall timber rather than flat colour
// ---------------------------------------------------------------------------

const WAINSCOT_PANEL_HEIGHT = 1.55;
const WAINSCOT_PANEL_Y = 1.25;
export const WAINSCOT_PANEL_TOP_Y = WAINSCOT_PANEL_Y + WAINSCOT_PANEL_HEIGHT / 2;
const WAINSCOT_PANEL_INSET = 0.17;
export const WINDOW_WALL_RESERVED_BAY_HALF_WIDTH = 2.15;

export function computeWindowWallCenters(width: number): readonly number[] {
  return [-width * 0.29, 0, width * 0.29] as const;
}

export function isInWindowWallOpeningBay(x: number, width: number): boolean {
  return computeWindowWallCenters(width).some(
    (center) => Math.abs(x - center) <= WINDOW_WALL_RESERVED_BAY_HALF_WIDTH,
  );
}

const FRONT_DOOR_WIDTH = 1.42;
const FRONT_DOOR_HEIGHT = 2.62;
const FRONT_DOOR_DEPTH = 0.08;
const FRONT_DOOR_FRAME = 0.13;
const OPPOSITE_LONG_WALL_DOOR_CENTER_RATIO = 0.29;
const FRONT_WALL_CHAIR_RAIL_DOOR_CLEARANCE = FRONT_DOOR_WIDTH + FRONT_DOOR_FRAME * 3 + 0.22;

export interface ChairRailSegment {
  readonly centerX: number;
  readonly width: number;
}

export function computeOppositeLongWallDoorCenters(width: number): readonly number[] {
  return [-width * OPPOSITE_LONG_WALL_DOOR_CENTER_RATIO, 0, width * OPPOSITE_LONG_WALL_DOOR_CENTER_RATIO] as const;
}

export function computeOppositeLongWallChairRailSegments(width: number): readonly ChairRailSegment[] {
  const railHalfWidth = Math.max(0, (width - 0.65) / 2);
  const doorHalfClearance = FRONT_WALL_CHAIR_RAIL_DOOR_CLEARANCE / 2;
  const openings = computeOppositeLongWallDoorCenters(width)
    .map((centerX) => ({
      start: Math.max(-railHalfWidth, centerX - doorHalfClearance),
      end: Math.min(railHalfWidth, centerX + doorHalfClearance),
    }))
    .sort((a, b) => a.start - b.start);

  const segments: ChairRailSegment[] = [];
  let cursor = -railHalfWidth;

  for (const opening of openings) {
    const segmentWidth = opening.start - cursor;
    if (segmentWidth > 0.08) {
      segments.push({ centerX: cursor + segmentWidth / 2, width: segmentWidth });
    }
    cursor = Math.max(cursor, opening.end);
  }

  const trailingWidth = railHalfWidth - cursor;
  if (trailingWidth > 0.08) {
    segments.push({ centerX: cursor + trailingWidth / 2, width: trailingWidth });
  }

  return segments;
}

export function computeVisibleLongWainscotPanelCenters(
  _width: number,
  side: "back" | "front",
): readonly number[] {
  // The arched-window wall already carries tall window frames, curtains,
  // pilasters, and daylight panes. Dark raised panels on this wall read as
  // black blocker squares in the placeholder renderer, so keep them off the
  // window wall. The opposite long wall keeps rails and the explicit door
  // assemblies, but not repeated dark panel blocks.
  if (side === "front") return [];
  return [];
}

export function computeVisibleShortWainscotPanelCenters(
  _length: number,
  _side: "left" | "right",
): readonly number[] {
  // The short ends carry distinct architectural cues rather than repeated
  // lower-wall plaques. Keep their treatment to continuous rails and explicit
  // focal elements so the placeholder does not imply extra doors or blockers.
  return [];
}

function wainscotRaisedPanels(width: number, length: number): OrnamentSurfaceCluster {
  const halfW = width / 2;
  const halfL = length / 2;

  const backLongX = computeVisibleLongWainscotPanelCenters(width, "back");
  const frontLongX = computeVisibleLongWainscotPanelCenters(width, "front");
  const backLongChairRailSegments = [{ centerX: 0, width: width - 0.65 }] as const;
  const frontLongChairRailSegments = computeOppositeLongWallChairRailSegments(width);
  const leftShortZ = computeVisibleShortWainscotPanelCenters(length, "left");
  const rightShortZ = computeVisibleShortWainscotPanelCenters(length, "right");
  const shortPanelSpacing = length / 5;
  const longChairRailY = WAINSCOT_PANEL_Y + WAINSCOT_PANEL_HEIGHT / 2 + 0.12;

  return {
    kind: "cluster",
    name: "raised-wainscot-panels",
    surfaces: [
      ...[-halfL + WAINSCOT_PANEL_INSET, halfL - WAINSCOT_PANEL_INSET].map((z, sideIndex) => surface(
        sideIndex === 0 ? "wall-back" : "wall-front",
        `raised-wainscot-${sideIndex === 0 ? "back" : "front"}`,
        [
          group([
            ...(sideIndex === 0 ? backLongX : frontLongX).map((x, i) => mesh(
              box((width / 12) * 0.72, WAINSCOT_PANEL_HEIGHT, 0.055),
              standard(i % 2 === 0 ? PANEL_DARK_OAK : PANEL_SHADOW, 0.74, 0),
              { position: [x, WAINSCOT_PANEL_Y, z] },
            )),
            ...(sideIndex === 0 ? backLongChairRailSegments : frontLongChairRailSegments).map((segment) => mesh(
              box(segment.width, 0.1, 0.075),
              standard(BRASS_GOLD, 0.45, 0.25),
              {
                name: sideIndex === 0 ? "back-long-wall-chair-rail" : "front-long-wall-door-interrupted-chair-rail",
                position: [segment.centerX, longChairRailY, z],
              },
            )),
          ]),
        ],
      )),
      ...[-halfW + WAINSCOT_PANEL_INSET, halfW - WAINSCOT_PANEL_INSET].map((x, sideIndex) => surface(
        sideIndex === 0 ? "wall-left" : "wall-right",
        `raised-wainscot-${sideIndex === 0 ? "left" : "right"}`,
        [
          group([
            ...(sideIndex === 0 ? leftShortZ : rightShortZ).map((z, i) => mesh(
              box(0.055, WAINSCOT_PANEL_HEIGHT, shortPanelSpacing * 0.72),
              standard(i % 2 === 0 ? PANEL_DARK_OAK : PANEL_SHADOW, 0.74, 0),
              { position: [x, WAINSCOT_PANEL_Y, z] },
            )),
            mesh(box(0.075, 0.1, length - 0.65), standard(BRASS_GOLD, 0.45, 0.25), {
              position: [x, WAINSCOT_PANEL_Y + WAINSCOT_PANEL_HEIGHT / 2 + 0.12, 0],
            }),
          ]),
        ],
      )),
    ],
  };
}

// ---------------------------------------------------------------------------
// Gold trade frieze — continuous upper-wall band with abstract trade plaques
// ---------------------------------------------------------------------------

const LONG_FRIEZE_FIGURES = 26;

interface FaceBounds {
  readonly x: Interval;
  readonly y: Interval;
}

/** Front-face extent of each long-wall frieze figure body (see `tradeFrieze`). */
function longFriezeFigureBodies(width: number, height: number): FaceBounds[] {
  const y = height - 1.72;
  return Array.from({ length: LONG_FRIEZE_FIGURES }, (_, i) => {
    const x = -width / 2 + (width / LONG_FRIEZE_FIGURES) * (i + 0.5);
    const bodyHeight = 0.32 + (i % 3) * 0.035;
    const bodyY = y - 0.02 - 0.03;
    return { x: { min: x - 0.04, max: x + 0.04 }, y: { min: bodyY - bodyHeight / 2, max: bodyY + bodyHeight / 2 } };
  });
}

function tradeFrieze(
  width: number,
  length: number,
  height: number,
  exactWindowWallFigure: (index: number) => boolean,
): OrnamentSurfaceCluster {
  const halfW = width / 2;
  const halfL = length / 2;
  const y = height - 1.72;
  const bandHeight = 0.68;
  const longFigures = LONG_FRIEZE_FIGURES;
  const shortFigures = 8;
  const figureX = Array.from({ length: longFigures }, (_, i) => -width / 2 + (width / longFigures) * (i + 0.5));
  const figureZ = Array.from({ length: shortFigures }, (_, i) => -length / 2 + (length / shortFigures) * (i + 0.5));
  const underlight = standard(UNDERLIGHT, 0.36, 0, { emissive: UNDERLIGHT, emissiveIntensity: 0.34 });

  return {
    kind: "cluster",
    name: "ochre-mural-frieze",
    surfaces: [
      ...[-halfL + 0.04, halfL - 0.04].map((z, sideIndex) => surface(
        sideIndex === 0 ? "wall-back" : "wall-front",
        `frieze-${sideIndex === 0 ? "back" : "front"}`,
        [
          group([
            mesh(box(width, bandHeight, 0.035), standard(MURAL_GOLD, 0.76, 0.02), { position: [0, y, z] }),
            mesh(box(width, 0.32, 0.055), standard(PANEL_DARK_OAK, 0.68, 0.03), { position: [0, y + bandHeight / 2 + 0.18, z] }),
            mesh(box(width, 0.045, 0.035), underlight, {
              position: [0, y - bandHeight / 2 - 0.03, z + (sideIndex === 0 ? 0.018 : -0.018)],
            }),
            ...figureX.map((x, i) => group([
              mesh(box(0.08, 0.32 + (i % 3) * 0.035, 0.026), standard(MURAL_SHADOW, 0.82, 0), {
                position: [0, -0.03, 0],
                exact: sideIndex === 0 && exactWindowWallFigure(i),
              }),
              mesh(sphere(0.055, 8, 8), standard(MURAL_SHADOW, 0.82, 0), { position: [0, 0.18, 0] }),
            ], { position: [x, y - 0.02, z + (sideIndex === 0 ? 0.032 : -0.032)] })),
          ]),
        ],
      )),
      ...[-halfW + 0.04, halfW - 0.04].map((x, sideIndex) => surface(
        sideIndex === 0 ? "wall-left" : "wall-right",
        `frieze-${sideIndex === 0 ? "left" : "right"}`,
        [
          group([
            mesh(box(0.035, bandHeight, length), standard(MURAL_GOLD, 0.76, 0.02), { position: [x, y, 0] }),
            mesh(box(0.055, 0.32, length), standard(PANEL_DARK_OAK, 0.68, 0.03), { position: [x, y + bandHeight / 2 + 0.18, 0] }),
            mesh(box(0.035, 0.045, length), underlight, {
              position: [x + (sideIndex === 0 ? 0.018 : -0.018), y - bandHeight / 2 - 0.03, 0],
            }),
            ...figureZ.map((z, i) => group([
              mesh(box(0.026, 0.32 + (i % 3) * 0.035, 0.08), standard(MURAL_SHADOW, 0.82, 0), { position: [0, -0.03, 0] }),
              mesh(sphere(0.055, 8, 8), standard(MURAL_SHADOW, 0.82, 0), { position: [0, 0.18, 0] }),
            ], { position: [x + (sideIndex === 0 ? 0.032 : -0.032), y - 0.02, z] })),
          ]),
        ],
      )),
    ],
  };
}

// ---------------------------------------------------------------------------
// Pilasters — decorative ivory columns between window bays
// ---------------------------------------------------------------------------

const PILASTER_W = 0.32;
const PILASTER_DEPTH = 0.12;
const CAPITAL_HEIGHT = 0.32;
const BASE_HEIGHT = 0.22;

function pilaster(position: Vec3, height: number, wallAxis: "x" | "z"): OrnamentGroupNode {
  // Long axis depends on which wall: X-aligned wall → pilaster wide on Z, etc.
  const w = wallAxis === "x" ? PILASTER_DEPTH : PILASTER_W;
  const d = wallAxis === "x" ? PILASTER_W : PILASTER_DEPTH;
  const shaftHeight = height - CAPITAL_HEIGHT - BASE_HEIGHT;

  return group([
    // Base
    mesh(box(w * 1.25, BASE_HEIGHT, d * 1.25), standard(TRIM_COLOR, 0.85, 0), { position: [0, BASE_HEIGHT / 2, 0] }),
    // Shaft
    mesh(box(w, shaftHeight, d), standard(TRIM_COLOR, 0.9, 0), { position: [0, BASE_HEIGHT + shaftHeight / 2, 0] }),
    // Capital — slightly oversized cube + thin gold band
    mesh(box(w * 1.4, CAPITAL_HEIGHT * 0.7, d * 1.4), standard(TRIM_COLOR, 0.85, 0), {
      position: [0, BASE_HEIGHT + shaftHeight + CAPITAL_HEIGHT / 2, 0],
    }),
    mesh(box(w * 1.45, CAPITAL_HEIGHT * 0.18, d * 1.45), standard(BRASS_GOLD, 0.4, 0.4), {
      position: [0, BASE_HEIGHT + shaftHeight + CAPITAL_HEIGHT * 0.85, 0],
    }),
  ], { position: [position[0], position[1], position[2]] });
}

// ---------------------------------------------------------------------------
// Arched window facade — visual cue, not a real window cutout
// ---------------------------------------------------------------------------

const WINDOW_HEIGHT = 4.55;
const WINDOW_WIDTH = 2.45;
export const WINDOW_SILL_Y = 2.15;
const WINDOW_INSET = 0.04;
const WINDOW_FRAME_THICKNESS = 0.12;

interface WindowFrameVerticals<T> {
  readonly left: T;
  readonly right: T;
  readonly centre: T;
}

/** Front-face extent of a window's frame verticals and centre mullion (see `archedWindow`). */
function windowFrameVerticals(centerX: number): WindowFrameVerticals<FaceBounds> {
  const rectHeight = WINDOW_HEIGHT - WINDOW_WIDTH / 2;
  const y = { min: WINDOW_SILL_Y, max: WINDOW_SILL_Y + rectHeight };
  const around = (x: number, halfWidth: number): FaceBounds => ({ x: { min: x - halfWidth, max: x + halfWidth }, y });
  return {
    left: around(centerX - WINDOW_WIDTH / 2 + WINDOW_FRAME_THICKNESS / 2, WINDOW_FRAME_THICKNESS / 2),
    right: around(centerX + WINDOW_WIDTH / 2 - WINDOW_FRAME_THICKNESS / 2, WINDOW_FRAME_THICKNESS / 2),
    centre: around(centerX, 0.04),
  };
}

function archedWindow(position: Vec3, rotationY: number, exactVerticals: WindowFrameVerticals<boolean>): OrnamentGroupNode {
  const archRadius = WINDOW_WIDTH / 2;
  const rectHeight = WINDOW_HEIGHT - archRadius;
  const curtainHeight = rectHeight + 0.55;
  const curtainY = WINDOW_SILL_Y + curtainHeight / 2 - 0.12;
  const trim = (): OrnamentMaterial => standard(TRIM_COLOR, 0.85, 0);
  const frameShadow = (): OrnamentMaterial => standard(WINDOW_FRAME_SHADOW, 0.85, 0);

  return group([
    // Pale gathered drapes and brass pelmet: the reference photos show
    // cream curtains inside the arched bays, not red side swags.
    mesh(box(0.34, curtainHeight, 0.035), standard(CURTAIN_CREAM, 0.88, 0), {
      position: [-WINDOW_WIDTH / 2 - 0.22, curtainY, WINDOW_INSET + 0.018],
    }),
    mesh(box(0.34, curtainHeight, 0.035), standard(CURTAIN_CREAM, 0.88, 0), {
      position: [WINDOW_WIDTH / 2 + 0.22, curtainY, WINDOW_INSET + 0.018],
    }),
    mesh(box(0.055, curtainHeight * 0.92, 0.038), standard(CURTAIN_SHADOW, 0.9, 0), {
      position: [-WINDOW_WIDTH / 2 - 0.04, curtainY, WINDOW_INSET + 0.021],
    }),
    mesh(box(0.055, curtainHeight * 0.92, 0.038), standard(CURTAIN_SHADOW, 0.9, 0), {
      position: [WINDOW_WIDTH / 2 + 0.04, curtainY, WINDOW_INSET + 0.021],
    }),
    mesh(box(WINDOW_WIDTH + 0.74, 0.16, 0.045), standard(BRASS_GOLD, 0.4, 0.35), {
      position: [0, WINDOW_SILL_Y + rectHeight + 0.22, WINDOW_INSET + 0.02],
    }),
    // Daylight backing behind the actual translucent glass.
    mesh(
      { kind: "plane", args: [WINDOW_WIDTH - 0.08, rectHeight] },
      standard(WINDOW_GLOW, 0.4, 0, { emissive: WINDOW_GLOW, emissiveIntensity: 0.55 }),
      { name: "arched-window-daylight-pane-rect", position: [0, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET] },
    ),
    mesh(
      { kind: "plane", args: [WINDOW_WIDTH - 0.22, rectHeight - 0.12] },
      standard(GLASS_BLUE, 0.08, 0.04, {
        emissive: WINDOW_GLOW,
        emissiveIntensity: 0.12,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: DoubleSide,
      }),
      { name: "arched-window-glass-pane-rect", position: [0, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.025] },
    ),
    // Half-circle arch top with translucent glass layered over glow.
    mesh(
      { kind: "circle", args: [archRadius - 0.04, 32, 0, Math.PI] },
      standard(WINDOW_GLOW, 0.4, 0, { emissive: WINDOW_GLOW, emissiveIntensity: 0.55 }),
      { name: "arched-window-daylight-pane-arch", position: [0, WINDOW_SILL_Y + rectHeight, WINDOW_INSET], rotation: [0, 0, 0] },
    ),
    mesh(
      { kind: "circle", args: [archRadius - 0.14, 32, 0, Math.PI] },
      standard(GLASS_BLUE, 0.08, 0.04, {
        emissive: WINDOW_GLOW,
        emissiveIntensity: 0.1,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        side: DoubleSide,
      }),
      { name: "arched-window-glass-pane-arch", position: [0, WINDOW_SILL_Y + rectHeight, WINDOW_INSET + 0.026], rotation: [0, 0, 0] },
    ),
    ...[-0.28, 0.26].map((x, i) => mesh(
      box(0.035, rectHeight * 0.42, 0.012),
      standard(GLASS_HIGHLIGHT, 0.05, 0, {
        emissive: GLASS_HIGHLIGHT,
        emissiveIntensity: 0.18,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      }),
      {
        name: "arched-window-glass-highlight",
        position: [x, WINDOW_SILL_Y + rectHeight * (i === 0 ? 0.7 : 0.36), WINDOW_INSET + 0.034],
        rotation: [0, 0, -0.28],
      },
    )),
    // Frame — left vertical
    mesh(box(WINDOW_FRAME_THICKNESS, rectHeight, 0.02), trim(), {
      position: [-WINDOW_WIDTH / 2 + WINDOW_FRAME_THICKNESS / 2, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.01],
      exact: exactVerticals.left,
    }),
    // Frame — right vertical
    mesh(box(WINDOW_FRAME_THICKNESS, rectHeight, 0.02), trim(), {
      position: [WINDOW_WIDTH / 2 - WINDOW_FRAME_THICKNESS / 2, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.01],
      exact: exactVerticals.right,
    }),
    // Frame — sill
    mesh(box(WINDOW_WIDTH + 0.16, 0.12, 0.06), trim(), { position: [0, WINDOW_SILL_Y, WINDOW_INSET + 0.02] }),
    // Frame — horizontal mullion at half height
    mesh(box(WINDOW_WIDTH - 0.1, 0.08, 0.02), trim(), { position: [0, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.01] }),
    mesh(box(WINDOW_WIDTH - 0.14, 0.045, 0.018), frameShadow(), {
      position: [0, WINDOW_SILL_Y + rectHeight * 0.28, WINDOW_INSET + 0.012],
    }),
    mesh(box(WINDOW_WIDTH - 0.14, 0.045, 0.018), frameShadow(), {
      position: [0, WINDOW_SILL_Y + rectHeight * 0.72, WINDOW_INSET + 0.012],
    }),
    // Frame — vertical mullion
    mesh(box(0.08, rectHeight, 0.02), trim(), {
      position: [0, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.01],
      exact: exactVerticals.centre,
    }),
    mesh(box(0.04, rectHeight * 0.9, 0.018), frameShadow(), {
      position: [-WINDOW_WIDTH * 0.24, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.012],
    }),
    mesh(box(0.04, rectHeight * 0.9, 0.018), frameShadow(), {
      position: [WINDOW_WIDTH * 0.24, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.012],
    }),
    // Arch frame — thin ring along the half-circle outer edge
    mesh(
      { kind: "ring", args: [archRadius - 0.06, archRadius, 32, 1, 0, Math.PI] },
      standard(TRIM_COLOR, 0.85, 0, { side: DoubleSide }),
      { position: [0, WINDOW_SILL_Y + rectHeight, WINDOW_INSET + 0.01] },
    ),
  ], { position: [position[0], position[1], position[2]], rotation: [0, rotationY, 0] });
}

// ---------------------------------------------------------------------------
// Opposite-wall double doors — three ornate timber sets facing the window wall
// ---------------------------------------------------------------------------

function doorRaisedPanel(x: number, y: number, width: number, height: number): OrnamentGroupNode {
  return group([
    mesh(box(width, height, 0.035), standard(DOOR_HIGHLIGHT, 0.58, 0.02), { name: "front-wall-door-raised-panel-frame" }),
    mesh(box(width * 0.76, height * 0.74, 0.036), standard(PANEL_SHADOW, 0.72, 0), {
      name: "front-wall-door-recessed-panel",
      position: [0, 0, -0.012],
    }),
  ], { position: [x, y, -FRONT_DOOR_DEPTH * 0.72] });
}

function ornateDoubleDoorSet(x: number, z: number): OrnamentGroupNode {
  const leafWidth = (FRONT_DOOR_WIDTH - 0.08) / 2;
  const leafCenterX = leafWidth / 2 + 0.02;
  const y = FRONT_DOOR_HEIGHT / 2;

  return group([
    mesh(box(FRONT_DOOR_FRAME, FRONT_DOOR_HEIGHT + 0.22, FRONT_DOOR_DEPTH * 1.35), standard(PANEL_DARK_OAK, 0.58, 0.02), {
      name: "grand-hall-front-wall-door-frame-left",
      position: [-FRONT_DOOR_WIDTH / 2 - FRONT_DOOR_FRAME / 2, y, 0],
    }),
    mesh(box(FRONT_DOOR_FRAME, FRONT_DOOR_HEIGHT + 0.22, FRONT_DOOR_DEPTH * 1.35), standard(PANEL_DARK_OAK, 0.58, 0.02), {
      name: "grand-hall-front-wall-door-frame-right",
      position: [FRONT_DOOR_WIDTH / 2 + FRONT_DOOR_FRAME / 2, y, 0],
    }),
    mesh(box(FRONT_DOOR_WIDTH + FRONT_DOOR_FRAME * 2.2, 0.2, FRONT_DOOR_DEPTH * 1.42), standard(PANEL_DARK_OAK, 0.56, 0.02), {
      name: "grand-hall-front-wall-door-top-rail",
      position: [0, FRONT_DOOR_HEIGHT + 0.1, 0],
    }),
    mesh(box(FRONT_DOOR_WIDTH + FRONT_DOOR_FRAME * 2.9, 0.12, FRONT_DOOR_DEPTH * 1.72), standard(DOOR_HIGHLIGHT, 0.5, 0.04), {
      name: "grand-hall-front-wall-door-cornice",
      position: [0, FRONT_DOOR_HEIGHT + 0.28, -0.01],
    }),
    mesh(box(FRONT_DOOR_WIDTH + FRONT_DOOR_FRAME * 2.3, 0.1, FRONT_DOOR_DEPTH * 1.55), standard(PANEL_DARK_OAK, 0.62, 0.02), {
      name: "grand-hall-front-wall-door-threshold",
      position: [0, 0.05, -0.015],
    }),

    ...[-leafCenterX, leafCenterX].map((leafX, i) => group([
      mesh(box(leafWidth, FRONT_DOOR_HEIGHT, FRONT_DOOR_DEPTH), standard(DOOR_TIMBER, 0.66, 0.01), { name: "grand-hall-front-wall-door" }),
      doorRaisedPanel(0, 0.48, leafWidth * 0.66, 0.88),
      doorRaisedPanel(0, -0.58, leafWidth * 0.66, 0.72),
      mesh(box(0.06, FRONT_DOOR_HEIGHT * 0.92, 0.034), standard(DOOR_HIGHLIGHT, 0.54, 0.03), {
        name: "front-wall-door-vertical-stile",
        position: [i === 0 ? leafWidth / 2 - 0.03 : -leafWidth / 2 + 0.03, 0, -FRONT_DOOR_DEPTH * 0.74],
      }),
    ], { name: "grand-hall-front-wall-door-leaf", position: [leafX, y, -0.012] })),

    mesh(box(0.045, FRONT_DOOR_HEIGHT * 0.9, 0.036), standard(PANEL_SHADOW, 0.68, 0.01), {
      name: "front-wall-door-center-seam",
      position: [0, y, -FRONT_DOOR_DEPTH * 0.86],
    }),
    ...[-0.13, 0.13].map((handleX) => mesh(sphere(0.055, 14, 14), standard(BRASS_GOLD, 0.26, 0.72), {
      name: "front-wall-door-brass-handle",
      position: [handleX, 1.16, -FRONT_DOOR_DEPTH * 1.18],
    })),
  ], { name: "front-long-wall-door-set", position: [x, 0, z] });
}

function oppositeLongWallDoors(width: number, length: number): OrnamentSurface {
  const z = length / 2 - 0.085;
  const doorX = computeOppositeLongWallDoorCenters(width);
  return surface("wall-front", "opposite-long-wall-three-door-cluster", doorX.map((x) => ornateDoubleDoorSet(x, z)));
}

// ---------------------------------------------------------------------------
// Timber coffer beams — geometric depth over the avodire ceiling texture
// ---------------------------------------------------------------------------

/** Radial extent of the rosette's burgundy band beyond the dome radius. */
const ROSETTE_BAND_INNER = 0.18;
const ROSETTE_BAND_OUTER = 0.42;

/** Whether an axis-aligned floor-plan rectangle meets an annulus centred on the origin. */
function footprintMeetsAnnulus(x: Interval, z: Interval, inner: number, outer: number): boolean {
  const nearestX = Math.min(Math.max(0, x.min), x.max);
  const nearestZ = Math.min(Math.max(0, z.min), z.max);
  const farthestX = Math.max(Math.abs(x.min), Math.abs(x.max));
  const farthestZ = Math.max(Math.abs(z.min), Math.abs(z.max));
  return Math.hypot(nearestX, nearestZ) < outer && Math.hypot(farthestX, farthestZ) > inner;
}

function cofferedAvodireCeiling(width: number, length: number, height: number): OrnamentGroupNode {
  const halfW = width / 2;
  const halfL = length / 2;
  const y = height - 0.065;
  const opening = DOME_RADIUS + 0.72;
  const sidePanelWidth = Math.max(0.1, (width - opening * 2) / 2);
  const endPanelLength = Math.max(0.1, (length - opening * 2) / 2);

  // Each diamond coffer is four short avodire edge battens plus a bright centre
  // disc. The edges all share one geometry/material and so do the centres, so
  // the per-mesh tree instances them — every coffer's edges collapse into a
  // single InstancedMesh draw and every coffer's centre into another.
  const cofferSize = Math.min(width / 10, length / 3.8);
  const cofferY = y - 0.028;
  const cofferEdgeSide = cofferSize * 0.74;
  const cofferEdgeOffset = cofferSize * 0.26;
  const cofferEdgeStrip = 0.045;
  const cofferCircleRadius = cofferSize * 0.09;
  const xs = Array.from({ length: 9 }, (_, i) => -halfW + (width / 10) * (i + 1));
  const zs = [-halfL * 0.55, 0, halfL * 0.55];
  const cofferCenters = xs.flatMap((x) =>
    zs
      .filter((z) => Math.sqrt(x * x + z * z) > opening * 1.12)
      .map((z) => ({ x, z })),
  );
  const cofferEdges = cofferCenters.flatMap((c) =>
    [
      { dx: -cofferEdgeOffset, dz: -cofferEdgeOffset, ry: Math.PI / 4 },
      { dx: cofferEdgeOffset, dz: -cofferEdgeOffset, ry: -Math.PI / 4 },
      { dx: cofferEdgeOffset, dz: cofferEdgeOffset, ry: Math.PI / 4 },
      { dx: -cofferEdgeOffset, dz: cofferEdgeOffset, ry: -Math.PI / 4 },
    ].map((edge) => ({
      position: [c.x + edge.dx, cofferY, c.z + edge.dz] as const,
      rotationY: edge.ry,
    })),
  );
  const panels = [
    {
      position: [-opening - sidePanelWidth / 2, height - 0.01, 0] as const,
      size: [sidePanelWidth, 0.02, length - 0.2] as const,
    },
    {
      position: [opening + sidePanelWidth / 2, height - 0.01, 0] as const,
      size: [sidePanelWidth, 0.02, length - 0.2] as const,
    },
    {
      position: [0, height - 0.01, -opening - endPanelLength / 2] as const,
      size: [opening * 2, 0.02, endPanelLength] as const,
    },
    {
      position: [0, height - 0.01, opening + endPanelLength / 2] as const,
      size: [opening * 2, 0.02, endPanelLength] as const,
    },
  ];
  const edgeInstances: OrnamentInstancesNode[] = cofferEdges.length > 0
    ? [{
      kind: "instances",
      name: "ceiling-diamond-edges",
      geometry: box(cofferEdgeSide, 0.035, cofferEdgeStrip),
      material: standard(AVODIRE_BEAM, 0.68, 0.02),
      instances: cofferEdges.map((edge) => ({ position: edge.position, rotation: [0, edge.rotationY, 0] as const })),
    }]
    : [];
  const centreInstances: OrnamentInstancesNode[] = cofferCenters.length > 0
    ? [{
      kind: "instances",
      name: "ceiling-diamond-centres",
      geometry: { kind: "circle", args: [cofferCircleRadius, 8] },
      material: standard(AVODIRE_HIGHLIGHT, 0.46, 0.22, { side: DoubleSide }),
      instances: cofferCenters.map((c) => ({ position: [c.x, cofferY + 0.004, c.z] as const, rotation: [-Math.PI / 2, 0, 0] as const })),
    }]
    : [];

  // The cross beams' tops lie in the rosette band's plane (height - 0.009).
  const crossBeamLength = length - 0.8;
  const crossBeamMeetsRosetteBand = (x: number): boolean => footprintMeetsAnnulus(
    { min: x - 0.09, max: x + 0.09 },
    { min: -crossBeamLength / 2, max: crossBeamLength / 2 },
    DOME_RADIUS + ROSETTE_BAND_INNER,
    DOME_RADIUS + ROSETTE_BAND_OUTER,
  );

  return group([
    // The panels' tops lie in the crown mouldings' top plane (height), so the
    // panels keep exact draws.
    ...panels.map((panel) => mesh(
      box(panel.size[0], panel.size[1], panel.size[2]),
      standard(CEILING_COLOR, 0.78, 0.04),
      { position: [panel.position[0], panel.position[1], panel.position[2]], exact: true },
    )),
    mesh(
      { kind: "ring", args: [DOME_RADIUS + 0.34, opening * 1.44, 72] },
      standard(DOME_COLOR, 0.72, 0.08, { side: DoubleSide }),
      { position: [0, height + 0.012, 0], rotation: [-Math.PI / 2, 0, 0] },
    ),
    ...[-halfL * 0.78, halfL * 0.78].map((z) => mesh(box(width - 0.8, 0.12, 0.18), standard(AVODIRE_BEAM, 0.68, 0.02), {
      position: [0, y, z],
    })),
    ...[-halfW * 0.74, -halfW * 0.5, -halfW * 0.26, halfW * 0.26, halfW * 0.5, halfW * 0.74].map((x) => mesh(
      box(0.18, 0.12, length - 0.8),
      standard(AVODIRE_BEAM, 0.68, 0.02),
      { position: [x, y - 0.004, 0], exact: crossBeamMeetsRosetteBand(x) },
    )),
    ...edgeInstances,
    ...centreInstances,
    mesh(torus(DOME_RADIUS + 0.7, 0.075, 12, 80), standard(AVODIRE_HIGHLIGHT, 0.46, 0.22), {
      position: [0, y - 0.01, 0],
      rotation: [-Math.PI / 2, 0, 0],
    }),
  ], { name: "avodire-coffered-ceiling" });
}

// ---------------------------------------------------------------------------
// Wall art and fireplace
// ---------------------------------------------------------------------------

function wallPortrait(
  position: Vec3,
  axis: "x" | "z",
  frameColor: string = BRASS_GOLD,
  pictureColor: string = PORTRAIT_DARK,
): OrnamentGroupNode {
  const frameArgs: readonly [number, number, number] = axis === "x" ? [0.06, 1.08, 0.78] : [0.78, 1.08, 0.06];
  const pictureArgs: readonly [number, number, number] = axis === "x" ? [0.07, 0.82, 0.56] : [0.56, 0.82, 0.07];

  return group([
    mesh(box(frameArgs[0], frameArgs[1], frameArgs[2]), standard(frameColor, 0.35, 0.45)),
    mesh(box(pictureArgs[0], pictureArgs[1], pictureArgs[2]), standard(pictureColor, 0.78, 0)),
  ], { position: [position[0], position[1], position[2]] });
}

function endWallFocalPoint(width: number, length: number): OrnamentSurfaceCluster {
  const fireplaceX = -width / 2 + 0.18;
  const boardZ = length * 0.24;
  const fireboxBackX = fireplaceX - 0.035;
  const fireplaceFaceX = fireplaceX + 0.035;
  const bronze = (): OrnamentMaterial => standard(BRONZE_DARK, 0.34, 0.46);

  return {
    kind: "cluster",
    name: "end-wall-focal-points",
    surfaces: [
      // Far short-end fireplace and portrait/honour-board composition.
      surface("wall-left", "left-end-wall-focal-point", [
        group([
          mesh(box(0.055, 1.28, 2.12), standard("#ece5d5", 0.34, 0), {
            name: "left-fireplace-back-marble-slab",
            position: [fireplaceX - 0.012, 0.72, 0],
          }),
          // The jambs' faces lie in the header's front and side planes where
          // they overlap it, so jambs and header keep exact draws.
          mesh(box(0.2, 1.08, 0.28), standard(MARBLE_WHITE, 0.36, 0), {
            name: "left-fireplace-left-jamb",
            position: [fireplaceFaceX, 0.64, -0.82],
            exact: true,
          }),
          mesh(box(0.2, 1.08, 0.28), standard(MARBLE_WHITE, 0.36, 0), {
            name: "left-fireplace-right-jamb",
            position: [fireplaceFaceX, 0.64, 0.82],
            exact: true,
          }),
          mesh(box(0.08, 0.72, 0.055), standard(SOOT_SHADOW, 0.86, 0), {
            name: "left-fireplace-inner-left-return",
            position: [fireboxBackX + 0.01, 0.54, -0.51],
          }),
          mesh(box(0.08, 0.72, 0.055), standard(SOOT_SHADOW, 0.86, 0), {
            name: "left-fireplace-inner-right-return",
            position: [fireboxBackX + 0.01, 0.54, 0.51],
          }),
          mesh(box(0.2, 0.26, 1.78), standard(MARBLE_WHITE, 0.34, 0), {
            name: "left-fireplace-header",
            position: [fireplaceFaceX, 1.08, 0],
            exact: true,
          }),
          mesh(
            { kind: "ring", args: [0.43, 0.52, 36, 2, 0, Math.PI] },
            standard("#efe8d9", 0.32, 0, { side: DoubleSide }),
            { name: "left-fireplace-firebox-arch", position: [fireplaceFaceX + 0.011, 0.75, 0], rotation: [0, Math.PI / 2, 0] },
          ),
          mesh(box(0.42, 0.13, 2.28), standard("#e7dfcf", 0.38, 0), {
            name: "left-fireplace-hearth",
            position: [fireplaceX + 0.12, 0.08, 0],
          }),
          mesh(box(0.08, 0.08, 2.36), standard("#d8cfbd", 0.35, 0), {
            name: "left-fireplace-hearth-front-lip",
            position: [fireplaceX + 0.31, 0.17, 0],
          }),
          mesh(box(0.34, 0.16, 2.34), standard(MARBLE_WHITE, 0.3, 0), {
            name: "left-fireplace-mantel",
            position: [fireplaceX + 0.08, 1.27, 0],
          }),
          mesh(box(0.035, 0.055, 2.12), standard("#cbbfa9", 0.5, 0), {
            name: "left-fireplace-mantel-shadow-line",
            position: [fireplaceX + 0.23, 1.17, 0],
          }),
          mesh(box(0.04, 0.62, 1.02), standard(FIREBOX_DARK, 0.88, 0), {
            name: "left-firebox-back-panel",
            position: [fireboxBackX, 0.5, 0],
          }),
          ...[-0.32, -0.1, 0.12, 0.34].map((z) => mesh(box(0.04, 0.34, 0.025), bronze(), {
            name: "left-fireplace-brass-grate-bar",
            position: [fireplaceX + 0.18, 0.31, z],
          })),
          mesh(box(0.045, 0.035, 0.94), bronze(), {
            name: "left-fireplace-front-grate-rail",
            position: [fireplaceX + 0.2, 0.24, 0],
          }),
          ...[-0.18, 0.18].map((z, i) => mesh(cylinder(0.045, 0.055, 0.55, 10), standard("#2f1b0f", 0.82, 0), {
            name: "left-fireplace-charred-log",
            position: [fireplaceX + 0.13, 0.26, z],
            rotation: [Math.PI / 2, 0, i === 0 ? 0.16 : -0.16],
          })),
          mesh(box(0.035, 0.045, 0.52), standard(EMBER_ORANGE, 0.55, 0, { emissive: EMBER_ORANGE, emissiveIntensity: 0.45 }), {
            name: "left-fireplace-ember-glow",
            position: [fireplaceX + 0.145, 0.22, 0],
          }),
          ...[
            { y: 0.86, z: -0.72, rz: -0.2, w: 0.52 },
            { y: 1.19, z: 0.54, rz: 0.16, w: 0.68 },
            { y: 0.38, z: 0.73, rz: -0.12, w: 0.38 },
          ].map((vein) => mesh(box(0.012, 0.018, vein.w), standard("#b9afa1", 0.5, 0), {
            name: "left-fireplace-marble-vein",
            position: [fireplaceX + 0.205, vein.y, vein.z],
            rotation: [0, 0, vein.rz],
          })),
        ], { name: "left-fireplace-realistic-surround" }),
        wallPortrait([fireplaceX + 0.05, 3.15, 0], "x", undefined, "#3a2b20"),
        wallPortrait([fireplaceX + 0.04, 2.55, -boardZ], "x", PANEL_DARK_OAK, "#20140c"),
        wallPortrait([fireplaceX + 0.04, 2.55, boardZ], "x", PANEL_DARK_OAK, "#20140c"),
      ]),
    ],
  };
}

// ---------------------------------------------------------------------------
// Ceiling rosette ring around the dome base
// ---------------------------------------------------------------------------

function ceilingRosetteRing(y: number, radius: number): OrnamentGroupNode {
  const tradeCount = 14;

  return group([
    // Outer brass ring
    mesh({ kind: "ring", args: [radius + 0.05, radius + 0.55, 64] }, standard(BRASS_GOLD, 0.4, 0.5, { side: 2 }), {
      rotation: [-Math.PI / 2, 0, 0],
      position: [0, -0.005, 0],
    }),
    // Burgundy frieze band inside the brass
    mesh({ kind: "ring", args: [radius + ROSETTE_BAND_INNER, radius + ROSETTE_BAND_OUTER, 64] }, standard(BURGUNDY, 0.7, 0, { side: 2 }), {
      rotation: [-Math.PI / 2, 0, 0],
      position: [0, -0.004, 0],
    }),
    // Fourteen shields nod to the Incorporated Trades around the dome.
    ...Array.from({ length: tradeCount }).map((_, i) => {
      const a = (i / tradeCount) * Math.PI * 2;
      const r = radius + 0.3;
      return mesh(
        { kind: "circle", args: [0.095, 5] },
        standard(i % 4 === 0 ? AVODIRE_HIGHLIGHT : BRASS_GOLD, 0.35, 0.55, { side: DoubleSide }),
        { position: [Math.cos(a) * r, -0.003, Math.sin(a) * r], rotation: [-Math.PI / 2, 0, -a] },
      );
    }),
  ], { position: [0, y, 0], name: "ceiling-rosette" });
}

// ---------------------------------------------------------------------------
// Chandelier — hanging brass + crystal under the dome
// ---------------------------------------------------------------------------

export interface ChandelierDescription {
  /** Placement of the chandelier group (`position`, non-uniform `scale`). */
  readonly placement: { readonly position: Vec3; readonly scale: Vec3 };
  /** Opaque fittings in their original order: rod, rose, rings, candles, arms. */
  readonly fittings: readonly OrnamentNode[];
  /** Blended crystal (drop instances, central glow), drawn per object. */
  readonly crystal: readonly OrnamentNode[];
}

function chandelier(anchorY: number, dropLength: number, x = 0, z = 0, scale = 1): ChandelierDescription {
  const ringY = anchorY - dropLength;
  const ringRadius = 0.84;
  const drops: { x: number; z: number; y: number }[] = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    drops.push({
      x: Math.cos(a) * ringRadius,
      z: Math.sin(a) * ringRadius,
      y: -0.18 - (i % 3) * 0.08,
    });
  }
  const brass = (): OrnamentMaterial => standard(BRASS_GOLD, 0.35, 0.7);

  return {
    placement: { position: [x, 0, z], scale: [scale, 1, scale] },
    fittings: [
      // Brass suspension rod. Its top cap lies in the rose's top face (both at
      // anchorY), so rod and rose keep exact draws.
      mesh(cylinder(0.025, 0.025, dropLength, 16), brass(), { position: [0, anchorY - dropLength / 2, 0], exact: true }),
      // Top ceiling rose where the rod meets the dome
      mesh(cylinder(0.18, 0.12, 0.1, 24), standard(BRONZE_DARK, 0.4, 0.6), { position: [0, anchorY - 0.05, 0], exact: true }),
      // Main brass ring
      mesh(torus(ringRadius, 0.045, 12, 48), brass(), { position: [0, ringY, 0] }),
      // Inner brass ring (smaller)
      mesh(torus(ringRadius * 0.55, 0.035, 10, 36), brass(), { position: [0, ringY + 0.18, 0] }),
      // Warm candle bulbs — emissive material only, no runtime PointLight.
      {
        kind: "instances",
        name: "chandelier-candles",
        geometry: sphere(0.07, 12, 12),
        material: standard("#ffe0a3", 0.18, 0, { emissive: "#f7c16b", emissiveIntensity: 0.95 }),
        instances: Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return { position: [Math.cos(a) * ringRadius * 0.78, ringY + 0.08, Math.sin(a) * ringRadius * 0.78] as const };
        }),
      },
      // Brass arms — 6 arms holding the inner ring.
      {
        kind: "instances",
        name: "chandelier-arms",
        geometry: cylinder(0.015, 0.015, ringRadius * 0.5, 8),
        material: brass(),
        instances: Array.from({ length: 6 }).map((_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return {
            position: [Math.cos(a) * ringRadius * 0.75, ringY + 0.09, Math.sin(a) * ringRadius * 0.75] as const,
            rotation: [0, -a, Math.PI / 2] as const,
          };
        }),
      },
    ],
    crystal: [
      // Crystal drops — emissive spheres; identical geometry → one instanced draw.
      {
        kind: "instances",
        name: "chandelier-drops",
        geometry: sphere(0.06, 12, 12),
        material: standard(CRYSTAL, 0.15, 0, { emissive: CRYSTAL, emissiveIntensity: 0.85, transparent: true, opacity: 0.95 }),
        instances: drops.map((d) => ({ position: [d.x, ringY + d.y, d.z] as const })),
      },
      // Central larger glow drop
      mesh(
        sphere(0.12, 16, 16),
        standard(CRYSTAL, 0.1, 0, { emissive: CRYSTAL, emissiveIntensity: 1.0, transparent: true, opacity: 0.9 }),
        { position: [0, ringY - 0.4, 0] },
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Whole-hall description
// ---------------------------------------------------------------------------

export interface GrandHallOrnamentDescription {
  readonly ceiling: readonly OrnamentSurface[];
  readonly walls: readonly OrnamentLayer[];
  readonly rosette: readonly OrnamentSurface[];
  readonly chandeliers: readonly ChandelierDescription[];
}

export function describeGrandHallOrnaments(width: number, length: number, height: number): GrandHallOrnamentDescription {
  const halfL = length / 2;
  const windowWallZ = -halfL + 0.025;

  // The floorplan's 21m side is the X axis. Three arched window bays sit on
  // one long wall, spaced along X, not mirrored onto the opposite wall.
  const windowX = computeWindowWallCenters(width);
  const pilasterX = [-width * 0.42, -width * 0.15, width * 0.15, width * 0.42];
  const chandelierX = [-width * 0.28, 0, width * 0.28];

  // The window-wall frieze figures' bodies and the windows' frame verticals
  // share one front plane (length / 2 - 0.085 from the centre). Where they
  // overlap, both keep exact draws.
  const figureBodies = longFriezeFigureBodies(width, height);
  const verticals = windowX.map(windowFrameVerticals);
  const meets = (a: FaceBounds, b: FaceBounds): boolean => overlaps(a.x, b.x) && overlaps(a.y, b.y);
  const meetsAnyFigure = (face: FaceBounds): boolean => figureBodies.some((body) => meets(body, face));
  const exactFigure = (index: number): boolean => {
    const body = figureBodies[index];
    return body !== undefined && verticals.some((frame) => [frame.left, frame.right, frame.centre].some((face) => meets(body, face)));
  };

  return {
    ceiling: [surface("ceiling", "grand-hall-ceiling-ornaments", [cofferedAvodireCeiling(width, length, height)])],
    walls: [
      crownMoulding(width, length, height),
      skirting(width, length),
      wainscotRaisedPanels(width, length),
      tradeFrieze(width, length, height, exactFigure),
      oppositeLongWallDoors(width, length),
      endWallFocalPoint(width, length),
      // Pilasters and arched windows along the window wall only.
      surface("wall-back", "window-wall-ornament-cluster", [
        ...pilasterX.map((x) => pilaster([x, 0, -halfL + 0.12], height, "z")),
        // Arched windows on the real window wall, facing inward.
        ...windowX.map((x, i) => {
          const frame = verticals[i] ?? windowFrameVerticals(x);
          return archedWindow([x, 0, windowWallZ], 0, {
            left: meetsAnyFigure(frame.left),
            right: meetsAnyFigure(frame.right),
            centre: meetsAnyFigure(frame.centre),
          });
        }),
      ]),
    ],
    // Ceiling rosette ring around the dome base
    rosette: [surface("ceiling", "grand-hall-ceiling-rosette", [ceilingRosetteRing(height - 0.005, DOME_RADIUS)])],
    // Three chandeliers along the 21m hall centerline.
    chandeliers: chandelierX.map((x, i) => chandelier(height - 0.08, i === 1 ? 2.18 : 1.78, x, undefined, i === 1 ? 1.08 : 0.82)),
  };
}

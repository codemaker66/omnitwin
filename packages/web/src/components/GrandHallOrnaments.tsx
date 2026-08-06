/**
 * Grand Hall ornamental dressing.
 *
 * Layered on top of the basic 6-surface room (`GrandHallRoom`):
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

import { useMemo } from "react";
import { DoubleSide } from "three";
import { Instances, Instance } from "@react-three/drei";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
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
import { SurfaceVisibilityGroup } from "./SurfaceVisibilityGroup.js";
import { useSectionStore } from "../stores/section-store.js";

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
// Crown moulding — slim ivory strip at the top of every wall
// ---------------------------------------------------------------------------

const CROWN_HEIGHT = 0.28;
const CROWN_DEPTH = 0.16;
const CROWN_BAND_HEIGHT = 0.06;

interface MouldingProps {
  readonly width: number;
  readonly length: number;
  readonly wallHeight: number;
}

function CrownMoulding({ width, length, wallHeight }: MouldingProps): React.ReactElement {
  // Y-centre of the crown moulding row — sits tucked against the ceiling
  const yCentre = wallHeight - CROWN_HEIGHT / 2;
  // Inset slightly from the wall plane so the moulding box doesn't z-fight
  const halfW = width / 2 - CROWN_DEPTH / 2;
  const halfL = length / 2 - CROWN_DEPTH / 2;

  return (
    <group name="crown-moulding">
      {/* Front + back walls (along Z) — long bar runs the room width */}
      {[-halfL, halfL].map((z, i) => (
        <SurfaceVisibilityGroup
          key={`crown-z-${String(i)}`}
          name={`crown-${i === 0 ? "back" : "front"}`}
          surfaceKey={i === 0 ? "wall-back" : "wall-front"}
        >
        <group position={[0, yCentre, z]}>
          <mesh>
            <boxGeometry args={[width, CROWN_HEIGHT, CROWN_DEPTH]} />
            <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
          </mesh>
          {/* Gold band running along the bottom edge of the moulding */}
          <mesh position={[0, -CROWN_HEIGHT / 2 + CROWN_BAND_HEIGHT / 2, CROWN_DEPTH / 2 + 0.001]}>
            <boxGeometry args={[width, CROWN_BAND_HEIGHT, 0.012]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.45} metalness={0.3} />
          </mesh>
        </group>
        </SurfaceVisibilityGroup>
      ))}
      {/* Left + right walls (along X) — long bar runs the room length */}
      {[-halfW, halfW].map((x, i) => (
        <SurfaceVisibilityGroup
          key={`crown-x-${String(i)}`}
          name={`crown-${i === 0 ? "left" : "right"}`}
          surfaceKey={i === 0 ? "wall-left" : "wall-right"}
        >
        <group position={[x, yCentre, 0]}>
          <mesh>
            <boxGeometry args={[CROWN_DEPTH, CROWN_HEIGHT, length]} />
            <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
          </mesh>
          <mesh position={[CROWN_DEPTH / 2 + 0.001, -CROWN_HEIGHT / 2 + CROWN_BAND_HEIGHT / 2, 0]}>
            <boxGeometry args={[0.012, CROWN_BAND_HEIGHT, length]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.45} metalness={0.3} />
          </mesh>
        </group>
        </SurfaceVisibilityGroup>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Skirting — slim dark strip at the floor
// ---------------------------------------------------------------------------

const SKIRT_HEIGHT = 0.18;
const SKIRT_DEPTH = 0.06;

function Skirting({ width, length }: { readonly width: number; readonly length: number }): React.ReactElement {
  const yCentre = SKIRT_HEIGHT / 2;
  const halfW = width / 2 - SKIRT_DEPTH / 2;
  const halfL = length / 2 - SKIRT_DEPTH / 2;

  return (
    <group name="skirting">
      {[-halfL, halfL].map((z, i) => (
        <SurfaceVisibilityGroup
          key={`skirt-z-${String(i)}`}
          name={`skirt-${i === 0 ? "back" : "front"}`}
          surfaceKey={i === 0 ? "wall-back" : "wall-front"}
        >
        <mesh position={[0, yCentre, z]}>
          <boxGeometry args={[width, SKIRT_HEIGHT, SKIRT_DEPTH]} />
          <meshStandardMaterial color="#3e2a14" roughness={0.7} metalness={0} />
        </mesh>
        </SurfaceVisibilityGroup>
      ))}
      {[-halfW, halfW].map((x, i) => (
        <SurfaceVisibilityGroup
          key={`skirt-x-${String(i)}`}
          name={`skirt-${i === 0 ? "left" : "right"}`}
          surfaceKey={i === 0 ? "wall-left" : "wall-right"}
        >
        <mesh position={[x, yCentre, 0]}>
          <boxGeometry args={[SKIRT_DEPTH, SKIRT_HEIGHT, length]} />
          <meshStandardMaterial color="#3e2a14" roughness={0.7} metalness={0} />
        </mesh>
        </SurfaceVisibilityGroup>
      ))}
    </group>
  );
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

function WainscotRaisedPanels({ width, length }: { readonly width: number; readonly length: number }): React.ReactElement {
  const halfW = width / 2;
  const halfL = length / 2;

  const backLongX = useMemo(
    () => computeVisibleLongWainscotPanelCenters(width, "back"),
    [width],
  );
  const frontLongX = useMemo(
    () => computeVisibleLongWainscotPanelCenters(width, "front"),
    [width],
  );
  const backLongChairRailSegments = useMemo(
    () => [{ centerX: 0, width: width - 0.65 }] as const,
    [width],
  );
  const frontLongChairRailSegments = useMemo(
    () => computeOppositeLongWallChairRailSegments(width),
    [width],
  );
  const leftShortZ = useMemo(
    () => computeVisibleShortWainscotPanelCenters(length, "left"),
    [length],
  );
  const rightShortZ = useMemo(
    () => computeVisibleShortWainscotPanelCenters(length, "right"),
    [length],
  );
  const shortPanelSpacing = length / 5;
  const longChairRailY = WAINSCOT_PANEL_Y + WAINSCOT_PANEL_HEIGHT / 2 + 0.12;

  return (
    <group name="raised-wainscot-panels">
      {[-halfL + WAINSCOT_PANEL_INSET, halfL - WAINSCOT_PANEL_INSET].map((z, sideIndex) => (
        <SurfaceVisibilityGroup
          key={`wainscot-long-${String(sideIndex)}`}
          name={`raised-wainscot-${sideIndex === 0 ? "back" : "front"}`}
          surfaceKey={sideIndex === 0 ? "wall-back" : "wall-front"}
        >
        <group>
          {(sideIndex === 0 ? backLongX : frontLongX).map((x, i) => (
            <mesh key={`wainscot-long-panel-${String(sideIndex)}-${String(i)}`} position={[x, WAINSCOT_PANEL_Y, z]}>
              <boxGeometry args={[(width / 12) * 0.72, WAINSCOT_PANEL_HEIGHT, 0.055]} />
              <meshStandardMaterial color={i % 2 === 0 ? PANEL_DARK_OAK : PANEL_SHADOW} roughness={0.74} metalness={0} />
            </mesh>
          ))}
          {(sideIndex === 0 ? backLongChairRailSegments : frontLongChairRailSegments).map((segment, i) => (
            <mesh
              key={`wainscot-long-chair-rail-${String(sideIndex)}-${String(i)}`}
              name={sideIndex === 0 ? "back-long-wall-chair-rail" : "front-long-wall-door-interrupted-chair-rail"}
              position={[segment.centerX, longChairRailY, z]}
            >
              <boxGeometry args={[segment.width, 0.1, 0.075]} />
              <meshStandardMaterial color={BRASS_GOLD} roughness={0.45} metalness={0.25} />
            </mesh>
          ))}
        </group>
        </SurfaceVisibilityGroup>
      ))}

      {[-halfW + WAINSCOT_PANEL_INSET, halfW - WAINSCOT_PANEL_INSET].map((x, sideIndex) => (
        <SurfaceVisibilityGroup
          key={`wainscot-short-${String(sideIndex)}`}
          name={`raised-wainscot-${sideIndex === 0 ? "left" : "right"}`}
          surfaceKey={sideIndex === 0 ? "wall-left" : "wall-right"}
        >
        <group>
          {(sideIndex === 0 ? leftShortZ : rightShortZ).map((z, i) => (
            <mesh key={`wainscot-short-panel-${String(sideIndex)}-${String(i)}`} position={[x, WAINSCOT_PANEL_Y, z]}>
              <boxGeometry args={[0.055, WAINSCOT_PANEL_HEIGHT, shortPanelSpacing * 0.72]} />
              <meshStandardMaterial color={i % 2 === 0 ? PANEL_DARK_OAK : PANEL_SHADOW} roughness={0.74} metalness={0} />
            </mesh>
          ))}
          <mesh position={[x, WAINSCOT_PANEL_Y + WAINSCOT_PANEL_HEIGHT / 2 + 0.12, 0]}>
            <boxGeometry args={[0.075, 0.1, length - 0.65]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.45} metalness={0.25} />
          </mesh>
        </group>
        </SurfaceVisibilityGroup>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Gold trade frieze — continuous upper-wall band with abstract trade plaques
// ---------------------------------------------------------------------------

interface TradeFriezeProps {
  readonly width: number;
  readonly length: number;
  readonly height: number;
}

function TradeFrieze({ width, length, height }: TradeFriezeProps): React.ReactElement {
  const halfW = width / 2;
  const halfL = length / 2;
  const y = height - 1.72;
  const bandHeight = 0.68;
  const longFigures = 26;
  const shortFigures = 8;
  const figureX = useMemo(
    () => Array.from({ length: longFigures }, (_, i) => -width / 2 + (width / longFigures) * (i + 0.5)),
    [width],
  );
  const figureZ = useMemo(
    () => Array.from({ length: shortFigures }, (_, i) => -length / 2 + (length / shortFigures) * (i + 0.5)),
    [length],
  );

  return (
    <group name="ochre-mural-frieze">
      {[-halfL + 0.04, halfL - 0.04].map((z, sideIndex) => (
        <SurfaceVisibilityGroup
          key={`frieze-z-${String(sideIndex)}`}
          name={`frieze-${sideIndex === 0 ? "back" : "front"}`}
          surfaceKey={sideIndex === 0 ? "wall-back" : "wall-front"}
        >
        <group>
          <mesh position={[0, y, z]}>
            <boxGeometry args={[width, bandHeight, 0.035]} />
            <meshStandardMaterial color={MURAL_GOLD} roughness={0.76} metalness={0.02} />
          </mesh>
          <mesh position={[0, y + bandHeight / 2 + 0.18, z]}>
            <boxGeometry args={[width, 0.32, 0.055]} />
            <meshStandardMaterial color={PANEL_DARK_OAK} roughness={0.68} metalness={0.03} />
          </mesh>
          <mesh position={[0, y - bandHeight / 2 - 0.03, z + (sideIndex === 0 ? 0.018 : -0.018)]}>
            <boxGeometry args={[width, 0.045, 0.035]} />
            <meshStandardMaterial color={UNDERLIGHT} emissive={UNDERLIGHT} emissiveIntensity={0.34} roughness={0.36} metalness={0} />
          </mesh>
          <Instances limit={figureX.length} range={figureX.length} name={`frieze-long-figure-bodies-${String(sideIndex)}`}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={MURAL_SHADOW} roughness={0.82} metalness={0} />
            {figureX.map((x, i) => (
              <Instance
                key={`frieze-figure-z-body-${String(sideIndex)}-${String(i)}`}
                position={[x, y - 0.05, z + (sideIndex === 0 ? 0.032 : -0.032)]}
                scale={[0.08, 0.32 + (i % 3) * 0.035, 0.026]}
              />
            ))}
          </Instances>
          <Instances limit={figureX.length} range={figureX.length} name={`frieze-long-figure-heads-${String(sideIndex)}`}>
            <sphereGeometry args={[0.055, 8, 8]} />
            <meshStandardMaterial color={MURAL_SHADOW} roughness={0.82} metalness={0} />
            {figureX.map((x, i) => (
              <Instance
                key={`frieze-figure-z-head-${String(sideIndex)}-${String(i)}`}
                position={[x, y + 0.16, z + (sideIndex === 0 ? 0.032 : -0.032)]}
              />
            ))}
          </Instances>
        </group>
        </SurfaceVisibilityGroup>
      ))}

      {[-halfW + 0.04, halfW - 0.04].map((x, sideIndex) => (
        <SurfaceVisibilityGroup
          key={`frieze-x-${String(sideIndex)}`}
          name={`frieze-${sideIndex === 0 ? "left" : "right"}`}
          surfaceKey={sideIndex === 0 ? "wall-left" : "wall-right"}
        >
        <group>
          <mesh position={[x, y, 0]}>
            <boxGeometry args={[0.035, bandHeight, length]} />
            <meshStandardMaterial color={MURAL_GOLD} roughness={0.76} metalness={0.02} />
          </mesh>
          <mesh position={[x, y + bandHeight / 2 + 0.18, 0]}>
            <boxGeometry args={[0.055, 0.32, length]} />
            <meshStandardMaterial color={PANEL_DARK_OAK} roughness={0.68} metalness={0.03} />
          </mesh>
          <mesh position={[x + (sideIndex === 0 ? 0.018 : -0.018), y - bandHeight / 2 - 0.03, 0]}>
            <boxGeometry args={[0.035, 0.045, length]} />
            <meshStandardMaterial color={UNDERLIGHT} emissive={UNDERLIGHT} emissiveIntensity={0.34} roughness={0.36} metalness={0} />
          </mesh>
          <Instances limit={figureZ.length} range={figureZ.length} name={`frieze-short-figure-bodies-${String(sideIndex)}`}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={MURAL_SHADOW} roughness={0.82} metalness={0} />
            {figureZ.map((z, i) => (
              <Instance
                key={`frieze-figure-x-body-${String(sideIndex)}-${String(i)}`}
                position={[x + (sideIndex === 0 ? 0.032 : -0.032), y - 0.05, z]}
                scale={[0.026, 0.32 + (i % 3) * 0.035, 0.08]}
              />
            ))}
          </Instances>
          <Instances limit={figureZ.length} range={figureZ.length} name={`frieze-short-figure-heads-${String(sideIndex)}`}>
            <sphereGeometry args={[0.055, 8, 8]} />
            <meshStandardMaterial color={MURAL_SHADOW} roughness={0.82} metalness={0} />
            {figureZ.map((z, i) => (
              <Instance
                key={`frieze-figure-x-head-${String(sideIndex)}-${String(i)}`}
                position={[x + (sideIndex === 0 ? 0.032 : -0.032), y + 0.16, z]}
              />
            ))}
          </Instances>
        </group>
        </SurfaceVisibilityGroup>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Pilasters — decorative ivory columns between window bays
// ---------------------------------------------------------------------------

const PILASTER_W = 0.32;
const PILASTER_DEPTH = 0.12;
const CAPITAL_HEIGHT = 0.32;
const BASE_HEIGHT = 0.22;

// ---------------------------------------------------------------------------
// Arched window facade — visual cue, not a real window cutout
// ---------------------------------------------------------------------------

const WINDOW_HEIGHT = 4.55;
const WINDOW_WIDTH = 2.45;
export const WINDOW_SILL_Y = 2.15;
const WINDOW_INSET = 0.04;
const WINDOW_FRAME_THICKNESS = 0.12;

interface BoxBatchTransform {
  readonly key: string;
  readonly position: [number, number, number];
  readonly scale: [number, number, number];
  readonly rotation?: [number, number, number];
}

interface WindowWallOrnamentsProps {
  readonly windowX: readonly number[];
  readonly pilasterX: readonly number[];
  readonly windowWallZ: number;
  readonly pilasterWallZ: number;
  readonly height: number;
}

function WindowWallOrnaments({
  windowX,
  pilasterX,
  windowWallZ,
  pilasterWallZ,
  height,
}: WindowWallOrnamentsProps): React.ReactElement {
  const archRadius = WINDOW_WIDTH / 2;
  const rectHeight = WINDOW_HEIGHT - archRadius;
  const curtainHeight = rectHeight + 0.55;
  const curtainY = WINDOW_SILL_Y + curtainHeight / 2 - 0.12;
  const batches = useMemo(() => {
    const trim: BoxBatchTransform[] = [];
    const brass: BoxBatchTransform[] = [];
    const curtains: BoxBatchTransform[] = [];
    const curtainShadows: BoxBatchTransform[] = [];
    const highlights: BoxBatchTransform[] = [];
    const frameShadows: BoxBatchTransform[] = [];
    const shaftHeight = height - CAPITAL_HEIGHT - BASE_HEIGHT;

    for (const [index, x] of pilasterX.entries()) {
      const prefix = `window-wall-pilaster-${String(index)}`;
      trim.push(
        {
          key: `${prefix}-base`,
          position: [x, BASE_HEIGHT / 2, pilasterWallZ],
          scale: [PILASTER_W * 1.25, BASE_HEIGHT, PILASTER_DEPTH * 1.25],
        },
        {
          key: `${prefix}-shaft`,
          position: [x, BASE_HEIGHT + shaftHeight / 2, pilasterWallZ],
          scale: [PILASTER_W, shaftHeight, PILASTER_DEPTH],
        },
        {
          key: `${prefix}-capital`,
          position: [x, BASE_HEIGHT + shaftHeight + CAPITAL_HEIGHT / 2, pilasterWallZ],
          scale: [PILASTER_W * 1.4, CAPITAL_HEIGHT * 0.7, PILASTER_DEPTH * 1.4],
        },
      );
      brass.push({
        key: `${prefix}-capital-band`,
        position: [x, BASE_HEIGHT + shaftHeight + CAPITAL_HEIGHT * 0.85, pilasterWallZ],
        scale: [PILASTER_W * 1.45, CAPITAL_HEIGHT * 0.18, PILASTER_DEPTH * 1.45],
      });
    }

    for (const [index, x] of windowX.entries()) {
      const prefix = `arched-window-${String(index)}`;
      curtains.push(
        {
          key: `${prefix}-curtain-left`,
          position: [x - WINDOW_WIDTH / 2 - 0.22, curtainY, windowWallZ + WINDOW_INSET + 0.018],
          scale: [0.34, curtainHeight, 0.035],
        },
        {
          key: `${prefix}-curtain-right`,
          position: [x + WINDOW_WIDTH / 2 + 0.22, curtainY, windowWallZ + WINDOW_INSET + 0.018],
          scale: [0.34, curtainHeight, 0.035],
        },
      );
      curtainShadows.push(
        {
          key: `${prefix}-curtain-shadow-left`,
          position: [x - WINDOW_WIDTH / 2 - 0.04, curtainY, windowWallZ + WINDOW_INSET + 0.021],
          scale: [0.055, curtainHeight * 0.92, 0.038],
        },
        {
          key: `${prefix}-curtain-shadow-right`,
          position: [x + WINDOW_WIDTH / 2 + 0.04, curtainY, windowWallZ + WINDOW_INSET + 0.021],
          scale: [0.055, curtainHeight * 0.92, 0.038],
        },
      );
      brass.push({
        key: `${prefix}-pelmet`,
        position: [x, WINDOW_SILL_Y + rectHeight + 0.22, windowWallZ + WINDOW_INSET + 0.02],
        scale: [WINDOW_WIDTH + 0.74, 0.16, 0.045],
      });
      highlights.push(
        {
          key: `${prefix}-glass-highlight-left`,
          position: [x - 0.28, WINDOW_SILL_Y + rectHeight * 0.7, windowWallZ + WINDOW_INSET + 0.034],
          scale: [0.035, rectHeight * 0.42, 0.012],
          rotation: [0, 0, -0.28],
        },
        {
          key: `${prefix}-glass-highlight-right`,
          position: [x + 0.26, WINDOW_SILL_Y + rectHeight * 0.36, windowWallZ + WINDOW_INSET + 0.034],
          scale: [0.035, rectHeight * 0.42, 0.012],
          rotation: [0, 0, -0.28],
        },
      );
      trim.push(
        {
          key: `${prefix}-frame-left`,
          position: [x - WINDOW_WIDTH / 2 + WINDOW_FRAME_THICKNESS / 2, WINDOW_SILL_Y + rectHeight / 2, windowWallZ + WINDOW_INSET + 0.01],
          scale: [WINDOW_FRAME_THICKNESS, rectHeight, 0.02],
        },
        {
          key: `${prefix}-frame-right`,
          position: [x + WINDOW_WIDTH / 2 - WINDOW_FRAME_THICKNESS / 2, WINDOW_SILL_Y + rectHeight / 2, windowWallZ + WINDOW_INSET + 0.01],
          scale: [WINDOW_FRAME_THICKNESS, rectHeight, 0.02],
        },
        {
          key: `${prefix}-sill`,
          position: [x, WINDOW_SILL_Y, windowWallZ + WINDOW_INSET + 0.02],
          scale: [WINDOW_WIDTH + 0.16, 0.12, 0.06],
        },
        {
          key: `${prefix}-horizontal-mullion`,
          position: [x, WINDOW_SILL_Y + rectHeight / 2, windowWallZ + WINDOW_INSET + 0.01],
          scale: [WINDOW_WIDTH - 0.1, 0.08, 0.02],
        },
        {
          key: `${prefix}-vertical-mullion`,
          position: [x, WINDOW_SILL_Y + rectHeight / 2, windowWallZ + WINDOW_INSET + 0.01],
          scale: [0.08, rectHeight, 0.02],
        },
      );
      frameShadows.push(
        {
          key: `${prefix}-horizontal-shadow-lower`,
          position: [x, WINDOW_SILL_Y + rectHeight * 0.28, windowWallZ + WINDOW_INSET + 0.012],
          scale: [WINDOW_WIDTH - 0.14, 0.045, 0.018],
        },
        {
          key: `${prefix}-horizontal-shadow-upper`,
          position: [x, WINDOW_SILL_Y + rectHeight * 0.72, windowWallZ + WINDOW_INSET + 0.012],
          scale: [WINDOW_WIDTH - 0.14, 0.045, 0.018],
        },
        {
          key: `${prefix}-vertical-shadow-left`,
          position: [x - WINDOW_WIDTH * 0.24, WINDOW_SILL_Y + rectHeight / 2, windowWallZ + WINDOW_INSET + 0.012],
          scale: [0.04, rectHeight * 0.9, 0.018],
        },
        {
          key: `${prefix}-vertical-shadow-right`,
          position: [x + WINDOW_WIDTH * 0.24, WINDOW_SILL_Y + rectHeight / 2, windowWallZ + WINDOW_INSET + 0.012],
          scale: [0.04, rectHeight * 0.9, 0.018],
        },
      );
    }

    return { trim, brass, curtains, curtainShadows, highlights, frameShadows };
  }, [curtainHeight, curtainY, height, pilasterWallZ, pilasterX, rectHeight, windowWallZ, windowX]);

  return (
    <group name="panorama-calibrated-window-wall-batches">
      {/* Pale gathered drapes and brass pelmet: the reference photos show
          cream curtains inside the arched bays, not red side swags. */}
      <Instances limit={batches.curtains.length} range={batches.curtains.length} name="arched-window-cream-curtains">
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={CURTAIN_CREAM} roughness={0.88} metalness={0} />
        {batches.curtains.map((part) => <Instance key={part.key} position={part.position} scale={part.scale} />)}
      </Instances>
      <Instances limit={batches.curtainShadows.length} range={batches.curtainShadows.length} name="arched-window-curtain-shadows">
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={CURTAIN_SHADOW} roughness={0.9} metalness={0} />
        {batches.curtainShadows.map((part) => <Instance key={part.key} position={part.position} scale={part.scale} />)}
      </Instances>
      <Instances limit={batches.brass.length} range={batches.brass.length} name="arched-window-pelmet-and-pilaster-capital-bands">
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={BRASS_GOLD} roughness={0.4} metalness={0.35} />
        {batches.brass.map((part) => <Instance key={part.key} position={part.position} scale={part.scale} />)}
      </Instances>
      {/* Daylight backing behind the actual translucent glass. */}
      <Instances limit={windowX.length} range={windowX.length} name="arched-window-daylight-pane-rect">
        <planeGeometry args={[WINDOW_WIDTH - 0.08, rectHeight]} />
        <meshStandardMaterial
          color={WINDOW_GLOW}
          emissive={WINDOW_GLOW}
          emissiveIntensity={0.55}
          roughness={0.4}
          metalness={0}
        />
        {windowX.map((x, i) => (
          <Instance key={`window-daylight-rect-${String(i)}`} position={[x, WINDOW_SILL_Y + rectHeight / 2, windowWallZ + WINDOW_INSET]} />
        ))}
      </Instances>
      <Instances limit={windowX.length} range={windowX.length} name="arched-window-glass-pane-rect">
        <planeGeometry args={[WINDOW_WIDTH - 0.22, rectHeight - 0.12]} />
        <meshStandardMaterial
          color={GLASS_BLUE}
          emissive={WINDOW_GLOW}
          emissiveIntensity={0.12}
          roughness={0.08}
          metalness={0.04}
          transparent
          opacity={0.42}
          depthWrite={false}
          side={DoubleSide}
        />
        {windowX.map((x, i) => (
          <Instance key={`window-glass-rect-${String(i)}`} position={[x, WINDOW_SILL_Y + rectHeight / 2, windowWallZ + WINDOW_INSET + 0.025]} />
        ))}
      </Instances>
      {/* Half-circle arch top with translucent glass layered over glow. */}
      <Instances limit={windowX.length} range={windowX.length} name="arched-window-daylight-pane-arch">
        <circleGeometry args={[archRadius - 0.04, 32, 0, Math.PI]} />
        <meshStandardMaterial
          color={WINDOW_GLOW}
          emissive={WINDOW_GLOW}
          emissiveIntensity={0.55}
          roughness={0.4}
          metalness={0}
        />
        {windowX.map((x, i) => (
          <Instance key={`window-daylight-arch-${String(i)}`} position={[x, WINDOW_SILL_Y + rectHeight, windowWallZ + WINDOW_INSET]} />
        ))}
      </Instances>
      <Instances limit={windowX.length} range={windowX.length} name="arched-window-glass-pane-arch">
        <circleGeometry args={[archRadius - 0.14, 32, 0, Math.PI]} />
        <meshStandardMaterial
          color={GLASS_BLUE}
          emissive={WINDOW_GLOW}
          emissiveIntensity={0.1}
          roughness={0.08}
          metalness={0.04}
          transparent
          opacity={0.38}
          depthWrite={false}
          side={DoubleSide}
        />
        {windowX.map((x, i) => (
          <Instance key={`window-glass-arch-${String(i)}`} position={[x, WINDOW_SILL_Y + rectHeight, windowWallZ + WINDOW_INSET + 0.026]} />
        ))}
      </Instances>
      <Instances limit={batches.highlights.length} range={batches.highlights.length} name="arched-window-glass-highlight">
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={GLASS_HIGHLIGHT} emissive={GLASS_HIGHLIGHT} emissiveIntensity={0.18} roughness={0.05} metalness={0} transparent opacity={0.34} depthWrite={false} />
        {batches.highlights.map((part) => <Instance key={part.key} position={part.position} scale={part.scale} rotation={part.rotation} />)}
      </Instances>
      <Instances limit={batches.trim.length} range={batches.trim.length} name="arched-window-frames-mullions-and-pilasters">
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.87} metalness={0} />
        {batches.trim.map((part) => <Instance key={part.key} position={part.position} scale={part.scale} />)}
      </Instances>
      <Instances limit={batches.frameShadows.length} range={batches.frameShadows.length} name="arched-window-secondary-mullions">
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={WINDOW_FRAME_SHADOW} roughness={0.85} metalness={0} />
        {batches.frameShadows.map((part) => <Instance key={part.key} position={part.position} scale={part.scale} />)}
      </Instances>
      {/* Arch frame — thin ring along the half-circle outer edge */}
      <Instances limit={windowX.length} range={windowX.length} name="arched-window-arch-frames">
        <ringGeometry args={[archRadius - 0.06, archRadius, 32, 1, 0, Math.PI]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} side={DoubleSide} />
        {windowX.map((x, i) => (
          <Instance key={`window-arch-frame-${String(i)}`} position={[x, WINDOW_SILL_Y + rectHeight, windowWallZ + WINDOW_INSET + 0.01]} />
        ))}
      </Instances>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Opposite-wall double doors — three ornate timber sets facing the window wall
// ---------------------------------------------------------------------------

function OppositeLongWallDoors({ width, length }: { readonly width: number; readonly length: number }): React.ReactElement {
  const z = length / 2 - 0.085;
  const batches = useMemo(() => {
    const darkOak: BoxBatchTransform[] = [];
    const highlight: BoxBatchTransform[] = [];
    const timber: BoxBatchTransform[] = [];
    const shadow: BoxBatchTransform[] = [];
    const handles: BoxBatchTransform[] = [];
    const leafWidth = (FRONT_DOOR_WIDTH - 0.08) / 2;
    const leafCenterX = leafWidth / 2 + 0.02;
    const doorY = FRONT_DOOR_HEIGHT / 2;

    for (const [doorIndex, doorX] of computeOppositeLongWallDoorCenters(width).entries()) {
      const prefix = `front-door-${String(doorIndex)}`;
      darkOak.push(
        {
          key: `${prefix}-frame-left`,
          position: [doorX - FRONT_DOOR_WIDTH / 2 - FRONT_DOOR_FRAME / 2, doorY, z],
          scale: [FRONT_DOOR_FRAME, FRONT_DOOR_HEIGHT + 0.22, FRONT_DOOR_DEPTH * 1.35],
        },
        {
          key: `${prefix}-frame-right`,
          position: [doorX + FRONT_DOOR_WIDTH / 2 + FRONT_DOOR_FRAME / 2, doorY, z],
          scale: [FRONT_DOOR_FRAME, FRONT_DOOR_HEIGHT + 0.22, FRONT_DOOR_DEPTH * 1.35],
        },
        {
          key: `${prefix}-top-rail`,
          position: [doorX, FRONT_DOOR_HEIGHT + 0.1, z],
          scale: [FRONT_DOOR_WIDTH + FRONT_DOOR_FRAME * 2.2, 0.2, FRONT_DOOR_DEPTH * 1.42],
        },
        {
          key: `${prefix}-threshold`,
          position: [doorX, 0.05, z - 0.015],
          scale: [FRONT_DOOR_WIDTH + FRONT_DOOR_FRAME * 2.3, 0.1, FRONT_DOOR_DEPTH * 1.55],
        },
      );
      highlight.push({
        key: `${prefix}-cornice`,
        position: [doorX, FRONT_DOOR_HEIGHT + 0.28, z - 0.01],
        scale: [FRONT_DOOR_WIDTH + FRONT_DOOR_FRAME * 2.9, 0.12, FRONT_DOOR_DEPTH * 1.72],
      });

      for (const [leafIndex, leafOffsetX] of [-leafCenterX, leafCenterX].entries()) {
        const leafX = doorX + leafOffsetX;
        const leafZ = z - 0.012;
        timber.push({
          key: `${prefix}-leaf-${String(leafIndex)}`,
          position: [leafX, doorY, leafZ],
          scale: [leafWidth, FRONT_DOOR_HEIGHT, FRONT_DOOR_DEPTH],
        });

        for (const [panelIndex, panel] of [
          { y: 0.48, width: leafWidth * 0.66, height: 0.88 },
          { y: -0.58, width: leafWidth * 0.66, height: 0.72 },
        ].entries()) {
          const panelZ = leafZ - FRONT_DOOR_DEPTH * 0.72;
          highlight.push({
            key: `${prefix}-leaf-${String(leafIndex)}-panel-frame-${String(panelIndex)}`,
            position: [leafX, doorY + panel.y, panelZ],
            scale: [panel.width, panel.height, 0.035],
          });
          shadow.push({
            key: `${prefix}-leaf-${String(leafIndex)}-panel-recess-${String(panelIndex)}`,
            position: [leafX, doorY + panel.y, panelZ - 0.012],
            scale: [panel.width * 0.76, panel.height * 0.74, 0.036],
          });
        }

        highlight.push({
          key: `${prefix}-leaf-${String(leafIndex)}-stile`,
          position: [
            leafX + (leafIndex === 0 ? leafWidth / 2 - 0.03 : -leafWidth / 2 + 0.03),
            doorY,
            leafZ - FRONT_DOOR_DEPTH * 0.74,
          ],
          scale: [0.06, FRONT_DOOR_HEIGHT * 0.92, 0.034],
        });
      }

      shadow.push({
        key: `${prefix}-center-seam`,
        position: [doorX, doorY, z - FRONT_DOOR_DEPTH * 0.86],
        scale: [0.045, FRONT_DOOR_HEIGHT * 0.9, 0.036],
      });
      for (const [handleIndex, handleX] of [-0.13, 0.13].entries()) {
        handles.push({
          key: `${prefix}-handle-${String(handleIndex)}`,
          position: [doorX + handleX, 1.16, z - FRONT_DOOR_DEPTH * 1.18],
          scale: [1, 1, 1],
        });
      }
    }

    return { darkOak, highlight, timber, shadow, handles };
  }, [width, z]);

  return (
    <SurfaceVisibilityGroup surfaceKey="wall-front" name="opposite-long-wall-three-door-cluster">
      <group name="front-long-wall-door-set-batches">
        <Instances limit={batches.darkOak.length} range={batches.darkOak.length} name="grand-hall-front-wall-door-frame-left-right-top-threshold">
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={PANEL_DARK_OAK} roughness={0.58} metalness={0.02} />
          {batches.darkOak.map((part) => (
            <Instance key={part.key} position={part.position} scale={part.scale} />
          ))}
        </Instances>
        <Instances limit={batches.highlight.length} range={batches.highlight.length} name="front-wall-door-raised-panel-frame-and-vertical-stile">
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={DOOR_HIGHLIGHT} roughness={0.54} metalness={0.03} />
          {batches.highlight.map((part) => (
            <Instance key={part.key} position={part.position} scale={part.scale} />
          ))}
        </Instances>
        <Instances limit={batches.timber.length} range={batches.timber.length} name="grand-hall-front-wall-door">
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={DOOR_TIMBER} roughness={0.66} metalness={0.01} />
          {batches.timber.map((part) => (
            <Instance key={part.key} position={part.position} scale={part.scale} />
          ))}
        </Instances>
        <Instances limit={batches.shadow.length} range={batches.shadow.length} name="front-wall-door-recessed-panel-and-center-seam">
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={PANEL_SHADOW} roughness={0.7} metalness={0.01} />
          {batches.shadow.map((part) => (
            <Instance key={part.key} position={part.position} scale={part.scale} />
          ))}
        </Instances>
        <Instances limit={batches.handles.length} range={batches.handles.length} name="front-wall-door-brass-handle">
          <sphereGeometry args={[0.055, 14, 14]} />
          <meshStandardMaterial color={BRASS_GOLD} roughness={0.26} metalness={0.72} />
          {batches.handles.map((part) => (
            <Instance key={part.key} position={part.position} />
          ))}
        </Instances>
      </group>
    </SurfaceVisibilityGroup>
  );
}

// ---------------------------------------------------------------------------
// Timber coffer beams — geometric depth over the avodire ceiling texture
// ---------------------------------------------------------------------------

interface CeilingBeamProps {
  readonly width: number;
  readonly length: number;
  readonly height: number;
}

function CofferedAvodireCeiling({ width, length, height }: CeilingBeamProps): React.ReactElement {
  const halfW = width / 2;
  const halfL = length / 2;
  const y = height - 0.065;
  const opening = DOME_RADIUS + 0.72;
  const sidePanelWidth = Math.max(0.1, (width - opening * 2) / 2);
  const endPanelLength = Math.max(0.1, (length - opening * 2) / 2);

  // Each diamond coffer is four short avodire edge battens plus a bright centre
  // disc. Rendered as individual meshes that was ~5 draw calls per coffer; the
  // edges all share one geometry/material and so do the centres, so we instance
  // them — every coffer's edges collapse into a single InstancedMesh draw and
  // every coffer's centre into another, independent of coffer count.
  const cofferSize = Math.min(width / 10, length / 3.8);
  const cofferY = y - 0.028;
  const cofferEdgeSide = cofferSize * 0.74;
  const cofferEdgeOffset = cofferSize * 0.26;
  const cofferEdgeStrip = 0.045;
  const cofferCircleRadius = cofferSize * 0.09;
  const cofferCenters = useMemo(
    () => {
      const xs = Array.from({ length: 9 }, (_, i) => -halfW + (width / 10) * (i + 1));
      const zs = [-halfL * 0.55, 0, halfL * 0.55];
      return xs.flatMap((x) =>
        zs
          .filter((z) => Math.sqrt(x * x + z * z) > opening * 1.12)
          .map((z) => ({ x, z })),
      );
    },
    [halfW, halfL, width, opening],
  );
  const cofferEdges = useMemo(
    () =>
      cofferCenters.flatMap((c) =>
        [
          { dx: -cofferEdgeOffset, dz: -cofferEdgeOffset, ry: Math.PI / 4 },
          { dx: cofferEdgeOffset, dz: -cofferEdgeOffset, ry: -Math.PI / 4 },
          { dx: cofferEdgeOffset, dz: cofferEdgeOffset, ry: Math.PI / 4 },
          { dx: -cofferEdgeOffset, dz: cofferEdgeOffset, ry: -Math.PI / 4 },
        ].map((edge) => ({
          position: [c.x + edge.dx, cofferY, c.z + edge.dz] as [number, number, number],
          rotationY: edge.ry,
        })),
      ),
    [cofferCenters, cofferEdgeOffset, cofferY],
  );

  return (
    <group name="avodire-coffered-ceiling">
      {[
        {
          key: "left",
          position: [-opening - sidePanelWidth / 2, height - 0.01, 0] as const,
          size: [sidePanelWidth, 0.02, length - 0.2] as const,
        },
        {
          key: "right",
          position: [opening + sidePanelWidth / 2, height - 0.01, 0] as const,
          size: [sidePanelWidth, 0.02, length - 0.2] as const,
        },
        {
          key: "back",
          position: [0, height - 0.01, -opening - endPanelLength / 2] as const,
          size: [opening * 2, 0.02, endPanelLength] as const,
        },
        {
          key: "front",
          position: [0, height - 0.01, opening + endPanelLength / 2] as const,
          size: [opening * 2, 0.02, endPanelLength] as const,
        },
      ].map((panel) => (
        <mesh key={`ceiling-panel-${panel.key}`} position={[panel.position[0], panel.position[1], panel.position[2]]}>
          <boxGeometry args={[panel.size[0], panel.size[1], panel.size[2]]} />
          <meshStandardMaterial color={CEILING_COLOR} roughness={0.78} metalness={0.04} />
        </mesh>
      ))}
      <mesh position={[0, height + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[DOME_RADIUS + 0.34, opening * 1.44, 72]} />
        <meshStandardMaterial color={DOME_COLOR} roughness={0.72} metalness={0.08} side={DoubleSide} />
      </mesh>
      {[-halfL * 0.78, halfL * 0.78].map((z, i) => (
        <mesh key={`ceiling-beam-long-${String(i)}`} position={[0, y, z]}>
          <boxGeometry args={[width - 0.8, 0.12, 0.18]} />
          <meshStandardMaterial color={AVODIRE_BEAM} roughness={0.68} metalness={0.02} />
        </mesh>
      ))}
      {[-halfW * 0.74, -halfW * 0.5, -halfW * 0.26, halfW * 0.26, halfW * 0.5, halfW * 0.74].map((x, i) => (
        <mesh key={`ceiling-beam-cross-${String(i)}`} position={[x, y - 0.004, 0]}>
          <boxGeometry args={[0.18, 0.12, length - 0.8]} />
          <meshStandardMaterial color={AVODIRE_BEAM} roughness={0.68} metalness={0.02} />
        </mesh>
      ))}
      {cofferEdges.length > 0 && (
        <Instances limit={cofferEdges.length} range={cofferEdges.length} name="ceiling-diamond-edges">
          <boxGeometry args={[cofferEdgeSide, 0.035, cofferEdgeStrip]} />
          <meshStandardMaterial color={AVODIRE_BEAM} roughness={0.68} metalness={0.02} />
          {cofferEdges.map((edge, i) => (
            <Instance key={`ceiling-diamond-edge-${String(i)}`} position={edge.position} rotation={[0, edge.rotationY, 0]} />
          ))}
        </Instances>
      )}
      {cofferCenters.length > 0 && (
        <Instances limit={cofferCenters.length} range={cofferCenters.length} name="ceiling-diamond-centres">
          <circleGeometry args={[cofferCircleRadius, 8]} />
          <meshStandardMaterial color={AVODIRE_HIGHLIGHT} roughness={0.46} metalness={0.22} side={DoubleSide} />
          {cofferCenters.map((c, i) => (
            <Instance key={`ceiling-diamond-centre-${String(i)}`} position={[c.x, cofferY + 0.004, c.z]} rotation={[-Math.PI / 2, 0, 0]} />
          ))}
        </Instances>
      )}
      <mesh position={[0, y - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[DOME_RADIUS + 0.7, 0.075, 12, 80]} />
        <meshStandardMaterial color={AVODIRE_HIGHLIGHT} roughness={0.46} metalness={0.22} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Wall art and fireplace
// ---------------------------------------------------------------------------

interface WallMountProps {
  readonly position: readonly [number, number, number];
  readonly axis: "x" | "z";
  readonly frameColor?: string;
  readonly pictureColor?: string;
}

function WallPortrait({
  position,
  axis,
  frameColor = BRASS_GOLD,
  pictureColor = PORTRAIT_DARK,
}: WallMountProps): React.ReactElement {
  const frameArgs: readonly [number, number, number] = axis === "x" ? [0.06, 1.08, 0.78] : [0.78, 1.08, 0.06];
  const pictureArgs: readonly [number, number, number] = axis === "x" ? [0.07, 0.82, 0.56] : [0.56, 0.82, 0.07];

  return (
    <group position={[position[0], position[1], position[2]]}>
      <mesh>
        <boxGeometry args={[frameArgs[0], frameArgs[1], frameArgs[2]]} />
        <meshStandardMaterial color={frameColor} roughness={0.35} metalness={0.45} />
      </mesh>
      <mesh>
        <boxGeometry args={[pictureArgs[0], pictureArgs[1], pictureArgs[2]]} />
        <meshStandardMaterial color={pictureColor} roughness={0.78} metalness={0} />
      </mesh>
    </group>
  );
}

function EndWallFocalPoint({ width, length }: { readonly width: number; readonly length: number }): React.ReactElement {
  const fireplaceX = -width / 2 + 0.18;
  const boardZ = length * 0.24;
  const fireboxBackX = fireplaceX - 0.035;
  const fireplaceFaceX = fireplaceX + 0.035;

  return (
    <group name="end-wall-focal-points">
      {/* Far short-end fireplace and portrait/honour-board composition. */}
      <SurfaceVisibilityGroup surfaceKey="wall-left" name="left-end-wall-focal-point">
        <group name="left-fireplace-realistic-surround">
          <mesh name="left-fireplace-back-marble-slab" position={[fireplaceX - 0.012, 0.72, 0]}>
            <boxGeometry args={[0.055, 1.28, 2.12]} />
            <meshStandardMaterial color="#ece5d5" roughness={0.34} metalness={0} />
          </mesh>
          <mesh name="left-fireplace-left-jamb" position={[fireplaceFaceX, 0.64, -0.82]}>
            <boxGeometry args={[0.2, 1.08, 0.28]} />
            <meshStandardMaterial color={MARBLE_WHITE} roughness={0.36} metalness={0} />
          </mesh>
          <mesh name="left-fireplace-right-jamb" position={[fireplaceFaceX, 0.64, 0.82]}>
            <boxGeometry args={[0.2, 1.08, 0.28]} />
            <meshStandardMaterial color={MARBLE_WHITE} roughness={0.36} metalness={0} />
          </mesh>
          <mesh name="left-fireplace-inner-left-return" position={[fireboxBackX + 0.01, 0.54, -0.51]}>
            <boxGeometry args={[0.08, 0.72, 0.055]} />
            <meshStandardMaterial color={SOOT_SHADOW} roughness={0.86} metalness={0} />
          </mesh>
          <mesh name="left-fireplace-inner-right-return" position={[fireboxBackX + 0.01, 0.54, 0.51]}>
            <boxGeometry args={[0.08, 0.72, 0.055]} />
            <meshStandardMaterial color={SOOT_SHADOW} roughness={0.86} metalness={0} />
          </mesh>
          <mesh name="left-fireplace-header" position={[fireplaceFaceX, 1.08, 0]}>
            <boxGeometry args={[0.2, 0.26, 1.78]} />
            <meshStandardMaterial color={MARBLE_WHITE} roughness={0.34} metalness={0} />
          </mesh>
          <mesh name="left-fireplace-firebox-arch" position={[fireplaceFaceX + 0.011, 0.75, 0]} rotation={[0, Math.PI / 2, 0]}>
            <ringGeometry args={[0.43, 0.52, 36, 2, 0, Math.PI]} />
            <meshStandardMaterial color="#efe8d9" roughness={0.32} metalness={0} side={DoubleSide} />
          </mesh>
          <mesh name="left-fireplace-hearth" position={[fireplaceX + 0.12, 0.08, 0]}>
            <boxGeometry args={[0.42, 0.13, 2.28]} />
            <meshStandardMaterial color="#e7dfcf" roughness={0.38} metalness={0} />
          </mesh>
          <mesh name="left-fireplace-hearth-front-lip" position={[fireplaceX + 0.31, 0.17, 0]}>
            <boxGeometry args={[0.08, 0.08, 2.36]} />
            <meshStandardMaterial color="#d8cfbd" roughness={0.35} metalness={0} />
          </mesh>
          <mesh name="left-fireplace-mantel" position={[fireplaceX + 0.08, 1.27, 0]}>
            <boxGeometry args={[0.34, 0.16, 2.34]} />
            <meshStandardMaterial color={MARBLE_WHITE} roughness={0.3} metalness={0} />
          </mesh>
          <mesh name="left-fireplace-mantel-shadow-line" position={[fireplaceX + 0.23, 1.17, 0]}>
            <boxGeometry args={[0.035, 0.055, 2.12]} />
            <meshStandardMaterial color="#cbbfa9" roughness={0.5} metalness={0} />
          </mesh>
          <mesh name="left-firebox-back-panel" position={[fireboxBackX, 0.5, 0]}>
            <boxGeometry args={[0.04, 0.62, 1.02]} />
            <meshStandardMaterial color={FIREBOX_DARK} roughness={0.88} metalness={0} />
          </mesh>
          {[-0.32, -0.1, 0.12, 0.34].map((z, i) => (
            <mesh key={`left-fireplace-grate-bar-${String(i)}`} name="left-fireplace-brass-grate-bar" position={[fireplaceX + 0.18, 0.31, z]}>
              <boxGeometry args={[0.04, 0.34, 0.025]} />
              <meshStandardMaterial color={BRONZE_DARK} roughness={0.34} metalness={0.46} />
            </mesh>
          ))}
          <mesh name="left-fireplace-front-grate-rail" position={[fireplaceX + 0.2, 0.24, 0]}>
            <boxGeometry args={[0.045, 0.035, 0.94]} />
            <meshStandardMaterial color={BRONZE_DARK} roughness={0.34} metalness={0.46} />
          </mesh>
          {[-0.18, 0.18].map((z, i) => (
            <mesh key={`left-fireplace-log-${String(i)}`} name="left-fireplace-charred-log" position={[fireplaceX + 0.13, 0.26, z]} rotation={[Math.PI / 2, 0, i === 0 ? 0.16 : -0.16]}>
              <cylinderGeometry args={[0.045, 0.055, 0.55, 10]} />
              <meshStandardMaterial color="#2f1b0f" roughness={0.82} metalness={0} />
            </mesh>
          ))}
          <mesh name="left-fireplace-ember-glow" position={[fireplaceX + 0.145, 0.22, 0]}>
            <boxGeometry args={[0.035, 0.045, 0.52]} />
            <meshStandardMaterial color={EMBER_ORANGE} emissive={EMBER_ORANGE} emissiveIntensity={0.45} roughness={0.55} metalness={0} />
          </mesh>
          {[
            { y: 0.86, z: -0.72, rz: -0.2, w: 0.52 },
            { y: 1.19, z: 0.54, rz: 0.16, w: 0.68 },
            { y: 0.38, z: 0.73, rz: -0.12, w: 0.38 },
          ].map((vein, i) => (
            <mesh key={`left-fireplace-marble-vein-${String(i)}`} name="left-fireplace-marble-vein" position={[fireplaceX + 0.205, vein.y, vein.z]} rotation={[0, 0, vein.rz]}>
              <boxGeometry args={[0.012, 0.018, vein.w]} />
              <meshStandardMaterial color="#b9afa1" roughness={0.5} metalness={0} />
            </mesh>
          ))}
        </group>
        <WallPortrait position={[fireplaceX + 0.05, 3.15, 0]} axis="x" pictureColor="#3a2b20" />
        <WallPortrait position={[fireplaceX + 0.04, 2.55, -boardZ]} axis="x" frameColor={PANEL_DARK_OAK} pictureColor="#20140c" />
        <WallPortrait position={[fireplaceX + 0.04, 2.55, boardZ]} axis="x" frameColor={PANEL_DARK_OAK} pictureColor="#20140c" />
      </SurfaceVisibilityGroup>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Ceiling rosette ring around the dome base
// ---------------------------------------------------------------------------

interface RosetteProps {
  readonly y: number;
  readonly radius: number;
}

function CeilingRosetteRing({ y, radius }: RosetteProps): React.ReactElement {
  const tradeCount = 14;

  return (
    <group position={[0, y, 0]} name="ceiling-rosette">
      {/* Outer brass ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
        <ringGeometry args={[radius + 0.05, radius + 0.55, 64]} />
        <meshStandardMaterial color={BRASS_GOLD} roughness={0.4} metalness={0.5} side={2} />
      </mesh>
      {/* Burgundy frieze band inside the brass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]}>
        <ringGeometry args={[radius + 0.18, radius + 0.42, 64]} />
        <meshStandardMaterial color={BURGUNDY} roughness={0.7} metalness={0} side={2} />
      </mesh>
      {/* Fourteen shields nod to the Incorporated Trades around the dome. */}
      {Array.from({ length: tradeCount }).map((_, i) => {
        const a = (i / tradeCount) * Math.PI * 2;
        const r = radius + 0.3;
        return (
          <mesh
            key={`trade-shield-${String(i)}`}
            position={[Math.cos(a) * r, -0.003, Math.sin(a) * r]}
            rotation={[-Math.PI / 2, 0, -a]}
          >
            <circleGeometry args={[0.095, 5]} />
            <meshStandardMaterial
              color={i % 4 === 0 ? AVODIRE_HIGHLIGHT : BRASS_GOLD}
              roughness={0.35}
              metalness={0.55}
              side={DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Chandelier — hanging brass + crystal under the dome
// ---------------------------------------------------------------------------

interface ChandelierProps {
  readonly anchorY: number;   // ceiling height where the rod attaches
  readonly dropLength: number; // how far below anchor the chandelier hangs
  readonly x?: number;
  readonly z?: number;
  readonly scale?: number;
}

function Chandelier({ anchorY, dropLength, x = 0, z = 0, scale = 1 }: ChandelierProps): React.ReactElement {
  const ringY = anchorY - dropLength;
  const ringRadius = 0.84;
  const drops = useMemo(() => {
    const pts: Array<{ x: number; z: number; y: number }> = [];
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push({
        x: Math.cos(a) * ringRadius,
        z: Math.sin(a) * ringRadius,
        y: -0.18 - (i % 3) * 0.08,
      });
    }
    return pts;
  }, [ringRadius]);

  return (
    <group name="chandelier" position={[x, 0, z]} scale={[scale, 1, scale]}>
      {/* Brass suspension rod */}
      <mesh position={[0, anchorY - dropLength / 2, 0]}>
        <cylinderGeometry args={[0.025, 0.025, dropLength, 16]} />
        <meshStandardMaterial color={BRASS_GOLD} roughness={0.35} metalness={0.7} />
      </mesh>
      {/* Top ceiling rose where the rod meets the dome */}
      <mesh position={[0, anchorY - 0.05, 0]}>
        <cylinderGeometry args={[0.18, 0.12, 0.1, 24]} />
        <meshStandardMaterial color={BRONZE_DARK} roughness={0.4} metalness={0.6} />
      </mesh>
      {/* Main brass ring */}
      <mesh position={[0, ringY, 0]}>
        <torusGeometry args={[ringRadius, 0.045, 12, 48]} />
        <meshStandardMaterial color={BRASS_GOLD} roughness={0.35} metalness={0.7} />
      </mesh>
      {/* Inner brass ring (smaller) */}
      <mesh position={[0, ringY + 0.18, 0]}>
        <torusGeometry args={[ringRadius * 0.55, 0.035, 10, 36]} />
        <meshStandardMaterial color={BRASS_GOLD} roughness={0.35} metalness={0.7} />
      </mesh>
      {/* Warm candle bulbs — emissive material only, no runtime PointLight.
          Eight identical spheres per chandelier → one instanced draw. */}
      <Instances limit={8} range={8} name="chandelier-candles">
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#ffe0a3" emissive="#f7c16b" emissiveIntensity={0.95} roughness={0.18} metalness={0} />
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <Instance key={`candle-${String(i)}`} position={[Math.cos(a) * ringRadius * 0.78, ringY + 0.08, Math.sin(a) * ringRadius * 0.78]} />
          );
        })}
      </Instances>
      {/* Crystal drops — emissive spheres; identical geometry → one instanced draw. */}
      <Instances limit={drops.length} range={drops.length} name="chandelier-drops">
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial color={CRYSTAL} emissive={CRYSTAL} emissiveIntensity={0.85} roughness={0.15} metalness={0} transparent opacity={0.95} />
        {drops.map((d, i) => (
          <Instance key={`drop-${String(i)}`} position={[d.x, ringY + d.y, d.z]} />
        ))}
      </Instances>
      {/* Central larger glow drop */}
      <mesh position={[0, ringY - 0.4, 0]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color={CRYSTAL}
          emissive={CRYSTAL}
          emissiveIntensity={1.0}
          roughness={0.1}
          metalness={0}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Brass arms — 6 arms holding the inner ring; identical → one instanced draw. */}
      <Instances limit={6} range={6} name="chandelier-arms">
        <cylinderGeometry args={[0.015, 0.015, ringRadius * 0.5, 8]} />
        <meshStandardMaterial color={BRASS_GOLD} roughness={0.35} metalness={0.7} />
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <Instance
              key={`arm-${String(i)}`}
              position={[Math.cos(a) * ringRadius * 0.75, ringY + 0.09, Math.sin(a) * ringRadius * 0.75]}
              rotation={[0, -a, Math.PI / 2]}
            />
          );
        })}
      </Instances>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Public composite
// ---------------------------------------------------------------------------

export interface GrandHallOrnamentsProps {
  readonly width?: number;
  readonly length?: number;
  readonly height?: number;
  readonly domeRadius?: number;
  /** Roofless presentation keeps hanging lights but removes ceiling occlusion. */
  readonly cutaway?: boolean;
}

/**
 * Drop-in component that adds every ornament in one group. Defaults to the
 * Grand Hall render dimensions; override per-call for ablations.
 */
export function GrandHallOrnaments({
  width = GRAND_HALL_RENDER_DIMENSIONS.width,
  length = GRAND_HALL_RENDER_DIMENSIONS.length,
  height = GRAND_HALL_RENDER_DIMENSIONS.height,
  domeRadius = DOME_RADIUS,
  cutaway = false,
}: GrandHallOrnamentsProps): React.ReactElement {
  const sectionHeight = useSectionStore((s) => s.height);
  const halfL = length / 2;
  const windowWallZ = -halfL + 0.025;

  // The floorplan's 21m side is the X axis. Three arched window bays sit on
  // one long wall, spaced along X, not mirrored onto the opposite wall.
  const windowX = useMemo(
    () => computeWindowWallCenters(width),
    [width],
  );
  const pilasterX = useMemo(
    () => [-width * 0.42, -width * 0.15, width * 0.15, width * 0.42],
    [width],
  );
  const chandelierX = useMemo(
    () => [-width * 0.28, 0, width * 0.28],
    [width],
  );
  const wallOrnamentsVisible = shouldShowWallOrnamentsForSection(sectionHeight, height);
  const ceilingOrnamentsVisible = shouldShowCeilingOrnamentsForSection(sectionHeight, height);
  const hangingLightsVisible = ceilingOrnamentsVisible || cutaway;

  return (
    <group name="grand-hall-ornaments">
      {ceilingOrnamentsVisible && !cutaway && (
        <SurfaceVisibilityGroup surfaceKey="ceiling" name="grand-hall-ceiling-ornaments">
          <CofferedAvodireCeiling width={width} length={length} height={height} />
        </SurfaceVisibilityGroup>
      )}
      {wallOrnamentsVisible && (
        <>
          <CrownMoulding width={width} length={length} wallHeight={height} />
          <Skirting width={width} length={length} />
          <WainscotRaisedPanels width={width} length={length} />
          <TradeFrieze width={width} length={length} height={height} />
          <OppositeLongWallDoors width={width} length={length} />
          <EndWallFocalPoint width={width} length={length} />
          {/* Pilasters and arched windows along the window wall only. */}
          <SurfaceVisibilityGroup surfaceKey="wall-back" name="window-wall-ornament-cluster">
            <WindowWallOrnaments
              windowX={windowX}
              pilasterX={pilasterX}
              windowWallZ={windowWallZ}
              pilasterWallZ={-halfL + 0.12}
              height={height}
            />
          </SurfaceVisibilityGroup>
        </>
      )}

      {/* Ceiling rosette ring around the dome base */}
      {ceilingOrnamentsVisible && !cutaway && (
        <SurfaceVisibilityGroup surfaceKey="ceiling" name="grand-hall-ceiling-rosette">
          <CeilingRosetteRing y={height - 0.005} radius={domeRadius} />
        </SurfaceVisibilityGroup>
      )}

      {/* Three chandeliers along the 21m hall centerline. */}
      {hangingLightsVisible
        ? chandelierX.map((x, i) => (
            <Chandelier
              key={`chandelier-${String(i)}`}
              anchorY={height - 0.08}
              dropLength={i === 1 ? 2.18 : 1.78}
              x={x}
              scale={i === 1 ? 1.08 : 0.82}
            />
          ))
        : null}
    </group>
  );
}

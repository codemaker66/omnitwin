/**
 * Grand Hall ornamental dressing.
 *
 * Layered on top of the basic 6-surface room (`GrandHallRoom`):
 *   - Crown moulding, skirting, and raised dark-timber wainscot panels
 *   - Pilasters framing the five long-wall arched windows
 *   - Curtain-dressed arched-window facades with cool daylight panes
 *   - Gold trade frieze and portrait/honour-board wall dressing
 *   - Avodire coffer beams and fourteen-trade dome ring
 *   - Five chandeliers matching the Grand Hall venue copy
 *
 * All ornaments use `meshStandardMaterial` with the project's standard
 * roughness/metalness profile — no point lights, no runtime shadows,
 * per the renderer's prebaked-lighting rule.
 */

import { useMemo } from "react";
import { DoubleSide } from "three";
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

const AVODIRE_BEAM = "#714018";
const AVODIRE_HIGHLIGHT = "#d49a55";
const PANEL_DARK_OAK = "#4a2d16";
const PANEL_SHADOW = "#2e1b0c";
const MARBLE_WHITE = "#f2eee2";
const PORTRAIT_DARK = "#2a2119";
const CURTAIN_RED = "#6f1f24";
const WINDOW_FRAME_SHADOW = "#d9cba8";

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
        <group key={`crown-z-${String(i)}`} position={[0, yCentre, z]}>
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
      ))}
      {/* Left + right walls (along X) — long bar runs the room length */}
      {[-halfW, halfW].map((x, i) => (
        <group key={`crown-x-${String(i)}`} position={[x, yCentre, 0]}>
          <mesh>
            <boxGeometry args={[CROWN_DEPTH, CROWN_HEIGHT, length]} />
            <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
          </mesh>
          <mesh position={[CROWN_DEPTH / 2 + 0.001, -CROWN_HEIGHT / 2 + CROWN_BAND_HEIGHT / 2, 0]}>
            <boxGeometry args={[0.012, CROWN_BAND_HEIGHT, length]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.45} metalness={0.3} />
          </mesh>
        </group>
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
        <mesh key={`skirt-z-${String(i)}`} position={[0, yCentre, z]}>
          <boxGeometry args={[width, SKIRT_HEIGHT, SKIRT_DEPTH]} />
          <meshStandardMaterial color="#3e2a14" roughness={0.7} metalness={0} />
        </mesh>
      ))}
      {[-halfW, halfW].map((x, i) => (
        <mesh key={`skirt-x-${String(i)}`} position={[x, yCentre, 0]}>
          <boxGeometry args={[SKIRT_DEPTH, SKIRT_HEIGHT, length]} />
          <meshStandardMaterial color="#3e2a14" roughness={0.7} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Raised wainscot panels — dark lower-wall timber rather than flat colour
// ---------------------------------------------------------------------------

const WAINSCOT_PANEL_HEIGHT = 1.55;
const WAINSCOT_PANEL_Y = 1.25;
const WAINSCOT_PANEL_INSET = 0.17;

function WainscotRaisedPanels({ width, length }: { readonly width: number; readonly length: number }): React.ReactElement {
  const halfW = width / 2;
  const halfL = length / 2;
  const longPanels = 8;
  const shortPanels = 5;
  const longSpacing = length / longPanels;
  const shortSpacing = width / shortPanels;

  const longZ = useMemo(
    () => Array.from({ length: longPanels }, (_, i) => -halfL + longSpacing * (i + 0.5)),
    [halfL, longSpacing],
  );
  const shortX = useMemo(
    () => Array.from({ length: shortPanels }, (_, i) => -halfW + shortSpacing * (i + 0.5)),
    [halfW, shortSpacing],
  );

  return (
    <group name="raised-wainscot-panels">
      {[-halfW + WAINSCOT_PANEL_INSET, halfW - WAINSCOT_PANEL_INSET].map((x, sideIndex) => (
        <group key={`wainscot-long-${String(sideIndex)}`}>
          {longZ.map((z, i) => (
            <mesh key={`wainscot-long-panel-${String(sideIndex)}-${String(i)}`} position={[x, WAINSCOT_PANEL_Y, z]}>
              <boxGeometry args={[0.055, WAINSCOT_PANEL_HEIGHT, longSpacing * 0.72]} />
              <meshStandardMaterial color={i % 2 === 0 ? PANEL_DARK_OAK : PANEL_SHADOW} roughness={0.74} metalness={0} />
            </mesh>
          ))}
          <mesh position={[x, WAINSCOT_PANEL_Y + WAINSCOT_PANEL_HEIGHT / 2 + 0.12, 0]}>
            <boxGeometry args={[0.075, 0.1, length - 0.65]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.45} metalness={0.25} />
          </mesh>
        </group>
      ))}

      {[-halfL + WAINSCOT_PANEL_INSET, halfL - WAINSCOT_PANEL_INSET].map((z, sideIndex) => (
        <group key={`wainscot-short-${String(sideIndex)}`}>
          {shortX.map((x, i) => (
            <mesh key={`wainscot-short-panel-${String(sideIndex)}-${String(i)}`} position={[x, WAINSCOT_PANEL_Y, z]}>
              <boxGeometry args={[shortSpacing * 0.72, WAINSCOT_PANEL_HEIGHT, 0.055]} />
              <meshStandardMaterial color={i % 2 === 0 ? PANEL_DARK_OAK : PANEL_SHADOW} roughness={0.74} metalness={0} />
            </mesh>
          ))}
          <mesh position={[0, WAINSCOT_PANEL_Y + WAINSCOT_PANEL_HEIGHT / 2 + 0.12, z]}>
            <boxGeometry args={[width - 0.65, 0.1, 0.075]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.45} metalness={0.25} />
          </mesh>
        </group>
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
  const y = height - 1.36;
  const bandHeight = 0.42;
  const plaques = 14;
  const plaqueX = useMemo(
    () => Array.from({ length: plaques }, (_, i) => -width / 2 + (width / plaques) * (i + 0.5)),
    [width],
  );
  const plaqueZ = useMemo(
    () => Array.from({ length: plaques }, (_, i) => -length / 2 + (length / plaques) * (i + 0.5)),
    [length],
  );

  return (
    <group name="gold-trade-frieze">
      {[-halfL + 0.04, halfL - 0.04].map((z, sideIndex) => (
        <group key={`frieze-z-${String(sideIndex)}`}>
          <mesh position={[0, y, z]}>
            <boxGeometry args={[width, bandHeight, 0.035]} />
            <meshStandardMaterial color={BURGUNDY} roughness={0.62} metalness={0.02} />
          </mesh>
          <mesh position={[0, y + bandHeight / 2 + 0.04, z]}>
            <boxGeometry args={[width, 0.055, 0.045]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.35} metalness={0.4} />
          </mesh>
          <mesh position={[0, y - bandHeight / 2 - 0.04, z]}>
            <boxGeometry args={[width, 0.055, 0.045]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.35} metalness={0.4} />
          </mesh>
          {plaqueX.map((x, i) => (
            <mesh key={`frieze-plaque-z-${String(sideIndex)}-${String(i)}`} position={[x, y, z + (sideIndex === 0 ? 0.03 : -0.03)]}>
              <boxGeometry args={[0.28, 0.28, 0.035]} />
              <meshStandardMaterial color={i % 3 === 0 ? AVODIRE_HIGHLIGHT : BRASS_GOLD} roughness={0.42} metalness={0.45} />
            </mesh>
          ))}
        </group>
      ))}

      {[-halfW + 0.04, halfW - 0.04].map((x, sideIndex) => (
        <group key={`frieze-x-${String(sideIndex)}`}>
          <mesh position={[x, y, 0]}>
            <boxGeometry args={[0.035, bandHeight, length]} />
            <meshStandardMaterial color={BURGUNDY} roughness={0.62} metalness={0.02} />
          </mesh>
          <mesh position={[x, y + bandHeight / 2 + 0.04, 0]}>
            <boxGeometry args={[0.045, 0.055, length]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.35} metalness={0.4} />
          </mesh>
          <mesh position={[x, y - bandHeight / 2 - 0.04, 0]}>
            <boxGeometry args={[0.045, 0.055, length]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.35} metalness={0.4} />
          </mesh>
          {plaqueZ.map((z, i) => (
            <mesh key={`frieze-plaque-x-${String(sideIndex)}-${String(i)}`} position={[x + (sideIndex === 0 ? 0.03 : -0.03), y, z]}>
              <boxGeometry args={[0.035, 0.28, 0.28]} />
              <meshStandardMaterial color={i % 3 === 0 ? AVODIRE_HIGHLIGHT : BRASS_GOLD} roughness={0.42} metalness={0.45} />
            </mesh>
          ))}
        </group>
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

interface PilasterProps {
  readonly position: readonly [number, number, number];
  readonly height: number;
  readonly wallAxis: "x" | "z";
}

function Pilaster({ position, height, wallAxis }: PilasterProps): React.ReactElement {
  // Long axis depends on which wall: X-aligned wall → pilaster wide on Z, etc.
  const w = wallAxis === "x" ? PILASTER_DEPTH : PILASTER_W;
  const d = wallAxis === "x" ? PILASTER_W : PILASTER_DEPTH;
  const shaftHeight = height - CAPITAL_HEIGHT - BASE_HEIGHT;

  return (
    <group position={[position[0], position[1], position[2]]}>
      {/* Base */}
      <mesh position={[0, BASE_HEIGHT / 2, 0]}>
        <boxGeometry args={[w * 1.25, BASE_HEIGHT, d * 1.25]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
      </mesh>
      {/* Shaft */}
      <mesh position={[0, BASE_HEIGHT + shaftHeight / 2, 0]}>
        <boxGeometry args={[w, shaftHeight, d]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.9} metalness={0} />
      </mesh>
      {/* Capital — slightly oversized cube + thin gold band */}
      <mesh position={[0, BASE_HEIGHT + shaftHeight + CAPITAL_HEIGHT / 2, 0]}>
        <boxGeometry args={[w * 1.4, CAPITAL_HEIGHT * 0.7, d * 1.4]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
      </mesh>
      <mesh position={[0, BASE_HEIGHT + shaftHeight + CAPITAL_HEIGHT * 0.85, 0]}>
        <boxGeometry args={[w * 1.45, CAPITAL_HEIGHT * 0.18, d * 1.45]} />
        <meshStandardMaterial color={BRASS_GOLD} roughness={0.4} metalness={0.4} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Arched window facade — visual cue, not a real window cutout
// ---------------------------------------------------------------------------

const WINDOW_HEIGHT = 4.2;
const WINDOW_WIDTH = 2.0;
const WINDOW_SILL_Y = 1.6;
const WINDOW_INSET = 0.04;
const WINDOW_FRAME_THICKNESS = 0.12;

interface WindowProps {
  readonly position: readonly [number, number, number];
  readonly rotationY: number;
}

function ArchedWindow({ position, rotationY }: WindowProps): React.ReactElement {
  const archRadius = WINDOW_WIDTH / 2;
  const rectHeight = WINDOW_HEIGHT - archRadius;
  const curtainHeight = rectHeight + 0.55;
  const curtainY = WINDOW_SILL_Y + curtainHeight / 2 - 0.12;

  return (
    <group position={[position[0], position[1], position[2]]} rotation={[0, rotationY, 0]}>
      {/* Burgundy side drapes and brass pelmet: the real room reads as a formal
          event hall, not a bare-window office. */}
      <mesh position={[-WINDOW_WIDTH / 2 - 0.22, curtainY, WINDOW_INSET + 0.018]}>
        <boxGeometry args={[0.28, curtainHeight, 0.035]} />
        <meshStandardMaterial color={CURTAIN_RED} roughness={0.86} metalness={0} />
      </mesh>
      <mesh position={[WINDOW_WIDTH / 2 + 0.22, curtainY, WINDOW_INSET + 0.018]}>
        <boxGeometry args={[0.28, curtainHeight, 0.035]} />
        <meshStandardMaterial color={CURTAIN_RED} roughness={0.86} metalness={0} />
      </mesh>
      <mesh position={[0, WINDOW_SILL_Y + rectHeight + 0.22, WINDOW_INSET + 0.02]}>
        <boxGeometry args={[WINDOW_WIDTH + 0.74, 0.16, 0.045]} />
        <meshStandardMaterial color={BRASS_GOLD} roughness={0.4} metalness={0.35} />
      </mesh>
      {/* Glow pane — emissive panel suggesting daylight outside */}
      <mesh position={[0, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET]}>
        <planeGeometry args={[WINDOW_WIDTH - 0.08, rectHeight]} />
        <meshStandardMaterial
          color={WINDOW_GLOW}
          emissive={WINDOW_GLOW}
          emissiveIntensity={0.55}
          roughness={0.4}
          metalness={0}
        />
      </mesh>
      {/* Half-circle arch top — emissive */}
      <mesh
        position={[0, WINDOW_SILL_Y + rectHeight, WINDOW_INSET]}
        rotation={[0, 0, 0]}
      >
        <circleGeometry args={[archRadius - 0.04, 32, 0, Math.PI]} />
        <meshStandardMaterial
          color={WINDOW_GLOW}
          emissive={WINDOW_GLOW}
          emissiveIntensity={0.55}
          roughness={0.4}
          metalness={0}
        />
      </mesh>
      {/* Frame — left vertical */}
      <mesh position={[-WINDOW_WIDTH / 2 + WINDOW_FRAME_THICKNESS / 2, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.01]}>
        <boxGeometry args={[WINDOW_FRAME_THICKNESS, rectHeight, 0.02]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
      </mesh>
      {/* Frame — right vertical */}
      <mesh position={[WINDOW_WIDTH / 2 - WINDOW_FRAME_THICKNESS / 2, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.01]}>
        <boxGeometry args={[WINDOW_FRAME_THICKNESS, rectHeight, 0.02]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
      </mesh>
      {/* Frame — sill */}
      <mesh position={[0, WINDOW_SILL_Y, WINDOW_INSET + 0.02]}>
        <boxGeometry args={[WINDOW_WIDTH + 0.16, 0.12, 0.06]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
      </mesh>
      {/* Frame — horizontal mullion at half height */}
      <mesh position={[0, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.01]}>
        <boxGeometry args={[WINDOW_WIDTH - 0.1, 0.08, 0.02]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
      </mesh>
      <mesh position={[0, WINDOW_SILL_Y + rectHeight * 0.28, WINDOW_INSET + 0.012]}>
        <boxGeometry args={[WINDOW_WIDTH - 0.14, 0.045, 0.018]} />
        <meshStandardMaterial color={WINDOW_FRAME_SHADOW} roughness={0.85} metalness={0} />
      </mesh>
      <mesh position={[0, WINDOW_SILL_Y + rectHeight * 0.72, WINDOW_INSET + 0.012]}>
        <boxGeometry args={[WINDOW_WIDTH - 0.14, 0.045, 0.018]} />
        <meshStandardMaterial color={WINDOW_FRAME_SHADOW} roughness={0.85} metalness={0} />
      </mesh>
      {/* Frame — vertical mullion */}
      <mesh position={[0, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.01]}>
        <boxGeometry args={[0.08, rectHeight, 0.02]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
      </mesh>
      <mesh position={[-WINDOW_WIDTH * 0.24, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.012]}>
        <boxGeometry args={[0.04, rectHeight * 0.9, 0.018]} />
        <meshStandardMaterial color={WINDOW_FRAME_SHADOW} roughness={0.85} metalness={0} />
      </mesh>
      <mesh position={[WINDOW_WIDTH * 0.24, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.012]}>
        <boxGeometry args={[0.04, rectHeight * 0.9, 0.018]} />
        <meshStandardMaterial color={WINDOW_FRAME_SHADOW} roughness={0.85} metalness={0} />
      </mesh>
      {/* Arch frame — thin ring along the half-circle outer edge */}
      <mesh position={[0, WINDOW_SILL_Y + rectHeight, WINDOW_INSET + 0.01]}>
        <ringGeometry args={[archRadius - 0.06, archRadius, 32, 1, 0, Math.PI]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} side={DoubleSide} />
      </mesh>
    </group>
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
  const lengthwiseXs = useMemo(
    () => [-halfW * 0.62, -halfW * 0.31, 0, halfW * 0.31, halfW * 0.62],
    [halfW],
  );
  const crossZs = useMemo(
    () => Array.from({ length: 7 }, (_, i) => -halfL + (length / 8) * (i + 1)),
    [halfL, length],
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
        <circleGeometry args={[opening * 1.44, 72]} />
        <meshStandardMaterial color={DOME_COLOR} roughness={0.72} metalness={0.08} side={DoubleSide} />
      </mesh>
      {lengthwiseXs.map((x, i) => (
        <mesh key={`ceiling-beam-long-${String(i)}`} position={[x, y, 0]}>
          <boxGeometry args={[0.18, 0.12, length - 0.8]} />
          <meshStandardMaterial color={AVODIRE_BEAM} roughness={0.68} metalness={0.02} />
        </mesh>
      ))}
      {crossZs.map((z, i) => (
        <mesh key={`ceiling-beam-cross-${String(i)}`} position={[0, y - 0.004, z]}>
          <boxGeometry args={[width - 0.8, 0.12, 0.18]} />
          <meshStandardMaterial color={AVODIRE_BEAM} roughness={0.68} metalness={0.02} />
        </mesh>
      ))}
      <mesh position={[0, y - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[DOME_RADIUS + 0.7, 0.075, 12, 80]} />
        <meshStandardMaterial color={AVODIRE_HIGHLIGHT} roughness={0.46} metalness={0.22} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Wall art, honour boards, and fireplace focal point
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
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[pictureArgs[0], pictureArgs[1], pictureArgs[2]]} />
        <meshStandardMaterial color={pictureColor} roughness={0.78} metalness={0} />
      </mesh>
    </group>
  );
}

function EndWallFocalPoint({ width, length }: { readonly width: number; readonly length: number }): React.ReactElement {
  const backZ = -length / 2 + 0.18;
  const frontZ = length / 2 - 0.18;
  const boardX = width * 0.14;

  return (
    <group name="end-wall-focal-points">
      {/* Back wall fireplace and central portrait. */}
      <mesh position={[0, 0.54, backZ]}>
        <boxGeometry args={[2.4, 1.08, 0.16]} />
        <meshStandardMaterial color={MARBLE_WHITE} roughness={0.42} metalness={0} />
      </mesh>
      <mesh position={[0, 0.38, backZ + 0.04]}>
        <boxGeometry args={[1.35, 0.72, 0.08]} />
        <meshStandardMaterial color="#1e1712" roughness={0.72} metalness={0} />
      </mesh>
      <mesh position={[0, 1.14, backZ + 0.02]}>
        <boxGeometry args={[2.7, 0.16, 0.22]} />
        <meshStandardMaterial color={MARBLE_WHITE} roughness={0.38} metalness={0} />
      </mesh>
      <WallPortrait position={[0, 3.15, backZ + 0.05]} axis="z" pictureColor="#3a2b20" />
      <WallPortrait position={[-boardX, 2.55, backZ + 0.04]} axis="z" frameColor={PANEL_DARK_OAK} pictureColor="#20140c" />
      <WallPortrait position={[boardX, 2.55, backZ + 0.04]} axis="z" frameColor={PANEL_DARK_OAK} pictureColor="#20140c" />

      {/* Front wall paired honour boards, leaving the centre clear for events. */}
      <WallPortrait position={[-boardX, 2.8, frontZ - 0.04]} axis="z" frameColor={PANEL_DARK_OAK} pictureColor="#24160d" />
      <WallPortrait position={[boardX, 2.8, frontZ - 0.04]} axis="z" frameColor={PANEL_DARK_OAK} pictureColor="#24160d" />
    </group>
  );
}

function PortraitGallery({ width, length }: { readonly width: number; readonly length: number }): React.ReactElement {
  const halfW = width / 2;
  const halfL = length / 2;
  const portraitZ = useMemo(
    () => [-halfL * 0.72, -halfL * 0.42, -halfL * 0.12, halfL * 0.12, halfL * 0.42, halfL * 0.72],
    [halfL],
  );

  return (
    <group name="portrait-gallery">
      {portraitZ.map((z, i) => (
        <WallPortrait
          key={`portrait-left-${String(i)}`}
          position={[-halfW + 0.15, 3.05, z]}
          axis="x"
          pictureColor={i % 2 === 0 ? "#31231a" : "#1f2421"}
        />
      ))}
      {portraitZ.map((z, i) => (
        <WallPortrait
          key={`portrait-right-${String(i)}`}
          position={[halfW - 0.15, 3.05, z]}
          axis="x"
          pictureColor={i % 2 === 0 ? "#2b2119" : "#20262b"}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Ceiling rosette ring — gold + burgundy band around the dome base
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
      {/* Warm candle bulbs — emissive material only, no runtime PointLight. */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh key={`candle-${String(i)}`} position={[Math.cos(a) * ringRadius * 0.78, ringY + 0.08, Math.sin(a) * ringRadius * 0.78]}>
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshStandardMaterial
              color="#ffe0a3"
              emissive="#f7c16b"
              emissiveIntensity={0.95}
              roughness={0.18}
              metalness={0}
            />
          </mesh>
        );
      })}
      {/* Crystal drops — emissive spheres */}
      {drops.map((d, i) => (
        <mesh key={`drop-${String(i)}`} position={[d.x, ringY + d.y, d.z]}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshStandardMaterial
            color={CRYSTAL}
            emissive={CRYSTAL}
            emissiveIntensity={0.85}
            roughness={0.15}
            metalness={0}
            transparent
            opacity={0.95}
          />
        </mesh>
      ))}
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
      {/* Brass arms — 6 arms holding the inner ring */}
      {Array.from({ length: 6 }).map((_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh
            key={`arm-${String(i)}`}
            position={[Math.cos(a) * ringRadius * 0.75, ringY + 0.09, Math.sin(a) * ringRadius * 0.75]}
            rotation={[0, -a, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.015, 0.015, ringRadius * 0.5, 8]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.35} metalness={0.7} />
          </mesh>
        );
      })}
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
}

/**
 * Drop-in component that adds every ornament in one group. Defaults to the
 * Grand Hall render dimensions; override per-call for ablations.
 */
export function GrandHallOrnaments({
  width = GRAND_HALL_RENDER_DIMENSIONS.width,
  length = GRAND_HALL_RENDER_DIMENSIONS.length,
  height = GRAND_HALL_RENDER_DIMENSIONS.height,
}: GrandHallOrnamentsProps): React.ReactElement {
  // Five window bays per long wall, evenly spaced; pilasters between them
  // and at the ends, so each pair of pilasters frames one window.
  const longWallX = width / 2;
  const N_WINDOWS = 5;
  const windowSpacing = length / (N_WINDOWS + 1);
  const windowZ = useMemo(
    () => Array.from({ length: N_WINDOWS }, (_, i) => -length / 2 + windowSpacing * (i + 1)),
    [length, windowSpacing],
  );

  // Pilasters between window bays + at the ends
  const pilasterZ = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i <= N_WINDOWS; i++) {
      arr.push(-length / 2 + windowSpacing * (i + 0.5));
    }
    return arr;
  }, [length, windowSpacing]);
  const chandelierZ = useMemo(
    () => [-length * 0.38, -length * 0.19, 0, length * 0.19, length * 0.38],
    [length],
  );

  return (
    <group name="grand-hall-ornaments">
      <CofferedAvodireCeiling width={width} length={length} height={height} />
      <CrownMoulding width={width} length={length} wallHeight={height} />
      <Skirting width={width} length={length} />
      <WainscotRaisedPanels width={width} length={length} />
      <TradeFrieze width={width} length={length} height={height} />
      <EndWallFocalPoint width={width} length={length} />
      <PortraitGallery width={width} length={length} />

      {/* Pilasters along each long wall */}
      {pilasterZ.map((z, i) => (
        <Pilaster
          key={`pilaster-left-${String(i)}`}
          position={[-longWallX + 0.12, 0, z]}
          height={height}
          wallAxis="z"
        />
      ))}
      {pilasterZ.map((z, i) => (
        <Pilaster
          key={`pilaster-right-${String(i)}`}
          position={[longWallX - 0.12, 0, z]}
          height={height}
          wallAxis="z"
        />
      ))}

      {/* Arched windows on long walls — facing inward */}
      {windowZ.map((z, i) => (
        <ArchedWindow
          key={`window-left-${String(i)}`}
          position={[-longWallX + 0.025, 0, z]}
          rotationY={Math.PI / 2}
        />
      ))}
      {windowZ.map((z, i) => (
        <ArchedWindow
          key={`window-right-${String(i)}`}
          position={[longWallX - 0.025, 0, z]}
          rotationY={-Math.PI / 2}
        />
      ))}

      {/* Ceiling rosette ring around the dome base */}
      <CeilingRosetteRing y={height - 0.005} radius={DOME_RADIUS} />

      {/* Five chandeliers along the hall centerline. */}
      {chandelierZ.map((z, i) => (
        <Chandelier
          key={`chandelier-${String(i)}`}
          anchorY={height - 0.08}
          dropLength={2.05}
          z={z}
          scale={i === 2 ? 1.08 : 0.92}
        />
      ))}
    </group>
  );
}

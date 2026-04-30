/**
 * Grand Hall ornamental dressing.
 *
 * Layered on top of the basic 6-surface room (`GrandHallRoom`):
 *   - Crown moulding, skirting, and raised dark-timber wainscot panels
 *   - Pilasters framing the three arched windows on one long wall
 *   - Curtain-dressed arched-window facades with cool daylight panes
 *   - Ochre mural frieze, portraits, honour boards, and cabinet wall dressing
 *   - Avodire geometric coffer field and fourteen-trade dome ring
 *   - Three chandeliers along the 21m hall axis, with the central chandelier under the dome
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
import { SurfaceVisibilityGroup } from "./SurfaceVisibilityGroup.js";

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
const WAINSCOT_PANEL_INSET = 0.17;

function WainscotRaisedPanels({ width, length }: { readonly width: number; readonly length: number }): React.ReactElement {
  const halfW = width / 2;
  const halfL = length / 2;
  const longPanels = 12;
  const shortPanels = 5;
  const longSpacing = width / longPanels;
  const shortSpacing = length / shortPanels;

  const longX = useMemo(
    () => Array.from({ length: longPanels }, (_, i) => -halfW + longSpacing * (i + 0.5)),
    [halfW, longSpacing],
  );
  const shortZ = useMemo(
    () => Array.from({ length: shortPanels }, (_, i) => -halfL + shortSpacing * (i + 0.5)),
    [halfL, shortSpacing],
  );

  return (
    <group name="raised-wainscot-panels">
      {[-halfL + WAINSCOT_PANEL_INSET, halfL - WAINSCOT_PANEL_INSET].map((z, sideIndex) => (
        <SurfaceVisibilityGroup
          key={`wainscot-long-${String(sideIndex)}`}
          name={`raised-wainscot-${sideIndex === 0 ? "back" : "front"}`}
          surfaceKey={sideIndex === 0 ? "wall-back" : "wall-front"}
        >
        <group>
          {longX.map((x, i) => (
            <mesh key={`wainscot-long-panel-${String(sideIndex)}-${String(i)}`} position={[x, WAINSCOT_PANEL_Y, z]}>
              <boxGeometry args={[longSpacing * 0.72, WAINSCOT_PANEL_HEIGHT, 0.055]} />
              <meshStandardMaterial color={i % 2 === 0 ? PANEL_DARK_OAK : PANEL_SHADOW} roughness={0.74} metalness={0} />
            </mesh>
          ))}
          <mesh position={[0, WAINSCOT_PANEL_Y + WAINSCOT_PANEL_HEIGHT / 2 + 0.12, z]}>
            <boxGeometry args={[width - 0.65, 0.1, 0.075]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.45} metalness={0.25} />
          </mesh>
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
          {shortZ.map((z, i) => (
            <mesh key={`wainscot-short-panel-${String(sideIndex)}-${String(i)}`} position={[x, WAINSCOT_PANEL_Y, z]}>
              <boxGeometry args={[0.055, WAINSCOT_PANEL_HEIGHT, shortSpacing * 0.72]} />
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
          {figureX.map((x, i) => (
            <group key={`frieze-figure-z-${String(sideIndex)}-${String(i)}`} position={[x, y - 0.02, z + (sideIndex === 0 ? 0.032 : -0.032)]}>
              <mesh position={[0, -0.03, 0]}>
                <boxGeometry args={[0.08, 0.32 + (i % 3) * 0.035, 0.026]} />
                <meshStandardMaterial color={MURAL_SHADOW} roughness={0.82} metalness={0} />
              </mesh>
              <mesh position={[0, 0.18, 0]}>
                <sphereGeometry args={[0.055, 8, 8]} />
                <meshStandardMaterial color={MURAL_SHADOW} roughness={0.82} metalness={0} />
              </mesh>
            </group>
          ))}
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
          {figureZ.map((z, i) => (
            <group key={`frieze-figure-x-${String(sideIndex)}-${String(i)}`} position={[x + (sideIndex === 0 ? 0.032 : -0.032), y - 0.02, z]}>
              <mesh position={[0, -0.03, 0]}>
                <boxGeometry args={[0.026, 0.32 + (i % 3) * 0.035, 0.08]} />
                <meshStandardMaterial color={MURAL_SHADOW} roughness={0.82} metalness={0} />
              </mesh>
              <mesh position={[0, 0.18, 0]}>
                <sphereGeometry args={[0.055, 8, 8]} />
                <meshStandardMaterial color={MURAL_SHADOW} roughness={0.82} metalness={0} />
              </mesh>
            </group>
          ))}
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

const WINDOW_HEIGHT = 4.55;
const WINDOW_WIDTH = 2.45;
const WINDOW_SILL_Y = 1.05;
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
      {/* Pale gathered drapes and brass pelmet: the reference photos show
          cream curtains inside the arched bays, not red side swags. */}
      <mesh position={[-WINDOW_WIDTH / 2 - 0.22, curtainY, WINDOW_INSET + 0.018]}>
        <boxGeometry args={[0.34, curtainHeight, 0.035]} />
        <meshStandardMaterial color={CURTAIN_CREAM} roughness={0.88} metalness={0} />
      </mesh>
      <mesh position={[WINDOW_WIDTH / 2 + 0.22, curtainY, WINDOW_INSET + 0.018]}>
        <boxGeometry args={[0.34, curtainHeight, 0.035]} />
        <meshStandardMaterial color={CURTAIN_CREAM} roughness={0.88} metalness={0} />
      </mesh>
      <mesh position={[-WINDOW_WIDTH / 2 - 0.04, curtainY, WINDOW_INSET + 0.021]}>
        <boxGeometry args={[0.055, curtainHeight * 0.92, 0.038]} />
        <meshStandardMaterial color={CURTAIN_SHADOW} roughness={0.9} metalness={0} />
      </mesh>
      <mesh position={[WINDOW_WIDTH / 2 + 0.04, curtainY, WINDOW_INSET + 0.021]}>
        <boxGeometry args={[0.055, curtainHeight * 0.92, 0.038]} />
        <meshStandardMaterial color={CURTAIN_SHADOW} roughness={0.9} metalness={0} />
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

function CeilingDiamondCoffer({
  x,
  z,
  y,
  size,
}: {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly size: number;
}): React.ReactElement {
  const side = size * 0.74;
  const offset = size * 0.26;
  const strip = 0.045;

  return (
    <group position={[x, y, z]} name="diamond-ceiling-coffer">
      {[
        { px: -offset, pz: -offset, ry: Math.PI / 4 },
        { px: offset, pz: -offset, ry: -Math.PI / 4 },
        { px: offset, pz: offset, ry: Math.PI / 4 },
        { px: -offset, pz: offset, ry: -Math.PI / 4 },
      ].map((edge, i) => (
        <mesh key={`diamond-edge-${String(i)}`} position={[edge.px, 0, edge.pz]} rotation={[0, edge.ry, 0]}>
          <boxGeometry args={[side, 0.035, strip]} />
          <meshStandardMaterial color={AVODIRE_BEAM} roughness={0.68} metalness={0.02} />
        </mesh>
      ))}
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[size * 0.09, 8]} />
        <meshStandardMaterial color={AVODIRE_HIGHLIGHT} roughness={0.46} metalness={0.22} side={DoubleSide} />
      </mesh>
    </group>
  );
}

function CofferedAvodireCeiling({ width, length, height }: CeilingBeamProps): React.ReactElement {
  const halfW = width / 2;
  const halfL = length / 2;
  const y = height - 0.065;
  const opening = DOME_RADIUS + 0.72;
  const sidePanelWidth = Math.max(0.1, (width - opening * 2) / 2);
  const endPanelLength = Math.max(0.1, (length - opening * 2) / 2);
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
      {cofferCenters.map((c, i) => (
        <CeilingDiamondCoffer key={`ceiling-diamond-${String(i)}`} x={c.x} z={c.z} y={y - 0.028} size={Math.min(width / 10, length / 3.8)} />
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
  const fireplaceX = width / 2 - 0.18;
  const entranceX = -width / 2 + 0.18;
  const boardZ = length * 0.24;

  return (
    <group name="end-wall-focal-points">
      {/* Short-end fireplace and central portrait/honour-board composition. */}
      <SurfaceVisibilityGroup surfaceKey="wall-right" name="right-end-wall-focal-point">
        <mesh position={[fireplaceX, 0.54, 0]}>
          <boxGeometry args={[0.16, 1.08, 2.4]} />
          <meshStandardMaterial color={MARBLE_WHITE} roughness={0.42} metalness={0} />
        </mesh>
        <mesh position={[fireplaceX - 0.04, 0.38, 0]}>
          <boxGeometry args={[0.08, 0.72, 1.35]} />
          <meshStandardMaterial color="#1e1712" roughness={0.72} metalness={0} />
        </mesh>
        <mesh position={[fireplaceX - 0.02, 1.14, 0]}>
          <boxGeometry args={[0.22, 0.16, 2.7]} />
          <meshStandardMaterial color={MARBLE_WHITE} roughness={0.38} metalness={0} />
        </mesh>
        <WallPortrait position={[fireplaceX - 0.05, 3.15, 0]} axis="x" pictureColor="#3a2b20" />
        <WallPortrait position={[fireplaceX - 0.04, 2.55, -boardZ]} axis="x" frameColor={PANEL_DARK_OAK} pictureColor="#20140c" />
        <WallPortrait position={[fireplaceX - 0.04, 2.55, boardZ]} axis="x" frameColor={PANEL_DARK_OAK} pictureColor="#20140c" />
      </SurfaceVisibilityGroup>

      {/* Opposite short end: paired dark entrance doors from the floorplan. */}
      <SurfaceVisibilityGroup surfaceKey="wall-left" name="left-end-wall-doors">
        {[-1.35, 1.35].map((z, i) => (
          <group key={`short-end-door-${String(i)}`} position={[entranceX + 0.02, 1.55, z]}>
            <mesh>
              <boxGeometry args={[0.09, 2.55, 1.15]} />
              <meshStandardMaterial color={PANEL_DARK_OAK} roughness={0.68} metalness={0.02} />
            </mesh>
            <mesh position={[-0.012, 0.1, 0]}>
              <boxGeometry args={[0.105, 1.82, 0.74]} />
              <meshStandardMaterial color={PANEL_SHADOW} roughness={0.74} metalness={0} />
            </mesh>
            <mesh position={[-0.024, 1.42, 0]}>
              <boxGeometry args={[0.12, 0.16, 1.28]} />
              <meshStandardMaterial color={BRASS_GOLD} roughness={0.42} metalness={0.36} />
            </mesh>
          </group>
        ))}
      </SurfaceVisibilityGroup>
    </group>
  );
}

function PortraitGallery({ width, length }: { readonly width: number; readonly length: number }): React.ReactElement {
  const halfW = width / 2;
  const halfL = length / 2;
  const portraitX = useMemo(
    () => [-halfW * 0.72, -halfW * 0.48, -halfW * 0.22, halfW * 0.22, halfW * 0.48, halfW * 0.72],
    [halfW],
  );

  return (
    <group name="portrait-gallery">
      {portraitX.map((x, i) => (
        <WallPortrait
          key={`portrait-opposite-window-wall-${String(i)}`}
          position={[x, 3.05, halfL - 0.15]}
          axis="z"
          pictureColor={i % 2 === 0 ? "#31231a" : "#1f2421"}
        />
      ))}
      {[-halfW * 0.34, halfW * 0.34].map((x, i) => (
        <group key={`honour-cabinet-long-wall-${String(i)}`} position={[x, 2.35, halfL - 0.18]}>
          <mesh>
            <boxGeometry args={[2.1, 2.35, 0.16]} />
            <meshStandardMaterial color={PANEL_DARK_OAK} roughness={0.66} metalness={0.02} />
          </mesh>
          <mesh position={[0, -0.05, -0.035]}>
            <boxGeometry args={[1.52, 1.65, 0.17]} />
            <meshStandardMaterial color="#23150d" roughness={0.74} metalness={0} />
          </mesh>
          <mesh position={[0, 1.24, -0.05]}>
            <cylinderGeometry args={[0.32, 0.32, 0.09, 24]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.4} metalness={0.35} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Floorplan balcony cue
// ---------------------------------------------------------------------------

function BalconyWallCue({ width, length }: { readonly width: number; readonly length: number }): React.ReactElement {
  const z = length / 2 - 0.52;
  const platformWidth = width * 0.32;
  const railWidth = platformWidth * 0.86;

  return (
    <group name="floorplan-balcony-wall-cue">
      <mesh position={[0, 0.07, z]}>
        <boxGeometry args={[platformWidth, 0.14, 0.82]} />
        <meshStandardMaterial color={PANEL_DARK_OAK} roughness={0.66} metalness={0.02} />
      </mesh>
      <mesh position={[0, 0.62, z - 0.36]}>
        <boxGeometry args={[railWidth, 0.12, 0.08]} />
        <meshStandardMaterial color={BRASS_GOLD} roughness={0.42} metalness={0.36} />
      </mesh>
      {Array.from({ length: 7 }).map((_, i) => {
        const x = -railWidth / 2 + (railWidth / 6) * i;
        return (
          <mesh key={`balcony-post-${String(i)}`} position={[x, 0.36, z - 0.36]}>
            <boxGeometry args={[0.08, 0.58, 0.08]} />
            <meshStandardMaterial color={PANEL_DARK_OAK} roughness={0.66} metalness={0.02} />
          </mesh>
        );
      })}
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
  const halfL = length / 2;
  const windowWallZ = -halfL + 0.025;

  // The floorplan's 21m side is the X axis. Three arched window bays sit on
  // one long wall, spaced along X, not mirrored onto the opposite wall.
  const windowX = useMemo(
    () => [-width * 0.29, 0, width * 0.29],
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

  return (
    <group name="grand-hall-ornaments">
      <CofferedAvodireCeiling width={width} length={length} height={height} />
      <CrownMoulding width={width} length={length} wallHeight={height} />
      <Skirting width={width} length={length} />
      <WainscotRaisedPanels width={width} length={length} />
      <TradeFrieze width={width} length={length} height={height} />
      <EndWallFocalPoint width={width} length={length} />
      <SurfaceVisibilityGroup surfaceKey="wall-front" name="front-wall-ornament-cluster">
        <PortraitGallery width={width} length={length} />
        <BalconyWallCue width={width} length={length} />
      </SurfaceVisibilityGroup>
      {/* Pilasters and arched windows along the window wall only. */}
      <SurfaceVisibilityGroup surfaceKey="wall-back" name="window-wall-ornament-cluster">
        {pilasterX.map((x, i) => (
          <Pilaster
            key={`pilaster-window-wall-${String(i)}`}
            position={[x, 0, -halfL + 0.12]}
            height={height}
            wallAxis="z"
          />
        ))}

        {/* Arched windows on the real window wall, facing inward. */}
        {windowX.map((x, i) => (
          <ArchedWindow
            key={`window-long-wall-${String(i)}`}
            position={[x, 0, windowWallZ]}
            rotationY={0}
          />
        ))}
      </SurfaceVisibilityGroup>

      {/* Ceiling rosette ring around the dome base */}
      <CeilingRosetteRing y={height - 0.005} radius={DOME_RADIUS} />

      {/* Three chandeliers along the 21m hall centerline. */}
      {chandelierX.map((x, i) => (
        <Chandelier
          key={`chandelier-${String(i)}`}
          anchorY={height - 0.08}
          dropLength={i === 1 ? 2.18 : 1.78}
          x={x}
          scale={i === 1 ? 1.08 : 0.82}
        />
      ))}
    </group>
  );
}

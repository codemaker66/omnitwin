/**
 * Grand Hall ornamental dressing.
 *
 * Layered on top of the basic 6-surface room (`GrandHallRoom`):
 *   - Crown moulding strip running around the wall–ceiling joint
 *   - Skirting strip at the wall–floor joint
 *   - Pilasters between window bays on the long walls
 *   - Arched-window facades (visual only — emissive panes that read as
 *     "daylight outside" without needing real glass / cutouts)
 *   - Ceiling rosette ring around the dome base (gold + burgundy)
 *   - Hanging chandelier (emissive crystal ring on a brass rod)
 *
 * All ornaments use `meshStandardMaterial` with the project's standard
 * roughness/metalness profile — no point lights, no runtime shadows,
 * per the renderer's prebaked-lighting rule.
 */

import { useMemo } from "react";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import {
  TRIM_COLOR,
  BRASS_GOLD,
  BRONZE_DARK,
  BURGUNDY,
  CRYSTAL,
  WINDOW_GLOW,
} from "../constants/colors.js";
import { DOME_RADIUS } from "./GrandHallRoom.js";

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

  return (
    <group position={[position[0], position[1], position[2]]} rotation={[0, rotationY, 0]}>
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
      {/* Frame — vertical mullion */}
      <mesh position={[0, WINDOW_SILL_Y + rectHeight / 2, WINDOW_INSET + 0.01]}>
        <boxGeometry args={[0.08, rectHeight, 0.02]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} />
      </mesh>
      {/* Arch frame — thin ring along the half-circle outer edge */}
      <mesh position={[0, WINDOW_SILL_Y + rectHeight, WINDOW_INSET + 0.01]}>
        <ringGeometry args={[archRadius - 0.06, archRadius, 32, 1, 0, Math.PI]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.85} metalness={0} side={2} />
      </mesh>
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
      {/* Twelve gold rosettes spaced around the burgundy band */}
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const r = radius + 0.3;
        return (
          <mesh
            key={`rose-${String(i)}`}
            position={[Math.cos(a) * r, -0.003, Math.sin(a) * r]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[0.08, 16]} />
            <meshStandardMaterial color={BRASS_GOLD} roughness={0.35} metalness={0.55} side={2} />
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
}

function Chandelier({ anchorY, dropLength }: ChandelierProps): React.ReactElement {
  const ringY = anchorY - dropLength;
  const ringRadius = 1.1;
  const drops = useMemo(() => {
    const pts: Array<{ x: number; z: number; y: number }> = [];
    const N = 18;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push({
        x: Math.cos(a) * ringRadius,
        z: Math.sin(a) * ringRadius,
        y: -0.18 - (i % 3) * 0.08,
      });
    }
    return pts;
  }, []);

  return (
    <group name="chandelier">
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

  return (
    <group name="grand-hall-ornaments">
      <CrownMoulding width={width} length={length} wallHeight={height} />
      <Skirting width={width} length={length} />

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

      {/* Chandelier hanging from the dome */}
      <Chandelier anchorY={height + DOME_RADIUS - 0.5} dropLength={2.4} />
    </group>
  );
}

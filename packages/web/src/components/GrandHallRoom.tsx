import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { SpaceDimensions } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import {
  BackSide,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  RGBAFormat,
} from "three";
import {
  FLOOR_COLOR,
  WALL_COLOR,
  CEILING_COLOR,
  WAINSCOT_COLOR,
  WAINSCOT_HEIGHT,
  GRID_COLOR,
  DOME_COLOR,
} from "../constants/colors.js";
import { useDeviceStore } from "../stores/device-store.js";
import {
  getHemisphereLightConfig,
  createPlaceholderLightmapData,
  shouldUseLightmap,
  LIGHTMAP_SIZE,
} from "../lib/lighting.js";
import { sectionClipPlanes, noClipPlanes } from "./SectionPlane.js";
import { useVisibilityStore } from "../stores/visibility-store.js";
import { useXrayStore } from "../stores/xray-store.js";
import { applyXrayOpacity } from "../lib/xray.js";
import { BrickWall } from "./BrickWall.js";

// ---------------------------------------------------------------------------
// Room surface geometry — pure data, fully testable without WebGL
// ---------------------------------------------------------------------------

export interface RoomSurface {
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly size: readonly [number, number];
  readonly color: string;
}

const HALF = 0.5;

/**
 * Returns true if the surface should be clipped by the section plane.
 * Floor is never clipped (always visible for planning view).
 */
export function isSurfaceClippable(name: string): boolean {
  return name !== "floor";
}

/**
 * Computes the 6 inward-facing plane surfaces for a rectangular room
 * centered on the X/Z origin with the floor at y = 0.
 *
 * Coordinate system (Three.js default):
 *   X = room width axis
 *   Y = up (floor at 0, ceiling at height)
 *   Z = room length axis
 *
 * All normals face inward so geometry is visible from inside the room
 * when rendered with `side: FrontSide`.
 */
export function computeRoomSurfaces(dimensions: SpaceDimensions): readonly RoomSurface[] {
  const { width, length, height } = dimensions;
  const halfWidth = width * HALF;
  const halfLength = length * HALF;
  const halfHeight = height * HALF;

  return [
    // Floor — XZ plane at y=0, default plane normal is +Z, rotate -90° around X → normal becomes +Y (faces up)
    {
      name: "floor",
      position: [0, 0, 0],
      rotation: [-Math.PI * HALF, 0, 0],
      size: [width, length],
      color: FLOOR_COLOR,
    },
    // Ceiling — XZ plane at y=height, rotate +90° around X → normal becomes -Y (faces down into room)
    {
      name: "ceiling",
      position: [0, height, 0],
      rotation: [Math.PI * HALF, 0, 0],
      size: [width, length],
      color: CEILING_COLOR,
    },
    // Back wall — at z = -halfLength, default normal +Z faces into room ✓
    {
      name: "wall-back",
      position: [0, halfHeight, -halfLength],
      rotation: [0, 0, 0],
      size: [width, height],
      color: WALL_COLOR,
    },
    // Front wall — at z = +halfLength, rotate 180° around Y → normal faces -Z into room
    {
      name: "wall-front",
      position: [0, halfHeight, halfLength],
      rotation: [0, Math.PI, 0],
      size: [width, height],
      color: WALL_COLOR,
    },
    // Left wall — at x = -halfWidth, rotate +90° around Y → normal faces +X into room
    {
      name: "wall-left",
      position: [-halfWidth, halfHeight, 0],
      rotation: [0, Math.PI * HALF, 0],
      size: [length, height],
      color: WALL_COLOR,
    },
    // Right wall — at x = +halfWidth, rotate -90° around Y → normal faces -X into room
    {
      name: "wall-right",
      position: [halfWidth, halfHeight, 0],
      rotation: [0, -Math.PI * HALF, 0],
      size: [length, height],
      color: WALL_COLOR,
    },
  ] as const;
}

// ---------------------------------------------------------------------------
// Precomputed Grand Hall surfaces — avoids recomputation on every render
// ---------------------------------------------------------------------------

export const GRAND_HALL_SURFACES: readonly RoomSurface[] = computeRoomSurfaces(
  GRAND_HALL_RENDER_DIMENSIONS,
);

// ---------------------------------------------------------------------------
// Wainscoting — accent panels on the lower portion of each wall
// ---------------------------------------------------------------------------

/** Slight inward offset (meters) to prevent z-fighting with the wall behind. */
const WAINSCOT_INSET = 0.005;

/**
 * Computes 4 wainscoting panels (one per wall) positioned on the lower
 * portion of the room walls. Each panel sits slightly in front of its
 * parent wall to avoid z-fighting.
 */
export function computeWainscotingSurfaces(dimensions: SpaceDimensions): readonly RoomSurface[] {
  const { width, length } = dimensions;
  const halfWidth = width * HALF;
  const halfLength = length * HALF;
  const halfWainscot = WAINSCOT_HEIGHT * HALF;

  return [
    {
      name: "wainscot-back",
      position: [0, halfWainscot, -halfLength + WAINSCOT_INSET],
      rotation: [0, 0, 0],
      size: [width, WAINSCOT_HEIGHT],
      color: WAINSCOT_COLOR,
    },
    {
      name: "wainscot-front",
      position: [0, halfWainscot, halfLength - WAINSCOT_INSET],
      rotation: [0, Math.PI, 0],
      size: [width, WAINSCOT_HEIGHT],
      color: WAINSCOT_COLOR,
    },
    {
      name: "wainscot-left",
      position: [-halfWidth + WAINSCOT_INSET, halfWainscot, 0],
      rotation: [0, Math.PI * HALF, 0],
      size: [length, WAINSCOT_HEIGHT],
      color: WAINSCOT_COLOR,
    },
    {
      name: "wainscot-right",
      position: [halfWidth - WAINSCOT_INSET, halfWainscot, 0],
      rotation: [0, -Math.PI * HALF, 0],
      size: [length, WAINSCOT_HEIGHT],
      color: WAINSCOT_COLOR,
    },
  ] as const;
}

export const GRAND_HALL_WAINSCOTING: readonly RoomSurface[] = computeWainscotingSurfaces(
  GRAND_HALL_RENDER_DIMENSIONS,
);

// ---------------------------------------------------------------------------
// Dome — 7m hemisphere recessed into the ceiling at room centre
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rectangular floor grid — fits the room footprint exactly
// ---------------------------------------------------------------------------

/** Extra margin (meters) the planning grid extends beyond the room on each side. */
export const GRID_MARGIN = 10;

/**
 * Creates a BufferGeometry for a rectangular grid of 1m lines.
 * Extends beyond the room by `margin` meters on each side so users
 * can plan around the venue, not just inside it.
 *
 * Lines run along X and Z axes, centered at origin on the XZ plane.
 */
export function createRectangularGridGeometry(
  width: number,
  length: number,
  margin: number,
): BufferGeometry {
  const halfW = width / 2 + margin;
  const halfL = length / 2 + margin;
  const vertices: number[] = [];

  // Lines along the X axis (varying Z positions)
  for (let z = -halfL; z <= halfL + 0.001; z += 1) {
    vertices.push(-halfW, 0, z, halfW, 0, z);
  }

  // Lines along the Z axis (varying X positions)
  for (let x = -halfW; x <= halfW + 0.001; x += 1) {
    vertices.push(x, 0, -halfL, x, 0, halfL);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  return geometry;
}

/** Dome radius in meters (7m diameter dome). */
export const DOME_RADIUS = 3.5;

/** How far above the ceiling plane the dome apex reaches. */
export const DOME_RECESS_DEPTH = DOME_RADIUS;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the Grand Hall as an architectural model:
 * - 6 inward-facing planes (floor, ceiling, 4 walls) in clean neutral tones
 * - Wainscoting accent on the lower portion of walls
 * - 7m dome recessed into the ceiling (signature architectural feature)
 * - GridHelper on the floor showing 1m intervals
 * - Bright hemisphere lighting for a professional, open feel
 * - Section plane clipping on walls/ceiling/dome (floor + grid always visible)
 * - Per-surface opacity driven imperatively in useFrame (bypasses React batching)
 * - NO PointLight, NO runtime shadows (per Renderer rules)
 */
export function GrandHallRoom(): React.ReactElement {
  const tier = useDeviceStore((s) => s.tier);
  const lightConfig = getHemisphereLightConfig(tier);
  const useLightmap = shouldUseLightmap(tier);
  const groupRef = useRef<Group>(null);

  const lightmapTexture = useMemo(() => {
    if (!useLightmap) return null;
    const data = createPlaceholderLightmapData(LIGHTMAP_SIZE, LIGHTMAP_SIZE);
    const texture = new DataTexture(data, LIGHTMAP_SIZE, LIGHTMAP_SIZE, RGBAFormat);
    texture.channel = 0;
    texture.needsUpdate = true;
    return texture;
  }, [useLightmap]);

  const { width, length, height } = GRAND_HALL_RENDER_DIMENSIONS;

  const gridGeometry = useMemo(
    () => createRectangularGridGeometry(width, length, GRID_MARGIN),
    [width, length],
  );

  // Drive non-brick surface opacity imperatively (floor, ceiling, dome).
  // Walls and wainscoting are handled by BrickWall's own useFrame.
  useFrame(() => {
    const group = groupRef.current;
    if (group === null) return;

    const { ceiling, dome } = useVisibilityStore.getState();
    const xrayOpacity = useXrayStore.getState().opacity;

    for (const child of group.children) {
      if (!(child instanceof Mesh)) continue;
      const mat: unknown = child.material;
      if (!(mat instanceof MeshStandardMaterial)) continue;

      if (child.name === "floor") {
        // Floor is exempt from x-ray — always fully opaque
        mat.opacity = 1;
      } else if (child.name === "ceiling") {
        const baseOpacity = ceiling ? 1 : 0;
        const finalOpacity = applyXrayOpacity("ceiling", baseOpacity, xrayOpacity);
        child.visible = finalOpacity > 0.01;
        mat.opacity = finalOpacity;
      } else if (child.name === "dome") {
        const baseOpacity = dome ? 1 : 0;
        const finalOpacity = applyXrayOpacity("dome", baseOpacity, xrayOpacity);
        child.visible = finalOpacity > 0.01;
        mat.opacity = finalOpacity;
        mat.transparent = true;
      }
    }
  });

  return (
    <group name="grand-hall-room" ref={groupRef}>
      <hemisphereLight
        args={[lightConfig.skyColor, lightConfig.groundColor, lightConfig.intensity]}
      />
      <ambientLight intensity={0.3} />
      {/*
        Floor grid — 1m intervals, rectangular, fits the room exactly.
        Positioned just above the floor to avoid z-fighting.
        NOT clipped by section plane — always visible for planning.
      */}
      <lineSegments geometry={gridGeometry} position={[0, 0.002, 0]}>
        <lineBasicMaterial color={GRID_COLOR} />
      </lineSegments>
      {/* Non-wall surfaces: floor + ceiling as flat planes */}
      {GRAND_HALL_SURFACES.filter((s) => !s.name.startsWith("wall-")).map((surface) => {
        const clippable = isSurfaceClippable(surface.name);
        return (
          <mesh
            key={surface.name}
            position={[surface.position[0], surface.position[1], surface.position[2]]}
            rotation={[surface.rotation[0], surface.rotation[1], surface.rotation[2]]}
            name={surface.name}
          >
            <planeGeometry args={[surface.size[0], surface.size[1]]} />
            <meshStandardMaterial
              color={surface.color}
              side={surface.name === "floor" ? DoubleSide : FrontSide}
              roughness={0.95}
              metalness={0}
              transparent={surface.name !== "floor"}
              lightMap={lightmapTexture}
              clippingPlanes={clippable ? sectionClipPlanes : noClipPlanes}
            />
          </mesh>
        );
      })}
      {/* Walls — brick dissolve animation (Diagon Alley style) */}
      {GRAND_HALL_SURFACES.filter((s) => s.name.startsWith("wall-")).map((surface) => (
        <BrickWall
          key={surface.name}
          name={surface.name}
          wallWidth={surface.size[0]}
          wallHeight={surface.size[1]}
          position={surface.position}
          rotation={surface.rotation}
          color={surface.color}
        />
      ))}
      {/* Wainscoting — brick dissolve, follows parent wall opacity */}
      {GRAND_HALL_WAINSCOTING.map((surface) => (
        <BrickWall
          key={surface.name}
          name={surface.name}
          wallWidth={surface.size[0]}
          wallHeight={surface.size[1]}
          position={surface.position}
          rotation={surface.rotation}
          color={surface.color}
          roughness={0.85}
        />
      ))}
      {/*
        Dome — 7m diameter hemisphere at the center of the ceiling.
        Rendered with BackSide so the interior surface is visible from below.
        Positioned at ceiling height; the hemisphere extends upward from there.
        Clipped by section plane.
      */}
      <mesh
        name="dome"
        position={[0, height + 0.005, 0]}
        rotation={[0, 0, 0]}
      >
        <sphereGeometry args={[DOME_RADIUS, 48, 24, 0, Math.PI * 2, 0, Math.PI * HALF]} />
        <meshStandardMaterial
          color={DOME_COLOR}
          side={BackSide}
          roughness={0.9}
          metalness={0}
          clippingPlanes={sectionClipPlanes}
        />
      </mesh>
    </group>
  );
}

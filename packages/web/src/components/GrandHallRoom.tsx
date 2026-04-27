import { useEffect, useMemo, useRef } from "react";
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
import {
  createParquetFloorTexture,
  createPlasterWallTexture,
  createCeilingPlasterTexture,
  createDomeInteriorTexture,
} from "../lib/grand-hall-textures.js";
import { sectionClipPlanes, noClipPlanes } from "./SectionPlane.js";
import { useVisibilityStore } from "../stores/visibility-store.js";
import { useXrayStore } from "../stores/xray-store.js";
import { applyXrayOpacity } from "../lib/xray.js";
import { BrickWall } from "./BrickWall.js";
import { GrandHallOrnaments } from "./GrandHallOrnaments.js";

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

// Timber frame beams defined in lib/timber-frame.ts, rendered by TimberFrame component.

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

  // Dispose lightmap texture on unmount or when lightmap is toggled off
  useEffect(() => {
    return () => { lightmapTexture?.dispose(); };
  }, [lightmapTexture]);

  // Procedural surface textures — generated once per mount. Disposed on
  // unmount so navigating away from the editor doesn't leak GPU memory.
  // happy-dom (test runner) returns null from canvas.getContext("2d"), so
  // we tolerate the throw and fall back to colour-only materials. SSR
  // (no `document`) hits the same fallback.
  const surfaceTextures = useMemo(() => {
    if (typeof document === "undefined") return null;
    try {
      return {
        floor: createParquetFloorTexture(),
        wall: createPlasterWallTexture(),
        ceiling: createCeilingPlasterTexture(),
        dome: createDomeInteriorTexture(),
      };
    } catch {
      // Canvas 2D unavailable (happy-dom or restricted environment) —
      // colour-only materials still render the room correctly.
      return null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (surfaceTextures !== null) {
        surfaceTextures.floor.dispose();
        surfaceTextures.wall.dispose();
        surfaceTextures.ceiling.dispose();
        surfaceTextures.dome.dispose();
      }
    };
  }, [surfaceTextures]);

  const { width, length, height } = GRAND_HALL_RENDER_DIMENSIONS;

  const gridGeometry = useMemo(
    () => createRectangularGridGeometry(width, length, GRID_MARGIN),
    [width, length],
  );

  // Room frame beams are precomputed (GRAND_HALL_BEAMS)

  // Drive non-brick surface opacity imperatively (floor, ceiling, dome).
  // Walls and wainscoting are handled by BrickWall's own useFrame.
  const prevCeiling = useRef<boolean | null>(null);
  const prevDome = useRef<boolean | null>(null);
  const prevXray = useRef<number | null>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (group === null) return;

    const { ceiling, dome } = useVisibilityStore.getState();
    const xrayOpacity = useXrayStore.getState().opacity;

    // Skip if nothing changed
    if (ceiling === prevCeiling.current && dome === prevDome.current && xrayOpacity === prevXray.current) return;
    prevCeiling.current = ceiling;
    prevDome.current = dome;
    prevXray.current = xrayOpacity;

    for (const child of group.children) {
      if (!(child instanceof Mesh)) continue;
      const mat: unknown = child.material;
      if (!(mat instanceof MeshStandardMaterial)) continue;

      if (child.name === "floor") {
        mat.opacity = 1;
      } else if (child.name === "ceiling") {
        const finalOpacity = applyXrayOpacity("ceiling", ceiling ? 1 : 0, xrayOpacity);
        child.visible = finalOpacity > 0.01;
        mat.opacity = finalOpacity;
      } else if (child.name === "dome") {
        const finalOpacity = applyXrayOpacity("dome", dome ? 1 : 0, xrayOpacity);
        child.visible = finalOpacity > 0.01;
        mat.opacity = finalOpacity;
        mat.transparent = true;
      }
    }
  });

  return (
    <group name="grand-hall-room" ref={groupRef}>
      {/* Lighting — warm Georgian interior. Hemisphere supplies sky + ground
          gradient; a soft directional from the long-wall window direction
          gives the chandelier-lit room a hint of late-afternoon side-light.
          No shadows (renderer rule); directional is here for ambient warmth
          only. Ambient floor of 0.32 keeps the lower walls and skirting
          legible without flattening the lit surfaces. */}
      <hemisphereLight
        args={[lightConfig.skyColor, lightConfig.groundColor, lightConfig.intensity]}
      />
      <ambientLight intensity={0.32} color="#f4ead6" />
      <directionalLight
        position={[10, 6, 8]}
        intensity={0.45}
        color="#f6e9c7"
        castShadow={false}
      />
      <directionalLight
        position={[-10, 6, -8]}
        intensity={0.18}
        color="#dfe7f0"
        castShadow={false}
      />
      {/*
        Floor grid — 1m intervals, rectangular, fits the room exactly.
        Positioned just above the floor to avoid z-fighting.
        NOT clipped by section plane — always visible for planning.
      */}
      <lineSegments geometry={gridGeometry} position={[0, 0.002, 0]}>
        <lineBasicMaterial color={GRID_COLOR} />
      </lineSegments>
      {/* Timber frame removed — didn't look good visually */}
      {/* Non-wall surfaces: floor + ceiling as flat planes. Each gets the
          appropriate procedural texture; floor uses lower roughness so the
          parquet picks up a subtle sheen from the directional light. */}
      {GRAND_HALL_SURFACES.filter((s) => !s.name.startsWith("wall-")).map((surface) => {
        const clippable = isSurfaceClippable(surface.name);
        const isFloor = surface.name === "floor";
        const surfaceMap = surfaceTextures === null
          ? null
          : isFloor
            ? surfaceTextures.floor
            : surface.name === "ceiling"
              ? surfaceTextures.ceiling
              : null;
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
              map={surfaceMap}
              side={isFloor ? DoubleSide : FrontSide}
              roughness={isFloor ? 0.62 : 0.92}
              metalness={isFloor ? 0.05 : 0}
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
        <sphereGeometry args={[DOME_RADIUS, 64, 32, 0, Math.PI * 2, 0, Math.PI * HALF]} />
        <meshStandardMaterial
          color={DOME_COLOR}
          map={surfaceTextures === null ? null : surfaceTextures.dome}
          side={BackSide}
          roughness={0.85}
          metalness={0.05}
          clippingPlanes={sectionClipPlanes}
        />
      </mesh>
      {/* Decorative dressing — crown moulding, skirting, pilasters, arched
          window facades, ceiling rosette ring, hanging chandelier. Kept as a
          single sibling group so layout/visibility logic above stays simple. */}
      <GrandHallOrnaments width={width} length={length} height={height} />
    </group>
  );
}

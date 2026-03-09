import { useMemo } from "react";
import { type SpaceDimensions, TRADES_HALL_GRAND_HALL_DIMENSIONS } from "@omnitwin/types";
import { DataTexture, FrontSide, RGBAFormat } from "three";
import { FLOOR_COLOR, WALL_COLOR, CEILING_COLOR } from "../constants/colors.js";
import { useDeviceStore } from "../stores/device-store.js";
import {
  getHemisphereLightConfig,
  createPlaceholderLightmapData,
  shouldUseLightmap,
  LIGHTMAP_SIZE,
} from "../lib/lighting.js";

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
  TRADES_HALL_GRAND_HALL_DIMENSIONS,
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Eye-level camera Y for a standing adult (~1.7m). */
export const CAMERA_EYE_HEIGHT = 1.7;

/**
 * Renders the Grand Hall as 6 inward-facing planes (floor, ceiling, 4 walls).
 *
 * Lighting:
 * - HemisphereLight for ambient sky/ground fill (intensity scaled by device tier)
 * - meshStandardMaterial with roughness 0.9 / metalness 0 (matte venue surfaces)
 * - Placeholder baked lightmap (radial vignette) on medium+ tiers for fake AO
 * - NO PointLight, NO runtime shadows (per Renderer rules)
 */
export function GrandHallRoom(): React.ReactElement {
  const tier = useDeviceStore((s) => s.tier);
  const lightConfig = getHemisphereLightConfig(tier);
  const useLightmap = shouldUseLightmap(tier);

  const lightmapTexture = useMemo(() => {
    if (!useLightmap) return null;
    const data = createPlaceholderLightmapData(LIGHTMAP_SIZE, LIGHTMAP_SIZE);
    const texture = new DataTexture(data, LIGHTMAP_SIZE, LIGHTMAP_SIZE, RGBAFormat);
    texture.channel = 0; // Read from standard UV (channel 0), not UV2
    texture.needsUpdate = true;
    return texture;
  }, [useLightmap]);

  return (
    <group name="grand-hall-room">
      <hemisphereLight
        args={[lightConfig.skyColor, lightConfig.groundColor, lightConfig.intensity]}
      />
      {GRAND_HALL_SURFACES.map((surface) => (
        <mesh
          key={surface.name}
          position={[surface.position[0], surface.position[1], surface.position[2]]}
          rotation={[surface.rotation[0], surface.rotation[1], surface.rotation[2]]}
          name={surface.name}
        >
          <planeGeometry args={[surface.size[0], surface.size[1]]} />
          <meshStandardMaterial
            color={surface.color}
            side={FrontSide}
            roughness={0.9}
            metalness={0}
            lightMap={lightmapTexture}
          />
        </mesh>
      ))}
    </group>
  );
}

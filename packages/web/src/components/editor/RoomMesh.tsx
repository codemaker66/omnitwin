import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Shape, DoubleSide, BufferGeometry, Float32BufferAttribute } from "three";
import { toRenderSpace } from "../../constants/scale.js";
import type { RoomGeometry, RoomFeature } from "../../data/room-geometries.js";
import { FLOOR_COLOR, GRID_COLOR, DOME_COLOR, WALL_COLOR } from "../../constants/colors.js";
import { sectionClipPlanes, noClipPlanes } from "../SectionPlane.js";
import { useVisibilityStore, type WallKey } from "../../stores/visibility-store.js";
import { BrickWall } from "../BrickWall.js";
import { GrandHallOrnaments } from "../GrandHallOrnaments.js";
import { GrandHallDome } from "../GrandHallDome.js";
import {
  createDomeInteriorTexture,
  createParquetFloorTexture,
} from "../../lib/grand-hall-textures.js";

// ---------------------------------------------------------------------------
// RoomMesh — renders accurate room geometry from polygon data
// Walls use BrickWall for click-to-toggle brick animation.
// Camera-based auto-fade driven via the visibility store.
// ---------------------------------------------------------------------------

const GRID_Y = 0.002;

function polygonToShape(polygon: readonly (readonly [number, number])[]): Shape {
  const shape = new Shape();
  const first = polygon[0];
  if (first === undefined) return shape;
  shape.moveTo(toRenderSpace(first[0]), toRenderSpace(first[1]));
  for (let i = 1; i < polygon.length; i++) {
    const pt = polygon[i];
    if (pt !== undefined) {
      shape.lineTo(toRenderSpace(pt[0]), toRenderSpace(pt[1]));
    }
  }
  shape.closePath();
  return shape;
}

// ---------------------------------------------------------------------------
// Wall segment — precomputed from polygon
// ---------------------------------------------------------------------------

interface WallSegment {
  readonly cx: number;
  readonly cz: number;
  readonly width: number;
  readonly rotY: number;
  readonly normalX: number;
  readonly normalZ: number;
  /** Cardinal wall key this segment maps to (based on dominant normal direction). */
  readonly wallKey: WallKey;
}

/** Maps a wall outward normal to the nearest cardinal WallKey. */
function normalToWallKey(nx: number, nz: number): WallKey {
  if (Math.abs(nx) > Math.abs(nz)) {
    return nx > 0 ? "wall-right" : "wall-left";
  }
  return nz > 0 ? "wall-front" : "wall-back";
}

function computeWallSegments(polygon: readonly (readonly [number, number])[]): readonly WallSegment[] {
  const segments: WallSegment[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a === undefined || b === undefined) continue;

    const ax = toRenderSpace(a[0]);
    const az = toRenderSpace(a[1]);
    const bx = toRenderSpace(b[0]);
    const bz = toRenderSpace(b[1]);

    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) continue; // skip degenerate segments
    const rotY = -Math.atan2(dz, dx);

    // Outward normal for clockwise winding
    const nx = dz / len;
    const nz = -dx / len;

    segments.push({ cx, cz, width: len, rotY, normalX: nx, normalZ: nz, wallKey: normalToWallKey(nx, nz) });
  }
  return segments;
}

interface RenderBounds {
  readonly width: number;
  readonly length: number;
}

function computeRenderBounds(polygon: readonly (readonly [number, number])[]): RenderBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of polygon) {
    const rx = toRenderSpace(x);
    const rz = toRenderSpace(z);
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
    minZ = Math.min(minZ, rz);
    maxZ = Math.max(maxZ, rz);
  }
  return {
    width: Math.max(0, maxX - minX),
    length: Math.max(0, maxZ - minZ),
  };
}

// ---------------------------------------------------------------------------
// CameraWallDriver — updates visibility store from camera position
// ---------------------------------------------------------------------------

function CameraWallDriver(): null {
  const { camera, invalidate } = useThree();

  useFrame((_state, delta) => {
    const mode = useVisibilityStore.getState().mode;
    if (mode === "manual") return;

    const transitioning = useVisibilityStore.getState().updateAutoWalls(
      camera.position.x, camera.position.z, delta,
    );
    if (transitioning) {
      invalidate();
    }
  });

  return null;
}

// ---------------------------------------------------------------------------
// Feature mesh
// ---------------------------------------------------------------------------

function FeatureMesh({ feature }: { readonly feature: RoomFeature }): React.ReactElement {
  const shape = useMemo(() => polygonToShape(feature.polygon), [feature.polygon]);
  return (
    <mesh
      name={`feature-${feature.label.toLowerCase().replace(/\s+/g, "-")}`}
      position={[0, feature.height / 2, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <extrudeGeometry args={[shape, { depth: feature.height, bevelEnabled: false }]} />
      <meshStandardMaterial color="#8a7a6a" roughness={0.85} metalness={0} clippingPlanes={noClipPlanes} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Floor grid
// ---------------------------------------------------------------------------

function FloorGrid({ polygon }: { readonly polygon: readonly (readonly [number, number])[] }): React.ReactElement {
  const gridGeom = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of polygon) {
      const rx = toRenderSpace(x);
      const rz = toRenderSpace(z);
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (rz < minZ) minZ = rz;
      if (rz > maxZ) maxZ = rz;
    }
    const margin = 2;
    minX -= margin; maxX += margin;
    minZ -= margin; maxZ += margin;

    const vertices: number[] = [];
    for (let z = Math.floor(minZ); z <= maxZ + 0.001; z += 1) {
      vertices.push(minX, 0, z, maxX, 0, z);
    }
    for (let x = Math.floor(minX); x <= maxX + 0.001; x += 1) {
      vertices.push(x, 0, minZ, x, 0, maxZ);
    }
    const geom = new BufferGeometry();
    geom.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    return geom;
  }, [polygon]);

  return (
    <lineSegments geometry={gridGeom} position={[0, GRID_Y, 0]}>
      <lineBasicMaterial color={GRID_COLOR} transparent opacity={0.22} />
    </lineSegments>
  );
}

// ---------------------------------------------------------------------------
// RoomMesh — main component
// ---------------------------------------------------------------------------

interface RoomMeshProps {
  readonly geometry: RoomGeometry;
  readonly variant?: "grand-hall" | "generic";
}

export function RoomMesh({ geometry, variant = "generic" }: RoomMeshProps): React.ReactElement {
  const floorShape = useMemo(() => polygonToShape(geometry.wallPolygon), [geometry.wallPolygon]);
  const walls = useMemo(() => computeWallSegments(geometry.wallPolygon), [geometry.wallPolygon]);
  const bounds = useMemo(() => computeRenderBounds(geometry.wallPolygon), [geometry.wallPolygon]);
  const { ceilingHeight } = geometry;
  const isGrandHall = variant === "grand-hall";

  const surfaceTextures = useMemo(() => {
    if (!isGrandHall || typeof document === "undefined") return null;
    try {
      return {
        floor: createParquetFloorTexture(),
        dome: createDomeInteriorTexture(),
      };
    } catch {
      return null;
    }
  }, [isGrandHall]);

  useEffect(() => {
    return () => {
      surfaceTextures?.floor.dispose();
      surfaceTextures?.dome.dispose();
    };
  }, [surfaceTextures]);

  return (
    <group name="room-mesh">
      {/* Lighting */}
      <hemisphereLight args={["#f0f0ff", "#d0c8c0", 1.2]} />
      <ambientLight intensity={0.3} />

      {/* Camera-driven wall auto-fade */}
      <CameraWallDriver />

      {/* Floor */}
      <mesh name="floor" rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial
          color={FLOOR_COLOR}
          map={surfaceTextures?.floor ?? null}
          side={DoubleSide}
          roughness={isGrandHall ? 0.62 : 0.95}
          metalness={isGrandHall ? 0.05 : 0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Floor grid */}
      <FloorGrid polygon={geometry.wallPolygon} />

      {/* Walls — BrickWall instances with click-to-toggle animation.
          Each segment maps to a cardinal WallKey so the visibility store
          drives auto-fade from camera position AND click toggles. */}
      {walls.map((w, i) => (
        <BrickWall
          key={`wall-${String(i)}`}
          name={w.wallKey}
          wallWidth={w.width}
          wallHeight={ceilingHeight}
          position={[w.cx, ceilingHeight / 2, w.cz]}
          rotation={[0, w.rotY, 0]}
          color={WALL_COLOR}
        />
      ))}

      {/* Features (balconies, platforms) */}
      {geometry.features.map((f, i) => (
        <FeatureMesh key={`feature-${String(i)}`} feature={f} />
      ))}

      {/* Dome */}
      {geometry.hasDome && geometry.domeRadius > 0 && (
        <GrandHallDome
          radius={geometry.domeRadius}
          ceilingHeight={ceilingHeight}
          color={DOME_COLOR}
          texture={surfaceTextures?.dome ?? null}
          clippingPlanes={sectionClipPlanes}
        />
      )}

      {isGrandHall && (
        <GrandHallOrnaments width={bounds.width} length={bounds.length} height={ceilingHeight} />
      )}
    </group>
  );
}

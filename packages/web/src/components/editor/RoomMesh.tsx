import { useMemo } from "react";
import { Shape, DoubleSide, BackSide, BufferGeometry, Float32BufferAttribute } from "three";
import { toRenderSpace } from "../../constants/scale.js";
import type { RoomGeometry, RoomFeature } from "../../data/room-geometries.js";
import { FLOOR_COLOR, WALL_COLOR, CEILING_COLOR, GRID_COLOR, DOME_COLOR } from "../../constants/colors.js";
import { sectionClipPlanes, noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// RoomMesh — renders accurate room geometry from polygon data
// ---------------------------------------------------------------------------

const GRID_Y = 0.002;

interface RoomMeshProps {
  readonly geometry: RoomGeometry;
}

/**
 * Converts a polygon of [x,z] metre coords to a Three.js Shape in render space.
 */
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

/**
 * Generates wall segments between consecutive polygon points.
 * Each wall is a plane with height = ceilingHeight, facing inward.
 */
function WallSegments({ polygon, ceilingHeight }: {
  readonly polygon: readonly (readonly [number, number])[];
  readonly ceilingHeight: number;
}): React.ReactElement {
  const walls = useMemo(() => {
    const segments: {
      readonly cx: number;
      readonly cz: number;
      readonly width: number;
      readonly rotY: number;
    }[] = [];

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
      const width = Math.sqrt(dx * dx + dz * dz);
      const rotY = -Math.atan2(dz, dx);

      segments.push({ cx, cz, width, rotY });
    }

    return segments;
  }, [polygon]);

  const halfH = ceilingHeight / 2;

  return (
    <>
      {walls.map((w, i) => (
        <mesh
          key={`wall-${String(i)}`}
          name={`wall-${String(i)}`}
          position={[w.cx, halfH, w.cz]}
          rotation={[0, w.rotY, 0]}
        >
          <planeGeometry args={[w.width, ceilingHeight]} />
          <meshStandardMaterial
            color={WALL_COLOR}
            roughness={0.92}
            metalness={0}
            transparent
            clippingPlanes={sectionClipPlanes}
          />
        </mesh>
      ))}
    </>
  );
}

/**
 * Renders a feature (platform/balcony) as an extruded box.
 */
function FeatureMesh({ feature }: { readonly feature: RoomFeature }): React.ReactElement {
  const shape = useMemo(() => polygonToShape(feature.polygon), [feature.polygon]);

  return (
    <mesh
      name={`feature-${feature.label.toLowerCase().replace(/\s+/g, "-")}`}
      position={[0, feature.height / 2, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <extrudeGeometry args={[shape, { depth: feature.height, bevelEnabled: false }]} />
      <meshStandardMaterial
        color="#8a7a6a"
        roughness={0.85}
        metalness={0}
        clippingPlanes={noClipPlanes}
      />
    </mesh>
  );
}

/**
 * Floor grid — 1m intervals within room bounding box.
 */
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

    // Extend grid slightly beyond room
    const margin = 2;
    minX -= margin; maxX += margin;
    minZ -= margin; maxZ += margin;

    const vertices: number[] = [];
    // Lines along X (varying Z)
    for (let z = Math.floor(minZ); z <= maxZ + 0.001; z += 1) {
      vertices.push(minX, 0, z, maxX, 0, z);
    }
    // Lines along Z (varying X)
    for (let x = Math.floor(minX); x <= maxX + 0.001; x += 1) {
      vertices.push(x, 0, minZ, x, 0, maxZ);
    }

    const geom = new BufferGeometry();
    geom.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    return geom;
  }, [polygon]);

  return (
    <lineSegments geometry={gridGeom} position={[0, GRID_Y, 0]}>
      <lineBasicMaterial color={GRID_COLOR} />
    </lineSegments>
  );
}

/**
 * RoomMesh — renders a complete room from polygon geometry data.
 * Floor and ceiling are ShapeGeometry from the polygon.
 * Walls are individual plane segments between polygon vertices.
 * Features (platforms, balconies) are extruded shapes.
 */
export function RoomMesh({ geometry }: RoomMeshProps): React.ReactElement {
  const floorShape = useMemo(() => polygonToShape(geometry.wallPolygon), [geometry.wallPolygon]);
  const { ceilingHeight } = geometry;

  return (
    <group name="room-mesh">
      {/* Lighting */}
      <hemisphereLight args={["#f0f0ff", "#d0c8c0", 1.2]} />
      <ambientLight intensity={0.3} />

      {/* Floor */}
      <mesh name="floor" rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial
          color={FLOOR_COLOR}
          side={DoubleSide}
          roughness={0.95}
          metalness={0}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Floor grid */}
      <FloorGrid polygon={geometry.wallPolygon} />

      {/* AO strip at floor-wall junction */}
      <mesh name="floor-ao" rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial
          color="#888880"
          side={DoubleSide}
          roughness={1}
          metalness={0}
          transparent
          opacity={0.08}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Ceiling */}
      <mesh name="ceiling" rotation={[Math.PI / 2, 0, 0]} position={[0, ceilingHeight, 0]}>
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial
          color={CEILING_COLOR}
          roughness={0.95}
          metalness={0}
          transparent
          clippingPlanes={sectionClipPlanes}
        />
      </mesh>

      {/* Walls */}
      <WallSegments polygon={geometry.wallPolygon} ceilingHeight={ceilingHeight} />

      {/* Features (balconies, platforms) */}
      {geometry.features.map((f, i) => (
        <FeatureMesh key={`feature-${String(i)}`} feature={f} />
      ))}

      {/* Dome (Grand Hall) */}
      {geometry.hasDome && geometry.domeRadius > 0 && (
        <mesh
          name="dome"
          position={[0, ceilingHeight + 0.005, 0]}
        >
          <sphereGeometry args={[geometry.domeRadius, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={DOME_COLOR}
            side={BackSide}
            roughness={0.9}
            metalness={0}
            clippingPlanes={sectionClipPlanes}
          />
        </mesh>
      )}
    </group>
  );
}

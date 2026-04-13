import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CylinderGeometry,
  Euler,
  Group,
  MeshStandardMaterial,
  Vector2,
} from "three";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import { useVisibilityStore, WALL_KEYS } from "../stores/visibility-store.js";
import { computeWallBeams } from "../lib/timber-frame.js";
import type { TimberBeam } from "../lib/timber-frame.js";
import {
  createWoodColorTexture,
  createWoodRoughnessTexture,
  createWoodNormalTexture,
} from "../lib/wood-texture.js";

// ---------------------------------------------------------------------------
// TimberFrame — thick oak trunk structural beams shown where walls are hidden
// ---------------------------------------------------------------------------

/** Wall opacity below this threshold shows the timber frame. */
const SHOW_THRESHOLD = 0.5;

/** Cylinder radial segments — enough for smooth round trunk at close range. */
const RADIAL_SEGMENTS = 24;

/** Height segments per meter of beam — for vertex displacement detail. */
const HEIGHT_SEGS_PER_METER = 4;

/** Precompute beams for each wall. */
const WALL_BEAM_MAP: ReadonlyMap<string, readonly TimberBeam[]> = new Map(
  WALL_KEYS.map((key) => [
    key,
    computeWallBeams(
      key,
      GRAND_HALL_RENDER_DIMENSIONS.width,
      GRAND_HALL_RENDER_DIMENSIONS.length,
      GRAND_HALL_RENDER_DIMENSIONS.height,
    ),
  ]),
);

/**
 * Creates a cylinder geometry with organic vertex displacement
 * to simulate a natural tree trunk — slightly irregular radius,
 * subtle bowing, and bark-like bumps.
 */
function createTrunkGeometry(
  radius: number,
  height: number,
  seed: number,
): CylinderGeometry {
  const heightSegs = Math.max(4, Math.round(height * HEIGHT_SEGS_PER_METER));
  // Slight taper — thicker at base
  const topRadius = radius * 0.92;
  const bottomRadius = radius * 1.08;

  const geo = new CylinderGeometry(
    topRadius,
    bottomRadius,
    height,
    RADIAL_SEGMENTS,
    heightSegs,
  );

  // Displace vertices for organic irregularity
  const pos = geo.attributes.position;
  if (pos === undefined) return geo;

  // Simple seeded hash for per-vertex displacement
  const hashSeed = seed * 17 + 31;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Get the angle and distance from center (skip top/bottom cap centers)
    const dist = Math.sqrt(x * x + z * z);
    if (dist < 0.001) continue; // cap center vertex, skip

    const angle = Math.atan2(z, x);
    const normalizedY = (y / height + 0.5); // 0 at bottom, 1 at top

    // --- Radial bumps: simulate bark ridges ---
    // Low-freq undulation (trunk bowing)
    const bow = Math.sin(normalizedY * Math.PI * 2.5 + hashSeed) * radius * 0.04;
    // Medium-freq bumps (bark plates)
    const barkBump = Math.sin(angle * 7 + hashSeed * 0.3) *
      Math.sin(normalizedY * 12 + hashSeed * 0.7) * radius * 0.06;
    // High-freq small bumps (bark texture)
    const microBump = Math.sin(angle * 19 + normalizedY * 25 + hashSeed * 1.3) * radius * 0.025;

    // Combine displacement
    const displacement = bow + barkBump + microBump;

    // Apply radially outward
    const nx = x / dist;
    const nz = z / dist;
    pos.setX(i, x + nx * displacement);
    pos.setZ(i, z + nz * displacement);

    // Slight Y displacement for organic feel
    const yDisp = Math.sin(angle * 5 + normalizedY * 8 + hashSeed) * height * 0.003;
    pos.setY(i, y + yDisp);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * Computes Euler rotation and position offset for each beam based on its axis.
 */
function beamTransform(beam: TimberBeam): {
  rotation: Euler;
} {
  // CylinderGeometry is Y-up by default
  if (beam.axis === "y") {
    return { rotation: new Euler(0, 0, 0) };
  } else if (beam.axis === "x") {
    return { rotation: new Euler(0, 0, Math.PI / 2) };
  } else {
    return { rotation: new Euler(Math.PI / 2, 0, 0) };
  }
}

/**
 * Renders thick oak trunk beams as structural framing for walls that are
 * currently hidden/faded. Each beam is a displaced cylinder with
 * procedural bark textures (colour, roughness, normal maps).
 *
 * Driven imperatively via useFrame — reads wallOpacity from store each frame.
 */
export function TimberFrame(): React.ReactElement {
  const { invalidate } = useThree();
  const groupRefs = useRef<Map<string, Group>>(new Map());

  // Generate procedural oak bark textures once
  const textures = useMemo(() => {
    const colorMap = createWoodColorTexture(42);
    const roughnessMap = createWoodRoughnessTexture(42);
    const normalMap = createWoodNormalTexture(42);
    return { colorMap, roughnessMap, normalMap };
  }, []);
  useEffect(() => () => {
    textures.colorMap.dispose();
    textures.roughnessMap.dispose();
    textures.normalMap.dispose();
  }, [textures]);

  // Pre-build geometries for each beam (displaced cylinder per beam)
  const geometries = useMemo(() => {
    const map = new Map<string, CylinderGeometry[]>();
    for (const key of WALL_KEYS) {
      const beams = WALL_BEAM_MAP.get(key) ?? [];
      map.set(key, beams.map((beam) =>
        createTrunkGeometry(beam.dims[0], beam.dims[1], beam.seed),
      ));
    }
    return map;
  }, []);
  useEffect(() => () => {
    for (const geos of geometries.values()) {
      for (const geo of geos) geo.dispose();
    }
  }, [geometries]);

  useFrame(() => {
    const { wallOpacity } = useVisibilityStore.getState();
    let needsInvalidate = false;

    for (const key of WALL_KEYS) {
      const group = groupRefs.current.get(key);
      if (group === undefined) continue;

      const opacity = wallOpacity[key];
      const shouldShow = opacity < SHOW_THRESHOLD;
      const beamOpacity = Math.max(0, 1 - opacity * 2);

      if (group.visible !== shouldShow) {
        group.visible = shouldShow;
        needsInvalidate = true;
      }

      if (shouldShow) {
        for (const child of group.children) {
          const mat: unknown = (child as { material?: unknown }).material;
          if (mat instanceof MeshStandardMaterial) {
            const targetOpacity = Math.min(1, beamOpacity);
            if (Math.abs(mat.opacity - targetOpacity) > 0.01) {
              mat.opacity = targetOpacity;
              mat.transparent = targetOpacity < 0.99;
              needsInvalidate = true;
            }
          }
        }
      }
    }

    if (needsInvalidate) {
      invalidate();
    }
  });

  return (
    <group name="timber-frame">
      {WALL_KEYS.map((wallKey) => {
        const beams = WALL_BEAM_MAP.get(wallKey) ?? [];
        const geos = geometries.get(wallKey) ?? [];
        return (
          <group
            key={wallKey}
            ref={(g: Group | null) => {
              if (g !== null) {
                groupRefs.current.set(wallKey, g);
              }
            }}
            visible={false}
          >
            {beams.map((beam, i) => {
              const { rotation } = beamTransform(beam);
              const geo = geos[i];
              if (geo === undefined) return null;
              return (
                <mesh
                  key={`${wallKey}-beam-${String(i)}`}
                  position={[beam.position[0], beam.position[1], beam.position[2]]}
                  rotation={rotation}
                  geometry={geo}
                >
                  <meshStandardMaterial
                    map={textures.colorMap}
                    roughnessMap={textures.roughnessMap}
                    normalMap={textures.normalMap}
                    normalScale={new Vector2(1.5, 1.5)}
                    roughness={0.92}
                    metalness={0.0}
                    transparent
                    opacity={0}
                  />
                </mesh>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

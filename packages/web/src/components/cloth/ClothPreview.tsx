// ---------------------------------------------------------------------------
// ClothPreview — floating cloth mesh with vertex displacement
// ---------------------------------------------------------------------------
// Full-size tablecloth that billows and flows as you drag it through the room.
// Uses a custom shader for catenary drape + wave displacement.
// Draw calls: cloth mesh (1) + glow ring (1) + shadow (1) + particles (1) = 4
// ---------------------------------------------------------------------------

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute } from "three";
import type { ShaderMaterial, Mesh } from "three";
import {
  CLOTH_HOVER_HEIGHT,
  CLOTH_EDGE_SAG,
  computeSmoothedVelocity,
  vectorLength,
  updateDisplacement,
  updateRotation,
} from "./useClothPhysics.js";
import { createClothUniforms, createClothMaterial } from "./clothShader.js";
import type { ClothShaderUniforms } from "./clothShader.js";
import { ClothShadow } from "./ClothShadow.js";
import { ClothParticles } from "./ClothParticles.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cloth radius in render units (~1.1m real = 2.2 render for 5ft round table). */
const CLOTH_RADIUS = 2.2;

/** Radial slices around the disc. */
const RADIAL_SEGMENTS = 48;

/** Concentric rings from center to edge — gives enough vertices for drape. */
const RING_COUNT = 24;

/** Velocity smoothing factor. */
const VELOCITY_SMOOTHING = 0.85;

// ---------------------------------------------------------------------------
// Geometry builder — subdivided disc lying in XZ plane
// ---------------------------------------------------------------------------

/**
 * Build a disc BufferGeometry with concentric rings in the XZ plane.
 * Center vertex at origin, rings radiate outward. The vertex shader
 * reads `position.xz` to compute radius and angle for displacement.
 *
 * Total vertices: 1 (center) + radialSegments * ringCount.
 * Total triangles: radialSegments (inner fan) + radialSegments * (ringCount-1) * 2.
 */
function createDiscGeometry(
  radius: number,
  radialSegments: number,
  ringCount: number,
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Center vertex (index 0)
  positions.push(0, 0, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 0.5);

  // Ring vertices: ring 1..ringCount, each with radialSegments verts
  for (let ring = 1; ring <= ringCount; ring++) {
    const ringFrac = ring / ringCount;
    const r = radius * ringFrac;
    for (let seg = 0; seg < radialSegments; seg++) {
      const theta = (seg / radialSegments) * Math.PI * 2;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      uvs.push(0.5 + (Math.cos(theta) * ringFrac) * 0.5, 0.5 + (Math.sin(theta) * ringFrac) * 0.5);
    }
  }

  // Inner fan: center (0) → first ring vertices
  for (let seg = 0; seg < radialSegments; seg++) {
    const next = (seg + 1) % radialSegments;
    indices.push(0, 1 + seg, 1 + next);
  }

  // Quads between consecutive rings
  for (let ring = 0; ring < ringCount - 1; ring++) {
    const ringStart = 1 + ring * radialSegments;
    const nextRingStart = 1 + (ring + 1) * radialSegments;
    for (let seg = 0; seg < radialSegments; seg++) {
      const next = (seg + 1) % radialSegments;
      const a = ringStart + seg;
      const b = ringStart + next;
      const c = nextRingStart + next;
      const d = nextRingStart + seg;
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClothPreviewProps {
  /** World position of the cursor on the floor plane [x, y, z]. */
  readonly position: readonly [number, number, number];
  /** Whether the cloth is near a valid table (changes glow color). */
  readonly nearTable: boolean;
}

// ---------------------------------------------------------------------------
// Internal physics state (mutable ref, never triggers re-render)
// ---------------------------------------------------------------------------

interface PhysicsInternal {
  prevPosition: [number, number, number];
  smoothVelocity: [number, number, number];
  displacement: number;
  rotationY: number;
  time: number;
  speed: number;
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClothPreview({
  position,
  nearTable,
}: ClothPreviewProps): React.ReactElement {
  const meshRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);
  const { invalidate } = useThree();

  // Subdivided disc geometry in XZ plane (created once)
  const geometry = useMemo(
    () => createDiscGeometry(CLOTH_RADIUS, RADIAL_SEGMENTS, RING_COUNT),
    [],
  );

  // Shader material with uniforms
  const uniforms = useMemo<ClothShaderUniforms>(
    () => createClothUniforms(CLOTH_HOVER_HEIGHT, CLOTH_EDGE_SAG, CLOTH_RADIUS),
    [],
  );

  const material = useMemo<ShaderMaterial>(
    () => createClothMaterial(uniforms),
    [uniforms],
  );

  // Physics state (mutable ref, not React state)
  const physics = useRef<PhysicsInternal>({
    prevPosition: [position[0], position[1], position[2]],
    smoothVelocity: [0, 0, 0],
    displacement: 0,
    rotationY: 0,
    time: 0,
    speed: 0,
    initialized: false,
  });

  // Animate each frame — updates shader uniforms + mesh transform
  useFrame((_, delta) => {
    const p = physics.current;
    const dt = Math.min(delta, 0.05);

    if (!p.initialized) {
      p.prevPosition = [position[0], position[1], position[2]];
      p.initialized = true;
      return;
    }

    // Compute velocity from position delta
    const invDt = dt > 0.0001 ? 1 / dt : 0;
    const rawVelocity: [number, number, number] = [
      (position[0] - p.prevPosition[0]) * invDt,
      (position[1] - p.prevPosition[1]) * invDt,
      (position[2] - p.prevPosition[2]) * invDt,
    ];

    p.smoothVelocity = computeSmoothedVelocity(
      p.smoothVelocity,
      rawVelocity,
      VELOCITY_SMOOTHING,
    );

    p.speed = vectorLength(p.smoothVelocity);
    p.displacement = updateDisplacement(p.displacement, p.speed, dt);
    p.rotationY = updateRotation(p.rotationY, p.speed, dt);
    p.time += dt;

    p.prevPosition = [position[0], position[1], position[2]];

    // Push values to shader uniforms (no React re-render)
    uniforms.uTime.value = p.time;
    uniforms.uDisplacement.value = p.displacement;
    uniforms.uSpeed.value = p.speed;

    // Move mesh to cursor XZ, rotation on Y
    const mesh = meshRef.current;
    if (mesh !== null) {
      mesh.position.set(position[0], 0, position[2]);
      mesh.rotation.y = p.rotationY;
    }

    // Keep glow ring tracking cursor
    const glow = glowRef.current;
    if (glow !== null) {
      glow.position.set(position[0], CLOTH_HOVER_HEIGHT + 0.01, position[2]);
    }

    invalidate();
  });

  const glowColor = nearTable ? "#4FC3F7" : "#ee3333";

  return (
    <>
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        frustumCulled={false}
      />
      {/* Validity glow ring at cloth center */}
      <mesh
        ref={glowRef}
        position={[position[0], CLOTH_HOVER_HEIGHT + 0.01, position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.08, 0.14, 16]} />
        <meshStandardMaterial
          color={glowColor}
          emissive={glowColor}
          emissiveIntensity={0.6}
          transparent
          opacity={0.7}
        />
      </mesh>
      <ClothShadow position={position} />
      <ClothParticles position={position} physicsRef={physics} />
    </>
  );
}

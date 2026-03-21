// ---------------------------------------------------------------------------
// ClothParticles — subtle particle trail behind moving cloth
// ---------------------------------------------------------------------------
// Small glowing dots drift from the cloth edges when it moves quickly.
// Pooled to max 30 particles. Fade over 0.6s. One instanced mesh draw call.
// ---------------------------------------------------------------------------

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  SphereGeometry,
  MeshBasicMaterial,
  Object3D,
  Color,
} from "three";
import type { InstancedMesh } from "three";
import { CLOTH_HOVER_HEIGHT } from "./useClothPhysics.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PARTICLES = 30;
const PARTICLE_LIFETIME = 0.6;
const PARTICLE_SIZE = 0.03;
const SPAWN_THRESHOLD = 1.5;
const SPAWN_RATE = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  alive: boolean;
}

/** The mutable physics state ref shared from ClothPreview. */
interface PhysicsSnapshot {
  readonly speed: number;
  readonly displacement: number;
}

interface ClothParticlesProps {
  readonly position: readonly [number, number, number];
  readonly physicsRef: React.RefObject<PhysicsSnapshot>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClothParticles({
  position,
  physicsRef,
}: ClothParticlesProps): React.ReactElement {
  const meshRef = useRef<InstancedMesh>(null);
  const { invalidate } = useThree();

  const particles = useRef<Particle[]>(
    Array.from({ length: MAX_PARTICLES }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, alive: false,
    })),
  );

  const dummy = useMemo(() => new Object3D(), []);
  const geometry = useMemo(() => new SphereGeometry(PARTICLE_SIZE, 6, 4), []);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color("#aaaacc"),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    [],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const inst = meshRef.current;
    if (inst === null) return;

    const pool = particles.current;
    const phys = physicsRef.current;
    if (phys === null) return;
    const speed = phys.speed;
    const displacement = phys.displacement;

    // Spawn new particles when moving fast enough
    if (speed > SPAWN_THRESHOLD && displacement > 0.1) {
      let spawned = 0;
      for (let i = 0; i < MAX_PARTICLES && spawned < SPAWN_RATE; i++) {
        const p = pool[i];
        if (p !== undefined && !p.alive) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 1.5 + Math.random() * 0.7;
          p.x = position[0] + Math.cos(angle) * radius;
          p.y = CLOTH_HOVER_HEIGHT - 0.3 + Math.random() * 0.6;
          p.z = position[2] + Math.sin(angle) * radius;
          p.vx = Math.cos(angle) * 0.5 + (Math.random() - 0.5) * 0.3;
          p.vy = 0.3 + Math.random() * 0.4;
          p.vz = Math.sin(angle) * 0.5 + (Math.random() - 0.5) * 0.3;
          p.age = 0;
          p.alive = true;
          spawned++;
        }
      }
    }

    // Update all particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = pool[i];
      if (p === undefined) continue;

      if (p.alive) {
        p.age += dt;
        if (p.age >= PARTICLE_LIFETIME) {
          p.alive = false;
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.vx *= 0.97;
          p.vy *= 0.97;
          p.vz *= 0.97;
        }
      }

      if (p.alive) {
        const fade = 1 - p.age / PARTICLE_LIFETIME;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.set(fade, fade, fade);
      } else {
        dummy.position.set(0, -100, 0);
        dummy.scale.set(0, 0, 0);
      }
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }

    inst.instanceMatrix.needsUpdate = true;
    invalidate();
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_PARTICLES]}
      frustumCulled={false}
    />
  );
}

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide } from "three";
import type { Group } from "three";

// ---------------------------------------------------------------------------
// ClothGhostIcon — dangling cloth shape shown when dragging cloth
//                  with no table nearby
// ---------------------------------------------------------------------------

interface ClothGhostIconProps {
  readonly position: readonly [number, number, number];
  readonly color: string;
}

/**
 * A dangling tablecloth shape — pinched at the top, draping down in folds.
 * Gently sways to feel alive. Shown at cursor when dragging cloth with
 * no table in snap range.
 */
export function ClothGhostIcon({
  position,
  color,
}: ClothGhostIconProps): React.ReactElement {
  const groupRef = useRef<Group>(null);

  // Gentle swaying motion
  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (g === null) return;
    const t = clock.getElapsedTime();
    g.rotation.z = Math.sin(t * 1.8) * 0.08;
    g.rotation.x = Math.sin(t * 1.3 + 0.5) * 0.05;
  });

  // Use the cloth's actual color (black for black cloth), not placement color
  const clothColor = "#1a1a1a";

  return (
    <group position={[position[0], position[1] + 0.8, position[2]]}>
      <group ref={groupRef}>
        {/* Pinch point — where fingers grip the cloth */}
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[0.04, 12, 8]} />
          <meshStandardMaterial
            color={clothColor}
            roughness={0.9}
            metalness={0}
            transparent
            opacity={0.8}
          />
        </mesh>

        {/* Upper drape — narrow cone hanging from pinch */}
        <mesh position={[0, -0.12, 0]}>
          <coneGeometry args={[0.15, 0.22, 16]} />
          <meshStandardMaterial
            color={clothColor}
            roughness={0.95}
            metalness={0}
            transparent
            opacity={0.7}
            side={DoubleSide}
          />
        </mesh>

        {/* Main body — wider cone for the bulk of the drape */}
        <mesh position={[0, -0.32, 0]}>
          <coneGeometry args={[0.3, 0.28, 20]} />
          <meshStandardMaterial
            color={clothColor}
            roughness={0.95}
            metalness={0}
            transparent
            opacity={0.65}
            side={DoubleSide}
          />
        </mesh>

        {/* Bottom hem — widest part with slight irregularity */}
        <mesh position={[0, -0.48, 0]} rotation={[0.05, 0, 0.03]}>
          <coneGeometry args={[0.38, 0.12, 24]} />
          <meshStandardMaterial
            color={clothColor}
            roughness={0.95}
            metalness={0}
            transparent
            opacity={0.55}
            side={DoubleSide}
          />
        </mesh>

        {/* Fold highlights — thin offset layers for visual depth */}
        <mesh position={[0.04, -0.25, 0.02]} rotation={[0, 0.4, 0.06]}>
          <coneGeometry args={[0.12, 0.3, 8]} />
          <meshStandardMaterial
            color={color === "#ee3333" ? "#cc2222" : "#2a2a2a"}
            roughness={0.95}
            metalness={0}
            transparent
            opacity={0.35}
            side={DoubleSide}
          />
        </mesh>
        <mesh position={[-0.03, -0.28, -0.02]} rotation={[0, -0.3, -0.04]}>
          <coneGeometry args={[0.1, 0.28, 8]} />
          <meshStandardMaterial
            color={color === "#ee3333" ? "#cc2222" : "#2a2a2a"}
            roughness={0.95}
            metalness={0}
            transparent
            opacity={0.3}
            side={DoubleSide}
          />
        </mesh>

        {/* Subtle validity indicator — thin ring glow at pinch point */}
        <mesh position={[0, 0, 0]}>
          <torusGeometry args={[0.06, 0.012, 8, 16]} />
          <meshStandardMaterial
            color={color}
            roughness={0.3}
            metalness={0.2}
            transparent
            opacity={0.6}
            emissive={color}
            emissiveIntensity={0.5}
          />
        </mesh>
      </group>
    </group>
  );
}

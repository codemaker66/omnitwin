// ---------------------------------------------------------------------------
// ClothShadow — ground shadow beneath the floating cloth
// ---------------------------------------------------------------------------
// A soft, transparent circle on the floor that grows fainter
// as the cloth rises higher. Gives spatial grounding.
// ---------------------------------------------------------------------------

import { CLOTH_HOVER_HEIGHT } from "./useClothPhysics.js";

interface ClothShadowProps {
  readonly position: readonly [number, number, number];
}

/** Shadow radius — slightly smaller than cloth for perspective effect. */
const SHADOW_RADIUS = 1.8;

/** Shadow opacity varies with inverse of height. */
const MAX_SHADOW_OPACITY = 0.18;

export function ClothShadow({ position }: ClothShadowProps): React.ReactElement {
  // Opacity diminishes with height (cloth hovers at CLOTH_HOVER_HEIGHT)
  const opacity = MAX_SHADOW_OPACITY * Math.max(0, 1 - CLOTH_HOVER_HEIGHT / 8);

  return (
    <mesh
      position={[position[0], 0.005, position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <circleGeometry args={[SHADOW_RADIUS, 32]} />
      <meshBasicMaterial
        color="#000000"
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

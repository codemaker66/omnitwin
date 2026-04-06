import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// MicrophoneMesh — tabletop microphone (gooseneck or short desktop mic)
// ---------------------------------------------------------------------------

interface MicrophoneMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

export function MicrophoneMesh({
  item,
  opacity = 1,
  colorOverride,
}: MicrophoneMeshProps): React.ReactElement {
  const renderWidth = useMemo(() => toRenderSpace(item.width), [item.width]);
  const height = item.height;
  const isTransparent = opacity < 1;

  const bodyColor = colorOverride ?? "#2a2a2a";
  const grillColor = colorOverride ?? "#555555";
  const ringColor = colorOverride ?? "#888888";

  const baseRadius = renderWidth / 2;
  const baseHeight = 0.015;
  const stemRadius = 0.008;
  const stemHeight = height * 0.6;
  const headRadius = 0.018;
  const headHeight = height * 0.3;

  return (
    <group>
      {/* Heavy base */}
      <mesh position={[0, baseHeight / 2, 0]}>
        <cylinderGeometry args={[baseRadius, baseRadius, baseHeight, 16]} />
        <meshStandardMaterial
          color={bodyColor}
          roughness={0.5}
          metalness={0.4}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Stem */}
      <mesh position={[0, baseHeight + stemHeight / 2, 0]}>
        <cylinderGeometry args={[stemRadius, stemRadius, stemHeight, 8]} />
        <meshStandardMaterial
          color={bodyColor}
          roughness={0.4}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Ring connector */}
      <mesh position={[0, baseHeight + stemHeight, 0]}>
        <cylinderGeometry args={[stemRadius + 0.004, stemRadius + 0.004, 0.008, 12]} />
        <meshStandardMaterial
          color={ringColor}
          roughness={0.3}
          metalness={0.6}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Microphone head (grille) */}
      <mesh position={[0, baseHeight + stemHeight + headHeight / 2, 0]}>
        <capsuleGeometry args={[headRadius, headHeight * 0.4, 8, 12]} />
        <meshStandardMaterial
          color={grillColor}
          roughness={0.7}
          metalness={0.3}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>
    </group>
  );
}

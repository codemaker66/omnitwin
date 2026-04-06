import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// MicStandMesh — floor-standing microphone stand with boom arm
// ---------------------------------------------------------------------------

interface MicStandMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

export function MicStandMesh({
  item,
  opacity = 1,
  colorOverride,
}: MicStandMeshProps): React.ReactElement {
  const renderWidth = useMemo(() => toRenderSpace(item.width), [item.width]);
  const height = item.height;
  const isTransparent = opacity < 1;

  const metalColor = colorOverride ?? "#2a2a2a";
  const grillColor = colorOverride ?? "#555555";

  const baseRadius = renderWidth / 2;
  const baseHeight = 0.02;
  const poleRadius = 0.012;
  const poleHeight = height * 0.8;
  const boomLength = 0.35;
  const boomAngle = Math.PI * 0.15; // slight upward angle
  const headRadius = 0.02;
  const headHeight = 0.08;

  // Tripod legs
  const legLength = baseRadius * 1.2;
  const legRadius = 0.008;

  return (
    <group>
      {/* Tripod legs (3 splayed legs) */}
      {[0, 1, 2].map((i) => {
        const angle = (i * Math.PI * 2) / 3;
        const lx = Math.sin(angle) * legLength * 0.5;
        const lz = Math.cos(angle) * legLength * 0.5;
        return (
          <mesh
            key={i}
            position={[lx, baseHeight / 2, lz]}
            rotation={[0, -angle, Math.PI * 0.47]}
          >
            <cylinderGeometry args={[legRadius, legRadius, legLength, 6]} />
            <meshStandardMaterial
              color={metalColor}
              roughness={0.4}
              metalness={0.5}
              transparent={isTransparent}
              opacity={opacity}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
        );
      })}

      {/* Center hub */}
      <mesh position={[0, baseHeight, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.03, 12]} />
        <meshStandardMaterial
          color={metalColor}
          roughness={0.4}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Main pole */}
      <mesh position={[0, baseHeight + poleHeight / 2, 0]}>
        <cylinderGeometry args={[poleRadius, poleRadius + 0.003, poleHeight, 8]} />
        <meshStandardMaterial
          color={metalColor}
          roughness={0.4}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Boom arm — angled from top of pole */}
      <group position={[0, baseHeight + poleHeight, 0]}>
        {/* Boom pivot clamp */}
        <mesh>
          <cylinderGeometry args={[0.015, 0.015, 0.02, 8]} />
          <meshStandardMaterial
            color={metalColor}
            roughness={0.4}
            metalness={0.5}
            transparent={isTransparent}
            opacity={opacity}
            clippingPlanes={noClipPlanes}
          />
        </mesh>

        {/* Boom arm */}
        <mesh
          position={[boomLength / 2 * Math.cos(boomAngle), boomLength / 2 * Math.sin(boomAngle), 0]}
          rotation={[0, 0, -boomAngle]}
        >
          <cylinderGeometry args={[0.008, 0.008, boomLength, 6]} />
          <meshStandardMaterial
            color={metalColor}
            roughness={0.4}
            metalness={0.5}
            transparent={isTransparent}
            opacity={opacity}
            clippingPlanes={noClipPlanes}
          />
        </mesh>

        {/* Mic head at end of boom */}
        <group position={[boomLength * Math.cos(boomAngle), boomLength * Math.sin(boomAngle), 0]}>
          <mesh position={[0, headHeight / 2, 0]}>
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
      </group>
    </group>
  );
}

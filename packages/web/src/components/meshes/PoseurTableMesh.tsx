import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// PoseurTableMesh — cocktail/poseur table with 4-star base
// Variants: bare aluminium, black cloth cover, white cloth cover
// ---------------------------------------------------------------------------

interface PoseurTableMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

export function PoseurTableMesh({
  item,
  opacity = 1,
  colorOverride,
}: PoseurTableMeshProps): React.ReactElement {
  const renderRadius = useMemo(() => toRenderSpace(item.width / 2), [item.width]);
  const height = item.height;
  const isTransparent = opacity < 1;

  // Determine variant from item ID
  const isBlackCloth = item.id === "poseur-table-black";
  const isWhiteCloth = item.id === "poseur-table-white";
  const hasCloth = isBlackCloth || isWhiteCloth;

  const metalColor = colorOverride ?? "#c0c0c8";
  const metalDark = colorOverride ?? "#a0a0a8";
  const clothColor = colorOverride ?? (isBlackCloth ? "#1a1a1a" : isWhiteCloth ? "#f0ede8" : metalColor);

  const topThickness = 0.025;
  const topY = height - topThickness / 2;
  const poleRadius = 0.025;
  const poleTopY = height - topThickness;

  // Base dimensions
  const baseHeight = 0.025;
  const armLength = renderRadius * 0.8;
  const armWidth = 0.04;
  const footRadius = 0.015;
  const footHeight = 0.012;

  if (hasCloth) {
    // Spandex cover: hourglass shape using a lathe-like approach with stacked cylinders
    const segments = 20;
    const clothParts: React.ReactElement[] = [];
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const y0 = t0 * height;
      const y1 = t1 * height;
      // Hourglass curve: wide at top and bottom, narrow in middle
      const curve0 = hourglassRadius(t0, renderRadius);
      const curve1 = hourglassRadius(t1, renderRadius);
      const segH = y1 - y0;
      clothParts.push(
        <mesh key={i} position={[0, y0 + segH / 2, 0]}>
          <cylinderGeometry args={[curve1, curve0, segH, 24]} />
          <meshStandardMaterial
            color={clothColor}
            roughness={0.85}
            metalness={0}
            transparent={isTransparent}
            opacity={opacity}
            clippingPlanes={noClipPlanes}
          />
        </mesh>,
      );
    }

    return (
      <group>
        {clothParts}
        {/* Flat top disc */}
        <mesh position={[0, height + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[renderRadius, 24]} />
          <meshStandardMaterial
            color={clothColor}
            roughness={0.8}
            metalness={0}
            transparent={isTransparent}
            opacity={opacity}
            clippingPlanes={noClipPlanes}
          />
        </mesh>
      </group>
    );
  }

  // Bare aluminium version
  return (
    <group>
      {/* Round top */}
      <mesh position={[0, topY, 0]}>
        <cylinderGeometry args={[renderRadius, renderRadius, topThickness, 32]} />
        <meshStandardMaterial
          color={metalColor}
          roughness={0.25}
          metalness={0.7}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Top edge rim */}
      <mesh position={[0, topY, 0]}>
        <torusGeometry args={[renderRadius, 0.005, 8, 32]} />
        <meshStandardMaterial
          color={metalDark}
          roughness={0.3}
          metalness={0.8}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Centre pole */}
      <mesh position={[0, poleTopY / 2, 0]}>
        <cylinderGeometry args={[poleRadius, poleRadius + 0.005, poleTopY, 12]} />
        <meshStandardMaterial
          color={metalColor}
          roughness={0.3}
          metalness={0.7}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Collar ring (mid-pole join) */}
      <mesh position={[0, height * 0.45, 0]}>
        <cylinderGeometry args={[poleRadius + 0.008, poleRadius + 0.008, 0.015, 12]} />
        <meshStandardMaterial
          color={metalDark}
          roughness={0.3}
          metalness={0.7}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* 4-star base arms */}
      {[0, 1, 2, 3].map((i) => {
        const angle = (i * Math.PI) / 2 + Math.PI / 4;
        const cx = Math.sin(angle) * armLength * 0.5;
        const cz = Math.cos(angle) * armLength * 0.5;
        return (
          <group key={i}>
            {/* Arm */}
            <mesh
              position={[cx, baseHeight / 2, cz]}
              rotation={[0, -angle, 0]}
            >
              <boxGeometry args={[armWidth, baseHeight, armLength]} />
              <meshStandardMaterial
                color={metalDark}
                roughness={0.35}
                metalness={0.6}
                transparent={isTransparent}
                opacity={opacity}
                clippingPlanes={noClipPlanes}
              />
            </mesh>
            {/* Foot */}
            <mesh position={[Math.sin(angle) * armLength, footHeight / 2, Math.cos(angle) * armLength]}>
              <cylinderGeometry args={[footRadius, footRadius + 0.005, footHeight, 8]} />
              <meshStandardMaterial
                color="#333"
                roughness={0.9}
                metalness={0}
                transparent={isTransparent}
                opacity={opacity}
                clippingPlanes={noClipPlanes}
              />
            </mesh>
          </group>
        );
      })}

      {/* Centre hub */}
      <mesh position={[0, baseHeight / 2, 0]}>
        <cylinderGeometry args={[0.035, 0.035, baseHeight + 0.005, 12]} />
        <meshStandardMaterial
          color={metalDark}
          roughness={0.35}
          metalness={0.6}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>
    </group>
  );
}

/** Hourglass radius curve: wide at t=0 (bottom) and t=1 (top), narrow at t≈0.5 */
function hourglassRadius(t: number, maxR: number): number {
  // Pinch factor — how narrow the waist gets (0 = no pinch, 1 = full pinch)
  const pinch = 0.55;
  // Smooth curve: 1 at edges, (1-pinch) at center
  const curve = 1 - pinch * Math.sin(t * Math.PI);
  return maxR * curve;
}

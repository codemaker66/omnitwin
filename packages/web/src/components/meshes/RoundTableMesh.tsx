import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// RoundTableMesh — cylinder top + pedestal base for round tables
// ---------------------------------------------------------------------------

interface RoundTableMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

/** Thickness of the table top disc. */
const TOP_THICKNESS = 0.04;
/** Pedestal base radius as fraction of table radius. */
const PEDESTAL_RADIUS_FRAC = 0.15;
/** Pedestal foot disc radius as fraction of table radius. */
const FOOT_RADIUS_FRAC = 0.35;
/** Foot disc thickness. */
const FOOT_THICKNESS = 0.02;

export function RoundTableMesh({
  item,
  opacity = 1,
  colorOverride,
}: RoundTableMeshProps): React.ReactElement {
  const renderRadius = useMemo(() => toRenderSpace(item.width) / 2, [item.width]);
  const tableHeight = item.height;
  const color = colorOverride ?? item.color;
  const isTransparent = opacity < 1;

  const pedestalRadius = renderRadius * PEDESTAL_RADIUS_FRAC;
  const footRadius = renderRadius * FOOT_RADIUS_FRAC;
  const legHeight = tableHeight - TOP_THICKNESS;

  return (
    <group>
      {/* Table top — flat cylinder */}
      <mesh position={[0, tableHeight - TOP_THICKNESS / 2, 0]}>
        <cylinderGeometry args={[renderRadius, renderRadius, TOP_THICKNESS, 64]} />
        <meshStandardMaterial
          color={color}
          roughness={0.7}
          metalness={0.05}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Central pedestal column */}
      <mesh position={[0, legHeight / 2, 0]}>
        <cylinderGeometry args={[pedestalRadius, pedestalRadius, legHeight, 16]} />
        <meshStandardMaterial
          color={color}
          roughness={0.8}
          metalness={0.05}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Base foot disc */}
      <mesh position={[0, FOOT_THICKNESS / 2, 0]}>
        <cylinderGeometry args={[footRadius, footRadius, FOOT_THICKNESS, 32]} />
        <meshStandardMaterial
          color={color}
          roughness={0.8}
          metalness={0.05}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>
    </group>
  );
}

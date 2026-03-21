import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// PlatformMesh — stage platform / riser block
// ---------------------------------------------------------------------------

interface PlatformMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

/** Lip/edge highlight strip height. */
const EDGE_STRIP_HEIGHT = 0.01;

export function PlatformMesh({
  item,
  opacity = 1,
  colorOverride,
}: PlatformMeshProps): React.ReactElement {
  const renderWidth = useMemo(() => toRenderSpace(item.width), [item.width]);
  const renderDepth = useMemo(() => toRenderSpace(item.depth), [item.depth]);
  const height = item.height;
  const color = colorOverride ?? item.color;
  const isTransparent = opacity < 1;

  return (
    <group>
      {/* Main block */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[renderWidth, height, renderDepth]} />
        <meshStandardMaterial
          color={color}
          roughness={0.9}
          metalness={0}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Safety edge strip on top */}
      <mesh position={[0, height + EDGE_STRIP_HEIGHT / 2, 0]}>
        <boxGeometry args={[renderWidth + 0.01, EDGE_STRIP_HEIGHT, renderDepth + 0.01]} />
        <meshStandardMaterial
          color="#666666"
          roughness={0.7}
          metalness={0.1}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>
    </group>
  );
}

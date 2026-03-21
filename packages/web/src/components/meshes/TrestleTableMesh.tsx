import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// TrestleTableMesh — rectangular top + trestle legs
// ---------------------------------------------------------------------------

interface TrestleTableMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

/** Thickness of the table top. */
const TOP_THICKNESS = 0.03;
/** Leg width and depth. */
const LEG_SIZE = 0.04;
/** How far inset legs are from the table edge (render-space fraction). */
const LEG_INSET_FRAC = 0.08;
/** Cross-brace height as fraction of leg height. */
const BRACE_HEIGHT_FRAC = 0.3;
/** Cross-brace thickness. */
const BRACE_THICKNESS = 0.025;

export function TrestleTableMesh({
  item,
  opacity = 1,
  colorOverride,
}: TrestleTableMeshProps): React.ReactElement {
  const renderWidth = useMemo(() => toRenderSpace(item.width), [item.width]);
  const renderDepth = useMemo(() => toRenderSpace(item.depth), [item.depth]);
  const tableHeight = item.height;
  const color = colorOverride ?? item.color;
  const isTransparent = opacity < 1;

  const legHeight = tableHeight - TOP_THICKNESS;
  const legInsetX = renderWidth * LEG_INSET_FRAC;
  const legInsetZ = renderDepth * LEG_INSET_FRAC;
  const halfW = renderWidth / 2 - legInsetX;
  const halfD = renderDepth / 2 - legInsetZ;
  const braceY = legHeight * BRACE_HEIGHT_FRAC;

  const mat = (
    <meshStandardMaterial
      color={color}
      roughness={0.75}
      metalness={0.05}
      transparent={isTransparent}
      opacity={opacity}
      clippingPlanes={noClipPlanes}
    />
  );

  return (
    <group>
      {/* Table top */}
      <mesh position={[0, tableHeight - TOP_THICKNESS / 2, 0]}>
        <boxGeometry args={[renderWidth, TOP_THICKNESS, renderDepth]} />
        {mat}
      </mesh>

      {/* Four legs */}
      {[
        [-halfW, -halfD],
        [halfW, -halfD],
        [-halfW, halfD],
        [halfW, halfD],
      ].map(([lx, lz], i) => (
        <mesh key={i} position={[lx ?? 0, legHeight / 2, lz ?? 0]}>
          <boxGeometry args={[LEG_SIZE, legHeight, LEG_SIZE]} />
          {mat}
        </mesh>
      ))}

      {/* Cross-braces along width (front and back) */}
      {[-halfD, halfD].map((bz, i) => (
        <mesh key={`brace-w-${String(i)}`} position={[0, braceY, bz]}>
          <boxGeometry args={[halfW * 2, BRACE_THICKNESS, BRACE_THICKNESS]} />
          {mat}
        </mesh>
      ))}

      {/* Cross-braces along depth (left and right) */}
      {[-halfW, halfW].map((bx, i) => (
        <mesh key={`brace-d-${String(i)}`} position={[bx, braceY, 0]}>
          <boxGeometry args={[BRACE_THICKNESS, BRACE_THICKNESS, halfD * 2]} />
          {mat}
        </mesh>
      ))}
    </group>
  );
}

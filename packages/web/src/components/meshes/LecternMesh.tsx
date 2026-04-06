import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// LecternMesh — floor-standing lectern / podium
// ---------------------------------------------------------------------------

interface LecternMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

export function LecternMesh({
  item,
  opacity = 1,
  colorOverride,
}: LecternMeshProps): React.ReactElement {
  const renderWidth = useMemo(() => toRenderSpace(item.width), [item.width]);
  const renderDepth = useMemo(() => toRenderSpace(item.depth), [item.depth]);
  const height = item.height;
  const isTransparent = opacity < 1;

  const woodColor = colorOverride ?? "#5a3a20";
  const darkWood = colorOverride ?? "#3a2210";
  const topColor = colorOverride ?? "#4a2a15";

  const baseW = renderWidth * 0.7;
  const baseD = renderDepth * 0.7;
  const baseH = 0.04;

  const columnW = renderWidth * 0.55;
  const columnD = renderDepth * 0.5;
  const columnH = height * 0.7;

  const topW = renderWidth;
  const topD = renderDepth;
  const topH = 0.03;
  const topY = baseH + columnH;

  // Angled reading surface
  const readAngle = Math.PI * 0.12; // ~22° tilt
  const readH = height * 0.25;
  const readThickness = 0.015;

  return (
    <group>
      {/* Base */}
      <mesh position={[0, baseH / 2, 0]}>
        <boxGeometry args={[baseW, baseH, baseD]} />
        <meshStandardMaterial
          color={darkWood}
          roughness={0.8}
          metalness={0}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Column / body */}
      <mesh position={[0, baseH + columnH / 2, 0]}>
        <boxGeometry args={[columnW, columnH, columnD]} />
        <meshStandardMaterial
          color={woodColor}
          roughness={0.75}
          metalness={0}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Top shelf */}
      <mesh position={[0, topY + topH / 2, 0]}>
        <boxGeometry args={[topW, topH, topD]} />
        <meshStandardMaterial
          color={topColor}
          roughness={0.7}
          metalness={0}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Angled reading surface — tilted toward speaker */}
      <mesh
        position={[0, topY + topH + readH / 2 * Math.cos(readAngle), -readH / 2 * Math.sin(readAngle) + renderDepth * 0.05]}
        rotation={[readAngle, 0, 0]}
      >
        <boxGeometry args={[topW * 0.95, readThickness, readH]} />
        <meshStandardMaterial
          color={darkWood}
          roughness={0.7}
          metalness={0}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Front lip to hold papers */}
      <mesh
        position={[0, topY + topH + 0.005, renderDepth * 0.05 + readH * 0.45 * Math.sin(readAngle)]}
      >
        <boxGeometry args={[topW * 0.9, 0.025, 0.01]} />
        <meshStandardMaterial
          color={darkWood}
          roughness={0.7}
          metalness={0}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>
    </group>
  );
}

import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// LaptopMesh — open laptop with screen and keyboard
// ---------------------------------------------------------------------------

interface LaptopMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

export function LaptopMesh({
  item,
  opacity = 1,
  colorOverride,
}: LaptopMeshProps): React.ReactElement {
  const renderWidth = useMemo(() => toRenderSpace(item.width), [item.width]);
  const renderDepth = useMemo(() => toRenderSpace(item.depth), [item.depth]);
  const height = item.height;
  const isTransparent = opacity < 1;

  const bodyColor = colorOverride ?? "#2a2a2e";
  const screenColor = colorOverride ?? "#1a1a20";
  const displayColor = colorOverride ?? "#3a4a5a";
  const keyboardColor = colorOverride ?? "#1e1e22";

  const baseThickness = 0.015;
  const screenThickness = 0.008;
  const screenAngle = -Math.PI * 0.38; // tilted back ~68°

  const screenH = height - baseThickness;

  return (
    <group>
      {/* Base / keyboard slab */}
      <mesh position={[0, baseThickness / 2, 0]}>
        <boxGeometry args={[renderWidth, baseThickness, renderDepth]} />
        <meshStandardMaterial
          color={bodyColor}
          roughness={0.6}
          metalness={0.3}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Keyboard area (slightly recessed, darker) */}
      <mesh position={[0, baseThickness + 0.001, renderDepth * 0.05]}>
        <boxGeometry args={[renderWidth * 0.85, 0.002, renderDepth * 0.7]} />
        <meshStandardMaterial
          color={keyboardColor}
          roughness={0.8}
          metalness={0.1}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Trackpad */}
      <mesh position={[0, baseThickness + 0.001, renderDepth * 0.32]}>
        <boxGeometry args={[renderWidth * 0.3, 0.002, renderDepth * 0.18]} />
        <meshStandardMaterial
          color={bodyColor}
          roughness={0.3}
          metalness={0.4}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Screen lid — pivots from back edge */}
      <group position={[0, baseThickness, -renderDepth / 2]} rotation={[screenAngle, 0, 0]}>
        {/* Screen shell */}
        <mesh position={[0, screenH / 2, -screenThickness / 2]}>
          <boxGeometry args={[renderWidth, screenH, screenThickness]} />
          <meshStandardMaterial
            color={screenColor}
            roughness={0.6}
            metalness={0.3}
            transparent={isTransparent}
            opacity={opacity}
            clippingPlanes={noClipPlanes}
          />
        </mesh>

        {/* Display surface (inner face) */}
        <mesh position={[0, screenH / 2, 0.001]}>
          <planeGeometry args={[renderWidth * 0.9, screenH * 0.88]} />
          <meshStandardMaterial
            color={displayColor}
            roughness={0.1}
            metalness={0.2}
            emissive={colorOverride !== undefined ? "#000000" : "#1a2a3a"}
            emissiveIntensity={0.3}
            transparent={isTransparent}
            opacity={opacity}
            clippingPlanes={noClipPlanes}
          />
        </mesh>
      </group>
    </group>
  );
}

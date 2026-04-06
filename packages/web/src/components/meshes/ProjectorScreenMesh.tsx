import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// ProjectorScreenMesh — freestanding projector screen on tripod legs
// ---------------------------------------------------------------------------

interface ProjectorScreenMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

/** Frame border width around the screen (metres). */
const FRAME_BORDER = 0.04;
/** Screen panel thickness (metres). */
const PANEL_THICKNESS = 0.02;
/** Leg tube diameter (metres). */
const LEG_DIAMETER = 0.03;
/** How far legs splay out from center at the base (metres). */
const LEG_SPLAY = 0.4;
/** Crossbar height from ground (metres). */
const CROSSBAR_HEIGHT_RATIO = 0.35;

export function ProjectorScreenMesh({
  item,
  opacity = 1,
  colorOverride,
}: ProjectorScreenMeshProps): React.ReactElement {
  const renderWidth = useMemo(() => toRenderSpace(item.width), [item.width]);
  const renderDepth = useMemo(() => toRenderSpace(item.depth), [item.depth]);
  const height = item.height;
  const isTransparent = opacity < 1;

  // Screen panel dimensions (the white projection surface)
  const screenW = renderWidth - FRAME_BORDER * 2;
  const screenH = height * 0.65;
  const screenCenterY = height * 0.55;

  // Frame dimensions (black border around screen)
  const frameW = renderWidth;
  const frameH = screenH + FRAME_BORDER * 2;
  const frameCenterY = screenCenterY;

  // Leg geometry
  const legHeight = frameCenterY - frameH / 2;
  const legHalfSplay = LEG_SPLAY;
  const crossbarY = legHeight * CROSSBAR_HEIGHT_RATIO;

  const frameColor = colorOverride ?? "#1a1a1a";
  const screenColor = colorOverride ?? "#f0f0f0";
  const legColor = colorOverride ?? "#888888";

  return (
    <group>
      {/* Black frame behind screen */}
      <mesh position={[0, frameCenterY, 0]}>
        <boxGeometry args={[frameW, frameH, PANEL_THICKNESS]} />
        <meshStandardMaterial
          color={frameColor}
          roughness={0.8}
          metalness={0.1}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* White screen surface (slightly in front of frame) */}
      <mesh position={[0, screenCenterY, PANEL_THICKNESS / 2 + 0.001]}>
        <planeGeometry args={[screenW, screenH]} />
        <meshStandardMaterial
          color={screenColor}
          roughness={0.3}
          metalness={0}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Left front leg */}
      <mesh
        position={[-frameW / 2 + LEG_DIAMETER, legHeight / 2, legHalfSplay / 2]}
        rotation={[Math.atan2(legHalfSplay / 2, legHeight), 0, 0]}
      >
        <cylinderGeometry args={[LEG_DIAMETER / 2, LEG_DIAMETER / 2, Math.sqrt(legHeight * legHeight + (legHalfSplay / 2) ** 2), 6]} />
        <meshStandardMaterial
          color={legColor}
          roughness={0.4}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Left rear leg */}
      <mesh
        position={[-frameW / 2 + LEG_DIAMETER, legHeight / 2, -legHalfSplay / 2]}
        rotation={[-Math.atan2(legHalfSplay / 2, legHeight), 0, 0]}
      >
        <cylinderGeometry args={[LEG_DIAMETER / 2, LEG_DIAMETER / 2, Math.sqrt(legHeight * legHeight + (legHalfSplay / 2) ** 2), 6]} />
        <meshStandardMaterial
          color={legColor}
          roughness={0.4}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Right front leg */}
      <mesh
        position={[frameW / 2 - LEG_DIAMETER, legHeight / 2, legHalfSplay / 2]}
        rotation={[Math.atan2(legHalfSplay / 2, legHeight), 0, 0]}
      >
        <cylinderGeometry args={[LEG_DIAMETER / 2, LEG_DIAMETER / 2, Math.sqrt(legHeight * legHeight + (legHalfSplay / 2) ** 2), 6]} />
        <meshStandardMaterial
          color={legColor}
          roughness={0.4}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Right rear leg */}
      <mesh
        position={[frameW / 2 - LEG_DIAMETER, legHeight / 2, -legHalfSplay / 2]}
        rotation={[-Math.atan2(legHalfSplay / 2, legHeight), 0, 0]}
      >
        <cylinderGeometry args={[LEG_DIAMETER / 2, LEG_DIAMETER / 2, Math.sqrt(legHeight * legHeight + (legHalfSplay / 2) ** 2), 6]} />
        <meshStandardMaterial
          color={legColor}
          roughness={0.4}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Left crossbar */}
      <mesh position={[-frameW / 2 + LEG_DIAMETER, crossbarY, 0]}>
        <cylinderGeometry args={[LEG_DIAMETER / 3, LEG_DIAMETER / 3, renderDepth * 0.8, 6]} />
        <meshStandardMaterial
          color={legColor}
          roughness={0.4}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Right crossbar */}
      <mesh position={[frameW / 2 - LEG_DIAMETER, crossbarY, 0]}>
        <cylinderGeometry args={[LEG_DIAMETER / 3, LEG_DIAMETER / 3, renderDepth * 0.8, 6]} />
        <meshStandardMaterial
          color={legColor}
          roughness={0.4}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>
    </group>
  );
}

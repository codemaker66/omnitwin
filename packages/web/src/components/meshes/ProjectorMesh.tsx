import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// ProjectorMesh — flat low-profile laser projector (UST style)
// ---------------------------------------------------------------------------

interface ProjectorMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

/** Lens bump dimensions relative to main body. */
const LENS_WIDTH_RATIO = 0.6;
const LENS_HEIGHT = 0.015;
const LENS_DEPTH = 0.03;

/** Vent circle on the right side. */
const VENT_RADIUS = 0.025;

/** Feet inset from edges. */
const FOOT_SIZE = 0.015;
const FOOT_HEIGHT = 0.008;

export function ProjectorMesh({
  item,
  opacity = 1,
  colorOverride,
}: ProjectorMeshProps): React.ReactElement {
  const renderWidth = useMemo(() => toRenderSpace(item.width), [item.width]);
  const renderDepth = useMemo(() => toRenderSpace(item.depth), [item.depth]);
  const height = item.height;
  const isTransparent = opacity < 1;

  const bodyColor = colorOverride ?? "#3a3a40";
  const accentColor = colorOverride ?? "#2a2a2e";
  const ventColor = colorOverride ?? "#555560";
  const lensColor = colorOverride ?? "#1a1a1e";
  const footColor = colorOverride ?? "#222225";

  const footInset = 0.03;

  return (
    <group>
      {/* Main body — slightly rounded look via a box */}
      <mesh position={[0, FOOT_HEIGHT + height / 2, 0]}>
        <boxGeometry args={[renderWidth, height, renderDepth]} />
        <meshStandardMaterial
          color={bodyColor}
          roughness={0.6}
          metalness={0.3}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Top panel — slightly darker accent strip */}
      <mesh position={[0, FOOT_HEIGHT + height + 0.001, 0]}>
        <boxGeometry args={[renderWidth - 0.01, 0.003, renderDepth - 0.01]} />
        <meshStandardMaterial
          color={accentColor}
          roughness={0.5}
          metalness={0.4}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Lens bump — front center, slightly protruding */}
      <mesh position={[0, FOOT_HEIGHT + height * 0.7, renderDepth / 2 + LENS_DEPTH / 2]}>
        <boxGeometry args={[renderWidth * LENS_WIDTH_RATIO, LENS_HEIGHT, LENS_DEPTH]} />
        <meshStandardMaterial
          color={lensColor}
          roughness={0.2}
          metalness={0.6}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Lens glass strip — glossy front face */}
      <mesh position={[0, FOOT_HEIGHT + height * 0.7, renderDepth / 2 + LENS_DEPTH + 0.001]}>
        <planeGeometry args={[renderWidth * LENS_WIDTH_RATIO - 0.01, LENS_HEIGHT * 0.6]} />
        <meshStandardMaterial
          color="#0a0a12"
          roughness={0.05}
          metalness={0.8}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Circular vent on right side */}
      <mesh
        position={[renderWidth / 2 + 0.001, FOOT_HEIGHT + height * 0.55, 0]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <circleGeometry args={[VENT_RADIUS, 24]} />
        <meshStandardMaterial
          color={ventColor}
          roughness={0.3}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Vent ring (outer) */}
      <mesh
        position={[renderWidth / 2 + 0.002, FOOT_HEIGHT + height * 0.55, 0]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <ringGeometry args={[VENT_RADIUS - 0.004, VENT_RADIUS + 0.002, 24]} />
        <meshStandardMaterial
          color={accentColor}
          roughness={0.4}
          metalness={0.5}
          transparent={isTransparent}
          opacity={opacity}
          clippingPlanes={noClipPlanes}
        />
      </mesh>

      {/* Rubber feet — 4 corners */}
      {[
        [-renderWidth / 2 + footInset, 0, -renderDepth / 2 + footInset],
        [-renderWidth / 2 + footInset, 0, renderDepth / 2 - footInset],
        [renderWidth / 2 - footInset, 0, -renderDepth / 2 + footInset],
        [renderWidth / 2 - footInset, 0, renderDepth / 2 - footInset],
      ].map((pos, i) => (
        <mesh key={i} position={[pos[0]!, pos[1]! + FOOT_HEIGHT / 2, pos[2]!]}>
          <cylinderGeometry args={[FOOT_SIZE, FOOT_SIZE, FOOT_HEIGHT, 8]} />
          <meshStandardMaterial
            color={footColor}
            roughness={0.9}
            metalness={0}
            transparent={isTransparent}
            opacity={opacity}
            clippingPlanes={noClipPlanes}
          />
        </mesh>
      ))}
    </group>
  );
}

import { useMemo } from "react";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// ChairMesh — seat + backrest + four legs
// ---------------------------------------------------------------------------

interface ChairMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

/** Seat thickness. */
const SEAT_THICKNESS = 0.02;
/** Seat height from ground (real-world metres, ~46cm standard dining chair). */
const SEAT_HEIGHT = 0.46;
/** Backrest thickness. */
const BACK_THICKNESS = 0.02;
/** Leg square cross-section. */
const LEG_SIZE = 0.02;
/** Seat pad is inset from the footprint edge by this fraction per side. */
const SEAT_INSET_FRAC = 0.12;

export function ChairMesh({
  item,
  opacity = 1,
  colorOverride,
}: ChairMeshProps): React.ReactElement {
  const renderWidth = useMemo(() => toRenderSpace(item.width), [item.width]);
  const renderDepth = useMemo(() => toRenderSpace(item.depth), [item.depth]);
  const totalHeight = item.height;
  const color = colorOverride ?? item.color;
  const isTransparent = opacity < 1;

  // Seat dimensions — inset from footprint for a slimmer look
  const seatW = renderWidth * (1 - SEAT_INSET_FRAC * 2);
  const seatD = renderDepth * (1 - SEAT_INSET_FRAC * 2);

  const legHeight = SEAT_HEIGHT - SEAT_THICKNESS;
  const backHeight = totalHeight - SEAT_HEIGHT;

  // Legs positioned at seat corners
  const legHalfW = seatW / 2 - LEG_SIZE / 2;
  const legHalfD = seatD / 2 - LEG_SIZE / 2;

  const mat = (
    <meshStandardMaterial
      color={color}
      roughness={0.85}
      metalness={0}
      transparent={isTransparent}
      opacity={opacity}
      clippingPlanes={noClipPlanes}
    />
  );

  return (
    <group>
      {/* Seat pad */}
      <mesh position={[0, SEAT_HEIGHT - SEAT_THICKNESS / 2, 0]}>
        <boxGeometry args={[seatW, SEAT_THICKNESS, seatD]} />
        {mat}
      </mesh>

      {/* Backrest — at the back edge (+Z direction is back of chair) */}
      <mesh position={[0, SEAT_HEIGHT + backHeight / 2, seatD / 2 - BACK_THICKNESS / 2]}>
        <boxGeometry args={[seatW, backHeight, BACK_THICKNESS]} />
        {mat}
      </mesh>

      {/* Four legs */}
      {[
        [-legHalfW, -legHalfD],
        [legHalfW, -legHalfD],
        [-legHalfW, legHalfD],
        [legHalfW, legHalfD],
      ].map(([lx, lz], i) => (
        <mesh key={i} position={[lx ?? 0, legHeight / 2, lz ?? 0]}>
          <boxGeometry args={[LEG_SIZE, legHeight, LEG_SIZE]} />
          {mat}
        </mesh>
      ))}
    </group>
  );
}

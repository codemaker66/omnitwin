import { useMemo } from "react";
import { DoubleSide, Path, Shape } from "three";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// ChairMesh — Trades Hall banquet chair placeholder
// ---------------------------------------------------------------------------

interface ChairMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

export const TRADES_HALL_CHAIR_COLORS = {
  upholstery: "#8f141b",
  cushionShadow: "#3a1211",
  backPanel: "#17110e",
  edge: "#b72a2f",
  frame: "#17110e",
} as const;

export interface BanquetChairVisualSpec {
  readonly renderWidth: number;
  readonly renderDepth: number;
  readonly seatWidth: number;
  readonly seatDepth: number;
  readonly seatHeight: number;
  readonly seatThickness: number;
  readonly cushionRadius: number;
  readonly legHeight: number;
  readonly legX: number;
  readonly frontLegZ: number;
  readonly rearLegZ: number;
  readonly backOuterWidth: number;
  readonly backOuterHeight: number;
  readonly backInnerWidth: number;
  readonly backInnerHeight: number;
  readonly backCenterY: number;
  readonly backZ: number;
  readonly frameRadius: number;
  readonly upholsteryColor: string;
  readonly cushionShadowColor: string;
  readonly backPanelColor: string;
  readonly edgeColor: string;
  readonly frameColor: string;
}

/** Seat height from ground (real-world metres, standard banquet/dining chair). */
const SEAT_HEIGHT = 0.46;
const SEAT_THICKNESS = 0.065;
const SEAT_INSET_FRAC = 0.13;
const CUSHION_RADIUS = 0.028;
const FRAME_RADIUS = 0.014;

export function computeBanquetChairVisualSpec(
  item: CatalogueItem,
  colorOverride?: string,
): BanquetChairVisualSpec {
  const renderWidth = toRenderSpace(item.width);
  const renderDepth = toRenderSpace(item.depth);
  const seatWidth = renderWidth * (1 - SEAT_INSET_FRAC * 2);
  const seatDepth = renderDepth * (1 - SEAT_INSET_FRAC * 2);
  const legHeight = SEAT_HEIGHT - SEAT_THICKNESS * 0.7;
  const backOuterWidth = seatWidth * 0.92;
  const backOuterHeight = Math.max(0.34, item.height - SEAT_HEIGHT - 0.02);
  const backInnerWidth = backOuterWidth * 0.78;
  const backInnerHeight = backOuterHeight * 0.76;
  const legX = seatWidth * 0.38;
  const frontLegZ = -seatDepth * 0.40;
  const rearLegZ = seatDepth * 0.40;

  return {
    renderWidth,
    renderDepth,
    seatWidth,
    seatDepth,
    seatHeight: SEAT_HEIGHT,
    seatThickness: SEAT_THICKNESS,
    cushionRadius: CUSHION_RADIUS,
    legHeight,
    legX,
    frontLegZ,
    rearLegZ,
    backOuterWidth,
    backOuterHeight,
    backInnerWidth,
    backInnerHeight,
    backCenterY: SEAT_HEIGHT + backOuterHeight * 0.46,
    backZ: seatDepth * 0.47,
    frameRadius: FRAME_RADIUS,
    upholsteryColor: colorOverride ?? TRADES_HALL_CHAIR_COLORS.upholstery,
    cushionShadowColor: colorOverride ?? TRADES_HALL_CHAIR_COLORS.cushionShadow,
    backPanelColor: colorOverride ?? TRADES_HALL_CHAIR_COLORS.backPanel,
    edgeColor: colorOverride ?? TRADES_HALL_CHAIR_COLORS.edge,
    frameColor: colorOverride ?? TRADES_HALL_CHAIR_COLORS.frame,
  };
}

function drawRoundedBackPath(
  path: Shape | Path,
  width: number,
  height: number,
  yOffset = 0,
  reverse = false,
): void {
  const halfW = width / 2;
  const halfH = height / 2;
  const bottomY = -halfH + yOffset;
  const shoulderY = halfH - height * 0.26 + yOffset;
  const topY = halfH + yOffset;

  if (reverse) {
    path.moveTo(-halfW, bottomY);
    path.lineTo(halfW, bottomY);
    path.lineTo(halfW, shoulderY);
    path.quadraticCurveTo(halfW, topY, 0, topY);
    path.quadraticCurveTo(-halfW, topY, -halfW, shoulderY);
    path.closePath();
    return;
  }

  path.moveTo(-halfW, bottomY);
  path.lineTo(-halfW, shoulderY);
  path.quadraticCurveTo(-halfW, topY, 0, topY);
  path.quadraticCurveTo(halfW, topY, halfW, shoulderY);
  path.lineTo(halfW, bottomY);
  path.closePath();
}

export function createBanquetChairBackShape(width: number, height: number): Shape {
  const shape = new Shape();
  drawRoundedBackPath(shape, width, height);

  return shape;
}

export function createBanquetChairBackRimShape(
  outerWidth: number,
  outerHeight: number,
  innerWidth: number,
  innerHeight: number,
  innerYOffset: number,
): Shape {
  const shape = createBanquetChairBackShape(outerWidth, outerHeight);
  const hole = new Path();
  drawRoundedBackPath(hole, innerWidth, innerHeight, innerYOffset, true);
  shape.holes.push(hole);

  return shape;
}

interface TubeProps {
  readonly axis: "x" | "y" | "z";
  readonly length: number;
  readonly radius: number;
  readonly position: readonly [number, number, number];
  readonly color: string;
  readonly opacity: number;
}

function tubeRotation(axis: TubeProps["axis"]): [number, number, number] {
  switch (axis) {
    case "x":
      return [0, 0, Math.PI / 2];
    case "z":
      return [Math.PI / 2, 0, 0];
    case "y":
      return [0, 0, 0];
  }
}

function FrameTube({
  axis,
  length,
  radius,
  position,
  color,
  opacity,
}: TubeProps): React.ReactElement {
  const isTransparent = opacity < 1;

  return (
    <mesh position={[position[0], position[1], position[2]]} rotation={tubeRotation(axis)}>
      <cylinderGeometry args={[radius, radius, length, 10]} />
      <meshStandardMaterial
        color={color}
        roughness={0.55}
        metalness={0.6}
        transparent={isTransparent}
        opacity={opacity}
        clippingPlanes={noClipPlanes}
      />
    </mesh>
  );
}

export function ChairMesh({
  item,
  opacity = 1,
  colorOverride,
}: ChairMeshProps): React.ReactElement {
  const spec = useMemo(
    () => computeBanquetChairVisualSpec(item, colorOverride),
    [item, colorOverride],
  );
  const innerYOffset = -spec.backOuterHeight * 0.035;
  const backOuterShape = useMemo(
    () => createBanquetChairBackRimShape(
      spec.backOuterWidth,
      spec.backOuterHeight,
      spec.backInnerWidth,
      spec.backInnerHeight,
      innerYOffset,
    ),
    [
      innerYOffset,
      spec.backInnerHeight,
      spec.backInnerWidth,
      spec.backOuterHeight,
      spec.backOuterWidth,
    ],
  );
  const backInnerShape = useMemo(
    () => createBanquetChairBackShape(spec.backInnerWidth, spec.backInnerHeight),
    [spec.backInnerHeight, spec.backInnerWidth],
  );
  const isTransparent = opacity < 1;

  const upholsteryMaterial = (
    <meshStandardMaterial
      color={spec.upholsteryColor}
      roughness={0.62}
      metalness={0}
      transparent={isTransparent}
      opacity={opacity}
      clippingPlanes={noClipPlanes}
    />
  );
  const cushionShadowMaterial = (
    <meshStandardMaterial
      color={spec.cushionShadowColor}
      roughness={0.7}
      metalness={0}
      transparent={isTransparent}
      opacity={opacity}
      clippingPlanes={noClipPlanes}
    />
  );
  const backPanelMaterial = (
    <meshStandardMaterial
      color={spec.backPanelColor}
      roughness={0.72}
      metalness={0}
      side={DoubleSide}
      transparent={isTransparent}
      opacity={opacity}
      clippingPlanes={noClipPlanes}
    />
  );
  const edgeMaterial = (
    <meshStandardMaterial
      color={spec.edgeColor}
      roughness={0.56}
      metalness={0}
      side={DoubleSide}
      transparent={isTransparent}
      opacity={opacity}
      clippingPlanes={noClipPlanes}
    />
  );

  const legs: readonly (readonly [number, number])[] = [
    [-spec.legX, spec.frontLegZ],
    [spec.legX, spec.frontLegZ],
    [-spec.legX, spec.rearLegZ],
    [spec.legX, spec.rearLegZ],
  ];

  const sideRailY = spec.legHeight * 0.62;
  const frontRailY = spec.legHeight * 0.74;

  return (
    <group>
      {/* Black metal tube frame: visible, slim, and stackable-chair-like. */}
      {legs.map(([x, z], i) => (
        <FrameTube
          key={i}
          axis="y"
          length={spec.legHeight}
          radius={spec.frameRadius}
          position={[x, spec.legHeight / 2, z]}
          color={spec.frameColor}
          opacity={opacity}
        />
      ))}
      <FrameTube
        axis="x"
        length={spec.legX * 2}
        radius={spec.frameRadius * 0.9}
        position={[0, frontRailY, spec.frontLegZ]}
        color={spec.frameColor}
        opacity={opacity}
      />
      {[-spec.legX, spec.legX].map((x, i) => (
        <FrameTube
          key={i}
          axis="z"
          length={spec.rearLegZ - spec.frontLegZ}
          radius={spec.frameRadius * 0.85}
          position={[x, sideRailY, (spec.frontLegZ + spec.rearLegZ) / 2]}
          color={spec.frameColor}
          opacity={opacity}
        />
      ))}
      {[-spec.legX, spec.legX].map((x, i) => (
        <FrameTube
          key={i}
          axis="y"
          length={item.height * 0.92}
          radius={spec.frameRadius * 1.05}
          position={[x, item.height * 0.46, spec.backZ - spec.frameRadius]}
          color={spec.frameColor}
          opacity={opacity}
        />
      ))}

      {/* Red padded seat with a darker underside, closer to the venue chair photo. */}
      <mesh position={[0, spec.seatHeight - spec.seatThickness / 2, 0]}>
        <boxGeometry args={[spec.seatWidth, spec.seatThickness, spec.seatDepth]} />
        {upholsteryMaterial}
      </mesh>
      <mesh position={[0, spec.seatHeight - spec.seatThickness - 0.012, 0]}>
        <boxGeometry args={[spec.seatWidth * 0.92, 0.024, spec.seatDepth * 0.88]} />
        {cushionShadowMaterial}
      </mesh>
      <FrameTube
        axis="x"
        length={spec.seatWidth * 0.9}
        radius={spec.cushionRadius}
        position={[0, spec.seatHeight - spec.seatThickness * 0.18, -spec.seatDepth / 2]}
        color={spec.upholsteryColor}
        opacity={opacity}
      />

      {/* Rounded dark back insert with red edging/piping. */}
      <mesh position={[0, spec.backCenterY, spec.backZ]}>
        <shapeGeometry args={[backOuterShape, 18]} />
        {edgeMaterial}
      </mesh>
      <mesh position={[0, spec.backCenterY - spec.backOuterHeight * 0.035, spec.backZ + 0.006]}>
        <shapeGeometry args={[backInnerShape, 18]} />
        {backPanelMaterial}
      </mesh>
      <FrameTube
        axis="x"
        length={spec.backOuterWidth * 0.72}
        radius={spec.frameRadius * 0.95}
        position={[0, spec.backCenterY - spec.backOuterHeight * 0.52, spec.backZ - spec.frameRadius]}
        color={spec.frameColor}
        opacity={opacity}
      />
    </group>
  );
}

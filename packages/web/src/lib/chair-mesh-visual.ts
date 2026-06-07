import { Path, Shape } from "three";
import { toRenderSpace } from "../constants/scale.js";
import type { CatalogueItem } from "./catalogue.js";

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

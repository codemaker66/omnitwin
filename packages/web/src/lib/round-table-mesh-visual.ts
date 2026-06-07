import { Quaternion, Vector3 } from "three";
import { toRenderSpace } from "../constants/scale.js";
import type { CatalogueItem } from "./catalogue.js";

export const FOLDING_ROUND_TABLE_COLORS = {
  top: "#f6f6f1",
  topHighlight: "#ffffff",
  rim: "#d4d5d0",
  underside: "#bfc0bb",
  frame: "#252923",
  rubberFoot: "#111310",
} as const;

export interface SegmentSpec {
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
}

export interface CylinderSegmentTransform {
  readonly position: readonly [number, number, number];
  readonly length: number;
  readonly quaternion: Quaternion;
}

export interface FoldingRoundTableVisualSpec {
  readonly radius: number;
  readonly height: number;
  readonly topThickness: number;
  readonly topSurfaceY: number;
  readonly rimY: number;
  readonly undersideY: number;
  readonly undersideRadius: number;
  readonly rimBeadRadius: number;
  readonly frameRingRadius: number;
  readonly frameRingY: number;
  readonly legRadius: number;
  readonly braceRadius: number;
  readonly footRadius: number;
  readonly footHeight: number;
  readonly legSegments: readonly SegmentSpec[];
  readonly braceSegments: readonly SegmentSpec[];
  readonly supportSegments: readonly SegmentSpec[];
  readonly hingePoints: readonly (readonly [number, number, number])[];
  readonly topColor: string;
  readonly topHighlightColor: string;
  readonly rimColor: string;
  readonly undersideColor: string;
  readonly frameColor: string;
  readonly rubberFootColor: string;
}

const TOP_THICKNESS = 0.096;
export const TOP_HIGHLIGHT_THICKNESS = 0.012;
export const UNDERSIDE_THICKNESS = 0.035;
const FRAME_RING_FRAC = 0.68;
const UNDERSIDE_FRAC = 0.58;
const LEG_TOP_FRAC = 0.86;
const LEG_FOOT_FRAC = 1.03;
const BRACE_ATTACH_FRAC = 0.84;
const BRACE_HUB_FRAC = 0.24;
const LEG_RADIUS = 0.052;
const BRACE_RADIUS = 0.03;
const FOOT_RADIUS = 0.078;
const FOOT_HEIGHT = 0.06;
export const HINGE_RADIUS = 0.055;
const LEG_ANGLES = [
  Math.PI / 4,
  (Math.PI * 3) / 4,
  (Math.PI * 5) / 4,
  (Math.PI * 7) / 4,
] as const;

const yAxis = new Vector3(0, 1, 0);

export function computeCylinderSegmentTransform(
  segment: SegmentSpec,
): CylinderSegmentTransform {
  const start = new Vector3(...segment.start);
  const end = new Vector3(...segment.end);
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const quaternion = new Quaternion();

  if (length > 0) {
    quaternion.setFromUnitVectors(yAxis, direction.normalize());
  }

  return {
    position: [midpoint.x, midpoint.y, midpoint.z],
    length,
    quaternion,
  };
}

export function computeFoldingRoundTableVisualSpec(
  item: CatalogueItem,
  colorOverride?: string,
): FoldingRoundTableVisualSpec {
  const radius = toRenderSpace(item.width) / 2;
  const undersideY = item.height - TOP_THICKNESS - UNDERSIDE_THICKNESS / 2;
  const frameRingY = item.height - TOP_THICKNESS - 0.06;
  const legTopY = item.height - TOP_THICKNESS - 0.035;
  const footY = FOOT_HEIGHT;
  const braceHubY = item.height * 0.40;
  const braceHubRadius = radius * BRACE_HUB_FRAC;
  const legSegments: SegmentSpec[] = [];
  const braceSegments: SegmentSpec[] = [];
  const supportSegments: SegmentSpec[] = [
    {
      start: [0, legTopY - 0.015, 0],
      end: [0, footY + FOOT_HEIGHT, 0],
    },
  ];
  const hingePoints: (readonly [number, number, number])[] = [];

  for (const angle of LEG_ANGLES) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const top: readonly [number, number, number] = [
      cos * radius * LEG_TOP_FRAC,
      legTopY,
      sin * radius * LEG_TOP_FRAC,
    ];
    const foot: readonly [number, number, number] = [
      cos * radius * LEG_FOOT_FRAC,
      footY,
      sin * radius * LEG_FOOT_FRAC,
    ];
    const braceAttach: readonly [number, number, number] = [
      cos * radius * BRACE_ATTACH_FRAC,
      item.height * 0.61,
      sin * radius * BRACE_ATTACH_FRAC,
    ];
    const leftHub: readonly [number, number, number] = [
      Math.cos(angle - 0.55) * braceHubRadius,
      braceHubY,
      Math.sin(angle - 0.55) * braceHubRadius,
    ];
    const rightHub: readonly [number, number, number] = [
      Math.cos(angle + 0.55) * braceHubRadius,
      braceHubY,
      Math.sin(angle + 0.55) * braceHubRadius,
    ];

    legSegments.push({ start: top, end: foot });
    braceSegments.push({ start: leftHub, end: braceAttach });
    braceSegments.push({ start: rightHub, end: braceAttach });
    hingePoints.push(braceAttach, leftHub, rightHub);
  }

  return {
    radius,
    height: item.height,
    topThickness: TOP_THICKNESS,
    topSurfaceY: item.height - TOP_HIGHLIGHT_THICKNESS / 2 + 0.002,
    rimY: item.height - TOP_THICKNESS / 2,
    undersideY,
    undersideRadius: radius * UNDERSIDE_FRAC,
    rimBeadRadius: TOP_THICKNESS * 0.28,
    frameRingRadius: radius * FRAME_RING_FRAC,
    frameRingY,
    legRadius: LEG_RADIUS,
    braceRadius: BRACE_RADIUS,
    footRadius: FOOT_RADIUS,
    footHeight: FOOT_HEIGHT,
    legSegments,
    braceSegments,
    supportSegments,
    hingePoints,
    topColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.top,
    topHighlightColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.topHighlight,
    rimColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.rim,
    undersideColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.underside,
    frameColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.frame,
    rubberFootColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.rubberFoot,
  };
}

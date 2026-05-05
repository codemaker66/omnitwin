import { useMemo } from "react";
import { Quaternion, Vector3 } from "three";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// RoundTableMesh — folding plastic 6ft round table placeholder
// ---------------------------------------------------------------------------

interface RoundTableMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

export const FOLDING_ROUND_TABLE_COLORS = {
  top: "#f0f0ec",
  topHighlight: "#fbfbf8",
  rim: "#dadad4",
  underside: "#c7c7c1",
  frame: "#323732",
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
  readonly frameRingRadius: number;
  readonly frameRingY: number;
  readonly legRadius: number;
  readonly braceRadius: number;
  readonly footRadius: number;
  readonly footHeight: number;
  readonly legSegments: readonly SegmentSpec[];
  readonly braceSegments: readonly SegmentSpec[];
  readonly topColor: string;
  readonly topHighlightColor: string;
  readonly rimColor: string;
  readonly undersideColor: string;
  readonly frameColor: string;
  readonly rubberFootColor: string;
}

const TOP_THICKNESS = 0.08;
const TOP_HIGHLIGHT_THICKNESS = 0.012;
const UNDERSIDE_THICKNESS = 0.024;
const FRAME_RING_FRAC = 0.70;
const LEG_TOP_FRAC = 0.69;
const LEG_FOOT_FRAC = 0.86;
const BRACE_ATTACH_FRAC = 0.47;
const LEG_RADIUS = 0.035;
const BRACE_RADIUS = 0.018;
const FOOT_RADIUS = 0.06;
const FOOT_HEIGHT = 0.05;
const LEG_COUNT = 4;

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
  const braceHubY = item.height * 0.43;
  const braceHubRadius = radius * 0.12;
  const legSegments: SegmentSpec[] = [];
  const braceSegments: SegmentSpec[] = [];

  for (let i = 0; i < LEG_COUNT; i += 1) {
    const angle = (Math.PI * 2 * i) / LEG_COUNT + Math.PI / 4;
    const nextAngle = angle + Math.PI / LEG_COUNT;
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
      item.height * 0.60,
      sin * radius * BRACE_ATTACH_FRAC,
    ];
    const braceHub: readonly [number, number, number] = [
      Math.cos(nextAngle) * braceHubRadius,
      braceHubY,
      Math.sin(nextAngle) * braceHubRadius,
    ];

    legSegments.push({ start: top, end: foot });
    braceSegments.push({ start: braceHub, end: braceAttach });
  }

  return {
    radius,
    height: item.height,
    topThickness: TOP_THICKNESS,
    topSurfaceY: item.height - TOP_HIGHLIGHT_THICKNESS / 2 + 0.002,
    rimY: item.height - TOP_THICKNESS / 2,
    undersideY,
    frameRingRadius: radius * FRAME_RING_FRAC,
    frameRingY,
    legRadius: LEG_RADIUS,
    braceRadius: BRACE_RADIUS,
    footRadius: FOOT_RADIUS,
    footHeight: FOOT_HEIGHT,
    legSegments,
    braceSegments,
    topColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.top,
    topHighlightColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.topHighlight,
    rimColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.rim,
    undersideColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.underside,
    frameColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.frame,
    rubberFootColor: colorOverride ?? FOLDING_ROUND_TABLE_COLORS.rubberFoot,
  };
}

interface TubeProps {
  readonly segment: SegmentSpec;
  readonly radius: number;
  readonly color: string;
  readonly opacity: number;
}

function SegmentTube({
  segment,
  radius,
  color,
  opacity,
}: TubeProps): React.ReactElement {
  const transform = useMemo(() => computeCylinderSegmentTransform(segment), [segment]);
  const isTransparent = opacity < 1;

  return (
    <mesh
      position={[transform.position[0], transform.position[1], transform.position[2]]}
      quaternion={transform.quaternion}
    >
      <cylinderGeometry args={[radius, radius, transform.length, 10]} />
      <meshStandardMaterial
        color={color}
        roughness={0.58}
        metalness={0.45}
        transparent={isTransparent}
        opacity={opacity}
        clippingPlanes={noClipPlanes}
      />
    </mesh>
  );
}

function cylinderMaterial(
  color: string,
  opacity: number,
  roughness: number,
  metalness: number,
): React.ReactElement {
  return (
    <meshStandardMaterial
      color={color}
      roughness={roughness}
      metalness={metalness}
      transparent={opacity < 1}
      opacity={opacity}
      clippingPlanes={noClipPlanes}
    />
  );
}

export function RoundTableMesh({
  item,
  opacity = 1,
  colorOverride,
}: RoundTableMeshProps): React.ReactElement {
  const spec = useMemo(
    () => computeFoldingRoundTableVisualSpec(item, colorOverride),
    [item, colorOverride],
  );

  return (
    <group>
      {/* Pale plastic table top, not the old pedestal-table material. */}
      <mesh position={[0, spec.rimY, 0]}>
        <cylinderGeometry args={[spec.radius, spec.radius, spec.topThickness, 96]} />
        {cylinderMaterial(spec.topColor, opacity, 0.48, 0)}
      </mesh>
      <mesh position={[0, spec.topSurfaceY, 0]}>
        <cylinderGeometry args={[spec.radius * 0.985, spec.radius * 0.985, TOP_HIGHLIGHT_THICKNESS, 96]} />
        {cylinderMaterial(spec.topHighlightColor, opacity, 0.36, 0)}
      </mesh>
      <mesh position={[0, spec.rimY - spec.topThickness * 0.2, 0]}>
        <cylinderGeometry args={[spec.radius * 1.005, spec.radius * 1.005, spec.topThickness * 0.82, 96, 1, true]} />
        {cylinderMaterial(spec.rimColor, opacity, 0.55, 0)}
      </mesh>
      <mesh position={[0, spec.undersideY, 0]}>
        <cylinderGeometry args={[spec.radius * 0.78, spec.radius * 0.78, UNDERSIDE_THICKNESS, 48]} />
        {cylinderMaterial(spec.undersideColor, opacity, 0.64, 0)}
      </mesh>

      {/* Dark folding frame: perimeter ring, splayed legs, diagonal braces, rubber feet. */}
      <mesh position={[0, spec.frameRingY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[spec.frameRingRadius, spec.braceRadius * 1.25, 8, 72]} />
        {cylinderMaterial(spec.frameColor, opacity, 0.56, 0.5)}
      </mesh>

      {spec.legSegments.map((segment, index) => (
        <SegmentTube
          key={index}
          segment={segment}
          radius={spec.legRadius}
          color={spec.frameColor}
          opacity={opacity}
        />
      ))}

      {spec.braceSegments.map((segment, index) => (
        <SegmentTube
          key={index}
          segment={segment}
          radius={spec.braceRadius}
          color={spec.frameColor}
          opacity={opacity}
        />
      ))}

      {spec.legSegments.map((segment, index) => (
        <mesh
          key={index}
          position={[segment.end[0], spec.footHeight / 2, segment.end[2]]}
        >
          <cylinderGeometry args={[spec.footRadius, spec.footRadius * 0.82, spec.footHeight, 12]} />
          {cylinderMaterial(spec.rubberFootColor, opacity, 0.72, 0.1)}
        </mesh>
      ))}
    </group>
  );
}

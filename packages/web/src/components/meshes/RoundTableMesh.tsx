import { useMemo } from "react";
import type { CatalogueItem } from "../../lib/catalogue.js";
import {
  HINGE_RADIUS,
  TOP_HIGHLIGHT_THICKNESS,
  UNDERSIDE_THICKNESS,
  computeCylinderSegmentTransform,
  computeFoldingRoundTableVisualSpec,
  type SegmentSpec,
} from "../../lib/round-table-mesh-visual.js";
import { noClipPlanes } from "../SectionPlane.js";
export {
  FOLDING_ROUND_TABLE_COLORS,
  HINGE_RADIUS,
  TOP_HIGHLIGHT_THICKNESS,
  UNDERSIDE_THICKNESS,
  computeCylinderSegmentTransform,
  computeFoldingRoundTableVisualSpec,
} from "../../lib/round-table-mesh-visual.js";
export type {
  CylinderSegmentTransform,
  FoldingRoundTableVisualSpec,
  SegmentSpec,
} from "../../lib/round-table-mesh-visual.js";

// ---------------------------------------------------------------------------
// RoundTableMesh — folding plastic 6ft round table placeholder
// ---------------------------------------------------------------------------

interface RoundTableMeshProps {
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
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
        <cylinderGeometry
          args={[
            spec.radius * 0.985,
            spec.radius * 0.985,
            TOP_HIGHLIGHT_THICKNESS,
            96,
          ]}
        />
        {cylinderMaterial(spec.topHighlightColor, opacity, 0.36, 0)}
      </mesh>
      <mesh position={[0, spec.rimY - spec.topThickness * 0.2, 0]}>
        <cylinderGeometry
          args={[
            spec.radius * 1.005,
            spec.radius * 1.005,
            spec.topThickness * 0.82,
            96,
            1,
            true,
          ]}
        />
        {cylinderMaterial(spec.rimColor, opacity, 0.55, 0)}
      </mesh>
      <mesh
        position={[0, spec.rimY - spec.topThickness * 0.45, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[spec.radius * 0.975, spec.rimBeadRadius, 10, 96]} />
        {cylinderMaterial(spec.rimColor, opacity, 0.52, 0)}
      </mesh>
      <mesh position={[0, spec.undersideY, 0]}>
        <cylinderGeometry args={[spec.undersideRadius, spec.undersideRadius, UNDERSIDE_THICKNESS, 64]} />
        {cylinderMaterial(spec.undersideColor, opacity, 0.64, 0)}
      </mesh>

      {/* Dark folding frame: perimeter ring, splayed legs, diagonal braces, rubber feet. */}
      <mesh position={[0, spec.frameRingY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[spec.frameRingRadius, spec.braceRadius * 1.25, 8, 72]} />
        {cylinderMaterial(spec.frameColor, opacity, 0.56, 0.5)}
      </mesh>

      {spec.legSegments.map((segment, index) => (
        <SegmentTube
          key={`leg-${String(index)}`}
          segment={segment}
          radius={spec.legRadius}
          color={spec.frameColor}
          opacity={opacity}
        />
      ))}

      {spec.braceSegments.map((segment, index) => (
        <SegmentTube
          key={`brace-${String(index)}`}
          segment={segment}
          radius={spec.braceRadius}
          color={spec.frameColor}
          opacity={opacity}
        />
      ))}

      {spec.supportSegments.map((segment, index) => (
        <SegmentTube
          key={`support-${String(index)}`}
          segment={segment}
          radius={spec.braceRadius * 1.2}
          color={spec.frameColor}
          opacity={opacity}
        />
      ))}

      {spec.hingePoints.map((point, index) => (
        <mesh key={`hinge-${String(index)}`} position={[point[0], point[1], point[2]]}>
          <sphereGeometry args={[HINGE_RADIUS, 12, 8]} />
          {cylinderMaterial(spec.frameColor, opacity, 0.52, 0.55)}
        </mesh>
      ))}

      {spec.legSegments.map((segment, index) => (
        <mesh
          key={`foot-${String(index)}`}
          position={[segment.end[0], spec.footHeight / 2, segment.end[2]]}
        >
          <cylinderGeometry
            args={[spec.footRadius, spec.footRadius * 0.82, spec.footHeight, 12]}
          />
          {cylinderMaterial(spec.rubberFootColor, opacity, 0.72, 0.1)}
        </mesh>
      ))}

      <mesh position={[0, spec.footHeight / 2, 0]}>
        <cylinderGeometry
          args={[
            spec.footRadius * 0.72,
            spec.footRadius * 0.58,
            spec.footHeight,
            12,
          ]}
        />
        {cylinderMaterial(spec.rubberFootColor, opacity, 0.72, 0.1)}
      </mesh>
    </group>
  );
}

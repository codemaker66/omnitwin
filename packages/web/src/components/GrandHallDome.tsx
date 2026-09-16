import { useMemo } from "react";
import { BackSide, DoubleSide, type Plane, type Texture } from "three";
import { SurfaceVisibilityGroup } from "./SurfaceVisibilityGroup.js";

export const DOME_RISE_RATIO = 0.46;
export const DOME_RADIAL_RIB_COUNT = 18;
const DOME_LATITUDE_RING_COUNT = 3;

interface GrandHallDomeProps {
  readonly radius: number;
  readonly ceilingHeight: number;
  readonly color: string;
  readonly texture?: Texture | null;
  readonly clippingPlanes: Plane[];
}

export function domeRiseForRadius(radius: number): number {
  return radius * DOME_RISE_RATIO;
}

export function GrandHallDome({
  radius,
  ceilingHeight,
  color,
  texture = null,
  clippingPlanes,
}: GrandHallDomeProps): React.ReactElement {
  const rise = domeRiseForRadius(radius);
  const shellScaleY = rise / radius;
  const ribAngles = useMemo(
    () => Array.from({ length: DOME_RADIAL_RIB_COUNT }, (_, i) => (i / DOME_RADIAL_RIB_COUNT) * Math.PI * 2),
    [],
  );
  const ringRadii = useMemo(
    () => Array.from({ length: DOME_LATITUDE_RING_COUNT }, (_, i) => radius * (0.34 + i * 0.19)),
    [radius],
  );

  return (
    <SurfaceVisibilityGroup surfaceKey="dome" name="grand-hall-dome">
      <mesh name="dome" position={[0, ceilingHeight + 0.005, 0]} scale={[1, shellScaleY, 1]}>
        <sphereGeometry args={[radius, 96, 36, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={color}
          map={texture}
          side={BackSide}
          roughness={0.84}
          metalness={0.05}
          transparent
          clippingPlanes={clippingPlanes}
        />
      </mesh>

      <mesh name="dome-heavy-rim" position={[0, ceilingHeight + 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.095, 14, 96]} />
        <meshStandardMaterial color="#8b5a22" roughness={0.5} metalness={0.22} side={DoubleSide} clippingPlanes={clippingPlanes} />
      </mesh>

      {ringRadii.map((ringRadius, i) => {
        const y = ceilingHeight + rise * (1 - (ringRadius / radius) * (ringRadius / radius)) + 0.024;
        return (
          <mesh
            key={`dome-latitude-ring-${String(i)}`}
            name="dome-latitude-ring"
            position={[0, y, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <torusGeometry args={[ringRadius, 0.024, 8, 72]} />
            <meshStandardMaterial color="#b98532" roughness={0.45} metalness={0.28} side={DoubleSide} clippingPlanes={clippingPlanes} />
          </mesh>
        );
      })}

      {ribAngles.map((angle, i) => (
        <mesh
          key={`dome-radial-rib-${String(i)}`}
          name="dome-radial-rib"
          position={[
            Math.cos(angle) * radius * 0.5,
            ceilingHeight + rise * 0.42,
            Math.sin(angle) * radius * 0.5,
          ]}
          rotation={[0, -angle, 0]}
        >
          <boxGeometry args={[radius, 0.045, 0.055]} />
          <meshStandardMaterial color="#9b6326" roughness={0.52} metalness={0.2} clippingPlanes={clippingPlanes} />
        </mesh>
      ))}

      <mesh name="dome-central-oculus" position={[0, ceilingHeight + rise + 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.56, 0.48, 0.08, 48]} />
        <meshStandardMaterial color="#4f2d14" roughness={0.58} metalness={0.18} clippingPlanes={clippingPlanes} />
      </mesh>
    </SurfaceVisibilityGroup>
  );
}

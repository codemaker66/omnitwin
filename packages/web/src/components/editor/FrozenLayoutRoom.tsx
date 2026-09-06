import { useEffect, useMemo, type ReactElement } from "react";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Shape } from "three";
import { toRenderSpace } from "../../constants/scale.js";
import type { FrozenLayoutRoomModel } from "../../lib/frozen-layout-room.js";

/** Shape coordinates become X/Z after the floor's -90 degree rotation. */
export function frozenRoomFloorShape(room: FrozenLayoutRoomModel): Shape {
  const shape = new Shape();
  room.geometry.wallPolygon.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(toRenderSpace(x), -toRenderSpace(z));
    else shape.lineTo(toRenderSpace(x), -toRenderSpace(z));
  });
  shape.closePath();
  return shape;
}

export function frozenRoomBoundaryPositions(room: FrozenLayoutRoomModel): number[] {
  const positions: number[] = [];
  const polygon = room.geometry.wallPolygon;
  const height = room.geometry.ceilingHeight;
  polygon.forEach(([x, z], index) => {
    const next = polygon[(index + 1) % polygon.length];
    if (next === undefined) return;
    const ax = toRenderSpace(x), az = toRenderSpace(z);
    const bx = toRenderSpace(next[0]), bz = toRenderSpace(next[1]);
    positions.push(ax, 0.008, az, bx, 0.008, bz);
    positions.push(ax, height, az, bx, height, bz);
    positions.push(ax, 0.008, az, ax, height, az);
  });
  return positions;
}

/** Immutable planning geometry, without current capture, ornament or wall state. */
export function FrozenLayoutRoom({ room }: { readonly room: FrozenLayoutRoomModel }): ReactElement {
  const floor = useMemo(() => frozenRoomFloorShape(room), [room]);
  const boundary = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(frozenRoomBoundaryPositions(room), 3));
    return geometry;
  }, [room]);
  useEffect(() => () => { boundary.dispose(); }, [boundary]);

  return (
    <group name="frozen-layout-room" userData={{ envelopeKey: room.envelopeKey }}>
      <mesh name="frozen-layout-floor" rotation={[-Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[floor]} />
        <meshStandardMaterial color="#d7cbb7" roughness={0.9} metalness={0} side={DoubleSide} />
      </mesh>
      <lineSegments name="frozen-layout-boundary" geometry={boundary}>
        <lineBasicMaterial color="#8b7148" transparent opacity={0.45} />
      </lineSegments>
    </group>
  );
}

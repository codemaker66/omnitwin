import { useMemo, type ReactElement } from "react";
import { DoubleSide } from "three";
import type { SpaceDimensions } from "@omnitwin/types";
import type { RoomGeometry } from "../../data/room-geometries.js";
import { PLANNER_INTERACTION_FLOOR_NAME, plannerInteractionFloorShape } from "../../lib/planner-interaction-floor.js";

export function PlannerInteractionFloor({ geometry, dimensions }: {
  readonly geometry: RoomGeometry | null;
  readonly dimensions: SpaceDimensions;
}): ReactElement {
  const shape = useMemo(() => plannerInteractionFloorShape(geometry, dimensions), [geometry, dimensions]);
  return (
    // Direct Three.js raycasts still intersect this hidden planning surface.
    // It adds no visible floor, depth occlusion, lighting or capture claim.
    <mesh name={PLANNER_INTERACTION_FLOOR_NAME} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial colorWrite={false} depthWrite={false} side={DoubleSide} />
    </mesh>
  );
}

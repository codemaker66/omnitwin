import { Shape, type Object3D } from "three";
import type { SpaceDimensions } from "@omnitwin/types";
import type { RoomGeometry } from "../data/room-geometries.js";
import { toRenderSpace } from "../constants/scale.js";

export const PLANNER_INTERACTION_FLOOR_NAME = "planner-interaction-floor";

/** The existing planning outline, independent of visible room representation. */
export function plannerInteractionFloorShape(geometry: RoomGeometry | null, dimensions: SpaceDimensions): Shape {
  const polygon = geometry === null
    ? [[-dimensions.width / 2, -dimensions.length / 2], [dimensions.width / 2, -dimensions.length / 2],
      [dimensions.width / 2, dimensions.length / 2], [-dimensions.width / 2, dimensions.length / 2]]
    : geometry.wallPolygon.map(([x, z]) => [toRenderSpace(x), toRenderSpace(z)]);
  const shape = new Shape();
  polygon.forEach((point, index) => {
    const x = point[0], z = point[1];
    if (x === undefined || z === undefined) return;
    // Rotating the XY shape by -90 degrees maps its Y to -Z.
    if (index === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  return shape;
}

export function findPlacementFloor(scene: Object3D): Object3D | null {
  return scene.getObjectByName(PLANNER_INTERACTION_FLOOR_NAME) ?? scene.getObjectByName("floor") ?? null;
}

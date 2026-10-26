import { Shape, Vector2, type Camera, type Object3D, type Raycaster } from "three";
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

/** The interaction surface last found in each scene. */
const interactionFloors = new WeakMap<Object3D, Object3D>();

function isIn(object: Object3D, scene: Object3D): boolean {
  let node: Object3D | null = object;
  while (node !== null && node !== scene) node = node.parent;
  return node === scene;
}

/**
 * The surface placement raycasts against: the interaction floor, else a room
 * shell's own floor. The ghost asks on every pointer move, so the interaction
 * floor is found by name once and reused while it stays in the scene (a walk
 * of the hall's ~810 nodes cost 1 ms a move on a slowed phone). A shell's
 * floor is looked up afresh, since an interaction floor may yet replace it.
 */
export function findPlacementFloor(scene: Object3D): Object3D | null {
  const known = interactionFloors.get(scene);
  if (known !== undefined && known.name === PLANNER_INTERACTION_FLOOR_NAME && isIn(known, scene)) return known;
  const found = scene.getObjectByName(PLANNER_INTERACTION_FLOOR_NAME);
  if (found !== undefined) {
    interactionFloors.set(scene, found);
    return found;
  }
  interactionFloors.delete(scene);
  return scene.getObjectByName("floor") ?? null;
}

const _ndc = new Vector2();

/**
 * The point on the placement surface under a screen point (client px) on a
 * canvas at `rect`, or null off the room: where a piece set down there stands.
 */
export function placementFloorPoint(
  scene: Object3D, camera: Camera, raycaster: Raycaster,
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  clientX: number, clientY: number,
): { readonly x: number; readonly z: number } | null {
  const floor = findPlacementFloor(scene);
  if (floor === null || rect.width <= 0 || rect.height <= 0) return null;
  _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  const hit = raycaster.intersectObject(floor, false)[0];
  return hit === undefined ? null : { x: hit.point.x, z: hit.point.z };
}

/** How far down the view each try looks: a view along the floor (Walk, a low orbit) finds it lower than the middle. */
const VIEW_MIDDLE_TRIES = [0.5, 0.65, 0.8, 0.95] as const;

/**
 * The middle of the visible floor (card-dock spec §7.1), where a piece armed
 * with no pointer on the room shows its ghost: the floor point under the
 * canvas's centre or, where the centre looks over the floor, the first one
 * found straight down the view from it. Null with no floor in sight.
 */
export function viewFloorMiddle(
  scene: Object3D, camera: Camera, raycaster: Raycaster,
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
): { readonly x: number; readonly z: number } | null {
  for (const down of VIEW_MIDDLE_TRIES) {
    const hit = placementFloorPoint(scene, camera, raycaster, rect, rect.left + rect.width / 2, rect.top + rect.height * down);
    if (hit !== null) return hit;
  }
  return null;
}

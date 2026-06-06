import type { PlacedItem } from "./placement.js";
import { computeSnapGuides } from "./snap-guide.js";
import type { SnapGuide } from "./snap-guide.js";

export interface FurnitureDragPoint {
  readonly x: number;
  readonly z: number;
}

export interface FurnitureDragFrame {
  readonly targetX: number;
  readonly targetZ: number;
  readonly dx: number;
  readonly dz: number;
  readonly guides: readonly SnapGuide[];
}

/**
 * Computes one active furniture-drag frame.
 *
 * Active dragging is deliberately continuous: the object follows the
 * pointer/grab point exactly and smart alignment stays visual-only. Hard
 * snapping during pointer-move feels like wall/object magnetism and makes
 * tables jump away from the user's hand.
 */
export function computeFluidFurnitureDragFrame(
  primary: PlacedItem,
  floorHit: FurnitureDragPoint,
  grabOffset: FurnitureDragPoint,
  placedItems: readonly PlacedItem[],
  movingIds: ReadonlySet<string>,
): FurnitureDragFrame {
  const targetX = floorHit.x - grabOffset.x;
  const targetZ = floorHit.z - grabOffset.z;
  return {
    targetX,
    targetZ,
    dx: targetX - primary.x,
    dz: targetZ - primary.z,
    guides: computeSnapGuides(
      targetX,
      targetZ,
      primary.catalogueItemId,
      primary.rotationY,
      placedItems,
      movingIds,
    ),
  };
}

import type { Intersection, Object3D, Raycaster } from "three";

// three's Raycaster calls `object.raycast()` on every object it visits and
// does not descend into an object whose `raycast` returns false (see
// Raycaster.js `intersect`). A plain Group's raycast hits nothing and lets the
// raycaster continue into its children.

/** Assign to a group's `raycast` to hide its whole subtree from raycasts. */
export function skipDescendantRaycast(): boolean {
  return false;
}

/** A group's default behaviour: no hit of its own, children still raycast. */
export function raycastDescendants(): void {
  return undefined;
}

/**
 * `userData` flag for a subtree no click can select or open, such as a drawn
 * room's architecture. Only the selection pick reads it: measuring tools
 * still raycast the room's real surfaces, so `raycast` itself stays as is.
 */
export const SELECTION_PICK_IGNORED = "selectionPickIgnored";

/** `raycast` as three calls it: a gate may answer false, which three reads. */
interface GatedRaycastTarget {
  raycast(caster: Raycaster, intersects: Intersection[]): unknown;
}

/**
 * Three's `raycaster.intersectObjects(roots, true)` for the selection pick:
 * the same visit (layers, a `raycast` returning false keeps the raycaster out
 * of the subtree) and nearest hit first, without the subtrees flagged
 * `SELECTION_PICK_IGNORED`. The drawn Grand Hall is tens of thousands of
 * triangles three tests one by one; on a 4x-slowed phone CPU each press
 * spent about 60 ms on them for hits the pick then skips.
 */
export function intersectSelectable(raycaster: Raycaster, roots: readonly Object3D[]): Intersection[] {
  const hits: Intersection[] = [];
  const visit = (object: Object3D): void => {
    if (object.userData[SELECTION_PICK_IGNORED] === true) return;
    let descend = true;
    if (object.layers.test(raycaster.layers)) {
      const target: GatedRaycastTarget = object;
      descend = target.raycast(raycaster, hits) !== false;
    }
    if (descend) for (const child of object.children) visit(child);
  };
  for (const root of roots) visit(root);
  return hits.sort((a, b) => a.distance - b.distance);
}

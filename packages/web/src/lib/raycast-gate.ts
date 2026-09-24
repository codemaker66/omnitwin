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

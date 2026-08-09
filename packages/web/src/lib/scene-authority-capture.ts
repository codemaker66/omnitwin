import type { Object3D } from "three";

export interface OperationalSceneCapturePreparation {
  readonly excludedObjectCount: number;
  readonly restore: () => void;
}

function excludedFromOperationalCapture(object: Object3D): boolean {
  return object.userData.exportAuthority === "none"
    || object.userData.provenance === "generated";
}

/**
 * Temporarily hides generated or explicitly non-exportable scene regions.
 * Operational PNGs must never turn presentation proxies into layout truth.
 */
export function prepareSceneForOperationalCapture(
  root: Object3D,
): OperationalSceneCapturePreparation {
  const hidden: Object3D[] = [];
  let excludedObjectCount = 0;

  const visit = (object: Object3D): void => {
    if (excludedFromOperationalCapture(object)) {
      excludedObjectCount += 1;
      if (object.visible) {
        object.visible = false;
        hidden.push(object);
      }
      return;
    }
    for (const child of object.children) visit(child);
  };
  visit(root);

  let restored = false;
  return {
    excludedObjectCount,
    restore: () => {
      if (restored) return;
      restored = true;
      for (const object of hidden) object.visible = true;
    },
  };
}

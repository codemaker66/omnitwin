import {
  Material,
  Plane,
  Vector3,
  type Object3D,
} from "three";

const INERT_PLANE_CONSTANT = 1_000_000;
const MIN_HORIZONTAL_DISTANCE_SQ = 1e-12;
/**
 * The cutaway exists for SIDE-ON views only, where the exterior scan shell
 * blocks the interior. Once the camera climbs past this elevation angle the
 * open-top scan already reveals the rooms — and the plane's "outward"
 * direction (derived from a nearly-vertical view axis) becomes unstable and
 * sweeps INTO the interior, visibly chopping floors. Above it: inert plane.
 */
const MAX_ENGAGE_ELEVATION_TAN = Math.tan((32 * Math.PI) / 180);

export interface VerticalCutawayInput {
  readonly cameraPosition: Vector3;
  readonly target: Vector3;
  readonly witnesses: readonly Vector3[];
  /** Metres pulled inward from the camera-most scan-node projection. */
  readonly insetM: number;
}

/** Keep a configured clipping shader variant active without clipping geometry. */
export function setInertCutawayPlane(plane: Plane): void {
  plane.setComponents(0, 1, 0, INERT_PLANE_CONSTANT);
}

function finiteVector(vector: Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

/**
 * Set a vertical, camera-facing section plane around an interior scan-node
 * footprint. The vertical normal preserves floors, ceilings and the dome even
 * when the orbit camera is elevated. Three retains the plane's positive side,
 * so the inward normal removes the camera-side scan shell.
 */
export function updateVerticalCutawayPlane(
  plane: Plane,
  input: VerticalCutawayInput,
): boolean {
  setInertCutawayPlane(plane);
  const { cameraPosition, target, witnesses, insetM } = input;
  if (
    witnesses.length === 0 ||
    !finiteVector(cameraPosition) ||
    !finiteVector(target) ||
    !Number.isFinite(insetM) ||
    insetM < 0
  ) {
    return false;
  }

  const horizontalX = cameraPosition.x - target.x;
  const horizontalZ = cameraPosition.z - target.z;
  const horizontalDistanceSq = horizontalX * horizontalX + horizontalZ * horizontalZ;
  if (!Number.isFinite(horizontalDistanceSq) || horizontalDistanceSq <= MIN_HORIZONTAL_DISTANCE_SQ) {
    return false;
  }
  // Elevated orbit: the interior is already open to view and a camera-derived
  // section plane would sweep into the rooms (the "chops deep into the
  // building" failure). Stay inert; only side-on views engage the cutaway.
  const elevation = cameraPosition.y - target.y;
  if (elevation > Math.sqrt(horizontalDistanceSq) * MAX_ENGAGE_ELEVATION_TAN) {
    return false;
  }

  const inverseDistance = 1 / Math.sqrt(horizontalDistanceSq);
  const outwardX = horizontalX * inverseDistance;
  const outwardZ = horizontalZ * inverseDistance;
  let maximumProjection = Number.NEGATIVE_INFINITY;
  for (const witness of witnesses) {
    if (!finiteVector(witness)) {
      setInertCutawayPlane(plane);
      return false;
    }
    const projection =
      outwardX * (witness.x - target.x) + outwardZ * (witness.z - target.z);
    maximumProjection = Math.max(maximumProjection, projection);
  }

  const sectionProjection = maximumProjection - insetM;
  const constant =
    outwardX * target.x + outwardZ * target.z + sectionProjection;
  if (!Number.isFinite(sectionProjection) || !Number.isFinite(constant)) {
    setInertCutawayPlane(plane);
    return false;
  }

  plane.setComponents(-outwardX, 0, -outwardZ, constant);
  return true;
}

export interface CutawaySceneClone {
  readonly scene: Object3D;
  readonly materials: readonly Material[];
}

interface ObjectWithMaterial extends Object3D {
  material: Material | Material[];
}

function hasMaterial(object: Object3D): object is ObjectWithMaterial {
  if (!("material" in object)) {
    return false;
  }
  const material = object.material;
  return (
    material instanceof Material ||
    (Array.isArray(material) && material.every((entry) => entry instanceof Material))
  );
}

/**
 * Clone a cached GLTF hierarchy and only its materials. Geometry and textures
 * remain shared/read-only; the source scene and its globally cached materials
 * are never mutated by venue-specific clipping.
 */
export function cloneSceneWithCutawayPlanes(
  source: Object3D,
  planes: readonly Plane[],
): CutawaySceneClone {
  const scene = source.clone(true);
  const clones = new Map<Material, Material>();
  const cloneMaterial = (material: Material): Material => {
    const existing = clones.get(material);
    if (existing !== undefined) {
      return existing;
    }
    const cloned = material.clone();
    const clippingPlanes = [...(cloned.clippingPlanes ?? [])];
    const inheritedPlaneCount = clippingPlanes.length;
    const replacedInheritedPlanes = new Set<number>();
    for (const plane of planes) {
      if (clippingPlanes.includes(plane)) {
        continue;
      }
      const equalInheritedIndex = clippingPlanes.findIndex(
        (existing, index) =>
          index < inheritedPlaneCount &&
          !replacedInheritedPlanes.has(index) &&
          existing.equals(plane),
      );
      if (equalInheritedIndex !== -1) {
        // Material.clone() clones its existing Plane values. Replace an equal
        // clone with the supplied live plane so per-frame mutations reach the
        // shader instead of leaving a frozen snapshot behind.
        clippingPlanes[equalInheritedIndex] = plane;
        replacedInheritedPlanes.add(equalInheritedIndex);
      } else {
        // Distinct supplied planes may intentionally begin with equal inert
        // coefficients. Preserve both live identities so they can diverge on
        // the first frame (for example, the vertical and floor cutaways).
        clippingPlanes.push(plane);
      }
    }
    cloned.clippingPlanes = clippingPlanes;
    clones.set(material, cloned);
    return cloned;
  };

  scene.traverse((object) => {
    if (!hasMaterial(object)) {
      return;
    }
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneMaterial)
      : cloneMaterial(object.material);
  });

  return { scene, materials: [...clones.values()] };
}

export function cloneSceneWithCutawayPlane(source: Object3D, plane: Plane): CutawaySceneClone {
  return cloneSceneWithCutawayPlanes(source, [plane]);
}

/** Dispose only the material clones owned by the cutaway scene clone. */
export function disposeCutawayScene(sceneClone: CutawaySceneClone): void {
  for (const material of sceneClone.materials) {
    material.dispose();
  }
}

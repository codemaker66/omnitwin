import {
  Material,
  Plane,
  Vector3,
  type Object3D,
} from "three";

const INERT_PLANE_CONSTANT = 1_000_000;
const MIN_HORIZONTAL_DISTANCE_SQ = 1e-12;

// -----------------------------------------------------------------------------
// Why the section RETRACTS instead of switching off
//
// The cutaway earns its keep at side-on elevations, where the exterior scan
// shell stands between the camera and the rooms. Climb toward plan view and it
// stops earning anything: the open-top scan already shows the interior, so a
// vertical plane can only subtract a strip of the floor plan.
//
// The previous design expressed that as a hard predicate — engaged below 32
// degrees of elevation, inert above — and it is the reported bug. There is no
// state between "full inset" and "clips nothing", so crossing 32 degrees made a
// whole slab of building appear or vanish between two frames. Measured on the
// live dollhouse: at 31.85 degrees the plane constant was 15.33; at 33.98 it
// was 1,000,000. One orbit step, an unbounded step in the clip depth, and a
// visible pop. A user orbiting slowly re-crosses that angle constantly.
//
// So elevation drives the section's DEPTH, continuously, rather than its
// existence. Below FULL_CUT_ELEVATION_DEG the section sits at its full inset;
// across the band up to RETRACTED_ELEVATION_DEG it eases outward (smoothstep,
// zero slope at both ends, so the retraction has no visible start or stop) until
// it is parked clear of the scan hull entirely. Past the band it simply stays
// parked. Nothing pops because the plane never teleports: what it removes only
// ever shrinks or grows by the distance it travelled that frame.
//
// A half-engaged plane still cuts — that is the point. Half-engaged is a
// shallower cutaway, which is exactly what a half-elevated camera wants. The
// failure this design prevents is the discontinuity, not the cutting.
//
// The plane is therefore never made inert as a function of camera angle. Going
// inert is a teleport to infinity, and a teleport is only invisible if the plane
// was already clear of every triangle — which we cannot prove from scan poses
// alone. Parking it at a finite, hull-derived distance costs nothing and cannot
// pop. The remaining inert paths are degenerate inputs (no witnesses, non-finite
// values, camera directly over the target), where there is no defensible axis to
// cut along and the retracted plane would clip nothing anyway.
// -----------------------------------------------------------------------------

/** At or below this camera elevation the section cuts to its full inset. */
const FULL_CUT_ELEVATION_DEG = 30;
/** At or above this camera elevation the section is parked clear of the hull. */
const RETRACTED_ELEVATION_DEG = 70;
/**
 * The section may never approach the target closer than this share of the
 * camera-most witness projection. Guards the second failure mode: when the scan
 * is sparse on the camera's side, `maximumProjection` lands deep inside the
 * building and `- insetM` drives the plane past the rooms it was meant to open.
 * Half the camera-side reach means at least the far half of the model survives
 * at every angle. `Math.max` of two continuous terms stays continuous.
 */
const MAX_CUT_FRACTION = 0.5;
/**
 * Parked clearance beyond the camera-most witness, as a share of the hull's own
 * depth along the view axis. A scan pose stands inside a room, so the shell
 * behind the outermost pose is at most a room away — always less than half the
 * hull. Falls back to a multiple of the inset for degenerate (near-coincident)
 * witness sets where the hull has no depth to scale from.
 */
const RETRACT_CLEARANCE_HULL_FRACTION = 0.5;
const RETRACT_CLEARANCE_INSET_FACTOR = 2;

/**
 * 0 at full engagement, 1 fully parked. Hermite ease, so the retraction has
 * zero slope at both ends of the band and therefore no visible start or stop.
 */
function elevationRetraction(elevationDeg: number): number {
  const t = Math.min(
    Math.max(
      (elevationDeg - FULL_CUT_ELEVATION_DEG) /
        (RETRACTED_ELEVATION_DEG - FULL_CUT_ELEVATION_DEG),
      0,
    ),
    1,
  );
  return t * t * (3 - 2 * t);
}

export interface VerticalCutawayInput {
  readonly cameraPosition: Vector3;
  readonly target: Vector3;
  readonly witnesses: readonly Vector3[];
  /**
   * Metres pulled inward from the camera-most scan-node projection at full
   * engagement. The realised inset shrinks toward zero and then past it as the
   * camera climbs — see the retraction band above.
   */
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
 *
 * The section's depth is a continuous function of camera elevation: full inset
 * side-on, eased out to a parked position clear of the scan hull by plan view.
 * Returns false only for degenerate input, where the plane is left inert.
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
  const horizontalDistance = Math.sqrt(horizontalDistanceSq);
  const inverseDistance = 1 / horizontalDistance;
  const outwardX = horizontalX * inverseDistance;
  const outwardZ = horizontalZ * inverseDistance;
  let minimumProjection = Number.POSITIVE_INFINITY;
  let maximumProjection = Number.NEGATIVE_INFINITY;
  for (const witness of witnesses) {
    if (!finiteVector(witness)) {
      setInertCutawayPlane(plane);
      return false;
    }
    const projection =
      outwardX * (witness.x - target.x) + outwardZ * (witness.z - target.z);
    minimumProjection = Math.min(minimumProjection, projection);
    maximumProjection = Math.max(maximumProjection, projection);
  }

  // Deepest the section is ever allowed to sit, inset from the camera-most
  // scan pose but held back from swallowing the far half of the model.
  const cutProjection = Math.max(
    maximumProjection - insetM,
    maximumProjection * MAX_CUT_FRACTION,
  );
  // Parked position: clear of the shell behind the camera-most scan pose.
  const hullDepth = maximumProjection - minimumProjection;
  const parkedProjection =
    maximumProjection +
    Math.max(
      hullDepth * RETRACT_CLEARANCE_HULL_FRACTION,
      insetM * RETRACT_CLEARANCE_INSET_FACTOR,
    );
  // Elevation drives depth, not existence. atan2 keeps this well defined for a
  // camera below the target (retraction 0 — a floor-level view wants the full
  // cutaway) and saturates smoothly as the camera climbs toward plan view.
  const elevationDeg =
    (Math.atan2(cameraPosition.y - target.y, horizontalDistance) * 180) / Math.PI;
  const retraction = elevationRetraction(elevationDeg);
  const sectionProjection =
    cutProjection + (parkedProjection - cutProjection) * retraction;
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

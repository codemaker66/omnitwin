import { Matrix4, Vector3 } from "three";
import { meshRootWorldMatrix } from "../../../twin/dollhouse-peel.js";

// -----------------------------------------------------------------------------
// twin-placement — where the captured dollhouse mesh sits in the Arrival's
// anchor-local frame (Task 7, Step 1). Anchor-local metres: the frame
// ReorientationPlugin (GoogleTilesStage) puts at the scene origin, +Y up,
// cardinal axes aligned (camera-rail.ts documents the same space).
//
// The twin's own basis conversion — meshRootWorldMatrix(): E57_TO_THREE_QUAT
// + MESH_OFFSET_M, twin-basis.ts's single calibration surface — stays the
// inner truth. TwinPlacement is a purely OUTER rotate-then-translate wrapped
// around it (spec §3): recalibrating the Arrival's alignment to Google's
// tiles (Task 8) only ever changes TRADES_HALL_TWIN_PLACEMENT here, never
// twin-basis.ts or the peel system.
// -----------------------------------------------------------------------------

/** Where the dollhouse mesh sits in the Arrival scene's anchor-local metres. */
export interface TwinPlacement {
  /** Anchor-local metres. */
  readonly positionM: readonly [number, number, number];
  /** Yaw about +Y, three.js convention (radians). */
  readonly headingRad: number;
}

/**
 * Seeded at zero: the twin mesh sits at its own native basis transform,
 * unmoved, until Task 8 calibrates it by eye against the rendered tiles (the
 * same nudge-tool process trades-hall-anchor.ts documents for the anchor
 * itself).
 *
 * TASK 8 TRIP-WIRE — read before setting a non-zero positionM[1] (vertical
 * offset): HallHandoff.tsx runs the dollhouse-peel caps split
 * (`applyDollhouseCaps(gltf.scene, undefined, meshRootWorldMatrix())`) against
 * `meshRootWorldMatrix()` ALONE, never against this placement. That split is
 * baked into the GLB's SHARED, globally-cached geometry — flagged idempotent,
 * so whichever consumer (DollhouseStage or HallHandoff) loads it first fixes
 * the classification for the life of the page. Its open/capped rule keys on
 * absolute world height (dollhouse-peel.ts's `openPlateMinWorldY = 3m`); a
 * vertical positionM offset here shifts the mesh's REAL world height without
 * the caps split ever knowing, silently reclassifying plates against the
 * wrong side of that 3m line. Confirm this is accounted for (pass a
 * placement-aware matrix into the caps call, or confirm the calibrated offset
 * is small enough not to cross the threshold) before shipping a non-zero
 * vertical calibration.
 */
export const TRADES_HALL_TWIN_PLACEMENT: TwinPlacement = {
  positionM: [0, 0, 0],
  headingRad: 0,
};

/**
 * The placement as a Matrix4: an outer rotate-then-translate composed on top
 * of the twin's own basis transform. `meshRootWorldMatrix()` is the single
 * inner truth (never reimplemented here, only consumed) — this wraps AROUND
 * it, never inside it, so the two calibration surfaces can never collide.
 */
export function twinPlacementMatrix(placement: TwinPlacement): Matrix4 {
  return new Matrix4()
    .makeRotationY(placement.headingRad)
    .setPosition(new Vector3(...placement.positionM))
    .multiply(meshRootWorldMatrix());
}

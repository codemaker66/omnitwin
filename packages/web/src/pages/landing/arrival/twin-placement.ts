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

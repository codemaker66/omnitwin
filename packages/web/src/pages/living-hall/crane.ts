// -----------------------------------------------------------------------------
// crane — the rising camera of the Dressing's fill.
//
// As the floor fills, the camera lifts from the eye-height dolly to a high
// three-quarter vantage so the choreography becomes legible from above, then
// hands back before the act ends. The pose is empirically gated (2026-07-10
// probes): the splat renders clean up to ~+0.85 ABOVE A WALKED STATION and
// collapses into the ceiling shell at +1.25 — and collapses anywhere the
// scanner never stood, whatever the height. So the crane rises strictly
// vertically above the arrival station (15% of the walk), locked at +0.75,
// bracketed by clean proofs at +0.60 and +0.85.
// -----------------------------------------------------------------------------

export const CRANE_POSE = {
  /** 0.75 m above the walked arrival station [-2.372, 0.035, 1.046]. */
  position: [-2.372, 0.75, 1.046],
  /** The fill's floor centroid — the whole choreography in frame at fov 62. */
  look: [-2.0, -1.35, 7.2],
} as const;

/** Hermite smoothstep on [edge0, edge1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Crane engagement over the Dressing act's progress: flat through the
 *  intimate opener, rising with the fill (0.35 → 0.7), held while the floor
 *  completes, and handed back to the dolly before the act ends (0.9 → 1).
 *  Scroll is the only clock — under reduced motion this is identical by
 *  construction. */
export function craneWeight(actProgress: number): number {
  return smoothstep(0.35, 0.7, actProgress) * (1 - smoothstep(0.9, 1.0, actProgress));
}

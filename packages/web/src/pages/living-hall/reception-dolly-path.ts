// -----------------------------------------------------------------------------
// reception-dolly-path — the authored camera path through the real room.
//
// Every station below is a REAL capture viewpoint: positions and gaze targets
// are lifted from the scanner's own trajectory (lcc2-result/info/poses.json,
// 4,529 poses; transform LCC Z-up → three.js Y-up: world = (x, z, −y); baked
// 2026-07-09). Staying on the capture path is what keeps the splat photoreal —
// floaters and smears live where the scanner never stood. The raw walk is a
// 243m coverage zigzag, so the dolly is *authored*: seven verified stations
// (graded via the P1 artifact map) ordered for narrative flow, smoothed
// through a Catmull-Rom curve at runtime.
// -----------------------------------------------------------------------------

export interface DollyStation {
  /** Camera position, world metres (Y up, capture height ≈ 0). */
  readonly position: readonly [number, number, number];
  /** Gaze target, world metres — also from the capture trajectory. */
  readonly look: readonly [number, number, number];
}

export const RECEPTION_DOLLY_STATIONS: readonly DollyStation[] = [
  // pose 679 (15% of walk) — wide arrival, window wall ahead
  { position: [-2.372, 0.035, 1.046], look: [-0.996, -0.071, 7.102] },
  // pose 1268 (28%) — along the sconce wall
  { position: [-5.748, -0.038, 3.606], look: [-6.02, -0.005, 3.08] },
  // pose 1856 (41%) — mid-room, gazing across the floor
  { position: [1.497, -0.116, 6.9], look: [-5.521, -0.068, 8.088] },
  // pose 2400 (53%) — deep corner, looking back
  { position: [-2.432, -0.053, 10.148], look: [1.484, -0.127, 9.745] },
  // pose 2943 (65%) — the glazed double doors
  { position: [-5.663, 0.504, 5.025], look: [-5.724, 0.347, 4.172] },
  // pose 3532 (78%) — toward the far windows
  { position: [2.764, 0.298, 7.02], look: [3.543, 0.313, 9.401] },
  // pose 4076 (90%) — settling on the window wall
  { position: [-2.875, -0.336, 4.555], look: [-2.138, -0.418, 11.45] },
] as const;

/** Gaze targets closer than this feel like pressing a nose to the wall; the
 *  scene extends short gazes along their own direction to at least this. */
export const MIN_GAZE_DISTANCE_M = 2.5;

/** The Reception Room runtime tiles as staged under /splats/reception/
 *  (dev-local; production serves the same names from R2 — P4). Sizes are
 *  bytes-on-disk from the LCC export, for load-progress display. */
export const RECEPTION_TILE_MANIFEST = [
  { file: "0_0.sog", bytes: 9017864 },
  { file: "0_1_0.sog", bytes: 9845814 },
  { file: "0_1_0_5.sog", bytes: 10047085 },
  { file: "0_6_0_0.sog", bytes: 10368228 },
  { file: "0_7_0_0.sog", bytes: 5040628 },
  { file: "0_15_0_0.sog", bytes: 10279160 },
  { file: "0_20_0.sog", bytes: 8106037 },
  { file: "env.sog", bytes: 129565 },
] as const;

export const RECEPTION_SPLAT_BASE = "/splats/reception";

export function receptionTileUrls(): readonly string[] {
  return RECEPTION_TILE_MANIFEST.map((t) => `${RECEPTION_SPLAT_BASE}/${t.file}`);
}

// ---------------------------------------------------------------------------
// Nothing burns in (goal 19 S8 item 14). A wall display shows the same lanes
// for a whole shift; a slab edge resting on one row of pixels for hours
// marks an OLED and ghosts a cheaper panel. The board sits a few pixels off
// centre and moves to a new spot every ten minutes, through nine spots in
// a fixed order that never steps to a neighbour twice the same way. It is a
// position, not a motion: no transition, one move per period, and the move
// lands within a minute of the period edge because the board's clock ticks
// at least once a minute. Phones and desks never drift.
// ---------------------------------------------------------------------------

export const DRIFT_PERIOD_MS = 10 * 60_000;
export const DRIFT_STEP_PX = 3;

export interface DriftOffset {
  readonly x: number;
  readonly y: number;
}

/** Centre, N, SE, W, NE, S, NW, E, SW: every spot once, no straight run. */
const SPOTS: readonly DriftOffset[] = [
  { x: 0, y: 0 },
  { x: 0, y: -DRIFT_STEP_PX },
  { x: DRIFT_STEP_PX, y: DRIFT_STEP_PX },
  { x: -DRIFT_STEP_PX, y: 0 },
  { x: DRIFT_STEP_PX, y: -DRIFT_STEP_PX },
  { x: 0, y: DRIFT_STEP_PX },
  { x: -DRIFT_STEP_PX, y: -DRIFT_STEP_PX },
  { x: DRIFT_STEP_PX, y: 0 },
  { x: -DRIFT_STEP_PX, y: DRIFT_STEP_PX },
];

export function driftOffset(nowMs: number): DriftOffset {
  const period = Math.floor(nowMs / DRIFT_PERIOD_MS);
  const index = ((period % SPOTS.length) + SPOTS.length) % SPOTS.length;
  return SPOTS[index] ?? SPOTS[0] ?? { x: 0, y: 0 };
}

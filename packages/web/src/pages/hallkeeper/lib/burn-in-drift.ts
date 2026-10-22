// ---------------------------------------------------------------------------
// Nothing burns in (goal 19 S8 item 14; goal 19 line 132 asks for "a one-
// pixel-per-minute drift of the whole composition"). A wall display shows
// the same lanes for a whole shift; a slab edge resting on one row of pixels
// for hours marks an OLED and ghosts a cheaper panel. The board walks one
// pixel a minute round a small ring about the centre, never more than a
// pixel a step and never further than the reach, so no edge rests and
// nobody sees it move. It is a position, not a motion: no transition. The
// board's clock ticks at least once a minute, so each step lands on time.
// Phones and desks never drift.
// ---------------------------------------------------------------------------

export const DRIFT_STEP_MS = 60_000;
export const DRIFT_REACH_PX = 3;

export interface DriftOffset {
  readonly x: number;
  readonly y: number;
}

/** The ring: the edge of the square from -reach to +reach, walked clockwise
 *  from the top-left corner, one pixel a step. */
function ring(reach: number): readonly DriftOffset[] {
  const side = 2 * reach;
  const spots: DriftOffset[] = [];
  for (let i = 0; i < side; i += 1) spots.push({ x: -reach + i, y: -reach });
  for (let i = 0; i < side; i += 1) spots.push({ x: reach, y: -reach + i });
  for (let i = 0; i < side; i += 1) spots.push({ x: reach - i, y: reach });
  for (let i = 0; i < side; i += 1) spots.push({ x: -reach, y: reach - i });
  return spots;
}

const RING = ring(DRIFT_REACH_PX);

export function driftOffset(nowMs: number): DriftOffset {
  const minute = Math.floor(nowMs / DRIFT_STEP_MS);
  const index = ((minute % RING.length) + RING.length) % RING.length;
  return RING[index] ?? { x: 0, y: 0 };
}

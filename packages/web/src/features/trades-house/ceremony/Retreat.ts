// -----------------------------------------------------------------------------
// Retreat — where the three unchosen cards go when one is chosen.
//
// Pure. At t1 + 40 ms the unchosen cards lean toward the chosen one and dim
// to 0.42, staggered 40 ms, nearest first. Inward only, never outward: a card
// that moved away from the chosen one would extend the panel's overflow, and
// nothing in the stage may add a pixel of scroll. The lean is a fraction of
// one slot pitch, so the same table serves the desktop column and the phone's
// two-by-two grid; the component multiplies by the measured pitch in px.
// -----------------------------------------------------------------------------
import { CEREMONY_TIMING } from "./ceremony-types.js";

export type RetreatLayout = "column" | "grid";

export interface RetreatTarget {
  readonly seat: number;
  /** Translation in slot pitches, toward the chosen seat; |dx|, |dy| ≤ RETREAT_LEAN. */
  readonly dx: number;
  readonly dy: number;
  /** ms after the retreat begins (t1 + retreatDelayMs), nearest card first. */
  readonly delayMs: number;
}

/**
 * How far an unchosen card leans, as a fraction of one slot pitch. Enough to
 * read as "gathering toward what you chose", never enough to overlap it.
 */
export const RETREAT_LEAN = 0.18;

/** The phone grid is two across; the column is one. */
export const GRID_COLUMNS = 2;

export interface SlotPosition {
  readonly col: number;
  readonly row: number;
}

/** Where a seat sits in its layout, in slot units. */
export function seatPosition(seat: number, layout: RetreatLayout): SlotPosition {
  if (!Number.isInteger(seat) || seat < 0) {
    throw new RangeError(`A seat is a non-negative integer; got ${String(seat)}`);
  }
  if (layout === "column") return { col: 0, row: seat };
  return { col: seat % GRID_COLUMNS, row: Math.floor(seat / GRID_COLUMNS) };
}

/**
 * The retreat table for one commit. Every unchosen seat gets a translation
 * whose largest component is exactly RETREAT_LEAN toward the chosen card
 * (so a diagonal neighbour on the grid leans on both axes), and a delay by
 * distance so the gathering ripples out from the choice.
 */
export function retreatTargets(
  chosenSeat: number,
  seatCount: number,
  layout: RetreatLayout,
): RetreatTarget[] {
  if (!Number.isInteger(seatCount) || seatCount < 1) {
    throw new RangeError(`seatCount must be a positive integer; got ${String(seatCount)}`);
  }
  if (!Number.isInteger(chosenSeat) || chosenSeat < 0 || chosenSeat >= seatCount) {
    throw new RangeError(`chosenSeat ${String(chosenSeat)} is outside 0..${String(seatCount - 1)}`);
  }
  const chosen = seatPosition(chosenSeat, layout);
  const unchosen: { seat: number; dx: number; dy: number; distance: number }[] = [];
  for (let seat = 0; seat < seatCount; seat += 1) {
    if (seat === chosenSeat) continue;
    const self = seatPosition(seat, layout);
    const deltaX = chosen.col - self.col;
    const deltaY = chosen.row - self.row;
    const largest = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    // largest is never 0: two seats never share a slot.
    const scale = RETREAT_LEAN / largest;
    unchosen.push({
      seat,
      dx: deltaX * scale,
      dy: deltaY * scale,
      distance: Math.hypot(deltaX, deltaY),
    });
  }
  unchosen.sort((a, b) => a.distance - b.distance || a.seat - b.seat);
  return unchosen.map((entry, order) => ({
    seat: entry.seat,
    dx: entry.dx,
    dy: entry.dy,
    delayMs: order * CEREMONY_TIMING.retreatStaggerMs,
  }));
}

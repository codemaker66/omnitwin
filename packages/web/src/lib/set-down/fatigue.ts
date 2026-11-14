// ---------------------------------------------------------------------------
// Ear fatigue over a long session (T-700, ruling R26).
//
// A Lay out after a Lay out tires the ear. Once more than 20 set-downs have
// played in the last five minutes, set-downs ease quieter, linearly to -3 dB
// at 30, and recover as the window empties. The level never moves more than
// 1 dB from one reading to the next, so no play is suddenly softer or louder
// than the one before it.
// ---------------------------------------------------------------------------

/** How far back plays are counted. */
export const FATIGUE_WINDOW_MS = 5 * 60 * 1000;
/** Up to this many plays in the window, nothing changes. */
const FREE_PLAYS = 20;
/** At this many plays the level reaches its floor. */
const FLOOR_PLAYS = 30;
const FLOOR_DB = -3;
/** The most the level moves between two readings. */
const STEP_DB = 1;

interface Played {
  readonly atMs: number;
  readonly count: number;
}

/** The level fatigue wants with `plays` in the window. */
function fatigueTargetDb(plays: number): number {
  if (plays <= FREE_PLAYS) return 0;
  return Math.max(FLOOR_DB, (FLOOR_DB * (plays - FREE_PLAYS)) / (FLOOR_PLAYS - FREE_PLAYS));
}

/**
 * The set-downs played in the last five minutes, and the level they call for.
 * The driver records each play as it is admitted, then reads the level for it.
 */
export class SetDownFatigue {
  private readonly played: Played[] = [];
  private plays = 0;
  private lastDb = 0;

  /** `count` set-downs played at `nowMs`. */
  record(nowMs: number, count: number): void {
    const whole = Math.floor(count);
    if (!Number.isFinite(nowMs) || !(whole >= 1)) return;
    this.played.push({ atMs: nowMs, count: whole });
    this.plays += whole;
  }

  /**
   * The level for a play at `nowMs`, in dB: 0 down to -3, moved at most 1 dB
   * from the last reading towards what the plays in the window call for.
   */
  levelDb(nowMs: number): number {
    if (Number.isFinite(nowMs)) this.forgetBefore(nowMs - FATIGUE_WINDOW_MS);
    const target = fatigueTargetDb(this.plays);
    const change = target - this.lastDb;
    this.lastDb = Math.abs(change) <= STEP_DB ? target : this.lastDb + Math.sign(change) * STEP_DB;
    return this.lastDb;
  }

  /** Drops the plays at or before `cutoffMs`: a play counts for five minutes, not including the last instant. */
  private forgetBefore(cutoffMs: number): void {
    let expired = 0;
    while (expired < this.played.length && (this.played[expired]?.atMs ?? Infinity) <= cutoffMs) {
      this.plays -= this.played[expired]?.count ?? 0;
      expired += 1;
    }
    if (expired > 0) this.played.splice(0, expired);
  }
}

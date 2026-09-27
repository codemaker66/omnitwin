import { msToWallInput, wallInputToMs } from "./board-time.js";

// ---------------------------------------------------------------------------
// Extending a hold's decision (roadmap N3: Confirm, Extend and Release). The
// most common answer to a client who needs longer is "another week", so the
// drawer offers that date outright rather than a date field to fill in:
// a week from the decision date, or from today when it has already passed,
// at the decision's own wall time (so 12:00 stays 12:00 across a clock
// change). A decision after the event makes no sense, so it stops at the
// day before the event starts; when that is no later, nothing is offered.
// ---------------------------------------------------------------------------

const WEEK_DAYS = 7;

/** "2026-09-16" plus `days` calendar days. */
function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) + days));
  return moved.toISOString().slice(0, 10);
}

/** The instant a hold's decision would move to, or null when there is no
 *  later day to give before its event. */
export function extendedDecisionMs(decisionAt: string, startsAt: string, nowMs: number): number | null {
  const currentMs = Date.parse(decisionAt);
  const startMs = Date.parse(startsAt);
  if (!Number.isFinite(currentMs) || !Number.isFinite(startMs)) return null;
  const time = msToWallInput(currentMs).slice(11, 16);
  const fromDay = msToWallInput(Math.max(currentMs, nowMs)).slice(0, 10);
  const weekOn = wallInputToMs(`${addDays(fromDay, WEEK_DAYS)}T${time}`);
  const dayBefore = wallInputToMs(`${addDays(msToWallInput(startMs).slice(0, 10), -1)}T${time}`);
  if (weekOn === null || dayBefore === null) return null;
  const next = Math.min(weekOn, dayBefore);
  return next > currentMs && next > nowMs ? next : null;
}

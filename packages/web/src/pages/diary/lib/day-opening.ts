import type { CalendarEntry } from "@omnitwin/types";
import { msToWallInput, wallInputToMs, type BoardRange } from "./board-time.js";

// ---------------------------------------------------------------------------
// Where the day view opens (roadmap N3). It opened at 00:00, so a 14:00
// wedding sat off-screen until the booker scrolled to it. Today opens at the
// current time; any other day at its first booking; an empty day at the
// working morning. Each shows the hour before, so what comes first is seen
// arriving rather than cut at the edge.
// ---------------------------------------------------------------------------

const LEAD_MS = 3_600_000;
const MORNING = "08:00";

export function dayOpeningMs(range: BoardRange, entries: readonly CalendarEntry[], nowMs: number): number {
  let target: number | null = null;
  if (nowMs >= range.fromMs && nowMs < range.toMs) {
    target = nowMs;
  } else {
    for (const entry of entries) {
      const startMs = Date.parse(entry.startsAt);
      if (startMs < range.toMs && Date.parse(entry.endsAt) > range.fromMs && (target === null || startMs < target)) target = startMs;
    }
  }
  target ??= wallInputToMs(`${msToWallInput(range.fromMs).slice(0, 10)}T${MORNING}`) ?? range.fromMs;
  return Math.max(range.fromMs, target - LEAD_MS);
}

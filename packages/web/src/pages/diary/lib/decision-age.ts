import { BOARD_COPY } from "../board-copy.js";
import { msToWallInput } from "./board-time.js";

// ---------------------------------------------------------------------------
// A hold's decision age (roadmap N3: "a copper decision age when 7 days or
// fewer remain"). Counted in the venue's calendar days, so a decision due at
// 09:00 tomorrow "decides tomorrow" whatever the hour now; once its time has
// passed it is overdue. Further off than a week, a card says nothing.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

function venueDayNumber(ms: number): number {
  return Math.round(Date.parse(`${msToWallInput(ms).slice(0, 10)}T00:00:00.000Z`) / DAY_MS);
}

export function decisionAge(decisionAt: string | null, nowMs: number): string | null {
  if (decisionAt === null) return null;
  const decisionMs = Date.parse(decisionAt);
  if (!Number.isFinite(decisionMs)) return null;
  if (decisionMs < nowMs) return BOARD_COPY.card.decisionOverdue;
  const days = venueDayNumber(decisionMs) - venueDayNumber(nowMs);
  if (days > WEEK_DAYS) return null;
  if (days === 0) return BOARD_COPY.card.decidesToday;
  if (days === 1) return BOARD_COPY.card.decidesTomorrow;
  return BOARD_COPY.card.decidesIn(days);
}

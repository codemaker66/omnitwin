import type { CalendarTurnaroundRule } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Turnaround guideline resolution — the server conflict engine's semantics,
// mirrored once for every client surface (promoted from the When ribbon the
// moment the Command Centre became its second consumer — the springs.ts
// precedent). Pinned by the ribbon model's tests.
//
// Guidance, never a ruling: the engine is advisory-only and so is anything
// drawn from this.
// ---------------------------------------------------------------------------

export interface TurnaroundGuideline {
  readonly minutes: number;
  readonly name: string;
}

/** Most specific active rule for (spaceId, incoming eventType); a typed rule
 *  needs a matching non-null incoming type; ties resolve toward the LARGEST
 *  minutes — the fail-safe direction. */
export function resolveTurnaroundGuideline(
  rules: readonly CalendarTurnaroundRule[] | undefined,
  spaceId: string,
  incomingEventType: string | null,
): TurnaroundGuideline | null {
  if (rules === undefined) return null;
  let best: CalendarTurnaroundRule | null = null;
  let bestScore = -1;
  for (const candidate of rules) {
    if (!candidate.isActive) continue;
    if (candidate.spaceId !== null && candidate.spaceId !== spaceId) continue;
    if (
      candidate.eventType !== null &&
      (incomingEventType === null || candidate.eventType !== incomingEventType)
    ) {
      continue;
    }
    const score =
      (candidate.spaceId !== null ? 2 : 0) + (candidate.eventType !== null ? 1 : 0);
    if (
      score > bestScore ||
      (score === bestScore && best !== null && candidate.minutes > best.minutes)
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best === null ? null : { minutes: best.minutes, name: best.name };
}

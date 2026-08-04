import type { Action } from "@omnitwin/types";

// G4 Slice 1: bounded append for the action log. When the log exceeds its
// cap, the oldest entries fold into ONE explicit `log.summarized` action —
// the log admits truncation, it never silently drops. A prior summary at the
// head is absorbed into the next fold (its count carries forward), so the
// log always has at most one summary, at position zero.

export interface ActionLogLimits {
  readonly maxEntries: number;
  /** How many of the oldest entries fold when the cap is exceeded. */
  readonly foldCount: number;
  readonly makeId: () => string;
  readonly now: () => string;
}

interface SummaryPayload {
  readonly folded: number;
  readonly from: string;
  readonly to: string;
}

function foldedCountOf(action: Action): number {
  if (action.intent !== "log.summarized") return 1;
  const payload = action.payload as Partial<SummaryPayload> | null;
  return typeof payload?.folded === "number" ? payload.folded : 1;
}

function spanStartOf(action: Action): string {
  if (action.intent === "log.summarized") {
    const payload = action.payload as Partial<SummaryPayload> | null;
    if (typeof payload?.from === "string") return payload.from;
  }
  return action.ts;
}

function spanEndOf(action: Action): string {
  if (action.intent === "log.summarized") {
    const payload = action.payload as Partial<SummaryPayload> | null;
    if (typeof payload?.to === "string") return payload.to;
  }
  return action.ts;
}

export function appendWithOverflow(
  entries: readonly Action[],
  action: Action,
  limits: ActionLogLimits,
): readonly Action[] {
  const next = [...entries, action];
  if (next.length <= limits.maxEntries) return next;

  // Keep at least the newest entry unfolded.
  const foldEnd = Math.min(limits.foldCount, next.length - 1);
  const folded = next.slice(0, foldEnd);
  const survivors = next.slice(foldEnd);
  const first = folded[0];
  const last = folded[folded.length - 1];
  if (first === undefined || last === undefined) return next;

  const summary: Action = {
    id: limits.makeId(),
    actor: { kind: "system" },
    intent: "log.summarized",
    payload: {
      folded: folded.reduce((sum, entry) => sum + foldedCountOf(entry), 0),
      from: spanStartOf(first),
      to: spanEndOf(last),
    },
    inverse: null,
    provenance: { surface: "action-log" },
    ts: limits.now(),
  };
  return [summary, ...survivors];
}

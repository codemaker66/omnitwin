import { MAX_HISTORY_ENTRIES, type EditorHistory, type HistoryEntry } from "./editor-history.js";
import type { HistoryClock } from "./history-clock.js";
import { nameHistoryStep } from "./history-names.js";
import type { EditorObject } from "../stores/editor-store.js";

// ---------------------------------------------------------------------------
// history-steps — what History lists (approved spec §6.9; T-674 slice 15).
//
// The timeline in the order it happened: where it began, every step named
// and timed, the saves as bookmarks after the step they saved, the current
// position marked and the steps Redo would put back after it, dimmed. Steps
// are grouped by sitting: a pause of half an hour or more starts a new group.
// A row's `position` is how many steps are done once History returns there
// (0: before any step), which is all a return needs.
// ---------------------------------------------------------------------------

/** A pause this long between two steps starts a new sitting. */
export const SITTING_GAP_MS = 30 * 60 * 1000;

/** The cap, as History says it. */
export const HISTORY_CAP = MAX_HISTORY_ENTRIES;

export type RowState = "done" | "current" | "undone";

export interface HistoryRow {
  readonly kind: "origin" | "step" | "saved";
  readonly key: string;
  readonly name: string;
  /** Steps done once History returns to this row. */
  readonly position: number;
  readonly at: number | null;
  readonly state: RowState;
}

export interface HistorySitting {
  readonly key: string;
  readonly from: number | null;
  readonly to: number | null;
  readonly rows: readonly HistoryRow[];
}

export interface HistoryView {
  readonly sittings: readonly HistorySitting[];
  /** Steps done: where History stands now. */
  readonly position: number;
  /** Every step it holds, done and undone. */
  readonly steps: number;
  /** Steps that fell off the oldest end. */
  readonly dropped: number;
  /** Nothing yet to undo or redo. */
  readonly empty: boolean;
}

function stateAt(position: number, current: number): RowState {
  if (position === current) return "current";
  return position < current ? "done" : "undone";
}

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "21:41". */
export function clockTime(at: number): string {
  return TIME.format(at);
}

function originName(clock: HistoryClock): string {
  if (clock.dropped > 0) return "Before these steps";
  return clock.began === "saved" ? "As saved" : "As opened";
}

/** The timeline in the order it happened, oldest first. */
function chronological(history: EditorHistory<EditorObject>): readonly HistoryEntry<EditorObject>[] {
  return [...history.past, ...[...history.future].reverse()];
}

function groupBySitting(rows: readonly HistoryRow[]): HistorySitting[] {
  const sittings: HistorySitting[] = [];
  let open: HistoryRow[] = [];
  let lastAt: number | null = null;
  const close = (): void => {
    const times = open.map((row) => row.at).filter((at): at is number => at !== null);
    sittings.push({ key: open[0]?.key ?? "empty", from: times[0] ?? null, to: times.at(-1) ?? null, rows: open });
    open = [];
  };
  for (const row of rows) {
    if (row.kind === "step" && row.at !== null && lastAt !== null && row.at - lastAt >= SITTING_GAP_MS && open.length > 0) close();
    open.push(row);
    if (row.at !== null) lastAt = row.at;
  }
  if (open.length > 0) close();
  return sittings;
}

export function historyView(history: EditorHistory<EditorObject>, clock: HistoryClock, objects: readonly EditorObject[]): HistoryView {
  const current = history.past.length;
  const entries = chronological(history);
  const savesBySeq = new Map<number, number[]>();
  for (const mark of clock.saves) savesBySeq.set(mark.seq, [...(savesBySeq.get(mark.seq) ?? []), mark.at]);
  const savedRows = (seq: number, position: number): HistoryRow[] => (savesBySeq.get(seq) ?? []).map((at, index): HistoryRow => ({
    kind: "saved",
    key: `saved-${String(seq)}-${String(index)}`,
    name: `Saved ${clockTime(at)}`,
    position,
    at,
    // A bookmark is a place to return to beside its step; the step itself carries the mark of now.
    state: position <= current ? "done" : "undone",
  }));

  const rows: HistoryRow[] = [{
    kind: "origin",
    key: "origin",
    name: originName(clock),
    position: 0,
    at: clock.dropped > 0 ? null : clock.startedAt,
    state: stateAt(0, current),
  }, ...savedRows(0, 0)];
  entries.forEach((entry, index) => {
    const position = index + 1;
    const facts = clock.steps.get(entry.seq);
    rows.push({
      kind: "step",
      key: `step-${String(entry.seq)}`,
      name: nameHistoryStep(entry, { objects, floorEmptyBefore: facts?.floorEmptyBefore === true }),
      position,
      at: facts?.at ?? null,
      state: stateAt(position, current),
    }, ...savedRows(entry.seq, position));
  });

  return {
    sittings: groupBySitting(rows),
    position: current,
    steps: entries.length,
    dropped: clock.dropped,
    empty: entries.length === 0,
  };
}

/** How to get from where History stands to a position: so many undos, or so many redos. */
export function stepsToReach(current: number, target: number): { readonly undo: number; readonly redo: number } {
  return target < current ? { undo: current - target, redo: 0 } : { undo: 0, redo: target - current };
}

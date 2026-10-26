import { useSyncExternalStore } from "react";
import type { EditorHistory } from "./editor-history.js";
import { useEditorStore, type EditorObject } from "../stores/editor-store.js";

// ---------------------------------------------------------------------------
// history-clock — when each undo step happened, and where the saves fall
// (approved spec §6.9; T-674 slice 15).
//
// The editor's timeline carries no times (lib/editor-history.ts), and History
// lists its steps with them. This module watches the editor store and writes
// down, for every step's `seq` (stable across coalescing, id remaps, undo and
// redo), the moment it was first seen and whether the floor was empty just
// before it; it also marks each save this browser completed as a bookmark at
// the step it saved. It never writes to the store.
//
// The timeline lives in memory, so this does too: a reload or opening the
// layout again starts it afresh ("History starts when you open the layout").
// A timeline the store empties (a load, the server's copy shown after a
// conflict, a save it could not line up) starts the clock again with it.
// ---------------------------------------------------------------------------

/** What the clock knows of one step. */
export interface StepFacts {
  /** Epoch ms when the step first appeared. */
  readonly at: number;
  /** The floor held nothing just before it (a Lay out onto an empty room). */
  readonly floorEmptyBefore: boolean;
}

/** A save this browser completed, at the step it saved (seq 0: before any step). */
export interface SaveMark {
  readonly seq: number;
  readonly at: number;
}

/** How the timeline being watched began. */
export type ClockBeginning = "opened" | "saved";

export interface HistoryClock {
  readonly configId: string | null;
  /** When this timeline began: the layout opened, or a save started it again. */
  readonly startedAt: number;
  readonly began: ClockBeginning;
  readonly steps: ReadonlyMap<number, StepFacts>;
  readonly saves: readonly SaveMark[];
  /** Steps that fell off the oldest end (the 100-step cap or the memory budget). */
  readonly dropped: number;
}

/** The parts of the editor's state the clock reads. */
export interface ClockReading {
  readonly configId: string | null;
  readonly history: EditorHistory<EditorObject>;
  readonly objectCount: number;
  readonly isSaving: boolean;
  readonly lastSavedAt: Date | null;
}

function seqsOf(history: EditorHistory<EditorObject>): readonly number[] {
  return [...history.past.map((entry) => entry.seq), ...history.future.map((entry) => entry.seq)];
}

function isEmpty(history: EditorHistory<EditorObject>): boolean {
  return history.past.length === 0 && history.future.length === 0;
}

/** A clock for a timeline that begins now. */
export function startClock(reading: ClockReading, now: number, began: ClockBeginning = "opened"): HistoryClock {
  const steps = new Map<number, StepFacts>();
  for (const seq of seqsOf(reading.history)) steps.set(seq, { at: now, floorEmptyBefore: false });
  return { configId: reading.configId, startedAt: now, began, steps, saves: [], dropped: 0 };
}

function justSaved(previous: ClockReading, next: ClockReading): boolean {
  return previous.isSaving && !next.isSaving && next.lastSavedAt !== null
    && next.lastSavedAt.getTime() !== previous.lastSavedAt?.getTime();
}

/**
 * The clock after the editor moved from `previous` to `next`. Returns the same
 * clock when nothing it keeps changed, so a drag's frames cost one compare.
 */
export function advanceClock(clock: HistoryClock, previous: ClockReading, next: ClockReading, now: number): HistoryClock {
  const saved = justSaved(previous, next);
  if (next.history === previous.history && next.configId === clock.configId && !saved) return clock;

  // Another layout, or the store emptied the timeline: History starts again.
  const sameLayout = next.configId === clock.configId;
  if (!sameLayout || (isEmpty(next.history) && !isEmpty(previous.history))) {
    if (saved && sameLayout && next.lastSavedAt !== null) {
      const at = next.lastSavedAt.getTime();
      return { ...startClock(next, at, "saved"), saves: [{ seq: 0, at }] };
    }
    return startClock(next, now, "opened");
  }

  const present = new Set(seqsOf(next.history));
  let changed = false;
  const steps = new Map(clock.steps);
  for (const seq of present) {
    if (steps.has(seq)) continue;
    steps.set(seq, { at: now, floorEmptyBefore: previous.objectCount === 0 });
    changed = true;
  }
  const oldestKept = next.history.past[0]?.seq ?? Number.POSITIVE_INFINITY;
  const pastBefore = new Set(previous.history.past.map((entry) => entry.seq));
  let dropped = clock.dropped;
  for (const seq of clock.steps.keys()) {
    if (present.has(seq)) continue;
    steps.delete(seq);
    changed = true;
    // Gone from the bottom of the past, older than everything kept: it fell off the end.
    if (pastBefore.has(seq) && seq < oldestKept) dropped += 1;
  }
  // A bookmark stays while its step does; one before every step goes once the oldest have dropped off.
  let saves = clock.saves.filter((mark) => (mark.seq === 0 ? dropped === 0 : present.has(mark.seq)));
  if (saves.length !== clock.saves.length) changed = true;
  if (saved && next.lastSavedAt !== null) {
    saves = [...saves, { seq: next.history.past.at(-1)?.seq ?? 0, at: next.lastSavedAt.getTime() }];
    changed = true;
  }
  if (!changed && dropped === clock.dropped) return clock;
  return { ...clock, steps, saves, dropped };
}

// -- The live clock over the editor store --------------------------------------

type EditorSnapshot = ReturnType<typeof useEditorStore.getState>;

function readingOf(state: EditorSnapshot): ClockReading {
  return {
    configId: state.configId,
    history: state.history,
    objectCount: state.objects.length,
    isSaving: state.isSaving,
    lastSavedAt: state.lastSavedAt,
  };
}

let liveClock: HistoryClock = startClock(readingOf(useEditorStore.getState()), Date.now());
const listeners = new Set<() => void>();

// It listens from the moment History's code loads (the v2 chrome's chunk), so
// steps made before History is first opened still carry their times.
useEditorStore.subscribe((state, previous) => {
  const next = advanceClock(liveClock, readingOf(previous), readingOf(state), Date.now());
  if (next === liveClock) return;
  liveClock = next;
  for (const listener of [...listeners]) listener();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The clock as it stands. */
export function historyClock(): HistoryClock {
  return liveClock;
}

/** The clock, for a component: re-renders when a step or a save is written down. */
export function useHistoryClock(): HistoryClock {
  return useSyncExternalStore(subscribe, historyClock, historyClock);
}

/** Tests only: start the clock again over the store as it is now. */
export function restartHistoryClock(now = Date.now()): void {
  liveClock = startClock(readingOf(useEditorStore.getState()), now);
  for (const listener of [...listeners]) listener();
}

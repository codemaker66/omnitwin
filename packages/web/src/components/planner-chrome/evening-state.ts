import { create } from "zustand";
import type { TimedAct } from "../../lib/evening-acts.js";
import { rememberHour } from "../../lib/evening-memory.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useHallTimeStore, type HallTimeMode } from "../../stores/hall-time-store.js";

// ---------------------------------------------------------------------------
// The evening's own state (T-674, v2 slice 10; spec 6.2).
//
// Whether the evening is open, the hour it opened from (Esc returns to it),
// whether it shows the whole day, and the event's acts as the planner read
// them once. The hour itself lives in the hall-time store, which lights the
// room; the hour kept for a layout lives on this device (evening-memory).
// The hour cannot join the layout's undo stack from here (editor-store is
// another lane's): the evening's own way back is Esc and "Back to 19:30".
// ---------------------------------------------------------------------------

export interface HeldHour {
  readonly mode: HallTimeMode;
  readonly at: number;
}

/** What the planner knows of the event's evening. */
export interface EveningSource {
  /** The acts with times (in this room or none), in the order they begin. */
  readonly acts: readonly TimedAct[];
  /** The event's start, when it has one. */
  readonly eventStart: number | null;
  /** Whether the layout was opened for an event (the address names one). */
  readonly eventLinked: boolean;
}

const NO_EVENT: EveningSource = { acts: [], eventStart: null, eventLinked: false };

interface EveningState {
  readonly open: boolean;
  /** The hour shown when the evening opened. */
  readonly from: HeldHour | null;
  readonly wholeDay: boolean;
  readonly source: EveningSource;
  readonly openEvening: () => void;
  /** Closes it and keeps the hour, remembered for this layout (Enter, Done, T, a click on the chip). */
  readonly keepEvening: () => void;
  /** Closes it and puts back the hour it opened from (Esc, "Back to 19:30"). */
  readonly returnEvening: () => void;
  readonly setWholeDay: (wholeDay: boolean) => void;
  readonly setSource: (source: EveningSource) => void;
}

/** The hour the hall shows now, as the store holds it. */
export function heldHour(): HeldHour {
  const { mode, at } = useHallTimeStore.getState();
  return { mode, at: mode === "now" ? Date.now() : at };
}

/** Shows an hour again: the clock, or a moment. */
export function restoreHour(hour: HeldHour): void {
  const time = useHallTimeStore.getState();
  if (hour.mode === "now") time.followNow();
  else time.setTime(hour.at);
}

/** Keeps the hour now shown as the one this layout opens at, on this device. */
export function rememberShownHour(): void {
  const configId = useEditorStore.getState().configId;
  if (configId === null) return;
  const { mode, at } = useHallTimeStore.getState();
  rememberHour(configId, mode === "now" ? { mode: "now" } : { mode: "set", at });
}

function sameSource(a: EveningSource, b: EveningSource): boolean {
  return a.eventStart === b.eventStart && a.eventLinked === b.eventLinked && a.acts.length === b.acts.length
    && a.acts.every((act, index) => {
      const other = b.acts[index];
      return other !== undefined && other.id === act.id && other.name === act.name && other.start === act.start && other.end === act.end;
    });
}

export const useEveningStore = create<EveningState>()((set, get) => ({
  open: false,
  from: null,
  wholeDay: false,
  source: NO_EVENT,
  openEvening: () => {
    if (get().open) return;
    set({ open: true, from: heldHour() });
  },
  keepEvening: () => {
    if (!get().open) return;
    const time = useHallTimeStore.getState();
    if (time.scrubbing) time.endScrub();
    rememberShownHour();
    set({ open: false, from: null });
  },
  returnEvening: () => {
    const { open, from } = get();
    if (!open) return;
    const time = useHallTimeStore.getState();
    if (time.scrubbing) time.endScrub();
    if (from !== null) restoreHour(from);
    set({ open: false, from: null });
  },
  setWholeDay: (wholeDay) => { set({ wholeDay }); },
  setSource: (source) => {
    if (!sameSource(get().source, source)) set({ source });
  },
}));

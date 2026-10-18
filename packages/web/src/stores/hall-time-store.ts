import { create } from "zustand";

// ---------------------------------------------------------------------------
// Hall time store — the moment the planner shows the Grand Hall at
//
// The hall is lit by the real sun and moon over Glassford Street. A plan opens
// at its event's start when it has one, and otherwise follows the clock
// ("now"); a planner can then set any moment and drag through the day. While
// the time is being dragged (`scrubbing`) the light follows every frame and
// the room's reflections wait for the hand to leave, as the planner's effects
// do.
//
// Presentation only: it lights the room, it never changes the layout, and
// nothing is kept between visits.
// ---------------------------------------------------------------------------

export type HallTimeMode = "now" | "set";

interface HallTimeState {
  readonly mode: HallTimeMode;
  /** The moment shown when `mode` is "set", epoch milliseconds. */
  readonly at: number;
  readonly scrubbing: boolean;
  /** The plan the hall was last opened for. */
  readonly openedFor: string | null;
  /** Whether a time has been chosen since it opened. */
  readonly chosen: boolean;
  /** Shows the hall at `at`; `scrubbing` while a hand is dragging the time. */
  readonly setTime: (at: number, scrubbing?: boolean) => void;
  /** The hand has left the time control. */
  readonly endScrub: () => void;
  /** Follow the clock again. */
  readonly followNow: () => void;
  /**
   * Opens the hall for a plan: at its event's start when it has one, else on
   * the clock. A plan opens once; an event start that arrives after it opened
   * still applies until a time has been chosen.
   */
  readonly openFor: (plan: string, eventStart: number | null) => void;
}

export const useHallTimeStore = create<HallTimeState>()((set) => ({
  mode: "now",
  at: Date.now(),
  scrubbing: false,
  openedFor: null,
  chosen: false,
  setTime: (at, scrubbing = false) => {
    if (!Number.isFinite(at)) return;
    set({ mode: "set", at, scrubbing, chosen: true });
  },
  endScrub: () => {
    set({ scrubbing: false });
  },
  followNow: () => {
    set({ mode: "now", at: Date.now(), scrubbing: false, chosen: true });
  },
  openFor: (plan, eventStart) => {
    set((state) => {
      const start = eventStart !== null && Number.isFinite(eventStart) ? eventStart : null;
      if (state.openedFor !== plan) {
        return start === null
          ? { openedFor: plan, chosen: false, mode: "now", at: Date.now(), scrubbing: false }
          : { openedFor: plan, chosen: false, mode: "set", at: start, scrubbing: false };
      }
      if (state.chosen || start === null || (state.mode === "set" && state.at === start)) return state;
      return { mode: "set", at: start };
    });
  },
}));

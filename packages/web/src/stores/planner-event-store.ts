import { create } from "zustand";

// ---------------------------------------------------------------------------
// The kind of event a layout is for, as the planner asks it on first open: a
// wedding, a business event, or something else. The engine reads it for the
// chair a new seat is set with (lib/furniture-defaults, plannerChairSlug);
// null until the planner has asked, when new seats keep the chair they had.
// ---------------------------------------------------------------------------

export type PlannerEventKind = "wedding" | "corporate" | "other";

interface PlannerEventState {
  readonly eventKind: PlannerEventKind | null;
  readonly setEventKind: (kind: PlannerEventKind | null) => void;
}

export const usePlannerEventStore = create<PlannerEventState>()((set) => ({
  eventKind: null,
  setEventKind: (eventKind) => { set({ eventKind }); },
}));

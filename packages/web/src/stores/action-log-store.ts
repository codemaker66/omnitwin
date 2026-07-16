import { create } from "zustand";
import type { Action } from "@omnitwin/types";
import { appendWithOverflow } from "../lib/action-log-overflow.js";

// G4 Slice 1: the in-session action log — the append-only record beside the
// bounded undo timeline. Config-scoped: switching configurations starts a
// fresh log (a boundary, not an eviction; slice 3 flushes to the server at
// this boundary). Overflow folds the oldest entries into one explicit
// `log.summarized` action via appendWithOverflow — never a silent drop.

export const MAX_ACTION_LOG_ENTRIES = 5000;
export const ACTION_LOG_FOLD_COUNT = 1000;

interface ActionLogState {
  readonly configId: string | null;
  readonly entries: readonly Action[];
}

interface ActionLogActions {
  /** Open (or keep) the log for a configuration. Idempotent per config. */
  readonly beginLog: (configId: string) => void;
  readonly append: (action: Action) => void;
  readonly reset: () => void;
}

const INITIAL_STATE: ActionLogState = { configId: null, entries: [] };

export const useActionLogStore = create<ActionLogState & ActionLogActions>()((set, get) => ({
  ...INITIAL_STATE,

  beginLog: (configId) => {
    if (get().configId === configId) return;
    set({ configId, entries: [] });
  },

  append: (action) => {
    set((state) => ({
      entries: appendWithOverflow(state.entries, action, {
        maxEntries: MAX_ACTION_LOG_ENTRIES,
        foldCount: ACTION_LOG_FOLD_COUNT,
        makeId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      }),
    }));
  },

  reset: () => { set(INITIAL_STATE); },
}));

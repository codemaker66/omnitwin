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
  /** How many entries (from the head) have been confirmed persisted by the
   *  API — the flusher's cursor. Config boundaries zero it. */
  readonly sentCount: number;
}

interface ActionLogActions {
  /** Open (or keep) the log for a configuration. Idempotent per config. */
  readonly beginLog: (configId: string) => void;
  readonly append: (action: Action) => void;
  /** Advance the persisted cursor by index. Monotone. Synchronous callers
   *  only — across an await the index frame can go stale (folds renumber);
   *  async acks must use markSentThrough. */
  readonly markSent: (count: number) => void;
  /** Advance the cursor through the entry with this action id, resolved
   *  against the CURRENT array — the only fold-safe ack for async flows. */
  readonly markSentThrough: (actionId: string) => void;
  readonly reset: () => void;
}

const INITIAL_STATE: ActionLogState = { configId: null, entries: [], sentCount: 0 };

export const useActionLogStore = create<ActionLogState & ActionLogActions>()((set, get) => ({
  ...INITIAL_STATE,

  beginLog: (configId) => {
    if (get().configId === configId) return;
    set({ configId, entries: [], sentCount: 0 });
  },

  append: (action) => {
    set((state) => {
      const entries = appendWithOverflow(state.entries, action, {
        maxEntries: MAX_ACTION_LOG_ENTRIES,
        foldCount: ACTION_LOG_FOLD_COUNT,
        makeId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      });
      // Overflow folding collapses the oldest N entries into one summary,
      // shifting every index the sent cursor points through. `collapsed` is
      // how many positions vanished; a cursor inside the folded span drops
      // to 0 so the summary (which now absorbs unsent material) ships too.
      const collapsed = state.entries.length + 1 - entries.length;
      const sentCount = collapsed <= 0
        ? state.sentCount
        : state.sentCount > collapsed
          ? state.sentCount - collapsed
          : 0;
      return { entries, sentCount };
    });
  },

  markSent: (count) => {
    set((state) => ({ sentCount: Math.max(state.sentCount, count) }));
  },

  markSentThrough: (actionId) => {
    // The async-safe ack: an in-flight flush's index frame goes stale the
    // moment a fold renumbers the log, so acks resolve the id AGAINST THE
    // CURRENT array. A vanished id (absorbed by a fold) no-ops — the
    // append-time adjustment already placed the cursor correctly.
    set((state) => {
      const index = state.entries.findIndex((entry) => entry.id === actionId);
      if (index < 0) return state;
      return { sentCount: Math.max(state.sentCount, index + 1) };
    });
  },

  reset: () => { set(INITIAL_STATE); },
}));

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Toast notification store
// ---------------------------------------------------------------------------

export interface Toast {
  readonly id: string;
  readonly message: string;
  readonly type: "success" | "error" | "info";
}

interface ToastState {
  readonly toasts: readonly Toast[];
  readonly addToast: (message: string, type: Toast["type"]) => void;
  readonly removeToast: (id: string) => void;
  /** Stop every toast's clock while somebody is reading: a pointer resting on
   *  the notifications, or the keyboard inside them. */
  readonly holdToasts: () => void;
  /** The reader has moved on: each toast still shown gets its full time again. */
  readonly releaseToasts: () => void;
}

/** How long a toast stays once nobody is reading it. */
const DISMISS_AFTER_MS = 4000;

let toastCounter = 0;
let held = false;

/** Active timers keyed by toast ID. Cleaned up on manual removal or unmount. */
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => {
  const startClock = (id: string): void => {
    const timer = setTimeout(() => {
      activeTimers.delete(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, DISMISS_AFTER_MS);
    activeTimers.set(id, timer);
  };

  return {
    toasts: [],

    addToast: (message, type) => {
      const id = `toast-${String(++toastCounter)}`;
      set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
      // One that arrives while another is being read waits with it.
      if (!held) startClock(id);
    },

    holdToasts: () => {
      held = true;
      for (const timer of activeTimers.values()) clearTimeout(timer);
      activeTimers.clear();
    },

    releaseToasts: () => {
      if (!held) return;
      held = false;
      for (const toast of get().toasts) startClock(toast.id);
    },

    removeToast: (id) => {
      // Clear pending auto-dismiss timer to prevent stale setState
      const timer = activeTimers.get(id);
      if (timer !== undefined) {
        clearTimeout(timer);
        activeTimers.delete(id);
      }
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  };
});

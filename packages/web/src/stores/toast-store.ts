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
}

let toastCounter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, type) => {
    const id = `toast-${String(++toastCounter)}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

import { create } from "zustand";

export type HistoricalRuntimePresentationState =
  | "inactive"
  | "unavailable"
  | "loading"
  | "ready"
  | "error";

export interface HistoricalRuntimePresentationStatus {
  readonly state: HistoricalRuntimePresentationState;
  readonly bindingId: string | null;
  readonly message: string | null;
}

interface HistoricalRuntimeStatusStore extends HistoricalRuntimePresentationStatus {
  readonly retryRevision: number;
  readonly publish: (status: HistoricalRuntimePresentationStatus) => void;
  readonly requestRetry: () => void;
}

export const useHistoricalRuntimeStatusStore = create<HistoricalRuntimeStatusStore>()((set) => ({
  state: "inactive",
  bindingId: null,
  message: null,
  retryRevision: 0,
  publish: (status) => { set(status); },
  requestRetry: () => { set((state) => ({ retryRevision: state.retryRevision + 1 })); },
}));

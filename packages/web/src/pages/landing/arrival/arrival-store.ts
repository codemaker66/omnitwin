import { create } from "zustand";

export type ArrivalPhase = "loading" | "flight" | "arrived" | "exploded" | "fallback";
export type ArrivalFailReason = "no-key" | "webgl" | "tiles" | "poster-tier";

interface ArrivalState {
  phase: ArrivalPhase;
  failReason: ArrivalFailReason | null;
  reducedMotion: boolean;
  tilesReady: () => void;
  flightDone: () => void;
  skip: () => void;
  explode: () => void;
  reassemble: () => void;
  fail: (reason: ArrivalFailReason) => void;
  setReducedMotion: (v: boolean) => void;
  reset: () => void;
}

const INITIAL = {
  phase: "loading" as ArrivalPhase,
  failReason: null as ArrivalFailReason | null,
  reducedMotion: false,
};

export const useArrivalStore = create<ArrivalState>((set) => ({
  ...INITIAL,
  tilesReady: () => {
    set((st) =>
      st.phase === "loading"
        ? { phase: st.reducedMotion ? "arrived" : "flight" }
        : st,
    );
  },
  flightDone: () => {
    set((st) => (st.phase === "flight" ? { phase: "arrived" } : st));
  },
  skip: () => {
    set((st) => (st.phase === "flight" ? { phase: "arrived" } : st));
  },
  explode: () => {
    set((st) => (st.phase === "arrived" ? { phase: "exploded" } : st));
  },
  reassemble: () => {
    set((st) => (st.phase === "exploded" ? { phase: "arrived" } : st));
  },
  fail: (reason) => {
    set((st) =>
      st.phase === "fallback" ? st : { phase: "fallback", failReason: reason },
    );
  },
  setReducedMotion: (v) => {
    set({ reducedMotion: v });
  },
  reset: () => {
    set({ ...INITIAL });
  },
}));

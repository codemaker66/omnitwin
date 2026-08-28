import { create } from "zustand";

export type ArrivalPhase = "loading" | "flight" | "arrived" | "exploded" | "fallback";
/**
 * Every way the flight can be knocked over, and — because `failReason` is the
 * ONLY record of which one happened once the photograph has taken over — one
 * reason per distinct DIAGNOSIS, never one per outcome.
 *
 * The first four arrive as DATA — a gate result, a tiles `load-error` or the
 * tiles stall watchdog, a `webglcontextlost` event — and are turned into
 * fail(reason) by whoever observes them.
 *
 * The last two both arrive as a THROWN EXCEPTION, and they are deliberately
 * NOT the same reason, because the two throws come out of different machinery
 * and have different remedies:
 *   - "crash"       — a throw out of React's own render or commit, caught by
 *                     ArrivalErrorBoundary (Task 12b). React has a component
 *                     stack for it; the subtree is torn down by React itself.
 *   - "frame-crash" — a throw out of a `useFrame` callback, caught by
 *                     arrival-frame-guard's useArrivalFrame. React never sees
 *                     it (the callback runs from R3F's rAF loop, not from the
 *                     reconciler), there is no component stack, and the guard
 *                     has to disable that one subscriber by hand.
 * They were briefly the same reason, which meant `failReason === "crash"` in
 * a Sentry breadcrumb or a dev console could not tell an operator which of
 * the two machines died — the exact question the reason exists to answer.
 * Their Sentry tags were already distinct ("ArrivalErrorBoundary" vs
 * "ArrivalFrameLoop"); this makes the store agree with them.
 */
export type ArrivalFailReason =
  | "no-key"
  | "webgl"
  | "tiles"
  | "poster-tier"
  | "crash"
  | "frame-crash";

// Keyed by the union itself, so BOTH directions are compile-checked: a
// missing member is an error (Record demands every key) and a stray member is
// an error (excess-property checking under `satisfies`). A bare `as const`
// array would only have caught the second, letting a newly-added reason slip
// past the exhaustive fallback test that consumes the list below.
const FAIL_REASON_KEYS = {
  "no-key": true,
  webgl: true,
  tiles: true,
  "poster-tier": true,
  crash: true,
  "frame-crash": true,
} as const satisfies Record<ArrivalFailReason, true>;

/** Every member of ArrivalFailReason. The one cast is Object.keys' own
 *  well-known widening to string[]; FAIL_REASON_KEYS above is what actually
 *  guarantees the contents. */
export const ARRIVAL_FAIL_REASONS = Object.keys(FAIL_REASON_KEYS) as readonly ArrivalFailReason[];

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

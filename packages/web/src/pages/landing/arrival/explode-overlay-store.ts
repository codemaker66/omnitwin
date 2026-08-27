import { create } from "zustand";

// -----------------------------------------------------------------------------
// explode-overlay-store — the bridge between ExplodedHall's per-frame,
// camera-projected Canvas state and ArrivalHero's DOM overlay (Arrival Task
// 10; extracted to its own module in review round 1).
//
// Split out of ExplodedHall.tsx so the `labels` subscription (which changes
// every unsettled frame, ~60/s while a storey is drifting) can live in a leaf
// DOM-only component (ArrivalHero.tsx's StoreyLabels) instead of forcing
// ArrivalHero ITSELF — and therefore the whole <Canvas> subtree passed as its
// children (GoogleTilesStage, FlightCamera, HallHandoff) — to re-render on
// every one of those frames. ArrivalHero now subscribes only to `settled`,
// which flips at most twice per explode/reassemble cycle; StoreyLabels reads
// `labels` and is the only thing that re-renders at frame rate, and its own
// subtree is a handful of positioned divs and buttons — cheap to redraw 60
// times a second, unlike a Canvas.
//
// A small DEDICATED store, isolated from useArrivalStore (arrival-store.ts):
// the phase machine has nothing to do with "where is a label on screen this
// frame," and this store has nothing to do with phase-transition legality.
// -----------------------------------------------------------------------------

export interface StoreyLabelPlacement {
  readonly bucket: number;
  readonly label: string;
  /** CSS pixel offset from the canvas's top-left corner. */
  readonly xPx: number;
  readonly yPx: number;
}

interface ExplodeOverlayState {
  /** True whenever there is no explode spring actively moving — the default
   *  (nothing has ever split) and every settled rest state alike. ArrivalHero
   *  reads this to decide whether the Canvas needs "always" frameloop. */
  readonly settled: boolean;
  /** Empty until progress first crosses ExplodedHall's LABEL_APPEAR_PROGRESS;
   *  always empty before the first split (nothing to label yet). */
  readonly labels: readonly StoreyLabelPlacement[];
  readonly reset: () => void;
}

const INITIAL_OVERLAY: Pick<ExplodeOverlayState, "settled" | "labels"> = {
  settled: true,
  labels: [],
};

/** Dedicated store bridging ExplodedHall's per-frame Canvas state to
 *  ArrivalHero's DOM overlay. Isolated from useArrivalStore on purpose — see
 *  the file header. */
export const useExplodeOverlayStore = create<ExplodeOverlayState>((set) => ({
  ...INITIAL_OVERLAY,
  reset: () => {
    set({ ...INITIAL_OVERLAY });
  },
}));

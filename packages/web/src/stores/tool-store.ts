import { create } from "zustand";
import type { PlannerTool } from "../lib/planner-tools.js";
import { useMeasurementStore } from "./measurement-store.js";
import { useMarkupStore } from "./markup-store.js";
import { useCatalogueStore } from "./catalogue-store.js";
import { usePlacementStore } from "./placement-store.js";
import { useSelectionStore } from "./selection-store.js";
import { useGuidelineStore } from "./guideline-store.js";

// ---------------------------------------------------------------------------
// Tool store — which tool the planner is holding. The only tool state
// (T-671 slice 5, F-01, F-02): the dock's Select, Add, Lay out, Measure and
// Draw, and the pill's Move, Rotate and Scale until the pill goes.
//
// Measure and Draw each keep their own working state where every consumer
// reads it (the tape's pending point in the measurement store, the strokes in
// the markup store). This store drives their active flags and mirrors them
// back, so a key, the pill, the toolbox or the deck's Done all agree without
// a second source of truth: when the deck puts the pen down, D picks it up
// again.
//
// Lives in its own file rather than cockpit-store deliberately: a tool is
// planner-stage state, not cockpit chrome state.
// ---------------------------------------------------------------------------

export interface ToolState {
  readonly activeTool: PlannerTool;
  /**
   * Live readout for the pill's value chip while a gesture is in flight —
   * "135°", "×1.25", "3.20 m" — or null when idle. Written by the gesture
   * code (SelectionSystem), rendered by the pill.
   */
  readonly liveValue: string | null;
  readonly setTool: (tool: PlannerTool) => void;
  readonly setLiveValue: (value: string | null) => void;
}

/** Picking up the pen puts down everything else in the hand. */
function clearTheHandForDrawing(): void {
  useCatalogueStore.getState().clearSelection();
  usePlacementStore.getState().clearGhost();
  useSelectionStore.getState().clearSelection();
  useGuidelineStore.getState().deactivate();
}

export const useToolStore = create<ToolState>()((set, get) => ({
  activeTool: "select",
  liveValue: null,

  setTool: (tool: PlannerTool) => {
    const previous = get().activeTool;
    if (previous === tool) return;
    if (tool === "draw") clearTheHandForDrawing();
    set({ activeTool: tool, liveValue: null });
    // Drive the tape's and the pen's flags; the mirror subscriptions below
    // are no-ops here because activeTool already matches when they fire.
    const measurement = useMeasurementStore.getState();
    if (tool === "measure" && !measurement.active) measurement.activate();
    if (tool !== "measure" && measurement.active) measurement.deactivate();
    const markup = useMarkupStore.getState();
    if (tool === "draw" && !markup.active) markup.setActive(true);
    if (tool !== "draw" && markup.active) markup.setActive(false);
  },

  setLiveValue: (value: string | null) => {
    if (get().liveValue === value) return;
    set({ liveValue: value });
  },
}));

// Mirrors: other paths flip the tape's or the pen's flag directly (the deck's
// Done and Select put the pen down). Whatever flips one, the store agrees.
// Guarded on the current tool so the setTool path above never loops here.
useMeasurementStore.subscribe((state, previous) => {
  if (state.active === previous.active) return;
  const tool = useToolStore.getState().activeTool;
  if (state.active && tool !== "measure") {
    useToolStore.setState({ activeTool: "measure", liveValue: null });
  } else if (!state.active && tool === "measure") {
    useToolStore.setState({ activeTool: "select", liveValue: null });
  }
});

useMarkupStore.subscribe((state, previous) => {
  if (state.active === previous.active) return;
  const tool = useToolStore.getState().activeTool;
  if (state.active && tool !== "draw") {
    useToolStore.getState().setTool("draw");
  } else if (!state.active && tool === "draw") {
    useToolStore.setState({ activeTool: "select", liveValue: null });
  }
});

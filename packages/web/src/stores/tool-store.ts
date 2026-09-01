import { create } from "zustand";
import type { PlannerTool } from "../lib/planner-tools.js";
import { useMeasurementStore } from "./measurement-store.js";

// ---------------------------------------------------------------------------
// Tool store — which hand the planner is holding.
//
// One authoritative mode for the pill: select | move | rotate | scale |
// measure. The measurement store keeps owning the tape's own state (pending
// point, laid measurements) because every existing consumer reads it there;
// this store drives its active flag and mirrors it back, so the M key, the
// pill and the old toolbox path all agree without a second source of truth.
//
// Lives in its own file rather than cockpit-store deliberately: the cockpit
// store is an active lane of the concurrent Command Centre session, and a
// tool mode is planner-stage state, not cockpit chrome state.
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

export const useToolStore = create<ToolState>()((set, get) => ({
  activeTool: "select",
  liveValue: null,

  setTool: (tool: PlannerTool) => {
    const previous = get().activeTool;
    if (previous === tool) return;
    set({ activeTool: tool, liveValue: null });
    // Drive the tape's flag; the mirror subscription below is a no-op here
    // because activeTool already matches by the time it fires.
    const measurement = useMeasurementStore.getState();
    if (tool === "measure" && !measurement.active) measurement.activate();
    if (tool !== "measure" && measurement.active) measurement.deactivate();
  },

  setLiveValue: (value: string | null) => {
    if (get().liveValue === value) return;
    set({ liveValue: value });
  },
}));

// Mirror: legacy paths flip the measurement store directly (the M key used
// to, VerticalToolbox still does when another panel opens). Whatever flips
// it, the pill must agree. Guarded on the current tool so the setTool path
// above never loops through here.
useMeasurementStore.subscribe((state) => {
  const tool = useToolStore.getState().activeTool;
  if (state.active && tool !== "measure") {
    useToolStore.setState({ activeTool: "measure", liveValue: null });
  } else if (!state.active && tool === "measure") {
    useToolStore.setState({ activeTool: "select", liveValue: null });
  }
});

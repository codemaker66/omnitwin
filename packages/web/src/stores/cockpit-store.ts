import { create } from "zustand";
import {
  COCKPIT_OVERLAY_KEYS,
  type CockpitLayerMode,
  type CockpitMode,
  type CockpitOverlayKey,
} from "../lib/cockpit-modes.js";

type OverlayVisibility = Record<CockpitOverlayKey, boolean>;

function allOverlaysOn(): OverlayVisibility {
  return COCKPIT_OVERLAY_KEYS.reduce<OverlayVisibility>((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as OverlayVisibility);
}

interface CockpitState {
  readonly activeMode: CockpitMode;
  readonly layerMode: CockpitLayerMode;
  readonly overlayVisibility: OverlayVisibility;
  readonly selectedPhaseId: string | null;
  readonly setMode: (mode: CockpitMode) => void;
  readonly setLayerMode: (mode: CockpitLayerMode) => void;
  readonly toggleOverlay: (key: CockpitOverlayKey) => void;
  readonly setOverlay: (key: CockpitOverlayKey, visible: boolean) => void;
  readonly selectPhase: (phaseId: string | null) => void;
  readonly reset: () => void;
}

export const useCockpitStore = create<CockpitState>((set) => ({
  activeMode: "design",
  layerMode: "hybrid",
  overlayVisibility: allOverlaysOn(),
  selectedPhaseId: null,
  setMode: (mode) => { set({ activeMode: mode }); },
  setLayerMode: (mode) => { set({ layerMode: mode }); },
  toggleOverlay: (key) => {
    set((state) => ({
      overlayVisibility: { ...state.overlayVisibility, [key]: !state.overlayVisibility[key] },
    }));
  },
  setOverlay: (key, visible) => {
    set((state) => ({
      overlayVisibility: { ...state.overlayVisibility, [key]: visible },
    }));
  },
  selectPhase: (phaseId) => { set({ selectedPhaseId: phaseId }); },
  reset: () => {
    set({
      activeMode: "design",
      layerMode: "hybrid",
      overlayVisibility: allOverlaysOn(),
      selectedPhaseId: null,
    });
  },
}));

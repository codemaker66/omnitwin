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

const DEFAULT_RUNTIME_ASSET_STATUS = "Procedural layer / no signed capture";

/** A world-anchored evidence beam: a gold light column the scene raises over the
 *  exact point a simulated conflict / review marker concerns, so abstract
 *  evidence becomes spatial. */
export interface CockpitBeam {
  readonly anchor: readonly [number, number, number];
  readonly label: string;
  readonly tone: "review" | "info";
}

/** A request to ease the camera so it frames a floor point (X/Z render units).
 *  The nonce lets the in-canvas focus component react to repeated clicks on the
 *  same point. */
export interface CockpitFocusRequest {
  readonly x: number;
  readonly z: number;
  readonly nonce: number;
}

interface CockpitState {
  readonly activeMode: CockpitMode;
  readonly layerMode: CockpitLayerMode;
  readonly overlayVisibility: OverlayVisibility;
  readonly selectedPhaseId: string | null;
  readonly runtimeAssetStatus: string;
  readonly layersOpen: boolean;
  readonly beam: CockpitBeam | null;
  readonly focusRequest: CockpitFocusRequest | null;
  readonly setMode: (mode: CockpitMode) => void;
  readonly setLayerMode: (mode: CockpitLayerMode) => void;
  readonly toggleOverlay: (key: CockpitOverlayKey) => void;
  readonly setOverlay: (key: CockpitOverlayKey, visible: boolean) => void;
  readonly selectPhase: (phaseId: string | null) => void;
  readonly setRuntimeAssetStatus: (status: string) => void;
  readonly toggleLayers: () => void;
  readonly setLayersOpen: (open: boolean) => void;
  readonly setBeam: (beam: CockpitBeam | null) => void;
  readonly clearBeam: () => void;
  readonly requestFocus: (x: number, z: number) => void;
  readonly reset: () => void;
}

export const useCockpitStore = create<CockpitState>((set) => ({
  activeMode: "design",
  layerMode: "hybrid",
  overlayVisibility: allOverlaysOn(),
  selectedPhaseId: null,
  runtimeAssetStatus: DEFAULT_RUNTIME_ASSET_STATUS,
  layersOpen: false,
  beam: null,
  focusRequest: null,
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
  setRuntimeAssetStatus: (status) => { set({ runtimeAssetStatus: status }); },
  toggleLayers: () => { set((state) => ({ layersOpen: !state.layersOpen })); },
  setLayersOpen: (open) => { set({ layersOpen: open }); },
  setBeam: (beam) => { set({ beam }); },
  clearBeam: () => { set({ beam: null }); },
  requestFocus: (x, z) => {
    set((state) => ({ focusRequest: { x, z, nonce: (state.focusRequest?.nonce ?? 0) + 1 } }));
  },
  reset: () => {
    set({
      activeMode: "design",
      layerMode: "hybrid",
      overlayVisibility: allOverlaysOn(),
      selectedPhaseId: null,
      runtimeAssetStatus: DEFAULT_RUNTIME_ASSET_STATUS,
      layersOpen: false,
      beam: null,
      focusRequest: null,
    });
  },
}));

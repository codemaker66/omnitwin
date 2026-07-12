import { create } from "zustand";
import {
  COCKPIT_OVERLAY_KEYS,
  type CockpitLayerMode,
  type CockpitMode,
  type CockpitOverlayKey,
} from "../lib/cockpit-modes.js";
import { CAPTURED_LAYER_FALLBACK_STATUS } from "../lib/runtime-package-resolution.js";
import type { RoomResolvePhase } from "../lib/room-resolve-model.js";

type OverlayVisibility = Record<CockpitOverlayKey, boolean>;

function allOverlaysOn(): OverlayVisibility {
  return COCKPIT_OVERLAY_KEYS.reduce<OverlayVisibility>((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as OverlayVisibility);
}

// Until a runtime package resolves, the honest state IS the atelier fallback —
// the chip must never open on a blank or stale claim.
const DEFAULT_RUNTIME_ASSET_STATUS = CAPTURED_LAYER_FALLBACK_STATUS;

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

/** The room-resolve choreography (CARD A2): written by the canvas as chunks
 *  stream, read by the quiet caption and the stage's honesty attribute. */
export interface CockpitRoomResolve {
  readonly phase: RoomResolvePhase;
  readonly loadedChunks: number;
  readonly totalChunks: number;
}

const DEFAULT_ROOM_RESOLVE: CockpitRoomResolve = {
  phase: "ink",
  loadedChunks: 0,
  totalChunks: 0,
};

interface CockpitState {
  readonly activeMode: CockpitMode;
  readonly layerMode: CockpitLayerMode;
  readonly overlayVisibility: OverlayVisibility;
  readonly selectedPhaseId: string | null;
  readonly runtimeAssetStatus: string;
  readonly roomResolve: CockpitRoomResolve;
  readonly layersOpen: boolean;
  readonly beam: CockpitBeam | null;
  readonly focusRequest: CockpitFocusRequest | null;
  readonly cameraInteractionActive: boolean;
  /** Planned guest count driving the Flow lens simulation (null → builder default). */
  readonly plannedGuestCount: number | null;
  /** Arrival-window minutes for the Flow lens scenario (phase duration). */
  readonly flowArrivalMinutes: number;
  readonly setMode: (mode: CockpitMode) => void;
  readonly setLayerMode: (mode: CockpitLayerMode) => void;
  readonly toggleOverlay: (key: CockpitOverlayKey) => void;
  readonly setOverlay: (key: CockpitOverlayKey, visible: boolean) => void;
  readonly selectPhase: (phaseId: string | null) => void;
  readonly setPlannedGuestCount: (count: number | null) => void;
  readonly setFlowArrivalMinutes: (minutes: number) => void;
  readonly setRuntimeAssetStatus: (status: string) => void;
  readonly setRoomResolve: (resolve: CockpitRoomResolve) => void;
  readonly toggleLayers: () => void;
  readonly setLayersOpen: (open: boolean) => void;
  readonly setBeam: (beam: CockpitBeam | null) => void;
  readonly clearBeam: () => void;
  readonly requestFocus: (x: number, z: number) => void;
  readonly setCameraInteractionActive: (active: boolean) => void;
  readonly reset: () => void;
}

export const useCockpitStore = create<CockpitState>((set) => ({
  activeMode: "design",
  layerMode: "hybrid",
  overlayVisibility: allOverlaysOn(),
  selectedPhaseId: null,
  runtimeAssetStatus: DEFAULT_RUNTIME_ASSET_STATUS,
  roomResolve: DEFAULT_ROOM_RESOLVE,
  layersOpen: false,
  beam: null,
  focusRequest: null,
  cameraInteractionActive: false,
  plannedGuestCount: null,
  flowArrivalMinutes: 30,
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
  setPlannedGuestCount: (count) => { set({ plannedGuestCount: count }); },
  setFlowArrivalMinutes: (minutes) => { set({ flowArrivalMinutes: minutes }); },
  setRuntimeAssetStatus: (status) => { set({ runtimeAssetStatus: status }); },
  setRoomResolve: (resolve) => {
    set((state) => (
      state.roomResolve.phase === resolve.phase
        && state.roomResolve.loadedChunks === resolve.loadedChunks
        && state.roomResolve.totalChunks === resolve.totalChunks
        ? state
        : { roomResolve: resolve }
    ));
  },
  toggleLayers: () => { set((state) => ({ layersOpen: !state.layersOpen })); },
  setLayersOpen: (open) => { set({ layersOpen: open }); },
  setBeam: (beam) => { set({ beam }); },
  clearBeam: () => { set({ beam: null }); },
  requestFocus: (x, z) => {
    set((state) => ({ focusRequest: { x, z, nonce: (state.focusRequest?.nonce ?? 0) + 1 } }));
  },
  setCameraInteractionActive: (active) => {
    set({ cameraInteractionActive: active });
  },
  reset: () => {
    set({
      activeMode: "design",
      layerMode: "hybrid",
      overlayVisibility: allOverlaysOn(),
      selectedPhaseId: null,
      runtimeAssetStatus: DEFAULT_RUNTIME_ASSET_STATUS,
      roomResolve: DEFAULT_ROOM_RESOLVE,
      layersOpen: false,
      beam: null,
      focusRequest: null,
      cameraInteractionActive: false,
      plannedGuestCount: null,
      flowArrivalMinutes: 30,
    });
  },
}));

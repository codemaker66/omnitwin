import { create } from "zustand";
import {
  COCKPIT_OVERLAY_KEYS,
  type CockpitLayerMode,
  type CockpitMode,
  type CockpitOverlayKey,
} from "../lib/cockpit-modes.js";
import { CAPTURED_LAYER_FALLBACK_STATUS } from "../lib/runtime-package-resolution.js";
import type { PlannerRoomIdentity } from "../lib/planner-layer-composition.js";
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

export type ExactGrandHallRuntimeStatus = "pending" | "verified" | "failed";
export type GrandHallScenePresentation = "appearance" | "structural-proxy";
export type GrandHallCameraMode = "orbit" | "human" | "dollhouse";

export interface ExactGrandHallRuntimeKey {
  readonly spaceId: string;
  readonly venueId: string;
  readonly roomSlug: "grand-hall";
  readonly runtimePackageId: string;
}

/** Collision-free React/store identity for one exact room, venue, and package. */
export function serializeExactGrandHallRuntimeKey(key: ExactGrandHallRuntimeKey): string {
  return JSON.stringify([key.spaceId, key.venueId, key.runtimePackageId]);
}

export interface ExactGrandHallRuntimeLifecycle {
  readonly key: ExactGrandHallRuntimeKey;
  readonly status: ExactGrandHallRuntimeStatus;
  readonly attemptNonce: number;
}

export const EXACT_GRAND_HALL_RUNTIME_LABELS: Readonly<Record<ExactGrandHallRuntimeStatus, string>> = {
  pending: "Captured Grand Hall selected — verifying exact protected bytes",
  verified: "Exact captured Grand Hall source verified — all 11 members attached",
  failed: "Exact captured Grand Hall source failed verification — architectural layer hidden",
};

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

function samePlannerRoomIdentity(
  left: PlannerRoomIdentity | null,
  right: PlannerRoomIdentity | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return left.spaceId === right.spaceId
    && left.venueId === right.venueId
    && left.roomSlug === right.roomSlug
    && left.status === right.status
    && left.venueSlug === right.venueSlug;
}

function sameExactGrandHallRuntimeKey(
  left: ExactGrandHallRuntimeKey,
  right: ExactGrandHallRuntimeKey,
): boolean {
  return serializeExactGrandHallRuntimeKey(left) === serializeExactGrandHallRuntimeKey(right);
}

interface CockpitState {
  readonly activeMode: CockpitMode;
  readonly layerMode: CockpitLayerMode;
  readonly grandHallPresentation: GrandHallScenePresentation;
  readonly grandHallCameraMode: GrandHallCameraMode;
  readonly overlayVisibility: OverlayVisibility;
  readonly selectedPhaseId: string | null;
  readonly runtimeAssetStatus: string;
  /** Exact capture lifecycle, bound to one room and immutable package. */
  readonly exactGrandHallRuntime: ExactGrandHallRuntimeLifecycle | null;
  /** Monotonic reset boundary for same-package retries and callback arrivals. */
  readonly exactGrandHallAttemptNonce: number;
  /** Venue-API identity for the room currently resolved by the runtime hook. */
  readonly plannerRoomIdentity: PlannerRoomIdentity | null;
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
  readonly setGrandHallPresentation: (presentation: GrandHallScenePresentation) => void;
  readonly setGrandHallCameraMode: (mode: GrandHallCameraMode) => void;
  readonly toggleOverlay: (key: CockpitOverlayKey) => void;
  readonly setOverlay: (key: CockpitOverlayKey, visible: boolean) => void;
  readonly selectPhase: (phaseId: string | null) => void;
  readonly setPlannedGuestCount: (count: number | null) => void;
  readonly setFlowArrivalMinutes: (minutes: number) => void;
  readonly setRuntimeAssetStatus: (status: string) => void;
  readonly beginExactGrandHallRuntime: (key: ExactGrandHallRuntimeKey) => number;
  readonly completeExactGrandHallRuntime: (
    key: ExactGrandHallRuntimeKey,
    attemptNonce: number,
    status: Exclude<ExactGrandHallRuntimeStatus, "pending">,
  ) => void;
  readonly clearExactGrandHallRuntime: (
    key?: ExactGrandHallRuntimeKey,
    attemptNonce?: number,
  ) => void;
  readonly setPlannerRoomIdentity: (identity: PlannerRoomIdentity | null) => void;
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
  grandHallPresentation: "appearance",
  grandHallCameraMode: "orbit",
  overlayVisibility: allOverlaysOn(),
  selectedPhaseId: null,
  runtimeAssetStatus: DEFAULT_RUNTIME_ASSET_STATUS,
  exactGrandHallRuntime: null,
  exactGrandHallAttemptNonce: 0,
  plannerRoomIdentity: null,
  roomResolve: DEFAULT_ROOM_RESOLVE,
  layersOpen: false,
  beam: null,
  focusRequest: null,
  cameraInteractionActive: false,
  plannedGuestCount: null,
  flowArrivalMinutes: 30,
  setMode: (mode) => { set({ activeMode: mode }); },
  setLayerMode: (mode) => { set({ layerMode: mode }); },
  setGrandHallPresentation: (grandHallPresentation) => { set({ grandHallPresentation }); },
  setGrandHallCameraMode: (grandHallCameraMode) => { set({ grandHallCameraMode }); },
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
  setRuntimeAssetStatus: (status) => {
    set({ runtimeAssetStatus: status, exactGrandHallRuntime: null });
  },
  beginExactGrandHallRuntime: (key) => {
    let nextAttemptNonce = 0;
    set((state) => {
      const attemptNonce = state.exactGrandHallAttemptNonce + 1;
      nextAttemptNonce = attemptNonce;
      return {
        exactGrandHallRuntime: { key, status: "pending", attemptNonce },
        exactGrandHallAttemptNonce: attemptNonce,
        runtimeAssetStatus: EXACT_GRAND_HALL_RUNTIME_LABELS.pending,
      };
    });
    return nextAttemptNonce;
  },
  completeExactGrandHallRuntime: (key, attemptNonce, status) => {
    set((state) => {
      if (
        state.exactGrandHallRuntime === null
        || !sameExactGrandHallRuntimeKey(state.exactGrandHallRuntime.key, key)
        || state.exactGrandHallRuntime.attemptNonce !== attemptNonce
      ) {
        return state;
      }
      return {
        exactGrandHallRuntime: {
          key,
          status,
          attemptNonce: state.exactGrandHallRuntime.attemptNonce,
        },
        runtimeAssetStatus: EXACT_GRAND_HALL_RUNTIME_LABELS[status],
      };
    });
  },
  clearExactGrandHallRuntime: (key, attemptNonce) => {
    set((state) => {
      if (
        state.exactGrandHallRuntime === null
        || (key !== undefined && !sameExactGrandHallRuntimeKey(state.exactGrandHallRuntime.key, key))
        || (attemptNonce !== undefined && state.exactGrandHallRuntime.attemptNonce !== attemptNonce)
      ) {
        return state;
      }
      return {
        exactGrandHallRuntime: null,
        runtimeAssetStatus: DEFAULT_RUNTIME_ASSET_STATUS,
      };
    });
  },
  setPlannerRoomIdentity: (identity) => {
    set((state) => (
      samePlannerRoomIdentity(state.plannerRoomIdentity, identity)
        ? state
        : { plannerRoomIdentity: identity }
    ));
  },
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
      grandHallPresentation: "appearance",
      grandHallCameraMode: "orbit",
      overlayVisibility: allOverlaysOn(),
      selectedPhaseId: null,
      runtimeAssetStatus: DEFAULT_RUNTIME_ASSET_STATUS,
      exactGrandHallRuntime: null,
      exactGrandHallAttemptNonce: 0,
      plannerRoomIdentity: null,
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

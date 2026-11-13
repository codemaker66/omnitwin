import { create } from "zustand";
import type { HallMoodName } from "../components/grand-hall/hall-mood.js";
import type { HallSurfacesProgress } from "../lib/room-resolve-model.js";

// ---------------------------------------------------------------------------
// Hall view store — how the planner is looking at and lighting the room
//
// The mood (daylight, evening, candlelight) is presentation only: it changes
// light, not the layout, and is remembered on this device so a planner who
// works by candlelight comes back to it. Daylight, the light the hall was
// scanned in, is where everyone starts. View requests are one-shot: the
// scene's director glides the camera to the requested framing and clears it.
// The drawn hall reports its surveyed surfaces arriving, for the caption.
// ---------------------------------------------------------------------------

export type HallViewPreset = "plan" | "room" | "walk";

export interface HallViewRequest {
  readonly preset: HallViewPreset;
  readonly nonce: number;
}

export interface HallStageRequest {
  /** CSS px at the canvas's top that stay dark, above the hall's walls. */
  readonly skyPx: number;
}

export type HallStagePhase = "off" | "arriving" | "held";

interface HallViewState {
  readonly mood: HallMoodName;
  readonly viewRequest: HallViewRequest | null;
  /** The framing last asked for or opened in, shown pressed until the camera is turned by hand. */
  readonly activePreset: HallViewPreset | null;
  /** The drawn hall's surveyed surfaces arriving, while it is mounted. */
  readonly surfaces: HallSurfacesProgress | null;
  /**
   * Set by a planner screen that shows the hall as a stage (hall-stage.ts):
   * its Room view is that one picture, and `skyPx` at the canvas's top are
   * kept dark for the screen's own words. Null for every other screen.
   */
  readonly stage: HallStageRequest | null;
  /** Where the stage is: not in use, the camera on its way to it, or held. */
  readonly stagePhase: HallStagePhase;
  readonly setStage: (stage: HallStageRequest | null) => void;
  readonly setStagePhase: (phase: HallStagePhase) => void;
  readonly setMood: (mood: HallMoodName) => void;
  readonly requestView: (preset: HallViewPreset) => void;
  readonly clearViewRequest: (nonce: number) => void;
  readonly setActivePreset: (preset: HallViewPreset | null) => void;
  readonly startSurfaces: (total: number) => void;
  readonly settleSurface: (loaded: boolean) => void;
  readonly endSurfaces: () => void;
}

const MOOD_STORAGE_KEY = "venviewer.hall-mood.v1";
const MOODS: readonly HallMoodName[] = ["daylight", "evening", "candlelight"];

function readStoredMood(): HallMoodName {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(MOOD_STORAGE_KEY);
    return MOODS.find((mood) => mood === stored) ?? "daylight";
  } catch {
    return "daylight";
  }
}

export const useHallViewStore = create<HallViewState>()((set, get) => ({
  mood: readStoredMood(),
  viewRequest: null,
  activePreset: "room",
  surfaces: null,
  stage: null,
  stagePhase: "off",
  setStage: (stage) => {
    if (get().stage?.skyPx !== stage?.skyPx) set(stage === null ? { stage, stagePhase: "off" } : { stage });
  },
  setStagePhase: (stagePhase) => {
    if (get().stagePhase !== stagePhase) set({ stagePhase });
  },
  setMood: (mood) => {
    try { window.localStorage.setItem(MOOD_STORAGE_KEY, mood); } catch { /* storage is a convenience */ }
    set({ mood });
  },
  requestView: (preset) => {
    set({ viewRequest: { preset, nonce: (get().viewRequest?.nonce ?? 0) + 1 }, activePreset: preset });
  },
  clearViewRequest: (nonce) => {
    if (get().viewRequest?.nonce === nonce) set({ viewRequest: null });
  },
  setActivePreset: (preset) => { set({ activePreset: preset }); },
  startSurfaces: (total) => { set({ surfaces: { total, loaded: 0, failed: 0 } }); },
  settleSurface: (loaded) => {
    const surfaces = get().surfaces;
    if (surfaces === null || surfaces.loaded + surfaces.failed >= surfaces.total) return;
    set({ surfaces: loaded ? { ...surfaces, loaded: surfaces.loaded + 1 } : { ...surfaces, failed: surfaces.failed + 1 } });
  },
  endSurfaces: () => { set({ surfaces: null }); },
}));

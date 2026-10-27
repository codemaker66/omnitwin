import { create } from "zustand";
import type { TouchMode } from "../lib/touch-arbiter.js";

// ---------------------------------------------------------------------------
// Touch gesture store — what the touch arbiter (lib/touch-arbiter.ts, driven
// by components/SelectionSystem.tsx) decided the finger on the room is. The
// camera rig holds its orbit while the finger may yet place, lift or tap, and
// the placement ghost follows the finger while it places.
// ---------------------------------------------------------------------------

export interface FingerPoint {
  readonly x: number;
  readonly y: number;
}

interface TouchGestureState {
  readonly mode: TouchMode;
  /** The first finger, CSS px, while it places or lifts. */
  readonly finger: FingerPoint | null;
  /** Whether the orbit must ignore the finger's moves. */
  readonly cameraHeld: boolean;
  /** When the last gesture the arbiter owned ended, ms on the performance clock. */
  readonly endedAt: number;
  readonly setMode: (mode: TouchMode) => void;
  readonly setFinger: (finger: FingerPoint | null) => void;
  readonly holdCamera: (held: boolean) => void;
  /** The gesture ended at `at`: the arbiter is idle and the camera is free. */
  readonly end: (at: number) => void;
}

export const useTouchGestureStore = create<TouchGestureState>()((set, get) => ({
  mode: "idle",
  finger: null,
  cameraHeld: false,
  endedAt: -Infinity,

  setMode: (mode) => {
    if (get().mode !== mode) set({ mode });
  },

  setFinger: (finger) => {
    const current = get().finger;
    if (current === finger || (current !== null && finger !== null && current.x === finger.x && current.y === finger.y)) return;
    set({ finger });
  },

  holdCamera: (held) => {
    if (get().cameraHeld !== held) set({ cameraHeld: held });
  },

  end: (at) => {
    set({ mode: "idle", finger: null, cameraHeld: false, endedAt: at });
  },
}));

/** Whether the arbiter owns the finger on the room: it may place, lift or tap, so the camera stands aside. */
export function touchOwnsFinger(mode: TouchMode): boolean {
  return mode === "pending" || mode === "place" || mode === "lift";
}

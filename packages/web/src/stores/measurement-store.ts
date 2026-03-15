import { create } from "zustand";
import type { Point3 } from "../lib/measurement.js";
import { computeRealDistance } from "../lib/measurement.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A completed measurement between two points. */
export interface Measurement {
  readonly id: number;
  readonly pointA: Point3;
  readonly pointB: Point3;
  /** Real-world distance in metres (already divided by RENDER_SCALE). */
  readonly distance: number;
}

export interface MeasurementState {
  /** Whether the measurement tool is active (listening for clicks). */
  readonly active: boolean;
  /** First point placed (waiting for second click). Null if not started. */
  readonly pendingPoint: Point3 | null;
  /** All completed measurements. */
  readonly measurements: readonly Measurement[];
  /** Auto-increment ID counter. */
  readonly nextId: number;
  /** Activate the measurement tool. */
  readonly activate: () => void;
  /** Deactivate the measurement tool and clear pending point. */
  readonly deactivate: () => void;
  /** Toggle tool active/inactive. */
  readonly toggle: () => void;
  /** Place a point. If pending exists, completes a measurement. */
  readonly placePoint: (point: Point3) => void;
  /** Cancel the current pending point (Escape). */
  readonly cancelPending: () => void;
  /** Remove a measurement by ID. */
  readonly removeMeasurement: (id: number) => void;
  /** Clear all measurements. */
  readonly clearAll: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useMeasurementStore = create<MeasurementState>()((set, get) => ({
  active: false,
  pendingPoint: null,
  measurements: [],
  nextId: 1,

  activate: () => {
    set({ active: true });
  },

  deactivate: () => {
    set({ active: false, pendingPoint: null });
  },

  toggle: () => {
    const state = get();
    if (state.active) {
      set({ active: false, pendingPoint: null });
    } else {
      set({ active: true });
    }
  },

  placePoint: (point: Point3) => {
    const state = get();
    if (!state.active) return;

    if (state.pendingPoint === null) {
      // First click — set pending
      set({ pendingPoint: point });
    } else {
      // Second click — complete measurement
      const distance = computeRealDistance(state.pendingPoint, point);
      const measurement: Measurement = {
        id: state.nextId,
        pointA: state.pendingPoint,
        pointB: point,
        distance,
      };
      set({
        measurements: [...state.measurements, measurement],
        pendingPoint: null,
        nextId: state.nextId + 1,
      });
    }
  },

  cancelPending: () => {
    set({ pendingPoint: null });
  },

  removeMeasurement: (id: number) => {
    const state = get();
    set({
      measurements: state.measurements.filter((m) => m.id !== id),
    });
  },

  clearAll: () => {
    set({ measurements: [], pendingPoint: null });
  },
}));

import { create } from "zustand";
import { type LightingFixtureFamily } from "../lib/photometrics.js";

// ---------------------------------------------------------------------------
// lighting-rig-store — the planner's editable lighting rig (Epic 6 Lighting lens).
//
// The catalogue has no placeable lighting fixtures yet, so the rig is specified
// here as fixture FAMILY → COUNT, exactly how a lighting designer blocks out a
// rig before fixtures are hung. The DMX patch + power estimate (lib/dmx.ts) are
// derived from this. Starts from a small, clearly-editable STARTER rig (like the
// Costs lens's example rates) so the lens is illustrative on first open.
// ---------------------------------------------------------------------------

export type RigCounts = Record<LightingFixtureFamily, number>;

const EMPTY_COUNTS: RigCounts = {
  profile: 0,
  spot: 0,
  wash: 0,
  fresnel: 0,
  par: 0,
  "beam-hybrid": 0,
  "batten-strip": 0,
  "blinder-strobe": 0,
};

/** A modest illustrative starter rig — edit to your lighting design. */
export const DEFAULT_RIG_COUNTS: RigCounts = {
  ...EMPTY_COUNTS,
  par: 12,
  wash: 4,
  profile: 2,
};

interface RigState {
  readonly counts: RigCounts;
}

interface RigActions {
  readonly setCount: (family: LightingFixtureFamily, count: number) => void;
  readonly reset: () => void;
  readonly clear: () => void;
}

export const useLightingRigStore = create<RigState & RigActions>((set) => ({
  counts: { ...DEFAULT_RIG_COUNTS },
  setCount: (family, count) => {
    set((state) => ({
      counts: { ...state.counts, [family]: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0 },
    }));
  },
  reset: () => { set({ counts: { ...DEFAULT_RIG_COUNTS } }); },
  clear: () => { set({ counts: { ...EMPTY_COUNTS } }); },
}));

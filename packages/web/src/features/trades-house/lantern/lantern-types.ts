// -----------------------------------------------------------------------------
// lantern-types — the contract of the Lantern, the quiz's raw-WebGL2
// compositor (grown from pages/landing/FlameCanvas.tsx). One canvas, one
// program per scene, aria-hidden, a CSS fallback always rendered beneath.
// It never imports `three`; the Hall ceremonies (hall/) are the only Three.js
// in the quiz and are never mounted together with the Lantern.
// -----------------------------------------------------------------------------
import type { LanternProgramId, StageLight } from "../stage/stage-manifest.js";

export type { LanternProgramId };

export interface LanternRipple {
  /** Normalised stage coordinates, 0..1, y down. */
  readonly x: number;
  readonly y: number;
  /** Seconds on the Lantern clock when the ripple started. */
  readonly startedAt: number;
}

export const MAX_RIPPLES = 8;

/** Everything the scene may change per frame; the Lantern owns the clock. */
export interface LanternUniforms {
  /** Pointer in normalised stage coordinates and its speed (px per ms, 0 when idle). */
  readonly pointer: { readonly x: number; readonly y: number; readonly speed: number };
  /** The lantern flame's intensity spring (1 calm, below 1 guttered, at most 1.15). */
  readonly lanternIntensity: number;
  /** 0 at scene entry, 1 when the last light has left the river: the wear of the night, never a verdict. */
  readonly dusk: number;
  readonly ripples: readonly LanternRipple[];
  /** The tableau's lights for the water to reflect (at most 16). */
  readonly lights: readonly StageLight[];
  readonly reducedMotion: boolean;
}

export interface LanternHandle {
  readonly programId: LanternProgramId;
  setPointer(x: number, y: number, speed: number): void;
  /** A poke on the lantern: guts the flame by `strength` (0..1); the spring rights it. */
  gutter(strength: number): void;
  /** A poke on the water: one expanding ring from (x, y). */
  ripple(x: number, y: number): void;
  setDusk(value: number): void;
  setLights(lights: readonly StageLight[]): void;
  /** Fill per frame at the current DPR, for the budget test. */
  readonly fillMegapixels: number;
  /** True once the tripwire has dropped the DPR ladder. */
  readonly degraded: boolean;
}

export interface LanternProps {
  readonly program: LanternProgramId;
  /** The loop runs only while the scene is on screen and the tab visible. */
  readonly active: boolean;
  readonly reducedMotion: boolean;
  readonly lights: readonly StageLight[];
  readonly onHandle?: (handle: LanternHandle | null) => void;
  readonly className?: string;
}

/** Pure budget state stepped per frame (lantern-budget.ts). */
export interface LanternBudgetState {
  readonly dpr: number;
  readonly particles: number;
  readonly overBudgetFrames: number;
  readonly degraded: boolean;
}

export const LANTERN_FRAME_BUDGET_MS = 20;
export const LANTERN_TRIPWIRE_FRAMES = 30;
export const LANTERN_MAX_FILL_MEGAPIXELS = 6;

// -----------------------------------------------------------------------------
// run-types — the shape of the three small stores the stage needs now
// (prefs, pokes, stage tier). The full run machine (Appendix A section 7) is a
// later card; scenes 2 to 12 keep the page's existing state in this slice.
// -----------------------------------------------------------------------------
import type { PokeableState } from "../react/react-types.js";

export type DeviceTierName = "poster" | "low" | "medium" | "high";

export interface PrefsState {
  readonly voice: boolean;
  readonly sound: boolean;
  readonly captions: boolean;
  /** The visible "Still" switch: reduced motion regardless of the OS setting. */
  readonly still: boolean;
}

export const DEFAULT_PREFS: PrefsState = { voice: true, sound: false, captions: true, still: false };

export type PersistedFacts = Readonly<Record<string, number | boolean>>;

export interface PokesState {
  /** Per scene, per prop. Cleared on BEGIN. */
  readonly byScene: Readonly<Record<number, Readonly<Record<string, PokeableState>>>>;
  /** The run-persistent facts from the persistence table (section 5): chainSwing, initial, and the rest. */
  readonly persisted: PersistedFacts;
}

export interface StageTierInput {
  readonly classifiedTier: DeviceTierName;
  readonly coarsePointer: boolean;
  readonly innerWidth: number;
  readonly maxTouchPoints: number;
  readonly deviceMemoryGb: number | null;
}

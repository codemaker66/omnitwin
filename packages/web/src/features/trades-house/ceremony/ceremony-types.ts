// -----------------------------------------------------------------------------
// ceremony-types — the choice ceremony's contract (spec section 5): desktop
// one tap commits; phone lifts the option into a held card (lead, body, cost
// read through the live region) and a second tap commits. Every beat writes a
// data-beat-at stamp from the rAF clock so the reduced-motion e2e can assert
// timestamps within 10%.
// -----------------------------------------------------------------------------
export type CeremonyPhase = "speaking" | "open" | "held" | "committed" | "replying" | "latched";

export interface CeremonyOption {
  /** The seat (0..3) as displayed; the page maps it back to the canonical index. */
  readonly seat: number;
  readonly lead: string;
  readonly body: string;
  readonly cost: string;
}

export interface CeremonyCallbacks {
  /** t0: pointer-down or Enter keydown on an option: the paper touch at -18 dB, scale(0.97). */
  readonly onPress: (seat: number) => void;
  /** Phone only: the held card opened for a seat. */
  readonly onHold: (seat: number) => void;
  /** t1: the commit: the seal strikes on `strike`, the cue on the same frame. */
  readonly onCommit: (seat: number) => void;
  readonly onRelease: () => void;
  readonly onContinue: () => void;
}

export interface BeatStamp {
  readonly name: "press" | "commit" | "retreat" | "reply" | "ledger" | "latch" | "continue";
  readonly atMs: number;
}

/** Timings from section 5, in ms after the commit. */
export const CEREMONY_TIMING = {
  pressScaleMs: 100,
  retreatDelayMs: 40,
  retreatStaggerMs: 40,
  replyDelayMs: 120,
  replyRisePx: 8,
  retreatDimOpacity: 0.42,
} as const;

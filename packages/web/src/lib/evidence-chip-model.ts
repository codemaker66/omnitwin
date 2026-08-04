import type { AssetEvidenceStatus, TruthVerificationState } from "@omnitwin/types";

// CARD A4 (G2b) — the chip grammar's pure core (01 §9 · 02 §3).
// One vocabulary for every evidence chip in the product: four canonical
// states + four provenance badges. Components render these; surfaces map
// their existing API shapes onto them with the functions below. Kept pure
// so the mapping is unit-testable without rendering.

export type EvidenceChipState = "current" | "review-required" | "stale" | "missing";
export type ProvenanceBadge = "operator" | "machine-checked" | "ai" | "simulated";

/** 01 §9 canonical display names — these strings may not drift. */
export const EVIDENCE_CHIP_LABELS: Readonly<Record<EvidenceChipState, string>> = {
  current: "Current",
  "review-required": "Review required",
  stale: "Stale",
  missing: "Missing",
};

export const PROVENANCE_BADGE_LABELS: Readonly<Record<ProvenanceBadge, string>> = {
  operator: "Operator",
  "machine-checked": "Machine checked",
  ai: "AI",
  simulated: "Simulated",
};

/**
 * Maps the API's asset evidence status onto the canonical chip states.
 * - `human_reviewed` is the only status that reads Current.
 * - `rejected` maps to Review required (reviewed-and-refused evidence still
 *   needs review work; it must never read Current, and Missing would
 *   overstate absence — the evidence exists, it just failed).
 * - Staleness overrides any present status; absence (null) is Missing.
 */
export function evidenceChipStateFromAssetStatus(
  status: AssetEvidenceStatus | null,
  options?: { readonly stale?: boolean },
): EvidenceChipState {
  if (status === null) return "missing";
  if (options?.stale === true) return "stale";
  return status === "human_reviewed" ? "current" : "review-required";
}

/**
 * Maps the cockpit truth rail's deliberately-cautious two-tone row model
 * onto the canonical states. The rail's data never claims more than
 * Current/Review required today; deeper rows adopt the full grammar when
 * their models carry staleness explicitly.
 */
export function evidenceChipStateFromTruthTone(tone: "neutral" | "warning"): EvidenceChipState {
  // Switch (not ternary) so tsc's exhaustiveness checking trips when the
  // rail's tone union grows a third member (reviewer MEDIUM).
  switch (tone) {
    case "neutral":
      return "current";
    case "warning":
      return "review-required";
  }
}

/**
 * Maps the truth-mode verification vocabulary onto the canonical states.
 * `expired` is the one true Stale; unverified/contested/suppressed evidence
 * all still need review work — none may read Current, and none is Missing
 * (the evidence exists in every case).
 */
export function evidenceChipStateFromVerificationState(
  state: TruthVerificationState,
): EvidenceChipState {
  switch (state) {
    case "verified":
      return "current";
    case "expired":
      return "stale";
    case "unverified":
    case "contested":
    case "suppressed":
      return "review-required";
  }
}

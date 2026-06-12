import type { LayoutStyle } from "@omnitwin/types";
import {
  comfortBandLabel,
  computeCapacityIntelligence,
  type CapacityIntelligence,
} from "./layout-capacity.js";

// ---------------------------------------------------------------------------
// Proposal capacity guidance — T-429 surfaced through T-427 phase 5.
//
// Reuses the planner's planning-grade capacity engine (layout-capacity.ts)
// to generate a SAFE capacity note for proposals: scoped comfort estimates
// with human-review-required wording instead of static room numbers. The
// generated text must always pass the types-level claim guard — it never
// contains occupancy/fire/compliance certainty wording.
// ---------------------------------------------------------------------------

export const CAPACITY_STYLE_LABELS: Readonly<Record<LayoutStyle, string>> = {
  ceremony: "ceremony seating",
  "dinner-rounds": "seated dinner on round tables",
  "dinner-banquet": "banquet dining on long tables",
  theatre: "theatre-style seating",
  boardroom: "boardroom seating",
  cabaret: "cabaret seating",
  cocktail: "standing reception",
  custom: "custom layout",
};

/** Planning-grade guidance for a room area + requested guests + style. */
export function buildProposalCapacityGuidance(
  floorAreaM2: number,
  guestCount: number,
  layoutStyle: LayoutStyle,
): CapacityIntelligence {
  return computeCapacityIntelligence(floorAreaM2, guestCount, layoutStyle);
}

/**
 * SAFE capacity note for the proposal payload. Always ends with the
 * human-review disclosure; never emits legal/fire/occupancy certainty
 * wording, so it passes the proposal claim guard by construction.
 */
export function buildProposalCapacityNote(
  spaceName: string,
  intel: CapacityIntelligence,
): string {
  const style = CAPACITY_STYLE_LABELS[intel.layoutStyle];
  const base = `${spaceName}: comfortable for around ${String(intel.comfortableCapacity)} guests as ${style}`;
  const fit = intel.plannedSeats > 0
    ? ` — for ${String(intel.plannedSeats)} guests: ${comfortBandLabel(intel.band)}`
    : "";
  return `${base}${fit}. Planning estimate only, human review required — not a legal occupancy or fire-capacity figure.`;
}

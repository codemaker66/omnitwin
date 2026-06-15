import type { LayoutStyle } from "@omnitwin/types";
import {
  comfortBandLabel,
  computeCapacityIntelligence,
  type CapacityIntelligence,
} from "./layout-capacity.js";

/**
 * Standing SAFE disclosure for every public/client capacity surface. It pairs
 * with the planning-grade estimate so the number is never read as an authority
 * figure.
 */
export const CAPACITY_GUIDANCE_DISCLOSURE =
  "Planning estimate — human review required; final capacity confirmed by the venue team.";

// ---------------------------------------------------------------------------
// Proposal capacity guidance — T-429 surfaced through T-427 phase 5.
//
// Reuses the planner's planning-grade capacity engine (layout-capacity.ts)
// to generate a SAFE capacity note for proposals: scoped comfort estimates
// with human-review-required wording instead of static room numbers. The
// generated text must always pass the types-level claim guard.
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

/** Structured SAFE capacity guidance for public/client surfaces (landing,
 *  enquiry). The proposal payload uses {@link buildProposalCapacityNote}; this
 *  is the lighter, room-name-free shape those surfaces render directly. */
export interface CapacityGuidance {
  readonly intel: CapacityIntelligence;
  readonly styleLabel: string;
  /** Short comfortable-capacity summary, e.g. "around 140 guests as seated dinner on round tables". */
  readonly summary: string;
  /** Comfort-band fit phrase keyed to the requested guest count, or null when none was given. */
  readonly fit: string | null;
  /** Standing SAFE disclosure ({@link CAPACITY_GUIDANCE_DISCLOSURE}). */
  readonly disclosure: string;
}

/**
 * SAFE capacity guidance for a room area + requested guests + style. Reuses
 * the planner's capacity engine and the proposal style labels so every
 * surface speaks the same planning-grade language and keeps venue confirmation
 * visible.
 */
export function buildCapacityGuidance(
  floorAreaM2: number,
  guestCount: number,
  layoutStyle: LayoutStyle,
): CapacityGuidance {
  const intel = computeCapacityIntelligence(floorAreaM2, guestCount, layoutStyle);
  const styleLabel = CAPACITY_STYLE_LABELS[layoutStyle];
  return {
    intel,
    styleLabel,
    summary: `around ${String(intel.comfortableCapacity)} guests as ${styleLabel}`,
    fit: intel.plannedSeats > 0 ? comfortBandLabel(intel.band) : null,
    disclosure: CAPACITY_GUIDANCE_DISCLOSURE,
  };
}

/**
 * SAFE capacity note for the proposal payload. Always ends with the
 * human-review disclosure, so it passes the proposal claim guard by
 * construction.
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
  return `${base}${fit}. Planning estimate only; human review required; final capacity confirmed by the venue team.`;
}

import type { LayoutStyle } from "@omnitwin/types";
import {
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
// for the proposal composer's staff-only estimate. What goes into the
// client's capacity note is the venue's published figure (see below).
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

// Public and client surfaces (the planner's enquiry form, the Share lens, the
// proposal's capacity note) never show floor area ÷ generic spacing: they state
// the venue's published figure through planner-truth.ts (redteam fix-first 1;
// publishedCapacityNote). The guidance above is only the staff estimate the
// proposal composer shows beside it, labelled "Estimate at generic spacing".

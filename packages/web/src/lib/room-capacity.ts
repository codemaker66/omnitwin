import type { LayoutStyle } from "@omnitwin/types";
import { computeCapacityIntelligence } from "./layout-capacity.js";

// ---------------------------------------------------------------------------
// room-capacity — floor area divided by generic spacing, for every style.
//
// This is arithmetic, not the room's capacity. On the Grand Hall's 220.5 m² it
// gives 339 standing where the venue publishes 250, so it is shown only to
// venue staff, labelled "estimate at generic spacing", and never as a verdict:
// there is no fits / tight / over here any more, and no "tight" count at the
// minimum allowance (490 standing) at all (redteam fix-first 1). The venue's
// published figures live in planner-truth.ts and lead every surface.
// ---------------------------------------------------------------------------

/** Short, client-call-friendly style names (the sentence-form CAPACITY_STYLE_LABELS
 *  read poorly in a dense comparison). */
export const STYLE_SHORT_LABELS: Readonly<Record<LayoutStyle, string>> = {
  cocktail: "Reception (standing)",
  theatre: "Theatre",
  ceremony: "Ceremony rows",
  cabaret: "Cabaret",
  "dinner-rounds": "Banquet (rounds)",
  "dinner-banquet": "Long tables",
  boardroom: "Boardroom",
  custom: "Custom",
};

/** The event styles a planner compares for a client (custom is not a preset). */
export const PLANNER_LAYOUT_STYLES: readonly LayoutStyle[] = [
  "cocktail", "theatre", "ceremony", "cabaret", "dinner-rounds", "dinner-banquet", "boardroom",
];

export interface RoomStyleEstimate {
  readonly style: LayoutStyle;
  readonly label: string;
  /** Floor area ÷ the style's generic comfortable allowance, rounded down. */
  readonly estimate: number;
}

/**
 * Every style's estimate at generic spacing for a floor area, sorted most to
 * fewest so the range reads at a glance. Pure; staff-only arithmetic.
 */
export function roomStyleEstimates(floorAreaM2: number): RoomStyleEstimate[] {
  const rows = PLANNER_LAYOUT_STYLES.map((style): RoomStyleEstimate => ({
    style,
    label: STYLE_SHORT_LABELS[style],
    estimate: computeCapacityIntelligence(floorAreaM2, 0, style).comfortableCapacity,
  }));
  return rows.sort((a, b) => b.estimate - a.estimate);
}

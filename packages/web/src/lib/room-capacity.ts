import type { LayoutStyle } from "@omnitwin/types";
import { computeCapacityIntelligence } from "./layout-capacity.js";

// ---------------------------------------------------------------------------
// room-capacity — the room's planning-grade capacity in EVERY event style.
//
// A venue planner's #1 call answer is "does your group fit, and how?". This
// reuses the capacity engine (layout-capacity.ts) to give every event style's
// comfortable + tight capacity at once, plus a live fit verdict against a guest
// count — so the planner can flip a client between "reception / theatre / banquet"
// in a glance instead of inferring a single style from what's on the floor.
//
// SAFE: planning-grade comfort estimates only — NOT an occupancy or fire limit.
// Human review before any capacity is communicated. (Same vocabulary as
// layout-capacity.ts.)
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

export type StyleFit = "fits" | "tight" | "over" | "unknown";

export interface RoomStyleCapacity {
  readonly style: LayoutStyle;
  readonly label: string;
  /** Guests the room comfortably seats in this style. */
  readonly comfortable: number;
  /** Tightest planning capacity before over-capacity. */
  readonly tight: number;
  /** Verdict for a guest count: within comfortable / within tight / beyond / no count. */
  readonly fit: StyleFit;
}

function fitFor(guestCount: number | null, comfortable: number, tight: number): StyleFit {
  if (guestCount === null || guestCount <= 0) return "unknown";
  if (guestCount <= comfortable) return "fits";
  if (guestCount <= tight) return "tight";
  return "over";
}

/**
 * Every event style's comfortable/tight capacity for a room, with a fit verdict
 * against a guest count. Sorted most-to-fewest so the range reads at a glance.
 * Pure; planning-grade only.
 */
export function roomStyleCapacities(floorAreaM2: number, guestCount: number | null): RoomStyleCapacity[] {
  const rows = PLANNER_LAYOUT_STYLES.map((style): RoomStyleCapacity => {
    const intel = computeCapacityIntelligence(floorAreaM2, 0, style);
    return {
      style,
      label: STYLE_SHORT_LABELS[style],
      comfortable: intel.comfortableCapacity,
      tight: intel.tightCapacity,
      fit: fitFor(guestCount, intel.comfortableCapacity, intel.tightCapacity),
    };
  });
  return rows.sort((a, b) => b.comfortable - a.comfortable);
}

export function styleFitLabel(fit: StyleFit): string {
  switch (fit) {
    case "fits": return "Comfortable";
    case "tight": return "Tight";
    case "over": return "Over";
    case "unknown": return "";
  }
}

/** A SAFE one-line summary of which styles suit a guest count, or null when no
 *  count is set. e.g. "150 guests — comfortable for Reception, Theatre; tight for
 *  Cabaret; over for Boardroom." */
export function styleFitSummary(styles: readonly RoomStyleCapacity[], guestCount: number | null): string | null {
  if (guestCount === null || guestCount <= 0) return null;
  const fits = styles.filter((s) => s.fit === "fits");
  const tight = styles.filter((s) => s.fit === "tight");
  const over = styles.filter((s) => s.fit === "over");
  const parts: string[] = [];
  if (fits.length > 0) parts.push(`comfortable for ${fits.map((s) => s.label).join(", ")}`);
  if (tight.length > 0) parts.push(`tight for ${tight.map((s) => s.label).join(", ")}`);
  if (over.length > 0) parts.push(`over for ${over.map((s) => s.label).join(", ")}`);
  if (parts.length === 0) return `${String(guestCount)} guests — no style within planning capacity for this room.`;
  return `${String(guestCount)} guests — ${parts.join("; ")}.`;
}

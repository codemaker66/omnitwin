import type { LayoutStyle } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Layout capacity intelligence — planning-grade only.
//
// Answers the venue's #1 sales question ("is this room comfortable for N
// guests?") from real floor geometry and the placed seating, using published
// event-planning space-per-guest guidance.
//
// SAFE LANGUAGE: every number here is a PLANNING-GRADE comfort estimate. It is
// NOT a legal occupancy figure, NOT a fire-capacity limit, and NOT an
// authoritative measured-capacity statement. Human review is required before any capacity is
// communicated to a client. The labels below stay strictly inside that
// vocabulary.
// ---------------------------------------------------------------------------

/** Square metres of floor the planning guidance allocates per guest. */
export interface SpacePerGuestStandard {
  /** Comfortable allowance — the figure capacity is sized against. */
  readonly comfortableM2: number;
  /** Tightest allowance still inside planning guidance; below this is over-capacity. */
  readonly minimumM2: number;
}

// Planning-grade space-per-guest guidance by seating style. These are common
// event-planning rules of thumb (circulation + service space included), not
// regulatory occupancy factors.
export const LAYOUT_SPACE_PER_GUEST: Readonly<Record<LayoutStyle, SpacePerGuestStandard>> = {
  ceremony: { comfortableM2: 0.9, minimumM2: 0.6 },
  "dinner-rounds": { comfortableM2: 1.5, minimumM2: 1.1 },
  "dinner-banquet": { comfortableM2: 1.3, minimumM2: 1.0 },
  theatre: { comfortableM2: 0.8, minimumM2: 0.55 },
  boardroom: { comfortableM2: 2.3, minimumM2: 1.8 },
  cabaret: { comfortableM2: 1.8, minimumM2: 1.4 },
  cocktail: { comfortableM2: 0.65, minimumM2: 0.45 },
  custom: { comfortableM2: 1.2, minimumM2: 0.9 },
};

export function spacePerGuestStandard(style: LayoutStyle): SpacePerGuestStandard {
  return LAYOUT_SPACE_PER_GUEST[style];
}

export type ComfortBand = "open" | "spacious" | "comfortable" | "tight" | "over-capacity";

export interface CapacityIntelligence {
  readonly floorAreaM2: number;
  readonly layoutStyle: LayoutStyle;
  readonly plannedSeats: number;
  /** Guests the room comfortably seats in this style (floor area ÷ comfortable allowance). */
  readonly comfortableCapacity: number;
  /** Tightest planning capacity (floor area ÷ minimum allowance). Beyond this is over-capacity. */
  readonly tightCapacity: number;
  /** Floor area actually allocated per planned seat, or null when no seats are placed. */
  readonly spacePerGuestM2: number | null;
  /** Planned seats as a percentage of comfortable capacity (0 when capacity is 0). */
  readonly utilizationPercent: number;
  readonly band: ComfortBand;
}

/** Lightweight seating tally the planner already derives from placed items. */
export interface SeatingCounts {
  readonly roundTables: number;
  readonly banquetTables: number;
  readonly chairs: number;
}

/**
 * Best-effort seating style from what's on the floor, used when the planner
 * has no explicit layout style selected. Rounds → dinner-rounds, trestle rows
 * → dinner-banquet, chairs alone → theatre, nothing seating-like → custom.
 */
export function inferSeatingStyle(counts: SeatingCounts): LayoutStyle {
  if (counts.roundTables > 0) return "dinner-rounds";
  if (counts.banquetTables > 0) return "dinner-banquet";
  if (counts.chairs > 0) return "theatre";
  return "custom";
}

function comfortBand(spacePerGuestM2: number | null, standard: SpacePerGuestStandard): ComfortBand {
  if (spacePerGuestM2 === null) return "open";
  if (spacePerGuestM2 >= standard.comfortableM2 * 1.4) return "spacious";
  if (spacePerGuestM2 >= standard.comfortableM2) return "comfortable";
  if (spacePerGuestM2 >= standard.minimumM2) return "tight";
  return "over-capacity";
}

export function computeCapacityIntelligence(
  floorAreaM2: number,
  plannedSeats: number,
  layoutStyle: LayoutStyle,
): CapacityIntelligence {
  const area = Number.isFinite(floorAreaM2) && floorAreaM2 > 0 ? floorAreaM2 : 0;
  const seats = Number.isFinite(plannedSeats) && plannedSeats > 0 ? Math.floor(plannedSeats) : 0;
  const standard = spacePerGuestStandard(layoutStyle);

  const comfortableCapacity = area > 0 ? Math.floor(area / standard.comfortableM2) : 0;
  const tightCapacity = area > 0 ? Math.floor(area / standard.minimumM2) : 0;
  const spacePerGuestM2 = seats > 0 && area > 0 ? area / seats : null;
  const utilizationPercent = comfortableCapacity > 0
    ? Math.round((seats / comfortableCapacity) * 100)
    : 0;

  return {
    floorAreaM2: area,
    layoutStyle,
    plannedSeats: seats,
    comfortableCapacity,
    tightCapacity,
    spacePerGuestM2,
    utilizationPercent,
    band: comfortBand(spacePerGuestM2, standard),
  };
}

/** SAFE, human-readable summary of a comfort band. Never a legal/fire claim. */
export function comfortBandLabel(band: ComfortBand): string {
  switch (band) {
    case "open":
      return "Open floor — no seating placed yet";
    case "spacious":
      return "Spacious — generous room per guest";
    case "comfortable":
      return "Comfortable — within planning guidance";
    case "tight":
      return "Tight — below comfortable spacing, review circulation";
    case "over-capacity":
      return "Over comfortable planning capacity — review (not a legal or fire limit)";
  }
}

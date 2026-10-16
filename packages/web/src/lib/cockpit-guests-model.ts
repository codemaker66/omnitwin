import type { LayoutStyle } from "@omnitwin/types";
import { CAPACITY_STYLE_LABELS } from "./proposal-capacity-note.js";
import { plannerLayoutStyle, publishedFormatForStyle, type PublishedFormat } from "./planner-truth.js";
import { roomStyleEstimates, type RoomStyleEstimate } from "./room-capacity.js";
import { seatingCountsFromPlacedItems } from "./seating-counts.js";
import type { PlacedItem } from "./placement.js";

// ---------------------------------------------------------------------------
// cockpit-guests-model — what the Guests lens can say from the LIVE layout.
//
//   1. Seat sufficiency — is there a placed seat for every intended guest?
//      (placed chairs against the planner's own guest count: arithmetic on the
//      planner's inputs, not an occupancy question)
//   2. Which of the venue's published formats the layout on the floor is read
//      against (standing reception for "cocktail", dinner for both dinner
//      styles), so the lens can lead with the venue's own figure.
//   3. For venue staff only, floor area ÷ generic spacing in every style,
//      labelled as an estimate and never as the room's capacity.
//
// Pure: no React, no API. There is deliberately no comfort band, fit chip or
// "within guidance" verdict here any more: a capacity is the venue's to state
// (redteam fix-first 1).
// ---------------------------------------------------------------------------

export type SeatStatus = "unset" | "short" | "exact" | "spare";

export interface GuestsCapacityModel {
  /** The planner's intended headcount, or null when not set. */
  readonly guestCount: number | null;
  /** Physical seats on the floor (placed chairs). */
  readonly seatsProvided: number;
  /** seatsProvided − guestCount; null when no guest count is set. */
  readonly seatBalance: number | null;
  readonly seatStatus: SeatStatus;
  /** The style read from what is on the floor. */
  readonly layoutStyle: LayoutStyle;
  /** That style in words: "seated dinner on round tables". */
  readonly styleLabel: string;
  /** The venue's published format the layout is read against, or null when
   *  the venue publishes no figure for this style. */
  readonly publishedFormat: PublishedFormat | null;
  readonly floorAreaM2: number;
  /** Staff-only arithmetic: floor area ÷ generic spacing, every style. */
  readonly estimates: readonly RoomStyleEstimate[];
}

export interface GuestsModelInput {
  readonly placedItems: readonly PlacedItem[];
  /** Real room width in metres (NOT render-space). */
  readonly roomWidthM: number;
  /** Real room length in metres (NOT render-space). */
  readonly roomLengthM: number;
  /** Planner-set intended headcount, or null. */
  readonly guestCount: number | null;
}

function seatStatusFor(guestCount: number | null, seatBalance: number | null): SeatStatus {
  if (guestCount === null || seatBalance === null) return "unset";
  if (seatBalance < 0) return "short";
  if (seatBalance === 0) return "exact";
  return "spare";
}

/** What the Guests lens can say about the live layout. Pure. */
export function buildGuestsCapacityModel(input: GuestsModelInput): GuestsCapacityModel {
  const seating = seatingCountsFromPlacedItems(input.placedItems);
  const seatsProvided = seating.chairs;
  const layoutStyle = plannerLayoutStyle(input.placedItems);
  const floorAreaM2 = Number.isFinite(input.roomWidthM) && Number.isFinite(input.roomLengthM)
    ? Math.max(0, input.roomWidthM) * Math.max(0, input.roomLengthM)
    : 0;

  const guestCount = input.guestCount !== null && Number.isFinite(input.guestCount) && input.guestCount > 0
    ? Math.floor(input.guestCount)
    : null;
  const seatBalance = guestCount !== null ? seatsProvided - guestCount : null;

  return {
    guestCount,
    seatsProvided,
    seatBalance,
    seatStatus: seatStatusFor(guestCount, seatBalance),
    layoutStyle,
    styleLabel: CAPACITY_STYLE_LABELS[layoutStyle],
    publishedFormat: publishedFormatForStyle(layoutStyle),
    floorAreaM2,
    estimates: roomStyleEstimates(floorAreaM2),
  };
}

/** Short sentence describing seat sufficiency for the panel. */
export function seatSufficiencyLabel(model: GuestsCapacityModel): string {
  if (model.seatStatus === "unset") {
    return `${String(model.seatsProvided)} seats placed. Set a guest count to check every guest has a seat.`;
  }
  const guests = String(model.guestCount ?? 0);
  if (model.seatStatus === "short") {
    const short = Math.abs(model.seatBalance ?? 0);
    return `Short ${String(short)} ${short === 1 ? "seat" : "seats"} for ${guests} guests — add seating or reduce the count.`;
  }
  if (model.seatStatus === "spare") {
    const spare = model.seatBalance ?? 0;
    return `Every guest seated, with ${String(spare)} spare ${spare === 1 ? "seat" : "seats"} for ${guests} guests.`;
  }
  return `Exactly ${guests} seats for ${guests} guests — every guest seated.`;
}

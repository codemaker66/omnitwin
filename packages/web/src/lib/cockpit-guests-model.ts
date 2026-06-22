import {
  comfortBandLabel,
  computeCapacityIntelligence,
  inferSeatingStyle,
  type ComfortBand,
} from "./layout-capacity.js";
import { CAPACITY_STYLE_LABELS } from "./proposal-capacity-note.js";
import { seatingCountsFromPlacedItems } from "./seating-counts.js";
import type { PlacedItem } from "./placement.js";

// ---------------------------------------------------------------------------
// cockpit-guests-model — the Guests lens's two real questions, answered from
// the LIVE layout (Epic 0, fourth real lens panel):
//
//   1. Seat sufficiency — is there a placed seat for every intended guest?
//      (placed chairs vs the planner's guest count)
//   2. Room comfort — is the room comfortable for that headcount, in the
//      seating style on the floor? (the planning-grade capacity engine)
//
// Pure: no React, no API. Reuses the same seating tally and capacity engine the
// planner HUD and proposal surfaces use, so every surface reads the room the
// same way. SAFE: comfort figures are planning-grade estimates — human review
// required; never an occupancy or fire-capacity statement. The panel keeps that
// wording visible.
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
  /** Headcount the room is assessed against (guestCount ?? seatsProvided). */
  readonly assessedHeadcount: number;
  readonly styleLabel: string;
  readonly floorAreaM2: number;
  /** Guests the room comfortably seats in this style. */
  readonly comfortableCapacity: number;
  /** Tightest planning capacity before over-capacity. */
  readonly tightCapacity: number;
  readonly band: ComfortBand;
  readonly bandLabel: string;
  /** Assessed headcount as a percentage of comfortable capacity. */
  readonly utilizationPercent: number;
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

/** Answer the Guests lens's seat-sufficiency + room-comfort questions. Pure. */
export function buildGuestsCapacityModel(input: GuestsModelInput): GuestsCapacityModel {
  const seating = seatingCountsFromPlacedItems(input.placedItems);
  const seatsProvided = seating.chairs;
  const style = inferSeatingStyle(seating);
  const floorAreaM2 = Number.isFinite(input.roomWidthM) && Number.isFinite(input.roomLengthM)
    ? Math.max(0, input.roomWidthM) * Math.max(0, input.roomLengthM)
    : 0;

  const normalisedGuestCount = input.guestCount !== null && Number.isFinite(input.guestCount) && input.guestCount > 0
    ? Math.floor(input.guestCount)
    : null;
  const assessedHeadcount = normalisedGuestCount ?? seatsProvided;
  const intel = computeCapacityIntelligence(floorAreaM2, assessedHeadcount, style);
  const seatBalance = normalisedGuestCount !== null ? seatsProvided - normalisedGuestCount : null;

  return {
    guestCount: normalisedGuestCount,
    seatsProvided,
    seatBalance,
    seatStatus: seatStatusFor(normalisedGuestCount, seatBalance),
    assessedHeadcount,
    styleLabel: CAPACITY_STYLE_LABELS[style],
    floorAreaM2: intel.floorAreaM2,
    comfortableCapacity: intel.comfortableCapacity,
    tightCapacity: intel.tightCapacity,
    band: intel.band,
    bandLabel: comfortBandLabel(intel.band),
    utilizationPercent: intel.utilizationPercent,
  };
}

/** Short SAFE sentence describing seat sufficiency for the panel. */
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

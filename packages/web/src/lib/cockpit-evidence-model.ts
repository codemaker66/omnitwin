import { buildGuestsCapacityModel, seatSufficiencyLabel } from "./cockpit-guests-model.js";
import { minExitsAdb, requiredExitWidthMmAdb } from "./egress.js";
import type { PlacedItem } from "./placement.js";

// ---------------------------------------------------------------------------
// cockpit-evidence-model — the Layout Evidence Pack (Epic 0 Evidence lens).
//
// A purpose-fit check list assembled from the LIVE layout: does the seating
// match the headcount, is the room comfortable, and what does egress guidance
// indicate for that many people. Each check carries an honest status and a SAFE
// detail. Composes the same Guests capacity model and the egress planning engine
// the rest of the app uses — no new judgement is invented here.
//
// SAFE: every figure is a PLANNING-GRADE estimate for human review. The egress
// check states what the guidance INDICATES for the headcount; it never confirms
// the room's actual exits (the venue technical pack is the authority for that).
// Nothing here is a fire, occupancy, or compliance determination.
// ---------------------------------------------------------------------------

export type EvidenceStatus = "pass" | "attention" | "review" | "info";

export interface EvidenceCheck {
  readonly id: string;
  readonly label: string;
  readonly status: EvidenceStatus;
  readonly detail: string;
}

export interface EvidencePack {
  readonly checks: readonly EvidenceCheck[];
  readonly passCount: number;
  readonly attentionCount: number;
  readonly reviewCount: number;
  /** Headcount the pack is assessed against (guest count or placed chairs). */
  readonly assessedHeadcount: number;
  readonly hasGuestCount: boolean;
}

export interface EvidenceModelInput {
  readonly placedItems: readonly PlacedItem[];
  /** Real room width in metres (NOT render-space). */
  readonly roomWidthM: number;
  /** Real room length in metres (NOT render-space). */
  readonly roomLengthM: number;
  /** Planner-set intended headcount, or null. */
  readonly guestCount: number | null;
}

function seatingCheck(seatStatus: string, detail: string): EvidenceCheck {
  const status: EvidenceStatus =
    seatStatus === "short" ? "review"
      : seatStatus === "unset" ? "info"
        : "pass";
  return { id: "seating", label: "Seating provision", status, detail };
}

function comfortCheck(band: string, bandLabel: string, comfortableCapacity: number, styleLabel: string): EvidenceCheck {
  const status: EvidenceStatus =
    band === "over-capacity" ? "review"
      : band === "tight" ? "attention"
        : band === "open" ? "info"
          : "pass";
  const detail = comfortableCapacity > 0
    ? `${bandLabel}. Comfortable for ~${String(comfortableCapacity)} as ${styleLabel}.`
    : bandLabel;
  return { id: "comfort", label: "Room comfort", status, detail };
}

function egressCheck(assessedHeadcount: number): EvidenceCheck {
  if (assessedHeadcount <= 0) {
    return {
      id: "egress",
      label: "Egress reference",
      status: "info",
      detail: "Add a guest count or seating for an indicative egress reference.",
    };
  }
  const exits = minExitsAdb(assessedHeadcount);
  const widthMm = requiredExitWidthMmAdb(assessedHeadcount);
  return {
    id: "egress",
    label: "Egress reference",
    status: "review",
    detail: `For ${String(assessedHeadcount)} people, ADB guidance indicates ≥ ${String(exits)} escape `
      + `${exits === 1 ? "route" : "routes"} and ≥ ${String(widthMm)} mm total clear exit width. `
      + "Confirm against this room's actual exits.",
  };
}

/** Assemble the Layout Evidence Pack from the live layout. Pure. */
export function buildEvidencePack(input: EvidenceModelInput): EvidencePack {
  const guests = buildGuestsCapacityModel({
    placedItems: input.placedItems,
    roomWidthM: input.roomWidthM,
    roomLengthM: input.roomLengthM,
    guestCount: input.guestCount,
  });

  const checks: readonly EvidenceCheck[] = [
    seatingCheck(guests.seatStatus, seatSufficiencyLabel(guests)),
    comfortCheck(guests.band, guests.bandLabel, guests.comfortableCapacity, guests.styleLabel),
    egressCheck(guests.assessedHeadcount),
  ];

  let passCount = 0;
  let attentionCount = 0;
  let reviewCount = 0;
  for (const check of checks) {
    if (check.status === "pass") passCount += 1;
    else if (check.status === "attention") attentionCount += 1;
    else if (check.status === "review") reviewCount += 1;
  }

  return {
    checks,
    passCount,
    attentionCount,
    reviewCount,
    assessedHeadcount: guests.assessedHeadcount,
    hasGuestCount: input.guestCount !== null,
  };
}

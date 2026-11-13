import { CAPACITY_FORMATS } from "@omnitwin/types";
import { buildGuestsCapacityModel, seatSufficiencyLabel } from "./cockpit-guests-model.js";
import { guestsAbovePublished, type PublishedCapacityAnswer, type PublishedFormat } from "./planner-truth.js";
import type { AskTopic } from "./unrecorded-ask.js";
import type { PlacedItem } from "./placement.js";

// ---------------------------------------------------------------------------
// cockpit-evidence-model — the Layout Evidence Pack (Evidence lens).
//
// Each row states what is recorded about the layout and who stated it, and
// names the person to ask for what is not. There is no "Pass" anywhere: a
// green tick is only honest for something a named person checked, and nothing
// here was checked by anyone (redteam fix-first 2). In particular:
//
//   - Seating compares placed chairs with the planner's own guest count:
//     arithmetic on the planner's inputs, flagged only when short.
//   - Capacity reads the guest count against the venue's PUBLISHED figure for
//     the layout's format, with its source; above it is a review, at or below
//     it is simply noted, never a confirmation.
//   - Escape routes and the room's maximum come from the venue's fire risk
//     assessment, which Venviewer does not hold, so they are "not recorded"
//     with the hallkeeper to ask. The England (Approved Document B) and US
//     (NFPA 101) figures this lens used to quote are the wrong authority for a
//     Glasgow building and are not shown.
//
// Pure: the panel turns each ask topic into a named person and a drafted
// question for the viewer.
// ---------------------------------------------------------------------------

export type EvidenceStatus = "review" | "noted" | "not-recorded" | "reading";

export interface EvidenceCheck {
  readonly id: string;
  readonly label: string;
  readonly status: EvidenceStatus;
  readonly detail: string;
  /** Who stated the figure in this row, when one is shown. */
  readonly source: string | null;
  /** The question for the named person, when the row needs one. */
  readonly ask: AskTopic | null;
}

export interface EvidencePack {
  readonly checks: readonly EvidenceCheck[];
  readonly reviewCount: number;
  readonly notRecordedCount: number;
  /** Headcount the pack is read against (guest count or placed chairs). */
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
  /** The venue's published figures for the open room. */
  readonly published: PublishedCapacityAnswer;
}

const FORMAT_WORDS = Object.fromEntries(
  CAPACITY_FORMATS.map((format) => [format.key, format.label.toLowerCase()]),
) as Readonly<Record<PublishedFormat, string>>;

function seatingCheck(seatStatus: string, detail: string): EvidenceCheck {
  return {
    id: "seating",
    label: "Seating",
    status: seatStatus === "short" ? "review" : "noted",
    detail,
    source: null,
    ask: null,
  };
}

function capacityCheck(
  published: PublishedCapacityAnswer,
  headcount: number,
  format: PublishedFormat | null,
  /** The layout on the floor in words, or null when nothing seating-like is placed. */
  styleLabel: string | null,
): EvidenceCheck {
  const base = { id: "capacity", label: "Published capacity" } as const;
  if (published.kind === "reading") {
    return { ...base, status: "reading", detail: "Reading the venue's published figures.", source: null, ask: null };
  }
  if (published.kind === "not-published") {
    return {
      ...base,
      status: "not-recorded",
      detail: "No published capacity is held here for this room.",
      source: null,
      ask: "room-capacity",
    };
  }
  if (format === null) {
    return {
      ...base,
      status: "noted",
      detail: styleLabel !== null
        ? `The venue publishes no figure for ${styleLabel}.`
        : "Add seating to read the layout against the published figures.",
      source: published.source,
      ask: null,
    };
  }
  const figure = published.capacity[format];
  const above = guestsAbovePublished(headcount > 0 ? headcount : null, published.capacity, format);
  if (above !== null) {
    return {
      ...base,
      status: "review",
      detail: above,
      source: published.source,
      ask: { kind: "headcount", guests: headcount, figure, formatLabel: FORMAT_WORDS[format] },
    };
  }
  return {
    ...base,
    status: "noted",
    detail: `Published ${String(figure)} for ${FORMAT_WORDS[format]}.`,
    source: published.source,
    ask: null,
  };
}

function escapeRoutesCheck(headcount: number): EvidenceCheck {
  return {
    id: "escape-routes",
    label: "Escape routes and maximum",
    status: "not-recorded",
    detail: headcount > 0
      ? `For ${String(headcount)} people, the escape routes and the room's maximum come from the venue's fire risk assessment, which is not recorded here.`
      : "The escape routes and the room's maximum come from the venue's fire risk assessment, which is not recorded here.",
    source: null,
    ask: "escape-routes",
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
  const headcount = guests.guestCount ?? guests.seatsProvided;

  const checks: readonly EvidenceCheck[] = [
    seatingCheck(guests.seatStatus, seatSufficiencyLabel(guests)),
    capacityCheck(
      input.published,
      headcount,
      guests.publishedFormat,
      guests.layoutStyle === "custom" ? null : guests.styleLabel,
    ),
    escapeRoutesCheck(headcount),
  ];

  return {
    checks,
    reviewCount: checks.filter((check) => check.status === "review").length,
    notRecordedCount: checks.filter((check) => check.status === "not-recorded").length,
    assessedHeadcount: headcount,
    hasGuestCount: guests.guestCount !== null,
  };
}

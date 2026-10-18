import {
  CAPACITY_FORMATS,
  TRADES_HALL_PUBLIC_PROFILE,
  VENUE_TRUTH_STATEMENTS,
  publishedRoomCapacity,
  venueTruthStatementLabel,
  type LayoutStyle,
  type RoomCapacity,
} from "@omnitwin/types";
import { getCatalogueItem } from "./catalogue.js";
import { canReadInternalEventData } from "./event-access.js";
import { isPoseurTableItem } from "./furniture-semantics.js";
import { inferSeatingStyle } from "./layout-capacity.js";
import { seatingCountsFromPlacedItems } from "./seating-counts.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";
import { roomPhrase } from "./unrecorded-ask.js";
import { countLabel } from "./count-label.js";
import type { PlacedItem } from "./placement.js";
import type { AuthUser } from "../stores/auth-store.js";

// ---------------------------------------------------------------------------
// planner-truth — the figures the planner may state, and who stated them.
//
// The planner used to lead with floor area divided by generic space-per-guest
// allowances (layout-capacity.ts): 339 standing in a Grand Hall the venue
// publishes at 250. This module is the other side of that line. It answers
// with the venue's own published figure for the room and layout, labelled with
// who stated it and when, and says plainly when nothing was published. The
// generic arithmetic survives only as a staff aid ("estimate at generic
// spacing"), never as the room's capacity (redteam fix-first 1).
// ---------------------------------------------------------------------------

/** One of the venue's published formats: theatre, classroom, dinner, reception. */
export type PublishedFormat = keyof RoomCapacity;

/** "Published guide · Trades Hall · 9 Jul 2026". */
export const PUBLISHED_CAPACITY_LABEL = venueTruthStatementLabel(VENUE_TRUTH_STATEMENTS.capacities);

/** The words staff see beside any computed count, so it is never read as the
 *  room's capacity. */
export const GENERIC_ESTIMATE_LABEL = "Estimate at generic spacing";

/**
 * The venue's published format a planner layout style is read against, or
 * null where the venue publishes no figure for it. Standing reception is the
 * planner's "cocktail"; both dinner styles are seated dinner covers. Ceremony
 * rows, cabaret and boardroom have no published figure, and none is inferred.
 */
export function publishedFormatForStyle(style: LayoutStyle): PublishedFormat | null {
  switch (style) {
    case "theatre": return "theatre";
    case "cocktail": return "reception";
    case "dinner-rounds":
    case "dinner-banquet": return "dinner";
    case "ceremony":
    case "cabaret":
    case "boardroom":
    case "custom": return null;
  }
}

/**
 * The layout style on the floor, read the way the venue publishes its figures.
 * Seating decides first (rounds, long tables, rows of chairs); a floor of
 * standing poseur tables with no seats is a standing reception, the planner's
 * "cocktail", so it is read against the venue's reception figure. Anything
 * else is a custom layout with no published figure.
 */
export function plannerLayoutStyle(placedItems: readonly PlacedItem[]): LayoutStyle {
  const seated = inferSeatingStyle(seatingCountsFromPlacedItems(placedItems));
  if (seated !== "custom") return seated;
  const standing = placedItems.some((placed) => {
    if (!isSceneFurniturePlacement(placed)) return false;
    const item = getCatalogueItem(placed.catalogueItemId);
    return item !== undefined && isPoseurTableItem(item);
  });
  return standing ? "cocktail" : "custom";
}

/** The sign-in state the staff question needs. */
export interface PlannerViewerAuth {
  readonly isLoading: boolean;
  readonly isAuthenticated: boolean;
  readonly user: Pick<AuthUser, "role" | "platformRole" | "venueId"> | null;
}

/**
 * Whether the viewer is staff of the venue whose room is open. It builds on the
 * planner's existing gate, canReadInternalEventData (the venue's floor team at
 * its own venue, or a platform administrator), and adds the plan's own venue:
 * a floor member of another venue opening this plan is not this venue's staff.
 * With no venue known yet, nobody is staff, so the honest client view shows.
 */
export function plannerViewerIsVenueStaff(auth: PlannerViewerAuth, planVenueId: string | null): boolean {
  if (!canReadInternalEventData(auth) || auth.user === null) return false;
  if (auth.user.platformRole === "admin") return true;
  return planVenueId !== null && auth.user.venueId === planVenueId;
}

/** The room the planner has open, as the published figures need it. */
export interface PlannerRoomIdentity {
  /** The space's slug, e.g. "grand-hall". */
  readonly slug: string;
  /** Whether the space belongs to Trades Hall: true, false, or null while
   *  that is still being read. */
  readonly tradesHall: boolean | null;
}

export type PublishedCapacityAnswer =
  | { readonly kind: "reading" }
  | { readonly kind: "published"; readonly capacity: RoomCapacity; readonly source: string }
  | { readonly kind: "not-published" };

/**
 * The venue's published figures for the open room. Only Trades Hall's own
 * rooms carry them: another venue's "Saloon" never borrows Trades Hall's
 * numbers, and a room the venue publishes nothing for gets nothing invented.
 */
export function publishedCapacityFor(room: PlannerRoomIdentity | null): PublishedCapacityAnswer {
  if (room === null) return { kind: "not-published" };
  if (room.tradesHall === null) return { kind: "reading" };
  if (!room.tradesHall) return { kind: "not-published" };
  const capacity = publishedRoomCapacity(TRADES_HALL_PUBLIC_PROFILE, room.slug);
  return capacity === null
    ? { kind: "not-published" }
    : { kind: "published", capacity, source: PUBLISHED_CAPACITY_LABEL };
}

export interface PublishedCapacityRow {
  readonly format: PublishedFormat;
  readonly label: string;
  readonly description: string;
  readonly figure: number;
  /** The format of the layout on the floor, when it has a published figure. */
  readonly onFloor: boolean;
}

/** The venue's published figures in the venue's own order, marking the one
 *  the layout on the floor is read against. */
export function publishedCapacityRows(capacity: RoomCapacity, onFloor: PublishedFormat | null): PublishedCapacityRow[] {
  return CAPACITY_FORMATS.map((format) => ({
    format: format.key,
    label: format.label,
    description: format.description,
    figure: capacity[format.key],
    onFloor: format.key === onFloor,
  }));
}

/**
 * The one thing worth saying about a guest count against the published figure:
 * that it is more than the venue publishes. A count at or below the figure
 * earns no sentence: the figure is a planning guide, so being under it is not
 * a confirmation of anything.
 */
export function guestsAbovePublished(
  guestCount: number | null,
  capacity: RoomCapacity,
  format: PublishedFormat | null,
): string | null {
  if (guestCount === null || format === null || !Number.isFinite(guestCount) || guestCount <= 0) return null;
  const figure = capacity[format];
  if (guestCount <= figure) return null;
  return `${countLabel(guestCount, "guest")} is more than the published ${String(figure)} for ${publishedFormatWord(format)}.`;
}

/** A published format in words, lower case: "dinner", "reception". */
export function publishedFormatWord(format: PublishedFormat): string {
  return CAPACITY_FORMATS.find((f) => f.key === format)?.label.toLowerCase() ?? format;
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/** "180 for dinner", or every figure in the venue's order when no format is
 *  read from the floor: "250 for theatre, 80 for classroom, 180 for dinner and
 *  250 for reception". */
export function publishedFiguresPhrase(capacity: RoomCapacity, format: PublishedFormat | null): string {
  if (format !== null) return `${String(capacity[format])} for ${publishedFormatWord(format)}`;
  return joinAnd(CAPACITY_FORMATS.map((f) => `${String(capacity[f.key])} for ${f.label.toLowerCase()}`));
}

export interface PublishedCapacityNoteInput {
  readonly published: PublishedCapacityAnswer;
  /** The published format the layout on the floor is read against, if any. */
  readonly format: PublishedFormat | null;
  readonly roomName: string | null;
  /** The headcount the plan is for, or null when none is set. */
  readonly guests: number | null;
}

/**
 * One factual paragraph a client may read about the room's capacity: the
 * venue's published figure for the layout, who stated it and when, and what
 * happens above it. It never carries a computed count, and says plainly who
 * confirms the figure when nothing is published.
 */
export function publishedCapacityNote(input: PublishedCapacityNoteInput): string {
  const room = roomPhrase(input.roomName);
  if (input.published.kind !== "published") {
    return `The venue team confirms the capacity of ${room} for this layout.`;
  }
  const { capacity, source } = input.published;
  const figures = `The venue publishes ${publishedFiguresPhrase(capacity, input.format)} in ${room} (${source}).`;
  const above = guestsAbovePublished(input.guests, capacity, input.format);
  const next = above !== null
    ? ` ${above.slice(0, -1)}; the venue team will say what is possible.`
    : " Final numbers depend on the layout and are confirmed by the venue team.";
  return `${figures}${next}`;
}

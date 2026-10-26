import {
  TRADES_HALL_ROOM_CAPACITIES,
  isPublishedRoomSlug,
  type CalendarBookingEntry,
  type EventPhase,
  type PhaseLayoutSnapshot,
  type RoomCapacity,
} from "@omnitwin/types";
import { getCatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import type { PlacedItem } from "./placement.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";

// ---------------------------------------------------------------------------
// The slate's facts (T-671 slice 7; spec 6.1): what this is, in the venue's
// words, and the numbers that decide, which the copper plane carries. The
// limits are the venue's published capacities (trades-hall-venue-truth), never
// restated here.
// ---------------------------------------------------------------------------

const VENUE_TIME_ZONE = "Europe/London";

const DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: VENUE_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** The seats meter's shape as fractions of its width (card-dock spec §9). */
export interface MeterShape {
  /** Seats placed. */
  readonly fill: number;
  /** The end of the seats in hand (equal to fill with nothing in hand). */
  readonly handTo: number;
  /** Where the part past the room's published seats begins, or null. */
  readonly overFrom: number | null;
  /** Everyone has a seat. */
  readonly full: boolean;
}

/**
 * The meter: seats over guests (with no event, the room's published seats),
 * the bar scaled to whichever is larger once the seats in hand are counted.
 */
export function meterShape({ guests, seats, limit, inHand }: {
  readonly guests: number | null;
  readonly seats: number;
  readonly limit: number | null;
  readonly inHand: number;
}): MeterShape {
  const wanted = guests ?? limit ?? 0;
  const scale = Math.max(wanted, seats + inHand, seats);
  if (scale <= 0) return { fill: 0, handTo: 0, overFrom: null, full: false };
  return {
    fill: seats / scale,
    handTo: (seats + inHand) / scale,
    overFrom: limit !== null && seats + inHand > limit ? limit / scale : null,
    full: wanted > 0 && seats >= wanted,
  };
}

const ISO_DAY = new Map<string, Intl.DateTimeFormat>();

/** The event's day as the Diary's address takes it ("2026-11-28"), in the venue's zone. */
export function venueDay(startsAt: string, timeZone: string | null): string {
  const zone = timeZone ?? VENUE_TIME_ZONE;
  let format = ISO_DAY.get(zone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    ISO_DAY.set(zone, format);
  }
  return format.format(new Date(startsAt));
}

/** "Sat 28 Nov 2026 · Grand Hall", the day in the venue's own time; the room alone without a date. */
export function slateEyebrow({ startsAt, roomName }: { readonly startsAt: string | null; readonly roomName: string }): string {
  if (startsAt === null) return roomName;
  const parts = DAY.formatToParts(new Date(startsAt));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")} · ${roomName}`;
}

/** Which of the venue's published formats a layout is laid for. */
export type LayoutFormat = keyof RoomCapacity;

/** Where the seats stand against the guests: all seated, some short, past the room's limit, or no guests to seat. */
export type SeatStanding = "seated" | "short" | "over" | "no-guests";

export interface PlaneFacts {
  readonly guests: number | null;
  readonly seats: number;
  readonly tables: number;
  readonly format: LayoutFormat;
  /** The room's published limit for the format, or null for a room the venue does not publish. */
  readonly limit: number | null;
  readonly standing: SeatStanding;
  /** How many guests have no seat (0 unless short). */
  readonly short: number;
}

export function planeFacts({ items, guests, roomSlug }: {
  readonly items: readonly PlacedItem[];
  readonly guests: number | null;
  readonly roomSlug: string | null;
}): PlaneFacts {
  let seats = 0;
  let tables = 0;
  for (const item of items) {
    if (!isSceneFurniturePlacement(item)) continue;
    const catalogue = getCatalogueItem(item.catalogueItemId);
    if (catalogue === undefined) continue;
    if (catalogue.category === "chair") seats += 1;
    else if (isDiningTableItem(catalogue)) tables += 1;
  }
  // Tables make a dinner; chairs alone stand in rows (theatre); an empty floor reads as dinner, the venue's default.
  const format: LayoutFormat = tables > 0 || seats === 0 ? "dinner" : "theatre";
  const limit = roomSlug !== null && isPublishedRoomSlug(roomSlug) ? TRADES_HALL_ROOM_CAPACITIES[roomSlug][format] : null;
  const short = guests === null ? 0 : Math.max(0, guests - seats);
  const standing: SeatStanding = limit !== null && seats > limit ? "over"
    : guests === null || guests === 0 ? "no-guests"
      : short > 0 ? "short" : "seated";
  return { guests, seats, tables, format, limit, standing, short };
}

const ORDINAL_SUFFIX: Readonly<Record<number, string>> = { 1: "st", 2: "nd", 3: "rd" };

function ordinal(rank: number): string {
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ORDINAL_SUFFIX[rank % 10] ?? "th";
  return `${String(rank)}${suffix}`;
}

/**
 * The hold chip's words, the Diary's own terms made short: Provisional, 1st
 * option, 2nd option, Joint 1st, Confirmed. Null for anything that is not a
 * live hold or a confirmation (a prospect, a house block, a released hold).
 */
export function holdChipWords(entry: Pick<CalendarBookingEntry, "status" | "kind" | "rank" | "jointFlag">): string | null {
  if (entry.status !== "active") return null;
  if (entry.kind === "ink") return "Confirmed";
  if (entry.kind !== "hold") return null;
  if (entry.rank === null) return "Provisional";
  if (entry.rank === 1 && entry.jointFlag) return "Joint 1st";
  return `${ordinal(entry.rank)} option`;
}

/**
 * An act of the event in this room, and which layout the function sheet reads
 * for it: this one, an earlier save of this one, another, or none yet.
 */
export interface EventAct {
  readonly id: string;
  readonly name: string;
  readonly state: "this" | "stale" | "other" | "none";
}

interface ActsGraph {
  readonly phases: readonly Pick<EventPhase, "id" | "name" | "spaceId" | "sortOrder">[];
  readonly phaseLayoutSnapshots: readonly Pick<PhaseLayoutSnapshot, "eventPhaseId" | "configurationId" | "status" | "frozenAt">[];
}

/** The acts held in this room, in the event's order, each with the layout it reads now. */
export function actsInRoom(graph: ActsGraph, spaceId: string, configurationId: string | null): EventAct[] {
  return graph.phases
    .filter((phase) => phase.spaceId === spaceId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((phase) => {
      // The layout an act reads is its latest frozen (or since-changed) one; superseded ones are history.
      let current: ActsGraph["phaseLayoutSnapshots"][number] | null = null;
      for (const snapshot of graph.phaseLayoutSnapshots) {
        if (snapshot.eventPhaseId !== phase.id || (snapshot.status !== "frozen" && snapshot.status !== "stale")) continue;
        if (current === null || (snapshot.frozenAt ?? "") > (current.frozenAt ?? "")) current = snapshot;
      }
      const state: EventAct["state"] = current === null ? "none"
        : current.configurationId !== configurationId || configurationId === null ? "other"
          : current.status === "stale" ? "stale" : "this";
      return { id: phase.id, name: phase.name, state };
    });
}

type LinkedBooking = Pick<CalendarBookingEntry, "eventId" | "status" | "kind" | "rank" | "jointFlag">;

/** How strong a booking's claim is: a confirmation, then holds by rank (an unranked provisional last). */
function claimStrength(entry: LinkedBooking): number {
  if (entry.kind === "ink") return 0;
  return entry.rank ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Where this event stands in the Diary, in the hold chip's words: its
 * confirmation if it has one, else its best-ranked live hold; null when none
 * of its bookings is live.
 */
export function eventHoldWords(entries: readonly LinkedBooking[], eventId: string): string | null {
  let best: LinkedBooking | null = null;
  for (const entry of entries) {
    if (entry.eventId !== eventId || holdChipWords(entry) === null) continue;
    if (best === null || claimStrength(entry) < claimStrength(best)) best = entry;
  }
  return best === null ? null : holdChipWords(best);
}

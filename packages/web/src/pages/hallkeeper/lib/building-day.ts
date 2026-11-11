import type { SupplierArrival } from "@omnitwin/types";
import type { DayBoardLane } from "./day-board-state.js";

// ---------------------------------------------------------------------------
// The building's day (pure, T-693): when it must be open and when it can be
// locked up, from the day's own bookings and the suppliers due, and who is
// still in it. The first booking's setup (or the first supplier at the door)
// opens it; the last clear-down (or the last supplier out) closes it. Every
// booking counts, a viewing or a house block too: each needs the building.
// A booking that runs for days (an exhibition) sets neither time: its daily
// hours are not on the Diary. Of the rest, the building opens no earlier than
// the board's day starts, and its lock-up may run into the small hours, even
// for a venue whose day ends at midnight.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 3_600_000;
/** How far past the board's day a late function's clear-down may run. */
const SMALL_HOURS_MS = 12 * 3_600_000;

export interface BuildingMoment {
  readonly atMs: number;
  /** Why then, in the floor's words: "Merchants' Breakfast Briefing sets up". */
  readonly why: string;
}

export interface BuildingDay {
  readonly openBy: BuildingMoment | null;
  readonly lockUpAfter: BuildingMoment | null;
  /** Suppliers marked in and not yet gone, earliest in first. */
  readonly stillIn: readonly SupplierArrival[];
}

export function buildingDay(
  lanes: readonly DayBoardLane[],
  arrivals: readonly SupplierArrival[],
  range: { readonly fromMs: number; readonly toMs: number },
): BuildingDay {
  const slots = lanes.flatMap((lane) => lane.slots);
  const onBoard = new Set(slots.map((slot) => slot.bookingId));
  const functions = slots.filter((slot) => slot.endsAtMs - slot.startsAtMs < DAY_MS);
  const theirs = arrivals.filter((arrival) => onBoard.has(arrival.bookingId));
  const opens: BuildingMoment[] = [
    ...functions.map((slot) => ({ atMs: slot.setupStartsAtMs, why: slot.setupStartsAtMs < slot.startsAtMs ? `${slot.title} sets up` : `${slot.title} begins` })),
    ...theirs.map((arrival) => ({ atMs: Date.parse(arrival.arrivesAt), why: `${arrival.supplierName} due` })),
  ];
  const closes: BuildingMoment[] = [
    ...functions.map((slot) => ({ atMs: slot.segments.clearDownEndsAtMs, why: slot.segments.clearDownEndsAtMs > slot.endsAtMs ? `${slot.title} clears` : `${slot.title} ends` })),
    ...theirs.flatMap((arrival) => (arrival.leavesBy === null ? [] : [{ atMs: Date.parse(arrival.leavesBy), why: `${arrival.supplierName} out` }])),
  ];
  const earliest = opens
    .filter((moment) => moment.atMs >= range.fromMs && moment.atMs < range.toMs)
    .reduce<BuildingMoment | null>((first, moment) => (first === null || moment.atMs < first.atMs ? moment : first), null);
  const latest = closes
    .filter((moment) => moment.atMs > range.fromMs && moment.atMs <= range.toMs + SMALL_HOURS_MS)
    .reduce<BuildingMoment | null>((last, moment) => (last === null || moment.atMs > last.atMs ? moment : last), null);
  return {
    openBy: earliest,
    lockUpAfter: latest,
    stillIn: theirs
      .filter((arrival) => arrival.arrivedAt !== null && arrival.leftAt === null)
      .sort((a, b) => Date.parse(a.arrivedAt ?? a.arrivesAt) - Date.parse(b.arrivedAt ?? b.arrivesAt)),
  };
}

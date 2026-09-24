import type { CalendarBookingEntry, CalendarEntry, CalendarPhaseEntry } from "@omnitwin/types";
import { dayColumns, formatWallTime, msToWallInput, VENUE_TIME_ZONE, type BoardRange, type DayColumn } from "./board-time.js";

type DayWindow = Pick<DayColumn, "startMs" | "endMs">;

/** Half-open overlap with a venue day: an entry that only touches a midnight
 *  does not spill onto the neighbouring day, and an unparseable instant (NaN)
 *  overlaps nothing. */
function overlapsDay(startMs: number, endMs: number, day: DayWindow): boolean {
  return startMs < day.endMs && endMs > day.startMs;
}

/** Day cards are summaries, never a pixel-to-duration time scale. */
export function entriesForDay(entries: readonly CalendarEntry[], spaceId: string, day: DayColumn): readonly CalendarEntry[] {
  return entries.filter((entry) => entry.spaceId === spaceId && overlapsDay(Date.parse(entry.startsAt), Date.parse(entry.endsAt), day))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}

export function firstVisibleDay(entry: CalendarEntry, range: BoardRange): number | null {
  return dayColumns(range).find((day) => overlapsDay(Date.parse(entry.startsAt), Date.parse(entry.endsAt), day))?.startMs ?? null;
}

const shortDate = new Intl.DateTimeFormat("en-GB", { timeZone: VENUE_TIME_ZONE, day: "numeric", month: "short" });
const offset = new Intl.DateTimeFormat("en-GB", { timeZone: VENUE_TIME_ZONE, timeZoneName: "short" });

export function bookingTimeLabel(entry: Pick<CalendarEntry, "startsAt" | "endsAt">): string {
  const start = Date.parse(entry.startsAt);
  const end = Date.parse(entry.endsAt);
  const zone = (ms: number): string => offset.formatToParts(ms).find((part) => part.type === "timeZoneName")?.value ?? "";
  const changesOffset = zone(start) !== zone(end);
  const time = (ms: number): string => `${formatWallTime(ms)}${changesOffset ? ` ${zone(ms)}` : ""}`;
  if (msToWallInput(start).slice(0, 10) === msToWallInput(end).slice(0, 10)) {
    return `${time(start)}–${time(end)}`;
  }
  return `${shortDate.format(start)} ${time(start)} – ${shortDate.format(end)} ${time(end)}`;
}

export function bookingStateLabel(entry: CalendarBookingEntry): string {
  if (entry.status !== "active") return { cancelled: "Cancelled", released: "Released", expired: "Expired", lost: "Lost" }[entry.status];
  if (entry.kind === "ink") return "Confirmed";
  if (entry.kind === "internal_block") return "House block";
  if (entry.kind === "prospect") return "Prospect · never blocks";
  if (entry.rank === null) return "Pencilled · unranked";
  if (entry.rank === 1 && entry.jointFlag) return "Pencilled · joint first";
  return `Pencilled · option ${String(entry.rank)}`;
}

// ---------------------------------------------------------------------------
// The overview index — one pass per `entries` array instead of one filter +
// sort of every entry per room × day cell, and one set of Intl label calls per
// entry instead of three per card. Cell membership, order, focus anchors and
// labels are exactly those of entriesForDay / firstVisibleDay /
// bookingTimeLabel / bookingStateLabel above (the tests hold them equal).
// ---------------------------------------------------------------------------

interface OverviewItemBase {
  /** Parsed once; ordering and the "Continues" marker read these. */
  readonly startMs: number;
  readonly endMs: number;
  readonly timeLabel: string;
  /** The first visible day the entry appears on — its card there carries
   *  the stable `diary-block-<id>` focus anchor. */
  readonly anchorDayMs: number;
}

export interface OverviewBookingItem extends OverviewItemBase {
  readonly type: "booking";
  readonly entry: CalendarBookingEntry;
  readonly stateLabel: string;
}

export interface OverviewPhaseItem extends OverviewItemBase {
  readonly type: "phase";
  readonly entry: CalendarPhaseEntry;
}

export type OverviewItem = OverviewBookingItem | OverviewPhaseItem;

export interface OverviewIndex {
  /** spaceId → day.startMs → the items overlapping that venue day, in the
   *  order entriesForDay returns them. Empty cells have no entry. */
  readonly cells: ReadonlyMap<string, ReadonlyMap<number, readonly OverviewItem[]>>;
  /** spaceId → active bookings in the loaded range (the room summary count). */
  readonly activeBookings: ReadonlyMap<string, number>;
}

export function buildOverviewIndex(entries: readonly CalendarEntry[], days: readonly DayColumn[]): OverviewIndex {
  const cells = new Map<string, Map<number, OverviewItem[]>>();
  const activeBookings = new Map<string, number>();
  for (const entry of entries) {
    if (entry.entryType === "booking" && entry.status === "active") {
      activeBookings.set(entry.spaceId, (activeBookings.get(entry.spaceId) ?? 0) + 1);
    }
    const startMs = Date.parse(entry.startsAt);
    const endMs = Date.parse(entry.endsAt);
    const visibleDays = days.filter((day) => overlapsDay(startMs, endMs, day));
    const anchor = visibleDays[0];
    if (anchor === undefined) continue;
    const base = { startMs, endMs, timeLabel: bookingTimeLabel(entry), anchorDayMs: anchor.startMs };
    const item: OverviewItem = entry.entryType === "booking"
      ? { ...base, type: "booking", entry, stateLabel: bookingStateLabel(entry) }
      : { ...base, type: "phase", entry };
    let roomCells = cells.get(entry.spaceId);
    if (roomCells === undefined) {
      roomCells = new Map();
      cells.set(entry.spaceId, roomCells);
    }
    for (const day of visibleDays) {
      const cell = roomCells.get(day.startMs);
      if (cell === undefined) roomCells.set(day.startMs, [item]);
      else cell.push(item);
    }
  }
  // Entries were appended in input order, so this stable sort reproduces
  // entriesForDay's filter-then-sort exactly, ties included.
  for (const roomCells of cells.values()) {
    for (const cell of roomCells.values()) {
      cell.sort((a, b) => a.startMs - b.startMs || a.entry.id.localeCompare(b.entry.id));
    }
  }
  return { cells, activeBookings };
}

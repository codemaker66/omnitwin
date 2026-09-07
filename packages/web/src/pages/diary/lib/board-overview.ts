import type { CalendarBookingEntry, CalendarEntry } from "@omnitwin/types";
import { dayColumns, formatWallTime, msToWallInput, VENUE_TIME_ZONE, type BoardRange, type DayColumn } from "./board-time.js";

/** Day cards are summaries, never a pixel-to-duration time scale. */
export function entriesForDay(entries: readonly CalendarEntry[], spaceId: string, day: DayColumn): readonly CalendarEntry[] {
  return entries.filter((entry) => entry.spaceId === spaceId && Date.parse(entry.startsAt) < day.endMs && Date.parse(entry.endsAt) > day.startMs)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}

export function firstVisibleDay(entry: CalendarEntry, range: BoardRange): number | null {
  return dayColumns(range).find((day) => Date.parse(entry.startsAt) < day.endMs && Date.parse(entry.endsAt) > day.startMs)?.startMs ?? null;
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

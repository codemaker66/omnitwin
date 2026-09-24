import type { CalendarEntry, CalendarRoom } from "@omnitwin/types";
import { BOARD_COPY } from "../board-copy.js";
import { formatWallTime } from "./board-time.js";

// ---------------------------------------------------------------------------
// The finding palette's matching (C1, Ctrl/Cmd-K). Searches only what the
// board already holds in memory — the rooms, the loaded range's bookings and
// the open enquiries — so the palette's empty state can say so honestly.
// ---------------------------------------------------------------------------

export interface PaletteResult {
  readonly kind: "room" | "booking" | "enquiry";
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface PaletteEnquiry {
  readonly id: string;
  readonly name: string;
  readonly eventType: string | null;
}

/** The loaded calendar, as the palette reads it. */
export interface PaletteCalendar {
  readonly rooms: readonly CalendarRoom[];
  readonly entries: readonly CalendarEntry[];
}

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 12;

/** Rooms first, then bookings, then enquiries; nothing until the calendar
 *  has loaded or the query has two characters. */
export function findPaletteResults(
  query: string,
  data: PaletteCalendar | null,
  enquiries: readonly PaletteEnquiry[],
): readonly PaletteResult[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY_LENGTH || data === null) return [];
  const out: PaletteResult[] = [];
  const roomName = (spaceId: string): string =>
    data.rooms.find((room) => room.id === spaceId)?.name ?? "";
  for (const room of data.rooms) {
    if (room.name.toLowerCase().includes(needle)) {
      out.push({ kind: "room", id: room.id, label: room.name, detail: BOARD_COPY.palette.roomDetail });
    }
  }
  for (const entry of data.entries) {
    if (entry.entryType !== "booking") continue;
    const hay = `${entry.title} ${entry.clientName ?? ""} ${entry.eventName ?? ""}`.toLowerCase();
    if (hay.includes(needle)) {
      out.push({
        kind: "booking",
        id: entry.id,
        label: entry.title,
        detail: `${roomName(entry.spaceId)} · ${formatWallTime(Date.parse(entry.startsAt))}`,
      });
    }
  }
  for (const enquiry of enquiries) {
    if (`${enquiry.name} ${enquiry.eventType ?? ""}`.toLowerCase().includes(needle)) {
      out.push({
        kind: "enquiry",
        id: enquiry.id,
        label: enquiry.name,
        detail: BOARD_COPY.palette.enquiryDetail,
      });
    }
  }
  return out.slice(0, MAX_RESULTS);
}

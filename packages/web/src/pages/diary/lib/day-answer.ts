import type { CalendarBookingEntry, CalendarEntry, CalendarRoom } from "@omnitwin/types";
import { BOARD_COPY } from "../board-copy.js";
import { bookingTimeLabel } from "./board-overview.js";
import { formatInlineDay, formatWallTime } from "./board-time.js";
import { roomsOnDay } from "./go-to-date.js";

// ---------------------------------------------------------------------------
// A day, room by room, in the Diary's own words: "Free", "Confirmed, Fraser
// wedding, 13:00–23:00", "1st option MacLeod wedding, …, decides Tue 1 Dec".
// Go to date on the board and the staff header's Find both answer with it, so
// a date reads the same wherever it is asked.
// ---------------------------------------------------------------------------

export interface DayAnswerRoom {
  readonly id: string;
  readonly name: string;
  readonly lines: readonly { readonly key: string; readonly text: string }[];
}

export function dayAnswer(
  entries: readonly CalendarEntry[],
  rooms: readonly CalendarRoom[],
  day: { readonly startMs: number; readonly endMs: number },
  nowMs: number,
): readonly DayAnswerRoom[] {
  const line = (entry: CalendarBookingEntry): string => {
    const time = bookingTimeLabel(entry);
    if (entry.kind === "ink") return BOARD_COPY.goTo.confirmed(entry.title, time);
    if (entry.kind === "internal_block") return BOARD_COPY.goTo.block(entry.title, time);
    const decides = entry.decisionAt === null ? null : formatInlineDay(Date.parse(entry.decisionAt), nowMs);
    return BOARD_COPY.goTo.hold(entry.rank, entry.jointFlag, entry.title, time, decides);
  };
  return roomsOnDay(entries, rooms, day).map((answer) => ({
    id: answer.roomId,
    name: answer.room,
    lines: answer.bookings.length > 0
      ? answer.bookings.map((entry) => ({ key: entry.id, text: line(entry) }))
      : [{ key: "free", text: BOARD_COPY.goTo.free(answer.interest, answer.freeFromMs === null ? null : formatWallTime(answer.freeFromMs)) }],
  }));
}

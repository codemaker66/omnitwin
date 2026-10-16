import type { CalendarBookingEntry, CalendarEntry, CalendarPhaseEntry, CalendarRoom } from "@omnitwin/types";
import { BOARD_COPY } from "../board-copy.js";
import { bookingTimeLabel } from "./board-overview.js";
import { formatInlineDay, formatWallTime } from "./board-time.js";
import { roomsOnDay } from "./go-to-date.js";

// ---------------------------------------------------------------------------
// A day, room by room, in the Diary's own words: "Free", "Confirmed, Fraser
// wedding, 13:00–23:00", "1st option MacLeod wedding, …, decides Tue 1 Dec".
// Go to date on the board, the staff header's Find and the Enquiries desk all
// answer with it, so a date reads the same wherever it is asked.
// ---------------------------------------------------------------------------

export interface DayAnswerLine {
  /** The booking's or phase's own id, or "free": unique within the room. */
  readonly key: string;
  readonly kind: "confirmed" | "hold" | "block" | "in_use" | "free";
  /** The Diary booking the line words, so a reader can tell its own; null
   *  for a free line or another event's phase. */
  readonly bookingId: string | null;
  /** "1st option MacLeod wedding, 12:00–23:00, decides Tue 1 Dec". */
  readonly text: string;
  /** Among several, without the title: "1st option 12:00–23:00, decides Tue
   *  1 Dec". A free line says it whole. */
  readonly brief: string;
}

export interface DayAnswerRoom {
  readonly id: string;
  readonly name: string;
  readonly lines: readonly DayAnswerLine[];
  /** Nothing holds or uses the room that day ("Free", "Free from 01:00",
   *  interest only). */
  readonly free: boolean;
}

export function dayAnswer(
  entries: readonly CalendarEntry[],
  rooms: readonly CalendarRoom[],
  day: { readonly startMs: number; readonly endMs: number },
  nowMs: number,
): readonly DayAnswerRoom[] {
  const copy = BOARD_COPY.goTo;
  const bookingLine = (entry: CalendarBookingEntry): DayAnswerLine => {
    const time = bookingTimeLabel(entry);
    const own = { key: entry.id, bookingId: entry.id };
    if (entry.kind === "ink") {
      return { ...own, kind: "confirmed", text: copy.confirmed(entry.title, time), brief: copy.brief(copy.places.confirmed, time, null) };
    }
    if (entry.kind === "internal_block") {
      return { ...own, kind: "block", text: copy.block(entry.title, time), brief: copy.brief(copy.places.block, time, null) };
    }
    // As the Diary's decisions list: a decision is overdue the moment it passes.
    const decisionMs = entry.decisionAt === null ? null : Date.parse(entry.decisionAt);
    const decision = decisionMs === null ? null : copy.decision(formatInlineDay(decisionMs, nowMs), decisionMs < nowMs);
    return {
      ...own,
      kind: "hold",
      text: copy.hold(entry.rank, entry.jointFlag, entry.title, time, decision),
      brief: copy.brief(BOARD_COPY.decisions.option(entry.rank, entry.jointFlag), time, decision),
    };
  };
  const phaseLine = (phase: CalendarPhaseEntry): DayAnswerLine => {
    const time = bookingTimeLabel(phase);
    return { key: phase.id, kind: "in_use", bookingId: null, text: copy.inUse(phase.eventName, phase.name, time), brief: copy.brief(copy.places.inUse, time, null) };
  };
  return roomsOnDay(entries, rooms, day).map((answer) => {
    // By start time; on a tie a booking keeps its place before a phase.
    const taken = [
      ...answer.bookings.map((entry) => ({ startMs: Date.parse(entry.startsAt), line: bookingLine(entry) })),
      ...answer.phases.map((phase) => ({ startMs: Date.parse(phase.startsAt), line: phaseLine(phase) })),
    ].sort((a, b) => a.startMs - b.startMs);
    const free = copy.free(answer.interest, answer.freeFromMs === null ? null : formatWallTime(answer.freeFromMs));
    return {
      id: answer.roomId,
      name: answer.room,
      free: taken.length === 0,
      lines: taken.length > 0 ? taken.map((item) => item.line) : [{ key: "free", kind: "free", bookingId: null, text: free, brief: free }],
    };
  });
}

/** How many of a day's rooms are free: inside a sentence, as Find says it
 *  after the date ("all 6 rooms free"), or as an answer of its own ("All 6
 *  rooms free", "5 of 6 rooms free", "No room free"). A venue of one room
 *  names it. */
export function freeRoomsSaid(rooms: readonly { readonly name: string; readonly free: boolean }[], sentenceStart: boolean): string {
  const only = rooms.length === 1 ? rooms[0] : undefined;
  if (only !== undefined) return BOARD_COPY.goTo.oneRoom(only.name, only.free);
  const said = BOARD_COPY.goTo.roomsFree(rooms.filter((room) => room.free).length, rooms.length);
  return sentenceStart ? `${said.charAt(0).toUpperCase()}${said.slice(1)}` : said;
}

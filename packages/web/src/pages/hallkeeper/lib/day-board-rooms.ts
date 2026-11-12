import type { CalendarRoom } from "@omnitwin/types";
import {
  formatMinutes,
  type DayBoardLane,
  type DayBoardSlot,
  type DayBoardState,
  type DayBoardTone,
  type UnownedRequest,
} from "./day-board-state.js";

// ---------------------------------------------------------------------------
// The rooms board (the Day Board in the desks' register, Blake's concept C,
// chosen 10 November 2026): the day read room by room. Each room's slots fall
// into what has finished, what the room is doing or will do first, what
// comes next and what comes after; the copper plane counts the day and its
// counts filter the rooms; one sentence says what matters. Pure, like the
// state machine it reads: the page renders what this returns.
// ---------------------------------------------------------------------------

/** A room's day as the rooms board reads it. */
export interface RoomDay {
  readonly room: CalendarRoom;
  /** Every slot in the room on the day shown, in time order. */
  readonly slots: readonly DayBoardSlot[];
  /** What has finished, in time order. */
  readonly earlier: readonly DayBoardSlot[];
  /** What the room is doing now, or the first thing it will do. */
  readonly lead: DayBoardSlot | null;
  /** Everything after the lead that is already under way beside it, in
   *  whatever state (a talk inside a running exhibition, a second option
   *  clearing down): "Also now", never "Next" or "Later". */
  readonly alsoNow: readonly DayBoardSlot[];
  /** The first function after the lead that is not yet under way. */
  readonly next: DayBoardSlot | null;
  /** Everything after the next. */
  readonly later: readonly DayBoardSlot[];
  /** The room's edge: red while anything still ahead of it is at risk, else
   *  its lead's tone, faded once the room's day is done. */
  readonly tone: DayBoardTone;
}

/** Under way: past its doors and not finished. */
function underWay(slot: DayBoardSlot): boolean {
  return slot.state === "live" || slot.state === "clear-down" || slot.exception === "overrun";
}

export function roomDay(lane: DayBoardLane): RoomDay {
  const earlier = lane.slots.filter((slot) => slot.state === "done");
  const ahead = lane.slots.filter((slot) => slot.state !== "done");
  const lead = ahead[0] ?? null;
  const after = ahead.slice(1);
  // A slot under way is happening now whatever comes after it in time order:
  // it is never named "Next" or "Later".
  const alsoNow = after.filter(underWay);
  const toCome = after.filter((slot) => !underWay(slot));
  const atRisk = ahead.some((slot) => slot.state === "exception");
  return {
    room: lane.room,
    slots: lane.slots,
    earlier,
    lead,
    alsoNow,
    next: toCome[0] ?? null,
    later: toCome.slice(1),
    tone: atRisk ? "red" : lead?.tone ?? (earlier.length > 0 ? "faded" : "quiet"),
  };
}

// ---------------------------------------------------------------------------
// The copper plane: the day in counts, each count a filter on the rooms.
// ---------------------------------------------------------------------------

export type BoardFocus = "all" | "risk" | "waiting" | "live" | "setup" | "ahead";

/** The states between the organisers being due and the doors opening. */
const GETTING_READY: ReadonlySet<DayBoardState> = new Set<DayBoardState>(["organisers-due", "guests-due", "imminent"]);

function slotInFocus(slot: DayBoardSlot, focus: BoardFocus): boolean {
  switch (focus) {
    case "all": return true;
    case "risk": return slot.state === "exception";
    case "waiting": return (slot.attention?.unownedCount ?? 0) > 0;
    case "live": return slot.state === "live";
    case "setup": return GETTING_READY.has(slot.state);
    case "ahead": return slot.state === "scheduled";
    default: {
      const exhausted: never = focus;
      return exhausted;
    }
  }
}

/** Whether a room has anything the focus asks about. */
export function roomInFocus(day: RoomDay, focus: BoardFocus): boolean {
  return day.slots.some((slot) => slotInFocus(slot, focus));
}

export interface PlaneStage {
  readonly focus: BoardFocus;
  readonly label: string;
  readonly count: number;
  /** What the count covers that its filter cannot show, or null. */
  readonly note: string | null;
}

/** The plane's counts of functions, in the order a day asks for attention.
 *  "Requests waiting" counts the requests nobody has, and its filter shows
 *  the rooms whose bookings they are on. Today (`waiting` given) it counts
 *  every one of them, as the list beside the rooms and the sentence do, and
 *  says how many are on no booking of today's, so a filter that shows fewer
 *  rooms, or none, never contradicts it. Another day it counts those on
 *  that day's own bookings and says so, beside a list of today's. */
export function planeStages(lanes: readonly DayBoardLane[], waiting?: number): readonly PlaneStage[] {
  const slots = lanes.flatMap((lane) => lane.slots);
  const count = (focus: BoardFocus): number => slots.filter((slot) => slotInFocus(slot, focus)).length;
  const onBookings = slots.reduce((sum, slot) => sum + (slot.attention?.unownedCount ?? 0), 0);
  const elsewhere = waiting === undefined ? 0 : Math.max(0, waiting - onBookings);
  const requests: PlaneStage = waiting === undefined
    ? { focus: "waiting", label: "Waiting this day", count: onBookings, note: null }
    : {
      focus: "waiting",
      label: "Requests waiting",
      count: waiting,
      note: elsewhere === 0 ? null : `${String(elsewhere)} not on today’s bookings`,
    };
  return [
    { focus: "risk", label: "At risk", count: count("risk"), note: null },
    requests,
    { focus: "live", label: "Live", count: count("live"), note: null },
    { focus: "setup", label: "Setting up", count: count("setup"), note: null },
    { focus: "ahead", label: "Still to come", count: count("ahead"), note: null },
    { focus: "all", label: "Bookings", count: slots.length, note: null },
  ];
}

const NUMBER_WORDS: readonly string[] = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** A count to begin a sentence with: "Three", or "13" past ten. */
export function countWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** "A, B and C". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/** What the list of rooms shows under the plane. It names the rooms (the
 *  plane counts functions, so a second count here would only disagree):
 *  "Six rooms in use", "Live now in Saloon and North Gallery". */
export function showingLine(rooms: readonly string[], focus: BoardFocus): string {
  const where = rooms.length > 3 ? `${countWord(rooms.length).toLowerCase()} rooms` : listed(rooms);
  const none = rooms.length === 0;
  switch (focus) {
    case "all": return `${countWord(rooms.length)} ${plural(rooms.length, "room", "rooms")} in use`;
    case "risk": return none ? "Nothing is at risk" : `At risk in ${where}`;
    case "waiting": return none ? "No room has a request waiting" : `Requests waiting in ${where}`;
    case "live": return none ? "Nothing is live" : `Live now in ${where}`;
    case "setup": return none ? "Nothing is setting up" : `Setting up in ${where}`;
    case "ahead": return none ? "Nothing still to come" : `Still to come in ${where}`;
    default: {
      const exhausted: never = focus;
      return exhausted;
    }
  }
}

// ---------------------------------------------------------------------------
// The sentence under the title: what matters, from the board alone.
// ---------------------------------------------------------------------------

/** A run of the sentence; a strong run may carry the tone of what it names. */
export type SummaryPart = string | { readonly strong: string; readonly tone?: "risk" | "copper" };

function riskParts(lanes: readonly DayBoardLane[], today: boolean): readonly SummaryPart[] {
  const rooms = lanes.filter((lane) => lane.slots.some((slot) => slot.state === "exception"));
  const only = rooms[0];
  if (only === undefined) return [];
  if (rooms.length > 1) {
    const names = listed(rooms.map((lane) => lane.room.name));
    // "Now" only of today: another day's changeover is at risk, not urgent.
    // The names are rooms, so the count is of rooms.
    return today
      ? [{ strong: `${countWord(rooms.length)} rooms`, tone: "risk" }, ` need you now: ${names}.`]
      : [{ strong: `${countWord(rooms.length)} rooms`, tone: "risk" }, ` have a changeover at risk: ${names}.`];
  }
  const overrun = only.slots.some((slot) => slot.exception === "overrun");
  return overrun
    ? [{ strong: only.room.name, tone: "risk" }, " is running over."]
    : [{ strong: only.room.name, tone: "risk" }, "’s changeover is at risk."];
}

function requestParts(lanes: readonly DayBoardLane[], unowned: readonly UnownedRequest[], nowMs: number): readonly SummaryPart[] {
  if (unowned.length === 0) {
    const anyOpen = lanes.some((lane) => lane.slots.some((slot) => slot.attention !== null));
    return anyOpen ? ["Every request is in hand."] : [];
  }
  const oldest = Math.min(...unowned.map((request) => request.createdAtMs));
  const waited = formatMinutes(Math.max(0, Math.floor((nowMs - oldest) / 60_000)));
  if (unowned.length === 1) {
    return [{ strong: "One request", tone: "copper" }, " has no one on it, waiting ", { strong: waited }, "."];
  }
  return [
    { strong: `${countWord(unowned.length)} requests`, tone: "copper" },
    " have no one on them; the longest has waited ", { strong: waited }, ".",
  ];
}

/** Functions, as the plane counts them: a room can hold a live function and
 *  the next one getting ready, and both are said. */
function activityParts(lanes: readonly DayBoardLane[]): readonly SummaryPart[] {
  const slots = lanes.flatMap((lane) => lane.slots);
  const live = slots.filter((slot) => slot.state === "live").length;
  const ready = slots.filter((slot) => GETTING_READY.has(slot.state)).length;
  if (live > 0 && ready > 0) {
    return [`${countWord(live)} ${plural(live, "function is", "functions are")} live and ${countWord(ready).toLowerCase()} ${plural(ready, "is", "are")} getting ready.`];
  }
  if (live > 0) return [`${countWord(live)} ${plural(live, "function is", "functions are")} live.`];
  if (ready > 0) return [`${countWord(ready)} ${plural(ready, "function is", "functions are")} getting ready.`];
  const ahead = slots.filter((slot) => slot.state === "scheduled").length;
  if (ahead > 0) return [`${countWord(ahead)} ${plural(ahead, "booking is", "bookings are")} still to come.`];
  const clearing = lanes.filter((lane) => lane.slots.some((slot) => slot.state === "clear-down")).length;
  if (clearing > 0) return [`${countWord(clearing)} ${plural(clearing, "room is", "rooms are")} clearing down.`];
  const busy = lanes.some((lane) => lane.slots.some((slot) => slot.state !== "done"));
  return busy ? [] : ["Every room is done for the day."];
}

/** Clauses one after another, a space between each. */
function sentences(clauses: readonly (readonly SummaryPart[])[]): readonly SummaryPart[] {
  return clauses.filter((clause) => clause.length > 0).flatMap((clause, index) => (index === 0 ? clause : [" ", ...clause]));
}

/**
 * One sentence of what matters on the day shown, or null when nothing is
 * booked (the board says that in its own words). Today it names the rooms at
 * risk, the requests nobody has and how many rooms are live or getting
 * ready; another day says how much is booked and anything already at risk.
 */
export function boardSummary(input: {
  readonly lanes: readonly DayBoardLane[];
  readonly unowned: readonly UnownedRequest[];
  readonly today: boolean;
  readonly nowMs: number;
}): readonly SummaryPart[] | null {
  const { lanes, unowned, today, nowMs } = input;
  const bookings = lanes.reduce((sum, lane) => sum + lane.slots.length, 0);
  if (bookings === 0) return null;
  const risk = riskParts(lanes, today);
  if (!today) {
    const rooms = lanes.filter((lane) => lane.slots.length > 0).length;
    return sentences([
      [{ strong: `${countWord(bookings)} ${plural(bookings, "booking", "bookings")}` }, ` across ${countWord(rooms).toLowerCase()} ${plural(rooms, "room", "rooms")}.`],
      risk,
    ]);
  }
  const parts = sentences([risk, requestParts(lanes, unowned, nowMs), activityParts(lanes)]);
  return parts.length === 0 ? null : parts;
}

/** The sentence as plain text, for a label or a test. */
export function summaryText(parts: readonly SummaryPart[]): string {
  return parts.map((part) => (typeof part === "string" ? part : part.strong)).join("");
}

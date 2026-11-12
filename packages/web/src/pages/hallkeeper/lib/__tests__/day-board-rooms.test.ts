import { describe, expect, it } from "vitest";
import type { CalendarResponse } from "@omnitwin/types";
import { boardRange } from "../../../diary/lib/board-time.js";
import { deriveDayBoard, runningDays, type DayBoardSlotObservation, type DayBoardSlotRequest } from "../day-board-state.js";
import { boardWindow } from "../day-board-layout.js";
import { boardSummary, countWord, planeStages, roomDay, roomInFocus, showingLine, summaryText } from "../day-board-rooms.js";
import { turnRound } from "../../DayBoardRooms.js";

// The rooms board's reading of a day (concept C): a room's slots fall into
// earlier, lead, next and later; the plane counts and filters; the sentence
// says only what the board knows. The crowded day is read in
// day-board-crowded.test.ts; these are the edges.

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
const TZ = "Europe/London";
/** 13:00 on a summer Wednesday in Glasgow. */
const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const HOUR = 3_600_000;
const MIN = 60_000;
const DAY = boardRange(NOW, "day", TZ);

function response(entries: CalendarResponse["entries"] = []): CalendarResponse {
  return {
    venueId: VENUE,
    range: { from: new Date(DAY.fromMs).toISOString(), to: new Date(DAY.toMs).toISOString() },
    rooms: [
      { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
      { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
    ],
    entries,
    conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "" } } },
    turnaroundRules: [{ spaceId: null, eventType: null, name: "House", minutes: 60, isActive: true }],
  };
}

function booking(id: string, startOffsetMin: number, endOffsetMin: number, overrides: Partial<{ spaceId: string; title: string }> = {}): CalendarResponse["entries"][number] {
  return {
    entryType: "booking", id, spaceId: overrides.spaceId ?? GRAND_HALL, kind: "ink", status: "active", state: "ink", title: overrides.title ?? `Booking ${id}`,
    eventType: "dinner", startsAt: new Date(NOW + startOffsetMin * MIN).toISOString(), endsAt: new Date(NOW + endOffsetMin * MIN).toISOString(),
    rank: null, jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
  } as CalendarResponse["entries"][number];
}

function request(id: string, bookingId: string, minutesAgo: number, ownerUserId: string | null = null): DayBoardSlotRequest {
  return {
    id, bookingId, roomId: GRAND_HALL, kind: "chairs", quantity: 4, urgency: "soon",
    state: ownerUserId === null ? "sent" : "accepted", ownerUserId, ownerName: ownerUserId === null ? null : "Elaine",
    createdAt: new Date(NOW - minutesAgo * MIN).toISOString(),
  };
}

describe("a room's day", () => {
  it("puts the finished first, then what the room is doing, what comes next and what comes after", () => {
    const board = deriveDayBoard(response([
      booking("a", -6 * 60, -5 * 60), booking("b", -60, 60), booking("c", 3 * 60, 4 * 60), booking("d", 6 * 60, 7 * 60),
    ]), NOW, TZ);
    const lane = board.lanes[0];
    if (lane === undefined) throw new Error("no lane");
    const day = roomDay(lane);
    expect(day.earlier.map((slot) => slot.bookingId)).toEqual(["a"]);
    expect(day.lead?.bookingId).toBe("b");
    expect(day.next?.bookingId).toBe("c");
    expect(day.later.map((slot) => slot.bookingId)).toEqual(["d"]);
    expect(day.tone).toBe("live");
  });

  it("reddens a room's edge while anything ahead of it is at risk, not only what it shows first", () => {
    const blocking = response([booking("a", -60, 60), booking("b", 3 * 60, 4 * 60), booking("c", 4 * 60 + 10, 5 * 60)]);
    const board = deriveDayBoard({
      ...blocking,
      conflicts: { ...blocking.conflicts, conflicts: [{ id: "x", type: "insufficient_turnaround", severity: "blocking", spaceId: GRAND_HALL, entryIds: ["b", "c"], explanation: "10 minutes between events; this changeover needs 60." }] },
    } as CalendarResponse, NOW, TZ);
    const lane = board.lanes[0];
    if (lane === undefined) throw new Error("no lane");
    const day = roomDay(lane);
    // The live dinner leads; the risk is under Next and Later.
    expect(day.lead?.state).toBe("live");
    expect(day.later.map((slot) => slot.state)).toEqual(["exception"]);
    expect(day.tone).toBe("red");
  });

  it("names every function under way beside the lead \"Also now\", whatever its state, never \"Next\" or \"Later\"", () => {
    const exhibition = { ...booking("x", -50 * 60, 52 * 60), title: "Exhibition" } as CalendarResponse["entries"][number];
    // Inside the running exhibition: two talks live, a coffee clearing down
    // (nothing after it until the dinner, so its clear-down runs on), and a
    // dinner still to come.
    const board = deriveDayBoard(response([
      exhibition, booking("t", -30, 60), booking("u", -20, 40), booking("c", -15, -5), booking("d", 3 * 60, 5 * 60),
    ]), NOW, TZ);
    const lane = board.lanes[0];
    if (lane === undefined) throw new Error("no lane");
    const day = roomDay(lane);
    expect(day.lead?.bookingId).toBe("x");
    expect(day.alsoNow.map((slot) => [slot.bookingId, slot.state])).toEqual([["t", "live"], ["u", "live"], ["c", "clear-down"]]);
    expect(day.next?.bookingId).toBe("d");
    expect(day.later).toEqual([]);
    // Alone, the exhibition has nothing beside it.
    expect(roomDay({ ...lane, slots: lane.slots.slice(0, 1) }).alsoNow).toEqual([]);
  });

  it("dimensions no turn-round between two bookings at once: a second option, a talk inside an exhibition", () => {
    const board = deriveDayBoard(response([booking("first", 6 * 60, 10 * 60), booking("second", 6 * 60, 10 * 60)]), NOW, TZ);
    expect(board.lanes[0]?.slots.map((slot) => slot.gapBefore)).toEqual([null, null]);
    // Back to back is still a changeover, short of its rule.
    const tight = deriveDayBoard(response([booking("a", 60, 120), booking("b", 120, 180)]), NOW, TZ);
    expect(tight.lanes[0]?.slots[1]?.gapBefore).toEqual({ minutes: 0, neededMinutes: 60, short: true });
  });

  it("fades a room whose day is done, and keeps a room with nothing on quiet", () => {
    const board = deriveDayBoard(response([booking("a", -6 * 60, -5 * 60)]), NOW, TZ);
    const [grandHall, saloon] = board.lanes.map(roomDay);
    expect(grandHall?.lead).toBeNull();
    expect(grandHall?.tone).toBe("faded");
    expect(saloon?.slots).toEqual([]);
    expect(saloon?.tone).toBe("quiet");
  });
});

describe("the turn-round's words", () => {
  /** The day under a house rule of an hour and a half, with any blocking
   *  turnaround conflicts the Diary reports. */
  function ruled(entries: CalendarResponse["entries"], blocking: readonly (readonly [string, string])[] = []): CalendarResponse {
    const base = response(entries);
    return {
      ...base,
      turnaroundRules: [{ spaceId: null, eventType: null, name: "House", minutes: 90, isActive: true }],
      conflicts: { ...base.conflicts, conflicts: blocking.map(([first, second], index) => ({
        id: `c${String(index)}`, type: "insufficient_turnaround", severity: "blocking", spaceId: GRAND_HALL,
        entryIds: [first, second], explanation: "45 minutes between events; this changeover needs 90.",
      })) },
    } as CalendarResponse;
  }
  function slotOf(response: CalendarResponse, id: string): Parameters<typeof turnRound>[0] {
    const slot = deriveDayBoard(response, NOW, TZ).lanes[0]?.slots.find((candidate) => candidate.bookingId === id);
    if (slot === undefined) throw new Error(`no slot ${id}`);
    return slot;
  }

  it("says a short turn-round whose setup is still ahead, and what the rule needs", () => {
    const day = ruled([booking("a", 60, 120), booking("b", 165, 240)]);
    expect(turnRound(slotOf(day, "b"), NOW)).toBe("Turn-round 45 min · needs 1 h 30");
  });

  it("gives a turn-round the rule covers by its length alone", () => {
    expect(turnRound(slotOf(ruled([booking("a", 60, 120), booking("b", 240, 300)]), "b"), NOW)).toBe("Turn-round 2 h");
  });

  it("says nothing before a room's first function, once setup is due, or when the changeover is at risk and says why itself", () => {
    const day = ruled([booking("a", 60, 120), booking("b", 165, 240)]);
    expect(turnRound(slotOf(day, "a"), NOW)).toBeNull();
    // Setup is due at 165 minutes: by then the turn-round has been spent.
    expect(turnRound(slotOf(day, "b"), NOW + 165 * MIN)).toBeNull();
    expect(turnRound(slotOf(day, "b"), NOW + 164 * MIN)).toBe("Turn-round 45 min · needs 1 h 30");
    const atRisk = slotOf(ruled([booking("a", 60, 120), booking("b", 165, 240)], [["a", "b"]]), "b");
    expect(atRisk.exception).not.toBeNull();
    expect(atRisk.exceptionDetail).toBe("45 minutes between events; this changeover needs 90.");
    expect(turnRound(atRisk, NOW)).toBeNull();
  });
});

describe("the plane", () => {
  it("counts requests nobody has on the day's own bookings, and filters the rooms that have them", () => {
    const board = deriveDayBoard(
      response([booking("a", -60, 60), booking("b", 3 * 60, 4 * 60, { spaceId: SALOON })]),
      NOW, TZ, [request("r1", "a", 5), request("r2", "a", 2), request("r3", "a", 1, "00000000-0000-4000-8000-0000000000ff")],
    );
    const waiting = planeStages(board.lanes).find((stage) => stage.focus === "waiting");
    expect(waiting?.count).toBe(2);
    expect(board.lanes.map(roomDay).filter((day) => roomInFocus(day, "waiting")).map((day) => day.room.name)).toEqual(["Grand Hall"]);
    expect(board.lanes.map(roomDay).filter((day) => roomInFocus(day, "ahead")).map((day) => day.room.name)).toEqual(["Saloon"]);
  });

  it("says what the list shows by naming its rooms, never a second count beside the plane's", () => {
    expect(showingLine(["Grand Hall", "Saloon", "Reception Room", "Robert Adam Room", "North Gallery", "South Gallery"], "all")).toBe("Six rooms in use");
    expect(showingLine(["Grand Hall"], "risk")).toBe("At risk in Grand Hall");
    expect(showingLine(["Saloon", "Robert Adam Room", "North Gallery"], "live")).toBe("Live now in Saloon, Robert Adam Room and North Gallery");
    expect(showingLine(["A", "B", "C", "D"], "waiting")).toBe("Requests waiting in four rooms");
    expect(showingLine([], "live")).toBe("Nothing is live");
    expect(countWord(10)).toBe("Ten");
    expect(countWord(11)).toBe("11");
  });

  it("counts every request nobody has today, as the list and the sentence do, and says how many no room of today's can show", () => {
    const board = deriveDayBoard(response([booking("a", -60, 60)]), NOW, TZ, [request("r1", "a", 5)]);
    // Three on the list, one of them on today's dinner: the filter can show
    // one room's worth, and the count says where the other two are not.
    expect(planeStages(board.lanes, 3).find((stage) => stage.focus === "waiting"))
      .toEqual({ focus: "waiting", label: "Requests waiting", count: 3, note: "2 not on today’s bookings" });
    expect(planeStages(board.lanes, 1).find((stage) => stage.focus === "waiting")?.note).toBeNull();
    // Another day counts that day's own and says so, beside a list of today's.
    expect(planeStages(board.lanes).find((stage) => stage.focus === "waiting"))
      .toEqual({ focus: "waiting", label: "Waiting this day", count: 1, note: null });
  });
});

describe("the sentence under the title", () => {
  const today = (entries: CalendarResponse["entries"], requests: readonly DayBoardSlotRequest[] = [], observations: readonly DayBoardSlotObservation[] = []): string | null => {
    const board = deriveDayBoard(response(entries), NOW, TZ, requests, observations);
    const parts = boardSummary({ lanes: board.lanes, unowned: board.unowned, today: true, nowMs: NOW });
    return parts === null ? null : summaryText(parts);
  };

  it("says nothing when nothing is booked: the board says so in its own words", () => {
    expect(today([])).toBeNull();
  });

  it("names one request and how long it has waited, or that every request is in hand", () => {
    expect(today([booking("a", -60, 60)], [request("r1", "a", 7)])).toBe("One request has no one on it, waiting 7 min. One function is live.");
    expect(today([booking("a", -60, 60)], [request("r1", "a", 7, "00000000-0000-4000-8000-0000000000ff")]))
      .toBe("Every request is in hand. One function is live.");
  });

  it("counts functions, so one room live and getting ready for its next says both", () => {
    // The lunch is live; the next function's organisers are due now, its setup an hour off.
    expect(today([booking("a", -60, 30), booking("b", 60, 160)])).toBe("One function is live and one is getting ready.");
  });

  it("names a room running over, from what was seen in it", () => {
    const seen: DayBoardSlotObservation = { bookingId: "a", spaceId: GRAND_HALL, kind: "live", observedAt: new Date(NOW - 2 * HOUR).toISOString(), actorName: "Elaine" };
    expect(today([booking("a", -3 * 60, -30)], [], [seen])).toBe("Grand Hall is running over.");
  });

  it("says what is still to come before anything starts, and when the day is done", () => {
    expect(today([booking("a", 4 * 60, 5 * 60), booking("b", 6 * 60, 7 * 60, { spaceId: SALOON })])).toBe("Two bookings are still to come.");
    expect(today([booking("a", -6 * 60, -5 * 60)])).toBe("Every room is done for the day.");
  });

  it("on another day says how much is booked, and what is at risk without calling it now", () => {
    const board = deriveDayBoard(response([booking("a", 4 * 60, 5 * 60), booking("b", 6 * 60, 7 * 60, { spaceId: SALOON }), booking("c", 8 * 60, 9 * 60)]), NOW, TZ);
    const parts = boardSummary({ lanes: board.lanes, unowned: board.unowned, today: false, nowMs: NOW });
    expect(summaryText(parts ?? [])).toBe("Three bookings across two rooms.");
    const pairs = response([booking("a", 4 * 60, 5 * 60), booking("b", 5 * 60 + 5, 6 * 60), booking("c", 4 * 60, 5 * 60, { spaceId: SALOON }), booking("d", 5 * 60 + 5, 6 * 60, { spaceId: SALOON })]);
    const atRisk = deriveDayBoard({
      ...pairs,
      conflicts: { ...pairs.conflicts, conflicts: [
        { id: "x", type: "insufficient_turnaround", severity: "blocking", spaceId: GRAND_HALL, entryIds: ["a", "b"], explanation: "5 minutes; needs 60." },
        { id: "y", type: "insufficient_turnaround", severity: "blocking", spaceId: SALOON, entryIds: ["c", "d"], explanation: "5 minutes; needs 60." },
      ] },
    } as CalendarResponse, NOW, TZ);
    // The names are rooms, so the count is of rooms.
    expect(summaryText(boardSummary({ lanes: atRisk.lanes, unowned: [], today: false, nowMs: NOW }) ?? []))
      .toBe("Four bookings across two rooms. Two rooms have a changeover at risk: Grand Hall and Saloon.");
  });
});

describe("a booking that runs for days", () => {
  it("is counted in its days, venue-local, and a dinner past midnight is not", () => {
    const doors = Date.parse("2026-11-12T10:00:00.000Z");
    const end = Date.parse("2026-11-16T17:00:00.000Z");
    expect(runningDays(doors, end, Date.parse("2026-11-14T14:20:00.000Z"), TZ)).toEqual({ day: 3, of: 5 });
    expect(runningDays(doors, end, Date.parse("2026-11-16T09:00:00.000Z"), TZ)).toEqual({ day: 5, of: 5 });
    expect(runningDays(Date.parse("2026-11-14T18:30:00.000Z"), Date.parse("2026-11-15T00:30:00.000Z"), Date.parse("2026-11-15T00:10:00.000Z"), TZ)).toBeNull();
    // Ten to ten across the October clock change (25 hours) reads as it does
    // any other weekend (24 hours): two days either way.
    expect(runningDays(Date.parse("2026-10-24T09:00:00.000Z"), Date.parse("2026-10-25T10:00:00.000Z"), Date.parse("2026-10-24T12:00:00.000Z"), TZ)).toEqual({ day: 1, of: 2 });
    expect(runningDays(Date.parse("2026-10-17T09:00:00.000Z"), Date.parse("2026-10-18T09:00:00.000Z"), Date.parse("2026-10-17T12:00:00.000Z"), TZ)).toEqual({ day: 1, of: 2 });
  });

  it("counts its days on the board's day, rolling at the venue's boundary hour as the heading does", () => {
    // Thursday 12 to Monday 16 November; at 01:00 on Sunday a board whose
    // day ends at 04:00 still shows Saturday, and so does the count.
    const doors = Date.parse("2026-11-12T10:00:00.000Z");
    const end = Date.parse("2026-11-16T17:00:00.000Z");
    const sundayOneAm = Date.parse("2026-11-15T01:00:00.000Z");
    expect(runningDays(doors, end, sundayOneAm, TZ, 4)).toEqual({ day: 3, of: 5 });
    // A venue that keeps midnight counts the calendar's day, as before.
    expect(runningDays(doors, end, sundayOneAm, TZ)).toEqual({ day: 4, of: 5 });
    // At the boundary the board rolls, and the count with it.
    expect(runningDays(doors, end, Date.parse("2026-11-15T04:00:00.000Z"), TZ, 4)).toEqual({ day: 4, of: 5 });
    // An end in the small hours belongs to the board's day before it.
    expect(runningDays(doors, Date.parse("2026-11-16T02:00:00.000Z"), sundayOneAm, TZ, 4)).toEqual({ day: 3, of: 4 });
    // The slot's verb reads the same count.
    const show = { ...booking("x", 0, 60), startsAt: new Date(doors).toISOString(), endsAt: new Date(end).toISOString() } as CalendarResponse["entries"][number];
    const verb = (hour: number): string | undefined => deriveDayBoard(response([show]), sundayOneAm, TZ, [], [], hour).lanes[0]?.slots[0]?.countdown;
    expect(verb(4)).toBe("LIVE · day 3 of 5");
    expect(verb(0)).toBe("LIVE · day 4 of 5");
  });

  it("widens the window only by its own moments on the day", () => {
    // An exhibition from two days ago to two days on, and a lunch.
    const exhibition = { ...booking("x", -50 * 60, 52 * 60), title: "Exhibition" } as CalendarResponse["entries"][number];
    const board = deriveDayBoard(response([exhibition, booking("l", 0, 90, { spaceId: SALOON })]), NOW, TZ);
    expect(boardWindow(DAY, board.lanes, NOW, TZ)).toEqual({ fromMs: DAY.fromMs + 7 * HOUR, toMs: DAY.fromMs + 23 * HOUR });
    // On its last day, ending at five, it leaves the working day as it is.
    const lastDay = deriveDayBoard(response([{ ...booking("x", -74 * 60, 4 * 60), title: "Exhibition" } as CalendarResponse["entries"][number]]), NOW, TZ);
    expect(boardWindow(DAY, lastDay.lanes, NOW, TZ)).toEqual({ fromMs: DAY.fromMs + 7 * HOUR, toMs: DAY.fromMs + 23 * HOUR });
  });
});

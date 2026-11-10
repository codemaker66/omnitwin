import { describe, expect, it } from "vitest";
import type { CalendarResponse } from "@omnitwin/types";
import { boardRange } from "../../../diary/lib/board-time.js";
import { deriveDayBoard, runningDays, type DayBoardSlotObservation, type DayBoardSlotRequest } from "../day-board-state.js";
import { boardWindow } from "../day-board-layout.js";
import { boardSummary, countWord, planeStages, roomDay, roomInFocus, showingLine, summaryText } from "../day-board-rooms.js";

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

  it("fades a room whose day is done, and keeps a room with nothing on quiet", () => {
    const board = deriveDayBoard(response([booking("a", -6 * 60, -5 * 60)]), NOW, TZ);
    const [grandHall, saloon] = board.lanes.map(roomDay);
    expect(grandHall?.lead).toBeNull();
    expect(grandHall?.tone).toBe("faded");
    expect(saloon?.slots).toEqual([]);
    expect(saloon?.tone).toBe("quiet");
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

  it("says what the list shows in words a person would", () => {
    expect(showingLine(6, "all")).toBe("Six rooms in use");
    expect(showingLine(1, "risk")).toBe("One room at risk");
    expect(showingLine(0, "live")).toBe("No rooms live");
    expect(showingLine(12, "waiting")).toBe("12 rooms with requests waiting");
    expect(countWord(10)).toBe("Ten");
    expect(countWord(11)).toBe("11");
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
    expect(today([booking("a", -60, 60)], [request("r1", "a", 7)])).toBe("One request has no one on it, waiting 7 min. One room is live.");
    expect(today([booking("a", -60, 60)], [request("r1", "a", 7, "00000000-0000-4000-8000-0000000000ff")]))
      .toBe("Every request is in hand. One room is live.");
  });

  it("names a room running over, from what was seen in it", () => {
    const seen: DayBoardSlotObservation = { bookingId: "a", spaceId: GRAND_HALL, kind: "live", observedAt: new Date(NOW - 2 * HOUR).toISOString(), actorName: "Elaine" };
    expect(today([booking("a", -3 * 60, -30)], [], [seen])).toBe("Grand Hall is running over.");
  });

  it("says what is still to come before anything starts, and when the day is done", () => {
    expect(today([booking("a", 4 * 60, 5 * 60), booking("b", 6 * 60, 7 * 60, { spaceId: SALOON })])).toBe("Two bookings are still to come.");
    expect(today([booking("a", -6 * 60, -5 * 60)])).toBe("Every room is done for the day.");
  });

  it("on another day says how much is booked", () => {
    const board = deriveDayBoard(response([booking("a", 4 * 60, 5 * 60), booking("b", 6 * 60, 7 * 60, { spaceId: SALOON }), booking("c", 8 * 60, 9 * 60)]), NOW, TZ);
    const parts = boardSummary({ lanes: board.lanes, unowned: board.unowned, today: false, nowMs: NOW });
    expect(summaryText(parts ?? [])).toBe("Three bookings across two rooms.");
  });
});

describe("a booking that runs for days", () => {
  it("is counted in its days, venue-local, and a dinner past midnight is not", () => {
    const doors = Date.parse("2026-11-12T10:00:00.000Z");
    const end = Date.parse("2026-11-16T17:00:00.000Z");
    expect(runningDays(doors, end, Date.parse("2026-11-14T14:20:00.000Z"), TZ)).toEqual({ day: 3, of: 5 });
    expect(runningDays(doors, end, Date.parse("2026-11-16T09:00:00.000Z"), TZ)).toEqual({ day: 5, of: 5 });
    expect(runningDays(Date.parse("2026-11-14T18:30:00.000Z"), Date.parse("2026-11-15T00:30:00.000Z"), Date.parse("2026-11-15T00:10:00.000Z"), TZ)).toBeNull();
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

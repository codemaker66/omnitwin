import { describe, expect, it } from "vitest";
import type { CalendarResponse, RotaPerson, RotaShift } from "@omnitwin/types";
import { boardRange } from "../../../diary/lib/board-time.js";
import { deriveDayBoard } from "../day-board-state.js";
import { boardSummary, summaryText } from "../day-board-rooms.js";
import {
  crewBySlot,
  crewWords,
  rostersSetup,
  turnRoundCrew,
  unstaffedTurnRounds,
  UNSTAFFED_HORIZON_MS,
} from "../turn-round-crew.js";
import { rotaWeeksFor } from "../use-rota-day.js";

// ---------------------------------------------------------------------------
// Who is on for a turn-round: published setup shifts that belong to it (its
// room; its events, when the shift names no room; or the whole house) and
// are on for it. A rota that plans no setup on the day says nothing, rather
// than "nobody".
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
const DINNER = "00000000-0000-4000-8000-0000000000e1";
const OTHER = "00000000-0000-4000-8000-0000000000e2";
const at = (time: string): string => `2026-11-14T${time}:00.000Z`;
const ms = (time: string): number => Date.parse(at(time));
const EARLY = ms("08:00");

function person(id: string, displayName: string): RotaPerson {
  return { id, displayName, employmentType: "casual", skills: ["setup"], isActive: true, hasAccount: false };
}

let n = 0;
function shift(overrides: Partial<RotaShift>): RotaShift {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`, venueId: VENUE, staffMemberId: null, role: "setup",
    startsAt: at("12:00"), endsAt: at("17:00"), breakMinutes: 0, eventId: null, eventName: null, spaceId: HALL, spaceName: "Grand Hall",
    note: null, status: "published", revision: 1, publishedAt: at("07:00"), cancelledAt: null, cancellationNoticeHours: null,
    updatedAt: at("07:00"), updatedByName: null, issues: [], ...overrides,
  };
}

const JAMIE = "00000000-0000-4000-8000-0000000000f1";
const NGOZI = "00000000-0000-4000-8000-0000000000f2";
const KOFI = "00000000-0000-4000-8000-0000000000f3";
const PEOPLE = [person(JAMIE, "Jamie"), person(NGOZI, "Ngozi"), person(KOFI, "Kofi")];
const WINDOW = { roomId: HALL, eventIds: [OTHER, DINNER], startMs: ms("13:35"), endMs: ms("15:30") };

describe("turnRoundCrew", () => {
  it("names who is on setup in the room for the turn-round, by when they start", () => {
    const crew = turnRoundCrew(WINDOW, [
      shift({ staffMemberId: NGOZI, startsAt: at("14:00"), endsAt: at("18:00") }),
      shift({ staffMemberId: JAMIE, startsAt: at("12:00"), endsAt: at("16:00") }),
    ], PEOPLE, EARLY);
    expect(crew).toEqual({ hands: [
      { name: "Jamie", spans: [{ startsAtMs: ms("12:00"), endsAtMs: ms("16:00") }], wholeHouse: false },
      { name: "Ngozi", spans: [{ startsAtMs: ms("14:00"), endsAtMs: ms("18:00") }], wholeHouse: false },
    ], unfilled: 0, startMs: ms("13:35"), endMs: ms("15:30") });
    expect(crewWords(crew)).toBe("2 on setup");
  });

  it("holds a shift that names a room to that room, an event's shift to its turn-rounds, and marks the whole house", () => {
    const crew = turnRoundCrew(WINDOW, [
      // The wedding's crew in the Saloon is not on the Grand Hall's turn-round.
      shift({ staffMemberId: KOFI, spaceId: SALOON, eventId: DINNER }),
      shift({ staffMemberId: JAMIE, spaceId: null, eventId: DINNER }),
      shift({ staffMemberId: NGOZI, spaceId: null, eventId: null }),
    ], PEOPLE, EARLY);
    expect(crew.hands.map((hand) => [hand.name, hand.wholeHouse])).toEqual([["Jamie", false], ["Ngozi", true]]);
  });

  it("leaves out bar shifts, drafts, cancellations and shifts that miss the window", () => {
    const crew = turnRoundCrew(WINDOW, [
      shift({ staffMemberId: JAMIE, role: "bar" }),
      shift({ staffMemberId: JAMIE, status: "draft" }),
      shift({ staffMemberId: JAMIE, status: "cancelled" }),
      shift({ staffMemberId: JAMIE, startsAt: at("15:30"), endsAt: at("20:00") }),
      shift({ staffMemberId: JAMIE, startsAt: at("08:00"), endsAt: at("13:35") }),
    ], PEOPLE, EARLY);
    expect(crew).toMatchObject({ hands: [], unfilled: 0 });
    expect(crewWords(crew)).toBe("nobody on setup");
  });

  it("counts a setup need nobody fills yet, and lists a person's two shifts as two", () => {
    const crew = turnRoundCrew({ ...WINDOW, startMs: ms("11:00"), endMs: ms("19:00") }, [
      shift({ staffMemberId: null }),
      shift({ staffMemberId: JAMIE, startsAt: at("11:00"), endsAt: at("12:30") }),
      shift({ staffMemberId: JAMIE, startsAt: at("17:30"), endsAt: at("19:00") }),
      shift({ staffMemberId: NGOZI, startsAt: at("12:00"), endsAt: at("14:00") }),
      shift({ staffMemberId: NGOZI, startsAt: at("14:00"), endsAt: at("16:00") }),
    ], PEOPLE, EARLY);
    expect(crew.unfilled).toBe(1);
    expect(crew.hands).toEqual([
      { name: "Jamie", spans: [{ startsAtMs: ms("11:00"), endsAtMs: ms("12:30") }, { startsAtMs: ms("17:30"), endsAtMs: ms("19:00") }], wholeHouse: false },
      // Two shifts end to end are one stretch.
      { name: "Ngozi", spans: [{ startsAtMs: ms("12:00"), endsAtMs: ms("16:00") }], wholeHouse: false },
    ]);
  });

  it("counts, before and during a turn-round, only hands on for a quarter of an hour of what is left of it", () => {
    const window = { ...WINDOW, startMs: ms("14:00"), endMs: ms("19:00") };
    const shifts = [
      shift({ staffMemberId: JAMIE, startsAt: at("12:00"), endsAt: at("14:01") }),
      shift({ staffMemberId: NGOZI, startsAt: at("12:00"), endsAt: at("15:00") }),
      shift({ staffMemberId: KOFI, startsAt: at("18:50"), endsAt: at("22:00") }),
    ];
    // Ahead of it: Jamie leaves as it starts, Kofi comes in as it ends.
    expect(turnRoundCrew(window, shifts, PEOPLE, EARLY).hands.map((hand) => hand.name)).toEqual(["Ngozi"]);
    // At 16:00 Ngozi has gone home.
    expect(crewWords(turnRoundCrew(window, shifts, PEOPLE, ms("16:00")))).toBe("nobody on setup");
    // Once it is over, everyone who was on is listed.
    expect(turnRoundCrew(window, shifts, PEOPLE, ms("19:00")).hands.map((hand) => hand.name)).toEqual(["Jamie", "Ngozi", "Kofi"]);
  });

  it("reads a turn-round with no time to it as whoever is on at that moment", () => {
    const window = { ...WINDOW, startMs: ms("14:00"), endMs: ms("14:00") };
    const crew = turnRoundCrew(window, [
      shift({ staffMemberId: JAMIE, startsAt: at("13:00"), endsAt: at("14:00") }),
      shift({ staffMemberId: NGOZI, startsAt: at("14:00"), endsAt: at("18:00") }),
    ], PEOPLE, EARLY);
    expect(crew.hands.map((hand) => hand.name)).toEqual(["Ngozi"]);
  });

  it("knows a day the rota plans no setup from one that puts nobody on it", () => {
    const saturday = { fromMs: ms("04:00"), toMs: Date.parse("2026-11-15T04:00:00.000Z") };
    expect(rostersSetup([shift({ role: "bar", staffMemberId: JAMIE })], saturday)).toBe(false);
    expect(rostersSetup([shift({ status: "draft" })], saturday)).toBe(false);
    // A setup shift on the Monday of the same week says nothing of Saturday.
    expect(rostersSetup([shift({ startsAt: "2026-11-09T09:00:00.000Z", endsAt: "2026-11-09T12:00:00.000Z" })], saturday)).toBe(false);
    expect(rostersSetup([shift({ spaceId: SALOON, staffMemberId: JAMIE })], saturday)).toBe(true);
  });
});

describe("the crew on the board", () => {
  const TZ = "Europe/London";
  const NOW = ms("10:00");
  const DAY = boardRange(NOW, "day", TZ);

  function entry(id: string, from: string, to: string, overrides: Record<string, unknown> = {}): CalendarResponse["entries"][number] {
    return {
      entryType: "booking", id, spaceId: HALL, kind: "ink", status: "active", state: "ink", title: `Booking ${id}`,
      eventType: "dinner", startsAt: at(from), endsAt: at(to), rank: null, jointFlag: false, decisionAt: null, ownerUserId: null,
      nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null, ...overrides,
    } as CalendarResponse["entries"][number];
  }

  function board(entries: CalendarResponse["entries"], conflicts: CalendarResponse["conflicts"]["conflicts"] = []) {
    return deriveDayBoard({
      venueId: VENUE,
      range: { from: new Date(DAY.fromMs).toISOString(), to: new Date(DAY.toMs).toISOString() },
      rooms: [{ id: HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }, { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 }],
      entries,
      conflicts: { conflicts, checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "" } } },
      turnaroundRules: [{ spaceId: null, eventType: null, name: "House", minutes: 60, isActive: true }],
    }, NOW, TZ);
  }

  const DAY_OF = [
    entry("lunch", "12:00", "14:00", { eventId: OTHER }),
    entry("show", "14:30", "15:00", { kind: "viewing", state: "viewing" }),
    entry("dinner", "18:00", "23:00", { eventId: DINNER }),
    entry("tasting", "17:00", "19:00", { spaceId: SALOON }),
    // A house block after the dinner: the venue's own, no function to set,
    // even when it carries an event.
    entry("clean", "23:30", "23:59", { kind: "internal_block", state: "internal_block", eventId: DINNER }),
  ];

  it("runs each turn-round into a function from the booking before it, past a viewing, to its setup", () => {
    const lanes = board(DAY_OF).lanes;
    const crew = crewBySlot(lanes, { shifts: [shift({ staffMemberId: JAMIE, startsAt: at("15:00"), endsAt: at("18:00") })], people: PEOPLE }, DAY, NOW);
    expect([...crew.keys()]).toEqual(["dinner"]);
    expect(crew.get("dinner")).toMatchObject({ startMs: ms("14:00"), endMs: ms("18:00"), hands: [{ name: "Jamie" }] });
  });

  it("ends a turn-round where the next booking's setup starts, as its slot does", () => {
    const withSetup: CalendarResponse["entries"] = [
      entry("lunch", "11:00", "12:00", { eventId: OTHER }),
      entry("dinner", "18:00", "23:00", { eventId: DINNER }),
      { entryType: "phase", id: "00000000-0000-4000-8000-0000000000d1", spaceId: HALL, eventId: DINNER, eventName: "Dinner", name: "Set-up", startsAt: at("12:30"), endsAt: at("18:00"), sortOrder: 0 },
    ];
    const lanes = board(withSetup).lanes;
    const crew = crewBySlot(lanes, { shifts: [shift({ staffMemberId: JAMIE, startsAt: at("16:00"), endsAt: at("18:00") })], people: PEOPLE }, DAY, NOW);
    // The 16:00 hand sets the dinner up; nobody strikes the lunch by 12:30.
    expect(crew.get("dinner")).toMatchObject({ startMs: ms("12:00"), endMs: ms("12:30"), hands: [] });
  });

  it("counts a confirmed function with no event as a function, and a hold as one", () => {
    const lanes = board([
      entry("lunch", "12:00", "14:00"),
      entry("dinner", "18:00", "23:00"),
      entry("before", "09:00", "11:00", { spaceId: SALOON }),
      entry("option", "19:00", "23:00", { spaceId: SALOON, kind: "hold", state: "hold" }),
    ]).lanes;
    const crew = crewBySlot(lanes, { shifts: [shift({ staffMemberId: JAMIE, spaceId: null, startsAt: at("10:00"), endsAt: at("19:00") })], people: PEOPLE }, DAY, NOW);
    expect([...crew.keys()].sort()).toEqual(["dinner", "option"]);
  });

  it("says nothing on a day without setup, and names the rooms whose turn-round has nobody", () => {
    const lanes = board(DAY_OF).lanes;
    expect(crewBySlot(lanes, { shifts: [shift({ role: "bar", staffMemberId: JAMIE })], people: PEOPLE }, DAY, NOW).size).toBe(0);
    const empty = crewBySlot(lanes, { shifts: [shift({ spaceId: SALOON, staffMemberId: JAMIE, startsAt: at("08:00"), endsAt: at("10:00") })], people: PEOPLE }, DAY, NOW);
    const unstaffed = unstaffedTurnRounds(lanes, empty, NOW);
    expect(unstaffed).toEqual(["Grand Hall"]);
    // Today looks two hours ahead: at 10:00 the 14:00 turn-round is not yet
    // said; by 12:00 it is, and once its setup starts it is not.
    expect(unstaffedTurnRounds(lanes, empty, NOW, UNSTAFFED_HORIZON_MS)).toEqual([]);
    expect(unstaffedTurnRounds(lanes, empty, ms("12:00"), UNSTAFFED_HORIZON_MS)).toEqual(["Grand Hall"]);
    expect(unstaffedTurnRounds(lanes, empty, ms("18:00"))).toEqual([]);
    const summary = boardSummary({ lanes, unowned: [], today: true, nowMs: NOW, unstaffed });
    expect(summaryText(summary ?? [])).toContain("Grand Hall’s turn-round has nobody on setup.");
    const two = boardSummary({ lanes, unowned: [], today: false, nowMs: NOW, unstaffed: ["Grand Hall", "Grand Hall", "Saloon"] });
    expect(summaryText(two ?? [])).toContain("Three turn-rounds have nobody on setup: Grand Hall and Saloon.");
  });

  it("leaves a provisional booking out of the sentence, and a changeover already at risk to the risk", () => {
    const shifts = [shift({ spaceId: SALOON, staffMemberId: JAMIE, startsAt: at("08:00"), endsAt: at("10:00") })];
    const held = board([entry("lunch", "12:00", "14:00"), entry("option", "18:00", "23:00", { kind: "hold", state: "hold" })]).lanes;
    const heldCrew = crewBySlot(held, { shifts, people: PEOPLE }, DAY, NOW);
    expect(heldCrew.get("option")?.hands).toEqual([]);
    expect(unstaffedTurnRounds(held, heldCrew, NOW)).toEqual([]);
    const lanes = board(DAY_OF, [{
      id: "risk", type: "insufficient_turnaround", severity: "blocking", spaceId: HALL,
      entryIds: ["lunch", "dinner"], explanation: "No time between them.",
    }]).lanes;
    const empty = crewBySlot(lanes, { shifts, people: PEOPLE }, DAY, NOW);
    expect(empty.get("dinner")?.hands).toEqual([]);
    expect(unstaffedTurnRounds(lanes, empty, NOW)).toEqual([]);
  });
});

describe("rotaWeeksFor", () => {
  it("reads one week for a weekday, and both when a Sunday's late hours run into Monday", () => {
    const tz = "Europe/London";
    // Saturday 14 November 2026, 04:00 to 04:00.
    expect(rotaWeeksFor(Date.parse("2026-11-14T04:00:00Z"), Date.parse("2026-11-15T04:00:00Z"), tz)).toEqual(["2026-11-09"]);
    // Sunday 15 November, 04:00 to Monday 04:00.
    expect(rotaWeeksFor(Date.parse("2026-11-15T04:00:00Z"), Date.parse("2026-11-16T04:00:00Z"), tz)).toEqual(["2026-11-09", "2026-11-16"]);
    // Sunday to midnight exactly is still one week.
    expect(rotaWeeksFor(Date.parse("2026-11-15T00:00:00Z"), Date.parse("2026-11-16T00:00:00Z"), tz)).toEqual(["2026-11-09"]);
  });
});

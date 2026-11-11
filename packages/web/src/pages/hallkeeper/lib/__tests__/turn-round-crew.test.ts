import { describe, expect, it } from "vitest";
import type { CalendarResponse, RotaPerson, RotaShift } from "@omnitwin/types";
import { boardRange } from "../../../diary/lib/board-time.js";
import { deriveDayBoard } from "../day-board-state.js";
import { boardSummary, summaryText } from "../day-board-rooms.js";
import { crewBySlot, crewWords, rostersSetup, turnRoundCrew, unstaffedTurnRounds, UNSTAFFED_HORIZON_MS } from "../turn-round-crew.js";
import { rotaWeeksFor } from "../use-rota-day.js";

// ---------------------------------------------------------------------------
// Who is on for a turn-round: published setup shifts that overlap it and
// belong to it (its room, either booking's event, or the whole house). A
// rota that plans no setup says nothing, rather than "nobody".
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
const DINNER = "00000000-0000-4000-8000-0000000000e1";
const OTHER = "00000000-0000-4000-8000-0000000000e2";
const at = (time: string): string => `2026-11-14T${time}:00.000Z`;
const ms = (time: string): number => Date.parse(at(time));

function person(id: string, displayName: string): RotaPerson {
  return { id, displayName, employmentType: "casual", skills: ["setup"], isActive: true, hasAccount: false };
}

let n = 0;
function shift(overrides: Partial<RotaShift>): RotaShift {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`, venueId: VENUE, staffMemberId: null, role: "setup",
    startsAt: at("12:00"), endsAt: at("17:00"), breakMinutes: 0, eventId: null, eventName: null, spaceId: HALL, spaceName: "Grand Hall",
    note: null, status: "published", revision: 1, publishedAt: at("09:00"), cancelledAt: null, cancellationNoticeHours: null,
    updatedAt: at("09:00"), updatedByName: null, issues: [], ...overrides,
  };
}

const JAMIE = "00000000-0000-4000-8000-0000000000f1";
const NGOZI = "00000000-0000-4000-8000-0000000000f2";
const PEOPLE = [person(JAMIE, "Jamie"), person(NGOZI, "Ngozi")];
const WINDOW = { roomId: HALL, eventIds: [OTHER, DINNER], startMs: ms("13:35"), endMs: ms("15:30") };

describe("turnRoundCrew", () => {
  it("names who is on setup in the room for the turn-round, by when they start", () => {
    const crew = turnRoundCrew(WINDOW, [
      shift({ staffMemberId: NGOZI, startsAt: at("14:00"), endsAt: at("18:00") }),
      shift({ staffMemberId: JAMIE, startsAt: at("12:00"), endsAt: at("16:00") }),
    ], PEOPLE);
    expect(crew).toEqual({ hands: [
      { name: "Jamie", startsAtMs: ms("12:00"), endsAtMs: ms("16:00") },
      { name: "Ngozi", startsAtMs: ms("14:00"), endsAtMs: ms("18:00") },
    ], unfilled: 0, startMs: ms("13:35"), endMs: ms("15:30") });
    expect(crewWords(crew)).toBe("2 on setup");
  });

  it("counts a setup shift for either booking's event, or for the whole house, but not another room's", () => {
    const crew = turnRoundCrew(WINDOW, [
      shift({ staffMemberId: JAMIE, spaceId: null, eventId: DINNER }),
      shift({ staffMemberId: NGOZI, spaceId: null, eventId: null }),
      shift({ staffMemberId: "00000000-0000-4000-8000-0000000000f3", spaceId: SALOON }),
    ], [...PEOPLE, person("00000000-0000-4000-8000-0000000000f3", "Elsewhere")]);
    expect(crew.hands.map((hand) => hand.name)).toEqual(["Jamie", "Ngozi"]);
  });

  it("leaves out bar, first aid and duty shifts, drafts, cancellations and shifts that miss the window", () => {
    const crew = turnRoundCrew(WINDOW, [
      shift({ staffMemberId: JAMIE, role: "bar" }),
      shift({ staffMemberId: JAMIE, status: "draft" }),
      shift({ staffMemberId: JAMIE, status: "cancelled" }),
      shift({ staffMemberId: JAMIE, startsAt: at("15:30"), endsAt: at("20:00") }),
      shift({ staffMemberId: JAMIE, startsAt: at("08:00"), endsAt: at("13:35") }),
    ], PEOPLE);
    expect(crew).toMatchObject({ hands: [], unfilled: 0 });
    expect(crewWords(crew)).toBe("nobody on setup");
  });

  it("counts a setup need nobody fills yet, and names a person once across two shifts", () => {
    const crew = turnRoundCrew(WINDOW, [
      shift({ staffMemberId: null }),
      shift({ staffMemberId: JAMIE, startsAt: at("12:00"), endsAt: at("14:00") }),
      shift({ staffMemberId: JAMIE, startsAt: at("14:30"), endsAt: at("17:00") }),
    ], PEOPLE);
    expect(crew).toMatchObject({ hands: [{ name: "Jamie", startsAtMs: ms("12:00"), endsAtMs: ms("17:00") }], unfilled: 1 });
  });

  it("knows a rota that plans no setup from one that puts nobody on it", () => {
    expect(rostersSetup([shift({ role: "bar", staffMemberId: JAMIE })])).toBe(false);
    expect(rostersSetup([shift({ status: "draft" })])).toBe(false);
    expect(rostersSetup([shift({ spaceId: SALOON, staffMemberId: JAMIE })])).toBe(true);
  });
});

describe("the crew on the board", () => {
  const TZ = "Europe/London";
  const NOW = Date.parse("2026-11-14T10:00:00.000Z");
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
    // A house block after the dinner: the venue's own, no function to set.
    entry("clean", "23:30", "23:59", { kind: "internal_block", state: "internal_block" }),
  ];

  it("runs each turn-round into a function from the booking before it, past a viewing, to the doors", () => {
    const lanes = board(DAY_OF).lanes;
    const crew = crewBySlot(lanes, { shifts: [shift({ staffMemberId: JAMIE, startsAt: at("15:00"), endsAt: at("18:00") })], people: PEOPLE });
    expect([...crew.keys()]).toEqual(["dinner"]);
    expect(crew.get("dinner")).toMatchObject({ startMs: ms("14:00"), endMs: ms("18:00"), hands: [{ name: "Jamie" }] });
  });

  it("says nothing when the rota plans no setup, and names the rooms whose turn-round has nobody", () => {
    const lanes = board(DAY_OF).lanes;
    expect(crewBySlot(lanes, { shifts: [shift({ role: "bar", staffMemberId: JAMIE })], people: PEOPLE }).size).toBe(0);
    const empty = crewBySlot(lanes, { shifts: [shift({ spaceId: SALOON, staffMemberId: JAMIE, startsAt: at("08:00"), endsAt: at("10:00") })], people: PEOPLE });
    const unstaffed = unstaffedTurnRounds(lanes, empty, NOW);
    expect(unstaffed).toEqual(["Grand Hall"]);
    // Today looks two hours ahead: at 10:00 the 14:00 turn-round is not yet
    // said; by 12:00 it is, and once its doors open it is over.
    expect(unstaffedTurnRounds(lanes, empty, NOW, UNSTAFFED_HORIZON_MS)).toEqual([]);
    expect(unstaffedTurnRounds(lanes, empty, ms("12:00"), UNSTAFFED_HORIZON_MS)).toEqual(["Grand Hall"]);
    expect(unstaffedTurnRounds(lanes, empty, ms("18:00"))).toEqual([]);
    const summary = boardSummary({ lanes, unowned: [], today: true, nowMs: NOW, unstaffed });
    expect(summaryText(summary ?? [])).toContain("Grand Hall’s turn-round has nobody on setup.");
    const two = boardSummary({ lanes, unowned: [], today: false, nowMs: NOW, unstaffed: ["Grand Hall", "Grand Hall", "Saloon"] });
    expect(summaryText(two ?? [])).toContain("Three turn-rounds have nobody on setup: Grand Hall and Saloon.");
  });

  it("leaves a changeover already at risk to the risk, as its slot does", () => {
    const lanes = board(DAY_OF, [{
      id: "risk", type: "insufficient_turnaround", severity: "blocking", spaceId: HALL,
      entryIds: ["lunch", "dinner"], explanation: "No time between them.",
    }]).lanes;
    const empty = crewBySlot(lanes, { shifts: [shift({ spaceId: SALOON, staffMemberId: JAMIE, startsAt: at("08:00"), endsAt: at("10:00") })], people: PEOPLE });
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

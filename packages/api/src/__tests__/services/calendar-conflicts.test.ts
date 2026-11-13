import { describe, expect, it } from "vitest";
import {
  detectCalendarConflicts,
  detectCalendarConflictsInDetail,
  measuredChangeovers,
  type ConflictBookingInput,
  type ConflictPhaseInput,
  type ConflictTurnaroundRuleInput,
} from "../../services/calendar-conflicts.js";

// ---------------------------------------------------------------------------
// Conflict engine v0 (T-490; Canon §4) — pure, deterministic, honest.
//
// Mandatory coverage per the slice prompt: Europe/London DST boundaries
// (spring forward late March + fall back late October), midnight-spanning
// events, and several bookings per room per day. Gaps are measured between
// INSTANTS (real elapsed minutes), so wall-clock illusions cannot corrupt
// turnaround checks.
// ---------------------------------------------------------------------------

const SPACE_A = "00000000-0000-4000-8000-0000000000a1";
const SPACE_B = "00000000-0000-4000-8000-0000000000b2";

let bookingCounter = 0;

function booking(overrides: Partial<ConflictBookingInput>): ConflictBookingInput {
  bookingCounter += 1;
  return {
    id: `booking-${String(bookingCounter)}`,
    spaceId: SPACE_A,
    kind: "ink",
    status: "active",
    title: `Booking ${String(bookingCounter)}`,
    eventType: null,
    startsAt: new Date("2026-09-18T18:00:00.000Z"),
    endsAt: new Date("2026-09-18T23:00:00.000Z"),
    rank: null,
    jointFlag: false,
    eventId: null,
    deletedAt: null,
    ...overrides,
  };
}

function phase(overrides: Partial<ConflictPhaseInput>): ConflictPhaseInput {
  bookingCounter += 1;
  return {
    id: `phase-${String(bookingCounter)}`,
    spaceId: SPACE_A,
    eventId: `event-${String(bookingCounter)}`,
    eventName: `Event ${String(bookingCounter)}`,
    name: "Setup",
    eventType: null,
    startsAt: new Date("2026-09-18T15:00:00.000Z"),
    endsAt: new Date("2026-09-18T18:00:00.000Z"),
    ...overrides,
  };
}

function rule(overrides: Partial<ConflictTurnaroundRuleInput>): ConflictTurnaroundRuleInput {
  return {
    spaceId: null,
    eventType: null,
    name: "House default turnaround",
    minutes: 60,
    isActive: true,
    ...overrides,
  };
}

function detect(input: {
  bookings?: readonly ConflictBookingInput[];
  phases?: readonly ConflictPhaseInput[];
  turnaroundRules?: readonly ConflictTurnaroundRuleInput[];
}): ReturnType<typeof detectCalendarConflicts> {
  return detectCalendarConflicts({
    bookings: input.bookings ?? [],
    phases: input.phases ?? [],
    turnaroundRules: input.turnaroundRules ?? [],
    timeZone: "Europe/London",
  });
}

describe("empty input", () => {
  it("reports no conflicts and honest checks", () => {
    const report = detect({});
    expect(report.conflicts).toEqual([]);
    expect(report.checks.inkDoubleBook.status).toBe("checked");
    expect(report.checks.holdOverlap.status).toBe("checked");
    expect(report.checks.turnaround.status).toBe("checked");
    expect(report.checks.turnaround.uncoveredPairCount).toBe(0);
  });
});

describe("ink double-book (blocking)", () => {
  it("flags two overlapping active inks in one space", () => {
    const a = booking({ id: "ink-a", title: "Chamber dinner" });
    const b = booking({
      id: "ink-b",
      title: "Awards night",
      startsAt: new Date("2026-09-18T21:00:00.000Z"),
      endsAt: new Date("2026-09-19T01:00:00.000Z"),
    });
    const report = detect({ bookings: [a, b] });
    expect(report.conflicts).toHaveLength(1);
    const conflict = report.conflicts[0];
    expect(conflict?.type).toBe("ink_double_book");
    expect(conflict?.severity).toBe("blocking");
    expect(conflict?.entryIds).toEqual(["ink-a", "ink-b"]);
    expect(conflict?.explanation).toContain("Chamber dinner");
    expect(conflict?.explanation).toContain("Awards night");
    expect(conflict?.explanation.toLowerCase()).toContain("human review");
  });

  it("ignores overlaps across different spaces", () => {
    const a = booking({ spaceId: SPACE_A });
    const b = booking({ spaceId: SPACE_B });
    expect(detect({ bookings: [a, b] }).conflicts).toEqual([]);
  });

  it("treats back-to-back inks as legal (half-open ranges)", () => {
    const a = booking({ endsAt: new Date("2026-09-18T18:00:00.000Z"), startsAt: new Date("2026-09-18T12:00:00.000Z") });
    const b = booking({ startsAt: new Date("2026-09-18T18:00:00.000Z"), endsAt: new Date("2026-09-18T23:00:00.000Z") });
    const report = detect({ bookings: [a, b] });
    expect(report.conflicts.filter((c) => c.type === "ink_double_book")).toEqual([]);
  });

  it("detects midnight-spanning overlaps", () => {
    const a = booking({
      id: "late",
      startsAt: new Date("2026-09-18T21:00:00.000Z"),
      endsAt: new Date("2026-09-19T01:30:00.000Z"),
    });
    const b = booking({
      id: "early",
      startsAt: new Date("2026-09-19T00:30:00.000Z"),
      endsAt: new Date("2026-09-19T04:00:00.000Z"),
    });
    const report = detect({ bookings: [a, b] });
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.type).toBe("ink_double_book");
  });
});

describe("hold overlap (advisory ladder)", () => {
  it("hold-over-hold is info with ladder-order language", () => {
    const first = booking({ id: "h1", kind: "hold", title: "MacLeod wedding", rank: 1 });
    const second = booking({
      id: "h2",
      kind: "hold",
      title: "Robertson ceilidh",
      rank: 2,
      startsAt: new Date("2026-09-18T19:00:00.000Z"),
      endsAt: new Date("2026-09-19T00:00:00.000Z"),
    });
    const report = detect({ bookings: [first, second] });
    expect(report.conflicts).toHaveLength(1);
    const conflict = report.conflicts[0];
    expect(conflict?.type).toBe("hold_overlap");
    expect(conflict?.severity).toBe("info");
    expect(conflict?.explanation).toContain("1st option");
    expect(conflict?.explanation).toContain("2nd option");
  });

  it("labels joint firsts", () => {
    const a = booking({ id: "j1", kind: "hold", rank: 1, jointFlag: true, title: "Kerr wedding" });
    const b = booking({ id: "j2", kind: "hold", rank: 1, jointFlag: true, title: "Nairn wedding" });
    const report = detect({ bookings: [a, b] });
    expect(report.conflicts[0]?.explanation).toContain("(Joint 1st)");
  });

  it("a provisional hold under a confirmed booking is a warning that it cannot be confirmed", () => {
    const ink = booking({ id: "ink-x", title: "Graduation ball" });
    const hold = booking({
      id: "hold-x",
      kind: "hold",
      rank: 1,
      title: "Fallback ceilidh",
      startsAt: new Date("2026-09-18T20:00:00.000Z"),
      endsAt: new Date("2026-09-19T00:00:00.000Z"),
    });
    const report = detect({ bookings: [ink, hold] });
    expect(report.conflicts).toHaveLength(1);
    const conflict = report.conflicts[0];
    expect(conflict?.type).toBe("hold_overlap");
    expect(conflict?.severity).toBe("warning");
    expect(conflict?.explanation).toContain("Fallback ceilidh");
    expect(conflict?.explanation).toContain("Graduation ball");
  });

  it("ignores exited holds, soft-deleted rows, prospects, and blocks", () => {
    const released = booking({ id: "r", kind: "hold", status: "released", rank: 1 });
    const deleted = booking({ id: "d", deletedAt: new Date("2026-09-01T00:00:00.000Z") });
    const prospect = booking({ id: "p", kind: "prospect" });
    const block = booking({ id: "b", kind: "internal_block" });
    const live = booking({ id: "live" });
    const report = detect({ bookings: [released, deleted, prospect, block, live] });
    expect(report.conflicts).toEqual([]);
  });
});

describe("insufficient turnaround (instant math)", () => {
  it("flags a gap shorter than the applicable venue-wide rule", () => {
    const a = booking({
      id: "first",
      title: "Morning conference",
      startsAt: new Date("2026-09-18T08:00:00.000Z"),
      endsAt: new Date("2026-09-18T12:00:00.000Z"),
    });
    const b = booking({
      id: "second",
      title: "Evening dinner",
      startsAt: new Date("2026-09-18T12:30:00.000Z"),
      endsAt: new Date("2026-09-18T23:00:00.000Z"),
    });
    const report = detect({ bookings: [a, b], turnaroundRules: [rule({ minutes: 60 })] });
    const turnarounds = report.conflicts.filter((c) => c.type === "insufficient_turnaround");
    expect(turnarounds).toHaveLength(1);
    expect(turnarounds[0]?.severity).toBe("warning");
    expect(turnarounds[0]?.explanation).toContain("30 minutes");
    expect(turnarounds[0]?.explanation).toContain("60");
    expect(turnarounds[0]?.explanation).toContain("Planning support");
    expect(report.checks.turnaround.status).toBe("checked");
  });

  it("prefers the most specific rule (space+eventType beats venue-wide)", () => {
    const a = booking({
      id: "a",
      eventType: "conference",
      startsAt: new Date("2026-09-18T08:00:00.000Z"),
      endsAt: new Date("2026-09-18T12:00:00.000Z"),
    });
    const b = booking({
      id: "b",
      eventType: "wedding",
      startsAt: new Date("2026-09-18T13:00:00.000Z"),
      endsAt: new Date("2026-09-18T23:00:00.000Z"),
    });
    const rules = [
      rule({ minutes: 30 }),
      rule({ spaceId: SPACE_A, eventType: "wedding", minutes: 90, name: "Wedding reset in this room" }),
    ];
    const report = detect({ bookings: [a, b], turnaroundRules: rules });
    const conflict = report.conflicts.find((c) => c.type === "insufficient_turnaround");
    expect(conflict).toBeDefined();
    expect(conflict?.explanation).toContain("90");
    expect(conflict?.explanation).toContain("Wedding reset in this room");
  });

  it("breaks specificity ties toward the largest minutes (fail-safe)", () => {
    const a = booking({
      id: "a",
      startsAt: new Date("2026-09-18T08:00:00.000Z"),
      endsAt: new Date("2026-09-18T12:00:00.000Z"),
    });
    const b = booking({
      id: "b",
      startsAt: new Date("2026-09-18T13:00:00.000Z"),
      endsAt: new Date("2026-09-18T23:00:00.000Z"),
    });
    const rules = [rule({ minutes: 45 }), rule({ minutes: 75, name: "Deep clean" })];
    const report = detect({ bookings: [a, b], turnaroundRules: rules });
    const conflict = report.conflicts.find((c) => c.type === "insufficient_turnaround");
    expect(conflict?.explanation).toContain("75");
  });

  it("reports not_checked when occupancy gaps exist but no rule covers them", () => {
    const a = booking({
      id: "a",
      startsAt: new Date("2026-09-18T08:00:00.000Z"),
      endsAt: new Date("2026-09-18T12:00:00.000Z"),
    });
    const b = booking({
      id: "b",
      startsAt: new Date("2026-09-18T12:10:00.000Z"),
      endsAt: new Date("2026-09-18T23:00:00.000Z"),
    });
    const report = detect({ bookings: [a, b] });
    expect(report.conflicts.filter((c) => c.type === "insufficient_turnaround")).toEqual([]);
    expect(report.checks.turnaround.status).toBe("not_checked");
    expect(report.checks.turnaround.uncoveredPairCount).toBe(1);
    expect(report.checks.turnaround.detail.toLowerCase()).toContain("not checked");
  });

  it("ignores inactive rules and reports partial coverage across spaces", () => {
    const a1 = booking({
      id: "a1",
      spaceId: SPACE_A,
      startsAt: new Date("2026-09-18T08:00:00.000Z"),
      endsAt: new Date("2026-09-18T12:00:00.000Z"),
    });
    const a2 = booking({
      id: "a2",
      spaceId: SPACE_A,
      startsAt: new Date("2026-09-18T14:00:00.000Z"),
      endsAt: new Date("2026-09-18T23:00:00.000Z"),
    });
    const b1 = booking({
      id: "b1",
      spaceId: SPACE_B,
      startsAt: new Date("2026-09-18T08:00:00.000Z"),
      endsAt: new Date("2026-09-18T12:00:00.000Z"),
    });
    const b2 = booking({
      id: "b2",
      spaceId: SPACE_B,
      startsAt: new Date("2026-09-18T12:05:00.000Z"),
      endsAt: new Date("2026-09-18T23:00:00.000Z"),
    });
    const rules = [
      rule({ spaceId: SPACE_A, minutes: 60 }),
      rule({ spaceId: SPACE_B, minutes: 240, isActive: false, name: "Retired rule" }),
    ];
    const report = detect({ bookings: [a1, a2, b1, b2], turnaroundRules: rules });
    // Space A pair is covered (120 min gap ≥ 60 → no conflict); space B pair is uncovered.
    expect(report.conflicts.filter((c) => c.type === "insufficient_turnaround")).toEqual([]);
    expect(report.checks.turnaround.status).toBe("partial");
    expect(report.checks.turnaround.uncoveredPairCount).toBe(1);
  });

  it("merges a booking with its own event's phases before measuring gaps", () => {
    const ink = booking({
      id: "ink-main",
      eventId: "event-main",
      eventType: "dinner",
      startsAt: new Date("2026-09-18T18:00:00.000Z"),
      endsAt: new Date("2026-09-18T23:00:00.000Z"),
    });
    const setup = phase({
      id: "phase-setup",
      eventId: "event-main",
      startsAt: new Date("2026-09-18T15:00:00.000Z"),
      endsAt: new Date("2026-09-18T18:00:00.000Z"),
    });
    const nextDayEvent = booking({
      id: "ink-next",
      startsAt: new Date("2026-09-18T23:30:00.000Z"),
      endsAt: new Date("2026-09-19T02:00:00.000Z"),
    });
    const report = detect({
      bookings: [ink, nextDayEvent],
      phases: [setup],
      turnaroundRules: [rule({ minutes: 45 })],
    });
    // No gap check between the setup phase and its own booking; one 30-min gap
    // between the merged occupancy (15:00–23:00) and the next ink.
    const turnarounds = report.conflicts.filter((c) => c.type === "insufficient_turnaround");
    expect(turnarounds).toHaveLength(1);
    expect(turnarounds[0]?.explanation).toContain("30 minutes");
  });

  it("handles several bookings per room per day, flagging only the tight gap", () => {
    const morning = booking({
      id: "m",
      startsAt: new Date("2026-09-18T08:00:00.000Z"),
      endsAt: new Date("2026-09-18T11:00:00.000Z"),
    });
    const noon = booking({
      id: "n",
      startsAt: new Date("2026-09-18T11:15:00.000Z"),
      endsAt: new Date("2026-09-18T15:00:00.000Z"),
    });
    const evening = booking({
      id: "e",
      startsAt: new Date("2026-09-18T15:45:00.000Z"),
      endsAt: new Date("2026-09-18T23:00:00.000Z"),
    });
    const report = detect({
      bookings: [morning, noon, evening],
      turnaroundRules: [rule({ minutes: 30 })],
    });
    const turnarounds = report.conflicts.filter((c) => c.type === "insufficient_turnaround");
    expect(turnarounds).toHaveLength(1);
    expect(turnarounds[0]?.entryIds).toEqual(["m", "n"]);
  });
});

describe("Europe/London DST boundaries", () => {
  it("spring forward (29 March 2026): a 2.5h wall-clock gap is only 90 real minutes", () => {
    // Event A ends 00:30 local (GMT, = 00:30Z). Event B starts 03:00 local
    // (BST after the 01:00→02:00 spring forward, = 02:00Z). The wall clock
    // suggests 150 minutes; real elapsed time is 90.
    const a = booking({
      id: "pre-spring",
      title: "Late ceilidh",
      startsAt: new Date("2026-03-28T19:00:00.000Z"),
      endsAt: new Date("2026-03-29T00:30:00.000Z"),
    });
    const b = booking({
      id: "post-spring",
      title: "Breakfast conference",
      startsAt: new Date("2026-03-29T02:00:00.000Z"),
      endsAt: new Date("2026-03-29T08:00:00.000Z"),
    });
    const report = detect({ bookings: [a, b], turnaroundRules: [rule({ minutes: 120 })] });
    const conflict = report.conflicts.find((c) => c.type === "insufficient_turnaround");
    expect(conflict).toBeDefined();
    expect(conflict?.explanation).toContain("90 minutes");
  });

  it("fall back (25 October 2026): a 2h wall-clock gap is really 3 hours — no conflict", () => {
    // Event A ends 00:30 local BST (= 2026-10-24T23:30Z). Event B starts
    // 02:30 local GMT after the fold (= 02:30Z). Wall clock suggests 120
    // minutes; real elapsed time is 180 — comfortably over a 150-minute rule.
    const a = booking({
      id: "pre-fall",
      startsAt: new Date("2026-10-24T19:00:00.000Z"),
      endsAt: new Date("2026-10-24T23:30:00.000Z"),
    });
    const b = booking({
      id: "post-fall",
      startsAt: new Date("2026-10-25T02:30:00.000Z"),
      endsAt: new Date("2026-10-25T08:00:00.000Z"),
    });
    const report = detect({ bookings: [a, b], turnaroundRules: [rule({ minutes: 150 })] });
    expect(report.conflicts.filter((c) => c.type === "insufficient_turnaround")).toEqual([]);
    expect(report.checks.turnaround.status).toBe("checked");
  });
});

// T-695 api-diary-bookings-7. One event's confirmed bookings and phases in a
// room were one span however far apart, so a two-day event swallowed what sat
// between its days: the changeovers either side were never measured, and a
// viewing in between was warned as overlapping. An event holds the room on
// each venue day it uses it (Europe/London), and an event's own days are not
// a changeover.
describe("one event's days in a room", () => {
  const at = (iso: string): Date => new Date(iso);

  it("measures the changeovers either side of another event between a two-day event's days", () => {
    const conferenceFriday = booking({ id: "conf-fri", title: "Conference", eventId: "event-conference",
      startsAt: at("2026-09-18T08:00:00.000Z"), endsAt: at("2026-09-18T16:00:00.000Z") });
    const conferenceSaturday = booking({ id: "conf-sat", title: "Conference", eventId: "event-conference",
      startsAt: at("2026-09-19T08:00:00.000Z"), endsAt: at("2026-09-19T16:00:00.000Z") });
    const dinner = booking({ id: "dinner", title: "Dinner", eventId: "event-dinner",
      startsAt: at("2026-09-18T18:00:00.000Z"), endsAt: at("2026-09-18T22:00:00.000Z") });
    const viewing = booking({ id: "viewing", kind: "viewing", title: "Show-round",
      startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-18T17:30:00.000Z") });
    const report = detect({
      bookings: [conferenceFriday, conferenceSaturday, dinner, viewing],
      turnaroundRules: [rule({ minutes: 180 })],
    });
    const turnarounds = report.conflicts.filter((c) => c.type === "insufficient_turnaround");
    expect(turnarounds.map((c) => c.id)).toEqual(["insufficient_turnaround:conf-fri:dinner"]);
    expect(turnarounds[0]?.explanation).toContain("Only 120 minutes");
    expect(report.conflicts.filter((c) => c.type === "viewing_overlap")).toEqual([]);
  });

  it("does not count an event's own days as a changeover", () => {
    const first = booking({ id: "day-1", eventId: "event-two-day",
      startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-18T22:59:00.000Z") });
    const second = booking({ id: "day-2", eventId: "event-two-day",
      startsAt: at("2026-09-19T07:00:00.000Z"), endsAt: at("2026-09-19T16:00:00.000Z") });
    const report = detect({ bookings: [first, second], turnaroundRules: [rule({ minutes: 600 })] });
    expect(report.conflicts).toEqual([]);
    expect(report.checks.turnaround.detail).toBe("No consecutive occupancy pairs in range needed a turnaround check.");
  });

  it("keeps an event's set-up on its own day with its booking, gap or not", () => {
    const setup = phase({ id: "setup", eventId: "event-gala", eventName: "Gala",
      startsAt: at("2026-09-18T10:00:00.000Z"), endsAt: at("2026-09-18T12:00:00.000Z") });
    const gala = booking({ id: "gala", title: "Gala", eventId: "event-gala",
      startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-18T22:00:00.000Z") });
    const viewing = booking({ id: "viewing", kind: "viewing", title: "Show-round",
      startsAt: at("2026-09-18T14:00:00.000Z"), endsAt: at("2026-09-18T14:30:00.000Z") });
    const report = detect({ bookings: [gala, viewing], phases: [setup] });
    // The room is set for the gala from its set-up, so the show-round meets it.
    expect(report.conflicts.map((c) => c.id)).toEqual(["viewing_overlap:gala:viewing"]);
  });

  // T-695 review D1 (probe P1): an evening that runs past the venue's
  // midnight belonged to the next day, so it joined the same event's next
  // evening and swallowed another client's lunch between them.
  it("measures the changeovers round another client's lunch between two evenings that run past midnight", () => {
    const friday = booking({ id: "w-fri", title: "Wedding weekend", eventId: "event-w",
      startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-19T00:00:00.000Z") });
    const saturday = booking({ id: "w-sat", title: "Wedding weekend", eventId: "event-w",
      startsAt: at("2026-09-19T17:00:00.000Z"), endsAt: at("2026-09-20T00:00:00.000Z") });
    const lunch = booking({ id: "lunch", title: "Lunch", eventId: "event-lunch",
      startsAt: at("2026-09-19T11:00:00.000Z"), endsAt: at("2026-09-19T14:00:00.000Z") });
    const viewing = booking({ id: "view", kind: "viewing", title: "Show-round",
      startsAt: at("2026-09-19T09:00:00.000Z"), endsAt: at("2026-09-19T09:30:00.000Z") });
    const report = detect({ bookings: [friday, saturday, lunch, viewing], turnaroundRules: [rule({ minutes: 240 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual(["insufficient_turnaround:lunch:w-sat"]);
    expect(report.conflicts[0]?.explanation).toContain("Only 180 minutes");
  });

  it("does the same across the October clock change, the first night ending at 01:00 BST", () => {
    const saturday = booking({ id: "w-sat", title: "Wedding weekend", eventId: "event-w",
      startsAt: at("2026-10-24T17:00:00.000Z"), endsAt: at("2026-10-25T00:00:00.000Z") });
    const sunday = booking({ id: "w-sun", title: "Wedding weekend", eventId: "event-w",
      startsAt: at("2026-10-25T18:00:00.000Z"), endsAt: at("2026-10-25T23:00:00.000Z") });
    const lunch = booking({ id: "lunch", title: "Lunch", eventId: "event-lunch",
      startsAt: at("2026-10-25T12:00:00.000Z"), endsAt: at("2026-10-25T15:00:00.000Z") });
    const report = detect({ bookings: [saturday, sunday, lunch], turnaroundRules: [rule({ minutes: 240 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual(["insufficient_turnaround:lunch:w-sun"]);
  });

  // T-695 review D1 (probe P3b): the spring-forward night, a party from 20:00
  // GMT to 02:00 BST, then another client's brunch, then the party's Sunday.
  it("does the same across the March clock change, the party ending at 02:00 BST", () => {
    const party = booking({ id: "party-sat", title: "Party", eventId: "event-party",
      startsAt: at("2026-03-28T20:00:00.000Z"), endsAt: at("2026-03-29T01:00:00.000Z") });
    const brunch = booking({ id: "brunch", title: "Brunch", eventId: "event-brunch",
      startsAt: at("2026-03-29T10:00:00.000Z"), endsAt: at("2026-03-29T14:00:00.000Z") });
    const partySunday = booking({ id: "party-sun", title: "Party", eventId: "event-party",
      startsAt: at("2026-03-29T17:00:00.000Z"), endsAt: at("2026-03-29T22:00:00.000Z") });
    const report = detect({ bookings: [party, brunch, partySunday], turnaroundRules: [rule({ minutes: 240 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual(["insufficient_turnaround:brunch:party-sun"]);
  });

  // T-695 review D2 (probe P5b): the same swallow inside one day.
  it("measures another client's lunch between one event's morning and evening on the same day", () => {
    const morning = booking({ id: "sd-am", title: "Gala set", eventId: "event-sd",
      startsAt: at("2026-09-18T08:00:00.000Z"), endsAt: at("2026-09-18T10:00:00.000Z") });
    const evening = booking({ id: "sd-pm", title: "Gala", eventId: "event-sd",
      startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-18T21:00:00.000Z") });
    const lunch = booking({ id: "lunch", title: "Lunch", eventId: "event-lunch",
      startsAt: at("2026-09-18T11:00:00.000Z"), endsAt: at("2026-09-18T15:00:00.000Z") });
    const report = detect({ bookings: [morning, evening, lunch], turnaroundRules: [rule({ minutes: 180 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual(["insufficient_turnaround:lunch:sd-pm", "insufficient_turnaround:sd-am:lunch"]);
  });

  it("parts an event's days at the venue's midnight, on either side of the October clock change", () => {
    // Clocks go back at 02:00 BST on Sunday 25 October 2026. A UTC day would
    // join Saturday to the overnight set-up that starts at 00:30 BST on Sunday
    // (23:30Z on Saturday); a fixed BST day would join Sunday's evening, which
    // ends 23:30 GMT, to Monday's breakdown.
    const saturday = booking({ id: "x-sat", title: "Two-day fair", eventId: "event-fair",
      startsAt: at("2026-10-24T09:00:00.000Z"), endsAt: at("2026-10-24T15:00:00.000Z") });
    const overnightSetUp = phase({ id: "x-overnight", eventId: "event-fair", eventName: "Two-day fair",
      startsAt: at("2026-10-24T23:30:00.000Z"), endsAt: at("2026-10-25T06:00:00.000Z") });
    const sunday = booking({ id: "x-sun", title: "Two-day fair", eventId: "event-fair",
      startsAt: at("2026-10-25T10:00:00.000Z"), endsAt: at("2026-10-25T23:30:00.000Z") });
    const breakdown = phase({ id: "x-breakdown", eventId: "event-fair", eventName: "Two-day fair",
      startsAt: at("2026-10-26T09:00:00.000Z"), endsAt: at("2026-10-26T11:00:00.000Z") });
    const dinner = booking({ id: "y-dinner", title: "Late dinner", eventId: "event-dinner",
      startsAt: at("2026-10-24T17:00:00.000Z"), endsAt: at("2026-10-24T23:30:00.000Z") });
    const viewing = booking({ id: "viewing", kind: "viewing", title: "Show-round",
      startsAt: at("2026-10-26T08:00:00.000Z"), endsAt: at("2026-10-26T08:30:00.000Z") });
    const report = detect({
      bookings: [saturday, sunday, dinner, viewing],
      phases: [overnightSetUp, breakdown],
      turnaroundRules: [rule({ minutes: 60 })],
    });
    expect(report.conflicts.map((c) => c.id)).toEqual(["insufficient_turnaround:y-dinner:x-sun"]);
    expect(report.conflicts[0]?.explanation).toContain("Only 0 minutes");
  });

  // T-695 review Y1: another client's booking that began under the event's
  // set-up and runs on into the gap is in the room between the event's
  // pieces, though it does not start there; it must part them too, or the
  // changeovers on either side of the evening are never measured.
  it("parts an event's pieces round another client's booking that runs on into the gap between them", () => {
    const setUp = phase({ id: "wedding-setup", eventId: "event-wedding", eventName: "Wedding",
      startsAt: at("2026-09-19T06:00:00.000Z"), endsAt: at("2026-09-19T11:00:00.000Z") });
    const wedding = booking({ id: "wedding", title: "Wedding", eventId: "event-wedding",
      startsAt: at("2026-09-19T14:00:00.000Z"), endsAt: at("2026-09-19T22:00:00.000Z") });
    const agm = booking({ id: "agm", title: "AGM", eventId: "event-agm",
      startsAt: at("2026-09-19T10:00:00.000Z"), endsAt: at("2026-09-19T12:00:00.000Z") });
    const afterParty = booking({ id: "after-party", title: "After-party", eventId: "event-after-party",
      startsAt: at("2026-09-19T22:30:00.000Z"), endsAt: at("2026-09-20T00:00:00.000Z") });
    const report = detect({ bookings: [wedding, agm, afterParty], phases: [setUp], turnaroundRules: [rule({ minutes: 180 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual([
      "insufficient_turnaround:agm:wedding",
      "insufficient_turnaround:wedding:after-party",
    ]);
  });

  // T-695 review Y2: "no other booking or phase": another event's phase alone
  // (a provisional event's set-up, with no confirmed booking of its own) is
  // in the room between the two pieces, and parts them as a booking would.
  it("measures the changeovers round another event's phase alone between one event's morning and evening", () => {
    const morning = booking({ id: "a-am", title: "Gala rehearsal", eventId: "event-a",
      startsAt: at("2026-09-18T08:00:00.000Z"), endsAt: at("2026-09-18T10:00:00.000Z") });
    const evening = booking({ id: "a-pm", title: "Gala", eventId: "event-a",
      startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-18T21:00:00.000Z") });
    const otherSetUp = phase({ id: "b-setup", eventId: "event-b", eventName: "Product launch",
      startsAt: at("2026-09-18T12:00:00.000Z"), endsAt: at("2026-09-18T15:00:00.000Z") });
    const report = detect({ bookings: [morning, evening], phases: [otherSetUp], turnaroundRules: [rule({ minutes: 180 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual([
      "insufficient_turnaround:a-am:b-setup",
      "insufficient_turnaround:b-setup:a-pm",
    ]);
  });

  // T-695 review Z6: a confirmed booking with no event (a private hire) is
  // somebody else in the room too, and parts the event's pieces round it.
  it("measures the changeovers round a booking with no event between one event's morning and evening", () => {
    const morning = booking({ id: "c-am", title: "Gala rehearsal", eventId: "event-c",
      startsAt: at("2026-09-18T08:00:00.000Z"), endsAt: at("2026-09-18T10:00:00.000Z") });
    const evening = booking({ id: "c-pm", title: "Gala", eventId: "event-c",
      startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-18T21:00:00.000Z") });
    const hire = booking({ id: "hire", title: "Private hire",
      startsAt: at("2026-09-18T11:00:00.000Z"), endsAt: at("2026-09-18T15:00:00.000Z") });
    const report = detect({ bookings: [morning, evening, hire], turnaroundRules: [rule({ minutes: 180 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual([
      "insufficient_turnaround:c-am:hire",
      "insufficient_turnaround:hire:c-pm",
    ]);
  });

  // T-695 review Z2, Z7. Which changeovers are measured, as an invariant.
  // Each occupancy is measured from the latest end among other owners'
  // occupancies that had left by its start (ended at or before it), unless an
  // occupancy of its own event began at or after that end (its set has stayed
  // since). Of several that left at that instant, the one that began last
  // names it, then the greatest id. An owner is an event, or a booking without
  // one. The suite at the end of this file checks the engine against the rule
  // written plainly, on random arrangements.
  //
  // Where the occupancies follow one another without overlapping, each is
  // measured from its neighbour in start order, or not at all when that is its
  // own event, which is what comparing neighbours gave. No expectation above
  // this point changed with Z2 or Z7. The cases below are not of that kind: a
  // booking or phase outlasts the occupancy beside the next, or overlaps it.

  // Another event's phase spans both of an event's pieces, so the pieces part
  // (Y1) and the evening sits inside the phase. The after-party follows the
  // phase, 30 minutes after it ends, not the evening. 7ebc21b8 measured it;
  // comparing only neighbours, 4aeb7a78 measured the evening's 90 instead.
  it("measures the changeover after another event's phase that spans both of an event's pieces", () => {
    const morning = booking({ id: "e-am", title: "Gala rehearsal", eventId: "event-e",
      startsAt: at("2026-09-18T08:00:00.000Z"), endsAt: at("2026-09-18T10:00:00.000Z") });
    const evening = booking({ id: "e-pm", title: "Gala", eventId: "event-e",
      startsAt: at("2026-09-18T14:00:00.000Z"), endsAt: at("2026-09-18T22:00:00.000Z") });
    const build = phase({ id: "x-build", eventId: "event-x", eventName: "Exhibition",
      startsAt: at("2026-09-18T09:00:00.000Z"), endsAt: at("2026-09-18T23:00:00.000Z") });
    const afterParty = booking({ id: "after", title: "After-party",
      startsAt: at("2026-09-18T23:30:00.000Z"), endsAt: at("2026-09-19T01:00:00.000Z") });
    const report = detect({ bookings: [morning, evening, afterParty], phases: [build], turnaroundRules: [rule({ minutes: 60 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual(["insufficient_turnaround:x-build:after"]);
    expect(report.conflicts[0]?.explanation).toContain("Only 30 minutes");
  });

  // Another client's booking covers an event's set-up, which parts the set-up
  // from its wedding (Y1) and sits inside the AGM. The wedding follows the
  // AGM, 120 minutes after it ends; comparing only neighbours, the set-up and
  // the wedding were one event's pair and nothing was measured.
  it("measures the changeover from another booking that covers an event's earlier piece", () => {
    const agm = booking({ id: "agm", title: "AGM", eventId: "event-agm",
      startsAt: at("2026-09-19T05:00:00.000Z"), endsAt: at("2026-09-19T12:00:00.000Z") });
    const setUp = phase({ id: "wedding-setup", eventId: "event-wedding", eventName: "Wedding",
      startsAt: at("2026-09-19T06:00:00.000Z"), endsAt: at("2026-09-19T11:00:00.000Z") });
    const wedding = booking({ id: "wedding", title: "Wedding", eventId: "event-wedding",
      startsAt: at("2026-09-19T14:00:00.000Z"), endsAt: at("2026-09-19T22:00:00.000Z") });
    const report = detect({ bookings: [agm, wedding], phases: [setUp], turnaroundRules: [rule({ minutes: 180 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual(["insufficient_turnaround:agm:wedding"]);
    expect(report.conflicts[0]?.explanation).toContain("Only 120 minutes");
  });

  // The room's last occupants leave together: another client's dinner and an
  // event's set-up both end at 23:30 BST, and the event's overnight build
  // starts at 00:30 on its own day. Its set stays, but the dinner must still
  // be cleared, so the build is measured from the dinner whichever began first.
  it("measures the changeover from another booking that leaves as an event's earlier piece does, whichever began first", () => {
    for (const [dinnerStarts, setUpStarts] of [
      ["2026-09-18T17:00:00.000Z", "2026-09-18T19:00:00.000Z"],
      ["2026-09-18T19:00:00.000Z", "2026-09-18T17:00:00.000Z"],
    ] as const) {
      const dinner = booking({ id: "dinner", title: "Dinner", eventId: "event-dinner",
        startsAt: at(dinnerStarts), endsAt: at("2026-09-18T22:30:00.000Z") });
      const setUp = phase({ id: "fair-setup", eventId: "event-fair", eventName: "Fair",
        startsAt: at(setUpStarts), endsAt: at("2026-09-18T22:30:00.000Z") });
      const build = booking({ id: "fair-build", title: "Fair build", eventId: "event-fair",
        startsAt: at("2026-09-18T23:30:00.000Z"), endsAt: at("2026-09-19T05:00:00.000Z") });
      const report = detect({ bookings: [dinner, build], phases: [setUp], turnaroundRules: [rule({ minutes: 120 })] });
      expect(report.conflicts.map((c) => c.id), `dinner from ${dinnerStarts}`).toEqual(["insufficient_turnaround:dinner:fair-build"]);
      expect(report.conflicts[0]?.explanation).toContain("Only 60 minutes");
    }
  });

  // T-695 review Z7. The rule is continuous: a dinner that leaves five minutes
  // before the fair's set-up must be cleared before the build as much as one
  // that leaves with it or five minutes after. d3424d62 measured nothing when
  // the dinner left first, as it looked only at the room's last occupants.
  it("measures the changeover from another booking that leaves just before, with or just after an event's earlier piece, whichever began first", () => {
    for (const [dinnerEnds, minutes] of [
      ["2026-09-18T22:25:00.000Z", 65],
      ["2026-09-18T22:30:00.000Z", 60],
      ["2026-09-18T22:35:00.000Z", 55],
    ] as const) {
      for (const [dinnerStarts, setUpStarts] of [
        ["2026-09-18T19:00:00.000Z", "2026-09-18T17:00:00.000Z"],
        ["2026-09-18T17:00:00.000Z", "2026-09-18T19:00:00.000Z"],
      ] as const) {
        const dinner = booking({ id: "dinner", title: "Dinner", eventId: "event-dinner",
          startsAt: at(dinnerStarts), endsAt: at(dinnerEnds) });
        const setUp = phase({ id: "fair-setup", eventId: "event-fair", eventName: "Fair",
          startsAt: at(setUpStarts), endsAt: at("2026-09-18T22:30:00.000Z") });
        const build = booking({ id: "fair-build", title: "Fair build", eventId: "event-fair",
          startsAt: at("2026-09-18T23:30:00.000Z"), endsAt: at("2026-09-19T05:00:00.000Z") });
        const report = detect({ bookings: [dinner, build], phases: [setUp], turnaroundRules: [rule({ minutes: 120 })] });
        const label = `dinner ${dinnerStarts.slice(11, 16)} to ${dinnerEnds.slice(11, 16)}Z, set-up from ${setUpStarts.slice(11, 16)}Z`;
        expect(report.conflicts.map((c) => c.id), label).toEqual(["insufficient_turnaround:dinner:fair-build"]);
        expect(report.conflicts[0]?.explanation, label).toContain(`Only ${String(minutes)} minutes`);
      }
    }
  });

  // The decisions feature reads whose an uncovered changeover is: the
  // occupancy the build is measured from is the one before it.
  it("names the occupancy it measures from as the one before an uncovered changeover", () => {
    const dinner = booking({ id: "dinner", title: "Dinner", eventId: "event-dinner",
      startsAt: at("2026-09-18T19:00:00.000Z"), endsAt: at("2026-09-18T22:25:00.000Z") });
    const setUp = phase({ id: "fair-setup", eventId: "event-fair", eventName: "Fair",
      startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-18T22:30:00.000Z") });
    const build = booking({ id: "fair-build", title: "Fair build", eventId: "event-fair",
      startsAt: at("2026-09-18T23:30:00.000Z"), endsAt: at("2026-09-19T05:00:00.000Z") });
    const { report, uncoveredGaps } = detectCalendarConflictsInDetail({
      bookings: [dinner, build], phases: [setUp], turnaroundRules: [], timeZone: "Europe/London",
    });
    expect(uncoveredGaps).toEqual([{ spaceId: SPACE_A, before: ["dinner"], after: ["fair-build"] }]);
    expect(report.checks.turnaround.uncoveredPairCount).toBe(1);
  });

  // Two other clients back to back inside another event's long build: the
  // build is still in the room, but the conference must be cleared before the
  // ceremony. 4aeb7a78 measured it; d3424d62 did not.
  it("measures the changeover between two other clients back to back inside another event's phase", () => {
    const build = phase({ id: "x-build", eventId: "event-x", eventName: "Exhibition",
      startsAt: at("2026-09-18T07:00:00.000Z"), endsAt: at("2026-09-18T22:00:00.000Z") });
    const conference = booking({ id: "conf", title: "Conference", eventId: "event-a",
      startsAt: at("2026-09-18T08:00:00.000Z"), endsAt: at("2026-09-18T11:00:00.000Z") });
    const ceremony = booking({ id: "ceremony", title: "Ceremony", eventId: "event-b",
      startsAt: at("2026-09-18T11:15:00.000Z"), endsAt: at("2026-09-18T17:00:00.000Z") });
    const report = detect({ bookings: [conference, ceremony], phases: [build], turnaroundRules: [rule({ minutes: 60 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual(["insufficient_turnaround:conf:ceremony"]);
    expect(report.conflicts[0]?.explanation).toContain("Only 15 minutes");
  });

  // The same inside one event's phase: an evening and then an after-party.
  it("measures the changeover from an event's evening to an after-party, both inside another event's phase", () => {
    const build = phase({ id: "x-build", eventId: "event-x", eventName: "Exhibition",
      startsAt: at("2026-09-18T08:00:00.000Z"), endsAt: at("2026-09-18T22:00:00.000Z") });
    const evening = booking({ id: "e-pm", title: "Gala", eventId: "event-e",
      startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-18T21:00:00.000Z") });
    const afterParty = booking({ id: "after", title: "After-party",
      startsAt: at("2026-09-18T21:30:00.000Z"), endsAt: at("2026-09-18T23:30:00.000Z") });
    const report = detect({ bookings: [evening, afterParty], phases: [build], turnaroundRules: [rule({ minutes: 60 })] });
    expect(report.conflicts.map((c) => c.id)).toEqual(["insufficient_turnaround:e-pm:after"]);
    expect(report.conflicts[0]?.explanation).toContain("Only 30 minutes");
  });

  // "Had left by its start" includes leaving as it starts: the dinner is
  // measured from the strike that ends as it begins (0 minutes). A minute
  // earlier the strike is still in the room, so the dinner overlaps it and is
  // measured from the lunch, which had left.
  it("measures from an occupancy that leaves as the next begins, and not from one still in the room", () => {
    for (const [dinnerStarts, expected, minutes] of [
      ["2026-09-18T11:59:00.000Z", "insufficient_turnaround:a-lunch:c-dinner", 119],
      ["2026-09-18T12:00:00.000Z", "insufficient_turnaround:b-strike:c-dinner", 0],
      ["2026-09-18T12:01:00.000Z", "insufficient_turnaround:b-strike:c-dinner", 1],
    ] as const) {
      const lunch = booking({ id: "a-lunch", title: "Lunch", eventId: "event-a",
        startsAt: at("2026-09-18T08:00:00.000Z"), endsAt: at("2026-09-18T10:00:00.000Z") });
      const strike = phase({ id: "b-strike", eventId: "event-b", eventName: "Fair", name: "Strike",
        startsAt: at("2026-09-18T09:00:00.000Z"), endsAt: at("2026-09-18T12:00:00.000Z") });
      const dinner = booking({ id: "c-dinner", title: "Dinner", eventId: "event-c",
        startsAt: at(dinnerStarts), endsAt: at("2026-09-18T18:00:00.000Z") });
      const report = detect({ bookings: [lunch, dinner], phases: [strike], turnaroundRules: [rule({ minutes: 180 })] });
      expect(report.conflicts.map((c) => c.id), `dinner from ${dinnerStarts}`).toEqual([expected]);
      expect(report.conflicts[0]?.explanation, `dinner from ${dinnerStarts}`).toContain(`Only ${String(minutes)} minutes`);
    }
  });

  // "Began at or after that end" includes beginning as it ends: a set-up that
  // comes in as the dinner leaves is measured from the dinner, and the fair's
  // set stays from then on, so its build is not. A set-up that comes in a
  // minute earlier overlaps the dinner, so the build is measured from it.
  it("measures another client's changeover once, at the event's first piece that begins after it leaves", () => {
    for (const [setUpStarts, expected, minutes] of [
      ["2026-09-18T20:59:00.000Z", "insufficient_turnaround:dinner:fair-build", 150],
      ["2026-09-18T21:00:00.000Z", "insufficient_turnaround:dinner:fair-setup", 0],
      ["2026-09-18T21:01:00.000Z", "insufficient_turnaround:dinner:fair-setup", 1],
    ] as const) {
      const dinner = booking({ id: "dinner", title: "Dinner", eventId: "event-dinner",
        startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-18T21:00:00.000Z") });
      const setUp = phase({ id: "fair-setup", eventId: "event-fair", eventName: "Fair",
        startsAt: at(setUpStarts), endsAt: at("2026-09-18T22:30:00.000Z") });
      const build = booking({ id: "fair-build", title: "Fair build", eventId: "event-fair",
        startsAt: at("2026-09-18T23:30:00.000Z"), endsAt: at("2026-09-19T05:00:00.000Z") });
      const report = detect({ bookings: [dinner, build], phases: [setUp], turnaroundRules: [rule({ minutes: 180 })] });
      expect(report.conflicts.map((c) => c.id), `set-up from ${setUpStarts}`).toEqual([expected]);
      expect(report.conflicts[0]?.explanation, `set-up from ${setUpStarts}`).toContain(`Only ${String(minutes)} minutes`);
    }
  });

  // Other clients that leave at the same instant: the one that began last
  // names the changeover, and of two that began together the greater id, in
  // whatever order the rows arrive. The event's own set-up, which leaves with
  // them and began last of all, is passed over.
  it("names a changeover from occupants that leave together by the one that began last, in any input order", () => {
    for (const [barStarts, named] of [
      ["2026-09-18T19:00:00.000Z", "bar-strike"],
      ["2026-09-18T17:00:00.000Z", "dinner"],
    ] as const) {
      const dinner = booking({ id: "dinner", title: "Dinner", eventId: "event-dinner",
        startsAt: at("2026-09-18T17:00:00.000Z"), endsAt: at("2026-09-18T22:30:00.000Z") });
      const barStrike = phase({ id: "bar-strike", eventId: "event-bar", eventName: "Bar", name: "Strike",
        startsAt: at(barStarts), endsAt: at("2026-09-18T22:30:00.000Z") });
      const setUp = phase({ id: "fair-setup", eventId: "event-fair", eventName: "Fair",
        startsAt: at("2026-09-18T20:00:00.000Z"), endsAt: at("2026-09-18T22:30:00.000Z") });
      const build = booking({ id: "fair-build", title: "Fair build", eventId: "event-fair",
        startsAt: at("2026-09-18T23:30:00.000Z"), endsAt: at("2026-09-19T05:00:00.000Z") });
      for (const bookings of [[dinner, build], [build, dinner]]) {
        for (const phases of [[barStrike, setUp], [setUp, barStrike]]) {
          const label = `bar from ${barStarts}, ${bookings.map((row) => row.id).join(",")} ${phases.map((row) => row.id).join(",")}`;
          const ruled = detect({ bookings, phases, turnaroundRules: [rule({ minutes: 120 })] });
          expect(ruled.conflicts.map((c) => c.id), label).toEqual([`insufficient_turnaround:${named}:fair-build`]);
          const { uncoveredGaps } = detectCalendarConflictsInDetail({ bookings, phases, turnaroundRules: [], timeZone: "Europe/London" });
          expect(uncoveredGaps, label).toEqual([{ spaceId: SPACE_A, before: [named], after: ["fair-build"] }]);
        }
      }
    }
  });
});

describe("honesty and determinism", () => {
  it("never uses compliance vocabulary in explanations", () => {
    const a = booking({
      id: "a",
      startsAt: new Date("2026-09-18T08:00:00.000Z"),
      endsAt: new Date("2026-09-18T12:00:00.000Z"),
    });
    const b = booking({
      id: "b",
      startsAt: new Date("2026-09-18T12:10:00.000Z"),
      endsAt: new Date("2026-09-18T23:00:00.000Z"),
    });
    const overlapHold = booking({
      id: "h",
      kind: "hold",
      rank: 1,
      startsAt: new Date("2026-09-18T09:00:00.000Z"),
      endsAt: new Date("2026-09-18T11:00:00.000Z"),
    });
    const report = detect({
      bookings: [a, b, overlapHold],
      turnaroundRules: [rule({ minutes: 60 })],
    });
    expect(report.conflicts.length).toBeGreaterThan(0);
    for (const conflict of report.conflicts) {
      expect(conflict.explanation.toLowerCase()).not.toMatch(
        /compliant|certified|approved|guaranteed|fire safe/,
      );
    }
  });

  it("is deterministic and order-independent", () => {
    const a = booking({
      id: "a",
      startsAt: new Date("2026-09-18T08:00:00.000Z"),
      endsAt: new Date("2026-09-18T12:00:00.000Z"),
    });
    const b = booking({
      id: "b",
      startsAt: new Date("2026-09-18T12:15:00.000Z"),
      endsAt: new Date("2026-09-18T18:00:00.000Z"),
    });
    const c = booking({
      id: "c",
      kind: "hold",
      rank: 1,
      startsAt: new Date("2026-09-18T10:00:00.000Z"),
      endsAt: new Date("2026-09-18T13:00:00.000Z"),
    });
    const rules = [rule({ minutes: 60 })];
    const forward = detect({ bookings: [a, b, c], turnaroundRules: rules });
    const reversed = detect({ bookings: [c, b, a], turnaroundRules: rules });
    expect(forward).toEqual(reversed);
    const ids = forward.conflicts.map((conflict) => conflict.id);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("viewing overlap (migration 0100)", () => {
  const at = (iso: string): Date => new Date(iso);

  it("warns when a viewing falls during a confirmed booking, its set-up included", () => {
    const ink = booking({ kind: "ink", eventId: "event-gala", title: "Gala dinner" });
    const setup = phase({ eventId: "event-gala", eventName: "Gala dinner" });
    // 16:00 to 16:45: before the dinner, during its 15:00 set-up.
    const viewing = booking({ kind: "viewing", title: "Crawford viewing", startsAt: at("2026-09-18T16:00:00.000Z"), endsAt: at("2026-09-18T16:45:00.000Z") });
    const report = detect({ bookings: [ink, viewing], phases: [setup] });
    const overlaps = report.conflicts.filter((conflict) => conflict.type === "viewing_overlap");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ severity: "warning", spaceId: SPACE_A });
    expect(overlaps[0]?.entryIds).toContain(viewing.id);
    expect(overlaps[0]?.explanation).toContain("Crawford viewing");
    expect(overlaps[0]?.explanation).toContain("set-up and clearing included");
  });

  it("warns, in words that claim no confirmation, when a viewing falls in an event's phase alone", () => {
    // An event whose set-up is timed in this room, with no confirmed booking here.
    const setup = phase({ eventId: "event-hold-only", eventName: "Provisional dinner" });
    const viewing = booking({ kind: "viewing", title: "Ahmed viewing", startsAt: at("2026-09-18T15:30:00.000Z"), endsAt: at("2026-09-18T16:00:00.000Z") });
    const [conflict] = detect({ bookings: [viewing], phases: [setup] }).conflicts;
    expect(conflict).toMatchObject({ type: "viewing_overlap", severity: "warning" });
    // The occupancy's entry is the phase, as the turnaround check's are.
    expect(conflict?.entryIds).toEqual([setup.id, viewing.id]);
    expect(conflict?.explanation).toContain("has this room at that time");
    expect(conflict?.explanation).not.toContain("confirmed");
  });

  it("warns when a viewing falls during a house block", () => {
    const block = booking({ kind: "internal_block", title: "Floor varnish" });
    const viewing = booking({ kind: "viewing", title: "Ahmed viewing", startsAt: at("2026-09-18T19:00:00.000Z"), endsAt: at("2026-09-18T19:30:00.000Z") });
    const [conflict] = detect({ bookings: [block, viewing] }).conflicts;
    expect(conflict).toMatchObject({ type: "viewing_overlap", severity: "warning" });
    expect(conflict?.explanation).toContain("closed this room");
  });

  it("notes two viewings at once in one room, and ignores another room's", () => {
    const first = booking({ kind: "viewing", startsAt: at("2026-09-18T10:00:00.000Z"), endsAt: at("2026-09-18T11:00:00.000Z") });
    const second = booking({ kind: "viewing", startsAt: at("2026-09-18T10:30:00.000Z"), endsAt: at("2026-09-18T11:15:00.000Z") });
    const elsewhere = booking({ kind: "viewing", spaceId: SPACE_B, startsAt: at("2026-09-18T10:30:00.000Z"), endsAt: at("2026-09-18T11:15:00.000Z") });
    const conflicts = detect({ bookings: [first, second, elsewhere] }).conflicts;
    expect(conflicts).toEqual([expect.objectContaining({
      type: "viewing_overlap", severity: "info", entryIds: [first.id, second.id], spaceId: SPACE_A,
    })]);
  });

  it("says nothing of a viewing beside a booking, under a hold, called off, or merely touching", () => {
    const ink = booking({ kind: "ink" });
    const touching = booking({ kind: "viewing", startsAt: at("2026-09-18T17:15:00.000Z"), endsAt: at("2026-09-18T18:00:00.000Z") });
    const hold = booking({ kind: "hold", rank: 1, startsAt: at("2026-09-19T18:00:00.000Z"), endsAt: at("2026-09-19T23:00:00.000Z") });
    const underHold = booking({ kind: "viewing", startsAt: at("2026-09-19T19:00:00.000Z"), endsAt: at("2026-09-19T19:30:00.000Z") });
    const cancelled = booking({ kind: "viewing", status: "cancelled", startsAt: at("2026-09-18T19:00:00.000Z"), endsAt: at("2026-09-18T19:30:00.000Z") });
    const conflicts = detect({ bookings: [ink, touching, hold, underHold, cancelled] }).conflicts;
    expect(conflicts.filter((conflict) => conflict.type === "viewing_overlap")).toEqual([]);
  });

  it("never counts a viewing as an occupancy for turnaround", () => {
    const ink = booking({ kind: "ink", eventType: "wedding" });
    const viewing = booking({ kind: "viewing", startsAt: at("2026-09-18T23:10:00.000Z"), endsAt: at("2026-09-18T23:40:00.000Z") });
    const report = detect({ bookings: [ink, viewing], turnaroundRules: [rule({ minutes: 120 })] });
    expect(report.conflicts.filter((conflict) => conflict.type === "insufficient_turnaround")).toEqual([]);
    expect(report.checks.turnaround.status).toBe("checked");
  });

  it("reports the same overlaps whatever order the bookings arrive in", () => {
    const rows = [
      booking({ kind: "ink" }),
      booking({ kind: "viewing", startsAt: at("2026-09-18T20:00:00.000Z"), endsAt: at("2026-09-18T20:30:00.000Z") }),
      booking({ kind: "viewing", startsAt: at("2026-09-18T20:15:00.000Z"), endsAt: at("2026-09-18T20:45:00.000Z") }),
      booking({ kind: "internal_block", startsAt: at("2026-09-18T20:00:00.000Z"), endsAt: at("2026-09-18T21:00:00.000Z") }),
    ];
    const forward = detect({ bookings: rows });
    expect(detect({ bookings: [...rows].reverse() })).toEqual(forward);
    expect(forward.conflicts.filter((conflict) => conflict.type === "viewing_overlap")).toHaveLength(5);
  });
});

// T-695 review Z7. The changeover rule written a second time, as plainly as
// it can be: for each occupancy, scan every other one, with no running state
// and nothing shared with the engine, which keeps running state for speed. A
// disagreement on any arrangement is a bug in one of the two.
describe("the changeover rule, read plainly, against the engine", () => {
  interface Held {
    readonly id: string;
    readonly eventId: string | null;
    readonly startMs: number;
    readonly endMs: number;
  }

  interface PlainReading {
    readonly changeovers: string[];
    /** Occupancies passed over because their event's set had stayed. */
    readonly setStayed: number;
    /** Changeovers whose latest leavers were two or more, left together. */
    readonly leftTogether: number;
    /** Of those passed over, the ones whose event's set was in the room only
     *  through a piece still there as they began (only ever under another key). */
    readonly setInRoom: number;
  }

  // A caller may keep one event's pieces apart under keys of its own (a
  // prepared decision keeps the moved booking's block apart from the rest of
  // its event), and say which event each key is: `eventOf`. A key is still its
  // own owner to measure from; whether the event's set stayed asks the event.
  function plainChangeovers(occupancies: readonly Held[], eventOf: (eventId: string) => string = (eventId) => eventId): PlainReading {
    const sameOwner = (a: Held, b: Held): boolean =>
      a.eventId === null || b.eventId === null ? a.id === b.id : a.eventId === b.eventId;
    const changeovers: string[] = [];
    let setStayed = 0;
    let leftTogether = 0;
    let setInRoom = 0;
    for (const next of occupancies) {
      const gone = occupancies.filter((other) => !sameOwner(other, next) && other.endMs <= next.startMs);
      if (gone.length === 0) continue;
      const leftAt = Math.max(...gone.map((other) => other.endMs));
      const lastToLeave = gone.filter((other) => other.endMs === leftAt);
      const latestStart = Math.max(...lastToLeave.map((other) => other.startMs));
      const namedIds = lastToLeave
        .filter((other) => other.startMs === latestStart)
        .map((other) => other.id)
        .sort();
      const named = namedIds[namedIds.length - 1];
      // Some piece of its event that began before it did came into the room
      // after the last other owner left, or is still there as it begins (one
      // event's pieces under one key never are). One that began with it came
      // in with it, and did not stay before it.
      const event = next.eventId === null ? null : eventOf(next.eventId);
      const ownBefore = occupancies.filter((own) =>
        own !== next && own.eventId !== null && event !== null && eventOf(own.eventId) === event && own.startMs < next.startMs);
      const cameIn = ownBefore.some((own) => own.startMs >= leftAt);
      const stillThere = ownBefore.some((own) => own.endMs >= next.startMs);
      if (cameIn || stillThere) {
        setStayed += 1;
        if (!cameIn) setInRoom += 1;
        continue;
      }
      if (lastToLeave.length > 1) leftTogether += 1;
      changeovers.push(`${String(named)}>${next.id}`);
    }
    return { changeovers: changeovers.sort(), setStayed, leftTogether, setInRoom };
  }

  // Park and Miller's generator: a fixed seed gives the same arrangements on
  // every run, and a failure prints its arrangement.
  function seeded(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 48_271) % 2_147_483_647;
      return (state - 1) / 2_147_483_646;
    };
  }

  function shuffled<T>(items: readonly T[], random: () => number): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const a = out[i];
      const b = out[j];
      if (a === undefined || b === undefined) continue;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }

  const UNIT_MS = 30 * 60_000;

  // Three to six occupancies on a coarse half-hour grid, so overlaps, touching
  // ends, nesting, tied ends and shared starts are common; two or three owners
  // (an event, or bookings without one); ids shuffled against times, so ties
  // fall to the id either way. One event's occupancies never overlap or touch,
  // as buildOccupancies joins those.
  function arrangement(random: () => number): Held[] {
    const pick = (n: number): number => Math.floor(random() * n);
    for (;;) {
      const owners = Array.from({ length: 2 + pick(2) }, (_, index) => (pick(4) === 0 ? null : `event-${String(index)}`));
      const ids = shuffled(["a", "b", "c", "d", "e", "f"].slice(0, 3 + pick(4)), random);
      const held = ids.map((id) => {
        const startMs = pick(10) * UNIT_MS;
        return { id, eventId: owners[pick(owners.length)] ?? null, startMs, endMs: startMs + (1 + pick(4)) * UNIT_MS };
      });
      const apart = held.every((a) => held.every((b) =>
        a === b || a.eventId === null || a.eventId !== b.eventId || a.endMs < b.startMs || b.endMs < a.startMs));
      const owned = new Set(held.map((one) => one.eventId ?? `booking:${one.id}`));
      if (apart && owned.size >= 2) return held;
    }
  }

  it("agrees with the engine on 5,000 seeded random arrangements, given in shuffled order", () => {
    const random = seeded(20_261_113);
    const disagreements: string[] = [];
    const shapes = {
      overlapping: 0, touching: 0, nested: 0, tiedEnds: 0, sameStart: 0, oneEventTwice: 0, withoutEvent: 0,
      measured: 0, setStayed: 0, leftTogether: 0,
    };
    for (let n = 0; n < 5_000; n += 1) {
      const held = arrangement(random);
      const plain = plainChangeovers(held);
      const engine = measuredChangeovers(shuffled(held, random))
        .map(({ before, after }) => `${before.id}>${after.id}`)
        .sort();
      if (engine.join(" ") !== plain.changeovers.join(" ")) {
        disagreements.push(`${JSON.stringify(held)}: plain [${plain.changeovers.join(" ")}], engine [${engine.join(" ")}]`);
      }
      const pairs = held.flatMap((a) => held.filter((b) => b !== a).map((b) => [a, b] as const));
      if (pairs.some(([a, b]) => a.startMs < b.endMs && b.startMs < a.endMs)) shapes.overlapping += 1;
      if (pairs.some(([a, b]) => a.endMs === b.startMs)) shapes.touching += 1;
      if (pairs.some(([a, b]) => a.startMs <= b.startMs && b.endMs <= a.endMs)) shapes.nested += 1;
      if (pairs.some(([a, b]) => a.endMs === b.endMs)) shapes.tiedEnds += 1;
      if (pairs.some(([a, b]) => a.startMs === b.startMs)) shapes.sameStart += 1;
      if (pairs.some(([a, b]) => a.eventId !== null && a.eventId === b.eventId)) shapes.oneEventTwice += 1;
      if (held.some((one) => one.eventId === null)) shapes.withoutEvent += 1;
      if (plain.changeovers.length > 0) shapes.measured += 1;
      if (plain.setStayed > 0) shapes.setStayed += 1;
      if (plain.leftTogether > 0) shapes.leftTogether += 1;
    }
    expect(disagreements.slice(0, 3), `${String(disagreements.length)} disagreements`).toEqual([]);
    for (const [shape, count] of Object.entries(shapes)) {
      expect(count, `arrangements with ${shape}`).toBeGreaterThan(100);
    }
  });

  // As arrangement(), with two events each kept apart under keys of their own
  // (T-695 review of #400, Y1): pieces under one key never overlap or touch,
  // as buildOccupancies joins those, but pieces of one event under different
  // keys may, and may begin together.
  const KEPT_APART: ReadonlyMap<string, string> = new Map([["event-0~a", "event-0"], ["event-0~b", "event-0"], ["event-1~a", "event-1"]]);
  const eventOfKey = (eventId: string): string => KEPT_APART.get(eventId) ?? eventId;
  const KEYS = ["event-0", "event-0~a", "event-0~b", "event-1", "event-1~a", null] as const;

  function keptApartArrangement(random: () => number): Held[] {
    const pick = (n: number): number => Math.floor(random() * n);
    for (;;) {
      const ids = shuffled(["a", "b", "c", "d", "e", "f"].slice(0, 3 + pick(4)), random);
      const held = ids.map((id) => {
        const startMs = pick(10) * UNIT_MS;
        return { id, eventId: KEYS[pick(KEYS.length)] ?? null, startMs, endMs: startMs + (1 + pick(4)) * UNIT_MS };
      });
      const apart = held.every((a) => held.every((b) =>
        a === b || a.eventId === null || a.eventId !== b.eventId || a.endMs < b.startMs || b.endMs < a.startMs));
      const owned = new Set(held.map((one) => one.eventId ?? `booking:${one.id}`));
      if (apart && owned.size >= 2) return held;
    }
  }

  it("agrees with the engine on 5,000 seeded random arrangements with an event kept apart under several keys", () => {
    const random = seeded(20_261_114);
    const disagreements: string[] = [];
    const shapes = { apartOverlapping: 0, apartTouching: 0, apartSameStart: 0, setStayedThroughAnotherKey: 0, setInRoom: 0, measured: 0 };
    for (let n = 0; n < 5_000; n += 1) {
      const held = keptApartArrangement(random);
      const plain = plainChangeovers(held, eventOfKey);
      const engine = measuredChangeovers(shuffled(held, random), eventOfKey)
        .map(({ before, after }) => `${before.id}>${after.id}`)
        .sort();
      if (engine.join(" ") !== plain.changeovers.join(" ")) {
        disagreements.push(`${JSON.stringify(held)}: plain [${plain.changeovers.join(" ")}], engine [${engine.join(" ")}]`);
      }
      const apartPairs = held.flatMap((a) => held.filter((b) => b !== a && a.eventId !== null && b.eventId !== null
        && a.eventId !== b.eventId && eventOfKey(a.eventId) === eventOfKey(b.eventId)).map((b) => [a, b] as const));
      if (apartPairs.some(([a, b]) => a.startMs < b.endMs && b.startMs < a.endMs)) shapes.apartOverlapping += 1;
      if (apartPairs.some(([a, b]) => a.endMs === b.startMs)) shapes.apartTouching += 1;
      if (apartPairs.some(([a, b]) => a.startMs === b.startMs)) shapes.apartSameStart += 1;
      if (plain.setStayed > plainChangeovers(held).setStayed) shapes.setStayedThroughAnotherKey += 1;
      if (plain.setInRoom > 0) shapes.setInRoom += 1;
      if (plain.changeovers.length > 0) shapes.measured += 1;
    }
    expect(disagreements.slice(0, 3), `${String(disagreements.length)} disagreements`).toEqual([]);
    for (const [shape, count] of Object.entries(shapes)) {
      expect(count, `arrangements with ${shape}`).toBeGreaterThan(100);
    }
  });

  it("reads the review's arrangements as the engine's report does", () => {
    const at = (iso: string): number => new Date(iso).getTime();
    // T-695 review of #400, Z11: the engine is asked too, not only the plain reading.
    const engine = (held: readonly Held[]): string[] =>
      measuredChangeovers(held).map(({ before, after }) => `${before.id}>${after.id}`).sort();
    // The near-tie: the dinner leaves at 22:25Z, the fair's set-up at 22:30Z.
    const nearTie: Held[] = [
      { id: "fair-setup", eventId: "event-fair", startMs: at("2026-09-18T17:00:00Z"), endMs: at("2026-09-18T22:30:00Z") },
      { id: "dinner", eventId: "event-dinner", startMs: at("2026-09-18T19:00:00Z"), endMs: at("2026-09-18T22:25:00Z") },
      { id: "fair-build", eventId: "event-fair", startMs: at("2026-09-18T23:30:00Z"), endMs: at("2026-09-19T05:00:00Z") },
    ];
    expect(plainChangeovers(nearTie).changeovers).toEqual(["dinner>fair-build"]);
    expect(engine(nearTie)).toEqual(["dinner>fair-build"]);
    // Two clients back to back inside another event's build.
    const insideBuild: Held[] = [
      { id: "x-build", eventId: "event-x", startMs: at("2026-09-18T07:00:00Z"), endMs: at("2026-09-18T22:00:00Z") },
      { id: "conf", eventId: "event-a", startMs: at("2026-09-18T08:00:00Z"), endMs: at("2026-09-18T11:00:00Z") },
      { id: "ceremony", eventId: "event-b", startMs: at("2026-09-18T11:15:00Z"), endMs: at("2026-09-18T17:00:00Z") },
    ];
    expect(plainChangeovers(insideBuild).changeovers).toEqual(["conf>ceremony"]);
    expect(engine(insideBuild)).toEqual(["conf>ceremony"]);
  });
});

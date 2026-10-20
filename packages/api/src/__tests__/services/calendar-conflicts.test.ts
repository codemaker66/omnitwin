import { describe, expect, it } from "vitest";
import {
  detectCalendarConflicts,
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

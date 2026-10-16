import { describe, expect, it } from "vitest";
import {
  ClientEventScheduleQuerySchema,
  ClientEventScheduleSchema,
  ProposeWindowSchema,
  RoomDayQuerySchema,
  RoomDaySchema,
} from "../client-event-schedule.js";

const VENUE = "00000000-0000-4000-8000-000000000001";
const EVENT = "00000000-0000-4000-8000-000000000002";
const PHASE = "00000000-0000-4000-8000-000000000003";
const CONFIGURATION = "00000000-0000-4000-8000-000000000004";
const ROOM = "00000000-0000-4000-8000-000000000005";
const BOOKING = "00000000-0000-4000-8000-000000000006";

function schedule() {
  return {
    event: { id: EVENT, venueId: VENUE, name: "Dinner", eventType: "dinner", status: "in_planning",
      startsAt: "2026-10-25T18:00:00.000Z", endsAt: null, guestCount: 24 },
    venue: { id: VENUE, name: "Test venue", timezone: "Europe/London" },
    scheduleState: "working",
    phases: [{ id: PHASE, name: "Arrival", startsAt: null, durationMinutes: 30, space: null }],
    layouts: [{ id: CONFIGURATION, name: "Dinner layout", space: { id: ROOM, name: "Hall" } }],
    // Goal 19 S4: the slots the client may ask the house about — the event's
    // live bookings, each with its room and window, nothing else of the Diary.
    slots: [{ bookingId: BOOKING, kind: "ink", title: "Dinner", space: { id: ROOM, name: "Hall" },
      startsAt: "2026-10-25T18:00:00.000Z", endsAt: "2026-10-25T23:00:00.000Z" }],
  };
}

describe("client event schedule contract", () => {
  it("preserves honest working, untimed and unassigned-room states", () => {
    expect(ClientEventScheduleSchema.parse(schedule())).toEqual(schedule());
    expect(ClientEventScheduleSchema.parse({ ...schedule(), phases: [], layouts: [], slots: [] }).phases).toEqual([]);
    expect(ClientEventScheduleSchema.parse({ ...schedule(), slots: [] }).slots).toEqual([]);
  });

  it("tells the client each slot's room, window and commitment, and nothing else of the booking", () => {
    const original = schedule();
    expect(ClientEventScheduleSchema.parse(original).slots).toEqual(original.slots);
    for (const candidate of [
      { ...original, slots: [{ ...original.slots[0], kind: "cancelled" }] },
      { ...original, slots: [{ ...original.slots[0], startsAt: "not-a-date" }] },
      { ...original, slots: [{ ...original.slots[0], bookingId: "not-a-uuid" }] },
      { ...original, slots: [{ ...original.slots[0], space: null }] },
      // A client is not told the Diary's internals: notes, the ladder, the owner.
      { ...original, slots: [{ ...original.slots[0], notes: "Private" }] },
      { ...original, slots: [{ ...original.slots[0], rank: 1 }] },
      { ...original, slots: [{ ...original.slots[0], ownerUserId: VENUE }] },
      { ...original, slots: [{ ...original.slots[0], clientName: "Private" }] },
    ]) expect(ClientEventScheduleSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects internal material at every projected object boundary", () => {
    const original = schedule();
    for (const candidate of [
      { ...original, notes: "Private" },
      { ...original, event: { ...original.event, notes: "Private" } },
      { ...original, venue: { ...original.venue, address: "Private" } },
      { ...original, phases: [{ ...original.phases[0], staffConflictsLabel: "Private" }] },
      { ...original, layouts: [{ ...original.layouts[0], snapshot: { notes: "Private" } }] },
      { ...original, layouts: [{ ...original.layouts[0], space: { id: ROOM, name: "Hall", metadata: "Private" } }] },
    ]) expect(ClientEventScheduleSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects mismatched venue and repeated phase/layout/slot identities", () => {
    const original = schedule();
    for (const candidate of [
      { ...original, venue: { ...original.venue, id: ROOM } },
      { ...original, phases: [original.phases[0], original.phases[0]] },
      { ...original, layouts: [original.layouts[0], original.layouts[0]] },
      { ...original, slots: [original.slots[0], original.slots[0]] },
    ]) expect(ClientEventScheduleSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects unsupported timing, state and query claims", () => {
    const original = schedule();
    expect(ClientEventScheduleSchema.safeParse({ ...original, scheduleState: "approved" }).success).toBe(false);
    expect(ClientEventScheduleSchema.safeParse({ ...original, venue: { ...original.venue, timezone: "not-a-zone" } }).success).toBe(false);
    expect(ClientEventScheduleSchema.safeParse({ ...original, phases: [{ ...original.phases[0], durationMinutes: -1 }] }).success).toBe(false);
    expect(ClientEventScheduleQuerySchema.parse({})).toEqual({});
    expect(ClientEventScheduleQuerySchema.parse({ configurationId: CONFIGURATION })).toEqual({ configurationId: CONFIGURATION });
    for (const query of [{ configurationId: "not-a-uuid" }, { configurationId: [CONFIGURATION] }, { audience: "admin" }]) {
      expect(ClientEventScheduleQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe("ProposeWindowSchema (goal 19 S6)", () => {
  const window = {
    spaceId: "00000000-0000-4000-8000-0000000000a1",
    startsAt: "2030-05-10T18:00:00.000Z",
    endsAt: "2030-05-10T23:00:00.000Z",
    idempotencyKey: "00000000-0000-4000-8000-0000000000b1",
  };

  it("accepts a room, a window and the key, nothing more", () => {
    expect(ProposeWindowSchema.safeParse(window).success).toBe(true);
    for (const extra of [{ rank: 1 }, { kind: "ink" }, { ownerUserId: window.spaceId }, { decisionAt: window.startsAt }, { price: 100 }]) {
      expect(ProposeWindowSchema.safeParse({ ...window, ...extra }).success, Object.keys(extra)[0]).toBe(false);
    }
  });

  it("refuses a window that ends before, or at, its start", () => {
    expect(ProposeWindowSchema.safeParse({ ...window, endsAt: window.startsAt }).success).toBe(false);
    expect(ProposeWindowSchema.safeParse({ ...window, endsAt: "2030-05-10T17:00:00.000Z" }).success).toBe(false);
  });
});

describe("RoomDaySchema (goal 19 S6)", () => {
  const span = { startsAt: "2030-05-10T18:00:00.000Z", endsAt: "2030-05-10T23:00:00.000Z" };
  const roomDay = {
    eventId: EVENT,
    space: { id: ROOM, name: "Hall" },
    day: "2030-05-10",
    timezone: "Europe/London",
    range: { startsAt: "2030-05-10T03:00:00.000Z", endsAt: "2030-05-11T03:00:00.000Z" },
    turnaroundMinutes: 90,
    spans: [
      { kind: "yours", bookingId: BOOKING, title: "Dinner", ...span },
      { kind: "held", startsAt: "2030-05-10T14:00:00.000Z", endsAt: "2030-05-10T16:00:00.000Z" },
      { kind: "busy", startsAt: "2030-05-10T08:00:00.000Z", endsAt: "2030-05-10T13:00:00.000Z" },
    ],
  };

  it("accepts the client's own slot by name and anonymous spans for the rest", () => {
    expect(RoomDaySchema.safeParse(roomDay).success).toBe(true);
    expect(RoomDayQuerySchema.safeParse({ spaceId: ROOM, day: "2030-05-10" }).success).toBe(true);
  });

  it("refuses a name, a booking id or anything else on an anonymous span: the privacy pin", () => {
    for (const leak of [{ title: "The MacLeod wedding" }, { bookingId: BOOKING }, { eventId: EVENT }, { ownerName: "Isla" }]) {
      for (const kind of ["held", "busy"]) {
        expect(RoomDaySchema.safeParse({ ...roomDay, spans: [{ kind, ...span, ...leak }] }).success, `${kind} ${Object.keys(leak)[0] ?? ""}`).toBe(false);
      }
    }
  });

  it("refuses a day that is not YYYY-MM-DD, an unknown query key and an out-of-range turnaround", () => {
    expect(RoomDayQuerySchema.safeParse({ spaceId: ROOM, day: "10-05-2030" }).success).toBe(false);
    expect(RoomDayQuerySchema.safeParse({ spaceId: ROOM, day: "2030-05-10", extra: 1 }).success).toBe(false);
    expect(RoomDaySchema.safeParse({ ...roomDay, turnaroundMinutes: 1441 }).success).toBe(false);
  });
});

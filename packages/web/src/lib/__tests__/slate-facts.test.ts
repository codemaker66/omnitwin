import { describe, expect, it } from "vitest";
import type { CalendarBookingEntry } from "@omnitwin/types";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { createTableGroup } from "../table-group.js";
import { DEFAULT_PLANNER_CHAIR_SLUG } from "../furniture-defaults.js";
import type { PlacedItem } from "../placement.js";
import { actsInRoom, eventHoldWords, holdChipWords, meterShape, planeFacts, slateEyebrow, venueDay } from "../slate-facts.js";

// ---------------------------------------------------------------------------
// The slate's facts (T-671 slice 7; spec 6.1): what this is, in the venue's
// words, and the numbers that decide, on the copper plane.
// ---------------------------------------------------------------------------

function tables(count: number, chairsEach: number): PlacedItem[] {
  const table = getCatalogueItemBySlug("round-table-6ft");
  if (table === undefined) throw new Error("no table");
  return Array.from({ length: count }, (_, index) => createTableGroup(table.id, index * 4, 0, 0, chairsEach)).flat();
}

function rowOfChairs(count: number): PlacedItem[] {
  const one = tables(1, 1).find((item) => getCatalogueItemBySlug(DEFAULT_PLANNER_CHAIR_SLUG)?.id === item.catalogueItemId);
  if (one === undefined) throw new Error("no chair");
  return Array.from({ length: count }, (_, index) => ({ ...one, id: `chair-${String(index)}`, groupId: null, x: index * 0.6 }));
}

describe("the eyebrow", () => {
  it("names the day, in the venue's time, and the room", () => {
    expect(slateEyebrow({ startsAt: "2026-11-28T19:30:00Z", roomName: "Grand Hall" })).toBe("Sat 28 Nov 2026 · Grand Hall");
    // 23:30 UTC on 29 March 2027 is already the 30th in British Summer Time.
    expect(slateEyebrow({ startsAt: "2027-03-29T23:30:00Z", roomName: "Saloon" })).toBe("Tue 30 Mar 2027 · Saloon");
  });

  it("names only the room without a date", () => {
    expect(slateEyebrow({ startsAt: null, roomName: "Grand Hall" })).toBe("Grand Hall");
  });
});

describe("the plane", () => {
  it("counts seats and tables against the room's published dinner limit", () => {
    const facts = planeFacts({ items: tables(8, 10), guests: 80, roomSlug: "grand-hall" });
    expect(facts).toMatchObject({ seats: 80, tables: 8, limit: 180, format: "dinner", standing: "seated", short: 0 });
  });

  it("says how many are short when the seats fall below the guests", () => {
    expect(planeFacts({ items: tables(7, 10), guests: 80, roomSlug: "grand-hall" })).toMatchObject({ seats: 70, standing: "short", short: 10 });
  });

  it("says over when the seats pass the room's limit for the format", () => {
    expect(planeFacts({ items: tables(7, 10), guests: 40, roomSlug: "saloon" })).toMatchObject({ seats: 70, limit: 60, standing: "over" });
  });

  it("reads rows of chairs as theatre, and stands with no guests to seat", () => {
    expect(planeFacts({ items: rowOfChairs(30), guests: null, roomSlug: "grand-hall" })).toMatchObject({
      seats: 30, tables: 0, format: "theatre", limit: 250, standing: "no-guests",
    });
  });

  it("knows no limit for a room the venue does not publish", () => {
    expect(planeFacts({ items: [], guests: null, roomSlug: "boardroom" })).toMatchObject({ seats: 0, limit: null, standing: "no-guests" });
  });
});

describe("the event's acts in this room", () => {
  type Phase = Parameters<typeof actsInRoom>[0]["phases"][number];
  type Snapshot = Parameters<typeof actsInRoom>[0]["phaseLayoutSnapshots"][number];
  const phase = (id: string, name: string, spaceId: string | null, sortOrder: number): Phase => ({ id, name, spaceId, sortOrder });
  const snapshot = (eventPhaseId: string, configurationId: string | null, status: Snapshot["status"], frozenAt: string | null): Snapshot =>
    ({ eventPhaseId, configurationId, status, frozenAt });

  it("names each act here, in order, and which layout the function sheet reads for it", () => {
    const acts = actsInRoom({
      phases: [phase("p3", "Ceilidh", "hall", 3), phase("p1", "Drinks", "saloon", 1), phase("p2", "Dinner", "hall", 2), phase("p4", "Carriages", "hall", 4), phase("p5", "Speeches", "hall", 5)],
      phaseLayoutSnapshots: [
        snapshot("p2", "mine", "frozen", "2026-11-20T10:00:00Z"),
        snapshot("p3", "theirs", "frozen", "2026-11-20T10:00:00Z"),
        snapshot("p5", "mine", "stale", "2026-11-19T10:00:00Z"),
        snapshot("p4", "mine", "superseded", "2026-11-18T10:00:00Z"),
      ],
    }, "hall", "mine");
    expect(acts).toEqual([
      { id: "p2", name: "Dinner", state: "this" },
      { id: "p3", name: "Ceilidh", state: "other" },
      { id: "p4", name: "Carriages", state: "none" },
      { id: "p5", name: "Speeches", state: "stale" },
    ]);
  });

  it("reads the latest frozen layout when an act has several", () => {
    const acts = actsInRoom({
      phases: [phase("p1", "Dinner", "hall", 1)],
      phaseLayoutSnapshots: [snapshot("p1", "mine", "frozen", "2026-11-19T10:00:00Z"), snapshot("p1", "theirs", "frozen", "2026-11-20T10:00:00Z")],
    }, "hall", "mine");
    expect(acts[0]?.state).toBe("other");
  });
});

describe("the seats meter", () => {
  it("fills in proportion to seats over guests, with a tick when everyone has a seat", () => {
    expect(meterShape({ guests: 100, seats: 80, limit: 180, inHand: 0 })).toEqual({ fill: 0.8, handTo: 0.8, overFrom: null, full: false });
    expect(meterShape({ guests: 80, seats: 80, limit: 180, inHand: 0 })).toMatchObject({ fill: 1, full: true });
  });

  it("shows the seats in hand as their own segment", () => {
    expect(meterShape({ guests: 100, seats: 80, limit: 180, inHand: 10 })).toMatchObject({ fill: 0.8, handTo: 0.9 });
    // In hand past the guests: the bar scales to what would stand.
    expect(meterShape({ guests: 100, seats: 95, limit: 180, inHand: 10 })).toMatchObject({ fill: 95 / 105, handTo: 1 });
  });

  it("marks the part past the room's published seats", () => {
    expect(meterShape({ guests: 60, seats: 70, limit: 60, inHand: 0 })).toMatchObject({ fill: 1, overFrom: 60 / 70, full: true });
  });

  it("reads the room's published seats as the guests when there is no event", () => {
    expect(meterShape({ guests: null, seats: 90, limit: 180, inHand: 0 })).toMatchObject({ fill: 0.5, full: false });
    expect(meterShape({ guests: null, seats: 0, limit: null, inHand: 0 })).toEqual({ fill: 0, handTo: 0, overFrom: null, full: false });
  });
});

describe("the Diary's day", () => {
  it("is the event's day in the venue's zone", () => {
    expect(venueDay("2026-11-28T19:30:00Z", null)).toBe("2026-11-28");
    expect(venueDay("2027-03-29T23:30:00Z", null)).toBe("2027-03-30");
    expect(venueDay("2027-03-29T23:30:00Z", "UTC")).toBe("2027-03-29");
  });
});

describe("the hold chip", () => {
  type HoldFields = Pick<CalendarBookingEntry, "status" | "kind" | "rank" | "jointFlag">;
  const entry = (patch: Partial<HoldFields>): HoldFields => ({ status: "active", kind: "hold", rank: 1, jointFlag: false, ...patch });

  it("names the hold the way the Diary does, short", () => {
    expect(holdChipWords(entry({}))).toBe("1st option");
    expect(holdChipWords(entry({ rank: 2 }))).toBe("2nd option");
    expect(holdChipWords(entry({ jointFlag: true }))).toBe("Joint 1st");
    expect(holdChipWords(entry({ rank: null }))).toBe("Provisional");
    expect(holdChipWords(entry({ kind: "ink" }))).toBe("Confirmed");
  });

  it("shows nothing for a booking that is not a live hold or a confirmation", () => {
    expect(holdChipWords(entry({ status: "released" }))).toBeNull();
    expect(holdChipWords(entry({ kind: "prospect" }))).toBeNull();
    expect(holdChipWords(entry({ kind: "internal_block" }))).toBeNull();
  });

  it("finds this event's standing in the Diary: a confirmation first, then its best live hold", () => {
    type Linked = Pick<CalendarBookingEntry, "entryType" | "eventId" | "status" | "kind" | "rank" | "jointFlag">;
    const booking = (patch: Partial<Linked>): Linked => ({ entryType: "booking", eventId: "event-1", status: "active", kind: "hold", rank: 2, jointFlag: false, ...patch });
    expect(eventHoldWords([booking({}), booking({ rank: 1 }), booking({ eventId: "other", kind: "ink" })], "event-1")).toBe("1st option");
    expect(eventHoldWords([booking({ rank: 1 }), booking({ kind: "ink", rank: null })], "event-1")).toBe("Confirmed");
    expect(eventHoldWords([booking({ rank: null }), booking({ rank: 3 })], "event-1")).toBe("3rd option");
    expect(eventHoldWords([booking({ status: "released", rank: 1 })], "event-1")).toBeNull();
    expect(eventHoldWords([], "event-1")).toBeNull();
  });
});

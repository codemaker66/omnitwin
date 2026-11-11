import { describe, expect, it } from "vitest";
import type { SupplierArrival } from "@omnitwin/types";
import { buildingDay } from "../building-day.js";
import type { DayBoardLane, DayBoardSlot } from "../day-board-state.js";

// ---------------------------------------------------------------------------
// The building's day: the first setup or supplier opens it, the last
// clear-down or supplier out closes it, and whoever is marked in and not
// gone is still in it.
// ---------------------------------------------------------------------------

const ms = (time: string, day = "14"): number => Date.parse(`2026-11-${day}T${time}:00.000Z`);
/** Saturday 14 November, 04:00 to 04:00. */
const DAY = { fromMs: ms("04:00"), toMs: ms("04:00", "15") };

function slot(bookingId: string, title: string, setup: string, start: string, end: string, clear: string, clearDay = "14", startDay = "14"): DayBoardSlot {
  return {
    bookingId, title, setupStartsAtMs: ms(setup, startDay), startsAtMs: ms(start, startDay), endsAtMs: ms(end, clearDay),
    segments: { setupStartsAtMs: ms(setup, startDay), doorsAtMs: ms(start, startDay), endsAtMs: ms(end, clearDay), clearDownEndsAtMs: ms(clear, clearDay), turnaroundMinutes: 60 },
  } as DayBoardSlot;
}

function lanes(...slots: DayBoardSlot[]): DayBoardLane[] {
  return [{ room: { id: "00000000-0000-4000-8000-0000000000a1", name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }, slots }];
}

function arrival(bookingId: string, name: string, arrives: string, leaves: string | null, overrides: Partial<SupplierArrival> = {}): SupplierArrival {
  return {
    id: `00000000-0000-4000-8000-${name.length.toString(16).padStart(12, "0")}`, venueId: "00000000-0000-4000-8000-000000000001", bookingId,
    supplierName: name, category: null, arrivesAt: new Date(ms(arrives)).toISOString(), leavesBy: leaves === null ? null : new Date(ms(leaves, leaves < arrives ? "15" : "14")).toISOString(),
    entrance: null, contact: null, note: null, arrivedAt: null, arrivedByName: null, leftAt: null, leftByName: null, revision: 1, updatedAt: "2026-11-14T09:00:00.000Z", ...overrides,
  };
}

describe("buildingDay", () => {
  it("opens for the first setup and closes after the last clear-down", () => {
    const day = buildingDay(lanes(
      slot("breakfast", "Merchants' Breakfast", "07:00", "08:00", "10:00", "11:00"),
      slot("dinner", "Wedding dinner", "16:30", "18:30", "00:30", "01:30", "15"),
    ), [], DAY);
    expect(day.openBy).toEqual({ atMs: ms("07:00"), why: "Merchants' Breakfast sets up" });
    expect(day.lockUpAfter).toEqual({ atMs: ms("01:30", "15"), why: "Wedding dinner clears" });
    expect(day.stillIn).toEqual([]);
  });

  it("opens earlier for a supplier due before any setup, and stays open for one leaving last", () => {
    const day = buildingDay(lanes(slot("dinner", "Wedding dinner", "16:30", "18:30", "23:00", "23:30")), [
      arrival("dinner", "Print Room Couriers", "06:30", "07:00"),
      arrival("dinner", "The Kelvin Reelers", "20:30", "00:45"),
      arrival("elsewhere", "Not on the board", "05:00", null),
    ], DAY);
    expect(day.openBy).toEqual({ atMs: ms("06:30"), why: "Print Room Couriers due" });
    expect(day.lockUpAfter).toEqual({ atMs: ms("00:45", "15"), why: "The Kelvin Reelers out" });
  });

  it("names whoever is marked in and not yet gone", () => {
    const day = buildingDay(lanes(slot("dinner", "Wedding dinner", "16:30", "18:30", "23:00", "23:30")), [
      arrival("dinner", "The Kelvin Reelers", "20:30", "00:45", { arrivedAt: "2026-11-14T20:34:00.000Z", arrivedByName: "Jamie" }),
      arrival("dinner", "Ferry Road Cakes", "17:00", "17:30", { arrivedAt: "2026-11-14T17:02:00.000Z", leftAt: "2026-11-14T17:20:00.000Z" }),
      arrival("dinner", "Clydeside Kitchen Co.", "15:30", null, { arrivedAt: "2026-11-14T15:31:00.000Z" }),
    ], DAY);
    expect(day.stillIn.map((item) => item.supplierName)).toEqual(["Clydeside Kitchen Co.", "The Kelvin Reelers"]);
  });

  it("keeps a late function's lock-up in the small hours, even where the day ends at midnight", () => {
    const midnight = { fromMs: ms("00:00"), toMs: ms("00:00", "15") };
    const day = buildingDay(lanes(
      slot("quiz", "Charity quiz night", "18:00", "18:30", "23:00", "23:45"),
      slot("dinner", "Wedding dinner", "16:30", "18:30", "00:30", "01:15", "15"),
    ), [], midnight);
    expect(day.lockUpAfter).toEqual({ atMs: ms("01:15", "15"), why: "Wedding dinner clears" });
  });

  it("lets a booking running for days set neither time: its daily hours are not on the Diary", () => {
    const day = buildingDay(lanes(
      slot("exhibition", "Exhibition", "10:00", "10:00", "17:00", "17:45", "16", "12"),
      slot("dinner", "Wedding dinner", "16:30", "18:30", "23:00", "23:30"),
    ), [], DAY);
    expect(day.openBy).toEqual({ atMs: ms("16:30"), why: "Wedding dinner sets up" });
    expect(day.lockUpAfter).toEqual({ atMs: ms("23:30"), why: "Wedding dinner clears" });
  });

  it("says nothing of a day with no bookings", () => {
    expect(buildingDay([], [], DAY)).toEqual({ openBy: null, lockUpAfter: null, stillIn: [] });
  });
});

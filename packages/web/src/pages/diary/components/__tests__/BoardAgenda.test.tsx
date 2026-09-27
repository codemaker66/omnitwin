import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CalendarBookingEntry, CalendarEntry, CalendarPhaseEntry } from "@omnitwin/types";
import { BoardAgenda } from "../BoardAgenda.js";
import { boardRange, dayColumns } from "../../lib/board-time.js";

// ---------------------------------------------------------------------------
// The week on a phone (roadmap N3): day by day, each day's bookings in time
// order across the rooms.
// ---------------------------------------------------------------------------

const HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
const rooms = [
  { id: HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
  { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
];
// The week of Monday 14 September 2026; now is Wednesday 16th, 09:00 BST.
const range = boardRange(Date.parse("2026-09-16T12:00:00.000Z"), "week");
const NOW = Date.parse("2026-09-16T08:00:00.000Z");

function booking(id: string, overrides: Partial<CalendarBookingEntry> & Pick<CalendarBookingEntry, "startsAt" | "endsAt">): CalendarBookingEntry {
  return {
    entryType: "booking", id, spaceId: HALL, kind: "ink", status: "active", state: "ink", title: id, eventType: null,
    rank: null, jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null,
    eventId: null, seriesId: null, ...overrides,
  };
}

const DINNER = booking("Hammermen dinner", { startsAt: "2026-09-17T17:00:00.000Z", endsAt: "2026-09-17T22:00:00.000Z" });
const CEILIDH = booking("Robertson ceilidh", {
  spaceId: SALOON, kind: "hold", state: "hold", rank: 2, startsAt: "2026-09-17T16:00:00.000Z", endsAt: "2026-09-17T21:00:00.000Z",
});
const OVERNIGHT = booking("late-reception", { title: "Late reception", startsAt: "2026-09-18T21:00:00.000Z", endsAt: "2026-09-19T01:00:00.000Z" });
const SET_UP: CalendarPhaseEntry = {
  entryType: "phase", id: "set-up", spaceId: HALL, eventId: "00000000-0000-4000-8000-0000000000e1", eventName: "Hammermen dinner",
  name: "Set-up", startsAt: "2026-09-17T13:00:00.000Z", endsAt: "2026-09-17T16:00:00.000Z", sortOrder: 0,
};

afterEach(cleanup);

function renderAgenda(entries: readonly CalendarEntry[], extra: Partial<Parameters<typeof BoardAgenda>[0]> = {}): {
  onOpenBooking: ReturnType<typeof vi.fn>; onOpenDay: ReturnType<typeof vi.fn>;
} {
  const onOpenBooking = vi.fn();
  const onOpenDay = vi.fn();
  render(<BoardAgenda rooms={rooms} entries={entries} range={range} nowMs={NOW} conflictSeverity={new Map()}
    onOpenBooking={onOpenBooking} onOpenDay={onOpenDay} {...extra} />);
  return { onOpenBooking, onOpenDay };
}

/** Each day as read: its name, then each row's lines. */
function days(): { readonly day: string; readonly rows: string[][] }[] {
  return Array.from(document.querySelectorAll(".diary-agenda-day")).map((day) => ({
    day: day.querySelector(".diary-agenda-dayname > span")?.textContent ?? "",
    rows: Array.from(day.querySelectorAll(".diary-agenda-booking, .diary-agenda-phase, .diary-agenda-free")).map((row) =>
      row.classList.contains("diary-agenda-free") ? [row.textContent ?? ""] : Array.from(row.children).map((line) => line.textContent ?? "")),
  }));
}

describe("BoardAgenda", () => {
  it("reads the week day by day, each day's bookings in time order across the rooms", () => {
    renderAgenda([DINNER, CEILIDH, SET_UP]);
    const week = days();
    expect(week.map((day) => day.day)).toEqual(dayColumns(range).map((day) => day.label));
    expect(week[3]).toEqual({ day: dayColumns(range)[3]?.label, rows: [
      ["14:00–17:00", "Set-up", "Grand Hall · Occupancy footprint · Hammermen dinner"],
      ["17:00–22:00", "Robertson ceilidh", "Saloon · Provisional · 2nd option"],
      ["18:00–23:00", "Hammermen dinner", "Grand Hall · Confirmed"],
    ] });
    expect(week[0]?.rows).toEqual([["Nothing booked."]]);
    // Today is marked where it falls.
    expect(document.querySelector(".diary-agenda-day.is-today .diary-agenda-dayname small")?.textContent).toBe("Today");
  });

  it("says nothing of empty days while the week is on its way", () => {
    renderAgenda([], { pending: true });
    expect(screen.queryByText("Nothing booked.")).toBeNull();
    expect(days()).toHaveLength(7);
  });

  it("shows a booking past midnight on both days, with one focus anchor", () => {
    renderAgenda([OVERNIGHT]);
    const rows = document.querySelectorAll("[data-booking-id='late-reception']");
    expect(rows).toHaveLength(2);
    expect(document.querySelectorAll("#diary-block-late-reception")).toHaveLength(1);
    expect(rows[1]?.textContent).toContain("continues from the day before");
  });

  it("opens a booking, a day, and a new booking on a day", () => {
    const onCreateOnDay = vi.fn();
    const { onOpenBooking, onOpenDay } = renderAgenda([DINNER], { onCreateOnDay });
    fireEvent.click(screen.getByRole("button", { name: /^Hammermen dinner — Confirmed, 18:00–23:00, Grand Hall/u }));
    expect(onOpenBooking).toHaveBeenCalledWith(DINNER);
    const thursday = dayColumns(range)[3];
    fireEvent.click(screen.getByRole("button", { name: `Open ${thursday?.label ?? ""} in Day view` }));
    expect(onOpenDay).toHaveBeenCalledWith(thursday?.startMs);
    fireEvent.click(screen.getByRole("button", { name: `Add a booking on ${thursday?.label ?? ""}` }));
    expect(onCreateOnDay).toHaveBeenCalledWith(HALL, thursday?.startMs);
  });

  it("offers no Add to a role that cannot write", () => {
    renderAgenda([DINNER]);
    expect(screen.queryByRole("button", { name: /^Add a booking on/u })).toBeNull();
  });
});

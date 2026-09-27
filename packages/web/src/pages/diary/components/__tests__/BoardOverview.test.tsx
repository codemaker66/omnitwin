import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CalendarBookingEntry, CalendarEntry, ConflictSeverity } from "@omnitwin/types";
import { BoardOverview } from "../BoardOverview.js";
import { boardRange, dayColumns } from "../../lib/board-time.js";
import { bookingStateLabel, bookingTimeLabel, entriesForDay } from "../../lib/board-overview.js";

const entry: CalendarBookingEntry = {
  entryType: "booking", id: "short-booking", spaceId: "room", kind: "ink", status: "active", state: "ink",
  title: "Arrival and audiovisual accessibility briefing", startsAt: "2026-09-07T08:00:00Z", endsAt: "2026-09-07T08:15:00Z",
  rank: null, jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null,
  eventId: null, eventType: "meeting", seriesId: null, guestCount: 0,
};
const range = boardRange(Date.parse("2026-09-07T12:00Z"), "week");
const rooms = [{ id: "room", name: "Unmapped room", slug: "unmapped-room", sortOrder: 0 }];
afterEach(cleanup);

describe("BoardOverview", () => {
  it("retains a complete accessible short-booking title and exact times, with genuine mouse and keyboard opening", () => {
    const onOpenBooking = vi.fn();
    render(<BoardOverview rooms={rooms} entries={[entry]} range={range} nowMs={range.fromMs}
      conflictSeverity={new Map()} onOpenBooking={onOpenBooking} onOpenDay={vi.fn()} />);
    const card = screen.getByRole("button", { name: /Arrival and audiovisual accessibility briefing — Confirmed, 09:00–09:15/ });
    expect(screen.getByText(entry.title)).toBeDefined();
    expect(screen.getByText("09:00–09:15")).toBeDefined();
    expect(card.getAttribute("aria-label")).toContain("0 guests");
    expect(card.getAttribute("title")).toContain(entry.title);
    fireEvent.click(card); fireEvent.keyDown(card, { key: "Enter" }); fireEvent.keyDown(card, { key: " " });
    expect(onOpenBooking.mock.calls).toEqual([[entry], [entry], [entry]]);
    expect(card.getAttribute("style")).toBeNull();
    expect(document.querySelector("[data-diary-lane]")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });
  it("keeps overnight cards individually addressable, with one stable focus anchor", () => {
    const overnight = { ...entry, startsAt: "2026-09-07T22:00Z", endsAt: "2026-09-09T02:00Z" };
    render(<BoardOverview rooms={rooms} entries={[overnight]} range={range} nowMs={range.fromMs}
      conflictSeverity={new Map([[entry.id, "warning"]])} onOpenBooking={vi.fn()} onOpenDay={vi.fn()} />);
    const cards = document.querySelectorAll("[data-booking-id='short-booking']");
    expect(cards).toHaveLength(3);
    expect(new Set(Array.from(cards, (card) => card.id)).size).toBe(3);
    expect(document.querySelectorAll("#diary-block-short-booking")).toHaveLength(1);
    expect(screen.getAllByText("Continues")).toHaveLength(2);
    expect(screen.getAllByText("Review")).toHaveLength(3);
  });
  it("names a live hold's option in copper, and its decision once a week or less remains", () => {
    // Monday 7 September 2026, 09:00 BST.
    const nowMs = Date.parse("2026-09-07T08:00:00Z");
    const hold = { ...entry, kind: "hold" as const, state: "hold" as const, eventType: "wedding" };
    const entries: readonly CalendarEntry[] = [
      entry,
      { ...hold, id: "wedding", title: "MacLeod wedding", rank: 1, decisionAt: "2026-09-09T11:00:00Z", startsAt: "2026-09-12T12:00:00Z", endsAt: "2026-09-12T21:30:00Z" },
      { ...hold, id: "ceilidh", title: "Robertson ceilidh", rank: 2, decisionAt: "2026-10-01T11:00:00Z", startsAt: "2026-09-11T16:00:00Z", endsAt: "2026-09-11T21:00:00Z" },
      { ...hold, id: "released", title: "Released lunch", status: "released", state: "released", rank: 1, decisionAt: "2026-09-09T11:00:00Z",
        startsAt: "2026-09-10T11:00:00Z", endsAt: "2026-09-10T13:00:00Z" },
    ];
    render(<BoardOverview rooms={rooms} entries={entries} range={range} nowMs={nowMs}
      conflictSeverity={new Map()} onOpenBooking={vi.fn()} onOpenDay={vi.fn()} />);
    const card = (id: string): Element | null => document.querySelector(`[data-booking-id='${id}']`);
    expect(card("wedding")?.querySelector(".diary-overview-status")?.textContent).toBe("Provisional · 1st option");
    expect(card("wedding")?.querySelector(".diary-option")?.textContent).toBe("1st option");
    expect(card("wedding")?.querySelector(".diary-overview-age")?.textContent).toBe("Decides in 2 days");
    expect(card("wedding")?.getAttribute("aria-label")).toContain(", Decides in 2 days");
    // Further off than a week, the option alone.
    expect(card("ceilidh")?.querySelector(".diary-option")?.textContent).toBe("2nd option");
    expect(card("ceilidh")?.querySelector(".diary-overview-age")).toBeNull();
    // A confirmed booking and a released hold carry neither.
    for (const id of ["short-booking", "released"]) {
      expect(card(id)?.querySelector(".diary-option, .diary-overview-age")).toBeNull();
    }
    expect(card("released")?.querySelector(".diary-overview-status")?.textContent).toBe("Released");
  });

  it("is one Tab stop, today's heading until a place is landed on, and the place after", () => {
    // Wednesday 9 September 2026, 11:00 BST.
    const nowMs = Date.parse("2026-09-09T10:00:00Z");
    const view = render(<BoardOverview rooms={rooms} entries={[entry]} range={range} nowMs={nowMs}
      conflictSeverity={new Map()} onOpenBooking={vi.fn()} onOpenDay={vi.fn()} onCreateOnDay={vi.fn()} />);
    const stops = (): Element[] => Array.from(document.querySelectorAll("[tabindex='0']"));
    expect(stops().map((stop) => stop.getAttribute("aria-label"))).toEqual([expect.stringMatching(/^Open Wed,? 9 Sept? in Day view$/u)]);
    // The summaries region is no second stop: its places are reachable.
    expect(screen.getByRole("region", { name: "Room and day booking summaries" }).hasAttribute("tabindex")).toBe(false);
    const card = screen.getByRole("button", { name: /^Arrival and audiovisual accessibility briefing — /u });
    act(() => { card.focus(); });
    expect(stops()).toEqual([card]);
    // A booking the board no longer shows gives the stop back to today's heading.
    view.rerender(<BoardOverview rooms={rooms} entries={[]} range={range} nowMs={nowMs}
      conflictSeverity={new Map()} onOpenBooking={vi.fn()} onOpenDay={vi.fn()} onCreateOnDay={vi.fn()} />);
    expect(stops().map((stop) => stop.getAttribute("aria-label"))).toEqual([expect.stringMatching(/^Open Wed,? 9 Sept? in Day view$/u)]);
  });

  it("moves across the days, down a square's stack and across rooms, and to a row's ends", () => {
    const other = { id: "other-room", name: "Second room", slug: "second-room", sortOrder: 1 };
    const booked = (id: string, spaceId: string, startsAt: string, endsAt: string): CalendarBookingEntry =>
      ({ ...entry, id, title: id, spaceId, startsAt, endsAt });
    render(<BoardOverview rooms={[...rooms, other]} range={range} nowMs={range.fromMs} conflictSeverity={new Map()}
      onOpenBooking={vi.fn()} onOpenDay={vi.fn()} onCreateOnDay={vi.fn()} entries={[
        booked("breakfast", "room", "2026-09-07T07:00:00Z", "2026-09-07T09:00:00Z"),
        booked("lunch", "room", "2026-09-07T11:00:00Z", "2026-09-07T13:00:00Z"),
        booked("ceilidh", other.id, "2026-09-08T18:00:00Z", "2026-09-08T22:00:00Z"),
      ]} />);
    const press = (key: string, ctrlKey = false): string | null => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key, ctrlKey });
      return document.activeElement?.getAttribute("aria-label") ?? null;
    };
    act(() => { screen.getByRole("button", { name: /^Open Mon/u }).focus(); });
    expect(press("ArrowDown")).toMatch(/^breakfast — /u);
    expect(press("ArrowDown")).toMatch(/^lunch — /u);
    expect(press("ArrowDown")).toMatch(/^New booking — Unmapped room, Mon/u);
    expect(press("ArrowDown")).toMatch(/^New booking — Second room, Mon/u);
    expect(press("ArrowRight")).toMatch(/^ceilidh — /u);
    expect(press("ArrowUp")).toMatch(/^New booking — Unmapped room, Tue/u);
    expect(press("End")).toMatch(/^New booking — Unmapped room, Sun/u);
    expect(press("Home")).toMatch(/^breakfast — /u);
    expect(press("End", true)).toMatch(/^New booking — Second room, Sun/u);
    expect(press("Home", true)).toMatch(/^Open Mon/u);
    // At an edge a key goes nowhere, and the arrows are the grid's own.
    expect(press("ArrowLeft")).toMatch(/^Open Mon/u);
    expect(fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowUp" })).toBe(false);
    expect(Array.from(document.querySelectorAll("[tabindex='0']"))).toEqual([document.activeElement]);
  });

  it("opens a venue-local day using the actual day boundary", () => {
    const onOpenDay = vi.fn();
    render(<BoardOverview rooms={rooms} entries={[entry]} range={range} nowMs={range.fromMs}
      conflictSeverity={new Map()} onOpenBooking={vi.fn()} onOpenDay={onOpenDay} />);
    fireEvent.click(screen.getByRole("button", { name: /^Open Mon / }));
    expect(onOpenDay).toHaveBeenCalledWith(dayColumns(range)[0]?.startMs);
  });

  it("does no work for a parent render with unchanged props, and redraws for new entries", () => {
    // Every booking card reads its conflict severity while rendering.
    class CountingSeverity extends Map<string, ConflictSeverity> {
      reads = 0;
      override get(key: string): ConflictSeverity | undefined {
        this.reads += 1;
        return super.get(key);
      }
    }
    const conflictSeverity = new CountingSeverity();
    const props = { rooms, entries: [entry], range, nowMs: range.fromMs, conflictSeverity, onOpenBooking: vi.fn(), onOpenDay: vi.fn() };
    const view = render(<BoardOverview {...props} />);
    expect(conflictSeverity.reads).toBe(1);
    view.rerender(<BoardOverview {...props} />);
    expect(conflictSeverity.reads).toBe(1);
    view.rerender(<BoardOverview {...props} entries={[{ ...entry, title: "Moved briefing" }]} />);
    expect(conflictSeverity.reads).toBe(2);
    expect(screen.getByRole("button", { name: /^Moved briefing — Confirmed, 09:00–09:15/ })).toBeDefined();
  });

  it("lays out every room × day cell exactly as the per-cell computation, with its labels", () => {
    const other = { id: "other-room", name: "Second room", slug: "second-room", sortOrder: 1 };
    const entries: readonly CalendarEntry[] = [
      { ...entry, id: "overnight", startsAt: "2026-09-07T22:45:00Z", endsAt: "2026-09-08T01:00:00Z", clientName: "Fiona MacLeod" },
      { ...entry, id: "B-tie", spaceId: other.id, kind: "hold", state: "hold", rank: 2, startsAt: "2026-09-09T16:00:00Z", endsAt: "2026-09-09T18:00:00Z" },
      { ...entry, id: "a-tie", spaceId: other.id, kind: "prospect", state: "prospect", startsAt: "2026-09-09T16:00:00Z", endsAt: "2026-09-12T10:00:00Z" },
      { ...entry, id: "released", status: "released", state: "released", kind: "hold", startsAt: "2026-09-10T10:00:00Z", endsAt: "2026-09-10T12:00:00Z" },
      { entryType: "phase", id: "phase", spaceId: other.id, eventId: "event", eventName: "Setup-only event", name: "Setup",
        startsAt: "2026-09-09T15:00:00Z", endsAt: "2026-09-09T15:30:00Z", sortOrder: 0 },
      entry,
    ];
    const allRooms = [...rooms, other];
    render(<BoardOverview rooms={allRooms} entries={entries} range={range} nowMs={range.fromMs}
      conflictSeverity={new Map()} onOpenBooking={vi.fn()} onOpenDay={vi.fn()} />);
    const days = dayColumns(range);
    for (const room of allRooms) {
      const cells = document.querySelectorAll(`[data-diary-room="${room.id}"] .diary-overview-cell`);
      expect(cells).toHaveLength(days.length);
      days.forEach((day, column) => {
        const expected = entriesForDay(entries, room.id, day);
        const cell = cells[column];
        expect(Array.from(cell?.children ?? [], (card) => card.getAttribute("data-booking-id") ?? `phase:${card.querySelector("strong")?.textContent ?? ""}`))
          .toEqual(expected.map((item) => (item.entryType === "booking" ? item.id : `phase:${item.name}`)));
        for (const item of expected) {
          if (item.entryType !== "booking") continue;
          const card = cell?.querySelector(`[data-booking-id="${item.id}"]`);
          expect(card?.querySelector("time")?.textContent).toBe(bookingTimeLabel(item));
          expect(card?.getAttribute("aria-label")).toContain(`${bookingStateLabel(item)}, ${bookingTimeLabel(item)}, ${room.name}, ${day.label}`);
        }
      });
    }
    // One stable focus anchor per booking, on its first visible day.
    expect(document.querySelector("#diary-block-a-tie")?.closest(".diary-overview-cell")).toBe(
      document.querySelectorAll(`[data-diary-room="other-room"] .diary-overview-cell`)[2],
    );
    expect(document.querySelectorAll("[data-booking-id='a-tie']")).toHaveLength(4);
  });
});

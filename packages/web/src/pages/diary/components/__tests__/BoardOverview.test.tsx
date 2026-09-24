import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

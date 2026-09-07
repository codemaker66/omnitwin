import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CalendarBookingEntry } from "@omnitwin/types";
import { BoardOverview } from "../BoardOverview.js";
import { boardRange, dayColumns } from "../../lib/board-time.js";

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
});

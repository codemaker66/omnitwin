import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CalendarBookingEntry, CalendarRoom } from "@omnitwin/types";
import { BookingDrawer } from "../BookingDrawer.js";

// ---------------------------------------------------------------------------
// The Diary→planner corridor (the "Floor plan" section of the booking drawer).
//
// The API has always accepted `eventId` on a booking — UpdateBookingSchema
// declares it and updateBookingCore verifies the event belongs to the
// booking's venue — but nothing in the client ever sent it, so a coordinator
// had no way to say "this booking is the thing I am planning". Nothing pinned
// that behaviour either, which is why reading the route adapter alone makes
// the link look broken. These tests pin the client half.
// ---------------------------------------------------------------------------

const {
  createBookingMock,
  updateBookingMock,
  transitionBookingMock,
  convertEnquiryMock,
  createEventMock,
} = vi.hoisted(() => ({
  createBookingMock: vi.fn(),
  updateBookingMock: vi.fn(),
  transitionBookingMock: vi.fn(),
  convertEnquiryMock: vi.fn(),
  createEventMock: vi.fn(),
}));

vi.mock("../../../../api/diary.js", () => ({
  createBooking: createBookingMock,
  updateBooking: updateBookingMock,
  transitionBooking: transitionBookingMock,
  convertEnquiry: convertEnquiryMock,
}));

vi.mock("../../../../api/events.js", () => ({
  createEvent: createEventMock,
}));

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const BOOKING_ID = "00000000-0000-4000-8000-0000000000c1";
const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";

const ROOMS: readonly CalendarRoom[] = [
  { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
];

function booking(overrides: Partial<CalendarBookingEntry> = {}): CalendarBookingEntry {
  return {
    entryType: "booking",
    id: BOOKING_ID,
    spaceId: GRAND_HALL,
    kind: "ink",
    status: "active",
    state: "ink",
    title: "Chamber dinner",
    eventType: "dinner",
    startsAt: "2026-09-18T17:00:00.000Z",
    endsAt: "2026-09-18T22:00:00.000Z",
    rank: null,
    jointFlag: false,
    decisionAt: null,
    ownerUserId: null,
    nextAction: null,
    nextActionDueAt: null,
    eventId: null,
    seriesId: null,
    ...overrides,
  };
}

/** The drawer's callbacks are typed, so the spies must be too — an untyped
 *  `vi.fn()` is not assignable to `(message: string) => void`. */
type SavedSpy = ReturnType<typeof vi.fn<(message: string) => void>>;

function renderEdit(
  entry: CalendarBookingEntry,
  onSaved: SavedSpy = vi.fn<(message: string) => void>(),
): { onSaved: SavedSpy } {
  render(
    <BookingDrawer
      mode={{ kind: "edit", booking: entry }}
      rooms={ROOMS}
      venueId={VENUE}
      role="staff"
      onClose={vi.fn<() => void>()}
      onSaved={onSaved}
    />,
  );
  return { onSaved };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BookingDrawer — floor plan section", () => {
  it("offers to start a plan when the booking has none", () => {
    renderEdit(booking());
    expect(screen.getByRole("button", { name: "Start a floor plan" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open the plan" })).toBeNull();
  });

  it("links an attached plan into the planner at the id the planner reads", () => {
    renderEdit(booking({ eventId: EVENT_ID }));
    const link = screen.getByRole("link", { name: "Open the plan" });
    // /plan?eventId= is precisely what use-linked-event.ts binds from.
    expect(link.getAttribute("href")).toBe(`/plan?eventId=${EVENT_ID}`);
    expect(screen.queryByRole("button", { name: "Start a floor plan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Detach" })).toBeTruthy();
  });

  it("seeds the new event from the booking, then links the two", async () => {
    createEventMock.mockResolvedValue({ event: { id: EVENT_ID } });
    updateBookingMock.mockResolvedValue(booking({ eventId: EVENT_ID }));
    const { onSaved } = renderEdit(booking());

    fireEvent.click(screen.getByRole("button", { name: "Start a floor plan" }));

    await waitFor(() => {
      expect(createEventMock).toHaveBeenCalledTimes(1);
    });
    // The event inherits the booking's identity and window — a coordinator
    // should never retype what the Diary already knows.
    expect(createEventMock).toHaveBeenCalledWith({
      venueId: VENUE,
      name: "Chamber dinner",
      eventType: "dinner",
      status: "draft",
      guestCount: 0,
      startsAt: "2026-09-18T17:00:00.000Z",
      endsAt: "2026-09-18T22:00:00.000Z",
    });
    await waitFor(() => {
      expect(updateBookingMock).toHaveBeenCalledWith(BOOKING_ID, { eventId: EVENT_ID });
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("Started a floor plan for Chamber dinner.");
    });
  });

  it("detaching sends an explicit null, not an omitted field", async () => {
    updateBookingMock.mockResolvedValue(booking());
    const { onSaved } = renderEdit(booking({ eventId: EVENT_ID }));

    fireEvent.click(screen.getByRole("button", { name: "Detach" }));

    await waitFor(() => {
      expect(updateBookingMock).toHaveBeenCalledWith(BOOKING_ID, { eventId: null });
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("Detached the floor plan from Chamber dinner.");
    });
  });

  it("never links a booking to a plan that failed to commit", async () => {
    createEventMock.mockRejectedValue(new Error("network"));
    const { onSaved } = renderEdit(booking());

    fireEvent.click(screen.getByRole("button", { name: "Start a floor plan" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("could not be started");
    });
    // The booking must be untouched — a half-made link is worse than none.
    expect(updateBookingMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a failed LINK is reported honestly — the plan exists, and is not claimed otherwise", async () => {
    createEventMock.mockResolvedValue({ event: { id: EVENT_ID } });
    updateBookingMock.mockRejectedValue(new Error("network"));
    const { onSaved } = renderEdit(booking());

    fireEvent.click(screen.getByRole("button", { name: "Start a floor plan" }));

    await waitFor(() => {
      const alert = screen.getByRole("alert").textContent ?? "";
      expect(alert).toContain("created but could not be attached");
      // "the booking is unchanged" would hide the plan that now exists.
      expect(alert).not.toContain("unchanged");
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("retrying after a failed link finishes the job instead of orphaning a second plan", async () => {
    createEventMock.mockResolvedValue({ event: { id: EVENT_ID } });
    updateBookingMock.mockRejectedValueOnce(new Error("network"));
    renderEdit(booking());

    fireEvent.click(screen.getByRole("button", { name: "Start a floor plan" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    updateBookingMock.mockResolvedValue(booking({ eventId: EVENT_ID }));
    fireEvent.click(screen.getByRole("button", { name: "Start a floor plan" }));

    await waitFor(() => {
      expect(updateBookingMock).toHaveBeenCalledTimes(2);
    });
    // The retry must NOT mint a second event — nothing can list or delete
    // orphans, so every stray one is invisible litter forever.
    expect(createEventMock).toHaveBeenCalledTimes(1);
    expect(updateBookingMock).toHaveBeenLastCalledWith(BOOKING_ID, { eventId: EVENT_ID });
  });

  it("offers no plan control to a read-only role", () => {
    render(
      <BookingDrawer
        mode={{ kind: "edit", booking: booking() }}
        rooms={ROOMS}
        venueId={VENUE}
        role="hallkeeper"
        onClose={vi.fn<() => void>()}
        onSaved={vi.fn<(message: string) => void>()}
      />,
    );
    expect(screen.queryByText("Floor plan")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start a floor plan" })).toBeNull();
  });

  it("shows no plan section while creating a booking that does not exist yet", () => {
    render(
      <BookingDrawer
        mode={{ kind: "create", spaceId: GRAND_HALL, dayStartMs: 0, ownerUserId: VENUE }}
        rooms={ROOMS}
        venueId={VENUE}
        role="staff"
        onClose={vi.fn<() => void>()}
        onSaved={vi.fn<(message: string) => void>()}
      />,
    );
    expect(screen.queryByText("Floor plan")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start a floor plan" })).toBeNull();
  });
});

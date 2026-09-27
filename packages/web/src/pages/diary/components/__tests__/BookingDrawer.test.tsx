import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CalendarBookingEntry, CalendarRoom } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
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
const SALOON = "00000000-0000-4000-8000-0000000000a2";

const ROOMS: readonly CalendarRoom[] = [
  { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
  // A second room, so a room change has somewhere to go (T-619).
  { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
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
  role = "staff",
): { onSaved: SavedSpy } {
  render(
    <BookingDrawer
      mode={{ kind: "edit", booking: entry }}
      rooms={ROOMS}
      venueId={VENUE}
      role={role}
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
  it.each(["resolve", "reject"] as const)("keeps activity through both plan writes and stops when the link %ss", async (settlement) => {
    let resolveCreate: ((value: { event: { id: string } }) => void) | undefined;
    let resolveLink: ((value: CalendarBookingEntry) => void) | undefined;
    let rejectLink: ((reason: Error) => void) | undefined;
    const createResponse = new Promise<{ event: { id: string } }>((resolve) => { resolveCreate = resolve; });
    const linkResponse = new Promise<CalendarBookingEntry>((resolve, reject) => { resolveLink = resolve; rejectLink = reject; });
    createEventMock.mockReturnValue(createResponse);
    updateBookingMock.mockReturnValue(linkResponse);
    renderEdit(booking());
    fireEvent.click(screen.getByRole("button", { name: "Start a floor plan" }));
    expect(screen.getByRole("status").textContent).toBe("Updating this booking…");
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    await act(async () => { resolveCreate?.({ event: { id: EVENT_ID } }); await createResponse; });
    expect(updateBookingMock).toHaveBeenCalledWith(BOOKING_ID, { eventId: EVENT_ID });
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
    await act(async () => {
      if (settlement === "resolve") resolveLink?.(booking({ eventId: EVENT_ID }));
      else rejectLink?.(new Error("Link unavailable"));
      await linkResponse.catch(() => undefined);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
    if (settlement === "reject") expect(screen.getByRole("alert").textContent).toContain("created but not attached");
  });
  it("offers to start a plan when the booking has none", () => {
    renderEdit(booking());
    expect(screen.getByRole("button", { name: "Start a floor plan" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open the plan" })).toBeNull();
  });

  it("links an attached plan into the planner at the id the planner reads, in the booking's own room", () => {
    renderEdit(booking({ eventId: EVENT_ID }));
    const link = screen.getByRole("link", { name: "Open the plan" });
    // /plan?eventId= is precisely what use-linked-event.ts binds from, and
    // &space= is what EditorPage's bootstrap opens; without it the planner
    // opens its default room, not the booking's.
    expect(link.getAttribute("href")).toBe(`/plan?eventId=${EVENT_ID}&space=grand-hall`);
    expect(screen.queryByRole("button", { name: "Start a floor plan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Detach" })).toBeTruthy();
  });

  it("omits the room from the plan link when the booking's space is not on the board", () => {
    renderEdit(booking({ eventId: EVENT_ID, spaceId: "00000000-0000-4000-8000-0000000000ff" }));
    const link = screen.getByRole("link", { name: "Open the plan" });
    expect(link.getAttribute("href")).toBe(`/plan?eventId=${EVENT_ID}`);
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
      expect(alert).toContain("created but not attached");
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
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Title" }).closest("fieldset")?.disabled).toBe(true);
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(updateBookingMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
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

// ---------------------------------------------------------------------------
// Edit-drawer completeness (T-619). An existing booking showed a title, times
// and a DISABLED room select; its note was rendered nowhere and dropped on
// save, and its owner was a uuid the drawer never printed. Each is a fact a
// coordinator needs before answering a phone call about the booking.
// ---------------------------------------------------------------------------
describe("BookingDrawer — edit completeness (T-619)", () => {
  it("names the owner and the linked client instead of leaving them implicit", () => {
    renderEdit(booking({
      ownerName: "Elaine Gray",
      clientName: "Mackenzie & Ross",
      eventName: "Mackenzie–Ross wedding",
      guestCount: 120,
    }));
    const detail = screen.getByLabelText("Booking summary");
    expect(within(detail).getByText("Elaine Gray")).toBeTruthy();
    expect(within(detail).getByText("Mackenzie & Ross")).toBeTruthy();
    expect(within(detail).getByText("Mackenzie–Ross wedding")).toBeTruthy();
    // The label says "Guests"; the value is the number alone.
    expect(within(detail).getByText("Guests")).toBeTruthy();
    expect(within(detail).getByText("120")).toBeTruthy();
  });

  it("says the absence out loud when there is no owner and no client", () => {
    renderEdit(booking());
    const detail = screen.getByLabelText("Booking summary");
    expect(within(detail).getByText("Nobody yet")).toBeTruthy();
    expect(within(detail).getByText("No client linked")).toBeTruthy();
  });

  it("shows the existing note and saves an edit to it", async () => {
    updateBookingMock.mockResolvedValue({ title: "Chamber dinner" });
    const { onSaved } = renderEdit(booking({ notes: "Cake table by the north door." }));
    const notes = screen.getByLabelText("Notes");
    expect(screen.getByDisplayValue("Cake table by the north door.")).toBe(notes);
    fireEvent.change(notes, { target: { value: "Cake table by the south door." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => { expect(onSaved).toHaveBeenCalled(); });
    expect(updateBookingMock).toHaveBeenCalledWith(BOOKING_ID, { notes: "Cake table by the south door." });
  });

  it("clears a note to null rather than leaving the old text on the server", async () => {
    updateBookingMock.mockResolvedValue({ title: "Chamber dinner" });
    const { onSaved } = renderEdit(booking({ notes: "Cake table by the north door." }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => { expect(onSaved).toHaveBeenCalled(); });
    expect(updateBookingMock).toHaveBeenCalledWith(BOOKING_ID, { notes: null });
  });

  it("allows a room change from the drawer, not only by dragging the block", async () => {
    updateBookingMock.mockResolvedValue({ title: "Chamber dinner" });
    const { onSaved } = renderEdit(booking());
    const room = screen.getByLabelText("Room");
    expect(room.hasAttribute("disabled")).toBe(false);
    fireEvent.change(room, { target: { value: SALOON } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => { expect(onSaved).toHaveBeenCalled(); });
    expect(updateBookingMock).toHaveBeenCalledWith(BOOKING_ID, { spaceId: SALOON });
  });

  it("sends nothing when nothing changed — a reopened note is not an edit", async () => {
    const onClose = vi.fn<() => void>();
    render(
      <BookingDrawer
        mode={{ kind: "edit", booking: booking({ notes: "Unchanged." }) }}
        rooms={ROOMS}
        venueId={VENUE}
        role="staff"
        onClose={onClose}
        onSaved={vi.fn<(message: string) => void>()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => { expect(onClose).toHaveBeenCalled(); });
    expect(updateBookingMock).not.toHaveBeenCalled();
  });

  it("promises ownership only when making a booking, never on an existing one", () => {
    renderEdit(booking({ kind: "hold", state: "hold", rank: 1, decisionAt: "2026-09-10T12:00:00.000Z",
      ownerUserId: "00000000-0000-4000-8000-0000000000aa", ownerName: "Elaine Gray",
      nextAction: "Call.", nextActionDueAt: "2026-09-09T09:00:00.000Z" }));
    expect(screen.queryByText("You will own this hold.")).toBeNull();
  });

  it.each(["manager", "sales"])("lets a %s edit, as the API does", (role) => {
    renderEdit(booking(), vi.fn<(message: string) => void>(), role);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
    expect(screen.queryByText(/Read-only booking details/)).toBeNull();
  });

  it("keeps the hallkeeper read-only", () => {
    renderEdit(booking(), vi.fn<(message: string) => void>(), "hallkeeper");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.getByText(/Read-only booking details/)).toBeTruthy();
  });
});

describe("BookingDrawer — ending a booking asks first (roadmap N3)", () => {
  const FRASER = "00000000-0000-4000-8000-0000000000c2";
  const ROBERTSON = "00000000-0000-4000-8000-0000000000c3";

  function hold(id: string, title: string, rank: number): CalendarBookingEntry {
    return booking({ id, kind: "hold", state: "hold", title, rank, decisionAt: "2026-09-10T11:00:00.000Z" });
  }

  function renderEnding(entry: CalendarBookingEntry, contested: readonly CalendarBookingEntry[], ladderRead = true): { onSaved: SavedSpy } {
    const onSaved = vi.fn<(message: string) => void>();
    render(
      <BookingDrawer
        mode={{ kind: "edit", booking: entry }}
        rooms={ROOMS}
        venueId={VENUE}
        role="staff"
        onClose={vi.fn<() => void>()}
        onSaved={onSaved}
        contested={contested}
        ladderRead={ladderRead}
      />,
    );
    return { onSaved };
  }

  it("asks before cancelling a confirmed booking, and names the 1st option that can then be confirmed", () => {
    renderEnding(booking(), [hold(FRASER, "Fraser wedding", 1)]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel the booking…" }));
    expect(transitionBookingMock).not.toHaveBeenCalled();

    const question = screen.getByRole("group", { name: "Cancel Chamber dinner?" });
    expect(within(question).getByText(
      "Grand Hall, Fri 18 Sept 18:00–23:00: the confirmed booking ends. Fraser wedding, 1st option, can then be confirmed. Nothing is sent to the client.",
    )).toBeTruthy();

    // Keep it: nothing is sent, and the question's own button takes focus back.
    fireEvent.click(within(question).getByRole("button", { name: "Keep it" }));
    expect(transitionBookingMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Cancel Chamber dinner?" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel the booking…" }));
  });

  it("releases a 1st option with a reason, and closes by saying who is now 1st option", async () => {
    const macleod = hold(BOOKING_ID, "MacLeod wedding", 1);
    transitionBookingMock.mockResolvedValue({ booking: { title: "MacLeod wedding" }, promotedToFirst: [{ id: ROBERTSON, title: "Robertson ceilidh" }] });
    const { onSaved } = renderEnding(macleod, [hold(ROBERTSON, "Robertson ceilidh", 2)]);
    fireEvent.click(screen.getByRole("button", { name: "Release…" }));

    const question = screen.getByRole("group", { name: "Release MacLeod wedding?" });
    expect(within(question).getByText(
      "Grand Hall, Fri 18 Sept 18:00–23:00: the provisional hold ends. Robertson ceilidh becomes 1st option. Nothing is sent to the client.",
    )).toBeTruthy();
    fireEvent.change(within(question).getByLabelText("Reason (optional, kept with this change)"), { target: { value: "  Chose another date  " } });
    fireEvent.click(within(question).getByRole("button", { name: "Release it" }));

    await waitFor(() => { expect(onSaved).toHaveBeenCalledWith("Released MacLeod wedding. Robertson ceilidh is now 1st option."); });
    expect(transitionBookingMock).toHaveBeenCalledWith(BOOKING_ID, "released", "Chose another date");
  });

  it("keeps the reason and says why beside it when ending fails", async () => {
    transitionBookingMock.mockRejectedValue(new ApiError(409, "This booking changed while you were working — reload the diary and try again.", "BOOKING_STATE_CHANGED"));
    renderEnding(hold(BOOKING_ID, "MacLeod wedding", 2), []);
    fireEvent.click(screen.getByRole("button", { name: "Mark lost…" }));
    const question = screen.getByRole("group", { name: "Mark MacLeod wedding lost?" });
    const reason = within(question).getByLabelText<HTMLTextAreaElement>("Reason (optional, kept with this change)");
    fireEvent.change(reason, { target: { value: "Went to another venue" } });
    fireEvent.click(within(question).getByRole("button", { name: "Mark lost" }));

    expect((await within(question).findByRole("alert")).textContent).toBe("This booking changed while you were working — reload the diary and try again.");
    expect(reason.value).toBe("Went to another venue");
    // A 2nd option leaving promotes no one to 1st, so none is named.
    expect(within(question).getByText("Grand Hall, Fri 18 Sept 18:00–23:00: the provisional hold ends. Nothing is sent to the client.")).toBeTruthy();
  });

  it("steps back out of the question with Escape, and leaves the drawer open", () => {
    const onClose = vi.fn<() => void>();
    render(
      <BookingDrawer mode={{ kind: "edit", booking: hold(BOOKING_ID, "MacLeod wedding", 1) }} rooms={ROOMS} venueId={VENUE}
        role="staff" onClose={onClose} onSaved={vi.fn<(message: string) => void>()} contested={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark expired…" }));
    fireEvent.keyDown(screen.getByRole("group", { name: "Mark MacLeod wedding expired?" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Mark MacLeod wedding expired?" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("confirms a hold at once: only a change that ends a booking's claim asks first", async () => {
    transitionBookingMock.mockResolvedValue({ booking: { title: "MacLeod wedding" }, promotedToFirst: [] });
    renderEnding(hold(BOOKING_ID, "MacLeod wedding", 1), []);
    fireEvent.click(screen.getByRole("button", { name: "Confirm it" }));
    await waitFor(() => { expect(transitionBookingMock).toHaveBeenCalledWith(BOOKING_ID, "ink"); });
    // No question was put: the drawer's only groups are its fieldsets.
    expect(screen.queryByRole("group", { name: /\?$/u })).toBeNull();
  });

  it("names no hold from a date the board has not read whole, where the 1st option may be missing", () => {
    // The board holds only a 2nd option of that date; its 1st may lie outside the range read.
    renderEnding(hold(BOOKING_ID, "Guild dinner", 1), [hold(ROBERTSON, "Robertson ceilidh", 3)], false);
    fireEvent.click(screen.getByRole("button", { name: "Release…" }));
    expect(screen.getByText(
      "Grand Hall, Fri 18 Sept 18:00–23:00: the provisional hold ends. Any hold behind it on that date moves up. Nothing is sent to the client.",
    )).toBeTruthy();
    cleanup();
    renderEnding(booking(), [hold(ROBERTSON, "Robertson ceilidh", 2)], false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel the booking…" }));
    expect(screen.getByText("Grand Hall, Fri 18 Sept 18:00–23:00: the confirmed booking ends. Nothing is sent to the client.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// A new hold's option follows the ladder (roadmap N3). The drawer used to
// default every new hold to 1st, so a hold placed where a 1st option stood
// made two 1st options. It now takes the next place the board has read, says
// what already holds the time, and follows the room and time until the booker
// sets an option.
// ---------------------------------------------------------------------------

describe("BookingDrawer — a new hold's option follows the ladder (roadmap N3)", () => {
  // Friday 18 September at the venue: its evening window is 17:00–23:00 BST.
  const FRIDAY = Date.parse("2026-09-17T23:00:00.000Z");
  const EVENING = Date.parse("2026-09-18T19:00:00.000Z");
  const fraser = booking({ id: "00000000-0000-4000-8000-0000000000f1", spaceId: SALOON, kind: "hold", state: "hold", title: "Fraser wedding", rank: 1 });
  const chamber = booking({ spaceId: SALOON, title: "Chamber dinner" });
  type Ladder = NonNullable<Parameters<typeof BookingDrawer>[0]["ladderPlace"]>;

  function renderCreate(ladder: Ladder): void {
    render(
      <BookingDrawer
        mode={{ kind: "create", spaceId: SALOON, dayStartMs: FRIDAY, ownerUserId: VENUE }}
        rooms={ROOMS}
        venueId={VENUE}
        role="staff"
        onClose={vi.fn<() => void>()}
        onSaved={vi.fn<(message: string) => void>()}
        ladderPlace={ladder}
      />,
    );
  }

  it("takes the next place, says what holds the time, and follows the time until an option is set", () => {
    // Fraser wedding holds the early evening; later, the Saloon is free.
    renderCreate((_spaceId, startMs) => (startMs < EVENING
      ? { kind: "read", rank: 2, holds: [fraser], confirmed: [chamber] }
      : { kind: "read", rank: 1, holds: [], confirmed: [] }));
    const option = screen.getByRole("spinbutton", { name: "Option" });
    expect((option as HTMLInputElement).value).toBe("2");
    const note = document.getElementById(option.getAttribute("aria-describedby") ?? "");
    expect(note?.textContent).toBe(
      "Chamber dinner is confirmed then; a hold cannot be confirmed while it stands. Held then: Fraser wedding (1st option).",
    );

    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-18T21:00" } });
    expect((option as HTMLInputElement).value).toBe("1");
    expect(screen.getByText("Nothing else holds the Saloon then.")).toBeDefined();

    // Once the booker sets an option, the ladder no longer moves it.
    fireEvent.change(option, { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-18T18:00" } });
    expect((option as HTMLInputElement).value).toBe("3");
    expect(document.getElementById(option.getAttribute("aria-describedby") ?? "")?.textContent).toMatch(/Held then: Fraser wedding \(1st option\)\.$/u);
  });

  it("suggests nothing for a date the board has not read, and says so", () => {
    renderCreate(() => ({ kind: "unread" }));
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Option" }).value).toBe("1");
    expect(screen.getByText("The board has not read that date, so no option is suggested.")).toBeDefined();
  });

  it("leaves an existing booking's option alone", () => {
    const ladder = vi.fn<Ladder>(() => ({ kind: "read", rank: 4, holds: [], confirmed: [] }));
    render(
      <BookingDrawer
        mode={{ kind: "edit", booking: fraser }}
        rooms={ROOMS}
        venueId={VENUE}
        role="staff"
        onClose={vi.fn<() => void>()}
        onSaved={vi.fn<(message: string) => void>()}
        ladderPlace={ladder}
      />,
    );
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Option" }).value).toBe("1");
    expect(ladder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Making interest only provisional asks for the hold's details (roadmap N3).
// A live hold carries its place, a decision date and a dated next action,
// and the API now refuses one without; the drawer asks before it acts.
// ---------------------------------------------------------------------------

describe("BookingDrawer — making interest only provisional asks for the hold (roadmap N3)", () => {
  const prospect = booking({ id: "00000000-0000-4000-8000-0000000000f7", spaceId: SALOON, kind: "prospect", state: "prospect", title: "Law Society dinner" });
  type Ladder = NonNullable<Parameters<typeof BookingDrawer>[0]["ladderPlace"]>;
  const fraser = booking({ spaceId: SALOON, kind: "hold", state: "hold", title: "Fraser wedding", rank: 1 });

  function renderProspect(onSaved: SavedSpy = vi.fn<(message: string) => void>()): SavedSpy {
    const ladder: Ladder = () => ({ kind: "read", rank: 2, holds: [fraser], confirmed: [] });
    render(
      <BookingDrawer
        mode={{ kind: "edit", booking: prospect }}
        rooms={ROOMS}
        venueId={VENUE}
        role="staff"
        onClose={vi.fn<() => void>()}
        onSaved={onSaved}
        ladderPlace={ladder}
      />,
    );
    return onSaved;
  }

  it("asks for the place, the decision date and the dated next action, and refuses without them", async () => {
    renderProspect();
    fireEvent.click(screen.getByRole("button", { name: "Make it provisional…" }));
    const panel = screen.getByRole("group", { name: "Make Law Society dinner provisional?" });
    expect(within(panel).getByText(/A provisional hold has an option, a decision date and a dated next action\. You will own this hold\./u)).toBeDefined();
    expect(within(panel).getByText("Held then: Fraser wedding (1st option).")).toBeDefined();
    const option = within(panel).getByRole<HTMLInputElement>("spinbutton", { name: "Option" });
    expect(option.value).toBe("2");
    await waitFor(() => { expect(document.activeElement).toBe(option); });

    fireEvent.click(within(panel).getByRole("button", { name: "Make it provisional" }));
    expect(within(panel).getByText("A provisional hold needs a decision date.")).toBeDefined();
    expect(within(panel).getByText("A provisional hold needs a next action.")).toBeDefined();
    expect(within(panel).getByText("A provisional hold needs a date for its next action.")).toBeDefined();
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("makes it provisional with what was given, and says where it stands", async () => {
    transitionBookingMock.mockResolvedValue({ booking: { ...prospect, kind: "hold", state: "hold", rank: 2 }, promotedToFirst: [] });
    const onSaved = renderProspect();
    fireEvent.click(screen.getByRole("button", { name: "Make it provisional…" }));
    const panel = screen.getByRole("group", { name: "Make Law Society dinner provisional?" });
    fireEvent.change(within(panel).getByLabelText("Decision date"), { target: { value: "2026-10-12T12:00" } });
    fireEvent.change(within(panel).getByLabelText("Next action"), { target: { value: "Send the dinner menus." } });
    fireEvent.change(within(panel).getByLabelText("Next action due"), { target: { value: "2026-10-01T10:00" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Make it provisional" }));
    await waitFor(() => { expect(onSaved).toHaveBeenCalledWith("Law Society dinner is provisional, 2nd option."); });
    // Venue wall time (BST) to instants.
    expect(transitionBookingMock).toHaveBeenCalledWith(prospect.id, "hold", undefined, {
      decisionAt: "2026-10-12T11:00:00.000Z", nextAction: "Send the dinner menus.", nextActionDueAt: "2026-10-01T09:00:00.000Z", rank: 2,
    });
  });

  it("steps back with Escape, focus on its button, and the booking stays interest only", async () => {
    renderProspect();
    const button = screen.getByRole("button", { name: "Make it provisional…" });
    fireEvent.click(button);
    const panel = screen.getByRole("group", { name: "Make Law Society dinner provisional?" });
    fireEvent.keyDown(within(panel).getByLabelText("Next action"), { key: "Escape" });
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Make it provisional…" })); });
    expect(screen.queryByRole("group", { name: "Make Law Society dinner provisional?" })).toBeNull();
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });
});

describe("BookingDrawer — the facts first, the next step in one place (roadmap N3)", () => {
  const NOW = Date.parse("2026-09-16T09:00:00.000Z");

  function renderAt(entry: CalendarBookingEntry): void {
    render(
      <BookingDrawer
        mode={{ kind: "edit", booking: entry }}
        rooms={ROOMS}
        venueId={VENUE}
        role="staff"
        nowMs={NOW}
        onClose={vi.fn<() => void>()}
        onSaved={vi.fn<(message: string) => void>()}
      />,
    );
  }

  /** The summary's facts as read: each label with its value. */
  function facts(): string[][] {
    return Array.from(document.querySelectorAll(".diary-booking-facts dt")).map((term) =>
      [term.textContent ?? "", term.nextElementSibling?.textContent ?? ""]);
  }

  it("says what a hold is, when and where it stands and when it was to be decided, before who owns it", () => {
    renderAt(booking({
      kind: "hold", state: "hold", rank: 2, title: "Guild dinner", startsAt: "2026-09-19T13:00:00.000Z",
      endsAt: "2026-09-19T22:30:00.000Z", decisionAt: "2026-09-14T11:00:00.000Z", ownerName: "Elaine Gray",
    }));
    const summary = screen.getByLabelText("Booking summary");
    expect(within(summary).getByText("Provisional · 2nd option")).toBeTruthy();
    expect(facts()).toEqual([
      ["When", "Sat 19 Sept · 14:00–23:30"],
      ["Room", "Grand Hall"],
      ["Decision was due", "Mon 14 Sept"],
      ["Owner", "Elaine Gray"],
      ["Client", "No client linked"],
    ]);
    expect(document.querySelector(".diary-booking-facts dd.is-overdue")?.textContent).toBe("Mon 14 Sept");
  });

  it("says a confirmed booking is confirmed, with no decision date, and names both days of one past midnight", () => {
    renderAt(booking({ startsAt: "2026-09-18T21:00:00.000Z", endsAt: "2026-09-19T01:30:00.000Z" }));
    expect(within(screen.getByLabelText("Booking summary")).getByText("Confirmed")).toBeTruthy();
    const when = facts().find(([label]) => label === "When")?.[1] ?? "";
    expect(when).toMatch(/18 Sept?.*22:00.*19 Sept?.*02:30/u);
    expect(facts().map(([label]) => label)).toEqual(["When", "Room", "Owner", "Client"]);
  });

  it("puts the next step under the facts, before the form's first field", () => {
    renderAt(booking({ kind: "hold", state: "hold", rank: 1, decisionAt: "2026-10-02T11:00:00.000Z" }));
    // Document order, read from the drawer's own elements.
    const order = Array.from(screen.getByRole("dialog").querySelectorAll("*"));
    const at = (element: Element): number => order.indexOf(element);
    const summary = at(screen.getByLabelText("Booking summary"));
    const nextStep = at(screen.getByRole("heading", { name: "Next step" }));
    const confirm = at(screen.getByRole("button", { name: "Confirm it" }));
    const title = at(screen.getByLabelText("Title"));
    expect(summary).toBeGreaterThanOrEqual(0);
    expect([summary < nextStep, nextStep < confirm, confirm < title]).toEqual([true, true, true]);
    expect(facts().find(([label]) => label === "Decide by")?.[1]).toBe("Fri 2 Oct");
  });
});

describe("BookingDrawer — extending a hold's decision (roadmap N3)", () => {
  // Wednesday 16 September 2026, 09:00 BST.
  const NOW = Date.parse("2026-09-16T08:00:00.000Z");
  const GUILD = booking({
    kind: "hold", state: "hold", rank: 1, title: "Guild dinner", decisionAt: "2026-09-21T11:00:00.000Z",
    startsAt: "2026-11-14T18:00:00.000Z", endsAt: "2026-11-14T23:00:00.000Z",
  });

  function renderHold(entry: CalendarBookingEntry, onSaved: SavedSpy = vi.fn<(message: string) => void>(), role = "staff"): void {
    render(
      <BookingDrawer
        mode={{ kind: "edit", booking: entry }}
        rooms={ROOMS}
        venueId={VENUE}
        role={role}
        nowMs={NOW}
        onClose={vi.fn<() => void>()}
        onSaved={onSaved}
      />,
    );
  }

  it("offers a week more beside Confirm it, and saves the decision date alone", async () => {
    updateBookingMock.mockResolvedValue({ ...GUILD, title: "Guild dinner" });
    const onSaved = vi.fn<(message: string) => void>();
    renderHold(GUILD, onSaved);
    const actions = screen.getByRole("heading", { name: "Next step" }).parentElement?.querySelectorAll("button") ?? [];
    expect(Array.from(actions).map((button) => button.textContent).slice(0, 2)).toEqual(["Confirm it", "Extend to Mon 28 Sept"]);
    fireEvent.click(screen.getByRole("button", { name: "Extend to Mon 28 Sept" }));
    await waitFor(() => { expect(onSaved).toHaveBeenCalledWith("Guild dinner now decides by Mon 28 Sept."); });
    expect(updateBookingMock).toHaveBeenCalledWith(BOOKING_ID, { decisionAt: "2026-09-28T11:00:00.000Z" });
  });

  it("says why under the next step when the extension cannot be saved, and keeps the drawer open", async () => {
    updateBookingMock.mockRejectedValue(new ApiError(409, "This booking changed while you were editing it.", "BOOKING_STALE"));
    const onSaved = vi.fn<(message: string) => void>();
    renderHold(GUILD, onSaved);
    fireEvent.click(screen.getByRole("button", { name: "Extend to Mon 28 Sept" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("This booking changed while you were editing it.");
    // Under the next step it came from, not below the form it sits above.
    expect(alert.closest(".diary-drawer-transitions")).not.toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Extend to Mon 28 Sept" })).toBeTruthy();
  });

  it("offers no extension when the event leaves no later day, for a confirmed booking, or to a read-only role", () => {
    renderHold({ ...GUILD, decisionAt: "2026-09-24T11:00:00.000Z", startsAt: "2026-09-25T17:00:00.000Z", endsAt: "2026-09-25T22:00:00.000Z" });
    expect(screen.getByRole("button", { name: "Confirm it" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Extend to/u })).toBeNull();
    cleanup();
    renderHold(booking());
    expect(screen.queryByRole("button", { name: /^Extend to/u })).toBeNull();
    cleanup();
    renderHold(GUILD, vi.fn<(message: string) => void>(), "hallkeeper");
    expect(screen.queryByRole("button", { name: /^Extend to/u })).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { MemoryRouter } from "react-router-dom";
import type { CalendarResponse } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import { WhenRibbon } from "../WhenRibbon.js";
import { useAuthStore } from "../../../../stores/auth-store.js";

// ---------------------------------------------------------------------------
// The When ribbon's render contract (Day Board S2): gating (staff/admin
// write, hallkeeper read-only, customers use their event projection), the honest "not in the Diary" state,
// ghosts + hatched buffers on the strip, and the commit path — keyboard
// driven (the pointer physics live in the pure model's own tests), with
// the ink-resists confirm step and the raced-slot rollback.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const ROOM = "00000000-0000-4000-8000-0000000000a1";
const EVENT = "00000000-0000-4000-8000-0000000000e1";
const SELF = "00000000-0000-4000-8000-0000000000b1";
const GHOST = "00000000-0000-4000-8000-0000000000c1";
const MIN = 60_000;
const NOON = Date.parse("2026-09-16T12:00:00.000Z");

const { getCalendarMock, moveBookingMock, transitionBookingMock, estimatePriceMock } = vi.hoisted(() => ({
  getCalendarMock: vi.fn(),
  moveBookingMock: vi.fn(),
  transitionBookingMock: vi.fn(),
  estimatePriceMock: vi.fn(),
}));

vi.mock("../../../../api/diary.js", () => ({
  getCalendar: getCalendarMock,
  moveBooking: moveBookingMock,
  transitionBooking: transitionBookingMock,
}));
vi.mock("../../../../api/pricing.js", () => ({
  estimatePrice: estimatePriceMock,
}));

vi.mock("../../../../hooks/use-linked-event.js", () => ({
  useLinkedEvent: () => ({
    status: "loaded",
    eventName: "Chamber dinner",
    graph: {
      event: {
        id: EVENT,
        venueId: VENUE,
        name: "Chamber dinner",
        startsAt: new Date(NOON).toISOString(),
        endsAt: new Date(NOON + 120 * MIN).toISOString(),
        guestCount: 80,
      },
      phases: [],
    },
  }),
}));

vi.mock("../../../../pages/diary/hooks/useDiaryLive.js", () => ({
  useDiaryLive: () => ({ connected: true, presence: [] }),
}));

function booking(
  id: string,
  startMs: number,
  endMs: number,
  overrides: Record<string, unknown> = {},
): CalendarResponse["entries"][number] {
  return {
    entryType: "booking",
    id,
    spaceId: ROOM,
    kind: "ink",
    status: "active",
    state: "ink",
    title: `Booking ${id.slice(-2)}`,
    eventType: "dinner",
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    rank: null,
    jointFlag: false,
    decisionAt: null,
    ownerUserId: null,
    nextAction: null,
    nextActionDueAt: null,
    eventId: null,
    seriesId: null,
    ...overrides,
  } as CalendarResponse["entries"][number];
}

function calendarFixture(entries: CalendarResponse["entries"]): CalendarResponse {
  return {
    venueId: VENUE,
    range: {
      from: new Date(NOON - 7 * 24 * 60 * MIN).toISOString(),
      to: new Date(NOON + 7 * 24 * 60 * MIN).toISOString(),
    },
    rooms: [{ id: ROOM, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
    entries,
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      },
    },
    turnaroundRules: [
      { spaceId: null, eventType: null, name: "House default", minutes: 90, isActive: true },
    ],
  };
}

function seedUser(role: string, platformRole: "none" | "admin" = "none"): void {
  useAuthStore.getState().setUser({
    id: "00000000-0000-4000-8000-0000000000ff",
    email: "user@tradeshall.co.uk",
    role,
    platformRole,
    venueId: VENUE,
    name: "Test User",
  });
}

function renderRibbon(): void {
  render(
    <MemoryRouter initialEntries={[`/plan?eventId=${EVENT}`]}>
      <WhenRibbon />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  seedUser("staff");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthStore.getState().logout();
});

describe("WhenRibbon", () => {
  it.each(["checking", "signed out", "unknown role"])("does not mount the venue calendar while %s", (state) => {
    if (state === "checking") useAuthStore.getState().setLoading(true);
    else if (state === "signed out") useAuthStore.getState().logout();
    else seedUser("caterer");
    renderRibbon();
    expect(getCalendarMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("when-ribbon-ingot")).toBeNull();
  });

  it("retains the venue calendar for a platform admin with a customer base role", async () => {
    seedUser("planner", "admin");
    getCalendarMock.mockResolvedValue(calendarFixture([booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT })]));
    renderRibbon();
    expect(await screen.findByTestId("when-ribbon-ingot")).toBeTruthy();
    expect(getCalendarMock).toHaveBeenCalledTimes(1);
  });

  it.each(["client", "planner"] as const)("does not request the venue calendar for a %s", (role) => {
    seedUser(role);
    renderRibbon();
    expect(getCalendarMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("when-ribbon-ingot")).toBeNull();
  });
  it("shows activity during the calendar request", () => {
    getCalendarMock.mockReturnValue(new Promise(() => {}));
    renderRibbon();
    expect(screen.getByRole("status").textContent).toContain("Loading event times");
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
  });

  it.each(["success", "failure"] as const)("keeps refresh activity visible with a loaded day until %s", async (outcome) => {
    const loaded = calendarFixture([
      booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT, kind: "hold", state: "hold" }),
    ]);
    let resolveRefresh: ((value: CalendarResponse) => void) | undefined;
    let rejectRefresh: ((reason: Error) => void) | undefined;
    const refresh = new Promise<CalendarResponse>((resolve, reject) => {
      resolveRefresh = resolve;
      rejectRefresh = reject;
    });
    getCalendarMock.mockResolvedValueOnce(loaded).mockReturnValueOnce(refresh);
    moveBookingMock.mockResolvedValue({});
    renderRibbon();
    const ingot = await screen.findByTestId("when-ribbon-ingot");
    fireEvent.keyDown(ingot, { key: "ArrowRight" });
    fireEvent.keyDown(ingot, { key: "Enter" });

    const activity = await screen.findByText("Refreshing event times…");
    expect(activity.closest('[role="status"]')?.querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(screen.getByTestId("when-ribbon-ingot")).toBe(ingot);

    await act(() => {
      if (outcome === "success") resolveRefresh?.(loaded);
      else rejectRefresh?.(new Error("Calendar unavailable"));
      return Promise.resolve();
    });
    expect(screen.queryByText("Refreshing event times…")).toBeNull();
    expect(screen.getByTestId("when-ribbon-ingot")).toBeTruthy();
  });

  it("ends save activity when a booking update fails", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT, kind: "hold", state: "hold" }),
    ]));
    let rejectMove: ((reason: Error) => void) | undefined;
    moveBookingMock.mockReturnValue(new Promise((_resolve, reject) => { rejectMove = reject; }));
    renderRibbon();
    const ingot = await screen.findByTestId("when-ribbon-ingot");
    fireEvent.keyDown(ingot, { key: "ArrowRight" });
    fireEvent.keyDown(ingot, { key: "Enter" });
    expect(screen.getByText("Saving event times…").closest('[role="status"]')?.querySelector("[data-activity-indicator]")).not.toBeNull();
    rejectMove?.(new Error("Network unavailable"));
    await screen.findByRole("alert");
    expect(screen.queryByText("Saving event times…")).toBeNull();
  });

  it("renders the ingot, ink ghosts and hatched guideline buffers on the day strip", async () => {
    getCalendarMock.mockResolvedValue(
      calendarFixture([
        booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT }),
        booking(GHOST, NOON + 300 * MIN, NOON + 420 * MIN),
      ]),
    );
    renderRibbon();

    const ingot = await screen.findByTestId("when-ribbon-ingot");
    expect(ingot.getAttribute("aria-label")).toContain("Booking b1");
    expect(screen.getAllByTestId("when-ribbon-ghost")).toHaveLength(1);
    // 90m house default: one buffer each side of the single ink ghost.
    expect(screen.getAllByTestId("when-ribbon-buffer")).toHaveLength(2);
  });

  it("says so plainly when the plan has no booking, and links to the Diary", async () => {
    getCalendarMock.mockImplementation((_venueId: string, from: string, to: string) => Promise.resolve({
      ...calendarFixture([booking(GHOST, NOON, NOON + 60 * MIN)]),
      range: { from, to },
    }));
    renderRibbon();

    await waitFor(() => {
      expect(screen.getByText(/isn't in the Diary yet/u)).toBeTruthy();
    });
    const link = screen.getByText("Open the Diary");
    expect(link.getAttribute("href")).toBe("/diary?view=day");
    // The empty conclusion is only reached after the widened 90-day search.
    expect(getCalendarMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it.each(["empty", "found", "error"] as const)("waits for the expanded calendar search before its %s conclusion", async (outcome) => {
    let resolveWide: ((response: CalendarResponse) => void) | undefined;
    let rejectWide: ((error: Error) => void) | undefined;
    const wideResponse = new Promise<CalendarResponse>((resolve, reject) => {
      resolveWide = resolve;
      rejectWide = reject;
    });
    const narrowResponse = calendarFixture([booking(GHOST, NOON, NOON + 60 * MIN)]);
    const from = new Date(NOON - 90 * 24 * 60 * MIN).toISOString();
    const to = new Date(NOON + 90 * 24 * 60 * MIN).toISOString();
    getCalendarMock.mockResolvedValueOnce(narrowResponse).mockReturnValueOnce(wideResponse);
    const committedStates: string[] = [];
    render(
      <Profiler id="when-ribbon" onRender={() => { committedStates.push(document.body.textContent ?? ""); }}>
        <MemoryRouter initialEntries={[`/plan?eventId=${EVENT}`]}>
          <WhenRibbon />
        </MemoryRouter>
      </Profiler>,
    );
    await waitFor(() => {
      expect(getCalendarMock).toHaveBeenCalledWith(VENUE, from, to, expect.anything());
    });
    // Observe committed DOM, including the short transition before the next
    // effect starts. Awaiting only the eventual loading state misses that flash.
    expect(committedStates.some((text) => text.includes("isn't in the Diary yet"))).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("Loading event times");
    expect(screen.queryByRole("link", { name: "Open the Diary" })).toBeNull();
    await act(async () => {
      if (outcome === "error") rejectWide?.(new Error("Wide calendar unavailable"));
      else resolveWide?.({
        ...calendarFixture(outcome === "found"
          ? [booking(SELF, NOON + 30 * 24 * 60 * MIN, NOON + 30 * 24 * 60 * MIN + 120 * MIN, { eventId: EVENT })]
          : []),
        range: { from, to },
      });
      await wideResponse.catch(() => undefined);
    });
    expect(screen.queryByText("Loading event times…")).toBeNull();
    if (outcome === "empty") {
      expect(screen.getByText(/isn't in the Diary yet/u)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open the Diary" }).getAttribute("href")).toBe("/diary?view=day");
    } else {
      expect(screen.queryByText(/isn't in the Diary yet/u)).toBeNull();
      if (outcome === "found") expect(screen.getByTestId("when-ribbon-ingot")).toBeTruthy();
      else expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    }
  });

  it("a non-staff viewer gets a read-only strip: no handles, no drag affordance", async () => {
    useAuthStore.getState().logout();
    seedUser("hallkeeper");
    getCalendarMock.mockResolvedValue(
      calendarFixture([booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT })]),
    );
    renderRibbon();

    const ingot = await screen.findByTestId("when-ribbon-ingot");
    expect(ingot.getAttribute("role")).toBeNull();
    expect(screen.queryByTestId("when-ribbon-handle-end")).toBeNull();
    expect(ingot.getAttribute("aria-label")).toContain("Read-only");
  });

  it("keyboard: a pencil moves without ceremony — arrows, Enter, one PATCH with both instants", async () => {
    getCalendarMock.mockResolvedValue(
      calendarFixture([
        booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT, kind: "hold", state: "hold" }),
      ]),
    );
    moveBookingMock.mockResolvedValue({});
    renderRibbon();

    const ingot = await screen.findByTestId("when-ribbon-ingot");
    fireEvent.keyDown(ingot, { key: "ArrowRight" });
    fireEvent.keyDown(ingot, { key: "ArrowRight" });
    fireEvent.keyDown(ingot, { key: "Enter" });

    await waitFor(() => {
      expect(moveBookingMock).toHaveBeenCalledWith(SELF, {
        startsAt: new Date(NOON + 30 * MIN).toISOString(),
        endsAt: new Date(NOON + 150 * MIN).toISOString(),
      });
    });
    expect(screen.queryByTestId("when-ribbon-confirm")).toBeNull();
  });

  it("keyboard: an ink move demands the confirm step before any PATCH — ink resists", async () => {
    getCalendarMock.mockResolvedValue(
      calendarFixture([booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT })]),
    );
    moveBookingMock.mockResolvedValue({});
    renderRibbon();

    const ingot = await screen.findByTestId("when-ribbon-ingot");
    fireEvent.keyDown(ingot, { key: "ArrowRight" });
    fireEvent.keyDown(ingot, { key: "Enter" });

    const confirm = await screen.findByTestId("when-ribbon-confirm");
    expect(confirm.textContent).toContain("Move the confirmed booking to");
    expect(moveBookingMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Move it"));
    await waitFor(() => {
      expect(moveBookingMock).toHaveBeenCalledWith(SELF, {
        startsAt: new Date(NOON + 15 * MIN).toISOString(),
        endsAt: new Date(NOON + 135 * MIN).toISOString(),
      });
    });
  });

  it("a raced slot rolls the ingot back and says why", async () => {
    getCalendarMock.mockResolvedValue(
      calendarFixture([
        booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT, kind: "hold", state: "hold" }),
      ]),
    );
    moveBookingMock.mockRejectedValue(new ApiError(409, "taken", "INK_SLOT_TAKEN"));
    renderRibbon();

    const ingot = await screen.findByTestId("when-ribbon-ingot");
    fireEvent.keyDown(ingot, { key: "ArrowRight" });
    fireEvent.keyDown(ingot, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("just confirmed by someone else");
    });
    // The optimistic override rolled back: the label shows the original span.
    expect(screen.getByTestId("when-ribbon-ingot").getAttribute("aria-label")).toContain("13:00");
  });
  it("goal 19 S6: a typed time moves a provisional booking without ceremony, and an impossible one is explained", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT, kind: "hold", state: "hold" }),
    ]));
    moveBookingMock.mockResolvedValue({});
    renderRibbon();
    await screen.findByTestId("when-ribbon-ingot");
    const entry = screen.getByTestId("when-ribbon-entry");
    fireEvent.change(entry, { target: { value: "25:00" } });
    fireEvent.submit(entry.closest("form") as HTMLFormElement);
    expect((await screen.findByRole("status")).textContent).toContain("24 hours");
    fireEvent.change(entry, { target: { value: "14:00-16:30" } });
    fireEvent.submit(entry.closest("form") as HTMLFormElement);
    // NOON is 2026-09-16T12:00Z, 13:00 in Glasgow; 14:00 wall time is 13:00Z.
    await waitFor(() => {
      expect(moveBookingMock).toHaveBeenCalledWith(SELF, {
        startsAt: new Date(NOON + 60 * MIN).toISOString(),
        endsAt: new Date(NOON + 210 * MIN).toISOString(),
      });
    });
    expect(screen.queryByTestId("when-ribbon-confirm")).toBeNull();
  });

  it("goal 19 S6: the office confirms a provisional time from the ribbon, after the question", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT, kind: "hold", state: "hold" }),
    ]));
    transitionBookingMock.mockResolvedValue({ booking: {}, promotedToFirst: [] });
    renderRibbon();
    await screen.findByTestId("when-ribbon-ingot");
    fireEvent.click(screen.getByTestId("when-ribbon-confirm-hold"));
    const question = screen.getByTestId("when-ribbon-confirm-time");
    expect(question.textContent).toContain("Confirm 13:00 – 15:00 for Booking b1?");
    expect(transitionBookingMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm it"));
    await waitFor(() => { expect(transitionBookingMock).toHaveBeenCalledWith(SELF, "ink"); });
    // The status line says "Saving event times…" first, then what was done.
    await waitFor(() => { expect(screen.getByRole("status").textContent).toContain("Confirmed 13:00 – 15:00."); });
  });

  it("goal 19 S6: the office sees the phase grips and their legend; a hallkeeper sees neither; a confirmed booking offers no confirm", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT })]));
    renderRibbon();
    await screen.findByTestId("when-ribbon-ingot");
    // A two-hour slot cannot hold the default 60/30/60 phases: setup shrinks first (model doctrine).
    expect(screen.getByTestId("when-ribbon-grip-doors").getAttribute("aria-valuetext")).toBe("Doors 13:15");
    expect(screen.getByTestId("when-ribbon-grip-live").getAttribute("aria-valuetext")).toBe("Live 13:45");
    expect(screen.getByTestId("when-ribbon-grip-clear-down").getAttribute("aria-valuetext")).toBe("Clear-down 14:00");
    expect(screen.getByTestId("when-ribbon-legend").textContent).toBe("Setup 13:00 · Doors 13:15 · Live 13:45 · Clear-down 14:00 · Ends 15:00");
    expect(screen.queryByTestId("when-ribbon-confirm-hold")).toBeNull();
    cleanup();
    useAuthStore.getState().logout();
    seedUser("hallkeeper");
    renderRibbon();
    await screen.findByTestId("when-ribbon-ingot");
    expect(screen.queryByTestId("when-ribbon-grip-doors")).toBeNull();
    expect(screen.queryByTestId("when-ribbon-legend")).toBeNull();
    expect(screen.queryByTestId("when-ribbon-entry")).toBeNull();
  });

  it("goal 19 S6: the snap tick is off until asked for, and the choice is kept on the device", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([booking(SELF, NOON, NOON + 120 * MIN, { eventId: EVENT })]));
    renderRibbon();
    await screen.findByTestId("when-ribbon-ingot");
    const toggle = screen.getByTestId("when-ribbon-tick");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("venviewer.when-ribbon.tick")).toBe("on");
    fireEvent.click(toggle);
    expect(localStorage.getItem("venviewer.when-ribbon.tick")).toBe("off");
  });
  it("goal 19 S6: the price line is the venue's rate for the window: a Grand Hall evening reads £1,500 (Blake, 16 October 2026)", async () => {
    // 2026-09-16 18:00Z–22:00Z is 19:00–23:00 in Glasgow: the evening slot.
    const evening = Date.parse("2026-09-16T18:00:00.000Z");
    getCalendarMock.mockResolvedValue(calendarFixture([booking(SELF, evening, evening + 240 * MIN, { eventId: EVENT })]));
    estimatePriceMock.mockResolvedValue({
      lineItems: [{ ruleName: "Grand Hall — Evening Event (19:00–00:30)", description: "Flat rate", amount: 1500 }],
      subtotal: 1500, modifiers: [], total: 1500, currency: "GBP",
    });
    renderRibbon();
    await screen.findByTestId("when-ribbon-ingot");
    const price = await screen.findByTestId("when-ribbon-price", {}, { timeout: 3000 });
    expect(price.textContent).toBe("£1,500 · the venue's current rate for this window");
    expect(price.textContent).not.toContain("indicative");
    expect(estimatePriceMock).toHaveBeenCalledWith(VENUE, { spaceId: ROOM, eventDate: "2026-09-16", startTime: "19:00", endTime: "23:00", guestCount: 80 });
  });

  it("goal 19 S6: a window no slot holds shows the no-slot note instead of a nought", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([booking(SELF, NOON, NOON + 600 * MIN, { eventId: EVENT })]));
    estimatePriceMock.mockResolvedValue({ lineItems: [], subtotal: 0, modifiers: [], total: 0, currency: "GBP" });
    renderRibbon();
    await screen.findByTestId("when-ribbon-ingot");
    const price = await screen.findByTestId("when-ribbon-price", {}, { timeout: 3000 });
    expect(price.textContent).toContain("no slot for this window");
    expect(price.textContent).not.toContain("£0");
  });
});

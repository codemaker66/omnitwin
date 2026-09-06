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
// write, everyone else read-only), the honest "not in the Diary" state,
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

const { getCalendarMock, moveBookingMock } = vi.hoisted(() => ({
  getCalendarMock: vi.fn(),
  moveBookingMock: vi.fn(),
}));

vi.mock("../../../../api/diary.js", () => ({
  getCalendar: getCalendarMock,
  moveBooking: moveBookingMock,
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

function seedUser(role: "staff" | "planner"): void {
  useAuthStore.getState().setUser({
    id: "00000000-0000-4000-8000-0000000000ff",
    email: "user@tradeshall.co.uk",
    role,
    platformRole: "none",
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
    seedUser("planner");
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
    expect(confirm.textContent).toContain("Move the ink to");
    expect(moveBookingMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Move the ink"));
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
      expect(screen.getByRole("alert").textContent).toContain("just inked by someone else");
    });
    // The optimistic override rolled back: the label shows the original span.
    expect(screen.getByTestId("when-ribbon-ingot").getAttribute("aria-label")).toContain("13:00");
  });
});

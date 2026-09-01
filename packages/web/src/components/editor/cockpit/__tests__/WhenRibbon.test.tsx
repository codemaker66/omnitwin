import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    getCalendarMock.mockResolvedValue(calendarFixture([booking(GHOST, NOON, NOON + 60 * MIN)]));
    renderRibbon();

    await waitFor(() => {
      expect(screen.getByText(/isn't in the Diary yet/u)).toBeTruthy();
    });
    const link = screen.getByText("Open the Diary");
    expect(link.getAttribute("href")).toBe("/diary?view=day");
    // The empty conclusion is only reached after the widened 90-day search.
    expect(getCalendarMock.mock.calls.length).toBeGreaterThanOrEqual(2);
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

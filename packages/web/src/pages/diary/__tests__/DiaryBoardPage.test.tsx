import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CalendarResponse } from "@omnitwin/types";
import { DiaryBoardPage } from "../DiaryBoardPage.js";
import { useAuthStore } from "../../../stores/auth-store.js";

// ---------------------------------------------------------------------------
// Render contract for the Diary Board (T-493): lanes, blocks, conflict rail
// with honest checks, the needs-attention tray, role-gated read-only chip,
// and the error/retry path — against a mocked diary API.
// ---------------------------------------------------------------------------

const { getCalendarMock, moveBookingMock } = vi.hoisted(() => ({
  getCalendarMock: vi.fn(),
  moveBookingMock: vi.fn(),
}));

vi.mock("../../../api/diary.js", () => ({
  getCalendar: getCalendarMock,
  moveBooking: moveBookingMock,
}));

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000b2";
const INK_ID = "00000000-0000-4000-8000-0000000000c1";
const HOLD_ID = "00000000-0000-4000-8000-0000000000c2";

function fixture(): CalendarResponse {
  return {
    venueId: VENUE,
    range: { from: "2026-09-13T23:00:00.000Z", to: "2026-09-20T23:00:00.000Z" },
    rooms: [
      { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
      { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
    ],
    entries: [
      {
        entryType: "booking",
        id: INK_ID,
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
      },
      {
        entryType: "booking",
        id: HOLD_ID,
        spaceId: GRAND_HALL,
        kind: "hold",
        status: "active",
        state: "hold",
        title: "MacLeod wedding",
        eventType: "wedding",
        startsAt: "2026-09-18T18:00:00.000Z",
        endsAt: "2026-09-18T23:00:00.000Z",
        rank: 1,
        jointFlag: false,
        decisionAt: "2026-12-01T12:00:00.000Z",
        ownerUserId: null,
        nextAction: "Call Fiona MacLeod.",
        nextActionDueAt: "2026-07-01T09:00:00.000Z",
        eventId: null,
        seriesId: null,
      },
    ],
    conflicts: {
      conflicts: [
        {
          id: `hold_overlap:${INK_ID}:${HOLD_ID}`,
          type: "hold_overlap",
          severity: "warning",
          spaceId: GRAND_HALL,
          entryIds: [INK_ID, HOLD_ID],
          explanation:
            '"MacLeod wedding" (1st option) pencils a slot already inked by "Chamber dinner" — the pencil cannot convert while the ink stands; release it or offer another date.',
        },
      ],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: {
          status: "not_checked",
          uncoveredPairCount: 1,
          detail:
            "No active turnaround rule covers these spaces yet — 1 occupancy gaps are not checked.",
        },
      },
    },
  };
}

function setUser(role: string): void {
  useAuthStore.setState({
    user: {
      id: "00000000-0000-4000-8000-0000000000ff",
      email: "staff@test.com",
      role,
      platformRole: "none",
      venueId: VENUE,
      name: "Test Staff",
    },
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={["/diary?view=week&date=2026-09-16"]}>
      <DiaryBoardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getCalendarMock.mockResolvedValue(fixture());
  setUser("staff");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null });
});

describe("DiaryBoardPage", () => {
  it("renders lanes, blocks, and the legend from the calendar response", async () => {
    renderPage();
    expect(await screen.findByText("Grand Hall")).toBeDefined();
    expect(screen.getByText("Saloon")).toBeDefined();
    expect(screen.getByText("Chamber dinner")).toBeDefined();
    // The hold appears both as a lane block and as a tray item — by design.
    expect(screen.getAllByText("MacLeod wedding").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Inked — confirmed")).toBeDefined();
    expect(screen.getByText(/Planning support only/)).toBeDefined();
  });

  it("surfaces conflict explanations and the honest turnaround status", async () => {
    renderPage();
    expect(
      await screen.findByText(/pencils a slot already inked by "Chamber dinner"/),
    ).toBeDefined();
    expect(screen.getByText("Turnaround gaps: not checked")).toBeDefined();
  });

  it("lists overdue pencils in the needs-attention tray", async () => {
    renderPage();
    expect(await screen.findByText("Needs attention")).toBeDefined();
    expect(screen.getByText(/Overdue next action: Call Fiona MacLeod\./)).toBeDefined();
  });

  it("shows the read-only chip for hallkeeper", async () => {
    setUser("hallkeeper");
    renderPage();
    expect(await screen.findByText(/Read-only view/)).toBeDefined();
  });

  it("does not show the read-only chip for staff", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByText(/Read-only view/)).toBeNull();
  });

  it("recovers from a load failure via retry", async () => {
    getCalendarMock.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findByText("The diary could not load.")).toBeDefined();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(await screen.findByText("Grand Hall")).toBeDefined();
    expect(getCalendarMock).toHaveBeenCalledTimes(2);
  });

  it("keyboard-moves a pencil and PATCHes the snapped window (review P2 coverage)", async () => {
    moveBookingMock.mockResolvedValue({});
    renderPage();
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Pencil/ });
    fireEvent.keyDown(block, { key: "Enter" }); // lift
    fireEvent.keyDown(block, { key: "ArrowRight" }); // +15 minutes
    fireEvent.keyDown(block, { key: "Enter" }); // drop → commit
    // The page PATCHes the full snapshot (undo symmetry); the API treats an
    // unchanged spaceId as a no-op.
    expect(moveBookingMock).toHaveBeenCalledWith(HOLD_ID, {
      spaceId: GRAND_HALL,
      startsAt: "2026-09-18T18:15:00.000Z",
      endsAt: "2026-09-18T23:15:00.000Z",
    });
    expect(await screen.findByText("Moved MacLeod wedding.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined();
  });

  it("restores the board and says so when a move fails to save", async () => {
    moveBookingMock.mockRejectedValue(new Error("boom"));
    renderPage();
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Pencil/ });
    fireEvent.keyDown(block, { key: "Enter" });
    fireEvent.keyDown(block, { key: "ArrowRight" });
    fireEvent.keyDown(block, { key: "Enter" });
    expect(await screen.findByText(/could not be saved/)).toBeDefined();
  });

  it("tells an unassigned account that it has no venue", () => {
    useAuthStore.setState({
      user: {
        id: "00000000-0000-4000-8000-0000000000fe",
        email: "new@test.com",
        role: "staff",
        platformRole: "none",
        venueId: null,
        name: "New Staff",
      },
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    renderPage();
    expect(screen.getByText(/no venue assigned/)).toBeDefined();
    expect(getCalendarMock).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CalendarResponse } from "@omnitwin/types";
import { DiaryBoardPage } from "../DiaryBoardPage.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { welcomeStorageKey } from "../lib/welcome.js";

// ---------------------------------------------------------------------------
// Render budget of the Diary Board (the overview costs tens of milliseconds a
// render at board size): unrelated page state — palette typing, the refresh
// indicator, enquiry reloads — must not re-render the overview or the grid,
// and the enquiry tray's drag chip must follow the pointer on its own.
// ---------------------------------------------------------------------------

const { getCalendarMock, listEnquiriesMock, renders, countRendersInside } = vi.hoisted(() => {
  const counts = { overview: 0, grid: 0, page: 0 };
  /** Swap a React.memo component's inner render for a counting pass-through,
   *  so only renders the memo lets through are counted. Throws if the
   *  component is not (or is no longer) memoised. */
  function countInside(component: unknown, count: () => void): void {
    if (typeof component !== "object" || component === null || !("type" in component) || typeof component.type !== "function") {
      throw new Error("expected a React.memo component");
    }
    const inner = component.type;
    Object.assign(component, {
      type: (props: object): unknown => {
        count();
        return Reflect.apply(inner, undefined, [props]);
      },
    });
  }
  return { getCalendarMock: vi.fn(), listEnquiriesMock: vi.fn(), renders: counts, countRendersInside: countInside };
});

vi.mock("../../../api/diary.js", () => ({
  getCalendar: getCalendarMock,
  moveBooking: vi.fn(),
  createBooking: vi.fn(),
  updateBooking: vi.fn(),
  transitionBooking: vi.fn(),
  convertEnquiry: vi.fn(),
}));
vi.mock("../../../api/enquiries.js", () => ({ listEnquiries: listEnquiriesMock }));
vi.mock("@clerk/react", () => ({ useClerk: () => ({ signOut: vi.fn() }) }));
vi.mock("../../../api/spaces.js", () => ({
  getVenue: vi.fn().mockResolvedValue({ id: "venue-1", name: "Trades Hall" }),
}));
vi.mock("../../../components/dashboard/NotificationCenter.js", () => ({ NotificationCenter: () => null }));
// The page calls useDiaryLive exactly once per render: a page render counter.
vi.mock("../hooks/useDiaryLive.js", () => ({
  useDiaryLive: () => {
    renders.page += 1;
    return { connected: true, presence: [] };
  },
}));
vi.mock("../components/BoardOverview.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/BoardOverview.js")>();
  countRendersInside(actual.BoardOverview, () => { renders.overview += 1; });
  return actual;
});
vi.mock("../components/BoardGrid.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/BoardGrid.js")>();
  countRendersInside(actual.BoardGrid, () => { renders.grid += 1; });
  return actual;
});

const VENUE = "00000000-0000-4000-8000-000000000001";
const STAFF_USER_ID = "00000000-0000-4000-8000-0000000000ff";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000b2";
const DATED_URL = "/diary?view=week&date=2026-09-16";

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
        entryType: "booking", id: "00000000-0000-4000-8000-0000000000c1", spaceId: GRAND_HALL, kind: "ink",
        status: "active", state: "ink", title: "Chamber dinner", eventType: "dinner",
        startsAt: "2026-09-18T17:00:00.000Z", endsAt: "2026-09-18T22:00:00.000Z", rank: null, jointFlag: false,
        decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
      },
      {
        entryType: "booking", id: "00000000-0000-4000-8000-0000000000c2", spaceId: SALOON, kind: "hold",
        status: "active", state: "hold", title: "MacLeod wedding", eventType: "wedding",
        startsAt: "2026-09-19T12:00:00.000Z", endsAt: "2026-09-19T20:00:00.000Z", rank: 1, jointFlag: false,
        decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
      },
    ],
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps checked." },
      },
    },
  };
}

function renderPage(url: string): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <DiaryBoardPage />
    </MemoryRouter>,
  );
}

async function settled(): Promise<void> {
  await screen.findByText("Fiona MacLeod");
  await waitFor(() => {
    expect(screen.queryByText("Loading open enquiries…")).toBeNull();
    expect(screen.queryByText("Refreshing the Diary…")).toBeNull();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-16T10:00:00.000Z"));
  renders.overview = 0;
  renders.grid = 0;
  renders.page = 0;
  getCalendarMock.mockImplementation(() => Promise.resolve(fixture()));
  listEnquiriesMock.mockResolvedValue([{
    id: "00000000-0000-4000-8000-0000000000e1", venueId: VENUE, spaceId: GRAND_HALL, configurationId: null,
    userId: null, guestEmail: null, guestPhone: null, guestName: "Fiona MacLeod", state: "submitted",
    name: "Fiona MacLeod", email: "fiona@example.com", preferredDate: "2026-09-19", eventType: "wedding",
    estimatedGuests: 120, message: null, createdAt: "2026-07-01T09:00:00.000Z", updatedAt: "2026-07-01T09:00:00.000Z",
  }]);
  useAuthStore.setState({
    user: { id: STAFF_USER_ID, email: "staff@test.com", role: "staff", platformRole: "none", venueId: VENUE, name: "Test Staff" },
    isAuthenticated: true, isLoading: false, error: null,
  });
  window.localStorage.setItem(welcomeStorageKey(STAFF_USER_ID), "1");
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "elementsFromPoint");
  vi.useRealTimers();
  vi.clearAllMocks();
  window.localStorage.clear();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null });
});

describe("Diary Board render budget", () => {
  it.each([
    { link: "a dated link", url: DATED_URL },
    { link: "the nav's plain /diary link", url: "/diary" },
  ])("opening, typing in and closing the palette never re-renders the overview ($link)", async ({ url }) => {
    renderPage(url);
    await screen.findByRole("region", { name: "Room and day booking summaries" });
    await settled();
    const before = renders.overview;
    expect(before).toBeGreaterThan(0);
    // Without ?date= the anchor is the clock itself; let it move on.
    vi.setSystemTime(new Date("2026-09-16T10:00:05.000Z"));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const palette = screen.getByRole("dialog", { name: "Find on the board" });
    const input = within(palette).getByPlaceholderText("Rooms, events, clients…");
    const pageBefore = renders.page;
    for (const value of ["M", "Ma", "Mac", "MacL", "MacLe"]) fireEvent.change(input, { target: { value } });
    // The query lives in the palette: keystrokes do not render the page at all.
    expect(renders.page).toBe(pageBefore);
    expect(within(palette).getByRole("button", { name: /MacLeod wedding/ })).toBeDefined();
    expect(within(palette).getByRole("button", { name: /Fiona MacLeod/ })).toBeDefined();
    expect(renders.overview).toBe(before);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Find on the board" })).toBeNull();
    // Reopening starts from an empty query, as before.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText("Rooms, events, clients…")).toHaveProperty("value", "");
    expect(renders.overview).toBe(before);
  });

  it("a palette pick still closes the palette and focuses the booking", async () => {
    renderPage(DATED_URL);
    await settled();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByPlaceholderText("Rooms, events, clients…"), { target: { value: "chamber" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Rooms, events, clients…"), { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: "Find on the board" })).toBeNull();
    expect(document.activeElement?.id).toBe("diary-block-00000000-0000-4000-8000-0000000000c1");
  });

  it("a remote change renders the overview once, not once per follow-up state (refresh, overrides, enquiries)", async () => {
    renderPage(DATED_URL);
    await settled();
    const before = renders.overview;
    const calendarCalls = getCalendarMock.mock.calls.length;
    const enquiryCalls = listEnquiriesMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => { expect(getCalendarMock).toHaveBeenCalledTimes(calendarCalls + 1); });
    // The enquiry tray still reloads whenever the calendar data changes.
    await waitFor(() => { expect(listEnquiriesMock).toHaveBeenCalledTimes(enquiryCalls + 1); });
    await settled();
    expect(renders.overview).toBe(before + 1);
  });

  it("the enquiry chip follows the pointer without re-rendering the board, and the drop opens the pencil-in form at the snapped slot", async () => {
    renderPage(DATED_URL);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    const lane = document.querySelector<HTMLElement>(`[data-diary-lane="${GRAND_HALL}"]`);
    if (lane === null) throw new Error("expected the Grand Hall lane");
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [lane] });
    const slip = screen.getByText("Fiona MacLeod").closest("li");
    if (slip === null) throw new Error("expected the enquiry slip");
    const gridBefore = renders.grid;

    fireEvent.pointerDown(slip, { clientX: 300, clientY: 200 });
    const chip = document.querySelector<HTMLElement>(".diary-enquiry-ghost");
    if (chip === null) throw new Error("expected the drag chip");
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect([chip.style.left, chip.style.top]).toEqual(["312px", "210px"]);
    expect(chip.textContent).toContain("Drop on a room lane");

    // Week zoom is 18 px an hour and the lane starts at x = 0: x = 99 is 05:30.
    fireEvent.pointerMove(window, { clientX: 99, clientY: 220 });
    expect(chip.textContent).toContain("Pencil at 05:30");
    expect([chip.style.left, chip.style.top]).toEqual(["111px", "230px"]);
    const pageBefore = renders.page;
    for (const [clientX, clientY] of [[98, 240], [101, 250], [97, 255], [100, 260]] as const) {
      fireEvent.pointerMove(window, { clientX, clientY });
    }
    expect(chip.textContent).toContain("Pencil at 05:30");
    expect([chip.style.left, chip.style.top]).toEqual(["112px", "270px"]);
    // Inside one slot the page settles without rendering (React may probe the
    // owner once before bailing out).
    expect(renders.page - pageBefore).toBeLessThanOrEqual(1);
    fireEvent.pointerMove(window, { clientX: 108, clientY: 260 });
    expect(chip.textContent).toContain("Pencil at 06:00");
    // Re-rendering for the new time leaves the pointer-owned position alone.
    expect([chip.style.left, chip.style.top]).toEqual(["120px", "270px"]);
    expect(renders.grid).toBe(gridBefore);

    fireEvent.pointerUp(window, { clientX: 108, clientY: 260 });
    expect(await screen.findByRole("dialog", { name: "Pencil in this enquiry" })).toBeDefined();
    expect(screen.getByDisplayValue("2026-09-14T06:00")).toBeDefined();
    expect(document.querySelector(".diary-enquiry-ghost")).toBeNull();
  });

  it("Escape cancels an enquiry drag without opening the form", async () => {
    renderPage(DATED_URL);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    const slip = screen.getByText("Fiona MacLeod").closest("li");
    if (slip === null) throw new Error("expected the enquiry slip");
    fireEvent.pointerDown(slip, { clientX: 300, clientY: 200 });
    expect(document.querySelector(".diary-enquiry-ghost")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".diary-enquiry-ghost")).toBeNull();
    fireEvent.pointerUp(window, { clientX: 300, clientY: 200 });
    expect(screen.queryByRole("dialog", { name: "Pencil in this enquiry" })).toBeNull();
  });
});

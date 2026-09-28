import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type { ChangeFeedItem, EventDayIssue, EventDayOpsBoard, OpsTask } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { EventDayOpsPage } from "../pages/EventDayOpsPage.js";
import { getVenue } from "../api/spaces.js";

// These pages now wear the app shell (DashboardLayout), which renders a Clerk
// sign-out and fetches the venue name for its topbar. In production every one
// of these routes is withClerk()-wrapped so both are real; here they are
// stubbed so each spec keeps testing its PAGE, not the chrome around it.
vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("../api/spaces.js", () => ({
  getVenue: vi.fn().mockResolvedValue({ id: "venue-1", name: "Trades Hall" }),
}));

vi.mock("../components/dashboard/NotificationCenter.js", () => ({
  NotificationCenter: () => null,
}));


const {
  mockGetEventDayOpsBoard,
  mockUpdateOpsTaskStatus,
  mockCreateEventDayIssue,
  mockUpdateEventDayIssue,
  mockGetEventChangeFeed,
  mockGetCalendar,
  mockAcknowledgeEventPlanChange,
  mockListEventChangeAcknowledgements,
  mockAckEventDayOp,
  mockEnqueueEventDayIssueCreate,
  mockEnqueueEventDayTaskStatus,
  mockListPendingEventDayOps,
} = vi.hoisted(() => ({
  mockGetEventDayOpsBoard: vi.fn(),
  mockUpdateOpsTaskStatus: vi.fn(),
  mockCreateEventDayIssue: vi.fn(),
  mockUpdateEventDayIssue: vi.fn(),
  mockGetEventChangeFeed: vi.fn(),
  mockGetCalendar: vi.fn(),
  mockAcknowledgeEventPlanChange: vi.fn(),
  mockListEventChangeAcknowledgements: vi.fn(),
  mockAckEventDayOp: vi.fn(),
  mockEnqueueEventDayIssueCreate: vi.fn(),
  mockEnqueueEventDayTaskStatus: vi.fn(),
  mockListPendingEventDayOps: vi.fn(),
}));

vi.mock("../api/event-day-ops.js", () => ({
  getEventDayOpsBoard: mockGetEventDayOpsBoard,
  updateOpsTaskStatus: mockUpdateOpsTaskStatus,
  createEventDayIssue: mockCreateEventDayIssue,
  updateEventDayIssue: mockUpdateEventDayIssue,
}));

// The hero reads the Diary for the booked hour; the spec supplies it.
vi.mock("../api/diary.js", () => ({
  getCalendar: mockGetCalendar,
}));

vi.mock("../api/notifications.js", () => ({
  getEventChangeFeed: mockGetEventChangeFeed,
  acknowledgeEventPlanChange: mockAcknowledgeEventPlanChange,
  listEventChangeAcknowledgements: mockListEventChangeAcknowledgements,
  // The dashboard shell reads the unread count for its nav chip.
  listNotifications: () => Promise.resolve([]),
  getUnreadNotificationCount: () => Promise.resolve(0),
}));

vi.mock("../lib/event-day-offline-queue.js", () => ({
  ackEventDayOp: mockAckEventDayOp,
  enqueueEventDayIssueCreate: mockEnqueueEventDayIssueCreate,
  enqueueEventDayTaskStatus: mockEnqueueEventDayTaskStatus,
  listPendingEventDayOps: mockListPendingEventDayOps,
}));

// Decision 7: the board is the hallkeeper's surface. The stub records the
// authority prop so the spec can prove the board claims it.
const missionProps: { current: Record<string, unknown> | null } = { current: null };
vi.mock("../components/mission-control/EventMissionControl.js", () => ({
  EventMissionControl: (props: Record<string, unknown>) => {
    missionProps.current = props;
    return <section data-testid="mission-control">Mission Control</section>;
  },
}));

const NOW = "2026-06-12T09:00:00.000Z";
const HASH = "b".repeat(64);
const EVENT_ID = "00000000-0000-4000-8000-000000003001";
const TASK_ID = "00000000-0000-4000-8000-000000003002";
const PACK_ID = "00000000-0000-4000-8000-000000003003";

function task(status: OpsTask["status"] = "todo"): OpsTask {
  return {
    id: TASK_ID,
    handoffPackId: PACK_ID,
    taskGroupId: null,
    phaseId: null,
    kind: "setup",
    title: "Set 12 x Round Table",
    detail: "Place in Centre during Furniture.",
    status,
    sortOrder: 0,
    dueLabel: null,
    sourceRef: "furniture|Centre|Round Table|0",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function boardFixture(): EventDayOpsBoard {
  return {
    event: {
      id: EVENT_ID,
      venueId: "00000000-0000-4000-8000-000000003004",
      createdBy: "00000000-0000-4000-8000-000000003005",
      name: "Blake event day",
      eventType: "wedding",
      status: "ready_for_ops",
      startsAt: NOW,
      endsAt: null,
      guestCount: 120,
      clientName: "Blake",
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    phases: [{
      id: "00000000-0000-4000-8000-000000003006",
      eventId: EVENT_ID,
      spaceId: null,
      templateKey: "arrival",
      name: "Arrival",
      sortOrder: 0,
      startsAt: NOW,
      durationMinutes: 30,
      guestCount: 120,
      opsTasksCount: 1,
      reviewGatesCount: 0,
      densityStatus: "not_checked",
      densityLabel: "Density not checked",
      staffConflictsStatus: "not_checked",
      staffConflictsLabel: "Staff conflicts not checked",
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
    }],
    handoffPack: {
      pack: {
        id: PACK_ID,
        eventId: EVENT_ID,
        configId: "00000000-0000-4000-8000-000000003007",
        snapshotId: "00000000-0000-4000-8000-000000003008",
        snapshotHash: HASH,
        version: 1,
        status: "compiled",
        sourceLabel: "Approved configuration snapshot v1",
        summary: "Internal handoff compiled from approved planning data.",
        createdBy: null,
        compiledAt: NOW,
        updatedAt: NOW,
      },
      taskGroups: [],
      opsTasks: [task()],
      furniturePickList: {
        id: "00000000-0000-4000-8000-000000003009",
        handoffPackId: PACK_ID,
        title: "Pick list",
        totalItems: 12,
        createdAt: NOW,
      },
      pickListItems: [],
      supplierInstructions: [{
        id: "00000000-0000-4000-8000-000000003010",
        handoffPackId: PACK_ID,
        supplierId: null,
        category: "catering",
        title: "Catering arrival",
        detail: "Confirm arrival at staff entrance.",
        arrivalWindow: "16:00-16:30",
        sourceRef: "event-notes",
        sortOrder: 0,
        createdAt: NOW,
      }],
      loadInSequence: [],
      breakdownSequence: [],
      roomFlipPlans: [],
      beoDocument: {
        id: "00000000-0000-4000-8000-000000003011",
        handoffPackId: PACK_ID,
        title: "Internal BEO",
        body: "Internal operations handoff.",
        sourceSnapshotHash: HASH,
        safeStatus: "internal_operations_handoff",
        createdAt: NOW,
      },
      snapshotDiff: {
        id: "00000000-0000-4000-8000-000000003012",
        handoffPackId: PACK_ID,
        previousSnapshotHash: null,
        currentSnapshotHash: HASH,
        addedCount: 0,
        removedCount: 0,
        changedCount: 0,
        summary: "No previous approved snapshot is available for comparison.",
        payload: { added: [], removed: [], changed: [] },
        createdAt: NOW,
      },
    },
    assignments: [],
    issues: [],
    statusUpdates: [],
    setupProgress: {
      totalTasks: 1,
      doneTasks: 0,
      blockedTasks: 0,
      activeTasks: 1,
      percent: 0,
    },
    supplierArrivals: [{
      instructionId: "00000000-0000-4000-8000-000000003010",
      title: "Catering arrival",
      category: "catering",
      arrivalWindow: "16:00-16:30",
      detail: "Confirm arrival at staff entrance.",
      statusLabel: "Expected 16:00-16:30",
    }],
    escalationNotes: [],
    changesSinceLastHandoff: {
      handoffPackId: PACK_ID,
      summary: "No previous approved snapshot is available for comparison.",
      added: [],
      removed: [],
      changed: [],
      currentSnapshotHash: HASH,
      previousSnapshotHash: null,
    },
    sourceStatus: "ready",
  };
}

function calendarBooking(id: string, startsAt: string): Record<string, unknown> {
  return {
    entryType: "booking", id, spaceId: "00000000-0000-4000-8000-000000003061",
    kind: "ink", status: "active", state: "ink", title: "Blake event day", eventType: "wedding",
    startsAt, endsAt: "2026-06-12T20:00:00.000Z",
    rank: null, jointFlag: false, decisionAt: null, ownerUserId: null,
    nextAction: null, nextActionDueAt: null, eventId: EVENT_ID, seriesId: null,
  };
}

function openIssueFixture(): EventDayIssue {
  return {
    id: "00000000-0000-4000-8000-000000003050",
    eventId: EVENT_ID,
    phaseId: null,
    opsTaskId: null,
    title: "Chair delivery short",
    detail: "Eight chairs missing from the delivery.",
    status: "open",
    severity: "attention",
    source: "hallkeeper",
    reportedBy: null,
    assignedTo: null,
    escalationNote: null,
    createdAt: NOW,
    updatedAt: NOW,
    resolvedAt: null,
  };
}

function requiredChangeFixture(): ChangeFeedItem {
  return {
    id: "00000000-0000-4000-8000-000000003030",
    eventId: EVENT_ID,
    venueId: "00000000-0000-4000-8000-000000003004",
    configurationId: null,
    proposalId: null,
    handoffPackId: PACK_ID,
    actorUserId: "00000000-0000-4000-8000-000000003031",
    actorRole: "staff",
    actorLabel: "planner@e2e.test",
    sourceKind: "proposal",
    sourceId: "00000000-0000-4000-8000-000000003032",
    title: "Guest count changed",
    summary: "Guest count moved from 120 to 132 after handoff.",
    beforeSummary: "120 guests",
    afterSummary: "132 guests",
    affectedSurfaces: ["guest_count", "ops_tasks"],
    audienceRoles: ["hallkeeper"],
    riskLevel: "attention",
    requiresHallkeeperAcknowledgement: true,
    createdAt: NOW,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={[`/ops/events/${EVENT_ID}`]}>
      <Routes>
        <Route path="/ops/events/:eventId" element={<EventDayOpsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The line under the event's name: date, start hour, time zone, guests.
 *  Hours are read here and nowhere else, because the sync label beside it
 *  ("Updated 08:00") shows the real clock: a bare /08:00/ matched it too
 *  when CI ran at 08:00 in London. */
function heroLine(): string {
  return screen.getByText(/ guests$/u).textContent ?? "";
}

beforeEach(() => {
  mockGetEventDayOpsBoard.mockReset();
  mockUpdateOpsTaskStatus.mockReset();
  mockCreateEventDayIssue.mockReset();
  mockUpdateEventDayIssue.mockReset();
  mockGetEventChangeFeed.mockReset();
  mockGetCalendar.mockReset();
  mockGetCalendar.mockResolvedValue({
    venueId: "00000000-0000-4000-8000-000000003004",
    range: { from: NOW, to: NOW },
    rooms: [], entries: [],
    conflicts: { conflicts: [], checks: {
      inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" },
      turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
    } },
  });
  mockAcknowledgeEventPlanChange.mockReset();
  mockListEventChangeAcknowledgements.mockReset();
  mockListEventChangeAcknowledgements.mockResolvedValue([]);
  mockAckEventDayOp.mockReset();
  mockEnqueueEventDayIssueCreate.mockReset();
  mockEnqueueEventDayTaskStatus.mockReset();
  mockListPendingEventDayOps.mockReset();
  mockListPendingEventDayOps.mockResolvedValue([]);
  mockGetEventChangeFeed.mockResolvedValue([]);
  mockAcknowledgeEventPlanChange.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000003020",
    changeId: "00000000-0000-4000-8000-000000003021",
    eventId: EVENT_ID,
    acknowledgedBy: "00000000-0000-4000-8000-000000003022",
    acknowledgedByRole: "hallkeeper",
    note: null,
    createdAt: NOW,
  });
  mockEnqueueEventDayIssueCreate.mockResolvedValue(undefined);
  mockEnqueueEventDayTaskStatus.mockResolvedValue(undefined);
  mockAckEventDayOp.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EventDayOpsPage", () => {
  it("keeps task activity visible until an offline write is persisted, then settles", async () => {
    let resolveQueue: (() => void) | undefined;
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockUpdateOpsTaskStatus.mockRejectedValue(new ApiError(0, "Network error", "NETWORK_ERROR"));
    mockEnqueueEventDayTaskStatus.mockReturnValue(new Promise<void>((resolve) => { resolveQueue = resolve; }));
    renderPage();
    await screen.findByText("Set 12 x Round Table");
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => { expect(mockEnqueueEventDayTaskStatus).toHaveBeenCalled(); });
    expect(screen.getByText("Saving event-day changes…").closest('[role="status"]')?.querySelector("[data-activity-indicator]")).not.toBeNull();
    await act(() => { resolveQueue?.(); return Promise.resolve(); });
    expect(screen.queryByText("Saving event-day changes…")).toBeNull();
    expect(screen.getByText("Task saved on this device and will sync when the connection returns.")).toBeTruthy();
  });

  it("settles task activity and exposes a failed offline persistence attempt", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockUpdateOpsTaskStatus.mockRejectedValue(new ApiError(0, "Network error", "NETWORK_ERROR"));
    mockEnqueueEventDayTaskStatus.mockRejectedValue(new Error("storage unavailable"));
    renderPage();
    await screen.findByText("Set 12 x Round Table");
    fireEvent.click(screen.getByText("Done"));
    expect(await screen.findByText("Task could not be saved on this device. Please try again.")).toBeTruthy();
    expect(screen.queryByText("Saving event-day changes…")).toBeNull();
    expect(screen.getByText("To do")).toBeTruthy();
  });

  it("shows issue activity only during a real request and clears it after rejection", async () => {
    let rejectIssue: ((reason: ApiError) => void) | undefined;
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockCreateEventDayIssue.mockReturnValue(new Promise<never>((_resolve, reject) => { rejectIssue = reject; }));
    renderPage();
    await screen.findByText("Issue report");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Supplier late" } });
    fireEvent.change(screen.getByLabelText("Detail"), { target: { value: "Ten minutes behind the planning window." } });
    const submit = screen.getByRole("button", { name: "Log issue" });
    expect(submit.querySelector("[data-activity-indicator]")).toBeNull();
    fireEvent.click(submit);
    expect(submit.querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(submit.getAttribute("aria-busy")).toBe("true");
    await act(() => { rejectIssue?.(new ApiError(400, "Invalid issue", "VALIDATION_ERROR")); return Promise.resolve(); });
    expect(submit.querySelector("[data-activity-indicator]")).toBeNull();
    expect(submit.getAttribute("aria-busy")).toBe("false");
    expect(screen.getByText("Issue could not be logged. Check the wording and try again.")).toBeTruthy();
  });

  it("renders the mobile event-day board sections", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    renderPage();

    expect(await screen.findByText("Blake event day")).toBeTruthy();
    expect(screen.getByText("Phase timeline")).toBeTruthy();
    expect(screen.getByText("Setup progress")).toBeTruthy();
    expect(screen.getByText("Task checklist")).toBeTruthy();
    expect(screen.getByText("Issue report")).toBeTruthy();
    expect(screen.getByText("Supplier arrivals")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open current setup sheet" }).getAttribute("href"))
      .toBe("/hallkeeper/00000000-0000-4000-8000-000000003007?eventId=00000000-0000-4000-8000-000000003001");
    expect(screen.getByRole("link", { name: "Open version 1 handoff" }).getAttribute("href"))
      .toBe(`/ops/handoff/${PACK_ID}`);
  });

  it("reads the board and its change feed together, and draws the board once both have answered", async () => {
    let resolveBoard: (board: EventDayOpsBoard) => void = () => undefined;
    let resolveFeed: (items: ChangeFeedItem[]) => void = () => undefined;
    const boardRead = new Promise<EventDayOpsBoard>((resolve) => { resolveBoard = resolve; });
    const feedRead = new Promise<ChangeFeedItem[]>((resolve) => { resolveFeed = resolve; });
    mockGetEventDayOpsBoard.mockReturnValue(boardRead);
    mockGetEventChangeFeed.mockReturnValue(feedRead);
    renderPage();

    // Both reads are out before either answers.
    await waitFor(() => { expect(mockGetEventChangeFeed).toHaveBeenCalledWith(EVENT_ID, 25); });
    expect(mockGetEventDayOpsBoard).toHaveBeenCalledWith(EVENT_ID);
    expect(screen.getByRole("heading", { level: 1, name: "Loading event-day board" })).toBeTruthy();

    // The board alone does not draw the page: its changes are not known yet,
    // and "No changes awaiting acknowledgement" would be a guess.
    await act(async () => { resolveBoard(boardFixture()); await boardRead; });
    expect(screen.getByRole("heading", { level: 1, name: "Loading event-day board" })).toBeTruthy();
    expect(screen.queryByText("No changes awaiting acknowledgement.")).toBeNull();

    await act(async () => { resolveFeed([requiredChangeFixture()]); await feedRead; });
    expect(screen.getByRole("heading", { level: 1, name: "Blake event day" })).toBeTruthy();
    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    expect(screen.queryByText("Loading event-day board")).toBeNull();
  });

  it("says the board is unavailable when the board cannot be read, without waiting for the feed, and Retry reads both again", async () => {
    mockGetEventDayOpsBoard.mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockReturnValueOnce(new Promise<ChangeFeedItem[]>(() => undefined));
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Event-day board unavailable" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Blake event day" })).toBeTruthy();
    expect(mockGetEventDayOpsBoard).toHaveBeenCalledTimes(2);
    expect(mockGetEventChangeFeed).toHaveBeenCalledTimes(2);
  });

  it("keeps the board when only its change feed cannot be read, and never takes the failure for no changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 14:05 in Glasgow.
      vi.setSystemTime(new Date("2026-06-11T13:05:00.000Z"));
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
      renderPage();

      expect(await screen.findByRole("heading", { level: 1, name: "Blake event day" })).toBeTruthy();
      expect(screen.queryByText("Event-day board unavailable")).toBeNull();
      expect(await screen.findByText("Couldn't read the changes, so what waits for acknowledgement is not known yet. Trying every 10 seconds since 14:05.")).toBeTruthy();
      expect(screen.queryByText("No changes awaiting acknowledgement.")).toBeNull();

      // Tried again and read: the notice goes, and the changes are listed.
      mockGetEventChangeFeed.mockResolvedValue([requiredChangeFixture()]);
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByText("Guest count changed")).toBeTruthy();
      expect(screen.queryByTestId("change-feed-notice")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says it is trying again, joins a read already out, and says what the retry found", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-06-11T13:05:00.000Z"));
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
      renderPage();
      await screen.findByTestId("change-feed-notice");
      await waitFor(() => { expect(screen.getByTestId("change-feed-heard").textContent).toBe("Couldn't read the changes at 14:05."); });

      // Two minutes on, a retry that also fails: it works, then says so.
      vi.setSystemTime(new Date("2026-06-11T13:07:00.000Z"));
      let fail: ((reason: Error) => void) | undefined;
      mockGetEventChangeFeed.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((_resolve, reject) => { fail = reject; }));
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      const trying = screen.getByRole("button", { name: "Trying again…" });
      expect(trying.getAttribute("aria-busy")).toBe("true");
      expect((trying as HTMLButtonElement).disabled).toBe(true);
      expect(trying.querySelector("[data-activity-indicator]")).not.toBeNull();
      await act(async () => { fail?.(new ApiError(0, "Network error", "NETWORK_ERROR")); await Promise.resolve(); });
      expect(await screen.findByText("Couldn't read the changes, so what waits for acknowledgement is not known yet. Trying every 10 seconds since 14:05. Tried again at 14:07.")).toBeTruthy();
      await waitFor(() => { expect(screen.getByTestId("change-feed-heard").textContent).toBe("Tried again at 14:07. The changes still could not be read."); });
      // The focus had fallen to the page while it worked; it is handed back.
      await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Try again" })); });

      // A retry that reads: the notice goes, the focus moves to the section's
      // heading, and it is said that the changes were read.
      vi.setSystemTime(new Date("2026-06-11T13:08:00.000Z"));
      mockGetEventChangeFeed.mockResolvedValue([requiredChangeFixture()]);
      const again = screen.getByRole("button", { name: "Try again" });
      again.focus();
      fireEvent.click(again);
      expect(await screen.findByText("Guest count changed")).toBeTruthy();
      expect(screen.queryByTestId("change-feed-notice")).toBeNull();
      await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "Required acknowledgements" })); });
      await waitFor(() => { expect(screen.getByTestId("change-feed-heard").textContent).toBe("The changes were read again at 14:08."); });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps saying since when the reads have failed, rather than a new time at every poll", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-06-11T13:05:00.000Z"));
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
      renderPage();
      await screen.findByTestId("change-feed-notice");
      await waitFor(() => { expect(screen.getByTestId("change-feed-heard").textContent).toBe("Couldn't read the changes at 14:05."); });
      const said = screen.getByTestId("change-feed-heard").firstElementChild;
      expect(said).not.toBeNull();
      for (const minute of ["13:06", "13:07", "13:08"]) {
        vi.setSystemTime(new Date(`2026-06-11T${minute}:00.000Z`));
        fireEvent.click(screen.getByRole("button", { name: "Sync pending event-day changes" }));
        await waitFor(() => { expect(screen.getByRole("button", { name: "Sync pending event-day changes" }).getAttribute("aria-busy")).toBe("false"); });
      }
      expect(mockGetEventChangeFeed.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(screen.getByTestId("change-feed-notice").textContent).toContain("since 14:05.");
      // Nothing new was said: the same saying stands.
      expect(screen.getByTestId("change-feed-heard").firstElementChild).toBe(said);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never shows one event's changes on another's board, whatever answers late", async () => {
    const OTHER_EVENT = "00000000-0000-4000-8000-000000003099";
    const otherBoard: EventDayOpsBoard = { ...boardFixture(), event: { ...boardFixture().event, id: OTHER_EVENT, name: "Other event day" } };
    const navigateTo: { current: ((path: string) => void) | null } = { current: null };
    function Navigator(): null {
      const navigate = useNavigate();
      navigateTo.current = (path) => { void navigate(path); };
      return null;
    }
    mockGetEventDayOpsBoard.mockImplementation((id: string) => Promise.resolve(id === OTHER_EVENT ? otherBoard : boardFixture()));
    mockGetEventChangeFeed.mockResolvedValueOnce([requiredChangeFixture()]);
    render(
      <MemoryRouter initialEntries={[`/ops/events/${EVENT_ID}`]}>
        <Navigator />
        <Routes>
          <Route path="/ops/events/:eventId" element={<EventDayOpsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Guest count changed")).toBeTruthy();

    // A sync for this event sets out; its read is still out when the other
    // event is opened, whose own changes cannot be read.
    let late: ((items: ChangeFeedItem[]) => void) | undefined;
    mockGetEventChangeFeed.mockImplementation((id: string) => (id === EVENT_ID
      ? new Promise<ChangeFeedItem[]>((resolve) => { late = resolve; })
      : Promise.reject(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))));
    fireEvent.click(screen.getByRole("button", { name: "Sync pending event-day changes" }));
    await waitFor(() => { expect(late).toBeDefined(); });
    act(() => { navigateTo.current?.(`/ops/events/${OTHER_EVENT}`); });
    expect(await screen.findByRole("heading", { level: 1, name: "Other event day" })).toBeTruthy();
    await act(async () => { late?.([requiredChangeFixture()]); await Promise.resolve(); });

    expect(await screen.findByTestId("change-feed-notice")).toBeTruthy();
    expect(screen.queryByText("Guest count changed")).toBeNull();
    expect(screen.getByTestId("change-feed-notice").textContent).toMatch(/^Couldn't read the changes, so what waits/u);

    // This event's Try again reads this event, whatever was out for the last.
    const reads = mockGetEventChangeFeed.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(mockGetEventChangeFeed.mock.calls.length).toBe(reads + 1); });
    expect(mockGetEventChangeFeed).toHaveBeenLastCalledWith(OTHER_EVENT, 25);
  });

  it("lets a retry on the event now open read it, even while the last event's retry is still out", async () => {
    const OTHER_EVENT = "00000000-0000-4000-8000-000000003098";
    const otherBoard: EventDayOpsBoard = { ...boardFixture(), event: { ...boardFixture().event, id: OTHER_EVENT, name: "Other event day" } };
    const navigateTo: { current: ((path: string) => void) | null } = { current: null };
    function Navigator(): null {
      const navigate = useNavigate();
      navigateTo.current = (path) => { void navigate(path); };
      return null;
    }
    mockGetEventDayOpsBoard.mockImplementation((id: string) => Promise.resolve(id === OTHER_EVENT ? otherBoard : boardFixture()));
    mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    render(
      <MemoryRouter initialEntries={[`/ops/events/${EVENT_ID}`]}>
        <Navigator />
        <Routes>
          <Route path="/ops/events/:eventId" element={<EventDayOpsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByTestId("change-feed-notice");
    // This event's retry is still out when the other event is opened.
    mockGetEventChangeFeed.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    act(() => { navigateTo.current?.(`/ops/events/${OTHER_EVENT}`); });
    expect(await screen.findByRole("heading", { level: 1, name: "Other event day" })).toBeTruthy();
    await screen.findByTestId("change-feed-notice");
    const calls = mockGetEventChangeFeed.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(mockGetEventChangeFeed.mock.calls.length).toBe(calls + 1); });
    expect(mockGetEventChangeFeed).toHaveBeenLastCalledWith(OTHER_EVENT, 25);
  });

  function renderNavigable(): { readonly navigateTo: { current: ((path: string) => void) | null } } {
    const navigateTo: { current: ((path: string) => void) | null } = { current: null };
    function Navigator(): null {
      const navigate = useNavigate();
      navigateTo.current = (path) => { void navigate(path); };
      return null;
    }
    render(
      <MemoryRouter initialEntries={[`/ops/events/${EVENT_ID}`]}>
        <Navigator />
        <Routes>
          <Route path="/ops/events/:eventId" element={<EventDayOpsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    return { navigateTo };
  }

  it("keeps a late refresh of the last event, and its late first load, off the event now open", async () => {
    const OTHER_EVENT = "00000000-0000-4000-8000-000000003096";
    const otherBoard: EventDayOpsBoard = { ...boardFixture(), event: { ...boardFixture().event, id: OTHER_EVENT, name: "Other event day" } };
    let lateBoard: ((board: EventDayOpsBoard) => void) | undefined;
    let boardReads = 0;
    mockGetEventDayOpsBoard.mockImplementation((id: string) => {
      if (id === OTHER_EVENT) return Promise.resolve(otherBoard);
      boardReads += 1;
      return boardReads === 1 ? Promise.resolve(boardFixture()) : new Promise<EventDayOpsBoard>((resolve) => { lateBoard = resolve; });
    });
    mockGetEventChangeFeed.mockResolvedValue([]);
    mockGetEventChangeFeed.mockResolvedValueOnce([requiredChangeFixture()]);
    const { navigateTo } = renderNavigable();
    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    // An acknowledgement reads the board again; that read is slow.
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge change" }));
    await waitFor(() => { expect(lateBoard).toBeDefined(); });
    act(() => { navigateTo.current?.(`/ops/events/${OTHER_EVENT}`); });
    expect(await screen.findByRole("heading", { level: 1, name: "Other event day" })).toBeTruthy();
    await act(async () => { lateBoard?.(boardFixture()); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Other event day");
    cleanup();

    // The last event's first load lands after the other is open.
    let lateFirst: ((board: EventDayOpsBoard) => void) | undefined;
    mockGetEventDayOpsBoard.mockImplementation((id: string) => (id === OTHER_EVENT
      ? Promise.resolve(otherBoard)
      : new Promise<EventDayOpsBoard>((resolve) => { lateFirst = resolve; })));
    mockGetEventChangeFeed.mockImplementation((id: string) => (id === OTHER_EVENT
      ? Promise.reject(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))
      : Promise.resolve([requiredChangeFixture()])));
    const second = renderNavigable();
    await waitFor(() => { expect(lateFirst).toBeDefined(); });
    act(() => { second.navigateTo.current?.(`/ops/events/${OTHER_EVENT}`); });
    expect(await screen.findByRole("heading", { level: 1, name: "Other event day" })).toBeTruthy();
    await screen.findByTestId("change-feed-notice");
    await act(async () => { lateFirst?.(boardFixture()); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Other event day");
    expect(screen.queryByText("Guest count changed")).toBeNull();
  });

  it("keeps the last event's late answers off the next event's page even before its own board lands", async () => {
    const OTHER_EVENT = "00000000-0000-4000-8000-000000003094";
    const otherBoard: EventDayOpsBoard = { ...boardFixture(), event: { ...boardFixture().event, id: OTHER_EVENT, name: "Other event day" } };
    let lateBoard: ((board: EventDayOpsBoard) => void) | undefined;
    let otherLands: ((board: EventDayOpsBoard) => void) | undefined;
    let boardReads = 0;
    mockGetEventDayOpsBoard.mockImplementation((id: string) => {
      if (id === OTHER_EVENT) return new Promise<EventDayOpsBoard>((resolve) => { otherLands = resolve; });
      boardReads += 1;
      return boardReads === 1 ? Promise.resolve(boardFixture()) : new Promise<EventDayOpsBoard>((resolve) => { lateBoard = resolve; });
    });
    mockGetEventChangeFeed.mockResolvedValue([requiredChangeFixture()]);
    const { navigateTo } = renderNavigable();
    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge change" }));
    await waitFor(() => { expect(lateBoard).toBeDefined(); });
    act(() => { navigateTo.current?.(`/ops/events/${OTHER_EVENT}`); });
    // The last event's refresh lands while the next event's board is still out.
    await act(async () => { lateBoard?.(boardFixture()); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(screen.queryByRole("heading", { level: 1, name: "Blake event day" })).toBeNull();
    await act(async () => { otherLands?.(otherBoard); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { level: 1, name: "Other event day" })).toBeTruthy();
    cleanup();

    // The last event's first load fails after the next event is open.
    let failFirst: ((reason: Error) => void) | undefined;
    mockGetEventDayOpsBoard.mockImplementation((id: string) => (id === OTHER_EVENT
      ? Promise.resolve(otherBoard)
      : new Promise<EventDayOpsBoard>((_resolve, reject) => { failFirst = reject; })));
    const second = renderNavigable();
    await waitFor(() => { expect(failFirst).toBeDefined(); });
    act(() => { second.navigateTo.current?.(`/ops/events/${OTHER_EVENT}`); });
    expect(await screen.findByRole("heading", { level: 1, name: "Other event day" })).toBeTruthy();
    await act(async () => { failFirst?.(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE")); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Other event day");
    expect(screen.queryByText("Event-day board unavailable")).toBeNull();
  });

  it("lets Try again join the read already out rather than send another", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();
    await screen.findByTestId("change-feed-notice");
    // A task marked done reads the board again; that read is still out.
    let land: ((items: ChangeFeedItem[]) => void) | undefined;
    mockGetEventChangeFeed.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((resolve) => { land = resolve; }));
    mockUpdateOpsTaskStatus.mockResolvedValue(task("done"));
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => { expect(land).toBeDefined(); });
    const reads = mockGetEventChangeFeed.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Trying again…" })).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    expect(mockGetEventChangeFeed.mock.calls.length).toBe(reads);
    await act(async () => { land?.([requiredChangeFixture()]); await Promise.resolve(); });
    expect(await screen.findByText("Guest count changed")).toBeTruthy();
  });

  it("never takes the focus from where someone went while a retry read", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();
    await screen.findByTestId("change-feed-notice");
    let land: ((items: ChangeFeedItem[]) => void) | undefined;
    mockGetEventChangeFeed.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((resolve) => { land = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    // While it reads, the hallkeeper starts writing an issue.
    const title = screen.getByLabelText("Title");
    title.focus();
    await act(async () => { land?.([requiredChangeFixture()]); await Promise.resolve(); });
    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(document.activeElement).toBe(title);
  });

  it("says each answer to a retry, even in words said a moment before", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-06-11T13:07:05.000Z"));
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
      renderPage();
      await screen.findByTestId("change-feed-notice");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => { expect(screen.getByTestId("change-feed-heard").textContent).toBe("Tried again at 14:07. The changes still could not be read."); });
      const first = screen.getByTestId("change-feed-heard").firstElementChild;
      vi.setSystemTime(new Date("2026-06-11T13:07:35.000Z"));
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => { expect(screen.getByTestId("change-feed-heard").firstElementChild).not.toBe(first); });
      expect(screen.getByTestId("change-feed-heard").textContent).toBe("Tried again at 14:07. The changes still could not be read.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing failed when a later read found the changes before a retry's older read failed", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();
    await screen.findByTestId("change-feed-notice");
    // The retry's read is slow; a sync sets out after it and finds the changes.
    let failRetry: ((reason: Error) => void) | undefined;
    mockGetEventChangeFeed.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((_resolve, reject) => { failRetry = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(failRetry).toBeDefined(); });
    mockGetEventChangeFeed.mockResolvedValueOnce([requiredChangeFixture()]);
    fireEvent.click(screen.getByRole("button", { name: "Sync pending event-day changes" }));
    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    await act(async () => { failRetry?.(new ApiError(0, "Network error", "NETWORK_ERROR")); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(screen.queryByTestId("change-feed-notice")).toBeNull();
    expect(screen.getByText("Guest count changed")).toBeTruthy();
    expect(screen.getByTestId("change-feed-heard").textContent).not.toMatch(/still could not be read/u);
  });

  it("says the failure aloud once, on the venue's own clock, waiting for the venue to be read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // A venue in New York: 13:05Z is 09:05 on its walls. The venue answers late.
      let venueLands: ((venue: Awaited<ReturnType<typeof getVenue>>) => void) | undefined;
      vi.mocked(getVenue).mockImplementationOnce(() => new Promise((resolve) => { venueLands = resolve; }));
      vi.setSystemTime(new Date("2026-06-11T13:05:00.000Z"));
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
      const said: string[] = [];
      const observer = new MutationObserver(() => {
        const text = document.querySelector("[data-testid=change-feed-heard]")?.textContent ?? "";
        if (text !== "" && said[said.length - 1] !== text) said.push(text);
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      renderPage();
      await screen.findByTestId("change-feed-notice");
      await waitFor(() => { expect(venueLands).toBeDefined(); });
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
      await act(async () => { venueLands?.({ id: "venue-1", name: "Harbour Hall", timezone: "America/New_York" } as Awaited<ReturnType<typeof getVenue>>); await Promise.resolve(); });
      await waitFor(() => { expect(screen.getByTestId("change-feed-heard").textContent).toBe("Couldn't read the changes at 09:05."); });
      observer.disconnect();
      expect(said).toEqual(["Couldn't read the changes at 09:05."]);
      expect(screen.getByTestId("change-feed-notice").textContent).toContain("since 09:05.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the changes a read found, whatever a read that set out later failed to find", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();
    await screen.findByTestId("change-feed-notice");
    // The retry's read is slow, and will find the change.
    let landRetry: ((items: ChangeFeedItem[]) => void) | undefined;
    mockGetEventChangeFeed.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((resolve) => { landRetry = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(landRetry).toBeDefined(); });
    // A sync sets out after it; its read cannot read the changes, and lands first.
    const reads = mockGetEventChangeFeed.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Sync pending event-day changes" }));
    await waitFor(() => { expect(mockGetEventChangeFeed.mock.calls.length).toBe(reads + 1); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    await act(async () => { landRetry?.([requiredChangeFixture()]); await Promise.resolve(); });
    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(screen.queryByTestId("change-feed-notice")).toBeNull();
    expect(screen.getByTestId("change-feed-heard").textContent).not.toMatch(/still could not be read/u);
  });

  it("keeps the board a later read drew when an older read of it lands after", async () => {
    const renamed: EventDayOpsBoard = { ...boardFixture(), event: { ...boardFixture().event, name: "Blake event day, as amended" } };
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();
    await screen.findByTestId("change-feed-notice");
    // The retry's board read is slow and will answer with the board as it was.
    let landOld: ((board: EventDayOpsBoard) => void) | undefined;
    mockGetEventDayOpsBoard.mockImplementationOnce(() => new Promise<EventDayOpsBoard>((resolve) => { landOld = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(landOld).toBeDefined(); });
    // A sync sets out after it and draws the board as amended.
    mockGetEventDayOpsBoard.mockResolvedValueOnce(renamed);
    fireEvent.click(screen.getByRole("button", { name: "Sync pending event-day changes" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Blake event day, as amended" })).toBeTruthy();
    await act(async () => { landOld?.(boardFixture()); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Blake event day, as amended");
  });

  it("keeps the board a later read drew when the first load fails late", async () => {
    let failFirst: ((reason: Error) => void) | undefined;
    let boardReads = 0;
    mockGetEventDayOpsBoard.mockImplementation(() => {
      boardReads += 1;
      return boardReads === 1
        ? new Promise<EventDayOpsBoard>((_resolve, reject) => { failFirst = reject; })
        : Promise.resolve(boardFixture());
    });
    renderPage();
    await waitFor(() => { expect(failFirst).toBeDefined(); });
    // The connection returns: the queue flushes and reads the board, which lands.
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(await screen.findByRole("heading", { level: 1, name: "Blake event day" })).toBeTruthy();
    await act(async () => { failFirst?.(new ApiError(0, "Network error", "NETWORK_ERROR")); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Blake event day");
  });

  it("hands a focus resting on Try again to the heading when a poll reads the changes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockGetEventChangeFeed.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
      renderPage();
      await screen.findByTestId("change-feed-notice");
      const button = screen.getByRole("button", { name: "Try again" });
      act(() => { button.focus(); });
      mockGetEventChangeFeed.mockResolvedValue([requiredChangeFixture()]);
      await act(async () => { vi.advanceTimersByTime(10_000); await Promise.resolve(); });
      expect(await screen.findByText("Guest count changed")).toBeTruthy();
      await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "Required acknowledgements" })); });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the changes last read when a later read fails, and says from when", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-06-11T13:05:00.000Z"));
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockGetEventChangeFeed.mockResolvedValueOnce([requiredChangeFixture()]);
      renderPage();
      expect(await screen.findByText("Guest count changed")).toBeTruthy();

      // Ten minutes on, the feed cannot be read: what was read stays.
      vi.setSystemTime(new Date("2026-06-11T13:15:00.000Z"));
      mockGetEventChangeFeed.mockRejectedValue(new ApiError(0, "Network error", "NETWORK_ERROR"));
      fireEvent.click(screen.getByRole("button", { name: "Sync pending event-day changes" }));
      expect(await screen.findByText("Couldn't refresh the changes since 14:15. Showing them as they were at 14:05.")).toBeTruthy();
      expect(screen.getByText("Guest count changed")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Acknowledge change" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not invent a setup-sheet link when the event has no linked handoff", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue({ ...boardFixture(), handoffPack: null, sourceStatus: "missing_handoff" });
    renderPage();
    await screen.findByText("Working documents");
    expect(screen.queryByRole("link", { name: "Open current setup sheet" })).toBeNull();
    expect(screen.getByRole("link", { name: "Day Board" }).getAttribute("href")).toBe("/hallkeeper/today");
  });

  it("acknowledges required planner or client changes", async () => {
    const change = requiredChangeFixture();
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockResolvedValue([change]);
    renderPage();

    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Acknowledge change/i }));

    await waitFor(() => {
      expect(mockAcknowledgeEventPlanChange).toHaveBeenCalledWith(EVENT_ID, { changeId: change.id });
    });
    expect(await screen.findByText("Change acknowledged.")).toBeTruthy();
  });

  it("does not ask again for a change the room already acknowledged on another device", async () => {
    // Acknowledgements used to live in this component's state, so a reload or
    // a second tablet showed an acknowledged change as still waiting. They are
    // read from the event's persisted acknowledgements now.
    const change = requiredChangeFixture();
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockResolvedValue([change]);
    mockListEventChangeAcknowledgements.mockResolvedValue([{
      id: "00000000-0000-4000-8000-000000003040",
      changeId: change.id,
      eventId: EVENT_ID,
      acknowledgedBy: "00000000-0000-4000-8000-000000003041",
      acknowledgedByRole: "hallkeeper",
      note: null,
      createdAt: NOW,
    }]);
    renderPage();

    expect(await screen.findByText("No changes awaiting acknowledgement.")).toBeTruthy();
    expect(mockListEventChangeAcknowledgements).toHaveBeenCalledWith(EVENT_ID);
    expect(screen.queryByText("Guest count changed")).toBeNull();
    expect(screen.queryByRole("button", { name: /Acknowledge change/i })).toBeNull();
  });

  it("shows the board while acknowledgements are still being read, and waits to list changes", async () => {
    // The acknowledgement read runs beside the board, never in front of it: a
    // slow read must not hold the whole board on its loading state, and until
    // it settles the page says it is checking rather than listing a change the
    // room may already have acknowledged.
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockResolvedValue([requiredChangeFixture()]);
    let settle: (rows: []) => void = () => undefined;
    mockListEventChangeAcknowledgements.mockReturnValue(new Promise<[]>((resolve) => { settle = resolve; }));
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Blake event day" })).toBeTruthy();
    expect(screen.getByText("Checking what the room has acknowledged…")).toBeTruthy();
    expect(screen.queryByText("Guest count changed")).toBeNull();

    await act(async () => { settle([]); await Promise.resolve(); });
    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    expect(screen.queryByText("Checking what the room has acknowledged…")).toBeNull();
  });

  it("keeps a required change in view when its acknowledgements cannot be read", async () => {
    // Failing towards "still needs acknowledging" is safe: acknowledging twice
    // is harmless, and a change that silently vanishes is not.
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockResolvedValue([requiredChangeFixture()]);
    mockListEventChangeAcknowledgements.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();

    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Acknowledge change/i })).toBeTruthy();
  });

  it("keeps an acknowledged change gone when a read that set out earlier returns without it", async () => {
    const change = requiredChangeFixture();
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockResolvedValue([change]);
    // The server's list lags the POST: it never includes this change here.
    mockListEventChangeAcknowledgements.mockResolvedValue([]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Acknowledge change/i }));
    expect(await screen.findByText("Change acknowledged.")).toBeTruthy();
    // The acknowledgement refetches; the lagging list must not resurrect it.
    await waitFor(() => { expect(mockListEventChangeAcknowledgements.mock.calls.length).toBeGreaterThan(1); });
    expect(await screen.findByText("No changes awaiting acknowledgement.")).toBeTruthy();
    expect(screen.queryByText("Guest count changed")).toBeNull();
  });

  it("renders a blocker-risk change, and keeps its label above AA", async () => {
    // Two halves of one defect. The first contrast sweep reported “0 offenders”
    // on this board because `article[data-risk="blocker"]` only exists when a
    // change carries that risk and none did, so the state is pinned here; the
    // second half is the colour the stylesheet gives that label. --hk-alert
    // #c2503e measures 3.63:1 on this card at 11.5px/900 — under AA's 4.5, and
    // under the 3.88:1 it replaced. The register's discipline is that state
    // lives in the border, not in the text.
    const change = { ...requiredChangeFixture(), riskLevel: "blocker" as const, title: "Fire exit blocked" };
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetEventChangeFeed.mockResolvedValue([change]);
    renderPage();

    expect(await screen.findByText("Fire exit blocked")).toBeTruthy();
    const article = document.querySelector(
      '.event-day-change-feed article[data-risk="blocker"]',
    );
    expect(article).not.toBeNull();
    expect(article?.querySelector("span")?.textContent).toBe("blocker");

    // happy-dom does not apply the stylesheet, so the rule is read from it.
    const css = readFileSync(resolve("src/pages/EventDayOpsPage.css"), "utf8");
    const rule = /article\[data-risk="blocker"\] span \{[^}]*\}/u.exec(css)?.[0] ?? "";
    expect(rule).toContain("var(--hk-forest)");
    expect(rule).not.toContain("--hk-alert");
  });

  it("updates task status from the checklist", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockUpdateOpsTaskStatus.mockResolvedValue(task("done"));
    renderPage();

    await screen.findByText("Set 12 x Round Table");
    fireEvent.click(screen.getByText("Done"));

    await waitFor(() => {
      expect(mockUpdateOpsTaskStatus).toHaveBeenCalledWith(
        TASK_ID,
        expect.objectContaining({ status: "done" }),
      );
    });
  });

  it("queues task status when the network is unavailable", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockUpdateOpsTaskStatus.mockRejectedValue(new ApiError(0, "Network error", "NETWORK_ERROR"));
    renderPage();

    await screen.findByText("Set 12 x Round Table");
    fireEvent.click(screen.getByText("Done"));

    await waitFor(() => {
      expect(mockEnqueueEventDayTaskStatus).toHaveBeenCalledWith(
        TASK_ID,
        expect.objectContaining({ status: "done" }),
      );
    });
  });

  it("creates issue reports", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockCreateEventDayIssue.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000003013",
      eventId: EVENT_ID,
      phaseId: null,
      opsTaskId: null,
      title: "Supplier late",
      detail: "Supplier is ten minutes behind the planning window.",
      status: "open",
      severity: "attention",
      source: "hallkeeper",
      reportedBy: null,
      assignedTo: null,
      escalationNote: null,
      createdAt: NOW,
      updatedAt: NOW,
      resolvedAt: null,
    });
    renderPage();

    await screen.findByText("Issue report");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Supplier late" } });
    fireEvent.change(screen.getByLabelText("Detail"), {
      target: { value: "Supplier is ten minutes behind the planning window." },
    });
    fireEvent.click(screen.getByText("Log issue"));

    await waitFor(() => {
      expect(mockCreateEventDayIssue).toHaveBeenCalledWith(
        EVENT_ID,
        expect.objectContaining({ title: "Supplier late" }),
      );
    });
    // It says who hears: the API raises notifications for staff and hallkeepers.
    expect(await screen.findByText("Issue logged. Staff and hallkeepers are notified.")).toBeTruthy();
  });

  // --- Ship Friday, gate line 21 and decision 7 ---------------------------

  it("claims task and issue authority so Mission Control hides its own controls", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    renderPage();
    await screen.findByText("Blake event day");
    expect(missionProps.current?.["ownsExecutionControls"]).toBe(false);
    // The board's own task actions stay available regardless of mission state.
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("resolves an open issue and refetches the board", async () => {
    const issue = openIssueFixture();
    mockGetEventDayOpsBoard.mockResolvedValue({ ...boardFixture(), issues: [issue] });
    mockUpdateEventDayIssue.mockResolvedValue({ ...issue, status: "resolved", resolvedAt: NOW });
    renderPage();

    await screen.findByText("Chair delivery short");
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      expect(mockUpdateEventDayIssue).toHaveBeenCalledWith(EVENT_ID, issue.id, { status: "resolved" });
    });
    expect(await screen.findByText("Issue resolved.")).toBeTruthy();
    // Every mutation pulls fresh server truth rather than trusting the patch.
    await waitFor(() => { expect(mockGetEventDayOpsBoard).toHaveBeenCalledTimes(2); });
  });

  it("counts only issues someone still has to act on, and keeps resolved ones apart until closed", async () => {
    const open = openIssueFixture();
    const handled = { ...open, id: "00000000-0000-4000-8000-000000003051", title: "Stage lights flicker", status: "in_progress" as const };
    const resolved = { ...open, id: "00000000-0000-4000-8000-000000003052", title: "Cloakroom rail missing", status: "resolved" as const, resolvedAt: NOW };
    const closed = { ...open, id: "00000000-0000-4000-8000-000000003053", title: "Door wedge lost", status: "closed" as const, resolvedAt: NOW };
    mockGetEventDayOpsBoard.mockResolvedValue({ ...boardFixture(), issues: [open, handled, resolved, closed] });
    renderPage();

    await screen.findByText("Chair delivery short");
    expect(screen.getByText("2 open issues.")).toBeTruthy();
    const lists = document.querySelectorAll(".event-day-issue-list");
    expect(Array.from(lists[0]?.querySelectorAll("h3") ?? [], (title) => title.textContent)).toEqual(["Chair delivery short", "Stage lights flicker"]);
    // Resolved waits apart with only Close; a closed issue is gone.
    expect(screen.getByRole("heading", { name: "Resolved" })).toBeTruthy();
    const waiting = document.querySelector(".event-day-issue-list.is-resolved");
    expect(Array.from(waiting?.querySelectorAll("h3") ?? [], (title) => title.textContent)).toEqual(["Cloakroom rail missing"]);
    expect(Array.from(waiting?.querySelectorAll("button") ?? [], (button) => button.textContent)).toEqual(["Close"]);
    expect(screen.queryByText("Door wedge lost")).toBeNull();
  });

  it("says no issue is open once every one is resolved", async () => {
    const resolved = { ...openIssueFixture(), status: "resolved" as const, resolvedAt: NOW };
    mockGetEventDayOpsBoard.mockResolvedValue({ ...boardFixture(), issues: [resolved] });
    renderPage();

    await screen.findByText("Chair delivery short");
    expect(screen.getByText("No open issues.")).toBeTruthy();
    expect(screen.getByText("No open issues on this event.")).toBeTruthy();
  });

  it("closes an open issue", async () => {
    const issue = openIssueFixture();
    mockGetEventDayOpsBoard.mockResolvedValue({ ...boardFixture(), issues: [issue] });
    mockUpdateEventDayIssue.mockResolvedValue({ ...issue, status: "closed" });
    renderPage();

    await screen.findByText("Chair delivery short");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(mockUpdateEventDayIssue).toHaveBeenCalledWith(EVENT_ID, issue.id, { status: "closed" });
    });
  });

  it("says plainly when no supplier arrival has been captured", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue({ ...boardFixture(), supplierArrivals: [] });
    renderPage();
    await screen.findByText("Supplier arrivals");
    expect(screen.getByText("No supplier arrival has been captured for this event.")).toBeTruthy();
  });

  it("labels compiled supplier prompts as notes, not as arrivals", async () => {
    const base = boardFixture();
    const pack = base.handoffPack;
    if (pack === null) throw new Error("fixture has a handoff pack");
    const note = { ...pack.supplierInstructions[0], id: "00000000-0000-4000-8000-000000003040", title: "Supplier coordination check", arrivalWindow: null, supplierId: null };
    mockGetEventDayOpsBoard.mockResolvedValue({
      ...base,
      supplierArrivals: [],
      handoffPack: { ...pack, supplierInstructions: [note] },
    });
    renderPage();

    expect(await screen.findByText("Handoff notes")).toBeTruthy();
    expect(screen.getByText(/Notes to check — not booked arrivals\./u)).toBeTruthy();
    expect(screen.getByText("Supplier coordination check")).toBeTruthy();
  });

  it("shows the Diary's booked hour, not the event record's planned one", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    // The event record says 09:00Z; the booking that holds the room says 07:00Z.
    mockGetCalendar.mockResolvedValue({
      venueId: "00000000-0000-4000-8000-000000003004",
      range: { from: NOW, to: NOW },
      rooms: [],
      entries: [{
        entryType: "booking", id: "00000000-0000-4000-8000-000000003060",
        spaceId: "00000000-0000-4000-8000-000000003061", kind: "ink", status: "active", state: "ink",
        title: "Blake event day", eventType: "wedding",
        startsAt: "2026-06-12T07:00:00.000Z", endsAt: "2026-06-12T20:00:00.000Z",
        rank: null, jointFlag: false, decisionAt: null, ownerUserId: null,
        nextAction: null, nextActionDueAt: null, eventId: EVENT_ID, seriesId: null,
      }],
      conflicts: { conflicts: [], checks: {
        inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      } },
    });
    renderPage();
    await screen.findByText("Blake event day");
    await waitFor(() => { expect(heroLine()).toContain("08:00"); });
    expect(heroLine()).not.toContain("10:00");
  });

  it("names the event's day against the venue's calendar, and its zone in words", async () => {
    // Midday on the 11th in Glasgow; the event is on the 12th. The device
    // reads UTC, so the venue's clock is named, in words.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-06-11T11:00:00.000Z"));
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      renderPage();
      await screen.findByText("Blake event day");
      expect(screen.getByText("Tomorrow's event")).toBeTruthy();
      expect(screen.queryByText("Today's event")).toBeNull();
      expect(heroLine()).toContain(" · UK time · ");
      expect(heroLine()).not.toContain("Europe/London");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the time as planned when the Diary cannot be read", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetCalendar.mockRejectedValue(new Error("offline"));
    renderPage();
    await screen.findByText("Blake event day");
    await waitFor(() => { expect(screen.getByText(/\(planned\)/u)).toBeTruthy(); });
  });

  it("ignores a prospect carrying the event's id when choosing the booked hour", async () => {
    // Three surfaces used to disagree: the Day Board and the sheet exclude
    // prospects, this board filtered on `status` alone, so a pipeline row
    // could set the hero hour nobody else recognised.
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetCalendar.mockResolvedValue({
      venueId: "00000000-0000-4000-8000-000000003004",
      range: { from: NOW, to: NOW },
      rooms: [],
      entries: [
        // Earlier, and active — but a prospect, so not board-worthy.
        { ...calendarBooking("00000000-0000-4000-8000-000000003070", "2026-06-12T05:00:00.000Z"), kind: "prospect", state: "prospect" },
        calendarBooking("00000000-0000-4000-8000-000000003071", "2026-06-12T07:00:00.000Z"),
      ],
      conflicts: { conflicts: [], checks: {
        inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      } },
    });
    renderPage();
    await screen.findByText("Blake event day");
    // 07:00Z = 08:00 Europe/London — the ink booking, not the 06:00 prospect.
    await waitFor(() => { expect(heroLine()).toContain("08:00"); });
    expect(heroLine()).not.toContain("06:00");
  });

  it("keeps UI language claim-safe", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    const { container } = render(
      <MemoryRouter initialEntries={[`/ops/events/${EVENT_ID}`]}>
        <Routes>
          <Route path="/ops/events/:eventId" element={<EventDayOpsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Blake event day");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/fire approved|certified safe|legally compliant|approved for occupancy/iu);
  });
});

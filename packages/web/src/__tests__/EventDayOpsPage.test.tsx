import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type { ChangeFeedItem, EventDayIssue, EventDayOpsBoard, OpsTask, UpdateOpsTaskStatusInput } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { EventDayOpsPage } from "../pages/EventDayOpsPage.js";
import { getVenue } from "../api/spaces.js";
import { memoryBackend, withBackend } from "../lib/idb-cache.js";
import type { QueuedEventDayOp, createEventDayQueue } from "../lib/event-day-offline-queue.js";

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
  mockGetChangesAwaitingAcknowledgement,
  mockGetEventChangeFeed,
  mockGetCalendar,
  mockAcknowledgeEventPlanChange,
  mockListEventChangeAcknowledgements,
  mockAckEventDayOp,
  mockAckEventDayOpIf,
  mockEnqueueEventDayIssueCreate,
  mockEnqueueEventDayTaskStatus,
  mockListPendingEventDayOps,
} = vi.hoisted(() => ({
  mockGetEventDayOpsBoard: vi.fn(),
  mockUpdateOpsTaskStatus: vi.fn(),
  mockCreateEventDayIssue: vi.fn(),
  mockUpdateEventDayIssue: vi.fn(),
  mockGetChangesAwaitingAcknowledgement: vi.fn(),
  // The every-change feed: read only while an older API lacks the answer above.
  mockGetEventChangeFeed: vi.fn(),
  mockGetCalendar: vi.fn(),
  mockAcknowledgeEventPlanChange: vi.fn(),
  mockListEventChangeAcknowledgements: vi.fn(),
  mockAckEventDayOp: vi.fn(),
  mockAckEventDayOpIf: vi.fn(),
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
  getChangesAwaitingAcknowledgement: mockGetChangesAwaitingAcknowledgement,
  getEventChangeFeed: mockGetEventChangeFeed,
  acknowledgeEventPlanChange: mockAcknowledgeEventPlanChange,
  listEventChangeAcknowledgements: mockListEventChangeAcknowledgements,
  // The dashboard shell reads the unread count for its nav chip.
  listNotifications: () => Promise.resolve([]),
  getUnreadNotificationCount: () => Promise.resolve(0),
}));

vi.mock("../lib/event-day-offline-queue.js", () => ({
  ackEventDayOp: mockAckEventDayOp,
  ackEventDayOpIf: mockAckEventDayOpIf,
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

// Supplier passes read their own board beside this one; their own spec covers
// them (components/supplier-passes/__tests__). The stub records the event.
vi.mock("../components/supplier-passes/SupplierPassesSection.js", () => ({
  SupplierPassesSection: (props: { readonly eventId: string }) => (
    <section data-testid="supplier-passes" data-event-id={props.eventId}>Supplier passes</section>
  ),
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
  mockGetChangesAwaitingAcknowledgement.mockReset();
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
  mockAckEventDayOpIf.mockReset();
  mockAckEventDayOpIf.mockResolvedValue(true);
  mockEnqueueEventDayIssueCreate.mockReset();
  mockEnqueueEventDayTaskStatus.mockReset();
  mockListPendingEventDayOps.mockReset();
  mockListPendingEventDayOps.mockResolvedValue([]);
  mockGetChangesAwaitingAcknowledgement.mockResolvedValue([]);
  mockGetEventChangeFeed.mockReset();
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
    // The event's supplier passes sit on the same board, for the same event.
    expect(screen.getByTestId("supplier-passes").getAttribute("data-event-id")).toBe(EVENT_ID);
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
    mockGetChangesAwaitingAcknowledgement.mockReturnValue(feedRead);
    renderPage();

    // Both reads are out before either answers.
    await waitFor(() => { expect(mockGetChangesAwaitingAcknowledgement).toHaveBeenCalledWith(EVENT_ID); });
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

  it("names an event stored without a name by its occasion and the venue's day (the event-name ruling)", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue({ ...boardFixture(), event: { ...boardFixture().event, name: "" } });
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Wedding, 12 June 2026" })).toBeTruthy();
  });

  it("says the board is unavailable when the board cannot be read, without waiting for the feed, and Retry reads both again", async () => {
    mockGetEventDayOpsBoard.mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetChangesAwaitingAcknowledgement.mockReturnValueOnce(new Promise<ChangeFeedItem[]>(() => undefined));
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Event-day board unavailable" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Blake event day" })).toBeTruthy();
    expect(mockGetEventDayOpsBoard).toHaveBeenCalledTimes(2);
    expect(mockGetChangesAwaitingAcknowledgement).toHaveBeenCalledTimes(2);
  });

  it("keeps the board when only its change feed cannot be read, and never takes the failure for no changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 14:05 in Glasgow.
      vi.setSystemTime(new Date("2026-06-11T13:05:00.000Z"));
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
      renderPage();

      expect(await screen.findByRole("heading", { level: 1, name: "Blake event day" })).toBeTruthy();
      expect(screen.queryByText("Event-day board unavailable")).toBeNull();
      expect(await screen.findByText("Couldn't read the changes, so what waits for acknowledgement is not known yet. Trying every 10 seconds since 14:05.")).toBeTruthy();
      expect(screen.queryByText("No changes awaiting acknowledgement.")).toBeNull();

      // Tried again and read: the notice goes, and the changes are listed.
      mockGetChangesAwaitingAcknowledgement.mockResolvedValue([requiredChangeFixture()]);
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
      mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
      renderPage();
      await screen.findByTestId("change-feed-notice");
      await waitFor(() => { expect(screen.getByTestId("change-feed-heard").textContent).toBe("Couldn't read the changes at 14:05."); });

      // Two minutes on, a retry that also fails: it works, then says so.
      vi.setSystemTime(new Date("2026-06-11T13:07:00.000Z"));
      let fail: ((reason: Error) => void) | undefined;
      mockGetChangesAwaitingAcknowledgement.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((_resolve, reject) => { fail = reject; }));
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
      mockGetChangesAwaitingAcknowledgement.mockResolvedValue([requiredChangeFixture()]);
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
      mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
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
      expect(mockGetChangesAwaitingAcknowledgement.mock.calls.length).toBeGreaterThanOrEqual(4);
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
    mockGetChangesAwaitingAcknowledgement.mockResolvedValueOnce([requiredChangeFixture()]);
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
    mockGetChangesAwaitingAcknowledgement.mockImplementation((id: string) => (id === EVENT_ID
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
    const reads = mockGetChangesAwaitingAcknowledgement.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(mockGetChangesAwaitingAcknowledgement.mock.calls.length).toBe(reads + 1); });
    expect(mockGetChangesAwaitingAcknowledgement).toHaveBeenLastCalledWith(OTHER_EVENT);
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
    mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
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
    mockGetChangesAwaitingAcknowledgement.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    act(() => { navigateTo.current?.(`/ops/events/${OTHER_EVENT}`); });
    expect(await screen.findByRole("heading", { level: 1, name: "Other event day" })).toBeTruthy();
    await screen.findByTestId("change-feed-notice");
    const calls = mockGetChangesAwaitingAcknowledgement.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(mockGetChangesAwaitingAcknowledgement.mock.calls.length).toBe(calls + 1); });
    expect(mockGetChangesAwaitingAcknowledgement).toHaveBeenLastCalledWith(OTHER_EVENT);
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
    mockGetChangesAwaitingAcknowledgement.mockResolvedValue([]);
    mockGetChangesAwaitingAcknowledgement.mockResolvedValueOnce([requiredChangeFixture()]);
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
    mockGetChangesAwaitingAcknowledgement.mockImplementation((id: string) => (id === OTHER_EVENT
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
    mockGetChangesAwaitingAcknowledgement.mockResolvedValue([requiredChangeFixture()]);
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
    mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();
    await screen.findByTestId("change-feed-notice");
    // A task marked done reads the board again; that read is still out.
    let land: ((items: ChangeFeedItem[]) => void) | undefined;
    mockGetChangesAwaitingAcknowledgement.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((resolve) => { land = resolve; }));
    mockUpdateOpsTaskStatus.mockResolvedValue(task("done"));
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => { expect(land).toBeDefined(); });
    const reads = mockGetChangesAwaitingAcknowledgement.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Trying again…" })).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    expect(mockGetChangesAwaitingAcknowledgement.mock.calls.length).toBe(reads);
    await act(async () => { land?.([requiredChangeFixture()]); await Promise.resolve(); });
    expect(await screen.findByText("Guest count changed")).toBeTruthy();
  });

  it("never takes the focus from where someone went while a retry read", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();
    await screen.findByTestId("change-feed-notice");
    let land: ((items: ChangeFeedItem[]) => void) | undefined;
    mockGetChangesAwaitingAcknowledgement.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((resolve) => { land = resolve; }));
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
      mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
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
    mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();
    await screen.findByTestId("change-feed-notice");
    // The retry's read is slow; a sync sets out after it and finds the changes.
    let failRetry: ((reason: Error) => void) | undefined;
    mockGetChangesAwaitingAcknowledgement.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((_resolve, reject) => { failRetry = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(failRetry).toBeDefined(); });
    mockGetChangesAwaitingAcknowledgement.mockResolvedValueOnce([requiredChangeFixture()]);
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
      mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
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
    mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();
    await screen.findByTestId("change-feed-notice");
    // The retry's read is slow, and will find the change.
    let landRetry: ((items: ChangeFeedItem[]) => void) | undefined;
    mockGetChangesAwaitingAcknowledgement.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((resolve) => { landRetry = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(landRetry).toBeDefined(); });
    // A sync sets out after it; its read cannot read the changes, and lands first.
    const reads = mockGetChangesAwaitingAcknowledgement.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Sync pending event-day changes" }));
    await waitFor(() => { expect(mockGetChangesAwaitingAcknowledgement.mock.calls.length).toBe(reads + 1); });
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
    mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
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

  it("leaves the focus on a Try again that stays, when a read that found the changes and a newer one that did not answer together", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();
    await screen.findByTestId("change-feed-notice");
    const button = screen.getByRole("button", { name: "Try again" });
    // An older read (a task's refresh) will find the changes; a newer one (a sync) will not.
    let landOlder: ((items: ChangeFeedItem[]) => void) | undefined;
    let failNewer: ((reason: Error) => void) | undefined;
    mockGetChangesAwaitingAcknowledgement.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((resolve) => { landOlder = resolve; }));
    mockUpdateOpsTaskStatus.mockResolvedValue(task("done"));
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => { expect(landOlder).toBeDefined(); });
    mockGetChangesAwaitingAcknowledgement.mockImplementationOnce(() => new Promise<ChangeFeedItem[]>((_resolve, reject) => { failNewer = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Sync pending event-day changes" }));
    await waitFor(() => { expect(failNewer).toBeDefined(); });
    act(() => { button.focus(); });
    await act(async () => {
      landOlder?.([requiredChangeFixture()]);
      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
      failNewer?.(new ApiError(0, "Network error", "NETWORK_ERROR"));
      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
    });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    // The newest read failed, so the notice and its button stay, with the focus.
    expect(screen.getByTestId("change-feed-notice")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Try again" }));
  });

  // L9: the queue also holds the Day Board's facts and request steps; this
  // page replays only its own, and never sends a request step as an issue.
  it("leaves the Day Board's request steps and facts in the queue for that screen", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockCreateEventDayIssue.mockResolvedValue(undefined);
    const issue = {
      kind: "issue_create" as const, queueKey: "issue:issue-a", eventId: "event-1", queuedAt: "2026-10-29T18:39:00.000Z",
      input: { title: "Lift unavailable", detail: "Use the north stair.", severity: "urgent" as const },
    };
    mockListPendingEventDayOps.mockResolvedValue([
      {
        kind: "request_step", queueKey: "request:00000000-0000-4000-8000-00000000e001",
        venueId: "00000000-0000-4000-8000-00000000a001", requestId: "00000000-0000-4000-8000-00000000d001",
        bookingId: null, summary: "Chairs × 10", transition: { to: "accepted" }, expectedState: "sent", expectedOwnerUserId: null,
        commandId: "00000000-0000-4000-8000-00000000e001", authorUserId: "00000000-0000-4000-8000-0000000000ff",
        authorName: "Elaine", queuedAt: "2026-10-29T18:38:00.000Z",
      },
      {
        kind: "observation_record", queueKey: "observation:00000000-0000-4000-8000-00000000c001",
        venueId: "00000000-0000-4000-8000-00000000a001", queuedAt: "2026-10-29T18:38:30.000Z",
        input: {
          bookingId: "00000000-0000-4000-8000-00000000b001", kind: "doors-open",
          observedAt: "2026-10-29T18:38:30.000Z", idempotencyKey: "00000000-0000-4000-8000-00000000c001",
        },
      },
      issue,
    ]);
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Blake event day" });
    act(() => { window.dispatchEvent(new Event("online")); });

    // The issue is last in the queue: once it is acked, every op before it was met.
    await waitFor(() => { expect(mockAckEventDayOp).toHaveBeenCalledWith("issue:issue-a"); });
    expect(mockCreateEventDayIssue).toHaveBeenCalledTimes(1);
    expect(mockCreateEventDayIssue).toHaveBeenCalledWith("event-1", issue.input);
    expect(mockAckEventDayOp).toHaveBeenCalledTimes(1);
    expect(mockUpdateOpsTaskStatus).not.toHaveBeenCalled();
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
      mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
      renderPage();
      await screen.findByTestId("change-feed-notice");
      const button = screen.getByRole("button", { name: "Try again" });
      act(() => { button.focus(); });
      mockGetChangesAwaitingAcknowledgement.mockResolvedValue([requiredChangeFixture()]);
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
      mockGetChangesAwaitingAcknowledgement.mockResolvedValueOnce([requiredChangeFixture()]);
      renderPage();
      expect(await screen.findByText("Guest count changed")).toBeTruthy();

      // Ten minutes on, the feed cannot be read: what was read stays.
      vi.setSystemTime(new Date("2026-06-11T13:15:00.000Z"));
      mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(0, "Network error", "NETWORK_ERROR"));
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
    mockGetChangesAwaitingAcknowledgement.mockResolvedValue([change]);
    renderPage();

    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Acknowledge change/i }));

    await waitFor(() => {
      expect(mockAcknowledgeEventPlanChange).toHaveBeenCalledWith(EVENT_ID, { changeId: change.id });
    });
    expect(await screen.findByText("Change acknowledged.")).toBeTruthy();
  });

  // Release audit, contract-n-1. The board used to read the newest 25 changes
  // of every kind and pick out the ones needing acknowledgement. On a busy
  // set-up that page is all task moves, the change that mattered is older than
  // every one of them, and the board said nothing was waiting.
  it("shows a change awaiting acknowledgement however many newer changes there are", async () => {
    const taskMoves = Array.from({ length: 25 }, (_unused, index): ChangeFeedItem => ({
      ...requiredChangeFixture(),
      id: `00000000-0000-4000-8000-0000000040${String(index).padStart(2, "0")}`,
      sourceKind: "ops_task",
      title: "Hallkeeper task updated",
      summary: "A set-up task moved on.",
      requiresHallkeeperAcknowledgement: false,
    }));
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    // The newest page of every change holds nothing to acknowledge...
    mockGetEventChangeFeed.mockResolvedValue(taskMoves);
    // ...and the guest-count change, older than all of it, is still waiting.
    mockGetChangesAwaitingAcknowledgement.mockResolvedValue([requiredChangeFixture()]);
    renderPage();

    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    expect(screen.queryByText("No changes awaiting acknowledgement.")).toBeNull();
    expect(mockGetChangesAwaitingAcknowledgement).toHaveBeenCalledWith(EVENT_ID);
    expect(mockGetEventChangeFeed).not.toHaveBeenCalled();
  });

  it("reads the feed as it used to, at its largest page, while an older API has no such answer", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(404, "Route not found", "NOT_FOUND"));
    mockGetEventChangeFeed.mockResolvedValue([requiredChangeFixture()]);
    renderPage();

    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    expect(mockGetEventChangeFeed).toHaveBeenCalledWith(EVENT_ID, 100);
  });

  it("does not take any other failure for an older API, nor for nothing waiting", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetChangesAwaitingAcknowledgement.mockRejectedValue(new ApiError(500, "Server error", "INTERNAL_ERROR"));
    renderPage();

    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(mockGetEventChangeFeed).not.toHaveBeenCalled();
    expect(screen.queryByText("No changes awaiting acknowledgement.")).toBeNull();
  });

  it("does not ask again for a change the room already acknowledged on another device", async () => {
    // Acknowledgements used to live in this component's state, so a reload or
    // a second tablet showed an acknowledged change as still waiting. They are
    // read from the event's persisted acknowledgements now.
    const change = requiredChangeFixture();
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetChangesAwaitingAcknowledgement.mockResolvedValue([change]);
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
    mockGetChangesAwaitingAcknowledgement.mockResolvedValue([requiredChangeFixture()]);
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
    mockGetChangesAwaitingAcknowledgement.mockResolvedValue([requiredChangeFixture()]);
    mockListEventChangeAcknowledgements.mockRejectedValue(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
    renderPage();

    expect(await screen.findByText("Guest count changed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Acknowledge change/i })).toBeTruthy();
  });

  it("keeps an acknowledged change gone when a read that set out earlier returns without it", async () => {
    const change = requiredChangeFixture();
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    mockGetChangesAwaitingAcknowledgement.mockResolvedValue([change]);
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
    mockGetChangesAwaitingAcknowledgement.mockResolvedValue([change]);
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

  // hallkeeper-web-6: a status queued after a failure is an older word on the
  // task than any status pressed after it. The device's real queue stands
  // behind the module's mocks here, so what the page queues, lists, replays
  // and acks is what it would keep.
  describe("a queued task status and a later one", () => {
    async function realQueue(): Promise<ReturnType<typeof createEventDayQueue>> {
      const actual = await vi.importActual<typeof import("../lib/event-day-offline-queue.js")>("../lib/event-day-offline-queue.js");
      const queue = actual.createEventDayQueue(withBackend<QueuedEventDayOp>(memoryBackend()));
      mockEnqueueEventDayTaskStatus.mockImplementation((opsTaskId: string, input: UpdateOpsTaskStatusInput) => queue.enqueueTaskStatus(opsTaskId, input));
      mockListPendingEventDayOps.mockImplementation(queue.list);
      mockAckEventDayOp.mockImplementation(queue.ack);
      mockAckEventDayOpIf.mockImplementation(queue.ackIf);
      return queue;
    }

    /** The statuses the queue holds, oldest first. */
    async function queuedStatuses(queue: ReturnType<typeof createEventDayQueue>): Promise<readonly string[]> {
      return (await queue.list()).map((op) => (op.kind === "task_status" ? op.input.status : op.kind));
    }

    /** The statuses sent to the server, in the order sent. */
    function statusesSent(): readonly string[] {
      return mockUpdateOpsTaskStatus.mock.calls.map(([, input]) => (input as { readonly status: string }).status);
    }

    /** Comes back online, and waits for the replay to finish (it reads the board last). */
    async function replayQueue(): Promise<void> {
      const readsBefore = mockGetEventDayOpsBoard.mock.calls.length;
      act(() => { window.dispatchEvent(new Event("online")); });
      await waitFor(() => { expect(mockGetEventDayOpsBoard.mock.calls.length).toBeGreaterThan(readsBefore); });
      await waitFor(() => { expect(screen.getByRole("button", { name: "Sync pending event-day changes" }).getAttribute("aria-busy")).toBe("false"); });
    }

    type Fate = "lands" | "fails" | "refused" | "lost";

    /** The API, as services/event-day-ops.ts answers a status (#418): a key
     *  already recorded changes nothing and answers the task as it stands; a
     *  status replayed against one the task no longer holds is refused, 409
     *  with the task as it stands, and changes nothing, unless the task's last
     *  write was made under one of its earlier-press keys (round four, ruling
     *  A); a status the task already holds changes nothing; anything else is
     *  written and moves the task's updatedAt on. A key meets its fate the
     *  first time it is sent: it lands, fails before it reaches the server, is
     *  refused (403), or is lost (written, and its answer never comes back). A
     *  key sent again (a replay) lands. A request is decided when it is sent,
     *  except a replay held back (lateReplay), decided when it is answered.
     *  Another device writes as it presses. */
    function fakeServer(options: { readonly fateOf?: (status: string) => Fate; readonly lateReplay?: boolean } = {}) {
      let status: OpsTask["status"] = "todo";
      let writes = 0;
      let lastKey: string | null = null;
      const current = (): OpsTask => ({ ...task(status), updatedAt: new Date(Date.parse(NOW) + writes * 1000).toISOString() });
      const recorded = new Set<string>();
      const sentOnce = new Set<string>();
      let requests = 0;
      const write = (key: string, next: OpsTask["status"]): void => {
        if (next === status) return;
        status = next;
        writes += 1;
        lastKey = key;
        recorded.add(key);
      };
      const decide = (input: UpdateOpsTaskStatusInput): OpsTask | ApiError => {
        const key = input.idempotencyKey ?? "";
        if (recorded.has(key)) return current();
        const followsOwnWrite = lastKey !== null && (input.earlierPressKeys ?? []).includes(lastKey);
        if (input.expectedStatus !== undefined && input.expectedStatus !== status && !followsOwnWrite) {
          return new ApiError(409, "This task moved on before this status arrived.", "TASK_STATUS_CONFLICT", { task: current() });
        }
        write(key, input.status);
        return current();
      };
      interface Sent { readonly status: string; readonly replay: boolean; readonly answer: () => void }
      const onTheirWay: Sent[] = [];
      mockUpdateOpsTaskStatus.mockImplementation((_taskId: string, input: UpdateOpsTaskStatusInput) =>
        new Promise<OpsTask>((resolve, reject) => {
          requests += 1;
          const key = input.idempotencyKey ?? "";
          const replay = sentOnce.has(key);
          sentOnce.add(key);
          const fate = replay ? "lands" : (options.fateOf?.(input.status) ?? "lands");
          const give = (decided: OpsTask | ApiError): void => { if (decided instanceof ApiError) reject(decided); else resolve(decided); };
          let answer: () => void;
          if (fate === "fails") {
            answer = () => { reject(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE")); };
          } else if (fate === "refused") {
            answer = () => { reject(new ApiError(403, "Forbidden", "FORBIDDEN")); };
          } else if (fate === "lost") {
            decide(input);
            answer = () => { reject(new ApiError(0, "Network error", "NETWORK_ERROR")); };
          } else if (replay && options.lateReplay === true) {
            answer = () => { give(decide(input)); };
          } else {
            const decided = decide(input);
            answer = () => { give(decided); };
          }
          onTheirWay.push({ status: input.status, replay, answer });
        }));
      mockGetEventDayOpsBoard.mockImplementation(() => {
        const board = boardFixture();
        return Promise.resolve(board.handoffPack === null ? board : { ...board, handoffPack: { ...board.handoffPack, opsTasks: [current()] } });
      });
      const answerWhere = (matches: (sent: Sent) => boolean): void => {
        const index = onTheirWay.findIndex(matches);
        if (index >= 0) onTheirWay.splice(index, 1)[0]?.answer();
      };
      return {
        status: () => status,
        waiting: () => onTheirWay.length,
        /** Every request sent, replays included. */
        requests: () => requests,
        /** The keys sent: one per press; a status sent again under a new key would add one. */
        keys: () => sentOnce.size,
        /** Another device presses this status, and it lands. */
        writeAs: (next: OpsTask["status"]): void => { write(`elsewhere-${String(writes)}`, next); },
        /** The first send of the press with this status, if it is on its way. */
        answerPress: (pressed: string): void => { answerWhere((sent) => !sent.replay && sent.status === pressed); },
        answerReplay: (): void => { answerWhere((sent) => sent.replay); },
        answerAll: (): void => { while (onTheirWay.length > 0) answerWhere(() => true); },
      };
    }

    async function settle(): Promise<void> {
      for (let round = 0; round < 3; round += 1) {
        await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
      }
    }

    /** Lets answers through, then lets the page act on them. */
    async function answer(respond: () => void): Promise<void> {
      act(respond);
      await settle();
    }

    function renderPages(): readonly [HTMLElement, HTMLElement] {
      const page = (): HTMLElement => render(
        <MemoryRouter initialEntries={[`/ops/events/${EVENT_ID}`]}>
          <Routes>
            <Route path="/ops/events/:eventId" element={<EventDayOpsPage />} />
          </Routes>
        </MemoryRouter>,
      ).container;
      return [page(), page()];
    }

    /** The status the board shows for the task. */
    function shownStatus(root: ParentNode = document): string {
      return root.querySelector(".event-day-task span")?.textContent ?? "";
    }

    /** Presses a status on a page (the whole screen when none is given). */
    async function pressOn(label: "Start" | "Done" | "Block", page?: HTMLElement): Promise<void> {
      fireEvent.click((page === undefined ? screen : within(page)).getByRole("button", { name: label }));
      await settle();
    }

    /** Presses Sync on a page and lets its replay and closing read through. */
    async function syncOn(page?: HTMLElement): Promise<void> {
      fireEvent.click((page === undefined ? screen : within(page)).getByRole("button", { name: "Sync pending event-day changes" }));
      await settle();
    }

    /** Unmounts the board and opens it again: a reload, or leaving it and coming back. */
    async function remount(): Promise<void> {
      cleanup();
      renderPage();
      await screen.findByText("Set 12 x Round Table");
    }

    it("never replays it over a later status that reached the server", async () => {
      const queue = await realQueue();
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockUpdateOpsTaskStatus
        .mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))
        .mockResolvedValueOnce(task("done"));
      renderPage();
      await screen.findByText("Set 12 x Round Table");

      fireEvent.click(screen.getByText("Start"));
      await screen.findByText("Task saved on this device and will sync when the connection returns.");
      fireEvent.click(screen.getByText("Done"));
      await screen.findByText("Task status updated.");

      await replayQueue();
      expect(statusesSent()).toEqual(["in_progress", "done"]);
      expect(await queue.list()).toEqual([]);
      expect(screen.getByText("Synced")).toBeTruthy();
    });

    it("does not queue a failed status the person has changed since", async () => {
      const queue = await realQueue();
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      let failStart: ((reason: ApiError) => void) | undefined;
      mockUpdateOpsTaskStatus
        .mockImplementationOnce(() => new Promise<never>((_resolve, reject) => { failStart = reject; }))
        .mockResolvedValueOnce(task("done"));
      renderPage();
      await screen.findByText("Set 12 x Round Table");

      fireEvent.click(screen.getByText("Start"));
      fireEvent.click(screen.getByText("Done"));
      await screen.findByText("Task status updated.");
      // Start's answer arrives last: the connection dropped on it.
      await act(async () => { failStart?.(new ApiError(0, "Network error", "NETWORK_ERROR")); await Promise.resolve(); });
      await waitFor(() => { expect(screen.queryByText("Saving event-day changes…")).toBeNull(); });
      expect(await queue.list()).toEqual([]);

      await replayQueue();
      expect(statusesSent()).toEqual(["in_progress", "done"]);
    });

    it("does not replay it while a later status is still on its way", async () => {
      await realQueue();
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      let landDone: ((updated: OpsTask) => void) | undefined;
      mockUpdateOpsTaskStatus
        .mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))
        .mockImplementationOnce(() => new Promise<OpsTask>((resolve) => { landDone = resolve; }));
      renderPage();
      await screen.findByText("Set 12 x Round Table");

      fireEvent.click(screen.getByText("Start"));
      await screen.findByText("Task saved on this device and will sync when the connection returns.");
      fireEvent.click(screen.getByText("Done"));
      await replayQueue();
      await act(async () => { landDone?.(task("done")); await Promise.resolve(); });
      await screen.findByText("Task status updated.");

      expect(statusesSent()).toEqual(["in_progress", "done"]);
    });

    it("keeps a later status that was queued when an earlier one lands", async () => {
      const queue = await realQueue();
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      let landStart: ((updated: OpsTask) => void) | undefined;
      mockUpdateOpsTaskStatus
        .mockImplementationOnce(() => new Promise<OpsTask>((resolve) => { landStart = resolve; }))
        .mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))
        .mockResolvedValueOnce(task("done"));
      renderPage();
      await screen.findByText("Set 12 x Round Table");

      fireEvent.click(screen.getByText("Start"));
      fireEvent.click(screen.getByText("Done"));
      await screen.findByText("Task saved on this device and will sync when the connection returns.");
      await act(async () => { landStart?.(task("in_progress")); await Promise.resolve(); });
      await waitFor(() => { expect(screen.queryByText("Saving event-day changes…")).toBeNull(); });
      expect((await queue.list()).map((op) => op.kind === "task_status" ? op.input.status : op.kind)).toEqual(["done"]);

      await replayQueue();
      expect(statusesSent()).toEqual(["in_progress", "done", "done"]);
      // #418: the presses went as pressed; the replay goes against what the
      // task held once Start had landed, not against To do.
      expect(mockUpdateOpsTaskStatus.mock.calls.map(([, input]) => (input as UpdateOpsTaskStatusInput).expectedStatus))
        .toEqual([undefined, undefined, "in_progress"]);
      expect(await queue.list()).toEqual([]);
    });

    // #418 B2: the replay of an older status is on its way when a later press
    // fails and is queued in the same row. The replay's ack must leave it.
    it("keeps a later status that failed while an older one was being replayed", async () => {
      const queue = await realQueue();
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      let landReplay: ((updated: OpsTask) => void) | undefined;
      mockUpdateOpsTaskStatus
        .mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))
        .mockImplementationOnce(() => new Promise<OpsTask>((resolve) => { landReplay = resolve; }))
        .mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"))
        .mockResolvedValueOnce(task("done"));
      renderPage();
      await screen.findByText("Set 12 x Round Table");

      fireEvent.click(screen.getByText("Start"));
      await screen.findByText("Task saved on this device and will sync when the connection returns.");
      act(() => { window.dispatchEvent(new Event("online")); });
      await waitFor(() => { expect(statusesSent()).toEqual(["in_progress", "in_progress"]); });
      fireEvent.click(screen.getByText("Done"));
      await waitFor(() => { expect(statusesSent()).toEqual(["in_progress", "in_progress", "done"]); });
      await waitFor(async () => { expect(await queuedStatuses(queue)).toEqual(["done"]); });
      await act(async () => { landReplay?.(task("in_progress")); await Promise.resolve(); });
      await waitFor(() => { expect(screen.getByRole("button", { name: "Sync pending event-day changes" }).getAttribute("aria-busy")).toBe("false"); });
      expect(await queuedStatuses(queue)).toEqual(["done"]);

      await replayQueue();
      expect(statusesSent()).toEqual(["in_progress", "in_progress", "done", "done"]);
      expect(await queue.list()).toEqual([]);
    });

    // #418 B1: two pages (two tabs on one device) over one queue. A page
    // supersedes only what it pressed itself; the other page's row is sent
    // as it was written.
    describe("on two pages over one queue", () => {
      it("keeps the other page's later status queued when this page's earlier one lands", async () => {
        const queue = await realQueue();
        mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
        let landStart: ((updated: OpsTask) => void) | undefined;
        mockUpdateOpsTaskStatus
          .mockImplementationOnce(() => new Promise<OpsTask>((resolve) => { landStart = resolve; }))
          .mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"));
        const [first, second] = renderPages();
        await within(first).findByText("Set 12 x Round Table");
        await within(second).findByText("Set 12 x Round Table");

        fireEvent.click(within(first).getByText("Start"));
        fireEvent.click(within(second).getByText("Done"));
        await within(second).findByText("Task saved on this device and will sync when the connection returns.");
        expect(await queuedStatuses(queue)).toEqual(["done"]);
        await act(async () => { landStart?.(task("in_progress")); await Promise.resolve(); });
        await within(first).findByText("Task status updated.");
        await waitFor(() => { expect(within(first).queryByText("Saving event-day changes…")).toBeNull(); });

        expect(await queuedStatuses(queue)).toEqual(["done"]);
      });

      it("replays the other page's later status from this page's Sync", async () => {
        const queue = await realQueue();
        mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
        mockUpdateOpsTaskStatus
          .mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))
          .mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))
          .mockResolvedValue(task("done"));
        const [first, second] = renderPages();
        await within(first).findByText("Set 12 x Round Table");
        await within(second).findByText("Set 12 x Round Table");

        fireEvent.click(within(first).getByText("Start"));
        await within(first).findByText("Task saved on this device and will sync when the connection returns.");
        fireEvent.click(within(second).getByText("Done"));
        await within(second).findByText("Task saved on this device and will sync when the connection returns.");
        expect(await queuedStatuses(queue)).toEqual(["done"]);

        const reads = mockGetEventDayOpsBoard.mock.calls.length;
        fireEvent.click(within(first).getByRole("button", { name: "Sync pending event-day changes" }));
        await waitFor(() => { expect(mockGetEventDayOpsBoard.mock.calls.length).toBeGreaterThan(reads); });
        expect(statusesSent()).toEqual(["in_progress", "done", "done"]);
        expect(await queue.list()).toEqual([]);
      });
    });

    // Every order of two presses on one page, and of three on the two
    // schedules that strain the rule most, against the server's own rule
    // (fakeServer). Each press lands, fails and is queued, is refused, or is
    // lost (the server wrote it, and the answer never came back). A schedule
    // is the order of events: a press ("p0"), the answer to its first send
    // ("a0", which may come before or after a later press, or its answer),
    // the device coming back online ("d", which replays what is queued), and
    // the answer to that replay ("r"). Every order runs twice: with each
    // request decided as it is sent, and with a replay decided only when it
    // is answered, after any later press that landed meanwhile. At the end
    // the connection is back for good. In every order the server must end on
    // the latest status pressed that it did not refuse, with nothing sent
    // again under a new key and nothing left in the queue. (Round four: the
    // 39 orders with a lost answer before a later press that failed, run as
    // expected failures in round three, now pass: the later press names the
    // lost one's key.)
    describe("every order of presses, answers and a replay", () => {
      interface Order {
        readonly fates: readonly Fate[];
        readonly schedule: readonly string[];
        /** The server decides the replay when it is answered, not when it is
         *  sent: after a later press that may have landed meanwhile. */
        readonly lateReplay: boolean;
      }
      const PRESSES = [
        { label: "Start", status: "in_progress" },
        { label: "Done", status: "done" },
        { label: "Block", status: "blocked" },
      ] as const;
      const FATES: readonly Fate[] = ["lands", "fails", "refused", "lost"];

      function product<T>(lists: readonly (readonly T[])[]): T[][] {
        return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])), [[]]);
      }

      /** Every order of the events for this many presses: presses in turn,
       *  each answer after its press, the replay's answer after the device
       *  comes online, which it does once something has been answered (with
       *  nothing answered the queue is empty and there is nothing to replay). */
      function schedules(presses: number): string[][] {
        const all: string[][] = [];
        const visit = (done: readonly string[], left: readonly string[]): void => {
          if (left.length === 0) all.push([...done]);
          for (const event of left) {
            const index = Number(event.slice(1));
            const ready = event === "d" ? done.some((seen) => seen.startsWith("a"))
              : event === "r" ? done.includes("d")
                : event.startsWith("a") ? done.includes(`p${String(index)}`)
                  : index === 0 || done.includes(`p${String(index - 1)}`);
            if (ready) visit([...done, event], left.filter((other) => other !== event));
          }
        };
        visit([], [...Array.from({ length: presses }, (_, index) => [`p${String(index)}`, `a${String(index)}`]).flat(), "d", "r"]);
        return all;
      }

      const IN_SEND_ORDER: readonly Omit<Order, "lateReplay">[] = [
        ...product([FATES, FATES]).flatMap((fates) => schedules(2).map((schedule) => ({ fates, schedule }))),
        ...product([FATES, FATES, FATES]).flatMap((fates) => [
          // A replay on its way while both later presses are made and answered.
          ["p0", "a0", "d", "p1", "a1", "p2", "a2", "r"],
          // Three presses on their way, answered newest first.
          ["p0", "p1", "p2", "a2", "a1", "a0", "d", "r"],
        ].map((schedule) => ({ fates, schedule }))),
      ];
      const ORDERS: readonly Order[] = [
        ...IN_SEND_ORDER.map((order): Order => ({ ...order, lateReplay: false })),
        ...IN_SEND_ORDER.map((order): Order => ({ ...order, lateReplay: true })),
      ];

      function nameOf(order: Order): string {
        const words = (event: string): string => {
          const label = PRESSES[Number(event.slice(1))]?.label ?? "?";
          if (event === "d") return "online";
          if (event === "r") return "replay answered";
          return event.startsWith("p") ? label : `${label} answered`;
        };
        const fates = order.fates.map((fate, index) => `${PRESSES[index]?.label ?? "?"} ${fate}`).join(", ");
        return `${fates}: ${order.schedule.map(words).join(", ")}${order.lateReplay ? " (replay decided when answered)" : ""}`;
      }

      /** The status the server must end on: the latest press it did not refuse. */
      function lastPressed(order: Order): string {
        return order.fates.map((fate, at) => (fate === "refused" ? null : PRESSES[at]?.status ?? null))
          .filter((status): status is NonNullable<typeof status> => status !== null)
          .at(-1) ?? "todo";
      }

      /** Plays an order through the page and the stand-in server, then lets
       *  the connection back for good. */
      async function runOrder(order: Order): Promise<{
        readonly server: ReturnType<typeof fakeServer>;
        readonly queue: ReturnType<typeof createEventDayQueue>;
      }> {
        const queue = await realQueue();
        const fateByStatus = new Map<string, Fate>(order.fates.map((fate, index) => [PRESSES[index]?.status ?? "", fate]));
        const server = fakeServer({ fateOf: (status) => fateByStatus.get(status) ?? "lands", lateReplay: order.lateReplay });
        renderPage();
        await screen.findByText("Set 12 x Round Table");

        const online = async (): Promise<void> => {
          act(() => { window.dispatchEvent(new Event("online")); });
          await settle();
        };
        for (const event of order.schedule) {
          const press = PRESSES[Number(event.slice(1))];
          if (event === "d") await online();
          else if (event === "r") await answer(server.answerReplay);
          else if (event.startsWith("a")) await answer(() => { server.answerPress(press?.status ?? ""); });
          else await pressOn(press?.label ?? "Start");
        }
        // The connection is back for good.
        await answer(server.answerAll);
        await online();
        await answer(server.answerAll);
        return { server, queue };
      }

      it("runs every order", () => {
        expect(schedules(2)).toHaveLength(12);
        expect(ORDERS).toHaveLength(2 * (16 * 12 + 64 * 2));
      });

      const ends = async (order: Order): Promise<void> => {
        const { server, queue } = await runOrder(order);
        expect(server.waiting()).toBe(0);
        expect(server.status()).toBe(lastPressed(order));
        // Nothing is sent again under a new key: one key per press.
        expect(server.keys()).toBe(order.fates.length);
        expect(await queue.list()).toEqual([]);
      };
      it.each(ORDERS.map((order) => [nameOf(order), order] as const))("%s", async (_name, order) => {
        await ends(order);
      });
    });

    // #418, beyond one page that never reloads: the server decides, so a
    // stale replay is refused whoever queued it and whenever it arrives.
    describe("orders over a reload, another device and two pages", () => {
      it("ends on Done when Start was queued, the board reloaded, and Done landed (P1)", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "fails" : "lands") });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);
        await screen.findByText("Task saved on this device and will sync when the connection returns.");

        await remount();
        await pressOn("Done");
        await answer(server.answerAll);
        await syncOn();
        await answer(server.answerAll);

        expect(server.status()).toBe("done");
        expect(await queue.list()).toEqual([]);
        expect(shownStatus()).toBe("Done");
      });

      it("refuses Start's replay that was on its way when the reloaded board's Done landed", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "fails" : "lands"), lateReplay: true });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);

        await remount();
        await syncOn();
        await pressOn("Done");
        await answer(() => { server.answerPress("done"); });
        await answer(server.answerReplay);
        await answer(server.answerAll);

        expect(server.status()).toBe("done");
        expect(statusesSent()).toEqual(["in_progress", "in_progress", "done"]);
        expect(await queue.list()).toEqual([]);
      });

      it("ends on Done when Start and, after a reload, Done were both queued", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: () => "fails" });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);
        await remount();
        await pressOn("Done");
        await answer(server.answerAll);

        await syncOn();
        await answer(server.answerAll);

        expect(server.status()).toBe("done");
        expect(await queue.list()).toEqual([]);
      });

      it("ends on Done when Start's answer was lost and, after a reload that read it, Done was queued", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "lost" : "fails") });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);
        await remount();
        await pressOn("Done");
        await answer(server.answerAll);

        await syncOn();
        await answer(server.answerAll);

        expect(server.status()).toBe("done");
        expect(await queue.list()).toEqual([]);
      });

      // BA2's X1: another device sets the status Start's replay carries,
      // after this page's Done landed and before the replay arrives.
      it("lets another device's later status stand over a stale replay of the same status, and sends nothing again (X1)", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "fails" : "lands"), lateReplay: true });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);
        act(() => { window.dispatchEvent(new Event("online")); });
        await settle();
        await pressOn("Done");
        await answer(() => { server.answerPress("done"); });

        server.writeAs("in_progress");
        await answer(server.answerReplay);
        await answer(server.answerAll);

        expect(server.status()).toBe("in_progress");
        expect(statusesSent()).toEqual(["in_progress", "in_progress", "done"]);
        expect(server.keys()).toBe(2);
        expect(await queue.list()).toEqual([]);
        await waitFor(() => { expect(shownStatus()).toBe("In progress"); });
      });

      // BA2's X2: as X1, but Start reached the server and its answer was
      // lost, so its replay is answered from the key the server recorded.
      it("lets another device's later status stand when a lost Start's replay is answered from its key, and sends nothing again (X2)", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "lost" : "lands"), lateReplay: true });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);
        act(() => { window.dispatchEvent(new Event("online")); });
        await settle();
        await pressOn("Done");
        await answer(() => { server.answerPress("done"); });

        server.writeAs("in_progress");
        await answer(server.answerReplay);
        await answer(server.answerAll);

        expect(server.status()).toBe("in_progress");
        expect(statusesSent()).toEqual(["in_progress", "in_progress", "done"]);
        expect(server.keys()).toBe(2);
        expect(await queue.list()).toEqual([]);
      });

      it("acks a replay the server refuses because the task moved on, and shows the task as the answer gives it", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "fails" : "lands") });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);
        await screen.findByText("Task saved on this device and will sync when the connection returns.");
        // Another device blocks the task after Start was pressed here.
        server.writeAs("blocked");
        // The closing read never answers: what the board shows is the refusal's.
        mockGetEventDayOpsBoard.mockImplementation(() => new Promise<never>(() => undefined));

        await syncOn();
        await answer(server.answerAll);

        expect(mockUpdateOpsTaskStatus.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ status: "in_progress", expectedStatus: "todo" }));
        expect(server.status()).toBe("blocked");
        expect(await queue.list()).toEqual([]);
        await waitFor(() => { expect(shownStatus()).toBe("Blocked"); });
        // No new words: the notice is the one the press left.
        expect(screen.getByText("Task saved on this device and will sync when the connection returns.")).toBeTruthy();
      });

      // A page that has not read a write made elsewhere: the press made on
      // it is the latest, but its replay is pressed against what the page
      // last read, so the server refuses it and the earlier write stands.
      it("KNOWN LIMIT: refuses a replay pressed on a page that had not yet read another device's earlier write", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "fails" : "lands") });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        server.writeAs("blocked");
        await pressOn("Start");
        await answer(server.answerAll);

        await syncOn();
        await answer(server.answerAll);

        // The last press anywhere was Start; the server keeps Blocked.
        expect(server.status()).toBe("blocked");
        expect(await queue.list()).toEqual([]);
      });

      it("lets another device's block stand over this page's Start queued before it", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "fails" : "lands") });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);
        server.writeAs("blocked");

        await syncOn();
        await answer(server.answerAll);

        expect(server.status()).toBe("blocked");
        expect(await queue.list()).toEqual([]);
      });

      it("ends on Done when one page queued Start and the other page's Done landed after it", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "fails" : "lands") });
        const [first, second] = renderPages();
        await within(first).findByText("Set 12 x Round Table");
        await within(second).findByText("Set 12 x Round Table");
        await pressOn("Start", first);
        await answer(server.answerAll);
        await pressOn("Done", second);
        await answer(server.answerAll);

        await syncOn(first);
        await answer(server.answerAll);

        expect(server.status()).toBe("done");
        expect(await queue.list()).toEqual([]);
      });

      it("refuses one page's replay that was on its way when the other page's Done landed", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "fails" : "lands"), lateReplay: true });
        const [first, second] = renderPages();
        await within(first).findByText("Set 12 x Round Table");
        await within(second).findByText("Set 12 x Round Table");
        await pressOn("Start", first);
        await answer(server.answerAll);
        await syncOn(first);
        await pressOn("Done", second);
        await answer(() => { server.answerPress("done"); });
        await answer(server.answerReplay);
        await answer(server.answerAll);

        expect(server.status()).toBe("done");
        expect(server.keys()).toBe(2);
        expect(await queue.list()).toEqual([]);
      });

      // One page's earlier press is still on its way when the other page's
      // later press fails and is queued against To do; the earlier one then
      // lands, and the later one's replay is refused.
      it("KNOWN LIMIT: refuses a later press queued on one page while an earlier one from the other page was still on its way", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "lands" : "fails") });
        const [first, second] = renderPages();
        await within(first).findByText("Set 12 x Round Table");
        await within(second).findByText("Set 12 x Round Table");
        await pressOn("Start", first);
        await pressOn("Done", second);
        await answer(() => { server.answerPress("done"); });
        await answer(() => { server.answerPress("in_progress"); });

        await syncOn(first);
        await answer(server.answerAll);

        // The last press anywhere was Done; the server keeps In progress.
        expect(server.status()).toBe("in_progress");
        expect(await queue.list()).toEqual([]);
      });

      // Order 4 (round four, ruling A): Start was still on its way when Done
      // failed and was queued against To do; Start then landed and the board
      // reloaded before Sync. The row carries Start's key, and Start wrote
      // the task last, so Done is written.
      it("ends on Done when Done was queued while Start was on its way, Start landed and the board reloaded before Sync (order 4)", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "lands" : "fails") });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await pressOn("Done");
        await answer(() => { server.answerPress("done"); });
        await answer(() => { server.answerPress("in_progress"); });

        await remount();
        await syncOn();
        await answer(server.answerAll);

        expect(server.status()).toBe("done");
        expect(server.keys()).toBe(2);
        expect(await queue.list()).toEqual([]);
        expect(shownStatus()).toBe("Done");
      });

      // Order 1 (round four, ruling A): the hallkeeper's ordinary day on venue
      // Wi-Fi. Start reaches the server and its answer is lost; Done is
      // pressed before the board has read Start, fails, and is queued against
      // To do. It names Start's key, Start wrote the task last, so Done is written.
      it("ends on Done when Start's answer was lost and Done, pressed before the board read Start, was queued (order 1)", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "lost" : "fails") });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);
        await pressOn("Done");
        await answer(server.answerAll);

        await syncOn();
        await answer(server.answerAll);

        const [start, , replay] = mockUpdateOpsTaskStatus.mock.calls.map(([, input]) => input as UpdateOpsTaskStatusInput);
        expect(replay).toEqual(expect.objectContaining({ status: "done", expectedStatus: "todo", earlierPressKeys: [start?.idempotencyKey] }));
        expect(server.status()).toBe("done");
        expect(server.keys()).toBe(2);
        expect(await queue.list()).toEqual([]);
        expect(shownStatus()).toBe("Done");
      });

      it("ends on Done for order 1 across a reload: the queued row keeps Start's key", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "lost" : "fails") });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);
        await pressOn("Done");
        await answer(server.answerAll);

        await remount();
        await syncOn();
        await answer(server.answerAll);

        expect(server.status()).toBe("done");
        expect(await queue.list()).toEqual([]);
      });

      // Order 5, an accepted limit: another device moves the task on and back
      // to the status the queued press was made against, and the older press
      // is written although the other device pressed last.
      it("KNOWN LIMIT: writes a queued press over another device that moved the task on and back to the status it expected (order 5)", async () => {
        const queue = await realQueue();
        const server = fakeServer({ fateOf: (status) => (status === "in_progress" ? "fails" : "lands") });
        renderPage();
        await screen.findByText("Set 12 x Round Table");
        await pressOn("Start");
        await answer(server.answerAll);
        server.writeAs("blocked");
        server.writeAs("todo");

        await syncOn();
        await answer(server.answerAll);

        // The last press anywhere was the other device's To do; the server holds In progress.
        expect(server.status()).toBe("in_progress");
        expect(await queue.list()).toEqual([]);
      });
    });

    it("sends a replay as it used to while the API has not caught up with the fields it was pressed with", async () => {
      const queue = await realQueue();
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockUpdateOpsTaskStatus
        .mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))
        .mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))
        // The API before #418: its body schema is strict, and names the keys it does not know.
        .mockRejectedValueOnce(new ApiError(400, "Validation failed", "VALIDATION_ERROR", [
          { code: "unrecognized_keys", keys: ["expectedStatus", "earlierPressKeys"], path: [], message: "Unrecognized keys: \"expectedStatus\", \"earlierPressKeys\"" },
        ]))
        .mockResolvedValueOnce(task("done"));
      renderPage();
      await screen.findByText("Set 12 x Round Table");
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
      await screen.findByText("Task saved on this device and will sync when the connection returns.");
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => { expect(mockUpdateOpsTaskStatus).toHaveBeenCalledTimes(2); });
      await waitFor(() => { expect(screen.queryByText("Saving event-day changes…")).toBeNull(); });

      await replayQueue();

      const [start, , replay, asBefore] = mockUpdateOpsTaskStatus.mock.calls.map(([, input]) => input as UpdateOpsTaskStatusInput);
      expect(replay).toEqual({ status: "done", idempotencyKey: replay?.idempotencyKey, expectedStatus: "todo", earlierPressKeys: [start?.idempotencyKey] });
      expect(asBefore).toEqual({ status: "done", idempotencyKey: replay?.idempotencyKey });
      expect(mockUpdateOpsTaskStatus).toHaveBeenCalledTimes(4);
      expect(await queue.list()).toEqual([]);
    });

    // Ruling C: the bridge fires on nothing but the older API's own refusal.
    it.each([
      ["another kind of issue about the field", new ApiError(400, "Validation failed", "VALIDATION_ERROR", [
        { code: "invalid_value", path: ["expectedStatus"], message: "Invalid option" },
      ])],
      ["the unknown-key issue under another code", new ApiError(400, "Bad request", "BAD_REQUEST", [
        { code: "unrecognized_keys", keys: ["expectedStatus"], path: [], message: "Unrecognized key: \"expectedStatus\"" },
      ])],
      ["unknown keys that are not the field", new ApiError(400, "Validation failed", "VALIDATION_ERROR", [
        { code: "unrecognized_keys", keys: ["earlierPressKeys"], path: [], message: "Unrecognized key: \"earlierPressKeys\"" },
      ])],
      ["no issues at all", new ApiError(400, "Validation failed", "VALIDATION_ERROR")],
    ])("does not send a replay again on any other 400: %s", async (_case, refusal) => {
      const queue = await realQueue();
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockUpdateOpsTaskStatus
        .mockRejectedValueOnce(new ApiError(503, "Unavailable", "SERVICE_UNAVAILABLE"))
        .mockRejectedValueOnce(refusal)
        .mockResolvedValue(task("in_progress"));
      renderPage();
      await screen.findByText("Set 12 x Round Table");
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
      await screen.findByText("Task saved on this device and will sync when the connection returns.");

      await replayQueue();

      expect(mockUpdateOpsTaskStatus).toHaveBeenCalledTimes(2);
      // Refused like any other refusal: acked, and the press has no word.
      expect(await queue.list()).toEqual([]);
    });

    it("replays a row queued before replays carried a status, without one", async () => {
      const queue = await realQueue();
      await queue.enqueueTaskStatus(TASK_ID, { status: "done", idempotencyKey: "queued-by-an-older-page" });
      mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
      mockUpdateOpsTaskStatus.mockResolvedValue(task("done"));
      renderPage();
      await screen.findByText("Set 12 x Round Table");

      await replayQueue();

      expect(mockUpdateOpsTaskStatus.mock.calls.map(([, input]) => input as UpdateOpsTaskStatusInput))
        .toEqual([{ status: "done", idempotencyKey: "queued-by-an-older-page" }]);
      expect(await queue.list()).toEqual([]);
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ChangeFeedItem, EventDayIssue, EventDayOpsBoard, OpsTask } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { EventDayOpsPage } from "../pages/EventDayOpsPage.js";

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
  mockAcknowledgeEventPlanChange,
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
  mockAcknowledgeEventPlanChange: vi.fn(),
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

vi.mock("../api/notifications.js", () => ({
  getEventChangeFeed: mockGetEventChangeFeed,
  acknowledgeEventPlanChange: mockAcknowledgeEventPlanChange,
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

beforeEach(() => {
  mockGetEventDayOpsBoard.mockReset();
  mockUpdateOpsTaskStatus.mockReset();
  mockCreateEventDayIssue.mockReset();
  mockUpdateEventDayIssue.mockReset();
  mockGetEventChangeFeed.mockReset();
  mockAcknowledgeEventPlanChange.mockReset();
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

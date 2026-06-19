import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ChangeFeedItem, EventDayOpsBoard, OpsTask } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { EventDayOpsPage } from "../pages/EventDayOpsPage.js";

const {
  mockGetEventDayOpsBoard,
  mockUpdateOpsTaskStatus,
  mockCreateEventDayIssue,
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
  it("renders the mobile event-day board sections", async () => {
    mockGetEventDayOpsBoard.mockResolvedValue(boardFixture());
    renderPage();

    expect(await screen.findByText("Blake event day")).toBeTruthy();
    expect(screen.getByText("Phase timeline")).toBeTruthy();
    expect(screen.getByText("Setup progress")).toBeTruthy();
    expect(screen.getByText("Task checklist")).toBeTruthy();
    expect(screen.getByText("Issue report")).toBeTruthy();
    expect(screen.getByText("Supplier arrivals")).toBeTruthy();
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

import { describe, expect, it } from "vitest";
import {
  CreateEventDayIssueInputSchema,
  EventDayOpsBoardSchema,
  EventDaySafeTextSchema,
  UpdateEventDayIssueInputSchema,
  UpdateOpsTaskStatusInputSchema,
  type EventDayOpsBoard,
} from "../event-day-ops.js";

const NOW = "2026-06-12T09:00:00.000Z";
const HASH = "a".repeat(64);

function boardFixture(): EventDayOpsBoard {
  return {
    event: {
      id: "00000000-0000-4000-8000-000000001001",
      venueId: "00000000-0000-4000-8000-000000001002",
      createdBy: "00000000-0000-4000-8000-000000001003",
      name: "Wedding event day",
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
    phases: [],
    handoffPack: null,
    assignments: [],
    issues: [{
      id: "00000000-0000-4000-8000-000000001004",
      eventId: "00000000-0000-4000-8000-000000001001",
      phaseId: null,
      opsTaskId: null,
      title: "Supplier late",
      detail: "Catering arrival is ten minutes behind the planning window.",
      status: "open",
      severity: "attention",
      source: "hallkeeper",
      reportedBy: "00000000-0000-4000-8000-000000001003",
      assignedTo: null,
      escalationNote: null,
      createdAt: NOW,
      updatedAt: NOW,
      resolvedAt: null,
    }],
    statusUpdates: [],
    setupProgress: {
      totalTasks: 0,
      doneTasks: 0,
      blockedTasks: 0,
      activeTasks: 0,
      percent: 0,
    },
    supplierArrivals: [],
    escalationNotes: [],
    changesSinceLastHandoff: {
      handoffPackId: null,
      summary: "No compiled handoff pack is linked to this event yet.",
      added: [],
      removed: [],
      changed: [],
      currentSnapshotHash: null,
      previousSnapshotHash: null,
    },
    sourceStatus: "missing_handoff",
  };
}

describe("event-day ops contracts", () => {
  it("accepts the mobile board missing-handoff safe state", () => {
    expect(EventDayOpsBoardSchema.safeParse(boardFixture()).success).toBe(true);
  });

  it("accepts task status updates with idempotency keys", () => {
    const result = UpdateOpsTaskStatusInputSchema.safeParse({
      status: "done",
      idempotencyKey: "tablet-queue-1",
      note: "Completed during setup.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts issue creation and rejects empty issue updates", () => {
    expect(CreateEventDayIssueInputSchema.safeParse({
      title: "Late supplier",
      detail: "Supplier has not arrived inside the planning window.",
      severity: "urgent",
    }).success).toBe(true);

    expect(UpdateEventDayIssueInputSchema.safeParse({}).success).toBe(false);
  });

  it("blocks unsafe event-day language", () => {
    const unsafe = EventDaySafeTextSchema.safeParse("This layout is certified safe.");
    expect(unsafe.success).toBe(false);
  });

  it("requires valid snapshot hashes in changes since handoff", () => {
    const board = boardFixture();
    const result = EventDayOpsBoardSchema.safeParse({
      ...board,
      changesSinceLastHandoff: {
        ...board.changesSinceLastHandoff,
        currentSnapshotHash: HASH,
      },
    });
    expect(result.success).toBe(true);
  });
});

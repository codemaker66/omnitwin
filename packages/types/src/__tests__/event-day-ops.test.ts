import { describe, expect, it } from "vitest";
import {
  CreateEventDayIssueInputSchema,
  EventDayOpsBoardSchema,
  EventDaySafeTextSchema,
  UpdateEventDayIssueInputSchema,
  MAX_EARLIER_PRESS_KEYS,
  UpdateOpsTaskStatusConflictSchema,
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

  // #418: a status queued offline carries the status the task held when it
  // was pressed; the server refuses its replay (409, with the task as it
  // stands) once the task has moved on. A live press carries none.
  it("carries, optionally, the known status a queued press was made against", () => {
    expect(UpdateOpsTaskStatusInputSchema.safeParse({
      status: "done",
      idempotencyKey: "tablet-queue-1",
      expectedStatus: "in_progress",
    }).success).toBe(true);
    expect(UpdateOpsTaskStatusInputSchema.parse({ status: "done" }).expectedStatus).toBeUndefined();
    expect(UpdateOpsTaskStatusInputSchema.safeParse({ status: "done", expectedStatus: "fire approved" }).success).toBe(false);
  });

  // #418 round four, ruling A: and the keys of the device's earlier presses
  // for the task, at most MAX_EARLIER_PRESS_KEYS, each a key as the device makes them.
  it("carries, optionally, up to twenty earlier press keys, each a key as the device makes them", () => {
    const keys = Array.from({ length: MAX_EARLIER_PRESS_KEYS }, (_, index) => `event-day:task:done:${String(index)}`);
    expect(MAX_EARLIER_PRESS_KEYS).toBe(20);
    expect(UpdateOpsTaskStatusInputSchema.safeParse({ status: "done", expectedStatus: "todo", earlierPressKeys: keys }).success).toBe(true);
    expect(UpdateOpsTaskStatusInputSchema.safeParse({ status: "done", expectedStatus: "todo", earlierPressKeys: [] }).success).toBe(true);
    expect(UpdateOpsTaskStatusInputSchema.safeParse({ status: "done", earlierPressKeys: [...keys, "one-more"] }).success).toBe(false);
    expect(UpdateOpsTaskStatusInputSchema.safeParse({ status: "done", earlierPressKeys: ["k".repeat(161)] }).success).toBe(false);
    expect(UpdateOpsTaskStatusInputSchema.safeParse({ status: "done", earlierPressKeys: [" "] }).success).toBe(false);
  });

  it("answers a refused replay with the task as it stands, and nothing else", () => {
    const task = {
      id: "00000000-0000-4000-8000-000000001010",
      handoffPackId: "00000000-0000-4000-8000-000000001011",
      taskGroupId: null,
      phaseId: null,
      kind: "setup",
      title: "Set 12 x Round Table",
      detail: "Place in Centre during Furniture.",
      status: "done",
      sortOrder: 0,
      dueLabel: null,
      sourceRef: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(UpdateOpsTaskStatusConflictSchema.parse({ task })).toEqual({ task });
    expect(UpdateOpsTaskStatusConflictSchema.safeParse({}).success).toBe(false);
    expect(UpdateOpsTaskStatusConflictSchema.safeParse({ task, extra: true }).success).toBe(false);
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

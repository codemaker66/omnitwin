import { describe, expect, it } from "vitest";
import { memoryBackend, withBackend } from "../idb-cache.js";
import { createEventDayQueue, type QueuedEventDayOp } from "../event-day-offline-queue.js";

function queue() {
  return createEventDayQueue(withBackend<QueuedEventDayOp>(memoryBackend()));
}

describe("event-day offline queue", () => {
  it("keeps last task status intent per task", async () => {
    const q = queue();
    await q.enqueueTaskStatus("task-1", { status: "in_progress", idempotencyKey: "a" });
    await q.enqueueTaskStatus("task-1", { status: "done", idempotencyKey: "b" });

    const pending = await q.list();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: "task_status",
      opsTaskId: "task-1",
      input: { status: "done", idempotencyKey: "b" },
    });
  });

  it("does not collapse separate issue reports", async () => {
    const q = queue();
    await q.enqueueIssueCreate("event-1", {
      title: "Supplier late",
      detail: "Supplier has not reached the loading bay.",
      severity: "attention",
    }, "issue-a");
    await q.enqueueIssueCreate("event-1", {
      title: "Lift unavailable",
      detail: "Use the north stair until staff confirm the lift is available.",
      severity: "urgent",
    }, "issue-b");

    const pending = await q.list();
    expect(pending).toHaveLength(2);
    expect(pending.map((op) => op.kind)).toEqual(["issue_create", "issue_create"]);
  });

  it("acks queued operations by stable queue key", async () => {
    const q = queue();
    await q.enqueueTaskStatus("task-1", { status: "done", idempotencyKey: "a" });
    const [pending] = await q.list();
    expect(pending).toBeDefined();
    await q.ack(pending?.queueKey ?? "");
    expect(await q.list()).toEqual([]);
  });
});

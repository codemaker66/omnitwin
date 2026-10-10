import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryBackend, withBackend } from "../idb-cache.js";
import { createEventDayQueue, type QueuedEventDayOp } from "../event-day-offline-queue.js";

function queue() {
  return createEventDayQueue(withBackend<QueuedEventDayOp>(memoryBackend()));
}

const BOOKING = "00000000-0000-4000-8000-00000000b001";
const VENUE = "00000000-0000-4000-8000-00000000a001";
const KEY_A = "00000000-0000-4000-8000-00000000c001";
const KEY_B = "00000000-0000-4000-8000-00000000c002";
const DOORS_OPEN = { bookingId: BOOKING, kind: "doors-open" as const, observedAt: "2026-10-10T18:52:00.000Z", idempotencyKey: KEY_A };
const LIVE = { bookingId: BOOKING, kind: "live" as const, observedAt: "2026-10-10T19:05:00.000Z", idempotencyKey: KEY_B };

afterEach(() => {
  vi.useRealTimers();
});

describe("event-day offline queue", () => {
  // Goal 19 S5 — observations through the queue (D10): a tap keeps its own
  // key and its own time, replays in the order it was made, and is acked only
  // once the server has it.
  it("keeps one observation per tap key, in the order the taps were made", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T18:52:10.000Z"));
    const q = queue();
    await q.enqueueObservationRecord(VENUE, DOORS_OPEN);
    vi.setSystemTime(new Date("2026-10-10T19:05:10.000Z"));
    await q.enqueueObservationRecord(VENUE, LIVE);
    // The same tap pressed twice while offline is one op.
    await q.enqueueObservationRecord(VENUE, DOORS_OPEN);

    const pending = await q.list();
    expect(pending.map((op) => op.kind)).toEqual(["observation_record", "observation_record"]);
    expect(pending.map((op) => (op.kind === "observation_record" ? op.input.kind : null))).toEqual(["doors-open", "live"]);
    expect(pending[0]).toMatchObject({ queueKey: `observation:${KEY_A}`, venueId: VENUE, queuedAt: "2026-10-10T18:52:10.000Z" });
  });

  it("drains in order, acks what the server has, and stops at the first failure so order is kept", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T18:52:10.000Z"));
    const q = queue();
    await q.enqueueObservationRecord(VENUE, DOORS_OPEN);
    vi.setSystemTime(new Date("2026-10-10T19:05:10.000Z"));
    await q.enqueueObservationRecord(VENUE, LIVE);

    // Still offline: the first replay fails and nothing is acked.
    const failing = await q.drain(async () => { throw new Error("offline"); });
    expect(failing).toEqual([]);
    expect(await q.list()).toHaveLength(2);

    // The first reaches the server, the second does not: the first is acked,
    // the second keeps its key and its tap time for the next attempt.
    const sent: string[] = [];
    const partial = await q.drain(async (op) => {
      if (op.kind !== "observation_record") throw new Error("unexpected op");
      sent.push(op.input.idempotencyKey);
      if (op.input.idempotencyKey === KEY_B) throw new Error("socket closed");
      return "applied";
    });
    expect(partial.map((op) => op.queueKey)).toEqual([`observation:${KEY_A}`]);
    const left = await q.list();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      queueKey: `observation:${KEY_B}`,
      input: { idempotencyKey: KEY_B, observedAt: "2026-10-10T19:05:00.000Z" },
    });

    // Back online: the replay carries the same key, so a fact the server
    // already has is the same fact, not a second one.
    const rest = await q.drain(async () => "replayed");
    expect(rest).toHaveLength(1);
    expect(await q.list()).toEqual([]);
    expect(sent).toEqual([KEY_A, KEY_B]);
  });

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

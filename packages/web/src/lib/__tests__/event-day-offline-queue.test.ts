import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryBackend, withBackend } from "../idb-cache.js";
import { createEventDayQueue, type QueuedEventDayOp, type RequestStepInput } from "../event-day-offline-queue.js";

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
    const failing = await q.drain(() => Promise.reject(new Error("offline")));
    expect(failing).toEqual([]);
    expect(await q.list()).toHaveLength(2);

    // The first reaches the server, the second does not: the first is acked,
    // the second keeps its key and its tap time for the next attempt.
    const sent: string[] = [];
    const partial = await q.drain((op) => {
      if (op.kind !== "observation_record") return Promise.reject(new Error("unexpected op"));
      sent.push(op.input.idempotencyKey);
      if (op.input.idempotencyKey === KEY_B) return Promise.reject(new Error("socket closed"));
      return Promise.resolve("applied" as const);
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
    const rest = await q.drain(() => Promise.resolve("replayed" as const));
    expect(rest).toHaveLength(1);
    expect(await q.list()).toEqual([]);
    expect(sent).toEqual([KEY_A, KEY_B]);
  });

  it("leaves another screen's ops in place and drops a fact the server refused for good", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T18:00:00.000Z"));
    const q = queue();
    await q.enqueueTaskStatus("task-1", { status: "done", idempotencyKey: "a" });
    vi.setSystemTime(new Date("2026-10-10T18:52:10.000Z"));
    await q.enqueueObservationRecord(VENUE, DOORS_OPEN);
    vi.setSystemTime(new Date("2026-10-10T19:05:10.000Z"));
    await q.enqueueObservationRecord(VENUE, LIVE);

    // The board drains facts only: the task is left, the first fact is
    // refused by the server (its booking is gone) and dropped, the second
    // reaches the server.
    const acked = await q.drain((op) => {
      if (op.kind !== "observation_record") return Promise.resolve("left" as const);
      return Promise.resolve(op.input.idempotencyKey === KEY_A ? ("refused" as const) : ("applied" as const));
    });
    expect(acked.map((op) => op.queueKey)).toEqual([`observation:${KEY_A}`, `observation:${KEY_B}`]);
    const left = await q.list();
    expect(left.map((op) => op.kind)).toEqual(["task_status"]);
  });

  // L9 — steps on a floor request through the queue: every press is kept,
  // each under the key it was pressed with, in the order pressed, with who
  // pressed it; the Day Board's provider replays them and leaves the rest.
  const REQUEST = "00000000-0000-4000-8000-00000000d001";
  const SEEN = "00000000-0000-4000-8000-00000000e001";
  const TAKE = "00000000-0000-4000-8000-00000000e002";
  const step = (commandId: string, transition: RequestStepInput["transition"]): RequestStepInput => ({
    venueId: VENUE, requestId: REQUEST, bookingId: BOOKING, summary: "Chairs × 10", transition, expectedState: "sent", expectedOwnerUserId: null, commandId,
    authorUserId: "00000000-0000-4000-8000-0000000000ff", authorName: "Elaine",
  });

  it("keeps every step on a request, each under its own key, in the order pressed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T18:40:00.000Z"));
    const q = queue();
    await q.enqueueRequestStep(step(SEEN, { to: "acknowledged" }));
    vi.setSystemTime(new Date("2026-10-29T18:40:05.000Z"));
    await q.enqueueRequestStep(step(TAKE, { to: "accepted" }));
    // The same press stored again is one op, and keeps its first place.
    vi.setSystemTime(new Date("2026-10-29T18:41:00.000Z"));
    await q.enqueueRequestStep(step(SEEN, { to: "acknowledged" }));

    const pending = await q.list();
    expect(pending.map((op) => op.queueKey)).toEqual([`request:${SEEN}`, `request:${TAKE}`]);
    expect(pending[0]).toMatchObject({
      kind: "request_step", requestId: REQUEST, commandId: SEEN, transition: { to: "acknowledged" },
      authorName: "Elaine", queuedAt: "2026-10-29T18:40:00.000Z",
    });
  });

  it("keeps the order pressed when the clock stands still, steps back, or the page reloads", async () => {
    const DONE = "00000000-0000-4000-8000-00000000e003";
    const NOT_NEEDED = "00000000-0000-4000-8000-00000000e004";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T18:40:00.000Z"));
    const backend = withBackend<QueuedEventDayOp>(memoryBackend());
    const q = createEventDayQueue(backend);
    // Two presses stored at once, under a clock that does not move.
    await Promise.all([
      q.enqueueRequestStep(step(SEEN, { to: "acknowledged" })),
      q.enqueueRequestStep(step(TAKE, { to: "accepted" })),
    ]);
    // The clock steps back before the next press.
    vi.setSystemTime(new Date("2026-10-29T18:39:00.000Z"));
    await q.enqueueRequestStep(step(DONE, { to: "resolved", outcome: "done" }));
    // The page reloads: a new queue over the same store, the clock still back.
    const reloaded = createEventDayQueue(backend);
    await reloaded.enqueueRequestStep(step(NOT_NEEDED, { to: "resolved", outcome: "no_longer_needed" }));

    const pending = await reloaded.list();
    expect(pending.map((op) => op.queueKey)).toEqual([SEEN, TAKE, DONE, NOT_NEEDED].map((id) => `request:${id}`));
    const stamps = pending.map((op) => op.queuedAt);
    expect(new Set(stamps).size).toBe(4);
    expect(stamps[0]).toBe("2026-10-29T18:40:00.000Z");
  });

  it("replays steps in order, drops one the server refused, and keeps the rest for their drainer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T18:40:00.000Z"));
    const q = queue();
    await q.enqueueRequestStep(step(SEEN, { to: "acknowledged" }));
    vi.setSystemTime(new Date("2026-10-29T18:40:05.000Z"));
    await q.enqueueObservationRecord(VENUE, DOORS_OPEN);
    vi.setSystemTime(new Date("2026-10-29T18:40:10.000Z"));
    await q.enqueueRequestStep(step(TAKE, { to: "accepted" }));

    const sent: string[] = [];
    const acked = await q.drain((op) => {
      if (op.kind !== "request_step") return Promise.resolve("left" as const);
      sent.push(op.commandId);
      // Someone else took it first: refused for good, so it leaves the queue.
      return Promise.resolve(op.commandId === TAKE ? ("refused" as const) : ("applied" as const));
    });
    expect(sent).toEqual([SEEN, TAKE]);
    expect(acked.map((op) => op.queueKey)).toEqual([`request:${SEEN}`, `request:${TAKE}`]);
    expect((await q.list()).map((op) => op.kind)).toEqual(["observation_record"]);
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

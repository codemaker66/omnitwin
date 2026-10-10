import type { CreateEventDayIssueInput, RecordObservation, UpdateOpsTaskStatusInput } from "@omnitwin/types";
import { openCache, type CacheHandle } from "./idb-cache.js";

// ---------------------------------------------------------------------------
// event-day-offline-queue
//
// Mobile ops staff can lose WiFi during setup. This queue mirrors the
// hallkeeper progress queue: failed status/issue writes are stored in IndexedDB
// and replayed when the device is online again. Task status is last-write-wins
// per task; issue creation keeps every queued issue.
// ---------------------------------------------------------------------------

export type QueuedEventDayOp =
  | {
    readonly kind: "task_status";
    readonly queueKey: string;
    readonly opsTaskId: string;
    readonly input: UpdateOpsTaskStatusInput;
    readonly queuedAt: string;
  }
  | {
    readonly kind: "issue_create";
    readonly queueKey: string;
    readonly eventId: string;
    readonly input: CreateEventDayIssueInput;
    readonly queuedAt: string;
  }
  | {
    /** Goal 19 S5: a fact about the room, tapped while offline. The key was
     *  minted at the tap, so the replay is the same fact; observedAt is the
     *  tap's own (corrected) time, never the replay's. */
    readonly kind: "observation_record";
    readonly queueKey: string;
    readonly venueId: string;
    readonly input: RecordObservation;
    readonly queuedAt: string;
  };

/** What the server said when a replayed op reached it. */
export type EventDayOpOutcome = "applied" | "replayed";

const DB_NAME = "omnitwin-event-day";
const STORE_NAME = "ops-queue";

function taskKey(opsTaskId: string): string {
  return `task:${opsTaskId}`;
}

function issueKey(clientOperationId: string): string {
  return `issue:${clientOperationId}`;
}

function observationKey(idempotencyKey: string): string {
  return `observation:${idempotencyKey}`;
}

function makeClientOperationId(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

let cachedHandle: CacheHandle<QueuedEventDayOp> | null = null;
function queueCache(): CacheHandle<QueuedEventDayOp> {
  if (cachedHandle !== null) return cachedHandle;
  cachedHandle = openCache<QueuedEventDayOp>({ dbName: DB_NAME, storeName: STORE_NAME });
  return cachedHandle;
}

export function createEventDayQueue(handle: CacheHandle<QueuedEventDayOp>) {
  async function list(): Promise<readonly QueuedEventDayOp[]> {
    const rows = await handle.list();
    return rows
      .map((row) => row.stored.value)
      .slice()
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  async function ack(queueKey: string): Promise<void> {
    await handle.delete(queueKey);
  }

  return {
    async enqueueTaskStatus(opsTaskId: string, input: UpdateOpsTaskStatusInput): Promise<void> {
      const key = taskKey(opsTaskId);
      const idempotencyKey = input.idempotencyKey ?? makeClientOperationId("task");
      await handle.put(key, {
        kind: "task_status",
        queueKey: key,
        opsTaskId,
        input: { ...input, idempotencyKey },
        queuedAt: new Date().toISOString(),
      });
    },

    async enqueueIssueCreate(
      eventId: string,
      input: CreateEventDayIssueInput,
      clientOperationId = makeClientOperationId("issue"),
    ): Promise<void> {
      const key = issueKey(clientOperationId);
      await handle.put(key, {
        kind: "issue_create",
        queueKey: key,
        eventId,
        input,
        queuedAt: new Date().toISOString(),
      });
    },

    /** A tap about the room (goal 19 S5). Keyed by the tap's own key, so the
     *  same tap pressed twice while offline is one op, and the replay is the
     *  same fact the server would have had online. */
    async enqueueObservationRecord(venueId: string, input: RecordObservation): Promise<void> {
      const key = observationKey(input.idempotencyKey);
      // A second press keeps the first press's place in the replay order.
      const existing = await handle.get(key);
      await handle.put(key, {
        kind: "observation_record",
        queueKey: key,
        venueId,
        input,
        queuedAt: existing?.value.queuedAt ?? new Date().toISOString(),
      });
    },

    list,
    ack,

    /** Replay in the order the ops were made. An op is acked only once the
     *  server has it, fresh or replayed; the first failure stops the drain so
     *  the order is kept for the next attempt. Returns what was acked. */
    async drain(
      perform: (op: QueuedEventDayOp) => Promise<EventDayOpOutcome>,
    ): Promise<readonly QueuedEventDayOp[]> {
      const acked: QueuedEventDayOp[] = [];
      for (const op of await list()) {
        try {
          await perform(op);
        } catch {
          break;
        }
        await ack(op.queueKey);
        acked.push(op);
      }
      return acked;
    },
  } as const;
}

const defaultQueue = createEventDayQueue(queueCache());

export function enqueueEventDayTaskStatus(
  opsTaskId: string,
  input: UpdateOpsTaskStatusInput,
): Promise<void> {
  return defaultQueue.enqueueTaskStatus(opsTaskId, input);
}

export function enqueueEventDayIssueCreate(
  eventId: string,
  input: CreateEventDayIssueInput,
): Promise<void> {
  return defaultQueue.enqueueIssueCreate(eventId, input);
}

export function enqueueEventDayObservation(venueId: string, input: RecordObservation): Promise<void> {
  return defaultQueue.enqueueObservationRecord(venueId, input);
}

export function listPendingEventDayOps(): Promise<readonly QueuedEventDayOp[]> {
  return defaultQueue.list();
}

export function ackEventDayOp(queueKey: string): Promise<void> {
  return defaultQueue.ack(queueKey);
}

export function drainEventDayOps(
  perform: (op: QueuedEventDayOp) => Promise<EventDayOpOutcome>,
): Promise<readonly QueuedEventDayOp[]> {
  return defaultQueue.drain(perform);
}

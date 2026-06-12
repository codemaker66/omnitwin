import type { CreateEventDayIssueInput, UpdateOpsTaskStatusInput } from "@omnitwin/types";
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
  };

const DB_NAME = "omnitwin-event-day";
const STORE_NAME = "ops-queue";

function taskKey(opsTaskId: string): string {
  return `task:${opsTaskId}`;
}

function issueKey(clientOperationId: string): string {
  return `issue:${clientOperationId}`;
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

    async list(): Promise<readonly QueuedEventDayOp[]> {
      const rows = await handle.list();
      return rows
        .map((row) => row.stored.value)
        .slice()
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    },

    async ack(queueKey: string): Promise<void> {
      await handle.delete(queueKey);
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

export function listPendingEventDayOps(): Promise<readonly QueuedEventDayOp[]> {
  return defaultQueue.list();
}

export function ackEventDayOp(queueKey: string): Promise<void> {
  return defaultQueue.ack(queueKey);
}

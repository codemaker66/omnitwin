import { openCache, type CacheHandle } from "./idb-cache.js";

// ---------------------------------------------------------------------------
// progress-sync-queue — offline-resilient checkbox state syncer
//
// The hallkeeper tablet uses `PATCH /hallkeeper/:configId/progress`
// to toggle a row's checkbox state. When the WiFi drops mid-setup
// (common in older venues), each of those PATCH calls fails. Before
// this queue, the toggle was lost — the optimistic UI flip stayed
// but the server never heard about it, so another hallkeeper loading
// the same sheet didn't see the check.
//
// Design:
//   - On toggle, the HallkeeperPage attempts the PATCH immediately.
//   - If the PATCH rejects (network error / 5xx), the operation is
//     enqueued to IndexedDB under `{configId}:{rowKey}`.
//   - A `flushPendingProgress` call (fired on `online` events + on
//     mount) drains the queue by re-issuing each PATCH.
//   - Successful re-issues delete the queue entry.
//
// The queue value shape is `{ configId, rowKey, desiredChecked,
// queuedAt }`. Toggling the same row twice while offline collapses
// to a single queued state (last-write-wins on the same IDB key).
// ---------------------------------------------------------------------------

export interface QueuedProgressOp {
  readonly configId: string;
  readonly rowKey: string;
  /**
   * The user's INTENT: `true` = should be checked, `false` = should
   * be unchecked. Replaying the PATCH converges to this state; the
   * server's own toggle semantics handle the delta.
   */
  readonly desiredChecked: boolean;
  readonly queuedAt: string;
}

const DB_NAME = "omnitwin-hallkeeper";
const STORE_NAME = "progress-queue";

function keyFor(configId: string, rowKey: string): string {
  return `${configId}:${rowKey}`;
}

/**
 * Open the progress-queue cache. Lazy-instantiated once per module
 * load; the handle is stateless so a singleton is fine.
 */
let cachedHandle: CacheHandle<QueuedProgressOp> | null = null;
function queueCache(): CacheHandle<QueuedProgressOp> {
  if (cachedHandle !== null) return cachedHandle;
  cachedHandle = openCache<QueuedProgressOp>({ dbName: DB_NAME, storeName: STORE_NAME });
  return cachedHandle;
}

/** Enqueue a failed progress toggle for later replay. */
export async function enqueueProgress(
  configId: string,
  rowKey: string,
  desiredChecked: boolean,
): Promise<void> {
  await queueCache().put(keyFor(configId, rowKey), {
    configId,
    rowKey,
    desiredChecked,
    queuedAt: new Date().toISOString(),
  });
}

/** List everything currently queued. Primarily for the flush loop + debug UI. */
export async function listPendingProgress(): Promise<readonly QueuedProgressOp[]> {
  const rows = await queueCache().list();
  return rows.map((r) => r.stored.value);
}

/** Remove a queued entry after a successful replay. */
export async function ackProgress(configId: string, rowKey: string): Promise<void> {
  await queueCache().delete(keyFor(configId, rowKey));
}

/**
 * Pure helper — given a set of queued operations and the current
 * known server state, decide which ones still need replaying. An op
 * is a no-op when the server already reflects its desiredChecked.
 *
 * Kept pure so it's unit-testable without the IDB handle.
 */
export function opsStillNeedingReplay(
  queued: readonly QueuedProgressOp[],
  serverChecked: ReadonlySet<string>,
): readonly QueuedProgressOp[] {
  return queued.filter((op) => {
    const isCurrentlyChecked = serverChecked.has(op.rowKey);
    return isCurrentlyChecked !== op.desiredChecked;
  });
}

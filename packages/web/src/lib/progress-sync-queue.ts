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

/**
 * Split the queue against AUTHORITATIVE server state into the ops that
 * still need a PATCH (`replay` — server differs from intent) and the
 * ops the server already satisfies (`converged` — safe to drop without
 * touching the network).
 *
 * `serverChecked` MUST be freshly fetched server truth, never the
 * optimistic local UI state. Feeding it optimistic state classifies
 * every op as already-converged and silently discards offline edits —
 * the exact data-loss bug this partition exists to prevent.
 */
export interface ReplayPartition {
  readonly replay: readonly QueuedProgressOp[];
  readonly converged: readonly QueuedProgressOp[];
}

export function partitionReplay(
  queued: readonly QueuedProgressOp[],
  serverChecked: ReadonlySet<string>,
): ReplayPartition {
  const replay = opsStillNeedingReplay(queued, serverChecked);
  const replayKeys = new Set(replay.map((op) => op.rowKey));
  const converged = queued.filter((op) => !replayKeys.has(op.rowKey));
  return { replay, converged };
}

/** Outcome of a single replayed PATCH, normalised for disposition. */
export interface ReplayResult {
  readonly ok: boolean;
  /** HTTP status, or `null` when the request never produced a response (network error). */
  readonly status: number | null;
}

export type ReplayDisposition = "ack" | "keep";

/**
 * Is this HTTP status a TERMINAL failure for a replayed progress PATCH?
 *
 * 4xx means the request itself is unacceptable (deleted config, revoked
 * access, malformed row) — replaying it can never succeed, so the op
 * must be dropped rather than retried forever (poison-message guard).
 * The two exceptions, 408 (timeout) and 429 (rate limited), are
 * transient and worth retrying. 5xx is a server-side blip — retriable.
 */
export function isReplayStatusTerminal(status: number): boolean {
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/**
 * Decide whether a replayed op can be acknowledged (removed from the
 * queue) or must be kept for a later flush.
 *
 *   - success               → ack
 *   - network error         → keep (we'll retry when back online)
 *   - terminal 4xx          → ack (drop the poison op; it can never land)
 *   - retriable 5xx/408/429  → keep
 */
export function resolveReplayDisposition(result: ReplayResult): ReplayDisposition {
  if (result.ok) return "ack";
  if (result.status === null) return "keep";
  return isReplayStatusTerminal(result.status) ? "ack" : "keep";
}

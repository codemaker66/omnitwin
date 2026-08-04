import { ACTION_LOG_MAX_BATCH, type ActionLogBatch } from "@omnitwin/types";
import { useActionLogStore } from "./action-log-store.js";

// ---------------------------------------------------------------------------
// action-log-sync — G4 Slice 3. Ships the log's unsent tail to the API on
// the existing save/config boundaries (the log never does per-frame work).
// Contract: a fresh batchId per chunk, the cursor advances only on a
// confirmed chunk, and failures are swallowed — the audit channel must
// never break the save it rides beside. Overlapping retries are harmless:
// the server dedups by action id (ON CONFLICT DO NOTHING).
// ---------------------------------------------------------------------------

export type ActionLogPost = (
  configId: string,
  batch: ActionLogBatch,
) => Promise<{ readonly accepted: number; readonly duplicates: number }>;

export async function flushActionLog(options: {
  readonly revision: number;
  readonly post: ActionLogPost;
}): Promise<void> {
  // The whole body is fenced (not just the POST): callers fire-and-forget
  // this promise with no .catch, so even a store subscriber throwing from
  // markSentThrough must never surface as an unhandled rejection.
  try {
    await flushUnsent(options);
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate: the only trace of a swallowed audit-flush failure
    console.error("action log flush failed unexpectedly", error);
  }
}

async function flushUnsent(options: {
  readonly revision: number;
  readonly post: ActionLogPost;
}): Promise<void> {
  const { configId, entries, sentCount } = useActionLogStore.getState();
  if (configId === null) return;
  const unsent = entries.slice(sentCount);
  if (unsent.length === 0) return;

  for (let index = 0; index < unsent.length; index += ACTION_LOG_MAX_BATCH) {
    const chunk = unsent.slice(index, index + ACTION_LOG_MAX_BATCH);
    try {
      await options.post(configId, {
        batchId: crypto.randomUUID(),
        revision: options.revision,
        actions: chunk,
      });
    } catch (error) {
      // eslint-disable-next-line no-console -- deliberate: the only trace of a swallowed audit-flush failure; the tail retries next boundary
      console.error("action log flush failed", configId, error);
      return;
    }
    // The ack may resolve after a config switch: a stale ack must never
    // touch the new log (same race class as the slice-2 save guard).
    if (useActionLogStore.getState().configId !== configId) return;
    // Fold-safe ack (reviewer CRITICAL): acks resolve the chunk's last
    // action ID against the CURRENT array — an index accumulated across
    // this await would live in a stale frame once a fold renumbers the
    // log, stranding the cursor past reality and orphaning the tail. An
    // id absorbed by a fold no-ops; its constituents' persistence is
    // already recorded server-side and the cursor was renumbered at
    // append time.
    const lastAcked = chunk[chunk.length - 1];
    if (lastAcked !== undefined) useActionLogStore.getState().markSentThrough(lastAcked.id);
  }
}

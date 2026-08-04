import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Action } from "@omnitwin/types";
import { ACTION_LOG_MAX_BATCH } from "@omnitwin/types";
import { flushActionLog, type ActionLogPost } from "../action-log-sync.js";
import {
  ACTION_LOG_FOLD_COUNT,
  MAX_ACTION_LOG_ENTRIES,
  useActionLogStore,
} from "../action-log-store.js";

// G4 Slice 3: the flusher ships the log's unsent tail to the API on the
// existing save/config boundaries (never per-frame). Contract: idempotent
// batches (fresh batchId per chunk; the server dedups by action id),
// cursor advances only on confirmed success, failures are swallowed —
// the audit channel must never break the save it rides beside.

function testAction(n: number): Action {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    actor: { kind: "operator" },
    intent: "object.place",
    payload: { n },
    inverse: { n },
    provenance: { surface: "planner" },
    ts: "2026-07-18T10:00:00.000Z",
  };
}

function seedLog(count: number, sent = 0): void {
  useActionLogStore.getState().reset();
  useActionLogStore.getState().beginLog("cfg-sync-test");
  for (let i = 0; i < count; i += 1) useActionLogStore.getState().append(testAction(i));
  useActionLogStore.getState().markSent(sent);
}

beforeEach(() => {
  useActionLogStore.getState().reset();
});

describe("action-log store sent cursor", () => {
  it("markSent is monotone and config boundaries zero it", () => {
    seedLog(3);
    useActionLogStore.getState().markSent(2);
    expect(useActionLogStore.getState().sentCount).toBe(2);
    useActionLogStore.getState().markSent(1); // stale ack must not regress
    expect(useActionLogStore.getState().sentCount).toBe(2);
    useActionLogStore.getState().beginLog("cfg-other");
    expect(useActionLogStore.getState().sentCount).toBe(0);
  });
});

describe("overflow folding and the sent cursor", () => {
  it("folding shifts a cursor beyond the folded span; a cursor inside it drops to 0", () => {
    // Fill to the cap, then one more append folds the oldest FOLD_COUNT
    // entries into a single summary — every index the cursor points
    // through shifts. Beyond the span: shift by the collapse. Inside it:
    // the summary now absorbs unsent material, so the cursor must drop to
    // 0 and ship the summary too — otherwise unsent actions silently
    // vanish from persistence.
    seedLog(MAX_ACTION_LOG_ENTRIES, ACTION_LOG_FOLD_COUNT + 501);
    useActionLogStore.getState().append(testAction(999_991));
    const afterBeyond = useActionLogStore.getState();
    const collapsed = MAX_ACTION_LOG_ENTRIES + 1 - afterBeyond.entries.length;
    expect(collapsed).toBeGreaterThan(0);
    expect(afterBeyond.sentCount).toBe(ACTION_LOG_FOLD_COUNT + 501 - collapsed);

    seedLog(MAX_ACTION_LOG_ENTRIES, 400); // cursor inside the span to be folded
    useActionLogStore.getState().append(testAction(999_992));
    expect(useActionLogStore.getState().sentCount).toBe(0);
  });
});

describe("flushActionLog", () => {
  it("posts the unsent tail with the revision and a fresh batch id, then advances the cursor", async () => {
    seedLog(3, 1);
    const post: ActionLogPost = vi.fn(() => Promise.resolve({ accepted: 2, duplicates: 0 }));

    await flushActionLog({ revision: 7, post });

    expect(post).toHaveBeenCalledTimes(1);
    const [configId, batch] = (post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { batchId: string; revision: number; actions: readonly Action[] },
    ];
    expect(configId).toBe("cfg-sync-test");
    expect(batch.revision).toBe(7);
    expect(batch.actions.map((a) => (a.payload as { n: number }).n)).toEqual([1, 2]);
    expect(batch.batchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(useActionLogStore.getState().sentCount).toBe(3);
  });

  it("chunks past the batch cap in order and advances per confirmed chunk", async () => {
    seedLog(ACTION_LOG_MAX_BATCH + 3);
    const batchIds: string[] = [];
    const sizes: number[] = [];
    const post: ActionLogPost = vi.fn((_configId, batch) => {
      batchIds.push(batch.batchId);
      sizes.push(batch.actions.length);
      return Promise.resolve({ accepted: batch.actions.length, duplicates: 0 });
    });

    await flushActionLog({ revision: 1, post });

    expect(sizes).toEqual([ACTION_LOG_MAX_BATCH, 3]);
    expect(new Set(batchIds).size).toBe(2); // fresh id per chunk
    expect(useActionLogStore.getState().sentCount).toBe(ACTION_LOG_MAX_BATCH + 3);
  });

  it("a failed chunk stops the flush, keeps the cursor at the last success, and never throws", async () => {
    seedLog(ACTION_LOG_MAX_BATCH + 3);
    let calls = 0;
    const post: ActionLogPost = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve({ accepted: ACTION_LOG_MAX_BATCH, duplicates: 0 })
        : Promise.reject(new Error("network down"));
    });

    await expect(flushActionLog({ revision: 1, post })).resolves.toBeUndefined();
    expect(useActionLogStore.getState().sentCount).toBe(ACTION_LOG_MAX_BATCH);
    // The unsent tail is retried on the next boundary — server-side action-id
    // dedup makes the overlap harmless.
  });

  it("a fold landing during an in-flight flush never strands the cursor past reality (reviewer CRITICAL)", async () => {
    // The stale-reference-frame race: a flush snapshots its chunk, the log
    // folds while the POST is in flight (append renumbers sentCount), and
    // an index-based ack would set the cursor PAST the shrunken entries
    // array — every later flush slices an empty tail forever. Acking by
    // action id keeps the store's own fold adjustment authoritative. (The
    // fold summary itself correctly stays local here: the cursor sat
    // beyond the folded span, so every folded constituent was already
    // persisted individually — the summary is compression, not new data.)
    seedLog(MAX_ACTION_LOG_ENTRIES - 1, MAX_ACTION_LOG_ENTRIES - 1); // healthy steady state
    useActionLogStore.getState().append(testAction(900_000)); // reaches the cap
    let release: (() => void) | undefined;
    const post = vi.fn<ActionLogPost>(
      () => new Promise<{ accepted: number; duplicates: number }>((resolve) => {
        release = () => { resolve({ accepted: 1, duplicates: 0 }); };
      }),
    );

    const flushing = flushActionLog({ revision: 1, post }); // one-action chunk in flight
    useActionLogStore.getState().append(testAction(900_001)); // crosses the cap → fold
    if (release === undefined) throw new Error("post never started");
    release();
    await flushing;

    const state = useActionLogStore.getState();
    expect(state.sentCount).toBeLessThanOrEqual(state.entries.length); // never stranded
    // The genuinely-unsent tail (the post-fold append) must still flush.
    const nextPost = vi.fn<ActionLogPost>(() => Promise.resolve({ accepted: 1, duplicates: 0 }));
    await flushActionLog({ revision: 1, post: nextPost });
    const flushed = nextPost.mock.calls.flatMap(([, batch]) => batch.actions);
    expect(flushed.map((a) => (a.payload as { n: number }).n)).toEqual([900_001]);
    const settled = useActionLogStore.getState();
    expect(settled.sentCount).toBe(settled.entries.length);
  });

  it("a fold that absorbs UNSENT entries ships the summary — audit data is never silently lost", async () => {
    // The data-loss half: with the cursor INSIDE the span being folded,
    // unsent actions get absorbed into the summary. The store drops the
    // cursor to 0 so the summary (the only remaining record of them)
    // ships on the next flush.
    seedLog(MAX_ACTION_LOG_ENTRIES, 400); // 4600 unsent, cursor inside the fold span
    useActionLogStore.getState().append(testAction(900_002)); // crosses the cap → fold
    expect(useActionLogStore.getState().sentCount).toBe(0);

    const post = vi.fn<ActionLogPost>((_configId, batch) =>
      Promise.resolve({ accepted: batch.actions.length, duplicates: 0 }));
    await flushActionLog({ revision: 1, post });
    const flushed = post.mock.calls.flatMap(([, batch]) => batch.actions);
    expect(flushed[0]?.intent).toBe("log.summarized");
    const settled = useActionLogStore.getState();
    expect(settled.sentCount).toBe(settled.entries.length);
  });

  it("an ack that resolves after a config switch never advances the new log's cursor", async () => {
    // Same race class as slice 2's save-continuation CRITICAL: the flush
    // snapshots config A's tail, the planner switches to B while the POST
    // is in flight, and the late ack must not markSent into B's log —
    // markSent is monotone, so a stale A-cursor would permanently skip B's
    // first unsent entries.
    seedLog(2);
    let release: (() => void) | undefined;
    const post = vi.fn<ActionLogPost>(
      () => new Promise<{ accepted: number; duplicates: number }>((resolve) => {
        release = () => { resolve({ accepted: 2, duplicates: 0 }); };
      }),
    );

    const flushing = flushActionLog({ revision: 1, post });
    useActionLogStore.getState().beginLog("cfg-after-switch");
    useActionLogStore.getState().append(testAction(50));
    if (release === undefined) throw new Error("post never started");
    release();
    await flushing;

    expect(useActionLogStore.getState().sentCount).toBe(0); // B's tail still unsent
  });

  it("skips silently with no open log or nothing unsent", async () => {
    const post = vi.fn<ActionLogPost>(() => Promise.resolve({ accepted: 0, duplicates: 0 }));
    await flushActionLog({ revision: 1, post });
    seedLog(2, 2);
    await flushActionLog({ revision: 1, post });
    expect(post).not.toHaveBeenCalled();
  });
});

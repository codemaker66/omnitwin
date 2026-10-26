import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaveQueue } from "../event-details-queue.js";

// ---------------------------------------------------------------------------
// One save at a time, the latest value last (critic C-X2). The server's
// metadata PATCH is an unlocked read-modify-write: two requests in flight can
// land out of order, so the queue never has two out, and sends the newest
// value after the reply to the last.
// ---------------------------------------------------------------------------

interface Deferred {
  readonly value: string;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

function harness(options: { readonly canSend?: () => boolean } = {}) {
  const sent: Deferred[] = [];
  const queue = createSaveQueue<string>({
    delayMs: 800,
    canSend: options.canSend,
    send: (value) => new Promise<void>((resolve, reject) => { sent.push({ value, resolve, reject }); }),
  });
  return { queue, sent };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("the save queue", () => {
  it("sends once per pause in typing, not once per key", async () => {
    const { queue, sent } = harness();
    queue.set("S");
    queue.set("Sh");
    queue.set("She");
    expect(queue.snapshot().phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(799);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent.map((s) => s.value)).toEqual(["She"]);
  });

  it("never has two requests out: what is typed meanwhile goes after the reply, coalesced", async () => {
    const { queue, sent } = harness();
    queue.set("a");
    await vi.advanceTimersByTimeAsync(800);
    expect(queue.snapshot().phase).toBe("sending");
    queue.set("ab");
    queue.set("abc");
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent.map((s) => s.value)).toEqual(["a"]);
    sent[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((s) => s.value)).toEqual(["a", "abc"]);
    sent[1]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.snapshot()).toMatchObject({ phase: "idle", saved: "abc", unsent: false });
  });

  it("keeps a failed value, says why, and sends it again on retry", async () => {
    const { queue, sent } = harness();
    queue.set("note");
    await vi.advanceTimersByTimeAsync(800);
    const refusal = new Error("refused");
    sent[0]?.reject(refusal);
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.snapshot()).toMatchObject({ phase: "failed", error: refusal, unsent: true });
    queue.retry();
    expect(sent.map((s) => s.value)).toEqual(["note", "note"]);
    sent[1]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.snapshot()).toMatchObject({ phase: "idle", saved: "note", unsent: false });
  });

  it("a newer value typed while a send failed wins over the failed one", async () => {
    const { queue, sent } = harness();
    queue.set("old");
    await vi.advanceTimersByTimeAsync(800);
    queue.set("new");
    sent[0]?.reject(new Error("x"));
    await vi.advanceTimersByTimeAsync(0);
    queue.retry();
    expect(sent.map((s) => s.value)).toEqual(["old", "new"]);
  });

  it("holds while it may not send (offline), and goes on retry when it may", async () => {
    let online = false;
    const { queue, sent } = harness({ canSend: () => online });
    queue.set("kept");
    await vi.advanceTimersByTimeAsync(800);
    expect(sent).toHaveLength(0);
    expect(queue.snapshot()).toMatchObject({ phase: "held", unsent: true });
    online = true;
    queue.retry();
    expect(sent.map((s) => s.value)).toEqual(["kept"]);
  });

  it("flush sends at once and resolves when the reply is in", async () => {
    const { queue, sent } = harness();
    queue.set("closing");
    let flushed = false;
    void queue.flush().then(() => { flushed = true; });
    expect(sent.map((s) => s.value)).toEqual(["closing"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    sent[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(true);
  });

  it("two quick edits to different fields both survive a read-modify-write server", async () => {
    // Like the metadata PATCH: read the stored blob, merge the body over it,
    // write it back; the reply comes later.
    let stored: Readonly<Record<string, string>> = {};
    const replies: (() => void)[] = [];
    const queue = createSaveQueue<Readonly<Record<string, string>>>({
      delayMs: 800,
      send: (body) => new Promise<void>((resolve) => {
        const read = { ...stored };
        replies.push(() => { stored = { ...read, ...body }; resolve(); });
      }),
    });
    let draft: Readonly<Record<string, string>> = {};
    const type = (field: string, value: string): void => {
      draft = { ...draft, [field]: value };
      queue.set(draft);
    };
    type("access", "South door");
    await vi.advanceTimersByTimeAsync(800);
    type("instructions", "Board at 18:45");
    await vi.advanceTimersByTimeAsync(800);
    expect(replies).toHaveLength(1);
    replies[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(replies).toHaveLength(2);
    replies[1]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(stored).toEqual({ access: "South door", instructions: "Board at 18:45" });
  });
});

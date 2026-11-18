import { afterEach, describe, expect, it, vi } from "vitest";
import type { BandValues } from "../bands.js";
import { renderSetDown } from "../render.js";
import {
  ANSWER_WITHIN_MS,
  SetDownCancelled,
  SetDownRendererBroken,
  createSetDownRenderer,
  type SetDownRenderer,
  type WorkerLike,
} from "../renderer.js";
import { runSetDownJob } from "../worker-jobs.js";
import type { SetDownAnswer, SetDownJob } from "../worker-protocol.js";
import { inputFor, sameSamples } from "./set-down-kit.js";

// ---------------------------------------------------------------------------
// The main thread's client of the set-down Worker, against a fake Worker
// (happy-dom has none) that answers when the test says: one job at a time,
// exact renders first, every promise settled, answers checked, buffers handed
// out without a copy, and a broken Worker failing fast.
// ---------------------------------------------------------------------------

/** A module Worker that keeps what it is posted and answers when the test says. */
class FakeSetDownWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  terminated = false;
  readonly posted: SetDownJob[] = [];
  /** Throws from postMessage for jobs with this key, as a structured clone refuses what it cannot copy. */
  refuseKey: string | null = null;

  postMessage(job: SetDownJob): void {
    if (job.key === this.refuseKey) throw new DOMException("could not be cloned", "DataCloneError");
    this.posted.push(job);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** The job posted last: the one running. */
  running(): SetDownJob {
    const job = this.posted.at(-1);
    if (job === undefined) throw new Error("nothing posted");
    return job;
  }

  /** Delivers `data` as the Worker's next message. */
  send(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  /** Answers the running job as the Worker would, with buffers of `frames` samples. */
  answer(frames = 4): { readonly left: ArrayBuffer; readonly right: ArrayBuffer } {
    const data = answerFor(this.running(), frames);
    this.send(data);
    if (!data.ok) throw new Error("expected an answer with channels");
    return { left: data.left, right: data.right };
  }
}

/** A sound answer to `job`, with ramps of `frames` samples in each channel. */
function answerFor(job: SetDownJob, frames = 4): SetDownAnswer {
  const left = Float32Array.from({ length: frames }, (_, i) => i / frames).buffer;
  const right = Float32Array.from({ length: frames }, (_, i) => -i / frames).buffer;
  if (job.kind === "render") {
    return { kind: "render", id: job.id, ok: true, left, right, sampleRate: job.input.sampleRate, peakDb: -18, onsetSeconds: 0.002, limitDb: 0, workMs: 9.5 };
  }
  return { kind: "tail", id: job.id, ok: true, left, right, sampleRate: job.sampleRate, workMs: 61 };
}

interface Tracked<T> {
  status: "pending" | "resolved" | "rejected";
  value: T | undefined;
  reason: unknown;
}

/** Follows a promise, so every one a test makes is settled and handled. */
function track<T>(promise: Promise<T>): Tracked<T> {
  const tracked: Tracked<T> = { status: "pending", value: undefined, reason: undefined };
  promise.then(
    (value) => { tracked.status = "resolved"; tracked.value = value; },
    (reason: unknown) => { tracked.status = "rejected"; tracked.reason = reason; },
  );
  return tracked;
}

/** What an error was caused by. */
function causeOf(reason: unknown): unknown {
  return reason instanceof Error ? reason.cause : undefined;
}

/** Lets settled promises run their handlers. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

const INPUT = inputFor("chiavari-chair", "oak-boards-joists", { seed: 7 });
const RT: BandValues = [1.8, 2.2, 2.6, 2.9, 2.7, 2.0, 1.2];
const TAIL = { sampleRate: 48000, seed: 7, onsetSeconds: 0.03 } as const;

let renderers: SetDownRenderer[] = [];

/** A renderer on a fresh fake Worker; disposed after the test. */
function made(): { readonly renderer: SetDownRenderer; readonly worker: FakeSetDownWorker } {
  const worker = new FakeSetDownWorker();
  const renderer = createSetDownRenderer({ createWorker: () => worker });
  if (renderer === null) throw new Error("expected a renderer");
  renderers.push(renderer);
  return { renderer, worker };
}

afterEach(() => {
  for (const renderer of renderers) renderer.dispose();
  renderers = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("one job at a time, exact renders first", () => {
  it("posts an exact render before queued ahead renders and tails, with at most one in flight", async () => {
    const { renderer, worker } = made();
    const ahead1 = track(renderer.render(INPUT, "ahead", "ahead-1"));
    const tail = track(renderer.tail(RT, TAIL, "room"));
    const ahead2 = track(renderer.render(INPUT, "ahead", "ahead-2"));
    expect(worker.posted.map((job) => job.key)).toEqual(["ahead-1"]);

    const exact1 = track(renderer.render(INPUT, "exact", "exact-1"));
    const exact2 = track(renderer.render(INPUT, "exact", "exact-2"));
    expect(worker.posted.map((job) => job.key)).toEqual(["ahead-1"]);

    const order: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      order.push(worker.running().key);
      worker.answer();
      expect(worker.posted).toHaveLength(Math.min(5, i + 2));
    }
    expect(order).toEqual(["ahead-1", "exact-1", "exact-2", "room", "ahead-2"]);
    await flush();
    for (const job of [ahead1, tail, ahead2, exact1, exact2]) expect(job.status).toBe("resolved");
  });

  it("posts each job with its own id, its key and what it renders", () => {
    const { renderer, worker } = made();
    track(renderer.render(INPUT, "exact", "chair"));
    worker.answer();
    track(renderer.tail(RT, TAIL, "room"));
    const [render, tail] = worker.posted;
    expect(render).toEqual({ kind: "render", id: render?.id, key: "chair", input: INPUT });
    expect(tail).toEqual({ kind: "tail", id: tail?.id, key: "room", rt: RT, ...TAIL });
    expect(render?.id).not.toBe(tail?.id);
  });
});

describe("cancelling and replacing", () => {
  it("cancel drops queued jobs, never the running one, and each dropped promise rejects with SetDownCancelled", async () => {
    const { renderer, worker } = made();
    const running = track(renderer.render(INPUT, "ahead", "deck|seed-1"));
    const queuedAhead = track(renderer.render(INPUT, "ahead", "deck|seed-2"));
    const queuedExact = track(renderer.render(INPUT, "exact", "deck|exact"));
    const kept = track(renderer.render(INPUT, "exact", "chair|exact"));
    const keptTail = track(renderer.tail(RT, TAIL, "room"));

    renderer.cancel((key) => key.startsWith("deck|"));
    await flush();
    expect(queuedAhead.status).toBe("rejected");
    expect(queuedExact.status).toBe("rejected");
    expect(queuedAhead.reason).toBeInstanceOf(SetDownCancelled);
    expect(queuedAhead.reason).toMatchObject({ name: "SetDownCancelled", reason: "cancelled", key: "deck|seed-2" });
    expect(running.status).toBe("pending");

    worker.answer();
    expect(worker.running().key).toBe("chair|exact");
    worker.answer();
    expect(worker.running().key).toBe("room");
    worker.answer();
    await flush();
    expect([running.status, kept.status, keptTail.status]).toEqual(["resolved", "resolved", "resolved"]);
    expect(worker.posted.map((job) => job.key)).toEqual(["deck|seed-1", "chair|exact", "room"]);
  });

  it("changes nothing when the match throws", async () => {
    const { renderer, worker } = made();
    track(renderer.render(INPUT, "ahead", "first"));
    const second = track(renderer.render(INPUT, "ahead", "second"));
    expect(() => { renderer.cancel(() => { throw new Error("bad match"); }); }).toThrow("bad match");
    worker.answer();
    worker.answer();
    await flush();
    expect(second.status).toBe("resolved");
  });

  it("a newer tail takes a queued older one's place, and the older rejects as replaced", async () => {
    const { renderer, worker } = made();
    track(renderer.render(INPUT, "ahead", "busy"));
    const older = track(renderer.tail(RT, TAIL, "room-1"));
    track(renderer.render(INPUT, "ahead", "after"));
    const newer = track(renderer.tail([1, 1, 1, 1, 1, 1, 1], TAIL, "room-2"));
    await flush();
    expect(older.status).toBe("rejected");
    expect(older.reason).toMatchObject({ name: "SetDownCancelled", reason: "replaced", key: "room-1" });

    worker.answer();
    expect(worker.running()).toMatchObject({ kind: "tail", key: "room-2", rt: [1, 1, 1, 1, 1, 1, 1] });
    worker.answer();
    expect(worker.running().key).toBe("after");
    worker.answer();
    await flush();
    expect(newer.status).toBe("resolved");
  });

  it("never replaces a running tail: both it and the newer one resolve", async () => {
    const { renderer, worker } = made();
    const first = track(renderer.tail(RT, TAIL, "room-1"));
    const second = track(renderer.tail(RT, TAIL, "room-2"));
    worker.answer();
    worker.answer();
    await flush();
    expect([first.status, second.status]).toEqual(["resolved", "resolved"]);
  });
});

describe("answers", () => {
  it("resolve a render as Float32Array views on exactly the buffers the Worker transferred", async () => {
    const { renderer, worker } = made();
    const render = track(renderer.render(INPUT, "exact", "chair"));
    const sent = worker.answer(6);
    await flush();
    const value = render.value;
    if (value === undefined) throw new Error("no render");
    expect(value.left.buffer).toBe(sent.left);
    expect(value.right.buffer).toBe(sent.right);
    expect(value.left).toBeInstanceOf(Float32Array);
    expect(Array.from(value.left)).toEqual([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].map(Math.fround));
    expect(value).toMatchObject({ sampleRate: 48000, peakDb: -18, onsetSeconds: 0.002, limitDb: 0, workMs: 9.5 });
  });

  it("resolve a tail the same way, with the Worker's time", async () => {
    const { renderer, worker } = made();
    const tail = track(renderer.tail(RT, TAIL, "room"));
    const sent = worker.answer(8);
    await flush();
    expect(tail.value?.left.buffer).toBe(sent.left);
    expect(tail.value?.right.buffer).toBe(sent.right);
    expect(tail.value).toMatchObject({ sampleRate: 48000, workMs: 61 });
  });

  it("carry the Worker's own render through, bytewise", async () => {
    const { renderer, worker } = made();
    const render = track(renderer.render(INPUT, "exact", "chair"));
    const { answer, transfer } = runSetDownJob(structuredClone(worker.running()));
    worker.send(structuredClone(answer, { transfer }));
    await flush();
    const expected = renderSetDown(INPUT);
    const value = render.value;
    if (value === undefined) throw new Error("no render");
    expect(sameSamples(value.left, expected.left)).toBe(true);
    expect(sameSamples(value.right, expected.right)).toBe(true);
    expect(value.peakDb).toBe(expected.peakDb);
  });

  it("reject only their own job when they fail a check, and the next job runs", async () => {
    const { renderer, worker } = made();
    const job = (): SetDownJob => worker.running();
    const faults: readonly (readonly [string, () => unknown, RegExp])[] = [
      ["not an object", () => "rendered", /malformed/],
      ["another job's id", () => ({ ...answerFor(job()), id: job().id + 100 }), /answered job/],
      ["the other kind", () => answerFor({ kind: "tail", id: job().id, key: "x", rt: RT, ...TAIL }), /tail/],
      ["channels of unequal length", () => ({ ...answerFor(job()), right: new Float32Array(3).buffer }), /length/],
      ["a channel that is not an ArrayBuffer", () => ({ ...answerFor(job()), left: new Float32Array(4) }), /answer\.left/],
      ["a channel not whole samples", () => ({ ...answerFor(job()), left: new ArrayBuffer(10), right: new ArrayBuffer(10) }), /whole/],
      ["another sample rate", () => ({ ...answerFor(job()), sampleRate: 44100 }), /44100/],
      ["a refusal", () => ({ kind: "render", id: job().id, ok: false, error: "job.input.seed is not a whole number" }), /job\.input\.seed/],
    ];
    const outcomes: Tracked<unknown>[] = [];
    for (const [, makeAnswer] of faults) {
      const outcome = track(renderer.render(INPUT, "exact", "chair"));
      outcomes.push(outcome);
      worker.send(makeAnswer());
    }
    const last = track(renderer.render(INPUT, "exact", "last"));
    worker.answer();
    await flush();
    faults.forEach(([what, , message], i) => {
      const outcome = outcomes[i];
      expect(outcome?.status, what).toBe("rejected");
      expect(outcome?.reason, what).toBeInstanceOf(Error);
      expect(outcome?.reason, what).not.toBeInstanceOf(SetDownCancelled);
      expect(outcome?.reason, what).not.toBeInstanceOf(SetDownRendererBroken);
      expect(String(outcome?.reason), what).toMatch(message);
    });
    expect(last.status).toBe("resolved");
    expect(renderer.broken).toBe(false);
    expect(worker.terminated).toBe(false);
  });

  it("reject the running job when its answer cannot be read, and the next job runs", async () => {
    const { renderer, worker } = made();
    const lost = track(renderer.render(INPUT, "exact", "lost"));
    const next = track(renderer.render(INPUT, "exact", "next"));
    worker.onmessageerror?.(new MessageEvent("messageerror", { data: null }));
    expect(worker.running().key).toBe("next");
    worker.answer();
    await flush();
    expect(lost.status).toBe("rejected");
    expect(String(lost.reason)).toMatch(/could not be read/);
    expect(next.status).toBe("resolved");
  });

  it("reject a job the Worker cannot be sent, and the next job runs", async () => {
    const { renderer, worker } = made();
    worker.refuseKey = "uncloneable";
    const refused = track(renderer.render(INPUT, "exact", "uncloneable"));
    const next = track(renderer.render(INPUT, "exact", "next"));
    expect(worker.running().key).toBe("next");
    worker.answer();
    await flush();
    expect(refused.status).toBe("rejected");
    expect(String(refused.reason)).toMatch(/could not be sent render "uncloneable"/);
    expect(causeOf(refused.reason)).toBeInstanceOf(DOMException);
    expect(next.status).toBe("resolved");
  });
});

describe("a broken Worker fails fast", () => {
  it("an error from the Worker rejects every pending promise with its cause, terminates it, and later calls reject at once", async () => {
    const { renderer, worker } = made();
    const running = track(renderer.render(INPUT, "exact", "chair"));
    const queued = track(renderer.render(INPUT, "ahead", "deck"));
    const tail = track(renderer.tail(RT, TAIL, "room"));
    const event = new ErrorEvent("error", { message: "Uncaught SyntaxError: Unexpected token" });
    worker.onerror?.(event);
    await flush();
    for (const job of [running, queued, tail]) {
      expect(job.status).toBe("rejected");
      expect(job.reason).toBeInstanceOf(SetDownRendererBroken);
      expect(String(job.reason)).toMatch(/Unexpected token/);
      expect(causeOf(job.reason)).toBe(event);
    }
    expect(worker.terminated).toBe(true);
    expect(renderer.broken).toBe(true);

    const later = track(renderer.render(INPUT, "exact", "later"));
    const laterTail = track(renderer.tail(RT, TAIL, "room"));
    await flush();
    expect(later.status).toBe("rejected");
    expect(later.reason).toBeInstanceOf(SetDownRendererBroken);
    expect(causeOf(later.reason)).toBe(running.reason);
    expect(laterTail.status).toBe("rejected");
    expect(worker.posted).toHaveLength(1);
  });

  it("names a script that never ran, whose error carries no message, or no message at all", async () => {
    // A script that fails to load is reported with a plain Event: its message is not even a string.
    const plain = Object.defineProperty(new ErrorEvent("error"), "message", { value: undefined });
    for (const event of [new ErrorEvent("error"), plain]) {
      const { renderer, worker } = made();
      const job = track(renderer.render(INPUT, "exact", "chair"));
      worker.onerror?.(event);
      await flush();
      expect(String(job.reason)).toMatch(/stopped: its script did not load or run$/);
      expect(renderer.broken).toBe(true);
    }
  });

  it("no answer within 10 s of posting rejects everything pending and breaks it", async () => {
    vi.useFakeTimers();
    const { renderer, worker } = made();
    const running = track(renderer.render(INPUT, "exact", "chair"));
    const queued = track(renderer.tail(RT, TAIL, "room"));
    vi.advanceTimersByTime(ANSWER_WITHIN_MS - 1);
    await flush();
    expect(running.status).toBe("pending");
    expect(renderer.broken).toBe(false);

    vi.advanceTimersByTime(1);
    await flush();
    expect(ANSWER_WITHIN_MS).toBe(10_000);
    for (const job of [running, queued]) {
      expect(job.status).toBe("rejected");
      expect(job.reason).toBeInstanceOf(SetDownRendererBroken);
      expect(String(job.reason)).toMatch(/did not answer render "chair" within 10 s/);
    }
    expect(worker.terminated).toBe(true);
    expect(renderer.broken).toBe(true);
    const later = track(renderer.render(INPUT, "exact", "later"));
    await flush();
    expect(later.reason).toBeInstanceOf(SetDownRendererBroken);
  });

  it("counts the 10 s from each post, not from the first", async () => {
    vi.useFakeTimers();
    const { renderer, worker } = made();
    const first = track(renderer.render(INPUT, "exact", "first"));
    const second = track(renderer.render(INPUT, "exact", "second"));
    vi.advanceTimersByTime(9_000);
    worker.answer();
    vi.advanceTimersByTime(9_999);
    await flush();
    expect(first.status).toBe("resolved");
    expect(second.status).toBe("pending");
    expect(renderer.broken).toBe(false);
    worker.answer();
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(second.status).toBe("resolved");
    expect(renderer.broken).toBe(false);
    expect(worker.terminated).toBe(false);
  });
});

describe("dispose", () => {
  it("rejects every pending job with SetDownCancelled, terminates the Worker, and later calls reject at once", async () => {
    vi.useFakeTimers();
    const { renderer, worker } = made();
    const running = track(renderer.render(INPUT, "exact", "chair"));
    const queued = track(renderer.render(INPUT, "ahead", "deck"));
    const tail = track(renderer.tail(RT, TAIL, "room"));
    renderer.dispose();
    await flush();
    for (const job of [running, queued, tail]) {
      expect(job.status).toBe("rejected");
      expect(job.reason).toBeInstanceOf(SetDownCancelled);
      expect(job.reason).toMatchObject({ reason: "disposed" });
    }
    expect(worker.terminated).toBe(true);

    const later = track(renderer.render(INPUT, "exact", "later"));
    await flush();
    expect(later.reason).toMatchObject({ name: "SetDownCancelled", reason: "disposed" });
    // Its watch on the posted job went with it: nothing breaks later, and a late answer is ignored.
    vi.advanceTimersByTime(ANSWER_WITHIN_MS * 2);
    expect(renderer.broken).toBe(false);
    expect(() => { worker.send(answerFor(worker.running())); }).not.toThrow();
    expect(() => { renderer.dispose(); }).not.toThrow();
  });
});

describe("where it runs", () => {
  it("is null where createWorker throws: no module Workers, no set-downs (R83)", () => {
    expect(createSetDownRenderer({ createWorker: () => { throw new DOMException("refused", "SecurityError"); } })).toBeNull();
  });

  it("is null where there is no Worker at all, as in happy-dom", () => {
    expect(typeof Worker).toBe("undefined");
    expect(createSetDownRenderer()).toBeNull();
  });

  it("is null where Workers run but module Workers do not", () => {
    // A browser that predates module Workers never reads the options' type.
    class ClassicOnlyWorker {
      terminate(): void {
        // Nothing runs.
      }
    }
    vi.stubGlobal("Worker", ClassicOnlyWorker);
    expect(createSetDownRenderer()).toBeNull();
  });
});

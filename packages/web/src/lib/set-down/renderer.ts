// ---------------------------------------------------------------------------
// The set-down renderer (T-700): the main thread's client of the set-down
// Worker (set-down.worker.ts). Rulings R48 and R15: every set-down, and every
// room's tail, is rendered in the Worker, never here, so this module imports
// only the engine's types.
//
// - One job runs at a time. An "exact" render (a set-down at its drop) goes
//   before every queued "ahead" render (a variant rendered before it is
//   needed) and tail, so it waits for at most the job already running, which
//   is never pre-empted. Exact renders run in the order asked; so do ahead
//   renders and tails, after them.
// - A room has one tail: a newer tail takes a queued older one's place in the
//   queue (latest wins), and the older rejects as replaced. A running tail
//   finishes.
// - Every promise settles. A job dropped by `cancel`, replaced, or pending at
//   `dispose` rejects with SetDownCancelled, so a caller can tell a
//   cancellation from a failure. A Worker error, a Worker that has not said it
//   is ready within LOAD_WITHIN_MS, or a running job not answered within
//   ANSWER_WITHIN_MS, rejects every pending job with SetDownRendererBroken
//   naming the cause; the renderer is then broken, its Worker terminated, and
//   later calls reject at once.
// - The watches count only time the Worker could have worked (ruling R99). A
//   job's ANSWER_WITHIN_MS starts once the Worker has posted its ready message
//   (its script loaded and evaluated), so a slow first load on a weak
//   connection is the load watch's, not the job's. Both watches stop while the
//   page is hidden (a locked phone, another app or tab, where the Worker may
//   be frozen with the page), and start afresh when it is visible again.
// - Each answer is checked, for its shape (worker-protocol.ts) and against the
//   job it answers. One that fails is an error for that job alone, and the
//   next job runs. One job runs at a time, so an answer is the running job's,
//   except one naming another job by its id: that is ignored, and the running
//   job keeps its watch.
// - The channels come back as the Worker's own buffers, transferred, and the
//   Float32Arrays handed out are views on exactly those buffers: no copy.
//
// There is no main-thread fallback, for the tail either (ruling R95). Where
// module Workers are refused there are no set-downs (R83), and a room's tail
// is heard only through set-downs, so createSetDownRenderer answers null.
// ---------------------------------------------------------------------------

import type { BandValues } from "./bands.js";
import type { SetDownInput, SetDownRender } from "./render.js";
import type { Stereo } from "./tail.js";
import {
  isSetDownAnswer,
  isSetDownReady,
  setDownAnswerProblem,
  type SetDownJob,
  type SetDownRenderAnswer,
  type SetDownRenderJob,
  type SetDownTailAnswer,
  type SetDownTailJob,
  type TailOptions,
} from "./worker-protocol.js";

/**
 * How long the running job's answer is waited for, milliseconds, before the
 * Worker is taken to have stopped: counted from its post, or from the Worker's
 * ready message if that comes later, and only while the page is visible.
 */
export const ANSWER_WITHIN_MS = 10_000;

/**
 * How long the Worker's ready message is waited for, milliseconds, while the
 * page is visible: a script that fails to load fires an error at once, so this
 * catches one that never evaluates, with room for a slow first load.
 */
export const LOAD_WITHIN_MS = 30_000;

export type SetDownPriority = "exact" | "ahead";

/** A set-down as rendered, with the Worker's time for it (for Task 16's evidence and the device day). */
export type SetDownRendered = SetDownRender & { readonly workMs: number };

/** A room's tail as rendered, with the Worker's time for it. */
export type SetDownTail = Stereo & { readonly workMs: number };

/** What the client needs of a Worker: a real module Worker, or a test's stand-in. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(job: SetDownJob): void;
  terminate(): void;
}

export interface SetDownRenderer {
  /** Renders a set-down in the Worker; `key` names it for `cancel`. */
  render(input: SetDownInput, priority: SetDownPriority, key: string): Promise<SetDownRendered>;
  /** Renders a room's tail in the Worker, behind exact renders. Latest wins: a newer tail replaces a queued one. */
  tail(rt: BandValues, options: TailOptions, key: string): Promise<SetDownTail>;
  /** Drops every queued job whose key matches, never the running one. */
  cancel(matches: (key: string) => boolean): void;
  /** Drops every pending job and terminates the Worker. */
  dispose(): void;
  /** True once a Worker error or a missed answer has stopped it. */
  readonly broken: boolean;
}

export type SetDownCancelReason = "cancelled" | "replaced" | "disposed";

/** A job the caller dropped (cancel), replaced (a newer tail) or disposed of: not a failure. */
export class SetDownCancelled extends Error {
  readonly reason: SetDownCancelReason;
  /** The dropped job's key, or null for a call made after dispose. */
  readonly key: string | null;

  constructor(reason: SetDownCancelReason, key: string | null) {
    super(cancelledMessage(reason, key));
    this.name = "SetDownCancelled";
    this.reason = reason;
    this.key = key;
  }
}

/** The Worker stopped (an error, or no answer in time): every pending job, and every later call, rejects with this. */
export class SetDownRendererBroken extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SetDownRendererBroken";
  }
}

function cancelledMessage(reason: SetDownCancelReason, key: string | null): string {
  if (key === null) return "The set-down renderer was disposed";
  if (reason === "replaced") return `The set-down tail "${key}" was replaced by a newer one`;
  if (reason === "disposed") return `The set-down job "${key}" was dropped: the renderer was disposed`;
  return `The set-down job "${key}" was cancelled`;
}

/**
 * Whether `new Worker(url, { type: "module" })` is understood: a browser that
 * reads the option reads its `type` (hall-detail.ts and crafted-textures.ts
 * ask the same; the throwaway Worker is terminated at once, or its URL
 * refused, harmlessly).
 */
function moduleWorkers(): boolean {
  let read = false;
  const probe: WorkerOptions = { get type(): WorkerType { read = true; return "module"; } };
  try {
    new Worker("blob://", probe).terminate();
  } catch {
    // The URL is refused; the option was still read where module Workers exist.
  }
  return read;
}

/** The set-down Worker, or null where module Workers do not run. */
function startSetDownWorker(): WorkerLike | null {
  if (typeof Worker === "undefined" || !moduleWorkers()) return null;
  return new Worker(new URL("./set-down.worker.ts", import.meta.url), { type: "module" });
}

/**
 * A renderer on its own Worker, started now, or null where module Workers are
 * refused (ruling R83): no Worker constructor, no module Workers, or a
 * constructor that throws (a sandboxed frame, a policy against the script). A
 * script that fails to load later breaks the renderer instead.
 */
export function createSetDownRenderer(options: { readonly createWorker?: () => WorkerLike } = {}): SetDownRenderer | null {
  let worker: WorkerLike | null;
  try {
    worker = options.createWorker === undefined ? startSetDownWorker() : options.createWorker();
  } catch {
    // Refused outright: no set-downs here, as where module Workers do not run.
    return null;
  }
  return worker === null ? null : rendererOn(worker);
}

interface Waiting {
  readonly job: SetDownJob;
  /** Settles the job's promise from the Worker's message: resolved from a sound answer, rejected otherwise. */
  readonly answered: (data: unknown) => void;
  readonly reject: (reason: Error) => void;
}

/** How a job is named in errors: `render "chair|oak"`. */
function named(job: SetDownJob): string {
  return `${job.kind} "${job.key}"`;
}

/** Whether the page is hidden (a locked phone, another app or tab), where the Worker may be frozen with it. */
function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Whether a message from the Worker names, by a numeric id, a job other than the running one, `id`. */
function answersAnotherJob(data: unknown, id: number): boolean {
  if (typeof data !== "object" || data === null) return false;
  const answered: unknown = Reflect.get(data, "id");
  return typeof answered === "number" && answered !== id;
}

function rendererOn(worker: WorkerLike): SetDownRenderer {
  const exact: Waiting[] = [];
  const ahead: Waiting[] = [];
  let running: Waiting | null = null;
  /** The running job's watch: armed only while the Worker is ready and the page visible. */
  let jobWatch: ReturnType<typeof setTimeout> | null = null;
  /** The watch on the Worker's ready message: armed only until it comes, and only while the page is visible. */
  let loadWatch: ReturnType<typeof setTimeout> | null = null;
  let ready = false;
  let brokenBy: SetDownRendererBroken | null = null;
  let disposed = false;
  let stopped = false;
  let lastId = 0;
  const page = typeof document === "undefined" ? null : document;

  const clearJobWatch = (): void => {
    if (jobWatch !== null) clearTimeout(jobWatch);
    jobWatch = null;
  };

  const clearLoadWatch = (): void => {
    if (loadWatch !== null) clearTimeout(loadWatch);
    loadWatch = null;
  };

  /** Gives the running job a fresh ANSWER_WITHIN_MS, if it can be watched now: the Worker ready, the page visible. */
  const watchRunning = (): void => {
    clearJobWatch();
    const watched = running;
    if (watched === null || !ready || pageHidden()) return;
    jobWatch = setTimeout(() => {
      if (running === watched) breakDown(new SetDownRendererBroken(`The set-down Worker did not answer ${named(watched.job)} within ${String(ANSWER_WITHIN_MS / 1000)} s`));
    }, ANSWER_WITHIN_MS);
  };

  /** Gives the Worker a fresh LOAD_WITHIN_MS to say it is ready, unless it has, or the page is hidden. */
  const watchLoad = (): void => {
    clearLoadWatch();
    if (ready || pageHidden()) return;
    loadWatch = setTimeout(() => {
      breakDown(new SetDownRendererBroken(`The set-down Worker did not load within ${String(LOAD_WITHIN_MS / 1000)} s`));
    }, LOAD_WITHIN_MS);
  };

  /** Hidden: no watch runs. Visible again: each starts afresh. */
  const onVisibility = (): void => {
    if (pageHidden()) {
      clearJobWatch();
      clearLoadWatch();
      return;
    }
    watchLoad();
    watchRunning();
  };

  const stopWorker = (): void => {
    clearJobWatch();
    clearLoadWatch();
    if (stopped) return;
    stopped = true;
    page?.removeEventListener("visibilitychange", onVisibility);
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  };

  /** Every pending job, running first, taken off the queues. */
  const takeAll = (): Waiting[] => {
    const all = [...(running === null ? [] : [running]), ...exact, ...ahead];
    running = null;
    exact.length = 0;
    ahead.length = 0;
    return all;
  };

  const breakDown = (error: SetDownRendererBroken): void => {
    if (disposed || brokenBy !== null) return;
    brokenBy = error;
    stopWorker();
    for (const waiting of takeAll()) waiting.reject(error);
  };

  /** The running job is over: its watch is cleared and the next job may run. */
  const finishRunning = (): Waiting | null => {
    const current = running;
    clearJobWatch();
    running = null;
    return current;
  };

  const pump = (): void => {
    while (running === null && brokenBy === null && !disposed) {
      const next = exact.shift() ?? ahead.shift();
      if (next === undefined) return;
      running = next;
      try {
        worker.postMessage(next.job);
      } catch (error) {
        // The job cannot be sent (a structured clone that refuses part of it): its own failure, not the Worker's.
        running = null;
        next.reject(new Error(`The set-down Worker could not be sent ${named(next.job)}`, { cause: error }));
        continue;
      }
      watchRunning();
    }
  };

  worker.onmessage = (event) => {
    const data = event.data;
    // The Worker's one ready message comes before any answer and answers no job: from it on, jobs are watched.
    if (isSetDownReady(data)) {
      if (!ready) {
        ready = true;
        clearLoadWatch();
        watchRunning();
      }
      return;
    }
    const current = running;
    // Nothing runs only once the renderer has stopped listening; no message is expected then.
    if (current === null) return;
    // An answer naming another job (none should come) leaves the running job, and its watch, as they are.
    if (answersAnotherJob(data, current.job.id)) return;
    finishRunning();
    try {
      current.answered(data);
    } catch (error) {
      current.reject(new Error(`The set-down Worker's answer to ${named(current.job)} could not be taken`, { cause: error }));
    }
    pump();
  };

  worker.onmessageerror = (event) => {
    const current = finishRunning();
    if (current === null) return;
    current.reject(new Error(`The set-down Worker's answer to ${named(current.job)} could not be read`, { cause: event }));
    pump();
  };

  worker.onerror = (event) => {
    // A script that fails to load is reported with a plain Event, which has no message at all; an error thrown in
    // the Worker comes as an ErrorEvent with its message.
    const message: unknown = Reflect.get(event, "message");
    const why = typeof message === "string" && message !== "" ? message : "its script did not load or run";
    breakDown(new SetDownRendererBroken(`The set-down Worker stopped: ${why}`, { cause: event }));
  };

  page?.addEventListener("visibilitychange", onVisibility);
  watchLoad();

  /** Why a new job cannot be taken, or null when it can. */
  const refusal = (): Error | null => {
    if (disposed) return new SetDownCancelled("disposed", null);
    if (brokenBy !== null) return new SetDownRendererBroken("The set-down renderer is broken", { cause: brokenBy });
    return null;
  };

  const nextId = (): number => {
    lastId += 1;
    return lastId;
  };

  return {
    get broken() {
      return brokenBy !== null;
    },

    render(input, priority, key) {
      const refused = refusal();
      if (refused !== null) return Promise.reject(refused);
      const job: SetDownRenderJob = { kind: "render", id: nextId(), key, input };
      return new Promise<SetDownRendered>((resolve, reject) => {
        (priority === "exact" ? exact : ahead).push({
          job,
          reject,
          answered: (data) => {
            const read = readRender(job, data);
            if (read instanceof Error) reject(read);
            else resolve(read);
          },
        });
        pump();
      });
    },

    tail(rt, options, key) {
      const refused = refusal();
      if (refused !== null) return Promise.reject(refused);
      const job: SetDownTailJob = { kind: "tail", id: nextId(), key, rt, sampleRate: options.sampleRate, seed: options.seed, onsetSeconds: options.onsetSeconds };
      return new Promise<SetDownTail>((resolve, reject) => {
        const waiting: Waiting = {
          job,
          reject,
          answered: (data) => {
            const read = readTail(job, data);
            if (read instanceof Error) reject(read);
            else resolve(read);
          },
        };
        const queued = ahead.findIndex((other) => other.job.kind === "tail");
        if (queued < 0) {
          ahead.push(waiting);
          pump();
          return;
        }
        const [older] = ahead.splice(queued, 1, waiting);
        older?.reject(new SetDownCancelled("replaced", older.job.key));
      });
    },

    cancel(matches) {
      // Every match is asked before anything is dropped, so a match that throws changes nothing.
      const dropExact = exact.map((waiting) => matches(waiting.job.key));
      const dropAhead = ahead.map((waiting) => matches(waiting.job.key));
      const dropped = [...exact.filter((_, i) => dropExact[i] === true), ...ahead.filter((_, i) => dropAhead[i] === true)];
      const keptExact = exact.filter((_, i) => dropExact[i] !== true);
      const keptAhead = ahead.filter((_, i) => dropAhead[i] !== true);
      exact.splice(0, exact.length, ...keptExact);
      ahead.splice(0, ahead.length, ...keptAhead);
      for (const waiting of dropped) waiting.reject(new SetDownCancelled("cancelled", waiting.job.key));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      stopWorker();
      for (const waiting of takeAll()) waiting.reject(new SetDownCancelled("disposed", waiting.job.key));
    },
  };
}

// --- Reading answers -------------------------------------------------------------------

/**
 * The answer, if its shape is sound and it is not a refusal; otherwise the
 * error that rejects `job`. An answer naming another job by its id never
 * reaches here (answersAnotherJob); a refusal with no id (of a message the
 * Worker could not read as a job) is the running job's.
 */
function answerTo(job: SetDownJob, data: unknown): SetDownRenderAnswer | SetDownTailAnswer | Error {
  if (!isSetDownAnswer(data)) return new Error(`The set-down Worker's answer to ${named(job)} is malformed: ${setDownAnswerProblem(data) ?? "unreadable"}`);
  const answer = data;
  if (!answer.ok) return new Error(`The set-down Worker refused ${named(job)}: ${answer.error}`, { cause: answer.error });
  return answer;
}

/** Views on the answer's own buffers, after checking they hold one whole sample per frame each, at the rate asked. */
function channelsOf(job: SetDownJob, answer: SetDownRenderAnswer | SetDownTailAnswer, sampleRate: number): Stereo | Error {
  const { left, right } = answer;
  if (left.byteLength !== right.byteLength) {
    return new Error(`The set-down Worker answered ${named(job)} with channels of unequal length (${String(left.byteLength)} and ${String(right.byteLength)} bytes)`);
  }
  if (left.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    return new Error(`The set-down Worker answered ${named(job)} with channels that are not whole 4-byte samples (${String(left.byteLength)} bytes)`);
  }
  if (answer.sampleRate !== sampleRate) {
    return new Error(`The set-down Worker answered ${named(job)} at ${String(answer.sampleRate)} Hz, not the ${String(sampleRate)} Hz asked`);
  }
  return { left: new Float32Array(left), right: new Float32Array(right), sampleRate };
}

function readRender(job: SetDownRenderJob, data: unknown): SetDownRendered | Error {
  const answer = answerTo(job, data);
  if (answer instanceof Error) return answer;
  if (answer.kind !== "render") return new Error(`The set-down Worker answered ${named(job)} with a tail`);
  const stereo = channelsOf(job, answer, job.input.sampleRate);
  if (stereo instanceof Error) return stereo;
  return { ...stereo, peakDb: answer.peakDb, onsetSeconds: answer.onsetSeconds, limitDb: answer.limitDb, workMs: answer.workMs };
}

function readTail(job: SetDownTailJob, data: unknown): SetDownTail | Error {
  const answer = answerTo(job, data);
  if (answer instanceof Error) return answer;
  if (answer.kind !== "tail") return new Error(`The set-down Worker answered ${named(job)} with a render`);
  const stereo = channelsOf(job, answer, job.sampleRate);
  if (stereo instanceof Error) return stereo;
  return { ...stereo, workMs: answer.workMs };
}

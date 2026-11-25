import { AsyncLocalStorage } from "node:async_hooks";
import type { JobWorkerStatus } from "@omnitwin/types";
import type { Database } from "../../db/client.js";
import type { JobAlerts } from "./alerts.js";
import {
  ClaimLostError,
  jobErrorText,
  PermanentJobError,
  RetryJobIn,
  type JobContext,
  type JobLogger,
  type JobRegistry,
  type JobTransaction,
} from "./kinds.js";
import {
  CLAIM_MARGIN_SECONDS,
  claimNextJob,
  failJob,
  finishJob,
  handBackJob,
  LOST_CLAIM_PAUSE_SECONDS,
  planNextWake,
  recoverLostClaims,
  type ClaimedJob,
  type FailOutcome,
  type RecoveredJob,
} from "./store.js";

// ---------------------------------------------------------------------------
// The job list (T-702): the worker that runs inside each API process.
//
// One pass: put back every claim that has run out (raising `claimLost`, or
// `jobDead` when that was its second); take and run one job at a time until
// none is due, yielding to the event loop after each; call `afterPass` with
// the database's now; plan; and set one timer for the earlier of the next due
// job and the next boundary (with 60 minutes, the top of the hour). It does
// not poll: between passes it asks the database nothing. It wakes when that
// timer fires, when it starts, and when poked by work this process has just
// committed. Pokes that come while a pass runs fold into one more pass. Every
// pass begins in the async context the worker was built in (start-up, with no
// request), so a poke made inside a request lends that request's context to
// nothing the pass does: not its handlers, its alerts or its next timer.
//
// Node cannot stop a running function, and neither the database driver nor a
// provider's library times out by itself, so nothing the worker waits for is
// unbounded: each handler is raced against its kind's limit, and each of the
// worker's own database calls against a shorter one. When a limit wins, the
// worker stops waiting, aborts the handler's signal, records the try as
// failed and moves on. Whatever the loser does later is caught: the API has no
// last-resort handler for a stray rejection, so one left loose would end the
// server. A call of its own that answers after the worker gave up on it is
// dealt with too: a job it claimed is handed back, and the alerts for jobs it
// recovered are raised.
//
// A handler runs outside any transaction. One whose work only changes our own
// database opens its own transaction and calls `ctx.completeIn(tx)` there, so
// the change and `done` commit together. The database's clock decides what is
// due; this server's clock is read only for the status, which reports from
// memory and never touches the database.
// ---------------------------------------------------------------------------

export interface JobWorkerDeps {
  readonly db: Database;
  readonly registry: JobRegistry;
  readonly serverId: string;
  readonly logger: JobLogger;
  readonly alerts: JobAlerts;
  readonly sleepMinutes?: number;            // default 60; from JOBS_MAX_SLEEP_MINUTES
  readonly dbCallTimeoutMs?: number;         // default 10_000
  readonly faultRetryMs?: number;            // default 60_000
  readonly lostClaimPauseSeconds?: number;   // default LOST_CLAIM_PAUSE_SECONDS; tests pass 0
  /** Called at the end of every pass with the database's now; Task 6 uses it for work that repeats. */
  readonly afterPass?: (now: Date) => Promise<void>;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly yieldToLoop?: () => Promise<void>;   // default: setImmediate
}

/** The one definition lives in `@omnitwin/types` (`JobWorkerStatusSchema`), which Stuck work also answers with. */
export type { JobWorkerStatus };

const DEFAULT_SLEEP_MINUTES = 60;
const DEFAULT_DB_CALL_TIMEOUT_MS = 10_000;
const DEFAULT_FAULT_RETRY_MS = 60_000;
/** The longest wait a Node timer keeps; a longer one fires at once. */
const MAX_TIMER_MS = 2_147_483_647;
/** Never spin: a wake already due (a job another taker held as this pass looked) still waits a beat. */
const MIN_WAKE_MS = 250;
/** A handler's own wait (`RetryJobIn`) is held to between one second and seven days. */
const MIN_RETRY_SECONDS = 1;
const MAX_RETRY_SECONDS = 604_800;
/** The reason `recoverLostClaims` records on the row. */
const LOST_CLAIM_REASON = "The server that took this job never answered.";
const STOPPING_REASON = "The server is stopping.";

type Fault = "database" | "loop";
type EndReason = "limit" | "stop";
type FailOptions = { readonly permanent: boolean; readonly retryInSeconds?: number };

type HandlerOutcome =
  | { readonly kind: "returned" }
  | { readonly kind: "threw"; readonly error: unknown }
  | { readonly kind: "ended"; readonly by: EndReason };

type Raced<T> =
  | { readonly outcome: "answered"; readonly value: T }
  | { readonly outcome: "failed"; readonly error: unknown }
  | { readonly outcome: "limit" };

interface RunningJob {
  readonly id: string;
  readonly kind: string;
  readonly since: number;
  /** Settles when the handler returns or throws, or when the worker stops waiting for it. Never rejects. */
  readonly answered: Promise<unknown>;
  /** Stops waiting for the handler and aborts its signal. False if it had already answered. */
  readonly end: (by: EndReason) => boolean;
}

/** One of the worker's own database calls failed or passed its limit. */
class WorkerDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerDatabaseError";
  }
}

/** A promise that the first answer settles; later answers are refused. */
class FirstAnswer<T> {
  readonly promise: Promise<T>;
  #resolve: (value: T) => void = () => undefined;
  #answered = false;

  constructor() {
    this.promise = new Promise<T>((resolve) => { this.#resolve = resolve; });
  }

  /** True if this was the first answer. */
  give(value: T): boolean {
    if (this.#answered) return false;
    this.#answered = true;
    this.#resolve(value);
    return true;
  }
}

/** Calls `start`: a synchronous throw becomes a rejection, and a value that is not a promise a resolution. */
function promiseOf<T>(start: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve) => { resolve(start()); });
}

/**
 * Runs `act`, which logs or alerts from a callback nobody awaits. A throw
 * there would be a stray rejection, which ends the server, so it is dropped.
 */
function quietly(act: () => void): void {
  try {
    act();
  } catch {
    // The logger or a reporter itself failed: nothing is left to tell.
  }
}

/**
 * Waits for `promise` for at most `ms`. Its handlers are attached before the
 * race begins, so whatever it does after losing goes to `late`, never to an
 * unhandled rejection. The timer is cleared when the promise answers in time,
 * and never keeps the process alive.
 */
function withLimit<T>(
  promise: Promise<T>,
  ms: number,
  late: { readonly value: (value: T) => void; readonly failure: (error: unknown) => void },
): Promise<Raced<T>> {
  const answer = new FirstAnswer<Raced<T>>();
  const timer = setTimeout(() => { answer.give({ outcome: "limit" }); }, ms);
  timer.unref();
  promise.then(
    (value) => {
      clearTimeout(timer);
      if (!answer.give({ outcome: "answered", value })) quietly(() => { late.value(value); });
    },
    (error: unknown) => {
      clearTimeout(timer);
      if (!answer.give({ outcome: "failed", error })) quietly(() => { late.failure(error); });
    },
  );
  return answer.promise;
}

/** True if `promise` settles within `ms`. This timer does hold the process: a stop is waited for. */
function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { resolve(false); }, ms);
    const settled = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    promise.then(settled, settled);
  });
}

/** A handler's own wait, held to between one second and seven days; NaN takes the usual wait. */
function heldRetrySeconds(seconds: number): number | undefined {
  if (Number.isNaN(seconds)) return undefined;
  return Math.min(MAX_RETRY_SECONDS, Math.max(MIN_RETRY_SECONDS, seconds));
}

/** A wait a Node timer can hold: whole milliseconds, at least a beat, at most what a timer keeps. */
function timerMs(ms: number): number {
  return Math.min(MAX_TIMER_MS, Math.max(MIN_WAKE_MS, Math.ceil(ms)));
}

function checkedMs(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 1 || value > MAX_TIMER_MS) {
    throw new RangeError(`${name} must be a number of milliseconds from 1 to ${String(MAX_TIMER_MS)}`);
  }
  return value;
}

function jobFields(job: { readonly id: string; readonly kind: string; readonly venueId: string | null }): Record<string, unknown> {
  return { jobId: job.id, kind: job.kind, venueId: job.venueId };
}

function defaultSetTimer(callback: () => void, ms: number): unknown {
  const handle = setTimeout(callback, ms);
  handle.unref();
  return handle;
}

function defaultClearTimer(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function defaultYieldToLoop(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve); });
}

export class JobWorker {
  readonly #db: Database;
  readonly #registry: JobRegistry;
  readonly #serverId: string;
  readonly #logger: JobLogger;
  readonly #alerts: JobAlerts;
  readonly #sleepMinutes: number;
  readonly #dbCallTimeoutMs: number;
  readonly #faultRetryMs: number;
  readonly #lostClaimPauseSeconds: number;
  readonly #afterPass: ((now: Date) => Promise<void>) | undefined;
  readonly #setTimer: (callback: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #yieldToLoop: () => Promise<void>;
  /**
   * The async context the worker was built in (start-up, with no request).
   * Every pass begins in it, so nothing a pass does runs in a poker's context.
   */
  readonly #inOwnContext = AsyncLocalStorage.snapshot();

  #started = false;
  /** stop() was called: take nothing new and set no timer. A stopped worker stays stopped. */
  #stopping = false;
  #stopDone: Promise<void> | null = null;
  /** A pass has been asked for and begins on the next microtask: pokes in the same tick fold into it. */
  #passQueued = false;
  /** A pass is running, with any that pokes have folded in after it. */
  #passRunning = false;
  /** A poke came while a pass was running: run once more when it ends. */
  #pokePending = false;
  #cycleDone: Promise<void> = Promise.resolve();
  #timer: { handle: unknown } | null = null;
  #nextWakeAt: number | null = null;
  #lastPassAt: number | null = null;
  #current: RunningJob | null = null;
  #abandonedHandlers = 0;
  #fault: Fault | null = null;

  constructor(deps: JobWorkerDeps) {
    const sleepMinutes = deps.sleepMinutes ?? DEFAULT_SLEEP_MINUTES;
    if (!Number.isFinite(sleepMinutes) || sleepMinutes <= 0) {
      throw new RangeError("sleepMinutes must be a finite number above 0");
    }
    const lostClaimPauseSeconds = deps.lostClaimPauseSeconds ?? LOST_CLAIM_PAUSE_SECONDS;
    if (!Number.isFinite(lostClaimPauseSeconds) || lostClaimPauseSeconds < 0) {
      throw new RangeError("lostClaimPauseSeconds must be a finite number of seconds from 0");
    }
    this.#db = deps.db;
    this.#registry = deps.registry;
    this.#serverId = deps.serverId;
    this.#logger = deps.logger;
    this.#alerts = deps.alerts;
    this.#sleepMinutes = sleepMinutes;
    this.#dbCallTimeoutMs = checkedMs(deps.dbCallTimeoutMs ?? DEFAULT_DB_CALL_TIMEOUT_MS, "dbCallTimeoutMs");
    if (this.#dbCallTimeoutMs >= CLAIM_MARGIN_SECONDS * 1000) {
      // A claim lasts the kind's limit plus the margin, counted from the claim's own statement. The handler
      // starts when the claim answers, up to this limit later, and is waited for until the kind's limit. Only
      // while this limit is under the margin has the worker always stopped waiting before the claim runs out.
      throw new RangeError(
        `dbCallTimeoutMs must be under the claim's margin of ${String(CLAIM_MARGIN_SECONDS * 1000)} ms: a claim answered later than that could outlive its own lease`,
      );
    }
    this.#faultRetryMs = checkedMs(deps.faultRetryMs ?? DEFAULT_FAULT_RETRY_MS, "faultRetryMs");
    this.#lostClaimPauseSeconds = lostClaimPauseSeconds;
    this.#afterPass = deps.afterPass;
    this.#setTimer = deps.setTimer ?? defaultSetTimer;
    this.#clearTimer = deps.clearTimer ?? defaultClearTimer;
    this.#yieldToLoop = deps.yieldToLoop ?? defaultYieldToLoop;
  }

  /** Plans from the database. Returns at once. */
  start(): void {
    if (this.#started || this.#stopping) return;
    this.#started = true;
    this.#wake();
  }

  /** Wakes it now. Calls made while a pass is running fold into one more pass. */
  poke(): void {
    this.#wake();
  }

  /** Takes nothing new, waits up to graceMs for the running job, hands back what is unfinished. */
  stop(graceMs: number): Promise<void> {
    if (this.#stopDone === null) {
      this.#stopping = true;
      this.#started = false;
      this.#passQueued = false;
      this.#pokePending = false;
      this.#clearWakeTimer();
      const grace = Number.isNaN(graceMs) ? 0 : Math.min(MAX_TIMER_MS, Math.max(0, graceMs));
      this.#stopDone = this.#drain(grace);
    }
    // A second call is the same stop: the first call's grace stands.
    return this.#stopDone;
  }

  /** From memory only. Never touches the database. */
  status(): JobWorkerStatus {
    const current = this.#current;
    return {
      started: this.#started,
      lastPassAt: this.#lastPassAt,
      nextWakeAt: this.#nextWakeAt,
      currentJob: current === null ? null : { id: current.id, kind: current.kind, since: current.since },
      abandonedHandlers: this.#abandonedHandlers,
      fault: this.#fault,
      passRunning: this.#passQueued || this.#passRunning,
    };
  }

  // Read through methods: a stop or a poke may arrive during any await, which
  // the type narrowing of a field cannot see.
  #isStopping(): boolean {
    return this.#stopping;
  }

  #hasPendingPoke(): boolean {
    return this.#pokePending;
  }

  #wake(): void {
    if (!this.#started || this.#stopping) return;
    if (this.#passRunning) {
      this.#pokePending = true;
      return;
    }
    if (this.#passQueued) return;
    this.#passQueued = true;
    // The microtask would run in the caller's async context (a request's, for a poke), and the pass, its
    // handlers, alerts and next timer would inherit it. It runs in the worker's own instead.
    queueMicrotask(() => { this.#inOwnContext(() => { this.#beginCycle(); }); });
  }

  #beginCycle(): void {
    // stop() withdraws a pass that was asked for and has not begun.
    if (!this.#passQueued) return;
    this.#passQueued = false;
    this.#passRunning = true;
    this.#clearWakeTimer();
    this.#cycleDone = this.#runCycle();
  }

  /** A pass, then one more for each batch of pokes that came while it ran, then one timer. Never rejects. */
  async #runCycle(): Promise<void> {
    let waitMs: number | null;
    try {
      do {
        this.#pokePending = false;
        waitMs = await this.#onePass();
      } while (this.#hasPendingPoke() && !this.#isStopping());
    } catch {
      // #onePass answers every failure of a pass itself; this is reached only if
      // that answer threw (the logger, say). Show a fault, tell a person once,
      // and try again later. Not through #alert, whose catch logs, and the
      // logger may be what threw: this catch must never throw, because
      // #cycleDone is awaited only by a stop.
      if (this.#fault === null) {
        this.#fault = "loop";
        try {
          this.#alerts.workerFault("loop", "The worker's own handling of a failed pass threw.");
        } catch {
          // The reporter failed too: the fault shows in the status, and nothing is left to tell.
        }
      }
      waitMs = this.#faultRetryMs;
    }
    this.#passRunning = false;
    if (!this.#isStopping() && waitMs !== null) this.#setWakeTimer(waitMs);
  }

  /** Milliseconds to sleep, or null when stopping. A failed pass is a fault, and sleeps `faultRetryMs`. */
  async #onePass(): Promise<number | null> {
    try {
      const waitMs = await this.#pass();
      if (waitMs !== null) this.#passCompleted();
      return waitMs;
    } catch (error: unknown) {
      this.#passFailed(error);
      return this.#isStopping() ? null : this.#faultRetryMs;
    }
  }

  async #pass(): Promise<number | null> {
    const recovered = await this.#query(
      "recoverLostClaims",
      () => recoverLostClaims(this.#db, this.#lostClaimPauseSeconds),
      (late) => { this.#announceRecovered(late); },
    );
    this.#announceRecovered(recovered);

    while (!this.#isStopping()) {
      const job = await this.#query(
        "claimNextJob",
        () => claimNextJob(this.#db, this.#registry, this.#serverId),
        (late) => { if (late !== null) this.#handBackLate(late); },
      );
      if (job === null) break;
      if (this.#isStopping()) {
        // stop() came while the claim was in flight: take nothing new.
        await this.#handBack(job);
        break;
      }
      await this.#runJob(job);
      await this.#yieldToLoop();
    }
    if (this.#isStopping()) return null;

    // `afterPass` writes work that repeats, and needs the database's now; the
    // plan that sets the timer comes after it, so it sees what was written.
    const afterPass = this.#afterPass;
    if (afterPass !== undefined) {
      const { now } = await this.#query("planNextWake", () => this.#plan());
      await this.#query("afterPass", () => afterPass(now));
    }
    const plan = await this.#query("planNextWake", () => this.#plan());
    const seconds = plan.dueInSeconds === null ? plan.boundaryInSeconds : Math.min(plan.dueInSeconds, plan.boundaryInSeconds);
    return seconds * 1000;
  }

  #plan(): ReturnType<typeof planNextWake> {
    return planNextWake(this.#db, this.#registry, this.#sleepMinutes);
  }

  async #runJob(job: ClaimedJob): Promise<void> {
    const definition = this.#registry.get(job.kind);
    if (definition === undefined) {
      // Cannot happen: a claim takes only the kinds in this registry. Never left claimed if it does.
      this.#logger.error(jobFields(job), "the job worker has no handler for a job it took");
      await this.#fail(job, "This server has no handler for the job's kind.", { permanent: false });
      return;
    }

    const limitText = `The handler passed its time limit of ${String(definition.timeoutMs)} ms.`;
    const controller = new AbortController();
    const answer = new FirstAnswer<HandlerOutcome>();
    const progress = { completed: false };
    const end = (by: EndReason): boolean => {
      if (!answer.give({ kind: "ended", by })) return false;
      this.#abandonedHandlers += 1;
      controller.abort(new Error(by === "limit" ? limitText : STOPPING_REASON));
      return true;
    };
    const context: JobContext<unknown> = {
      db: this.#db,
      jobId: job.id,
      venueId: job.venueId,
      payload: job.payload,
      attempt: job.attempts,
      signal: controller.signal,
      logger: this.#logger,
      completeIn: async (tx: JobTransaction): Promise<void> => {
        if (!(await finishJob(tx, job.id, job.claimToken))) {
          throw new ClaimLostError("The claim on this job passed to another taker.");
        }
        progress.completed = true;
      },
    };

    this.#current = { id: job.id, kind: job.kind, since: Date.now(), answered: answer.promise, end };
    const limit = setTimeout(() => { end("limit"); }, definition.timeoutMs);
    limit.unref();
    try {
      promiseOf(() => definition.run(context)).then(
        () => {
          if (!answer.give({ kind: "returned" })) {
            quietly(() => {
              this.#logger.info(jobFields(job), "an abandoned handler finished after the worker stopped waiting for it");
            });
          }
        },
        (error: unknown) => {
          if (!answer.give({ kind: "threw", error })) {
            quietly(() => {
              this.#logger.warn(
                { ...jobFields(job), error: jobErrorText(error) },
                "an abandoned handler failed after the worker stopped waiting for it",
              );
            });
          }
        },
      );
      const outcome = await answer.promise;
      clearTimeout(limit);
      await this.#record(job, outcome, limitText, progress.completed);
    } finally {
      clearTimeout(limit);
      this.#current = null;
    }
  }

  async #record(job: ClaimedJob, outcome: HandlerOutcome, limitText: string, completed: boolean): Promise<void> {
    switch (outcome.kind) {
      case "returned": {
        // A handler that called completeIn is done already, in its own transaction.
        if (completed) return;
        const finished = await this.#query("finishJob", () => finishJob(this.#db, job.id, job.claimToken));
        if (!finished) this.#logger.warn(jobFields(job), "a job finished after its claim had gone");
        return;
      }
      case "ended":
        if (outcome.by === "stop") {
          await this.#handBack(job);
          return;
        }
        await this.#fail(job, limitText, { permanent: false });
        return;
      case "threw":
        await this.#failFor(job, outcome.error);
        return;
    }
  }

  async #failFor(job: ClaimedJob, error: unknown): Promise<void> {
    if (error instanceof ClaimLostError) {
      // The claim passed to another taker: the row is theirs now, and nothing is written.
      this.#logger.warn(jobFields(job), "a handler found its claim had passed to another taker");
      return;
    }
    const text = jobErrorText(error);
    if (error instanceof PermanentJobError) {
      await this.#fail(job, text, { permanent: true });
    } else if (error instanceof RetryJobIn) {
      await this.#fail(job, text, { permanent: false, retryInSeconds: heldRetrySeconds(error.seconds) });
    } else {
      await this.#fail(job, text, { permanent: false });
    }
  }

  /**
   * Records a failed try. If that fails for any reason, once more on the usual wait: no claim is left standing.
   * Either call may be the one that recorded it, even one that answered after the worker stopped waiting for
   * it, so whichever answer brings "dead" or "queued" first is told, once: a job that went dead always raises
   * its alert.
   */
  async #fail(job: ClaimedJob, text: string, options: FailOptions): Promise<void> {
    // An object, not a `let`: the type checker cannot see a closure set it, and would read `told` as always false.
    const said = { told: false };
    const tell = (outcome: FailOutcome): void => {
      if (outcome === "lost" || said.told) return;
      said.told = true;
      if (outcome === "dead") {
        this.#logger.error({ ...jobFields(job), error: text }, "a job is dead");
        this.#alert(() => { this.#alerts.jobDead({ id: job.id, kind: job.kind, venueId: job.venueId, reason: text }); });
      } else {
        this.#logger.warn({ ...jobFields(job), error: text }, "a job failed and will be tried again");
      }
    };
    let outcome: FailOutcome;
    try {
      outcome = await this.#query("failJob", () => failJob(this.#db, job.id, job.claimToken, text, options), tell);
    } catch (error: unknown) {
      this.#logger.warn({ ...jobFields(job), error: jobErrorText(error) }, "recording a failed try failed; trying once more with the usual wait");
      outcome = await this.#query(
        "failJob",
        () => failJob(this.#db, job.id, job.claimToken, text, { permanent: options.permanent }),
        tell,
      );
    }
    tell(outcome);
    if (outcome === "lost" && !said.told) {
      this.#logger.warn(jobFields(job), "a failed try was not recorded by this call: the claim had gone, or an earlier call recorded it");
    }
  }

  /** Gives the job back without counting the try. */
  async #handBack(job: ClaimedJob): Promise<void> {
    const handedBack = await this.#query("handBackJob", () => handBackJob(this.#db, job.id, job.claimToken));
    this.#logger.info({ ...jobFields(job), handedBack }, "the job worker is stopping and handed a job back");
  }

  /** A claim answered after the worker gave up on it: nobody is running its job, so it goes straight back. */
  #handBackLate(job: ClaimedJob): void {
    handBackJob(this.#db, job.id, job.claimToken).then(
      (handedBack) => {
        quietly(() => {
          this.#logger.warn({ ...jobFields(job), handedBack }, "a claim answered after its limit; its job was handed back");
        });
      },
      (error: unknown) => {
        quietly(() => {
          this.#logger.warn(
            { ...jobFields(job), error: jobErrorText(error) },
            "a claim answered after its limit and its job could not be handed back; the claim will run out",
          );
        });
      },
    );
  }

  #announceRecovered(rows: readonly RecoveredJob[]): void {
    for (const job of rows) {
      const fields = { ...jobFields(job), lostClaims: job.lostClaims };
      if (job.state === "dead") {
        this.#logger.error(fields, "a job is dead: the server that took it never answered");
        this.#alert(() => { this.#alerts.jobDead({ id: job.id, kind: job.kind, venueId: job.venueId, reason: LOST_CLAIM_REASON }); });
      } else {
        this.#logger.warn(fields, "a claim ran out and its job was put back");
        this.#alert(() => { this.#alerts.claimLost({ id: job.id, kind: job.kind, venueId: job.venueId, lostClaims: job.lostClaims }); });
      }
    }
  }

  /** An alert that throws must not stop the list. */
  #alert(raise: () => void): void {
    try {
      raise();
    } catch (error: unknown) {
      this.#logger.error({ error: jobErrorText(error) }, "a job alert could not be raised");
    }
  }

  /**
   * One of the worker's own database calls, raced against `dbCallTimeoutMs`.
   * A rejection or the limit is a `WorkerDatabaseError`, which ends the pass as
   * a database fault. What the call does after losing is caught: a failure is
   * logged, a value goes to `lateValue`.
   */
  async #query<T>(what: string, call: () => Promise<T>, lateValue?: (value: T) => void): Promise<T> {
    const raced = await withLimit(promiseOf(call), this.#dbCallTimeoutMs, {
      value: (value) => { lateValue?.(value); },
      failure: (error) => {
        this.#logger.warn({ call: what, error: jobErrorText(error) }, "a database call failed after the worker stopped waiting for it");
      },
    });
    if (raced.outcome === "answered") return raced.value;
    if (raced.outcome === "failed") throw new WorkerDatabaseError(`${what} failed: ${jobErrorText(raced.error)}`);
    throw new WorkerDatabaseError(`${what} passed its time limit of ${String(this.#dbCallTimeoutMs)} ms.`);
  }

  #passCompleted(): void {
    this.#lastPassAt = Date.now();
    const fault = this.#fault;
    if (fault === null) return;
    this.#fault = null;
    this.#logger.info({ fault }, "the job worker has recovered");
    this.#alert(() => { this.#alerts.workerRecovered(fault); });
  }

  /** The fault keeps the kind it began with until a pass completes: one alert for one outage. */
  #passFailed(error: unknown): void {
    const what: Fault = error instanceof WorkerDatabaseError ? "database" : "loop";
    const detail = jobErrorText(error);
    this.#logger.error({ fault: what, error: detail }, "a job worker pass failed");
    if (this.#fault !== null) return;
    this.#fault = what;
    this.#alert(() => { this.#alerts.workerFault(what, detail); });
  }

  async #drain(graceMs: number): Promise<void> {
    const current = this.#current;
    if (current !== null && !(await settlesWithin(current.answered, graceMs))) {
      current.end("stop");
    }
    // The pass ends once the running job's outcome or hand-back is written, or
    // the call it was in answers (each bounded by a limit), and plans nothing more.
    await this.#cycleDone;
  }

  #setWakeTimer(ms: number): void {
    this.#clearWakeTimer();
    const wait = timerMs(ms);
    const timer: { handle: unknown } = { handle: null };
    timer.handle = this.#setTimer(() => {
      // A timer cleared after it was due may still call back; it wakes nothing.
      if (this.#timer !== timer) return;
      this.#timer = null;
      this.#nextWakeAt = null;
      this.#wake();
    }, wait);
    this.#timer = timer;
    this.#nextWakeAt = Date.now() + wait;
  }

  #clearWakeTimer(): void {
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer.handle);
      this.#timer = null;
    }
    this.#nextWakeAt = null;
  }
}

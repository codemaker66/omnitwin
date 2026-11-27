import { AsyncLocalStorage } from "node:async_hooks";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { requests } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { captureBackgroundError, inOwnScope } from "../observability/sentry.js";
import { sqlStateOf } from "../utils/sql-state.js";
import { quietHoursEndAfter } from "./escalation-clock.js";
import { readOperatingSettings } from "./venue-operating-settings.js";
import {
  EscalationEmailPassIncomplete,
  UNOWNED_ESCALATING_STATES,
  notHeldAt,
  runEscalationEmailPass,
  runRequestEscalationPass,
  type EscalatedRequest,
  type EscalationEmailSent,
  type EscalationPassFailure,
  type EscalationPassResult,
} from "./requests.js";

// ---------------------------------------------------------------------------
// When the escalation sweep runs (goal 19 S7; the 18 October outage).
//
// Slice 10 swept every 15 seconds, which kept the production database awake
// around the clock and used up Neon's compute hours. The sweep now wakes only
// when something is due: the soonest window of a sent request, the soonest
// relief deadline of a handed-over request, or the end of quiet hours for a
// venue with an email waiting. With nothing due it sets no timer and the
// database may sleep. A request raised or handed over in this process pokes
// the scheduler, which plans again from the database; on start it plans from
// the database too, so nothing is lost across a restart. One API replica is
// assumed for the wake; the passes themselves stay safe for two, since the
// claim is a conditional UPDATE. The escalation-pass endpoint stays for an
// external cron.
// ---------------------------------------------------------------------------

/** Never sleep longer than this: a plan is cheap, a missed wake is not. */
export const MAX_SLEEP_MS = 6 * 3_600_000;
/** Never spin: a due instant in the past still waits a beat. */
export const MIN_SLEEP_MS = 250;
/** An escalation email that could not be sent (Resend down, an address
 *  refused) is tried again this often, not every beat: the wait keeps the
 *  database asleep between tries and ends when the request is taken. */
export const EMAIL_RETRY_MS = 15 * 60_000;

/** When an email still waiting outside quiet hours is next tried: a while
 *  after the email pass last ran (`emailPassAtMs`), and never before now. The
 *  deadline is anchored to that run, not to the plan: every raise and every
 *  handover plans again, and a wait counted from each plan was pushed out by
 *  each of them, so on a busy day a failed email waited for a lull (#495,
 *  F-B; from 18 October). With no run yet it counts from now. */
export function emailRetryAt(nowMs: number, emailPassAtMs: number | null): number {
  return Math.max(nowMs, (emailPassAtMs ?? nowMs) + EMAIL_RETRY_MS);
}

/** A plan that failed (the database away, say) is tried again after this. */
export const PLAN_RETRY_MS = 60_000;
/** While the pass keeps failing as a whole (its read of what is due, not one
 *  request: those take REQUEST_RETRY_*, LN1), the next pass waits at least
 *  this long after the first failure, doubling with each one after, up to
 *  PASS_RETRY_MAX_MS.
 *  A pass that fails before it claims a request leaves that request's window
 *  overdue, so the plan after it would wake a beat later: a failure that
 *  stays (schema drift, say, where the pass's full-row select fails and the
 *  plan's narrow selects do not) ran about four passes a second, each logged.
 *  The first wait is short because a blip is the likelier failure and an
 *  urgent request's window is two minutes by default. A failure that stays
 *  reaches a minute between tries within about a minute, and still queries
 *  once a minute while it lasts, so the database does not scale down then;
 *  the hourly report is the alarm. The wait is a deadline set at the failure:
 *  a poke during the streak arms at it, never later (T-766). */
export const PASS_RETRY_FIRST_MS = 5_000;
export const PASS_RETRY_MAX_MS = 60_000;

/** The least wait before the next pass, after this many failures in a row. */
export function passRetryAfter(failures: number): number {
  return Math.min(PASS_RETRY_MAX_MS, PASS_RETRY_FIRST_MS * 2 ** Math.max(0, failures - 1));
}
/** While a step keeps failing, Sentry hears of its first failure, then once
 *  an hour: enough to raise an alert, and to reopen one resolved while the
 *  sweep is still failing, without an event at every try. Every failure is
 *  logged (T-766). */
export const FAILURE_REPORT_EVERY_MS = 3_600_000;

/** A request the escalation pass keeps failing on is held back from the
 *  candidates and the plan until a deadline of its own: this long after its
 *  first failure, doubling with each one after, up to REQUEST_RETRY_MAX_MS.
 *  The rest of the sweep runs as if it were not there, and with nothing else
 *  due the database sleeps between its tries. Nothing is dropped: once its
 *  deadline passes it is tried again (#495's review, LN1). */
export const REQUEST_RETRY_FIRST_MS = 5_000;
/** An hour, as the alarm's own cadence: well past the database's five idle
 *  minutes, so a request that always fails costs one try an hour. */
export const REQUEST_RETRY_MAX_MS = 3_600_000;

/** The deadline's distance after this many failures in a row of one request. */
export function requestRetryAfter(failures: number): number {
  return Math.min(REQUEST_RETRY_MAX_MS, REQUEST_RETRY_FIRST_MS * 2 ** Math.max(0, failures - 1));
}

/** A request held back after its claim failed: the instant it was due at
 *  when it failed, and the deadline before which it is not tried. The hold
 *  lasts only while the request is still due at that instant: taken and
 *  handed over, or reopened, it falls due anew at once (#495's review, LQ2). */
export interface HeldRequest {
  readonly dueAt: number;
  readonly until: number;
}

/** The SQLSTATE an error carries, on it or on a cause up to a few levels down
 *  (an email failure wraps drizzle's error, which wraps the driver's). */
function sqlStateIn(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    const code = sqlStateOf(current);
    if (code !== null) return code;
    current = current instanceof Error ? current.cause : undefined;
  }
  return null;
}

/** Whose fault a failure on one request is (#495's review, LQ1).
 *  - The request's own when its error is a data or integrity error (SQLSTATE
 *    classes 22 and 23, such as LN2's 22001, or a constraint refusing that
 *    row): it takes a floor and an alarm of its own, and costs the rest of
 *    the sweep nothing.
 *  - The sweep's when it is any other database error: a connection,
 *    transaction-state, rollback, resource, lock, cancel or internal one
 *    (classes 08, 25, 40, 53, 55, 57, XX, and the rest), which would fail
 *    the next request as well. A claim error with no SQLSTATE (the pool or
 *    the driver giving up) is the sweep's too. It takes the wake's own
 *    back-off and its one alarm (T-766) and advances no request's floor, so
 *    every request is tried again within PASS_RETRY_MAX_MS of recovery.
 *  - An email step's error with no SQLSTATE (its template, say) holds
 *    nothing and stays the request's. */
export function faultOf(failure: EscalationPassFailure): "request" | "sweep" {
  const code = sqlStateIn(failure.error);
  if (code !== null) return code.startsWith("22") || code.startsWith("23") ? "request" : "sweep";
  return failure.step === "email" ? "request" : "sweep";
}

/** The two steps of a wake that can fail as a whole, each on a streak of its own. */
export type SweepStage = "plan" | "pass";
/** What a report names: a step, the announcement after a pass that
 *  succeeded, or one request's claim or email (named by its id). */
export type ReportedStage = SweepStage | "announce" | EscalationPassFailure["step"];

export function soonest(instants: readonly (number | null)[]): number | null {
  let best: number | null = null;
  for (const instant of instants) {
    if (instant === null) continue;
    if (best === null || instant < best) best = instant;
  }
  return best;
}

/** How long to sleep before the next wake, or null for no timer at all. */
export function sleepFor(wakeMs: number | null, nowMs: number): number | null {
  if (wakeMs === null) return null;
  return Math.min(MAX_SLEEP_MS, Math.max(MIN_SLEEP_MS, wakeMs - nowMs));
}

/** The next instant anything is due, read from the database. Null when
 *  nothing is: no sent or reopened request with a window, no handover with a relief
 *  deadline, no email waiting out quiet hours. A held request (`held`, LN1)
 *  counts at its own deadline, not at its window, while it is still due at
 *  the instant its claim failed (LQ2). An email waiting outside quiet hours
 *  counts from the email pass's last run (`emailPassAtMs`, F-B). */
export async function planNextWake(
  db: Database,
  nowMs: number,
  held: ReadonlyMap<string, HeldRequest> = new Map(),
  emailPassAtMs: number | null = null,
): Promise<number | null> {
  const notHeld = notHeldAt(new Map([...held].map(([requestId, hold]) => [requestId, hold.dueAt])));
  const [nextWindow] = await db
    .select({ at: requests.escalationDueAt })
    .from(requests)
    .where(and(inArray(requests.state, [...UNOWNED_ESCALATING_STATES]), isNull(requests.escalatedAt), isNotNull(requests.escalationDueAt), notHeld))
    .orderBy(asc(requests.escalationDueAt))
    .limit(1);
  const [nextRelief] = await db
    .select({ at: requests.handoverDueAt })
    .from(requests)
    .where(and(eq(requests.state, "handed-over"), isNull(requests.escalatedAt), isNotNull(requests.handoverDueAt), notHeld))
    .orderBy(asc(requests.handoverDueAt))
    .limit(1);
  const waiting = await db
    .selectDistinct({ venueId: requests.venueId })
    .from(requests)
    .where(and(isNotNull(requests.escalatedAt), isNull(requests.escalationEmailedAt), inArray(requests.state, [...UNOWNED_ESCALATING_STATES, "handed-over"])));

  const emailWakes: (number | null)[] = [];
  for (const { venueId } of waiting) {
    const settings = await readOperatingSettings(db, venueId);
    // Inside quiet hours the email is due when they end. Outside them an
    // email still waiting is one that failed to send (the escalation pass
    // sends at once otherwise): try again after a while, not every beat.
    const quietEnd = settings === null ? nowMs : quietHoursEndAfter(nowMs, { start: settings.quietHoursStart, end: settings.quietHoursEnd });
    emailWakes.push(quietEnd <= nowMs ? emailRetryAt(nowMs, emailPassAtMs) : quietEnd);
  }
  return soonest([
    nextWindow?.at?.getTime() ?? null,
    nextRelief?.at?.getTime() ?? null,
    ...emailWakes,
    ...[...held.values()].map((hold) => hold.until),
  ]);
}

export interface EscalationSchedulerDeps {
  readonly db: Database;
  readonly logger?: FastifyBaseLogger;
  /** What the sweep announces once requests have escalated. */
  readonly onEscalated: (escalated: readonly EscalatedRequest[]) => void;
  readonly now?: () => number;
  /** Injected in tests; default: the two passes, then the plan. `held` and
   *  `skip` are the requests held back until their own deadlines (LN1), each
   *  with the due instant it failed at (LQ2); `emailPassAtMs` is when the
   *  email pass last ran (F-B). */
  readonly plan?: (db: Database, nowMs: number, held: ReadonlyMap<string, HeldRequest>, emailPassAtMs: number | null) => Promise<number | null>;
  readonly run?: (db: Database, skip: ReadonlyMap<string, number>) => Promise<SweepOutcome>;
  /** Where a failure goes beyond the log, at the start of its streak and
   *  hourly after; one request's failure names the request. Injected in
   *  tests; default: Sentry, on the wake's own scope and trace
   *  (`captureBackgroundError`). */
  readonly report?: (error: unknown, stage: ReportedStage, requestId?: string) => void;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

function reportToSentry(error: unknown, stage: ReportedStage, requestId?: string): void {
  captureBackgroundError(error, {
    "background.task": "escalation-sweep",
    "escalation.stage": stage,
    // A request's id is a UUID: it names the request, and no person.
    ...(requestId === undefined ? {} : { "escalation.request": requestId }),
  });
}

/** One step's run of failures: when it began, how many, and when it was
 *  last reported. */
class FailureStreak {
  #since: number | null = null;
  #failures = 0;
  #reportedAt = 0;

  get failing(): boolean {
    return this.#since !== null;
  }

  /** How many failures in a row this streak holds; 0 when it is not failing. */
  get failures(): number {
    return this.#failures;
  }

  /** Counts a failure, and says whether this one is reported. */
  failed(nowMs: number): { readonly report: boolean; readonly failures: number; readonly failingForMs: number } {
    this.#failures += 1;
    const report = this.#since === null || nowMs - this.#reportedAt >= FAILURE_REPORT_EVERY_MS;
    this.#since ??= nowMs;
    if (report) this.#reportedAt = nowMs;
    return { report, failures: this.#failures, failingForMs: nowMs - this.#since };
  }

  /** Ends the run of failures, and says what it was; null when there was none. */
  ended(nowMs: number): { readonly failures: number; readonly failedForMs: number } | null {
    if (this.#since === null) return null;
    const run = { failures: this.#failures, failedForMs: nowMs - this.#since };
    this.#since = null;
    this.#failures = 0;
    return run;
  }
}

/** What a wake's passes did (T-768): the requests escalated, every one of
 *  which is to be announced; the requests a pass failed on through a fault
 *  of their own, each on a floor and an alarm of its own (LN1, LQ1); the
 *  requests whose email went to every duty admin and was marked (F-A); and
 *  what failed as the sweep's fault (a pass that failed as a whole, or a
 *  request's failure that was not its own), which alone takes the wake's own
 *  back-off (T-766). */
export interface SweepOutcome {
  readonly escalated: readonly EscalatedRequest[];
  readonly failed: readonly EscalationPassFailure[];
  readonly emailed: readonly string[];
  readonly passFailures: readonly unknown[];
}

/** The two passes a wake runs. Injected in tests. */
export interface SweepPasses {
  readonly escalate: (db: Database, deps: { readonly logger?: FastifyBaseLogger; readonly skip?: ReadonlyMap<string, number> }) => Promise<EscalationPassResult>;
  readonly email: (db: Database, deps: { readonly logger?: FastifyBaseLogger }) => Promise<readonly EscalationEmailSent[]>;
}

const SWEEP_PASSES: SweepPasses = { escalate: runRequestEscalationPass, email: runEscalationEmailPass };

/** The rows whose email went and was marked: a row the email pass tried
 *  whose send answered false is still waiting (F-A). */
function markedIds(sent: readonly EscalationEmailSent[]): string[] {
  return sent.filter((row) => row.marked).map((row) => row.requestId);
}

/** Runs the escalation pass, then the email pass, each on its own: an email
 *  pass that throws costs the escalation pass's list nothing, and a request
 *  the escalation pass failed on costs the email pass nothing (T-768). A
 *  throw from the escalation pass itself comes before any claim, and ends
 *  the wake before the email pass runs. */
export async function runSweepPasses(
  db: Database,
  logger?: FastifyBaseLogger,
  skip: ReadonlyMap<string, number> = new Map(),
  passes: SweepPasses = SWEEP_PASSES,
): Promise<SweepOutcome> {
  const pass = await passes.escalate(db, { logger, skip });
  const failed: EscalationPassFailure[] = [...pass.failed];
  const passFailures: unknown[] = [];
  let emailed: readonly string[] = [];
  try {
    emailed = markedIds(await passes.email(db, { logger }));
  } catch (error: unknown) {
    if (error instanceof EscalationEmailPassIncomplete) {
      emailed = markedIds(error.sent);
      failed.push(...error.failures.map((failure) => ({ requestId: failure.requestId, step: "email" as const, error: failure })));
    } else {
      passFailures.push(error);
    }
  }
  // An email the escalation pass failed on, which this wake's email pass then
  // sent and marked, is no failure at all (LN5).
  const sentNow = new Set(emailed);
  const own: EscalationPassFailure[] = [];
  for (const failure of failed) {
    if (failure.step === "email" && sentNow.has(failure.requestId)) continue;
    // A fault of the sweep, not of this request, holds no request back (LQ1).
    if (faultOf(failure) === "request") own.push(failure);
    else passFailures.push(failure.error);
  }
  return { escalated: pass.escalated, failed: own, emailed, passFailures };
}

/** One error for a wake's failures: the one itself, or all of them together. */
function sweepFailure(failures: readonly unknown[]): unknown {
  return failures.length === 1 ? failures[0] : new AggregateError(failures, `${String(failures.length)} parts of the escalation sweep failed`);
}

function defaultSetTimer(callback: () => void, ms: number): unknown {
  const handle = setTimeout(callback, ms);
  handle.unref();
  return handle;
}

export class EscalationScheduler {
  readonly #deps: EscalationSchedulerDeps;
  /**
   * The async context the scheduler was built in: start-up, with no request
   * (diary-live.ts builds it as the server registers). Every wake (start(),
   * poke(), the timer) enters it, so a poke made inside a request lends that
   * request's context (where Sentry keeps the request's URL, headers, route
   * and trace) to neither the plan, its database reads, the timer it arms nor
   * any pass or plan after (T-764).
   */
  readonly #inOwnContext = AsyncLocalStorage.snapshot();
  #timer: unknown = null;
  #running = false;
  #stopped = false;
  #planSerial = 0;
  /** Each step keeps its own streak: the plan between two failed passes
   *  succeeds, and must not end the passes' streak. */
  readonly #failures: Readonly<Record<SweepStage, FailureStreak>> = { plan: new FailureStreak(), pass: new FailureStreak() };
  /** While passes keep failing, the instant the next pass may run: set at
   *  each failure, so a poke during the streak cannot push it later. */
  #passRetryAt: number | null = null;
  /** The requests a pass failed on through a fault of their own, each with
   *  its own streak, its alarm's last report and, for a failed claim, the
   *  instant it was due at and the deadline before which it is held back
   *  (LN1, LQ2). Kept in this process only (LN1 e). */
  readonly #requests = new Map<string, {
    step: EscalationPassFailure["step"];
    failures: number;
    since: number;
    reportedAt: number;
    dueAt: number | null;
    retryAt: number | null;
    lastFailedAt: number;
  }>();
  /** When the email pass last ran (or the scheduler started): an email still
   *  waiting is tried a while after it, whatever plans come between (F-B). */
  #emailPassAt: number | null = null;

  constructor(deps: EscalationSchedulerDeps) {
    this.#deps = deps;
  }

  /** Plans from the database and sleeps until the first due instant. */
  start(): void {
    this.#stopped = false;
    // An email waiting since before a restart is first tried a while after
    // the start, and not pushed out by the plans that follow (F-B).
    this.#emailPassAt ??= (this.#deps.now ?? Date.now)();
    this.#asOwnWork(() => this.#plan());
  }

  /** Runs one wake as the sweep's own: in the start-up context, then in a
   *  Sentry scope and trace of its own, so neither a poker's request nor an
   *  earlier pass lends it anything (#487's review). */
  #asOwnWork(work: () => Promise<void>): void {
    this.#inOwnContext(() => { void inOwnScope(work); });
  }

  #isStopped(): boolean {
    return this.#stopped;
  }

  stop(): void {
    this.#stopped = true;
    this.#clearTimer();
  }

  /** Something new is due (a request raised, a handover made): plan again.
   *  During a run the plan that follows the run reads the new state anyway. */
  poke(): void {
    if (this.#stopped || this.#running) return;
    this.#asOwnWork(() => this.#plan());
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      (this.#deps.clearTimer ?? ((handle: unknown) => { clearTimeout(handle as ReturnType<typeof setTimeout>); }))(this.#timer);
      this.#timer = null;
    }
  }

  /** Logs a failed step every time, and reports it at the start of its
   *  streak and hourly after; inside a wake, on that wake's own scope. */
  #failed(stage: SweepStage, error: unknown, message: string): void {
    const nowMs = (this.#deps.now ?? Date.now)();
    const { report, failures, failingForMs } = this.#failures[stage].failed(nowMs);
    if (stage === "pass") this.#passRetryAt = nowMs + passRetryAfter(failures);
    this.#deps.logger?.error({ err: error, stage, failures, failingForMs }, message);
    if (report) (this.#deps.report ?? reportToSentry)(error, stage);
  }

  #succeeded(stage: SweepStage): void {
    if (stage === "pass") this.#passRetryAt = null;
    const run = this.#failures[stage].ended((this.#deps.now ?? Date.now)());
    if (run !== null) this.#deps.logger?.info({ event: "escalation.recovered", stage, ...run }, "escalation sweep recovered");
  }

  /** The requests held back now, each with the instant it was due at when
   *  its claim failed and its deadline. A request quiet for
   *  REQUEST_RETRY_MAX_MS past its last chance was taken, or recovered
   *  unseen: it is forgotten. */
  #held(nowMs: number): Map<string, HeldRequest> {
    const held = new Map<string, HeldRequest>();
    for (const [requestId, state] of this.#requests) {
      if (Math.max(state.retryAt ?? 0, state.lastFailedAt) < nowMs - REQUEST_RETRY_MAX_MS) {
        this.#requests.delete(requestId);
      } else if (state.dueAt !== null && state.retryAt !== null && state.retryAt > nowMs) {
        held.set(requestId, { dueAt: state.dueAt, until: state.retryAt });
      }
    }
    return held;
  }

  /** One request a pass failed on through a fault of its own: its own
   *  streak; for a failed claim, its own widening deadline, kept to the
   *  instant it was due at; and its alarm, naming it, at the start of its
   *  streak and at most hourly after (LN1). A request that has moved since
   *  (another step, or due at another instant) starts a streak afresh (LQ2). */
  #requestFailed(failure: EscalationPassFailure, nowMs: number): void {
    const dueAt = failure.step === "claim" ? failure.dueAt.getTime() : null;
    const known = this.#requests.get(failure.requestId);
    const state = known !== undefined && known.step === failure.step && known.dueAt === dueAt
      ? known
      : { step: failure.step, failures: 0, since: nowMs, reportedAt: Number.NEGATIVE_INFINITY, dueAt, retryAt: null, lastFailedAt: nowMs };
    state.failures += 1;
    state.lastFailedAt = nowMs;
    if (failure.step === "claim") state.retryAt = nowMs + requestRetryAfter(state.failures);
    const report = state.failures === 1 || nowMs - state.reportedAt >= FAILURE_REPORT_EVERY_MS;
    if (report) state.reportedAt = nowMs;
    this.#requests.set(failure.requestId, state);
    // A failed claim holds the request back; a failed email holds nothing
    // (the email pass tries it again), so it is logged as a failure (LQ6).
    if (state.retryAt !== null && state.dueAt !== null) {
      this.#deps.logger?.info(
        { event: "escalation.request_held", requestId: failure.requestId, step: failure.step, failures: state.failures, dueAt: new Date(state.dueAt).toISOString(), retryAt: new Date(state.retryAt).toISOString() },
        "escalation.request_held",
      );
    } else {
      this.#deps.logger?.info({ event: "escalation.request_failed", requestId: failure.requestId, step: failure.step, failures: state.failures }, "escalation.request_failed");
    }
    if (report) (this.#deps.report ?? reportToSentry)(failure.error, failure.step, failure.requestId);
  }

  #requestRecovered(requestId: string, nowMs: number): void {
    const state = this.#requests.get(requestId);
    if (state === undefined) return;
    this.#requests.delete(requestId);
    this.#deps.logger?.info({ event: "escalation.request_recovered", requestId, failures: state.failures, failedForMs: nowMs - state.since }, "escalation.request_recovered");
  }

  /** Announces what a pass escalated. The escalations are already written,
   *  so an announcement that throws is not a failed pass: it is logged and
   *  reported on its own, and sets no wait. */
  #announce(escalated: readonly EscalatedRequest[]): void {
    try {
      this.#deps.onEscalated(escalated);
    } catch (error: unknown) {
      this.#deps.logger?.error({ err: error, stage: "announce", requests: escalated.length }, "escalation announcement failed");
      (this.#deps.report ?? reportToSentry)(error, "announce");
    }
  }

  async #plan(): Promise<void> {
    const serial = ++this.#planSerial;
    const now = this.#deps.now ?? Date.now;
    let wake: number | null;
    try {
      const nowMs = now();
      wake = await (this.#deps.plan ?? planNextWake)(this.#deps.db, nowMs, this.#held(nowMs), this.#emailPassAt);
      this.#succeeded("plan");
    } catch (error: unknown) {
      this.#failed("plan", error, "escalation scheduler could not plan");
      wake = now() + PLAN_RETRY_MS;
    }
    // A newer plan (a poke while this one read) wins; this one stands down.
    if (this.#stopped || serial !== this.#planSerial) return;
    this.#clearTimer();
    // While passes keep failing, no pass before the deadline the failure set.
    const retryAt = this.#failures.pass.failing ? this.#passRetryAt : null;
    const sleep = sleepFor(wake !== null && retryAt !== null ? Math.max(wake, retryAt) : wake, now());
    this.#deps.logger?.debug({ event: "escalation.scheduled", wakeAt: wake === null ? null : new Date(wake).toISOString(), sleepMs: sleep }, "escalation.scheduled");
    if (sleep === null) return;
    this.#timer = (this.#deps.setTimer ?? defaultSetTimer)(() => { this.#asOwnWork(() => this.#fire()); }, sleep);
  }

  async #fire(): Promise<void> {
    this.#timer = null;
    if (this.#stopped || this.#running) return;
    this.#running = true;
    try {
      const now = this.#deps.now ?? Date.now;
      const startedMs = now();
      const skip: ReadonlyMap<string, number> = new Map([...this.#held(startedMs)].map(([requestId, hold]) => [requestId, hold.dueAt]));
      const outcome = await (this.#deps.run ?? ((db: Database, held: ReadonlyMap<string, number>) => runSweepPasses(db, this.#deps.logger, held)))(this.#deps.db, skip);
      // The passes ran, the email pass with them: an email still waiting is
      // next tried a while after this (F-B). A run that threw ran no email pass.
      this.#emailPassAt = startedMs;
      const afterMs = now();
      for (const item of outcome.escalated) this.#requestRecovered(item.request.id, afterMs);
      for (const requestId of outcome.emailed) this.#requestRecovered(requestId, afterMs);
      // A request the pass failed on through a fault of its own, at its claim
      // or at its email, takes a floor and an alarm of its own and costs the
      // rest of the sweep nothing (LN1). A fault of the sweep, and a pass that
      // failed as a whole, take the wake's own back-off (T-766, LQ1). What did
      // escalate is announced all the same (T-768). One request and step
      // count once a wake (LQ6).
      const seen = new Set<string>();
      for (const failure of outcome.failed) {
        const key = `${failure.requestId} ${failure.step}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.#requestFailed(failure, afterMs);
      }
      if (outcome.passFailures.length === 0) this.#succeeded("pass");
      else this.#failed("pass", sweepFailure(outcome.passFailures), "request escalation sweep failed");
      if (outcome.escalated.length > 0) this.#announce(outcome.escalated);
    } catch (error: unknown) {
      this.#failed("pass", error, "request escalation sweep failed");
    } finally {
      this.#running = false;
    }
    // Read through a method: stop() may have run during the await, which
    // the type narrowing above cannot see.
    if (this.#isStopped()) return;
    await this.#plan();
  }
}

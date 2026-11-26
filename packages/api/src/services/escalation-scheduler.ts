import { AsyncLocalStorage } from "node:async_hooks";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { requests } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { captureBackgroundError, inOwnScope } from "../observability/sentry.js";
import { quietHoursEndAfter } from "./escalation-clock.js";
import { readOperatingSettings } from "./venue-operating-settings.js";
import { UNOWNED_ESCALATING_STATES, runEscalationEmailPass, runRequestEscalationPass, type EscalatedRequest } from "./requests.js";

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
/** A plan that failed (the database away, say) is tried again after this. */
export const PLAN_RETRY_MS = 60_000;
/** While passes keep failing, the next wake waits at least this long after
 *  the first failure, doubling with each one after, up to PASS_RETRY_MAX_MS.
 *  A pass that fails before it claims a request leaves that request's window
 *  overdue, so the plan after it would wake a beat later: a failure that
 *  stays (a malformed row, say) ran about four passes a second, each logged,
 *  and kept the database awake. The first wait is short because a blip is the
 *  likelier failure and an urgent request's window is two minutes by default;
 *  a failure that stays reaches a minute between tries within about a minute
 *  (T-766). */
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

/** The two steps of a wake that can fail. */
export type SweepStage = "plan" | "pass";

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
 *  deadline, no email waiting out quiet hours. */
export async function planNextWake(db: Database, nowMs: number): Promise<number | null> {
  const [nextWindow] = await db
    .select({ at: requests.escalationDueAt })
    .from(requests)
    .where(and(inArray(requests.state, [...UNOWNED_ESCALATING_STATES]), isNull(requests.escalatedAt), isNotNull(requests.escalationDueAt)))
    .orderBy(asc(requests.escalationDueAt))
    .limit(1);
  const [nextRelief] = await db
    .select({ at: requests.handoverDueAt })
    .from(requests)
    .where(and(eq(requests.state, "handed-over"), isNull(requests.escalatedAt), isNotNull(requests.handoverDueAt)))
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
    emailWakes.push(quietEnd <= nowMs ? nowMs + EMAIL_RETRY_MS : quietEnd);
  }
  return soonest([
    nextWindow?.at?.getTime() ?? null,
    nextRelief?.at?.getTime() ?? null,
    ...emailWakes,
  ]);
}

export interface EscalationSchedulerDeps {
  readonly db: Database;
  readonly logger?: FastifyBaseLogger;
  /** What the sweep announces once requests have escalated. */
  readonly onEscalated: (escalated: readonly EscalatedRequest[]) => void;
  readonly now?: () => number;
  /** Injected in tests; default: the two passes, then the plan. */
  readonly plan?: (db: Database, nowMs: number) => Promise<number | null>;
  readonly run?: (db: Database) => Promise<readonly EscalatedRequest[]>;
  /** Where a failure goes beyond the log, at the start of its streak and
   *  hourly after. Injected in tests; default: Sentry, on the wake's own
   *  scope and trace (`captureBackgroundError`). */
  readonly report?: (error: unknown, stage: SweepStage) => void;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

function reportToSentry(error: unknown, stage: SweepStage): void {
  captureBackgroundError(error, { "background.task": "escalation-sweep", "escalation.stage": stage });
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

async function runBothPasses(db: Database, logger?: FastifyBaseLogger): Promise<readonly EscalatedRequest[]> {
  const escalated = await runRequestEscalationPass(db, { logger });
  await runEscalationEmailPass(db, { logger });
  return escalated;
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

  constructor(deps: EscalationSchedulerDeps) {
    this.#deps = deps;
  }

  /** Plans from the database and sleeps until the first due instant. */
  start(): void {
    this.#stopped = false;
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
    const { report, failures, failingForMs } = this.#failures[stage].failed((this.#deps.now ?? Date.now)());
    this.#deps.logger?.error({ err: error, stage, failures, failingForMs }, message);
    if (report) (this.#deps.report ?? reportToSentry)(error, stage);
  }

  #succeeded(stage: SweepStage): void {
    const run = this.#failures[stage].ended((this.#deps.now ?? Date.now)());
    if (run !== null) this.#deps.logger?.info({ event: "escalation.recovered", stage, ...run }, "escalation sweep recovered");
  }

  async #plan(): Promise<void> {
    const serial = ++this.#planSerial;
    const now = this.#deps.now ?? Date.now;
    let wake: number | null;
    try {
      wake = await (this.#deps.plan ?? planNextWake)(this.#deps.db, now());
      this.#succeeded("plan");
    } catch (error: unknown) {
      this.#failed("plan", error, "escalation scheduler could not plan");
      wake = now() + PLAN_RETRY_MS;
    }
    // A newer plan (a poke while this one read) wins; this one stands down.
    if (this.#stopped || serial !== this.#planSerial) return;
    this.#clearTimer();
    let sleep = sleepFor(wake, now());
    if (sleep !== null && this.#failures.pass.failing) sleep = Math.max(sleep, passRetryAfter(this.#failures.pass.failures));
    this.#deps.logger?.debug({ event: "escalation.scheduled", wakeAt: wake === null ? null : new Date(wake).toISOString(), sleepMs: sleep }, "escalation.scheduled");
    if (sleep === null) return;
    this.#timer = (this.#deps.setTimer ?? defaultSetTimer)(() => { this.#asOwnWork(() => this.#fire()); }, sleep);
  }

  async #fire(): Promise<void> {
    this.#timer = null;
    if (this.#stopped || this.#running) return;
    this.#running = true;
    try {
      const escalated = await (this.#deps.run ?? ((db: Database) => runBothPasses(db, this.#deps.logger)))(this.#deps.db);
      if (escalated.length > 0) this.#deps.onEscalated(escalated);
      this.#succeeded("pass");
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

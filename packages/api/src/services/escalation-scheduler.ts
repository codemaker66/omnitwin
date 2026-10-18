import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { requests } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { quietHoursEndAfter } from "./escalation-clock.js";
import { readOperatingSettings } from "./venue-operating-settings.js";
import { runEscalationEmailPass, runRequestEscalationPass, type EscalatedRequest } from "./requests.js";

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
 *  nothing is: no sent request with a window, no handover with a relief
 *  deadline, no email waiting out quiet hours. */
export async function planNextWake(db: Database, nowMs: number): Promise<number | null> {
  const [nextWindow] = await db
    .select({ at: requests.escalationDueAt })
    .from(requests)
    .where(and(eq(requests.state, "sent"), isNull(requests.escalatedAt), isNotNull(requests.escalationDueAt)))
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
    .where(and(isNotNull(requests.escalatedAt), isNull(requests.escalationEmailedAt), inArray(requests.state, ["sent", "handed-over"])));

  const emailWakes: (number | null)[] = [];
  for (const { venueId } of waiting) {
    const settings = await readOperatingSettings(db, venueId);
    // A venue with no settings has no quiet hours: its email is due now.
    emailWakes.push(settings === null ? nowMs : quietHoursEndAfter(nowMs, { start: settings.quietHoursStart, end: settings.quietHoursEnd }));
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
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
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
  #timer: unknown = null;
  #running = false;
  #stopped = false;
  #planSerial = 0;

  constructor(deps: EscalationSchedulerDeps) {
    this.#deps = deps;
  }

  /** Plans from the database and sleeps until the first due instant. */
  start(): void {
    this.#stopped = false;
    void this.#plan();
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
    void this.#plan();
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      (this.#deps.clearTimer ?? ((handle: unknown) => { clearTimeout(handle as ReturnType<typeof setTimeout>); }))(this.#timer);
      this.#timer = null;
    }
  }

  async #plan(): Promise<void> {
    const serial = ++this.#planSerial;
    const now = this.#deps.now ?? Date.now;
    let wake: number | null;
    try {
      wake = await (this.#deps.plan ?? planNextWake)(this.#deps.db, now());
    } catch (error: unknown) {
      this.#deps.logger?.error({ err: error }, "escalation scheduler could not plan");
      wake = now() + 60_000;
    }
    // A newer plan (a poke while this one read) wins; this one stands down.
    if (this.#stopped || serial !== this.#planSerial) return;
    this.#clearTimer();
    const sleep = sleepFor(wake, now());
    this.#deps.logger?.debug({ event: "escalation.scheduled", wakeAt: wake === null ? null : new Date(wake).toISOString(), sleepMs: sleep }, "escalation.scheduled");
    if (sleep === null) return;
    this.#timer = (this.#deps.setTimer ?? defaultSetTimer)(() => { void this.#fire(); }, sleep);
  }

  async #fire(): Promise<void> {
    this.#timer = null;
    if (this.#stopped || this.#running) return;
    this.#running = true;
    try {
      const escalated = await (this.#deps.run ?? ((db: Database) => runBothPasses(db, this.#deps.logger)))(this.#deps.db);
      if (escalated.length > 0) this.#deps.onEscalated(escalated);
    } catch (error: unknown) {
      this.#deps.logger?.error({ err: error }, "request escalation sweep failed");
    } finally {
      this.#running = false;
    }
    // Read through a method: stop() may have run during the await, which
    // the type narrowing above cannot see.
    if (this.#isStopped()) return;
    await this.#plan();
  }
}

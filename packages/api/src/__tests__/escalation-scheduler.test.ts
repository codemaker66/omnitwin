import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { inOwnScope } from "../observability/sentry.js";
import {
  EscalationScheduler,
  FAILURE_REPORT_EVERY_MS,
  MAX_SLEEP_MS,
  MIN_SLEEP_MS,
  PASS_RETRY_FIRST_MS,
  PASS_RETRY_MAX_MS,
  REQUEST_RETRY_MAX_MS,
  requestRetryAfter,
  runSweepPasses,
  sleepFor,
  soonest,
} from "../services/escalation-scheduler.js";
import { EscalationEmailFailed, EscalationEmailPassIncomplete } from "../services/requests.js";

// Sentry is off here, as with SENTRY_DSN unset: nothing the scheduler does may
// load the SDK (observability/sentry.ts imports it only inside initSentry).
const sdk = vi.hoisted(() => ({ loaded: false }));
vi.mock("@sentry/node", () => {
  sdk.loaded = true;
  return {};
});

// ---------------------------------------------------------------------------
// The sweep wakes only when something is due (goal 19 S7; the 18 October
// Neon outage): no timer with nothing due, a timer to the first due instant
// otherwise, a fresh plan after every run and on every poke. Timers and the
// database plan are injected, so this is pure of clocks and sockets.
// ---------------------------------------------------------------------------

const db = {} as Database;
const T0 = Date.parse("2026-10-18T12:00:00.000Z");

interface FakeTimer { readonly callback: () => void; readonly ms: number; cleared: boolean }

interface Harness {
  readonly scheduler: EscalationScheduler;
  readonly timers: FakeTimer[];
  readonly plan: ReturnType<typeof vi.fn>;
  readonly run: ReturnType<typeof vi.fn>;
  readonly onEscalated: ReturnType<typeof vi.fn>;
  /** What the scheduler reported to Sentry: each failure's stage, at the clock's time. */
  readonly reported: (readonly [string, number])[];
  readonly clock: { now: number };
}

/** A wake's passes that escalated these and failed on nothing. */
const swept = (escalated: readonly unknown[] = []): { readonly escalated: readonly unknown[]; readonly failed: readonly unknown[]; readonly emailed: readonly string[]; readonly passFailures: readonly unknown[] } =>
  ({ escalated, failed: [], emailed: [], passFailures: [] });

function harness(plans: readonly (number | null)[], runs: readonly unknown[][] = [[]]): Harness {
  const timers: FakeTimer[] = [];
  const plan = vi.fn();
  for (const wake of plans) plan.mockResolvedValueOnce(wake);
  plan.mockResolvedValue(null);
  const run = vi.fn();
  for (const escalated of runs) run.mockResolvedValueOnce(swept(escalated));
  run.mockResolvedValue(swept());
  const onEscalated = vi.fn();
  const reported: (readonly [string, number])[] = [];
  const clock = { now: T0 };
  const scheduler = new EscalationScheduler({
    db,
    onEscalated,
    now: () => clock.now,
    plan,
    run,
    report: (_error, stage) => { reported.push([stage, clock.now]); },
    setTimer: (callback, ms) => { const timer: FakeTimer = { callback, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (handle) => { (handle as FakeTimer).cleared = true; },
  });
  return { scheduler, timers, plan, run, onEscalated, reported, clock };
}

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe("sleep arithmetic", () => {
  it("takes the soonest instant and ignores nothing-due", () => {
    expect(soonest([null, T0 + 5000, T0 + 1000, null])).toBe(T0 + 1000);
    expect(soonest([null, null])).toBeNull();
    expect(soonest([])).toBeNull();
  });

  it("sleeps to the instant, never under a beat, never over six hours, and not at all with nothing due", () => {
    expect(sleepFor(T0 + 90_000, T0)).toBe(90_000);
    expect(sleepFor(T0 - 5_000, T0)).toBe(MIN_SLEEP_MS);
    expect(sleepFor(T0 + 48 * 3_600_000, T0)).toBe(MAX_SLEEP_MS);
    expect(sleepFor(null, T0)).toBeNull();
  });
});

describe("the escalation scheduler", () => {
  it("sets no timer when nothing is due, so the database can sleep", async () => {
    const h = harness([null]);
    h.scheduler.start();
    await settle();
    expect(h.plan).toHaveBeenCalledTimes(1);
    expect(h.timers).toHaveLength(0);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("sleeps until the first due instant, runs both passes, announces, and plans again", async () => {
    const escalated = [{ request: { id: "r-1" } }];
    const h = harness([T0 + 120_000, null], [escalated]);
    h.scheduler.start();
    await settle();
    expect(h.timers.map((timer) => timer.ms)).toEqual([120_000]);
    h.clock.now = T0 + 120_000;
    h.timers[0]?.callback();
    await settle();
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.onEscalated).toHaveBeenCalledWith(escalated);
    expect(h.plan).toHaveBeenCalledTimes(2);
    expect(h.timers).toHaveLength(1);
  });

  it("a poke while idle plans again and replaces the timer", async () => {
    const h = harness([T0 + 600_000, T0 + 30_000]);
    h.scheduler.start();
    await settle();
    h.scheduler.poke();
    await settle();
    expect(h.timers.map((timer) => [timer.ms, timer.cleared])).toEqual([[600_000, true], [30_000, false]]);
  });

  it("a poke during a run is covered by the plan that follows the run, without a second run", async () => {
    let finishRun: (value: ReturnType<typeof swept>) => void = () => undefined;
    const run = new Promise<ReturnType<typeof swept>>((resolve) => { finishRun = resolve; });
    const h = harness([T0 + 1_000, T0 + 2_000]);
    h.run.mockReset();
    h.run.mockReturnValueOnce(run);
    h.run.mockResolvedValue(swept());
    h.scheduler.start();
    await settle();
    h.timers[0]?.callback();
    await settle();
    h.scheduler.poke();
    h.scheduler.poke();
    expect(h.plan).toHaveBeenCalledTimes(1);
    finishRun(swept());
    await settle();
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.plan).toHaveBeenCalledTimes(2);
    expect(h.timers.map((timer) => timer.ms)).toEqual([1_000, 2_000]);
  });

  it("the newest plan wins when a poke overlaps a plan still reading", async () => {
    let answerFirst: (value: number | null) => void = () => undefined;
    const first = new Promise<number | null>((resolve) => { answerFirst = resolve; });
    const h = harness([]);
    h.plan.mockReset();
    h.plan.mockReturnValueOnce(first);
    h.plan.mockResolvedValueOnce(T0 + 5_000);
    h.scheduler.start();
    h.scheduler.poke();
    await settle();
    expect(h.timers.map((timer) => timer.ms)).toEqual([5_000]);
    answerFirst(T0 + 900_000);
    await settle();
    expect(h.timers.map((timer) => timer.ms)).toEqual([5_000]);
  });

  it("stop clears the timer and a late poke does nothing", async () => {
    const h = harness([T0 + 60_000, T0 + 60_000]);
    h.scheduler.start();
    await settle();
    h.scheduler.stop();
    expect(h.timers[0]?.cleared).toBe(true);
    h.scheduler.poke();
    await settle();
    expect(h.plan).toHaveBeenCalledTimes(1);
  });

  it("a plan that fails sleeps a minute and tries again rather than dying", async () => {
    const h = harness([]);
    h.plan.mockReset();
    h.plan.mockRejectedValueOnce(new Error("database away"));
    h.plan.mockResolvedValue(null);
    h.scheduler.start();
    await settle();
    expect(h.timers.map((timer) => timer.ms)).toEqual([60_000]);
  });

  it("a pass that throws is caught inside its wake: nothing is announced and the scheduler plans again", async () => {
    const h = harness([T0 + 1_000, null]);
    h.run.mockReset();
    h.run.mockRejectedValueOnce(new Error("the push service is away"));
    h.scheduler.start();
    await settle();
    h.timers[0]?.callback();
    await settle();
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.onEscalated).not.toHaveBeenCalled();
    expect(h.plan).toHaveBeenCalledTimes(2);
  });
});

describe("a pass that keeps failing (T-766)", () => {
  it("waits before trying again, from five seconds doubling to a minute, rather than re-waking a beat later", async () => {
    // The pass threw before claiming the request, so the plan after it still
    // finds that request's window, which is already past.
    const h = harness([]);
    h.plan.mockReset();
    h.plan.mockResolvedValue(T0 - 1_000);
    h.run.mockReset();
    h.run.mockRejectedValue(new Error("a malformed row stops every pass"));
    h.scheduler.start();
    await settle();
    for (let failure = 0; failure < 6; failure += 1) {
      h.timers.at(-1)?.callback();
      await settle();
    }
    expect(h.run).toHaveBeenCalledTimes(6);
    // The first wake is due at once. After a failed pass a blip costs only the
    // first wait (an urgent request's window is two minutes by default); a
    // failure that stays reaches a minute between tries.
    expect(h.timers.map((timer) => timer.ms)).toEqual([MIN_SLEEP_MS, 5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect([PASS_RETRY_FIRST_MS, PASS_RETRY_MAX_MS]).toEqual([5_000, 60_000]);
  });

  /** A plan that always finds an overdue window, and a pass with these outcomes. */
  function overdue(outcomes: readonly ("fails" | "succeeds")[]): Harness {
    const h = harness([]);
    h.plan.mockReset();
    h.plan.mockResolvedValue(T0 - 1_000);
    h.run.mockReset();
    for (const outcome of outcomes) {
      if (outcome === "fails") h.run.mockRejectedValueOnce(new Error("a malformed row stops every pass"));
      else h.run.mockResolvedValueOnce(swept());
    }
    return h;
  }

  /** Fires the newest timer at a time on the clock, and lets the wake finish. */
  async function wakeAt(h: Harness, at: number): Promise<void> {
    h.clock.now = at;
    h.timers.at(-1)?.callback();
    await settle();
  }

  it("reports the first failure of a streak to Sentry, then once an hour while it lasts, not at every try", async () => {
    const h = overdue(["fails", "fails", "fails", "fails"]);
    h.scheduler.start();
    await settle();
    await wakeAt(h, T0);
    await wakeAt(h, T0 + PASS_RETRY_FIRST_MS);
    await wakeAt(h, T0 + FAILURE_REPORT_EVERY_MS - 1);
    await wakeAt(h, T0 + FAILURE_REPORT_EVERY_MS);
    expect(h.run).toHaveBeenCalledTimes(4);
    expect(h.reported).toEqual([["pass", T0], ["pass", T0 + FAILURE_REPORT_EVERY_MS]]);
  });

  it("a pass that succeeds ends its streak: the wait goes, and the next failure is reported again", async () => {
    const h = overdue(["fails", "succeeds", "fails"]);
    h.scheduler.start();
    await settle();
    await wakeAt(h, T0);
    await wakeAt(h, T0 + PASS_RETRY_FIRST_MS);
    await wakeAt(h, T0 + PASS_RETRY_FIRST_MS + MIN_SLEEP_MS);
    // A new streak starts its wait from the first step again.
    expect(h.timers.map((timer) => timer.ms)).toEqual([MIN_SLEEP_MS, PASS_RETRY_FIRST_MS, MIN_SLEEP_MS, PASS_RETRY_FIRST_MS]);
    expect(h.reported).toEqual([["pass", T0], ["pass", T0 + PASS_RETRY_FIRST_MS + MIN_SLEEP_MS]]);
  });

  it("a poke during a failing streak arms at the retry the failure set, neither sooner nor later", async () => {
    const h = overdue(["fails"]);
    h.scheduler.start();
    await settle();
    await wakeAt(h, T0);
    // A request raised three seconds after the failure: two seconds are left.
    h.clock.now = T0 + 3_000;
    h.scheduler.poke();
    await settle();
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.timers.map((timer) => [timer.ms, timer.cleared])).toEqual([[MIN_SLEEP_MS, false], [PASS_RETRY_FIRST_MS, true], [PASS_RETRY_FIRST_MS - 3_000, false]]);
  });

  it("pokes under steady traffic cannot push the retry out: one failure, then a poke every 4 s for ten minutes, and the retry comes at the first step", async () => {
    // The release lead's case (SF1): measured from each poke, a 5 s wait
    // re-armed every 4 s would never come round, and every escalation would
    // stall until the pokes stopped.
    const clock = { now: T0 };
    /** The one timer the scheduler has armed: firing or clearing it empties the slot. */
    const slot: { pending: { readonly due: number; readonly callback: () => void } | null } = { pending: null };
    let escalated = false;
    const passesAt: number[] = [];
    const scheduler = new EscalationScheduler({
      db,
      onEscalated: () => undefined,
      now: () => clock.now,
      plan: () => Promise.resolve(escalated ? null : T0 - 1_000),
      run: () => {
        passesAt.push(clock.now);
        if (passesAt.length === 1) return Promise.reject(new Error("the database blipped"));
        escalated = true;
        return Promise.resolve({ escalated: [], failed: [], emailed: [], passFailures: [] });
      },
      report: () => undefined,
      setTimer: (callback, ms) => {
        const timer = { due: clock.now + ms, callback };
        slot.pending = timer;
        return timer;
      },
      clearTimer: (handle) => { if (slot.pending === handle) slot.pending = null; },
    });
    /** Fires the armed timer at its own due time while it falls due by `until`. */
    const fireDue = async (until: number): Promise<void> => {
      while (slot.pending !== null && slot.pending.due <= until) {
        const { due, callback } = slot.pending;
        slot.pending = null;
        clock.now = due;
        callback();
        await settle();
      }
    };
    scheduler.start();
    await settle();
    for (let at = T0 + 4_000; at <= T0 + 600_000; at += 4_000) {
      await fireDue(at);
      clock.now = at;
      scheduler.poke();
      await settle();
    }
    await fireDue(T0 + 600_000);
    expect(passesAt).toEqual([T0 + MIN_SLEEP_MS, T0 + MIN_SLEEP_MS + PASS_RETRY_FIRST_MS]);
  });

  it("an announcement that throws is reported on its own, after a pass that succeeded: no wait, and the pass's streak is untouched", async () => {
    const h = harness([T0 + 1_000, T0 - 1_000], [[{ request: { id: "r-1" } }]]);
    h.onEscalated.mockImplementation(() => { throw new Error("a live frame's payload would not encode"); });
    h.scheduler.start();
    await settle();
    await wakeAt(h, T0 + 1_000);
    expect(h.reported).toEqual([["announce", T0 + 1_000]]);
    // The plan after the pass finds an overdue window and wakes a beat later:
    // no failing pass, so no wait.
    expect(h.timers.map((timer) => timer.ms)).toEqual([1_000, MIN_SLEEP_MS]);
  });

  it("a plan that fails is reported on a streak of its own and tried again a minute later", async () => {
    const h = harness([]);
    h.plan.mockReset();
    h.plan.mockRejectedValue(new Error("the database is away"));
    h.scheduler.start();
    await settle();
    await wakeAt(h, T0 + 60_000);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.timers.map((timer) => timer.ms)).toEqual([60_000, 60_000]);
    expect(h.reported).toEqual([["plan", T0]]);
  });
});

describe("a wake's two passes (T-768)", () => {
  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  it("an email pass that throws as a whole costs nothing the escalation pass escalated; a request a pass failed on is named, and the held requests are skipped", async () => {
    const escalate = vi.fn();
    escalate.mockResolvedValue({ escalated: [{ request: { id: "r-1" } }], failed: [{ requestId: "r-2", step: "claim", error: new Error("the inbox refused r-2") }] });
    const email = vi.fn();
    email.mockRejectedValue(new Error("the email pass's select fell over"));
    const outcome = await runSweepPasses(db, undefined, new Set(["r-9"]), { escalate, email });
    expect(escalate).toHaveBeenCalledWith(db, { logger: undefined, skip: new Set(["r-9"]) });
    expect(outcome.escalated).toEqual([{ request: { id: "r-1" } }]);
    expect(outcome.failed.map((failure) => [failure.requestId, failure.step, message(failure.error)])).toEqual([["r-2", "claim", "the inbox refused r-2"]]);
    expect(outcome.passFailures.map(message)).toEqual(["the email pass's select fell over"]);
  });

  it("an email pass that failed on some rows names each one, and an email the same wake then sent is no failure (LN5)", async () => {
    const escalate = vi.fn();
    escalate.mockResolvedValue({ escalated: [], failed: [{ requestId: "r-3", step: "email", error: new Error("the mark blipped") }] });
    const email = vi.fn();
    email.mockRejectedValue(new EscalationEmailPassIncomplete(
      [new EscalationEmailFailed("r-4", new Error("the provider threw"))],
      [{ requestId: "r-3", venueId: "v-1", emailedAdmins: 1 }],
    ));
    const outcome = await runSweepPasses(db, undefined, new Set(), { escalate, email });
    expect(outcome.failed.map((failure) => [failure.requestId, failure.step])).toEqual([["r-4", "email"]]);
    expect(outcome.emailed).toEqual(["r-3"]);
    expect(outcome.passFailures).toEqual([]);
  });

  it("a request whose claim always fails is held on a floor of its own: the other escalates on time, its tries widen to the cap, the plan sleeps past five minutes, its alarm names it, and a failed select still backs off (LN1)", async () => {
    const clock = { now: T0 };
    /** The one timer armed: firing or clearing it empties the slot. */
    const slot: { pending: { readonly due: number; readonly callback: () => void } | null } = { pending: null };
    const armed: number[] = [];
    // A fake database: A (whose claim always fails) due at once, B half a minute later.
    const dueAt = new Map([["A", T0], ["B", T0 + 30_000]]);
    const escalatedAt = new Map<string, number>();
    const triesOfA: number[] = [];
    const reports: (readonly [string, string | undefined, number])[] = [];
    let selectFails = false;
    const stillDue = (held: { has: (id: string) => boolean }): [string, number][] => [...dueAt].filter(([id]) => !escalatedAt.has(id) && !held.has(id));
    // As planNextWake: a held request counts at its own deadline.
    const plan = (_db: Database, _nowMs: number, held: ReadonlyMap<string, number>): Promise<number | null> => Promise.resolve(soonest([...stillDue(held).map(([, at]) => at), ...held.values()]));
    const run = vi.fn();
    run.mockImplementation((_db: Database, skip: ReadonlySet<string>) => {
      if (selectFails) return Promise.reject(new Error("the candidate select failed"));
      const escalated: { readonly request: { readonly id: string } }[] = [];
      const failed: { readonly requestId: string; readonly step: "claim"; readonly error: Error }[] = [];
      for (const [id, at] of stillDue(skip)) {
        if (at > clock.now) continue;
        if (id === "A") {
          triesOfA.push(clock.now);
          failed.push({ requestId: "A", step: "claim", error: new Error("the inbox refused A") });
        } else {
          escalatedAt.set(id, clock.now);
          escalated.push({ request: { id } });
        }
      }
      return Promise.resolve({ escalated, failed, emailed: [], passFailures: [] });
    });
    const scheduler = new EscalationScheduler({
      db,
      onEscalated: () => undefined,
      now: () => clock.now,
      plan,
      run,
      report: (_error, stage, requestId) => { reports.push([stage, requestId, clock.now]); },
      setTimer: (callback, ms) => {
        armed.push(ms);
        const timer = { due: clock.now + ms, callback };
        slot.pending = timer;
        return timer;
      },
      clearTimer: (handle) => { if (slot.pending === handle) slot.pending = null; },
    });
    const fireUntil = async (until: number): Promise<void> => {
      while (slot.pending !== null && slot.pending.due <= until) {
        const { due, callback } = slot.pending;
        slot.pending = null;
        clock.now = due;
        callback();
        await settle();
      }
    };
    scheduler.start();
    await settle();
    await fireUntil(T0 + 4 * 3_600_000);

    // The other request escalates on time, as if A were not there.
    expect(escalatedAt.get("B")).toBe(T0 + 30_000);
    // A is tried at its own deadlines, each twice as far as the last, up to the cap.
    const gaps = triesOfA.slice(1).map((at, index) => at - (triesOfA[index] ?? 0));
    expect(gaps).toEqual(gaps.map((_gap, index) => requestRetryAfter(index + 1)));
    expect(gaps.at(-1)).toBe(REQUEST_RETRY_MAX_MS);
    // With nothing else due, the plan sleeps past the database's five idle minutes.
    expect(Math.max(...armed)).toBeGreaterThan(5 * 60_000);
    // A's alarm names it, when its streak starts and then at most hourly; the sweep itself never failed.
    expect(reports.every(([stage, requestId]) => stage === "claim" && requestId === "A")).toBe(true);
    // Its first try is a beat after it fell due (MIN_SLEEP_MS), and the alarm goes with it.
    expect(triesOfA[0]).toBe(T0 + MIN_SLEEP_MS);
    expect(reports[0]?.[2]).toBe(triesOfA[0]);
    expect(reports.slice(1).every(([, , at], index) => at - (reports[index]?.[2] ?? 0) >= FAILURE_REPORT_EVERY_MS)).toBe(true);
    expect(reports.length).toBeGreaterThanOrEqual(2);

    // A failed candidate select still takes the sweep's own back-off (T-766).
    selectFails = true;
    dueAt.set("C", clock.now);
    scheduler.poke();
    await settle();
    await fireUntil(clock.now + MIN_SLEEP_MS);
    expect(reports.at(-1)?.slice(0, 2)).toEqual(["pass", undefined]);
    expect(armed.at(-1)).toBe(PASS_RETRY_FIRST_MS);
  });
});

describe("the escalation scheduler with Sentry off", () => {
  it("runs a whole wake without loading the SDK, and inOwnScope runs the work as it is", async () => {
    const store = new AsyncLocalStorage<string>();
    expect(store.run("the caller", () => inOwnScope(() => store.getStore()))).toBe("the caller");
    const escalated = [{ request: { id: "r-1" } }];
    const h = harness([null, T0 + 1_000], [escalated]);
    h.scheduler.start();
    await settle();
    h.scheduler.poke();
    await settle();
    expect(h.timers.map((timer) => [timer.ms, timer.cleared])).toEqual([[1_000, false]]);
    h.timers[0]?.callback();
    await settle();
    expect(h.onEscalated).toHaveBeenCalledWith(escalated);
    expect(h.plan).toHaveBeenCalledTimes(3);
    expect(sdk.loaded).toBe(false);
  });
});

// The sweep works for the venue, not for the request that woke it (T-764):
// a poke made inside a request must not lend that request's async context
// (where Sentry keeps the request's scope) to the plan, the timer it arms or
// the pass. escalation-scheduler-context.test.ts shows it with the real SDK.
describe("the escalation scheduler's own context", () => {
  /** Stands for a request's context. */
  const requestContext = new AsyncLocalStorage<string>();

  function contextHarness(plans: readonly (number | null)[]): { scheduler: EscalationScheduler; seen: (readonly [string, string | undefined])[]; fire: () => void } {
    const seen: (readonly [string, string | undefined])[] = [];
    const callbacks: (() => void)[] = [];
    const queue = [...plans];
    // A pass that escalated something, so the announcement runs (as the
    // harness above: only that the list is non-empty matters).
    const run = vi.fn();
    run.mockImplementation(() => {
      seen.push(["pass", requestContext.getStore()]);
      return Promise.resolve(swept([{ request: { id: "r-1" } }]));
    });
    const scheduler = new EscalationScheduler({
      db,
      onEscalated: () => { seen.push(["announce", requestContext.getStore()]); },
      now: () => T0,
      plan: () => {
        seen.push(["plan", requestContext.getStore()]);
        return Promise.resolve(queue.shift() ?? null);
      },
      run,
      // As Node's own setTimeout: the callback runs in the context it was armed in.
      setTimer: (callback) => {
        seen.push(["timer armed", requestContext.getStore()]);
        callbacks.push(AsyncResource.bind(callback));
        return callbacks.length;
      },
      clearTimer: () => undefined,
    });
    return { scheduler, seen, fire: () => { callbacks.shift()?.(); } };
  }

  it("a poke from inside a request lends its context to neither the plan, the timer it arms nor the pass", async () => {
    const h = contextHarness([null, T0 + 1_000, null]);
    h.scheduler.start();
    await settle();
    requestContext.run("request r-1", () => { h.scheduler.poke(); });
    await settle();
    h.fire();
    await settle();
    expect(h.seen).toEqual([
      ["plan", undefined],
      ["plan", undefined],
      ["timer armed", undefined],
      ["pass", undefined],
      ["announce", undefined],
      ["plan", undefined],
    ]);
  });

  it("a start from inside a request keeps out of its context too", async () => {
    const h = contextHarness([T0 + 1_000]);
    requestContext.run("request r-2", () => { h.scheduler.start(); });
    await settle();
    h.fire();
    await settle();
    expect(h.seen.filter(([, store]) => store !== undefined)).toEqual([]);
    expect(h.seen.map(([where]) => where)).toEqual(["plan", "timer armed", "pass", "announce", "plan"]);
  });
});

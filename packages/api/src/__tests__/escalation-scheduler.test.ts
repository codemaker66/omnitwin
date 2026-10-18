import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { EscalationScheduler, MAX_SLEEP_MS, MIN_SLEEP_MS, sleepFor, soonest } from "../services/escalation-scheduler.js";

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
  readonly clock: { now: number };
}

function harness(plans: readonly (number | null)[], runs: readonly unknown[][] = [[]]): Harness {
  const timers: FakeTimer[] = [];
  const plan = vi.fn();
  for (const wake of plans) plan.mockResolvedValueOnce(wake);
  plan.mockResolvedValue(null);
  const run = vi.fn();
  for (const outcome of runs) run.mockResolvedValueOnce(outcome);
  run.mockResolvedValue([]);
  const onEscalated = vi.fn();
  const clock = { now: T0 };
  const scheduler = new EscalationScheduler({
    db,
    onEscalated,
    now: () => clock.now,
    plan,
    run,
    setTimer: (callback, ms) => { const timer: FakeTimer = { callback, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (handle) => { (handle as FakeTimer).cleared = true; },
  });
  return { scheduler, timers, plan, run, onEscalated, clock };
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
    let finishRun: (value: unknown[]) => void = () => undefined;
    const run = new Promise<unknown[]>((resolve) => { finishRun = resolve; });
    const h = harness([T0 + 1_000, T0 + 2_000]);
    h.run.mockReset();
    h.run.mockReturnValueOnce(run);
    h.run.mockResolvedValue([]);
    h.scheduler.start();
    await settle();
    h.timers[0]?.callback();
    await settle();
    h.scheduler.poke();
    h.scheduler.poke();
    expect(h.plan).toHaveBeenCalledTimes(1);
    finishRun([]);
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
});

import { describe, expect, it } from "vitest";
import type { OneShot } from "../../stage/stage-manifest.js";
import type { QuizAudioEngine } from "../audio-types.js";
import { CLOCK_SLOP_MS, createOneShotScheduler, createSeededRandom, planNextOneShot } from "../scheduler.js";
import { manualClock, type ManualClock } from "./fake-audio-context.js";

const ROPE: OneShot = { cue: "rope-creak", everyMsMin: 20_000, everyMsMax: 40_000 };
const GULL: OneShot = { cue: "gull", everyMsMin: 30_000, everyMsMax: 60_000 };

interface Played {
  readonly cue: string;
  readonly atMs: number;
}

interface Rig {
  readonly clock: ManualClock;
  readonly played: Played[];
  readonly engine: Pick<QuizAudioEngine, "play" | "context">;
}

function rig(): Rig {
  const clock = manualClock();
  const played: Played[] = [];
  return {
    clock,
    played,
    engine: {
      context: null,
      play: (cue) => {
        played.push({ cue, atMs: clock.nowMs() });
        return true;
      },
    },
  };
}

describe("seeded random", () => {
  it("is deterministic per seed and uniform in [0, 1)", () => {
    const a = createSeededRandom(20_260_816);
    const b = createSeededRandom(20_260_816);
    const c = createSeededRandom(7);
    const fromA = Array.from({ length: 8 }, () => a());
    const fromB = Array.from({ length: 8 }, () => b());
    const fromC = Array.from({ length: 8 }, () => c());
    expect(fromA).toEqual(fromB);
    expect(fromA).not.toEqual(fromC);
    for (const value of [...fromA, ...fromC]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("plans the next event inside the manifest's window", () => {
    const random = createSeededRandom(1);
    for (let i = 0; i < 200; i += 1) {
      const at = planNextOneShot(ROPE, 5_000, random);
      expect(at).toBeGreaterThanOrEqual(5_000 + ROPE.everyMsMin);
      expect(at).toBeLessThanOrEqual(5_000 + ROPE.everyMsMax);
    }
    expect(planNextOneShot({ cue: "x", everyMsMin: 100, everyMsMax: 100 }, 0, random)).toBe(100);
  });
});

describe("one-shot scheduler", () => {
  it("keeps exactly one pending event per one-shot and fires it on the context clock", () => {
    const { clock, played, engine } = rig();
    const scheduler = createOneShotScheduler(engine, { seed: 3, nowMs: clock.nowMs, schedule: clock.schedule });
    expect(scheduler.running).toBe(false);
    scheduler.start([ROPE, GULL]);
    expect(scheduler.running).toBe(true);
    expect(scheduler.pending).toHaveLength(2);
    const [rope, gull] = scheduler.pending;
    expect(rope?.cue).toBe("rope-creak");
    expect(rope?.atMs).toBeGreaterThanOrEqual(ROPE.everyMsMin);
    expect(rope?.atMs).toBeLessThanOrEqual(ROPE.everyMsMax);
    expect(gull?.atMs).toBeGreaterThanOrEqual(GULL.everyMsMin);
    // Which of the two falls due first depends on the seed, so the clock walks
    // to the earliest pending event rather than assuming the rope leads.
    const first = (rope?.atMs ?? Infinity) <= (gull?.atMs ?? Infinity) ? rope : gull;
    clock.advance((first?.atMs ?? 0) - 1);
    expect(played).toEqual([]);
    clock.advance(1);
    expect(played).toEqual([{ cue: first?.cue, atMs: first?.atMs }]);
    // Only the next one is planned, never a backlog.
    expect(scheduler.pending).toHaveLength(2);
    const replanned = scheduler.pending.find((event) => event.cue === first?.cue);
    expect(replanned?.atMs).toBeGreaterThan(first?.atMs ?? 0);
  });

  it("spaces every firing of a cue inside its window over a long run, and the same seed gives the same run", () => {
    const run = (): Played[] => {
      const { clock, played, engine } = rig();
      const scheduler = createOneShotScheduler(engine, { seed: 42, nowMs: clock.nowMs, schedule: clock.schedule });
      scheduler.start([ROPE, GULL]);
      clock.advance(600_000);
      scheduler.stop();
      return played;
    };
    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(20);
    for (const shot of [ROPE, GULL]) {
      const times = first.filter((play) => play.cue === shot.cue).map((play) => play.atMs);
      expect(times.length).toBeGreaterThan(5);
      for (let i = 1; i < times.length; i += 1) {
        const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
        expect(gap).toBeGreaterThanOrEqual(shot.everyMsMin);
        expect(gap).toBeLessThanOrEqual(shot.everyMsMax);
      }
    }
    // Gulls at most twice a minute.
    const gulls = first.filter((play) => play.cue === "gull").length;
    expect(gulls).toBeLessThanOrEqual(2 * 10);
  });

  it("re-arms instead of firing when the context clock stood still", () => {
    const { clock, played, engine } = rig();
    const scheduler = createOneShotScheduler(engine, { seed: 9, nowMs: clock.nowMs, schedule: clock.schedule });
    scheduler.start([ROPE]);
    const planned = scheduler.pending[0]?.atMs ?? 0;
    clock.stalled = true;
    clock.advance(120_000);
    expect(played).toEqual([]);
    expect(scheduler.pending[0]?.atMs).toBe(planned);
    clock.stalled = false;
    clock.advance(planned + CLOCK_SLOP_MS);
    expect(played).toEqual([{ cue: "rope-creak", atMs: planned }]);
  });

  it("stop cancels the plan and start replaces it", () => {
    const { clock, played, engine } = rig();
    const scheduler = createOneShotScheduler(engine, { seed: 5, nowMs: clock.nowMs, schedule: clock.schedule });
    scheduler.start([ROPE]);
    scheduler.stop();
    expect(scheduler.running).toBe(false);
    expect(scheduler.pending).toEqual([]);
    clock.advance(100_000);
    expect(played).toEqual([]);
    scheduler.start([GULL]);
    scheduler.start([ROPE]);
    expect(scheduler.pending.map((plan) => plan.cue)).toEqual(["rope-creak"]);
    clock.advance(40_000);
    expect(played.every((play) => play.cue === "rope-creak")).toBe(true);
    expect(played.length).toBeGreaterThanOrEqual(1);
  });

  it("reads the context clock from the engine when none is injected", () => {
    const { played } = rig();
    const engine: Pick<QuizAudioEngine, "play" | "context"> = {
      context: null,
      play: (cue) => {
        played.push({ cue, atMs: 0 });
        return true;
      },
    };
    const scheduler = createOneShotScheduler(engine, { seed: 1, schedule: () => () => undefined });
    scheduler.start([ROPE]);
    expect(scheduler.pending[0]?.atMs).toBeGreaterThanOrEqual(ROPE.everyMsMin);
    scheduler.stop();
  });
});

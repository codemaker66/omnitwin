import { describe, expect, it } from "vitest";
import { FrameGovernor, displayRateFrom, windowPace, type StepKind } from "../render-governor.js";

/** A ladder with `rungs` to give up, recording every step asked of it. */
function ladder(rungs = Number.POSITIVE_INFINITY): { readonly asked: StepKind[]; readonly giveUp: (held: StepKind) => boolean } {
  const asked: StepKind[] = [];
  return { asked, giveUp: (held) => { asked.push(held); return asked.length <= rungs; } };
}

/** Feeds frames drawn back to back at `fps` until `count` more windows have been judged. */
function windows(governor: FrameGovernor, giveUp: (held: StepKind) => boolean, fps: number, count: number, cpuMs: number | null = null): void {
  const target = governor.windowsJudged + count;
  for (let frame = 0; governor.windowsJudged < target; frame++) {
    if (frame > 100_000) throw new Error("No window closed");
    governor.observe(1 / fps, cpuMs, giveUp);
  }
}

function governorAt(displayHz: number): FrameGovernor {
  const governor = new FrameGovernor();
  governor.setDisplayRate(displayHz);
  return governor;
}

describe("FrameGovernor", () => {
  it("steps after two slow windows once it has warmed up, and no sooner", () => {
    const governor = governorAt(60);
    const { asked, giveUp } = ladder();
    // Three warm-up windows decide nothing, however slow.
    windows(governor, giveUp, 30, 3);
    windows(governor, giveUp, 30, 1);
    expect(asked).toEqual([]);
    windows(governor, giveUp, 30, 1);
    expect(asked).toEqual(["gpu"]);
    expect(governor.stepsDown).toBe(1);
  });

  it("leaves a device that holds its rate alone", () => {
    const governor = governorAt(60);
    const { asked, giveUp } = ladder();
    windows(governor, giveUp, 57, 20);
    expect(asked).toEqual([]);
  });

  it("does not strip a display held at 30 Hz of quality it cannot use", () => {
    const governor = governorAt(30);
    const { asked, giveUp } = ladder();
    windows(governor, giveUp, 30, 20);
    expect(asked).toEqual([]);
  });

  it("says the CPU held the frames up when their render filled most of each interval", () => {
    const cpuBound = governorAt(60);
    const cpu = ladder();
    windows(cpuBound, cpu.giveUp, 30, 5, 25);
    expect(cpu.asked).toEqual(["cpu"]);
    const gpuBound = governorAt(60);
    const gpu = ladder();
    windows(gpuBound, gpu.giveUp, 30, 5, 6);
    expect(gpu.asked).toEqual(["gpu"]);
  });

  it("leaves the window after a step to settle, then judges the step on the two after it", () => {
    const governor = governorAt(60);
    const { asked, giveUp } = ladder();
    windows(governor, giveUp, 30, 5);
    expect(asked).toHaveLength(1);
    // The rebuilt pipeline's first window is slower still; it is not held against the step.
    windows(governor, giveUp, 10, 1);
    // Two windows that gained, though still slow, ask for the next step.
    windows(governor, giveUp, 40, 1);
    expect(asked).toHaveLength(1);
    windows(governor, giveUp, 40, 1);
    expect(asked).toHaveLength(2);
    expect(governor.finished).toBe(false);
  });

  it("keeps stepping while each step helps, and stops once the rate holds", () => {
    const governor = governorAt(60);
    const { asked, giveUp } = ladder();
    windows(governor, giveUp, 30, 5);
    windows(governor, giveUp, 40, 3);
    windows(governor, giveUp, 48, 3);
    expect(asked).toHaveLength(3);
    windows(governor, giveUp, 58, 20);
    expect(asked).toHaveLength(3);
  });

  it("stops after two steps in a row that gain nothing", () => {
    const governor = governorAt(60);
    const { asked, giveUp } = ladder();
    // Every step leaves the rate where it was: something else sets the pace.
    windows(governor, giveUp, 30, 40);
    expect(asked).toHaveLength(2);
    expect(governor.finished).toBe(true);
  });

  it("stops when nothing is left to give up", () => {
    const governor = governorAt(60);
    const { asked, giveUp } = ladder(0);
    windows(governor, giveUp, 30, 20);
    expect(asked).toHaveLength(1);
    expect(governor.stepsDown).toBe(0);
    expect(governor.finished).toBe(true);
  });

  it("does not count idle gaps or stalls as the pace", () => {
    const governor = governorAt(60);
    const { asked, giveUp } = ladder();
    for (let i = 0; i < 2000; i++) {
      governor.observe(1 / 60, null, giveUp);
      if (i % 50 === 0) governor.observe(0.5, null, giveUp);
    }
    expect(asked).toEqual([]);
  });

  it("judges a window on its fastest frames, so a pause in a drag does not decide it", () => {
    const governor = governorAt(60);
    const { asked, giveUp } = ladder();
    // One frame in eight waits 150 ms on a finger that paused.
    for (let i = 0; i < 2000; i++) governor.observe(i % 8 === 0 ? 0.15 : 1 / 60, null, giveUp);
    expect(governor.windowsJudged).toBeGreaterThan(10);
    expect(asked).toEqual([]);
  });

  it("waits for the display's rate before judging", () => {
    const governor = new FrameGovernor();
    const { asked, giveUp } = ladder();
    windows(governor, giveUp, 20, 20);
    expect(asked).toEqual([]);
  });

  it("trusts a window faster than a probe taken on a busy page", () => {
    const governor = governorAt(40);
    const { asked, giveUp } = ladder();
    // Windows at 60 raise the display's rate to 60, so 40 then reads as slow.
    windows(governor, giveUp, 60, 5);
    windows(governor, giveUp, 40, 2);
    expect(asked).toEqual(["gpu"]);
  });
});

describe("windowPace", () => {
  it("leaves out the slowest fifth of a window's frames", () => {
    const frames = [...Array.from({ length: 8 }, () => ({ interval: 0.02, cpu: null })), { interval: 0.2, cpu: null }, { interval: 0.2, cpu: null }];
    expect(windowPace(frames).fps).toBeCloseTo(50, 6);
  });

  it("measures the render's share of the frame time from the frames that were timed", () => {
    const frames = Array.from({ length: 10 }, (_, i) => ({ interval: 0.04, cpu: i % 2 === 0 ? 0.03 : null }));
    expect(windowPace(frames).cpuShare).toBeCloseTo(0.75, 6);
    expect(windowPace([{ interval: 0.04, cpu: null }]).cpuShare).toBeNull();
  });
});

describe("displayRateFrom", () => {
  it("reads a display's rate from the median interval of idle frames", () => {
    const sixty = Array.from({ length: 31 }, (_, i) => i * (1000 / 60));
    expect(displayRateFrom(sixty)).toBeCloseTo(60, 6);
    const busy = sixty.map((stamp, i) => (i >= 10 ? stamp + 40 : stamp));
    expect(displayRateFrom(busy)).toBeCloseTo(60, 6);
  });

  it("needs enough frames", () => {
    expect(displayRateFrom([0, 16, 33])).toBeNull();
  });
});

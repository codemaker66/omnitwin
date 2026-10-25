import { describe, expect, it } from "vitest";
import { RENDER_PROFILES } from "../render-quality.js";
import { FrameGovernor, REBUILD_WAIT_MS, SETTLE_MS, STILL_MS, SWAP_SETTLE_MAX_MS, SwapSettle, displayRateFrom, governorWarmWindows, rebuildDue, windowPace, type StepKind } from "../render-governor.js";

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

  it("judges a phone from its first window: 40 ms frames at 60 Hz give up a rung within two windows", () => {
    const governor = new FrameGovernor({ warmWindows: governorWarmWindows(RENDER_PROFILES.phone) });
    governor.setDisplayRate(60);
    const { asked, giveUp } = ladder();
    windows(governor, giveUp, 25, 1, 30);
    expect(asked).toEqual([]);
    windows(governor, giveUp, 25, 1, 30);
    expect(asked).toEqual(["cpu"]);
    expect(governor.windowsJudged).toBe(2);
  });

  it("starts a fresh window when interrupted, so frames before a renderer swap and after it are not judged together", () => {
    const governor = new FrameGovernor({ warmWindows: 0 });
    governor.setDisplayRate(60);
    const { asked, giveUp } = ladder();
    windows(governor, giveUp, 25, 1, 30);
    // Half a slow window, then the device is replaced.
    for (let frame = 0; frame < 20; frame++) governor.observe(1 / 25, 30, giveUp);
    governor.interrupt();
    // Uninterrupted, these would close a second slow window and give a rung up.
    for (let frame = 0; frame < 20; frame++) governor.observe(1 / 25, 30, giveUp);
    expect(governor.windowsJudged).toBe(1);
    expect(asked).toEqual([]);
  });

  it("leaves tablets, desktops and a phone without the lean motion pipeline their three warm-up windows", () => {
    expect(governorWarmWindows(RENDER_PROFILES.phone)).toBe(0);
    // The switch off: the phone keeps bloom in motion and the governor it had.
    expect(governorWarmWindows({ ...RENDER_PROFILES.phone, bloomInMotion: true })).toBe(3);
    expect(governorWarmWindows(RENDER_PROFILES.tablet)).toBe(3);
    expect(governorWarmWindows(RENDER_PROFILES.desktop)).toBe(3);
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

describe("SwapSettle", () => {
  it("admits every frame until a renderer is replaced", () => {
    const settle = new SwapSettle();
    expect(settle.admit(0.2, 0)).toBe(true);
  });

  it("then holds judgement until two frames in a row come within 50 ms", () => {
    const settle = new SwapSettle();
    settle.begin(1000);
    // A replaced device compiles everything it draws: slow frames, then quick ones.
    expect(settle.admit(0.18, 1200)).toBe(false);
    expect(settle.admit(0.03, 1230)).toBe(false);
    expect(settle.admit(0.12, 1350)).toBe(false);
    expect(settle.admit(0.04, 1390)).toBe(false);
    expect(settle.admit(0.04, 1430)).toBe(false);
    expect(settle.admit(0.12, 1550)).toBe(true);
  });

  it("gives up waiting after a while, so a phone slow by nature is judged again", () => {
    const settle = new SwapSettle();
    settle.begin(0);
    expect(settle.admit(0.08, SWAP_SETTLE_MAX_MS - 1)).toBe(false);
    expect(settle.admit(0.08, SWAP_SETTLE_MAX_MS)).toBe(true);
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

describe("rebuildDue", () => {
  it("never interrupts a hand on the view, however still the frames", () => {
    expect(rebuildDue(5_000, 0, 0, null)).toBe(false);
  });

  it("applies once the view is still with the hand off", () => {
    const now = 5_000;
    expect(rebuildDue(now, 0, now - STILL_MS + 1, now - 100)).toBe(false);
    expect(rebuildDue(now, 0, now - STILL_MS, now - 100)).toBe(true);
  });

  it("applies while a released camera settles by itself, once the hand has been off a while", () => {
    const now = 5_000;
    // Damping and convergence still draw a frame every few milliseconds.
    expect(rebuildDue(now, 0, now - 10, now - SETTLE_MS + 1)).toBe(false);
    expect(rebuildDue(now, 0, now - 10, now - SETTLE_MS)).toBe(true);
  });

  it("applies after a long wait whatever the hand does", () => {
    expect(rebuildDue(REBUILD_WAIT_MS - 1, 0, REBUILD_WAIT_MS - 2, null)).toBe(false);
    expect(rebuildDue(REBUILD_WAIT_MS, 0, REBUILD_WAIT_MS - 1, null)).toBe(true);
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

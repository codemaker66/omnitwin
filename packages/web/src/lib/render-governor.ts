// ---------------------------------------------------------------------------
// Frame-rate governor
//
// Holds the planner's frame rate on whatever device it meets. After the
// governor in Ryan Sael's "Set the Mood" (sael.net/interior), used with his
// permission: frames are judged in windows of about 1.6 s, the first windows
// are left to warm up, two slow windows in a row give up one rung of quality,
// and a rung once given up is not taken back, so the view never pumps between
// two looks.
//
// Changes for the planner. It draws on demand, so the caller passes only the
// frames the device paced (drawn while the view moves, the scene animates or
// the GPU held a frame back) and an interval over 250 ms is an idle gap all
// the same. A window is judged on its fastest 80% of frames, so a hitch or a
// pause in a drag cannot decide it. "Slow" is measured against the display's
// own rate, probed while idle, rather than the best window seen, so a phone
// slow from its first frame steps down too, while one held at 30 Hz (an iPhone
// in Low Power Mode) keeps its quality. Each step says whether the CPU or the
// GPU held the frames up, from the main thread's frame work between draws, so
// the scene gives up passes for the one and pixels for the other. A step is
// judged on the windows either side of it, after one left to settle, and two
// steps in a row that gain nothing end the stepping.
// ---------------------------------------------------------------------------

/** Seconds of drawn frames a window judges. */
export const GOVERNOR_WINDOW_S = 1.6;
/** A window needs this many frames, so a few slow ones cannot decide it. */
const MIN_WINDOW_FRAMES = 12;
/** An interval this long is an idle gap, not the pace. */
const GAP_S = 0.25;
/** The slowest share of a window's frames left out: hitches and pauses, not the pace. */
const OUTLIER_SHARE = 0.2;
/** Windows left alone while the planner settles. */
const WARM_WINDOWS = 3;
/** Below this share of the display's rate (60 at most) a window is slow. */
const SLOW_SHARE = 0.9;
/** A step that does not raise the rate by this much gained nothing. */
const STEP_GAIN = 1.08;
/**
 * Frames whose frame work took this share of their interval on the main
 * thread were held up by the CPU. The rest of a busy thread's time goes to
 * input, the browser and garbage collection, so half is already saturation:
 * measured at 0.65 to 0.8 on a phone held up by its CPU, about 0.2 on one
 * held up by its GPU.
 */
const CPU_BOUND_SHARE = 0.5;

/** What held a slow window's frames up: the CPU (give up passes) or the GPU (give up pixels). */
export type StepKind = "cpu" | "gpu";

/** Gives up one rung of quality for frames held up by `held`; false when nothing is left to give up. */
export type GiveUpQuality = (held: StepKind) => boolean;

export interface FrameSample {
  /** Seconds since the frame before. */
  readonly interval: number;
  /** Seconds of frame work on the main thread meanwhile, or null if unknown. */
  readonly cpu: number | null;
}

export interface WindowPace {
  readonly fps: number;
  /** Share of the frame time spent on frame work on the main thread, or null if unknown. */
  readonly cpuShare: number | null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  const upper = sorted[Math.floor(middle)] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/** A window's pace from its fastest frames, the slowest OUTLIER_SHARE left out. */
export function windowPace(frames: readonly FrameSample[]): WindowPace {
  const kept = [...frames].sort((a, b) => a.interval - b.interval).slice(0, Math.ceil(frames.length * (1 - OUTLIER_SHARE)));
  let time = 0;
  let cpu = 0;
  let timed = 0;
  for (const frame of kept) {
    time += frame.interval;
    if (frame.cpu !== null) {
      cpu += frame.cpu;
      timed += frame.interval;
    }
  }
  return { fps: time > 0 ? kept.length / time : 0, cpuShare: timed > 0 ? cpu / timed : null };
}

export class FrameGovernor {
  private displayHz: number | null = null;
  private frames: FrameSample[] = [];
  private time = 0;
  private windows = 0;
  private slowStreak = 0;
  private steps = 0;
  private settling = false;
  private stopped = false;
  private fruitless = 0;
  private lastFps: number | null = null;
  private lastCpuShare: number | null = null;
  private readonly recent: number[] = [];
  /** A step awaiting judgement: the pace before it and the windows since. */
  private pending: { readonly before: number; readonly after: number[] } | null = null;

  /** How many rungs have been given up. */
  get stepsDown(): number {
    return this.steps;
  }

  /** The display's refresh rate as judged, or null before the probe. */
  get displayRate(): number | null {
    return this.displayHz;
  }

  /** Frames a second of the last window judged, or null before one closes. */
  get lastWindowFps(): number | null {
    return this.lastFps;
  }

  /** The share of the last window's frame time spent on frame work on the main thread, or null if unknown. */
  get lastWindowCpuShare(): number | null {
    return this.lastCpuShare;
  }

  /** How many windows have been judged. */
  get windowsJudged(): number {
    return this.windows;
  }

  /** Whether stepping has ended: nothing was left to give up, or steps gained nothing. */
  get finished(): boolean {
    return this.stopped;
  }

  /** The display's refresh rate, from an idle probe (displayRateFrom). */
  setDisplayRate(hz: number): void {
    if (Number.isFinite(hz) && hz > 0) this.displayHz = hz;
  }

  /**
   * Counts one frame the device paced, drawn `interval` seconds after the one
   * before, with `cpuMs` of frame work on the main thread meanwhile (null if
   * unknown). When the device cannot hold its rate, asks `giveUp` for a rung
   * of quality, saying what held the frames up.
   */
  observe(interval: number, cpuMs: number | null, giveUp: GiveUpQuality): void {
    if (!(interval > 0) || interval >= GAP_S) return;
    this.frames.push({ interval, cpu: cpuMs !== null && Number.isFinite(cpuMs) && cpuMs >= 0 ? cpuMs / 1000 : null });
    this.time += interval;
    if (this.time < GOVERNOR_WINDOW_S || this.frames.length < MIN_WINDOW_FRAMES) return;
    const pace = windowPace(this.frames);
    this.frames = [];
    this.time = 0;
    this.judge(pace, giveUp);
  }

  private judge({ fps, cpuShare }: WindowPace, giveUp: GiveUpQuality): void {
    this.windows += 1;
    this.lastFps = fps;
    this.lastCpuShare = cpuShare;
    // A window faster than the probe means the probe ran on a busy page.
    if (this.displayHz !== null && fps > this.displayHz * 1.1) this.displayHz = fps;
    // The window after a step carries the step's own cost: a resized canvas, a rebuilt pipeline.
    if (this.settling) {
      this.settling = false;
      return;
    }
    this.recent.push(fps);
    if (this.recent.length > 2) this.recent.shift();
    if (this.pending !== null) {
      this.pending.after.push(fps);
      if (this.pending.after.length === 2) {
        this.fruitless = median(this.pending.after) < this.pending.before * STEP_GAIN ? this.fruitless + 1 : 0;
        this.pending = null;
        if (this.fruitless >= 2) this.stopped = true;
      }
    }
    if (this.windows <= WARM_WINDOWS || this.displayHz === null || this.stopped) {
      this.slowStreak = 0;
      return;
    }
    this.slowStreak = fps < Math.min(this.displayHz, 60) * SLOW_SHARE ? this.slowStreak + 1 : 0;
    if (this.slowStreak < 2) return;
    this.slowStreak = 0;
    if (!giveUp(cpuShare !== null && cpuShare >= CPU_BOUND_SHARE ? "cpu" : "gpu")) {
      this.stopped = true;
      return;
    }
    this.steps += 1;
    this.settling = true;
    this.pending = { before: median(this.recent), after: [] };
  }
}

/**
 * The display's refresh rate from requestAnimationFrame timestamps (ms) taken
 * while nothing else draws: the median interval, so a busy frame or two do not
 * move it. Null without enough timestamps.
 */
export function displayRateFrom(stamps: readonly number[]): number | null {
  const intervals: number[] = [];
  for (let index = 1; index < stamps.length; index++) {
    const previous = stamps[index - 1];
    const current = stamps[index];
    if (previous === undefined || current === undefined) continue;
    const interval = current - previous;
    if (interval > 0) intervals.push(interval);
  }
  if (intervals.length < 8) return null;
  return 1000 / median(intervals);
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useHallTimeStore } from "../../../stores/hall-time-store.js";
import { HallSky } from "../HallSky.js";

type FrameCallback = (state: { readonly camera: { readonly position: object } }, delta: number) => void;

interface Published {
  readonly at: number;
  readonly moving: boolean;
}

const r3f = vi.hoisted(() => ({
  invalidate: vi.fn(),
  frames: [] as FrameCallback[],
}));
const sky = vi.hoisted(() => ({ published: [] as Published[] }));

vi.mock("@react-three/fiber", () => ({
  useThree: <T,>(selector: (state: { readonly invalidate: () => void; readonly camera: object }) => T): T =>
    selector({ invalidate: r3f.invalidate, camera: {} }),
  useFrame: (callback: FrameCallback) => {
    r3f.frames.push(callback);
  },
}));
// The sky for a moment is reduced to the moment itself, so each publish says what time was shown.
vi.mock("../hall-sky.js", () => ({ hallSkyAt: (at: number) => ({ at }) }));
vi.mock("../hall-sky-runtime.js", () => ({
  publishHallSky: (shown: { readonly at: number }, moving: boolean) => {
    sky.published.push({ at: shown.at, moving });
  },
  clearHallSky: () => undefined,
}));
vi.mock("../hall-sky-dome.js", () => ({
  SKY_DOME_RADIUS: 4000,
  createSkyDomeGeometry: () => ({ dispose: () => undefined }),
  createSkyDomeMaterial: () => ({ dispose: () => undefined }),
}));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 17 October 2026, 14:00 BST. */
const AFTERNOON = Date.UTC(2026, 9, 17, 13);

/** Runs the sky's frame step, as the on-demand loop would when invalidated. */
function frame(delta = 1 / 60): void {
  const step = r3f.frames[r3f.frames.length - 1];
  expect(step).toBeDefined();
  step?.({ camera: { position: {} } }, delta);
}

function lastShown(): Published {
  const last = sky.published[sky.published.length - 1];
  expect(last).toBeDefined();
  return last ?? { at: Number.NaN, moving: true };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AFTERNOON);
  useHallTimeStore.setState({ mode: "set", at: AFTERNOON, scrubbing: false });
  r3f.frames.length = 0;
  r3f.invalidate.mockClear();
  sky.published.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("HallSky's shown time", () => {
  it("shows a date a day on at once, without sweeping through the night between", () => {
    render(<HallSky dome={false} />);
    frame();
    expect(lastShown()).toEqual({ at: AFTERNOON, moving: false });

    // The date chip keeps the hour: the next day is 24 hours on.
    useHallTimeStore.getState().setTime(AFTERNOON + 24 * HOUR);
    r3f.invalidate.mockClear();
    frame();
    expect(lastShown()).toEqual({ at: AFTERNOON + 24 * HOUR, moving: false });
    // One more frame for the lights that read the sky before it changed, then rest.
    expect(r3f.invalidate).toHaveBeenCalledTimes(1);
    r3f.invalidate.mockClear();
    frame();
    expect(r3f.invalidate).not.toHaveBeenCalled();

    // Back to the clock from yesterday's hour: today arrives at once too.
    useHallTimeStore.getState().setTime(AFTERNOON - 23 * HOUR);
    frame();
    useHallTimeStore.getState().followNow();
    r3f.invalidate.mockClear();
    frame();
    expect(lastShown()).toEqual({ at: AFTERNOON, moving: false });
    expect(r3f.invalidate).toHaveBeenCalledTimes(1);
  });

  it("sweeps to an hour chosen within the day", () => {
    render(<HallSky dome={false} />);
    frame();
    useHallTimeStore.getState().setTime(AFTERNOON + 3 * HOUR);
    r3f.invalidate.mockClear();
    frame();
    const first = lastShown();
    expect(first.moving).toBe(true);
    expect(first.at).toBeGreaterThan(AFTERNOON);
    expect(first.at).toBeLessThan(AFTERNOON + 3 * HOUR);
    expect(r3f.invalidate).toHaveBeenCalled();
    for (let frames = 0; frames < 600 && lastShown().moving; frames += 1) frame();
    expect(lastShown()).toEqual({ at: AFTERNOON + 3 * HOUR, moving: false });
  });

  it("following the clock, takes each half-minute tick in a frame and one for the lights", () => {
    useHallTimeStore.setState({ mode: "now", at: AFTERNOON, scrubbing: false });
    render(<HallSky dome={false} />);
    frame();
    expect(lastShown()).toEqual({ at: AFTERNOON, moving: false });
    for (let tick = 1; tick <= 3; tick += 1) {
      vi.setSystemTime(AFTERNOON + tick * 30_000);
      const published = sky.published.length;
      r3f.invalidate.mockClear();
      frame();
      expect(sky.published).toHaveLength(published + 1);
      expect(lastShown()).toEqual({ at: AFTERNOON + tick * 30_000, moving: false });
      // No sweep: one more frame for the lights, then an idle planner rests.
      expect(r3f.invalidate).toHaveBeenCalledTimes(1);
      r3f.invalidate.mockClear();
      frame();
      expect(sky.published).toHaveLength(published + 1);
      expect(r3f.invalidate).not.toHaveBeenCalled();
    }
  });

  it("following the clock, still sweeps to it after a long gap", () => {
    useHallTimeStore.setState({ mode: "now", at: AFTERNOON, scrubbing: false });
    render(<HallSky dome={false} />);
    frame();
    vi.setSystemTime(AFTERNOON + 40 * MINUTE);
    frame();
    expect(lastShown().moving).toBe(true);
    expect(lastShown().at).toBeLessThan(AFTERNOON + 40 * MINUTE);
  });
});

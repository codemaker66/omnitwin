import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDive } from "../useDive.js";

// ---------------------------------------------------------------------------
// useDive — hand-cranked rAF clock (the useTwinWalk test pattern): each
// crank advances one frame at ~16.7 ms so spring timing is deterministic.
// ---------------------------------------------------------------------------

const FRAME_MS = 1000 / 60;

let rafQueue: FrameRequestCallback[] = [];
let now = 0;

function crank(frames: number): number {
  let ran = 0;
  for (let i = 0; i < frames; i += 1) {
    const queue = rafQueue;
    rafQueue = [];
    if (queue.length === 0) {
      break;
    }
    now += FRAME_MS;
    for (const cb of queue) {
      act(() => {
        cb(now);
      });
      ran += 1;
    }
  }
  return ran;
}

beforeEach(() => {
  rafQueue = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (): void => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDive", () => {
  it("flies 0→1 and settles inside the 1.2s budget, arriving exactly once", () => {
    const onArrive = vi.fn();
    const { result } = renderHook(() => useDive({ onArrive }));

    act(() => {
      result.current.dive("scan_007", { position: [10, 8, 10] });
    });
    expect(result.current.diving).toBe(true);
    expect(result.current.target).toBe("scan_007");
    expect(result.current.from).toEqual([10, 8, 10]);

    const frames = crank(200); // 200 frames ≈ 3.3s ceiling
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(onArrive).toHaveBeenCalledWith("scan_007", "down");
    expect(result.current.diving).toBe(false);
    // Spec budget: dive-in/out ≤ 1.2 s → ≤ 72 simulated frames.
    expect(frames).toBeLessThanOrEqual(72);
  });

  it("is not interruptible mid-flight", () => {
    const onArrive = vi.fn();
    const { result } = renderHook(() => useDive({ onArrive }));

    act(() => {
      result.current.dive("scan_001", { position: [0, 5, 0] });
    });
    crank(3);
    act(() => {
      result.current.dive("scan_002", { position: [1, 5, 1] });
    });
    expect(result.current.target).toBe("scan_001");

    crank(200);
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(onArrive).toHaveBeenCalledWith("scan_001", "down");
  });

  it("carries the direction through to arrival (surfacing)", () => {
    const onArrive = vi.fn();
    const { result } = renderHook(() => useDive({ onArrive }));

    act(() => {
      result.current.dive("scan_000", { position: [0, 1.5, 0], direction: "up" });
    });
    crank(200);
    expect(onArrive).toHaveBeenCalledWith("scan_000", "up");
  });

  it("resolves instantly under prefers-reduced-motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    }));

    const onArrive = vi.fn();
    const { result } = renderHook(() => useDive({ onArrive }));
    act(() => {
      result.current.dive("scan_003", { position: [4, 6, 4] });
    });
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(result.current.diving).toBe(false);
    expect(rafQueue).toHaveLength(0); // no flight scheduled
  });
});

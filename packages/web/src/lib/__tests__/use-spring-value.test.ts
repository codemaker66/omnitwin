import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPRING_PRESETS } from "../springs.js";
import {
  createSpringDriver,
  useSpringCssVariable,
  useSpringValue,
  type FrameClock,
} from "../use-spring-value.js";

// ---------------------------------------------------------------------------
// The spring that drives a value into the DOM (T-671, slice 2). The claims:
// it moves on the shared core and stops the frame it settles, writing the
// exact target; a new target mid-flight keeps the speed it has; a keyboard
// change and reduced motion both set the value at once; and nothing is left
// running when it is disposed or unmounted.
// ---------------------------------------------------------------------------

/** A frame clock a test advances by hand, one 60 fps frame at a time. */
class FakeClock implements FrameClock {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, (timeMs: number) => void>();
  private nowMs = 0;

  readonly request = (callback: (timeMs: number) => void): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  };

  readonly cancel = (handle: number): void => {
    this.callbacks.delete(handle);
  };

  get pending(): number {
    return this.callbacks.size;
  }

  tick(ms = 1000 / 60): void {
    this.nowMs += ms;
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) callback(this.nowMs);
  }

  /** Frames run until nothing is requested, or the cap is hit. */
  runUntilIdle(cap = 600): number {
    let frames = 0;
    while (this.pending > 0 && frames < cap) {
      this.tick();
      frames += 1;
    }
    return frames;
  }
}

function recorder(): { readonly writes: number[]; readonly write: (value: number) => void; readonly last: () => number | undefined } {
  const writes: number[] = [];
  return { writes, write: (value) => { writes.push(value); }, last: () => writes.at(-1) };
}

describe("createSpringDriver", () => {
  it("moves toward a new target and stops the frame it settles, writing the exact target", () => {
    const clock = new FakeClock();
    const out = recorder();
    const driver = createSpringDriver({ initial: 0, config: SPRING_PRESETS.detent, write: out.write, clock, reducedMotion: () => false });

    driver.setTarget(100);
    expect(driver.isMoving()).toBe(true);
    const frames = clock.runUntilIdle();

    expect(frames, "a detent is home well within a second").toBeLessThan(60);
    expect(out.last()).toBe(100);
    expect(driver.isMoving()).toBe(false);
    expect(clock.pending).toBe(0);
    expect(Math.max(...out.writes), "no visible overshoot").toBeLessThan(100.5);
  });

  it("keeps its speed when the target changes mid-flight", () => {
    const clock = new FakeClock();
    const out = recorder();
    const driver = createSpringDriver({ initial: 0, config: SPRING_PRESETS.dialGlide, write: out.write, clock, reducedMotion: () => false });

    driver.setTarget(100);
    for (let i = 0; i < 6; i += 1) clock.tick();
    const before = out.last() ?? 0;
    const stepBefore = before - (out.writes.at(-2) ?? 0);
    expect(stepBefore, "moving up").toBeGreaterThan(0);

    driver.setTarget(0);
    clock.tick();
    const after = out.last() ?? 0;
    // Still carried upward by its speed for a moment: it turns, it does not teleport.
    expect(after).toBeGreaterThan(before - 1);
    expect(clock.runUntilIdle()).toBeGreaterThan(0);
    expect(out.last()).toBe(0);
  });

  it("jumps at once and stops any motion", () => {
    const clock = new FakeClock();
    const out = recorder();
    const driver = createSpringDriver({ initial: 0, config: SPRING_PRESETS.detent, write: out.write, clock, reducedMotion: () => false });

    driver.setTarget(100);
    clock.tick();
    clock.tick();
    driver.jump(50);

    expect(out.last()).toBe(50);
    expect(driver.isMoving()).toBe(false);
    expect(clock.pending).toBe(0);
  });

  it("under reduced motion writes a new target directly and asks for no frame", () => {
    const clock = new FakeClock();
    const out = recorder();
    const driver = createSpringDriver({ initial: 0, config: SPRING_PRESETS.sheetSettle, write: out.write, clock, reducedMotion: () => true });

    driver.setTarget(100);

    expect(out.writes).toEqual([100]);
    expect(clock.pending).toBe(0);
  });

  it("costs no frame and no write for a target it is already resting at", () => {
    const clock = new FakeClock();
    const out = recorder();
    const driver = createSpringDriver({ initial: 10, config: SPRING_PRESETS.detent, write: out.write, clock, reducedMotion: () => false });

    driver.setTarget(10);

    expect(clock.pending).toBe(0);
    expect(out.writes).toEqual([]);
  });

  it("leaves nothing running once disposed", () => {
    const clock = new FakeClock();
    const out = recorder();
    const driver = createSpringDriver({ initial: 0, config: SPRING_PRESETS.detent, write: out.write, clock, reducedMotion: () => false });

    driver.setTarget(100);
    driver.dispose();
    const written = out.writes.length;
    clock.tick();
    driver.setTarget(200);

    expect(clock.pending).toBe(0);
    expect(out.writes.length).toBe(written);
  });
});

describe("useSpringValue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the first value at once, with no frame, then moves to later targets on the spring", () => {
    const clock = new FakeClock();
    const out = recorder();
    const { rerender } = renderHook(({ target }) => { useSpringValue(target, SPRING_PRESETS.detent, out.write, { clock }); }, { initialProps: { target: 40 } });

    expect(out.writes).toEqual([40]);
    expect(clock.pending).toBe(0);

    rerender({ target: 100 });
    expect(clock.pending).toBe(1);
    act(() => { clock.runUntilIdle(); });
    expect(out.last()).toBe(100);
    expect(out.writes.length, "it moved through values on the way").toBeGreaterThan(3);
  });

  it("takes a change made from the keyboard at once", () => {
    const clock = new FakeClock();
    const out = recorder();
    const { rerender } = renderHook(({ target, instant }) => { useSpringValue(target, SPRING_PRESETS.detent, out.write, { clock, instant }); }, { initialProps: { target: 0, instant: false } });

    rerender({ target: 200, instant: true });

    expect(out.last()).toBe(200);
    expect(clock.pending).toBe(0);
  });

  it("honours reduced motion: a new target is set directly", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
    const clock = new FakeClock();
    const out = recorder();
    const { rerender } = renderHook(({ target }) => { useSpringValue(target, SPRING_PRESETS.dialGlide, out.write, { clock }); }, { initialProps: { target: 0 } });

    rerender({ target: 90 });

    expect(out.writes).toEqual([0, 90]);
    expect(clock.pending).toBe(0);
  });

  it("stops its frame loop when the component unmounts", () => {
    const clock = new FakeClock();
    const out = recorder();
    const { rerender, unmount } = renderHook(({ target }) => { useSpringValue(target, SPRING_PRESETS.sheetSettle, out.write, { clock }); }, { initialProps: { target: 0 } });

    rerender({ target: 300 });
    expect(clock.pending).toBe(1);
    unmount();

    expect(clock.pending).toBe(0);
  });

  it("does not restart the motion when only the writer changes", () => {
    const clock = new FakeClock();
    const first = recorder();
    const second = recorder();
    const { rerender } = renderHook(({ target, write }) => { useSpringValue(target, SPRING_PRESETS.detent, write, { clock }); }, { initialProps: { target: 0, write: first.write } });

    rerender({ target: 100, write: first.write });
    act(() => { clock.tick(); clock.tick(); });
    rerender({ target: 100, write: second.write });
    act(() => { clock.runUntilIdle(); });

    expect(second.writes.length, "the new writer takes over mid-flight").toBeGreaterThan(0);
    expect(second.writes[0], "from where the spring was, not from the start").toBeGreaterThan(0);
    expect(second.last()).toBe(100);
  });
});

describe("useSpringCssVariable", () => {
  it("drives a custom property on the element, in its unit", () => {
    const clock = new FakeClock();
    const element = document.createElement("div");
    const ref = { current: element };
    const { rerender } = renderHook(({ target }) => { useSpringCssVariable(ref, "--pc-underline-x", target, SPRING_PRESETS.detent, { clock }); }, { initialProps: { target: 12 } });

    expect(element.style.getPropertyValue("--pc-underline-x")).toBe("12px");

    rerender({ target: 96 });
    act(() => { clock.runUntilIdle(); });
    expect(element.style.getPropertyValue("--pc-underline-x")).toBe("96px");
  });
});

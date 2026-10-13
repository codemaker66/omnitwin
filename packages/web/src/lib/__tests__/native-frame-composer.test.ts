import { describe, expect, it } from "vitest";
import { nativeFrameComposer, registerNativeFrameComposer } from "../native-frame-composer.js";

describe("native frame composers", () => {
  it("draws plainly until a composer registers, and again once it is released", () => {
    const renderer = {};
    const compose = (): void => { /* draws a frame */ };
    expect(nativeFrameComposer(renderer)).toBeNull();
    const release = registerNativeFrameComposer(renderer, compose);
    expect(nativeFrameComposer(renderer)).toBe(compose);
    release();
    expect(nativeFrameComposer(renderer)).toBeNull();
  });

  it("lets the latest registration win, and an older release leave it in place", () => {
    const renderer = {};
    const first = (): void => { /* the pipeline before a rebuild */ };
    const second = (): void => { /* the rebuilt pipeline */ };
    const releaseFirst = registerNativeFrameComposer(renderer, first);
    const releaseSecond = registerNativeFrameComposer(renderer, second);
    releaseFirst();
    expect(nativeFrameComposer(renderer)).toBe(second);
    releaseSecond();
    expect(nativeFrameComposer(renderer)).toBeNull();
  });

  it("keeps each renderer's composer separate", () => {
    const planner = {};
    const preview = {};
    const compose = (): void => { /* draws the planner */ };
    registerNativeFrameComposer(planner, compose);
    expect(nativeFrameComposer(preview)).toBeNull();
  });
});

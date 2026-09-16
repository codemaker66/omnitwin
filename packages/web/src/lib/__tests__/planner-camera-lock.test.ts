import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lockPlannerCamera,
  plannerCameraLocked,
  resetPlannerCameraLock,
  subscribePlannerCameraLock,
} from "../planner-camera-lock.js";

describe("planner camera lock", () => {
  afterEach(() => { resetPlannerCameraLock(); });

  it("starts unlocked and reports the lock for the life of one drag", () => {
    expect(plannerCameraLocked()).toBe(false);
    const release = lockPlannerCamera();
    expect(plannerCameraLocked()).toBe(true);
    release();
    expect(plannerCameraLocked()).toBe(false);
  });

  it("releases once however many times it is called", () => {
    // closePointerGesture runs from pointerup, pointercancel,
    // lostpointercapture and unmount. Two of those firing for one gesture must
    // not decrement past a hold that a second gesture is relying on.
    const release = lockPlannerCamera();
    release();
    release();
    release();
    expect(plannerCameraLocked()).toBe(false);
    const second = lockPlannerCamera();
    expect(plannerCameraLocked()).toBe(true);
    second();
  });

  it("stays locked while any holder remains", () => {
    const first = lockPlannerCamera();
    const second = lockPlannerCamera();
    first();
    expect(plannerCameraLocked()).toBe(true);
    second();
    expect(plannerCameraLocked()).toBe(false);
  });

  it("notifies only on the transitions, not on every hold", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlannerCameraLock(listener);
    const first = lockPlannerCamera();
    expect(listener).toHaveBeenCalledTimes(1);
    const second = lockPlannerCamera();
    expect(listener).toHaveBeenCalledTimes(1);
    first();
    expect(listener).toHaveBeenCalledTimes(1);
    second();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    lockPlannerCamera()();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("survives a listener that unsubscribes itself while being notified", () => {
    const other = vi.fn();
    const unsubscribeOther = subscribePlannerCameraLock(other);
    const unsubscribeSelf = subscribePlannerCameraLock(() => { unsubscribeSelf(); });
    expect(() => { lockPlannerCamera()(); }).not.toThrow();
    expect(other).toHaveBeenCalledTimes(2);
    unsubscribeOther();
  });

  it("drops every hold on reset, so a planner unmounted mid-drag cannot strand the next one", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlannerCameraLock(listener);
    lockPlannerCamera();
    lockPlannerCamera();
    resetPlannerCameraLock();
    expect(plannerCameraLocked()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    // Already clear: a second reset has nothing to say.
    resetPlannerCameraLock();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("ignores a stale release taken before a reset", () => {
    // The drag that owned this release is gone. Calling it must not push the
    // count below zero and silently unlock a later, live gesture.
    const stale = lockPlannerCamera();
    resetPlannerCameraLock();
    stale();
    const live = lockPlannerCamera();
    expect(plannerCameraLocked()).toBe(true);
    live();
    expect(plannerCameraLocked()).toBe(false);
  });
});

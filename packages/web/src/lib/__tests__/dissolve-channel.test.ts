import { describe, expect, it } from "vitest";
import {
  createDissolveChannel,
  setDissolveTarget,
  stepDissolveChannel,
} from "../dissolve-channel.js";

const DIRECTIONS = [[0, 1], [1, 0]] as const;

describe.each([0.12, 0.16])("dissolve channels with ease %s", (ease) => {
  it.each(DIRECTIONS)("gives equal elapsed time equal progress from %s to %s", (start, target) => {
    const single = createDissolveChannel(start, 0);
    setDissolveTarget(single, target, ease, 0);
    stepDissolveChannel(single, ease, 240);

    for (const partition of [[20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20], [10, 17, 48, 5, 160]]) {
      const split = createDissolveChannel(start, 0);
      setDissolveTarget(split, target, ease, 0);
      let now = 0;
      for (const duration of partition) {
        now += duration;
        stepDissolveChannel(split, ease, now);
        expect(split.value).toBeGreaterThanOrEqual(0);
        expect(split.value).toBeLessThanOrEqual(1);
      }
      expect(split.value).toBeCloseTo(single.value, 12);
      expect(split.value).not.toBe(start);
      expect(split.value).not.toBe(target);
    }
  });

  it.each([1_000, 10_000])("finishes an active fade after a %sms frame gap", (gap) => {
    for (const [start, target] of DIRECTIONS) {
      const channel = createDissolveChannel(start, 0);
      setDissolveTarget(channel, target, ease, 0);
      expect(stepDissolveChannel(channel, ease, gap)).toBe(true);
      expect(channel.value).toBe(target);
      expect(stepDissolveChannel(channel, ease, gap + 16)).toBe(false);
    }
  });

  it("does not charge a long settled demand-loop idle to a fresh target", () => {
    const rested = createDissolveChannel(0, 0);
    setDissolveTarget(rested, 1, ease, 60_000);
    const fresh = createDissolveChannel(0, 60_000);
    setDissolveTarget(fresh, 1, ease, 60_000);
    expect(rested.value).toBe(0);
    stepDissolveChannel(rested, ease, 60_100);
    stepDissolveChannel(fresh, ease, 60_100);
    expect(rested.value).toBeCloseTo(fresh.value, 12);
    expect(rested.value).toBeGreaterThan(0);
    expect(rested.value).toBeLessThan(1);
  });

  it.each(DIRECTIONS)("reverses continuously after moving from %s toward %s", (start, target) => {
    const channel = createDissolveChannel(start, 0);
    const uninterrupted = createDissolveChannel(start, 0);
    setDissolveTarget(channel, target, ease, 0);
    setDissolveTarget(uninterrupted, target, ease, 0);
    stepDissolveChannel(channel, ease, 100);
    stepDissolveChannel(uninterrupted, ease, 175);
    setDissolveTarget(channel, start, ease, 175);
    expect(channel.value).toBeCloseTo(uninterrupted.value, 12);
    expect(channel.target).toBe(start);
    const reversedAt = channel.value;
    stepDissolveChannel(channel, ease, 275);
    expect(Math.abs(channel.value - start)).toBeLessThan(Math.abs(reversedAt - start));
    expect(channel.value).toBeGreaterThanOrEqual(0);
    expect(channel.value).toBeLessThanOrEqual(1);
    expect(stepDissolveChannel(channel, ease, 2_000)).toBe(true);
    expect(channel.value).toBe(start);
    expect(stepDissolveChannel(channel, ease, 2_016)).toBe(false);
  });

  it("snaps reduced motion without needing elapsed time and redraws once", () => {
    for (const now of [0, Number.NaN]) {
      const channel = createDissolveChannel(0, 0);
      setDissolveTarget(channel, 1, ease, 0);
      expect(stepDissolveChannel(channel, ease, now, true)).toBe(true);
      expect(channel.value).toBe(1);
      expect(stepDissolveChannel(channel, ease, now, true)).toBe(false);
    }
  });

  it("snaps on the frame crossing the settle boundary, then lets demand rendering sleep", () => {
    const channel = createDissolveChannel(0, 0);
    setDissolveTarget(channel, 1, ease, 0);
    const settleAt = ease === 0.12 ? 600 : 450;
    expect(stepDissolveChannel(channel, ease, settleAt)).toBe(true);
    expect(channel.value).toBe(1);
    expect(stepDissolveChannel(channel, ease, settleAt + 16)).toBe(false);
  });
});

describe("dissolve clock ownership", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 150])(
    "ignores invalid or backwards frame time %s without losing later elapsed time",
    (invalidNow) => {
      const channel = createDissolveChannel(0, 100);
      const control = createDissolveChannel(0, 100);
      setDissolveTarget(channel, 1, 0.12, 100);
      setDissolveTarget(control, 1, 0.12, 100);
      stepDissolveChannel(channel, 0.12, 200);
      const before = { ...channel };
      expect(stepDissolveChannel(channel, 0.12, invalidNow)).toBe(true);
      expect(channel).toEqual(before);
      stepDissolveChannel(channel, 0.12, 300);
      stepDissolveChannel(control, 0.12, 300);
      expect(channel.value).toBeCloseTo(control.value, 12);
      expect(channel.lastStepMs).toBe(300);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 50])(
    "establishes a fresh epoch after an invalid retarget timestamp %s",
    (invalidNow) => {
      const channel = createDissolveChannel(0, 100);
      setDissolveTarget(channel, 1, 0.12, invalidNow);
      expect(channel.lastStepMs).toBeNull();
      expect(stepDissolveChannel(channel, 0.12, 10_000)).toBe(true);
      expect(channel.value).toBe(0);
      stepDissolveChannel(channel, 0.12, 10_016);
      expect(channel.value).toBeGreaterThan(0);
      expect(channel.value).toBeLessThan(1);
    },
  );

  it("does not move twice at an identical timestamp", () => {
    const channel = createDissolveChannel(0, 0);
    setDissolveTarget(channel, 1, 0.12, 0);
    stepDissolveChannel(channel, 0.12, 100);
    const before = { ...channel };
    expect(stepDissolveChannel(channel, 0.12, 100)).toBe(true);
    expect(channel).toEqual(before);
  });

  it("does not restart an active fade when the requested target is unchanged", () => {
    const channel = createDissolveChannel(0, 0);
    const control = createDissolveChannel(0, 0);
    setDissolveTarget(channel, 1, 0.12, 0);
    setDissolveTarget(control, 1, 0.12, 0);
    stepDissolveChannel(channel, 0.12, 100);
    setDissolveTarget(channel, 1, 0.12, 200);
    stepDissolveChannel(channel, 0.12, 300);
    stepDissolveChannel(control, 0.12, 300);
    expect(channel.value).toBeCloseTo(control.value, 12);
  });

  it("starts a late chunk independently while an older active channel catches up", () => {
    const oldChunk = createDissolveChannel(0, 0);
    setDissolveTarget(oldChunk, 1, 0.12, 0);
    stepDissolveChannel(oldChunk, 0.12, 100);
    const lateChunk = createDissolveChannel(0, 10_000);
    setDissolveTarget(lateChunk, 1, 0.12, 10_000);
    stepDissolveChannel(oldChunk, 0.12, 10_000);
    stepDissolveChannel(lateChunk, 0.12, 10_000);
    expect(oldChunk.value).toBe(1);
    expect(lateChunk.value).toBe(0);
    stepDissolveChannel(lateChunk, 0.12, 10_016);
    expect(lateChunk.value).toBeGreaterThan(0);
    expect(lateChunk.value).toBeLessThan(1);
  });

  it("keeps an invalid initial clock out of the channel timeline", () => {
    const channel = createDissolveChannel(0, Number.NaN);
    expect(channel.lastStepMs).toBeNull();
    setDissolveTarget(channel, 1, 0.12, 5_000);
    expect(channel.lastStepMs).toBe(5_000);
    stepDissolveChannel(channel, 0.12, 5_016);
    expect(channel.value).toBeGreaterThan(0);
    expect(channel.value).toBeLessThan(1);
  });
});

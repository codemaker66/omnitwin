import { describe, expect, it } from "vitest";
import {
  CLOTH_DRAPE_FADE_SECONDS,
  CLOTH_DRAPE_LIFT,
  CLOTH_DRAPE_SECONDS,
  CLOTH_DRAPE_SPRING,
  claimClothDrapeSlot,
  clothAnimationFor,
  clothDrapeDelaySeconds,
  clothDrapePose,
  createClothDrapePose,
  type ClothAnimation,
  type ClothAnimationFacts,
  type ClothDrapePose,
} from "../cloth-drape.js";
import { stepSpring, type SpringState } from "../springs.js";

// ---------------------------------------------------------------------------
// The cloth drape (PQ-7, Blake's decision 3): a cloth goes on in 450 ms,
// from 8 cm on a critically damped spring, fading in over 120 ms, a set
// rippling 20 ms a cloth up to 300 ms.
// ---------------------------------------------------------------------------

const MM = 0.001;

/** The pose `ms` after a cloth went on, in a fresh object. */
function poseAt(ms: number, delayMs = 0, reducedMotion = false): ClothDrapePose {
  return clothDrapePose(createClothDrapePose(), ms / 1000, delayMs / 1000, reducedMotion);
}

describe("the drape's spring", () => {
  it("is the brief's spring, a hair over critical damping with unit mass", () => {
    expect(CLOTH_DRAPE_SPRING).toEqual({ stiffness: 300, damping: 35 });
    const zeta = CLOTH_DRAPE_SPRING.damping / (2 * Math.sqrt(CLOTH_DRAPE_SPRING.stiffness));
    expect(zeta).toBeGreaterThan(1);
    expect(zeta).toBeLessThan(1.02);
  });

  it("follows the shared spring core, stepped live at 120 Hz, to within half a millimetre", () => {
    const live: SpringState = { value: CLOTH_DRAPE_LIFT, velocity: 0 };
    for (let frame = 1; frame / 120 < CLOTH_DRAPE_SECONDS; frame++) {
      stepSpring(live, 0, 1 / 120, CLOTH_DRAPE_SPRING);
      expect(Math.abs(poseAt((frame * 1000) / 120).lift - live.value)).toBeLessThan(0.5 * MM);
    }
  });
});

describe("a cloth going on", () => {
  it("starts 8 cm above its rest, unseen", () => {
    expect(CLOTH_DRAPE_LIFT).toBe(0.08);
    expect(poseAt(0)).toEqual({ lift: CLOTH_DRAPE_LIFT, opacity: 0, done: false });
  });

  it("is at rest, fully opaque, by 450 ms after its own start", () => {
    expect(poseAt(450)).toEqual({ lift: 0, opacity: 1, done: true });
    expect(poseAt(2000)).toEqual({ lift: 0, opacity: 1, done: true });
    const lastMoving = poseAt(449.9);
    expect(lastMoving.done).toBe(false);
    expect(lastMoving.lift).toBeLessThan(MM);
    expect(lastMoving.opacity).toBe(1);
  });

  it("comes down without ever dipping below its rest or rising again", () => {
    let previous = CLOTH_DRAPE_LIFT;
    for (let ms = 0; ms <= 450; ms += 0.5) {
      const { lift } = poseAt(ms);
      expect(lift).toBeGreaterThanOrEqual(0);
      expect(lift).toBeLessThanOrEqual(previous);
      previous = lift;
    }
  });

  it("lands on its rest exactly, so the static cloth takes over without a jump", () => {
    expect(poseAt(449.999).lift).toBeLessThan(0.01 * MM);
    // At 60 Hz the step into rest is no bigger than the step of the frame before it.
    const frame = 1000 / 60;
    const stepIntoRest = poseAt(450 - frame).lift;
    const stepBefore = poseAt(450 - 2 * frame).lift - poseAt(450 - frame).lift;
    expect(stepIntoRest).toBeLessThan(0.15 * MM);
    expect(stepIntoRest).toBeLessThanOrEqual(stepBefore);
  });

  it("has fallen most of the way by the time it has faded in", () => {
    expect(poseAt(CLOTH_DRAPE_FADE_SECONDS * 1000).lift).toBeLessThan(CLOTH_DRAPE_LIFT / 2);
  });

  it("fades in over its first 120 ms and stays fully opaque after", () => {
    expect(CLOTH_DRAPE_FADE_SECONDS).toBe(0.12);
    expect(poseAt(30).opacity).toBeCloseTo(0.25, 6);
    expect(poseAt(60).opacity).toBeCloseTo(0.5, 6);
    expect(poseAt(119).opacity).toBeLessThan(1);
    for (let ms = 120; ms <= 460; ms += 5) expect(poseAt(ms).opacity).toBe(1);
  });

  it("waits unseen at its start height through its place in a ripple", () => {
    expect(poseAt(0, 100)).toEqual({ lift: CLOTH_DRAPE_LIFT, opacity: 0, done: false });
    expect(poseAt(100, 100)).toEqual({ lift: CLOTH_DRAPE_LIFT, opacity: 0, done: false });
    const sixtyIn = poseAt(160, 100);
    expect(sixtyIn.lift).toBeCloseTo(poseAt(60).lift, 9);
    expect(sixtyIn.opacity).toBeCloseTo(0.5, 6);
    expect(poseAt(549, 100).done).toBe(false);
    expect(poseAt(550.01, 100).done).toBe(true);
  });

  it("is simply there under reduced motion: at rest at 0 ms, with no fade and no wait", () => {
    expect(poseAt(0, 0, true)).toEqual({ lift: 0, opacity: 1, done: true });
    expect(poseAt(0, 300, true)).toEqual({ lift: 0, opacity: 1, done: true });
  });

  it("writes the pose it is given, so a frame allocates nothing", () => {
    const pose = createClothDrapePose();
    expect(clothDrapePose(pose, 0.1, 0)).toBe(pose);
    expect(clothDrapePose(pose, 1, 0)).toBe(pose);
  });
});

describe("a set of cloths going on together", () => {
  it("starts each 20 ms after the one before, none later than 300 ms", () => {
    expect(clothDrapeDelaySeconds(0)).toBe(0);
    expect(clothDrapeDelaySeconds(1)).toBeCloseTo(0.02, 9);
    expect(clothDrapeDelaySeconds(2)).toBeCloseTo(0.04, 9);
    expect(clothDrapeDelaySeconds(13)).toBeCloseTo(0.26, 9);
    expect(clothDrapeDelaySeconds(15)).toBeCloseTo(0.3, 9);
    expect(clothDrapeDelaySeconds(16)).toBe(0.3);
    expect(clothDrapeDelaySeconds(200)).toBe(0.3);
  });

  it("dresses 14 rounds in a 260 ms ripple, all at rest by 710 ms", () => {
    const delays = Array.from({ length: 14 }, (_, slot) => clothDrapeDelaySeconds(slot) * 1000);
    expect(delays.at(-1)).toBeCloseTo(260, 6);
    for (const delay of delays) {
      // Only the last, starting at 260 ms, is still coming down at 709 ms.
      expect(poseAt(709, delay).done).toBe(delay < 259.5);
      expect(poseAt(710.01, delay).done).toBe(true);
    }
  });

  it("rests a laid-out room of 40 tables by 750 ms", () => {
    for (let slot = 0; slot < 40; slot++) {
      expect(poseAt(750.01, clothDrapeDelaySeconds(slot) * 1000).done).toBe(true);
    }
    expect(poseAt(749, clothDrapeDelaySeconds(39) * 1000).done).toBe(false);
  });

  it("numbers the cloths of one synchronous pass in order and starts again after it", async () => {
    await Promise.resolve();
    expect([claimClothDrapeSlot(), claimClothDrapeSlot(), claimClothDrapeSlot()]).toEqual([0, 1, 2]);
    await Promise.resolve();
    expect([claimClothDrapeSlot(), claimClothDrapeSlot()]).toEqual([0, 1]);
    await Promise.resolve();
  });
});

describe("which animation a cloth goes on with", () => {
  type Case = [Omit<ClothAnimationFacts, "reducedMotion">, ClothAnimation, ClothAnimation];
  // [the keys and whether Present plays, the animation, the animation under reduced motion]
  const cases: Case[] = [
    [{ clothDrape: false, clothDrapeOnly: false, presenting: false }, "spiral", "spiral"],
    [{ clothDrape: false, clothDrapeOnly: false, presenting: true }, "spiral", "spiral"],
    [{ clothDrape: true, clothDrapeOnly: false, presenting: false }, "drape", "still"],
    [{ clothDrape: true, clothDrapeOnly: false, presenting: true }, "spiral", "still"],
    [{ clothDrape: false, clothDrapeOnly: true, presenting: false }, "drape", "still"],
    [{ clothDrape: false, clothDrapeOnly: true, presenting: true }, "drape", "still"],
    [{ clothDrape: true, clothDrapeOnly: true, presenting: false }, "drape", "still"],
    [{ clothDrape: true, clothDrapeOnly: true, presenting: true }, "drape", "still"],
  ];

  it.each(cases)("%o: %s, and %s under reduced motion", (facts, moving, reduced) => {
    expect(clothAnimationFor({ ...facts, reducedMotion: false })).toBe(moving);
    expect(clothAnimationFor({ ...facts, reducedMotion: true })).toBe(reduced);
  });
});

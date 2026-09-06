import { describe, expect, it } from "vitest";
import {
  createLanternBudget,
  dprForFill,
  LANTERN_DEGRADED_PARTICLES,
  LANTERN_DPR_LADDER,
  LANTERN_FULL_PARTICLES,
  lanternFillMegapixels,
  nextDprRungBelow,
  stepLanternBudget,
} from "../lantern-budget.js";
import {
  LANTERN_FRAME_BUDGET_MS,
  LANTERN_MAX_FILL_MEGAPIXELS,
  LANTERN_TRIPWIRE_FRAMES,
  type LanternBudgetState,
} from "../lantern-types.js";

const SLOW_MS = LANTERN_FRAME_BUDGET_MS + 4;
const CLEAN_MS = LANTERN_FRAME_BUDGET_MS - 4;

function step(state: LanternBudgetState, frameMs: number, times: number): LanternBudgetState {
  let next = state;
  for (let i = 0; i < times; i += 1) {
    next = stepLanternBudget(next, frameMs);
  }
  return next;
}

describe("createLanternBudget", () => {
  it("caps the device ratio at the default ceiling of 1.5 and starts whole", () => {
    const budget = createLanternBudget(3);
    expect(budget).toEqual({ dpr: 1.5, particles: LANTERN_FULL_PARTICLES, overBudgetFrames: 0, degraded: false });
  });

  it("keeps a 1x desktop at 1 and lets high tier ask for 2", () => {
    expect(createLanternBudget(1).dpr).toBe(1);
    expect(createLanternBudget(2.5, 2).dpr).toBe(2);
  });
});

describe("stepLanternBudget — the 30-frames-over-20 ms tripwire", () => {
  it("does not trip on twenty-nine slow frames", () => {
    const budget = step(createLanternBudget(1.5), SLOW_MS, LANTERN_TRIPWIRE_FRAMES - 1);
    expect(budget.degraded).toBe(false);
    expect(budget.dpr).toBe(1.5);
    expect(budget.particles).toBe(LANTERN_FULL_PARTICLES);
    expect(budget.overBudgetFrames).toBe(LANTERN_TRIPWIRE_FRAMES - 1);
  });

  it("trips on the thirtieth: DPR 1.5 → 1.25, particles to 100, the count reset", () => {
    const budget = step(createLanternBudget(1.5), SLOW_MS, LANTERN_TRIPWIRE_FRAMES);
    expect(budget).toEqual({ dpr: 1.25, particles: LANTERN_DEGRADED_PARTICLES, overBudgetFrames: 0, degraded: true });
  });

  it("walks the ladder 1.5 → 1.25 → 1 and holds at 1", () => {
    const first = step(createLanternBudget(1.5), SLOW_MS, LANTERN_TRIPWIRE_FRAMES);
    const second = step(first, SLOW_MS, LANTERN_TRIPWIRE_FRAMES);
    const third = step(second, SLOW_MS, LANTERN_TRIPWIRE_FRAMES);
    expect(first.dpr).toBe(1.25);
    expect(second.dpr).toBe(1);
    expect(third.dpr).toBe(1);
    expect(third.degraded).toBe(true);
    expect(third.particles).toBe(LANTERN_DEGRADED_PARTICLES);
  });

  it("treats a frame at exactly the budget as within it and returns the same object at rest", () => {
    const budget = createLanternBudget(1.5);
    expect(stepLanternBudget(budget, LANTERN_FRAME_BUDGET_MS)).toBe(budget);
  });

  it("is a leaky count: clean frames drain the evidence one for one", () => {
    const twentySlow = step(createLanternBudget(1.5), SLOW_MS, 20);
    const drained = step(twentySlow, CLEAN_MS, 20);
    expect(drained.overBudgetFrames).toBe(0);
    const again = step(drained, SLOW_MS, 20);
    expect(again.degraded).toBe(false);
    expect(again.overBudgetFrames).toBe(20);
  });

  it("still trips when jank is sustained with the odd clean frame in it", () => {
    let budget = createLanternBudget(1.5);
    for (let i = 0; i < 80; i += 1) {
      budget = stepLanternBudget(budget, i % 4 === 3 ? CLEAN_MS : SLOW_MS);
    }
    expect(budget.degraded).toBe(true);
    expect(budget.dpr).toBe(1.25);
  });

  it("ignores frames that are not evidence (non-finite or non-positive)", () => {
    const budget = createLanternBudget(1.5);
    expect(stepLanternBudget(budget, Number.NaN)).toBe(budget);
    expect(stepLanternBudget(budget, 0)).toBe(budget);
    expect(stepLanternBudget(budget, -5)).toBe(budget);
  });

  it("drops from a ratio between rungs to the next rung below", () => {
    expect(nextDprRungBelow(1.33)).toBe(1.25);
    expect(nextDprRungBelow(2)).toBe(1.5);
    expect(nextDprRungBelow(1)).toBe(1);
    expect(LANTERN_DPR_LADDER).toEqual([2, 1.5, 1.25, 1]);
  });
});

describe("lanternFillMegapixels — the 6 Mpx cap", () => {
  it("keeps a 390×844 phone at DPR 1.5 well under the cap", () => {
    const fill = lanternFillMegapixels(390, 844, 1.5);
    expect(fill).toBeCloseTo(0.7407, 3);
    expect(fill).toBeLessThan(LANTERN_MAX_FILL_MEGAPIXELS);
  });

  it("keeps a 430×932 phone at DPR 1.5 well under the cap", () => {
    const fill = lanternFillMegapixels(430, 932, 1.5);
    expect(fill).toBeCloseTo(0.9019, 3);
    expect(fill).toBeLessThan(LANTERN_MAX_FILL_MEGAPIXELS);
  });

  it("keeps a 1920×1080 desktop at DPR 1.5 under the cap", () => {
    expect(lanternFillMegapixels(1920, 1080, 1.5)).toBeLessThan(LANTERN_MAX_FILL_MEGAPIXELS);
  });

  it("lowers the DPR for a 2560×1440 monitor so the fill meets the cap", () => {
    const dpr = dprForFill(2560, 1440, 1.5);
    expect(dpr).toBeLessThan(1.5);
    expect(lanternFillMegapixels(2560, 1440, dpr)).toBeLessThanOrEqual(LANTERN_MAX_FILL_MEGAPIXELS + 1e-9);
  });

  it("leaves a phone's DPR alone", () => {
    expect(dprForFill(390, 844, 1.5)).toBe(1.5);
    expect(dprForFill(430, 932, 1.5)).toBe(1.5);
  });
});

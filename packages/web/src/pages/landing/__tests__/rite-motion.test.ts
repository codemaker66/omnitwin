import { describe, expect, it } from "vitest";
import {
  ACT_HEIGHTS_VH,
  RITE_SPRINGS,
  TOTAL_RITE_VH,
  easeOutCubic,
  flameDisturbance,
  isAfterDusk,
  isSpringSettled,
  riteProgress,
  stepSpring,
  type SpringState,
} from "../rite-motion.js";

const VH = 1000; // synthetic viewport height for progress math

function settle(state: SpringState, target: number, seconds: number): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    stepSpring(state, target, dt, RITE_SPRINGS.cursorLight);
  }
}

describe("stepSpring", () => {
  it("converges to the target and settles", () => {
    const state: SpringState = { value: 0, velocity: 0 };
    settle(state, 100, 4);
    expect(state.value).toBeCloseTo(100, 1);
    expect(isSpringSettled(state, 100, 0.5)).toBe(true);
  });

  it("survives a huge dt without exploding (tab-switch pause)", () => {
    const state: SpringState = { value: 0, velocity: 0 };
    stepSpring(state, 50, 10, RITE_SPRINGS.flameIntensity); // clamped internally
    expect(Number.isFinite(state.value)).toBe(true);
    expect(Math.abs(state.value)).toBeLessThan(200);
  });

  it("the flame spring is underdamped — it overshoots before settling", () => {
    const state: SpringState = { value: 0, velocity: 0 };
    let overshot = false;
    const dt = 1 / 60;
    for (let t = 0; t < 4; t += dt) {
      stepSpring(state, 1, dt, RITE_SPRINGS.flameIntensity);
      if (state.value > 1.001) {
        overshot = true;
      }
    }
    expect(overshot).toBe(true);
    expect(state.value).toBeCloseTo(1, 1);
  });
});

describe("flameDisturbance", () => {
  it("is calm at rest and fully guttered at the knee", () => {
    expect(flameDisturbance(0)).toBe(0);
    expect(flameDisturbance(900)).toBe(1);
    expect(flameDisturbance(5000)).toBe(1);
  });

  it("responds gently to gentle movement", () => {
    expect(flameDisturbance(90)).toBeLessThan(0.05);
    expect(flameDisturbance(450)).toBeGreaterThan(0.1);
    expect(flameDisturbance(450)).toBeLessThan(0.9);
  });
});

describe("easeOutCubic", () => {
  it("clamps and hits its boundaries", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); // ease-out front-loads
  });
});

describe("riteProgress", () => {
  it("mirrors the act layout constants", () => {
    expect(ACT_HEIGHTS_VH.map(([act]) => act)).toEqual([
      "threshold",
      "darkness",
      "magnitude",
      "contemplation",
      "return",
    ]);
    expect(TOTAL_RITE_VH).toBe(13);
  });

  it("walks the dramaturgy in order", () => {
    expect(riteProgress(0, VH).act).toBe("threshold");
    expect(riteProgress(999, VH).act).toBe("threshold");
    expect(riteProgress(1000, VH).act).toBe("darkness");
    expect(riteProgress(3499, VH).act).toBe("darkness");
    expect(riteProgress(3500, VH).act).toBe("magnitude");
    expect(riteProgress(6499, VH).act).toBe("magnitude");
    expect(riteProgress(6500, VH).act).toBe("contemplation");
    expect(riteProgress(11499, VH).act).toBe("contemplation");
    expect(riteProgress(11500, VH).act).toBe("return");
    expect(riteProgress(999999, VH).act).toBe("return");
  });

  it("reports act progress and overall progress in 0..1", () => {
    const mid = riteProgress(2250, VH); // halfway through darkness (1000+1250)
    expect(mid.act).toBe("darkness");
    expect(mid.actProgress).toBeCloseTo(0.5, 2);
    expect(riteProgress(0, VH).overall).toBe(0);
    expect(riteProgress(12000, VH).overall).toBe(1);
    expect(riteProgress(999999, VH).overall).toBe(1);
  });

  it("maps contemplation into four chapters", () => {
    expect(riteProgress(6500, VH).chapterIndex).toBe(0);
    expect(riteProgress(7800, VH).chapterIndex).toBe(1);
    expect(riteProgress(9100, VH).chapterIndex).toBe(2);
    expect(riteProgress(10400, VH).chapterIndex).toBe(3);
    expect(riteProgress(11499, VH).chapterIndex).toBe(3);
    expect(riteProgress(0, VH).chapterIndex).toBeNull();
    expect(riteProgress(11500, VH).chapterIndex).toBeNull();
  });

  it("degrades safely with a zero viewport", () => {
    const p = riteProgress(100, 0);
    expect(p.overall).toBe(0);
    expect(Number.isFinite(p.actProgress)).toBe(true);
  });
});

describe("isAfterDusk", () => {
  it("knows a July midnight from a July noon in Glasgow", () => {
    expect(isAfterDusk(new Date(2026, 6, 1, 23, 30))).toBe(true);
    expect(isAfterDusk(new Date(2026, 6, 1, 12, 0))).toBe(false);
    expect(isAfterDusk(new Date(2026, 6, 1, 3, 0))).toBe(true);
  });

  it("knows a December afternoon is already dark", () => {
    expect(isAfterDusk(new Date(2026, 11, 21, 16, 30))).toBe(true);
    expect(isAfterDusk(new Date(2026, 11, 21, 10, 0))).toBe(false);
  });
});

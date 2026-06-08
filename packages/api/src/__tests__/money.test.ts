import { describe, it, expect } from "vitest";
import {
  roundToInt,
  poundsToMinor,
  minorToMajor,
  multiplyMinor,
  scaleMinor,
  sumMinor,
  allocateMinor,
  splitEvenly,
  depositSplit,
  formatMinor,
} from "../services/money.js";

// Deterministic PRNG (mulberry32) so the randomized property tests are
// reproducible — same seed, same cases, every run.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("roundToInt", () => {
  it("half-even rounds ties to the nearest even integer", () => {
    expect(roundToInt(0.5, "half-even")).toBe(0);
    expect(roundToInt(1.5, "half-even")).toBe(2);
    expect(roundToInt(2.5, "half-even")).toBe(2);
    expect(roundToInt(3.5, "half-even")).toBe(4);
  });
  it("supports the other modes", () => {
    expect(roundToInt(2.5, "half-up")).toBe(3);
    expect(roundToInt(2.5, "half-down")).toBe(2);
    expect(roundToInt(2.4, "half-up")).toBe(2);
    expect(roundToInt(2.1, "ceil")).toBe(3);
    expect(roundToInt(2.9, "floor")).toBe(2);
  });
  it("passes through exact integers and non-finite input", () => {
    expect(roundToInt(7)).toBe(7);
    expect(roundToInt(Number.NaN)).toBe(0);
  });
});

describe("poundsToMinor / minorToMajor", () => {
  it("converts pounds to exact pence", () => {
    expect(poundsToMinor(12.5)).toBe(1250);
    expect(poundsToMinor(12.55)).toBe(1255);
    expect(poundsToMinor(0.1)).toBe(10);
    expect(poundsToMinor(999.99)).toBe(99999);
    expect(poundsToMinor(0)).toBe(0);
  });
  it("round-trips integer pence back through major units", () => {
    const rng = mulberry32(1);
    for (let n = 0; n < 3000; n += 1) {
      const pence = Math.trunc(rng() * 5_000_00);
      expect(poundsToMinor(minorToMajor(pence))).toBe(pence);
    }
  });
});

describe("multiplyMinor / scaleMinor / sumMinor", () => {
  it("multiplies by an integer quantity exactly", () => {
    expect(multiplyMinor(1250, 17)).toBe(21250);
    expect(multiplyMinor(999, 0)).toBe(0);
  });
  it("rejects a fractional quantity (use scaleMinor)", () => {
    expect(() => multiplyMinor(1250, 4.5)).toThrow(RangeError);
  });
  it("scales by a real factor with one rounding step", () => {
    expect(scaleMinor(1000, 1)).toBe(1000);
    expect(scaleMinor(1000, 1.15)).toBe(1150);
    expect(scaleMinor(100, 0.5)).toBe(50);
    // Exact half-penny ties resolve to the nearest even pence (0.5 is exactly
    // representable, so these products are true ties — unlike 1.15 rates).
    expect(scaleMinor(5, 0.5)).toBe(2); // 2.5 → even → 2
    expect(scaleMinor(15, 0.5)).toBe(8); // 7.5 → even → 8
  });
  it("sums exactly", () => {
    expect(sumMinor([10, 20, 30])).toBe(60);
    expect(sumMinor([])).toBe(0);
  });
});

describe("allocateMinor — Σ parts ≡ total (the invariant floats break)", () => {
  it("splits £100 three ways with no penny lost", () => {
    const parts = allocateMinor(10000, [1, 1, 1]);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(sumMinor(parts)).toBe(10000);
  });

  it("apportions proportionally to weights", () => {
    const parts = allocateMinor(10000, [50, 30, 20]);
    expect(sumMinor(parts)).toBe(10000);
    expect(parts).toEqual([5000, 3000, 2000]);
  });

  it("treats all-zero weights as an even split", () => {
    expect(allocateMinor(10, [0, 0, 0])).toEqual([4, 3, 3]);
  });

  it("returns the whole total for a single part", () => {
    expect(allocateMinor(9999, [7])).toEqual([9999]);
  });

  it("always sums to the total and stays within a penny of the ideal share", () => {
    const rng = mulberry32(42);
    for (let trial = 0; trial < 5000; trial += 1) {
      const total = Math.trunc(rng() * 1_000_00);
      const n = 1 + Math.trunc(rng() * 8);
      const weights = Array.from({ length: n }, () => Math.trunc(rng() * 100));
      const parts = allocateMinor(total, weights);

      expect(parts).toHaveLength(n);
      expect(sumMinor(parts)).toBe(total); // the invariant
      for (const p of parts) expect(p).toBeGreaterThanOrEqual(0);

      const totalWeight = weights.reduce((s, w) => s + w, 0);
      if (totalWeight > 0) {
        for (let i = 0; i < n; i += 1) {
          const ideal = (total * (weights[i] ?? 0)) / totalWeight;
          expect(Math.abs((parts[i] ?? 0) - ideal)).toBeLessThan(1 + 1e-9);
        }
      }
    }
  });
});

describe("splitEvenly", () => {
  it("sums to the total with parts differing by at most one", () => {
    const rng = mulberry32(7);
    for (let trial = 0; trial < 3000; trial += 1) {
      const total = Math.trunc(rng() * 1_000_00);
      const n = 1 + Math.trunc(rng() * 12);
      const parts = splitEvenly(total, n);
      expect(parts).toHaveLength(n);
      expect(sumMinor(parts)).toBe(total);
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
    }
  });
});

describe("depositSplit — deposit + balance ≡ total", () => {
  it("computes a rounded deposit and an exact balance", () => {
    expect(depositSplit(10000, 0.25)).toEqual({ deposit: 2500, balance: 7500 });
    expect(depositSplit(9999, 0.5)).toEqual({ deposit: 5000, balance: 4999 }); // 4999.5 → even → 5000
  });
  it("clamps the rate to [0, 1]", () => {
    expect(depositSplit(10000, 2)).toEqual({ deposit: 10000, balance: 0 });
    expect(depositSplit(10000, -1)).toEqual({ deposit: 0, balance: 10000 });
  });
  it("preserves the total for any rate and amount", () => {
    const rng = mulberry32(99);
    for (let trial = 0; trial < 3000; trial += 1) {
      const total = Math.trunc(rng() * 5_000_00);
      const rate = rng();
      const { deposit, balance } = depositSplit(total, rate);
      expect(deposit + balance).toBe(total);
      expect(deposit).toBeGreaterThanOrEqual(0);
      expect(balance).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("formatMinor", () => {
  it("formats minor units as GBP", () => {
    const formatted = formatMinor(123456);
    expect(formatted).toContain("1,234.56");
    expect(formatted).toContain("£");
  });
});

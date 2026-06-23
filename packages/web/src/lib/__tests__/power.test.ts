import { describe, it, expect } from "vitest";
import { buildDistroPlan, supplyLabel, PHASE_VOLTAGE } from "../power.js";

const PF = 0.9;
const legVA = PHASE_VOLTAGE * PF; // 207

describe("buildDistroPlan", () => {
  it("balances equal loads evenly across three phases", () => {
    const plan = buildDistroPlan(Array.from({ length: 6 }, () => 200)); // 6 × 200 W
    expect(plan.phaseCount).toBe(3);
    expect(plan.phases.map((p) => p.watts)).toEqual([400, 400, 400]);
    expect(plan.phases.map((p) => p.fixtures)).toEqual([2, 2, 2]);
    expect(plan.phases[0]?.amps).toBeCloseTo(400 / legVA, 3);
    expect(plan.imbalancePercent).toBe(0);
    expect(plan.totalWatts).toBe(1200);
    expect(plan.totalKva).toBeCloseTo(1200 / PF / 1000, 3);
    expect(plan.recommendedSupplyA).toBe(16);
    expect(plan.warnings).toHaveLength(0);
  });

  it("warns when a phase exceeds its breaker and recommends a bigger supply", () => {
    const plan = buildDistroPlan([7000], { phaseCount: 1, perPhaseBreakerA: 32 });
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]?.amps).toBeCloseTo(7000 / legVA, 1); // ~33.8 A
    expect(plan.warnings.some((w) => /exceeds the 32 A breaker/.test(w))).toBe(true);
    expect(plan.recommendedSupplyA).toBe(63);
    expect(plan.imbalancePercent).toBe(0); // single-phase
  });

  it("warns when three phases are badly unbalanced", () => {
    const plan = buildDistroPlan([1000, 100, 100]);
    expect(plan.phases.map((p) => p.watts)).toEqual([1000, 100, 100]);
    expect(plan.imbalancePercent).toBe(90); // (1000 − 100) / 1000
    expect(plan.warnings.some((w) => /unbalanced/.test(w))).toBe(true);
  });

  it("returns a clean empty plan for no fixtures", () => {
    const plan = buildDistroPlan([]);
    expect(plan.totalWatts).toBe(0);
    expect(plan.phases.every((p) => p.watts === 0 && p.fixtures === 0)).toBe(true);
    expect(plan.warnings).toHaveLength(0);
    expect(plan.recommendedSupplyA).toBe(16);
  });

  it("honours custom voltage and power factor", () => {
    const plan = buildDistroPlan([2300], { phaseCount: 1, voltage: 230, powerFactor: 1 });
    expect(plan.phases[0]?.amps).toBeCloseTo(2300 / 230, 3); // 10 A
  });
});

describe("supplyLabel", () => {
  it("labels the recommended supply by phase", () => {
    expect(supplyLabel(buildDistroPlan([200], { phaseCount: 1 }))).toBe("16 A single-phase");
    expect(supplyLabel(buildDistroPlan([7000]))).toMatch(/3-phase/);
  });
});

import { describe, it, expect } from "vitest";
import {
  buildDistroPlan,
  supplyLabel,
  circuitSummaryLabel,
  PHASE_VOLTAGE,
  DEFAULT_CIRCUIT_BREAKER_A,
} from "../power.js";

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

describe("buildDistroPlan — circuit grouping (distro ways)", () => {
  it("defaults to 16 A ways and fits a light phase on a single way", () => {
    const plan = buildDistroPlan(Array.from({ length: 6 }, () => 200)); // 3 × 400 W
    expect(plan.circuitBreakerA).toBe(DEFAULT_CIRCUIT_BREAKER_A);
    // 400 W is well under a 16 A way (~3,312 W), so each phase needs one way.
    expect(plan.phases.map((p) => p.circuits.length)).toEqual([1, 1, 1]);
    expect(plan.circuitCount).toBe(3);
    const first = plan.phases[0]?.circuits[0];
    expect(first?.id).toBe("L1-1");
    expect(first?.fixtures).toBe(2);
    expect(first?.watts).toBe(400);
    expect(first?.amps).toBeCloseTo(400 / (PHASE_VOLTAGE * 0.9), 3);
  });

  it("splits a phase onto multiple ways when a small way fills up", () => {
    // Four 1,000 W fixtures on one phase; a 6 A way holds ~1,242 W → one each.
    const plan = buildDistroPlan([1000, 1000, 1000, 1000], { phaseCount: 1, circuitBreakerA: 6 });
    const circuits = plan.phases[0]?.circuits ?? [];
    expect(circuits).toHaveLength(4);
    expect(circuits.map((c) => c.id)).toEqual(["L1-1", "L1-2", "L1-3", "L1-4"]);
    expect(circuits.every((c) => c.fixtures === 1)).toBe(true);
    expect(plan.circuitCount).toBe(4);
    expect(circuitSummaryLabel(plan)).toBe("4 × 6 A ways");
  });

  it("packs several light fixtures onto one way (first-fit-decreasing)", () => {
    // Six 200 W fixtures on one phase fit a single 16 A way (~3,312 W).
    const plan = buildDistroPlan(Array.from({ length: 6 }, () => 200), { phaseCount: 1 });
    expect(plan.circuitCount).toBe(1);
    expect(plan.phases[0]?.circuits[0]?.fixtures).toBe(6);
    expect(circuitSummaryLabel(plan)).toBe("1 × 16 A way");
  });

  it("warns when a single fixture is heavier than its way", () => {
    const plan = buildDistroPlan([1500], { phaseCount: 1, circuitBreakerA: 6 }); // ~7.2 A > 6 A
    const circuit = plan.phases[0]?.circuits[0];
    expect(circuit?.utilisationPercent).toBeGreaterThan(100);
    expect(plan.warnings.some((w) => /Circuit L1-1 .* exceeds its 6 A way/.test(w))).toBe(true);
  });

  it("returns no circuits for an empty rig", () => {
    const plan = buildDistroPlan([]);
    expect(plan.circuitCount).toBe(0);
    expect(plan.phases.every((p) => p.circuits.length === 0)).toBe(true);
    expect(circuitSummaryLabel(plan)).toBe("0 × 16 A ways");
  });
});

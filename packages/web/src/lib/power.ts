// ---------------------------------------------------------------------------
// power — indicative electrical distribution + phase balance (Epic 6 Power module).
//
// Given a set of per-fixture loads (watts), it distributes them across a 1- or
// 3-phase supply using a greedy least-loaded balancer, then reports per-phase
// load/current, phase imbalance, breaker headroom, and a recommended supply
// rating. Single-phase current I = P / (V·PF) per leg (UK 230 V line-to-neutral).
//
// IN scope (per the Epic 6 research): sum loads by phase, single/three-phase
// current, breaker-over and 3-phase-imbalance warnings, connector/supply sizing.
// OUT of scope: full circuit design, cable sizing, protection coordination.
//
// SAFE: indicative planning from per-fixture defaults — NOT an electrical design
// or certification. A competent electrician must verify before energising. See
// POWER_PLANNING_DISCLAIMER.
// ---------------------------------------------------------------------------

/** UK line-to-neutral voltage (single-phase per leg). */
export const PHASE_VOLTAGE = 230;
export const DEFAULT_POWER_FACTOR = 0.9;
export const DEFAULT_PER_PHASE_BREAKER_A = 32;

/** Standard IEC 60309 / feeder supply ratings used for the recommendation. */
export const STANDARD_SUPPLY_RATINGS_A = [16, 32, 63, 125, 250, 400] as const;

/** Imbalance above this (%) across L1/L2/L3 earns a warning. */
export const PHASE_IMBALANCE_WARNING_PERCENT = 20;

export type PhaseLabel = "L1" | "L2" | "L3";
const THREE_PHASE_LABELS: readonly PhaseLabel[] = ["L1", "L2", "L3"];

export interface PhaseLoad {
  readonly phase: PhaseLabel;
  readonly watts: number;
  readonly amps: number;
  readonly fixtures: number;
}

export interface DistroPlan {
  readonly phaseCount: 1 | 3;
  readonly phases: readonly PhaseLoad[];
  readonly totalWatts: number;
  /** Apparent power, kVA = (W / PF) / 1000. */
  readonly totalKva: number;
  /** (max − min) ÷ max across phases, percent; 0 for single-phase. */
  readonly imbalancePercent: number;
  readonly perPhaseBreakerA: number;
  /** Smallest standard supply rating ≥ the busiest phase current. */
  readonly recommendedSupplyA: number;
  readonly warnings: readonly string[];
  readonly voltage: number;
  readonly powerFactor: number;
}

export interface DistroOptions {
  readonly phaseCount?: 1 | 3;
  readonly perPhaseBreakerA?: number;
  readonly voltage?: number;
  readonly powerFactor?: number;
}

/**
 * Build an indicative distribution plan from per-fixture watts. Greedy
 * least-loaded assignment keeps the phases balanced. Pure and deterministic.
 */
export function buildDistroPlan(fixtureWatts: readonly number[], options: DistroOptions = {}): DistroPlan {
  const phaseCount: 1 | 3 = options.phaseCount === 1 ? 1 : 3;
  const voltage = options.voltage !== undefined && options.voltage > 0 ? options.voltage : PHASE_VOLTAGE;
  const powerFactor = options.powerFactor !== undefined && options.powerFactor > 0 ? options.powerFactor : DEFAULT_POWER_FACTOR;
  const perPhaseBreakerA = options.perPhaseBreakerA !== undefined && options.perPhaseBreakerA > 0
    ? options.perPhaseBreakerA
    : DEFAULT_PER_PHASE_BREAKER_A;

  const labels: readonly PhaseLabel[] = phaseCount === 1 ? ["L1"] : THREE_PHASE_LABELS;
  const watts: number[] = labels.map(() => 0);
  const fixtures: number[] = labels.map(() => 0);

  // Largest-first greedy least-loaded balancing.
  const loads = fixtureWatts.filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => b - a);
  for (const load of loads) {
    let target = 0;
    for (let i = 1; i < watts.length; i += 1) {
      if ((watts[i] ?? 0) < (watts[target] ?? 0)) target = i;
    }
    watts[target] = (watts[target] ?? 0) + load;
    fixtures[target] = (fixtures[target] ?? 0) + 1;
  }

  const phases: PhaseLoad[] = labels.map((phase, i) => {
    const w = watts[i] ?? 0;
    return { phase, watts: w, amps: w / (voltage * powerFactor), fixtures: fixtures[i] ?? 0 };
  });

  const totalWatts = watts.reduce((sum, w) => sum + w, 0);
  const maxWatts = phases.reduce((max, p) => Math.max(max, p.watts), 0);
  const minWatts = phases.reduce((min, p) => Math.min(min, p.watts), maxWatts);
  const imbalancePercent = phaseCount > 1 && maxWatts > 0
    ? Math.round(((maxWatts - minWatts) / maxWatts) * 100)
    : 0;

  const maxAmps = phases.reduce((max, p) => Math.max(max, p.amps), 0);
  const recommendedSupplyA = STANDARD_SUPPLY_RATINGS_A.find((rating) => rating >= maxAmps)
    ?? STANDARD_SUPPLY_RATINGS_A[STANDARD_SUPPLY_RATINGS_A.length - 1] ?? DEFAULT_PER_PHASE_BREAKER_A;

  const warnings: string[] = [];
  for (const phase of phases) {
    if (phase.amps > perPhaseBreakerA) {
      warnings.push(`${phase.phase} ~${phase.amps.toFixed(0)} A exceeds the ${String(perPhaseBreakerA)} A breaker`);
    }
  }
  if (imbalancePercent > PHASE_IMBALANCE_WARNING_PERCENT) {
    warnings.push(`Phases unbalanced (${String(imbalancePercent)}%) — redistribute fixtures across L1/L2/L3`);
  }

  const totalKva = powerFactor > 0 ? totalWatts / powerFactor / 1000 : 0;

  return {
    phaseCount,
    phases,
    totalWatts,
    totalKva,
    imbalancePercent,
    perPhaseBreakerA,
    recommendedSupplyA,
    warnings,
    voltage,
    powerFactor,
  };
}

/** Label for a recommended supply, e.g. "63 A 3-phase" / "32 A single-phase". */
export function supplyLabel(plan: DistroPlan): string {
  return `${String(plan.recommendedSupplyA)} A ${plan.phaseCount === 1 ? "single-phase" : "3-phase"}`;
}

export const POWER_PLANNING_DISCLAIMER =
  "Indicative power distribution and phase balance from per-fixture defaults — not an electrical design or "
  + "certification. A competent electrician must verify circuits, protection, and connectors against BS 7909 / "
  + "BS 7671 before energising.";

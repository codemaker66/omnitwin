// ---------------------------------------------------------------------------
// power — indicative electrical distribution + phase balance (Epic 6 Power module).
//
// Given a set of per-fixture loads (watts), it distributes them across a 1- or
// 3-phase supply using a greedy least-loaded balancer, then reports per-phase
// load/current, phase imbalance, breaker headroom, and a recommended supply
// rating. Single-phase current I = P / (V·PF) per leg (UK 230 V line-to-neutral).
//
// IN scope (per the Epic 6 research): sum loads by phase, single/three-phase
// current, breaker-over and 3-phase-imbalance warnings, connector/supply sizing,
// and grouping each phase's fixtures onto protected circuits (distro ways) fed
// from the phase. OUT of scope: full circuit design, cable sizing, protection
// coordination.
//
// SAFE: indicative planning from per-fixture defaults — NOT an electrical design
// or certification. A competent electrician must verify before energising. See
// POWER_PLANNING_DISCLAIMER.
// ---------------------------------------------------------------------------

/** UK line-to-neutral voltage (single-phase per leg). */
export const PHASE_VOLTAGE = 230;
export const DEFAULT_POWER_FACTOR = 0.9;
export const DEFAULT_PER_PHASE_BREAKER_A = 32;

/** Default protected circuit / distro way rating, downstream of the phase breaker. */
export const DEFAULT_CIRCUIT_BREAKER_A = 16;

/** Standard IEC 60309 / feeder supply ratings used for the recommendation. */
export const STANDARD_SUPPLY_RATINGS_A = [16, 32, 63, 125, 250, 400] as const;

/** Imbalance above this (%) across L1/L2/L3 earns a warning. */
export const PHASE_IMBALANCE_WARNING_PERCENT = 20;

export type PhaseLabel = "L1" | "L2" | "L3";
const THREE_PHASE_LABELS: readonly PhaseLabel[] = ["L1", "L2", "L3"];

/** One protected circuit (distro way) carrying a subset of a phase's fixtures. */
export interface Circuit {
  /** Stable id, e.g. "L1-2" (phase + 1-based way number). */
  readonly id: string;
  readonly phase: PhaseLabel;
  readonly watts: number;
  readonly amps: number;
  readonly fixtures: number;
  readonly breakerA: number;
  /** amps ÷ breakerA, percent (may exceed 100 for an over-loaded way). */
  readonly utilisationPercent: number;
}

export interface PhaseLoad {
  readonly phase: PhaseLabel;
  readonly watts: number;
  readonly amps: number;
  readonly fixtures: number;
  /** The phase's fixtures packed onto protected circuits (distro ways). */
  readonly circuits: readonly Circuit[];
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
  /** Rating of each protected circuit (distro way) fed from a phase. */
  readonly circuitBreakerA: number;
  /** Total protected circuits (distro ways) needed across all phases. */
  readonly circuitCount: number;
  /** Smallest standard supply rating ≥ the busiest phase current. */
  readonly recommendedSupplyA: number;
  readonly warnings: readonly string[];
  readonly voltage: number;
  readonly powerFactor: number;
}

export interface DistroOptions {
  readonly phaseCount?: 1 | 3;
  readonly perPhaseBreakerA?: number;
  readonly circuitBreakerA?: number;
  readonly voltage?: number;
  readonly powerFactor?: number;
}

/**
 * First-fit-decreasing bin-packing of a phase's fixtures onto protected circuits.
 * Each circuit (distro way) holds fixtures up to circuitBreakerA · V · PF watts; a
 * single fixture heavier than that gets its own way (utilisation > 100%, warned).
 */
function packCircuits(
  phase: PhaseLabel,
  fixtureWatts: readonly number[],
  circuitBreakerA: number,
  voltage: number,
  powerFactor: number,
): Circuit[] {
  const legVa = voltage * powerFactor;
  const maxWatts = circuitBreakerA * legVa;
  const sorted = [...fixtureWatts].sort((a, b) => b - a);
  const bins: { watts: number; fixtures: number }[] = [];
  for (const w of sorted) {
    let placed = false;
    for (const bin of bins) {
      if (bin.watts + w <= maxWatts) {
        bin.watts += w;
        bin.fixtures += 1;
        placed = true;
        break;
      }
    }
    if (!placed) bins.push({ watts: w, fixtures: 1 });
  }
  return bins.map((bin, i) => {
    const amps = legVa > 0 ? bin.watts / legVa : 0;
    return {
      id: `${phase}-${String(i + 1)}`,
      phase,
      watts: bin.watts,
      amps,
      fixtures: bin.fixtures,
      breakerA: circuitBreakerA,
      utilisationPercent: circuitBreakerA > 0 ? Math.round((amps / circuitBreakerA) * 100) : 0,
    };
  });
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
  const circuitBreakerA = options.circuitBreakerA !== undefined && options.circuitBreakerA > 0
    ? options.circuitBreakerA
    : DEFAULT_CIRCUIT_BREAKER_A;

  const labels: readonly PhaseLabel[] = phaseCount === 1 ? ["L1"] : THREE_PHASE_LABELS;
  const watts: number[] = labels.map(() => 0);
  const fixtures: number[] = labels.map(() => 0);
  const phaseFixtureWatts: number[][] = labels.map(() => []);

  // Largest-first greedy least-loaded balancing.
  const loads = fixtureWatts.filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => b - a);
  for (const load of loads) {
    let target = 0;
    for (let i = 1; i < watts.length; i += 1) {
      if ((watts[i] ?? 0) < (watts[target] ?? 0)) target = i;
    }
    watts[target] = (watts[target] ?? 0) + load;
    fixtures[target] = (fixtures[target] ?? 0) + 1;
    phaseFixtureWatts[target]?.push(load);
  }

  const phases: PhaseLoad[] = labels.map((phase, i) => {
    const w = watts[i] ?? 0;
    const circuits = packCircuits(phase, phaseFixtureWatts[i] ?? [], circuitBreakerA, voltage, powerFactor);
    return { phase, watts: w, amps: w / (voltage * powerFactor), fixtures: fixtures[i] ?? 0, circuits };
  });
  const circuitCount = phases.reduce((sum, p) => sum + p.circuits.length, 0);

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
  for (const phase of phases) {
    for (const circuit of phase.circuits) {
      if (circuit.amps > circuitBreakerA) {
        warnings.push(`Circuit ${circuit.id} ~${circuit.amps.toFixed(0)} A exceeds its ${String(circuitBreakerA)} A way`);
      }
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
    circuitBreakerA,
    circuitCount,
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

/** Label for the distro way count, e.g. "9 × 16 A ways" / "1 × 16 A way". */
export function circuitSummaryLabel(plan: DistroPlan): string {
  const unit = plan.circuitCount === 1 ? "way" : "ways";
  return `${String(plan.circuitCount)} × ${String(plan.circuitBreakerA)} A ${unit}`;
}

export const POWER_PLANNING_DISCLAIMER =
  "Indicative power distribution and phase balance from per-fixture defaults — not an electrical design or "
  + "certification. A competent electrician must verify circuits, protection, and connectors against BS 7909 / "
  + "BS 7671 before energising.";

// ---------------------------------------------------------------------------
// rigging — indicative suspended-load + bridle planning (Epic 6 Rigging module).
//
// A single-point / two-leg bridle calculator: given a suspended load, the
// bridle geometry, and a point's working load limit, it reports per-leg tension,
// WLL headroom, and the safety warnings the research calls for (over-WLL,
// shallow bridle angle, static point anchoring a hoist).
//
// Formulas: single point → leg tension = load. Two-leg bridle with each leg at
// angle θ from horizontal → leg tension = load / (2·sin θ) — climbs steeply at
// shallow angles. (Per the Epic 6 research.)
//
// HARD SAFE BOUNDARY: this is PLANNING ONLY. It does NOT certify a point or rig,
// verify dynamic/flying loads, or replace a competent rigger, the venue's
// rigging authority, or a structural engineer. See RIGGING_PLANNING_DISCLAIMER.
// ---------------------------------------------------------------------------

const DEG2RAD = Math.PI / 180;

/** What a venue point is rated to carry. A static point must NOT anchor a hoist. */
export type PermittedUse = "static-only" | "manual-hoist" | "power-hoist";

/** What the suspended load actually is. */
export type LoadKind = "static" | "manual-hoist" | "power-hoist";

/** Bridle angle (from horizontal) below this earns a shallow-angle warning. */
export const SHALLOW_BRIDLE_ANGLE_DEG = 30;

export interface BridleInput {
  /** Total weight suspended from the point / bridle, kg. */
  readonly suspendedLoadKg: number;
  /** 1 = single point; 2 = two-leg bridle. */
  readonly bridleLegs: 1 | 2;
  /** Each leg's angle from the horizontal, degrees (two-leg only). */
  readonly legAngleFromHorizontalDeg: number;
  /** The point's working load limit, kg. */
  readonly pointWllKg: number;
  /** What the venue point is rated for. */
  readonly permittedUse: PermittedUse;
  /** What the suspended load is. */
  readonly loadKind: LoadKind;
}

export interface RiggingAssessment {
  readonly suspendedLoadKg: number;
  /** Tension carried by each leg / the single point, kg. */
  readonly legTensionKg: number;
  readonly pointWllKg: number;
  /** legTension ÷ WLL, percent. */
  readonly utilizationPercent: number;
  /** WLL − legTension, kg (negative when over). */
  readonly headroomKg: number;
  readonly withinWll: boolean;
  readonly warnings: readonly string[];
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Tension per leg for the bridle. Single point carries the whole load. */
export function legTensionKg(suspendedLoadKg: number, bridleLegs: 1 | 2, legAngleFromHorizontalDeg: number): number {
  const load = nonNegative(suspendedLoadKg);
  if (bridleLegs === 1) return load;
  const theta = Math.max(1, Math.min(90, legAngleFromHorizontalDeg)) * DEG2RAD;
  return load / (2 * Math.sin(theta));
}

/** Is this venue point rated to anchor this load kind? */
function permittedUseAllows(permittedUse: PermittedUse, loadKind: LoadKind): boolean {
  if (loadKind === "static") return true;
  if (loadKind === "manual-hoist") return permittedUse === "manual-hoist" || permittedUse === "power-hoist";
  return permittedUse === "power-hoist"; // power hoist needs a power-hoist-rated point
}

/** Assess a suspended load on a point / bridle. Pure and indicative. */
export function assessRigging(input: BridleInput): RiggingAssessment {
  const suspendedLoadKg = nonNegative(input.suspendedLoadKg);
  const pointWllKg = nonNegative(input.pointWllKg);
  const tension = legTensionKg(suspendedLoadKg, input.bridleLegs, input.legAngleFromHorizontalDeg);
  const utilizationPercent = pointWllKg > 0 ? Math.round((tension / pointWllKg) * 100) : 0;
  const headroomKg = pointWllKg - tension;
  const withinWll = pointWllKg > 0 && tension <= pointWllKg;

  const warnings: string[] = [];
  if (pointWllKg > 0 && tension > pointWllKg) {
    warnings.push(`Leg tension ~${String(Math.round(tension))} kg exceeds the point WLL ${String(Math.round(pointWllKg))} kg`);
  }
  if (input.bridleLegs === 2 && input.legAngleFromHorizontalDeg < SHALLOW_BRIDLE_ANGLE_DEG) {
    warnings.push(`Shallow bridle angle (<${String(SHALLOW_BRIDLE_ANGLE_DEG)}°) — leg tension climbs steeply; widen the angle or add a point`);
  }
  if (!permittedUseAllows(input.permittedUse, input.loadKind)) {
    if (input.permittedUse === "static-only") {
      warnings.push("A static-only point must NOT anchor a hoist — use a hoist-rated point");
    } else {
      warnings.push("Power hoist on a manual-rated point — verify the point is rated for powered lifting");
    }
  }

  return { suspendedLoadKg, legTensionKg: tension, pointWllKg, utilizationPercent, headroomKg, withinWll, warnings };
}

export const RIGGING_PLANNING_DISCLAIMER =
  "Indicative rigging planning only — NOT a rigging certification. It does not verify the point, structure, or "
  + "dynamic loads. A competent rigger, the venue's rigging authority, and a structural engineer must verify and "
  + "sign off before anything is flown (LOLER 1998 / Work at Height Regs 2005).";

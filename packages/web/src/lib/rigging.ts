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
  /** The point's working load limit, kg; null when nobody has recorded it. */
  readonly pointWllKg: number | null;
  /** What the venue point is rated for; null when nobody has recorded it. */
  readonly permittedUse: PermittedUse | null;
  /** What the suspended load is. */
  readonly loadKind: LoadKind;
}

/**
 * The arithmetic, never a pass. There is deliberately no "within WLL" field:
 * a WLL typed into a planner is not a point anyone has checked, so the only
 * verdict this module returns is the warning that a load is OVER the figure
 * entered (redteam fix-first 2).
 */
export interface RiggingAssessment {
  readonly suspendedLoadKg: number;
  /** Tension carried by each leg / the single point, kg. */
  readonly legTensionKg: number;
  /** The WLL entered, or null when none is recorded. */
  readonly pointWllKg: number | null;
  /** legTension ÷ WLL, percent; null without a WLL. */
  readonly utilizationPercent: number | null;
  /** WLL − legTension, kg (negative when over); null without a WLL. */
  readonly headroomKg: number | null;
  /** True only when a WLL is recorded and the leg tension exceeds it. */
  readonly overWll: boolean;
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
  const pointWllKg = input.pointWllKg !== null && nonNegative(input.pointWllKg) > 0 ? input.pointWllKg : null;
  const tension = legTensionKg(suspendedLoadKg, input.bridleLegs, input.legAngleFromHorizontalDeg);
  const utilizationPercent = pointWllKg !== null ? Math.round((tension / pointWllKg) * 100) : null;
  const headroomKg = pointWllKg !== null ? pointWllKg - tension : null;
  const overWll = pointWllKg !== null && tension > pointWllKg;

  const warnings: string[] = [];
  if (overWll) {
    warnings.push(`Leg tension ~${String(Math.round(tension))} kg exceeds the point WLL ${String(Math.round(pointWllKg))} kg`);
  }
  if (input.bridleLegs === 2 && input.legAngleFromHorizontalDeg < SHALLOW_BRIDLE_ANGLE_DEG) {
    warnings.push(`Shallow bridle angle (<${String(SHALLOW_BRIDLE_ANGLE_DEG)}°) — leg tension climbs steeply; widen the angle or add a point`);
  }
  // A point's rating nobody recorded raises no warning and no reassurance:
  // the panel shows it as not recorded, with the hallkeeper to ask.
  if (input.permittedUse !== null && !permittedUseAllows(input.permittedUse, input.loadKind)) {
    if (input.permittedUse === "static-only") {
      warnings.push("A static-only point must NOT anchor a hoist — use a hoist-rated point");
    } else {
      warnings.push("Power hoist on a manual-rated point — verify the point is rated for powered lifting");
    }
  }

  return { suspendedLoadKg, legTensionKg: tension, pointWllKg, utilizationPercent, headroomKg, overWll, warnings };
}

export const RIGGING_PLANNING_DISCLAIMER =
  "Indicative rigging planning only — NOT a rigging certification. It does not verify the point, structure, or "
  + "dynamic loads. A competent rigger, the venue's rigging authority, and a structural engineer must verify and "
  + "sign off before anything is flown (LOLER 1998 / Work at Height Regs 2005).";

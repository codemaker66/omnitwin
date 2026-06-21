// ---------------------------------------------------------------------------
// Egress & occupancy — planning-grade means-of-escape model.
//
// This is the regulatory/safety counterpart to layout-capacity.ts. Where
// layout-capacity answers "is this comfortable for N guests?" with event
// rules-of-thumb, this module answers "what is the occupant load, and does the
// room have enough exit width and acceptable travel distance?" using the
// published prescriptive factors from:
//   - UK Approved Document B (ADB) Vol 2 — Appendix D floor-space factors,
//     Table 2.1 travel distances, horizontal-escape exit widths, merging flow.
//   - NFPA 101 (2018) — Table 7.3.1.2 occupant-load factors, Table 7.3.3.1
//     egress width factors, assembly travel distance.
//
// It is the shared backbone of the Flow lens (occupant load seeds agent counts)
// and the Evidence lens (occupancy + exit-capacity + travel-distance checks).
//
// SAFE LANGUAGE — non-negotiable: every output here is an INDICATIVE PLANNING
// estimate under stated assumptions. It is NOT a code-compliance determination,
// a certified evacuation analysis, or a fire-risk assessment, and it does not
// substitute for a competent fire engineer / fire-risk assessor / authority
// having jurisdiction. See EGRESS_PLANNING_DISCLAIMER and egressEscalationFlags.
//
// Source note: the BS 9999 figures are deliberately NOT encoded here — the
// research used a 2008 copy and the current edition is BS 9999:2017; do not add
// "to BS 9999" outputs until verified against a licensed current copy.
// ---------------------------------------------------------------------------

export type EgressStandard = "uk-adb" | "nfpa-101";

const FT2_PER_M2 = 10.7639;

function safeArea(areaM2: number): number {
  return Number.isFinite(areaM2) && areaM2 > 0 ? areaM2 : 0;
}

function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// ---------------------------------------------------------------------------
// Occupant load — floor-space / occupant-load factors
// ---------------------------------------------------------------------------

/** ADB Appendix D floor-space factors, m² per person. Lower = denser use. */
export const ADB_FLOOR_SPACE_FACTORS_M2 = {
  /** Standing spectator / bar area within 2 m of the serving point. */
  "standing-bar": 0.3,
  /** Assembly hall, dance floor, pop concert, club, bar without fixed seating. */
  "assembly-dance": 0.5,
  /** Concourse or queuing area. */
  "concourse-queue": 0.7,
  /** Dining room, lounge, restaurant, meeting room, waiting room. */
  "dining-lounge-meeting": 1.0,
} as const;
export type AdbUseClass = keyof typeof ADB_FLOOR_SPACE_FACTORS_M2;

/** NFPA 101 Table 7.3.1.2 assembly occupant-load factors, net ft² per person. */
export const NFPA_OCCUPANT_LOAD_FACTORS_FT2 = {
  /** Concentrated use without fixed seating (dance floor, standing). */
  concentrated: 7,
  /** Less concentrated use without fixed seating (dining, exhibition). */
  "less-concentrated": 15,
} as const;
export type NfpaUseClass = keyof typeof NFPA_OCCUPANT_LOAD_FACTORS_FT2;

/** ADB occupant load = ceil(area ÷ floor-space factor). Use the MOST onerous
 *  applicable factor for mixed-use space. */
export function occupantLoadAdb(areaM2: number, useClass: AdbUseClass): number {
  const factor = ADB_FLOOR_SPACE_FACTORS_M2[useClass];
  return Math.ceil(safeArea(areaM2) / factor);
}

/** NFPA occupant load = ceil(net ft² ÷ load factor). Area given in m² and
 *  converted, since the planner works in metric. */
export function occupantLoadNfpa(areaM2: number, useClass: NfpaUseClass): number {
  const areaFt2 = safeArea(areaM2) * FT2_PER_M2;
  return Math.ceil(areaFt2 / NFPA_OCCUPANT_LOAD_FACTORS_FT2[useClass]);
}

// ---------------------------------------------------------------------------
// Required exit width
// ---------------------------------------------------------------------------

/** ADB horizontal-escape minimum exit width, mm, for a given occupant count.
 *  Stepped up to 220, then 5 mm/person. */
export function requiredExitWidthMmAdb(occupants: number): number {
  const n = safeCount(occupants);
  if (n === 0) return 0;
  if (n <= 60) return 750;
  if (n <= 110) return 850;
  if (n <= 220) return 1050;
  return n * 5;
}

/** NFPA 101 Table 7.3.3.1 egress-width-per-person ("all others"), mm. */
export const NFPA_WIDTH_PER_PERSON_MM = {
  /** Level components / ramps: 0.2 in/person. */
  level: 0.2 * 25.4,
  /** Stairs: 0.3 in/person. */
  stair: 0.3 * 25.4,
} as const;
export type EgressComponent = keyof typeof NFPA_WIDTH_PER_PERSON_MM;

/** NFPA required egress width, mm, for occupants over a level or stair component. */
export function requiredWidthMmNfpa(occupants: number, component: EgressComponent): number {
  return safeCount(occupants) * NFPA_WIDTH_PER_PERSON_MM[component];
}

// ---------------------------------------------------------------------------
// Minimum number of exits
// ---------------------------------------------------------------------------

/** ADB minimum number of escape routes from a room/storey by occupant count. */
export function minExitsAdb(occupants: number): number {
  const n = safeCount(occupants);
  if (n <= 60) return 1;
  if (n <= 600) return 2;
  return 3;
}

/** ADB: a single escape route from a place of assembly/bar is only acceptable
 *  up to 60 people. */
export function adbSingleRouteAcceptable(occupants: number): boolean {
  return safeCount(occupants) <= 60;
}

// ---------------------------------------------------------------------------
// Exit redundancy — capacity after losing one exit
// ---------------------------------------------------------------------------

export interface ExitRedundancyResult {
  /** Sum of all provided exit clear widths, mm. */
  readonly totalWidthMm: number;
  /** Width remaining after discounting the single largest exit, mm. */
  readonly effectiveWidthMm: number;
  /** The discounted (largest, governing) exit width, mm. */
  readonly governingExitMm: number;
  /** Required width for the occupant load under the chosen standard, mm. */
  readonly requiredWidthMm: number;
  /** True when the remaining exits still serve the occupant load. */
  readonly passes: boolean;
}

/**
 * ADB redundancy check: discount the single largest exit (it may be the one
 * blocked by fire) and verify the remaining exits still provide the required
 * width for the occupant load, and that the minimum number of exits is met.
 */
export function adbExitRedundancy(
  exitWidthsMm: readonly number[],
  occupants: number,
): ExitRedundancyResult {
  const widths = exitWidthsMm.filter((w) => Number.isFinite(w) && w > 0);
  const totalWidthMm = widths.reduce((sum, w) => sum + w, 0);
  const governingExitMm = widths.length > 0 ? Math.max(...widths) : 0;
  const effectiveWidthMm = totalWidthMm - governingExitMm;
  const requiredWidthMm = requiredExitWidthMmAdb(occupants);
  return {
    totalWidthMm,
    effectiveWidthMm,
    governingExitMm,
    requiredWidthMm,
    passes: effectiveWidthMm >= requiredWidthMm && widths.length >= minExitsAdb(occupants),
  };
}

/**
 * NFPA redundancy check: after the loss of any one means of egress, at least
 * 50% of the required capacity must remain available.
 */
export function nfpaExitRedundancy(
  exitWidthsMm: readonly number[],
  occupants: number,
  component: EgressComponent = "level",
): ExitRedundancyResult {
  const widths = exitWidthsMm.filter((w) => Number.isFinite(w) && w > 0);
  const totalWidthMm = widths.reduce((sum, w) => sum + w, 0);
  const governingExitMm = widths.length > 0 ? Math.max(...widths) : 0;
  const effectiveWidthMm = totalWidthMm - governingExitMm;
  const requiredWidthMm = requiredWidthMmNfpa(occupants, component);
  return {
    totalWidthMm,
    effectiveWidthMm,
    governingExitMm,
    requiredWidthMm,
    // ≥50% of required capacity must survive the loss of one exit.
    passes: effectiveWidthMm >= requiredWidthMm * 0.5 && widths.length >= 2,
  };
}

// ---------------------------------------------------------------------------
// Travel distance limits
// ---------------------------------------------------------------------------

/** ADB Table 2.1 travel-distance limits (m) for purpose group 5 (assembly). */
export const ADB_TRAVEL_LIMITS_M = {
  /** Areas with seating in rows. */
  "seated-rows": { oneWay: 15, moreThanOneDirection: 32 },
  /** Assembly / recreation elsewhere. */
  "assembly-other": { oneWay: 18, moreThanOneDirection: 45 },
  /** Buildings primarily for people with disabilities. */
  "disabled-priority": { oneWay: 9, moreThanOneDirection: 18 },
} as const;
export type AdbTravelClass = keyof typeof ADB_TRAVEL_LIMITS_M;

/** NFPA 101 new-assembly travel distance to an exit (m). */
export const NFPA_TRAVEL_LIMITS_M = {
  unsprinklered: 61, // 200 ft
  sprinklered: 76.2, // 250 ft
} as const;

export interface TravelDistanceCheck {
  readonly measuredM: number;
  readonly limitM: number;
  readonly passes: boolean;
}

/** Check a measured travel distance against the applicable ADB limit. */
export function travelDistanceCheckAdb(
  measuredM: number,
  travelClass: AdbTravelClass,
  oneWayOnly: boolean,
): TravelDistanceCheck {
  const limits = ADB_TRAVEL_LIMITS_M[travelClass];
  const limitM = oneWayOnly ? limits.oneWay : limits.moreThanOneDirection;
  return { measuredM, limitM, passes: measuredM <= limitM };
}

// ---------------------------------------------------------------------------
// Merging flow at a final exit (ADB)
// ---------------------------------------------------------------------------

/**
 * ADB merging-flow formula for a final exit shared by a storey exit and a
 * stair:  W = ((N / 2.5) + (60 · S)) / 80, metres. Implies a planning flow
 * basis of ~80 persons/min/m at the final exit.
 */
export function mergingFlowFinalExitWidthM(occupantsFromStorey: number, stairWidthM: number): number {
  const n = Math.max(0, occupantsFromStorey);
  const s = Math.max(0, stairWidthM);
  return ((n / 2.5) + (60 * s)) / 80;
}

/** Planning flow basis implied by the merging-flow formula: persons/min/m. */
export const PLANNING_FLOW_PERSONS_PER_MIN_PER_M = 80;

// ---------------------------------------------------------------------------
// Crowd density bands (persons/m²)
// ---------------------------------------------------------------------------

export type DensityBand = "free" | "channels" | "restricted" | "static" | "crush";

/**
 * Staff-facing crowd density descriptor (rough planning guide, not a standard):
 *   <2  free movement; ~2 channels forming; ~4 movement difficult without
 *   contact; ~5 essentially no movement; 7+ crowd distress / crushing risk.
 */
export function densityBand(personsPerM2: number): DensityBand {
  const p = Number.isFinite(personsPerM2) && personsPerM2 > 0 ? personsPerM2 : 0;
  if (p < 2) return "free";
  if (p < 4) return "channels";
  if (p < 5) return "restricted";
  if (p < 7) return "static";
  return "crush";
}

export function densityBandLabel(band: DensityBand): string {
  switch (band) {
    case "free": return "Free movement";
    case "channels": return "Channels forming — reduced free movement";
    case "restricted": return "Restricted — movement difficult without contact";
    case "static": return "Near-static — little ability to move";
    case "crush": return "Crowd-distress range — review urgently with the venue";
  }
}

// ---------------------------------------------------------------------------
// Planning-grade clearance time
// ---------------------------------------------------------------------------

export interface ClearanceTimeInput {
  /** Pre-movement / reaction delay before people start moving, seconds. */
  readonly preMovementSeconds: number;
  /** Longest travel path to an exit, metres. */
  readonly maxPathMetres: number;
  /** Assumed walking speed, m/s (≈1.2 m/s on the level for mixed crowds). */
  readonly walkingSpeedMs: number;
  /** People queued at the governing bottleneck. */
  readonly queueDemandPersons: number;
  /** Service rate at the governing bottleneck, persons/second. */
  readonly serviceRatePersonsPerSec: number;
}

/**
 * Indicative last-out time:  T ≈ pre-movement + travel(maxPath/speed) +
 * queueing(demand/serviceRate). Presented as an estimate under stated
 * assumptions — NEVER a certified evacuation time.
 */
export function clearanceTimeSeconds(input: ClearanceTimeInput): number {
  const pre = Math.max(0, input.preMovementSeconds);
  const speed = input.walkingSpeedMs > 0 ? input.walkingSpeedMs : 1.2;
  const travel = Math.max(0, input.maxPathMetres) / speed;
  const service = input.serviceRatePersonsPerSec > 0 ? input.serviceRatePersonsPerSec : Infinity;
  const queue = Math.max(0, input.queueDemandPersons) / service;
  return pre + travel + (Number.isFinite(queue) ? queue : 0);
}

/** Derive a per-exit service rate (persons/sec) for an exit of given width
 *  from the planning flow basis (≈80 persons/min/m). */
export function exitServiceRatePersonsPerSec(exitWidthMm: number): number {
  const widthM = Math.max(0, exitWidthMm) / 1000;
  return (PLANNING_FLOW_PERSONS_PER_MIN_PER_M * widthM) / 60;
}

// ---------------------------------------------------------------------------
// Claim safety — escalation to professional review
// ---------------------------------------------------------------------------

export interface EscalationContext {
  /** Layout / assumptions deviate from the standard prescriptive geometry. */
  readonly nonStandardAssumptions: boolean;
  /** Evacuation relies on staff management/intervention. */
  readonly staffManagedEvacuation: boolean;
  /** Mobility-impaired occupants are expected. */
  readonly mobilityImpairedOccupants: boolean;
  /** Modeled peak density, persons/m². */
  readonly peakDensityPersonsPerM2: number;
  /** Result is being used to support a formal occupancy/licensing decision. */
  readonly feedsFormalOccupancyDecision: boolean;
}

/**
 * Reasons a competent fire professional + the authority having jurisdiction
 * must review before any reliance. An empty array does NOT mean "compliant" —
 * the planning disclaimer always applies.
 */
export function egressEscalationFlags(ctx: EscalationContext): readonly string[] {
  const flags: string[] = [];
  if (ctx.feedsFormalOccupancyDecision) {
    flags.push("Feeding a formal occupancy or licensing decision — requires a competent fire professional and the authority having jurisdiction.");
  }
  if (ctx.nonStandardAssumptions) {
    flags.push("Layout or assumptions deviate from standard prescriptive geometry — fire-safety engineering review may be the only valid route.");
  }
  if (ctx.staffManagedEvacuation) {
    flags.push("Relies on staff-managed evacuation — adequacy of management arrangements must be assessed by a competent person.");
  }
  if (ctx.mobilityImpairedOccupants) {
    flags.push("Mobility-impaired occupants expected — assisted-evacuation provision must be assessed by a competent person.");
  }
  if (densityBand(ctx.peakDensityPersonsPerM2) === "crush") {
    flags.push("Modeled peak density is in the crowd-distress range — review urgently with the venue's safety team.");
  }
  return flags;
}

/** Standard disclaimer for any surface that shows egress output. */
export const EGRESS_PLANNING_DISCLAIMER =
  "Indicative planning output based on user-supplied geometry, assumed occupancy, and model assumptions. "
  + "Not a code-compliance determination, certified evacuation analysis, or fire-risk assessment. Final "
  + "occupancy limits and means-of-escape adequacy must be confirmed by the venue's competent fire "
  + "professional and the relevant authority.";

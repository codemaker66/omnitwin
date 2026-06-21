// ---------------------------------------------------------------------------
// Photometrics — planning-grade event lighting coverage math.
//
// NOTE: distinct from lighting.ts, which configures the 3D SCENE render
// (hemisphere light, baked lightmap). This module is the EVENT LIGHTING-DESIGN
// domain: "can this fixture cover that area from this trim height, and at what
// illuminance?" — the calc heart of the future Lighting lens (Epic 6).
//
// Formulas are the standard planning approximations event designers use
// (inverse-square + cosine + beam geometry). They are NOT a substitute for full
// photometric calculation: real beam shape, field angle, lens artefacts, mixing
// quality, and asymmetry still matter.
//
// SAFE LANGUAGE: illuminance presets are EDITABLE planning targets tagged by
// provenance (formal standard vs camera guideline vs event heuristic) — never
// certified thresholds. See PHOTOMETRIC_PLANNING_DISCLAIMER.
// ---------------------------------------------------------------------------

const DEG2RAD = Math.PI / 180;

function deg2rad(deg: number): number {
  return deg * DEG2RAD;
}

function rad2deg(rad: number): number {
  return rad / DEG2RAD;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Slant distance fixture→target. Throw must be the slant distance, not the
 *  vertical trim, because illuminance falls with the true distance and a tilted
 *  fixture covers a point further than its drop height. */
export function slantDistanceM(fixture: Vec3, target: Vec3): number {
  const dx = fixture.x - target.x;
  const dy = fixture.y - target.y;
  const dz = fixture.z - target.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---------------------------------------------------------------------------
// Illuminance (inverse-square + cosine)
// ---------------------------------------------------------------------------

/** Illuminance on a target facing the fixture: E = I / d². */
export function luxAtDistance(candela: number, distanceM: number): number {
  const d = Math.max(0, distanceM);
  if (d === 0) return 0;
  return Math.max(0, candela) / (d * d);
}

/** Illuminance on a plane at an incidence angle from the surface normal:
 *  E = (I / d²) · cos(incidence). Grazing angles (large incidence) lose lux
 *  fast — see isGrazingIncidence. */
export function luxAtDistanceAndAngle(
  candela: number,
  distanceM: number,
  incidenceAngleDeg: number,
): number {
  const base = luxAtDistance(candela, distanceM);
  const cos = Math.cos(deg2rad(Math.abs(incidenceAngleDeg)));
  return base * Math.max(0, cos);
}

// ---------------------------------------------------------------------------
// Beam geometry
// ---------------------------------------------------------------------------

/** Beam footprint diameter on a perpendicular target plane:
 *  Ø = 2 · d · tan(beamAngle / 2). */
export function beamFootprintDiameterM(distanceM: number, beamAngleDeg: number): number {
  const d = Math.max(0, distanceM);
  const half = deg2rad(Math.max(0, beamAngleDeg) / 2);
  return 2 * d * Math.tan(half);
}

/** Beam angle needed to light a target footprint from a given distance:
 *  θ = 2 · atan(footprint / (2 · d)). Inverse of beamFootprintDiameterM. */
export function requiredBeamAngleDeg(footprintM: number, distanceM: number): number {
  const d = Math.max(0, distanceM);
  if (d === 0) return 0;
  return rad2deg(2 * Math.atan(Math.max(0, footprintM) / (2 * d)));
}

/** Incidence beyond this (from the surface normal) reads as a grazing wash —
 *  the planner should warn that a zone is only covered at a shallow angle. */
export const GRAZING_INCIDENCE_THRESHOLD_DEG = 60;

export function isGrazingIncidence(incidenceAngleDeg: number): boolean {
  return Math.abs(incidenceAngleDeg) >= GRAZING_INCIDENCE_THRESHOLD_DEG;
}

// ---------------------------------------------------------------------------
// Fixture taxonomy
// ---------------------------------------------------------------------------

/**
 * Beam-quality / product family. Mobility (fixed vs moving-head) and deployment
 * role (e.g. uplighter) are modelled separately, because users mix those
 * concepts in speech ("moving-head wash", "PAR uplighter").
 */
export const LIGHTING_FIXTURE_FAMILIES = [
  "profile", // ellipsoidal: hard edge, shutters, gobos — keys, specials
  "spot", // hard-edged round beam, gobo/effects
  "wash", // broad soft-edged field
  "fresnel", // soft-edged variable zoom
  "par", // punchy beam / colour / architectural
  "beam-hybrid", // tight high-intensity effects / hybrid beam-spot-wash
  "batten-strip", // linear wash / cyc / pixel bar
  "blinder-strobe", // burst / audience wash
] as const;
export type LightingFixtureFamily = (typeof LIGHTING_FIXTURE_FAMILIES)[number];

/** Where a fixture is deployed, independent of family. */
export const LIGHTING_DEPLOYMENT_ROLES = ["rigged", "floor", "uplighter", "boom", "truss-warmer"] as const;
export type LightingDeploymentRole = (typeof LIGHTING_DEPLOYMENT_ROLES)[number];

// ---------------------------------------------------------------------------
// Zone illuminance presets (editable, provenance-tagged)
// ---------------------------------------------------------------------------

/** Whether the target plane is horizontal (table/floor) or vertical (faces). */
export type IlluminancePlane = "horizontal" | "vertical";

/** Where the number comes from — drives how strongly it can be stated. */
export type IlluminanceBasis = "standard" | "camera-guideline" | "event-heuristic";

export interface IlluminancePreset {
  readonly intent: string;
  readonly minLux: number;
  readonly maxLux: number;
  readonly plane: IlluminancePlane;
  readonly basis: IlluminanceBasis;
  readonly note: string;
}

/** Editable planning presets — NOT certified targets. Provenance is explicit so
 *  the UI can show "formal standard" vs "camera guideline" vs "heuristic". */
export const ILLUMINANCE_PRESETS = {
  "fine-dining": { intent: "fine-dining", minLux: 10, maxLux: 30, plane: "horizontal", basis: "event-heuristic", note: "Low table illuminance for intimate dining (IES hospitality-derived band)." },
  "banquet-service": { intent: "banquet-service", minLux: 50, maxLux: 100, plane: "horizontal", basis: "event-heuristic", note: "Higher table illuminance for service/banquet (IES hospitality-derived band)." },
  "ambient-ballroom": { intent: "ambient-ballroom", minLux: 100, maxLux: 300, plane: "horizontal", basis: "standard", note: "Meeting/conference ambient ~300 lx (CIBSE-style); dim below for mood." },
  "lectern-faces": { intent: "lectern-faces", minLux: 300, maxLux: 500, plane: "vertical", basis: "camera-guideline", note: "Vertical on faces for presenters/press conference (UEFA-style 450-500 lx)." },
  "stage-imag": { intent: "stage-imag", minLux: 300, maxLux: 500, plane: "vertical", basis: "camera-guideline", note: "Camera/IMAG-facing stage; broadcaster spec may require more." },
  "dance-social": { intent: "dance-social", minLux: 50, maxLux: 80, plane: "horizontal", basis: "event-heuristic", note: "Social dance-floor heuristic - not a formal standard." },
  "video-conference": { intent: "video-conference", minLux: 300, maxLux: 500, plane: "vertical", basis: "camera-guideline", note: "Faces for video work, soft modelling preferred over harsh downlight." },
} as const satisfies Record<string, IlluminancePreset>;
export type IlluminanceIntent = keyof typeof ILLUMINANCE_PRESETS;

export type IlluminanceAssessment = "below" | "within" | "above";

/** Compare a planned illuminance to a preset's band. */
export function assessIlluminance(measuredLux: number, preset: IlluminancePreset): IlluminanceAssessment {
  if (measuredLux < preset.minLux) return "below";
  if (measuredLux > preset.maxLux) return "above";
  return "within";
}

/** Human-readable provenance qualifier so copy never over-states a heuristic. */
export function illuminanceBasisLabel(basis: IlluminanceBasis): string {
  switch (basis) {
    case "standard": return "formal lighting standard";
    case "camera-guideline": return "camera/broadcast guideline";
    case "event-heuristic": return "event-practice heuristic (not a standard)";
  }
}

/** Standard disclaimer for any surface that shows photometric output. */
export const PHOTOMETRIC_PLANNING_DISCLAIMER =
  "Indicative coverage and illuminance estimates from planning approximations (inverse-square + cosine). "
  + "Real beam shape, colour mixing, and surface response vary. Illuminance presets are editable planning "
  + "targets, not certified levels; final looks depend on on-site focus and measurement.";

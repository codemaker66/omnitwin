// ---------------------------------------------------------------------------
// The modes a set-down rings, and how long each foot strikes (T-677).
//
// Every resonant part of a piece, and every surface under it, is a set of
// modes: a frequency, a 60 dB decay time and a gain. A part's frequencies come
// from its size and material: a frame is free-free Euler-Bernoulli beams, a
// top or panel a dense bank of plate modes. Its decays come from the
// material's as-built loss factor, which rises with frequency, because that is
// how material is heard (Klatzky, Pai and Krotkov 2000). A foot's contact time
// is Hertz's for a hard cap and a spring's for a soft one. Every number not
// cited here is from section 4 of the research notes
// (D:/claude/furniture-sound-20261027/research/acoustic-data.md).
//
// A piece keeps its own modes from play to play: where each mode sits is
// seeded by the part itself, and the per-play `random` only moves each one by
// up to 1.5 % in frequency and 2 dB in gain.
// ---------------------------------------------------------------------------

import { dbToGain, seededRandom } from "../planner-sound-render.js";
import type { BodyPart, FootCap, PartKind } from "./bodies.js";
import type { ModeBank, SurfaceKind, SurfaceResponse } from "./surfaces.js";

export interface Mode {
  readonly hz: number;
  /** Seconds to fall 60 dB. */
  readonly t60: number;
  /**
   * Struck by a unit impulse, the mode's velocity, and so the sound it
   * radiates, rings as gain x cos(2 pi f t), decaying: every mode of a struck
   * body starts moving at once, in phase near the struck point, which is the
   * click of the impact.
   */
  readonly gain: number;
}

/**
 * As-built loss factors (research 4.1: glued joints, welds and feet, not the
 * intrinsic material): eta(f) = eta x (1 + viscous x f / 1000), so every
 * material's high modes die faster, viscoelastic ones fastest.
 */
export const LOSS: Readonly<Record<PartKind, { readonly eta: number; readonly viscous: number }>> = {
  "beech-frame": { eta: 0.03, viscous: 0.6 },
  "ply-top": { eta: 0.035, viscous: 0.5 },
  "mdf-top": { eta: 0.04, viscous: 0.5 },
  "steel-tube-frame": { eta: 0.006, viscous: 0.1 },
  "aluminium-frame": { eta: 0.005, viscous: 0.1 },
  "phenolic-deck": { eta: 0.03, viscous: 0.4 },
  "cast-base": { eta: 0.012, viscous: 0.2 },
  "cabinet-carcass": { eta: 0.035, viscous: 0.5 },
  "av-plastic": { eta: 0.05, viscous: 0.8 },
  "av-glass": { eta: 0.004, viscous: 0.1 },
  upholstery: { eta: 0.25, viscous: 1.0 },
};

/** The loss factor of `kind` at `hz`. */
export function lossFactor(kind: PartKind, hz: number): number {
  const { eta, viscous } = LOSS[kind];
  return eta * (1 + (viscous * hz) / 1000);
}

/** Seconds to fall 60 dB at loss factor `eta`: amplitude falls as exp(-pi f eta t), so T60 = ln(1000) / (pi f eta), about 2.2 / (f eta). */
export function decaySeconds(hz: number, eta: number): number {
  return 2.2 / (hz * eta);
}

/** The energy a struck mode rings out: the integral of (g e^(-t ln1000 / T60) cos)^2, which is g^2 T60 / (4 ln 1000). */
export function modeEnergy(gain: number, t60: number): number {
  return (gain * gain * t60) / (4 * Math.log(1000));
}

// --- Variation from play to play ------------------------------------------------

const FREQUENCY_SPREAD = 0.015;
const GAIN_SPREAD_DB = 2;

function jitterHz(hz: number, random: () => number): number {
  return hz * (1 + FREQUENCY_SPREAD * (2 * random() - 1));
}

function jitterGain(gain: number, random: () => number): number {
  return gain * dbToGain(GAIN_SPREAD_DB * (2 * random() - 1));
}

/** A fixed seed from a description (FNV-1a), so a part's or a bank's mode layout is its own and never the play's. */
function structureRandom(description: string): () => number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < description.length; i += 1) {
    hash ^= description.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return seededRandom(hash >>> 0);
}

/** `count` frequencies spread log-uniformly over [low, high], one in each equal step of log frequency, seeded. */
function logSpread(low: number, high: number, count: number, structure: () => number): number[] {
  const ratio = high / low;
  return Array.from({ length: count }, (_, i) => low * ratio ** ((i + structure()) / count));
}

// --- Parts ---------------------------------------------------------------------

/** Nothing rings above this: a set-down's energy may reach about 12 kHz (spec 7). */
export const MODE_CEILING_HZ = 12000;
/** No part mode below this: the floor's heave is the surface's, not the piece's. */
const MODE_FLOOR_HZ = 40;

type Shape = "square-beam" | "tube" | "round-bar" | "plate";

/**
 * Each part kind's longitudinal wave speed sqrt(E / rho) in m/s and how it
 * vibrates. Plate speeds for ply, MDF and chipboard are those that give the
 * research's modal densities (0.071, 0.087 and 0.067 modes/Hz for a 1.83 m top).
 */
const MATERIAL: Readonly<Record<PartKind, { readonly waveSpeed: number; readonly shape: Shape }>> = {
  "beech-frame": { waveSpeed: 4170, shape: "square-beam" }, // E 12.5 GPa, rho 720 (research 4.1)
  "steel-tube-frame": { waveSpeed: 5170, shape: "tube" }, // E 210 GPa, rho 7850
  "cast-base": { waveSpeed: 3910, shape: "round-bar" }, // grey iron, E 110 GPa, rho 7200
  // A deck's or a laptop's aluminium is thin-walled: its thickness is a wall's, so it rings as a shell.
  "aluminium-frame": { waveSpeed: 5090, shape: "plate" }, // E 70 GPa, rho 2700
  "ply-top": { waveSpeed: 3560, shape: "plate" },
  "mdf-top": { waveSpeed: 2000, shape: "plate" }, // E 3 GPa, rho 750
  "phenolic-deck": { waveSpeed: 3560, shape: "plate" }, // birch ply under a phenolic film
  "cabinet-carcass": { waveSpeed: 2270, shape: "plate" }, // chipboard
  "av-plastic": { waveSpeed: 1400, shape: "plate" }, // ABS, E 2.1 GPa, rho 1050
  "av-glass": { waveSpeed: 5300, shape: "plate" }, // E 70 GPa, rho 2500
  upholstery: { waveSpeed: 1000, shape: "plate" }, // a seat board under foam (EST)
};

/** (beta_1 L)^2 / 2 pi for a free-free beam: f1 = 3.561 r c / L^2, r the section's radius of gyration. */
const FREE_FREE_FIRST = 4.73004 ** 2 / (2 * Math.PI);
/** A free-free beam's modes as multiples of its first: (beta_n L / beta_1 L)^2. */
const FREE_FREE_RATIOS = [1, 2.7565, 5.4039, 8.9330, 13.3443, 18.6379] as const;
/**
 * A frame is several members, legs, rails and stretchers: the part's length is
 * its longest, and the others are these fractions of it (EST), so a frame
 * rings as a cluster of beams rather than one bar.
 */
const FRAME_MEMBERS = [1, 0.8, 0.62] as const;

/** The section's radius of gyration over its thickness: h / root 12 for a square, about a third for a thin tube (1.5 mm in 25), d / 4 for a bar. */
const GYRATION: Readonly<Record<Exclude<Shape, "plate">, number>> = {
  "square-beam": 1 / Math.sqrt(12),
  tube: 0.333,
  "round-bar": 0.25,
};

/** A free plate's lowest mode is about h c / L^2 (research 4.1: about 15 Hz for a 1.83 m, 25 mm MDF top). */
const PLATE_FIRST = 1;
const PLATE_LOW_HZ = 60;
const PLATE_MODES_PER_OCTAVE = 4;
const PLATE_MIN_MODES = 4;
const PLATE_MAX_MODES = 24;
/** A mode whose loss factor reaches 0.5 (a Q of 2) no longer rings, so a plate's bank stops below it. */
const MAX_RINGING_ETA = 0.5;
const SPEED_OF_SOUND_M_PER_S = 343;

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Where a beam part's modes sit (unvaried): each member's free-free modes below the ceiling. */
function beamFrequencies(part: BodyPart, shape: Exclude<Shape, "plate">, waveSpeed: number): number[] {
  const length = finitePositive(part.lengthM, 0.5);
  const thickness = finitePositive(part.thicknessM, 0.02);
  const members = shape === "round-bar" ? [1] : FRAME_MEMBERS;
  const out: number[] = [];
  for (const member of members) {
    const span = length * member;
    const first = (FREE_FREE_FIRST * GYRATION[shape] * thickness * waveSpeed) / (span * span);
    for (const ratio of FREE_FREE_RATIOS) {
      const hz = first * ratio;
      if (hz >= MODE_FLOOR_HZ && hz <= MODE_CEILING_HZ) out.push(hz);
    }
  }
  return out;
}

/** The highest frequency a part still rings at: where its loss factor reaches MAX_RINGING_ETA, or the ceiling. */
function ringingLimitHz(kind: PartKind): number {
  const { eta, viscous } = LOSS[kind];
  if (eta >= MAX_RINGING_ETA) return MODE_FLOOR_HZ;
  if (viscous <= 0) return MODE_CEILING_HZ;
  return Math.min(MODE_CEILING_HZ, ((MAX_RINGING_ETA / eta - 1) * 1000) / viscous);
}

/**
 * Where a plate part's modes sit (unvaried). A real plate's modes are evenly
 * spaced in hertz, hundreds of them; a few per octave stand in for them, each
 * carrying its octave's share, so the bank is cheap and its spectrum right.
 */
function plateFrequencies(part: BodyPart, waveSpeed: number, structure: () => number): number[] {
  const length = finitePositive(part.lengthM, 0.5);
  const thickness = finitePositive(part.thicknessM, 0.02);
  const first = (PLATE_FIRST * thickness * waveSpeed) / (length * length);
  const low = Math.min(MODE_CEILING_HZ, Math.max(PLATE_LOW_HZ, first));
  const high = Math.max(low, ringingLimitHz(part.kind));
  if (high <= low * 1.01) return [low];
  const octaves = Math.log2(high / low);
  const count = Math.min(PLATE_MAX_MODES, Math.max(PLATE_MIN_MODES, Math.round(octaves * PLATE_MODES_PER_OCTAVE)));
  return logSpread(low, high, count, structure);
}

/**
 * The gain shape across a part's modes, before its share is applied. A beam's
 * modes are struck equally (each has an antinode at the foot), but a slender
 * member is a compact radiator, far smaller than the wavelength, whose
 * efficiency rises with frequency: its amplitude is taken to rise as f until
 * ka = 1 (a the member's half-thickness), where it stops being compact. So a
 * thin tube barely sounds its lowest bending modes, as research 4.1 notes of
 * free rails. A plate's stand-in mode carries a band as wide as its frequency,
 * so its amplitude grows as root f; below coincidence a plate also radiates
 * less, by root (f / f_c), with f_c = c^2 / (1.8 c_L h).
 */
function shapeGain(part: BodyPart, hz: number): number {
  const { waveSpeed, shape } = MATERIAL[part.kind];
  const thickness = finitePositive(part.thicknessM, 0.02);
  if (shape !== "plate") return Math.min(hz, SPEED_OF_SOUND_M_PER_S / (Math.PI * thickness)) / 1000;
  const coincidence = SPEED_OF_SOUND_M_PER_S ** 2 / (1.8 * waveSpeed * thickness);
  return Math.sqrt(hz / 1000) * Math.sqrt(Math.min(1, hz / coincidence));
}

/**
 * The modes of one part. Unvaried, their energies (modeEnergy) sum to the
 * part's share, so the parts of a body ring out its whole energy between them
 * in the proportions it states. Each play then moves every mode by up to
 * 1.5 % and its gain by up to 2 dB, and the decay follows the moved frequency.
 */
export function partModes(part: BodyPart, random: () => number): readonly Mode[] {
  const { waveSpeed, shape } = MATERIAL[part.kind];
  const structure = structureRandom([part.kind, part.lengthM, part.thicknessM].join("|"));
  let nominal = shape === "plate" ? plateFrequencies(part, waveSpeed, structure) : beamFrequencies(part, shape, waveSpeed);
  // A part scaled far from its size still rings: at its first mode, held inside the audible band.
  if (nominal.length === 0) {
    const length = finitePositive(part.lengthM, 0.5);
    const first = (PLATE_FIRST * finitePositive(part.thicknessM, 0.02) * waveSpeed) / (length * length);
    nominal = [Math.min(MODE_CEILING_HZ, Math.max(MODE_FLOOR_HZ * 2, first))];
  }
  let energy = 0;
  for (const hz of nominal) energy += modeEnergy(shapeGain(part, hz), decaySeconds(hz, lossFactor(part.kind, hz)));
  const share = Number.isFinite(part.share) && part.share > 0 ? part.share : 0;
  const scale = energy > 0 ? Math.sqrt(share / energy) : 0;
  return nominal.map((centre) => {
    const hz = jitterHz(centre, random);
    return { hz, t60: decaySeconds(hz, lossFactor(part.kind, hz)), gain: jitterGain(shapeGain(part, centre) * scale, random) };
  });
}

// --- Surfaces --------------------------------------------------------------------

/** The joists' thump sits this far below the board bank's level, in dB (EST): felt as weight, never heard as a boom. */
export const THUMP_BELOW_BOARDS_DB = -26;

function bankModes(bank: ModeBank, description: string, random: () => number, into: Mode[]): void {
  const count = Math.max(1, Math.round(bank.count));
  const structure = structureRandom([description, bank.lowHz, bank.highHz, count, bank.eta].join("|"));
  // The bank's level is its modes' summed power, so a denser bank is no louder.
  const each = dbToGain(bank.gainDb) / Math.sqrt(count);
  for (const centre of logSpread(bank.lowHz, bank.highHz, count, structure)) {
    const hz = jitterHz(centre, random);
    into.push({ hz, t60: decaySeconds(hz, bank.eta), gain: jitterGain(each, random) });
  }
}

/**
 * The modes of a surface, as resolved for its room: its boards (or panel, or
 * deck), the hollow under a deck, the floor heard beneath a carpet or a dance
 * floor, and the joists' low thump. Gains are levels relative to the surface's
 * own boards at 0 dB; the renderer sets how loud the surface is against the
 * piece. A damping ratio zeta is a loss factor of 2 zeta.
 */
export function surfaceModes(surface: SurfaceResponse, random: () => number): readonly Mode[] {
  const modes: Mode[] = [];
  if (surface.boards !== null) bankModes(surface.boards, `${surface.kind}|boards`, random, modes);
  if (surface.cavity !== null) bankModes(surface.cavity, `${surface.kind}|cavity`, random, modes);
  if (surface.beneath !== null) bankModes(surface.beneath, `${surface.kind}|beneath`, random, modes);
  if (surface.thump !== null) {
    const hz = jitterHz(surface.thump.hz, random);
    modes.push({ hz, t60: decaySeconds(hz, 2 * surface.thump.zeta), gain: jitterGain(dbToGain(THUMP_BELOW_BOARDS_DB), random) });
  }
  return modes;
}

// --- Contact -----------------------------------------------------------------------

/** Hertz's sphere-on-flat contact time: t = 2.87 (m^2 / (R E*^2 v))^(1/5). */
const HERTZ_CONSTANT = 2.87;
const CAP_RADIUS_M = 0.01;
/** A rubber foot (20 mm, 5 mm thick, E 6 MPa) is a spring of 1.1 MN/m: t = pi root(m / k). */
const RUBBER_STIFFNESS_N_PER_M = 1.1e6;
const FELT_SECONDS = 0.012;
/** Any foot sinks into carpet pile for about 45 ms (40 on an underlay, 55 without). */
const CARPET_SECONDS = 0.045;

type HardCap = Exclude<FootCap, "rubber" | "felt" | "castor">;

/** The elastic modulus of each hard cap, Pa: a nylon glide, a steel foot, a deck's or plinth's edge (EST). */
const CAP_MODULUS_PA: Readonly<Record<HardCap, number>> = {
  glide: 3e9,
  steel: 2.1e11,
  "panel-edge": 1e10,
};

/**
 * The modulus of each surface a hard cap meets, Pa: oak and parquet across the
 * grain 1.5 GPa, timber on a slab 11 GPa (research 4.2); the panels and tops,
 * which the research does not give, at their hardness times oak's (EST).
 * Carpet's is the floor its pile bottoms out on.
 */
const SURFACE_MODULUS_PA: Readonly<Record<SurfaceKind, number>> = {
  "oak-boards-joists": 1.5e9,
  "oak-parquet": 1.5e9,
  "timber-on-slab": 1.1e10,
  carpet: 1.5e9,
  "stage-deck": 0.9 * 1.5e9,
  "dance-floor": 1.5e9,
  "table-top": 0.8 * 1.5e9,
};

/** Whether a cap strikes as a hard elastic contact (Hertz), rather than a spring or a pad. */
export function isHardCap(cap: FootCap): cap is HardCap {
  return cap === "glide" || cap === "steel" || cap === "panel-edge";
}

const MIN_MASS_KG = 0.01;
const MAX_MASS_KG = 1000;
const MIN_SPEED_M_PER_S = 0.01;
const MAX_SPEED_M_PER_S = 20;

const held = (value: number, low: number, high: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.min(high, Math.max(low, value)) : fallback;

/**
 * How long one foot presses into its surface, in seconds. A hard cap (a glide,
 * a steel foot, a panel's edge) is Hertz's elastic contact with R = 10 mm and
 * the reduced modulus 1 / (1 / E_cap + 1 / E_surface); a rubber foot or castor
 * tyre is a spring of 1.1 MN/m; felt is 12 ms; and on carpet every foot sinks
 * for 45 ms. `massPerFootKg` is the mass the foot stops; a mass or speed that is
 * not a positive number is taken as 1 kg or 1 m/s, and both are held to sane
 * ranges, so the time is always a positive number.
 */
export function contactSeconds(cap: FootCap, surface: SurfaceResponse, massPerFootKg: number, speed: number): number {
  const mass = held(massPerFootKg, MIN_MASS_KG, MAX_MASS_KG, 1);
  const velocity = held(speed, MIN_SPEED_M_PER_S, MAX_SPEED_M_PER_S, 1);
  if (surface.kind === "carpet") return CARPET_SECONDS;
  if (cap === "felt") return FELT_SECONDS;
  if (!isHardCap(cap)) return Math.PI * Math.sqrt(mass / RUBBER_STIFFNESS_N_PER_M);
  const reduced = 1 / (1 / CAP_MODULUS_PA[cap] + 1 / SURFACE_MODULUS_PA[surface.kind]);
  return HERTZ_CONSTANT * ((mass * mass) / (CAP_RADIUS_M * reduced * reduced * velocity)) ** 0.2;
}

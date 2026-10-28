// ---------------------------------------------------------------------------
// The modal set-down renderer (T-677): one piece landing on the surface under
// each of its feet, heard from where the listener stands, in plain arithmetic.
//
// Each foot strikes its surface with a force pulse, 1 - cos over its contact
// time (FoleyAutomatic's profile; van den Doel, Kry and Pai 2001), carrying
// the share of the piece's momentum that foot stops. The pulses drive every
// mode of the piece's parts and the modes of the surface under the foot, and
// the struck spot itself sounds the force, the click of a hard contact. Each
// mode is a two-pole resonator in its velocity form, a band-pass, because a
// mode radiates as it moves: a slow push (a foot sinking into carpet) moves
// nothing that sounds, and a sharp strike sets every mode moving at once.
// Hard caps on legs chatter in a few micro-collisions, a foot on carpet bottoms
// out onto the floor beneath, castors roll on and folding legs rattle; an
// upholstered seat puffs and a cloth's hem brushes the floor.
//
// The dry sound passes a gentle ceiling (a -3 dB shelf above 4 kHz and a
// 12-pole low-pass at 14 kHz), is set to its level, panned at equal power and
// joined by its early reflections. The late tail is the room's (tail.ts).
// What is rendered here is what plays: the registry plays these samples.
// ---------------------------------------------------------------------------

import { PLANNER_TOUCH_DB } from "../planner-sound-recipes.js";
import { biquadCoefficients, dbToGain, gainToDb, seededRandom } from "../planner-sound-render.js";
import type { BodyPart, Foot, PartKind, SetDownBody } from "./bodies.js";
import { contactSeconds, decaySeconds, isHardCap, modeEnergy, partModes, surfaceModes } from "./modes.js";
import type { Reflection } from "./reflections.js";
import { SURFACES, type SurfaceKind, type SurfaceResponse } from "./surfaces.js";
import type { Stereo } from "./tail.js";

/**
 * The peak, in dBFS, of a Chiavari dropped on the Grand Hall's oak at 1 m/s,
 * heard centred at full direct gain: the palette's touch level, so a palette
 * rebalance moves the set-downs with it.
 */
export const SET_DOWN_TOUCH_DB = PLANNER_TOUCH_DB;

export interface SetDownInput {
  readonly body: SetDownBody;
  /** The surface under each foot, in the order of `body.feet`, each resolved for its room (surfaceResponse). */
  readonly surfaces: readonly SurfaceResponse[];
  /** Impact speed in m/s; about 1 for the planner's drop. */
  readonly speed: number;
  /** A drop from the hand, or a moved piece settling onto its feet (a quarter of the speed, no chatter). */
  readonly kind: "drop" | "settle";
  /** A floor-length cloth, whose hem brushes the floor as the table lands. */
  readonly clothed: boolean;
  /** The direct sound's amplitude and its lateral angle (lateralAzimuth: its sine is the share to the right). */
  readonly direct: { readonly gain: number; readonly azimuthRad: number };
  /** Early reflections, relative to the direct sound (earlyReflections). */
  readonly reflections: readonly Reflection[];
  readonly seed: number;
  readonly sampleRate: number;
}

export interface SetDownRender extends Stereo {
  /** The render's true peak over both channels, dBFS. */
  readonly peakDb: number;
}

// --- Level ---------------------------------------------------------------------

const PEAK_FLOOR_DB = -32;
const PEAK_CEILING_DB = -16;
const REFERENCE_MASS_KG = 4;

// --- Each play -------------------------------------------------------------------

const SPEED_SPREAD = 0.15;
const SETTLE_SPEED = 0.25;

// --- Feet --------------------------------------------------------------------------

/** Pieces over this land tighter. */
const HEAVY_KG = 15;
const LIGHT_SPREAD_S = [0.005, 0.035] as const;
const HEAVY_SPREAD_S = [0.003, 0.015] as const;
/**
 * A piece is rarely set down level: one foot, sometimes two, touches first and
 * takes a light share of the landing as the piece rocks onto the rest (EST).
 */
const FIRST_SHARE = [0.14, 0.2] as const;
const PAIR_CHANCE = 0.35;
/** The second of a first pair touches within this fraction of the spread. */
const PAIR_SPREAD = 0.3;
/** The rest land together, within this fraction of the spread's span above its minimum. */
const REST_WINDOW = 0.01;
/** The rest share their part of the landing unevenly, by up to this. */
const REST_SHARE_SPREAD = 0.1;

// --- Contact details -----------------------------------------------------------------

const MICRO_COUNT = [2, 5] as const;
const MICRO_WINDOW_S = 0.015;
/**
 * A hard cap on a leg chatters as it settles, like a ball coming to rest: the
 * first rebound strikes 1.5-6 ms after the landing's contact ends, and each
 * gap after it is 50-75 % of the one before (EST), so the burst closes up
 * within the 15 ms and its strongest knocks sit under the landing itself.
 */
const MICRO_FIRST_GAP_S = [0.0015, 0.006] as const;
const MICRO_GAP_SHRINK = [0.5, 0.75] as const;
/** Each micro-collision carries 6-12 dB less momentum than the one before, the first than its foot's landing (impulses, as FoleyAutomatic's are). */
const MICRO_FALL_DB = [6, 12] as const;
/**
 * A micro-collision is the leg's own small mass chattering on its cap: Hertz
 * at this fraction of the foot's mass (EST), 40 % of the landing's contact,
 * so each is a sharp knock of under a millisecond for a chair.
 */
const MICRO_MASS_FRACTION = 0.1;
/** Under every foot the pile is as deep, so the feet bottom out this long after landing, give or take BOTTOM_JITTER_S each. */
const BOTTOM_DELAY_S = [0.03, 0.04] as const;
const BOTTOM_JITTER_S = 0.001;
const BOTTOM_DB = -14;
/** A foot bottoms out through carpet with this fraction of its speed left (EST). */
const BOTTOM_SPEED = 0.2;
/**
 * Bottomed out, the foot still presses through the crushed pile and backing,
 * a pad of about 0.3 MN/m (3 cm2 at 4 mm and 4 MPa, EST): the pulse is
 * pi root(m / k) at the least, so carpet's knock stays muffled.
 */
const PILE_STIFFNESS_N_PER_M = 0.3e6;
const ROLL_GAP_S = 0.025;
/** The castors roll on this long after the last foot lands (EST), with two bumps at these levels against a foot's landing. */
const ROLL_START_S = [0.015, 0.03] as const;
const ROLL_DB = [-12, -18] as const;
const RATTLE_COUNT = [2, 4] as const;
const RATTLE_WINDOW_S = 0.06;
const RATTLE_AFTER_S = 0.004;
const RATTLE_HZ = [1200, 3000] as const;
const RATTLE_DB = -18;
const RATTLE_TICK_S = 0.004;
const RATTLE_Q = 3;
const PUFF_S = 0.04;
const PUFF_HZ = 600;
const PUFF_DB = -24;
const HEM_S = 0.09;
const HEM_LOW_HZ = 2000;
const HEM_HIGH_HZ = 6000;
const HEM_DB = -30;

/** The parts whose joints rattle, and so the parts a rattle rings. */
const FRAME_KINDS: ReadonlySet<PartKind> = new Set<PartKind>(["beech-frame", "steel-tube-frame", "aluminium-frame", "cast-base"]);

// --- Piece against surface ---------------------------------------------------------------

/**
 * How much energy the struck spot radiates against the piece's own modes, per
 * hertz of the surface's bank, for a foot stopping 1 kg (EST). The surface
 * takes the foot's momentum, so it sounds harder under a heavier piece: the
 * ratio grows as the root of the mass each foot stops. Research 4.1: a chair
 * is heard mostly through the floor and its seat.
 */
const STRUCK_BALANCE = 1.2;
/**
 * Feet sunk in a soft surface damp every mode of the piece, which all move at
 * the feet: an added loss factor of this times how soft the surface is
 * (1 - hardness), so carpet damps a frame hard and oak not at all (EST).
 */
const SOFT_CONTACT_ETA = 0.1;
/**
 * A plate struck at a point radiates straight from the struck spot, a power
 * that follows the force and not the modes (Cremer and Heckl: below
 * coincidence it is rho0 F^2 / (2 pi c0 m''^2) at every frequency), much the
 * same for any timber surface. What its modes radiate turns on how well they
 * radiate (sigma): per hertz the struck spot is
 * 4 omega eta root(B m'') / (pi c0^2 sigma m'') times the modes. A hall-sized
 * floor's modes radiate poorly below coincidence (sigma about 0.003 for the
 * Grand Hall's 22 mm oak at 200 Hz, about 0.01 for a smaller room), so its
 * struck spot outsounds them several times over: the floor is heard as the
 * knock of the force itself and its boards ringing under it. A deck, a
 * dance-floor panel or a table top is small and light, and its modes (and a
 * deck's hollow) radiate well (sigma 0.2 to 0.5), so its struck spot is a few
 * per cent of them (0.02 for an 18 mm phenolic deck at 150 Hz): a deck
 * booms. These ratios are EST from those formulas; the struck spot sets the
 * level and each surface's modes follow from it. The direct sound is the
 * click of a hard contact and nothing at all of a slow one; it is taken from
 * the bottom of the surface's bank up (below it the floor moves as a whole)
 * and scaled by the surface's hardness.
 */
const STRUCK_OVER_MODES: Readonly<Record<SurfaceKind, number>> = {
  "oak-boards-joists": 4,
  "oak-parquet": 4,
  "timber-on-slab": 4,
  carpet: 4,
  "stage-deck": 0.1,
  "dance-floor": 0.4,
  "table-top": 0.4,
};
/** Where the direct sound starts on a surface with no bank of its own. */
const DIRECT_FALLBACK_HZ = 150;

// --- Rendering -----------------------------------------------------------------------------

/** Surface modes below this are the floor's own heave: rendered on their own, and never reflected (below the room's Schroeder frequency). */
const HEAVE_BELOW_HZ = 40;
/**
 * The heave is felt as one slow swell under the landing, faded out by
 * HEAVE_MAX_S (EST), so it never outlives the boards: left to ring (its own
 * decay is seconds), its zero crossings every 36 ms would cut deep gaps in
 * the tail that read as new contacts.
 */
const HEAVE_MAX_S = 0.06;
const HEAVE_FADE_S = 0.05;
const BODY_MAX_S = 1;
const BODY_FADE_S = 0.05;
/** A mode rings until it is this far below the loudest. */
const LIFE_FLOOR_DB = 70;
/** A reflection this close behind the direct sound is the floor under a source standing on it: its level joins the direct (ruling R16). */
const FOLD_BELOW_S = 0.001;
/** The lowest 4 kHz / 1 kHz ratio a one-pole low-pass is asked to hold (its slope gives no less than about 0.25 over two octaves). */
const MIN_REFLECTION_RATIO = 0.3;
const SHELF_HZ = 4000;
const SHELF_DB = -3;
const CEILING_HZ = 14000;
const CEILING_ORDER = 12;
const LN_1000 = Math.log(1000);
/** Every force ends this many samples before the drive does, so the resonators leave the drive in free decay. */
const DRIVE_TAIL = 3;

const lerp = (range: readonly [number, number], u: number): number => range[0] + (range[1] - range[0]) * u;
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

// --- Sanitising the input ---------------------------------------------------------------

const FALLBACK_SURFACE: SurfaceResponse = SURFACES["timber-on-slab"];
const FALLBACK_FOOT: Foot = { x: 0, z: 0, cap: "rubber" };
const FALLBACK_PART: BodyPart = { kind: "cabinet-carcass", lengthM: 0.5, thicknessM: 0.02, share: 1 };
const OAK = SURFACES["oak-boards-joists"];

interface Piece {
  readonly massKg: number;
  readonly feet: readonly Foot[];
  readonly parts: readonly BodyPart[];
  readonly body: SetDownBody;
}

/** The body held to numbers that render: a positive mass, at least one foot and one part, and shares that sum to 1. */
function pieceOf(body: SetDownBody): Piece {
  const massKg = Number.isFinite(body.massKg) && body.massKg > 0 ? clamp(body.massKg, 0.05, 500) : REFERENCE_MASS_KG;
  const feet = body.feet.length > 0 ? body.feet : [FALLBACK_FOOT];
  const sounding = body.parts.filter((part) => Number.isFinite(part.share) && part.share > 0);
  const parts = sounding.length > 0 ? sounding : [FALLBACK_PART];
  const total = parts.reduce((sum, part) => sum + part.share, 0);
  return { massKg, feet, parts: parts.map((part) => ({ ...part, share: part.share / total })), body };
}

function saneRate(sampleRate: number): number {
  return Number.isFinite(sampleRate) && sampleRate >= 8000 && sampleRate <= 384000 ? sampleRate : 48000;
}

function saneSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? clamp(speed, 0.02, 10) : 1;
}

// --- The landing ---------------------------------------------------------------------

interface Landing {
  readonly foot: number;
  readonly time: number;
  readonly share: number;
}

/**
 * When each foot lands and what share of the piece's momentum it stops: one
 * foot (or two) touches lightly first, and the rest land together at the end
 * of the spread, over 5-35 ms for light pieces and 3-15 ms for heavy ones.
 */
function scheduleFeet(count: number, massKg: number, random: () => number): Landing[] {
  if (count <= 1) return [{ foot: 0, time: 0, share: 1 }];
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i] ?? i;
    order[i] = order[j] ?? j;
    order[j] = swap;
  }
  const range = massKg > HEAVY_KG ? HEAVY_SPREAD_S : LIGHT_SPREAD_S;
  const spread = lerp(range, random());
  const first = count >= 4 && random() < PAIR_CHANCE ? 2 : 1;
  const firstShare = lerp(FIRST_SHARE, random());
  const landings: Landing[] = [];
  for (let i = 0; i < first; i += 1) {
    landings.push({ foot: order[i] ?? i, time: i === 0 ? 0 : random() * PAIR_SPREAD * spread, share: firstShare / first });
  }
  const weights = Array.from({ length: count - first }, () => 1 + REST_SHARE_SPREAD * (2 * random() - 1));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  weights.forEach((weight, k) => {
    const time = spread - REST_WINDOW * (spread - range[0]) * random();
    landings.push({ foot: order[first + k] ?? first + k, time, share: ((1 - firstShare) * weight) / weightSum });
  });
  return landings;
}

interface Pulse {
  readonly group: number;
  readonly start: number;
  readonly duration: number;
  readonly impulse: number;
}

interface Group {
  readonly surface: SurfaceResponse;
  readonly feet: number;
}

/** The feet grouped by the surface under them: each surface rings only from its own feet. */
function groupFeet(feet: readonly Foot[], surfaces: readonly SurfaceResponse[]): { readonly groups: Group[]; readonly of: number[] } {
  const index = new Map<SurfaceResponse, number>();
  const counts: number[] = [];
  const list: SurfaceResponse[] = [];
  const of = feet.map((_, i) => {
    const surface = surfaces[i] ?? surfaces[0] ?? FALLBACK_SURFACE;
    let g = index.get(surface);
    if (g === undefined) {
      g = list.length;
      index.set(surface, g);
      list.push(surface);
      counts.push(0);
    }
    counts[g] = (counts[g] ?? 0) + 1;
    return g;
  });
  return { groups: list.map((surface, g) => ({ surface, feet: counts[g] ?? 0 })), of };
}

/**
 * Whether a cap chatters on landing: a hard cap on a leg (a glide, a steel
 * foot). A panel's edge or a plinth has no leg to chatter, and a piece that
 * heavy does not rebound at a set-down's speed.
 */
function chatters(cap: Foot["cap"]): boolean {
  return isHardCap(cap) && cap !== "panel-edge";
}

/** Every force pulse of the landing: the feet, their chatter, carpet's bottoming out and the castors' roll. */
function landingPulses(
  piece: Piece,
  landings: readonly Landing[],
  groupOf: readonly number[],
  groups: readonly Group[],
  speed: number,
  kind: SetDownInput["kind"],
  random: () => number,
): Pulse[] {
  const pulses: Pulse[] = [];
  const bottomDelay = lerp(BOTTOM_DELAY_S, random());
  for (const landing of landings) {
    const foot = piece.feet[landing.foot] ?? FALLBACK_FOOT;
    const group = groupOf[landing.foot] ?? 0;
    const surface = groups[group]?.surface ?? FALLBACK_SURFACE;
    const mass = landing.share * piece.massKg;
    const impulse = mass * speed;
    const duration = contactSeconds(foot.cap, surface, mass, speed);
    pulses.push({ group, start: landing.time, duration, impulse });
    if (surface.kind === "carpet") {
      // The pile gives way and the foot bottoms out onto the floor beneath, through what is left of the pile.
      const through = Math.PI * Math.sqrt(mass / PILE_STIFFNESS_N_PER_M);
      pulses.push({
        group,
        start: landing.time + bottomDelay + BOTTOM_JITTER_S * (2 * random() - 1),
        duration: Math.max(through, contactSeconds(foot.cap, OAK, mass, speed * BOTTOM_SPEED)),
        impulse: impulse * dbToGain(BOTTOM_DB),
      });
    } else if (kind === "drop" && chatters(foot.cap)) {
      const count = MICRO_COUNT[0] + Math.floor(random() * (MICRO_COUNT[1] - MICRO_COUNT[0] + 1));
      const micro = contactSeconds(foot.cap, surface, mass * MICRO_MASS_FRACTION, speed);
      let momentum = impulse * Math.min(1, surface.hardness);
      let gap = lerp(MICRO_FIRST_GAP_S, random());
      let start = landing.time + duration + gap;
      for (let k = 0; k < count && start <= landing.time + MICRO_WINDOW_S; k += 1) {
        momentum *= dbToGain(-lerp(MICRO_FALL_DB, random()));
        pulses.push({ group, start, duration: micro, impulse: momentum });
        gap *= lerp(MICRO_GAP_SHRINK, random());
        start += gap;
      }
    }
  }
  if (piece.body.castorRoll) {
    const last = Math.max(...landings.map((landing) => landing.time));
    const start = last + lerp(ROLL_START_S, random());
    const footMass = piece.massKg / piece.feet.length;
    groups.forEach((group, g) => {
      const weight = group.feet / piece.feet.length;
      ROLL_DB.forEach((db, bump) => {
        pulses.push({
          group: g,
          start: start + bump * ROLL_GAP_S,
          duration: contactSeconds("castor", group.surface, footMass, speed),
          impulse: footMass * speed * weight * dbToGain(db),
        });
      });
    });
  }
  return pulses;
}

/** Folding legs knocking in their joints after the landing: short noise ticks at 1.2-3 kHz, written into `force`. */
function addRattle(force: Float64Array, landings: readonly Landing[], sampleRate: number, random: () => number): void {
  const last = Math.max(...landings.map((landing) => landing.time));
  const count = RATTLE_COUNT[0] + Math.floor(random() * (RATTLE_COUNT[1] - RATTLE_COUNT[0] + 1));
  const earliest = last + RATTLE_AFTER_S;
  const length = Math.max(4, Math.round(RATTLE_TICK_S * sampleRate));
  const attack = Math.max(1, Math.round(0.0003 * sampleRate));
  const fall = 0.0007 * sampleRate;
  const tick = new Float64Array(length);
  for (let k = 0; k < count; k += 1) {
    const start = Math.round((earliest + random() * Math.max(0, RATTLE_WINDOW_S - earliest)) * sampleRate);
    for (let i = 0; i < length; i += 1) tick[i] = 2 * random() - 1;
    filterInPlace(tick, length, biquadCoefficients("bandpass", lerp(RATTLE_HZ, random()), RATTLE_Q, sampleRate));
    for (let i = 0; i < length && start + i < force.length - DRIVE_TAIL; i += 1) {
      const envelope = i < attack ? i / attack : Math.exp(-(i - attack) / fall);
      force[start + i] = (force[start + i] ?? 0) + (tick[i] ?? 0) * envelope;
    }
  }
}

/** The end of the rattle's ticks, in samples, for sizing the drive. */
function rattleEnd(sampleRate: number): number {
  return Math.round((RATTLE_WINDOW_S + RATTLE_TICK_S) * sampleRate);
}

/** Adds one 1 - cos pulse, its area the pulse's impulse, into `force`. */
function addPulse(force: Float64Array, pulse: Pulse, sampleRate: number): void {
  const start = Math.round(pulse.start * sampleRate);
  const length = Math.max(2, Math.round(pulse.duration * sampleRate));
  const step = (2 * Math.PI) / length;
  const height = pulse.impulse / length;
  for (let i = 0; i < length && start + i < force.length; i += 1) {
    force[start + i] = (force[start + i] ?? 0) + height * (1 - Math.cos(step * (i + 0.5)));
  }
}

// --- Filters ---------------------------------------------------------------------------

interface Biquad {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

function filterInPlace(x: Float64Array, length: number, c: Biquad): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < length; i += 1) {
    const x0 = x[i] ?? 0;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
}

/** An RBJ high-pass biquad, normalised by a0. */
function highpassCoefficients(hz: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(hz, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/**
 * The first-order high shelf of the ceiling: unity below, SHELF_DB above, its
 * transition centred on SHELF_HZ: H(s) = (G s + root G) / (s + root G) at
 * unit corner, through the bilinear transform warped to the corner.
 */
function shelfInPlace(x: Float64Array, length: number, sampleRate: number): void {
  const g = dbToGain(SHELF_DB);
  const root = Math.sqrt(g);
  const c = 1 / Math.tan((Math.PI * Math.min(SHELF_HZ, sampleRate * 0.45)) / sampleRate);
  const a0 = root + c;
  const b0 = (root + g * c) / a0;
  const b1 = (root - g * c) / a0;
  const a1 = (root - c) / a0;
  let x1 = 0, y1 = 0;
  for (let i = 0; i < length; i += 1) {
    const x0 = x[i] ?? 0;
    const y0 = b0 * x0 + b1 * x1 - a1 * y1;
    x1 = x0; y1 = y0;
    x[i] = y0;
  }
}

/** The Qs of an even-order Butterworth low-pass's biquads. */
const CEILING_QS: readonly number[] = Array.from({ length: CEILING_ORDER / 2 }, (_, k) => 1 / (2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * CEILING_ORDER))));

function ceilingInPlace(x: Float64Array, length: number, sampleRate: number): void {
  shelfInPlace(x, length, sampleRate);
  for (const q of CEILING_QS) filterInPlace(x, length, biquadCoefficients("lowpass", CEILING_HZ, q, sampleRate));
}

function peakOf(x: Float64Array, length: number): number {
  let peak = 0;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(x[i] ?? 0));
  return peak;
}

function scalePeakTo(x: Float64Array, length: number, peak: number): void {
  const current = peakOf(x, length);
  const scale = current > 0 ? peak / current : 0;
  for (let i = 0; i < length; i += 1) x[i] = (x[i] ?? 0) * scale;
}

// --- Modes ------------------------------------------------------------------------------

type Layer = "body" | "heave" | "rattle";

interface Voice {
  readonly hz: number;
  readonly t60: number;
  readonly gain: number;
  /** The force driving it: the sum of each source scaled by its weight. */
  readonly sources: readonly Float64Array[];
  readonly weights: readonly number[];
  /** Where it sounds: the body, the floor's heave (never reflected), or the rattle (set to its own level). */
  readonly layer: Layer;
}

/** A second-order low-pass's magnitude at `hz`: how much of a pulse a soft surface lets reach a mode. */
function cutAt(hz: number, cutHz: number): number {
  return 1 / Math.sqrt(1 + (hz / cutHz) ** 4);
}

/** The energy oak boards ring out at their unit level, the yardstick of the surface's level. */
const OAK_UNIT_ENERGY = ((): number => {
  const boards = OAK.boards;
  if (boards === null) return 1;
  let sum = 0;
  for (let i = 0; i < boards.count; i += 1) {
    const hz = boards.lowHz * (boards.highHz / boards.lowHz) ** ((i + 0.5) / boards.count);
    sum += modeEnergy(1 / Math.sqrt(boards.count), decaySeconds(hz, boards.eta));
  }
  return sum;
})();

interface Rung {
  /** Its last two outputs, to carry on from. */
  readonly y1: number;
  readonly y2: number;
  readonly a1: number;
  readonly a2: number;
  readonly r: number;
  /** Its envelope when the drive ends. */
  readonly amplitude: number;
}

/**
 * Rings one voice through the drive into `out`, as a mode's velocity:
 * y[n] = 2r cos(w) y[n-1] - r^2 y[n-2] + (g / 2)(x[n] - x[n-2]), a band-pass
 * whose impulse response is very nearly g r^n cos(w n).
 */
function driveVoice(voice: Voice, out: Float64Array, drive: number, scratch: Float64Array, sampleRate: number): Rung {
  const w = (2 * Math.PI * voice.hz) / sampleRate;
  const r = Math.exp(-LN_1000 / (voice.t60 * sampleRate));
  const a1 = 2 * r * Math.cos(w);
  const a2 = -r * r;
  const b = voice.gain / 2;
  let force: Float64Array;
  const only = voice.sources[0];
  if (voice.sources.length === 1 && only !== undefined && voice.weights[0] === 1) {
    force = only;
  } else {
    scratch.fill(0, 0, drive);
    voice.sources.forEach((source, k) => {
      const weight = voice.weights[k] ?? 0;
      for (let n = 0; n < drive; n += 1) scratch[n] = (scratch[n] ?? 0) + weight * (source[n] ?? 0);
    });
    force = scratch;
  }
  let y1 = 0, y2 = 0, x1 = 0, x2 = 0;
  for (let n = 0; n < drive; n += 1) {
    const x0 = force[n] ?? 0;
    const y0 = a1 * y1 + a2 * y2 + b * (x0 - x2);
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
    out[n] = (out[n] ?? 0) + y0;
  }
  // The envelope from the last two samples of a decaying sinusoid: A^2 = y1^2 + ((y1 cos w - r y2) / sin w)^2.
  const sin = Math.sin(w);
  const quadrature = sin > 1e-9 ? (y1 * Math.cos(w) - r * y2) / sin : 0;
  return { y1, y2, a1, a2, r, amplitude: Math.hypot(y1, quadrature) };
}

/** Carries a voice's free decay on from `from` for `count` samples. */
function ringOn(rung: Rung, out: Float64Array, from: number, count: number): void {
  let y1 = rung.y1, y2 = rung.y2;
  const { a1, a2 } = rung;
  const end = Math.min(out.length, from + count);
  for (let n = from; n < end; n += 1) {
    const y0 = a1 * y1 + a2 * y2;
    y2 = y1; y1 = y0;
    out[n] = (out[n] ?? 0) + y0;
  }
}

function fadeOut(x: Float64Array, end: number, samples: number): void {
  const start = Math.max(0, end - samples);
  for (let n = start; n < end; n += 1) {
    const t = (n - start) / Math.max(1, end - start);
    x[n] = (x[n] ?? 0) * 0.5 * (1 + Math.cos(Math.PI * t));
  }
}

interface Layered {
  readonly out: Float64Array;
  end: number;
  cut: boolean;
}

/**
 * Rings every voice through the drive, then on until it is LIFE_FLOOR_DB
 * under the loudest voice of its own layer, each layer held to its buffer
 * (a voice still ringing at the end is faded out with it).
 */
function ringVoices(voices: readonly Voice[], layers: Readonly<Record<Layer, Layered>>, drive: number, sampleRate: number): void {
  const scratch = new Float64Array(drive);
  const rungs = voices.map((voice) => driveVoice(voice, layers[voice.layer].out, drive, scratch, sampleRate));
  const loudest: Record<Layer, number> = { body: 0, heave: 0, rattle: 0 };
  rungs.forEach((rung, v) => {
    const layer = voices[v]?.layer ?? "body";
    loudest[layer] = Math.max(loudest[layer], rung.amplitude);
  });
  rungs.forEach((rung, v) => {
    const layer = layers[voices[v]?.layer ?? "body"];
    const floor = loudest[voices[v]?.layer ?? "body"] * dbToGain(-LIFE_FLOOR_DB);
    if (rung.amplitude <= floor || rung.r <= 0) return;
    const wanted = Math.ceil(Math.log(floor / rung.amplitude) / Math.log(rung.r));
    const room = layer.out.length - drive;
    const count = Math.min(wanted, room);
    ringOn(rung, layer.out, drive, count);
    layer.end = Math.max(layer.end, drive + count);
    if (wanted > room) layer.cut = true;
  });
}

// --- Air ------------------------------------------------------------------------------------

/** Adds `sound` (scaled to `peak`) into `out` from `start`, returning where it ends. */
function mixIn(out: Float64Array, sound: Float64Array, start: number, peak: number): number {
  scalePeakTo(sound, sound.length, peak);
  for (let i = 0; i < sound.length && start + i < out.length; i += 1) out[start + i] = (out[start + i] ?? 0) + (sound[i] ?? 0);
  return Math.min(out.length, start + sound.length);
}

/** An upholstered seat sighing as it takes the landing: brown noise, 40 ms, low-passed at 600 Hz. */
function puff(sampleRate: number, random: () => number): Float64Array {
  const length = Math.round(PUFF_S * sampleRate);
  const out = new Float64Array(length);
  let brown = 0;
  for (let i = 0; i < length; i += 1) {
    brown = (brown + 0.02 * (2 * random() - 1)) / 1.02;
    out[i] = brown;
  }
  filterInPlace(out, length, biquadCoefficients("lowpass", PUFF_HZ, Math.SQRT1_2, sampleRate));
  // A sigh, not a thump: the slow drift of the brown noise is taken out with a gentle high-pass.
  filterInPlace(out, length, highpassCoefficients(60, Math.SQRT1_2, sampleRate));
  const attack = Math.max(1, Math.round(0.003 * sampleRate));
  for (let i = 0; i < length; i += 1) {
    const envelope = i < attack ? i / attack : dbToGain((-40 * (i - attack)) / Math.max(1, length - attack));
    out[i] = (out[i] ?? 0) * envelope;
  }
  return out;
}

/** A floor-length cloth's hem brushing the floor: pink noise, 90 ms, band-passed at 2-6 kHz. */
function hem(sampleRate: number, random: () => number): Float64Array {
  const length = Math.round(HEM_S * sampleRate);
  const out = new Float64Array(length);
  // Paul Kellet's economy pink filter.
  let p0 = 0, p1 = 0, p2 = 0;
  for (let i = 0; i < length; i += 1) {
    const white = 2 * random() - 1;
    p0 = 0.99765 * p0 + white * 0.099046;
    p1 = 0.963 * p1 + white * 0.2965164;
    p2 = 0.57 * p2 + white * 1.0526913;
    out[i] = p0 + p1 + p2 + white * 0.1848;
  }
  filterInPlace(out, length, highpassCoefficients(HEM_LOW_HZ, Math.SQRT1_2, sampleRate));
  filterInPlace(out, length, biquadCoefficients("lowpass", HEM_HIGH_HZ, Math.SQRT1_2, sampleRate));
  const rise = Math.round(0.02 * sampleRate);
  const release = Math.round(0.04 * sampleRate);
  for (let i = 0; i < length; i += 1) {
    const inRise = i < rise ? Math.sin((Math.PI / 2) * (i / rise)) ** 2 : 1;
    const toEnd = length - i;
    const inRelease = toEnd < release ? Math.sin((Math.PI / 2) * (toEnd / release)) ** 2 : 1;
    out[i] = (out[i] ?? 0) * inRise * inRelease;
  }
  return out;
}

// --- Space ------------------------------------------------------------------------------------

/**
 * Equal-power gains for a lateral angle: the share to the right is sin(az),
 * and the law is normalised to unity in each channel at the centre, so a
 * centred sound at full gain peaks at its level; left squared plus right
 * squared is 2 at every angle.
 */
function panGains(azimuthRad: number): readonly [number, number] {
  const side = Number.isFinite(azimuthRad) ? clamp(Math.sin(azimuthRad), -1, 1) : 0;
  const angle = ((side + 1) * Math.PI) / 4;
  return [Math.SQRT2 * Math.cos(angle), Math.SQRT2 * Math.sin(angle)];
}

/** The pole a of the one-pole low-pass y = (1 - a) x + a y[-1] whose 4 kHz gain is `ratio` times its 1 kHz gain. */
function onePolePole(ratio: number, sampleRate: number): number {
  if (!(ratio < 0.999) || sampleRate < 9000) return 0;
  const r2 = Math.max(MIN_REFLECTION_RATIO, ratio) ** 2;
  const c1 = Math.cos((2 * Math.PI * 1000) / sampleRate);
  const c4 = Math.cos((2 * Math.PI * 4000) / sampleRate);
  // (r2 - 1) a^2 + 2 (c1 - r2 c4) a + (r2 - 1) = 0: its roots are a pair, a and 1 / a.
  const a = r2 - 1;
  const b = 2 * (c1 - r2 * c4);
  const discriminant = b * b - 4 * a * a;
  if (discriminant < 0) return 0;
  const root = Math.sqrt(discriminant);
  for (const pole of [(-b + root) / (2 * a), (-b - root) / (2 * a)]) {
    if (pole >= 0 && pole < 1) return pole;
  }
  return 0;
}

function onePoleGain(pole: number, hz: number, sampleRate: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  return (1 - pole) / Math.sqrt(1 - 2 * pole * Math.cos(w) + pole * pole);
}

// --- The render ---------------------------------------------------------------------------------

/** The level a set-down peaks at: the touch level, plus 3 log10(m / 4 kg) and 10 log10(v / 1 m/s), held to -32..-16 dBFS. */
function targetPeakDb(massKg: number, speed: number): number {
  return clamp(SET_DOWN_TOUCH_DB + 3 * Math.log10(massKg / REFERENCE_MASS_KG) + 10 * Math.log10(speed), PEAK_FLOOR_DB, PEAK_CEILING_DB);
}

/**
 * Renders one set-down. The same input renders the same samples; the seed
 * varies the play within the real spread (speed +-15 %, which feet land first
 * and when, each mode +-1.5 % in frequency and +-2 dB in gain). Nothing in it
 * throws, and every body, even an empty one, is heard.
 *
 * Centred at full direct gain with no reflections, the render peaks at
 * SET_DOWN_TOUCH_DB + 3 log10(m / 4) + 10 log10(v), held to -32..-16 dBFS,
 * where v is the set-down's own speed (a quarter of it for a settle): the
 * play's +-15 % spread shapes its contacts, not its level.
 * The direct gain scales it, a reflection under 1 ms (the floor beneath a
 * piece standing on it) adds its 1 kHz gain to the direct level, and the pan
 * keeps the power the same at every angle.
 */
export function renderSetDown(input: SetDownInput): SetDownRender {
  const sampleRate = saneRate(input.sampleRate);
  const random = seededRandom(input.seed);
  const piece = pieceOf(input.body);
  // The set-down's own speed sets its level; the play's spread of it shapes only its contacts.
  const nominal = saneSpeed(input.speed) * (input.kind === "settle" ? SETTLE_SPEED : 1);
  const speed = nominal * (1 + SPEED_SPREAD * (2 * random() - 1));

  const landings = scheduleFeet(piece.feet.length, piece.massKg, random);
  const { groups, of: groupOf } = groupFeet(piece.feet, input.surfaces);
  const pulses = landingPulses(piece, landings, groupOf, groups, speed, input.kind, random);

  // The drive: each surface's force, and the rattle's.
  let drive = 0;
  for (const pulse of pulses) drive = Math.max(drive, Math.round(pulse.start * sampleRate) + Math.round(pulse.duration * sampleRate));
  if (piece.body.legRattle) drive = Math.max(drive, rattleEnd(sampleRate));
  drive += DRIVE_TAIL;
  const forces = groups.map(() => new Float64Array(drive));
  for (const pulse of pulses) {
    const force = forces[pulse.group];
    if (force !== undefined) addPulse(force, pulse, sampleRate);
  }
  const rattle = piece.body.legRattle ? new Float64Array(drive) : null;
  if (rattle !== null) addRattle(rattle, landings, sampleRate, random);

  // The voices: the piece's parts, driven by every foot (and its frames by the rattle), and each surface's modes, driven by its own feet.
  const nyquistGuard = sampleRate * 0.45;
  const voices: Voice[] = [];
  const frames = piece.parts.some((part) => FRAME_KINDS.has(part.kind));
  const softness = groups.reduce((sum, group) => sum + group.feet * Math.max(0, 1 - group.surface.hardness), 0) / piece.feet.length;
  const contactEta = SOFT_CONTACT_ETA * softness;
  for (const part of piece.parts) {
    const rattled = rattle !== null && (FRAME_KINDS.has(part.kind) || !frames);
    for (const mode of partModes(part, random)) {
      if (mode.hz >= nyquistGuard) continue;
      const t60 = contactEta > 0 ? 1 / (1 / mode.t60 + 1 / decaySeconds(mode.hz, contactEta)) : mode.t60;
      const weights = groups.map((group) => cutAt(mode.hz, group.surface.highCutHz));
      voices.push({ hz: mode.hz, t60, gain: mode.gain, sources: forces, weights, layer: "body" });
      if (rattled) voices.push({ hz: mode.hz, t60, gain: mode.gain, sources: [rattle], weights: [1], layer: "rattle" });
    }
  }
  const footMass = piece.massKg / piece.feet.length;
  // The struck spot's power per hertz against the piece's: each surface's modes follow from it.
  const struck = STRUCK_BALANCE * Math.sqrt(footMass);
  groups.forEach((group, g) => {
    const force = forces[g];
    if (force === undefined) return;
    const surfaceLevel = Math.sqrt(struck / STRUCK_OVER_MODES[group.surface.kind] / OAK_UNIT_ENERGY);
    // A soft covering damps the floor it lies on, as it damps the piece.
    const covering = SOFT_CONTACT_ETA * Math.max(0, 1 - group.surface.hardness);
    for (const mode of surfaceModes(group.surface, random)) {
      if (mode.hz >= nyquistGuard) continue;
      voices.push({
        hz: mode.hz,
        t60: covering > 0 ? 1 / (1 / mode.t60 + 1 / decaySeconds(mode.hz, covering)) : mode.t60,
        gain: mode.gain * surfaceLevel,
        sources: [force],
        weights: [cutAt(mode.hz, group.surface.highCutHz)],
        layer: mode.hz < HEAVE_BELOW_HZ ? "heave" : "body",
      });
    }
  });

  const bodyLength = drive + Math.round(BODY_MAX_S * sampleRate);
  const layers: Record<Layer, Layered> = {
    body: { out: new Float64Array(bodyLength), end: drive, cut: false },
    heave: { out: new Float64Array(voices.some((v) => v.layer === "heave") ? Math.max(drive, Math.round(HEAVE_MAX_S * sampleRate)) : 0), end: 0, cut: false },
    rattle: { out: new Float64Array(rattle !== null ? bodyLength : 0), end: rattle !== null ? drive : 0, cut: false },
  };
  ringVoices(voices, layers, drive, sampleRate);
  const { body, heave } = layers;

  // The struck spot's own sound, straight from each surface's force.
  const settleSamples = Math.round(0.01 * sampleRate);
  groups.forEach((group, g) => {
    const force = forces[g];
    const bank = group.surface.boards ?? group.surface.beneath;
    const band = bank === null ? 150 : bank.highHz - bank.lowHz;
    const k = clamp(group.surface.hardness, 0, 1) * Math.sqrt(struck / (2 * band)) * sampleRate;
    if (force === undefined || k <= 0) return;
    const direct = new Float64Array(Math.min(body.out.length, drive + settleSamples));
    direct.set(force.subarray(0, Math.min(force.length, direct.length)));
    const from = group.surface.boards?.lowHz ?? group.surface.beneath?.lowHz ?? DIRECT_FALLBACK_HZ;
    filterInPlace(direct, direct.length, highpassCoefficients(from, Math.SQRT1_2, sampleRate));
    for (let n = 0; n < direct.length; n += 1) body.out[n] = (body.out[n] ?? 0) + k * (direct[n] ?? 0);
    body.end = Math.max(body.end, direct.length);
  });
  if (body.cut) fadeOut(body.out, body.end, Math.round(BODY_FADE_S * sampleRate));
  // The heave is one slow swell: it always fades out by HEAVE_MAX_S.
  if (heave.end > 0) {
    heave.end = heave.out.length;
    fadeOut(heave.out, heave.end, Math.round(HEAVE_FADE_S * sampleRate));
  }

  // The rattle, the seat's puff and the cloth's hem, each set against the landing's own peak.
  const modalPeak = peakOf(body.out, body.end);
  const rattleLayer = layers.rattle;
  if (rattleLayer.end > 0) {
    if (rattleLayer.cut) fadeOut(rattleLayer.out, rattleLayer.end, Math.round(BODY_FADE_S * sampleRate));
    const rattlePeak = peakOf(rattleLayer.out, rattleLayer.end);
    const scale = rattlePeak > 0 ? (modalPeak * dbToGain(RATTLE_DB)) / rattlePeak : 0;
    for (let n = 0; n < rattleLayer.end; n += 1) body.out[n] = (body.out[n] ?? 0) + scale * (rattleLayer.out[n] ?? 0);
    body.end = Math.max(body.end, rattleLayer.end);
  }
  const lastLanding = Math.max(...landings.map((landing) => landing.time));
  if (piece.body.seatPuff) body.end = Math.max(body.end, mixIn(body.out, puff(sampleRate, random), Math.round(lastLanding * sampleRate), modalPeak * dbToGain(PUFF_DB)));
  if (input.clothed) body.end = Math.max(body.end, mixIn(body.out, hem(sampleRate, random), 0, modalPeak * dbToGain(HEM_DB)));

  ceilingInPlace(body.out, body.end, sampleRate);

  // The level: the dry sound and the heave together peak at the target.
  const dry = body.out;
  const swell = heave.out;
  const sourceEnd = Math.max(body.end, heave.end);
  let sourcePeak = 0;
  for (let n = 0; n < sourceEnd; n += 1) sourcePeak = Math.max(sourcePeak, Math.abs((dry[n] ?? 0) + (swell[n] ?? 0)));
  const level = sourcePeak > 0 ? dbToGain(targetPeakDb(piece.massKg, nominal)) / sourcePeak : 0;

  // The space: the direct sound (with any reflection under 1 ms folded in) and each later reflection.
  const directGain = Number.isFinite(input.direct.gain) ? Math.max(0, input.direct.gain) : 1;
  let folded = 1;
  const later: Reflection[] = [];
  for (const reflection of input.reflections) {
    const delay = reflection.delaySeconds;
    const gain = reflection.gain[3];
    if (!Number.isFinite(delay) || delay < 0 || !Number.isFinite(gain) || gain <= 0) continue;
    if (delay < FOLD_BELOW_S) folded += gain;
    else later.push(reflection);
  }
  // Reflections copy the dry sound only while it is within LIFE_FLOOR_DB of its peak.
  let audible = 0;
  const audibleFloor = sourcePeak * dbToGain(-LIFE_FLOOR_DB);
  for (let n = body.end - 1; n >= 0; n -= 1) {
    if (Math.abs(dry[n] ?? 0) > audibleFloor) {
      audible = n + 1;
      break;
    }
  }
  let length = sourceEnd;
  for (const reflection of later) length = Math.max(length, Math.round(reflection.delaySeconds * sampleRate) + audible);
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  const [directLeft, directRight] = panGains(input.direct.azimuthRad);
  const direct = level * directGain * folded;
  for (let n = 0; n < sourceEnd; n += 1) {
    const sample = direct * ((dry[n] ?? 0) + (swell[n] ?? 0));
    left[n] = directLeft * sample;
    right[n] = directRight * sample;
  }

  const copies = new Map<number, Float64Array>();
  for (const reflection of later) {
    const gain1k = reflection.gain[3];
    const pole = Math.round(onePolePole(reflection.gain[5] / gain1k, sampleRate) * 1000) / 1000;
    let copy = copies.get(pole);
    if (copy === undefined) {
      copy = new Float64Array(audible);
      let y = 0;
      for (let n = 0; n < audible; n += 1) {
        y = (1 - pole) * (dry[n] ?? 0) + pole * y;
        copy[n] = y;
      }
      copies.set(pole, copy);
    }
    const scale = (level * directGain * gain1k) / onePoleGain(pole, 1000, sampleRate);
    const [gainLeft, gainRight] = panGains(reflection.azimuthRad);
    const offset = Math.round(reflection.delaySeconds * sampleRate);
    const toLeft = scale * gainLeft;
    const toRight = scale * gainRight;
    for (let n = 0; n < audible; n += 1) {
      const sample = copy[n] ?? 0;
      left[offset + n] = (left[offset + n] ?? 0) + toLeft * sample;
      right[offset + n] = (right[offset + n] ?? 0) + toRight * sample;
    }
  }

  let peak = 0;
  for (let n = 0; n < length; n += 1) peak = Math.max(peak, Math.abs(left[n] ?? 0), Math.abs(right[n] ?? 0));
  return { left, right, sampleRate, peakDb: gainToDb(peak) };
}

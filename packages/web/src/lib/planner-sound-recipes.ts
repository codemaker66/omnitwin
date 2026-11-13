// ---------------------------------------------------------------------------
// The planner's sound palette (T-671, spec section 9): thirteen short sounds,
// each a recipe of voices that lib/sound-registry.ts builds into a Web Audio
// graph and lib/planner-sound-render.ts renders in plain arithmetic for the
// tests and the recordings. One recipe, two renderers, so what is measured is
// what plays.
//
// Levels are peak dBFS before the master. The quiet set (Q) is what "Quiet"
// plays: the set-downs, the refusal, the cue and the four rare moments. The
// full set (F) adds the small sounds of the hand. Hover, press, focus,
// selection, tool and view changes, panels, the camera, undo, autosave and
// page load are silent by design, and no sound is ever the only signal.
// ---------------------------------------------------------------------------

export type PlannerSoundSet = "quiet" | "full";

export const PLANNER_SOUND_IDS = [
  "planner-set-table",
  "planner-set-chair",
  "planner-refuse",
  "planner-cue",
  "planner-horizon",
  "planner-send",
  "planner-present",
  "planner-act",
  "planner-lift",
  "planner-snap",
  "planner-measure",
  "planner-hour",
  "planner-brush",
] as const;

export type PlannerSoundId = (typeof PLANNER_SOUND_IDS)[number];

export interface FilterSpec {
  readonly type: "bandpass" | "lowpass";
  /** Centre or corner in Hz; swept exponentially to `toHz` over the voice when given. */
  readonly hz: number;
  readonly toHz?: number;
  /** Linear Q (a lowpass's Q is converted to dB where Web Audio wants it). */
  readonly q: number;
}

/** A pitched voice: one oscillator, its pitch path and its envelope. */
export interface ToneVoice {
  readonly kind: "tone";
  readonly wave: "sine" | "triangle";
  readonly hz: number;
  /** Glides exponentially to this pitch over `glideMs`. */
  readonly toHz?: number;
  readonly glideMs?: number;
  /** Peak in dBFS before the master. */
  readonly peakDb: number;
  readonly startMs?: number;
  readonly attackMs: number;
  /** Falls exponentially to `floor` × its peak, ending this long after the attack. */
  readonly decayMs: number;
  readonly floor?: number;
  readonly filter?: FilterSpec;
}

/** A breath of noise through a filter: the contact of a leg, the hiss of a cloth. */
export interface NoiseVoice {
  readonly kind: "noise";
  readonly colour: "white" | "brown";
  readonly peakDb: number;
  readonly startMs?: number;
  readonly attackMs: number;
  /** Its whole length; after the attack it falls to −60 dB by this time. */
  readonly lengthMs: number;
  readonly filter: FilterSpec;
}

export type PlannerSoundVoice = ToneVoice | NoiseVoice;

export interface PlannerSoundRecipe {
  readonly id: PlannerSoundId;
  readonly label: string;
  readonly set: PlannerSoundSet;
  /** The sound's peak in dBFS before the master (spec 9's level column). */
  readonly peakDb: number;
  /** How long it sounds, dry (spec 9's length column). */
  readonly lengthMs: number;
  /** The least time between two plays of it. */
  readonly gapMs: number;
  /** The synthesised hall under the dry sound, in dB, for the rare moments only. */
  readonly hallSendDb: number | null;
  /** ± variation each play, pitch as a fraction and level in dB (the set-downs). */
  readonly vary: { readonly pitch: number; readonly levelDb: number } | null;
  readonly voices: readonly PlannerSoundVoice[];
}

const SET_DOWN_VARY = { pitch: 0.03, levelDb: 1 } as const;
/** No sound, of any kind, plays within this of its own last play. */
export const PLANNER_SOUND_MIN_GAP_MS = 45;

/** The bell's three partials (spec 9: 523 Hz with ×2.0 and ×2.76 at 1, 0.35 and 0.12). */
function bell(fundamentalHz: number, peakDb: number, startMs: number, decayMs: number): readonly ToneVoice[] {
  const partials: readonly (readonly [number, number])[] = [[1, 1], [2, 0.35], [2.76, 0.12]];
  return partials.map(([ratio, amplitude]) => ({
    kind: "tone",
    wave: "sine",
    hz: fundamentalHz * ratio,
    peakDb: peakDb + 20 * Math.log10(amplitude),
    startMs,
    attackMs: 6,
    decayMs,
    floor: 0.001,
  }));
}

export const PLANNER_SOUND_RECIPES: Readonly<Record<PlannerSoundId, PlannerSoundRecipe>> = {
  "planner-set-table": {
    id: "planner-set-table",
    label: "A table set down",
    set: "quiet",
    peakDb: -20,
    lengthMs: 160,
    gapMs: PLANNER_SOUND_MIN_GAP_MS,
    hallSendDb: null,
    vary: SET_DOWN_VARY,
    voices: [
      { kind: "tone", wave: "sine", hz: 118, toHz: 82, glideMs: 60, peakDb: -20, attackMs: 2, decayMs: 148, floor: 0.001 },
      { kind: "tone", wave: "sine", hz: 196, peakDb: -29, attackMs: 2, decayMs: 88, floor: 0.001 },
      { kind: "noise", colour: "white", peakDb: -28, attackMs: 1, lengthMs: 12, filter: { type: "bandpass", hz: 700, q: 0.9 } },
    ],
  },
  "planner-set-chair": {
    id: "planner-set-chair",
    label: "A chair set down",
    set: "quiet",
    peakDb: -24,
    lengthMs: 100,
    gapMs: PLANNER_SOUND_MIN_GAP_MS,
    hallSendDb: null,
    vary: SET_DOWN_VARY,
    voices: [
      { kind: "tone", wave: "sine", hz: 165, toHz: 140, glideMs: 40, peakDb: -24, attackMs: 2, decayMs: 78, floor: 0.001 },
      { kind: "noise", colour: "white", peakDb: -30, attackMs: 1, lengthMs: 8, filter: { type: "bandpass", hz: 1100, q: 0.9 } },
    ],
  },
  "planner-refuse": {
    id: "planner-refuse",
    label: "A placement refused",
    set: "quiet",
    peakDb: -24,
    lengthMs: 220,
    // At most once in 600 ms, and never for a form's own checking.
    gapMs: 600,
    hallSendDb: null,
    vary: null,
    voices: [
      { kind: "tone", wave: "sine", hz: 196, toHz: 185, glideMs: 140, peakDb: -24, attackMs: 4, decayMs: 216, floor: 0.001, filter: { type: "lowpass", hz: 900, q: 0.71 } },
    ],
  },
  "planner-cue": {
    id: "planner-cue",
    label: "The hour crossing an act",
    set: "quiet",
    peakDb: -28,
    lengthMs: 35,
    gapMs: PLANNER_SOUND_MIN_GAP_MS,
    hallSendDb: null,
    vary: null,
    voices: [
      { kind: "tone", wave: "sine", hz: 440, peakDb: -28, attackMs: 2, decayMs: 33, floor: 0.001 },
      { kind: "noise", colour: "white", peakDb: -34, attackMs: 1, lengthMs: 6, filter: { type: "bandpass", hz: 1200, q: 0.9 } },
    ],
  },
  "planner-horizon": {
    id: "planner-horizon",
    label: "The sun crossing the horizon",
    set: "quiet",
    peakDb: -24,
    lengthMs: 700,
    gapMs: PLANNER_SOUND_MIN_GAP_MS,
    hallSendDb: -10,
    vary: null,
    voices: [
      { kind: "tone", wave: "sine", hz: 147, peakDb: -30, attackMs: 80, decayMs: 620, floor: 0.001, filter: { type: "lowpass", hz: 1200, q: 0.71 } },
      { kind: "tone", wave: "sine", hz: 220, peakDb: -30, attackMs: 80, decayMs: 620, floor: 0.001, filter: { type: "lowpass", hz: 1200, q: 0.71 } },
    ],
  },
  "planner-send": {
    id: "planner-send",
    label: "Sent, confirmed",
    set: "quiet",
    peakDb: -20,
    lengthMs: 1100,
    gapMs: PLANNER_SOUND_MIN_GAP_MS,
    hallSendDb: -8,
    vary: null,
    voices: [
      ...bell(523, -21.5, 0, 894),
      { kind: "tone", wave: "sine", hz: 784, peakDb: -27.5, startMs: 110, attackMs: 6, decayMs: 594, floor: 0.001 },
    ],
  },
  "planner-present": {
    id: "planner-present",
    label: "The evening begins",
    set: "quiet",
    peakDb: -22,
    lengthMs: 1400,
    gapMs: PLANNER_SOUND_MIN_GAP_MS,
    hallSendDb: -8,
    vary: null,
    voices: [
      { kind: "noise", colour: "brown", peakDb: -30, attackMs: 600, lengthMs: 1400, filter: { type: "lowpass", hz: 200, toHz: 900, q: 0.71 } },
      { kind: "tone", wave: "sine", hz: 110, peakDb: -29, attackMs: 900, decayMs: 500, floor: 0.001 },
      { kind: "tone", wave: "sine", hz: 165, peakDb: -29, attackMs: 900, decayMs: 500, floor: 0.001 },
      ...bell(523, -28, 900, 494),
    ],
  },
  "planner-act": {
    id: "planner-act",
    label: "A new act, while the evening plays",
    set: "quiet",
    peakDb: -26,
    lengthMs: 600,
    gapMs: PLANNER_SOUND_MIN_GAP_MS,
    hallSendDb: -10,
    vary: null,
    voices: [
      { kind: "tone", wave: "sine", hz: 523, peakDb: -26, attackMs: 6, decayMs: 594, floor: 0.001 },
    ],
  },
  "planner-lift": {
    id: "planner-lift",
    label: "A piece picked up",
    set: "full",
    peakDb: -34,
    lengthMs: 50,
    gapMs: PLANNER_SOUND_MIN_GAP_MS,
    hallSendDb: null,
    vary: null,
    voices: [
      { kind: "noise", colour: "white", peakDb: -34, attackMs: 5, lengthMs: 45, filter: { type: "bandpass", hz: 1400, toHz: 1800, q: 0.7 } },
    ],
  },
  "planner-snap": {
    id: "planner-snap",
    label: "A piece locking to a guide",
    set: "full",
    peakDb: -27,
    lengthMs: 40,
    // At most eight a second.
    gapMs: 125,
    hallSendDb: null,
    vary: null,
    voices: [
      { kind: "tone", wave: "triangle", hz: 1000, peakDb: -27, attackMs: 2, decayMs: 38, floor: 0.0001 },
    ],
  },
  "planner-measure": {
    id: "planner-measure",
    label: "A measurement pinned",
    set: "full",
    peakDb: -26,
    lengthMs: 230,
    gapMs: PLANNER_SOUND_MIN_GAP_MS,
    hallSendDb: null,
    vary: null,
    voices: [
      { kind: "tone", wave: "sine", hz: 659, peakDb: -26, attackMs: 3, decayMs: 157, floor: 0.001 },
      { kind: "tone", wave: "sine", hz: 988, peakDb: -28, startMs: 70, attackMs: 3, decayMs: 157, floor: 0.001 },
    ],
  },
  "planner-hour": {
    id: "planner-hour",
    label: "The dragged hour crossing a whole hour",
    set: "full",
    peakDb: -30,
    lengthMs: 35,
    // At most one in 90 ms; silent for keys (the caller's rule).
    gapMs: 90,
    hallSendDb: null,
    vary: null,
    voices: [
      // 330 Hz is the sun on the horizon; the caller raises it to 660 Hz overhead.
      { kind: "tone", wave: "sine", hz: 330, peakDb: -30, attackMs: 2, decayMs: 33, floor: 0.001 },
    ],
  },
  "planner-brush": {
    id: "planner-brush",
    label: "Lay out placing several pieces",
    set: "full",
    peakDb: -34,
    lengthMs: 220,
    gapMs: PLANNER_SOUND_MIN_GAP_MS,
    hallSendDb: null,
    vary: null,
    voices: [
      { kind: "noise", colour: "white", peakDb: -34, attackMs: 20, lengthMs: 220, filter: { type: "bandpass", hz: 600, toHz: 1400, q: 0.6 } },
    ],
  },
};

/** The pitch the dragged hour sounds at: 330 Hz on the horizon, 660 Hz with the sun overhead. */
export function hourPitchHz(sunAltitudeDeg: number): number {
  const clamped = Math.max(0, Math.min(90, sunAltitudeDeg));
  return 330 * 2 ** (clamped / 90);
}

/** A sound as it plays this time: retuned (the hour, a horizon's glide), and louder or softer. */
export interface PlannerSoundVariation {
  /** Multiplies every pitch (a set-down's ±3 %, the hour's height). */
  readonly pitchScale?: number;
  /** Glides every tone by this fraction over the sound (the horizon: +5 % at sunrise, −5 % at sunset). */
  readonly glide?: number;
  /** Above or below its level, in dB; applied by the sound's own gain as it plays. */
  readonly levelDb?: number;
}

/** The recipe retuned for one play. Level is not the recipe's: the render holds every sound to its own. */
export function varyRecipe(recipe: PlannerSoundRecipe, variation: Pick<PlannerSoundVariation, "pitchScale" | "glide">): PlannerSoundRecipe {
  const scale = variation.pitchScale ?? 1;
  const glide = variation.glide ?? 0;
  if (scale === 1 && glide === 0) return recipe;
  return {
    ...recipe,
    voices: recipe.voices.map((voice): PlannerSoundVoice => {
      if (voice.kind === "noise") {
        const toHz = voice.filter.toHz === undefined ? undefined : voice.filter.toHz * scale;
        return { ...voice, filter: { ...voice.filter, hz: voice.filter.hz * scale, toHz } };
      }
      if (glide === 0) {
        return { ...voice, hz: voice.hz * scale, toHz: voice.toHz === undefined ? undefined : voice.toHz * scale };
      }
      return {
        ...voice,
        hz: voice.hz * scale,
        toHz: (voice.toHz ?? voice.hz) * scale * (1 + glide),
        glideMs: recipe.lengthMs - (voice.startMs ?? 0),
      };
    }),
  };
}

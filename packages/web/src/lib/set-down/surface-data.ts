// ---------------------------------------------------------------------------
// The surfaces' own data (T-700): each kind of surface a piece can land on,
// how it answers, and what makes two surfaces the same. It imports nothing, so
// the set-down Worker, which renders from these alone, takes none of the
// catalogue or the rooms that resolving a surface for a room needs
// (surfaces.ts, on the main thread). Splitting it out took 7.5 KB gzipped of
// data the Worker never read out of its chunk (R101).
// ---------------------------------------------------------------------------

export type SurfaceKind =
  | "oak-boards-joists"
  | "oak-parquet"
  | "timber-on-slab"
  | "carpet"
  | "stage-deck"
  | "dance-floor"
  | "table-top";

/** A bank of resonant modes spread between two frequencies. */
export interface ModeBank {
  readonly lowHz: number;
  readonly highHz: number;
  readonly count: number;
  /** Loss factor: the bank's modes decay at eta times their frequency over pi. */
  readonly eta: number;
  /** Level of the bank relative to its own surface's, in dB. */
  readonly gainDb: number;
}

export interface SurfaceResponse {
  readonly kind: SurfaceKind;
  /** How hard the surface strikes back: 1 is oak, a soft surface is near 0. */
  readonly hardness: number;
  /** The surface's own board (or panel, or deck) modes. */
  readonly boards: ModeBank | null;
  /** The floor's lowest joist-and-void thump. */
  readonly thump: { readonly hz: number; readonly zeta: number } | null;
  /** The hollow under a stage deck. */
  readonly cavity: ModeBank | null;
  readonly highCutHz: number;
  /** The room's floor heard through this surface, once resolved for a room. */
  readonly beneath: ModeBank | null;
}

/**
 * What makes two surfaces the same surface: their kind and the floor heard
 * beneath them, never which object carries them (ruling R37). The renderer
 * groups a piece's feet by it and the set-down voice keys its renders by it,
 * so the two cannot disagree (R91).
 */
export function surfaceKey(surface: SurfaceResponse): string {
  const beneath = surface.beneath;
  return beneath === null ? surface.kind : [surface.kind, beneath.lowHz, beneath.highHz, beneath.count, beneath.eta, beneath.gainDb].join("|");
}

/** A hard surface cuts nothing the renderer's ceiling (a 14 kHz low-pass) passes (EST). */
const HARD_CUT_HZ = 16000;

const bank = (lowHz: number, highHz: number, count: number, eta: number): ModeBank => ({ lowHz, highHz, count, eta, gainDb: 0 });

/**
 * The base definitions. A surface that sits on the room's floor has `beneath`
 * null here and gains it in surfaceResponse. Each bank's count and loss
 * factor, and each hardness below oak's 1, are EST.
 * - Oak boards on joists: a 22 mm oak board simply supported over a 0.40 m or
 *   0.45 m joist spacing rings first at f = (pi / 2 L^2) h root(E / 12 rho),
 *   262 Hz or 207 Hz with northern red oak's 12.5 GPa and specific gravity
 *   0.63 (about 700 kg/m3 at 12 % moisture; Kretschmann 2010, Wood Handbook
 *   FPL-GTR-190, ch. 5, Table 5-3a, p. 5-5) (CALC), so the bank spans
 *   150-300 Hz (EST). The thump is the floor's fundamental, 14 Hz, inside the
 *   9.96-18.70 Hz measured on 13 timber floors, whose impulse tests gave a
 *   mean damping ratio of 5.05 % (Xiong, Kang and Lu 2011, J. Asian Archit.
 *   Build. Eng. 10(2):407-412, abstract); its 3 % is EST, under that mean.
 * - Oak parquet: short glued pieces on a sub-floor ring higher and die faster
 *   than boards (EST); its thump, 16 Hz, sits in the same measured range.
 * - Timber on a slab: a board bonded to a slab rings higher and dies faster
 *   still, and has no joists to heave (EST: the spec's "hard click with
 *   almost no low body").
 * - Carpet: no modes of its own (its floor's, beneath it) and a 2.5 kHz cut
 *   (EST); its 45 ms contact (modes.ts) is what dulls it, and at that length
 *   the cut removes almost nothing more.
 * - Stage deck: its boards (EST), and the air under a 6 x 4 ft deck, whose
 *   first modes along and across it are c / 2L, 94 Hz and 141 Hz (CALC), so
 *   the cavity spans 90-160 Hz.
 * - Dance floor and table top: their panels' banks (EST).
 */
export const SURFACES: Readonly<Record<SurfaceKind, SurfaceResponse>> = {
  "oak-boards-joists": {
    kind: "oak-boards-joists",
    hardness: 1,
    boards: bank(150, 300, 24, 0.07),
    thump: { hz: 14, zeta: 0.03 },
    cavity: null,
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
  "oak-parquet": {
    kind: "oak-parquet",
    hardness: 1,
    boards: bank(220, 480, 20, 0.09),
    thump: { hz: 16, zeta: 0.04 },
    cavity: null,
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
  "timber-on-slab": {
    kind: "timber-on-slab",
    hardness: 1,
    boards: bank(400, 900, 12, 0.12),
    thump: null,
    cavity: null,
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
  // Carpet has no modes of its own: what is heard is the floor under it. Its 2.5 kHz cut does almost nothing: against
  // a 16 kHz cut, the energy above 2.5 kHz moves within 1.4 % of a Chiavari's first 50 ms; up to 6 % of a deck's whole render.
  carpet: {
    kind: "carpet",
    hardness: 0.05,
    boards: null,
    thump: null,
    cavity: null,
    highCutHz: 2500,
    beneath: null,
  },
  "stage-deck": {
    kind: "stage-deck",
    hardness: 0.9,
    boards: bank(200, 600, 18, 0.06),
    thump: null,
    cavity: bank(90, 160, 10, 0.05),
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
  "dance-floor": {
    kind: "dance-floor",
    hardness: 1,
    boards: bank(300, 700, 14, 0.08),
    thump: null,
    cavity: null,
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
  "table-top": {
    kind: "table-top",
    hardness: 0.8,
    boards: bank(120, 900, 30, 0.04),
    thump: null,
    cavity: null,
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
};
